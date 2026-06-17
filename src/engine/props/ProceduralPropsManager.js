import * as THREE from 'three';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hashInt(x, y, seed = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  return ((Math.imul(n, 1274126177) ^ n) >>> 0) / 4294967295;
}

function makeGrassTuftGeometry({ bladeCount = 14, segments = 4, height = 1, radius = 0.22 } = {}) {
  const positions = [];
  const colors = [];
  const indices = [];
  const bottom = new THREE.Color(0x245f2d);
  const mid = new THREE.Color(0x4f9d42);
  const tip = new THREE.Color(0x9fcb5b);

  const pushVertex = (x, y, z, t, shade) => {
    positions.push(x, y, z);
    const col = (t < 0.68 ? bottom.clone().lerp(mid, t / 0.68) : mid.clone().lerp(tip, (t - 0.68) / 0.32));
    col.multiplyScalar(shade);
    colors.push(col.r, col.g, col.b);
  };

  for (let b = 0; b < bladeCount; b++) {
    const bladeSeed = b * 12.9898;
    const angle = (b / bladeCount) * Math.PI * 2 + Math.sin(bladeSeed) * 0.45;
    const baseR = radius * (0.18 + 0.82 * Math.abs(Math.sin(bladeSeed * 1.7)));
    const baseX = Math.cos(angle) * baseR;
    const baseZ = Math.sin(angle) * baseR;
    const h = height * (0.68 + 0.48 * Math.abs(Math.sin(bladeSeed * 2.31)));
    const width = 0.026 + 0.032 * Math.abs(Math.cos(bladeSeed * 0.77));
    const lean = 0.10 + 0.24 * Math.abs(Math.sin(bladeSeed * 0.41));
    const leanAngle = angle + Math.sin(bladeSeed * 3.1) * 0.9;
    const sideX = Math.cos(angle + Math.PI * 0.5);
    const sideZ = Math.sin(angle + Math.PI * 0.5);
    const start = positions.length / 3;
    const shade = 0.78 + 0.28 * Math.abs(Math.sin(bladeSeed * 5.3));

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const bend = t * t;
      const taper = Math.pow(1 - t, 1.25);
      const curl = Math.sin(t * Math.PI) * 0.035 * Math.sin(bladeSeed);
      const cx = baseX + Math.cos(leanAngle) * lean * bend + Math.cos(angle) * curl;
      const cy = h * t;
      const cz = baseZ + Math.sin(leanAngle) * lean * bend + Math.sin(angle) * curl;
      const w = width * taper;
      pushVertex(cx - sideX * w, cy, cz - sideZ * w, t, shade);
      pushVertex(cx + sideX * w, cy, cz + sideZ * w, t, shade);
    }

    for (let s = 0; s < segments; s++) {
      const a = start + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeFlowerGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.18, 0.55, 0, 0.18, 0.55, 0, 0, 0.92, 0,
    0, 0.55, -0.18, 0, 0.55, 0.18, 0, 0.92, 0,
  ], 3));
  geo.setIndex([0, 1, 2, 3, 4, 5]);
  geo.computeVertexNormals();
  return geo;
}

