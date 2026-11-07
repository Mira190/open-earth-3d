// The watch behind tools/junction_held.js and game_check.js's "no movement left standing in a
// junction" step (#144, #150). heldStep runs in the page (page.evaluate(heldStep, { T, max })): it
// steps the game T seconds, a second at a time, and follows every movement in a signalled junction
// (junctions.js j.active) and every car stopped at a signalled junction's stop line. It returns
//   held    the movements whose car stood still in the junction longer than `max` of its cycles;
//   queues  the cars at a line through more than `max` greens of their own light (each green that
//           begins and ends with the car still there counts; one that moves on starts again);
// each with what holds it and every movement in its junction then; and apart, the ones of either
// kind held by your car, a ride or you in the road (`yours`), or behind a car at a wall (`walls`),
// and the movements standing behind a walker in the road or the queue for another junction's red
// (`beyond`: not this junction's doing).
function heldStep({ T, max, chain: process_chain = false }) {
  const g = window.__game, A = g.cars, C = A.C, JN = g.junctions, L = A.netL;
  const idx = new Map(C.map((c, i) => [c, i]));
  const at = c => c.line >= 0 && c.lineArm && c.lineArm.j.sig && c.lineArm.j.mid == null && c.toLine - c.half < 3 && c.v < 0.3;
  const W = new Map(); // car -> { a (its arm), on (its light green last second), greens, why: [] }
  // (where it is: along its piece, its lane, the line ahead and the lanes its way there goes from, its exit's line behind, the car in front)
  const detail = c => {
    const m = c.mv && c.mv.e.m, f = c.front;
    return ` [s ${c.s.toFixed(1)} of ${L[c.line].len.toFixed(1)} dir ${c.dir} lane ${c.ln || 0}${c.lineArm ? `, line of junction ${c.lineArm.j.id} arm ${c.lineArm.i} ${(c.toLine - c.half).toFixed(1)} m on, its way from lanes ${c.lineEx ? c.lineEx.lanes : '-'}` : ''}${m ? `, out by piece ${m.line} back ${m.back.toFixed(1)}, via ${c.mv.via}` : ''}${c.mv0 ? `, still leaving ${c.mv0.j.id}` : ''}${process_chain ? `, held ${(c.inHeld || 0).toFixed(1)} behind ${(c.behindT || 0).toFixed(1)} tangle ${(c.tangleT || 0).toFixed(1)} backoff ${(c.backoff || 0).toFixed(1)} revT ${c.revT || 0} stuck ${(c.stuck || 0).toFixed(1)} q ${c.q}` : ''}${f && f.line != null ? `; in front car ${idx.get(f)} ${f.why} v ${(f.v || 0).toFixed(1)} on piece ${f.line}` : f ? '; in front: yours' : ''}${root(c)}]`;
  };
  // (the head of the cars in front, and what holds it)
  const root = c => {
    let x = c, k = 0;
    while (x.front && x.front.line != null && k < 30 && x.why === 'car' || (x.why === 'held' && x.front && x.front.line != null && k < 30)) { x = x.front; k++; }
    if (x === c) return '';
    if (process_chain) { const P = []; for (let y = c, n = 0; y && y.line != null && n < 12; y = y.front, n++) P.push(`${idx.get(y)}:${y.line}/${y.dir}/${y.s.toFixed(0)}/${y.why}/q${y.q ? 1 : 0}/lo${(y.lo || 0).toFixed(1)}/off${(y.off || 0).toFixed(1)}`); return '; chain ' + P.join(' > '); }
    return `; at the head ${k} cars on, car ${idx.get(x)} ${x.why}${x.heldBy ? ' by ' + x.heldBy : ''} v ${(x.v || 0).toFixed(1)} on piece ${x.line}${x.lineArm ? ` at junction ${x.lineArm.j.id} arm ${x.lineArm.i} ${(x.toLine - x.half).toFixed(1)} m on (light ${JN.light(x.lineArm, x.lineEx)})` : ''}${x.mv ? `, in junction ${x.mv.j.id}` : ''}${x.mv0 ? ` and ${x.mv0.j.id}` : ''}`;
  };
  // (the nearest of the characters standing their ground, the NPCs, to a car held by someone not of the crowd)
  const nearNpc = c => { let b = null, bd = 8; for (const n of g.npcs || []) { const d = Math.hypot(n.x - c.x, n.y - c.y); if (d < bd) { bd = d; b = n; } } return b ? `; ${b.name || b.id} ${bd.toFixed(1)} m from it` : ''; };
  const mvDesc = (j, o, now) => {
    const c = o.c, a = j.arms[o.k];
    return `car ${idx.get(c)}${c.model && !/^Car_(Sedan|Taxi|Hatch|SUV)$/.test(c.model) ? ` (${c.model})` : ''} arm ${o.k}->${o.m & 15} lane ${o.m >> 4} in ${(now - o.t).toFixed(0)} s, v ${c.v.toFixed(1)} ${c.why}${c.heldBy ? ' by ' + c.heldBy : ''}${c.why === 'you' && c.youBy ? ` (${c.youBy})` : ''}${c.why === 'person' || c.heldBy === 'person' ? ` (${c.who >= 0 ? `walker ${c.who}, ${g.crowd.P[c.who].state} v ${g.crowd.P[c.who].v.toFixed(1)}` : `you or a character, ${Math.hypot(g.player.x - c.x, g.player.y - c.y).toFixed(0)} m from you${nearNpc(c)}`})` : ''}, on piece ${c.line}${c.line === a.line ? ` ${(c.toLine - c.half).toFixed(1)} m to its line` : ''}${c.mv && c.mv.j !== j ? `, headed for junction ${c.mv.j.id}` : ''}${o.forced ? ', forced over its line' : ''}${detail(c)}`;
  };
  // (held by you: your car or a ride stopped in the way, or you on foot in the road, at the head of the
  // cars in front: the game's doing, not the junction's, noted apart)
  const byYou = c => { for (let x = c, k = 0; x && x.line != null && k < 15; x = x.front, k++) if (x.why === 'you' || (x.why === 'person' && !(x.who >= 0)) || !idx.has(x)) return true; return false; }; // (a front not among the traffic's cars is your car or a ride: cars.extra)
  // (and a car at a wall across its way at the head: the roads' doing, traffic_check.js's walls)
  const byWall = c => { for (let x = c, k = 0; x && x.line != null && k < 15; x = x.front, k++) if (x.why === 'wall') return true; return false; };
  // (and, for a movement, the head of the cars in front of it held by something outside the junction:
  // a walker standing in the road, or the queue for another junction beyond: its red, or its own waiting)
  const head = c => { let x = c; for (let k = 0; k < 30 && x.front && x.front.line != null && (x.why === 'car' || x.why === 'held'); k++) x = x.front; return x; };
  const outside = (c, j) => { const h = head(c); return (h.why === 'person' && h.who >= 0) || (h.why === 'light' && h.lineArm && h.lineArm.j !== j && JN.light(h.lineArm, h.lineEx) !== 'g') || (h.why === 'zebra') ||
    (['room', 'stop', 'turn', 'cross', 'lane'].includes(h.why) && h.lineArm && h.lineArm.j !== j && h.toLine - h.half < 3); }; // (or waiting at another junction's line: spillback from beyond)
  const sort = (c, j, text) => {
    const any = f => f(c) || j.active.some(o => f(o.c)), mvt = text.startsWith('M');
    (any(byYou) ? yours : any(byWall) ? walls : mvt && outside(c, j) ? beyond : mvt ? held : queues).push(any(byYou) ? yoursAt(c) + ' ' + text.slice(1) : text.slice(1));
  };
  const yoursAt = c => { const out = []; const mc = g.myCar && g.myCar(), r = g.ride && g.ride();
    const st = o => (o.D ? o.D.st : o.drv ? o.drv.st : o);
    if (mc) { const q = st(mc); out.push(`your car ${Math.hypot(q.x - c.x, q.y - c.y).toFixed(0)} m off, v ${(q.v || 0).toFixed(1)}`); }
    if (r) { const q = r.drv.st; out.push(`a ride (${r.phase}) ${Math.hypot(q.x - c.x, q.y - c.y).toFixed(0)} m off, v ${(q.v || 0).toFixed(1)}`); }
    out.push(`you ${g.player.mode} ${Math.hypot(g.player.x - c.x, g.player.y - c.y).toFixed(0)} m off`);
    return ' {' + out.join(', ') + '}'; };
  let watched = 0, cleared = 0, cycles = 0;
  const held = [], queues = [], yours = [], walls = [], beyond = [], reported = new Set();
  // and a movement in a signalled junction whose car stands still in it longer than `max` of the
  // junction's cycles: one that never leaves (#150)
  const stillIn = new Map(), cycleOf = j => j.green[0] + j.green[1] + 2 * (j.amber + 2) + (j.scramble ? j.green[3] + (j.allred || 2) : 0); // (a scramble's walk too: a third turn in its cycle)
  // (and, #283: a car waiting at the mouth of a narrow stretch for one coming the other way, its longest wait; and
  // a scramble's kerbs whose count of those waiting there goes below none)
  const narrowT = new Map(), narrow = { max: 0, over: [] }, gates = { min: 0, at: '' };
  for (let s = 0; s < T; s++) {
    g.advance(1);
    const now = g.t();
    for (const c of C) {
      const n = c.line >= 0 && c.why === 'narrow' && c.v < 0.3 ? (narrowT.get(c) || 0) + 1 : 0;
      narrowT.set(c, n);
      if (n > narrow.max) narrow.max = n;
      if (n === 31 && narrow.over.length < 4) narrow.over.push(`car ${idx.get(c)} on piece ${c.line} (${L[c.line].c}) at ${c.x.toFixed(0)},${c.y.toFixed(0)}, for car ${idx.get(c.front)}: ${c.front ? `${c.front.why} v ${(c.front.v || 0).toFixed(1)}${c.front.q ? ' queueing' : ''} narrow ${(c.front.narrow || 0).toFixed(1)} in ${(c.front.narrowIn ?? NaN).toFixed(1)}` : ''}; its narrow ${(c.narrow || 0).toFixed(1)} in ${(c.narrowIn ?? NaN).toFixed(1)}`);
    }
    for (const pz of g.crowd.plazas || []) for (const h of pz.gates || []) if (h.n < gates.min) { gates.min = h.n; gates.at = `${pz.j ? `junction ${pz.j.id}` : 'a plaza'} kerb at ${h.x.toFixed(0)},${h.y.toFixed(0)}`; }
    const live = new Set();
    for (const j of JN.J) {
      if (!j.sig || j.mid != null) continue;
      for (const o of j.active) {
        live.add(o);
        const n = o.c.v < 0.3 ? (stillIn.get(o) || 0) + 1 : 0;
        stillIn.set(o, n);
        if (n > max * cycleOf(j) && !reported.has(o)) {
          reported.add(o);
          sort(o.c, j, `Mjunction ${j.id}: a movement stands in it ${n} s, over ${max} cycles of ${cycleOf(j).toFixed(0)} s: ${mvDesc(j, o, now)}; the others in it: ${j.active.filter(x => x !== o).map(x => mvDesc(j, x, now)).join('; ') || 'none'}`);
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
        sort(c, j, `Qjunction ${j.id} arm ${c.lineArm.i} (piece ${c.line}, ${L[c.line].c}): car ${idx.get(c)} at its line through ${w.greens} greens, held by ${Object.entries(by).map(([k, n]) => `${k} ${n} s`).join(', ')}; in the junction: ${j.active.map(o => mvDesc(j, o, now)).join('; ') || 'nothing'}; waiting: ${j.pend.map(o => `car ${idx.get(o.c)} arm ${o.k}->${o.m & 15} ${(now - o.since).toFixed(0)} s`).join(', ') || 'none'}`);
      }
    }
  }
  return { watched, cleared, cycles, held, queues, yours, walls, beyond, narrow, gates };
}
module.exports = { heldStep };
