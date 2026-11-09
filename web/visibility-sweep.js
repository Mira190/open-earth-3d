// What can be seen from a point of the city: a horizon sweep over the occluder raster that
// pipeline/visibility.py bakes (issue 358, B1). Used by visibility-worker.js in the page and by
// tools/vis_unit.js in Node. No three.js, no DOM.
//
// The city is 2.5D: an occluder stands solid from the ground to its top. So
//   - a higher eye sees everything a lower eye at the same place sees: an answer for an eye at z holds
//     for every eye below it;
//   - if any point of a column can be seen, so can its top: a thing is tested by its top alone;
//   - behind an occluder of top o at distance d from an eye at height e, nothing below the line
//     e + (o - e) / d * r can be seen at distance r. That "shadow height" only rises along a ray.
// A beam is a wedge of the circle. Its horizon at a radius is the lowest occluder along the whole chord
// across the wedge there, so it holds for every ray inside. The chord is read from a min-pyramid at points
// no further apart than the level's guard allows (the baked raster's pixel is the lowest within 0.5 m of
// it, and each coarser level is the lowest of a pixel and the ring round it), so no point between two
// samples lies in a pixel higher than what was read. With the occluders shrunk by eps first, what is hidden
// from the eye is hidden from every point within eps of it (occluder shrinking, Wonka, Wimmer and
// Schmalstieg 2000), which is the room the camera has until the next sweep. The result is conservative: a
// thing reported hidden cannot be seen.
'use strict';
(function (root) {
  const CELL = 16; // the answer's grid (m), on a lattice anchored at the frame's origin 0, 0

  // head: vis.bin's header; raster: its bytes (rows from the south); terrain: { data (Float32Array or
  // array, m), nx, ny, cell, x0, y1 }, nodes from the north-west corner, rows going south (game.json)
  function model(head, raster, terrain) {
    const { w, h, px, x0, y0, z0, q } = head;
    // the terrain as an occluder: the lowest node within two nodes of each node, less a metre, in the
    // raster's steps (0: under the lowest step, no occluder)
    let tq = null, zmax = head.zmax;
    if (terrain && terrain.data) {
      // nothing asked about stands higher than the buildings, the landmarks or 60 m over the highest ground (a tree on a hill)
      let hi = -Infinity; for (let i = 0; i < terrain.data.length; i++) if (terrain.data[i] > hi) hi = terrain.data[i];
      zmax = Math.max(zmax, hi + 60);
      const { nx, ny, data } = terrain, low = new Float32Array(nx * ny), tmp = new Float32Array(nx * ny);
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { let m = Infinity; for (let k = Math.max(0, c - 2); k <= Math.min(nx - 1, c + 2); k++) m = Math.min(m, data[r * nx + k]); tmp[r * nx + c] = m; }
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { let m = Infinity; for (let k = Math.max(0, r - 2); k <= Math.min(ny - 1, r + 2); k++) m = Math.min(m, tmp[k * nx + c]); low[r * nx + c] = m; }
      tq = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) {
        const y = y0 + (j + 0.5) * px, tr = Math.max(0, Math.min(ny - 1, Math.round((terrain.y1 - y) / terrain.cell)));
        for (let i = 0; i < w; i++) {
          const x = x0 + (i + 0.5) * px, tc = Math.max(0, Math.min(nx - 1, Math.round((x - terrain.x0) / terrain.cell)));
          const v = Math.floor((low[tr * nx + tc] - 1 - z0) / q) + 1;
          tq[j * w + i] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    const gx0 = Math.floor(x0 / CELL) * CELL, gy0 = Math.floor(y0 / CELL) * CELL;
    return { w, h, px, x0, y0, z0, q, zmax, base: raster, tq, tiers: new Map(),
      grid: { cell: CELL, x0: gx0, y0: gy0, nx: Math.ceil((x0 + w * px - gx0) / CELL), ny: Math.ceil((y0 + h * px - gy0) / CELL) } };
  }

  // the lowest value within k pixels (a square), in place of each: two passes, the edge counted as none
  function shrink(src, w, h, k) {
    if (!k) return src.slice();
    const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const o = j * w;
      for (let i = 0; i < w; i++) {
        if (i < k || i >= w - k) { a[o + i] = 0; continue; }
        let m = 255; for (let d = -k; d <= k; d++) { const v = src[o + i + d]; if (v < m) m = v; }
        a[o + i] = m;
      }
    }
    for (let j = 0; j < h; j++) {
      const o = j * w;
      if (j < k || j >= h - k) continue; // (b is zero there)
      for (let i = 0; i < w; i++) { let m = 255; for (let d = -k; d <= k; d++) { const v = a[o + d * w + i]; if (v < m) m = v; } b[o + i] = m; }
    }
    return b;
  }

  // the occluders shrunk by eps (a whole number of pixels), with the terrain, as a min-pyramid
  function tier(M, eps) {
    const k = Math.ceil(eps / M.px - 1e-9);
    if (M.tiers.has(k)) { const t = M.tiers.get(k); M.tiers.delete(k); M.tiers.set(k, t); return t; } // (the latest used last)
    while (M.tiers.size >= (M.keep || 2)) M.tiers.delete(M.tiers.keys().next().value); // a tier is the raster's size again and a third: two at most
    const e = shrink(M.base, M.w, M.h, k);
    if (M.tq) for (let i = 0; i < e.length; i++) if (M.tq[i] > e[i]) e[i] = M.tq[i];
    const levels = [{ data: e, w: M.w, h: M.h }];
    let plain = e, pw = M.w, ph = M.h;
    while (Math.min(pw, ph) >= 64 && levels.length < 7) {
      const nw = pw >> 1, nh = ph >> 1, p = new Uint8Array(nw * nh);
      for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
        const o = 2 * j * pw + 2 * i;
        p[j * nw + i] = Math.min(plain[o], plain[o + 1], plain[o + pw], plain[o + pw + 1]);
      }
      levels.push({ data: shrink(p, nw, nh, 1), w: nw, h: nh });
      plain = p; pw = nw; ph = nh;
    }
    const t = { eps: k * M.px, levels };
    M.tiers.set(k, t);
    return t;
  }

  // From the eye (x, y in the frame's metres, z up), the height under which nothing can be seen in each
  // cell of the grid: -Infinity where the ground itself may be seen, Infinity where nothing of any height
  // can. Returns null when the eye stands in an occluder (inside a building: no answer).
  // opt.beams: wedges round the circle (720); opt.samples: the most reads across a wedge (6).
  function sweep(M, T, x, y, z, opt = {}) {
    const { w, h, px, z0, q, zmax } = M, G = M.grid, ipx = 1 / px;
    const ex = (x - M.x0) * ipx, ey = (y - M.y0) * ipx; // the eye in pixels
    const L0 = T.levels[0].data;
    if (ex >= 1 && ey >= 1 && ex < w - 1 && ey < h - 1) {
      const i = Math.floor(ex), j = Math.floor(ey);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const v = L0[(j + b) * w + i + a]; if (v && z0 + (v - 1) * q > z) return null; }
    }
    const NB = opt.beams || 720, NS = opt.samples || 6, dth = 2 * Math.PI / NB, ta = Math.tan(dth / 2), ca = Math.cos(dth / 2);
    const S = new Float32Array(G.nx * G.ny).fill(Infinity), nx = G.nx, ny = G.ny, ic = 1 / G.cell;
    const gx = (M.x0 - G.x0), gy = (M.y0 - G.y0); // the raster's origin on the grid (m)
    const nl = T.levels.length, W = w * px, H = h * px, X0 = (x - M.x0), Y0 = (y - M.y0); // the eye in metres from the raster's corner
    for (let b = 0; b < NB; b++) {
      const th = (b + 0.5) * dth, cx = Math.cos(th), cy = Math.sin(th);
      let m = -Infinity, rp = 0, r = 1;
      for (;;) {
        // what stands between the last radius and this one: no lower than the shadow so far
        const mid = 0.5 * (rp + r), hx = 0.5 * (r - rp) + r * ta + 0.01, mx = X0 + cx * mid, my = Y0 + cy * mid;
        if (mx + hx < 0 || my + hx < 0 || mx - hx >= W || my - hx >= H) break;
        const sh = m === -Infinity ? -Infinity : z + Math.min(m * rp, m * r);
        if (sh > zmax) break; // over everything from here on
        let ia = Math.floor((mx - hx + gx) * ic), ib = Math.floor((mx + hx + gx) * ic), ja = Math.floor((my - hx + gy) * ic), jb = Math.floor((my + hx + gy) * ic);
        if (ia < 0) ia = 0; if (ja < 0) ja = 0; if (ib >= nx) ib = nx - 1; if (jb >= ny) jb = ny - 1;
        for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) { const k = j * nx + i; if (sh < S[k]) S[k] = sh; }
        // the occluders across the wedge at this radius
        const X = X0 + cx * r, Y = Y0 + cy * r, a = r * ta, len = 2 * a;
        let l = 0, step = 0.7;
        while (l < nl - 1 && Math.ceil(len / step) + 1 > NS) { l++; step = px * (1 << l); }
        const n = Math.max(2, Math.ceil(len / step) + 1), lv = T.levels[l], D = lv.data, lw = lv.w, lh = lv.h, is = ipx / (1 << l);
        let o = 255;
        for (let k = 0; k < n; k++) {
          const t = -a + len * k / (n - 1), u = (X - cy * t) * is, v = (Y + cx * t) * is;
          if (u < 0 || v < 0 || u >= lw || v >= lh) { o = 0; break; }
          const p = D[Math.floor(v) * lw + Math.floor(u)];
          if (p < o) { o = p; if (!o) break; }
        }
        if (o) { const top = z0 + (o - 1) * q, s = (top - z) / (top > z ? r / ca : r); if (s > m) m = s; }
        rp = r; r += Math.max(1, r * dth);
      }
    }
    return S;
  }

  const api = { CELL, model, tier, sweep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OEVisSweep = api;
})(typeof self !== 'undefined' ? self : this);
