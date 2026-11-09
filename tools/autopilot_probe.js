// The autopilot of your own car (#355), alone: tools/autopilot_step.js's checks in a city, with its log.
//   GAME_TIME=10:00 xvfb-run -a node tools/autopilot_probe.js sydney     (OUT=dir: a still at the end)
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const { autopilotStep, autopilotChecks, assistStep, assistChecks, wetStep, wetChecks, railStep, railChecks } = require('./autopilot_step');
const [,, city = 'sydney'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 1100), height: +(process.env.H || 650) } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 400)));
  p.on('console', m => { if (m.type() === 'error') console.log('error', m.text().slice(0, 300)); });
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { const g = window.__game; for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25); g.advance(2); });
  const r = process.env.ONLY ? { none: 'no car' } : await p.evaluate(autopilotStep, { log: true, limit: +(process.env.LIMIT || 420) });
  for (const l of r.log || []) console.log(l);
  delete r.log;
  console.log(JSON.stringify(r));
  let bad = 0;
  for (const [ok, what] of autopilotChecks(r)) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; }
  if (!process.env.ONLY || process.env.ONLY === 'rail') {
    const rl = await p.evaluate(railStep);
    console.log(JSON.stringify(rl));
    for (const [ok, what] of railChecks(rl)) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; }
    if (process.env.ONLY === 'rail') { await b.close(); process.exit(bad ? 1 : 0); }
  }
  const wx = await p.evaluate(wetStep);
  console.log(JSON.stringify(wx));
  for (const [ok, what] of wetChecks(wx)) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; }
  if (process.env.ONLY === 'wet') { await b.close(); process.exit(bad ? 1 : 0); }
  const as = await p.evaluate(assistStep, { log: true });
  for (const l of as.log || []) console.log(`assist: ${l}`);
  delete as.log;
  console.log(JSON.stringify(as));
  for (const [ok, what] of assistChecks(as)) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; }
  if (process.env.OUT) { require('fs').mkdirSync(process.env.OUT, { recursive: true }); await p.waitForTimeout(500); await p.screenshot({ path: `${process.env.OUT}/${city}-autopilot.png` }); }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
