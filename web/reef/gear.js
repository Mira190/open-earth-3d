// Accessories for the reef people, built from primitives in the character's model space
// (metres, +y up, the character faces +z, its left is +x). Each builder gets `T`, the template
// measurements people.js takes from the mesh (head, torso, feet), and returns
// { obj, bone, ... }: people.js parents `obj` to the bone so it follows the animation.
import * as THREE from 'three/webgpu';

const cache = new Map();
// one shared material per look; the scene's fogNode veils them with the rest of the water column
export function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(color), roughness: o.rough ?? 0.6, metalness: o.metal ?? 0,
      transparent: o.opacity !== undefined && o.opacity < 1, opacity: o.opacity ?? 1, side: o.double ? THREE.DoubleSide : THREE.FrontSide });
    if (o.opacity !== undefined && o.opacity < 1) m.depthWrite = false;
    cache.set(key, m);
  }
  return m;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
const tube = (pts, r, m, seg = 24) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V(...p))), seg, r, 6, false), m);

// ---- headwear
function hat(T, o) {
  const g = new THREE.Group(), c = o.color || '#d9c9a0';
  const R = o.brim ?? 0.27;
  // crown and brim as one lathe: a slightly drooping brim
  const prof = [[0, 0.105], [0.09, 0.11], [0.122, 0.098], [0.13, 0.03], [0.136, 0.0], [R * 0.6, -0.008], [R, -0.03], [R + 0.008, -0.034], [R, -0.024], [R * 0.6, 0.0], [0.13, -0.004]];
  const m = mat(c, { rough: 0.9, double: true });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 28), m));
  g.add(mesh(new THREE.CylinderGeometry(0.1335, 0.1385, 0.026, 28, 1, true), mat(o.band || '#2b2f36', { rough: 0.8, double: true }), 0, 0.024, 0));
  g.position.set(T.head.cx, T.head.top - 0.075, T.head.cz + 0.008);
  g.rotation.x = -0.05;
  return { obj: g, bone: 'Head' };
}
function cap(T, o) {
  const g = new THREE.Group(), m = mat(o.color || '#1f4d7a', { rough: 0.85 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.138, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), m);
  dome.scale.set(1, 0.9, 1.05); g.add(dome);
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.008, 20, 1, false, -Math.PI * 0.42, Math.PI * 0.84), m);
  visor.scale.set(1, 1, 1.15); visor.position.set(0, -0.012, 0.075); visor.rotation.set(0.0, Math.PI, 0); visor.rotation.x = 0.0;
  const v2 = mesh(new THREE.BoxGeometry(0.2, 0.008, 0.1), m, 0, -0.016, 0.155); v2.rotation.x = 0.1;
  g.add(v2);
  g.position.set(T.head.cx, T.head.top - 0.105, T.head.cz - 0.01);
  return { obj: g, bone: 'Head' };
}

// ---- faces: polarised sunnies, a dive mask, a snorkel
function sunnies(T, o) {
  const g = new THREE.Group(), lens = mat(o.color || '#14171c', { rough: 0.08, metal: 0.7 }), fr = mat('#0b0c0e', { rough: 0.4 });
  const y = T.head.eye, z = T.head.front + 0.004;
  for (const s of [-1, 1]) {
    const l = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 18), lens, s * 0.045, y, z); l.rotation.x = Math.PI / 2; l.scale.set(1, 1, 0.8); g.add(l);
    const arm = mesh(new THREE.BoxGeometry(0.006, 0.006, T.head.front - T.head.cz + 0.04), fr, s * (T.head.halfW + 0.002), y + 0.008, (z + T.head.cz) / 2 - 0.02); g.add(arm);
  }
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), fr, 0, y + 0.012, z));
  return { obj: g, bone: 'Head' };
}
function mask(T, o) {
  const g = new THREE.Group(), face = new THREE.Group(), skirt = mat(o.color || '#101418', { rough: 0.5 });
  const y = T.head.eye, z = T.head.front;
  const ring = mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.05, 24, 1, true), skirt, 0, 0, 0); ring.rotation.x = Math.PI / 2; ring.scale.set(1.25, 1, 0.8); ring.material = mat(o.color || '#101418', { rough: 0.5, double: true });
  const glass = mesh(new THREE.CircleGeometry(0.058, 24), mat('#9fd8e8', { rough: 0.05, metal: 0.2, opacity: 0.28 }), 0, 0, 0.026); glass.scale.set(1.25, 0.8, 1);
  const frame = mesh(new THREE.TorusGeometry(0.058, 0.007, 8, 28), mat(o.frame || '#e7e7e2', { rough: 0.5 }), 0, 0, 0.026); frame.scale.set(1.25, 0.8, 1);
  face.add(ring, glass, frame);
  // the strap runs round the head at the mask's height
  const strap = new THREE.Mesh(new THREE.TorusGeometry(T.head.halfW + 0.006, 0.01, 6, 28, Math.PI * 1.35), skirt);
  strap.rotation.set(Math.PI / 2, 0, Math.PI * 0.325 + Math.PI / 2 - Math.PI * 0.675 + Math.PI * 0.5); strap.scale.set(1, 1.1, 1);
  strap.position.set(0, 0, T.head.cz - z + 0.0); face.add(strap);
  g.add(face);
  // on the face, or pushed up on the forehead
  g.userData.set = down => { face.position.set(0, down ? y : y + 0.085, down ? z + 0.012 : z - 0.012); face.rotation.x = down ? 0 : -0.35; };
  g.userData.set(true);
  return { obj: g, bone: 'Head' };
}
function snorkel(T, o) {
  const g = new THREE.Group(), m = mat(o.color || '#f2a413', { rough: 0.45 });
  const y = T.head.eye - 0.075, z = T.head.front;
  const s = -1; // worn on the left of the mask, the diver's left is +x, so put it on the right
  const x = -T.head.halfW - 0.012;
  const pts = [[-0.012, y - 0.005, z + 0.01], [-0.045, y + 0.0, z - 0.03], [x, y + 0.05, z - 0.1], [x - 0.01, T.head.top - 0.03, T.head.cz - 0.03], [x - 0.005, T.head.top + 0.1, T.head.cz + 0.0]];
  g.add(tube(pts, 0.0125, m, 20));
  g.add(mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.03, 10), mat('#1a1d22', { rough: 0.6 }), x - 0.005, T.head.top + 0.11, T.head.cz));
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.02, 0.022), mat('#16181c', { rough: 0.6 }), 0, y - 0.01, z + 0.012));
  g.userData.tip = V(x - 0.005, T.head.top + 0.13, T.head.cz);
  return { obj: g, bone: 'Head' };
}

