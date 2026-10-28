// People of the reef: the Quaternius modular characters (CC0, web/assets/people, the same files the
// Sydney game uses) ported to r186 NodeMaterials. A person is ONE skinned mesh in one shared
// vertex-coloured material: the palette index `_MAT` of every vertex is resolved on the CPU into a
// colour, so skin, hair, clothes, a stinger suit or a wetsuit are all a re-bake of one colour
// attribute (6k vertices), and the draw call count stays at one per person (plus accessories).
// Swimming has no Quaternius clip, so the pose is driven on the bones in code (see `proc`).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BUILDERS, mat as gmat } from './gear.js';
import { makeLook, SKIN_TONES, HAIR_TONES, stingerSeason, ROLES } from './looks.js';
import { Fn, vec3, attribute, float, select, mix, uniform, instancedBufferAttribute } from 'three/tsl';

export { makeLook, SKIN_TONES, HAIR_TONES, stingerSeason, ROLES };

const BASE = new URL('../assets/people/', import.meta.url).href;
export const REG = { head: 0, hand: 1, torso: 2, upperArm: 3, foreArm: 4, thigh: 5, shin: 6, foot: 7 };
const regionOf = n => /^(Head|Neck)$/.test(n) ? REG.head : /^(Wrist|Index|Middle|Ring|Pinky|Thumb)/.test(n) ? REG.hand
  : /^(Shoulder|UpperArm)/.test(n) ? REG.upperArm : /^LowerArm/.test(n) ? REG.foreArm : /^UpperLeg/.test(n) ? REG.thigh
  : /^LowerLeg/.test(n) ? REG.shin : /^(Foot|PT)/.test(n) ? REG.foot : REG.torso;

// ---------------------------------------------------------------- library
let lib = null;
export async function loadLibrary(base = BASE) {
  if (lib) return lib;
  const L = new GLTFLoader();
  const get = u => new Promise((res, rej) => L.load(base + u, res, null, rej));
  const info = await (await fetch(base + 'people.json')).json();
  const [aM, aW] = await Promise.all([get(info.anims.M), get(info.anims.W)]);
  lib = { info, base, get, clips: { M: aM.animations, W: aW.animations }, tpl: {}, loading: {}, lod: null };
  return lib;
}

// measurements the accessories and the colour bake need, taken from the bind pose
function measure(tpl) {
  const g = tpl.geometry, pos = g.getAttribute('position'), n = pos.count, reg = tpl.reg;
  const H = { top: -1e9, cx: 0, cz: 0, halfW: 0, front: -1e9 };
  for (let i = 0; i < n; i++) if (reg[i] === REG.head) H.top = Math.max(H.top, pos.getY(i));
  let cnt = 0;
  for (let i = 0; i < n; i++) if (reg[i] === REG.head) {
    const y = pos.getY(i);
    if (y > H.top - 0.1) { H.cx += pos.getX(i); H.cz += pos.getZ(i); cnt++; }
    if (y > H.top - 0.2 && y < H.top - 0.05) { H.halfW = Math.max(H.halfW, Math.abs(pos.getX(i))); H.front = Math.max(H.front, pos.getZ(i)); }
  }
  H.cx /= cnt; H.cz /= cnt;
  H.eye = tpl.bonePos['Head'].y + 0.15; H.mouth = H.eye - 0.07;   // all the faces share one skull: eyes 15 cm above the head joint
  const Tz = { front: -1e9, back: 1e9, halfW: 0, chestY: tpl.bonePos['Chest'].y };
  const y0 = Tz.chestY - 0.2, y1 = Tz.chestY + 0.1;
  for (let i = 0; i < n; i++) if (reg[i] === REG.torso) {
    const y = pos.getY(i); if (y < y0 || y > y1) continue;
    Tz.front = Math.max(Tz.front, pos.getZ(i)); Tz.back = Math.min(Tz.back, pos.getZ(i)); Tz.halfW = Math.max(Tz.halfW, Math.abs(pos.getX(i)));
  }
  const feet = { L: { bottom: 1e9, front: -1e9, back: 1e9, cx: 0, k: 0 }, R: { bottom: 1e9, front: -1e9, back: 1e9, cx: 0, k: 0 } };
  for (let i = 0; i < n; i++) if (reg[i] === REG.foot && pos.getY(i) < 0.12) {
    const F = pos.getX(i) > 0 ? feet.L : feet.R;
    F.bottom = Math.min(F.bottom, pos.getY(i)); F.front = Math.max(F.front, pos.getZ(i)); F.back = Math.min(F.back, pos.getZ(i)); F.cx += pos.getX(i); F.k++;
  }
  for (const F of [feet.L, feet.R]) { F.cx = F.k ? F.cx / F.k : 0.1; if (!isFinite(F.bottom)) { F.bottom = 0; F.front = 0.2; F.back = -0.05; } }
  return { head: H, torso: Tz, feet };
}

