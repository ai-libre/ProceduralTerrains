import * as THREE from 'three';

// ============================================================================
// UnderwaterEffect: camera-underwater post-processing pass.
//
// The project renders directly to the canvas (no composer), so this effect is
// self-contained and strictly opt-in per frame: while the camera is above the
// water surface the scene is rendered directly as before (zero extra cost).
// Only when the camera is at/below water level does the scene get rendered
// into an offscreen target (with depth) and composited through a fullscreen
// underwater shader.
//
// The underwater look is derived entirely from the live shared uniforms —
// uColShallow / uColDeep / uPaletteTint — so alien palettes produce alien
// underwater colors automatically. Nothing here touches the water material
// or the shared fog/terrain uniforms.
//
// Flicker safety: the activation is a smooth function of submersion depth
// (a ±blend band around the surface) followed by temporal smoothing, so
// there is no binary on/off threshold to oscillate across.
// ============================================================================

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

#include <packing>

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uStrength;       // 0 = dry, 1 = fully submerged
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform vec3  uWaterShallow;   // palette shallow water color (tinted)
uniform vec3  uWaterDeep;      // palette deep water color (tinted)
uniform float uSubmergeDepth;  // how far below the surface the camera is
uniform float uVisibility;     // underwater visibility distance (world units)
uniform float uIntensity;      // user master intensity

varying vec2 vUv;

float viewDistance(vec2 uv) {
  float fragZ = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(fragZ, uNear, uFar);
  return min(-viewZ, uFar);
}

