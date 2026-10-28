// Procedural shapes for the reef's living things, all at unit scale (scaled per instance). Every
// geometry carries `aux` (vec4) for the materials: x = a 0..1 coordinate along the thing (branch tip,
// plate edge, nose to tail, crown height), y = a part or pattern tag, z = how much it bends (sway,
// tail beat, wing stroke), w = a second tag (fins, flippers, trunk vs foliage).
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, hash } from './kit.js';

const V = THREE.Vector3, Y = new V(0, 1, 0), TAU = Math.PI * 2;
const _v = new V(), _n = new V(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V(1, 1, 1), _nm = new THREE.Matrix3();

// merges primitives into one geometry with position, normal and aux
export class Build {
  constructor() { this.p = []; this.n = []; this.a = []; this.i = []; }
  get count() { return this.p.length / 3; }
  // a three.js geometry under matrix m; aux(v, i) -> [x, y, z, w] (v in the built frame)
  add(g, m, aux) {
    const pos = g.attributes.position, nor = g.attributes.normal, base = this.count;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m); _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      const a = aux(_v, i); this.a.push(a[0], a[1], a[2], a[3]);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    g.dispose();
    return this;
  }
  // raw vertex / triangle
  vert(x, y, z, nx, ny, nz, a) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.a.push(a[0], a[1], a[2], a[3]); return this.count - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.a, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
// a matrix that puts a +Y unit primitive between a and b
function between(a, b) {
  const d = _v.subVectors(b, a), L = d.length();
  _q.setFromUnitVectors(Y, d.divideScalar(L));
  return new THREE.Matrix4().compose(new V().addVectors(a, b).multiplyScalar(0.5), _q, _s);
}
const at = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new V(x, y, z), _q.setFromEuler(new THREE.Euler(rx, ry, rz)), new V(sx, sy, sz));
// a smooth lumpy dome (or sphere) from an icosphere: lumps are gaussian bumps on the sphere
function lumpy(detail, lumps, amp, seed, cutY = -0.08, flat = 0.06) {
  const r = rng(seed), g = new THREE.IcosahedronGeometry(0.5, detail);
  g.deleteAttribute('uv');
  const L = []; for (let k = 0; k < lumps; k++) { const t = r() * TAU, z = r() * 1.6 - 0.6; L.push([Math.cos(t) * Math.sqrt(1 - z * z), z, Math.sin(t) * Math.sqrt(1 - z * z), (0.5 + r()) * amp, 0.25 + r() * 0.35]); }
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i); const u = _v.clone().normalize();
    let k = 1; for (const [x, y, z, a, w] of L) { const d = 1 - (u.x * x + u.y * y + u.z * z); k += a * Math.exp(-d / (w * w * 0.5)); }
    _v.multiplyScalar(k);
    if (_v.y < cutY) _v.y = cutY - (cutY - _v.y) * flat;
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  const m = mergeVertices(g, 1e-4); g.dispose();
  m.computeVertexNormals();
  return m;
}

