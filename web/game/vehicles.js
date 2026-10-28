// The helicopter and the ferries.
//
// Helicopter: an assisted flight model, as in Sketchbook. The rotor cancels gravity,
// so it hovers with no input; it levels itself; horizontal speed decays with drag. It
// can't lift off until the rotor has spooled up, it lands wherever the ground below
// is reached gently, and it collides with buildings and with the landmark solids. It
// can fly under the Harbour Bridge deck but not through its steel.
//
// Ferries: double-ended, like Sydney's, so they reverse at the end of a route without
// turning. They follow the routes in game.json (found through open water by the
// pipeline), slow down into each wharf and wait there. A rider can take the helm for
// the last stretch into a wharf and dock by hand.
'use strict';
window.OEVehicles = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: 0.55, metalness: 0.1 }, o));
  const mesh = (geo, m, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); k.castShadow = true; k.receiveShadow = true; return k; };
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // ------------------------------------------------------------ helicopter
  function helicopter(world, nav, pad) {
    const g = new THREE.Group(), red = mat('#c62d2a'), white = mat('#f2f0ea'), dark = mat('#20262b', { roughness: 0.4 }),
      glass = mat('#1d2a33', { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.75 });
    // model axes: +z forward (nose), +y up; origin at the bottom of the skids
    g.add(mesh(new THREE.BoxGeometry(1.9, 1.7, 3.4), red, 0, 1.55, 0.2));
    const nose = mesh(new THREE.SphereGeometry(1, 16, 12), glass, 0, 1.6, 1.85);
    nose.scale.set(0.95, 0.85, 1.05);
    g.add(nose);
    g.add(mesh(new THREE.BoxGeometry(1.92, 0.25, 3.0), white, 0, 1.05, 0.1));
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.7, 2.0), red, 0, 2.5, -0.4));
    const boom = mesh(new THREE.CylinderGeometry(0.22, 0.38, 5.4, 10), red, 0, 1.9, -4.0);
    boom.rotation.x = Math.PI / 2;
    g.add(boom);
    g.add(mesh(new THREE.BoxGeometry(0.12, 1.5, 0.9), white, 0, 2.5, -6.5));
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.1, 0.6), white, 0, 1.95, -5.9));
    for (const sx of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 4.2), dark, sx * 1.1, 0.06, 0.2));
      for (const sz of [-0.8, 1.1]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), dark, sx * 1.0, 0.45, sz));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8), dark, 0, 3.1, 0));
    const rotor = new THREE.Group();
    rotor.position.set(0, 3.42, 0);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const b = mesh(new THREE.BoxGeometry(0.3, 0.05, 5.2), dark, 0, 0, 2.6); const p = new THREE.Group(); p.rotation.y = a; p.add(b); rotor.add(p); }
    const blur = new THREE.Mesh(new THREE.CircleGeometry(5.3, 40), new THREE.MeshBasicMaterial({ color: 0x20262b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.x = -Math.PI / 2;
    rotor.add(blur);
    g.add(rotor);
    const tail = new THREE.Group();
    tail.position.set(0.12, 2.6, -6.6);
    for (const a of [0, Math.PI / 2]) { const b = mesh(new THREE.BoxGeometry(0.04, 1.4, 0.15), dark); b.rotation.x = a; tail.add(b); }
    g.add(tail);
    const seat = new THREE.Vector3(0.45, 0.9, 0.6), door = { x: 1.8, y: 0.3 }; // pilot seat (model) and door (local x right, y forward)
    world.add(g);

    const st = { x: pad[0], y: pad[1], z: pad[2], h: 0.6, vx: 0, vy: 0, vz: 0, yawRate: 0, pitch: 0, roll: 0, rotor: 0, on: false, landed: true,
      speed: 0, under: null, side: 0 };
    // near the main span: position across the deck (v) and the deck height on the axis
    const deckBottomAt = (x, y) => {
      for (const s of nav.strips) {
        if (!s.fly_under) continue;
        const [u, v] = nav.stripUV(s, x, y);
        if (Math.abs(u) < 240 && Math.abs(v) < 250) return { u, v, s, z: nav.stripHeight(s, s.origin[0] + s.axis[0] * u, s.origin[1] + s.axis[1] * u) };
      }
      return null;
    };
    function update(dt, inp, events) {
      const spool = st.on ? 1 : 0;
      st.rotor += (spool - st.rotor) * Math.min(1, dt / 1.2);
      const ready = st.rotor > 0.9;
      // controls: forward thrust along the heading, yaw, climb; the assists do the rest
      const fwd = st.on ? (inp.fwd || 0) : 0, turn = st.on ? (inp.turn || 0) : 0, lift = st.on && ready ? (inp.lift || 0) : 0;
      const hx = Math.sin(st.h), hy = Math.cos(st.h);
      const accel = 15, drag = 0.3;
      st.vx += (hx * fwd * accel - st.vx * drag) * dt;
      st.vy += (hy * fwd * accel - st.vy * drag) * dt;
      if (st.landed && lift <= 0) { st.vx *= 0.8; st.vy *= 0.8; }
      st.yawRate += (turn * 1.3 - st.yawRate) * Math.min(1, dt * 4);
      if (!st.landed || lift > 0) st.h += st.yawRate * dt;
      const vzTarget = lift * 8;
      st.vz += (vzTarget - st.vz) * Math.min(1, dt * 3);
      if (!st.on && !st.landed) st.vz -= 6 * dt; // no power: settle
      let nx = st.x + st.vx * dt, ny = st.y + st.vy * dt, nz = Math.min(900, st.z + st.vz * dt);
      if (!nav.free(nx, ny, st.z + 0.3, st.z + 3.6, 3.2)) { // sideways into something
        const hard = Math.hypot(st.vx, st.vy) > 12;
        nx = st.x; ny = st.y; st.vx *= -0.3; st.vy *= -0.3;
        if (hard) events.push({ type: 'bump' });
      }
      if (nz > st.z && !nav.free(nx, ny, nz + 0.3, nz + 3.6, 3.2)) { nz = st.z; st.vz = Math.min(0, st.vz); } // up into something
      const floor = nav.groundBelow(nx, ny, nz);
      if (nz <= floor + 0.02) {
        nz = floor;
        if (st.vz < 0) st.vz = 0;
        st.landed = true;
      } else st.landed = false;
      // under the bridge: a crossing from one side of the deck to the other while below it
      const d = deckBottomAt(nx, ny);
      if (d && d.z != null) {
        const below = nz + 3.8 < d.z - 3.0;
        if (Math.abs(d.v) > d.s.half_width + 4) {
          const side = Math.sign(d.v);
          if (st.under && st.under.side !== side && st.under.ok) events.push({ type: 'under_bridge', name: d.s.label || d.s.name });
          st.under = { side, ok: true };
        } else if (st.under && !below) st.under.ok = false;
      } else st.under = null;
      st.x = nx; st.y = ny; st.z = nz;
      st.speed = Math.hypot(st.vx, st.vy);
      // visual attitude: nose down when accelerating forward, bank into turns
      const along = st.vx * hx + st.vy * hy;
      st.pitch += ((st.landed ? 0 : Math.max(-0.35, Math.min(0.35, fwd * 0.22 + along * 0.002))) - st.pitch) * Math.min(1, dt * 3);
      st.roll += ((st.landed ? 0 : -st.yawRate * 0.18 * Math.min(1, st.speed / 10)) - st.roll) * Math.min(1, dt * 3);
      g.position.copy(W(st.x, st.y, st.z));
      g.rotation.set(0, 0, 0);
      g.rotateY(Math.PI - st.h);
      g.rotateX(st.pitch);
      g.rotateZ(st.roll);
      rotor.rotation.y += st.rotor * dt * 42;
      tail.rotation.x += st.rotor * dt * 60;
      blur.material.opacity = st.rotor * 0.22;
      for (const b of rotor.children) if (b !== blur) b.visible = st.rotor < 0.6 || Math.random() < 0.5;
    }
    // the door in local coordinates, for walking up to it
    const doorAt = () => {
      const c = Math.cos(st.h), s = Math.sin(st.h);
      return { x: st.x + door.x * c + door.y * s, y: st.y - door.x * s + door.y * c };
    };
    return { group: g, st, seat, update, doorAt };
  }

  // ------------------------------------------------------------ ferries
  function ferryModel() {
    const g = new THREE.Group(), green = mat('#1e5b3a', { roughness: 0.6 }), cream = mat('#efe6cc'), gold = mat('#e2b22b'),
      dark = mat('#1b2328', { roughness: 0.2, metalness: 0.4 }), deck = mat('#7d6a52', { roughness: 0.9 }), red = mat('#a8322a');
    // 36 m long, 10 m beam, symmetric fore and aft; origin at the waterline, +z one end
    const hull = new THREE.Shape();
    hull.moveTo(-5, -18); hull.quadraticCurveTo(0, -20.5, 5, -18); hull.lineTo(5, 18); hull.quadraticCurveTo(0, 20.5, -5, 18); hull.closePath();
    const hg = new THREE.ExtrudeGeometry(hull, { depth: 2.4, bevelEnabled: false });
    hg.rotateX(-Math.PI / 2);
    hg.translate(0, -0.8, 0);
    g.add(mesh(hg, green));
    g.add(mesh(new THREE.BoxGeometry(10.12, 0.22, 33.5), gold, 0, 1.2, 0)); // gold band along the hull
    const dg = new THREE.ExtrudeGeometry(hull, { depth: 0.1, bevelEnabled: false });
    dg.rotateX(-Math.PI / 2); dg.translate(0, 1.6, 0);
    g.add(mesh(dg, deck));
    g.add(mesh(new THREE.BoxGeometry(8.6, 2.4, 22), cream, 0, 2.9, 0));
    g.add(mesh(new THREE.BoxGeometry(8.62, 0.9, 21.8), dark, 0, 3.1, 0));
    g.add(mesh(new THREE.BoxGeometry(8.0, 0.25, 26), cream, 0, 4.2, 0));
    for (const sz of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(4.2, 1.8, 3.2), cream, 0, 5.2, sz * 9.5));
      g.add(mesh(new THREE.BoxGeometry(4.25, 0.7, 3.25), dark, 0, 5.45, sz * 9.5));
      g.add(mesh(new THREE.BoxGeometry(4.6, 0.15, 3.6), gold, 0, 6.15, sz * 9.5));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 6), dark, 0, 6.5, 0));
    const flag = mesh(new THREE.BoxGeometry(0.04, 0.7, 1.1), red, 0, 8.3, 0.55);
    g.add(flag);
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 25), cream, sx * 3.95, 4.75, 0));
    return { g, flag };
  }

  let foam = null; // made on first use (three.js may load after this file)
  const foamTex = () => foam || (foam = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 260; i++) {
      const y = Math.random() * 256, x = 32 + (Math.random() - 0.5) * (8 + y * 0.22), a = (1 - y / 256) * 0.55;
      g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 1 + Math.random() * 2.5, 2 + Math.random() * 7);
    }
    return new THREE.CanvasTexture(c);
  })());
  function wake() {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; // a fan: 9 m wide at the stern, 46 m wide 80 m back
    for (let i = 0; i < p.count; i++) { const back = p.getZ(i) > 0; p.setX(i, p.getX(i) * (back ? 46 : 9)); p.setZ(i, back ? 98 : 18); }
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, p.getZ(i) > 50 ? 0 : 1);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: foamTex(), transparent: true, depthWrite: false, opacity: 0 }));
    m.position.y = 0.06;
    m.renderOrder = 1;
    return m;
  }
  function ferries(world, G, nav, makeLabel) {
    const speed = G.ferry_speed_ms || 9, dwell = G.ferry_dwell_s || 20, A = 0.55;
    const wharf = id => G.wharves.find(w => w.id === id);
    const vessels = [];
    const legPoint = (leg, rev, s, out) => {
      const d = rev ? leg.len - s : s, p = leg.p, c = leg.cum;
      let i = 1;
      while (i < p.length - 1 && c[i] < d) i++;
      const t = (d - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1]);
      out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t; out.y = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
      const hx = (p[i][0] - p[i - 1][0]) * (rev ? -1 : 1), hy = (p[i][1] - p[i - 1][1]) * (rev ? -1 : 1);
      out.h = Math.atan2(hx, hy);
      return out;
    };
    const tmp = {};
    for (const r of G.ferries || []) {
      // the route as a sequence of legs, out and back
      const legs = r.legs.map(l => {
        const p = l.path, cum = [0];
        for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
        return { from: l.from, to: l.to, p, cum, len: cum[cum.length - 1] };
      });
      const cycle = [];
      for (const l of legs) cycle.push({ leg: l, rev: false });
      for (let i = legs.length - 1; i >= 0; i--) cycle.push({ leg: legs[i], rev: true });
      r.vessels.forEach((name, k) => {
        const { g, flag } = ferryModel();
        world.add(g);
        const wk = wake();
        world.add(wk);
        const label = makeLabel ? makeLabel(name) : null;
        if (label) { label.position.set(0, 9.4, 0); g.add(label); }
        const v = { name, route: r.route, stops: r.stops, cycle, ci: Math.floor(k * cycle.length / r.vessels.length) % cycle.length, s: 0, phase: 'dwell',
          t: dwell * (0.3 + 0.7 * k / Math.max(1, r.vessels.length)), x: 0, y: 0, h: 0, speed: 0, g, flag, helm: null, wk, lx: null, ly: null, dir: 0 };
        place(v);
        vessels.push(v);
      });
    }
    function stopOf(v) { const c = v.cycle[v.ci]; return v.phase === 'dwell' ? (c.rev ? c.leg.to : c.leg.from) : null; }
    function nextStop(v) { const c = v.cycle[v.ci]; return v.phase === 'dwell' ? (c.rev ? c.leg.from : c.leg.to) : (c.rev ? c.leg.from : c.leg.to); }
    function place(v) {
      const c = v.cycle[v.ci];
      legPoint(c.leg, c.rev, v.phase === 'dwell' ? 0 : v.s, tmp);
      const manual = v.helm && v.helm.manual;
      if (!manual) { v.x = tmp.x; v.y = tmp.y; }
      let dh = angDiff(tmp.h, v.h);
      if (Math.abs(dh) > Math.PI / 2) dh = angDiff(tmp.h + Math.PI, v.h); // double-ended: either end can lead
      if (!manual) v.h += dh * (v.phase === 'dwell' ? 1 : 0.08);
    }
    function update(dt, scale, t, all = 1) {
      for (const v of vessels) {
        const c = v.cycle[v.ci], step = dt * all * (v.rider ? scale : 1);
        if (v.phase === 'dwell') {
          v.t -= step;
          v.speed = 0;
          if (v.t <= 0) { v.phase = 'sail'; v.s = 0; v.events = (v.events || []).concat([{ type: 'depart', v }]); }
        } else if (v.helm && v.helm.manual) {
          helmStep(v, dt);
        } else {
          const left = c.leg.len - v.s;
          const target = Math.min(speed, Math.sqrt(2 * A * Math.max(0, left)) + 0.6, Math.sqrt(2 * A * v.s) + 1.5);
          v.speed += Math.max(-A * 2 * step, Math.min(A * step, target - v.speed));
          v.s += v.speed * step;
          if (v.helm && left < 160 && !v.helm.manual) { v.helm.manual = true; v.helm.t0 = t; v.events = (v.events || []).concat([{ type: 'helm', v }]); }
          if (v.s >= c.leg.len) arrive(v);
        }
        if (!(v.helm && v.helm.manual)) place(v);
        v.g.position.copy(W(v.x, v.y, Math.sin(t * 0.9 + v.x) * 0.06));
        v.g.rotation.set(Math.sin(t * 0.7 + v.y) * 0.012, Math.PI - v.h, Math.sin(t * 0.8) * 0.015);
        v.flag.rotation.y = Math.sin(t * 3 + v.x) * 0.3;
        // the wake trails behind whichever way she is moving
        if (v.lx != null && dt > 0) { const mx = v.x - v.lx, my = v.y - v.ly; if (Math.hypot(mx, my) > 1e-3) v.dir = Math.atan2(mx, my); }
        v.lx = v.x; v.ly = v.y;
        v.wk.position.set(v.x, 0.06, -v.y);
        v.wk.rotation.y = Math.PI - v.dir + Math.PI;
        v.wk.material.opacity += (Math.min(0.85, Math.abs(v.speed) / 7) - v.wk.material.opacity) * Math.min(1, dt * 2);
      }
    }
    function arrive(v) {
      const c = v.cycle[v.ci];
      v.ci = (v.ci + 1) % v.cycle.length;
      v.phase = 'dwell'; v.t = dwell; v.s = 0; v.speed = 0;
      v.helm = v.helm ? Object.assign(v.helm, { manual: false }) : null;
      v.events = (v.events || []).concat([{ type: 'arrive', v, at: c.rev ? c.leg.from : c.leg.to }]);
    }
    // manual docking: W/S throttle, A/D rudder; made fast within 8 m of the berth, under 1.2 m/s
    function helmStep(v, dt) {
      const c = v.cycle[v.ci], berth = wharf(c.rev ? c.leg.from : c.leg.to).berth, inp = v.helm.input || {};
      v.helm.throttle = Math.max(-0.3, Math.min(1, (v.helm.throttle ?? 0.5) + (inp.fwd || 0) * dt * 0.6));
      const target = v.helm.throttle * 6;
      v.speed += (target - v.speed) * Math.min(1, dt * 0.5);
      v.h += (inp.turn || 0) * dt * 0.25 * Math.min(1, Math.abs(v.speed) / 2 + 0.2);
      const nx = v.x + Math.sin(v.h) * v.speed * dt, ny = v.y + Math.cos(v.h) * v.speed * dt;
      const ends = [[Math.sin(v.h) * 16, Math.cos(v.h) * 16], [-Math.sin(v.h) * 16, -Math.cos(v.h) * 16]];
      if (ends.every(([ex, ey]) => nav.isWater(nx + ex, ny + ey))) { v.x = nx; v.y = ny; }
      else { v.speed = 0; v.helm.throttle = 0; v.events = (v.events || []).concat([{ type: 'scrape', v }]); }
      const d = Math.hypot(berth[0] - v.x, berth[1] - v.y);
      v.helm.dist = d;
      if (d < 8 && Math.abs(v.speed) < 1.2) {
        v.events = (v.events || []).concat([{ type: 'docked', v, score: Math.round(100 - d * 6 - Math.abs(v.speed) * 20) }]);
        v.x = berth[0]; v.y = berth[1];
        v.helm = null;
        arrive(v);
      }
    }
    // seconds until a vessel is next at a wharf, ready to board (0 if it is there now)
    function eta(v, id) {
      if (v.phase === 'dwell' && stopOf(v) === id) return 0;
      let ci = v.ci;
      let t = v.phase === 'dwell' ? v.t + v.cycle[ci].leg.len / speed + 4 : (v.cycle[ci].leg.len - v.s) / speed + 2;
      for (let k = 0; k < v.cycle.length; k++) {
        const c = v.cycle[ci];
        if ((c.rev ? c.leg.from : c.leg.to) === id) return t;
        ci = (ci + 1) % v.cycle.length;
        t += dwell + v.cycle[ci].leg.len / speed + 4;
      }
      return Infinity;
    }
    // the deckhand takes over: dock at once
    function finishHelm(v) { if (v.helm) { v.helm = null; v.x = tmp.x; v.y = tmp.y; arrive(v); place(v); } }
    return { vessels, update, eta, stopOf, nextStop, wharf, finishHelm };
  }

  return { helicopter, ferries };
})();
