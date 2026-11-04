// The watch behind tools/junction_held.js and game_check.js's "no queue held at a green" step (#144,
// #150). heldStep runs in the page (page.evaluate(heldStep, { T, max })): it steps the game T
// seconds, a second at a time, and follows every car stopped at a signalled junction's stop line.
// Each green of the car's own light (for its movement) that begins and ends with the car still
// there counts against it; a car that moves on, or leaves the line, starts again. It returns the
// cars held through more than `max` greens, each with what held it and every movement in its
// junction at the time.
function heldStep({ T, max }) {
  const g = window.__game, A = g.cars, C = A.C, JN = g.junctions, L = A.netL;
  const idx = new Map(C.map((c, i) => [c, i]));
  const at = c => c.line >= 0 && c.lineArm && c.lineArm.j.sig && c.lineArm.j.mid == null && c.toLine - c.half < 3 && c.v < 0.3;
  const W = new Map(); // car -> { a (its arm), on (its light green last second), greens, why: [] }
  const mvDesc = (j, o, now) => {
    const c = o.c, a = j.arms[o.k];
    return `car ${idx.get(c)} arm ${o.k}->${o.m & 15} lane ${o.m >> 4} in ${(now - o.t).toFixed(0)} s, v ${c.v.toFixed(1)} ${c.why}${c.heldBy ? ' by ' + c.heldBy : ''}, on piece ${c.line}${c.line === a.line ? ` ${(c.toLine - c.half).toFixed(1)} m to its line` : ''}${c.mv && c.mv.j !== j ? `, headed for junction ${c.mv.j.id}` : ''}${o.forced ? ', forced over its line' : ''}`;
  };
  let watched = 0, cleared = 0, cycles = 0;
  const held = [], reported = new Set();
  // and a movement in a signalled junction whose car stands still in it longer than `max` of the
  // junction's cycles: one that never leaves (#150)
  const stillIn = new Map(), cycleOf = j => j.green[0] + j.green[1] + 2 * (j.amber + 2);
  for (let s = 0; s < T; s++) {
    g.advance(1);
    const now = g.t();
    const live = new Set();
    for (const j of JN.J) {
      if (!j.sig || j.mid != null) continue;
      for (const o of j.active) {
        live.add(o);
        const n = o.c.v < 0.3 ? (stillIn.get(o) || 0) + 1 : 0;
        stillIn.set(o, n);
        if (n > max * cycleOf(j) && !reported.has(o)) {
          reported.add(o);
          held.push(`junction ${j.id}: a movement stands in it ${n} s, over ${max} cycles of ${cycleOf(j).toFixed(0)} s: ${mvDesc(j, o, now)}; the others in it: ${j.active.filter(x => x !== o).map(x => mvDesc(j, x, now)).join('; ') || 'none'}`);
        }
      }
    }
    for (const o of stillIn.keys()) if (!live.has(o)) stillIn.delete(o);
    for (const [c, w] of W) if (!at(c) || c.lineArm !== w.a) { W.delete(c); cleared++; }
    for (const c of C) {
      if (!at(c)) continue;
      let w = W.get(c);
      if (!w) { w = { a: c.lineArm, on: true, greens: 0, why: [] }; W.set(c, w); watched++; } // (a green it came up during doesn't count)
      const on = JN.light(c.lineArm, c.lineEx) === 'g';
      if (on) w.why.push(c.why);
      if (w.on && !on && w.why.length) { w.greens++; cycles++; w.whyLast = w.why.slice(); w.why.length = 0; }
      if (!on) w.why.length = 0;
      w.on = on;
      if (w.greens > max && !reported.has(c)) {
        reported.add(c);
        const j = c.lineArm.j, by = {};
        for (const y of w.whyLast) by[y] = (by[y] || 0) + 1;
        held.push(`junction ${j.id} arm ${c.lineArm.i} (piece ${c.line}, ${L[c.line].c}): car ${idx.get(c)} at its line through ${w.greens} greens, held by ${Object.entries(by).map(([k, n]) => `${k} ${n} s`).join(', ')}; in the junction: ${j.active.map(o => mvDesc(j, o, now)).join('; ') || 'nothing'}; waiting: ${j.pend.map(o => `car ${idx.get(o.c)} arm ${o.k}->${o.m & 15} ${(now - o.since).toFixed(0)} s`).join(', ') || 'none'}`);
      }
    }
  }
  return { watched, cleared, cycles, held };
}
module.exports = { heldStep };