// ================================================================ corals and the sea floor
// staghorn / bushy Acropora: primary branches fanning up and out, each with a few secondaries
export function branching(lod) {
  // grown, not placed: arched branches that turn upward as they grow and fork, as tubes with shared rings
  const b = new Build(), r = rng(hash(101, lod)), sides = lod ? 4 : 3, up = new V(0, 1, 0);
  const rnd3 = () => new V(r() - 0.5, r() - 0.5, r() - 0.5);
  const grow = (p0, d0, len, r0, level, t0) => {
    const n = lod && level === 0 ? 3 : 2, pts = [p0.clone()], rad = [r0], d = d0.clone();
    for (let i = 1; i <= n; i++) {
      d.addScaledVector(up, 0.35).addScaledVector(rnd3(), 0.35).normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, len / n)); rad.push(r0 * (1 - 0.42 * i / n));
    }
    const t1 = level >= (lod ? 2 : 1) ? 1 : t0 + 0.35;
    tube(b, pts, rad, sides, k => [t0 + (t1 - t0) * k / n, 1, 0, 0]);
    if (lod) { const e = pts[n], de = e.clone().sub(pts[n - 1]).normalize(); b.add(new THREE.SphereGeometry(rad[n], sides, 1, 0, TAU, 0, Math.PI / 2), new THREE.Matrix4().compose(e, new THREE.Quaternion().setFromUnitVectors(Y, de), new V(1, 1.6, 1)), () => [1, 1, 0, 0]); }
    if (level >= (lod ? 2 : 1)) return;
    const kids = !lod ? 1 : level === 0 ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
    for (let c = 0; c < kids; c++) {
      const at = 1 + Math.floor(r() * (n - 1)), dir = d0.clone().lerp(d, at / n).normalize();
      const side = new V().crossVectors(dir, rnd3()).normalize();
      const nd = dir.clone().applyAxisAngle(side, 0.55 + r() * 0.35).addScaledVector(up, 0.2).normalize();
      grow(pts[at], nd, len * (0.55 + r() * 0.2), rad[at] * 0.85, level + 1, t0 + 0.35 * at / n);
    }
  };
  const N = lod ? 7 : 5;
  for (let k = 0; k < N; k++) {
    const az = (k / N) * TAU + r() * 0.6, el = 0.35 + r() * 0.6;
    grow(new V(Math.cos(az) * 0.04, 0, Math.sin(az) * 0.04), new V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), 0.36 + r() * 0.14, 0.03, 0, 0);
  }
  return b.geometry();
}
// a tube along a polyline, radii per point; aux per ring index
function tube(b, pts, rad, sides, aux) {
  const rings = [], n = pts.length, t = new V(), nrm = new V(), bin = new V(), ref = new V(0, 0, 1);
  for (let i = 0; i < n; i++) {
    t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    nrm.crossVectors(Math.abs(t.z) > 0.9 ? new V(1, 0, 0) : ref, t).normalize(); bin.crossVectors(t, nrm);
    const ring = [], a = aux(i);
    for (let j = 0; j < sides; j++) {
      const ang = (j / sides) * TAU, cx = Math.cos(ang), sy = Math.sin(ang);
      const nx = nrm.x * cx + bin.x * sy, ny = nrm.y * cx + bin.y * sy, nz = nrm.z * cx + bin.z * sy;
      ring.push(b.vert(pts[i].x + nx * rad[i], pts[i].y + ny * rad[i], pts[i].z + nz * rad[i], nx, ny, nz, a));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
    const a = rings[i][j], c = rings[i][(j + 1) % sides], d = rings[i + 1][j], e = rings[i + 1][(j + 1) % sides];
    b.tri(a, c, d); b.tri(c, e, d);
  }
}

// table coral (Acropora hyacinthus): a stalk and a thin flat plate with an irregular, paler rim
export function table(lod) {
  const b = new Build(), r = rng(hash(102, lod)), A = lod ? 30 : 12, R = lod ? [0, 0.12, 0.26, 0.38, 0.46, 0.5] : [0, 0.3, 0.5];
  const edge = []; const ph = [r() * TAU, r() * TAU, r() * TAU];
  for (let j = 0; j < A; j++) { const t = (j / A) * TAU; edge.push(1 + 0.09 * Math.sin(3 * t + ph[0]) + 0.06 * Math.sin(5 * t + ph[1]) + 0.04 * Math.sin(9 * t + ph[2])); }
  const H = 0.32, TH = 0.035;
  const yTop = rho => H + 0.05 * rho * rho - 0.02 * rho, ring = [];
  for (const face of [1, -1]) {
    const rows = [];
    for (let i = 0; i < R.length; i++) {
      const row = [];
      for (let j = 0; j < A; j++) {
        const t = (j / A) * TAU, rr = R[i] * edge[j], rho = R[i] / 0.5;
        const y = yTop(rho) - (face < 0 ? TH * (1 - 0.6 * rho) : 0);
        row.push(b.vert(Math.cos(t) * rr, y, Math.sin(t) * rr, 0, face, 0, [rho, 2, 0, face > 0 ? 0 : 1]));
        if (i === R.length - 1) ring.push([Math.cos(t) * rr, y, Math.sin(t) * rr, face]);
      }
      rows.push(row);
    }
    for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < A; j++) {
      const a = rows[i][j], c = rows[i][(j + 1) % A], d = rows[i + 1][j], e = rows[i + 1][(j + 1) % A];
      if (face > 0) { b.tri(a, c, d); b.tri(c, e, d); } else { b.tri(a, d, c); b.tri(c, d, e); }
    }
  }
  // rim
  for (let j = 0; j < A; j++) {
    const t0 = ring[j], b0 = ring[A + j], t1 = ring[(j + 1) % A], b1 = ring[A + (j + 1) % A];
    const nx = Math.cos((j + 0.5) / A * TAU), nz = Math.sin((j + 0.5) / A * TAU);
    const i0 = b.vert(t0[0], t0[1], t0[2], nx, 0, nz, [1, 2, 0, 0]), i1 = b.vert(b0[0], b0[1], b0[2], nx, 0, nz, [1, 2, 0, 0]);
    const i2 = b.vert(t1[0], t1[1], t1[2], nx, 0, nz, [1, 2, 0, 0]), i3 = b.vert(b1[0], b1[1], b1[2], nx, 0, nz, [1, 2, 0, 0]);
    b.tri(i0, i2, i1); b.tri(i2, i3, i1);
  }
  // stalk, slightly flared at the foot
  b.add(new THREE.CylinderGeometry(0.05, 0.085, H, lod ? 7 : 4, 1, true), at(0, H / 2, 0), () => [0, 2, 0, 1]);
  return b.geometry();
}

// massive Porites: big lumpy domes; brain coral: rounder, fewer lumps (the meanders are in the shader)
export function boulder(lod) { const b = new Build(); b.add(lumpy(lod ? 2 : 1, 16, 0.09, hash(103)), new THREE.Matrix4(), v => [v.y + 0.5, 3, 0, 0]); return b.geometry(); }
export function brain(lod) { const b = new Build(); b.add(lumpy(lod ? 2 : 1, 3, 0.05, hash(104), -0.12, 0.05), new THREE.Matrix4(), v => [v.y + 0.5, 4, 0, 0]); return b.geometry(); }

