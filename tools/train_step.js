// The railway's step of tools/game_check.js, and tools/train_check.js on its own (rail.js "train": the Enoden
// at Kamakura). trainStep runs in the page (page.evaluate(trainStep)); trainChecks reads what it returns.
// Its timetable keeps the single track: trains of the two directions pass each other only in the loops. On
// foot: wait on a platform (the railway's clock run fast), the train comes in, board it, ride to the next
// station with the views from the window seat and the cab on the way, and get off onto the platform there.
// Then at a level crossing: the alarm sounds and the arms are down before the train is there, an arm holds
// you back, no car and no walker is on the rails as the train passes, and the crossing opens again behind it.
async function trainStep() {
  const g = window.__game, R = g.rail;
  if (!R || !R.train) return { none: true };
  const T = R.train, r = { H: T.H, stations: T.stations.length, loops: T.loops.length }, pl = g.player;
  // the timetable, two headways of it every half second: where a +1 and a -1 train change sides
  const sOf = (Rn, k, t) => { const tau = t - (k * T.H + Rn.c); return tau >= Rn.t0 && tau <= Rn.t1 ? (Rn.dir > 0 ? Rn.uAt(tau)[0] : T.main.L - Rn.uAt(tau)[0]) : null; };
  r.meets = 0; r.bad = 0;
  for (let k = -3; k <= 4; k++) for (let j = -3; j <= 4; j++) {
    let was = null;
    for (let t = 0; t <= 2 * T.H; t += 0.5) {
      const a = sOf(T.runs[1], k, t), b = sOf(T.runs[-1], j, t);
      if (a == null || b == null) { was = null; continue; }
      const sign = Math.sign(a - b);
      if (was != null && sign !== was) { r.meets++; if (!T.loops.some(l => a > l.s0 - 12 && a < l.s1 + 12 && b > l.s0 - 12 && b < l.s1 + 12)) r.bad++; }
      was = sign;
    }
  }
  // (out of a ride or your car first)
  for (let t = 0; t < 40 && pl.mode === 'ride'; t++) { if (g.ride()) g.ride().hold = true; g.leaveRide(); g.advance(0.5); }
  if (g.ride() && g.ride().phase !== 'leaving') g.cancelRide();
  if (pl.mode === 'car') { g.exitCar(); g.advance(0.5); }
  if (pl.mode !== 'foot') return Object.assign(r, { skipped: pl.mode });
  // a station with one after it in this direction
  const from = T.stations.find(st => T.runs[1].stops.some((sp, j) => sp.st && sp.st.id === st.id && T.runs[1].stops.slice(j + 1).some(q => q.st)));
  const q = from.plat[1];
  pl.x = q.x; pl.y = q.y; pl.z = q.z; g.advance(0.6);
  r.onPlatform = Math.abs(pl.z - q.z) < 0.45; r.platZ = +(pl.z - q.z).toFixed(2);
  let a = g.currentAction();
  r.waitText = a ? a.text : ''; r.from = from.id; r.views = [];
  // (wait for the train of the direction that has a next stop: at a loop the other one comes in too)
  const mine = () => R.cars.find(c => c.train && c.dir === 1 && R.stationOf(c.id) === from);
  let waited = 0;
  for (; waited < 400 && !mine(); waited += 0.5) {
    a = g.currentAction();
    if (a && a.act && /wait for it/.test(a.text)) a.act();
    g.advance(0.5);
  }
  a = g.currentAction();
  r.waited = waited; r.boardText = a ? a.text : '';
  const car = mine();
  if (!car) return Object.assign(r, { noTrain: true });
  g.boardRail(car, from); g.advance(0.3);
  r.aboard = pl.mode === 'rail' && pl.vehicle === car;
  const next = R.nextStop(car);
  r.to = next ? next.id : null;
  for (let t = 0; t < 120 && !car.moved; t += 0.5) g.advance(0.5);
  r.left = car.moved;
  g.advance(4);
  if (T.modelled) for (let i = 0; i < 3; i++) { g.nextView(); g.advance(0.6); r.views.push(g.cam.mode); }
  r.inside = Math.hypot(pl.x - car.x, pl.y - car.y) < T.length_m / 2 + 1;
  let top = 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
  for (let t = 0; t < 400 && !(R.stationOf(car.id) === next); t += 0.5) { g.advance(0.5); top = Math.max(top, car.speed); }
  r.top = +(top * 3.6).toFixed(0);
  r.arrived = R.stationOf(car.id) === next;
  a = g.currentAction(); r.offText = a ? a.text : '';
  if (a && a.act && /^Get off/.test(a.text)) a.act();
  g.advance(0.6);
  const pq = next ? next.plat[1] : q;
  r.off = pl.mode === 'foot'; r.offAt = +Math.hypot(pl.x - pq.x, pl.y - pq.y).toFixed(1); r.offZ = +(pl.z - pq.z).toFixed(2);
  // a gated crossing: stand on the road before it, a train due in 22 s
  const c = T.crossings.find(x => x.kind === 'gated' && x.name) || T.crossings.find(x => x.kind === 'gated');
  if (!c) return Object.assign(r, { noCrossing: true });
  const fx = Math.sin(c.road_h), fy = Math.cos(c.road_h), tx = Math.sin(c.h), ty = Math.cos(c.h);
  const stand = d => { const x = c.x - fx * d, y = c.y - fy * d, f = g.nav.floorAt(x, y, c.z + 2); pl.x = x; pl.y = y; pl.z = f ? f.z : c.z; pl.h = c.road_h; Object.assign(g.cam, { mode: 'chase', yaw: c.road_h, yawTo: null, lastInput: -10 }); };
  stand(c.half_m + 7); g.advance(1);
  let bells = 0; const kan = OEAudio.kan; OEAudio.kan = v => { bells++; return kan(v); };
  R.cue(c.s, 22); g.advance(0.2);
  r.crossing = c.name || c.id; r.alarm = c.closed; r.armAtStart = +c.arm.toFixed(2);
  const nose = () => Math.min(...T.slots.filter(o => o.live).map(o => Math.abs(o.s - c.s) - T.length_m / 2));
  let down = null, shut = 0, onRails = 0, seen = 0, passed = false, held = true;
  for (let t = 0; t < 110; t += 0.25) {
    // (walking at the arm from the tenth second on: it holds you on your side of the rails)
    g.advance(0.25, t > 10 && t < 16 ? ['KeyW'] : []);
    if (c.closed) shut += 0.25;
    if (down == null && c.arm > 0.98) down = +nose().toFixed(1);
    const across = (pl.x - c.x) * fx + (pl.y - c.y) * fy;
    if (t > 10 && t < 16 && across > -1.2) held = false;
    if (nose() < 0) { // a train on the crossing: who else is on the rails there
      seen++;
      const on = (x, y) => Math.abs((x - c.x) * -ty + (y - c.y) * tx) < 1.3 && Math.abs((x - c.x) * tx + (y - c.y) * ty) < c.width_m / 2 + 1;
      for (const k of g.cars.live) if (k.line >= 0 && on(k.x, k.y)) onRails++;
      for (let i = 0; i < g.crowd.active; i++) if (on(g.crowd.P[i].x, g.crowd.P[i].y)) onRails++;
      passed = true;
    }
    if (passed && !c.closed && c.arm < 0.03) break;
  }
  OEAudio.kan = kan;
  Object.assign(r, { downAt: down, shut, onRails, seen, passed, held, open: !c.closed && c.arm < 0.03, bells, gateSide: +(((pl.x - c.x) * fx + (pl.y - c.y) * fy)).toFixed(1) });
  return r;
}

