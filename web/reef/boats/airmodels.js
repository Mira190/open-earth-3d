// (e) Seaplane (Caravan-style amphibian on floats) and scenic-flight helicopter (R44 / AS350 style).
// Local frame as the boats: +X nose, +Y up, +Z right. Seaplane origin at the float waterline; helicopter origin at the skid soles.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, smoothstep, uv, mix } from 'three/tsl';
import { Kit, box, cyl, rod, ellipsoid, rrect, slab, fin, tube, hull, materials, lamp } from './kit.js';

const lathe = (prof, seg = 20) => new THREE.LatheGeometry(prof.map(([x, r]) => new THREE.Vector2(r, x)), seg).rotateZ(-Math.PI / 2);  // axis along +X

function rotorDisc(radius) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.colorNode = vec3(0.12, 0.13, 0.14);
  m.opacityNode = Fn(() => float(1).sub(smoothstep(0.55, 1.0, uv().sub(0.5).length().mul(2))).mul(smoothstep(0.08, 0.2, uv().sub(0.5).length().mul(2))).mul(0.3))();
  const g = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), m);
  m.fog = true;
  return g;
}

export function buildSeaplane(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const livery = o.livery ?? 0x0e6a8a;
  const stripe = new THREE.MeshStandardNodeMaterial({ color: livery, roughness: 0.35 });
  // fuselage on a lathe: spinner-nose cowl, cabin, tapered tail cone
  const prof = [[5.75, 0.0], [5.55, 0.28], [5.1, 0.52], [4.4, 0.62], [3.6, 0.68], [2.0, 0.84], [0.0, 0.88], [-2.0, 0.82], [-3.8, 0.62], [-5.4, 0.36], [-6.3, 0.2], [-6.6, 0.0]];
  K.add(M.white, lathe(prof, 24).scale(1, 1.08, 0.94), 0, 2.15, 0);
  K.add(stripe, lathe(prof.map(([x, r]) => [x, r * 1.005]).filter(([x]) => x < 2.7 && x > -4.6), 24).scale(1, 0.42, 0.945), 0, 1.6, 0);   // belly colour band
  // cabin glazing: windscreen and side windows
  K.add(M.glass, new THREE.BoxGeometry(0.05, 0.5, 1.25).rotateZ(-0.5).translate(3.55, 2.62, 0));
  for (const sd of [-1, 1]) {
    K.add(M.glass, box(4.6, 0.38, 0.03, 0.9, 2.45, sd * 0.84));
    K.add(M.glass, box(1.0, 0.45, 0.03, 3.3, 2.5, sd * 0.69).rotateY(sd * 0.0));
  }
  // engine cowl intake and the exhaust
  K.add(M.dark, ellipsoid(0.12, 0.2, 0.44), 5.5, 2.0, 0);
  for (const sd of [-1, 1]) K.add(M.dark, rod([4.1, 1.9, sd * 0.5], [3.7, 1.6, sd * 0.62], 0.05, 0.05, 6));
  // high wing, struts, tail
  K.add(M.white, slab([[1.4, -7.95], [1.4, 7.95], [-0.3, 7.95], [-0.3, -7.95]], 3.0, 0.2, 0.06));
  K.add(stripe, box(1.72, 0.215, 1.4, 0.55, 3.1, 7.2)); K.add(stripe, box(1.72, 0.215, 1.4, 0.55, 3.1, -7.2));
  for (const sd of [-1, 1]) { K.add(M.alu, rod([1.2, 1.4, sd * 0.85], [1.35, 3.0, sd * 3.6], 0.045, 0.045, 6)); K.add(M.alu, rod([0.6, 1.4, sd * 0.85], [0.75, 3.0, sd * 3.6], 0.03, 0.03, 6)); }
  K.add(M.white, fin([[-6.6, 2.4], [-4.6, 2.4], [-5.6, 4.9], [-6.6, 4.9]], 0.1, 0.02));
  K.add(stripe, fin([[-6.2, 3.7], [-5.4, 3.7], [-5.6, 4.9], [-6.4, 4.9]], 0.105, 0.02));
  K.add(M.white, slab([[-5.3, -2.7], [-5.3, 2.7], [-6.8, 2.7], [-6.8, -2.7]], 2.65, 0.08, 0.025));
  // floats on struts
  const fh = hull({ L: 8.4, B: 0.8, dh: 0.34, fbMid: 0.55, fbBow: 0.95, fbStern: 0.5, pn: 3, pm: 0.55, tw: 0.35, eMid: 0.75, eBow: 1.0, rake: 0.4, kpos: 0.45, kp: 1.5, nS: 36, nU: 8, camber: 0.1, sternDraft: 0.3 });
  const floatMat = M.hull({ top: 0xf2f4f4, band: livery, bandY: [0.28, 0.4], boot: [0.0, 0.05], anti: 0x1b2a3a });
  for (const sd of [-1, 1]) {
    const m4 = new THREE.Matrix4().makeTranslation(0.4, 0, sd * 1.42);
    K.add(floatMat, fh.shell, m4); K.add(M.white, fh.deck, m4);
    for (const x of [2.0, -1.8]) { K.add(M.alu, rod([x + 0.4, 0.5, sd * 1.42], [x * 0.5, 1.5, sd * 0.7], 0.05, 0.05, 6)); K.add(M.alu, rod([x + 0.4 + 0.5, 0.5, sd * 1.42], [x * 0.5 + 0.25, 1.5, sd * 0.7], 0.04, 0.04, 6)); }
    K.add(M.alu, rod([2.5, 0.52, sd * 1.42], [-1.4, 0.52, sd * 1.42], 0.03, 0.03, 6));
    K.add(M.dark, fin([[-3.4, -0.35], [-3.0, -0.35], [-3.1, -0.9], [-3.45, -0.9]], 0.05, 0.01), 0.4, 0, sd * 1.42);   // water rudder
  }
  K.add(M.alu, rod([1.0, 0.5, -1.42], [1.0, 0.5, 1.42], 0.04, 0.04, 6)); K.add(M.alu, rod([-1.4, 1.1, -1.0], [-1.4, 1.1, 1.0], 0.04, 0.04, 6));
  group.add(K.build(new THREE.Group()));
  // propeller: three blades on a spinner, spins about +X
  const prop = new THREE.Group(); prop.position.set(5.85, 2.15, 0);
  const pk = new Kit();
  for (let i = 0; i < 3; i++) pk.at(M.alu, box(0.05, 1.45, 0.16).translate(0, 0.8, 0), 0, 0, 0, i * 2.094, 0, 0);
  pk.add(M.alu, ellipsoid(0.16, 0.17, 0.17).translate(0.05, 0, 0));
  pk.build(prop);
  prop.add(rotorDisc(1.45).rotateZ(Math.PI / 2));
  group.add(prop);
  const lamps = [[0xff2a1a, 0.6, 3.1, -8.0, 0.8], [0x22ff55, 0.6, 3.1, 8.0, 0.8], [0xfff4d8, -6.8, 3.3, 0, 0.8], [0xfff4d8, -5.6, 5.0, 0, 1.2]].map(([c, x, y, z, s]) => lamp(group, c, x, y, z, s));
  return { group, kind: 'seaplane', L: 12.8, B: 16.1, draft: 0.4, buoy: [[3.8, -1.42], [3.8, 1.42], [-3.0, -1.42], [-3.0, 1.42]], trails: [[-3.0, -1.42, 0.7], [-3.0, 1.42, 0.7]], prop, lamps, helm: [1.8, 2.8, 0.45], aircraft: { vr: 26, vmax: 55, prop: 'x' } };
}

