// Where a deck (decks.js: the bridges and viaducts the data maps as lines) stands too low over a surface it crosses: a
// bridge's strip, a pier, another deck. Something walking that surface has its body from its feet + 0.4 m to its feet
// + 1.8 m (nav.js KNEE and HEAD); a deck whose slab reaches into that band over it is one that walkers pass through
// (#399: Okazaki-michi's ramp laid down across the Shirakawa bridge's strip with a metre of room under it). Samples
// each deck piece every metre along and across, and prints each place where a deck is in a walker's body on the
// surface under it (how much room, the deck, the surface); exits 1 when there is any.
//   python3 -m http.server 8800 --directory web &
// The crowd's lanes (game.js crowdNet) are measured the same way: no lane may take a walker under a deck or a strip
// with less than that room (#399: they crossed under decks' low ends where the data lays a crossing there).
//   xvfb-run -a node tools/deck_room.js tetsugaku
const { chromium } = require('playwright');
const [,, city = 'tetsugaku'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game || window.__gameError', null, { timeout: 600000 });
  const res = await p.evaluate(() => {
    const g = window.__game, nav = g.nav, KNEE = 0.4, HEAD = 1.8, out = [];
    for (const d of g.deckPlan.segs) {
      const L = Math.hypot(d.bx - d.ax, d.by - d.ay) || 1, ex = (d.bx - d.ax) / L, ey = (d.by - d.ay) / L;
      for (let u = 0; u <= L; u += 1) for (let v = -d.hw + 0.3; v <= d.hw - 0.3 + 1e-6; v += Math.max(0.5, (d.hw - 0.3) / 2)) {
        const x = d.ax + ex * u - ey * v, y = d.ay + ey * u + ex * v, h = d.az + (d.bz - d.az) * u / L, lo = h - (d.th || 0.9);
        const under = [];
        for (const s of nav.strips) { const z = nav.stripHeight(s, x, y); if (z != null) under.push([z, `strip ${s.name || s.mesh}`]); }
        // (not a piece of deck joined to this one, end to end: a ramp's next piece, a line meeting it at a junction)
        const joined = o => [[o.ax, o.ay, o.az], [o.bx, o.by, o.bz]].some(a => [[d.ax, d.ay, d.az], [d.bx, d.by, d.bz]].some(c => Math.hypot(a[0] - c[0], a[1] - c[1]) < 3 && Math.abs(a[2] - c[2]) < 1));
        nav.decksAt(x, y, (z, o) => { if (o !== d && !joined(o)) under.push([z, `a deck from [${o.ax.toFixed(0)}, ${o.ay.toFixed(0)}, ${o.az.toFixed(1)}] to [${o.bx.toFixed(0)}, ${o.by.toFixed(0)}, ${o.bz.toFixed(1)}]`]); });
        for (const [z, what] of under) if (h > z + KNEE && lo < z + HEAD) out.push({ x: +x.toFixed(1), y: +y.toFixed(1), h: +h.toFixed(2), room: +(lo - z).toFixed(2), what, deck: `[${d.ax.toFixed(0)}, ${d.ay.toFixed(0)}, ${d.az.toFixed(1)}] to [${d.bx.toFixed(0)}, ${d.by.toFixed(0)}, ${d.bz.toFixed(1)}]` });
      }
    }
    // and the crowd's lanes (game.js crowdNet): a walker on one under a deck or a strip, in its body
    for (const l of g.crowdNet.L) for (let u = 0; u <= l.len; u += 1) {
      let i = 1;
      while (i < l.cum.length - 1 && l.cum[i] < u) i++;
      const t = Math.max(0, Math.min(1, (u - l.cum[i - 1]) / Math.max(1e-6, l.cum[i] - l.cum[i - 1]))), P = l.pts;
      const x = P[3 * i - 3] + (P[3 * i] - P[3 * i - 3]) * t, y = P[3 * i - 2] + (P[3 * i + 1] - P[3 * i - 2]) * t, z = P[3 * i - 1] + (P[3 * i + 2] - P[3 * i - 1]) * t;
      const over = [];
      for (const s of nav.strips) { const h = nav.stripHeight(s, x, y); if (h != null) over.push([h, s.thickness || 3, `strip ${s.name || s.mesh}`]); }
      nav.decksAt(x, y, (h, d) => over.push([h, d.th || 0.9, `a deck from [${d.ax.toFixed(0)}, ${d.ay.toFixed(0)}, ${d.az.toFixed(1)}] to [${d.bx.toFixed(0)}, ${d.by.toFixed(0)}, ${d.bz.toFixed(1)}]`]));
      for (const [h, th, what] of over) if (h > z + KNEE && h - th < z + HEAD) out.push({ x: +x.toFixed(1), y: +y.toFixed(1), h: +z.toFixed(2), room: +(h - th - z).toFixed(2), what, deck: `a crowd lane (${l.c || 'footway'})`, lane: true });
    }
    return out;
  });
  // one line per place (the samples within 6 m of each other)
  const groups = [];
  for (const r of res) { const g = groups.find(q => Math.hypot(q[0].x - r.x, q[0].y - r.y) < 6 && q[0].what === r.what); if (g) g.push(r); else groups.push([r]); }
  for (const q of groups) {
    const lo = q.reduce((m, r) => Math.min(m, r.room), Infinity);
    console.log(q[0].lane ? `LANE [${q[0].x}, ${q[0].y}] ${q[0].deck} at ${q[0].h} m under ${q[0].what}, ${lo.toFixed(2)} m of room under it (${q.length} samples)` : `LOW  [${q[0].x}, ${q[0].y}] the deck ${q[0].deck} at ${q[0].h} m over ${q[0].what}, ${lo.toFixed(2)} m of room under its slab (${q.length} samples)`);
  }
  const cr = await p.evaluate(() => window.__game.deckPlan.crossing);
  if (cr) console.log(`(decks graded together in ${cr.rounds} rounds, ${cr.ms} ms, ${cr.left} samples left; points moved: ${cr.over2} over 2 m, at most ${cr.maxMove} m)`);
  if (!groups.length) console.log(`ok   ${city}: no deck stands in the body of someone on a surface under it, nor over a crowd's lane`);
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await b.close();
  process.exit(groups.length ? 1 : 0);
})();
