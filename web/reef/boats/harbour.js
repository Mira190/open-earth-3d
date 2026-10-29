// Static and floating structures: a Reefworld-style tour pontoon (covered deck, slide), a floating helipad, a timber
// jetty with finger pontoons for the marinas, and GBRMPA-style mooring buoys.
// Floating things return { group, float: { pts, k } } so boats.js can heave them with the swell; the jetty is fixed.
import * as THREE from 'three/webgpu';
import { Kit, box, cyl, rod, ellipsoid, rrect, slab, tube, materials, lamp, caster, shared } from './kit.js';

// a half-pipe trough swept along a path, open at the top: the pontoon slide
function halfPipe(path, r = 0.55, seg = 60, arc = 14) {
  const c = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const pos = [], idx = [], up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, p = c.getPoint(t), tg = c.getTangent(t);
    const side = new THREE.Vector3().crossVectors(tg, up).normalize();
    const dn = new THREE.Vector3().crossVectors(side, tg).normalize().multiplyScalar(-1).negate(); // roughly up, perpendicular to the path
    for (let j = 0; j <= arc; j++) {
      const a = Math.PI + (j / arc) * Math.PI;
      const q = p.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(dn, Math.sin(a) * r * 0.9 + r * 0.9);
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < arc; j++) { const a = i * (arc + 1) + j, b = a + 1, cc = a + arc + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function curvedRoof(w, d, y, rise, nx = 12, nz = 8) {
  const g = new THREE.PlaneGeometry(w, d, nx, nz).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, y + rise * (1 - (z / (d / 2)) ** 2)); }
  g.computeVertexNormals();
  return g;
}

