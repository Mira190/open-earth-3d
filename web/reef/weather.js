// The weather at a reef or alpine site: the city game's one weather state (web/game/weather.js, OEWeather.S) carried
// to the reef viewer (issue 381, item 1).
//
// What the weather is comes from the same place as in the cities: the site's climate (scene.json "weather": the
// national weather service's monthly normals, pipeline/weather_climate.py) read through weather.js's season() and
// tempAt() at the model clock's local date and hour, so the same morning at Milford Sound always has the same
// showers. weather.js is loaded for its tables and its state only: its create() renders through the city game's
// WebGL materials, and this page draws with three.js's node materials on WebGPU, so what the weather looks like
// here is drawn by this module. The easing from what the season asks for to what is (cloud before rain, thunder
// after it, the wet ground lagging, snow lying and melting) follows create().update's rates, so a reader of
// OEWeather.S (the sound, the people, a quest) sees the same thing on either page.
//
// What it looks like:
//  - Overcast: a cloud deck over the whole sky (a dome under the sky's, its grey lit by the day), the sun's light
//    taken down and the sky's raised and greyed, the exposure lifted a little so the frame never goes grey, and the
//    air thickened to the weather's visibility (the reef's haze, an alpine site's aerosol: the far ranges go first).
//  - Rain: streaks round the eye, each a drop's path over a 1/33 s shutter slanted by the wind, at least a hair wide
//    (after Tatarchuk, "Artist-directable real-time rain rendering", 2006, as weather.js draws them), and rings
//    spreading on the water round the eye, where the drops land.
//  - Snow (an alpine site, or a cold enough day): flakes drifting on the wind; settled snow on the land, down to the
//    snow line the temperature puts it at (the lapse rate from the climate station's height), and the ground darker
//    and glossier while it is wet (alpine/terrain.js reads ctx.weather).
//  - Wind: the sea's and the lake's waves, ripples and whitecaps follow the wind's speed and gusts (env.u.wind).
// Under water there is no rain to see: the streaks and rings are drawn only from above the surface.
//
// What it costs: one draw for the streaks, one for the flakes and one for the rings while each is falling, none
// otherwise, and the cloud dome while there is cloud. The counts follow the picture tier and the frame-time
// governor's extras (main.js): at extras 0.5 half the drops and no rings, at 0 a quarter.
//
// ?weather=clear|overcast|fog|drizzle|rain|storm|snow pins one (live: the season's). Automated runs keep a clear
// sky unless they ask, as in the cities, so stills and checks stay comparable.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, attribute, cameraPosition, positionLocal, uv, mod, normalize, cross, length,
  smoothstep, clamp, max, mix, sin, fract, select, positionWorld, mx_noise_float } from 'three/tsl';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MDAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthly = (a, m, d) => {
  if (!Array.isArray(a)) return a;
  const x = m - 1 + (d - 0.5) / MDAYS[m - 1] - 0.5, i = Math.floor(x), f = x - i;
  return a[(i + 12) % 12] * (1 - f) + a[(i + 13) % 12] * f;
};
const kindOf = s => ((s.storm || 0) > 0.4 && s.rain > 0.3 ? 'storm' : (s.snow || 0) > 0.06 ? 'snow' : s.rain > 0.5 ? 'rain' : s.rain > 0.06 ? 'drizzle'
  : (s.fog || 0) > 0.3 ? 'fog' : s.cloud > 0.6 ? 'overcast' : 'clear');

// weather.js as a classic script, once (it defines window.OEWeather and touches nothing else until create())
function loadWeather() {
  if (window.OEWeather) return Promise.resolve(window.OEWeather);
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = new URL('../game/weather.js', import.meta.url).href;
    s.onload = () => (window.OEWeather ? ok(window.OEWeather) : no(new Error('weather.js defined nothing')));
    s.onerror = () => no(new Error('weather.js could not be loaded'));
    document.head.appendChild(s);
  });
}

