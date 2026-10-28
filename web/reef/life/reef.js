// The reef itself: corals, clams, anemones, rubble and seagrass, scattered from the habitat map in
// 32 m tiles around the camera. A tile is generated once (seeded by its index, so the reef is the same
// on every load) and kept; the instance buffers are rebuilt only when the set of tiles in range or
// their level of detail changes. Near tiles draw detailed shapes; farther ones a coarse shape for the
// bigger colonies in shallow water, which is all that can be seen through the surface from a boat.
import * as THREE from 'three/webgpu';
import { Herd, hash, rng, vnoise } from './kit.js';
import * as G from './geo.js';

const TS = 32;                    // tile size, m
const R_NEAR = 48, R_FAR = 115;   // coarse shapes to R_NEAR (detailed within each kind's `detail`), then only big shallow colonies to R_FAR
const FAR_DEPTH = 9;              // coarse colonies only this shallow: deeper ones are lost in the water from above

// colours are albedos (linear) from photographs of Whitsunday and GBR inshore corals: browns, olives,
// creams with blue, purple, yellow-green tips; the water takes the reds away with depth
const PAL = {
  branching: [[[0.2, 0.13, 0.07], [0.45, 0.42, 0.3]], [[0.12, 0.18, 0.08], [0.38, 0.45, 0.14]], [[0.17, 0.11, 0.08], [0.3, 0.2, 0.48]],
    [[0.2, 0.16, 0.1], [0.16, 0.3, 0.52]], [[0.26, 0.22, 0.14], [0.5, 0.48, 0.38]], [[0.3, 0.18, 0.2], [0.55, 0.42, 0.5]]],
  table: [[[0.24, 0.2, 0.11], [0.5, 0.46, 0.34]], [[0.14, 0.18, 0.09], [0.45, 0.42, 0.14]], [[0.2, 0.21, 0.22], [0.36, 0.28, 0.48]], [[0.26, 0.2, 0.12], [0.3, 0.42, 0.45]]],
  boulder: [[[0.32, 0.26, 0.11], [0.22, 0.15, 0.07]], [[0.4, 0.36, 0.25], [0.3, 0.26, 0.16]], [[0.22, 0.18, 0.32], [0.3, 0.25, 0.4]], [[0.22, 0.26, 0.12], [0.3, 0.3, 0.15]], [[0.28, 0.2, 0.1], [0.36, 0.3, 0.16]]],
  brain: [[[0.3, 0.32, 0.2], [0.14, 0.09, 0.05]], [[0.42, 0.38, 0.28], [0.1, 0.22, 0.08]], [[0.24, 0.3, 0.14], [0.12, 0.1, 0.06]], [[0.36, 0.3, 0.2], [0.18, 0.24, 0.3]]],
  leather: [[[0.48, 0.44, 0.26], [0.55, 0.52, 0.42]], [[0.35, 0.29, 0.16], [0.5, 0.46, 0.36]], [[0.24, 0.27, 0.12], [0.45, 0.43, 0.32]], [[0.42, 0.4, 0.3], [0.56, 0.54, 0.46]]],
  clam: [[[0.3, 0.24, 0.08], [0.16, 0.3, 0.32]], [[0.36, 0.3, 0.1], [0.4, 0.38, 0.14]], [[0.24, 0.2, 0.08], [0.08, 0.26, 0.4]], [[0.32, 0.26, 0.12], [0.2, 0.4, 0.3]]],   // T. gigas: a brownish-yellow mantle
  anemone: [[[0.04, 0.12, 0.6], [0.36, 0.32, 0.16]], [[0.08, 0.42, 0.12], [0.4, 0.36, 0.18]], [[0.55, 0.14, 0.28], [0.42, 0.36, 0.2]], [[0.25, 0.07, 0.42], [0.34, 0.33, 0.18]]],
  rubble: [[[0.42, 0.39, 0.33], [0.17, 0.17, 0.07]], [[0.36, 0.33, 0.28], [0.2, 0.16, 0.08]]],
  seagrass: [[[0.14, 0.3, 0.08], [0.36, 0.34, 0.14]], [[0.16, 0.32, 0.1], [0.4, 0.36, 0.16]], [[0.18, 0.3, 0.08], [0.32, 0.28, 0.12]]]
};
// what grows where: spacing of the candidate grid (m), share of candidates kept per habitat class
// (1 sand, 2 reef and rock, 3 seagrass and algae, 4 rubble), depth range, size range (m), and the
// species id each kind stands for in ctx.life.species
export const KINDS = {
  branching: { sp: 'staghorn', detail: 11, spacing: 1.45, dens: { 2: 0.6, 4: 0.1, 1: 0.01 }, depth: [0.4, 14], size: [0.5, 1.7], far: true, hard: true, cap: [9000, 5000] },
  table: { sp: 'table-coral', detail: 18, spacing: 3.4, dens: { 2: 0.4, 4: 0.05 }, depth: [0.8, 13], size: [0.8, 2.4], far: true, hard: true, cap: [2500, 2500] },
  boulder: { sp: 'porites', detail: 14, spacing: 1.6, dens: { 2: 0.45, 4: 0.09, 1: 0.02, 3: 0.01 }, depth: [0.2, 26], size: [0.22, 2.2], sizePow: 3.4, far: true, hard: true, cap: [6000, 4000] },
  brain: { sp: 'brain-coral', detail: 14, spacing: 2.2, sizePow: 2.6, dens: { 2: 0.35, 4: 0.05 }, depth: [0.5, 22], size: [0.3, 1.3], far: true, hard: true, cap: [3000, 2000] },
  leather: { sp: 'leather-coral', detail: 12, spacing: 2.6, dens: { 2: 0.35, 4: 0.08, 1: 0.008 }, depth: [1.2, 26], size: [0.35, 1.1], far: false, cap: [1500, 3000] },
  clam: { sp: 'giant-clam', detail: 48, spacing: 9, dens: { 2: 0.25, 4: 0.12, 1: 0.03 }, depth: [0.6, 20], size: [0.25, 1.1], nearR: 48, cap: [400, 0] },
  anemone: { sp: 'anemone', detail: 40, spacing: 13, dens: { 2: 0.42 }, depth: [1, 12], size: [0.45, 0.9], nearR: 48, cap: [300, 0] },
  rubble: { sp: null, detail: 30, spacing: 2.1, dens: { 4: 0.6, 2: 0.1 }, depth: [0.2, 30], size: [0.7, 1.3], nearR: 30, cap: [8000, 0] },
  seagrass: { sp: 'seagrass', detail: 18, spacing: 0.42, dens: { 3: 0.9, 1: 0.02 }, depth: [0.3, 20], size: [0.75, 1.0], nearR: 18, cap: [8000, 0] }
};
const ORDER = Object.keys(KINDS);

