// Island vegetation from the land-cover classes (ESA WorldCover via the build: 10 forest, 11 shrub,
// 12 grass, 13 beach, 14 mangrove, 16 wetland) and the site's profile (profile.js): on the Whitsundays
// open eucalypt forest (carbeen) with hoop pines standing out on the steeper slopes and headlands, pandanus
// and casuarina along the beach fronts, mangroves in the intertidal flats; on the coral cays Pisonia forest
// inside a fringe of octopus bush, sea lettuce, casuarina and pandanus. 64 m tiles, three rings: detailed
// plants near the camera, simpler ones to 650 m, then a thinned set of coarse spindles to 2.6 km so an
// island's skyline reads as forest from the sea. Nothing grows on open beach sand or below the vegetation line.
import * as THREE from 'three/webgpu';
import { Herd, hash } from './kit.js';
import { pick, inside } from './profile.js';
import * as G from './geo.js';

const TT = 64;
const R0 = 160, R1 = 650, R2 = 2600;
const KEEP1 = 0.6, KEEP2 = 0.2;         // share of trees drawn in the middle and far rings (by a per-tree rank)

// model height (m) of each geometry, per-instance scale range, colours (linear albedo), far spindle width/height,
// how far it is sunk, instance capacity [near, mid], and the planting grid (m)
export const TREES = {
  'hoop-pine': { geo: G.hoopPine, H: 30, scale: [0.7, 1.15], leaf: [0.04, 0.07, 0.04], bark: [0.2, 0.13, 0.09], far: 0.26, sink: 0.3, cap: [1500, 6000] },
  carbeen: { geo: G.eucalypt, H: 20, scale: [0.6, 1.25], leaf: [0.09, 0.105, 0.05], bark: [0.3, 0.29, 0.26], far: 0.62, sink: 0.3, cap: [4000, 16000] },
  pandanus: { geo: G.pandanus, H: 6, scale: [0.65, 1.3], leaf: [0.12, 0.135, 0.05], bark: [0.25, 0.21, 0.17], far: 0.95, sink: 0.5, cap: [800, 3000] },
  casuarina: { geo: G.casuarina, H: 16, scale: [0.45, 0.85], leaf: [0.075, 0.09, 0.065], bark: [0.14, 0.11, 0.09], far: 0.42, sink: 0.5, cap: [800, 3000] },
  mangrove: { geo: G.mangrove, H: 7, scale: [0.6, 1.4], leaf: [0.045, 0.085, 0.035], bark: [0.12, 0.09, 0.07], far: 1.0, sink: 0.4, cap: [1500, 5000] },
  // coral cays
  pisonia: { geo: G.pisonia, H: 9, scale: [0.7, 1.2], leaf: [0.1, 0.16, 0.055], bark: [0.36, 0.34, 0.3], far: 1.15, sink: 0.25, cap: [1500, 4000] },
  'octopus-bush': { geo: G.octopusBush, H: 3.6, scale: [0.75, 1.15], leaf: [0.27, 0.32, 0.25], bark: [0.22, 0.19, 0.16], far: 1.4, sink: 0.2, cap: [1500, 4000] },
  scaevola: { geo: G.scaevola, H: 2.4, scale: [0.7, 1.2], leaf: [0.16, 0.21, 0.06], bark: [0.16, 0.2, 0.06], far: 2.0, sink: 0.2, cap: [1500, 4000] },
  'vine-forest': { geo: G.pisonia, H: 9, scale: [0.95, 1.5], leaf: [0.05, 0.09, 0.035], bark: [0.25, 0.22, 0.18], far: 1.1, sink: 0.25, cap: [1500, 4000], vary: 0.45 },
  'beach-scrub': { geo: G.scaevola, H: 2.4, scale: [0.8, 1.4], leaf: [0.1, 0.14, 0.05], bark: [0.1, 0.14, 0.05], far: 2.0, sink: 0.2, cap: [1500, 4000], vary: 0.35 }
};

