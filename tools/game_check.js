// Smoke-test a city's game headlessly (software WebGL through SwiftShader): load it, start
// it, walk, walk right up to the things the city names to see up close (tools/close_step.js), travel
// from the map to a landmark and run there, talk to the first quest giver, find every NPC in light and
// in sight at night, put the rain on and off (weather.js),
// fly the helicopter up and watch the ferries move, drive your car, hail a taxi and ride it (every
// place it offers reachable by road; out on the way, a hand up gets you back into it)
// (and order a ride on the phone, which must reach you within half a minute, shown on the
// phone's map), travel from the map in your car, watch the signals at the nearest junction
// change with the traffic stopping for them, watch the scrambles' crowds cross every way at once
// (tools/scramble_step.js), hear the walk signals' calls (tools/walkcalls_step.js), ride a taxi up
// behind a queue at a red light (it waits in its lane and goes when the queue moves), turn a ride
// with you in it round in the road (a three-point turn, never into the traffic), swing the
// chase camera round walls in tight spots
// frame by frame (it must ease, never jump), watch the signalled junctions round you for three minutes
// (no movement left standing in one for more than two cycles), and lose the WebGL context on purpose and get it
// back, with a screenshot after each. Prints what happened and the page's errors; exits 1 on failure.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/game_check.js sydney out_dir    # llvmpipe; without xvfb-run, SwiftShader
//   GAME_TIME=22:00 xvfb-run -a node tools/game_check.js osaka out_dir   # at that local hour in the city
// GAME_TIME (HH:MM, or YYYY-MM-DDTHH:MM) pins the page's clock to that wall time in the city's own
// time zone, so a game that starts at the live hour plays the same traffic and light on every run;
// tools/check.sh pins it (GAME_TIME=live leaves the real clock).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.'] = process.argv;
const { pinClock } = require('./pin_clock');
const { findQueue } = require('./ride_queue');
const { heldStep } = require('./junction_held_step');
const npcNight = require('./npc_night');
(async () => {
  // under xvfb-run, Mesa's llvmpipe draws the frames, about four times faster than SwiftShader
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  const pinned = await pinClock(p, city); // (GAME_TIME)
  if (pinned) console.log(`clock pinned to ${pinned.spec} in ${pinned.tz} (${pinned.utc})`);
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
  // DIGEST=1: at each screenshot, a digest of the traffic, the crowd, the lights and you (as tools/lockstep_probe.js
  // prints), to find the step at which two runs of the same tree part
  const digest = () => p.evaluate(() => {
    const g = window.__game, h = a => { let x = 2166136261; for (const v of a) { x ^= Math.round(v * 100) | 0; x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
    return `t ${g.t().toFixed(2)} clock ${g.clock.min.toFixed(2)} crowd ${h(g.crowd.P.slice(0, g.crowd.active).flatMap(q => [q.x, q.y]))} traffic ${h(g.cars.C.flatMap(c => [c.x, c.y, c.v]))} lights ${h(g.junctions.J.filter(j => j.sig).flatMap(j => [j.ph, j.t]))} you ${h([g.player.x, g.player.y, g.player.z])} tiles ${g.nav.tiles.join('/')} heli ${h([g.heli.st.x, g.heli.st.y, g.heli.st.z, g.heli.st.h || 0])} npcs ${h(g.npcs.flatMap(n => [n.x, n.y]))} ferries ${h(g.fer.vessels.flatMap(v => [v.x, v.y]))} cam ${h([g.camera.position.x, g.camera.position.y, g.camera.position.z])} carsActive ${g.cars.active} extra ${g.cars.extra.length}`;
  });
  const shot = async name => {
    if (process.env.DIGEST) console.log(`digest ${name}: ${await digest()}`);
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${city}-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // lockstep (#243): the world held for the whole run, so that only the check's advance() calls move
  // it, a thirtieth of a second at a time. The page's own frames still draw, but they don't step the
  // traffic by however long the machine took between two steps, so the same code plays the same run
  // on a fast machine and a loaded one. GAME_LOCKSTEP=0 leaves the frames running the world as a player's do.
  const lockstep = process.env.GAME_LOCKSTEP !== '0';
  // (the tiles round you laid by advance() while held, game.js, and the route network built, route.js: the roads it finds a car
  // can't get along are kept off by the traffic as it finds them, so a run started before it is done meets another traffic)
  if (lockstep) await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.heli && g.heli.want) await g.heli.want(); }); // (and the helicopter on its pad: fetched while the title shows, it may be there or not by the time the check holds the game)
  await p.evaluate(() => { try { localStorage.removeItem('oe3d-onboard'); } catch (e) { /* storage blocked */ } }); // a first-time player
  // the lights in the scene by kind, as three.js counts them for its shaders (one under a hidden parent does
  // not count). The count is built into every lit material's shader, so it must stay what it was on the
  // title: a light that comes, goes or hides later recompiles the whole city at once, seconds of frozen
  // frames (the helicopter's searchlight arriving with its model, a headlamp leaving with the car, the sun
  // hidden at night). Checked after the helicopter comes, after the car and the taxi, and by night and day.
  const lightCensus = () => p.evaluate(() => {
    const n = {}, walk = o => {
      if (!o.visible) return;
      if (o.isLight) { const k = `${o.type}${o.castShadow ? ' (shadow)' : ''}`; n[k] = (n[k] || 0) + 1; }
      for (const c of o.children) walk(c);
    };
    walk(window.__game.Wd.world);
    return Object.keys(n).sort().map(k => `${n[k]} ${k}`).join(', ');
  });
  const lights0 = await lightCensus();
  const lightsKept = async when => { const l = await lightCensus(); check(l === lights0, `the scene's lights are the title's ${when} (${l}${l === lights0 ? '' : `; on the title ${lights0}`})`); };
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  // (the game reads its clock at Play, from a Date that runs on at the real rate from GAME_TIME: a load
  // that took longer starts it a little later, with a crowd of another size; in lockstep it starts on the minute)
  if (lockstep && pinned) await p.evaluate(spec => {
    const g = window.__game, m = /(\d\d?):(\d\d)$/.exec(spec), min = m ? +m[1] * 60 + +m[2] : null;
    if (min != null && Math.abs(g.clock.min - min) < 30) { g.setClock(g.clock.y, g.clock.m, g.clock.d, min); g.crowdAuto(true); }
  }, pinned.spec);
  await p.evaluate(() => window.__game.advance(1));
  await shot('start');

  // what loads after the game opens (issue 148): the NPCs away from the start as you come near them,
  // and the helicopter's model when a pad is in range; here all of them at once, and in their places
  const lazy = await p.evaluate(async () => {
    const g = window.__game, open = g.npcs.filter(n => n.rig.pending).length, t = performance.now();
    g.hold(true); // (the world held while they load: the traffic's run after doesn't depend on how long that takes, #201)
    const was = g.held ? g.held() : false;
    try { await g.npcsReady(); if (g.heli && g.heli.want) await g.heli.want(); } finally { g.hold(was); }
    if (g.heli && g.heli.want) g.advance(0.1);
    return { n: g.npcs.length, open, pending: g.npcs.filter(n => n.rig.pending).length, drawn: g.npcs.filter(n => n.rig.character).length,
      wanted: g.npcs.filter(n => n.look.character).length, heli: !g.vlib || !g.heli || g.heli.loaded(), s: (performance.now() - t) / 1000 };
  });
  check(lazy.pending === 0 && lazy.drawn >= lazy.wanted - 1, `the NPCs' characters load after the game opens (${lazy.open} of ${lazy.n} still to come at the start; all in place after ${lazy.s.toFixed(1)} s, ${lazy.drawn} of ${lazy.wanted} as their own characters)`);
  check(lazy.heli, 'the helicopter\'s model comes after the game opens and stands on its pad');
  if (process.env.DIGEST) console.log(`digest lazy: ${await digest()}`);
  await lightsKept('once the helicopter has come');

  // the chase camera in tight spots: placed with a wall close behind, the camera swung round
  // (as a drag would) and then walked or driven along, frame by frame. Its wall lift and pull-in
  // must ease: no frame may turn the view's pitch or move the camera about the player by a jump (#97)
  const swing = mode => p.evaluate(mode => {
    const g = window.__game, V = (x, y, z) => new THREE.Vector3(x, z, -y), r = { spots: 0, pitch: 0, move: 0, lifted: 0 };
    const head = () => mode === 'car' ? (s => V(s.x, s.y, s.z + 1.5))(g.myCar().D.st) : V(g.player.x, g.player.y, g.player.z + 1.55);
    const settle = () => { for (let i = 0; i < 45; i++) g.advance(1 / 30); }; // advance() moves the camera once per call
    const run = (frames, each, walk = true) => { // the second half walking on (on foot)
      let last = null;
      for (let i = 0; i < frames; i++) {
        each(i);
        g.advance(1 / 30, walk && i >= frames / 2 ? ['KeyW'] : []);
        const c = g.camera.position, t = g.live.look, off = c.clone().sub(t), pitch = Math.atan2(off.y, Math.hypot(off.x, off.z));
        r.lifted = Math.max(r.lifted, g.cam.lift || 0);
        const v = last && off.clone().sub(last.off);
        if (last) { r.pitch = Math.max(r.pitch, Math.abs(pitch - last.pitch) * 180 / Math.PI); if (last.v) r.move = Math.max(r.move, v.distanceTo(last.v)); }
        last = { pitch, off, v };
      }
    };
    if (mode === 'car') {
      const c = g.myCar && g.myCar();
      if (!c) return null;
      if (g.player.mode !== 'car') { const st = c.D.st; g.player.x = st.x; g.player.y = st.y; g.player.z = st.z; g.enterCar(); for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5); }
      if (g.player.mode !== 'car') return null;
      g.cam.mode = 'chase'; g.cam.dist = 7.5; settle();
      run(160, () => { g.cam.yaw += 0.04; }, false); // a full turn round the parked car (driving, a knock jolts the car itself)
      r.spots = 1;
      g.exitCar(); g.advance(1);
      return r;
    }
    // spots on the ground within 300 m where a wall stands within the camera's reach behind
    const x0 = g.player.x, y0 = g.player.y, spots = [];
    for (let k = 0; k < 400 && spots.length < 4; k++) {
      const a = k * 2.39996, d = 20 + 280 * Math.sqrt(k / 400), s = g.nav.stand(x0 + Math.cos(a) * d, y0 + Math.sin(a) * d, 0, { rMax: 3 });
      if (!s || spots.some(q => Math.hypot(q.x - s.x, q.y - s.y) < 40)) continue;
      const h = V(s.x, s.y, s.z + 1.55);
      for (let j = 0; j < 8; j++) {
        const yaw = j * Math.PI / 4, b = V(s.x - Math.sin(yaw) * 6.9, s.y - Math.cos(yaw) * 6.9, s.z + 1.55 + 2.6);
        const f = g.nav.clearFraction(h, b);
        if (f > 0.2 && f < 0.6) { spots.push({ x: s.x, y: s.y, z: s.z, yaw }); break; }
      }
    }
    for (const s of spots) {
      g.player.x = s.x; g.player.y = s.y; g.player.z = s.z; g.player.speed = 0;
      g.cam.mode = 'chase'; g.cam.dist = 7.5; g.cam.pitch = 0.36; g.cam.yaw = s.yaw + 1.2; g.player.h = s.yaw;
      settle();
      run(150, i => { if (i < 75) g.cam.yaw -= 0.032; });
      r.spots++;
    }
    return r;
  }, mode);
  const tight = (r, what) => {
    if (!r || !r.spots) { check(true, `no tight spot for the chase camera ${what}`); return; }
    check(r.pitch < 5 && r.move < 0.6, `the chase camera eases round walls ${what} (${r.spots} spots, lift up to ${r.lifted.toFixed(2)} rad; worst frame ${r.pitch.toFixed(1)}° of pitch, a ${r.move.toFixed(2)} m jolt)`);
  };

  // the arrival (#89): the calm move from the title shot hands over to the chase camera within 4.5 s, then the
  // first-time tour of the HUD opens; every step points at its control, it steps back and on, and skips
  const onboard = await p.evaluate(async () => {
    const g = window.__game, O = window.OEOnboard;
    let t = 1;
    while (g.arriving() && t < 8) { g.advance(0.25); t += 0.25; await new Promise(r => requestAnimationFrame(r)); }
    const head = g.player.z + 1.55, cam = g.camera.position, near = Math.hypot(cam.x - g.player.x, cam.z + g.player.y, cam.y - head);
    const tour = O.current(), steps = [], missing = [];
    if (tour) {
      for (let i = 0; i < tour.count; i++) {
        steps.push(tour.id);
        // where the card settles (it eases there in 0.5 s, which a software renderer under load draws late)
        const ce = tour.el.querySelector('.ob-card'), cl = parseFloat(ce.style.left), ct = parseFloat(ce.style.top);
        const card = { left: cl, top: ct, width: ce.offsetWidth, height: ce.offsetHeight, right: cl + ce.offsetWidth, bottom: ct + ce.offsetHeight };
        if (card.left < 0 || card.top < 0 || card.right > innerWidth || card.bottom > innerHeight) missing.push(`${tour.id}: card off screen at ${[card.left, card.top, card.width, card.height].map(Math.round)} (quest card ${(r => [r.left, r.top, r.width, r.height].map(Math.round))(document.getElementById('g-quest').getBoundingClientRect())})`);
        if (i < tour.count - 1) tour.next();
      }
      tour.back(); const back = tour.step;
      const noTalk = g.currentAction() === null; // nothing to start (no talk, no boarding) while it shows
      tour.skip();
      return { arrived: t, near, steps, missing, back, skipped: !O.active(), flag: O.done(), noTalk };
    }
    return { arrived: t, near, steps, missing, flag: O.done() };
  });
  if (process.env.DIGEST) console.log(`digest onboard: ${await digest()}`);
  // an opening shot at a scramble (#110: Shibuya): you start at its kerb or on its stripes, the walk on, the crowd round you
  const opening = await p.evaluate(() => {
    const g = window.__game, pl = g.player, sc = (g.scene.landmarks || {}).scramble;
    if (!g.opening() || !sc || !sc.lines) return null;
    const j = g.junctions.J.find(q => q.scramble && Math.hypot(q.x - pl.x, q.y - pl.y) < 80);
    let kerb = Infinity, on = Infinity;
    for (const [[ax, ay], [bx, by]] of sc.lines) {
      kerb = Math.min(kerb, Math.hypot(pl.x - ax, pl.y - ay), Math.hypot(pl.x - bx, pl.y - by));
      const ex = bx - ax, ey = by - ay, u = Math.max(0, Math.min(1, ((pl.x - ax) * ex + (pl.y - ay) * ey) / (ex * ex + ey * ey)));
      on = Math.min(on, Math.hypot(pl.x - ax - ex * u, pl.y - ay - ey * u));
    }
    return { kerb, on, ph: j ? `${j.ph}${j.st}` : 'none', walkers: g.crowd.P.filter(q => q.line >= 0 && Math.hypot(q.x - pl.x, q.y - pl.y) < 10).length };
  });
  if (opening) check((opening.kerb < 3 || opening.on < 2) && opening.ph === '3g' && opening.walkers >= 6,
    `the game opens at the scramble's kerb (${opening.kerb.toFixed(1)} m from a crosswalk's end, ${opening.on.toFixed(1)} m from its stripes), in its walk (phase ${opening.ph}), ${opening.walkers} walkers within 10 m`);
  check(onboard.arrived < 4.5, `the arrival hands over to the chase camera (${onboard.arrived.toFixed(2)} s after the start; the camera ${onboard.near.toFixed(1)} m from the player's head)`);
  check(onboard.steps.length >= 8 && !onboard.missing.length && onboard.back === onboard.steps.length - 2 && onboard.skipped && onboard.flag && onboard.noTalk,
    `the HUD tour opens the first time, steps through ${onboard.steps.join(', ')}, steps back and skips, and remembers it${onboard.missing.length ? ` (${onboard.missing.join('; ')})` : ''}`);
  // a second map with the flag set: the arrival again, with no tour and the guide's short welcome instead
  const second = await p.evaluate(async () => {
    const g = window.__game, O = window.OEOnboard;
    const seen = [], mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => seen.push(n.textContent))));
    mo.observe(document.getElementById('g-toasts'), { childList: true }); // (toasts are capped at three and fade)
    g.craneIn(() => (O.done() && document.getElementById('gt-skip-on').checked ? g.welcome(true) : g.startTour(() => g.welcome(false))));
    g.advance(0.5); g.settleArrival(); // a key settles it
    let t = 0;
    while (g.arriving() && t < 3) { g.advance(0.1); t += 0.1; await new Promise(r => requestAnimationFrame(r)); }
    await new Promise(r => setTimeout(r, 50)); mo.disconnect();
    const toasts = seen;
    return { settled: t, tour: O.active(), toast: toasts.join(' | ') };
  });
  if (process.env.DIGEST) console.log(`digest second: ${await digest()}`);
  check(second.settled < 1.2 && !second.tour && /gold line|minimap shows the way/.test(second.toast),
    `on a later map the intro is skipped: a key settles the arrival (${second.settled.toFixed(1)} s), no tour, the guide's welcome ("${second.toast.slice(0, 90)}")`);

  // the overture (overture.js, docs/OVERTURE.md), on a map that has one: it plays through to the player's
  // shoulder, the walk at its signal turns green, and a key at any point eases down to the player in under a second
  const ov = await p.evaluate(async () => {
    const g = window.__game, o = g.overture();
    if (!o) return null;
    const out = {};
    let done = null;
    out.started = o.play(sk => { done = { skipped: sk }; });
    if (!out.started && o.variant === 'day' && g.G.overture.day === false) return { off: true }; // (its day overture is off: the opening shot plays)
    if (!out.started) return out;
    let t = 0;
    while (o.active && t < o.total + 3) { g.advance(0.25); t += 0.25; if (Math.round(t * 4) % 16 === 0) await new Promise(r => requestAnimationFrame(r)); }
    for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r)); // (a frame or two of the chase camera)
    const e = o.end, head = g.player.z + 1.55, cam = g.camera.position;
    out.t = t; out.total = o.total; out.done = done; out.kind = o.kind;
    out.near = Math.hypot(cam.x - g.player.x, cam.z + g.player.y, cam.y - head);
    out.at = Math.hypot(g.player.x - e[0], g.player.y - e[1]);
    const sig = g.G.overture.shots.some(q => (q.cues || []).some(c => c[1] === 'green')) ? g.G.overture.signal : null; // (only an overture that turns its signal green)
    if (sig) { const p0 = o.point(sig), j = g.junctions.J.filter(q => q.sig).sort((a, b) => Math.hypot(a.x - p0[0], a.y - p0[1]) - Math.hypot(b.x - p0[0], b.y - p0[1]))[0]; out.signal = j ? { d: Math.hypot(j.x - p0[0], j.y - p0[1]), ph: j.ph, st: j.st, scramble: !!j.scramble } : null; }
    out.layer = !!document.querySelector('.ov-layer');
    // skipped a few seconds in
    done = null;
    o.play(sk => { done = { skipped: sk }; });
    g.advance(4);
    o.skip();
    let s = 0;
    while (o.active && s < 3) { g.advance(0.1); s += 0.1; await new Promise(r => requestAnimationFrame(r)); }
    out.skip = s; out.skipDone = done;
    return out;
  });
  if (ov && ov.off) check(true, 'the overture is for after dark here; by day the opening shot plays');
  else if (ov) {
    check(ov.started && ov.done && !ov.done.skipped && ov.t <= ov.total + 1 && ov.near < 12 && ov.at < 3,
      `the overture plays (${ov.total ? ov.total.toFixed(1) : '?'} s, guide ${ov.kind}) and hands over to the chase camera ${ov.near != null ? ov.near.toFixed(1) : '?'} m from the player's head, ${ov.at != null ? ov.at.toFixed(1) : '?'} m from its end spot`);
    if (ov.signal !== undefined) check(ov.signal && ov.signal.d < 30 && ov.signal.st === 'g' && (ov.signal.scramble ? ov.signal.ph === 3 : ov.signal.ph === 1),
      `the overture's signal turns the walk green as control comes to you (${JSON.stringify(ov.signal)})`);
    check(ov.skipDone && ov.skipDone.skipped && ov.skip < 1.2, `a key during the overture eases down to the player (${ov.skip != null ? ov.skip.toFixed(1) : '?'} s)`);
  }

  // walking: forward for four seconds
  const walk = await p.evaluate(() => {
    const g = window.__game, a = [g.player.x, g.player.y];
    g.advance(4, ['KeyW']);
    return { moved: Math.hypot(g.player.x - a[0], g.player.y - a[1]), mode: g.player.mode, z: g.player.z };
  });
  check(walk.moved > 3, `walks forward (${walk.moved.toFixed(1)} m in 4 s, on foot at ${walk.z.toFixed(1)} m)`);
  await shot('walk');
  tight(await swing('foot'), 'on foot');
  await p.evaluate(() => { const g = window.__game; g.spawn(); g.advance(1); });

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

  // the crowd crosses a major road only at a crosswalk (its signals, a zebra or a scramble: actors.js roadEntries,
  // tools/jaywalk_probe.js), not wherever a footway steps off the kerb
  const jay = await p.evaluate(() => {
    const g = window.__game, C = g.crowd.crossings;
    let n = 0, out = 0;
    const who = [];
    if (!C || !C.major) return { n, out };
    for (let k = 0; k < 8; k++) {
      g.advance(1);
      for (const q of g.crowd.P.slice(0, g.crowd.active)) {
        if (q.line < 0 || q.state !== 'walk') continue;
        n++;
        if (!C.road(q.x, q.y) || !C.major(q.x, q.y)) continue;
        const h = g.crowdNet.at(q.line, q.s, {}), X = C.byLine.get(q.line);
        if (!C.across(q.x, q.y, h.hx, h.hy) || (X && X.some(c => Math.abs(c.s - q.s) < c.kerb + 2)) || C.zebra(q.x, q.y)) continue;
        out++; if (who.length < 6 && !who.some(w => w.i === q)) who.push({ i: q, d: `walker ${g.crowd.P.indexOf(q)} on footway ${q.line} at ${q.x.toFixed(0)},${q.y.toFixed(0)} s ${q.s.toFixed(1)} dir ${q.dir} ${q.mode} v ${(+q.v || 0).toFixed(1)}${q.plaza ? ' plaza' : ''}${q.kerbNext ? ' kerbNext' : ''}` });
      }
    }
    return { n, out, who: who.map(w => w.d) };
  });
  check(jay.n > 0 && jay.out <= Math.max(3, 0.01 * jay.n), `the crowd crosses major roads only at crosswalks (${jay.out} of ${jay.n} walkers crossing one elsewhere, at most 1%)`);
  if (jay.who && jay.out > Math.max(3, 0.01 * jay.n)) console.log(`  crossing elsewhere: ${jay.who.join('; ')}`);

  // no signal pole or walk post stands in a road's lanes (any road's drawn width, not just the one it serves: tools/pole_lanes.js)
  const poles = await p.evaluate(() => {
    const g = window.__game, H = g.junctions.heads, net = g.roadNet, HALF = { motorway: 7, trunk: 6, primary: 6, secondary: 5, tertiary: 4.5, residential: 3.5, unclassified: 3, living_street: 2.5 }, out = [];
    if (!H) return { n: 0, out };
    for (const o of [...H.list, ...H.peds]) { const q = net.nearest(o.x, o.y, 10, o.z, 3); if (q && q.d < (HALF[net.L[q.line].c] || 3.5) - 0.2) out.push(`${o.x.toFixed(0)},${o.y.toFixed(0)}`); }
    return { n: H.list.length + H.peds.length, out };
  });
  check(!poles.out.length, `no signal pole or walk post stands in a road's lanes (${poles.out.length} of ${poles.n}${poles.out.length ? ': ' + poles.out.slice(0, 6).join(' ') : ''})`);

  // the crowd keeps out of each other (actors.js CLOSE) and never jumps: over five seconds near you, a
  // frame at a time, no two walkers closer than 0.45 m centre to centre (0.3 m out on a crossing's road) (they would show inside each
  // other) and none moving farther in a frame than anyone walks (tools/crowd_spacing.js measures more)
  const spacing = await p.evaluate(() => {
    const g = window.__game, P = g.crowd.P, me = g.player, last = new Map();
    // (out in a carriageway on a crossing they may close in to shoulders brushing, to clear it: actors.js)
    const XS = g.crowd.crossings && g.crowd.crossings.byLine, inRoad = q => !!(XS && (XS.get(q.line) || []).some(x => Math.abs(x.s - q.s) < x.kerb));
    let close = 0, jumps = 0, n = 0;
    const seen = [];
    for (let k = 0; k < 150; k++) {
      g.advance(1 / 30);
      const A = P.slice(0, g.crowd.active).filter(q => q.line >= 0 && q.state === 'walk' && Math.hypot(q.x - me.x, q.y - me.y) < 50);
      for (const q of last.keys()) if (!A.includes(q)) last.delete(q); // (one out of the 50 m and back in is measured from its frame back in, not from where it went out)
      n = Math.max(n, A.length);
      for (const q of A) { const l = last.get(q), dj = l ? Math.hypot(q.x - l[0], q.y - l[1]) : 0; if (l && dj > 0.25 && dj < 20) { jumps++; if (seen.length < 3) seen.push(`${dj.toFixed(2)} m on line ${q.line} (was ${l[2]}) s ${(+q.s || 0).toFixed(1)} at ${q.x.toFixed(1)}, ${q.y.toFixed(1)}${q.mode ? ` ${q.mode}` : ''}${q.pz ? ' (a scramble crowd)' : ''}; a frame before: ${l[3]}`); } last.set(q, [q.x, q.y, q.line, `${q.state} ${q.mode || ''} line ${q.line} s ${(+q.s || 0).toFixed(1)} v ${(+q.v || 0).toFixed(2)} dir ${q.dir}${q.pz ? ` scramble ${q.ph}` : ''}${q.side != null ? ` side ${(+q.side).toFixed(2)}` : ''}`]); }
      for (let a = 0; a < A.length; a++) for (let b = a + 1; b < A.length; b++) {
        const q = A[a], r = A[b];
        if (Math.abs(q.z - r.z) < 1.5 && Math.hypot(q.x - r.x, q.y - r.y) < (inRoad(q) || inRoad(r) ? 0.3 : 0.45)) close++;
      }
    }
    return { close, jumps, n, seen };
  });
  check(spacing.close === 0 && spacing.jumps === 0, `the crowd keeps out of each other (${spacing.close} frames with two walkers inside each other, ${spacing.jumps} jumps${spacing.seen.length ? `: ${spacing.seen.join('; ')}` : ''}, of up to ${spacing.n} walkers near you)`);

  // the weather (weather.js): rain on, and the streaks are drawn, kept out from under cover by the
  // occlusion map, the ground wet, umbrellas up in the crowd, the HUD saying so, and the frame neither
  // black nor blown; then clear again, dry and quiet. And the season's weather keeps to the city's
  // climate: over a year, wet days within a third of what its normals give.
  const rain = await p.evaluate(async () => {
    const g = window.__game, W = g.weather;
    if (!W) return null;
    const luma = () => { const c = document.getElementById('game-gl'), t = document.createElement('canvas'); t.width = 96; t.height = 60;
      const x = t.getContext('2d'); x.drawImage(c, 0, 0, 96, 60); const d = x.getImageData(0, 0, 96, 60).data; let s = 0, hi = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; if (l > 250) hi++; } return { mean: s / (d.length / 4), blown: hi / (d.length / 4) }; };
    const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    W.set('rain', { now: true });
    g.advance(2);
    await frames(4);
    const st = W.state, cd = g.crowdDraw(), m4 = new THREE.Matrix4();
    let umb = 0;
    if (cd && cd.umbrellas) for (const m of Object.values(cd.umbrellas)) if (m.visible) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, m4); if (m4.elements[0] !== 0) umb++; }
    umb += cd ? [...cd.active.values()].filter(r => r.umbOn).length : 0;
    const out = { st, umb, walkers: g.crowd.P.filter(q => q.line >= 0).length, streaks: W.meshes.near.visible && W.meshes.near.material.uniforms.uCount.value > 0.5,
      occ: W.U.uOeOccOn.value, chip: document.querySelector('#g-sun span').textContent, lum: luma() };
    W.set('clear', { now: true });
    g.advance(1);
    await frames(2);
    out.after = W.state; out.dry = !W.meshes.near.visible;
    // a year of the season's weather at 09:00 and 15:00
    const cl = g.G.weather;
    if (cl) {
      let wet = 0, want = 0;
      for (let k = 0; k < 365; k++) { const t = new Date(Date.UTC(2026, 0, 1) + k * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
        if (W.season(y, m, d, 9 * 60).rain > 0.06 || W.season(y, m, d, 15 * 60).rain > 0.06) wet++; }
      for (let m = 1; m <= 12; m++) want += OEWeather.wetChance(cl, m) * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
      out.year = { wet, want: Math.round(want) };
    }
    W.set('live');
    return out;
  });
  if (rain) {
    check(rain.st.kind === 'rain' && rain.st.rain > 0.5 && rain.st.wet > 0.5 && rain.streaks && rain.occ === 1,
      `rain falls (rain ${rain.st.rain.toFixed(2)}, ground wet ${rain.st.wet.toFixed(2)}, streaks ${rain.streaks}, occlusion map ${rain.occ})`);
    // umbrellas are off for now (people.js UMBRELLAS): nobody puts one up
    check(rain.umb === 0, `no umbrellas in the crowd (${rain.umb} of ${rain.walkers} walkers)`);
    check(/^(Rain|Drizzle) · /.test(rain.chip), `the HUD shows the rain ("${rain.chip}")`);
    check(rain.lum.mean > 18 && rain.lum.blown < 0.02, `the rain's frame is lit, not black or blown (luma ${rain.lum.mean.toFixed(0)}, ${(rain.lum.blown * 100).toFixed(1)}% blown)`);
    check(rain.after.rain === 0 && rain.after.wet === 0 && rain.dry, 'and clear again, dry');
    if (rain.year) check(Math.abs(rain.year.wet - rain.year.want) <= Math.max(8, rain.year.want / 3), `the season's weather keeps to the climate (${rain.year.wet} wet days in a year, normals ${rain.year.want})`);
  }

  // what a slow device sheds of the weather (weather.js shed, driven by game.js shed): first the far
  // streaks and splashes, then the weather altogether, dry, remembered for the next visit and said in
  // a toast (its note); a pick from the menu brings it back; a weather the visitor picked keeps its
  // wet streets and loses only its drops
  const guard = await p.evaluate(() => {
    const W = window.__game.weather;
    if (!W || !W.guardForce) return null;
    W.guardReset(); W.guardForce(true);
    W.set({ rain: 0.9, cloud: 1, wet: 1, now: true });
    W.update(0.1, 1, null);
    const full = { level: W.level, shed: W.shed };
    W.shed = 1; W.update(0.1, 1.1, null);
    const light = { level: W.level, near: W.meshes.near.visible, far: W.meshes.far.visible, splash: W.meshes.splash.visible };
    W.shed = 2;
    let kept = null;
    try { kept = localStorage.getItem('oe3d-weather-guard'); } catch (e) { /* storage blocked */ }
    const off = { level: W.level, mode: W.mode, kept };
    W.update(0.1, 2, null);
    const dry = W.state;
    const note = W.takeNote();
    W.set('rain', { now: true });
    const back = W.level;
    W.guardReset();
    W.set('rain', { now: true, keep: true }); W.update(0.1, 3, null);
    W.shed = 1; W.shed = 2; W.update(0.1, 3.1, null);
    const picked = { mode: W.mode, near: W.meshes.near.visible, rain: W.state.rain, shed: W.shed };
    W.guardReset(); W.guardForce(false);
    try { localStorage.removeItem('oe3d-weather'); } catch (e) { /* storage blocked */ }
    W.set('clear', { now: true }); W.update(0.1, 4, null); W.set('live');
    return { full, light, off, dry: { rain: dry.rain, wet: dry.wet }, note, back, picked };
  });
  if (guard) {
    check(guard.full.level === 2 && guard.full.shed === 0, `the full rain to begin with (level ${guard.full.level}, shed ${guard.full.shed})`);
    check(guard.light.level === 1 && guard.light.near && !guard.light.far && !guard.light.splash,
      `a slow device sheds the far streaks and splashes first (level ${guard.light.level}, near ${guard.light.near}, far ${guard.light.far}, splash ${guard.light.splash})`);
    check(guard.off.level === 0 && guard.off.mode === 'off' && guard.off.kept === 'off' && guard.dry.rain === 0 && guard.dry.wet === 0,
      `and then the weather, dry, remembered (level ${guard.off.level}, ${guard.off.mode}, kept ${guard.off.kept}, rain ${guard.dry.rain}, wet ${guard.dry.wet})`);
    check(/Weather is off/.test(guard.note || ''), `and says so ("${guard.note}")`);
    check(guard.back >= 1, `a weather picked again comes back on (level ${guard.back})`);
    check(guard.picked.mode === 'rain' && !guard.picked.near && guard.picked.rain > 0.5 && guard.picked.shed === 2,
      `a weather the visitor picked is kept, without its drops (${guard.picked.mode}, drops ${guard.picked.near}, rain ${guard.picked.rain.toFixed(2)})`);
  }

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
      // water beyond the wall, not a pier's deck that carries on from it (a walker goes on onto the jetty)
      if ([1, 1.5, 2.5].some(e => { const q = g.nav.floorAt(x + nx * e, y + ny * e, top + 1); return q && q.z > 0.5 && Math.abs(q.z - top) < 1 && g.nav.walk(x + nx * e, y + ny * e, q.z).ok; })) continue;
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
    const b = typeof P.data === 'string' ? Uint8Array.from(atob(P.data), c => c.charCodeAt(0)) : P.data, Z = new Int16Array(b.buffer, b.byteOffset, P.nx * P.ny);
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
    if (!(g.G.patches || []).some(P => (P.walks || []).length)) return out; // (no time passes: the traffic later steps meet stays as it was)
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

  // the landmarks' fine collision is laid tile by tile (web/game/nav.js): what the start cost, and the
  // tiles round the walker all laid when asked (as the game's frames do, a few ms at a time)
  {
    const f = await p.evaluate(() => { const n = window.__game.nav, pl = window.__game.player, b0 = n.fineBoxes;
      const t = performance.now(), all = n.prefetch(pl.x, pl.y, 48, 60000);
      const [laid, of] = n.tiles;
      return { start: n.startMs, sweeps: n.sweepMs, boxes: b0, ms: n.fineMs, laid, of, all, more: n.fineBoxes - b0, prefetch: performance.now() - t }; });
    // (by the start: the tiles round the walker; the sweeps read a landmark's triangles, nav.js withoutFine)
    check(f.all, `the landmarks' fine collision: sorted into tiles in ${f.start.toFixed(0)} ms at the start, the start-up sweeps ${f.sweeps.toFixed(0)} ms, ${f.boxes} boxes in ${f.laid} of ${f.of} tiles laid by the start (${(f.ms - f.prefetch).toFixed(0)} ms); the tiles within 48 m of the walker laid on asking (${f.more} more boxes, ${f.prefetch.toFixed(0)} ms)`);
  }

  // the camera under a slab (a patch's "upper", such as the forecourt over Sydney's Lower Concourse
  // colonnade): standing under it at up to 8 places spread along it, the camera swung round in 8
  // directions sees the walker from under the slab or from beyond it, never through it (its line to the
  // head does not pass between the soffit, clear_m over the floor, and the slab's top)
  const slabCam = await p.evaluate(() => {
    const g = window.__game, pl = g.player, out = [];
    const dec = s => { const b = typeof s === 'string' ? Uint8Array.from(atob(s), c => c.charCodeAt(0)) : s; return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); };
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw, pitch: g.cam.pitch };
    for (const P of g.G.patches || []) {
      const U = P.upper;
      if (!U) continue;
      const Z = dec(P.data), UZ = dec(U.data), clear = P.clear_m || 2.2;
      const slab = (x, y) => {
        const c = Math.floor((x - P.x0) / P.cell), r = Math.floor((y - P.y0) / P.cell), uc = c - U.i0, ur = r - U.j0;
        if (uc < 0 || ur < 0 || uc >= U.nx || ur >= U.ny || c >= P.nx || r >= P.ny) return null;
        const u = UZ[ur * U.nx + uc], f = Z[r * P.nx + c];
        return u === -32768 || f === -32768 ? null : [f / 100, u / 100];
      };
      // places under the slab with room round them (the slab 1.5 m round on every side)
      const under = [];
      for (let j = 0; j < U.ny; j += 2) for (let i = 0; i < U.nx; i += 2) {
        const x = P.x0 + (U.i0 + i + 0.5) * P.cell, y = P.y0 + (U.j0 + j + 0.5) * P.cell, s = slab(x, y);
        if (s && [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([dx, dy]) => slab(x + dx, y + dy)) && g.nav.walk(x, y, s[0]).ok) under.push([x, y, s[0]]);
      }
      for (let n = 0; n < Math.min(8, under.length); n++) {
        const [x, y, z] = under[Math.floor((n + 0.5) * under.length / Math.min(8, under.length))];
        let worst = null;
        for (let k = 0; k < 8; k++) {
          Object.assign(pl, { x, y, z, ground: true, vz: 0, speed: 0 });
          g.cam.yaw = k * Math.PI / 4; g.cam.pitch = 0.35;
          for (let i = 0; i < 20; i++) g.advance(0.05);
          const c = g.live.pos, cx = c.x, cy = -c.z, cz = c.y, hz = pl.z + 1.55;
          for (let s = 0; s <= 1; s += 0.02) {
            const X = pl.x + (cx - pl.x) * s, Y = pl.y + (cy - pl.y) * s, H = hz + (cz - hz) * s, q = slab(X, Y);
            if (q && H > q[0] + clear + 0.05 && H < q[1] - 0.05) { worst = { k, at: [X.toFixed(1), Y.toFixed(1), H.toFixed(2)], slab: q }; break; }
          }
          if (worst) break;
        }
        out.push({ at: [Math.round(x), Math.round(y)], z, worst });
      }
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.cam.pitch = keep.pitch; g.advance(0.2);
    return out;
  });
  for (const s of slabCam) check(!s.worst, `the camera stays out of the slab over ${s.at} (${s.z.toFixed(2)} m)` +
    (s.worst ? `: its line to the head passes through it at ${s.worst.at} (floor and top ${s.worst.slab}), looking ${s.worst.k * 45}°` : ''));

  // up close: walk right up to each thing the city's builders name to see close to (game.json "close",
  // a spot's "reach": a shrine's ema rack, a lantern, a statue, a gate's posts), within 1.5 m or what the
  // target says and never into it; and look closer at each photo spot (a spot's "look") and step back
  // (tools/close_step.js)
  {
    const keep = await p.evaluate(() => { const g = window.__game, pl = g.player; return { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw }; });
    const near = await require('./close_step')(p, {});
    for (const r of near) {
      if (r.look) check(r.ok, `looks closer at ${r.name} (${r.open ? `the eye ${r.eye.toFixed(2)} m off it, reading "${String(r.text).slice(0, 40)}", ${r.moved.toFixed(2)} m along it, ${r.closed && r.back ? 'and back' : 'NOT back'}` : `offered: ${r.offered}`})`);
      else check(r.ok, `walks up to ${r.name}: ${r.d == null ? r.why : `${r.d.toFixed(2)} m from it (within ${r.within}${r.keep ? `, not nearer than ${r.keep}` : ''}${r.on ? `, standing ${r.dz.toFixed(2)} m off the raised floor it is on` : ''})${r.ok ? '' : `: ${r.why}`}`}`);
    }
    if (!near.length) console.log('     (nothing named to walk up to)');
    await p.evaluate(k => { const g = window.__game, pl = g.player; Object.assign(pl, { x: k.x, y: k.y, z: k.z, h: k.h, speed: 0 }); g.cam.yaw = k.yaw; g.advance(0.2); }, keep);
  }

  // the flights of steps a city names for checking (game.json surfaces with check: true, a footbridge's): from
  // a metre past the foot, climb on foot to the top, and arrive within 0.35 m of the top's height, never
  // having dropped below the foot or risen above the top
  const climbs = await p.evaluate(() => {
    const g = window.__game, pl = g.player, out = [];
    const S = (g.G.surfaces || []).filter(s => s.check && s.type === 'strip');
    if (!S.length) return out;
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw };
    for (const s of S) {
      const [ox, oy] = s.origin, [ax, ay] = s.axis, P = s.profile, uf = P[P.length - 1][0], ut = P[0][0];
      const zf = P[P.length - 1][1], zt = P[0][1];
      const x0 = ox + ax * (uf + 1.0), y0 = oy + ay * (uf + 1.0), tx = ox + ax * (ut + 0.6), ty = oy + ay * (ut + 0.6);
      const f = g.nav.floorAt(x0, y0, zf + 0.5);
      const r = { name: s.name, from: zf, to: zt };
      if (!f) { out.push(r); continue; }
      Object.assign(pl, { x: x0, y: y0, z: f.z, ground: true, vz: 0, speed: 0 });
      let low = f.z, high = f.z;
      for (let i = 0; i < 400 && Math.hypot(tx - pl.x, ty - pl.y) > 0.4; i++) {
        pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
        g.advance(0.05, ['KeyW']);
        low = Math.min(low, pl.z); high = Math.max(high, pl.z);
      }
      Object.assign(r, { z: pl.z, d: Math.hypot(tx - pl.x, ty - pl.y), low, high, start: f.z, mode: pl.mode });
      out.push(r);
    }
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return out;
  });
  for (const c of climbs) {
    if (c.z == null) { check(false, `climbs ${c.name}: no floor at its foot`); continue; }
    check(c.mode === 'foot' && c.d < 1.0 && Math.abs(c.z - c.to) < 0.35 && c.low > Math.min(c.start, c.from) - 0.3 && c.high < c.to + 0.35,
      `climbs ${c.name}: from ${c.start.toFixed(2)} m to ${c.z.toFixed(2)} m (the top is ${c.to.toFixed(2)} m), ${c.d.toFixed(1)} m from it`);
  }

  // the longest bridge over the water (pipeline/bridges.py, issue 122): walk across its deck from the bank
  // beyond one end to the bank beyond the other, and keep to the deck's height all the way over the water
  const cross = await p.evaluate(() => {
    const g = window.__game, pl = g.player;
    const S = (g.G.surfaces || []).filter(s => s.mesh === 'bridges_wb_deck' && s.type === 'strip');
    if (!S.length) return null;
    const s = S.reduce((a, b) => (b.profile[b.profile.length - 1][0] - b.profile[0][0] > a.profile[a.profile.length - 1][0] - a.profile[0][0] ? b : a));
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw };
    const [ox, oy] = s.origin, [ax, ay] = s.axis, P = s.profile, u0 = P[0][0] + 1.5, u1 = P[P.length - 1][0] - 1.5;
    const zAt = u => { for (let i = 1; i < P.length; i++) if (u <= P[i][0]) return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (u - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[P.length - 1][1]; };
    const f = g.nav.floorAt(ox + ax * u0, oy + ay * u0, zAt(u0) + 0.5);
    const r = { name: s.name, len: u1 - u0 };
    if (!f) return r;
    Object.assign(pl, { x: ox + ax * u0, y: oy + ay * u0, z: f.z, ground: true, vz: 0, speed: 0 });
    let worst = 0, over = 0;
    const tx = ox + ax * u1, ty = oy + ay * u1;
    // (room for a walker or a fine collision tile laid late under load to hold you up on the far bank)
    for (let i = 0; i < 3000 && Math.hypot(tx - pl.x, ty - pl.y) > 0.6; i++) {
      pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
      g.advance(0.05, ['KeyW']);
      const u = (pl.x - ox) * ax + (pl.y - oy) * ay;
      if (g.nav.isWater(pl.x, pl.y)) { over++; worst = Math.max(worst, Math.abs(pl.z - zAt(u))); }
    }
    Object.assign(r, { d: Math.hypot(tx - pl.x, ty - pl.y), worst, over, mode: pl.mode });
    Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return r;
  });
  if (cross) check(cross.d != null && cross.mode === 'foot' && cross.d < 1.5 && cross.worst < 0.4,
    `walks across ${cross.name} (${cross.len.toFixed(0)} m): ${cross.d == null ? 'no floor at its end' : `${cross.d.toFixed(1)} m from the far end, ${cross.over} steps over the water at most ${cross.worst.toFixed(2)} m off the deck, ${cross.mode}`}`);

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

  // a landmark you go up (an observation deck with its own lift): travel from the map puts you on its deck, high
  // over the street and facing out, not on the street looking up at it
  const decks = await p.evaluate(() => {
    const g = window.__game, out = [];
    for (const lm of g.landmarks.filter(l => g.deckOf(l))) {
      const at = g.deckStand(g.deckOf(lm)) || g.deckOf(lm)[0], ok = g.travelTo(lm);
      for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
      g.advance(0.5);
      const pl = g.player;
      out.push({ name: lm.name, ok, mode: pl.mode, d: Math.hypot(at[0] - pl.x, at[1] - pl.y), up: pl.z - Math.max(0, g.nav.terrain(pl.x, pl.y)), dz: Math.abs(pl.z - at[2]), walk: g.nav.walk(pl.x, pl.y, pl.z).ok });
    }
    return out;
  });
  for (const h of decks) check(h.ok && h.mode === 'foot' && h.walk && h.d < 45 && h.dz < 6 && h.up > 60, `travels to ${h.name}'s deck (${h.mode}, ${h.d.toFixed(0)} m from it, ${h.up.toFixed(0)} m over the street, ${h.walk ? 'on' : 'off'} walkable ground)`);

  // the lifts (game.json "lifts": Queenstown's glass lift from the luge track to the Skyline deck, the Skytree's,
  // Shibuya Sky's): from each stop to the next and back, standing at its door, the lift is offered, the ride
  // ends on the floor at the next stop's level, and a walker can stand there
  const liftRides = await p.evaluate(() => {
    const g = window.__game, pl = g.player, out = [];
    for (const L of g.lifts || []) for (let i = 0; i < L.stops.length; i++) {
      const j = (i + 1) % L.stops.length, a = L.stops[i].at, b = L.stops[j].at;
      [pl.x, pl.y, pl.z] = a; pl.mode = 'foot'; g.advance(0.3);
      const act = g.currentAction && g.currentAction(), offered = !!(act && /lift/i.test(act.text || ''));
      g.rideLift(L, i, j);
      // a lift ridden in its car (lifts[].car, Queenstown's): through the ride the player stands in the car's
      // middle on its floor, and the car ends at the far stop's floor with that stop's doors shut again
      const C = L.car && g.liftCar && g.liftCar(L), ride = { frames: 0, off: 0, floorOff: 0 };
      for (let k = 0; k < 240 && (g.cine.active || pl.mode === 'lift'); k++) {
        g.advance(0.25);
        const R = g.liftRide && g.liftRide();
        if (C && R && R.phase === 'ride') {
          const floor = (L.stops[L.car.drawn_at].floor ?? L.stops[L.car.drawn_at].at[2]) + C.dz;
          ride.frames++; ride.off = Math.max(ride.off, Math.hypot(pl.x - L.car.centre[0], pl.y - L.car.centre[1])); ride.floorOff = Math.max(ride.floorOff, Math.abs(pl.z - floor));
        }
      }
      g.advance(0.5);
      const o = { name: L.name, from: L.stops[i].name, to: L.stops[j].name, offered, dz: Math.abs(pl.z - b[2]), d: Math.hypot(pl.x - b[0], pl.y - b[1]), walk: g.nav.walk(pl.x, pl.y, pl.z).ok, floor: pl.floor, mode: pl.mode };
      if (C) Object.assign(o, { car: true, rideFrames: ride.frames, off: ride.off, floorOff: ride.floorOff,
        carAt: Math.abs((L.stops[L.car.drawn_at].floor ?? L.stops[L.car.drawn_at].at[2]) + C.dz - (L.stops[j].floor ?? b[2])), shut: C.doors.every(d => d.k < 0.01) });
      out.push(o);
    }
    g.spawn(); g.advance(0.5);
    return out;
  });
  for (const r of liftRides) check(r.offered && r.dz < 0.6 && r.d < 3 && r.walk, `the ${r.name} from ${r.from} to ${r.to} (offered at its door: ${r.offered}; ends ${r.d.toFixed(1)} m from the stop, ${r.dz.toFixed(2)} m off its level, on ${r.floor}${r.walk ? '' : ', not walkable'})`);
  for (const r of liftRides.filter(q => q.car)) check(r.rideFrames > 4 && r.off < 0.6 && r.floorOff < 0.1 && r.carAt < 0.05 && r.shut && r.mode === 'foot', `the ${r.name}'s car rides from ${r.from} to ${r.to} with you in it (${r.rideFrames} frames under way, at most ${r.off.toFixed(2)} m off its middle and ${r.floorOff.toFixed(2)} m off its floor; the car ${r.carAt.toFixed(2)} m from the far floor, doors ${r.shut ? 'shut' : 'open'}, ${r.mode})`);

  // the travel points a city names for checking (travel[].check: a new place to go): each hop lands you on
  // your feet, on ground you can walk, near it
  const hops = await p.evaluate(() => {
    const g = window.__game, out = [];
    for (const t of (g.G.travel || []).filter(t => t.check)) {
      const ok = g.travelTo({ kind: 'place', id: t.id, name: t.name, at: t.at });
      for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
      g.advance(0.5);
      const pl = g.player;
      out.push({ name: t.name, ok, mode: pl.mode, d: Math.hypot(t.at[0] - pl.x, t.at[1] - pl.y), walk: g.nav.walk(pl.x, pl.y, pl.z).ok });
    }
    return out;
  });
  // the quests a city names for checking (quests[].check: a new walk): each place a step sends you to has
  // ground you can stand on within its radius, and each NPC a step names is there
  const goals = await p.evaluate(() => {
    const g = window.__game, out = [];
    for (const q of (g.G.quests || []).filter(q => q.check)) for (const s of q.steps || []) {
      if (s.type === 'visit' && s.at) {
        let n = 0;
        for (let a = 0; a < 24; a++) for (const d of [0, 0.4, 0.7, 0.95]) {
          const x = s.at[0] + Math.cos(a * Math.PI / 12) * d * s.radius, y = s.at[1] + Math.sin(a * Math.PI / 12) * d * s.radius, gz = g.nav.terrain(x, y);
          const w = g.nav.walk(x, y, s.at.length > 2 ? s.at[2] : gz);
          if (w.ok) n++;
        }
        out.push({ quest: q.title, text: s.text, ok: n > 0, why: `${n} of 97 points round it walkable` });
      } else if (s.type === 'talk') out.push({ quest: q.title, text: s.text, ok: g.npcs.some(n => n.id === s.npc), why: `NPC ${s.npc}` });
      else if (s.type === 'surface') out.push({ quest: q.title, text: s.text, ok: g.nav.strips.some(t => t.name === s.surface), why: `surface ${s.surface}` });
    }
    return out;
  });
  for (const o of goals) check(o.ok, `${o.quest}: ${o.text} (${o.why})`);
  for (const h of hops) check(h.ok && h.mode === 'foot' && h.walk && h.d < 80, `travels to ${h.name} (${h.mode}, ${h.d.toFixed(0)} m from it, ${h.walk ? 'on' : 'off'} walkable ground)`);

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

  // after dark every NPC waits in light and in sight (#92; tools/npc_night.js): the street lights' light
  // where they stand, and walkers round them who can see them past the walls
  {
    const rs = await p.evaluate(npcNight.survey), bad = rs.map(r => [r, npcNight.verdict(r)]).filter(([, w]) => w.length);
    const dim = rs.filter(r => r.light != null).sort((a, b) => a.light - b.light)[0];
    check(!bad.length, `every NPC stands in light and in sight at night (${rs.length} NPCs${dim ? `; the dimmest, ${dim.name}, at ${dim.light.toFixed(2)}` : ''})${bad.length ? ': ' + bad.map(([r, w]) => `${r.name} at ${r.at} ${w.join(', ')}`).join('; ') : ''}`);
  }

  // the area caption (places.js): up briefly when you walk into an area, gone within 3.5 s, never over a
  // conversation, and not brought back by walking along an area's edge
  const cap = await p.evaluate(() => {
    const g = window.__game, P = g.places, areas = (g.G.areas || []).slice().sort((a, b) => b.radius - a.radius);
    if (!P || areas.length < 2) return { none: true };
    const vis = () => { const el = document.querySelector('.g-ekimei'); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; };
    const at = (a, f = 0) => { g.spawn([a.at[0] + a.radius * f, a.at[1]]); g.advance(0.1); };
    const out = { areas: areas.length };
    P.forget();
    // walk into the first: it shows, then it is gone within 3.5 s
    const [a, b] = areas;
    at(a, 3); g.advance(1); // from outside it
    at(a);
    let t = 0; while (!vis() && t < 3) { g.advance(0.1); t += 0.1; }
    out.shownAfter = vis() ? t : null; out.name = P.sign().area;
    t = 0; while (vis() && t < 6) { g.advance(0.1); t += 0.1; }
    out.upFor = t;
    // walk into the second with a conversation open: nothing while it is open, the caption after it closes
    const n = g.npcs[0];
    g.dlg.show(n || { name: 'Test' }, ['A line.', 'Another line.']);
    at(b);
    let over = false;
    for (t = 0; t < 4; t += 0.1) { g.advance(0.1); if (vis()) over = true; }
    out.overDialogue = over;
    for (let i = 0; i < 10 && g.dlg.open; i++) { g.dlg.next(); g.dlg.next(); }
    for (t = 0; t < 3 && !vis(); t += 0.1) g.advance(0.1);
    out.afterDialogue = vis() ? t : null;
    for (t = 0; t < 4; t += 0.1) g.advance(0.1);
    // along the edge of the first, in and out across its radius and a little way out and back: it doesn't come back
    at(a, 0.97); g.advance(5);
    let again = 0;
    for (let i = 0; i < 12; i++) { at(a, [0.97, 1.06, 0.97, 1.5][i % 4]); for (let k = 0; k < 5; k++) { g.advance(0.1); if (vis() && P.sign().name === a.name) again++; } }
    out.edge = again;
    return out;
  });
  if (cap.none) check(true, 'no areas to caption');
  else {
    check(cap.shownAfter != null && cap.upFor <= 3.5, `the area caption for ${cap.name} shows (after ${(cap.shownAfter ?? -1).toFixed(1)} s) and is gone within 3.5 s (${cap.upFor.toFixed(1)} s)`);
    check(!cap.overDialogue && cap.afterDialogue != null, `the area caption waits for a conversation to end (${cap.overDialogue ? 'shown over it' : cap.afterDialogue == null ? 'never shown after' : `shown ${cap.afterDialogue.toFixed(1)} s after`})`);
    check(cap.edge === 0, `walking along an area's edge doesn't bring its caption back (${cap.edge} frames shown)`);
  }

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
  check(route.ready && !route.none && route.drawn && route.blocked < 1.5, route.none ? 'no NPC a walker can reach' : `the gold route to ${route.to} on foot (${(+route.len || 0).toFixed(0)} m; at most ${(+route.blocked || 0).toFixed(1)} m at a time where a walker can't stand)`);
  await shot('route');

  // the route line's setting (menu: On / Only when I ask / Off, remembered): off hides the line in the
  // world but keeps the route for the minimap; L shows it for a few seconds; a conversation hides it
  if (route.drawn) {
    const rl = await p.evaluate(async () => {
      const g = window.__game, R = g.route, out = {};
      const seen = () => g.gold.mesh.visible;
      const menu = document.getElementById('g-menu');
      document.querySelector('#gm-route button[data-r="off"]').click(); g.advance(0.2);
      out.offHidden = !seen(); out.offMinimap = !!g.guide().pts; out.saved = (() => { try { return localStorage.getItem('oe-route-line'); } catch (e) { return 'blocked'; } })();
      out.button = !document.getElementById('gq-route').hidden;
      out.tappable = (() => { const r = document.getElementById('gq-route').getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(e && e.closest('#gq-route')); })();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL' }));
      g.advance(0.2); out.peekShown = seen();
      g.advance(R.PEEK + 0.5); out.peekGone = !seen();
      R.set('ask'); g.advance(0.2); out.askHidden = !seen();
      document.getElementById('gq-route').click(); g.advance(0.2); out.askShown = seen();
      R.set('on'); g.advance(0.2); out.onShown = seen();
      menu.hidden = false; g.advance(0.2); out.menuHidden = !seen(); menu.hidden = true; g.advance(0.2); out.back = seen();
      return out;
    });
    check(rl.offHidden && rl.offMinimap && rl.saved === 'off' && rl.button && rl.tappable, `route line Off: hidden in the world, kept on the minimap, remembered, Show route offered (${JSON.stringify(rl)})`);
    check(rl.peekShown && rl.peekGone, 'route line Off: L shows it for a few seconds, then it goes');
    check(rl.askHidden && rl.askShown, 'route line Only when I ask: hidden until Show route is tapped');
    check(rl.onShown && rl.menuHidden && rl.back, 'route line On: shown, hidden while the menu is open, and back after');
  }

  // a city drawn as a subway map (Tokyo): B, the Districts button or the menu opens the map full screen
  // (metro.js) with the game held still under it, your station marked, the others offering to travel there;
  // Esc closes it onto the game. (Travelling itself loads another map: the title check goes in from it.)
  const mt = await p.evaluate(() => {
    const btn = document.getElementById('g-metro-btn');
    if (!btn || btn.hidden) return { none: true };
    const out = {}, key = (k, code) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true }));
    // (no advance(): the world's clock stays where it was, so the steps after run as they would without this one)
    key('b', 'KeyB'); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
    const el = document.querySelector('.ts-mfull.solo');
    out.open = !!el && OEMetro.isOpen();
    out.here = !!(el && el.querySelector('.mt-you')) && !!(el && el.querySelector('.mt-pick [data-close]'));
    const other = el && [...el.querySelectorAll('.mt-chip')].find(b => !b.querySelector('i'));
    if (other) other.click();
    const prim = el && el.querySelector('.mt-pick .primary');
    out.travel = !!prim && /Travel here/.test(prim.textContent) && prim.dataset.map === other.dataset.mapid;
    key('Escape', 'Escape');
    out.closed = !document.querySelector('.ts-mfull') && !OEMetro.isOpen() && document.getElementById('g-menu').hidden;
    btn.click(); out.byButton = OEMetro.isOpen(); OEMetro.close();
    document.getElementById('g-menu').hidden = false;
    const mb = document.getElementById('gm-metro'); if (mb) mb.click();
    out.byMenu = OEMetro.isOpen() && document.getElementById('g-menu').hidden; OEMetro.close();
    return out;
  });
  if (!mt.none) check(mt.open && mt.here && mt.travel && mt.closed && mt.byButton && mt.byMenu, `the subway map from the game: B, the Districts button and the menu open it, you are marked, another district offers to travel, Esc closes it (${JSON.stringify(mt)})`);

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
  check(heli.none || (heli.open > 0.9 && heli.shut === 0), heli.none ? 'no helicopter' : `climbs in through the door (open ${(+heli.open || 0).toFixed(2)}, then shut)`);
  check(heli.none || (heli.mode === 'heli' && heli.climbed > 10), heli.none ? 'no helicopter' : `flies the helicopter (climbed ${(+heli.climbed || 0).toFixed(1)} m)`);
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
  check(out.none || (out.mode === 'foot' && out.door === 0 && out.near < 6), out.none ? 'no helicopter' : `lands and climbs out (${out.mode}, ${(+out.near || 0).toFixed(1)} m from it)`);

  // the ferries run their routes
  const ferry = await p.evaluate(() => {
    const g = window.__game, V = (g.fer && g.fer.vessels) || [];
    if (!V.length) return { none: true };
    // (a single water bus can be waiting out its dwell at a terminal when the window opens: up to two minutes)
    const a = V.map(v => [v.x, v.y]), far = () => Math.max(...V.map((v, i) => Math.hypot(v.x - a[i][0], v.y - a[i][1])));
    let t = 0;
    do { g.advance(10); t += 10; } while (t < 120 && (t < 40 || far() <= 20));
    return { n: V.length, moved: far(), t };
  });
  check(ferry.none || ferry.moved > 20, ferry.none ? 'no ferries' : `${ferry.n} ferries run (the farthest moved ${ferry.moved.toFixed(0)} m in ${ferry.t} s)`);
  await shot('ferry');

  // a crossing to a landing past the frame (pipeline/outposts.py: Queenstown's Earnslaw to Walter Peak, 12.5 km
  // over Lake Wakatipu): aboard at the wharf in the frame, skipped (F) once she is under way, alongside the far
  // wharf within a minute or so, ashore on its deck, and on foot from there to a building of the landing
  const far = await p.evaluate(() => {
    const g = window.__game, pl = g.player, W = id => g.G.wharves.find(w => w.id === id);
    const to = (g.G.wharves || []).find(w => w.outpost);
    if (!to) return { none: true };
    const v = g.fer.vessels.find(q => q.stops.includes(to.id));
    if (!v) return { none: true, why: 'no vessel calls there' };
    const from = W(v.stops.find(id => id !== to.id));
    let t = 0;
    while (!(v.phase === 'dwell' && g.fer.stopOf(v) === from.id) && t < 8000) { g.advance(5); t += 5; }
    [pl.x, pl.y] = from.landing; pl.z = g.nav.terrain(pl.x, pl.y); pl.mode = 'foot'; g.advance(0.2);
    g.board(v, from);
    for (let i = 0; i < 400 && v.phase === 'dwell'; i++) g.advance(0.5);
    return { to: to.id, name: to.name, from: from.name, mode: pl.mode, sailing: v.phase === 'sail' };
  });
  if (far.none) check(!far.why, far.why || 'no landing past the frame');
  else {
    await p.keyboard.press('KeyF');
    const fr = await p.evaluate(to => {
      const g = window.__game, pl = g.player, v = pl.vehicle, w = g.G.wharves.find(q => q.id === to), o = g.G.outposts.find(q => q.id === w.outpost);
      let real = 0;
      while (v && !(v.phase === 'dwell' && g.fer.stopOf(v) === to) && real < 300) { g.advance(0.5); real += 0.5; }
      const r = { real, docked: !!v && g.fer.stopOf(v) === to };
      if (!r.docked) return r;
      g.alight(); g.advance(0.5);
      Object.assign(r, { mode: pl.mode, d: Math.hypot(pl.x - w.terminal[0], pl.y - w.terminal[1]), walk: g.nav.walk(pl.x, pl.y, pl.z).ok });
      // on foot to the landing's largest building
      const area = q => { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], c = q[(i + 1) % q.length]; s += a[0] * c[1] - c[0] * a[1]; } return Math.abs(s / 2); };
      const big = (o.buildings || []).slice().sort((a, c) => area(c.ring) - area(a.ring))[0];
      if (big) {
        const cx = big.ring.reduce((s, q) => s + q[0], 0) / big.ring.length, cy = big.ring.reduce((s, q) => s + q[1], 0) / big.ring.length;
        const way = g.ways.walk({ x: pl.x, y: pl.y, z: pl.z }, { x: cx, y: cy });
        r.to = big.name || 'a building'; r.way = way ? way.len : null;
      }
      r.drawn = !!(g.Wd && g.Wd.outposts && g.Wd.outposts.children.length);
      return r;
    }, far.to);
    check(fr.docked && fr.real <= 120, `the ${far.from} to ${far.name} crossing, past the frame, skipped (${fr.real.toFixed(0)} s${fr.docked ? '' : ', not there'})`);
    if (fr.docked) {
      check(fr.mode === 'foot' && fr.walk && fr.d < 25, `ashore at ${far.name} (${fr.mode}, ${fr.d.toFixed(1)} m from its terminal, on ${fr.walk ? 'walkable' : 'no'} ground)`);
      check(fr.drawn && fr.way != null && fr.way < 600, `${far.name} is drawn, and a walk from the wharf reaches ${fr.to} (${fr.way == null ? 'none' : `${fr.way.toFixed(0)} m`})`);
    }
    await shot('landing');
    await p.evaluate(() => { const g = window.__game; g.spawn(); g.advance(0.5); });
  }

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
  tight(await swing('car'), 'at the wheel');

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
    { const P = o.drv.path, e = {}, cs = c.D.st; if (P && P.at) P.at(P.len, e); r.log.push(`you at ${g.player.x.toFixed(0)}, ${g.player.y.toFixed(0)}; your car at ${cs.x.toFixed(0)}, ${cs.y.toFixed(0)} (${Math.hypot(cs.x - g.player.x, cs.y - g.player.y).toFixed(0)} m); the taxi at ${o.drv.st.x.toFixed(0)}, ${o.drv.st.y.toFixed(0)}, its way ${P ? P.len.toFixed(0) : '?'} m to ${e.x != null ? `${e.x.toFixed(0)}, ${e.y.toFixed(0)}` : '?'}`); }
    // (the head of the queue the taxi is in, when it waits for room beyond its junction: the cars on that exit)
    const roomOf = st => {
      let hd = st.block, k = 0;
      while (hd && hd.front && hd.front.line != null && (hd.why === 'car' || hd.why === 'held') && k < 30) { hd = hd.front; k++; }
      if (!hd || hd.line == null || hd.why !== 'room' || !hd.lineEx) return '';
      const m = hd.lineEx.m, A = g.cars, on = A.C.filter(c => c.line === m.line);
      const J = A.junctions, act = m.j.active.filter(q => (q.m & 15) === m.i).map(q => `car ${A.C.indexOf(q.c)} on ${q.c.line}${q.c.mv ? ` (its junction ${q.c.mv.j.id})` : ''}${q.c.mv0 ? ` (leaving ${q.c.mv0.j.id})` : ''} v ${(+q.c.v || 0).toFixed(1)}`);
      const a2 = J.after(hd.lineEx, 2 * hd.half + 3), e2 = hd.ex2 && hd.ex2.a === a2 ? hd.ex2.e : null;
      const beyond = a2 ? `; crossed with junction ${a2.j.id}${a2.j.scramble ? ' (a scramble)' : ''}${e2 ? ` out by piece ${e2.m.line}, light ${J.light(a2, e2)}${a2.j.sig ? ` (phase ${a2.j.ph} ${a2.j.st}, busy ${a2.j.busy || 0})` : ''}, reach ${J.reach(e2).toFixed(1)} m, on it: ${A.C.filter(c => c.line === e2.m.line).map(c => `car ${A.C.indexOf(c)} s ${c.s.toFixed(0)} dir ${c.dir} ${c.why} v ${c.v.toFixed(1)}`).join(', ') || 'none'}, in ${a2.j.id}: ${a2.j.active.map(q => `car ${A.C.indexOf(q.c)} ${q.k}->${q.m & 15} ${q.c.why} v ${(+q.c.v || 0).toFixed(1)}`).join('; ') || 'none'}` : ' (no way chosen)'}` : '; no junction crossed with it';
      return ` [head car ${A.C.indexOf(hd)}${beyond} waits for room on piece ${m.line} (${A.netL[m.line].len.toFixed(0)} m${A.netL[m.line].ow ? ', one-way' : ''}, reach ${J.reach(hd.lineEx).toFixed(1)} m, back ${m.back.toFixed(1)}, crossing to it in ${m.j.id}: ${act.join('; ') || 'none'}): ${on.map(c => `car ${A.C.indexOf(c)} s ${c.s.toFixed(0)} dir ${c.dir} ${c.why} v ${c.v.toFixed(1)}${c.mv ? ` in ${c.mv.j.id}` : ''}${c.front && c.front.line != null ? ` behind ${A.C.indexOf(c.front)}` : ''}`).join(', ') || 'none on it'}]`;
    };
    let t = 0;
    r.scrWait = 0; // (stood at a scramble's red through its walk, which no ride's priority cuts short: not counted against the half minute)
    for (; t < 150 && o.phase === 'coming'; t += 0.5) { g.advance(0.5); if (o.drv.st.v < 0.5 && o.drv.st.lineAt && o.drv.st.lineAt.j.scramble && /^the line/.test(o.drv.st.why || '')) r.scrWait += 0.5; if (t % 5 === 0) try { const st = o.drv.st, A = g.cars, near = A.C.filter(c => c.line >= 0 && Math.hypot(c.x - st.x, c.y - st.y) < 12).map(c => `${A.C.indexOf(c)}:${c.v.toFixed(1)}:${c.why}${c.youBy ? `(${c.youBy})` : ''}:${c.mv ? 'in' : ''}`).join(' '), inJ = /^the line/.test(st.why || '') && st.lineAt ? ` junction ${st.lineAt.j.id}: ${st.lineAt.j.active.map(o => `${A.C.includes(o.c) ? `car ${A.C.indexOf(o.c)}` : 'the taxi'} ${o.k}->${o.m & 15} ${o.c.why || ''}${o.c.youBy ? `(${o.c.youBy})` : ''} v ${(+o.c.v || 0).toFixed(1)} ${Math.hypot(o.c.x - st.x, o.c.y - st.y).toFixed(0)} m`).join(', ') || 'none in it'}` : ''; r.log.push(`${t}s s=${st.s.toFixed(0)}/${o.drv.path.len.toFixed(0)} v=${st.v.toFixed(1)} d=${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} pass=${st.pass.toFixed(1)} shift=${st.shift.toFixed(1)} ${st.why || ''}${/^the line/.test(st.why || '') ? ` (${st.junction || '?'}${st.junction === 'turn' && st.lineAt ? `: waiting before it ${st.lineAt.j.pend.filter(w => w.c !== st).map(w => `${A.C.includes(w.c) ? `car ${A.C.indexOf(w.c)}` : 'a vehicle'} arm ${w.k} ${w.c.why || ''} v ${(+w.c.v || 0).toFixed(1)} light ${g.junctions.light(st.lineAt.j.arms[w.k], w.m)}`).join(', ')}` : ''})` : ''} near[${near}]${inJ}${roomOf(st)}${o.turnNo ? ` (not turned: ${o.turnNo})` : ''}`); } catch (e) { r.log.push(`${t}s (the log line failed: ${e.message})`); } }
    r.hailT = t; r.yielded = o.yielded || 0; r.log.push(`(backed off for a car in the junction ${r.yielded} times, round a scramble's walk ${o.roundWalk || 0} times, turned round ${o.turned || 0} times)`);
    r.waiting = o.phase === 'waiting'; r.near = Math.hypot(o.drv.st.x - g.player.x, o.drv.st.y - g.player.y);
    r.behind = o.drv.st.end < o.drv.path.len - 1; // (it pulled in behind a car at the kerb: your car, parked there)
    // every place the driver will offer has a kerb (the nearest at the ground's height there, as the game
    // picks it) that a road from here reaches: never one on a piece of road cut off from the streets
    // (a drive mapped at Shibuya Hikarie's level), which used to put you out of the taxi
    { const gz = (x, y) => { const f = g.nav.floorAt(x, y, Math.max(0, g.nav.terrain(x, y)) + 1); return f ? f.z : null; }, st = o.drv.st, from = g.roads.place(st.x, st.y, 60, k, st.z);
      r.cutOff = !from ? ['(no road where the taxi is)'] : g.destinations(st.x, st.y).filter(d => {
        const to = g.roads.place(d.at[0], d.at[1], 300, k, gz(d.at[0], d.at[1])) || g.roads.place(d.at[0], d.at[1], 300, k);
        return !to || !(g.roads.route(from, to, 30000) || g.roads.route(from, Object.assign({}, to, { dir: -to.dir }), 30000));
      }).map(d => d.name); }
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    r.inTaxi = g.player.mode === 'ride';
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    r.choices = document.querySelectorAll('#gd-choices button').length;
    r.you = o.C.clearance(g.player.rig, g.KEEP === 'left' ? 'rear_left' : 'rear_right'); r.driver = o.C.clearance(o.driver, 'driver');
    g.dlg.choose(0);
    g.advance(1);
    r.dest = o.dest && o.dest.name;
    // (the way it has driven, a second at a time: a ride that turns round or finds another way starts its new
    // way from 0, so its s alone would read it as standing)
    let went = 0, px = o.drv.st.x, py = o.drv.st.y;
    const tick = () => { g.advance(1); const t = o.drv.st; went += Math.hypot(t.x - px, t.y - py); px = t.x; py = t.y; };
    for (let i = 0; i < 20; i++) tick();
    // (held at a scramble's red through its walk: a walk of its own that nothing cuts short, so at worst the other
    // road's turn, the walk, the all reds round them and the wait for the last walkers, some 70 s, more)
    for (r.walkWait = 0; went < 20 && r.walkWait < 70 && o.drv.st.lineAt && o.drv.st.lineAt.j.scramble; r.walkWait++) tick();
    // (and under way again after it, on the same way or a new one round a jam, whose line it hasn't come to yet:
    // a few seconds to be off, as it is)
    if (r.walkWait) for (let k = 0; went < 20 && k < 6 && o.drv.st.v > 0.5; k++) { tick(); r.walkWait++; }
    r.drove = went; r.turned = o.turned || 0;
    if (r.drove < 20) { // what holds it up: the nearest cars ahead of it, yours among them
      const t = o.drv.st, player = g.player, fx = Math.sin(t.h), fy = Math.cos(t.h), mc = g.myCar && g.myCar(), ahead = [];
      for (const c of g.cars.C.concat(mc ? [Object.assign({ mine: true }, mc.D.st)] : [])) {
        const dx = c.x - t.x, dy = c.y - t.y, a = dx * fx + dy * fy;
        if (a > 0 && a < 40 && Math.abs(-dx * fy + dy * fx) < 4) ahead.push(`${c.mine ? 'your car' : 'car'} ${a.toFixed(0)} m ahead, ${(-dx * fy + dy * fx).toFixed(1)} m across, v ${(c.v || c.speed || 0).toFixed(1)}${c.still ? ' still' : ''}${c.mine ? '' : ` (${c.why}${c.q ? ', queueing' : ''}${c.mv ? ', in a junction' : ''})`}`);
      }
      r.why = `v ${t.v.toFixed(1)}, at ${t.s.toFixed(0)} of ${t.P.len.toFixed(0)} m${t.done ? " (done)" : ""}, phase ${o.phase}, pass ${t.pass.toFixed(1)}, held ${(+t.held || 0).toFixed(0)} s, ${t.why}${t.junction ? ` (the junction: ${t.junction})` : ''}${t.block ? ` behind ${t.block === player ? 'you' : mc && t.block.x === mc.D.st.x ? 'your car' : t.block.line != null ? `a car on line ${t.block.line} (stuck ${(+t.block.stuck || 0).toFixed(0)} s, v ${(+t.block.v || 0).toFixed(1)})` : 'something'} at ${Math.hypot(t.block.x - t.x, t.block.y - t.y).toFixed(1)} m${t.block.still ? ', still' : ''}` : ''}; ${ahead.join('; ') || 'nothing ahead'}`;
      // (the head of the queue it is in: what holds that car, and its light)
      { let hd = t.block, k = 0; while (hd && hd.front && hd.front.line != null && (hd.why === 'car' || hd.why === 'held') && k < 30) { hd = hd.front; k++; }
        if (hd && hd.line != null) { const a = hd.lineArm; r.why += `; the queue's head ${k + 1} cars on: car ${g.cars.C.indexOf(hd)} ${hd.why} v ${(+hd.v || 0).toFixed(1)} still ${(+hd.still || 0).toFixed(0)} s on piece ${hd.line}${a ? `, ${(hd.toLine - hd.half).toFixed(1)} m from the line of junction ${a.j.id}${a.j.scramble ? ' (a scramble)' : ''} arm ${a.i}, light ${g.cars.junctions.light(a, hd.lineEx)}${a.j.sig ? `, phase ${a.j.ph} ${a.j.st} for ${a.j.t.toFixed(0)} s, arm phase ${a.phase}` : ''}; in it: ${a.j.active.map(q => `car ${g.cars.C.indexOf(q.c)}${q.c.model === 'Bus' ? ' (bus)' : ''} ${q.k}->${q.m & 15} ${q.c.why}${q.c.heldBy ? ' by ' + q.c.heldBy : ''} v ${(+q.c.v || 0).toFixed(1)} on ${q.c.line}${q.c.mv && q.c.mv.j !== a.j ? ` (its junction ${q.c.mv.j.id})` : ''}${q.c.front && q.c.front.line != null ? ` behind car ${g.cars.C.indexOf(q.c.front)} ${q.c.front.why}` : ''}`).join('; ') || 'none'}` : ''}${hd.mv ? `, in junction ${hd.mv.j.id}` : ''}`; } }
      // (and what is in the junction it waits at: each car's way, what holds it, and for how long it has stood)
      if (t.junction) { const JN = g.cars.junctions, near = JN.J.filter(j => Math.hypot(j.x - t.x, j.y - t.y) < 40 && j.active.length); r.why += near.map(j => `; junction ${j.id}${j.mid != null ? ' (a crossing)' : ''}: ` + j.active.map(o => `car ${g.cars.C.indexOf(o.c)} ${o.c.why}${o.c.heldBy ? ' by ' + o.c.heldBy : ''} v ${o.c.v.toFixed(1)} still ${(+o.c.still || 0).toFixed(0)} s${o.forced ? ' over its line' : ''}`).join(', ')).join(''); }
    }
    // held up on the way (as in a jam: held where it is), you get out in the road and put a hand up:
    // the taxi you got out of, still beside you, is the one that takes you, where you were going offered first
    if (o.phase === 'driving') {
      const b = r.back = {};
      o.hold = true; g.advance(0.5);
      g.leaveRide(); o.hold = true; g.advance(0.5); // (still held: the jam hasn't cleared)
      b.out = g.player.mode === 'foot';
      g.hail();
      b.same = g.ride() === o && o.phase === 'waiting';
      g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      b.first = ((document.querySelector('#gd-choices button') || {}).textContent || '').replace(/\s+/g, ' ').trim();
      g.dlg.choose(0);
      g.advance(1);
      b.on = g.player.mode === 'ride' && g.player.vehicle === o && o.phase === 'driving' && !o.hold;
      b.dest = o.dest && o.dest.name;
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
        if (u % 5 === 0 || (st.v < 0.5 && u % 1 === 0)) r.rideLog.push(`${u}s s=${st.s.toFixed(0)}/${st.end.toFixed(0)} v=${st.v.toFixed(1)} held=${(+st.held || 0).toFixed(0)} d=${Math.hypot(st.x - g.player.x, st.y - g.player.y).toFixed(0)} ${st.why || ''}${/^the line/.test(st.why || '') ? ` (${st.junction || '?'}${st.lineAt && st.lineAt.j.sig ? `, light ${st.lineAt.j.ph}${st.lineAt.j.st} ${st.lineAt.j.t.toFixed(1)} s, arm phase ${st.lineAt.phase}` : ''})` : ''} eta ${g.rideEta().toFixed(0)}${st.junction === 'cross' && st.lineAt ? ` (in the junction: ${st.lineAt.j.active.map(o => `${o.c === st ? 'the ride' : g.cars.C.includes(o.c) ? `car ${g.cars.C.indexOf(o.c)}` : 'another vehicle'} arm ${o.k} to ${o.m}${o.forced ? ' over its line' : ''} v ${(+o.c.v || 0).toFixed(1)} ${o.c.why || ''} on ${o.c.line}${o.c.mv && o.c.mv.j !== st.lineAt.j ? ' (its next junction elsewhere)' : ''}`).join('; ') || 'nobody'})` : ''}${st.block ? ` behind ${st.block.line != null ? `car ${g.cars.C.indexOf(st.block)} v ${(+st.block.v || 0).toFixed(1)} ${st.block.why || ''}${st.block.heldBy ? ` (held: ${st.block.heldBy})` : ''}` : st.block.walker ? 'a walker' : st.block.id ? st.block.id : `something at ${(+st.block.x || 0).toFixed(0)}, ${(+st.block.y || 0).toFixed(0)}`}` : ''}${st.xBlock && st.xBlock !== st.block ? ` across ${st.xBlock.line != null ? `car ${g.cars.C.indexOf(st.xBlock)}` : 'something'}` : ''}`);
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
    check(taxi.hailed && taxi.waiting && taxi.near < (taxi.behind ? 22 : 15), `hails a taxi: it pulls in beside you${taxi.hailed ? ` (${(+taxi.near || 0).toFixed(1)} m away${taxi.behind ? ', behind the car parked at the kerb' : ''})` : ''}`);
    check(taxi.hailed && taxi.hailT - (taxi.scrWait || 0) <= 30, `the taxi is there within half a minute (${taxi.hailT == null ? '–' : `${taxi.hailT.toFixed(1)} s${taxi.scrWait ? `, ${taxi.scrWait.toFixed(1)} s of it at a scramble's red` : ''}`})`);
    check(taxi.inTaxi && taxi.choices >= 2, `gets in the back, and the driver asks where to (${taxi.choices || 0} answers)`);
    check(taxi.you == null || taxi.you > 0, `in the back, your head is under the roof (${taxi.you == null ? 'not measured' : `${taxi.you.toFixed(2)} m`})`);
    check(taxi.driver == null || taxi.driver > 0, `the driver's head is under the roof (${taxi.driver == null ? 'not measured' : `${taxi.driver.toFixed(2)} m`})`);
    check(taxi.drove > 20, `drives off for ${taxi.dest || 'nowhere'} (${(+taxi.drove || 0).toFixed(0)} m in 20 s${taxi.walkWait ? ` and ${taxi.walkWait} s of a scramble's walk` : ''})${taxi.why ? `: ${taxi.why}` : ''}`);
    check(!taxi.cutOff || !taxi.cutOff.length, `every place the taxi driver offers has a kerb a road from the taxi reaches${taxi.cutOff && taxi.cutOff.length ? ` (not ${taxi.cutOff.join(', ')})` : ''}`);
    const bk = taxi.back;
    check(!bk || (bk.out && bk.same && bk.on && /where you were going/.test(bk.first)), `out on the way, a hand up: back into the same taxi, on to where you were going${bk ? ` (out ${!!bk.out}, the same taxi ${!!bk.same}, offered first "${bk.first || '–'}", on to ${bk.dest || '–'}: ${bk.on ? 'driving' : 'not driving'})` : ' (not driving: not tried)'}`);
    check(taxi.arrived && taxi.out, 'skips the trip to the kerb there, and you get out');
    check(taxi.ordered, `orders a ride on the phone${taxi.ordered ? '' : ` (${taxi.orderWhy})`}`);
    check(taxi.ordered && taxi.phoneMap, 'the phone shows the ride on its map, on the way');
    const rideOk = taxi.ordered && taxi.rideHere && taxi.rideT <= 30 && Math.abs(taxi.rideT - taxi.eta0) < 8; // (the traffic in your sight and its lights make it vary)
    check(rideOk, `the ride is there within half a minute, when the app said (${taxi.rideT == null ? '–' : `${taxi.rideT.toFixed(1)} s, said ${taxi.eta0.toFixed(0)} s`})`);
    if (!rideOk && taxi.rideLog) console.log(taxi.rideLog.join('\n'));
  }
  await shot('taxi');
  await lightsKept('after the car and the taxi');
  // and by night and by day (the sun below the horizon stays a light, dark)
  const clockWas = await p.evaluate(() => { const c = window.__game.clock; return [c.y, c.m, c.d, c.min]; });
  for (const [hh, when] of [[3, 'at 3 am'], [12, 'at noon']]) {
    await p.evaluate(h => { const g = window.__game, c = g.clock; g.setClock(c.y, c.m, c.d, h * 60); g.advance(0.5); }, hh);
    await lightsKept(when);
  }
  await p.evaluate(c => { window.__game.setClock(...c); window.__game.advance(0.25); }, clockWas); // (back to the run's own hour)

  // a quick start: the helicopter waits on a pad near where you start and a taxi can reach you
  // from a kerb close by; and walk towards another pad while the helicopter stands shut down far
  // away, and it is waiting there when you arrive
  const quick = await p.evaluate(() => {
    const g = window.__game, pl = g.player;
    g.spawn();
    g.advance(0.5);
    const k = g.roads.place(pl.x, pl.y, 400, 1, pl.z), r = { kerb: k ? k.d : null, heli: g.heli ? Math.hypot(g.heli.st.x - pl.x, g.heli.st.y - pl.y) : null };
    // a start up on a deck reached by a lift (Queenstown's Skyline deck, 15 m over the luge track): no road
    // comes up to the deck's level, so a taxi meets you where the lift comes down; the kerb is measured
    // from its foot, the lift's ride added to the way there
    const L = (g.lifts || []).find(l => l.stops.length > 1 && l.stops.slice(1).some(s => Math.hypot(s.at[0] - pl.x, s.at[1] - pl.y) < 30 && Math.abs(s.at[2] - pl.z) < 3));
    if (L && (r.kerb == null || r.kerb >= 150)) {
      const f = L.stops[0].at, kf = g.roads.place(f[0], f[1], 400, 1, f[2]);
      r.lift = L.name; r.walk = Math.hypot(f[0] - pl.x, f[1] - pl.y); r.kerb = kf ? kf.d : null;
    }
    return r;
  });
  check(quick.heli == null || quick.heli < 450, `the helicopter waits near the start (${quick.heli == null ? 'none' : `${quick.heli.toFixed(0)} m`})`);
  check(quick.kerb != null && quick.kerb < 150, `a kerb for a taxi near the start (${quick.kerb == null ? 'none' : `${quick.kerb.toFixed(0)} m`}${quick.lift ? ` from the foot of the ${quick.lift}, ${quick.walk.toFixed(0)} m from the start` : ''})`);
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
    : `travels from the map in your car to ${drive.name} (${drive.mode}, ${drive.mode === 'car' ? '' : `${(+drive.me || 0).toFixed(0)} m from it, `}the car parked ${(+drive.d || 0).toFixed(0)} m from it)`);
  await shot('drive');

  // photo mode's depth of field (its aperture), and none of it back in play (atmosphere.js camFx); a city
  // with a busy crossing's sound (game.look.sound) finds the crossing's signals
  const fx = await p.evaluate(async () => {
    const g = window.__game, A = g.atmos, frame = () => new Promise(r => requestAnimationFrame(() => r()));
    const snd = g.sound ? g.sound() : null;
    if (!A || !A.composer || !A.camFx) return { none: true, snd };
    if (g.player.mode === 'car') { g.exitCar(); g.advance(1); }
    g.photoMode(true); g.photo.fstop = 1.4;
    for (let i = 0; i < 3; i++) await frame();
    const pass = A.composer.passes.find(q => q.uniforms && q.uniforms.uAperture);
    const on = !!(g.photo.on && pass && pass.enabled && pass.uniforms.uAperture.value > 0);
    g.photoMode(false);
    for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.1);
    for (let i = 0; i < 3; i++) await frame();
    return { on, off: !(pass && pass.enabled), snd };
  });
  check(fx.none || (fx.on && fx.off), fx.none ? 'no post stack for the depth of field' : `photo mode focuses with a depth of field (${fx.on}), and play has none (${fx.off})`);
  if (fx.snd) check(fx.snd.junction != null, `the crossing's sound listens to its signals (junction ${fx.snd.junction})`);
  // the city's constant beds are off in play (too loud): over a second of frames, the murmur and the
  // screens' music are asked for silence only (the announcements and the walk calls still play)
  const hush = await p.evaluate(async () => {
    const g = window.__game, A = window.OEAudio, frame = () => new Promise(r => requestAnimationFrame(() => r()));
    if (!A.on) A.start();
    const loud = { murmur: 0, screens: 0 }, keep = {};
    for (const k of Object.keys(loud)) { keep[k] = A[k]; A[k] = (v, ...a) => { if (v > 0) loud[k]++; return keep[k](v, ...a); }; }
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) await frame();
    Object.assign(A, keep);
    return { loud, noise: g.cityNoise() };
  });
  check(!hush.noise && !hush.loud.murmur && !hush.loud.screens, `the city's constant beds are off in play (murmur ${hush.loud.murmur}, music ${hush.loud.screens})`);

  // the junctions: the signals change, and the traffic stops for them (junctions.js; tools/traffic_check.js measures the flow)
  const lights = await p.evaluate(() => {
    const g = window.__game, A = g.cars, JN = A.junctions;
    if (!JN) return { none: true };
    const sig = JN.J.filter(j => j.sig && j.mid == null).sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y));
    if (!sig.length) { // no junction with signals (Higashiyama's lanes): the traffic still has to move
      g.advance(20);
      return { junctions: JN.J.length, signals: 0, moving: A.C.filter(c => c.line >= 0 && c.v > 1).length };
    }
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
  // a crossing with signals between junctions: a walker's call brings the walk, the traffic held at red, and the traffic's green back
  const mid = await p.evaluate(() => {
    const g = window.__game, A = g.cars, JN = A.junctions;
    const M = JN ? JN.J.filter(j => j.mid != null && j.sig).sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y)) : [];
    if (!M.length) return { none: true, zebras: JN ? JN.stats().zebras : 0 };
    const j = M[0], a = j.arms[0], s0 = A.stats(), seen = [];
    for (let t = 0; t < 60; t++) { JN.call(a); g.advance(1); const w = JN.walk(a), lt = JN.light(a); if (!seen.length || seen[seen.length - 1] !== lt + (w ? 'W' : '')) seen.push(lt + (w ? 'W' : '')); }
    for (let t = 0; t < 30; t++) { g.advance(1); const w = JN.walk(a), lt = JN.light(a); if (seen[seen.length - 1] !== lt + (w ? 'W' : '')) seen.push(lt + (w ? 'W' : '')); }
    const X = g.crowd.crossings, walkers = X ? [...X.byLine.values()].flat().filter(x => x.a.j.mid != null).length : 0;
    return { n: M.length, zebras: JN.stats().zebras, seen: seen.join(' '), red: A.stats().redRuns - s0.redRuns, walkers, log: (A.stats().redLog || []).slice(-3).join('; ') };
  });
  if (!mid.none) {
    check(/rW.* g/.test(mid.seen) && !/gW/.test(mid.seen), `a crossing with signals between junctions gives the walk on a call and the traffic its green after (${mid.seen}; ${mid.n} such crossings, ${mid.zebras} zebras)`);
    check(mid.walkers > 0 && !mid.red, `the crowd's footways cross there (${mid.walkers}) and no car runs its red (${mid.red}${mid.red ? ': ' + mid.log : ''})`);
  }
  // a ride's driver (cars.js chauffeur) at a crossing between junctions (#82): it stops short of the
  // line at the crossing's red and goes on its green; at a zebra it gives way while someone is on the
  // stripes and goes once they are clear. Driven on its own (the clock held, nothing else in the way)
  // down the crossing's road from 40 m back
  const rideMid = await p.evaluate(() => {
    const g = window.__game, JN = g.junctions, L = g.roadNet.L, out = [];
    if (!JN) return out;
    const near = j => Math.hypot(j.x - g.player.x, j.y - g.player.y);
    for (const sig of [true, false]) {
      const j = JN.J.filter(x => x.mid != null && !!x.sig === sig).sort((p, q) => near(p) - near(q))[0];
      if (!j) continue;
      const a = j.arms[0], dir = a.end ? 1 : -1, l = L[j.line];
      const s0 = Math.max(0.5, Math.min(l.len - 0.5, j.mid - dir * 40)), s1 = dir > 0 ? l.len - 0.5 : 0.5;
      const rt = g.roads.route({ line: j.line, s: s0, dir }, { line: j.line, s: s1, dir }, 500);
      if (!rt || !(rt.mids || []).some(m => m.X === j)) { out.push({ sig, none: true }); continue; }
      rt.end = false;
      let clear = false;
      const keep = { ph: j.ph, st: j.st, t: j.t };
      const lights = Object.assign(Object.create(JN), { onStripes: X => X === j && !clear });
      if (sig) { j.ph = 1; j.st = 'g'; j.t = 0; } // the walk: the traffic held at red
      const C = { half: 2.3, hw: 0.9, top: 1.5, wheelbase: 2.7 }, D = OECars.chauffeur(C, rt, { keep: g.KEEP === 'right' ? -1 : 1, from: 'lane', v: 10, lights, cruise: 12 });
      const at = rt.mids.find(m => m.X === j).at, line = at - a.back;
      for (let k = 0; k < 120; k++) D.update(0.1, [], false, true); // 12 s at the red, or at the stripes (after 15 s stopped at a zebra it edges on)
      const held = { front: line - D.st.s - C.half, v: D.st.v, why: D.st.junction };
      clear = true; if (sig) { j.ph = 0; j.st = 'g'; j.t = 0; }
      for (let k = 0; k < 150; k++) D.update(0.1, [], false, true);
      const went = D.st.s - at;
      Object.assign(j, keep);
      out.push({ sig, id: j.id, held, went });
    }
    return out;
  });
  for (const r of rideMid) {
    const kind = r.sig ? 'its red' : 'a zebra with someone on it';
    if (r.none) { check(false, `a ride can be routed over the nearest ${r.sig ? 'crossing with signals' : 'zebra'}`); continue; }
    check(r.held.front > -0.5 && r.held.front < 6 && r.held.v < 0.2, `a ride stops at a crossing between junctions at ${kind} (crossing ${r.id}: its front ${r.held.front.toFixed(1)} m short of the line, ${r.held.v.toFixed(1)} m/s, ${r.held.why})`);
    check(r.went > 5, `and goes on across once ${r.sig ? 'it turns green' : 'the stripes are clear'} (${r.went.toFixed(0)} m past it)`);
  }
  // lanes from OSM's counts (#82): the main road pieces they take down to one lane each way; over 40 s,
  // the cars in a second lane that are within 5 m of where it ends (they should have moved across
  // well before: actors.js looks ahead along the road, junctions.js laneRun)
  const lanes = await p.evaluate(() => {
    const g = window.__game, A = g.cars, JN = A.junctions, L = g.roadNet.L, TWO = { motorway: 1, trunk: 1, primary: 1 };
    const one = L.filter(l => (TWO[l.c] || (l.ow && l.c === 'secondary')) && JN.lanesOf(l) === 1).length;
    let inL1 = 0, atEnd = 0;
    for (let t = 0; t < 40; t++) {
      g.advance(1);
      for (const c of A.C) {
        if (c.line < 0 || c.ln !== 1 || c.mv) continue;
        inL1++;
        const l = L[c.line], end = c.dir > 0 ? 1 : 0, left = c.dir > 0 ? l.len - c.s : c.s;
        if (!JN.armAt(c.line, end) && left + JN.laneRun(c.line, end) < 5 + c.half) atEnd++;
      }
    }
    return { one, inL1, atEnd };
  });
  check(lanes.atEnd <= Math.max(2, 0.02 * lanes.inL1), `${lanes.one} main road pieces one lane each way by OSM's count; cars in a second lane within 5 m of its end: ${lanes.atEnd} of ${lanes.inL1} samples`);
  // turns banned and streets shut to cars at some hours (#82: junctions.js by the game's clock): at an
  // hour it is closed no car chooses that way and the rides' router keeps off the street; at an hour it
  // is open, cars take it again
  const timed = await p.evaluate(() => {
    const g = window.__game, JN = g.junctions, L = g.roadNet.L, st = JN.stats();
    const r = { bans: st.timedBans, shut: st.timedShut };
    let pick = null;
    for (const j of JN.J) { if (j.mid != null) continue; for (const a of j.arms) { if (!a.in) continue; const ex = JN.exits(a); const e = ex.length > 1 && ex.find(x => x.tw || L[x.m.line].tb); if (e) { pick = { a, e }; break; } } if (pick) break; }
    if (!pick) return r;
    const { a, e } = pick, when = [];
    for (let dow = 0; dow < 7; dow++) for (let min = 15; min < 1440; min += 30) when.push({ dow, min });
    const shutT = when.find(t => JN.closedNow(e, t)), openT = when.find(t => !JN.closedNow(e, t));
    if (!shutT || !openT) return Object.assign(r, { always: !!shutT });
    const c0 = Object.assign({}, g.clock);
    const at = t => { const dow0 = (new Date(Date.UTC(c0.y, c0.m - 1, c0.d)).getUTCDay() + 6) % 7; g.setClock(c0.y, c0.m, c0.d + (t.dow - dow0 + 7) % 7, t.min); };
    const tries = t => { at(t); let n = 0; for (let k = 0; k < 400; k++) if (JN.choose(a) === e) n++; return n; };
    r.whenShut = tries(shutT); r.whenOpen = tries(openT);
    // the router: a route from the arm's road to the street beyond the shut one, at the hour it is
    // shut, goes round it where there is another way (one that keeps off it when told to shun it)
    const la = L[a.line], from = { line: a.line, s: a.end ? Math.max(0.5, la.len - 20) : Math.min(la.len - 0.5, 20), dir: a.end ? 1 : -1 };
    const far = 1 - e.m.end, nx = !e.tw && g.roadNet.next(e.m.line, far, true);
    if (nx) {
      const ln = L[nx[0]], to = { line: nx[0], s: ln.len / 2, dir: nx[1] === 0 ? 1 : -1 };
      const via = rt => (!rt ? 'none' : rt.nodes.some(nd => nd.line === e.m.line) ? 'through' : 'round');
      at(openT); const alt = via(g.roads.route(from, to, 3000, undefined, new Set([e.m.line])));
      at(shutT); r.routed = via(g.roads.route(from, to, 3000)); r.alt = alt;
    }
    r.what = `${e.tw ? "a turn banned" : `the street (${L[e.m.line].c}) shut`} at ${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][shutT.dow]} ${Math.floor(shutT.min / 60)}:${String(shutT.min % 60).padStart(2, '0')}`;
    g.setClock(c0.y, c0.m, c0.d, c0.min);
    return r;
  });
  if (timed.whenShut != null) {
    check(timed.whenShut === 0 && timed.whenOpen > 0, `${timed.bans} turns banned and ${timed.shut} streets shut to cars at some hours: ${timed.what}, chosen ${timed.whenShut} times in 400 then, ${timed.whenOpen} at an hour it is open`);
    if (timed.alt === 'round') check(timed.routed === 'round', `and a ride's route goes round it then (${timed.routed})`);
  } else console.log(`     ${timed.bans || 0} turns banned and ${timed.shut || 0} streets shut at some hours${timed.always != null ? ' (the nearest closed all week or never)' : ''}`);
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
    check(!lights.arrows || lights.arrowHeads > 0, `${lights.arrows || 0} junctions with a turn arrow (${lights.arrowHeads || 0} arrow lanterns), ${lights.bans || 0} banned turns, ${lights.two || 0} cars in a main road's second lane`);
  }
  await shot('junction');

  // the scrambles: every way at once in a walk phase of their own, the diagonals too (tools/scramble_step.js)
  for (const r of await require('./scramble_step')(p)) { for (const [ok, what] of r.checks) check(ok, what); await shot(`scramble-${r.at.join('_')}`); }
  // the walk signals' calls for the blind (walkcalls.js): Japan's bird calls in the walk, the ticking elsewhere, none when muted (tools/walkcalls_step.js)
  { const r = await require('./walkcalls_step')(p); if (r.none) console.log(`(no walk signals' calls in ${r.country || 'this country'})`); else for (const [ok, what] of r.checks) check(ok, what); }

  // a ride behind a queue at a red light (#107): it waits its turn in its own lane, never swings out
  // round a car queueing there (c.q) to the head of the queue, and goes on when the queue moves;
  // and the traffic that comes up behind it queues behind it too, never round it
  await p.evaluate(src => { window.__findQueue = eval(`(${src})`); }, findQueue.toString());
  const queue = await p.evaluate(() => {
    const g = window.__game, st0 = window.__kerb, L = g.roadNet.L, C = g.cars.C;
    if (!st0 || !g.myCar || !g.myCar()) return { none: 'no kerb' };
    if (g.ride()) g.cancelRide();
    if (g.player.mode !== 'foot') g.exitCar();
    const k = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st0.x - Math.sin(st0.h) * 12 - Math.cos(st0.h) * 2.4 * k; g.player.y = st0.y - Math.cos(st0.h) * 12 + Math.sin(st0.h) * 2.4 * k; g.player.z = st0.z;
    g.advance(1);
    g.hail();
    const o = g.ride();
    if (!o) return { none: 'no taxi' };
    for (let t = 0; t < 60 && o.phase === 'coming'; t += 0.5) g.advance(0.5);
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    if (g.dlg.open) g.dlg.choose(0);
    if (g.player.mode !== 'ride') return { none: 'not in the taxi' };
    // a queue at a red light: its head stopped at the line, the cars behind it queueing (c.q), with
    // a straight run of road behind its tail for the taxi to come up it, and a road on from the junction
    const along = (c, h, a) => (c.x - h.x) * Math.sin(a) + (c.y - h.y) * Math.cos(a);
    const findQueue = skip => window.__findQueue(g, skip);
    const tried = new Set(), jams = [];
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const pick = findQueue(tried);
      if (!pick) break;
      tried.add(pick.h.line);
      // the taxi, on that road behind the queue (cars.js chauffeur, driven by the game's own ride step)
      o.drv.leave();
      o.drv = OECars.chauffeur(o.C, Object.assign({}, pick.rt, { end: false }), { keep: k, from: 'lane', v: 0, lights: g.junctions, now: g.t }); // (on through: not pulling in at the end of this short way)
      const st = o.drv.st, queued = C.filter(c => c.line === pick.h.line && c.dir === pick.h.dir && c.q);
      for (const c of queued) c.s0r = (c.s - pick.rt.from.s) * pick.h.dir; // (where each stood along the taxi's way, for a pass's report)
      r = { n: queued.length, shift: 0, passed: [], behind: false, overtook: [], gone: false, moved: null, follow: null, jams };
      const sHead = (pick.h.s - pick.rt.from.s) * pick.h.dir; // (the head of the queue, along the taxi's way)
      const arm = g.junctions.armAt(pick.h.line, pick.h.dir > 0 ? 1 : 0), seq = [], behind = new Set();
      for (let t = 0; t < 90 && !st.done; t += 0.25) { // (a red is 10 s at most, junctions.js RED: a queue standing longer is held by a jam beyond, and another is tried)
        g.advance(0.25);
        const lt = g.junctions.light(arm); if (!seq.length || seq[seq.length - 1][1] !== lt) seq.push([t, lt]); // (the light it waits at, as it changes)
        if (Math.abs(st.shift) > Math.max(0.2, r.shift)) r.round = (st.passed && st.passed.length ? st.passed : (st.rounded || {}).cars || []).map(c => `car ${C.indexOf(c)} (${c.whyRound || ''}; ${c.why}${c.stay ? ', parked' : ''}${c === g.myCar() ? ', yours' : ''}, v ${(+c.v || 0).toFixed(1)}${c.q ? ', queueing' : ''}, stood ${typeof c.still === 'number' ? c.still.toFixed(0) : c.still} s${c.stuck ? `, stuck ${c.stuck.toFixed(0)} s` : ''}${(() => { const ch = []; for (let x = c.front, k = 0; x && k < 6; x = x.front, k++) ch.push(`${C.indexOf(x) >= 0 ? C.indexOf(x) : 'you'} ${x.why || ''} v ${(+x.v || 0).toFixed(1)}${x.q ? ' q' : ''}`); return ch.length ? `; ahead of it ${ch.join(' < ')}` : ''; })()})`).join(', ') + (st.rounded ? ` (held ${st.rounded.held.toFixed(0)} s)` : '') || 'nothing';
        r.shift = Math.max(r.shift, Math.abs(st.shift));
        const a = st.h, bl = st.block;
        if (bl && bl.q && st.v < 0.5) { r.behind = true; r.ahead = bl; }
        // the queue moves: the car it waits behind is off (then it follows within a few seconds)
        if (r.ahead && r.moved == null && r.ahead.v > 1) r.moved = t;
        if (r.moved != null && r.follow == null && st.v > 0.5) { r.follow = t - r.moved; r.goneT = t; }
        // and it never stands with room ahead of it and no line to stop at (the queue moved on without it)
        r.openT = r.behind && st.v < 0.3 && st.gap > 7 && !/^the line/.test(st.why || '') ? (r.openT || 0) + 0.25 : 0;
        r.openMax = Math.max(r.openMax || 0, r.openT);
        // (passed: one queueing in its own lane, now behind it; not one in the other lane of a road with two each way,
        // nor one facing another way: the taxi through the junction and turned off, Shibuya's 809, the car is beside its way, not passed)
        for (const c of queued) if (c.q && c.line === pick.h.line && Math.cos(a - c.h) > 0.5 && along(c, st, a) < -(c.half + o.C.half) && Math.abs((c.x - st.x) * Math.cos(a) - (c.y - st.y) * Math.sin(a)) < c.hw + o.C.hw + 0.2 && !r.passed.includes(C.indexOf(c))) { r.passed.push(C.indexOf(c)); (r.passedHow || (r.passedHow = [])).push(`car ${C.indexOf(c)} at ${t} s: ${c.why} v ${c.v.toFixed(1)} dir ${c.dir} lane ${c.ln || 0} s ${c.s.toFixed(1)}${c.mv ? ` in ${c.mv.j.id}` : ''}, ${(-along(c, st, a)).toFixed(1)} m behind the taxi (its s ${st.s.toFixed(1)}, shift ${st.shift.toFixed(1)}, ${st.why || ''}; the car ${(c.toLine - c.half).toFixed(1)} m from its line${c.lineArm ? ` of ${c.lineArm.j.id}` : ''}, started ${(c.s0r ?? NaN).toFixed(1)} m along the taxi's way; the taxi ${(st.toLine - o.C.half).toFixed(1)} m from its next line${st.mv ? `, in ${st.mv.j.id}` : ''}, its heading off the car's by ${(Math.atan2(Math.sin(a - c.h), Math.cos(a - c.h)) * 57.3).toFixed(0)}°)`); }
        // the traffic behind it, in its lane, while it queues: none comes past it (on a road with two
        // lanes each way, one moving up in the other lane is not one going round it)
        const lat = c => Math.abs((c.x - st.x) * Math.cos(a) - (c.y - st.y) * Math.sin(a));
        if (st.q) for (const c of C) if (c.line === pick.h.line && c.dir === pick.h.dir) {
          const b = along(c, st, a), i = C.indexOf(c);
          if (b < 0 && b > -30 && lat(c) < c.hw + o.C.hw + 0.3) behind.add(i);
          else if (behind.has(i) && b > 0 && !c.ln && !r.overtook.includes(i)) r.overtook.push(i);
        } else behind.clear();
        if (r.follow != null && t - r.goneT > 4) break;
        if (st.s > sHead + 5) { r.gone = true; break; }
      }
      const bl = st.block;
      r.why = `${st.why || ''}, v ${st.v.toFixed(1)}, s ${st.s.toFixed(0)} of ${sHead.toFixed(0)} to the head, the light ${seq.map(([t, l]) => `${l} at ${t.toFixed(0)} s`).join(', ')} (junction ${arm.j.id}, arm phase ${arm.phase}, green ${JSON.stringify(arm.j.green)}; now phase ${arm.j.ph} ${arm.j.st} for ${arm.j.t.toFixed(0)} s, next ${arm.j.nxt}, called ${arm.j.call})${bl ? `; behind ${bl.line != null ? `car ${C.indexOf(bl)} (${bl.why}, v ${(+bl.v || 0).toFixed(1)}${bl.q ? ', queueing' : ''}, ${typeof bl.still === 'number' ? `still ${bl.still.toFixed(0)} s` : bl.still ? 'held still' : 'moving'})` : 'something'}` : ''}; the head: car ${C.indexOf(pick.h)} ${pick.h.why} v ${pick.h.v.toFixed(1)}`;
      delete r.ahead;
      if (r.follow != null || r.moved != null) break;
      jams.push(`line ${pick.h.line}: ${r.behind ? '' : 'the light changed before it caught up; '}${r.why}`); // (the queue never moved in 90 s: a jam in the junction or beyond it, not the taxi's doing; another queue)
    }
    if (!r) { g.skipRide(); g.advance(6); g.leaveRide(); return { none: 'no queue at a red light in 3 minutes' }; }
    g.skipRide(); g.advance(6); g.leaveRide(); g.advance(1);
    return r;
  });
  if (queue.none) check(true, `a ride at a red light: not tried (${queue.none})`);
  else {
    // (none of the tries caught up with its queue before the light changed: the waiting is not tried,
    // noted above; the lane is still checked for the way up to it)
    if (!queue.behind) console.log(`note a ride behind a queue at a red light: not tried, the light changed before it caught up with any (out of its lane by ${queue.shift.toFixed(2)} m at most)`);
    check(queue.shift < 0.5 && (queue.behind || !queue.round), `a ride behind a queue of ${queue.n} at a red light waits in its lane (out of it by ${queue.shift.toFixed(2)} m at most${queue.round ? `, going round ${queue.round}` : ''}${queue.behind ? '' : ', never caught up with the queue'})`);
    check(queue.passed.length === 0, `it never passes a car queueing there${queue.passed.length ? ` (passed ${(queue.passedHow || []).join('; ')})` : ''}`);
    check(!queue.overtook.length, `the traffic behind it queues behind it${queue.overtook.length ? ` (car ${queue.overtook.join(', ')} came past it)` : ''}`);
    if (queue.jams.length) console.log(`note a queue not tried to the end (it did not move in 90 s, or moved off before the taxi came up): ${queue.jams.join(' | ')}`);
    // (a queue that never moved in any of the tries is a jam ahead of it, not the taxi's doing: noted
    // above; the check is the taxi's own: once the car ahead moves, it follows without standing)
    if (queue.follow == null && queue.moved == null) console.log(`note and it goes on when the queue moves: not tried, the queue never moved (${queue.why})`);
    else check(queue.follow != null && queue.openMax < 2.5, `and it goes on when the queue moves (${queue.follow != null ? `off ${queue.follow.toFixed(1)} s after the car ahead first moved, ${queue.goneT.toFixed(0)} s after it came up; stood at most ${queue.openMax.toFixed(1)} s with room ahead` : queue.moved != null ? `the car ahead went ${queue.moved.toFixed(0)} s in, the taxi did not: ${queue.why}` : `the queue never moved: ${queue.why}`})`);
  }

  // no movement left standing in a junction: three minutes round where you are, no car that has its way
  // through a signalled junction stands still in it for more than two of its cycles (and the queues held
  // at a line through more than two greens are listed; tools/junction_held_step.js; #144, #150)
  await p.evaluate(() => { // (on foot first: out of a ride still going, once it stops)
    const g = window.__game;
    for (let t = 0; t < 40 && g.player.mode === 'ride'; t++) { g.leaveRide(); g.advance(0.5); }
  });
  const heldQ = await p.evaluate(heldStep, { T: 180, max: 2 });
  check(heldQ.held.length === 0, `no movement left standing in a junction for more than two cycles (${heldQ.watched} cars watched at their lines, ${heldQ.cycles} greens waited through${heldQ.held.length ? `; ${heldQ.held.length} standing` : ''})`);
  for (const h of heldQ.held.slice(0, 6)) console.log('  ' + h);
  const qNote = (what, L) => { if (L.length) console.log(`note ${what}: ${L.length}\n  ${L.slice(0, 3).join('\n  ')}`); };
  qNote('a queue at a signal held through more than two greens', heldQ.queues);
  qNote('held at a signal by your car, a ride or you in the road (not the junction\'s doing)', heldQ.yours);
  qNote('held at a signal behind a car at a wall across its way', heldQ.walls);
  qNote('a movement standing behind a walker in the road or the queue for the next junction\'s red', heldQ.beyond);

  // the traffic keeps out of the walls: cars whose body (most of its width, knee to 1.4 m) is in a building or a
  // landmark, over 20 s; none stands at a wall across its way for long; and no one-way road that comes to a
  // wall (a road the data runs into a building: game.js cutAtWalls, pipeline/road_passages.py) is open to it
  const carWalls = await p.evaluate(() => {
    const g = window.__game, nav = g.nav, C = g.cars.C, RL = g.roadNet.L, av = g.roadNet.avoid;
    let n = 0, inWall = 0, waits = 0;
    const at = [], still = new Map(), walls = new Map();
    for (let t = 0; t < 20; t++) {
      g.advance(1);
      for (const c of C) {
        if (c.line < 0) continue;
        n++;
        if (!nav.room(c.x, c.y, c.z, c.hw * 0.8, 1.4, c.z > nav.terrain(c.x, c.y) + 2)) { inWall++; const k = `car ${C.indexOf(c)} (${c.model}) on road ${c.line} (${RL[c.line].c}${g.roadNet.fit && g.roadNet.fit[c.line] < 9 ? `, room for ${g.roadNet.fit[c.line].toFixed(2)} m half-width` : ''})`; walls.set(k, (walls.get(k) || []).concat(`${c.x.toFixed(0)},${c.y.toFixed(0)} v ${c.v.toFixed(1)} ${c.why || '-'}${c.mv ? ' turning' : ''}`)); }
        const s = c.why === 'wall' && c.v < 0.1 ? (still.get(c) || 0) + 1 : 0;
        still.set(c, s);
        if (s === 6) { waits++; if (at.length < 3) at.push(`${c.x.toFixed(0)},${c.y.toFixed(0)} on road ${c.line}${RL[c.line].ow ? ' (one-way)' : ''}, the wall ${c.wallGap.toFixed(1)} m ahead`); }
      }
    }
    const traps = RL.filter((l, i) => l.ow && (l.wall & (l.ow > 0 ? 2 : 1)) && !(av && av[i])).length;
    return { n, inWall, waits, at, traps, ends: RL.filter(l => l.wall).length, walls: [...walls.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([k, v]) => `${k}: ${v.length} s, ${v.slice(0, 3).join(' | ')}`) };
  });
  check(carWalls.n > 0 && carWalls.inWall <= 0.01 * carWalls.n, `the traffic keeps out of the walls (${carWalls.inWall} of ${carWalls.n} car-seconds in a wall, at most 1%)`);
  if (carWalls.inWall > 0.005 * carWalls.n) console.log(`  in a wall: ${carWalls.walls.join('\n  in a wall: ')}`);
  check(carWalls.waits === 0 && carWalls.traps === 0, `no car waits at a wall across its way (${carWalls.waits}${carWalls.at.length ? `: ${carWalls.at.join('; ')}` : ''}), and no one-way road into a wall is open to the traffic (${carWalls.traps} of ${carWalls.ends} road ends at a wall)`);

  // the passages through the landmarks (landmarks.json "passages", pipeline/landmark_passages.py: the
  // Rijksmuseum's cycle passage and its aisles, the Imperial Palace's gates, Saint-Sulpice's loggia): each
  // walked end to end both ways on foot, and a road's with room for a car along it (tools/passage_walk.js).
  // After the traffic's steps: its walks run the world on for minutes, which would hand them other traffic
  {
    const res = await require('./passage_walk')(p);
    for (const r of res) {
      if (r.notYet) { console.log(`     (not opened in the model yet: ${r.name}, way ${r.osm}: ${r.notYet})`); continue; }
      check(r.ok, `walks the passage ${r.name} (way ${r.osm}, ${r.cls}, ${r.len.toFixed(0)} m${r.rev ? ', back' : ''})${r.ok ? '' : `: ${r.why} at ${r.at}`}`);
    }
  }

  // a ride with you in it turns round in the road (#199: one stuck in a queue on its own piece of road does,
  // after 20 s; here asked to at once through __game.turnRide): a ride ordered on the phone, boarded and under
  // way, turns round where the street is two-way, wide enough and clear (else a couple of seconds on, again):
  // it must come round to face the other way, never into a car of the traffic, and drive on
  const turn = await p.evaluate(() => {
    const g = window.__game, ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    if (!g.myCar || !g.myCar() || !g.turnRide) return { none: 'no cars' };
    for (let t = 0; t < 40 && g.player.mode === 'ride'; t++) { if (g.ride()) g.ride().hold = true; g.leaveRide(); g.advance(0.5); } // (held where it is, so that you can get out)
    if (g.player.mode !== 'foot') return { none: `you are still in the ${g.player.mode}` };
    if (g.ride() && g.ride().phase !== 'leaving') g.cancelRide();
    g.advance(2);
    const dest = g.destinations(g.player.x, g.player.y)[0];
    if (!dest) return { none: 'nowhere to go' };
    let o = null;
    for (let i = 0; i < 4 && !o; i++) { if (g.orderRide(dest) && g.ride() && (g.ride().phase === 'coming' || g.ride().phase === 'waiting')) o = g.ride(); else g.advance(5); }
    if (!o) return { none: `no ride came (${document.getElementById('g-toasts').textContent.slice(-100)})` };
    for (let t = 0; t < 120 && o.phase === 'coming'; t++) g.advance(0.5);
    if (o.phase !== 'waiting') return { none: `the ride didn't come (${o.phase})` };
    g.boardRide();
    for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
    for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
    if (g.dlg.open && g.dlg.hasChoices) g.dlg.choose(0);
    g.advance(3);
    const r = { tries: 0, why: {}, overlap: 0 };
    let said = '';
    for (let t = 0; t < 90 && o.phase === 'driving' && g.player.vehicle === o; t += 1.5) {
      said = g.turnRide(); r.tries++;
      if (said === 'turning') break;
      r.why[said] = (r.why[said] || 0) + 1;
      g.advance(1.5);
    }
    if (said !== 'turning') return Object.assign(r, { turned: false });
    const st0 = o.drv.st;
    r.turned = true;
    window.__turn = { o, r, h0: st0.h, u: 0 };
    // (half way round: a still from outside, the chase camera's)
    for (; window.__turn.u < 40 && o.turn && o.turn.i < o.turn.poses.length * 0.45; window.__turn.u += 0.25) {
      g.advance(0.25);
      const st = o.drv.st;
      r.overlap = Math.max(r.overlap, g.cars.footprint(st.x, st.y, st.z, st.h, o.C.half * 0.9, o.C.hw * 0.9, 0));
    }
    if (g.cam.mode === 'cabin') g.cam.mode = 'chase';
    g.advance(0.04);
    return r;
  });
  if (turn.turned) {
    await shot('turn');
    Object.assign(turn, await p.evaluate(() => {
      const g = window.__game, T = window.__turn, o = T.o, r = T.r, ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
      for (; T.u < 40 && o.turn; T.u += 0.25) {
        g.advance(0.25);
        const st = o.drv.st;
        r.overlap = Math.max(r.overlap, g.cars.footprint(st.x, st.y, st.z, st.h, o.C.half * 0.9, o.C.hw * 0.9, 0));
      }
      const st = o.drv.st;
      Object.assign(r, { secs: T.u, done: !o.turn, round: Math.abs(ad(st.h, T.h0)) });
      let went = 0, px = st.x, py = st.y;
      let secs = 0; // (120 s at most: a red light or a queue on its new way may hold it a while, two of Shibuya's long cycles)
      const held = {}; // (what held it, as the driver says, and the nearest car of the traffic ahead: printed on a failure)
      for (; secs < 120 && went <= 10; secs++) {
        g.advance(1); const q = o.drv.st; went += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y;
        const fx = Math.cos(q.h), fy = Math.sin(q.h);
        let near = null;
        for (const c of g.cars.C) { if (c.line < 0) continue; const a = (c.x - q.x) * fx + (c.y - q.y) * fy, d = Math.hypot(c.x - q.x, c.y - q.y); if (a > 0 && d < 30 && (!near || d < near.d)) near = { d, c }; }
        const k = `${(q.why || '-').replace(/[0-9.]+/g, '#')}${near ? ` | car ${g.cars.C.indexOf(near.c)} ${near.d.toFixed(0)} m ahead on road ${near.c.line}, v ${near.c.v.toFixed(1)}, ${near.c.why || '-'}, off ${(+near.c.off || 0).toFixed(1)}${near.c.inWallNow ? ', in from a wall' : ''}` : ''}`;
        held[k] = (held[k] || 0) + 1;
      }
      r.drove = went; r.driveSecs = secs; r.held = Object.entries(held).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} s: ${k}`);
      r.at = `${o.drv.st.x.toFixed(0)},${o.drv.st.y.toFixed(0)}`;
      g.skipRide(); g.advance(6); g.leaveRide(); g.advance(1);
      delete window.__turn;
      return r;
    }));
  }
  if (turn.none) check(true, `a ride turns round in the road: not tried (${turn.none})`);
  else if (!turn.turned) console.log(`note a ride turns round in the road: nowhere to on its way in ${turn.tries} tries (${Object.entries(turn.why).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  else {
    check(turn.done && turn.round > 2.8, `a ride turns round in the road: a three-point turn in ${turn.secs.toFixed(1)} s, round ${(turn.round * 180 / Math.PI).toFixed(0)}° (after ${turn.tries} tries${Object.keys(turn.why).length ? `: ${Object.entries(turn.why).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''})`);
    check(turn.overlap === 0, `and never into a car of the traffic as it turns (${turn.overlap.toFixed(2)} m deep at most)`);
    check(turn.drove > 10, `and drives on the other way (${turn.drove.toFixed(0)} m in ${turn.driveSecs} s)`);
    if (!(turn.drove > 10)) console.log(`  at ${turn.at}, held by: ${turn.held.join('\n  held by: ')}`);
  }

  // a lost WebGL context on purpose (WEBGL_lose_context): the game holds under a note, and once the
  // context is back the next frame is drawn, lit as it was (web/glcare.js, tools/glcare_step.js)
  await p.evaluate(() => { const g = window.__game; g.clock.frozen = true; }); // the light held still, to compare before and after
  const gl = await require('./glcare_step')(p, { canvas: 'game-gl', api: '__game', outDir, prefix: `${city}-` });
  check(gl.paused && gl.note, `a lost context holds the game under a note (paused ${gl.paused}, note ${gl.note})`);
  check(gl.drawn && gl.noteGone && gl.reloads === 0 && gl.after.sd >= 4, `the context restored, the next frame is drawn (in ${(gl.ms / 1000).toFixed(1)} s, luma ${gl.after.mean.toFixed(0)} ± ${gl.after.sd.toFixed(1)})`);
  check(Math.abs(gl.after.mean - gl.before.mean) < 10, `and lit as before (luma ${gl.before.mean.toFixed(1)} before, ${gl.after.mean.toFixed(1)} after)`);

  // a device that can't keep up (game.js shed): it gives up the rain's extras, then every drop, then
  // the street's reflections, then pixels, in that order, and never the people: the player, the NPCs
  // and the crowd near them keep their realistic models
  const shed = await p.evaluate(async () => {
    const g = window.__game, W = g.weather, frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    if (W) { W.set('rain', { now: true }); g.advance(1); }
    const seen = [];
    for (let i = 0; i < 8 && g.shed(); i++) {
      await frames(2);
      seen.push({ lvl: g.shedLevel(), w: W ? W.shed : null, near: W ? W.meshes.near.visible : null, far: W ? W.meshes.far.visible : null, mirror: g.mirror && g.mirror.on ? !!g.mirror.off : null, px: g.pxScale() });
    }
    const boxes = [g.player, ...g.npcs].filter(n => n.rig && !n.rig.pending && !n.rig.model).length;
    if (W) W.set('live');
    return { seen, boxes, people: 1 + g.npcs.length, wet: W ? W.state.wet : 0 };
  });
  {
    const s = shed.seen, at = k => s.findIndex(x => x.lvl === k);
    const order = s.length >= 2 && s[s.length - 1].px === 0.7 && s.every((x, i) => !i || x.px <= s[i - 1].px)
      && s.every(x => x.px === 1 || (x.w === null || x.w === 2) && (x.mirror === null || x.mirror));
    const rainFirst = at(1) < 0 || (s[at(1)].far === false && s[at(1)].near === true && s[at(1)].px === 1);
    check(order && rainFirst, `a slow device sheds the rain's extras first, then the drops, the reflections and then pixels (${s.map(x => `${x.lvl}:${x.w ?? '-'}/${x.mirror ?? '-'}/${x.px}`).join(' ')})`);
    check(shed.boxes === 0, `and keeps every person's realistic model (${shed.boxes} of ${shed.people} as simple figures)`);
  }

  check(!logs.some(l => l.startsWith('pageerror')), 'no page errors');
  if (logs.length) console.log(logs.slice(0, 15).join('\n'));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
