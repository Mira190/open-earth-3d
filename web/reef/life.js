// Life on and around the reef: corals, clams, anemones, seagrass and rubble on the habitat map; fish,
// turtles, rays, sharks and the odd manta; the islands' trees; plankton; and the coral spawning after
// the October/November full moon. Loaded by main.js as a module:
//   export async function init(ctx) -> ctx.life = { update, species, nearestCreature, counts, spawning, ... }
//
// Everything is seeded from the tile or cell it lives in, so the same reef, trees and animals are in
// the same places on every load; only what is near the camera is instanced and only animals within
// ~120 m are simulated. Placement reads the real data: ctx.habitat (10 m classes), ctx.depth / the
// 30 m survey grid (read bicubically, as shore.js draws it), the wave bank (surge) and the sun and moon.
//
// API (on ctx.life, also window.__life):
//   species                 [{ id, common, scientific, group, depth: [min, max] m, facts: [{ text, source }] }]
//                           group: fish | shark | ray | turtle | clam | coral | anemone | seagrass | tree;
//                           depth is negative for land plants (metres above the sea)
//   byId(id)                one species record
//   nearestCreature(x, north, up, maxDist = 12) -> { species, id, position: Vector3 (scene), distance } | null
//                           animals only (fish, shark, ray, turtle, clam); local frame in, scene position out
//   counts()                { [speciesId]: n } instanced right now (corals and trees by colony / tree)
//   spawning                { active, nightsAfterFullMoon, fullMoon: Date, window: [first, last] nights }
//   animals                 the simulated animals near the camera: { sp, id, x, y, z (scene), yaw, speed, ... }
//   stats()                 draw calls, instances and triangles of this module's herds
// Query: life=0 skips the module; lifeinfo=1 logs counts; spawn=1 forces the spawning on (for tests).
import * as THREE from 'three/webgpu';
import { makeGround, makeTorch } from './life/kit.js';
import { createMats } from './life/mats.js';
import { createReef, KINDS } from './life/reef.js';
import { createFauna } from './life/fauna.js';
import { createFlora, TREES } from './life/flora.js';
import { createDrift } from './life/drift.js';
import { SPECIES } from './life/species.js';