// leather coral (Sarcophyton): a stalk and a folded cap that sways a little in the surge
export function leather(lod) {
  const b = new Build(), A = lod ? 18 : 10, R = lod ? [0, 0.15, 0.3, 0.38, 0.44] : [0, 0.25, 0.44];
  const H = 0.22, fold = t => Math.sin(5 * t + 0.6) * 0.6 + Math.sin(8 * t + 2.1) * 0.4;
  for (const face of [1, -1]) {
    const rows = [];
    for (let i = 0; i < R.length; i++) {
      const row = [], rho = R[i] / 0.44;
      for (let j = 0; j < A; j++) {
        const t = (j / A) * TAU, y = H + 0.07 * rho * rho * fold(t) + 0.03 * rho - (face < 0 ? 0.04 * (1 - rho * 0.7) : 0);
        row.push(b.vert(Math.cos(t) * R[i], y, Math.sin(t) * R[i], 0, face, 0, [rho, 5, rho * rho, 0]));
      }
      rows.push(row);
    }
    for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < A; j++) {
      const a = rows[i][j], c = rows[i][(j + 1) % A], d = rows[i + 1][j], e = rows[i + 1][(j + 1) % A];
      if (face > 0) { b.tri(a, c, d); b.tri(c, e, d); } else { b.tri(a, d, c); b.tri(c, d, e); }
    }
  }
  b.add(new THREE.CylinderGeometry(0.12, 0.16, H, lod ? 10 : 5, 1, true), at(0, H / 2, 0), v => [0.2, 5, 0, 1]);
  return b.geometry();
}

// giant clam: a fluted shell (two valves) half set into the reef, the mantle between the lips
export function clam() {
  const b = new Build(), S = 22, R = 7;
  // shell: rows from the hinge (bottom) to the wavy lip; the lip zig-zags where the valves interlock
  const rows = [];
  for (let i = 0; i <= R; i++) {
    const v = i / R, row = [];
    for (let j = 0; j <= S; j++) {
      const t = (j / S) * TAU, flute = 1 + 0.12 * Math.abs(Math.sin(t * 3.5)) * v;
      const x = Math.cos(t) * 0.5 * Math.sin(v * Math.PI * 0.5 + 0.12) * flute, z = Math.sin(t) * 0.24 * Math.sin(v * Math.PI * 0.5 + 0.12) * flute;
      const y = -0.1 + v * 0.3 + (i === R ? 0.035 * Math.sin(t * 7) : 0);
      row.push(b.vert(x, y, z, x * 2, 0.3, z * 4, [v, 6, 0, 0]));
    }
    rows.push(row);
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) { const a = rows[i][j], c = rows[i][j + 1], d = rows[i + 1][j], e = rows[i + 1][j + 1]; b.tri(a, d, c); b.tri(c, d, e); }
  // mantle: an oval, slightly domed, rippled at the edge
  const M = [], cx = b.vert(0, 0.215, 0, 0, 1, 0, [0, 7, 0, 1]);
  for (let j = 0; j <= S; j++) { const t = (j / S) * TAU; M.push(b.vert(Math.cos(t) * 0.52, 0.19 + 0.03 * Math.sin(t * 9), Math.sin(t) * 0.2, 0, 1, 0, [1, 7, 0, 1])); }
  const M2 = [];
  for (let j = 0; j <= S; j++) { const t = (j / S) * TAU; M2.push(b.vert(Math.cos(t) * 0.3, 0.215, Math.sin(t) * 0.11, 0, 1, 0, [0.55, 7, 0, 1])); }
  for (let j = 0; j < S; j++) { b.tri(cx, M2[j + 1], M2[j]); b.tri(M2[j], M2[j + 1], M[j]); b.tri(M2[j + 1], M[j + 1], M[j]); }
  return b.geometry();
}

// magnificent sea anemone: a column, an oral disc and a mop of tentacles that sway
export function anemone() {
  const b = new Build(), r = rng(hash(105));
  b.add(new THREE.CylinderGeometry(0.24, 0.2, 0.1, 16, 1, true), at(0, 0.05, 0), () => [0, 8, 0, 1]);
  b.add(new THREE.CircleGeometry(0.24, 16), at(0, 0.1, 0, -Math.PI / 2), () => [0, 8, 0, 0]);
  // a dense mop of finger-like tentacles (more than 8 cm long), leaning outward and curling at the tips
  const N = 150;
  for (let k = 0; k < N; k++) {
    const rr = 0.24 * Math.sqrt((k + 0.5) / N), t = k * 2.39996;
    const p = new V(Math.cos(t) * rr, 0.1, Math.sin(t) * rr), out = rr / 0.24, len = 0.1 + r() * 0.06;
    const d = new V(Math.cos(t) * out * 1.1 + (r() - 0.5) * 0.4, 1, Math.sin(t) * out * 1.1 + (r() - 0.5) * 0.4).normalize();
    const m = p.clone().addScaledVector(d, len * 0.55), e = m.clone().addScaledVector(d.clone().add(new V(Math.cos(t) * out, -0.3, Math.sin(t) * out)).normalize(), len * 0.45);
    tube(b, [p, m, e], [0.011, 0.009, 0.006], 3, i => [i / 2, 8, i / 2, 2]);
  }
  return b.geometry();
}

