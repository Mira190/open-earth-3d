// A taxi ride, frame by frame, headless, and the traffic round it: hail a taxi at the start (or
// at AT=x,y), get in and go somewhere (the first destination offered whose name holds DEST, else
// the first), and for every frame of the trip measure
//   - how far the taxi, and every car of the traffic, is into anything standing in the street: a
//     viaduct's column (decks.js), a signal pole or a walk-signal post (junctions.js), a lamp post
//     or a tree trunk (the posts)
//   - how smoothly the taxi rides: its vertical acceleration over 4 m/s² (a bump in the road),
//     its speed along its track changing by over 15 m/s² in a frame (a lurch back and forth),
//     its heading turning faster than a car can steer, and its track going back or stalling
//     while it is under way (a judder)
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/ride_probe.js shibuya [seconds=120] [DEST]
// Exits 1 if any car goes 5 cm into anything, or the taxi bumps, lurches, judders or snaps round.
// SEED seeds Math.random (1); AT=x,y hails at another spot; DBG=f0,f1 logs the taxi frame by frame.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', secs = '120', dest = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 400)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(n => { window.requestAnimationFrame = () => 0; window.__dbgN = n; }, process.env.DBG ? process.env.DBG.split(',').map(Number) : null);
  const r = await p.evaluate(([secs, want, at]) => {
    const g = window.__game, out = { log: [], hits: {}, worst: {} }, nLog = {};
    const say = (kind, line) => { nLog[kind] = (nLog[kind] || 0) + 1; if (nLog[kind] <= (kind === 'snap' ? 60 : 12)) out.log.push(line); };
    g.advance(2);
    if (at) { g.player.x = at[0]; g.player.y = at[1]; }
    // to the kerb of the nearest street
    const pl = g.roads.place(g.player.x, g.player.y, 80, g.KEEP === 'left' ? 1 : -1);
    if (pl) { g.player.x = pl.x; g.player.y = pl.y; g.player.z = pl.z; }
    g.advance(0.5);
    // everything standing in the streets: boxes {x, y, z0, z1, hx (along ex, ey), hy}
    const obs = [];
    for (const run of g.deckPlan.runs) for (const c of run.cols || []) obs.push(Object.assign({ kind: 'column' }, c));
    const H = g.junctions.heads;
    const circle = (kind, x, y, z, r, h) => obs.push({ kind, x, y, z0: z, z1: z + h, hx: r, hy: r, ex: 1, ey: 0 });
    for (const o of (H && H.list) || []) circle('signal pole', o.x, o.y, o.z, 0.085, o.mast ? 6 : 3.25);
    for (const o of (H && H.peds) || []) circle('walk post', o.x, o.y, o.z, 0.06, 2.55);
    for (const o of g.posts.list) if (o.kind !== 'signal' && o.kind !== 'column') circle(o.kind || 'post', o.x, o.y, o.z, o.r, 4);
    out.obstacles = obs.reduce((m, o) => (m[o.kind] = (m[o.kind] || 0) + 1, m), {});
    const GC = 16, grid = new Map(), key = (x, y) => `${Math.floor(x / GC)},${Math.floor(y / GC)}`;
    for (const o of obs) {
      const R = Math.hypot(o.hx, o.hy);
      for (let cx = Math.floor((o.x - R) / GC); cx <= Math.floor((o.x + R) / GC); cx++) for (let cy = Math.floor((o.y - R) / GC); cy <= Math.floor((o.y + R) / GC); cy++) {
        const k = `${cx},${cy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o);
      }
    }
    // how deep a car (centre x, y, heading h, half length, half width, z to z + top) is in an obstacle
    function deepest(x, y, h, half, hw, z, top) {
      let worst = 0, which = null;
      const fx = Math.sin(h), fy = Math.cos(h), seen = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get(key(x + dx * GC, y + dy * GC)) || []) {
        if (seen.has(o)) continue; seen.add(o);
        if (z + top < o.z0 + 0.15 || z + 0.25 > o.z1) continue; // (under it, or over it)
        const ax = [[o.ex, o.ey], [-o.ey, o.ex], [fx, fy], [-fy, fx]];
        const oo = [[o.ex, o.ey, o.hx], [-o.ey, o.ex, o.hy]], bb = [[fx, fy, half], [-fy, fx, hw]];
        let depth = Infinity;
        for (const [ux, uy] of ax) {
          const ra = oo.reduce((s, [vx, vy, e]) => s + Math.abs(vx * ux + vy * uy) * e, 0);
          const rb = bb.reduce((s, [vx, vy, e]) => s + Math.abs(vx * ux + vy * uy) * e, 0);
          depth = Math.min(depth, ra + rb - Math.abs((o.x - x) * ux + (o.y - y) * uy));
        }
        if (depth > worst) { worst = depth; which = o; }
      }
      return { worst, which };
    }
    const note = (who, t, x, y, d) => {
      const k = `${who} in a ${d.which.kind}`;
      out.hits[k] = (out.hits[k] || 0) + 1;
      if (!out.worst[k] || d.worst > out.worst[k].deep) out.worst[k] = { deep: +d.worst.toFixed(2), t: +t.toFixed(1), car: [+x.toFixed(1), +y.toFixed(1)], at: [+d.which.x.toFixed(1), +d.which.y.toFixed(1)] };
    };
    g.hail();
    const o = g.ride();
    if (!o) return { err: 'no taxi: ' + document.getElementById('g-toasts').textContent.slice(-200) };
    const dt = 1 / 30, C = o.C;
    // the traffic, every frame of the wait too
    const traffic = t => { for (const c of g.cars.C) if (c.line >= 0) { const d = deepest(c.x, c.y, c.h, c.half, c.hw || 0.9, c.z, c.top || 1.5); if (d.worst > 0.05) note('traffic', t, c.x, c.y, d); } };
    let t = 0;
    for (; t < 150 && o.phase === 'coming'; t += dt) {
      g.advance(dt); traffic(t);
      const st = o.drv.st, d = deepest(st.x, st.y, st.h, C.half, C.hw, st.z, C.top || 1.5);
      if (d.worst > 0.05) note('taxi (coming)', t, st.x, st.y, d);
    }
    if (o.phase !== 'waiting') return Object.assign(out, { err: `the taxi is ${o.phase}` });
    g.player.x = o.drv.st.x; g.player.y = o.drv.st.y; // (beside its door)
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    const names = [...document.querySelectorAll('#gd-choices button')].map(b => b.textContent);
    let k = names.findIndex(n => want && n.toLowerCase().includes(want.toLowerCase()));
    if (k < 0) k = 0;
    out.dest = names[k];
    g.dlg.choose(k);
    g.advance(0.1);
    { const P = o.drv.path; out.head = P.pts.slice(0, 8).map((q, i) => [+P.cum[i].toFixed(1), +q[0].toFixed(1), +q[1].toFixed(1)]); const R = o.drv.st.route; out.from = R.from && [R.from.line, +R.from.s.toFixed(1), R.from.dir, g.roadNet.L[R.from.line].len.toFixed(1), g.roadNet.L[R.from.line].ow]; out.nodes = (R.nodes || []).slice(0, 4).map(n => [n.k, n.line, n.end, g.roadNet.L[n.line].ow, g.roadNet.L[n.line].len.toFixed(1)]); }
    const zs = [], ss = [];
    let snaps = 0, bumps = 0, jerks = 0, bumpMax = 0, snapMax = 0, prevH = null, prevX = null, prevY = null, judders = 0, judderMax = 0;
    for (let i = 0; i < secs * 30 && o.phase === 'driving'; i++) {
      g.advance(dt); t += dt; traffic(t);
      const st = o.drv.st, d = deepest(st.x, st.y, st.h, C.half, C.hw, st.z, C.top || 1.5);
      if (d.worst > 0.05) note('taxi', t, st.x, st.y, d);
      zs.push(st.z); ss.push((ss.length ? ss[ss.length - 1] : 0) + (prevX != null ? Math.hypot(st.x - prevX, st.y - prevY) : 0)); // (the distance along its track)
      const n = zs.length;
      if (n >= 3) {
        // vertical acceleration (m/s²) over three frames: a car on its springs feels over 3 as a bump
        const az = (zs[n - 1] - 2 * zs[n - 2] + zs[n - 3]) / (dt * dt), ax = (ss[n - 1] - 2 * ss[n - 2] + ss[n - 3]) / (dt * dt);
        if (Math.abs(az) > 4) { bumps++; bumpMax = Math.max(bumpMax, Math.abs(az)); if (Math.abs(az) > 15) say('bump', `${o.drv.path.pts.map((q, j) => [o.drv.path.cum[j], q]).filter(([c]) => Math.abs(c - st.s) < 14).map(([c, q]) => `${c.toFixed(1)}:${q[2].toFixed(2)}/${g.nav.terrain(q[0], q[1]).toFixed(1)}`).join(' ')}\n  bump t=${t.toFixed(2)} s=${st.s.toFixed(1)} az=${az.toFixed(1)} m/s² v=${st.v.toFixed(1)} z=${st.z.toFixed(2)} ground ${g.nav.terrain(st.x, st.y).toFixed(2)} at (${st.x.toFixed(1)}, ${st.y.toFixed(1)})`); }
        if (Math.abs(ax) > 15) { jerks++; say('jerk', `jerk t=${t.toFixed(2)} ax=${ax.toFixed(1)} m/s² v=${st.v.toFixed(1)} ${st.why}`); }
      }
      if (prevH != null) {
        // the yaw rate a car can turn at: v / (wheelbase / tan(35°)), and never more than 1 rad/s
        const dh = Math.abs(Math.atan2(Math.sin(st.h - prevH), Math.cos(st.h - prevH))) / dt, can = Math.min(1.0, st.v / (C.wheelbase / Math.tan(0.6))) + 0.1;
        if (dh > can * 1.5) { snaps++; snapMax = Math.max(snapMax, dh); say('snap', `snap t=${t.toFixed(2)} yaw ${dh.toFixed(2)} rad/s (a car can ${can.toFixed(2)}) v=${st.v.toFixed(1)}`); }
      }
      if (prevX != null) {
        // how far it moved this frame against how far its speed takes it: going back, or on in a lurch, is a judder
        const mx = st.x - prevX, my = st.y - prevY, fwd = mx * Math.sin(st.h) + my * Math.cos(st.h), want = st.v * dt;
        const off = Math.abs(Math.hypot(mx, my) - want), back = fwd < -0.005;
        if (back || off > 0.05 + 0.25 * want) { judders++; if (judders === 1) out.log.push('route near: ' + o.drv.path.pts.map((q, j) => [o.drv.path.cum[j], q]).filter(([c]) => Math.abs(c - st.s) < 20).map(([c, q]) => `${c.toFixed(1)}:(${q[0].toFixed(1)},${q[1].toFixed(1)})`).join(' ')); judderMax = Math.max(judderMax, off / Math.max(0.01, want)); say('judder', `judder t=${t.toFixed(2)} moved ${Math.hypot(mx, my).toFixed(3)} m (forward ${fwd.toFixed(3)}) for ${want.toFixed(3)} at v=${st.v.toFixed(1)} s=${st.s.toFixed(1)} lat ${st.lat.toFixed(2)} shift ${st.shift.toFixed(2)} pass ${st.pass.toFixed(2)} at (${st.x.toFixed(1)}, ${st.y.toFixed(1)})`); }
      }
      if (window.__dbgN && i >= window.__dbgN[0] && i < window.__dbgN[1]) out.log.push(`f${i} t=${t.toFixed(2)} why=${st.why} block=${st.block ? (st.block.line != null ? 'car' : 'other') : '-'} s=${st.s.toFixed(3)} v=${st.v.toFixed(2)} h=${st.h.toFixed(3)} lat=${st.lat.toFixed(2)} shift=${st.shift.toFixed(2)} pass=${st.pass.toFixed(2)} x=${st.x.toFixed(2)} y=${st.y.toFixed(2)}`);
      prevH = st.h; prevX = st.x; prevY = st.y;
      if (i % 300 === 0) out.log.push(`t=${t.toFixed(0)} s=${st.s.toFixed(0)}/${st.end.toFixed(0)} v=${st.v.toFixed(1)} z=${st.z.toFixed(2)} ${st.why}`);
    }
    return Object.assign(out, { judders, judderMax: +judderMax.toFixed(2), bumps, bumpMax: +bumpMax.toFixed(1), jerks, snaps, snapMax: +snapMax.toFixed(2), phase: o.phase, s: Math.round(o.drv.st.s), len: Math.round(o.drv.path.len) });
  }, [+secs, dest || process.env.DEST || '', process.env.AT ? process.env.AT.split(',').map(Number) : null]);
  console.log(JSON.stringify(Object.assign({}, r, { log: undefined }), null, 1));
  (r.log || []).forEach(l => console.log(l));
  await b.close();
  const bad = r.err || Object.keys(r.hits || {}).length || r.bumps || r.snaps || r.judders || r.jerks;
  process.exit(bad ? 1 : 0);
})();
