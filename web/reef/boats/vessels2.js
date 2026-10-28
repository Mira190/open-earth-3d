// (c) Whitsunday day-tour fast catamaran and (d) open dive tinnie / RIB. Same descriptor as vessels.js.
import * as THREE from 'three/webgpu';
import { Kit, box, cyl, rod, ellipsoid, rrect, slab, fin, tube, hull, materials, lamp } from './kit.js';
import { lifelines } from './vessels.js';

const lightsOf = (g, list) => list.map(([c, x, y, z, s]) => lamp(g, c, x, y, z, s));

// a straight rail on a deck plan edge: posts and two rails between 2D points
function railLine(K, M, a, b, y, h = 1.0, step = 1.2) {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n; K.add(M.chrome, rod([x, y, z], [x, y + h, z], 0.02, 0.02, 5)); }
  K.add(M.chrome, rod([a[0], y + h, a[1]], [b[0], y + h, b[1]], 0.022, 0.022, 6));
  K.add(M.chrome, rod([a[0], y + h * 0.5, a[1]], [b[0], y + h * 0.5, b[1]], 0.014, 0.014, 5));
}

// =====================================================================================================
// ~30 m twin-hull day boat: white hulls with a blue stripe, two enclosed decks and a bridge, bow ramp
export function buildDayCat(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const blue = 0x0e4a8a;
  const hullMat = M.hull({ band: blue, bandY: [1.0, 1.55], boot: [0.0, 0.1], anti: 0x16314d });
  const L = 30, S = 3.2;
  const h = hull({ L, B: 2.7, dh: 1.0, fbMid: 1.95, fbBow: 2.8, fbStern: 2.0, pn: 3.4, pm: 0.5, tw: 0.9, eMid: 0.82, eBow: 1.0, rake: 1.6, kpos: 0.6, kp: 1.6, nS: 54, sternDraft: 0.25 });
  for (const sd of [-1, 1]) {
    const hm = new THREE.Matrix4().makeTranslation(0, 0, sd * S);
    K.add(hullMat, h.shell, hm); K.add(M.nonslip, h.deck, hm);
    K.add(M.dark, box(1.4, 0.5, 0.9, -L / 2 + 0.7, -0.6, 0), new THREE.Matrix4().makeTranslation(0, 0, sd * S)); // waterjet/prop tunnel shading
    K.add(M.nonslip, slab(rrect(1.6, 2.1, 0.12), 0.35, 0.08, 0.02), -L / 2 - 0.6, 0, sd * S);  // swim platforms
  }
  // main deck: spans between the hulls
  const yD = 2.0;
  K.add(M.white, slab([[-14.6, -S - 1.35], [10.0, -S - 1.35], [11.2, -1.8], [11.2, 1.8], [10.0, S + 1.35], [-14.6, S + 1.35]], yD - 0.1, 0.3, 0.05));
  K.add(M.nonslip, slab([[-14.6, -S - 1.3], [-12.0, -S - 1.3], [-12.0, S + 1.3], [-14.6, S + 1.3]], yD + 0.2, 0.02, 0.0));   // open aft deck
  // lower saloon: tapered front, band of windows
  const plan1 = [[7.8, -3.0], [9.4, -1.5], [9.4, 1.5], [7.8, 3.0], [-9.6, 4.45], [-12.0, 4.45], [-12.0, -4.45], [-9.6, -4.45]];
  const hl = 2.55, y1 = yD + 0.2;
  K.add(M.white, slab(plan1, y1, hl, 0.1));
  // window band wraps the saloon: boxes along the sides and across the front
  const winY = y1 + 1.35;
  K.add(M.glass, box(18.2, 1.1, 0.05, -2.2, winY, 4.43)); K.add(M.glass, box(18.2, 1.1, 0.05, -2.2, winY, -4.43));
  K.add(M.glass, new THREE.BoxGeometry(2.2, 1.1, 0.05).rotateY(Math.atan2(1.6, 2.4)).translate(8.6, winY, 2.3)); K.add(M.glass, new THREE.BoxGeometry(2.2, 1.1, 0.05).rotateY(-Math.atan2(1.6, 2.4)).translate(8.6, winY, -2.3));
  K.add(M.glass, box(0.05, 1.1, 2.2, 9.4, winY, 0));
  K.add(M.glass, box(0.05, 1.1, 8.6, -12.0, winY, 0));
  // blue stripe across the saloon sides, below the windows
  for (const sd of [-1, 1]) K.add(M.blue, box(24.0, 0.32, 0.06, -2.4, y1 + 0.5, sd * 4.46));
  // upper deck roof (viewing deck) with a rail
  const y2 = y1 + hl;
  K.add(M.white, slab(plan1.map(([x, z]) => [x * 0.99, z * 1.01]), y2, 0.18, 0.05));
  railLine(K, M, [-12.0, -4.45], [-12.0, 4.45], y2 + 0.18); railLine(K, M, [-12.0, -4.45], [-9.6, -4.45], y2 + 0.18); railLine(K, M, [-12.0, 4.45], [-9.6, 4.45], y2 + 0.18);
  // upper cabin and bridge
  const plan2 = [[5.0, -2.4], [6.6, -1.2], [6.6, 1.2], [5.0, 2.4], [-5.8, 3.4], [-7.0, 3.4], [-7.0, -3.4], [-5.8, -3.4]];
  const hb2 = 2.4, y3 = y2 + 0.18;
  K.add(M.white, slab(plan2, y3, hb2, 0.1));
  K.add(M.glass, box(11.0, 1.0, 0.05, -0.6, y3 + 1.4, 3.36)); K.add(M.glass, box(11.0, 1.0, 0.05, -0.6, y3 + 1.4, -3.36));
  K.add(M.glass, new THREE.BoxGeometry(2.0, 1.0, 0.05).rotateY(Math.atan2(1.2, 1.6)).translate(5.9, y3 + 1.4, 1.95)); K.add(M.glass, new THREE.BoxGeometry(2.0, 1.0, 0.05).rotateY(-Math.atan2(1.2, 1.6)).translate(5.9, y3 + 1.4, -1.95));
  K.add(M.glass, box(0.05, 1.0, 2.4, 6.6, y3 + 1.4, 0));
  K.add(M.blue, slab(rrect(15, 6.2, 0.3), y3 + hb2, 0.14, 0.05), -0.4, 0, 0);       // blue roof
  for (const sd of [-1, 1]) K.add(M.blue, box(13.4, 0.24, 0.06, -0.8, y3 + 0.45, sd * 3.43));
  // wheelhouse on top: a small raised bridge
  K.add(M.white, slab([[3.0, -1.6], [4.2, 0], [3.0, 1.6], [-0.6, 1.9], [-0.6, -1.9]], y3 + hb2 + 0.14, 1.6, 0.08));
  K.add(M.glass, box(0.05, 0.8, 2.8, 4.18, y3 + hb2 + 0.14 + 0.95, 0).rotateZ(0)); K.add(M.glass, box(4.0, 0.8, 0.05, 1.2, y3 + hb2 + 0.14 + 0.95, 1.9)); K.add(M.glass, box(4.0, 0.8, 0.05, 1.2, y3 + hb2 + 0.14 + 0.95, -1.9));
  K.add(M.blue, slab(rrect(5.4, 4.4, 0.25), y3 + hb2 + 1.74, 0.1, 0.03), 1.4, 0, 0);
  // radar mast, antennas, funnel-like vents
  const yTop = y3 + hb2 + 1.84;
  K.add(M.alu, rod([0.6, yTop, 0], [0.6, yTop + 3.2, 0], 0.07, 0.04)); K.add(M.alu, box(1.2, 0.12, 0.2, 0.6, yTop + 2.6, 0)); K.add(M.grey, cyl(0.12, 0.12, 0.35).translate(0.6, yTop + 3.4, 0));
  for (const sd of [-1, 1]) K.add(M.alu, rod([-2.2, yTop, sd * 1.2], [-2.2, yTop + 1.6, sd * 1.2], 0.02, 0.01));
  for (const sd of [-1, 1]) K.add(M.dark, cyl(0.28, 0.28, 1.3).translate(-8.0, y3 + hb2 + 0.8, sd * 2.2));
  // bow ramp: a hinged ramp between the hulls, raised a little, with hydraulic rams
  const ramp = new THREE.Group();
  K.add(M.alu, box(2.6, 0.12, 3.3, 11.2 + 1.2, yD + 0.45, 0).rotateZ(0));
  const rampG = new THREE.BoxGeometry(3.6, 0.14, 3.4).rotateZ(-0.16).translate(11.8, 2.45, 0);
  K.add(M.nonslip, rampG);
  for (const sd of [-1, 1]) { K.add(M.chrome, rod([10.2, 2.2, sd * 1.5], [11.6, 2.7, sd * 1.5], 0.05)); K.add(M.yellow, box(0.12, 0.45, 0.06, 13.4, 2.5, sd * 1.8)); }
  // aft deck: benches, rail, boarding steps, tank bay
  railLine(K, M, [-14.6, -S - 1.35], [-14.6, S + 1.35], yD + 0.2, 1.0, 1.1);
  for (const sd of [-1, 1]) { railLine(K, M, [-14.6, sd * (S + 1.35)], [-12.0, sd * (S + 1.35)], yD + 0.2, 1.0, 1.1); railLine(K, M, [-12, sd * (S + 1.35)], [9.8, sd * (S + 1.35)], yD + 0.2, 0.9, 1.7); }
  for (let i = 0; i < 4; i++) K.add(M.blue, box(2.6, 0.18, 0.4, -13.2, yD + 0.45, -3.4 + i * 2.2), 0, 0, 0);
  for (const sd of [-1, 1]) { K.add(M.nonslip, box(1.6, 0.06, 1.2, -L / 2 - 0.4, 1.3, sd * S)); }
  // anchor, lifebuoys
  for (const sd of [-1, 1]) K.at(M.orange, new THREE.TorusGeometry(0.28, 0.07, 8, 16), -9.0, y1 + 1.2, sd * 4.5, 0, 0, 0);
  const lamps = lightsOf(group, [[0xff2a1a, 10.2, 4.6, -4.0, 1.4], [0x22ff55, 10.2, 4.6, 4.0, 1.4], [0xfff4d8, -13.9, 4.2, 0, 1.4], [0xfff4d8, 0.6, yTop + 3.7, 0, 2.6],
    [0xffe2a8, -13.0, 4.6, -3.5, 1.3], [0xffe2a8, -13.0, 4.6, 3.5, 1.3], [0xffe2a8, 2.0, 4.8, 3.6, 1.3], [0xffe2a8, 2.0, 4.8, -3.6, 1.3]]);
  group.add(K.build(new THREE.Group()));
  return { group, kind: 'daycat', L, B: 2 * S + 2.7, draft: 1.1, buoy: [[13, -S], [13, S], [-13, -S], [-13, S], [0, 0]], trails: [[-L / 2 - 0.3, -S, 2.0], [-L / 2 - 0.3, S, 2.0]], rig: null, lamps, helm: [4, y3 + hb2 + 1.1, 0.0], bowFoam: 1 };
}

