// Backing out of a one-way street (#283): a car of the traffic, or a ride with you in it, that can't go on
// along a one-way street backs along its lane to the junction behind and takes another way out there.
// reverseStep runs in the page (page.evaluate(reverseStep, { ride, stills })), once the game has started (stills: a
// still at three points as the ride backs out, through window.__still(name), which the caller exposes):
//   traffic  up to three cars of the traffic on one-way streets near you are asked to back out
//            (cars.reverse); each must end up on another piece of road, going on, within 90 s (150 s while still
//            moving, behind another backing out), never into
//            another car on the way (its body 0.1 m into one at most);
//   ride     (with ride: true; a ride is ordered and boarded if none is under way) the ride is put on a one-way
//            street near you and asked to turn round (__game.turnRide): it must back out, never into a car
//            of the traffic, onto another piece of road, and drive on from there.
// tools/game_check.js runs it; alone: GAME_TIME=10:00 xvfb-run -a node tools/reverse_probe.js shibuya
async function reverseStep({ ride: tryRide = false, stills = false } = {}) {
  const g = window.__game, A = g.cars, C = A.C, L = g.roadNet.L, out = { traffic: [], ride: null };
  // how deep a car's body is in the other cars of the traffic (its own taken out of the count)
  const depth = c => { const l = c.line; c.line = -1; const d = A.footprint(c.x, c.y, c.z, c.h, c.half * 0.95, c.hw * 0.95, 0); c.line = l; return d; };
  const px = g.player.x, py = g.player.y;
  if (!A.reverse) return { none: 'no reversing in this build' };
  // (as a jam leaves one: nothing on the move behind it on its street; in moving traffic it would wait on the cars
  // behind, and give up)
  const clearBehind = c => !C.some(o => {
    if (o === c || o.line < 0 || o.v <= 0.3) return false;
    if (o.line === c.line) return o.dir === c.dir && (c.s - o.s) * c.dir > 0;
    const fx = Math.sin(c.h), fy = Math.cos(c.h), dx = o.x - c.x, dy = o.y - c.y, a = dx * fx + dy * fy; // (or coming up behind it from the piece before, 25 m)
    return a < 0 && a > -25 && Math.abs(-dx * fy + dy * fx) < 5 && Math.sin(o.h) * fx + Math.cos(o.h) * fy > 0.5;
  });
  // (nor your own car or the ride the steps before left standing behind it: a car never backs into those and gives up at
  // once, which says nothing of the traffic; what stood where by this step changes with every step added before it)
  const mine = [g.myCar() && g.myCar().D.st, g.ride() && g.ride().drv.st].filter(Boolean);
  const mineBehind = c => mine.some(o => { const fx = Math.sin(c.h), fy = Math.cos(c.h), dx = o.x - c.x, dy = o.y - c.y, a = dx * fx + dy * fy; return a < 2 && a > -90 && Math.abs(-dx * fy + dy * fx) < 6; });
  // (up to three rounds of three: where every car of a round gives up for what stands behind it just then (your own
  // ride, a car held at a light), the next nearest streets are tried; one that backs out and goes on is what is asked)
  const watch = [];
  for (let round = 0; round < 3 && !watch.some(w => w.done); round++) {
    const cand = C.filter(c => c.line >= 0 && L[c.line].ow && !c.mv && !watch.some(w => w.line === c.line) && A.canReverse(c) && clearBehind(c) && !mineBehind(c) && Math.hypot(c.x - px, c.y - py) < 300)
      .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
    for (const c of cand) {
      if (watch.length >= 3 * (round + 1)) break;
      if (watch.some(w => w.line === c.line)) continue; // (one to a street: three of one queue each waited on the next)
      const line = c.line;
      if (A.reverse(c)) watch.push({ c, id: C.indexOf(c), line, deep: 0, t: 0, done: false, gone: false, went: 0, x: c.x, y: c.y });
    }
    // (90 s: it backs up to 80 m at a walking pace, and may wait up to 20 s at a time on the way for the junction behind)
    // (and on to 150 s for one still backing out that has moved in the last 20 s: behind another backing out of the same street,
    // waiting at the junction behind for room, it waits its turn)
    for (let t = 0; (t < 90 || (t < 150 && watch.some(w => !w.done && !w.gone && !w.gaveUp && t - (w.moved || 0) < 20))) && watch.some(w => !w.done && !w.gone && !w.gaveUp); t += 0.1) {
      const was = new Map(C.map(o => [o, [o.x, o.y, o.why, o.v]])); // (where each stood before the step: which of two moved into the other)
      g.advance(0.1);
      for (const w of watch) {
        if (w.done || w.gone || w.gaveUp) continue;
        const c = w.c;
        if (c.line < 0 || Math.hypot(c.x - w.x, c.y - w.y) > 30) { w.gone = true; continue; } // (out of the traffic, come back elsewhere)
        const step = Math.hypot(c.x - w.x, c.y - w.y);
        if (step > 0.01) w.moved = t;
        w.went += step; w.x = c.x; w.y = c.y;
        if (c.rev) { const d = depth(c); if (d > w.deep) { w.deep = d; const b = A.footBy; w.deepAt = `${(c.rev.boxT || 0) > 0 ? `waited ${c.rev.boxT.toFixed(1)} s at the box behind, ` : ''}${c.rev.d.toFixed(1)} m back, ${b ? `car ${C.indexOf(b)} ${b.why} v ${(+b.v || 0).toFixed(1)}${b.mv ? ' in junction ' + b.mv.j.id : ''}${b.rev ? ` reversing (d ${b.rev.d.toFixed(1)} wait ${b.rev.wait.toFixed(1)})` : ''}; it on ${c.line}/${c.dir} s ${c.s.toFixed(1)}, that on ${b.line}/${b.dir} s ${b.s.toFixed(1)}` : ''}${b && was.get(b) ? `; in that step it moved ${Math.hypot(c.x - was.get(c)[0], c.y - was.get(c)[1]).toFixed(2)} m, that ${Math.hypot(b.x - was.get(b)[0], b.y - was.get(b)[1]).toFixed(2)} m (was ${was.get(b)[2]} v ${(+was.get(b)[3] || 0).toFixed(1)}) [backing off ${(+b.backoff || 0).toFixed(2)} s more]` : ''}`; } }
        w.t = t;
        if (!c.rev) { w.done = c.line !== w.line; w.gaveUp = !w.done; if (w.gaveUp) w.still = `gave up: ${c.revEnd || '?'}`; w.onto = c.line; w.why = c.why; }
      }
    }
  }
  out.traffic = watch.map(w => ({ id: w.id, from: w.line, onto: w.onto ?? null, secs: +w.t.toFixed(1), deep: +w.deep.toFixed(2), deepAt: w.deepAt, done: w.done, gone: w.gone, gaveUp: !!w.gaveUp, went: +w.went.toFixed(1), still: w.still || (w.c.rev ? `still reversing (waited ${w.c.rev.wait.toFixed(1)} s, ${w.c.rev.d.toFixed(1)} m back)` : '') }));
  if (!tryRide) return out;
  // the ride, put on a one-way street near you and asked to turn round (one ordered and boarded first, as
  // game_check.js's turn step does, if none is under way)
  if (!(g.ride() && g.ride().drv && (g.ride().phase === 'driving' || g.ride().phase === 'coming'))) {
    for (let t = 0; t < 40 && g.player.mode === 'ride'; t++) { if (g.ride()) g.ride().hold = true; g.leaveRide(); g.advance(0.5); }
    if (g.ride() && g.ride().phase !== 'leaving') g.cancelRide();
    g.advance(2);
    const dest = g.destinations(g.player.x, g.player.y)[0];
    let r = null;
    for (let i = 0; dest && i < 4 && !r; i++) { if (g.orderRide(dest) && g.ride() && (g.ride().phase === 'coming' || g.ride().phase === 'waiting')) r = g.ride(); else g.advance(5); }
    for (let t = 0; r && t < 120 && r.phase === 'coming'; t++) g.advance(0.5);
    if (r && r.phase === 'waiting') {
      g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      if (g.dlg.open && g.dlg.hasChoices) g.dlg.choose(0);
      g.advance(3);
    }
  }
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
    const marks = stills && window.__still ? [0.35, 0.7, 0.95] : [];
    for (; r.secs < 90 && o.turn; r.secs += 0.1) {
      g.advance(0.1);
      if (marks.length && o.turn && o.turn.i >= o.turn.poses.length * marks[0]) { marks.shift(); if (g.cam.mode === 'cabin') g.cam.mode = 'chase'; g.advance(0.02); await window.__still(`reverse-${3 - marks.length}`); } // (with stills: from the chase camera, as it backs out)
      const st = o.drv.st;
      if (st.v < 0) r.back += Math.hypot(st.x - bx, st.y - by);
      bx = st.x; by = st.y;
      const dp = A.footprint(st.x, st.y, st.z, st.h, o.C.half * 0.9, o.C.hw * 0.9, 0);
      if (dp > r.deep) { r.deep = dp; const T = o.turn; r.deepAt = `${T ? `pose ${T.i} of ${T.poses.length}${T.poses[T.i] && T.poses[T.i].leg ? ' (backing along the street)' : ''}${T.again ? ', worked out again' : ''}` : 'driving on'}: ${C.filter(c => c.line >= 0 && Math.hypot(c.x - st.x, c.y - st.y) < c.half + o.C.half + 1).map(c => `car ${C.indexOf(c)} ${c.why} v ${c.v.toFixed(1)}${c.rev ? ' reversing' : ''}${c.mv ? ' in a junction' : ''}`).join('; ')}`; }
      // (what holds it, when it waits on the way: the cars within 8 m of where it goes next, for a failure's report)
      if (o.turn && o.turn.held > 2 && !r.heldBy) { const T = o.turn, nx = T.poses[Math.min(T.i + 1, T.poses.length - 1)]; r.heldBy = `at pose ${T.i} of ${T.poses.length}: ` + (C.filter(c => c.line >= 0 && Math.hypot(c.x - nx.x, c.y - nx.y) < 8).map(c => `car ${C.indexOf(c)} ${c.why} v ${c.v.toFixed(1)} on piece ${c.line}${c.mv ? ` in junction ${c.mv.j.id}` : ''}${c.youBy ? ` (${c.youBy})` : ''}, ${Math.hypot(c.x - nx.x, c.y - nx.y).toFixed(1)} m off`).join('; ') || 'no car near'); }
      // (and held half a minute: what each car near it is doing then, to tell a knot from a car that only waits on it)
      if (o.turn && o.turn.held > 30 && !r.heldLate) { const T = o.turn, nx = T.poses[Math.min(T.i + 1, T.poses.length - 1)], deg = a => Math.round(((a * 180 / Math.PI) % 360 + 540) % 360 - 180);
        r.heldLate = `pose ${T.i} of ${T.poses.length} (the gear changes at ${T.poses.map((q, k) => q.stop ? k : -1).filter(k => k >= 0).join(', ') || 'none'}), heading ${deg(nx.h)}°: ` + (C.filter(c => c.line >= 0 && Math.hypot(c.x - nx.x, c.y - nx.y) < 12).map(c => `car ${C.indexOf(c)} ${c.why}${c.heldBy ? ` by ${c.heldBy}` : ''} v ${c.v.toFixed(1)} heading ${deg(c.h)}° piece ${c.line} dir ${c.dir}${c.mv ? ` in junction ${c.mv.j.id} to piece ${c.mv.e ? c.mv.e.m.line : '?'}` : ''} front ${c.front ? (C.indexOf(c.front) >= 0 ? C.indexOf(c.front) : c.front.id || '?') : '-'} backoff ${(+c.backoff || 0).toFixed(1)} spent ${(+c.boSpent || 0).toFixed(1)}, ${Math.hypot(c.x - nx.x, c.y - nx.y).toFixed(1)} m off`).join('; ') || 'no car near'); }
    }
    r.done = !o.turn;
    const rf = o.drv.st.route && o.drv.st.route.from; // (the piece its new way sets out on: the nearest road to it can be the street it left, close by at the junction)
    r.onto = rf && rf.line != null ? rf.line : null;
    let went = 0, qx = o.drv.st.x, qy = o.drv.st.y;
    // (a minute at most: a scramble's walk and the queue at its line on the new way may hold it a while)
    for (let k = 0; k < 60 && went <= 10; k++) { g.advance(1); const q = o.drv.st; went += Math.hypot(q.x - qx, q.y - qy); qx = q.x; qy = q.y; }
    r.queued = went <= 10 && !!o.drv.st.block && (C.includes(o.drv.st.block) || C.includes(o.drv.st.block.of)) && o.drv.st.v < 0.5; // (on its new way, but in a queue behind a car of the traffic, or its stand-in as one stopped for good: the junction ahead's doing, not its backing out)
    r.drove = +went.toFixed(1); if (went <= 10) r.driveWhy = `${o.drv.st.why || ''} v ${o.drv.st.v.toFixed(1)}${o.drv.st.block ? (b => `, behind ${C.indexOf(b) >= 0 ? `car ${C.indexOf(b)} (${b.why})` : b.of && C.indexOf(b.of) >= 0 ? `car ${C.indexOf(b.of)} (${b.of.why}, as stopped for good)` : `${b.id || b.model || 'something'}${b.stay ? ' parked' : ''}${b.of ? ` of ${b.of.model || b.of.id || '?'}` : ''} v ${(+b.v || 0).toFixed(1)}`}`)(o.drv.st.block) : ''}`; r.secs = +r.secs.toFixed(1); r.back = +r.back.toFixed(1); r.deep = +r.deep.toFixed(2);
    out.ride = r;
    g.skipRide(); g.advance(6); g.leaveRide(); g.advance(1);
    return out;
  }
  out.ride = { none: `no one-way street near you to back out of (${Object.entries(tried).map(([k, n]) => `${k} ${n}`).join(', ') || 'none tried'})` };
  return out;
}
module.exports = { reverseStep };
