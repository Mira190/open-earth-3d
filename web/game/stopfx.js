// What makes a stopped world read as stopped: things that can only be where they are because they were moving.
// A still street looks like a photograph of a street. A leaf a metre off the ground, a pigeon with its wings up,
// a handbill on its edge in the air and rain hanging as beads look like time held. And because they hang at every
// depth, walking among them gives the parallax that a camera moving through a frozen moment has.
//
// And they are there before it stops. A leaf that appears at the moment of the Stop is an effect; a leaf that was
// already coming down past your shoulder and now hangs there is the world. So the air is always running: leaves
// come off the street's trees and are blown along, a flock of pigeons goes over every quarter minute, dust drifts
// in the screens' light. The Stop adds only what a Stop is: the ring, the tone, and in rain the rain itself held.
//
// Nothing here knows the story or the map. The game makes one with create(), gives it the air of the scene with
// air(), calls tick() every frame with how much time the world is being given (1 running, 0 held), start() as
// time begins to slow and release() as it runs on.
//   air(centre, { leaves, birds })   the scene's air round the player: how many leaves, how many birds
//   start(centre, { rain })          centre: where the player stands (a THREE.Vector3); rain: beads of it in the air
//   tick(dt, scale, player, high)    dt in real seconds; player: where the player is now; high: up a tower (no leaves)
'use strict';
window.OEStopFX = (function () {
  const R = 16, H = 7; // the air it fills: this far round the player, this high
  function create({ THREE, world, audio, sound }) {
    let g = null, amb = null, age = 0, fall = 0, drift = 0, letGo = -1, leaves = null, birds = null, motes = null, drops = null, ring = null, splash = null;
    const rnd = (a, b) => a + Math.random() * (b - a), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
    const local = new THREE.Vector3();

    // points hanging in the air: a soft round dot each; they fall by uFall (wrapped in the column), and stand
    // aside from whoever walks through them
    function points(n, r, h, size, color, additive) {
      const pos = new Float32Array(n * 3), s = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r; pos[3 * i] = Math.cos(a) * d; pos[3 * i + 1] = Math.random() * h; pos[3 * i + 2] = Math.sin(a) * d; s[i] = rnd(0.55, 1.3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(s, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uP: { value: new THREE.Vector3() }, uFall: { value: 0 }, uH: { value: h }, uSize: { value: size }, uFade: { value: 0 }, uColor: { value: new THREE.Color(color) } },
        vertexShader: `uniform vec3 uP; uniform float uFall, uH, uSize; attribute float aS; varying float vS;
          void main() { vec3 p = position; p.y = mod(p.y - uFall * aS, uH);
            vec2 d = p.xz - uP.xz; float l = length(d), near = smoothstep(0.8, 0.0, l) * step(p.y, uP.y + 2.1) * step(uP.y - 0.2, p.y);
            p.xz += (l > 1e-4 ? d / l : vec2(1.0, 0.0)) * near * 0.6;
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vS = aS;
            gl_PointSize = clamp(uSize * aS * 420.0 / max(0.3, -mv.z), 1.0, 26.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uFade; varying float vS;
          void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
            float a = (1.0 - r * r) * (0.55 + 0.45 * smoothstep(0.5, 0.0, length(c - vec2(-0.14, -0.16)))); gl_FragColor = vec4(uColor, a * uFade); }`,
      });
      const o = new THREE.Points(geo, mat); o.frustumCulled = false; o.renderOrder = 18;
      return o;
    }
    // the models of what hangs (blender/build_stop.py): leaves, a handbill, a pigeon in five parts. Each geometry is
    // taken about its own joint, and `at` is where that joint sits in the model
    let kit = null;
    new THREE.GLTFLoader().load('assets/stop/stop.glb', gl => {
      gl.scene.updateMatrixWorld(true); const k = {};
      gl.scene.traverse(o => { if (o.isMesh) { const at = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); k[o.name] = { geo: o.geometry.clone().applyMatrix4(o.matrixWorld).translate(-at.x, -at.y, -at.z), at }; } });
      kit = k;
    }, undefined, e => console.warn('The leaves and birds of the stopped air are unavailable:', e));
    // lit by the scene, so their form reads; and a share of their own colour given back unlit, as the screens and
    // shop fronts all round would light them (the night's sky light alone leaves a gold leaf olive)
    const GLOW = 0.5;
    const lit = () => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0 }); m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${GLOW.toFixed(2)};`); }; return m; };
    const inst = (name, n) => { const m = new THREE.InstancedMesh(kit[name].geo, lit(), n); m.frustumCulled = false; return m; };
    const shown = (o, fade) => o.children.forEach(m => { m.material.opacity = fade; });

    // leaves and pages of old newspaper, each with a place, a way it was falling and a way it was turning. Ginkgo and zelkova
    // are the trees of these streets; a leaf is drawn half as big again as life, to be seen across the crossing
    const KIND = [{ name: 'ginkgo', size: [0.085, 0.115], tint: [0xe6b422, 0xd9a520, 0xf0c838, 0xc9a227] }, { name: 'zelkova', size: [0.11, 0.15], tint: [0xb5521e, 0xc8742a, 0x9a4a22, 0xd08a2e] }, { name: 'bill', size: [0.4, 0.46], tint: [0xffffff, 0xf2ead8] }];
    const WRAP = R + 8; // what drifts out of this far from the player comes in again on the other side
    function place(c, i, fresh) { // a leaf's start: three in five close by, to come down past a face; the first lot anywhere in their fall, the next from above
      const a = Math.random() * 6.283, close = i % 5 < 3, d = close ? rnd(1.2, 9) : 1.5 + Math.sqrt(Math.random()) * (WRAP - 2);
      c.p.set(local.x + Math.cos(a) * d, fresh ? (close ? rnd(0.4, 5) : rnd(0.25, c.bill ? 5 : 10)) : rnd(4.5, c.bill ? 6 : 10), local.z + Math.sin(a) * d);
      c.v.set(rnd(-0.6, 0.6) + 0.5, -rnd(0.35, 0.9), rnd(-0.6, 0.6)); c.w.set(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)); c.rest = 0;
    }
    function cards(n) {
      const o = new THREE.Group(), it = [], kindOf = i => i % 25 === 0 ? 2 : i % 3 === 1 ? 1 : 0, count = [0, 0, 0];
      for (let i = 0; i < n; i++) count[kindOf(i)]++;
      const mesh = KIND.map((k, j) => inst(k.name, Math.max(1, count[j]))), at = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const j = kindOf(i), k = KIND[j], c = { m: mesh[j], k: at[j], bill: j === 2, p: new THREE.Vector3(), v: new THREE.Vector3(), e: new THREE.Euler(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)), w: new THREE.Vector3(), s: rnd(k.size[0], k.size[1]), rest: 0 };
        place(c, i, true); it.push(c);
        mesh[j].setColorAt(at[j]++, new THREE.Color(k.tint[i % k.tint.length]).multiplyScalar(rnd(0.82, 1.05)));
      }
      mesh.forEach((m, j) => { if (!count[j]) m.count = 0; o.add(m); }); o.userData.it = it;
      return o;
    }
    function layCards(dt, running) {
      const it = leaves.userData.it;
      for (let i = 0; i < it.length; i++) {
        const c = it[i];
        if (dt > 0) {
          if (c.p.y > 0.03) { c.p.addScaledVector(c.v, dt); c.p.x += Math.sin(drift * 0.7 + i) * 0.25 * dt; c.e.x += c.w.x * dt; c.e.y += c.w.y * dt; c.e.z += c.w.z * dt; if (c.p.y <= 0.03) { c.p.y = 0.03; c.e.x = c.e.z = 0; } } // (the models lie in the ground plane)
          else if ((c.rest += dt) > 4 + (i % 7)) place(c, i, false); // (it lies a while, and another comes off the tree)
          if (running) { // (kept round the player as they walk; never while time is held: what hangs, hangs where it was)
            if (c.p.x - local.x > WRAP) c.p.x -= 2 * WRAP; else if (c.p.x - local.x < -WRAP) c.p.x += 2 * WRAP;
            if (c.p.z - local.z > WRAP) c.p.z -= 2 * WRAP; else if (c.p.z - local.z < -WRAP) c.p.z += 2 * WRAP;
          }
        }
        M.compose(c.p, Q.setFromEuler(c.e), S.setScalar(c.s)); c.m.setMatrixAt(c.k, M);
      }
      leaves.children.forEach(m => { m.instanceMatrix.needsUpdate = true; });
    }
    // birds: pigeons taking off together, each a body and two wings of two parts, the wings wherever in the beat
    // they were. The model faces +z with +x its left; a bird is drawn a third bigger than life
    const PART = ['pigeon', 'pigeon_arm_l', 'pigeon_hand_l', 'pigeon_arm_r', 'pigeon_hand_r'], BIRD = 1.35;
    function flock(n) {
      const o = new THREE.Group(), it = [];
      const head = rnd(0, 6.283), dir = new THREE.Vector3(Math.cos(head), 0.1, Math.sin(head)).normalize(), base = new THREE.Vector3(local.x + rnd(-3, 3), 2.6, local.z + rnd(-3, 3)).addScaledVector(dir, -8); // (a second or two short of the player: over them as the first evening stops)
      for (let i = 0; i < n; i++) it.push({ p: base.clone().add(V.set(rnd(-3.5, 3.5), rnd(-1.4, 3.6), rnd(-3.5, 3.5))), ph: rnd(0, 6.283), sp: rnd(4, 6.5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-rnd(0.15, 0.5), Math.atan2(dir.x, dir.z) + rnd(-0.3, 0.3), rnd(-0.25, 0.25), 'YXZ')) });
      PART.forEach(name => o.add(inst(name, n)));
      o.userData = { it, dir };
      return o;
    }
    const MA = new THREE.Matrix4(), MB = new THREE.Matrix4(), MJ = new THREE.Matrix4();
    const PASS = 95; // the flock goes over, and comes over again this far on (every quarter minute or so)
    function layBirds(dt, running) {
      const { it, dir } = birds.userData, [body, armL, handL, armR, handR] = birds.children;
      for (let i = 0; i < it.length; i++) {
        const b = it[i]; b.p.addScaledVector(dir, b.sp * dt); b.ph += 13 * dt;
        if (running) { const along = (b.p.x - local.x) * dir.x + (b.p.z - local.z) * dir.z; if (along > PASS / 2) { b.p.addScaledVector(dir, -PASS); b.p.y = rnd(1.2, 6.2); } }
        const a = 0.25 + Math.sin(b.ph), h = 0.55 * Math.sin(b.ph - 1) - 0.1; // the arm's beat, and the hand's a little behind it
        M.compose(b.p, b.q, S.setScalar(BIRD)); body.setMatrixAt(i, M);
        for (const [arm, hand, sgn] of [[armL, handL, 1], [armR, handR, -1]]) {
          const sh = kit[sgn > 0 ? 'pigeon_arm_l' : 'pigeon_arm_r'].at, wr = kit[sgn > 0 ? 'pigeon_hand_l' : 'pigeon_hand_r'].at;
          MA.copy(M).multiply(MJ.makeTranslation(sh.x, sh.y, sh.z)).multiply(MJ.makeRotationZ(sgn * a)); arm.setMatrixAt(i, MA);
          MB.copy(MA).multiply(MJ.makeTranslation(wr.x - sh.x, wr.y - sh.y, wr.z - sh.z)).multiply(MJ.makeRotationZ(sgn * h)); hand.setMatrixAt(i, MB);
        }
      }
      birds.children.forEach(m => { m.instanceMatrix.needsUpdate = true; });
    }
    // (it makes no sound of its own: a tone falling away was tried here and was a telephone running out of battery; the
    // story's own sound has the Stop's: audio.js)
    const drop = o => { if (!o) return; world.remove(o); o.traverse(q => { if (q.geometry && !q.isInstancedMesh) q.geometry.dispose(); if (q.material) q.material.dispose(); if (q.isInstancedMesh) q.dispose(); }); }; // (the models' geometry is kept)
    function dispose() { drop(g); drop(amb); g = amb = leaves = birds = motes = drops = ring = splash = null; }
    // the scene's air: made once per scene, round the player, and running from then on
    let want = null;
    function air(centre, { leaves: nl = 110, birds: nb = 11 } = {}) {
      want = { nl, nb };
      if (!kit) return; // (the models have not come yet: tick makes it when they have)
      drop(amb); amb = new THREE.Group(); amb.position.copy(centre); local.set(0, 0, 0); want = null;
      motes = points(1400, R, 4.2, 0.06, 0xfff1d6, true); amb.add(motes);
      leaves = cards(Math.max(1, nl)); leaves.visible = nl > 0; amb.add(leaves); layCards(0, false);
      birds = flock(Math.max(1, nb)); birds.visible = nb > 0; amb.add(birds); layBirds(0, false);
      shown(leaves, 1); shown(birds, 1);
      world.add(amb);
    }
    // the Stop itself: the ring, the tone, and in rain the rain held as beads and one splash caught as a crown
    function start(centre, { rain = false } = {}) {
      drop(g); g = new THREE.Group(); g.position.copy(centre); age = 0; fall = 0; letGo = -1; drops = splash = null;
      if (rain) {
        drops = points(4200, R - 2, H, 0.05, 0xcfe0ff, false); g.add(drops);
        const n = 260, o = points(n, 1, 1, 0.05, 0xdcebff, false), a = o.geometry.attributes.position, th = rnd(0, 6.283), cx = Math.cos(th) * 3.2, cz = Math.sin(th) * 3.2;
        for (let i = 0; i < n; i++) { const u = Math.random(), an = Math.random() * 6.283, r = 0.08 + u * rnd(0.3, 0.75); a.setXYZ(i, cx + Math.cos(an) * r, 0.05 + Math.sin(Math.PI * Math.min(1, u * 1.15)) * rnd(0.5, 1.25), cz + Math.sin(an) * r); }
        o.material.uniforms.uH.value = 1e6; splash = o; g.add(o);
      }
      // the moment itself: a ring running out along the ground from where you stand
      ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 128), new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; ring.renderOrder = 19; g.add(ring);
      world.add(g);
    }
    function release() { if (g && letGo < 0) letGo = 0; }
    function tick(dt, scale, player, high = false) {
      const wdt = dt * scale, running = scale > 0.5;
      if (want && kit) air(player, { leaves: want.nl, birds: want.nb });
      if (amb) {
        if (running) amb.position.y += (player.y - amb.position.y) * Math.min(1, dt * 2); // (it comes with you up a stair; held, it stays where it hung)
        local.copy(player).sub(amb.position);
        drift += wdt;
        motes.material.uniforms.uFall.value = drift * 0.12; motes.material.uniforms.uFade.value = 0.3 + 0.55 * (1 - scale); motes.material.uniforms.uP.value.copy(local);
        leaves.visible = leaves.userData.it.length > 1 && !high; // (no leaves 230 m up a tower)
        if (wdt > 0) { layCards(wdt, running); layBirds(wdt, running); }
      }
      if (!g) return;
      age += dt;
      if (letGo >= 0) { letGo += dt; if (letGo > 1.8) { drop(g); g = drops = ring = splash = null; return; } }
      const fade = Math.min(1, age / 0.5) * (letGo >= 0 ? Math.max(0, 1 - letGo / 1.8) : 1), at = V.copy(player).sub(g.position);
      fall += wdt;
      if (drops) { drops.material.uniforms.uFall.value = fall * 7.5; drops.material.uniforms.uFade.value = fade * 0.85; drops.material.uniforms.uP.value.copy(at); }
      if (splash) { splash.material.uniforms.uFall.value = letGo >= 0 ? letGo * letGo * 4 : 0; splash.material.uniforms.uFade.value = fade * 0.9; splash.material.uniforms.uP.value.copy(at); }
      if (ring) { const k = Math.min(1, age / 1.1), e = 1 - Math.pow(1 - k, 3); ring.scale.setScalar(1 + e * 85); ring.material.opacity = 0.9 * (1 - k); if (k >= 1) { g.remove(ring); ring.geometry.dispose(); ring.material.dispose(); ring = null; } }
    }
    return { air, start, release, tick, dispose, get on() { return !!g; } };
  }
  return { create };
})();
