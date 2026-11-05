// The Shibuya scramble at the start of the game (#110): where the player stands, the junction's phase,
// the walkers near the player and on the crossings, and the footway lines that cross its roads.
//   xvfb-run -a node tools/scramble_probe.js [city] [seconds]
const { chromium } = require('playwright');
const [,, city = 'shibuya', secs = '3'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const out = await p.evaluate(async secs => {
    const g = window.__game, S = (g.scene.landmarks || {}).scramble, res = [];
    const snap = t => {
      const pl = g.player, J = g.junctions;
      const j = S && J.J ? J.J.filter(j => j.scramble)[0] : null;
      const near = g.crowd.P.filter(q => q.line >= 0 && Math.hypot(q.x - pl.x, q.y - pl.y) < 10);
      return { t, at: [+pl.x.toFixed(1), +pl.y.toFixed(1), +pl.z.toFixed(2)], h: +(pl.h * 180 / Math.PI).toFixed(0), arriving: g.arriving(),
        ph: j ? [j.ph, j.st, +j.t.toFixed(1)] : null, within10: near.length, moving10: near.filter(q => q.v > 0.3).length,
        cam: [g.camera.position.x, -g.camera.position.z, g.camera.position.y].map(v => +v.toFixed(1)) };
    };
    res.push(snap(0));
    for (let t = 0.5; t <= secs; t += 0.5) { g.advance(0.5); await new Promise(r => requestAnimationFrame(r)); res.push(snap(t)); }
    const X = [];
    for (const [line, xs] of g.crowd.crossings.byLine) for (const x of xs) if (x.scramble) X.push({ line, s: +x.s.toFixed(1), kerb: +x.kerb.toFixed(1) });
    return { res, crossings: X, start: g.G.start };
  }, +secs);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
