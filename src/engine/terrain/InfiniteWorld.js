import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';
import { cullChunks } from './InfiniteTerrainCulling.js';

// ============================================================================
// InfiniteWorld: streams terrain chunks around the player camera.
// Chunks are placed on an integer grid (cx, cz). Each chunk is a THREE.Mesh
// using the shared infinite-mode terrain material and one of 4 shared LOD
// geometries. Chunks outside the view radius are disposed.
// ============================================================================

const LOD_RESOLUTIONS = [64, 32, 16, 8];
const DEFAULT_MAX_CREATES = 6;

export class InfiniteWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Material} terrainMaterial  — infinite-mode terrain material
   * @param {THREE.Material} waterMaterial    — infinite-mode water material
   * @param {Object} opts
   * @param {number} opts.chunkSize       — world units per chunk side
   * @param {number} opts.viewRadius      — how many chunks outward to load
   * @param {number} opts.maxHeight       — vertical ceiling for bounding boxes
   * @param {number} opts.skirtDepth      — skirt depth for geometry bounds
   * @param {number} opts.seaLevel        — water plane height
   */
  constructor(scene, terrainMaterial, waterMaterial, opts) {
    this.scene = scene;
    this.terrainMaterial = terrainMaterial;
    this.waterMaterial = waterMaterial;

    this.chunkSize = opts.chunkSize;
    this.viewRadius = opts.viewRadius || 12;
    this.maxHeight = opts.maxHeight;
    this.skirtDepth = opts.skirtDepth;
    this.seaLevel = opts.seaLevel ?? 42;
    this.maxCreatesPerFrame = DEFAULT_MAX_CREATES;

    // Culling options
    this.behindCameraCulling = true;

    // group contains all terrain chunks
    this.group = new THREE.Group();
    this.group.name = 'infinite-world';
    this.scene.add(this.group);

    // water plane — follows player, sized to match terrain radius
    this.waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.waterMaterial
    );
    this.waterPlane.geometry.rotateX(-Math.PI / 2);
    this.waterPlane.renderOrder = 10;
    this.waterPlane.frustumCulled = false;
    this.waterPlane.position.y = this.seaLevel;
    this._updateWaterSize();
    this.scene.add(this.waterPlane);

    // shared geometries per LOD
    this.geometries = LOD_RESOLUTIONS.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
      return geo;
    });

    // LOD distance thresholds (scale with chunk size and quality)
    this._baseLodThresholds = [4, 8, 14]; // multiplied by chunkSize
    this._lodMultiplier = 1.0;
    this.lodThresholds = this._baseLodThresholds.map(m => m * this.chunkSize);

    // chunk map: "cx,cz" -> { mesh, cx, cz, center, lod }
    this.chunks = new Map();

    // player chunk tracking
    this._lastPlayerCX = Infinity;
    this._lastPlayerCZ = Infinity;

    // chunk loading queue
    this._pendingChunks = [];

    // stats
    this.activeChunkCount = 0;
    this.visibleChunkCount = 0;
    this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];

    this._tmp = new THREE.Vector3();
  }

  /**
   * Update water plane size to match terrain render distance.
   * Water extends exactly to the terrain edge (viewRadius * 2 + 1 chunks)
   * so it never renders beyond where terrain exists.
   */
  _updateWaterSize() {
    const waterSize = this.chunkSize * (this.viewRadius * 2 + 1);
    this.waterPlane.scale.set(waterSize, 1, waterSize);

    // Update water fade distance uniforms (if available)
    if (this.waterMaterial.uniforms.uWaterFadeStart) {
      const fadeStart = waterSize * 0.42;
      const fadeEnd = waterSize * 0.50;
      this.waterMaterial.uniforms.uWaterFadeStart.value = fadeStart;
      this.waterMaterial.uniforms.uWaterFadeEnd.value = fadeEnd;
    }
  }

  /**
   * Change the view radius at runtime (e.g. quality preset change).
   * Recalculates chunk set, water size, and LOD thresholds without
   * rebuilding chunk geometry.
   */
  setViewRadius(r) {
    if (r === this.viewRadius) return;
    this.viewRadius = r;
    this._recalcLodThresholds();
    this._updateWaterSize();
    // Force recalc on next update
    this._lastPlayerCX = Infinity;
    this._lastPlayerCZ = Infinity;
  }

  /**
   * Change the LOD distance multiplier (quality preset).
   * Lower = chunks drop to low-detail sooner (better perf).
   * Higher = chunks keep high-detail further out (better visuals).
   */
  setLodMultiplier(m) {
    this._lodMultiplier = m;
    this._recalcLodThresholds();
  }

  /** Recompute LOD thresholds from base × chunkSize × multiplier. */
  _recalcLodThresholds() {
    this.lodThresholds = this._baseLodThresholds.map(
      m => m * this.chunkSize * this._lodMultiplier
    );
  }

  /**
   * Change max chunk creates per frame (performance tuning).
   */
  setMaxCreatesPerFrame(n) {
    this.maxCreatesPerFrame = n;
  }

  /**
   * Called each frame from Engine._tick(). Determines which chunks should
   * exist, creates missing ones (throttled), removes distant ones, updates
   * LOD, and culls invisible chunks.
   */
  update(playerPos, camera) {
    const cs = this.chunkSize;
    const pcx = Math.floor(playerPos.x / cs);
    const pcz = Math.floor(playerPos.z / cs);

    // Move water plane to follow player (keeps precision reasonable)
    this.waterPlane.position.x = pcx * cs;
    this.waterPlane.position.z = pcz * cs;

    // If player crossed a chunk boundary, recalculate desired set
    if (pcx !== this._lastPlayerCX || pcz !== this._lastPlayerCZ) {
      this._lastPlayerCX = pcx;
      this._lastPlayerCZ = pcz;
      this._recalcChunkSet(pcx, pcz);
    }

    // Create pending chunks (throttled)
    this._createPending();

    // Update LOD for all active chunks
    this._updateLOD(playerPos);

    // Cull invisible chunks (frustum + behind-camera)
    if (camera) {
      const result = cullChunks(
        this.chunks, camera, this.chunkSize,
        this.maxHeight, this.behindCameraCulling
      );
      this.visibleChunkCount = result.visibleCount;
      this.culledChunkCount = result.culledCount;
    }
  }

  /**
   * Recalculate which chunks should exist around the player chunk.
   * Queue missing chunks for creation, remove ones outside radius.
   */
  _recalcChunkSet(pcx, pcz) {
    const r = this.viewRadius;
    const r2 = r * r;
    const unloadR2 = (r + 2) * (r + 2);  // hysteresis buffer

    // Build set of desired chunk keys
    const desired = new Set();
    this._pendingChunks = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r2) continue;  // circular radius
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        desired.add(key);
        if (!this.chunks.has(key)) {
          // Priority: closer chunks first
          this._pendingChunks.push({ cx, cz, dist2: dx * dx + dz * dz });
        }
      }
    }

    // Sort pending by distance (closest first)
    this._pendingChunks.sort((a, b) => a.dist2 - b.dist2);

    // Remove chunks outside unload radius
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > unloadR2) {
        this.group.remove(chunk.mesh);
        this.chunks.delete(key);
      }
    }
  }

  /**
   * Create a batch of pending chunks (up to maxCreatesPerFrame).
   */
  _createPending() {
    let created = 0;
    while (this._pendingChunks.length > 0 && created < this.maxCreatesPerFrame) {
      const { cx, cz } = this._pendingChunks.shift();
      const key = `${cx},${cz}`;
      if (this.chunks.has(key)) continue;  // already exists (edge case)

      const mesh = new THREE.Mesh(this.geometries[3], this.terrainMaterial);
      mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
      mesh.scale.setScalar(this.chunkSize);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);

      this.group.add(mesh);
      this.chunks.set(key, {
        mesh,
        cx, cz,
        center: new THREE.Vector3(
          cx * this.chunkSize + this.chunkSize / 2,
          0,
          cz * this.chunkSize + this.chunkSize / 2
        ),
        lod: 3,
      });
      created++;
    }
  }

  /**
   * Update LOD level per chunk based on distance from player.
   */
  _updateLOD(playerPos) {
    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];

    for (const chunk of this.chunks.values()) {
      const d = this._tmp.copy(chunk.center).sub(playerPos).length();
      const lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3;
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        chunk.mesh.geometry = this.geometries[lod];
      }
      counts[lod]++;
    }

    this.lodCounts = counts;
    this.activeChunkCount = this.chunks.size;
  }

  /**
   * Update settings that can change while infinite mode is active.
   */
  updateSettings({ maxHeight, skirtDepth, seaLevel }) {
    if (maxHeight !== undefined) this.maxHeight = maxHeight;
    if (skirtDepth !== undefined) this.skirtDepth = skirtDepth;
    if (seaLevel !== undefined) {
      this.seaLevel = seaLevel;
      this.waterPlane.position.y = seaLevel;
      this.waterPlane.visible = seaLevel > 0.5;
    }

    // Update geometry bounds
    for (const geo of this.geometries) {
      setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
    }
  }

  /**
   * Show/hide the entire infinite world.
   */
  setVisible(visible) {
    this.group.visible = visible;
    this.waterPlane.visible = visible && this.seaLevel > 0.5;
  }

  /**
   * Dispose all chunks and remove from scene.
   */
  dispose() {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
    }
    this.chunks.clear();
    this._pendingChunks = [];

    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries = [];

    this.scene.remove(this.group);
    this.scene.remove(this.waterPlane);
    this.waterPlane.geometry.dispose();
  }
}
