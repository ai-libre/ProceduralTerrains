// ============================================================================
// H3 hex-tile verification + perf timing. Drives the REAL HexTileLayer (with a
// stub scene) and the real CPU samplers, then checks geometry validity and
// reports build time + triangle counts per mode/resolution. Pure Node — no GL.
//   Run: node tools/h3verify.mjs
// ============================================================================

import { performance } from 'node:perf_hooks';
import { TerrainHeightSampler } from '../src/engine/terrain/TerrainHeightSampler.js';
import { PlanetHeightSampler } from '../src/engine/terrain/PlanetHeightSampler.js';
import { HexTileLayer } from '../src/engine/h3/HexTileLayer.js';

function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const V = (x) => ({ value: x });
function makeUniforms(p, boardSize) {
  const rng = mulberry32(p.seed >>> 0);
  return {
    uSeedOffset: V({ x: rng() * 2048 - 1024, y: rng() * 2048 - 1024 }),
    uFrequency: V((p.noiseScale * 0.1) / boardSize), uHeightScale: V(p.heightScale), uSeaLevel: V(p.seaLevel),
    uAmplitude: V(p.noiseStrength), uPersistence: V(p.persistence), uLacunarity: V(p.lacunarity), uRidge: V(p.ridge),
    uWarp: V(p.warp), uFalloff: V(p.falloff), uBoardHalf: V(boardSize / 2), uMoistScale: V(p.moistScale),
    uMoistBias: V(p.moistBias), uBiomeScale: V(p.biomeScale), uTempBias: V(p.tempBias), uPlanetRadius: V(p.planetRadius),
  };
}
const P = {
  seed: 1337, heightScale: 560, seaLevel: 100, noiseScale: 45, noiseStrength: 1, octaves: 7,
  persistence: 0.5, lacunarity: 2.05, ridge: 0.65, warp: 0.9, falloff: 0.2,
  moistScale: 1, moistBias: 0, biomeScale: 1, tempBias: 0, planetRadius: 16000, sunAzimuth: 135, sunElevation: 42,
};
const boardSize = 2048;
const u = makeUniforms(P, boardSize);
const planetSampler = new PlanetHeightSampler(u, () => ({ octaves: 7 }), null);
const boardSampler = new TerrainHeightSampler(u, () => ({ octaves: 7, infinite: false }), null);
const infSampler = new TerrainHeightSampler(u, () => ({ octaves: 7, infinite: true }), null);

const stubScene = { add() {}, remove() {} };