export async function template(name) {
  await loadLibrary();
  if (lib.tpl[name]) return lib.tpl[name];
  return lib.loading[name] || (lib.loading[name] = lib.get(`${name}.glb`).then(gl => {
    let sm = null;
    gl.scene.traverse(o => { if (o.isSkinnedMesh) sm = o; });
    gl.scene.updateMatrixWorld(true);
    const geo = sm.geometry, extras = sm.userData.palette ? sm.userData : geo.userData;
    const bones = sm.skeleton.bones, bonePos = {}, restWorld = {};
    // the bind pose, not the node transforms in the file: the vertices live in bind space, so accessories must too
    bones.forEach((b, i) => { const w = sm.skeleton.boneInverses[i].clone().invert(); restWorld[b.name] = w; bonePos[b.name] = new THREE.Vector3().setFromMatrixPosition(w); });
    const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight'), n = si.count, reg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      reg[i] = regionOf(bones[best].name);
    }
    const t = { name, scene: gl.scene, geometry: geo, extras, reg, mat: Uint8Array.from({ length: n }, (_, i) => geo.getAttribute('_mat').getX(i)),
      bonePos, restWorld, count: n,   // (_mat may be interleaved: read it through the accessor)
      pack: lib.info.characters[name].pack, height: lib.info.characters[name].height_m, info: lib.info.characters[name] };
    t.T = measure(t);
    t.hipY = bonePos['Hips'].y;
    return (lib.tpl[name] = t);
  }));
}

