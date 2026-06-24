// ============================================================================
// HexTileMesh — builds ONE merged, non-indexed, flat-shaded BufferGeometry of
// hex columns ("board-game" tiles). Each cell is a flat-topped prism: a top
// face (triangle fan) + side walls down to a base ring.
//
// Lighting is BAKED into vertex colors (per-triangle flat Lambert against the
// sun direction) so the mesh renders with a plain MeshBasicMaterial and needs
// no scene lights — matching the engine's shader-driven lighting elsewhere.
//
// Mode-specific code (planet / board / infinite) resolves each cell into a
// `top` ring + `base` ring of 3D points and a linear-RGB color, then calls
// addCell(). build() returns the geometry; never mutated after.
// ============================================================================

import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

/** Sun unit direction from azimuth/elevation degrees (matches the terrain sun). */
export function sunDirection(azimuthDeg, elevationDeg, out = [0, 0, 0]) {
  const el = elevationDeg * DEG2RAD, az = azimuthDeg * DEG2RAD;
  const h = Math.cos(el);
  out[0] = h * Math.cos(az);
  out[1] = Math.sin(el);
  out[2] = h * Math.sin(az);
  return out;
}

export class HexTileMeshBuilder {
  /**
   * @param {object} opts
   * @param {number[]} [opts.sun]      sun unit direction (default straight up-ish)
   * @param {number}   [opts.ambient]  ambient floor for the baked shading (0..1)
   * @param {number}   [opts.sideTint] extra darkening of side walls (0..1)
   * @param {number}   [opts.bevel]    top-face inset toward the cell center
   *                                    (0..0.4) → discrete "board-game" tiles
   *                                    with beveled rims + visible gaps
   */
  constructor({ sun = [0.4, 0.8, 0.45], ambient = 0.38, sideTint = 0.82, bevel = 0 } = {}) {
    this.sun = sun;
    this.ambient = ambient;
    this.sideTint = sideTint;
    this.bevel = bevel;
    this.positions = [];
    this.colors = [];
    this._cellCount = 0;
  }

  // geometric flat-shade factor for a triangle (a,b,c are [x,y,z])
  _shade(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const ndotl = Math.max(nx * this.sun[0] + ny * this.sun[1] + nz * this.sun[2], 0);
    return this.ambient + (1 - this.ambient) * ndotl;
  }

  _tri(a, b, c, color, tint = 1) {
    const s = this._shade(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]) * tint;
    const r = color[0] * s, g = color[1] * s, bl = color[2] * s;
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.colors.push(r, g, bl, r, g, bl, r, g, bl);
  }

  /**
   * Add one hex column.
   * @param {number[][]} top   ring of top-face points (N×[x,y,z], CCW)
   * @param {number[][]} base  matching ring of base points (N×[x,y,z])
   * @param {number[]}   color linear RGB [r,g,b]
   */
  addCell(top, base, color) {
    const n = top.length;
    if (n < 3) return;

    // top face: fan from centroid (keeps it flat regardless of vert count)
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += top[i][0]; cy += top[i][1]; cz += top[i][2]; }
    const center = [cx / n, cy / n, cz / n];

    // bevel: inset the top ring toward the centroid so adjacent tiles show a
    // gap and the rim slopes (beveled) down to the full-width base — the
    // discrete tabletop-tile look. bevel=0 → the original flush column.
    let topRing = top;
    if (this.bevel > 0) {
      const k = 1 - this.bevel;
      topRing = new Array(n);
      for (let i = 0; i < n; i++) {
        topRing[i] = [
          center[0] + (top[i][0] - center[0]) * k,
          center[1] + (top[i][1] - center[1]) * k,
          center[2] + (top[i][2] - center[2]) * k,
        ];
      }
    }

    for (let i = 0; i < n; i++) {
      this._tri(center, topRing[i], topRing[(i + 1) % n], color);
    }

    // side walls: quad per edge (top_i, top_i1, base_i1, base_i) → 2 tris.
    // With a bevel the top ring is inset, so the wall slopes outward-downward.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._tri(topRing[i], topRing[j], base[j], color, this.sideTint);
      this._tri(topRing[i], base[j], base[i], color, this.sideTint);
    }
    this._cellCount++;
  }

  get cellCount() { return this._cellCount; }
  get isEmpty() { return this.positions.length === 0; }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Plain vertex-colored material for baked-shading hex tiles (no scene lights). */
export function makeHexTileMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}
