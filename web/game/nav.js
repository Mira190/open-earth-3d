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
  const FOOT = 0.9;      // how far from a walker's middle a landmark's floor cells are stepped onto (m): R, and
                         // the margin of 1 to 2 fine cells by which they keep inside the top's edge (tileBuild)
  const PROBE = 0.25;    // camera probe radius (m), a little under the near plane
  const BUILDING = 1, LANDMARK = 2, LFINE = 3; // LFINE: a landmark's fine cells, near the floor

  function create(D, DSM) {
    const G = D.G, T = D.quays ? D.quays.raise(D.T) : D.T; // the ground as drawn: level up to a quay's wall
    const inland = D.inland || null; // inland water (inland.js): walkers stop at a channel's railing and a pond's edge
    // ---------------------------------------------------------- water (5 m, packed bits)
    const bytesOf = b => (typeof b === 'string' ? Uint8Array.from(atob(b), c => c.charCodeAt(0)) : b); // (bytes from game.bin, base64 from game.json)
    const wm = G.water, bytes = bytesOf(wm.bits);
    const isWaterCell = (r, c) => (bytes[(r * wm.nx + c) >> 3] >> (7 - ((r * wm.nx + c) & 7))) & 1;
    const x0 = DSM.x0, y1 = DSM.y1;
    // along a quay (quays.js) the water starts a few tens of centimetres short of the seawall's face,
    // not at the 5 m grid's bank
    const quays = D.quays || null;
    // landings past the frame (outposts.js: Queenstown's Walter Peak wharf): their own ground, water and walls
    const OP = window.OEOutposts && OEOutposts.list(G).length ? OEOutposts : null;
    function isWater(x, y) {
      if (OP && (x < x0 || y > y1 || x >= x0 + wm.nx * wm.cell || y <= y1 - wm.ny * wm.cell)) { const o = OP.at(G, x, y); if (o) return OP.water(o, x, y); }
      const q = quays && quays.water(x, y);
      if (q != null) return q;
      const c = Math.floor((x - x0) / wm.cell), r = Math.floor((y1 - y) / wm.cell);
      if (r < 0 || c < 0 || r >= wm.ny || c >= wm.nx) return true; // outside the model: open water or edge
      return !!isWaterCell(r, c);
    }
    // ---------------------------------------------------------- piers (2 m grid, deck height)
    // (on a grid over the piers' bounds alone, not the whole map's: the 2 m cells' rows and columns pc0, pr0 on; pierAt(k)
    // reads the deck at a 2 m cell index k, -99 for none)
    const pierRings = [...(D.P.piers || []).map((r, i) => [r.map(v => v / 10), D.pierZ ? D.pierZ[i] : G.pier_deck_m || 2.2]), // as drawn (world.js)
      ...(G.boardwalks || []).map(r => [r.map(v => v / 10), G.pier_deck_m || 2.2])]; // walkways over rocks and water
    let pc0 = 0, pr0 = 0, pier = null;
    if (pierRings.length) {
      let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
      for (const [r] of pierRings) for (let k = 0; k < r.length; k += 2) { px0 = Math.min(px0, r[k]); px1 = Math.max(px1, r[k]); py0 = Math.min(py0, r[k + 1]); py1 = Math.max(py1, r[k + 1]); }
      pc0 = Math.max(0, Math.floor((px0 - x0) / DSM.cell) - 1); pr0 = Math.max(0, Math.floor((y1 - py1) / DSM.cell) - 1);
      const pc1 = Math.min(DSM.nx - 1, Math.floor((px1 - x0) / DSM.cell) + 1), pr1 = Math.min(DSM.ny - 1, Math.floor((y1 - py0) / DSM.cell) + 1);
      if (pc1 >= pc0 && pr1 >= pr0) {
        pier = { nx: pc1 - pc0 + 1, ny: pr1 - pr0 + 1, cell: DSM.cell, x0: x0 + pc0 * DSM.cell, y1: y1 - pr0 * DSM.cell };
        pier.data = new Float32Array(pier.nx * pier.ny).fill(-99);
        for (const [r, z] of pierRings) S.fillMax(pier, [r], z);
      }
    }
    const pierAt = k => {
      if (!pier) return -99;
      const c = k % DSM.nx - pc0, r = Math.floor(k / DSM.nx) - pr0;
      return c < 0 || r < 0 || c >= pier.nx || r >= pier.ny ? -99 : pier.data[r * pier.nx + c];
    };
    // places walkers keep out of (a colony's rocks): a 2 m mask
    const nogo = (G.nogo || []).length ? { nx: DSM.nx, ny: DSM.ny, cell: DSM.cell, x0, y1, data: new Float32Array(DSM.nx * DSM.ny) } : null;
    for (const r of G.nogo || []) S.fillMax(nogo, [r.map(v => v / 10)], 1);
    // and a landmark's own water that the city's leaves out (a temple's moat, game.json "keep_off"),
    // at half a metre, as narrow as it is: a walker stops at its edge without a word
    const keepOff = (() => {
      const rings = (G.keep_off || []).map(r => r.map(v => v / 10));
      if (!rings.length) return null;
      let kx0 = Infinity, kx1 = -Infinity, ky0 = Infinity, ky1 = -Infinity;
      for (const r of rings) for (let k = 0; k < r.length; k += 2) { kx0 = Math.min(kx0, r[k]); kx1 = Math.max(kx1, r[k]); ky0 = Math.min(ky0, r[k + 1]); ky1 = Math.max(ky1, r[k + 1]); }
      const cell = 0.5, g = { nx: Math.ceil((kx1 - kx0) / cell) + 2, ny: Math.ceil((ky1 - ky0) / cell) + 2, cell, x0: kx0 - cell, y1: ky1 + cell };
      g.data = new Float32Array(g.nx * g.ny);
      for (const r of rings) S.fillMax(g, [r], 1);
      return (x, y) => {
        const c = Math.floor((x - g.x0) / cell), r = Math.floor((g.y1 - y) / cell);
        return c >= 0 && r >= 0 && c < g.nx && r < g.ny && g.data[r * g.nx + c] > 0;
      };
    })();
    // ---------------------------------------------------------- strip surfaces (bridge decks, steps)
    const strips = window.OENavCells.strips(G);
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
    // (navcells.js; made in a Worker where there is one: game.js puts its result in D.navCells)
    // solid0: cell index -> [zmin, zmax, zmin, zmax, ...]; tops: mesh name -> Map(cell index -> top), for shading the surface model;
    // solidMeshes: the meshes that are solid, for the collision world's finer cells (below); paving: the highest
    // point in each PAVE cell of the paving a city drapes over its ground, which floorAt stands a walker on
    const NC = window.OENavCells, { paveKey } = NC;
    const RC = D.navCells && D.navCells.grid === `${DSM.nx}x${DSM.ny}` ? NC.unpack(D.navCells, D.LM, strips) : NC.raster(D.LM, strips, DSM);
    D.navCells = null;
    const { solid0, tops, solidMeshes, paving } = RC;
    const slabs = new Map();  // the same as solid0 for the strips' slabs alone (the collision world's boxes for them)
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
    const int16 = s => { const b = bytesOf(s); return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); };
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
    // the floors of the passages through a landmark (landmarks.json "passages" with floor: a road, a cycle
    // path or a footway mapped through the building, pipeline/landmark_passages.py): the bare-earth model
    // under a building is a guess (under the Rijksmuseum it dips 2 m), so in a passage's corridor the
    // ground is the passage's floor, level from one end to the other as the landmark draws it (issue #127),
    // and for PMARGIN either side of it: the hall the way runs through (the Rijksmuseum's aisles either side of
    // its cycle path), whose floor the landmark's cells stand on (ref, landmarkCells)
    const PMARGIN = 3.0, PG = 16, pgrid = new Map(), pkey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
    for (const pa of (D.LM && D.LM.passages) || []) {
      if (!pa.floor || !pa.pts || pa.pts.length < 2) continue;
      const hw = pa.w / 2 + PMARGIN;
      for (let i = 1; i < pa.pts.length; i++) {
        const [ax, ay, az] = pa.pts[i - 1], [bx, by, bz] = pa.pts[i], L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-3) continue;
        const sgm = { ax, ay, az, bz, ex: (bx - ax) / L, ey: (by - ay) / L, L, hw };
        for (let cx = Math.floor((Math.min(ax, bx) - hw) / PG); cx <= Math.floor((Math.max(ax, bx) + hw) / PG); cx++)
          for (let cy = Math.floor((Math.min(ay, by) - hw) / PG); cy <= Math.floor((Math.max(ay, by) + hw) / PG); cy++) {
            const k = pkey(cx, cy), l = pgrid.get(k);
            if (l) l.push(sgm); else pgrid.set(k, [sgm]);
          }
      }
    }
    // the floor of a passage at (x, y), or null outside every passage's corridor
    function passageFloor(x, y) {
      if (!pgrid.size) return null;
      const l = pgrid.get(pkey(Math.floor(x / PG), Math.floor(y / PG)));
      if (!l) return null;
      let best = null, bd = Infinity;
      for (const s of l) {
        const dx = x - s.ax, dy = y - s.ay, u = dx * s.ex + dy * s.ey;
        if (u < -0.05 || u > s.L + 0.05) continue;
        const v = Math.abs(-dx * s.ey + dy * s.ex);
        if (v <= s.hw && v < bd) { bd = v; best = s.az + (s.bz - s.az) * Math.max(0, Math.min(1, u / s.L)); }
      }
      return best;
    }
    function terrain(x, y) {
      if (OP && (x < T.x0 || y > T.y1 || x >= T.x0 + T.nx * T.cell || y <= T.y1 - T.ny * T.cell)) { const o = OP.at(G, x, y); if (o) { const g = OP.ground(o, x, y); tri = g.slope; return g.z; } }
      if (patches.length) { const h = patchAt(x, y); if (h !== null) { tri = 0; return h[1] !== null ? h[1] : h[0]; } }
      if (pgrid.size) { const h = passageFloor(x, y); if (h !== null) { tri = 0; return h; } }
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
    // low ceilings along a line a landmark gives (landmarks.json "ceilings": [{pts: [[x, y, z], ...],
    // half_width, clear_m}]: a tunnel of torii, whose lintels stand clear_m over the path), so that the
    // camera stays under them; in 16 m cells of their segments
    const ceilSegs = [], ceilGrid = new Map(), CG = 16, ckey = (cx, cy) => cx * 65536 + cy;
    for (const c of (D.LM && D.LM.ceilings) || []) for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i], k = ceilSegs.push({ a, b, hw: c.half_width, clear: c.clear_m }) - 1;
      for (let cx = Math.floor((Math.min(a[0], b[0]) - c.half_width) / CG); cx <= Math.floor((Math.max(a[0], b[0]) + c.half_width) / CG); cx++)
        for (let cy = Math.floor((Math.min(a[1], b[1]) - c.half_width) / CG); cy <= Math.floor((Math.max(a[1], b[1]) + c.half_width) / CG); cy++) {
          const g = ceilGrid.get(ckey(cx, cy)); if (g) g.push(k); else ceilGrid.set(ckey(cx, cy), [k]);
        }
    }
    function lineCeiling(x, y, z) {
      const g = ceilGrid.get(ckey(Math.floor(x / CG), Math.floor(y / CG)));
      if (!g) return null;
      let best = null;
      for (const k of g) {
        const { a, b, hw, clear } = ceilSegs[k], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
        if (Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y) > hw) continue;
        const h = a[2] + (b[2] - a[2]) * t + clear;
        if (h > z + 0.5 && (best === null || h < best)) best = h;
      }
      return best;
    }
    function ceilingAt(x, y, z) {
      for (const p of patches) {
        if (!p.up || x < p.x0 || y < p.y0 || x >= p.x1 || y >= p.y1) continue;
        const h = patchAt(x, y);
        return h && h[1] !== null && h[1] > z + 0.5 ? h[0] + (p.clear_m || 2.2) : null;
      }
      return ceilSegs.length ? lineCeiling(x, y, z) : null;
    }
    // is (x, y, z) inside the body of a slab over a patch, from its soffit to its top (with the camera probe's radius)?
    const upperSlabs = patches.filter(p => p.up);
    function inSlab(x, y, z) {
      for (const p of upperSlabs) {
        if (x < p.x0 || y < p.y0 || x >= p.x1 || y >= p.y1) continue;
        const h = patchAt(x, y);
        return !!h && h[1] !== null && z > h[0] + (p.clear_m || 2.2) - PROBE && z < h[1] + PROBE;
      }
      return false;
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
    // surface inside it, so that on a steep one (steps, an escalator) the cell ahead never stands above the knee;
    // and a cell another strip climbs through from below the knee (a flight of steps coming up beside a
    // footbridge's deck) has no slab of the higher one, which would stand across the top steps
    const off = [-0.475, -0.2375, 0, 0.2375, 0.475], inCell = off.flatMap(a => off.map(b => [a * DSM.cell, b * DSM.cell]));
    const climbedThrough = (s, x, y, z) => stripsAt(x, y).some(o => o !== s && inCell.some(([dx, dy]) => { const q = stripHeight(o, x + dx, y + dy); return q != null && q < z - KNEE; }));
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
          if (climbedThrough(s, x, y, z)) continue;
          const k = r * DSM.nx + c;
          for (const M of [solid0, slabs]) { if (M.addPair) { M.addPair(k, z - th, z - 0.05); continue; } const l = M.get(k); if (l) l.push(z - th, z - 0.05); else M.set(k, [z - th, z - 0.05]); } // (solid0 may be packed: navcells.js flatMap)
        }
      }
    }
    // the height of a strip (not steps laid over the ground) whose edge (x, y) is no more than m metres outside, beside its length, or null
    function stripBeside(x, y, m) {
      const seen = new Set();
      for (const [dx, dy] of [[0, 0], [m, m], [-m, m], [m, -m], [-m, -m]]) for (const s of stripsAt(x + dx, y + dy)) {
        if (seen.has(s) || s.drape || s.mapped === false) continue;
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
    // that lies on the floor is left to the floor; a flat top above it (a gate's stone base, a plinth) is
    // read in whole, and where it is FLOOR_M2 or more and reaches a cell round each of its cells (a base, a
    // porch, not an offering box, a bench or a rail) those cells are a floor (tileFloor): a walker within a
    // step of it stands on it (floorAt). Only the cells with sides or edges in them are boxes.
    // The fine cells cost seconds in a city of temples, so they are built a TILE at a time: the triangles
    // are sorted into tiles here, and a tile is laid into the collision world the first time anything
    // asks about a box that touches it (col.need), or ahead of the walker a few milliseconds a frame
    // (prefetch). Returns the 2 m cells (index -> [zlo, zhi, ...]).
    const FINE = 0.25, BAND = 3.5, GAP = 0.4, MZ = 0.1, SAMPLE = 0.22, FLAT = 0.25, TILE = 32, FLOOR_M2 = 2.0;
    const MARGIN = 1, APRON = 8; // in cells: a floor cell's margin, and the apron round a tile that it reads (2 m, so
    // that anything smaller than FLOOR_M2 across a tile's edge is seen whole)
    const FNX = DSM.nx * Math.round(DSM.cell / FINE), TPC = Math.round(TILE / FINE); // fine cells a row; and a tile's side
    // the doorways (game.json "doorways" and each door's "frames": [{a: [x, y], b: [x, y], t, z0, z1, top}]: the opening's two jambs' faces on the
    // wall's middle line, the wall's thickness, the sill, the head and the wall's top), each with its frame along and
    // across the wall; and whether a point is in one's zone, where its own boxes stand for the wall (below)
    const DOOR_EXT = 0.6, DOOR_PAD = 0.3;
    const doorways = [...(G.doorways || []), ...(G.doors || []).flatMap(d => d.frames || [])].map(d => {
      const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const t = d.t || 0.2, top = d.top ?? d.z1 + 0.5, r = len / 2 + DOOR_EXT + t / 2 + DOOR_PAD;
      return { a: d.a, ux, uy, nx: -uy, ny: ux, len, t, z0: d.z0, z1: d.z1, top, cx: d.a[0] + dx / 2, cy: d.a[1] + dy / 2, r };
    });
    const doorZone = (x, y, z) => {
      for (const d of doorways) {
        if (Math.abs(x - d.cx) > d.r || Math.abs(y - d.cy) > d.r || z < d.z0 + 0.12 || z > d.top + 0.3) continue; // (the sill and the floor stay)
        const px = x - d.a[0], py = y - d.a[1], s = px * d.ux + py * d.uy, v = px * d.nx + py * d.ny;
        if (s >= -DOOR_EXT && s <= d.len + DOOR_EXT && Math.abs(v) <= d.t / 2 + DOOR_PAD) return true;
      }
      return false;
    };
    const TNX = Math.ceil(DSM.nx * DSM.cell / TILE), TNY = Math.ceil(DSM.ny * DSM.cell / TILE);
    const tileTris = new Map(); // tile index -> [[A, B, C], ...]: the triangles (or their parts) the tile's fine cells take
    const tileDone = new Uint8Array(TNX * TNY); // 0 not built, 1 being built, 2 built
    const pool = [];
    const tileFloor = new Map(); // tile index -> the highest landmark floor within FOOT of each fine cell, lowest and highest ([2 * cell])
    let fineBoxes = 0, fineMs = 0, startMs = 0; // boxes laid so far, the time the tiles took, the time sorting took
    // the floor under a point of a landmark: the ground, a strip, a pier, or the roof of a building drawn as
    // published, solid from the ground up (a landmark on a roof: SHIBUYA SKY's deck and its channels, whose
    // fences, newels and glass stood as 2 m cells over the escalators' ends, so that no one could step on).
    // Not the surface model's roofs: they include the measured solids a landmark draws instead, the temple
    // halls' own roofs in Kyoto, which would lay whole roofs into the fine cells; nor a canopy or a building
    // over a road, which stand clear of the ground (col holds the buildings drawn by now)
    // (the buildings' prisms by the strips' 64 m cells, gathered once and only where a strip is: a roof is
    // read only by a strip, below, and building the whole collision grid twice for it cost a start 0.6 s)
    const roofs = [];
    let roofCells = null;
    const roofCellsOf = () => {
      roofCells = new Map();
      const b = [0, 0, 0, 0];
      for (let p = 0, n = col.count; p < n; p++) {
        if (col.tagOf(p) !== BUILDING) continue;
        col.boxOf(p, b);
        for (let cx = Math.floor(b[0] / SC); cx <= Math.floor(b[2] / SC); cx++) for (let cy = Math.floor(b[1] / SC); cy <= Math.floor(b[3] / SC); cy++) {
          const k = skey(cx, cy);
          if (!stripGrid.has(k)) continue;
          const l = roofCells.get(k); if (l) l.push(p); else roofCells.set(k, [p]);
        }
      }
      return roofCells;
    };
    const roofUnder = (x, y, g) => {
      roofs.length = 0;
      const l = (roofCells || roofCellsOf()).get(skey(Math.floor(x / SC), Math.floor(y / SC)));
      if (l) for (const p of l) if (col.inside(p, x, y)) roofs.push(p);
      if (!roofs.length) return g;
      roofs.sort((a, b) => col.zloOf(a) - col.zloOf(b));
      let h = g;
      for (const p of roofs) if (col.zloOf(p) <= h + 1.0 && col.zhiOf(p) > h) h = col.zhiOf(p);
      return h;
    };
    // the roof over the ground at a point, read on a 0.25 m grid and kept (the pieces by a strip and the points a
    // step round each read the same few metres over and over)
    const roofMemo = new Map();
    const roofAt = (x, y) => {
      const qx = Math.round(x * 4), qy = Math.round(y * 4), k = (qx + 4194304) * 8388608 + (qy + 4194304);
      let h = roofMemo.get(k);
      if (h === undefined) { const X = qx / 4, Y = qy / 4; h = roofUnder(X, Y, terrain(X, Y)); roofMemo.set(k, h); }
      return h;
    };
    // (only by a strip laid over a building's roof, an escalator or a stair on a roof, so that the landmarks
    // everywhere else are read as they always were)
    const roofStrip = new Map();
    const onRoof = s => {
      if (!roofStrip.has(s)) { const x = (s.box[0] + s.box[2]) / 2, y = (s.box[1] + s.box[3]) / 2, g = terrain(x, y); roofStrip.set(s, roofUnder(x, y, g) > g + 3); }
      return roofStrip.get(s);
    };
    let roofBoxes = null; // (the strips on a roof, each box EDGE + 2 m wider: none in most cities, two in Shibuya)
    const roofy = (x, y) => (roofBoxes || (roofBoxes = strips.filter(onRoof).map(s => [s.box[0] - EDGE - 2, s.box[1] - EDGE - 2, s.box[2] + EDGE + 2, s.box[3] + EDGE + 2])))
      .some(b => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
    const ref = (x, y) => {
      let h = terrain(x, y);
      if (roofy(x, y)) h = Math.max(h, roofAt(x, y));
      for (const s of stripsAt(x, y)) { const q = stripHeight(s, x, y); if (q != null && q > h) h = q; }
      const k = cellOf(x, y);
      if (k >= 0 && pierAt(k) > h) h = pierAt(k);
      return h;
    };
    // the floor a walker beside a point may stand on: the floor under it, or a strip's within a 2 m cell of it, up
    // to 3 m over that (a wall beside a raised floor, a tower's beside the loggia it flanks, is laid into fine cells
    // up to BAND over that floor, so that its 2 m cells do not come down to the head of someone on it; not a
    // bridge's deck high over the ground beside it)
    const EDGE = DSM.cell * Math.SQRT2 + 0.6;
    const refBeside = (x, y, h0, zlo = -Infinity) => {
      let h = h0;
      for (const s of stripsAt(x, y)) {
        const [u, v] = stripUV(s, x, y);
        const m = onRoof(s) ? EDGE : DSM.cell, e = onRoof(s) ? EDGE : 1.5;
        if (Math.abs(v) > s.half_width + m || u < s.us[0] - m || u > s.us[s.us.length - 1] + m) continue;
        const q = interp(s.us, s.zs, u);
        // (and whatever stands near its edge, however high it is over the ground: a balustrade, a lift's shaft
        // against a deck's end, issue 265, whose 2 m cells reached onto the deck; within 1.5 m of its outline, and
        // by a strip on a roof within EDGE, a 2 m cell's diagonal and half a wall's piece (landmarkCells), so that
        // no 2 m cell of it reaches the strip)
        const edge = Math.abs(v) <= s.half_width + e && u >= s.us[0] - e && u <= s.us[s.us.length - 1] + e;
        if (q > h && (q < h0 + 3.0 || edge)) h = q;
      }
      // (and a roof a step away, up to 12 m over the floor under it, or any roof that what is read stands on: the
      // glass, rails and coping along the edge of a deck over a channel cut into it, SHIBUYA SKY's, stand on the
      // deck, not on the channel's floor 9 m down or the street 227 m down past the facade)
      if (roofy(x, y)) for (const [dx, dy] of NEAR) {
        const q = roofAt(x + dx, y + dy);
        if (q > h && (q < h0 + 12.0 || zlo >= q - 0.5)) h = q;
      }
      return h;
    };
    const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    // a triangle's points every `step` metres at most, each passed to fn(x, y, z): rows parallel to its
    // longest edge, so that a long thin triangle (a post's side, a ridge) costs its area, not its length squared
    const seg = (P, Q, step, fn) => { const n = Math.max(1, Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]) / step));
      for (let j = 0; j <= n; j++) { const t = j / n; fn(P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t); } };
    function sample(A, B, C, step, fn, fill = true, fnIn = fn) {
      const ab = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), bc = Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]), ca = Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]);
      if (ab < bc || ab < ca) { if (bc >= ca) [A, B, C] = [B, C, A]; else [A, B, C] = [C, A, B]; } // AB the longest
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area2 = Math.hypot(nx, ny, nz);
      // a flat one (|nz| > 0.95, the top of a stone base) by its edges, and its inside, if `fill`, to fnIn
      if (area2 > 0 && Math.abs(nz) > 0.95 * area2) { seg(A, B, step, fn); seg(B, C, step, fn); seg(C, A, step, fn); if (!fill) return; fn = fnIn; }
      const L = Math.max(ab, 1e-9), h = area2 / L, rows = Math.max(1, Math.ceil(h / step)); // C's distance from AB
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        seg([A[0] + vx * t, A[1] + vy * t, A[2] + vz * t], [B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t, B[2] + (C[2] - B[2]) * t], step, fn);
      }
    }
    // the part of polygon P (points [x, y, z]) on the side of axis `ax` (0 x, 1 y, 2 z) where sign * (p[ax] - v) <= 0
    function clip(P, ax, v, sign) {
      const out = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], da = sign * (a[ax] - v), db = sign * (b[ax] - v);
        if (da <= 0) out.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    }
    const fan = Q => Q.length < 3 ? [] : Q.slice(1, -1).map((_, i) => [Q[0], Q[i + 1], Q[i + 2]]);
    const cpush = (M, k, lo, hi) => { const l = M.get(k); if (l) l.push(lo, hi); else M.set(k, [lo, hi]); };
    function landmarkCells(meshes, slabs) {
      const coarse = new Map(slabs);
      // a triangle within reach of a strip on a roof, cut into pieces no longer than 2 m (a coarse cell), each read on its own: a long
      // one is read at its middle, and the outer glass along SHIBUYA SKY's channel and its fence's top rail, their
      // middles a step too far from the escalator's head, stood as 2 m cells over the head, so no one could step on
      // (a piece is cut while its bounds come within reach of either end of a strip on a roof, where one steps on
      // and off; the rest, the deck's floor and the flights' sides, is read whole, as before)
      let ends = null;
      const endsOf = () => strips.filter(onRoof).flatMap(s => [s.us[0], s.us[s.us.length - 1]].map(u => {
        const r = s.half_width + EDGE + 2, x = s.origin[0] + s.axis[0] * u, y = s.origin[1] + s.axis[1] * u;
        return [x - r, y - r, x + r, y + r];
      }));
      const nearT = T => {
        const x0 = Math.min(T[0][0], T[1][0], T[2][0]), x1 = Math.max(T[0][0], T[1][0], T[2][0]), y0 = Math.min(T[0][1], T[1][1], T[2][1]), y1 = Math.max(T[0][1], T[1][1], T[2][1]);
        return (ends || (ends = endsOf())).some(b => x1 >= b[0] && x0 <= b[2] && y1 >= b[1] && y0 <= b[3]);
      };
      // (nor a level piece, a floor or the top of a coping: read at its middle it is where it is)
      const flat = T => Math.max(T[0][2], T[1][2], T[2][2]) - Math.min(T[0][2], T[1][2], T[2][2]) < 0.05;
      function nearStrip(P) {
        if (!nearT(P)) return [P];
        const out = [], cut = T => {
          const e = [0, 1, 2].map(i => Math.hypot(T[(i + 1) % 3][0] - T[i][0], T[(i + 1) % 3][1] - T[i][1], T[(i + 1) % 3][2] - T[i][2]));
          const i = e.indexOf(Math.max(...e));
          if (e[i] <= 2.0 || flat(T) || !nearT(T)) { out.push(T); return; }
          const a = T[i], b = T[(i + 1) % 3], c = T[(i + 2) % 3], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          cut([a, m, c]); cut([m, b, c]);
        };
        cut(P);
        return out;
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
      for (const m of meshes) {
        const p = m.position, idx = m.index, up = [], noFloor = ((D.LM.materials || {})[m.material] || {}).floor === false;
        for (let t = 0; t < idx.length; t += 3) for (const P of nearStrip([idx[t], idx[t + 1], idx[t + 2]].map(i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]))) {
          const zlo = Math.min(P[0][2], P[1][2], P[2][2]), zhi = Math.max(P[0][2], P[1][2], P[2][2]);
          const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
          const rs = [ref(cx, cy), ref(P[0][0], P[0][1]), ref(P[1][0], P[1][1]), ref(P[2][0], P[2][1])];
          const rlo = Math.min(...rs);
          // (a flat top of a strip's mesh, drawn on past its outline at its level, is a floor as the strip is: the roof
          // over Circular Quay's viaduct beyond the station's rectangle, walked on from the lookout)
          const cont = m.claim && zhi - zlo < 0.05 && !noFloor && m.claim.some(s => zlo > Math.min(...s.zs) - 0.25 && zlo < Math.max(...s.zs) + 0.25);
          const zc = cont ? Infinity : refBeside(cx, cy, Math.max(...rs), zlo) + BAND;
          if (zlo >= zc) { up.push(P); continue; }
          if (zhi < rlo + FLAT) continue; // paving on the floor
          let below = [P];
          if (zhi > zc) { below = fan(clip(P, 2, zc, 1)); for (const q of fan(clip(P, 2, zc, -1))) up.push(q); }
          // a flat top is laid in whole only within a step of the floor, where a walker may stand on it; higher
          // (a counter, a beam, a ceiling) its edges stand for it, its sides being triangles of their own
          // (a material that says "floor": false is never stood on, however wide its top: an offering box)
          const fill = cont || (zhi <= Math.max(...rs) + STEP + 0.1 && !noFloor);
          // ... but where such a top is lower than a walker's head over the floor under it (a hall's floor raised a metre
          // over its stone podium, Yasaka's), with no room under it for one, it is solid through: by its edges alone a
          // walker that came in under it (or was set down there) stood with the floor drawn through the waist (each
          // point of it is asked, as tileBuild lays it, how high it stands over the floor there: tileBuild toUnder)
          // (and a floor it is laid as, where it stands over ground more than a step down: Yasaka's Honden floor,
          // level over ground that falls 3 m under it, a floor at its high end and no room under it at its low end)
          const under = !fill, check = fill && zhi > rlo + STEP + 0.1;
          for (const T of below) { // into the tiles it touches
            if (!fill) T.edges = true;
            if (under) T.under = noFloor ? 3 : 1;
            if (check) T.check = true;
            const AP = APRON * FINE; // (with the apron a tile reads round itself)
            const c0 = Math.max(0, Math.floor((Math.min(T[0][0], T[1][0], T[2][0]) - AP - x0) / TILE)), c1 = Math.min(TNX - 1, Math.floor((Math.max(T[0][0], T[1][0], T[2][0]) + AP - x0) / TILE));
            const r0 = Math.max(0, Math.floor((y1 - Math.max(T[0][1], T[1][1], T[2][1]) - AP) / TILE)), r1 = Math.min(TNY - 1, Math.floor((y1 - Math.min(T[0][1], T[1][1], T[2][1]) + AP) / TILE));
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * TNX + c, l = tileTris.get(k); if (l) l.push(T); else tileTris.set(k, [T]); }
          }
        }
        toCoarse(up);
      }
      return coarse;
    }
    // lay one tile's fine cells into the collision world: a generator that yields now and then, so that
    // prefetch() can spread a tile over frames; need() runs it to the end
    function* tileBuild(k) {
      // the tile and an apron of APRON cells round it (which decides which of its cells are floors), as a
      // W x W grid of fine cells, each with up to IV intervals
      const tris = tileTris.get(k) || [], tc = k % TNX, tr = Math.floor(k / TNX), AP = APRON * FINE;
      const xa = x0 + tc * TILE - AP, xb = x0 + (tc + 1) * TILE + AP, yb = y1 - tr * TILE + AP, ya = y1 - (tr + 1) * TILE - AP;
      const W = TPC + 2 * APRON, cA = tc * TPC - APRON, rA = tr * TPC - APRON, IV = 4;
      // (the grids come from a pool, a set a tile being built: prefetch can leave one part-way while need() builds another)
      const B = pool.pop() || { lo: new Float32Array(W * W * IV), hi: new Float32Array(W * W * IV), cnt: new Uint8Array(W * W), wall: new Uint8Array(W * W * IV),
        ins: new Uint8Array(W * W * IV), size: new Float32Array(W * W * IV), stack: new Int32Array(W * W), fLo: new Float32Array(W * W), fHi: new Float32Array(W * W) };
      const { lo, hi, cnt, wall, ins } = B;
      cnt.fill(0);
      // wall: 1 where a side or an edge reaches the interval, 0 for the inside of a flat top alone; ins: 1 where
      // the inside of a flat top does (the floors start there)
      let anyInside = false;
      const tStrips = strips.filter(st => st.box[0] <= xb && st.box[2] >= xa && st.box[1] <= yb && st.box[3] >= ya); // (most tiles have none)
      // a fine cell's heights: intervals no closer than GAP. What lies under a walkable strip (the stone of a
      // flight of steps, the edge of the platform it climbs to) is the strip's own slab: left out
      function toFine(x, y, z, inside = false) {
        const c = Math.floor((x - x0) / FINE) - cA, r = Math.floor((y1 - y) / FINE) - rA;
        if (c < 0 || r < 0 || c >= W || r >= W || c + cA < 0 || r + rA < 0 || c + cA >= FNX) return;
        if (tStrips.length) for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null && z <= h + 0.15) return; }
        if (doorways.length && doorZone(x, y, z)) return; // (a doorway's own boxes stand there)
        const q = r * W + c, n = cnt[q], b = q * IV;
        if (inside) anyInside = true;
        for (let i = 0; i < n; i++) if (z >= lo[b + i] - GAP && z <= hi[b + i] + GAP) { if (z < lo[b + i]) lo[b + i] = z; if (z > hi[b + i]) hi[b + i] = z; if (inside) ins[b + i] = 1; else wall[b + i] = 1; return; }
        if (n < IV) { lo[b + n] = hi[b + n] = z; wall[b + n] = inside ? 0 : 1; ins[b + n] = inside ? 1 : 0; cnt[q] = n + 1; }
      }
      const toInside = (x, y, z) => toFine(x, y, z, true);
      // the inside of a flat top too high to step onto: a wall where a walker on the floor under it (the ground, a
      // strip, or a landmark's own top laid in this tile) has no room, once the tile's other triangles are in
      const unders = [];
      let underKind = 1;
      const toUnder = (x, y, z) => { unders.push(x, y, z, underKind === 3 ? 3 : 0); };
      const toCheck = (x, y, z) => { toInside(x, y, z); unders.push(x, y, z, 1); };
      let n = 0;
      for (const T of tris) {
        let Q = T; // the part of it over this tile
        if (Math.min(T[0][0], T[1][0], T[2][0]) < xa || Math.max(T[0][0], T[1][0], T[2][0]) > xb || Math.min(T[0][1], T[1][1], T[2][1]) < ya || Math.max(T[0][1], T[1][1], T[2][1]) > yb)
          Q = clip(clip(clip(clip(T, 0, xa - 0.01, -1), 0, xb + 0.01, 1), 1, ya - 0.01, -1), 1, yb + 0.01, 1);
        underKind = T.under || 0;
        for (const [A, B, C] of fan(Q)) sample(A, B, C, SAMPLE, toFine, !T.edges || !!T.under, T.under ? toUnder : T.check ? toCheck : toInside);
        if (++n % 64 === 0) yield;
      }
      // (a top too high to step onto from the ground under it is a floor all the same within a step of a strip beside
      // it: Circular Quay's roof drawn on past the end of the strip walked on it, which was laid by its edges alone)
      for (let i = 0; i < unders.length; i += 4) {
        if (unders[i + 3] !== 0) continue;
        const x = unders[i], y = unders[i + 1], z = unders[i + 2], g = ref(x, y), gb = refBeside(x, y, g, z);
        if (gb > g + 0.01 && z <= gb + STEP + 0.1) { toInside(x, y, z); unders[i + 3] = 2; }
      }
      // (a floor is a wall too only where it is more than a step over the ground under it: one steps onto it; and
      // over a lower top with no room between them, it is the lower that is walled, the soffit under Circular Quay's
      // roof, a podium under a hall's floor: no one stands there, and the floor over it is walked. A top that is no
      // floor is a wall where a walker on the ground or a top under it has no room)
      for (let i = 0; i < unders.length; i += 4) {
        const x = unders[i], y = unders[i + 1], z = unders[i + 2], kind = unders[i + 3], floor = kind === 1 || kind === 2, g = ref(x, y);
        if (floor ? kind === 1 && z > g + STEP + 0.1 && z < g + HEAD + 0.1 : z < g + HEAD + 0.1) { toFine(x, y, z); continue; }
        const c = Math.floor((x - x0) / FINE) - cA, r = Math.floor((y1 - y) / FINE) - rA;
        if (c < 0 || r < 0 || c >= W || r >= W) continue;
        const q = r * W + c, b = q * IV;
        for (let j = 0; j < cnt[q]; j++) {
          if (!(hi[b + j] < z - (floor ? STEP + 0.1 : GAP) && hi[b + j] > z - HEAD - 0.1)) continue;
          if (floor) wall[b + j] = 1; else { toFine(x, y, z); break; }
        }
      }
      unders.length = 0;
      // each cell's intervals in order of height, any that came to touch joined
      for (let q = 0; q < W * W; q++) {
        const m = cnt[q], b = q * IV;
        if (m < 2) continue;
        for (let i = 1; i < m; i++) for (let j = i; j > 0 && lo[b + j - 1] > lo[b + j]; j--) { // (insertion sort: a few at most)
          let t = lo[b + j]; lo[b + j] = lo[b + j - 1]; lo[b + j - 1] = t; t = hi[b + j]; hi[b + j] = hi[b + j - 1]; hi[b + j - 1] = t;
          t = wall[b + j]; wall[b + j] = wall[b + j - 1]; wall[b + j - 1] = t; t = ins[b + j]; ins[b + j] = ins[b + j - 1]; ins[b + j - 1] = t;
        }
        let o = 0;
        for (let i = 1; i < m; i++) if (lo[b + i] <= hi[b + o] + GAP) { if (hi[b + i] > hi[b + o]) hi[b + o] = hi[b + i]; wall[b + o] |= wall[b + i]; ins[b + o] |= ins[b + i]; } else { o++; lo[b + o] = lo[b + i]; hi[b + o] = hi[b + i]; wall[b + o] = wall[b + i]; ins[b + o] = ins[b + i]; }
        cnt[q] = o + 1;
      }
      yield;
      // the tops as areas: cells side by side whose tops are within SAME, joined; an area that runs to the
      // apron's edge, or is larger than a whole forecourt needs counting, is taken to be large
      const SAME = 0.06, topOf = (q, t) => { const b = q * IV; for (let j = 0, m = cnt[q]; j < m; j++) if (Math.abs(hi[b + j] - t) < SAME) return j; return -1; };
      const { size, stack } = B, seen = [];
      size.fill(0);
      // (only from the insides of flat tops: a floor is one of those)
      if (anyInside) for (let q0 = 0; q0 < W * W; q0++) for (let j0 = 0; j0 < cnt[q0]; j0++) {
        if (size[q0 * IV + j0] || !ins[q0 * IV + j0]) continue;
        const t = hi[q0 * IV + j0];
        let sp = 0, big = false;
        seen.length = 0;
        stack[sp++] = q0; size[q0 * IV + j0] = -1; seen.push(q0 * IV + j0);
        while (sp) {
          const q = stack[--sp], c = q % W, r = (q - c) / W;
          if (c === 0 || r === 0 || c === W - 1 || r === W - 1) big = true;
          for (let d = 0; d < 4; d++) {
            const cc = c + (d === 0) - (d === 1), rr = r + (d === 2) - (d === 3);
            if (cc < 0 || rr < 0 || cc >= W || rr >= W) continue;
            const nq = rr * W + cc, j = topOf(nq, t);
            if (j < 0 || size[nq * IV + j]) continue;
            size[nq * IV + j] = -1; seen.push(nq * IV + j); stack[sp++] = nq;
          }
        }
        const v = big ? Infinity : seen.length;
        for (const key of seen) size[key] = v;
      }
      yield;
      // a floor where its top's area is FLOOR_M2 or more and every cell within MARGIN has that top too (the
      // top reaches round it every way): its lowest and highest such top, for the tile and FOOT round it
      const minCells = FLOOR_M2 / (FINE * FINE), FR = Math.round(FOOT / FINE), fLo = B.fLo.fill(-Infinity), fHi = B.fHi.fill(-Infinity);
      if (anyInside) for (let r = APRON - FR; r < APRON + TPC + FR; r++) for (let c = APRON - FR; c < APRON + TPC + FR; c++) {
        const q = r * W + c;
        for (let i = 0, m = cnt[q]; i < m; i++) {
          const t = hi[q * IV + i];
          let floor = size[q * IV + i] >= minCells;
          for (let dr = -MARGIN; dr <= MARGIN && floor; dr++) for (let dc = -MARGIN; dc <= MARGIN && floor; dc++) if (topOf(q + dr * W + dc, t) < 0) floor = false;
          if (!floor) continue;
          if (fLo[q] === -Infinity || t < fLo[q]) fLo[q] = t;
          if (t > fHi[q]) fHi[q] = t;
        }
      }
      // ... spread over FOOT (a square: a max along the rows, then down the columns), so that a walker's
      // feet find it from where the body meets the top's edge
      let any = false;
      if (anyInside) for (let q = 0; q < W * W && !any; q++) any = fHi[q] > -Infinity;
      let grid = null;
      if (any) {
        grid = new Float32Array(TPC * TPC * 2);
        const H = TPC + 2 * FR, rowLo = new Float32Array(H * TPC), rowHi = new Float32Array(H * TPC);
        for (let r = 0; r < H; r++) for (let c = 0; c < TPC; c++) {
          const q = (r + APRON - FR) * W + c + APRON;
          let a = -Infinity, b = -Infinity;
          for (let d = -FR; d <= FR; d++) { if (fLo[q + d] > a) a = fLo[q + d]; if (fHi[q + d] > b) b = fHi[q + d]; }
          rowLo[r * TPC + c] = a; rowHi[r * TPC + c] = b;
        }
        for (let r = 0; r < TPC; r++) for (let c = 0; c < TPC; c++) {
          let a = -Infinity, b = -Infinity;
          for (let d = 0; d <= 2 * FR; d++) { const i = (r + d) * TPC + c; if (rowLo[i] > a) a = rowLo[i]; if (rowHi[i] > b) b = rowHi[i]; }
          grid[2 * (r * TPC + c)] = a; grid[2 * (r * TPC + c) + 1] = b;
        }
      }
      tileFloor.set(k, grid);
      pool.push(B);
      // the tile's own cells, each interval [lo, hi] with sides or edges in it as a box (the inside of a flat
      // top is the floor's business, not a wall's)
      const cells = new Array(W * W);
      for (let r = APRON; r < APRON + TPC; r++) for (let c = APRON; c < APRON + TPC; c++) {
        const q = r * W + c, m = cnt[q], o = [];
        for (let i = 0; i < m; i++) if (wall[q * IV + i]) o.push(lo[q * IV + i], hi[q * IV + i]);
        if (o.length) cells[q] = o;
      }
      // the cells in rectangles: runs along each row of cells whose heights agree, then runs of rows
      const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.3);
      const widen = (a, b) => a.map((v, i) => (i % 2 ? Math.max(v, b[i]) : Math.min(v, b[i])));
      let open = new Map();
      const emit = q => {
        const ea = x0 + (cA + q.c0) * FINE, eb = x0 + (cA + q.c1 + 1) * FINE, fb = y1 - (rA + q.r0) * FINE, fa = y1 - (rA + q.r1 + 1) * FINE;
        for (let i = 0; i < q.iv.length; i += 2) { col.addBox(ea, fa, eb, fb, q.iv[i] - MZ, q.iv[i + 1] + MZ, LFINE, -1); fineBoxes++; }
      };
      for (let r = APRON; r < APRON + TPC; r++) {
        const runs = [];
        for (let c = APRON; c < APRON + TPC; c++) {
          let iv = cells[r * W + c];
          if (!iv) continue;
          const c0 = c;
          while (c + 1 < APRON + TPC && cells[r * W + c + 1] && near(iv, cells[r * W + c + 1])) { iv = widen(iv, cells[r * W + c + 1]); c++; }
          runs.push({ c0, c1: c, iv });
        }
        const next = new Map();
        for (const q of runs) {
          const key = q.c0 * 65536 + q.c1, o = open.get(key);
          if (o && o.r1 === r - 1 && near(o.iv, q.iv)) { o.r1 = r; o.iv = widen(o.iv, q.iv); next.set(key, o); open.delete(key); }
          else next.set(key, Object.assign(q, { r0: r, r1: r }));
        }
        for (const o of open.values()) emit(o);
        open = next;
      }
      for (const o of open.values()) emit(o);
    }
    const building = new Map(); // tile index -> its generator, part-way through
    function runTile(k, until) {
      if (tileDone[k] === 2) return true;
      const t0 = performance.now();
      if (!tileTris.has(k)) { tileDone[k] = 2; return true; }
      let g = building.get(k);
      if (!g) { g = tileBuild(k); building.set(k, g); tileDone[k] = 1; }
      let done = false;
      while (!(done = g.next().done) && performance.now() < until);
      fineMs += performance.now() - t0;
      if (done) { building.delete(k); tileDone[k] = 2; }
      return done;
    }
    // the tiles a box touches, built now (a query far wider than a walker's, a flight's, leaves them be)
    let coarseOnly = false;
    // the highest landmark floor within FOOT of (x, y) no higher than zmax, or -Infinity
    function landmarkFloor(x, y, zmax) {
      const c = Math.floor((x - x0) / FINE), r = Math.floor((y1 - y) / FINE);
      if (c < 0 || r < 0 || c >= FNX) return -Infinity;
      const tc = Math.floor(c / TPC), tr = Math.floor(r / TPC), k = tr * TNX + tc;
      if (tc >= TNX || tr >= TNY || !tileTris.has(k)) return -Infinity;
      if (coarseOnly) return -Infinity; // (a sweep reads no fine cell, laid or not)
      if (tileDone[k] !== 2) runTile(k, Infinity);
      const g = tileFloor.get(k), i = 2 * ((r - tr * TPC) * TPC + c - tc * TPC);
      if (!g) return -Infinity;
      return g[i + 1] <= zmax ? g[i + 1] : g[i] <= zmax ? g[i] : -Infinity;
    }
    // (true for a box it lays nothing for: the query then reads none of the fine cells, laid or not, so that
    // the traffic and the crowd do the same before and after the frames' prefetch lays a landmark's tiles, #264)
    function need(xa, ya, xb, yb) {
      if (coarseOnly || xb - xa > 96 || yb - ya > 96) return true;
      const c0 = Math.max(0, Math.floor((xa - x0) / TILE)), c1 = Math.min(TNX - 1, Math.floor((xb - x0) / TILE));
      const r0 = Math.max(0, Math.floor((y1 - yb) / TILE)), r1 = Math.min(TNY - 1, Math.floor((y1 - ya) / TILE));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileDone[r * TNX + c] !== 2) runTile(r * TNX + c, Infinity);
    }
    // fn() run with the fine cells left unbuilt: a sweep over the whole city at the start (where the trees
    // and lamps may stand, which stretches of the footways and roads the crowd and the traffic keep to),
    // which away from the landmarks needs only the 2 m surface model
    function withoutFine(fn) { coarseOnly = true; const t = performance.now(); try { return fn(); } finally { coarseOnly = false; sweepMs += performance.now() - t; } }
    let sweepMs = 0; // (the time the sweeps took, for tools/game_check.js)
    // ... except where a landmark's 2 m cell says no: there its triangles near the floor (the ones its fine
    // cells are laid from) are asked whether any comes within r of (x, y) between za and zb, so that a
    // crowd's way through a gate's passage or between lanterns is not cut where a walker gets through
    // (issue #141). Laying the fine cells of every tile a sweep meets would cost a second or more at the
    // start, and even sorting their triangles into 2 m cells a fifth of one: the tile's own list is read
    // through instead (it takes the triangles within its 2 m apron too, so one tile holds all that a
    // walker's circle there can meet)
    function trisNear(x, y) {
      const c = Math.floor((x - x0) / TILE), r = Math.floor((y1 - y) / TILE);
      return c < 0 || r < 0 || c >= TNX || r >= TNY ? [] : tileTris.get(r * TNX + c) || [];
    }
    const segDist = (px, py, ax, ay, bx, by) => {
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey, t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2)) : 0;
      return Math.hypot(px - ax - ex * t, py - ay - ey * t);
    };
    function triHit(x, y, r, za, zb) {
      for (const T of trisNear(x, y)) {
        if (Math.min(T[0][2], T[1][2], T[2][2]) > zb + MZ || Math.max(T[0][2], T[1][2], T[2][2]) < za - MZ) continue;
        const rr = r + FINE;
        if (Math.min(T[0][0], T[1][0], T[2][0]) > x + rr || Math.max(T[0][0], T[1][0], T[2][0]) < x - rr ||
          Math.min(T[0][1], T[1][1], T[2][1]) > y + rr || Math.max(T[0][1], T[1][1], T[2][1]) < y - rr) continue;
        const Q = clip(clip(T, 2, zb + MZ, 1), 2, za - MZ, -1); // (its part between the two heights, with the fine cells' margin)
        if (Q.length < 3) {
          if (Q.length && Q.some(q => Math.hypot(q[0] - x, q[1] - y) < r + FINE / 2)) return true;
          continue;
        }
        let inside = false;
        for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) {
          if ((Q[i][1] > y) !== (Q[j][1] > y) && x < Q[j][0] + (y - Q[j][1]) / (Q[i][1] - Q[j][1]) * (Q[i][0] - Q[j][0])) inside = !inside;
          if (segDist(x, y, Q[i][0], Q[i][1], Q[j][0], Q[j][1]) < r + FINE / 2) return true;
        }
        if (inside) return true;
      }
      return false;
    }
    // build the tiles within `radius` of (x, y), nearest first, for at most `ms` milliseconds (the game
    // calls this every frame with the walker's or the car's place); true when they are all built
    function prefetch(x, y, radius = 48, ms = 3) {
      const until = performance.now() + ms, c0 = Math.max(0, Math.floor((x - radius - x0) / TILE)), c1 = Math.min(TNX - 1, Math.floor((x + radius - x0) / TILE));
      const r0 = Math.max(0, Math.floor((y1 - y - radius) / TILE)), r1 = Math.min(TNY - 1, Math.floor((y1 - y + radius) / TILE));
      const todo = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * TNX + c;
        if (tileDone[k] !== 2) todo.push([Math.hypot(x0 + (c + 0.5) * TILE - x, y1 - (r + 0.5) * TILE - y), k]);
      }
      todo.sort((a, b) => a[0] - b[0]);
      for (const [, k] of todo) { if (performance.now() >= until) return false; if (!runTile(k, until)) return false; }
      return true;
    }
    // every tile laid now, for a tool that wants all of them (a query over a box wider than need() lays, 96 m,
    // still meets the tiles already laid; a harness that holds the game lays the ones round you in advance(), #243)
    function layAll() { const t = performance.now(); for (const [k] of tileTris) runTile(k, Infinity); return performance.now() - t; }
    // ---------------------------------------------------------- the collision world: buildings as published, landmark cells as boxes
    const col = OECollision.create(4); // (4 m buckets: the fine landmark cells put hundreds of small boxes in one 8 m bucket)
    // the solids a landmark draws instead (scene.json hidden_solids, landmarks.json "hidden", which world.js
    // adds to them) are not walls: the landmark's own mesh is, and a measured piece wider than the drawn
    // tower round it would stand as an invisible wall in front of it (issue #91)
    const hidden = new Set((D.scene && D.scene.hidden_solids) || []);
    const shown = D.B.s.filter((s, i) => !hidden.has(i));
    for (const s of shown) col.add(s, (s[1] + s[2]) / 10, (s[1] + s[3]) / 10, BUILDING, s[0], 10, 4); // (its rings in decimetres, s[4...])
    // the posts a canopy (an arcade, a gate: pipeline/arcades.py) stands on, as buildings.js draws them
    const PH = OEBuildings.POST / 2;
    const passages = new Set((D.B.passages || []).map(i => D.B.s[i])); // (a building over a road through it stands on no posts: pipeline/road_passages.py)
    for (const s of shown) if (!passages.has(s)) for (const [x, y] of OEBuildings.canopyPosts(s, D.B.b[s[0]], D.B.no_posts && D.B.no_posts[s[0]], D.B.inner_posts && D.B.inner_posts[s[0]])) col.addBox(x - PH, y - PH, x + PH, y + PH, s[1] / 10 - 1, (s[1] + s[2]) / 10, BUILDING, s[0]);
    // a sunken promenade's flights of steps (inland.js): the wall beside each, from its foot to a railing's height over
    // its top, so that a walker on the upper treads does not step sideways off them onto the street; but for its first
    // FLIGHT_GATE m, where it opens to the pavement through the railing
    const SUNK = 4;
    if (inland && inland.flights) for (const f of inland.flights) {
      const o = f.w / 2 + 0.08, g0 = inland.FLIGHT_GATE || 0, a = [f.x + f.nx * o + f.ux * g0, f.y + f.ny * o + f.uy * g0], b = [f.x + f.nx * o + f.ux * f.run, f.y + f.ny * o + f.uy * f.run], t = [f.nx * 0.12, f.ny * 0.12];
      col.add([[a[0], a[1], b[0], b[1], b[0] + t[0], b[1] + t[1], a[0] + t[0], a[1] + t[1]]], f.zb, f.zt + 1.1, SUNK, -1);
    }
    // a doorway's jambs and head from its own frame (game.json "doorways", from a city's landmark builder, #326): the
    // fine cells are a quarter-metre grid, and a wall at an angle to it takes up to a cell more each side of a doorway
    // in it, so a narrow one lost its jambs to walkers (Williams Cottage's had to be drawn as not walls). Within
    // DOOR_EXT along the wall either side and DOOR_PAD off its faces, from the sill to the wall's top, the fine cells
    // are left out (doorZone, tileBuild); the jambs stand there instead as exact boxes on the wall's own line, its
    // thickness t, and the head over the opening from z1 to the top
    for (const d of doorways) {
      const { a, ux, uy, nx, ny, len, t, z0, z1, top } = d, h = t / 2;
      const box = (s0, s1) => { const P = (s, v) => [a[0] + ux * s + nx * v, a[1] + uy * s + ny * v]; return [[...P(s0, -h), ...P(s1, -h), ...P(s1, h), ...P(s0, h)]]; };
      col.add(box(-DOOR_EXT, 0), z0 - MZ, top, LFINE, -1);
      col.add(box(len, len + DOOR_EXT), z0 - MZ, top, LFINE, -1);
      if (top > z1) col.add(box(0, len), z1, top, LFINE, -1);
    }
    const tFine = performance.now();
    const coarse = landmarkCells(solidMeshes, slabs);
    startMs = performance.now() - tFine;
    for (const [k, l] of coarse) {
      const r = Math.floor(k / DSM.nx), c = k % DSM.nx, xa = x0 + c * DSM.cell, xb = xa + DSM.cell, yb = y1 - r * DSM.cell, ya = yb - DSM.cell;
      for (let i = 0; i < l.length; i += 2) col.addBox(xa, ya, xb, yb, l[i], l[i + 1], LANDMARK, k);
    }
    col.build();
    col.need = need; col.fineTag = LFINE;
    // buildings under a deck (or poking through it in the data) don't block a walker on the deck
    const underDeck = new Uint8Array(col.count);
    if (strips.length) for (let i = 0, n = col.count; i < n; i++) {
      if (col.tagOf(i) !== BUILDING) continue;
      col.outer(i, (ax, ay, bx, by) => { // along the edges every metre: a footprint can cross a deck with no corner on it
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let j = 0; j < m; j++) {
          const x = ax + (bx - ax) * j / m, y = ay + (by - ay) * j / m;
          if (stripsAt(x, y).some(s => stripHeight(s, x, y) != null)) return (underDeck[i] = 1);
        }
        return false;
      });
    }
    // what a walker with feet at z passes: buildings no taller than a step, and on a deck the buildings
    // under it (landmark lips below the knee are already outside the capsule's height range; on a landmark's
    // floor, raised, so is the rest of what it stands on)
    // (on a sunken promenade's floor, all of them: its walls hold the walker in, and a shed mapped across the wall's
    // line, Kyoto's w229155098 at a flight's foot, stands on the street above)
    const passes = (z, onDeck, sunk = false) => i => col.tagOf(i) === BUILDING && (sunk || col.zhiOf(i) <= z + STEP || (onDeck && underDeck[i] === 1));
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
      for (let i = 0; i < l.length; i += 2) if (l[i] < zb && l[i + 1] > za) {
        if (!coarseOnly) return true;
        return triHit(x, y, 0.1, za, zb) || col.overlap(x, y, 0.1, za, zb, j => col.tagOf(j) !== LANDMARK && col.tagOf(j) !== LFINE); // (its triangles, and the 2 m cells high up)
      }
      return false;
    }
    // the highest surface already built at (x, y), a deck strip or a pier (-Infinity for none)
    // the highest built surface at (x, y) (a pier, a strip), or with `near`, the one nearest that height (a
    // bridge's deck under the expressway's that crosses it: the Shuto over Nihonbashi)
    // (lines: for a mapped line, which is never on a strip the data knows nothing of: a station's platforms and
    // stairs, "mapped": false, built over the footways that pass under them)
    function surfaceAt(x, y, near, lines) {
      const k = cellOf(x, y);
      let h = k >= 0 && pierAt(k) > -50 ? pierAt(k) : -Infinity;
      for (const s of stripsAt(x, y)) {
        if (lines && s.mapped === false) continue;
        const z = stripHeight(s, x, y);
        if (z != null && (near == null ? z > h : Math.abs(z - near) < Math.abs(h - near))) h = z;
      }
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
    // than a step above z. Returns {z, kind} or null (water or nothing reachable). cars: a car's floor,
    // which takes the expressways' decks too (a walker's does not: decks.js gives them walk false)
    function floorAt(x, y, z, cars = false) {
      let best = null, kind = '';
      const take = (h, k) => { if (h <= z + STEP && (best === null || h > best)) { best = h; kind = k; } };
      // a sunken promenade (the Horikawa: inland.js promenade): its floor and its flights of steps at their own level,
      // and not the street's ground, which the terrain carries over the channel (raised to its banks)
      const pr = inland && inland.promenade ? inland.promenade(x, y) : null;
      if (pr) take(pr.z, 'promenade');
      else if (!offGround(x, y)) {
        const t = terrain(x, y), pv = paving.size ? paving.get(paveKey(x, y)) : undefined;
        take(t, 'ground');
        if (pv !== undefined && pv > t && pv < t + 1.5 && !cars) take(pv, 'ground'); // (paving on the ground, not on a roof; a walker's)
        const u = under(x, y); if (u !== null) take(u, 'ground');
      }
      const k = cellOf(x, y);
      if (k >= 0 && pierAt(k) > -50) take(pierAt(k), 'pier');
      for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null) take(h, s.name); }
      decksAt(x, y, (h, d) => { if ((d.walk || cars) && !(pr && pr.flight)) take(h, 'deck'); }); // (a flight of steps down, not a bridge's approach laid wider over its top)
      const bt = col.topAt(x, y, z + STEP, BUILDING);
      if (bt > -Infinity) take(bt, 'roof');
      // a landmark's floor within a step (a gate's stone base, a plinth, a platform), within FOOT: its floor
      // cells keep MARGIN inside its edge, and a walker who comes up to the edge steps onto it
      const lt = landmarkFloor(x, y, z + STEP);
      if (lt > -Infinity) take(lt, 'landmark');
      return best === null ? null : { z: best, kind };
    }
    const isDeck = kind => kind !== 'ground' && kind !== 'pier' && kind !== 'roof' && kind !== 'landmark' && kind !== 'promenade';
    // can a walker whose feet are at z stand at (x, y)? Returns the new floor or a reason.
    // (you: the player, `me`, is kept out of the bodies of strips and decks too, below; the crowd and the cars' walkers
    // are not, whose lanes the data lays under a deck's low end where a crossing meets it, and who would stand there)
    function walk(x, y, z, me = false) {
      const f = floorAt(x, y, z);
      if (!f) return { ok: false, why: offGround(x, y) || 'wall' };
      if (f.z < z - DROP) return { ok: false, why: 'drop' };
      if (nogo && f.kind !== 'pier' && nogo.data[cellOf(x, y)] > 0) return { ok: false, why: 'nogo' };
      if (keepOff && f.kind === 'ground' && keepOff(x, y)) return { ok: false, why: 'keep_off' };
      if (inland && f.kind === 'ground' && inland.water(x, y)) return { ok: false, why: 'keep_off' }; // a channel's edge, a pond's (inland.js)
      if (f.kind === 'promenade' && f.z < z - STEP) return { ok: false, why: 'wall' }; // a promenade's railings: over its walls, beside its steps
      if (OP && f.kind === 'ground') { const o = OP.at(G, x, y); if (o && OP.blocked(o, x, y)) return { ok: false, why: 'wall' }; } // (a building there, or the far land's edge)
      if (col.overlap(x, y, R, f.z + KNEE, f.z + HEAD, passes(f.z, isDeck(f.kind), f.kind === 'promenade'))) return { ok: false, why: 'wall' };
      // into the body of a strip from beside it (off the strip): its slab, from its surface down its thickness, between
      // knee and head (the 2 m cells' slabs top out at a steep strip's lowest point, so that one climbs it: SHIBUYA
      // SKY's tiers, two metres up in two, were walked into from the deck at their side, the tiers to the shoulder)
      // ... and so for a deck's (decks.js: a bridge's approach coming down to the ground, its underside a metre up
      // where walkers went in under it to the chest)
      // (not on a strip: a flight comes up through the deck it climbs to, and where the data lays a deck down across a
      // bridge's strip with no room under it, Okazaki-michi's ramp over the Shirakawa, the bridge stays walked)
      const onStrip = !(!f.kind || f.kind === 'ground' || f.kind === 'roof' || f.kind === 'landmark' || f.kind === 'pier' || f.kind === 'deck' || f.kind === 'promenade');
      if (me && !onStrip) for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null && h > f.z + KNEE && h - (s.thickness || 3) < f.z + HEAD) return { ok: false, why: 'wall' }; }
      let low = false, inside = f.kind !== 'deck', edge = false;
      decksAt(x, y, (h, d) => {
        if (me && !onStrip && h > f.z + KNEE && h - (d.th || 1) < f.z + HEAD) low = true;
        // on a deck: not in its parapet (decks.js: a wall PARAPET_W wide inside each edge), unless another deck at that
        // level carries on past it (a dual carriageway's two lines, whose parapets are not drawn where they meet)
        if (f.kind === 'deck' && Math.abs(h - f.z) < 0.6) {
          const ex = (d.bx - d.ax) / d.L, ey = (d.by - d.ay) / d.L, v = Math.abs(-(x - d.ax) * ey + (y - d.ay) * ex);
          if (v <= d.hw - (d.par || 0) - 0.1) inside = true; else if (d.par) edge = true;
        }
      });
      if (low || (edge && !inside)) return { ok: false, why: 'wall' };
      if (coarseOnly && solidCell(cellOf(x, y), f.z + KNEE, f.z + HEAD) && triHit(x, y, R, f.z + KNEE, f.z + HEAD)) return { ok: false, why: 'wall' }; // (a landmark's 2 m cell, and then its triangles, withoutFine)
      return { ok: true, z: f.z, kind: f.kind };
    }
    // is a strip's or a deck's slab in the body of someone whose feet are at z at (x, y), between knee and head? (as
    // walk keeps you out of: for a line the crowd walks at its own height, game.js crowdNet, #399)
    function bodyIn(x, y, z) {
      for (const s of stripsAt(x, y)) { const h = stripHeight(s, x, y); if (h != null && h > z + KNEE && h - (s.thickness || 3) < z + HEAD) return true; }
      let low = false;
      decksAt(x, y, (h, d) => { if (h > z + KNEE && h - (d.th || 1) < z + HEAD) low = true; });
      return low;
    }
    // move a walker whose feet are at z by (dx, dy), sliding along walls and round the cars
    // in `movers` (the traffic, which sets it) and the lamp posts and trunks in `posts`
    // (streets.js, which game.js sets): {x, y, hit}
    function slide(x, y, z, dx, dy) {
      const f = floorAt(x, y, z), skip = passes(z, !!f && isDeck(f.kind), !!f && f.kind === 'promenade');
      if (f && f.kind === 'landmark' && f.z > z) z = f.z; // stepping up onto a landmark's floor: the body clears its edge
      const m = col.slide(x, y, dx, dy, R, z + KNEE, z + HEAD, skip);
      let o = m;
      if (api.movers) o = api.movers.pushOut(o.x, o.y, R, z); // (the cars on this level)
      if (api.posts && !(f && f.kind === 'promenade')) o = api.posts.pushOut(o.x, o.y, R, z); // (none stand in a sunken promenade: the street's over it)
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
      if (coarseOnly && solidCell(k, fz + KNEE, fz + HEAD) && triHit(x, y, r, fz + KNEE, fz + HEAD)) return true; // (a landmark's 2 m cell, and then its triangles, withoutFine)
      return col.overlap(x, y, r, fz + KNEE, fz + HEAD, passes(fz, !!f && isDeck(f.kind), !!f && f.kind === 'promenade'));
    }
    function solidCell(k, za, zb) { const l = solid0.get(k); if (!l) return false; for (let i = 0; i < l.length; i += 2) if (l[i] < zb && l[i + 1] > za) return true; return false; }
    // push a circle of radius r whose bottom is at z out of the walls it overlaps, between knee
    // height and z + top (a car's body: kerbs and low walls are the floor's business): {x, y}
    function push(x, y, z, r, top = HEAD) {
      const f = floorAt(x, y, z);
      if (f && f.kind === 'landmark' && f.z > z) z = f.z;
      return col.depenetrate(x, y, r, z + KNEE, z + top, passes(z, !!f && isDeck(f.kind), !!f && f.kind === 'promenade'));
    }
    // lowest height a flying or floating body may occupy at (x, y): what is directly below
    function groundBelow(x, y, z) {
      let g = isWater(x, y) ? 0 : Math.max(0, terrain(x, y));
      const u = under(x, y);
      if (u !== null && g > z + 0.5) g = Math.max(0, u); // under a slab
      const bt = col.topAt(x, y, Infinity, BUILDING);
      if (bt > g) g = bt;
      const k = cellOf(x, y);
      if (k >= 0 && pierAt(k) > g) g = pierAt(k);
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
    // the camera alone stops at these: the landmark faces whose material is "camera" but not solid, such
    // as the soffit of a slab walked under on a patch (Sydney's Lower Concourse colonnade), which the
    // collision world leaves to the patch; as triangles [ax, ay, az, e1, e2, bounds] in local metres
    const camTris = [];
    for (const m of D.LM.meshes || []) {
      const mat = (D.LM.materials || {})[m.material] || {};
      if (!mat.camera || mat.solid !== false) continue;
      const p = m.position, idx = m.index;
      for (let t = 0; t < idx.length; t += 3) {
        const v = [idx[t], idx[t + 1], idx[t + 2]].map(i => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
        const lo = [0, 1, 2].map(k => Math.min(v[0][k], v[1][k], v[2][k]) - PROBE), hi = [0, 1, 2].map(k => Math.max(v[0][k], v[1][k], v[2][k]) + PROBE);
        camTris.push([v[0], [0, 1, 2].map(k => v[1][k] - v[0][k]), [0, 1, 2].map(k => v[2][k] - v[0][k]), lo, hi]);
      }
    }
    // the fraction of the segment (local x, y, z) a -> b before the probe meets one of camTris, or 1
    function camHit(ax, ay, az, bx, by, bz) {
      const d = [bx - ax, by - ay, bz - az], len = Math.hypot(d[0], d[1], d[2]) || 1;
      const lo = [Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz)], hi = [Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz)];
      let f = 1;
      for (const [o, e1, e2, tl, th] of camTris) {
        if (hi[0] < tl[0] || lo[0] > th[0] || hi[1] < tl[1] || lo[1] > th[1] || hi[2] < tl[2] || lo[2] > th[2]) continue;
        const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0]; // Moller-Trumbore
        const det = e1[0] * px + e1[1] * py + e1[2] * pz;
        if (Math.abs(det) < 1e-9) continue;
        const sx = ax - o[0], sy = ay - o[1], sz = az - o[2], u = (sx * px + sy * py + sz * pz) / det;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0];
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det, t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) / det;
        if (v < 0 || u + v > 1 || t < 0 || t > 1) continue;
        f = Math.min(f, Math.max(0, t - PROBE / len));
      }
      return f;
    }
    // how far along the segment a -> b (three.js world coordinates) the camera probe gets
    // before touching a building, a landmark or a deck's slab: a fraction 0..1, or 1 when clear
    function clearFraction(a, b) {
      const f = Math.min(col.sweepSphere(a.x, -a.z, a.y, b.x, -b.z, b.y, PROBE), camTris.length ? camHit(a.x, -a.z, a.y, b.x, -b.z, b.y) : 1);
      if (!decks.length && !upperSlabs.length) return f;
      // a deck's slab, and the body of a slab over a city's fine walking level (a patch's "upper": from its
      // soffit, clear_m over the floor, to its top), which a gap in the meshes drawn round it (a
      // stairwell's opening) would otherwise let the camera into
      const n = Math.ceil(f * a.distanceTo(b) / 0.25);
      for (let i = 1; i <= n; i++) {
        const t = f * i / n, x = a.x + (b.x - a.x) * t, y = -(a.z + (b.z - a.z) * t), z = a.y + (b.y - a.y) * t;
        let hit = false;
        if (decks.length) decksAt(x, y, (h, d) => { if (z > h - d.th - PROBE && z < h + PROBE) hit = true; });
        if (!hit && upperSlabs.length) hit = inSlab(x, y, z);
        if (hit) return f * (i - 1) / n;
      }
      return f;
    }
    const api = { under, terrainBelow, ceilingAt, approaches, stripBeside, isWater, onShore, offGround, surfaceAt, addDecks, decksAt, floorAt, walk, bodyIn, stand, slide, solid, push, groundBelow, free, room, isDeck, clearFraction, buildingTop, buildingId, landmarkHit, strips, stripUV, stripHeight, terrain, passageFloor, inland, passages: (D.LM && D.LM.passages) || [], tops, col, get fineBoxes() { return fineBoxes; }, get fineMs() { return fineMs; }, get startMs() { return startMs; }, get sweepMs() { return sweepMs; }, get tiles() { let n = 0; for (const [k] of tileTris) if (tileDone[k] === 2) n++; return [n, tileTris.size]; }, prefetch, layAll, withoutFine, STEP, DROP, R, BUILDING, LANDMARK, LFINE, movers: null, posts: null };
    return api;
  }
  return { create };
})();
