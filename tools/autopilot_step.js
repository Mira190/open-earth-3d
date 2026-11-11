// The autopilot of your own car (#355, web/game/autopilot.js; game.js pilotTo): from the driver's seat it is
// sent to a place a few hundred metres off by road, and must get there by itself.
// autopilotStep runs in the page (page.evaluate(autopilotStep, { log })), once the game has started:
//   engage    you are put at the wheel and travel in the car to the map's first landmark (a kerb, as a drive
//             starts); the autopilot takes a destination (the nearest of the places it offers
//             that is 250 m or more off by road) and the car sets off within 20 s;
//   screen    while it drives, its screen has the time left, the distance and the next turn, and the film
//             runs (its cuts come with the frames drawn);
//   handback  once it is moving, a touch of the wheel (the A key) gives the car back at the speed it had,
//             with no jump in its place; then the autopilot is put back on, from the moving car;
//   drive     it never drives more than 0.15 m into a car of the traffic (one that comes into it where it stands is noted), never stands more than 100 s at a time,
//             and never crosses a stop line on red (but for the turn its arrow shows);
//   blocked   a road that will not clear (stood 75 s, no red light) is said so and the car handed back: the check
//             goes on from the next landmark, twice at most;
//   arrive    within 420 s (longer for a way over 1.5 km, where no place nearer is offered: 120 s and 8 m/s) of the game's clock it has pulled in, stopped, within 40 m of the end of its route,
//             and the car is yours again.
// It also reports the scenic way to the same place (how much of it runs by the water or the landmarks).
// tools/game_check.js runs it; alone: GAME_TIME=10:00 xvfb-run -a node tools/autopilot_probe.js sydney
async function autopilotStep({ log = false, far = 250, limit = 420, fresh = true } = {}) {
  const g = window.__game, c = g.myCar && g.myCar();
  if (!c || !g.pilotTo) return { none: 'no car' };
  const A = g.cars, st = c.D.st, out = { log: [] };
  const seat = (() => { // out of a ride if you are in one, and into your car's driver's seat
    for (let t = 0; t < 400 && g.player.mode === 'ride'; t++) { g.leaveRide(); g.advance(0.5); } // (a ride on its way lets you out when it next stops)
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
  // from a kerb by a landmark, as a drive starts (the steps before leave the car wherever they ended, in whatever
  // they made of the traffic there): the map's own travel in your car
  const hop = k => {
    const lm = g.landmarks && g.landmarks[k % g.landmarks.length];
    if (!lm || !g.travelTo || !g.travelTo(lm)) return;
    for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
    g.advance(8);
    if (g.player.mode !== 'car') seat();
  };
  if (fresh) hop(0);
  if (g.player.mode !== 'car') return { none: 'not at the wheel after travelling to a landmark' };
  // where to: tried in the order offered, the first whose way is long enough
  let dest = null, end0 = {};
  const pick = () => {
    const dests = g.destinations(st.x, st.y).filter(d => d.id !== 'car');
    dest = null;
    for (const d of dests) { if (g.pilotTo(d, { quiet: true }) && g.pilot().len >= far && g.pilot().len < 1500) { dest = d; break; } g.pilotOff(); }
    if (!dest) for (const d of dests) { if (g.pilotTo(d, { quiet: true })) { dest = d; break; } }
    if (!dest) return `no place to drive to (${dests.length} offered)`;
    const o0 = g.pilot(), P0 = o0.drv.path;
    P0.at(P0.len, end0);
    Object.assign(out, { dest: dest.name, len: o0.len, joined: !o0.join, turns: o0.turns.length - 1 });
    return null;
  };
  { const no = pick(); if (no) return { none: no }; }
  // the scenic way to the same place, for the report (then back to the quickest)
  g.pilotTo(dest, { scenic: true, quiet: true });
  out.scenic = g.pilot() ? { len: g.pilot().len, share: g.pilot().share } : null;
  g.pilotTo(dest, { scenic: false, quiet: true });
  if (!g.pilot()) return Object.assign(out, { none: 'the autopilot would not take the place twice' });
  // (the time allowed: for a way of up to 1.5 km, as asked; a longer one, where no place offered is nearer, at 8 m/s
  // on average and two minutes for the lights)
  limit = Math.max(limit, 120 + g.pilot().len / 8);
  const depth = () => { return A.footprint(st.x, st.y, st.z, st.h, c.C.half * 0.95, c.C.hw * 0.95, 0); };
  const shots = new Set();
  let t = 0, stood = 0, moved0 = null, red = 0, lastLine = null, handed = null, hud = 0;
  Object.assign(out, { deep: 0, stoodMax: 0, vmax: 0, setOff: null, blocked: 0 });
  let touch = null; // (the car it is against, and whether it drove into it: that car all but standing when they met)
  for (; t < limit && g.pilot(); t += 0.25) {
    g.advance(0.25);
    let o = g.pilot();
    // (a road that will not clear: it has said so and handed the car back. The check goes on from the next landmark,
    // twice at most, with seven minutes more each time)
    if (!o && g.pilotEnd() === 'blocked' && out.blocked < 2) {
      out.blocked++; out.log.push(`${t}s handed back at a blocked road (${st.x.toFixed(0)},${st.y.toFixed(0)}); on from the next landmark`);
      hop(out.blocked);
      if (g.player.mode !== 'car' || pick()) break;
      limit += 420; stood = 0; lastLine = null; touch = null;
      o = g.pilot();
    }
    if (!o) break;
    const d = o.drv.st;
    out.vmax = Math.max(out.vmax, st.speed);
    if (out.setOff == null && st.speed > 1.5) out.setOff = t;
    if (!o.join) {
      const dp = depth();
      if (dp > Math.max(out.deep, out.deepStood || 0) + 0.05) { // (which car, and what each was doing)
        const near = A.C.filter(q => q.line >= 0 && Math.hypot(q.x - st.x, q.y - st.y) < q.half + c.C.half + 1).map(q => `car ${A.C.indexOf(q)} ${Math.hypot(q.x - st.x, q.y - st.y).toFixed(1)} m off, turned ${(Math.atan2(Math.sin(q.h - st.h), Math.cos(q.h - st.h))).toFixed(2)}, v ${q.v.toFixed(1)}, ${q.why}${q.youBy ? ` (${q.youBy})` : ''}${q.mv ? ' in a junction' : ''}${q.rev ? ' reversing' : ''}${q.bus ? ' bus' : ''}`).join('; ');
        out.log.push(`${t}s ${dp.toFixed(2)} m into: ${near} | it: v ${d.v.toFixed(1)} ${d.why || ''} wedged ${(d.wedged || 0).toFixed(1)} solid ${o.drv.opts && o.drv.opts.solid ? o.drv.opts.solid(d.x, d.y, d.z, d.h).toFixed(2) : "none"} off ${Math.hypot(st.x - d.x, st.y - d.y).toFixed(2)} pass ${d.pass.toFixed(1)} shift ${d.shift.toFixed(1)}${d.mv ? ' in a junction' : ''}${o.turn ? ' turning round' : ''}`);
      }
      // (its own doing when it was moving and the car it met all but stood; a car that drove into it, pulling out
      // of a junction across its bows or coming at it where it stood, is noted apart)
      if (dp < 0.02) touch = null;
      else if (!touch) { const q = A.C.filter(q => q.line >= 0).sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y))[0]; touch = { mine: st.speed > 0.2 && (!q || q.v < 0.5) }; }
      if (touch && touch.mine) out.deep = Math.max(out.deep, dp); else out.deepStood = Math.max(out.deepStood || 0, dp);
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
      out.log.push(`${t}s STOOD ${stood.toFixed(0)} s: ${d.why} held ${(d.held || 0).toFixed(0)} q ${!!d.q} xMutual ${!!d.xMutual} ${d.mv ? `in j${d.mv.j.id}` : d.lineAt ? `at j${d.lineAt.j.id} (${d.junction || ''}) light ${g.junctions.light(d.lineAt, d.lineEx)}` : ''} turn ${o.turnNo || (o.turn ? 'turning' : '')} jam ${(o.jamT || 0).toFixed(0)} s${o.unjammed ? `, asked out:${o.unjammed}` : ''} | ${ch.join(' < ') || 'no block'}`);
    }
    if (log && t % 5 === 0) out.log.push(`${t}s s=${d.s.toFixed(0)}/${o.drv.path.len.toFixed(0)} v=${st.speed.toFixed(1)} ${o.join ? 'joining' : d.why || ''} ${o.hud ? `[${o.hud.turn} · ${Math.round(o.hud.eta)} s]` : ''} film ${o.film.name}`);
    // the handback: a touch of the wheel, once it is well under way
    // (where the car's body has room, and the next 6 m ahead of it: a few streets pinch narrower than a car where a landmark's fine walls stand
    // into them, which the road's width pass does not see; the autopilot passes on its line, a car you drive does not)
    const fits = () => { const fx = Math.sin(st.h), fy = Math.cos(st.h); for (const k of [c.C.half - c.C.hw, 0, c.C.hw - c.C.half, 2, 4, 6]) { const x = st.x + fx * k, y = st.y + fy * k, q = g.nav.push(x, y, st.z, c.C.hw + 0.04, 1.6); if (Math.hypot(q.x - x, q.y - y) > 0.02) return false; } return true; };
    if (!handed && !o.join && st.speed > 4 && t > 6 && !d.mv && fits()) {
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
  Object.assign(out, { t, arrived: !o && g.pilotEnd() === 'arrived', mode: g.player.mode, v: st.speed, d: Math.hypot(st.x - end0.x, st.y - end0.y), red, handed, hud, shots: [...shots] });
  if (o) { out.left = o.drv.remaining(); out.why = o.drv.st.why || ''; g.pilotOff(); } else if (!out.arrived) { out.left = Math.hypot(st.x - end0.x, st.y - end0.y); out.why = `handed back (${g.pilotEnd() || 'the wheel'})`; }
  return out;
}
// the checks on what autopilotStep returns, as [ok, what] pairs
function autopilotChecks(r) {
  if (r.none) return [[r.none === 'no car', `the autopilot: ${r.none}`]];
  const h = r.handed, km = m => `${(m / 1000).toFixed(2)} km`;
  return [
    [r.setOff != null && r.setOff <= 20, `the autopilot takes your car to ${r.dest}, ${km(r.len)} by road with ${r.turns} turn${r.turns === 1 ? '' : 's'}, and sets off${r.setOff != null ? ` in ${r.setOff.toFixed(1)} s` : ': never'}${r.scenic ? ` (the scenic way ${km(r.scenic.len)}, ${Math.round(r.scenic.share * 100)}% by the water or the landmarks)` : ''}`],
    [r.hud >= 8 && r.shots.length >= 1, `its screen shows the time left, the distance and the next turn (${r.hud} readings), and the film runs (${r.shots.join(', ') || 'no shot'}: it cuts by the frames drawn, few in a check)`],
    [!!h && h.off && h.v1 > h.v0 * 0.7 && Math.abs(h.jump) < 0.6 && h.again, h ? `a touch of the wheel hands it back moving (${h.v0.toFixed(1)} to ${h.v1.toFixed(1)} m/s, a jump of ${h.jump.toFixed(2)} m), and it takes the car again${h.joined ? ' at once' : ' from off its line'}` : 'the handback: it was never under way to try'],
    [r.deep <= 0.15 && r.red === 0 && r.stoodMax <= 100, `it drives clear of the traffic (${r.deep.toFixed(2)} m into a car at most as it moves${r.deepStood > 0.15 ? `; a car of the traffic came ${r.deepStood.toFixed(2)} m into it` : ''}), over no red line (${r.red}), standing ${r.stoodMax.toFixed(0)} s at most${r.stoodMax > 20 ? ` (${r.stoodWhy})` : ''}, up to ${(r.vmax * 3.6).toFixed(0)} km/h`],
    [r.arrived && r.mode === 'car' && r.v < 0.5 && r.d < 40, r.arrived ? `it pulls in ${r.d.toFixed(0)} m from the end of its way after ${r.t.toFixed(0)} s, and the car is yours${r.blocked ? ` (${r.blocked} road${r.blocked > 1 ? 's' : ''} that would not clear handed back on the way, and gone on from the next landmark)` : ''}` : `it has not arrived after ${r.t.toFixed(0)} s: ${r.left.toFixed(0)} m to go, ${r.why}`],
  ];
}
// The driver assists (#355, game.js assistStep): lane keeping and adaptive cruise when you drive yourself.
// assistStep runs in the page: the autopilot brings the car up to speed in its lane on the way to a place and is
// switched off; with both assists on and no key held, for 40 s of the game's clock (up to 120 s when it has not gone 150 m) the car must hold its lane
// (lane keeping at work for 5 s or more, and in its lane, within 1.2 m of the lane's middle, once it has settled: 3 s after it
// takes hold or the road changes at a junction), keep to the
// speed set, stay out of the traffic and behind every red line; then a touch of the brake must end the cruise.
async function assistStep({ log = false, fresh = true } = {}) {
  const g = window.__game, c = g.myCar && g.myCar();
  if (!c || !g.assistToggle) return { none: 'no car' };
  const A = g.cars, st = c.D.st, out = { log: [] };
  const seat = () => { // (as autopilotStep's)
    for (let t = 0; t < 400 && g.player.mode === 'ride'; t++) { g.leaveRide(); g.advance(0.5); } // (a ride on its way lets you out when it next stops)
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
  // (from the kerb by the map's first landmark, as the autopilot's check starts)
  if (fresh && g.landmarks && g.landmarks[0] && g.travelTo && g.travelTo(g.landmarks[0])) { for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25); g.advance(8); if (g.player.mode !== 'car') seat(); }
  if (g.player.mode !== 'car') return { none: 'not at the wheel after travelling to a landmark' };
  const getGoing = () => {
    // up to speed, in its lane (as lane keeping reads it), clear of a junction: towards each place offered in turn, a minute each (after 30 s
    // a shorter clear stretch will do: lanes with a junction every 50 m)
    let up = false, tried = 0, t = 0;
    for (const d of g.destinations(st.x, st.y).filter(d => d.id !== 'car')) {
      if (tried >= 3) break;
      if (!(g.pilotTo(d, { quiet: true }) && g.pilot().len > 200)) { g.pilotOff(); continue; }
      tried++;
      for (t = 0; t < 60 && g.pilot(); t += 0.25) { g.advance(0.25); const o = g.pilot(), q = o && o.drv.st; if (q && !o.join && st.speed > (t < 30 ? 4 : 3) && !q.mv && !(q.toLine < (t < 30 ? 30 : 12)) && Math.abs(q.shift) < 0.1 && o.drv.remaining() > (t < 30 ? 120 : 60) && (() => { const L = g.laneHere(st); if (!L || Math.abs(L.d) >= 0.8 || Math.abs(L.dh) >= 0.3) return false;
        // (and no wall across the way 60 m on: a street shut off at its end, where lane keeping goes straight on)
        // (along the way it is driving, not straight ahead: a winding street meets a facade at every bend)
        const P = o.drv.path, at = {};
        // (and on the one road for the next 40 m of its way: lane keeping lets go at a junction, as a car's own does, and
        // a map of short pieces, Tetsugaku's, left it seconds of lane at a time)
        for (let a = 5; a <= 40; a += 5) { P.at(Math.min(P.len, q.s + a), at); const n = g.roadNet.nearest(at.x, at.y, 3, st.z, 2.5); if (!n || n.line !== L.line) return false; }
        // (nor a bend on it sharper than lane keeping steers, under a 14 m radius: there it lets go, as a car's own does, and
        // the car with no hand on the wheel runs on into the wall; Tetsugaku's S-bend on road 192)
        { const b = {}, c2 = {}; for (let a = 0; a <= 40; a += 2) { P.at(Math.min(P.len, q.s + a), b); P.at(Math.min(P.len, q.s + a + 4), c2); const h1 = Math.atan2(c2.x - b.x, c2.y - b.y); if (a > 0 && Math.abs(Math.atan2(Math.sin(h1 - b.h0), Math.cos(h1 - b.h0))) / 2 > 0.07) return false; b.h0 = h1; at.h0 = h1; } }
        for (let a = 3; a < 60; a += 2) { P.at(Math.min(P.len, q.s + a), at); const w = g.nav.push(at.x, at.y, st.z, 0.3, 1.6); if (Math.hypot(w.x - at.x, w.y - at.y) > 0.01) return false; }
        // (and straight ahead for 25 m, where lane keeping goes on as the way turns: a street shut off at its end, Kyoto)
        const fx = Math.sin(st.h), fy = Math.cos(st.h);
        for (let a = 3; a < 25; a += 2) { const x = st.x + fx * a, y = st.y + fy * a, w = g.nav.push(x, y, st.z, 0.3, 1.6); if (Math.hypot(w.x - x, w.y - y) > 0.01) return false; }
        return true; })()) { up = true; break; } }
      if (up) break;
      g.pilotOff();
    }
    if (!tried) return 'no place to drive towards';
    if (!up) { g.pilotOff(); return 'the car never got up to speed on a clear stretch'; }
    // handed over where your car rolls on by itself for a second: a wall on a narrow street can stand into the lane
    // its driver follows (the autopilot's car goes by it on the lane's line; the car that you drive meets it). If it
    // stops, the autopilot takes it on 60 m and hands it over again, four times at most
    out.walls = out.walls || 0;
    for (let k = 0; ; k++) {
      const o = g.pilot(), dest = o && o.dest;
      g.pilotOff();
      const v0 = st.speed;
      for (let i = 0; i < 4; i++) g.advance(0.25);
      if (st.speed > v0 * 0.6 || k >= 4 || !dest) break;
      out.walls++;
      if (!g.pilotTo(dest, { quiet: true })) break;
      for (let i = 0; i < 160 && g.pilot() && (g.pilot().join || g.pilot().drv.st.s < 60 || st.speed < 3); i++) g.advance(0.25);
      if (!g.pilot()) break;
    }
    return null;
  };
  { const no = getGoing(); if (no) return { none: no }; }
  if (!g.assist.lane) g.assistToggle('lane');
  if (!g.assist.cruise) g.assistToggle('cruise');
  Object.assign(out, { set: g.assist.set, off: 0, laneT: 0, cruiseT: 0, over: 0, deep: 0, red: 0, stops: 0, vmin: st.speed, dist: 0 });
  let last = null, x0 = st.x, y0 = st.y, stopped = false, settle = 3, lineWas = null, offWas = null;
  let offRoad = 0;
  let t = 0, stuck = 0;
  out.stretches = 1;
  for (; t < 40 + 40 * (out.stretches - 1) || (out.dist < 150 && t < 120); t += 0.1) { // (40 s, and on up to two minutes if it has stood in a queue most of them)
    g.advance(0.1);
    const L = g.assist.here;
    // (stood 6 s with no red line ahead and no car ahead to wait for, or a wall across the way: where it should stop,
    // on a street that ends, or one that pinches narrower than the car. Lane keeping is judged on another stretch,
    // the autopilot taking the car there, three stretches at most)
    stuck = st.speed < 0.3 && g.assist.line == null && (g.assist.wall != null || !g.assist.lead || g.assist.lead.gap > 6) ? stuck + 0.1 : 0;
    if (stuck > 5 && out.stretches < 3) {
      stuck = 0; out.stretches++;
      out.log.push(`${t.toFixed(1)}s stood at ${st.x.toFixed(0)},${st.y.toFixed(0)} (${g.assist.wall != null ? 'a wall' : 'nothing seen'}): on to another stretch`);
      if (g.assist.lane) g.assistToggle('lane');
      if (g.assist.cruise) g.assistToggle('cruise');
      // (backed out first, a car's length, so the autopilot can join its lane)
      for (let i = 0; i < 12; i++) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's' })); g.advance(0.25); }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's' }));
      // (and with no clear stretch to be had from where it stood: from the next landmark's kerb)
      if (getGoing()) {
        const lm = g.landmarks && g.landmarks[out.stretches % g.landmarks.length];
        if (!lm || !g.travelTo(lm)) break;
        for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
        g.advance(8);
        if (g.player.mode !== 'car' || getGoing()) break;
      }
      if (!g.assist.lane) g.assistToggle('lane');
      if (!g.assist.cruise) g.assistToggle('cruise');
      x0 = st.x; y0 = st.y; last = null; settle = 3; lineWas = null; offWas = null; offRoad = 0;
      continue;
    }
    // (off the end of the roads it can read, 2 s: lane keeping, as a car's own, follows the lane and not a route, and
    // goes straight on where a street ends at a junction. The window ends there, once it has worked 10 s and the
    // cruise 20 s)
    offRoad = L ? 0 : offRoad + 0.1;
    if (offRoad > 2 && out.laneT >= 10 && out.cruiseT >= 20) { out.ended = `off the mapped road at ${st.x.toFixed(0)},${st.y.toFixed(0)}`; break; }
    // (settled: 3 s after it takes hold, and after the road it reads changes at a junction, where the lane's middle steps)
    if (!g.assist.on.lane || !L || L.line !== lineWas || (L.off != null && offWas != null && Math.abs(L.off - offWas) > 0.3)) settle = 3; // (and where the line it keeps steps nearer the middle of a narrowed street, or back)
    lineWas = L ? L.line : null; offWas = L ? L.off : null; settle -= 0.1;
    if (g.assist.on.lane && L) { out.laneT += 0.1; if (settle <= 2) out.offAny = Math.max(out.offAny || 0, Math.abs(L.d)); if (settle <= 0) { out.heldT = (out.heldT || 0) + 0.1; out.off = Math.max(out.off, Math.abs(L.d)); } }
    if (g.assist.on.cruise) { out.cruiseT += 0.1; out.over = Math.max(out.over, st.speed - g.assist.set); }
    out.deep = Math.max(out.deep, A.footprint(st.x, st.y, st.z, st.h, c.C.half * 0.95, c.C.hw * 0.95, 0));
    out.vmin = Math.min(out.vmin, st.speed);
    out.dist += Math.hypot(st.x - x0, st.y - y0); x0 = st.x; y0 = st.y;
    if (st.speed < 0.3 && !stopped) { stopped = true; out.stops++; out.log.push(`${t.toFixed(1)}s stopped: ${g.assist.wall != null ? `a wall ${g.assist.wall.toFixed(1)} m ahead` : g.assist.line != null ? `a red line ${g.assist.line.toFixed(1)} m ahead` : g.assist.lead ? `a car ${g.assist.lead.gap.toFixed(1)} m ahead` : 'nothing seen'}`); } else if (st.speed > 1) stopped = false;
    // over a stop line on red
    const a = L && g.junctions.armAt(L.line, L.dir > 0 ? 1 : 0), d = a && a.j.sig ? (L.dir > 0 ? L.len - L.s : L.s) - a.back : null;
    if (last && a && last.a === a && last.d > 0.5 && d <= -1 && g.junctions.light(a) === 'r') { out.red++; out.log.push(`${t.toFixed(1)}s over the line of junction ${a.j.id} on red`); }
    last = d != null ? { a, d } : null;
    if (log && Math.round(t * 10) % 20 === 0) out.log.push(`${t.toFixed(0)}s v=${st.speed.toFixed(1)} gear ${st.gear ?? ''} hb ${st.hand ?? st.handbrake ?? ''} brake ${st.brake ? 1 : 0} on ${g.assist.on.cruise ? 'cruise' : ''}/${g.assist.lane ? 'L' : ''}${g.assist.cruise ? 'C' : ''} set ${(+g.assist.set || 0).toFixed(1)} mode ${g.player.mode} at ${st.x.toFixed(0)},${st.y.toFixed(0)},${st.z.toFixed(1)} h ${st.h.toFixed(2)} L ${L ? `${L.line} d ${L.d.toFixed(2)} dh ${L.dh.toFixed(2)}` : 'none'} lane ${g.assist.on.lane ? (L ? L.d.toFixed(2) : '?') : 'off'} ${g.assist.line != null ? `line ${g.assist.line.toFixed(0)} m` : ''} ${g.assist.lead ? `lead ${g.assist.lead.gap.toFixed(0)} m v ${g.assist.lead.v.toFixed(1)}` : ''}`);
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
    [r.laneT >= 5 && r.off <= 1.2 && r.offAny <= 2.6, `lane keeping holds the lane with no hand on the wheel (${r.laneT.toFixed(0)} s at work over ${r.dist.toFixed(0)} m; once settled, ${r.off.toFixed(2)} m off the lane's middle at most in ${(r.heldT || 0).toFixed(0)} s${r.stretches > 1 ? `, over ${r.stretches} stretches` : ''}${r.ended ? `; ended ${r.ended}` : ''}${r.walls ? `; handed over again ${r.walls} time${r.walls > 1 ? 's' : ''} where a wall stood into the lane` : ''})`],
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
  let puffs = 0; // (the most in the air at once through the run: at any one moment no car may be going fast near the eye)
  const run = secs => { let v = 0, n = 0, near = 0; for (let t = 0; t < secs; t += 0.5) { g.advance(0.5); if (C.sprayState && C.sprayState()) puffs = Math.max(puffs, C.sprayState().live || 0); for (const c of A.C) if (c.line >= 0 && !c.park && c.v > 4) { v += c.v / (g.roadNet.L[c.line].v || 11); n++; if (Math.hypot(c.x - g.player.x, c.y - g.player.y) < 60) near++; } } return { v: n ? v / n : 0, n, near }; };
  W.set('clear', { now: true }); g.advance(6);
  const dry = run(25), d0 = { pace: X.pace, lamps: X.lamps };
  W.set('rain', { now: true }); g.advance(6);
  const wet = run(25), sp = C.sprayState && C.sprayState();
  const out = { dry: dry.v, wet: wet.v, n: Math.min(dry.n, wet.n), near: wet.near, pace: X.pace, headway: X.headway, grip: X.grip, lamps: X.lamps, dryPace: d0.pace, dryLamps: d0.lamps, spray: Math.max(puffs, sp ? sp.live : 0), night: g.U ? g.U.uNight.value : null };
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
        // (not one already there when the check laid the crossing down under it)
        if (st === 3 && !(tag === 'open' && t < 5)) { out.stoodOn++; if (out.log.length < 6) out.log.push(`${tag} ${t}s: car ${A.C.indexOf(c)} stood on the rails, ${c.why}${c.heldBy ? ` by ${c.heldBy}` : ''}`); }
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
  J.dropRail ? J.dropRail(X) : (() => { const on = J.midsOn(X.line); if (on) { const i = on.indexOf(X); if (i >= 0) on.splice(i, 1); } })();
  if (!J.dropRail) { const i = J.rails.indexOf(X); if (i >= 0) J.rails.splice(i, 1); }
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
// The kerb and the trips (#355, actors.js parkNow, trips.js): two minutes of the traffic round you. Cars must stand
// parked where the streets have room (when any street within reach has), none of them in a moving car's way (no
// car held 15 s or more behind a parked one), no moving car's body more than 0.15 m in a parked one's; and what
// went on is reported: the cars that pulled in and out, the buses' stops, the people on and off, the deliveries.
async function kerbStep() {
  const g = window.__game, A = g.cars, L = g.roadNet.L;
  if (!A.kerbLo) return { none: 'no kerb in this build' };
  const T = g.trips && g.trips(), out = { parkedMax: 0, held: 0, deep: 0, log: [], share: A.parkStats ? A.parkStats.share : null };
  const in0 = A.C.reduce((s, c) => s + (c.parkedIn || 0), 0), out0 = A.C.reduce((s, c) => s + (c.left || 0), 0), b0 = A.busStopped, on0 = g.crowd.boarded, off0 = g.crowd.alighted, d0 = A.deliveries;
  const heldT = new Map();
  for (let t = 0; t < 120; t += 0.5) {
    g.advance(0.5);
    let parked = 0;
    for (const c of A.C) {
      if (c.line < 0) continue;
      if (c.park) { parked++; continue; }
      const h = c.v < 0.3 && c.front && c.front.park ? (heldT.get(c) || 0) + 0.5 : 0;
      heldT.set(c, h);
      if (h > out.held) { out.held = h; out.heldWhy = `car ${A.C.indexOf(c)} ${c.why}${c.heldBy ? ` by ${c.heldBy}` : ''} behind parked car ${A.C.indexOf(c.front)} on a ${L[c.line].c} street`; }
      if (t % 2 === 0) { // (its body in a parked car's)
        for (const o of A.C) if (o.park && o.line >= 0 && Math.abs(o.x - c.x) < 7 && Math.abs(o.y - c.y) < 7) {
          const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = c.x - o.x, dy = c.y - o.y, cs = Math.abs(Math.sin(c.h - o.h)), cc = Math.abs(Math.cos(c.h - o.h));
          const ea = o.half + c.half * cc + c.hw * cs - Math.abs(dx * fx + dy * fy), eb = o.hw + c.hw * cc + c.half * cs - Math.abs(-dx * fy + dy * fx), d = Math.min(ea, eb);
          if (d > out.deep) { out.deep = d; out.deepWhy = `car ${A.C.indexOf(c)} (${c.why}, v ${c.v.toFixed(1)}) and parked car ${A.C.indexOf(o)}`; }
        }
      }
    }
    out.parkedMax = Math.max(out.parkedMax, parked);
  }
  const room = L.reduce((s, l, i) => s + (A.kerbLo(i) > 0 && Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y) < 500 ? l.len : 0), 0);
  return Object.assign(out, { room, trips: !!T, places: T ? T.places.length : 0, onTrip: A.C.filter(c => c.line >= 0 && c.trip >= 0).length, cars: A.C.filter(c => c.line >= 0).length,
    pulledIn: A.C.reduce((s, c) => s + (c.parkedIn || 0), 0) - in0, pulledOut: A.C.reduce((s, c) => s + (c.left || 0), 0) - out0,
    stops: A.busStops.size, buses: A.C.filter(c => c.bus && c.line >= 0).length, busStopped: A.busStopped - b0, on: g.crowd.boarded - on0, off: g.crowd.alighted - off0, deliveries: A.deliveries - d0 });
}
function kerbChecks(r) {
  if (r.none) return [[true, `the kerb: ${r.none}`]];
  return [
    [r.trips && r.places >= 2 && r.onTrip > r.cars * 0.3, `the traffic has somewhere to go: ${r.onTrip} of ${r.cars} cars on a trip to one of ${r.places} places`],
    // (where few park at the kerb, Japan's 5% of the cars, none within 500 m in two minutes can be so: half a kilometre a car)
    [(r.room < 300 || r.parkedMax > 0 || (r.share != null && r.share < 0.1 && r.room < 2500)) && r.held < 15 && r.deep <= 0.15, `cars stand at the kerb (${r.parkedMax} at most, ${Math.round(r.room)} m of street with room within 500 m; ${r.pulledIn} pulled in and ${r.pulledOut} out in two minutes), out of the traffic's way (a car held ${r.held.toFixed(0)} s behind one at most${r.held >= 5 ? `: ${r.heldWhy}` : ''}; ${r.deep.toFixed(2)} m into one at most${r.deep > 0.15 ? `: ${r.deepWhy}` : ''})`],
    [true, `the buses' stops: ${r.stops} pieces of road with one, ${r.buses} buses, ${r.busStopped} stops made, ${r.on} people on and ${r.off} off; ${r.deliveries} van deliveries`],
  ];
}
module.exports = { autopilotStep, autopilotChecks, assistStep, assistChecks, wetStep, wetChecks, railStep, railChecks, kerbStep, kerbChecks };
