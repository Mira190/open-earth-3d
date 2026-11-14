// Pinch streets (#409): where a road the traffic drives is narrower than a car because a landmark's fine walls
// stand into it. The road pass (game.js cutAtWalls) cuts the roads at the coarse walls only (nav.withoutFine), so a
// fine wall that stands into the carriageway is not seen there: the autopilot passes on its line, a car you drive
// is stopped. (A place the road pass sees is cut out of the road, so every place left is one it missed: a wall 0.5 to
// 0.95 m from the middle, or a fine one.) Plays a city's game headless (web/ served on PORT or 8800, under xvfb-run), walks every road piece's
// middle every 2 m with a car's half width (0.95 m) and prints each place a wall pushes it off, with and without the
// fine walls, grouped by piece.
//   xvfb-run -a node tools/pinch_probe.js shibuya [radius]   (radius: only within that many metres of the start; default all)
const { chromium } = require('playwright');
(async () => {
  const city = process.argv[2] || 'shibuya', radius = +(process.argv[3] || 1e9);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && window.__game.cars && window.__game.roadNet, null, { timeout: 600000 });
  await p.evaluate(() => window.__game.advance(1));
  const out = await p.evaluate(radius => {
    const g = window.__game, L = g.roadNet.L, nav = g.nav, pl = g.player, q = {}, HW = 0.95, res = [];
    if (nav.layAll) nav.layAll(); // (every tile's fine walls, not only those near the player)
    let pieces = 0, metres = 0;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (l.deck) continue; // (a deck's rails are not walls)
      let hits = [];
      for (let s = 2; s < l.len - 2; s += 2) {
        g.roadNet.at(i, s, q);
        if (Math.hypot(q.x - pl.x, q.y - pl.y) > radius) continue;
        metres += 2;
        const r = nav.push(q.x, q.y, q.z, HW, 1.6), d = Math.hypot(r.x - q.x, r.y - q.y);
        if (d < 0.05) continue;
        hits.push({ s: Math.round(s), x: Math.round(q.x), y: Math.round(q.y), push: +d.toFixed(2), fine: !nav.withoutFine(() => nav.solid(q.x, q.y, q.z, 0.5)) });
      }
      pieces++;
      if (hits.length) res.push({ line: i, cls: l.c, len: Math.round(l.len), n: hits.length, fineOnly: hits.filter(h => h.fine).length, first: hits[0], worst: hits.reduce((a, h) => (h.push > a.push ? h : a)) });
    }
    return { pieces, metres, pinched: res.sort((a, b) => b.n - a.n) };
  }, radius);
  const fine = out.pinched.filter(r => r.fineOnly > 0);
  console.log(`${city}: ${out.pieces} road pieces, ${(out.metres / 1000).toFixed(1)} km walked; ${out.pinched.length} pieces where a car's body meets a wall on the road's middle, ${fine.length} of them where the road pass (a 0.5 m circle, coarse walls) sees none`);
  for (const r of out.pinched.slice(0, 40)) console.log(`  piece ${r.line} (${r.cls}, ${r.len} m): ${r.n} places (${r.fineOnly} not seen by the road pass), worst ${r.worst.push} m at ${r.worst.x},${r.worst.y}`);
  await b.close();
})();
