// What decks.js's grading of overlapping decks (together) is given, written to a file, so that the grading can be run
// and measured again in Node without loading the game (tools/deck_grade.js): the lines, their pieces of deck, and
// every answer the walkable map gave it (the ground, the water, the bridges' strips).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/deck_dump.js shibuya out/decks_shibuya.json
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'shibuya', out = `decks_${city}.json`] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.route('**/game/decks.js*', async route => {
    const r = await route.fetch();
    let src = await r.text();
    const at = 'const crossing = together(runs, segs, recs, nav, near);';
    if (!src.includes(at)) throw new Error('decks.js: the call to together() has moved');
    src = src.replace(at, `
      const T = new Map(), W = new Map(), S = new Map(), k2 = (x, y) => x.toFixed(2) + ',' + y.toFixed(2);
      const rec = Object.assign(Object.create(nav), {
        terrain: (x, y) => { const z = nav.terrain(x, y); T.set(k2(x, y), +z.toFixed(3)); return z; },
        isWater: (x, y) => { const w = nav.isWater(x, y); if (w) W.set(k2(x, y), 1); return w; },
        stripHeight: (s, x, y) => { const z = nav.stripHeight(s, x, y); if (z != null) S.set(nav.strips.indexOf(s) + '|' + k2(x, y), +z.toFixed(3)); return z; },
      });
      window.__deckDump = JSON.stringify({
        segs, runs: runs.map(r => ({ li: r.li, from: r.from, pts: r.pts, w: r.w, kind: r.kind, c: r.c, lift: r.lift })),
        recs: recs.map(r => ({ o: { c: r.o.c, o: r.o.o, nl: r.o.nl, cw: r.o.cw, p: Array.from(r.o.p) }, cls: Array.from(r.cls), zs: Array.from(r.zs), kind: r.kind })),
        strips: (nav.strips || []).map(s => ({ box: s.box, name: s.name || s.mesh, thickness: s.thickness })),
      });
      const crossing = together(runs, segs, recs, rec, near);
      window.__deckNav = JSON.stringify({ T: [...T], W: [...W.keys()], S: [...S] });`);
    await route.fulfill({ response: r, body: src });
  });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__deckNav || window.__gameError', null, { timeout: 600000 });
  const d = JSON.parse(await p.evaluate('window.__deckDump'));
  d.nav = JSON.parse(await p.evaluate('window.__deckNav'));
  fs.writeFileSync(out, JSON.stringify(d));
  console.log(`${city}: ${d.segs.length} pieces of deck on ${d.recs.length} lines -> ${out}`);
  await b.close();
})();
