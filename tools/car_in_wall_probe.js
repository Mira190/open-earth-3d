// Which solids does the traffic drive into? Plays a city's game headless (web/ served on PORT or 8800, under
// xvfb-run) for SECONDS (default 20) and counts, for each car-second whose body is in a wall (game_check.js's
// "the traffic keeps out of the walls"), the solid it touches: its tag, building id and a sample place.
//   xvfb-run -a node tools/car_in_wall_probe.js higashiyama [seconds]
const { chromium } = require('playwright');
(async () => {
  const city = process.argv[2] || 'higashiyama', secs = +(process.argv[3] || 20);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && window.__game.cars && window.__game.roadNet, null, { timeout: 600000 });
  const out = await p.evaluate(secs => {
    const g = window.__game, nav = g.nav, C = g.cars.C, RL = g.roadNet.L, hits = new Map();
    let n = 0, inWall = 0;
    for (let t = 0; t < secs; t++) {
      g.advance(1);
      for (const c of C) {
        if (c.line < 0) continue;
        n++;
        if (nav.room(c.x, c.y, c.z, c.hw * 0.8, 1.4, c.z > nav.terrain(c.x, c.y) + 2)) continue;
        inWall++;
        const seen = [];
        nav.col.overlap(c.x, c.y, c.hw * 0.8, c.z + 0.5, c.z + 1.4, (pi, q) => { seen.push(`${q.tag}:${q.id}:${q.zlo.toFixed(1)}-${q.zhi.toFixed(1)}`); return false; });
        const k = seen.join(' ') || '(fine landmark cells)';
        const h = hits.get(k) || { n: 0, at: `${c.x.toFixed(1)},${c.y.toFixed(1)} z ${c.z.toFixed(1)} road ${c.line} ${(RL[c.line] || {}).name || ''}` };
        h.n++; hits.set(k, h);
      }
    }
    const B = window.__game.data && window.__game.data.B;
    return { n, inWall, hits: [...hits].map(([k, h]) => ({ k, ...h, names: B ? k.split(' ').map(s => { const id = +s.split(':')[1]; return id >= 0 && B.b[id] ? B.b[id].slice(0, 7).join('|') : ''; }) : [] })) };
  }, secs);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
