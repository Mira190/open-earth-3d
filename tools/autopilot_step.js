// The autopilot of your own car (#355, web/game/autopilot.js; game.js pilotTo): from the driver's seat it is
// sent to a place a few hundred metres off by road, and must get there by itself.
// autopilotStep runs in the page (page.evaluate(autopilotStep, { log })), once the game has started:
//   engage    you are put at the wheel; the autopilot takes a destination (the nearest of the places it offers
//             that is 250 m or more off by road) and the car sets off within 20 s;
//   screen    while it drives, its screen has the time left, the distance and the next turn, and the film
//             cuts between shots;
//   handback  once it is moving, a touch of the wheel (the A key) gives the car back at the speed it had,
//             with no jump in its place; then the autopilot is put back on, from the moving car;
//   drive     it is never more than 0.15 m into a car of the traffic, never stands more than 100 s at a time,
//             and never crosses a stop line on red (but for the turn its arrow shows);
//   arrive    within 420 s of the game's clock it has pulled in, stopped, within 40 m of the end of its route,
//             and the car is yours again.
// It also reports the scenic way to the same place (how much of it runs by the water or the landmarks).
// tools/game_check.js runs it; alone: GAME_TIME=10:00 xvfb-run -a node tools/autopilot_probe.js sydney
async function autopilotStep({ log = false, far = 250, limit = 420 } = {}) {
  const g = window.__game, c = g.myCar && g.myCar();
  if (!c || !g.pilotTo) return { none: 'no car' };
  const A = g.cars, st = c.D.st, out = { log: [] };
  const seat = (() => { // out of a ride if you are in one, and into your car's driver's seat
    for (let t = 0; t < 40 && g.player.mode === 'ride'; t++) { g.leaveRide(); g.advance(0.5); }
    if (g.ride && g.ride() && g.cancelRide) g.cancelRide();
    for (let k = 0; k < 2 && g.player.mode !== 'car'; k++) {
      const s = (g.KEEP === 'left' ? 1 : -1) * (k ? -1 : 1); // (the kerb side first; then the road side, where a wall is at the kerb)
      g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
      g.advance(0.3);
      g.enterCar();
      for (let i = 0; i < 24 && g.player.mode !== 'car'; i++) g.advance(0.5);
    }
    return g.player.mode === 'car' ? null : `could not get into the car (${g.player.mode}, ${Math.hypot(g.player.x - st.x, g.player.y - st.y).toFixed(1)} m from it, ${g.player.auto ? 'walking to its door' : 'not walking'})`;
  });
  const noSeat = seat();
  if (noSeat) return { none: noSeat };
  // where to: tried in the order offered, the first whose way is long enough
  const dests = g.destinations(st.x, st.y).filter(d => d.id !== 'car');
  let dest = null;
  for (const d of dests) { if (g.pilotTo(d, { quiet: true }) && g.pilot().len >= far && g.pilot().len < 1500) { dest = d; break; } g.pilotOff(); }
  if (!dest) for (const d of dests) { if (g.pilotTo(d, { quiet: true })) { dest = d; break; } }
  if (!dest) return { none: `no place to drive to (${dests.length} offered)` };
  const o0 = g.pilot(), P0 = o0.drv.path, end0 = {};
  P0.at(P0.len, end0);
  Object.assign(out, { dest: dest.name, len: o0.len, joined: !o0.join, turns: o0.turns.length - 1 });
  // the scenic way to the same place, for the report (then back to the quickest)
  g.pilotTo(dest, { scenic: true, quiet: true });
  out.scenic = g.pilot() ? { len: g.pilot().len, share: g.pilot().share } : null;
  g.pilotTo(dest, { scenic: false, quiet: true });
  if (!g.pilot()) return Object.assign(out, { none: 'the autopilot would not take the place twice' });
  const depth = () => { return A.footprint(st.x, st.y, st.z, st.h, c.C.half * 0.95, c.C.hw * 0.95, 0); };
  const shots = new Set();
  let t = 0, stood = 0, moved0 = null, red = 0, lastLine = null, handed = null, hud = 0;
  Object.assign(out, { deep: 0, stoodMax: 0, vmax: 0, setOff: null });
  for (; t < limit && g.pilot(); t += 0.25) {
    g.advance(0.25);
    const o = g.pilot();
    if (!o) break;
    const d = o.drv.st;
    out.vmax = Math.max(out.vmax, st.speed);
    if (out.setOff == null && st.speed > 1.5) out.setOff = t;
    if (!o.join) {
      const dp = depth();
      if (dp > out.deep + 0.05) { // (which car, and what each was doing)
        const near = A.C.filter(q => q.line >= 0 && Math.hypot(q.x - st.x, q.y - st.y) < q.half + c.C.half + 1).map(q => `car ${A.C.indexOf(q)} ${Math.hypot(q.x - st.x, q.y - st.y).toFixed(1)} m off, turned ${(Math.atan2(Math.sin(q.h - st.h), Math.cos(q.h - st.h))).toFixed(2)}, v ${q.v.toFixed(1)}, ${q.why}${q.youBy ? ` (${q.youBy})` : ''}${q.mv ? ' in a junction' : ''}${q.rev ? ' reversing' : ''}${q.bus ? ' bus' : ''}`).join('; ');
        out.log.push(`${t}s ${dp.toFixed(2)} m into: ${near} | it: v ${d.v.toFixed(1)} ${d.why || ''} wedged ${(d.wedged || 0).toFixed(1)} solid ${o.drv.opts && o.drv.opts.solid ? o.drv.opts.solid(d.x, d.y, d.z, d.h).toFixed(2) : "none"} off ${Math.hypot(st.x - d.x, st.y - d.y).toFixed(2)} pass ${d.pass.toFixed(1)} shift ${d.shift.toFixed(1)}${d.mv ? ' in a junction' : ''}${o.turn ? ' turning round' : ''}`);
      }
      out.deep = Math.max(out.deep, dp);
    }
    stood = st.speed < 0.3 ? stood + 0.25 : 0;
    if (stood > out.stoodMax) { out.stoodMax = stood; out.stoodWhy = `${d.why || (o.join ? 'joining' : '?')}${d.junction ? ` (${d.junction})` : ''}${o.turn ? ' (turning round)' : ''} at ${st.x.toFixed(0)},${st.y.toFixed(0)}`; }
    if (o.film && o.film.name) shots.add(o.film.name);
    if (o.hud && o.hud.eta > 0 && o.hud.left > 0 && o.hud.turn) hud++;
    // over a stop line on red: the line it was coming up to (d.lineAt, d.toLine) passed while its light was red
    if (d.lineAt && d.toLine != null) {
      if (lastLine && lastLine.a === d.lineAt && lastLine.d > 0.5 && d.toLine <= -1 && g.junctions.light(d.lineAt, d.lineEx) === 'r') { red++; out.log.push(`${t}s over the line of junction ${d.lineAt.j.id} on red`); }
      lastLine = { a: d.lineAt, d: d.toLine };
    } else lastLine = null;
    if (log && ((stood > 6 && stood < 20 && t % 4 === 0) || (stood > 20 && t % 10 === 0))) { // (what holds it: the car it waits on, and what that one waits on, down the chain)
      const name = q => (A.C.includes(q) ? `car ${A.C.indexOf(q)}` : q && q.id ? q.id : 'other'), one = q => `${name(q)} v ${(+q.v || 0).toFixed(1)} ${q.why || ''}${q.youBy ? ` (${q.youBy})` : ''}${q.heldBy ? ` by ${q.heldBy}` : ''}${q.mv ? ` in j${q.mv.j.id}` : ''}${q.lineArm ? ` at j${q.lineArm.j.id} light ${g.junctions.light(q.lineArm, q.lineEx)}` : ''}${q.rev ? ' reversing' : ''} ${Math.hypot(q.x - st.x, q.y - st.y).toFixed(0)} m off`;
      const ch = [];
      for (let q = d.block && d.block.of ? d.block.of : d.block, k = 0; q && k < 6; q = q.front, k++) ch.push(one(q));
      out.log.push(`${t}s STOOD ${stood.toFixed(0)} s: ${d.why} held ${(d.held || 0).toFixed(0)} q ${!!d.q} xMutual ${!!d.xMutual} ${d.mv ? `in j${d.mv.j.id}` : d.lineAt ? `at j${d.lineAt.j.id} (${d.junction || ''}) light ${g.junctions.light(d.lineAt, d.lineEx)}` : ''} turn ${o.turnNo || (o.turn ? 'turning' : '')} | ${ch.join(' < ') || 'no block'}`);
    }
    if (log && t % 5 === 0) out.log.push(`${t}s s=${d.s.toFixed(0)}/${o.drv.path.len.toFixed(0)} v=${st.speed.toFixed(1)} ${o.join ? 'joining' : d.why || ''} ${o.hud ? `[${o.hud.turn} · ${Math.round(o.hud.eta)} s]` : ''} film ${o.film.name}`);
    // the handback: a touch of the wheel, once it is well under way
    if (!handed && !o.join && st.speed > 4 && t > 6 && !d.mv) {
      const v0 = st.speed, x0 = st.x, y0 = st.y;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
      g.advance(0.1);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a' }));
      handed = { off: !g.pilot(), v0, v1: st.speed, jump: Math.hypot(st.x - x0, st.y - y0) - v0 * 0.1 };
      g.advance(0.4);
      handed.again = g.pilotTo(dest, { quiet: true });
      handed.joined = !!g.pilot() && !g.pilot().join;
    }
  }
  const o = g.pilot();
  Object.assign(out, { t, arrived: !o, mode: g.player.mode, v: st.speed, d: Math.hypot(st.x - end0.x, st.y - end0.y), red, handed, hud, shots: [...shots] });
  if (o) { out.left = o.drv.remaining(); out.why = o.drv.st.why || ''; g.pilotOff(); }
  return out;
}
// the checks on what autopilotStep returns, as [ok, what] pairs
function autopilotChecks(r) {
  if (r.none) return [[r.none === 'no car', `the autopilot: ${r.none}`]];
  const h = r.handed, km = m => `${(m / 1000).toFixed(2)} km`;
  return [
    [r.setOff != null && r.setOff <= 20, `the autopilot takes your car to ${r.dest}, ${km(r.len)} by road with ${r.turns} turn${r.turns === 1 ? '' : 's'}, and sets off${r.setOff != null ? ` in ${r.setOff.toFixed(1)} s` : ': never'}${r.scenic ? ` (the scenic way ${km(r.scenic.len)}, ${Math.round(r.scenic.share * 100)}% by the water or the landmarks)` : ''}`],
    [r.hud >= 8 && r.shots.length >= 2, `its screen shows the time left, the distance and the next turn (${r.hud} readings), and the film cuts between shots (${r.shots.join(', ') || 'none'})`],
    [!!h && h.off && h.v1 > h.v0 * 0.7 && Math.abs(h.jump) < 0.6 && h.again, h ? `a touch of the wheel hands it back moving (${h.v0.toFixed(1)} to ${h.v1.toFixed(1)} m/s, a jump of ${h.jump.toFixed(2)} m), and it takes the car again${h.joined ? ' at once' : ' from off its line'}` : 'the handback: it was never under way to try'],
    [r.deep <= 0.15 && r.red === 0 && r.stoodMax <= 100, `it drives clear of the traffic (${r.deep.toFixed(2)} m into a car at most), over no red line (${r.red}), standing ${r.stoodMax.toFixed(0)} s at most${r.stoodMax > 20 ? ` (${r.stoodWhy})` : ''}, up to ${(r.vmax * 3.6).toFixed(0)} km/h`],
    [r.arrived && r.mode === 'car' && r.v < 0.5 && r.d < 40, r.arrived ? `it pulls in ${r.d.toFixed(0)} m from the end of its way after ${r.t.toFixed(0)} s, and the car is yours` : `it has not arrived after ${r.t.toFixed(0)} s: ${r.left.toFixed(0)} m to go, ${r.why}`],
  ];
}
// The driver assists (#355, game.js assistStep): lane keeping and adaptive cruise when you drive yourself.
// assistStep runs in the page: the autopilot brings the car up to speed in its lane on the way to a place and is
// switched off; with both assists on and no key held, for 40 s of the game's clock the car must hold its lane
// (lane keeping at work for 5 s or more, and within 0.6 m of the lane's middle once it has settled: 3 s after it
// takes hold or the road changes at a junction), keep to the
// speed set, stay out of the traffic and behind every red line; then a touch of the brake must end the cruise.
async function assistStep({ log = false } = {}) {
  const g = window.__game, c = g.myCar && g.myCar();
  if (!c || !g.assistToggle) return { none: 'no car' };
  const A = g.cars, st = c.D.st, out = { log: [] };
  const seat = () => { // (as autopilotStep's)
    for (let t = 0; t < 40 && g.player.mode === 'ride'; t++) { g.leaveRide(); g.advance(0.5); }
    if (g.ride && g.ride() && g.cancelRide) g.cancelRide();
    for (let k = 0; k < 2 && g.player.mode !== 'car'; k++) {
      const s = (g.KEEP === 'left' ? 1 : -1) * (k ? -1 : 1);
      g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
      g.advance(0.3); g.enterCar();
      for (let i = 0; i < 24 && g.player.mode !== 'car'; i++) g.advance(0.5);
    }
    return g.player.mode === 'car' ? null : `could not get into the car (${g.player.mode}, ${Math.hypot(g.player.x - st.x, g.player.y - st.y).toFixed(1)} m from it)`;
  };
  const noSeat = seat();
  if (noSeat) return { none: noSeat };
  let ok = false;
  for (const d of g.destinations(st.x, st.y).filter(d => d.id !== 'car')) if (g.pilotTo(d, { quiet: true }) && g.pilot().len > 200) { ok = true; break; }
  if (!ok) return { none: 'no place to drive towards' };
  // up to speed, in its lane, clear of a junction
  let t = 0;
  for (; t < 120 && g.pilot(); t += 0.25) { g.advance(0.25); const o = g.pilot(), d = o && o.drv.st; if (d && !o.join && st.speed > 6 && !d.mv && !(d.toLine < 30) && Math.abs(d.shift) < 0.1 && o.drv.remaining() > 120) break; }
  if (!g.pilot() || t >= 120) { g.pilotOff(); return { none: 'the car never got up to speed on a clear stretch' }; }
  g.pilotOff();
  if (!g.assist.lane) g.assistToggle('lane');
  if (!g.assist.cruise) g.assistToggle('cruise');
  Object.assign(out, { set: g.assist.set, off: 0, laneT: 0, cruiseT: 0, over: 0, deep: 0, red: 0, stops: 0, vmin: st.speed, dist: 0 });
  let last = null, x0 = st.x, y0 = st.y, stopped = false, settle = 3, lineWas = null;
  for (t = 0; t < 40; t += 0.1) {
    g.advance(0.1);
    const L = g.assist.here;
    // (settled: 3 s after it takes hold, and after the road it reads changes at a junction, where the lane's middle steps)
    if (!g.assist.on.lane || !L || L.line !== lineWas) settle = 3;
    lineWas = L ? L.line : null; settle -= 0.1;
    if (g.assist.on.lane && L) { out.laneT += 0.1; out.offAny = Math.max(out.offAny || 0, Math.abs(L.d)); if (settle <= 0) { out.heldT = (out.heldT || 0) + 0.1; out.off = Math.max(out.off, Math.abs(L.d)); } }
    if (g.assist.on.cruise) { out.cruiseT += 0.1; out.over = Math.max(out.over, st.speed - g.assist.set); }
    out.deep = Math.max(out.deep, A.footprint(st.x, st.y, st.z, st.h, c.C.half * 0.95, c.C.hw * 0.95, 0));
    out.vmin = Math.min(out.vmin, st.speed);
    out.dist += Math.hypot(st.x - x0, st.y - y0); x0 = st.x; y0 = st.y;
    if (st.speed < 0.3 && !stopped) { stopped = true; out.stops++; out.log.push(`${t.toFixed(1)}s stopped: ${g.assist.line != null ? `a red line ${g.assist.line.toFixed(1)} m ahead` : g.assist.lead ? `a car ${g.assist.lead.gap.toFixed(1)} m ahead` : 'nothing seen'}`); } else if (st.speed > 1) stopped = false;
    // over a stop line on red
    const a = L && g.junctions.armAt(L.line, L.dir > 0 ? 1 : 0), d = a && a.j.sig ? (L.dir > 0 ? L.len - L.s : L.s) - a.back : null;
    if (last && a && last.a === a && last.d > 0.5 && d <= -1 && g.junctions.light(a) === 'r') { out.red++; out.log.push(`${t.toFixed(1)}s over the line of junction ${a.j.id} on red`); }
    last = d != null ? { a, d } : null;
    if (log && Math.round(t * 10) % 20 === 0) out.log.push(`${t.toFixed(0)}s v=${st.speed.toFixed(1)} lane ${g.assist.on.lane ? (L ? L.d.toFixed(2) : '?') : 'off'} ${g.assist.line != null ? `line ${g.assist.line.toFixed(0)} m` : ''} ${g.assist.lead ? `lead ${g.assist.lead.gap.toFixed(0)} m v ${g.assist.lead.v.toFixed(1)}` : ''}`);
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's' }));
  g.advance(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's' }));
  out.braked = !g.assist.cruise;
  if (g.assist.lane) g.assistToggle('lane');
  if (g.assist.cruise) g.assistToggle('cruise');
  for (let i = 0; i < 20 && st.speed > 0.3; i++) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's' })); g.advance(0.25); }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's' }));
  return out;
}
function assistChecks(r) {
  if (r.none) return [[r.none === 'no car', `the driver assists: ${r.none}`]];
  return [
    [r.laneT >= 5 && r.off <= 0.6 && r.offAny <= 2.6, `lane keeping holds the lane with no hand on the wheel (${r.laneT.toFixed(0)} s at work over ${r.dist.toFixed(0)} m; once settled, ${r.off.toFixed(2)} m off the lane's middle at most in ${(r.heldT || 0).toFixed(0)} s)`],
    [r.cruiseT >= 20 && r.over <= 1.5 && r.deep <= 0.15 && r.red === 0, `adaptive cruise keeps to ${(r.set * 3.6).toFixed(0)} km/h (${r.over.toFixed(1)} m/s over at most), clear of the traffic (${r.deep.toFixed(2)} m) and behind the red lines (${r.red} crossed; ${r.stops} stop${r.stops === 1 ? '' : 's'}, down to ${(r.vmin * 3.6).toFixed(0)} km/h)`],
    [r.braked, 'a touch of the brake ends the cruise'],
  ];
}
// The weather on the road (#355, cars.js setWeather): 25 s of the traffic on a dry road, then 25 s in the rain. In
// the rain the drivers' numbers must change (pace under 1, the gap's factor over 1, headlamps on by day), the cars
// on the move must be slower on average than they were dry, and the cars near you must throw up spray.
async function wetStep() {
  const g = window.__game, W = g.weather, C = window.OECars;
  if (!W || !C || !C.setWeather) return { none: 'no weather' };
  const A = g.cars, X = C.weather;
  const run = secs => { let v = 0, n = 0, near = 0; for (let t = 0; t < secs; t += 0.5) { g.advance(0.5); for (const c of A.C) if (c.line >= 0 && !c.park && c.v > 4) { v += c.v / (g.roadNet.L[c.line].v || 11); n++; if (Math.hypot(c.x - g.player.x, c.y - g.player.y) < 60) near++; } } return { v: n ? v / n : 0, n, near }; };
  W.set('clear', { now: true }); g.advance(6);
  const dry = run(25), d0 = { pace: X.pace, lamps: X.lamps };
  W.set('rain', { now: true }); g.advance(6);
  const wet = run(25), sp = C.sprayState && C.sprayState();
  const out = { dry: dry.v, wet: wet.v, n: Math.min(dry.n, wet.n), near: wet.near, pace: X.pace, headway: X.headway, grip: X.grip, lamps: X.lamps, dryPace: d0.pace, dryLamps: d0.lamps, spray: sp ? sp.live : 0, night: g.U ? g.U.uNight.value : null };
  W.set('clear', { now: true }); g.advance(3);
  return out;
}
function wetChecks(r) {
  if (r.none) return [[true, `the weather on the road: ${r.none}`]];
  return [
    [r.dryPace === 1 && r.dryLamps === 0 && r.pace < 0.95 && r.headway > 1.1 && r.lamps === 1, `in the rain the drivers keep ${(r.pace * 100).toFixed(0)}% of their dry pace and ${(r.headway * 100 - 100).toFixed(0)}% more gap on ${(r.grip * 100).toFixed(0)}% of the grip, headlamps on (dry: ${(r.dryPace * 100).toFixed(0)}%, lamps ${r.dryLamps ? 'on' : 'off'})`],
    [r.n < 200 || r.wet < r.dry * 0.985, `and the traffic on the move is slower: ${(r.wet * 100).toFixed(0)}% of the limit against ${(r.dry * 100).toFixed(0)}% dry (${r.n} car-samples)`],
    [r.near < 20 || r.spray > 0, `the cars near you throw up spray (${r.spray} puffs in the air; ${r.near} car-samples within 60 m)`],
  ];
}
// Level crossings (#355, junctions.js addRail): a crossing is put on a busy street near you (a map with a railway
// has its own; this one is the check's, its state set from here) and run open for 30 s, through 3 s of warning,
// shut for 30 s and open again. While it is shut (from 4 s in) no car may be on the rails; none may ever stand on
// them 3 s or more, open or shut (the rails are kept clear of a queue); and the traffic must cross again within
// 20 s of its opening.
async function railStep() {
  const g = window.__game, A = g.cars, J = g.junctions, L = g.roadNet.L;
  if (!J.addRail) return { none: 'no level crossings in this build' };
  // the street: the one with the most cars on the move within 400 m, long enough, with no crossing of its own
  const n = new Map();
  for (let t = 0; t < 20; t++) { g.advance(1); for (const c of A.C) if (c.line >= 0 && !c.park && c.v > 2 && Math.hypot(c.x - g.player.x, c.y - g.player.y) < 400) n.set(c.line, (n.get(c.line) || 0) + 1); }
  let X = null, state = 'open';
  for (const [line] of [...n.entries()].sort((a, b) => b[1] - a[1])) {
    const l = L[line];
    if (l.len < 90 || (J.midsOn(line) || []).length) continue;
    const q = {}; g.roadNet.at(line, l.len / 2, q);
    X = J.addRail({ x: q.x, y: q.y, z: q.z, w: 6, state: () => state });
    if (X) break;
  }
  if (!X) return { none: 'no street near you busy and long enough for a crossing' };
  const w = X.rail.w, out = { line: X.line, cls: L[X.line].c, crossedOpen: 0, onShut: 0, stoodOn: 0, waited: 0, crossedAfter: null, kept: 0, log: [] };
  const was = new Map(), stood = new Map();
  const step = (secs, tag) => {
    for (let t = 0; t < secs; t += 0.25) {
      g.advance(0.25);
      for (const c of A.C) {
        if (c.line !== X.line || c.park) { was.delete(c); stood.delete(c); continue; }
        const d = (c.s - X.mid) * c.dir, p = was.get(c); // (past the crossing's middle when positive)
        if (p != null && p < 0 && d >= 0) { if (tag === 'open') out.crossedOpen++; if (tag === 'after' && out.crossedAfter == null) out.crossedAfter = t; }
        was.set(c, d);
        const on = Math.abs(d) < w / 2 + c.half - 0.3; // (any of its body over the corridor)
        if (on && tag === 'shut' && t >= 4) { out.onShut++; if (out.log.length < 6) out.log.push(`shut ${t}s: car ${A.C.indexOf(c)} ${d.toFixed(1)} m past the middle, v ${c.v.toFixed(1)}, ${c.why}`); }
        const st = on && c.v < 0.3 ? (stood.get(c) || 0) + 0.25 : 0;
        stood.set(c, st);
        if (st === 3) { out.stoodOn++; if (out.log.length < 6) out.log.push(`${tag} ${t}s: car ${A.C.indexOf(c)} stood on the rails, ${c.why}${c.heldBy ? ` by ${c.heldBy}` : ''}`); }
        if (tag === 'shut' && c.why === 'light' && c.v < 0.3 && d < 0 && d > -30) out.waited = Math.max(out.waited, 1);
        if (c.why === 'rails') out.kept++;
      }
    }
  };
  step(30, 'open');
  state = 'warning'; step(3, 'warning');
  state = 'closed'; step(30, 'shut');
  out.queue = A.C.filter(c => c.line === X.line && !c.park && c.v < 0.3 && (c.s - X.mid) * c.dir < 0 && (c.s - X.mid) * c.dir > -60).length;
  state = 'open'; step(30, 'after');
  // (the check's crossing is left open and out of the way: taken off its street)
  const on = J.midsOn(X.line); if (on) { const i = on.indexOf(X); if (i >= 0) on.splice(i, 1); }
  { const i = J.rails.indexOf(X); if (i >= 0) J.rails.splice(i, 1); }
  X.rail.state = () => 'open';
  return out;
}
function railChecks(r) {
  if (r.none) return [[true, `level crossings: ${r.none}`]];
  return [
    [r.onShut === 0 && r.stoodOn === 0, `at a level crossing on a ${r.cls} street the traffic stops for the alarm and keeps the rails clear (${r.crossedOpen} crossed while it was open; shut, ${r.queue} queued and ${r.onShut} car-steps on the rails; ${r.stoodOn} stood on them; held back for room beyond ${r.kept} car-steps)${r.log.length ? `: ${r.log.join('; ')}` : ''}`],
    [r.crossedOpen === 0 || r.queue === 0 || r.crossedAfter != null, `and goes on when it opens (${r.crossedAfter != null ? `the first across ${r.crossedAfter.toFixed(1)} s after` : 'none came'})`],
  ];
}
module.exports = { autopilotStep, autopilotChecks, assistStep, assistChecks, wetStep, wetChecks, railStep, railChecks };
