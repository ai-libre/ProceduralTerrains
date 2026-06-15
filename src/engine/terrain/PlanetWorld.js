import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';

// ============================================================================
// PlanetWorld: a cube-sphere terrain. Six cube faces, each subdivided into a
// faceGrid×faceGrid grid of chunks. Every chunk reuses one of the shared
// unit-grid LOD geometries (with radial skirts) from ChunkGeometry.js.
//
// Each chunk owns its OWN planet material instance: the material's terrain /
// palette uniforms are the engine's shared uniform OBJECTS (passed by
// reference, so every style tweak still applies everywhere), but its cube-face
// mapping uniforms (uFaceOrigin / uFaceU / uFaceV) are private and baked once
// at creation. A single shared material can't work here — three.js only
// uploads a material's uniforms once per render, so per-mesh uniform mutation
// (onBeforeRender) would collapse every chunk onto one cube cell. All chunk
// materials share ONE compiled program (identical source + defines), so the
// cost is just a handful of extra uniform uploads.
//
// The chunk count is bounded (6 * faceGrid²) so they are all created once —
// no streaming. LOD is chosen per frame by distance to the camera; chunks are
// culled by the sphere horizon and the view frustum.
// ============================================================================

// Six cube faces: origin corner + two edge vectors spanning [-1,1]². For each
// face U×V points outward, so front-facing winding is correct with FrontSide.
const FACES = [
  { o: [ 1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] }, // +X
  { o: [-1, -1,  1], u: [0, 2, 0], v: [0, 0, -2] }, // -X
  { o: [-1,  1, -1], u: [0, 0, 2], v: [2, 0, 0] }, // +Y
  { o: [-1, -1,  1], u: [0, 0, -2], v: [2, 0, 0] }, // -Y
  { o: [-1, -1,  1], u: [2, 0, 0], v: [0, 2, 0] }, // +Z
  { o: [ 1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] }, // -Z
];

const DEFAULT_LOD_DISTANCES = [1.4, 2.6, 4.2]; // × chunk world span

