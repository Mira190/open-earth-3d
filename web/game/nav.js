// Where things can stand, walk, sail and fly, from the same data the model is built
// from: the 2 m surface model (terrain + buildings, with building ids), the 5 m water
// mask, pier decks, walkable surfaces such as a bridge deck (game.json "surfaces"),
// and the parametric landmarks, rasterised as height intervals so that a helicopter
// can pass under the Harbour Bridge deck but not through its steel. Walls, roofs and the
// camera use the exact building footprints through collision.js; the 2 m grids decide
// water, piers and decks.
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
    const G = D.G, T = D.T;
    // ---------------------------------------------------------- water (5 m, packed bits)
    const wm = G.water, bytes = Uint8Array.from(atob(wm.bits), c => c.charCodeAt(0));
    const isWaterCell = (r, c) => (bytes[(r * wm.nx + c) >> 3] >> (7 - ((r * wm.nx + c) & 7))) & 1;
    const x0 = DSM.x0, y1 = DSM.y1;
    function isWater(x, y) {
      const c = Math.floor((x - x0) / wm.cell), r = Math.floor((y1 - y) / wm.cell);
      if (r < 0 || c < 0 || r >= wm.ny || c >= wm.nx) return true; // outside the model: open water or edge
      return !!isWaterCell(r, c);
    }
    // ---------------------------------------------------------- piers (2 m grid, deck height)
    const pier = { nx: DSM.nx, ny: DSM.ny, cell: DSM.cell, x0, y1, data: new Float32Array(DSM.nx * DSM.ny).fill(-99) };
    for (const r of D.P.piers || []) S.fillMax(pier, [r.map(v => v / 10)], G.pier_deck_m || 2.2);
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
    const solid = new Map(); // cell index -> [zmin, zmax, zmin, zmax, ...]
    const tops = {};         // mesh name -> Map(cell index -> top), for shading the surface model
    for (const m of D.LM.meshes || []) {
      if (strips.some(st => st.mesh && m.name.startsWith(st.mesh))) continue; // walked on as a strip surface; its slab is added below
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
      for (const [k, q] of mine) { const l = solid.get(k); if (l) l.push(q[0] - 0.3, q[1] + 0.3); else solid.set(k, [q[0] - 0.3, q[1] + 0.3]); }
    }
    for (const s of strips) { // slabs: solid from (surface - thickness) to the surface
      const th = s.thickness || 3;
      for (let r = 0; r < DSM.ny; r++) {
        const y = y1 - (r + 0.5) * DSM.cell;
        for (let c = 0; c < DSM.nx; c++) {
          const x = x0 + (c + 0.5) * DSM.cell;
          if (Math.abs((x - s.origin[0]) * s.axis[0] + (y - s.origin[1]) * s.axis[1]) > 1000) continue;
          const z = stripHeight(s, x, y);
          if (z == null) continue;
          const k = r * DSM.nx + c, l = solid.get(k);
          if (l) l.push(z - th, z - 0.05); else solid.set(k, [z - th, z - 0.05]);
        }
      }
    }
    const cellOf = (x, y) => {
      const c = Math.floor((x - x0) / DSM.cell), r = Math.floor((y1 - y) / DSM.cell);
      return c < 0 || r < 0 || c >= DSM.nx || r >= DSM.ny ? -1 : r * DSM.nx + c;
    };
    // the ground under a walker: bilinear over the land corners only, so a quay or a river walk
    // keeps its own height instead of sagging towards the modelled bottom beside it
    const landOnly = wm.nx === T.nx && wm.ny === T.ny;
    function terrain(x, y) {
      if (!landOnly) return S.terrainAt(T, x, y);
      const c = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.cell)), r = Math.max(0, Math.min(T.ny - 1.001, (T.y1 - y) / T.cell));
      const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * T.nx + c0, D = T.data;
      let s = 0, w = 0, k;
      if ((k = (1 - fc) * (1 - fr)) > 0 && !isWaterCell(r0, c0)) { s += D[i] * k; w += k; }
      if ((k = fc * (1 - fr)) > 0 && !isWaterCell(r0, c0 + 1)) { s += D[i + 1] * k; w += k; }
      if ((k = (1 - fc) * fr) > 0 && !isWaterCell(r0 + 1, c0)) { s += D[i + T.nx] * k; w += k; }
      if ((k = fc * fr) > 0 && !isWaterCell(r0 + 1, c0 + 1)) { s += D[i + T.nx + 1] * k; w += k; }
      return w > 1e-6 ? s / w : S.terrainAt(T, x, y);
    }
    // ---------------------------------------------------------- the collision world: buildings as published, landmark cells as boxes
    const col = OECollision.create();
    for (const s of D.B.s) col.add(s.slice(4).map(r => r.map(v => v / 10)), (s[1] + s[2]) / 10, (s[1] + s[3]) / 10, BUILDING, s[0]);
    for (const [k, l] of solid) {
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
          if (strips.some(s => stripHeight(s, x, y) != null)) underDeck[i] = 1;
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
      const l = solid.get(cellOf(x, y));
      if (!l) return false;
      for (let i = 0; i < l.length; i += 2) if (l[i] < zb && l[i + 1] > za) return true;
      return false;
    }
    // the floor a walker at height z would stand on at (x, y): the highest surface no more
    // than a step above z. Returns {z, kind} or null (water or nothing reachable).
    function floorAt(x, y, z) {
      let best = null, kind = '';
      const take = (h, k) => { if (h <= z + STEP && (best === null || h > best)) { best = h; kind = k; } };
      if (!isWater(x, y)) take(terrain(x, y), 'ground');
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > -50) take(pier.data[k], 'pier');
      for (const s of strips) { const h = stripHeight(s, x, y); if (h != null) take(h, s.name); }
      const bt = col.topAt(x, y, z + STEP, BUILDING);
      if (bt > -Infinity) take(bt, 'roof');
      return best === null ? null : { z: best, kind };
    }
    const isDeck = kind => kind !== 'ground' && kind !== 'pier' && kind !== 'roof';
    // can a walker whose feet are at z stand at (x, y)? Returns the new floor or a reason.
    function walk(x, y, z) {
      const f = floorAt(x, y, z);
      if (!f) return { ok: false, why: isWater(x, y) ? 'water' : 'wall' };
      if (f.z < z - DROP) return { ok: false, why: 'drop' };
      if (nogo && f.kind !== 'pier' && nogo.data[cellOf(x, y)] > 0) return { ok: false, why: 'nogo' };
      if (col.overlap(x, y, R, f.z + KNEE, f.z + HEAD, passes(f.z, isDeck(f.kind)))) return { ok: false, why: 'wall' };
      return { ok: true, z: f.z, kind: f.kind };
    }
    // move a walker whose feet are at z by (dx, dy), sliding along walls and round the cars
    // in `movers` (the traffic, which sets it): {x, y, hit}
    function slide(x, y, z, dx, dy) {
      const f = floorAt(x, y, z), skip = passes(z, !!f && isDeck(f.kind));
      const m = col.slide(x, y, dx, dy, R, z + KNEE, z + HEAD, skip);
      if (!api.movers) return m;
      const o = api.movers.pushOut(m.x, m.y, R);
      if (o.x === m.x && o.y === m.y) return m;
      // pushed out of a car's side: keep that, unless it puts the walker in a wall
      if (!col.overlap(o.x, o.y, R, z + KNEE, z + HEAD, skip)) return { x: o.x, y: o.y, hit: m.hit };
      return { x, y, hit: m.hit };
    }
    // lowest height a flying or floating body may occupy at (x, y): what is directly below
    function groundBelow(x, y, z) {
      let g = isWater(x, y) ? 0 : Math.max(0, terrain(x, y));
      const bt = col.topAt(x, y, Infinity, BUILDING);
      if (bt > g) g = bt;
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > g) g = pier.data[k];
      for (const s of strips) { const h = stripHeight(s, x, y); if (h != null && h <= z + 0.5 && h > g) g = h; }
      const l = solid.get(k);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i + 1] <= z + 0.5 && l[i + 1] > g) g = l[i + 1];
      return g;
    }
    // is a circle of radius r around (x, y) between za and zb free of buildings and landmark solids?
    function free(x, y, za, zb, r = 2) { return !col.overlap(x, y, r, za, zb); }
    // how far along the segment a -> b (three.js world coordinates) the camera probe gets
    // before touching a building or landmark: a fraction 0..1, or 1 when clear
    function clearFraction(a, b) { return col.sweepSphere(a.x, -a.z, a.y, b.x, -b.z, b.y, PROBE); }
    const api = { isWater, floorAt, walk, slide, groundBelow, free, clearFraction, buildingTop, buildingId, landmarkHit, strips, stripUV, stripHeight, terrain, tops, col, STEP, movers: null };
    return api;
  }
  return { create };
})();
