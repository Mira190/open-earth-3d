// How good are the gold routes to where the game sends you? Plays a city's game (web/ served on PORT or 8800, under
// xvfb-run) and plans, from the start, the way on foot (route.js walk, as the guide line does) and by car (from where your
// car is parked, along the roads on your side) to every quest step's place and every place on the travel map, and
// reports for each: its length against the straight line, metres where a walker cannot stand (through a wall, off a
// drop), turns back on itself (a U-turn of more than 150 degrees within 6 m), wiggle (degrees of turning per 100 m),
// jumps (a step of more than 1 m in height between two points that is not a lift), where it stops short of the place,
// and the planning time; and, for the quest givers and the places themselves, whether they stand on open ground.
//   xvfb-run -a node tools/route_quality.js shibuya [out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', OUT] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); g.spawn(); g.advance(0.5); return g.lateReady && g.lateReady(); });
  await p.waitForFunction('window.__game.ways.ready', null, { timeout: 300000 });
  await p.waitForFunction(() => window.__game.myCar && window.__game.myCar(), null, { timeout: 60000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const g = window.__game, nav = g.nav, ways = g.ways, G = g.G, keep = g.KEEP === 'left' ? 1 : -1;
    const start = { x: g.player.x, y: g.player.y, z: g.player.z };
    const npcAt = id => g.npcs.find(n => n.id === id);
    const targets = [];
    for (const q of G.quests || []) { const n = q.giver && npcAt(q.giver); if (n) targets.push({ name: `${q.id} giver ${q.giver}`, x: n.x, y: n.y, z: n.z, npc: true }); }
    for (const q of G.quests || []) (q.steps || []).forEach((s, i) => {
      const n = s.npc && npcAt(s.npc), at = n ? [n.x, n.y, n.z] : s.at;
      if (at) targets.push({ name: `${q.id}.${i + 1} ${s.type || ''}${s.npc ? ` ${s.npc}` : ''}`, x: at[0], y: at[1], z: at[2] ?? null, npc: !!n });
    });
    for (const t of G.travel || []) if (t.at) targets.push({ name: `travel ${t.id}`, x: t.at[0], y: t.at[1], z: null });
    const ang = (ax, ay, bx, by) => { const d = Math.atan2(ax * by - ay * bx, ax * bx + ay * by); return Math.abs(d); };
    const shape = pts => {
      let turn = 0, uturns = 0, jumps = 0, len = 0, longest = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], d = Math.hypot(dx, dy);
        len += d; longest = Math.max(longest, d);
        if (!pts[i][3] && Math.abs(pts[i][2] - pts[i - 1][2]) > 1 + 0.3 * d) jumps++;
        if (i > 1) {
          const ex = pts[i - 1][0] - pts[i - 2][0], ey = pts[i - 1][1] - pts[i - 2][1], e = Math.hypot(ex, ey);
          if (d > 0.3 && e > 0.3) { const a = ang(ex, ey, dx, dy); turn += a; if (a > 150 * Math.PI / 180 && Math.min(d, e) < 6) uturns++; }
        }
      }
      return { len, wiggle: len > 1 ? turn * 180 / Math.PI / len * 100 : 0, uturns, jumps, longest };
    };
    const out = { start: [start.x, start.y], walk: [], drive: [], places: [] };
    const car0 = g.myCar && g.myCar(), origins = [['start', start]];
    if (car0) { const c = car0.D.st, s = keep, side = { x: c.x + Math.cos(c.h) * 2.6 * s, y: c.y - Math.sin(c.h) * 2.6 * s }, f = nav.floorAt(side.x, side.y, c.z + 0.5); origins.push(['car', { x: side.x, y: side.y, z: f ? f.z : c.z }]); }
    for (const [from, o] of origins) for (const t of targets) {
      if (from !== 'start' && !/giver|\.1 /.test(t.name)) continue; // (from the car: to the quest givers and first steps)
      const t0 = performance.now(), rt = ways.walk(o, t), ms = performance.now() - t0, d = Math.hypot(t.x - o.x, t.y - o.y);
      if (!rt) { out.walk.push({ from, to: t.name, d: Math.round(d), none: true, ms: Math.round(ms) }); continue; }
      const s = shape(rt.pts), where = [];
      out.walk.push({ from, to: t.name, d: Math.round(d), len: Math.round(rt.len), ratio: +(rt.len / Math.max(d, 1)).toFixed(2), blocked: +ways.blockedMetres(rt.pts, where).toFixed(1), run: +(where.run || 0).toFixed(1),
        where: where.slice(0, 3).map(q => q.map(v => (typeof v === 'number' ? Math.round(v) : v))), uturns: s.uturns, wiggle: Math.round(s.wiggle), jumps: s.jumps, short: +Math.hypot(rt.end[0] - t.x, rt.end[1] - t.y).toFixed(1), ms: Math.round(ms), pts: rt.len > 1.8 * Math.max(d, 1) ? rt.pts.map(q => q.slice(0, 3).map(v => Math.round(v))) : undefined });
      // and where it stands (at the height the route ends at): on open ground a walker can stand on, not in a wall
      if (from !== 'start') continue;
      const f = nav.floorAt(t.x, t.y, (t.z ?? rt.end[2]) + 0.5), w = f && nav.walk(t.x, t.y, f.z + 0.3);
      out.places.push({ name: t.name, at: [Math.round(t.x), Math.round(t.y)], stand: !!(w && w.ok), why: w && !w.ok ? w.why : '', solid: f ? nav.solid(t.x, t.y, f.z, 0.2) : null });
    }
    const car = g.myCar && g.myCar();
    if (car) {
      const st = car.D.st, a = g.roads.place(st.x, st.y, 200, keep, st.z);
      if (a) {
        const q = {};
        g.roadNet.at(a.line, a.s, q);
        a.dir = Math.sin(st.h) * q.hx + Math.cos(st.h) * q.hy >= 0 ? 1 : -1;
      }
      for (const t of targets) {
        const t0 = performance.now(), bb = (t.z != null && g.roads.place(t.x, t.y, 300, keep, t.z, (a ? g.roads.group(a.line) : null))) || g.roads.place(t.x, t.y, 800, keep, null, (a ? g.roads.group(a.line) : null)), rt = a && bb && g.roads.route(a, bb, 30000), ms = performance.now() - t0;
        const d = Math.hypot(t.x - st.x, t.y - st.y);
        if (!rt) { out.drive.push({ to: t.name, d: Math.round(d), none: true }); continue; }
        const s = shape(rt.pts);
        let bad = 0;
        for (const p of rt.pts) { const f = nav.floorAt(p[0], p[1], p[2] + 0.6); if (!f || !nav.room(p[0], p[1], f.z, 0.9, 1.6, nav.isDeck(f.kind))) bad++; }
        out.drive.push({ to: t.name, d: Math.round(d), len: Math.round(rt.len), ratio: +(rt.len / Math.max(d, 1)).toFixed(2), uturns: s.uturns, wiggle: Math.round(s.wiggle), jumps: s.jumps, inWall: bad, pts: rt.pts.length, kerb: Math.round(Math.hypot(bb.x - t.x, bb.y - t.y)), ms: Math.round(ms) });
      }
    }
    return out;
  });
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(r, null, 1));
  const W = r.walk.filter(w => !w.none), D = r.drive.filter(w => !w.none);
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  console.log(`${city} on foot: ${W.length} of ${r.walk.length} routes; length / straight median ${med(W.map(w => w.ratio))}, worst ${Math.max(0, ...W.map(w => w.ratio))}; ${W.reduce((a, w) => a + w.blocked, 0).toFixed(1)} m where a walker can't stand (longest ${Math.max(0, ...W.map(w => w.run))} m); ${W.reduce((a, w) => a + w.uturns, 0)} U-turns; ${W.reduce((a, w) => a + w.jumps, 0)} jumps; wiggle median ${med(W.map(w => w.wiggle))} deg/100 m; slowest ${Math.max(0, ...r.walk.map(w => w.ms))} ms`);
  for (const w of r.walk) if (w.none || w.ratio > 1.8 || w.run > 1.5 || w.uturns || w.jumps || w.short > 12) console.log(`  ${w.from} to ${w.to}: ${w.none ? `NO ROUTE (${w.d} m away)` : `${w.len} m for ${w.d} m (x${w.ratio})${w.run > 1.5 ? `, blocked ${w.blocked} m at ${JSON.stringify(w.where)}` : ''}${w.uturns ? `, ${w.uturns} U-turns` : ''}${w.jumps ? `, ${w.jumps} jumps` : ''}${w.short > 12 ? `, stops ${w.short} m short` : ''}`}`);
  console.log(`${city} by car: ${D.length} of ${r.drive.length} routes; length / straight median ${med(D.map(w => w.ratio))}, worst ${Math.max(0, ...D.map(w => w.ratio))}; ${D.reduce((a, w) => a + w.inWall, 0)} points where the car doesn't fit; ${D.reduce((a, w) => a + w.uturns, 0)} U-turns`);
  for (const w of r.drive) if (w.none || w.ratio > 2.5 || w.inWall || w.uturns || w.kerb > 60) console.log(`  ${w.to}: ${w.none ? 'NO ROUTE' : `${w.len} m for ${w.d} m (x${w.ratio})${w.inWall ? `, ${w.inWall} points in a wall` : ''}${w.uturns ? `, ${w.uturns} U-turns` : ''}${w.kerb > 60 ? `, kerb ${w.kerb} m from the place` : ''}`}`);
  for (const q of r.places) if (!q.stand || q.solid) console.log(`  place ${q.name} at ${q.at}: ${q.stand ? '' : `not standable (${q.why})`}${q.solid ? ' in a wall' : ''}`);
  await b.close();
})();
