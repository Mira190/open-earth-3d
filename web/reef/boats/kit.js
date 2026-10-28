// Geometry and material kit for the procedural vessels: lofted hulls, sails, merged part buckets,
// shared node materials. Local vessel frame everywhere: +X bow, +Y up, +Z starboard, waterline y = 0.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, mix, smoothstep, clamp, step, fract, floor, abs, sin, max, min,
  positionLocal, positionWorld, attribute, uv, mx_noise_float, normalLocal } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export { sstep };

// ---- shared uniforms and materials -------------------------------------------------------------
export const shared = { lamp: uniform(0), time: uniform(0), mats: null };

const std = (o) => new THREE.MeshStandardNodeMaterial(o);

export function materials() {
  if (shared.mats) return shared.mats;
  const M = {};
  const solid = (c, rough = 0.5, extra = {}) => std({ color: c, roughness: rough, metalness: 0, ...extra });
  // the scene's hemisphere light has a sand-coloured ground term (for the beaches); under a hull the light is really
  // sea and sky, so white paint gets a cool fill of its own instead of looking beige
  const fill = (m, hex, k = 0.1) => { const c = new THREE.Color(hex); m.emissiveNode = vec3(c.r, c.g, c.b).mul(vec3(0.55, 0.66, 0.82)).mul(shared.env.u.white.mul(k)); return m; };
  M.fill = fill;
  M.white = fill(solid(0xf2f4f4, 0.28), 0xf2f4f4);
  M.offwhite = fill(solid(0xe4e2d8, 0.45), 0xe4e2d8);
  M.grey = solid(0x8a9296, 0.5);
  M.dark = solid(0x1c2024, 0.6);
  M.black = solid(0x0e0f10, 0.8);
  M.rubber = solid(0x2a2d30, 0.85);
  M.tube = solid(0x4b5257, 0.7);
  M.alu = solid(0xc9ced1, 0.38);
  M.chrome = solid(0xdfe3e6, 0.25);
  M.blue = solid(0x0c3f7c, 0.35);
  M.navy = solid(0x0a2347, 0.4);
  M.red = solid(0xb01f1f, 0.4);
  M.yellow = solid(0xf2c21a, 0.45);
  M.orange = solid(0xe8641b, 0.5);
  M.green = solid(0x1d6b3c, 0.5);
  M.pile = solid(0x4a3f33, 0.95);
  M.rope = solid(0xd9d1b9, 0.9);
  M.canvas = std({ color: 0x1d3b5e, roughness: 0.92, side: THREE.DoubleSide });
  M.shade = fill(std({ color: 0xe8e4d6, roughness: 0.9, side: THREE.DoubleSide }), 0xe8e4d6);
  M.net = std({ color: 0x20282d, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  // glass: dark tinted, warm window glow when the lamps are on
  M.glass = std({ color: 0x0d1a26, roughness: 0.08, metalness: 0 });
  M.glass.emissiveNode = vec3(1.0, 0.72, 0.38).mul(shared.lamp).mul(0.55);
  M.glassClear = std({ color: 0x1a2c3c, roughness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  // gelcoat hull with antifoul below the waterline, a boot stripe and an optional colour band
  const hullCache = {};
  M.hull = (opts = {}) => {
    const key = JSON.stringify(opts); if (hullCache[key]) return hullCache[key];
    const m = hullCache[key] = fill(std({ roughness: 0.26, metalness: 0 }), opts.top ?? 0xf3f5f5, 0.12);
    const top = new THREE.Color(opts.top ?? 0xf3f5f5), band = new THREE.Color(opts.band ?? 0x14365e), anti = new THREE.Color(opts.anti ?? 0x1b2a3a);
    const b0 = opts.bandY ?? [0.5, 0.62], boot = opts.boot ?? [0.0, 0.07];
    m.colorNode = Fn(() => {
      const y = positionLocal.y;
      let c = vec3(top.r, top.g, top.b).toVar();
      c.assign(mix(c, vec3(band.r, band.g, band.b), smoothstep(b0[0] - 0.01, b0[0] + 0.01, y).mul(float(1).sub(smoothstep(b0[1] - 0.01, b0[1] + 0.01, y)))));
      c.assign(mix(vec3(anti.r, anti.g, anti.b), c, smoothstep(boot[0] - 0.01, boot[0] + 0.01, y)));
      c.assign(mix(c, vec3(band.r, band.g, band.b), smoothstep(boot[0] - 0.01, boot[0] + 0.01, y).mul(float(1).sub(smoothstep(boot[1], boot[1] + 0.015, y)))));
      // faint waterline weed and gelcoat speckle
      const n = mx_noise_float(vec3(positionLocal.x.mul(2), positionLocal.y.mul(6), positionLocal.z.mul(2)));
      return c.mul(float(1).add(n.mul(0.03)));
    })();
    return m;
  };

  // teak deck: planks (6 cm with caulk lines) and wood grain
  M.teak = std({ roughness: 0.62, metalness: 0 });
  M.teak.colorNode = Fn(() => {
    const p = positionLocal;
    const plank = p.z.mul(14);
    const id = floor(plank);
    const f = fract(plank);
    const caulk = smoothstep(0.0, 0.07, f).mul(float(1).sub(smoothstep(0.93, 1.0, f)));
    const stagger = fract(sin(id.mul(12.9898)).mul(43758.5453));
    const butt = fract(p.x.mul(0.35).add(stagger));
    const bj = smoothstep(0.0, 0.012, butt).mul(float(1).sub(smoothstep(0.988, 1.0, butt)));
    const tone = fract(sin(id.mul(78.233).add(floor(p.x.mul(0.35).add(stagger)).mul(37.1))).mul(43758.5453));
    const grain = mx_noise_float(vec3(p.x.mul(1.5), id, p.z.mul(40)));
    const wood = vec3(0.62, 0.43, 0.24).mul(float(0.82).add(tone.mul(0.3)).add(grain.mul(0.06)));
    return mix(vec3(0.16, 0.12, 0.08), wood, caulk.mul(bj));
  })();
  // non-slip grey deck (day boats)
  M.nonslip = std({ roughness: 0.9, metalness: 0 });
  M.nonslip.colorNode = Fn(() => {
    const n = mx_noise_float(vec3(positionLocal.x.mul(30), positionLocal.y.mul(30), positionLocal.z.mul(30)));
    return vec3(0.62, 0.65, 0.66).mul(float(0.9).add(n.mul(0.1)));
  })();
  M.woodPlank = std({ roughness: 0.85, metalness: 0 });   // jetty and pontoon decks: weathered boards
  M.woodPlank.colorNode = Fn(() => {
    const p = positionLocal;
    const plank = p.x.mul(7);
    const id = floor(plank), f = fract(plank);
    const caulk = smoothstep(0.0, 0.05, f).mul(float(1).sub(smoothstep(0.95, 1.0, f)));
    const tone = fract(sin(id.mul(78.233)).mul(43758.5453));
    const grain = mx_noise_float(vec3(id, p.z.mul(2.5), p.x.mul(0.3)));
    return mix(vec3(0.12, 0.10, 0.08), vec3(0.50, 0.40, 0.30).mul(float(0.8).add(tone.mul(0.35)).add(grain.mul(0.08))), caulk);
  })();
  M.woodRail = solid(0x6b4a2d, 0.7);
  M.deckWhite = fill(std({ roughness: 0.7, metalness: 0 }), 0xdde0e0);
  M.deckWhite.colorNode = Fn(() => {
    const n = mx_noise_float(vec3(positionLocal.x.mul(40), positionLocal.y.mul(40), positionLocal.z.mul(40)));
    return vec3(0.86, 0.88, 0.88).mul(float(0.94).add(n.mul(0.06)));
  })();

  // sail cloth: panel seams, soft translucency to the sun; geometry carries the luff/chord attributes
  M.sail = (uni) => {
    const m = std({ color: 0xf6f2e6, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const ab = attribute('aSail', 'vec2');
    m.colorNode = Fn(() => {
      // horizontal panel seams every 1/16 of the height
      const seam = float(1).sub(float(1).sub(smoothstep(0.0, 0.025, abs(fract(ab.y.mul(16)).sub(0.5)).sub(0.5).negate())).mul(0.10));
      const cloud = mx_noise_float(vec3(ab.x.mul(5), ab.y.mul(9), 3.1)).mul(0.03);
      return vec3(0.97, 0.95, 0.89).mul(seam.add(cloud));
    })();
    m.emissiveNode = vec3(0.30, 0.28, 0.24).mul(0.28);        // light through the cloth
    const aLuff = attribute('aLuff', 'vec3'), aChord = attribute('aChord', 'vec3');
    // uni: { furl, raise, bill, side } uniforms. luff point + a * chord, chord shortened by furl,
    // gathered toward the foot when lowered, bellied to leeward in proportion to the wind
    m.positionNode = Fn(() => {
      const a = ab.x, b = ab.y;
      const chord = aChord.mul(a.mul(float(1).sub(uni.furl.mul(0.94))));
      let p = aLuff.add(chord).toVar();
      const y0 = uni.foot;
      p.y.assign(y0.add(p.y.sub(y0).mul(uni.raise)));
      const belly = sin(a.mul(3.14159)).pow(0.75).mul(sin(b.mul(3.14159).mul(0.5).add(0.12)).max(0.0)).mul(uni.bill).mul(aChord.length()).mul(0.13);
      const flap = sin(b.mul(7).sub(shared.time.mul(5.5)).add(a.mul(3))).mul(a.mul(a)).mul(float(0.07).add(float(1).sub(uni.bill).mul(0.12))).mul(uni.bill.add(0.15));
      p.z.addAssign(uni.side.mul(belly.mul(float(1).sub(uni.furl)).add(flap.mul(0.5))));
      return p;
    })();
    return m;
  };
  shared.mats = M;
  return M;
}

// ---- geometry helpers ----------------------------------------------------------------------------
const clean = (g) => {
  g = g.index ? g : (() => { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); return g; })();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
};

// Collects parts per material and merges them into one mesh per material (few draw calls per vessel).
export class Kit {
  constructor() { this.b = new Map(); }
  add(mat, geo, matrix, my, mz) {   // matrix, or a plain (x, y, z) offset
    let g = geo.clone();
    if (typeof matrix === 'number') g.translate(matrix, my ?? 0, mz ?? 0); else if (matrix) g.applyMatrix4(matrix);
    g = clean(g);
    if (!this.b.has(mat)) this.b.set(mat, []);
    this.b.get(mat).push(g);
    return this;
  }
  at(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...(Array.isArray(s) ? s : [s, s, s])));
    return this.add(mat, geo, m);
  }
  mirror(mat, geo, matrix) { // add geometry and its port/starboard twin (mirror in z)
    this.add(mat, geo, matrix);
    const g = geo.clone(); if (matrix) g.applyMatrix4(matrix);
    g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
    const ix = g.index; if (ix) for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i); ix.setX(i, ix.getX(i + 1)); ix.setX(i + 1, t); }
    g.computeVertexNormals();
    return this.add(mat, g);
  }
  build(group = new THREE.Group()) {
    for (const [mat, list] of this.b) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = false;
      group.add(m);
    }
    return group;
  }
}