// dead coral rubble: broken branch pieces lying about, some plate fragments
export function rubble() {
  const b = new Build(), r = rng(hash(106));
  for (let k = 0; k < 9; k++) {
    const x = (r() - 0.5) * 0.9, z = (r() - 0.5) * 0.9, L = 0.12 + r() * 0.2;
    b.add(new THREE.CylinderGeometry(0.016, 0.022, L, 4, 1, false), at(x, 0.008, z, Math.PI / 2 + (r() - 0.5) * 0.4, r() * TAU, 0), () => [r(), 9, 0, 0]);
  }
  for (let k = 0; k < 3; k++) b.add(new THREE.BoxGeometry(0.14 + r() * 0.1, 0.018, 0.1 + r() * 0.06), at((r() - 0.5) * 0.8, 0.004, (r() - 0.5) * 0.8, (r() - 0.5) * 0.3, r() * TAU, (r() - 0.5) * 0.3), () => [0.5, 9, 0, 1]);
  return b.geometry();
}

// a patch of seagrass (Halodule uninervis: blades up to 15 cm, wider in deeper water) as three crossed cards;
// the blades themselves are cut out of each card in the material (aux.x = height on the card, aux.y = across)
export function seagrass() {
  const b = new Build(), W = 0.55, H = 0.16;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3 + 0.3, cx = Math.cos(a) * W / 2, cz = Math.sin(a) * W / 2, nx = -Math.sin(a), nz = Math.cos(a);
    const ids = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([s, v]) => b.vert(cx * s, v * H, cz * s, nx, 0.3, nz, [v, (s + 1) / 2 + k, v * v, 0]));
    b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[3]);
  }
  return b.geometry();
}

