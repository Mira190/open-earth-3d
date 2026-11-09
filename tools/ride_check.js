// Rides over and over, headless: at kerbs up to 400 m from the start, hail a taxi and order a ride
// on the phone, each N times, and say how long each took against what the phone said, what it
// was stopped by (its driver's reason: a gap ahead, the line at a light, ...) and, for a long
// stop, what was in front of it. tools/game_check.js takes one of each, which can't tell a
// rule that keeps rides on time from a lucky run.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/ride_check.js osaka [N=10] [signals]
// "signals": only rides whose way passes traffic lights near the pick-up (the others are cancelled
// and another kerb tried), where the waits at the lights make the time hardest to say.
// "rerouted": how many times it found another way round a jam in view (game.js rideStep);
// "junctions": how many junctions its driver went into by asking junctions.js for its way across.
// "said": what the app said 0.5 s after the order; "err": how much later (or, below 0, sooner) it came;
// "stops": the seconds it stood, by its driver's reason (at "the line", what held it there: red,
// amber, stop sign, or the junction's own: cross, turn, give).
// Exits 1 if more than one in ten took over 30 s, or came more than 8 s off what the app said.
// GAME_TIME pins the clock (as for tools/game_check.js), and Math.random is seeded (SEED, default
// 1), so that a run is the same each time.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'hong-kong', trials = '10', only = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 400)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  if (process.env.CAR_BEND === '0') await p.addInitScript(() => { window.__carBend = false; }); // (the cars keep their speed round bends: an A/B, #317)
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(([n, sigOnly]) => {
    const g = window.__game, out = [], keep = g.KEEP === 'left' ? 1 : -1;
    g.advance(2);
    const x0 = g.player.x, y0 = g.player.y;
    for (let k = 0, kept = 0; kept < 2 * n && k < (sigOnly ? 16 : 2) * n; k++) {
      // a kerb somewhere within 400 m of the start
      const a = Math.random() * 2 * Math.PI, d = 50 + Math.random() * 350;
      const pl = g.roads.place(x0 + Math.sin(a) * d, y0 + Math.cos(a) * d, 120, keep);
      if (!pl) continue;
      const nx = pl.x, ny = pl.y;
      Object.assign(g.player, { x: nx, y: ny }); g.advance(4); // (the traffic settles round you)
      const hail = k % 2 === 0;
      if (hail) g.hail(); else { const ds = g.destinations(g.player.x, g.player.y); g.orderRide(ds[0]); }
      const o = g.ride();
      if (!o || o.phase !== 'coming') { if (!sigOnly) { out.push({ k, hail, none: true }); kept++; } if (o) g.cancelRide(); continue; }
      if (sigOnly && !(o.sig || []).length) { g.cancelRide(); g.advance(1); continue; }
      kept++;
      const upd = o.drv.update; let calls = 0; o.drv.update = function (...a) { calls++; return upd.apply(this, a); };
      g.advance(0.5);
      const said = g.rideEta ? g.rideEta() + 0.5 : 0, why = {};
      let t = 0.5;
      for (; t < 80 && o.phase === 'coming'; t += 0.5) {
        g.advance(0.5);
        const st = o.drv.st;
        if (st.v < 0.5) { let w = (st.why || '?').replace(/[-\d.]+ m(\/s)?/, '').trim(); if (w === 'the line') w += ` (${st.junction || '?'})`; why[w] = (why[w] || 0) + 0.5;
          if (why[w] === 8 && w === 'gap') { const bl = st.block; why.gapDetail = `d ${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} left ${(st.end - st.s).toFixed(0)} held ${(st.held||0).toFixed(0)} pass ${st.pass.toFixed(1)} block ${bl ? `${bl.line != null ? 'car' : 'other'} v ${(bl.v||0).toFixed(1)} why ${bl.why || ''} still ${bl.still ? (typeof bl.still === 'number' ? bl.still.toFixed(0) : 'yes') : 'no'} toLine ${bl.toLine != null ? bl.toLine.toFixed(0) : '-'} q ${bl.q ? 1 : 0}` : 'none'}`; }
          if (why[w] === 8 && w === 'ahead') { const fp = g.cars.footprint(st.x, st.y, st.z, st.h, o.C.half, o.C.hw, 0.1); why.detail = `calls ${calls} v ${st.v.toFixed(2)} s ${st.s.toFixed(1)} done ${st.done} brake ${st.brake} shift ${st.shift.toFixed(2)} pass ${st.pass.toFixed(2)} d ${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} left ${(st.end - st.s).toFixed(0)} wedged ${(st.wedged || 0).toFixed(1)} fp ${fp.toFixed(2)} held ${(st.held||0).toFixed(0)} stall ${(st.stall||0).toFixed(1)} phase ${o.phase}`; } }
      }
      out.push({ k, hail, said: +said.toFixed(0), t, err: +(t - said).toFixed(1), sig: (o.sig || []).length, stops: why, late: o.T0 != null ? +(t - o.T0).toFixed(0) : null, rerouted: o.rerouted || 0, junctions: o.drv.st.entered || 0 });
      g.cancelRide(); g.advance(2);
    }
    return out;
  }, [+trials, only === 'signals']);
  const done = r.filter(x => !x.none);
  for (const x of r) console.log(JSON.stringify(x));
  for (const kind of [true, false]) {
    const ts = done.filter(x => x.hail === kind).map(x => x.t).sort((a, b) => a - b);
    const es = done.filter(x => x.hail === kind).map(x => Math.abs(x.err)).sort((a, b) => a - b);
    console.log(`${kind ? 'hail ' : 'order'}: n ${ts.length}, over 30 s: ${ts.filter(t => t > 30).length}, median ${ts[Math.floor(ts.length / 2)]}, max ${ts[ts.length - 1]}; off what the app said by over 8 s: ${es.filter(e => e > 8).length}, median ${es[Math.floor(es.length / 2)]}, max ${es[es.length - 1]}`);
  }
  await b.close();
  const late = done.filter(x => x.t > 30).length, off = done.filter(x => Math.abs(x.err) > 8).length;
  process.exit(late > done.length / 10 || off > done.length / 10 ? 1 : 0);
})();
