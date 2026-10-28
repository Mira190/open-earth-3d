// Procedural vessels. Every builder returns a descriptor:
//   { group, kind, L, B, draft, buoy: [[x,z]..] (sample points for heave/pitch/roll), trails: [[x,z,width]..] (wake origins),
//     rig: { main, genoa } (sail uniforms and pivots) | null, lamps, helm: [x,y,z] (driver eye), tags }
// Local frame: +X bow, +Y up, +Z starboard, waterline y = 0.
import * as THREE from 'three/webgpu';
import { Kit, box, cyl, rod, ellipsoid, rrect, slab, fin, tube, hull, sailGeo, sailUniforms, materials, lamp, shared } from './kit.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = Math.PI / 180;

// lifelines and stanchions along both sides of a deck, following the sheer
export function lifelines(K, M, h, x0, x1, hgt = 0.62, step = 1.25, oz = 0) {
  for (const side of [-1, 1]) {
    const pts = [];
    for (let x = x0; x <= x1 + 1e-6; x += 0.4) pts.push([x, h.deckY(x) + hgt, oz + side * h.hb(x) * 0.93]);
    if (pts.length > 1) { K.add(M.chrome, tube(pts, 0.011, pts.length * 3, 5)); K.add(M.chrome, tube(pts.map(p => [p[0], p[1] - hgt * 0.5, p[2]]), 0.008, pts.length * 3, 4)); }
    for (let x = x0; x <= x1 + 1e-6; x += step) { const z = oz + side * h.hb(x) * 0.93; K.add(M.chrome, rod([x, h.deckY(x), z], [x, h.deckY(x) + hgt, z], 0.014, 0.014, 5)); }
  }
}
// pulpit and pushpit loops
function bowRail(K, M, h, xb, hgt = 0.62, oz = 0) {
  const loop = [], w = h.hb(xb - 0.9) * 0.9;
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; const x = xb - 0.9 + Math.cos(a) * 0.9; loop.push([x, h.deckY(x) + hgt, oz + Math.sin(a) * w]); }
  K.add(M.chrome, tube(loop, 0.014, 40, 5));
  for (const i of [0, 16]) { const p = loop[i]; K.add(M.chrome, rod([p[0], p[1] - hgt, p[2]], p, 0.014, 0.014, 5)); }
}
function sternRail(K, M, h, xs, hgt = 0.62, oz = 0) {
  const w = h.hb(xs) * 0.93, y = h.deckY(xs), loop = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; loop.push([xs, y + hgt, oz + Math.sin(a) * w]); }
  K.add(M.chrome, tube(loop, 0.014, 20, 5));
  for (const z of [-w, w]) K.add(M.chrome, rod([xs, y, oz + z], [xs, y + hgt, oz + z], 0.014));
}
// a bimini: tubular frame and a slightly bellied canvas
function bimini(K, M, x0, x1, w, y, yFrame) {
  for (const x of [x0, x1]) {
    const pts = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push([x, yFrame + Math.sin(a) * (y - yFrame), Math.cos(a) * w]); }
    K.add(M.chrome, tube(pts, 0.018, 20, 5));
  }
  K.add(M.chrome, rod([x0, y, 0], [x1, y, 0], 0.016));
  const g = new THREE.PlaneGeometry(1, 1, 10, 10), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; const z = (v - 0.5) * 2 * w, a = Math.acos(Math.max(-1, Math.min(1, z / w))); p.setXYZ(i, x0 + (x1 - x0) * u, yFrame + Math.sin(a) * (y - yFrame) + 0.02 + Math.sin(u * Math.PI) * 0.04, z); }
  g.computeVertexNormals();
  K.add(M.canvas, g);
}
const lightsOf = (g, list) => list.map(([c, x, y, z, s]) => lamp(g, c, x, y, z, s));

