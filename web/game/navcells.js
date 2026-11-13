// Open Earth 3D: the landmarks' meshes laid on the walking model's 2 m grid (nav.js): the height intervals each
// solid mesh fills in each cell, each mesh's tops (which shade the surface model), and the paving a city drapes over
// its ground at half a metre. Twenty million points sampled on the landmarks' triangles in Kyoto and Sydney, a second
// of the loader's main thread (issue 344), so it runs in the Worker that decoded landmarks.bin and kept it
// (pack-worker.js), its Maps sent back as typed arrays (pack, unpack); nav.js makes it itself where there is none.
// Works in a page (window.OENavCells), a Worker (self) and Node (require).
'use strict';
(function (root) {
  const PAVE = 0.5, paveKey = (x, y) => (Math.floor(x / PAVE) + 32768) * 65536 + Math.floor(y / PAVE) + 32768;
  // a strip's frame: u along its axis from its origin, v to its left
  function stripUV(s, x, y) {
    const dx = x - s.origin[0], dy = y - s.origin[1];
    return [dx * s.axis[0] + dy * s.axis[1], -dx * s.axis[1] + dy * s.axis[0]];
  }
  // the part of a mesh that lies outside the outlines of the strips that claim it (each strip's u range by its
  // half width, in its own frame, and M more: a flight's stones a hand past its strip's side are the strip's still,
  // a lip stepped over, not a wall across a path that crosses the flight's corner): a mesh of those triangles, or null
  function beyondStrips(m, claim) {
    const p = m.position, idx = m.index, pos = [];
    const cut = (P, ax, v, sign) => { // the part of polygon P (local [u, v, z]) where sign * (P[ax] - v) <= 0
      const out = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], da = sign * (a[ax] - v), db = sign * (b[ax] - v);
        if (da <= 0) out.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    };
    for (let t = 0; t < idx.length; t += 3) {
      let parts = [[idx[t], idx[t + 1], idx[t + 2]].map(i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]])];
      for (const s of claim) {
        const [ox, oy] = s.origin, [ax, ay] = s.axis, M = 0.6, u0 = s.us[0] - M, u1 = s.us[s.us.length - 1] + M, hw = s.half_width + M, next = [];
        for (const W of parts) {
          let rest = W.map(q => [...stripUV(s, q[0], q[1]), q[2]]);
          const outs = [cut(rest, 0, u0, 1)]; rest = cut(rest, 0, u0, -1);
          outs.push(cut(rest, 0, u1, -1)); rest = cut(rest, 0, u1, 1);
          outs.push(cut(rest, 1, -hw, 1)); rest = cut(rest, 1, -hw, -1);
          outs.push(cut(rest, 1, hw, -1));
          for (const o of outs) if (o.length >= 3) next.push(o.map(([u, v, z]) => [ox + u * ax - v * ay, oy + u * ay + v * ax, z]));
        }
        parts = next;
      }
      for (const Q of parts) for (let i = 1; i < Q.length - 1; i++) {
        const A = Q[0], B = Q[i], C = Q[i + 1];
        const cx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (Math.hypot(cx, cy, cz) > 0.02) pos.push(...A, ...B, ...C); // (not a sliver along the outline)
      }
    }
    if (!pos.length) return null;
    return Object.assign({}, m, { position: new Float32Array(pos), index: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), claim });
  }

  // LM: landmarks.json as decoded; strips: game.json's strip surfaces with their profiles' us and zs (nav.js);
  // DSM: the grid ({ nx, ny, cell, x0, y1 }). Returns { solid0, tops, solidMeshes, solidAt, paving }
  function raster(LM, strips, DSM) {
    const x0 = DSM.x0, y1 = DSM.y1;
    // ---------------------------------------------------------- landmark solids as height intervals per 2 m cell
    const solid0 = new Map(); // cell index -> [zmin, zmax, zmin, zmax, ...]
    const tops = {};         // mesh name -> Map(cell index -> top), for shading the surface model
    const solidMeshes = [];  // the meshes that are solid, for the collision world's finer cells (nav.js)
    const solidAt = [];      // (their places in LM.meshes)
    // the paving a city drapes over its ground (a decal material: the setts of Kyoto's lanes, laid on the survey's
    // 1 m ground, which the game's 5 m ground runs under by up to a metre where a lane is cut into the slope): its
    // highest point in each PAVE cell, which floorAt stands a walker on, not on the ground hidden under it
    const paving = new Map();
    function pave(m) {
      const p = m.position, idx = m.index;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const e = Math.max(Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]), Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1]), Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1]));
        const n = Math.max(1, Math.ceil(e / (PAVE * 0.7)));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v, k = paveKey(p[a] * w + p[b] * u + p[c] * v, p[a + 1] * w + p[b + 1] * u + p[c + 1] * v);
          const z = p[a + 2] * w + p[b + 2] * u + p[c + 2] * v, q = paving.get(k);
          if (q === undefined || z > q) paving.set(k, z);
        }
      }
    }
    const meshes = LM.meshes || [];
    for (let mi = 0; mi < meshes.length; mi++) {
      let m = meshes[mi];
      const mat = (LM.materials || {})[m.material] || {};
      // walked on as a strip surface; its slab is added below. What stands on the strip's edge as a wall stays one
      // (issue 265: a deck's glass balustrade, named for the deck, let walkers through it), though it carries the
      // strip's name: glass, a balustrade, a railing or a barrier
      const barrier = mat.opacity < 1 || /glass|balustrade|railing|barrier|_rail(_|$)/.test(m.name); // (and a flight's handrail: Suga Shrine's suga_otoko_rail_red)
      // ... but only within the strip's own outline: what the mesh draws beyond it (Circular Quay Station's roof, drawn
      // over the whole viaduct, its strip the station's rectangle) is stood on and walled as any landmark's, or a walker
      // there fell through it to whatever lay under it (its soffit, a metre down) and sank to the waist in what is drawn
      const claim = strips.filter(st => st.mesh && m.name.startsWith(st.mesh) && (m.name === st.mesh || !barrier));
      if (claim.length && !(m = beyondStrips(m, claim))) continue;
      if (mat.decal) { pave(m); continue; } // paving laid over a roof, which is the solid (or on the ground: floorAt)
      if (mat.pave) pave(m); // (and what a city lays on the ground to be walked on as drawn, solid or not: Kamakura's revetment)
      if (mat.solid === false) continue; // walls a city's fine walking levels hold walkers back at instead (game.json "patches")
      solidMeshes.push(m);
      solidAt.push(mi);
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
    return { solid0, tops, solidMeshes, solidAt, paving };
  }

  // raster()'s result as typed arrays a Worker hands over, and back: the meshes cut by a strip travel as their
  // vertices and the strips' places; the others are found again in the page's own LM.meshes
  function pack(R, strips) {
    const flat = M => { // Map(number -> number or [numbers]) as keys, offsets and values
      const keys = new Float64Array(M.size), off = new Int32Array(M.size + 1), vals = [];
      let i = 0;
      for (const [k, v] of M) { keys[i] = k; if (Array.isArray(v)) vals.push(...v); else vals.push(v); off[++i] = vals.length; }
      return { keys, off, vals: Float64Array.from(vals) };
    };
    return { solid0: flat(R.solid0), paving: flat(R.paving), tops: Object.entries(R.tops).map(([name, M]) => [name, flat(M)]),
      solid: R.solidMeshes.map((m, i) => ({ at: R.solidAt[i], cut: m.claim ? { position: m.position, index: m.index, claim: m.claim.map(s => strips.indexOf(s)) } : null })) };
  }
  function unpack(P, LM, strips) {
    const map = (F, list) => {
      const M = new Map(), { keys, off, vals } = F;
      for (let i = 0; i < keys.length; i++) M.set(keys[i], list ? Array.from(vals.subarray(off[i], off[i + 1])) : vals[off[i]]);
      return M;
    };
    const tops = {};
    for (const [name, F] of P.tops) tops[name] = map(F, false);
    const solidMeshes = P.solid.map(s => s.cut ? Object.assign({}, LM.meshes[s.at], { position: s.cut.position, index: s.cut.index, claim: s.cut.claim.map(j => strips[j]) }) : LM.meshes[s.at]);
    return { solid0: map(P.solid0, true), paving: map(P.paving, false), tops, solidMeshes, solidAt: P.solid.map(s => s.at) };
  }

  // game.json's strip surfaces as nav.js walks them: each with its profile's distances (us) and heights (zs)
  function strips(G) {
    return (G.surfaces || []).filter(s => s.type === 'strip').map(s => Object.assign({}, s, { us: s.profile.map(p => p[0]), zs: s.profile.map(p => p[1]) }));
  }
  // the 2 m grid of the game's surface model (game.js FRAME, Sun.buildDSM)
  function grid(frame, cell = 2) {
    return { nx: Math.round((frame.x[1] - frame.x[0]) / cell), ny: Math.round((frame.y[1] - frame.y[0]) / cell), cell, x0: frame.x[0], y1: frame.y[1] };
  }
  const api = { raster, strips, grid, pack, unpack, stripUV, beyondStrips, PAVE, paveKey };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OENavCells = api;
})(typeof self !== 'undefined' ? self : globalThis);
