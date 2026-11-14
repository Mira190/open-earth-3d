// Cars of the traffic found in a parked car's body (the kerb step of tools/game_check.js, autopilot_step.js kerbStep):
// runs a city's traffic in lockstep round a few spots for a while and prints each overlap deeper than 0.15 m the
// first time it is seen, with both cars' roads, places along them, lane offsets and what the moving one was doing,
// and the parked one's road end and kerb offset, to tell a parked car standing out into the lane or a junction
// from a moving car swung into it.
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=2026-11-02T10:00 xvfb-run -a node tools/parked_probe.js sydney [seconds per spot] [spots]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', secs = '300', spots = '3'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await pinClock(p, city);
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(1); });
  let total = 0;
  for (let k = 0; k < +spots; k++) {
    const r = await p.evaluate(({ k, secs }) => {
      const g = window.__game, A = g.cars, L = g.roadNet.L, seen = new Set(), out = [];
      if (k > 0) { // (another spot: a point along a road some way off)
        const i = (k * 7919) % L.length, P = L[i].pts;
        g.player.x = P[0]; g.player.y = P[1];
      }
      const desc = c => `${A.C.indexOf(c)} line ${c.line} (${L[c.line] ? L[c.line].c : '?'}, ${L[c.line] ? L[c.line].len.toFixed(0) : '?'} m) s ${c.s.toFixed(1)} dir ${c.dir} ln ${c.ln} lo ${(+c.lo || 0).toFixed(2)} off ${(+c.off || 0).toFixed(2)} v ${c.v.toFixed(1)} why '${c.why || ''}' at ${c.x.toFixed(1)},${c.y.toFixed(1)} h ${(c.h * 180 / Math.PI).toFixed(0)}°`;
      for (let t = 0; t < secs; t += 0.5) {
        g.advance(0.5);
        for (const c of A.C) {
          if (c.line < 0 || c.park) continue;
          for (const o of A.C) if (o.park && o.line >= 0 && Math.abs(o.x - c.x) < 7 && Math.abs(o.y - c.y) < 7) {
            const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = c.x - o.x, dy = c.y - o.y, cs = Math.abs(Math.sin(c.h - o.h)), cc = Math.abs(Math.cos(c.h - o.h));
            const ea = o.half + c.half * cc + c.hw * cs - Math.abs(dx * fx + dy * fy), eb = o.hw + c.hw * cc + c.half * cs - Math.abs(-dx * fy + dy * fx), d = Math.min(ea, eb);
            const key = `${A.C.indexOf(c)}:${A.C.indexOf(o)}`;
            if (d > 0.15 && !seen.has(key)) {
              seen.add(key);
              out.push(`t ${t.toFixed(1)} ${d.toFixed(2)} m: moving ${desc(c)}${c.mv ? ' in a junction' : ''}${c.pullOut > 0 ? ' pulling out' : ''}${c.parking ? ' parking' : ''}${c.rev ? ' reversing' : ''}${c.dodgeT > 0 ? ' dodging' : ''} front ${c.front ? A.C.indexOf(c.front) : '-'}\n      parked ${desc(o)} park.t ${o.park.t.toFixed(0)} in ${o.parkedIn || 0} kerbLo ${A.kerbLo(o.line).toFixed(2)} ends ${o.s.toFixed(1)}/${(L[o.line].len - o.s).toFixed(1)} m`);
            }
          }
        }
      }
      return out;
    }, { k, secs: +secs });
    total += r.length;
    console.log(`spot ${k}: ${r.length} overlaps`);
    for (const l of r) console.log('  ' + l);
  }
  if (errors.length) console.log(errors.join('\n'));
  console.log(`${total} overlaps deeper than 0.15 m`);
  await b.close();
  process.exit(total ? 1 : 0);
})();