// =====================================================================================================
// (a) charter monohull, ~12 m: white hull, teak deck, bimini, mainsail and genoa that furl and raise
export function buildYacht(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const hullMat = M.hull({ band: o.band ?? 0x16365f, bandY: [0.66, 0.74], boot: [0.0, 0.06] });
  const h = hull({ L: 11.8, B: 3.75, dh: 0.42, fbMid: 0.86, fbBow: 1.2, fbStern: 0.98, pn: 2.5, pm: 0.62, tw: 0.84, eMid: 0.52, eBow: 1.0, rake: 0.55, kpos: 0.5 });
  K.add(hullMat, h.shell); K.add(M.teak, h.deck);
  // keel, bulb and rudder
  K.add(M.dark, fin([[-1.0, -0.3], [1.1, -0.3], [0.55, -1.95], [-0.1, -1.95]], 0.17, 0.035));
  K.at(M.dark, ellipsoid(1.0, 0.15, 0.17), 0.2, -2.0, 0);
  K.add(M.dark, fin([[-4.95, -0.2], [-4.5, -0.2], [-4.6, -1.4], [-4.85, -1.4]], 0.08, 0.02));
  // bathing platform and transom
  K.add(M.teak, slab(rrect(0.75, 2.2, 0.1), 0.18, 0.06, 0.01), -6.2, 0, 0);
  // coachroof with window band
  const y0 = 0.96;
  const plan = [[3.2, -0.82], [3.4, 0], [3.2, 0.82], [-0.9, 1.12], [-1.1, 1.0], [-1.1, -1.0], [-0.9, -1.12]];
  K.add(M.white, slab(plan.map(([x, z]) => [x, z]), y0, 0.55, 0.07));
  for (const sd of [-1, 1]) {
    // portlight strips just proud of the cabin side
    K.add(M.glass, box(2.5, 0.24, 0.03, 0.9, y0 + 0.30, sd * 0.99));
  }
  K.add(M.glass, box(0.05, 0.22, 1.2, 3.17, y0 + 0.34, 0)); // forward window
  K.add(M.white, slab(rrect(0.9, 0.9, 0.1), y0 + 0.55, 0.12, 0.03), 2.6, 0, 0); // hatch
  K.add(M.glass, box(0.7, 0.02, 0.7, 2.6, y0 + 0.69, 0));
  // sprayhood glass
  K.add(M.glassClear, box(0.04, 0.38, 1.7, -0.95, y0 + 0.74, 0));
  // cockpit furniture: seats, table, wheel
  for (const sd of [-1, 1]) K.add(M.teak, box(2.4, 0.08, 0.38, -3.1, 1.17, sd * 1.22));
  K.add(M.teak, box(0.8, 0.06, 0.5, -2.6, 1.05, 0), 0, 0, 0);
  K.add(M.teak, rod([-2.6, 0.9, 0], [-2.6, 1.05, 0], 0.05));
  K.add(M.chrome, rod([-4.6, 0.95, 0], [-4.6, 1.5, 0], 0.045));
  K.at(M.dark, new THREE.TorusGeometry(0.36, 0.022, 6, 24), -4.62, 1.5, 0, 0, Math.PI / 2, -0.25);
  K.add(M.black, ellipsoid(0.18, 0.1, 0.18), -4.6, 1.48, 0);
  // rails
  lifelines(K, M, h, -5.4, 4.6, 0.6, 1.25); sternRail(K, M, h, -5.6, 0.62); bowRail(K, M, h, 6.0, 0.62);
  K.add(M.chrome, rod([6.05, 1.2, 0], [6.5, 1.2, 0], 0.03)); // anchor roller
  K.add(M.chrome, ellipsoid(0.1, 0.06, 0.1), 6.5, 1.22, 0);
  bimini(K, M, -4.9, -2.1, 1.25, 2.1, 1.0);
  // mast, boom, spreaders, rigging
  const mx = 1.05, deckAt = h.deckY(mx) + 0.55;
  K.add(M.alu, rod([mx, deckAt, 0], [mx, 15.5, 0], 0.095, 0.045, 10));
  K.add(M.alu, rod([mx - 0.05, 2.4, 0], [mx - 4.1, 2.45, 0], 0.045, 0.04, 8));
  for (const yy of [6.5, 10.0]) for (const sd of [-1, 1]) K.add(M.alu, rod([mx, yy, 0], [mx, yy + 0.2, sd * 0.85], 0.02, 0.015, 5));
  const lines = [];
  const seg = (a, b) => lines.push(...a, ...b);
  seg([mx, 15.3, 0], [6.1, 1.25, 0]);                       // forestay
  seg([mx, 15.3, 0], [-5.75, 1.0, 0]);                      // backstay
  for (const sd of [-1, 1]) {
    seg([mx, 14.8, 0], [mx + 0.1, 6.6, sd * 0.85]); seg([mx + 0.1, 6.6, sd * 0.85], [mx + 0.2, 1.05, sd * 1.7]);
    seg([mx, 10.0, 0], [mx, 10.2, sd * 0.85]); seg([mx, 10.2, sd * 0.85], [mx + 0.1, 1.05, sd * 1.7]);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const rig = new THREE.LineSegments(lg, new THREE.LineBasicNodeMaterial({ color: 0x31373c }));
  group.add(K.build(new THREE.Group()), rig);
  // sails
  const rg = { main: null, genoa: null };
  const mu = sailUniforms(2.45), gu = sailUniforms(1.2);
  const mainG = sailGeo([-0.1, 2.5, 0], [-0.12, 15.2, 0], [-4.05, 2.55, 0], { roach: 0.9, nB: 28 });
  const mainMesh = new THREE.Mesh(mainG, M.sail(mu)); mainMesh.frustumCulled = false;
  const mainPivot = new THREE.Group(); mainPivot.position.set(mx, 0, 0); mainPivot.add(mainMesh); group.add(mainPivot);
  // genoa rotates about the forestay
  const tack = V3(6.0, 1.3, 0), headP = V3(mx + 0.05, 14.4, 0), clewP = V3(-0.1, 2.0, 0);
  const genG = sailGeo([0, 0, 0], headP.clone().sub(tack).toArray(), clewP.clone().sub(tack).toArray(), { roach: 0.15, nB: 28 });
  const genMesh = new THREE.Mesh(genG, M.sail(gu)); genMesh.frustumCulled = false;
  const genPivot = new THREE.Group(); genPivot.position.copy(tack); genPivot.add(genMesh); group.add(genPivot);
  const stay = headP.clone().sub(tack).normalize();
  rg.main = { uni: mu, pivot: mainPivot, axis: V3(0, 1, 0) };
  rg.genoa = { uni: gu, pivot: genPivot, axis: stay, clew: clewP.clone().sub(tack) };
  // lights
  const lamps = lightsOf(group, [[0xff2a1a, 5.3, 1.35, -0.7, 0.9], [0x22ff55, 5.3, 1.35, 0.7, 0.9], [0xfff4d8, -5.8, 1.5, 0, 0.9], [0xfff4d8, mx, 15.7, 0, 2.2], [0xffe2a8, -3.2, 1.4, 0, 1.0]]);
  return { group, kind: 'yacht', L: 11.8, B: 3.75, draft: 2.0, buoy: [[5.0, 0], [-5.2, 0], [0, -1.7], [0, 1.7], [1.5, 0]], trails: [[-5.7, 0, 1.3]], rig: rg, lamps, helm: [-4.6, 2.3, 0], mastTop: 15.7, sailArea: 1 };
}

// =====================================================================================================
// (b) big cruising catamaran, ~14 m
export function buildCat(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const hullMat = M.hull({ band: 0x303a46, bandY: [1.0, 1.1], boot: [0.0, 0.06], anti: 0x20303f });
  const hp = { L: 13.6, B: 1.55, dh: 0.5, fbMid: 1.1, fbBow: 1.5, fbStern: 1.15, pn: 3.0, pm: 0.55, tw: 0.82, eMid: 0.6, eBow: 1.0, rake: 0.5, kpos: 0.55 };
  const h = hull(hp), S = 2.75;
  for (const sd of [-1, 1]) {
    const hm = new THREE.Matrix4().makeTranslation(0, 0, sd * S);
    K.add(hullMat, h.shell, hm); K.add(M.white, h.deck, hm);
    K.add(M.dark, fin([[-0.5, -0.1], [0.6, -0.1], [0.4, -0.8], [-0.1, -0.8]], 0.1, 0.02), new THREE.Matrix4().makeTranslation(0.5, 0, sd * S));
    K.add(M.dark, fin([[-6.5, -0.1], [-6.2, -0.1], [-6.25, -1.0], [-6.45, -1.0]], 0.07, 0.015), new THREE.Matrix4().makeTranslation(0, 0, sd * S));
    K.add(M.teak, slab(rrect(0.9, 1.4, 0.1), 0.1, 0.06, 0.01), -7.3, 0, sd * S);
  }
  // bridgedeck, cabin, windows
  K.add(M.white, slab([[-6.3, -3.4], [3.8, -3.4], [4.2, -2.6], [4.2, 2.6], [3.8, 3.4], [-6.3, 3.4]], 1.2, 0.22, 0.06), 0, 0, 0);
  K.add(M.teak, slab(rrect(4.4, 5.2, 0.15), 1.42, 0.03, 0.005), -4.0, 0, 0);
  const cabin = [[3.2, -1.0], [3.6, 0], [3.2, 1.0], [2.4, 2.45], [-1.8, 2.45], [-1.8, -2.45], [2.4, -2.45]];
  K.add(M.white, slab(cabin, 1.45, 1.15, 0.12));
  K.add(M.glass, box(4.0, 0.58, 0.04, 0.4, 2.25, 2.45)); K.add(M.glass, box(4.0, 0.58, 0.04, 0.4, 2.25, -2.45));
  K.add(M.glass, box(0.04, 0.6, 1.6, 3.62, 2.25, 0));
  K.add(M.white, slab(rrect(6.4, 5.4, 0.2), 2.58, 0.1, 0.03), -1.0, 0, 0);          // hardtop
  for (const [x, z] of [[-4.0, -2.45], [-4.0, 2.45]]) K.add(M.alu, rod([x, 1.45, z], [x, 2.62, z], 0.04));
  // trampoline between the bows, forward of the cabin
  K.add(M.net, slab([[4.0, -2.55], [6.6, -1.3], [6.6, 1.3], [4.0, 2.55]], 1.28, 0.02, 0.0));
  K.add(M.chrome, tube([[6.7, 1.7, -1.7], [7.0, 1.7, 0], [6.7, 1.7, 1.7]], 0.02, 20, 5));
  for (const sd of [-1, 1]) { lifelines(K, M, h, -6.0, 5.6, 0.62, 1.4, sd * S); }
  bowRail(K, M, h, 6.6, 0.62, -S); bowRail(K, M, h, 6.6, 0.62, S);
  const mx = 2.4;
  K.add(M.alu, rod([mx, 1.6, 0], [mx, 17.0, 0], 0.11, 0.05, 10));
  K.add(M.alu, rod([mx - 0.1, 3.0, 0], [mx - 4.6, 3.05, 0], 0.05, 0.04, 8));
  for (const yy of [7, 11.5]) for (const sd of [-1, 1]) K.add(M.alu, rod([mx, yy, 0], [mx, yy + 0.2, sd * 0.95], 0.02, 0.015, 5));
  const L2 = [], seg = (a, b) => L2.push(...a, ...b);
  seg([mx, 16.8, 0], [7.2, 1.4, 0]); seg([mx, 16.8, 0], [-6.9, 1.4, 0]);
  for (const sd of [-1, 1]) { seg([mx, 16.4, 0], [mx + 0.1, 7.2, sd * 0.95]); seg([mx + 0.1, 7.2, sd * 0.95], [mx + 0.2, 1.4, sd * 3.1]); seg([mx, 11.5, 0], [mx, 11.7, sd * 0.95]); seg([mx, 11.7, sd * 0.95], [mx + 0.2, 1.4, sd * 3.1]); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(L2, 3));
  group.add(K.build(new THREE.Group()), new THREE.LineSegments(lg, new THREE.LineBasicNodeMaterial({ color: 0x31373c })));
  // sails
  const mu = sailUniforms(3.05), gu = sailUniforms(1.5);
  const mainMesh = new THREE.Mesh(sailGeo([-0.12, 3.1, 0], [-0.14, 16.6, 0], [-4.55, 3.15, 0], { roach: 0.9, nB: 28 }), M.sail(mu)); mainMesh.frustumCulled = false;
  const mainPivot = new THREE.Group(); mainPivot.position.set(mx, 0, 0); mainPivot.add(mainMesh); group.add(mainPivot);
  const tack = V3(6.9, 1.5, 0), headP = V3(mx + 0.05, 15.6, 0), clewP = V3(0.9, 2.3, 0);
  const genMesh = new THREE.Mesh(sailGeo([0, 0, 0], headP.clone().sub(tack).toArray(), clewP.clone().sub(tack).toArray(), { roach: 0.15, nB: 28 }), M.sail(gu)); genMesh.frustumCulled = false;
  const genPivot = new THREE.Group(); genPivot.position.copy(tack); genPivot.add(genMesh); group.add(genPivot);
  const rig = { main: { uni: mu, pivot: mainPivot, axis: V3(0, 1, 0) }, genoa: { uni: gu, pivot: genPivot, axis: headP.clone().sub(tack).normalize(), clew: clewP.clone().sub(tack) } };
  const lamps = lightsOf(group, [[0xff2a1a, 6.2, 1.8, -S, 1.0], [0x22ff55, 6.2, 1.8, S, 1.0], [0xfff4d8, -6.9, 1.9, 0, 1.0], [0xfff4d8, mx, 17.3, 0, 2.4], [0xffe2a8, -3.5, 2.5, 0, 1.3]]);
  return { group, kind: 'cat', L: 13.6, B: 6.9, draft: 1.0, buoy: [[6, -S], [6, S], [-6, -S], [-6, S], [0, 0]], trails: [[-6.8, -S, 1.0], [-6.8, S, 1.0]], rig, lamps, helm: [-3.5, 3.0, 0.9], mastTop: 17.3 };
}
