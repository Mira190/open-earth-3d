// Navigation over the depth grid: a 120 m clearance grid (water deeper than `MIN` metres, eroded a little so hulls
// keep off the reef), A* with a preference for deeper water, and line-of-sight smoothing. Positions are in the local
// frame (x east, north), metres.
const CELL = 120, MIN = 4.5;

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

export function createNav(ctx) {
  const t = ctx.d.scene.terrain, x0 = t.x0, y1 = t.y1, x1 = t.x0 + t.w * t.cell_m, y0 = t.y1 - t.h * t.cell_m;
  const nx = Math.ceil((x1 - x0) / CELL), ny = Math.ceil((y1 - y0) / CELL);
  const depthAt = (x, n) => ctx.depth(x, n);
  const clear = new Float32Array(nx * ny);                 // min depth in the cell and its surroundings
  const cx = i => x0 + (i + 0.5) * CELL, cy = j => y1 - (j + 0.5) * CELL;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let m = 1e9; const x = cx(i), n = cy(j);
    for (const [ox, oy] of [[0, 0], [50, 0], [-50, 0], [0, 50], [0, -50]]) m = Math.min(m, depthAt(x + ox, n + oy));
    clear[j * nx + i] = m;
  }
  const ok = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && clear[j * nx + i] > MIN;
  // erode once: a navigable cell needs navigable 4-neighbours, which keeps routes off narrow gaps
  const nav = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nav[j * nx + i] = (ok(i, j) && ok(i + 1, j) && ok(i - 1, j) && ok(i, j + 1) && ok(i, j - 1)) ? 1 : 0;
  const cell = (x, n) => [Math.floor((x - x0) / CELL), Math.floor((y1 - n) / CELL)];
  const isNav = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && nav[j * nx + i] === 1;

  // nearest navigable cell centre to a point (spiral ring search)
  function snap(x, n, maxR = 60) {
    const [ci, cj] = cell(x, n);
    for (let r = 0; r <= maxR; r++) {
      let best = null, bd = 1e18;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !isNav(i, j)) continue;
        const d = (cx(i) - x) ** 2 + (cy(j) - n) ** 2; if (d < bd) { bd = d; best = [cx(i), cy(j)]; }
      }
      if (best) return best;
    }
    return null;
  }
  const segClear = (a, b, minD = MIN - 0.3) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 20));
    for (let k = 0; k <= n; k++) { const f = k / n; if (depthAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) < minD) return false; }
    return true;
  };

  // A* on the grid; returns smoothed waypoints [[x, north]..] or null
  function route(from, to) {
    const s = snap(from[0], from[1]), g = snap(to[0], to[1]);
    if (!s || !g) return null;
    const [si, sj] = cell(s[0], s[1]), [gi, gj] = cell(g[0], g[1]);
    const key = (i, j) => j * nx + i;
    const gs = new Float32Array(nx * ny).fill(1e9), from_ = new Int32Array(nx * ny).fill(-1), closed = new Uint8Array(nx * ny);
    const open = new Heap();
    gs[key(si, sj)] = 0; open.push(0, key(si, sj));
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    while (open.size) {
      const [, k] = open.pop();
      if (closed[k]) continue; closed[k] = 1;
      const i = k % nx, j = (k / nx) | 0;
      if (i === gi && j === gj) { found = true; break; }
      for (const [di, dj, c] of D) {
        const ii = i + di, jj = j + dj;
        if (!isNav(ii, jj)) continue;
        if (di && dj && !(isNav(i + di, j) && isNav(i, j + dj))) continue;      // no cutting corners through land
        const kk = key(ii, jj); if (closed[kk]) continue;
        const dep = clear[kk];
        const cost = c * (1 + Math.max(0, (14 - dep) / 14) * 0.9);              // keep to deeper water
        const ng = gs[k] + cost;
        if (ng < gs[kk]) { gs[kk] = ng; from_[kk] = k; open.push(ng + Math.hypot(ii - gi, jj - gj), kk); }
      }
    }
    if (!found) return null;
    let path = [], k = key(gi, gj);
    while (k >= 0) { path.push([cx(k % nx), cy((k / nx) | 0)]); k = from_[k]; }
    path.reverse();
    path[0] = [from[0], from[1]].every(Number.isFinite) && segClear(from, path[1] || path[0]) ? [from[0], from[1]] : path[0];
    // string-pull: keep the farthest visible waypoint each step
    const out = [path[0]]; let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !segClear(path[i], path[j])) j--;
      out.push(path[j]); i = j;
    }
    return out;
  }

  // a spot in water of depth [dMin, dMax] near (x, n), preferring the nearest to the point (anchorages, moorings)
  function anchorage(x, n, dMin = 4.5, dMax = 9, maxR = 1500, step = 30, avoid = []) {
    let best = null, bd = 1e18;
    for (let r = 0; r <= maxR; r += step) {
      for (let a = 0; a < Math.max(1, Math.round(2 * Math.PI * r / step)); a++) {
        const th = r ? a / Math.max(1, Math.round(2 * Math.PI * r / step)) * Math.PI * 2 : 0, px = x + Math.cos(th) * r, py = n + Math.sin(th) * r;
        const d = depthAt(px, py);
        if (d < dMin || d > dMax) continue;
        // want some room: every sample 60 m around is also water of at least dMin - 1
        if ([[60, 0], [-60, 0], [0, 60], [0, -60]].some(([ox, oy]) => depthAt(px + ox, py + oy) < dMin - 1)) continue;
        if (avoid.some(([ax, ay, ar]) => Math.hypot(ax - px, ay - py) < ar)) continue;
        return [px, py];
      }
    }
    return best;
  }
  // water edge: walk from a water point toward the nearest land; returns { x, n, dirX, dirN } where dir points out to sea
  function shoreFrom(x, n, maxR = 3000) {
    let best = null;
    for (let r = 20; r <= maxR && !best; r += 20) for (let a = 0; a < 48; a++) {
      const th = a / 48 * Math.PI * 2, px = x + Math.cos(th) * r, py = n + Math.sin(th) * r;
      if (depthAt(px, py) < -0.3) { best = [px, py, th]; break; }
    }
    if (!best) return null;
    // refine to the waterline along the ray back toward (x, n)
    let [px, py, th] = best, dx = -Math.cos(th), dy = -Math.sin(th);
    for (let k = 0; k < 60 && depthAt(px, py) < 0.4; k++) { px += dx * 2; py += dy * 2; }
    return { x: px, n: py, dirX: dx, dirN: dy };
  }
  return { route, snap, anchorage, shoreFrom, segClear, nav, clear, nx, ny, CELL, isNav, cell, depthAt };
}