// ================================================================ animals (unit length, facing +x, nose at +0.4)
// a bony fish from a few numbers: body depth and width (fractions of length), tail shape, fins
export function fish(o = {}) {
  const b = new Build(), depth = o.depth ?? 0.32, width = o.width ?? 0.12, hump = o.hump ?? 0, snout = o.snout ?? 0.35;
  const U = o.small ? [0, 0.04, 0.12, 0.24, 0.38, 0.54, 0.7, 0.84] : [0, 0.02, 0.05, 0.1, 0.17, 0.25, 0.34, 0.44, 0.54, 0.64, 0.73, 0.8, 0.84], RING = o.ring ?? (o.small ? 6 : 10);
  const X = u => 0.4 - u;
  // half height and half width along the body; the head is an ellipse, the rear tapers to the peduncle
  const c = o.peak ?? 0.36, ped = o.peduncle ?? 0.22;
  const prof = u => u < c ? Math.pow(Math.max(0, 1 - Math.pow((c - u) / c, 2)), snout) : 1 - (1 - ped) * Math.pow(Math.min(1, (u - c) / (0.84 - c)), 1.4);
  const h = u => depth / 2 * prof(u), w = u => width / 2 * prof(u) * (1 - 0.25 * u);
  const yc = u => (u < c ? hump * depth * 0.5 * Math.max(0, Math.sin(Math.PI * u / c)) : 0) * 0.6;
  const rows = [];
  for (const u of U) {
    const row = [], hh = h(u) + (u < c ? hump * depth * 0.25 * Math.sin(Math.PI * u / c) : 0), ww = w(u), y0 = yc(u) * 0.3;
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const yy = sa * (sa > 0 ? hh : h(u) * (o.belly ?? 1)) + y0;
      row.push(b.vert(X(u), yy, ca * ww, 0, sa / Math.max(hh, 1e-3), ca / Math.max(ww, 1e-3), [u, sa, Math.max(0, (u - 0.2) / 0.8), 0]));
    }
    rows.push(row);
  }
  // normals of the body by differences around the ring (the analytic ones above are only directions)
  for (let i = 0; i < U.length - 1; i++) for (let j = 0; j < RING; j++) {
    const a = rows[i][j], cc = rows[i][(j + 1) % RING], d = rows[i + 1][j], e = rows[i + 1][(j + 1) % RING];
    b.tri(a, cc, d); b.tri(cc, e, d);
  }
  // caudal peduncle cap
  const last = rows[U.length - 1], cap = b.vert(X(0.85), 0, 0, -1, 0, 0, [0.85, 0, 0.81, 0]);
  for (let j = 0; j < RING; j++) b.tri(last[j], cap, last[(j + 1) % RING]);
  // fins: flat, two-sided (the fish material is two-sided)
  const fin = pts => { const ids = pts.map(([u, y, z = 0]) => b.vert(X(u), y, z, 0, 0, 1, [u, y / (depth / 2), Math.max(0, (u - 0.2) / 0.8), 1])); for (let k = 1; k < ids.length - 1; k++) b.tri(ids[0], ids[k], ids[k + 1]); };
  const hp = h(0.82), T = (o.tail ?? 0.5) * depth, ts = o.tailShape ?? 'fork';
  const notch = ts === 'fork' ? 0.9 : ts === 'lunate' ? 0.93 : ts === 'round' ? 1.03 : 1.0;
  fin([[0.82, 0], [0.82, hp], [ts === 'round' ? 0.98 : 1.0, T], [notch, 0], [ts === 'round' ? 0.98 : 1.0, -T], [0.82, -hp]]);
  // dorsal and anal fins along the back and belly
  const df = o.dorsal ?? [0.22, 0.74, 0.35], af = o.anal ?? [0.5, 0.74, 0.25];
  const ridge = (f, sign) => {
    const n = o.small ? 3 : 5, pts = [];
    for (let k = 0; k <= n; k++) { const u = f[0] + (f[1] - f[0]) * k / n; pts.push([u, sign * h(u) * 0.92 + (sign > 0 ? yc(u) * 0.3 + hump * depth * 0.25 * (u < c ? Math.sin(Math.PI * u / c) : 0) : 0)]); }
    for (let k = n; k >= 0; k--) { const u = f[0] + (f[1] - f[0]) * k / n, tip = Math.sin(Math.PI * (k / n) * 0.9 + 0.15); pts.push([u + 0.03, pts[k][1] + sign * f[2] * depth * (o.spiky ? 0.7 + 0.3 * tip : tip)]); }
    // as a strip of quads so it can be convex-free
    for (let k = 0; k < n; k++) {
      const a = pts[k], cc = pts[k + 1], d = pts[2 * n + 1 - k], e = pts[2 * n - k];
      const ia = b.vert(X(a[0]), a[1], 0, 0, 0, 1, [a[0], sign, Math.max(0, (a[0] - 0.2) / 0.8), 1]), ic = b.vert(X(cc[0]), cc[1], 0, 0, 0, 1, [cc[0], sign, Math.max(0, (cc[0] - 0.2) / 0.8), 1]);
      const id = b.vert(X(d[0]), d[1], 0, 0, 0, 1, [d[0], sign * 1.5, Math.max(0, (d[0] - 0.2) / 0.8), 1]), ie = b.vert(X(e[0]), e[1], 0, 0, 0, 1, [e[0], sign * 1.5, Math.max(0, (e[0] - 0.2) / 0.8), 1]);
      b.tri(ia, ic, id); b.tri(ic, ie, id);
    }
  };
  ridge(df, 1); if (af) ridge(af, -1);
  // pectoral fins
  const pf = o.pectoral ?? 0.12;
  for (const s of [1, -1]) fin([[0.27, -0.05 * depth, s * w(0.27) * 0.9], [0.27 + pf * 0.9, -0.15 * depth, s * (w(0.27) + pf * 0.5)], [0.27 + pf, -0.32 * depth, s * (w(0.27) + pf * 0.3)], [0.3, -0.2 * depth, s * w(0.3) * 0.9]]);
  const g = b.geometry();
  g.computeVertexNormals();
  return g;
}

// a requiem shark: fusiform, tall first dorsal, big pectorals, heterocercal tail (long upper lobe)
export function sharkGeo() {
  const g0 = fish({ depth: 0.17, width: 0.15, snout: 0.55, peak: 0.3, peduncle: 0.18, tail: 0.01, tailShape: 'trunc', dorsal: [0.3, 0.3, 0], anal: [0.66, 0.7, 0.4], pectoral: 0.001, ring: 10 });
  const b = new Build();
  b.p = Array.from(g0.attributes.position.array); b.n = Array.from(g0.attributes.normal.array); b.a = Array.from(g0.attributes.aux.array); b.i = Array.from(g0.index.array);
  const X = u => 0.4 - u, f = a => [a[0], a[1] / 0.085, Math.max(0, (a[0] - 0.2) / 0.8), 1];
  const fin = pts => { const ids = pts.map(p => b.vert(X(p[0]), p[1], p[2] || 0, 0, 0, 1, f(p))); for (let k = 1; k < ids.length - 1; k++) b.tri(ids[0], ids[k], ids[k + 1]); };
  fin([[0.3, 0.07], [0.36, 0.2], [0.42, 0.19], [0.46, 0.06]]);                       // first dorsal, swept back
  fin([[0.68, 0.045], [0.71, 0.085], [0.74, 0.04]]);                                 // second dorsal
  fin([[0.82, 0.01], [0.9, 0.06], [1.02, 0.2], [0.98, 0.17], [0.92, 0.03], [0.9, 0.0], [0.95, -0.1], [0.9, -0.08], [0.84, -0.02]]);  // tail: long upper lobe
  for (const s of [1, -1]) fin([[0.22, -0.04, s * 0.06], [0.36, -0.1, s * 0.2], [0.33, -0.1, s * 0.2], [0.3, -0.05, s * 0.07]]);   // pectorals
  const g = b.geometry(); g.computeVertexNormals(); return g;
}