export class ProceduralPropsManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'procedural-props';
    this.scene.add(this.group);

    this.grassNearGeometry = makeGrassTuftGeometry({ bladeCount: 16, segments: 4, height: 1.0, radius: 0.26 });
    this.grassMidGeometry = makeGrassTuftGeometry({ bladeCount: 7, segments: 2, height: 0.86, radius: 0.32 });
    this.flowerGeometry = makeFlowerGeometry();
    this.grassNearMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.grassMidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.flowerMaterial = new THREE.MeshLambertMaterial({ color: 0xf2d46b, side: THREE.DoubleSide });

    this.meshes = [];
    this._lastKey = '';
    this._lastPaintRevision = -1;
    this._lastUpdateAt = 0;
    this._lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._qAlign = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  update({ mode, camera, params, boardSize, heightSampler, planetSampler, paintLayers }) {
    const enabled = !!params.propsEnabled;
    this.group.visible = enabled;
    if (!enabled || !camera) return;

    const now = performance.now();
    const paintRevision = paintLayers?.revision ?? -1;
    const center = this._resolveCenter(mode, camera, boardSize);
    const moved = center.distanceToSquared(this._lastCenter) > Math.pow(Math.max(60, params.propsCullDistance * 0.22), 2);
    const key = [
      mode, params.seed, params.propsDensity, params.propsGrass, params.propsFlowers,
      params.propsCullDistance, params.propsLodDistance, params.seaLevel, boardSize,
    ].join('|');

    if (key === this._lastKey && paintRevision === this._lastPaintRevision && !moved && now - this._lastUpdateAt < 700) return;
    this._lastKey = key;
    this._lastPaintRevision = paintRevision;
    this._lastUpdateAt = now;
    this._lastCenter.copy(center);

    if (mode === 'planet') {
      this._buildPlanet({ camera, params, planetSampler });
    } else {
      this._buildFlat({ mode, center, params, boardSize, heightSampler, paintLayers });
    }
  }

  _resolveCenter(mode, camera, boardSize) {
    if (mode === 'studio') {
      const half = boardSize / 2;
      return new THREE.Vector3(
        clamp(camera.position.x, -half, half),
        0,
        clamp(camera.position.z, -half, half)
      );
    }
    return camera.position.clone();
  }

  _clearMeshes() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.meshes = [];
  }

  _buildFlat({ mode, center, params, boardSize, heightSampler, paintLayers }) {
    if (!heightSampler) return;
    const radius = params.propsCullDistance;
    const density = clamp(params.propsDensity, 0, 2);
    const cell = lerp(56, 14, Math.sqrt(density / 2));
    const minX = Math.floor((center.x - radius) / cell);
    const maxX = Math.ceil((center.x + radius) / cell);
    const minZ = Math.floor((center.z - radius) / cell);
    const maxZ = Math.ceil((center.z + radius) / cell);
    const half = boardSize / 2;
    const grassNear = [];
    const grassMid = [];
    const flowers = [];
    const maxInstances = Math.round(900 + density * 1800);

    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (grassNear.length + grassMid.length + flowers.length >= maxInstances) break;
        const h0 = hashInt(gx, gz, params.seed);
        const h1 = hashInt(gx + 91, gz - 37, params.seed);
        const x = gx * cell + (h0 - 0.5) * cell;
        const z = gz * cell + (h1 - 0.5) * cell;
        if (Math.hypot(x - center.x, z - center.z) > radius) continue;
        if (mode === 'studio' && (Math.abs(x) > half || Math.abs(z) > half)) continue;

        const paint = mode === 'studio' ? paintLayers?.samplePropsMask(x, z) : null;
        const paintedDensity = paint ? Math.max(paint.grass, paint.flowers, paint.mixed) : 0;
        const chance = clamp(density * 0.62 + paintedDensity * 1.15, 0, 1);
        if (hashInt(gx - 17, gz + 53, params.seed) > chance) continue;

        const y = heightSampler.heightAt(x, z);
        if (y <= params.seaLevel + 1.5) continue;
        const n = heightSampler.normalAt(x, z, 2.0);
        if (n.y < 0.72) continue;

        const dist = Math.hypot(x - center.x, z - center.z);
        const flowerWeight = clamp((paint?.flowers ?? 0) + (paint?.mixed ?? 0) * 0.5 + params.propsFlowers * 0.35, 0, 1);
        const isFlower = hashInt(gx + 7, gz + 19, params.seed) < flowerWeight;
        const scale = lerp(4.0, 8.5, hashInt(gx + 29, gz + 11, params.seed)) * (isFlower ? 0.78 : params.propsGrass);
        const item = { pos: [x, y + 0.6, z], normal: [n.x, n.y, n.z], yaw: h0 * Math.PI * 2, scale };
        if (isFlower) flowers.push(item);
        else if (dist < params.propsLodDistance) grassNear.push(item);
        else grassMid.push(item);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers);
  }

  _buildPlanet({ camera, params, planetSampler }) {
    if (!planetSampler) return;
    const camDir = camera.position.clone().normalize();
    const ref = Math.abs(camDir.y) < 0.96 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(ref, camDir).normalize();
    const t2 = new THREE.Vector3().crossVectors(camDir, t1).normalize();
    const radius = params.propsCullDistance;
    const density = clamp(params.propsDensity, 0, 2);
    const cell = lerp(70, 22, Math.sqrt(density / 2));
    const min = Math.floor(-radius / cell);
    const max = Math.ceil(radius / cell);
    const grassNear = [];
    const grassMid = [];
    const flowers = [];
    const maxInstances = Math.round(700 + density * 1300);

    for (let gy = min; gy <= max; gy++) {
      for (let gx = min; gx <= max; gx++) {
        if (grassNear.length + grassMid.length + flowers.length >= maxInstances) break;
        const h0 = hashInt(gx, gy, params.seed);
        const h1 = hashInt(gx + 43, gy - 71, params.seed);
        const ox = gx * cell + (h0 - 0.5) * cell;
        const oy = gy * cell + (h1 - 0.5) * cell;
        const dist = Math.hypot(ox, oy);
        if (dist > radius) continue;
        if (hashInt(gx - 17, gy + 53, params.seed) > clamp(density * 0.72, 0, 1)) continue;

        const dir = camDir.clone().multiplyScalar(params.planetRadius)
          .addScaledVector(t1, ox)
          .addScaledVector(t2, oy)
          .normalize();
        const height = planetSampler.heightAt3D(dir.x, dir.y, dir.z);
        if (height <= params.seaLevel + 1.5) continue;
        const n = planetSampler.normalAt(dir.x, dir.y, dir.z);
        const slope = n.x * dir.x + n.y * dir.y + n.z * dir.z;
        if (slope < 0.78) continue;
        const surfaceRadius = params.planetRadius + height + 0.8;
        const isFlower = hashInt(gx + 7, gy + 19, params.seed) < clamp(params.propsFlowers * 0.38, 0, 1);
        const scale = lerp(5.0, 10.0, hashInt(gx + 29, gy + 11, params.seed)) * (isFlower ? 0.78 : params.propsGrass);
        const item = {
          pos: [dir.x * surfaceRadius, dir.y * surfaceRadius, dir.z * surfaceRadius],
          normal: [n.x, n.y, n.z],
          yaw: h0 * Math.PI * 2,
          scale,
        };
        if (isFlower) flowers.push(item);
        else if (dist < params.propsLodDistance) grassNear.push(item);
        else grassMid.push(item);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers);
  }

  _replaceMeshes(grassNear, grassMid, flowers) {
    this._clearMeshes();
    this._addInstanced('grass-near', this.grassNearGeometry, this.grassNearMaterial, grassNear);
    this._addInstanced('grass-mid', this.grassMidGeometry, this.grassMidMaterial, grassMid);
    this._addInstanced('flowers', this.flowerGeometry, this.flowerMaterial, flowers);
  }

  _addInstanced(name, geometry, material, items) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = `procedural-${name}`;
    mesh.frustumCulled = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      this._tmpPos.set(item.pos[0], item.pos[1], item.pos[2]);
      const normal = new THREE.Vector3(item.normal[0], item.normal[1], item.normal[2]).normalize();
      this._qAlign.setFromUnitVectors(this._up, normal);
      this._qYaw.setFromAxisAngle(this._up, item.yaw);
      const q = this._qAlign.clone().multiply(this._qYaw);
      this._tmpScale.setScalar(item.scale);
      this._tmpMat.compose(this._tmpPos, q, this._tmpScale);
      mesh.setMatrixAt(i, this._tmpMat);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  dispose() {
    this._clearMeshes();
    this.scene.remove(this.group);
    this.grassNearGeometry.dispose();
    this.grassMidGeometry.dispose();
    this.flowerGeometry.dispose();
    this.grassNearMaterial.dispose();
    this.grassMidMaterial.dispose();
    this.flowerMaterial.dispose();
  }
}
