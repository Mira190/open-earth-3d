// The cars in and near the Shibuya scramble's box through the opening (#110): which lines they are on,
// whether those are inside the junction, their speed, and your car and a ride.
//   xvfb-run -a node tools/scramble_cars.js [city] [seconds]
const { chromium } = require('playwright');
const [,, city = 'shibuya', secs = '9'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  for (let k = 0; k < 10; k++) {
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    if (await p.waitForFunction(() => window.__game.arriving(), null, { timeout: 15000 }).then(() => true, () => false)) break;
  }
  const out = await p.evaluate(async secs => {
    const g = window.__game, j = g.junctions.J.find(q => q.scramble), res = [];
    const f = v => (typeof v === "number" ? +v.toFixed(1) : v), row = c => ({ x: f(c.x), y: f(c.y), d: f(Math.hypot(c.x - j.x, c.y - j.y)), v: +(c.v || 0).toFixed(1), line: c.line,
      inner: c.line >= 0 ? !!g.cars.junctions.inner(c.line) : null, model: c.model, taxi: !!c.taxi, why: c.why });
    for (let t = 0; t <= secs; t += 1) {
      res.push({ t, ph: `${j.ph}${j.st}`, cars: g.cars.C.filter(c => c.line >= 0 && Math.hypot(c.x - j.x, c.y - j.y) < 40).map(row),
        extra: g.cars.extra.map(row), myCar: g.myCar() ? row(g.myCar()) : null,
        holding: g.cars.C.filter(c => c.line >= 0 && c.why === 'person' && Math.hypot(c.x - j.x, c.y - j.y) < 40).map(c => ({ car: [f(c.x), f(c.y)],
          walkers: g.crowd.P.filter(q => q.line >= 0 && Math.hypot(q.x - c.x, q.y - c.y) < 9).map(q => ({ x: f(q.x), y: f(q.y), line: q.line, s: f(q.s), v: f(q.v), state: q.state })) })) });
      for (let s = 0; s < 10; s++) g.advance(0.1);
      await new Promise(r => requestAnimationFrame(r));
    }
    return res;
  }, +secs);
  for (const r of out) console.log(JSON.stringify(r));
  await b.close();
})();
