// Smoke-test a city's game headlessly (software WebGL through SwiftShader): load it, start
// it, walk, talk to the first quest giver, fly the helicopter up and watch the ferries move,
// drive your car, and hail a taxi and ride it (and order a ride on the phone), with a
// screenshot after each. Prints what happened and the page's errors; exits 1 on failure.
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
    return { mode: g.player.mode, climbed: g.heli.st.z - z0, open, shut };
  });
  check(heli.none || (heli.open > 0.9 && heli.shut === 0), heli.none ? 'no helicopter' : `climbs in through the door (open ${(heli.open || 0).toFixed(2)}, then shut)`);
  check(heli.none || (heli.mode === 'heli' && heli.climbed > 10), heli.none ? 'no helicopter' : `flies the helicopter (climbed ${(heli.climbed || 0).toFixed(1)} m)`);
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
    const r = { inCar: g.player.mode === 'car', head: c.C.clearance(g.player.rig, 'driver'), top: 0 }, a = [st.x, st.y];
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
    for (let i = 0; i < 150 && o.phase === 'coming'; i++) g.advance(1);
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
    check(taxi.hailed && taxi.waiting && taxi.near < 15, `hails a taxi: it pulls in beside you${taxi.hailed ? ` (${(taxi.near || 0).toFixed(1)} m away)` : ''}`);
    check(taxi.inTaxi && taxi.choices >= 2, `gets in the back, and the driver asks where to (${taxi.choices || 0} answers)`);
    check(taxi.you == null || taxi.you > 0, `in the back, your head is under the roof (${taxi.you == null ? 'not measured' : `${taxi.you.toFixed(2)} m`})`);
    check(taxi.driver == null || taxi.driver > 0, `the driver's head is under the roof (${taxi.driver == null ? 'not measured' : `${taxi.driver.toFixed(2)} m`})`);
    check(taxi.drove > 20, `drives off for ${taxi.dest || 'nowhere'} (${(taxi.drove || 0).toFixed(0)} m in 20 s)`);
    check(taxi.arrived && taxi.out, 'skips the trip to the kerb there, and you get out');
    check(taxi.ordered, 'orders a ride on the phone');
  }
  await shot('taxi');

  check(!logs.some(l => l.startsWith('pageerror')), 'no page errors');
  if (logs.length) console.log(logs.slice(0, 15).join('\n'));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
