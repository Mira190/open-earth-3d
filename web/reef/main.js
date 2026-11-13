import * as THREE from 'three/webgpu';
import { loadScene, createTerrain, heightTexture, terrainHeight, waterBed, habitatAt } from './world.js';
import { createFarLand } from './farland.js';
import { makeWaves, createEnv, setSun } from './env.js';
import { createOcean } from './ocean.js';
import { createShore } from './shore.js';
import { createPost } from './post.js';
import { createRipples } from './ripples.js';
import { loadTide } from './tide.js';
import { reefTier } from './tier.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const CITY = q.get('city') || 'whitsundays';
const fail = e => { console.error(e); $('err').textContent = String(e && e.stack || e); };
addEventListener('error', e => fail(e.error || e.message));
addEventListener('unhandledrejection', e => fail(e.reason));
// the loader: what is happening and how far along, painted before each long step (a step blocks the page)
const stage = (msg, f) => { $('load-msg').textContent = msg; $('load-bar').style.width = `${Math.round(f * 100)}%`; };
const paint = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
// the load's stages for the telemetry (telemetry.js markOf): data fetched (world.js), decoded, built, the first frame
const mark = s => { try { performance.mark(`oe:${s}`); } catch (e) { /* no User Timing */ } };
const STEPS = { weather: 'Reading the sky', 'alpine/traffic': 'Putting the traffic on the highway', 'alpine/parked': 'Parking the cars', 'alpine/fiord': 'Letting the falls run and the gulls fly', life: 'Growing the reef: corals, fish and seagrass', boats: 'Mooring the boats', player: 'Kitting out the diver', game: 'Opening the field journal' };

