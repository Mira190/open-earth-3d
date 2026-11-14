// Backing out of a one-way street (#283), alone: tools/reverse_step.js's traffic and ride checks in a city.
//   GAME_TIME=10:00 xvfb-run -a node tools/reverse_probe.js shibuya     (OUT=dir: stills as the ride backs out)
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const { reverseStep } = require('./reverse_step');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 1440), height: +(process.env.H || 900) } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { const g = window.__game; g.hold(true); for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25); g.advance(2); });
  // OUT=dir: stills from the chase camera as the ride backs out
  const out = process.env.OUT;
  if (out) {
    require('fs').mkdirSync(out, { recursive: true });
    await p.exposeFunction('__still', async name => { await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${city}-${name}.png` }); });
  }
  const r = await p.evaluate(reverseStep, { ride: true, stills: !!out });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