// ---------------------------------------------------------------- colour bake
const col = h => new THREE.Color(h);
// the colour of every vertex for a look: palette classes recoloured, skin covered by sleeves/suits
export function bakeColors(tpl, look, out) {
  const ex = tpl.extras, pal = ex.palette, cls = ex.classes;
  const skinRef = (pal[cls.indexOf('skin')] || [0.617])[0];
  const skin = col(look.skin || '#d9a77e'), hair = col(look.hair || '#2a1d14');
  const top = look.top ? col(look.top) : null, legs = look.legs ? col(look.legs) : null;
  const base = pal.map((p, i) => {
    const k = cls[i], c = new THREE.Color(p[0], p[1], p[2]);
    if (k === 'skin') return skin.clone().multiplyScalar(p[0] / skinRef);
    if (k === 'hair') return hair.clone();
    if (k === 'brows') return hair.clone().multiplyScalar(0.6);
    if (k === 'top' && top) return top.clone();
    if (k === 'legs' && legs) return legs.clone();
    return c;
  });
  const S = look.suit, sleeve = look.sleeve;           // suit: lycra over skin; sleeve: the shirt carried down the arm
  const sc = S ? col(S.color) : null, tc = S && S.top ? col(S.top) : sc, lc = S && S.legs ? col(S.legs) : sc;
  const slc = sleeve ? col(sleeve.color || look.top) : null;
  const kneeY = tpl.info.knee ? tpl.info.knee[0] : 0.53;
  const n = tpl.count, pos = tpl.geometry.getAttribute('position');
  const buf = out || new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const mi = tpl.mat[i], k = cls[mi], r = tpl.reg[i];
    let c = base[mi];
    if (k === 'skin') {
      if (S) {
        if (r === REG.torso && S.torso !== false) c = tc;
        else if ((r === REG.upperArm && S.arms >= 1) || (r === REG.foreArm && S.arms >= 2)) c = sc;
        else if ((r === REG.thigh && S.legN >= 1) || (r === REG.shin && S.legN >= 2)) c = lc;
      }
      if (c === base[mi] && sleeve && ((r === REG.upperArm && sleeve.n >= 1) || (r === REG.foreArm && sleeve.n >= 2))) c = slc;
      if (c === base[mi] && look.legcover && ((r === REG.thigh && look.legcover.n >= 1) || (r === REG.shin && look.legcover.n >= 2))) c = col(look.legcover.color);
    } else if (k === 'top' && S && S.top) c = tc;
    else if (k === 'legs') {
      if (S && S.legN >= 1) c = lc;
      if (look.shorts && !(S && S.legN >= 2) && pos.getY(i) < kneeY + 0.03) c = base[tpl.extras.classes.indexOf('skin')] || skin;   // shorts: bare shin
    }
    if (k === 'keep' && r === REG.foot && look.barefoot) c = base[cls.indexOf('skin')] || skin;
    buf[i * 3] = c.r; buf[i * 3 + 1] = c.g; buf[i * 3 + 2] = c.b;
  }
  return buf;
}

let SHARED = null;
function sharedMaterial() {
  return SHARED || (SHARED = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }));
}

