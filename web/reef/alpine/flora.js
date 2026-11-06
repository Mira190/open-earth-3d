// Plants and stones round the camera on an alpine site, placed by land cover (build_alpine.py COVER):
// - tussock (silver tussock and fescue on the basin, snow tussock higher up): clumps of fine blades, straw-gold
//   with green at the base, swaying in the wind's gusts, glowing when the sun is behind them;
// - Russell lupins (Lupinus x russellii, naturalised): flower spikes in purple, pink, blue, white and yellow on the
//   lake shore, the riverbeds and the roadsides, in flower from late spring (the clock's month sets how many);
// - matagouri and briar on scrubland, and stones on scree, moraine and the riverbeds.
// All are instanced meshes refilled by tiles as the camera moves; each is lit by light.js like the land under it,
// mountains' shadows included.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, sin, cos, smoothstep, clamp, dot, normalize, length, uniform, positionLocal,
  positionWorld, cameraPosition, attribute, mx_noise_float, exp, pow, abs, instanceIndex, varying, uv, normalWorld, positionGeometry } from 'three/tsl';

const TILE = 24;
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// a hash in [0, 1): 32-bit multiplies (Math.imul) and an unsigned result (a plain ^ gives a signed int, which put half
// of every draw below zero)
const hash2 = (i, j, k = 0) => { let h = (i * 374761393 + j * 668265263 + k * 1442695041) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---- geometry
function tussockGeometry(blades = 64, segs = 4, wMul = 1) {
  seed = 7;
  const pos = [], nrm = [], uvs = [], idx = [];
  for (let b = 0; b < blades; b++) {
    // a dense mound: most blades near upright, the outer ones arching over
    const a = rnd() * Math.PI * 2, outer = rnd(), lean = 0.08 + outer * outer * 0.75, len = 0.32 + rnd() * 0.38, w = (0.006 + rnd() * 0.007) * wMul;
    const r0 = 0.03 + outer * 0.1, base = pos.length / 3;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, out = r0 + lean * len * t * t * 0.9, up = len * (t - 0.32 * lean * t * t);
      const ww = w * (1 - t * 0.85);
      for (const side of [-1, 1]) {
        pos.push(dx * out + px * ww * side, up, dz * out + pz * ww * side);
        const n = new THREE.Vector3(dx * (0.4 + t), 1 - lean * t, dz * (0.4 + t)).normalize();
        nrm.push(n.x, n.y, n.z); uvs.push(side * 0.5 + 0.5, t);
      }
      if (s < segs) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  return g;
}
// a Russell lupin plant (Lupinus x russellii): a mound of palmate leaves, each a fan of narrow leaflets on its own
// stalk, under several flower spikes of different heights, the tallest in the middle. A clump is one geometry, drawn
// instanced. uv.x: 0 on leaves and stems, 0.5..1 on a spike (its own random, for its shade); uv.y: up the spike, 0 at
// its foot.
//   detail: florets raised in whorls on the spikes (near); without, plain cones (further out)
//   spread: the stalks scattered over a disc of that radius, each over a small dome of leaves (a far patch of plants)
function lupinGeometry({ spikes = 9, leaves = 15, leaflets = 11, radial = 6, rows = 11, detail = true, spread = 0, sd = 23 } = {}) {
  seed = sd;
  const parts = [];
  const m4 = new THREE.Matrix4(), rq = new THREE.Quaternion(), ax = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let s = 0; s < spikes; s++) {
    const a = rnd() * Math.PI * 2;
    const r = spread ? Math.sqrt(rnd()) * spread : (s === 0 ? 0 : 0.05 + rnd() * 0.16);
    // the middle spike tallest, the outer ones shorter and leaning out (0.5 to 1.2 m, as in photographs of the shore)
    const top = spread ? 0.55 + rnd() * 0.5 : (s === 0 ? 0.98 + rnd() * 0.14 : 0.52 + rnd() * 0.42);
    const len = Math.min(top - (spread ? 0.16 : 0.12), 0.24 + rnd() * 0.14 + (top - 0.5) * 0.35);
    const rad = (spread ? 0.05 : 0.034) + rnd() * 0.016, tipR = 0.006;
    const spike = new THREE.CylinderGeometry(tipR, rad, len, radial, rows, true).translate(0, top - len / 2, 0);
    const pp = spike.attributes.position, uu = spike.attributes.uv, tint = 0.5 + 0.5 * rnd(), ph = rnd() * 6.28;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i), t = Math.min(1, Math.max(0, (y - (top - len)) / len));
      // a spike's outline: nearly as thick as its foot for most of its length, then tapering to the buds (not a cone)
      let k = Math.max(tipR, rad * (1 - 0.88 * Math.pow(t, 2.4))) / (rad + (tipR - rad) * t);
      if (detail) {
        // florets: whorls of pea flowers standing out from the spike, smaller toward the buds at the tip
        const aa = Math.atan2(z, x);
        k *= 1 + 0.8 * (1 - t * 0.55) * Math.max(0, Math.sin(t * len * 190 + ph) * Math.cos(aa * 4 + t * 11 + ph));
      }
      pp.setXYZ(i, x * k, y, z * k);
      uu.setXY(i, tint, t);
    }
    spike.computeVertexNormals();
    const stalk = [spike];
    if (!spread) {
      const stem = new THREE.CylinderGeometry(0.005, 0.008, top - len, 4, 1, true).translate(0, (top - len) / 2, 0);
      const su = stem.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, 0, 0);
      stalk.push(stem);
    }
    // lean out from the middle, then stand at its place in the clump
    const lean = spread ? (rnd() - 0.5) * 0.25 : r * 1.1 + (rnd() - 0.5) * 0.12;
    ax.set(-Math.sin(a), 0, Math.cos(a));
    rq.setFromAxisAngle(ax, -lean);
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), rq, one);
    for (const g of stalk) { g.applyMatrix4(m4); parts.push(g); }
    if (spread) {
      const d = new THREE.OctahedronGeometry(0.2, 0).scale(1.1, 0.6, 1.1).translate(Math.cos(a) * r, 0.1, Math.sin(a) * r);
      const du = d.attributes.uv; for (let i = 0; i < du.count; i++) du.setXY(i, 0, 0);
      parts.push(d);
    }
  }
  // the leaves: palmate, a fan of narrow leaflets at the end of each leaf stalk, held out round the crown
  const pos = [], nrm = [], uvs = [];
  const tri = (a, b, c, n) => { for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); uvs.push(0, 0); } };
  for (let l = 0; l < leaves; l++) {
    const a = (l / leaves) * Math.PI * 2 + rnd() * 0.5, rr = 0.08 + rnd() * 0.24, y = 0.1 + rnd() * 0.3 * (1 - rr * 1.5) + 0.04;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, tilt = 0.25 + rnd() * 0.35;
    // the leaf stalk from the crown, a thin ribbon
    const px = -Math.sin(a) * 0.003, pz = Math.cos(a) * 0.003;
    tri([px, 0.03, pz], [-px, 0.03, -pz], [cx, y, cz], [0, 0, 1]);
    const L0 = 0.08 + rnd() * 0.045;
    for (let f = 0; f < leaflets; f++) {
      const b = (f / leaflets) * Math.PI * 2 + rnd() * 0.2, L = L0 * (0.8 + rnd() * 0.3), w = L * 0.17;
      // each leaflet out and a little up from the leaf's middle, the fan tipped up on its outer side
      const dx = Math.cos(b), dz = Math.sin(b), up = Math.sin(tilt) * (dx * Math.cos(a) + dz * Math.sin(a)) + 0.12;
      const qx = -dz, qz = dx;
      const tip = [cx + dx * L, y + up * L, cz + dz * L], mid = [cx + dx * L * 0.45, y + up * L * 0.45 + 0.004, cz + dz * L * 0.45];
      const lft = [mid[0] + qx * w, mid[1], mid[2] + qz * w], rgt = [mid[0] - qx * w, mid[1], mid[2] - qz * w], o = [cx, y, cz];
      const n = new THREE.Vector3(-dx * up * 0.6, 1, -dz * up * 0.6).normalize().toArray();
      tri(o, lft, tip, n); tri(o, tip, rgt, n);
    }
  }
  if (leaves) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    parts.push(g);
  }
  return mergeAll(parts);
}
// a tuft of short grass for the turf round the eye: thin blades 9 to 28 cm, two bends each, splayed from one foot.
// uv.x: the blade's own random (its shade), uv.y: up the blade
function turfGeometry(blades = 15) {
  seed = 41;
  const pos = [], nrm = [], uvs = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r0 = Math.sqrt(rnd()) * 0.13, len = 0.09 + rnd() * 0.19, lean = 0.15 + rnd() * 0.55, w = 0.008 + rnd() * 0.006;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx, base = pos.length / 3, shade = rnd();
    for (let s = 0; s <= 2; s++) {
      const t = s / 2, out = r0 + lean * len * t * t * 0.8, upY = len * (t - 0.25 * lean * t * t), ww = w * (1 - t * 0.9);
      for (const side of [-1, 1]) {
        pos.push(dx * out + px * ww * side, upY, dz * out + pz * ww * side);
        const n = new THREE.Vector3(dx * (0.3 + t * 0.6), 1, dz * (0.3 + t * 0.6)).normalize();
        nrm.push(n.x, n.y, n.z); uvs.push(shade, t);
      }
      if (s < 2) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  return g;
}
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  seed = 11;
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const k = 0.75 + 0.5 * hash2(Math.round(v.x * 10), Math.round(v.y * 10), Math.round(v.z * 10)); p.setXYZ(i, v.x * k, v.y * k * 0.62, v.z * k); }
  g.computeVertexNormals();
  return g;
}
function shrubGeometry(stems = 46) {
  // matagouri: a tangle of stiff grey twigs, crooked at each joint, splaying from the foot into an open dome about a
  // metre high, with side twigs (the spines) off each; thin ribbons, their normals pointing out of the dome so it is lit
  // as a dome. uv.y: up the twig, for the green of the tiny leaves toward the tips
  seed = 53;
  const pos = [], nrm = [], uvs = [], idx = [];
  const ribbon = (pts, w) => {
    const base = pos.length / 3;
    pts.forEach(([x, y, z, t], s) => {
      const out = new THREE.Vector3(x, Math.max(y - 0.25, 0) * 0.6, z).normalize();
      const nx = s < pts.length - 1 ? pts[s + 1] : pts[s - 1], dx = nx[0] - x, dz = nx[2] - z, l = Math.hypot(dx, dz) || 1;
      const px = -dz / l * w * (1 - t * 0.7), pz = dx / l * w * (1 - t * 0.7);
      for (const side of [-1, 1]) { pos.push(x + px * side, y, z + pz * side); nrm.push(out.x, out.y + 0.3, out.z); uvs.push(0, t); }
      if (s < pts.length - 1) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    });
  };
  for (let s = 0; s < stems; s++) {
    const a = rnd() * Math.PI * 2, lean = 0.35 + rnd() * 0.75, len = 0.55 + rnd() * 0.6;
    let x = (rnd() - 0.5) * 0.12, y = 0, z = (rnd() - 0.5) * 0.12, h = a;
    const pts = [[x, y, z, 0]];
    for (let j = 1; j <= 4; j++) {
      h += (rnd() - 0.5) * 0.9;
      const el = Math.PI / 2 - lean * (0.6 + j * 0.15), sl = len / 4;
      x += Math.cos(h) * Math.cos(el) * sl; z += Math.sin(h) * Math.cos(el) * sl; y += Math.sin(el) * sl;
      pts.push([x, y, z, j / 4]);
      if (j > 1 && rnd() < 0.8) {
        // a side twig, short and stiff
        const b = h + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6), sl2 = 0.1 + rnd() * 0.12;
        ribbon([[x, y, z, j / 4], [x + Math.cos(b) * sl2, y + sl2 * 0.35, z + Math.sin(b) * sl2, 1]], 0.006);
      }
    }
    ribbon(pts, 0.011);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  return g;
}
function mergeAll(geos) {
  const pos = [], nrm = [], uvs = [], idx = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); out.setIndex(idx);
  return out;
}

