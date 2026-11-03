// Where the street traffic stops at a wall: run a city's traffic headlessly at the start and at
// traffic_check.js's places, the player standing there (so the cars near are in sight, where one
// stopped at a wall stays rather than leaving the traffic), and list each spot where a car stood
// still with a wall across its way (c.why 'wall'), with the road it was on, the lane, how far
// ahead the wall was, and what the wall is: a building's footprint (its id, kind and height), a
// canopy's post (an arcade or a gate) or a landmark. Exits 1 when any car stopped at a wall.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/wall_stops.js osaka [seconds per place=90] [places=4]
// GAME_TIME pins the clock, as for tools/game_check.js.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'osaka', secs = '90', places = '4'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], spots = new Map();
  for (let site = 0; site < Number(places); site++) {
    const p = await b.newPage({ viewport: { width: 800, height: 500 } });
    await pinClock(p, city);
    p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    const r = await p.evaluate(([T, site]) => {
      window.requestAnimationFrame = () => 0; // the game's frame loop stops: the run steps only here
      const g = window.__game, A = g.cars, C = A.C, L = A.netL, nav = g.nav;
      if (site > 0) { // as traffic_check.js picks its places
        const d = l => Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y);
        const cand = L.filter(l => l.len > 40 && d(l) > 250 * site && d(l) < 300 * site + 200);
        if (cand.length) { const l = cand[(site * 7919) % cand.length], k = Math.floor(l.pts.length / 6) * 3;
          const ex = l.pts[k + 3] - l.pts[k], ey = l.pts[k + 4] - l.pts[k + 1], el = Math.hypot(ex, ey) || 1;
          let off = 7.5;
          for (const o of [6, -6, 9, -9, 12, -12, 16, -16]) if (!g.roadNet.nearest(l.pts[k] - ey / el * o, l.pts[k + 1] + ex / el * o, 5)) { off = o; break; }
          g.player.x = l.pts[k] - ey / el * off; g.player.y = l.pts[k + 1] + ex / el * off; g.player.z = l.pts[k + 2]; }
      }
      // what a body of radius r at (x, y), knee to 1.4 m above z, touches: each solid it overlaps on its own
      const what = (x, y, z, r) => {
        const cand = [];
        nav.col.overlap(x, y, r + 0.5, z + 0.4, z + 1.4, (pi, pr) => { cand.push([pi, pr]); return true; });
        const out = [];
        for (const [pi, pr] of cand) if (nav.col.overlap(x, y, r, z + 0.4, z + 1.4, q => q !== pi)) {
          const meta = pr.tag === nav.BUILDING && g.B && g.B.b ? g.B.b[pr.id] : null;
          const post = pr.tag === nav.BUILDING && pr.rings && pr.rings[0] && pr.rings[0].length === 8 && Math.abs(pr.rings[0][2] - pr.rings[0][0]) < 0.6;
          out.push(`${pr.tag === nav.LANDMARK ? 'landmark' : post ? 'canopy post' : 'building'} ${pr.id}${meta ? ` (${meta.slice(0, 3).join(' ')})` : ''} z ${pr.zlo.toFixed(1)}..${pr.zhi.toFixed(1)}`);
        }
        return out;
      };
      const found = [];
      for (let t = 0; t < T; t++) {
        g.advance(1);
        if (t < 5) continue;
        for (const c of C) {
          if (c.line < 0 || c.why !== 'wall' || !c.ps || !c.np) continue;
          const k = Math.min(c.np - 1, Math.round((c.wallGap || 0) / (c.pst || 1))), x = c.ps[2 * k], y = c.ps[2 * k + 1];
          const l = L[c.line], d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
          found.push({ stopped: c.v < 0.1, v: +c.v.toFixed(1), key: `${Math.round(x / 4)},${Math.round(y / 4)}`, x: +x.toFixed(1), y: +y.toFixed(1), z: +c.z.toFixed(1), car: C.indexOf(c), line: c.line, ow: !!l.ow, lanes: l.lanes || 1, w: l.w, kind: l.kind || l.hw || '', lane: c.ln, lo: +(c.lo || 0).toFixed(2), off: +(c.off || 0).toFixed(2), ahead: +(c.wallGap || 0).toFixed(1), seen: +d.toFixed(0), narrow: +(c.narrow || 0).toFixed(1), hits: what(x, y, c.z, c.hw * 0.8), centre: what(c.ps[2 * k] + 0, c.ps[2 * k + 1] + 0, c.z, 0.1).length });
        }
      }
      return { player: [Math.round(g.player.x), Math.round(g.player.y)], found };
    }, [Number(secs), site]);
    for (const f of r.found) {
      const s = spots.get(f.key) || Object.assign({ n: 0, braked: 0, site, cars: new Set() }, f);
      if (f.stopped) s.n++; else s.braked++;
      s.cars.add(f.car); spots.set(f.key, s);
    }
    console.log(`place ${site} at ${r.player}: ${r.found.filter(f => f.stopped).length} car-seconds stopped at a wall, ${r.found.filter(f => !f.stopped).length} braking for one`);
    await p.close();
  }
  const stops = [...spots.values()].filter(s => s.n > 0);
  for (const s of [...spots.values()].sort((a, b) => b.n - a.n || b.braked - a.braked)) {
    console.log(`at ${s.x}, ${s.y} (z ${s.z}, place ${s.site}): ${s.n} car-seconds stopped, ${s.braked} braking (v ${s.v}), by ${s.cars.size} car(s), line ${s.line}${s.ow ? ' one-way' : ''} ${s.kind} lanes ${s.lanes} w ${s.w}, lane ${s.lane} lo ${s.lo} off ${s.off}, the wall ${s.ahead} m ahead, ${s.seen} m from you; ${s.hits.join('; ') || 'nothing at the point (between checks)'}`);
  }
  for (const e of errors) console.log('pageerror', e);
  await b.close();
  console.log(stops.length ? `FAIL ${stops.length} places where cars stop at a wall` : 'ok   no car stops at a wall');
  process.exit(stops.length || errors.length ? 1 : 0);
})();
