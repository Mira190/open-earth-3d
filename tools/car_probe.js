// Where the game parks your car at the start and what it meets when driven forward: prints the car's
// pose, then its position and speed every half second of W held, for a city whose game check fails
// "drives your car".
//   xvfb-run -a node tools/car_probe.js <city>
const { chromium } = require('playwright');
const city = process.argv[2] || 'kyoto';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return { none: true };
    const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1, out = { start: [st.x, st.y, st.z, st.h].map(v => +v.toFixed(2)), steps: [] };
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3); g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    out.mode = g.player.mode;
    for (let i = 0; i < 12; i++) { g.advance(0.5, ['KeyW']); out.steps.push([st.x, st.y, st.z, st.speed * 3.6].map(v => +v.toFixed(1))); }
    return out;
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