// the share of lupins in flower by month: September to February (NZPCN), November to February on the Mackenzie's
// riverflats (DOC's braided river field guide), at their best from mid November to the end of December
// An instanced set split by where its instances stand round the camera when it is filled: one part within `near` metres
// and eight sectors beyond, each with its own bounds, so the renderer leaves out the parts outside the view. Drawn as one
// ring, a set spent most of its triangles behind the camera. attrs: the instanced attributes beside the matrix, as
// [name, itemSize]; `max` caps the whole set as before (a full set leaves out the furthest, which are put last).
class Ring {
  constructor(geo, mat, max, attrs, { near = 16, margin = 2.5, name = '' } = {}) {
    this.max = Math.max(1, max); this.near = near; this.margin = margin; this.attrs = attrs; this.parts = []; this.n = 0;
    this.group = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const cap = Math.max(1, Math.ceil(this.max * (i === 0 ? 0.6 : 0.35)));
      const g = new THREE.BufferGeometry(); g.setIndex(geo.index);
      for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
      const a = attrs.map(([k, sz]) => { const b = new THREE.InstancedBufferAttribute(new Float32Array(cap * sz), sz); g.setAttribute(k, b); return b; });
      const m = new THREE.InstancedMesh(g, mat, cap); m.count = 0; m.visible = false; m.name = `${name}:${i}`;
      m.boundingSphere = new THREE.Sphere(); m.boundingBox = new THREE.Box3();
      this.group.add(m);
      this.parts.push({ m, a, cap, n: 0, box: new THREE.Box3() });
    }
  }
  layer(l) { for (const p of this.parts) p.m.layers.set(l); return this; }
  begin(cx, cz) { this.cx = cx; this.cz = cz; this.n = 0; for (const p of this.parts) { p.n = 0; p.box.makeEmpty(); } }
  get full() { return this.n >= this.max; }
  // one instance: its matrix (m4, whose translation places it) and its attributes' values in `attrs` order
  put(m4, ...vals) {
    if (this.n >= this.max) return false;
    const e = m4.elements, dx = e[12] - this.cx, dz = e[14] - this.cz;
    const i = dx * dx + dz * dz < this.near * this.near ? 0 : 1 + (Math.floor((Math.atan2(dz, dx) / (2 * Math.PI) + 1) * 8) % 8);
    const p = this.parts[i];
    if (p.n >= p.cap) return false;
    p.m.setMatrixAt(p.n, m4);
    for (let k = 0; k < vals.length; k++) { const v = vals[k], a = p.a[k], o = p.n * a.itemSize; for (let c = 0; c < v.length; c++) a.array[o + c] = v[c]; }
    p.box.expandByPoint(_v.set(e[12], e[13], e[14]));
    p.n++; this.n++;
    return true;
  }
  end() {
    for (const p of this.parts) {
      p.m.count = p.n; p.m.visible = p.n > 0;
      if (!p.n) continue;
      p.m.instanceMatrix.needsUpdate = true;
      for (const a of p.a) { a.needsUpdate = true; }
      p.box.expandByScalar(this.margin);
      p.m.boundingBox.copy(p.box); p.box.getBoundingSphere(p.m.boundingSphere);
    }
  }
}
const _v = new THREE.Vector3();

