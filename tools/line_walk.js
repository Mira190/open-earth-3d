// Walk mapped lines end to end in a city's game, on foot, both ways: a torii tunnel, a covered corridor,
// a flight of steps, anything the models must let a walker through (#161, #167).
//   xvfb-run -a node tools/line_walk.js fushimi-inari tools/walks/fushimi-inari.json
// walks.json: [{"name": "Senbon Torii, the way up", "pts": [[x, y], ...], "z": 115.25}, ...] in the city's
// local frame (x east, y north, metres; z, if given, the level to start on: a stage over the ground, not the
// ground under it). From the first point (where one can
// stand within 2 m) the walker steers through the points one after another, as tools/passage_walk.js does
// (claude/passages-120), and must reach the last within a metre and never climb or drop more than `drop` m
// (1.2 by default) between two steps' floors. Prints one line per walk and exits 1 if any failed.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'fushimi-inari', file] = process.argv;
const walks = JSON.parse(fs.readFileSync(file, 'utf8'));
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('page error:', e.message));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.advance(1));
  const out = await p.evaluate(W => {
    const g = window.__game, nav = g.nav, pl = g.player, res = [];
    for (const w of W) for (const rev of [false, true]) {
      const pts = rev ? w.pts.slice().reverse() : w.pts;
      const r = { name: w.name + (rev ? ' (back)' : ''), ok: false };
      const f = nav.stand(pts[0][0], pts[0][1], Math.max(nav.terrain(pts[0][0], pts[0][1]), w.z || -Infinity) + 0.5, { rMax: 2.0 });
      if (!f) { r.why = 'nowhere to stand at its start'; res.push(r); continue; }
      Object.assign(pl, { mode: 'foot', vehicle: null, x: f.x, y: f.y, z: f.z, ground: true, vz: 0, speed: 0 });
      let k = 1, still = 0, best = Infinity, jump = 0, lastZ = pl.z, t = 0;
      for (let i = 0; i < 6000 && k < pts.length; i++) {
        const [tx, ty] = pts[k], d = Math.hypot(tx - pl.x, ty - pl.y);
        if (d < (k === pts.length - 1 ? 1.0 : 1.3)) { k++; best = Infinity; still = 0; continue; }
        if (d < best - 0.05) { best = d; still = 0; } else if (++still > 80) break;
        pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
        g.advance(0.05, ['KeyW']); t += 0.05;
        jump = Math.max(jump, Math.abs(pl.z - lastZ)); lastZ = pl.z;
      }
      const [ex, ey] = pts[pts.length - 1];
      r.d = +Math.hypot(ex - pl.x, ey - pl.y).toFixed(1); r.s = +t.toFixed(0); r.jump = +jump.toFixed(2);
      r.ok = k >= pts.length && jump <= (w.drop || 1.2);
      if (k < pts.length) { r.why = `stopped ${r.d} m short of its end`; r.at = [+pl.x.toFixed(1), +pl.y.toFixed(1), +pl.z.toFixed(2)]; }
      else if (!r.ok) r.why = `a step of ${r.jump} m`;
      res.push(r);
    }
    return res;
  }, walks);
  let bad = 0;
  for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.ok ? `${r.s} s, largest step ${r.jump} m` : r.why}${r.at ? ' at ' + JSON.stringify(r.at) : ''}`); }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
