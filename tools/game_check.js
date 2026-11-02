// Smoke-test a city's game headlessly (software WebGL through SwiftShader): load it, start
// it, walk, travel from the map to a landmark and run there, talk to the first quest giver,
// fly the helicopter up and watch the ferries move, drive your car, hail a taxi and ride it
// (and order a ride on the phone, which must reach you within half a minute, shown on the
// phone's map), travel from the map in your car, watch the signals at the nearest junction
// change with the traffic stopping for them, and lose the WebGL context on purpose and get it
// back, with a screenshot after each. Prints what happened and the page's errors; exits 1 on failure.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/game_check.js sydney out_dir    # llvmpipe; without xvfb-run, SwiftShader
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.'] = process.argv;
(async () => {
  // under xvfb-run, Mesa's llvmpipe draws the frames, about four times faster than SwiftShader
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
  const logs = [], fails = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  const shot = async name => {
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${city}-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => window.__game.advance(1));
  await shot('start');

  // walking: forward for four seconds
  const walk = await p.evaluate(() => {
    const g = window.__game, a = [g.player.x, g.player.y];
    g.advance(4, ['KeyW']);
    return { moved: Math.hypot(g.player.x - a[0], g.player.y - a[1]), mode: g.player.mode, z: g.player.z };
  });
  check(walk.moved > 3, `walks forward (${walk.moved.toFixed(1)} m in 4 s, on foot at ${walk.z.toFixed(1)} m)`);
  await shot('walk');

  // the crowd keeps out of the walls: walkers whose body (0.3 m round, knee to head) is in a building or a
  // landmark, against those walking (a footway along a facade narrows their offset from its line)
  const crowdWalls = await p.evaluate(() => {
    const g = window.__game, nav = g.nav;
    let n = 0, inWall = 0;
    for (let k = 0; k < 6; k++) {
      g.advance(0.5);
      for (const q of g.crowd.P) if (q.line >= 0 && q.state === 'walk') { n++; if (!nav.room(q.x, q.y, q.z, 0.3)) inWall++; }
    }
    return { n, inWall };
  });
  check(crowdWalls.n > 0 && crowdWalls.inWall <= 0.02 * crowdWalls.n, `the crowd keeps out of the walls (${crowdWalls.inWall} of ${crowdWalls.n} walkers in a wall, at most 2%)`);

  // a quay (web/quays.js): walk straight at a seawall and stop on its coping with the toes at its
  // edge (the centre within 0.3 m of the face as drawn), at the level of the quay, not a cell short
  // of it at the terrain grid's bank
  const quay = await p.evaluate(() => {
    const g = window.__game, Q = g.Wd.quays, pl = g.player;
    if (!Q) return { none: true };
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw };
    const pts = Q.walls().flatMap(r => r.filter((_, k) => k % 7 === 3)).sort((a, b) => Math.hypot(a[0] - pl.x, a[1] - pl.y) - Math.hypot(b[0] - pl.x, b[1] - pl.y));
    let r = { tried: 0 };
    for (const [x, y, nx, ny, top] of pts.slice(0, 60)) {
      // a clear run of 8 m up to the wall, on open ground
      const sx = x - nx * 8, sy = y - ny * 8, f = g.nav.floorAt(sx, sy, top + 1);
      if (!f || f.kind !== 'ground' || Math.abs(f.z - top) > 0.6) continue;
      let clear = true;
      for (let s = 0; s <= 7; s += 0.5) if (!g.nav.walk(sx + nx * s, sy + ny * s, f.z).ok) { clear = false; break; }
      if (!clear) continue;
      r.tried++;
      Object.assign(pl, { x: sx, y: sy, z: f.z, ground: true, vz: 0, speed: 0 });
      pl.h = g.cam.yaw = Math.atan2(nx, ny);
      for (let i = 0; i < 40; i++) g.advance(0.1, ['KeyW']);
      r = Object.assign(r, { at: [Math.round(x), Math.round(y)], d: Q.face(pl.x, pl.y), z: pl.z, top, mode: pl.mode });
      break;
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return r;
  });
  if (quay.none) check(true, 'no quays');
  else if (quay.d == null) check(false, `found no clear walk up to a seawall (${quay.tried} tried)`);
  else check(quay.mode === 'foot' && quay.d > -0.3 && quay.d < 0 && Math.abs(quay.z - quay.top) < 0.6,
    `walks up to the seawall at ${quay.at} and stops ${(-quay.d).toFixed(2)} m short of its face, ${quay.z.toFixed(1)} m up (the quay is ${quay.top.toFixed(1)} m)`);

  // fine walking levels (game.json "patches", nav.js): somewhere on one, climb a flight of steps
  // (a straight walk that rises 1.5 m or more in steps of 30 cm or less) and get to its top; and
  // walk at a wall (a rise of 80 cm or more in half a metre) and stay at its foot
  const levels = await p.evaluate(() => {
    const g = window.__game, pl = g.player, P = (g.G.patches || [])[0];
    if (!P) return { none: true };
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw };
    const b = Uint8Array.from(atob(P.data), c => c.charCodeAt(0)), Z = new Int16Array(b.buffer, 0, P.nx * P.ny);
    const at = (x, y) => { const i = Math.floor((x - P.x0) / P.cell), j = Math.floor((y - P.y0) / P.cell); return i < 0 || j < 0 || i >= P.nx || j >= P.ny || Z[j * P.nx + i] === -32768 ? null : Z[j * P.nx + i] / 100; };
    const go = (x, y, dx, dy, z, t) => {
      Object.assign(pl, { x, y, z, ground: true, vz: 0, speed: 0 });
      pl.h = g.cam.yaw = Math.atan2(dx, dy);
      for (let i = 0; i < t * 10; i++) g.advance(0.1, ['KeyW']);
      return { z: pl.z, d: Math.hypot(pl.x - x, pl.y - y), mode: pl.mode };
    };
    const r = {};
    // a flight: from a cell, 8 m in one of 32 directions, rising in small steps by 1.5 m or more
    search: for (let j = 2; j < P.ny - 2; j++) for (let i = 2; i < P.nx - 2; i++) {
      const x = P.x0 + (i + 0.5) * P.cell, y = P.y0 + (j + 0.5) * P.cell, z0 = at(x, y);
      if (z0 === null) continue;
      for (let k = 0; k < 32; k++) {
        const dx = Math.cos(k * Math.PI / 16), dy = Math.sin(k * Math.PI / 16);
        let prev = z0, ok = true, top = z0;
        for (let s = 0.25; s <= 8 && ok; s += 0.25) { const q = at(x + dx * s, y + dy * s); if (q === null || q - prev > 0.3 || q < prev - 0.05) ok = false; else { prev = q; top = Math.max(top, q); } }
        if (!ok || top - z0 < 1.5 || !g.nav.walk(x, y, z0).ok) continue;
        r.flight = Object.assign(go(x, y, dx, dy, z0, 5), { at: [Math.round(x), Math.round(y)], z0, top });
        break search;
      }
    }
    // a wall: a rise of 80 cm or more within half a metre, with room to walk up to it
    search2: for (let j = 4; j < P.ny - 4; j += 2) for (let i = 4; i < P.nx - 4; i += 2) {
      const x = P.x0 + (i + 0.5) * P.cell, y = P.y0 + (j + 0.5) * P.cell, z0 = at(x, y);
      if (z0 === null) continue;
      for (let k = 0; k < 8; k++) {
        const dx = Math.cos(k * Math.PI / 4), dy = Math.sin(k * Math.PI / 4), q = at(x + dx * 2.5, y + dy * 2.5);
        // a wall that runs on a metre and a half to either side (not the end of one, which a walker goes round)
        const side = [-1.5, 1.5].map(o => at(x + dx * 2.5 - dy * o, y + dy * 2.5 + dx * o));
        if (side.some(v => v === null || v - z0 < 0.8)) continue;
        let flat = true;
        for (let s = 0.25; s <= 2 && flat; s += 0.25) { const v = at(x + dx * s, y + dy * s); if (v === null || Math.abs(v - z0) > 0.05) flat = false; }
        if (!flat || q === null || q - z0 < 0.8 || !g.nav.walk(x, y, z0).ok) continue;
        r.wall = Object.assign(go(x, y, dx, dy, z0, 3), { at: [Math.round(x), Math.round(y)], z0, top: q });
        break search2;
      }
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return r;
  });
  if (levels.none) check(true, 'no fine walking levels');
  else {
    const f = levels.flight, w = levels.wall;
    check(!!f && f.mode === 'foot' && f.z > f.top - 0.35,
      f ? `climbs the steps at ${f.at} from ${f.z0.toFixed(2)} m to ${f.z.toFixed(2)} m (their top is ${f.top.toFixed(2)} m)` : 'found no flight of steps on the fine walking levels');
    check(!!w && w.mode === 'foot' && Math.abs(w.z - w.z0) < 0.2 && w.d < 2.6,
      w ? `stops at the foot of the wall at ${w.at}, ${w.z.toFixed(2)} m up after ${w.d.toFixed(1)} m (its top is ${w.top.toFixed(2)} m)` : 'found no wall on the fine walking levels');
  }

  // the walks a city's fine walking levels name (game.json patches[].walks): from the first point,
  // on the floor nearest from_m, steer through the points on foot and arrive at the last within a
  // metre, at to_m; a walk to a seawall ("face") stops with the toes at its edge instead (the centre
  // within 0.3 m of the face as drawn, web/quays.js)
  const walks = await p.evaluate(() => {
    const g = window.__game, pl = g.player, Q = g.Wd.quays, out = [];
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw };
    for (const P of g.G.patches || []) for (const w of P.walks || []) {
      const [x0, y0] = w.path[0], f = g.nav.floorAt(x0, y0, w.from_m + 0.3);
      const r = { name: w.name, from: w.from_m, to: w.to_m, start: f ? f.z : null, face: !!w.face };
      if (!f || Math.abs(f.z - w.from_m) > 0.3) { out.push(r); continue; }
      Object.assign(pl, { x: x0, y: y0, z: f.z, ground: true, vz: 0, speed: 0 });
      let low = f.z, high = f.z;
      for (let k = 1; k < w.path.length; k++) {
        const [tx, ty] = w.path[k];
        for (let i = 0; i < 120; i++) {
          const dx = tx - pl.x, dy = ty - pl.y;
          if (Math.hypot(dx, dy) < (k === w.path.length - 1 ? 0.4 : 0.6)) break;
          pl.h = g.cam.yaw = Math.atan2(dx, dy);
          g.advance(0.05, ['KeyW']);
          low = Math.min(low, pl.z); high = Math.max(high, pl.z);
        }
      }
      const [ex, ey] = w.path[w.path.length - 1];
      Object.assign(r, { d: Math.hypot(ex - pl.x, ey - pl.y), z: pl.z, low, high, mode: pl.mode, at: [Math.round(pl.x), Math.round(pl.y)],
        edge: w.face && Q ? Q.face(pl.x, pl.y) : null });
      out.push(r);
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return out;
  });
  for (const w of walks) {
    if (w.start == null || w.d == null) { check(false, `walks ${w.name}: no floor at ${w.from} m at its start (found ${w.start})`); continue; }
    if (w.face) check(w.mode === 'foot' && w.edge != null && w.edge > -0.3 && w.edge < 0 && Math.abs(w.z - w.to) < 0.3,
      `walks ${w.name}: stops ${w.edge == null ? '?' : (-w.edge).toFixed(2)} m short of the face, at ${w.z.toFixed(2)} m (the walkway is ${w.to} m)`);
    else check(w.mode === 'foot' && w.d < 1.0 && Math.abs(w.z - w.to) < 0.3 && w.low > Math.min(w.from, w.to) - 0.3 && w.high < Math.max(w.from, w.to) + 0.3,
      `walks ${w.name}: from ${w.from} m to ${w.z.toFixed(2)} m (expected ${w.to} m), ${w.d.toFixed(1)} m from the end, never below ${w.low.toFixed(2)} or above ${w.high.toFixed(2)} m`);
  }

  // map travel: the map shows the landmarks; a hop to the first lands you on your feet near it,
  // facing it, on ground you can walk; and the run there is the quick one (GAIT.run)
  const hop = await p.evaluate(() => {
    const g = window.__game, lm = g.landmarks[0];
    if (!lm) return { none: true };
    g.toggleMap(); g.advance(0.1);
    const pins = g.mapPins().filter(q => q.d.kind === 'landmark').length;
    g.toggleMap();
    const ok = g.travelTo(lm);
    for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
    g.advance(0.5);
    const pl = g.player, d = Math.hypot(lm.at[0] - pl.x, lm.at[1] - pl.y), facing = Math.abs(Math.atan2(Math.sin(Math.atan2(lm.at[0] - pl.x, lm.at[1] - pl.y) - pl.h), Math.cos(Math.atan2(lm.at[0] - pl.x, lm.at[1] - pl.y) - pl.h)));
    const r = { name: lm.name, pins, n: g.landmarks.length, ok, mode: pl.mode, d, facing, walk: g.nav.walk(pl.x, pl.y, pl.z).ok, top: 0 };
    for (let i = 0; i < 20; i++) { g.advance(0.1, ['KeyW']); r.top = Math.max(r.top, pl.speed); }
    r.run = g.GAIT.run;
    return r;
  });
  if (hop.none) check(true, 'no landmarks to travel to');
  else {
    check(hop.pins === hop.n, `the map shows the landmarks (${hop.pins} of ${hop.n})`);
    check(hop.ok && hop.mode === 'foot' && hop.walk && hop.d < 600 && hop.facing < 0.3, `travels from the map to ${hop.name} (${hop.mode}, ${hop.d.toFixed(0)} m from it, facing it within ${hop.facing.toFixed(2)} rad)`);
    check(hop.top > hop.run * 0.8, `runs at ${hop.top.toFixed(1)} m/s (the run is ${hop.run} m/s)`);
  }
  await shot('travel');

  // the big map zooms and pans: the wheel zooms about the pointer (here over the thickest landmark pins), and of
  // the landmarks then in view, at least as many are named as at the whole city, and more where any were left off;
  // a drag pans without dropping a waypoint, and the fit button shows the whole city again
  const mz = await (async () => {
    await p.evaluate(() => { const g = window.__game; if (document.getElementById('g-bigmap').hidden) g.toggleMap(); });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await p.evaluate(() => {
      const b = document.getElementById('g-bigmap-c').getBoundingClientRect(), q = window.__game.mapPins().filter(q => q.d.kind === 'landmark');
      let best = q[0], bn = -1;
      for (const a of q) { const n = q.filter(c => Math.hypot(a.x - c.x, a.y - c.y) < 60).length; if (n > bn) { bn = n; best = a; } }
      return { x: b.left + (best ? best.x : b.width / 2), y: b.top + (best ? best.y : b.height / 2), w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
    });
    const v0 = await p.evaluate(() => window.__game.mapView());
    await p.mouse.move(r.x, r.y);
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(60); }
    await p.waitForTimeout(150);
    const v1 = await p.evaluate(([w, h]) => Object.assign(window.__game.mapView(),
      { inView: window.__game.mapPins().filter(q => q.d.kind === 'landmark' && q.x > 0 && q.y > 0 && q.x < w && q.y < h).map(q => q.d.name) }), [r.w, r.h]);
    await p.mouse.move(r.cx, r.cy); await p.mouse.down(); await p.mouse.move(r.cx + 120, r.cy + 60, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(150);
    const v2 = await p.evaluate(() => window.__game.mapView());
    await p.click('#g-mapzoom [data-z="fit"]');
    await p.waitForTimeout(150);
    const v3 = await p.evaluate(() => window.__game.mapView());
    await p.evaluate(() => { document.getElementById('g-bigmap').hidden = true; });
    return { v0, v1, v2, v3 };
  })();
  const seen = new Set(mz.v1.inView), before = mz.v0.names.filter(n => seen.has(n)).length, after = mz.v1.names.filter(n => seen.has(n)).length;
  check(mz.v1.z > 2 && after >= before && (after > before || before === seen.size),
    `the map zooms with the wheel (×${mz.v1.z.toFixed(1)}; of the ${seen.size} landmarks in view, ${before} named at the whole city, ${after} zoomed in)`);
  check(Math.hypot(mz.v2.cx - mz.v1.cx, mz.v2.cy - mz.v1.cy) > 5 && !mz.v2.picked, `a drag pans the map (${Math.hypot(mz.v2.cx - mz.v1.cx, mz.v2.cy - mz.v1.cy).toFixed(0)} map px) without picking a spot`);
  check(mz.v3.z === 1, 'the fit button shows the whole city again');

  // the first quest giver: walk up and talk
  const talk = await p.evaluate(() => {
    const g = window.__game, q = g.quest(), n = q && g.npcs.find(n => n.id === q.giver);
    if (!n) return { none: true };
    g.player.x = n.x + 1.5; g.player.y = n.y; g.player.z = n.z;
    g.advance(0.5);
    g.talkTo(n);
    g.advance(0.5);
    return { name: n.name, open: !document.getElementById('gd').hidden };
  });
  check(talk.none || talk.open, talk.none ? 'no quest giver (free roam)' : `talks to ${talk.name}`);
  await shot('talk');
  await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 40 && g.dlg.open; i++) { if (g.dlg.hasChoices) g.dlg.choose(0); else g.dlg.next(); g.advance(0.2); } });
  if (!talk.none) check(await p.evaluate(() => !window.__game.dlg.open), 'the conversation runs to its end');

  // the gold route to the farthest NPC a walker can reach: drawn on ground a walker can stand on all
  // the way (not through a building); it stays set for the helicopter and the car below
  const route = await p.evaluate(async () => {
    const g = window.__game;
    for (let i = 0; i < 600 && !g.ways.ready; i++) await new Promise(r => setTimeout(r, 500));
    if (!g.ways.ready) return { ready: false };
    const me = { x: g.player.x, y: g.player.y, z: g.player.z };
    const n = g.npcs.slice().sort((a, b) => Math.hypot(b.x - me.x, b.y - me.y) - Math.hypot(a.x - me.x, a.y - me.y)).find(q => g.ways.walk(me, q));
    if (!n) return { ready: true, none: true };
    g.waypoint([n.x, n.y]);
    g.advance(0.5);
    const q = g.guide();
    let len = 0;
    if (q.pts) for (let i = 1; i < q.pts.length; i++) len += Math.hypot(q.pts[i][0] - q.pts[i - 1][0], q.pts[i][1] - q.pts[i - 1][1]);
    const where = [];
    if (q.pts) g.ways.blockedMetres(q.pts, where);
    return { ready: true, to: n.name, len, blocked: where.run || 0, drawn: !!q.pts && g.gold.mesh.visible, stats: g.ways.stats() };
  });
  check(route.ready, `the route network is built${route.stats ? ` (${route.stats.edges} stretches in ${route.stats.ms} ms of work)` : ''}`);
  check(route.ready && !route.none && route.drawn && route.blocked < 1.5, route.none ? 'no NPC a walker can reach' : `the gold route to ${route.to} on foot (${(route.len || 0).toFixed(0)} m; at most ${(route.blocked || 0).toFixed(1)} m at a time where a walker can't stand)`);
  await shot('route');

  // the helicopter: in through its door (open while you climb in, shut behind you), spool up, climb
  const heli = await p.evaluate(() => {
    const g = window.__game;
    if (!g.heli) return { none: true };
    const d = g.heli.doorAt();
    g.player.x = d.x; g.player.y = d.y; g.player.z = g.heli.st.z;
    g.enterHeli();
    g.advance(0.4);
    const open = g.heli.st.door;
    g.advance(2.6);
    const shut = g.heli.st.door, z0 = g.heli.st.z;
    g.advance(8, ['Space']);
    const q = g.guide();
    return { mode: g.player.mode, climbed: g.heli.st.z - z0, open, shut, flight: q.pts ? Math.max(...q.pts.map(p => p[2])) : null };
  });
  check(heli.none || (heli.open > 0.9 && heli.shut === 0), heli.none ? 'no helicopter' : `climbs in through the door (open ${(heli.open || 0).toFixed(2)}, then shut)`);
  check(heli.none || (heli.mode === 'heli' && heli.climbed > 10), heli.none ? 'no helicopter' : `flies the helicopter (climbed ${(heli.climbed || 0).toFixed(1)} m)`);
  check(heli.none || route.none || (heli.flight != null && heli.flight > 20), heli.none ? 'no helicopter' : `the gold route in the air to a place to land${heli.flight != null ? ` (up to ${heli.flight.toFixed(0)} m)` : ''}`);
  await shot('heli');

  // back down, and out the same way
  const out = await p.evaluate(() => {
    const g = window.__game;
    if (!g.heli) return { none: true };
    for (let i = 0; i < 40 && !g.heli.st.landed; i++) g.advance(0.5, ['KeyC']);
    g.advance(1);
    g.exitHeli();
    g.advance(2);
    return { landed: g.heli.st.landed, mode: g.player.mode, door: g.heli.st.door, near: Math.hypot(g.player.x - g.heli.st.x, g.player.y - g.heli.st.y) };
  });
  check(out.none || (out.mode === 'foot' && out.door === 0 && out.near < 6), out.none ? 'no helicopter' : `lands and climbs out (${out.mode}, ${(out.near || 0).toFixed(1)} m from it)`);

  // the ferries run their routes
  const ferry = await p.evaluate(() => {
    const g = window.__game, V = (g.fer && g.fer.vessels) || [];
    if (!V.length) return { none: true };
    const a = V.map(v => [v.x, v.y]);
    g.advance(40);
    return { n: V.length, moved: Math.max(...V.map((v, i) => Math.hypot(v.x - a[i][0], v.y - a[i][1]))) };
  });
  check(ferry.none || ferry.moved > 20, ferry.none ? 'no ferries' : `${ferry.n} ferries run (the farthest moved ${ferry.moved.toFixed(0)} m in 40 s)`);
  await shot('ferry');

  // your car: round to the driver's door and in, seated with the head under the roof, drive off,
  // brake to a stop and get out beside it
  const car = await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return { none: true };
    const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1; // the driver's side: the right where traffic keeps left
    window.__kerb = { x: st.x, y: st.y, z: st.z, h: st.h }; // where it was parked, for the taxi below
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3);
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    g.advance(0.5);
    const q = g.guide();
    const r = { inCar: g.player.mode === 'car', head: c.C.clearance(g.player.rig, 'driver'), top: 0, road: q.pts ? q.pts.length : 0 }, a = [st.x, st.y];
    for (let i = 0; i < 8; i++) { g.advance(0.5, ['KeyW']); r.top = Math.max(r.top, st.speed); }
    r.moved = Math.hypot(st.x - a[0], st.y - a[1]);
    // the brakes while it goes forward (held at a standstill, S reverses), then the handbrake
    for (let i = 0; i < 100 && st.v > 1.5; i++) g.advance(0.1, ['KeyS']);
    for (let i = 0; i < 40 && st.speed > 0.3; i++) g.advance(0.1, ['Space']);
    g.advance(0.5);
    r.stopped = st.speed;
    g.exitCar();
    g.advance(1);
    r.mode = g.player.mode; r.said = document.getElementById('g-toasts').textContent.slice(-80);
    r.out = g.player.mode === 'foot' && !OECars.pushOut(g.player.x, g.player.y, g.player.z, 0.3, [c.D.box()]).hit;
    return r;
  });
  check(car.none || car.inCar, car.none ? 'no car' : 'gets into your car at the driver\'s door');
  check(car.none || route.none || car.road > 1, car.none ? 'no car' : 'the gold route by road, from the car');
  check(car.none || car.head == null || car.head > 0, car.none ? 'no car' : `at the wheel, the head is under the roof (${car.head == null ? 'not measured' : `${car.head.toFixed(2)} m`})`);
  check(car.none || (car.top * 3.6 > 15 && car.moved > 5), car.none ? 'no car' : `drives your car (${(car.top * 3.6).toFixed(0)} km/h, ${car.moved.toFixed(0)} m in 4 s)`);
  check(car.none || (car.stopped < 0.5 && car.out), car.none ? 'no car' : `brakes to a stop and gets out beside it${car.out ? '' : ` (${car.stopped.toFixed(1)} m/s, ${car.mode}: ${car.said})`}`);
  await shot('car');

  // a taxi: a hand up at the kerb, the nearest one pulls in, in the back, the driver asks where to,
  // the heads clear the roof, it drives off, the trip is skipped to the kerb there, out; then a ride
  // ordered on the phone
  const taxi = await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar(), st = window.__kerb;
    if (!c || !st) return { none: true };
    if (g.player.mode !== 'foot') g.exitCar();
    const k = g.KEEP === 'left' ? 1 : -1; // on the footway at the kerb where your car was parked, a little behind
    g.player.x = st.x - Math.sin(st.h) * 12 - Math.cos(st.h) * 2.4 * k; g.player.y = st.y - Math.cos(st.h) * 12 + Math.sin(st.h) * 2.4 * k; g.player.z = st.z;
    g.advance(1);
    const r = { hint: !!g.kerbAction() };
    g.hail();
    const o = g.ride();
    if (!o) return Object.assign(r, { hailed: false });
    r.hailed = true;
    r.log = [];
    let t = 0;
    for (; t < 150 && o.phase === 'coming'; t += 0.5) { g.advance(0.5); if (t % 5 === 0) { const st = o.drv.st, A = g.cars, near = A.C.filter(c => c.line >= 0 && Math.hypot(c.x - st.x, c.y - st.y) < 12).map(c => `${A.C.indexOf(c)}:${c.v.toFixed(1)}:${c.why}:${c.mv ? 'in' : ''}`).join(' '); r.log.push(`${t}s s=${st.s.toFixed(0)}/${o.drv.path.len.toFixed(0)} v=${st.v.toFixed(1)} d=${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} pass=${st.pass.toFixed(1)} shift=${st.shift.toFixed(1)} ${st.why || ''} near[${near}]`); } }
    r.hailT = t;
    r.waiting = o.phase === 'waiting'; r.near = Math.hypot(o.drv.st.x - g.player.x, o.drv.st.y - g.player.y);
    r.behind = o.drv.st.end < o.drv.path.len - 1; // (it pulled in behind a car at the kerb: your car, parked there)
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    r.inTaxi = g.player.mode === 'ride';
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    r.choices = document.querySelectorAll('#gd-choices button').length;
    r.you = o.C.clearance(g.player.rig, g.KEEP === 'left' ? 'rear_left' : 'rear_right'); r.driver = o.C.clearance(o.driver, 'driver');
    g.dlg.choose(0);
    g.advance(1);
    r.dest = o.dest && o.dest.name;
    const s0 = o.drv.st.s;
    g.advance(20);
    r.drove = o.drv.st.s - s0;
    if (r.drove < 20) { // what holds it up: the nearest cars ahead of it, yours among them
      const t = o.drv.st, player = g.player, fx = Math.sin(t.h), fy = Math.cos(t.h), mc = g.myCar && g.myCar(), ahead = [];
      for (const c of g.cars.C.concat(mc ? [Object.assign({ mine: true }, mc.D.st)] : [])) {
        const dx = c.x - t.x, dy = c.y - t.y, a = dx * fx + dy * fy;
        if (a > 0 && a < 40 && Math.abs(-dx * fy + dy * fx) < 4) ahead.push(`${c.mine ? 'your car' : 'car'} ${a.toFixed(0)} m ahead, ${(-dx * fy + dy * fx).toFixed(1)} m across, v ${(c.v || c.speed || 0).toFixed(1)}${c.still ? ' still' : ''}`);
      }
      r.why = `v ${t.v.toFixed(1)}, at ${t.s.toFixed(0)} of ${t.P.len.toFixed(0)} m${t.done ? " (done)" : ""}, phase ${o.phase}, pass ${t.pass.toFixed(1)}, held ${(t.held || 0).toFixed(0)} s, ${t.why}${t.junction ? ` (the junction: ${t.junction})` : ''}${t.block ? ` behind ${t.block === player ? 'you' : mc && t.block.x === mc.D.st.x ? 'your car' : t.block.line != null ? `a car on line ${t.block.line} (stuck ${(t.block.stuck || 0).toFixed(0)} s, v ${(t.block.v || 0).toFixed(1)})` : 'something'} at ${Math.hypot(t.block.x - t.x, t.block.y - t.y).toFixed(1)} m${t.block.still ? ', still' : ''}` : ''}; ${ahead.join('; ') || 'nothing ahead'}`;
    }
    g.skipRide();
    g.advance(6);
    r.arrived = o.phase === 'arrived';
    g.leaveRide();
    g.advance(1);
    r.out = g.player.mode === 'foot';
    // a ride on the phone: on its way at once, on the phone's map, here within half a minute
    // (the time the app showed when it was ordered within a few seconds of the truth), then cancelled
    g.advance(6); // the taxi drives off
    const dest = g.destinations(g.player.x, g.player.y)[0];
    // a ride comes only from a car within reach, and the traffic is random: as the phone says when
    // there is none ("Try again in a moment"), a few seconds on, try again
    if (dest) g.orderRide(dest);
    for (let i = 0; i < 3 && dest && !(g.ride() && g.ride() !== o && g.ride().phase === 'coming'); i++) { g.advance(5); g.orderRide(dest); }
    const q = g.ride();
    r.ordered = !!q && q !== o && q.kind === 'hire' && q.phase === 'coming';
    // when it does not come, what the phone said (no street, no drivers near, one already on the way)
    if (!r.ordered) r.orderWhy = `${dest ? `to ${dest.name}` : 'nowhere to go'}, the last ride ${o.phase}, ${q ? `ride ${q.kind} ${q.phase}` : 'no ride'}: ${document.getElementById('g-toasts').textContent.slice(-120)}`;
    if (r.ordered) {
      g.phoneShow('ride');
      g.advance(0.5);
      r.eta0 = (g.rideEta ? g.rideEta() : q.drv.timeLeft()) + 0.5; // (what the app shows)
      r.phoneMap = !document.getElementById('gph-map').hidden && /on the way|arriving/.test(document.getElementById('gph-body').textContent);
      let u = 0.5;
      r.rideLog = [];
      for (; u < 120 && q.phase === 'coming'; u += 0.5) {
        g.advance(0.5);
        const st = q.drv.st;
        if (u % 5 === 0 || (st.v < 0.5 && u % 1 === 0)) r.rideLog.push(`${u}s s=${st.s.toFixed(0)}/${st.end.toFixed(0)} v=${st.v.toFixed(1)} held=${(st.held || 0).toFixed(0)} d=${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} ${st.why || ''}${st.block ? ` behind ${st.block.line != null ? `car ${g.cars.C.indexOf(st.block)} v ${(st.block.v || 0).toFixed(1)} ${st.block.why || ''}` : 'something'}` : ''}`);
      }
      r.rideT = u; r.rideHere = q.phase === 'waiting';
      g.phoneShow(false);
      g.cancelRide();
    }
    return r;
  });
  if (taxi.none) check(true, 'no car, no taxis');
  else {
    check(taxi.hint, 'the kerb offers a taxi (Y)');
    if (taxi.log && !(taxi.hailed && taxi.waiting && taxi.near < (taxi.behind ? 22 : 15) && taxi.hailT <= 30)) console.log(taxi.log.join("\n"));
    check(taxi.hailed && taxi.waiting && taxi.near < (taxi.behind ? 22 : 15), `hails a taxi: it pulls in beside you${taxi.hailed ? ` (${(taxi.near || 0).toFixed(1)} m away${taxi.behind ? ', behind the car parked at the kerb' : ''})` : ''}`);
    check(taxi.hailed && taxi.hailT <= 30, `the taxi is there within half a minute (${taxi.hailT == null ? '–' : `${taxi.hailT.toFixed(1)} s`})`);
    check(taxi.inTaxi && taxi.choices >= 2, `gets in the back, and the driver asks where to (${taxi.choices || 0} answers)`);
    check(taxi.you == null || taxi.you > 0, `in the back, your head is under the roof (${taxi.you == null ? 'not measured' : `${taxi.you.toFixed(2)} m`})`);
    check(taxi.driver == null || taxi.driver > 0, `the driver's head is under the roof (${taxi.driver == null ? 'not measured' : `${taxi.driver.toFixed(2)} m`})`);
    check(taxi.drove > 20, `drives off for ${taxi.dest || 'nowhere'} (${(taxi.drove || 0).toFixed(0)} m in 20 s)${taxi.why ? `: ${taxi.why}` : ''}`);
    check(taxi.arrived && taxi.out, 'skips the trip to the kerb there, and you get out');
    check(taxi.ordered, `orders a ride on the phone${taxi.ordered ? '' : ` (${taxi.orderWhy})`}`);
    check(taxi.ordered && taxi.phoneMap, 'the phone shows the ride on its map, on the way');
    const rideOk = taxi.ordered && taxi.rideHere && taxi.rideT <= 30 && Math.abs(taxi.rideT - taxi.eta0) < 8; // (the traffic in your sight and its lights make it vary)
    check(rideOk, `the ride is there within half a minute, when the app said (${taxi.rideT == null ? '–' : `${taxi.rideT.toFixed(1)} s, said ${taxi.eta0.toFixed(0)} s`})`);
    if (!rideOk && taxi.rideLog) console.log(taxi.rideLog.join('\n'));
  }
  await shot('taxi');

  // a quick start: the helicopter waits on a pad near where you start and a taxi can reach you
  // from a kerb close by; and walk towards another pad while the helicopter stands shut down far
  // away, and it is waiting there when you arrive
  const quick = await p.evaluate(() => {
    const g = window.__game, pl = g.player;
    g.spawn();
    g.advance(0.5);
    const k = g.roads.place(pl.x, pl.y, 400, 1, pl.z), r = { kerb: k ? k.d : null, heli: g.heli ? Math.hypot(g.heli.st.x - pl.x, g.heli.st.y - pl.y) : null };
    return r;
  });
  check(quick.heli == null || quick.heli < 450, `the helicopter waits near the start (${quick.heli == null ? 'none' : `${quick.heli.toFixed(0)} m`})`);
  check(quick.kerb != null && quick.kerb < 150, `a kerb for a taxi near the start (${quick.kerb == null ? 'none' : `${quick.kerb.toFixed(0)} m`})`);
  const pads = await p.evaluate(() => {
    const g = window.__game, pl = g.player, s = g.heli && g.heli.st, P = g.helipads || [];
    if (!s || P.length < 2) return { none: true };
    const far = P.slice(1).find(q => Math.hypot(q.at[0] - s.x, q.at[1] - s.y) > 1000);
    if (!far) return { none: true };
    const f = g.nav.stand(far.at[0] + 150, far.at[1], far.at[2] + 1, { rMax: 80 }) || { x: far.at[0], y: far.at[1], z: far.at[2] };
    pl.x = f.x; pl.y = f.y; pl.z = f.z; // walking up to it
    g.advance(1.5);
    return { name: far.name, d: Math.hypot(s.x - far.at[0], s.y - far.at[1]) };
  });
  check(pads.none || pads.d < 1, pads.none ? 'one pad (no other to wait at)' : `the helicopter waits at ${pads.name} when you come (${pads.d.toFixed(0)} m off it)`);

  // map travel in your car: it comes along, parked at a kerb near the landmark, and you are still at the wheel
  const drive = await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar(), lm = g.landmarks[1] || g.landmarks[0];
    if (!c || !lm) return { none: true };
    if (g.ride()) g.cancelRide();
    const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3);
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    const ok = g.travelTo(lm);
    for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
    g.advance(0.5);
    return { name: lm.name, ok, mode: g.player.mode, d: Math.hypot(lm.at[0] - st.x, lm.at[1] - st.y), me: Math.hypot(lm.at[0] - g.player.x, lm.at[1] - g.player.y), v: st.speed };
  });
  // at the wheel by the kerb near it; or, with no street near (the end of a pier), on foot there and the car on the nearest street
  check(drive.none || (drive.ok && drive.v < 1 && (drive.mode === 'car' ? drive.d < 900 : drive.mode === 'foot' && drive.me < 600 && drive.d < 2000)), drive.none ? 'no car to travel in'
    : `travels from the map in your car to ${drive.name} (${drive.mode}, ${drive.mode === 'car' ? '' : `${(drive.me || 0).toFixed(0)} m from it, `}the car parked ${(drive.d || 0).toFixed(0)} m from it)`);
  await shot('drive');

  // the junctions: the signals change, and the traffic stops for them (junctions.js; tools/traffic_check.js measures the flow)
  const lights = await p.evaluate(() => {
    const g = window.__game, A = g.cars, JN = A.junctions;
    if (!JN) return { none: true };
    const sig = JN.J.filter(j => j.sig).sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y));
    if (!sig.length) return { junctions: JN.J.length, signals: 0 };
    const j = sig[0], seen = new Set(), s0 = A.stats();
    for (let t = 0; t < 80; t++) { g.advance(1); seen.add(j.ph + j.st); }
    const s1 = A.stats();
    // the walk signals hold the crowd at a kerb; the lanes, the arrows and the banned turns
    const X = g.crowd.crossings, H = JN.heads || {};
    const wait = X ? [...X.byLine.values()].flat().map(x => x.a).find(a => a.j === j) : null;
    const walks = wait ? Array.from({ length: 75 }, () => { g.advance(1); return JN.walk(wait); }) : [];
    const two = A.C.filter(c => c.line >= 0 && c.ln === 1).length;
    return { junctions: JN.J.length, signals: sig.length, heads: s1.heads, states: seen.size, red: s1.redRuns - s0.redRuns, moving: A.C.filter(c => c.line >= 0 && c.v > 1).length,
      crossings: X ? X.byLine.count : 0, walkSignals: H.walks || 0, walkTurns: new Set(walks).size, arrows: s1.arrows, arrowHeads: H.arrows || 0, bans: s1.bans, two };
  });
  if (lights.none) check(false, 'the traffic has junctions');
  else {
    check(lights.junctions > 0, `${lights.junctions} junctions, ${lights.signals} with signals (${lights.heads || 0} lanterns)`);
    if (lights.signals) check(lights.states >= 4, `the nearest signals go through their phases (${lights.states} states in 80 s)`);
    check(!lights.red, `no car crosses its line on red (${lights.red || 0})`);
    check(lights.moving > 10, `the traffic moves (${lights.moving} cars on the move)`);
    if (lights.signals) {
      check(lights.crossings > 0 && lights.walkSignals > 0, `the crowd's footways cross at the signals (${lights.crossings} crossings, ${lights.walkSignals} walk signals)`);
      if (lights.walkTurns) check(lights.walkTurns === 2, 'the nearest junction\'s walk signal turns on and off');
    }
    check(!lights.arrows || lights.arrowHeads > 0, `${lights.arrows || 0} junctions with a turn arrow (${lights.arrowHeads || 0} arrow lanterns), ${lights.bans || 0} banned turns, ${lights.two} cars in a main road's second lane`);
  }
  await shot('junction');

  // a lost WebGL context on purpose (WEBGL_lose_context): the game holds under a note, and once the
  // context is back the next frame is drawn, lit as it was (web/glcare.js, tools/glcare_step.js)
  await p.evaluate(() => { const g = window.__game; g.clock.frozen = true; }); // the light held still, to compare before and after
  const gl = await require('./glcare_step')(p, { canvas: 'game-gl', api: '__game', outDir, prefix: `${city}-` });
  check(gl.paused && gl.note, `a lost context holds the game under a note (paused ${gl.paused}, note ${gl.note})`);
  check(gl.drawn && gl.noteGone && gl.reloads === 0 && gl.after.sd >= 4, `the context restored, the next frame is drawn (in ${(gl.ms / 1000).toFixed(1)} s, luma ${gl.after.mean.toFixed(0)} ± ${gl.after.sd.toFixed(1)})`);
  check(Math.abs(gl.after.mean - gl.before.mean) < 10, `and lit as before (luma ${gl.before.mean.toFixed(1)} before, ${gl.after.mean.toFixed(1)} after)`);

  check(!logs.some(l => l.startsWith('pageerror')), 'no page errors');
  if (logs.length) console.log(logs.slice(0, 15).join('\n'));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
