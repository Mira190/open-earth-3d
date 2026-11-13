// Walk the levels of a city's rooms (game.json "interiors" with a "route": [[x, y, z], ...], the Opera House's
// foyers, cities/sydney/opera_inside.py): stand at the route's first point, then walk to each of the others as
// the game's own walk-to does (player.auto) and check that you get there, at that point's level (up a flight to a
// gallery, down the broad stair). For tools/game_check.js (module) and on its own:
//   xvfb-run -a node tools/foyer_walk.js sydney     (web/ served on PORT or 8800)
// Returns [{ id, ok, legs: [{ to, reached, z, want, secs }], why }].
'use strict';
async function walkRoutes(p) {
  return p.evaluate(() => {
    const g = window.__game, pl = g.player, out = [];
    for (const r of g.G.interiors || []) {
      if (!r.route) continue;
      const [x0, y0, z0] = r.route[0], s = g.nav.stand(x0, y0, z0 + 0.5, { rMax: 2 }) || { x: x0, y: y0, z: z0 };
      Object.assign(pl, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, ground: true, vz: 0, speed: 0, auto: null });
      g.advance(0.2);
      const legs = [];
      // (the game's walk-to gives up after 5 s: each leg in steps of 5 m or less)
      const pts = [];
      r.route.forEach((q, i) => { if (!i) return; const a = r.route[i - 1], n = Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / 5);
        for (let k = 1; k <= n; k++) pts.push([a[0] + (q[0] - a[0]) * k / n, a[1] + (q[1] - a[1]) * k / n, k === n ? q[2] : null]); });
      for (const [x, y, z] of pts) {
        let done = false, t = 0;
        pl.auto = { x, y, t: 0, label: 'walk', then: () => { done = true; }, cancel: () => {} };
        while (!done && t < 40) { g.advance(0.1); t += 0.1; if (!pl.auto && !done) break; }
        const d = Math.hypot(pl.x - x, pl.y - y);
        legs.push({ at: [+pl.x.toFixed(2), +pl.y.toFixed(2)], to: [x, y], reached: d < 1.2, d: +d.toFixed(2), z: +pl.z.toFixed(2), want: z, secs: +t.toFixed(1) });
        if (d > 1.2) { pl.auto = null; break; }
      }
      const bad = legs.filter(l => !l.reached || (l.want != null && Math.abs(l.z - l.want) > 0.45));
      out.push({ id: r.id, ok: legs.length === pts.length && !bad.length, legs, why: bad.map(l => `${l.reached ? 'at' : `${l.d} m short of`} [${l.to.map(v => v.toFixed(1))}] on ${l.z} (want ${l.want})`).join('; ') });
    }
    return out;
  });
}
module.exports = walkRoutes;
if (require.main === module) {
  const { chromium } = require('playwright');
  const city = process.argv[2] || 'sydney';
  (async () => {
    const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
    await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* blocked */ } });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    await p.evaluate(() => { const g = window.__game; g.hold(true, true); for (let i = 0; i < 80; i++) g.advance(0.25); });
    for (const r of await walkRoutes(p)) console.log(r.ok ? 'ok  ' : 'FAIL', r.id, process.env.DEBUG ? JSON.stringify(r.legs) : '', r.ok ? r.legs.filter(l => l.want != null).map(l => `${l.z}`).join(' → ') : r.why);
    console.log(errs.length ? errs.join('\n') : 'no page errors');
    await b.close();
  })();
}
