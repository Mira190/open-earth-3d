// Little penguins, as at the St Kilda breakwater: through the day most of them are out at
// sea; around dusk they gather in rafts offshore, come ashore after sunset in small groups at
// the edge of the rocks, waddle to their burrows and call through the night, and leave for the
// sea again before dawn. Where they land and nest comes from game.json "wildlife"
// (pipeline/game_data.py, from the mapped breakwater); the timing and numbers come from the
// sources cited in the city's config. One instanced mesh draws them all.
'use strict';
window.OEPenguins = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  let seed = 9091;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // a bird about a third of a metre tall, facing +z: slate-blue back, white front, dark bill, pale feet
  function bird(height) {
    const parts = [], k = height / 0.33;
    const paint = (g, colourOf) => {
      g = g.index ? g.toNonIndexed() : g;
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const v = colourOf(p.getX(i), p.getY(i), p.getZ(i)); c.set([v.r, v.g, v.b], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    };
    const blue = lin('#3f5a73'), white = lin('#eef0ee'), bill = lin('#2a2a2c'), foot = lin('#e7c9bf');
    const body = new THREE.SphereGeometry(0.1, 14, 10);
    body.scale(1, 1.45, 1.05); body.translate(0, 0.17, 0);
    paint(body, (x, y, z) => (z > 0.035 && y < 0.27 ? white : blue));
    const head = new THREE.SphereGeometry(0.052, 12, 8);
    head.translate(0, 0.305, 0.012);
    paint(head, (x, y, z) => (y < 0.29 && z > 0.03 ? white : blue));
    const beak = new THREE.ConeGeometry(0.011, 0.045, 6);
    beak.rotateX(Math.PI / 2); beak.translate(0, 0.3, 0.083);
    paint(beak, () => bill);
    for (const s of [-1, 1]) {
      const fl = new THREE.BoxGeometry(0.012, 0.12, 0.045);
      fl.rotateZ(s * 0.28); fl.translate(s * 0.1, 0.17, 0.0);
      paint(fl, () => blue);
      const ft = new THREE.BoxGeometry(0.035, 0.014, 0.06);
      ft.translate(s * 0.035, 0.007, 0.03);
      paint(ft, () => foot);
    }
    const g = THREE.BufferGeometryUtils.mergeGeometries(parts, false);
    g.scale(k, k, k);
    g.computeVertexNormals();
    return g;
  }

  // colony: one game.json "wildlife" entry; audio: OEAudio, for their calls; ground(x, y): the
  // height of the rocks, so the birds come up out of the water onto them and walk over them
  function create(world, colony, audio, ground) {
    const C = colony, burrows = C.burrows, landings = C.landings;
    if (!burrows.length || !landings.length) return null;
    const n = burrows.length, [a0, a1] = C.ashore_after_sunset_min, [l0, l1] = C.leave_before_sunrise_min;
    // after dark they catch a little of the viewing platform's low light, or nobody would see them
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
    // the glow takes each part's own colour: white fronts catch the light, slate-blue backs stay dark
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;'); };
    const groundAt = (x, y) => (ground ? Math.max(0, ground(x, y)) : 0.2);
    const mesh = new THREE.InstancedMesh(bird(C.height_m || 0.33), mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    world.add(mesh);
    // birds come ashore in small rafts of neighbours, each raft at the landing place nearest its
    // burrows: the burrows are taken in order along the rocks' edge (by their nearest landing)
    const nearestLanding = p => { let best = 0, bd = Infinity; landings.forEach((l, j) => { const d = Math.hypot(l[0] - p[0], l[1] - p[1]); if (d < bd) { bd = d; best = j; } }); return best; };
    const order = burrows.map(p => [nearestLanding(p), p]).sort((a, b) => a[0] - b[0]);
    const B = [];
    for (let i = 0; i < n;) {
      const size = Math.min(n - i, 4 + Math.floor(rnd() * 14)), land = landings[order[Math.min(n - 1, i + (size >> 1))][0]], arrive = a0 + rnd() * (a1 - a0);
      for (let k = 0; k < size; k++, i++) {
        B.push({ burrow: order[i][1], land, landZ: groundAt(land[0], land[1]), arrive: arrive + rnd() * 3, leave: l0 + rnd() * (l1 - l0), day: rnd() < (C.day_ashore_share || 0), lane: (rnd() - 0.5) * 6,
          state: 'sea', x: land[0], y: land[1], z: 0, h: 0, phase: rnd() * 6.28, call: 5 + rnd() * 40 });
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const WALK = 0.35, SWIM = 1.6; // m/s, in the game's real-time seconds (people walk in real time too)
    const toward = (b, x, y, z, v, dt) => {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy), s = Math.min(d, v * dt);
      if (d > 1e-3) { b.x += dx / d * s; b.y += dy / d * s; b.h = Math.atan2(dx, dy); }
      b.z += (z - b.z) * (d > 1e-3 ? s / d : 1);
      return d - s < 0.05;
    };
    // where a bird out at sea waits: off its landing place, along the seaward bearing
    const offshore = (b, metres) => { const r = b.land[2] * Math.PI / 180; return [b.land[0] + Math.sin(r) * metres + Math.cos(r) * b.lane, b.land[1] + Math.cos(r) * metres - Math.sin(r) * b.lane]; };
    let ashore = 0, lastT = null;
    // tod: {min, sunset, sunrise} in local minutes; dt: real seconds; dark: 0 by day .. 1 at night
    function update(dt, tod, px, py, dark = 0) {
      mat.emissiveIntensity = 0.3 * dark;
      // minutes since sunset, running through midnight; daytime is negative (minutes until sunset)
      const night = tod.sunrise + 1440 - tod.sunset;
      let t = tod.min >= tod.sunset ? tod.min - tod.sunset : tod.min < tod.sunrise ? tod.min + 1440 - tod.sunset : tod.min - tod.sunset;
      if (tod.sunset == null) t = -1e9; // no night (polar summer)
      // the clock jumped (skipped ahead, or set by the player) rather than ran: more than a few
      // minutes in one step, which even 120x does not do at 10 frames a second
      const jumped = lastT === null || Math.abs(t - lastT) > 3;
      lastT = t;
      ashore = 0;
      for (let i = 0; i < n; i++) {
        const b = B[i], bz = b.burrow[2], leaveAt = night - b.leave;
        let want = 'sea';
        if (b.day && (t < 0 || t > leaveAt)) want = 'home';
        else if (t >= b.arrive - 25 && t < b.arrive) want = 'raft';
        else if (t >= b.arrive && t < leaveAt) want = 'ashore';
        else if (t >= leaveAt && t < leaveAt + 20) want = 'out';
        // after a jump, put the bird where it would be by now
        if (jumped && want === 'ashore' && b.state !== 'home' && t - b.arrive > 8) { b.state = 'home'; [b.x, b.y, b.z] = b.burrow; }
        if (want === 'home') { if (b.state !== 'home') { b.state = 'home'; [b.x, b.y, b.z] = b.burrow; } }
        else if (want === 'sea') b.state = 'sea';
        else if (want === 'raft') {
          const [ox, oy] = offshore(b, 12 + 7 * (b.arrive - t));
          if (b.state !== 'raft') { b.state = 'raft'; b.x = ox; b.y = oy; b.z = -0.06; }
          toward(b, ox, oy, -0.06, SWIM, dt);
        } else if (want === 'ashore') {
          if (b.state === 'raft' || b.state === 'sea') {
            // straight in from the sea (the clock jumped): a few metres out, each in its own lane
            if (b.state === 'sea') { [b.x, b.y] = offshore(b, 5); b.z = -0.06; }
            else if (Math.hypot(b.x - b.land[0], b.y - b.land[1]) > 40) { [b.x, b.y] = offshore(b, 12); b.z = -0.06; }
            b.state = 'land';
          }
          if (b.state === 'land' && toward(b, b.land[0], b.land[1], b.landZ, SWIM, dt)) b.state = 'walk'; // out of the water at the rocks' edge
          if (b.state === 'walk' && toward(b, b.burrow[0], b.burrow[1], bz, WALK, dt)) b.state = 'home';
          if (b.state === 'walk' && ground) b.z = Math.max(b.z, groundAt(b.x, b.y)); // over the rocks, not through them
        } else if (want === 'out') {
          if (b.state === 'home' || b.state === 'walk') b.state = 'leaving';
          if (b.state === 'leaving' && toward(b, b.land[0], b.land[1], b.landZ, WALK, dt)) b.state = 'gone';
          if (b.state === 'leaving' && ground) b.z = Math.max(b.z, groundAt(b.x, b.y));
          if (b.state === 'gone') { const [ox, oy] = offshore(b, 200); toward(b, ox, oy, -0.06, SWIM, dt); }
        }
        // draw: hidden at sea; swimming low in the water; upright on the rocks, waddling when on the move
        if (b.state === 'sea') { mesh.setMatrixAt(i, zero); continue; }
        const swim = b.state === 'raft' || b.state === 'land' || b.state === 'gone', moving = b.state === 'walk' || b.state === 'leaving';
        if (!swim) ashore++;
        b.phase += dt * (moving ? 9 : 1.3);
        e.set(swim ? 1.25 : 0, Math.PI - b.h, moving ? Math.sin(b.phase) * 0.22 : Math.sin(b.phase) * 0.04, 'YXZ');
        q.setFromEuler(e);
        m4.compose(W(b.x, b.y, b.z + (moving ? Math.abs(Math.cos(b.phase)) * 0.02 : 0)), q, one);
        mesh.setMatrixAt(i, m4);
        // a few call through the night; you hear the ones near you
        if (!swim && audio && (b.call -= dt) < 0) {
          b.call = 20 + rnd() * 60;
          const d = Math.hypot(b.x - px, b.y - py);
          if (d < 70) audio.penguin(1 - d / 70);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    // birds ashore within r of (x, y)
    function near(x, y, r) { let c = 0; for (const b of B) if (b.state !== 'sea' && b.state !== 'raft' && b.state !== 'gone' && b.state !== 'land' && Math.hypot(b.x - x, b.y - y) < r) c++; return c; }
    return { mesh, birds: B, update, near, get ashore() { return ashore; }, colony: C };
  }
  return { create };
})();
