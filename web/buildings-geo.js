// Open Earth 3D buildings: the walls, roofs, decks, parapets, posts and awnings of a city as packed vertex
// arrays, from buildings.json's rows (buildings.js turns them into one mesh and draws its facades). Pure
// arithmetic on the decoded data, with no three.js, so that it runs in a Worker (pack-worker.js, issue 344:
// 4 to 7 s of the loader's main thread in a large city) or, where there is none, on the page in slices.
// Works in a page (window.OEBuildingsGeo), a Worker (self) and Node (require).
'use strict';
(function (root) {
  // the posts under a canopy (a solid of class "roof" lifted off the ground, pipeline/arcades.py: a
  // covered walkway or a gate): [[x, y], ...] in metres, 0.25 m in from its outline. A long thin one (an
  // arcade) stands on posts every 6 m along its edges, anything else (a gate, a shelter) on its corners, and a
  // roof over 400 m2 every 8 m along a side longer than 12 m too. nav.js
  // walks round the same posts. skip: [x_dm, y_dm, ...] posts not put up, where one would stand in a road's
  // carriageway (buildings.json no_posts, by building: pipeline/road_passages.py). inner: [x_dm, y_dm, ...] the
  // rows of posts inside a roof over 400 m2 (buildings.json inner_posts, by building: pipeline/arcades.py),
  // those inside this solid's outline
  const POST = 0.3; // a post's side (m)
  function canopyPosts(s, meta, skip = null, inner = null) {
    if (!(s[2] > 0) || !meta || meta[1] !== 'roof') return [];
    const r = s[4], n = r.length / 2, out = [];
    let area = 0, per = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, ax = r[2 * k] / 10, ay = r[2 * k + 1] / 10, bx = r[2 * j] / 10, by = r[2 * j + 1] / 10;
      area += ax * by - bx * ay; per += Math.hypot(bx - ax, by - ay);
    }
    const sg = area > 0 ? 1 : -1, thin = per > 40 && Math.abs(area) / per <= 2.5; // (mean width = 2 area / perimeter)
    const wide = Math.abs(area) / 2 > 400; // bigger than a gate (pipeline/arcades.py is_gate): its long sides on posts too
    const P = k => [r[2 * ((k + n) % n)] / 10, r[2 * ((k + n) % n) + 1] / 10];
    const inward = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l * sg, dx / l * sg]; };
    let last = null;
    const add = (x, y) => { if (!last || Math.hypot(x - last[0], y - last[1]) > 3) { out.push([x, y]); last = [x, y]; } };
    for (let k = 0; k < n; k++) {
      const a = P(k - 1), b = P(k), c = P(k + 1), n0 = inward(a, b), n1 = inward(b, c);
      let nx = n0[0] + n1[0], ny = n0[1] + n1[1];
      const l = Math.hypot(nx, ny) || 1;
      add(b[0] + nx / l * 0.25, b[1] + ny / l * 0.25);
      const L = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (thin || (wide && L > 12)) { // along the edge to the next corner (a wide roof's long side: a platform's or a forecourt's canopy)
        const m = Math.floor(L / (thin ? 6 : 8));
        for (let i = 1; i < m; i++) { const t = i / m; add(b[0] + (c[0] - b[0]) * t + n1[0] * 0.25, b[1] + (c[1] - b[1]) * t + n1[1] * 0.25); }
      }
    }
    if (out.length > 1 && Math.hypot(out[0][0] - last[0], out[0][1] - last[1]) <= 3) out.pop();
    if (inner && inner.length) {
      for (let i = 0; i < inner.length; i += 2) {
        const x = inner[i] / 10, y = inner[i + 1] / 10;
        let c = false; // (inside the outline: even-odd crossings)
        for (let k = 0, j = n - 1; k < n; j = k++) {
          const xk = r[2 * k] / 10, yk = r[2 * k + 1] / 10, xj = r[2 * j] / 10, yj = r[2 * j + 1] / 10;
          if ((yk > y) !== (yj > y) && x < (xj - xk) * (y - yk) / (yj - yk) + xk) c = !c;
        }
        if (c) out.push([x, y]);
      }
    }
    if (skip && skip.length) return out.filter(([x, y]) => { for (let i = 0; i < skip.length; i += 2) if (Math.hypot(x - skip[i] / 10, y - skip[i + 1] / 10) < 0.6) return false; return true; });
    return out;
  }
  const STYLES = ['plain', 'house', 'terrace', 'apartment', 'office', 'glass', 'heritage', 'retail', 'industrial', 'civic',
    'machiya', 'mixed', 'stone', 'haussmann', 'grachtenpand', 'wall'];
  const SI = Object.fromEntries(STYLES.map((s, i) => [s, i]));
  // per style: bay width m, window width (share of a bay), sill and head (shares of a storey)
  const GRID = {
    plain: [0, 0, 0, 0], house: [3.3, 0.42, 0.3, 0.8], terrace: [2.8, 0.44, 0.24, 0.86], apartment: [3.0, 0.5, 0.27, 0.86],
    office: [3.0, 0.68, 0.25, 0.9], glass: [1.5, 1.0, 0.0, 1.0], heritage: [3.6, 0.4, 0.22, 0.84], retail: [4.2, 0.42, 0.34, 0.8],
    industrial: [6.0, 0.72, 0.64, 0.88], civic: [3.6, 0.88, 0.32, 0.8], machiya: [1.8, 0.72, 0.3, 0.76], mixed: [2.8, 0.7, 0.22, 0.86],
    stone: [0, 0, 0, 0], haussmann: [2.9, 0.44, 0.06, 0.82], grachtenpand: [2.3, 0.5, 0.12, 0.86], wall: [0, 0, 0, 0],
  };
  // per style: interior depth (bays), frame darkness, glass reflectance (metalness), wall roughness
  const LOOK = {
    plain: [1, 0, 0, 0.9], house: [1.2, 0.55, 0.15, 0.88], terrace: [1.4, 0.6, 0.15, 0.85], apartment: [1.4, 0.45, 0.2, 0.8],
    office: [1.6, 0.4, 0.25, 0.7], glass: [2.6, 0.3, 0.55, 0.45], heritage: [1.3, 0.6, 0.15, 0.9], retail: [1.8, 0.4, 0.15, 0.8],
    industrial: [3, 0.5, 0.1, 0.75], civic: [1.8, 0.4, 0.25, 0.75], machiya: [1, 0.7, 0.02, 0.9], mixed: [1.5, 0.45, 0.2, 0.75],
    stone: [1, 0, 0, 0.95], haussmann: [1.3, 0.35, 0.12, 0.88], grachtenpand: [1.2, 0.3, 0.18, 0.9], wall: [1, 0, 0, 0.95],
  };
  // regional grids: Japan builds on the 910 mm module (sliding units of 1,690 mm on 1,820 mm bays),
  // machiya fronts are three bays of 1.97 m
  const REGION_GRID = {
    japan: { house: [1.82, 0.62, 0.3, 0.8], terrace: [1.82, 0.7, 0.28, 0.82], apartment: [3.6, 0.76, 0.02, 0.86],
      office: [3.2, 0.7, 0.22, 0.88], mixed: [2.8, 0.74, 0.2, 0.86], machiya: [1.97, 0.86, 0.3, 0.82] },
  };
  // storey heights per style (m): typical and the tallest, as pipeline/typology.py
  const STOREY = { plain: 3.0, house: 2.9, terrace: 3.2, apartment: 3.0, office: 3.8, glass: 3.9, heritage: 4.6, retail: 4.2,
    industrial: 6.0, civic: 4.0, machiya: 2.9, mixed: 3.3, stone: 4.0, haussmann: 3.05, grachtenpand: 3.2 };
  const STOREY_MAX = { plain: 6.0, industrial: 8.0, stone: 6.0, house: 3.3, terrace: 3.5, apartment: 3.3, office: 4.4, glass: 4.5, heritage: 5.5, retail: 5.0,
    civic: 5.0, machiya: 3.2, mixed: 3.8, haussmann: 3.4, grachtenpand: 4.2 };
  const PARAPET = { office: 1.1, glass: 1.2, apartment: 1.0, heritage: 1.3, retail: 0.9, civic: 1.0, mixed: 1.0, industrial: 0.5, haussmann: 1.0 };
  const ROOF_MAT = ['membrane', 'gravel', 'concrete', 'tile', 'metal', 'slate', 'kawara', 'copper', 'glass', 'green', 'zinc'];
  const CURVED = new Set([8, 9, 10]); // round, dome, onion: smooth shading
  // kinds of surface in the 'inf' attribute
  const K_FACADE = 0, K_WALL = 1, K_ROOF = 2, K_DECK = 3, K_TRIM = 4, K_SOFFIT = 5;

  // a style for a buildings.json row that predates styles: from class and height
  function guessStyle(m) {
    const cls = m[1] || '', top = m[2];
    if (/^(garage|garages|shed|carport|roof|service|greenhouse|parking|storage_tank|silo)$/.test(cls)) return 'plain';
    if (m[4] === 'parametric') return 'plain';
    if (top >= 80 || (/^(office|commercial)$/.test(cls) && top >= 40)) return 'glass';
    if (/^(church|cathedral|chapel|public|government|civic|museum|train_station|university|college|library)$/.test(cls)) return top <= 50 ? 'heritage' : 'office';
    if (/^(house|detached|semidetached_house|bungalow)$/.test(cls)) return 'house';
    if (cls === 'terrace') return 'terrace';
    if (/^(apartments|residential|dormitory|hotel)$/.test(cls)) return 'apartment';
    if (/^(office|commercial)$/.test(cls)) return 'office';
    if (/^(retail|supermarket)$/.test(cls)) return top < 12 ? 'retail' : 'office';
    if (/^(industrial|warehouse|manufacture)$/.test(cls)) return 'industrial';
    if (/^(school|hospital|kindergarten|fire_station|transportation)$/.test(cls)) return 'civic';
    if (top < 10) return 'house';
    return top >= 15 ? 'office' : 'apartment';
  }

  function hash1(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b) >>> 0; x ^= x >>> 16; return x / 4294967296; }

  // inward mitre offset of a ring (flat x, y metres; outer anticlockwise, holes clockwise); null if it folds
  function inset(r, d) {
    const n = r.length / 2, out = new Array(r.length);
    for (let k = 0; k < n; k++) {
      const i = (k + n - 1) % n, j = (k + 1) % n;
      let ax = r[2 * k] - r[2 * i], ay = r[2 * k + 1] - r[2 * i + 1], bx = r[2 * j] - r[2 * k], by = r[2 * j + 1] - r[2 * k + 1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) return null;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      const n1x = -ay, n1y = ax, n2x = -by, n2y = bx; // left normals point inside
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) return null;
      mx /= ml; my /= ml;
      const c = mx * n1x + my * n1y;
      if (c < 0.35) return null; // a spike: no clean inset
      out[2 * k] = r[2 * k] + mx * d / c;
      out[2 * k + 1] = r[2 * k + 1] + my * d / c;
    }
    // the inset must keep its orientation and every edge its direction
    let a0 = 0, a1 = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      a0 += r[2 * k] * r[2 * j + 1] - r[2 * j] * r[2 * k + 1];
      a1 += out[2 * k] * out[2 * j + 1] - out[2 * j] * out[2 * k + 1];
      const dx0 = r[2 * j] - r[2 * k], dy0 = r[2 * j + 1] - r[2 * k + 1], dx1 = out[2 * j] - out[2 * k], dy1 = out[2 * j + 1] - out[2 * k + 1];
      if (dx0 * dx1 + dy0 * dy1 <= 0) return null;
    }
    return Math.sign(a0) === Math.sign(a1) && Math.abs(a1) > 0.25 * Math.abs(a0) ? out : null;
  }


  // a 2D point for triangulate() (three.js's ShapeUtils.triangulateShape reads x, y and equals)
  class V2 {
    constructor(x, y) { this.x = x; this.y = y; }
    equals(v) { return v.x === this.x && v.y === this.y; }
  }

  // a growable set of packed vertex arrays: byte normals and colours, 16-bit style and storey
  // data, so a city of a million vertices takes about 45 MB rather than 80
  function Buf() {
    let cap = 1 << 16, n = 0;
    let P = new Float32Array(cap * 3), N = new Int8Array(cap * 3), C = new Uint8Array(cap * 3), F = new Float32Array(cap * 2),
      I = new Uint16Array(cap * 4), E = new Uint16Array(cap * 3), B = new Float32Array(cap), S = new Uint8Array(cap);
    const idx = [];
    const grow = () => {
      cap *= 2;
      const g = (a, k) => { const b = new a.constructor(cap * k); b.set(a); return b; };
      P = g(P, 3); N = g(N, 3); C = g(C, 3); F = g(F, 2); I = g(I, 4); E = g(E, 3); B = g(B, 1); S = g(S, 1);
    };
    const u8 = v => Math.max(0, Math.min(255, Math.round(v * 255))), i8 = v => Math.max(-127, Math.min(127, Math.round(v * 127)));
    return {
      get n() { return n; }, idx,
      // local x, y, z; normal nx, ny, nz (local frame); colour; facade coords; info (kind * 16 + style, storey m,
      // ground floor m, seed 0..1); extra (openness 0..1, flags, bays); building; height source
      v(x, y, z, nx, ny, nz, c, fu, fv, i0, i1, i2, i3, e0, e1, e2, bid, src) {
        if (n === cap) grow();
        P[3 * n] = x; P[3 * n + 1] = z; P[3 * n + 2] = -y;
        N[3 * n] = i8(nx); N[3 * n + 1] = i8(nz); N[3 * n + 2] = i8(-ny);
        C[3 * n] = u8(Math.sqrt(c.r)); C[3 * n + 1] = u8(Math.sqrt(c.g)); C[3 * n + 2] = u8(Math.sqrt(c.b)); // stored as sqrt: dark colours keep their precision
        F[2 * n] = fu; F[2 * n + 1] = fv;
        I[4 * n] = i0; I[4 * n + 1] = Math.round(i1 * 100); I[4 * n + 2] = Math.round(i2 * 100); I[4 * n + 3] = Math.round(i3 * 65535);
        E[3 * n] = Math.round(Math.max(0, Math.min(1, e0)) * 65535); E[3 * n + 1] = e1; E[3 * n + 2] = Math.min(65535, e2);
        B[n] = bid; S[n] = src;
        return n++;
      },
      // the arrays cut to the vertices made, and the index (16-bit where it fits)
      arrays() {
        const sl = (a, k) => a.slice(0, n * k);
        return { n, position: sl(P, 3), normal: sl(N, 3), color: sl(C, 3), fac: sl(F, 2), inf: sl(I, 4), ext: sl(E, 3), bid: sl(B, 1), srcCode: sl(S, 1),
          index: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx) };
      },
    };
  }

  // sky openness of a wall point facing (nx, ny), from a coarse surface model: 1 - mean sine of the horizon.
  // In two steps, since a wall asks it at every storey of the same point: rays() samples the model along
  // each direction once (the cells a ray crosses do not depend on the height), then openness() takes the
  // horizon from those samples for a height z, as the single pass did (issue 266: the loader's longest frame
  // spent a second here in Shibuya)
  const DIRS = [-1.05, -0.5, 0, 0.5, 1.05], STEPS = [5, 9, 14, 21, 30, 42, 58, 80, 110];
  const DCOS = DIRS.map(Math.cos), DSIN = DIRS.map(Math.sin), NS = STEPS.length;
  const RAYS = [new Float32Array(DIRS.length * (NS + 1)), new Float32Array(DIRS.length * (NS + 1))]; // (a wall's two ends, reused)
  function rays(G, x, y, nx, ny, end) {
    if (!G) return null;
    const { nx: gx, ny: gy, cell, x0, y1, data } = G, out = RAYS[end].fill(0); // (per direction: its count, then its samples)
    for (let i = 0; i < DIRS.length; i++) {
      const c = DCOS[i], s = DSIN[i], dx = nx * c - ny * s, dy = nx * s + ny * c;
      for (let k = 0; k < NS; k++) {
        const d = STEPS[k], col = Math.floor((x + dx * d - x0) / cell), row = Math.floor((y1 - (y + dy * d)) / cell);
        if (col < 0 || row < 0 || col >= gx || row >= gy) break; // (the ray has left the model)
        out[i * (NS + 1) + 1 + k] = data[row * gx + col];
        out[i * (NS + 1)] = k + 1;
      }
    }
    return out;
  }
  function openness(R, z) {
    if (!R) return 1;
    let acc = 0;
    for (let i = 0; i < DIRS.length; i++) {
      let best = 0;
      const o = i * (NS + 1), m = R[o];
      for (let k = 0; k < m; k++) {
        const t = (R[o + 1 + k] - z) / STEPS[k];
        if (t > best) best = t;
      }
      acc += best / Math.sqrt(1 + best * best);
    }
    return Math.max(0.15, 1 - acc / DIRS.length);
  }


  // The walls, roofs and decks of every solid. B: buildings.json as decoded (its roofs unpacked by Sun.roofs,
  // demolished solids flat). o: { T, Tfine (the ground grids drawn: the walls reach down to them), frame,
  // hidden (solids a landmark draws instead), region ('japan', ...), photoOK (flat roofs show the aerial photo),
  // SRC (height source codes), small, colours (sRGB hex -> linear [r, g, b] for every colour colourNames()
  // lists: the page's lin()), triangulate (contour, holes) -> faces, slice (ms between pauses, 0: none),
  // progress (f) }. Resolves with the vertex arrays and the decks' heights by solid (for the rooftop plant).
  const pause = () => new Promise(r => setTimeout(r, 0));
  async function build(B, { T, Tfine = null, frame, hidden: hiddenSolids = [], region = '', photoOK = false, SRC, small = false, colours, triangulate, slice = 0, progress = null }) {
    const t0 = performance.now(), S = root.Sun;
    const foot = (x, y) => Math.min(S.terrainTri(T, x, y), Tfine ? S.terrainTri(Tfine, x, y) : Infinity);
    const cc = new Map();
    const lin = hex => {
      let c = cc.get(hex);
      if (!c) { const v = colours[hex] || [0.5, 0.5, 0.5]; c = { r: v[0], g: v[1], b: v[2] }; cc.set(hex, c); }
      return c;
    };
    const GRIDS = Object.assign({}, GRID, REGION_GRID[region] || {});
    const meta = B.b, hasStyle = (B.fields || []).some(f => /^style\b/.test(f));
    const roofOf = new Map((B.r || []).map(r => [r[0], S.unpackRoof(r)]));
    const frontOf = new Map((B.f || []).map(f => {
      const m = new Map();
      for (let k = 1; k < f.length; k += 2) m.set(f[k], f[k + 1]);
      return [f[0], m];
    }));

    // per building: style, storey, ground floor, seed, colours
    const styleList = B.styles || STYLES, matList = B.roof_materials || ROOF_MAT;
    const BI = meta.map((m, i) => {
      const own = hasStyle && m[10] != null;
      const style = own ? (typeof m[10] === 'number' ? styleList[m[10]] : m[10]) : guessStyle(m);
      let storey = own ? m[11] : 0, ground = own ? m[12] : 0;
      // a record of one floor on a wall that could hold two of the style's tallest (a register that
      // counts a whole block as one storey) is counted from the style's storey height instead, as
      // pipeline/typology.py storeys() now does
      const smax = STOREY_MAX[style];
      if (own && m[3] === 1 && smax && m[2] > 2 * smax && storey > smax) {
        const gx = Math.max(0, ground - storey), n = Math.max(1, Math.round((m[2] - gx) / STOREY[style]));
        storey = Math.min(Math.max((m[2] - gx) / n, 2.6), 6.5); ground = storey + gx;
      }
      if (!storey && style !== 'wall') {
        const res = /^(house|terrace|apartment)$/.test(style);
        storey = res ? 3.0 : style === 'heritage' ? 4.4 : 3.8;
        ground = storey + (res ? 0 : 0.8);
      }
      const seed = own ? m[14] : Math.floor(hash1(i + 1) * 65535);
      return { style, si: SI[style] ?? 0, storey, ground, seed, u: (seed % 997) / 997,
        wall: lin(m[7] || '#bdb6aa'), roof: lin(m[8] || '#8d8f8f'),
        mat: own ? Math.max(0, ROOF_MAT.indexOf(typeof m[13] === 'number' ? matList[m[13]] : m[13])) : 0,
        code: SRC[m[4]] ?? 2, windows: style !== 'plain' && style !== 'stone' && style !== 'wall' && m[4] !== 'parametric' };
    });

    // a 4 m surface model of building tops for the openness bake
    let G = null;
    try {
      G = S.buildDSM(T, B.s, { cell: 4, x0: frame.x[0], x1: frame.x[1], y0: frame.y[0], y1: frame.y[1] });
    } catch (e) { G = null; }

    if (slice) await pause();
    const buf = Buf();
    const trimC = lin('#d6d2c8'), soffitC = lin('#e9e4d8'), awnC = lin('#3b3f43');

    // ------------------------------------------------------------ walls
    const LEVELS = [0, 8, 24, 48, 96, 192, 384];
    // signRun: this ring carries the building's one vertical corner sign (mixed-use fronts), at the
    // start of its longest run on a street (else its longest run)
    function walls(ring, bi, si, zb, zt, g0, kindOk, fronts, o, signRun = false) {
      const P = BI[bi], n = ring.length / 2, grid = GRIDS[P.style] || GRID.plain;
      const bayW = grid[0] * (0.92 + 0.16 * P.u);
      // edges, directions and turns; runs break at corners sharper than 30 degrees
      const ex = [], ey = [], L = [];
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, dx = ring[2 * j] - ring[2 * k], dy = ring[2 * j + 1] - ring[2 * k + 1], l = Math.hypot(dx, dy);
        ex.push(l > 1e-9 ? dx / l : 1); ey.push(l > 1e-9 ? dy / l : 0); L.push(l);
      }
      const sharp = [];
      for (let k = 0; k < n; k++) {
        const i = (k + n - 1) % n, c = ex[i] * ex[k] + ey[i] * ey[k];
        sharp.push(c < 0.866 || L[k] < 0.05 || L[i] < 0.05);
      }
      let start = sharp.indexOf(true);
      if (start < 0) start = 0;
      const runs = [];
      for (let t = 0; t < n; t++) {
        const k = (start + t) % n;
        if (t === 0 || sharp[k]) runs.push([]);
        runs[runs.length - 1].push(k);
      }
      const h = zt - zb, levels = LEVELS.filter(l => l < h).map(l => zb + l).concat([zt]);
      let signAt = -1;
      if (signRun) {
        let best = -1;
        runs.forEach((run, ri) => {
          let total = 0, street = 0;
          for (const k of run) { total += L[k]; if (fronts && o === 0 && fronts.get(k)) street = 1e6; }
          if (street + total > best) { best = street + total; signAt = ri; }
        });
      }
      for (const [ri, run] of runs.entries()) {
        let total = 0;
        for (const k of run) total += L[k];
        const margin = 0.6, nb = bayW > 0 && kindOk ? Math.floor((total - 2 * margin) / bayW + 0.5) : 0;
        // whole floors under the eave: a floor whose window head does not fit gets none
        const ht = zt - g0, qTop = ht < P.ground ? ht / P.ground : 1 + (ht - P.ground) / P.storey;
        const nFloors = Math.max(0, Math.floor(qTop - grid[3] + 1 + 1e-3));
        const facade = nb >= 1 && h >= 2.2;
        const kind = facade ? K_FACADE : K_WALL;
        const scale = facade ? nb / (total - 2 * margin) : 1;
        let u = 0;
        for (let t = 0; t < run.length; t++) {
          const k = run[t], j = (k + 1) % n;
          if (L[k] < 0.05) continue;
          const nx = ey[k], ny = -ex[k]; // outward for an anticlockwise outer ring (holes are clockwise: also outward)
          // smooth normals across the gentle turns inside a run
          const prev = run[t - 1], next = run[t + 1];
          let ax = nx, ay = ny, bx = nx, by = ny;
          if (prev !== undefined) { const qx = nx + ey[prev], qy = ny - ex[prev], ql = Math.hypot(qx, qy); ax = qx / ql; ay = qy / ql; }
          if (next !== undefined) { const qx = nx + ey[next], qy = ny - ex[next], ql = Math.hypot(qx, qy); bx = qx / ql; by = qy / ql; }
          const x0 = ring[2 * k], y0 = ring[2 * k + 1], x1 = ring[2 * j], y1 = ring[2 * j + 1];
          const s0 = facade ? (u - margin) * scale : u, s1 = facade ? (u + L[k] - margin) * scale : u + L[k];
          const fl = (fronts && o === 0 && fronts.get(k)) || 0;
          const flags = fl + (ri === signAt ? 4 : 0) + 32 * nFloors;
          let prevIds = null;
          const ra = rays(G, x0 + nx * 0.5, y0 + ny * 0.5, nx, ny, 0), rb = rays(G, x1 + nx * 0.5, y1 + ny * 0.5, nx, ny, 1);
          for (let li = 0; li < levels.length; li++) {
            const z = levels[li];
            const oa = openness(ra, z + 0.5), ob = openness(rb, z + 0.5);
            const ia = buf.v(x0, y0, z, ax, ay, 0, P.wall, s0, z - g0, kind * 16 + si, P.storey, P.ground, P.u, oa, flags, nb, bi, P.code);
            const ib = buf.v(x1, y1, z, bx, by, 0, P.wall, s1, z - g0, kind * 16 + si, P.storey, P.ground, P.u, ob, flags, nb, bi, P.code);
            if (prevIds) buf.idx.push(prevIds[0], prevIds[1], ib, prevIds[0], ib, ia);
            prevIds = [ia, ib];
          }
          u += L[k];
        }
      }
    }

    // a plain plinth under the walls, down to the lowest ground drawn along the footprint, where that
    // is below the base: the base is the lowest survey point under the corners, and the ground
    // drawn between them (a moat's edge, a slope, a quay) can be lower
    function plinth(rings, bi, si, zb) {
      let zf = Infinity;
      for (const r of rings) for (let k = 0, n = r.length / 2; k < n; k++) {
        const j = (k + 1) % n, ax = r[2 * k], ay = r[2 * k + 1], bx = r[2 * j], by = r[2 * j + 1], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2.5));
        for (let i = 0; i < m; i++) zf = Math.min(zf, foot(ax + (bx - ax) * i / m, ay + (by - ay) * i / m));
      }
      if (!(zf < zb - 0.05)) return;
      zf -= 0.2;
      const P = BI[bi];
      for (const r of rings) for (let k = 0, n = r.length / 2; k < n; k++) {
        const j = (k + 1) % n, x0 = r[2 * k], y0 = r[2 * k + 1], x1 = r[2 * j], y1 = r[2 * j + 1], l = Math.hypot(x1 - x0, y1 - y0);
        if (l < 0.05) continue;
        const nx = (y1 - y0) / l, ny = -(x1 - x0) / l; // outward for an anticlockwise outer ring (holes are clockwise: also outward)
        const a = buf.v(x0, y0, zf, nx, ny, 0, P.wall, 0, 0, K_WALL * 16 + si, P.storey, P.ground, P.u, 0.7, 0, 0, bi, P.code);
        const b = buf.v(x1, y1, zf, nx, ny, 0, P.wall, l, 0, K_WALL * 16 + si, P.storey, P.ground, P.u, 0.7, 0, 0, bi, P.code);
        const c = buf.v(x1, y1, zb, nx, ny, 0, P.wall, l, 0, K_WALL * 16 + si, P.storey, P.ground, P.u, 0.7, 0, 0, bi, P.code);
        const d = buf.v(x0, y0, zb, nx, ny, 0, P.wall, 0, 0, K_WALL * 16 + si, P.storey, P.ground, P.u, 0.7, 0, 0, bi, P.code);
        buf.idx.push(a, b, c, a, c, d);
      }
    }

    // a flat polygon (contour + holes, flat x, y metres) at height z, facing up
    function post(x, y, z0, z1, bi) { // an upright square post, POST on a side
      const P = BI[bi], h = POST / 2, c = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = c[k], [bx, by] = c[(k + 1) % 4], nx = (by - ay) / POST, ny = -(bx - ax) / POST, base = buf.n;
        for (const [px, py, pz] of [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]]) buf.v(px, py, pz, nx, ny, 0, P.wall, px + py, pz - z0, K_TRIM * 16 + P.si, P.storey, P.ground, P.u, 1, 0, P.mat, bi, P.code);
        buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    function cap(rings, z, bi, colour, kind, flags, down = false) { // (down: a soffit, facing the street below)
      const P = BI[bi], contour = [], holes = [];
      rings.forEach((r, i) => {
        const pts = [];
        for (let k = 0; k < r.length; k += 2) pts.push(new V2(r[k], r[k + 1]));
        if (i === 0) contour.push(...pts); else holes.push(pts);
      });
      let faces;
      try { faces = triangulate(contour, holes); } catch (e) { faces = []; }
      const all = contour.concat(...holes), base = buf.n;
      for (const p of all) buf.v(p.x, p.y, z, 0, 0, down ? -1 : 1, colour, p.x, p.y, kind * 16 + P.si, P.storey, P.ground, P.u, 1, flags, P.mat, bi, P.code);
      for (const f of faces) {
        const a = all[f[0]], b = all[f[1]], c = all[f[2]];
        const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
        if (ccw !== down) buf.idx.push(base + f[0], base + f[1], base + f[2]); else buf.idx.push(base + f[0], base + f[2], base + f[1]);
      }
    }

    // the parapet's inner face: a vertical band along the inset ring, facing inwards
    function band(inner, zLo, zHi, bi, colour, kind) {
      const P = BI[bi], n = inner.length / 2;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, x0 = inner[2 * k], y0 = inner[2 * k + 1], x1 = inner[2 * j], y1 = inner[2 * j + 1];
        const l = Math.hypot(x1 - x0, y1 - y0);
        if (l < 0.05) continue;
        const nx = -(y1 - y0) / l, ny = (x1 - x0) / l; // inward-facing (left)
        const a = buf.v(x0, y0, zLo, nx, ny, 0, colour, 0, zLo, kind * 16 + P.si, P.storey, P.ground, P.u, 0.75, 0, 0, bi, P.code);
        const b = buf.v(x1, y1, zLo, nx, ny, 0, colour, l, zLo, kind * 16 + P.si, P.storey, P.ground, P.u, 0.75, 0, 0, bi, P.code);
        const c = buf.v(x1, y1, zHi, nx, ny, 0, colour, l, zHi, kind * 16 + P.si, P.storey, P.ground, P.u, 0.9, 0, 0, bi, P.code);
        const d = buf.v(x0, y0, zHi, nx, ny, 0, colour, 0, zHi, kind * 16 + P.si, P.storey, P.ground, P.u, 0.9, 0, 0, bi, P.code);
        buf.idx.push(a, c, b, a, d, c);
      }
    }

    // a roof mesh from the pipeline: flat-shaded faces (smooth for domes and barrels)
    function roof(r, g0, bi) {
      const P = BI[bi], pos = r[4], tri = r[5], nRoof = r[6], smooth = CURVED.has(r[3]);
      const V = i => [pos[3 * i] / 10, pos[3 * i + 1] / 10, g0 + pos[3 * i + 2] / 10];
      const flags = photoOK ? 16 : 0;
      const nrmOf = (a, b, c) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
      };
      let vn = null;
      if (smooth) {
        vn = new Float32Array(pos.length);
        for (let t = 0; t < nRoof; t++) {
          const ia = tri[3 * t], ib = tri[3 * t + 1], ic = tri[3 * t + 2], n = nrmOf(V(ia), V(ib), V(ic));
          for (const i of [ia, ib, ic]) { vn[3 * i] += n[0]; vn[3 * i + 1] += n[1]; vn[3 * i + 2] += n[2]; }
        }
      }
      for (let t = 0; t < tri.length / 3; t++) {
        const ids = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]], p = ids.map(V), n = nrmOf(p[0], p[1], p[2]);
        const isRoof = t < nRoof;
        // roof texture coordinates: across the slope and down it, in metres along the surface
        let dx = n[0], dy = n[1];
        const hl = Math.hypot(dx, dy);
        if (hl > 1e-3) { dx /= hl; dy /= hl; } else { dx = 0; dy = 1; }
        const cosS = Math.max(0.2, Math.abs(n[2]));
        const base = buf.n;
        for (let q = 0; q < 3; q++) {
          const [x, y, z] = p[q];
          let nx = n[0], ny = n[1], nz = n[2];
          if (smooth && isRoof) { const i = ids[q], l = Math.hypot(vn[3 * i], vn[3 * i + 1], vn[3 * i + 2]) || 1; nx = vn[3 * i] / l; ny = vn[3 * i + 1] / l; nz = vn[3 * i + 2] / l; }
          if (isRoof) buf.v(x, y, z, nx, ny, nz, P.roof, x * -dy + y * dx, (x * dx + y * dy) / cosS, K_ROOF * 16 + P.si, P.storey, P.ground, P.u, 1, flags, P.mat, bi, P.code);
          else buf.v(x, y, z, nx, ny, nz, P.wall, x * -ny + y * nx, z - g0, K_WALL * 16 + P.si, P.storey, P.ground, P.u, 0.9, 0, 0, bi, P.code);
        }
        buf.idx.push(base, base + 1, base + 2);
      }
    }

    // an awning over a shopfront: a slab 2.6 m deep under the first floor
    function awning(ring, k, g0, bi) {
      const P = BI[bi], n = ring.length / 2, j = (k + 1) % n;
      if (!(k < n)) return; // (a front past its ring's end, from data packed before its ring changed: NaN corners hung the build)
      const ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * j], by = ring[2 * j + 1];
      const l = Math.hypot(bx - ax, by - ay);
      if (!(l >= 3)) return;
      const ux = (bx - ax) / l, uy = (by - ay) / l, nx = uy, ny = -ux;
      const depth = 2.4 + 0.5 * P.u, z0 = g0 + Math.min(P.ground, 4.6) - 0.55, z1 = z0 + 0.28;
      const e0 = 0.25, e1 = l - 0.25;
      const pt = (s, d) => [ax + ux * s + nx * d, ay + uy * s + ny * d];
      const c = [pt(e0, 0.05), pt(e1, 0.05), pt(e1, depth), pt(e0, depth)];
      // a quad facing nn, whatever order its corners come in
      const quad = (q, z, nn, colour, kind) => {
        const base = buf.n, p = q.map(([x, y, zz]) => [x, y, zz ?? z]);
        for (const [x, y, zz] of p) buf.v(x, y, zz, nn[0], nn[1], nn[2], colour, x * ux + y * uy, zz - g0, kind * 16 + P.si, P.storey, P.ground, P.u, 0.9, 0, 0, bi, P.code);
        const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], b = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
        if (cx * nn[0] + cy * nn[1] + cz * nn[2] >= 0) buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      };
      quad([[...c[0], z1], [...c[1], z1], [...c[2], z1], [...c[3], z1]], z1, [0, 0, 1], awnC, K_TRIM);
      quad([[...c[3], z0], [...c[2], z0], [...c[1], z0], [...c[0], z0]], z0, [0, 0, -1], soffitC, K_SOFFIT);
      quad([[...c[3], z0], [...c[3], z1], [...c[2], z1], [...c[2], z0]], 0, [nx, ny, 0], awnC, K_TRIM);
      quad([[...c[0], z0], [...c[0], z1], [...c[3], z1], [...c[3], z0]], 0, [-ux, -uy, 0], awnC, K_TRIM);
      quad([[...c[2], z0], [...c[2], z1], [...c[1], z1], [...c[1], z0]], 0, [ux, uy, 0], awnC, K_TRIM);
    }

    const deckZ = new Map(); // solid -> deck height, for rooftop plant
    const hidden = new Set(hiddenSolids || []); // drawn by a parametric landmark instead
    const passages = new Set(B.passages || []);
    // a mixed-use building's vertical sign hangs on one corner: of its tallest solid from the ground
    const signSolid = new Map(), signTop = new Map();
    B.s.forEach((s, si) => {
      const bi = s[0];
      if (hidden.has(si) || s[2] !== 0 || BI[bi].style !== 'mixed') return;
      if (!(s[3] <= signTop.get(bi))) { signTop.set(bi, s[3]); signSolid.set(bi, si); }
    });
    const solid = (s, si) => {
      if (hidden.has(si)) return;
      const bi = s[0], P = BI[bi], g0 = s[1] / 10, zb = g0 + s[2] / 10, zt = g0 + s[3] / 10;
      const rings = s.slice(4).map(r => r.map(q => q / 10));
      const r = roofOf.get(si), fronts = frontOf.get(si);
      const eave = r ? g0 + r[2] / 10 : zt;
      rings.forEach((ring, o) => walls(ring, bi, P.si, zb, Math.max(eave, zb + 0.1), g0, P.windows, fronts, o, o === 0 && signSolid.get(bi) === si));
      if (foot && s[2] === 0) plinth(rings, bi, P.si, zb);
      if (passages.has(si)) cap(rings, zb, bi, soffitC, K_SOFFIT, 0, true); // a building over a road through it (pipeline/road_passages.py): the passage's ceiling
      else if (s[2] > 0 && meta[bi][1] === 'roof') { // a canopy over the street (pipeline/arcades.py): its underside, and the posts it stands on
        cap(rings, zb, bi, soffitC, K_SOFFIT, 0, true);
        for (const [x, y] of canopyPosts(s, meta[bi], B.no_posts && B.no_posts[bi], B.inner_posts && B.inner_posts[bi])) post(x, y, foot ? Math.min(g0, foot(x, y)) - 0.2 : g0, zb, bi);
      }
      if (r) { roof(r, g0, bi); return; }
      // flat roof: a parapet round a deck that shows the aerial photo, where the building is big enough
      const par = PARAPET[P.style] && s[3] - s[2] >= 50 ? PARAPET[P.style] : 0;
      let inner = null;
      if (par && !small) {
        inner = rings.map(rr => inset(rr, 0.3));
        if (inner.some(x => !x)) inner = null;
      }
      const flags = photoOK && meta[bi][2] < 45 ? 16 : 0;
      if (inner) {
        const zd = zt - par;
        cap(inner, zd, bi, P.roof, K_DECK, flags);
        rings.forEach((ring, o) => {
          band(inner[o], zd, zt, bi, P.wall, K_WALL);
          // the coping: a ring between the outer and inner outlines
          const n = ring.length / 2;
          for (let k = 0; k < n; k++) {
            const j = (k + 1) % n, base = buf.n;
            for (const [x, y] of [[ring[2 * k], ring[2 * k + 1]], [ring[2 * j], ring[2 * j + 1]], [inner[o][2 * j], inner[o][2 * j + 1]], [inner[o][2 * k], inner[o][2 * k + 1]]])
              buf.v(x, y, zt, 0, 0, 1, trimC, x, y, K_TRIM * 16 + P.si, P.storey, P.ground, P.u, 1, 0, 0, bi, P.code);
            buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        });
        deckZ.set(si, zd);
      } else {
        cap(rings, zt, bi, P.roof, K_DECK, flags);
        deckZ.set(si, zt);
      }
      if (fronts && !small) for (const [k, fl] of fronts) if (fl & 2) awning(rings[0], k, g0, bi);
    };
    for (let si = 0, s0 = performance.now(); si < B.s.length; si++) {
      solid(B.s[si], si);
      if (slice && performance.now() - s0 > slice) { if (progress) progress(si / B.s.length); await pause(); s0 = performance.now(); }
    }
    // awnings on roofed solids too
    if (!small) for (const [si, fronts] of frontOf) if (roofOf.has(si) && !hidden.has(si)) {
      const s = B.s[si];
      for (const [k, fl] of fronts) if (fl & 2) awning(s[4].map(q => q / 10), k, s[1] / 10, s[0]);
    }
    if (progress) progress(1);
    const out = buf.arrays();
    out.deckSi = Int32Array.from(deckZ.keys());
    out.deckZ = Float32Array.from(deckZ.values());
    out.ms = performance.now() - t0;
    return out;
  }

  // every colour build() asks lin() for: the rows' wall and roof colours and the trims'
  function colourNames(B) {
    const set = new Set(['#bdb6aa', '#8d8f8f', '#d6d2c8', '#e9e4d8', '#3b3f43']);
    for (const m of B.b) { if (m[7]) set.add(m[7]); if (m[8]) set.add(m[8]); }
    return [...set];
  }

  const api = { build, colourNames, canopyPosts, POST, STYLES, SI, GRID, LOOK, REGION_GRID, STOREY, STOREY_MAX, PARAPET, ROOF_MAT, CURVED,
    K_FACADE, K_WALL, K_ROOF, K_DECK, K_TRIM, K_SOFFIT, hash1, guessStyle, inset };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OEBuildingsGeo = api;
})(typeof self !== 'undefined' ? self : globalThis);
