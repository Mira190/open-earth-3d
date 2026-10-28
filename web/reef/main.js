import * as THREE from 'three/webgpu';
import { loadScene, createTerrain, heightTexture, terrainHeight, habitatAt } from './world.js';
import { makeWaves, createEnv, setSun } from './env.js';
import { createOcean } from './ocean.js';
import { createShore } from './shore.js';
import { createPost } from './post.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const CITY = q.get('city') || 'whitsundays';
const fail = e => { console.error(e); $('err').textContent = String(e && e.stack || e); };
addEventListener('error', e => fail(e.error || e.message));
addEventListener('unhandledrejection', e => fail(e.reason));

async function main() {
  const base = `../data/${CITY}/`;
  const d = await loadScene(base);
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
  const waves = makeWaves(Number(q.get('wind_dir') || 125));
  const env = createEnv(scene, S.optics, waves);
  env.u.wind.value = Number(q.get('wind') ?? 0.6);
  env.u.tide.value = Number(q.get('tide') ?? 0);

  const sunL = new THREE.DirectionalLight(0xfff2dd, 2.8);
  const hemi = new THREE.HemisphereLight(0x9cc4ff, 0xd9c9a0, 0.9);
  scene.add(sunL, sunL.target, hemi);
  scene.fogNode = (({ Fn, vec4, output, positionWorld }) => Fn(() => vec4(env.medium(output.rgb, positionWorld), output.a))())(await import('three/tsl'));

  const hTex = heightTexture(d);
  const terrain = createTerrain(d, env, renderer);
  scene.add(terrain.group);
  const ocean = createOcean(d, env, hTex);
  scene.add(ocean.mesh);
  const shore = createShore(d, env, hTex, terrain);
  scene.add(shore.mesh);

  // sky dome
  const { Fn, vec3, vec4, positionWorld, cameraPosition, normalize } = await import('three/tsl');
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMat.fog = false;
  skyMat.colorNode = Fn(() => env.sky(normalize(positionWorld.sub(cameraPosition))))();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), skyMat);
  dome.frustumCulled = false; dome.renderOrder = -1;
  scene.add(dome);

  // clock: the model's own time, in the city's time zone
  const when = q.get('time') ? Date.parse(q.get('time')) : Date.now();
  function lights(sun) {
    const day = sun.day;
    sunL.intensity = 2.8 * Math.max(Math.min(1, Math.sin(sun.alt) * 3), 0);
    hemi.intensity = 0.06 + 0.84 * day + 0.05 * sun.moonLit * Math.max(Math.sin(sun.moonAlt), 0) * (1 - day);
    sunL.position.copy(camera.position).addScaledVector(sun.dir, 800);
    sunL.target.position.copy(camera.position);
    env.u.white.value = (sunL.intensity * Math.max(Math.sin(sun.alt), 0) + hemi.intensity) / Math.PI;
  }
  const sun = setSun(env, when, S.origin[1], S.origin[0]);
  lights(sun);

  // camera: local frame (east, north, up) -> three (x, up, -north)
  const st = S.start || {};
  const cx = Number(q.get('x') ?? st.x ?? 0), cy = Number(q.get('y') ?? st.y ?? 0), cz = Number(q.get('z') ?? st.z ?? 60);
  camera.position.set(cx, cz, -cy);
  let yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? st.yaw ?? 0)), pitch = THREE.MathUtils.degToRad(Number(q.get('pitch') ?? st.pitch ?? -15));
  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
  renderer.domElement.addEventListener('pointermove', e => { if (e.buttons) { yaw -= e.movementX * 0.003; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5); } });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const post = q.get('post') === '0' ? null : createPost(renderer, scene, camera, env);

  // modules plug in through a shared context; each exports init(ctx) and may return { update(dt, t) }
  const ctx = { THREE, renderer, scene, camera, env, d, S, q, terrain, ocean, sunL, hemi, sun, updaters: [], controller: null,
    height: (x, north) => terrainHeight(d, x, north),                 // sea-floor / ground elevation, m above datum
    habitat: (x, north) => habitatAt(d, x, north),                    // class under a point, see HABITAT
    depth: (x, north) => env.u.tide.value - terrainHeight(d, x, north), // water depth, m (negative on land)
    toScene: (x, up, north) => new THREE.Vector3(x, up, -north),      // local frame (east, up, north) -> three.js
    site: S.id, pois: S.pois || [], poi: id => (S.pois || []).find(p => p.id === id) || null };  // points of interest, metres east (x) and north (y)
  for (const name of (q.get('mods') ?? 'life,boats,player,game').split(',').filter(Boolean)) {
    try { const m = await import(`./${name}.js`); const r = await m.init(ctx); if (r && r.update) ctx.updaters.push(r.update); }
    catch (e) { if (!/Failed to fetch|Cannot find|404|Unexpected token '<'/.test(String(e))) fail(e); else console.warn('module', name, 'not available'); }
  }

  let last = performance.now(), frames = 0;
  window.__reef = { camera, env, renderer, d, set(o) { if (o.yaw !== undefined) yaw = o.yaw; if (o.pitch !== undefined) pitch = o.pitch; } };
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
    terrain.update(camera.position);
    ocean.update(camera.position);
    shore.update(camera.position);
    lights(sun);
    if (post) post.render(); else renderer.render(scene, camera);
    if (++frames === 3) { $('load').classList.add('done'); window.__ready = true; }
    const gx = terrainHeight(d, camera.position.x, -camera.position.z);
    $('hud').textContent = `${renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'} · alt ${camera.position.y.toFixed(1)} m · floor ${gx.toFixed(1)} m · sun ${(sun.alt * 57.3).toFixed(0)}°`;
  };
  if (q.get('still')) { frame(1000); frame(1016); $('load').classList.add('done'); window.__ready = true; }  // for tests: one settled frame
  else renderer.setAnimationLoop(frame);
}
main().catch(fail);
