// Where things can stand, walk, sail and fly, from the same data the model is built
// from: the 2 m surface model (terrain + buildings, with building ids), the 5 m water
// mask, pier decks, walkable surfaces such as a bridge deck (game.json "surfaces"),
// and the parametric landmarks, rasterised as height intervals so that a helicopter
// can pass under the Harbour Bridge deck but not through its steel.
'use strict';
window.OENav = (function () {
  const S = window.Sun;
  const STEP = 0.75;     // highest step a walker takes without jumping (m)
  const DROP = 4.0;      // highest drop a walker steps off (railings everywhere else)

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
    // ---------------------------------------------------------- strip surfaces (bridge decks)
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
      if (m.name === 'bridge_deck') continue; // the deck is the strip surface; its slab is added below
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
    for (const s of strips) { // deck slabs: solid from (surface - thickness) to the surface
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
    const terrain = (x, y) => S.terrainAt(T, x, y);
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
      const bt = buildingTop(x, y);
      if (bt > -Infinity) take(bt, 'roof');
      return best === null ? null : { z: best, kind };
    }
    const R = 0.35, OFFS = [[R, 0], [-R, 0], [0, R], [0, -R]];
    // can a walker whose feet are at z move to (x, y)? Returns the new floor or a reason.
    function walk(x, y, z) {
      const f = floorAt(x, y, z);
      if (!f) return { ok: false, why: isWater(x, y) ? 'water' : 'wall' };
      if (f.z < z - DROP) return { ok: false, why: 'drop' };
      const onDeck = f.kind !== 'ground' && f.kind !== 'pier' && f.kind !== 'roof';
      for (const [dx, dy] of OFFS) {
        const bt = buildingTop(x + dx, y + dy);
        // on a bridge deck, buildings under the viaduct (or poking through it in the data) don't block
        if (bt > f.z + STEP && !(onDeck && strips.some(s => stripHeight(s, x + dx, y + dy) != null))) return { ok: false, why: 'wall' };
        if (landmarkHit(x + dx, y + dy, f.z + 0.4, f.z + 1.8)) return { ok: false, why: 'wall' };
      }
      return { ok: true, z: f.z, kind: f.kind };
    }
    // lowest height a flying or floating body may occupy at (x, y): what is directly below
    function groundBelow(x, y, z) {
      let g = isWater(x, y) ? 0 : Math.max(0, terrain(x, y));
      const bt = buildingTop(x, y);
      if (bt > g) g = bt;
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > g) g = pier.data[k];
      for (const s of strips) { const h = stripHeight(s, x, y); if (h != null && h <= z + 0.5 && h > g) g = h; }
      const l = solid.get(k);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i + 1] <= z + 0.5 && l[i + 1] > g) g = l[i + 1];
      return g;
    }
    // is a box of half-size r around (x, y) between za and zb free of buildings and landmark solids?
    function free(x, y, za, zb, r = 2) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (buildingTop(x + dx, y + dy) > za) return false;
        if (landmarkHit(x + dx, y + dy, za, zb)) return false;
      }
      return true;
    }
    // first point on the segment a -> b (three.js world coordinates) blocked by a building:
    // a fraction 0..1 of the way, or 1 when clear (for keeping the camera out of walls)
    function clearFraction(a, b) {
      const L = a.distanceTo(b), n = Math.max(2, Math.ceil(L / 1.5));
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = a.x + (b.x - a.x) * t, y = -(a.z + (b.z - a.z) * t), z = a.y + (b.y - a.y) * t;
        if (buildingTop(x, y) > z - 0.4 || landmarkHit(x, y, z - 0.6, z + 0.6)) return Math.max(0, (i - 1) / n);
      }
      return 1;
    }
    return { isWater, floorAt, walk, groundBelow, free, clearFraction, buildingTop, buildingId, landmarkHit, strips, stripUV, stripHeight, terrain, tops, STEP };
  }
  return { create };
})();
