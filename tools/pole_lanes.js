// Signal poles and walk posts that stand in a road's lanes (within its drawn width, any road, not
// just the one they serve), per city: the owner found one out in the lanes at Shibuya.
//   xvfb-run -a node tools/pole_lanes.js shibuya [shinjuku ...]
const { chromium } = require('playwright');
const HALF = { motorway: 7, trunk: 6, primary: 6, secondary: 5, tertiary: 4.5, residential: 3.5, unclassified: 3, living_street: 2.5 };
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  let bad = 0;
  for (const city of process.argv.slice(2)) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.junctions && window.__game.junctions.heads', null, { timeout: 600000 });
    const r = await p.evaluate(HALF => {
      const g = window.__game, H = g.junctions.heads, net = g.roadNet, out = [];
      for (const [kind, L] of [['signal', H.list], ['walk', H.peds]]) for (const o of L) {
        const q = net.nearest(o.x, o.y, 10, o.z, 3);
        if (q && q.d < (HALF[net.L[q.line].c] || 3.5) - 0.2) out.push(`${kind} ${o.x.toFixed(1)},${o.y.toFixed(1)} ${q.d.toFixed(1)} m from a ${net.L[q.line].c}'s middle${o.a.j.scramble ? ' (scramble)' : ''}`);
      }
      return { n: H.list.length + H.peds.length, out };
    }, HALF);
    console.log(`${city}: ${r.out.length} of ${r.n} in a road's lanes`);
    for (const l of r.out.slice(0, 12)) console.log('  ' + l);
    bad += r.out.length;
    await p.close();
  }
  await b.close();
})();
