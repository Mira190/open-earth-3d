// Open Earth 3D inland water: rivers, canals, moats and ponds above the sea, each at its own level, for
// the model viewer and the game (world.js draws them, game/nav.js keeps walkers out of them).
//
// web/water.js draws the sea at the scene's 0 m. Water above it (the Meguro River 3-10 m up, Kyoto's Kamo
// River at 30-50 m, a park's pond) comes from scene.json "inland" (pipeline/inland_water.py), body by body:
//   walled   a channel between revetments: the ground over it is cut away (the hole mask the ground
//            shader reads, world.js clipGround), and walls drop from the bank to its bed, a coping and a
//            railing on top; the water flows over a concrete or stone bed. Where a road crosses it with no
//            bridge model (scene.json "decks"), the ground stays over it as a slab, with a railing either side
//   natural  a pond or a river in its bed: the water at the level the laser survey gives, the ground under it
//            lowered to the bed
// raise(T) levels a terrain grid to the bank along the walled channels (the 5 m survey dips into a 10 m
// channel) and lowers it under the natural water, in place, so that the ground drawn, the walls' tops and
// what walkers stand on agree.
// Frame: local x east, y north, z up; three.js (x, z, -y).
'use strict';
window.OEInland = (function () {
  const COPING = { w: 0.45, h: 0.12 }, RAIL_H = 1.1, RAIL_IN = 0.2, SLAB = 0.9; // m
  const HOLE_PAD = 0.06; // the ground's hole reaches this far past a wall's face, under its coping
  const FLIGHT_GATE = 1.3; // a flight of steps down to a promenade opens to the pavement beside it over its first FLIGHT_GATE m
  const SDF_K = 40, SDF_BAND = 2.5; // the hole mask: 128 + SDF_K x signed distance (m, water positive), exact within SDF_BAND of an edge

  // scene: scene.json; returns null where the city has no inland water
  function create(scene) {
    const I = scene.inland;
    if (!I || !(I.bodies || []).length) return null;
    const pairs = a => { const o = []; for (let k = 0; k < a.length; k += 2) o.push([a[k], a[k + 1]]); return o; };
    const area = r => { let s = 0; for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
    const bodies = I.bodies.map((b, id) => {
      const rings = b.rings.map(pairs), bz = b.bz.map(v => v.slice()), wz = b.wz.map(v => v.slice());
      // the outer ring anticlockwise and the holes clockwise: the water is on the left of every edge
      rings.forEach((r, k) => {
        if ((area(r) > 0) !== (k === 0)) { r.reverse(); bz[k].reverse(); wz[k].reverse(); }
      });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // a sunken promenade (the Horikawa): a floor terrace.path_m over the water between the walls, the stream down
      // it in rings of its own (anticlockwise), and flights of steps down from the crossings
      let terrace = null;
      if (b.terrace && b.stream) {
        const sr = b.stream.rings.map(pairs), swz = b.stream.wz.map(v => v.slice());
        sr.forEach((r, k) => { if (area(r) < 0) { r.reverse(); swz[k].reverse(); } });
        const lawn = b.terrace.lawn ? b.terrace.lawn.rings.map((r, k) => ({ ring: pairs(r), z: b.terrace.lawn.z[k] })) : [];
        lawn.forEach(l => { if (area(l.ring) < 0) { l.ring.reverse(); l.z = l.z.slice().reverse(); } });
        // the floor in pieces, each at its own levels (cut across where it steps down with the stream's drops, #322),
        // outer rings anticlockwise and holes clockwise; the risers at its steps; the slabs and stepping stones over
        // the stream; and its level along the channel's line, for walkers (axis: x, y, z, ...)
        const floor = (b.terrace.floor || []).map(f => {
          const R = f.rings.map(pairs), Z = f.z.map(v => v.slice());
          R.forEach((r, k) => { if ((area(r) > 0) !== (k === 0)) { r.reverse(); Z[k].reverse(); } });
          return { rings: R, z: Z };
        });
        terrace = { path_m: b.terrace.path_m || 0.35, stream: sr, swz, steps: b.steps || [], lawn, seats: b.terrace.seats || [], weirs: b.terrace.weirs || [],
          floor, risers: b.terrace.risers || [], crossings: b.terrace.crossings || [], axis: b.terrace.axis || null };
      }
      return { id, name: b.name, kind: b.kind, walls: b.walls || null, water_m: b.water_m || 0.3, rail: b.rail !== false, rings, bz, wz, box: [x0, y0, x1, y1], terrace };
    });
    const decks = (I.decks || []).map(pairs);
    const walled = bodies.filter(b => b.kind === 'walled'), natural = bodies.filter(b => b.kind === 'natural');

    // ------------------------------------------------------------ masks (canvas rasters)
    // a raster over the bodies' box at `cell`: fill the polygons (outer and holes, even-odd), optionally grown by
    // `grow` metres and with `cut` polygons cleared; returns {px (alpha bytes), nx, ny, cell, x0, y1, at(x, y)}
    function raster(list, cell, { grow = 0, cut = [], max = 4096 } = {}) {
      if (!list.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of list) { x0 = Math.min(x0, b.box[0]); y0 = Math.min(y0, b.box[1]); x1 = Math.max(x1, b.box[2]); y1 = Math.max(y1, b.box[3]); }
      x0 -= 4; y0 -= 4; x1 += 4; y1 += 4;
      cell = Math.max(cell, (x1 - x0) / max, (y1 - y0) / max);
      const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
      const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const P = (x, y) => [(x - x0) / cell, (y1 - y) / cell];
      const path = rings => { g.beginPath(); for (const r of rings) r.forEach(([x, y], i) => { const [u, v] = P(x, y); i ? g.lineTo(u, v) : g.moveTo(u, v); }); g.closePath(); };
      g.fillStyle = g.strokeStyle = '#fff';
      for (const b of list) {
        path(b.rings); g.fill('evenodd');
        if (grow > 0) { g.lineWidth = 2 * grow / cell; g.lineJoin = 'round'; for (const r of b.rings) { path([r]); g.stroke(); } }
      }
      g.globalCompositeOperation = 'destination-out';
      for (const d of cut) { path([d]); g.fill(); }
      const data = g.getImageData(0, 0, nx, ny).data, px = new Uint8Array(nx * ny);
      for (let i = 0; i < px.length; i++) px[i] = data[4 * i + 3];
      const at = (x, y) => {
        const c = Math.floor((x - x0) / cell), r = Math.floor((y1 - y) / cell);
        return c >= 0 && r >= 0 && c < nx && r < ny ? px[r * nx + c] : 0;
      };
      return { px, nx, ny, cell, x0, y1, at, canvas: cv };
    }
    const inWalled = raster(walled, 0.5), inNatural = raster(natural, 1.0), inDeck = decks.length ? raster(decks.map(r => ({ rings: [r], box: boxOf(r) })), 0.5) : null;
    function boxOf(r) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; }

    // ------------------------------------------------------------ levels: the nearest ring point's
    // ring points in 8 m buckets, a dense grid over their box (a Map keyed by strings was 1.2 s of Kyoto's and
    // Shibuya's build on raise's million lookups, issue 327): per bucket a list of x, y, bz, wz, body
    const B = 8;
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (const b of bodies) for (const r of b.rings) for (const [x, y] of r) {
      const cx = Math.floor(x / B), cy = Math.floor(y / B);
      if (cx < gx0) gx0 = cx; if (cx > gx1) gx1 = cx; if (cy < gy0) gy0 = cy; if (cy > gy1) gy1 = cy;
    }
    const gnx = gx1 - gx0 + 1, gny = gy1 - gy0 + 1, grid = new Array(Math.max(0, gnx * gny));
    for (const b of bodies) b.rings.forEach((r, k) => r.forEach(([x, y], i) => {
      const g = (Math.floor(x / B) - gx0) + (Math.floor(y / B) - gy0) * gnx;
      (grid[g] || (grid[g] = [])).push(x, y, b.bz[k][i], b.wz[k][i], b.id);
    }));
    // {d, bz, wz, body} of the nearest ring point within `reach` m (of `kind` when given), or null
    function nearest(x, y, reach = 12, kind = null) {
      const r = Math.ceil(reach / B), cx = Math.floor(x / B) - gx0, cy = Math.floor(y / B) - gy0;
      const i0 = Math.max(0, cx - r), i1 = Math.min(gnx - 1, cx + r), j0 = Math.max(0, cy - r), j1 = Math.min(gny - 1, cy + r);
      let bl = null, bk = -1, bd = reach * reach;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { // (x outer, as the Map's lookups went: ties go the same way)
        const l = grid[i + j * gnx];
        if (!l) continue;
        for (let k = 0; k < l.length; k += 5) {
          if (kind && bodies[l[k + 4]].kind !== kind) continue;
          const d = (l[k] - x) ** 2 + (l[k + 1] - y) ** 2;
          if (d < bd) { bd = d; bl = l; bk = k; }
        }
      }
      return bl ? { d: Math.sqrt(bd), bz: bl[bk + 2], wz: bl[bk + 3], body: bodies[bl[bk + 4]] } : null;
    }

    // whether (x, y) is on the water (not on a deck over a channel)
    const onDeck = (x, y) => !!inDeck && inDeck.at(x, y) > 127;
    const walledAt = (x, y) => !!inWalled && inWalled.at(x, y) > 127 && !onDeck(x, y); // over a walled channel's water
    function water(x, y) {
      if (inWalled && inWalled.at(x, y) > 127) return !onDeck(x, y);
      return !!inNatural && inNatural.at(x, y) > 127;
    }
    // the water's level at (x, y), or null off it
    function level(x, y) {
      if (!water(x, y)) return null;
      const n = nearest(x, y, 40);
      return n ? n.wz : null;
    }

    // ------------------------------------------------------------ the terrain, levelled
    // T: {data, nx, ny, cell, x0, y1}, changed in place (once per grid)
    function raise(T) {
      if (!T || T.oeInland) return T;
      T.oeInland = true;
      const reach = 1.25 * T.cell;
      for (let r = 0; r < T.ny; r++) for (let c = 0; c < T.nx; c++) {
        const x = T.x0 + c * T.cell, y = T.y1 - r * T.cell, i = r * T.nx + c;
        const inW = inWalled && inWalled.at(x, y) > 0;
        const nw = walled.length ? nearest(x, y, inW ? 40 : reach, 'walled') : null;
        if (nw && (inW || nw.d <= reach)) { T.data[i] = nw.bz; continue; }
        if (inNatural && inNatural.at(x, y) > 127) {
          const n = nearest(x, y, 60, 'natural');
          if (n) T.data[i] = Math.min(T.data[i], n.wz - Math.max(0.4, 0.6 * n.body.water_m));
        }
      }
      return T;
    }

    // ------------------------------------------------------------ the ground's hole over the channels
    // a signed distance to the walls' faces, less the decks, at 0.5 m or so: filtered, its 0.5 level follows a wall
    // to a few centimetres, where a plain mask would leave a ragged edge of ground at the coping
    let hole = null;
    function holeMask() {
      if (hole || !walled.length) return hole;
      const m = inWalled, { nx, ny, cell, x0, y1 } = m, N = nx * ny;
      const dW = new Float32Array(N).fill(1e9), dD = new Float32Array(N).fill(1e9);
      const band = (rings, D) => { // the unsigned distance to every edge of `rings`, within SDF_BAND
        for (const r of rings) for (let i = 0, n = r.length; i < n; i++) {
          const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-9;
          const ca = Math.max(0, Math.floor((Math.min(ax, bx) - SDF_BAND - x0) / cell)), cb = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + SDF_BAND - x0) / cell));
          const ra = Math.max(0, Math.floor((y1 - Math.max(ay, by) - SDF_BAND) / cell)), rb = Math.min(ny - 1, Math.ceil((y1 - Math.min(ay, by) + SDF_BAND) / cell));
          for (let rr = ra; rr <= rb; rr++) for (let cc = ca; cc <= cb; cc++) {
            const px = x0 + (cc + 0.5) * cell, py = y1 - (rr + 0.5) * cell;
            const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2));
            const d = Math.hypot(px - ax - t * ex, py - ay - t * ey), k = rr * nx + cc;
            if (d < D[k]) D[k] = d;
          }
        }
      };
      for (const b of walled) band(b.rings, dW);
      band(decks, dD);
      const px = new Uint8Array(N);
      for (let k = 0; k < N; k++) {
        const c = k % nx, r = (k - c) / nx, x = x0 + (c + 0.5) * cell, y = y1 - (r + 0.5) * cell;
        const w = (m.px[k] > 127 ? 1 : -1) * Math.min(dW[k], SDF_BAND * 2);
        const dk = inDeck ? (inDeck.at(x, y) > 127 ? 1 : -1) * Math.min(dD[k], SDF_BAND * 2) : -SDF_BAND * 2;
        px[k] = Math.max(0, Math.min(255, Math.round(128 + SDF_K * Math.min(w + HOLE_PAD, -dk))));
      }
      const tex = new THREE.DataTexture(px, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.generateMipmaps = false;
      tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      hole = { tex, box: [x0, y1, nx * cell, ny * cell] };
      return hole;
    }

    // ------------------------------------------------------------ meshes
    // mats: {water(body), bed(body), wall(body), coping, rail, slab, floor}: three.js materials (world.js makes them)
    function build(mats) {
      const group = new THREE.Group(); group.name = 'inland';
      const V = THREE.Vector2;
      let length = 0;
      for (const b of bodies) {
        // a sheet over rings (the first the outline, the rest holes) at the levels Z (one array a ring) + dz, its
        // normals up (level water, whatever the triangles' slivers); null if it does not triangulate
        const sheetOf = (R, Z, dz) => {
          const tris = THREE.ShapeUtils.triangulateShape(R[0].map(([x, y]) => new V(x, y)), R.slice(1).map(r => r.map(([x, y]) => new V(x, y))));
          if (!tris.length) return null;
          const P = R.flat(), ZZ = Z.flat();
          const pos = new Float32Array(P.length * 3), uv = new Float32Array(P.length * 2), nrm = new Float32Array(P.length * 3);
          P.forEach(([x, y], i) => { pos.set([x, ZZ[i] + dz, -y], 3 * i); uv.set([x, y], 2 * i); nrm[3 * i + 1] = 1; });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          g.setIndex(tris.flat());
          return g;
        };
        const sheet = dz => sheetOf(b.rings, b.wz, dz);
        const TR = b.terrace;
        // the water and its bed: the polygon (a promenade's stream), triangulated, each point at its own level
        const waters = TR ? TR.stream.map((r, k) => sheetOf([r], [TR.swz[k]], 0)).filter(Boolean) : [sheet(0)];
        waters.forEach((g, k) => {
          const w = new THREE.Mesh(g, mats.water(b));
          w.name = 'inland_water'; w.receiveShadow = true; w.userData.body = b;
          group.add(w);
        });
        if (b.kind !== 'walled') continue;
        if (TR) {
          // the promenade's floor round the stream, and the stream's own bed and its low stone edges
          const floors = TR.floor.length ? TR.floor.map(f => sheetOf(f.rings, f.z, 0))
            : [sheetOf([...b.rings, ...TR.stream.map(r => r.slice().reverse())], [...b.wz, ...TR.swz.map(z => z.slice().reverse())], TR.path_m)];
          for (const floor of floors) if (floor) { const f = new THREE.Mesh(floor, mats.floor || mats.coping); f.name = 'inland_floor'; f.receiveShadow = true; group.add(f); }
          for (let k = 0; k < TR.stream.length; k++) {
            const g = sheetOf([TR.stream[k]], [TR.swz[k]], -b.water_m);
            if (g) { const m = new THREE.Mesh(g, mats.bed(b)); m.name = 'inland_bed'; m.receiveShadow = true; group.add(m); }
          }
          const edge = [], euv = [];
          TR.stream.forEach((r, k) => {
            for (let i = 0, n = r.length; i < n; i++) {
              const j = (i + 1) % n, [ax, ay] = r[i], [bx, by] = r[j], L = Math.hypot(bx - ax, by - ay);
              if (L < 0.05) continue;
              const wa = TR.swz[k][i], wb = TR.swz[k][j], ta = wa + TR.path_m, tb = wb + TR.path_m, fa = wa - b.water_m - 0.05, fb = wb - b.water_m - 0.05;
              edge.push(ax, ta, -ay, bx, tb, -by, bx, fb, -by, ax, ta, -ay, bx, fb, -by, ax, fa, -ay);
              euv.push(length, ta - wa, length + L, tb - wb, length + L, fb - wb, length, ta - wa, length + L, fb - wb, length, fa - wa);
              length += L;
            }
          });
          if (edge.length) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(euv, 2));
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.wall(b)); m.name = 'inland_stream_edge'; m.receiveShadow = true; group.add(m);
          }
          // the steps: a flight of stone treads down along the wall, solid to the floor, a low parapet on the open side
          const st = [], suv = [], par = [], puv = [];
          // a box hl along (u) and hw across (n), z0..z1; UVs in metres for the setts' pattern: on its top across and
          // along the flight from (fx, fy) (so that a tread's joint falls at its nosing), on its sides along and up
          const box = (cx, cy, ux, uy, nx, ny, hl, hw, z0, z1, out, uvs, fx, fy) => {
            const c = [];
            for (const [a, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push([cx + ux * a * hl + nx * w * hw, cy + uy * a * hl + ny * w * hw]);
            const V3 = (q, z) => [q[0], z, -q[1]];
            const quad = (p0, p1, p2, p3, t0, t1, t2, t3) => { out.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); uvs.push(...t0, ...t1, ...t2, ...t0, ...t2, ...t3); };
            const T = c.map(q => V3(q, z1)), Bm = c.map(q => V3(q, z0));
            const top = c.map(q => [(q[0] - fx) * nx + (q[1] - fy) * ny, (q[0] - fx) * ux + (q[1] - fy) * uy]);
            const wind = (ux * ny - uy * nx) > 0; // (u, n) anticlockwise from above
            const q4 = (a, b2, c2, d, ta, tb, tc, td) => (wind ? quad(a, b2, c2, d, ta, tb, tc, td) : quad(a, d, c2, b2, ta, td, tc, tb));
            q4(T[0], T[3], T[2], T[1], top[0], top[3], top[2], top[1]);
            for (let e = 0; e < 4; e++) {
              const f = (e + 1) % 4, L = Math.hypot(c[f][0] - c[e][0], c[f][1] - c[e][1]), s0 = top[e][0] + top[e][1];
              q4(Bm[e], Bm[f], T[f], T[e], [s0, z0], [s0 + L, z0], [s0 + L, z1], [s0, z1]);
            }
          };
          for (const [x, y, ux, uy, nx, ny, zt, zb, w, run] of TR.steps) {
            const n = Math.max(2, Math.round((zt - zb) / 0.16)), rise = (zt - zb) / n, tread = run / n;
            for (let i = 0; i < n; i++) {
              const a = (i + 0.5) * tread;
              box(x + ux * a, y + uy * a, ux, uy, nx, ny, tread / 2 + 0.01, w / 2, zb - 0.05, zt - (i + 1) * rise + 0.02, st, suv, x - ux * 0.01, y - uy * 0.01);
            }
            // the parapet on the stream's side, from the top of the flight to its foot
            const ox = x - nx * (w / 2 + 0.08), oy = y - ny * (w / 2 + 0.08), ex = ox + ux * run, ey = oy + uy * run;
            for (const z of [0.9]) {
              par.push(ox, zt + z, -oy, ex, zb + z, -ey, ex, zb, -ey, ox, zt + z, -oy, ex, zb, -ey, ox, zt, -oy);
              puv.push(0, z, run, z, run, 0, 0, z, run, 0, 0, 0);
            }
          }
          if (st.length) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(st, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.floor || mats.coping); m.name = 'inland_steps'; m.castShadow = m.receiveShadow = true; group.add(m);
          }
          // the seating steps: tiers of stone from the floor up towards the wall, solid to the floor
          const se = [], seuv = [];
          for (const [x, y, ux, uy, nx, ny, len, zf, n, rise, tread] of TR.seats) {
            for (let k = 0; k < n; k++) {
              const d0 = k * tread, d1 = Math.min((k + 1) * tread, n * tread) + (k === 0 ? 0.08 : 0), dm = (d0 + d1) / 2;
              box(x + ux * len / 2 - nx * dm, y + uy * len / 2 - ny * dm, ux, uy, nx, ny, len / 2 + 0.01, (d1 - d0) / 2, zf - 0.05, zf + rise * (n - k), se, seuv, x - nx * d0, y - ny * d0);
            }
          }
          if (se.length) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(se, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(seuv, 2)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.floor || mats.coping); m.name = 'inland_seats'; m.castShadow = m.receiveShadow = true; group.add(m);
          }
          // the lawn, a hand's breadth over the floor
          for (const l of TR.lawn) {
            const g = sheetOf([l.ring], [l.z], 0.04);
            if (g) { const m = new THREE.Mesh(g, mats.lawn || mats.floor); m.name = 'inland_lawn'; m.receiveShadow = true; group.add(m); }
          }
          // the floor's steps where it drops with the stream (#322): a granite riser across it, wall to stream; the slabs
          // over the stream, flush with the floor, and the stepping stones standing in it
          const ri = [], riuv = [];
          for (const [ax, ay, bx, by, zt, zb] of TR.risers) {
            const L = Math.hypot(bx - ax, by - ay);
            if (L < 0.05 || zt - zb < 0.01) continue;
            box((ax + bx) / 2, (ay + by) / 2, (bx - ax) / L, (by - ay) / L, (ay - by) / L, (bx - ax) / L, L / 2, 0.03, zb - 0.05, zt + 0.005, ri, riuv, ax, ay);
          }
          for (const [x, y, ux, uy, len, w, zt, kind] of TR.crossings) {
            box(x, y, ux, uy, uy, -ux, len / 2, w / 2, kind ? zt - 0.6 : zt - 0.25, zt, ri, riuv, x - ux * len / 2, y - uy * len / 2);
          }
          if (ri.length) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ri, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(riuv, 2)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.wall(b)); m.name = 'inland_risers'; m.castShadow = m.receiveShadow = true; group.add(m);
          }
          // the stepped weirs: a granite sill across the stream, and the white water falling off it
          const wr = [], wruv = [], fo = [];
          for (const [x, y, ux, uy, w, z, drop] of TR.weirs) {
            const nx = -uy, ny = ux;
            box(x, y, ux, uy, nx, ny, 0.3, w / 2 + 0.05, z - b.water_m - 0.05, z + 0.06, wr, wruv, x, y);
            const P = (u, v, h) => [x + ux * u + nx * v, z + h, -(y + uy * u + ny * v)];
            const A = P(0.3, -w / 2, 0.04), B = P(0.3, w / 2, 0.04), C = P(1.9, w / 2, 0.01 - drop), D = P(1.9, -w / 2, 0.01 - drop);
            fo.push(...A, ...B, ...C, ...A, ...C, ...D, ...A, ...C, ...B, ...A, ...D, ...C);
          }
          if (wr.length) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(wruv, 2)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.wall(b)); m.name = 'inland_weirs'; m.castShadow = m.receiveShadow = true; group.add(m);
          }
          if (fo.length && mats.foam) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fo, 3)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.foam); m.name = 'inland_foam'; m.renderOrder = 2; group.add(m);
          }
          if (par.length) {
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(par, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2)); g.computeVertexNormals();
            const m = new THREE.Mesh(g, mats.rail); m.name = 'inland_steps_rail'; group.add(m);
          }
        } else {
          const bed = new THREE.Mesh(sheet(-b.water_m), mats.bed(b));
          bed.name = 'inland_bed'; bed.receiveShadow = true;
          group.add(bed);
        }
        // the walls: from the bank to the bed along every edge, facing the water (on the left of each edge);
        // u metres along, v metres above the water
        const wall = [], wuv = [], cop = [], rail = [], ruv = [];
        b.rings.forEach((r, k) => {
          const n = r.length;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, [ax, ay] = r[i], [bx, by] = r[j], L = Math.hypot(bx - ax, by - ay);
            if (L < 0.05) continue;
            const ux = (bx - ax) / L, uy = (by - ay) / L, lx = -uy, ly = ux; // along, and to the left (the water)
            // (a promenade's walls stand on its floor)
            const ta = b.bz[k][i], tb = b.bz[k][j], wa = b.wz[k][i], wb = b.wz[k][j], foot = TR ? TR.path_m - 0.05 : -b.water_m - 0.1, fa = wa + foot, fb = wb + foot;
            // face (two triangles, seen from the water)
            wall.push(ax, ta, -ay, bx, tb, -by, bx, fb, -by, ax, ta, -ay, bx, fb, -by, ax, fa, -ay);
            wuv.push(length, ta - wa, length + L, tb - wb, length + L, fb - wb, length, ta - wa, length + L, fb - wb, length, fa - wa);
            // the coping: a slab on the bank from the face back COPING.w, with its edge over the face
            const h = COPING.h, ox = -lx * COPING.w, oy = -ly * COPING.w, ex = lx * 0.04, ey = ly * 0.04;
            const A = [ax + ex, ta + h, -(ay + ey)], Bq = [bx + ex, tb + h, -(by + ey)], C = [bx + ox, tb + h, -(by + oy)], D = [ax + ox, ta + h, -(ay + oy)];
            const A0 = [ax + ex, ta - 0.02, -(ay + ey)], B0 = [bx + ex, tb - 0.02, -(by + ey)];
            cop.push(...A, ...Bq, ...C, ...A, ...C, ...D, ...A0, ...B0, ...Bq, ...A0, ...Bq, ...A);
            // the railing, set back from the face, but not across a deck over the channel
            const mx = (ax + bx) / 2 - lx * RAIL_IN, my = (ay + by) / 2 - ly * RAIL_IN;
            if (b.rail && !onDeck(mx, my) && !onDeck(mx + lx * 1.5, my + ly * 1.5)) { // (rail: false, a channel with no railing: the Philosopher's Path)
              const px = -lx * RAIL_IN, py = -ly * RAIL_IN, ra = ta + h, rb = tb + h;
              // (open over the top of a flight of steps down to a promenade: the way in from the pavement)
              for (const [t0, t1] of TR ? railParts(ax + px, ay + py, bx + px, by + py, L, openAtWall) : [[0, 1]]) {
                const x0 = ax + px + (bx - ax) * t0, y0 = ay + py + (by - ay) * t0, x1 = ax + px + (bx - ax) * t1, y1 = ay + py + (by - ay) * t1;
                const z0 = ra + (rb - ra) * t0, z1 = ra + (rb - ra) * t1;
                rail.push(x0, z0, -y0, x1, z1, -y1, x1, z1 + RAIL_H, -y1, x0, z0, -y0, x1, z1 + RAIL_H, -y1, x0, z0 + RAIL_H, -y0);
                ruv.push(length + L * t0, 0, length + L * t1, 0, length + L * t1, RAIL_H, length + L * t0, 0, length + L * t1, RAIL_H, length + L * t0, RAIL_H);
              }
            }
            length += L;
          }
        });
        const mesh = (p, uv, mat, name) => {
          if (!p.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
          if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.computeVertexNormals();
          const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true;
          group.add(m);
          return m;
        };
        const wm = mesh(wall, wuv, mats.wall(b), 'inland_wall');
        if (wm) wm.castShadow = true;
        mesh(cop, null, mats.coping, 'inland_coping');
        const rm = mesh(rail, ruv, mats.rail, 'inland_rail');
        if (rm) rm.castShadow = false;
      }
      // the decks over the channels: the slab's edges over the water and its underside, a railing along each edge over the water
      if (decks.length) {
        const side = [], under = [], rail = [], ruv = [];
        let u = 0;
        for (const r of decks) {
          const z = r.map(([x, y]) => { const n = nearest(x, y, 40, 'walled'); return n ? n.bz : 0; });
          const bare = r.some(([x, y]) => { const n = nearest(x, y, 40, 'walled'); return n && n.body.rail === false; }); // (a bridge over a channel with no railing has its own balustrade, or none)
          const ccw = area(r) > 0, n = r.length;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, [ax, ay] = r[i], [bx, by] = r[j], L = Math.hypot(bx - ax, by - ay);
            if (L < 0.05) continue;
            const ux = (bx - ax) / L, uy = (by - ay) / L, ox = ccw ? uy : -uy, oy = ccw ? -ux : ux; // outward
            const mx = (ax + bx) / 2 + ox * 0.6, my = (ay + by) / 2 + oy * 0.6;
            if (!(inWalled && inWalled.at(mx, my) > 127) || onDeck(mx, my)) continue; // only the edges over the water
            const ta = z[i], tb = z[j], sa = ta - SLAB, sb = tb - SLAB;
            // outward-facing: wind so the face looks out
            if (ccw) side.push(ax, ta, -ay, ax, sa, -ay, bx, sb, -by, ax, ta, -ay, bx, sb, -by, bx, tb, -by);
            else side.push(ax, ta, -ay, bx, sb, -by, ax, sa, -ay, ax, ta, -ay, bx, tb, -by, bx, sb, -by);
            const px = -ox * 0.15, py = -oy * 0.15;
            if (bare) continue;
            rail.push(ax + px, ta, -(ay + py), bx + px, tb, -(by + py), bx + px, tb + RAIL_H, -(by + py), ax + px, ta, -(ay + py), bx + px, tb + RAIL_H, -(by + py), ax + px, ta + RAIL_H, -(ay + py));
            ruv.push(u, 0, u + L, 0, u + L, RAIL_H, u, 0, u + L, RAIL_H, u, RAIL_H);
            u += L;
          }
          const tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new V(x, y)), []);
          for (const t of tris) for (const k of (ccw ? [t[0], t[2], t[1]] : t)) under.push(r[k][0], z[k] - SLAB, -r[k][1]);
        }
        for (const [p, uv, mat, name] of [[side, null, mats.slab, 'inland_deck'], [under, null, mats.slab, 'inland_deck_under'], [rail, ruv, mats.rail, 'inland_deck_rail']]) {
          if (!p.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
          if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.computeVertexNormals();
          const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true;
          group.add(m);
        }
      }
      return { group, length };
    }

    // a tree whose trunk stands over a channel (planted from the canopy that hangs over it): on the bank nearest
    // it, `back` m behind the wall's face, at the bank's level; [x, y, z] or null (over a pond: no tree)
    function bank(x, y, back = 0.8) {
      if (!water(x, y)) return [x, y, null];
      if (!(inWalled && inWalled.at(x, y) > 127)) return null;
      const n = nearest(x, y, 40, 'walled');
      if (!n) return null;
      // the nearest ring point, then out past it, away from the water
      let best = null, bd = Infinity;
      for (const r of n.body.rings) for (const [px, py] of r) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = [px, py]; } }
      const dx = best[0] - x, dy = best[1] - y, L = Math.hypot(dx, dy) || 1;
      let ox = best[0] + dx / L * back, oy = best[1] + dy / L * back;
      if (water(ox, oy)) { ox = best[0] + dx / L * (back + 2); oy = best[1] + dy / L * (back + 2); }
      return water(ox, oy) ? null : [ox, oy, n.bz];
    }

    // whether (x, y), on the bank, is within r m of a channel's wall (its planting strip: the Meguro River's cherries
    // stand there, between the railing and the street)
    function byWall(x, y, r = 1.5) {
      if (!inWalled || water(x, y)) return false;
      for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; if (inWalled.at(x + r * Math.cos(t), y + r * Math.sin(t)) > 127) return true; }
      return false;
    }

    // ------------------------------------------------------------ a sunken promenade's floor, for walkers (nav.js)
    // The Horikawa's paved floor between its walls and the flights of steps down to it from the crossings: the
    // height a walker stands at (x, y) on them, or null off them (on the street, on a deck over the channel, in
    // the stream's bed). On a flight, the tread under the point (rise and tread as drawn in build()); the floor
    // under a flight is the flight's, which stands solid to it. {z, flight} (flight: on a flight of steps)
    const terraced = walled.filter(b => b.terrace);
    const inTerrace = terraced.length ? raster(terraced, 0.5, { grow: 1.0 }) : null; // (which channel: a promenade's, grown over the walled mask's cells)
    const inStream = terraced.length ? raster(terraced.flatMap(b => b.terrace.stream.map(r => ({ rings: [r], box: boxOf(r) }))), 0.25) : null;
    const flights = terraced.flatMap(b => b.terrace.steps.map(([x, y, ux, uy, nx, ny, zt, zb, w, run]) => {
      const n = Math.max(2, Math.round((zt - zb) / 0.16));
      return { x, y, ux, uy, nx, ny, zt, zb, w, run, n, rise: (zt - zb) / n, tread: run / n };
    }));
    function flightAt(x, y) {
      for (const f of flights) {
        const dx = x - f.x, dy = y - f.y, u = dx * f.ux + dy * f.uy, v = dx * f.nx + dy * f.ny;
        // (and a landing at the street's level behind the top tread; and beside the top, where the flight opens to the
        // pavement, at the street's level out over its wall's face, the coping and the channel mask's half-metre cells;
        // further down, over the strip to its face)
        if (u < -0.4 || u > f.run || v < -f.w / 2) continue;
        if (v <= f.w / 2) return u < 0 ? f.zt : f.zt - Math.min(f.n, Math.floor(u / f.tread) + 1) * f.rise;
        if (u <= FLIGHT_GATE && v <= f.w / 2 + 1.3) return f.zt;
        if (v <= f.w / 2 + 0.75) return f.zt - Math.min(f.n, Math.floor(u / f.tread) + 1) * f.rise;
      }
      return null;
    }
    // seating steps along a promenade's wall (the Horikawa's between Nijo and Oshikoji): the tier under (x, y), or null
    const seats = terraced.flatMap(b => b.terrace.seats.map(([x, y, ux, uy, nx, ny, len, zf, n, rise, tread]) => ({ x, y, ux, uy, nx, ny, len, zf, n, rise, tread })));
    function seatAt(x, y) {
      for (const q of seats) {
        const dx = x - q.x, dy = y - q.y, u = dx * q.ux + dy * q.uy, d = -(dx * q.nx + dy * q.ny);
        if (u >= -0.02 && u <= q.len + 0.02 && d >= -0.8 && d < q.n * q.tread) return q.zf + q.rise * (q.n - Math.max(0, Math.floor(d / q.tread)));
      }
      return null;
    }
    // the slabs and stepping stones over a promenade's stream (#322): the top under (x, y), or null
    // (a walker strides over the gaps between a row's stones: each stone holds one a stride's half-gap round it)
    const crossings = terraced.flatMap(b => b.terrace.crossings.map(([x, y, ux, uy, len, w, zt, kind]) => ({ x, y, ux, uy, len, w, zt, m: kind ? 0.22 : 0.05 })));
    function crossingAt(x, y) {
      for (const c of crossings) {
        const dx = x - c.x, dy = y - c.y;
        if (Math.abs(dx * c.ux + dy * c.uy) <= c.len / 2 + c.m && Math.abs(dx * c.uy - dy * c.ux) <= c.w / 2 + 0.05) return c.zt;
      }
      return null;
    }
    // the floor's level along a promenade's line (terrace.axis: it steps down with the stream's drops, #322), found
    // through 8 m cells of the line's segments: the level at the nearest point of the line, or null
    const AX = 8, axisCells = new Map(), axes = [];
    for (const b of terraced) {
      const a = b.terrace.axis;
      if (!a) continue;
      const k = axes.push(a) - 1;
      for (let i = 0; i + 5 < a.length; i += 3) {
        const c0 = Math.floor((Math.min(a[i], a[i + 3]) - 8) / AX), c1 = Math.floor((Math.max(a[i], a[i + 3]) + 8) / AX);
        const r0 = Math.floor((Math.min(a[i + 1], a[i + 4]) - 8) / AX), r1 = Math.floor((Math.max(a[i + 1], a[i + 4]) + 8) / AX);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const key = c * 65536 + r, l = axisCells.get(key); if (l) l.push(k, i); else axisCells.set(key, [k, i]); }
      }
    }
    function axisZ(x, y) {
      const l = axisCells.get(Math.floor(x / AX) * 65536 + Math.floor(y / AX));
      if (!l) return null;
      let best = Infinity, z = null;
      for (let j = 0; j < l.length; j += 2) {
        const a = axes[l[j]], i = l[j + 1], ax = a[i], ay = a[i + 1], bx = a[i + 3], by = a[i + 4];
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
        const d = Math.hypot(x - ax - ex * t, y - ay - ey * t);
        if (d < best - 1e-6) { best = d; z = a[i + 2] + (a[i + 5] - a[i + 2]) * t; }
      }
      return z;
    }
    function promenade(x, y) {
      if (!inTerrace || onDeck(x, y)) return null;
      const s = flightAt(x, y);
      if (s != null) return { z: s, flight: true };
      const st = seats.length ? seatAt(x, y) : null;
      if (st != null && inWalled.at(x, y) > 127) return { z: st, flight: false, seat: true };
      // (in the channel as water() has it, so that the street's edge and the promenade's agree to the raster's cell)
      if (inTerrace.at(x, y) === 0 || !(inWalled.at(x, y) > 127)) return null;
      if (inStream.at(x, y) > 127) { const c = crossings.length ? crossingAt(x, y) : null; return c != null ? { z: c, flight: false, crossing: true } : null; }
      const az = axes.length ? axisZ(x, y) : null;
      if (az != null) return { z: az, flight: false };
      const n = nearest(x, y, 40, 'walled');
      return n && n.body.terrace ? { z: n.wz + n.body.terrace.path_m, flight: false } : null;
    }

    // the parts [t0, t1] of a railing from a to b (length L) that stand: all of it but where open(x, y) (the way onto a
    // flight of steps down to a promenade), sampled every 0.1 m
    function railParts(ax, ay, bx, by, L, open) {
      if (!flights.length) return [[0, 1]];
      const n = Math.max(1, Math.ceil(L / 0.1)), out = [];
      let t0 = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n, shut = !open(ax + (bx - ax) * t, ay + (by - ay) * t);
        if (shut && t0 === null) t0 = t;
        if ((!shut || i === n) && t0 !== null) { const t1 = shut ? t : (i - 1) / n; if (t1 > t0 + 1e-3) out.push([t0, t1]); t0 = null; }
      }
      return out;
    }
    // where a flight of steps opens: from the pavement beside its top, through the railing over the wall
    const flightUV = (f, x, y) => { const dx = x - f.x, dy = y - f.y; return [dx * f.ux + dy * f.uy, dx * f.nx + dy * f.ny]; };
    const openAtWall = (x, y) => flights.some(f => { const [u, v] = flightUV(f, x, y); return u > -0.2 && u < FLIGHT_GATE && v > f.w / 2 - 0.4 && v < f.w / 2 + 1.2; });

    // ------------------------------------------------------------ the lights in the water at night
    // Each light near the water (a street lamp, a chochin, a bonbori) is seen in it as a streak: its mirror image
    // under the water's level, where the line from the eye to that image meets the water, drawn out towards the eye
    // as the ripples' slopes spread its reflection (longer the more grazing the view), broken into shimmering
    // dashes that drift with time. An additive card on the water, per light, placed in the vertex shader for the
    // camera: no second render of the scene (as the sea's planar reflection is) and no large texture, so it runs on
    // every tier. Where the card runs past the water's edge it is under the bank, and the ground hides it.
    // groups: [{pos (three.js x, y, z triples, read once), colour (THREE.Color, or a function of the light's index
    // giving one), gain}], one intensity a group set per frame with set(i, k); returns {mesh, set(i, k), count} or null
    function glints(groups, { reach = 26, fog = true } = {}) {
      const P = [], WZ = [], C = [], G = [];
      groups.forEach((g, gi) => {
        const n = g.pos.length / 3;
        for (let i = 0; i < n; i++) {
          const x = g.pos[3 * i], z = g.pos[3 * i + 1], y = -g.pos[3 * i + 2];
          const nw = nearest(x, y, reach);
          if (!nw || z < nw.wz + 0.5) continue;
          const c = typeof g.colour === 'function' ? g.colour(i) : g.colour;
          P.push(x, z, -y); WZ.push(nw.wz); C.push(c.r * g.gain, c.g * g.gain, c.b * g.gain); G.push(gi);
        }
      });
      const n = WZ.length;
      if (!n) return null;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.setAttribute('iLight', new THREE.InstancedBufferAttribute(new Float32Array(P), 3));
      geo.setAttribute('iWz', new THREE.InstancedBufferAttribute(new Float32Array(WZ), 1));
      geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(C), 3));
      geo.setAttribute('iGroup', new THREE.InstancedBufferAttribute(new Float32Array(G), 1));
      geo.instanceCount = n;
      const K = [0, 0, 0, 0, 0, 0, 0, 0];
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), { uK: { value: K }, uTime: { value: 0 } }),
        vertexShader: `attribute vec3 iLight, iCol; attribute float iWz, iGroup;
uniform float uK[8], uTime;
varying vec3 vC; varying vec2 vUv; varying float vSeed, vR, vAbove, vTheta;
#include <common>
#include <fog_pars_vertex>
const float S2 = 0.085; // how far the ripples tilt a reflected ray (radians): twice their slopes, about 0.04 rms
void main() {
  float k = 0.0;
  for (int i = 0; i < 8; i++) if (abs(iGroup - float(i)) < 0.5) k = uK[i];
  vec3 cam = cameraPosition, M = vec3(iLight.x, 2.0 * iWz - iLight.y, iLight.z); // the light's mirror image
  float above = cam.y - iWz;
  vC = vec3(0.0); vUv = vec2(0.0); vSeed = 0.0; vR = 1.0; vAbove = 1.0; vTheta = 0.0;
  if (k <= 0.0 || above < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = M.xz - cam.xz; float D = length(d); d = D > 1e-3 ? d / D : vec2(0.0, 1.0);
  // the image is seen at the elevation theta under the horizon; the water reflects the light to the eye wherever
  // the ripples tilt a ray within S2 of that: from the distance at theta + S2 out to the one at theta - S2 (the
  // horizon, if that is above it), a streak towards the eye that grows longer the lower the view
  float theta = atan(cam.y - M.y, D);
  float rP = above / tan(theta), r0 = above / tan(min(theta + S2, 1.55)), r1 = theta - S2 > 0.004 ? above / tan(theta - S2) : rP + 400.0;
  r1 = min(r1, rP + 400.0);
  float r = mix(r0, r1, position.y * 0.5 + 0.5);
  // across: the ripples spread it less that way, and it stays a lamp's width close to
  float hw = 0.1 + r * S2 * 0.18;
  vec2 xz = cam.xz + d * r + vec2(-d.y, d.x) * position.x * hw;
  vec3 wp = vec3(xz.x, iWz + 0.03, xz.y);
  vUv = position.xy; vR = r; vAbove = above; vTheta = theta;
  vSeed = fract(sin(dot(iLight.xz, vec2(12.9898, 78.233))) * 43758.5453);
  // the water reflects more the more grazing the view (Schlick, n = 1.33); a lamp far brighter than the night round
  // it is seen in it from overhead too; a far lamp's light in the water is weaker, and far off it fades out
  float F = 0.02 + 0.98 * pow(1.0 - sin(theta), 5.0);
  float dist = length(M - cam);
  vC = iCol * k * (0.12 + 0.88 * F) * min(1.0, 30.0 / dist) * (1.0 - smoothstep(900.0, 1600.0, dist));
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
        fragmentShader: `uniform float uTime; varying vec3 vC; varying vec2 vUv; varying float vSeed, vR, vAbove, vTheta;
