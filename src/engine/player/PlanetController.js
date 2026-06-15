import * as THREE from 'three';
import { DEFAULT_PLAYER_CONFIG } from './PlayerConfig.js';

// ============================================================================
// First-person spherical-gravity walker for Planet mode.
//
// "Up" is the local surface normal (radial from the planet center), gravity
// pulls toward the center, and movement happens in the tangent plane. The
// camera basis is rebuilt every frame from the local up so the horizon stays
// level as the player walks around the globe. Ground height comes from
// PlanetHeightSampler (the CPU twin of the planet GLSL), so there are no mesh
// raycasts and no chunk-border seams.
//
// Self-contained input (pointer lock + mouse look + keys) — it does not use
// FPSControls, whose yaw/pitch are world-axis based and would fight the
// moving tangent frame.
//
// Keys: Z/W forward · S back · Q/A left · D right · Shift run · Space jump
// ============================================================================

const PITCH_LIMIT = 88 * Math.PI / 180;

export class PlanetController {
  /**
   * @param {object} opts
   * @param {THREE.Camera} opts.camera
   * @param {HTMLElement} opts.domElement
   * @param {PlanetHeightSampler} opts.sampler
   * @param {object} [opts.config]
   */
  constructor({ camera, domElement, sampler, config = {} }) {
    this.camera = camera;
    this.dom = domElement;
    this.sampler = sampler;
    this.cfg = { ...DEFAULT_PLAYER_CONFIG, ...config };

    // feet position: snap onto the surface beneath the current camera
    const up = camera.position.clone().normalize();
    if (!isFinite(up.x) || up.lengthSq() < 0.5) up.set(0, 1, 0);
    const r = this.sampler.surfaceRadius(up.x, up.y, up.z);
    this.pos = up.clone().multiplyScalar(r);
    this.vel = new THREE.Vector3();
    this.up = up.clone();

    // heading (tangent forward) + look pitch
    this.forward = new THREE.Vector3();
    this._initForward();
    this.pitch = 0;
    this.speedMultiplier = 1;
    this.state = 'grounded';

    this._coyote = 0;
    this._jumpBuf = 0;
    this._jumpHeld = false;

    this._keys = new Set();
    this._locked = false;
    this.mouseSensitivity = 0.0018;

    this._onClick = () => { if (!this._locked) this.dom.requestPointerLock(); };
    this._onLockChange = () => {
      this._locked = document.pointerLockElement === this.dom;
      if (!this._locked) this._keys.clear();
    };
    this._onMouseMove = (e) => this._mouse(e);
    this._onKeyDown = (e) => { if (this._locked) this._keys.add(e.code); };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    this._onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.speedMultiplier = Math.min(this.cfg.maxSpeedMultiplier,
        Math.max(this.cfg.minSpeedMultiplier, this.speedMultiplier * factor));
    };