export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r1, r0, h, seg);     // r0 at the bottom
// a cylinder from point a to point b
export function rod(a, b, r0, r1 = r0, seg = 8) {
  a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
export function ellipsoid(rx, ry, rz, ws = 16, hs = 10) { return new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz); }

// rounded rectangle outline in (x, z) plan, centred
export function rrect(w, d, r, n = 5) {
  const pts = [], hw = w / 2, hd = d / 2;
  const corner = (cx, cz, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  corner(hw - r, hd - r, 0); corner(-hw + r, hd - r, Math.PI / 2); corner(-hw + r, -hd + r, Math.PI); corner(hw - r, -hd + r, Math.PI * 1.5);
  return pts;
}
// plan outline (x, z points, counter-clockwise from above) extruded upward from y0 by h; bevel rounds the top edge
export function slab(plan, y0, h, bevel = 0.05, curve = 3) {
  const sh = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(h - bevel * 2, 0.001), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: curve, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g;
}
// side-profile polygon (x, y points) extruded across z (thickness t, centred), for fins, rudders, tail planes
export function fin(profile, t, bevel = 0.01) {
  const sh = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(t - bevel * 2, 0.001), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  return g.translate(0, 0, -t / 2 + bevel);
}
export function tube(pts, r, seg = 48, rs = 10, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(c, seg, r, rs, closed);
}

// ---- lofted hull ---------------------------------------------------------------------------------
// Stations run stern (s = 0) to bow (s = 1). Each section is a keel-to-sheer curve z = hb * u^e, which
// is round-bilged (e < 1) amidships and turns V-shaped (e -> 1) toward the entry. Returns the shell,
// the deck surface (camber and sheer) and sampling functions for placing fittings.
export function hull(o) {
  const L = o.L, B = o.B, dh = o.dh ?? 0.5;
  const fbMid = o.fbMid ?? 0.9, fbBow = o.fbBow ?? 1.25, fbStern = o.fbStern ?? 1.0;
  const pn = o.pn ?? 2.3, pm = o.pm ?? 0.7, tw = o.tw ?? 0.82, eMid = o.eMid ?? 0.55, eBow = o.eBow ?? 1.0;
  const kpos = o.kpos ?? 0.5, kp = o.kp ?? 1.7, rake = o.rake ?? 0.5, nS = o.nS ?? 44, nU = o.nU ?? 12, x0 = o.x0 ?? 0.5;
  const cam = o.camber ?? 0.05, sternDraft = o.sternDraft ?? 0.45, chine = o.chine ?? 0;
  const hbf = s => B / 2 * Math.pow(Math.max(1 - Math.pow(s, pn), 0), pm) * (tw + (1 - tw) * sstep(0, o.twS ?? 0.28, s));
  const bot = s => { const p = s < kpos ? 1 - sternDraft * Math.pow((kpos - s) / kpos, 2) : 1 - Math.pow((s - kpos) / (1 - kpos), kp); return -dh * Math.max(p, 0); };
  const sheer = s => fbMid + (fbBow - fbMid) * Math.pow(Math.max(0, (s - 0.4) / 0.6), 2.2) + (fbStern - fbMid) * Math.pow(Math.max(0, (0.4 - s) / 0.4), 2);
  const ex = s => eMid + (eBow - eMid) * sstep(0.3, 1, s);
  const X = (s, u) => (s - x0) * L + rake * Math.pow(s, 6) * u;
  const stations = [];
  for (let i = 0; i <= nS; i++) stations.push(1 - Math.pow(1 - i / nS, 1.35));
  const pos = [], uv = [], idx = [];
  const ring = 2 * nU + 1;
  for (const s of stations) {
    const hb = hbf(s), yb = bot(s), ys = sheer(s), e = ex(s);
    for (let j = 0; j < ring; j++) {
      const side = j <= nU ? -1 : 1, k = j <= nU ? nU - j : j - nU, u = k / nU;
      let zz = hb * Math.pow(u, e);
      if (chine) zz = hb * (u < 0.35 ? (u / 0.35) * (1 - chine) : (1 - chine) + chine * (u - 0.35) / 0.65) * 1.0; // hard chine planing section
      let yy = yb + (ys - yb) * (chine ? Math.pow(u, 0.9) : u);
      zz *= 1 + (o.flare ?? 0.05) * u * u;
      pos.push(X(s, u), yy, side * zz);
      uv.push(s, u);
    }
  }
  for (let i = 0; i < nS; i++) for (let j = 0; j < ring - 1; j++) {
    const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  let shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shell.setIndex(idx);
  const outward = (g, centre) => { // flip winding if normals point inward
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal; let s = 0;
    for (let i = 0; i < p.count; i += 7) s += (p.getX(i) - centre.x) * n.getX(i) + (p.getY(i) - centre.y) * n.getY(i) + (p.getZ(i) - centre.z) * n.getZ(i);
    if (s < 0) { const ix = g.index; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); } g.computeVertexNormals(); }
    return g;
  };
  // normals on the shell, then the transom cap (own normals, so the corner stays crisp)
  outward(shell, new THREE.Vector3(0, 0.2, 0));
  const s0 = stations[0], tp = [], tIdx = [];
  for (let j = 0; j < ring; j++) tp.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
  tp.push(pos[0], sheer(s0), 0);
  for (let j = 0; j < ring - 1; j++) tIdx.push(ring, j, j + 1);
  tIdx.push(ring, ring - 1, 0); // close along the sheer chord
  let tr = new THREE.BufferGeometry();
  tr.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); tr.setIndex(tIdx);
  outward(tr, new THREE.Vector3(1.5, 0.3, 0));
  const tn = tr.attributes.normal; for (let i = 0; i < tn.count; i++) { tn.setXYZ(i, -1, 0, 0); } // transom faces aft, vertically
  tr.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(tr.attributes.position.count * 2), 2));
  const shellAll = mergeGeometries([shell.index ? shell : shell, tr].map(clean), false);
  // deck surface
  const dp = [], di = [];
  for (const s of stations) {
    const hb = hbf(s), ys = sheer(s);
    const inset = Math.min(hb * 0.02 + 0.02, hb);
    dp.push(X(s, 1), ys - 0.01, -(hb - inset), X(s, 1), ys - 0.01 + cam * (hb / (B / 2 + 1e-6)), 0, X(s, 1), ys - 0.01, hb - inset);
  }
  for (let i = 0; i < nS; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
    di.push(a, b, c, b, d, c);
  }
  let deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); deck.setIndex(di);
  deck.computeVertexNormals();
  { const n = deck.attributes.normal; if (n.getY(3 * Math.floor(nS / 2) + 1) < 0) { for (let i = 0; i < di.length; i += 3) { const t = di[i + 1]; di[i + 1] = di[i + 2]; di[i + 2] = t; } deck.setIndex(di); deck.computeVertexNormals(); } }
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(deck.attributes.position.count * 2), 2));
  const sOf = x => Math.min(1, Math.max(0, x / L + x0));
  return { shell: shellAll, deck, L, B,
    hb: x => hbf(sOf(x)), sheer: x => sheer(sOf(x)) + 0, bot: x => bot(sOf(x)),
    // deck height at lateral offset z (camber)
    deckY: (x, z = 0) => sheer(sOf(x)) - 0.01 + cam * Math.max(0, 1 - Math.abs(z) / (hbf(sOf(x)) + 1e-6)) };
}

