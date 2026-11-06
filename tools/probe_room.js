// Probe the game's collision along a line: for each point, the floor, the terrain and whether a walker has room.
//   xvfb-run -a node tools/probe_room.js city x0 y0 x1 y1 [n]
const { chromium } = require('playwright');
const [,, city, x0, y0, x1, y1, n = '24'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.nav && window.__game.nav.room', null, { timeout: 600000 });
  const out = await p.evaluate(([a, b2, c, d, n]) => {
    const g = window.__game, nav = g.nav, r = [];
    if (nav.layAll) nav.layAll();
    for (let i = 0; i <= n; i++) {
      const x = a + (c - a) * i / n, y = b2 + (d - b2) * i / n, t = nav.terrain(x, y), f = nav.floorAt(x, y, t + 1.2);
      const z = f ? f.z : t;
      r.push(`${x.toFixed(1)},${y.toFixed(1)} terrain ${t.toFixed(2)} floor ${f ? f.z.toFixed(2) + ' ' + f.kind : '-'} room ${nav.room(x, y, z, 0.3, 1.7, false)} room@terrain ${nav.room(x, y, t, 0.3, 1.7, false)}`);
    }
    return r;
  }, [+x0, +y0, +x1, +y1, +n]);
  console.log(out.join('\n'));
  await b.close();
})();