// =====================================================================================================
// ~5.8 m rigid inflatable dive boat: collar tubes, V-hull, centre console, outboard, tanks racked on both sides
export function buildTinnie(o = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const grey = o.tube ?? M.tube;
  const hullMat = M.hull({ top: 0xe9ecec, band: 0x0f3f78, bandY: [0.32, 0.36], anti: 0x222c36, boot: [0.0, 0.05] });
  const h = hull({ L: 5.9, B: 2.15, dh: 0.34, fbMid: 0.32, fbBow: 0.55, fbStern: 0.32, pn: 2.2, pm: 0.62, tw: 0.9, eMid: 0.9, eBow: 1.0, rake: 0.25, kpos: 0.6, kp: 1.4, chine: 0.0, camber: 0.0, nS: 30, nU: 8, sternDraft: 0.1, flare: 0.1 });
  K.add(hullMat, h.shell); K.add(M.nonslip, h.deck);
  // inflated collar: two tubes meeting at the bow
  const R = 0.29, pts = [[-2.9, 0.5, -1.03], [-1.6, 0.5, -1.11], [0.2, 0.52, -1.05], [1.6, 0.55, -0.7], [2.55, 0.62, -0.28], [2.9, 0.66, 0]];
  const side = pts.map(p => [p[0], p[1], p[2]]), side2 = pts.map(p => [p[0], p[1], -p[2]]).reverse();
  K.add(grey, tube([...side, ...side2.slice(1)], R, 80, 12));
  for (const sd of [-1, 1]) K.add(grey, ellipsoid(R, R, R), -2.9, 0.5, sd * 1.03);
  K.add(M.rubber, tube([[-2.8, 0.2, -1.05], [0.2, 0.2, -1.04], [1.6, 0.3, -0.6]], 0.03, 20, 5));
  // console and helm
  K.add(M.white, slab(rrect(0.95, 0.72, 0.14), 0.3, 0.72, 0.07), -0.3, 0, 0);
  K.add(M.dark, box(0.2, 0.18, 0.5, 0.18, 0.95, 0));
  K.add(M.glassClear, new THREE.BoxGeometry(0.03, 0.4, 0.8).rotateZ(-0.35).translate(0.12, 1.2, 0));
  K.add(M.chrome, tube([[0.1, 1.0, -0.4], [0.1, 1.45, -0.4], [0.1, 1.45, 0.4], [0.1, 1.0, 0.4]], 0.014, 20, 5));
  K.add(M.dark, box(0.55, 0.12, 0.5, -1.0, 0.64, 0)); K.add(M.white, rod([-1.0, 0.3, 0], [-1.0, 0.64, 0], 0.05));    // helm seat on a pedestal
  K.add(M.dark, box(0.1, 0.14, 0.6, -1.2, 0.84, 0));
  // outboard: transom plate, cowl, leg, propeller
  K.add(M.white, box(0.1, 0.5, 1.5, -3.0, 0.52, 0));
  K.add(M.dark, slab(rrect(0.6, 0.44, 0.12), 0.4, 0.62, 0.08), -3.28, 0, 0);
  K.add(M.grey, box(0.2, 0.7, 0.2, -3.28, -0.1, 0)); K.add(M.grey, ellipsoid(0.34, 0.08, 0.1), -3.28, -0.46, 0);
  K.add(M.alu, ellipsoid(0.04, 0.2, 0.04), -3.55, -0.46, 0);
  K.add(M.red, box(0.04, 0.2, 0.34, -3.3, 1.0, 0));
  // dive tanks racked in a frame along each side: five per side, valves up
  for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) {
    const x = -2.4 + i * 0.36, z = sd * 0.77;
    K.add(M.alu, cyl(0.1, 0.1, 0.62, 12).translate(x, 0.65, z)); K.add(M.yellow, ellipsoid(0.1, 0.06, 0.1).translate(x, 0.97, z));
    K.add(M.black, cyl(0.025, 0.025, 0.1, 6).translate(x, 1.05, z));
  }
  for (const sd of [-1, 1]) { K.add(M.dark, rod([-2.5, 1.0, sd * 0.77], [-0.65, 1.0, sd * 0.77], 0.016)); K.add(M.dark, rod([-2.5, 0.38, sd * 0.77], [-0.65, 0.38, sd * 0.77], 0.016)); }
  // bow: anchor locker, grab handles, painter, flag
  K.add(M.white, slab(rrect(0.5, 0.5, 0.1), 0.4, 0.14, 0.03), 2.1, 0, 0);
  K.add(M.rope, tube([[2.6, 0.9, -0.2], [2.9, 0.95, 0], [2.6, 0.9, 0.2]], 0.014, 12, 4));
  K.add(M.red, box(0.03, 0.35, 0.5, -3.3, 1.7, 0.0));
  K.add(M.alu, rod([-3.3, 1.0, 0], [-3.3, 1.9, 0], 0.012));
  group.add(K.build(new THREE.Group()));
  const lamps = lightsOf(group, [[0xff2a1a, 2.55, 0.95, -0.4, 0.5], [0x22ff55, 2.55, 0.95, 0.4, 0.5], [0xfff4d8, -3.3, 1.95, 0, 0.7]]);
  return { group, kind: 'tinnie', L: 5.9, B: 2.6, draft: 0.4, buoy: [[2.4, 0], [-2.4, 0], [0, -1.1], [0, 1.1]], trails: [[-3.2, 0, 0.8]], rig: null, lamps, helm: [-1.1, 1.5, 0], planing: true };
}
