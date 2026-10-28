// Life on and around the reef: corals, clams, anemones, seagrass and rubble on the habitat map; fish,
// turtles, rays, sharks and mantas; the islands' plants; turtles nesting on the beach in season; plankton;
// and the coral spawning after the October/November full moon. Loaded by main.js as a module:
//   export async function init(ctx) -> ctx.life = { update, species, nearestCreature, counts, spawning, ... }
//
// Everything is seeded from the tile or cell it lives in, so the same reef, trees and animals are in
// the same places on every load; only what is near the camera is instanced and only animals within
// ~120 m are simulated. Placement reads the real data: ctx.habitat (10 m classes), the 30 m survey grid
// (read bicubically, as shore.js draws it) by depth below mean sea level (so the reef does not move with
// the tide), the wave bank (surge), the sun and the moon. What lives at a site (its plants, which animals are
// common, turtle nesting, the spawning month) is the `life` block of cities/<id>/city.json, which
// pipeline/marine_meta.py copies into scene.json; without one a site gets the Whitsundays' (life/profile.js).
// Files: life/kit.js (instancing, ground, torch), profile.js, geo.js (procedural shapes), mats.js (TSL
// materials), reef.js, fauna.js, flora.js, drift.js, species.js. Under water at night the core's dive torch
// (env.torch; kit.js makeTorch otherwise) lights this module's things.
//
// API (on ctx.life, also window.__life):
//   species                 [{ id, common, scientific, group, depth: [min, max] m, facts: [{ text, source }] }] of this
//                           site: the reef's, the plants it has, loggerheads where they occur; facts about other
//                           sites are left out. group: fish | shark | ray | turtle | clam | coral | anemone |
//                           seagrass | tree; depth is negative for land plants (metres above the sea)
//   profile                 the site's resolved profile (profile.js)
//   byId(id)                one species record
//   nearestCreature(x, north, up, maxDist = 12, minWater = 0) -> { species, id, position: Vector3 (scene), distance } | null
//                           animals only (fish, shark, ray, turtle, giant clam); local frame in, scene position out;
//                           ids are stable across loads (e.g. 'parrotfish-39_42_0', 'giant-clam-39_42_3'); minWater (m) skips
//                           creatures in shallower water (a drying reef flat at low tide); fish leave a flat as it dries
//   counts()                { [speciesId]: n } instanced right now (corals and trees by colony / tree; plus
//                           'trees-far', 'plankton', 'spawn-bundles')
//   spawning                { active, nightsAfterFullMoon, fullMoon: Date, window: [first, last] nights, lag, split, dark }
//   animals                 the simulated animals near the camera: { sp, id, x, y, z (scene), yaw, speed, len, ... }
//   stats()                 { calls, instances, triangles } of this module's herds
// Query: life=0 skips the module; lifeinfo=1 logs counts; spawn=1 forces the spawning on;
//   lifecam=<species>[,dist][,elev][,azim] puts the fly camera beside the nearest one (screenshots).
import * as THREE from 'three/webgpu';
import { makeGround, makeTorch } from './life/kit.js';
import { createMats } from './life/mats.js';
import { createReef, KINDS } from './life/reef.js';
import { createFauna } from './life/fauna.js';
import { createFlora, TREES } from './life/flora.js';
import { createDrift } from './life/drift.js';
import { SPECIES } from './life/species.js';
import { siteProfile } from './life/profile.js';

