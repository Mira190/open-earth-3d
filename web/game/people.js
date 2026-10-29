// People: realistic rigged characters (Quaternius's Ultimate Modular Men and Women, CC0)
// for the player, the NPCs and the crowd near the player, plus an instanced low-detail
// copy of the same characters for the crowd further away. Each character is one skinned
// mesh whose vertices index a small palette, so skin, hair and clothes are recoloured
// per person: thirteen files make a varied crowd. pipeline/fetch_people.py builds the
// files in web/assets/people.
'use strict';
window.OEPeople = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const N = 24; // palette size in the shaders
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = a => a[Math.floor(rnd() * a.length)];
  // sRGB swatches for recolouring
  const SKIN = ['#f6d8c6', '#f0c7aa', '#e3b08d', '#d49c76', '#c18661', '#a8714f', '#8f5b3d', '#73482e', '#5a3622'];
  const HAIR = ['#141010', '#231915', '#33241b', '#4a3222', '#6a4529', '#8d6339', '#b48a52', '#cfae73', '#8c8580', '#cfcac4', '#6e2f1c'];
  const TOPS = ['#e9e6df', '#1f2328', '#2f5d8c', '#c94f3d', '#3d6b4a', '#d9a441', '#7a4e8f', '#5b7f99', '#b5654b', '#f2f0ea', '#355c7d', '#8c2f39', '#9aa3a8', '#d7c6a5', '#3c4a3e', '#e4b7b2'];
  const LEGS = ['#2b3440', '#1d1f24', '#4b5563', '#3a3026', '#6b7280', '#24384f', '#c7b89a', '#33415c', '#5c4b3b'];
  // how common each character is in a city crowd
  const WEIGHT = { M_Casual2: 3, M_Hoodie: 2, M_Suit: 2, M_Worker: 0.8, M_Beach: 1, M_Adventurer: 1, M_Punk: 0.4,
    W_Casual: 3, W_Formal: 1.5, W_Suit: 2, W_Worker: 0.8, W_Adventurer: 1, W_Punk: 0.4 };
  const CLS = { keep: 0, skin: 1, hair: 2, brows: 3, top: 4, legs: 5 };

  // ------------------------------------------------------------ loading
  async function load(base, { onMsg } = {}) {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) throw new Error('GLTFLoader is not available');
    const L = new THREE.GLTFLoader();
    const get = u => new Promise((res, rej) => L.load(base + u, res, null, rej));
    const info = await (await fetch(base + 'people.json')).json();
    const [aM, aW, cr] = await Promise.all([get(info.anims.M), get(info.anims.W), get(info.crowd)]);
    const lib = { info, clips: { M: aM.animations, W: aW.animations }, lod: {}, tpl: {}, loading: {} };
    cr.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry;
      g.setAttribute('mat', g.getAttribute('_mat'));
      g.setAttribute('part', g.getAttribute('_part'));
      lib.lod[o.name] = { geometry: g, extras: o.userData };
    });
    lib.require = name => lib.loading[name] || (lib.loading[name] = get(`${name}.glb`).then(g => {
      let mesh = null;
      g.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
      mesh.geometry.setAttribute('mat', mesh.geometry.getAttribute('_mat'));
      lib.tpl[name] = { scene: g.scene, extras: mesh.userData, pack: info.characters[name].pack };
      if (onMsg) onMsg(name);
      return lib.tpl[name];
    }));
    lib.names = Object.keys(info.characters);
    return lib;
  }

  // a random look for a character: skin, hair, clothes and height
  function randomLook(lib, name) {
    const ch = lib.info.characters[name], w = ch.pack === 'W';
    return { character: name, skin: pick(SKIN), hair: rnd() < 0.15 ? pick(HAIR.slice(8)) : pick(HAIR.slice(0, 9)), top: pick(TOPS), legs: pick(LEGS),
      scale: (w ? 0.885 : 0.94) + rnd() * 0.06 };
  }
  function pickCharacter(lib) {
    const names = lib.names, tot = names.reduce((a, n) => a + (WEIGHT[n] || 1), 0);
    let r = rnd() * tot;
    for (const n of names) { r -= WEIGHT[n] || 1; if (r <= 0) return n; }
    return names[0];
  }

  // the palette a look gives a character, linear RGB, padded to N
  function colours(extras, look) {
    const pal = extras.palette, cls = extras.classes;
    const skinRef = (pal[cls.indexOf('skin')] || [0.617])[0];
    const c = k => (look[k] ? lin(look[k]) : null);
    const skin = c('skin'), hair = c('hair'), top = c('top'), legs = c('legs');
    const out = [];
    for (let i = 0; i < N; i++) {
      const p = pal[i] || [0, 0, 0], k = cls[i];
      let v = new THREE.Color(p[0], p[1], p[2]);
      if (k === 'skin' && skin) v = skin.clone().multiplyScalar(p[0] / skinRef);
      else if (k === 'hair' && hair) v = hair.clone();
      else if (k === 'brows' && hair) v = hair.clone().multiplyScalar(0.6);
      else if (k === 'top' && top) v = top.clone();
      else if (k === 'legs' && legs) v = legs.clone();
      out.push(new THREE.Vector3(v.r, v.g, v.b));
    }
    return out;
  }

  // ------------------------------------------------------------ one person: skinned, animated
  function paletteMaterial(pal) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    mat.userData.pal = { value: pal };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPal = mat.userData.pal;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float mat; uniform vec3 uPal[${N}]; varying vec3 vPal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vPal = uPal[int(mat + 0.5)];`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPal;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPal, opacity );');
    };
    return mat;
  }

  let up, tv, tq, tq2, hp, sa, sb, sd, sd2, fw, sq, sq2; // scratch objects, made on first use (three.js may load after this file)
  // turn bone b so that it points in direction dir (world space): towards its child, or along
  // its own +y axis (the way the bone points, as Blender exports it) when there is none
  function aim(b, child, dir) {
    if (child) { b.getWorldPosition(sa); child.getWorldPosition(sb); sd.subVectors(sb, sa).normalize(); }
    else sd.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(sq));
    sq.setFromUnitVectors(sd, dir);
    b.getWorldQuaternion(sq2);
    sq.multiply(sq2);
    b.parent.getWorldQuaternion(sq2).invert();
    b.quaternion.copy(sq2.multiply(sq));
    b.updateMatrixWorld(true);
  }
  function person(lib, look) {
    if (!up) { up = new THREE.Vector3(0, 1, 0); tv = new THREE.Vector3(); tq = new THREE.Quaternion(); tq2 = new THREE.Quaternion(); hp = new THREE.Vector3();
      sa = new THREE.Vector3(); sb = new THREE.Vector3(); sd = new THREE.Vector3(); sd2 = new THREE.Vector3(); fw = new THREE.Vector3(); sq = new THREE.Quaternion(); sq2 = new THREE.Quaternion(); }
    const T = lib.tpl[look.character], speeds = lib.info.ground_speed[T.pack];
    const model = THREE.SkeletonUtils.clone(T.scene);
    let mesh = null, head = null;
    const bone = {};
    model.traverse(o => { if (o.isSkinnedMesh) mesh = o; if (o.isBone) bone[o.name] = o; });
    head = bone.Head || null;
    mesh.material = paletteMaterial(colours(T.extras, look));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const root = new THREE.Group();
    root.add(model);
    const mixer = new THREE.AnimationMixer(model), act = {};
    for (const c of lib.clips[T.pack]) act[c.name] = mixer.clipAction(c);
    let cur = null, cycles = 0, lastT = 0, waveUntil = -1, lookW = 0, talked = false;
    const rig = { root, model, mixer, look, phase: 0, lookTarget: null, character: look.character };
    function play(name, fade = 0.25, once = false) {
      const a = act[name];
      if (cur === a) return a;
      a.reset();
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = once;
      a.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      if (cur) cur.crossFadeTo(a, fade, false);
      cur = a;
      lastT = 0;
      return a;
    }
    rig.setLook = l => {
      Object.assign(look, l);
      rig.character = look.character;
      mesh.material.userData.pal.value = colours(T.extras, look);
      model.scale.setScalar(look.scale || 1);
    };
    rig.setLook({});
    // sitting has no clip: bend the legs over the idle pose, thighs forward and shins down (an aim
    // per bone in world space, so it doesn't depend on how the bones' axes are set up). The feet
    // are IK targets under Root in these rigs, not children of the shins, so they are moved to
    // the ends of the shins; then the body is lowered until they are back on the ground.
    const B = name => bone[THREE.PropertyBinding.sanitizeNodeName(name)]; // the loader drops the dots: Foot.L is FootL
    const legs = ['L', 'R'].map(side => ({ ul: B('UpperLeg.' + side), ll: B('LowerLeg.' + side), ft: B('Foot.' + side), shin: 0, y0: 0 }));
    const seated = legs.every(l => l.ul && l.ll && l.ft);
    function seat() {
      if (!seated) return;
      model.position.y = 0;
      root.updateMatrixWorld(true);
      fw.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(sq));
      for (const l of legs) { l.y0 = l.ft.getWorldPosition(sa).y; l.shin = sa.distanceTo(l.ll.getWorldPosition(sb)); }
      let drop = 0;
      for (const l of legs) {
        aim(l.ul, l.ll, sd2.copy(fw));
        const down = sd2.set(0, -1, 0).addScaledVector(fw, 0.12).normalize();
        aim(l.ll, null, down);
        const ankle = l.ll.getWorldPosition(sa).addScaledVector(down, l.shin);
        drop = Math.min(drop, l.y0 - ankle.y);
        l.ft.parent.updateMatrixWorld(true);
        l.ft.position.copy(l.ft.parent.worldToLocal(ankle));
      }
      model.position.y = drop / (root.parent ? root.parent.getWorldScale(sb).y : 1);
    }
    rig.wave = (t = 0) => { waveUntil = t + act.Wave.getClip().duration * 0.95; play('Wave', 0.2, true); };
    // speed in m/s, mode 'ground' | 'air' | 'sit' | 'talk'; t is the game clock
    rig.animate = (dt, speed, mode = 'ground', t = 0) => {
      const s = look.scale || 1;
      model.position.y = 0;
      if (mode !== 'talk') talked = false;
      const waving = t < waveUntil && speed < 0.3 && mode !== 'sit' && mode !== 'air';
      if (mode === 'talk' && !talked) { talked = true; rig.wave(t); }   // a wave hello, then listen
      else if (waving) { /* let the wave finish */ }
      else if (mode === 'talk') play('Idle', 0.35);
      else if (mode === 'sit') play('Idle_Neutral', 0.2);
      else if (mode === 'air') play('Run', 0.15).setEffectiveTimeScale(0.3);
      else if (speed < 0.15) play('Idle', 0.3);
      else if (speed < 2.1) play('Walk', 0.25).setEffectiveTimeScale(Math.max(0.5, Math.min(1.7, speed / (speeds.Walk * s))));
      else play('Run', 0.2).setEffectiveTimeScale(Math.max(0.6, Math.min(1.9, speed / (speeds.Run * s))));
      mixer.update(dt);
      if (mode === 'sit') seat();
      // the walk cycle as a phase, two steps per cycle (footsteps)
      const d = cur.getClip().duration, tt = cur.time / d;
      if (tt < lastT) cycles++;
      lastT = tt;
      rig.phase = (cycles + tt) * Math.PI * 2;
      // turn the head towards whatever is worth looking at
      lookW += ((rig.lookTarget && speed < 2.1 ? 1 : 0) - lookW) * Math.min(1, dt * 4);
      if (head && lookW > 0.01) {
        root.updateMatrixWorld(true);
        head.getWorldPosition(hp);
        const tgt = rig.lookTarget || hp;
        tv.subVectors(tgt, hp);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(tq2));
        let yaw = Math.atan2(tv.x, tv.z) - Math.atan2(fwd.x, fwd.z);
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        yaw = Math.max(-1.1, Math.min(1.1, yaw)) * lookW;
        head.getWorldQuaternion(tq);
        tq.premultiply(tq2.setFromAxisAngle(up, yaw));
        head.parent.getWorldQuaternion(tq2).invert();
        head.quaternion.copy(tq2.multiply(tq));
      }
    };
    return rig;
  }

  // ------------------------------------------------------------ the crowd: instanced far, skinned near
  function crowdMaterial(ex, U) {
    const pal = colours(ex, {}), cls = new Float32Array(N);
    ex.classes.forEach((c, i) => { cls[i] = CLS[c] || 0; });
    const skinRef = (ex.palette[ex.classes.indexOf('skin')] || [0.617])[0];
    const uni = { uPal: { value: pal }, uCls: { value: cls }, uSkinRef: { value: skinRef },
      uHip: { value: new THREE.Vector2(...ex.hip) }, uKnee: { value: new THREE.Vector2(...ex.knee) }, uShoulder: { value: new THREE.Vector2(...ex.shoulder) } };
    const pose = `
