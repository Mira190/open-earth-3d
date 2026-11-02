// Open Earth 3D streets: where the street furniture may stand, and which of it is solid.
//
// The game draws each mapped road as a band of its class's width (game.js streetTexture), its
// traffic keeps to lanes inside the band, and a car pulls in with its kerb-side wheels on the
// band's edge (cars.js kerbOf). OpenStreetMap maps many street lamps as nodes of the road's
// own line, trees in kerb build-outs and between a dual carriageway's two lines (which the
// game draws over each other), and night.js stands its street lights a fixed distance off each
// road, which at a junction, or beside a road running close to another, is inside the other.
// So, as a city's games do with the props they place by hand:
//  - carriageways(lines): the bands, grown to the outer side of a car parked at the kerb, in a
//    grid; depth() is how far a circle reaches into one at its own level (a viaduct overhead
//    is not in the way), kerbside() the nearest place clear of all of them, or null where none
//    is near (in the middle of a junction, between two bands drawn over each other);
//  - tidy(D): a city's mapped lamps, benches and trees moved out of them, or left out, once
//    for the viewer and the game alike (world.js), before anything is drawn;
//  - posts(): lamp posts and tree trunks as circles in a grid, which the walkers, your car and
//    the traffic treat as solid.
// Like vehicles.js and cars.js, nothing here depends on the three.js version.
'use strict';
window.OEStreets = (function () {
  // road widths by class (m), as game.js draws the streets and cars.js pulls in to the kerb
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const LEVEL = 3;  // a road and a thing this far apart in height are on different levels (a deck over a street)
  const CAR_HW = 1.0; // the half width of the widest car that parks (the SUV, with its mirrors)
  // where a car parked at the kerb has its centre (cars.js kerbOf), and the band furniture keeps out of
  const kerb = c => Math.min(6.5, Math.max(3.3, (ROADW[c] || 7) / 2 - 0.1));
  const setback = c => Math.max((ROADW[c] || 7) / 2, kerb(c) + CAR_HW);
  const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

  // lines: [{ c: class, p: [x, y, z, ...] in metres }]
  function carriageways(lines) {
    const S = [], grid = new Map(), GC = 16, key = (cx, cy) => cx * 131071 + cy;
    for (const l of lines) {
      const p = l.p, hw = setback(l.c);
      for (let k = 3; k + 2 < p.length; k += 3) {
        const ax = p[k - 3], ay = p[k - 2], bx = p[k], by = p[k + 1];
        if (ax === bx && ay === by) continue;
        const i = S.push({ ax, ay, az: p[k - 1], bx, by, bz: p[k + 2], hw, c: l.c }) - 1;
        for (let cx = Math.floor((Math.min(ax, bx) - hw) / GC); cx <= Math.floor((Math.max(ax, bx) + hw) / GC); cx++)
          for (let cy = Math.floor((Math.min(ay, by) - hw) / GC); cy <= Math.floor((Math.max(ay, by) + hw) / GC); cy++) {
            const kk = key(cx, cy), g = grid.get(kk);
            if (g) g.push(i); else grid.set(kk, [i]);
          }
      }
    }
    const out = { deep: 0, nx: 0, ny: 0, d: 0, seg: null };
    // the band a circle (radius r, at height z) reaches deepest into: out.deep (<= 0: clear of every
    // band), and the way out of it, (nx, ny), from the band's line
    function deepest(x, y, z, r) {
      out.deep = -Infinity; out.seg = null;
      for (const i of grid.get(key(Math.floor(x / GC), Math.floor(y / GC))) || []) {
        const s = S[i], ex = s.bx - s.ax, ey = s.by - s.ay, L2 = ex * ex + ey * ey;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / L2));
        if (z != null && Math.abs(s.az + (s.bz - s.az) * t - z) >= LEVEL) continue;
        const qx = s.ax + ex * t, qy = s.ay + ey * t, d = Math.hypot(x - qx, y - qy), deep = s.hw + r - d;
        if (deep <= out.deep) continue;
        out.deep = deep; out.seg = s; out.d = d;
        if (d > 1e-3) { out.nx = (x - qx) / d; out.ny = (y - qy) / d; }
        else { const L = Math.sqrt(L2), side = hash(x, y) < 0.5 ? 1 : -1; out.nx = -ey / L * side; out.ny = ex / L * side; } // on the line: either kerb
      }
      if (!out.seg) out.deep = -Infinity;
      return out;
    }
    return {
      segments: S,
      // how far a circle of radius r at (x, y), at height z (null: any), reaches into a band; <= 0 when clear
      depth(x, y, z, r = 0) { return deepest(x, y, z, r).deep; },
      // the nearest place within reach of (x, y) where a circle of radius r is clear of every band
      // at its level: [x, y], or null
      kerbside(x, y, z, r = 0, reach = 6) {
        let px = x, py = y;
        for (let it = 0; it < 8; it++) {
          const q = deepest(px, py, z, r);
          if (q.deep <= 0) return Math.hypot(px - x, py - y) <= reach ? [px, py] : null;
          px += q.nx * (q.deep + 0.06); py += q.ny * (q.deep + 0.06); // (past the edge by more than a decimetre rounds)
        }
        return null;
      },
    };
  }

  // the road lines of a city: the game's (game.json, decimetres), else night.json's (the viewer)
  function roadLines(D) {
    if (D.G && D.G.paths) return D.G.paths.road.map(r => ({ c: r.c, p: r.p.map(v => v / 10) }));
    const N = D.N;
    if (!N || !N.roads) return [];
    const unpack = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int16Array(u.buffer); };
    const R = unpack(N.roads), P = unpack(N.pts), [XY, ZU] = N.units, out = [];
    for (let i = 0, k = 0; i < R.length; i += 3) {
      const n = R[i + 2], p = [];
      for (let j = 0; j < n; j++, k += 3) p.push(P[k] * XY, P[k + 1] * XY, P[k + 2] * ZU);
      out.push({ c: N.classes[R[i]], p });
    }
    return out;
  }

  // Move a city's mapped street furniture out of the carriageways, once (world.js, before anything
  // is drawn): the lamps (game.json props, or night.json's in the viewer), the benches and the
  // trees (places.json), each to the nearest place clear of every band, or left out where there
  // is none within a few metres. D.streets: { roads (carriageways), lamps: [x, y, z, ...] in
  // metres (for night.js), moved, dropped }.
  function tidy(D) {
    if (D.streets) return D.streets;
    const lines = roadLines(D), st = D.streets = { roads: null, lamps: null, moved: {}, dropped: {} };
    if (!lines.length) return st;
    const cw = st.roads = carriageways(lines);
    // flat lists of `stride` numbers per item, x and y first then z, in units of `u` metres
    const fix = (name, flat, stride, u, r, zu = u) => {
      const keep = [];
      let moved = 0, dropped = 0;
      for (let i = 0; i + stride - 1 < flat.length; i += stride) {
        const x = flat[i] * u, y = flat[i + 1] * u, z = flat[i + 2] * zu, q = cw.kerbside(x, y, z, r);
        if (!q) { dropped++; continue; }
        const item = Array.prototype.slice.call(flat, i, i + stride);
        if (q[0] !== x || q[1] !== y) { item[0] = Math.round(q[0] / u); item[1] = Math.round(q[1] / u); moved++; }
        keep.push(...item);
      }
      st.moved[name] = moved; st.dropped[name] = dropped;
      return keep;
    };
    if (D.P && D.P.trees) D.P.trees = fix('trees', D.P.trees, 4, 0.1, 0.7);
    const props = D.G && D.G.props;
    if (props) {
      if (props.street_lamp) props.street_lamp = fix('lamps', props.street_lamp, 3, 0.1, 0.25);
      if (props.bench) props.bench = fix('benches', props.bench, 3, 0.1, 0.95);
      st.lamps = (props.street_lamp || []).map(v => v / 10);
    } else if (D.N && D.N.lamps) {
      const s = atob(D.N.lamps), u8 = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
      const [XY, ZU] = D.N.units, L = fix('lamps', new Int16Array(u8.buffer), 3, XY, 0.25, ZU);
      st.lamps = L.map((v, i) => v * (i % 3 === 2 ? ZU : XY));
    }
    return st;
  }

  // ------------------------------------------------------------ posts: lamp posts and trunks, solid
  // add(x, y, z, r, kind) each, then near(x, y, r, fn) calls fn(post) for each post whose circle
  // comes within r of (x, y) ({ x, y, z, r, kind }), and pushOut moves a circle out of them
  function posts() {
    const list = [], grid = new Map(), GC = 8, key = (cx, cy) => cx * 131071 + cy;
    let big = 0;
    const api = {
      list,
      add(x, y, z, r, kind) {
        const p = { x, y, z, r, kind }, k = key(Math.floor(x / GC), Math.floor(y / GC)), g = grid.get(k);
        list.push(p);
        if (g) g.push(p); else grid.set(k, [p]);
        if (r > big) big = r;
        return p;
      },
      near(x, y, r, fn, z = null) {
        const R = r + big;
        for (let cx = Math.floor((x - R) / GC); cx <= Math.floor((x + R) / GC); cx++) for (let cy = Math.floor((y - R) / GC); cy <= Math.floor((y + R) / GC); cy++) {
          const g = grid.get(key(cx, cy));
          if (g) for (const p of g) if (Math.abs(p.x - x) < r + p.r && Math.abs(p.y - y) < r + p.r && (z == null || Math.abs(p.z - z) < 2.5)) fn(p);
        }
      },
      // a circle of radius r with its foot at z, out of every post it overlaps: { x, y, hit }
      pushOut(x, y, r, z = null) {
        let hit = null;
        for (let it = 0; it < 2; it++) {
          let moved = false;
          api.near(x, y, r, p => {
            const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy), m = p.r + r - d;
            if (m <= 0) return;
            if (d > 1e-6) { x += dx / d * m; y += dy / d * m; } else x += m;
            hit = p; moved = true;
          }, z);
          if (!moved) break;
        }
        return { x, y, hit };
      },
    };
    return api;
  }

  return { ROADW, LEVEL, kerb, setback, carriageways, roadLines, tidy, posts };
})();
