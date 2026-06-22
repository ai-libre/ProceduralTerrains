// ============================================================================
// cloudFieldCPU: a compact CPU mirror of the cloud coverage field used ONLY for
// empty-space culling of cloud chunks (deciding "could this sector contain any
// cloud right now?"). It ports the base-FBM path of cloudShape() from
// cloudGLSL.js (the `soft` variant — a conservative proxy for all variants;
// detail/erosion are intentionally ignored so we never cull a chunk the GPU
// would actually fill). It is NOT used for rendering — the GPU shader stays the
// source of truth for the visible density.
// ============================================================================

const fract = (x) => x - Math.floor(x);

// cl_hash13 (Dave Hoskins) ported from cloudGLSL.js
function hash13(x, y, z) {
  let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(z * 0.1031);
  // dot(p3, p3.zyx + 31.32)
  const s = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += s; py += s; pz += s;
  return fract((px + py) * pz);
}

// quintic trilinear value noise (cl_vnoise)
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const n000 = hash13(ix, iy, iz);
  const n100 = hash13(ix + 1, iy, iz);
  const n010 = hash13(ix, iy + 1, iz);
  const n110 = hash13(ix + 1, iy + 1, iz);
  const n001 = hash13(ix, iy, iz + 1);
  const n101 = hash13(ix + 1, iy, iz + 1);
  const n011 = hash13(ix, iy + 1, iz + 1);
  const n111 = hash13(ix + 1, iy + 1, iz + 1);
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(
    mix(mix(n000, n100, ux), mix(n010, n110, ux), uy),
    mix(mix(n001, n101, ux), mix(n011, n111, ux), uy),
    uz
  );
}

// CL_ROT * p (column-major mat3 from cloudGLSL.js), result written back into out
function rotMul(px, py, pz, out) {
  out[0] = -0.80 * py - 0.60 * pz;
  out[1] = 0.80 * px + 0.36 * py - 0.48 * pz;
  out[2] = 0.60 * px - 0.48 * py + 0.64 * pz;
}

// base FBM value noise (cl_fbm_base) — `octaves` iterations, *2.02 freq, CL_ROT
function fbmBase(px, py, pz, octaves) {
  let amp = 0.5, sum = 0, norm = 0;
  let x = px, y = py, z = pz;
  const r = [0, 0, 0];
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y, z);
    norm += amp;
    amp *= 0.5;
    rotMul(x, y, z, r);
    x = r[0] * 2.02; y = r[1] * 2.02; z = r[2] * 2.02;
  }
  return sum / Math.max(norm, 1e-4);
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * Coverage fraction in [0,1] at a planet-local world point, mirroring the base
 * path of cloudShape() (domain rotation about Y + wind drift + base FBM + the
 * coverage threshold). Conservative: omits the detail/erosion terms.
 * @param {number} x @param {number} y @param {number} z  world point (planet at origin)
 * @param {object} f  field params (already in shader units):
 *   scale, windX, windY, windZ, time, rotation, coverage, softness, octaves
 */
export function cloudCoverageAt(x, y, z, f) {
  // cl_domain: rotate about Y by f.rotation
  const c = Math.cos(f.rotation), s = Math.sin(f.rotation);
  const qx = c * x + s * z;
  const qy = y;
  const qz = -s * x + c * z;
  // baseP = q * scale + wind * time
  const dx = f.windX * f.time, dy = f.windY * f.time, dz = f.windZ * f.time;
  const n = fbmBase(qx * f.scale + dx, qy * f.scale + dy, qz * f.scale + dz, f.octaves);
  const threshold = 1.0 - f.coverage;
  return smoothstep(threshold, threshold + f.softness, n);
}