// ---------------------------------------------------------------- one person
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function createPerson(lookIn, opts = {}) {
  const look = Object.assign({}, lookIn);
  const tpl = await template(look.character);
  const T = tpl.T, pack = tpl.pack, speeds = lib.info.ground_speed[pack];
  const model = SkeletonUtils.clone(tpl.scene);
  let sm = null; const bones = {};
  model.traverse(o => { if (o.isSkinnedMesh) sm = o; if (o.isBone) bones[o.name] = o; });
  // own colour attribute, everything else shared with the template
  const geo = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) geo.setAttribute(k, tpl.geometry.getAttribute(k));
  geo.setIndex(tpl.geometry.getIndex());
  const colAttr = new THREE.BufferAttribute(new Float32Array(tpl.count * 3), 3);
  geo.setAttribute('color', colAttr);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.6); geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -0.2, -1), new THREE.Vector3(1, 2.2, 1));
  sm.geometry = geo; sm.material = sharedMaterial(); sm.frustumCulled = false;

  const group = new THREE.Group(), pivot = new THREE.Group();
  group.add(pivot); pivot.add(model);
  const rig = { group, pivot, model, look, tpl, bones, acc: {}, mixer: new THREE.AnimationMixer(model), actions: {}, cur: null, T,
    heading: 0, targetHeading: null, speech: null, extra: {}, proc: { k: 0, mode: 'none', phase: 0, amp: 0, fin: 1, pitch: 0, headUp: 0, stroke: 0, bcd: 0 }, hipY: tpl.hipY };
  for (const c of lib.clips[pack]) rig.actions[c.name] = rig.mixer.clipAction(c);

  const applyScale = () => {
    const s = look.scale || 1;
    model.scale.setScalar(s);
    model.position.y = -tpl.hipY * s;
    rig.hip = tpl.hipY * s;
    pivot.position.y = rig.hip * (1 - rig.proc.k);
  };
  rig.setLook = l => {
    Object.assign(look, l);
    bakeColors(tpl, look, colAttr.array); colAttr.needsUpdate = true;
    applyScale();
    // accessories that look declares are built once, then shown by name
    for (const a of look.accessories || []) if (!rig.acc[a.type]) rig.addAccessory(a.type, a);
    for (const k of Object.keys(rig.acc)) { const a = (look.accessories || []).find(x => x.type === k); if (a && a.show !== undefined) rig.show(k, a.show); }
    return rig;
  };
  const attach = (b, obj) => {
    // obj is placed in model space: re-express it in the bone's rest frame so it rides the bone
    obj.updateMatrix();
    _m.copy(tpl.restWorld[b.name]).invert().multiply(obj.matrix);
    _m.decompose(obj.position, obj.quaternion, obj.scale);
    b.add(obj);
  };
  rig.addAccessory = (type, o = {}) => {
    const build = BUILDERS[type];
    if (!build) return null;
    const r = build(T, o), list = Array.isArray(r) ? r : [r];
    const holder = { type, parts: [], userData: {} };
    for (const p of list) {
      const b = bones[p.bone] || bones.Chest;
      attach(b, p.obj);
      holder.parts.push(p.obj);
      Object.assign(holder.userData, p.obj.userData);
    }
    rig.acc[type] = holder;
    return holder;
  };
  rig.show = (type, v = true) => {
    if (!rig.acc[type]) { if (!v) return; rig.addAccessory(type, (look.accessories || []).find(a => a.type === type) || {}); }
    for (const p of rig.acc[type].parts) p.visible = v;
    rig.acc[type].on = v;
  };
  rig.has = type => !!(rig.acc[type] && rig.acc[type].on);
  // model-space point of a bone-attached landmark, in world
  rig.world = (modelPoint, out = new THREE.Vector3()) => model.localToWorld(out.copy(modelPoint));
  rig.mouth = out => rig.world(_v.set(0, T.head.mouth, T.head.front + 0.03), out);
  rig.snorkelTip = out => rig.world(_v.set(-T.head.halfW - 0.017, T.head.top + 0.13, T.head.cz), out);

  rig.play = (name, o = {}) => {
    const a = rig.actions[name];
    if (!a) return null;
    if (rig.cur !== a) {
      a.reset();
      a.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = !!o.once;
      a.setEffectiveWeight(1).play();
      if (rig.cur) rig.cur.crossFadeTo(a, o.fade ?? 0.25, false);
      rig.cur = a;
      if (o.offset) a.time = o.offset * a.getClip().duration;
    }
    if (o.speed !== undefined) a.setEffectiveTimeScale(o.speed);
    return a;
  };
  // `speed` m/s on the ground picks idle, walk or run and the playback rate that matches the feet
  rig.locomote = (speed, fade = 0.25) => {
    const s = look.scale || 1;
    if (speed < 0.12) return rig.play('Idle', { fade, speed: 1 });
    if (speed < 2.2) return rig.play('Walk', { fade, speed: THREE.MathUtils.clamp(speed / (speeds.Walk * s), 0.4, 1.8) });
    return rig.play('Run', { fade, speed: THREE.MathUtils.clamp(speed / (speeds.Run * s), 0.6, 1.9) });
  };
  rig.wave = () => rig.play('Wave', { once: true, fade: 0.2 });

  // ---- swimming: bone offsets about model-space axes, applied after the clip each frame
  const twist = (bone, axis, ang) => {
    if (!bone || !ang) return;
    model.updateMatrixWorld(false);
    bone.parent.getWorldQuaternion(_q); model.getWorldQuaternion(_q2);
    _q.premultiply(_q2.clone().invert());                       // parent's orientation in model space
    _q3.setFromAxisAngle(axis, ang);
    bone.quaternion.premultiply(_q).premultiply(_q3).premultiply(_q.clone().invert());   // P^-1 * D * P * q
    bone.updateMatrixWorld(true);
  };
  rig.setSwim = (k, o = {}) => { Object.assign(rig.proc, o); rig.proc.k = k; pivot.position.y = rig.hip * (1 - k); };
  const proc = rig.proc;
  function applyProc(dt) {
    if (proc.mode === 'none' || proc.k < 0.02) { pivot.rotation.x = 0; return; }
    const k = proc.k;
    pivot.rotation.x = k * (Math.PI / 2) * 0.96 + proc.pitch * k;   // body horizontal, face down; pitch adds the dive angle
    const ph = proc.phase, B = bones, a = proc.amp, f = proc.fin;
    const kick = Math.sin(ph) * (0.2 + 0.1 * (f - 1)) * a;
    // flutter kick: thighs swing in opposition, knees follow a little later; fins lengthen the stroke
    twist(B['UpperLegL'], AX, kick * k); twist(B['UpperLegR'], AX, -kick * k);
    twist(B['LowerLegL'], AX, Math.sin(ph - 0.9) * 0.2 * a * k); twist(B['LowerLegR'], AX, -Math.sin(ph - 0.9) * 0.2 * a * k);
    if (proc.mode === 'crawl') {                                // a swimmer without a mask: head-up crawl, arms windmill
      const w = ph * 0.5;
      twist(B['UpperArmL'], AX, -(Math.sin(w) * 1.5 + 2.1) * k * a); twist(B['UpperArmR'], AX, -(Math.sin(w + Math.PI) * 1.5 + 2.1) * k * a);
    } else {                                                    // snorkel / scuba: arms by the sides, a little sculling
      twist(B['UpperArmL'], AZ, 0.2 * k); twist(B['UpperArmR'], AZ, -0.2 * k);
      twist(B['UpperArmL'], AX, Math.sin(ph * 0.5) * 0.12 * k); twist(B['UpperArmR'], AX, -Math.sin(ph * 0.5) * 0.12 * k);
    }
    // the foot bones hang off the root (the clips drive them like IK targets), so bring them along with the shins and point the toes
    for (const side of ['L', 'R']) followFoot(side, (1.0 + 0.3 * (f - 1)) * k + Math.sin(ph - 1.6) * 0.25 * a * k * (side === 'L' ? 1 : -1));
    // neck: the head comes up so a face-down swimmer looks ahead and down, not straight at the sea floor
    twist(B.Neck, AX, -0.55 * k * (1 - proc.headUp * 0.3)); twist(B.Head, AX, -0.35 * k);
    twist(B.Torso, AX, -0.1 * k * Math.sin(ph) * 0.3);
  }
  const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _mC = new THREE.Matrix4(), _mD = new THREE.Matrix4();
  function followFoot(side, plantar) {
    const ll = bones['LowerLeg' + side], ft = bones['Foot' + side];
    if (!ll || !ft) return;
    ll.updateWorldMatrix(true, false);
    const rLL = tpl.restWorld['LowerLeg' + side], rF = tpl.restWorld['Foot' + side], F = T.feet[side];
    // the shin's skinning transform, then a toe-pointing rotation about the ankle, then the foot's own bind pose
    _mA.copy(rLL).invert().premultiply(ll.matrixWorld);
    _mB.makeTranslation(F.cx, 0.1, F.back + 0.06).multiply(_mC.makeRotationX(plantar)).multiply(_mD.makeTranslation(-F.cx, -0.1, -(F.back + 0.06)));
    _mA.multiply(_mB).multiply(rF);
    ft.parent.updateWorldMatrix(true, false);
    _mA.premultiply(_mC.copy(ft.parent.matrixWorld).invert());
    _mA.decompose(ft.position, ft.quaternion, ft.scale);
    ft.updateMatrixWorld(true);
  }
  rig.faceTowards = (v, snap) => {
    const p = group.getWorldPosition(_v.clone());
    const dx = (v.x ?? v[0]) - p.x, dz = (v.z ?? v[2] ?? -(v.north)) - p.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return rig;
    rig.targetHeading = Math.atan2(dx, dz);                      // model faces +z
    if (snap) { rig.heading = rig.targetHeading; group.rotation.y = rig.heading; }
    return rig;
  };
  rig.setHeading = (h) => { rig.heading = h; rig.targetHeading = null; group.rotation.y = h; };
  rig.lookAtTarget = null;

  // a floating speech bubble that fades
  rig.say = (text, secs = 4.5) => {
    if (rig.speech) { group.remove(rig.speech.sprite); rig.speech.sprite.material.map.dispose(); rig.speech.sprite.material.dispose(); rig.speech = null; }
    if (!text) return rig;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d'), W = 512, lh = 40, pad = 22;
    cx.font = '600 30px system-ui, sans-serif';
    const words = String(text).split(' '), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (cx.measureText(t).width > W - pad * 2 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    cv.width = W; cv.height = lines.length * lh + pad * 2;
    cx.font = '600 30px system-ui, sans-serif';
    cx.fillStyle = 'rgba(6,26,38,0.82)'; cx.beginPath(); cx.roundRect(2, 2, W - 4, cv.height - 4, 22); cx.fill();
    cx.fillStyle = '#f2f7f8'; cx.textBaseline = 'top';
    lines.forEach((l, i) => cx.fillText(l, pad, pad + i * lh));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const spm = new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(spm);
    sp.center.set(0.5, 0); sp.renderOrder = 30;
    sp.userData.w = 1.5; sp.userData.h = 1.5 * cv.height / W;
    sp.position.y = tpl.height * (look.scale || 1) + 0.45;
    group.add(sp);
    rig.speech = { sprite: sp, t: secs, secs };
    if (opts.onSay) opts.onSay(text, rig);
    return rig;
  };

  rig.update = (dt, camera) => {
    if (rig.targetHeading !== null) {
      let d = rig.targetHeading - rig.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      rig.heading += d * Math.min(1, dt * 5);
      if (Math.abs(d) < 0.01) rig.targetHeading = null;
      group.rotation.y = rig.heading;
    }
    rig.mixer.update(dt);
    applyProc(dt);
    if (rig.speech) {
      const S = rig.speech; S.t -= dt;
      const sp = S.sprite, dist = camera ? camera.position.distanceTo(group.position) : 5, sc = Math.max(1, dist / 7);
      sp.scale.set(sp.userData.w * sc, sp.userData.h * sc, 1);
      sp.material.opacity = Math.min(1, S.t * 2, (S.secs - S.t) * 6);
      if (S.t <= 0) rig.say(null);
    }
  };
  rig.dispose = () => { if (group.parent) group.parent.remove(group); rig.mixer.stopAllAction(); geo.dispose(); };

  applyScale();
  rig.setLook({});
  rig.play('Idle', { fade: 0 });
  return rig;
}