// rays: a disc (or wings) and a tail; aux.z = distance out along the wing, for the stroke
export function batoid(kind) {
  const b = new Build(), NX = 14, NS = 9;
  // half span at chordwise position u (0 front .. 1 back of the disc), thickness, length of the disc
  const P = {
    ribbon: { span: u => 0.3 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.03)))), thick: 0.05, disc: 0.55, tail: 0.45, tailR: 0.012 },
    eagle: { span: u => 0.95 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, (u - 0.12) / 0.8))), 1.5) * (u > 0.12 ? 1 : 0) + 0.09 * Math.max(0, 1 - u * 5), thick: 0.06, disc: 0.4, tail: 1.6, tailR: 0.01 },
    manta: { span: u => 1.15 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u))), 1.3) * (1 - 0.45 * u) + 0.12, thick: 0.07, disc: 0.55, tail: 0.25, tailR: 0.012 }
  }[kind];
  const X = u => 0.4 - u * P.disc * 1.2;
  for (const face of [1, -1]) {
    const rows = [];
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, hs = P.span(u) + 0.002, row = [];
      for (let j = 0; j <= NS; j++) {
        const s = (j / NS) * 2 - 1, z = s * hs;
        const dome = (1 - s * s) * Math.sin(Math.PI * Math.min(1, u * 1.05)) * P.thick;
        const y = face > 0 ? dome : -dome * 0.35;
        row.push(b.vert(X(u), y, z, 0, face, 0, [u, s, Math.abs(z), face > 0 ? 0 : 1]));
      }
      rows.push(row);
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NS; j++) {
      const a = rows[i][j], c = rows[i][j + 1], d = rows[i + 1][j], e = rows[i + 1][j + 1];
      if (face > 0) { b.tri(a, c, d); b.tri(c, e, d); } else { b.tri(a, d, c); b.tri(c, d, e); }
    }
  }
  // tail
  const t0 = new V(X(1) + 0.02, 0, 0), t1 = new V(X(1) - P.tail, 0.0, 0);
  b.add(new THREE.CylinderGeometry(0.002, P.tailR, P.tail, 4, 1, false), between(t0, t1), v => [1 + (t0.x - v.x), 0, 0, 2]);
  if (kind === 'manta') for (const s of [1, -1]) b.add(new THREE.BoxGeometry(0.16, 0.012, 0.035), at(X(0) + 0.05, 0.0, s * 0.11, 0, s * 0.25, -0.5), () => [0, s, 0.05, 3]);   // cephalic fins
  const g = b.geometry(); g.computeVertexNormals(); return g;
}

// a sea turtle: domed carapace, plastron, head, long front flippers (aux.w = 3) and short rear ones (4)
export function turtle(o = {}) {
  const b = new Build(), beak = o.beak ?? 0;
  const top = new THREE.SphereGeometry(0.5, 20, 8, 0, TAU, 0, Math.PI / 2);
  b.add(top, at(0, 0, 0, 0, 0, 0, 1, 0.34, 0.8), v => [0.5 - v.x, 0, 0, 0]);
  const bot = new THREE.SphereGeometry(0.5, 20, 4, 0, TAU, Math.PI / 2, Math.PI / 2);
  b.add(bot, at(0, 0, 0, 0, 0, 0, 0.96, 0.1, 0.74), v => [0.5 - v.x, 0, 0, 1]);
  b.add(new THREE.SphereGeometry(0.1, 10, 6), at(0.55, 0.02, 0, 0, 0, -0.15 - beak, 1.3, 0.85, 0.85), v => [0, 0, 0, 2]);
  b.add(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8, 1, true), at(0.47, 0.0, 0, 0, 0, Math.PI / 2), v => [0, 0, 0, 2]);
  for (const s of [1, -1]) {
    b.add(new THREE.SphereGeometry(0.5, 10, 4), at(0.2, -0.02, s * 0.42, 0, -s * 0.6, 0, 0.17, 0.03, 0.5), v => [0, s, Math.abs(v.z) - 0.2, 3]);
    b.add(new THREE.SphereGeometry(0.5, 8, 3), at(-0.45, -0.02, s * 0.22, 0, -s * 0.8, 0, 0.12, 0.025, 0.26), v => [0, s, Math.abs(v.z) - 0.15, 4]);
  }
  return b.geometry();
}

// ================================================================ island trees (unit: metres of a typical tree; scaled per instance)
// aux.w: 0 foliage, 1 trunk; aux.x: height within the tree (0..1); aux.z: sway weight
const leafAux = (H) => v => [v.y / H, 0, Math.pow(Math.max(0, v.y / H), 2), 0];
const trunkAux = (H) => v => [v.y / H, 0, Math.pow(Math.max(0, v.y / H), 2) * 0.6, 1];
function blob(detail, seed, amp = 0.18) { return lumpy(detail, 6, amp, seed, -2, 1); }