// ---- fins: a blade under each foot, longer than the foot
function fins(T, o) {
  const out = [];
  const sh = new THREE.Shape();
  sh.moveTo(-0.045, 0); sh.lineTo(-0.1, 0.34); sh.quadraticCurveTo(0, 0.4, 0.1, 0.34); sh.lineTo(0.045, 0); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);                                  // lies flat: the blade's length runs along +z, thickness down
  const m = mat(o.color || '#1b8fb0', { rough: 0.45 }), rails = mat(o.rails || '#14181c', { rough: 0.5 });
  for (const s of [1, -1]) {
    const F = T.feet[s > 0 ? 'L' : 'R'], g = new THREE.Group();
    const blade = new THREE.Mesh(geo, m); blade.position.set(0, 0, 0); blade.rotation.x = 0;
    g.add(blade);
    for (const r of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.012, 0.016, 0.36), rails, r * 0.085, 0.004, 0.2));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.04, 0.17), rails, 0, 0.022, 0.03));   // the foot pocket
    g.position.set(F.cx, F.bottom + 0.006, F.front - 0.15);
    g.rotation.x = 0.0;
    out.push({ obj: g, bone: s > 0 ? 'Foot.L' : 'Foot.R' });
  }
  return out;
}

// ---- scuba kit
function bcd(T, o) {
  const g = new THREE.Group(), body = new THREE.Group(), c = mat(o.color || '#14395c', { rough: 0.7, double: true }), trim = mat(o.trim || '#f2a413', { rough: 0.7 });
  const h = 0.4, y0 = T.torso.chestY - 0.17;
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 28, 1, true), c);
  cyl.scale.set(T.torso.halfW + 0.035, 1, (T.torso.front - T.torso.back) / 2 + 0.035);
  cyl.position.set(0, y0 + h / 2, (T.torso.front + T.torso.back) / 2);
  body.add(cyl);
  // front opening: two pockets and an inflator hose
  for (const s of [1, -1]) {
    const p = mesh(new THREE.BoxGeometry(0.11, 0.1, 0.045), trim, s * 0.1, y0 + 0.12, T.torso.front + 0.04); body.add(p);
    const strap = mesh(new THREE.BoxGeometry(0.07, 0.14, 0.2), c, s * (T.torso.halfW - 0.04), y0 + h - 0.1, (T.torso.front + T.torso.back) / 2); strap.rotation.z = -s * 0.12; body.add(strap);
  }
  const hose = tube([[0.14, y0 + h - 0.03, T.torso.front + 0.03], [0.17, y0 + h + 0.12, T.torso.front + 0.02], [0.1, y0 + h + 0.2, T.torso.front - 0.02]], 0.011, mat('#17181b', { rough: 0.6 }), 12);
  body.add(hose);
  g.add(body);
  g.userData.inflate = k => body.scale.set(1 + 0.16 * k, 1 + 0.04 * k, 1 + 0.2 * k);   // the bladder swells round the torso
  g.userData.inflate(0);
  return { obj: g, bone: 'Chest' };
}
function tank(T, o) {
  const g = new THREE.Group(), al = mat('#b9c2c9', { rough: 0.3, metal: 0.75 });
  const r = 0.095, len = 0.62, y = T.torso.chestY - 0.34 + len / 2 + 0.05, z = T.torso.back - r - 0.045;
  g.add(mesh(new THREE.CylinderGeometry(r, r, len, 20), al, 0, y, z));
  const bot = mesh(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), al, 0, y - len / 2, z); bot.scale.y = 0.7; g.add(bot);
  const top = mesh(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(o.cap || '#f2c40d', { rough: 0.4 }), 0, y + len / 2, z); top.scale.y = 0.75; g.add(top);
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 10), mat('#c9a455', { rough: 0.3, metal: 0.9 }), 0, y + len / 2 + 0.065, z));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 20, 1, true), mat('#17181b', { rough: 0.7, double: true }), 0, y - len / 2 + 0.03, z));
  g.userData.valve = V(0, y + len / 2 + 0.09, z);
  return { obj: g, bone: 'Chest' };
}
// the regulator: hose over the shoulder to a mouthpiece, and a yellow spare on the chest
function regulator(T, o) {
  const g = new THREE.Group(), hs = mat('#16171a', { rough: 0.55 }), yel = mat('#f2c40d', { rough: 0.5 });
  const vz = T.torso.back - 0.14, vy = T.torso.chestY + 0.31;
  const mouth = V(0.0, T.head.mouth, T.head.front + 0.015);
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 14), mat('#2c3036', { rough: 0.3, metal: 0.8 }), 0, vy, vz));
  g.add(tube([[0.0, vy, vz], [0.1, vy + 0.1, vz + 0.02], [0.13, T.head.mouth + 0.22, T.head.cz - 0.02], [0.09, T.head.mouth + 0.02, T.head.front - 0.01], [mouth.x + 0.02, mouth.y, mouth.z]], 0.014, hs, 30));
  const mp = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 12), mat('#202327', { rough: 0.5 }), 0, T.head.mouth, T.head.front + 0.02); mp.rotation.x = Math.PI / 2; g.add(mp);
  g.add(tube([[-0.02, vy, vz], [-0.15, vy - 0.1, vz + 0.02], [-0.19, T.torso.chestY + 0.1, T.torso.front - 0.03], [-0.08, T.torso.chestY - 0.08, T.torso.front + 0.06]], 0.011, yel, 30));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), yel, -0.08, T.torso.chestY - 0.08, T.torso.front + 0.07));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.016, 16), mat('#e8e8e4', { rough: 0.3 }), -0.1, T.torso.chestY - 0.2, T.torso.front + 0.07)); // pressure gauge
  g.userData.mouth = mouth;
  return { obj: g, bone: 'Chest' };
}

