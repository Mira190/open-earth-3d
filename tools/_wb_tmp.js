// What stops a walker at a point: node tools/what_blocks.js city '[[x, y, z], ...]' under xvfb-run, with web/
// served on PORT or 8800 ([x, y, z, r]: r the body's radius, 0.5 m unless given). Prints the floor there and
// every collision box a body r m round (knee to head) overlaps: a building's solid (its id, class and heights) or a landmark's cell.
'use strict';
const { chromium } = require('playwright');
const [,, city = 'amsterdam', pts = '[]'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const out = await p.evaluate(P => P.map(([x, y, z, r = 0.5]) => {
    const g = window.__game, nav = g.nav, f = nav.floorAt(x, y, z + 0.3), fz = f ? f.z : z, hits = [];
    nav.col.need(x - 2, y - 2, x + 2, y + 2);
    nav.col.overlap(x, y, r, fz + 0.4, fz + 1.8, (i, pr) => {
      const r = pr.rings && pr.rings[0];
      hits.push({ tag: pr.tag, id: pr.id, cls: pr.tag === nav.BUILDING && g.B && g.B.b[pr.id] ? g.B.b[pr.id][1] : undefined, z: [+pr.zlo.toFixed(2), +pr.zhi.toFixed(2)],
        box: r ? [Math.min(...r.filter((_, k) => k % 2 === 0)), Math.min(...r.filter((_, k) => k % 2)), Math.max(...r.filter((_, k) => k % 2 === 0)), Math.max(...r.filter((_, k) => k % 2))].map(v => +v.toFixed(2)) : null });
      return true;
    });
    return { at: [x, y, z], floor: f, terrain: +nav.terrain(x, y).toFixed(2), walk: nav.walk(x, y, fz), hits };
  }), JSON.parse(pts));
  for (const o of out) console.log(JSON.stringify(o));
  await b.close();
})();
