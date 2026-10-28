// Vessels, wakes and aircraft for the reef viewer. Loaded by main.js as a module:
//   export async function init(ctx) -> { update, vessels, board, leave, wake, byName, seaplane, helicopter, surfaceAt, wakeNode }
//
// - procedural vessels (boats/vessels*.js, airmodels.js, harbour.js) riding the CPU copy of the ocean's wave bank (boats/surface.js)
// - a world-locked wake field plus ribbon trails (boats/wake.js)
// - AI traffic over A* routes on the depth grid (boats/nav.js, boats/vessel.js)
// - rideable boats and flyable aircraft (boats/control.js)
// Test cameras: ?boatcam=<name|id|kind>&bd=<m>&baz=<deg from bow>&bel=<deg>&bh=<look height>.
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, float, mix, max, select, smoothstep, mx_noise_float, positionWorld, cameraPosition } from 'three/tsl';
import { shared, materials, sstep } from './boats/kit.js';
import { makeSurface } from './boats/surface.js';
import { createWakeField } from './boats/wake.js';
import { buildYacht, buildCat } from './boats/vessels.js';
import { buildDayCat, buildTinnie } from './boats/vessels2.js';
import { buildSeaplane, buildHeli } from './boats/airmodels.js';
import { buildPontoon, buildHelipad, buildJetty, buildMooring } from './boats/harbour.js';
import { createNav } from './boats/nav.js';
import { Vessel, angDiff } from './boats/vessel.js';
import { createControl } from './boats/control.js';

const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const pick = a => a[Math.floor(rnd() * a.length)];

