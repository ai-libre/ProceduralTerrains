import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';

// ============================================================================
// Terrain shader. Everything happens on the GPU:
//  - vertex: world XZ -> procedural height, skirt drop on chunk borders
//  - fragment: finite-difference procedural normals, biome color from
//    height / slope / moisture / detail noise, sun + hemisphere lighting,
//    cavity AO, chunk grid overlay, LOD debug tint, exp2 fog.
// ============================================================================

const VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${HEIGHT_GLSL}

uniform float uSkirtDepth;

attribute float aSkirt;   // 1 on skirt ring vertices, 0 elsewhere
attribute float aLod;     // constant per geometry: LOD index of this mesh

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = heightAt(wp.xz);
  wp.y = h - aSkirt * uSkirtDepth;

  vWorldPos = wp.xyz;
  vLod = aLod;
  vSkirt = aSkirt;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${HEIGHT_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uSnowLine;     // fraction of uHeightScale where snow starts
uniform float uGrid;         // chunk grid overlay strength (0 = off)
uniform float uLodDebug;     // 1 = tint chunks by LOD level
uniform float uColorMode;    // 0 = shaded, 1 = raw heightmap (for export)
uniform float uEps;          // finite-difference epsilon in world units

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

// ------- biome palette (linear-ish space) -------
const vec3 C_DEEP     = vec3(0.012, 0.075, 0.140);
const vec3 C_SHALLOW  = vec3(0.060, 0.290, 0.330);
const vec3 C_SAND     = vec3(0.560, 0.470, 0.300);
const vec3 C_DUNE     = vec3(0.620, 0.490, 0.290);
const vec3 C_DRYGRASS = vec3(0.380, 0.330, 0.150);
const vec3 C_GRASS    = vec3(0.130, 0.260, 0.085);
const vec3 C_FOREST   = vec3(0.052, 0.140, 0.055);
const vec3 C_JUNGLE   = vec3(0.035, 0.125, 0.045);
const vec3 C_SWAMP    = vec3(0.090, 0.130, 0.070);
const vec3 C_TUNDRA   = vec3(0.300, 0.290, 0.240);
const vec3 C_REDROCK  = vec3(0.420, 0.235, 0.140);
const vec3 C_REDROCK2 = vec3(0.560, 0.370, 0.210);
const vec3 C_ROCK     = vec3(0.260, 0.235, 0.215);
const vec3 C_ROCK_HI  = vec3(0.380, 0.365, 0.355);
const vec3 C_SNOW     = vec3(0.870, 0.890, 0.930);

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

void main() {
  vec2 xz = vWorldPos.xz;

  // --- climate sampled ONCE per fragment, reused for all height taps ---
  Climate cl = climateAt(xz * uFrequency + uSeedOffset);
  BiomeWeights bw = biomeWeightsAt(cl);

  // --- procedural normal: finite differences of the analytic height field ---
  float eps = uEps;
  float hC = shapeHeight(xz, cl);
  float hX = shapeHeight(xz + vec2(eps, 0.0), cl);
  float hZ = shapeHeight(xz + vec2(0.0, eps), cl);

  // heightmap export mode: emit normalized height and stop
  if (uColorMode > 0.5) {
    gl_FragColor = vec4(vec3(clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0)), 1.0);
    return;
  }

  vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
  vec3 n = normalize(vec3(nGeo.x * uNormalStrength, 1.0, nGeo.z * uNormalStrength));

  float slope = 1.0 - nGeo.y;                 // biome slope from neutral normal
  float hRel = hC - uSeaLevel;                // height above sea, world units
  float h01 = hC / max(uHeightScale, 1e-3);

  // --- biome debug view: flat region colors with simple shading ---
  if (uBiomeDebug > 0.5) {
    vec3 dbg = vec3(0.20, 0.50, 0.25);                       // temperate default
    dbg = mix(dbg, vec3(0.93, 0.79, 0.30), bw.desert);
    dbg = mix(dbg, vec3(0.80, 0.35, 0.15), bw.canyon);
    dbg = mix(dbg, vec3(0.15, 0.35, 0.80), bw.wetland);
    dbg = mix(dbg, vec3(0.62, 0.62, 0.68), bw.mountains * smoothstep(0.3, 0.6, h01));
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  // effective temperature: climate minus altitude lapse (peaks are cold)
  float tempEff = clamp(cl.temp - h01 * 0.55, 0.0, 1.0);

  // threshold jitter so biome borders are organic, not contour lines
  float jitter = (cl.region - 0.5) * 0.8 + (vnoise(xz * 0.045 + uSeedOffset) - 0.5) * 0.6;
  float detail = vnoise(xz * 0.35 + uSeedOffset.yx);
  float veg = vegetationDensity(cl, h01, slope);

  // --- Whittaker-style lowland color: moisture axis within temp bands ---
  vec3 hotBand = mix(C_DUNE,
    mix(C_DRYGRASS, C_JUNGLE, smoothstep(0.45, 0.75, cl.moist)),
    smoothstep(0.20, 0.50, cl.moist));
  vec3 midBand = mix(C_DRYGRASS,
    mix(C_GRASS, C_FOREST, veg * (0.5 + 0.5 * smoothstep(0.35, 0.65, detail))),
    smoothstep(0.22, 0.52, cl.moist));
  vec3 coldBand = mix(C_TUNDRA, mix(C_TUNDRA, C_FOREST * 0.85, veg),
    smoothstep(0.30, 0.60, cl.moist));

  float jt = jitter * 0.06;
  vec3 lowland = mix(coldBand, midBand, smoothstep(0.20, 0.38, tempEff + jt));
  lowland = mix(lowland, hotBand, smoothstep(0.55, 0.72, tempEff + jt));

  // wetlands: dark saturated marsh ground
  lowland = mix(lowland, C_SWAMP, bw.wetland * 0.8);

  // beach sand near sea level — wide in hot/dry climates, absent in marshes
  float sandBand = (mix(3.0, 9.0, smoothstep(0.30, 0.70, tempEff)) + jitter * 4.0)
                 * (1.0 - bw.wetland * 0.85);
  vec3 albedo = mix(C_SAND, lowland, smoothstep(sandBand * 0.4, max(sandBand, 0.3), hRel));

  // canyon/badlands: banded red-rock strata matching the terrace steps
  float band = fract(h01 * 14.0 + detail * 0.15);
  vec3 canyonCol = mix(C_REDROCK, C_REDROCK2, smoothstep(0.25, 0.75, band));
  albedo = mix(albedo, canyonCol, bw.canyon * smoothstep(1.0, 6.0, hRel));

  // highlands fade toward rock as altitude climbs (deserts keep their sand)
  float highBlend = smoothstep(0.30, 0.62, h01 + jitter * 0.08);
  albedo = mix(albedo, C_ROCK_HI, highBlend * 0.65 * (1.0 - bw.desert * 0.7));

  // steep slopes are rock regardless of altitude — red rock in canyon country
  float rockBlend = smoothstep(0.42, 0.72, slope + jitter * 0.06);
  vec3 slopeRock = mix(mix(C_ROCK, C_ROCK_HI, detail), C_REDROCK, bw.canyon * 0.8);
  albedo = mix(albedo, slopeRock, rockBlend);

  // snow: line is altitude AND temperature driven — cold regions snow low,
  // hot regions never; flat polar ground snows at any altitude
  float snowLine01 = uSnowLine * (0.40 + 1.20 * cl.temp);
  float flatness = smoothstep(0.62, 0.30, slope);
  float snow = smoothstep(snowLine01 - 0.03, snowLine01 + 0.05, h01 + jitter * 0.04) * flatness;
  snow = max(snow, smoothstep(0.10, 0.02, tempEff) * smoothstep(0.50, 0.25, slope));
  snow *= 1.0 - bw.desert;
  albedo = mix(albedo, C_SNOW, snow);

  // underwater tinting (sea floor seen through the water plane)
  if (hRel < 0.0) {
    float depth = clamp(-hRel / 55.0, 0.0, 1.0);
    vec3 floorCol = mix(mix(C_SAND, C_SWAMP, bw.wetland * 0.7) * 0.65, C_DEEP, depth);
    albedo = mix(albedo, floorCol, 0.92);
  }

  // micro albedo variation — material feel per biome: dunes read smooth,
  // rock and badlands read gritty, marshes read flat and even
  float micro = mix(0.20, 0.06, max(bw.desert * (1.0 - rockBlend), bw.wetland * 0.8));
  micro = mix(micro, 0.30, max(rockBlend * 0.6, bw.canyon * 0.4));
  albedo *= (1.0 - micro * 0.5) + micro * vnoise(xz * 0.9);

  // --- cavity / valley ambient occlusion ---
  float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);

  // --- lighting ---
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sunCol = vec3(1.00, 0.94, 0.82) * 1.25;
  vec3 skyAmb = vec3(0.36, 0.46, 0.62) * 0.50 * (n.y * 0.5 + 0.5);
  vec3 bounce = vec3(0.20, 0.16, 0.11) * 0.25 * (1.0 - n.y * 0.5);
  vec3 col = albedo * (sunCol * diff + skyAmb + bounce) * ao;

  // snow sparkle / wet sand sheen / marsh water sheen via cheap specular
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 32.0);
  float shoreSheen = 1.0 - smoothstep(0.0, max(sandBand, 0.5), abs(hRel));
  col += spec * (snow * 0.30 + shoreSheen * 0.10 + bw.wetland * flatness * 0.15);

  // --- chunk grid overlay ---
  if (uGrid > 0.001) {
    vec2 gw = fwidth(xz) + 1e-5;
    vec2 gp = abs(fract(xz / uChunkSize - 0.5) - 0.5) * uChunkSize / gw;
    float line = 1.0 - min(min(gp.x, gp.y), 1.0);
    float gridFade = smoothstep(420.0, 60.0, length(cameraPosition - vWorldPos) / 8.0);
    col = mix(col, vec3(0.45, 0.80, 0.95), line * uGrid * 0.22 * (0.35 + 0.65 * gridFade));
  }

  // --- LOD debug tint ---
  if (uLodDebug > 0.5) {
    int li = int(clamp(vLod, 0.0, 3.0) + 0.5);
    col = mix(col, LOD_COLORS[li], 0.55);
  }

  // skirt walls: darken so they read as a clean board cross-section
  col *= 1.0 - vSkirt * 0.55;

  // --- exp2 fog + gamma ---
  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainUniforms() {
  return {
    uSeedOffset:     { value: new THREE.Vector2(0, 0) },
    uFrequency:      { value: 0.002 },
    uHeightScale:    { value: 420 },
    uSeaLevel:       { value: 42 },
    uAmplitude:      { value: 1.0 },
    uPersistence:    { value: 0.5 },
    uLacunarity:     { value: 2.05 },
    uRidge:          { value: 0.65 },
    uWarp:           { value: 0.9 },
    uFalloff:        { value: 0.5 },
    uBoardHalf:      { value: 1024 },
    uChunkSize:      { value: 128 },
    uMoistScale:     { value: 1.0 },
    uMoistBias:      { value: 0.0 },
    uBiomeScale:     { value: 1.0 },
    uTempBias:       { value: 0.0 },
    uBiomeDebug:     { value: 0.0 },
    uSnowLine:       { value: 0.7 },
    uNormalStrength: { value: 1.25 },
    uAO:             { value: 0.75 },
    uGrid:           { value: 1.0 },
    uLodDebug:       { value: 0.0 },
    uColorMode:      { value: 0.0 },
    uEps:            { value: 0.6 },
    uSkirtDepth:     { value: 40 },
    uSunDir:         { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
    uFogColor:       { value: new THREE.Color(0x0b0e14) },
    uFogDensity:     { value: 0.000045 },
    uTime:           { value: 0 },
  };
}

export function createTerrainMaterial(uniforms, octaves = 7) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
}

// Infinite mode variant: same shader but with INFINITE_MODE defined,
// which skips the island-edge falloff so terrain continues forever.
export function createInfiniteTerrainMaterial(uniforms, octaves = 7) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
}
