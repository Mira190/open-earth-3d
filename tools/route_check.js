// Checks the gold route in a city's game (web/game/route.js) against what the player can do:
// on foot, from the start to every NPC, wharf and helipad and between random places on the
// streets, the metres of each route where a walker can't stand (through a wall, off a drop,
// in the water); by car, the road routes' points where the car doesn't fit; flying, the
// flight paths' points that pass through a building, a landmark or a deck. Prints the totals
// and the worst routes, writes stills of the line on foot, by car and from the helicopter,
// and exits 1 if any route goes through anything.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/route_check.js sydney out_dir [pairs]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', pairsArg = '40'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  fs.mkdirSync(outDir, { recursive: true });
  const shot = async name => {
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${city}-route-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const t0 = Date.now();
  await p.waitForFunction('window.__game.ways.ready', null, { timeout: 300000 });
  const stats = await p.evaluate(() => window.__game.ways.stats());
  console.log(`${city}: network ready ${((Date.now() - t0) / 1000).toFixed(1)} s after the game; ${JSON.stringify(stats)}`);
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => window.__game.advance(1));

  const r = await p.evaluate(nPairs => {
    const g = window.__game, nav = g.nav, ways = g.ways, F = g.footNet;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const start = { x: g.player.x, y: g.player.y, z: g.player.z };
    const targets = g.npcs.map(n => ({ name: n.name, x: n.x, y: n.y, z: n.z }));
    // random places on the footways, and random pairs of them
    const spots = [];
    for (let i = 0; spots.length < nPairs * 2 && i < nPairs * 20; i++) {
      const l = F.L[Math.floor(rnd() * F.L.length)], q = {};
      F.at(F.L.indexOf(l), rnd() * l.len, q);
      const s = nav.stand(q.x, q.y, q.z + 0.5, { rMax: 6 });
      if (s) spots.push({ name: `spot ${spots.length}`, x: s.x, y: s.y, z: s.z });
    }
    const out = { walk: [], fly: [], drive: [] };
    // could a walker get from a to b at all? A 1 m search over the ground from b (the middle of each
    // step tested too, as finely as the routes are), the walker's own steps either way, heading for
    // a first: true, false, or null when it gives up (a big area)
    const reach = (a, b) => {
      const K = (x, y) => `${Math.round(x - b.x)},${Math.round(y - b.y)}`, seen = new Set([K(b.x, b.y)]), q = [[b.x, b.y, b.z]];
      for (let h = 0; h < q.length; h++) {
        if (q.length > 600000) return null;
        const [x, y, z] = q[h];
        if (Math.hypot(x - a.x, y - a.y) < 3 && Math.abs(z - a.z) < 2) return true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = K(nx, ny);
          if (seen.has(k)) continue;
          const w = nav.walk(nx, ny, z + 0.3);
          if (!w.ok || Math.abs(w.z - z) > 0.75 || !nav.walk(x + dx / 2, y + dy / 2, z + 0.3).ok) continue;
          seen.add(k); q.push([nx, ny, w.z]);
        }
      }
      return false;
    };
    const T = performance.now();
    const jobs = targets.map(t => [start, t]);
    for (let i = 0; i + 1 < spots.length; i += 2) jobs.push([spots[i], spots[i + 1]]);
    for (const [a, t] of jobs) {
      const t1 = performance.now(), rt = ways.walk(a, t), ms = performance.now() - t1;
      if (!rt) { out.walk.push({ to: t.name, none: true, d: Math.round(Math.hypot(t.x - a.x, t.y - a.y)), ms: Math.round(ms), reach: reach(a, t) }); continue; }
      const where = [];
      out.walk.push({ to: t.name, len: Math.round(rt.len), d: Math.round(Math.hypot(t.x - a.x, t.y - a.y)), blocked: +ways.blockedMetres(rt.pts, where).toFixed(1), run: +(where.run || 0).toFixed(1), where: where.map(q => q.map(v => (typeof v === 'number' ? Math.round(v) : v))),
        endGap: +Math.hypot(rt.end[0] - t.x, rt.end[1] - t.y).toFixed(1), ms: Math.round(ms) });
    }
    out.walkMs = Math.round(performance.now() - T);
    // flying: from the helipad to each NPC and back to the pad, every point clear of anything solid
    const pad = { x: g.heli.st.x, y: g.heli.st.y, z: g.heli.st.z };
    const clearOf = pts => {
      let bad = 0, n = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i], d = Math.hypot(bx - ax, by - ay, bz - az), m = Math.max(1, Math.ceil(d / 2));
        for (let k = 0; k <= m; k++) {
          const t = k / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
          n++;
          if (z < nav.groundBelow(x, y, z) - 0.05 || !nav.free(x, y, z + 0.3, z + 3.6, 3.2)) bad++;
          let deck = false;
          nav.decksAt(x, y, (h, dk) => { if (z + 3.6 > h - dk.th && z < h) deck = true; });
          if (deck) bad++;
        }
      }
      return { bad, n };
    };
    for (const t of targets.concat(spots.slice(0, 10))) {
      const t1 = performance.now(), f = ways.flight(pad, t), ms = performance.now() - t1;
      if (!f) { out.fly.push({ to: t.name, none: true }); continue; }
      const c = clearOf(f.pts);
      out.fly.push({ to: t.name, len: Math.round(f.len), top: Math.round(Math.max(...f.pts.map(q => q[2]))), bad: c.bad, land: Math.round(Math.hypot(f.land.x - t.x, f.land.y - t.y)), ms: Math.round(ms) });
    }
    // the span a quest asks you to fly under, where there is one
    const step = g.G.quests.flatMap(q => q.steps).find(s => s.type === 'under_bridge');
    const strip = step && nav.strips.find(s => s.fly_under && (!step.surface || s.name === step.surface));
    if (strip) {
      const u = ways.underSpan(pad, strip), f = u && ways.flight(pad, { x: u.end.x, y: u.end.y }, { end: u.end, under: u });
      out.under = f ? Object.assign(clearOf(f.pts), { len: Math.round(f.len), low: Math.round(u.end.z), name: strip.name }) : { none: true, name: strip.name };
    }
    // by car: from the car to each NPC's kerb, the car fits all along
    const car = g.myCar();
    if (car) {
      const st = car.D.st, keep = g.KEEP === 'left' ? 1 : -1;
      for (const t of targets.concat(spots.slice(0, 10))) {
        const a = g.roads.place(st.x, st.y, 200, keep, st.z), bb = g.roads.place(t.x, t.y, 300, keep, t.z);
        const rt = a && bb && g.roads.route(a, bb, 30000);
        if (!rt) { out.drive.push({ to: t.name, none: true }); continue; }
        let bad = 0;
        for (const q of rt.pts) { const f = nav.floorAt(q[0], q[1], q[2] + 0.6); if (!f || !nav.room(q[0], q[1], f.z, 0.9, 1.6, nav.isDeck(f.kind))) bad++; }
        out.drive.push({ to: t.name, len: Math.round(rt.len), bad, pts: rt.pts.length });
      }
    }
    return out;
  }, +pairsArg);
  const fails = [];
  const walked = r.walk.filter(w => !w.none), none = r.walk.filter(w => w.none);
  const blocked = walked.reduce((a, w) => a + w.blocked, 0), total = walked.reduce((a, w) => a + w.len, 0);
  const longest = Math.max(0, ...walked.map(w => w.run));
  console.log(`on foot: ${walked.length} routes, ${(total / 1000).toFixed(1)} km, ${blocked.toFixed(1)} m where a walker can't stand (at most ${longest} m at a time: grazing a corner, not through a wall); ${none.length} with no way on foot; ${r.walkMs} ms in all (slowest ${Math.max(...r.walk.map(w => w.ms))} ms)`);
  for (const w of walked.filter(w => w.run > 1).slice(0, 8)) console.log(`  blocked ${w.blocked} m to ${w.to} (${w.len} m), ${w.run} m at a time, at ${JSON.stringify(w.where)}`);
  for (const w of none.slice(0, 12)) console.log(`  no route to ${w.to} (${w.d} m away): ${w.reach === true ? 'MISSED, a walker can get there' : w.reach === false ? 'a walker can\'t get there either' : 'too far to tell'}`);
  for (const w of walked.filter(w => w.endGap > 12).slice(0, 8)) console.log(`  stops ${w.endGap} m short of ${w.to}`);
  const flown = r.fly.filter(f => !f.none);
  console.log(`flying: ${flown.length} of ${r.fly.length} flights, ${flown.reduce((a, f) => a + f.bad, 0)} points through something; highest ${Math.max(0, ...flown.map(f => f.top))} m; slowest ${Math.max(0, ...flown.map(f => f.ms))} ms`);
  for (const f of flown.filter(f => f.bad).slice(0, 8)) console.log(`  ${f.bad} points through something on the way to ${f.to}`);
  for (const f of r.fly.filter(f => f.none)) console.log(`  no flight to ${f.to}`);
  if (r.under) console.log(`under ${r.under.name}: ${r.under.none ? 'no route' : `${r.under.len} m, under at ${r.under.low} m, ${r.under.bad} points through something`}`);
  const driven = r.drive.filter(d => !d.none);
  console.log(`by car: ${driven.length} of ${r.drive.length} routes, ${driven.reduce((a, d) => a + d.bad, 0)} of ${driven.reduce((a, d) => a + d.pts, 0)} points where the car doesn't fit`);
  if (longest > 1.5) fails.push(`a walking route blocked for ${longest} m at a time`); // through a wall, not past a corner
  if (flown.some(f => f.bad)) fails.push('a flight passes through something');
  if (r.under && (r.under.none || r.under.bad)) fails.push('the pass under the span');
  const missed = none.filter(w => w.reach === true).length;
  if (missed) fails.push(`${missed} places a walker can get to without a route`);

  // stills: the line on foot from the start toward the first NPC, from the car, and from the helicopter
  await p.evaluate(() => { const g = window.__game; g.waypoint([g.npcs[g.npcs.length - 1].x, g.npcs[g.npcs.length - 1].y]); g.advance(1.5); });
  await shot('foot');
  await p.evaluate(() => { const g = window.__game; g.advance(4, ['KeyW']); g.advance(0.5); });
  await shot('foot-walked');
  if (await p.evaluate(() => !!window.__game.myCar())) {
    await p.evaluate(() => { const g = window.__game, d = g.myCar().D.st; g.player.x = d.x + 2.5; g.player.y = d.y; g.player.z = d.z; g.advance(0.2); g.enterCar(); g.advance(4); });
    await shot('car');
  }
  await p.evaluate(() => {
    const g = window.__game;
    if (g.player.mode === 'car') { g.myCar().D.st.v = 0; g.myCar().D.st.speed = 0; g.exitCar(); g.advance(0.5); }
    const d = g.heli.doorAt(); g.player.x = d.x; g.player.y = d.y; g.player.z = g.heli.st.z; g.enterHeli(); g.advance(3); g.advance(6, ['Space']); g.advance(1);
  });
  await shot('heli');
  const guide = await p.evaluate(() => { const g = window.__game, q = g.guide(); return { mode: g.player.mode, pts: q.pts ? q.pts.length : 0 }; });
  console.log(`in the helicopter: ${guide.pts ? `a flight line of ${guide.pts} points` : 'no flight line'}`);
  if (!guide.pts) fails.push('no flight line drawn in the helicopter');
  for (const e of errors) console.log(`page: ${e}`);
  if (errors.length) fails.push('page errors');
  console.log(fails.length ? `FAIL ${city}: ${fails.join('; ')}` : `ok   ${city}`);
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
