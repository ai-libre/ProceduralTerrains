// ============================================================================
// CPU noise primitives for the Noise Stack's "close-enough" f64 evaluator.
//
// These mirror the GLSL primitives (Dave-Hoskins hash + quintic value noise +
// rotated-domain FBM) but in plain double precision — no Math.fround. They are
// only used for player physics on CUSTOM stacks (planet ground-follow and the
// off-board analytic fallback); the default `legacy` stack still delegates to
// the existing f32-exact samplers, so default projects are unaffected.
//
// Visual match to the GPU is good; absolute height can differ sub-unit due to
// f32-vs-f64 rounding, which is fine for walking/collision.
// ============================================================================

function fract(v) { return v - Math.floor(v); }

// --- 2D hash (port of hash12) ----------------------------------------------
export function hash12(px, py) {
  let p3x = fract(px * 0.1031);
  let p3y = fract(py * 0.1031);
  const p3z = p3x;
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d;
  return fract((p3x + p3y) * (p3z + d));
}

// --- 2D quintic value noise -------------------------------------------------
export function vnoise2(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

// rotation matching GLSL ROT2 = mat2(0.80,-0.60,0.60,0.80)
export function rot2(x, y) {
  return [0.80 * x + 0.60 * y, -0.60 * x + 0.80 * y];
}

// --- 3D hash (port of hash13) ----------------------------------------------
export function hash13(px, py, pz) {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(pz * 0.1031);
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

// --- 3D quintic value noise -------------------------------------------------
export function vnoise3(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1, z0 = iz, z1 = iz + 1;
  const lerp = (a, b, t) => a + (b - a) * t;
  const n000 = hash13(x0, y0, z0), n100 = hash13(x1, y0, z0);
  const n010 = hash13(x0, y1, z0), n110 = hash13(x1, y1, z0);
  const n001 = hash13(x0, y0, z1), n101 = hash13(x1, y0, z1);
  const n011 = hash13(x0, y1, z1), n111 = hash13(x1, y1, z1);
  const a = lerp(lerp(n000, n100, ux), lerp(n010, n110, ux), uy);
  const b = lerp(lerp(n001, n101, ux), lerp(n011, n111, ux), uy);
  return lerp(a, b, uz);
}

// rotation matching GLSL ROT3 (column-major)
export function rot3(x, y, z) {
  return [
    0.0 * x + -0.80 * y + -0.60 * z,
    0.80 * x + 0.36 * y + -0.48 * z,
    0.60 * x + -0.48 * y + 0.64 * z,
  ];
}

// ------------------------------------------------------------- 2D fractals
export function fbm2(px, py, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * vnoise2(x, y);
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

export function ridged2(px, py, octaves, pers, lac, sharp) {
  let amp = 0.5, sum = 0, norm = 0, carry = 1, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    let v = 1 - Math.abs(vnoise2(x, y) * 2 - 1);
    v = Math.pow(v, sharp);
    sum += amp * v * carry;
    carry = Math.max(0, Math.min(1, v * 1.4));
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

export function billow2(px, py, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * Math.abs(vnoise2(x, y) * 2 - 1);
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

// ------------------------------------------------------------- 3D fractals
export function fbm3(px, py, pz, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * vnoise3(x, y, z);
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

export function ridged3(px, py, pz, octaves, pers, lac, sharp) {
  let amp = 0.5, sum = 0, norm = 0, carry = 1, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    let v = 1 - Math.abs(vnoise3(x, y, z) * 2 - 1);
    v = Math.pow(v, sharp);
    sum += amp * v * carry;
    carry = Math.max(0, Math.min(1, v * 1.4));
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

export function billow3(px, py, pz, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * Math.abs(vnoise3(x, y, z) * 2 - 1);
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

export function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export { fract };