// ---- sails ----------------------------------------------------------------------------------------
// A sail is the surface luff(b) + a (leech(b) - luff(b)); a runs luff to leech, b foot to head. Corners are
// [x, y, z]. The GPU bellies it with the wind (uniform `bill`) and furls or lowers it (uniforms `furl`, `raise`).
export function sailGeo(tack, head, clew, o = {}) {
  const nA = o.nA ?? 12, nB = o.nB ?? 24, roach = o.roach ?? 0.1, hollow = o.hollow ?? 0;
  const T = new THREE.Vector3(...tack), H = new THREE.Vector3(...head), C = new THREE.Vector3(...clew);
  const pos = [], aL = [], aC = [], ab = [], idx = [], nor = [];
  for (let j = 0; j <= nB; j++) {
    const b = j / nB;
    const luff = T.clone().lerp(H, b);
    const leech = C.clone().lerp(H, b);
    // roach bulges the leech outward (aft) between the clew and the head; hollow cuts the foot
    const out = leech.clone().sub(luff);
    leech.addScaledVector(out.clone().normalize(), roach * Math.sin(Math.PI * Math.min(1, b * 1.05)) * out.length() * 0.35 * (1 - b * 0.5));
    const chord = leech.clone().sub(luff);
    for (let i = 0; i <= nA; i++) {
      const a = i / nA;
      const p = luff.clone().addScaledVector(chord, a);
      pos.push(p.x, p.y, p.z); aL.push(luff.x, luff.y, luff.z); aC.push(chord.x, chord.y, chord.z); ab.push(a, b); nor.push(0, 0, 1);
    }
  }
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
    const a = j * (nA + 1) + i, b = a + 1, c = a + nA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aLuff', new THREE.Float32BufferAttribute(aL, 3));
  g.setAttribute('aChord', new THREE.Float32BufferAttribute(aC, 3));
  g.setAttribute('aSail', new THREE.Float32BufferAttribute(ab, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3().add(T).add(H).add(C).multiplyScalar(1 / 3), T.distanceTo(H) + 3);
  return g;
}
export function sailUniforms(foot = 0) { return { furl: uniform(0), raise: uniform(1), bill: uniform(0.6), side: uniform(1), foot: uniform(foot) }; }

// ---- lights (sprites that glow when the sun is low) ---------------------------------------------------
let glowTex = null;
export function glowMaterial(color) {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const c = new THREE.Color(color);
  m.colorNode = Fn(() => {
    const r = uv().sub(0.5).length().mul(2);
    const core = float(1).sub(smoothstep(0.0, 0.35, r));
    const halo = float(1).sub(smoothstep(0.0, 1.0, r)).pow(2.5);
    return vec3(c.r, c.g, c.b).mul(core.mul(1.6).add(halo.mul(0.7))).mul(shared.lamp);
  })();
  m.opacityNode = Fn(() => float(1).sub(smoothstep(0.0, 1.0, uv().sub(0.5).length().mul(2))).mul(shared.lamp))();
  m.fog = false;
  return m;
}
const glowCache = {};
export function lamp(group, color, x, y, z, size = 1.4) {
  const key = String(color);
  const m = glowCache[key] || (glowCache[key] = glowMaterial(color));
  const s = new THREE.Sprite(m);
  s.position.set(x, y, z); s.scale.set(size, size, 1);
  s.renderOrder = 20;
  group.add(s);
  return s;
}
