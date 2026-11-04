// The walk signals' calls on their own (tools/walkcalls_step.js), quicker than tools/game_check.js:
//   xvfb-run -a node tools/walkcalls_check.js shibuya osaka sydney
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
(async () => {
  const cities = process.argv.slice(2);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fails = 0;
  for (const city of cities) {
    const p = await b.newPage({ viewport: { width: 900, height: 560 } });
    await pinClock(p, city);
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    await p.evaluate(() => window.__game.advance(1));
    const t0 = Date.now(), r = await require('./walkcalls_step')(p);
    console.log(`${city}: ${r.none ? 'no calls' : r.kind} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const [ok, what] of r.checks || []) { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; }
    for (const e of errs) { console.log(`  pageerror: ${e}`); fails++; }
    await p.close();
  }
  await b.close();
  process.exit(fails ? 1 : 0);
})();
