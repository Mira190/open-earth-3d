// Backing out of a one-way street (#283), alone: tools/reverse_step.js's traffic and ride checks in a city.
//   GAME_TIME=10:00 xvfb-run -a node tools/reverse_probe.js shibuya
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const { reverseStep } = require('./reverse_step');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  // a ride ordered and boarded, as game_check.js's turn step does
  const got = await p.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game;
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    g.advance(2);
    const dest = g.destinations(g.player.x, g.player.y)[0];
    if (!dest) return 'nowhere to go';
    let o = null;
    for (let i = 0; i < 4 && !o; i++) { if (g.orderRide(dest) && g.ride() && (g.ride().phase === 'coming' || g.ride().phase === 'waiting')) o = g.ride(); else g.advance(5); }
    if (!o) return 'no ride';
    for (let t = 0; t < 120 && o.phase === 'coming'; t++) g.advance(0.5);
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    if (g.dlg.open && g.dlg.hasChoices) g.dlg.choose(0);
    g.advance(3);
    return o.phase;
  });
  console.log('ride:', got);
  const r = await p.evaluate(reverseStep, { ride: true });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
