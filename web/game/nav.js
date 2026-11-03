// Where things can stand, walk, sail and fly, from the same data the model is built
// from: the 2 m surface model (terrain + buildings, with building ids), the 5 m water
// mask, pier decks, walkable surfaces such as a bridge deck (game.json "surfaces"), the
// decks of the mapped bridges and viaducts (decks.js), and the parametric landmarks,
// rasterised as height intervals so that a helicopter can pass under the Harbour Bridge
// deck but not through its steel. Walls, roofs and the camera use the exact building
// footprints through collision.js; the 2 m grids decide water, piers and decks.
'use strict';
window.OENav = (function () {
  const S = window.Sun;
  const STEP = 0.75;     // highest step a walker takes without jumping (m)
  const DROP = 4.0;      // highest drop a walker steps off (railings everywhere else)
  const R = 0.35;        // walker capsule radius (m)
  const KNEE = 0.4, HEAD = 1.8; // a walker's capsule spans feet + KNEE to feet + HEAD; landmark lips below the knee are stepped over
  const PROBE = 0.25;    // camera probe radius (m), a little under the near plane
  const BUILDING = 1, LANDMARK = 2;

  function create(D, DSM) {
    const G = D.G, T = D.quays ? D.quays.raise(D.T) : D.T; // the ground as drawn: level up to a quay's wall
    // ---------------------------------------------------------- water (5 m, packed bits)
    const wm = G.water, bytes = Uint8Array.from(atob(wm.bits), c => c.charCodeAt(0));
    const isWaterCell = (r, c) => (bytes[(r * wm.nx + c) >> 3] >> (7 - ((r * wm.nx + c) & 7))) & 1;
    const x0 = DSM.x0, y1 = DSM.y1;
    // along a quay (quays.js) the water starts a few tens of centimetres short of the seawall's face,
    // not at the 5 m grid's bank
    const quays = D.quays || null;
    function isWater(x, y) {
      const q = quays && quays.water(x, y);
      if (q != null) return q;
      const c = Math.floor((x - x0) / wm.cell), r = Math.floor((y1 - y) / wm.cell);
      if (r < 0 || c < 0 || r >= wm.ny || c >= wm.nx) return true; // outside the model: open water or edge
      return !!isWaterCell(r, c);
    }
    // ---------------------------------------------------------- piers (2 m grid, deck height)
    const pier = { nx: DSM.nx, ny: DSM.ny, cell: DSM.cell, x0, y1, data: new Float32Array(DSM.nx * DSM.ny).fill(-99) };
    (D.P.piers || []).forEach((r, i) => S.fillMax(pier, [r.map(v => v / 10)], D.pierZ ? D.pierZ[i] : G.pier_deck_m || 2.2)); // as drawn (world.js)
    for (const r of G.boardwalks || []) S.fillMax(pier, [r.map(v => v / 10)], G.pier_deck_m || 2.2); // walkways over rocks and water
    // places walkers keep out of (a colony's rocks): a 2 m mask
    const nogo = (G.nogo || []).length ? { nx: DSM.nx, ny: DSM.ny, cell: DSM.cell, x0, y1, data: new Float32Array(DSM.nx * DSM.ny) } : null;
    for (const r of G.nogo || []) S.fillMax(nogo, [r.map(v => v / 10)], 1);
    // ---------------------------------------------------------- strip surfaces (bridge decks, steps)
    const strips = (G.surfaces || []).filter(s => s.type === 'strip').map(s => Object.assign({}, s, {
      us: s.profile.map(p => p[0]), zs: s.profile.map(p => p[1]) }));
    function stripUV(s, x, y) {
      const dx = x - s.origin[0], dy = y - s.origin[1];
      return [dx * s.axis[0] + dy * s.axis[1], -dx * s.axis[1] + dy * s.axis[0]];
    }
    function interp(us, zs, u) {
      if (u <= us[0]) return zs[0];
      for (let i = 1; i < us.length; i++) if (u <= us[i]) { const t = (u - us[i - 1]) / (us[i] - us[i - 1]); return zs[i - 1] + (zs[i] - zs[i - 1]) * t; }
      return zs[zs.length - 1];
    }
    function stripHeight(s, x, y) {
      const [u, v] = stripUV(s, x, y);
      if (Math.abs(v) > s.half_width || u < s.us[0] || u > s.us[s.us.length - 1]) return null;
      return interp(s.us, s.zs, u);
    }
    // ---------------------------------------------------------- landmark solids as height intervals per 2 m cell
    const solid0 = new Map(); // cell index -> [zmin, zmax, zmin, zmax, ...]
    const slabs = new Map();  // the same for the strips' slabs alone (the collision world's boxes for them)
    const tops = {};         // mesh name -> Map(cell index -> top), for shading the surface model
    const solidMeshes = [];  // the meshes that are solid, for the collision world's finer cells (below)
    for (const m of D.LM.meshes || []) {
      if (strips.some(st => st.mesh && m.name.startsWith(st.mesh))) continue; // walked on as a strip surface; its slab is added below
      const mat = (D.LM.materials || {})[m.material] || {};
      if (mat.decal) continue; // paving laid over a roof, which is the solid
      if (mat.solid === false) continue; // walls a city's fine walking levels hold walkers back at instead (game.json "patches")
      solidMeshes.push(m);
      const p = m.position, idx = m.index, mine = new Map();
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const e = Math.max(Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]), Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]),
          Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]));
        const n = Math.max(1, Math.ceil(e / 1.0));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          const x = p[a] * w + p[b] * u + p[c] * v, y = p[a + 1] * w + p[b + 1] * u + p[c + 1] * v, z = p[a + 2] * w + p[b + 2] * u + p[c + 2] * v;
          const cc = Math.floor((x - x0) / DSM.cell), rr = Math.floor((y1 - y) / DSM.cell);
          if (cc < 0 || rr < 0 || cc >= DSM.nx || rr >= DSM.ny) continue;
          const k = rr * DSM.nx + cc, q = mine.get(k);
          if (q) { if (z < q[0]) q[0] = z; if (z > q[1]) q[1] = z; } else mine.set(k, [z, z]);
        }
      }
      tops[m.name] = new Map([...mine].map(([k, q]) => [k, q[1]]));
      for (const [k, q] of mine) { const l = solid0.get(k); if (l) l.push(q[0] - 0.3, q[1] + 0.3); else solid0.set(k, [q[0] - 0.3, q[1] + 0.3]); }
    }
    const cellOf = (x, y) => {
      const c = Math.floor((x - x0) / DSM.cell), r = Math.floor((y1 - y) / DSM.cell);
      return c < 0 || r < 0 || c >= DSM.nx || r >= DSM.ny ? -1 : r * DSM.nx + c;
    };
    // the ground under a walker is the ground that is drawn: the terrain tiles are a grid of
    // cells, each split from its south-west to its north-east corner (three.js PlaneGeometry),
    // so the walker stands on the same two triangles, never above or below them
    let tri = 0; // the last cell's triangle: its slope, rise over run
    // fine walking levels a city lays over the grid (game.json "patches": paving with its walls and
    // steps, every half metre, which the grid would smooth into slopes): the cell's own level, not
    // interpolated, so that a wall stays a wall and a riser a step. Where a slab stands over the
    // paving (a forecourt over a colonnade), "upper" holds the slab's level: the ground is the slab,
    // and the floor under it is walked too (floorAt, groundBelow)
    const int16 = s => { const b = Uint8Array.from(atob(s), c => c.charCodeAt(0)); return new Int16Array(b.buffer, 0, b.length >> 1); };
    const patches = (G.patches || []).map(p => Object.assign({}, p, {
      z: int16(p.data), up: p.upper ? Object.assign({}, p.upper, { z: int16(p.upper.data) }) : null, x1: p.x0 + p.nx * p.cell, y1: p.y0 + p.ny * p.cell }));
    // the patch's levels at (x, y): [the floor, the slab over it or null], or null off the patches
    function patchAt(x, y) {
      for (const p of patches) {
        if (x < p.x0 || y < p.y0 || x >= p.x1 || y >= p.y1) continue;
        const c = Math.floor((x - p.x0) / p.cell), r = Math.floor((y - p.y0) / p.cell), v = p.z[r * p.nx + c];
        if (v === -32768) continue;
        const U = p.up, uc = U ? c - U.i0 : -1, ur = U ? r - U.j0 : -1;
        const u = U && uc >= 0 && ur >= 0 && uc < U.nx && ur < U.ny ? U.z[ur * U.nx + uc] : -32768;
        return [v / 100, u === -32768 ? null : u / 100];
      }
      return null;
    }
    // the floor under a slab at (x, y), or null where there is none
    function under(x, y) {
      if (!patches.length) return null;
      const h = patchAt(x, y);
      return h && h[1] !== null ? h[0] : null;
    }
    function terrain(x, y) {
      if (patches.length) { const h = patchAt(x, y); if (h !== null) { tri = 0; return h[1] !== null ? h[1] : h[0]; } }
      const c = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.cell)), r = Math.max(0, Math.min(T.ny - 1.001, (T.y1 - y) / T.cell));
      const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * T.nx + c0, D = T.data;
      const a = D[i], b = D[i + 1], d = D[i + T.nx], e = D[i + T.nx + 1];
      if (fc + fr <= 1) { tri = Math.hypot(b - a, d - a) / T.cell; return a + fc * (b - a) + fr * (d - a); }
      tri = Math.hypot(e - d, e - b) / T.cell;
      return e + (1 - fc) * (d - e) + (1 - fr) * (b - e);
    }
    // the ground at (x, y) as seen from height z: under a slab that stands above z, the floor under it
    function terrainBelow(x, y, z) { const t = terrain(x, y), u = under(x, y); return u !== null && t > z ? u : t; }
    // the underside of a slab over a walker at height z at (x, y) (the patch's "clear_m" over its floor), or null
    function ceilingAt(x, y, z) {
      if (!patches.length) return null;
      for (const p of patches) {
        if (!p.up || x < p.x0 || y < p.y0 || x >= p.x1 || y >= p.y1) continue;
        const h = patchAt(x, y);
        return h && h[1] !== null && h[1] > z + 0.5 ? h[0] + (p.clear_m || 2.2) : null;
      }
      return null;
    }
    const slope = (x, y) => (terrain(x, y), tri);
    // land beside the water: there the ground drawn goes down the bank (a quay wall, a moat's
    // stone side, a beach) to the bottom modelled under the water, and a walker stops at the
    // waterline or at the top of a bank too steep to walk
    const WATERLINE = 0.1, BANK = 0.84; // m above the water; tan 40°
    const shore = new Uint8Array(wm.nx * wm.ny);
    for (let r = 0; r < wm.ny; r++) for (let c = 0; c < wm.nx; c++) {
      if (isWaterCell(r, c)) continue;
      for (let i = -1; i <= 1 && !shore[r * wm.nx + c]; i++) for (let j = -1; j <= 1; j++) {
        const rr = r + i, cc = c + j;
        if (rr >= 0 && cc >= 0 && rr < wm.ny && cc < wm.nx && isWaterCell(rr, cc)) { shore[r * wm.nx + c] = 1; break; }
      }
    }
    function onShore(x, y) {
      const c = Math.floor((x - x0) / wm.cell), r = Math.floor((y1 - y) / wm.cell);
      return r >= 0 && c >= 0 && r < wm.ny && c < wm.nx && shore[r * wm.nx + c] === 1;
    }
    // can the ground at (x, y) be stood on? null if so, else why not ('water', or 'bank' at the top of a steep one)
    function offGround(x, y) {
      if (isWater(x, y)) return 'water';
      if (!onShore(x, y)) return null;
      if (terrain(x, y) < WATERLINE) return 'water';
      return slope(x, y) > BANK ? 'bank' : null;
    }
    // ---------------------------------------------------------- strips fitted to their banks
    // A deck drawn from a mapped outline (an Amsterdam canal bridge) can end short of the quay the
    // 5 m water mask draws, leaving a metre or four of water between them, or end below the ground
    // where the bank rises to meet it. Each end over the water is carried on along the axis to the
    // first firm ground within 12 m, sloping to the quay's height (an approach, drawn by game.js);
    // and where the ground under the deck stands up to a step above it, the deck is raised to it, so
    // that a walker there is on the deck (and passes what stands under it) and not on the ground
    const approaches = [];
    const along = (s, u) => [s.origin[0] + s.axis[0] * u, s.origin[1] + s.axis[1] * u];
    const firm = (s, u) => !offGround(...along(s, u)); // (down the middle, where the walk across goes)
    for (const s of strips) {
      if (s.drape || s.us.length < 2) continue; // steps laid over the ground: as given
      let us = s.us.slice(), zs = s.zs.slice();
      const u0 = us[0], u1 = us[us.length - 1];
      for (const end of [-1, 1]) {
        const ue = end < 0 ? u0 : u1;
        const ze = end < 0 ? zs[0] : zs[zs.length - 1];
        // firm ground straight off the end, level with it (the strip's slab, in 2 m cells, reaches a little past its end)
        if ([0.05, 0.15, 0.3, 0.5, 0.75, 1, 1.25].every(d => firm(s, ue + end * d)) && Math.abs(terrain(...along(s, ue + end * 0.5)) - ze) < 0.25) continue;
        let reach = null, zq = 0;
        for (let d = 0.5; d <= 12 && reach == null; d += 0.5) {
          const u = ue + end * d;
          if (!firm(s, u) || !firm(s, u + end)) continue;
          const z = terrain(...along(s, u));
          if (Math.abs(z - ze) <= 0.25 * d + 0.3) { reach = u; zq = z; } // no steeper than 1 in 4 (else the top of the bank is further on)
        }
        if (reach == null) continue; // a deck high over the bank (the Harbour Bridge): as given
        if (end < 0) { us.unshift(reach); zs.unshift(zq); } else { us.push(reach); zs.push(zq); }
        approaches.push({ strip: s, from: ue, to: reach, z0: ze, z1: zq });
      }
      // the ground under the deck, a little above it: the deck there is at the ground's height
      const n = Math.max(2, Math.ceil((us[us.length - 1] - us[0]) / 0.5) + 1), ru = [], rz = [];
      let raised = false;
      for (let i = 0; i < n; i++) {
        const u = us[0] + (us[us.length - 1] - us[0]) * i / (n - 1), z = interp(us, zs, u);
        let g = -Infinity;
        for (const f of [0, 0.6, -0.6]) {
          const v = f * s.half_width, x = s.origin[0] + s.axis[0] * u - s.axis[1] * v, y = s.origin[1] + s.axis[1] * u + s.axis[0] * v;
          if (!offGround(x, y)) g = Math.max(g, terrain(x, y));
        }
        ru.push(u); rz.push(g > z - 0.05 && g < z + STEP ? (raised = true, g + 0.05) : z);
      }
      if (raised) { us = ru; zs = rz; }
      s.us = us; s.zs = zs; s.profile = us.map((u, i) => [u, zs[i]]);
    }
    // each strip's bounds, and the strips by 64 m cell: a point asks only those it can be on
    // (Amsterdam has more than two hundred bridge decks)
    const SC = 64, stripGrid = new Map(), noStrips = [], skey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
    for (const s of strips) {
      const u0 = s.us[0], u1 = s.us[s.us.length - 1], w = s.half_width, xs = [], ys = [];
      for (const u of [u0, u1]) for (const v of [-w, w]) { xs.push(s.origin[0] + s.axis[0] * u - s.axis[1] * v); ys.push(s.origin[1] + s.axis[1] * u + s.axis[0] * v); }
      s.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      for (let cx = Math.floor(s.box[0] / SC); cx <= Math.floor(s.box[2] / SC); cx++) for (let cy = Math.floor(s.box[1] / SC); cy <= Math.floor(s.box[3] / SC); cy++) {
        const k = skey(cx, cy);
        if (!stripGrid.has(k)) stripGrid.set(k, []);
        stripGrid.get(k).push(s);
      }
    }
    const stripsAt = (x, y) => stripGrid.get(skey(Math.floor(x / SC), Math.floor(y / SC))) || noStrips;
    // slabs: solid from (surface - thickness) to the surface. A cell's slab tops out at the lowest point of the
    // surface inside it, so that on a steep one (steps, an escalator) the cell ahead never stands above the knee
    const off = [-0.475, -0.2375, 0, 0.2375, 0.475], inCell = off.flatMap(a => off.map(b => [a * DSM.cell, b * DSM.cell]));
    for (const s of strips) {
      const th = s.thickness || 3;
      const r0 = Math.max(0, Math.floor((y1 - s.box[3]) / DSM.cell)), r1 = Math.min(DSM.ny - 1, Math.ceil((y1 - s.box[1]) / DSM.cell));
      const c0 = Math.max(0, Math.floor((s.box[0] - x0) / DSM.cell)), c1 = Math.min(DSM.nx - 1, Math.ceil((s.box[2] - x0) / DSM.cell));
      for (let r = r0; r <= r1; r++) {
        const y = y1 - (r + 0.5) * DSM.cell;
        for (let c = c0; c <= c1; c++) {
          const x = x0 + (c + 0.5) * DSM.cell;
          let z = stripHeight(s, x, y);
          if (z == null) continue;
          for (const [dx, dy] of inCell) { const q = stripHeight(s, x + dx, y + dy); if (q != null && q < z) z = q; }
          const k = r * DSM.nx + c;
          for (const M of [solid0, slabs]) { const l = M.get(k); if (l) l.push(z - th, z - 0.05); else M.set(k, [z - th, z - 0.05]); }
        }
      }
    }
    // the height of a strip (not steps laid over the ground) whose edge (x, y) is no more than m metres outside, beside its length, or null
    function stripBeside(x, y, m) {
      const seen = new Set();
      for (const [dx, dy] of [[0, 0], [m, m], [-m, m], [m, -m], [-m, -m]]) for (const s of stripsAt(x + dx, y + dy)) {
        if (seen.has(s) || s.drape) continue;
        seen.add(s);
        const [u, v] = stripUV(s, x, y);
        if (u >= s.us[0] && u <= s.us[s.us.length - 1] && Math.abs(v) <= s.half_width + m) return interp(s.us, s.zs, u);
      }
      return null;
    }
    // ---------------------------------------------------------- landmark solids for the collision world
    // A walker meets a landmark's small things up close: a lantern, a shrine's ema rack, a statue's plinth,
    // the posts of a gate. In 2 m cells each of them would stand as a box up to 4 m across (and its roof,
    // widened by the cells' 0.3 m of height, would come down to head height), so nobody could walk up to
    // it. So the parts of the meshes a walker can reach, up to BAND over the floor beneath them, are laid
    // into FINE cells, each cell's heights split where there is room between them (a lantern's roof over
    // the paving, the eaves over a step), and the cells merged into rectangles; what stands higher (a
    // tower's top, a bridge's arch) keeps the 2 m cells, which the helicopter and the camera meet. Paving
    // that lies on the floor is left to the floor. Returns the 2 m cells (index -> [zlo, zhi, ...]) and adds
    // the fine boxes to the collision world.
    let fineBoxes = 0;
    function landmarkCells(meshes, slabs) {
      const FINE = 0.25, BAND = 3.5, GAP = 0.4, MZ = 0.1, SAMPLE = 0.22, FLAT = 0.25;
      const coarse = new Map(slabs), fine = new Map(), FNX = DSM.nx * Math.round(DSM.cell / FINE);
      const ref = (x, y) => { let h = terrain(x, y); for (const s of stripsAt(x, y)) { const z = stripHeight(s, x, y); if (z != null && z > h) h = z; } const k = cellOf(x, y); if (k >= 0 && pier.data[k] > h) h = pier.data[k]; return h; };
      const cpush = (M, k, lo, hi) => { const l = M.get(k); if (l) l.push(lo, hi); else M.set(k, [lo, hi]); };
      // a triangle's points every `step` metres at most, each passed to fn(x, y, z): rows parallel to its
      // longest edge, so that a long thin triangle (a post's side, a ridge) costs its area, not its length
      // squared. A flat one (|nz| > 0.95, the top of a stone base) only round its edges: its sides, where
      // a walker meets it, are triangles of their own
      const seg = (P, Q, step, fn) => { const n = Math.max(1, Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]) / step));
        for (let j = 0; j <= n; j++) { const t = j / n; fn(P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t); } };
      function sample(A, B, C, step, fn, edges = false) {
        const ab = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), bc = Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]), ca = Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]);
        if (ab < bc || ab < ca) { if (bc >= ca) [A, B, C] = [B, C, A]; else [A, B, C] = [C, A, B]; } // AB the longest
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area2 = Math.hypot(nx, ny, nz);
        if (edges || (area2 > 0 && Math.abs(nz) > 0.95 * area2)) { seg(A, B, step, fn); seg(B, C, step, fn); seg(C, A, step, fn); return; }
        const L = Math.max(ab, 1e-9), h = area2 / L, rows = Math.max(1, Math.ceil(h / step)); // C's distance from AB
        for (let i = 0; i <= rows; i++) {
          const t = i / rows;
          seg([A[0] + vx * t, A[1] + vy * t, A[2] + vz * t], [B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t, B[2] + (C[2] - B[2]) * t], step, fn);
        }
      }
      // the 2 m cells, one interval per mesh and cell as before
      function toCoarse(tris) {
        const mine = new Map();
        for (const [A, B, C] of tris) sample(A, B, C, 1.0, (x, y, z) => {
          const k = cellOf(x, y);
          if (k < 0) return;
          const q = mine.get(k);
          if (q) { if (z < q[0]) q[0] = z; if (z > q[1]) q[1] = z; } else mine.set(k, [z, z]);
        });
        for (const [k, q] of mine) cpush(coarse, k, q[0] - 0.3, q[1] + 0.3);
      }
      // a fine cell's heights: intervals no closer than GAP. What lies under a walkable strip (the stone of a
      // flight of steps, the edge of the platform it climbs to) is the strip's own slab: left out
      function toFine(x, y, z) {
        const c = Math.floor((x - x0) / FINE), r = Math.floor((y1 - y) / FINE);
        if (c < 0 || r < 0 || c >= FNX) return;
        for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null && z <= h + 0.15) return; }
        const k = r * FNX + c, l = fine.get(k);
        if (!l) { fine.set(k, [z, z]); return; }
        for (let i = 0; i < l.length; i += 2) if (z >= l[i] - GAP && z <= l[i + 1] + GAP) { if (z < l[i]) l[i] = z; if (z > l[i + 1]) l[i + 1] = z; return; }
        l.push(z, z);
      }
      // the part of triangle ABC below the height zc and the part above, each as triangles
      function cut(P, zc) {
        const lo = [], hi = [];
        for (let i = 0; i < 3; i++) {
          const a = P[i], b = P[(i + 1) % 3];
          (a[2] <= zc ? lo : hi).push(a);
          if ((a[2] < zc) !== (b[2] < zc) && a[2] !== zc && b[2] !== zc) {
            const t = (zc - a[2]) / (b[2] - a[2]), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zc];
            lo.push(q); hi.push(q);
          }
        }
        const fan = Q => Q.length < 3 ? [] : Q.slice(1, -1).map((_, i) => [Q[0], Q[i + 1], Q[i + 2]]);
        return [fan(lo), fan(hi)];
      }
      for (const m of meshes) {
        const p = m.position, idx = m.index, up = [];
        for (let t = 0; t < idx.length; t += 3) {
          const P = [idx[t], idx[t + 1], idx[t + 2]].map(i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
          const zlo = Math.min(P[0][2], P[1][2], P[2][2]), zhi = Math.max(P[0][2], P[1][2], P[2][2]);
          const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
          const rs = [ref(cx, cy), ref(P[0][0], P[0][1]), ref(P[1][0], P[1][1]), ref(P[2][0], P[2][1])];
          const rlo = Math.min(...rs), zc = Math.max(...rs) + BAND;
          if (zlo >= zc) { up.push(P); continue; }
          if (zhi < rlo + FLAT) continue; // paving on the floor
          const [below, above] = zhi > zc ? cut(P, zc) : [[P], []];
          for (const [A, B, C] of below) sample(A, B, C, SAMPLE, toFine);
          for (const q of above) up.push(q);
        }
        toCoarse(up);
      }
      // the fine cells in rectangles: runs along each row of cells whose heights agree, then runs of rows
      const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.3);
      const widen = (a, b) => a.map((v, i) => (i % 2 ? Math.max(v, b[i]) : Math.min(v, b[i])));
      const keys = [...fine.keys()].sort((a, b) => a - b);
      for (const k of keys) { const l = fine.get(k), o = []; // the intervals in order of height, any that came to touch joined
        const pairs = []; for (let i = 0; i < l.length; i += 2) pairs.push([l[i], l[i + 1]]);
        pairs.sort((a, b) => a[0] - b[0]);
        for (const [a, b] of pairs) if (o.length && a <= o[o.length - 1] + GAP) o[o.length - 1] = Math.max(o[o.length - 1], b); else o.push(a, b);
        fine.set(k, o);
      }
      let open = new Map(), n = 0;
      const emit = q => {
        const xa = x0 + q.c0 * FINE, xb = x0 + (q.c1 + 1) * FINE, yb = y1 - q.r0 * FINE, ya = y1 - (q.r1 + 1) * FINE;
        for (let i = 0; i < q.iv.length; i += 2) { col.add([[xa, ya, xb, ya, xb, yb, xa, yb]], q.iv[i] - MZ, q.iv[i + 1] + MZ, LANDMARK, -1); n++; }
      };
      for (let a = 0; a < keys.length;) {
        const r = Math.floor(keys[a] / FNX), runs = [];
        for (; a < keys.length && Math.floor(keys[a] / FNX) === r;) {
          const c0 = keys[a] % FNX;
          let c1 = c0, iv = fine.get(keys[a]);
          while (a + 1 < keys.length && keys[a + 1] === keys[a] + 1 && Math.floor(keys[a + 1] / FNX) === r && near(iv, fine.get(keys[a + 1]))) { iv = widen(iv, fine.get(keys[a + 1])); c1++; a++; }
          a++;
          runs.push({ c0, c1, iv });
        }
        const next = new Map();
        for (const q of runs) {
          const key = `${q.c0},${q.c1}`, o = open.get(key);
          if (o && o.r1 === r - 1 && near(o.iv, q.iv)) { o.r1 = r; o.iv = widen(o.iv, q.iv); next.set(key, o); open.delete(key); }
          else next.set(key, Object.assign(q, { r0: r, r1: r }));
        }
        for (const o of open.values()) emit(o);
        open = next;
      }
      for (const o of open.values()) emit(o);
      fineBoxes = n;
      return coarse;
    }
    // ---------------------------------------------------------- the collision world: buildings as published, landmark cells as boxes
    const col = OECollision.create();
    for (const s of D.B.s) col.add(s.slice(4).map(r => r.map(v => v / 10)), (s[1] + s[2]) / 10, (s[1] + s[3]) / 10, BUILDING, s[0]);
    // the posts a canopy (an arcade, a gate: pipeline/arcades.py) stands on, as buildings.js draws them
    const PH = OEBuildings.POST / 2;
    for (const s of D.B.s) for (const [x, y] of OEBuildings.canopyPosts(s, D.B.b[s[0]])) col.add([[x - PH, y - PH, x + PH, y - PH, x + PH, y + PH, x - PH, y + PH]], s[1] / 10 - 1, (s[1] + s[2]) / 10, BUILDING, s[0]);
    const coarse = landmarkCells(solidMeshes, slabs);
    for (const [k, l] of coarse) {
      const r = Math.floor(k / DSM.nx), c = k % DSM.nx, xa = x0 + c * DSM.cell, xb = xa + DSM.cell, yb = y1 - r * DSM.cell, ya = yb - DSM.cell;
      for (let i = 0; i < l.length; i += 2) col.add([[xa, ya, xb, ya, xb, yb, xa, yb]], l[i], l[i + 1], LANDMARK, k);
    }
    col.build();
    // buildings under a deck (or poking through it in the data) don't block a walker on the deck
    const underDeck = new Uint8Array(col.prisms.length);
    col.prisms.forEach((p, i) => {
      if (p.tag !== BUILDING) return;
      const r = p.rings[0], n = r.length / 2;
      for (let a = 0; a < n && !underDeck[i]; a++) { // along the edges every metre: a footprint can cross a deck with no corner on it
        const b = (a + 1) % n, ax = r[2 * a], ay = r[2 * a + 1], m = Math.max(1, Math.ceil(Math.hypot(r[2 * b] - ax, r[2 * b + 1] - ay)));
        for (let j = 0; j < m && !underDeck[i]; j++) {
          const x = ax + (r[2 * b] - ax) * j / m, y = ay + (r[2 * b + 1] - ay) * j / m;
          if (stripsAt(x, y).some(s => stripHeight(s, x, y) != null)) underDeck[i] = 1;
        }
      }
    });
    // what a walker with feet at z passes: buildings no taller than a step, and on a deck the buildings
    // under it (landmark lips below the knee are already outside the capsule's height range)
    const passes = (z, onDeck) => (i, p) => p.tag === BUILDING && (p.zhi <= z + STEP || (onDeck && underDeck[i] === 1));
    // building top at (x, y), or -Infinity where there is no building
    function buildingTop(x, y) {
      const k = cellOf(x, y);
      return k >= 0 && DSM.ids[k] >= 0 ? DSM.data[k] : -Infinity;
    }
    function buildingId(x, y) { const k = cellOf(x, y); return k >= 0 ? DSM.ids[k] : -1; }
    // does a landmark solid overlap [za, zb] at (x, y)?
    function landmarkHit(x, y, za, zb) {
      const l = solid0.get(cellOf(x, y));
      if (!l) return false;
      for (let i = 0; i < l.length; i += 2) if (l[i] < zb && l[i + 1] > za) return true;
      return false;
    }
    // the highest surface already built at (x, y), a deck strip or a pier (-Infinity for none)
    function surfaceAt(x, y) {
      const k = cellOf(x, y);
      let h = k >= 0 && pier.data[k] > -50 ? pier.data[k] : -Infinity;
      for (const s of stripsAt(x, y)) { const z = stripHeight(s, x, y); if (z != null && z > h) h = z; }
      return h;
    }
    // ---------------------------------------------------------- decks of mapped bridges and viaducts (decks.js)
    // straight pieces {ax, ay, az, bx, by, bz, hw, th, walk} (th: the slab's depth), found through a grid of 16 m cells
    const decks = [], DG = 16, deckGrid = new Map();
    function addDecks(list) {
      for (const d of list) {
        const i = decks.push(Object.assign({ L: Math.hypot(d.bx - d.ax, d.by - d.ay) }, d)) - 1;
        const c0 = Math.floor((Math.min(d.ax, d.bx) - d.hw) / DG), c1 = Math.floor((Math.max(d.ax, d.bx) + d.hw) / DG);
        const r0 = Math.floor((Math.min(d.ay, d.by) - d.hw) / DG), r1 = Math.floor((Math.max(d.ay, d.by) + d.hw) / DG);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const k = c * 65536 + r, l = deckGrid.get(k); if (l) l.push(i); else deckGrid.set(k, [i]); }
      }
    }
    // the decks at (x, y): calls fn(height, deck) for each
    function decksAt(x, y, fn) {
      const l = deckGrid.get(Math.floor(x / DG) * 65536 + Math.floor(y / DG));
      if (l) for (const i of l) {
        const d = decks[i], ex = (d.bx - d.ax) / d.L, ey = (d.by - d.ay) / d.L, dx = x - d.ax, dy = y - d.ay, u = dx * ex + dy * ey;
        if (u < -0.3 || u > d.L + 0.3 || Math.abs(-dx * ey + dy * ex) > d.hw) continue;
        fn(d.az + (d.bz - d.az) * Math.max(0, Math.min(1, u / d.L)), d);
      }
    }
    // the floor a walker at height z would stand on at (x, y): the highest surface no more
    // than a step above z. Returns {z, kind} or null (water or nothing reachable).
    function floorAt(x, y, z) {
      let best = null, kind = '';
      const take = (h, k) => { if (h <= z + STEP && (best === null || h > best)) { best = h; kind = k; } };
      if (!offGround(x, y)) { take(terrain(x, y), 'ground'); const u = under(x, y); if (u !== null) take(u, 'ground'); }
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > -50) take(pier.data[k], 'pier');
      for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null) take(h, s.name); }
      decksAt(x, y, (h, d) => { if (d.walk) take(h, 'deck'); });
      const bt = col.topAt(x, y, z + STEP, BUILDING);
      if (bt > -Infinity) take(bt, 'roof');
      return best === null ? null : { z: best, kind };
    }
    const isDeck = kind => kind !== 'ground' && kind !== 'pier' && kind !== 'roof';
    // can a walker whose feet are at z stand at (x, y)? Returns the new floor or a reason.
    function walk(x, y, z) {
      const f = floorAt(x, y, z);
      if (!f) return { ok: false, why: offGround(x, y) || 'wall' };
      if (f.z < z - DROP) return { ok: false, why: 'drop' };
      if (nogo && f.kind !== 'pier' && nogo.data[cellOf(x, y)] > 0) return { ok: false, why: 'nogo' };
      if (col.overlap(x, y, R, f.z + KNEE, f.z + HEAD, passes(f.z, isDeck(f.kind)))) return { ok: false, why: 'wall' };
      return { ok: true, z: f.z, kind: f.kind };
    }
    // move a walker whose feet are at z by (dx, dy), sliding along walls and round the cars
    // in `movers` (the traffic, which sets it) and the lamp posts and trunks in `posts`
    // (streets.js, which game.js sets): {x, y, hit}
    function slide(x, y, z, dx, dy) {
      const f = floorAt(x, y, z), skip = passes(z, !!f && isDeck(f.kind));
      const m = col.slide(x, y, dx, dy, R, z + KNEE, z + HEAD, skip);
      let o = m;
      if (api.movers) o = api.movers.pushOut(o.x, o.y, R, z); // (the cars on this level)
      if (api.posts) o = api.posts.pushOut(o.x, o.y, R, z);
      if (o.x === m.x && o.y === m.y) return m;
      // pushed out of a car's side or round a post: keep that, unless it puts the walker in a wall
      if (!col.overlap(o.x, o.y, R, z + KNEE, z + HEAD, skip)) return { x: o.x, y: o.y, hit: m.hit };
      return { x, y, hit: m.hit };
    }
    // is a walker whose feet are at about z, at (x, y), inside a wall (a circle of radius r between
    // knee and head height)? A look at the 2 m surface model round it first, for speed
    function solid(x, y, z, r = 0.1) {
      const k = cellOf(x, y);
      if (k < 0) return false;
      let near = false;
      for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1 && !near; b++) {
        const q = k + a * DSM.nx + b;
        if (q >= 0 && q < DSM.ids.length && ((DSM.ids[q] >= 0 && DSM.data[q] > z + KNEE) || solidCell(q, z + KNEE, z + HEAD))) near = true;
      }
      if (!near) return false;
      const f = floorAt(x, y, z + 0.3), fz = f ? f.z : z;
      return col.overlap(x, y, r, fz + KNEE, fz + HEAD, passes(fz, !!f && isDeck(f.kind)));
    }
    function solidCell(k, za, zb) { const l = solid0.get(k); if (!l) return false; for (let i = 0; i < l.length; i += 2) if (l[i] < zb && l[i + 1] > za) return true; return false; }
    // push a circle of radius r whose bottom is at z out of the walls it overlaps, between knee
    // height and z + top (a car's body: kerbs and low walls are the floor's business): {x, y}
    function push(x, y, z, r, top = HEAD) {
      const f = floorAt(x, y, z);
      return col.depenetrate(x, y, r, z + KNEE, z + top, passes(z, !!f && isDeck(f.kind)));
    }
    // lowest height a flying or floating body may occupy at (x, y): what is directly below
    function groundBelow(x, y, z) {
      let g = isWater(x, y) ? 0 : Math.max(0, terrain(x, y));
      const u = under(x, y);
      if (u !== null && g > z + 0.5) g = Math.max(0, u); // under a slab
      const bt = col.topAt(x, y, Infinity, BUILDING);
      if (bt > g) g = bt;
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > g) g = pier.data[k];
      for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null && h <= z + 0.5 && h > g) g = h; }
      decksAt(x, y, h => { if (h <= z + 0.5 && h > g) g = h; });
      const l = solid0.get(k);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i + 1] <= z + 0.5 && l[i + 1] > g) g = l[i + 1];
      return g;
    }
    // can a walker get somewhere from (x, y), feet at z? A walk over a 2.5 m grid, in steps of a
    // third, that reaches n places
    function roomy(x, y, z, n, closed) {
      const seen = new Set(['0,0']), q = [[0, 0, z]];
      for (let h = 0; h < q.length && q.length < n; h++) {
        const [i, j, zz] = q[h];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const key = `${i + di},${j + dj}`;
          if (seen.has(key)) continue;
          let cz = zz, ok = true;
          for (let k = 1; k <= 3 && ok; k++) { const w = walk(x + (i + di * k / 3) * 2.5, y + (j + dj * k / 3) * 2.5, cz); ok = w.ok; if (ok) cz = w.z; }
          if (ok) { seen.add(key); q.push([i + di, j + dj, cz]); }
        }
      }
      if (q.length < n && closed) for (const [i, j] of q) closed.add(`${Math.floor(x / 2.5) + i},${Math.floor(y / 2.5) + j}`); // a place shut in: no need to try its other spots
      return q.length >= n;
    }
    // the nearest place to (x, y) where someone can stand, on the floor reached from z (or from
    // the ground there, where that is higher: off a bank, up on the quay): not in a wall, on firm
    // ground rather than a bank sloping into the water where one is near, and with room to walk
    // away (room: places a walk from there must reach); ok(x, y) can turn spots down (beside
    // someone already standing there). {x, y, z, kind} or null
    function stand(x, y, z, { rMax = 30, ok = null, room = 0 } = {}) {
      const closed = new Set();
      for (const firm of [true, false]) for (let r = 0; r <= rMax; r += 0.5) {
        const n = r ? Math.ceil(2 * Math.PI * r / 0.5) : 1;
        for (let k = 0; k < n; k++) {
          const a = 2 * Math.PI * k / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, f = floorAt(px, py, Math.max(z, terrain(px, py) + 1));
          if (!f || (firm && f.kind === 'ground' && onShore(px, py) && slope(px, py) > 0.15) || (ok && !ok(px, py))) continue;
          if (room && closed.has(`${Math.floor(px / 2.5)},${Math.floor(py / 2.5)}`)) continue;
          const w = walk(px, py, f.z);
          if (w.ok && (!room || roomy(px, py, w.z, room, closed))) return { x: px, y: py, z: w.z, kind: w.kind };
        }
      }
      return null;
    }
    // is a circle of radius r around (x, y) between za and zb free of buildings and landmark solids?
    function free(x, y, za, zb, r = 2) { return !col.overlap(x, y, r, za, zb); }
    // room for a body of radius r standing on the floor at z (x, y), from knee height to z + top,
    // passing what a walker there passes (a car on the road, a walker wider than R)
    function room(x, y, z, r, top = HEAD, onDeck = false) { return !col.overlap(x, y, r, z + KNEE, z + top, passes(z, onDeck)); }
    // how far along the segment a -> b (three.js world coordinates) the camera probe gets
    // before touching a building, a landmark or a deck's slab: a fraction 0..1, or 1 when clear
    function clearFraction(a, b) {
      const f = col.sweepSphere(a.x, -a.z, a.y, b.x, -b.z, b.y, PROBE);
      if (!decks.length) return f;
      const n = Math.ceil(f * a.distanceTo(b) / 0.5);
      for (let i = 1; i <= n; i++) {
        const t = f * i / n, x = a.x + (b.x - a.x) * t, y = -(a.z + (b.z - a.z) * t), z = a.y + (b.y - a.y) * t;
        let hit = false;
        decksAt(x, y, (h, d) => { if (z > h - d.th - PROBE && z < h + PROBE) hit = true; });
        if (hit) return f * (i - 1) / n;
      }
      return f;
    }
    const api = { under, terrainBelow, ceilingAt, approaches, stripBeside, isWater, onShore, offGround, surfaceAt, addDecks, decksAt, floorAt, walk, stand, slide, solid, push, groundBelow, free, room, isDeck, clearFraction, buildingTop, buildingId, landmarkHit, strips, stripUV, stripHeight, terrain, tops, col, get fineBoxes() { return fineBoxes; }, STEP, DROP, R, BUILDING, LANDMARK, movers: null, posts: null };
    return api;
  }
  return { create };
})();
