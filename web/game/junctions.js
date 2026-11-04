// Junctions: where the traffic's roads meet, and the rules it keeps there.
// A junction is a node of the road network (actors.network) where three or more road pieces end,
// or a few such nodes close together and joined by short pieces: a divided road crossing another
// is drawn as two to four nodes a carriageway apart, and is one junction. Its arms are the pieces
// that lead out of it; a car comes up an arm, waits at the stop line if it must, and crosses to
// another arm by the pieces inside.
//   signals  where OpenStreetMap maps traffic signals at a junction (game.json props, from
//            Overture: pipeline/road_rules.py), its arms take turns: the main road's and the side
//            road's (by the arms' directions), each green, then amber, then all red. A phase
//            stays green while nobody waits on the other; amber is long enough to stop from the
//            speed limit, and a car that can't stop by the line goes on. Without mapped signals,
//            a junction of two main roads gets them.
//   signs    a mapped stop sign on an arm makes its cars stop at the line before they go; a stop
//            or give-way sign, or a lesser road, gives way to cars coming on the main road.
//   arrows   a big junction of two main roads (four arms or more, the main road two-way) gets a
//            protected turn phase after the main road's: the turn across the oncoming traffic
//            (right where the traffic keeps left) has its arrow while the rest of the junction is
//            red. It is skipped when nobody waits to turn, as SCATS skips it.
//   turns    a turn OpenStreetMap bans (Overture's prohibited_transitions, game.json "nt" on the
//            road piece it starts from: pipeline/road_rules.py) is not among an arm's exits.
//   hours    a turn banned only at some hours ("ntw"), and a street shut to cars at some hours
//            ("tb": Japan's school roads in the morning, a shopping street by day, Amsterdam's
//            streets open to cars only for their deliveries' hours), are left out by the game's
//            clock (setClock): no car chooses them then, the rides' router goes round, and no car
//            is put on such a street then. One already on it drives out.
//   lanes    a main road (motorway, trunk, primary, a one-way secondary) has two lanes each way:
//            the one beside the centre line (or on the keep side of a one-way street) for every
//            movement, and the other for going straight ahead onto a road like it. Each lane's
//            movement has its own way across. Where OpenStreetMap counts one lane each way on a
//            main road (game.json "nl", pipeline/road_lanes.py) it has one, smoothed along the
//            road between junctions: a stretch of two shorter than SHORT2 between stretches of one
//            has one, and a stretch of one shorter than SHORT1 between stretches of two keeps two,
//            so that nobody has to merge and move out again within a few metres. A car in the
//            second lane moves across before it ends (actors.js), looking along the road past the
//            pieces between junctions (laneRun) to where it does.
//   scramble a junction a city names in opts.scrambles (Shibuya's scramble: scene landmarks) runs
//            Japan's 歩車分離 (pedestrian-only phase) after the cross road's: every arm's traffic
//            held at red while the walkers cross every way at once, the diagonals too, and nobody
//            walks in the traffic's phases. Shibuya's own cycle is about two minutes with 40 to 50 s
//            of walk (live japan); the game keeps the walk and shortens the traffic's turns.
//   timing   greens are short, as a game keeps them (a minute's wait at a red is no fun): about
//            20 s for a main road, 12 s for a side road, 6 to 8 s for an arrow, a phase with nobody
//            waiting on the other turning after CALL more; a crossing between junctions keeps the
//            traffic's green 14 s and walks 10 s. A green gaps out (SCATS, vehicle-actuated
//            signals): someone waiting on another phase and no car coming on this one, it ends
//            after GAP_MIN. tools/traffic_check.js measures the waits at a red.
//   walkers  the crowd crosses an arm's road at a junction with signals while that arm's traffic is
//            held at red, and presses the button for it; it waits at the kerb otherwise.
//   the box  a car goes in only when its movement (from its arm to its exit) crosses no movement
//            already in the junction, and when there is room for it on its exit beyond the
//            junction, so a queue never locks a junction up. A car that has waited longest goes
//            first: one turning across the oncoming traffic gets its turn.
// The signal heads are modelled here: a pole at the kerb by the stop line with its lantern facing
// the arm, a second one across the junction, and on a main road a mast arm with a lantern over the
// lane; vertical red, amber, green, or Japan's horizontal lights on an arm over the road. An arm
// with a turn arrow has an arrow lantern beside the one over its lane. Every arm's crossing has a
// walk signal on each kerb, facing across: a red figure standing, a green one walking, the red
// flashing while those already out finish crossing. Their lamps follow the phases and glow after dark.
'use strict';
window.OEJunctions = (function () {
  const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1 };
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const LINK = 24;      // a piece this short joining two junction nodes lies inside one junction (m)
  const SPAN = 42;      // and a junction is no wider than this (m)
  const AMBER = 3.5, ALLRED = 2, CALL = 12, GAP_MIN = 7, FLASH = 5; // seconds; a phase with nobody waiting on the other turns after CALL more
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  // lanes each way on a road piece: two on a main road, one elsewhere; and a lane's offset from the
  // first lane's (m, towards the kerb on a two-way road, across to the other side on a one-way one)
  const TWO = { motorway: 1, trunk: 1, primary: 1 };
  // the place along an arm's piece d metres back from where its traffic meets the junction (the
  // piece's end, or for a crossing between junctions the crossing itself)
  const alongArm = (l, a, d) => (a.mid != null ? a.mid + (a.end ? -d : d) : a.end ? l.len - d : d);
  const byClass = l => (TWO[l.c] || (l.ow && l.c === 'secondary') ? 2 : 1);
  const lanesOf = l => l.lanes || byClass(l); // (l.lanes: OSM's count, smoothed: create)
  const SHORT2 = 120, SHORT1 = 40; // m
  const shiftOf = (l, ln) => (ln ? (l.ow ? -3.2 : 3.0) : 0);

  // net: actors.network of the roads; opts.signals, .stops, .giveWay: mapped points [x, y, z, ...]
  // in decimetres; keep: the side the traffic keeps to; lane: its lane's offset from the line (m)
  function create(net, { signals = null, stops = [], giveWay = [], keep = 'left', lane = 1.7, midCrossings = null, scrambles = null } = {}) {
    const L = net.L, side = keep === 'right' ? -1 : 1, tmp = {};
    const nodeKey = (line, end) => { const l = L[line], k = end ? l.pts.length / 3 - 1 : 0; return net.key(l.pts[3 * k], l.pts[3 * k + 1]); };
    // can a car leave a node along line `line` from its end `end` (0: with its points)?
    const canLeave = (line, end) => (end === 0 ? L[line].ow !== -1 : L[line].ow !== 1);
    const canReach = (line, end) => (end === 1 ? L[line].ow !== -1 : L[line].ow !== 1);
    // the banned turns: (line, the end a car reaches) -> [[line, the end it enters by, steps]]
    // (game.json "nt" names pieces by their place in paths.road; network() drops the shortest)
    const byI0 = new Map(), bans = new Map();
    L.forEach((l, i) => byI0.set(l.i0 != null ? l.i0 : i, i));
    let nBans = 0;
    L.forEach((l, i) => { if (l.nt) for (const [e, k, e2, n] of l.nt) { const i2 = byI0.get(k); if (i2 == null) continue; const key = i * 2 + e; if (!bans.has(key)) bans.set(key, []); bans.get(key).push([i2, e2, n]); nBans++; } });
    net.bans = bans; // (the rides' router keeps to them too: cars.js)
    // ------------------------------------------------ lanes each way, from OSM's counts
    // a road between junctions: the pieces joined end to end at nodes where only two meet
    const through = (line, end) => { const v = net.nodes.get(nodeKey(line, end)); if (!v || v.length !== 2) return null; const o = v[0][0] === line && v[0][1] === end ? v[1] : v[0]; return o[0] === line ? null : o; }; // [line, its end there]
    {
      for (const l of L) l.lanes = byClass(l) > 1 && l.nl === 1 ? 1 : byClass(l);
      const seen = new Set();
      for (let i = 0; i < L.length; i++) {
        if (seen.has(i)) continue;
        // the chain i is on, from one end to the other
        let a = i, ae = 0;
        for (let n = 0; n < 200; n++) { const o = through(a, ae); if (!o || o[0] === i) break; a = o[0]; ae = 1 - o[1]; }
        const chain = [];
        for (let b = a, be = ae, n = 0; n < 400; n++) { if (seen.has(b)) break; seen.add(b); chain.push(b); const o = through(b, 1 - be); if (!o) break; b = o[0]; be = o[1]; }
        if (chain.length < 3) continue;
        // runs of the same count; a short one between two of the other count takes theirs
        for (let pass = 0; pass < 2; pass++) {
          const runs = [];
          for (const b of chain) { const n = L[b].lanes; if (runs.length && runs[runs.length - 1].n === n) { const r = runs[runs.length - 1]; r.ids.push(b); r.len += L[b].len; } else runs.push({ n, ids: [b], len: L[b].len }); }
          for (let k = 1; k < runs.length - 1; k++) {
            const r = runs[k];
            if (runs[k - 1].n !== r.n && runs[k + 1].n !== r.n && byClass(L[r.ids[0]]) > 1 && r.len < (r.n > 1 ? SHORT2 : SHORT1) && (pass === 0) === (r.n > 1)) for (const b of r.ids) L[b].lanes = runs[k - 1].n;
          }
        }
      }
    }
    // how far the second lane runs on past the end `end` of line (where a car going that way leaves
    // it), along the road to the next junction: 0 if it ends there, Infinity if it reaches a junction
    const runs = new Map();
    function laneRun(line, end) {
      const key = line * 2 + end;
      if (runs.has(key)) return runs.get(key);
      runs.set(key, 0); // (a loop)
      const o = through(line, end);
      let r = Infinity;
      if (o) { const l2 = L[o[0]]; r = lanesOf(l2) < 2 || !l2.ow !== !L[line].ow || !canReach(o[0], 1 - o[1]) ? 0 : l2.len + laneRun(o[0], 1 - o[1]); }
      runs.set(key, r);
      return r;
    }
    // the turns banned at some hours, as bans but with the times: (line, end) -> [[line, end, steps, windows]]
    const bansT = new Map();
    let nBansT = 0;
    L.forEach((l, i) => { if (l.ntw) for (const [e, k, e2, n, W] of l.ntw) { const i2 = byI0.get(k); if (i2 == null) continue; const key = i * 2 + e; if (!bansT.has(key)) bansT.set(key, []); bansT.get(key).push([i2, e2, n, W]); nBansT++; } });
    // the game's clock, which the timed rules go by: () => { dow (0 Monday .. 6 Sunday), min (of the day) }
    let clockOf = null;
    const setClock = fn => { clockOf = fn; };
    const inWin = (W, t) => W.some(w => ((w[0] >> t.dow) & 1) && t.min >= w[1] && t.min < w[2]);
    // is line shut to a car going along it that way (dir 1 with its points, -1 against) at time t (now)?
    function shutNow(line, dir, t = clockOf && clockOf()) {
      const l = L[line];
      if (!l || !l.tb || !t) return false;
      for (const [way, shut, W] of l.tb) if (!way || way === dir) { if (shut ? inWin(W, t) : !inWin(W, t)) return true; }
      return false;
    }
    // the windows of the turns banned at some hours that the way from arm (line, end) by steps is one of
    function bannedAt(line, end, steps) {
      if (!bansT.size) return null;
      let out = null;
      for (let i = 0; i < steps.length; i++) {
        const from = i === 0 ? line * 2 + end : steps[i - 1][0] * 2 + 1 - steps[i - 1][1], B = bansT.get(from);
        if (!B) continue;
        for (const [l2, e2, n, W] of B) for (let k = i; k < steps.length && (n > 1 || k === i); k++) if (steps[k][0] === l2 && steps[k][1] === e2) (out = out || []).push(W);
      }
      return out;
    }
    // is exit e closed at time t (now)? a turn banned then, or onto a street shut then
    function closedNow(e, t = clockOf && clockOf()) {
      if (!t) return false;
      if (e.tw && e.tw.some(W => inWin(W, t))) return true;
      return shutNow(e.m.line, e.m.end === 0 ? 1 : -1, t);
    }
    net.shutNow = shutNow; // (the rides' router keeps off them: cars.js)
    net.turnShut = (from, line, end) => { const B = bansT.get(from), t = clockOf && clockOf(); return !!(B && t && B.some(b => b[2] === 1 && b[0] === line && b[1] === end && inWin(b[3], t))); };
    // is the way from arm (line, end reached) by these steps ([line, end entered], ...) a banned turn?
    function banned(line, end, steps) {
      if (!bans.size) return false;
      for (let i = 0; i < steps.length; i++) {
        const from = i === 0 ? line * 2 + end : steps[i - 1][0] * 2 + 1 - steps[i - 1][1], B = bans.get(from);
        if (!B) continue;
        for (const [l2, e2, n] of B) for (let k = i; k < steps.length && (n > 1 || k === i); k++) if (steps[k][0] === l2 && steps[k][1] === e2) return true;
      }
      return false;
    }
    // ------------------------------------------------ the junction nodes, joined into junctions
    const deg = new Map();
    for (const [k, v] of net.nodes) if (v.length >= 3) deg.set(k, v);
    const parent = new Map(), pos = new Map(), members = new Map();
    for (const [k, v] of deg) { parent.set(k, k); const [i, e] = v[0], l = L[i], j = e ? l.pts.length / 3 - 1 : 0; pos.set(k, [l.pts[3 * j], l.pts[3 * j + 1], l.pts[3 * j + 2]]); members.set(k, [k]); }
    const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const wide = (a, b) => { // would joining these two make a junction wider than SPAN?
      for (const p of members.get(a)) for (const q of members.get(b)) { const P = pos.get(p), Q = pos.get(q); if (Math.hypot(P[0] - Q[0], P[1] - Q[1]) > SPAN) return true; }
      return false;
    };
    const order = L.map((l, i) => i).filter(i => L[i].len <= LINK).sort((a, b) => L[a].len - L[b].len);
    for (const i of order) {
      const a = nodeKey(i, 0), b = nodeKey(i, 1);
      if (a === b || !deg.has(a) || !deg.has(b)) continue;
      const ra = find(a), rb = find(b);
      if (ra === rb || wide(ra, rb)) continue;
      parent.set(rb, ra); members.set(ra, members.get(ra).concat(members.get(rb)));
    }
    const J = [];
    for (const [k] of deg) if (find(k) === k) J.push({ id: J.length, nodes: members.get(k), arms: [], inner: new Set() });
    // arms: the pieces leading out; inside: the short pieces joining two of its nodes
    const armOf = new Map(); // line * 2 + end -> arm
    for (const j of J) {
      const set = new Set(j.nodes);
      let cx = 0, cy = 0, cz = 0;
      for (const k of j.nodes) { const P = pos.get(k); cx += P[0]; cy += P[1]; cz += P[2]; }
      j.x = cx / j.nodes.length; j.y = cy / j.nodes.length; j.z = cz / j.nodes.length;
      for (const k of j.nodes) for (const [line, end] of deg.get(k)) {
        const other = nodeKey(line, 1 - end);
        if (set.has(other) && L[line].len <= LINK) { j.inner.add(line); continue; }
        net.at(line, end ? Math.max(0, L[line].len - 6) : Math.min(L[line].len, 6), tmp);
        const P = pos.get(k), out = Math.atan2(tmp.x - P[0], tmp.y - P[1]); // the arm's bearing, out of the junction
        const a = { j, i: j.arms.length, line, end, node: k, x: P[0], y: P[1], z: P[2], out, c: L[line].c, rank: RANK[L[line].c] || 2,
          in: canReach(line, end), exit: canLeave(line, end), back: 4, phase: 0, sign: null, exits: null };
        j.arms.push(a); armOf.set(line * 2 + end, a);
      }
    }
    // the stop line: back from the node by half the widest road crossing there, and a crossing's width
    for (const j of J) for (const a of j.arms) {
      let w = 0;
      for (const [line] of deg.get(a.node)) if (line !== a.line) w = Math.max(w, ROADW[L[line].c] || 7);
      a.back = Math.max(3.5, Math.min(11, w / 2 + 1.8, L[a.line].len * 0.4));
    }
    // ------------------------------------------------ signals and signs
    const near = (flat, fn) => { for (let i = 0; i + 2 < flat.length; i += 3) fn(flat[i] / 10, flat[i + 1] / 10); };
    const nearestJ = (x, y, r) => { // the junction with a node within r of (x, y)
      let best = null, bd = r;
      for (const j of byCell(x, y)) for (const k of j.nodes) { const P = pos.get(k), d = Math.hypot(P[0] - x, P[1] - y); if (d < bd) { bd = d; best = j; } }
      return best;
    };
    const cells = new Map(), CELL = 60;
    for (const j of J) { const ck = `${Math.floor(j.x / CELL)},${Math.floor(j.y / CELL)}`; if (!cells.has(ck)) cells.set(ck, []); cells.get(ck).push(j); }
    function byCell(x, y) {
      const out = [], c0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const g = cells.get(`${c0 + a},${r0 + b}`); if (g) out.push(...g); }
      return out;
    }
    const mapped = signals && signals.length > 0;
    if (mapped) near(signals, (x, y) => { const j = nearestJ(x, y, 22); if (j) j.mapped = (j.mapped || 0) + 1; });
    const signArm = (x, y, kind) => { // the arm a sign stands beside, near its stop line
      let best = null, bd = 9;
      for (const j of byCell(x, y)) for (const a of j.arms) {
        if (!a.in || Math.hypot(a.x - x, a.y - y) > 25) continue;
        const q = net.nearest(x, y, bd);
        if (q && q.line === a.line && q.d < bd) { bd = q.d; best = a; }
      }
      if (best) best.sign = kind;
    };
    near(giveWay, (x, y) => signArm(x, y, 'give_way'));
    near(stops, (x, y) => signArm(x, y, 'stop'));
    for (const j of J) {
      const ins = j.arms.filter(a => a.in);
      // the phases: arms along the main road's axis, and the others
      if (ins.length >= 2 && j.arms.length >= 3) {
        const main = ins.reduce((m, a) => (a.rank > m.rank ? a : m), ins[0]);
        for (const a of j.arms) { const d = Math.abs(angle(2 * a.out, 2 * main.out)) / 2; a.phase = d < Math.PI / 4 ? 0 : 1; }
      }
      const both = ins.some(a => a.phase === 0) && ins.some(a => a.phase === 1);
      const main2 = j.arms.filter(a => a.rank >= 3 && a.c !== 'motorway').length >= 2 && j.arms.every(a => a.c !== 'motorway');
      j.sig = both && (mapped ? !!j.mapped : main2);
      if (j.sig) {
        const top = p => Math.max(0, ...j.arms.filter(a => a.phase === p).map(a => a.rank));
        j.green = [10 + 2 * top(0), 6 + 1.5 * top(1), 5 + 0.5 * top(0)];
        // a protected turn across after the main road's phase: at a big junction of two main roads
        const mainIn = j.arms.filter(a => a.in && a.phase === 0);
        j.arrow = j.arms.length >= 4 && top(0) >= 4 && top(1) >= 3 && mainIn.length >= 2 && mainIn.some(a => !L[a.line].ow);
        const fast = Math.max(...j.arms.map(a => L[a.line].v || 11));
        j.amber = fast > 16 ? AMBER + 1 : AMBER;
        j.ph = rnd() < 0.5 ? 0 : 1; j.st = 'g'; j.t = rnd() * j.green[j.ph]; j.nxt = 1 - j.ph; // each junction somewhere in its cycle
        for (const a of j.arms) a.sign = null; // the lights rule here
      }
      j.active = []; j.pend = []; j.near = []; j.demand = [0, 0, 0]; j.seen = -1;
    }
    // the scrambles: a fourth phase (3), the walkers', every arm red; the traffic's turns kept short
    const STRIPE_HALF = 2.5; // (half a crosswalk's width along the road: Shibuya's are 4 to 6 m wide)
    let nScramble = 0;
    for (const sc of scrambles || []) { // ([x, y], or { node: [x, y], lines: its crosswalks [[x, y], [x, y]] })
      const [x, y] = Array.isArray(sc) ? sc : sc.node, j = nearestJ(x, y, 30);
      if (!j || j.scramble || j.arms.filter(a => a.in).length < 2) continue;
      if (!j.sig) { // (signalled whether or not OSM maps its lights near the node: Shibuya's stand at the crosswalks, beyond the radius)
        j.sig = true; j.arrow = false; j.amber = Math.max(...j.arms.map(a => L[a.line].v || 11)) > 16 ? AMBER + 1 : AMBER;
        for (const a of j.arms) { if (a.phase == null) a.phase = 0; a.sign = null; }
      }
      j.scramble = true; nScramble++;
      j.stripes = Array.isArray(sc) ? null : sc.lines || null;
      if (j.stripes) for (const a of j.arms.filter(a => a.in)) { // each way in stops behind the crosswalk painted across it, not in the stripes
        const l = L[a.line], P = {}, side = (d, A, B) => { net.at(a.line, a.end ? l.len - d : d, P); return (P.x - A[0]) * (B[1] - A[1]) - (P.y - A[1]) * (B[0] - A[0]); };
        for (const [A, B] of j.stripes) {
          let s0 = side(0, A, B);
          for (let d = 1; d <= Math.min(40, l.len - 4); d++) {
            const s1 = side(d, A, B);
            if (s0 * s1 <= 0) { // the arm crosses the stripes' line here: within the stripes?
              const bl = Math.hypot(B[0] - A[0], B[1] - A[1]), u = ((P.x - A[0]) * (B[0] - A[0]) + (P.y - A[1]) * (B[1] - A[1])) / (bl * bl);
              if (u > -0.1 && u < 1.1) a.back = Math.max(a.back, Math.min(l.len - 4, d + STRIPE_HALF + 1));
              break;
            }
            s0 = s1;
          }
        }
      }
      j.green = [16, 12, 6, 32]; j.allred = 4; // (and a longer all-red between phases: its box is some 40 m across, the stop lines behind the stripes)
      j.ph = 3; j.st = 'g'; j.t = 4; j.nxt = 0; // (the game opens on the walk: the crowd already stepping out)
    }
    // ------------------------------------------------ crossings between junctions
    // A pedestrian crossing mapped on a road away from any junction (opts.midCrossings: game.json's
    // props crossing_signals and crossing_zebra, from OSM's tags: pipeline/road_rules.py) is a
    // junction of its own with no way to turn (j.mid: the place along its piece), and an arm for
    // the traffic heading for each end of the piece, its stop line back from the stripes. One with
    // signals runs two phases: the traffic's green, which the walkers' button ends after a while
    // (phase 1: their walk, all the traffic held), and back. At a zebra the traffic gives way at
    // the line to anyone on the stripes or stepping onto them (actors.js).
    const mids = new Map(); // line -> its crossings, along it
    let nMid = 0, nZebra = 0;
    const midAt = (flat, sig) => near(flat || [], (x, y) => {
      if (nearestJ(x, y, 16)) return; // at a junction: its own walk signals, or none
      const q = net.nearest(x, y, 9);
      if (!q) return;
      const l = L[q.line];
      // (clear of a junction at either end by a queue of three, so that one waiting at its red is out of
      // that junction; nearer, it is the junction's own crossing)
      const clear = end => (armOf.get(q.line * 2 + end) ? 25 : 12);
      if (q.s < clear(0) || q.s > l.len - clear(1) || innerLine(q.line) || l.c === 'motorway') return;
      const on = mids.get(q.line) || [];
      if (on.some(o => Math.abs(o.mid - q.s) < 25)) return; // (one per stretch: a crossing with an island is mapped as two)
      net.at(q.line, q.s, tmp);
      const j = { id: J.length, mid: q.s, line: q.line, nodes: [], arms: [], inner: new Set(), x: tmp.x, y: tmp.y, z: tmp.z, hx: tmp.hx, hy: tmp.hy, sig, half: (ROADW[l.c] || 7) / 2,
        green: [14, 10, 0], amber: (l.v || 11) > 16 ? AMBER + 1 : AMBER, ph: 0, st: 'g', t: rnd() * 20, nxt: 1, active: [], pend: [], near: [], demand: [0, 0, 0], seen: -1 };
      for (const end of [1, 0]) { // (the traffic heading for each end)
        if (!canReach(q.line, end)) continue;
        net.at(q.line, Math.max(0, Math.min(l.len, q.s + (end ? -6 : 6))), tmp);
        j.arms.push({ j, i: j.arms.length, line: q.line, end, mid: q.s, node: null, x: j.x, y: j.y, z: j.z, out: Math.atan2(tmp.x - j.x, tmp.y - j.y), c: l.c, rank: RANK[l.c] || 2,
          in: true, exit: true, back: (ROADW[l.c] || 7) > 9 ? 3.6 : 3.0, phase: 0, sign: null, exits: [] });
      }
      if (!j.arms.length) return;
      J.push(j); on.push(j); on.sort((a, b) => a.mid - b.mid); mids.set(q.line, on);
      if (sig) nMid++; else nZebra++;
    });
    const innerLine = line => J.some(j => j.inner.has(line));
    if (midCrossings) { midAt(midCrossings.signals, true); midAt(midCrossings.zebra, false); }
    // ------------------------------------------------ where a car can go from an arm
    // every exit from arm a: { m (the arm it leaves by), steps: [[line, end entered], ...] } by the
    // pieces inside, as the traffic's next() gives them; a turn back the way it came only if nothing else
    function exits(a) {
      if (a.exits) return a.exits;
      const j = a.j, out = [], seen = new Map([[a.node, null]]), queue = [a.node];
      while (queue.length) {
        const k = queue.shift();
        for (const [line, end] of net.nodes.get(k) || []) {
          if (line === a.line) continue;
          if (j.inner.has(line)) {
            if (!canLeave(line, end)) continue;
            const k2 = nodeKey(line, 1 - end);
            if (seen.has(k2)) continue;
            seen.set(k2, [k, line, end]); queue.push(k2);
          } else {
            const m = armOf.get(line * 2 + end);
            if (!m || !m.exit) continue;
            const steps = [[line, end]];
            for (let n = k; seen.get(n); n = seen.get(n)[0]) steps.unshift([seen.get(n)[1], seen.get(n)[2]]);
            if (!banned(a.line, a.end, steps)) out.push({ m, steps, turn: angle(m.out, a.out + Math.PI), tw: bannedAt(a.line, a.end, steps) });
            else a.bans = (a.bans || 0) + 1;
          }
        }
      }
      // not the other carriageway of the same road, back the way it came, nor a road no car can get
      // along (net.avoid: through a building, route.js), unless that is all there is
      // nor, given another way, a short stub that ends in nothing (the map's edge, a lane the data
      // leaves unjoined), where a car could only turn round
      const stub = e => { const far = 1 - e.m.end; return L[e.m.line].len < 40 && !armOf.get(e.m.line * 2 + far) && !net.next(e.m.line, far, true); };
      const av = net.avoid, ok0 = out.filter(e => !(av && av[e.m.line])), ok1 = ok0.filter(e => !stub(e)), ok = ok1.length ? ok1 : ok0, pool = ok.length ? ok : out;
      const fwd = pool.filter(e => Math.abs(e.turn) < 2.6);
      a.exits = fwd.length ? fwd : pool;
      // the lanes a movement goes from, on a road with two each way (lane 0 is the one by the centre
      // line on a two-way road, the one on the keep side of a one-way road: shiftOf): where OSM paints
      // arrows on the lanes (game.json "tl", pipeline/road_lanes.py), the lanes whose arrows show its
      // way, the half of the road's lanes on lane 0's side standing for lane 0 and the other half for
      // lane 1; elsewhere straight ahead from either onto a road with two of the same kind (both
      // one-way, or both two-way) 60 m long or more, a turn across the oncoming traffic from the lane
      // nearer the middle of the road and a turn the other way from the one nearer the kerb. Two side
      // by side only where the road beyond has the room (two lanes, 60 m long); else the one that
      // way: the inner for a turn across, else the outer
      const la = L[a.line], two = lanesOf(la) > 1, inner = la.ow ? 1 : 0;
      const tl = la.tl && la.tl.find(t => t[0] === a.end);
      let ar = null;
      if (tl) {
        const osm = tl[1].split('|'), from0 = (side > 0) === !!la.ow ? osm : osm.slice().reverse(), h = Math.ceil(osm.length / 2);
        ar = two && osm.length > 1 ? [from0.slice(0, h).join(''), from0.slice(h).join('')] : [osm.join('')];
      }
      for (const e of a.exits) {
        const lm = L[e.m.line], way = Math.abs(e.turn) < 0.45 ? 't' : e.turn > 0 ? 'r' : 'l';
        e.across = Math.abs(e.turn) < 2.6 && e.turn * side > 0.5; // across the oncoming traffic
        const room = two && lanesOf(lm) > 1 && lm.len + laneRun(e.m.line, 1 - e.m.end) >= 60 && (way !== 't' || !la.ow === !lm.ow); // (not onto a stretch too short to move across on before the next junction, or before its second lane ends)
        let ls = ar ? ar.map((s, ln) => (s.includes(way) ? ln : -1)).filter(ln => ln >= 0) : [];
        if (!ls.length) ls = !two ? [0] : Math.abs(e.turn) < 0.5 ? [0, 1] : e.across ? [inner] : [1 - inner]; // (and where arrows leave this way out: a gap in the data) // (arrows that leave this way out: a gap in the data)
        if (ls.length > 1 && !room) ls = Math.abs(e.turn) < 0.5 ? [0] : [e.across ? inner : 1 - inner];
        e.lanes = ls;
      }
      // (every lane has a way on: where the arrows leave one with none, the way nearest straight ahead)
      for (let ln = 0; ln < (two ? 2 : 1); ln++) if (a.exits.length && !a.exits.some(e => e.lanes.includes(ln))) {
        const e = a.exits.reduce((p, q) => (Math.abs(q.turn) < Math.abs(p.turn) ? q : p));
        e.lanes = e.lanes.concat(ln).sort();
        if (e.lanes.length > 1 && !(lanesOf(L[e.m.line]) > 1 && L[e.m.line].len + laneRun(e.m.line, 1 - e.m.end) >= 60)) e.lanes = [ln]; // (no room for two side by side beyond: this lane's alone)
      }
      a.lanes = two && a.exits.some(e => e.lanes.includes(1)) ? 2 : 1;
      return a.exits;
    }
    // choose an exit: ahead more often than a turn, and a main road more often than a lane
    function choose(a) {
      let ex = exits(a);
      if (!ex.length) return null;
      if (clockOf && ex.some(e => e.tw || L[e.m.line].tb)) { // (not a way closed at this hour, if there is another)
        const t = clockOf(), open = ex.filter(e => !closedNow(e, t));
        if (open.length) ex = open;
      }
      let sum = 0;
      const w = ex.map(e => { const v = (1 + 1.6 * Math.cos(e.turn)) * (0.6 + 0.2 * e.m.rank); sum += Math.max(0.15, v); return Math.max(0.15, v); });
      let r = rnd() * sum;
      for (let i = 0; i < ex.length; i++) if ((r -= w[i]) < 0) return ex[i];
      return ex[ex.length - 1];
    }
    // ------------------------------------------------ movements: their ways across, and the stop lines
    // A movement's way: points PSTEP apart in its lane, from its arm's stop line along the pieces
    // across to its exit, out to the stop line there, the lane smoothed round corners as the
    // traffic's is (actors.js lanePos). Two movements whose ways come within a car's width of each
    // other cross. Each arm's stop line is set back from where the roads' widths put it until a car
    // waiting there is clear of the other arms' ways across. Worked out for a junction the first
    // time a car comes up to it.
    const PSTEP = 1.2;
    function wayOf(a, e, ln = 0) {
      const chain = [[a.line, a.end ? 1 : -1]].concat(e.steps.map(([li, en]) => [li, en === 0 ? 1 : -1]));
      let total = a.back + e.m.back;
      for (let i = 0; i < e.steps.length - 1; i++) total += L[e.steps[i][0]].len;
      let q = 0, li = chain[0][0], di = chain[0][1];
      const s0 = di > 0 ? L[li].len - a.back : a.back, sb = Math.max(0, Math.min(L[li].len, s0 - di * 2 * PSTEP)), behind = Math.abs(s0 - sb);
      let si = sb;
      const Q = [];
      for (let d = 0; d <= total + behind + 2 * PSTEP; d += PSTEP) {
        if (si < 0 || si > L[li].len) {
          if (q + 1 >= chain.length) break;
          const over = si > L[li].len ? si - L[li].len : -si;
          q++; li = chain[q][0]; di = chain[q][1];
          si = di > 0 ? over : L[li].len - over;
          if (si < 0 || si > L[li].len) break;
        }
        net.at(li, si, tmp);
        Q.push(tmp.x, tmp.y);
        si += di * PSTEP;
      }
      const n = Q.length / 2, k0 = Math.round(behind / PSTEP), k1 = Math.max(k0 + 1, n - 2), out = [], off = (lane + shiftOf(L[a.line], ln)) * side; // (not the two points past the far line)
      for (let k = k0; k < Math.min(n, k1); k++) {
        const ka = Math.max(0, k - 2), kb = Math.min(n - 1, k + 2);
        let hx = Q[2 * kb] - Q[2 * ka], hy = Q[2 * kb + 1] - Q[2 * ka + 1];
        const h = Math.hypot(hx, hy) || 1; hx /= h; hy /= h;
        out.push(Q[2 * k] - hy * off, Q[2 * k + 1] + hx * off);
      }
      return new Float32Array(out);
    }
    // do two ways come within r of each other?
    function close(A, B, r) {
      const r2 = r * r;
      for (let i = 0; i < A.length; i += 2) for (let k = 0; k < B.length; k += 2) { const dx = A[i] - B[k], dy = A[i + 1] - B[k + 1]; if (dx * dx + dy * dy < r2) return true; }
      return false;
    }
    // where a car waiting at arm a's line stands (a box: centre, direction, half length and width)
    function waiting(a, ln = 0) {
      const l = L[a.line], d = a.back + 2.5, s = a.end ? l.len - d : d, dir = a.end ? 1 : -1;
      net.at(a.line, Math.max(0, Math.min(l.len, s)), tmp);
      const hx = tmp.hx * dir, hy = tmp.hy * dir, off = (lane + shiftOf(l, ln)) * side;
      return { x: tmp.x - hy * off, y: tmp.y + hx * off, hx, hy };
    }
    function inWay(w, W, gl, gw) {
      for (let i = 0; i < W.length; i += 2) { const dx = W[i] - w.x, dy = W[i + 1] - w.y; if (Math.abs(dx * w.hx + dy * w.hy) < gl && Math.abs(-dx * w.hy + dy * w.hx) < gw) return true; }
      return false;
    }
    function prepare(j) {
      if (j.ready) return;
      j.ready = true;
      const ins = j.arms.filter(a => a.in);
      for (const a of ins) exits(a);
      const ways = () => { for (const a of ins) for (const e of a.exits) { e.ways = e.lanes.map(ln => wayOf(a, e, ln)); e.way = e.ways[0]; } };
      const crossed = (a, w) => ins.some(b => b !== a && b.exits.some(e => e.m !== a && e.ways.some(W => inWay(w, W, 2.4 + 0.6, 0.95 + 1.1))));
      for (let pass = 0; pass < 2; pass++) {
        ways();
        for (const a of ins) {
          const max = Math.max(a.back, Math.min(16, L[a.line].len * 0.6));
          for (let ln = 0; ln < a.lanes; ln++) for (let w = waiting(a, ln); a.back < max && crossed(a, w); w = waiting(a, ln)) a.back = Math.min(max, a.back + 0.6);
        }
      }
      // a second lane whose car waiting at the line would still be in another arm's way (where two
      // roads merge, say) ends before the junction: its cars move across in time
      // a second lane whose car waiting at the line would still be in another arm's way, or that
      // comes within a car's width of another arm's lanes on the way up to the line (two roads that
      // merge), ends before the junction: its cars move across in time
      const upTo = (a, ln) => { // the lane's points from the line back 40 m
        const l = L[a.line], P = [], off = (lane + shiftOf(l, ln)) * side, dir = a.end ? 1 : -1;
        for (let d = a.back; d < a.back + 40 && d < l.len; d += 2) { net.at(a.line, a.end ? l.len - d : d, tmp); P.push(tmp.x - tmp.hy * dir * off, tmp.y + tmp.hx * dir * off); }
        return P;
      };
      for (const a of ins) {
        if (a.lanes < 2) continue;
        const P = upTo(a, 1);
        if (crossed(a, waiting(a, 1)) || j.arms.some(b => b !== a && b.line !== a.line && (close(P, upTo(b, 0), 3.2) || (b.lanes > 1 && close(P, upTo(b, 1), 3.2))))) { a.lanes = 1; for (const e of a.exits) e.lanes = [0]; }
      }
      ways();
      j.cx = new Map();
    }
    // a movement is its exit's arm and its lane: m + 16 * lane (mv() gives a car's)
    const wayFor = (j, k, m) => (j.arms[k].exits || []).find(e => e.m.i === (m & 15));
    const mv = (c, e) => e.m.i + (c.ln && e.lanes && e.lanes.includes(c.ln) ? 16 * c.ln : 0);
    function conflict(j, k, m, k2, m2) {
      if (k === k2 && (m >> 4) === (m2 >> 4)) return false; // one behind the other in a lane: the car ahead is braked for
      if (m === m2) return true;  // into the same road, from the same lane
      if (k === k2 && (m & 15) === (m2 & 15)) return false; // side by side from one arm into the road's two lanes
      // (side by side from one arm to two roads: where their ways across come close, by the ways below)
      const C = j.cx || (j.cx = new Map()), key = ((k * 32 + m) * 32 + k2) * 32 + m2;
      if (C.has(key)) return C.get(key);
      const e1 = wayFor(j, k, m), e2 = wayFor(j, k2, m2), w1 = e1 && e1.ways && e1.ways[e1.lanes.indexOf(m >> 4)], w2 = e2 && e2.ways && e2.ways[e2.lanes.indexOf(m2 >> 4)];
      const v = !w1 || !w2 || close(w1, w2, 2.8);
      C.set(key, v);
      return v;
    }
    // the light an arm shows a car leaving by exit e (an exit, a movement number, or none: the
    // light for straight ahead): 'g', 'y' or 'r', or null where there are no signals. Phase 2 is
    // the arrow for the turn across, after the main road's phase (0); the turners keep their green
    // from one into the other.
    function light(a, e = null) {
      const j = a.j;
      if (!j.sig) return null;
      const st = j.st === 'g' ? 'g' : j.st === 'y' ? 'y' : 'r';
      if (typeof e === 'number') e = wayFor(j, a.i, e);
      const turn = j.arrow && a.phase === 0 && e && e.across;
      if (j.ph === 2) return turn ? st : 'r';
      if (j.ph !== a.phase) return 'r';
      if (turn && j.nxt === 2 && j.st !== 'g') return 'g';
      return st;
    }
    // the arrow an arm's turn across shows (for its lantern): 'g', 'y', 'r', or '' (none lit: the
    // turn filters through the oncoming traffic on the main road's green)
    function arrow(a) {
      const j = a.j;
      if (!j.sig || !j.arrow || a.phase !== 0) return '';
      if (j.ph === 2) return j.st === 'g' ? 'g' : j.st === 'y' ? 'y' : 'r';
      if (j.ph === 0 && (j.st === 'g' || j.nxt === 2)) return j.nxt === 2 && j.st !== 'g' ? 'g' : '';
      return 'r';
    }
    // may a walker step out across arm a's road now? While its traffic is held at red, the phase
    // green for the others (not the arrow's), and not in the last seconds before it may end
    function walk(a) {
      const j = a.j;
      if (!j.sig) return true;
      if (j.scramble) return j.ph === 3 && j.st === 'g' && j.t < j.green[3] - 6;
      return j.ph !== a.phase && j.ph !== 2 && j.st === 'g' && !(j.call && j.t > (j.gEnd != null ? j.gEnd : j.green[j.ph]) - FLASH);
    }
    // a walker waits to cross arm a: the button calls the phase that lets them
    function call(a) {
      const j = a.j;
      if (!j.sig) return;
      if (j.seen !== frame) { j.seen = frame; j.near.length = 0; j.demand[0] = j.demand[1] = j.demand[2] = 0; }
      j.demand[a.phase === 0 ? 1 : 0] = 1;
    }
    // a vehicle with priority coming up arm a (a ride on its way to you, as a bus has priority at
    // some signals, called from far enough out that the change is made by the time it gets there):
    // the other road's green ends once it has run a few seconds, through amber as ever, and its own
    // green is held for it (up to HOLD past when it would have ended) while it comes on
    const MIN_G = 5, HOLD = 15;
    function priority(a) {
      const j = a.j;
      if (!j.sig) return;
      if (j.ph === a.phase && j.st === 'g') { j.hold = frame; return; }
      if (j.ph === 3) return; // (the scramble's walk is never cut short: its crowd is out on the road)
      if (j.ph !== a.phase && j.st === 'g' && j.t >= MIN_G) { j.st = 'y'; j.t = 0; j.nxt = a.phase; dirty.add(j); } // (its phase next: not the arrow's)
      else if (j.st !== 'g' && j.nxt !== a.phase && j.ph !== a.phase) j.nxt = a.phase; // (changing already: to its phase next)
    }
    // the scramble j's walk in `inS` seconds (the game opening on it): every arm held at red until then, or
    // the walk already that far in (inS < 0)
    function walkIn(j, inS) {
      if (!j || !j.scramble) return;
      if (inS > 0) { j.st = 'r'; j.nxt = 3; j.t = (j.allred || ALLRED) - inS; } else { j.ph = 3; j.st = 'g'; j.t = -inS; }
      j.walkNow = j.ph === 3 && j.st === 'g'; dirty.add(j);
    }
    // about how long until arm a's light is green for a vehicle with priority there (0 if it is, or
    // there are no signals): what is left of the change, and of the other road's few seconds first
    function toGreen(a) {
      const j = a.j;
      if (!j.sig || light(a) === 'g') return 0;
      const amber = j.amber || AMBER, allred = j.allred || ALLRED, change = amber + allred;
      if (j.ph === 3 && j.st === 'g') return Math.max(0, j.green[3] - j.t) + change; // (the scramble's walk runs its course; a call makes its phase next)
      if (j.st === 'g') return Math.max(0, MIN_G - j.t) + change; // the other road's green
      if (j.st === 'y') return amber - j.t + allred + (j.nxt === a.phase ? 0 : MIN_G + change); // (its own green ending: round again)
      return Math.max(0, allred - j.t) + (j.nxt === a.phase ? 0 : MIN_G + change);
    }
    let frame = 0;
    const dirty = new Set(); // (the junctions whose signals changed this frame, for the heads)
    const NONE = [0, 0, 0];
    // a car coming up arm a, `eta` seconds from its stop line, to leave by exit m (or -1): seen by
    // the signals (a call for its phase) and by cars giving way to it
    function approach(c, a, m, eta) {
      const j = a.j;
      if (j.seen !== frame) { j.seen = frame; j.near.length = 0; j.demand[0] = j.demand[1] = j.demand[2] = 0; }
      // (the cars coming this frame; the requests before them in the frame see the last frame's)
      j.near.push({ c, k: a.i, m, eta, rank: a.sign ? 0 : a.rank });
      if (eta < 12) j.demand[a.phase] = 1;
      if (j.arrow && a.phase === 0 && eta < 6 && m >= 0) { const e = wayFor(j, a.i, m); if (e && e.across) j.demand[2] = 1; } // a car to turn across: the arrow
    }
    // may car c go into the junction from arm a, out by exit e, now (t)? It joins the movements in
    // it if so (true); else why not: 'cross' (a movement in it crosses its way), 'turn' (one waiting
    // longer crosses it) or 'give' (it gives way to a car coming on the main road)
    const WAITED = 5; // seconds at the line after which a waiting car's turn comes before newcomers'
    const LONG = 3.5; // a vehicle longer than twice this (a bus) has the junction to itself: it swings wide
    // (and, given a2 and e2, the junction just after, which it crosses with this one: both or neither)
    function request(c, a, e, t, a2 = null, e2 = null) {
      const r = may(c, a, e, t);
      if (r !== true) return r;
      if (a2) { const r2 = may(c, a2, e2, t); if (r2 !== true) return r2; }
      enter(c, a, e, t);
      if (a2) enter(c, a2, e2, t);
      return true;
    }
    function may(c, a, e, t) {
      const j = a.j, k = a.i, m = mv(c, e);
      for (const o of j.active) if (o.c === c && o.k === k && o.m === m) return true; // (in it already, this way)
      for (const o of j.active) if (o.c !== c && (o.k !== k && (c.half > LONG || o.c.half > LONG) || conflict(j, k, m, o.k, o.m))) return 'cross';
      const mine = j.pend.find(o => o.c === c);
      for (const o of j.pend) {
        if (o === mine || (mine && o.since >= mine.since) || t - o.since < WAITED || o.c.line < 0) continue;
        if (j.sig && light(j.arms[o.k], o.m) === 'r') continue; // (its light has turned red since)
        if (conflict(j, k, m, o.k, o.m)) return 'turn';
      }
      if (!j.sig && j.seen >= frame - 1 && !(mine && t - mine.since > 3 * WAITED)) { // give way to the main road: a car on a greater arm coming, not stopped
        const me = a.sign ? 0 : a.rank;
        for (const o of j.near) if (o.c !== c && o.rank > me && o.eta < 3.2 && o.c.v > 1.5 && (o.m < 0 || conflict(j, k, m, o.k, o.m))) return 'give';
      }
      return true;
    }
    // the junction a car comes up to just after leaving by exit e, when the piece between is shorter
    // than `len` up to its line (too short to wait on: the two are crossed together), or null
    function after(e, len) {
      const m = e.m, a2 = armAt(m.line, 1 - m.end);
      return a2 && a2.j !== m.j && L[m.line].len - m.back - a2.back < len ? a2 : null;
    }
    // how far along exit e's piece a car can wait: up to the stop line of the junction at its far end
    function reach(e) {
      const m = e.m, a2 = armOf.get(m.line * 2 + 1 - m.end), M = mids.get(m.line);
      if (M) { // (or up to the line of a crossing between junctions on it)
        const X = m.end === 0 ? M[0] : M[M.length - 1], a = X.arms.find(b => b.end === 1 - m.end);
        if (a) return (m.end === 0 ? X.mid : L[m.line].len - X.mid) - a.back - m.back;
      }
      return L[m.line].len - m.back - (a2 && a2.in && a2.j !== m.j ? a2.back : 0);
    }
    function enter(c, a, e, t, forced = false) { // into the junction: its movement joins those in it
      const j = a.j, m = mv(c, e);
      if (forced) overLine++; // (a car already over the line: the checks count these)
      unwait(c);
      if (c.mv && c.mv.j === j) release(c);
      else if (c.mv) { release(c, 'mv0'); c.mv0 = c.mv; } // still leaving the last one
      if (c.mv0 && c.mv0.j === j) c.mv0 = null; // (one movement a car at a junction: one it came back to, its exit changed, replaces the one it had)
      for (let i = j.active.length - 1; i >= 0; i--) if (j.active[i].c === c) j.active.splice(i, 1);
      j.active.push({ c, k: a.i, m, t, forced });
      c.mv = { j, a, e }; c.mvT = t;
    }
    // car c is waiting at the line for its movement: the longest waiting goes first
    function wait(c, a, e, t) {
      const j = a.j;
      if (!j.pend.some(o => o.c === c)) j.pend.push({ c, k: a.i, m: mv(c, e), since: t });
    }
    // the car is clear of a junction (c.mv: the one it is coming up to or in; c.mv0: the one before,
    // which it may still be leaving as it comes up to the next close by)
    function release(c, key = 'mv') {
      const mv = c[key];
      if (mv) { const A = mv.j.active, i = A.findIndex(o => o.c === c); if (i >= 0) A.splice(i, 1); }
      c[key] = null;
    }
    function unwait(c) { // no longer waiting at a line
      if (c.wj) { const P = c.wj.pend, i = P.findIndex(o => o.c === c); if (i >= 0) P.splice(i, 1); c.wj = null; }
    }
    function forget(c) { // the car leaves the traffic (or turns round): out of every junction it is in or waiting at
      release(c); release(c, 'mv0');
      unwait(c);
    }
    // movements in one junction at once that cross, pairs: let in by the junction (by construction
    // none), and with a car found over its line (it couldn't stop, or was put back there or turned
    // round: the checks count these apart)
    let crossed = 0, crossedOver = 0, overLine = 0; const crossLog = []; // (the first few, for tools/traffic_check.js)
    const seenPairs = new Set(), carIds = new WeakMap();
    let nCar = 0;
    const carId = c => { let i = carIds.get(c); if (i == null) carIds.set(c, i = nCar++); return i; };
    const conflicts = () => crossed;
    const innerAll = new Set();
    for (const j of J) for (const i of j.inner) innerAll.add(i);
    const inner = line => innerAll.has(line);
    // step the signals; and drop movements whose car has gone (taken, put back elsewhere)
    function update(dt, t) {
      frame++;
      for (const j of J) {
        if (j.active.length) for (let i = j.active.length - 1; i >= 0; i--) { const o = j.active[i]; if (o.c.line < 0 || (!o.c.mv || o.c.mv.j !== j) && (!o.c.mv0 || o.c.mv0.j !== j)) j.active.splice(i, 1); }
        if (j.pend.length) for (let i = j.pend.length - 1; i >= 0; i--) { const o = j.pend[i]; if (o.c.line < 0 || o.c.wj !== j || t - o.since > 180) j.pend.splice(i, 1); }
        for (let x = 0; x < j.active.length; x++) for (let y = x + 1; y < j.active.length; y++) {
          const p = j.active[x], q = j.active[y];
          const pair = `${j.id}:${carId(p.c)}:${p.k}:${p.m}:${carId(q.c)}:${q.k}:${q.m}`; // (a pair once: a car asks again every frame while it waits, or crosses two close junctions together)
          if (conflict(j, p.k, p.m, q.k, q.m) && !seenPairs.has(pair)) { seenPairs.add(pair); if (p.forced || q.forced) crossedOver++; else crossed++; if (crossLog.length < 20) { crossLog.push(`${p.forced || q.forced ? 'over the line: ' : ''}junction ${j.id}${j.sig ? ` phase ${j.ph} ${j.st} at ${j.t.toFixed(1)} s` : ''}: arm ${p.k} to ${p.m} in at ${p.t} and arm ${q.k} to ${q.m} in at ${q.t}${p.c === q.c ? ', the same car' : ''}, now ${t.toFixed(1)}${p.forced ? ` (the first over the line: ${p.c.overWhy})` : q.forced ? ` (the second over the line: ${q.c.overWhy})` : ''}`); } }
        }
        if (!j.sig) continue;
        j.t += dt;
        // the phase after this one: the main road's (0), its arrow (2) when someone waits to turn
        // across, the cross road's (1); a call from another phase ends this one's green
        const D = j.seen >= frame - 2 ? j.demand : NONE, arrowCall = j.arrow && D[2];
        const call = j.scramble ? 1 : j.mid != null ? (j.ph === 0 ? D[1] : 1) : j.ph === 0 ? D[1] || arrowCall : j.ph === 1 ? D[0] || arrowCall : 1; // (a crossing's walk, once called, always ends)
        j.call = !!call;
        const wasWalk = j.walkNow;
        const held = j.hold != null && j.hold >= frame - 2 && j.ph !== 2 && j.t < j.green[j.ph] + HOLD; // (a vehicle with priority coming: held green for it)
        // gap-out (as SCATS and vehicle-actuated signals do): someone waits on another phase and no
        // car is coming on this one, so its green ends after GAP_MIN, the walk over first (FLASH); never
        // the scramble's walk (phase 3), which no car is coming on and whose crowd is out in the road
        if (j.st === 'g' && j.cut == null && call && !D[j.ph] && j.ph !== 2 && j.ph !== 3 && !(j.mid != null && j.ph === 1) && j.t >= GAP_MIN - FLASH) j.cut = Math.max(j.t, GAP_MIN - FLASH) + FLASH;
        const end = j.gEnd = j.cut != null ? Math.min(j.green[j.ph], j.cut) : j.green[j.ph];
        if (j.st === 'g' && !held) {
          if (j.ph === 2 ? j.t >= j.green[2] || (j.t >= 3 && !D[2]) : j.t >= end && (call || (j.t >= j.green[j.ph] + CALL && j.mid == null))) { // (a crossing's traffic keeps its green till someone calls)
            j.st = 'y'; j.t = 0; dirty.add(j);
            j.nxt = j.ph === 0 ? (arrowCall ? 2 : 1) : j.ph === 2 ? 1 : j.ph === 1 && j.scramble ? 3 : 0;
          }
        } else if (j.st === 'y' && j.t >= j.amber) { j.st = 'r'; j.t = 0; dirty.add(j); }
        else if (j.st === 'r' && j.t >= (j.allred || ALLRED)) { j.ph = j.nxt; j.st = 'g'; j.t = 0; j.cut = null; dirty.add(j); }
        j.walkNow = j.scramble ? j.ph === 3 && j.t < j.green[3] - 6 : !(j.call && j.t > end - FLASH);
        if (j.walkNow !== wasWalk) dirty.add(j); // (the walk signals: the walk is over)
      }
      if (heads) heads.update(dirty);
      dirty.clear();
    }
    // where the crowd's footways (fnet: actors.network) cross the arms' roads at the junctions with
    // signals, from the junction's node out to just past the stop line: per footway line, [{ s
    // (along it), a (the arm), kerb (from there back to the kerb, along the footway) }]
    function crossings(fnet) {
      const out = new Map(), F = fnet.L, R2 = [];
      let n = 0;
      for (const j of J) {
        if (!j.sig) continue;
        if (j.stripes) { n += stripeCrossings(j, fnet, out); continue; }
        for (const a of j.arms) {
          const l = L[a.line], d1 = Math.min(l.len, a.back + 2.5);
          R2.length = 0;
          for (let d = 0; d <= d1 + 1e-6; d += 1) { net.at(a.line, Math.max(0, Math.min(l.len, alongArm(l, a, d))), tmp); R2.push(tmp.x, tmp.y); }
          const half = (ROADW[a.c] || 7) / 2;
          for (const fi of new Set(fnet.near(a.x, a.y, 0, d1 + 12))) {
            const f = F[fi], m = f.pts.length / 3;
            for (let k = 1; k < m; k++) {
              const ax = f.pts[3 * k - 3], ay = f.pts[3 * k - 2], ex = f.pts[3 * k] - ax, ey = f.pts[3 * k + 1] - ay, fl = Math.hypot(ex, ey);
              if (fl < 1e-3) continue;
              for (let r = 2; r < R2.length; r += 2) {
                const bx = R2[r - 2], by = R2[r - 1], gx = R2[r] - bx, gy = R2[r + 1] - by, den = ex * gy - ey * gx;
                if (Math.abs(den) < 1e-6) continue;
                const u = ((bx - ax) * gy - (by - ay) * gx) / den, v = ((bx - ax) * ey - (by - ay) * ex) / den;
                if (u < 0 || u > 1 || v < 0 || v > 1) continue;
                const sin = Math.abs(den) / (fl * Math.hypot(gx, gy));
                if (sin < 0.5) continue; // along the road, not across it
                if (!out.has(fi)) out.set(fi, []);
                out.get(fi).push({ s: f.cum[k - 1] + u * fl, a, kerb: Math.min(10, (half + 0.2) / sin) });
                n++;
              }
            }
          }
        }
      }
      out.count = n;
      return out;
    }
    // A scramble's crosswalks as the city maps them (scene landmarks.scramble.lines): a footway that runs along
    // one crosses there, the kerbs at the stripes' two ends, the diagonals too. (Its arms' roads meet at a node in
    // the middle of the crossing, so the kerbs found from them would stand out in the road.)
    function stripeCrossings(j, fnet, out) {
      const F = fnet.L;
      let n = 0;
      for (const [[ax, ay], [bx, by]] of j.stripes) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
        for (const fi of new Set(fnet.near(mx, my, 0, len / 2 + 6))) {
          const f = F[fi], m = f.pts.length / 3;
          let best = null;
          for (let k = 1; k < m; k++) { // the footway's point nearest the stripes' middle, on a piece along them
            const px = f.pts[3 * k - 3], py = f.pts[3 * k - 2], ex = f.pts[3 * k] - px, ey = f.pts[3 * k + 1] - py, fl = Math.hypot(ex, ey);
            if (fl < 1e-3 || Math.abs(ex * ux + ey * uy) / fl < 0.9) continue;
            const u = Math.max(0, Math.min(1, ((mx - px) * ex + (my - py) * ey) / (fl * fl))), d = Math.hypot(px + ex * u - mx, py + ey * u - my);
            if (d < 2.5 && (!best || d < best.d)) best = { d, s: f.cum[k - 1] + u * fl };
          }
          if (!best) continue;
          if (!out.has(fi)) out.set(fi, []);
          out.get(fi).push({ s: best.s, a: j.arms[0], kerb: len / 2 + 0.2, scramble: true });
          n++;
        }
      }
      return n;
    }
    // the arm a car on `line` heading for its end `end` comes up to, or null (not a junction, or inside one)
    const armAt = (line, end) => { const a = armOf.get(line * 2 + end); if (!a || !a.in) return null; if (!a.j.ready) prepare(a.j); return a; };
    // ------------------------------------------------ the signal heads
    let heads = null;
    function build(world, { style = {}, ground = null, eye = null } = {}) {
      heads = signalHeads(world, J, net, { style, side, lane, ground, light, arrow, walk });
      if (heads && eye) heads.watch(eye);
      return heads;
    }
    function stats() {
      const sj = J.filter(j => j.sig && j.mid == null);
      return { overLine, crossedOver, crossLog, junctions: J.length, signals: sj.length, arrows: sj.filter(j => j.arrow).length, bans: nBans, timedBans: nBansT, timedShut: L.filter(l => l.tb).length, bannedExits: J.reduce((n, j) => n + j.arms.reduce((m, a) => m + (a.bans || 0), 0), 0), mapped: J.filter(j => j.sig && j.mapped).length, heads: heads ? heads.count : 0, midSignals: nMid, zebras: nZebra, scrambles: nScramble,
        stops: J.reduce((n, j) => n + j.arms.filter(a => a.sign === 'stop').length, 0), giveWays: J.reduce((n, j) => n + j.arms.filter(a => a.sign === 'give_way').length, 0) };
    }
    // the crossings between junctions on a piece, along it (or null)
    const midsOn = line => mids.get(line) || null;
    net.midsOn = midsOn; // (the rides' router notes the crossings along a route: cars.js)
    return { J, midsOn, armAt, exits, choose, laneRun, setClock, shutNow, closedNow, light, arrow, walk, call, walkIn, crossings, lanesOf, shiftOf, mv, approach, priority, toGreen, request, enter, after, reach, wait, unwait, release, forget, update, build, stats, conflict, conflicts, inner, get heads() { return heads; } };
  }

  // ------------------------------------------------------------ signal heads
  // the style of a country's signals: lanterns vertical or horizontal (Japan), on poles at the kerb
  // or on arms over the road, their colours. A city may set its own (game.signals in city.json).
  const STYLES = {
    default: { layout: 'vertical', pole: '#5d6266', housing: '#1b1d1f', board: '#141516', border: '#d9d6cc', mast: 4, far: true },
    Australia: { layout: 'vertical', pole: '#8e9398', housing: '#17191b', board: '#121314', border: '#e2dfd4', mast: 4, far: true },
    Japan: { layout: 'horizontal', pole: '#a3a7a8', housing: '#9ea2a3', board: null, border: null, mast: 1, far: true },
    France: { layout: 'vertical', pole: '#3b4145', housing: '#24292c', board: null, border: null, mast: 99, far: true },
    Netherlands: { layout: 'vertical', pole: '#2a2d30', housing: '#16181a', board: '#16181a', border: '#e8e6e0', mast: 99, far: true },
    China: { layout: 'vertical', pole: '#6f7478', housing: '#1a1c1e', board: '#141516', border: null, mast: 4, far: true },
  };
  const LIT = { r: [3.4, 0.16, 0.05], y: [3.1, 1.25, 0.04], g: [0.1, 2.3, 1.05] }; // linear, bright enough to bloom
  const DARK = { r: [0.07, 0.012, 0.01], y: [0.07, 0.045, 0.01], g: [0.01, 0.06, 0.045] };
  const WALK = { r: [3.0, 0.22, 0.08], g: [0.4, 3.0, 2.0], off: [0.035, 0.03, 0.028] }; // the walk signals' figures, lit and dark
  function signalHeads(world, J, net, { style = {}, side = 1, lane = 1.7, ground = null, light, arrow = () => '', walk = () => true }) {
    const S = Object.assign({}, STYLES.default, STYLES[style.country] || {}, style), horiz = S.layout === 'horizontal';
    const list = []; // poles: { a (the arm it faces), x, y, z, h (the way its lanterns face: towards the arm's traffic), mast (its arm's length), side (+1 on the keep side) }
    const tmp = {};
    for (const j of J) {
      if (!j.sig) continue;
      for (const a of j.arms) {
        if (!a.in) continue;
        const l = net.L[a.line], d = a.back + 0.8, s = alongArm(l, a, d);
        net.at(a.line, Math.max(0, Math.min(l.len, s)), tmp);
        const dir = a.end ? 1 : -1, hx = tmp.hx * dir, hy = tmp.hy * dir; // the way the arm's traffic drives
        const kerb = (ROADW[a.c] || 7) / 2 + 0.7;
        const gz = (x, y) => { const g = ground ? ground(x, y, tmp) : null; return g != null ? g : tmp.z; };
        // the near-side pole at the stop line, the lantern facing the driver (who comes along h)
        const h = Math.atan2(-hx, -hy), rank = a.rank;
        const px = tmp.x - hy * kerb * side, py = tmp.y + hx * kerb * side;
        const mast = rank >= S.mast ? Math.max(0, kerb - lane - (horiz ? 0 : 0.2)) : 0; // out over the lane
        list.push({ a, x: px, y: py, z: gz(px, py), h, mast, side });
        // the far one, across the junction on the other side, for the same arm
        if (S.far && a.j.arms.length >= 3) {
          const far = a.back + Math.max(...a.j.arms.filter(b => b !== a).map(b => b.back)) + Math.min(14, 2 * Math.hypot(a.x - a.j.x, a.y - a.j.y) + 2);
          const fx = tmp.x + hx * far + hy * kerb * side, fy = tmp.y + hy * far - hx * kerb * side;
          if (net.nearest(fx, fy, 2.2)) continue; // that would stand in a road
          list.push({ a, x: fx, y: fy, z: gz(fx, fy), h, mast: 0, side: -side });
        }
      }
    }
    const n = list.length;
    if (!n) return null;
    const mat = hex => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.55, metalness: 0.35 });
    const geo = {};
    // a lantern: the housing, the board behind it, a visor over each lamp; faces +z, centred on its middle lamp
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const merge = parts => { // the parts as one geometry (positions and normals)
      let n2 = 0;
      const gs = parts.map(g => g.index ? g.toNonIndexed() : g);
      for (const g of gs) n2 += g.attributes.position.count;
      const P = new Float32Array(n2 * 3), N = new Float32Array(n2 * 3);
      let o = 0;
      for (const g of gs) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
      return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(P, 3)).setAttribute('normal', new THREE.BufferAttribute(N, 3));
    };
    const step = 0.3, lamps = [-1, 0, 1]; // the lamps' places along the lantern
    const at = i => (horiz ? [lamps[i] * step, 0] : [0, -lamps[i] * step]); // red first: on top, or on the right of a horizontal one (Japan: green, amber, red from the left)
    const visor = i => { const [x, y] = at(i); return new THREE.CylinderGeometry(0.125, 0.125, 0.2, 10, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, y + 0.005, 0.2); };
    geo.housing = merge([horiz ? box(1.02, 0.36, 0.22, 0, 0, 0) : box(0.36, 1.0, 0.22, 0, 0, 0), visor(0), visor(1), visor(2)]);
    if (S.board) geo.board = horiz ? box(1.3, 0.62, 0.02, 0, 0, -0.12) : box(0.6, 1.28, 0.02, 0, 0, -0.12);
    if (S.border) { // a thin bright rim on the board's face, as on the lanterns' target boards (black from behind)
      const [bw, bh] = horiz ? [1.3, 0.62] : [0.6, 1.28], t = 0.045, z = -0.105;
      geo.border = merge([box(bw, t, 0.012, 0, bh / 2 - t / 2, z), box(bw, t, 0.012, 0, -bh / 2 + t / 2, z), box(t, bh, 0.012, bw / 2 - t / 2, 0, z), box(t, bh, 0.012, -bw / 2 + t / 2, 0, z)]);
    }
    geo.lens = new THREE.CircleGeometry(0.105, 18).translate(0, 0, 0.115);
    const pole = new THREE.CylinderGeometry(0.07, 0.085, 1, 8).translate(0, 0.5, 0); // scaled to its height
    const armG = new THREE.CylinderGeometry(0.055, 0.065, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0); // along +x, scaled to its length
    const meshes = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const inst = (g, m, count) => { const M = new THREE.InstancedMesh(g, m, count); M.castShadow = true; M.receiveShadow = true; M.matrixAutoUpdate = false; meshes.push(M); world.add(M); return M; };
    // lanterns: one bracketed to every pole at head height and a little (out: m) towards the road, and
    // one hung over the lane from a mast; Japan's are all over the road, but on a pole without an arm
    const lanterns = [];
    for (const o of list) {
      if (!horiz || !o.mast) lanterns.push({ o, out: 0.32, up: horiz ? 3.0 : 2.75 });
      if (o.mast) lanterns.push({ o, out: o.mast, up: horiz ? 5.72 : 5.3 });
    }
    // arrow lanterns: beside the lantern over the lane (towards the middle of the road), or the
    // pole's own; Japan's under the lantern
    const arrows = [];
    for (const o of list) {
      if (o.side !== side || !o.a.j.arrow || o.a.phase !== 0) continue;
      arrows.push(horiz ? { o, out: o.mast || 0.32, up: (o.mast ? 5.72 : 3.0) - 0.45 } : { o, out: (o.mast || 0.32) + (geo.board ? 0.66 : 0.5), up: o.mast ? 5.3 : 2.75 });
    }
    // walk signals: a slim post on each kerb of every arm's crossing, the lantern facing across
    const peds = [];
    for (const j of J) {
      if (!j.sig) continue;
      for (const a of (j.mid != null ? j.arms.slice(0, 1) : j.arms)) { // (a crossing between junctions: one post on each kerb)
        const l = net.L[a.line], d = Math.max(1.5, a.back - 1.6), s = alongArm(l, a, d);
        net.at(a.line, Math.max(0, Math.min(l.len, s)), tmp);
        const kerb = (ROADW[a.c] || 7) / 2 + 0.55;
        for (const k of [1, -1]) {
          const px = tmp.x - tmp.hy * kerb * k, py = tmp.y + tmp.hx * kerb * k;
          if (net.nearest(px, py, 2.0)) continue; // that would stand in a road
          const g = ground ? ground(px, py, tmp) : null;
          peds.push({ a, x: px, y: py, z: g != null ? g : tmp.z, h: Math.atan2(tmp.hy * k, -tmp.hx * k) }); // (facing across, to the far kerb)
        }
      }
    }
    const poleM = inst(pole, mat(S.pole), list.length), arms = list.filter(o => o.mast), armM = arms.length ? inst(armG, mat(S.pole), arms.length) : null;
    const housM = inst(geo.housing, mat(S.housing), lanterns.length);
    const boardM = geo.board ? inst(geo.board, mat(S.board), lanterns.length) : null, borderM = geo.border ? inst(geo.border, new THREE.MeshStandardMaterial({ color: lin(S.border), roughness: 0.4 }), lanterns.length) : null;
    const lensM = [0, 1, 2].map(() => { const M = inst(geo.lens, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), lanterns.length); M.castShadow = false; return M; });
    let ai = 0;
    list.forEach((o, i) => {
      q.setFromAxisAngle(up, Math.PI - o.h);
      const top = (o.mast ? 6.0 : 3.25);
      m4.compose(W(o.x, o.y, o.z), q, sc.set(1, top, 1));
      poleM.setMatrixAt(i, m4);
      if (o.mast) { // the arm out over the road (towards its middle: the model's +x on the keep side)
        const qa = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, o.side > 0 ? 0 : Math.PI));
        m4.compose(W(o.x, o.y, o.z + 5.95), qa, sc.set(o.mast + 0.3, 1, 1));
        armM.setMatrixAt(ai++, m4);
      }
    });
    // the lamp lenses: [mesh, instance] per lantern, coloured by its arm's light
    const lamp = [];
    lanterns.forEach((L2, i) => {
      const o = L2.o;
      q.setFromAxisAngle(up, Math.PI - o.h);
      // towards the road from its pole: the left of the way it faces, on the keep side
      const out = L2.out * o.side, x = o.x - Math.cos(o.h) * out, y = o.y + Math.sin(o.h) * out;
      m4.compose(W(x, y, o.z + L2.up), q, sc.set(1, 1, 1));
      housM.setMatrixAt(i, m4);
      if (boardM) boardM.setMatrixAt(i, m4);
      if (borderM) borderM.setMatrixAt(i, m4);
      for (let k = 0; k < 3; k++) {
        const [lx, ly] = at(k), m = m4.clone().multiply(new THREE.Matrix4().makeTranslation(lx, ly, 0));
        lensM[k].setMatrixAt(i, m);
      }
      lamp.push(o.a);
    });
    // the arrow lanterns: a housing like the others, three arrow lamps (red, amber, green; the arrow
    // points the way of the turn across: right where the traffic keeps left)
    let arrH = null, arrL = null;
    if (arrows.length) {
      const sh = new THREE.Shape(), d = side > 0 ? 1 : -1;
      [[-0.075, 0.025], [0.01, 0.025], [0.01, 0.07], [0.085, 0], [0.01, -0.07], [0.01, -0.025], [-0.075, -0.025]].forEach(([x, y], i) => (i ? sh.lineTo(x * d, y) : sh.moveTo(x * d, y)));
      const arrowG = new THREE.ShapeGeometry(sh).translate(0, 0, 0.116);
      arrH = inst(horiz ? merge([box(1.02, 0.36, 0.22, 0, 0, 0)]) : geo.housing, mat(S.housing), arrows.length);
      const arrB = !horiz && geo.board ? inst(geo.board, mat(S.board), arrows.length) : null, arrR = !horiz && geo.border ? inst(geo.border, new THREE.MeshStandardMaterial({ color: lin(S.border), roughness: 0.4 }), arrows.length) : null;
      // (Japan's: left, ahead and right, green only, under the lantern; the turn's lights on its arrow)
      const turnG = k => (k === 1 ? arrowG.clone().rotateZ(Math.PI / 2 * d) : k === (d > 0 ? 0 : 2) ? arrowG.clone().rotateZ(Math.PI) : arrowG);
      arrL = [0, 1, 2].map(k => { const M = inst(horiz ? turnG(k) : arrowG, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, side: THREE.DoubleSide }), arrows.length); M.castShadow = false; return M; });
      arrows.forEach((A, i) => {
        const o = A.o;
        q.setFromAxisAngle(up, Math.PI - o.h);
        const out = A.out * o.side, x = o.x - Math.cos(o.h) * out, y = o.y + Math.sin(o.h) * out;
        m4.compose(W(x, y, o.z + A.up), q, sc.set(1, 1, 1));
        arrH.setMatrixAt(i, m4);
        if (arrB) arrB.setMatrixAt(i, m4);
        if (arrR) arrR.setMatrixAt(i, m4);
        for (let k = 0; k < 3; k++) { const [lx, ly] = at(k); arrL[k].setMatrixAt(i, m4.clone().multiply(new THREE.Matrix4().makeTranslation(lx, ly, 0))); }
      });
    }
    // the walk signals: post, housing, the red figure over the green one (lit or dark)
    let pedPole = null, pedH = null, pedL = null;
    if (peds.length) {
      const fig = walking => { // a figure, white on clear, to be tinted
        const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 7;
        g.beginPath(); g.arc(32, 11, 6.5, 0, 6.3); g.fill();
        const seg = (a, b, c2, d2) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); };
        if (walking) { seg(32, 22, 29, 40); seg(29, 40, 19, 58); seg(29, 40, 40, 57); seg(31, 25, 20, 36); seg(31, 25, 43, 34); }
        else { g.lineWidth = 9; seg(32, 22, 32, 40); g.lineWidth = 7; seg(29, 40, 27, 58); seg(35, 40, 37, 58); seg(28, 24, 22, 40); seg(36, 24, 42, 40); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      };
      pedPole = inst(new THREE.CylinderGeometry(0.05, 0.06, 1, 6).translate(0, 0.5, 0), mat(S.pole), peds.length);
      pedH = inst(box(0.3, 0.62, 0.17, 0, 0, 0), mat(S.housing), peds.length);
      pedL = [false, true].map(w => { const M = inst(new THREE.PlaneGeometry(0.22, 0.22).translate(0, w ? -0.14 : 0.14, 0.088), new THREE.MeshBasicMaterial({ color: 0xffffff, map: fig(w), transparent: true, alphaTest: 0.3, toneMapped: true }), peds.length); M.castShadow = false; return M; });
      peds.forEach((o, i) => {
        q.setFromAxisAngle(up, Math.PI - o.h);
        m4.compose(W(o.x, o.y, o.z), q, sc.set(1, 2.55, 1)); pedPole.setMatrixAt(i, m4);
        m4.compose(W(o.x, o.y, o.z + 2.2), q, sc.set(1, 1, 1));
        pedH.setMatrixAt(i, m4); pedL[0].setMatrixAt(i, m4); pedL[1].setMatrixAt(i, m4);
      });
    }
    for (const M of meshes) { M.instanceMatrix.needsUpdate = true; M.computeBoundingSphere && M.computeBoundingSphere(); }
    // the glow of the lit lamps after dark (and a little by day): one point per lantern, at its lit lamp
    const gpos = new Float32Array(lanterns.length * 3), gcol = new Float32Array(lanterns.length * 3);
    const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const glowMat = new THREE.PointsMaterial({ size: 2.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true });
    const glowGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(gpos, 3)).setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    const glows = new THREE.Points(glowGeo, glowMat);
    glows.frustumCulled = false;
    world.add(glows);
    const aShown = new Array(arrows.length).fill(null), pShown = new Array(peds.length).fill(null);
    const shown = new Array(lanterns.length).fill(''), c3 = new THREE.Color(), lp = new THREE.Vector3(), mm = new THREE.Matrix4();
    const order = horiz ? { g: 0, y: 1, r: 2 } : { r: 0, y: 1, g: 2 };
    // a lamp's glow is seen from in front of it: towards the eye, faded out beside it and gone behind
    const face = lanterns.map(L2 => [Math.sin(L2.o.h), Math.cos(L2.o.h)]), lit = new Array(lanterns.length).fill(null);
    let eyeAt = null, tick = 0;
    // each junction's lamps, arrows and walk signals, so a change re-lights only its own
    const byJ = new Map(), of = j => { if (!byJ.has(j)) byJ.set(j, { L: [], A: [], P: [] }); return byJ.get(j); };
    lamp.forEach((a, i) => of(a.j).L.push(i));
    arrows.forEach((A, i) => of(A.o.a.j).A.push(i));
    peds.forEach((o, i) => of(o.a.j).P.push(i));
    const flashing = j => j.st === 'g' && j.walkNow === false && (!j.scramble || j.ph === 3); // (its walk is over, its red figures flash)
    let first = true, lastBlink = null;
    // dirty: the junctions whose signals changed (all of them the first time)
    function update(dirty = null) {
      let changed = false, ch2 = false;
      const blink = (performance.now() % 1000) < 550, all = first || !dirty;
      first = false;
      const each = (fn, key, also = null) => { // fn(i) for the lamps of `key` at the junctions changed (and those also() picks)
        if (all) { for (const g of byJ.values()) for (const i of g[key]) fn(i); return; }
        for (const j of dirty) { const g = byJ.get(j); if (g) for (const i of g[key]) fn(i); }
        if (also) for (const [j, g] of byJ) if (!dirty.has(j) && also(j)) for (const i of g[key]) fn(i);
      };
      each(i => {
        const s = light(lamp[i]) || 'r';
        if (shown[i] === s) return;
        shown[i] = s; changed = true;
        for (const k of ['r', 'y', 'g']) { const C = s === k ? LIT[k] : DARK[k]; lensM[order[k]].setColorAt(i, c3.setRGB(C[0], C[1], C[2])); }
        lensM[order[s]].getMatrixAt(i, mm);
        lp.setFromMatrixPosition(mm);
        gpos[3 * i] = lp.x; gpos[3 * i + 1] = lp.y; gpos[3 * i + 2] = lp.z;
        lit[i] = LIT[s];
      }, 'L');
      if (changed) {
        for (const M of lensM) if (M.instanceColor) M.instanceColor.needsUpdate = true;
        glowGeo.attributes.position.needsUpdate = true;
      }
      // the arrows and the walk signals (the red figure flashes while the walk is over but the
      // arm's traffic is still held)
      if (arrows.length) each(i => {
        const s = arrow(arrows[i].o.a);
        if (aShown[i] === s) return;
        aShown[i] = s; ch2 = true;
        if (horiz) for (let k = 0; k < 3; k++) { const C = s === 'g' && k === (side > 0 ? 2 : 0) ? LIT.g : DARK.g; arrL[k].setColorAt(i, c3.setRGB(C[0], C[1], C[2])); }
        else for (const k of ['r', 'y', 'g']) { const C = s === k ? LIT[k] : DARK[k]; arrL[order[k]].setColorAt(i, c3.setRGB(C[0], C[1], C[2])); }
      }, 'A');
      if (ch2) for (const M of arrL) M.instanceColor.needsUpdate = true;
      ch2 = false;
      if (peds.length) each(i => {
        const a = peds[i].a, w = walk(a), held = !w && (a.j.scramble ? a.j.ph === 3 : a.j.ph !== a.phase) && a.j.st === 'g', s = w ? 'g' : held && !blink ? 'o' : 'r';
        if (pShown[i] === s) return;
        pShown[i] = s; ch2 = true;
        const R = s === 'r' ? WALK.r : WALK.off, G = s === 'g' ? WALK.g : WALK.off;
        pedL[0].setColorAt(i, c3.setRGB(R[0], R[1], R[2])); pedL[1].setColorAt(i, c3.setRGB(G[0], G[1], G[2]));
      }, 'P', blink !== lastBlink ? flashing : null);
      if (ch2) for (const M of pedL) M.instanceColor.needsUpdate = true;
      lastBlink = blink;
      if (eyeAt && (changed || ++tick % 4 === 0)) { // (in plan: x east, y north = -z; a few times a second will do)
        const ex = eyeAt.position.x, ey = -eyeAt.position.z;
        for (let i = 0; i < lamp.length; i++) {
          const dx = ex - gpos[3 * i], dy = ey + gpos[3 * i + 2], d = Math.hypot(dx, dy) || 1, C = lit[i];
          const f = d > 600 ? 0 : Math.max(0, Math.min(1, ((dx * face[i][0] + dy * face[i][1]) / d - 0.15) / 0.5)) / 3.5;
          gcol[3 * i] = C[0] * f; gcol[3 * i + 1] = C[1] * f; gcol[3 * i + 2] = C[2] * f;
        }
        glowGeo.attributes.color.needsUpdate = true;
      }
    }
    function watch(eye) { eyeAt = eye; }
    // after dark the lamps' glow shows (night: 0 by day to 1 at night)
    function setNight(night) { glowMat.opacity = 0.12 + 0.88 * night; glowMat.size = 1.4 + 1.6 * night; }
    setNight(0);
    update();
    return { count: lanterns.length, poles: list.length, arrows: arrows.length, walks: peds.length, update, setNight, watch, meshes, glows, list,
      peds }; // (the walk signals, { a: its arm, x, y, z, h }: walkcalls.js sounds them)
  }

  return { create, STYLES, RANK, lanesOf, shiftOf };
})();
