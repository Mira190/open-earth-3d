// Open Earth 3D quays: the seawalls of every city's built shores, for the model viewer and the
// game (world.js builds them, game/nav.js walks to them).
//
// The terrain grids (10 m in the viewer, 5 m round the player in the game) cannot turn a corner
// at a quay wall: between the last point on land and the first in the water the ground slopes up
// out of the water for up to a cell, draped with the aerial photo as a grey ramp. shore.png
// (pipeline/shore.py) holds the signed distance to the shoreline at 2.5 m, and which shores are
// sand or rock; every other shore is built. Along the built ones this module:
//   - finds the shoreline (the distance's zero, by marching squares) and draws a wall on it: a
//     stone face from below the water up to the level of the land behind, a coping on top, and
//     the bottom at the foot of the wall;
//   - raises the grid's points just out in the water to that level, so the ground meets the wall
//     level instead of sloping down to it (raise(), for the ground drawn and for walking);
//   - marks the band out in the water where the ground is not drawn above the water (the mask
//     the ground shader reads, world.js clipGround);
//   - says where a walker stops: with its toes at the coping's edge, EDGE short of the face as
//     drawn (water(), measured to the walls drawn here and to a landmark's own, `faces`).
// A wall is left out where the land behind is higher than MAX_TOP (a hillside down to a moat
// is not one wall) and where a landmark draws its own (skip(x, y), Sydney's Bennelong Point).
// Frame: local x east, y north; heights in metres above the water (0).
'use strict';
window.OEQuays = (function () {
  const MIN_TOP = 0.4, MAX_TOP = 9.0, EDGE = 0.15; // m; a walker's centre stops EDGE back from the wall's face (its toes at the coping's edge)
  const COPING = { w: 0.9, h: 0.22, lip: 0.06, up: 0.1 }, OUT = 0.2; // depth back from the face, thickness, overhang, height above the ground

  // shore: {px: RGBA bytes of shore.png, nx, ny, cell, x0, y1, floor_m}; fine: the finest terrain grid
  // there is (the walls' heights come from it); band: how far out in the water the coarsest grid
  // drawn reaches past the shoreline (1.5 of its cells); skip(x, y): a landmark's own seawall there;
  // faces: that seawall's face as the landmark draws it, polylines [[x, y], ...] with the water on their right
  function create(shore, fine, { band = 15, skip = null, faces = [] } = {}) {
    const { px, nx, ny, cell: cs, x0, y1 } = shore, N = nx * ny;
    const D = new Float32Array(N), built = new Uint8Array(N), D0 = D;
    for (let i = 0; i < N; i++) {
      D[i] = (px[4 * i] - 128) / 2;
      built[i] = px[4 * i + 1] < 128 && px[4 * i + 2] < 128 ? 1 : 0;
    }
    // signed distance at (x, y), bilinear between pixel centres (water positive)
    function dist(x, y) {
      const c = Math.max(0, Math.min(nx - 1.001, (x - x0) / cs - 0.5)), r = Math.max(0, Math.min(ny - 1.001, (y1 - y) / cs - 0.5));
      const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * nx + c0;
      return (D[i] * (1 - fc) + D[i + 1] * fc) * (1 - fr) + (D[i + nx] * (1 - fc) + D[i + nx + 1] * fc) * fr;
    }
    const pix = (x, y) => {
      const c = Math.floor((x - x0) / cs), r = Math.floor((y1 - y) / cs);
      return c < 0 || r < 0 || c >= nx || r >= ny ? -1 : r * nx + c;
    };

    // the level of the land behind the shore near (x, y): the fine grid's points on land (more than
    // 0.75 m in from the shoreline, above the water) within 1.6 cells, nearer ones counting more
    const F = fine, fd = new Float32Array(F.nx * F.ny);
    for (let r = 0; r < F.ny; r++) for (let c = 0; c < F.nx; c++) {
      const k = pix(F.x0 + c * F.cell, F.y1 - r * F.cell);
      fd[r * F.nx + c] = k < 0 ? 64 : D[k];
    }
    function landLevel(x, y) {
      for (let pass = 0; pass < 2; pass++) {
        const R = (pass ? 2.6 : 1.6) * F.cell, ca = Math.max(0, Math.floor((x - R - F.x0) / F.cell)), cb = Math.min(F.nx - 1, Math.ceil((x + R - F.x0) / F.cell));
        const ra = Math.max(0, Math.floor((F.y1 - y - R) / F.cell)), rb = Math.min(F.ny - 1, Math.ceil((F.y1 - y + R) / F.cell));
        let sw = 0, sh = 0;
        for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
          const k = r * F.nx + c, h = F.data[k];
          if (fd[k] > -0.75 || h < 0.15) continue;
          const dd = Math.hypot(F.x0 + c * F.cell - x, F.y1 - r * F.cell - y);
          if (dd > R) continue;
          const w = 1 / (1 + dd * dd);
          sw += w; sh += w * h;
        }
        if (sw > 0) return sh / sw;
      }
      return NaN;
    }
    // the quay's level (NaN where there is no quay) at each pixel within the band either side of a
    // built shore, and Q: the water pixels of the band along a quay
    const bandPx = Math.ceil(band / cs);
    const TOP = new Float32Array(N).fill(NaN), Q = new Uint8Array(N);
    const edge = new Uint8Array(N);
    for (let i = 0; i < N; i++) edge[i] = D[i] > 0 && D[i] < cs && built[i] ? 1 : 0;
    const near = dilate(edge, nx, ny, bandPx);
    let quayPixels = 0;
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c, d = D[i];
      if (!near[i] || d > band || d < -band || (d > 0 && !built[i])) continue;
      const t = landLevel(x0 + (c + 0.5) * cs, y1 - (r + 0.5) * cs);
      if (!(t <= MAX_TOP)) continue;
      TOP[i] = Math.max(MIN_TOP, t);
      if (d > 0) { Q[i] = 1; quayPixels++; }
    }
    // where the ground is not drawn above the water, and where a walker stops at the wall: the band
    // along a quay out to where the coarsest grid's ramp ends, both sides of the shoreline
    const zone = dilate(Q, nx, ny, bandPx + 2);
    const topAt = (x, y) => { const k = pix(x, y); return k < 0 ? NaN : TOP[k]; };

    // ---------------------------------------------------------- the terrain, raised to the quay
    const raised = new WeakMap(), raisedDrawn = new WeakMap();
    // a copy of grid T whose points out in the water within the band along a quay (and points on land
    // beside one that lie below the water, where the DEM took the river for land) stand at the quay's level
    // (drawn: as the ground is drawn, which leaves a landmark's own seawall and paving to it: there the
    // ground is not drawn above the water, and raised it would leave the bottom open)
    function raise(T, drawn = false) {
      const cache = drawn ? raisedDrawn : raised;
      if (cache.has(T)) return cache.get(T);
      const data = Float32Array.from(T.data), up = new Uint8Array(data.length);
      // a point out in the water is raised only where one of the eight round it is on land: those are
      // the cells that slope from the land down to the bed. Every point within the band was raised
      // before, which on the viewer's 10 m grid lifted 15 m out from each bank, most of a 40-60 m river
      const landNear = (x, y) => {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const k = pix(x + dc * T.cell, y + dr * T.cell);
          if (k >= 0 && D[k] <= 0) return true;
        }
        return false;
      };
      let n = 0;
      for (let r = 0; r < T.ny; r++) for (let c = 0; c < T.nx; c++) {
        const x = T.x0 + c * T.cell, y = T.y1 - r * T.cell, k = pix(x, y);
        if (k < 0 || !zone[k] || Number.isNaN(TOP[k]) || (drawn && skip && skip(x, y))) continue;
        const i = r * T.nx + c;
        if (D[k] > 0 ? Q[k] && landNear(x, y) : data[i] < 0.15) { data[i] = TOP[k]; up[i] = 1; n++; }
      }
      const out = Object.assign({}, T, { data, up, quayPoints: n });
      cache.set(T, out);
      return out;
    }

    // ---------------------------------------------------------- the shoreline along the quays
    // marching squares on the distance between pixel centres, in the cells with a quay pixel; the
    // crossings are keyed by the edge they lie on, which chains the pieces into lines
    function shorelines() {
      // on the distance smoothed a little: shore.png's half-metre steps would put a wobble in a straight wall
      const D = blur(D0, nx, ny, 2);
      const pt = new Map(), link = new Map();
      const at = (i, j) => [x0 + (j + 0.5) * cs, y1 - (i + 0.5) * cs];
      const cross = (id, ia, ja, ib, jb) => {
        if (!pt.has(id)) {
          const a = D[ia * nx + ja], b = D[ib * nx + jb], t = a / (a - b), pa = at(ia, ja), pb = at(ib, jb);
          pt.set(id, [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]);
        }
        return id;
      };
      const join = (a, b) => {
        (link.get(a) || link.set(a, []).get(a)).push(b);
        (link.get(b) || link.set(b, []).get(b)).push(a);
      };
      for (let i = 0; i < ny - 1; i++) for (let j = 0; j < nx - 1; j++) {
        const k = i * nx + j;
        if (!(Q[k] || Q[k + 1] || Q[k + nx] || Q[k + nx + 1])) continue;
        const a = D[k] > 0, b = D[k + 1] > 0, c = D[k + nx + 1] > 0, d = D[k + nx] > 0;
        const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
        if (code === 0 || code === 15) continue;
        // the four edges: top (a-b), right (b-c), bottom (d-c), left (a-d)
        const T = () => cross(2 * k, i, j, i, j + 1), R = () => cross(2 * (k + 1) + 1, i, j + 1, i + 1, j + 1);
        const B = () => cross(2 * (k + nx), i + 1, j, i + 1, j + 1), L = () => cross(2 * k + 1, i, j, i + 1, j);
        switch (code) {
          case 1: case 14: join(L(), B()); break;
          case 2: case 13: join(B(), R()); break;
          case 3: case 12: join(L(), R()); break;
          case 4: case 11: join(T(), R()); break;
          case 6: case 9: join(T(), B()); break;
          case 7: case 8: join(L(), T()); break;
          case 5: case 10: { // a saddle: by the mean, which way the water runs through the cell
            const wet = D[k] + D[k + 1] + D[k + nx] + D[k + nx + 1] > 0;
            if ((code === 5) === wet) { join(L(), T()); join(B(), R()); } else { join(L(), B()); join(T(), R()); }
          }
        }
      }
      const done = new Set(), lines = [];
      const walk = start => {
        const line = [start];
        done.add(start);
        for (let cur = start; ;) {
          const nxt = (link.get(cur) || []).find(e => !done.has(e));
          if (nxt === undefined) {
            if ((link.get(cur) || []).includes(start) && line.length > 2) line.push(start); // a loop closes
            break;
          }
          done.add(nxt); line.push(nxt); cur = nxt;
        }
        return line;
      };
      for (const [id, l] of link) if (l.length === 1 && !done.has(id)) lines.push(walk(id)); // the open lines from an end
      for (const id of link.keys()) if (!done.has(id)) lines.push(walk(id));                 // then the loops
      return lines.map(l => l.map(id => pt.get(id))).filter(l => l.length > 1);
    }

    // the walls: runs of [x, y, nx, ny, top] (the outward normal points into the water), simplified,
    // broken where the quay ends (no level, too high) or a landmark draws its own seawall
    let runsMade = null;
    function walls() {
      if (runsMade) return runsMade;
      // the coping sits on the ground as drawn behind it, never under it (the fine grid, raised)
      const G = raise(F, true), ground = (x, y) => {
        const c = Math.max(0, Math.min(G.nx - 1.001, (x - G.x0) / G.cell)), r = Math.max(0, Math.min(G.ny - 1.001, (G.y1 - y) / G.cell));
        const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * G.nx + c0, d = G.data;
        const a = d[i], b = d[i + 1], q = d[i + G.nx], e = d[i + G.nx + 1];
        return fc + fr <= 1 ? a + fc * (b - a) + fr * (q - a) : e + (1 - fc) * (q - e) + (1 - fr) * (b - e); // as the tiles split their cells
      };
      const runs = [];
      for (const line of shorelines()) {
        const pts = simplify(line, 0.35);
        let run = [];
        const flush = () => { if (run.length > 1) runs.push(run); run = []; };
        for (let k = 0; k < pts.length; k++) {
          const [x, y] = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1];
          if (pts.length > 2 && k > 0 && k < pts.length - 1) { // the bisector, so that a corner keeps its wall's thickness
            const l1 = Math.hypot(x - a[0], y - a[1]) || 1, l2 = Math.hypot(b[0] - x, b[1] - y) || 1;
            tx = (x - a[0]) / l1 + (b[0] - x) / l2; ty = (y - a[1]) / l1 + (b[1] - y) / l2;
          }
          const tl = Math.hypot(tx, ty) || 1;
          let n = [ty / tl, -tx / tl];
          if (dist(x + n[0], y + n[1]) < dist(x - n[0], y - n[1])) n = [-n[0], -n[1]];
          let t = topAt(x + n[0] * 1.3, y + n[1] * 1.3);
          if (Number.isNaN(t)) t = topAt(x - n[0] * 1.3, y - n[1] * 1.3);
          if (Number.isNaN(t) || (skip && skip(x, y))) { flush(); continue; }
          for (const back of [0.1, 0.3, COPING.w / 2, COPING.w - 0.05]) t = Math.max(t, ground(x + n[0] * (OUT - back), y + n[1] * (OUT - back)));
          // a little out from the line, so that the ground cut off at the shoreline ends under the coping
          run.push([x + n[0] * OUT, y + n[1] * OUT, n[0], n[1], t]);
        }
        flush();
      }
      // each run goes with the water on its right, so that its faces wind towards the water
      for (const run of runs) {
        let s = 0;
        for (let k = 0; k < run.length - 1; k++) s += (run[k + 1][1] - run[k][1]) * run[k][2] - (run[k + 1][0] - run[k][0]) * run[k][3];
        if (s < 0) run.reverse();
      }
      // the level along a run: the highest of each point and its neighbours, so that the ground between
      // two points stays under the coping too
      for (const run of runs) {
        const t = run.map(p => p[4]), L = run.length - 1;
        const m = t.map((_, k) => Math.max(t[Math.max(0, k - 1)], t[k], t[Math.min(L, k + 1)]));
        // then evened out along it (a coping runs level, not in steps), never below its own point
        for (let k = 0; k <= L; k++) run[k][4] = Math.max(t[k], (m[Math.max(0, k - 1)] + 2 * m[k] + m[Math.min(L, k + 1)]) / 4);
      }
      return (runsMade = runs);
    }

    // the geometry of the walls, in chunks of about 500 m for culling; two groups: the face (uv:
    // metres along, metres above the water) and the coping
    function geometries(runs, floor) {
      const CH = 500, chunks = new Map();
      const chunk = (x, y) => {
        const key = `${Math.floor(x / CH)},${Math.floor(y / CH)}`;
        if (!chunks.has(key)) chunks.set(key, [[], []].map(() => ({ p: [], n: [], uv: [], i: [] })));
        return chunks.get(key);
      };
      const quad = (g, a, b, c, d, na, nb, nc, nd, ua, ub, uc, ud) => {
        const o = g.p.length / 3;
        for (const [p, n, u] of [[a, na, ua], [b, nb, ub], [c, nc, uc], [d, nd, ud]]) { g.p.push(p[0], p[2], -p[1]); g.n.push(n[0], n[2], -n[1]); g.uv.push(u[0], u[1]); }
        g.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
      };
      const foot = -(floor + 0.1), up = [0, 0, 1];
      let total = 0;
      for (const run of runs) {
        let s = 0;
        // each piece's own normal (the water on its right); at a sharp corner a piece ends square on it
        // rather than on the bisector, which would pinch the coping
        const seg = run.slice(0, -1).map((p, k) => { const q = run[k + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[1] - p[1]) / L, -(q[0] - p[0]) / L]; });
        const sharp = k => k > 0 && k < seg.length && seg[k][0] * seg[k - 1][0] + seg[k][1] * seg[k - 1][1] < 0.7;
        for (let k = 0; k < run.length - 1; k++) {
          let [ax, ay, anx, any, at] = run[k], [bx, by, bnx, bny, bt] = run[k + 1];
          if (sharp(k)) [anx, any] = seg[k];
          if (sharp(k + 1)) [bnx, bny] = seg[k];
          const len = Math.hypot(bx - ax, by - ay), s1 = s + len;
          const [face, coping] = chunk((ax + bx) / 2, (ay + by) / 2);
          const na = [anx, any, 0], nb = [bnx, bny, 0];
          // the face, facing the water, from below the bottom up under the coping
          quad(face, [ax, ay, foot], [bx, by, foot], [bx, by, bt + COPING.up - COPING.h], [ax, ay, at + COPING.up - COPING.h],
            na, nb, nb, na, [s, foot], [s1, foot], [s1, bt + COPING.up - COPING.h], [s, at + COPING.up - COPING.h]);
          // the coping: its front, a little proud of the face, and its top back onto the ground
          const L = COPING.lip, W = COPING.w;
          const fa = [ax + anx * L, ay + any * L], fb = [bx + bnx * L, by + bny * L];
          quad(coping, [fa[0], fa[1], at + COPING.up - COPING.h], [fb[0], fb[1], bt + COPING.up - COPING.h], [fb[0], fb[1], bt + COPING.up], [fa[0], fa[1], at + COPING.up],
            na, nb, nb, na, [s, 0], [s1, 0], [s1, COPING.h], [s, COPING.h]);
          const ka = [ax - anx * W, ay - any * W], kb = [bx - bnx * W, by - bny * W];
          quad(coping, [fa[0], fa[1], at + COPING.up], [fb[0], fb[1], bt + COPING.up], [kb[0], kb[1], bt + COPING.up], [ka[0], ka[1], at + COPING.up],
            up, up, up, up, [s, 0], [s1, 0], [s1, W], [s, W]);
          // and its back, down into the ground, where the land falls away behind it
          const ba = [-anx, -any, 0], bb = [-bnx, -bny, 0];
          quad(coping, [kb[0], kb[1], bt + COPING.up - COPING.h - 0.3], [ka[0], ka[1], at + COPING.up - COPING.h - 0.3], [ka[0], ka[1], at + COPING.up], [kb[0], kb[1], bt + COPING.up],
            bb, ba, ba, bb, [s1, 0], [s, 0], [s, COPING.h], [s1, COPING.h]);
          s = s1;
        }
        total += s;
      }
      const geos = [];
      for (const parts of chunks.values()) {
        const g = new THREE.BufferGeometry(), p = [], n = [], uv = [], idx = [];
        parts.forEach((q, m) => {
          const o = p.length / 3, start = idx.length;
          for (const v of q.p) p.push(v);
          for (const v of q.n) n.push(v);
          for (const v of q.uv) uv.push(v);
          for (const v of q.i) idx.push(v + o);
          g.addGroup(start, q.i.length, m);
        });
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        geos.push(g);
      }
      return { geos, length: total };
    }

    // the mask the ground shader reads (r: in the band along a quay), at the shore map's pixels
    function maskTexture() {
      const data = new Uint8Array(N);
      for (let i = 0; i < N; i++) data[i] = zone[i] ? 255 : 0;
      const tex = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
      tex.unpackAlignment = 1;
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      return tex;
    }

    // the faces as drawn, in 4 m buckets: the walls' runs here (their points stand on the face) and a
    // landmark's own; each segment [ax, ay, bx, by, nx, ny] with n its normal out over the water
    let segs = null;
    const SB = 4, skey = (i, j) => i * 65536 + j;
    function faceSegments() {
      if (segs) return segs;
      segs = new Map();
      const add = (a, b) => {
        const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
        if (L < 1e-3) return;
        const s = [a[0], a[1], b[0], b[1], ey / L, -ex / L];
        const i0 = Math.floor(Math.min(a[0], b[0]) / SB) - 1, i1 = Math.floor(Math.max(a[0], b[0]) / SB) + 1;
        const j0 = Math.floor(Math.min(a[1], b[1]) / SB) - 1, j1 = Math.floor(Math.max(a[1], b[1]) / SB) + 1;
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const k = skey(i, j);
          if (!segs.has(k)) segs.set(k, []);
          segs.get(k).push(s);
        }
      };
      for (const run of walls()) for (let k = 0; k < run.length - 1; k++) add(run[k], run[k + 1]); // (the water on the right)
      for (const f of faces) for (let k = 0; k < f.length - 1; k++) add(f[k], f[k + 1]);
      return segs;
    }
    // the signed distance from (x, y) to the nearest face drawn within a few metres (positive out over
    // the water), or null where none is drawn
    function face(x, y) {
      const list = faceSegments().get(skey(Math.floor(x / SB), Math.floor(y / SB)));
      if (!list) return null;
      let best = Infinity, sd = null;
      for (const [ax, ay, bx, by, nx_, ny_] of list) {
        const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
        const px_ = ax + ex * t, py_ = ay + ey * t, d = Math.hypot(x - px_, y - py_);
        if (d < best - 1e-6) {
          best = d;
          // the side: by the segment's normal (at a corner, beyond the segment's end, by the offset's own direction)
          sd = ((x - px_) * nx_ + (y - py_) * ny_) >= 0 ? d : -d;
        }
      }
      return best <= SB ? sd : null;
    }
    // a walker by a quay is in the water from EDGE short of the wall's face as drawn; null away from the quays
    function water(x, y) {
      const k = pix(x, y);
      const f = face(x, y);
      if (f !== null && (k >= 0 && zone[k] || Math.abs(f) < 1.5)) return f > -EDGE;
      if (k < 0 || !zone[k]) return null;
      return dist(x, y) > -EDGE;
    }

    return { dist, face, topAt, raise, walls, geometries, maskTexture, water, box: [x0, y1, nx * cs, ny * cs], quayPixels };
  }

  // a [1 2 1] / 4 filter, n passes each way
  function blur(src, nx, ny, n) {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let p = 0; p < n; p++) {
      for (let y = 0; y < ny; y++) {
        const o = y * nx;
        b[o] = a[o]; b[o + nx - 1] = a[o + nx - 1];
        for (let x = 1; x < nx - 1; x++) b[o + x] = 0.25 * (a[o + x - 1] + 2 * a[o + x] + a[o + x + 1]);
      }
      for (let x = 0; x < nx; x++) { a[x] = b[x]; a[(ny - 1) * nx + x] = b[(ny - 1) * nx + x]; }
      for (let y = 1; y < ny - 1; y++) for (let x = 0; x < nx; x++) a[y * nx + x] = 0.25 * (b[(y - 1) * nx + x] + 2 * b[y * nx + x] + b[(y + 1) * nx + x]);
    }
    return a;
  }

  // a square neighbourhood's maximum, r pixels each way (two passes of a running count)
  function dilate(m, nx, ny, r) {
    const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
    for (let y = 0; y < ny; y++) {
      let n = 0;
      const o = y * nx;
      for (let x = 0; x < Math.min(r, nx); x++) n += m[o + x];
      for (let x = 0; x < nx; x++) {
        if (x + r < nx) n += m[o + x + r];
        if (x - r - 1 >= 0) n -= m[o + x - r - 1];
        tmp[o + x] = n > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < nx; x++) {
      let n = 0;
      for (let y = 0; y < Math.min(r, ny); y++) n += tmp[y * nx + x];
      for (let y = 0; y < ny; y++) {
        if (y + r < ny) n += tmp[(y + r) * nx + x];
        if (y - r - 1 >= 0) n -= tmp[(y - r - 1) * nx + x];
        out[y * nx + x] = n > 0 ? 1 : 0;
      }
    }
    return out;
  }

  // Douglas-Peucker on a polyline of [x, y] (tolerance m)
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      let worst = -1, wd = tol;
      for (let k = a + 1; k < b; k++) {
        const d = L > 1e-9 ? Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
        if (d > wd) { wd = d; worst = k; }
      }
      if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    // and no piece longer than 6 m, so that the level along it follows the land
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      if (!keep[k]) continue;
      if (out.length) {
        const p = out[out.length - 1], q = pts[k], L = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(L / 6);
        for (let j = 1; j < m; j++) out.push([p[0] + (q[0] - p[0]) * j / m, p[1] + (q[1] - p[1]) * j / m]);
      }
      out.push(pts[k]);
    }
    return out;
  }

  return { create, dilate, simplify, EDGE };
})();
