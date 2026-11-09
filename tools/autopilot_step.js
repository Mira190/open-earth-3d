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
  if (g.ride && g.ride() && g.cancelRide) g.cancelRide();
  if (g.player.mode !== 'car') {
    const s = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3);
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
  }
  if (g.player.mode !== 'car') return { none: 'could not get into the car' };
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
module.exports = { autopilotStep, autopilotChecks };
