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
    const solid = new Map(); // cell index -> [zmin, zmax, zmin, zmax, ...]
    const tops = {};         // mesh name -> Map(cell index -> top), for shading the surface model
    for (const m of D.LM.meshes || []) {
      if (strips.some(st => st.mesh && m.name.startsWith(st.mesh))) continue; // walked on as a strip surface; its slab is added below
      if (((D.LM.materials || {})[m.material] || {}).decal) continue; // paving laid over a roof, which is the solid
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
    for (const s of strips) { // slabs: solid from (surface - thickness) to the surface's lowest point in the cell (a stair climbs a few risers across one)
      const th = s.thickness || 3, h = DSM.cell / 2;
      for (let r = 0; r < DSM.ny; r++) {
        const y = y1 - (r + 0.5) * DSM.cell;
        for (let c = 0; c < DSM.nx; c++) {
          const x = x0 + (c + 0.5) * DSM.cell;
          if (Math.abs((x - s.origin[0]) * s.axis[0] + (y - s.origin[1]) * s.axis[1]) > 1000) continue;
          if (stripHeight(s, x, y) == null) continue;
          let z = Infinity;
          for (const [dx, dy] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) { const q = stripHeight(s, x + dx, y + dy); if (q != null && q < z) z = q; }
          const k = r * DSM.nx + c, l = solid.get(k);
          if (l) l.push(z - th, z - 0.05); else solid.set(k, [z - th, z - 0.05]);
        }
      }
    }
    const cellOf = (x, y) => {
      const c = Math.floor((x - x0) / DSM.cell), r = Math.floor((y1 - y) / DSM.cell);
      return c < 0 || r < 0 || c >= DSM.nx || r >= DSM.ny ? -1 : r * DSM.nx + c;
    };
    // the ground under a walker is the ground that is drawn: the terrain tiles are a grid of
    // cells, each split from its south-west to its north-east corner (three.js PlaneGeometry),
    // so the walker stands on the same two triangles, never above or below them
    let tri = 0; // the last cell's triangle: its slope, rise over run
    function terrain(x, y) {
      const c = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.cell)), r = Math.max(0, Math.min(T.ny - 1.001, (T.y1 - y) / T.cell));
      const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * T.nx + c0, D = T.data;
      const a = D[i], b = D[i + 1], d = D[i + T.nx], e = D[i + T.nx + 1];
      if (fc + fr <= 1) { tri = Math.hypot(b - a, d - a) / T.cell; return a + fc * (b - a) + fr * (d - a); }
      tri = Math.hypot(e - d, e - b) / T.cell;
      return e + (1 - fc) * (d - e) + (1 - fr) * (b - e);
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
    // the highest surface already built at (x, y), a deck strip or a pier (-Infinity for none)
    function surfaceAt(x, y) {
      const k = cellOf(x, y);
      let h = k >= 0 && pier.data[k] > -50 ? pier.data[k] : -Infinity;
      for (const s of strips) { const z = stripHeight(s, x, y); if (z != null && z > h) h = z; }
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
      if (!offGround(x, y)) take(terrain(x, y), 'ground');
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > -50) take(pier.data[k], 'pier');
      for (const s of strips) { const h = stripHeight(s, x, y); if (h != null) take(h, s.name); }
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
    // move a walker whose feet are at z by (dx, dy), sliding along walls: {x, y, hit}
    function slide(x, y, z, dx, dy) {
      const f = floorAt(x, y, z);
      return col.slide(x, y, dx, dy, R, z + KNEE, z + HEAD, passes(z, !!f && isDeck(f.kind)));
    }
    // push a circle of radius r whose bottom is at z out of the walls it overlaps, between knee
    // height and z + top (a car's body: kerbs and low walls are the floor's business): {x, y}
    function push(x, y, z, r, top = HEAD) {
      const f = floorAt(x, y, z);
      return col.depenetrate(x, y, r, z + KNEE, z + top, passes(z, !!f && isDeck(f.kind)));
    }
    // lowest height a flying or floating body may occupy at (x, y): what is directly below
    function groundBelow(x, y, z) {
      let g = isWater(x, y) ? 0 : Math.max(0, terrain(x, y));
      const bt = col.topAt(x, y, Infinity, BUILDING);
      if (bt > g) g = bt;
      const k = cellOf(x, y);
      if (k >= 0 && pier.data[k] > g) g = pier.data[k];
      for (const s of strips) { const h = stripHeight(s, x, y); if (h != null && h <= z + 0.5 && h > g) g = h; }
      decksAt(x, y, h => { if (h <= z + 0.5 && h > g) g = h; });
      const l = solid.get(k);
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
    return { isWater, onShore, offGround, surfaceAt, addDecks, decksAt, floorAt, walk, stand, slide, push, groundBelow, free, clearFraction, buildingTop, buildingId, landmarkHit, strips, stripUV, stripHeight, terrain, tops, col, STEP };
  }
  return { create };
})();
