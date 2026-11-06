// Where a road a car drives has no floor at its height (issue 119): load the game and, along every piece
// of the road network (a point every 2 m, as route.js looks), find the points where nav.floorAt finds no
// floor within 2 m of the road; for each, say what is there: the decks at that spot (any height, and
// whether the walker's floor takes them), the ground, and the road's class. Then a count by cause. It
// looks as route.js does: at the height a car drives at (the deck's, or the ground's), on a car's floor.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/deck_gaps.js tokyo [--all] [--walker]
const { chromium } = require('playwright');
const [,, city = 'tokyo', flag] = process.argv; // --walker: as before issue 119 (a walker's floor, at the line's height)
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.waitForFunction('window.__game.ways.ready', null, { timeout: 300000 }).catch(() => {});
  const r = await p.evaluate(raw => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game, nav = g.nav, RL = g.roadNet.L, q = {}, out = [], by = {};
    RL.forEach((l, li) => {
      const n = Math.max(1, Math.ceil(l.len / 2));
      let first = null, cnt = 0;
      for (let j = 0; j <= n; j++) {
        g.roadNet.at(li, l.len * j / n, q);
        const zl = q.z;
        if (!raw && !q.deck) { const s = nav.surfaceAt(q.x, q.y); q.z = s > -Infinity && Math.abs(s - q.z) < 1.5 ? s : nav.offGround(q.x, q.y) ? q.z : nav.terrain(q.x, q.y); }
        const f = nav.floorAt(q.x, q.y, q.z + 0.6, !raw);
        if (f && Math.abs(f.z - q.z) <= 2) continue;
        cnt++;
        if (first) continue;
        const decks = [];
        nav.decksAt(q.x, q.y, (h, d) => decks.push({ h: +h.toFixed(1), walk: d.walk }));
        const t = nav.terrain(q.x, q.y);
        const near = decks.filter(d => Math.abs(d.h - q.z) <= 2);
        const cause = near.length ? (near.some(d => d.walk) ? 'deck there, walkable (?)' : 'deck there, not walkable (motorway)')
          : decks.length ? 'deck at another height' : q.z - t > 2 ? 'no deck, road high over ground' : q.z - t < -2 ? 'road below ground' : 'other';
        first = { li, c: l.c, line: +zl.toFixed(1), ow: l.ow || 0, at: [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)], ground: +t.toFixed(1), floor: f ? [+f.z.toFixed(1), f.kind] : null, decks, cause, len: +l.len.toFixed(0) };
      }
      if (first) { first.lost = cnt; out.push(first); by[first.cause] = (by[first.cause] || 0) + 1; }
    });
    return { out, by, pieces: RL.length };
  }, flag === '--walker' || process.argv.includes('--walker'));
  for (const o of (process.argv.includes('--all') ? r.out : r.out.slice(0, 40))) console.log(JSON.stringify(o));
  console.log(`${city}: ${r.pieces} pieces, ${r.out.length} with no floor at the road's height; by cause ${JSON.stringify(r.by)}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