export function createReef(ctx, ground, mats) {
  const { env } = ctx;
  const herds = {};
  const geos = {
    branching: [G.branching(0), G.branching(1)], table: [G.table(0), G.table(1)], boulder: [G.boulder(0), G.boulder(1)], brain: [G.brain(0), G.brain(1)],
    leather: [G.leather(0), G.leather(1)], clam: [null, G.clam()], anemone: [null, G.anemone()], rubble: [null, G.rubble()], seagrass: [null, G.seagrass()]
  };
  const group = new THREE.Group(); group.name = 'life:reef';
  for (const k of ORDER) {
    herds[k] = [];
    for (const lod of [1, 0]) {
      if (!geos[k][lod] || !KINDS[k].cap[1 - lod]) continue;
      const h = new Herd(`${k}${lod ? '' : '-far'}`, geos[k][lod], mats.coral[k], KINDS[k].cap[1 - lod]);
      herds[k][lod] = h; group.add(h.mesh);
    }
  }

  // ---------------------------------------------------------------- one tile
  const tiles = new Map();
  const key = (tx, ty) => (tx + 32768) * 65536 + (ty + 32768);
  function generate(tx, ty) {
    const x0 = tx * TS, n0 = ty * TS;                 // south-west corner, local metres
    const [lo, hi] = ground.maxIn(x0, n0, x0 + TS, n0 + TS);
    // placement is by depth below mean sea level, not the tide of the moment, so the reef is the same at any
    // hour (reef flats do dry at spring lows here, and the corals on them with it)
    const tide = 0;
    const t = { tx, ty, x0, n0, items: {}, sites: [], clams: [], meanY: (lo + hi) / 2, empty: lo > tide - 0.2 || hi < tide - 32 };
    if (t.empty) return t;
    const present = new Set();
    for (let j = -1; j <= TS / 8 + 1; j++) for (let i = -1; i <= TS / 8 + 1; i++) present.add(ctx.habitat(x0 + i * 8, n0 + j * 8));
    for (const k of ORDER) {
      const K = KINDS[k], S = K.spacing, nc = Math.ceil(TS / S), out = [];
      if (!Object.keys(K.dens).some(c => present.has(+c))) { t.items[k] = new Float32Array(0); continue; }
      const salt = ORDER.indexOf(k) + 1;
      for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
        const gx = Math.floor(x0 / S) + i, gy = Math.floor(n0 / S) + j;
        const x = (gx + hash(gx, gy, salt, 1)) * S, north = (gy + hash(gx, gy, salt, 2)) * S;
        if (x < x0 || x >= x0 + TS || north < n0 || north >= n0 + TS) continue;
        // the habitat map is 10 m pixels: read it a few metres off the point so class edges dither instead of stepping
        const cls = ctx.habitat(x + (hash(gx, gy, salt, 3) - 0.5) * 9, north + (hash(gx, gy, salt, 4) - 0.5) * 9);
        const dens = K.dens[cls]; if (!dens) continue;
        const h = ground.height(x, north), depth = tide - h;
        if (depth < K.depth[0] || depth > K.depth[1]) continue;
        const dz = Math.min((depth - K.depth[0]) / 1.2, (K.depth[1] - depth) / (0.3 * (K.depth[1] - K.depth[0])), 1);
        const patch = 0.3 + 1.2 * Math.sqrt(vnoise(x, north, 17, salt) * vnoise(x, north, 6, salt + 9));   // reefs are patchy at several scales
        if (hash(gx, gy, salt, 5) > dens * dz * patch) continue;
        const it = make(k, x, north, h, depth, hash(gx, gy, salt, 6), hash(gx, gy, salt, 7), hash(gx, gy, salt, 8), hash(gx, gy, salt, 9));
        // a clam or an anemone needs its own patch of reef, clear of the colonies already there
        if ((k === 'clam' || k === 'anemone') && crowded(t, it.rec)) continue;
        out.push(it);
      }
      out.sort((a, b) => a.rank - b.rank);
      const arr = new Float32Array(out.length * 16);
      out.forEach((o, i) => arr.set(o.rec, i * 16));
      t.items[k] = arr;
      if (k === 'branching' || k === 'table' || k === 'anemone') for (const o of out) if (k !== 'branching' || o.rec[3] > 0.9) t.sites.push({ kind: k, i: t.sites.length, x: o.rec[0], y: o.rec[1], z: o.rec[2], s: o.rec[3], h: o.top });
      if (k === 'clam') for (let i = 0; i < out.length; i++) t.clams.push({ x: out[i].rec[0], y: out[i].rec[1], z: out[i].rec[2], s: out[i].rec[3], id: `giant-clam-${tx}_${ty}_${i}` });
    }
    return t;
  }
  function crowded(t, r) {
    for (const k of ['branching', 'table', 'boulder', 'brain', 'leather']) {
      const a = t.items[k]; if (!a) continue;
      for (let o = 0; o < a.length; o += 16) { const dx = a[o] - r[0], dz = a[o + 2] - r[2], m = (a[o + 3] + r[3]) * 0.45; if (dx * dx + dz * dz < m * m) return true; }
    }
    return false;
  }
  // one colony: position on the floor, size, a lean with the slope, colours from the kind's palette
  function make(k, x, north, h, depth, r1, r2, r3, r4) {
    const K = KINDS[k], pal = PAL[k][Math.floor(r1 * PAL[k].length)], rec = new Float32Array(16);
    // sizes: many small, few large (a power law, as colony sizes are)
    let s = K.size[0] + (K.size[1] - K.size[0]) * Math.pow(r2, K.sizePow || 2.2);
    if (k === 'boulder' && depth > 3 && r3 > 0.9) s *= 1.7;                  // the odd Porites bommie, metres across
    // tilt with the slope: the floor's gradient seen in the model's own frame (x forward, z right) after its yaw
    const yaw = r3 * Math.PI * 2, [gx, gn] = ground.slope(x, north), c = Math.cos(yaw), sn = Math.sin(yaw);
    const lean = k === 'seagrass' || k === 'rubble' ? 0.3 : 0.6;
    const pitch = Math.atan(gx * c + gn * sn) * lean, roll = -Math.atan(gx * sn - gn * c) * lean;
    const sink = k === 'table' ? 0.02 : k === 'clam' ? 0.07 : k === 'seagrass' ? 0.005 : 0.05;
    const v = 0.85 + 0.3 * r4;
    const squash = k === 'boulder' ? 0.45 + r3 * 0.5 : k === 'brain' ? 0.55 + r3 * 0.35 : k === 'branching' ? 0.75 + r3 * 0.6 : k === 'table' ? 0.7 + r3 * 0.6 : 0.8 + r3 * 0.4;
    rec[0] = x; rec[1] = h - sink * s; rec[2] = -north; rec[3] = s;
    rec[4] = yaw; rec[5] = pitch; rec[6] = roll; rec[7] = r4 * 6.283;
    rec[8] = pal[0][0] * v; rec[9] = pal[0][1] * v; rec[10] = pal[0][2] * v; rec[11] = squash;
    rec[12] = pal[1][0] * v; rec[13] = pal[1][1] * v; rec[14] = pal[1][2] * v; rec[15] = 0;
    const top = k === 'table' ? 0.34 * squash * s : k === 'branching' ? 0.5 * squash * s : 0.4 * s;
    return { rec, rank: k === 'boulder' || k === 'table' ? r4 * 0.6 / Math.max(0.6, s) : r4, top };   // big colonies first: they carry far
  }

  // ---------------------------------------------------------------- the set in range
  const tmpList = [];
  let lastKey = '', pending = false, built = false;
  const counts = {};
  function update(cam, first = false) {
    const tide = env.u.tide.value, alt = cam.y - tide;
    // under water nothing beyond ~40 m survives the veil, so the coarse ring shrinks and the shallow far ring is skipped
    const under = alt < -0.5, rNear = under ? 40 : R_NEAR;
    const k8 = `${Math.round(cam.x / 6)},${Math.round(cam.z / 6)},${Math.round(Math.min(alt, 300) / 10)},${under}`;
    if (k8 === lastKey && !pending) return false;
    lastKey = k8; pending = false;
    const cx = cam.x, cn = -cam.z;
    tmpList.length = 0;
    let budget = first ? 1e9 : 6;
    if (alt < 220) {
      const r = Math.ceil(R_FAR / TS) + 1, ctx0 = Math.floor(cx / TS), cty0 = Math.floor(cn / TS);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const tx = ctx0 + i, ty = cty0 + j, x0 = tx * TS, n0 = ty * TS;
        const dx = Math.max(x0 - cx, 0, cx - x0 - TS), dn = Math.max(n0 - cn, 0, cn - n0 - TS);
        const dh = Math.hypot(dx, dn);
        if (dh > R_FAR) continue;
        let t = tiles.get(key(tx, ty));
        if (!t) {
          if (budget <= 0) { pending = true; continue; }
          budget--; t = generate(tx, ty); tiles.set(key(tx, ty), t);
        }
        if (t.empty) continue;
        const dist = Math.hypot(dh, Math.max(0, cam.y - (t.meanY + 6)));
        if (dist > R_FAR) continue;
        tmpList.push(t); t.dist = dist;
      }
    }
    // fill the herds: per colony, detailed shapes within the kind's detail radius (3D distance to the eye),
    // coarse ones out to R_NEAR, then only big colonies in shallow water to R_FAR
    const cy = cam.y;
    for (const k of ORDER) {
      const K = KINDS[k], near = herds[k][1], far = herds[k][0], rD = K.detail, rD2 = rD * rD, rN = far ? rNear : K.nearR, rN2 = rN * rN;
      let nn = 0, nf = 0;
      for (const t of tmpList) {
        const a = t.items[k]; if (!a || !a.length) continue;
        if (t.dist < rN) {
          for (let o = 0; o < a.length; o += 16) {
            const dx = a[o] - cam.x, dy = a[o + 1] - cy, dz = a[o + 2] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rD2 && near) { if (nn < near.cap) { near.data.set(a.subarray(o, o + 16), nn * 16); nn++; } }
            else if (d2 < rN2 && far && a[o + 3] * a[o + 3] > d2 * 1.5e-4) { if (nf < far.cap) { far.data.set(a.subarray(o, o + 16), nf * 16); nf++; } }   // skip what would be a few pixels
          }
        } else if (far && K.far && !under) {
          // shallow and big enough to read through the surface; fewer with distance
          const keep = THREE.MathUtils.clamp(1.2 - t.dist / R_FAR, 0.15, 1), m = a.length / 16;
          for (let i = 0; i < m && nf < far.cap; i++) {
            if (i > m * keep) break;
            const o = i * 16; if (tide - a[o + 1] > FAR_DEPTH || a[o + 3] < 0.6) continue;
            far.data.set(a.subarray(o, o + 16), nf * 16); nf++;
          }
        }
      }
      if (near) near.commit(nn); if (far) far.commit(nf);
      counts[k] = nn + nf;
    }
    // forget tiles far behind
    if (tiles.size > 900) for (const [kk, t] of tiles) { const dx = t.x0 + TS / 2 - cx, dn = t.n0 + TS / 2 - cn; if (dx * dx + dn * dn > 600 * 600) tiles.delete(kk); }
    built = true;
    return true;
  }
  // tiles currently in range (for the fauna) and the spawning sources
  const active = () => tmpList;
  return { group, herds, update, active, counts, tiles, TS, get pending() { return pending; } };
}