export function buildPontoon() {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const W = 30, D = 11;
  const slideMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b86d6, roughness: 0.3, side: THREE.DoubleSide });
  // float body, deck and bumper
  K.add(M.white, slab(rrect(W, D, 1.4), -0.7, 1.25, 0.1));
  K.add(M.dark, slab(rrect(W - 0.6, D - 0.6, 1.3), -1.2, 0.55, 0.05));
  K.add(M.nonslip, slab(rrect(W - 0.8, D - 0.8, 1.2), 0.5, 0.05, 0.01));
  const ring = []; for (const [pt] of rrect(W + 0.1, D + 0.1, 1.4, 8).map(p => [p])) ring.push([pt[0], 0.15, pt[1]]);
  K.add(M.blue, tube(ring, 0.17, 160, 8, true));
  // covered deck: posts, beams, curved roof, bar and tables
  for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) K.add(M.alu, rod([-8 + i * 4, 0.55, sd * 3.7], [-8 + i * 4, 3.2, sd * 3.7], 0.07, 0.07, 6));
  for (const sd of [-1, 1]) K.add(M.alu, rod([-8, 3.2, sd * 3.7], [8, 3.2, sd * 3.7], 0.06, 0.06, 6));
  K.add(M.shade, curvedRoof(17, 8.6, 3.2, 0.5), -0, 0, 0);
  K.add(M.blue, slab([[-8.6, -4.5], [8.6, -4.5], [8.6, -4.35], [-8.6, -4.35]], 3.15, 0.12, 0.0));
  K.add(M.white, box(7, 1.05, 0.9, -3, 1.05, -3.2)); K.add(M.woodRail, box(7.2, 0.06, 1.0, -3, 1.6, -3.2));
  for (let i = 0; i < 4; i++) for (const sd of [0, 1]) {
    const x = -7 + i * 4.2, z = 0.2 + sd * 1.9;
    K.add(M.white, cyl(0.5, 0.5, 0.05).translate(x, 1.2, z)); K.add(M.alu, rod([x, 0.55, z], [x, 1.2, z], 0.04));
    for (const a of [0, 1.6, 3.2, 4.8]) K.add(M.blue, box(0.4, 0.05, 0.4, x + Math.cos(a) * 0.9, 0.95, z + Math.sin(a) * 0.9));
  }
  // slide tower and the slide
  K.add(M.alu, box(2.2, 0.08, 2.2, 12.3, 3.15, 3.0));
  for (const [x, z] of [[11.3, 2.0], [13.3, 2.0], [11.3, 4.0], [13.3, 4.0]]) K.add(M.alu, rod([x, 0.5, z], [x, 3.15, z], 0.06, 0.06, 6));
  for (let i = 0; i < 9; i++) K.add(M.alu, box(0.9, 0.05, 0.25, 11.0 - i * 0.0, 0.5 + i * 0.3, 1.0 + i * 0.0).translate(0, 0, 0));
  K.add(slideMat, halfPipe([[13.3, 3.4, 3.0], [14.6, 3.1, 3.6], [15.6, 2.2, 5.0], [14.8, 1.2, 6.8], [13.4, 0.55, 7.4], [12.0, 0.15, 7.6]], 0.55, 60));
  for (const [x, z] of [[14.6, 3.6], [15.6, 5.0], [14.8, 6.8]]) K.add(M.alu, rod([x, 0.5, z], [x, 2.7, z], 0.04, 0.04, 6));
  // dive stage, ladders, railings, fenders
  const rail = (a, b) => { K.add(M.chrome, rod([a[0], 1.4, a[1]], [b[0], 1.4, b[1]], 0.025, 0.025, 6)); K.add(M.chrome, rod([a[0], 0.9, a[1]], [b[0], 0.9, b[1]], 0.018, 0.018, 5)); };
  rail([-14.6, -5.0], [-14.6, 5.0]); rail([-14.6, 5.0], [14.6, 5.0]); rail([14.6, 5.0], [14.6, -5.0]); rail([14.6, -5.0], [-14.6, -5.0]);
  for (let i = 0; i <= 28; i++) { const x = -14.5 + i, z = 5.0; K.add(M.chrome, rod([x, 0.55, z], [x, 1.4, z], 0.02, 0.02, 5)); K.add(M.chrome, rod([x, 0.55, -z], [x, 1.4, -z], 0.02, 0.02, 5)); }
  for (const x of [-12, -3, 6]) for (const sd of [-1, 1]) K.add(M.black, cyl(0.2, 0.2, 0.9, 10).translate(x, 0.0, sd * (D / 2 + 0.2)));
  for (const x of [-6, 2]) { K.add(M.chrome, tube([[x, 1.0, 5.0], [x, 0.0, 5.3], [x, -1.4, 5.3]], 0.03, 12, 5)); K.add(M.chrome, tube([[x + 0.6, 1.0, 5.0], [x + 0.6, 0.0, 5.3], [x + 0.6, -1.4, 5.3]], 0.03, 12, 5)); }
  // sun-lounger deck rows and a flag pole
  for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) K.add(M.white, box(0.7, 0.12, 1.8, -13 + i * 1.0, 0.7, sd * 0.0 - 0.0 + (sd > 0 ? 3.6 : -3.6)).translate(0, 0, 0));
  K.add(M.alu, rod([-14, 0.5, -4.5], [-14, 6.5, -4.5], 0.05, 0.04)); K.add(M.blue, box(0.02, 0.6, 1.0, -14, 6.2, -4.0));
  group.add(K.build(new THREE.Group()));
  // deck lights under the roof beams; each pair across the deck lights it as one downlight on the centre line
  const lamps = [[-10, 3.0, 3.7], [0, 3.0, 3.7], [10, 3.0, 3.7], [-10, 3.0, -3.7], [0, 3.0, -3.7], [10, 3.0, -3.7]].map(([x, y, z]) => lamp(group, 0xffe2a8, x, y, z, 0.9));
  const casters = [-10, 0, 10].map(x => caster(group, 0xffe2a8, x, 3.0, 0, 3, 16));
  return { group, kind: 'pontoon', W, D, float: { pts: [[-12, -4], [-12, 4], [12, -4], [12, 4]], k: 0.7 }, lamps, casters, berth: { z: D / 2 + 0.7 } };
}

export function buildHelipad() {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const padMat = new THREE.MeshStandardNodeMaterial({ color: 0x3c4a54, roughness: 0.85 });
  K.add(M.white, cyl(7.4, 7.4, 1.0, 36).translate(0, -0.1, 0));
  K.add(padMat, cyl(7.0, 7.0, 0.05, 36).translate(0, 0.42, 0));
  K.add(M.yellow, new THREE.TorusGeometry(6.6, 0.12, 6, 48).rotateX(Math.PI / 2).translate(0, 0.46, 0));
  for (const [x, z, sx, sz] of [[0, -1.0, 0.35, 3.0], [0, 1.0, 0.35, 3.0], [0, 0, 2.0, 0.35]]) K.add(M.white, box(sx * 1, 0.02, sz * 1, x, 0.46, z));
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; K.add(M.orange, cyl(0.2, 0.2, 0.5).translate(Math.cos(a) * 7.5, 0.0, Math.sin(a) * 7.5)); }
  group.add(K.build(new THREE.Group()));
  const lamps = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; lamps.push(lamp(group, 0x6dd6ff, Math.cos(a) * 7.0, 0.62, Math.sin(a) * 7.0, 0.45)); }   // perimeter lights, low on the rim
  return { group, kind: 'helipad', float: { pts: [[5, 0], [-5, 0], [0, 5], [0, -5]], k: 0.9 }, lamps, radius: 7 };
}

