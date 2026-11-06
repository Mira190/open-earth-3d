// Open Earth 3D: landings past the frame (pipeline/outposts.py, game.json "outposts").
//
// A city's frame is a few kilometres across; past it there is only the far land, seen through haze
// (farland.js). Some real journeys end beyond it: Queenstown's TSS Earnslaw sails 13 km across Lake
// Wakatipu to Walter Peak. An outpost is a small tile of ground there, in the city's local frame: its
// terrain on a 2 m grid, the latest aerial photo draped on it, its water, its wharf (a strip surface in
// game.json "surfaces", walked by nav.js like any deck) and its buildings.
//
//  - The far land has a hole where the tile lies, with grid lines on its edges (farland.js holes), and
//    the tile's outer band (band_m) blends to the far land's own surface there, so the seam is exact.
//  - The edge haze (world.js edgeHaze) treats the tile as it treats the frame: clear inside, hazing over
//    the band to the far land's air at its edge.
//  - The walker (nav.js) takes the tile's ground, water and building footprints within it, and keeps off
//    the outer half of the band, where the ground is the far land's.
// On the low tier the ground is drawn on a 4 m grid and the photo at half size.
'use strict';
window.OEOutposts = (function () {
  const cache = new WeakMap(); // game.json's G -> the decoded outposts, shared by world.js and nav.js
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const bit = (b, i) => (b[i >> 3] >> (7 - (i & 7))) & 1;
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  // the outposts of game.json G, decoded once: [{id, name, x0, x1, y0, y1, cell, nx, ny, z, water, blocked, band, ...}]
  function list(G) {
    if (!G || !G.outposts || !G.outposts.length) return [];
    let L = cache.get(G);
    if (L) return L;
    L = G.outposts.map(o => {
      const raw = unb64(o.z), z16 = new Int16Array(raw.buffer, 0, raw.length >> 1), z = Float32Array.from(z16, v => v / 100);
      // (x1, y0: the grid's last points, which the mesh reaches and the far land's hole is cut to)
      return Object.assign({}, o, { z, x1: o.x0 + (o.nx - 1) * o.cell, y0: o.y1 - (o.ny - 1) * o.cell, band: o.band_m || 60,
        wbits: unb64(o.water), bbits: unb64(o.blocked), blended: false });
    });
    cache.set(G, L);
    return L;
  }
  // the boxes the far land leaves open for them
  function holes(G) { return list(G).map(o => ({ x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1 })); }
  // the tile's band blended to the far land's surface (farland.js surface): once, before anything reads it
  function blend(G, surface) {
    for (const o of list(G)) {
      if (o.blended || !surface) continue;
      for (let r = 0; r <= o.ny - 1; r++) for (let c = 0; c <= o.nx - 1; c++) {
        const x = o.x0 + c * o.cell, y = o.y1 - r * o.cell, d = Math.min(x - o.x0, o.x1 - x, o.y1 - y, y - o.y0);
        if (d >= o.band) continue;
        const k = smooth(d / o.band), i = r * o.nx + c;
        o.z[i] = o.z[i] * k + surface(x, y) * (1 - k);
      }
      o.blended = true;
    }
  }
  const inside = (o, x, y) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1;
  function at(G, x, y) { for (const o of list(G)) if (inside(o, x, y)) return o; return null; }
  // the ground at (x, y), on the triangles the mesh draws (each cell split from its south-west to its
  // north-east corner, as three.js's PlaneGeometry splits it): { z, slope }
  function ground(o, x, y) {
    const c = Math.max(0, Math.min(o.nx - 1.001, (x - o.x0) / o.cell)), r = Math.max(0, Math.min(o.ny - 1.001, (o.y1 - y) / o.cell));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * o.nx + c0, D = o.z;
    const a = D[i], b = D[i + 1], d = D[i + o.nx], e = D[i + o.nx + 1];
    if (fc + fr <= 1) return { z: a + fc * (b - a) + fr * (d - a), slope: Math.hypot(b - a, d - a) / o.cell };
    return { z: e + (1 - fc) * (d - e) + (1 - fr) * (b - e), slope: Math.hypot(e - d, e - b) / o.cell };
  }
  function water(o, x, y) {
    const c = Math.floor((x - o.x0) / o.cell), r = Math.floor((o.y1 - y) / o.cell);
    return c >= 0 && r >= 0 && c < o.nx && r < o.ny && !!bit(o.wbits, r * o.nx + c);
  }
  // a building's footprint (on a grid of half the cell), or the outer half of the band, where the ground is the far land's
  function blocked(o, x, y) {
    if (Math.min(x - o.x0, o.x1 - x, o.y1 - y, y - o.y0) < o.band * 0.5) return true;
    const h = o.cell / 2, c = Math.floor((x - o.x0) / h), r = Math.floor((o.y1 - y) / h);
    return c >= 0 && r >= 0 && c < 2 * o.nx && r < 2 * o.ny && !!bit(o.bbits, r * 2 * o.nx + c);
  }

  // ------------------------------------------------------------ drawing (world.js)
  // ctx: { DATA, texLoader, small, photoMaterial(tex) -> material (the city's photo grade), anisotropy }
  function build(G, ctx) {
    const T = THREE, group = new T.Group();
    group.name = 'outposts';
    const lin = h => new T.Color(h).convertSRGBToLinear();
    for (const o of list(G)) {
      // the ground: the tile's grid (every second point on a small device), draped with its photo
      const step = ctx.small ? 2 : 1, cols = Math.ceil((o.nx - 1) / step), rows = Math.ceil((o.ny - 1) / step);
      const w = o.x1 - o.x0, h = o.y1 - o.y0;
      const g = new T.PlaneGeometry(w, h, cols, rows);
      g.rotateX(-Math.PI / 2);
      g.translate(o.x0 + w / 2, 0, -(o.y1 - h / 2));
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = -p.getZ(i);
        p.setY(i, ground(o, x, y).z);
        uv.setXY(i, (x - o.x0 + o.cell / 2) / (o.nx * o.cell), (y - o.y0 + o.cell / 2) / (o.ny * o.cell)); // (the photo spans the cells, the grid their centres)
      }
      g.computeVertexNormals();
      const tex = ctx.texLoader.load(ctx.DATA + o.image);
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = ctx.anisotropy || 8;
      const m = new T.Mesh(g, ctx.photoMaterial(tex));
      m.receiveShadow = true;
      m.name = `outpost-${o.id}`;
      group.add(m);
      // the buildings, each on its footprint's oriented rectangle (farm buildings are rectangles; a wing's
      // corner is lost on the few that are not): weatherboard walls with a dark plinth and window bands to
      // the eaves, and a pitched roof, gabled on a long building and hipped on a squarer one. The roof's
      // colour is the photo's (pipeline/outposts.py); the walls' colour and the heights are judged
      const wallPos = [], wallCol = [], roofPos = [], roofCol = [];
      const push = (P, C, col, ...v) => { for (const q of v) { P.push(q[0], q[2], -q[1]); C.push(col.r, col.g, col.b); } };
      const quad = (P, C, col, a, b, c, d) => push(P, C, col, a, b, c, a, c, d);
      const glass = lin('#2b3238'), frameCol = lin('#f2efe8');
      for (const b of o.buildings || []) {
        const R = b.ring, n = R.length;
        let best = 0, ux = 1, uy = 0;
        for (let k = 0; k < n; k++) { const a = R[k], c = R[(k + 1) % n], l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > best) { best = l; ux = (c[0] - a[0]) / l; uy = (c[1] - a[1]) / l; } }
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const q of R) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        if (v1 - v0 > u1 - u0) { [ux, uy] = [-uy, ux]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; } // u along the long side
        const P = (u, v, z) => [u * ux - v * uy, u * uy + v * ux, z];
        const zb = b.z - 0.5, ze = b.z + b.eaves_m, zr = b.z + b.ridge_m, Lu = u1 - u0, Lv = v1 - v0;
        const wc = lin(b.wall || '#ece8dc').multiplyScalar(0.82), rc = lin(b.roof || '#7a3a30'), plinth = wc.clone().multiplyScalar(0.5);
        const C4 = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (let k = 0; k < 4; k++) {
          const [ua, va] = C4[k], [uc, vc] = C4[(k + 1) % 4], len = Math.hypot(uc - ua, vc - va), tu = (uc - ua) / len, tv = (vc - va) / len, nu = tv, nv = -tu;
          quad(wallPos, wallCol, plinth, P(ua, va, zb), P(uc, vc, zb), P(uc, vc, b.z + 0.45), P(ua, va, b.z + 0.45));
          quad(wallPos, wallCol, wc, P(ua, va, b.z + 0.45), P(uc, vc, b.z + 0.45), P(uc, vc, ze), P(ua, va, ze));
          // windows a little proud of the wall, every 3 m or so, clear of the corners
          const nw = Math.floor((len - 1.6) / 3);
          for (let i = 0; i < nw && b.eaves_m >= 2.3; i++) {
            const m = (len - 1.6) * (i + 0.5) / nw + 0.8, w = 0.55, za = b.z + 0.95, zz = Math.min(ze - 0.35, b.z + 2.2), e = 0.03;
            const W = (s, z) => P(ua + tu * (m + s) + nu * e, va + tv * (m + s) + nv * e, z);
            quad(wallPos, wallCol, frameCol, W(-w - 0.07, za - 0.07), W(w + 0.07, za - 0.07), W(w + 0.07, zz + 0.07), W(-w - 0.07, zz + 0.07));
            const W2 = (s, z) => P(ua + tu * (m + s) + nu * 2 * e, va + tv * (m + s) + nv * 2 * e, z);
            quad(wallPos, wallCol, glass, W2(-w, za), W2(w, za), W2(w, zz), W2(-w, zz));
          }
        }
        // the roof, 0.4 m over the walls
        const ov = 0.4, a0 = u0 - ov, a1 = u1 + ov, b0 = v0 - ov, b1 = v1 + ov, vm = (v0 + v1) / 2, zo = ze - ov * (zr - ze) / (Lv / 2);
        const dark = rc.clone().multiplyScalar(0.78), hip = Lu < Lv * 1.5 ? Math.min(Lv / 2, Lu / 2) : 0; // (hipped: the ridge stops short of the ends)
        quad(roofPos, roofCol, rc, P(a0, b0, zo), P(a1, b0, zo), P(a1 - hip, vm, zr), P(a0 + hip, vm, zr));
        quad(roofPos, roofCol, dark, P(a1, b1, zo), P(a0, b1, zo), P(a0 + hip, vm, zr), P(a1 - hip, vm, zr));
        if (hip) {
          push(roofPos, roofCol, rc, P(a0, b1, zo), P(a0, b0, zo), P(a0 + hip, vm, zr));
          push(roofPos, roofCol, dark, P(a1, b0, zo), P(a1, b1, zo), P(a1 - hip, vm, zr));
        } else { // the gable ends, in the walls' colour, from the eaves up
          push(wallPos, wallCol, wc, P(u0, v0, ze), P(u0, v1, ze), P(u0, vm, zr - 0.04));
          push(wallPos, wallCol, wc, P(u1, v1, ze), P(u1, v0, ze), P(u1, vm, zr - 0.04));
        }
      }
      for (const [pos, col, rough, metal] of [[wallPos, wallCol, 0.85, 0], [roofPos, roofCol, 0.55, 0.35]]) {
        if (!pos.length) continue;
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        bg.computeVertexNormals();
        const bm = new T.Mesh(bg, new T.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, side: T.DoubleSide }));
        bm.castShadow = bm.receiveShadow = true;
        group.add(bm);
      }
      // the wharf: a timber deck on piles over the water, its strip from game.json "surfaces"
      for (const s of (G.surfaces || []).filter(q => q.outpost === o.id)) {
        const u0 = s.profile[0][0], u1 = s.profile[s.profile.length - 1][0], zt = s.profile[s.profile.length - 1][1], hw = s.half_width;
        const P = (u, v, z) => new T.Vector3(s.origin[0] + s.axis[0] * u - s.axis[1] * v, z, -(s.origin[1] + s.axis[1] * u + s.axis[0] * v));
        const deck = new T.BoxGeometry(1, 1, 1), piles = [], timber = new T.MeshStandardMaterial({ color: lin('#7d6650'), roughness: 0.9 }), dark = new T.MeshStandardMaterial({ color: lin('#4a3d31'), roughness: 0.95 });
        const dm = new T.Mesh(deck, timber), L = u1 - u0;
        dm.scale.set(L, 0.35, 2 * hw);
        dm.position.copy(P((u0 + u1) / 2, 0, zt - 0.175));
        dm.rotation.y = Math.atan2(s.axis[1], s.axis[0]);
        dm.castShadow = dm.receiveShadow = true;
        group.add(dm);
        // the piles in pairs every 3 m, the kerb timbers along its edges
        const pile = new T.CylinderGeometry(0.16, 0.18, 1, 8);
        for (let u = u0 + 0.6; u <= u1 - 0.3; u += 3) for (const v of [-hw + 0.3, hw - 0.3]) {
          const q = P(u, v, 0), gz = ground(o, q.x, -q.z).z, top = zt - 0.35, bot = Math.min(gz, -0.5) - 0.5;
          const pm = new T.Mesh(pile, dark);
          pm.scale.set(1, top - bot, 1); pm.position.set(q.x, (top + bot) / 2, q.z);
          piles.push(pm);
        }
        for (const v of [-hw + 0.1, hw - 0.1]) {
          const km = new T.Mesh(deck, dark);
          km.scale.set(L, 0.22, 0.2); km.position.copy(P((u0 + u1) / 2, v, zt + 0.11)); km.rotation.y = dm.rotation.y;
          group.add(km);
        }
        for (const pm of piles) group.add(pm);
      }
    }
    return group;
  }

  return { list, holes, blend, at, ground, water, blocked, build };
})();
