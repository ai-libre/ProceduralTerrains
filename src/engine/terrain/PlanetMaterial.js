import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PLANET_UNIFORMS_GLSL, PLANET_NOISE_GLSL, PLANET_HEIGHT_GLSL,
} from './planetGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';

// ============================================================================
// Planet (cube-sphere) terrain shader. Shares the terrain uniform objects so
// every style / palette / noise tweak applies in all modes.
//  - vertex: chunk grid local position -> unit cube point (via per-chunk face
//    basis) -> normalize() -> radial displacement by heightAt3D(dir); border
//    skirt vertices drop radially inward to hide LOD cracks.
//  - fragment: analytic tangent-frame normal from heightAt3D, biome color from
//    the shared palette, spherical-up lighting, exp2 fog.
// ============================================================================

const VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${PLANET_HEIGHT_GLSL}

uniform float uSkirtDepth;

// Per-chunk cube-face mapping: a local grid point (position.xz in [0,1])
// becomes  uFaceOrigin + position.x*uFaceU + position.z*uFaceV  on the unit
// cube, which is then projected to the sphere.
uniform vec3 uFaceOrigin;
uniform vec3 uFaceU;
uniform vec3 uFaceV;

attribute float aSkirt;
attribute float aLod;

varying vec3  vDir;
varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

void main() {
  vec3 cube = uFaceOrigin + position.x * uFaceU + position.z * uFaceV;
  vec3 dir = normalize(cube);

  float h = heightAt3D(dir);
  float r = uPlanetRadius + h - aSkirt * uSkirtDepth;
  vec3 wp = dir * r;

  vDir = dir;
  vWorldPos = wp;
  vLod = aLod;
  vSkirt = aSkirt;

  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${PLANET_HEIGHT_GLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uLodDebug;

varying vec3  vDir;
varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

void main() {
  vec3 dir = normalize(vDir);

  // tangent basis around dir for analytic normals + finite differences
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);

  float eps = uPlanetEps;
  vec3 dA = normalize(dir + t1 * eps);
  vec3 dB = normalize(dir + t2 * eps);

  float hC = heightAt3D(dir);
  float hA = heightAt3D(dA);
  float hB = heightAt3D(dB);

  vec3 pC = dir * (uPlanetRadius + hC);
  vec3 pA = dA  * (uPlanetRadius + hA);
  vec3 pB = dB  * (uPlanetRadius + hB);

  vec3 nGeo = normalize(cross(pA - pC, pB - pC));
  if (dot(nGeo, dir) < 0.0) nGeo = -nGeo;

  // normal-strength tweak: lean the geometric normal toward/away from up
  float up = clamp(dot(nGeo, dir), 0.0, 1.0);
  vec3 n = normalize(mix(dir, nGeo, uNormalStrength));

  Climate cl = planetClimateAt(dir);
  BiomeWeights bw = biomeWeightsAt(cl);

  float slope = 1.0 - up;
  float hRel = hC - uSeaLevel;
  float h01 = hC / max(uHeightScale, 1e-3);

  // a stable-ish 2D coordinate for the color micro-detail noise
  vec2 colXZ = vWorldPos.xz + vWorldPos.y * vec2(0.37, -0.21);

  if (uBiomeDebug > 0.5) {
    vec3 dbg = terrainBiomeDebugColor(bw, h01);
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float jitter = (cl.region - 0.5) * 0.8 + (vnoise(colXZ * 0.045 + uSeedOffset) - 0.5) * 0.6;
  float detail = vnoise(colXZ * 0.35 + uSeedOffset.yx);

  TerrainColorResult tc = computeTerrainAlbedo(colXZ, cl, bw, hC, hRel, h01, slope, detail, jitter);

  // ambient occlusion from local concavity + low-altitude valleys
  float concave = clamp(((hA + hB) * 0.5 - hC) / (uHeightScale * 0.02 + 1.0), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);

  // spherical-up lighting (hemisphere term uses planet up = dir, not world +Y)
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity;
  vec3 skyAmb = uTerrainSkyAmb * 0.50 * (up * 0.5 + 0.5);
  vec3 bounce = uTerrainBounce * 0.25 * (1.0 - up * 0.5);
  vec3 col = tc.albedo * (sunCol * diff + skyAmb + bounce) * ao;

  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 32.0);
  float shoreSheen = 1.0 - smoothstep(0.0, max(tc.sandBand, 0.5), abs(hRel));
  col += spec * (tc.snow * 0.30 + shoreSheen * 0.10 + bw.wetland * tc.flatness * 0.15);

  if (uLodDebug > 0.5) {
    int li = int(clamp(vLod, 0.0, 3.0) + 0.5);
    col = mix(col, LOD_COLORS[li], 0.55);
  }

  col *= 1.0 - vSkirt * 0.55;

  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeFaceUniforms() {
  return {
    uFaceOrigin: { value: new THREE.Vector3(-1, -1, 1) },
    uFaceU:      { value: new THREE.Vector3(2, 0, 0) },
    uFaceV:      { value: new THREE.Vector3(0, 2, 0) },
  };
}

export function createPlanetMaterial(uniforms, octaves = 7) {
  // Per-chunk face uniforms must NOT be shared — clone fresh ones, merged with
  // the shared terrain/palette uniform objects.
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...makeFaceUniforms() },
    defines: { OCTAVES: octaves, PLANET_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // analytic outward normal is computed in the shader, so two-sided shading
    // stays correct; matches the studio/infinite terrain materials.
    side: THREE.DoubleSide,
  });
}