let fails = 0;
function check(name, cond, detail = '') { if (!cond) { fails++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name} ${detail}`); }

function validate(label, layer, expectMinCells) {
  const geo = layer.mesh?.geometry;
  check(`${label}: mesh built`, !!geo);
  if (!geo) return;
  const pos = geo.getAttribute('position').array;
  const col = geo.getAttribute('color').array;
  let finite = true, colOk = true;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { finite = false; break; }
  for (let i = 0; i < col.length; i++) if (!(col[i] >= 0 && col[i] <= 4)) { colOk = false; break; }
  const tris = pos.length / 9;
  check(`${label}: positions finite`, finite);
  check(`${label}: colors in range`, colOk);
  check(`${label}: cellCount ≥ ${expectMinCells}`, layer.cellCount >= expectMinCells, `(got ${layer.cellCount})`);
  check(`${label}: 3 verts / tri`, pos.length % 9 === 0, `(tris=${tris})`);
  return tris;
}

function time(fn) { const t0 = performance.now(); fn(); return performance.now() - t0; }

console.log('H3 hex-tile verification\n');

console.log('PLANET');
for (const res of [0, 1, 2]) {
  const layer = new HexTileLayer(stubScene);
  const ms = time(() => layer.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: res, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: res + 1 }));
  const tris = validate(`planet res${res}`, layer, res === 0 ? 120 : res === 1 ? 800 : 5000);
  console.log(`  → build ${ms.toFixed(1)}ms · ${tris} tris\n`);
  layer.dispose();
}

console.log('BOARD');
for (const res of [0, 1, 2]) {
  const layer = new HexTileLayer(stubScene);
  const ms = time(() => layer.buildBoard({ sampler: boardSampler, boardSize, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: res, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: res + 1 }));
  const tris = validate(`board res${res}`, layer, res === 0 ? 300 : res === 1 ? 2000 : 14000);
  console.log(`  → build ${ms.toFixed(1)}ms · ${tris} tris\n`);
  layer.dispose();
}

console.log('INFINITE');
for (const res of [0, 1, 2]) {
  const layer = new HexTileLayer(stubScene);
  const ms = time(() => layer.buildInfinite({ sampler: infSampler, cameraX: 4200, cameraZ: -2600, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: res, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: res + 1 }));
  const tris = validate(`infinite res${res}`, layer, res === 0 ? 300 : res === 1 ? 600 : 1000);
  console.log(`  → build ${ms.toFixed(1)}ms · ${tris} tris\n`);
  layer.dispose();
}

// ---- LOD: adaptive vs uniform ----------------------------------------------
console.log('LOD (adaptive vs uniform; same near resolution)');
function trisOf(layer) { return layer.mesh ? layer.mesh.geometry.getAttribute('position').count / 3 : 0; }
const camDist = P.planetRadius * 2.2;
const camPos = [0.45 * camDist, 0.35 * camDist, 1.0 * camDist];
for (const res of [1, 2, 3]) {
  const uni = new HexTileLayer(stubScene);
  uni.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: res, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 100 + res });
  const uniT = trisOf(uni); uni.dispose();
  const lod = new HexTileLayer(stubScene);
  const ms = time(() => lod.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: res, lod: true, cameraPos: camPos, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 100 + res }));
  const lodT = validate(`planet res${res} LOD`, lod, 40);
  console.log(`  planet res${res}: uniform ${uniT} → LOD ${lodT} tris (${(100 * lodT / uniT).toFixed(0)}%) · build ${ms.toFixed(1)}ms\n`);
  lod.dispose();
}
{
  const uni = new HexTileLayer(stubScene);
  uni.buildBoard({ sampler: boardSampler, boardSize, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 2, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 200 });
  const uniT = trisOf(uni); uni.dispose();
  const lod = new HexTileLayer(stubScene);
  const ms = time(() => lod.buildBoard({ sampler: boardSampler, boardSize, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 2, lod: true, cameraX: 300, cameraZ: 300, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 200 }));
  const lodT = validate('board res2 LOD', lod, 100);
  console.log(`  board res2: uniform ${uniT} → LOD ${lodT} tris (${(100 * lodT / uniT).toFixed(0)}%) · build ${ms.toFixed(1)}ms\n`);
  lod.dispose();
}
{
  const uni = new HexTileLayer(stubScene);
  uni.buildInfinite({ sampler: infSampler, cameraX: 4200, cameraZ: -2600, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 2, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 300 });
  const uniT = trisOf(uni); uni.dispose();
  const lod = new HexTileLayer(stubScene);
  const ms = time(() => lod.buildInfinite({ sampler: infSampler, cameraX: 4200, cameraZ: -2600, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 2, lod: true, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 300 }));
  const lodT = validate('infinite res2 LOD', lod, 100);
  console.log(`  infinite res2: uniform ${uniT} → LOD ${lodT} tris (${(100 * lodT / uniT).toFixed(0)}%) · build ${ms.toFixed(1)}ms\n`);
  lod.dispose();
}

// signature guard: a 2nd build with identical inputs must NOT rebuild
const l = new HexTileLayer(stubScene);
l.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 1, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 5 });
const g1 = l.mesh.geometry;
l.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 1, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 5 });
check('signature guard skips identical rebuild', l.mesh.geometry === g1);
l.dispose();

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