attribute float mat; attribute float part; attribute vec3 aAnim;
uniform float uTime; uniform vec2 uHip; uniform vec2 uKnee; uniform vec2 uShoulder;
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
// legs swing from the hips with the knee bending on the back swing; arms swing from the shoulders.
// A negative amplitude means sitting: thighs forward, shins down.
vec3 crowdPose(vec3 p, bool isNormal) {
  bool sit = aAnim.z < -0.5;
  float amp = max(aAnim.z, 0.0), ph = uTime * aAnim.y + aAnim.x, sw = sin(ph) * amp;
  float side = (part > 0.5 && part < 1.5) || (part > 2.5 && part < 3.5) || (part > 4.5 && part < 5.5) ? 1.0 : -1.0;
  bool leg = (part > 0.5 && part < 2.5) || part > 4.5, shin = part > 4.5, arm = part > 2.5 && part < 4.5;
  vec3 piv;
  if (shin) { float k = sit ? 1.5708 : max(0.0, -cos(ph) * side) * amp * 1.3; piv = vec3(0.0, uKnee); p = isNormal ? rx(k) * p : rx(k) * (p - piv) + piv; }
  if (leg) { float a = sit ? -1.5708 : sw * side; piv = vec3(0.0, uHip); p = isNormal ? rx(a) * p : rx(a) * (p - piv) + piv; }
  if (arm) { piv = vec3(0.0, uShoulder); p = isNormal ? rx(-sw * side * 0.8) * p : rx(-sw * side * 0.8) * (p - piv) + piv; }
  if (!isNormal) p.y += abs(cos(ph)) * 0.035 * amp;
  return p;
}`;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni, { uTime: U.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${pose}
attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iTop; attribute vec3 iLegs;
uniform vec3 uPal[${N}]; uniform float uCls[${N}]; uniform float uSkinRef; varying vec3 vPal;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = crowdPose(objectNormal, true);`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = crowdPose(transformed, false);
int mi = int(mat + 0.5); vec3 base = uPal[mi]; float c = uCls[mi];
vPal = c < 0.5 ? base : c < 1.5 ? iSkin * (base.r / uSkinRef) : c < 2.5 ? iHair : c < 3.5 ? iHair * 0.6 : c < 4.5 ? iTop : iLegs;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPal;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPal, opacity );');
    };
    // the shadows walk too
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni, { uTime: U.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${pose}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = crowdPose(transformed, false);`);
    };
    return { mat, depth };
  }

  // Draws actors.crowd's pedestrians: a skinned person for the nearest few, an instance
  // of the character's low-detail copy for everyone else.
  function crowdRenderer(world, lib, U, P, { near = 14, nearR = 32 } = {}) {
    const groups = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const p of P) {
      p.look = randomLook(lib, pickCharacter(lib));
      const gs = lib.info.ground_speed[lib.info.characters[p.look.character].pack].Walk, ex = lib.lod[p.look.character].extras;
      p.speed = gs * p.look.scale * (0.95 + rnd() * 0.25);
      p.thigh = (ex.hip[0] - ex.knee[0]) * p.look.scale; // how far the body drops when sitting
      (groups[p.look.character] = groups[p.look.character] || []).push(p);
    }
    const meshes = [];
    for (const [name, ps] of Object.entries(groups)) {
      const L = lib.lod[name], geo = L.geometry.clone(), n = ps.length;
      for (const a of ['iSkin', 'iHair', 'iTop', 'iLegs', 'aAnim']) geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      const { mat, depth } = crowdMaterial(L.extras, U);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.customDepthMaterial = depth;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      geo.attributes.aAnim.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      ps.forEach((p, k) => {
        p.mesh = mesh; p.slot = k;
        for (const [a, key] of [['iSkin', 'skin'], ['iHair', 'hair'], ['iTop', 'top'], ['iLegs', 'legs']]) { const c = lin(p.look[key]); geo.attributes[a].setXYZ(k, c.r, c.g, c.b); }
      });
      world.add(mesh);
      meshes.push(mesh);
    }
    const free = {}, active = new Map();
    let dtNow = 0, tNow = 0;
    function begin(dt, cx, cy, t, nActive) {
      dtNow = dt; tNow = t;
      const want = [];
      for (let i = 0; i < nActive; i++) { const p = P[i]; if (p.line < 0) continue; const d = Math.hypot(p.x - cx, p.y - cy); if (d < nearR) want.push([d, i]); }
      want.sort((a, b) => a[0] - b[0]);
      const keep = new Set(want.slice(0, near).map(w => w[1]));
      for (const [i, r] of active) if (!keep.has(i)) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
      for (const i of keep) {
        if (active.has(i)) continue;
        const p = P[i], name = p.look.character;
        if (!lib.tpl[name]) { lib.require(name); continue; }
        const r = (free[name] && free[name].pop()) || person(lib, Object.assign({}, p.look));
        r.setLook(p.look);
        world.add(r.root);
        active.set(i, r);
      }
    }
    function place(i, p, moving) {
      const r = active.get(i);
      if (r) {
        p.mesh.setMatrixAt(p.slot, zero);
        r.root.position.copy(W(p.x, p.y, p.z));
        r.root.rotation.y = Math.PI - p.h;
        if (p.wave) { p.wave = false; r.wave(tNow); }
        r.animate(dtNow, moving ? p.v ?? p.speed : 0, p.mode === 'sit' ? 'sit' : 'ground', tNow);
        return;
      }
      p.wave = false;
      const sit = p.mode === 'sit';
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - p.h);
      sc.setScalar(p.look.scale);
      m4.compose(W(p.x, p.y, p.z - (sit ? p.thigh : 0)), q, sc);
      p.mesh.setMatrixAt(p.slot, m4);
      // the cadence follows the speed; when it changes, shift the phase so the stride doesn't jump
      const f = moving ? 4.5 * (p.v ?? p.speed) / p.look.scale : p.animF ?? 4.5 * p.speed / p.look.scale;
      if (p.animF == null) { p.animF = f; p.animO = p.phase; }
      else if (Math.abs(f - p.animF) > 0.02 * p.animF) { p.animO += (p.animF - f) * tNow; p.animF = f; }
      p.mesh.geometry.attributes.aAnim.setXYZ(p.slot, p.animO, p.animF, sit ? -1 : moving ? 0.42 : 0);
    }
    function hide(i) {
      const p = P[i];
      p.mesh.setMatrixAt(p.slot, zero);
      const r = active.get(i);
      if (r) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
    }
    function end() {
      for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aAnim.needsUpdate = true; }
    }
    return { begin, place, hide, end, meshes, active };
  }

  return { load, person, randomLook, pickCharacter, crowdRenderer, colours };
})();