export async function init(ctx) {
  const { scene, camera, env, q } = ctx;
  if (q.get('life') === '0') return null;
  const t0 = performance.now();
  const ground = makeGround(ctx.d);
  const torch = env.torch || makeTorch(env);              // the core's torch (env.js) when there is one, so the floor is lit too
  const mats = createMats(env, torch);
  const root = new THREE.Group(); root.name = 'life';
  scene.add(root);

  // what lives at this site: cities/<id>/city.json "life", via scene.json (the Whitsundays' by default)
  const profile = siteProfile(ctx.S);
  const reef = createReef(ctx, ground, mats);
  root.add(reef.group);
  const fauna = createFauna(ctx, ground, mats, reef, profile);
  root.add(fauna.group);
  const flora = createFlora(ctx, ground, mats, profile);
  root.add(flora.group);
  const drift = createDrift(ctx, torch, reef, ground);
  root.add(drift.group);

  // ---- the model's clock (as player.js keeps it) and the coral spawning
  // Inshore reefs of the central GBR spawn in the week after the October full moon; when that full moon
  // falls in the first half of October the spawning is split, with a second period a lunar month later;
  // offshore reefs spawn exactly one lunar month after the inshore ones (Willis et al. 1985,
  // researchonline.jcu.edu.au/24208). A site's profile gives the lag in lunations and the nights after the
  // full moon (spawning.lag, spawning.window). The moon's age is env.js's own (setSun).
  const whenMs = q.get('time') ? Date.parse(q.get('time')) : Date.now(), tClock = performance.now();
  const nowMs = () => ctx.clockMs ? ctx.clockMs() : whenMs + (performance.now() - tClock);   // main.js keeps the model clock
  const SYN = 29.530588, lat = ctx.S.origin[1], lon = ctx.S.origin[0], tz = ctx.S.timezone;
  const moonAge = ms => { const JD = ms / 86400000 + 2440587.5; return ((JD - 2451550.1) / SYN % 1 + 1) % 1; };
  const local = ms => window.Sun.utcToLocal(ms, tz);
  const dayNo = l => Date.UTC(l.y, l.m - 1, l.d) / 86400000;
  const lag = profile.spawning.lag || 0, win = profile.spawning.window || [1, 7];
  const spawning = { active: false, nightsAfterFullMoon: null, fullMoon: null, window: win, lag, split: false, dark: false };
  function spawnState(ms, age = moonAge(ms)) {
    const sinceFull = ((age - 0.5 + 1) % 1) * SYN, full = ms - sinceFull * 86400000;
    const lf = local(full), ln = local(ms - 12 * 3600e3);          // the night belongs to the evening it began on
    const nights = Math.round(dayNo(ln) - dayNo(lf));
    // the inshore reefs' full moon is October's, or November's when October's fell in the first half of the month
    // (split spawning); `lag` lunations later for this site
    const f0 = local(full - lag * SYN * 86400000), prevFull = local(full - (lag + 1) * SYN * 86400000);
    const season = f0.m === 10 || (f0.m === 11 && prevFull.m === 10 && prevFull.d <= 15);
    const sunAlt = window.Sun.position(ms, lat, lon).altitude, hr = local(ms).minutes / 60;
    const dark = sunAlt < -6 && (hr >= 18 || hr < 2);
    return { active: q.get('spawn') === '1' || (season && nights >= spawning.window[0] && nights <= spawning.window[1] && dark),
      nightsAfterFullMoon: nights, fullMoon: new Date(full), window: win, lag, split: f0.m === 11 && season, dark };
  }
  // the moon's age as env.js computed it for the model clock (ctx.sun, refreshed every 2 s), else the same formula here
  const spawnNow = () => { const ms = nowMs(); return spawnState(ms, ctx.sun && ctx.sun.moonAge !== undefined ? ctx.sun.moonAge : moonAge(ms)); };
  Object.assign(spawning, spawnNow());
  let spawnT = 0;

  // the species of this site: the reef's for every site, the land plants this site has, and loggerheads where they occur
  const marine = new Set(['fish', 'shark', 'ray', 'turtle', 'clam', 'coral', 'anemone', 'seagrass']);
  const species = SPECIES.filter(s => s.id === 'loggerhead' ? !!(profile.fauna.loggerhead || (profile.nesting && profile.nesting.species && profile.nesting.species.loggerhead))
    : marine.has(s.group) || profile.used.has(s.id))
    .map(s => Object.assign({}, s, { facts: s.facts.filter(f => !f.site || f.site === ctx.S.id) }));
  const byId = id => species.find(s => s.id === id) || SPECIES.find(s => s.id === id) || null;
  const fwd = new THREE.Vector3(), lastCam = new THREE.Vector3(1e9, 0, 0);
  let first = true;
  function update(dt, t) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    const cam = camera.position;
    // a jump (teleport, a new view) is handled like the first frame: everything around the new spot at once
    if (lastCam.distanceToSquared(cam) > 80 * 80) first = true;
    lastCam.copy(cam);
    const under = cam.y < env.u.tide.value - 0.05;
    camera.getWorldDirection(fwd); torch.fwd.value.copy(fwd);
    torch.on.value = under ? env.u.night.value : 0;
    reef.update(cam, first);
    fauna.update(dt, t, cam, env.u.night.value, first);
    flora.update(cam, first);
    if ((spawnT -= dt) < 0) { spawnT = 5; Object.assign(spawning, spawnNow()); }
    drift.update(cam, spawning.active && under, dt);
    first = false;
    for (const m of herds) m.visible = m.geometry.instanceCount > 0;     // an empty herd costs no draw call
  }

  // test hook: ?lifecam=<species id>[,dist m][,elevation deg][,azimuth deg from its side] puts the fly camera by the nearest one
  let lifecam = q.get('lifecam');
  function lookAt(spec) {
    const [sp, dd, el, az] = spec.split(','), d0 = Number(dd || 2.5), e0 = Number(el || 7) * Math.PI / 180, c = camera.position;
    let best = null, bd = 1e18;
    for (const a of fauna.animals) { if (a.sp !== sp || a.hidden) continue; const d = (a.x - c.x) ** 2 + (a.z - c.z) ** 2; if (d < bd) { bd = d; best = a; } }
    lifecam = null;
    if (!best) { console.warn('[life] lifecam: no', sp, 'near the camera'); return; }
    const side = best.yaw + Math.PI / 2 + Number(az || 0) * Math.PI / 180, h0 = Math.cos(e0) * d0;
    c.set(best.x + Math.cos(side) * h0, 0, best.z - Math.sin(side) * h0);
    const top = best.y < env.u.tide.value && !best.id.includes('-nest-') ? env.u.tide.value - 0.3 : 1e9;      // under water for a fish, in the air for a turtle on the beach
    c.y = Math.min(Math.max(best.y + Math.sin(e0) * d0, ground.land(c.x, -c.z, env.u.dryLine.value) + 0.45), top);
    const dx = best.x - c.x, dy = best.y - c.y, dz = best.z - c.z, L = Math.hypot(dx, dy, dz);
    // hold the view with a controller (a test camera: the fly keys are off while it is set; the player module replaces it)
    const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(dy / L), e = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(e);
    if (!ctx.controller) ctx.controller = { update() { camera.quaternion.setFromEuler(e); } };
    first = true; update(0, 0);            // everything again around the new spot, before the first frame
  }
  function counts() {
    const out = {};
    for (const [k, K] of Object.entries(KINDS)) if (K.sp) out[K.sp] = (out[K.sp] || 0) + (reef.counts[k] || 0);
    for (const [k, n] of Object.entries(fauna.counts)) out[k] = n;
    for (const k of flora.ids) out[k] = flora.counts[k] || 0;
    out['trees-far'] = flora.counts.far || 0;
    const dc = drift.counts(); out.plankton = dc.plankton; out['spawn-bundles'] = dc.bundles;
    return out;
  }
  function stats() {
    let calls = 0, inst = 0, tris = 0;
    root.traverse(o => { if (o.isMesh && o.geometry.instanceCount) { calls++; inst += o.geometry.instanceCount; tris += o.geometry.instanceCount * (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    return { calls, instances: inst, triangles: Math.round(tris) };
  }
  // the animal nearest to a point (local frame), for a fish survey; giant clams count, corals do not
  // minWater (optional): only creatures with at least this much water above the floor where they are (a swimmable spot)
  function nearestCreature(x, north, up, maxDist = 12, minWater = 0) {
    const px = x, py = up, pz = -north, tide = env.u.tide.value;
    let best = null, bd = maxDist * maxDist;
    const deep = (ax, az) => !minWater || tide - ground.height(ax, -az) >= minWater;
    for (const a of fauna.animals) {
      if (a.hidden || (a.sp === 'manta' && !fauna.mantaVisiting)) continue;
      if (minWater && !deep(a.x, a.z)) continue;
      const d = (a.x - px) ** 2 + (a.y - py) ** 2 + (a.z - pz) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    for (const t of reef.active()) {
      if (!t.clams.length || t.dist > maxDist + 50) continue;
      for (const c of t.clams) { const d = (c.x - px) ** 2 + (c.y - py) ** 2 + (c.z - pz) ** 2; if (d < bd && deep(c.x, c.z)) { bd = d; best = { sp: 'giant-clam', id: c.id, x: c.x, y: c.y + 0.15 * c.s, z: c.z }; } }
    }
    if (!best) return null;
    return { species: byId(best.sp), id: best.id, position: new THREE.Vector3(best.x, best.y, best.z), distance: Math.sqrt(bd) };
  }

  const herds = []; root.traverse(o => { if (o.isMesh && o.geometry.instanceCount !== undefined) herds.push(o); });
  const life = { update, species, profile, byId, nearestCreature, counts, stats, root, reef, fauna, flora, drift, ground, animals: fauna.animals,
    spawning, spawnState, nowMs };
  ctx.life = life; window.__life = life;
  update(0, 0);
  if (lifecam) lookAt(lifecam);
  // build every herd's shader now rather than when the first of a kind swims into view
  try { await ctx.renderer.compileAsync(root, camera, scene); } catch (e) { console.warn('[life] compile', e); }
  if (q.get('lifeinfo')) console.log('[life] init', (performance.now() - t0).toFixed(0), 'ms', JSON.stringify(counts()), JSON.stringify(stats()));
  return life;
}
