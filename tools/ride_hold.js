// A ride holding the traffic (#180): hail a taxi, get in and go to each destination it offers in turn,
// and every second note each car of the traffic stopped with the ride as what it waits on (why 'you'
// on the ride's way or across its bonnet, or held by it as it steps). A car that waits on the ride
// longer than MIN seconds (default 20) is listed with how the ride stood meanwhile: its phase, its
// speed as its driver says (st.v) and as it really moved (m/s over the last second), and how far off.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=10:00 xvfb-run -a node tools/ride_hold.js shibuya [seconds=400] [rides=3]
// Exits 1 if any car waited on a ride that was moving (really, over 1 m/s) longer than MIN seconds.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', secs = '400', rides = '3'] = process.argv;
const MIN = Number(process.env.MIN || 20);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 400)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(([secs, nRides, MIN]) => {
    const g = window.__game, C = g.cars.C, idx = new Map(C.map((c, i) => [c, i])), out = { rides: [], held: [], moving: 0 };
    g.advance(2);
    const W = new Map(); // car -> { t, rideMoved, rideV, log }
    let T = 0;
    for (let k = 0; k < nRides && T < secs; k++) {
      const pl = g.roads.place(g.player.x, g.player.y, 80, g.KEEP === 'left' ? 1 : -1);
      if (pl) { g.player.x = pl.x; g.player.y = pl.y; g.player.z = pl.z; }
      g.advance(0.5);
      g.hail();
      let o = g.ride();
      if (!o) { out.rides.push('no taxi'); break; }
      for (let t = 0; t < 150 && o.phase === 'coming'; t++) { g.advance(1); T++; }
      if (o.phase !== 'waiting') { out.rides.push(`taxi ${o.phase}`); g.cancelRide && g.cancelRide(); continue; }
      g.player.x = o.drv.st.x; g.player.y = o.drv.st.y;
      g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      const names = [...document.querySelectorAll('#gd-choices button')].map(b => b.textContent);
      const pick = Math.min(names.length - 1, k * 2 + 1);
      g.dlg.choose(Math.max(0, pick));
      out.rides.push(names[pick]);
      let px = o.drv.st.x, py = o.drv.st.y, t0 = T;
      while (o.phase === 'driving' && T < secs && T - t0 < 300) {
        g.advance(1); T++;
        const st = o.drv.st, moved = Math.hypot(st.x - px, st.y - py); px = st.x; py = st.y;
        for (const c of C) {
          if (c.line < 0) continue;
          const on = c.v < 0.3 && ((c.why === 'you' && c.youBy && /^ride/.test(c.youBy)) || (c.why === 'held' && c.front && c.front.id === 'ride'));
          if (!on) { const e = W.get(c); if (e && e.t > MIN) out.held.push(e); W.delete(c); continue; }
          const e = W.get(c) || { car: idx.get(c), t: 0, movingT: 0, first: `${c.why} ${c.youBy || ''}`, log: [] };
          e.t++; if (moved > 1) e.movingT++;
          const d = Math.hypot(st.x - c.x, st.y - c.y);
          if (e.log.length < 6 || e.t % 10 === 0) e.log.push(`t${T} ${c.why}${c.youBy ? ' ' + c.youBy : ''} ride ${o.phase} st.v ${st.v.toFixed(1)} moved ${moved.toFixed(1)} m/s ${d.toFixed(1)} m off${st.why ? ' (its driver: ' + st.why + (st.block ? (st.block === c || st.block.of === c ? ', behind this car' : ', behind another') : '') + ')' : ''}${c.mv ? ` car in junction ${c.mv.j.id}` : ''}`);
          W.set(c, e);
        }
      }
      for (let i = 0; i < 40 && g.player.mode === 'ride'; i++) { g.leaveRide(); g.advance(0.5); T += 0.5; }
    }
    for (const [, e] of W) if (e.t > MIN) out.held.push(e);
    out.moving = out.held.filter(e => e.movingT > MIN).length;
    out.T = T;
    return out;
  }, [Number(secs), Number(rides), MIN]);
  if (r.err) { console.log(r.err); process.exit(2); }
  console.log(`${city}: ${r.T} s, rides to ${r.rides.join(' | ')}; cars waiting on the ride over ${MIN} s: ${r.held.length}, of them while it moved: ${r.moving}`);
  for (const e of r.held) console.log(`  car ${e.car}: ${e.t} s (ride moving ${e.movingT} s of it), ${e.first}\n    ${e.log.join('\n    ')}`);
  await b.close();
  process.exit(r.moving ? 1 : 0);
})();