const BLOOM = [0.6, 0.25, 0, 0, 0, 0, 0, 0, 0.08, 0.3, 0.75, 1.0];

export async function init(ctx) {
  const { scene, env, camera, S } = ctx;
  if (S.kind !== 'alpine' || !ctx.light) return null;
  const light = ctx.light, terrain = ctx.terrain;
  // how many plants, how far out, and in what form: by the picture tier (web/reef/tier.js), as the cities degrade
  const tier = ctx.tier || { flora: Math.min(innerWidth, innerHeight) < 700 ? 0.55 : 1, simple: false, turf: 1, mirrorFlora: true };
  const quality = tier.flora;
  if (!quality) return null;
  // nothing grows on the seal (terrain.js's road field, read here as the GPU paints it), which is laid before the plants
  const roads = ctx.terrain.roads;
  if (roads) { await roads.ready; roads.update(camera.position); }
  const onRoad = (x, n) => !!roads && roads.flatJS(x, n) > 0.35;
  const wind = env.u.wind, time = env.u.time;
  const windDir = new THREE.Vector2(Math.sin(125 * Math.PI / 180), -Math.cos(125 * Math.PI / 180));
  const wd = uniform(windDir);

  // the wind in the grass: gusts that roll across the land with the wind, bending the tips most
  const sway = (P0, h, stiff) => {
    const P = vec3(P0.x, 0, P0.y);
    const g = mx_noise_float(vec3(P.x.mul(0.05).sub(time.mul(wd.x).mul(0.9)), time.mul(0.15), P.z.mul(0.05).sub(time.mul(wd.y).mul(0.9)))).mul(0.5).add(0.6);
    const flutter = sin(time.mul(3.1).add(P.x.mul(1.7)).add(P.z.mul(1.3))).mul(0.18);
    const bend = h.mul(h).mul(wind.mul(0.35).add(0.05)).mul(g.add(flutter)).div(stiff);
    return vec3(wd.x, 0, wd.y).mul(bend);
  };
  const lit = (alb, N, P, trans) => {
    // light through thin leaves when the sun is behind them, from the eye's side
    const V = normalize(cameraPosition.sub(P));
    const back = pow(max(dot(V.negate(), light.u.sunDir), 0), 4).mul(trans);
    return light.shade(alb, N, P).add(vec3(light.u.sunE).mul(alb).mul(back.mul(light.sunVis(P)).mul(0.22)));
  };

  // ---- tussock
  const tGeo = tier.simple ? tussockGeometry(40, 3) : tussockGeometry(), tMax = Math.round(2600 * quality);
  const tfGeo = tier.simple ? tussockGeometry(12, 2, 2.6) : tussockGeometry(18, 2, 2.2), tfMax = Math.round(14000 * quality);
  const tMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const tTint = attribute('aTint', 'vec3');
  // (on an instanced mesh the position node already sees the instance's transform: the height off the ground is the geometry's own)
  tMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y, 1)))();
  tMat.colorNode = Fn(() => {
    const t = uv().y;
    const base = mix(vec3(0.16, 0.17, 0.08), vec3(0.58, 0.46, 0.25), smoothstep(0.0, 0.6, t));
    const alb = mix(base, base.mul(vec3(1.15, 1.1, 0.95)), smoothstep(0.7, 1.0, t)).mul(tTint);
    const N = normalize(mix(vec3(0, 1, 0), normalize(normalWorld), 0.4));
    return lit(alb, N, positionWorld, float(1)).mul(t.mul(0.55).add(0.45));    // self-shadowed low in the clump
  })();
  const tussock = new Ring(tGeo, tMat, tMax, [['aTint', 3], ['aPos', 2]], { near: 10, margin: 1.5, name: 'tussock' });
  // beyond 28 m a clump of 18 broader blades stands in for the 64
  const tussockFar = new Ring(tfGeo, tMat, tfMax, [['aTint', 3], ['aPos', 2]], { margin: 1.5, name: 'tussock-far' });

  // ---- lupins: whole plants near the eye, plainer plants further out, and beyond those patches of several plants
  // in one instance, so a drift on a shore a few hundred metres away still reads as a band of colour
  const lMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const lCol = attribute('aFlower', 'vec4');      // rgb flower colour, a: in flower (0..1)
  lMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y, 2.2)))();
  lMat.colorNode = Fn(() => {
    const tier = uv().y, sv = uv().x, isSpike = sv.greaterThan(0.25);
    const P = positionWorld, dist = length(P.sub(cameraPosition));
    // each spike its own shade of the plant's colour
    const col = lCol.xyz.mul(sv.sub(0.75).mul(0.5).add(1));
    // florets open from the foot of the spike up; above the open ones, buds showing a little of their colour
    const open = float(1).sub(smoothstep(lCol.w.mul(0.92).sub(0.06), lCol.w.mul(0.92).add(0.06), tier));
    // each whorl's upper petal (the banner) paler than the wings and keel below it, seen close to
    // (a speckle of single flowers rather than rings round the spike)
    const fl0 = mx_noise_float(P.mul(42)), close = float(1).sub(smoothstep(8, 35, dist));
    const whorl = smoothstep(0.15, 0.7, fl0).mul(close), gap = float(1).sub(smoothstep(-0.65, -0.2, fl0)).mul(close);
    // the lower florets deeper in colour, the upper ones paler toward the buds
    const flower = mix(col, col.mul(1.25).add(0.1), whorl.mul(0.6)).mul(mix(0.78, 1.08, tier)).mul(float(1).sub(gap.mul(0.35)));
    const fl = mix(mix(vec3(0.2, 0.3, 0.14), col.mul(1.1), 0.62), flower, open);
    // leaves a soft mid green, darker deep in the mound
    const lv = mx_noise_float(P.mul(4.0)).mul(0.12).add(1);
    const leaf = vec3(0.075, 0.18, 0.06).mul(lv);
    const ao = smoothstep(0.0, 0.42, positionGeometry.y).mul(0.55).add(0.45);
    const alb = isSpike.select(fl, leaf.mul(ao));
    const N = isSpike.select(normalize(normalWorld), normalize(mix(vec3(0, 1, 0), normalize(normalWorld), 0.6)));
    return lit(alb, N, P, isSpike.select(float(0.35), float(0.45)));
  })();
  const lupinMesh = (geo, max, near, name) => new Ring(geo, lMat, max, [['aFlower', 4], ['aPos', 2]], { near, margin: 2.5, name });
  const lupNear = lupinMesh(tier.simple ? lupinGeometry({ spikes: 7, leaves: 9, leaflets: 9, radial: 5, rows: 8 }) : lupinGeometry(), Math.round(2600 * quality), 5, 'lupin-near');
  const lupMid = lupinMesh(lupinGeometry({ spikes: 5, leaves: 6, leaflets: 7, radial: 4, rows: 2, detail: false, sd: 29 }), Math.round(14000 * quality), 16, 'lupin-mid');
  const lupFar = lupinMesh(lupinGeometry({ spikes: 9, leaves: 0, radial: 3, rows: 1, detail: false, spread: 1.4, sd: 31 }), Math.round(14000 * quality), 80, 'lupin-far');

  // ---- stones and shrubs
  const rGeo = rockGeometry(), rMax = Math.round(6000 * quality);
  const rMat = new THREE.MeshBasicNodeMaterial();
  const rTint = attribute('aTint', 'vec3');
  rMat.colorNode = Fn(() => {
    const P = positionWorld;
    const n = mx_noise_float(P.mul(3.0)).mul(0.15).add(mx_noise_float(P.mul(11.0)).mul(0.08));
    const alb = vec3(0.42, 0.41, 0.39).mul(rTint).mul(float(1).add(n));
    return light.shade(alb, normalize(normalWorld), P);
  })();
  const rocks = new Ring(rGeo, rMat, rMax, [['aTint', 3]], { near: 10, margin: 2, name: 'stones' });
  const sGeo = shrubGeometry(tier.simple ? 28 : 46), sfGeo = shrubGeometry(14), sMax = Math.round(1500 * quality);
  const sMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  sMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y.mul(0.3), 3)))();
  sMat.colorNode = Fn(() => {
    const P = positionWorld;
    const n = mx_noise_float(P.mul(6.0)).mul(0.25);
    // grey bark, greener toward the tips where the tiny leaves are, darker deep in the tangle
    const alb = mix(vec3(0.085, 0.08, 0.065), vec3(0.11, 0.14, 0.07), smoothstep(0.3, 1.0, uv().y)).mul(float(1).add(n)).mul(smoothstep(0.0, 0.5, positionGeometry.y).mul(0.5).add(0.5));
    return lit(alb, normalize(normalWorld), P, float(0.4));
  })();
  const shrubs = new Ring(sGeo, sMat, sMax, [['aPos', 2]], { margin: 2.5, name: 'matagouri' });
  // beyond 40 m a bush of 14 twigs stands in for the 46: at that range a twig is under a pixel wide
  const shrubsFar = new Ring(sfGeo, sMat, sMax, [['aPos', 2]], { margin: 2.5, name: 'matagouri-far' });
  // ---- the turf: short grass round the eye on the grassy ground, tinted from the ground's own colour under each tuft
  // (the 10 m mosaic), darker at the foot and a little richer than the ground, so at eye level the grass reads as
  // grass rather than as a photograph seen edge on. It thins with distance and shrinks away before TURF_R in the
  // shader, so its edge never shows as the camera moves
  const TURF_R = 40 * Math.sqrt(quality), turfDens = (quality < 1 ? 0.6 : 1) * (tier.turf ?? 1);
  const gGeo = turfGeometry(), gMax = Math.round(12000 * quality * turfDens);
  const gMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const gTint = attribute('aTint', 'vec3'), gBase = attribute('aBase', 'vec3');
  gMat.positionNode = Fn(() => {
    const d = length(vec2(gBase.x, gBase.z).sub(vec2(cameraPosition.x, cameraPosition.z)));
    const k = float(1).sub(smoothstep(TURF_R * 0.6, TURF_R, d));
    const p = gBase.add(positionLocal.sub(gBase).mul(k));
    return p.add(sway(vec2(gBase.x, gBase.z), positionGeometry.y.mul(2.2), 1.3).mul(k));
  })();
  gMat.colorNode = Fn(() => {
    const t = uv().y, b = uv().x;
    // living blades, a fresh spring green, each its own shade, and one in twelve a dry straw one; seen from the side a
    // blade shows its own green, not the dry litter and soil the mosaic mixes in from above, so the ground's colour
    // under the tuft only leans it (a third), a little richer than the mosaic (its saturation raised by a third)
    const green = mix(vec3(0.06, 0.14, 0.03), vec3(0.10, 0.20, 0.05), b.mul(11.7).fract());
    const blade = b.greaterThan(0.92).select(vec3(0.30, 0.24, 0.12), green);
    const lum = dot(gTint, vec3(0.2126, 0.7152, 0.0722));
    const rich = mix(vec3(lum), gTint, 1.35).max(0);
    // dark at the foot, where the blades shade each other
    const alb = mix(blade, rich, 0.3).mul(mix(0.42, 1.08, smoothstep(0.0, 0.9, t)));
    const N = normalize(mix(vec3(0, 1, 0), normalize(normalWorld), 0.35));
    return lit(alb, N, positionWorld, float(0.9));
  })();
  const turf = new Ring(gGeo, gMat, gMax, [['aTint', 3], ['aBase', 3]], { near: 6, margin: 1, name: 'turf' });
  // the lake's mirror (layer 0) leaves out what is too small to read in a wind-blurred reflection (layer 1): the turf, the
  // tussock, the stones, the matagouri and the far lupin patches always, and every lupin below the high tier (the
  // mirror draws the scene again, and with every plant in it cost as much as the view)
  for (const r of [tussock, tussockFar, rocks, turf, shrubs, shrubsFar, lupFar]) r.layer(1);
  if (!tier.mirrorFlora) for (const r of [lupNear, lupMid]) r.layer(1);
  for (const r of [tussock, tussockFar, lupNear, lupMid, lupFar, rocks, shrubs, shrubsFar, turf]) scene.add(r.group);

  // ---- placement by tiles round the camera
  // wild stands run blue to purple (Wikipedia: Lupinus polyphyllus), with pinks, white and a few yellow (NZPCN, DOC);
  // no count of the shares is published, so these are a judgement from photographs
  const LUPINS = [[0.30, 0.22, 0.70], [0.45, 0.20, 0.62], [0.66, 0.22, 0.50], [0.82, 0.40, 0.62], [0.88, 0.86, 0.82], [0.86, 0.68, 0.16]];
  // (white kept to one in twelve: at a fifth of the plants a dense stand read as a field of white candles)
  const LUPW = [0.30, 0.26, 0.17, 0.15, 0.08, 0.04];
  const pickLupin = r => { let a = 0; for (let i = 0; i < LUPW.length; i++) { a += LUPW[i]; if (r < a) return LUPINS[i]; } return LUPINS[0]; };
  const month = () => new Date(ctx.clockMs ? ctx.clockMs() : Date.now()).getUTCMonth();   // NZ is ahead of UTC: within a day, fine for a season
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let lastKey = '';
  function fill(cam) {
    const tx = Math.floor(cam.x / TILE), tn = Math.floor(-cam.z / TILE);
    const key = tx + ',' + tn + ',' + month();
    if (key === lastKey) return; lastKey = key;
    for (const r of [tussock, tussockFar, rocks, shrubs, shrubsFar]) r.begin(cam.x, cam.z);
    const R = { t: 95 * Math.sqrt(quality), r: 110 * Math.sqrt(quality), s: 220 * Math.sqrt(quality) };
    const span = Math.ceil(R.s / TILE);
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
      const ci = tx + i, cj = tn + j;
      const cxm = (ci + 0.5) * TILE, cnm = (cj + 0.5) * TILE;
      const dc = Math.hypot(cxm - cam.x, cnm + cam.z);
      if (dc > R.s + TILE) continue;
      // a fixed set of candidate spots per tile, by hash, so a tile looks the same whenever it comes back
      const K = dc < R.t + TILE ? 200 : 60;           // tussock wants many spots; further out only shrubs
      for (let k = 0; k < K; k++) {
        const hx = hash2(ci, cj, k * 3), hn = hash2(ci, cj, k * 3 + 1), hk = hash2(ci, cj, k * 3 + 2);
        const x = (ci + hx) * TILE, n = (cj + hn) * TILE;
        const dd = Math.hypot(x - cam.x, n + cam.z);
        if (dd > R.s) continue;
        const cls = ctx.habitat(x, n);
        if (cls === 0 || cls === 13 || cls === 14 || cls === 2 || cls === 11 || cls === 10) continue;
        const maybe = ((cls === 7 || cls === 8 || cls === 12) && dd < R.t) ||
          ((cls === 4 || cls === 5 || cls === 6 || cls === 3 || cls === 15) && dd < R.r) || cls === 9 || cls === 7;
        if (!maybe) continue;
        if (ctx.depth(x, n) > -0.05 || onRoad(x, n)) continue;        // not in the water, nor on a sealed road
        const h = terrain.heightAt(x, n);
        pv.set(x, h, -n);
        const clump = mx2(x, n);
        if ((cls === 7 || cls === 8 || cls === 12) && dd < R.t && hk < (cls === 8 ? 0.6 : 1.0) * (0.55 + 0.45 * clump)) {
          const near = dd < 28;
          if (!(near ? tussock : tussockFar).full) {
            const s = 0.65 + hash2(ci, cj, k + 500) * 0.55;
            q.setFromAxisAngle(up, hk * 40); sc.set(s, s * (0.8 + 0.4 * hash2(ci, cj, k + 900)), s);
            m4.compose(pv, q, sc);
            const g = 0.75 + 0.3 * hash2(ci, cj, k + 77);
            (near ? tussock : tussockFar).put(m4, [g, g * (0.95 + 0.1 * clump), g * 0.9], [x, -n]);
          }
        }
        // stones on the shore and the gravel, but few inside a lupin stand: its plants cover the ground
        const inStand = (cls === 15 || cls === 6) && hash2(ci, cj, k + 450) < lupinMask(x, n, cls) * 0.9;
        if ((cls === 4 || cls === 5 || cls === 6 || cls === 3 || cls === 15) && !inStand && dd < R.r && !rocks.full && hk < (cls === 6 ? 0.55 : 0.85)) {
          // (most small, a few boulders; the sizes the stones had before the hash was fixed, when half its draws were negative)
          const s = (cls === 4 || cls === 3 ? 0.3 : 0.12) + Math.pow(hash2(ci, cj, k + 400), 3) * (cls === 4 ? 1.2 : 0.5);
          q.setFromEuler(new THREE.Euler(hk * 3, hk * 17, hn * 5)); sc.set(s, s, s);
          pv.y = h - s * 0.25;
          const g = 0.6 + 0.45 * hash2(ci, cj, k + 600);
          rocks.put(m4.compose(pv, q, sc), [g, g * 0.98, g * 0.95]);
        }
        if ((cls === 9 || (cls === 7 && hk > 0.985)) && dd < R.s && !(dd < 40 ? shrubs : shrubsFar).full && hk > 0.75) {
          const s = 0.7 + hash2(ci, cj, k + 800) * 0.8;
          q.setFromAxisAngle(up, hk * 30); sc.set(s * 1.2, s, s * 1.2);
          pv.y = h;
          (dd < 40 ? shrubs : shrubsFar).put(m4.compose(pv, q, sc), [x, -n]);
        }
      }
    }
    for (const r of [tussock, tussockFar, rocks, shrubs, shrubsFar]) r.end();
  }
  // clumps: a low-frequency field so plants come in drifts, not evenly
  const mx2 = (x, n) => { const v = Math.sin(x * 0.043 + Math.sin(n * 0.031) * 2.1) * 0.5 + Math.sin(n * 0.057 - Math.sin(x * 0.027) * 1.7) * 0.5; return v * 0.5 + 0.5; };

  // ---- lupin drifts
  // value noise for the stands' outlines and their colours (the same hash as the placement)
  const vn = (x, y, s) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), e = hash2(i + 1, j + 1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + e) * ux * uy;
  };
  const ramp = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // stands tens of metres across with gaps of open gravel and grass between them, ragged at their edges
  const stand = (x, n) => ramp(0.36, 0.54, vn(x / 64, n / 64, 11) * 0.55 + vn(x / 21, n / 21, 12) * 0.3 + vn(x / 7, n / 7, 13) * 0.15);
  // where they grow: the shore and the riverbed gravel; the road verges; the grass, tussock and scrub slopes above a
  // shore, a lake or a riverbed, thickest within 30 m of the water and thinning out to 90 m (the ground a seed washes or
  // blows onto); the site's own drifts on top. By 10 m cell (the cover is 20 m), kept, since the ground does not change
  const RINGS = [14, 30, 60, 90].map(r => [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.71, r * 0.71], [-r * 0.71, r * 0.71], [r * 0.71, -r * 0.71], [-r * 0.71, -r * 0.71]]);
  const WET = [1, 0.95, 0.6, 0.35];
  function groundAt(x, n, cls) {
    if (cls === 15 || cls === 6) return 1;
    if (!(cls === 7 || cls === 8 || cls === 9 || cls === 11 || cls === 12 || cls === 5)) return 0;
    const k = cls === 5 || cls === 9 ? 0.65 : 1;
    let road = false;
    for (let r = 0; r < RINGS.length; r++) for (const [dx, dn] of RINGS[r]) {
      const c = ctx.habitat(x + dx, n + dn);
      if (c === 15 || c === 0 || c === 6) return WET[r] * k;
      if (r === 0 && c === 13) road = true;
    }
    return road ? 0.8 * k : 0;
  }
  const groundCache = new Map();
  const lupinGround = (x, n) => {
    const ci = Math.floor(x / 10), cj = Math.floor(n / 10), key = (ci + 50000) * 100000 + cj + 50000;
    let v = groundCache.get(key);
    if (v === undefined) {
      if (groundCache.size > 400000) groundCache.clear();
      const cx = (ci + 0.5) * 10, cn = (cj + 0.5) * 10;
      v = groundAt(cx, cn, ctx.habitat(cx, cn)); groundCache.set(key, v);
    }
    return v;
  };
  const patches = (S.flora && S.flora.lupins) || [];
  const patchAt = (x, n) => {
    let m = 0;
    for (const p of patches) { const r = p.r_m || 60, d = Math.hypot(x - p.x, n - p.y); if (d < r) m = Math.max(m, (p.density ?? 0.6) * (1 - ramp(r * 0.55, r, d))); }
    return m;
  };
  function lupinMask(x, n, cls) {
    if (cls === 0 || cls === 13 || cls === 2 || cls === 1 || cls === 3 || cls === 4 || cls === 10) return 0;
    const p = patches.length ? patchAt(x, n) : 0;
    // the land cover's "built" (yards, the grounds round a church) takes only the site's own drifts
    if (cls === 14) return p ? p * (0.7 + 0.3 * stand(x, n)) : 0;
    const st = stand(x, n);
    if (st === 0 && p === 0) return 0;
    return Math.max(lupinGround(x, n) * st, p * (0.7 + 0.3 * st));
  }
  // a tile with no lupin ground in it is skipped (kept, since the ground does not change)
  const tileSeen = new Map();
  const tileHasLupins = (ci, cj, size) => {
    const key = size + ':' + ci + ',' + cj;
    let v = tileSeen.get(key);
    if (v === undefined) {
      v = false;
      for (let a = 0; a < 4 && !v; a++) for (let b = 0; b < 4 && !v; b++) {
        const x = (ci + (a + 0.5) / 4) * size, n = (cj + (b + 0.5) / 4) * size;
        if (lupinGround(x, n) > 0 || (patches.length && patchAt(x, n) > 0)) v = true;
      }
      tileSeen.set(key, v);
    }
    return v;
  };
  // each stand mostly one colour, with a second and a few odd plants (a stand grows from a few parents)
  const standColour = (x, n, r) => {
    const wx = x + 34 * (vn(x / 80, n / 80, 21) - 0.5), wn = n + 34 * (vn(x / 80, n / 80, 22) - 0.5);
    const ci = Math.floor(wx / 26), cj = Math.floor(wn / 26);
    return r < 0.5 ? pickLupin(hash2(ci, cj, 31)) : r < 0.8 ? pickLupin(hash2(ci, cj, 32)) : pickLupin((r - 0.8) * 5);
  };
  const putLupin = (L, x, n, s, rot, c, j, on) => {
    if (L.full) return;
    pv.set(x, terrain.heightAt(x, n), -n); q.setFromAxisAngle(up, rot); sc.set(s, s, s);
    L.put(m4.compose(pv, q, sc), [c[0] * j, c[1] * j, c[2] * j, on], [x, -n]);
  };
  const sq = Math.sqrt(quality), lupDens = quality < 1 ? 0.6 : 1;
  const RN = 12 * sq, RM = 55 * sq, RF = 340 * sq, FT = 48;
  // the tiles round the camera within a radius, nearest first (so a full mesh leaves out the furthest plants)
  const tilesNear = (cam, size, R) => {
    const tx = Math.floor(cam.x / size), tn = Math.floor(-cam.z / size), span = Math.ceil(R / size), out = [];
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
      const ci = tx + i, cj = tn + j, d = Math.hypot((ci + 0.5) * size - cam.x, (cj + 0.5) * size + cam.z);
      if (d <= R + size * 0.71 && tileHasLupins(ci, cj, size)) out.push([d, ci, cj]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  };
  let lupKey = '', farKey = '';
  function fillLupins(cam) {
    const mo = month(), bloom = BLOOM[mo];
    const flowerOf = (a, b) => bloom > a ? Math.min(1, bloom * 1.2) * (0.72 + 0.28 * b) : 0;
    // whole plants within RN, plainer ones to RM: one set of spots per tile (1.4 plants a square metre in a full stand,
    // as thick as they grow on the shore), all of them near the eye and fewer further out, so a plant stays where it
    // was as it changes form
    const key = Math.floor(cam.x / TILE) + ',' + Math.floor(-cam.z / TILE) + ',' + mo;
    if (key !== lupKey) {
      lupKey = key; lupNear.begin(cam.x, cam.z); lupMid.begin(cam.x, cam.z);
      const K = Math.round(1.4 * lupDens * TILE * TILE);
      for (const [, ci, cj] of tilesNear(cam, TILE, RM)) {
        for (let k = 0; k < K; k++) {
          const x = (ci + hash2(ci, cj, 7000 + k * 3)) * TILE, n = (cj + hash2(ci, cj, 7001 + k * 3)) * TILE, hk = hash2(ci, cj, 7002 + k * 3);
          const dd = Math.hypot(x - cam.x, n + cam.z);
          if (dd > RM || hk >= (dd < RN ? 1 : dd < 30 * sq ? 0.6 : 0.4)) continue;
          const cls = ctx.habitat(x, n), m = lupinMask(x, n, cls);
          if (hash2(ci, cj, 8000 + k) >= Math.pow(m, 0.5) || ctx.depth(x, n) > -0.05 || onRoad(x, n)) continue;
          putLupin(dd < RN ? lupNear : lupMid, x, n, (0.75 + 0.4 * hash2(ci, cj, 9300 + k)) * (0.85 + 0.15 * m), hk * 60,
            standColour(x, n, hash2(ci, cj, 9000 + k)), 0.92 + 0.16 * hash2(ci, cj, 9400 + k), flowerOf(hash2(ci, cj, 9500 + k), hash2(ci, cj, 9600 + k)));
        }
      }
      lupNear.end(); lupMid.end();
    }
    // beyond, patches of ten plants in one instance on coarser tiles, while the lupins are in flower (out of flower
    // a patch is a few green humps nobody sees from there): a patch a 3 m^2 in a full stand, fewer past 200 m
    // The far ring has thousands of spots to weigh: it is filled a few milliseconds a frame into a staging copy, and
    // the patches on show change over when it is done (all at once on the first frame)
    const fkey = Math.floor(cam.x / FT) + ',' + Math.floor(-cam.z / FT) + ',' + mo;
    if (fkey !== farKey) { farKey = fkey; farJob = bloom > 0 ? farFill({ x: cam.x, z: cam.z }, flowerOf) : null; if (!farJob) { lupFar.begin(cam.x, cam.z); lupFar.end(); } }
    if (farJob) {
      const t0 = performance.now(), budget = farFirst ? 1e9 : 3;
      while (performance.now() - t0 < budget) { if (farJob.next().done) { farJob = null; break; } }
      farFirst = false;
    }
  }
  let farJob = null, farFirst = true;
  const stage = { mat: new Float32Array(lupFar.max * 16), col: new Float32Array(lupFar.max * 4), pos: new Float32Array(lupFar.max * 2), n: 0 };
  const sm4 = new THREE.Matrix4();
  function* farFill(cam, flowerOf) {
    stage.n = 0;
    const K = Math.round(0.24 * lupDens * FT * FT);
    for (const [, ci, cj] of tilesNear(cam, FT, RF)) {
      for (let k = 0; k < K && stage.n < lupFar.max; k++) {
        const x = (ci + hash2(ci, cj, 5000 + k * 3)) * FT, n = (cj + hash2(ci, cj, 5001 + k * 3)) * FT, hk = hash2(ci, cj, 5002 + k * 3);
        const dd = Math.hypot(x - cam.x, n + cam.z);
        // from just inside the plainer plants' edge (so there is no gap between them) out to RF
        if (dd > RF || dd < RM * 0.85 || hk >= (dd < 200 ? 1 : 0.7)) continue;
        const cls = ctx.habitat(x, n), m = lupinMask(x, n, cls);
        if (hash2(ci, cj, 6000 + k) >= Math.pow(m, 0.6) || ctx.depth(x, n) > -0.05 || onRoad(x, n)) continue;
        const s = 0.9 + 0.4 * hash2(ci, cj, 6300 + k), c = standColour(x, n, hash2(ci, cj, 6100 + k) * 0.9), j = 0.95 + 0.1 * hash2(ci, cj, 6400 + k), i = stage.n++;
        pv.set(x, terrain.heightAt(x, n), -n); q.setFromAxisAngle(up, hk * 60); sc.set(s, s, s);
        m4.compose(pv, q, sc).toArray(stage.mat, i * 16);
        stage.col.set([c[0] * j, c[1] * j, c[2] * j, flowerOf(hash2(ci, cj, 6500 + k) * 0.6, hash2(ci, cj, 6600 + k))], i * 4);
        stage.pos[i * 2] = x; stage.pos[i * 2 + 1] = -n;
      }
      yield;
    }
    lupFar.begin(cam.x, cam.z);
    for (let i = 0; i < stage.n; i++) lupFar.put(sm4.fromArray(stage.mat, i * 16), stage.col.subarray(i * 4, i * 4 + 4), stage.pos.subarray(i * 2, i * 2 + 2));
    lupFar.end();
  }
  // ---- the turf's placement, with the ground's colour read from the mosaic round the camera (a 48 x 48 px window, 480 m,
  // read again when the camera has moved 120 m)
  const gS = S.ground, tS = S.terrain, WIN = 48, TT = 12;
  const winCv = document.createElement('canvas'); winCv.width = winCv.height = WIN;
  const winCtx = winCv.getContext('2d', { willReadFrequently: true });
  let win = null;
  function readWindow(cam) {
    const cc = Math.floor((cam.x - tS.x0) / gS.px_m), rc = Math.floor((tS.y1 + cam.z) / gS.px_m);
    if (win && Math.abs(cc - win.cc) < 12 && Math.abs(rc - win.rc) < 12) return;
    const c0 = cc - WIN / 2, r0 = rc - WIN / 2;
    winCtx.clearRect(0, 0, WIN, WIN);
    try {
      (ctx.d.strips || []).forEach((img, i) => {
        const s = gS.strips[i], a = Math.max(r0, s.row0), b = Math.min(r0 + WIN, s.row0 + s.rows);
        const ca = Math.max(c0, 0), cb = Math.min(c0 + WIN, gS.w);
        if (b > a && cb > ca) winCtx.drawImage(img, ca, a - s.row0, cb - ca, b - a, ca - c0, a - r0, cb - ca, b - a);
      });
      win = { cc, rc, c0, r0, px: winCtx.getImageData(0, 0, WIN, WIN).data };
    } catch (e) { win = { cc, rc, c0, r0, px: null }; }
  }
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
  const groundColour = (x, n, out) => {
    const fc = (x - tS.x0) / gS.px_m - 0.5 - win.c0, fr = (tS.y1 - n) / gS.px_m - 0.5 - win.r0;
    const i = Math.min(WIN - 2, Math.max(0, Math.floor(fc))), j = Math.min(WIN - 2, Math.max(0, Math.floor(fr)));
    const ax = Math.min(1, Math.max(0, fc - i)), az = Math.min(1, Math.max(0, fr - j));
    for (let ch = 0; ch < 3; ch++) {
      const p = (jj, ii) => LIN[win.px[(jj * WIN + ii) * 4 + ch]];
      out[ch] = (p(j, i) * (1 - ax) + p(j, i + 1) * ax) * (1 - az) + (p(j + 1, i) * (1 - ax) + p(j + 1, i + 1) * ax) * az;
    }
    return out;
  };
  const gc = [0, 0, 0];
  let turfKey = '';
  function fillTurf(cam) {
    const tx = Math.floor(cam.x / TT), tn = Math.floor(-cam.z / TT), key = tx + ',' + tn;
    if (key === turfKey) return; turfKey = key;
    readWindow(cam);
    turf.begin(cam.x, cam.z);
    if (!win.px) { turf.end(); return; }
    // tufts a square metre: 6 within 8 m of the eye, thinning to under one at the edge (where the shader has shrunk them);
    // the tiles nearest first, so a full mesh leaves out the furthest
    const dens = d => turfDens * (d < 8 ? 5.5 : 5.5 * Math.pow(8 / d, 1.3));
    const R = TURF_R + TT * 0.75, span = Math.ceil(R / TT), tiles = [];
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
      const ci = tx + i, cj = tn + j, near = Math.max(0, Math.hypot((ci + 0.5) * TT - cam.x, (cj + 0.5) * TT + cam.z) - TT * 0.71);
      if (near <= R) tiles.push([near, ci, cj]);
    }
    tiles.sort((a, b) => a[0] - b[0]);
    for (const [near, ci, cj] of tiles) {
      const K = Math.round(dens(near) * TT * TT);
      for (let k = 0; k < K && !turf.full; k++) {
        const x = (ci + hash2(ci, cj, 20000 + k * 3)) * TT, n = (cj + hash2(ci, cj, 20001 + k * 3)) * TT;
        const dd = Math.hypot(x - cam.x, n + cam.z);
        if (dd > R || hash2(ci, cj, 20002 + k * 3) * dens(near) > dens(dd)) continue;
        const cls = ctx.habitat(x, n), grassy = cls === 7 || cls === 8 || cls === 9 || cls === 11 || cls === 12;
        // the land cover's "built" holds lawns and verges round the buildings too: grass there where the ground is green
        if (!grassy && cls !== 14) continue;
        groundColour(x, n, gc);
        if (!grassy && !(gc[1] > gc[0] * 1.05 && gc[1] > gc[2] * 1.2)) continue;
        if (ctx.depth(x, n) > -0.05 || onRoad(x, n)) continue;
        const h = terrain.heightAt(x, n);
        const s = 0.7 + hash2(ci, cj, 21000 + k) * 0.6;
        pv.set(x, h, -n); q.setFromAxisAngle(up, hash2(ci, cj, 21500 + k) * 40); sc.set(s, s * (0.75 + 0.5 * hash2(ci, cj, 21700 + k)), s);
        const v = 0.85 + 0.3 * hash2(ci, cj, 22000 + k);
        turf.put(m4.compose(pv, q, sc), [gc[0] * v, gc[1] * v, gc[2] * v], [x, h, -n]);
      }
    }
    turf.end();
  }
  fill(camera.position); fillLupins(camera.position); if (gMax) fillTurf(camera.position);
  return { update() { fill(camera.position); fillLupins(camera.position); if (gMax) fillTurf(camera.position); } };
}
