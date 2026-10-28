// Animals: schools, reef residents and wanderers, simulated only near the camera.
//   reef residents hang on the reef tiles' sites: chromis and humbugs over branching colonies, clownfish
//   in anemones, sweetlips under table corals, parrotfish grazing, the odd Maori wrasse, ribbontail rays
//   resting on the floor between colonies, fusilier schools over the slope;
//   wanderers belong to 128 m cells of open water: turtles (they surface to breathe), blacktip reef
//   sharks, eagle rays, trevally schools, and a manta that only visits now and then.
// Every group is seeded from its tile or cell, so the same animals live in the same places each load.
// Steering is a few lines per animal (boids-lite for schools): no allocations per frame.
import * as THREE from 'three/webgpu';
import { Herd, hash, rng } from './kit.js';
import * as G from './geo.js';

const TAU = Math.PI * 2, clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const CELL = 128, R_SIM = 120;

// per species: model, scale range (m: body length, ray span, turtle carapace), colours, speeds
export const FAUNA = {
  chromis: { geo: () => G.fish({ small: true, depth: 0.38, width: 0.13, tail: 0.6, tailShape: 'fork', dorsal: [0.2, 0.7, 0.3], anal: [0.55, 0.72, 0.28] }), mat: 'fish', cap: 1600, len: [0.06, 0.09],
    cols: [[[0.16, 0.5, 0.36], [0.4, 0.78, 0.72]], [[0.14, 0.42, 0.5], [0.36, 0.72, 0.8]]], cruise: 0.15 },
  humbug: { geo: () => G.fish({ small: true, depth: 0.55, width: 0.15, tail: 0.45, tailShape: 'fork', dorsal: [0.15, 0.72, 0.35], anal: [0.5, 0.72, 0.35], spiky: true }), mat: 'fish', cap: 700, len: [0.05, 0.08],
    cols: [[[0.85, 0.86, 0.85], [0.03, 0.03, 0.03]]], cruise: 0.12 },
  fusilier: { geo: () => G.fish({ small: true, depth: 0.26, width: 0.11, tail: 0.75, tailShape: 'fork', dorsal: [0.25, 0.68, 0.18], anal: [0.55, 0.72, 0.15], snout: 0.5 }), mat: 'fish', cap: 700, len: [0.18, 0.27],
    cols: [[[0.3, 0.42, 0.62], [0.95, 0.8, 0.12]]], cruise: 0.7 },
  trevally: { geo: () => G.fish({ depth: 0.34, width: 0.12, tail: 0.75, tailShape: 'lunate', dorsal: [0.3, 0.7, 0.2], anal: [0.5, 0.72, 0.18], peduncle: 0.12 }), mat: 'fish', cap: 220, len: [0.45, 0.68],
    cols: [[[0.78, 0.8, 0.82], [0.3, 0.36, 0.4]]], cruise: 0.9 },
  parrotfish: { geo: () => G.fish({ depth: 0.34, width: 0.15, tail: 0.5, tailShape: 'lunate', dorsal: [0.2, 0.72, 0.13], anal: [0.55, 0.74, 0.12], snout: 0.3 }), mat: 'fish', cap: 120, len: [0.28, 0.5],
    cols: [[[0.12, 0.5, 0.42], [0.7, 0.32, 0.36]], [[0.15, 0.45, 0.5], [0.65, 0.42, 0.3]], [[0.18, 0.52, 0.36], [0.72, 0.55, 0.3]]], cruise: 0.5 },
  'maori-wrasse': { geo: () => G.fish({ depth: 0.36, width: 0.16, hump: 0.35, tail: 0.42, tailShape: 'round', dorsal: [0.2, 0.75, 0.16], anal: [0.55, 0.76, 0.16], pectoral: 0.14 }), mat: 'fish', cap: 10, len: [0.9, 1.5],
    cols: [[[0.14, 0.36, 0.32], [0.55, 0.52, 0.2]], [[0.16, 0.3, 0.36], [0.5, 0.5, 0.22]]], cruise: 0.35 },
  clownfish: { geo: () => G.fish({ small: true, depth: 0.42, width: 0.16, tail: 0.4, tailShape: 'round', dorsal: [0.2, 0.74, 0.25], anal: [0.55, 0.74, 0.2] }), mat: 'fish', cap: 200, len: [0.07, 0.12],
    cols: [[[0.55, 0.2, 0.05], [0.7, 0.36, 0.06]], [[0.45, 0.18, 0.06], [0.68, 0.34, 0.08]]], cruise: 0.1 },
  sweetlips: { geo: () => G.fish({ depth: 0.36, width: 0.14, tail: 0.42, tailShape: 'trunc', dorsal: [0.2, 0.75, 0.2], anal: [0.58, 0.74, 0.18], snout: 0.3 }), mat: 'fish', cap: 120, len: [0.4, 0.65],
    cols: [[[0.42, 0.43, 0.42], [0.08, 0.08, 0.08]]], cruise: 0.2 },
  blacktip: { geo: () => G.sharkGeo(), mat: 'shark', cap: 12, len: [1.0, 1.6], cols: [[[0.42, 0.38, 0.32], [0, 0, 0]]], cruise: 1.0 },
  ribbontail: { geo: () => G.batoid('ribbon'), mat: 'ribbontail', cap: 50, len: [0.2, 0.33], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 0.4 },
  'eagle-ray': { geo: () => G.batoid('eagle'), mat: 'eagle', cap: 6, len: [0.75, 1.1], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 1.0 },
  manta: { geo: () => G.batoid('manta'), mat: 'manta', cap: 6, len: [1.9, 2.25], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 0.8 },
  'green-turtle': { geo: () => G.turtle(), mat: 'green', cap: 16, len: [0.8, 1.1], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 0.4 },
  hawksbill: { geo: () => G.turtle({ beak: 0.25 }), mat: 'hawksbill', cap: 12, len: [0.6, 0.85], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 0.35 },
  loggerhead: { geo: () => G.turtle({ head: 1.35 }), mat: 'loggerhead', cap: 8, len: [0.85, 1.0], cols: [[[1, 1, 1], [0, 0, 0]]], cruise: 0.35 }
};
const TURTLE = new Set(['green-turtle', 'hawksbill', 'loggerhead']);