export function createFlora(ctx, ground, mats, profile) {
  const { env } = ctx;
  const P = profile.flora;
  const IDS = Object.keys(TREES).filter(id => profile.used.has(id));    // only the plants this site has get herds
  const group = new THREE.Group(); group.name = 'life:trees';
  const herds = {};
  for (const id of IDS) {
    const T = TREES[id];
    herds[id] = [new Herd(id + '-mid', T.geo(1), mats.tree, T.cap[1]), new Herd(id, T.geo(2), mats.tree, T.cap[0])];
    group.add(herds[id][0].mesh, herds[id][1].mesh);
  }
  const far = new Herd('trees-far', G.farTree(), mats.farTree, 60000);
  group.add(far.mesh);
  const cell = Math.max(3, Math.min(7, P.cell || 7)), clear = (P.clear || []).filter(c => c.xy && c.xy.length > 2);

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
  const gc = [0, 0, 0], boost = {};
  const SETTING = { 10: 'forest', 11: 'shrub', 12: 'grass', 14: 'mangrove', 16: 'wetland' };
  function choose(cls, coast, steep, above, r) {
    if (cls === 14) return pick(P.mangrove || {}, r);
    let sp;
    if (coast && above < P.coastMaxAbove && P.coast) sp = pick(P.coast, r);
    else if (P[SETTING[cls]] && cls !== 10) sp = pick(P[SETTING[cls]], r);
    else {
      for (const k in boost) delete boost[k];
      for (const [id, [k, mx]] of Object.entries(P.steep || {})) boost[id] = Math.min(mx, steep * k);
      for (const [id, [h, add]] of Object.entries(P.high || {})) if (above > h) boost[id] = (boost[id] || 0) + add;
      sp = pick(P.forest || {}, r, boost);
    }
    return cls === 12 && P.grassSwap && P.grassSwap[sp] ? P.grassSwap[sp] : sp;
  }
  function generate(tx, ty) {
    const x0 = tx * TT, n0 = ty * TT;                        // heights above mean sea level: the same plants at any tide
    const t = { tx, ty, x0, n0, list: [] };
    const [, hi] = ground.maxIn(x0, n0, x0 + TT, n0 + TT);
    if (hi < 0.2 || !IDS.length) return t;
    const nc = Math.round(TT / cell);
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const gx = Math.round(x0 / cell) + i, gy = Math.round(n0 / cell) + j;
      const x = (gx + 0.15 + 0.7 * hash(gx, gy, 31)) * cell, n = (gy + 0.15 + 0.7 * hash(gx, gy, 32)) * cell;
      const cls = ctx.habitat(x, n);
      if (cls < 10 || cls === 13 || cls === 15) continue;         // open beach sand and buildings stay open
      const h = ground.height(x, n);
      if (cls === 14 ? (h < -1.2 || h > 3) : h < P.minAbove) continue;
      if (clear.length && clear.some(c => inside(c.xy, x, n))) continue;
      const rS = hash(gx, gy, 33);
      // near the sea: open water or beach within coastR
      let coast = false;
      if (cls !== 14) for (let k = 0; k < 12 && !coast; k++) { const a = k * 1.047 + rS, rr = k < 6 ? P.coastR[0] : P.coastR[1], c2 = ctx.habitat(x + Math.cos(a) * rr, n + Math.sin(a) * rr); if (c2 < 10 || c2 === 13) coast = true; }
      const [sx, sn] = ground.slope(x, n, 6), steep = Math.hypot(sx, sn);
      const dens = coast && cls !== 14 && P.density.coast !== undefined ? P.density.coast : P.density[cls] ?? 0.14;
      const sp = choose(cls, coast, steep, h, hash(gx, gy, 34));
      if (!sp || !TREES[sp] || !herds[sp] || hash(gx, gy, 35) > dens) continue;
      const T = TREES[sp], r2 = hash(gx, gy, 36), r3 = hash(gx, gy, 37), r4 = hash(gx, gy, 39);
      const s = T.scale[0] + (T.scale[1] - T.scale[0]) * r2;
      const v = 0.8 + 0.4 * r3;
      // a mixed forest (vine-forest) varies more in hue from crown to crown
      const vh = T.vary ? 1 + (r4 - 0.5) * T.vary : 1;
      const leaf = [T.leaf[0] * v * (2 - vh), T.leaf[1] * v, T.leaf[2] * v * vh];
      if (tint) { tint(x, n, gc); for (let k = 0; k < 3; k++) leaf[k] = leaf[k] * 0.8 + Math.min(gc[k], leaf[k] * 2) * 0.2; }
      const lean = sp === 'pandanus' || sp === 'casuarina' ? (r3 - 0.5) * 0.16 : 0;
      // on the shore patch the ground carries shore.js's dunes: stand on them (at mean sea level), and a little in
      const y = ground.land(x, n, 0) - T.sink - (h < 5 ? 0.15 : 0);
      t.list.push({ sp, rank: hash(gx, gy, 38), x, y, z: -n, s, yaw: rS * 6.283, lean, leaf, bark: T.bark });
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
          // the middle ring has fewer trees: wider crowns keep the canopy closed, and the boles darken into its shade
          const w = lod ? 1 : 1.3, bk = lod ? 1 : 0.5;
          H.put(k, o.x, o.y, o.z, o.s, o.yaw, 0, o.lean, o.rank * 6.283, o.leaf[0], o.leaf[1], o.leaf[2], w, o.bark[0] * bk, o.bark[1] * bk, o.bark[2] * bk, 1);
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
  let first = true, wasDeep = false;
  function update(cam, isFirst) {
    first = isFirst;
    const kN = `${Math.round(cam.x / 12)},${Math.round(cam.z / 12)}`, kF = `${Math.round(cam.x / 64)},${Math.round(cam.z / 64)}`;
    const wasPending = pending; pending = false;
    // a diver more than a couple of metres down sees the land only through Snell's window, not tree by tree
    const deep = cam.y < env.u.tide.value - 2.5;
    if (deep !== wasDeep) { wasDeep = deep; keyNear = keyFar = ''; }
    if (deep) { if (keyNear !== 'deep') { keyNear = keyFar = 'deep'; for (const id of IDS) { herds[id][0].commit(0); herds[id][1].commit(0); counts[id] = 0; } far.commit(0); counts.far = 0; } first = false; return; }
    if (kN !== keyNear || wasPending) { keyNear = kN; fill(cam, true); }
    if (kF !== keyFar || wasPending) { keyFar = kF; fill(cam, false); }
    if (tiles.size > 20000) for (const [k, t] of tiles) { const dx = t.x0 - cam.x, dn = t.n0 + cam.z; if (dx * dx + dn * dn > (R2 + 600) ** 2) tiles.delete(k); }
    first = false;
  }
  return { group, herds, far, update, counts, tiles, ids: IDS };
}
