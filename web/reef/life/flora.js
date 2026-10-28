// Island vegetation from the land-cover classes (ESA WorldCover via the build: 10 forest, 11 shrub,
// 12 grass, 13 beach, 14 mangrove): open eucalypt forest (carbeen) with hoop pines standing out on the
// steeper slopes and headlands, pandanus and casuarina along the beach fronts, mangroves in the
// intertidal flats. 64 m tiles, three rings: detailed trees near the camera, simpler ones to 600 m,
// then a thinned set of coarse spindles to 2.4 km so the islands' skyline reads as forest from the sea.
// Nothing grows on open beach sand below ~3 m above the tide, nor on the water side of the beach.
import * as THREE from 'three/webgpu';
import { Herd, hash } from './kit.js';
import * as G from './geo.js';

const TT = 64, CELL = 7;
const R0 = 160, R1 = 650, R2 = 2600;
const KEEP1 = 0.75, KEEP2 = 0.22;         // share of trees drawn in the middle and far rings (by a per-tree rank)

// model height (m) of each geometry, per-instance scale range, colours (linear albedo), far spindle width/height
export const TREES = {
  'hoop-pine': { geo: G.hoopPine, H: 30, scale: [0.7, 1.15], leaf: [0.04, 0.07, 0.04], bark: [0.2, 0.13, 0.09], far: 0.26, sink: 0.3, cap: [1500, 6000] },
  carbeen: { geo: G.eucalypt, H: 20, scale: [0.6, 1.25], leaf: [0.09, 0.105, 0.05], bark: [0.3, 0.29, 0.26], far: 0.62, sink: 0.3, cap: [4000, 16000] },
  pandanus: { geo: G.pandanus, H: 6, scale: [0.65, 1.3], leaf: [0.12, 0.135, 0.05], bark: [0.25, 0.21, 0.17], far: 0.95, sink: 0.5, cap: [800, 3000] },
  casuarina: { geo: G.casuarina, H: 16, scale: [0.45, 0.85], leaf: [0.075, 0.09, 0.065], bark: [0.14, 0.11, 0.09], far: 0.42, sink: 0.5, cap: [800, 3000] },
  mangrove: { geo: G.mangrove, H: 7, scale: [0.6, 1.4], leaf: [0.045, 0.085, 0.035], bark: [0.12, 0.09, 0.07], far: 1.0, sink: 0.4, cap: [1500, 5000] }
};
const IDS = Object.keys(TREES);

