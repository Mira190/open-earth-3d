// Fishing from the shore (docs/FISHING.md). Not in index.html: game.js fetches this file and the
// city's web/data/<id>/fishing.json the first time you come within reach of a spot, so a city
// without fishing, and a visit that never goes near the water, pays nothing for it.
//
// One button does the fishing (Space, or the Jump button on a phone): hold and let go to cast,
// press when the float goes under, hold to wind and let go when the fish runs. What takes the
// bait is the water's own fish for the month, the light, the rain, the rig and how far out you
// cast, sized from each species' usual range and measured against its legal length. Every fish
// goes back; what you keep is a log.
//
// The file has two halves. `core` is the rules, with no three.js and no DOM, so
// tools/fishing_sim.js can play ten thousand fights in Node to tune them. `create` is what you
// see: five draw calls and no texture while a line is out, nothing while you are away.
'use strict';
window.OEFishing = (function () {
  const VERSION = 1;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const CAST = [7, 27];            // m: the nearest and furthest a cast lands (pipeline/fishing.py places the schools in it)
  const SWEET = [0.55, 0.85];      // the band of tension that tires a fish fastest
  const STEP = 1 / 30;             // the fight runs in fixed steps, whatever the frame rate

  // ------------------------------------------------------------ core: the rules
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  // the light a fish feeds by, from the sun's height and the side of noon
  const lightOf = (alt, min) => (alt < -6 ? 'night' : alt < 8 ? (min < 720 ? 'dawn' : 'dusk') : 'day');
  // how likely each species is to be the one that takes: out[i] for data.species[i]; returns their sum.
  // env: { month 1-12, light, rain 0-1, rig, cast 0-1 (how far out), school 0-1 (how near a school) }
  function weights(data, spot, env, out) {
    let sum = 0;
    for (let i = 0; i < data.species.length; i++) {
      const s = data.species[i], w = s.when, share = s.share || 1;
      if (spot.only && spot.only.indexOf(s.id) < 0) { out[i] = 0; continue; }   // (fish that never come to this spot: the fiord's cod at the river's mouth)
      let v = share * w.months[env.month - 1] * (w.light[env.light] == null ? 1 : w.light[env.light]);
      if (env.rain > 0.1 && w.rain) v *= w.rain;
      v *= s.rigs[env.rig] == null ? 0.03 : s.rigs[env.rig];
      const depth = w.close_months && w.close_months.indexOf(env.month) >= 0 ? 'any' : s.depth;
      v *= depth === 'edge' ? 1.4 - 1.1 * env.cast : depth === 'deep' ? 0.25 + 1.35 * env.cast : 1;
      if (spot.species && spot.species.indexOf(s.id) >= 0) v *= 1.6;      // what this spot is known for
      v *= 1 + env.school * (0.4 + 0.6 * (1 - share));                    // a school lifts the scarcer fish most
      out[i] = v; sum += v;
    }
    return sum;
  }
  const normOf = data => data.species.reduce((a, s) => a + (s.share || 1), 0) * 0.55; // a good hour's sum, for the wait
  // one cast's outcome, decided as the lure lands: which fish, how long, and how it will take
  function plan(data, spot, env, rnd, assist, first, out) {
    const P = plan.w || (plan.w = new Float32Array(32));
    const sum = weights(data, spot, env, P);
    let u = rnd() * sum, i = 0;
    for (; i < data.species.length - 1; i++) { u -= P[i]; if (u <= 0) break; }
    const s = data.species[i], z = (rnd() + rnd() + rnd() - 1.5) * 1.15;    // about a unit normal
    let cm = s.cm[1] * Math.exp(0.2 * z) * (1 + 0.05 * env.school);
    if (rnd() < 0.04) cm = s.cm[1] + (s.cm[2] - s.cm[1]) * Math.pow(rnd(), 1.5);   // now and then, a big one
    cm = Math.round(clamp(cm, s.cm[0], s.cm[2]) * 10) / 10;
    const act = clamp(sum / normOf(data), 0.4, 1.5);
    out = out || {};
    out.i = i; out.s = s; out.cm = cm; out.g = Math.round((s.g_per_cm3 || 0.011) * cm * cm * cm);
    out.wait = first ? 3.5 : clamp(8.5 / act * (1.25 - 0.6 * env.school) * (0.6 + 0.8 * rnd()), 3.5, 20);
    out.nibbles = first ? 1 : Math.min(3, Math.floor((s.nibbles || 0) * (0.5 + rnd()) + rnd() * 0.6));
    out.window = (s.bite || 1) * (1 + 0.5 * assist) * (first ? 2 : 1);
    return out;
  }
  // a hooked fish. cm sets how much of the species' strength it has; line: how far out it took
  function fight(s, cm, line, assist, f) {
    f = f || {};
    const size = 0.75 + 0.5 * (cm - s.cm[0]) / (s.cm[2] - s.cm[0]);
    f.s = s; f.assist = assist;
    f.pull = clamp(s.fight.pull * size * (1 - 0.18 * assist), 0.05, 1.2);
    f.E0 = f.E = s.fight.stamina * size;
    f.runs = s.fight.runs;
    f.d = line; f.max = line + 16; f.T = 0.3; f.phase = 'rest'; f.left = 1.2; f.over = 0; f.t = 0; f.sweet = 0; f.ran = false; f.event = '';
    return f;
  }
  // one fixed step of the fight; reel: the button is held. Returns '' or how it ended.
  function fightStep(f, dt, reel, rnd) {
    f.t += dt; f.event = '';
    const tired = f.E <= 0, P = tired ? f.pull * 0.3 : f.pull;
    // the fish's turns: rest, a warning, a run
    f.left -= dt;
    if (f.left <= 0) {
      if (f.phase === 'rest' && !tired) { f.phase = 'warn'; f.left = 0.45 + 0.2 * f.assist; f.event = 'warn'; }
      else if (f.phase === 'warn') { f.phase = 'run'; f.left = (1.0 + 1.2 * rnd()) * (0.5 + 0.5 * Math.max(0, f.E) / f.E0); f.event = 'run'; f.ran = true; }
      else { f.phase = 'rest'; f.left = (1.6 + 1.8 * rnd()) / Math.max(0.4, f.runs) + 0.4 * f.assist; f.event = f.phase; }
    }
    const run = f.phase === 'run';
    // a run takes line whatever you do (less against a held reel); a rest gives it back to whoever winds
    if (reel) {
      f.T += ((run ? 0.7 + 1.1 * P : 0.42 + 0.25 * P) - f.T) * Math.min(1, (run ? 4 : 3.2) * (1 - 0.2 * f.assist) * dt);
      f.d += run ? (1 + 3 * P) * 0.6 * dt : -2.6 * (1 - 0.3 * P) * dt;
      const inBand = f.T >= SWEET[0] && f.T <= SWEET[1];
      f.E -= dt * (run ? 1.3 : 0.6 + (inBand ? 1.4 : 0.42));
      if (inBand) f.sweet += dt;
    } else {
      f.T += ((run ? 0.3 + 0.3 * P : 0.12) - f.T) * Math.min(1, 4 * dt);
      f.d += (run ? 1 + 3 * P : 0.15 * P) * dt;
      if (run) f.E -= dt;
    }
    if (f.t > 40) f.E = Math.min(f.E, 0);           // nobody's wrist should pay for a fish (the fight has an end)
    if (f.T > 1) { f.over += dt; if (f.over > 0.7 + 0.3 * f.assist) return 'snap'; } else f.over = Math.max(0, f.over - 2 * dt);
    if (f.d > f.max) return 'spooled';
    if (f.d <= 1.2) return 'landed';
    return '';
  }
  // the help a player gets follows how they are doing: two fish lost in a row and the next one is
  // kinder; four landed and it eases back. save: { assist, lost, won }
  function learn(save, landed) {
    if (landed) { save.lost = 0; if (++save.won >= 4 && save.assist > 0) { save.assist--; save.won = 0; } }
    else { save.won = 0; if (++save.lost >= 2 && save.assist < 2) { save.assist++; save.lost = 0; } }
  }
  // is this fish one the law lets you keep? '' when it is, or why not
  function legal(s, cm) {
    const L = s.legal || {};
    if (L.closed) return L.closed;     // (a species closed to taking in this water, at any size: Milford Sound's blue cod)
    if (L.min_cm && cm < L.min_cm) return `Under the ${L.min_cm} cm legal length`;
    if (L.max_cm && cm > L.max_cm) return `Over the ${L.max_cm} cm limit`;
    return '';
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "Nov to Mar": the run of months a species is at its best
  function season(s) {
    const m = s.when.months, good = m.map(v => v >= 0.9);
    if (good.every(Boolean)) return 'all year';
    let a = good.findIndex((g, i) => g && !good[(i + 11) % 12]);
    if (a < 0) return 'all year';
    let b = a; while (good[(b + 1) % 12] && (b + 1) % 12 !== a) b = (b + 1) % 12;
    return a === b ? MONTHS[a] : `${MONTHS[a]} to ${MONTHS[b]}`;
  }
  const bestLight = s => Object.entries(s.when.light).sort((a, b) => b[1] - a[1]).filter((e, i, all) => e[1] >= all[0][1] - 0.05).map(e => e[0]).join(' and ');
  const core = { VERSION, CAST, SWEET, STEP, rng, lightOf, weights, plan, fight, fightStep, learn, legal, season, bestLight };

  // ------------------------------------------------------------ what you see
  const CSS = `
.g-fish { position: absolute; left: 50%; bottom: 168px; transform: translateX(-50%); width: min(340px, calc(100% - 32px)); display: grid; gap: 7px; padding: 10px 12px 11px;
  background: var(--hud-solid); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); border: 1px solid var(--line); border-radius: var(--r, 10px); color: var(--ink); font: 400 12px/1.35 var(--f-body); pointer-events: auto; }
.g-fish[hidden], .g-fishcard[hidden] { display: none; }
.gf-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.gf-top b { font: 500 11px/1.2 var(--f-display); letter-spacing: 0.1em; text-transform: uppercase; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gf-top span { font: 400 10px/1.2 var(--f-mono); color: var(--muted); white-space: nowrap; }
.gf-meter { position: relative; height: 8px; border-radius: 4px; background: rgba(236, 232, 225, 0.1); overflow: hidden; }
.gf-meter i { position: absolute; top: 0; bottom: 0; left: 0; }
.gf-band { background: rgba(99, 211, 154, 0.3); }
.gf-fill { width: 100%; transform-origin: 0 50%; transform: scaleX(0); background: var(--accent); will-change: transform; }
.g-fish.hot .gf-fill { background: var(--critical); }
.g-fish.good .gf-fill { background: var(--good); }
.gf-far { display: flex; justify-content: space-between; font: 400 10px/1 var(--f-mono); color: var(--muted); }
.gf-hint { min-height: 16px; color: var(--ink-2); }
.gf-hint b { color: #fff; font-weight: 600; } .g-fish.strike .gf-hint b { color: var(--accent); }
.gf-hint kbd { font-size: 9px; padding: 1px 4px; margin: 0 1px; }
.gf-btns { display: flex; gap: 6px; }
.gf-btns button { flex: 1; min-height: 30px; padding: 4px 8px; background: transparent; color: var(--ink-2); border: 1px solid var(--line); border-radius: 6px; font: 400 11px/1.2 var(--f-body); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gf-btns button:hover, .gf-btns button:focus-visible { border-color: var(--line-2); color: #fff; }
.gf-btns button kbd { font-size: 9px; padding: 1px 4px; margin-right: 5px; }
.g-fishcard { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%) translateX(min(27vw, 350px)); width: min(300px, calc(100% - 32px)); padding: 16px 18px; display: grid; gap: 6px;
  background: var(--hud-solid); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); border: 1px solid rgba(255, 176, 102, 0.5); border-radius: var(--r, 10px); color: var(--ink-2); font: 400 12px/1.45 var(--f-body); }
.g-fishcard h3 { margin: 0; font: 300 18px/1.2 var(--f-display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.g-fishcard em { font: italic 400 11px/1.2 var(--f-body); color: var(--muted); }
.g-fishcard .size { font: 400 20px/1.2 var(--f-mono); color: #fff; } .g-fishcard .size small { font-size: 11px; color: var(--muted); margin-left: 8px; }
.g-fishcard .tag { justify-self: start; padding: 2px 7px; border-radius: 4px; font: 500 10px/1.5 var(--f-mono); letter-spacing: 0.04em; background: var(--accent-wash); color: var(--accent-2); }
.g-fishcard .rule { color: var(--ink); } .g-fishcard p { margin: 0; }
.g-fishlog .g-panel { width: min(620px, 100%); max-height: 100%; overflow: auto; }
.gfl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin: 12px 0; align-items: start; }
.gfl-item { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; display: grid; gap: 3px; font: 400 12px/1.4 var(--f-body); color: var(--ink-2); }
.gfl-item b { color: #fff; font-weight: 600; } .gfl-item em { color: var(--muted); font-size: 11px; } .gfl-item.no { opacity: 0.55; }
.gfl-item .n { font: 400 11px/1.3 var(--f-mono); color: var(--accent-2); }
.gfl-rules { font: 400 11px/1.5 var(--f-body); color: var(--muted); display: grid; gap: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
.g-fishcard .go { display: none; min-height: 36px; margin-top: 4px; background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 6px; font: 500 12px/1 var(--f-body); }
@media (max-width: 720px), (pointer: coarse) {
  .g-fish { bottom: 236px; } .g-fishcard { top: auto; bottom: 236px; transform: translateX(-50%); width: min(340px, calc(100% - 32px)); pointer-events: auto; } .g-fishcard .go { display: block; }
  .game-stage.fish-show .g-fish { display: none; } .game-stage.fish-show :is(.g-quest, .g-right, .g-prompt) { opacity: 0; visibility: hidden; }   /* the catch has the screen: the fish above, its card below */
}
@media (prefers-reduced-motion: reduce) { .gf-fill { transition: none; } }`;

  // ctx (game.js fishLoad): { THREE, world, nav, player, cam, camera, H, A, data, cityId, clock, sun(), rain(), tier, reduced, touch, stage, key(code), time(), walkTo(x, y, label, then), ui() }
  function create(ctx) {
    const { THREE, world, nav, player, cam, H, A, data, clock } = ctx;
    const low = ctx.tier === 'low';
    let rnd = Math.random;
    // ---------------------------------------------------------- what is remembered (localStorage, about 1 KB)
    const KEY = 'oe3d-fishing';
    let save = { v: 1, assist: 0, lost: 0, won: 0, casts: 0, rig: {}, log: {} };
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) save = Object.assign(save, s); } catch (e) { /* storage blocked */ }
    const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage blocked */ } };
    const log = () => save.log[ctx.cityId] || (save.log[ctx.cityId] = {});
    const caught = () => Object.keys(log()).length;
    const total = () => Object.values(log()).reduce((a, e) => a + e.n, 0);
    const rigOpen = r => !r.unlock || caught() >= (r.unlock.species || 0);
    const rigNow = () => data.rigs.find(r => r.id === save.rig[ctx.cityId] && rigOpen(r)) || data.rigs[0];

    // ---------------------------------------------------------- the session's state: one object, reused
    const S = { st: 'off', spot: null, t: 0, aim: 0, power: 0, dir: 1, held: false, was: false, x: 0, y: 0, line: 0, cast01: 0, school: 0,
      wait: 0, nib: 0, nibT: 0, dip: 0, acc: 0, tall: false, rodPitch: 0.9, bend: 0, reelTick: 0, warned: 0, fx: 0, fy: 0, fh: 0, hintKey: '', meter: -1, far: -1, cls: '' };
    const P = {}, F = {};        // the cast's plan and the fight (core.plan, core.fight), reused
    const seen = {};             // the spots introduced in this visit
    const zoneOf = spot => data.rules.zones.find(z => z.id === spot.zone) || data.rules.zones[0];

    // ---------------------------------------------------------- the things drawn: made on the first cast, freed when you leave
    let gear = null, rings = null, hud = null, ringAt = 0, riseT = 2;
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion();
    const hold = new THREE.Vector3(), tip = new THREE.Vector3(), base = new THREE.Vector3(), col = new THREE.Color();
    const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
    const toW = (out, x, y, z) => out.set(x, z, -y);
    // optional hooks (the reef viewer's): the water's height (a tide, a lake's level; 0 in the cities), and where fishing
    // is closed (a marine reserve: '' where it is open, else why not)
    const water = () => (ctx.water ? ctx.water() : 0);
    const closed = (x, y) => (ctx.closed ? ctx.closed(x, y) : '');
    const ROD = 2.6, LINE_N = 12, RINGS = low ? 5 : 8;
    const VIEW = -0.5, SHOW = 1.35;   // the chase camera's turn off the cast's heading: over the right shoulder with a line out, side-on for the catch

    function makeRings() {
      const g = new THREE.RingGeometry(0.86, 1, low ? 20 : 32); g.rotateX(-Math.PI / 2);
      const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), RINGS);
      m.frustumCulled = false; m.renderOrder = 3; m.userData.t = new Float32Array(RINGS).fill(9); m.userData.at = new Float32Array(RINGS * 3); // each ring: its age; x, y, how wide it grows
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < RINGS; i++) { m.setMatrixAt(i, m4.makeScale(0, 0, 0)); m.setColorAt(i, col.setRGB(0, 0, 0)); }
      world.add(m);
      return m;
    }
    function ring(x, y, size) {
      if (!rings) rings = makeRings();
      const i = ringAt = (ringAt + 1) % RINGS;
      rings.userData.t[i] = 0; rings.userData.at.set([x, y, size], i * 3);
    }
    function ringsStep(dt) {
      if (!rings) return;
      const T = rings.userData.t, at = rings.userData.at, night = ctx.sun() && ctx.sun().altitude < -2 ? 0.35 : 1;
      let live = false;
      for (let i = 0; i < RINGS; i++) {
        if (T[i] > 2.4) continue;
        T[i] += dt; live = true;
        const k = T[i] / 2.4, r = at[i * 3 + 2] * (0.15 + 0.85 * Math.sqrt(k)), a = T[i] > 2.4 ? 0 : 0.34 * (1 - k) * (1 - k) * night;
        m4.makeScale(r, 1, r).setPosition(at[i * 3], water() + 0.06, -at[i * 3 + 1]);
        rings.setMatrixAt(i, m4); rings.setColorAt(i, col.setRGB(a, a, a));
      }
      rings.visible = live;
      if (live) { rings.instanceMatrix.needsUpdate = true; rings.instanceColor.needsUpdate = true; }
    }

    function makeGear() {
      const U = THREE.BufferGeometryUtils, parts = [];
      const paint = (g, hex) => { g = g.index ? g.toNonIndexed() : g; const c = lin(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); parts.push(g); };
      const blank = new THREE.CylinderGeometry(0.005, 0.014, ROD, 6, 12); blank.translate(0, ROD / 2, 0); paint(blank, '#1d2326');
      const grip = new THREE.CylinderGeometry(0.019, 0.02, 0.36, 8, 1); grip.translate(0, 0.05, 0); paint(grip, '#8a6a44');
      const reel = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12, 1); reel.rotateZ(Math.PI / 2); reel.translate(0, 0.2, 0.045); paint(reel, '#b9bec2');
      const rodGeo = U.mergeGeometries(parts, false);
      const bend = { value: 0 };
      const rodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
      // the blank bends towards the fish: more the further up it (a parabola, in the rod's own +z)
      rodMat.onBeforeCompile = sh => { sh.uniforms.uBend = bend; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBend;').replace('#include <begin_vertex>', `#include <begin_vertex>\n  { float k = clamp(position.y / ${ROD.toFixed(2)}, 0.0, 1.0); transformed.z += uBend * k * k; transformed.y -= 0.35 * abs(uBend) * k * k; }`); };
      const rod = new THREE.Mesh(rodGeo, rodMat); rod.castShadow = !low; rod.frustumCulled = false;
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xf4f7f8, transparent: true, opacity: 0.8 })); line.frustumCulled = false;
      parts.length = 0;
      const top = new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); top.scale(1, 1.6, 1); paint(top, '#e0432a');
      const bot = new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); bot.scale(1, 1.6, 1); paint(bot, '#f3f1ea');
      const stem = new THREE.CylinderGeometry(0.007, 0.007, 0.22, 5, 1); stem.translate(0, 0.17, 0); paint(stem, '#e0432a');
      const floatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0 });
      floatMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;'); };
      const float = new THREE.Mesh(U.mergeGeometries(parts, false), floatMat); float.frustumCulled = false; float.visible = false;
      const fish = makeFish();
      world.add(rod, line, float, fish.mesh);
      return { rod, bend, line, float, fish, rodMat, floatMat };
    }
    // one fish, hanging head up: +y nose, +z back, x across. Recoloured and rescaled for each catch, never rebuilt
    function makeFish() {
      const NT = 14, NA = 8, pos = [], tt = [], ca = [];
      const prof = t => Math.pow(Math.sin(Math.PI * Math.pow(clamp(1.02 - t, 0, 1), 0.72)), 0.85) * (t < 0.12 ? 0.35 + 5.4 * t : 1); // t: 0 at the tail's wrist, 1 at the nose
      const vert = (t, a) => { const r = prof(t) * 0.5; pos.push(Math.sin(a) * r, t - 0.5, Math.cos(a) * r); tt.push(t); ca.push(Math.cos(a)); };
      for (let i = 0; i < NT; i++) for (let k = 0; k < NA; k++) {
        const t0 = 0.08 + 0.92 * i / NT, t1 = 0.08 + 0.92 * (i + 1) / NT, a0 = k / NA * Math.PI * 2, a1 = (k + 1) / NA * Math.PI * 2;
        vert(t0, a0); vert(t1, a0); vert(t1, a1); vert(t0, a0); vert(t1, a1); vert(t0, a1);
      }
      const fin = (pts, t) => { for (const p of pts) { pos.push(...p); tt.push(t); ca.push(9); } for (const p of pts.slice().reverse()) { pos.push(...p); tt.push(t); ca.push(9); } };
      fin([[0, -0.42, 0], [0, -0.56, 0.3], [0, -0.47, 0.02]], 0); fin([[0, -0.42, 0], [0, -0.47, -0.02], [0, -0.56, -0.3]], 0);   // the tail's two lobes
      fin([[0, 0.12, 0.42], [0, -0.14, 0.44], [0, -0.1, 0.72]], 0.5);                                                         // the dorsal fin
      fin([[0, 0.14, -0.4], [0, 0.0, -0.4], [0, 0.02, -0.62]], 0.5);                                                          // a pelvic fin
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
      mesh.visible = false; mesh.castShadow = !low; mesh.frustumCulled = false;
      const cs = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
      function dress(s, cm) {
        const L = s.look || {}, c = g.attributes.color, [back, flank, belly, finC, stripe, spots] = cs;
        back.set(L.back || '#56666a').convertSRGBToLinear(); flank.set(L.flank || '#b9c2c0').convertSRGBToLinear(); belly.set(L.belly || '#eeeeea').convertSRGBToLinear();
        finC.set(L.fin || L.back || '#56666a').convertSRGBToLinear(); if (L.stripe) stripe.set(L.stripe).convertSRGBToLinear(); if (L.spots) spots.set(L.spots).convertSRGBToLinear();
        for (let i = 0; i < c.count; i++) {
          const a = ca[i], t = tt[i];
          if (a > 1) { c.setXYZ(i, finC.r, finC.g, finC.b); continue; }
          if (a > 0.3) col.copy(flank).lerp(back, clamp((a - 0.3) / 0.4, 0, 1)); else col.copy(belly).lerp(flank, clamp((a + 0.75) / 0.6, 0, 1));
          if (L.stripe && Math.abs(a - 0.05) < 0.3 && t > 0.15 && t < 0.9) col.lerp(stripe, 0.75);
          if (L.bars && a > -0.4 && Math.sin(t * L.bars * Math.PI) > 0.35) col.multiplyScalar(0.62);
          if (L.spots && a > -0.2 && ((i * 2654435761) >>> 0) % 7 === 0) col.lerp(spots, 0.7);   // a scatter of spots, the same on every fish of the kind
          c.setXYZ(i, col.r, col.g, col.b);
        }
        c.needsUpdate = true;
        const len = cm / 100, deep = (L.deep || 0.27) * len;
        mesh.scale.set(L.flat ? deep * 1.7 : deep * 0.5, len, L.flat ? deep * 0.55 : deep);
      }
      return { mesh, dress };
    }
    function freeGear() {
      for (const o of gear ? [gear.rod, gear.line, gear.float, gear.fish.mesh] : []) { world.remove(o); o.geometry.dispose(); o.material.dispose(); }
      if (rings) { world.remove(rings); rings.geometry.dispose(); rings.material.dispose(); if (rings.dispose) rings.dispose(); }
      gear = rings = null;
      if (player.rig) player.rig.hold = null;
    }

    // ---------------------------------------------------------- the panel (DOM made on the first session; written to only when a value changes)
    const kbd = (k, word) => (ctx.touch ? `<b>${word}</b>` : `<kbd>${k}</kbd>`);
    function makeHud() {
      if (!document.getElementById('g-fish-css')) { const st = document.createElement('style'); st.id = 'g-fish-css'; st.textContent = CSS; document.head.appendChild(st); }
      const el = document.createElement('div'); el.className = 'g-fish'; el.id = 'g-fish'; el.hidden = true;
      el.innerHTML = '<div class="gf-top"><b id="gf-spot"></b><span id="gf-cond"></span></div><div class="gf-meter" role="meter" aria-label="Line tension" aria-valuemin="0" aria-valuemax="100"><i class="gf-band"></i><i class="gf-fill"></i></div>'
        + '<div class="gf-far"><span id="gf-far"></span><span id="gf-rig"></span></div><div class="gf-hint" id="gf-hint" aria-live="polite"></div>'
        + `<div class="gf-btns"><button id="gf-rigb">${ctx.touch ? '' : '<kbd>1-3</kbd>'}Rig</button><button id="gf-logb">${ctx.touch ? '' : '<kbd>J</kbd>'}Log</button><button id="gf-leave">Pack up</button></div>`;
      const card = document.createElement('div'); card.className = 'g-fishcard'; card.id = 'g-fishcard'; card.hidden = true; card.setAttribute('role', 'status');
      const book = document.createElement('div'); book.className = 'g-overlay g-fishlog'; book.id = 'g-fishlog'; book.hidden = true;
      ctx.stage.append(el, card, book);
      const $ = s => el.querySelector(s);
      $('#gf-rigb').addEventListener('click', () => nextRig());
      $('#gf-logb').addEventListener('click', () => showLog(true));
      $('#gf-leave').addEventListener('click', () => { if (S.st === 'card') release(); else stop(); });
      book.addEventListener('click', e => { if (e.target === book || e.target.closest('[data-close]')) showLog(false); });
      card.addEventListener('click', e => { if (e.target.closest('[data-go]')) release(); });
      return { el, card, book, fill: $('.gf-fill'), band: $('.gf-band'), meter: $('.gf-meter'), spot: $('#gf-spot'), cond: $('#gf-cond'), far: $('#gf-far'), rig: $('#gf-rig'), hint: $('#gf-hint'), leave: $('#gf-leave'), btns: $('.gf-btns') };
    }
    function setMeter(v, cls) {
      v = clamp(v, 0, 1);
      if (Math.abs(v - S.meter) > 0.004) { S.meter = v; hud.fill.style.transform = `scaleX(${v.toFixed(3)})`; hud.meter.setAttribute('aria-valuenow', String(Math.round(v * 100))); }
      if (cls !== S.cls) { S.cls = cls; hud.el.className = `g-fish ${cls}`; }
    }
    function setHint(key, html) { if (key !== S.hintKey) { S.hintKey = key; hud.hint.innerHTML = html; } }
    function setFar(m) { const r = Math.round(m); if (r !== S.far) { S.far = r; hud.far.textContent = r < 0 ? '' : `${r} m of line`; } }
    function band(a, b) { hud.band.style.left = `${a * 100}%`; hud.band.style.width = `${(b - a) * 100}%`; }
    const env = { month: 1, light: 'day', rain: 0, rig: '', cast: 0, school: 0 };
    function readEnv() {
      const sun = ctx.sun();
      env.month = clock.m; env.light = lightOf(sun ? sun.altitude : 30, clock.min); env.rain = ctx.rain(); env.rig = rigNow().id; env.cast = S.cast01; env.school = S.school;
      return env;
    }
    function conditions() {
      readEnv();
      hud.spot.textContent = S.spot.name;
      hud.cond.textContent = `${MONTHS[env.month - 1]} · ${env.light}${env.rain > 0.1 ? ' · rain' : ''}`;
      hud.rig.textContent = rigNow().name;
    }
    function nextRig(to) {
      if (S.st !== 'aim') return;
      const open = data.rigs.filter(rigOpen), next = to != null ? data.rigs[to] : open[(open.indexOf(rigNow()) + 1) % open.length];
      if (!next) return;
      if (!rigOpen(next)) { H.toast(`<b>${next.name}</b><span>Log ${next.unlock.species} kinds of fish here and it is yours to try.</span>`); return; }
      save.rig[ctx.cityId] = next.id; keep(); conditions(); S.hintKey = '';
      if (open.length < 2) H.toast(`<b>${next.name}</b><span>The only rig in the bag so far. Log more kinds of fish for the others.</span>`);
      else H.toast(`<b>${next.name}</b><span>${next.hint}</span>`);
    }
    function showLog(on) {
      if (!hud) hud = makeHud();
      hud.book.hidden = !on;
      if (!on) return;
      const L = log(), items = data.species.map(s => {
        const e = L[s.id];
        if (!e) return `<div class="gfl-item no"><b>Not yet caught</b><em>${s.depth === 'deep' ? 'Further out' : s.depth === 'edge' ? 'Close in' : 'Anywhere in a cast'}</em></div>`;
        const lg = s.legal || {}, law = [lg.min_cm ? `legal at ${lg.min_cm} cm` : '', lg.max_cm ? `back over ${lg.max_cm} cm` : '', lg.bag_note || (lg.bag ? `${lg.bag} a day` : '')].filter(Boolean).join(' · ');
        return `<div class="gfl-item"><b>${s.name}</b><em>${s.sci}</em><span class="n">${e.n} caught · best ${e.best} cm</span><span>${s.note}</span>`
          + (e.n >= 2 ? `<span>Best ${season(s)}, at ${bestLight(s)}.</span>` : '<span>Catch another to learn when it bites best.</span>') + (law ? `<em>${law}</em>` : '') + '</div>';
      }).join('');
      hud.book.innerHTML = `<div class="g-panel"><header><h2>${data.water}: the log</h2><button class="x" data-close aria-label="Close the log">×</button></header>`
        + `<p class="note">${caught()} of ${data.species.length} kinds caught. ${data.rules.release}</p><div class="gfl-grid">${items}</div><div class="gfl-rules"><span>${data.rules.licence}</span>`
        + data.rules.zones.map(z => `<span>${z.advice}</span>`).join('') + '</div></div>';
    }

    // ---------------------------------------------------------- the session
    const heading = () => S.spot.h + S.aim;
    const inReach = (sp, x, y) => Math.hypot(sp.at[0] - x, sp.at[1] - y) < 14;
    const spotNear = () => (player.mode === 'foot' ? data.spots.find(sp => inReach(sp, player.x, player.y) && Math.abs((sp.z || 0) - player.z) < 6) : null);
    // from where you stand, along the spot's heading: the last step that is ground before the water, or null
    function edge(sp) {
      const sx = Math.sin(sp.h), sy = Math.cos(sp.h);
      let last = [player.x, player.y], at = 0;
      for (let d = 0.25; d <= 16; d += 0.25) {
        const x = player.x + sx * d, y = player.y + sy * d;
        if (nav.isWater(x, y)) return d - at > 8 ? null : { x: last[0] - sx * 0.4 * Math.min(1, at), y: last[1] - sy * 0.4 * Math.min(1, at) }; // (a wall or a drop between: fish over it, if the water is within a rod and a bit)
        if (d - at < 0.3 && nav.walk(x, y, player.z).ok) { last = [x, y]; at = d; }
      }
      return null;
    }
    function start(sp) {
      sp = sp || spotNear();
      if (!sp || S.st !== 'off') return false;
      const no = closed(player.x, player.y);
      if (no) { H.toast(`<b>No fishing here</b><span>${no}</span>`); return false; }
      const e = edge(sp);
      if (!e) { H.toast('Walk down to the water\'s edge first.'); return false; }
      S.spot = sp; S.st = 'walk';
      const go = () => begin();
      if (Math.hypot(e.x - player.x, e.y - player.y) > 0.8) ctx.walkTo(e.x, e.y, 'Down to the edge…', go, () => { if (S.st === 'walk') S.st = 'off'; }); else go();
      return true;
    }
    function begin() {
      if (S.st !== 'walk') return;
      if (!gear) gear = makeGear();
      if (!hud) hud = makeHud();
      S.st = 'aim'; S.t = 0; S.aim = 0; S.power = 0; S.held = S.was = !!ctx.key('Space'); S.hintKey = ''; S.meter = -1; S.far = -9; S.cls = ''; S.bend = 0; S.rodPitch = 0.95; S.fx = player.x; S.fy = player.y;
      hud.el.hidden = false; hud.card.hidden = true;
      band(0, 0); setFar(-1); conditions();
      cam.yawTo = heading() + VIEW; cam.distTo = 4.6; cam.pitch = 0.24; cam.lastInput = -10;
      if (!save.told) { save.told = 1; keep(); H.toast(`<b>${data.water}</b><span>${data.rules.licence}</span>`); }
    }
    function stop(quiet) {
      if (S.st === 'off') return;
      const was = S.st;
      S.st = 'off';
      if (gear) { gear.float.visible = gear.fish.mesh.visible = false; gear.rod.visible = gear.line.visible = false; }
      if (hud) { hud.el.hidden = true; hud.card.hidden = true; hud.book.hidden = true; }
      if (player.rig) player.rig.hold = null;
      ctx.stage.classList.remove('fish-show');
      cam.distTo = 7.5;
      if (!quiet && was === 'fight') H.toast('You cut the line and let it go.');
    }
    function cast() {
      const rig = rigNow(), p = rig.cast[0] + (rig.cast[1] - rig.cast[0]) * S.power, h = heading();
      let d = CAST[0] + (CAST[1] - CAST[0]) * p;
      const sx = Math.sin(h), sy = Math.cos(h);
      while (d > 3 && !nav.isWater(player.x + sx * d, player.y + sy * d)) d -= 1;
      if (d <= 3) { H.toast('Nothing but rock that way. Aim at open water.'); S.st = 'aim'; S.power = 0; return; }
      S.x = player.x + sx * d; S.y = player.y + sy * d; S.line = d; S.cast01 = clamp((d - CAST[0]) / (CAST[1] - CAST[0]), 0, 1);
      let near = 99; for (const q of S.spot.schools) near = Math.min(near, Math.hypot(q[0] - S.x, q[1] - S.y));
      S.school = clamp(1 - near / 8, 0, 1);
      S.st = 'cast'; S.t = 0; save.casts++;
      plan(data, S.spot, readEnv(), rnd, save.assist, total() === 0, P);
      if (S.forced) { const s = data.species.find(q => q.id === S.forced); if (s) { P.s = s; P.cm = s.cm[1]; P.g = Math.round((s.g_per_cm3 || 0.011) * P.cm ** 3); } }
      S.wait = P.wait; S.nib = P.nibbles; S.nibT = S.nib ? S.wait * (0.3 + 0.3 * rnd()) : 9e9; S.dip = 0;
      A.beep(520);
    }
    function hooked() {
      S.st = 'fight'; S.t = 0; S.acc = 0; S.warned = 0;
      fight(P.s, P.cm, S.line, save.assist, F);
      band(SWEET[0], SWEET[1]); hud.btns.hidden = true;
      if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* not allowed */ }
    }
    function lost(why) {
      learn(save, false); keep();
      S.st = 'lost'; S.t = 0; gear.float.visible = false; hud.btns.hidden = false;
      setMeter(0, ''); band(0, 0); setFar(-1);
      setHint('lost' + why, why === 'snap' ? '<b>The line parted.</b> Ease off when it runs.' : why === 'spooled' ? '<b>It took all the line.</b> Wind whenever it rests.' : why === 'early' ? '<b>Too soon.</b> Wait until it goes right under.' : '<b>Missed it.</b> Strike as it goes under.');
      A.beep(why === 'snap' ? 140 : 220);
    }
    function landed() {
      const s = P.s, L = log(), e = L[s.id], first = !e, wasBest = e ? e.best : 0, firstEver = total() === 0;
      learn(save, true);
      L[s.id] = { n: (e ? e.n : 0) + 1, best: Math.max(wasBest, P.cm), spots: Object.assign({}, e && e.spots, { [S.spot.id]: ((e && e.spots && e.spots[S.spot.id]) || 0) + 1 }) };
      keep();
      S.st = 'card'; S.t = 0; gear.float.visible = false; band(0, 0); setFar(-1); setMeter(0, '');
      const tall = S.tall = ctx.stage.clientHeight > ctx.stage.clientWidth; // (a phone held upright sees 25° across: from further round the fish would be out of the picture)
      cam.yawTo = heading() + (tall ? 0.55 : SHOW); cam.distTo = tall ? 4.2 : 2.9; cam.pitch = 0.1; cam.lastInput = -10; ctx.stage.classList.add('fish-show');
      gear.fish.dress(s, P.cm); gear.fish.mesh.visible = true;
      const why = legal(s, P.cm), z = zoneOf(S.spot), clean = F.t > 3 && F.sweet / F.t > 0.45;
      hud.card.innerHTML = `<span class="tag">${first ? 'New in the log' : P.cm > wasBest ? `Your best · was ${wasBest} cm` : `${e.n + 1} caught`}</span><h3>${s.name}</h3><em>${s.sci}</em>`
        + `<div class="size">${P.cm.toFixed(1)} cm<small>${P.g >= 1000 ? (P.g / 1000).toFixed(2) + ' kg' : P.g + ' g'}${clean ? ' · a clean fight' : ''}</small></div>`
        + `<p class="rule">${why ? `${why}: back it goes.` : z.advice}</p><p>${s.note}</p><button class="go" data-go>Let it go</button>`;
      hud.card.hidden = false; hud.btns.hidden = false; hud.leave.textContent = 'Let it go';
      setHint('card', 'Measured and logged. Back it goes.');
      A.chime();
      if (firstEver || first && caught() === data.species.length) ctx.stamp(firstEver ? 'First catch' : 'Every fish in the log', data.water);
      const opened = data.rigs.find(r => r.unlock && r.unlock.species === caught() && first);
      if (opened) H.toast(`<b>New rig: ${opened.name}</b><span>${opened.hint} ${ctx.touch ? 'Tap Rig' : 'Keys 1 to 3'} to change.</span>`);
    }
    function release() {
      if (S.st !== 'card') return;
      gear.fish.mesh.visible = false; hud.card.hidden = true; hud.leave.textContent = 'Pack up';
      ring(player.x + Math.sin(heading()) * 2.2, player.y + Math.cos(heading()) * 2.2, 1.4);
      S.st = 'aim'; S.t = 0; S.power = 0; S.hintKey = ''; conditions();
      cam.yawTo = heading() + VIEW; cam.distTo = 4.6; cam.pitch = 0.24; ctx.stage.classList.remove('fish-show');
    }

    // what E does now (game.js currentAction)
    function action() {
      if (S.st === 'off') {
        const sp = spotNear(), no = sp && closed(player.x, player.y);
        return !sp ? null : no ? { key: 'E', text: 'No fishing here', act: () => H.toast(`<b>No fishing here</b><span>${no}</span>`) } : { key: 'E', text: `Fish at ${sp.name}`, act: () => start(sp) };
      }
      if (S.st === 'walk') return { key: '', text: 'Down to the edge…' };
      if (S.st === 'card') return { key: 'E', text: 'Let it go', act: release };
      if (S.st === 'wait' || S.st === 'cast') return { key: 'E', text: 'Wind in', act: () => { S.st = 'aim'; S.t = 0; S.power = 0; gear.float.visible = false; S.hintKey = ''; } };
      if (S.st === 'fight' || S.st === 'bite') return null;   // both hands are busy
      return { key: 'E', text: 'Pack up', act: () => stop() };
    }
    // a key while a line is out (game.js keydown): true when it was ours
    function key(code) {
      if (S.st === 'off') return false;
      if (hud && !hud.book.hidden) { if (code === 'KeyJ' || code === 'Escape' || code === 'KeyE' || code === 'Enter') showLog(false); return true; }
      if (code === 'KeyJ') { showLog(true); return true; }
      if (/^Digit[1-9]$/.test(code)) { nextRig(+code.slice(5) - 1); return true; }
      if (code === 'Escape' && S.st !== 'fight') { stop(); return true; }
      return code === 'Space' || code === 'KeyQ' || code === 'KeyG' || code === 'KeyR' || code === 'KeyX' || code === 'KeyT' || code === 'KeyO' || code === 'KeyY';
    }

    // ---------------------------------------------------------- each step of the game's clock (game.js simulate): dt s; turn -1..1
    function step(dt, turn) {
      // fish rising where the schools are, while you are near enough to see them
      if (player.mode === 'foot' && (riseT -= dt) < 0) {
        riseT = 1.6 + rnd() * 3.2;
        for (const sp of data.spots) if (Math.hypot(sp.at[0] - player.x, sp.at[1] - player.y) < 70 && sp.schools.length) {
          const q = sp.schools[(rnd() * sp.schools.length) | 0];
          ring(q[0] + (rnd() - 0.5) * 3, q[1] + (rnd() - 0.5) * 3, 0.5 + rnd() * 0.5);
        }
      }
      ringsStep(dt);
      // the first time you come up to a spot in a visit: what it is
      if (S.st === 'off' && player.mode === 'foot') for (const sp of data.spots) if (!seen[sp.id] && Math.hypot(sp.at[0] - player.x, sp.at[1] - player.y) < 22) {
        seen[sp.id] = 1;
        if (!ctx.ui()) H.toast(`<b>${sp.name}</b><span>${sp.note}</span>`);
      }
      if (S.st === 'off') { if ((gear || rings) && !data.spots.some(sp => Math.hypot(sp.at[0] - player.x, sp.at[1] - player.y) < 220)) freeGear(); return; }
      if (S.st === 'walk') return;
      if (player.mode !== 'foot' || Math.hypot(player.x - S.fx, player.y - S.fy) > 2.5) { stop(true); return; }   // carried off (the map, a ride): the line comes in
      { const no = closed(player.x, player.y); if (no) { stop(true); H.toast(`<b>Lines in</b><span>${no}</span>`); return; } }   // (a deck carried into a reserve)
      S.t += dt;
      const down = !!ctx.key('Space'), press = down && !S.was, lift = !down && S.was;
      S.was = down;
      const paused = ctx.ui() || (hud && !hud.book.hidden);
      player.h += Math.atan2(Math.sin(heading() - player.h), Math.cos(heading() - player.h)) * Math.min(1, dt * 8);
      let pitch = 0.95, bendTo = 0, floatY = 0, slack = 1;
      if (S.st === 'aim') {
        if (!paused && turn) { S.aim = clamp(S.aim + turn * dt * 0.9, -0.75, 0.75); cam.yawTo = heading() + VIEW; }
        if (!paused && press) { S.st = 'charge'; S.power = 0; S.dir = 1; }
        setMeter(0, ''); setHint('aim' + rigNow().id, `Hold ${kbd('Space', 'Cast')} and let go to cast · ${ctx.touch ? 'stick' : '<kbd>A</kbd><kbd>D</kbd>'} to aim`);
      } else if (S.st === 'charge') {
        S.power += S.dir * dt * 0.85; if (S.power >= 1) { S.power = 1; S.dir = -1; } else if (S.power <= 0) { S.power = 0; S.dir = 1; }
        pitch = 0.95 + 0.9 * S.power; setMeter(S.power, ''); setHint('charge', 'Let go to cast');
        if (lift) cast();
      } else if (S.st === 'cast') {
        pitch = 1.85 - 1.45 * clamp(S.t / 0.28, 0, 1); slack = 0.5;
        if (S.t > 0.75) {
          S.st = 'wait'; S.t = 0; ring(S.x, S.y, 1.1); A.beep(260);
          gear.float.visible = rigNow().id === 'float' || rigNow().id === 'fly';
          setMeter(0, ''); setFar(S.line);
        }
      } else if (S.st === 'wait') {
        pitch = 0.75; slack = 0.3;   // the line lies in a shallow belly to the float
        if (S.nib > 0 && S.t > S.nibT) { S.nib--; S.dip = 0.32; S.nibT = S.t + 0.9 + rnd() * 1.6; ring(S.x, S.y, 0.5); A.beep(880); }
        if (S.dip > 0) S.dip -= dt;
        floatY = S.dip > 0 ? -0.06 * Math.sin(Math.PI * (1 - S.dip / 0.32)) : 0;
        setHint(S.dip > 0 ? 'nib' : 'wait' + gear.float.visible, S.dip > 0 ? 'A nibble… <b>wait</b>' : gear.float.visible ? 'Watch the float. Strike when it goes right under.' : 'Feel for the take. Strike when the rod tip pulls down.');
        if (!paused && press && S.dip > 0 && !save.assist) { lost('early'); return; }   // struck at a nibble (a press on a still float does nothing: E winds in)
        if (S.t > S.wait && S.dip <= 0) { S.st = 'bite'; S.t = 0; ring(S.x, S.y, 0.9); A.beep(660); A.beep(990); if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* not allowed */ } }
      } else if (S.st === 'bite') {
        pitch = 0.62; bendTo = 0.16; floatY = -0.2; slack = 0.2;
        setHint('bite', `<b>Strike!</b> ${kbd('Space', 'Strike')}`); setMeter(1 - S.t / P.window, 'strike');
        if (press) { hooked(); return; }
        if (S.t > P.window) { lost('missed'); return; }
      } else if (S.st === 'fight') {
        let end = '';
        S.acc += dt;
        while (S.acc >= STEP && !end) { S.acc -= STEP; end = fightStep(F, STEP, down && !paused, rnd); if (F.event === 'run') { ring(S.x, S.y, 1.2); A.beep(330); } else if (F.event === 'warn') A.beep(740); }
        // the fish works across the cast's line as it runs
        const k = F.d / Math.max(1, S.line), sw = Math.sin(F.t * 0.9) * Math.min(4, F.d * 0.25), hx = Math.sin(heading()), hy = Math.cos(heading());
        S.x = player.x + hx * F.d + hy * sw; S.y = player.y + hy * F.d - hx * sw;
        pitch = 1.05 + 0.25 * F.T; bendTo = 0.25 + 0.75 * clamp(F.T, 0, 1.15); slack = 0.03; floatY = -0.3;
        if (down && (S.reelTick -= dt) < 0) { S.reelTick = F.phase === 'run' ? 0.2 : 0.085; A.beep(F.T > 0.92 ? 1500 : 1150); }
        const hot = F.T > 0.92, good = F.T >= SWEET[0] && F.T <= SWEET[1];
        setMeter(F.T, hot ? 'hot' : good ? 'good' : ''); setFar(F.d);
        setHint(F.phase + (hot ? 'h' : ''), hot ? '<b>Ease off!</b> The line is about to go.' : F.phase === 'run' ? `<b>It's running.</b> Let go of ${kbd('Space', 'Reel')}` : F.phase === 'warn' ? '<b>It\'s turning…</b>' : F.E <= 0 ? `It's beaten. Hold ${kbd('Space', 'Reel')} and bring it in.` : `Hold ${kbd('Space', 'Reel')} to wind. Keep the bar in the green.`);
        if (F.phase === 'run' && k > 0 && (S.warned -= dt) < 0) { S.warned = 0.5; ring(S.x, S.y, 0.7); }
        if (end === 'landed') { landed(); } else if (end) { lost(end); return; }
      } else if (S.st === 'card') {
        pitch = S.tall ? 1.25 : 1.0; bendTo = 0.1 + 0.25 * Math.min(1, P.g / 3000);
      } else if (S.st === 'lost') {
        pitch = 0.95; if (S.t > 1.6) { S.st = 'aim'; S.t = 0; S.power = 0; }
      }
      // ---- the rod in the right hand, the line to the float (or the fish)
      S.rodPitch += (pitch - S.rodPitch) * Math.min(1, dt * (S.st === 'cast' ? 22 : 7));
      S.bend += (bendTo - S.bend) * Math.min(1, dt * 9);
      const h = heading(), sx = Math.sin(h), sy = Math.cos(h);
      toW(hold, player.x + sx * 0.3 + sy * 0.17, player.y + sy * 0.3 - sx * 0.17, player.z + 1.02);
      if (player.rig) { player.rig.hold = hold; if (player.rig.fist && player.rig.fist(base)) { /* the wrist as posed */ } else base.copy(hold); } else base.copy(hold);
      const cp = Math.cos(S.rodPitch), sp = Math.sin(S.rodPitch);
      v1.set(sx * cp, sp, -sy * cp);                    // along the rod (world: x east, y up, z south)
      v2.set(sx * sp, -cp, -sy * sp);                   // square to it, the way the line pulls it: forward and down
      v3.crossVectors(v1, v2).normalize();
      m4.makeBasis(v3, v1, v2); gear.rod.quaternion.setFromRotationMatrix(m4); gear.rod.position.copy(base).addScaledVector(v1, -0.12);
      gear.bend.value = S.bend * 0.8; gear.rod.visible = gear.line.visible = true;
      tip.copy(base).addScaledVector(v1, ROD - 0.12 - 0.35 * 0.8 * S.bend).addScaledVector(v2, 0.8 * S.bend);
      const lp = gear.line.geometry.attributes.position;
      if (S.st === 'aim' || S.st === 'charge' || S.st === 'lost') { toW(v4, player.x + sx * 0.9, player.y + sy * 0.9, player.z + 1.2 + 0.25 * Math.sin(S.t * 2.1)); slack = 0.4; }
      else if (S.st === 'cast') { const k = clamp(S.t / 0.75, 0, 1); toW(v4, player.x + (S.x - player.x) * k, player.y + (S.y - player.y) * k, (player.z + 3.2) * (1 - k) * (1 - k) + 0.05 + 4 * k * (1 - k) * 2.2); }
      else if (S.st === 'card') { v4.copy(tip); v4.y -= S.tall ? 0.4 : 1.05; }   // (held high on a tall screen, over the card)
      else toW(v4, S.x, S.y, water() + 0.05 + floatY + (S.st === 'wait' ? 0.012 * Math.sin(ctx.time() * 2.3) : 0));
      const sag = slack * 0.14 * tip.distanceTo(v4);
      for (let i = 0; i < LINE_N; i++) { const k = i / (LINE_N - 1); lp.setXYZ(i, tip.x + (v4.x - tip.x) * k, tip.y + (v4.y - tip.y) * k - sag * 4 * k * (1 - k), tip.z + (v4.z - tip.z) * k); }
      lp.needsUpdate = true;
      if (gear.float.visible) gear.float.position.copy(v4);
      if (S.st === 'card') { // hanging from the line, its side to the camera, turning a little and still kicking at first
        const f = gear.fish.mesh, c = ctx.camera.position; f.position.copy(v4); f.position.y -= f.scale.y * 0.5;
        f.rotation.set(0, Math.atan2(-(c.z - v4.z), c.x - v4.x) + 0.35 * Math.sin(S.t * 1.1), 0.09 * Math.sin(S.t * 9) * Math.max(0, 1 - S.t / 3));
      }
      const night = ctx.sun() && ctx.sun().altitude < -2;
      gear.floatMat.emissiveIntensity = night ? 0.3 : 0;
      gear.line.material.opacity = night ? 0.3 : 0.8;   // (unlit: a white line would glow after dark)
    }

    // what you stand on moved you dx, dy metres (a ship's deck under way): the line and the float go with you, trolled
    function carry(dx, dy) { S.fx += dx; S.fy += dy; S.x += dx; S.y += dy; }
    function dispose() { stop(true); freeGear(); if (hud) { hud.el.remove(); hud.card.remove(); hud.book.remove(); hud = null; } }
    // what the phone's Jump button does with a line out ('' when it is a jump again)
    const button = () => (S.st === 'off' || S.st === 'walk' || S.st === 'card' ? '' : S.st === 'fight' ? 'Reel' : S.st === 'bite' ? 'Strike' : 'Cast');
    return { action, key, step, start, stop, dispose, button, carry, on: () => S.st !== 'off' && S.st !== 'walk', busy: () => S.st !== 'off',
      // for the checks (tools/game_check.js, tools/fishing_shot.js)
      state: () => ({ st: S.st, spot: S.spot && S.spot.id, power: S.power, line: S.line, wait: S.wait, t: S.t, fish: P.s && P.s.id, cm: P.cm, T: F.T, d: F.d, phase: F.phase, assist: save.assist, log: log(), rig: rigNow().id, drawn: gear ? 4 + (rings ? 1 : 0) : 0 }),
      seed: n => { rnd = rng(n); }, force: id => { S.forced = id; }, easiest: () => data.species.reduce((a, q) => (q.fight.pull < a.fight.pull ? q : a)).id, forget: () => { save = { v: 1, assist: 0, lost: 0, won: 0, casts: 0, rig: {}, log: {} }; keep(); }, spots: data.spots, showLog };
  }
  return { VERSION, core, create };
})();