void main() {
  float s = uStrength * uIntensity;

  // subtle screen-space wave distortion (scaled down near the surface)
  vec2 uv = vUv;
  float wob = s * 0.0035;
  uv.x += sin(vUv.y * 28.0 + uTime * 1.7) * wob;
  uv.y += cos(vUv.x * 23.0 - uTime * 1.3) * wob * 0.7;
  uv = clamp(uv, vec2(0.001), vec2(0.999));

  vec3 col = texture2D(tDiffuse, uv).rgb;

  // depth-based underwater fog: distant terrain dissolves into the water
  // color. Deeper camera = murkier, biased toward the deep palette color.
  float dist = viewDistance(uv);
  float murk = clamp(uSubmergeDepth / 45.0, 0.0, 1.0);
  vec3 waterCol = mix(uWaterShallow, uWaterDeep, 0.35 + 0.65 * murk);

  float density = (1.6 + murk * 1.4) / max(uVisibility, 10.0);
  float fogF = 1.0 - exp(-density * density * dist * dist);
  fogF = clamp(fogF, 0.0, 1.0);

  // light absorption: dim + shift everything toward the water color
  vec3 uw = col * (0.85 - 0.25 * murk);
  uw = mix(uw, uw * waterCol * 2.2, 0.35);

  // slight desaturation + reduced contrast (soft underwater light)
  float luma = dot(uw, vec3(0.299, 0.587, 0.114));
  uw = mix(uw, vec3(luma), 0.18);
  uw = mix(vec3(0.5 * (uWaterShallow + uWaterDeep) * 0.4 + 0.18), uw, 0.88);

  // fog last so the horizon fully closes into the water color
  uw = mix(uw, waterCol, fogF);

  // vignette
  float vig = smoothstep(1.25, 0.45, length(vUv - 0.5) * 1.6);
  uw *= mix(0.78, 1.0, vig);

  gl_FragColor = vec4(mix(col, uw, s), 1.0);
}
`;

export class UnderwaterEffect {
  constructor() {
    this.enabled = true;       // settings toggle (perf.underwaterEffect)
    this.intensity = 1.0;      // master strength multiplier
    this.visibility = 140;     // underwater view distance, world units
    this.blendBand = 0.8;      // world units around the surface to fade over
    this.strength = 0;         // smoothed activation 0..1

    this._rt = null;
    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tDiffuse:       { value: null },
        tDepth:         { value: null },
        uStrength:      { value: 0 },
        uTime:          { value: 0 },
        uNear:          { value: 0.5 },
        uFar:           { value: 80000 },
        uWaterShallow:  { value: new THREE.Vector3(0.1, 0.3, 0.4) },
        uWaterDeep:     { value: new THREE.Vector3(0.02, 0.08, 0.15) },
        uSubmergeDepth: { value: 0 },
        uVisibility:    { value: 140 },
        uIntensity:     { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // fullscreen triangle (avoids a diagonal seam, 1 less vertex than a quad)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,   3, -1, 0,   -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0,   2, 0,   0, 2,
    ]), 2));
    this._quadScene.add(new THREE.Mesh(geo, this._material));
  }

  get active() { return this.strength > 0.002; }

  /**
   * Advance the activation state. Call once per frame before render().
   * @param {number} dt           — frame delta seconds
   * @param {number} time         — shared shader time
   * @param {number} cameraY      — camera world height
   * @param {number|null} waterLevel — current sea level, or null if no water
   * @param {Object} sharedUniforms  — shared terrain/water uniforms (live palette)
   */
  update(dt, time, cameraY, waterLevel, sharedUniforms) {
    let target = 0;
    let submerge = 0;
    if (this.enabled && waterLevel !== null && Number.isFinite(waterLevel)) {
      submerge = waterLevel - cameraY;
      // smooth ramp across a band around the surface — no hard threshold,
      // so bobbing at the waterline cross-fades instead of flickering
      target = THREE.MathUtils.clamp(
        (submerge + this.blendBand * 0.5) / this.blendBand, 0, 1
      );
    }
    // temporal smoothing for any residual jumps (e.g. teleports)
    const k = 1 - Math.exp(-dt * 9);
    this.strength += (target - this.strength) * k;
    if (this.strength < 0.002 && target === 0) this.strength = 0;

    if (!this.active) return;

    const u = this._material.uniforms;
    u.uStrength.value = Math.min(this.strength, 1);
    u.uTime.value = time;
    u.uSubmergeDepth.value = Math.max(submerge, 0);
    u.uVisibility.value = this.visibility;
    u.uIntensity.value = this.intensity;

    // live palette → underwater colors (alien water = alien underwater)
    const tint = sharedUniforms.uPaletteTint.value;
    const sh = sharedUniforms.uColShallow.value;
    const dp = sharedUniforms.uColDeep.value;
    u.uWaterShallow.value.set(sh.x * tint.x, sh.y * tint.y, sh.z * tint.z);
    u.uWaterDeep.value.set(dp.x * tint.x, dp.y * tint.y, dp.z * tint.z);
  }

  /**
   * Render the scene — directly when dry, through the underwater pass when
   * submerged. Drop-in replacement for renderer.render(scene, camera).
   */
  render(renderer, scene, camera) {
    if (!this.active) {
      renderer.render(scene, camera);
      return;
    }

    this._ensureTarget(renderer);

    const u = this._material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;

    renderer.setRenderTarget(this._rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    u.tDiffuse.value = this._rt.texture;
    u.tDepth.value = this._rt.depthTexture;
    renderer.render(this._quadScene, this._quadCam);
  }

  _ensureTarget(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    if (this._rt && this._rt.width === w && this._rt.height === h) return;

    if (this._rt) this._rt.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedInt248Type;
    depthTexture.format = THREE.DepthStencilFormat;
    // no MSAA: with samples > 0, three (r160) resolves depth into a
    // renderbuffer, leaving the sampled depth texture unpopulated. The
    // underwater image is fogged + distorted, so aliasing is not visible.
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      depthTexture,
      depthBuffer: true,
      stencilBuffer: true,
    });
  }

  dispose() {
    if (this._rt) { this._rt.dispose(); this._rt = null; }
    this._material.dispose();
    this._quadScene.children.forEach((m) => m.geometry?.dispose());
  }
}
