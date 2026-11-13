// Sweeps and overlaps against the exact solids of the city, the queries a game engine's
// physics scene answers for movement and cameras. Every solid here is a vertical prism (a
// footprint extruded between two heights): the buildings as published, and the landmark
// and deck cells from nav.js. So a capsule sweep is a circle swept in plan against the prism
// walls whose height range overlaps the capsule, and a camera probe also meets roofs and
// soffits.
//
// The movement follows Unreal Engine's CharacterMovementComponent, re-written from its
// documented behaviour (no engine code): sweep the capsule, stop at the first hit, slide the
// rest of the move along the wall (SlideAlongSurface), stop in a corner where sliding along
// one wall pushes into the other (TwoWallAdjust), and push out of anything the capsule starts
// inside (ResolvePenetration). Walls low enough to step onto are left to the caller's floor
// query, as Unreal's StepUp leaves them to MaxStepHeight. The camera probe is the
// SpringArmComponent's: a small sphere swept from the target to the camera.
'use strict';
window.OECollision = (function () {
  const SKIN = 0.01;   // gap kept from a wall after a hit (m), so the next sweep starts clear
  const TOUCH = 1e-3;  // closer than radius - TOUCH counts as overlapping

  function create(cellSize = 8) {
    // The solids as a packed store (issue 406): a struct of typed arrays rather than an object and nested ring arrays
    // a solid (which held 150 MB of a large map's heap). Each solid i keeps its height range PZ[2i..2i+1], its box
    // PB[4i..4i+3] (x0, y0, x1, y1), its tag PT[i] and id PI[i], and its walls, a run of segments from PS[i] to PS[i + 1]
    // in segs ([ax, ay, bx, by] each), the first PO[i] - PS[i] of them its outer ring. The walls are written as the solid
    // is added, so build() only buckets them. An upright box (addBox: a landmark's 2 m and fine cells, a canopy's post,
    // nine in ten of a city's solids) keeps no walls: PO[i] is -1 and its four walls are read from its box (BOX_WALLS).
    let np = 0, PZ = new Float64Array(64), PB = new Float64Array(128), PT = new Int32Array(32), PI = new Int32Array(32), PS = new Int32Array(33), PO = new Int32Array(32);
    let segs = new Float64Array(256), segP = new Int32Array(64), segCell = null, prCell = null, segMark = new Uint32Array(0), prMark = new Uint32Array(0), mark = 0;
    let gx0 = 0, gy0 = 0, gnx = 1, gny = 1, nseg = 0, nbox = 0, built = false;
    // solids added after build() (nav.js lays a landmark's fine cells in tile by tile, as the walker
    // nears them) go into per-cell lists beside the packed grid; need(x0, y0, x1, y1), when set, is
    // asked to add what lies in a box before a query visits it
    const late = { seg: new Map(), pr: new Map() };
    let need = null, fineTag = null;
    // (a typed array grown to hold n: doubled while the solids are added, by half again once built, as the fine cells come)
    const grow = (a, n) => { if (n <= a.length) return a; const b = new a.constructor(Math.max(n, Math.ceil(a.length * (built ? 1.5 : 2)))); b.set(a); return b; };
    function begin(zlo, zhi, tag, id) {
      const i = np++;
      if (np > PT.length) { PZ = grow(PZ, 2 * np); PB = grow(PB, 4 * np); PT = grow(PT, np); PI = grow(PI, np); PO = grow(PO, np); }
      if (np + 1 > PS.length) PS = grow(PS, np + 1);
      PZ[2 * i] = zlo; PZ[2 * i + 1] = zhi; PT[i] = tag; PI[i] = id; PS[i] = nseg;
      PB[4 * i] = PB[4 * i + 1] = Infinity; PB[4 * i + 2] = PB[4 * i + 3] = -Infinity;
      return i;
    }
    function wall(i, ax, ay, bx, by) {
      const k = nseg++;
      if (4 * nseg > segs.length) { segs = grow(segs, 4 * nseg); segP = grow(segP, nseg); }
      segs[4 * k] = ax; segs[4 * k + 1] = ay; segs[4 * k + 2] = bx; segs[4 * k + 3] = by; segP[k] = i;
      const b = 4 * i;
      if (ax < PB[b]) PB[b] = ax; if (ax > PB[b + 2]) PB[b + 2] = ax;
      if (ay < PB[b + 1]) PB[b + 1] = ay; if (ay > PB[b + 3]) PB[b + 3] = ay;
    }
    function end(i) {
      PS[np] = nseg;
      if (built) addLate(i);
      return i;
    }
    // a solid: rings of flat [x, y, ...] arrays (outer ring and holes), from zlo to zhi, each value divided by div
    // (10 for the buildings' decimetres, read straight from their own arrays); from: the first ring of rings
    function add(rings, zlo, zhi, tag = 1, id = -1, div = 1, from = 0) {
      const i = begin(zlo, zhi, tag, id);
      for (let j = from; j < rings.length; j++) {
        const r = rings[j];
        for (let a = 0, m = r.length / 2; a < m; a++) {
          const b = (a + 1) % m;
          wall(i, r[2 * a] / div, r[2 * a + 1] / div, r[2 * b] / div, r[2 * b + 1] / div);
        }
        if (j === from) PO[i] = nseg;
      }
      if (rings.length <= from) PO[i] = nseg;
      return end(i);
    }
    // an upright box from (x0, y0) to (x1, y1), x0 < x1 and y0 < y1: the solid of the ring [x0, y0, x1, y0, x1, y1, x0, y1]
    function addBox(x0, y0, x1, y1, zlo, zhi, tag = 1, id = -1) {
      const i = begin(zlo, zhi, tag, id);
      PB[4 * i] = x0; PB[4 * i + 1] = y0; PB[4 * i + 2] = x1; PB[4 * i + 3] = y1; PO[i] = -1; nbox++;
      return end(i);
    }
    // a box's walls, in its ring's order: fn(pi, ax, ay, bx, by) for each until it answers true
    const BOX_WALLS = [0, 1, 2, 1, 2, 1, 2, 3, 2, 3, 0, 3, 0, 3, 0, 1]; // (places in PB of ax, ay, bx, by, wall by wall)
    function boxWalls(pi, fn) {
      const b = 4 * pi;
      for (let w = 0; w < 16; w += 4) if (fn(pi, PB[b + BOX_WALLS[w]], PB[b + BOX_WALLS[w + 1]], PB[b + BOX_WALLS[w + 2]], PB[b + BOX_WALLS[w + 3]])) return true;
      return false;
    }
    function cellsOf(x0, y0, x1, y1, fn) {
      const c0 = Math.max(0, Math.floor((x0 - gx0) / cellSize)), r0 = Math.max(0, Math.floor((y0 - gy0) / cellSize));
      const c1 = Math.min(gnx - 1, Math.floor((x1 - gx0) / cellSize)), r1 = Math.min(gny - 1, Math.floor((y1 - gy0) / cellSize));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * gnx + c);
    }
    const lpush = (M, k, i) => { const l = M.get(k); if (l) l.push(i); else M.set(k, [i]); };
    function addLate(pi) {
      prMark = grow(prMark, np); segMark = grow(segMark, nseg);
      cellsOf(PB[4 * pi], PB[4 * pi + 1], PB[4 * pi + 2], PB[4 * pi + 3], k => lpush(late.pr, k, pi));
      for (let k = PS[pi]; k < PS[pi + 1]; k++) {
        const ax = segs[4 * k], ay = segs[4 * k + 1], bx = segs[4 * k + 2], by = segs[4 * k + 3];
        cellsOf(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), c => lpush(late.seg, c, k));
      }
    }

    // a uniform grid in compressed rows: cell -> item indices, for walls and for whole prisms
    function bucket(n, boxOf) {
      const start = new Int32Array(gnx * gny + 1), b = [0, 0, 0, 0];
      const span = i => {
        boxOf(i, b);
        return [Math.max(0, Math.floor((b[0] - gx0) / cellSize)), Math.max(0, Math.floor((b[1] - gy0) / cellSize)),
          Math.min(gnx - 1, Math.floor((b[2] - gx0) / cellSize)), Math.min(gny - 1, Math.floor((b[3] - gy0) / cellSize))];
      };
      for (let i = 0; i < n; i++) { const [c0, r0, c1, r1] = span(i); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * gnx + c + 1]++; }
      for (let k = 0; k < gnx * gny; k++) start[k + 1] += start[k];
      const fill = start.slice(0, gnx * gny), items = new Int32Array(start[gnx * gny]);
      for (let i = 0; i < n; i++) { const [c0, r0, c1, r1] = span(i); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) items[fill[r * gnx + c]++] = i; }
      return { start, items };
    }

    function build() {
      let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
      for (let i = 0; i < np; i++) {
        if (PB[4 * i] < X0) X0 = PB[4 * i]; if (PB[4 * i + 1] < Y0) Y0 = PB[4 * i + 1];
        if (PB[4 * i + 2] > X1) X1 = PB[4 * i + 2]; if (PB[4 * i + 3] > Y1) Y1 = PB[4 * i + 3];
      }
      // (the arrays trimmed to what they hold: the doubling's slack is a third of them)
      const trim = (a, n) => (a.length > n ? a.slice(0, n) : a);
      segs = trim(segs, 4 * nseg); segP = trim(segP, nseg);
      PZ = trim(PZ, 2 * np); PB = trim(PB, 4 * np); PT = trim(PT, np); PI = trim(PI, np); PO = trim(PO, np); PS = trim(PS, np + 1);
      gx0 = isFinite(X0) ? X0 : 0; gy0 = isFinite(Y0) ? Y0 : 0;
      gnx = Math.max(1, Math.ceil((X1 - gx0) / cellSize) + 1); gny = Math.max(1, Math.ceil((Y1 - gy0) / cellSize) + 1);
      segCell = bucket(nseg, (i, b) => {
        b[0] = Math.min(segs[4 * i], segs[4 * i + 2]); b[1] = Math.min(segs[4 * i + 1], segs[4 * i + 3]);
        b[2] = Math.max(segs[4 * i], segs[4 * i + 2]); b[3] = Math.max(segs[4 * i + 1], segs[4 * i + 3]);
      });
      prCell = bucket(np, (i, b) => { b[0] = PB[4 * i]; b[1] = PB[4 * i + 1]; b[2] = PB[4 * i + 2]; b[3] = PB[4 * i + 3]; });
      segMark = new Uint32Array(nseg); prMark = new Uint32Array(np);
      segCell.late = late.seg; prCell.late = late.pr; built = true;
      return api;
    }

    // visit each wall (or prism) whose cell overlaps the box once; stop early when fn returns true
    // need() answers true for a box it lays nothing for (one wider than a walker's, a flight's): such a query
    // passes over the solids added late with the tag fineTag, so that what it sees never depends on which of
    // them the frames have laid so far (#264 item 4)
    function visit(grid, x0, y0, x1, y1, fn) {
      const coarse = need ? need(x0, y0, x1, y1) === true : false;
      const marks = grid === segCell ? segMark : prMark; // (need() may have grown them)
      const c0 = Math.max(0, Math.floor((x0 - gx0) / cellSize)), c1 = Math.min(gnx - 1, Math.floor((x1 - gx0) / cellSize));
      const r0 = Math.max(0, Math.floor((y0 - gy0) / cellSize)), r1 = Math.min(gny - 1, Math.floor((y1 - gy0) / cellSize));
      if (++mark === 0xffffffff) { segMark.fill(0); prMark.fill(0); mark = 1; }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * gnx + c;
        for (let j = grid.start[k]; j < grid.start[k + 1]; j++) {
          const i = grid.items[j];
          if (marks[i] === mark) continue;
          marks[i] = mark;
          if (fn(i)) return true;
        }
        const l = grid.late.get(k);
        if (l) for (const i of l) {
          if (marks[i] === mark) continue;
          if (coarse && PT[grid === segCell ? segP[i] : i] === fineTag) continue;
          marks[i] = mark;
          if (fn(i)) return true;
        }
      }
      return false;
    }
    // each wall with a cell in the box once, fn(pi, ax, ay, bx, by): the walls kept, then the boxes'; stop when fn returns true
    function walls(x0, y0, x1, y1, fn) {
      if (visit(segCell, x0, y0, x1, y1, i => fn(segP[i], segs[4 * i], segs[4 * i + 1], segs[4 * i + 2], segs[4 * i + 3]))) return true;
      return nbox > 0 && visit(prCell, x0, y0, x1, y1, pi => PO[pi] < 0 && boxWalls(pi, fn));
    }
    const band = (pi, zlo, zhi) => PZ[2 * pi + 1] > zlo && PZ[2 * pi] < zhi;
    // what a skip(pi, p) is handed as p: one view, pointed at each solid in turn, whose tag, id, zlo, zhi and box read
    // the store (a caller that keeps one past its call keeps pi, or a prism(pi) of its own)
    const V = {
      i: 0, get tag() { return PT[this.i]; }, get id() { return PI[this.i]; }, get zlo() { return PZ[2 * this.i]; }, get zhi() { return PZ[2 * this.i + 1]; },
      get x0() { return PB[4 * this.i]; }, get y0() { return PB[4 * this.i + 1]; }, get x1() { return PB[4 * this.i + 2]; }, get y1() { return PB[4 * this.i + 3]; },
      get rings() { return ringsOf(this.i); },
    };
    const skipped = (skip, pi) => { V.i = pi; return skip(pi, V); };
    // each solid's walls along its outer ring, fn(ax, ay, bx, by) for each until it answers true
    function outer(pi, fn) {
      if (PO[pi] < 0) return boxWalls(pi, (_, ax, ay, bx, by) => fn(ax, ay, bx, by));
      for (let k = PS[pi]; k < PO[pi]; k++) if (fn(segs[4 * k], segs[4 * k + 1], segs[4 * k + 2], segs[4 * k + 3])) return true;
      return false;
    }
    // a solid's rings as flat arrays, made on asking (for the tools that print one)
    function ringsOf(pi) {
      if (PO[pi] < 0) { const b = 4 * pi; return [[PB[b], PB[b + 1], PB[b + 2], PB[b + 1], PB[b + 2], PB[b + 3], PB[b], PB[b + 3]]]; }
      const out = [];
      let r = null;
      for (let k = PS[pi]; k < PS[pi + 1]; k++) {
        if (!r || k === PO[pi]) out.push(r = []);
        r.push(segs[4 * k], segs[4 * k + 1]);
        if (k + 1 < PS[pi + 1] && (segs[4 * k + 2] !== segs[4 * k + 4] || segs[4 * k + 3] !== segs[4 * k + 5])) r = null; // (a ring closed: the next wall starts another)
      }
      return out;
    }
    // a solid as an object of its own: {i, tag, id, zlo, zhi, x0, y0, x1, y1, rings}
    const prism = pi => ({ i: pi, tag: PT[pi], id: PI[pi], zlo: PZ[2 * pi], zhi: PZ[2 * pi + 1], x0: PB[4 * pi], y0: PB[4 * pi + 1], x1: PB[4 * pi + 2], y1: PB[4 * pi + 3], rings: ringsOf(pi) });

    // time of first contact (0..1) of a circle at (x, y), radius r, moving by (dx, dy), with
    // the wall from (ax, ay) to (bx, by); 2 for none. Sets N to the contact normal and the depth when it starts inside.
    const N = [0, 0, 0];
    function toi(ax, ay, bx, by, x, y, dx, dy, r) {
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
      let cx = x - (ax + ex * s), cy = y - (ay + ey * s);
      const d2 = cx * cx + cy * cy;
      if (d2 < (r - TOUCH) * (r - TOUCH)) { // starts overlapping: a hit only when moving further in
        const d = Math.sqrt(d2);
        if (d > 1e-9) { cx /= d; cy /= d; } else { const L = Math.sqrt(L2) || 1; cx = -ey / L; cy = ex / L; if (cx * dx + cy * dy > 0) { cx = -cx; cy = -cy; } }
        if (cx * dx + cy * dy >= 0) return 2;
        N[0] = cx; N[1] = cy; N[2] = r - d;
        return 0;
      }
      N[2] = 0;
      if (L2 > 0) { // the face of the wall
        const L = Math.sqrt(L2);
        let nx = -ey / L, ny = ex / L, side = (x - ax) * nx + (y - ay) * ny;
        if (side < 0) { nx = -nx; ny = -ny; side = -side; }
        const vn = dx * nx + dy * ny;
        if (vn < 0) {
          const t = Math.max(0, (side - r) / -vn);
          if (t <= 1) {
            const u = ((x + dx * t - ax) * ex + (y + dy * t - ay) * ey) / L2;
            if (u >= 0 && u <= 1) { N[0] = nx; N[1] = ny; return t; }
          }
        }
      }
      let best = 2; // its ends
      const a = dx * dx + dy * dy;
      if (a < 1e-12) return best;
      for (let e = 0; e < 2; e++) {
        const mx = x - (e ? ax + ex : ax), my = y - (e ? ay + ey : ay), b = mx * dx + my * dy;
        if (b >= 0) continue;
        const disc = b * b - a * (mx * mx + my * my - r * r);
        if (disc < 0) continue;
        const t = Math.max(0, (-b - Math.sqrt(disc)) / a);
        if (t < best && t <= 1) { best = t; const hx = mx + dx * t, hy = my + dy * t, h = Math.hypot(hx, hy) || 1; N[0] = hx / h; N[1] = hy / h; }
      }
      return best;
    }

    // first wall hit by a circle sweeping (x, y) -> (x + dx, y + dy) between heights zlo and zhi;
    // skip(prism) leaves a prism out. {t, nx, ny, depth, prism} or null
    function sweep(x, y, dx, dy, r, zlo, zhi, skip) {
      let hit = null;
      walls(Math.min(x, x + dx) - r, Math.min(y, y + dy) - r, Math.max(x, x + dx) + r, Math.max(y, y + dy) + r, (pi, ax, ay, bx, by) => {
        if (!band(pi, zlo, zhi) || (skip && skipped(skip, pi))) return false;
        const t = toi(ax, ay, bx, by, x, y, dx, dy, r);
        if (t <= 1 && (!hit || t < hit.t || (t === hit.t && N[2] > hit.depth))) hit = { t, nx: N[0], ny: N[1], depth: N[2], prism: pi };
        return false;
      });
      return hit;
    }

    // push a circle out of the walls it overlaps (ResolvePenetration)
    function depenetrate(x, y, r, zlo, zhi, skip) {
      for (let it = 0; it < 4; it++) {
        let px = 0, py = 0;
        walls(x - r, y - r, x + r, y + r, (pi, ax, ay, bx, by) => {
          if (!band(pi, zlo, zhi) || (skip && skipped(skip, pi))) return false;
          const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
          const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
          let cx = x - (ax + ex * s), cy = y - (ay + ey * s);
          const d = Math.hypot(cx, cy);
          if (d >= r - TOUCH) return false;
          if (d > 1e-9) { cx /= d; cy /= d; } else { const L = Math.sqrt(L2) || 1; cx = -ey / L; cy = ex / L; }
          const push = r - d + SKIN;
          if (Math.abs(cx * push) > Math.abs(px)) px = cx * push;
          if (Math.abs(cy * push) > Math.abs(py)) py = cy * push;
          return false;
        });
        if (!px && !py) break;
        x += px; y += py;
      }
      return { x, y };
    }

    // move a circle by (dx, dy), sliding along what it hits: {x, y, hit} where hit is the
    // last contact {t, nx, ny, depth, prism} or null
    function slide(x, y, dx, dy, r, zlo, zhi, skip, iterations = 4) {
      let last = null, pnx = 0, pny = 0;
      for (let it = 0; it < iterations && (dx * dx + dy * dy) > 1e-12; it++) {
        const h = sweep(x, y, dx, dy, r, zlo, zhi, skip);
        if (!h) { x += dx; y += dy; break; }
        last = h;
        if (h.depth > SKIN) { const o = depenetrate(x, y, r, zlo, zhi, skip); x = o.x; y = o.y; continue; }
        x += dx * h.t + h.nx * SKIN; y += dy * h.t + h.ny * SKIN;
        let rx = dx * (1 - h.t), ry = dy * (1 - h.t);
        const dn = rx * h.nx + ry * h.ny;
        rx -= h.nx * dn; ry -= h.ny * dn;
        if ((pnx || pny) && rx * pnx + ry * pny < 0) rx = ry = 0; // into a corner
        pnx = h.nx; pny = h.ny; dx = rx; dy = ry;
      }
      return { x, y, hit: last };
    }

    // point in solid pi's footprint (even-odd over its walls; pi may also be a prism(pi) or the view). A box's even-odd
    // over its ring is x0 <= x < x1 and y0 <= y < y1
    function inside(pi, x, y) {
      if (typeof pi === 'object') pi = pi.i;
      const b = 4 * pi;
      if (PO[pi] < 0) return x >= PB[b] && x < PB[b + 2] && y >= PB[b + 1] && y < PB[b + 3];
      if (x < PB[b] || x > PB[b + 2] || y < PB[b + 1] || y > PB[b + 3]) return false;
      let c = false;
      for (let k = PS[pi], e = PS[pi + 1]; k < e; k++) { // (each wall as the ring's edge from its end b back to its start a)
        const xa = segs[4 * k + 2], ya = segs[4 * k + 3], xb = segs[4 * k], yb = segs[4 * k + 1];
        if ((ya > y) !== (yb > y) && x < xa + (y - ya) / (yb - ya) * (xb - xa)) c = !c;
      }
      return c;
    }

    // does a circle between heights zlo and zhi touch any solid?
    function overlap(x, y, r, zlo, zhi, skip) {
      if (walls(x - r, y - r, x + r, y + r, (pi, ax, ay, bx, by) => {
        if (!band(pi, zlo, zhi) || (skip && skipped(skip, pi))) return false;
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
        const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
        return Math.hypot(x - ax - ex * s, y - ay - ey * s) < r - TOUCH;
      })) return true;
      return visit(prCell, x, y, x, y, pi => band(pi, zlo, zhi) && !(skip && skipped(skip, pi)) && inside(pi, x, y));
    }

    // the highest solid top at (x, y) no higher than zmax, or -Infinity; tag 0 means any
    function topAt(x, y, zmax = Infinity, tag = 0) {
      let best = -Infinity;
      visit(prCell, x, y, x, y, pi => {
        const zhi = PZ[2 * pi + 1];
        if ((!tag || PT[pi] === tag) && zhi <= zmax && zhi > best && inside(pi, x, y)) best = zhi;
        return false;
      });
      return best;
    }

    // the solid under (x, y) whose top is highest (a prism(pi)), or null
    function prismAt(x, y, tag = 0) {
      let best = -1;
      visit(prCell, x, y, x, y, pi => {
        if ((!tag || PT[pi] === tag) && (best < 0 || PZ[2 * pi + 1] > PZ[2 * best + 1]) && inside(pi, x, y)) best = pi;
        return false;
      });
      return best < 0 ? null : prism(best);
    }

    // a sphere of radius r swept from a to b (local x, y, z): the fraction of the way it gets
    // before touching a wall, a roof or a soffit; 1 when clear
    function sweepSphere(ax, ay, az, bx, by, bz, r, skip) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      let best = 1;
      const x0 = Math.min(ax, bx) - r, y0 = Math.min(ay, by) - r, x1 = Math.max(ax, bx) + r, y1 = Math.max(ay, by) + r;
      walls(x0, y0, x1, y1, (pi, wax, way, wbx, wby) => {
        if (skip && skipped(skip, pi)) return false;
        const t = toi(wax, way, wbx, wby, ax, ay, dx, dy, r);
        if (t >= best || N[2] > 0) return false; // already overlapping at the start: moving out of it
        const z = az + dz * t;
        if (z > PZ[2 * pi] - r && z < PZ[2 * pi + 1] + r) best = t;
        return false;
      });
      visit(prCell, x0, y0, x1, y1, pi => {
        if (skip && skipped(skip, pi)) return false;
        for (let e = 0; e < 2; e++) { // roof from above, soffit from below
          const zc = e ? PZ[2 * pi] - r : PZ[2 * pi + 1] + r;
          if ((az - zc) * (bz - zc) >= 0) continue;
          const t = (az - zc) / (az - bz);
          if (t < best && inside(pi, ax + dx * t, ay + dy * t)) best = t;
        }
        return false;
      });
      return best;
    }

    // the first solid a ray from a to b (local x, y, z) enters, through a wall or its roof or soffit, tag 0 for any:
    // {t (0..1 along it), pi} or null. Read in steps of STEP metres, nearest first, so that a long ray visits only
    // the cells up to its hit (the game's survey lens: the building under the reticle, issue 406)
    function pick(ax, ay, az, bx, by, bz, tag = 0) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy), STEP = 24, n = Math.max(1, Math.ceil(L / STEP));
      let best = Infinity, bp = -1;
      // (not one it starts in: its walls face away from the ray, as a drawn wall's back face does to a raycast)
      const within = pi => az >= PZ[2 * pi] && az <= PZ[2 * pi + 1] && inside(pi, ax, ay);
      const ok = pi => (!tag || PT[pi] === tag) && !within(pi);
      for (let k = 0; k < n && bp < 0; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = Math.min(ax + dx * t0, ax + dx * t1), x1 = Math.max(ax + dx * t0, ax + dx * t1), y0 = Math.min(ay + dy * t0, ay + dy * t1), y1 = Math.max(ay + dy * t0, ay + dy * t1);
        walls(x0, y0, x1, y1, (pi, wax, way, wbx, wby) => {
          if (!ok(pi)) return false;
          const ex = wbx - wax, ey = wby - way, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) return false;
          const t = ((wax - ax) * ey - (way - ay) * ex) / den, u = ((wax - ax) * dy - (way - ay) * dx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1 || t >= best) return false;
          const z = az + dz * t;
          if (z >= PZ[2 * pi] && z <= PZ[2 * pi + 1]) { best = t; bp = pi; }
          return false;
        });
        visit(prCell, x0, y0, x1, y1, pi => {
          if (!ok(pi)) return false;
          for (let e = 0; e < 2; e++) { // its roof from above, its soffit from below
            const zc = e ? PZ[2 * pi] : PZ[2 * pi + 1];
            if ((az - zc) * (bz - zc) >= 0) continue;
            const t = (az - zc) / (az - bz);
            if (t < best && inside(pi, ax + dx * t, ay + dy * t)) { best = t; bp = pi; }
          }
          return false;
        });
        if (bp >= 0 && best > t1) bp = -1, best = Infinity; // (a hit past this step: found again, nearer ones first, in its own)
      }
      return bp < 0 ? null : { t: best, pi: bp };
    }

    const api = { add, addBox, build, sweep, slide, depenetrate, overlap, topAt, prismAt, sweepSphere, inside, prism, outer, pick, SKIN,
      get count() { return np; }, tagOf: pi => PT[pi], idOf: pi => PI[pi], zloOf: pi => PZ[2 * pi], zhiOf: pi => PZ[2 * pi + 1],
      boxOf: (pi, b = [0, 0, 0, 0]) => { b[0] = PB[4 * pi]; b[1] = PB[4 * pi + 1]; b[2] = PB[4 * pi + 2]; b[3] = PB[4 * pi + 3]; return b; },
      get prisms() { return Array.from({ length: np }, (_, i) => prism(i)); }, // (every solid as an object: for a tool, never the game)
      get walls() { return nseg + 4 * nbox; }, set need(f) { need = f; }, get need() { return need; }, set fineTag(t) { fineTag = t; } };
    return api;
  }
  return { create, SKIN };
})();
