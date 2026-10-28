// Vessels, wakes and aircraft for the reef viewer. Loaded by main.js as a module:
//   export async function init(ctx) -> { update, vessels, board, leave, wake, byName, seaplane, helicopter, surfaceAt, wakeNode }
//
// - procedural vessels (boats/vessels*.js, airmodels.js, harbour.js) riding the CPU copy of the ocean's wave bank (boats/surface.js)
// - a world-locked wake field plus ribbon trails (boats/wake.js)
// - AI traffic over A* routes on the depth grid (boats/nav.js, boats/vessel.js)
// - rideable boats and flyable aircraft (boats/control.js)
//
// API (all on the returned object, also window.__boats):
//   vessels            array of Vessel { id, name, kind, x, z (=-north), y, hdg (compass rad), speed, mode, root, desc }
//                      kinds: yacht cat daycat tinnie seaplane helicopter pontoon helipad mooring
//   byName(s)          exact or partial name, or id ('yacht-3')
//   board(id, player)  drive a boat (tinnie, yacht, cat, day cat) or fly the aircraft; installs ctx.controller and
//                      restores the previous one on leave(); `player` (optional) gets .boarded, .group.visible=false, onBoard/onLeave
//   leave()            WASD drive: W/S throttle, A/D steer, R sails (yachts), drag to look, F leave
//   seaplane / helicopter  { vessel, enter(player), exit() } for the parked aircraft (at the reef pontoon, or where harbour.parked puts them)
//   Also set as ctx.boats. Where things go comes from the site: scene.json `pois` and `harbour` (see pipeline/marine_meta.py).
//   vessel.setSails('sail'|'motor'|'furled')   hoist / motor / furl the sails of a yacht or cat
//   surfaceAt(x, z, t)  CPU copy of the ocean: { h, nx, ny, nz } at scene x, z (z = -north)
//   wake               the wake field; wake.wakeNode(worldXZ) -> { height, foam } is a TSL node for ocean.js
//   deckAt(x, north)   height of a walkable deck (pontoon, helipad, jetty) at a point, or null; also pushed to ctx.decks
//   nav                depth-grid router: route([x, north], [x, north]) -> waypoints, anchorage(), shoreFrom()
//
// The wake field is hooked into ocean.js's material here (positionNode + outputNode are wrapped) unless
// ctx.ocean.wakeHooked is already true or ?wakehook=0. To do it natively in ocean.js instead, read `ctx.wake.wakeNode`
// after the modules load: add `.height` to the vertex y and mix white by `.foam` over the Fresnel alpha, and set
// ocean.wakeHooked = true so this module leaves the material alone.
//
// Test cameras: ?boatcam=<name|id|kind>&bd=<m>&baz=<deg from bow>&bel=<deg>&bh=<look height>&bsail=sail|motor|furled
//   &warm=<s> (let wakes build before the first frame) &noribbon=1 (field only) &wakehook=0 (ribbons only).
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
  ctx.wake = wake; ctx.surfaceAt = surf.surfaceAt;     // for other modules (divers, ocean.js)
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
  // places come from the site's scene.json (cities/<id>/city.json, pipeline/marine_meta.py): POIs in local metres
  // east and north, and a harbour block naming which POIs hold anchored fleets, the marina, a reef pontoon, parked
  // aircraft and the traffic routes. Anchorages are searched for real water depth near the nominal spot.
  const H = ctx.S.harbour || {};
  const POI = new Map((ctx.S.pois || []).map(p => [p.id, p]));
  const at = id => { const p = POI.get(id); return p ? [p.x, p.y] : null; };
  const spot = id => { const p = at(id); return p ? (nav.snap(p[0], p[1]) || p) : null; };
  const avoid = [];
  const placeAnchor = (id, spread = 220) => {
    const [x0, n0] = at(id);
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
  for (const f of H.fleets || []) {
    if (!POI.has(f.at)) continue;
    for (let i = 0; i < f.n; i++) {
      const p = placeAnchor(f.at); if (!p) continue;
      const o = { x: p[0], z: -p[1], hdg: 0, swing: (rnd() - 0.5) * 0.5, mode: 'anchored' };
      anchored.push(i === f.cat ? cat(o) : yacht(o));
    }
  }
  // tenders near anchored yachts
  for (const v of anchored.slice(0, 3)) tinnie(`${v.name} tender`, { x: v.x + 14, z: v.z + 9, hdg: rnd() * 6, mode: 'anchored', swing: 1 });

  // ---- marina: a jetty along its mapped line (marina.from, the shore end, to marina.at), or reaching out from the
  // shore nearest to marina.at; finger pontoons, and moored boats unless marina.boats is false ----
  let jetty = null;
  const M = H.marina;
  if (M && POI.has(M.at)) {
    let sh = null, len = M.len || 90;
    if (M.from && POI.has(M.from)) {
      const [ax, an] = at(M.from), [bx, bn] = at(M.at), L = Math.hypot(bx - ax, bn - an);
      sh = { x: ax, n: an, dirX: (bx - ax) / L, dirN: (bn - an) / L, exact: true }; len = L;
    } else sh = nav.shoreFrom(...spot(M.at), 2500);
    if (sh) {
      // the 30 m model's water edge can sit a good bit off the real marina; push the jetty seaward so it reaches water > 3 m
      const jd = buildJetty({ len, fingers: M.fingers || 5, deckY: 1.7 });
      const psi = Math.atan2(sh.dirN, sh.dirX), back = sh.exact ? 0 : 8;
      jd.group.position.set(sh.x - sh.dirX * back, 0, -(sh.n - sh.dirN * back)); jd.group.rotation.y = psi;
      scene.add(jd.group); jetty = jd; jd.psi = psi;
      const hdgAlong = Math.atan2(Math.sin(psi), -Math.cos(psi));     // compass heading of jetty-local +Z (along the fingers)
      const toW = (lx, lz) => [jd.group.position.x + lx * Math.cos(psi) + lz * Math.sin(psi), jd.group.position.z - lx * Math.sin(psi) + lz * Math.cos(psi)];
      let k = 0;
      if (M.boats !== false) for (const fx of jd.fingers) for (const sd of [-1, 1]) {
        if (k++ % 3 === 2) continue;
        const lx = fx + sd * (0.65 + 2.1), lz = jd.w / 2 + 6.6;
        const [wx, wz] = toW(lx, lz);
        if (ctx.depth(wx, -wz) < 1.5) continue;
        const o = { x: wx, z: wz, hdg: hdgAlong, mode: 'docked' };
        if (k % 4 === 0) cat({ ...o, x: wx + sd * 1.5 }); else if (k % 5 === 0) tinnie('Marina tinnie', o); else yacht(o);
      }
    }
  }

  // ---- reef pontoon (Hardy Reef style) with its helipad, seaplane, day boat and dive moorings, where the site has one ----
  let pontoon = null, helipad = null, seaplane = null, helicopter = null, berthDay = null;
  const moorings = [], pontoonMoorings = [];
  const pt = H.pontoon;
  if (pt) {
    // at a POI, or on the edge of an offshore reef found near [x, north] within r: a reef cell 1-7 m deep, then deep water beside it
    let best = pt.at && at(pt.at) ? { x: at(pt.at)[0], n: at(pt.at)[1] } : null;
    if (!best && pt.search) {
      const [cx, cn, R] = pt.search;
      for (let dx = -R; dx <= R; dx += 60) for (let dn = -R; dn <= R; dn += 60) {
        const x = cx + dx, n = cn + dn;
        if (ctx.habitat(x, n) !== 2) continue;
        const d = ctx.depth(x, n); if (d < 1.0 || d > 7) continue;
        const sc = Math.hypot(dx, dn); if (!best || sc < best.sc) best = { x, n, sc };
      }
    }
    if (best) {
      // exact: on its mapped position (Reefworld sits on the top of a wall that drops from 7 to 32 m within 60 m);
      // otherwise the nearest water 9-18 m deep
      const p = pt.exact ? [best.x, best.n] : (nav.anchorage(best.x, best.n, 9, 18, 900, 20) || [best.x, best.n]);
      const pd = buildPontoon(), hd = buildHelipad();
      const hdg = (pt.heading ?? 20) * dtr;
      pontoon = add('pontoon', pt.name || 'Reef pontoon', pd, { x: p[0], z: -p[1], hdg, mode: 'static' });
      const toLocal = (lx, lz) => { const c = Math.cos(hdg), s = Math.sin(hdg); return [pontoon.x + lx * s + lz * c, pontoon.z - lx * c + lz * s]; };
      const hp = toLocal(-23, 0);
      helipad = add('helipad', 'Reef helipad', hd, { x: hp[0], z: hp[1], hdg, mode: 'static' }); pads.push(helipad);
      const sp = toLocal(6, -(5.5 + 0.7 + 1.5 + 0.6));
      seaplane = add('seaplane', 'Reef Air amphibian', buildSeaplane(), { x: sp[0], z: sp[1], hdg, mode: 'docked' });
      helicopter = add('helicopter', 'Scenic helicopter', buildHeli(), { x: hp[0], z: hp[1], hdg, mode: 'static' });
      helicopter.pad = helipad; helicopter.air = helipad.y + 0.46;
      const bp = toLocal(0, 5.5 + 0.7 + 4.5);
      berthDay = add('daycat', pt.boat || 'Reef Explorer', buildDayCat(), { x: bp[0], z: bp[1], hdg, mode: 'docked' });
      pontoon.berthWorld = bp;
      // moorings around the pontoon reef (dive sites)
      // on the berth side (the deep water the boats come in over), up and down the reef edge from the pontoon
      const bdx = bp[0] - pontoon.x, bdn = -(bp[1] - pontoon.z), bl = Math.hypot(bdx, bdn) || 1, ux = bdx / bl, un = bdn / bl;
      for (const [o, s] of [[220, 180], [260, -220]]) { const dx = ux * o - un * s, dn = un * o + ux * s; const m = nav.anchorage(p[0] + dx, p[1] + dn, 6, 45, 400, 15); if (m) { const mo = add('mooring', `Mooring ${moorings.length + 1}`, buildMooring(ctx.depth(m[0], m[1])), { x: m[0], z: -m[1], hdg: 0, mode: 'static' }); moorings.push(mo); pontoonMoorings.push(mo); } }
    }
  }
  // ---- aircraft parked away from a pontoon: a helicopter on a land pad, a seaplane on its mooring ----
  for (const a of H.parked || []) {
    const p = at(a.at); if (!p) continue;
    if (a.kind === 'helicopter' && !helicopter) {
      helicopter = add('helicopter', a.name || 'Scenic helicopter', buildHeli(), { x: p[0], z: -p[1], hdg: (a.heading ?? 0) * dtr, mode: 'static' });
      helicopter.groundY = Math.max(ctx.height(p[0], p[1]), env.u.tide.value + 0.4); helicopter.air = helicopter.groundY;
    } else if (a.kind === 'seaplane' && !seaplane) {
      const m = nav.anchorage(p[0], p[1], 2.5, 8, 600, 20, avoid) || p; avoid.push([m[0], m[1], 40]);
      seaplane = add('seaplane', a.name || 'Reef Air amphibian', buildSeaplane(), { x: m[0], z: -m[1], hdg: (a.heading ?? 135) * dtr, mode: 'docked' });
    }
  }
  // ---- GBRMPA-style public moorings at reef edges around the model ----
  {
    const taken = pontoon ? [[pontoon.x, -pontoon.z, 800]] : [];
    const cands = [], S = ctx.S.terrain, X0 = S.x0, X1 = S.x0 + S.w * S.cell_m, Y1 = S.y1, Y0 = S.y1 - S.h * S.cell_m;
    for (let x = X0 + 1500; x < X1 - 1500; x += 90) for (let n = Y0 + 1500; n < Y1 - 1500; n += 90) {
      if (ctx.habitat(x, n) !== 2) continue; const d = ctx.depth(x, n); if (d < 2 || d > 8) continue; cands.push([x, n]);
    }
    for (let i = 0; i < (H.moorings ?? 8) && cands.length; i++) {
      const c = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
      if (taken.some(t => Math.hypot(t[0] - c[0], t[1] - c[1]) < 1800)) { i--; if (cands.length < 5) break; continue; }
      const m = nav.anchorage(c[0], c[1], 7, 16, 400, 20, []); if (!m) continue;
      taken.push([m[0], m[1], 400]);
      moorings.push(add('mooring', `Mooring ${moorings.length + 1}`, buildMooring(ctx.depth(m[0], m[1])), { x: m[0], z: -m[1], hdg: rnd() * 6, mode: 'static' }));
    }
  }

  // ---- AI traffic ----
  const chain = (...pts) => { const out = []; for (let i = 0; i < pts.length - 1; i++) { const r = nav.route(pts[i], pts[i + 1]); if (!r) return null; out.push(...(i ? r.slice(1) : r)); } return out; };
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
  const make = (kind, name) => kind === 'daycat' ? add('daycat', name || 'Day cruiser', buildDayCat(), { mode: 'ai' }) : kind === 'cat' ? cat({ mode: 'ai' })
    : kind === 'tinnie' ? tinnie(name || 'Tinnie', { mode: 'ai' }) : yacht({ mode: 'ai' });
  for (const r of H.traffic || []) {
    const pts = r.route.map(spot); if (pts.some(p => !p)) continue;
    const v = make(r.kind, r.name); if (r.name && r.kind !== 'tinnie' && r.kind !== 'daycat') v.name = r.name;
    traffic(v, chain(...pts), { loop: r.loop || 'pingpong', dwell: r.dwell ?? 40, vmax: r.vmax, hide: false });
  }
  // the pontoon's own day boat circulates between the pontoon, the moorings and back
  if (pontoon && pontoonMoorings.length) {
    const pp = [pontoon.berthWorld[0], -pontoon.berthWorld[1]];          // off the pontoon's berth side, over the deep water
    const pr = nav.snap(pp[0], pp[1]) || pp;
    const stops = [pr, ...pontoonMoorings.map(m => [m.x, -m.z])];
    traffic(add('daycat', pt.looper || 'Reef shuttle', buildDayCat(), { mode: 'ai' }), chain(...stops, pr), { loop: 'repeat', dwell: 30, vmax: 9 });
  }
  // aircraft on scenic loops
  const aero = [];
  function orbiter(kind, name, desc, cx, cn, r, alt, v, dir = 1) {
    const a = add(kind, name, desc, { mode: 'orbit' });
    a.orbit = { cx, cn, r, alt, v, dir, th: rnd() * 6.28 };
    a.propRpm = kind === 'seaplane' ? 60 : 40;
    aero.push(a); return a;
  }
  for (const s of H.scenic || []) {
    const c = at(s.around); if (!c) continue;
    const desc = s.kind === 'helicopter' ? buildHeli({ livery: 0xc23a1c }) : buildSeaplane({ livery: 0xc23a1c });
    orbiter(s.kind, s.name, desc, c[0] + (s.dx || 0), c[1] + (s.dy || 0), s.r, s.alt, s.v, s.dir ?? 1);
  }

  // initial state for sails of anchored yachts: furled
  for (const v of vessels) { v.snapSails(); }

  // ---- decks the player can stand on: the pontoon, its helipad and the marina jetty (ctx.decks; player.js) ----
  // deckAt(x, north) -> the deck's height (m) at that point, or null
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3();
  const localOf = (obj, x, y, north) => { obj.updateMatrix(); _m.copy(obj.matrix).invert(); return _p.set(x, y, -north).applyMatrix4(_m); };
  const worldY = (obj, lx, ly, lz) => _p.set(lx, ly, lz).applyMatrix4(obj.matrix).y;
  function deckAt(x, north) {
    let best = null;
    const take = y => { if (best === null || y > best) best = y; };
    if (pontoon && Math.hypot(pontoon.x - x, -pontoon.z - north) < 20) {
      const l = localOf(pontoon.root, x, pontoon.y, north);
      if (Math.abs(l.x) < 14.6 && Math.abs(l.z) < 5.1) take(worldY(pontoon.root, l.x, 0.55, l.z));
    }
    for (const p of pads) if (Math.hypot(p.x - x, -p.z - north) < 8) {
      const l = localOf(p.root, x, p.y, north);
      if (l.x * l.x + l.z * l.z < 49) take(worldY(p.root, l.x, 0.46, l.z));
    }
    if (jetty) {
      const g = jetty.group, l = localOf(g, x, g.position.y, north), w = jetty.w;
      if (l.x > -0.5 && l.x < jetty.len && Math.abs(l.z) < w / 2) take(g.position.y + 1.77);
      for (const fx of jetty.fingers) if (Math.abs(l.x - fx) < 0.65 && l.z > w / 2 + 0.2 && l.z < w / 2 + 12.2) take(g.position.y + 0.4);
    }
    return best;
  }
  if (ctx.decks) ctx.decks.push(deckAt);

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
        const fc = vec3(0.93, 0.96, 0.97).mul(env.u.white.mul(0.95));
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
        if (v.kind === 'helicopter') { v.y = (v.mode === 'static' ? (v.pad ? v.pad.y + 0.46 : v.groundY ?? v.y) : v.y); v.place(); }
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
  const API = { update, vessels, board, leave, wake, byName, deckAt, seaplane: seaplaneApi, helicopter: helicopterApi, nav, surfaceAt: surf.surfaceAt, wakeNode: wake.wakeNode, windInfo: wind, pads, jetty, pontoon, moorings, hooked };
  API.ctx = ctx; API.initMs = Math.round(performance.now() - tInit);
  window.__boats = ctx.boats = API;
  return API;
}