// ---------------------------------------------------------------- crowd: instanced low-detail copies
// crowd.glb holds a low-poly copy of every character. All instances of one character are one draw
// call; colours come from per-instance attributes and the same palette classes as above.
const CLASS_ID = { keep: 0, skin: 1, hair: 2, brows: 3, top: 4, legs: 5 };
async function crowdLib() {
  await loadLibrary();
  if (lib.lod) return lib.lod;
  const gl = await lib.get(lib.info.crowd);
  const lod = {};
  gl.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, ex = o.userData.palette ? o.userData : g.userData, m = g.getAttribute('_mat'), n = g.getAttribute('position').count;
    const base = new Float32Array(n * 3), cls = new Float32Array(n), shade = new Float32Array(n);
    const pal = ex.palette, cl = ex.classes, skinRef = (pal[cl.indexOf('skin')] || [0.617])[0];
    for (let i = 0; i < n; i++) {
      const mi = m.getX(i), p = pal[mi], k = cl[mi];
      base[i * 3] = p[0]; base[i * 3 + 1] = p[1]; base[i * 3 + 2] = p[2];
      cls[i] = CLASS_ID[k] || 0; shade[i] = k === 'skin' ? p[0] / skinRef : 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', g.getAttribute('position')); geo.setAttribute('normal', g.getAttribute('normal')); geo.setIndex(g.getIndex());
    geo.setAttribute('base', new THREE.BufferAttribute(base, 3)); geo.setAttribute('cls', new THREE.BufferAttribute(cls, 1)); geo.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
    lod[o.name] = { geometry: geo, height: lib.info.characters[o.name] ? lib.info.characters[o.name].height_m : 1.85 };
  });
  return (lib.lod = lod);
}

