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
    const prisms = []; // {rings, zlo, zhi, tag, id, x0, y0, x1, y1}
    let segs = null, segP = null, segCell = null, prCell = null, segMark = null, prMark = null, mark = 0;
    let gx0 = 0, gy0 = 0, gnx = 1, gny = 1;

    // a solid: rings of flat [x, y, ...] arrays (outer ring and holes, metres), from zlo to zhi
    function add(rings, zlo, zhi, tag = 1, id = -1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of rings) for (let k = 0; k < r.length; k += 2) {
        if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k];
        if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1];
      }
      prisms.push({ rings, zlo, zhi, tag, id, x0, y0, x1, y1 });
      return prisms.length - 1;
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
      let n = 0, X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
      for (const p of prisms) {
        for (const r of p.rings) n += r.length / 2;
        if (p.x0 < X0) X0 = p.x0; if (p.y0 < Y0) Y0 = p.y0; if (p.x1 > X1) X1 = p.x1; if (p.y1 > Y1) Y1 = p.y1;
      }
      segs = new Float64Array(4 * n); segP = new Int32Array(n);
      let k = 0;
      prisms.forEach((p, pi) => {
        for (const r of p.rings) for (let a = 0, m = r.length / 2; a < m; a++) {
          const b = (a + 1) % m;
          segs[4 * k] = r[2 * a]; segs[4 * k + 1] = r[2 * a + 1]; segs[4 * k + 2] = r[2 * b]; segs[4 * k + 3] = r[2 * b + 1];
          segP[k++] = pi;
        }
      });
      gx0 = isFinite(X0) ? X0 : 0; gy0 = isFinite(Y0) ? Y0 : 0;
      gnx = Math.max(1, Math.ceil((X1 - gx0) / cellSize) + 1); gny = Math.max(1, Math.ceil((Y1 - gy0) / cellSize) + 1);
      segCell = bucket(n, (i, b) => {
        b[0] = Math.min(segs[4 * i], segs[4 * i + 2]); b[1] = Math.min(segs[4 * i + 1], segs[4 * i + 3]);
        b[2] = Math.max(segs[4 * i], segs[4 * i + 2]); b[3] = Math.max(segs[4 * i + 1], segs[4 * i + 3]);
      });
      prCell = bucket(prisms.length, (i, b) => { const p = prisms[i]; b[0] = p.x0; b[1] = p.y0; b[2] = p.x1; b[3] = p.y1; });
      segMark = new Uint32Array(n); prMark = new Uint32Array(prisms.length);
      return api;
    }

    // visit each wall (or prism) whose cell overlaps the box once; stop early when fn returns true
    function visit(grid, marks, x0, y0, x1, y1, fn) {
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
      }
      return false;
    }
    const band = (p, zlo, zhi) => p.zhi > zlo && p.zlo < zhi;

    // time of first contact (0..1) of a circle at (x, y), radius r, moving by (dx, dy), with
    // wall i; 2 for none. Sets N to the contact normal and the depth when it starts inside.
    const N = [0, 0, 0];
    function toi(i, x, y, dx, dy, r) {
      const ax = segs[4 * i], ay = segs[4 * i + 1], ex = segs[4 * i + 2] - ax, ey = segs[4 * i + 3] - ay, L2 = ex * ex + ey * ey;
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
      visit(segCell, segMark, Math.min(x, x + dx) - r, Math.min(y, y + dy) - r, Math.max(x, x + dx) + r, Math.max(y, y + dy) + r, i => {
        const pi = segP[i], p = prisms[pi];
        if (!band(p, zlo, zhi) || (skip && skip(pi, p))) return false;
        const t = toi(i, x, y, dx, dy, r);
        if (t <= 1 && (!hit || t < hit.t || (t === hit.t && N[2] > hit.depth))) hit = { t, nx: N[0], ny: N[1], depth: N[2], prism: pi };
        return false;
      });
      return hit;
    }

    // push a circle out of the walls it overlaps (ResolvePenetration)
    function depenetrate(x, y, r, zlo, zhi, skip) {
      for (let it = 0; it < 4; it++) {
        let px = 0, py = 0;
        visit(segCell, segMark, x - r, y - r, x + r, y + r, i => {
          const pi = segP[i], p = prisms[pi];
          if (!band(p, zlo, zhi) || (skip && skip(pi, p))) return false;
          const ax = segs[4 * i], ay = segs[4 * i + 1], ex = segs[4 * i + 2] - ax, ey = segs[4 * i + 3] - ay, L2 = ex * ex + ey * ey;
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

    // point in a prism's footprint (even-odd over its rings)
    function inside(p, x, y) {
      if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return false;
      let c = false;
      for (const r of p.rings) for (let a = 0, n = r.length / 2, b = n - 1; a < n; b = a++) {
        const ya = r[2 * a + 1], yb = r[2 * b + 1];
        if ((ya > y) !== (yb > y) && x < r[2 * a] + (y - ya) / (yb - ya) * (r[2 * b] - r[2 * a])) c = !c;
      }
      return c;
    }

    // does a circle between heights zlo and zhi touch any solid?
    function overlap(x, y, r, zlo, zhi, skip) {
      if (visit(segCell, segMark, x - r, y - r, x + r, y + r, i => {
        const pi = segP[i], p = prisms[pi];
        if (!band(p, zlo, zhi) || (skip && skip(pi, p))) return false;
        const ax = segs[4 * i], ay = segs[4 * i + 1], ex = segs[4 * i + 2] - ax, ey = segs[4 * i + 3] - ay, L2 = ex * ex + ey * ey;
        const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
        return Math.hypot(x - ax - ex * s, y - ay - ey * s) < r - TOUCH;
      })) return true;
      return visit(prCell, prMark, x, y, x, y, pi => { const p = prisms[pi]; return band(p, zlo, zhi) && !(skip && skip(pi, p)) && inside(p, x, y); });
    }

    // the highest solid top at (x, y) no higher than zmax, or -Infinity; tag 0 means any
    function topAt(x, y, zmax = Infinity, tag = 0) {
      let best = -Infinity;
      visit(prCell, prMark, x, y, x, y, pi => {
        const p = prisms[pi];
        if ((!tag || p.tag === tag) && p.zhi <= zmax && p.zhi > best && inside(p, x, y)) best = p.zhi;
        return false;
      });
      return best;
    }

    // the solid under (x, y) whose top is highest, or null
    function prismAt(x, y, tag = 0) {
      let best = null;
      visit(prCell, prMark, x, y, x, y, pi => {
        const p = prisms[pi];
        if ((!tag || p.tag === tag) && (!best || p.zhi > best.zhi) && inside(p, x, y)) best = p;
        return false;
      });
      return best;
    }

    // a sphere of radius r swept from a to b (local x, y, z): the fraction of the way it gets
    // before touching a wall, a roof or a soffit; 1 when clear
    function sweepSphere(ax, ay, az, bx, by, bz, r, skip) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      let best = 1;
      const x0 = Math.min(ax, bx) - r, y0 = Math.min(ay, by) - r, x1 = Math.max(ax, bx) + r, y1 = Math.max(ay, by) + r;
      visit(segCell, segMark, x0, y0, x1, y1, i => {
        const pi = segP[i], p = prisms[pi];
        if (skip && skip(pi, p)) return false;
        const t = toi(i, ax, ay, dx, dy, r);
        if (t >= best || N[2] > 0) return false; // already overlapping at the start: moving out of it
        const z = az + dz * t;
        if (z > p.zlo - r && z < p.zhi + r) best = t;
        return false;
      });
      visit(prCell, prMark, x0, y0, x1, y1, pi => {
        const p = prisms[pi];
        if (skip && skip(pi, p)) return false;
        for (const zc of [p.zhi + r, p.zlo - r]) { // roof from above, soffit from below
          if ((az - zc) * (bz - zc) >= 0) continue;
          const t = (az - zc) / (az - bz);
          if (t < best && inside(p, ax + dx * t, ay + dy * t)) best = t;
        }
        return false;
      });
      return best;
    }

    const api = { add, build, sweep, slide, depenetrate, overlap, topAt, prismAt, sweepSphere, inside, prisms, SKIN,
      get walls() { return segP ? segP.length : 0; } };
    return api;
  }
  return { create, SKIN };
})();
