// Silver gulls round a dropped box of hot chips, as at the Opera Bar and along Circular Quay: a
// flock that pecks at the chips and squabbles over them, stands on the seawall looking out,
// circles and hangs in the wind overhead, makes off with a chip now and then, and bursts into
// the air when you walk into it, coming back once you have moved on. Where the flock works and
// the seawall beside it come from game.json "flocks" (pipeline/game_data.py); the birds' size and
// colours from the source cited in the city's config. Four instanced meshes draw them all:
// bodies, legs and each wing.
'use strict';
window.OEGulls = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  let seed = 4021;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  // geometry from parts, each painted per vertex; facing +z, standing on y = 0, about 0.41 m long
  function parts(list) {
    const out = [];
    for (const [g, colourOf] of list) {
      const q = g.index ? g.toNonIndexed() : g, p = q.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const v = colourOf(p.getX(i), p.getY(i), p.getZ(i)); c.set([v.r, v.g, v.b], i * 3); }
      q.setAttribute('color', new THREE.BufferAttribute(c, 3));
      q.deleteAttribute('uv');
      out.push(q);
    }
    const g = THREE.BufferGeometryUtils.mergeGeometries(out, false);
    g.computeVertexNormals();
    return g;
  }
  let K = null; // the colours, made once three.js has loaded
  const col = () => K || (K = { WHITE: lin('#f4f5f3'), GREY: lin('#a9b2b9'), BLACK: lin('#1d1d1f'), RED: lin('#c9352e'), BROWN: lin('#8f7a63') });
  function body(young) {
    const { WHITE, GREY, BLACK, RED, BROWN } = col();
    const back = young ? BROWN : GREY;
    const b = new THREE.SphereGeometry(0.1, 14, 10); b.scale(0.62, 0.62, 1.55); b.translate(0, 0.155, 0);
    const head = new THREE.SphereGeometry(0.047, 12, 8); head.translate(0, 0.245, 0.112);
    const bill = new THREE.ConeGeometry(0.011, 0.056, 6); bill.rotateX(Math.PI / 2); bill.translate(0, 0.24, 0.175);
    const tail = new THREE.BoxGeometry(0.075, 0.014, 0.08); tail.translate(0, 0.165, -0.165);
    const tips = new THREE.BoxGeometry(0.066, 0.02, 0.11); tips.translate(0, 0.19, -0.175); // the folded primaries, past the tail
    return parts([[b, (x, y, z) => (y > 0.17 && z < 0.085 ? back : WHITE)], [head, () => WHITE], [bill, () => (young ? BLACK : RED)], [tail, () => WHITE],
      [tips, (x, y, z) => (z < -0.215 && Math.abs(x) < 0.02 ? WHITE : BLACK)]]);
  }
  function legs(young) {
    const { RED, BROWN } = col(), out = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.006, 0.006, 0.11, 5); leg.translate(s * 0.022, 0.055, 0.005);
      const foot = new THREE.BoxGeometry(0.03, 0.006, 0.045); foot.translate(s * 0.022, 0.003, 0.02);
      out.push([leg, () => (young ? BROWN : RED)], [foot, () => (young ? BROWN : RED)]);
    }
    return parts(out);
  }
  // one wing from the shoulder (x = 0) out along +x: 0.45 m, tapering and swept, grey above,
  // white below and along the trailing edge, the outer third black with a white mirror
  function wing() {
    const { WHITE, GREY, BLACK } = col(), g = new THREE.BoxGeometry(0.45, 0.012, 0.13, 6, 1, 2), p = g.attributes.position;
    g.translate(0.225, 0, 0);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), t = x / 0.45;
      p.setZ(i, p.getZ(i) * (1 - 0.5 * t) - 0.06 * t * t);
    }
    return parts([[g, (x, y, z) => {
      const t = x / 0.45;
      if (t > 0.68) return t > 0.9 && t < 0.97 ? WHITE : BLACK;
      return y < 0 || z < -0.045 + -0.06 * t * t ? WHITE : GREY;
    }]]);
  }
  // a box of hot chips, dropped on its side, and the chips
  function chipBox() {
    const box = new THREE.BoxGeometry(0.12, 0.08, 0.1, 1, 1, 1);
    const idx = box.index.array.slice(), keep = [];
    for (let t = 0; t < idx.length; t += 3) { // open at +z: drop the two triangles of that face
      const zs = [0, 1, 2].map(k => box.attributes.position.getZ(idx[t + k]));
      if (!zs.every(z => z > 0.049)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    box.setIndex(keep);
    box.translate(0, 0.04, 0);
    return parts([[box, (x, y) => (Math.abs(y - 0.04) < 0.012 ? lin('#c7372f') : lin('#f2eee4'))]]);
  }

  // flock: one game.json "flocks" entry; audio: OEAudio, for their calls; nav: where the ground is
  function create(world, flock, audio, nav) {
    const F = flock, n = F.count || 9, [sx, sy] = F.at;
    const zAt = (x, y) => { const f = nav.floorAt(x, y, (F.z ?? nav.terrain(sx, sy)) + 1.5); return f ? f.z : nav.terrain(x, y); };
    const sz = zAt(sx, sy);
    const perches = (F.perches || []).map(p => ({ x: p[0], y: p[1], z: zAt(p[0], p[1]), h: p[2] * Math.PI / 180, taken: false }));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
    const young = Math.max(1, Math.round(n * 0.15)); // a juvenile or two, still brown-backed with a dark bill
    const mk = (g, k) => { const m = new THREE.InstancedMesh(g, mat, k); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; world.add(m); return m; };
    const adults = n - young;
    const meshes = { body: [mk(body(false), adults), mk(body(true), young)], legs: [mk(legs(false), adults), mk(legs(true), young)],
      wingL: mk(wing(), n), wingR: mk(wing(), n) };
    // the chips: the box on its side with a few in it, the rest scattered in front of it
    const boxAt = { x: sx + 0.3, y: sy - 0.2, h: rnd() * 6.28 };
    const box = new THREE.Mesh(chipBox(), mat);
    box.position.copy(W(boxAt.x, boxAt.y, sz)); box.rotation.set(0, Math.PI - boxAt.h, 0.08); box.castShadow = true;
    world.add(box);
    const NC = 26, chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.009, 0.009, 0.065), new THREE.MeshStandardMaterial({ color: lin('#e3b24a'), roughness: 0.65 }), NC);
    chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.add(chips);
    const C = [];
    for (let i = 0; i < NC; i++) {
      const a = boxAt.h + (rnd() - 0.5) * 1.6, r = i < 6 ? 0.02 + rnd() * 0.06 : 0.1 + rnd() * 0.7;
      C.push({ x: boxAt.x + Math.sin(a) * r, y: boxAt.y + Math.cos(a) * r, h: rnd() * 6.28, home: null, by: null });
      C[i].home = [C[i].x, C[i].y];
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const shoulder = new THREE.Matrix4(), flapM = new THREE.Matrix4(), base = new THREE.Matrix4(), bodyM = new THREE.Matrix4(), hip = new THREE.Matrix4(), tilt = new THREE.Matrix4();
    // the birds: on the ground (pecking, walking, squabbling, on the seawall) or in the air (circling, hanging in the wind, landing)
    const G = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, r = 0.4 + rnd() * 1.3;
      G.push({ i, young: i >= adults, k: 0.94 + rnd() * 0.12, x: sx + Math.sin(a) * r, y: sy + Math.cos(a) * r, z: sz, h: rnd() * 6.28, pitch: 0, roll: 0,
        air: false, task: 'peck', t: 1 + rnd() * 4, tx: 0, ty: 0, tz: 0, flap: rnd() * 6, wing: 0, cx: sx, cy: sy, cr: 6, ca: 0, cw: 0.5, ch: 6,
        peck: rnd(), call: 3 + rnd() * 20, chip: null, perch: null, spook: 0 });
    }
    // one on the seawall, one in the air to start with
    if (perches.length) { const g = G[n - 1], p = perches[Math.floor(rnd() * perches.length)]; Object.assign(g, { task: 'perch', perch: p, x: p.x, y: p.y, z: p.z, h: p.h, t: 8 + rnd() * 20 }); p.taken = true; }
    takeOff(G[0], 0.6);
    const near = (g, x, y) => Math.hypot(g.x - x, g.y - y);
    function call(g, px, py, louder = 1) {
      const d = Math.hypot(g.x - px, g.y - py);
      if (audio && d < 45) audio.gull(Math.min(1, louder * (1 - d / 45)));
    }
    function takeOff(g, delay = 0) {
      if (g.perch) { g.perch.taken = false; g.perch = null; }
      if (g.chip !== null) { const c = C[g.chip]; c.by = null; [c.x, c.y] = c.home; g.chip = null; } // dropped it
      Object.assign(g, { air: true, task: 'circle', t: 7 + rnd() * 10, vz: 2.6 + rnd(), spook: delay, cx: sx + (rnd() - 0.5) * 4, cy: sy + (rnd() - 0.5) * 4,
        cr: 4 + rnd() * 6, cw: (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.3), ch: sz + 4 + rnd() * 7 });
      g.ca = Math.atan2(g.x - g.cx, g.y - g.cy);
    }
    function landSomewhere(g) {
      const free = perches.filter(p => !p.taken);
      if (free.length && rnd() < 0.25) { const p = free[Math.floor(rnd() * free.length)]; p.taken = true; g.perch = p; Object.assign(g, { task: 'land', tx: p.x, ty: p.y, tz: p.z }); return; }
      const a = rnd() * 6.28, r = 0.3 + rnd() * 1.2;
      Object.assign(g, { task: rnd() < 0.3 ? 'hover' : 'land', tx: boxAt.x + Math.sin(a) * r, ty: boxAt.y + Math.cos(a) * r, t: 2.5 + rnd() * 3 });
      g.tz = zAt(g.tx, g.ty);
    }
    let lastT = 0, scared = 0;
    // dt: seconds; px, py, pz: the player on foot (or null); dark: 0 by day .. 1 at night
    function update(dt, px, py, onFoot, dark = 0) {
      lastT += dt;
      mat.emissiveIntensity = 0.12 * dark;
      const pNear = onFoot ? Math.hypot(px - sx, py - sy) : 1e9;
      scared = Math.max(0, scared - dt);
      for (const g of G) {
        // walk into them and they go up, the rest of the flock a moment after
        if (!g.air && onFoot && near(g, px, py) < (g.perch ? 1.6 : 2.4)) {
          takeOff(g); call(g, px, py, 1); scared = 6;
          for (const o of G) if (!o.air && near(o, px, py) < 5) takeOff(o, 0.1 + rnd() * 0.5);
        }
        if (g.air) {
          if (g.spook > 0) { g.spook -= dt; continue; }
          g.flap += dt * (g.task === 'hover' ? 15 : 11);
          if (g.task === 'circle') {
            g.ca += g.cw / Math.max(3, g.cr) * 3.2 * dt;
            const tx = g.cx + Math.sin(g.ca) * g.cr, ty = g.cy + Math.cos(g.ca) * g.cr;
            const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy), sp = Math.min(d, 5.5 * dt);
            if (d > 1e-3) { g.x += dx / d * sp; g.y += dy / d * sp; }
            g.h += angDiff(Math.atan2(dx, dy), g.h) * Math.min(1, dt * 4);
            g.vz = (g.vz || 0) * Math.exp(-dt * 1.5);
            g.z += ((g.ch + Math.sin(lastT * 0.7 + g.i) * 0.8 - g.z) * Math.min(1, dt * 0.9) + g.vz * dt);
            g.roll = -Math.sign(g.cw) * 0.35; g.pitch = -0.08;
            g.wing = Math.sin(lastT * 0.5 + g.i * 1.7) > 0.1 ? 0.75 * Math.sin(g.flap) : 0.12 + 0.03 * Math.sin(g.flap); // flapping, then gliding
            if ((g.t -= dt) < 0 && scared <= 0 && pNear > 4.5 && !(dark > 0.6 && rnd() < 0.002)) landSomewhere(g);
          } else { // land, or hang in the wind over the chips first
            const hover = g.task === 'hover', hz = hover ? g.tz + 2.6 + Math.sin(lastT * 2 + g.i) * 0.2 : g.tz;
            const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy), sp = Math.min(d, (hover ? 2.5 : 3.6) * dt);
            if (d > 1e-3) { g.x += dx / d * sp; g.y += dy / d * sp; g.h += angDiff(Math.atan2(dx, dy), g.h) * Math.min(1, dt * 5); }
            g.z += (Math.max(hz, g.tz) + (hover ? 0 : Math.min(d * 0.6, 6)) - g.z) * Math.min(1, dt * 2.2);
            g.roll *= Math.exp(-dt * 3); g.pitch = hover ? -0.35 : -0.15;
            g.wing = d < 1.5 || hover ? 0.85 * Math.sin(g.flap) + 0.2 : 0.15;
            if (hover && (g.t -= dt) < 0) g.task = 'land';
            if (!hover && d < 0.05 && g.z - g.tz < 0.08) {
              Object.assign(g, { air: false, z: g.tz, pitch: 0, roll: 0, wing: 0, task: g.perch ? 'perch' : 'peck', t: 3 + rnd() * 8 });
              if (g.perch) g.h = g.perch.h;
            }
            if (scared > 0 && pNear < 4.5) takeOff(g); // still there: round again
          }
          continue;
        }
        // on the ground, which slopes towards the seawall
        g.t -= dt;
        g.roll *= Math.exp(-dt * 6);
        g.z = zAt(g.x, g.y);
        if (g.task === 'perch') { // on the seawall, looking out over the water
          g.h = g.perch.h + Math.sin(lastT * 0.6 + g.i * 3) * 0.5;
          if (g.t < 0) { if (dark < 0.6 && rnd() < 0.5) takeOff(g); else { g.perch.taken = false; g.perch = null; g.task = 'walk'; g.tx = boxAt.x + (rnd() - 0.5) * 2; g.ty = boxAt.y + (rnd() - 0.5) * 2; } }
        } else if (g.task === 'walk' || g.task === 'carry') { // a waddle towards a chip, or away with one
          const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy), sp = Math.min(d, (g.task === 'carry' ? 0.7 : 0.45) * dt);
          if (d > 1e-3) { g.x += dx / d * sp; g.y += dy / d * sp; g.h += angDiff(Math.atan2(dx, dy), g.h) * Math.min(1, dt * 6); }
          g.roll = Math.sin(lastT * 9 + g.i) * 0.09;
          g.pitch = 0.05;
          if (d < 0.05 || g.t < -6) {
            if (g.task === 'carry') { const c = C[g.chip]; c.by = null; [c.x, c.y] = c.home; g.chip = null; } // eaten; another falls out of the box
            g.task = 'peck'; g.t = 2 + rnd() * 6;
          }
        } else if (g.task === 'squabble') { // wings up and a shout at a neighbour
          g.wing = 0.7 + 0.35 * Math.sin(lastT * 16 + g.i);
          g.z += Math.abs(Math.sin(lastT * 7)) * 0.08;
          if (g.t < 0) { g.wing = 0; g.task = 'walk'; const a = rnd() * 6.28; g.tx = g.x + Math.sin(a) * 0.9; g.ty = g.y + Math.cos(a) * 0.9; }
        } else { // pecking at the chips
          g.peck += dt * (1.1 + g.i % 3 * 0.25);
          const ph = g.peck % 1;
          g.pitch = ph < 0.22 ? Math.sin(ph / 0.22 * Math.PI) * 0.75 : 0;
          if (g.t < 0) {
            const r = rnd(), other = G.find(o => o !== g && !o.air && o.task === 'peck' && near(o, g.x, g.y) < 0.6);
            if (other && r < 0.3) { // a squabble
              for (const o of [g, other]) { o.task = 'squabble'; o.t = 0.8 + rnd() * 0.6; }
              g.h = Math.atan2(other.x - g.x, other.y - g.y); other.h = g.h + Math.PI;
              call(g, px, py, 0.9);
            } else if (r < 0.45 && dark < 0.6) { // makes off with a chip
              const c = C.find(c => c.by === null);
              if (c) { c.by = g.i; g.chip = C.indexOf(c); const a = rnd() * 6.28; Object.assign(g, { task: 'carry', tx: sx + Math.sin(a) * 3, ty: sy + Math.cos(a) * 3, t: 0 }); if (nav.isWater(g.tx, g.ty)) { g.tx = sx; g.ty = sy; } }
            } else if (r < 0.55 && dark < 0.6) takeOff(g);
            else { const c = C[Math.floor(rnd() * NC)]; Object.assign(g, { task: 'walk', tx: c.x + (rnd() - 0.5) * 0.15, ty: c.y + (rnd() - 0.5) * 0.15, t: 0 }); }
          }
        }
        if (g.task !== 'squabble') g.wing = 0;
        if ((g.call -= dt) < 0) { g.call = (dark > 0.6 ? 40 : 8) + rnd() * 30; if (onFoot) call(g, px, py, 0.6); }
      }
      // draw
      const cnt = [0, 0];
      for (const g of G) {
        const ty = g.young ? 1 : 0, k = cnt[ty]++;
        e.set(0, Math.PI - g.h, g.roll, 'YXZ'); q.setFromEuler(e);
        base.compose(W(g.x, g.y, g.z), q, v3.set(g.k, g.k, g.k));
        meshes.legs[ty].setMatrixAt(k, g.air ? zero : base);
        // the body pitches about the hips (pecking, or nose up in the air), the legs stay upright
        bodyM.multiplyMatrices(base, hip.makeTranslation(0, 0.11, 0)).multiply(tilt.makeRotationX(g.pitch)).multiply(hip.makeTranslation(0, -0.11, 0));
        meshes.body[ty].setMatrixAt(k, bodyM);
        const spread = g.air || g.wing > 0.01;
        for (const [m, s] of [[meshes.wingL, 1], [meshes.wingR, -1]]) {
          if (!spread) { m.setMatrixAt(g.i, zero); continue; }
          shoulder.makeTranslation(s * 0.05, 0.2, 0.035);
          flapM.makeRotationZ(s * g.wing).multiply(m4.makeScale(s, 1, 1));
          m.setMatrixAt(g.i, m4.multiplyMatrices(bodyM, shoulder).multiply(flapM));
        }
        if (g.chip !== null) { // the chip in its bill
          const c = C[g.chip];
          v3.set(0, 0.24, 0.2).applyMatrix4(bodyM);
          c.x = v3.x; c.y = -v3.z; c.z = v3.y; c.h = g.h + Math.PI / 2;
        }
      }
      for (const m of [...meshes.body, ...meshes.legs, meshes.wingL, meshes.wingR]) m.instanceMatrix.needsUpdate = true;
      C.forEach((c, i) => {
        q.setFromEuler(e.set(0, Math.PI - c.h, 0, 'YXZ'));
        m4.compose(c.by !== null ? W(c.x, c.y, c.z) : W(c.x, c.y, sz + 0.005 + (i < 6 ? 0.02 : 0)), q, one);
        chips.setMatrixAt(i, m4);
      });
      chips.instanceMatrix.needsUpdate = true;
    }
    update(0, 1e9, 1e9, false);
    // birds on the ground within r of (x, y), and how many are up
    const onGround = (x, y, r) => G.filter(g => !g.air && Math.hypot(g.x - x, g.y - y) < r).length;
    return { flock: F, birds: G, update, onGround, get flying() { return G.filter(g => g.air).length; }, at: [sx, sy, sz] };
  }
  return { create };
})();