async function main() {
  const base = `../data/${CITY}/`;
  stage('Downloading the sea floor and the imagery', 0.03);
  const [d, tide] = await Promise.all([loadScene(base, (got, want) => stage(`Downloading the sea floor and the imagery: ${(got / 1e6).toFixed(1)}${want ? ` of ${(want / 1e6).toFixed(1)}` : ''} MB`, 0.03 + 0.3 * (want ? Math.min(1, got / want) : 0))), loadTide(base)]);
  const S = d.scene;
  mark('decoded');
  const ALP = S.kind === 'alpine';   // a lake and its mountains (alpine/): its own land, air and light
  document.title = `Open Earth 3D: ${S.name}`;
  $('load-title').textContent = S.name;
  const mode = document.querySelector('#load .ld-mode');
  if (mode) mode.textContent = S.region || (ALP ? 'Aotearoa New Zealand' : 'The Great Barrier Reef');
  window.Sun.site({ lat: S.origin[1], lon: S.origin[0], tz: S.timezone });

  stage('Starting the renderer', 0.36);
  await paint();
  // an alpine site is seen across 80 km of land: a logarithmic depth buffer keeps a far shore from flickering into
  // its lake (with the usual buffer, 0.2 m to 160 km leaves hundreds of metres of depth per step out there). A
  // reversed float buffer would be cheaper, but three.js r186 cannot resolve it from a multisampled pass on WebGL2
  // the picture tier (tier.js, from web/quality.js): MSAA, pixels, plants, the mirror and the bloom by what the device can draw
  const tier = reefTier(q);
  // (trackTimestamp: the GPU's time for the telemetry, from timestamp queries where the adapter has them; below)
  const renderer = new THREE.WebGPURenderer({ antialias: tier.antialias, forceWebGL: q.get('gl') === '1', trackTimestamp: q.get('gl') !== '1' && !!window.OETelemetry && window.OETelemetry.on, logarithmicDepthBuffer: ALP && q.get('logdepth') !== '0' });
  // The frame-time governor (quality.js, the one the city game runs: issue 382): how much of the canvas's resolution
  // the scene is drawn at (post.js brings it up, sharpened) and how much of what a frame can do without is drawn,
  // both ways as the frame time allows, at an even rate under the frame-rate cap (the game's setting: 60 unless asked)
  const Q = window.OEQuality;
  // (?gov=0: none. Its floor is half the canvas's resolution here, as the alpine land's shader is the heaviest on the site;
  // the extras go at 0.7)
  const gov = Q && Q.governor && q.get('gov') !== '0' ? Q.governor({ min: 0.5, mid: 0.7, cap: (() => { try { const v = localStorage.getItem('oe3d-fps'); return v === null ? 60 : Math.max(0, +v || 0); } catch (e) { return 60; } })() }) : null;
  let post = null;
  const fit = () => {
    const pr = tier.pixelRatio(innerWidth, innerHeight);
    if (gov) { gov.max = Math.max(gov.min, tier.sceneScale(innerWidth * pr, innerHeight * pr)); if (gov.scale > gov.max) gov.set(gov.max); }
    renderer.setPixelRatio(post || !gov ? pr : Math.max(0.5, pr * gov.scale));   // (without the post chain the canvas itself is scaled)
    renderer.setSize(innerWidth, innerHeight);
  };
  fit();
  // an alpine site takes the title screen's curve family (Khronos PBR Neutral, web/lens.js): it keeps the sky's blue
  // and the lake's turquoise where ACES pushes both toward a grey teal
  renderer.toneMapping = ALP ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  // an alpine site is exposed as a landscape photograph is: sunlit snow just under white, the sky's blue mid-tone, the lake
  // and the pale gravel of its shores with room above them (1.9 left the shore and the glitter path white)
  renderer.toneMappingExposure = Number(q.get('exp') || (ALP ? 1.7 : 1.0));
  document.body.prepend(renderer.domElement);
  await renderer.init();
  // One program for every instanced mesh of a material, not one each (issue 343): three.js puts an InstancedMesh's matrices
  // (and a skeleton's bones) in a uniform array when they fit a uniform block, and the array's name and length are written
  // into the shader, so each of the site's instanced meshes (the plants' patches, the cars, the boats) linked a program of
  // its own: 118 of Tekapo's first frames' programs. With no room for such arrays they come as instanced attributes (and
  // the bones as a texture), the same code for every mesh. ?ubo=1: as before, to compare
  if (q.get('ubo') !== '1' && renderer.backend && renderer.backend.capabilities && renderer.backend.capabilities.getUniformBufferLimit) renderer.backend.capabilities.getUniformBufferLimit = () => 0;
  // a lost device or context cannot be restored in place: reload with a note, not a black page (glcare.js)
  if (window.OEGLCare) window.OEGLCare.reloadOnLoss(renderer, document.body);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(q.get('fov') || 60), innerWidth / innerHeight, 0.2, ALP ? 160000 : 90000);   // ?fov= for a long lens
  camera.layers.enable(1);   // layer 1: what the lake's mirror leaves out (the small plants; all of them below the high tier)
  const windDir = Number(q.get('wind_dir') || 125);
  // a lake has wind chop and no swell
  const waves = ALP ? makeWaves(windDir, 0.32).filter(w => w.lam < 25) : makeWaves(windDir);
  const ripples = createRipples(renderer, windDir);
  // the wind chop's normals at range: a coarser tile with the chop's slope variance, so distant water is
  // broadband instead of the interference stripes of the nine chop waves that move the surface
  const chopVar = waves.filter(w => w.disp && w.lam < 20).reduce((a, w) => a + (w.a * w.k) ** 2 / 2, 0);
  const chop = createRipples(renderer, windDir, { tile: 192, res: 256, lam: [3, 24], spread: 70, target: chopVar, seed: 23, hess: false });
  let atm = null, envOpts = {};
  if (ALP) {
    const { createAtmos } = await import('./alpine/atmos.js');
    const tsl = await import('three/tsl');
    atm = createAtmos({ datum: S.terrain.datum_m });
    // the main lake's cells (lake id 1) are the only water the sea code knows; elsewhere below the level is dry land
    const lt = S.terrain, idTex = new THREE.DataTexture(d.lakeIds.map(v => v === 1 ? 255 : 0), lt.w, lt.h, THREE.RedFormat, THREE.UnsignedByteType);
    idTex.magFilter = idTex.minFilter = THREE.LinearFilter; idTex.needsUpdate = true;
    const wet = P => tsl.texture(idTex, tsl.vec2(P.x.sub(lt.x0).div(lt.w * lt.cell_m), P.z.add(lt.y1).div(lt.h * lt.cell_m))).level(0).r;
    envOpts = { sky: (dir, u) => atm.sky(dir, tsl.cameraPosition.y, u.sunDir, u.moonDir), skyRefl: (dir, u) => atm.skyRefl(dir, tsl.cameraPosition.y, u.sunDir, u.moonDir),
      air: (col, C, P, u) => atm.aerial(col, C, P, u.sunDir, u.moonDir), wet };
  }
  const env = createEnv(scene, S.optics, waves, ripples, chop, envOpts);
  // the telemetry's view is "reef" for every site of this page; which kind of site rides on its events
  if (window.OETelemetry && window.OETelemetry.set) window.OETelemetry.set({ site: ALP ? 'alpine' : 'marine' });
  env.logDepth = !!renderer.logarithmicDepthBuffer;
  if (ALP) env.u.haze.value = 1.2e-5;      // the lake's reflection fades to the horizon sky like the air in front of it
  env.u.wind.value = Number(q.get('wind') ?? S.wind ?? 0.6);      // (scene.json wind: a sheltered water's own, e.g. a fiord's light airs)
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

  stage('Shaping the sea floor, the water and the shore', 0.45);
  await paint();
  const hTex = heightTexture(d);
  let terrain, shore, light = null, lakes = null, clouds = null;
  if (ALP) {
    const groundTex = heightTexture(d, d.heights);
    const [{ createLight }, { createAlpineTerrain }, { createLakes }] = await Promise.all([import('./alpine/light.js'), import('./alpine/terrain.js'), import('./alpine/lakes.js')]);
    light = createLight(renderer, d, env, atm, groundTex);
    sunL.userData.terrainShadow = true;
    terrain = createAlpineTerrain(d, env, renderer, light, groundTex, () => clockMs(), { range: tier.terrain, detailMax: tier.detailMax });
    lakes = createLakes(d, env, atm, light, groundTex);
    if (q.get('lakes') !== '0') scene.add(lakes.group);
    const { createClouds } = await import('./alpine/clouds.js');
    clouds = createClouds({ S, q, env, camera }, light);
    scene.add(clouds.group);
    shore = { update() {} };
  } else {
    terrain = createTerrain(d, env, renderer);
    shore = createShore(d, env, heightTexture(d, d.heights), terrain);   // the ground's own heights, hollows and all
    scene.add(shore.mesh);
  }
  scene.add(terrain.group);
  terrain.group.name = 'terrain'; if (shore.mesh) shore.mesh.name = 'shore'; if (lakes) lakes.group.name = 'lakes'; if (clouds) clouds.group.name = 'clouds';   // (names: tools/reef_frame.js lists the frame's cost by them)
  if (ALP && tier.mirror) {
    // the lake's mirror: the scene seen from below the water level, at part of the screen's resolution, without what is
    // on layer 1 (the turf, tussock and stones, too small to read in a wind-blurred reflection)
    const tsl = await import('three/tsl');
    env.mirror = tsl.reflector({ resolutionScale: Math.min(tier.mirror, Math.min(innerWidth, innerHeight) < 700 ? 0.3 : 0.5), bounces: false });
    env.mirror.reflector.getVirtualCamera(camera).layers.set(0);
    env.mirror.target.rotateX(-Math.PI / 2);
    scene.add(env.mirror.target);
    // the mirror is a second render of the land, the heaviest shader on the site: while the eye is still it is drawn every
    // third frame (what it shows then changes with the clouds and the sun, slowly; the ripples that bend it are the water's
    // own and move every frame), and every frame as soon as the eye moves (issue 382, as the cities' sea does)
    const R = env.mirror.reflector, upd = R.updateBefore.bind(R), lastM = new THREE.Matrix4();
    let skipped = 0;
    R.updateBefore = frame => {
      const still = lastM.equals(camera.matrixWorld);
      if (still && skipped < 2 && q.get('still') === null) { skipped++; return; }
      skipped = 0; lastM.copy(camera.matrixWorld);
      return upd(frame);
    };
  }
  const ocean = createOcean(d, env, hTex);
  ocean.mesh.name = 'water';
  scene.add(ocean.mesh);
  // the land past the survey: the mainland's ranges and the coast's lights (farland.js); fewer triangles on a small screen
  const far = await createFarLand(base, d, env, { small: tier.farSmall }).catch(e => { console.warn('far land: none drawn', e); return null; });
  if (far) scene.add(far.mesh);

  // sky dome
  const { Fn, vec3, vec4, positionWorld, cameraPosition, normalize } = await import('three/tsl');
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMat.fog = false;
  skyMat.colorNode = Fn(() => env.sky(normalize(positionWorld.sub(cameraPosition))))();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(ALP ? 150000 : 60000, 32, 16), skyMat);
  dome.frustumCulled = false; dome.renderOrder = -1; dome.name = 'sky';
  scene.add(dome);
  // an alpine site's stars: the Bright Star Catalogue on the turning sky (alpine/stars.js)
  let stars = null;
  if (ALP && q.get('stars') !== '0') {
    const { createStars } = await import('./alpine/stars.js');
    stars = await createStars({ atm, camera, renderer, url: '../data/sky/bsc5.bin' }).catch(e => { console.warn('stars: none drawn', e); return null; });
    if (stars) scene.add(stars.mesh);
  }

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
  const baseExp = Number(q.get('exp') || (ALP ? 1.7 : 1.0));
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
    if (ALP) alpineLights(sun, sunI, moonI, hemiI);
    sunL.position.copy(camera.position).addScaledVector(sun.dir, 800);
    sunL.target.position.copy(camera.position);
    moonL.position.copy(camera.position).addScaledVector(env.u.moonDir.value, 800);
    moonL.target.position.copy(camera.position);
  }
  const smoothUp = a => THREE.MathUtils.smoothstep(Math.sin(a), -0.02, 0.05);
  // an alpine site's lights from its air (atmos.js): the sun reddened by the air it crosses to reach the eye's
  // height, the sky's light blue and as bright as the model gives, the land's bounce golden from the tussock
  const eqM = new THREE.Matrix3();
  let eqT = -1e9, equatorialMatrix = null;
  if (ALP) ({ equatorialMatrix } = await import('./alpine/atmos.js'));
  const SKY_DAY = 0.72;
  function alpineLights(sun, sunI, moonI, hemiI) {
    const y = camera.position.y, Ts = atm.sunColour(y, Math.sin(sun.alt)), deg = sun.alt * 180 / Math.PI;
    const E0 = 2.8 * adapt;
    atm.u.E0.value = E0; atm.u.Emoon.value = moonI * adapt;
    const amb = atm.skyAmbient(y, Math.sin(sun.alt));
    const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const sunLum = Math.max(lum(Ts), 1e-6);
    sunL.color.setRGB(Ts[0] / sunLum, Ts[1] / sunLum, Ts[2] / sunLum); sunL.intensity = E0 * sunLum;   // the mountains' shadow per fragment (light.js)
    env.u.sunCol.value.setRGB(Ts[0] / Math.max(...Ts, 1e-6), Ts[1] / Math.max(...Ts, 1e-6), Ts[2] / Math.max(...Ts, 1e-6));
    env.u.sunI.value = E0 * sunLum;
    // the sky's light: the model's by day, the reef's measured twilight and starlight curve once the sun is down
    const day = THREE.MathUtils.smoothstep(Math.sin(sun.alt), -0.06, 0.04);
    const night = hemiI * adapt;   // already adapted below (lights() scales the hemisphere by adapt afterwards)
    // once the sun is down the land is lit by the twilight sky it stands under (atmos.js twilight: the same colours and
    // brightness, over the hemisphere), never darker than starlight (a little stronger than the reef's, so the tussock
    // and the snow read under the stars)
    const twi = skyLight(deg) * adapt * 0.42 * (1 - THREE.MathUtils.smoothstep(deg, -1, 6));
    // (by day the model's sky light on the ground is taken at 0.72: as it was, the sky gave 40% of the light on open ground
    // with the sun 40 degrees up, where a clear sky gives 15 to 25%, and its blue lifted every shadow into a grey haze)
    const sky = [0, 1, 2].map(i => E0 * amb[i] * Math.PI * day * SKY_DAY + Math.max(Math.PI * twi * [0.11, 0.16, 0.40][i], night * 1.1 * [0.55, 0.7, 1.0][i]) * (1 - day));
    // a landscape photographer's daylight balance: the cast of sun and sky together is taken out of the land (a warm sun
    // and a blue sky left it sage and grey), less and less toward the golden hour, whose warmth stays
    const sinA = Math.max(Math.sin(sun.alt), 0), tot = [0, 1, 2].map(i => Ts[i] * E0 * sinA + sky[i]), totL = Math.max(lum(tot), 1e-6);
    const wbAmt = 0.75 * THREE.MathUtils.smoothstep(sinA, 0.08, 0.4);
    const wb = tot.map(v => 1 + (totL / Math.max(v, 1e-6) - 1) * wbAmt);
    const wbL = lum(wb); for (let i = 0; i < 3; i++) wb[i] /= wbL;
    sunL.color.setRGB(Ts[0] * wb[0] / sunLum, Ts[1] * wb[1] / sunLum, Ts[2] * wb[2] / sunLum);
    hemi.color.setRGB(sky[0] * wb[0], sky[1] * wb[1], sky[2] * wb[2]).multiplyScalar(1 / Math.max(lum(sky), 1e-6)); hemi.intensity = Math.max(lum(sky), 1e-6);
    hemi.groundColor.setRGB(0.55, 0.45, 0.3);
    light.u.sunE.value.setRGB(Ts[0] * E0 * wb[0], Ts[1] * E0 * wb[1], Ts[2] * E0 * wb[2]);
    light.u.skyE.value.setRGB(sky[0] * wb[0], sky[1] * wb[1], sky[2] * wb[2]);
    const bounce = 0.18 * (E0 * sunLum * Math.max(Math.sin(sun.alt), 0) + lum(sky));
    light.u.groundE.value.setRGB(bounce * 1.1 * wb[0], bounce * 0.95 * wb[1], bounce * 0.7 * wb[2]);
    light.u.moonE.value.setRGB(0.8 * moonI * adapt, 0.86 * moonI * adapt, 1.0 * moonI * adapt);
    env.u.white.value = (E0 * sunLum * Math.max(Math.sin(sun.alt), 0) + moonI * adapt * Math.max(Math.sin(sun.moonAlt), 0) + lum(sky)) / Math.PI;
    // a landscape photographer opens up as the light goes: from a high sun to the last of the golden hour about a
    // stop and a third; the eye's own adaptation (adapt) takes over from dusk
    const autoExp = THREE.MathUtils.clamp(Math.pow(0.6 / Math.max(env.u.white.value / adapt, 1e-4), 0.6), 1, 2.6);
    renderer.toneMappingExposure = baseExp * THREE.MathUtils.lerp(autoExp, 1.4, THREE.MathUtils.smoothstep(adapt, 1, 40));
    atm.u.stars.value = THREE.MathUtils.smoothstep(-Math.sin(sun.alt), 0.05, 0.25) * adapt * 2.4e-6 * 0.9;
    // the twilight sky (atmos.js twilight): the measured skylight curve, adapted, fading out as the sun climbs past 6 degrees
    atm.u.twi.value = skyLight(deg) * adapt * 0.42 * (1 - THREE.MathUtils.smoothstep(deg, -1, 6));
    const now = clockMs();
    if (Math.abs(now - eqT) > 20000) { eqT = now; equatorialMatrix(now, S.origin[1], S.origin[0], eqM); atm.u.eq.value.copy(eqM); }
  }
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
    if (ctx && ctx.weather) ctx.weather.light();
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
  if (terrain.prefetch) terrain.prefetch(camera.position);   // (the aerial patch under the eye, from now: alpine/terrain.js)
  let yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? st.yaw ?? 0)), pitch = THREE.MathUtils.degToRad(Number(q.get('pitch') ?? st.pitch ?? -15));
  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
  renderer.domElement.addEventListener('pointermove', e => { if (e.buttons) { yaw -= e.movementX * 0.003; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5); } });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); fit(); });

  post = q.get('post') === '0' ? null : createPost(renderer, scene, camera, env, { bloom: tier.bloom, grade: S.grade || null });
  // What the governor moves. The scale: the scene's target and the lake's mirror with it. The extras (1, 0.5, 0): at
  // 0.5 the mirror at half its size again and the two ripple tiles redrawn every second frame; at 0 every third.
  // Each step goes to the telemetry, and the scale a device held here is kept for its next visit to this site, so it
  // starts where it settled; a device new to the site starts within the tier's opening budget (tier.js) and is
  // granted more. Under automation the governor stands still at its ceiling (?scale= sets another, for stills).
  const SCALE_KEY = `oe3d-scale:${CITY}:${tier.name}`;
  const mirror0 = env.mirror ? env.mirror.reflector.resolutionScale : 0;
  let tileEvery = 1;
  if (gov) {
    gov.on((extras, scale) => {
      fit();
      if (post) post.setScale(scale);
      if (env.mirror) env.mirror.reflector.resolutionScale = mirror0 * scale * (extras < 1 ? 0.5 : 1);
      tileEvery = extras >= 1 ? 1 : extras > 0 ? 2 : 3;
      if (window.OETelemetry && window.OETelemetry.set) window.OETelemetry.set({ scale: +scale.toFixed(2), shed: 2 - 2 * extras });
      if (gov.auto) { try { localStorage.setItem(SCALE_KEY, scale.toFixed(2)); } catch (e) { /* storage blocked */ } }
    });
    const pr = renderer.getPixelRatio();
    let start = gov.max;
    if (gov.auto) {
      let kept = NaN;
      try { kept = parseFloat(localStorage.getItem(SCALE_KEY)); } catch (e) { /* storage blocked */ }
      start = kept >= gov.min ? kept : tier.startScale(innerWidth * pr, innerHeight * pr);
    }
    if (q.get('scale')) { gov.auto = false; start = Number(q.get('scale')); }
    gov.scale = -1;   // (so that the first set() tells the listeners, whatever the scale)
    gov.set(start);
  }

  // modules plug in through a shared context; each exports init(ctx) and may return { update(dt, t) }
  const ctx = { THREE, tier, renderer, scene, camera, env, d, S, q, terrain, ocean, sunL, hemi, sun, updaters: [], controller: null, light, atm, lakes, governor: gov, post,
    height: ALP ? (x, north) => terrain.heightAt(x, north) : (x, north) => terrainHeight(d, x, north),   // sea-floor / ground elevation, m above datum
    habitat: ALP ? (x, north) => { const c = S.cover, i = Math.floor((x - S.terrain.x0) / c.px_m), j = Math.floor((S.terrain.y1 - north) / c.px_m);
      return i < 0 || j < 0 || i >= c.w || j >= c.h ? 7 : d.habitat[j * c.w + i]; } : (x, north) => habitatAt(d, x, north),   // class under a point (HABITAT; an alpine site's COVER)
    depth: (x, north) => env.u.tide.value - waterBed(d, x, north),    // water depth, m (negative on land and in hollows the sea cannot reach)
    toScene: (x, up, north) => new THREE.Vector3(x, up, -north),      // local frame (east, up, north) -> three.js
    decks: [],                                                        // (x, north) -> deck height or null: pontoons, jetties (boats.js)
    clockMs, tide,                                                    // the model clock (ms) and the tide (tide.js: at(ms), turns(ms), rising(ms))
    setClock, clockLive: () => live,                                  // set the clock (UTC ms, or null for now); whether it follows now
    site: S.id, pois: S.pois || [], poi: id => (S.pois || []).find(p => p.id === id) || null };  // points of interest, metres east (x) and north (y)
  const mods = (q.get('mods') ?? (ALP ? `weather,alpine/flora,alpine/landmarks,alpine/traffic,alpine/parked,boats${S.falls || S.birds ? ',alpine/fiord' : ''},player,game` : 'weather,life,boats,player,game')).split(',').filter(Boolean);
  for (const [i, name] of mods.entries()) {
    stage(STEPS[name] || `Loading ${name}`, 0.58 + 0.3 * i / mods.length);
    await paint();
    try { const m = await import(`./${name}.js`); const r = await m.init(ctx); if (r && r.update) ctx.updaters.push(r.update); }
    catch (e) { if (!/Failed to fetch|Cannot find|404|Unexpected token '<'/.test(String(e))) fail(e); else console.warn('module', name, 'not available'); }
  }

  // The programs the first frames draw with, compiled together behind the loader (issue 343): the scene as the post
  // chain's scene pass draws it, into its own target (a program is made for the target and outputs it draws to, so one
  // compiled for the canvas was compiled again in the first frame), or to the canvas without the chain; and the lake's
  // mirror as its reflector draws it (a half-float target, no extra outputs, layer 0 from below the water, the water
  // itself hidden), which the first frame otherwise compiled on the spot: 117 of Tekapo's 247 programs. Each call
  // takes the renderer's target when it is made, so they are all asked for at once and compile side by side where the
  // driver can (KHR_parallel_shader_compile)
  async function precompile() {
    // a frame's work bar the drawing, first: the eye placed (the player's view), the land's chunks and the plants' patches
    // round it made, the water's tiles drawn (their own small passes), so that what is compiled is what the first frame draws
    const t0 = performance.now() / 1000;
    if (ctx.controller) ctx.controller.update(0, t0);
    for (const u of ctx.updaters) u(0, t0);
    env.u.tide.value = tideNow();
    ripples.update(env.u.time.value); chop.update(env.u.time.value);
    terrain.update(camera.position);
    if (light) light.update();
    ocean.update(camera.position);
    shore.update(camera.position);
    camera.updateMatrixWorld();
    const rt0 = renderer.getRenderTarget(), mrt0 = renderer.getMRT(), jobs = [];
    const sp = post && post.scenePass;
    // (the land's detail patches are hidden until the eye is over one: alpine/terrain.js. Shown for the compile)
    const hidden = (terrain.patches || []).filter(m => !m.visible);
    for (const m of hidden) m.visible = true;
    try {
      if (sp && sp.renderTarget) { renderer.setRenderTarget(sp.renderTarget); renderer.setMRT(sp.getMRT ? sp.getMRT() : null); }
      jobs.push(renderer.compileAsync(scene, camera));
      if (env.mirror) {
        const R = env.mirror.reflector, vc = R.getVirtualCamera(camera);
        vc.position.set(camera.position.x, 2 * env.u.tide.value - camera.position.y, camera.position.z);
        vc.rotation.set(-pitch, yaw, 0, 'YXZ');
        vc.updateMatrixWorld();
        const hide = ocean.mesh.material, was = hide.visible;
        hide.visible = false;
        renderer.setMRT(null); renderer.setRenderTarget(R.getRenderTarget(vc));
        jobs.push(renderer.compileAsync(scene, vc));
        hide.visible = was;
      }
    } finally { renderer.setRenderTarget(rt0); renderer.setMRT(mrt0); for (const m of hidden) m.visible = false; }
    await Promise.all(jobs);
  }
  // compiling the shaders can take a while on a first visit; done here it shows on the loader, not as a frozen first frame
  mark('built');
  stage('Compiling the shaders (the first visit takes longest)', 0.9);
  await paint();
  if (renderer.compileAsync && !q.get('still')) { try { await precompile(); } catch (e) { console.warn('shader precompile skipped:', e); } }
  stage('First frames', 0.98);
  let last = performance.now(), frames = 0, gpuAt = 0, gpuWait = false;
  // ctx for tools that drive the viewer from outside (tools/film/reef-director.js sets ctx.controller and the clock)
  window.__reef = { camera, env, renderer, d, ctx, tier, governor: gov, gov, set(o) { if (o.yaw !== undefined) yaw = o.yaw; if (o.pitch !== undefined) pitch = o.pitch; } };
  const frame = now => {
    // (under the frame-rate cap a faster display draws every second or third of its frames, evenly)
    if (gov) { gov.raf(now); if (!gov.due(now)) return; }
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
    if (frames % tileEvery === 0) { ripples.update(env.u.time.value); chop.update(env.u.time.value); }
    terrain.update(camera.position);
    if (ALP) { dome.position.copy(camera.position); clouds.update(); if (stars) stars.update(env.u.time.value); }   // the sky is at infinity wherever the eye goes over 80 km
    if (light) light.update();
    ocean.update(camera.position);
    shore.update(camera.position);
    if (now - sunT > 2000) { sunT = now; Object.assign(sun, setSun(env, clockMs(), S.origin[1], S.origin[0])); }
    lights(sun);
    if (ctx.weather) ctx.weather.light();   // the weather's share of the light (weather.js), after the hour's
    if (post) post.render(); else renderer.render(scene, camera);
    if (++frames === 1) mark('frame');
    // the frame's time, for the governor: once the page is ready and while it is on screen
    if (gov) gov.tick(now, frames > 3 && !document.hidden);
    // what the GPU was asked for, for the telemetry (telemetry.js gpu): the timestamp queries summed over a run of 16
    // frames, then divided by them (three.js sums every pass's queries since the last read), and a frame's draws,
    // triangles and canvas pixels. WebGPU's timestamps are the passes' own, so this is the GPU's time, not the frame's
    if (window.OETelemetry && window.OETelemetry.gpu && frames > 3 && frames % 16 === 0 && !document.hidden) {
      const info = renderer.info.render, el = renderer.domElement, run = frames - gpuAt; gpuAt = frames;
      const o = { draws: info.drawCalls ?? info.calls, tris: info.triangles, px: el.width * el.height };
      if (renderer.backend && renderer.backend.trackTimestamp && !gpuWait) {
        gpuWait = true;
        renderer.resolveTimestampsAsync('render').then(ms => { gpuWait = false; window.OETelemetry.gpu(Object.assign(o, { ms: ms > 0 && run > 0 ? ms / run : 0 })); }, () => { gpuWait = false; });
      } else window.OETelemetry.gpu(o);
    }
    if (frames === 3) { $('load').classList.add('done'); window.__ready = true; }
    const gx = terrainHeight(d, camera.position.x, -camera.position.z);
    const tz = env.u.tide.value;
    $('hud').textContent = `${renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'} · alt ${camera.position.y.toFixed(1)} m · floor ${gx.toFixed(1)} m · sun ${(sun.alt * 57.3).toFixed(0)}° · ${ALP ? 'lake' : 'tide'} ${tz >= 0 ? '+' : ''}${tz.toFixed(2)} m${tide && tideFixed === null ? (tide.rising(clockMs()) ? ' rising' : ' falling') : ''}`;
  };
  // the aerial patch under the eye: a visitor's first frames draw the land from the mosaic and the patch fades in when it
  // comes (issue 343: up to 19 s of Tekapo's loader); a still, a film or a tool under automation waits for it, as before
  // (?detail=later: as a visitor, for tools/reef_load.js)
  if (terrain.prepare) {
    const wait = !!q.get('still') || (navigator.webdriver && q.get('detail') !== 'later');
    if (wait) stage('Unrolling the aerial photographs', 0.97);
    await terrain.prepare(camera.position, { wait });
  }
  if (q.get('still')) { frame(1000); frame(1016); $('load').classList.add('done'); window.__ready = true; }  // for tests: one settled frame
  else renderer.setAnimationLoop(frame);
}
main().catch(fail);