function trainChecks(train, check) {
  check(train.loops === 0 || (train.meets > 0 && train.bad === 0), `the railway's timetable: a train each way every ${(train.H / 60).toFixed(1)} min, ${train.meets} meets in two headways, ${train.bad} outside a passing loop`);
  if (train.skipped) check(false, `the train ride: not on foot (${train.skipped})`);
  else {
    check(train.onPlatform && /next train/.test(train.waitText), `stands on ${train.from}'s platform (${train.platZ} m off its level), which offers to wait for the next train ("${train.waitText}")`);
    check(!train.noTrain && train.waited < 400 && /^Board/.test(train.boardText), `the train comes in (waited ${train.waited} s with the clock run fast): "${train.boardText}"`);
    check(train.aboard && train.left && train.inside, `boards it and it leaves (${train.aboard ? 'aboard' : 'not aboard'}, ${train.left ? 'left' : 'did not leave'})`);
    check(!train.views.length || (train.views[0] === 'cabin' && train.views[1] === 'cab' && train.views[2] === 'chase'), `the views aboard: ${train.views.length ? train.views.join(', ') : 'chase only (the stand-in models)'}`);
    check(train.arrived && train.top > 8 && train.top <= 46, `rides to ${train.to} (${train.top} km/h at most)`);
    check(train.off && train.offAt < 8 && Math.abs(train.offZ) < 0.5, `gets off onto its platform ("${train.offText}", ${train.offAt} m from its middle, ${train.offZ} m off its level)`);
    if (!train.noCrossing) {
      check(train.alarm && train.armAtStart < 0.05 && train.bells > 20, `at the ${train.crossing} crossing the alarm sounds 22 s before the train (${train.bells} strokes of the bell)`);
      check(train.downAt != null && train.downAt > 15, `its arms are down with the train still ${train.downAt} m off`);
      check(train.held, `an arm holds you back (${train.gateSide} m from the rails at the end)`);
      check(train.passed && train.onRails === 0, `the train passes with no car and no walker on the rails (${train.onRails} seen in ${train.seen} samples)`);
      check(train.open && train.shut < 75, `and the crossing opens again (closed ${train.shut.toFixed(0)} s)`);
    }
  }
}

module.exports = { trainStep, trainChecks };
