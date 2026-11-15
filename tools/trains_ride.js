// The railway's ride alone (tools/trains_step.js 'ride', as tools/game_check.js runs it last), to work on a
// station without the whole check, and then an expression of your own in the page (g: the game), printed.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/trains_ride.js tokyo ["expression"] [part=ride]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', expr = '', part = 'ride'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await startPlay(p);
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  // (past the arrival and the first-time tour, as tools/game_check.js is by then: nothing is offered while they run)
  await p.evaluate(async () => { const g = window.__game, O = window.OEOnboard; let t = 0; while (g.arriving() && t < 8) { g.advance(0.25); t += 0.25; await new Promise(r => requestAnimationFrame(r)); } const tour = O.current(); if (tour) tour.skip(); g.advance(0.5); });
  let fails = 0;
  if (part !== 'none') {
    const r = await require('./trains_step')(p, part);
    if (r.none) console.log('no railway');
    else for (const [ok, what] of r.checks) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; }
  }
  if (expr) console.log(JSON.stringify(await p.evaluate(`(g => (${expr}))(window.__game)`), null, 1));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
