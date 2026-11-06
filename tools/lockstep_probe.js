// Whether a city's game plays the same run twice (#243): loads it twice, held in lockstep as
// tools/game_check.js holds it (__game.hold, the clock set on GAME_TIME's minute at Play), steps both
// the same way and prints, after each step, a digest of the crowd's and the traffic's state, and where
// the two runs first part.
//   GAME_TIME=10:00 xvfb-run -a node tools/lockstep_probe.js shinjuku [steps=6]
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shinjuku', steps = '6'] = process.argv;
async function run(b) {
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const pinned = await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true); if (g.nav.layAll) g.nav.layAll(); await g.ways.build(); });
  if (process.env.NOPREFETCH) await p.evaluate(() => { window.__game.nav.prefetch = () => true; });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  if (pinned) await p.evaluate(spec => { const g = window.__game, m = /(\d\d?):(\d\d)$/.exec(spec), min = +m[1] * 60 + +m[2]; if (Math.abs(g.clock.min - min) < 30) { g.setClock(g.clock.y, g.clock.m, g.clock.d, min); g.crowdAuto(true); } }, pinned.spec);
  const out = [];
  const dig = () => p.evaluate(() => {
    const g = window.__game, h = a => { let x = 2166136261; for (const v of a) { x ^= Math.round(v * 100) | 0; x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
    const P = g.crowd.P, C = g.cars.C;
    return { t: g.t().toFixed(2), clock: g.clock.min.toFixed(3), active: g.crowd.active, cars: g.cars.active,
      crowd: h(P.slice(0, g.crowd.active).flatMap(q => [q.x, q.y, q.line])), traffic: h(C.flatMap(c => [c.x, c.y, c.line, c.v])),
      player: h([g.player.x, g.player.y]), lights: h(g.junctions.J.filter(j => j.sig).flatMap(j => [j.ph, j.t])) };
  });
  out.push(await dig());
  for (let i = 0; i < +steps; i++) {
    await p.waitForTimeout(300 + Math.random() * 1500); // (real time between the steps, as a check's screenshots take)
    await p.evaluate(() => window.__game.advance(1));
    out.push(await dig());
  }
  await p.close();
  return out;
}
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const A = await run(b), B = await run(b);
  let parted = -1;
  A.forEach((a, i) => { const s = JSON.stringify(a) === JSON.stringify(B[i]); if (!s && parted < 0) parted = i; console.log(`${s ? 'same' : 'DIFF'} step ${i}: ${JSON.stringify(a)}${s ? '' : ` (apart: ${Object.keys(a).filter(k => a[k] !== B[i][k]).join(', ')})`}`); });
  console.log(parted < 0 ? `${city}: the two runs agree through ${A.length - 1} steps` : `${city}: the runs part at step ${parted}`);
  await b.close();
  process.exit(parted < 0 ? 0 : 1);
})();
