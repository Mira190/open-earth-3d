// What makes a stopped world read as stopped: things that can only be where they are because they were moving.
// A still street looks like a photograph of a street. A leaf a metre off the ground, a pigeon with its wings up,
// a handbill on its edge in the air and rain hanging as beads look like time held. And because they hang at every
// depth, walking among them gives the parallax that a camera moving through a frozen moment has.
//
// Nothing here knows the story or the map. The game makes one with create(), calls start() as time begins to
// slow, tick() every frame with how much time the world is being given (1 running, 0 held), and release() as it
// runs on. Everything falls or flies by that scale: it is seen slowing as the world slows, hangs while it is held,
// and falls away when it is let go.
//   start(centre, { rain })   centre: where the player stands (a THREE.Vector3); rain: beads of it in the air
//   tick(dt, scale, player)   dt in real seconds; player: where the player is now (the beads part round them)
'use strict';
window.OEStopFX = (function () {
  const R = 16, H = 7; // the air it fills: this far round the player, this high
  function create({ THREE, world, audio, sound }) {
    let g = null, age = 0, fall = 0, letGo = -1, leaves = null, birds = null, motes = null, drops = null, ring = null, splash = null;
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

    // leaves and handbills, each with a place, a way it was falling and a way it was turning. Ginkgo and zelkova
    // are the trees of these streets; a leaf is drawn half as big again as life, to be seen across the crossing
    const KIND = [{ name: 'ginkgo', size: [0.085, 0.115], tint: [0xe6b422, 0xd9a520, 0xf0c838, 0xc9a227] }, { name: 'zelkova', size: [0.11, 0.15], tint: [0xb5521e, 0xc8742a, 0x9a4a22, 0xd08a2e] }, { name: 'bill', size: [0.21, 0.21], tint: [0xffffff] }];
    function cards(n) {
      const o = new THREE.Group(), it = [], kindOf = i => i % 9 === 0 ? 2 : i % 3 === 1 ? 1 : 0, count = [0, 0, 0];
      for (let i = 0; i < n; i++) count[kindOf(i)]++;
      const mesh = KIND.map((k, j) => inst(k.name, Math.max(1, count[j]))), at = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, close = i % 5 < 3, d = close ? rnd(1.2, 9) : 1.5 + Math.sqrt(Math.random()) * (R + 8), j = kindOf(i), k = KIND[j], bill = j === 2;
        it.push({ m: mesh[j], k: at[j], p: new THREE.Vector3(Math.cos(a) * d, close ? rnd(0.4, 3.4) : rnd(0.25, bill ? 5 : 10), Math.sin(a) * d), v: new THREE.Vector3(rnd(-0.5, 0.5), -rnd(0.5, 1.3), rnd(-0.5, 0.5)), e: new THREE.Euler(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)), w: new THREE.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)), s: rnd(k.size[0], k.size[1]) });
        mesh[j].setColorAt(at[j]++, new THREE.Color(k.tint[i % k.tint.length]).multiplyScalar(rnd(0.82, 1.05)));
      }
      mesh.forEach(m => o.add(m)); o.userData.it = it;
      return o;
    }
    function layCards(dt) {
      const it = leaves.userData.it;
      for (let i = 0; i < it.length; i++) {
        const c = it[i];
        if (dt > 0) { c.p.addScaledVector(c.v, dt); c.e.x += c.w.x * dt; c.e.y += c.w.y * dt; c.e.z += c.w.z * dt; if (c.p.y < 0.03) { c.p.y = 0.03; c.v.set(0, 0, 0); c.w.set(0, 0, 0); c.e.x = c.e.z = 0; } } // (the models lie in the ground plane)
        M.compose(c.p, Q.setFromEuler(c.e), S.setScalar(c.s)); c.m.setMatrixAt(c.k, M);
      }
      leaves.children.forEach(m => { m.instanceMatrix.needsUpdate = true; });
    }
    // birds: pigeons taking off together, each a body and two wings of two parts, the wings wherever in the beat
    // they were. The model faces +z with +x its left; a bird is drawn a third bigger than life
    const PART = ['pigeon', 'pigeon_arm_l', 'pigeon_hand_l', 'pigeon_arm_r', 'pigeon_hand_r'], BIRD = 1.35;
    function flock(n) {
      const o = new THREE.Group(), it = [];
      const head = rnd(0, 6.283), dir = new THREE.Vector3(Math.cos(head), 0.16, Math.sin(head)).normalize(), base = new THREE.Vector3(rnd(-3, 3), 2.2, rnd(-3, 3)).addScaledVector(dir, 5);
      for (let i = 0; i < n; i++) it.push({ p: base.clone().add(V.set(rnd(-3.5, 3.5), rnd(-1.4, 3.6), rnd(-3.5, 3.5))), ph: rnd(0, 6.283), sp: rnd(4, 6.5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-rnd(0.15, 0.5), Math.atan2(dir.x, dir.z) + rnd(-0.3, 0.3), rnd(-0.25, 0.25), 'YXZ')) });
      PART.forEach(name => o.add(inst(name, n)));
      o.userData = { it, dir };
      return o;
    }
    const MA = new THREE.Matrix4(), MB = new THREE.Matrix4(), MJ = new THREE.Matrix4();
    function layBirds(dt) {
      const { it, dir } = birds.userData, [body, armL, handL, armR, handR] = birds.children;
      for (let i = 0; i < it.length; i++) {
        const b = it[i]; b.p.addScaledVector(dir, b.sp * dt); b.ph += 13 * dt;
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
    // the sound of it: a tone falling away to nothing as time slows, and rising back as it is let go
    function sweep(down) {
      try {
        const ac = audio && audio();
        if (!ac || (sound && !sound())) return;
        const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), gn = ac.createGain(), d = down ? 1.5 : 0.8;
        o.type = 'sine'; o2.type = 'triangle';
        o.frequency.setValueAtTime(down ? 420 : 46, t); o.frequency.exponentialRampToValueAtTime(down ? 38 : 300, t + d);
        o2.frequency.setValueAtTime(down ? 633 : 69, t); o2.frequency.exponentialRampToValueAtTime(down ? 57 : 452, t + d);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.16, t + 0.06); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(gn); o2.connect(gn); gn.connect(ac.destination); o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
      } catch (e) { /* no sound: the picture carries it */ }
    }

    function dispose() {
      if (!g) return;
      world.remove(g);
      g.traverse(o => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.isInstancedMesh) o.dispose(); }); // (the models' geometry is kept for the next Stop)
      g = leaves = birds = motes = drops = ring = splash = null;
    }
    function start(centre, { rain = false } = {}) {
      dispose();
      g = new THREE.Group(); g.position.copy(centre); age = 0; fall = 0; letGo = -1;
      motes = points(1400, R, 4.2, 0.06, 0xfff1d6, true); g.add(motes);
      if (rain) { drops = points(4200, R - 2, H, 0.05, 0xcfe0ff, false); g.add(drops); }
      if (kit) { leaves = cards(rain ? 90 : 300); g.add(leaves); layCards(0); birds = flock(rain ? 4 : 11); g.add(birds); layBirds(0); }
      { const n = 260, o = points(n, 1, 1, 0.05, 0xdcebff, false), a = o.geometry.attributes.position, th = rnd(0, 6.283), cx = Math.cos(th) * 3.2, cz = Math.sin(th) * 3.2;
        for (let i = 0; i < n; i++) { const u = Math.random(), an = Math.random() * 6.283, r = 0.08 + u * rnd(0.3, 0.75); a.setXYZ(i, cx + Math.cos(an) * r, 0.05 + Math.sin(Math.PI * Math.min(1, u * 1.15)) * rnd(0.5, 1.25), cz + Math.sin(an) * r); }
        o.material.uniforms.uH.value = 1e6; splash = o; g.add(o); }
      // the moment itself: a ring running out along the ground from where you stand
      ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 128), new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; ring.renderOrder = 19; g.add(ring);
      world.add(g);
      sweep(true);
    }
    function release() { if (g && letGo < 0) { letGo = 0; sweep(false); } }
    function tick(dt, scale, player) {
      if (!g) return;
      age += dt;
      if (letGo >= 0) { letGo += dt; if (letGo > 1.8) return dispose(); }
      const fade = Math.min(1, age / 0.5) * (letGo >= 0 ? Math.max(0, 1 - letGo / 1.8) : 1), wdt = dt * scale;
      local.copy(player).sub(g.position);
      fall += wdt;
      motes.material.uniforms.uFall.value = fall * 0.12; motes.material.uniforms.uFade.value = fade * 0.85; motes.material.uniforms.uP.value.copy(local);
      if (drops) { drops.material.uniforms.uFall.value = fall * 7.5; drops.material.uniforms.uFade.value = fade * 0.85; drops.material.uniforms.uP.value.copy(local); }
      if (splash) { splash.material.uniforms.uFall.value = letGo >= 0 ? letGo * letGo * 4 : 0; splash.material.uniforms.uFade.value = fade * 0.9; splash.material.uniforms.uP.value.copy(local); }
      if (leaves) { shown(leaves, fade); shown(birds, fade); if (wdt > 0) { layCards(wdt); layBirds(wdt); } }
      if (ring) { const k = Math.min(1, age / 1.1), e = 1 - Math.pow(1 - k, 3); ring.scale.setScalar(1 + e * 85); ring.material.opacity = 0.9 * (1 - k); if (k >= 1) { g.remove(ring); ring.geometry.dispose(); ring.material.dispose(); ring = null; } }
    }
    return { start, release, tick, dispose, get on() { return !!g; } };
  }
  return { create };
})();