export async function init(ctx) {
  const { scene, camera, env, q } = ctx;
  if (q.get('life') === '0') return null;
  const t0 = performance.now();
  const ground = makeGround(ctx.d);
  const torch = makeTorch(env);
  const mats = createMats(env, torch);
  const root = new THREE.Group(); root.name = 'life';
  scene.add(root);

  const reef = createReef(ctx, ground, mats);
  root.add(reef.group);
  const fauna = createFauna(ctx, ground, mats, reef);
  root.add(fauna.group);
  const flora = createFlora(ctx, ground, mats);
  root.add(flora.group);
  const drift = createDrift(ctx, torch, reef, ground);
  root.add(drift.group);

  // ---- the model's clock (as player.js keeps it) and the coral spawning
  // Inshore reefs of the central GBR spawn in the week after the October full moon; when that full moon
  // falls in the first half of October the spawning is split, with a second period a lunar month later
  // (Willis et al. 1985, researchonline.jcu.edu.au/24208). The moon's age is env.js's own (setSun).
  const whenMs = q.get('time') ? Date.parse(q.get('time')) : Date.now(), tClock = performance.now();
  const nowMs = () => ctx.clockMs ? ctx.clockMs() : whenMs + (performance.now() - tClock);   // main.js keeps the model clock
  const SYN = 29.530588, lat = ctx.S.origin[1], lon = ctx.S.origin[0], tz = ctx.S.timezone;
  const moonAge = ms => { const JD = ms / 86400000 + 2440587.5; return ((JD - 2451550.1) / SYN % 1 + 1) % 1; };
  const local = ms => window.Sun.utcToLocal(ms, tz);
  const dayNo = l => Date.UTC(l.y, l.m - 1, l.d) / 86400000;
  const spawning = { active: false, nightsAfterFullMoon: null, fullMoon: null, window: [1, 7], split: false, dark: false };
  function spawnState(ms, age = moonAge(ms)) {
    const sinceFull = ((age - 0.5 + 1) % 1) * SYN, full = ms - sinceFull * 86400000;
    const lf = local(full), ln = local(ms - 12 * 3600e3);          // the night belongs to the evening it began on
    const nights = Math.round(dayNo(ln) - dayNo(lf));
    // October full moon, or November when October's fell in the first half of the month (split spawning)
    const prevFull = local(full - SYN * 86400000);
    const season = lf.m === 10 || (lf.m === 11 && prevFull.m === 10 && prevFull.d <= 15);
    const sunAlt = window.Sun.position(ms, lat, lon).altitude, hr = local(ms).minutes / 60;
    const dark = sunAlt < -6 && (hr >= 18 || hr < 2);
    return { active: q.get('spawn') === '1' || (season && nights >= spawning.window[0] && nights <= spawning.window[1] && dark),
      nightsAfterFullMoon: nights, fullMoon: new Date(full), window: spawning.window, split: lf.m === 11 && season, dark };
  }
  // the moon's age as env.js computed it for the model clock (ctx.sun, refreshed every 2 s), else the same formula here
  const spawnNow = () => { const ms = nowMs(); return spawnState(ms, ctx.sun && ctx.sun.moonAge !== undefined ? ctx.sun.moonAge : moonAge(ms)); };
  Object.assign(spawning, spawnNow());
  let spawnT = 0;

  const byId = id => SPECIES.find(s => s.id === id) || null;
  const fwd = new THREE.Vector3();
  let first = true;
  function update(dt, t) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    const cam = camera.position;
    const under = cam.y < env.u.tide.value - 0.05;
    camera.getWorldDirection(fwd); torch.fwd.value.copy(fwd);
    torch.on.value = under ? env.u.night.value : 0;
    reef.update(cam, first);
    fauna.update(dt, t, cam, env.u.night.value, first);
    flora.update(cam, first);
    if ((spawnT -= dt) < 0) { spawnT = 5; Object.assign(spawning, spawnNow()); }
    drift.update(cam, spawning.active && under, dt);
    first = false;
  }

  // test hook: ?lifecam=<species id>[,dist] puts the fly camera next to the nearest one of them
  let lifecam = q.get('lifecam');
  function lookAt(spec) {
    const [sp, dd] = spec.split(','), d0 = Number(dd || 2.5), c = camera.position;
    let best = null, bd = 1e18;
    for (const a of fauna.animals) { if (a.sp !== sp) continue; const d = (a.x - c.x) ** 2 + (a.z - c.z) ** 2; if (d < bd) { bd = d; best = a; } }
    lifecam = null;
    if (!best) { console.warn('[life] lifecam: no', sp, 'near the camera'); return; }
    const side = best.yaw + Math.PI / 2;
    c.set(best.x + Math.cos(side) * d0, 0, best.z - Math.sin(side) * d0);
    c.y = Math.min(Math.max(best.y + 0.12 * d0, ground.height(c.x, -c.z) + 0.45), env.u.tide.value - 0.3);
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
    for (const k of Object.keys(TREES)) out[k] = flora.counts[k] || 0;
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
  function nearestCreature(x, north, up, maxDist = 12) {
    const px = x, py = up, pz = -north;
    let best = null, bd = maxDist * maxDist;
    for (const a of fauna.animals) {
      if (a.sp === 'manta' && !fauna.mantaVisiting) continue;
      const d = (a.x - px) ** 2 + (a.y - py) ** 2 + (a.z - pz) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    for (const t of reef.active()) {
      if (!t.clams.length || t.dist > maxDist + 50) continue;
      for (const c of t.clams) { const d = (c.x - px) ** 2 + (c.y - py) ** 2 + (c.z - pz) ** 2; if (d < bd) { bd = d; best = { sp: 'giant-clam', id: c.id, x: c.x, y: c.y + 0.15 * c.s, z: c.z }; } }
    }
    if (!best) return null;
    return { species: byId(best.sp), id: best.id, position: new THREE.Vector3(best.x, best.y, best.z), distance: Math.sqrt(bd) };
  }

  const life = { update, species: SPECIES, byId, nearestCreature, counts, stats, root, reef, fauna, flora, drift, ground, animals: fauna.animals,
    spawning, spawnState, nowMs };
  ctx.life = life; window.__life = life;
  update(0, 0);
  if (lifecam) lookAt(lifecam);
  // build every herd's shader now rather than when the first of a kind swims into view
  try { await ctx.renderer.compileAsync(root, camera, scene); } catch (e) { console.warn('[life] compile', e); }
  if (q.get('lifeinfo')) console.log('[life] init', (performance.now() - t0).toFixed(0), 'ms', JSON.stringify(counts()), JSON.stringify(stats()));
  return life;
}
