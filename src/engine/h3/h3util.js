// ============================================================================
// H3 helpers — the bridge between Uber's H3 geospatial grid (`h3-js`, the
// official WASM-backed binding) and this engine's geometry.
//
// H3 indexes the sphere into hexagons (+ 12 pentagons) at 16 resolutions. We
// use it as the discrete TILE base: each cell becomes one flat-topped hex
// column whose height + biome come from the Noise Stack sampled at the cell
// center. This module only deals with cell SELECTION and lat/lng↔direction
// math; mesh building lives in HexTileMesh.js.
// ============================================================================

import {
  getRes0Cells,
  cellToChildren,
  cellToBoundary,
  cellToLatLng,
  latLngToCell,
  gridDisk,
  polygonToCells,
} from 'h3-js';

const DEG2RAD = Math.PI / 180;

// Practical cap on planet cell count per resolution so we never try to build a
// few hundred thousand prisms in one frame. (res 0:122, 1:842, 2:5882, 3:41k…)
export const PLANET_MAX_RES = 3;

/** Every H3 cell on the globe at a given resolution (res 0 roots → children). */
export function planetCells(res) {
  const r = Math.max(0, Math.min(PLANET_MAX_RES, res | 0));
  if (r === 0) return getRes0Cells();
  const out = [];
  for (const root of getRes0Cells()) {
    const kids = cellToChildren(root, r);
    for (const k of kids) out.push(k);
  }
  return out;
}

/**
 * H3 cells covering a square lat/lng patch centered on the origin (0,0) — used
 * to tile the flat board / a camera patch. `halfDeg` is the half-extent of the
 * patch in degrees; `res` the H3 resolution.
 */
export function patchCells(res, halfDeg, centerLat = 0, centerLng = 0) {
  const r = Math.max(0, res | 0);
  const s = halfDeg;
  // GeoJSON-ish ring [lat,lng] (h3-js default order). Slightly inflated so the
  // projected board is fully covered out to its corners.
  const ring = [
    [centerLat - s, centerLng - s],
    [centerLat - s, centerLng + s],
    [centerLat + s, centerLng + s],
    [centerLat + s, centerLng - s],
  ];
  return polygonToCells([ring], r);
}

/** Cells within `k` rings of the cell containing (lat,lng) — camera patch. */
export function diskCells(res, lat, lng, k) {
  return gridDisk(latLngToCell(lat, lng, res | 0), Math.max(0, k | 0));
}

/** Unit direction (THREE convention, +Y up) for a lat/lng in degrees. */
export function latLngToDir(lat, lng, out = [0, 0, 0]) {
  const la = lat * DEG2RAD, lo = lng * DEG2RAD;
  const cl = Math.cos(la);
  out[0] = cl * Math.cos(lo);
  out[1] = Math.sin(la);
  out[2] = cl * Math.sin(lo);
  return out;
}

/** Cell center as a unit direction. */
export function cellCenterDir(h3, out = [0, 0, 0]) {
  const [lat, lng] = cellToLatLng(h3);
  return latLngToDir(lat, lng, out);
}

/** Cell boundary as an array of unit directions (CCW ring, 5/6/7 verts). */
export function cellBoundaryDirs(h3) {
  const ring = cellToBoundary(h3); // [[lat,lng], ...]
  const dirs = new Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    dirs[i] = latLngToDir(ring[i][0], ring[i][1]);
  }
  return dirs;
}

/**
 * Equirectangular projection of a lat/lng patch onto the board's XZ plane.
 * Maps the patch [-halfDeg, +halfDeg]² centered on (centerLat, centerLng) to
 * [-halfWorld, +halfWorld]². Returns [x, z].
 */
export function latLngToXZ(lat, lng, halfDeg, halfWorld, centerLat = 0, centerLng = 0, out = [0, 0]) {
  out[0] = ((lng - centerLng) / halfDeg) * halfWorld;
  out[1] = ((lat - centerLat) / halfDeg) * halfWorld;
  return out;
}