export function buildHeli(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const livery = o.livery ?? 0x0e6a8a;
  const stripe = new THREE.MeshStandardNodeMaterial({ color: livery, roughness: 0.35 });
  const orange = M.orange;
  // body: bubble cabin, engine deck, tail boom
  K.add(M.white, lathe([[1.7, 0.0], [1.6, 0.35], [1.2, 0.62], [0.5, 0.75], [-0.4, 0.76], [-1.2, 0.62], [-1.9, 0.34], [-2.1, 0.0]], 20).scale(1, 0.95, 0.88), 0, 1.15, 0);
  K.add(M.glass, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.95, 0.72, 0.74), 1.0, 1.25, 0);
  K.add(M.glass, box(1.0, 0.45, 0.02, -0.1, 1.55, 0.67)); K.add(M.glass, box(1.0, 0.45, 0.02, -0.1, 1.55, -0.67));
  K.add(stripe, lathe([[0.2, 0.0], [0.0, 0.7], [-0.9, 0.7], [-1.0, 0]].map(([x, r]) => [x, r * 1.0]), 8).scale(1, 0.12, 0.9).translate(0, 1.0, 0));
  K.add(M.white, rod([-1.6, 1.4, 0], [-6.0, 1.65, 0], 0.3, 0.09, 12));
  K.add(stripe, rod([-3.5, 1.52, 0], [-4.6, 1.58, 0], 0.202, 0.17, 12));
  K.add(M.white, fin([[-5.4, 1.55], [-6.15, 1.55], [-6.35, 2.55], [-5.9, 2.55]], 0.06, 0.012));
  K.add(M.white, slab([[-5.0, -0.8], [-5.0, 0.8], [-5.6, 0.8], [-5.6, -0.8]], 1.58, 0.05, 0.012));
  K.add(M.white, ellipsoid(0.9, 0.42, 0.52), -0.7, 2.05, 0);          // engine cowl / transmission fairing
  K.add(M.dark, rod([-1.4, 1.95, -0.25], [-2.2, 1.75, -0.25], 0.07, 0.06, 6));
  // skids
  for (const sd of [-1, 1]) {
    K.add(M.black, rod([-1.4, 0.07, sd * 0.95], [1.8, 0.07, sd * 0.95], 0.045, 0.045, 8));
    K.add(M.black, tube([[1.8, 0.07, sd * 0.95], [2.1, 0.2, sd * 0.93], [2.25, 0.45, sd * 0.9]], 0.045, 8, 6));
    for (const x of [0.65, -0.65]) K.add(M.black, rod([x, 0.07, sd * 0.95], [x * 0.9, 0.85, sd * 0.42], 0.035, 0.035, 6));
  }
  // seats and instruments barely visible through the glass
  K.add(M.dark, box(0.4, 0.4, 1.0, 0.0, 1.0, 0)); K.add(M.dark, box(0.12, 0.3, 0.9, 0.9, 1.3, 0));
  group.add(K.build(new THREE.Group()));
  // main rotor: mast, hub, two blades, soft blur disc; the tail rotor is a small cross
  const rotor = new THREE.Group(); rotor.position.set(-0.7, 2.6, 0);
  const mast = new Kit(); mast.add(M.dark, cyl(0.07, 0.07, 0.5, 8).translate(-0.7, 2.35, 0)); mast.build(group);
  const rk = new Kit();
  rk.add(M.black, box(5.1, 0.025, 0.28, 2.55, 0, 0)); rk.add(M.black, box(5.1, 0.025, 0.28, -2.55, 0, 0));
  rk.add(M.alu, cyl(0.12, 0.12, 0.12, 10)); rk.add(M.orange, box(0.2, 0.03, 0.3, 4.95, 0.002, 0)); rk.add(M.orange, box(0.2, 0.03, 0.3, -4.95, 0.002, 0));
  rk.build(rotor); rotor.add(rotorDisc(5.1)); group.add(rotor);
  const tail = new THREE.Group(); tail.position.set(-6.05, 1.95, 0.1);
  const tk = new Kit(); tk.add(M.black, box(0.04, 0.9, 0.1)); tk.add(M.black, box(0.04, 0.1, 0.9)); tk.build(tail);
  group.add(tail);
  const lamps = [[0xff2a1a, 1.0, 1.1, -0.75, 0.6], [0x22ff55, 1.0, 1.1, 0.75, 0.6], [0xfff4d8, -6.2, 2.5, 0, 0.7], [0xffffff, -0.7, 2.75, 0, 0.8]].map(([c, x, y, z, s]) => lamp(group, c, x, y, z, s));
  return { group, kind: 'helicopter', L: 11, B: 10.2, draft: 0, buoy: [], trails: [], prop: rotor, tail, lamps, helm: [0.6, 1.7, 0.3], aircraft: { vr: 0, vmax: 55, rotor: true } };
}
