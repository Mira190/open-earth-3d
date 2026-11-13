const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:8800/#play-sydney`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const out = await p.evaluate(() => {
    const g = window.__game, nav = g.nav, res = []; let x = 386.16, y = 564.05, z = 17.94; const tx = 386.91, ty = 565.69;
    const d = Math.hypot(tx - x, ty - y), ux = (tx - x) / d, uy = (ty - y) / d;
    for (let i = 0; i < 20; i++) { const nx = x + ux * 0.1, ny = y + uy * 0.1, w = nav.walk(nx, ny, z, true); res.push([+nx.toFixed(2), +ny.toFixed(2), w.ok, w.why || "", w.z, nav.floorAt(nx, ny, z), nav.walk(nx, ny, z).ok]); if (!w.ok) break; x = nx; y = ny; z = w.z; }
    return res;
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
