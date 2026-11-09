// Where the traffic is going (#355). The cars used to pick an exit at random at every junction; now most of
// them are on a trip: from where they come into the traffic round you to one of a few places, an edge of the
// map along a main road or a place in the middle of town (a landmark's street, a wharf, the station), so that
// the flows follow the main roads, into town in the morning and out of it in the evening.
//
// No routes are kept and nothing is searched while the game runs. For each place a field is worked out once,
// the first time a car is sent there: the cost of the way to it from every piece of road, each way along it
// (a search back from the place over the street network, one-way streets and the roads to keep off
// respected, a back street dearer than its length as for the rides' router). At a junction a car looks its
// exits up in its place's field and takes the one that brings it nearest, mostly (junctions.js choose): a few
// take another, as drivers do, and three cars in ten are on no trip at all and turn as they did before.
//
// Nothing here draws, and nothing depends on the three.js version.
'use strict';
window.OETrips = (function () {
  // a road's cost by class, per metre (as cars.js ROUTE_CLS: the main roads cheaper, the back streets dearer)
  const CLS = { motorway: 0.7, trunk: 0.75, primary: 0.8, secondary: 0.9, tertiary: 1, residential: 1.5, unclassified: 1.6, living_street: 2.6, service: 2.6 };
  const RANK = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2 };
  const WANDER = 0.3; // the share of cars on no trip
  // the share of trips that go into town (the rest go out to an edge) at hour h of the day
  const inbound = h => (h >= 6.5 && h < 9.5 ? 0.75 : h >= 16 && h < 19.5 ? 0.25 : h >= 22 || h < 5 ? 0.6 : 0.5);

  // net: the road network (actors.js network); centres: [x, y] of the places in town; hour: () => the hour of the
  // day; avoid: per line, 1 for a road to keep off
  function create(net, { centres = [], hour = () => 12, rnd = Math.random, avoid = null, parkable = null, maxEdges = 8, maxCentres = 16 } = {}) {
    const L = net.L, n = L.length, ids = new Map(), arrive = [], q = {};
    const node = (x, y) => { const k = `${Math.round(x / 2)},${Math.round(y / 2)}`; let i = ids.get(k); if (i == null) { i = arrive.length; ids.set(k, i); arrive.push([]); } return i; };
    // a state is a piece driven one way: 2 * line + (1 forward, 0 back). from[s], to[s]: the nodes it leaves and comes to
    const from = new Int32Array(2 * n), to = new Int32Array(2 * n), w = new Float32Array(2 * n), deg = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const l = L[i], P = l.pts, m = P.length / 3, a = node(P[0], P[1]), b = node(P[3 * m - 3], P[3 * m - 2]);
      from[2 * i + 1] = a; to[2 * i + 1] = b; from[2 * i] = b; to[2 * i] = a;
      deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1;
      const cost = l.len * (CLS[l.c] || 1.3) * (avoid && avoid[i] ? 20 : 1);
      w[2 * i + 1] = l.ow === -1 ? Infinity : cost; w[2 * i] = l.ow === 1 ? Infinity : cost;
      if (w[2 * i + 1] < Infinity) arrive[b].push(2 * i + 1);
      if (w[2 * i] < Infinity) arrive[a].push(2 * i);
      for (const k of [0, m - 1]) { x0 = Math.min(x0, P[3 * k]); x1 = Math.max(x1, P[3 * k]); y0 = Math.min(y0, P[3 * k + 1]); y1 = Math.max(y1, P[3 * k + 1]); }
    }
    // the places. Edges: the main roads' loose ends near the map's edge (the outer eighth of it), the biggest roads
    // first, none within 300 m of one already taken. Centres: the piece of road nearest each place given
    const places = [], mx = (x1 - x0) / 8, my = (y1 - y0) / 8;
    const ends = [];
    for (let i = 0; i < n; i++) {
      const l = L[i], P = l.pts, m = P.length / 3;
      if (!RANK[l.c] || l.len < 30 || (avoid && avoid[i])) continue;
      for (const [k, nd] of [[0, from[2 * i + 1]], [m - 1, to[2 * i + 1]]]) {
        const x = P[3 * k], y = P[3 * k + 1];
        if (deg[nd] === 1 && (x < x0 + mx || x > x1 - mx || y < y0 + my || y > y1 - my)) ends.push({ line: i, x, y, rank: RANK[l.c] });
      }
    }
    ends.sort((a, b) => b.rank - a.rank || L[b.line].len - L[a.line].len);
    for (const e of ends) { if (places.length >= maxEdges) break; if (!places.some(p => Math.hypot(p.x - e.x, p.y - e.y) < 300)) places.push({ kind: 'edge', line: e.line, x: e.x, y: e.y, rank: e.rank, field: null }); }
    const nEdges = places.length;
    for (const c of centres) {
      if (places.length >= nEdges + maxCentres || !c) break;
      let p = c[2] != null ? net.nearest(c[0], c[1], 150, c[2], 3.5) || net.nearest(c[0], c[1], 150) : net.nearest(c[0], c[1], 150); // (the street at its own level, not a deck over it)
      // (a trip into town ends where a car can be left: the nearest street within 250 m with room at its kerb, actors.js kerbLo)
      if (parkable && (!p || !parkable(p.line))) {
        let bd = 250;
        for (let i = 0; i < n; i++) {
          if (!parkable(i)) continue;
          net.at(i, L[i].len / 2, q);
          const d = Math.hypot(q.x - c[0], q.y - c[1]);
          if (d < bd && (c[2] == null || Math.abs(q.z - c[2]) < 6)) { bd = d; p = { line: i, x: q.x, y: q.y }; }
        }
      }
      if (!p || (avoid && avoid[p.line]) || places.some(o => o.line === p.line || (o.kind === 'centre' && Math.hypot(o.x - p.x, o.y - p.y) < 120))) continue;
      places.push({ kind: 'centre', line: p.line, x: p.x, y: p.y, rank: 3, field: null });
    }
    const nCentres = places.length - nEdges;
    // the field of place k: the cost of the way to it from the start of each state (Dijkstra back from it)
    function field(k) {
      const p = places[k];
      if (p.field) return p.field;
      const D = new Float32Array(2 * n).fill(Infinity), heap = [];
      const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const u = (i - 1) >> 1; if (heap[u][0] <= heap[i][0]) break; [heap[u], heap[i]] = [heap[i], heap[u]]; i = u; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      for (const s of [2 * p.line, 2 * p.line + 1]) if (w[s] < Infinity) { D[s] = w[s] / 2; push([D[s], s]); }
      while (heap.length) {
        const [d, s] = pop();
        if (d > D[s]) continue;
        for (const u of arrive[from[s]]) { // (the pieces that come to where s sets out)
          if ((u >> 1) === (s >> 1)) continue; // (not straight back along the same piece)
          const nd = d + w[u];
          if (nd < D[u]) { D[u] = nd; push([nd, u]); }
        }
      }
      return (p.field = D);
    }
    const state = (line, dir) => 2 * line + (dir > 0 ? 1 : 0);
    // the cost of the way to place k from the start of line, driven dir (Infinity: no way)
    const cost = (k, line, dir) => (k >= 0 && k < places.length ? field(k)[state(line, dir)] : Infinity);
    // a place for a car coming into the traffic at (x, y): -1 for none (it wanders), else its index; not one it is at
    function pick(x, y) {
      if (!places.length || rnd() < WANDER) return -1;
      const town = nCentres && (!nEdges || rnd() < inbound(hour()));
      const lo = town ? nEdges : 0, hi = town ? places.length : nEdges;
      // (an edge by its road's size; a place in town the nearer the likelier, 250 m off half as likely as one at hand:
      // most trips into town end in the part of it they are in)
      const wt = i => { const d = Math.hypot(places[i].x - x, places[i].y - y); return d < 150 ? 0 : town ? 1 / (1 + d / 250) : places[i].rank; };
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += wt(i);
      if (!(sum > 0)) return -1;
      let r = rnd() * sum;
      for (let i = lo; i < hi; i++) { const v = wt(i); if (v > 0 && (r -= v) < 0) return i; }
      return -1;
    }
    // which way along a two-way piece a car bound for k sets out: the nearer way, four times in five
    function facing(k, line) {
      const a = cost(k, line, 1), b = cost(k, line, -1);
      if (a === b) return 0;
      return (a < b ? 1 : -1) * (rnd() < 0.8 ? 1 : -1);
    }
    return { places, cost, pick, facing, inbound, hour, get edges() { return nEdges; }, get centres() { return nCentres; } };
  }
  return { create, WANDER, inbound };
})();