    this.dom.addEventListener('click', this._onClick);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);

    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._syncCamera();
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this._keys.clear();
  }

  get isLocked() { return this._locked; }
  get keys() { return this._keys; }

  _initForward() {
    // pick a world axis not parallel to up, project onto the tangent plane
    const ref = Math.abs(this.up.y) < 0.95
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    this.forward.copy(ref).addScaledVector(this.up, -ref.dot(this.up)).normalize();
  }

  _mouse(e) {
    if (!this._locked) return;
    // yaw: rotate the heading around the local up
    this._q.setFromAxisAngle(this.up, -e.movementX * this.mouseSensitivity);
    this.forward.applyQuaternion(this._q).normalize();
    // pitch: look up / down
    this.pitch -= e.movementY * this.mouseSensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  update(dt) {
    const cfg = this.cfg;
    const keys = this._keys;

    // local frame
    this.up.copy(this.pos).normalize();
    // keep heading tangent as up drifts
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up));
    if (this.forward.lengthSq() < 1e-6) this._initForward();
    else this.forward.normalize();
    const right = this._tmp.copy(this.forward).cross(this.up).normalize(); // tangent right

    // --- wish direction (tangent) ---
    let wx = 0, wy = 0, wz = 0;
    if (this._locked) {
      if (keys.has('KeyW') || keys.has('KeyZ')) { wx += this.forward.x; wy += this.forward.y; wz += this.forward.z; }
      if (keys.has('KeyS')) { wx -= this.forward.x; wy -= this.forward.y; wz -= this.forward.z; }
      if (keys.has('KeyD')) { wx += right.x; wy += right.y; wz += right.z; }
      if (keys.has('KeyA') || keys.has('KeyQ')) { wx -= right.x; wy -= right.y; wz -= right.z; }
    }
    const wl = Math.hypot(wx, wy, wz);
    if (wl > 1e-6) { wx /= wl; wy /= wl; wz /= wl; }

    const running = this._locked && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    const jumpKey = this._locked && keys.has('Space');
    if (jumpKey && !this._jumpHeld) this._jumpBuf = cfg.jumpBufferTime;
    else this._jumpBuf = Math.max(0, this._jumpBuf - dt);
    this._jumpHeld = jumpKey;

    // --- ground + grounded test ---
    const rGround = this.sampler.surfaceRadius(this.up.x, this.up.y, this.up.z);
    const altitude = this.pos.length() - rGround;
    const grounded = altitude <= 0.05 && this.vel.dot(this.up) <= 0.5;
    if (grounded) this._coyote = cfg.coyoteTime;
    else this._coyote = Math.max(0, this._coyote - dt);

    // --- split velocity into radial (gravity/jump) + tangential (movement) ---
    let radial = this.vel.dot(this.up);
    // tangential velocity vector
    const tvx = this.vel.x - this.up.x * radial;
    const tvy = this.vel.y - this.up.y * radial;
    const tvz = this.vel.z - this.up.z * radial;

    const targetSpeed = (running ? cfg.runSpeed : cfg.walkSpeed) * this.speedMultiplier;
    const tgx = wx * targetSpeed, tgy = wy * targetSpeed, tgz = wz * targetSpeed;
    const hasInput = wl > 1e-6;
    let accel = hasInput
      ? (running ? cfg.runAcceleration : cfg.acceleration)
      : cfg.deceleration;
    if (!grounded) accel *= cfg.airControl;
    const blend = 1 - Math.exp(-accel / Math.max(targetSpeed, 1) * dt);
    const ntx = tvx + (tgx - tvx) * blend;
    const nty = tvy + (tgy - tvy) * blend;
    const ntz = tvz + (tgz - tvz) * blend;

    // jump
    if (this._jumpBuf > 0 && this._coyote > 0) {
      radial = cfg.jumpVelocity;
      this._jumpBuf = 0;
      this._coyote = 0;
    }
    // gravity
    radial -= cfg.gravity * dt;
    if (radial < -cfg.terminalVelocity) radial = -cfg.terminalVelocity;

    // recombine
    this.vel.set(
      ntx + this.up.x * radial,
      nty + this.up.y * radial,
      ntz + this.up.z * radial
    );

    // integrate
    this.pos.addScaledVector(this.vel, dt);

    // --- collide with the surface at the new position ---
    this.up.copy(this.pos).normalize();
    const rNow = this.sampler.surfaceRadius(this.up.x, this.up.y, this.up.z);
    const lenNow = this.pos.length();
    if (lenNow <= rNow) {
      this.pos.copy(this.up).multiplyScalar(rNow);
      const vr = this.vel.dot(this.up);
      if (vr < 0) this.vel.addScaledVector(this.up, -vr); // cancel inward
    } else if (grounded && lenNow - rNow <= cfg.groundSnapDistance && this.vel.dot(this.up) <= 0.01) {
      // stick to the ground over small downhill steps
      this.pos.copy(this.up).multiplyScalar(rNow);
      const vr = this.vel.dot(this.up);
      if (vr < 0) this.vel.addScaledVector(this.up, -vr);
    }

    // --- state ---
    const alt2 = this.pos.length() - this.sampler.surfaceRadius(this.up.x, this.up.y, this.up.z);
    this.state = alt2 <= 0.05 ? 'grounded' : (this.vel.dot(this.up) < 0 ? 'falling' : 'jumping');

    this._syncCamera();
  }

  _syncCamera() {
    this.up.copy(this.pos).normalize();
    // eye position
    const eye = this._tmp.copy(this.pos).addScaledVector(this.up, this.cfg.eyeHeight);
    this.camera.position.copy(eye);
    // re-project forward to tangent for a level look
    const fwd = new THREE.Vector3().copy(this.forward)
      .addScaledVector(this.up, -this.forward.dot(this.up));
    if (fwd.lengthSq() < 1e-6) { this._initForward(); fwd.copy(this.forward); }
    fwd.normalize();
    const right = new THREE.Vector3().copy(fwd).cross(this.up).normalize();
    // tilt the look by pitch around the tangent right axis
    const lookDir = fwd.clone().multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(this.up, Math.sin(this.pitch));
    this.camera.up.copy(this.up);
    this.camera.lookAt(eye.clone().add(lookDir));
    void right;
  }

  // for HUD parity with FPSControls
  get moveSpeed() { return this.cfg.walkSpeed * this.speedMultiplier; }
}
