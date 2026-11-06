// Walkers crossing a major road (actors.js crossings.major) away from a crosswalk: a city's crowd, sampled
// round the player at a few places over a minute. At a scramble its crowd crosses on the walk, which counts
// as a crosswalk; a zebra counts too.
//   xvfb-run -a node tools/jaywalk_probe.js tokyo [x y ...]
const { chromium } = require('playwright');
(async () => {
  const [city = 'tokyo', ...xy] = process.argv.slice(2);
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.crowd && window.__game.crowd.crossings', null, { timeout: 300000 });
  const r = await p.evaluate(async (xy) => {
    const g = window.__game, C = g.crowd.crossings, P = g.crowd.P, R = g.roadNet;
    const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)/; // (as game.js majorAt, for a build without it)
    const major = C.major || ((x, y) => { const q = R.nearest(x, y, 10); return !!q && (MAJOR.test(R.L[q.line].c) || g.junctions.lanesOf(R.L[q.line]) >= 2); });
    g.spawn(); g.advance(1);
    const spots = [];
    for (let k = 0; k + 1 < xy.length; k += 2) spots.push([+xy[k], +xy[k + 1]]);
    if (!spots.length) spots.push([g.player.x, g.player.y]);
    const out = { samples: 0, inMajor: 0, onCrossing: 0, jay: 0, at: [] };
    for (const [x, y] of spots) {
      if (xy.length) { g.player.x = x; g.player.y = y; }
      g.advance(3);
      for (let t = 0; t < 30; t++) {
        g.advance(2);
        for (const q of P.slice(0, g.crowd.active)) {
          if (q.line < 0 || q.state !== 'walk') continue;
          out.samples++;
          if (!C.road(q.x, q.y) || !major(q.x, q.y)) continue;
          const h = g.crowdNet.at(q.line, q.s, {});
          if (C.across && !C.across(q.x, q.y, h.hx, h.hy)) continue; // (a footway along the kerb, not across the road)
          out.inMajor++;
          const X = C.byLine.get(q.line);
          if ((X && X.some(c => Math.abs(c.s - q.s) < c.kerb + 2)) || C.zebra(q.x, q.y)) { out.onCrossing++; continue; }
          out.jay++;
          if (out.at.length < 12) out.at.push(`${q.x.toFixed(0)},${q.y.toFixed(0)}`);
        }
      }
    }
    return out;
  }, xy);
  console.log(city, JSON.stringify(r));
  await b.close();
})();