export function createFauna(ctx, ground, mats, reef, profile = { fauna: {}, flora: { minAbove: 2.2 } }) {
  const { env, camera } = ctx;
  const PF = profile.fauna || {}, mul = id => PF[id] === undefined ? 1 : typeof PF[id] === 'number' ? PF[id] : (PF[id].mul ?? 1);
  const group = new THREE.Group(); group.name = 'life:fauna';
  const herds = {};
  for (const [id, F] of Object.entries(FAUNA)) {
    const m = F.mat === 'fish' ? mats.fish[id] : F.mat === 'shark' ? mats.sharkMat([0.02, 0.02, 0.02]) : mats.ray[F.mat] || mats.turtle[F.mat];
    herds[id] = new Herd(id, F.geo(), m, F.cap, { dynamic: true });
    group.add(herds[id].mesh);
  }
  const tide = () => env.u.tide.value;
  const floorAt = (x, z) => ground.height(x, -z);

  // ---------------------------------------------------------------- animals
  const animals = [];          // all live ones, for the queries
  const groups = new Map();    // key -> group (from a tile or a cell)
  function animal(sp, id, x, y, z, r) {
    const F = FAUNA[sp], c = F.cols[Math.floor(r() * F.cols.length)], v = 0.88 + 0.24 * r();
    const len = F.len[0] + (F.len[1] - F.len[0]) * r();
    return { sp, id, x, y, z, vx: 0, vy: 0, vz: 0, yaw: r() * TAU, pitch: 0, roll: 0, speed: 0, len, ph: r() * TAU, r,
      c1: c[0].map(k => k * v), c2: c[1].map(k => k * v), amp: 0.08, freq: 8, state: 0, timer: r() * 5, tx: x, ty: y, tz: z, hx: x, hy: y, hz: z, ox: 0, oy: 0, oz: 0, cruise: F.cruise * (0.8 + 0.4 * r()) };
  }

  // ---- residents of a reef tile: the small site-attached fish only close to the camera (they vanish in the
  // water beyond ~35 m anyway), the bigger residents farther out
  function tileGroups(t, cls) {
    const out = [], R = rng(hash(t.tx, t.ty, cls === 's' ? 77 : 78));
    const sites = t.sites;
    if (cls === 's') {
      let clouds = 0;
      const big = sites.filter(s => s.kind === 'branching').sort((a, b) => b.s - a.s);
      for (const s of sites) if (s.kind === 'anemone') {
        const g = { kind: 'cloud', sp: 'clownfish', site: s, radius: 0.32 * s.s + 0.1, top: s.y + 0.12 * s.s, members: [] };
        const n = 2 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) g.members.push(cloudMember(g, `clownfish-${t.tx}_${t.ty}_${s.i}-${i}`, i === 0 ? 1.4 : 1, R));
        out.push(g);
      }
      for (const s of big) {
        if (clouds >= 3) break;
        if (R() > 0.8) continue;
        clouds++;
        const sp = R() < 0.65 ? 'chromis' : 'humbug';
        const g = { kind: 'cloud', sp, site: s, radius: s.s * 0.55, top: s.y + s.h, members: [] };
        const n = sp === 'chromis' ? 6 + Math.floor(R() * 12 * s.s) : 3 + Math.floor(R() * 7);
        for (let i = 0; i < n; i++) g.members.push(cloudMember(g, `${sp}-${t.tx}_${t.ty}_${s.i}-${i}`, 1, R));
        out.push(g);
      }
      return out;
    }
    const table = sites.filter(s => s.kind === 'table' && s.s > 1.3);
    if (table.length && R() < 0.6) {
      const s = table[Math.floor(R() * table.length)];
      // harlequin sweetlips adults are solitary, sheltering under ledges (here: a table coral's plate)
      const g = { kind: 'hover', sp: 'sweetlips', site: s, radius: s.s * 0.5, top: s.y + s.h * 0.6, members: [] };
      const n = R() < 0.75 ? 1 : 2;
      for (let i = 0; i < n; i++) g.members.push(cloudMember(g, `sweetlips-${t.tx}_${t.ty}_${s.i}-${i}`, 1, R));
      out.push(g);
    }
    // grazers, a cruising wrasse, a ray on the floor, a fusilier school: by how much reef the tile has
    const reefy = sites.length;
    const cx = t.x0 + reef.TS / 2, cn = t.n0 + reef.TS / 2, d = tide() - ground.height(cx, cn);
    const nP = reefy > 6 ? Math.floor(R() * 3.2) : reefy > 1 ? (R() < 0.4 ? 1 : 0) : 0;
    for (let i = 0; i < nP; i++) out.push(solo('parrotfish', `parrotfish-${t.tx}_${t.ty}_${i}`, t, R, 'graze'));
    if (reefy > 4 && R() < 0.06) out.push(solo('maori-wrasse', `maori-wrasse-${t.tx}_${t.ty}`, t, R, 'cruise'));
    if (d > 1 && R() < 0.14) out.push(solo('ribbontail', `ribbontail-${t.tx}_${t.ty}`, t, R, 'rest'));
    if (reefy > 3 && d > 3 && R() < 0.1) out.push(school('fusilier', `fusilier-${t.tx}_${t.ty}`, cx, cn, 22 + Math.floor(R() * 40), R, [2, 6]));
    return out;
  }
  function cloudMember(g, id, scale, R) {
    const s = g.site, a = R() * TAU, rr = Math.sqrt(R()) * g.radius;
    const m = animal(g.sp, id, s.x + Math.cos(a) * rr, g.top + 0.1 + R() * 0.4, s.z + Math.sin(a) * rr, R);
    m.ox = Math.cos(a) * rr; m.oz = Math.sin(a) * rr; m.oy = 0.08 + R() * (g.sp === 'chromis' ? 0.7 : g.sp === 'sweetlips' ? 0.3 : 0.25);
    if (g.kind === 'hover') { m.oy = -0.05 - R() * 0.25; const e = 0.8 + R() * 0.3; m.ox *= e * 1.3; m.oz *= e * 1.3; }
    m.len *= scale; m.yaw = R() * TAU;
    return m;
  }
  function solo(sp, id, t, R, mode) {
    const x = t.x0 + R() * reef.TS, n = t.n0 + R() * reef.TS, h = ground.height(x, n);
    const a = animal(sp, id, x, Math.min(h + 0.6 + R() * 1.5, tide() - 0.5), -n, R);
    if (sp === 'ribbontail') a.y = h + 0.03;
    return { kind: 'solo', sp, mode, members: [a], home: [x, -n], range: sp === 'maori-wrasse' ? 40 : sp === 'parrotfish' ? 18 : 14 };
  }
  function school(sp, id, x, n, count, R, band) {
    const h = ground.height(x, n), y = clamp(h + band[0] + R() * (band[1] - band[0]), h + 1, tide() - 1);
    const g = { kind: 'school', sp, members: [], cx: x, cy: y, cz: -n, cyaw: R() * TAU, cspeed: FAUNA[sp].cruise, home: [x, -n], band, range: 45, timer: 0, tx: x, tz: -n, ty: y };
    for (let i = 0; i < count; i++) {
      const a = animal(sp, `${id}-${i}`, x, y, -n, R);
      // a slot in a loose ellipsoid around the school's centre, in its own frame
      const sz = Math.cbrt(count) * a.len * 1.1;
      a.ox = (R() - 0.5) * 2.6 * sz; a.oy = (R() - 0.5) * 1.0 * sz; a.oz = (R() - 0.5) * 1.6 * sz;
      a.x += a.ox; a.y += a.oy; a.z += a.oz; a.yaw = g.cyaw;
      g.members.push(a);
    }
    return g;
  }
  // ---- wanderers of a 256 m cell of open water
  function cellGroups(cx, cy) {
    const out = [], R = rng(hash(cx, cy, 91));
    const x = (cx + 0.2 + 0.6 * R()) * CELL, n = (cy + 0.2 + 0.6 * R()) * CELL, d = tide() - ground.height(x, n), cls = ctx.habitat(x, n);
    if (d < 1.2) return out;
    const one = (sp, mode, yOff) => {
      const a = animal(sp, `${sp}-c${cx}_${cy}_${out.length}`, x, 0, -n, R);
      a.y = clamp(ground.height(x, n) + yOff, ground.height(x, n) + 0.5, tide() - 0.4);
      if (sp === 'manta') a.y = clamp(tide() - 2 - a.ph, ground.height(x, n) + 1.5, tide() - 1.2);      // up in the plankton
      return { kind: 'solo', sp, mode, members: [a], home: [x, -n], range: 55 };
    };
    // green turtles graze seagrass, hawksbills keep to the reef; a site's profile can make any of them commoner
    const mG = mul('green-turtle'), mH = mul('hawksbill'), mL = mul('loggerhead') === 1 && PF.loggerhead === undefined ? 0 : mul('loggerhead');
    if (mG === 1 && mH === 1 && !mL) { if (d < 22 && R() < 0.4) out.push(one(cls === 3 || (cls !== 2 && R() < 0.6) ? 'green-turtle' : 'hawksbill', 'turtle', 1)); }
    else {
      const k = Math.max(mG, mH, mL), r1 = R(), r2 = R();
      for (let i = 0; i < Math.ceil(k * 0.4); i++) if (d < 22 && (i === 0 ? r1 : R()) < Math.min(0.95, 0.4 * k - i)) {
        const wG = (cls === 3 ? 1 : cls !== 2 ? 0.6 : 0.1) * mG, wH = (cls === 2 ? 1 : 0.4) * mH, wL = 0.3 * mL, r = (i === 0 ? r2 : R()) * (wG + wH + wL);
        out.push(one(r < wG ? 'green-turtle' : r < wG + wH ? 'hawksbill' : 'loggerhead', 'turtle', 1));
      }
    }
    if (d < 14 && R() < Math.min(0.9, 0.14 * mul('blacktip'))) out.push(one('blacktip', 'patrol', 1.5));
    if (d > 3 && R() < Math.min(0.9, 0.05 * mul('eagle-ray'))) out.push(one('eagle-ray', 'glide', 3));
    const pm = PF.manta && PF.manta.p !== undefined ? PF.manta.p : 0.025 * mul('manta');
    if (d > 6 && R() < pm) out.push(one('manta', 'visit', 4));
    if (d > 5 && R() < Math.min(0.9, 0.06 * mul('trevally'))) out.push(school('trevally', `trevally-c${cx}_${cy}`, x, n, 20 + Math.floor(R() * 25), R, [3, 8]));
    return out;
  }

  // ---------------------------------------------------------------- turtles nesting on the beach (profile.nesting)
  // On a night in the season a few turtles come up the upper beach, dig a body pit and a nest at the foot of the
  // vegetation, lay, cover it and go back to the sea. Each has its own spot and start time that night (seeded by
  // the night), so the beach is the same if you come back; the timing is the model clock's.
  const NEST = profile.nesting, minAbove = (profile.flora && profile.flora.minAbove) || 2.2, TT = 64;
  const nestState = { on: false, night: 0, start: 0, checked: -1e18 };
  const sp0 = NEST ? Object.entries(NEST.species || { 'green-turtle': 1 }) : [];
  function nestSync(cam, want) {
    if (!NEST || !window.Sun) return;
    const ms = ctx.clockMs ? ctx.clockMs() : Date.now(), S = ctx.S;
    if (Math.abs(ms - nestState.checked) > 6e4) {
      nestState.checked = ms;
      const L = window.Sun.utcToLocal(ms - 12 * 3600e3, S.timezone), alt = window.Sun.position(ms, S.origin[1], S.origin[0]).altitude;
      const lm = window.Sun.utcToLocal(ms, S.timezone).m;
      nestState.on = (NEST.months || []).includes(lm) && alt < -6;
      nestState.night = Date.UTC(L.y, L.m - 1, L.d) / 864e5;
      nestState.start = window.Sun.localToUtc(L.y, L.m, L.d, 19 * 60, S.timezone);   // the evening the night began
    }
    if (!nestState.on) return;
    const tx0 = Math.floor(cam.x / TT), ty0 = Math.floor(-cam.z / TT);
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const tx = tx0 + i, ty = ty0 + j, x0 = tx * TT, n0 = ty * TT;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - TT), dn = Math.max(n0 + cam.z, 0, -cam.z - n0 - TT);
      if (Math.hypot(dx, dn) > 180) continue;
      const k = 'n' + tx + '_' + ty + '_' + nestState.night; want.add(k);
      if (!groups.has(k)) groups.set(k, nestGroups(tx, ty));
    }
  }
  function nestGroups(tx, ty) {
    const out = [], x0 = tx * TT, n0 = ty * TT, [, hi] = ground.maxIn(x0, n0, x0 + TT, n0 + TT), night = nestState.night;
    if (hi < minAbove - 0.9) return out;
    const S = 6, p = Math.min(1, (NEST.perKm || 30) * S / 1000), ar = NEST.around;
    for (let j = 0; j < TT / S; j++) for (let i = 0; i < TT / S; i++) {
      const gx = Math.round(x0 / S) + i, gy = Math.round(n0 / S) + j, x = (gx + hash(gx, gy, 61)) * S, n = (gy + hash(gx, gy, 62)) * S;
      if (ar && Math.hypot(x - ar[0], n - ar[1]) > ar[2]) continue;
      const h = ground.height(x, n);
      if (h < minAbove - 0.9 || h > minAbove + 0.15 || ctx.habitat(x, n) !== 13) continue;
      if (hash(gx, gy, night, 63) > p) continue;
      // the way down to the water, straight downhill
      let wx = x, wn = n;
      for (let s = 0; s < 30; s++) {
        const [sx, sn] = ground.slope(wx, wn, 2), L = Math.hypot(sx, sn) || 1;
        wx -= sx / L * 1.5; wn -= sn / L * 1.5;
        if (ground.height(wx, wn) < -0.2) break;
      }
      const R = rng(hash(gx, gy, night, 64));
      let r = R(), sp = sp0[0][0];
      for (const [id, w] of sp0) { if (r < w) { sp = id; break; } r -= w; }
      const a = animal(sp, `${sp}-nest-${gx}_${gy}_${night}`, wx, 0, -wn, R);
      a.len = FAUNA[sp].len[0] + (FAUNA[sp].len[1] - FAUNA[sp].len[0]) * R();
      out.push({ kind: 'nest', sp, members: [a], N: [x, n], W: [wx, wn], t0: nestState.start + R() * 8.5 * 3600e3 });
    }
    return out;
  }
  // crawl up (20 min), body pit, nest, eggs, covering (80 min), back to the sea (18 min); then gone
  function updateNest(g) {
    const a = g.members[0], t = ((ctx.clockMs ? ctx.clockMs() : Date.now()) - g.t0) / 6e4;
    a.hidden = t < 0 || t > 118;
    if (a.hidden) return;
    const e = f => f * f * (3 - 2 * f);
    const f = t < 20 ? e(t / 20) : t < 100 ? 1 : 1 - e((t - 100) / 18);
    a.state = t < 20 ? 1 : t < 100 ? 2 : 3;
    const x = g.W[0] + (g.N[0] - g.W[0]) * f, n = g.W[1] + (g.N[1] - g.W[1]) * f;
    const up = Math.atan2(g.N[1] - g.W[1], g.N[0] - g.W[0]);
    a.yaw = a.state === 3 ? up + Math.PI : up;
    const g0 = ground.land(x, n, tide()), g1 = ground.land(x + Math.cos(a.yaw) * 0.5, n + Math.sin(a.yaw) * 0.5, tide());
    a.pitch = Math.atan2(g1 - g0, 0.5); a.roll = 0;
    a.x = x; a.z = -n; a.y = g0 + 0.06 * a.len - (a.state === 2 ? 0.18 * Math.min(1, (t - 20) / 10) : 0);
    a.speed = a.state === 2 ? 0 : 0.02;
  }

  // ---------------------------------------------------------------- what is in range
  const diver = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, px: NaN, py: 0, pz: 0 };
  function sync(cam) {
    const want = new Set();
    for (const t of reef.active()) {
      for (const [cls, R] of [['s', 40], ['m', 85]]) {
        const k = 't' + t.tx + '_' + t.ty + cls, have = groups.has(k);
        if (t.dist > R + (have ? 10 : 0)) continue;           // a little hysteresis at the edge
        want.add(k);
        if (!have) groups.set(k, tileGroups(t, cls));
      }
    }
    const cx0 = Math.floor(cam.x / CELL), cy0 = Math.floor(-cam.z / CELL);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const cx = cx0 + i, cy = cy0 + j, k = 'c' + cx + '_' + cy;
      const dx = Math.max(cx * CELL - cam.x, 0, cam.x - (cx + 1) * CELL), dn = Math.max(cy * CELL + cam.z, 0, -cam.z - (cy + 1) * CELL);
      if (Math.hypot(dx, dn) > 160) continue;
      want.add(k);
      if (!groups.has(k)) groups.set(k, cellGroups(cx, cy));
    }
    nestSync(cam, want);
    for (const k of groups.keys()) if (!want.has(k)) groups.delete(k);
    animals.length = 0;
    for (const gs of groups.values()) for (const g of gs) for (const a of g.members) animals.push(a);
  }

  // ---------------------------------------------------------------- behaviour
  let night = 0, T = 0;
  // turn and pitch toward a target, at a cruising speed
  function seek(a, tx, ty, tz, speed, turn, dt) {
    const dx = tx - a.x, dy = ty - a.y, dz = tz - a.z, dh = Math.hypot(dx, dz);
    const want = Math.atan2(-dz, dx), dyaw = clamp(angDiff(a.yaw, want), -turn * dt, turn * dt);
    a.yaw += dyaw; a.roll += (clamp(-dyaw / Math.max(dt, 1e-3) * 0.35, -0.5, 0.5) - a.roll) * Math.min(1, dt * 3);
    const mp = TURTLE.has(a.sp) ? 0.42 : 0.7;      // turtles climb and dive at a shallow angle
    a.pitch += (clamp(Math.atan2(dy, Math.max(dh, 0.5)), -mp, mp) - a.pitch) * Math.min(1, dt * 2);
    a.speed += (speed - a.speed) * Math.min(1, dt * 1.5);
    move(a, dt);
    return dh;
  }
  function move(a, dt) {
    const cp = Math.cos(a.pitch);
    a.vx = Math.cos(a.yaw) * cp * a.speed; a.vz = -Math.sin(a.yaw) * cp * a.speed; a.vy = Math.sin(a.pitch) * a.speed;
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    const f = floorAt(a.x, a.z) + 0.15, s = tide() - 0.25;
    if (a.y < f) a.y = f; if (a.y > s && !TURTLE.has(a.sp)) a.y = s;
  }
  // how much an animal wants to get away from the diver: close, and the diver moving fast
  function fear(a, R) {
    const dx = a.x - diver.x, dy = a.y - diver.y, dz = a.z - diver.z, d = Math.hypot(dx, dy, dz);
    if (d > R) return 0;
    return (1 - d / R) * clamp((diver.speed - 0.4) / 1.2, 0.15, 1);
  }
  function newTarget(a, g, R, yMin, yMax) {
    const ang = a.r() * TAU, rr = Math.sqrt(a.r()) * g.range;
    a.tx = g.home[0] + Math.cos(ang) * rr; a.tz = g.home[1] + Math.sin(ang) * rr;
    const f = floorAt(a.tx, a.tz);
    a.ty = clamp(f + yMin + a.r() * (yMax - yMin), f + 0.3, tide() - 0.6);
    if (tide() - f < 0.8) { a.tx = g.home[0]; a.tz = g.home[1]; a.ty = clamp(floorAt(a.tx, a.tz) + yMin, -1e9, tide() - 0.6); }
  }

  function updateCloud(g, dt) {
    const s = g.site, hide = night > 0.5 ? 0.25 : 1;
    // at low tide a reef flat can be all but dry: the site's fish have gone to deeper water until it floods again
    const gone = tide() - g.top < 0.45;
    for (const a of g.members) a.hidden = gone;
    if (gone) return;
    // fish over a coral head drop into it when a diver comes close quickly; the anemone's clowns stay
    let scare = 0;
    for (const a of g.members) scare = Math.max(scare, fear(a, g.sp === 'clownfish' ? 1.2 : 4));
    // once startled they stay down in the branches for a while before drifting back up
    g.scare = Math.max((g.scare || 0) * Math.exp(-dt / 5), Math.min(1, scare * 2));
    const spread = Math.min(hide, 1 - g.scare * 0.85);
    for (const a of g.members) {
      const w = T * (g.kind === 'hover' ? 0.15 : 0.6) + a.ph, wob = g.radius * 0.25 * spread;
      const tx = s.x + a.ox * spread + Math.sin(w * 1.3) * wob, tz = s.z + a.oz * spread + Math.cos(w * 1.1) * wob;
      const ty = g.top - (1 - spread) * 0.15 + a.oy * spread + Math.sin(w * 0.7) * 0.06;
      const k = 1 - Math.exp(-dt * (2 + scare * 6));
      const nx = a.x + (tx - a.x) * k, ny = a.y + (ty - a.y) * k, nz = a.z + (tz - a.z) * k;
      a.vx = (nx - a.x) / dt; a.vy = (ny - a.y) / dt; a.vz = (nz - a.z) / dt; a.x = nx; a.y = ny; a.z = nz;
      a.speed = Math.hypot(a.vx, a.vz);
      // face where they go when darting, otherwise hang head into the surge with small turns
      const want = a.speed > 0.08 ? Math.atan2(-a.vz, a.vx) : a.yaw + Math.sin(T * 0.4 + a.ph) * 0.02;
      a.yaw += angDiff(a.yaw, want) * Math.min(1, dt * 3); a.pitch *= 0.95; a.roll *= 0.9;
    }
  }
  function updateSchool(g, dt) {
    const F = FAUNA[g.sp];
    // the centre wanders between waypoints in its range and runs from a fast diver
    g.timer -= dt;
    const dc = Math.hypot(g.tx - g.cx, g.tz - g.cz);
    if (dc < 4 || g.timer < 0) {
      g.timer = 20 + 20 * g.members[0].r();
      const ang = g.members[0].r() * TAU, rr = Math.sqrt(g.members[0].r()) * g.range;
      g.tx = g.home[0] + Math.cos(ang) * rr; g.tz = g.home[1] + Math.sin(ang) * rr;
      const f = floorAt(g.tx, g.tz); g.ty = clamp(f + g.band[0] + g.members[0].r() * (g.band[1] - g.band[0]), f + 1, tide() - 0.8);
      if (tide() - f < 2) { g.tx = g.home[0]; g.tz = g.home[1]; }
    }
    const ddx = g.cx - diver.x, ddz = g.cz - diver.z, dd = Math.hypot(ddx, ddz, g.cy - diver.y);
    let want = Math.atan2(-(g.tz - g.cz), g.tx - g.cx), sp = g.cspeed * (night > 0.5 ? 0.4 : 1);
    if (dd < 10) { const away = Math.atan2(-ddz, ddx); want = want + angDiff(want, away) * (1 - dd / 10) * clamp(diver.speed, 0.3, 1); sp *= 1 + (1 - dd / 10) * diver.speed; }
    g.cyaw += clamp(angDiff(g.cyaw, want), -0.35 * dt, 0.35 * dt);
    g.cx += Math.cos(g.cyaw) * sp * dt; g.cz -= Math.sin(g.cyaw) * sp * dt; g.cy += (g.ty - g.cy) * Math.min(1, dt * 0.2);
    const fl = floorAt(g.cx, g.cz); g.cy = clamp(g.cy, fl + 1, tide() - 0.8);
    const c = Math.cos(g.cyaw), s = Math.sin(g.cyaw), M = g.members, n = M.length;
    for (let i = 0; i < n; i++) {
      const a = M[i];
      // slot in the school's frame (it breathes in and out), steered to with a spring; separation from the neighbour
      const br = 1 + 0.15 * Math.sin(T * 0.3 + a.ph);
      const sx = g.cx + (a.ox * c + a.oz * s) * br, sz = g.cz + (-a.ox * s + a.oz * c) * br, sy = g.cy + a.oy * br;
      let ax = (sx - a.x) * 0.9 - a.vx * 0.9 + Math.cos(g.cyaw) * sp * 0.9, ay = (sy - a.y) * 0.9 - a.vy * 1.2, az = (sz - a.z) * 0.9 - a.vz * 0.9 - Math.sin(g.cyaw) * sp * 0.9;
      const b = M[(i + 1) % n], ex = a.x - b.x, ey = a.y - b.y, ez = a.z - b.z, e2 = ex * ex + ey * ey + ez * ez, min2 = a.len * a.len * 1.2;
      if (e2 < min2 && e2 > 1e-6) { const k = (min2 - e2) / min2 * 3; ax += ex * k / a.len; ay += ey * k / a.len; az += ez * k / a.len; }
      const fr = fear(a, 4.5);
      if (fr > 0) { const dx = a.x - diver.x, dy = a.y - diver.y, dz = a.z - diver.z, d = Math.hypot(dx, dy, dz) + 1e-3; ax += dx / d * fr * 6; ay += dy / d * fr * 3; az += dz / d * fr * 6; }
      a.vx += ax * dt; a.vy += ay * dt; a.vz += az * dt;
      const v = Math.hypot(a.vx, a.vy, a.vz), vmax = F.cruise * 3;
      if (v > vmax) { a.vx *= vmax / v; a.vy *= vmax / v; a.vz *= vmax / v; }
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      const f = floorAt(a.x, a.z) + 0.3; if (a.y < f) { a.y = f; a.vy = Math.abs(a.vy); }
      if (a.y > tide() - 0.3) { a.y = tide() - 0.3; a.vy = -Math.abs(a.vy); }
      a.speed = Math.hypot(a.vx, a.vz);
      if (v > 0.05) { a.yaw += angDiff(a.yaw, Math.atan2(-a.vz, a.vx)) * Math.min(1, dt * 4); a.pitch += (clamp(Math.atan2(a.vy, a.speed), -0.6, 0.6) - a.pitch) * Math.min(1, dt * 3); }
    }
  }
  function updateSolo(g, dt) {
    const a = g.members[0], sp = g.sp;
    a.hidden = !TURTLE.has(sp) && tide() - floorAt(a.x, a.z) < 0.35;          // left the drying flat for deeper water
    if (a.hidden) return;
    a.timer -= dt;
    const fr = fear(a, sp === 'blacktip' ? 7 : sp === 'manta' ? 4 : 5);   // blacktips are timid and skittish
    if (g.mode === 'graze') {
      // parrotfish: swim to a spot on the reef, bite at it for a few seconds, move on (asleep at night)
      if (night > 0.5) { a.speed *= 0.9; a.pitch *= 0.9; move(a, dt); return; }
      if (a.state === 0) { if (seek(a, a.tx, a.ty, a.tz, a.cruise * (1 + fr * 3), 1.6, dt) < 0.6 || a.timer < 0) { a.state = 1; a.timer = 2 + 4 * a.r(); } }
      else { a.speed *= Math.exp(-dt * 3); a.pitch += (-0.5 - a.pitch) * Math.min(1, dt * 2); a.y += Math.sin(T * 6 + a.ph) * 0.002; move(a, dt); if (a.timer < 0 || fr > 0.3) { a.state = 0; a.timer = 12; newTarget(a, g, 0, 0.25, 0.8); } }
      if (fr > 0.3 && a.state === 0) fleeTarget(a, 6);
    } else if (g.mode === 'cruise') {
      if (a.timer < 0 || seek(a, a.tx, a.ty, a.tz, a.cruise, 0.5, dt) < 1.5) { a.timer = 20; newTarget(a, g, 0, 1, 3); }
      if (a.state === 0 && fr > 0.5) { fleeTarget(a, 8); a.state = 1; } else if (fr === 0) a.state = 0;
    } else if (g.mode === 'rest') {
      // ribbontail ray: lies on the floor, glides off to another spot now and then, or when startled
      if (a.state === 0) {
        a.speed = 0; a.pitch *= 0.9; a.roll *= 0.9; a.y = floorAt(a.x, a.z) + 0.03;
        if (a.timer < 0 || fr > 0.2) { a.state = 1; a.timer = 12; if (fr > 0.2) fleeTarget(a, 8); else newTarget(a, g, 0, 0.2, 0.5); }
      } else if (seek(a, a.tx, a.ty, a.tz, a.cruise * (1 + fr * 2.5), 1.2, dt) < 0.8 || a.timer < 0) { a.state = 0; a.timer = 25 + 40 * a.r(); }
    } else if (g.mode === 'patrol' || g.mode === 'glide' || g.mode === 'visit') {
      // sharks patrol low over the reef flat; eagle rays fly mid-water; a manta passes through when it visits
      const lo = g.mode === 'patrol' ? 0.6 : 2, hi = g.mode === 'patrol' ? 3 : 7;
      if (seek(a, a.tx, a.ty, a.tz, a.cruise * (1 + fr), g.mode === 'patrol' ? 0.55 : 0.3, dt) < 4 || a.timer < 0) {
        a.timer = 40; newTarget(a, g, 0, lo, hi);
        // a manta feeds on plankton in the upper water, a few metres down, wherever the floor is
        if (sp === 'manta') a.ty = clamp(tide() - 1.5 - a.r() * 5, floorAt(a.tx, a.tz) + 1.5, tide() - 1.2);
      }
      if (fr > 0.3 && a.state === 0) { fleeTarget(a, 15); a.state = 1; } else if (fr === 0) a.state = 0;
    } else if (g.mode === 'turtle') {
      // turtles: swim, rest on the bottom, rise to breathe at the surface, go back down
      const surf = tide();
      if (a.state === 0) { if (seek(a, a.tx, a.ty, a.tz, a.cruise * (1 + fr * 2), 0.5, dt) < 1 || a.timer < 0) { a.state = a.r() < 0.4 ? 1 : 2; a.timer = a.state === 1 ? 25 + 40 * a.r() : 40; } }
      else if (a.state === 1) { a.speed *= Math.exp(-dt); a.pitch *= 0.95; a.roll *= 0.95; a.y += (floorAt(a.x, a.z) + 0.25 * a.len - a.y) * Math.min(1, dt); move(a, dt); if (a.timer < 0 || fr > 0.3) { a.state = 2; a.timer = 40; } }
      else if (a.state === 2) { a.tx = a.x + Math.cos(a.yaw) * 4; a.tz = a.z - Math.sin(a.yaw) * 4; a.ty = surf + 0.2; if (seek(a, a.tx, a.ty, a.tz, a.cruise, 0.4, dt) < 1 || a.y > surf - 0.25 * a.len) { a.state = 3; a.timer = 4 + 4 * a.r(); } }
      else if (a.state === 3) { a.speed *= Math.exp(-dt * 0.8); a.pitch += (0.15 - a.pitch) * Math.min(1, dt); a.y += (surf - 0.12 * a.len - a.y) * Math.min(1, dt * 2); move(a, dt); a.y = Math.min(a.y, surf - 0.05); if (a.timer < 0) { a.state = 0; a.timer = 50; newTarget(a, g, 0, 0.4, 2); } }
      a.y = Math.min(a.y, surf - 0.05);
    }
  }
  function fleeTarget(a, dist) {
    const dx = a.x - diver.x, dz = a.z - diver.z, d = Math.hypot(dx, dz) + 1e-3;
    a.tx = a.x + dx / d * dist; a.tz = a.z + dz / d * dist; a.ty = Math.max(a.y, floorAt(a.tx, a.tz) + 0.5); a.timer = 6;
  }

  // ---------------------------------------------------------------- per frame
  const counts = {};
  let syncT = 0, mantaGate = 0;
  const mantaShare = PF.manta && PF.manta.share !== undefined ? PF.manta.share : 1 / 3, mantaK = Math.sin(Math.PI * (0.5 - Math.min(Math.max(mantaShare, 0), 1))) - 1e-6;
  function update(dt, t, cam, nightNow, first) {
    T = t; night = nightNow;
    // the diver: the player when there is one, else the camera
    const P = ctx.player && ctx.player.position ? ctx.player.position : cam;
    if (isNaN(diver.px) || first) { diver.px = P.x; diver.py = P.y; diver.pz = P.z; diver.speed = 0; }
    diver.vx = (P.x - diver.px) / dt; diver.vy = (P.y - diver.py) / dt; diver.vz = (P.z - diver.pz) / dt;
    diver.px = P.x; diver.py = P.y; diver.pz = P.z; diver.x = P.x; diver.y = P.y; diver.z = P.z;
    diver.speed += (Math.min(Math.hypot(diver.vx, diver.vy, diver.vz), 6) - diver.speed) * Math.min(1, dt * 4);
    syncT -= dt;
    if (first || syncT < 0) { sync(cam); syncT = 0.5; }
    // a manta is an occasional visitor, in the water a third of each hour (deterministic in the model clock); where
    // mantas gather (profile fauna.manta.share) they stay longer, or all the time
    mantaGate = Math.sin((ctx.clockMs ? ctx.clockMs() : Date.now()) / 3.6e6 * TAU) > mantaK ? 1 : 0;
    for (const id in herds) counts[id] = 0;
    const steps = first ? 30 : 1, h = first ? 0.1 : dt;     // settle the schools before the first frame
    for (let k = 0; k < steps; k++) for (const gs of groups.values()) for (const g of gs) {
      if (g.sp === 'manta' && !mantaGate) continue;
      if (g.kind === 'cloud' || g.kind === 'hover') updateCloud(g, h); else if (g.kind === 'school') updateSchool(g, h); else if (g.kind === 'nest') updateNest(g); else updateSolo(g, h);
    }
    // write the herds
    for (const gs of groups.values()) for (const g of gs) {
      if (g.sp === 'manta' && !mantaGate) continue;
      const H = herds[g.sp], F = FAUNA[g.sp];
      for (const a of g.members) {
        if (a.hidden) continue;
        const i = counts[g.sp]; if (i >= H.cap) break;
        const dx = a.x - cam.x, dz = a.z - cam.z;
        if (dx * dx + dz * dz > R_SIM * R_SIM) continue;
        // tail beat: faster and wider with speed (relative to body length); wing strokes slow and deep
        const rel = a.speed / a.len;
        let amp, freq;
        if (F.mat === 'fish' || F.mat === 'shark') { amp = (F.mat === 'shark' ? 0.06 : 0.09) + 0.08 * Math.min(1, rel / 3); freq = TAU * (F.mat === 'shark' ? 0.5 + 0.4 * Math.min(rel, 2) : 1.2 + 1.2 * Math.min(rel, 5)); }
        else if (g.kind === 'nest') { amp = a.state === 1 ? 0.55 : a.state === 2 ? 0.35 : 0.08; freq = a.state === 1 ? 1.4 : a.state === 2 ? 0.7 : 0.5; }
        else if (TURTLE.has(g.sp)) { amp = a.speed > 0.05 ? 0.7 : 0.15; freq = a.speed > 0.05 ? 2.4 : 0.8; }
        else if (g.sp === 'ribbontail') { amp = a.speed > 0.05 ? 0.06 : 0.01; freq = a.speed > 0.05 ? 7 : 2; }
        else { amp = 0.22; freq = g.sp === 'manta' ? 1.5 : 2.2; }
        const s = F.mat === 'eagle' ? a.len / 0.95 : F.mat === 'manta' ? a.len / 1.27 : F.mat === 'ribbontail' ? a.len / 0.6 : a.len;
        H.put(i, a.x, a.y, a.z, s, a.yaw, a.pitch, a.roll, a.ph, a.c1[0], a.c1[1], a.c1[2], amp, a.c2[0], a.c2[1], a.c2[2], freq);
        counts[g.sp] = i + 1;
      }
    }
    for (const id in herds) herds[id].commit(counts[id]);
  }
  return { group, herds, update, animals, counts, diver, get mantaVisiting() { return !!mantaGate; } };
}
