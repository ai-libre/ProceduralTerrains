// ============================================================================
// Offline objective-feedback harness for the H3 hex tiles.
//
// No browser / WebGL is available in this environment, so instead of capturing
// the live app we drive the REAL engine modules — the f32-exact CPU samplers
// (TerrainHeightSampler / PlanetHeightSampler), the real H3 helpers, and the
// real colorForHeight() — with a faithfully reconstructed uniform set (the same
// param→uniform mapping Engine._applyUniforms uses for the default project).
//
// It rasterizes top-down (board) and orthographic (planet) views to PNG so the
// hex tiling, height→color mapping and water classification can be SEEN and
// logged, then iterated on.
// ============================================================================

import zlib from 'node:zlib';
import fs from 'node:fs';
import { TerrainHeightSampler } from '../src/engine/terrain/TerrainHeightSampler.js';
import { PlanetHeightSampler } from '../src/engine/terrain/PlanetHeightSampler.js';
import { colorForHeight, colorForCell } from '../src/engine/h3/HexTileLayer.js';
import { EARTH_PALETTE } from '../src/engine/style/ColorPalette.js';
import {
  planetCells, patchCells, diskCells, cellBoundaryDirs, cellCenterDir,
  cellToLatLng, cellToBoundary, latLngToXZ,
} from '../src/engine/h3/h3util.js';
import { sunDirection } from '../src/engine/h3/HexTileMesh.js';

const MAX_LAND_01 = 1.35;

// ---- exact replica of Engine._applyUniforms (legacy/default stack) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const V = (x) => ({ value: x });
function makeUniforms(p, boardSize) {
  const rng = mulberry32(p.seed >>> 0);
  return {
    uSeedOffset: V({ x: rng() * 2048 - 1024, y: rng() * 2048 - 1024 }),
    uFrequency: V((p.noiseScale * 0.1) / boardSize),
    uHeightScale: V(p.heightScale),
    uSeaLevel: V(p.seaLevel),
    uAmplitude: V(p.noiseStrength),
    uPersistence: V(p.persistence),
    uLacunarity: V(p.lacunarity),
    uRidge: V(p.ridge),
    uWarp: V(p.warp),
    uFalloff: V(p.falloff),
    uBoardHalf: V(boardSize / 2),
    uMoistScale: V(p.moistScale),
    uMoistBias: V(p.moistBias),
    uBiomeScale: V(p.biomeScale),
    uTempBias: V(p.tempBias),
    uPlanetRadius: V(p.planetRadius),
  };
}

const DEFAULTS = {
  seed: 1337, heightScale: 560, seaLevel: 100, noiseScale: 45, noiseStrength: 1.0,
  octaves: 7, persistence: 0.5, lacunarity: 2.05, ridge: 0.65, warp: 0.9, falloff: 0.2,
  moistScale: 1.0, moistBias: 0.0, biomeScale: 1.0, tempBias: 0.0,
  planetRadius: 16000, sunAzimuth: 135, sunElevation: 42,
};

// ---- minimal truecolor PNG writer (zlib deflate, filter 0) ------------------
function writePNG(path, w, h, rgb /* Uint8Array w*h*3 */) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, y * w * 3 + w * 3)
             : raw.set(rgb.subarray(y * w * 3, y * w * 3 + w * 3), y * (w * 3 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return c ^ 0xFFFFFFFF; }

// ---- raster helpers ---------------------------------------------------------
function lin2srgb(v) { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
function makeCanvas(w, h, bg = [10, 12, 18]) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }
  return buf;
}
// fill convex polygon (pts: [[px,py],...]) with linear rgb*shade
function fillPoly(buf, w, h, pts, rgbLin, shade) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
  const r = Math.round(lin2srgb(rgbLin[0] * shade) * 255);
  const g = Math.round(lin2srgb(rgbLin[1] * shade) * 255);
  const b = Math.round(lin2srgb(rgbLin[2] * shade) * 255);
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const y0 = a[1], y1 = c[1];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(a[0] + (y - y0) / (y1 - y0) * (c[0] - a[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(w - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) { const o = (y * w + x) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; }
    }
  }
}