function crowdMaterial(n, attrs) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  const iS = instancedBufferAttribute(attrs.skin), iH = instancedBufferAttribute(attrs.hair), iT = instancedBufferAttribute(attrs.top), iL = instancedBufferAttribute(attrs.legs);
  const cls = attribute('cls', 'float'), shade = attribute('shade', 'float'), base = attribute('base', 'vec3');
  m.colorNode = Fn(() => {
    let c = base.toVar();
    c.assign(select(cls.greaterThan(0.5).and(cls.lessThan(1.5)), iS.mul(shade), c));
    c.assign(select(cls.greaterThan(1.5).and(cls.lessThan(2.5)), iH, c));
    c.assign(select(cls.greaterThan(2.5).and(cls.lessThan(3.5)), iH.mul(0.6), c));
    c.assign(select(cls.greaterThan(3.5).and(cls.lessThan(4.5)), iT, c));
    c.assign(select(cls.greaterThan(4.5), iL, c));
    return c;
  })();
  return m;
}

// n tourists spread over a beach or boat deck. `place(i)` may return { x, north, up, heading } to
// override the random scatter; by default people are put on dry sand around `center`.
export async function makeCrowd(ctx, n, center, radius, o = {}) {
  const lod = await crowdLib();
  const names = Object.keys(lod).filter(k => !/Punk|Suit|Worker/.test(k));
  const c = Array.isArray(center) ? { x: center[0], north: center[1] } : center.isVector3 ? { x: center.x, north: -center.z } : center;
  const group = new THREE.Group(); group.name = 'crowd';
  let s = (o.seed ?? 11) >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const groups = {};
  const people = [];
  let guard = 0;
  while (people.length < n && guard++ < n * 40) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const x = c.x + Math.cos(a) * r, north = c.north + Math.sin(a) * r;
    const dep = ctx.depth(x, north);
    if (!(o.wade ? dep < 0.9 : dep < -0.25)) continue;          // dry sand (or the shallows)
    const name = names[Math.floor(rnd() * names.length)];
    const look = makeLook('tourist', { seed: Math.floor(rnd() * 1e9), character: name });
    people.push({ x, north, name, look, h: rnd() * Math.PI * 2, sc: look.scale * (lod[name].height / 1.86) });
  }
  for (const p of people) (groups[p.name] = groups[p.name] || []).push(p);
  const meshes = [];
  const dummy = new THREE.Object3D();
  for (const [name, ps] of Object.entries(groups)) {
    const L = lod[name], k = ps.length;
    const geo = L.geometry.clone();
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(k * 3), 3);
    const attrs = { skin: mk(), hair: mk(), top: mk(), legs: mk() };
    const m = crowdMaterial(k, attrs);
    const im = new THREE.InstancedMesh(geo, m, k);
    ps.forEach((p, i) => {
      const L2 = p.look;
      const put = (a, hex) => { const cc = col(hex); a.setXYZ(i, cc.r, cc.g, cc.b); };
      put(attrs.skin, L2.skin); put(attrs.hair, L2.hair);
      put(attrs.top, (L2.suit && L2.suit.top) || (L2.suit && L2.suit.color) || L2.top); put(attrs.legs, (L2.suit && (L2.suit.legs || L2.suit.color)) || L2.legs);
      const up = ctx.height(p.x, p.north);
      dummy.position.set(p.x, up, -p.north); dummy.rotation.set(0, p.h, 0); dummy.scale.setScalar(p.sc); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    group.add(im); meshes.push(im);
  }
  return { group, count: people.length, people, meshes, dispose() { if (group.parent) group.parent.remove(group); } };
}
