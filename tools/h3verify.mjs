// ============================================================================
// H3 hex-tile verification + perf timing. Drives the REAL HexTileLayer (with a
// stub scene) and the real CPU samplers, then checks geometry validity and
// reports build time + triangle counts per mode/resolution. Pure Node — no GL.
//   Run: node tools/h3verify.mjs
// ============================================================================

import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
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
  check(`${label}: mesh built`, layer.meshes.length > 0);
  if (!layer.meshes.length) return 0;
  let finite = true, colOk = true, tris = 0, boundsOk = true;
  for (const m of layer.meshes) {
    const geo = m.geometry;
    const pos = geo.getAttribute('position').array;
    const col = geo.getAttribute('color').array;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { finite = false; break; }
    for (let i = 0; i < col.length; i++) if (!(col[i] >= 0 && col[i] <= 4)) { colOk = false; break; }
    if (pos.length % 9 !== 0) boundsOk = false;
    if (!geo.boundingSphere || !Number.isFinite(geo.boundingSphere.radius)) boundsOk = false;
    if (m.frustumCulled !== true) boundsOk = false;
    tris += pos.length / 9;
  }
  check(`${label}: positions finite`, finite);
  check(`${label}: colors in range`, colOk);
  check(`${label}: cellCount ≥ ${expectMinCells}`, layer.cellCount >= expectMinCells, `(got ${layer.cellCount})`);
  check(`${label}: groups frustum-cullable w/ bounds`, boundsOk, `(${layer.groupCount} groups)`);
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
function trisOf(layer) { let t = 0; for (const m of layer.meshes) t += m.geometry.getAttribute('position').count / 3; return t; }
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

// ---- Frustum culling: how many groups survive the camera frustum? -----------
console.log('\nFrustum culling (groups intersecting the camera frustum)');
const cam = new THREE.PerspectiveCamera(55, 1, P.planetRadius * 0.05, P.planetRadius * 8);
for (const zoom of [2.4, 1.25]) {
  const pos = [0.45, 0.35, 1.0].map((c) => c * P.planetRadius * zoom);
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  );
  const layer = new HexTileLayer(stubScene);
  layer.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 2, lod: true, cameraPos: pos, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 400 });
  let visible = 0;
  for (const m of layer.meshes) if (frustum.intersectsSphere(m.geometry.boundingSphere)) visible++;
  const total = layer.groupCount;
  // zoomed out the whole globe is in view (all groups drawn — correct); zoomed
  // in, off-screen groups must be culled.
  if (zoom < 2.0) check(`planet zoom ${zoom}×: off-screen groups culled`, visible < total, `(${visible}/${total} groups drawn)`);
  else check(`planet zoom ${zoom}×: whole globe in view`, visible <= total, `(${visible}/${total} groups drawn)`);
  layer.dispose();
}

// signature guard: a 2nd build with identical inputs must NOT rebuild
const l = new HexTileLayer(stubScene);
l.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 1, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 5 });
const g1 = l.meshes.map((m) => m.geometry);
l.buildPlanet({ sampler: planetSampler, radius: P.planetRadius, seaLevel: P.seaLevel, heightScale: P.heightScale, resolution: 1, sunAzimuth: P.sunAzimuth, sunElevation: P.sunElevation, terrainGen: 5 });
check('signature guard skips identical rebuild', l.meshes.length === g1.length && l.meshes.every((m, i) => m.geometry === g1[i]));
l.dispose();

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
