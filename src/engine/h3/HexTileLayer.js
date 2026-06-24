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
import {
  planetCells, cellBoundaryDirs, cellCenterDir,
  patchCells, diskCells, latLngToXZ, cellToLatLng, cellToBoundary,
} from './h3util.js';
import { latLngToCell, cellToChildren } from 'h3-js';
import { EARTH_PALETTE } from '../style/ColorPalette.js';

const MAX_LAND_01 = 1.35; // heightAt clamps shape to [0,1.35] before scaling

// ---- Adaptive LOD ----------------------------------------------------------
// H3 is hierarchical, so a tile field can mix resolutions: cells near the
// camera are refined to children (finer), far cells stay coarse. Discrete
// columns need no crack-stitching — differently sized hexes just sit side by
// side, their vertical walls hiding the height step. Span = how many H3 levels
// the far/coarse floor sits below the near/max resolution.
const LOD_SPAN_PLANET = 2;
const LOD_SPAN_BOARD = 2;
const LOD_SPAN_INF = 1;
const PLANET_BACK_CULL = -0.15;   // skip cells > ~99° behind the camera
// per-resolution H3 cell center spacing (degrees) — for infinite LOD ring sizing
const SPACING_DEG = { 3: 0.3227 / 2.6, 4: 0.3227, 5: 0.1246, 6: 0.0462, 7: 0.0178, 8: 0.0066 };

// Flat board / infinite: H3 cells covering this lat/lng half-window (degrees)
// are projected (equirectangular, centered on the equator → minimal distortion)
// onto the board's XZ plane. Base H3 resolution + UI step give the tile density.
const BOARD_PATCH_DEG = 8;
const BOARD_BASE_RES = 3;   // UI res 0→3 (336 cells) .. 2→5 (16k cells)
const BOARD_MAX_STEP = 2;

