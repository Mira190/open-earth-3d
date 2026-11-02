// Smoke-test a city's game headlessly (software WebGL through SwiftShader): load it, start
// it, walk, travel from the map to a landmark and run there, talk to the first quest giver,
// fly the helicopter up and watch the ferries move, drive your car, hail a taxi and ride it
// (and order a ride on the phone), travel from the map in your car, and watch the signals at
// the nearest junction change with the traffic stopping for them, with a screenshot after
// each. Prints what happened and the page's errors; exits 1 on failure.
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

  // a quay (web/quays.js): walk straight at a seawall and stop on its coping, within a metre of its
  // face, at the level of the quay, not a cell short of it at the terrain grid's bank
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
      r = Object.assign(r, { at: [Math.round(x), Math.round(y)], d: Q.dist(pl.x, pl.y), z: pl.z, top, mode: pl.mode });
      break;
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return r;
  });
  if (quay.none) check(true, 'no quays');
  else if (quay.d == null) check(false, `found no clear walk up to a seawall (${quay.tried} tried)`);
  else check(quay.mode === 'foot' && quay.d > -1.0 && quay.d < 0 && Math.abs(quay.z - quay.top) < 0.6,
    `walks up to the seawall at ${quay.at} and stops ${(-quay.d).toFixed(2)} m short of its face, ${quay.z.toFixed(1)} m up (the quay is ${quay.top.toFixed(1)} m)`);

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
    for (let i = 0; i < 150 && o.phase === 'coming'; i++) { g.advance(1); if (i % 10 === 0) { const st = o.drv.st, A = g.cars, near = A.C.filter(c => c.line >= 0 && Math.hypot(c.x - st.x, c.y - st.y) < 12).map(c => `${A.C.indexOf(c)}:${c.v.toFixed(1)}:${c.why}:${c.mv ? 'in' : ''}`).join(' '); r.log.push(`${i}s s=${st.s.toFixed(0)}/${o.drv.path.len.toFixed(0)} v=${st.v.toFixed(1)} d=${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} pass=${st.pass.toFixed(1)} shift=${st.shift.toFixed(1)} near[${near}]`); } }
    r.waiting = o.phase === 'waiting'; r.near = Math.hypot(o.drv.st.x - g.player.x, o.drv.st.y - g.player.y);
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
      r.why = `v ${t.v.toFixed(1)}, at ${t.s.toFixed(0)} of ${t.P.len.toFixed(0)} m${t.done ? " (done)" : ""}, phase ${o.phase}, pass ${t.pass.toFixed(1)}, held ${(t.held || 0).toFixed(0)} s, ${t.why}${t.block ? ` behind ${t.block === player ? 'you' : mc && t.block.x === mc.D.st.x ? 'your car' : t.block.line != null ? `a car on line ${t.block.line} (stuck ${(t.block.stuck || 0).toFixed(0)} s, v ${(t.block.v || 0).toFixed(1)})` : 'something'} at ${Math.hypot(t.block.x - t.x, t.block.y - t.y).toFixed(1)} m${t.block.still ? ', still' : ''}` : ''}; ${ahead.join('; ') || 'nothing ahead'}`;
    }
    g.skipRide();
    g.advance(6);
    r.arrived = o.phase === 'arrived';
    g.leaveRide();
    g.advance(1);
    r.out = g.player.mode === 'foot';
    const dest = g.destinations(g.player.x, g.player.y)[0];
    if (dest) g.orderRide(dest);
    const q = g.ride();
    r.ordered = !!q && q !== o && q.kind === 'hire' && q.phase === 'coming';
    if (r.ordered) g.cancelRide();
    return r;
  });
  if (taxi.none) check(true, 'no car, no taxis');
  else {
    check(taxi.hint, 'the kerb offers a taxi (Y)');
    if (taxi.log && !(taxi.hailed && taxi.waiting && taxi.near < 15)) console.log(taxi.log.join("\n"));
    check(taxi.hailed && taxi.waiting && taxi.near < 15, `hails a taxi: it pulls in beside you${taxi.hailed ? ` (${(taxi.near || 0).toFixed(1)} m away)` : ''}`);
    check(taxi.inTaxi && taxi.choices >= 2, `gets in the back, and the driver asks where to (${taxi.choices || 0} answers)`);
    check(taxi.you == null || taxi.you > 0, `in the back, your head is under the roof (${taxi.you == null ? 'not measured' : `${taxi.you.toFixed(2)} m`})`);
    check(taxi.driver == null || taxi.driver > 0, `the driver's head is under the roof (${taxi.driver == null ? 'not measured' : `${taxi.driver.toFixed(2)} m`})`);
    check(taxi.drove > 20, `drives off for ${taxi.dest || 'nowhere'} (${(taxi.drove || 0).toFixed(0)} m in 20 s)${taxi.why ? `: ${taxi.why}` : ''}`);
    check(taxi.arrived && taxi.out, 'skips the trip to the kerb there, and you get out');
    check(taxi.ordered, 'orders a ride on the phone');
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

  check(!logs.some(l => l.startsWith('pageerror')), 'no page errors');
  if (logs.length) console.log(logs.slice(0, 15).join('\n'));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
