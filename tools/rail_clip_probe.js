// What stands at a spot on a railway's platform, to the walker and to the collision world: the floor there, whether
// nav.walk lets a walker stand there, the collision world's boxes round it, and the landmark meshes' heights in its
// 2 m cell (nav.tops). For issue 399's platform furniture (benches, sign frames).
//   xvfb-run -a node tools/rail_clip_probe.js sydney x y z
const { chromium } = require('playwright');
const [,, city = 'sydney', X, Y, Z] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] } : {});
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.nav', null, { timeout: 600000 });
  const r = await p.evaluate(([x, y, z]) => {
    const g = window.__game, n = g.nav, out = { floor: n.floorAt(x, y, z + 0.5), walk: n.walk(x, y, z, true), boxes: [], tops: {} };
    n.col.need && n.col.need(x - 3, y - 3, x + 3, y + 3);
    for (const q of n.col.prisms || []) if (q.x1 > x - 2 && q.x0 < x + 2 && q.y1 > y - 2 && q.y0 < y + 2 && q.zhi > z - 1 && q.zlo < z + 3) out.boxes.push([q.x0, q.y0, q.x1, q.y1, q.zlo, q.zhi, q.tag].map(v => typeof v === 'number' ? +v.toFixed(2) : v));
    for (const [name, m] of Object.entries(n.tops)) for (const [k, t] of m) { /* (cell index unknown here) */ }
    return out;
  }, [+X, +Y, +Z]);
  console.log(JSON.stringify({ floor: r.floor, walk: r.walk })); for (const q of r.boxes) console.log(q.join(" "));
  await b.close();
})();