// n quads, each corner carrying its quad's seed (xyz in 0..1, w a fourth random) and its corner (-1..1)
function quads(n, rnd) {
  const pos = new Float32Array(n * 12), seed = new Float32Array(n * 16), corner = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < n; i++) {
    const s = [rnd(), rnd(), rnd(), rnd()];
    for (let k = 0; k < 4; k++) { seed.set(s, (i * 4 + k) * 4); corner.set(C[k], (i * 4 + k) * 2); }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(corner.map(v => v * 0.5 + 0.5), 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export async function init(ctx) {
  const { S: site, q, env, camera, scene, sunL, hemi, renderer, tier } = ctx;
  const W = await loadWeather();
  const S = W.S, U = W.U;
  const ALP = site.kind === 'alpine';
  const climate = site.weather || null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // who decides: the address, else the season (automation: a clear sky unless asked)
  const asked = q.get('weather');
  let mode = asked && (W.KINDS[asked] || asked === 'live' || asked === 'off') ? asked : navigator.webdriver ? 'clear' : 'live';
  let custom = null, snap = true;
  // the station the normals are from stands at elev_m: the air cools 6.5 degrees a kilometre above it
  const stationM = climate && Number.isFinite(climate.elev_m) ? climate.elev_m : 0;
  const datum = site.terrain && Number.isFinite(site.terrain.datum_m) ? site.terrain.datum_m : 0;   // (scene y 0 is this many metres above the sea)
  const tempAtY = (t, y) => t - (y + datum - stationM) * 0.0065;
  // the site's own wind (scene.json wind: a fiord's light airs, a lagoon's breeze) is what the waves were made for;
  // the weather's wind moves it about that by the ratio of the wind now to the season's mean
  const wind0 = env.u.wind.value, windPinned = q.get('wind') !== null;
  const windFrom0 = (climate && climate.wind_from_deg) ?? 120;

  const cur = { rain: 0, snow: 0, fog: 0, storm: 0, cloud: 0, windK: 1, temp: 15 }, target = Object.assign({}, cur);
  let windRun = 0, lastKind = '', wetPin = null, depthPin = null, clockAt = null;
  const clock = () => { const l = window.Sun.utcToLocal(ctx.clockMs(), site.timezone); return [l.y, l.m, l.d, l.minutes]; };
  const windBase = () => (climate && climate.wind_ms != null ? monthly(climate.wind_ms, clockAt[1], clockAt[2]) : 4);

  // ---------------------------------------------------------------- what is drawn
  let seed = 9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const T = { high: { rain: 9000, snow: 5000, ring: 900 }, medium: { rain: 6000, snow: 3200, ring: 600 }, low: { rain: 2800, snow: 1600, ring: 260 } }[tier.name] || { rain: 6000, snow: 3200, ring: 600 };
  const u = {
    drift: uniform(new THREE.Vector3()),     // how far the falling air has carried the drops (m): wraps them round the eye
    fallV: uniform(new THREE.Vector3(0, -7, 0)),
    box: uniform(36), col: uniform(new THREE.Color(0.8, 0.82, 0.85)), alpha: uniform(0.2), width: uniform(0.004), count: uniform(0),
    sbox: uniform(30), scol: uniform(new THREE.Color(1, 1, 1)), salpha: uniform(0.85), scount: uniform(0),
    pix: uniform(0.001), ring: uniform(0), rbox: uniform(26), water: uniform(0), t: uniform(0),
    cloud: uniform(0), cloudCol: uniform(new THREE.Color(0.6, 0.62, 0.65)), cloudRun: uniform(new THREE.Vector2()),
    fresh: uniform(0), line: uniform(1e5), wet: uniform(0),
  };
  // the place a quad's seed puts it, wrapped into a box of side b round the eye that the drift carries through
  const wrapped = (s, b) => cameraPosition.add(mod(s.mul(b).sub(cameraPosition).sub(u.drift.mul(b.div(u.box))), b).sub(b.mul(0.5)));
  // rain: a streak along the drop's path relative to the eye, over the shutter; thin, fading along its length and across
  const rainMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  rainMat.fog = false;
  rainMat.positionNode = Fn(() => {
    const s = attribute('aSeed', 'vec4'), c = attribute('aCorner', 'vec2');
    const C = wrapped(s.xyz, u.box);
    const live = select(s.w.lessThan(u.count), float(1), float(0));
    const V = u.fallV.mul(s.w.mul(0.3).add(0.85)), L = length(V).mul(0.03).add(0.08), a = V.div(length(V));
    const side = normalize(cross(a, cameraPosition.sub(C)));
    // (a quad not in today's count is folded to a point, so it draws nothing)
    // (at least a pixel and a bit wide, its opacity taken down by as much as it was widened)
    const w = max(u.width, length(cameraPosition.sub(C)).mul(u.pix).mul(1.3)).mul(live);
    return C.add(side.mul(c.x.mul(w))).add(a.mul(c.y.mul(L).mul(0.5)).mul(live));
  })();
  rainMat.colorNode = u.col;
  rainMat.opacityNode = Fn(() => {
    const c = attribute('aCorner', 'vec2');
    const d = length(positionWorld.sub(cameraPosition));
    const thin = u.width.div(max(u.width, d.mul(u.pix).mul(1.3)));
    return u.alpha.mul(thin.mul(0.75).add(0.25)).mul(float(1).sub(c.x.abs())).mul(smoothstep(-1, -0.2, c.y)).mul(smoothstep(0.4, 1.6, d)).mul(float(1).sub(smoothstep(u.box.mul(0.3), u.box.mul(0.5), d)));
  })();
  const rain = new THREE.Mesh(quads(T.rain, rnd), rainMat);
  // snow: a soft round flake facing the eye, swaying as it falls
  const snowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  snowMat.fog = false;
  snowMat.positionNode = Fn(() => {
    const s = attribute('aSeed', 'vec4'), c = attribute('aCorner', 'vec2');
    const sway = vec3(sin(u.t.mul(s.w.mul(0.8).add(0.6)).add(s.x.mul(40))), 0, sin(u.t.mul(s.w.mul(0.7).add(0.5)).add(s.z.mul(40)))).mul(0.35);
    const C = wrapped(s.xyz, u.sbox).add(sway);
    const live = select(s.w.lessThan(u.scount), float(1), float(0));
    const toEye = normalize(cameraPosition.sub(C)), right = normalize(cross(vec3(0, 1, 0), toEye)), up = cross(toEye, right);
    const r = s.w.mul(0.012).add(0.012).mul(length(cameraPosition.sub(C)).mul(0.04).add(1)).mul(live);
    return C.add(right.mul(c.x.mul(r))).add(up.mul(c.y.mul(r)));
  })();
  snowMat.colorNode = u.scol;
  snowMat.opacityNode = Fn(() => {
    const c = attribute('aCorner', 'vec2'), d = length(positionWorld.sub(cameraPosition));
    return u.salpha.mul(float(1).sub(smoothstep(0.3, 1.0, length(c)))).mul(smoothstep(0.3, 1.2, d)).mul(float(1).sub(smoothstep(u.sbox.mul(0.32), u.sbox.mul(0.5), d)));
  })();
  const snow = new THREE.Mesh(quads(T.snow, rnd), snowMat);
  // rings on the water: each quad lies on the surface, a ring spreading out from where a drop landed and fading, then
  // landing again somewhere else in the box (each its own phase); the land above the water hides those that fall on it
  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  ringMat.fog = false;
  const ringLife = Fn(([s]) => fract(u.t.mul(0.9).add(s.w.mul(7.3))));
  ringMat.positionNode = Fn(() => {
    const s = attribute('aSeed', 'vec4'), c = attribute('aCorner', 'vec2');
    const cyc = u.t.mul(0.9).add(s.w.mul(7.3)).floor();
    const at = fract(vec2(s.x, s.z).add(vec2(cyc.mul(0.618), cyc.mul(0.382))));
    const xz = cameraPosition.xz.add(mod(at.mul(u.rbox).sub(cameraPosition.xz), u.rbox).sub(u.rbox.mul(0.5)));
    const live = select(s.w.lessThan(u.ring), float(1), float(0));
    const r = s.y.mul(0.08).add(0.1).mul(live);
    return vec3(xz.x.add(c.x.mul(r)), u.water.add(0.06), xz.y.add(c.y.mul(r)));
  })();
  ringMat.colorNode = u.col;
  ringMat.opacityNode = Fn(() => {
    const s = attribute('aSeed', 'vec4'), c = attribute('aCorner', 'vec2'), k = ringLife(s);
    const rr = length(c), band = smoothstep(0.12, 0, rr.sub(k).abs());
    const d = length(positionWorld.sub(cameraPosition));
    return band.mul(float(1).sub(k)).mul(0.55).mul(float(1).sub(smoothstep(u.rbox.mul(0.3), u.rbox.mul(0.5), d)));
  })();
  const rings = new THREE.Mesh(quads(T.ring, rnd), ringMat);
  // the cloud deck: a dome inside the sky's, grey lit by the day, thick where the noise is and thinning near the
  // horizon to the haze; its own drift on the wind
  const skyR = ALP ? 140000 : 55000;
  const deckMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide });
  deckMat.fog = false;
  deckMat.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const p = vec3(dir.x.div(dir.y.max(0.04)), 0, dir.z.div(dir.y.max(0.04))).mul(1.4).add(vec3(u.cloudRun.x, 0, u.cloudRun.y));
    const n = mx_noise_float(p).mul(0.6).add(mx_noise_float(p.mul(2.7)).mul(0.3));
    return u.cloudCol.mul(float(0.88).add(n.mul(0.22)));
  })();
  deckMat.opacityNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const p = vec3(dir.x.div(dir.y.max(0.04)), 0, dir.z.div(dir.y.max(0.04))).mul(1.4).add(vec3(u.cloudRun.x, 0, u.cloudRun.y));
    const n = mx_noise_float(p).mul(0.5).add(0.5);
    // thin cloud is broken (blue between), full cloud a solid deck
    const cover = clamp(u.cloud.mul(1.6).sub(0.3).add(n.sub(0.5).mul(float(1).sub(u.cloud).mul(1.6))), 0, 1);
    return cover.mul(mix(float(0.97), float(0.8), smoothstep(0.0, 0.25, dir.y)));
  })();
  const deck = new THREE.Mesh(new THREE.SphereGeometry(skyR, 32, 16), deckMat);
  for (const [m, n] of [[rain, 'rain'], [snow, 'snow'], [rings, 'rain rings'], [deck, 'cloud deck']]) { m.frustumCulled = false; m.visible = false; m.name = n; scene.add(m); }
  rain.renderOrder = snow.renderOrder = 5; deck.renderOrder = -1;

  // ---------------------------------------------------------------- the light, after main.js has set the hour's
  const base = { haze: env.u.haze.value, betaM: ctx.atm ? ctx.atm.u.betaM.value : 0 };
  const skySeen = { z: env.u.zenith.value.clone(), h: env.u.horizon.value.clone() }, skyOwn = { z: env.u.zenith.value.clone(), h: env.u.horizon.value.clone() };
  const grey = new THREE.Color(), tmp = new THREE.Color();
  let expSeen = renderer.toneMappingExposure, expOwn = NaN;
  function light() {
    const o = cur.cloud, r = Math.max(cur.rain, cur.snow), day = THREE.MathUtils.smoothstep(env.u.sunAlt.value, -0.08, 0.15);
    // the sky's colours are set by setSun every two seconds: what it set is taken as the clear sky, and greyed from it
    if (!env.u.zenith.value.equals(skyOwn.z)) skySeen.z.copy(env.u.zenith.value);
    if (!env.u.horizon.value.equals(skyOwn.h)) skySeen.h.copy(env.u.horizon.value);
    // (a rain cloud's base is darker than a high overcast's)
    grey.setRGB(0.44, 0.47, 0.51).multiplyScalar((0.12 + 0.88 * day) * (1 - 0.3 * r) * (1 - 0.3 * cur.storm));
    env.u.zenith.value.copy(skySeen.z).lerp(tmp.copy(grey).multiplyScalar(0.85), 0.85 * o); skyOwn.z.copy(env.u.zenith.value);
    env.u.horizon.value.copy(skySeen.h).lerp(grey, 0.85 * o); skyOwn.h.copy(env.u.horizon.value);
    if (!(o > 0.002) && !(cur.fog > 0.002)) { if (renderer.toneMappingExposure === expOwn) renderer.toneMappingExposure = expOwn = expSeen; env.u.haze.value = base.haze; if (ctx.atm) ctx.atm.u.betaM.value = base.betaM; return; }
    const k = 1 - 0.85 * o;
    sunL.intensity *= k; env.u.sunI.value *= k;
    if (ctx.light) ctx.light.u.sunE.value.multiplyScalar(k);
    // the sky's light: brighter and greyer under a deck that is lit from above (a white overcast is brighter than a blue sky)
    const lift = 1 + (0.5 - 0.35 * r) * o * day;
    hemi.intensity *= lift; hemi.color.lerp(tmp.setRGB(0.82, 0.86, 0.9), 0.7 * o);
    if (ctx.light) { const L = ctx.light.u.skyE.value, l = (L.r + L.g + L.b) / 3; L.multiplyScalar(lift).lerp(tmp.setRGB(l, l * 1.03, l * 1.08).multiplyScalar(lift), 0.7 * o); }
    env.u.white.value *= 1 - 0.55 * o * day;
    // (a reef site sets its exposure once, an alpine site every frame: what was set is taken as the clear day's)
    if (renderer.toneMappingExposure !== expOwn) expSeen = renderer.toneMappingExposure;
    renderer.toneMappingExposure = expOwn = expSeen * (1 + 0.15 * o * day);
    // the deck's own grey: the light through it from above, about what a white surface under it shows
    u.cloudCol.value.setRGB(0.62, 0.65, 0.69).multiplyScalar(Math.max(env.u.white.value, 1e-6) * (0.9 + 0.5 * day) * (1 - 0.35 * cur.storm));
    // the air: to the weather's visibility (Koschmieder: 3.9 / the extinction), never clearer than the site's own
    const ext = 3.9 / Math.max(S.visibility, 500);
    env.u.haze.value = Math.max(base.haze, Math.min(ext * 0.6, 2.5e-4));
    if (ctx.atm) { ctx.atm.u.betaM.value = Math.max(base.betaM, Math.min(ext * 0.5, 2.5e-4)); ctx.atm.u.E0.value *= 1 - 0.6 * o; }
  }

  // ---------------------------------------------------------------- the state, eased (weather.js create().update's rates)
  function update(dt, tSec) {
    clockAt = clock();
    const want = mode === 'live' ? W.season(climate, ...clockAt) : mode === 'custom' ? custom : W.KINDS[mode] || W.KINDS.clear;
    const tSeason = W.tempAt(climate, ...clockAt, want.cloud || 0);
    target.rain = want.rain || 0; target.cloud = want.cloud || 0; target.snow = want.snow || 0; target.fog = want.fog || 0; target.storm = want.storm || 0;
    target.windK = want.windK ?? 1;
    target.temp = want.temp ?? (want.tempMax != null ? Math.min(tSeason, want.tempMax) : mode === 'live' || !(want.rain > 0.06) ? tSeason : Math.max(tSeason, 2));
    // what falls at the eye: snow where the air there is at or below about a degree (a mountain's rain is snow above
    // the freezing level; the lake shore under it may have rain)
    const tEye = tempAtY(target.temp, camera.position.y);
    if (target.rain > 0 && tEye < 0.8 && !target.snow) { target.snow = target.rain; target.rain = 0; }
    if (snap) {
      Object.assign(cur, target);
      U.uOeWet.value = target.rain > 0.05 ? Math.min(1, 0.5 + target.rain) : 0;
      S.snowDepth = target.snow > 0.05 ? Math.min(1, 0.35 + target.snow * 0.6) : 0;
      snap = false;
    }
    const ease = (a, b, rate) => a + (b - a) * Math.min(1, dt * rate);
    cur.cloud = ease(cur.cloud, target.cloud, 0.25);
    const clouded = cur.cloud > 0.55;
    cur.rain = clouded || target.rain === 0 ? ease(cur.rain, target.rain, 0.35) : ease(cur.rain, 0, 0.35);
    cur.snow = clouded || target.snow === 0 ? ease(cur.snow, target.snow, 0.3) : ease(cur.snow, 0, 0.3);
    cur.storm = cur.rain > 0.4 || target.storm === 0 ? ease(cur.storm, target.storm, 0.2) : ease(cur.storm, 0, 0.2);
    cur.fog = ease(cur.fog, target.fog, 0.12);
    cur.windK = ease(cur.windK, target.windK, 0.15);
    cur.temp = ease(cur.temp, target.temp, 0.2);
    const day = THREE.MathUtils.smoothstep(env.u.sunAlt.value, -0.08, 0.15), sunOut = day * (1 - cur.cloud);
    // the wind: the season's mean, its lulls and gusts (weather.js gustAt) and a bearing that wanders
    const wMean = mode === 'custom' && custom.wind != null ? custom.wind : windBase() * cur.windK * (0.75 + 0.5 * W.gustAt(tSec / 240 + 3.3).gn);
    const { gn, gust } = W.gustAt(tSec);
    const wSpeed = wMean * (0.72 + 0.5 * gn + 0.75 * gust * Math.min(1, 0.35 + wMean / 12));
    const from = ((mode === 'custom' && custom.windFrom != null ? custom.windFrom : windFrom0 + 40 * (W.gustAt(tSec / 300 + 1.7).gn - 0.5)) + 360) % 360;
    const wb = (from + 180) * Math.PI / 180, wx = Math.sin(wb) * wSpeed, wz = -Math.cos(wb) * wSpeed;
    if (dt > 0) windRun += wSpeed * Math.min(dt, 0.1) * (reduced ? 0.3 : 1);
    if (U.uOeWind.value && U.uOeWind.value.set) U.uOeWind.value.set(wx, wz, gust, windRun);
    // the ground: wet in the rain and from melting snow, drying by sun and wind; snow lies while it falls cold
    const wet = U.uOeWet.value, melting = S.snowDepth > 0.02 && cur.temp > 0.5 ? Math.min(1, cur.temp / 6 + 0.5 * sunOut) : 0;
    const dry = (0.45 + 1.1 * sunOut + Math.min(1, wSpeed / 10) * 0.6 + Math.max(0, cur.temp - 15) / 30) / 150;
    U.uOeWet.value = wetPin != null ? wetPin : cur.rain > 0.04 ? Math.min(1, wet + dt * (0.02 + 0.1 * cur.rain)) : melting > 0 ? Math.max(wet - dt * dry, Math.min(0.7, wet + dt * 0.03 * melting)) : Math.max(0, wet - dt * dry);
    if (depthPin != null) S.snowDepth = depthPin;
    else if (cur.snow > 0.04) S.snowDepth = Math.min(1, S.snowDepth + dt * cur.snow / 70);
    else if (S.snowDepth > 0) S.snowDepth = Math.max(0, S.snowDepth - dt * (0.002 + Math.max(0, tempAtY(cur.temp, camera.position.y)) / 400 + sunOut / 220 + cur.rain / 40));
    U.uOeRain.value = cur.rain; U.uOeOvercast.value = cur.cloud; U.uOeSnow.value = S.snowDepth; U.uOeSnowfall.value = cur.snow; U.uOeFog.value = cur.fog; U.uOeT.value = tSec;
    // OEWeather.S: the one state
    const kind = kindOf(cur);
    S.kind = kind; S.cover = cur.cloud; S.rain = cur.rain; S.snow = cur.snow; S.storm = cur.storm; S.fog = cur.fog;
    S.precip = cur.snow > 0.02 && cur.snow >= cur.rain ? 'snow' : cur.rain > 0.02 ? 'rain' : 'none';
    S.rate = Math.max(cur.rain, cur.snow);
    S.mm = cur.snow > cur.rain ? 2.5 * cur.snow * cur.snow : 0.3 * cur.rain + 5.5 * cur.rain * cur.rain + 20 * cur.storm * cur.rain;
    S.wind.x = wx; S.wind.z = wz; S.windSpeed = wSpeed; S.windMean = wMean; S.windFrom = from; S.gust = gust;
    S.temp = tempAtY(cur.temp, camera.position.y); S.wet = U.uOeWet.value; S.day = day; S.t = tSec; S.flash = 0;
    S.visibility = 1 / (1 / 40000 + cur.cloud * cur.cloud / 60000 + cur.fog * cur.fog / 140 + cur.rain * cur.rain / 3500 + cur.storm * cur.rain / 2500 + cur.snow * cur.snow / 700);
    S.grip = Math.max(0.35, 1 - 0.3 * Math.min(1, S.wet * 1.5) - 0.45 * smooth(0.05, 0.4, S.snowDepth));
    S.source = mode === 'live' ? 'season' : mode === 'off' ? 'off' : 'pinned';
    if (kind !== lastKind) { lastKind = kind; api.onKind && api.onKind(kind, S); }

    // ---- what is drawn
    // the sea and the lake: the waves follow the wind against the season's mean
    if (!windPinned) env.u.wind.value = wind0 * Math.min(2.4, Math.max(0.35, wSpeed / Math.max(1.5, windBase())));
    const gov = ctx.governor, extras = gov ? gov.extras : 1, share = extras >= 1 ? 1 : extras > 0 ? 0.5 : 0.25;
    const under = camera.position.y < env.u.tide.value - 0.05, off = mode === 'off';
    const raining = !under && !off && cur.rain > 0.01, snowing = !under && !off && cur.snow > 0.01;
    rain.visible = raining; snow.visible = snowing;
    rings.visible = raining && extras > 0 && camera.position.y - env.u.tide.value < 40;
    deck.visible = !off && cur.cloud > 0.02;
    deck.position.copy(camera.position);
    u.t.value = reduced ? tSec * 0.3 : tSec;
    u.cloud.value = cur.cloud;
    if (dt > 0) u.cloudRun.value.set(u.cloudRun.value.x + wx * dt / 9000, u.cloudRun.value.y + wz * dt / 9000);
    // the drops ride the wind near the ground (about half the 10 m wind); drizzle small and slow, rain big and fast
    const heavy = smooth(0.25, 0.9, cur.rain), fall = raining ? 3.2 + 5.6 * heavy : 1.1;
    u.fallV.value.set(wx * 0.55, -fall, wz * 0.55);
    if (dt > 0) u.drift.value.addScaledVector(u.fallV.value, Math.min(dt, 0.1) * (reduced ? 0.3 : 1));
    u.count.value = Math.min(1, cur.rain * 1.15) * share;
    u.width.value = 0.0012 + 0.0012 * heavy;
    u.alpha.value = (0.11 + 0.11 * heavy) * (0.6 + 0.4 * day);
    u.scount.value = Math.min(1, cur.snow * 1.2) * share;
    u.ring.value = Math.min(1, cur.rain * 1.2) * (0.3 + 0.7 * heavy) * share;
    u.water.value = env.u.tide.value;
    u.pix.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(200, renderer.domElement.height || innerHeight);
    // the light on the drops: the sky's, a white surface's brightness, lighter by day
    const wv = Math.max(env.u.white.value, 1e-6);
    u.col.value.copy(env.u.horizon.value).multiplyScalar(1.25).add(tmp.setRGB(0.04, 0.04, 0.045).multiplyScalar(wv));
    u.scol.value.setRGB(0.95, 0.96, 0.98).multiplyScalar(wv * (1.1 + 0.4 * day));
    u.salpha.value = 0.55 + 0.35 * day;
    // settled snow on the land, down to where the air is at about a degree (the lapse rate from the station), and the
    // ground's wet look (alpine/terrain.js)
    u.fresh.value = S.snowDepth;
    u.line.value = stationM - datum + (cur.temp - 0.5) / 0.0065 - 120 * S.snowDepth;
    u.wet.value = Math.min(1, U.uOeWet.value);
    const tw = ctx.terrain && ctx.terrain.weather;
    if (tw) { tw.fresh.value = u.fresh.value; tw.line.value = u.line.value; tw.wet.value = u.wet.value; }
  }

  const api = {
    S, u, mode: () => mode,
    // pin a weather ('clear', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'), exact amounts ({rain, snow, fog,
    // storm, cloud, wet, snowDepth, temp, wind, windFrom}), or the season ('live'); now: no easing in
    set(m, { now = false } = {}) {
      if (m && typeof m === 'object') {
        const k = kindOf({ rain: m.rain || 0, snow: m.snow, fog: m.fog, storm: m.storm, cloud: m.cloud ?? 0 }), K = W.KINDS[k];
        custom = { rain: m.rain ?? K.rain, snow: m.snow ?? 0, fog: m.fog ?? 0, storm: m.storm ?? 0, cloud: m.cloud ?? Math.max(K.cloud, (m.rain > 0.06 || m.snow > 0.06) ? 0.9 : 0),
          windK: K.windK, tempMax: K.tempMax, temp: m.temp, wind: m.wind, windFrom: m.windFrom };
        mode = 'custom'; wetPin = m.wet ?? null; depthPin = m.snowDepth ?? null;
      } else if (W.KINDS[m] || m === 'live' || m === 'off') { mode = m; wetPin = depthPin = null; custom = null; }
      else return;
      if (now) snap = true;
    },
    // the season's weather at the clock now (for a line in the journal)
    season: () => W.season(climate, ...clock()),
    describe: () => W.describe(S),
    meshes: { rain, snow, rings, deck },
    light,
    onKind: null,
  };
  ctx.weather = api;
  update(0, 0);
  return { update };
}
