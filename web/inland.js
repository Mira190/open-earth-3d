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
      return { id, name: b.name, kind: b.kind, walls: b.walls || null, water_m: b.water_m || 0.3, rings, bz, wz, box: [x0, y0, x1, y1] };
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
    const B = 8, hash = new Map(); // ring points in 8 m buckets
    for (const b of bodies) b.rings.forEach((r, k) => r.forEach(([x, y], i) => {
      const key = Math.floor(x / B) + ',' + Math.floor(y / B);
      let l = hash.get(key); if (!l) hash.set(key, l = []);
      l.push(x, y, b.bz[k][i], b.wz[k][i], b.id);
    }));
    // {d, bz, wz, body} of the nearest ring point within `reach` m (of `kind` when given), or null
    function nearest(x, y, reach = 12, kind = null) {
      const r = Math.ceil(reach / B), cx = Math.floor(x / B), cy = Math.floor(y / B);
      let best = null, bd = reach * reach;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const l = hash.get((cx + i) + ',' + (cy + j));
        if (!l) continue;
        for (let k = 0; k < l.length; k += 5) {
          if (kind && bodies[l[k + 4]].kind !== kind) continue;
          const d = (l[k] - x) ** 2 + (l[k + 1] - y) ** 2;
          if (d < bd) { bd = d; best = k; best = { d: Math.sqrt(d), bz: l[k + 2], wz: l[k + 3], body: bodies[l[k + 4]] }; }
        }
      }
      return best;
    }

    // whether (x, y) is on the water (not on a deck over a channel)
    const onDeck = (x, y) => !!inDeck && inDeck.at(x, y) > 127;
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
    // mats: {water(body), bed(body), wall(body), coping, rail, slab}: three.js materials (world.js makes them)
    function build(mats) {
      const group = new THREE.Group(); group.name = 'inland';
      const V = THREE.Vector2;
      let length = 0;
      for (const b of bodies) {
        // the water and its bed: the polygon, triangulated, each point at its own level
        const contour = b.rings[0].map(([x, y]) => new V(x, y)), holes = b.rings.slice(1).map(r => r.map(([x, y]) => new V(x, y)));
        const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
        const pts = b.rings.flat(), WZ = b.wz.flat();
        const sheet = dz => {
          const pos = new Float32Array(pts.length * 3), uv = new Float32Array(pts.length * 2);
          pts.forEach(([x, y], i) => { pos.set([x, WZ[i] + dz, -y], 3 * i); uv.set([x, y], 2 * i); });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          g.setIndex(tris.flat());
          const nrm = new Float32Array(pts.length * 3);
          for (let i = 0; i < pts.length; i++) nrm[3 * i + 1] = 1; // level water, whatever the triangles' slivers
          g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          return g;
        };
        const w = new THREE.Mesh(sheet(0), mats.water(b));
        w.name = 'inland_water'; w.receiveShadow = true; w.userData.body = b;
        group.add(w);
        if (b.kind !== 'walled') continue;
        const bed = new THREE.Mesh(sheet(-b.water_m), mats.bed(b));
        bed.name = 'inland_bed'; bed.receiveShadow = true;
        group.add(bed);
        // the walls: from the bank to the bed along every edge, facing the water (on the left of each edge);
        // u metres along, v metres above the water
        const wall = [], wuv = [], cop = [], rail = [], ruv = [];
        b.rings.forEach((r, k) => {
          const n = r.length;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, [ax, ay] = r[i], [bx, by] = r[j], L = Math.hypot(bx - ax, by - ay);
            if (L < 0.05) continue;
            const ux = (bx - ax) / L, uy = (by - ay) / L, lx = -uy, ly = ux; // along, and to the left (the water)
            const ta = b.bz[k][i], tb = b.bz[k][j], wa = b.wz[k][i], wb = b.wz[k][j], fa = wa - b.water_m - 0.1, fb = wb - b.water_m - 0.1;
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
            if (!onDeck(mx, my) && !onDeck(mx + lx * 1.5, my + ly * 1.5)) {
              const px = -lx * RAIL_IN, py = -ly * RAIL_IN, ra = ta + h, rb = tb + h;
              rail.push(ax + px, ra, -(ay + py), bx + px, rb, -(by + py), bx + px, rb + RAIL_H, -(by + py), ax + px, ra, -(ay + py), bx + px, rb + RAIL_H, -(by + py), ax + px, ra + RAIL_H, -(ay + py));
              ruv.push(length, 0, length + L, 0, length + L, RAIL_H, length, 0, length + L, RAIL_H, length, RAIL_H);
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

    return { bodies, decks, walled, natural, raise, water, level, onDeck, nearest, bank, byWall, holeMask, build };
  }

  return { create };
})();