function clampInt(v, lo, hi) { v = v | 0; return v < lo ? lo : v > hi ? hi : v; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Infinite world: a camera-following H3 patch. World↔geo scale is a fixed
// constant; the UI step picks the H3 resolution + ring radius (tile size +
// patch coverage). At unitsPerDeg=1200: res 5/6/7 → ~150/55/21 world-unit tiles.
const INF_UNITS_PER_DEG = 1200;
const INF_STEP = [
  { res: 5, rings: 10 },  // ~331 tiles, ~1500u radius
  { res: 6, rings: 14 },  // ~631 tiles, ~770u radius
  { res: 7, rings: 18 },  // ~1027 tiles, ~378u radius
];

/** Elevation-banded linear-RGB color (legacy fallback; kept for the harness). */
export function colorForHeight(terrainH, seaLevel, maxLandH, pal) {
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

// Phase 4: color each tile from the sampler's REAL biome classifier (so hex
// tiles match the smooth terrain), modulated by absolute height — a beach band
// just above the shore and a snow cap on high ground. `biome` is the dominant
// label (Desert / Canyon / Wetland / Mountains / Forest).
const SNOW_START = 0.30;  // × heightScale (above sea) where snow begins
const SNOW_FULL = 0.72;   // × heightScale where snow is full
const BEACH_BAND = 0.018; // × heightScale just above sea → sand

/** Linear-RGB color for a tile from its biome + absolute height. */
export function colorForCell(biome, terrainH, seaLevel, heightScale, pal) {
  if (terrainH <= seaLevel) {
    const d = seaLevel > 0 ? Math.min(1, (seaLevel - terrainH) / seaLevel) : 0;
    return mix(pal.shallow, pal.deep, d);
  }
  const above = terrainH - seaLevel;
  if (above < BEACH_BAND * heightScale) return pal.sand;

  let base;
  switch (biome) {
    case 'Desert':    base = mix(pal.sand, pal.dune, 0.5); break;
    case 'Canyon':    base = mix(pal.redRock, pal.redRock2, 0.5); break;
    case 'Wetland':   base = mix(pal.swamp, pal.grass, 0.4); break;
    case 'Mountains': base = mix(pal.rock, pal.rockHi, 0.4); break;
    default:          base = mix(pal.grass, pal.forest, 0.5); break; // Forest
  }

  // snow cap (deserts stay bare — hot)
  if (biome !== 'Desert') {
    const s0 = SNOW_START * heightScale, s1 = SNOW_FULL * heightScale;
    if (above > s0) {
      const t = Math.min(1, (above - s0) / Math.max(s1 - s0, 1e-3));
      base = mix(base, pal.snow, t * 0.92);
    }
  }
  return base;
}

function mix(a, b, t) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

// quantize to a grid step (for camera-driven LOD signatures)
function q(v, step) { return Math.round(v / step); }
function normalize3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

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
   * @param {boolean} [o.lod]        adaptive LOD (finer near camera, back-culled)
   * @param {number[]} [o.cameraPos] camera world position (required for LOD)
   */
  buildPlanet(o) {
    const nearRes = clampInt(o.resolution, 0, 3);
    const lod = !!o.lod && Array.isArray(o.cameraPos);
    const camDir = lod ? normalize3(o.cameraPos) : [0, 0, 1];
    // quantize the camera direction so orbiting only rebuilds every ~7°
    const qd = lod ? `${q(camDir[0], 0.12)},${q(camDir[1], 0.12)},${q(camDir[2], 0.12)}` : 'off';

    const sig = [
      'planet', nearRes, lod ? 1 : 0, qd, Math.round(o.radius), Math.round(o.seaLevel),
      Math.round(o.heightScale), o.sunAzimuth, o.sunElevation, o.terrainGen ?? 0,
    ].join('|');
    if (sig === this._signature && this.mesh) return;
    this._signature = sig;

    const pal = o.palette || EARTH_PALETTE;
    const radius = o.radius;
    const seaLevel = o.seaLevel;
    const seaRadius = radius + seaLevel;

    const builder = new HexTileMeshBuilder({
      sun: sunDirection(o.sunAzimuth ?? 135, o.sunElevation ?? 42),
    });

    const sampler = o.sampler;
    const cells = lod ? this._planetLodCells(nearRes, camDir) : planetCells(nearRes);
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
      const biome = sampler.biomeAt3D(cd[0], cd[1], cd[2]).label;
      const color = colorForCell(biome, terrainH, seaLevel, o.heightScale, pal);
      builder.addCell(top, base, color);
    }

    this._swapMesh(builder);
  }

  /**
   * Build the flat-board hex tiles. H3 cells over a small equatorial lat/lng
   * patch are projected onto the board's XZ plane; each cell's height + color
   * come from TerrainHeightSampler at the projected cell center.
   *
   * @param {object} o
   * @param {TerrainHeightSampler} o.sampler   reads (x,z) world height
   * @param {number} o.boardSize   full board size (world units)
   * @param {number} o.seaLevel
   * @param {number} o.heightScale
   * @param {number} o.resolution  UI H3 step (0..2 → H3 res 3..5)
   * @param {object} [o.palette]
   * @param {number} [o.sunAzimuth]
   * @param {number} [o.sunElevation]
   * @param {number} [o.terrainGen]
   */
  buildBoard(o) {
    const halfWorld = o.boardSize / 2;
    const halfDeg = BOARD_PATCH_DEG;
    const nearAbsRes = BOARD_BASE_RES + clampInt(o.resolution, 0, BOARD_MAX_STEP);
    const lod = !!o.lod && Number.isFinite(o.cameraX) && Number.isFinite(o.cameraZ);
    const camX = o.cameraX || 0, camZ = o.cameraZ || 0;
    const qcam = lod ? `${q(camX, halfWorld * 0.12)},${q(camZ, halfWorld * 0.12)}` : 'off';

    const sig = [
      'board', clampInt(o.resolution, 0, BOARD_MAX_STEP), lod ? 1 : 0, qcam,
      Math.round(o.boardSize), Math.round(o.seaLevel), Math.round(o.heightScale),
      o.sunAzimuth, o.sunElevation, o.terrainGen ?? 0,
    ].join('|');
    if (sig === this._signature && this.mesh) return;
    this._signature = sig;

    const pal = o.palette || EARTH_PALETTE;
    const sampler = o.sampler;
    const seaLevel = o.seaLevel;

    const builder = new HexTileMeshBuilder({
      sun: sunDirection(o.sunAzimuth ?? 135, o.sunElevation ?? 42),
    });

    const cells = lod
      ? this._boardLodCells(nearAbsRes, halfDeg, halfWorld, camX, camZ)
      : patchCells(nearAbsRes, halfDeg);
    const cxz = [0, 0], p = [0, 0];
    for (const h3 of cells) {
      const [clat, clng] = cellToLatLng(h3);
      latLngToXZ(clat, clng, halfDeg, halfWorld, 0, 0, cxz);
      // clip to the board square (ragged hex edge is fine / natural)
      if (Math.abs(cxz[0]) > halfWorld || Math.abs(cxz[1]) > halfWorld) continue;

      const terrainH = sampler.heightAt(cxz[0], cxz[1]);
      const isWater = terrainH <= seaLevel;
      const topY = isWater ? seaLevel : terrainH;

      const ring = cellToBoundary(h3);
      const top = new Array(ring.length);
      const base = new Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        latLngToXZ(ring[i][0], ring[i][1], halfDeg, halfWorld, 0, 0, p);
        top[i] = [p[0], topY, p[1]];
        base[i] = [p[0], 0, p[1]];
      }
      const biome = sampler.biomeAt(cxz[0], cxz[1]).label;
      builder.addCell(top, base, colorForCell(biome, terrainH, seaLevel, o.heightScale, pal));
    }

    this._swapMesh(builder);
  }

  /**
   * Build a camera-following hex patch for the Infinite World. H3 cells in a
   * disk around the camera's geo-projected position are mapped back to world XZ
   * (constant scale, no island falloff); height + color from TerrainHeightSampler.
   * Rebuilds only when the camera crosses into a new center cell.
   *
   * @param {object} o
   * @param {TerrainHeightSampler} o.sampler   (env.infinite must be true)
   * @param {number} o.cameraX  @param {number} o.cameraZ
   * @param {number} o.seaLevel @param {number} o.heightScale
   * @param {number} o.resolution  UI step (0..2 → H3 res 5..7)
   * @param {object} [o.palette] @param {number} [o.sunAzimuth] @param {number} [o.sunElevation]
   * @param {number} [o.terrainGen]
   * @returns {boolean} whether a rebuild happened
   */
  buildInfinite(o) {
    const step = INF_STEP[clampInt(o.resolution, 0, INF_STEP.length - 1)];
    const upd = INF_UNITS_PER_DEG;
    const centerLat = clamp(o.cameraZ / upd, -89, 89);
    const centerLng = clamp(o.cameraX / upd, -179, 179);
    const centerCell = latLngToCell(centerLat, centerLng, step.res);

    const lod = !!o.lod;
    const sig = [
      'inf', step.res, step.rings, lod ? 1 : 0, centerCell, Math.round(o.seaLevel),
      Math.round(o.heightScale), o.sunAzimuth, o.sunElevation, o.terrainGen ?? 0,
    ].join('|');
    if (sig === this._signature && this.mesh) return false;
    this._signature = sig;

    const pal = o.palette || EARTH_PALETTE;
    const sampler = o.sampler;
    const seaLevel = o.seaLevel;
    const builder = new HexTileMeshBuilder({
      sun: sunDirection(o.sunAzimuth ?? 135, o.sunElevation ?? 42),
    });

    const cells = lod
      ? this._infiniteLodCells(step.res, upd, centerLat, centerLng, o.cameraX, o.cameraZ, step.rings)
      : diskCells(step.res, centerLat, centerLng, step.rings);
    for (const h3 of cells) {
      const [clat, clng] = cellToLatLng(h3);
      const cx = clng * upd, cz = clat * upd;
      const terrainH = sampler.heightAt(cx, cz);
      const isWater = terrainH <= seaLevel;
      const topY = isWater ? seaLevel : terrainH;

      const ring = cellToBoundary(h3);
      const top = new Array(ring.length);
      const base = new Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][1] * upd, z = ring[i][0] * upd;
        top[i] = [x, topY, z];
        base[i] = [x, 0, z];
      }
      const biome = sampler.biomeAt(cx, cz).label;
      builder.addCell(top, base, colorForCell(biome, terrainH, seaLevel, o.heightScale, pal));
    }

    this._swapMesh(builder);
    return true;
  }

  // ---- adaptive LOD cell selection -----------------------------------------
  // Recursively refine `cell` toward `maxRes`: keep it if its location wants no
  // more detail, else descend to children. wantRes(cell) → desired final res.
  _refine(cell, cellRes, maxRes, wantRes, out) {
    if (cellRes >= maxRes || wantRes(cell) <= cellRes) { out.push(cell); return; }
    const kids = cellToChildren(cell, cellRes + 1);
    for (let i = 0; i < kids.length; i++) this._refine(kids[i], cellRes + 1, maxRes, wantRes, out);
  }

  /** Planet: coarse floor over the globe, refined toward the sub-camera point,
   *  back hemisphere culled. */
  _planetLodCells(nearRes, camDir) {
    const floorRes = Math.max(0, nearRes - LOD_SPAN_PLANET);
    const out = [];
    const cd = [0, 0, 0];
    const want = (cell) => {
      cellCenterDir(cell, cd);
      const ang = Math.acos(clamp(cd[0] * camDir[0] + cd[1] * camDir[1] + cd[2] * camDir[2], -1, 1));
      const r = ang < 0.45 ? nearRes : ang < 0.95 ? nearRes - 1 : floorRes;
      return clamp(r, floorRes, nearRes);
    };
    for (const c of planetCells(floorRes)) {
      cellCenterDir(c, cd);
      if (cd[0] * camDir[0] + cd[1] * camDir[1] + cd[2] * camDir[2] < PLANET_BACK_CULL) continue;
      this._refine(c, floorRes, nearRes, want, out);
    }
    return out;
  }

  /** Board: coarse floor over the patch, refined toward the camera ground point. */
  _boardLodCells(nearAbsRes, halfDeg, halfWorld, camX, camZ) {
    const floorRes = Math.max(BOARD_BASE_RES, nearAbsRes - LOD_SPAN_BOARD);
    const out = [];
    const xz = [0, 0];
    const want = (cell) => {
      const [la, lo] = cellToLatLng(cell);
      latLngToXZ(la, lo, halfDeg, halfWorld, 0, 0, xz);
      const dist = Math.hypot(xz[0] - camX, xz[1] - camZ);
      const r = dist < halfWorld * 0.28 ? nearAbsRes
        : dist < halfWorld * 0.62 ? nearAbsRes - 1 : floorRes;
      return clamp(r, floorRes, nearAbsRes);
    };
    for (const c of patchCells(floorRes, halfDeg)) this._refine(c, floorRes, nearAbsRes, want, out);
    return out;
  }

  /** Infinite: coarse floor disk around the camera, refined near the camera. */
  _infiniteLodCells(nearRes, upd, centerLat, centerLng, camX, camZ, nearRings) {
    const floorRes = Math.max(0, nearRes - LOD_SPAN_INF);
    const worldRadius = nearRings * (SPACING_DEG[nearRes] ?? 0.05) * upd;
    const floorRings = Math.ceil(worldRadius / ((SPACING_DEG[floorRes] ?? 0.1) * upd)) + 1;
    const out = [];
    const want = (cell) => {
      const [la, lo] = cellToLatLng(cell);
      const dist = Math.hypot(lo * upd - camX, la * upd - camZ);
      const r = dist < worldRadius * 0.4 ? nearRes : dist < worldRadius * 0.75 ? nearRes - 1 : floorRes;
      return clamp(r, floorRes, nearRes);
    };
    for (const c of diskCells(floorRes, centerLat, centerLng, floorRings)) {
      this._refine(c, floorRes, nearRes, want, out);
    }
    return out;
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
