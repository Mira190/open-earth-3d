// Open Earth 3D buildings: the walls, LOD2 roofs, facades and rooftops of a city from
// buildings.json, as one mesh that the model viewer and the game share (raycasts read its
// bid attribute), plus instanced rooftop plant.
//
// The pipeline writes, per building, a facade style, storey and ground-floor heights and a
// seed; per solid a roof mesh (pitched roofs) and the street frontages that get shopfronts
// and awnings (typology.py, roofs.py). Here every wall run between sharp corners gets a
// whole number of window bays, floors follow the storey height, and the fragment shader
// draws the facade: windows with frames and sills, curtain-wall mullions and spandrels,
// shopfronts, glass that reflects the sky and shows a room behind it (interior mapping),
// and lights at night on an occupancy schedule for the building type and the local hour.
// Walls are darkened by a sky-openness term baked from a 4 m surface model (street
// canyons), flat roofs get parapets and the aerial photo, pitched roofs tile or metal.
// buildings.json files written before these fields existed get styles from class and height.
// Works with three.js r128 and later (WebGL1 or 2; dynamic uniform indexing stays in the
// vertex shader).
'use strict';
window.OEBuildings = (function () {
  const STYLES = ['plain', 'house', 'terrace', 'apartment', 'office', 'glass', 'heritage', 'retail', 'industrial', 'civic',
    'machiya', 'mixed', 'stone', 'haussmann', 'grachtenpand'];
  const SI = Object.fromEntries(STYLES.map((s, i) => [s, i]));
  // per style: bay width m, window width (share of a bay), sill and head (shares of a storey)
  const GRID = {
    plain: [0, 0, 0, 0], house: [3.3, 0.42, 0.3, 0.8], terrace: [2.8, 0.44, 0.24, 0.86], apartment: [3.0, 0.5, 0.27, 0.86],
    office: [3.0, 0.68, 0.25, 0.9], glass: [1.5, 1.0, 0.0, 1.0], heritage: [3.6, 0.4, 0.22, 0.84], retail: [4.2, 0.42, 0.34, 0.8],
    industrial: [6.0, 0.72, 0.64, 0.88], civic: [3.6, 0.88, 0.32, 0.8], machiya: [1.8, 0.72, 0.3, 0.76], mixed: [2.8, 0.7, 0.22, 0.86],
    stone: [0, 0, 0, 0], haussmann: [2.9, 0.44, 0.06, 0.82], grachtenpand: [2.3, 0.5, 0.12, 0.86],
  };
  // per style: interior depth (bays), frame darkness, glass reflectance (metalness), wall roughness
  const LOOK = {
    plain: [1, 0, 0, 0.9], house: [1.2, 0.55, 0.15, 0.88], terrace: [1.4, 0.6, 0.15, 0.85], apartment: [1.4, 0.45, 0.2, 0.8],
    office: [1.6, 0.4, 0.25, 0.7], glass: [2.6, 0.3, 0.55, 0.45], heritage: [1.3, 0.6, 0.15, 0.9], retail: [1.8, 0.4, 0.15, 0.8],
    industrial: [3, 0.5, 0.1, 0.75], civic: [1.8, 0.4, 0.25, 0.75], machiya: [1, 0.7, 0.02, 0.9], mixed: [1.5, 0.45, 0.2, 0.75],
    stone: [1, 0, 0, 0.95], haussmann: [1.3, 0.35, 0.12, 0.88], grachtenpand: [1.2, 0.3, 0.18, 0.9],
  };
  // regional grids: Japan builds on the 910 mm module (sliding units of 1,690 mm on 1,820 mm bays),
  // machiya fronts are three bays of 1.97 m
  const REGION_GRID = {
    japan: { house: [1.82, 0.62, 0.3, 0.8], terrace: [1.82, 0.7, 0.28, 0.82], apartment: [3.6, 0.76, 0.02, 0.86],
      office: [3.2, 0.7, 0.22, 0.88], mixed: [2.8, 0.74, 0.2, 0.86], machiya: [1.97, 0.86, 0.3, 0.82] },
  };
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
      geometry() {
        const g = new THREE.BufferGeometry(), sl = (a, k) => a.slice(0, n * k);
        g.setAttribute('position', new THREE.BufferAttribute(sl(P, 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(sl(N, 3), 3, true));
        g.setAttribute('color', new THREE.BufferAttribute(sl(C, 3), 3, true));
        g.setAttribute('fac', new THREE.BufferAttribute(sl(F, 2), 2));
        g.setAttribute('inf', new THREE.BufferAttribute(sl(I, 4), 4));
        g.setAttribute('ext', new THREE.BufferAttribute(sl(E, 3), 3));
        g.setAttribute('bid', new THREE.BufferAttribute(sl(B, 1), 1));
        g.setAttribute('srcCode', new THREE.BufferAttribute(sl(S, 1), 1));
        g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        return g;
      },
    };
  }

  // sky openness of a wall point facing (nx, ny), from a coarse surface model: 1 - mean sine of the horizon
  const DIRS = [-1.05, -0.5, 0, 0.5, 1.05], STEPS = [5, 9, 14, 21, 30, 42, 58, 80, 110];
  function openness(G, x, y, z, nx, ny) {
    if (!G) return 1;
    const { nx: gx, ny: gy, cell, x0, y1, data } = G;
    let acc = 0;
    for (const a of DIRS) {
      const c = Math.cos(a), s = Math.sin(a), dx = nx * c - ny * s, dy = nx * s + ny * c;
      let best = 0;
      for (const d of STEPS) {
        const col = Math.floor((x + dx * d - x0) / cell), row = Math.floor((y1 - (y + dy * d)) / cell);
        if (col < 0 || row < 0 || col >= gx || row >= gy) break;
        const t = (data[row * gx + col] - z) / d;
        if (t > best) best = t;
      }
      acc += best / Math.sqrt(1 + best * best);
    }
    return Math.max(0.15, 1 - acc / DIRS.length);
  }

  // foot(x, y): the height of the ground drawn there, so walls reach it where it is below a building's base
  function create(D, { lin, U, renderer, SRC, small = false, foot = null }) {
    const t0 = performance.now();
    const { B, T, scene } = D;
    const region = scene.city.architecture || (scene.city.country === 'Japan' ? 'japan' : '');
    const GRIDS = Object.assign({}, GRID, REGION_GRID[region] || {});
    const meta = B.b, hasStyle = (B.fields || []).includes('style');
    const S = window.Sun;
    const roofOf = new Map((B.r || []).map(r => [r[0], S.unpackRoof(r)]));
    const frontOf = new Map((B.f || []).map(f => {
      const m = new Map();
      for (let k = 1; k < f.length; k += 2) m.set(f[k], f[k + 1]);
      return [f[0], m];
    }));

    // per building: style, storey, ground floor, seed, colours
    const styleList = B.styles || STYLES, matList = B.roof_materials || ROOF_MAT;
    const BI = meta.map((m, i) => {
      const style = hasStyle ? (typeof m[10] === 'number' ? styleList[m[10]] : m[10]) : guessStyle(m);
      let storey = hasStyle ? m[11] : 0, ground = hasStyle ? m[12] : 0;
      if (!storey) {
        const res = /^(house|terrace|apartment)$/.test(style);
        storey = res ? 3.0 : style === 'heritage' ? 4.4 : 3.8;
        ground = storey + (res ? 0 : 0.8);
      }
      const seed = hasStyle ? m[14] : Math.floor(hash1(i + 1) * 65535);
      return { style, si: SI[style] ?? 0, storey, ground, seed, u: (seed % 997) / 997,
        wall: lin(m[7] || '#bdb6aa'), roof: lin(m[8] || '#8d8f8f'),
        mat: hasStyle ? Math.max(0, ROOF_MAT.indexOf(typeof m[13] === 'number' ? matList[m[13]] : m[13])) : 0,
        code: SRC[m[4]] ?? 2, windows: style !== 'plain' && style !== 'stone' && m[4] !== 'parametric' };
    });

    // a 4 m surface model of building tops for the openness bake
    let G = null;
    try {
      const fr = scene.frame;
      G = S.buildDSM(T, B.s, { cell: 4, x0: fr.x[0], x1: fr.x[1], y0: fr.y[0], y1: fr.y[1] });
    } catch (e) { G = null; }

    const buf = Buf();
    const trimC = lin('#d6d2c8'), soffitC = lin('#e9e4d8'), awnC = lin('#3b3f43');

    // ------------------------------------------------------------ walls
    const LEVELS = [0, 8, 24, 48, 96, 192, 384];
    function walls(ring, bi, si, zb, zt, g0, kindOk, fronts, o) {
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
      for (const run of runs) {
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
          const flags = fl + 32 * nFloors;
          let prevIds = null;
          for (let li = 0; li < levels.length; li++) {
            const z = levels[li];
            const oa = openness(G, x0 + nx * 0.5, y0 + ny * 0.5, z + 0.5, nx, ny), ob = openness(G, x1 + nx * 0.5, y1 + ny * 0.5, z + 0.5, nx, ny);
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
    function cap(rings, z, bi, colour, kind, flags) {
      const P = BI[bi], contour = [], holes = [];
      rings.forEach((r, i) => {
        const pts = [];
        for (let k = 0; k < r.length; k += 2) pts.push(new THREE.Vector2(r[k], r[k + 1]));
        if (i === 0) contour.push(...pts); else holes.push(pts);
      });
      let faces;
      try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
      const all = contour.concat(...holes), base = buf.n;
      for (const p of all) buf.v(p.x, p.y, z, 0, 0, 1, colour, p.x, p.y, kind * 16 + P.si, P.storey, P.ground, P.u, 1, flags, P.mat, bi, P.code);
      for (const f of faces) {
        const a = all[f[0]], b = all[f[1]], c = all[f[2]];
        const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
        if (ccw) buf.idx.push(base + f[0], base + f[1], base + f[2]); else buf.idx.push(base + f[0], base + f[2], base + f[1]);
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
    const photoOK = !!(scene.ground && scene.ground.length);
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
      const ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * j], by = ring[2 * j + 1];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 3) return;
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
    const hidden = new Set(scene.hidden_solids || []); // drawn by a parametric landmark instead
    B.s.forEach((s, si) => {
      if (hidden.has(si)) return;
      const bi = s[0], P = BI[bi], g0 = s[1] / 10, zb = g0 + s[2] / 10, zt = g0 + s[3] / 10;
      const rings = s.slice(4).map(r => r.map(q => q / 10));
      const r = roofOf.get(si), fronts = frontOf.get(si);
      const eave = r ? g0 + r[2] / 10 : zt;
      rings.forEach((ring, o) => walls(ring, bi, P.si, zb, Math.max(eave, zb + 0.1), g0, P.windows, fronts, o));
      if (foot && s[2] === 0) plinth(rings, bi, P.si, zb);
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
    });
    // awnings on roofed solids too
    if (!small) for (const [si, fronts] of frontOf) if (roofOf.has(si) && !hidden.has(si)) {
      const s = B.s[si];
      for (const [k, fl] of fronts) if (fl & 2) awning(s[4].map(q => q / 10), k, s[1] / 10, s[0]);
    }

    const geometry = buf.geometry();
    const material = facadeMaterial(U, renderer, GRIDS, scene.city.signage ?? (region === 'japan' ? 1 : 0));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;

    // ------------------------------------------------------------ rooftop plant (instanced)
    const props = new THREE.Group();
    const PR = B.p || [];
    if (PR.length && !small) {
      const kinds = [
        { colour: '#a3a7a8', rough: 0.55, metal: 0.35 }, // plant boxes: galvanised steel
        { colour: '#b9b6ae', rough: 0.8, metal: 0.0 },   // plant room / lift overrun
        { colour: '#cfd6d8', rough: 0.6, metal: 0.1 },   // water tank (FRP panels)
      ];
      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      kinds.forEach((kd, kind) => {
        const rows = PR.filter(p => p[1] === kind && deckZ.has(p[0]));
        if (!rows.length) return;
        const im = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kd.rough, metalness: kd.metal }), rows.length);
        rows.forEach((p, i) => {
          const z = deckZ.get(p[0]), lift = kind === 2 ? 1.0 : 0;
          dummy.position.set(p[2] / 10, z + lift, -p[3] / 10);
          dummy.rotation.set(0, p[7] / 100 * Math.PI / 180, 0);
          dummy.scale.set(p[4] / 10, p[6] / 10, p[5] / 10);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const v = 0.85 + 0.3 * hash1(p[2] * 31 + p[3]);
          im.setColorAt(i, col.copy(lin(kind === 1 ? meta[B.s[p[0]][0]][7] : kd.colour)).multiplyScalar(kind === 1 ? 0.92 * v : v));
        });
        im.castShadow = im.receiveShadow = true;
        props.add(im);
        if (kind === 2) { // the stand under each tank
          const legs = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: lin('#5d6264'), roughness: 0.7, metalness: 0.4 }), rows.length);
          rows.forEach((p, i) => {
            dummy.position.set(p[2] / 10, deckZ.get(p[0]), -p[3] / 10);
            dummy.rotation.set(0, p[7] / 100 * Math.PI / 180, 0);
            dummy.scale.set(p[4] / 10 * 0.9, 1.0, p[5] / 10 * 0.9);
            dummy.updateMatrix();
            legs.setMatrixAt(i, dummy.matrix);
          });
          props.add(legs);
        }
      });
    }

    // ------------------------------------------------------------ Paris mansards: dormers and chimney stacks
    // rows with an absolute base (p[8]); dormers face the street (+z after the row's rotation)
    const PA = PR.filter(p => p.length > 8 && (p[1] === 3 || p[1] === 4) && !hidden.has(p[0]));
    if (PA.length && !small) {
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      const place = (im, p, i, sx, sy, sz, dx = 0, dy = 0, dz = 0) => {
        const a = p[7] / 100 * Math.PI / 180, c = Math.cos(a), s_ = Math.sin(a);
        // offset (dx along the edge, dz outward) in the row's frame
        dummy.position.set(p[2] / 10 + dx * c + dz * s_, p[8] / 10 + dy, -(p[3] / 10 + dx * s_ - dz * c));
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      };
      // a dormer row: the first dormer, then count, step (dm) along the row's angle and a bitmask of empty bays
      const dorm = [];
      for (const p of PA) if (p[1] === 3) {
        const a = p[7] / 100 * Math.PI / 180, n = p[9] || 1, st = p[10] || 0;
        for (let j = 0; j < n; j++) if (!((p[11] || 0) & (1 << j)))
          dorm.push([p[0], 3, p[2] + Math.cos(a) * st * j, p[3] + Math.sin(a) * st * j, p[4], p[5], p[6], p[7], p[8]]);
      }
      const stacks = PA.filter(p => p[1] === 4);
      if (dorm.length) {
        // a zinc dormer: cheeks, a gabled cap, a painted frame and the glass
        const g = new THREE.BufferGeometry(), P = [], N = [], C = [];
        const zinc = [0.24, 0.27, 0.29], paint = [0.78, 0.76, 0.72], glass = [0.012, 0.015, 0.02];
        const quad = (a, b, c2, d, n, k) => { for (const v of [a, b, c2, a, c2, d]) { P.push(...v); N.push(...n); C.push(...k); } };
        quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 0.7, 0.5], [-0.5, 0.7, -0.5], [-1, 0, 0], zinc);
        quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 0.7, -0.5], [0.5, 0.7, 0.5], [1, 0, 0], zinc);
        quad([-0.55, 0.68, -0.5], [-0.55, 0.68, 0.55], [0, 1, 0.55], [0, 1, -0.5], [-0.53, 0.85, 0], zinc);
        quad([0, 1, -0.5], [0, 1, 0.55], [0.55, 0.68, 0.55], [0.55, 0.68, -0.5], [0.53, 0.85, 0], zinc);
        for (const [y0, y1, x0, x1, k, z] of [[0, 0.7, -0.5, 0.5, paint, 0.5], [0.1, 0.62, -0.33, 0.33, glass, 0.505]])
          quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], k);
        for (const v of [[-0.55, 0.68, 0.55], [0.55, 0.68, 0.55], [0, 1, 0.55]]) { P.push(...v); N.push(0, 0, 1); C.push(...paint); }
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), dorm.length);
        dorm.forEach((p, i) => place(im, p, i, p[4] / 10, p[6] / 10, p[5] / 10));
        im.castShadow = im.receiveShadow = true;
        props.add(im);
      }
      if (stacks.length) {
        // a rendered masonry stack under a stone cap, a row of terracotta pots on top
        const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        const body = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), stacks.length * 2);
        const pots = [];
        stacks.forEach((p, i) => {
          const w = p[4] / 10, d = p[5] / 10, h = p[6] / 10;
          place(body, p, 2 * i, w, h, d);
          place(body, p, 2 * i + 1, w + 0.14, 0.12, d + 0.14, 0, h);
          const v = hash1(p[2] * 17 + p[3]);
          body.setColorAt(2 * i, col.copy(lin(v < 0.62 ? '#d9cbb3' : v < 0.85 ? '#c9b391' : '#a9715a')));
          body.setColorAt(2 * i + 1, col.copy(lin('#cfc5b4')));
          const n = Math.max(1, Math.floor(w / 0.42));
          for (let j = 0; j < n; j++) pots.push([p, (j + 0.5) * w / n - w / 2, h + 0.12]);
        });
        body.castShadow = body.receiveShadow = true;
        props.add(body);
        const potIm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 1, 8).translate(0, 0.5, 0),
          new THREE.MeshStandardMaterial({ color: lin('#b0644a'), roughness: 0.85 }), pots.length);
        pots.forEach(([p, dx, dy], i) => place(potIm, p, i, 1, 0.45 + 0.25 * hash1(dx * 13 + p[2]), 1, dx, dy));
        potIm.castShadow = true;
        props.add(potIm);
      }
    }

    // ------------------------------------------------------------ Amsterdam: canal-house gables
    // rows [k, 5, x, y, width, thickness, height (dm), angle, base (dm, absolute), type]: a slab in
    // the plane of the street front, its face at local z = 0 and its depth behind, cut to the
    // outline of its type (spout, step, neck, bell, cornice); x across the front (-0.5..0.5) and
    // y up from the eaves (0..1) in the row's units. The body takes the house's wall colour; white
    // sandstone trims, the attic's hoisting door and its beam are a second mesh in fixed colours.
    const GA = PR.filter(p => p[1] === 5 && p.length > 9 && !hidden.has(p[0]));
    if (GA.length && !small) {
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      const stoneC = [0.85, 0.83, 0.77], darkC = [0.09, 0.08, 0.07], doorC = [0.13, 0.17, 0.14];
      const mirror = half => half.concat(half.slice().reverse().map(([x, y]) => [-x, y]));
      const steps = [[-0.5, 0]], bell = [[-0.5, 0]];
      for (let k = 0; k < 4; k++) steps.push([-0.5 + k * 0.1025, 0.2 + 0.18 * k], [-0.5 + (k + 1) * 0.1025, 0.2 + 0.18 * k]);
      steps.push([-0.09, 1.0]);
      for (let i = 0; i <= 12; i++) { const t = i / 12; bell.push([-(0.5 - 0.33 * (3 * t * t - 2 * t * t * t)), 0.25 + 0.6 * t]); }
      for (let i = 1; i < 6; i++) { const a = Math.PI - i / 6 * Math.PI / 2; bell.push([0.17 * Math.cos(a), 0.85 + 0.15 * Math.sin(a)]); }
      const BODY = [
        [[-0.5, 0], [0.5, 0], [0.5, 0.08], [0.12, 0.92], [0.12, 1], [-0.12, 1], [-0.12, 0.92], [-0.5, 0.08]],
        mirror(steps).reverse(),
        [[-0.5, 0], [0.5, 0], [0.5, 0.3], [0.2, 0.3], [0.2, 0.86], [0.24, 0.86], [0, 1], [-0.24, 0.86], [-0.2, 0.86], [-0.2, 0.3], [-0.5, 0.3]],
        [[0.5, 0]].concat(mirror(bell.slice(1)).reverse(), [[-0.5, 0]]),
        [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]],
      ];
      const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const claw = s => { const p = [[0.2 * s, 0.3]]; for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; p.push([s * (0.2 + 0.24 * Math.cos(a)), 0.3 + 0.32 * Math.sin(a)]); } return s > 0 ? p : p.reverse(); };
      // a window in the gable: a white frame round dark glass; a loading door: green shutters
      const glassC = [0.07, 0.085, 0.1];
      const win = (x, y0, y1, w) => [[rect(x - w / 2 - 0.015, y0 - 0.012, x + w / 2 + 0.015, y1 + 0.012), stoneC, 0, 0.04], [rect(x - w / 2, y0, x + w / 2, y1), glassC, 0, 0.05]];
      const door = (y0, y1) => [[rect(-0.08, y0, 0.08, y1), doorC, 0, 0.06]];
      const beam = y => [[rect(-0.025, y, 0.025, y + 0.05), darkC, 0, 2.0]];
      const row = (xs, y0, y1, w) => xs.flatMap(x => win(x, y0, y1, w));
      // [outline, colour, z0, z1] in the slab's units (its depth is 1)
      const TRIM = [
        [[rect(-0.15, 0.98, 0.15, 1.03), stoneC, -0.9, 0.1], ...door(0.1, 0.3), ...door(0.38, 0.56), ...door(0.62, 0.78), ...beam(0.84)],
        [...[0, 1, 2, 3].flatMap(k => [-1, 1].map(sg => { const x0 = -0.5 + k * 0.1025, x1 = x0 + 0.1025, y = 0.2 + 0.18 * k;
          return [rect(sg < 0 ? x0 - 0.01 : -x1, y - 0.02, sg < 0 ? x1 : -x0 + 0.01, y + 0.015), stoneC, -0.9, 0.1]; })),
          [rect(-0.1, 0.98, 0.1, 1.02), stoneC, -0.9, 0.1], ...row([-0.29, 0, 0.29], 0.04, 0.16, 0.13), ...row([-0.14, 0.14], 0.24, 0.35, 0.11),
          ...win(0, 0.42, 0.53, 0.11), ...door(0.6, 0.72), ...beam(0.77)],
        [[claw(1), stoneC, -0.6, 0.08], [claw(-1), stoneC, -0.6, 0.08], [[[-0.26, 0.85], [0.26, 0.85], [0, 1.0]], stoneC, 0.02, 0.12],
          [rect(-0.22, 0.83, 0.22, 0.86), stoneC, 0, 0.12], ...row([-0.3, 0, 0.3], 0.05, 0.23, 0.13), ...win(0, 0.36, 0.52, 0.15),
          ...door(0.6, 0.76), ...beam(0.79)],
        [[BODY[3].map(([x, y]) => [x * 1.06, y * 1.03]), stoneC, -0.95, -0.15], [rect(-0.19, 0.83, 0.19, 0.87), stoneC, 0, 0.1],
          ...row([-0.28, 0, 0.28], 0.05, 0.21, 0.12), ...row([-0.12, 0.12], 0.34, 0.5, 0.11), ...door(0.58, 0.74), ...beam(0.78)],
        [[rect(-0.51, 0.7, 0.51, 0.92), stoneC, 0, 0.8], [rect(-0.5, 0.92, 0.5, 1.0), stoneC, 0, 0.1]],
      ];
      const extrude = (pts, z0, z1) => {
        const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
        g.translate(0, 0, z0);
        return g.index ? g.toNonIndexed() : g;
      };
      const merged = parts => { // [[geometry, rgb]] -> one geometry with vertex colours
        const P = [], N = [], C = [];
        for (const [g, c] of parts) {
          P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array);
          for (let i = 0; i < g.attributes.position.count; i++) C.push(...c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        return g;
      };
      const place = (im, p, i) => {
        const a = p[7] / 100 * Math.PI / 180;
        dummy.position.set(p[2] / 10, p[8] / 10, -p[3] / 10);
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(p[4] / 10, p[6] / 10, p[5] / 10);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      };
      const brick = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const trimM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      BODY.forEach((outline, t) => {
        const rows = GA.filter(p => p[9] === t);
        if (!rows.length) return;
        const body = new THREE.InstancedMesh(extrude(outline, -1, 0), brick, rows.length);
        const trim = new THREE.InstancedMesh(merged(TRIM[t].map(([pts, c, z0, z1]) => [extrude(pts, z0, z1), c])), trimM, rows.length);
        rows.forEach((p, i) => {
          place(body, p, i);
          place(trim, p, i);
          body.setColorAt(i, col.copy(lin(meta[B.s[p[0]][0]][7])).multiplyScalar(0.95 + 0.1 * hash1(p[2] * 7 + p[3])));
        });
        body.castShadow = body.receiveShadow = trim.castShadow = trim.receiveShadow = true;
        props.add(body, trim);
      });
    }

    // ------------------------------------------------------------ the aerial photo for flat roofs
    if (photoOK) loadPhoto(scene, renderer).then(tex => {
      if (!tex) return;
      U.uPhoto.value = tex;
      U.uPhotoOn.value = 1;
    });

    // for tools and tests (tools/city_shot.js prints it)
    window.__buildings = { vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3, props: PR.length,
      roofs: roofOf.size, build_ms: Math.round(performance.now() - t0) };
    return { mesh, geometry, material, props, styles: STYLES, info: BI };
  }

  // the ground tiles drawn into one canvas (at most 4096 px a side) for flat roofs
  function loadPhoto(scene, renderer) {
    const fr = scene.frame, w = fr.x[1] - fr.x[0], h = fr.y[1] - fr.y[0];
    const max = Math.min(4096, renderer.capabilities.maxTextureSize || 4096);
    const k = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const g = cv.getContext('2d');
    const dir = `data/${scene.city.id}/`;
    return Promise.all(scene.ground.map(t => new Promise(res => {
      const im = new Image();
      im.onload = () => { g.drawImage(im, (t.x0 - fr.x[0]) * k, (fr.y[1] - t.y1) * k, (t.x1 - t.x0) * k, (t.y1 - t.y0) * k); res(true); };
      im.onerror = () => res(false);
      im.src = dir + t.file;
    }))).then(ok => {
      if (!ok.some(Boolean)) return null;
      const tex = new THREE.CanvasTexture(cv);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; else tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    });
  }

  // ------------------------------------------------------------ the facade and roof shader
  function facadeMaterial(U, renderer, GRIDS, signage) {
    const grid = STYLES.map(s => new THREE.Vector4(...GRIDS[s])), look = STYLES.map(s => new THREE.Vector4(...LOOK[s]));
    while (grid.length < 16) { grid.push(new THREE.Vector4()); look.push(new THREE.Vector4(1, 0, 0, 0.9)); }
    Object.assign(U, {
      uGrid: { value: grid }, uLook: { value: look }, uHour: U.uHour || { value: 12 }, uSunW: U.uSunW || { value: new THREE.Vector3(0, 1, 0) },
      uPhoto: { value: new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1) }, uPhotoOn: { value: 0 },
      uFrame: { value: new THREE.Vector4(0, 0, 1, 1) }, uSigns: { value: signage },
    });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    mat.extensions = Object.assign(mat.extensions || {}, { derivatives: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
  attribute vec2 fac; attribute vec4 inf; attribute vec3 ext; attribute float bid; attribute float srcCode;
  uniform vec4 uGrid[16]; uniform vec4 uLook[16];
  varying vec2 vFac; varying vec4 vInf; varying vec3 vExt; varying float vBid; varying float vSrc;
  varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vGrid; varying vec4 vLook;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFac = fac; vInf = vec4(inf.x, inf.y * 0.01, inf.z * 0.01, inf.w / 65535.0);
  vExt = vec3(ext.x / 65535.0, ext.y, ext.z); vBid = bid; vSrc = srcCode;
  vColor.rgb *= vColor.rgb; // colours are stored as square roots
  int styleI = int(mod(inf.x, 16.0) + 0.5);
  vGrid = uGrid[styleI]; vLook = uLook[styleI];
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
  uniform float uNight; uniform float uSel; uniform float uMode; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
  uniform float uHour; uniform sampler2D uPhoto; uniform float uPhotoOn; uniform vec4 uFrame; uniform float uSigns;
  varying vec2 vFac; varying vec4 vInf; varying vec3 vExt; varying float vBid; varying float vSrc;
  varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vGrid; varying vec4 vLook;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float h31(vec3 p) { return h21(p.xy + p.z * 17.17); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  // an anti-aliased box: 1 inside [a, b] on coordinate x, with a filter width w
  float band(float x, float a, float b, float w) { return clamp((x - a) / w + 0.5, 0.0, 1.0) * clamp((b - x) / w + 0.5, 0.0, 1.0); }
  // occupancy: the share of rooms lit at this local hour, by style
  float occupancy(float style, float hr) {
    float evening = smoothstep(16.5, 19.0, hr) * (1.0 - smoothstep(22.5, 24.5, hr)) + (1.0 - smoothstep(0.0, 1.5, hr)) * 0.5;
    float work = smoothstep(6.5, 8.5, hr) * (1.0 - smoothstep(18.0, 21.0, hr));
    if (style > 3.5 && style < 5.5 || style > 8.5 && style < 9.5) return 0.06 + 0.82 * work + 0.12 * smoothstep(17.5, 19.0, hr) * (1.0 - smoothstep(20.0, 23.0, hr));
    if (style > 6.5 && style < 7.5) return 0.1 + 0.85 * smoothstep(7.0, 8.0, hr) * (1.0 - smoothstep(21.0, 22.5, hr));
    if (style > 5.5 && style < 6.5) return 0.05 + 0.5 * work + 0.15 * evening;
    return 0.06 + 0.55 * evening + 0.2 * smoothstep(6.0, 7.0, hr) * (1.0 - smoothstep(8.5, 9.5, hr));
  }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  float kind = floor(vInf.x / 16.0 + 0.01), style = floor(vInf.x - kind * 16.0 + 0.5);
  float storey = max(vInf.y, 2.4), ground = max(vInf.z, 2.4), seed = floor(vInf.w * 997.0 + 0.5) / 997.0;
  // hashes take whole numbers: an interpolated varying is not bit-exact, and a hash of it would flicker
  float bidI = floor(vBid + 0.5), bidH = fract(bidI * 0.618034) * 97.0;
  float glass = 0.0, roughB = vLook.w, metalB = 0.0, aoW = vExt.x;
  vec3 emitB = vec3(0.0);
  vec3 N = normalize(vWNrm);
  float dist = length(vWPos - cameraPosition);
  if (kind < 0.5) {
    // ---------------------------------------------------------------- facade
    float h = vFac.y, s = vFac.x, nb = vExt.z;
    float q = h < ground ? h / ground : 1.0 + (h - ground) / storey; // continuous floor coordinate
    float fl = floor(q), fy = fract(q), bay = floor(s), fx = fract(s);
    vec2 fw = max(fwidth(vec2(s, q)), vec2(1e-4));
    // far away the grid averages out instead of shimmering
    float far = smoothstep(0.35, 0.8, max(fw.x, fw.y));
    float inRun = band(s, 0.0, nb, fw.x);
    float shop = (fl < 0.5 && mod(vExt.y, 2.0) > 0.5) ? 1.0 : 0.0;
    float floorsIn = floor(vExt.y / 32.0 + 0.01);
    float ww = vGrid.y, sill = vGrid.z, head = vGrid.w;
    float win = 0.0, frame = 0.0, spandrel = 0.0;
    if (style > 4.5 && style < 5.5) {
      // curtain wall: mullions every module, an opaque spandrel at each slab
      float mull = 1.0 - band(fx, 0.035, 0.965, fw.x);
      spandrel = 1.0 - band(fy, 0.24, 0.985, fw.y);
      win = (1.0 - mull) * (1.0 - spandrel);
      frame = mull * (1.0 - spandrel);
    } else if (shop > 0.5) {
      win = band(fx, 0.05, 0.95, fw.x) * band(fy, 0.06, 0.8, fw.y);
      frame = band(fx, 0.03, 0.97, fw.x) * band(fy, 0.04, 0.82, fw.y) - win;
      float mullion = 1.0 - band(fract(fx * 2.0), 0.03, 0.97, fw.x * 2.0);
      win *= 1.0 - mullion * 0.9;
    } else {
      float wx = 0.5 * ww;
      if (style > 5.5 && style < 6.5 && fl < 0.5) { wx *= 0.9; sill = 0.18; } // rusticated base, taller openings
      if (style > 0.5 && style < 2.5 && fl < 0.5 && mod(bay, 3.0) < 0.5) { wx = 0.2; sill = 0.0; head = 0.78; } // a door
      win = band(fx, 0.5 - wx, 0.5 + wx, fw.x) * band(fy, sill, head, fw.y);
      frame = band(fx, 0.5 - wx - 0.035, 0.5 + wx + 0.035, fw.x) * band(fy, sill - 0.04, head + 0.03, fw.y) - win;
      // heritage: round-headed windows and a string course at each floor
      if (style > 5.5 && style < 6.5) {
        float r = wx, cy = head - r * 0.9 * (storey > 0.0 ? 3.6 / storey : 1.0);
        float arch = step(cy, fy) * (1.0 - smoothstep(r * r * 0.95, r * r * 1.05, pow(fx - 0.5, 2.0) + pow((fy - cy) * storey / 3.6, 2.0)));
        win *= mix(1.0, arch, step(cy, fy));
        float course = band(fy, 0.0, 0.05, fw.y);
        diffuseColor.rgb *= 1.0 + 0.12 * course;
        diffuseColor.rgb *= 1.0 - 0.06 * band(fract(h / 0.45), 0.0, 0.08, fw.y * 3.0) * step(fl, 0.5);
      }
      // apartments: slab edges and balcony balustrades on alternate buildings
      if (style > 2.5 && style < 3.5 && seed > 0.45 && fl > 0.5) {
        float slab = band(fy, 0.0, 0.07, fw.y);
        float rail = band(fy, 0.07, 0.36, fw.y) * band(fx, 0.04, 0.96, fw.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, slab);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.07), rail * 0.55);
        win *= 1.0 - rail * 0.6;
      }
      // offices: panel joints at each floor
      if (style > 3.5 && style < 4.5) diffuseColor.rgb *= 1.0 - 0.1 * band(fy, 0.0, 0.025, fw.y);
      // Haussmann (Paris, 1853-1914): ashlar courses, a rusticated base, and wrought iron: a balcony
      // along the whole front on the second and top floors, a railing across each French window
      // on the others
      if (style > 12.5 && style < 13.5) {
        float fwc = max(fwidth(h / 0.45), 1e-4);
        float course = band(fract(h / 0.45), 0.0, 0.07, fwc * 1.5) * (1.0 - far);
        diffuseColor.rgb *= 1.0 - (fl < 0.5 ? 0.17 : 0.05) * course;
        if (fl < 0.5) diffuseColor.rgb *= 1.0 - 0.12 * band(fract(s * 1.6 + step(0.5, fract(h / 0.9)) * 0.5), 0.0, 0.05, fw.x * 1.6) * (1.0 - far);
        float topF = floorsIn - 1.0;
        float filant = (abs(fl - 2.0) < 0.5 || (abs(fl - topF) < 0.5 && topF > 3.5)) ? 1.0 : 0.0;
        float bars = 0.5 + 0.5 * band(fract(s * 14.0), 0.0, 0.32, fw.x * 14.0);
        float rail = band(fy, sill + 0.01, sill + 0.29, fw.y) * band(fy, 0.0, 0.31, fw.y) * step(0.5, fl) * step(fl, topF + 0.5)
          * mix(band(fx, 0.5 - wx - 0.04, 0.5 + wx + 0.04, fw.x), 1.0, filant);
        float slab = band(fy, 0.0, sill + 0.01, fw.y) * filant * step(0.5, fl);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.1 + 0.02, slab);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.035, 0.04), rail * bars * 0.92 * (1.0 - 0.6 * far));
        win *= 1.0 - rail * bars * 0.8;
        frame *= 1.0 - rail * bars;
        // the cornice: a lit moulding over a shadow, above the top floor
        float attic = step(topF + 0.5, fl);
        diffuseColor.rgb *= 1.0 - attic * (0.22 * band(fy, 0.0, 0.18, fw.y) - 0.08 * band(fy, 0.18, 0.4, fw.y));
      }
      // Amsterdam canal house (grachtenpand): brick in courses with staggered joints, a stone
      // lintel over each tall sash window, and glazing bars: two uprights, a meeting rail and a
      // bar across each sash
      if (style > 13.5 && style < 14.5) {
        float bh = h / 0.065, bx = s * vGrid.x / 0.22 + 0.5 * mod(floor(bh), 2.0);
        vec2 fb = max(fwidth(vec2(bx, bh)), vec2(1e-4));
        float joint = max(band(fract(bh), 0.0, 0.17, fb.y * 1.5), band(fract(bx), 0.0, 0.05, fb.x * 1.5));
        diffuseColor.rgb *= 1.0 - 0.16 * joint * (1.0 - smoothstep(0.25, 0.6, max(fb.x, fb.y)));
        float lintel = band(fy, head + 0.02, head + 0.08, fw.y) * band(fx, 0.5 - wx - 0.05, 0.5 + wx + 0.05, fw.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.82, 0.76), lintel * (1.0 - 0.6 * far));
        float wxr = (fx - 0.5 + wx) / max(2.0 * wx, 1e-3), wyr = (fy - sill) / max(head - sill, 1e-3);
        vec2 fr = max(fwidth(vec2(wxr, wyr)), vec2(1e-4));
        float bars = max(band(abs(fract(wxr * 3.0 + 0.5) - 0.5), 0.0, 0.06, fr.x * 3.0),
                         band(abs(fract(wyr * 4.0 + 0.5) - 0.5), 0.0, 0.05, fr.y * 4.0)) * (1.0 - far);
        frame = max(frame, win * bars);
        win *= 1.0 - bars;
      }
      // shopfront fascia band
    }
    if (shop > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, band(fy, 0.82, 1.0, fw.y) * 0.6);
    // machiya: a timber lattice (koshi) across the ground floor, plaster with slit windows above
    if (style > 9.5 && style < 10.5) {
      if (fl < 0.5) {
        float slat = band(fract(fx * 22.0), 0.0, 0.42, fw.x * 22.0) * band(fy, 0.04, 0.84, fw.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.1, 0.08), slat);
        win *= 1.0 - slat;
      } else {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.82), band(fy, 0.1, 0.95, fw.y) * 0.7);
        float slit = band(fract(fx * 8.0), 0.35, 0.65, fw.x * 8.0) * band(fx, 0.2, 0.8, fw.x) * band(fy, 0.35, 0.72, fw.y);
        win = slit * 0.9; frame = 0.0;
      }
    }
    // Japanese mixed-use mid-rise: shop signs on some floors and a vertical sign on a corner bay, backlit at night
    float sign = 0.0; vec3 signC = vec3(0.0);
    if (style > 10.5 && style < 11.5 && uSigns > 0.0 && fl > 0.5) {
      float sr = h21(vec2(fl, floor(bay / 2.0)) + bidH * 1.7);
      float pane = step(sr, 0.22 * uSigns) * band(fy, 0.12, 0.88, fw.y) * band(fract(bay / 2.0) * 2.0 + fx, 0.08, 1.92, fw.x);
      float vert = step(0.45, seed) * step(bay, 0.5) * band(fx, 0.18, 0.82, fw.x);
      sign = max(pane, vert) * (1.0 - far * 0.5);
      float hue = h21(vec2(floor(bay / 2.0), fl) * 1.3 + bidH);
      signC = hue < 0.3 ? vec3(0.85, 0.12, 0.1) : hue < 0.5 ? vec3(0.95, 0.8, 0.15) : hue < 0.7 ? vec3(0.92, 0.92, 0.9) : hue < 0.85 ? vec3(0.1, 0.35, 0.8) : vec3(0.1, 0.6, 0.3);
      if (vert > 0.5) signC = seed < 0.7 ? vec3(0.9, 0.9, 0.88) : vec3(0.85, 0.15, 0.12);
      win *= 1.0 - sign;
      frame *= 1.0 - sign;
    }
    float onFloor = step(fl + 0.5, floorsIn) * (1.0 - far) + far;
    win *= inRun * onFloor; frame *= inRun * onFloor;
    float wwr = style > 4.5 && style < 5.5 ? 0.7 : ww * (head - sill);
    win = mix(win, wwr * inRun, far);
    frame = mix(frame, 0.0, far);
    // per window: lit at night, blinds, a room
    vec2 cellId = vec2(bay, fl);
    float rnd = h31(vec3(cellId, bidH + seed * 31.0));
    float unitW = style > 3.5 && style < 5.5 ? 6.0 : 2.0;
    float unitR = h31(vec3(floor(bay / unitW), fl, bidH * 1.37));
    float lit = step(unitR, occupancy(style, uHour)) * step(0.12, rnd);
    if (shop > 0.5) lit = step(0.15, rnd) * step(0.0, occupancy(7.0, uHour) - 0.3);
    float blind = step(0.72, h31(vec3(cellId, bidH * 0.53 + 3.1))) * (style > 4.5 && style < 5.5 ? 0.0 : 1.0);
    float blindY = 0.55 + 0.4 * h21(cellId + bidH);
    float isBlind = blind * step(blindY, fy) * (1.0 - far);
    // interior mapping: a room behind the glass, lit by day from outside and by its lamps at night
    vec3 room = vec3(0.0);
    if (win > 0.01) {
      float bw = max(vGrid.x, 1.0), depth = vLook.x;
      vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N)), V = normalize(vWPos - cameraPosition);
      vec3 d = vec3(dot(V, T) / bw, V.y / storey, -dot(V, N) / bw);
      vec2 p0 = vec2(style > 4.5 && style < 5.5 ? fx : clamp((fx - 0.5 + 0.5 * ww) / max(ww, 0.05), 0.0, 1.0), fy);
      if (shop > 0.5) p0 = vec2(fx, fy);
      vec3 inv = 1.0 / max(abs(d), vec3(1e-4));
      float tx = (d.x > 0.0 ? 1.0 - p0.x : p0.x) * inv.x, ty = (d.y > 0.0 ? 1.0 - p0.y : p0.y) * inv.y, tz = depth * inv.z;
      float t = min(min(tx, ty), tz);
      // which face the ray meets, with a tolerance and a fixed order so near-ties do not flicker
      float hitZ = step(tz, t * 1.0001 + 1e-5), hitY = (1.0 - hitZ) * step(ty, t * 1.0001 + 1e-5);
      vec3 hp = vec3(p0, 0.0) + d * t;
      float roomR = h31(vec3(cellId, bidH * 0.71 + 7.3));
      vec3 wallC = mix(vec3(0.62, 0.58, 0.52), vec3(0.55, 0.6, 0.62), roomR);
      vec3 c;
      if (hitZ > 0.5) {
        c = wallC * (0.8 + 0.2 * step(0.5, h21(floor(hp.xy * vec2(3.0, 2.0)) + roomR))) ;
        c *= 1.0 - 0.5 * band(hp.y, 0.0, 0.42, 0.02) * step(0.45, roomR) * band(hp.x, 0.15, 0.75, 0.02); // furniture
      } else if (hitY > 0.5) {
        c = d.y > 0.0 ? vec3(0.8, 0.79, 0.76) : mix(vec3(0.42, 0.3, 0.2), vec3(0.35, 0.36, 0.38), roomR);
      } else c = wallC * 0.85;
      c *= mix(1.0, 0.45, clamp(hp.z / depth, 0.0, 1.0));
      // day: dim, lit by the window; night: the room's lamps when occupied
      float dayL = (style > 4.5 && style < 5.5 ? 0.06 : 0.2) * (1.0 - uNight);
      vec3 lampC = mix(vec3(1.0, 0.64, 0.34), vec3(1.0, 0.86, 0.66), step(3.5, style) * step(style, 5.5) + step(8.5, style) * step(style, 9.5));
      float lamp = lit * uNight * (0.3 + 0.3 * rnd);
      float ceilingSpot = hitY > 0.5 && d.y > 0.0 ? 1.0 + 0.8 * exp(-8.0 * dot(hp.xz - vec2(0.5, depth * 0.5), hp.xz - vec2(0.5, depth * 0.5))) : 1.0;
      room = c * (dayL + lamp * 1.0 * lampC * ceilingSpot * (0.75 + 0.5 * h21(vec2(fl, bidH))));
      room *= 1.0 - smoothstep(500.0, 900.0, dist) * 0.6;
    }
    // far windows at night: average glow instead of rooms
    float glowFar = lit * uNight * far;
    vec3 frameC = (style > 0.5 && style < 3.5) || (style > 5.5 && style < 6.5) || style > 12.5 ? mix(vec3(0.78, 0.76, 0.7), diffuseColor.rgb, 0.25 + 0.5 * step(0.6, seed))
      : diffuseColor.rgb * (1.0 - vLook.y);
    vec3 blindC = mix(vec3(0.82, 0.8, 0.74), vec3(0.6, 0.62, 0.6), rnd);
    if (style > 4.5 && style < 5.5) {
      // curtain-wall glass tint per building; the spandrel takes the frame colour
      // coated glass: a tinted mirror (F0 about 0.3) over a dim interior
      vec3 tint = seed < 0.3 ? vec3(0.26, 0.36, 0.42) : seed < 0.55 ? vec3(0.34, 0.37, 0.39) : seed < 0.75 ? vec3(0.2, 0.27, 0.34)
        : seed < 0.9 ? vec3(0.3, 0.38, 0.34) : vec3(0.38, 0.32, 0.26);
      tint *= 0.9 + 0.2 * h21(vec2(bay, fl) * 0.37 + bidH);
      diffuseColor.rgb = mix(diffuseColor.rgb, frameC * 0.8, frame);
      diffuseColor.rgb = mix(diffuseColor.rgb, tint, win);
      metalB = mix(0.25, 0.86, win);
      roughB = mix(0.4, 0.04 + 0.08 * rnd, win);
    } else {
      diffuseColor.rgb = mix(diffuseColor.rgb, frameC, clamp(frame, 0.0, 1.0));
      vec3 glassC = vec3(0.09, 0.1, 0.11);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(glassC, blindC, isBlind), win);
      metalB = win * (1.0 - isBlind) * vLook.z;
      roughB = mix(roughB, mix(0.07, 0.6, isBlind), win);
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, signC, sign);
    emitB += sign * signC * (0.05 + 1.1 * uNight * uSigns);
    roughB = mix(roughB, 0.35, sign);
    glass = win * (1.0 - isBlind);
    if (style < 4.5 || style > 5.5) {
      float reveal = 1.0 - smoothstep(head - 0.11, head - 0.03, fy) * (1.0 - far);
      diffuseColor.rgb *= mix(1.0, 0.55, (1.0 - reveal) * win);
    }
    emitB += room * glass;
    emitB += win * isBlind * lit * uNight * vec3(1.0, 0.7, 0.42) * 0.35;
    emitB += glowFar * win * mix(vec3(1.0, 0.64, 0.34), vec3(1.0, 0.86, 0.66), step(3.5, style) * step(style, 5.5)) * (0.22 + 0.2 * rnd);
    // ground contact: a darker plinth and less sky near the street
    aoW *= mix(0.72, 1.0, smoothstep(0.0, 3.0, h));
    // fine plaster noise up close
    diffuseColor.rgb *= 0.94 + 0.12 * vnoise(vec2(s * 7.0 + bidH, h * 3.0)) * (1.0 - far);
  } else if (kind < 1.5) {
    // ---------------------------------------------------------------- blank wall, gable, parapet
    diffuseColor.rgb *= 0.95 + 0.1 * vnoise(vFac * vec2(1.3, 2.1) + bidH);
    aoW *= mix(0.75, 1.0, smoothstep(0.0, 3.0, vFac.y));
  } else if (kind < 2.5) {
    // ---------------------------------------------------------------- pitched roof
    float m = vExt.z; // 3 tile, 4 metal, 5 slate, 6 kawara, 7 copper, 10 zinc
    vec2 r = vFac;
    vec2 fwr = max(fwidth(r), vec2(1e-4));
    float fade = 1.0 - smoothstep(0.08, 0.25, max(fwr.x, fwr.y));
    vec3 base = diffuseColor.rgb;
    if (uPhotoOn > 0.5) {
      vec2 uv = vec2((vWPos.x - uFrame.x) * uFrame.z, (-vWPos.z - uFrame.y) * uFrame.w);
      vec3 ph = texture2D(uPhoto, uv).rgb;
      base = mix(base, ph * 0.9, 0.35);
    }
    float pat = 1.0;
    if (m > 2.5 && m < 3.5) { // terracotta tile: courses down the slope, rounded pans across
      float course = fract(r.y / 0.34), pan = fract(r.x / 0.24 + 0.5 * step(0.5, fract(r.y / 0.68)));
      pat = 0.78 + 0.22 * smoothstep(0.0, 0.85, course) * (0.75 + 0.25 * sin(pan * 6.2832));
      pat *= 0.92 + 0.16 * h21(floor(vec2(r.x / 0.24, r.y / 0.34)) + bidH);
    } else if (m > 3.5 && m < 4.5) { // corrugated steel: ribs running down the slope
      pat = 0.88 + 0.12 * sin(r.x / 0.19 * 6.2832);
      metalB = 0.35; roughB = 0.42;
    } else if (m > 4.5 && m < 5.5) { // slate
      float course = fract(r.y / 0.28), sl = fract(r.x / 0.3 + 0.5 * step(0.5, fract(r.y / 0.56)));
      pat = 0.85 + 0.15 * smoothstep(0.0, 0.9, course) * smoothstep(0.0, 0.06, sl) * smoothstep(1.0, 0.94, sl);
      roughB = 0.6;
    } else if (m > 5.5 && m < 6.5) { // kawara: deep rounded rows and dark glaze
      pat = 0.7 + 0.3 * pow(abs(sin(r.x / 0.3 * 3.1416)), 0.6);
      pat *= 0.9 + 0.1 * smoothstep(0.0, 0.2, fract(r.y / 0.28));
      roughB = 0.45; metalB = 0.1;
    } else if (m > 9.5 && m < 10.5) { // rolled zinc: standing seams every 0.65 m down the slope
      float seam = band(fract(r.x / 0.65), 0.0, 0.05, fwr.x / 0.65 * 1.5);
      pat = 0.93 + 0.1 * vnoise(r * vec2(0.3, 1.7) + bidH) + 0.16 * seam * fade;
      pat *= mix(1.0, 0.82, smoothstep(0.35, 0.15, abs(N.y))); // the steep brisis reads darker than the terrasson
      metalB = 0.4; roughB = 0.4;
    } else if (m > 6.5 && m < 7.5) { // copper patina
      base = mix(base, vec3(0.22, 0.42, 0.36), 0.6);
      pat = 0.85 + 0.25 * vnoise(r * 1.5);
      roughB = 0.55; metalB = 0.25;
    } else roughB = 0.8;
    diffuseColor.rgb = base * mix(1.0, pat, fade);
    aoW = 1.0;
  } else if (kind < 3.5) {
    // ---------------------------------------------------------------- flat deck
    vec3 base = diffuseColor.rgb;
    if (uPhotoOn > 0.5 && mod(floor(vExt.y / 16.0), 2.0) > 0.5) {
      vec2 uv = vec2((vWPos.x - uFrame.x) * uFrame.z, (-vWPos.z - uFrame.y) * uFrame.w);
      // the photo, a little softened and leaned towards the roof's median colour: close up a 1 m photo is noise
      base = mix(base, texture2D(uPhoto, uv, 1.0).rgb * 0.92, 0.65);
    } else {
      base *= 0.9 + 0.2 * vnoise(vFac * 0.35 + bidH);
      base *= 1.0 - 0.08 * (1.0 - band(fract(vFac.x / 1.2), 0.02, 0.98, 0.02));
    }
    diffuseColor.rgb = base;
    roughB = 0.88; aoW = 0.95;
  } else if (kind < 4.5) {
    roughB = 0.7; aoW = 0.95; // coping, awnings
  } else {
    roughB = 0.8; aoW = 0.9; // awning soffit, lit at night
    emitB += diffuseColor.rgb * uNight * 0.55 * occupancy(7.0, uHour);
  }
  float win = glass;
  if (uMode > 0.5) {
    diffuseColor.rgb = vSrc < 0.5 ? uC0 : (vSrc < 1.5 ? uC1 : (vSrc < 2.5 ? uC2 : vec3(0.8)));
    emitB = vec3(0.0); metalB = 0.0; roughB = 0.85; glass = 0.0;
  }
  if (abs(bidI - uSel) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.42, 0.12), 0.6);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = roughB;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = metalB;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += emitB;`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= aoW;
  reflectedLight.indirectSpecular *= mix(aoW, 1.0, glass * 0.5);
  reflectedLight.directDiffuse *= mix(1.0, aoW, 0.35);`);
    };
    mat.customProgramCacheKey = () => 'oe-facade-4';
    return mat;
  }

  return { create, STYLES, guessStyle };
})();
