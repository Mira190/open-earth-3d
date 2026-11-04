// Routes the player can actually take, for the gold line in the world and on the maps:
//   on foot  over the footways and streets as the walker walks them. The mapped lines are
//            split where they cross and where one ends on another, so that a route can turn
//            there; each stretch is walked in 2 m steps with the walker's own test
//            (nav.walk), moved sideways off a wall it grazes, and cut where it runs through a
//            building the model shows as solid (an arcade, a passage under offices). From where
//            you stand onto that network, and from it to the target, a search over the ground.
//   by car   over the roads a car fits along: the router (cars.js) is told which lines to avoid
//   flying   over or round the buildings at a cruising height, to a spot with room for the
//            rotor, climbing and coming down no steeper than the helicopter does
// Everything is tested against the same nav (nav.js) that the walker, the car and the
// helicopter move through, so the line never asks for a step they can't take. The network is
// built in slices while the title screen shows (build), and is ready before you play.
'use strict';
window.OERoute = (function () {
  const STEP = 2;        // sampling along a mapped line (m)
  const NUDGE = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3.0, -3.0]; // sideways off a wall (m)
  const SNAP = 3.0;      // a line ending this close to another meets it (m)
  const MERGE = 1.5;     // two junctions this close are one (m)
  const LEVEL = 2.0;     // a crossing this far above or below the other line is a bridge over it (m)
  const CELL = 1.25;     // the ground search's grid (m)
  const SG = 8;          // the network's samples by 8 m cell
  const LIFT = 0.25;     // what a metre in a lift costs (its edges are told by this)
  // what a metre costs a walker along each kind of line: footways first, the big roads last
  const COST = { footway: 1, pedestrian: 1, path: 1.05, steps: 1.15, cycleway: 1.1, living_street: 1.05, link: 1,
    residential: 1.12, unclassified: 1.12, service: 1.12, tertiary: 1.2, secondary: 1.25, primary: 1.3, trunk: 1.4, surface: 1.15 };

  class Heap { // a binary min-heap of (key, value)
    constructor() { this.k = []; this.v = []; this.top = 0; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, out = v[0];
      this.top = k[0];
      const lk = k.pop(), lv = v.pop(), n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= n) break;
          const r = l + 1, m = r < n && k[r] < k[l] ? r : l;
          if (k[m] >= lk) break;
          k[i] = k[m]; v[i] = v[m]; i = m;
        }
        k[i] = lk; v[i] = lv;
      }
      return out;
    }
  }
  const slice = () => new Promise(r => setTimeout(r, 0));

  // a polyline in the network's form, from [[x, y, z]]
  function polyline(P, c) {
    const pts = new Float32Array(P.length * 3), cum = new Float32Array(P.length);
    P.forEach((q, i) => { pts.set(q, 3 * i); if (i) cum[i] = cum[i - 1] + Math.hypot(q[0] - P[i - 1][0], q[1] - P[i - 1][1]); });
    return { pts, cum, len: cum[P.length - 1], c };
  }

  // The footways as people can walk them, for the crowd: each line (game.json paths, in
  // decimetres) cut where a walker can't stand on it every 1.5 m (through a wall, off a drop, in
  // the water), at its points, keeping the pieces 4 m and longer, each with its deck flags
  function walkable(nav, lines) {
    const out = [];
    for (const o of lines) {
      const p = o.p, n = p.length / 3;
      if (n < 2) continue;
      const okSeg = new Uint8Array(n - 1);
      for (let k = 0; k < n - 1; k++) {
        const ax = p[3 * k] / 10, ay = p[3 * k + 1] / 10, az = p[3 * k + 2] / 10, bx = p[3 * k + 3] / 10, by = p[3 * k + 4] / 10, bz = p[3 * k + 5] / 10;
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
        let ok = 1;
        for (let j = 0; j <= m && ok; j++) {
          const t = j / m, z = az + (bz - az) * t, w = nav.walk(ax + (bx - ax) * t, ay + (by - ay) * t, z + 0.6);
          if (!w.ok || Math.abs(w.z - z) > LEVEL) ok = 0;
        }
        okSeg[k] = ok;
      }
      for (let k = 0; k < n - 1; k++) {
        if (!okSeg[k]) continue;
        let e = k;
        while (e + 1 < n - 1 && okSeg[e + 1]) e++;
        if (k === 0 && e === n - 2) { out.push(o); break; }
        let len = 0;
        for (let j = k; j <= e; j++) len += Math.hypot(p[3 * j + 3] - p[3 * j], p[3 * j + 4] - p[3 * j + 1]) / 10;
        if (len >= 4) out.push(Object.assign({}, o, { p: p.slice(3 * k, 3 * e + 6), d: o.d ? o.d.slice(k, e + 1) : o.d }));
        k = e;
      }
    }
    return out;
  }

  function create({ nav, footNet, roadNet, DSM, helipads = [], lifts = [], ground = null }) {
    // ------------------------------------------------------------ what a walker can do
    // stand at (x, y) on the floor of a line at height zl: the floor stood on, or NaN
    function standZ(x, y, zl, tol = LEVEL) {
      const w = nav.walk(x, y, zl + 0.6);
      return w.ok && Math.abs(w.z - zl) < tol ? w.z : NaN;
    }
    // walk the straight line from a to b: every 0.75 m (or `step`) on a floor near the line's height
    function segOK(ax, ay, az, bx, by, bz, step = 0.75) {
      const d = Math.hypot(bx - ax, by - ay), m = Math.ceil(d / step);
      for (let i = 1; i < m; i++) {
        const t = i / m, z = az + (bz - az) * t;
        if (Number.isNaN(standZ(ax + (bx - ax) * t, ay + (by - ay) * t, z, 1.2))) return false;
      }
      return true;
    }

    // room for a walker every 0.5 m between a and b, on the floor of the line between them
    function roomAlong(ax, ay, az, bx, by, bz) {
      const m = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5);
      for (let i = 1; i < m; i++) { const t = i / m; if (!nav.room(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, nav.R)) return false; }
      return true;
    }

    // ------------------------------------------------------------ the walking network
    // lines: foot and road (not the motorway), in metres, with their class
    const lines = [];
    for (const l of footNet.L) lines.push(l);
    for (const l of roadNet.L) if (l.c !== 'motorway') lines.push(l);
    // the walkable surfaces the lines don't cover (a bridge's whole deck, the Opera House steps): a
    // lattice of lines along each, no more than 6 m apart, and across it every 15 m
    for (const st of nav.strips) {
      const p = st.profile, u0 = p[0][0], u1 = p[p.length - 1][0], hw = st.half_width - 0.8;
      const at = (u, v) => { const x = st.origin[0] + st.axis[0] * u - st.axis[1] * v, y = st.origin[1] + st.axis[1] * u + st.axis[0] * v; return [x, y, nav.stripHeight(st, x, y) ?? 0]; };
      const nv = hw > 1 ? Math.max(1, Math.ceil(2 * hw / 6)) : 0, vs = nv ? Array.from({ length: nv + 1 }, (_, i) => -hw + 2 * hw * i / nv) : [0];
      const nu = Math.max(1, Math.ceil((u1 - u0) / 4));
      for (const v of vs) lines.push(polyline(Array.from({ length: nu + 1 }, (_, i) => at(u0 + (u1 - u0) * i / nu, v)), 'surface'));
      if (vs.length > 1) for (let u = u0; u <= u1 + 1e-6; u += Math.max(1, (u1 - u0) / Math.max(1, Math.round((u1 - u0) / 15)))) lines.push(polyline(vs.map(v => at(u, v)), 'surface'));
    }
    const GC = 24, gkey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
    // nodes: position (moved onto walkable ground when first used), and a grid to snap to
    const NX = [], NY = [], NZ = [], NS = []; // NS: 0 not yet checked, 1 walkable, 2 nowhere to stand
    const ngrid = new Map();
    function nodeAt(x, y, z) {
      const cx = Math.floor(x / MERGE), cy = Math.floor(y / MERGE);
      let best = -1, bd = MERGE;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = ngrid.get(gkey(cx + a, cy + b));
        if (l) for (const i of l) { const d = Math.hypot(NX[i] - x, NY[i] - y); if (d < bd && Math.abs(NZ[i] - z) < LEVEL) { bd = d; best = i; } }
      }
      if (best >= 0) return best;
      const i = NX.push(x) - 1;
      NY.push(y); NZ.push(z); NS.push(0);
      const k = gkey(cx, cy);
      if (!ngrid.has(k)) ngrid.set(k, []);
      ngrid.get(k).push(i);
      return i;
    }
    function newNode(x, y, z) { const i = NX.push(x) - 1; NY.push(y); NZ.push(z); NS.push(1); return i; }
    // a node where someone can stand: as mapped, or moved up to 3 m to where they can
    function nodeOK(i) {
      if (NS[i]) return NS[i] === 1;
      for (let r = 0; r <= 3.01; r += 0.6) {
        const n = r ? Math.ceil(2 * Math.PI * r / 0.6) : 1;
        for (let k = 0; k < n; k++) {
          const a = 2 * Math.PI * k / n, x = NX[i] + Math.cos(a) * r, y = NY[i] + Math.sin(a) * r, z = standZ(x, y, NZ[i]);
          if (!Number.isNaN(z)) { NX[i] = x; NY[i] = y; NZ[i] = z; NS[i] = 1; return true; }
        }
      }
      NS[i] = 2;
      return false;
    }
    // edges: two nodes, a cost per metre, and their points (walkable one to the next)
    const EA = [], EB = [], EM = [], EP = [];
    const drive = new Uint8Array(roadNet.L.length); // 1: a road line a car can't get along
    let ready = false, building = null, busy = 0; // busy: the milliseconds of work the build took
    const phases = {};

    async function build(onProgress) {
      if (building) return building;
      building = (async () => {
        let t0 = performance.now();
        const tick = async (f, what) => { const t = performance.now(); if (t - t0 > 10) { busy += t - t0; phases[what] = Math.round((phases[what] || 0) + t - t0); if (onProgress) onProgress(f, what); await slice(); t0 = performance.now(); } };
        // segments into a 24 m grid
        const segL = [], segK = [], grid = new Map();
        for (let i = 0; i < lines.length; i++) {
          const p = lines[i].pts, n = p.length / 3;
          for (let k = 0; k < n - 1; k++) {
            const id = segL.push(i) - 1;
            segK.push(k);
            const c0 = Math.floor((Math.min(p[3 * k], p[3 * k + 3]) - SNAP) / GC), c1 = Math.floor((Math.max(p[3 * k], p[3 * k + 3]) + SNAP) / GC);
            const r0 = Math.floor((Math.min(p[3 * k + 1], p[3 * k + 4]) - SNAP) / GC), r1 = Math.floor((Math.max(p[3 * k + 1], p[3 * k + 4]) + SNAP) / GC);
            for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const g = gkey(cx, cy); let l = grid.get(g); if (!l) grid.set(g, l = []); l.push(id); }
          }
        }
        await tick(0.05, 'grid');
        // where each line is split: [s, node] pairs; its two ends first
        const splits = lines.map(l => {
          const p = l.pts, n = p.length / 3;
          return [[0, nodeAt(p[0], p[1], p[2])], [l.len, nodeAt(p[3 * n - 3], p[3 * n - 2], p[3 * n - 1])]];
        });
        const sAt = (i, k, t) => lines[i].cum[k] + (lines[i].cum[k + 1] - lines[i].cum[k]) * t;
        const zAt = (i, k, t) => { const p = lines[i].pts; return p[3 * k + 2] + (p[3 * k + 5] - p[3 * k + 2]) * t; };
        // crossings: two lines' segments meet at about the same height (a bridge over a street doesn't)
        let done = 0;
        for (const [g, ids] of grid) {
          const cx = Math.floor(g / 65536) - 32768, cy = (g % 65536) - 32768;
          for (let a = 0; a < ids.length; a++) {
            const i = segL[ids[a]], k = segK[ids[a]], p = lines[i].pts;
            const ax = p[3 * k], ay = p[3 * k + 1], ex = p[3 * k + 3] - ax, ey = p[3 * k + 4] - ay;
            for (let b = a + 1; b < ids.length; b++) {
              const j = segL[ids[b]];
              if (j === i) continue;
              const kk = segK[ids[b]], q = lines[j].pts, bx = q[3 * kk], by = q[3 * kk + 1], fx = q[3 * kk + 3] - bx, fy = q[3 * kk + 4] - by;
              const den = ex * fy - ey * fx;
              if (Math.abs(den) < 1e-9) continue;
              const t = ((bx - ax) * fy - (by - ay) * fx) / den, u = ((bx - ax) * ey - (by - ay) * ex) / den;
              if (t < 0 || t > 1 || u < 0 || u > 1) continue;
              const x = ax + ex * t, y = ay + ey * t;
              if (Math.floor(x / GC) !== cx || Math.floor(y / GC) !== cy) continue; // counted in its own cell only
              const za = zAt(i, k, t), zb = zAt(j, kk, u);
              if (Math.abs(za - zb) >= LEVEL) continue;
              const nd = nodeAt(x, y, (za + zb) / 2);
              splits[i].push([sAt(i, k, t), nd]); splits[j].push([sAt(j, kk, u), nd]);
            }
          }
          if (++done % 400 === 0) await tick(0.15 * done / grid.size, 'crossings');
        }
        // a line ending on another (a footway up to the kerb): split that one there, and join the two
        const links = [];
        for (let i = 0; i < lines.length; i++) {
          const p = lines[i].pts, n = p.length / 3;
          for (const e of [0, n - 1]) {
            const x = p[3 * e], y = p[3 * e + 1], z = p[3 * e + 2];
            let best = null, bd = SNAP;
            for (const id of grid.get(gkey(Math.floor(x / GC), Math.floor(y / GC))) || []) {
              const j = segL[id];
              if (j === i) continue;
              const k = segK[id], q = lines[j].pts, bx = q[3 * k], by = q[3 * k + 1], fx = q[3 * k + 3] - bx, fy = q[3 * k + 4] - by, L2 = fx * fx + fy * fy;
              const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - bx) * fx + (y - by) * fy) / L2)) : 0;
              const d = Math.hypot(x - bx - fx * t, y - by - fy * t);
              if (d < bd && Math.abs(zAt(j, k, t) - z) < LEVEL) { bd = d; best = [j, k, t]; }
            }
            if (!best) continue;
            const [j, k, t] = best, nd = nodeAt(lines[j].pts[3 * k] + (lines[j].pts[3 * k + 3] - lines[j].pts[3 * k]) * t,
              lines[j].pts[3 * k + 1] + (lines[j].pts[3 * k + 4] - lines[j].pts[3 * k + 1]) * t, zAt(j, k, t));
            splits[j].push([sAt(j, k, t), nd]);
            const mine = splits[i][e ? 1 : 0][1];
            if (mine !== nd) links.push([mine, nd]);
          }
          if (i % 500 === 0) await tick(0.15 + 0.1 * i / lines.length, 'junctions');
        }
        // each stretch between two splits, walked and moved off the walls, cut where it can't be walked
        const pos = { x: 0, y: 0, z: 0, hx: 0, hy: 0 };
        const lineAt = (l, s) => {
          const p = l.pts, n = p.length / 3;
          let k = 1;
          while (k < n - 1 && l.cum[k] < s) k++;
          const t = Math.max(0, Math.min(1, (s - l.cum[k - 1]) / Math.max(1e-6, l.cum[k] - l.cum[k - 1])));
          pos.x = p[3 * k - 3] + (p[3 * k] - p[3 * k - 3]) * t; pos.y = p[3 * k - 2] + (p[3 * k + 1] - p[3 * k - 2]) * t; pos.z = p[3 * k - 1] + (p[3 * k + 2] - p[3 * k - 1]) * t;
          const hx = p[3 * k] - p[3 * k - 3], hy = p[3 * k + 1] - p[3 * k - 2], h = Math.hypot(hx, hy) || 1;
          pos.hx = hx / h; pos.hy = hy / h;
          pos.deck = l.deck ? l.deck[k - 1] : 0;
        };
        const finish = (run, b, cls) => {
          if (!run || run.pts.length < 6) return;
          const P = run.pts;
          let len = 0;
          for (let k = 3; k < P.length; k += 3) len += Math.hypot(P[k] - P[k - 3], P[k + 1] - P[k - 2]);
          if (b < 0 && len < 3) return;
          if (b < 0) b = newNode(P[P.length - 3], P[P.length - 2], P[P.length - 1]);
          EA.push(run.a); EB.push(b); EM.push(COST[cls] || 1.2); EP.push(Float32Array.from(P));
        };
        // a stretch from node na at s0 to node nb at s1 of line l (or a straight link when l is null)
        function stretch(l, s0, s1, na, nb, cls) {
          const L = l ? s1 - s0 : Math.hypot(NX[nb] - NX[na], NY[nb] - NY[na]);
          if (L < 0.3) return;
          const n = Math.max(1, Math.ceil(L / STEP));
          let run = nodeOK(na) ? { a: na, pts: [NX[na], NY[na], NZ[na]] } : null;
          for (let j = 1; j < n; j++) {
            if (l) lineAt(l, s0 + (s1 - s0) * j / n);
            else { const t = j / n; pos.x = NX[na] + (NX[nb] - NX[na]) * t; pos.y = NY[na] + (NY[nb] - NY[na]) * t; pos.z = NZ[na] + (NZ[nb] - NZ[na]) * t; pos.hx = (NX[nb] - NX[na]) / L; pos.hy = (NY[nb] - NY[na]) / L; }
            let got = false;
            for (let q = -1; q < NUDGE.length && !got; q++) {
              const d = q < 0 ? 0 : NUDGE[q], x = pos.x - pos.hy * d, y = pos.y + pos.hx * d, z = standZ(x, y, pos.z);
              if (Number.isNaN(z)) continue;
              const P = run && run.pts, m = P ? P.length : 0;
              // the way from the last point: moved off a wall at either end, walked all along; on the
              // line itself at both, every 0.5 m stood on where the water is near (a gap at a bridge's
              // end), else room for the walker every 0.5 m (the floor between is the line's)
              if (run && (d !== 0 || run.moved || nav.offGround(x, y) || nav.offGround(P[m - 3], P[m - 2]) ? !segOK(P[m - 3], P[m - 2], P[m - 1], x, y, z, 0.5)
                : !roomAlong(P[m - 3], P[m - 2], P[m - 1], x, y, z))) continue;
              if (!run) { run = { a: newNode(x, y, z), pts: [x, y, z] }; } else P.push(x, y, z);
              run.moved = d !== 0;
              got = true;
            }
            if (!got && run) { finish(run, -1, cls); run = null; }
          }
          if (run) {
            const P = run.pts, m = P.length;
            if (nodeOK(nb) && segOK(P[m - 3], P[m - 2], P[m - 1], NX[nb], NY[nb], NZ[nb])) { P.push(NX[nb], NY[nb], NZ[nb]); finish(run, nb, cls); }
            else finish(run, -1, cls);
          }
        }
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i], sp = splits[i].sort((a, b) => a[0] - b[0]);
          for (let k = 1; k < sp.length; k++) if (sp[k][1] !== sp[k - 1][1]) stretch(l, sp[k - 1][0], sp[k][0], sp[k - 1][1], sp[k][1], l.c);
          if (i % 50 === 0) await tick(0.25 + 0.6 * i / lines.length, 'walking the footways');
        }
        for (const [a, b] of links) stretch(null, 0, 0, a, b, 'link');
        // lifts: from one stop to the next, a jump the line doesn't draw (LIFT marks the edge)
        for (const l of lifts) for (let i = 1; i < l.stops.length; i++) {
          const a = l.stops[i - 1].at, b = l.stops[i].at, na = newNode(a[0], a[1], a[2]), nb = newNode(b[0], b[1], b[2]);
          EA.push(na); EB.push(nb); EM.push(LIFT); EP.push(Float32Array.of(a[0], a[1], a[2], b[0], b[1], b[2]));
        }
        // the roads as a car drives them: a floor near the height the car drives at every 2 m (on a deck, the
        // line's; on the ground, the ground's: ground(), as cars.js has it, since a hill road's straight line
        // between two of its points cuts under the brow of the hill), and room for the car. A car's floor takes
        // the expressways' decks, which a walker's does not (issue 119)
        for (let i = 0; i < roadNet.L.length; i++) {
          const l = roadNet.L[i], n = Math.max(1, Math.ceil(l.len / 2));
          for (let j = 0; j <= n && !drive[i]; j++) {
            lineAt(l, l.len * j / n);
            const zd = (ground && ground(pos.x, pos.y, pos)) ?? pos.z, f = nav.floorAt(pos.x, pos.y, zd + 0.6, true);
            if (!f || Math.abs(f.z - zd) > LEVEL || !nav.room(pos.x, pos.y, f.z, 0.9, 1.6, nav.isDeck(f.kind))) drive[i] = 1;
          }
          if (i % 100 === 0) await tick(0.85 + 0.15 * i / roadNet.L.length, 'the roads');
        }
        // a one-way road that comes to a wall (a lane the data runs into a building: game.js cutAtWalls),
        // or whose only ways on are roads a car can't get along: a car on it could only wait at its end,
        // so none goes on it; back up the one-way roads that lead only there, in turn
        {
          const RL = roadNet.L, endOf = (l, e) => { const k = e ? l.pts.length / 3 - 1 : 0; return roadNet.key(l.pts[3 * k], l.pts[3 * k + 1]); };
          for (let pass = 0, more = true; more && pass < 30; pass++) {
            more = false;
            for (let i = 0; i < RL.length; i++) {
              const l = RL[i];
              if (drive[i] || !l.ow) continue;
              const e = l.ow > 0 ? 1 : 0;
              let trap = !!(l.wall & (e ? 2 : 1));
              if (!trap) {
                const at = (roadNet.nodes.get(endOf(l, e)) || []).filter(o => o[0] !== i && RL[o[0]].ow !== (o[1] === 0 ? -1 : 1));
                // (or none at all, where another one-way road ends there too: two merging into nothing, a road
                // the data has lost between them, on Hong Kong's hillside west of Central; a single road ending at nothing is a
                // stub or the map's edge, where a car turns round)
                const into = (roadNet.nodes.get(endOf(l, e)) || []).filter(o => o[0] !== i).length;
                trap = at.length > 0 ? at.every(o => drive[o[0]]) : into > 0;
              }
              if (trap) { drive[i] = 1; more = true; }
            }
          }
        }
        await tick(0.9, 'links');
        index();
        await repair(tick);
        index();
        await tick(0.99, 'joining the pieces');
        // each node's piece of the network, in metres: a search off the network goes on past the
        // small pieces (a courtyard's path, a stub) to one that goes somewhere
        const P = pieces();
        PS = new Float32Array(NX.length);
        let top = 0;
        for (const v of P.size.values()) top = Math.max(top, v);
        BIG = top * 0.5; // the main network (a piece cut off, however long, is not where a route goes on from)
        for (let n = 0; n < NX.length; n++) PS[n] = P.size.get(P.of(n)) || 0;
        busy += performance.now() - t0;
        ready = true;
        if (onProgress) onProgress(1, 'done');
      })();
      return building;
    }

    // ------------------------------------------------------------ indexes: who meets at a node, which points are near
    let PS = null, BIG = 0, ADJ = null, ADJ0 = null, SP = null, SE = null, SK = null, CS = null, CI = null, sg = null; // SP: every edge's points, x y z; EP[e] a view into it
    function index() {
      const nN = NX.length, nE = EA.length, deg = new Int32Array(nN + 1);
      for (let e = 0; e < nE; e++) { deg[EA[e] + 1]++; deg[EB[e] + 1]++; }
      for (let i = 0; i < nN; i++) deg[i + 1] += deg[i];
      ADJ0 = deg; ADJ = new Int32Array(2 * nE);
      const fill = deg.slice(0, nN);
      for (let e = 0; e < nE; e++) { ADJ[fill[EA[e]]++] = e; ADJ[fill[EB[e]]++] = e; }
      // the points, in 8 m cells over the network's extent
      let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const P of EP) { n += P.length / 3; for (let k = 0; k < P.length; k += 3) { if (P[k] < x0) x0 = P[k]; if (P[k] > x1) x1 = P[k]; if (P[k + 1] < y0) y0 = P[k + 1]; if (P[k + 1] > y1) y1 = P[k + 1]; } }
      SP = new Float32Array(3 * n); SE = new Int32Array(n); SK = new Int32Array(n);
      let i = 0;
      EP.forEach((P, e) => { SP.set(P, 3 * i); const v = SP.subarray(3 * i, 3 * i + P.length); for (let k = 0; k < P.length; k += 3, i++) { SE[i] = e; SK[i] = k / 3; } EP[e] = v; });
      if (!n) { x0 = y0 = 0; x1 = y1 = 1; }
      sg = { x0: Math.floor(x0) - SG, y0: Math.floor(y0) - SG, nx: Math.ceil((x1 - x0) / SG) + 3, ny: Math.ceil((y1 - y0) / SG) + 3 };
      const cellOf = j => Math.floor((SP[3 * j + 1] - sg.y0) / SG) * sg.nx + Math.floor((SP[3 * j] - sg.x0) / SG);
      CS = new Int32Array(sg.nx * sg.ny + 1);
      for (let j = 0; j < n; j++) CS[cellOf(j) + 1]++;
      for (let c = 0; c < sg.nx * sg.ny; c++) CS[c + 1] += CS[c];
      CI = new Int32Array(n);
      const at = CS.slice(0, sg.nx * sg.ny);
      for (let j = 0; j < n; j++) CI[at[cellOf(j)]++] = j;
    }
    // loose ends: a line that stops short of the next (a tunnel cut out, a deck's end, a gap in the
    // data), and any junction of a piece cut off from the rest of the network, is joined, in a
    // straight line a walker can walk, to the nearest point of another piece within 12 m. That
    // point's edge is split there.
    async function repair(tick) {
      const par = Int32Array.from({ length: NX.length }, (_, i) => i), find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
      for (let e = 0; e < EA.length; e++) par[find(EA[e])] = find(EB[e]);
      const size = new Map();
      for (let e = 0; e < EA.length; e++) { const r = find(EA[e]); size.set(r, (size.get(r) || 0) + along(e, 0, lastOf(e))); }
      let top = 0;
      for (const v of size.values()) top = Math.max(top, v);
      const sizeOf = n => size.get(find(n)) || 0, unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) { par[ra] = rb; size.set(rb, (size.get(rb) || 0) + (size.get(ra) || 0)); } };
      const cut = new Map(), joins = [], round = [];
      const join = (n, j, path) => {
        const e = SE[j];
        if (!cut.has(e)) cut.set(e, new Set());
        cut.get(e).add(SK[j]);
        joins.push([n, e, SK[j], path]);
        unite(n, EA[e]);
      };
      for (let n = 0; n < NX.length; n++) {
        const own = sizeOf(n), loose = ADJ0[n + 1] - ADJ0[n] === 1;
        if (!loose && own >= top * 0.5) continue; // a junction on the main network
        const cand = new Map();
        near(NX[n], NY[n], 12, (j, d) => {
          if (Math.abs(SP[3 * j + 2] - NZ[n]) >= LEVEL || find(EA[SE[j]]) === find(n)) return;
          const q = cand.get(SE[j]);
          if (!q || d < q[0]) cand.set(SE[j], [d, j]);
        });
        const list = [...cand.values()].sort((a, b) => a[0] - b[0]);
        let done = false;
        for (const [, j] of list.slice(0, 6)) if (segOK(NX[n], NY[n], NZ[n], SP[3 * j], SP[3 * j + 1], SP[3 * j + 2])) { join(n, j, null); done = true; break; }
        if (!done && list.length && own >= 200 && own < top * 0.5) round.push([list[0][0], n]);
        if (n % 200 === 0) await tick(0.9 + 0.05 * n / NX.length, 'joining the pieces');
      }
      // no straight way: round whatever is in the way, over the ground, no more than 30 m, from a
      // piece of 200 m or more still cut off from the main network (from a smaller one the
      // walker's own search, 160 m round, finds it), the closest gaps first, four tries for each
      // piece (one shut in behind a wall or across the water has none)
      const tried = new Map();
      for (const [, n] of round.sort((a, b) => a[0] - b[0])) {
        const me = find(n), tries = (tried.get(me) || 0) + 1;
        if (sizeOf(n) >= top * 0.5 || tries > 4) continue;
        tried.set(me, tries);
        const F = flood(NX[n], NY[n], NZ[n], { limit: 30, extra: 0, cells: 600, want: e => find(EA[e]) !== me });
        if (F && F.att.length) { const a = F.att[0]; join(n, a.j, F.back(a.cell).reverse()); }
        await tick(0.97, 'joining the pieces');
      }
      // split the edges at the points joined, from the far end back, and name each point's node
      const nodeOf = new Map();
      for (const [e, ks] of cut) {
        let last = lastOf(e);
        for (const k of [...ks].sort((a, b) => b - a)) {
          if (k <= 0) { nodeOf.set(`${e}:${k}`, EA[e]); continue; }
          if (k >= last) { nodeOf.set(`${e}:${k}`, EB[e]); continue; }
          const P = EP[e], m = newNode(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
          EA.push(m); EB.push(EB[e]); EM.push(EM[e]); EP.push(P.slice(3 * k));
          EB[e] = m; EP[e] = P.slice(0, 3 * k + 3);
          last = k;
          nodeOf.set(`${e}:${k}`, m);
        }
      }
      for (const [n, e, k, path] of joins) {
        const m = nodeOf.get(`${e}:${k}`);
        if (m == null || m === n) continue;
        const P = [NX[n], NY[n], NZ[n]];
        if (path) for (const q of path.slice(1)) P.push(q[0], q[1], q[2]);
        P.push(NX[m], NY[m], NZ[m]);
        EA.push(n); EB.push(m); EM.push(1); EP.push(Float32Array.from(P));
      }
    }
    // the network's points within r of (x, y): fn(point index, distance)
    function near(x, y, r, fn) {
      const c0 = Math.max(0, Math.floor((x - r - sg.x0) / SG)), c1 = Math.min(sg.nx - 1, Math.floor((x + r - sg.x0) / SG));
      const r0 = Math.max(0, Math.floor((y - r - sg.y0) / SG)), r1 = Math.min(sg.ny - 1, Math.floor((y + r - sg.y0) / SG));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const c = cy * sg.nx + cx;
        for (let k = CS[c]; k < CS[c + 1]; k++) { const j = CI[k], d = Math.hypot(SP[3 * j] - x, SP[3 * j + 1] - y); if (d < r) fn(j, d); }
      }
    }
    // length of edge e's points from index k0 to k1
    function along(e, k0, k1) {
      const P = EP[e];
      let s = 0;
      for (let k = Math.min(k0, k1) + 1; k <= Math.max(k0, k1); k++) s += Math.hypot(P[3 * k] - P[3 * k - 3], P[3 * k + 1] - P[3 * k - 2]);
      return s;
    }
    const lastOf = e => EP[e].length / 3 - 1;

    // ------------------------------------------------------------ over the ground, onto the network
    // A search over a 1.25 m grid from (x, y, z), walked as the walker walks (steps up no higher than
    // a kerb, never off a drop either way, since the target's search runs backwards). Returns the
    // network's points it reaches {j, g} (best per edge) and how to get back from each, or null
    // where no one can stand. goal: a point to look out for on the way.
    // (want(e): only the network's edges it says yes to count; cells: how many squares at most;
    // aim: head for the goal first, an A* search, when that is all it is for)
    function flood(x, y, z, { limit = 160, extra = 30, goal = null, want = null, cells = 24000, aim = false } = {}) {
      const start = nav.walk(x, y, z + 0.3).ok ? { x, y, z: nav.walk(x, y, z + 0.3).z } : nav.stand(x, y, z, { rMax: 40 });
      if (!start) return null;
      const keys = new Map(), CX = [], CY = [], CZ = [], G = [], PAR = [];
      const K = (i, j) => (i + 4096) * 8192 + (j + 4096);
      const add = (i, j, zz, g, par) => { const id = CX.push(start.x + i * CELL) - 1; CY.push(start.y + j * CELL); CZ.push(zz); G.push(g); PAR.push(par); keys.set(K(i, j), id); return id; };
      const IJ = [];
      add(0, 0, start.z, 0, -1); IJ.push([0, 0]);
      const bad = new Set(), heap = new Heap(), att = new Map();
      const est = aim && goal ? id => Math.hypot(goal.x - CX[id], goal.y - CY[id]) : () => 0;
      heap.push(est(0), 0);
      let best = Infinity, reached = -1, nCells = 0;
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      while (heap.size) {
        const id = heap.pop(), g = G[id];
        if (heap.top > g + est(id) + 1e-6) continue;
        if (g > limit || g > best + extra || ++nCells > cells) break;
        const cx = CX[id], cy = CY[id], cz = CZ[id];
        if (sg) near(cx, cy, CELL * 0.75, (j, d) => {
          if (Math.abs(SP[3 * j + 2] - cz) > LEVEL || (want && !want(SE[j]))) return;
          const e = SE[j], q = att.get(e), tot = g + d;
          if (!q || tot < q.g) att.set(e, { j, g: tot, cell: id, big: !PS || PS[EA[e]] >= BIG });
          if (tot < best && (!PS || PS[EA[e]] >= BIG)) best = tot;
        });
        if (goal && reached < 0 && Math.hypot(goal.x - cx, goal.y - cy) < CELL && Math.abs(goal.z - cz) < LEVEL) { reached = id; best = Math.min(best, g); if (aim) break; }
        const [i0, j0] = IJ[id];
        for (const [di, dj] of DIRS) {
          const i = i0 + di, j = j0 + dj, k = K(i, j);
          if (bad.has(k)) continue;
          const step = di && dj ? CELL * Math.SQRT2 : CELL;
          let nid = keys.get(k);
          if (nid === undefined) {
            const px = start.x + i * CELL, py = start.y + j * CELL, w = nav.walk(px, py, cz + 0.3);
            if (!w.ok || Math.abs(w.z - cz) > 1.0) { if (!w.ok) bad.add(k); continue; }
            if (di && dj && !nav.walk(cx + di * CELL / 2, cy + dj * CELL / 2, cz + 0.3).ok) continue; // no corner cut
            nid = add(i, j, w.z, Infinity, id); IJ.push([i, j]);
          } else if (Math.abs(CZ[nid] - cz) > 1.0 || (di && dj && !nav.walk(cx + di * CELL / 2, cy + dj * CELL / 2, cz + 0.3).ok)) continue;
          const ng = g + step;
          if (ng < G[nid]) { G[nid] = ng; PAR[nid] = id; heap.push(ng + est(nid), nid); }
        }
      }
      const back = id => { const out = []; for (let c = id; c >= 0; c = PAR[c]) out.push([CX[c], CY[c], CZ[c]]); return out; }; // from the cell back to the start
      const all = [...att.values()].sort((a, b) => a.g - b.g), bigs = all.filter(a => a.big).slice(0, 10);
      return { start, att: all.filter(a => !a.big).slice(0, 14).concat(bigs), back, reached, G };
    }

    // ------------------------------------------------------------ on foot
    let tCache = null; // the target's search, kept while the target stays put
    const noWay = new Set();
    // a route on foot from a ({x, y, z}) to b ({x, y, z}; z optional): { pts: [[x, y, z]], len,
    // end: [x, y, z] (where it stops: at b, or the nearest place to stand to it) } or null
    function walk(a, b) {
      if (!ready) return null;
      const bz = b.z != null ? b.z : (() => { const f = nav.floorAt(b.x, b.y, Math.max(300, nav.terrain(b.x, b.y) + 1)); return f && f.kind !== 'deck' ? f.z : nav.terrain(b.x, b.y); })();
      const tk = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(bz)}`;
      if (!tCache || tCache.k !== tk) tCache = { k: tk, F: flood(b.x, b.y, bz) };
      const T = tCache.F;
      if (!T) return null;
      const S = flood(a.x, a.y, a.z, { goal: T.start });
      if (!S) return null;
      let bestCost = S.reached >= 0 ? S.G[S.reached] : Infinity, plan = S.reached >= 0 ? { direct: S.reached } : null;
      // the target's points, by edge
      const tAt = new Map();
      for (const t of T.att) tAt.set(SE[t.j], t);
      // the same edge from both ends' searches: along it
      for (const s of S.att) {
        const e = SE[s.j], t = tAt.get(e);
        if (!t) continue;
        const c = s.g + along(e, SK[s.j], SK[t.j]) * EM[e] + t.g;
        if (c < bestCost) { bestCost = c; plan = { same: [s, t] }; }
      }
      // over the network (A*, straight-line distance to the target as the estimate)
      const dist = new Map(), prev = new Map(), heap = new Heap(), hx = T.start.x, hy = T.start.y;
      const h = n => Math.hypot(NX[n] - hx, NY[n] - hy);
      const seed = (n, c, from) => { if (c < (dist.get(n) ?? Infinity)) { dist.set(n, c); prev.set(n, from); heap.push(c + h(n), n); } };
      for (const s of S.att) {
        const e = SE[s.j];
        seed(EA[e], s.g + along(e, SK[s.j], 0) * EM[e], { start: s, e });
        seed(EB[e], s.g + along(e, SK[s.j], lastOf(e)) * EM[e], { start: s, e });
      }
      const tEnds = new Map(); // node -> [{t, e, cost from the node}]
      for (const t of T.att) {
        const e = SE[t.j];
        for (const [n, k] of [[EA[e], 0], [EB[e], lastOf(e)]]) { if (!tEnds.has(n)) tEnds.set(n, []); tEnds.get(n).push({ t, e, c: along(e, k, SK[t.j]) * EM[e] + t.g }); }
      }
      let settled = 0;
      while (heap.size) {
        const n = heap.pop();
        if (heap.top >= bestCost || ++settled > 250000) break;
        const d = dist.get(n);
        if (heap.top > d + h(n) + 1e-6) continue;
        for (const q of tEnds.get(n) || []) if (d + q.c < bestCost) { bestCost = d + q.c; plan = { via: n, end: q }; }
        for (let k = ADJ0[n]; k < ADJ0[n + 1]; k++) {
          const e = ADJ[k], m = EA[e] === n ? EB[e] : EA[e];
          seed(m, d + along(e, 0, lastOf(e)) * EM[e], { node: n, e });
        }
      }
      // nothing over the network (a deck the mapped lines don't reach, a gap the data leaves): over
      // the ground itself, heading for the target, when it is no more than 1.5 km away
      // (a search that found nothing is not tried again from within 40 m of where it started)
      const dk = `${tk}|${Math.round(S.start.x / 40)},${Math.round(S.start.y / 40)}`;
      if (!plan && !noWay.has(dk) && Math.hypot(T.start.x - S.start.x, T.start.y - S.start.y) < 1500) {
        const D = flood(S.start.x, S.start.y, S.start.z, { goal: T.start, limit: 2500, extra: 0, cells: 60000, want: () => false, aim: true });
        if (D && D.reached >= 0) { S.back = D.back; plan = { direct: D.reached }; } else { noWay.add(dk); if (noWay.size > 200) noWay.clear(); }
      }
      if (!plan) return null;
      // the points, from a to b
      const pts = [];
      const push = (x, y, z, jump) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - x, l[1] - y, l[2] - z) > 0.05) pts.push(jump ? [x, y, z, 1] : [x, y, z]); };
      // (a lift's far stop is marked: the line breaks there, and goes on from the other floor)
      const edgePts = (e, k0, k1) => { const P = EP[e], st = k1 >= k0 ? 1 : -1; for (let k = k0; k !== k1 + st; k += st) push(P[3 * k], P[3 * k + 1], P[3 * k + 2], EM[e] === LIFT && k !== k0); };
      const fromStart = cell => { for (const p of S.back(cell).reverse()) push(...p); };
      const toEnd = cell => { for (const p of T.back(cell)) push(...p); };
      if (plan.direct != null) { fromStart(plan.direct); push(T.start.x, T.start.y, T.start.z); }
      else if (plan.same) { const [s, t] = plan.same; fromStart(s.cell); edgePts(SE[s.j], SK[s.j], SK[t.j]); toEnd(t.cell); }
      else {
        const chain = []; // edges back from the last node to the start's edge
        let n = plan.via;
        for (;;) {
          const p = prev.get(n);
          if (p.start) { chain.push({ e: p.e, from: p.start, to: n }); break; }
          chain.push({ e: p.e, node: p.node, to: n });
          n = p.node;
        }
        chain.reverse();
        const first = chain[0];
        fromStart(first.from.cell);
        edgePts(first.e, SK[first.from.j], EA[first.e] === first.to ? 0 : lastOf(first.e));
        for (let i = 1; i < chain.length; i++) { const c = chain[i]; edgePts(c.e, EA[c.e] === c.node ? 0 : lastOf(c.e), EA[c.e] === c.node ? lastOf(c.e) : 0); }
        const q = plan.end;
        edgePts(q.e, EA[q.e] === plan.via ? 0 : lastOf(q.e), SK[q.t.j]);
        toEnd(q.t.cell);
      }
      const out = mend(simplify(pts));
      let len = 0;
      for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
      return { pts: out, len, end: [T.start.x, T.start.y, T.start.z] };
    }
    // fewer points, each straight stretch still walkable and within 1.5 m of the way found (each
    // floor on its own, either side of a ride in a lift)
    function simplify(P) {
      const cut = P.findIndex((p, i) => i && p[3]);
      if (cut > 0) return simplify(P.slice(0, cut)).concat(simplify(P.slice(cut)));
      if (P.length < 3) return P;
      const keep = new Uint8Array(P.length);
      keep[0] = keep[P.length - 1] = 1;
      const stack = [[0, P.length - 1]];
      while (stack.length) {
        const [i, j] = stack.pop();
        if (j - i < 2) continue;
        const ax = P[i][0], ay = P[i][1], ex = P[j][0] - ax, ey = P[j][1] - ay, L = Math.hypot(ex, ey) || 1;
        let worst = 0, wk = -1;
        for (let k = i + 1; k < j; k++) { const d = Math.abs((P[k][0] - ax) * ey - (P[k][1] - ay) * ex) / L; if (d > worst) { worst = d; wk = k; } }
        if (worst < 1.5 && (j - i > 60 ? false : segOK(P[i][0], P[i][1], P[i][2], P[j][0], P[j][1], P[j][2]))) continue;
        const m = worst >= 1.5 ? wk : (i + j) >> 1;
        keep[m] = 1;
        stack.push([i, m], [m, j]);
      }
      return P.filter((p, i) => keep[i]);
    }

    // the route walked once more, every 0.5 m: a stretch with a spot a walker can't stand on (a
    // corner it cuts, a gap by the water) goes round it over the ground instead
    function mend(P) {
      const out = [P[0]];
      for (let i = 1; i < P.length; i++) {
        const a = out[out.length - 1], b = P[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(d / 0.5));
        let ok = true;
        for (let k = 1; k < m && ok && !b[3]; k++) { const t = k / m; if (Number.isNaN(standZ(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1.5))) ok = false; }
        if (!ok) {
          const D = flood(a[0], a[1], a[2], { goal: { x: b[0], y: b[1], z: b[2] }, limit: d * 3 + 30, extra: 0, cells: 4000, want: () => false, aim: true });
          if (D && D.reached >= 0) for (const q of D.back(D.reached).reverse().slice(1)) out.push(q);
        }
        out.push(b);
      }
      return out;
    }
    // how much of a route can't be walked: the metres where a walker can't stand, sampled every 0.5 m
    // (where: the first few spots, and where.run the longest stretch in one go)
    function blockedMetres(P, where = null) {
      let bad = 0, run = 0;
      for (let i = 1; i < P.length; i++) {
        if (P[i][3]) continue; // in a lift
        const [ax, ay, az] = P[i - 1], [bx, by, bz] = P[i], d = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(d / 0.5));
        for (let k = 0; k < m; k++) {
          const t = k / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
          if (Number.isNaN(standZ(x, y, z, 1.5))) { bad += d / m; run += d / m; if (where && where.length < 6) where.push([x, y, z, nav.walk(x, y, z + 0.6).why || 'level']); }
          else run = 0;
          if (where) where.run = Math.max(where.run || 0, run);
        }
      }
      return bad;
    }

    // ------------------------------------------------------------ flying
    // the tallest thing in each 16 m cell (terrain, roofs, decks, the landmarks' solids), widened by a cell
    const FC = 16;
    let fly = null;
    function flyGrid() {
      if (fly) return fly;
      const f = Math.round(FC / DSM.cell), nx = Math.ceil(DSM.nx / f), ny = Math.ceil(DSM.ny / f), H = new Float32Array(nx * ny);
      for (let r = 0; r < DSM.ny; r++) { const rr = ((r / f) | 0) * nx; for (let c = 0; c < DSM.nx; c++) { const v = DSM.data[r * DSM.nx + c], k = rr + ((c / f) | 0); if (v > H[k]) H[k] = v; } }
      const x0 = DSM.x0, y1 = DSM.y1;
      for (const p of nav.col.prisms) {
        if (p.tag !== nav.LANDMARK) continue;
        const c0 = Math.max(0, Math.floor((p.x0 - x0) / FC)), c1 = Math.min(nx - 1, Math.floor((p.x1 - x0) / FC));
        const r0 = Math.max(0, Math.floor((y1 - p.y1) / FC)), r1 = Math.min(ny - 1, Math.floor((y1 - p.y0) / FC));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (p.zhi > H[r * nx + c]) H[r * nx + c] = p.zhi;
      }
      const Hd = new Float32Array(nx * ny);
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
        let m = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const rr = r + a, cc = c + b; if (rr >= 0 && cc >= 0 && rr < ny && cc < nx && H[rr * nx + cc] > m) m = H[rr * nx + cc]; }
        Hd[r * nx + c] = m;
      }
      return (fly = { nx, ny, x0, y1, H: Hd });
    }
    const CLEAR = 30, CRUISE = 120, CLIMB = 0.35; // m over the tallest thing near; the usual height; rise per metre flown
    const fcell = (F, x, y) => { const c = Math.floor((x - F.x0) / FC), r = Math.floor((F.y1 - y) / FC); return c < 0 || r < 0 || c >= F.nx || r >= F.ny ? -1 : r * F.nx + c; };
    const topNear = (F, x, y) => { const k = fcell(F, x, y); return k < 0 ? 0 : F.H[k]; };
    // somewhere the helicopter can come down near (x, y): a helipad close by, else open, level
    // ground (not a roof, not the water) with nothing over it or within the rotor's reach
    function landing(x, y, rMax = 320) {
      const ROTOR = 7.5;
      for (const h of helipads) {
        if (Math.hypot(h.at[0] - x, h.at[1] - y) >= 150) continue;
        const [hx, hy] = h.at, z = h.at[2] != null ? h.at[2] : nav.groundBelow(hx, hy, 1e4);
        if (Math.abs(nav.groundBelow(hx, hy, z + 1) - z) < 1 && nav.free(hx, hy, z + 0.3, z + 600, 5)) return { x: hx, y: hy, z, pad: true }; // (a pad mapped under a tower is no pad)
      }
      for (let r = 0; r <= rMax; r += 4) {
        const n = r ? Math.ceil(2 * Math.PI * r / 5) : 1;
        for (let k = 0; k < n; k++) {
          const a = 2 * Math.PI * k / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (nav.offGround(px, py)) continue;
          const g = nav.terrain(px, py);
          if (Math.abs(nav.groundBelow(px, py, 1e4) - g) > 0.3) continue; // a roof, a deck or a pier
          let flat = true, wet = false;
          for (let q = 0; q < 8 && flat; q++) { const qx = px + Math.cos(q * Math.PI / 4) * ROTOR * 0.7, qy = py + Math.sin(q * Math.PI / 4) * ROTOR * 0.7; if (Math.abs(nav.terrain(qx, qy) - g) > 1.2) flat = false; if (nav.isWater(qx, qy)) wet = true; }
          if (!flat || wet || !nav.free(px, py, g + 0.3, g + 600, ROTOR)) continue;
          let over = false;
          nav.decksAt(px, py, hd => { if (hd > g + 1) over = true; });
          if (over) continue;
          return { x: px, y: py, z: g };
        }
      }
      return null;
    }
    // a flight from a ({x, y, z}) to b ({x, y}): to a landing spot near it, or with { end: {x, y, z} }
    // to that point in the air (a span to fly under: { under }, the deck it passes beneath).
    // { pts: [[x, y, z]], len, land } or null
    function flight(a, b, { end = null, under = null } = {}) {
      const F = flyGrid(), land = end || landing(b.x, b.y);
      if (!land) return null;
      const c0 = fcell(F, a.x, a.y), c1 = fcell(F, land.x, land.y);
      if (c0 < 0 || c1 < 0) return null;
      // a path over the grid: a metre flown costs one, and each metre the way rises over the
      // usual height costs as much as a long way round
      const N = F.nx * F.ny, g = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), heap = new Heap();
      const ex = c => (c % F.nx), ey = c => ((c / F.nx) | 0), tx = ex(c1), ty = ey(c1);
      const over = c => Math.max(0, F.H[c] + CLEAR - CRUISE);
      g[c0] = 0; heap.push(0, c0);
      const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
      while (heap.size) {
        const c = heap.pop();
        if (c === c1) break;
        const gc = g[c];
        if (heap.top > gc + FC * Math.hypot(ex(c) - tx, ey(c) - ty) + 1e-6) continue;
        const cx = ex(c), cy = ey(c);
        for (const [dx, dy, w] of D8) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= F.nx || ny >= F.ny) continue;
          const n = ny * F.nx + nx, cost = gc + FC * w * (1 + over(n) * 0.12);
          if (cost < g[n]) { g[n] = cost; par[n] = c; heap.push(cost + FC * Math.hypot(nx - tx, ny - ty), n); }
        }
      }
      if (par[c1] < 0 && c0 !== c1) return null;
      const cells = [];
      for (let c = c1; c >= 0; c = par[c]) { cells.push(c); if (c === c0) break; }
      cells.reverse();
      const at = c => [F.x0 + (ex(c) + 0.5) * FC, F.y1 - (ey(c) + 0.5) * FC];
      const xy = [[a.x, a.y]].concat(cells.slice(1, -1).map(at)).concat([[land.x, land.y]]);
      // straighten: a leg may skip ahead where it passes nothing taller than the cells it skips
      const rise = (p, q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(d / 8); let h = 0; for (let i = 0; i <= m; i++) h = Math.max(h, topNear(F, p[0] + (q[0] - p[0]) * i / m, p[1] + (q[1] - p[1]) * i / m)); return h; };
      const path = [xy[0]];
      for (let i = 0; i < xy.length - 1;) {
        let j = i + 1, hmax = 0;
        for (let k = i + 1; k < xy.length; k++) {
          hmax = Math.max(hmax, topNear(F, xy[k][0], xy[k][1]));
          if (rise(xy[i], xy[k]) <= Math.max(hmax, CRUISE - CLEAR) + 0.5) j = k;
          else if (k - j > 6) break;
        }
        path.push(xy[j]);
        i = j;
      }
      // the height along it: no lower than CLEAR over whatever is near, at the usual height between
      // a climb out and a descent in, and changing no faster than CLIMB per metre
      const S = [];
      let s = 0;
      for (let i = 0; i < path.length; i++) {
        if (i) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        if (i < path.length - 1) {
          const d = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]), m = Math.max(1, Math.ceil(d / 8));
          for (let k = 0; k < m; k++) S.push([path[i][0] + (path[i + 1][0] - path[i][0]) * k / m, path[i][1] + (path[i + 1][1] - path[i][1]) * k / m, s + d * k / m]);
        } else S.push([path[i][0], path[i][1], s]);
      }
      const L = s, z1 = land.z;
      const floor = S.map(([x, y]) => topNear(F, x, y) + CLEAR);
      if (under) for (let i = 0; i < S.length; i++) if (L - S[i][2] < 260 && nav.groundBelow(S[i][0], S[i][1], z1) < z1 - 3 && nav.free(S[i][0], S[i][1], z1 - 1, z1 + 5, 8)) floor[i] = Math.min(floor[i], z1); // coming in low to pass under
      const z = S.map(([, , si]) => Math.min(Math.max(CRUISE, a.z + 40), a.z + 25 + CLIMB * si, z1 + (end ? 0 : 25) + CLIMB * (L - si)));
      for (let i = 0; i < S.length; i++) z[i] = Math.max(z[i], floor[i]);
      for (let i = 1; i < S.length; i++) z[i] = Math.max(z[i], z[i - 1] - CLIMB * (S[i][2] - S[i - 1][2]) * 1.5);
      for (let i = S.length - 2; i >= 0; i--) z[i] = Math.max(z[i], z[i + 1] - CLIMB * (S[i + 1][2] - S[i][2]));
      const pts = [[a.x, a.y, a.z]];
      if (z[0] > a.z + 0.5) pts.push([a.x, a.y, z[0]]); // straight up off the ground first
      // fewer points: drop those the climb or descent passes in a straight line
      for (let i = 1; i < S.length - 1; i++) {
        const p = pts[pts.length - 1], q = [S[i + 1][0], S[i + 1][1], z[i + 1]], d1 = Math.hypot(S[i][0] - p[0], S[i][1] - p[1]), d2 = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const zl = p[2] + (q[2] - p[2]) * d1 / Math.max(1e-6, d2);
        const turn = Math.abs((S[i][0] - p[0]) * (q[1] - p[1]) - (S[i][1] - p[1]) * (q[0] - p[0])) / Math.max(1e-6, d2);
        if (Math.abs(zl - z[i]) > 1.5 || turn > 2 || z[i] > zl + 0.01 || d1 > 400) pts.push([S[i][0], S[i][1], z[i]]);
      }
      pts.push([land.x, land.y, z[S.length - 1]]);
      if (!end && z[S.length - 1] > z1 + 0.5) pts.push([land.x, land.y, z1]); // and straight down onto the spot
      if (under) pts.push(under.out);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      return { pts, len, land };
    }
    // a pass under a span (nav.strips with fly_under: a bridge's deck, the Eiffel Tower's first
    // floor), from the side the helicopter is on: in low, straight across under the span at the
    // height with most room above and below it, clear of everything (a pylon, a leg, an arch), and
    // out the other side. Worked out once for each span and side.
    const passes = new Map();
    function underSpan(a, strip) {
      const s = strip, side = Math.sign(nav.stripUV(s, a.x, a.y)[1]) || 1, key = `${s.name}|${side}`;
      if (!passes.has(key)) passes.set(key, passUnder(s, side));
      return passes.get(key);
    }
    function passUnder(s, side) {
      const p = s.profile, off = s.half_width + 140, px = -s.axis[1], py = s.axis[0], HELI = 3.8;
      let best = null;
      for (let i = 0; i <= 20; i++) {
        const u = p[0][0] + (p[p.length - 1][0] - p[0][0]) * (0.1 + 0.8 * i / 20), ox = s.origin[0] + s.axis[0] * u, oy = s.origin[1] + s.axis[1] * u, h = nav.stripHeight(s, ox, oy);
        if (h == null) continue;
        const bottom = h - (s.thickness || 3);
        let g0 = 0;
        for (let v = -off; v <= off; v += 4) g0 = Math.max(g0, nav.terrain(ox + px * v, oy + py * v));
        // the heights a straight pass is clear at, and the longest run of them
        let run = 0, top = null;
        for (let z = g0 + 3; z <= bottom - HELI - 1; z += 1) {
          let clear = true;
          for (let v = -off; v <= off && clear; v += 4) {
            const x = ox + px * v, y = oy + py * v;
            if (nav.groundBelow(x, y, z) > z - 1.5 || !nav.free(x, y, z, z + HELI + 0.5, 6)) clear = false;
          }
          if (clear) { run++; if (!best || run > best.run || (run === best.run && Math.abs(i - 10) < Math.abs(best.i - 10))) best = { run, i, ox, oy, z: z - (run - 1) / 2 }; } else run = 0;
        }
      }
      if (!best) return null;
      return { end: { x: best.ox + px * off * side, y: best.oy + py * off * side, z: best.z }, out: [best.ox - px * off * side, best.oy - py * off * side, best.z] };
    }
    // the network's connected pieces: per node its piece, and the pieces' sizes in metres
    function pieces() {
      const par = Int32Array.from({ length: NX.length }, (_, i) => i), find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
      for (let e = 0; e < EA.length; e++) par[find(EA[e])] = find(EB[e]);
      const size = new Map();
      for (let e = 0; e < EA.length; e++) { const r = find(EA[e]); size.set(r, (size.get(r) || 0) + along(e, 0, lastOf(e))); }
      return { of: n => find(n), size };
    }
    const debug = { pieces, flood, node: i => [NX[i], NY[i], NZ[i]], edge: e => ({ a: EA[e], b: EB[e], pts: EP[e] }), SE: () => SE, SK: () => SK };
    return { debug, build, get ready() { return ready; }, walk, flight, landing, underSpan, blockedMetres, drive, stats: () => ({ ms: Math.round(busy), nodes: NX.length, edges: EA.length, points: SE ? SE.length : 0, phases, undrivable: drive.reduce((a, b) => a + b, 0), roads: roadNet.L.length }) };
  }

  // ------------------------------------------------------------ the gold line
  // A band laid on the ground (on foot, by car, on the water) or hung in the air turned to the
  // camera (flying), with chevrons drifting the way to go. It is kept quiet: a thin, soft band that
  // fades in a few metres ahead of you and out with distance (a hint of where to go, not a stripe
  // painted on the city), dimmer and warmer at night so it sits in the grade as the street lights
  // do. The stretch behind you is gone: follow() moves its start to where you are. fade(k, dt)
  // eases it in and out (the player's setting, a menu or a conversation open), and the mesh is
  // hidden once it has faded away.
  const THIN = 0.62; // the band's width, against the widths the planner asks for
  function line(world, color) {
    const U = { uHead: { value: 0 }, uLen: { value: 1 }, uTime: { value: 0 }, uWidth: { value: 0.8 }, uFlat: { value: 1 }, uMin: { value: 0.002 },
      uFade: { value: 0 }, uNight: { value: 0 }, uFar: { value: new THREE.Vector2(40, 320) },
      uDusk: { value: new THREE.Color('#e38f24') }, // the night tint: a deeper, softer amber, as sodium light on stone
      uRim: { value: new THREE.Color('#6b4210') }, uHi: { value: new THREE.Color('#fff1d2') } }; // a dark amber edge to hold on pale stone, and the chevrons' cream
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aDir; attribute float aSide; attribute float aS;
uniform float uWidth, uFlat, uMin; varying float vS, vSide, vDist;`).replace('#include <begin_vertex>', `vec3 transformed = position;
vDist = distance(position, cameraPosition);
vec3 nrm = uFlat > 0.5 ? cross(aDir, vec3(0.0, 1.0, 0.0)) : cross(aDir, normalize(cameraPosition - position));
nrm = length(nrm) > 1e-4 ? normalize(nrm) : vec3(1.0, 0.0, 0.0);
transformed += nrm * aSide * max(uWidth, vDist * uMin) * 0.5;
vS = aS; vSide = aSide;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uHead, uLen, uTime, uFade, uNight; uniform vec2 uFar; uniform vec3 uRim, uHi, uDusk; varying float vS, vSide, vDist;`).replace('#include <color_fragment>', `#include <color_fragment>
if (vS < uHead - 0.5) discard;
float across = abs(vSide);
float ch = fract((vS - uTime * 1.1) / 4.0 + across * 0.35);
float chev = smoothstep(0.0, 0.08, ch) * (1.0 - smoothstep(0.24, 0.36, ch)) * (1.0 - smoothstep(30.0, 110.0, vDist));
float rim = smoothstep(0.55, 0.85, across) * (1.0 - smoothstep(40.0, 160.0, vDist)) * (1.0 - uNight);
vec3 base = mix(diffuseColor.rgb, uDusk * 0.8, uNight);
diffuseColor.rgb = mix(mix(base, uRim, rim * 0.55), mix(uHi, uDusk * 1.2, uNight * 0.75), chev * (1.0 - rim) * 0.42);
diffuseColor.a *= (1.0 - smoothstep(0.7, 1.0, across)) * (0.62 + 0.12 * chev) * mix(1.0, 0.82, uNight)
  * mix(1.0, 0.22, smoothstep(uFar.x, uFar.y, vDist))
  * smoothstep(uHead + 1.0, uHead + 9.0, vS) * (1.0 - smoothstep(uLen - 10.0, uLen - 1.0, vS)) * uFade;`);
    };
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    world.add(mesh);
    let P = null, cum = null, at = 0;
    // pts: [[x, y, z]] in the game's frame (x east, y north, z up)
    function set(pts, { flat = true, width = 0.8, min = flat ? 0.003 : 0.0045 } = {}) {
      P = pts && pts.length > 1 ? pts : null;
      at = 0;
      if (!P) { mesh.visible = false; U.uFade.value = 0; return; }
      const n = P.length, pos = new Float32Array(n * 6), dir = new Float32Array(n * 6), side = new Float32Array(n * 2), s = new Float32Array(n * 2), idx = [];
      cum = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        if (i) cum[i] = cum[i - 1] + (P[i][3] ? 0 : Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], flat ? 0 : P[i][2] - P[i - 1][2]));
        const a = P[i][3] || !i ? P[i] : P[i - 1], b = i + 1 < n && !P[i + 1][3] ? P[i + 1] : P[i];
        let dx = b[0] - a[0], dy = b[1] - a[1], dz = flat ? 0 : b[2] - a[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        for (let k = 0; k < 2; k++) {
          const j = 2 * i + k;
          pos.set([P[i][0], P[i][2], -P[i][1]], 3 * j); // three.js: y up, z south
          dir.set([dx, dz, -dy], 3 * j);
          side[j] = k ? 1 : -1;
        }
        s[2 * i] = s[2 * i + 1] = cum[i];
        if (i && !P[i][3]) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
      g.setIndex(idx);
      mesh.geometry.dispose();
      mesh.geometry = g;
      U.uLen.value = cum[n - 1]; U.uHead.value = 0; U.uWidth.value = width * THIN; U.uFlat.value = flat ? 1 : 0; U.uMin.value = min * THIN;
      U.uFar.value.set(flat ? 40 : 120, flat ? 320 : 900); // in the air it fades much further off
    }
    // where you are along the line: moves its start up to you; returns how far you are from it
    // (with z, in three dimensions), Infinity when there is none
    function follow(x, y, z = null) {
      if (!P) return Infinity;
      let best = Infinity, bi = at, bs = U.uHead.value;
      const i0 = Math.max(1, at - 40), i1 = Math.min(P.length - 1, at + 400);
      for (let i = i0; i <= i1; i++) {
        const a = P[i - 1], b = P[i], ex = b[0] - a[0], ey = b[1] - a[1], ez = z == null ? 0 : b[2] - a[2], L2 = ex * ex + ey * ey + ez * ez;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey + (z == null ? 0 : (z - a[2]) * ez)) / L2)) : 0;
        const d = Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t, z == null ? 0 : z - a[2] - ez * t);
        if (d < best - 1e-6) { best = d; bi = i; bs = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
      }
      if (best < 25) { at = Math.max(at, bi - 1); U.uHead.value = Math.max(U.uHead.value, bs); }
      return best;
    }
    // the way still to go, for the maps
    const ahead = () => (P ? P.slice(Math.max(0, at)) : null);
    // ease toward shown (k = 1) or hidden (0) over about half a second; dt Infinity snaps
    function fade(k, dt) {
      const f = U.uFade.value, to = P ? k : 0;
      U.uFade.value = to > f ? Math.min(to, f + dt * 2.2) : Math.max(to, f - dt * 3.2);
      mesh.visible = U.uFade.value > 0.01;
    }
    return { mesh, set, follow, ahead, fade, tick: t => { U.uTime.value = t; }, night: n => { U.uNight.value = n; }, get shown() { return U.uFade.value; },
      get pts() { return P; }, get left() { return P ? U.uLen.value - U.uHead.value : 0; } };
  }
  return { create, line, walkable };
})();