#include <common>
#include <fog_pars_fragment>
const float S2 = 0.085;
float gn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(fract(sin(i * 91.7 + vSeed * 311.0) * 4375.5), fract(sin((i + 1.0) * 91.7 + vSeed * 311.0) * 4375.5), f); }
void main() {
  // how far this point's reflected ray is from the light's, in S2: most light near the image, less out along
  float t = (atan(vAbove, vR) - vTheta) / S2;
  float across = exp(-vUv.x * vUv.x * 4.0), along = exp(-t * t * 2.6);
  // broken into dashes by the ripples' crests, a metre or so apart, drifting; whole near the image
  float dash = gn(vR * 1.3 + uTime * 1.6) * 0.65 + gn(vR * 2.9 - uTime * 2.1 + 7.0) * 0.35;
  dash = mix(1.0, smoothstep(0.2, 0.85, dash) * 1.7, 0.9 * smoothstep(0.1, 0.7, abs(t)));
  gl_FragColor = vec4(vC * across * along * dash, 1.0);
  ${fog ? `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = max(gl_FragColor.rgb - fogColor * fogFactor, 0.0);
#endif` : ''}
}`,
        fog, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'inland_glints'; mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false;
      const t0 = performance.now();
      mesh.onBeforeRender = () => { mat.uniforms.uTime.value = ((performance.now() - t0) / 1000) % 1000; };
      return {
        mesh, count: n,
        set(i, k) { K[i] = k; mesh.visible = K.some(v => v > 0.001); },
        dispose() { geo.dispose(); mat.dispose(); },
      };
    }

    return { bodies, decks, walled: walledAt, walledBodies: walled, natural, raise, water, level, onDeck, nearest, bank, byWall, promenade, flights, seats, crossings, FLIGHT_GATE, holeMask, build, glints };
  }

  return { create };
})();
