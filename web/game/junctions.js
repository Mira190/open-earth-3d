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
//   the box  a car goes in only when its movement (from its arm to its exit) crosses no movement
//            already in the junction, and when there is room for it on its exit beyond the
//            junction, so a queue never locks a junction up. A car that has waited longest goes
//            first: one turning across the oncoming traffic gets its turn.
// The signal heads are modelled here: a pole at the kerb by the stop line with its lantern facing
// the arm, a second one across the junction, and on a main road a mast arm with a lantern over the
// lane; vertical red, amber, green, or Japan's horizontal lights on an arm over the road. Their
// lamps follow the phases and glow after dark.
'use strict';
window.OEJunctions = (function () {
  const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1 };
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const LINK = 24;      // a piece this short joining two junction nodes lies inside one junction (m)
  const SPAN = 42;      // and a junction is no wider than this (m)
  const AMBER = 3.5, ALLRED = 2, CALL = 24; // seconds; a phase with nobody waiting on the other turns after CALL more
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // net: actors.network of the roads; opts.signals, .stops, .giveWay: mapped points [x, y, z, ...]
  // in decimetres; keep: the side the traffic keeps to; lane: its lane's offset from the line (m)
  function create(net, { signals = null, stops = [], giveWay = [], keep = 'left', lane = 1.7 } = {}) {
    const L = net.L, side = keep === 'right' ? -1 : 1, tmp = {};
    const nodeKey = (line, end) => { const l = L[line], k = end ? l.pts.length / 3 - 1 : 0; return net.key(l.pts[3 * k], l.pts[3 * k + 1]); };
    // can a car leave a node along line `line` from its end `end` (0: with its points)?
    const canLeave = (line, end) => (end === 0 ? L[line].ow !== -1 : L[line].ow !== 1);
    const canReach = (line, end) => (end === 1 ? L[line].ow !== -1 : L[line].ow !== 1);
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
        j.green = [16 + 2 * top(0), 10 + 1.5 * top(1)];
        const fast = Math.max(...j.arms.map(a => L[a.line].v || 11));
        j.amber = fast > 16 ? AMBER + 1 : AMBER;
        j.ph = rnd() < 0.5 ? 0 : 1; j.st = 'g'; j.t = rnd() * j.green[j.ph]; // each junction somewhere in its cycle
        for (const a of j.arms) a.sign = null; // the lights rule here
      }
      j.active = []; j.pend = []; j.near = []; j.demand = [0, 0]; j.seen = -1;
    }
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
            out.push({ m, steps, turn: angle(m.out, a.out + Math.PI) });
          }
        }
      }
      // not the other carriageway of the same road, back the way it came, unless that is all there is
      const fwd = out.filter(e => Math.abs(e.turn) < 2.6);
      a.exits = fwd.length ? fwd : out;
      return a.exits;
    }
    // choose an exit: ahead more often than a turn, and a main road more often than a lane
    function choose(a) {
      const ex = exits(a);
      if (!ex.length) return null;
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
    function wayOf(a, e) {
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
      const n = Q.length / 2, k0 = Math.round(behind / PSTEP), k1 = Math.max(k0 + 1, n - 2), out = [], off = lane * side; // (not the two points past the far line)
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
    function waiting(a) {
      const l = L[a.line], d = a.back + 2.5, s = a.end ? l.len - d : d, dir = a.end ? 1 : -1;
      net.at(a.line, Math.max(0, Math.min(l.len, s)), tmp);
      const hx = tmp.hx * dir, hy = tmp.hy * dir, off = lane * side;
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
      const ways = () => { for (const a of ins) for (const e of a.exits) e.way = wayOf(a, e); };
      for (let pass = 0; pass < 2; pass++) {
        ways();
        for (const a of ins) {
          const max = Math.max(a.back, Math.min(16, L[a.line].len * 0.6));
          for (let w = waiting(a); a.back < max && ins.some(b => b !== a && b.exits.some(e => e.m !== a && inWay(w, e.way, 2.4 + 0.6, 0.95 + 1.1))); w = waiting(a)) a.back = Math.min(max, a.back + 0.6);
        }
      }
      ways();
      j.cx = new Map();
    }
    const wayFor = (j, k, m) => (j.arms[k].exits || []).find(e => e.m.i === m);
    function conflict(j, k, m, k2, m2) {
      if (k === k2) return false; // one behind the other: the car ahead is braked for
      if (m === m2) return true;  // into the same road
      const C = j.cx || (j.cx = new Map()), key = ((k * 16 + m) * 16 + k2) * 16 + m2;
      if (C.has(key)) return C.get(key);
      const e1 = wayFor(j, k, m), e2 = wayFor(j, k2, m2);
      const v = !e1 || !e2 || !e1.way || !e2.way || close(e1.way, e2.way, 2.8);
      C.set(key, v);
      return v;
    }
    // the light an arm shows: 'g', 'y' or 'r', or null where there are no signals
    function light(a) {
      const j = a.j;
      if (!j.sig) return null;
      return j.ph !== a.phase ? 'r' : j.st === 'g' ? 'g' : j.st === 'y' ? 'y' : 'r';
    }
    let frame = 0;
    // a car coming up arm a, `eta` seconds from its stop line, to leave by exit m (or -1): seen by
    // the signals (a call for its phase) and by cars giving way to it
    function approach(c, a, m, eta) {
      const j = a.j;
      if (j.seen !== frame) { j.seen = frame; j.near.length = 0; j.demand[0] = j.demand[1] = 0; }
      // (the cars coming this frame; the requests before them in the frame see the last frame's)
      j.near.push({ c, k: a.i, m, eta, rank: a.sign ? 0 : a.rank });
      if (eta < 12) j.demand[a.phase] = 1;
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
      const j = a.j, k = a.i, m = e.m.i;
      for (const o of j.active) if (o.c === c) return true;
      for (const o of j.active) if (o.k !== k && (c.half > LONG || o.c.half > LONG) || conflict(j, k, m, o.k, o.m)) return 'cross';
      const mine = j.pend.find(o => o.c === c);
      for (const o of j.pend) {
        if (o === mine || (mine && o.since >= mine.since) || t - o.since < WAITED || o.c.line < 0) continue;
        if (j.sig && light(j.arms[o.k]) === 'r') continue; // (its light has turned red since)
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
      const m = e.m, a2 = armOf.get(m.line * 2 + 1 - m.end);
      return L[m.line].len - m.back - (a2 && a2.in && a2.j !== m.j ? a2.back : 0);
    }
    function enter(c, a, e, t, forced = false) { // into the junction: its movement joins those in it
      const j = a.j;
      if (forced) overLine++; // (a car already over the line: the checks count these)
      unwait(c);
      if (c.mv && c.mv.j === j) release(c);
      else if (c.mv) { release(c, 'mv0'); c.mv0 = c.mv; } // still leaving the last one
      j.active.push({ c, k: a.i, m: e.m.i, t });
      c.mv = { j, a, e }; c.mvT = t;
    }
    // car c is waiting at the line for its movement: the longest waiting goes first
    function wait(c, a, e, t) {
      const j = a.j;
      if (!j.pend.some(o => o.c === c)) j.pend.push({ c, k: a.i, m: e.m.i, since: t });
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
    // movements in one junction at once that cross, pairs (by construction none but where a car
    // found itself over a line, put back there or turned round: the checks count both)
    let crossed = 0, overLine = 0;
    const seenPairs = new Set();
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
          if (conflict(j, p.k, p.m, q.k, q.m) && !seenPairs.has(p.t + ':' + q.t + ':' + j.id)) { seenPairs.add(p.t + ':' + q.t + ':' + j.id); crossed++; }
        }
        if (!j.sig) continue;
        j.t += dt;
        const other = 1 - j.ph, call = j.seen >= frame - 2 ? j.demand[other] : 0;
        if (j.st === 'g' && j.t >= j.green[j.ph] && (call || j.t >= j.green[j.ph] + CALL)) { j.st = 'y'; j.t = 0; }
        else if (j.st === 'y' && j.t >= j.amber) { j.st = 'r'; j.t = 0; }
        else if (j.st === 'r' && j.t >= ALLRED) { j.ph = other; j.st = 'g'; j.t = 0; }
      }
      if (heads) heads.update();
    }
    // the arm a car on `line` heading for its end `end` comes up to, or null (not a junction, or inside one)
    const armAt = (line, end) => { const a = armOf.get(line * 2 + end); if (!a || !a.in) return null; if (!a.j.ready) prepare(a.j); return a; };
    // ------------------------------------------------ the signal heads
    let heads = null;
    function build(world, { style = {}, ground = null, eye = null } = {}) {
      heads = signalHeads(world, J, net, { style, side, lane, ground, light });
      if (heads && eye) heads.watch(eye);
      return heads;
    }
    function stats() {
      const sj = J.filter(j => j.sig);
      return { overLine, junctions: J.length, signals: sj.length, mapped: J.filter(j => j.sig && j.mapped).length, heads: heads ? heads.count : 0,
        stops: J.reduce((n, j) => n + j.arms.filter(a => a.sign === 'stop').length, 0), giveWays: J.reduce((n, j) => n + j.arms.filter(a => a.sign === 'give_way').length, 0) };
    }
    return { J, armAt, exits, choose, light, approach, request, enter, after, reach, wait, unwait, release, forget, update, build, stats, conflict, conflicts, inner, get heads() { return heads; } };
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
  function signalHeads(world, J, net, { style = {}, side = 1, lane = 1.7, ground = null, light }) {
    const S = Object.assign({}, STYLES.default, STYLES[style.country] || {}, style), horiz = S.layout === 'horizontal';
    const list = []; // poles: { a (the arm it faces), x, y, z, h (the way its lanterns face: towards the arm's traffic), mast (its arm's length), side (+1 on the keep side) }
    const tmp = {};
    for (const j of J) {
      if (!j.sig) continue;
      for (const a of j.arms) {
        if (!a.in) continue;
        const l = net.L[a.line], d = a.back + 0.8, s = a.end ? l.len - d : d;
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
    const shown = new Array(lanterns.length).fill(''), c3 = new THREE.Color(), lp = new THREE.Vector3(), mm = new THREE.Matrix4();
    const order = horiz ? { g: 0, y: 1, r: 2 } : { r: 0, y: 1, g: 2 };
    // a lamp's glow is seen from in front of it: towards the eye, faded out beside it and gone behind
    const face = lanterns.map(L2 => [Math.sin(L2.o.h), Math.cos(L2.o.h)]), lit = new Array(lanterns.length).fill(null);
    let eyeAt = null, tick = 0;
    function update() {
      let changed = false;
      for (let i = 0; i < lamp.length; i++) {
        const s = light(lamp[i]) || 'r';
        if (shown[i] === s) continue;
        shown[i] = s; changed = true;
        for (const k of ['r', 'y', 'g']) { const C = s === k ? LIT[k] : DARK[k]; lensM[order[k]].setColorAt(i, c3.setRGB(C[0], C[1], C[2])); }
        lensM[order[s]].getMatrixAt(i, mm);
        lp.setFromMatrixPosition(mm);
        gpos[3 * i] = lp.x; gpos[3 * i + 1] = lp.y; gpos[3 * i + 2] = lp.z;
        lit[i] = LIT[s];
      }
      if (changed) {
        for (const M of lensM) if (M.instanceColor) M.instanceColor.needsUpdate = true;
        glowGeo.attributes.position.needsUpdate = true;
      }
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
    return { count: lanterns.length, poles: list.length, update, setNight, watch, meshes, glows, list };
  }

  return { create, STYLES, RANK };
})();
