// Where a city's roads run into a wall: load the game and walk every road of game.json as the
// game's cutAtWalls does (a point every 1.5 m, a circle of 0.5 m between knee and head height over
// the floor there; not over a deck), and list each stretch where the road is cut, with what it runs
// into: a building's solid (its id, class and height range), a canopy's post, or a landmark. Then a
// count by kind; then, as route.js does, each piece the traffic keeps off because a car doesn't fit
// along it, with what is in its way (--json: the list, with the points of each stretch, for pipeline/road_passages.py). A road the data runs through a building ends at its wall in the game's traffic.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/road_walls.js osaka [--json out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'osaka', ...rest] = process.argv;
const jsonOut = rest[0] === '--json' ? rest[1] : null;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.waitForFunction('window.__game.ways.ready', null, { timeout: 300000 }).catch(() => {}); // (route.js's flags)
  const r0 = await p.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game, nav = g.nav, roads = g.G.paths.road, out = [];
    const what = (x, y, z) => {
      const f = nav.floorAt(x, y, z + 0.3), fz = f ? f.z : z, ids = [];
      nav.col.overlap(x, y, 0.5, fz + 0.4, fz + 1.8, (pi, pr) => {
        if (pr.tag === nav.BUILDING && pr.zhi <= fz + 0.75) return true;
        const post = pr.tag === nav.BUILDING && pr.rings && pr.rings[0] && pr.rings[0].length === 8 && Math.abs(pr.rings[0][2] - pr.rings[0][0] - OEBuildings.POST) < 0.02 && Math.abs(pr.rings[0][5] - pr.rings[0][1] - OEBuildings.POST) < 0.02;
        const h = { kind: pr.tag === nav.LANDMARK ? 'landmark' : post ? 'post' : 'building', id: pr.id, zlo: +pr.zlo.toFixed(1), zhi: +pr.zhi.toFixed(1) };
        if (post) { const q = pr.rings[0]; h.x = +((q[0] + q[4]) / 2).toFixed(2); h.y = +((q[1] + q[5]) / 2).toFixed(2); }
        ids.push(h);
        return true;
      });
      return ids;
    };
    roads.forEach((l, li) => {
      const pp = l.p, n = pp.length / 3;
      let run = null;
      const end = () => { if (run) { out.push(run); run = null; } };
      for (let k = 0; k < n; k++) {
        const ms = k ? Math.max(1, Math.ceil(Math.hypot(pp[3 * k] - pp[3 * k - 3], pp[3 * k + 1] - pp[3 * k - 2]) / 15)) : 1;
        for (let j = k ? 1 : 0; j <= (k ? ms : 0); j++) {
          const t = k ? j / ms : 0, a = k ? k - 1 : 0;
          const x = (pp[3 * a] + (pp[3 * k] - pp[3 * a]) * t) / 10, y = (pp[3 * a + 1] + (pp[3 * k + 1] - pp[3 * a + 1]) * t) / 10, z = (pp[3 * a + 2] + (pp[3 * k + 2] - pp[3 * a + 2]) * t) / 10;
          const deck = l.d && k > 0 ? l.d[k - 1] : 0;
          if (!deck && nav.solid(x, y, z, 0.5)) {
            if (!run) run = { road: li, c: l.c, ow: l.o || 0, at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], m: 0, hits: {} };
            run.m += 1.5; run.to = [+x.toFixed(1), +y.toFixed(1)];
            const f = nav.floorAt(x, y, z + 0.3);
            (run.pts || (run.pts = [])).push([+x.toFixed(2), +y.toFixed(2), +(f ? f.z : z).toFixed(2)]);
            for (const h of what(x, y, z)) run.hits[`${h.kind} ${h.id}${h.kind === 'post' ? ` ${h.x},${h.y}` : ` ${h.zlo}`}`] = h;
          } else end();
        }
      }
      end();
    });
    // and as route.js then looks along each piece for a car (a point every 2 m: a floor near the road's
    // height, and room for a circle of 0.9 m up to 1.6 m over it); a piece where it hasn't is one the
    // traffic keeps off (net.avoid)
    const RL = g.roadNet.L, noFloor = new Set();
    RL.forEach((l, li) => {
      const n = Math.max(1, Math.ceil(l.len / 2)), q = {};
      let run = null;
      const end = () => { if (run) { out.push(run); run = null; } };
      for (let j = 0; j <= n; j++) {
        g.roadNet.at(li, l.len * j / n, q);
        const f = nav.floorAt(q.x, q.y, q.z + 0.6);
        // (no floor at the road's height: a deck's heights, counted below; a wall only where a building stands
        // at the road's own height there, an elevated road run into a tower: then measured from the road)
        const lost = !f || Math.abs(f.z - q.z) > 2;
        if (lost) noFloor.add(li);
        if (lost ? !nav.col.overlap(q.x, q.y, 0.9, q.z + 0.4, q.z + 1.6, (pi, pr) => pr.tag !== nav.BUILDING) : nav.room(q.x, q.y, f.z, 0.9, 1.6, nav.isDeck(f.kind))) { end(); continue; }
        if (!run) run = { road: `piece ${li}`, c: l.c, ow: l.ow || 0, at: [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)], m: 0, hits: {}, room: true };
        run.m += l.len / n; run.to = [+q.x.toFixed(1), +q.y.toFixed(1)];
        const fz = f && !lost ? f.z : q.z;
        (run.pts || (run.pts = [])).push([+q.x.toFixed(2), +q.y.toFixed(2), +fz.toFixed(2)]);
        nav.col.overlap(q.x, q.y, 0.9, fz + 0.4, fz + 1.6, (pi, pr) => {
          if (pr.tag === nav.BUILDING && (pr.zhi <= fz + 0.75 || (!lost && f && nav.isDeck(f.kind) && pr.zhi <= fz + 2))) return true;
          if (lost && pr.tag !== nav.BUILDING) return true;
          const post = pr.tag === nav.BUILDING && pr.rings && pr.rings[0] && pr.rings[0].length === 8 && Math.abs(pr.rings[0][2] - pr.rings[0][0] - OEBuildings.POST) < 0.02 && Math.abs(pr.rings[0][5] - pr.rings[0][1] - OEBuildings.POST) < 0.02;
          const h = { kind: pr.tag === nav.LANDMARK ? 'landmark' : post ? 'post' : 'building', id: pr.id, zlo: +pr.zlo.toFixed(1), zhi: +pr.zhi.toFixed(1) };
          if (post) { const r = pr.rings[0]; h.x = +((r[0] + r[4]) / 2).toFixed(2); h.y = +((r[1] + r[5]) / 2).toFixed(2); }
          run.hits[`${h.kind} ${h.id}${post ? ` ${h.x},${h.y}` : ` ${h.zlo}`}`] = h;
          return true;
        });
      }
      end();
    });
    const B = g.B && g.B.b;
    for (const o of out) { o.hits = Object.values(o.hits); for (const h of o.hits) if (h.kind !== 'landmark' && B && B[h.id]) h.cls = B[h.id][1]; }
    return { out, noFloor: noFloor.size, flagged: g.roadNet.avoid ? g.roadNet.avoid.reduce((a, v) => a + v, 0) : null, pieces: RL.length };
  });
  const { noFloor, flagged, pieces } = r0, r = r0.out;
  const by = {};
  for (const o of r) { const k = (o.room ? 'too narrow for a car: ' : '') + (o.hits.length ? [...new Set(o.hits.map(h => h.kind))].join('+') : 'surface model only'); by[k] = (by[k] || 0) + 1; }
  for (const o of r.sort((a, b) => b.m - a.m).slice(0, 40)) console.log(`${o.room ? '' : 'road '}${o.road} ${o.c}${o.ow ? ' one-way' : ''} at ${o.at} for ${o.m} m: ${o.hits.map(h => `${h.kind} ${h.id}${h.cls ? ` (${h.cls})` : ''} z ${h.zlo}..${h.zhi}`).join('; ') || 'nothing (the surface model)'}`);
  console.log(`${city}: ${pieces} road pieces, ${flagged} kept off by the traffic (route.js), ${noFloor} with no floor at the road's height somewhere (a deck's heights, not a wall)`);
  console.log(`${city}: ${r.length} stretches of road in a wall, ${r.reduce((a, o) => a + o.m, 0).toFixed(0)} m; by what: ${JSON.stringify(by)}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(r));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
