// The autopilot of your own car, shared by every city's game: what a self-driving car adds to the
// chauffeur who already drives the taxis and the rides (cars.js chauffeur: a route over the street
// network, the lane, the bends, the queues, the junctions and their lights).
//
// - turns: the manoeuvres along a route, for the "next turn" a navigator shows.
// - scenic: a weight for every piece of road, so that a route asked for as scenic prefers the
//   waterfront and the streets by the landmarks (cars.js router, weight).
// - join: the wheel and the pedals that bring the car from wherever it stands onto the route's lane,
//   through the car's own physics, before the chauffeur takes it on.
// - film: the camera while it drives, cut as a car film is: behind, a front quarter, a crane, the side.
// - assist: the driver assists when you drive yourself: lane keeping and adaptive cruise (follow the
//   car ahead, stop at a red line).
//
// Nothing here draws, and nothing depends on the three.js version.
'use strict';
window.OEAutopilot = (function () {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // ------------------------------------------------------------ the next turn
  // The manoeuvres along a route (cars.js router.route) on its path P (cars.js path): at each junction on
  // the way, the heading 12 m after it against the heading 12 m before. Under 0.42 rad the road only
  // bends; over 2.5 it comes back the way it went. Returns [{ s, turn, sharp }] in the order driven
  // (turn: -1 left, 1 right, 2 a U-turn), with the end as { s, turn: 0, end: true }.
  function turns(route, P) {
    const out = [], a = {}, b = {};
    for (const nd of route.nodes || []) {
      const s = P.cum[Math.min(nd.k, P.cum.length - 1)];
      if (s < 4 || s > P.len - 4) continue;
      P.at(Math.max(0, s - 12), a); P.at(Math.min(P.len, s + 12), b);
      const d = angDiff(Math.atan2(b.hx, b.hy), Math.atan2(a.hx, a.hy));
      if (Math.abs(d) < 0.42) continue;
      const last = out[out.length - 1];
      // (two nodes of one corner, a junction drawn as a pair: one turn)
      if (last && s - last.s < 14 && Math.sign(d) === Math.sign(last.d)) { last.d += d; last.turn = Math.abs(last.d) > 2.5 ? 2 : Math.sign(last.d); continue; }
      out.push({ s, d, turn: Math.abs(d) > 2.5 ? 2 : Math.sign(d), sharp: Math.abs(d) > 1.9 });
    }
    out.push({ s: P.len, d: 0, turn: 0, end: true });
    return out;
  }
  // the next manoeuvre from s on, and how far off it is
  function nextTurn(list, s) {
    for (const t of list) if (t.s > s + 2 || t.end) return { turn: t.turn, end: !!t.end, sharp: !!t.sharp, dist: Math.max(0, t.s - s) };
    return null;
  }
  // as a navigator words it
  function turnText(n) {
    if (!n) return '';
    const d = n.dist < 950 ? `${Math.max(10, Math.round(n.dist / 10) * 10)} m` : `${(n.dist / 1000).toFixed(1)} km`;
    if (n.end) return `Arrive in ${d}`;
    return `${n.turn === 2 ? 'U-turn' : `${n.sharp ? 'Sharp ' : 'Turn '}${n.turn < 0 ? 'left' : 'right'}`} in ${d}`;
  }
  const turnGlyph = n => (!n ? '' : n.end ? '◎' : n.turn === 2 ? '↶' : n.turn < 0 ? '↰' : '↱');

  // ------------------------------------------------------------ the scenic way
  // A weight for each piece of road of net (actors.js network): 0.42 where water lies within 60 m of it
  // (a quay, a harbour road, a river bank), 0.55 within 110 m of a landmark (marks: [x, y]), 1 elsewhere.
  // The router multiplies a piece's cost by it, so a scenic route takes the waterfront while that is
  // less than about twice as far.
  function scenic(net, { water = null, marks = [] } = {}) {
    const L = net.L, w = new Float32Array(L.length).fill(1), q = {};
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!(l.len > 8)) continue;
      let wet = 0, seen = 0, n = 0;
      for (let s = Math.min(l.len / 2, 10); s < l.len; s += 40) {
        net.at(i, s, q); n++;
        if (water) for (let k = 0; k < 8 && !(wet > n - 1); k++) if (water(q.x + Math.sin(k * 0.785) * 60, q.y + Math.cos(k * 0.785) * 60) || water(q.x + Math.sin(k * 0.785) * 30, q.y + Math.cos(k * 0.785) * 30)) { wet++; break; }
        for (const m of marks) if (Math.abs(m[0] - q.x) < 110 && Math.hypot(m[0] - q.x, m[1] - q.y) < 110) { seen++; break; }
      }
      if (n && wet / n >= 0.5) w[i] = 0.42;
      else if (n && seen / n >= 0.5) w[i] = 0.55;
    }
    return w;
  }
  // how much of a route (its nodes' lines and its last) runs on weighted pieces, by length (for the checks and the words)
  function scenicShare(route, net, w) {
    let on = 0, all = 0;
    const lines = (route.nodes || []).map(nd => nd.line);
    if (route.to && route.to.line != null) lines.push(route.to.line);
    for (const li of lines) { const l = net.L[li].len; all += l; if (w[li] < 1) on += l; }
    return all ? on / all : 0;
  }

  // ------------------------------------------------------------ onto the lane
  // The nearest point of the driver's own line (cars.js chauffeur poseAt: the lane, the kerb at the start) to
  // the car at (x, y) heading h, from s0 on and within reach metres of it along the way:
  // { s, dist, dh (the car's heading against the line's there), x, y, h }
  function onLane(poseAt, len, x, y, h, s0 = 0, reach = 40) {
    const q = {};
    let best = null;
    for (let s = s0; s <= Math.min(len, s0 + reach); s += 1) {
      poseAt(s, q);
      const d = Math.hypot(x - q.x, y - q.y);
      if (!best || d < best.dist) { const lh = Math.atan2(q.hx, q.hy); best = { s, dist: d, dh: angDiff(h, lh), x: q.x, y: q.y, z: q.z, h: lh }; }
    }
    return best;
  }
  // The wheel and the pedals (cars.js drive: fwd, turn) that take the car at st onto that line from the
  // point at of it (onLane), by pure pursuit of a point ahead on it: 5 m ahead and a second of its speed.
  // It holds 4 m/s, less the more it has to turn, and stops for anything in front (blocked).
  function join(st, poseAt, len, at, blocked) {
    const q = {}, s = Math.min(len, at.s + 5 + Math.abs(st.v));
    poseAt(s, q);
    const dx = q.x - st.x, dy = q.y - st.y, err = angDiff(Math.atan2(dx, dy), st.h);
    const curv = 2 * Math.sin(err) / Math.max(2, Math.hypot(dx, dy)); // (pure pursuit: the arc through the point)
    const lock = 0.62 / (1 + Math.abs(st.v) / 13), turn = clamp(Math.atan(curv * 2.6) / lock, -1, 1);
    const want = blocked ? 0 : clamp(4.2 - 2.6 * Math.abs(err), 1.6, 4.2);
    const fwd = blocked ? (Math.abs(st.v) > 0.3 ? -0.8 : 0) : st.v < want - 0.3 ? 0.45 : st.v > want + 0.8 ? -0.3 : 0.12;
    return { fwd, turn };
  }

  // ------------------------------------------------------------ the film
  // The camera while the autopilot drives, as shots round the car on the chase camera's own rig (so it
  // stays out of walls as that does): where it sits round the car (yaw: 0 behind it, pi in front, looking
  // back at it), how far off and how high, each held a few seconds and drifting a little, then a cut.
  // With reduced motion: no drift, and no orbit.
  const SHOTS = [
    { name: 'behind', yaw: [0.06, -0.06], dist: 7.6, pitch: 0.17, t: 7 },
    { name: 'front quarter', yaw: [2.5, 2.82], dist: 8.6, pitch: 0.085, t: 7.5 },
    { name: 'crane', yaw: [0.34, 0.12], dist: 24, pitch: 0.6, t: 8 },
    { name: 'side', yaw: [-1.5, -1.22], dist: 9.5, pitch: 0.06, t: 7 },
    { name: 'rear quarter', yaw: [0.62, 0.36], dist: 6.2, pitch: 0.075, t: 6.5 },
    { name: 'orbit', yaw: [-2.7, -0.5], dist: 13, pitch: 0.3, t: 10, orbit: true },
  ];
  function film({ reduced = false } = {}) {
    const shots = reduced ? SHOTS.filter(s => !s.orbit) : SHOTS, F = { i: 0, t: 0, cut: true, name: shots[0].name, n: 0 };
    // dt on: { yaw (round the car, on its heading), dist, pitch, cut (this is the first frame of a shot) }
    F.step = dt => {
      let sh = shots[F.i];
      F.cut = F.n === 0;
      F.t += dt; F.n++;
      if (F.t > sh.t) { F.i = (F.i + 1) % shots.length; F.t = 0; F.cut = true; sh = shots[F.i]; F.name = sh.name; }
      const k = reduced ? 0.5 : F.t / sh.t, e = k * k * (3 - 2 * k);
      return { yaw: sh.yaw[0] + (sh.yaw[1] - sh.yaw[0]) * (sh.orbit ? k : e), dist: sh.dist, pitch: sh.pitch, cut: F.cut, name: sh.name };
    };
    return F;
  }

  // ------------------------------------------------------------ the assists
  // Lane keeping: the wheel (cars.js drive turn, -1..1) that holds the car at st in the lane of the road it
  // is on. lane: { d: how far it is to the right of the lane's middle (m), dh: its heading against the
  // lane's (rad), curv: the lane's curvature ahead (1/m, + to the right) }. A proportional pull on both,
  // with the bend fed forward, as a lane-centring assist does; hand: your own input (it is added to, not
  // replaced, and past half lock yours wins).
  function laneKeep(st, lane, hand = 0) {
    if (!lane || Math.abs(hand) > 0.5) return hand;
    const v = Math.max(2, Math.abs(st.v)), lock = 0.62 / (1 + v / 13);
    const curv = (lane.curv || 0) - 0.11 * lane.d / Math.max(1, v * 0.35) - 0.9 * lane.dh / Math.max(4, v * 0.8);
    const pull = clamp(Math.atan(curv * 2.6) / lock, -0.8, 0.8);
    return clamp(hand + pull * (1 - Math.abs(hand) * 2), -1, 1);
  }
  // Adaptive cruise: the pedal (cars.js drive fwd, -1..1) that holds the set speed, keeps a time gap
  // to the car ahead and stops at a line that is red. ahead: { gap (m, bumper to bumper), v } or null;
  // line: metres to a stop line it must stop at, or null. The Intelligent Driver Model's acceleration
  // (as the traffic's, actors.js), turned into a pedal. headway: s (1.4 dry; longer in the wet).
  function cruise(st, set, ahead, line, { headway = 1.4, amax = 2.4, b = 3.2 } = {}) {
    const v = Math.max(0, st.v);
    let acc = amax * (1 - Math.pow(v / Math.max(1, set), 4));
    const stopFor = (gap, dv) => { const s0 = 2.2, ss = s0 + Math.max(0, v * headway + v * dv / (2 * Math.sqrt(amax * b))); return -amax * (ss / Math.max(0.3, gap)) ** 2; };
    if (ahead) acc += stopFor(ahead.gap, v - ahead.v);
    if (line != null) acc = Math.min(acc, amax * (1 - Math.pow(v / Math.max(1, set), 4)) + stopFor(Math.max(0.3, line - 0.6), v));
    acc = clamp(acc, -9, amax);
    if ((ahead && ahead.gap < 2.6 && ahead.v < 0.5 || line != null && line < 1.2) && v < 0.6) return v > 0.05 ? -0.5 : 0; // (held at a stand)
    return acc >= 0 ? clamp(acc / 5.5 + 0.06, 0, 1) : clamp(acc / 9, -1, -0.02);
  }

  return { turns, nextTurn, turnText, turnGlyph, scenic, scenicShare, onLane, join, film, laneKeep, cruise, SHOTS };
})();