// a timber jetty reaching out along +X from its landward end, with finger pontoons on the +Z side; deckY above the tide
export function buildJetty({ len = 70, fingers = 4, deckY = 1.5 } = {}) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  const w = 3.0;
  K.add(M.woodPlank, box(len, 0.14, w, len / 2, deckY, 0));
  for (let x = 1; x <= len; x += 3.5) for (const sd of [-1, 1]) K.add(M.pile, cyl(0.2, 0.2, deckY + 5.5, 8).translate(x, deckY / 2 - 2.5, sd * (w / 2 - 0.2)));
  K.add(M.pile, box(len, 0.2, 0.22, len / 2, deckY - 0.18, w / 2 - 0.3)); K.add(M.pile, box(len, 0.2, 0.22, len / 2, deckY - 0.18, -w / 2 + 0.3));
  for (const sd of [-1, 1]) { K.add(M.woodRail, box(len, 0.06, 0.07, len / 2, deckY + 1.0, sd * (w / 2 - 0.05))); for (let x = 0.5; x < len; x += 3.5) K.add(M.woodRail, box(0.08, 1.0, 0.08, x, deckY + 0.5, sd * (w / 2 - 0.05))); }
  const lamps = [];
  const casters = [];
  for (let x = 6; x < len; x += 14) { K.add(M.alu, rod([x, deckY, -w / 2], [x, deckY + 3.0, -w / 2], 0.05, 0.04, 6)); K.add(M.white, ellipsoid(0.18, 0.18, 0.18), x, deckY + 3.1, -w / 2); lamps.push(lamp(group, 0xffe2a8, x, deckY + 3.1, -w / 2, 1.1)); casters.push(caster(group, 0xffe2a8, x, deckY + 2.95, -w / 2 + 0.3, 2.5, 14)); }
  for (let x = 4; x < len; x += 12) K.add(M.black, cyl(0.14, 0.14, 0.35).translate(x, deckY + 0.25, w / 2 - 0.2));
  // finger pontoons: floating timber-decked fingers with a white float, berths between them
  const fing = [];
  const fx0 = len - fingers * 12 - 2;
  for (let i = 0; i < fingers; i++) {
    const x = Math.max(8, fx0) + i * 12;
    fing.push(x);
    K.add(M.woodPlank, box(1.3, 0.1, 12.0, x, 0.35, w / 2 + 6.2).rotateY(0));
    K.add(M.white, box(1.1, 0.5, 11.8, x, 0.1, w / 2 + 6.2));
    K.add(M.pile, box(0.18, 0.4, 0.18, x + 0.5, deckY * 0.5, w / 2 + 0.3).translate(0, 0, 0));
    K.add(M.black, cyl(0.1, 0.1, 0.3).translate(x, 0.55, w / 2 + 11.5));
  }
  group.add(K.build(new THREE.Group()));
  return { group, kind: 'jetty', len, w, fingers: fing, lamps, casters };
}

// a GBRMPA public mooring: yellow float, black band, pick-up pennant and a chain down to the bottom (floats with the sea)
export function buildMooring(depth = 8) {
  const M = materials(), K = new Kit(), group = new THREE.Group();
  K.add(M.yellow, cyl(0.55, 0.45, 0.8, 16).translate(0, 0.05, 0));
  K.add(M.black, cyl(0.56, 0.56, 0.15, 16).translate(0, 0.0, 0));
  K.add(M.white, new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.45, 0));
  K.add(M.rope, tube([[0, 0.8, 0], [0.5, 1.0, 0.1], [0.9, 0.9, 0.3], [0.8, 0.4, 0.6]], 0.03, 14, 5));
  K.add(M.chrome, rod([0, 0.45, 0], [0, 1.0, 0], 0.03));
  K.add(M.black, rod([0, -0.4, 0], [0.3, -depth * 0.85, 0], 0.03, 0.03, 4));
  group.add(K.build(new THREE.Group()));
  return { group, kind: 'mooring', float: { pts: [[0, 0]], k: 1 } };
}
