// Which cars stand in a wall, and where (tools/game_check.js counts them: "the traffic keeps out of
// the walls"): the city's traffic run for SECONDS, each car-second in a building or landmark listed
// by car, place, road class and what it was doing.
//   xvfb-run -a node tools/car_walls.js fushimi-inari [seconds]
const { chromium } = require('playwright');
const [,, city = 'fushimi-inari', secs = '20'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => window.__game.advance(1));
  const r = await p.evaluate(secs => {
    const g = window.__game, nav = g.nav, C = g.cars.C, RL = g.roadNet.L, by = new Map();
    let n = 0;
    for (let t = 0; t < secs; t++) {
      g.advance(1);
      for (const c of C) {
        if (c.line < 0) continue;
        n++;
        if (!nav.room(c.x, c.y, c.z, c.hw * 0.8, 1.4, c.z > nav.terrain(c.x, c.y) + 2)) {
          const k = C.indexOf(c), e = by.get(k) || { n: 0, at: [], line: c.line, c: RL[c.line].c, name: RL[c.line].name || '' };
          e.n++; if (e.at.length < 3) e.at.push(`${c.x.toFixed(1)},${c.y.toFixed(1)} z${c.z.toFixed(1)} v${c.v.toFixed(1)} ${c.why || '-'}${c.mv ? ' (turning)' : ''}`);
          by.set(k, e);
        }
      }
    }
    return { n, cars: [...by.entries()].map(([k, e]) => ({ car: k, ...e })) };
  }, +secs);
  console.log(`${city}: ${r.cars.reduce((a, e) => a + e.n, 0)} of ${r.n} car-seconds in a wall`);
  for (const e of r.cars) console.log(`  car ${e.car}: ${e.n} s on line ${e.line} (${e.c} ${e.name}): ${e.at.join(' | ')}`);
  await b.close();
})();