export function createFlora(ctx, ground, mats) {
  const { env } = ctx;
  const group = new THREE.Group(); group.name = 'life:trees';
  const herds = {};
  for (const id of IDS) {
    const T = TREES[id];
    herds[id] = [new Herd(id + '-mid', T.geo(1), mats.tree, T.cap[1]), new Herd(id, T.geo(2), mats.tree, T.cap[0])];
    group.add(herds[id][0].mesh, herds[id][1].mesh);
  }
  const far = new Herd('trees-far', G.farTree(), mats.farTree, 60000);
  group.add(far.mesh);

  // the satellite's own colour of the canopy, a quarter resolution, to tint each tree a little toward it
  const tint = (() => {
    try {
      const g = ctx.S.ground, w = Math.round(g.w / 4), h = Math.round(g.h / 4);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(ctx.d.img, 0, 0, w, h);
      const px = c2.getImageData(0, 0, w, h).data, t = ctx.S.terrain, lin = v => Math.pow(v / 255, 2.2);
      return (x, n, out) => {
        const i = Math.min(w - 1, Math.max(0, Math.floor((x - t.x0) / (g.px_m * 4)))), j = Math.min(h - 1, Math.max(0, Math.floor((t.y1 - n) / (g.px_m * 4)))), o = (j * w + i) * 4;
        out[0] = lin(px[o]); out[1] = lin(px[o + 1]); out[2] = lin(px[o + 2]); return out;
      };
    } catch (e) { return null; }
  })();

  // ---------------------------------------------------------------- one tile of island
  const tiles = new Map();
  const key = (tx, ty) => (tx + 32768) * 65536 + (ty + 32768);
  const gc = [0, 0, 0];
  function generate(tx, ty) {
    const x0 = tx * TT, n0 = ty * TT, tide = env.u.tide.value;
    const t = { tx, ty, x0, n0, list: [] };
    const [, hi] = ground.maxIn(x0, n0, x0 + TT, n0 + TT);
    if (hi < tide + 0.2) return t;
    const nc = TT / CELL;
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const gx = Math.round(x0 / CELL) + i, gy = Math.round(n0 / CELL) + j;
      const x = (gx + 0.15 + 0.7 * hash(gx, gy, 31)) * CELL, n = (gy + 0.15 + 0.7 * hash(gx, gy, 32)) * CELL;
      const cls = ctx.habitat(x, n);
      if (cls < 10 || cls === 15) continue;
      const h = ground.height(x, n), above = h - tide;
      let sp = null, dens = 0;
      const rS = hash(gx, gy, 33);
      if (cls === 14) { if (above > -1.2 && above < 3) { sp = 'mangrove'; dens = 0.85; } }
      else {
        if (above < 2.2 || (cls === 13 && above < 3.5)) continue;
        // near the sea: is there water within ~30 m?
        let coast = false;
        for (let k = 0; k < 12 && !coast; k++) { const a = k * 1.047 + rS, rr = k < 6 ? 25 : 55, c2 = ctx.habitat(x + Math.cos(a) * rr, n + Math.sin(a) * rr); if (c2 < 10 || c2 === 13) coast = true; }
        const [sx, sn] = ground.slope(x, n, 6), steep = Math.hypot(sx, sn);
        dens = cls === 10 ? 0.85 : cls === 11 ? 0.5 : cls === 16 ? 0.35 : cls === 13 ? 0.12 : 0.14;
        const r = hash(gx, gy, 34);
        if (coast && above < 14) sp = r < 0.36 ? 'pandanus' : r < 0.72 ? 'casuarina' : r < 0.9 ? 'carbeen' : 'hoop-pine';
        else sp = r < 0.12 + Math.min(0.35, steep * 0.45) + (above > 120 ? 0.1 : 0) ? 'hoop-pine' : 'carbeen';
        if (cls === 12 && sp === 'hoop-pine') sp = 'carbeen';
      }
      if (!sp || hash(gx, gy, 35) > dens) continue;
      const T = TREES[sp], r2 = hash(gx, gy, 36), r3 = hash(gx, gy, 37);
      const s = T.scale[0] + (T.scale[1] - T.scale[0]) * r2;
      const v = 0.8 + 0.4 * r3;
      const leaf = [T.leaf[0] * v, T.leaf[1] * v, T.leaf[2] * v];
      if (tint) { tint(x, n, gc); for (let k = 0; k < 3; k++) leaf[k] = leaf[k] * 0.8 + Math.min(gc[k], leaf[k] * 2) * 0.2; }
      const lean = sp === 'pandanus' || sp === 'casuarina' ? (r3 - 0.5) * 0.16 : 0;
      t.list.push({ sp, rank: hash(gx, gy, 38), x, y: h - T.sink - (above < 5 ? 0.4 : 0), z: -n, s, yaw: rS * 6.283, lean, leaf, bark: T.bark });
    }
    t.list.sort((a, b) => a.rank - b.rank);
    return t;
  }

  // ---------------------------------------------------------------- rings around the camera
  let keyNear = '', keyFar = '', pending = false;
  const counts = {};
  function fill(cam, near) {
    const cx = cam.x, cn = -cam.z, R = near ? R1 : R2, r = Math.ceil(R / TT) + 1, tx0 = Math.floor(cx / TT), ty0 = Math.floor(cn / TT);
    const n = {}; for (const id of IDS) n[id] = [0, 0];
    let nf = 0, budget = near ? 400 : 160;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const tx = tx0 + i, ty = ty0 + j, x0 = tx * TT, n0 = ty * TT;
      const dx = Math.max(x0 - cx, 0, cx - x0 - TT), dn = Math.max(n0 - cn, 0, cn - n0 - TT), d = Math.hypot(dx, dn);
      if (d > R || (!near && d + TT * 1.5 < R1)) continue;
      let t = tiles.get(key(tx, ty));
      if (!t) { if (budget-- <= 0 && !first) { pending = true; continue; } t = generate(tx, ty); tiles.set(key(tx, ty), t); }
      for (const o of t.list) {
        if (!near && o.rank > KEEP2) break;               // the list is sorted by rank
        const ddx = o.x - cx, ddn = -o.z - cn, dd = Math.sqrt(ddx * ddx + ddn * ddn);
        if (near) {
          if (dd > R1) continue;
          const lod = dd < R0 ? 1 : 0;
          if (lod === 0 && o.rank > KEEP1) continue;
          const H = herds[o.sp][lod], k = n[o.sp][lod]; if (k >= H.cap) continue;
          H.put(k, o.x, o.y, o.z, o.s, o.yaw, 0, o.lean, o.rank * 6.283, o.leaf[0], o.leaf[1], o.leaf[2], 1, o.bark[0], o.bark[1], o.bark[2], 1);
          n[o.sp][lod] = k + 1;
        } else {
          if (dd <= R1 || dd > R2 || o.rank > KEEP2 || nf >= far.cap) continue;
          // fewer, bigger crowns far away: the canopy keeps its cover as it thins
          const T = TREES[o.sp], hh = T.H * o.s * 1.05, w = T.far * 1.6;
          far.put(nf++, o.x, o.y, o.z, hh, o.yaw, 0, 0, 0, o.leaf[0], o.leaf[1], o.leaf[2], w, o.bark[0], o.bark[1], o.bark[2], 1);
        }
      }
    }
    if (near) for (const id of IDS) { herds[id][0].commit(n[id][0]); herds[id][1].commit(n[id][1]); counts[id] = n[id][0] + n[id][1]; }
    else { far.commit(nf); counts.far = nf; }
  }
  let first = true;
  function update(cam, isFirst) {
    first = isFirst;
    const tide = env.u.tide.value;
    const kN = `${Math.round(cam.x / 12)},${Math.round(cam.z / 12)}`, kF = `${Math.round(cam.x / 64)},${Math.round(cam.z / 64)}`;
    const wasPending = pending; pending = false;
    if (kN !== keyNear || wasPending) { keyNear = kN; fill(cam, true); }
    if (kF !== keyFar || wasPending) { keyFar = kF; fill(cam, false); }
    if (tiles.size > 20000) for (const [k, t] of tiles) { const dx = t.x0 - cam.x, dn = t.n0 + cam.z; if (dx * dx + dn * dn > (R2 + 600) ** 2) tiles.delete(k); }
    first = false;
  }
  return { group, herds, far, update, counts, tiles };
}
