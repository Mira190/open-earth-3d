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
        const x = X(k), y = Y(k), z = p[3 * k + 2] / 10, g = nav.terrain(x, y), water = nav.isWater(x, y), s = nav.surfaceAt(x, y);
        if (s > -Infinity && (Math.abs(s - z) < 1 || (water && z - s < 2 * RISE))) { cls[k] = 1; zs[k] = s; } // put on it by the data, or over the water on a pier
        else if (!water && z - g <= RISE) zs[k] = g; // on the ground drawn there
        else { cls[k] = 2; zs[k] = z; }
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
        const from = Math.max(0, i0), to = i1 >= 0 ? i1 : e, w = kind === 'road' ? (ROADW[o.c] || 7) + 1 : FOOTW[o.c] || 3;
        // a deck ends where it meets the ground or a built surface; its pieces for walking on
        const pts = [];
        for (let i = from; i <= to; i++) pts.push([X(i), Y(i), zs[i]]);
        const run = { pts, w, kind, c: o.c, lift: kind === 'road' ? 0.03 : 0.1 };
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
    for (const r of runs) {
      const n = r.pts.length, hw = r.w / 2, top = C[r.kind];
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
        for (const s of [1, -1]) { // parapets: outer face, top, inner face
          const o = s * hw, w = s * (hw - 0.25);
          quad(at(i, o, 0), at(j, o, 0), at(j, o, PARAPET), at(i, o, PARAPET), C.side);
          quad(at(i, o, PARAPET), at(j, o, PARAPET), at(j, w, PARAPET), at(i, w, PARAPET), C.side);
          quad(at(i, w, PARAPET), at(j, w, PARAPET), at(j, w, 0), at(i, w, 0), C.side);
        }
      }
      for (const c of r.cols) box(c.x, c.y, c.z0, c.z1, c.hx, c.hy, c.ex, c.ey, C.under);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const M = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }));
    M.castShadow = M.receiveShadow = true;
    return M;
  }

  return { plan, mesh, RISE };
})();