// ---- board render -----------------------------------------------------------
function renderBoard(p, { res = 0, size = 768 } = {}) {
  const boardSize = 2048;
  const u = makeUniforms(p, boardSize);
  const sampler = new TerrainHeightSampler(u, () => ({ octaves: Math.round(p.octaves), infinite: false }), null);
  const halfWorld = boardSize / 2, halfDeg = 8, absRes = 3 + Math.max(0, Math.min(2, res));
  const sun = sunDirection(p.sunAzimuth, p.sunElevation);
  const buf = makeCanvas(size, size);
  const cells = patchCells(absRes, halfDeg);
  const cxz = [0, 0], pp = [0, 0];
  const stat = { cells: 0, water: 0, hMin: Infinity, hMax: -Infinity, hSum: 0 };
  const W2P = (x, z) => [((x / halfWorld) * 0.5 + 0.5) * size, ((z / halfWorld) * 0.5 + 0.5) * size];
  for (const h3 of cells) {
    const [clat, clng] = cellToLatLng(h3);
    latLngToXZ(clat, clng, halfDeg, halfWorld, 0, 0, cxz);
    if (Math.abs(cxz[0]) > halfWorld || Math.abs(cxz[1]) > halfWorld) continue;
    const th = sampler.heightAt(cxz[0], cxz[1]);
    const water = th <= p.seaLevel;
    stat.cells++; if (water) stat.water++;
    stat.hMin = Math.min(stat.hMin, th); stat.hMax = Math.max(stat.hMax, th); stat.hSum += th;
    const biome = sampler.biomeAt(cxz[0], cxz[1]).label;
    const color = colorForCell(biome, th, p.seaLevel, p.heightScale, EARTH_PALETTE);
    // top-face shade: normal = +Y → ndotl = sun.y; gentle relief tint by height
    const shade = 0.55 + 0.45 * Math.max(sun[1], 0) * (0.7 + 0.3 * Math.min(1, th / (p.heightScale)));
    const ring = cellToBoundary(h3).map(([lat, lng]) => { latLngToXZ(lat, lng, halfDeg, halfWorld, 0, 0, pp); return W2P(pp[0], pp[1]); });
    fillPoly(buf, size, size, ring, color, shade);
  }
  return { buf, size, stat };
}

// ---- planet render (orthographic, painter's algorithm) ----------------------
function renderPlanet(p, { res = 1, size = 768 } = {}) {
  const boardSize = 2048;
  const u = makeUniforms(p, boardSize);
  const sampler = new PlanetHeightSampler(u, () => ({ octaves: Math.round(p.octaves) }), null);
  const radius = p.planetRadius, sun = sunDirection(p.sunAzimuth, p.sunElevation);
  const buf = makeCanvas(size, size);
  // camera basis: look from +Z-ish, slightly above
  const cam = norm([0.45, 0.35, 1]);
  const up0 = [0, 1, 0];
  const right = norm(cross(up0, cam));
  const up = cross(cam, right);
  const scale = size / (radius * 2.3);
  const project = (x, y, z) => [size / 2 + dot([x, y, z], right) * scale, size / 2 - dot([x, y, z], up) * scale];
  const cells = planetCells(res);
  const cd = [0, 0, 0];
  const stat = { cells: 0, drawn: 0, water: 0, hMin: Infinity, hMax: -Infinity, hSum: 0 };
  const tiles = [];
  for (const h3 of cells) {
    cellCenterDir(h3, cd);
    if (dot(cd, cam) <= 0.02) { stat.cells++; continue; } // back hemisphere
    const th = sampler.heightAt3D(cd[0], cd[1], cd[2]);
    const water = th <= p.seaLevel;
    stat.cells++; stat.drawn++; if (water) stat.water++;
    stat.hMin = Math.min(stat.hMin, th); stat.hMax = Math.max(stat.hMax, th); stat.hSum += th;
    const topR = water ? radius + p.seaLevel : radius + th;
    const dirs = cellBoundaryDirs(h3);
    const poly = dirs.map((d) => {
      const den = dot(d, cd); const t = den > 1e-4 ? topR / den : topR;
      return project(d[0] * t, d[1] * t, d[2] * t);
    });
    const biome = sampler.biomeAt3D(cd[0], cd[1], cd[2]).label;
    const color = colorForCell(biome, th, p.seaLevel, p.heightScale, EARTH_PALETTE);
    const shade = 0.32 + 0.68 * Math.max(dot(cd, sun), 0);
    tiles.push({ depth: dot(cd, cam) * (radius + th), poly, color, shade });
  }
  tiles.sort((a, b) => a.depth - b.depth); // far first
  for (const t of tiles) fillPoly(buf, size, size, t.poly, t.color, t.shade);
  return { buf, size, stat };
}

