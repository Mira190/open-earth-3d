// Whether a city's fishing plays the same in two runs (#420): loads the game held (as tools/game_check.js does), and at
// each spot prints the cast, the plan it drew (the wait, the fish, its size) the bite's time and the fight's end, to compare between runs.
//   GAME_TIME=2026-11-02T10:00 xvfb-run -a node tools/fishing_repeat_probe.js queenstown
//   PRE=1.3 ...                         (the fishing code fetched 1.3 s of the game before the first spot)
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const F = require('./fishing_step');
const [,, city = 'queenstown'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(1); });
  // (PRE=s: the code fetched and stepped that long before the first spot, as a player's walk near the water fetches it at
  // a moment the network decides: the casts must not care)
  if (process.env.PRE) await p.evaluate(async pre => { const g = window.__game; await g.fishLoad(); g.advance(pre); }, +process.env.PRE);
  const spots = await p.evaluate(() => (window.__game.fishing().spots || []).map(s => s.id));
  for (const id of spots) {
    await F.goTo(p, id);
    await F.loaded(p);
    const st0 = await F.begin(p);
    const c = await F.cast(p);
    const w = await F.bite(p);
    const env = await p.evaluate(() => { const g = window.__game, s = g.sun ? g.sun() : null; return { min: +g.clock.min.toFixed(3), t: +g.t().toFixed(2) }; });
    console.log(`${id}: begin ${st0.st} cast ${c.st} line ${(+c.line).toFixed(3)} power ${(+c.power).toFixed(3)} wait ${(+c.wait).toFixed(3)} fish ${c.fish} ${c.cm} cm; bite ${w.st} at t ${env.t} (clock ${env.min})`);
    const k = await F.strike(p); const e = k.st === 'fight' ? await F.play(p) : k;
    const t2 = await p.evaluate(() => +window.__game.t().toFixed(2));
    console.log(`  ${id}: strike ${k.st}, the fight ends ${e.st} at t ${t2} (top tension ${(+e.top || 0).toFixed(3)})`);
    await p.evaluate(() => { const g = window.__game; g.advance(3); g.fishing().api.stop(true); g.advance(1); });
  }
  await b.close();
})();