// eucalypt (carbeen, Corymbia tessellaris): a straight pale trunk for half its height, then an open crown of clumps
export function eucalypt(lod) {
  // a clear bole for about half the height, a few limbs, and an open, irregular crown of foliage clumps
  const b = new Build(), r = rng(hash(201, lod)), H = 20, seg = lod === 2 ? 6 : 4;
  b.add(new THREE.CylinderGeometry(0.2, 0.38, 10.5, seg, 1, true), at(0, 5.25, 0), trunkAux(H));
  const limbs = lod === 2 ? 4 : 3, n = lod === 2 ? 11 : 3;
  const ends = [];
  for (let k = 0; k < limbs; k++) {
    const t = (k / limbs) * TAU + r() * 0.8, rr = 2 + r() * 2.2, e = new V(Math.cos(t) * rr, 14 + r() * 3, Math.sin(t) * rr);
    ends.push(e);
    if (lod === 2) b.add(new THREE.CylinderGeometry(0.07, 0.15, e.distanceTo(new V(0, 9.8, 0)), 4, 1, true), between(new V(0, 9.8, 0), e), trunkAux(H));
  }
  for (let k = 0; k < n; k++) {
    const e = ends[k % limbs], jx = (r() - 0.5) * 3.4, jz = (r() - 0.5) * 3.4, y = e.y + (r() - 0.3) * 2.6;
    const s = lod === 2 ? 1.5 + r() * 1.1 : 2.4 + r() * 0.9;
    b.add(blob(lod === 2 ? 1 : 0, hash(202, k, lod), 0.3), at(e.x + jx, y, e.z + jz, 0, r() * TAU, 0, s * 2.0, s * 1.15, s * 2.0), leafAux(H));
  }
  return b.geometry();
}
// hoop pine (Araucaria cunninghamii): a tall straight trunk with tufts of foliage at the ends of whorled branches
export function hoopPine(lod) {
  const b = new Build(), r = rng(hash(203, lod)), H = 30;
  b.add(new THREE.CylinderGeometry(0.15, 0.5, H, lod === 2 ? 6 : 4, 1, true), at(0, H / 2, 0), trunkAux(H));
  if (lod === 0) { b.add(new THREE.ConeGeometry(3.4, 18, 6, 1, true), at(0, H - 8.5, 0), leafAux(H)); return b.geometry(); }
  const tiers = lod === 2 ? 9 : 5;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1), y = 13 + f * (H - 13.5), reach = (1 - f) * 3.6 + 0.9, arms = lod === 2 ? 4 : 3;
    for (let a = 0; a < arms; a++) {
      const t = a / arms * TAU + k * 1.1 + r() * 0.5, ex = Math.cos(t) * reach, ez = Math.sin(t) * reach;
      if (lod === 2) b.add(new THREE.CylinderGeometry(0.04, 0.09, reach, 3, 1, true), between(new V(0, y - 0.3, 0), new V(ex, y + 0.6, ez)), trunkAux(H));
      const s = 1.2 + (1 - f) * 0.9;
      b.add(lod === 2 ? blob(0, hash(204, k, a), 0.25) : new THREE.OctahedronGeometry(0.5, 0), at(ex * 0.8, y + 0.6, ez * 0.8, 0, r() * TAU, 0, s * 2.2, s * 1.0, s * 2.2), leafAux(H));
    }
  }
  b.add(lod === 2 ? blob(0, hash(205), 0.2) : new THREE.OctahedronGeometry(0.5, 0), at(0, H + 0.4, 0, 0, 0, 0, 1.6, 2.6, 1.6), leafAux(H));
  return b.geometry();
}
// pandanus (Pandanus tectorius): leaning stems on prop roots, with spiral tufts of long strap leaves
export function pandanus(lod) {
  const b = new Build(), r = rng(hash(206, lod)), H = 6;
  const stems = lod === 2 ? 3 : 2;
  for (let k = 0; k < stems; k++) {
    const t = r() * TAU, lean = 0.5 + r() * 1.6, top = new V(Math.cos(t) * lean, 4.2 + r() * 1.4, Math.sin(t) * lean);
    b.add(new THREE.CylinderGeometry(0.1, 0.16, top.length(), lod === 2 ? 5 : 3, 1, true), between(new V(0, 0.6, 0), top), trunkAux(H));
    if (lod === 2) for (let p = 0; p < 4; p++) { const a = p / 4 * TAU + r(); b.add(new THREE.CylinderGeometry(0.035, 0.05, 1.3, 3, 1, true), between(new V(0, 0.9, 0), new V(Math.cos(a) * 0.8, -0.2, Math.sin(a) * 0.8)), trunkAux(H)); }
    if (lod < 2) { b.add(new THREE.IcosahedronGeometry(1.2, 0), at(top.x, top.y + 0.1, top.z, 0, r(), 0, 1.4, 0.75, 1.4), leafAux(H)); continue; }
    // a tuft: strap leaves radiating, arching down at the ends
    const L = lod === 2 ? 22 : 8;
    for (let l = 0; l < L; l++) {
      const a = l * 2.39996, el = 0.9 - (l / L) * 1.4, len = 1.5 + r() * 0.5;
      const d = new V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const seg = lod === 2 ? 3 : 1, w = 0.09, side = new V(-Math.sin(a), 0, Math.cos(a));
      const pts = []; for (let s = 0; s <= seg; s++) { const f = s / seg; pts.push(top.clone().addScaledVector(d, len * f).add(new V(0, -0.7 * f * f * len * 0.5, 0))); }
      const ids = pts.map((p, s) => { const ww = w * (1 - 0.7 * s / seg); return [b.vert(p.x - side.x * ww, p.y, p.z - side.z * ww, 0, 1, 0, leafAux(H)(p)), b.vert(p.x + side.x * ww, p.y, p.z + side.z * ww, 0, 1, 0, leafAux(H)(p))]; });
      for (let s = 0; s < seg; s++) { b.tri(ids[s][0], ids[s][1], ids[s + 1][0]); b.tri(ids[s][1], ids[s + 1][1], ids[s + 1][0]); }
    }
  }
  return b.geometry();
}
// casuarina (Casuarina equisetifolia): a she-oak with fine drooping grey-green branchlets, an open tapering crown
export function casuarina(lod) {
  // fine, drooping grey-green branchlets: the crown is a loose column of soft, hanging clumps
  const b = new Build(), r = rng(hash(207, lod)), H = 16;
  b.add(new THREE.CylinderGeometry(0.12, 0.3, H * 0.92, lod === 2 ? 5 : 3, 1, true), at(0, H * 0.46, 0), trunkAux(H));
  const n = lod === 2 ? 10 : 4;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1), y = 5.5 + f * (H - 6.5), reach = (1 - f) * 2.2 + 0.5 + r() * 0.6, t = k * 2.4 + r();
    const s = 1.1 + (1 - f) * 1.0 + r() * 0.4;
    b.add(blob(lod === 2 ? 1 : 0, hash(208, k, lod), 0.35), at(Math.cos(t) * reach, y - s * 0.4, Math.sin(t) * reach, 0, r() * TAU, 0, s * 1.5, s * 2.0, s * 1.5), leafAux(H));
  }
  return b.geometry();
}
// mangrove (Rhizophora stylosa): arching stilt roots and a dense, rounded dark crown
export function mangrove(lod) {
  const b = new Build(), r = rng(hash(208, lod)), H = 7;
  b.add(new THREE.CylinderGeometry(0.1, 0.16, 3.2, lod === 2 ? 5 : 3, 1, true), at(0, 2.6, 0), trunkAux(H));
  if (lod === 2) for (let k = 0; k < 7; k++) {
    const t = k / 7 * TAU + r() * 0.4, R = 1.1 + r() * 0.7, top = new V(0, 1.4 + r() * 0.5, 0), mid = new V(Math.cos(t) * R * 0.55, 1.5, Math.sin(t) * R * 0.55), foot = new V(Math.cos(t) * R, -0.3, Math.sin(t) * R);
    b.add(new THREE.CylinderGeometry(0.04, 0.05, top.distanceTo(mid), 3, 1, true), between(top, mid), trunkAux(H));
    b.add(new THREE.CylinderGeometry(0.04, 0.05, mid.distanceTo(foot), 3, 1, true), between(mid, foot), trunkAux(H));
  }
  const n = lod === 2 ? 5 : lod === 1 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const t = k / n * TAU + r(), rr = n === 1 ? 0 : 1.1 + r() * 0.6, s = n === 1 ? 3.3 : 2.0 + r() * 0.7;
    b.add(lod ? blob(lod === 2 ? 1 : 0, hash(209, k), 0.12) : new THREE.OctahedronGeometry(0.5, 0), at(Math.cos(t) * rr, 4.6 + r() * 1.2, Math.sin(t) * rr, 0, r() * TAU, 0, s * 1.9, s * 1.3, s * 1.9), leafAux(H));
  }
  return b.geometry();
}
// any tree far away: a coarse spindle, stretched per instance (crown width, height) and coloured per species
export function farTree() {
  // ten triangles: a pentagonal crown, rounded at the top; no trunk (it is a few pixels away)
  const b = new Build(), ring = [], top = b.vert(0, 1, 0, 0, 1, 0, [1, 0, 0, 0]), bot = b.vert(0, 0.25, 0, 0, -1, 0, [0.3, 0, 0, 0]);
  for (let k = 0; k < 5; k++) { const a = k / 5 * TAU, x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.5; ring.push(b.vert(x, 0.62, z, x, 0.35, z, [0.62, 0, 0, 0])); }
  for (let k = 0; k < 5; k++) { b.tri(top, ring[(k + 1) % 5], ring[k]); b.tri(bot, ring[k], ring[(k + 1) % 5]); }
  return b.geometry();
}

// ================================================================ particles
export function speck() { const b = new Build(); b.add(new THREE.OctahedronGeometry(0.5, 0), new THREE.Matrix4(), () => [0, 0, 0, 0]); return b.geometry(); }
export function quad() {
  const b = new Build();
  const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => b.vert(x, y, 0, 0, 0, 1, [x, y, 0, 0]));
  b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[3]);
  return b.geometry();
}
