// The game's generic decks (web/game/decks.js) that stand low over dry ground: a road carried over a
// shallow dip in the street (issue 234: Chuo-dori at Nihonbashi's south bank), and whether each is drawn
// with parapets. A deck under RISE over the ground all along, off the water, is part of the street, and
// parapets on it stand across the carriageway. Prints each such run (kind, class, length, highest point
// over the ground drawn under it, centre, parapets), then a count.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/deck_parapets.js tokyo
const { chromium } = require('playwright');
const [,, city = 'tokyo'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('page error:', e.message));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const r = await p.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game, nav = g.nav, out = [];
    for (const run of g.deckPlan.runs) {
      if (run.pts.some(q => nav.isWater(q[0], q[1]))) continue;
      let hi = -Infinity, len = 0;
      run.pts.forEach((q, i) => {
        hi = Math.max(hi, q[2] - nav.terrain(q[0], q[1]));
        if (i) len += Math.hypot(q[0] - run.pts[i - 1][0], q[1] - run.pts[i - 1][1]);
      });
      if (hi >= OEDecks.RISE) continue;
      const m = run.pts[Math.floor(run.pts.length / 2)];
      out.push({ kind: run.kind, c: run.c, len: +len.toFixed(1), over: +hi.toFixed(2), at: [Math.round(m[0]), Math.round(m[1])], parapet: run.parapet !== false });
    }
    return out;
  });
  for (const o of r) console.log(`${o.parapet ? 'PARAPET' : 'open   '} ${o.kind} ${o.c} ${o.len} m long, ${o.over} m over the ground at most, at (${o.at})`);
  console.log(`${city}: ${r.length} low decks over dry ground, ${r.filter(o => o.parapet).length} with parapets`);
  await b.close();
})();
