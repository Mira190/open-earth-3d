// The scrambles (歩車分離: a pedestrian-only phase, every way at once, the diagonals too), for
// tools/game_check.js: at each scramble a city has (Shibuya's from scene landmarks.scramble, the
// others from game.scrambles), with the player stood at its kerb so that the crowd is there, run
// the signals through two cycles and watch, every half second:
//   - in its walk phase (3) every arm's light is red, its walk signals show the green figure, and
//     the crowd is out on the crosswalks, the diagonal too;
//   - in the traffic's phases (0 and 1) no walker steps out onto its carriageway, none is still
//     out there once the traffic's green has run 2 s; no car drives into the box while anyone is
//     out on it, or through it faster than a walk (one caught there edges out); none runs its red.
// "On the carriageway": the scramble's own crowd crossing between the kerbs (actors.js plazas),
// and a walker on a footway between a crossing's kerbs (junctions.js scrambleCrossings).
// Returns [{ at, checks: [[ok, what]], ... }] (an empty list where the city has no scramble).
// { all: true } watches every scramble the city has (tools/scramble_check.js); otherwise only its
// principal one, a landmark's (Shibuya's) or the one with the most crosswalks to wait at, to keep within tools/game_check.js's time.
const order = () => { const n = j => (j.mapped3 ? 100 : 0) + (j.plaza && j.plaza.gates ? j.plaza.gates.length : 0); return window.__game.junctions.J.filter(j => j.scramble).sort((a, b) => n(b) - n(a)); };
module.exports = async function scrambles(p, { all = false } = {}) {
  const n = await p.evaluate(`(${order})().length`);
  const res = [];
  for (let k = 0; k < (all ? n : Math.min(1, n)); k++) {
    res.push(await p.evaluate(([k, order]) => {
      const g = window.__game, JN = g.junctions, A = g.cars, C = g.crowd, H = JN.heads;
      const j = eval(`(${order})`)()[k];
      // stand on the pavement at one of its kerbs, so that its crowd gathers round
      const pz = j.plaza, G = pz && pz.gates ? pz.gates : [];
      const g0 = G[0], s = g0 ? g.nav.stand(g0.x + g0.ox * 4, g0.y + g0.oy * 4, g0.z + 1, { rMax: 4 }) : null;
      if (s) Object.assign(g.player, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, ground: true, vz: 0, speed: 0 });
      g.advance(2);
      const recs = [...C.crossings.byLine.entries()].flatMap(([fi, l]) => l.filter(x => x.at === j).map(x => ({ fi, s: x.s, kerb: x.kerb })));
      const onFoot = q => !q.pz && q.line >= 0 && recs.some(r => r.fi === q.line && Math.abs(q.s - r.s) < r.kerb - 1); // (more than 0.7 m out from the kerb)
      const between = (q, gt) => { const P2 = gt.partner, ex = P2.x - gt.x, ey = P2.y - gt.y, t = ((q.x - gt.x) * ex + (q.y - gt.y) * ey) / (ex * ex + ey * ey); return t > 0.04 && t < 0.96; };
      const onPlaza = q => q.pz === pz && q.ph === 'cross' && between(q, q.g);
      const diagonal = gt => { const ex = gt.partner.x - gt.x, ey = gt.partner.y - gt.y, t = Math.max(0, Math.min(1, ((j.x - gt.x) * ex + (j.y - gt.y) * ey) / (ex * ex + ey * ey))); return Math.hypot(gt.x + ex * t - j.x, gt.y + ey * t - j.y) < 6; };
      const diagonals = G.filter(diagonal).length / 2;
      const ins = j.arms.filter(a => a.in), s0 = A.stats(), was = new Map(), log = [], inBox = new Map();
      let walkPhase = 0, allRed = 0, figures = 0, peak = 0, peakDiag = 0, steppedOut = 0, lingering = 0, carsAmong = 0, wrongFigures = 0, cycles = 0, last = j.ph;
      const box = Math.max(10, j.reach * 0.55);
      // no signal pole or walk post stands on its crosswalks' stripes (about 8 m wide, a little past their ends)
      const onStripes = o => (j.walks || []).some(w => { const len = Math.hypot(w[2] - w[0], w[3] - w[1]); if (len < 4) return false; const ux = (w[2] - w[0]) / len, uy = (w[3] - w[1]) / len, t = (o.x - w[0]) * ux + (o.y - w[1]) * uy; return t > 0 && t < len && Math.abs((o.x - w[0]) * uy - (o.y - w[1]) * ux) < 4; });
      const poles = H ? [...H.list, ...H.peds].filter(o => o.a.j === j && onStripes(o)).map(o => `${o.x.toFixed(1)},${o.y.toFixed(1)}`) : [];
      // and those waiting at its kerbs stand still: each one's own heading and place against where it was 3 s before (six looks
      // back), once it has stood there 4.5 s: turned more than 30 degrees, or moved more than half a metre, it fidgets. (Measured
      // from one look to the next, half a second apart, every settling turn and shuffle counted, and the count went from 310 to
      // 987 between near-identical builds against a limit of a tenth, #317; over 3 s a walker that settles stands still)
      const stood = new Map(), BACK = 6;
      let waitLooks = 0, fidgets = 0, turnsF = 0, stepsF = 0;
      for (let t = 0; t < 2 * 4 * (j.green[0] + j.green[1] + j.green[3] + 3 * (j.amber + j.allred)); t++) {
        g.advance(0.5);
        if (last !== 3 && j.ph === 3) cycles++;
        last = j.ph;
        for (const q of C.P.slice(0, C.active)) {
          const w = stood.get(q);
          if (q.pz === pz && q.ph === 'wait' && w && w.n >= 3 + BACK) {
            waitLooks++;
            const b = w.past[0], tu = Math.abs(Math.atan2(Math.sin(q.h - b.h), Math.cos(q.h - b.h))) > 0.52, stp = Math.hypot(q.x - b.x, q.y - b.y) > 0.5;
            if (tu || stp) { fidgets++; if (tu) turnsF++; if (stp) stepsF++; }
          }
          if (q.pz === pz && q.ph === 'wait') { const past = w ? w.past : []; past.push({ h: q.h, x: q.x, y: q.y }); if (past.length > BACK) past.shift(); stood.set(q, { past, n: w ? w.n + 1 : 1 }); } else stood.delete(q); // (n: its looks waiting so far; the first second and a half, turning round to the road from the way it came, is arriving, not fidgeting)
        }
        const P = C.P.slice(0, C.active), out = P.filter(q => onPlaza(q) || onFoot(q));
        const shown = H && H.walkShown ? H.walkShown(j) : [];
        for (const q of out) if (!was.get(q) && j.ph !== 3) steppedOut++;
        was.clear(); for (const q of out) was.set(q, true);
        if (j.ph === 3 && j.st === 'g' && JN.walk(ins[0])) {
          walkPhase++;
          if (ins.every(a => JN.light(a) === 'r')) allRed++;
          if (shown.length && shown.every(v => v === 'g')) figures++;
          peak = Math.max(peak, out.length);
          peakDiag = Math.max(peakDiag, P.filter(q => onPlaza(q) && diagonal(q.g)).length);
        } else if (j.ph !== 3 && shown.some(v => v === 'g')) wrongFigures++;
        if ((j.ph === 0 || j.ph === 1) && !(j.ph === 0 && j.st === 'g' && j.t < 2)) lingering = Math.max(lingering, out.length);
        // (a car caught in the box, or across it when the walk began (its movement there given before), may edge out at a walking pace; none drives in, or through at speed)
        const among = out.length ? A.C.find(c => c.line >= 0 && Math.hypot(c.x - j.x, c.y - j.y) < box && (c.v > 2.5 || (c.v > 0.5 && inBox.has(c) === false && !(c.mv && c.mv.j === j)))) : null;
        const wasIn = among ? inBox.get(among) : null;
        for (const c of A.C) inBox.set(c, c.line >= 0 && Math.hypot(c.x - j.x, c.y - j.y) < box);
        if (among) { carsAmong++; if (log.length < 6) log.push(`a car ${wasIn ? 'in it' : 'driving in'} (${among.mv ? (among.mv.j === j ? 'across it' : 'across another junction') : 'on its way'}, ${among.why || ''}) at ${among.v.toFixed(1)} m/s ${Math.hypot(among.x - j.x, among.y - j.y).toFixed(0)} m from the middle, ${out.length} out, phase ${j.ph}${j.st} ${j.t.toFixed(1)} s`); }
        if ((j.ph === 0 || j.ph === 1) && out.length && log.length < 6 && !(j.ph === 0 && j.st === 'g' && j.t < 2)) log.push(`${out.length} out in phase ${j.ph}${j.st} ${j.t.toFixed(1)} s: ${out.map(q => { const c = A.C.filter(c => c.line >= 0).reduce((m, c) => (Math.hypot(c.x - q.x, c.y - q.y) < (m ? Math.hypot(m.x - q.x, m.y - q.y) : 9) ? c : m), null); return (q.pz ? `crossing ${q.ph}` : `on a footway at ${q.s.toFixed(1)} going ${q.dir}, ${q.v.toFixed(2)} m/s`) + (c ? ` (a car ${Math.hypot(c.x - q.x, c.y - q.y).toFixed(1)} m off at ${c.v.toFixed(1)} m/s, ${c.why || '-'}${q.pz ? `, ${q.cars && q.cars.includes(c) ? 'seen' : 'unseen'}, dz ${(c.z - q.z).toFixed(1)}, jam ${(q.jam || 0).toFixed(1)}, ${Math.hypot(q.T.x - q.x, q.T.y - q.y).toFixed(1)} m to go` : ''})` : ''); }).join('; ')}`);
      }
      const s1 = A.stats();
      return { at: [Math.round(j.x), Math.round(j.y)], crosswalks: G.length / 2, diagonals, walkPhase, allRed, figures, heads: H && H.walkShown ? H.walkShown(j).length : 0,
        peak, peakDiag, steppedOut, lingering, carsAmong, wrongFigures, cycles, red: s1.redRuns - s0.redRuns, log, poles, waitLooks, fidgets, turnsF, stepsF, crowd: pz ? C.P.slice(0, C.active).filter(q => q.pz === pz).length : 0 };
    }, [k, String(order)]));
  }
  return res.map(r => Object.assign(r, { checks: [
    [r.crosswalks >= 2 && r.cycles >= 2, `the scramble at ${r.at} runs its walk phase (${r.cycles} walks in two cycles; ${r.crosswalks} crosswalks, ${r.diagonals} diagonal)`],
    [r.walkPhase > 0 && r.allRed === r.walkPhase, `in its walk every arm's light is red (${r.allRed} of ${r.walkPhase} looks)`],
    [r.heads > 0 && r.figures === r.walkPhase && !r.wrongFigures, `its ${r.heads} walk signals show the green figure in the walk (${r.figures} of ${r.walkPhase}) and never in the traffic's turns (${r.wrongFigures})`],
    [r.peak >= Math.max(10, r.crowd * 0.5) && (!r.diagonals || r.peakDiag >= 3), `the crowd surges across (${r.peak} out at once of the ${r.crowd} gathered there, ${r.peakDiag} on the diagonals)`],
    [!r.steppedOut && !r.lingering, `no one steps out in the traffic's turns (${r.steppedOut}) or is still out on the road once its green has run 2 s (${r.lingering})${r.lingering ? ': ' + r.log.filter(l => !l.startsWith('a car')).join(' | ') : ''}`],
    [!r.carsAmong && !r.red, `no car drives into the box while anyone is out on it, or through it faster than a walk (${r.carsAmong} looks) or runs its red (${r.red})${r.carsAmong ? ': ' + r.log.filter(l => l.startsWith('a car')).join(' | ') : ''}`],
    [!r.poles.length, `no signal pole or walk post stands on its crosswalks' stripes${r.poles.length ? ': ' + r.poles.join(' | ') : ''}`],
    [r.fidgets <= Math.max(3, r.waitLooks * 0.1), `those waiting at its kerbs stand still (${r.fidgets} turns or steps in ${r.waitLooks} looks: ${r.turnsF} turns, ${r.stepsF} steps)`],
  ] }));
};
