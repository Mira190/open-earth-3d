// How often the traffic stands for someone in the road: a city's street traffic run headlessly for
// [seconds] (300), seeded, counting each second a car stands still for a walker (and in a junction,
// and for over 10 s).   PORT=8800 GAME_TIME=10:00 xvfb-run -a node tools/person_held_probe.js jinbocho 300
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const city = process.argv[2] || 'jinbocho', secs = +(process.argv[3] || 300);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  await p.addInitScript(() => { let x = 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); });
  await p.goto(`http://localhost:${process.env.PORT}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play'); if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(secs => {
    const g = window.__game, C = g.cars.C; let person = 0, personJ = 0, long = 0;
    for (let t = 0; t < secs; t += 1) { g.advance(1);
      for (const c of C) if (c.line >= 0 && c.v < 0.1 && (c.who >= 0) && (c.why === 'person' || c.heldBy === 'person')) { person++; if (c.mv) personJ++; if ((c.pw || 0) > 10 || c.inHeld > 20) long++; } }
    return { person, personJ, long };
  }, secs);
  console.log(city, JSON.stringify(r));
  await b.close();
})();