// ---- infinite render (top-down, camera-following patch) ---------------------
function renderInfinite(p, { res = 1, size = 768, camX = 4200, camZ = -2600 } = {}) {
  const boardSize = 2048;
  const u = makeUniforms(p, boardSize);
  const sampler = new TerrainHeightSampler(u, () => ({ octaves: Math.round(p.octaves), infinite: true }), null);
  const STEP = [{ res: 5, rings: 10 }, { res: 6, rings: 14 }, { res: 7, rings: 18 }][Math.max(0, Math.min(2, res))];
  const upd = 1200, sun = sunDirection(p.sunAzimuth, p.sunElevation);
  const centerLat = Math.max(-89, Math.min(89, camZ / upd)), centerLng = Math.max(-179, Math.min(179, camX / upd));
  const buf = makeCanvas(size, size);
  const cells = diskCells(STEP.res, centerLat, centerLng, STEP.rings);
  // view window: world span fits the patch (rings × per-cell degree spacing × scale)
  const span = STEP.rings * (upd * (STEP.res === 5 ? 0.1246 : STEP.res === 6 ? 0.0462 : 0.0178)) * 1.15;
  const W2P = (x, z) => [((x - camX) / span * 0.5 + 0.5) * size, ((z - camZ) / span * 0.5 + 0.5) * size];
  const stat = { cells: 0, water: 0, hMin: Infinity, hMax: -Infinity, hSum: 0 };
  for (const h3 of cells) {
    const [clat, clng] = cellToLatLng(h3);
    const th = sampler.heightAt(clng * upd, clat * upd);
    const water = th <= p.seaLevel; stat.cells++; if (water) stat.water++;
    stat.hMin = Math.min(stat.hMin, th); stat.hMax = Math.max(stat.hMax, th); stat.hSum += th;
    const biome = sampler.biomeAt(clng * upd, clat * upd).label;
    const color = colorForCell(biome, th, p.seaLevel, p.heightScale, EARTH_PALETTE);
    const shade = 0.6 + 0.4 * Math.max(sun[1], 0);
    const ring = cellToBoundary(h3).map(([lat, lng]) => W2P(lng * upd, lat * upd));
    fillPoly(buf, size, size, ring, color, shade);
  }
  return { buf, size, stat };
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function logStat(name, s) {
  const mean = s.hSum / Math.max(s.drawn ?? s.cells, 1);
  console.log(`[${name}] cells=${s.cells}${s.drawn != null ? ` drawn=${s.drawn}` : ''} water=${s.water} (${(100 * s.water / Math.max(s.drawn ?? s.cells, 1)).toFixed(0)}%) ` +
    `h[min=${s.hMin.toFixed(0)} max=${s.hMax.toFixed(0)} mean=${mean.toFixed(0)}]`);
}

// ---- run --------------------------------------------------------------------
const OUT = new URL('../.claude/shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const p = { ...DEFAULTS };

const b0 = renderBoard(p, { res: 0 }); writePNG(OUT + 'h3-board-res0.png', b0.size, b0.size, b0.buf); logStat('board res0', b0.stat);
const b1 = renderBoard(p, { res: 1 }); writePNG(OUT + 'h3-board-res1.png', b1.size, b1.size, b1.buf); logStat('board res1', b1.stat);
const pl1 = renderPlanet(p, { res: 1 }); writePNG(OUT + 'h3-planet-res1.png', pl1.size, pl1.size, pl1.buf); logStat('planet res1', pl1.stat);
const pl2 = renderPlanet(p, { res: 2 }); writePNG(OUT + 'h3-planet-res2.png', pl2.size, pl2.size, pl2.buf); logStat('planet res2', pl2.stat);
const inf = renderInfinite(p, { res: 1 }); writePNG(OUT + 'h3-infinite-res1.png', inf.size, inf.size, inf.buf); logStat('infinite res1', inf.stat);
console.log('wrote PNGs to', OUT);
