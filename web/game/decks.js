// Decks for the bridges and viaducts the open data maps as lines but not as solids. Where a
// footway or a road crosses the water, or runs well above the ground drawn under it, it is on
// a deck, and without one the traffic and the crowd would cross the river on nothing.
//   - A bridge over the water is laid from bank to bank, level with them and a little crowned:
//     the data lifts a bridge one level (6 m), which over a canal makes a hump in the air.
//   - A viaduct (an elevated expressway, an overpass) keeps its mapped height.
//   - A stub that ends at nothing over the water is cut back to the bank; one that ends at
//     nothing on land comes down to the ground.
//   - Everything on the ground follows the ground drawn under it.
// Each deck is drawn as a concrete slab with parapets and columns under the high spans, walked
// by the player through nav.js (an expressway is not), and the crowd and the traffic keep to its
// height: each line gets a flag per segment, 1 where it is off the ground.
'use strict';
window.OEDecks = (function () {
  const RISE = 2.5;     // a line this far above the ground drawn under it is on a deck (m)
  const THICK = 0.9;    // the slab under a deck's surface
  const PARAPET = 0.9;  // the walls along its edges, above the surface
  const SPAN = 30;      // columns under a deck about this far apart
  const STUB = 20;      // how far back from a loose end a stub is cut (m)
  const SLOPE = 0.3;   // a deck climbing steeper than this (rise over run, outside steps) is regraded
  const EDGE = 4;      // how far past a walkable strip's edge a line along it is taken to be on it (m)
  const DIP = 25;        // a road is carried over a dip this long either side of a point (m)
  const DIP_Z = 0.8;     // and this deep
  const LEVEL = 6;      // the data puts a bridge or a viaduct this much higher per level
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const FOOTW = { pedestrian: 8, footway: 3, path: 2.5, steps: 3, cycleway: 2.5, living_street: 5 };

  // the bank beside a bridge's loose end: the ground at the nearest spot a walker can stand within 30 m
  function bankZ(nav, x, y) {
    for (let r = 2; r <= 30; r += 2) for (let k = 0, n = Math.ceil(2 * Math.PI * r / 2); k < n; k++) {
      const px = x + Math.cos(2 * Math.PI * k / n) * r, py = y + Math.sin(2 * Math.PI * k / n) * r;
      if (!nav.offGround(px, py)) return nav.terrain(px, py);
    }
    return null;
  }

  // do segments a-b and c-d cross or touch? (plan coordinates)
  function cross(ax, ay, bx, by, cx, cy, dx, dy) {
    const s = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    return s(ax, ay, bx, by, cx, cy) * s(ax, ay, bx, by, dx, dy) <= 0 && s(cx, cy, dx, dy, ax, ay) * s(cx, cy, dx, dy, bx, by) <= 0;
  }

  // columns under a run's high spans, every SPAN metres, clear of the ends where the deck meets the
  // ground and of the boats' courses: [{x, y, z0, z1, hx, hy, ex, ey}], a box from z0 to z1, half sizes
  // hx along (ex, ey) and hy across
  function columns(r, nav, near) {
    const out = [], n = r.pts.length, hw = r.w / 2;
    let len = 0;
    const cum = r.pts.map((q, i) => (len += i ? Math.hypot(q[0] - r.pts[i - 1][0], q[1] - r.pts[i - 1][1]) : 0));
    const m = Math.floor((len - 16) / SPAN);
    for (let c = 0; c <= m && len > 16; c++) {
      const s = m > 0 ? 8 + (len - 16) * c / m : len / 2;
      let i = 1;
      while (i < n - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = r.pts[i - 1], b = r.pts[i];
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t - r.lift - THICK;
      const water = nav.isWater(x, y), g = water ? Math.min(-2, nav.terrain(x, y)) : nav.terrain(x, y) - 0.3;
      if (z - g < 2.5 || (water && near(x, y, 10))) continue;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push({ x, y, z0: g, z1: z, hx: r.kind === 'road' ? 0.7 : 0.3, hy: r.kind === 'road' ? Math.min(hw - 0.8, 2.5) : 0.3, ex: (b[0] - a[0]) / d, ey: (b[1] - a[1]) / d });
    }
    return out;
  }

  // Columns out of the streets under the decks. An expressway is mapped over the road it follows
  // (Shuto Route 3 over Route 246), so a column under its middle stands in that road's lanes and
  // the traffic drives through it. depth(x, y, z, r): how far a circle reaches into a carriageway
  // at height z (streets.js carriageways, the roads as decks.js has laid them), <= 0 when clear.
  // A column in a carriageway is, in order of preference: moved across under the deck to the
  // nearest spot clear of the roads below (a median), slimmed to a single pier; or split into a
  // portal, as the Shuto's piers over a road are: a leg on each side clear of the roads and a cap
  // beam across under the deck, high enough for the lorries under it; or left out.
  // blocked(x, y, z, r): is a pier there in a building? Returns { moved, portals, dropped }.
  const PIER = 0.6;      // the half size of a pier moved or split off a column
  const HEADROOM = 4.7;  // the clearance under a portal's beam over a road (m)
  function clearColumns(runs, depth, blocked = null) {
    const out = { moved: 0, portals: 0, dropped: 0 };
    // is a box (half sizes hx along ex, ey and hy across), from z up to ztop, clear of the roads? (a road
    // at any level it passes: the ground's, or one carried over a cutting beside it)
    const clearAt = (x, y, z, hx, hy, ex, ey, ztop = z) => {
      const r = Math.min(hx, hy) + 0.25, long = Math.max(hx, hy) - Math.min(hx, hy), ux = hx > hy ? ex : -ey, uy = hx > hy ? ey : ex;
      for (let zz = z; zz <= Math.max(z, ztop) + 1e-6; zz += 2.5)
        for (let u = -long; u <= long + 1e-6; u += Math.max(0.3, long / 3 || 1)) if (depth(x + ux * u, y + uy * u, zz, r) > 0) return false;
      return !blocked || !blocked(x, y, z + 1, Math.max(hx, hy));
    };
    for (const r of runs) {
      if (!r.cols || !r.cols.length) continue;
      const hw = r.w / 2, keep = [];
      for (const c of r.cols) {
        // (a metre down, and up to 4 m under the deck, so that the deck's own ramp over it is not taken for a road beside it)
        const zg = c.z0 + 0.3 - 1, zt = c.z1 - 4;
        if (c.z0 < -1 || clearAt(c.x, c.y, zg, c.hx, c.hy, c.ex, c.ey, zt)) { keep.push(c); continue; }
        const ax = -c.ey, ay = c.ex; // across the deck
        let best = null;
        for (const along of [0, 3, -3, 6, -6, 9, -9]) {
          const bx = c.x + c.ex * along, by = c.y + c.ey * along;
          // the nearest clear spot each side of the line, out to 12 m past the deck's edge
          const side = [null, null];
          for (let u = 0; u <= hw + 12; u += 0.5) for (const k of [0, 1]) {
            const v = k ? u : -u;
            if (side[k] == null && clearAt(bx + ax * v, by + ay * v, zg, PIER, PIER, c.ex, c.ey, zt)) side[k] = v;
          }
          const inner = [side[0], side[1]].filter(v => v != null && Math.abs(v) <= hw - PIER).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
          if (inner != null) { best = { along, v: inner }; break; }
          if (!best && side[0] != null && side[1] != null && c.z1 - (c.z0 + 0.3) - 1.4 >= HEADROOM) best = { along, v0: side[0], v1: side[1] };
        }
        if (best && best.v != null) {
          keep.push(Object.assign({}, c, { x: c.x + c.ex * best.along + ax * best.v, y: c.y + c.ey * best.along + ay * best.v, hx: PIER, hy: PIER }));
          out.moved++;
        } else if (best) {
          const bx = c.x + c.ex * best.along, by = c.y + c.ey * best.along;
          for (const v of [best.v0, best.v1]) keep.push(Object.assign({}, c, { x: bx + ax * v, y: by + ay * v, hx: PIER, hy: PIER }));
          // the cap beam, across from leg to leg just under the deck
          const m = (best.v0 + best.v1) / 2;
          keep.push(Object.assign({}, c, { x: bx + ax * m, y: by + ay * m, z0: c.z1 - 1.4, hx: PIER, hy: (best.v1 - best.v0) / 2 + PIER, beam: true }));
          out.portals++;
        } else out.dropped++;
      }
      r.cols = keep;
    }
    return out;
  }

  // paths: game.json "paths" ({foot, road}: lines of [x, y, z] in decimetres, rewritten in place);
  // frame: the model's extent; boats: the ferries' courses ([[x, y], ...]) and clear: how high they
  // stand out of the water, so that a bridge they pass under clears them.
  // Returns {runs, segs}: the deck polylines to draw, and their pieces for nav.addDecks
  function plan(paths, nav, frame, { boats = [], clear = 0 } = {}) {
    const courses = boats.filter(b => b.length > 1).map(b => {
      const xs = b.map(q => q[0]), ys = b.map(q => q[1]);
      return { b, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const under = pts => { // does a boat pass under the polyline pts ([[x, y, z]])?
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const c of courses) {
        if (c.x1 < x0 || c.x0 > x1 || c.y1 < y0 || c.y0 > y1) continue;
        for (let i = 0; i < c.b.length - 1; i++) for (let j = 0; j < pts.length - 1; j++)
          if (cross(c.b[i][0], c.b[i][1], c.b[i + 1][0], c.b[i + 1][1], pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1])) return true;
      }
      return false;
    };
    const near = (x, y, r) => { // within r of a boat's course?
      for (const c of courses) {
        if (x < c.x0 - r || x > c.x1 + r || y < c.y0 - r || y > c.y1 + r) continue;
        for (let i = 0; i < c.b.length - 1; i++) {
          const [ax, ay] = c.b[i], ex = c.b[i + 1][0] - ax, ey = c.b[i + 1][1] - ay, L2 = ex * ex + ey * ey;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
          if (Math.hypot(x - ax - ex * t, y - ay - ey * t) < r) return true;
        }
      }
      return false;
    };
    const lines = [...paths.foot.map(o => [o, 'foot']), ...paths.road.map(o => [o, 'road'])];
    // where line ends meet (2 m), so a bridge mapped in pieces is told from a stub ending at nothing
    const key = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`, ends = new Map();
    for (const [o] of lines) {
      const n = o.p.length / 3;
      for (const k of n > 1 ? [0, n - 1] : []) { const kk = key(o.p[3 * k] / 10, o.p[3 * k + 1] / 10); ends.set(kk, (ends.get(kk) || 0) + 1); }
    }
    const joined = (x, y) => (ends.get(key(x, y)) || 0) > 1 || x < frame.x0 + 20 || x > frame.x1 - 20 || y < frame.y0 + 20 || y > frame.y1 - 20;
    const runs = [], segs = [];
    for (const [o, kind] of lines) {
      let p = o.p, n = p.length / 3;
      const X = k => p[3 * k] / 10, Y = k => p[3 * k + 1] / 10;
      // what each point is on: 0 the ground, 1 a surface already built (a bridge's strip, steps, a pier), 2 a deck to build
      let cls = new Uint8Array(n), zs = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const x = X(k), y = Y(k), z = p[3 * k + 2] / 10, g = nav.terrain(x, y), water = nav.isWater(x, y);
        // on a sunken promenade's floor or its steps (inland.js: the Horikawa's paths, which the terrain, carried at
        // the street's level over the channel, would lift onto a deck in the air): on that surface
        const pr = nav.inland && nav.inland.promenade ? nav.inland.promenade(x, y) : null;
        if (pr) { cls[k] = 1; zs[k] = pr.z; continue; }
        let s = nav.surfaceAt(x, y, z);
        // a level over a raised deck that is drawn, or a metre off its edge: a bridge's sidewalk the data lifts a
        // level where the bridge itself is an area (Ebisubashi)
        let lifted = false;
        if (!water && z - g > RISE) {
          const s1 = Math.max(s, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => nav.surfaceAt(x + dx, y + dy, z)));
          if (s1 > g + 1 && z > s1 && z - s1 < 2 * RISE) { s = s1; lifted = true; }
        }
        // put on it by the data, or over the water on a pier, or lifted a level over it
        if (s > -Infinity && (Math.abs(s - z) < 1 || (water && z - s < 2 * RISE) || lifted)) { cls[k] = 1; zs[k] = s; }
        else if (!water && z - g <= RISE) zs[k] = g; // on the ground drawn there
        else { cls[k] = 2; zs[k] = z; }
      }
      // a line that comes onto a built surface and ends under it, where the data stops short of a bridge it
      // does not map (Ebisubashi, an area in OpenStreetMap: the street's line ends at the river walk's level
      // under the deck): its loose end is on the surface with the point before it (not an end another line
      // meets, such as a ramp's foot on a quay under a bridge, nor steps, which go down off it)
      if (o.c !== 'steps' && n > 1) for (const [k, j] of [[0, 1], [n - 1, n - 2]]) {
        if (cls[k] !== 0 || cls[j] !== 1 || joined(X(k), Y(k))) continue;
        const s = nav.surfaceAt(X(k), Y(k), zs[k]);
        if (s > zs[k] + 1 && s - zs[k] < 2 * RISE && Math.abs(s - zs[j]) < 1.5) { cls[k] = 1; zs[k] = s; }
      }
      // a line along a bridge's strip that the data puts a few metres past its edge, and so far below it (the
      // Harbour Bridge cycleway, mapped a metre outside the deck and given the ground's height plus a level):
      // on the deck's level beside it, as long as the line is on the strip somewhere else
      if (cls.some(c => c === 1)) for (let k = 0; k < n; k++) {
        if (cls[k] === 1) continue;
        const h = nav.stripBeside(X(k), Y(k), EDGE);
        if (h != null && h - zs[k] > 2 * RISE) { cls[k] = 2; zs[k] = h; }
      }
      // a road over a dip in the ground drawn under it (a rail cutting under the street, the survey's
      // grid catching the bottom of a hollow): carried level over it on a deck, as a road is, from the
      // higher ground or deck within DIP metres before it to the same after, rather than dropping into it
      // (a car would pitch down and up through it at speed). Only where the line is on a deck already
      // within DIP, or the data has it above the ground there: a sag in a hilly street stays on the ground.
      // A dip of less than DIP_Z is left to the ground.
      if (kind === 'road' && n > 2) {
        const c0 = new Float32Array(n);
        for (let k = 1; k < n; k++) c0[k] = c0[k - 1] + Math.hypot(X(k) - X(k - 1), Y(k) - Y(k - 1));
        const z0 = zs.slice();
        for (let k = 1; k < n - 1; k++) {
          if (cls[k] !== 0) continue;
          let best = -Infinity, deck = p[3 * k + 2] / 10 - z0[k] > DIP_Z; // (the data has it higher than the ground drawn there)
          for (let i = k - 1; i >= 0 && c0[k] - c0[i] <= DIP; i--) {
            if (cls[i] === 2) deck = true;
            if (z0[i] - z0[k] <= DIP_Z) continue;
            for (let j = k + 1; j < n && c0[j] - c0[k] <= DIP; j++) {
              if (cls[j] === 2) deck = true;
              if (z0[j] - z0[k] <= DIP_Z) continue;
              const t = (c0[k] - c0[i]) / Math.max(1e-6, c0[j] - c0[i]), z = z0[i] + (z0[j] - z0[i]) * t;
              if (z > best) best = z;
            }
          }
          for (let j = k + 1; j < n && c0[j] - c0[k] <= DIP && !deck; j++) if (cls[j] === 2) deck = true;
          if (deck && best - z0[k] > DIP_Z) { cls[k] = 2; zs[k] = best; }
        }
        // and a road's deck graded smoothly: the data's heights along it are the survey's, a metre up or
        // down from point to point, which a car on it would bob over (eased, never below the ground drawn
        // under it with room for the slab; its ends, where it meets the ground, stay put)
        for (let it = 0; it < 3; it++) {
          const z1 = zs.slice();
          for (let k = 1; k < n - 1; k++) if (cls[k] === 2 && !nav.isWater(X(k), Y(k)))
            zs[k] = Math.max(nav.terrain(X(k), Y(k)) + THICK + 0.6, (z1[k - 1] + 2 * z1[k] + z1[k + 1]) / 4);
        }
      }
      // a loose end on a deck (no other line meets it): cut back what is over the water, and
      // bring the first point on land down to the ground
      const loose = (i, step, stop) => {
        if (joined(X(i), Y(i))) return i;
        const x0 = X(i), y0 = Y(i);
        while (cls[i] === 2 && i !== stop && Math.hypot(X(i) - x0, Y(i) - y0) < STUB) {
          if (!nav.offGround(X(i), Y(i))) { cls[i] = 0; zs[i] = nav.terrain(X(i), Y(i)); break; }
          i += step;
        }
        return i;
      };
      const a = loose(0, 1, n - 1), b = loose(n - 1, -1, a);
      if (b - a < 1) { o.p = []; o.d = new Uint8Array(0); continue; }
      if (a > 0 || b < n - 1) { p = o.p = p.slice(3 * a, 3 * b + 3); cls = cls.slice(a, b + 1); zs = zs.slice(a, b + 1); n = b - a + 1; }
      const cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(X(k) - X(k - 1), Y(k) - Y(k - 1));
      // runs of deck points, between the point before and the point after them
      for (let k = 0; k < n; k++) {
        if (cls[k] !== 2) continue;
        let e = k;
        while (e < n - 1 && cls[e + 1] === 2) e++;
        const i0 = k > 0 ? k - 1 : -1, i1 = e < n - 1 ? e + 1 : -1;
        // a bridge: over the water, on land only for its ramps (20 m), and one level up from its banks
        // (an expressway running over a river, several levels up, is a viaduct)
        const wet = [];
        for (let i = k; i <= e; i++) if (nav.isWater(X(i), Y(i))) wet.push(cum[i]);
        let za = null, zb = null, top = -Infinity;
        if (wet.length > 0 && [...Array(e - k + 1).keys()].every(j => wet.some(s => Math.abs(cum[k + j] - s) <= 20))) {
          za = i0 >= 0 ? zs[i0] : bankZ(nav, X(k), Y(k)); zb = i1 >= 0 ? zs[i1] : bankZ(nav, X(e), Y(e));
          if (za == null) za = zb;
          if (zb == null) zb = za;
          if (za == null) za = zb = 3;
          for (let i = k; i <= e; i++) top = Math.max(top, zs[i]);
        }
        if (za != null && top <= Math.max(za, zb) + LEVEL + 1.5) {
          const s0 = i0 >= 0 ? cum[i0] : cum[k], s1 = i1 >= 0 ? cum[i1] : cum[e], L = Math.max(1, s1 - s0), crown = Math.min(1.2, 0.015 * L);
          // over a ferry's course the span rises to clear the boats, level across the middle of the bridge
          const span = [];
          for (let i = Math.max(0, i0); i <= (i1 >= 0 ? i1 : e); i++) span.push([X(i), Y(i)]);
          const lift = clear > 0 && under(span) ? Math.max(crown, clear + THICK - Math.min(za, zb)) : 0;
          for (let i = k; i <= e; i++) {
            const t = (cum[i] - s0) / L, m = Math.min(1, Math.min(t, 1 - t) / 0.3), rise = lift ? lift * m * m * (3 - 2 * m) : crown * 4 * t * (1 - t);
            zs[i] = Math.max(1.6, za + (zb - za) * t + rise); // clear of the water under its slab
          }
        }
        else if (o.c !== 'steps') {
          // a deck the data's levels make climb steeper than a ramp (a level is taken as 6 m, the Harbour
          // Bridge cycleway's approach drops 30 m from the deck in 23 m): graded evenly from end to end, over the ground
          const a0 = Math.max(0, i0), a1 = i1 >= 0 ? i1 : e;
          let steep = false;
          for (let i = a0; i < a1 && !steep; i++) steep = Math.abs(zs[i + 1] - zs[i]) > SLOPE * Math.max(0.5, cum[i + 1] - cum[i]);
          if (steep && a1 > a0) {
            const L = Math.max(1, cum[a1] - cum[a0]);
            if (Math.abs(zs[a1] - zs[a0]) <= SLOPE * L) for (let i = k; i <= e; i++) zs[i] = Math.max(nav.terrain(X(i), Y(i)) + RISE, zs[a0] + (zs[a1] - zs[a0]) * (cum[i] - cum[a0]) / L);
          }
        }
        const from = Math.max(0, i0), to = i1 >= 0 ? i1 : e, w = kind === 'road' ? (ROADW[o.c] || 7) + 1 : FOOTW[o.c] || 3;
        // a deck ends where it meets the ground or a built surface; its pieces for walking on
        const pts = [];
        for (let i = from; i <= to; i++) pts.push([X(i), Y(i), zs[i]]);
        const run = { pts, w, kind, c: o.c, lift: kind === 'road' ? 0.03 : 0.1 };
        // a deck that stays under RISE over dry ground all along (a road carried over a shallow dip in the
        // street, issue 234: Chuo-dori at Nihonbashi's south bank) is part of the street: no parapets, which
        // would stand across the carriageway where the line meets the next one or crosses the junction
        if (kind === 'road' && pts.every(q => !nav.isWater(q[0], q[1]) && q[2] - nav.terrain(q[0], q[1]) < RISE)) run.parapet = false;
        run.cols = columns(run, nav, near);
        runs.push(run);
        for (let i = from; i < to; i++) segs.push({ ax: X(i), ay: Y(i), az: zs[i], bx: X(i + 1), by: Y(i + 1), bz: zs[i + 1], hw: w / 2, th: THICK, walk: o.c !== 'motorway' });
        k = e;
      }
      // the line follows the ground drawn under it, the built surfaces and the decks; flag what is off the ground
      o.d = new Uint8Array(Math.max(0, n - 1));
      for (let k = 0; k < n; k++) p[3 * k + 2] = Math.round(zs[k] * 10);
      for (let k = 0; k < n - 1; k++) o.d[k] = cls[k] || cls[k + 1] ? 1 : 0;
    }
    return { runs, segs };
  }

  // the decks as one mesh: slab, parapets and columns, from plan()'s runs
  function mesh(runs, lin) {
    const pos = [], col = [];
    const C = { road: lin('#56595d'), foot: lin('#a7a398'), side: lin('#b3afa5'), under: lin('#8e8a82') };
    const V = (x, y, z) => [x, z, -y]; // local (x east, y north, z up) to three.js
    const quad = (a, b, c, d, k) => { for (const v of [a, b, c, a, c, d]) { pos.push(...v); col.push(k.r, k.g, k.b); } };
    const box = (x, y, z0, z1, hx, hy, ex, ey, k) => { // an upright box, half sizes hx along (ex, ey) and hy across
      const P = (u, v, z) => V(x + ex * u - ey * v, y + ey * u + ex * v, z);
      const c = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
      for (let i = 0; i < 4; i++) { const [u0, v0] = c[i], [u1, v1] = c[(i + 1) % 4]; quad(P(u0, v0, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v0, z1), k); }
      quad(P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1), k);
    };
    // a parapet stands only where its deck has an edge: not on another deck's surface, as where a dual
    // carriageway's two lines are each laid as a deck wider than the gap between them (Chuo-dori over the
    // Nihonbashi, issue 234: each one's inner parapet stood across the other's lanes, slanting where the
    // lines converge on the bank). (pieces of every deck in 20 m cells; within a metre and a half in height)
    const CELL = 20, cells = new Map(), cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    runs.forEach((r, ri) => {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], s = { ri, a, b, hw: r.w / 2 }, pad = r.w / 2 + 1;
        for (let x = Math.floor((Math.min(a[0], b[0]) - pad) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + pad) / CELL); x++)
          for (let y = Math.floor((Math.min(a[1], b[1]) - pad) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + pad) / CELL); y++) {
            const k = `${x},${y}`;
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(s);
          }
      }
    });
    const onOther = (ri, x, y, z) => {
      for (const s of cells.get(cellKey(x, y)) || []) {
        if (s.ri === ri) continue;
        const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], L2 = ex * ex + ey * ey;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.a[0]) * ex + (y - s.a[1]) * ey) / L2)) : 0;
        if (Math.hypot(x - s.a[0] - ex * t, y - s.a[1] - ey * t) < s.hw - 0.3 && Math.abs(z - (s.a[2] + (s.b[2] - s.a[2]) * t)) < 1.5) return true;
      }
      return false;
    };
    runs.forEach((r, ri) => {
      const n = r.pts.length, hw = r.w / 2, top = r.colour ? lin(r.colour) : C[r.kind]; // (a strip's approach: its deck's colour)
      // the left of the line at each point, the average of the pieces either side
      const L = r.pts.map((q, i) => {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
        return [-dy / d, dx / d];
      });
      const at = (i, v, dz) => V(r.pts[i][0] + L[i][0] * v, r.pts[i][1] + L[i][1] * v, r.pts[i][2] - r.lift + dz);
      for (let i = 0; i < n - 1; i++) {
        const j = i + 1;
        quad(at(i, -hw, 0), at(j, -hw, 0), at(j, hw, 0), at(i, hw, 0), top);                                   // the surface
        quad(at(i, hw, 0), at(j, hw, 0), at(j, hw, -THICK), at(i, hw, -THICK), C.side);                          // its edges
        quad(at(i, -hw, -THICK), at(j, -hw, -THICK), at(j, -hw, 0), at(i, -hw, 0), C.side);
        quad(at(i, hw, -THICK), at(j, hw, -THICK), at(j, -hw, -THICK), at(i, -hw, -THICK), C.under);             // the soffit
        if (r.parapet !== false) for (const s of [1, -1]) { // parapets: outer face, top, inner face
          const o = s * hw, w = s * (hw - 0.25);
          const mx = (r.pts[i][0] + r.pts[j][0]) / 2 + (L[i][0] + L[j][0]) / 2 * o, my = (r.pts[i][1] + r.pts[j][1]) / 2 + (L[i][1] + L[j][1]) / 2 * o;
          if (onOther(ri, mx, my, (r.pts[i][2] + r.pts[j][2]) / 2)) continue;
          quad(at(i, o, 0), at(j, o, 0), at(j, o, PARAPET), at(i, o, PARAPET), C.side);
          quad(at(i, o, PARAPET), at(j, o, PARAPET), at(j, w, PARAPET), at(i, w, PARAPET), C.side);
          quad(at(i, w, PARAPET), at(j, w, PARAPET), at(j, w, 0), at(i, w, 0), C.side);
        }
      }
      for (const c of r.cols) box(c.x, c.y, c.z0, c.z1, c.hx, c.hy, c.ex, c.ey, C.under);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const M = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }));
    M.castShadow = M.receiveShadow = true;
    return M;
  }

  return { plan, mesh, clearColumns, RISE };
})();
