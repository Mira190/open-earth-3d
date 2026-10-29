import * as THREE from 'three/webgpu';
import { loadScene, createTerrain, heightTexture, terrainHeight, waterBed, habitatAt } from './world.js';
import { makeWaves, createEnv, setSun } from './env.js';
import { createOcean } from './ocean.js';
import { createShore } from './shore.js';
import { createPost } from './post.js';
import { createRipples } from './ripples.js';
import { loadTide } from './tide.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const CITY = q.get('city') || 'whitsundays';
const fail = e => { console.error(e); $('err').textContent = String(e && e.stack || e); };
addEventListener('error', e => fail(e.error || e.message));
addEventListener('unhandledrejection', e => fail(e.reason));

async function main() {
  const base = `../data/${CITY}/`;
  const [d, tide] = await Promise.all([loadScene(base), loadTide(base)]);
  const S = d.scene;
  document.title = `Open Earth 3D: ${S.name}`;
  $('load-title').textContent = S.name;
  window.Sun.site({ lat: S.origin[1], lon: S.origin[0], tz: S.timezone });

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.get('gl') === '1' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(q.get('exp') || 1.0);
  document.body.prepend(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 90000);
  const windDir = Number(q.get('wind_dir') || 125);
  const waves = makeWaves(windDir);
  const ripples = createRipples(renderer, windDir);
  // the wind chop's normals at range: a coarser tile with the chop's slope variance, so distant water is
  // broadband instead of the interference stripes of the nine chop waves that move the surface
  const chopVar = waves.filter(w => w.disp && w.lam < 20).reduce((a, w) => a + (w.a * w.k) ** 2 / 2, 0);
  const chop = createRipples(renderer, windDir, { tile: 192, res: 256, lam: [3, 24], spread: 70, target: chopVar, seed: 23, hess: false });
  const env = createEnv(scene, S.optics, waves, ripples, chop);
  env.u.wind.value = Number(q.get('wind') ?? 0.6);
  // the clock: the model's own time (?time= or now), running on from the page load, or from a time chosen in the
  // game's time panel (setClock below)
  let when = q.get('time') ? Date.parse(q.get('time')) : Date.now(), perf0 = performance.now(), live = !q.get('time');
  const clockMs = () => when + (performance.now() - perf0);
  // the tide: ?tide= fixes it (m about MSL); otherwise the site's predicted tide for the clock (tide.js)
  const tideFixed = q.get('tide') !== null ? Number(q.get('tide')) : null;
  const tideNow = () => tideFixed ?? (tide ? tide.at(clockMs()) : 0);
  env.u.tide.value = tideNow();
  env.u.dryLine.value = tide ? Math.max(...tide.check.map(c => c.high_m)) : 0;

  const sunL = new THREE.DirectionalLight(0xfff2dd, 2.8);
  const moonL = new THREE.DirectionalLight(0xc9d6ff, 0);
  const hemi = new THREE.HemisphereLight(0x9cc4ff, 0xd9c9a0, 0.9);
  scene.add(sunL, sunL.target, moonL, moonL.target, hemi);
  scene.fogNode = (({ Fn, vec4, output, positionWorld }) => Fn(() => vec4(env.medium(output.rgb, positionWorld), output.a))())(await import('three/tsl'));

  const hTex = heightTexture(d);
  const terrain = createTerrain(d, env, renderer);
  scene.add(terrain.group);
  const ocean = createOcean(d, env, hTex);
  scene.add(ocean.mesh);
  const shore = createShore(d, env, heightTexture(d, d.heights), terrain);   // the ground's own heights, hollows and all
  scene.add(shore.mesh);

  // sky dome
  const { Fn, vec3, vec4, positionWorld, cameraPosition, normalize } = await import('three/tsl');
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMat.fog = false;
  skyMat.colorNode = Fn(() => env.sky(normalize(positionWorld.sub(cameraPosition))))();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), skyMat);
  dome.frustumCulled = false; dome.renderOrder = -1;
  scene.add(dome);

  // ---- light, in the units where the overhead sun is 2.8: the sun, the moon and the sky, each in its true
  // proportion, and an eye that adapts to them. The adaptation scales the light itself (so the frame stays in a
  // range half floats hold well), and display-referred things (lamps, the moon's disc, stars, speech) need nothing
  // the sky's own light on a horizontal surface, relative to a clear day's, through twilight to starlight
  // (horizontal illuminance about 10 000 lux of skylight by day, a few lux at the end of civil twilight, 0.002 lux on a moonless night)
  const SKY = [[-18, 2e-7], [-12, 1.2e-6], [-6, 3e-4], [0, 0.08], [10, 1]];
  const skyLight = deg => {
    if (deg >= 10) return 1; if (deg <= -18) return 2e-7;
    for (let i = 1; i < SKY.length; i++) if (deg <= SKY[i][0]) { const [a, la] = SKY[i - 1], [b, lb] = SKY[i]; return la * Math.pow(lb / la, (deg - a) / (b - a)); }
    return 1;
  };
  // the full moon at the zenith gives about 2.3e-6 of the sun's illuminance; away from full it fades faster than its
  // lit fraction (Allen: m = -12.73 + 0.026 |phase| + 4e-9 phase^4)
  const moonRel = age => { const ph = Math.abs(180 - age * 360); return 2.3e-6 * Math.pow(10, -0.4 * (0.026 * ph + 4e-9 * ph ** 4)); };
  // how bright a white horizontal surface is shown, by log10 of its true radiance (a clear day is about 1.1)
  const SEEN = [[-7.5, 0.012], [-6.2, 0.07], [-4, 0.09], [-1, 0.1]];
  const seen = x => {
    if (x >= -1) return Math.pow(10, x); if (x <= SEEN[0][0]) return SEEN[0][1];
    for (let i = 1; i < SEEN.length; i++) if (x <= SEEN[i][0]) { const [a, la] = SEEN[i - 1], [b, lb] = SEEN[i]; return la * Math.pow(lb / la, (x - a) / (b - a)); }
    return 0.1;
  };
  const baseExp = Number(q.get('exp') || 1.0);
  let adapt = 1;
  renderer.toneMappingExposure = baseExp;
  function lights(sun) {
    const sa = Math.sin(sun.alt), sm = Math.max(Math.sin(sun.moonAlt), 0), deg = sun.alt * 180 / Math.PI;
    const sunI = 2.8 * Math.max(Math.min(1, sa * 3), 0);
    const moonI = 2.8 * moonRel(sun.moonAge) * smoothUp(sun.moonAlt);
    const hemiI = 0.9 * skyLight(deg) + 0.34 * moonI * sm;
    const white = (sunI * Math.max(sa, 0) + moonI * sm + hemiI) / Math.PI;
    // adaptation: none down to sunset light; through dusk the eye holds a white surface near a tenth of its daylight
    // brightness, under the moon a little less, under starlight less again (night stays darker than day, as it looks)
    adapt = Math.min(Math.max(seen(Math.log10(Math.max(white, 1e-10))) / white, 1), 3e5);
    sunL.intensity = sunI * adapt; moonL.intensity = moonI * adapt; hemi.intensity = hemiI * adapt;
    env.u.sunI.value = sunI * adapt; env.u.moonI.value = moonI * adapt;
    env.u.white.value = white * adapt;
    env.u.skyScale.value = skyLight(deg) * adapt;
    env.u.adapt.value = adapt;
    sunL.position.copy(camera.position).addScaledVector(sun.dir, 800);
    sunL.target.position.copy(camera.position);
    moonL.position.copy(camera.position).addScaledVector(env.u.moonDir.value, 800);
    moonL.target.position.copy(camera.position);
  }
  const smoothUp = a => THREE.MathUtils.smoothstep(Math.sin(a), -0.02, 0.05);
  let post = null;
  const sun = setSun(env, when, S.origin[1], S.origin[0]);
  lights(sun);
  let sunT = 0;                                          // the sun and moon follow the model clock (every 2 s)
  // set the model clock to `ms` (UTC), or back to now with null; it runs on in real time from there. The sun, moon,
  // tide, lamps and wildlife all read the clock, so they follow at once. The address keeps ?time= so a reload or
  // a trip to another site comes back to the same time of day
  function setClock(ms) {
    live = ms == null;
    when = live ? Date.now() : ms; perf0 = performance.now();
    Object.assign(sun, setSun(env, clockMs(), S.origin[1], S.origin[0])); sunT = performance.now();
    lights(sun);
    try {
      const p = new URLSearchParams(location.search);
      if (live) p.delete('time'); else p.set('time', new Date(when).toISOString());
      history.replaceState(history.state, '', `${location.pathname}${p.toString() ? '?' + p : ''}${location.hash}`);
    } catch (_) { /* a sandboxed page: the clock still changes */ }
  }

  // camera: local frame (east, north, up) -> three (x, up, -north)
  const st = S.start || {};
  const cx = Number(q.get('x') ?? st.x ?? 0), cy = Number(q.get('y') ?? st.y ?? 0), cz = Number(q.get('z') ?? st.z ?? 60);
  camera.position.set(cx, cz, -cy);
  let yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? st.yaw ?? 0)), pitch = THREE.MathUtils.degToRad(Number(q.get('pitch') ?? st.pitch ?? -15));
  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
  renderer.domElement.addEventListener('pointermove', e => { if (e.buttons) { yaw -= e.movementX * 0.003; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5); } });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  post = q.get('post') === '0' ? null : createPost(renderer, scene, camera, env);

  // modules plug in through a shared context; each exports init(ctx) and may return { update(dt, t) }
  const ctx = { THREE, renderer, scene, camera, env, d, S, q, terrain, ocean, sunL, hemi, sun, updaters: [], controller: null,
    height: (x, north) => terrainHeight(d, x, north),                 // sea-floor / ground elevation, m above datum
    habitat: (x, north) => habitatAt(d, x, north),                    // class under a point, see HABITAT
    depth: (x, north) => env.u.tide.value - waterBed(d, x, north),    // water depth, m (negative on land and in hollows the sea cannot reach)
    toScene: (x, up, north) => new THREE.Vector3(x, up, -north),      // local frame (east, up, north) -> three.js
    decks: [],                                                        // (x, north) -> deck height or null: pontoons, jetties (boats.js)
    clockMs, tide,                                                    // the model clock (ms) and the tide (tide.js: at(ms), turns(ms), rising(ms))
    setClock, clockLive: () => live,                                  // set the clock (UTC ms, or null for now); whether it follows now
    site: S.id, pois: S.pois || [], poi: id => (S.pois || []).find(p => p.id === id) || null };  // points of interest, metres east (x) and north (y)
  for (const name of (q.get('mods') ?? 'life,boats,player,game').split(',').filter(Boolean)) {
    try { const m = await import(`./${name}.js`); const r = await m.init(ctx); if (r && r.update) ctx.updaters.push(r.update); }
    catch (e) { if (!/Failed to fetch|Cannot find|404|Unexpected token '<'/.test(String(e))) fail(e); else console.warn('module', name, 'not available'); }
  }

  let last = performance.now(), frames = 0;
  // ctx for tools that drive the viewer from outside (tools/film/reef-director.js sets ctx.controller and the clock)
  window.__reef = { camera, env, renderer, d, ctx, set(o) { if (o.yaw !== undefined) yaw = o.yaw; if (o.pitch !== undefined) pitch = o.pitch; } };
  const frame = now => {
    const dt = Math.max(Math.min((now - last) / 1000, 0.1), 0); last = now;
    if (!ctx.controller) {
    const sp = (keys.has('ShiftLeft') ? 60 : 12) * (camera.position.y > 200 ? 8 : 1);
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('KeyW')) camera.position.addScaledVector(fwd, sp * dt);
    if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -sp * dt);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, sp * dt);
    if (keys.has('KeyA')) camera.position.addScaledVector(right, -sp * dt);
    if (keys.has('KeyE')) camera.position.y += sp * dt;
    if (keys.has('KeyQ')) camera.position.y -= sp * dt;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    } else ctx.controller.update(dt, now / 1000);
    for (const u of ctx.updaters) u(dt, now / 1000);
    env.u.time.value = (q.get('freeze') ? Number(q.get('freeze')) : now / 1000);
    // the diver's torch: on under water at night, along the view
    env.u.torchOn.value = camera.position.y < env.u.tide.value - 0.05 ? env.u.night.value : 0;
    camera.getWorldDirection(env.u.torchFwd.value);
    env.u.tide.value = tideNow();
    ripples.update(env.u.time.value); chop.update(env.u.time.value);
    terrain.update(camera.position);
    ocean.update(camera.position);
    shore.update(camera.position);
    if (now - sunT > 2000) { sunT = now; Object.assign(sun, setSun(env, clockMs(), S.origin[1], S.origin[0])); }
    lights(sun);
    if (post) post.render(); else renderer.render(scene, camera);
    if (++frames === 3) { $('load').classList.add('done'); window.__ready = true; }
    const gx = terrainHeight(d, camera.position.x, -camera.position.z);
    const tz = env.u.tide.value;
    $('hud').textContent = `${renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'} · alt ${camera.position.y.toFixed(1)} m · floor ${gx.toFixed(1)} m · sun ${(sun.alt * 57.3).toFixed(0)}° · tide ${tz >= 0 ? '+' : ''}${tz.toFixed(2)} m${tide && tideFixed === null ? (tide.rising(clockMs()) ? ' rising' : ' falling') : ''}`;
  };
  if (q.get('still')) { frame(1000); frame(1016); $('load').classList.add('done'); window.__ready = true; }  // for tests: one settled frame
  else renderer.setAnimationLoop(frame);
}
main().catch(fail);
