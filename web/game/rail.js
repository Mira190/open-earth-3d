// Rail for the game: street trams and a funicular, on the lines game.json "rail" carries from
// OpenStreetMap (pipeline/game_data.py). Hong Kong has both: the double-deck "ding ding" trams
// along the north shore of the island, and the Peak Tram up the hill. Each kind is optional and
// takes its dimensions and livery from the city's config (game.rail.<kind>).
//
//   tram       double-deck cars on every tram line, running with traffic on the left or the
//              right (`keep`), stopping every `stop_every_m` and for anyone on the track ahead,
//              ringing their bell as they pull away
//   funicular  two cars on one cable: as one climbs the other comes down, and they pass at the
//              middle of the line. The player can ride one, from end to end.
'use strict';
window.OERail = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  // a polyline in decimetres [x, y, z, ...] -> { pts, s (cumulative metres), L, at(s) }
  function line(p) {
    const pts = [];
    for (let k = 0; k < p.length; k += 3) pts.push([p[k] / 10, p[k + 1] / 10, p[k + 2] / 10]);
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const L = s[s.length - 1];
    function at(d) { // position, heading (radians from north, clockwise) and grade at distance d
      d = Math.max(0, Math.min(L, d));
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
      const a = pts[lo], b = pts[hi], t = (d - s[lo]) / Math.max(1e-6, s[hi] - s[lo]);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], run = Math.hypot(dx, dy);
      return { x: a[0] + dx * t, y: a[1] + dy * t, z: a[2] + dz * t, h: Math.atan2(dx, dy), pitch: Math.atan2(dz, run) };
    }
    return { pts, s, L, at };
  }

  // ------------------------------------------------------------ models (model frame: +z forward, +y up, +x to the left)
  function tramModel(o, livery) {
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = o.length_m || 12, Bw = o.width_m || 2.3, Hh = o.height_m || 4.4;
    const paint = new THREE.MeshStandardMaterial({ color: lin(livery), roughness: 0.45 });
    const cream = M.cream, d1 = 0.55, deck = 2.15; // floor above the rail, lower deck height
    kit.add(M.dark, K.box(Bw * 0.8, 0.5, L * 0.86, 0, 0.3, 0)); // bogies and skirt
    kit.add(paint, K.box(Bw, 1.0, L, 0, d1 + 0.5, 0)); // lower panels
    kit.add(paint, K.box(Bw, 0.55, L, 0, d1 + deck + 0.25, 0)); // between the decks
    kit.add(paint, K.box(Bw, 0.35, L, 0, Hh - 0.55, 0)); // upper rail
    kit.add(cream, K.box(Bw * 0.96, 0.18, L * 0.98, 0, Hh - 0.28, 0)); // roof
    kit.add(paint, K.box(Bw * 0.8, 0.12, L * 0.9, 0, Hh - 0.12, 0));
    for (const [y0, h] of [[d1 + 1.0, deck - 1.0 - 0.1], [d1 + deck + 0.5, Hh - 0.7 - (d1 + deck + 0.5)]]) { // window bands, both decks
      kit.add(M.glass, K.box(Bw * 0.99, h, L * 0.97, 0, y0 + h / 2, 0));
      for (let z = -L / 2 + 0.6; z <= L / 2 - 0.5; z += 1.1) kit.add(paint, K.box(Bw * 1.005, h, 0.12, 0, y0 + h / 2, z)); // pillars
    }
    for (const s of [-1, 1]) { // ends: a dash, the destination box and the trolley pole's base
      kit.add(paint, K.box(Bw * 0.96, 1.1, 0.2, 0, d1 + 0.55, s * (L / 2 + 0.08)));
      kit.add(M.black, K.box(1.1, 0.32, 0.06, 0, d1 + deck + 0.25, s * (L / 2 + 0.03)));
      K.lamp(g, s > 0 ? '#fff4d6' : '#ff3b2f', 0, d1 + 0.75, s * (L / 2 + 0.2), 0.7);
    }
    kit.add(M.dark, K.rod([0, Hh, -1.5], [0, Hh + 2.0, -5.4], 0.035)); // trolley pole to the overhead wire
    kit.build(g);
    return g;
  }

  function funicularModel(o) {
    // a car on a slope: its floor is stepped, and the body is built level along its length and
    // pitched with the line, so the car looks level-bodied on the grade like the real ones
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = o.length_m || 28, Bw = o.width_m || 2.8, Hh = o.height_m || 3.3;
    const paint = new THREE.MeshStandardMaterial({ color: lin(o.livery || '#7a1f1f'), roughness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: lin(o.trim || '#e8dcc0'), roughness: 0.5 });
    kit.add(M.dark, K.box(Bw * 0.7, 0.5, L * 0.9, 0, 0.25, 0));
    kit.add(paint, K.box(Bw, 0.9, L, 0, 0.95, 0));
    kit.add(M.glass, K.box(Bw * 0.99, 1.35, L * 0.97, 0, 2.08, 0));
    for (let z = -L / 2 + 0.7; z <= L / 2 - 0.6; z += 1.6) kit.add(paint, K.box(Bw * 1.005, 1.35, 0.14, 0, 2.08, z));
    kit.add(trim, K.box(Bw, 0.12, L, 0, 1.45, 0));
    kit.add(paint, K.box(Bw, 0.4, L, 0, Hh - 0.35, 0));
    kit.add(trim, K.box(Bw * 0.94, 0.14, L * 0.98, 0, Hh - 0.08, 0));
    for (const s of [-1, 1]) kit.add(paint, K.box(Bw, Hh - 0.5, 0.18, 0, (Hh - 0.5) / 2 + 0.4, s * L / 2));
    K.lamp(g, '#fff4d6', 0, 1.2, L / 2 + 0.2, 0.8);
    K.lamp(g, '#fff4d6', 0, 1.2, -L / 2 - 0.2, 0.8);
    kit.build(g);
    return g;
  }

  // the track: two rails on sleepers along a line, merged into one mesh per material
  function trackMesh(ln, gauge, lift, mat, every = 1) {
    const pos = [], idx = [];
    const add = (a, b, w, h) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2, n = pos.length / 3;
      for (const [p, z] of [[a, a[2]], [b, b[2]]]) {
        pos.push(p[0] + nx, p[1] + ny, z + h, p[0] - nx, p[1] - ny, z + h);
      }
      idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    };
    const P = ln.pts;
    for (let i = 0; i + every < P.length; i += every) {
      const a = P[i], b = P[i + every], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      for (const side of [-1, 1]) {
        const ox = -dy / l * side * gauge / 2, oy = dx / l * side * gauge / 2;
        add([a[0] + ox, a[1] + oy, a[2]], [b[0] + ox, b[1] + oy, b[2]], 0.09, lift);
      }
    }
    const g = new THREE.BufferGeometry();
    const v = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { v[i] = pos[i]; v[i + 1] = pos[i + 2]; v[i + 2] = -pos[i + 1]; }
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  const bell = () => { if (window.OEAudio && OEAudio.bell) OEAudio.bell(); };

  function create(world, G, opts = {}) {
    const R = G.rail || {}, out = { trams: [], cars: [], stations: [], events: [] };
    const steel = new THREE.MeshStandardMaterial({ color: lin('#8a8f92'), roughness: 0.35, metalness: 0.7 });

    // ---------------------------------------------------------- trams
    if (R.tram && R.tram.lines.length) {
      const T = R.tram, lines = T.lines.map(l => line(l.p));
      const keepLeft = (T.keep || 'left') === 'left';
      // the direction each track runs: with a parallel track beside it, the side of the road
      // traffic keeps to; a single track runs both ways
      const dirs = lines.map((ln, i) => {
        let best = null, bd = 40;
        const mid = ln.at(ln.L / 2);
        lines.forEach((o, j) => {
          if (j === i) return;
          for (let k = 0; k < o.pts.length; k += 2) { const d = Math.hypot(o.pts[k][0] - mid.x, o.pts[k][1] - mid.y); if (d < bd) { bd = d; best = o.pts[k]; } }
        });
        if (!best) return 0;
        const cross = Math.sin(mid.h) * (best[1] - mid.y) - Math.cos(mid.h) * (best[0] - mid.x); // > 0: the other track is on our left
        return (cross < 0) === keepLeft ? 1 : -1;
      });
      lines.forEach(ln => world.add(trackMesh(ln, T.gauge_m || 1.067, 0.04, steel)));
      const liveries = T.liveries || ['#0f6b3a'];
      const per = T.spacing_m || 260;
      lines.forEach((ln, i) => {
        const n = Math.max(1, Math.floor(ln.L / per));
        for (let k = 0; k < n; k++) {
          const dir = dirs[i] || (k % 2 ? 1 : -1);
          const model = tramModel(T, liveries[(i * 7 + k * 3) % liveries.length]);
          world.add(model);
          out.trams.push({ ln, dir, d: (k + 0.5) * ln.L / n, v: 0, vmax: T.speed_ms || 5.5, wait: (k * 7) % 15, nextStop: 0, model });
        }
      });
    }

    // ---------------------------------------------------------- funicular
    if (R.funicular && R.funicular.lines.length) {
      const F = R.funicular, ln = line(F.lines[0].p);
      world.add(trackMesh(ln, F.gauge_m || 1.524, 0.25, steel));
      // sleepers and a concrete bed under the track
      const bedGeo = new THREE.BoxGeometry(1, 1, 1), bed = new THREE.InstancedMesh(bedGeo, new THREE.MeshStandardMaterial({ color: lin('#9c978c'), roughness: 0.9 }), Math.ceil(ln.L / 4) + 1);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
      let nb = 0;
      for (let s = 0; s <= ln.L; s += 4) {
        const p = ln.at(s);
        e.set(-p.pitch, Math.PI - p.h, 0, 'YXZ');
        m4.compose(W(p.x, p.y, p.z + 0.1), q.setFromEuler(e), sc.set(3.0, 0.3, 4.05));
        bed.setMatrixAt(nb++, m4);
      }
      bed.count = nb; bed.receiveShadow = true;
      world.add(bed);
      const ends = [{ id: F.stations?.[0]?.id || 'lower', name: F.stations?.[0]?.name || 'Lower terminus', d: 0 },
        { id: F.stations?.[1]?.id || 'upper', name: F.stations?.[1]?.name || 'Upper terminus', d: ln.L }];
      for (const st of ends) { const p = ln.at(st.d); out.stations.push(Object.assign(st, { x: p.x, y: p.y, z: p.z })); }
      const halfL = (F.length_m || 28) / 2, margin = halfL + 2;
      // two cars on one cable: car 0 starts at the bottom, car 1 at the top
      for (let k = 0; k < 2; k++) {
        const model = funicularModel(F);
        world.add(model);
        out.cars.push({ id: k, name: F.car_names ? F.car_names[k] : `Car ${k + 1}`, model, rider: false });
      }
      const cyc = { s: 0, phase: 'dwell', t: F.dwell_s || 40, dir: 1 }; // s: car 0's distance from its start
      const span = ln.L - 2 * margin, vmax = F.speed_ms || 6, acc = 0.6;
      out.funicular = { ln, cyc, span, margin, vmax };
      out.carAt = k => { // a car's distance along the line: car 0 from the bottom, car 1 mirrored
        const s0 = margin + cyc.s;
        return k === 0 ? s0 : ln.L - s0;
      };
      out.stationOf = k => { // the station a car is standing at, or null
        if (cyc.phase !== 'dwell') return null;
        const d = out.carAt(k);
        return out.stations.reduce((b, st) => (Math.abs(st.d - d) < margin + 3 ? st : b), null);
      };
      out.eta = () => (cyc.phase === 'dwell' ? cyc.t : Math.max(0, (span - (cyc.dir > 0 ? cyc.s : span - cyc.s)) / Math.max(1, vmax)) + (F.dwell_s || 40)); // until the next arrival at either end
      out.updateFunicular = (dt, skip) => {
        const steps = skip ? 8 : 1;
        for (let n = 0; n < steps; n++) {
          if (cyc.phase === 'dwell') {
            cyc.t -= dt;
            if (cyc.t <= 0) { cyc.phase = 'run'; cyc.v = 0; out.events.push({ type: 'depart' }); }
          } else {
            const left = cyc.dir > 0 ? span - cyc.s : cyc.s;
            const want = Math.min(vmax, Math.sqrt(2 * acc * Math.max(0, left)) + 0.2);
            cyc.v = Math.min(want, (cyc.v || 0) + acc * dt);
            cyc.s += cyc.dir * cyc.v * dt;
            if ((cyc.dir > 0 && cyc.s >= span) || (cyc.dir < 0 && cyc.s <= 0)) {
              cyc.s = cyc.dir > 0 ? span : 0; cyc.dir *= -1; cyc.phase = 'dwell'; cyc.t = F.dwell_s || 40; cyc.v = 0;
              out.events.push({ type: 'arrive' });
            }
          }
        }
        for (const c of out.cars) {
          const d = out.carAt(c.id), p = ln.at(d);
          if (c.id === 1 && F.passing_loop) { // the second car takes the loop's other track
            const [l0, l1, side] = F.passing_loop, ramp = Math.min(1, Math.max(0, Math.min(d - l0, l1 - d) / 25));
            const k = side * ramp * ramp * (3 - 2 * ramp);
            p.x += -Math.cos(p.h) * k; p.y += Math.sin(p.h) * k;
          }
          c.x = p.x; c.y = p.y; c.z = p.z; c.h = p.h; c.pitch = p.pitch;
          c.model.position.copy(W(p.x, p.y, p.z + 0.35));
          c.model.rotation.set(0, 0, 0);
          c.model.rotation.order = 'YXZ';
          c.model.rotation.y = Math.PI - p.h;
          c.model.rotation.x = -p.pitch;
          c.speed = cyc.phase === 'run' ? cyc.v : 0;
        }
      };
      out.updateFunicular(0, false);
    }

    // ---------------------------------------------------------- per frame
    out.update = (dt, clockT, people, skip) => {
      for (const t of out.trams) {
        // stop for anyone standing on the track within 14 m ahead
        const ahead = t.ln.at(t.d + t.dir * 8);
        let blocked = false;
        for (const p of people) if (p && Math.hypot(p.x - ahead.x, p.y - ahead.y) < 4.5 && Math.abs((p.z || 0) - ahead.z) < 3) blocked = true;
        if (t.wait > 0) {
          t.wait -= dt; t.v = 0;
          if (t.wait <= 0 && people[0] && Math.hypot(people[0].x - t.x, people[0].y - t.y) < 70) bell();
        } else {
          const vmax = blocked ? 0 : t.vmax;
          t.v += Math.max(-2.5 * dt, Math.min(0.9 * dt, vmax - t.v));
          t.d += t.dir * t.v * dt;
          t.nextStop -= t.v * dt;
          if (t.nextStop <= 0 && !blocked) { t.wait = 12 + (t.d % 7); t.nextStop = (G.rail.tram.stop_every_m || 250); }
          if (t.d > t.ln.L || t.d < 0) { t.dir *= -1; t.d = Math.max(0, Math.min(t.ln.L, t.d)); t.wait = 25; } // the end of the line: change ends
        }
        const p = t.ln.at(t.d);
        t.x = p.x; t.y = p.y; t.z = p.z;
        t.model.position.copy(W(p.x, p.y, p.z));
        t.model.rotation.y = Math.PI - p.h + (t.dir < 0 ? Math.PI : 0);
      }
      if (out.updateFunicular) out.updateFunicular(dt, skip);
    };
    return out;
  }

  return { create, line };
})();