export class PlanetWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {() => THREE.ShaderMaterial} makeMaterial  — per-chunk material factory
   * @param {Object} opts
   * @param {number} opts.radius       — planet base radius (world units)
   * @param {number} opts.maxHeight    — terrain ceiling for bounds
   * @param {number} opts.skirtDepth   — radial skirt depth
   * @param {number} [opts.faceGrid]   — chunks per face side (default 8)
   * @param {number[]} [opts.lodSegments]  — per-LOD quads per chunk side
   * @param {number[]} [opts.lodDistances] — LOD thresholds (× chunk span)
   */
  constructor(scene, makeMaterial, opts) {
    this.scene = scene;
    this.makeMaterial = makeMaterial;

    this.radius = opts.radius;
    this.maxHeight = opts.maxHeight;
    this.skirtDepth = opts.skirtDepth;
    this.faceGrid = opts.faceGrid || 8;
    this.lodSegments = opts.lodSegments ? [...opts.lodSegments] : [64, 32, 16, 8];
    this.wireframe = false;

    this.cullingEnabled = true;
    this.horizonCulling = true;
    this.cullingAggressiveness = 1.0;

    // chunk world span ≈ arc length of one cell at the equator
    this.chunkSpan = (this.radius * 2) / this.faceGrid;

    this._baseLodThresholds = opts.lodDistances
      ? [...opts.lodDistances]
      : [...DEFAULT_LOD_DISTANCES];
    this.lodThresholds = this._baseLodThresholds.map(m => m * this.chunkSpan);

    // gradual LOD geometry rebuild queue (one level per frame)
    this._lodRebuildQueue = [];
    this._targetSegments = null;

    // triangle budget (scales LOD thresholds down under pressure)
    this.triangleBudget = 0;
    this._budgetScale = 1.0;
    this._budgetCheckAt = 0;

    this.group = new THREE.Group();
    this.group.name = 'planet-world';
    this.scene.add(this.group);

    // shared per-LOD geometries (unit grid + skirt ring)
    this.geometries = this.lodSegments.map((res, lod) => {
      const geo = buildChunkGeometry(res, lod);
      setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
      return geo;
    });

    this.chunks = [];
    this.materials = [];
    this._buildChunks();

    // stats (mirror InfiniteWorld so the HUD keeps working)
    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = this.chunks.length;
    this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];

    this._frustum = new THREE.Frustum();
    this._projView = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  _buildChunks() {
    const g = this.faceGrid;
    for (const face of FACES) {
      const o = new THREE.Vector3(...face.o);
      const U = new THREE.Vector3(...face.u);
      const V = new THREE.Vector3(...face.v);
      const cu = U.clone().multiplyScalar(1 / g);  // per-chunk edge vectors
      const cv = V.clone().multiplyScalar(1 / g);
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const origin = o.clone()
            .addScaledVector(U, i / g)
            .addScaledVector(V, j / g);
          const centerDir = origin.clone()
            .addScaledVector(cu, 0.5)
            .addScaledVector(cv, 0.5)
            .normalize();

          // per-chunk material: shares the engine uniform objects, owns its
          // face mapping uniforms (baked once here)
          const mat = this.makeMaterial();
          mat.uniforms.uFaceOrigin.value.copy(origin);
          mat.uniforms.uFaceU.value.copy(cu);
          mat.uniforms.uFaceV.value.copy(cv);
          mat.wireframe = this.wireframe;
          this.materials.push(mat);

          const mesh = new THREE.Mesh(this.geometries[3], mat);
          mesh.frustumCulled = false;          // we cull manually (shader transform)
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();

          // world-space bounding sphere for frustum culling
          const worldCenter = centerDir.clone().multiplyScalar(this.radius + this.maxHeight * 0.5);
          let br = 0;
          const cornerR = this.radius + this.maxHeight;
          for (let cy = 0; cy <= 1; cy++) {
            for (let cx = 0; cx <= 1; cx++) {
              const cw = origin.clone()
                .addScaledVector(cu, cx)
                .addScaledVector(cv, cy)
                .normalize()
                .multiplyScalar(cornerR);
              br = Math.max(br, cw.distanceTo(worldCenter));
            }
          }

          this.group.add(mesh);
          this.chunks.push({
            mesh, centerDir, worldCenter, boundRadius: br * 1.05, lod: 3,
          });
        }
      }
    }
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const m of this.materials) m.wireframe = on;
  }

  /** Swap the compile-time octave count on every chunk material (the program
   *  is shared and already cached, so this is instant once warmed). */
  setOctaves(oct) {
    for (const m of this.materials) {
      if (m.defines.OCTAVES !== oct) {
        m.defines.OCTAVES = oct;
        m.needsUpdate = true;
      }
    }
  }

  setLodDistances(distances) {
    this._baseLodThresholds = [...distances];
    this._recalcLodThresholds();
  }

  _recalcLodThresholds() {
    this.lodThresholds = this._baseLodThresholds.map(
      m => m * this.chunkSpan * this._budgetScale
    );
  }

  /** Change per-LOD segment counts — rebuilt gradually (one level/frame). */
  setLodSegments(segments) {
    const same = segments.length === this.lodSegments.length
      && segments.every((s, i) => s === this.lodSegments[i])
      && !this._lodRebuildQueue.length;
    if (same) return;
    this._targetSegments = [...segments];
    this._lodRebuildQueue = [3, 2, 1, 0];
  }

  _processLodRebuild() {
    if (!this._lodRebuildQueue.length || !this._targetSegments) return;
    const lod = this._lodRebuildQueue.shift();
    const res = this._targetSegments[lod];
    if (res === this.lodSegments[lod]) return;

    const geo = buildChunkGeometry(res, lod);
    setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
    const old = this.geometries[lod];
    this.geometries[lod] = geo;
    this.lodSegments[lod] = res;
    for (const c of this.chunks) {
      if (c.lod === lod) c.mesh.geometry = geo;
    }
    old.dispose();
  }

  setTriangleBudget(n) {
    this.triangleBudget = n;
    if (!n) { this._budgetScale = 1.0; this._recalcLodThresholds(); }
  }

  notifyTriangles(triangles) {
    if (!this.triangleBudget) return;
    const now = performance.now();
    if (now - this._budgetCheckAt < 500) return;
    this._budgetCheckAt = now;
    if (triangles > this.triangleBudget && this._budgetScale > 0.35) {
      this._budgetScale = Math.max(0.35, this._budgetScale * 0.9);
      this._recalcLodThresholds();
    } else if (triangles < this.triangleBudget * 0.7 && this._budgetScale < 1.0) {
      this._budgetScale = Math.min(1.0, this._budgetScale * 1.05);
      this._recalcLodThresholds();
    }
  }

  update(cameraPos, camera) {
    this._processLodRebuild();

    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];

    // camera direction from planet center + altitude drive the horizon test.
    // A surface point at direction d is above the horizon when
    //   d · camDir > radius / camLen   (cos of the tangent cap half-angle).
    // We subtract a margin for chunk angular size + terrain peaks so chunks
    // straddling the horizon still render.
    const camLen = this._camDir.copy(cameraPos).length();
    this._camDir.multiplyScalar(camLen > 1e-3 ? 1 / camLen : 0);
    const base = this.radius / Math.max(camLen, 1);
    const margin = 0.08 + (1 - this.cullingAggressiveness) * 0.10;
    const horizonCos = base - margin;

    if (camera) {
      this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projView);
    }

    let visible = 0, culled = 0;
    for (const c of this.chunks) {
      const d = this._tmp.copy(c.worldCenter).sub(cameraPos).length();
      const lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3;
      if (lod !== c.lod) { c.lod = lod; c.mesh.geometry = this.geometries[lod]; }
      counts[lod]++;

      let show = true;
      if (this.cullingEnabled) {
        if (this.horizonCulling && camLen > this.radius) {
          if (this._camDir.dot(c.centerDir) < horizonCos) show = false;
        }
        if (show && camera) {
          if (!this._frustum.intersectsSphere(_sphere.set(c.worldCenter, c.boundRadius))) {
            show = false;
          }
        }
      }
      c.mesh.visible = show;
      if (show) visible++; else culled++;
    }

    this.lodCounts = counts;
    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = visible;
    this.culledChunkCount = culled;
  }

  dispose() {
    for (const c of this.chunks) this.group.remove(c.mesh);
    this.chunks = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    for (const geo of this.geometries) geo.dispose();
    this.geometries = [];
    this.scene.remove(this.group);
  }
}

const _sphere = new THREE.Sphere();
