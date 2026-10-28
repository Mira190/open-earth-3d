// Shared pieces for the living things: seeded hashes, a bicubic copy of the sea floor that matches
// shore.js, value noise for patchiness, and a light-weight instancing scheme.
//
// A Herd is one draw call: an InstancedBufferGeometry whose per-instance data is one interleaved
// buffer of 16 floats, read by name in the materials:
//   iA = (x, y, z, scale)   scene space, metres
//   iB = (yaw, pitch, roll, phase)   yaw about +y from +x (east) toward -z (north); the model faces +x
//   iC, iD = two colours (rgb) and two free parameters (w)
// The transform is done in the vertex shader (pose()), so the model's own frame is still there for
// tail beats, wing strokes and swaying, and only 64 bytes per instance go to the GPU.
import * as THREE from 'three/webgpu';
import { Fn, attribute, float, vec3, cos, sin, varying, normalize, transformDirection, cameraViewMatrix, positionGeometry,
  normalGeometry, frontFacing, select, uniform, positionWorld, cameraPosition, length, dot, smoothstep, exp, max, min } from 'three/tsl';

// ---------------------------------------------------------------- deterministic numbers
export function hash(a, b = 0, c = 0, d = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x2f8e3a6b, 0x9e3779b1) ^ Math.imul((d | 0) + 0x1b873593, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// a seeded stream (mulberry32)
export function rng(seed) {
  let s = (seed * 4294967296) >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// smooth value noise in 2D, 0..1, cell size in metres
export function vnoise(x, y, cell, salt = 0) {
  const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
  const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

// MaterialX Perlin noise (three's mx_noise_float, the same hash and gradients), so the CPU knows the dunes
// shore.js draws on dry land
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
function bjfinal(a, b, c) {
  c = ((c ^ b) - rotl(b, 14)) >>> 0; a = ((a ^ c) - rotl(c, 11)) >>> 0; b = ((b ^ a) - rotl(a, 25)) >>> 0;
  c = ((c ^ b) - rotl(b, 16)) >>> 0; a = ((a ^ c) - rotl(c, 4)) >>> 0; b = ((b ^ a) - rotl(a, 14)) >>> 0;
  return ((c ^ b) - rotl(b, 24)) >>> 0;
}
const SEED3 = (0xdeadbeef + (3 << 2) + 13) >>> 0;
const mxHash = (x, y, z) => bjfinal((SEED3 + (x >>> 0)) >>> 0, (SEED3 + (y >>> 0)) >>> 0, (SEED3 + (z >>> 0)) >>> 0);
const mxGrad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export function mxNoise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
  const s = fade(fx), t = fade(fy), r = fade(fz), s1 = 1 - s, t1 = 1 - t, r1 = 1 - r;
  const g = (i, j, k) => mxGrad(mxHash(X + i, Y + j, Z + k), fx - i, fy - j, fz - k);
  return 0.982 * (r1 * (t1 * (g(0, 0, 0) * s1 + g(1, 0, 0) * s) + t * (g(0, 1, 0) * s1 + g(1, 1, 0) * s)) + r * (t1 * (g(0, 0, 1) * s1 + g(1, 0, 1) * s) + t * (g(0, 1, 1) * s1 + g(1, 1, 1) * s)));
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the ground, as the near-camera patch draws it
// shore.js reads the 30 m grid with Catmull-Rom (16 taps) around the camera; under water it adds no relief,
// so height() is where the sea floor actually is, to the centimetre. On dry land it adds dunes from GPU
// noise that fade in above the live tide; land(x, north, tide) adds the same dunes (relief()).
export function makeGround(d) {
  const t = d.scene.terrain, W = t.w, H = t.h, hs = d.heights;
  const cr = (f, k) => { const f2 = f * f, f3 = f2 * f; return k === 0 ? -0.5 * f3 + f2 - 0.5 * f : k === 1 ? 1.5 * f3 - 2.5 * f2 + 1 : k === 2 ? -1.5 * f3 + 2 * f2 + 0.5 * f : 0.5 * f3 - 0.5 * f2; };
  const wx = [0, 0, 0, 0], wy = [0, 0, 0, 0];
  function height(x, north) {
    const gx = (x - t.x0) / t.cell_m - 0.5, gy = (t.y1 - north) / t.cell_m - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    for (let k = 0; k < 4; k++) { wx[k] = cr(fx, k); wy[k] = cr(fy, k); }
    let h = 0;
    for (let j = 0; j < 4; j++) {
      const jj = Math.min(H - 1, Math.max(0, iy + j - 1)) * W;
      let row = 0;
      for (let i = 0; i < 4; i++) row += hs[jj + Math.min(W - 1, Math.max(0, ix + i - 1))] * wx[i];
      h += row * wy[j];
    }
    return h;
  }
  // slope (rise per metre) by central differences
  function slope(x, north, e = 1.5) {
    return [(height(x + e, north) - height(x - e, north)) / (2 * e), (height(x, north + e) - height(x, north - e)) / (2 * e)];
  }
  // the highest grid point inside a square: a cheap "is there land here" for tiles
  function maxIn(x0, n0, x1, n1) {
    const i0 = Math.max(0, Math.floor((x0 - t.x0) / t.cell_m) - 1), i1 = Math.min(W - 1, Math.ceil((x1 - t.x0) / t.cell_m) + 1);
    const j0 = Math.max(0, Math.floor((t.y1 - n1) / t.cell_m) - 1), j1 = Math.min(H - 1, Math.ceil((t.y1 - n0) / t.cell_m) + 1);
    let m = -1e9, lo = 1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = hs[j * W + i]; if (v > m) m = v; if (v < lo) lo = v; }
    return [lo, m];
  }
  // shore.js's dunes: up to ~0.6 m on dry sand, fading in from 0.1 to 1.2 m above the tide and out up the hill
  function relief(x, north, h, tide = 0) {
    const z = -north, dune = mxNoise3(x * 0.045, 0, z * 0.045) * 0.45 + mxNoise3(x * 0.2, 0, z * 0.2) * 0.12;
    return dune * sstep(tide + 0.1, tide + 1.2, h) * (1 - sstep(3, 14, h));
  }
  function land(x, north, tide = 0) { const h = height(x, north); return h + relief(x, north, h, tide); }
  return { height, slope, maxIn, relief, land };
}

// ---------------------------------------------------------------- herds: instanced geometry with a 16-float record per instance
export class Herd {
  constructor(name, geo, mat, cap, { dynamic = false, order = 0 } = {}) {
    this.name = name; this.cap = cap; this.n = 0;
    this.data = new Float32Array(cap * 16);
    const ib = this.ib = new THREE.InstancedInterleavedBuffer(this.data, 16, 1);
    if (dynamic) ib.setUsage(THREE.DynamicDrawUsage);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = geo.index;
    for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    g.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    g.setAttribute('iD', new THREE.InterleavedBufferAttribute(ib, 4, 12));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const m = this.mesh = new THREE.Mesh(g, mat);
    // always 'visible': an empty herd draws nothing (instanceCount 0), but its pipeline is built up front, so a
    // species does not pop in a few frames late while its shader compiles the first time it appears
    m.name = 'life:' + name; m.frustumCulled = false; m.renderOrder = order;
    m.matrixAutoUpdate = false;
  }
  // write instance i: position, scale, yaw, pitch, roll, phase, colour A + w, colour B + w
  put(i, x, y, z, s, yaw, pitch, roll, ph, r1, g1, b1, w1, r2, g2, b2, w2) {
    const o = i * 16, a = this.data;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = s; a[o + 4] = yaw; a[o + 5] = pitch; a[o + 6] = roll; a[o + 7] = ph;
    a[o + 8] = r1; a[o + 9] = g1; a[o + 10] = b1; a[o + 11] = w1; a[o + 12] = r2; a[o + 13] = g2; a[o + 14] = b2; a[o + 15] = w2;
  }
  // only the pose (the first 8 floats), for animated instances
  pose(i, x, y, z, s, yaw, pitch, roll, ph) {
    const o = i * 16, a = this.data;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = s; a[o + 4] = yaw; a[o + 5] = pitch; a[o + 6] = roll; a[o + 7] = ph;
  }
  commit(n) {
    this.n = Math.min(n, this.cap);
    this.geo.instanceCount = this.n;
    if (this.n > 0) { this.ib.clearUpdateRanges(); this.ib.addUpdateRange(0, this.n * 16); this.ib.needsUpdate = true; }
  }
}

// ---------------------------------------------------------------- the vertex transform for herds
// v' = Ry(yaw) Rz(pitch) Rx(roll) (s * deform(v)) + p. `deform(p, aux)` works in the model's frame (metres
// of the unit model), `post(w, p, aux)` in the world after placement (sway that should not turn with the
// model). The normal is rotated the same way and handed to the lighting in view space.
export const I = { A: attribute('iA', 'vec4'), B: attribute('iB', 'vec4'), C: attribute('iC', 'vec4'), D: attribute('iD', 'vec4'), aux: attribute('aux', 'vec4') };
export function pose(mat, { deform = null, post = null, squash = null, twoSided = false, flatten = 0 } = {}) {
  const { A, B, aux } = I;
  const cy = cos(B.x), sy = sin(B.x), cp = cos(B.y), sp = sin(B.y), cr = cos(B.z), sr = sin(B.z);
  const rot = v => {
    const v1 = vec3(v.x, v.y.mul(cr).sub(v.z.mul(sr)), v.y.mul(sr).add(v.z.mul(cr)));
    const v2 = vec3(v1.x.mul(cp).sub(v1.y.mul(sp)), v1.x.mul(sp).add(v1.y.mul(cp)), v1.z);
    return vec3(v2.x.mul(cy).add(v2.z.mul(sy)), v2.y, v2.z.mul(cy).sub(v2.x.mul(sy)));
  };
  let p = positionGeometry, n = normalGeometry;
  if (deform) p = deform(p, aux);      // (a TSL node: never test its properties, .p is a swizzle)
  if (squash) { p = p.mul(squash); n = n.div(squash); }
  let w = rot(p.mul(A.w)).add(A.xyz);
  if (post) w = post(w, p, aux);
  mat.positionNode = w;
  // foliage and soft things scatter light: bend their normals toward the sky a little
  let nw = rot(n);
  if (flatten) nw = nw.add(vec3(0, flatten, 0));
  const vn = varying(nw, 'vLifeN');
  const nn = twoSided ? select(frontFacing, vn, vn.negate()) : vn;
  mat.normalNode = transformDirection(normalize(nn), cameraViewMatrix);
  return mat;
}

// ---------------------------------------------------------------- a dive torch for night dives
// Under water at night the sun is gone and the moon barely reaches the reef, so a diver sees what the
// torch lights. The medium dims every colour by the sun's path down to the point and the path back to
// the eye; for torch light the first is wrong, so it is swapped for the torch's own path out.
export function makeTorch(env) {
  const u = env.u;
  const on = uniform(0), fwd = uniform(new THREE.Vector3(0, 0, -1));
  const light = Fn(([alb]) => {
    const d = positionWorld.sub(cameraPosition), L = max(length(d), 0.05);
    const cone = smoothstep(0.65, 0.92, dot(d.div(L), fwd)).mul(0.85).add(0.15);
    const fall = float(1).div(L.mul(L).mul(0.12).add(1));
    const dP = max(u.tide.sub(positionWorld.y), 0);
    const comp = exp(u.K.mul(min(dP.mul(u.lightPath), 30).sub(L)));
    return alb.mul(on.mul(cone).mul(fall).mul(2.2)).mul(comp);
  });
  return { on, fwd, light };
}