// ---- crew details
function lanyard(T, o) {
  const g = new THREE.Group(), c = mat(o.color || '#e8ecee', { rough: 0.7 });
  const f = T.torso.front + 0.012, y = T.torso.chestY;
  g.add(tube([[0.055, y + 0.2, T.torso.back + 0.12], [0.07, y + 0.18, f - 0.06], [0.0, y - 0.15, f + 0.0], [-0.07, y + 0.18, f - 0.06], [-0.055, y + 0.2, T.torso.back + 0.12]], 0.007, c, 20));
  g.add(mesh(new THREE.BoxGeometry(0.075, 0.1, 0.006), mat('#f4f4f0', { rough: 0.5 }), 0, y - 0.2, f + 0.004));
  g.add(mesh(new THREE.BoxGeometry(0.075, 0.024, 0.0065), mat(o.color || '#0f6f7c', { rough: 0.5 }), 0, y - 0.165, f + 0.005));
  return { obj: g, bone: 'Chest' };
}
function badge(T, o) {
  const g = new THREE.Group();
  const b = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 6), mat(o.color || '#d9b44a', { rough: 0.35, metal: 0.8 }), 0.1, T.torso.chestY + 0.06, T.torso.front + 0.004);
  b.rotation.x = Math.PI / 2; g.add(b);
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.022, 0.006), mat('#2a2d24', { rough: 0.6 }), -0.09, T.torso.chestY + 0.06, T.torso.front + 0.004));
  return { obj: g, bone: 'Chest' };
}
function radio(T, o) {
  const g = new THREE.Group(), k = mat('#141619', { rough: 0.5 });
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.11, 0.03), k, -0.15, T.torso.chestY - 0.1, T.torso.front + 0.01));
  g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), k, -0.16, T.torso.chestY - 0.01, T.torso.front + 0.01));
  return { obj: g, bone: 'Chest' };
}
// flat thongs under bare feet
function thongs(T, o) {
  const out = [];
  for (const s of [1, -1]) {
    const F = T.feet[s > 0 ? 'L' : 'R'], g = new THREE.Group(), c = mat(o.color || '#2b7fbf', { rough: 0.8 });
    g.add(mesh(new THREE.BoxGeometry(0.095, 0.014, F.front - F.back + 0.03), c, 0, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), c, 0, 0.03, 0.04)).rotation.x = 0;
    g.position.set(F.cx, F.bottom + 0.005, (F.front + F.back) / 2);
    out.push({ obj: g, bone: s > 0 ? 'Foot.L' : 'Foot.R' });
  }
  return out;
}

export const BUILDERS = { hat, cap, sunnies, mask, snorkel, fins, bcd, tank, regulator, lanyard, badge, radio, thongs };
