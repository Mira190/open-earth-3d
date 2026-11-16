// A four-legged guide: an animal that goes ahead of the player to where a story wants them, waits when they fall
// behind, comes back for them when they stray, and sits where the way ends. Nothing here names a map or a story: the
// model is a file with the clips `idle`, `walk`, `trot` and `sit` on the spot (blender/build_dog.py's Akita), and
// whoever makes one says where it stands and where it leads (story.js, from a map's data).
//
//   const dog = OECompanion.create({ url, world, W, ground, player, people(x, y, r) -> [[x, y], ...], speeds: { walk, trot } });
//   dog.place(x, y, facing)       where it stands (it is drawn once its model has loaded)
//   dog.lead([x, y], reach)       goes to the player first, then ahead of them to the place, and sits there
//   dog.go([x, y], look)          goes there by itself and sits, looking at `look` ([x, y, z]) if given
//   dog.leave([x, y], done)       runs off there, fading, and is taken away
//   dog.tick(dt)                  every frame (its own time: a stopped world's guide still moves)
//   dog.x, dog.y, dog.z, dog.state ('away' | 'greet' | 'lead' | 'wait' | 'fetch' | 'go' | 'sit' | 'leave'), dog.ready
'use strict';
window.OECompanion = (function () {
  const AHEAD = 3.4;   // it leads from about this far in front
  const FAR = 6.5;      // further than this from the player and it stops to wait
  const LOST = 12;     // and after a while further than this, it comes back for them
  const CLEAR = 1.1;   // it keeps this far from someone standing in its way
  function create({ url, world, W, ground, player, people = null, speeds = { walk: 0.95, trot: 2.3 }, height = 1 }) {
    const root = new THREE.Group();
    root.visible = false;
    world.add(root);
    // a pale ring on the ground under it while it leads: where the guide is, seen over a crowd's heads from behind
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 40), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.renderOrder = 20; ring.frustumCulled = false;
    root.add(ring);
    const s = { x: 0, y: 0, z: 0, h: 0, state: 'away', ready: false, to: null, reach: 3, look: null, done: null, t: 0, speed: 0, fade: 1, greeted: false };
    let mixer = null, acts = {}, cur = '', head = null, neck = null, mats = [];
    new THREE.GLTFLoader().load(url, g => {
      const m = g.scene;
      m.scale.setScalar(height);
      m.traverse(o => {
        if (o.isBone && o.name === 'head') head = o;
        if (o.isBone && o.name === 'neck') neck = o;
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        o.material.roughness = 0.9; o.material.metalness = 0;
        // (it carries a little light of its own, as whoever moves in a stopped world does: a dark coat on a wet night
        // street is not lost among the people standing in it)
        o.material.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.3;'); };
        mats.push(o.material);
      });
      root.add(m);
      mixer = new THREE.AnimationMixer(m);
      for (const c of g.animations) acts[c.name] = mixer.clipAction(c);
      s.ready = true;
      play('idle', 0);
      root.visible = s.state !== 'away';
    }, null, e => console.warn('The guide\'s model did not load:', e));
    function play(name, fade = 0.3) {
      if (!acts[name] || cur === name) return;
      const a = acts[name];
      a.reset().setEffectiveWeight(1).play();
      if (cur && acts[cur]) acts[cur].crossFadeTo(a, fade, false); else a.fadeIn(fade);
      cur = name;
    }
    const dist = (x, y) => Math.hypot(x - s.x, y - s.y);
    const turn = (to, rate, dt) => { let d = to - s.h; d = Math.atan2(Math.sin(d), Math.cos(d)); s.h += Math.sign(d) * Math.min(Math.abs(d), rate * dt); return Math.abs(d); };
    // a step towards a point at a speed, turning as it goes (slower through a sharp turn)
    function move(tx, ty, speed, dt) {
      const d = dist(tx, ty);
      if (d < 0.05) { s.speed = 0; return 0; }
      // round whoever stands in the way: pushed off each one within reach, and along them on the side it is already passing
      let vx = (tx - s.x) / d, vy = (ty - s.y) / d;
      if (people && d > 1 && !(s.thru > 0)) for (const q of people(s.x, s.y, CLEAR)) {
        const ox = s.x - q[0], oy = s.y - q[1], od = Math.hypot(ox, oy);
        if (od < 0.05 || od > CLEAR) continue;
        const k = (CLEAR - od) / CLEAR, side = Math.sign(ox * vy - oy * vx) || 1;
        vx += (ox / od) * k * 1.0 + (oy / od) * side * k * 1.3; vy += (oy / od) * k * 1.0 - (ox / od) * side * k * 1.3;
      }
      const off = turn(Math.atan2(vy, vx), 5.5, dt);
      const v = speed * Math.max(0.25, 1 - off / 1.6);
      const step = Math.min(d, v * dt);
      s.x += Math.cos(s.h) * step; s.y += Math.sin(s.h) * step;
      s.speed = v;
      // a crowd shoulder to shoulder is a wall to this: when it has got nowhere for a second it goes through, as an
      // afterimage may (better seen passing through a coat than left behind a queue)
      if (s.thru > 0) s.thru -= dt;
      s.gain = (s.gain || 0) + (d - Math.hypot(tx - s.x, ty - s.y)); s.gainT = (s.gainT || 0) + dt;
      if (s.gainT > 1) { if (s.gain < 0.35 * speed) s.thru = 2.5; s.gain = 0; s.gainT = 0; }
      return d - step;
    }
    const face = (x, y, dt) => turn(Math.atan2(y - s.y, x - s.x), 4, dt);
    function tick(dt) {
      if (s.state === 'away') return;
      s.t += dt;
      const px = player.x, py = player.y, dp = dist(px, py);
      let lookAt = null;
      if (s.state === 'greet') { // to the player first: a guide is met before it is followed
        if (dp > 2.6) move(px, py, speeds.trot * 1.25, dt); else { s.speed = 0; face(px, py, dt); if (!s.greeted) { s.greeted = true; s.t = 0; } if (s.t > 1.3) { s.state = 'lead'; s.t = 0; } }
        lookAt = [px, py, player.z + 1.5];
      } else if (s.state === 'lead' || s.state === 'wait' || s.state === 'fetch') {
        const left = dist(s.to[0], s.to[1]);
        if (left < s.reach) { s.state = 'sit'; s.t = 0; s.look = null; if (s.done) { const d = s.done; s.done = null; d(); } }
        else if (s.state === 'fetch') { if (dp > AHEAD) move(px, py, speeds.trot * 1.2, dt); else { s.state = 'lead'; s.t = 0; } lookAt = [px, py, player.z + 1.5]; }
        else if (dp > FAR) { // the player has fallen behind: it stops and looks back, and in a while goes to them
          if (s.state !== 'wait') { s.state = 'wait'; s.t = 0; }
          s.speed = 0; face(px, py, dt); lookAt = [px, py, player.z + 1.5];
          if (dp > LOST && s.t > 2.5 || s.t > 9) { s.state = 'fetch'; s.t = 0; }
        } else {
          s.state = 'lead';
          // as fast as it takes to stay ahead: a trot when the player is at its heels, a walk when it is well in front
          move(s.to[0], s.to[1], dp < AHEAD * 0.6 ? speeds.trot * 1.3 : dp < AHEAD ? speeds.trot : speeds.walk * 1.25, dt);
          if (dp > AHEAD * 1.3) lookAt = [px, py, player.z + 1.5];
        }
      } else if (s.state === 'go') {
        if (move(s.to[0], s.to[1], speeds.trot, dt) < 0.15) { s.state = 'sit'; s.t = 0; }
      } else if (s.state === 'sit') {
        s.speed = 0;
        const l = s.look || [px, py, player.z + 1.5];
        if (s.look) face(l[0], l[1], dt); else if (s.t < 1.2) face(px, py, dt);
        lookAt = l;
      } else if (s.state === 'leave') {
        const left = move(s.to[0], s.to[1], speeds.trot * 1.4, dt);
        if (s.t > 1.2) s.fade = Math.max(0, s.fade - dt / 1.4);
        for (const m of mats) { m.transparent = true; m.opacity = s.fade; }
        if (left < 0.3 || s.fade <= 0) { s.state = 'away'; root.visible = false; if (s.done) { const d = s.done; s.done = null; d(); } return; }
      }
      s.z = ground(s.x, s.y);
      root.position.copy(W(s.x, s.y, s.z));
      root.rotation.y = s.h; // (the model looks along +x; the map's y is the scene's -z)
      const leading = s.state === 'greet' || s.state === 'lead' || s.state === 'wait' || s.state === 'fetch';
      ring.material.opacity += ((leading ? 0.7 + 0.2 * Math.sin(s.t * 3) : 0) - ring.material.opacity) * Math.min(1, dt * 3);
      if (!mixer) return;
      const clip = s.state === 'sit' && s.t > 0.15 ? 'sit' : s.speed < 0.15 ? 'idle' : s.speed < 1.5 ? 'walk' : 'trot';
      play(clip, clip === 'sit' || cur === 'sit' ? 0.45 : 0.22);
      if (acts.walk) acts.walk.timeScale = Math.max(0.6, Math.min(1.7, s.speed / speeds.walk));
      if (acts.trot) acts.trot.timeScale = Math.max(0.7, Math.min(1.5, s.speed / speeds.trot));
      mixer.update(dt);
      // the head turns to what it is watching, over the clip's own pose
      if (head && lookAt) {
        let yaw = Math.atan2(lookAt[1] - s.y, lookAt[0] - s.x) - s.h; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        const up = Math.atan2((lookAt[2] ?? s.z + 0.8) - (s.z + 0.8), Math.max(1, dist(lookAt[0], lookAt[1])));
        s.hy = (s.hy || 0) + (Math.max(-1.25, Math.min(1.25, yaw)) - (s.hy || 0)) * Math.min(1, dt * 5);
        s.hp = (s.hp || 0) + (Math.max(-0.3, Math.min(0.6, up)) - (s.hp || 0)) * Math.min(1, dt * 4);
      } else { s.hy = (s.hy || 0) * Math.max(0, 1 - dt * 4); s.hp = (s.hp || 0) * Math.max(0, 1 - dt * 4); }
      if (head && (Math.abs(s.hy) > 0.01 || Math.abs(s.hp) > 0.01)) {
        const yAxis = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(Math.sin(s.h), 0, Math.cos(s.h)); // (the axis a raised nose turns about)
        for (const [b, k] of [[neck, 0.4], [head, 0.6]]) { if (!b) continue; rotateWorld(b, yAxis, s.hy * k); rotateWorld(b, side, s.hp * k); }
      }
    }
    // a bone turned about an axis of the scene, whatever its own frame
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
    function rotateWorld(bone, axis, angle) {
      bone.parent.getWorldQuaternion(q0);
      q1.setFromAxisAngle(axis, angle);
      bone.quaternion.premultiply(q0).premultiply(q1).premultiply(q0.invert());
    }
    const api = {
      get x() { return s.x; }, get y() { return s.y; }, get z() { return s.z; }, get state() { return s.state; }, get ready() { return s.ready; }, get clip() { return cur; }, root,
      place(x, y, h = 0) { s.x = x; s.y = y; s.h = h; s.z = ground(x, y); s.state = 'sit'; s.t = 1; s.fade = 1; root.visible = s.ready; root.position.copy(W(x, y, s.z)); root.rotation.y = h; return api; },
      lead(to, reach = 3, done = null) { s.to = to; s.reach = reach; s.done = done; s.state = s.greeted ? 'lead' : 'greet'; s.t = 0; return api; },
      go(to, look = null) { s.to = to; s.look = look; s.state = 'go'; s.t = 0; return api; },
      leave(to, done = null) { s.to = to; s.done = done; s.state = 'leave'; s.t = 0; return api; },
      tick,
      remove() { world.remove(root); s.state = 'away'; },
    };
    return api;
  }
  return { create };
})();
