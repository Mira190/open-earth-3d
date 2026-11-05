// A queue at a red light for a ride to come up behind (#107), shared by tools/game_check.js and
// tools/ride_shot.js. findQueue runs in the page (pass its source to page.evaluate): it steps the game a
// second at a time, up to 3 minutes, until a signalled arm's light is red for at least 12 s more with a
// car stopped at its line and the cars behind it queueing (c.q), a straight run of road behind
// the tail, and a road on from the junction. It returns { h: the head of the queue, rt: a route from
// 32 m behind the tail through the junction and 35 m on } or null. skip: lines not to use; near:
// [x, y] to prefer a queue close to (within 250 m), as for a still.
function findQueue(g, skip = new Set(), near = null) {
  const L = g.roadNet.L, C = g.cars.C;
  for (let t = 0; t < 180; t += 1) {
    g.advance(1);
    const heads = C.filter(h => h.line >= 0 && !skip.has(h.line) && h.q && h.why === 'light' && h.v <= 0.1 && (!near || Math.hypot(h.x - near[0], h.y - near[1]) < 250));
    if (near) heads.sort((a, b) => Math.hypot(a.x - near[0], a.y - near[1]) - Math.hypot(b.x - near[0], b.y - near[1]));
    for (const h of heads) {
      const l = L[h.line], end = h.dir > 0 ? 1 : 0, n = l.pts.length / 3, arm = g.junctions.armAt(h.line, end);
      if (!arm || !arm.j.sig || arm.j.scramble || g.junctions.toGreen(arm) < 12) continue; // (red long enough for the ride to come up behind it and wait; not a scramble's, whose minute-long walk tools/scramble_step.js covers)
      const tail = C.filter(c => c.line === h.line && c.dir === h.dir && c.q && (c.s - h.s) * h.dir <= 0).reduce((m, c) => ((c.s - m.s) * h.dir < 0 ? c : m), h);
      const s0 = tail.s - h.dir * (tail.half + 32);
      if (s0 < 3 || s0 > l.len - 3) continue;
      const nx = l.pts[3 * (end ? n - 1 : 0)], ny = l.pts[3 * (end ? n - 1 : 0) + 1];
      for (let i = 0; i < L.length; i++) {
        if (i === h.line) continue;
        const m = L[i], mn = m.pts.length / 3;
        const at0 = Math.hypot(m.pts[0] - nx, m.pts[1] - ny) < 3, at1 = Math.hypot(m.pts[3 * mn - 3] - nx, m.pts[3 * mn - 2] - ny) < 3;
        if (!at0 && !at1) continue;
        const dir = at0 ? 1 : -1;
        if (m.ow && m.ow !== dir) continue;
        const d = Math.min(35, m.len / 2), rt = g.roads.route({ line: h.line, s: s0, dir: h.dir }, { line: i, s: at0 ? d : m.len - d, dir }, 600);
        if (rt && rt.len < (h.s - s0) * h.dir + 120) return { h, rt };
      }
    }
  }
  return null;
}
module.exports = { findQueue };