export async function init(ctx) {
  const tInit = performance.now();
  const { scene, camera, env, q } = ctx;
  shared.env = env;
  materials();
  const surf = makeSurface(ctx);
  const wake = createWakeField(ctx);
  const nav = createNav(ctx);
  const vessels = [];
  const dtr = Math.PI / 180;
  const T = () => env.u.time.value;

  // ---- wind, derived from the same wave bank the sea is drawn from: the chop travels with the wind ----
  const wind = { vx: 0, vy: 0, from: 0, speed: 0, to: 0 };
  const chop = env.waves.filter(w => w.disp && w.lam < 20);
  let cdx = 0, cdz = 0; for (const w of chop) { cdx += w.dx; cdz += w.dz; }
  const cl = Math.hypot(cdx, cdz) || 1; cdx /= cl; cdz /= cl;
  const windNow = () => {
    const to = Math.atan2(cdx, -cdz);            // compass bearing the waves (and the wind) travel toward
    wind.to = to; wind.from = to + Math.PI; wind.speed = 3 + 11 * env.u.wind.value;
    wind.vx = Math.sin(to) * wind.speed; wind.vy = Math.cos(to) * wind.speed;
    return wind;
  };

  // ---- api handed to Vessel and the controllers ----
  const api = { scene, env, surf, wind: windNow, vessels, noRibbon: q.get('noribbon') === '1',
    placeAir(v, y, pitch, roll) { v.y = y; v.pitch = pitch; v.roll = roll; v.place(); },
    floatAir(v, dt, alt, pitch, bank, wave) {
      v.buoyancy(dt, true);
      const k = sstep(0.25, 1.8, alt);
      v.y = v.y + (wave.h + alt - v.y) * k; v.pitch += (pitch - v.pitch) * k; v.roll += (bank - v.roll) * k;
      v.place();
    },
    groundUnder(v) {
      for (const p of pads) { if (Math.hypot(v.x - p.x, v.z - p.z) < p.desc.radius * 0.85 && p !== v) return { y: p.y + 0.46, water: false, pad: p }; }
      const h = ctx.height(v.x, -v.z), tide = env.u.tide.value;
      if (h > tide + 0.3) return { y: h, water: false };
      return { y: surf.heightAt(v.x, v.z, undefined, 4), water: true };
    }
  };
  const pads = [];
  const control = createControl(ctx, api);

  let nextId = 1;
  function add(kind, name, desc, o = {}) {
    const id = `${kind}-${nextId++}`;
    const v = new Vessel(api, id, name, desc, o);
    scene.add(v.root);
    vessels.push(v);
    return v;
  }

  // ======================================================================================================
  // places (local metres east, north). Anchorages are searched for real water depth near the nominal spot.
  const SPOTS = {
    cid: [-10300, 3300, 'Cid Harbour'], tongue: [1900, 4700, 'Tongue Bay'], hill: [900, 5300, 'Hill Inlet entrance'], chalkies: [7000, 700, 'Chalkies Beach'],
    whitehaven: [1000, 1200, 'Whitehaven Beach'], hamilton: [-9000, -9500, 'Hamilton Island Marina'], hook: [800, 11500, 'Hook Island'], west: [-15150, -1500, 'Shute Harbour gate']
  };
  const spot = {};
  for (const [k, [x, n]] of Object.entries(SPOTS)) spot[k] = nav.snap(x, n) || [x, n];
  const avoid = [];
  const placeAnchor = (key, i = 0, spread = 220) => {
    const [x0, n0] = SPOTS[key];
    for (let tries = 0; tries < 10; tries++) {
      const p = nav.anchorage(x0 + (rnd() - 0.5) * spread * (tries + 1) * 0.3, n0 + (rnd() - 0.5) * spread * (tries + 1) * 0.3, 4.8, 9, 1500, 30, avoid);
      if (p) { avoid.push([p[0], p[1], 55]); return p; }
    }
    return null;
  };

  const YACHT_BANDS = [0x16365f, 0x7a1d24, 0x1d4d3a, 0x4a4f55, 0x14365e];
  const YACHT_NAMES = ['Moana Breeze', 'Sea Whisper', 'Coral Dancer', 'Windchaser', 'Blue Horizon', 'Pacific Pearl', 'Tradewind', 'Salty Dog', 'Kookaburra', 'Southern Cross', 'Reef Runner', 'Gypsy Soul', 'Banksia', 'Tucker Bay', 'Mango Moon', 'Ningaloo', 'Wattle', 'Dugong', 'Sundowner', 'Frangipani', 'Barefoot', 'Lazy Susan', 'Lorikeet', 'Saltwater'];
  const CAT_NAMES = ['Island Time', 'Cat Nap', 'Two Hulls', 'Sunseeker Cat', 'Double Dutch', 'Twin Peaks'];
  let yi = 0, ci = 0;
  const yacht = (o) => add('yacht', YACHT_NAMES[yi++ % YACHT_NAMES.length], buildYacht({ band: pick(YACHT_BANDS) }), o);
  const cat = (o) => add('cat', CAT_NAMES[ci++ % CAT_NAMES.length], buildCat(), o);
  const tinnie = (name, o) => add('tinnie', name, buildTinnie(), o);

  // ---- anchored fleets ----
  const anchored = [];
  const fleet = (key, n, catAt = -1) => { for (let i = 0; i < n; i++) { const p = placeAnchor(key); if (!p) continue; const o = { x: p[0], z: -p[1], hdg: 0, swing: (rnd() - 0.5) * 0.5, mode: 'anchored' }; anchored.push(i === catAt ? cat(o) : yacht(o)); } };
  fleet('cid', 5, 2); fleet('tongue', 3); fleet('hill', 3, 1); fleet('chalkies', 3);
  // tenders near anchored yachts
  for (const v of anchored.slice(0, 3)) { const t = tinnie(`${v.name} tender`, { x: v.x + 14, z: v.z + 9, hdg: rnd() * 6, mode: 'anchored', swing: 1 }); }

  // ---- Hamilton Island marina: a jetty reaching out from the shore, finger pontoons, moored boats ----
  let jetty = null;
  {
    const sh = nav.shoreFrom(...spot.hamilton, 2500);
    if (sh) {
      // the model's water edge is a good bit off the real marina; push the jetty seaward so it reaches water > 3 m
      const jd = buildJetty({ len: 90, fingers: 5, deckY: 1.7 });
      const psi = Math.atan2(sh.dirN, sh.dirX);
      jd.group.position.set(sh.x - sh.dirX * 8, 0, -(sh.n - sh.dirN * 8)); jd.group.rotation.y = psi;
      scene.add(jd.group); jetty = jd; jd.psi = psi;
      const hdgAlong = Math.atan2(Math.sin(psi), -Math.cos(psi));     // compass heading of jetty-local +Z (along the fingers)
      const toW = (lx, lz) => [jd.group.position.x + lx * Math.cos(psi) + lz * Math.sin(psi), jd.group.position.z - lx * Math.sin(psi) + lz * Math.cos(psi)];
      let k = 0;
      for (const fx of jd.fingers) for (const sd of [-1, 1]) {
        if (k++ % 3 === 2) continue;
        const lx = fx + sd * (0.65 + 2.1), lz = jd.w / 2 + 6.6;
        const [wx, wz] = toW(lx, lz);
        if (ctx.depth(wx, -wz) < 1.5) continue;
        const o = { x: wx, z: wz, hdg: hdgAlong, mode: 'docked' };
        if (k % 4 === 0) cat({ ...o, x: wx + sd * 1.5 }); else if (k % 5 === 0) tinnie('Marina tinnie', o); else yacht(o);
      }
    }
  }

  // ---- reef pontoon (Hardy Reef style), its helipad, parked seaplane and helicopter, and moorings ----
  let pontoon = null, helipad = null, seaplane = null, helicopter = null, berthDay = null;
  const moorings = [];
  {
    // the pontoon sits on the edge of an offshore reef: find a reef cell far from the coast, then deep water beside it
    let best = null;
    const cx = 8500, cn = 9700;
    for (let dx = -2500; dx <= 2500; dx += 60) for (let dn = -2500; dn <= 2500; dn += 60) {
      const x = cx + dx, n = cn + dn;
      if (ctx.habitat(x, n) !== 2) continue;
      const d = ctx.depth(x, n); if (d < 1.0 || d > 7) continue;
      const sc = Math.hypot(dx, dn); if (!best || sc < best.sc) best = { x, n, sc };
    }
    if (!best) { best = { x: 1500, n: 1100 }; }
    const p = nav.anchorage(best.x, best.n, 9, 18, 900, 20) || [best.x, best.n];
    const pd = buildPontoon(), hd = buildHelipad();
    const hdg = 20 * dtr;
    pontoon = add('pontoon', 'Reef pontoon', pd, { x: p[0], z: -p[1], hdg, mode: 'static' });
    const toLocal = (lx, lz) => { const c = Math.cos(hdg), s = Math.sin(hdg); return [pontoon.x + lx * s + lz * c, pontoon.z - lx * c + lz * s]; };
    const hp = toLocal(-23, 0);
    helipad = add('helipad', 'Reef helipad', hd, { x: hp[0], z: hp[1], hdg, mode: 'static' }); pads.push(helipad);
    const sp = toLocal(6, -(5.5 + 0.7 + 1.5 + 0.6));
    seaplane = add('seaplane', 'Reef Air amphibian', buildSeaplane(), { x: sp[0], z: sp[1], hdg, mode: 'docked' });
    helicopter = add('helicopter', 'Scenic helicopter', buildHeli(), { x: hp[0], z: hp[1], hdg, mode: 'static' });
    helicopter.air = helipad.y + 0.46;
    const bp = toLocal(0, 5.5 + 0.7 + 4.5);
    berthDay = add('daycat', 'Reef Explorer', buildDayCat(), { x: bp[0], z: bp[1], hdg, mode: 'docked' });
    pontoon.berthWorld = bp;
    // mooring buoys: GBRMPA public moorings at reef edges around the model
    const taken = [[p[0], p[1], 800]];
    const cands = [];
    for (let x = -14000; x < 16000; x += 90) for (let n = -14000; n < 16000; n += 90) {
      if (ctx.habitat(x, n) !== 2) continue; const d = ctx.depth(x, n); if (d < 2 || d > 8) continue; cands.push([x, n]);
    }
    for (let i = 0; i < 8 && cands.length; i++) {
      const c = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
      if (taken.some(t => Math.hypot(t[0] - c[0], t[1] - c[1]) < 1800)) { i--; if (cands.length < 5) break; continue; }
      const m = nav.anchorage(c[0], c[1], 7, 16, 400, 20, []); if (!m) continue;
      taken.push([m[0], m[1], 400]);
      const md = buildMooring(ctx.depth(m[0], m[1]));
      moorings.push(add('mooring', `Mooring ${moorings.length + 1}`, md, { x: m[0], z: -m[1], hdg: rnd() * 6, mode: 'static' }));
    }
    // nearby moorings around the pontoon reef (dive sites)
    for (const [dx, dn] of [[260, 140], [-180, 300]]) { const m = nav.anchorage(p[0] + dx, p[1] + dn, 6, 14, 300, 15); if (m) moorings.push(add('mooring', `Mooring ${moorings.length + 1}`, buildMooring(ctx.depth(m[0], m[1])), { x: m[0], z: -m[1], hdg: 0, mode: 'static' })); }
  }

  // ---- AI traffic ----
  const routeBetween = (a, b) => nav.route(a, b);
  const chain = (...pts) => { const out = []; for (let i = 0; i < pts.length - 1; i++) { const r = routeBetween(pts[i], pts[i + 1]); if (!r) return null; out.push(...(i ? r.slice(1) : r)); } return out; };
  function traffic(v, pts, o = {}) {
    if (!pts || pts.length < 2) { v.dispose(); vessels.splice(vessels.indexOf(v), 1); return null; }
    v.setRoute(pts, o);
    // start part-way along the route, heading to the next waypoint
    const i = Math.min(pts.length - 2, Math.floor((o.startAt ?? rnd()) * (pts.length - 1)));
    const f = o.f ?? rnd(), a = pts[i], b = pts[i + 1];
    v.x = a[0] + (b[0] - a[0]) * f; v.z = -(a[1] + (b[1] - a[1]) * f); v.ai.i = i + 1;
    v.hdg = Math.atan2(b[0] - a[0], b[1] - a[1]);
    v.speed = o.v0 ?? v.spec.vmax * 0.7;
    const wnd = windNow(), twa = Math.abs(angDiff(v.hdg, wnd.from));
    if (v.ai.canSail) { const sail = twa > 0.75; v.sailMode = sail ? 'sail' : 'motor'; v.sail.want = sail ? 'sail' : 'motor'; v.snapSails(); if (!sail) v.speed = 2.9; }
    for (const tr of v.trails) {
      const fx = Math.sin(v.hdg), fz = -Math.cos(v.hdg);
      const w = v.toWorld(tr.origin[0], tr.origin[1]);
      tr.prefill(w[0], w[1], fx, fz, v.speed, T(), tr.life);
    }
    return v;
  }
  {
    const P = spot;
    const westGate = P.west, wh = P.whitehaven, ham = P.hamilton, hook = P.hook, hill = P.hill, tong = P.tongue, cid = P.cid;
    // day-tour catamarans on the commuter and island-hop runs
    traffic(add('daycat', 'Island Express', buildDayCat(), { mode: 'ai' }), chain(westGate, ham, cid, westGate), { loop: 'repeat', dwell: 8, hide: false, vmax: 15 });
    traffic(add('daycat', 'Coral Sea Cruiser', buildDayCat(), { mode: 'ai' }), chain(westGate, wh, hill), { loop: 'pingpong', dwell: 40, vmax: 14 });
    // the Hardy-Reef style day boat circulates between the pontoon, the moorings and back
    if (pontoon && moorings.length) {
      const pp = [pontoon.x + 450, -pontoon.z + 300];
      const pr = nav.snap(pp[0], pp[1]) || pp;
      const stops = [pr, ...moorings.slice(-2).map(m => [m.x, -m.z])].filter(Boolean);
      const hop = chain(...stops, pr);
      traffic(add('daycat', 'Hardy Looper', buildDayCat(), { mode: 'ai' }), hop, { loop: 'repeat', dwell: 30, vmax: 9 });
    }
    // yachts under sail between anchorages
    traffic(yacht({ mode: 'ai' }), chain(cid, wh), { loop: 'pingpong', dwell: 60, vmax: 4.2 });
    traffic(yacht({ mode: 'ai' }), chain(wh, ham), { loop: 'pingpong', dwell: 60, vmax: 4.2 });
    traffic(cat({ mode: 'ai' }), chain(ham, hill), { loop: 'pingpong', dwell: 90, vmax: 5 });
    traffic(yacht({ mode: 'ai' }), chain(westGate, cid), { loop: 'pingpong', dwell: 40, vmax: 4.2 });
    traffic(yacht({ mode: 'ai' }), chain(hook, tong), { loop: 'pingpong', dwell: 40, vmax: 4.2 });
    // tinnie shuttles
    traffic(tinnie('Dive boat Nemo', { mode: 'ai' }), chain(tong, wh), { loop: 'pingpong', dwell: 25, vmax: 12 });
    traffic(tinnie('Water taxi', { mode: 'ai' }), chain(ham, cid), { loop: 'pingpong', dwell: 25, vmax: 13 });
  }
  // aircraft on scenic loops
  const aero = [];
  function orbiter(kind, name, desc, cx, cn, r, alt, v, dir = 1) {
    const a = add(kind, name, desc, { mode: 'orbit' });
    a.orbit = { cx, cn, r, alt, v, dir, th: rnd() * 6.28 };
    a.propRpm = kind === 'seaplane' ? 60 : 40;
    aero.push(a); return a;
  }
  orbiter('helicopter', 'Scenic flight', buildHeli({ livery: 0xc23a1c }), spot.whitehaven[0], spot.whitehaven[1] + 1500, 1400, 160, 38, 1);
  orbiter('seaplane', 'Whitsunday Air', buildSeaplane({ livery: 0xc23a1c }), spot.hamilton[0] + 2500, spot.hamilton[1] + 3200, 3200, 260, 45, -1);

  // initial state for sails of anchored yachts: furled
  for (const v of vessels) { v.snapSails(); }

  // ---- lookup and boarding ----
  const byName = (s) => { s = String(s).toLowerCase(); return vessels.find(v => v.name.toLowerCase() === s || v.id === s) || vessels.find(v => v.name.toLowerCase().includes(s)) || null; };
  const refOf = (id) => typeof id === 'string' ? byName(id) : (typeof id === 'object' ? id : vessels[id]);
  function board(id, player) {
    const v = refOf(id); if (!v) return null;
    if (v.kind === 'seaplane') return seaplaneApi.enter(player, v);
    if (v.kind === 'helicopter') return helicopterApi.enter(player, v);
    if (!['yacht', 'cat', 'tinnie', 'daycat'].includes(v.kind)) return null;
    control.driveBoat(v, player); return v;
  }
  function leave() { return control.end(); }
  const seaplaneApi = { vessel: seaplane, enter(player, v = seaplane) { if (!v) return null; control.flySeaplane(v, player); return v; }, exit() { return control.end(); } };
  const helicopterApi = { vessel: helicopter, enter(player, v = helicopter) { if (!v) return null; control.flyHeli(v, player); return v; }, exit() { return control.end(); } };

  // ---- wake into the ocean: hook the field into ocean.js's material unless the lead has done it ----
  function hookOcean() {
    if (q.get('wakehook') === '0' || ctx.ocean.wakeHooked) return false;
    try {
      const mat = ctx.ocean.material, posN = mat.positionNode, outN = mat.outputNode;
      mat.positionNode = Fn(() => { const w = wake.wakeNode(posN.xz); return vec3(posN.x, posN.y.add(w.height), posN.z); })();
      mat.outputNode = Fn(() => {
        const o = outN, w = wake.wakeNode(positionWorld.xz);
        const above = select(cameraPosition.y.greaterThan(env.u.tide), float(1), float(0));
        const fc = vec3(0.93, 0.96, 0.97).mul(env.u.white.mul(0.85).add(0.1));
        // broken up with noise so the field reads as foam streaks, not a soft glow
        const n = mx_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9), env.u.time.mul(0.25)));
        const n2 = mx_noise_float(vec3(positionWorld.x.mul(3.1), positionWorld.z.mul(3.1), env.u.time.mul(0.4)));
        const f = smoothstep(0.12, 0.62, w.foam.mul(1.15).add(n.mul(0.22)).add(n2.mul(0.12)).sub(0.12)).mul(above);
        return vec4(mix(o.rgb, fc, f.mul(0.8)), max(o.a, f.mul(0.85)));
      })();
      mat.needsUpdate = true; ctx.ocean.wakeHooked = true; return true;
    } catch (e) { console.warn('wake hook failed', e); return false; }
  }
  const hooked = hookOcean();

  // ---- test camera ----
  const camV = q.get('boatcam') ? (byName(q.get('boatcam')) || vessels.find(v => v.kind === q.get('boatcam'))) : null;
  const camP = { d: Number(q.get('bd') ?? 40), az: Number(q.get('baz') ?? 135) * dtr, el: Number(q.get('bel') ?? 14) * dtr, h: Number(q.get('bh') ?? 2) };
  if (camV && q.get('bsail')) { camV.sail.want = q.get('bsail'); camV.snapSails(); camV.mode = 'static'; if (q.get('bspeed')) camV.speed = Number(q.get('bspeed')); }
  function testCam() {
    if (!camV || ctx.controller) return;
    const b = camV.hdg + camP.az;
    camera.position.set(camV.x + Math.sin(b) * Math.cos(camP.el) * camP.d, camV.y + camP.h + Math.sin(camP.el) * camP.d, camV.z - Math.cos(b) * Math.cos(camP.el) * camP.d);
    camera.lookAt(camV.x, camV.y + camP.h, camV.z);
    const yh = surf.heightAt(camera.position.x, camera.position.z, undefined, 4); if (camera.position.y < yh + 0.4 && q.get('under') !== '1') { camera.position.y = yh + 0.4; camera.lookAt(camV.x, camV.y + camP.h, camV.z); }
  }

  // ---- per-frame ----
  const update = (dt) => step(Math.max(0, Math.min(dt, 0.1)));   // the screenshot tool's first frame arrives with a negative dt
  let simT = 0;
  function step(dt) {
    simT += dt; const t = simT;
    const wnd = windNow();
    shared.time.value = T();
    surf.update();
    const sunAlt = env.u.sunAlt.value;
    shared.lamp.value = 1 - sstep(0.09, 0.22, sunAlt);       // running lights come on as the sun gets low
    const lampsOn = shared.lamp.value > 0.02;
    const cam = camera.position;
    const tide = env.u.tide.value;
    if (jetty) jetty.group.position.y = tide;
    for (const v of vessels) {
      const dist = Math.hypot(v.x - cam.x, v.z - cam.z);
      const near = dist < 1600 || v.mode === 'player';
      if (v.lampsOn !== lampsOn) { v.lampsOn = lampsOn; for (const l of v.desc.lamps || []) l.visible = lampsOn; }
      switch (v.mode) {
        case 'ai': v.aiStep(dt, wnd); break;
        case 'anchored': v.anchorStep(dt, wnd, t); break;
        case 'orbit': {
          const o = v.orbit; o.th += o.dir * o.v / o.r * dt;
          v.x = o.cx + Math.sin(o.th) * o.r; v.z = -(o.cn + Math.cos(o.th) * o.r);
          v.hdg = o.th + o.dir * Math.PI / 2; v.speed = o.v;
          const bank = Math.atan(o.v * o.v / (9.81 * o.r)) * o.dir;
          api.placeAir(v, tide + o.alt + Math.sin(t * 0.2 + o.th) * 6, v.kind === 'helicopter' ? -0.08 : 0.03, bank * 1.0);
          break;
        }
        default: break;
      }
      if (v.mode !== 'orbit' && v.mode !== 'player') {
        if (v.kind === 'helicopter') { v.y = (v.mode === 'static' ? helipad.y + 0.46 : v.y); v.place(); }
        else { v.buoyancy(dt, near); v.rig(dt, wnd); v.place(); }
      } else if (v.mode === 'player') { if (v.kind === 'yacht' || v.kind === 'cat') { v.rig(dt, wnd); } if (v.kind !== 'seaplane' && v.kind !== 'helicopter') { v.buoyancy(dt, true); v.place(); } }
      // propellers and rotors
      if (v.desc.prop && v.kind === 'helicopter' && v.mode !== 'player') { v.desc.prop.rotation.y += (v.mode === 'orbit' ? 38 : 0) * dt; if (v.desc.tail) v.desc.tail.rotation.z += (v.mode === 'orbit' ? 60 : 0) * dt; const disc = v.desc.prop.children[v.desc.prop.children.length - 1]; if (disc) disc.visible = v.mode === 'orbit'; }
      if (v.desc.prop && v.kind === 'seaplane' && v.mode === 'orbit') { v.desc.prop.rotation.x += 55 * dt; }
      if (v.kind === 'seaplane' && v.mode !== 'orbit') { const d = v.desc.prop.children[v.desc.prop.children.length - 1]; if (d && v.mode !== 'player') d.visible = false; }
      if (v.kind === 'helicopter' && v.mode === 'player') { const d = v.desc.prop.children[v.desc.prop.children.length - 1]; if (d) d.visible = (v.rpm || 0) > 0.4; }
      if (v.trails.length && v.kind !== 'helicopter' && !(v.kind === 'seaplane' && v.air > 1)) v.wake(dt, t, dist < 2600, wake);
      else for (const tr of v.trails) tr.mesh.visible = false;
    }
    wake.update(dt, t);
    testCam();
  }
  // the 'player' camera swing on a still: camera placed before the first frame
  // settle buoyancy and sails before the first frame, then optionally run ?warm=<s> seconds so wakes have built up
  { const w = windNow(); for (let k = 0; k < 2; k++) for (const v of vessels) if (v.mode !== 'orbit' && v.kind !== 'helicopter') { v.buoyancy(6, true); v.rig(6, w); v.place(); } }
  for (let i = 0, n = Number(q.get('warm') ?? 0) * 30; i < n; i++) step(1 / 30);
  const API = { update, vessels, board, leave, wake, byName, seaplane: seaplaneApi, helicopter: helicopterApi, nav, surfaceAt: surf.surfaceAt, wakeNode: wake.wakeNode, windInfo: wind, pads, jetty, pontoon, moorings, hooked };
  API.ctx = ctx; API.initMs = Math.round(performance.now() - tInit);
  window.__boats = API;
  return API;
}
