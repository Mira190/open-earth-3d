// The walk signals' sounds for blind and low-vision walkers, played at the walk-signal heads
// (junctions.js heads.peds) through audio.js's walkCall, fading with distance and panned to where
// they are from the camera. Which sound a city's signals make is its country's (game.signals.sound
// overrides it: false for none, or { kind, hours, range }); docs/GAME.md "Walk signals' calls"
// records the rules and their sources.
//   jp  Japan (the National Police Agency's guideline, 異種鳴き交わし方式): only while the walk is
//       steady green. A crosswalk running north-south plays the chick, "piyo" from its north end
//       and "piyo-piyo" from its south end; one running east-west the cuckoo, "kakko" from its west
//       end and "ka-kakko" from its east end; the two ends answer each other about 1.5 s apart.
//       A scramble (歩車分離, every way at once) plays the four in turn round all its crosswalks,
//       piyo, piyo-piyo, kakko, ka-kakko, 1.5 s apart, and nothing along its diagonals. By the
//       hour: on from 7:00 to 20:00, softer in the hour either side, off through the night.
//   au  Australia: the push-button's slow locator tick on red, the "zap" as the walk comes on and
//       its rapid tick through the green.
//   hk  Hong Kong: slow pips on red, rapid pips on green.
//   nl  the Netherlands' rateltikker: a slow knock on red, a fast rattle on green.
//   The ticking kinds are heard only close to their box, and turned down at night.
'use strict';
window.OEWalkCalls = (function () {
  const KIND = { Japan: 'jp', Australia: 'au', China: 'hk' /* (the one Chinese city is Hong Kong) */, 'Hong Kong': 'hk', Netherlands: 'nl' };
  const NIGHT_DOWN = [[0, 0.5], [6, 0.5], [7, 1], [22, 1], [23, 0.5]];
  const PRESET = {
    jp: { range: 75, ref: 7, hours: [[0, 0], [6, 0], [7, 1], [20, 1], [21, 0]], step: 1.5 },
    au: { range: 22, ref: 2, hours: NIGHT_DOWN, red: ['tick', 1.0], green: ['tick', 0.12], start: 'zap' },
    hk: { range: 22, ref: 2, hours: NIGHT_DOWN, red: ['pip', 0.8], green: ['pip', 0.14] },
    nl: { range: 22, ref: 2, hours: NIGHT_DOWN, red: ['ratel', 1.0], green: ['ratel', 0.1] },
  };
  // a level by the hour from [[hour, level], ...], linear between them
  function byHour(H, h) {
    for (let i = H.length - 1; i >= 0; i--) if (h >= H[i][0]) {
      const [h0, v0] = H[i], [h1, v1] = H[i + 1] || [24, H[0][1]];
      return v0 + (v1 - v0) * (h - h0) / Math.max(1e-6, h1 - h0);
    }
    return H[0][1];
  }
  // junctions: OEJunctions; audio: OEAudio; country: the city's; cfg: game.signals.sound; hour(): the local hour (0..24)
  function create({ junctions, audio, country, cfg, hour = () => 12 }) {
    const kind = cfg === false ? null : (cfg && cfg.kind) || KIND[country] || null;
    const P = kind && PRESET[kind] ? Object.assign({}, PRESET[kind], cfg && typeof cfg === 'object' ? cfg : {}) : null;
    const stats = { kind: P ? kind : null, played: 0, byKind: {}, last: null, sources: 0 };
    if (!P) return { update() {}, prepare() {}, state: () => stats, kind: null };
    let fwd = null, heads = null, near = [], nearAt = -1, nearX = 1e9, nearY = 1e9, T = 0;
    const lastK = new Map(), tickAt = new Map(), wasWalk = new Map();
    // each head's crosswalk (its middle c and the way across u, out from the middle towards the
    // head), and so its call (Japan's) and its turn in a scramble's round. A scramble's head stands
    // by an end of one of its crosswalks (j.walks); another's crosswalk runs from it to the head
    // across the road on the far kerb (the same arm's), or, with none there, across its arm's road.
    function setup() {
      heads = junctions.heads && junctions.heads.peds ? junctions.heads.peds : [];
      const byArm = new Map();
      for (const o of heads) if (!o.scr) { if (!byArm.has(o.a)) byArm.set(o.a, []); byArm.get(o.a).push(o); }
      for (const o of heads) {
        const j = o.a.j;
        let cx, cy, ux, uy;
        if (o.scr && j.walks && j.walks.length) {
          let w = null, bd = Infinity;
          for (const q of j.walks) for (const k of [0, 2]) { const d = Math.hypot(o.x - q[k], o.y - q[k + 1]); if (d < bd) { bd = d; w = q; } }
          const len = Math.hypot(w[2] - w[0], w[3] - w[1]) || 1, vx = (w[2] - w[0]) / len, vy = (w[3] - w[1]) / len;
          cx = (w[0] + w[2]) / 2; cy = (w[1] + w[3]) / 2;
          // (a diagonal runs through the middle of the box, within 6 m of it, not along its side: silent)
          const t = Math.max(0, Math.min(1, ((j.x - w[0]) * vx + (j.y - w[1]) * vy) / len));
          o.diag = Math.hypot(w[0] + vx * len * t - j.x, w[1] + vy * len * t - j.y) < 6;
        } else {
          const other = (byArm.get(o.a) || []).find(q => q !== o && Math.hypot(q.x - o.x, q.y - o.y) > 2);
          if (other) { cx = (o.x + other.x) / 2; cy = (o.y + other.y) / 2; }
          else { const rx = Math.sin(o.a.out), ry = Math.cos(o.a.out), ax = o.a.x != null ? o.a.x : j.x, ay = o.a.y != null ? o.a.y : j.y, t = (o.x - ax) * rx + (o.y - ay) * ry; cx = ax + rx * t; cy = ay + ry * t; }
          o.diag = false;
        }
        const d = Math.hypot(o.x - cx, o.y - cy) || 1;
        ux = (o.x - cx) / d; uy = (o.y - cy) / d;
        const ns = Math.abs(uy) >= Math.abs(ux), first = ns ? uy > 0 : ux < 0; // (its north end, or its west end)
        o.call = ns ? (first ? 'piyo' : 'piyopiyo') : (first ? 'kakko' : 'kakakko');
        o.turn = (ns ? 0 : 2) + (first ? 0 : 1); // (in a scramble's round)
      }
      stats.sources = heads.filter(o => !o.diag).length;
    }
    function play(call, o, ex, ey, ez, rx, ry, k) {
      const d = Math.hypot(o.x - ex, o.y - ey, (o.z + 3.3) - ez); // (the speaker 3.3 m up, as the guideline has it)
      const fade = Math.max(0, Math.min(1, (P.range - d) / (0.35 * P.range)));
      const level = Math.min(1, P.ref / Math.max(1, d)) * fade * k;
      if (level <= 0.003) return;
      const pan = ((o.x - ex) * rx + (o.y - ey) * ry) / Math.max(1, Math.hypot(o.x - ex, o.y - ey));
      if (audio && audio.walkCall && audio.walkCall(call, level, pan * 0.8)) {
        stats.played++; stats.byKind[call] = (stats.byKind[call] || 0) + 1;
        stats.last = { call, level: +level.toFixed(3), d: +d.toFixed(1), t: +T.toFixed(2), j: o.a.j.id, scramble: !!o.a.j.scramble };
        if (api.tap) api.tap(call, o, level); // (tools/walkcalls_step.js listens)
      }
    }
    // dt: seconds; eye: the camera (heard from it, so a film hears what it sees)
    function update(dt, eye) {
      T += dt;
      if (!heads) setup();
      if (!heads.length || !eye || (audio && audio.muted)) return;
      const k = byHour(P.hours, hour());
      if (k <= 0.003) return;
      const ex = eye.position.x, ey = -eye.position.z, ez = eye.position.y;
      if (T - nearAt > 0.5 || Math.hypot(ex - nearX, ey - nearY) > 15) { // (the heads within hearing, twice a second)
        nearAt = T; nearX = ex; nearY = ey;
        const R = P.range + 20;
        near = heads.filter(o => !o.diag && Math.abs(o.x - ex) < R && Math.abs(o.y - ey) < R);
      }
      if (!near.length) return;
      if (!fwd && window.THREE) fwd = new window.THREE.Vector3();
      const f = fwd && eye.getWorldDirection ? eye.getWorldDirection(fwd) : null, fx = f ? f.x : 0, fy = f ? -f.z : 1, fl = Math.hypot(fx, fy) || 1;
      const rx = fy / fl, ry = -fx / fl; // (the camera's right, in plan)
      if (P.step) { // Japan's calls, by its junction's walk clock (j.t: the walk's seconds)
        for (const o of near) {
          const j = o.a.j;
          if (!junctions.walk(o.a) || j.st !== 'g') { lastK.delete(o); continue; }
          const n = Math.floor(j.t / P.step), mine = j.scramble ? n % 4 === o.turn : n % 2 === (o.turn & 1);
          const was = lastK.get(o);
          lastK.set(o, n);
          if (!mine || was === n) continue;
          play(o.call, o, ex, ey, ez, rx, ry, k);
        }
        return;
      }
      // the ticking kinds: the nearest two boxes only (each heard within a few metres of it)
      const two = near.map(o => [o, Math.hypot(o.x - ex, o.y - ey)]).filter(q => q[1] < P.range).sort((a, b) => a[1] - b[1]).slice(0, 2);
      for (const [o] of two) {
        const w = junctions.walk(o.a) && o.a.j.st === 'g', [call, every] = w ? P.green : P.red, prev = wasWalk.get(o), at = tickAt.get(o);
        wasWalk.set(o, w);
        if (w && P.start && prev === false) play(P.start, o, ex, ey, ez, rx, ry, k);
        if (at == null || T - at >= every || (prev != null && prev !== w)) { tickAt.set(o, T + (w && P.start && prev === false ? 0.3 : 0)); play(call, o, ex, ey, ez, rx, ry, k); }
      }
    }
    const api = { update, prepare: () => { if (!heads) setup(); }, state: () => stats, kind, preset: P, level: () => byHour(P.hours, hour()), tap: null };
    return api;
  }
  return { create, KIND, PRESET };
})();
