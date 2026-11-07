// Backing out of a one-way street (#283): a car of the traffic, or a ride with you in it, that can't go on
// along a one-way street backs along its lane to the junction behind and takes another way out there.
// reverseStep runs in the page (page.evaluate(reverseStep, { ride })), once the game has started:
//   traffic  up to three cars of the traffic on one-way streets near you are asked to back out
//            (cars.reverse); each must end up on another piece of road, going on, within 60 s, never into
//            another car on the way (its body 0.1 m into one at most);
//   ride     (with ride: true, and a ride on the way to you or with you in it) the ride is put on a one-way
//            street near you and asked to turn round (__game.turnRide): it must back out, never into a car
//            of the traffic, onto another piece of road, and drive on from there.
// tools/game_check.js runs it; alone: GAME_TIME=10:00 xvfb-run -a node tools/reverse_probe.js shibuya
function reverseStep({ ride: tryRide = false } = {}) {
  const g = window.__game, A = g.cars, C = A.C, L = g.roadNet.L, out = { traffic: [], ride: null };
  // how deep a car's body is in the other cars of the traffic (its own taken out of the count)
  const depth = c => { const l = c.line; c.line = -1; const d = A.footprint(c.x, c.y, c.z, c.h, c.half * 0.95, c.hw * 0.95, 0); c.line = l; return d; };
  const px = g.player.x, py = g.player.y;
  if (!A.reverse) return { none: 'no reversing in this build' };
  const cand = C.filter(c => c.line >= 0 && L[c.line].ow && !c.mv && A.canReverse(c) && Math.hypot(c.x - px, c.y - py) < 300)
    .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
  const watch = [];
  for (const c of cand) {
    if (watch.length >= 3) break;
    const line = c.line;
    if (A.reverse(c)) watch.push({ c, id: C.indexOf(c), line, deep: 0, t: 0, done: false, gone: false, went: 0, x: c.x, y: c.y });
  }
  for (let t = 0; t < 60 && watch.some(w => !w.done && !w.gone); t += 0.1) {
    g.advance(0.1);
    for (const w of watch) {
      if (w.done || w.gone) continue;
      const c = w.c;
      if (c.line < 0 || Math.hypot(c.x - w.x, c.y - w.y) > 30) { w.gone = true; continue; } // (out of the traffic, come back elsewhere)
      w.went += Math.hypot(c.x - w.x, c.y - w.y); w.x = c.x; w.y = c.y;
      if (c.rev) w.deep = Math.max(w.deep, depth(c));
      w.t = t;
      if (!c.rev) { w.done = true; w.onto = c.line; w.why = c.why; }
    }
  }
  out.traffic = watch.map(w => ({ id: w.id, from: w.line, onto: w.onto ?? null, secs: +w.t.toFixed(1), deep: +w.deep.toFixed(2), done: w.done, gone: w.gone, went: +w.went.toFixed(1), still: w.c.rev ? `still reversing (waited ${w.c.rev.wait.toFixed(1)} s, ${w.c.rev.d.toFixed(1)} m back)` : '' }));
  if (!tryRide) return out;
  // the ride, put on a one-way street near you and asked to turn round
  const o = g.ride();
  if (!o || !o.drv || !(o.phase === 'driving' || o.phase === 'coming')) { out.ride = { none: `no ride under way (${o ? o.phase : 'none'})` }; return out; }
  const to = o.phase === 'coming' ? o.pickup : o.drv.st.route.to, opts = o.drv.opts;
  const lines = L.map((l, i) => i).filter(i => L[i].ow && L[i].len > 30 && !(g.roadNet.avoid && g.roadNet.avoid[i]))
    .map(i => { const l = L[i], k = L[i].ow > 0 ? 0 : l.pts.length / 3 - 1; return { i, d: Math.hypot(l.pts[3 * k] - px, l.pts[3 * k + 1] - py) }; })
    .filter(q => q.d < 600).sort((a, b) => a.d - b.d).slice(0, 40);
  const tried = {};
  for (const { i } of lines) {
    const l = L[i], dir = l.ow, s = dir > 0 ? Math.min(25, l.len - 6) : Math.max(6, l.len - 25);
    if (A.C.some(c => c.line === i)) continue; // (a street with no traffic on it: what it backs into is the junction's)
    const rt = g.roads.route({ line: i, s, dir }, to, 6000);
    if (!rt) continue;
    o.drv.leave();
    o.drv = window.OECars.chauffeur(o.C, rt, Object.assign({}, opts, { from: 'lane', v: 0 }));
    o.drv.opts = opts;
    o.sig = []; o.scr = []; o.qArms = [];
    o.drv.update(0.016, [], false, true);
    const said = g.turnRide();
    if (said !== 'turning' || !o.turn || !o.turn.rev) { tried[said] = (tried[said] || 0) + 1; continue; }
    const st0 = o.drv.st, r = { line: i, x: +st0.x.toFixed(0), y: +st0.y.toFixed(0), deep: 0, secs: 0, back: 0 };
    let bx = st0.x, by = st0.y;
    for (; r.secs < 90 && o.turn; r.secs += 0.1) {
      g.advance(0.1);
      const st = o.drv.st;
      if (st.v < 0) r.back += Math.hypot(st.x - bx, st.y - by);
      bx = st.x; by = st.y;
      r.deep = Math.max(r.deep, A.footprint(st.x, st.y, st.z, st.h, o.C.half * 0.9, o.C.hw * 0.9, 0));
    }
    r.done = !o.turn;
    const near = g.roadNet.nearest(o.drv.st.x, o.drv.st.y, 10, o.drv.st.z);
    r.onto = near ? near.line : null;
    let went = 0, qx = o.drv.st.x, qy = o.drv.st.y;
    for (let k = 0; k < 40 && went <= 10; k++) { g.advance(1); const q = o.drv.st; went += Math.hypot(q.x - qx, q.y - qy); qx = q.x; qy = q.y; }
    r.drove = +went.toFixed(1); r.secs = +r.secs.toFixed(1); r.back = +r.back.toFixed(1); r.deep = +r.deep.toFixed(2);
    out.ride = r;
    return out;
  }
  out.ride = { none: `no one-way street near you to back out of (${Object.entries(tried).map(([k, n]) => `${k} ${n}`).join(', ') || 'none tried'})` };
  return out;
}
module.exports = { reverseStep };
