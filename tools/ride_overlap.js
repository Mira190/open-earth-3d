// Does a ride ever go through a car? Hail a taxi (or order a ride) at kerbs near the start, get in,
// ride to each destination the driver offers, and every tenth of a second measure how deep the ride's
// box is in each car of the traffic's (on its way to you, only where you could see it) (and, within 120 m of you, how deep the traffic's cars are in
// each other). Each time two come to overlap, print the last seconds of both, with what each was
// braking for, so the rule that let it happen can be read off.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=10:00 xvfb-run -a node tools/ride_overlap.js shibuya [trips=6] [max events=8]
// Exits 1 if the ride is ever more than 0.15 m inside a car of the traffic.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', trips = '6', maxEv = '8'] = process.argv;
const LONG = +(process.env.LONG || 300); // (s: a trip given up after this long)

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 400)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(([trips, maxEv, LONG]) => {
    const g = window.__game, C = g.cars.C, keep = g.KEEP === 'left' ? 1 : -1, out = { trips: [], events: [] };
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    const O = window.OEOnboard, tour = O && O.current && O.current();
    if (tour) tour.skip();
    for (let i = 0; i < 60 && g.dlg.open; i++) { if (g.dlg.hasChoices) g.dlg.choose(0); else g.dlg.tick(0.2); }
    g.advance(3);
    const x0 = g.player.x, y0 = g.player.y;
    // separating axes: how deep two cars' boxes are in each other (<= 0: clear)
    const box = (a, b) => {
      let deep = Infinity;
      for (const s of [a, b]) for (const ax of [[Math.sin(s.h), Math.cos(s.h)], [-Math.cos(s.h), Math.sin(s.h)]]) {
        const pr = c => Math.abs(Math.sin(c.h) * ax[0] + Math.cos(c.h) * ax[1]) * c.half + Math.abs(-Math.cos(c.h) * ax[0] + Math.sin(c.h) * ax[1]) * (c.hw || 0.9);
        deep = Math.min(deep, pr(a) + pr(b) - Math.abs((b.x - a.x) * ax[0] + (b.y - a.y) * ax[1]));
      }
      return deep;
    };
    const f = (x, n = 1) => (x == null ? '-' : (+x).toFixed(n));
    const snapCar = (c, t) => `t ${f(t)} car#${C.indexOf(c)} ${c.model || ''} (${f(c.x)}, ${f(c.y)}) h ${f(c.h * 57.3, 0)} v ${f(c.v, 2)} line ${c.line} why ${c.why} held ${c.heldBy || '-'} front ${c.front ? (c.front.model ? C.indexOf(c.front) : 'ride/you') : '-'} mv ${c.mv ? c.mv.j.id : '-'} toLine ${f(c.toLine)} inHeld ${f(c.inHeld)} tangle ${f(c.tangleT)} passBy ${c.passBy ? C.indexOf(c.passBy) : '-'} dir ${c.dir} ow ${g.cars.netL[c.line].ow || 0} ln ${c.ln} lo ${f(c.lo, 2)} off ${f(c.off, 2)} narrowF ${f(c.narrowF, 2)} s ${f(c.s)}`;
    const snapRide = (o, t) => { const st = o.drv.st; return `t ${f(t)} RIDE ${o.phase} (${f(st.x)}, ${f(st.y)}) h ${f(st.h * 57.3, 0)} v ${f(st.v, 2)} why ${st.why} junction ${st.junction || '-'} block ${st.block ? (st.block.model ? 'car#' + C.indexOf(st.block) : 'other') : '-'} held ${f(st.held)} shift ${f(st.shift, 2)} pass ${f(st.pass, 2)} wedged ${f(st.wedged)} mv ${st.mv ? st.mv.j.id : '-'} ${(() => { const q = g.roadNet.nearest(st.x, st.y, 12); if (!q) return 'off road'; const L = g.cars.netL[q.line], tmp = {}; g.roadNet.at(q.line, q.s, tmp); const along = Math.sin(st.h) * tmp.hx + Math.cos(st.h) * tmp.hy; return `line ${q.line} ow ${L.ow || 0} way ${along > 0 ? 1 : -1} off ${f((st.x - tmp.x) * -tmp.hy + (st.y - tmp.y) * tmp.hx, 2)}`; })()} lat ${f(st.lat, 2)}`; };
    let t = 0;
    const hist = new Map(), rideHist = [], open = new Map(), fr = new THREE.Frustum(), pv = new THREE.Matrix4();
    let worst = 0, rideEv = 0, trafficEv = 0, sampled = 0;
    function tick(o) {
      g.advance(0.1); t += 0.1; sampled++;
      const st = o.drv.st, R = { x: st.x, y: st.y, h: st.h, half: o.C.half, hw: o.C.hw };
      rideHist.push(snapRide(o, t)); if (rideHist.length > 40) rideHist.shift();
      const A = C.slice(0, g.cars.active).filter(c => c.line >= 0 && Math.hypot(c.x - st.x, c.y - st.y) < 120);
      for (const c of A) { const h = hist.get(c) || []; h.push(snapCar(c, t)); if (h.length > 40) h.shift(); hist.set(c, h); }
      const now = new Set();
      // (a ride coming for you drives through what is in its way out of your sight, as games keep the cars
      // that come for you on time: only what you could see counts, as game.js inSight has it)
      const dp = Math.hypot(st.x - g.player.x, st.y - g.player.y);
      g.camera.updateMatrixWorld(); pv.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse); fr.setFromProjectionMatrix(pv);
      const seen = o.phase !== 'coming' || dp < 40 || (dp < 120 && fr.containsPoint(new THREE.Vector3(st.x, st.z + 1, -st.y)));
      if (seen) for (const c of A) {
        if (Math.abs(c.x - st.x) > 12 || Math.abs(c.y - st.y) > 12 || Math.abs(c.z - st.z) > 3) continue;
        const d = box(R, c), key = 'R-' + C.indexOf(c);
        if (d > 0.15) {
          now.add(key);
          if (!open.has(key)) { open.set(key, { t, deep: d }); rideEv++; if (out.events.length < maxEv) out.events.push({ kind: 'ride', t: +t.toFixed(1), phase: o.phase, key, ride: rideHist.slice(-25), car: (hist.get(c) || []).slice(-25), deep: [] }); }
          const ev = open.get(key); ev.deep = Math.max(ev.deep, d); worst = Math.max(worst, d);
        }
      }
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
        const a = A[i], c = A[j];
        if (Math.abs(a.x - c.x) > 12 || Math.abs(a.y - c.y) > 12 || Math.abs(a.z - c.z) > 3) continue;
        const key = C.indexOf(a) + '-' + C.indexOf(c);
        if (box(a, c) > 0.2) { now.add(key); if (!open.has(key)) { open.set(key, { t }); trafficEv++; if (out.events.length < maxEv && out.events.filter(e => e.kind === 'traffic').length < 3) out.events.push({ kind: 'traffic', t: +t.toFixed(1), key, ride: [], car: (hist.get(a) || []).slice(-15), other: (hist.get(c) || []).slice(-15) }); } }
      }
      for (const k of [...open.keys()]) if (!now.has(k)) open.delete(k);
    }
    // a ride stood a minute: the cars ahead of it one after another, and the junction it waits at
    out.stuck = [];
    function diagnose(o) {
      const st = o.drv.st, lines = [snapRide(o, t)];
      for (let x = st.block, k = 0; x && k < 8; x = x.front, k++) lines.push('  ahead ' + (x.model ? snapCar(x, t) : `other (${f(x.x)}, ${f(x.y)}) v ${f(x.v, 2)}`) + (x.q ? ' q' : '') + (x.still != null ? ` still ${f(x.still)}` : ''));
      const JN = g.cars.junctions, a = st.lineAt, near = JN.J.filter(j => Math.hypot(j.x - st.x, j.y - st.y) < 60 && (j.active.length || j === (a && a.j)));
      for (const j of near) lines.push(`  junction ${j.id}${j.scramble ? ' scramble' : ''}${j.mid != null ? ' crossing' : ''} sig ${j.sig ? 1 : 0} ph ${j.ph}${j.st} t ${f(j.t)} active: ` + j.active.map(m => `car#${C.indexOf(m.c)} k${m.k} m${m.m} since ${f(t - m.t)} why ${m.c.why} v ${f(m.c.v, 2)}${m.forced ? ' forced' : ''}`).join(', ') + ` pend: ${j.pend.map(m => `car#${C.indexOf(m.c)}`).join(',')}`);
      return lines;
    }
    for (let k = 0; k < trips; k++) {
      // the start first (Hachiko's kerb, in Shibuya), then kerbs within 300 m of it
      if (k > 0) {
        let pl = null;
        for (let tries = 0; tries < 20 && !pl; tries++) { const a = Math.random() * 2 * Math.PI, d = 40 + Math.random() * 260; pl = g.roads.place(x0 + Math.sin(a) * d, y0 + Math.cos(a) * d, 120, keep); }
        if (!pl) continue;
        Object.assign(g.player, { x: pl.x, y: pl.y }); g.advance(4);
      }
      if (k % 3 === 2) { const ds = g.destinations(g.player.x, g.player.y); if (ds.length) g.orderRide(ds[k % ds.length]); } else g.hail();
      const o = g.ride();
      if (!o) { out.trips.push({ k, none: true }); continue; }
      const t0 = t;
      while (o.phase === 'coming' && t - t0 < 90) tick(o);
      if (o.phase !== 'waiting') { out.trips.push({ k, came: false, phase: o.phase }); g.cancelRide(); g.advance(1); continue; }
      g.boardRide();
      for (let i = 0; i < 100 && g.player.mode !== 'ride'; i++) tick(o);
      if (g.player.mode !== 'ride') { out.trips.push({ k, boarded: false, phase: o.phase, dlg: g.dlg.open }); g.cancelRide(); g.advance(1); continue; }
      if (o.phase === 'asking') {
        for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
        const n = document.querySelectorAll('#gd-choices button').length;
        g.dlg.choose(Math.max(0, (k % Math.max(1, n - 1))));
      }
      const t1 = t;
      let stopT = 0, told = false;
      while (o.phase === 'driving' && t - t1 < LONG) {
        tick(o);
        stopT = o.drv.st.v < 0.5 ? stopT + 0.1 : 0;
        if (stopT > 60 && !told) { told = true; out.stuck.push(diagnose(o)); }
      }
      out.trips.push({ k, kind: o.kind, dest: o.dest && o.dest.name, came: +(t1 - t0).toFixed(0), rode: +(t - t1).toFixed(0), phase: o.phase, km: +(o.meter / 1000).toFixed(2) });
      if (g.player.mode === 'ride') { if (o.phase === 'driving') out.trips[out.trips.length - 1].stuckAt = snapRide(o, t); for (let i = 0; i < 20 && o.drv.st.v > 0.5; i++) tick(o); o.drv.st.v = 0; g.leaveRide(); }
      if (g.ride() === o && g.player.mode !== 'ride') g.cancelRide();
      g.advance(2);
    }
    Object.assign(out, { worst: +worst.toFixed(2), rideEv, trafficEv, seconds: +(sampled / 10).toFixed(0) });
    return out;
  }, [+trips, +maxEv, LONG]);
  for (const x of r.trips) console.log(JSON.stringify(x));
  for (const d of r.stuck) { console.log('\n--- a ride stood a minute'); for (const l of d) console.log('  ' + l); }
  for (const e of r.events) {
    console.log(`\n=== ${e.kind} overlap at t ${e.t}${e.phase ? ` (${e.phase})` : ''} ${e.key}`);
    if (e.ride.length) { console.log('  ride:'); for (const s of e.ride.slice(-12)) console.log('    ' + s); }
    console.log('  car:'); for (const s of e.car.slice(-12)) console.log('    ' + s);
    if (e.other) { console.log('  other:'); for (const s of e.other.slice(-8)) console.log('    ' + s); }
  }
  console.log(`\n${r.seconds} s sampled: the ride inside a car ${r.rideEv} times (deepest ${r.worst} m); traffic cars inside each other within 120 m of the ride ${r.trafficEv} times`);
  await b.close();
  process.exit(r.worst > 0.15 ? 1 : 0);
})();
