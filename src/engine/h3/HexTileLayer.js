// ============================================================================
// HexTileLayer — discrete H3 hex-tile renderer ("board-game" terrain).
//
// Owns a THREE.Group of merged hex-column meshes. Phase 1 implements the
// PLANET path: every H3 cell on the globe becomes a flat-topped hex column
// whose height + color come from the Noise Stack via PlanetHeightSampler. The
// smooth cube-sphere mesh is hidden by the Engine while this layer is visible.
//
// Coloring is elevation-banded against the live palette + sea level (a simple,
// readable biome-by-height mapping that suits discrete tiles). Lighting is
// baked flat per face by HexTileMesh, so no scene lights are required.
// ============================================================================

import * as THREE from 'three';
import { HexTileMeshBuilder, makeHexTileMaterial, sunDirection } from './HexTileMesh.js';
import { planetCells, cellBoundaryDirs, cellCenterDir } from './h3util.js';
import { EARTH_PALETTE } from '../style/ColorPalette.js';

const MAX_LAND_01 = 1.35; // heightAt3D clamps shape to [0,1.35] before scaling

/** Elevation-banded linear-RGB color from the palette. */
function colorForHeight(terrainH, seaLevel, maxLandH, pal) {
  if (terrainH <= seaLevel) {
    const d = seaLevel > 0 ? Math.min(1, (seaLevel - terrainH) / seaLevel) : 0;
    return mix(pal.shallow, pal.deep, d);
  }
  const span = Math.max(maxLandH - seaLevel, 1e-3);
  const t = Math.min(1, (terrainH - seaLevel) / span);
  if (t < 0.04) return pal.sand;
  if (t < 0.32) return mix(pal.grass, pal.forest, t / 0.32);
  if (t < 0.60) return mix(pal.forest, pal.rock, (t - 0.32) / 0.28);
  if (t < 0.82) return mix(pal.rock, pal.rockHi, (t - 0.60) / 0.22);
  if (t < 0.93) return pal.rockHi;
  return pal.snow;
}

function mix(a, b, t) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export class HexTileLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'hex-tile-layer';
    this.group.visible = false;
    this.scene.add(this.group);

    this.material = makeHexTileMaterial();
    this.mesh = null;
    this.cellCount = 0;
    this._signature = null;
  }

  get visible() { return this.group.visible; }
  setVisible(v) { this.group.visible = !!v; }

  /**
   * Build the planet hex tiles. Cheap to call repeatedly — skips the rebuild
   * when the inputs that affect geometry/color are unchanged (signature).
   *
   * @param {object} o
   * @param {PlanetHeightSampler} o.sampler
   * @param {number} o.radius        planet base radius
   * @param {number} o.seaLevel      sea level (world units above base radius)
   * @param {number} o.heightScale   world height scale (for top-band mapping)
   * @param {number} o.resolution    H3 resolution (0..3)
   * @param {object} [o.palette]     linear-RGB palette (defaults to Earth)
   * @param {number} [o.sunAzimuth]
   * @param {number} [o.sunElevation]
   * @param {number} [o.terrainGen]  bumps when the height field changed
   */
  buildPlanet(o) {
    const sig = [
      'planet', o.resolution, Math.round(o.radius), Math.round(o.seaLevel),
      Math.round(o.heightScale), o.sunAzimuth, o.sunElevation, o.terrainGen ?? 0,
    ].join('|');
    if (sig === this._signature && this.mesh) return;
    this._signature = sig;

    const pal = o.palette || EARTH_PALETTE;
    const radius = o.radius;
    const seaLevel = o.seaLevel;
    const maxLandH = MAX_LAND_01 * o.heightScale;
    const seaRadius = radius + seaLevel;

    const builder = new HexTileMeshBuilder({
      sun: sunDirection(o.sunAzimuth ?? 135, o.sunElevation ?? 42),
    });

    const sampler = o.sampler;
    const cells = planetCells(o.resolution);
    const cd = [0, 0, 0];
    for (const h3 of cells) {
      cellCenterDir(h3, cd);
      const terrainH = sampler.heightAt3D(cd[0], cd[1], cd[2]);
      const isWater = terrainH <= seaLevel;
      const topRadius = isWater ? seaRadius : radius + terrainH;

      const dirs = cellBoundaryDirs(h3);
      const top = new Array(dirs.length);
      const base = new Array(dirs.length);
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        // flat top: intersect the ray (origin→d) with the tangent plane at the
        // cell center (plane normal = cd, distance = topRadius)
        const denom = d[0] * cd[0] + d[1] * cd[1] + d[2] * cd[2];
        const t = denom > 1e-4 ? topRadius / denom : topRadius;
        top[i] = [d[0] * t, d[1] * t, d[2] * t];
        base[i] = [d[0] * radius, d[1] * radius, d[2] * radius];
      }
      const color = colorForHeight(terrainH, seaLevel, maxLandH, pal);
      builder.addCell(top, base, color);
    }

    this._swapMesh(builder);
  }

  _swapMesh(builder) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (builder.isEmpty) { this.cellCount = 0; return; }
    const geo = builder.build();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.cellCount = builder.cellCount;
  }

  dispose() {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    this.material.dispose();
    this.scene.remove(this.group);
    this._signature = null;
  }
}
