// The walk signals' calls (web/game/walkcalls.js), for tools/game_check.js. By day (12:00), heard
// from the middle of the city's principal scramble (the one tools/scramble_step.js watches) or,
// with none, of the signalled junction nearest the player, run the signals through a cycle:
//   - the country's calls play there in its walk, and (Japan's) none in the traffic's turns, and
//     none from a scramble's diagonals; the ticking kinds tick faster in the walk than on red;
//   - Japan's: both calls of a crosswalk's pair are heard (the near end and the far end answering);
//   - muted (the game's sound switch), nothing plays.
// Returns { none } in a city whose signals make no sound, or { kind, checks: [[ok, what]] }.
module.exports = async function walkCalls(p) {
  return p.evaluate(() => {
    const g = window.__game, W = g.walkCalls, JN = g.junctions, A = window.OEAudio;
    if (!W || !W.kind) return { none: true, country: g.G && g.G.country };
    if (!A.on) A.start(); // (an AudioContext may start suspended without a click: its nodes are made all the same)
    const wasMuted = A.muted, min0 = g.clock.min;
    A.setMuted(false);
    g.setClock(g.clock.y, g.clock.m, g.clock.d, 720);
    W.prepare(); // (each head's crosswalk and call)
    const peds = JN.heads ? JN.heads.peds : [];
    const scr = JN.J.filter(j => j.scramble && peds.some(o => o.a.j === j)).sort((a, b) => (b.mapped3 ? 100 : 0) + (b.plaza && b.plaza.gates ? b.plaza.gates.length : 0) - (a.mapped3 ? 100 : 0) - (a.plaza && a.plaza.gates ? a.plaza.gates.length : 0));
    const px = g.player.x, py = g.player.y;
    const j = scr[0] || JN.J.filter(q => q.sig && q.mid == null && peds.some(o => o.a.j === q)).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
    // (a map whose junctions have no signals, as Higashiyama's lanes: nowhere to listen, and nothing to hear)
    if (!j) { A.setMuted(wasMuted); return { kind: W.kind, noJunction: true, unsignalled: !JN.J.some(q => q.sig && q.mid == null) }; }
    const mine = peds.filter(o => o.a.j === j);
    // (Japan's heard from the middle; a ticking box from beside it, its own walk and red counted)
    const o0 = mine.find(o => !o.diag) || mine[0], tick = W.kind !== 'jp', at = tick ? o0 : j;
    const eye = { position: { x: at.x, y: (at.z || 0) + 1.6, z: -at.y } };
    const walking = () => JN.walk(o0.a) && j.st === 'g';
    const r = { kind: W.kind, at: [Math.round(j.x), Math.round(j.y)], scramble: !!j.scramble, heads: mine.length, diag: mine.filter(o => o.diag).length,
      walkT: 0, redT: 0, inWalk: 0, inRed: 0, fromDiag: 0, calls: {}, muted: 0, walks: 0 };
    W.tap = (call, o) => {
      if (o.a.j !== j || (tick && o !== o0)) return;
      if (o.diag) r.fromDiag++;
      r.calls[call] = (r.calls[call] || 0) + 1;
      if (JN.walk(o.a) && j.st === 'g') r.inWalk++; else r.inRed++;
    };
    let was = walking();
    for (let t = 0; t < 260 && r.walks < 2; t += 0.25) {
      g.advance(0.25);
      for (let k = 0; k < 5; k++) W.update(0.05, eye);
      const w = walking();
      if (w) r.walkT += 0.25; else r.redT += 0.25;
      if (w && !was) r.walks++;
      was = w;
    }
    // muted: through a walk, nothing
    const n0 = W.state().played;
    A.setMuted(true);
    for (let t = 0; t < 200 && !walking(); t += 0.5) g.advance(0.5);
    for (let t = 0; t < 6; t += 0.25) { g.advance(0.25); for (let k = 0; k < 5; k++) W.update(0.05, eye); }
    r.muted = W.state().played - n0;
    W.tap = null;
    A.setMuted(wasMuted);
    g.setClock(g.clock.y, g.clock.m, g.clock.d, min0);
    return r;
  }).then(r => {
    if (r.none) return r;
    if (r.noJunction && r.unsignalled) return Object.assign(r, { checks: [[true, `the walk signals' calls (${r.kind}): no junction with signals to listen at on this map`]] });
    if (r.noJunction) return Object.assign(r, { checks: [[false, `the walk signals' calls (${r.kind}) find a signalled junction to listen at`]] });
    const jp = r.kind === 'jp', list = Object.entries(r.calls).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
    const checks = [[r.walkT > 0 && r.inWalk >= Math.min(4, r.walkT / 2), `the walk signals' calls (${r.kind}) play at the ${r.scramble ? 'scramble' : 'junction'} at ${r.at} in its walk (${r.inWalk} in ${r.walkT.toFixed(0)} s of walk: ${list}; ${r.heads} heads)`]];
    if (jp) {
      checks.push([!r.inRed, `and none in the traffic's turns (${r.inRed} in ${r.redT.toFixed(0)} s)`]);
      checks.push([r.scramble ? ['piyo', 'piyopiyo', 'kakko', 'kakakko'].filter(c => r.calls[c]).length >= 3 : (r.calls.piyo && r.calls.piyopiyo) || (r.calls.kakko && r.calls.kakakko),
        `a crosswalk's two ends answer each other (${list})`]);
      if (r.scramble) checks.push([r.diag > 0 ? !r.fromDiag : true, `its ${r.diag} diagonal heads stay silent (${r.fromDiag})`]);
    } else checks.push([r.redT > 0 && r.walkT > 0 && r.inWalk / r.walkT > 2 * Math.max(0.05, r.inRed / r.redT), `ticks faster in the walk (${(r.inWalk / Math.max(1, r.walkT)).toFixed(1)}/s) than on red (${(r.inRed / Math.max(1, r.redT)).toFixed(1)}/s)`]);
    checks.push([!r.muted, `muted, the walk signals are silent (${r.muted})`]);
    return Object.assign(r, { checks });
  });
};
