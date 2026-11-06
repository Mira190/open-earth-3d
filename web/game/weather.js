// Open Earth 3D weather: dry, overcast, drizzle and rain, for every city in the game.
//
// What the weather is comes from the city's climate (city.json game.weather: the mean number of
// days a month with measurable rain, from the national weather service's 1991-2020 normals) and the
// date and hour on the game's clock. Each day of the year is wet or dry by a hash of its date, so the
// same morning always has the same weather, and a wet day's rain comes and goes in showers from a
// smooth noise over the hours. A quest (set_weather), the pause menu or the page's ?weather= can pin
// one instead. Automated runs (navigator.webdriver) keep a clear sky unless they ask for weather, so
// stills and checks stay comparable.
//
// What it looks like, after the work it learnt from (docs/weather.md):
//  - Rain streaks: instanced quads around the camera in two shells, near and far, each a drop's
//    path over a 1/40 s shutter relative to the camera, so a moving camera slants them; at least a
//    pixel wide, fading with their real width (Tatarchuk, "Artist-directable real-time rain
//    rendering", ATI ToyShop, 2006). World-stable: the drops wrap round the camera, they don't ride with it.
//  - Rain occlusion: a height map of the scene seen from straight above, round the camera, so no
//    rain falls under a roof, a deck or a tree, and the splashes land on whatever is on top
//    (the same idea as the rain occlusion maps of Frostbite and Unreal's weather systems).
//  - Splashes: small crowns and rings popping on the tops of things near the camera.
//  - Wet surfaces and puddles: darker albedo where porous, lower roughness, puddles that grow in
//    low noise where the ground is paved, with expanding ripple rings in them and on ponds and the sea
//    (after Sébastien Lagarde's "Water drop" series, 2012-13, on wet surfaces in PBR).
//  - Overcast light: a weaker sun and a stronger, greyer sky light, a closer grey-blue haze, clouds
//    over the sky and a slightly cooler, softer grade, with exposure lifted so it never goes grey.
//  - Sound: rain hiss and patter, a drumming roof when you stand under one (audio.js).
// One shared state: OEWeather.U (uOeWet, uOeRain, uOeOvercast, uOeT) is what every patched shader
// reads, so a city's own wet-street look (Shibuya's reflections, #112) follows the same rain.
'use strict';
window.OEWeather = (function () {
  const U = { uOeWet: { value: 0 }, uOeRain: { value: 0 }, uOeOvercast: { value: 0 }, uOeT: { value: 0 },
    // the rain occlusion map (heights of the tops of things round the camera, from above) and its frame
    uOeOcc: { value: null }, uOeOccBox: { value: null }, uOeOccOn: { value: 0 }, uOeOccBase: { value: 0 } };
  const KINDS = {
    clear: { rain: 0, cloud: 0 },
    overcast: { rain: 0, cloud: 0.85 },
    drizzle: { rain: 0.3, cloud: 0.95 },
    rain: { rain: 0.85, cloud: 1 },
  };
  const NAMES = { live: 'As the season brings it', clear: 'Clear', overcast: 'Overcast', drizzle: 'Drizzle', rain: 'Rain', off: 'Off' };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  // a well-mixed hash of an integer (a day) and a salt, 0..1
  const ihash = (n, salt) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35); x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };

  // ------------------------------------------------------------ shared GLSL
  const GLSL = `
uniform float uOeWet; uniform float uOeRain; uniform float uOeT;
uniform sampler2D uOeOcc; uniform vec4 uOeOccBox; uniform float uOeOccOn; uniform float uOeOccBase;
// 1 where something stands over p (a roof, a deck, a tree) by more than lift metres, from the
// occlusion map round the camera; 0 in the open or beyond the map
float oeCover(vec3 p, float lift) {
  if (uOeOccOn < 0.5) return 0.0;
  vec2 uv = (p.xz - uOeOccBox.xy) / uOeOccBox.zw + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  vec4 o = textureLod(uOeOcc, uv, 0.0);
  return o.a > 0.5 && p.y < o.r + uOeOccBase - lift ? 1.0 : 0.0;
}
float oeH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float oeN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(oeH(i), oeH(i + vec2(1, 0)), f.x), mix(oeH(i + vec2(0, 1)), oeH(i + vec2(1, 1)), f.x), f.y); }
// where water stands, 0..1, at the current wetness: puddles fill the low spots of a noise first
float oePuddle(vec2 xz) {
  float n = oeN(xz * 0.21) * 0.58 + oeN(xz * 0.67 + 7.3) * 0.3 + oeN(xz * 2.3 + 1.7) * 0.12;
  float fill = smoothstep(0.25, 1.0, uOeWet);
  return smoothstep(0.71 - 0.09 * fill, 0.77 - 0.09 * fill, n) * fill;
}
// rain ripples: in each cell of three offset grids a drop lands at a random moment and spot and a
// ring runs out from it and fades; returns the slope of the water (x, z)
vec2 oeRipple(vec2 xz, float camD) {
  vec2 g = vec2(0.0);
  float fade = 1.0 - smoothstep(6.0, 28.0, camD);
  if (fade <= 0.0 || uOeRain <= 0.0) return g;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 p = xz * (2.6 + 0.7 * fk) + vec2(0.37, 0.71) * fk;
    vec2 i = floor(p), f = fract(p) - 0.5;
    float h = oeH(i + fk * 13.1);
    if (h > 0.25 + 0.75 * uOeRain) continue; // fewer drops in a drizzle
    float ph = fract(uOeT * (0.9 + 0.5 * h) + h * 7.0);
    vec2 c = (vec2(oeH(i + 1.3 + fk), oeH(i + 2.7 - fk)) - 0.5) * 0.3;
    vec2 d = f - c; float r = length(d), rr = ph * 0.36;
    float ring = sin((r - rr) * 52.0) * smoothstep(0.07, 0.0, abs(r - rr)) * (1.0 - ph) * (1.0 - ph);
    g += (r > 1e-3 ? d / r : vec2(0.0)) * ring;
  }
  return g * 0.55 * fade;
}`;
  // patch a MeshStandardMaterial's shader to get wet. o.gloss: a GLSL expression (0..1) for what
  // turns glossy when wet (paving and asphalt, not grass); o.puddles: where water may stand (on
  // the flat only); o.porous: how much darker it gets; o.water: a pond or the sea, which only takes
  // the ripples. Under cover (the occlusion map) it stays dry. Chains onto whatever it already does.
  function patch(sh, o = {}) {
    Object.assign(sh.uniforms, U);
    if (sh.vertexShader.indexOf('vOeW') < 0) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOeW; varying vec3 vOeN;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 oeP = vec4(transformed, 1.0); vec3 oeNo = objectNormal;
#ifdef USE_INSTANCING
  oeP = instanceMatrix * oeP; oeNo = mat3(instanceMatrix) * oeNo;
#endif
  vOeW = (modelMatrix * oeP).xyz; vOeN = normalize(mat3(modelMatrix) * oeNo); }`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vOeW; varying vec3 vOeN;
${GLSL}`);
    const porous = (o.porous ?? 0.4).toFixed(3), puddles = o.puddles || '0.0', gloss = o.gloss || '1.0';
    if (!o.water) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float oeCamD = distance(vOeW, cameraPosition);
float oeOpen = 1.0 - oeCover(vOeW, 0.6);
float oeUp = smoothstep(0.15, 0.75, vOeN.y), oeFlat = smoothstep(0.96, 0.995, vOeN.y);
float oeWet = uOeWet * oeOpen * (0.3 + 0.7 * oeUp);
float oeGl = clamp(${gloss}, 0.0, 1.0) * oeWet;
diffuseColor.rgb *= mix(1.0, 1.0 - ${porous}, oeWet);
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.42), oeGl);
float oePd = uOeWet > 0.001 ? oePuddle(vOeW.xz) * clamp(${puddles}, 0.0, 1.0) * oeFlat * oeOpen : 0.0; // (dry: no noise to work out)
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, oePd);
roughnessFactor = mix(roughnessFactor, 0.06, oePd);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (oePd > 0.0) { vec2 oeR = oeRipple(vOeW.xz, oeCamD);
  normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, oePd * 0.9) + (viewMatrix * vec4(oeR.x, 0.0, oeR.y, 0.0)).xyz * oePd); }`)
        // the sky a wet street reflects is mostly hidden by the street's own walls and trees: the
        // reflection of the open sky (the only one the environment map holds) is held well down
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  radiance *= mix(1.0, 0.42, max(oeGl, oePd));
#endif`);
    } else {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec2 oeR = oeRipple(vOeW.xz, distance(vOeW, cameraPosition)); normal = normalize(normal + (viewMatrix * vec4(oeR.x, 0.0, oeR.y, 0.0)).xyz * 2.0); }`)
        // the rain on a pond: a glassier surface, so its rings catch the sky
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.1), smoothstep(0.0, 0.3, uOeRain));`)
        // and, as on the wet ground, the open sky it reflects is mostly the trees' and the walls' round it
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  radiance *= mix(1.0, 0.5, smoothstep(0.0, 0.3, uOeRain));
#endif`);
    }
    return sh;
  }
  // chain a patch onto a material's own onBeforeCompile, and give it its own program key
  function wrap(mat, o, key) {
    if (!mat || mat.userData.oeWeather) return;
    mat.userData.oeWeather = true;
    const own = mat.onBeforeCompile, ownKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) { if (own) own.call(this, sh, r); patch(sh, o); };
    mat.customProgramCacheKey = function () { return `${ownKey ? ownKey.call(this) : ''}|oew|${key}`; };
    mat.needsUpdate = true;
  }

  // ------------------------------------------------------------ the rain
  const STREAK_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uVel; uniform vec3 uFwd; uniform vec3 uBox;
uniform float uSpeed; uniform float uShutter; uniform float uWidth; uniform float uCount; uniform float uAlpha;
uniform vec2 uWind; uniform vec2 uRes;
varying vec2 vUv; varying float vA;
${GLSL}
void main() {
  vUv = position.xy; vA = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uCount) return;
  float rnd = fract(aSeed.x * 91.7 + aSeed.z * 13.3 + aSeed.y * 5.1);
  vec3 B = uBox * 2.0, c = uCam + uFwd * vec3(uBox.x, 0.0, uBox.z) * 0.6;
  vec3 fall = vec3(uWind.x, -uSpeed * (0.85 + 0.3 * rnd), uWind.y);
  vec3 p = aSeed.xyz * B + fall * uOeT;
  p = c + mod(p - c + 0.5 * B, B) - 0.5 * B;
  vec3 e = abs(p - c) / uBox;
  float edge = max(e.x, max(e.y, e.z));
  if (oeCover(p, 0.05) > 0.5) return;
  vec3 vr = fall - uVel;
  vec3 tail = p - vr * uShutter;
  vec4 h = projectionMatrix * viewMatrix * vec4(p, 1.0), t = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (h.w < 0.4 || t.w < 0.4) return;
  vec2 hp = h.xy / h.w * 0.5 * uRes, tp = t.xy / t.w * 0.5 * uRes, d = hp - tp;
  float L = length(d);
  vec2 dir = L > 1e-3 ? d / L : vec2(0.0, 1.0), n = vec2(-dir.y, dir.x);
  float wpx = uWidth * (0.7 + 0.6 * rnd) * projectionMatrix[1][1] * 0.5 * uRes.y / h.w, w = max(wpx, 1.15);
  vA = uAlpha * sqrt(min(1.0, wpx / w)) * smoothstep(1.0, 0.75, edge) * smoothstep(0.5, 1.4, h.w) * min(1.0, 4.0 / max(L, 4.0) * 6.0);
  vec4 P = mix(h, t, position.y);
  vec2 off = n * position.x * w * 0.5 + dir * (position.y < 0.5 ? 1.0 : -1.0) * w * 0.5;
  P.xy += off / (0.5 * uRes) * P.w;
  gl_Position = P;
}`;
  const STREAK_FS = `
uniform vec3 uCol; varying vec2 vUv; varying float vA;
void main() {
  float a = vA * (1.0 - vUv.x * vUv.x) * smoothstep(0.0, 0.3, vUv.y) * (0.55 + 0.45 * smoothstep(1.0, 0.2, vUv.y));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uCol * a, a * 0.55);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  // a splash: a ring on the surface (z 0) and a little crown standing on it (z 1), facing the camera
  const SPLASH_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uCount; uniform float uR; uniform float uAlpha;
varying vec2 vUv; varying float vA; varying float vLife; varying float vKind;
${GLSL}
float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
void main() {
  vUv = position.xy; vKind = position.z; vA = 0.0; vLife = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uCount || uOeOccOn < 0.5) return;
  float cyc = uOeT * (1.6 + aSeed.z) + aSeed.y * 9.0, k = floor(cyc), life = fract(cyc);
  if (life > 0.32) return;
  vLife = life / 0.32;
  float a = h1(k + aSeed.x * 311.0) * 6.2832, r = sqrt(h1(k * 1.7 + aSeed.y * 97.0)) * uR;
  vec3 p = vec3(uCam.x + cos(a) * r, 0.0, uCam.z + sin(a) * r);
  vec2 uv = (p.xz - uOeOccBox.xy) / uOeOccBox.zw + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return;
  vec4 o = textureLod(uOeOcc, uv, 0.0);
  if (o.a < 0.5) return;
  p.y = o.r + uOeOccBase + 0.01;
  float s = 0.05 + 0.13 * vLife + 0.04 * aSeed.z;
  vec3 wp;
  if (vKind < 0.5) wp = p + vec3(position.x, 0.0, position.y) * s * 1.4;
  else {
    vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
    wp = p + right * position.x * s * 0.9 + vec3(0.0, (position.y * 0.5 + 0.5) * s * 0.9, 0.0);
  }
  float camD = distance(p, cameraPosition);
  vA = uAlpha * smoothstep(uR, uR * 0.6, camD) * smoothstep(0.6, 2.0, camD);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
  const SPLASH_FS = `
uniform vec3 uCol; varying vec2 vUv; varying float vA; varying float vLife; varying float vKind;
void main() {
  float a;
  if (vKind < 0.5) { float r = length(vUv); a = smoothstep(0.16, 0.0, abs(r - 0.35 - 0.55 * vLife)) * (1.0 - vLife) * step(r, 1.0); }
  else {
    // a crown: a few beads thrown up on a thin sheet, fading as they fall back
    vec2 q = vec2(vUv.x, vUv.y * 0.5 + 0.5);
    float sheet = smoothstep(0.55, 0.0, abs(q.x)) * smoothstep(0.35, 0.0, q.y) * (1.0 - vLife);
    float beads = 0.0;
    for (int i = 0; i < 4; i++) { float fi = float(i), an = 0.5 + 0.7 * fi + 0.4 * sin(fi * 3.7);
      vec2 b = vec2(cos(an) * 0.55 * (0.4 + vLife), sin(an) * (0.7 - 0.5 * vLife * vLife) + 0.05);
      beads += smoothstep(0.09, 0.02, length(q - b)) * (0.6 + 0.4 * sin(fi * 5.3)); }
    a = (sheet * 0.6 + beads) * (1.0 - vLife * 0.7);
  }
  a *= vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol * a, a * 0.6);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  function quads(n, verts, idx) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    const s = new Float32Array(n * 4);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) { s[4 * i] = rnd(); s[4 * i + 1] = rnd(); s[4 * i + 2] = rnd(); s[4 * i + 3] = (i + rnd()) / n; }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
    g.instanceCount = n;
    return g;
  }

  // the climate's chance of rain on a day of month m (1..12): a day with measurable rain
  function wetChance(cl, m) {
    if (!cl || !cl.rain_days) return 0;
    const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    // a 0.1 mm or 0.5 mm count includes days of a few drops nobody sees fall
    const k = cl.threshold_mm >= 1 ? 1 : cl.threshold_mm >= 0.5 ? 0.9 : 0.78;
    return Math.min(0.85, cl.rain_days[m - 1] / days * k);
  }
  // the weather the season brings at a local time: {rain 0..1, cloud 0..1}
  function season(cl, y, m, d, min) {
    if (!cl || !cl.rain_days) return { rain: 0, cloud: 0.2 };
    const dayN = Math.floor(Date.UTC(y, m - 1, d) / 864e5), h = dayN * 24 + min / 60;
    const salt = Math.round(cl.rain_days.reduce((a, b) => a + b, 0) * 10); // each climate its own run of days
    const day = n => {
      const t = new Date(n * 864e5), mm = t.getUTCMonth() + 1, p = wetChance(cl, mm);
      const wet = ihash(n, salt) < p, drizzly = ihash(n, salt + 1) < (cl.drizzle ?? 0.45);
      const grey = wet || ihash(n, salt + 2) < Math.min(0.8, p * 1.1);
      return { wet, cap: drizzly ? 0.38 : 1, grey };
    };
    const at = n => {
      const D = day(n);
      if (!D.wet) return { rain: 0, cloud: D.grey ? 0.55 + 0.3 * vnoise(h / 5 + n) : 0.1 + 0.25 * vnoise(h / 4 + n) };
      const s = smooth(0.32, 0.72, vnoise(h / 2.6 + n * 3.1) * 0.75 + vnoise(h / 0.7 + n) * 0.25);
      return { rain: s * D.cap, cloud: 0.75 + 0.25 * smooth(0, 0.3, s) };
    };
    const a = at(dayN);
    // a day's weather runs into the next across midnight
    const edge = min < 120 ? at(dayN - 1) : min > 1320 ? at(dayN + 1) : null;
    if (!edge) return a;
    const k = min < 120 ? 0.5 * (1 - min / 120) : 0.5 * (min - 1320) / 120;
    return { rain: a.rain + (edge.rain - a.rain) * k, cloud: a.cloud + (edge.cloud - a.cloud) * k };
  }
  const kindOf = s => (s.rain > 0.5 ? 'rain' : s.rain > 0.06 ? 'drizzle' : s.cloud > 0.6 ? 'overcast' : 'clear');

  // ------------------------------------------------------------ the game's weather
  // Wd: the world (world.js); atmos: atmosphere.js; climate: game.json weather; QC: OEQuality.city()
  function create(Wd, renderer, camera, { climate = null, QC = null, sky = {} } = {}) {
    const world = Wd.world, su = Wd.su;
    const tier = (QC && QC.name) || 'high';
    const T = { high: { near: 6000, far: 9000, splash: 700, occ: 256 }, medium: { near: 4000, far: 5000, splash: 420, occ: 256 }, low: { near: 2200, far: 2200, splash: 200, occ: 128 } }[tier] || { near: 4000, far: 5000, splash: 420, occ: 256 };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // the wet look on the materials that take it, once the weather runs (arm): a device the guard
    // keeps the weather off on never compiles it
    // (the ground is patched from game.js, which knows its paving and road classes: patchGround)
    let armed = false;
    const onArm = [];
    function arm() {
      if (armed) return;
      armed = true;
      if (Wd.lmMats) for (const [k, m] of Object.entries(Wd.lmMats)) {
        if (/pond|water|pool|moat/i.test(k)) wrap(m, { water: true }, k);
        else if (m.userData.paving || /pav|plaza|flagstone|^sk_stone|gravel|path/i.test(k)) wrap(m, { puddles: '0.6', porous: 0.35 }, k);
      }
      if (Wd.waterMat) wrap(Wd.waterMat, { water: true }, 'waterMat');
      armSea();
      onArm.forEach(f => f());
    }
    // the sea's own shader (water.js) works out its normal itself: its ripples go in there
    function armSea() {
    if (Wd.sea && Wd.sea.material && !Wd.sea.material.userData.oeWeather) {
      const m = Wd.sea.material, own = m.onBeforeCompile;
      m.userData.oeWeather = true;
      m.onBeforeCompile = function (sh, r) {
        if (own) own.call(this, sh, r);
        Object.assign(sh.uniforms, U);
        const at = 'wN = normalize(vec3(-slope.x, 1.0, -slope.y));';
        if (sh.fragmentShader.indexOf(at) >= 0) {
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL}`)
            .replace(at, `${at}\n  { vec2 oeR = oeRipple(vXZ, camD); wN = normalize(wN + vec3(oeR.x, 0.0, oeR.y) * 1.1); }`);
        }
      };
      const ownKey = m.customProgramCacheKey;
      m.customProgramCacheKey = function () { return `${ownKey ? ownKey.call(this) : ''}|oew`; };
      m.needsUpdate = true;
    }
    }

    // the rain occlusion map: heights of the tops of things, from straight above, round the camera
    const OCC_R = 40, occOk = !!(QC ? QC.post : true) && renderer.capabilities.isWebGL2;
    const occRT = occOk ? new THREE.WebGLRenderTarget(T.occ, T.occ, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false }) : null;
    const occCam = new THREE.OrthographicCamera(-OCC_R, OCC_R, OCC_R, -OCC_R, 1, 4000);
    occCam.up.set(0, 0, -1);
    if (!U.uOeOccBox.value) U.uOeOccBox.value = new THREE.Vector4(0, 0, 1, 1); // (THREE is there once the game starts, not when this file loads)
    const occBase = U.uOeOccBase, occBox = U.uOeOccBox, occOn = U.uOeOccOn;
    U.uOeOcc.value = occRT ? occRT.texture : null;
    const occMat = new THREE.ShaderMaterial({
      uniforms: { uBase: occBase },
      vertexShader: `uniform float uBase; varying float vY;
        void main() { vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
          p = modelMatrix * p; vY = p.y - uBase; gl_Position = projectionMatrix * viewMatrix * p; }`,
      fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }',
      side: THREE.DoubleSide });
    // rain itself, two shells round the camera
    const QV = [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], QI = [0, 1, 2, 2, 1, 3];
    const shared = Object.assign({ uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0.6, 0.3) }, uRes: { value: new THREE.Vector2(1, 1) }, uCol: { value: new THREE.Color(0.8, 0.85, 0.9) } }, U);
    const streaks = (n, box, width, alpha) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, shared, { uBox: { value: new THREE.Vector3(box[0], box[1], box[0]) }, uSpeed: { value: 8 }, uShutter: { value: 0.025 },
          uWidth: { value: width }, uCount: { value: 0 }, uAlpha: { value: alpha }, uAlpha0: { value: alpha } }),
        vertexShader: STREAK_VS, fragmentShader: STREAK_FS, transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, fog: false });
      const m = new THREE.Mesh(quads(n, QV, QI), mat);
      m.frustumCulled = false; m.renderOrder = 5; m.visible = false; m.userData.oeNoOcc = true;
      world.add(m);
      return m;
    };
    const near = streaks(T.near, [9, 7], 0.0045, 0.6), far = streaks(T.far, [30, 18], 0.006, 0.4);
    const SV = [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1], SI = [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7];
    const splashMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, shared, { uCount: { value: 0 }, uR: { value: 16 }, uAlpha: { value: 0.5 } }),
      vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, fog: false });
    const splash = new THREE.Mesh(quads(T.splash, SV, SI), splashMat);
    splash.frustumCulled = false; splash.renderOrder = 5; splash.visible = false; splash.userData.oeNoOcc = true;
    world.add(splash);

    // state
    const params = new URLSearchParams(location.search);
    const asked = params.get('weather');
    let mode = KINDS[asked] || asked === 'live' || asked === 'off' ? asked : navigator.webdriver ? 'clear' : 'live';
    let chosen = !!asked; // the visitor (or the page's address) chose the weather: the guard never turns it off then
    try { if (!asked && !navigator.webdriver) { const v = localStorage.getItem('oe3d-weather'); if (v && (KINDS[v] || v === 'live' || v === 'off')) { mode = v; chosen = true; } } } catch (e) { /* storage blocked */ }
    // Weather the device cannot carry is not started. Rain costs a second render of the scene for the
    // wet street's reflections (mirror.js, high tier), a pass from above for the occlusion map, and
    // thousands of streaks; a wet street costs its puddles' noise and reflections for minutes after
    // the rain. The game watches the frame rate and sheds what a slow device can do without
    // (game.js shed: one step every 4 s below 24 fps), and the weather's share of that is api.shed:
    //  - 1, light: the far streaks and the splashes left out, the occlusion map drawn less often;
    //  - 2, off: a clear sky and dry streets, as when the season's weather never started (its shaders
    //    stay out of the materials). A weather the visitor chose stays, wet and grey, without drops.
    // On the low tier (a software renderer, a phone, a device with 4 GB or less: quality.js) the
    // season's weather starts off. What was shed is remembered (localStorage oe3d-weather-guard), so
    // the next visit starts there, and said once in a toast that points at the menu, where any weather
    // the visitor picks is kept as picked. Automated runs remember nothing and start as the tier says
    // (light on the low tier) unless the address asks for the device rules (?weatherguard).
    const GUARD_KEY = 'oe3d-weather-guard';
    let guardOn = !navigator.webdriver || params.has('weatherguard');
    let level = tier === 'low' ? 1 : 2; // 2 the full weather, 1 light, 0 off
    let dropless = false; // a chosen weather shed to its wet streets and sky
    let guardNote = null;
    if (guardOn && !chosen && mode === 'live') {
      let kept = null;
      try { kept = localStorage.getItem(GUARD_KEY); } catch (e) { /* storage blocked */ }
      if (kept === 'off') { level = 0; guardNote = 'Weather is off: it ran slowly here last time. Turn it on in the menu (Esc).'; }
      else if (tier === 'low' && kept !== 'light') { level = 0; guardNote = 'Weather is off on this device, to keep it smooth. Turn it on in the menu (Esc).'; }
      else if (kept === 'light') level = 1;
    }
    if (level === 0) mode = 'off';
    if (mode !== 'off') arm();
    const remember = v => { if (!guardOn) return; try { if (v) localStorage.setItem(GUARD_KEY, v); else localStorage.removeItem(GUARD_KEY); } catch (e) { /* storage blocked */ } };
    function setLevel(l, note) {
      level = l;
      if (l === 0) { mode = 'off'; snap = true; wetPin = null; custom = null; } // (a pinned wetness too: dry streets)
      remember(l === 0 ? 'off' : l === 1 ? 'light' : null);
      if (note) { guardNote = note; if (api.onGuard) { api.onGuard(note); guardNote = null; } }
    }
    const cur = { rain: 0, cloud: 0 }, target = { rain: 0, cloud: 0 };
    let custom = null, wetPin = null;
    let clockAt = null, snap = true, cover = { roof: false, h: 0, at: 0 }, occT = -9, occAt = new THREE.Vector3(1e9, 0, 0), hideList = [], hideAt = -99;
    const lastCam = new THREE.Vector3().copy(camera.position), vel = new THREE.Vector3();
    const baseClouds = su && su.cloudCoverage ? [su.cloudCoverage.value, su.cloudDensity.value] : null;
    const readBuf = new Uint16Array(4);
    const api = {
      U, kinds: Object.keys(KINDS), names: NAMES, meshes: { near, far, splash }, occ: occRT,
      get mode() { return mode; },
      get kind() { return kindOf(cur); },
      // how much a slow device has shed (0 nothing, 1 light, 2 off or, for a chosen weather, no drops):
      // game.js shed raises it a step at a time (see above)
      get shed() { return level === 0 || dropless ? 2 : 2 - level; },
      set shed(v) {
        if (v >= 2 && this.shed < 2) {
          if (chosen) { dropless = true; setLevel(1); }
          else setLevel(0, 'Weather is off: this device is busy enough without it. Turn it on in the menu (Esc).');
        } else if (v === 1 && level === 2) setLevel(1);
      },
      // the level (2 full, 1 light, 0 off), whether the wet look is compiled in, and a callback for
      // whatever else needs recompiling once it is (the ground: game.js)
      get level() { return level; },
      get armed() { return armed; },
      onArm(f) { onArm.push(f); },
      // what was shed, to say once the game can show it
      onGuard: null,
      takeNote() { const n = guardNote; guardNote = null; return n; },
      guardState: () => ({ level, mode, chosen, dropless, tier }),
      // for the checks: the device rules on or off, and forget what was remembered and shed
      guardForce(v) { guardOn = !!v; },
      guardReset() { remember(null); level = 2; dropless = false; chosen = false; if (mode === 'off') mode = 'live'; arm(); },
      get state() { return { mode, level, kind: kindOf(cur), rain: cur.rain, cloud: cur.cloud, wet: U.uOeWet.value, covered: cover.roof, coverH: cover.h }; },
      // pin a weather ('clear', 'overcast', 'drizzle', 'rain'), or exact amounts ({rain, cloud, wet}
      // 0..1, for a still or a film), or follow the season ('live'); now: no easing in; keep:
      // remember it for the next visit
      set(m, { now = false, keep = false } = {}) {
        if (m && typeof m === 'object') {
          const k = m.rain > 0.5 ? 'rain' : m.rain > 0.06 ? 'drizzle' : (m.cloud ?? 0) > 0.6 ? 'overcast' : 'clear';
          custom = { rain: m.rain ?? KINDS[k].rain, cloud: m.cloud ?? Math.max(KINDS[k].cloud, m.rain > 0.06 ? 0.9 : 0) };
          mode = 'custom'; wetPin = m.wet ?? null; arm();
          if (now || m.now) snap = true;
          return;
        }
        if (!(KINDS[m] || m === 'live' || m === 'off')) return;
        mode = m; wetPin = null;
        if (now || m === 'off') snap = true;
        if (m !== 'off') { arm(); if (level === 0) level = 1; } // asked for: back on, light until the device shows it can carry more
        if (keep) {
          // the visitor's own pick, from the menu: kept as picked, and what was remembered forgotten
          chosen = true; dropless = false;
          if (m !== 'off') { level = 2; remember(null); }
          try { localStorage.setItem('oe3d-weather', m); } catch (e) { /* storage blocked */ }
        }
      },
      // the clock, so the season can choose (local date and minutes)
      clock(y, mo, d, min) { clockAt = [y, mo, d, min]; },
      // the season's weather at a local time, for a quest's line or the menu
      season: (y, mo, d, min) => season(climate, y, mo, d, min),
      patchGround(sh, puddles) { patch(sh, { puddles, porous: 0.42 }); },
      // after the world has set this hour's light (world.js setSun): the weather's share of it
      light() {
        const o = cur.cloud, r = cur.rain, day = Wd.day ?? 1;
        U.uOeOvercast.value = o;
        if (!(o > 0.001)) return;
        if (Wd.sunLight) Wd.sunLight.intensity *= 1 - 0.82 * o;
        if (Wd.hemi) {
          Wd.hemi.intensity *= 1 + (0.9 - 0.3 * r) * o * day;
          Wd.hemi.color.lerp(new THREE.Color(0xbcc6cc), 0.7 * o * day);
        }
        // a closer, greyer haze, warmer at night where the city's lights are in it
        const fog = world.fog;
        if (fog) {
          const grey = new THREE.Color(0xa7b0b6).multiplyScalar(0.25 + 0.75 * day);
          if (day < 0.5) grey.lerp(fog.color.clone(), 0.6 + 0.4 * (1 - 2 * day));
          fog.color.lerp(grey, 0.75 * o);
          fog.near *= 1 - 0.7 * r; fog.far *= 1 - (0.25 * o + 0.5 * r);
        }
        if (su && su.uHaze && su.uHazeOn && su.uHazeOn.value > 0.5) su.uHaze.value.lerp(fog.color, 0.6 * o);
        renderer.toneMappingExposure *= 1 + 0.38 * o * day;
      },
      update(dt, tSec, focus) {
        // what the weather should be now
        const want = mode === 'live' ? (clockAt ? season(climate, ...clockAt) : { rain: 0, cloud: 0.2 }) : mode === 'custom' ? custom : KINDS[mode] || KINDS.clear; // (off: a clear sky, dry streets)
        target.rain = want.rain; target.cloud = want.cloud;
        if (snap) { cur.rain = target.rain; cur.cloud = target.cloud; U.uOeWet.value = target.rain > 0.05 ? Math.min(1, 0.5 + target.rain) : 0; snap = false; }
        const ease = (a, b, rate) => a + (b - a) * Math.min(1, dt * rate);
        cur.cloud = ease(cur.cloud, target.cloud, 0.25);
        cur.rain = cur.cloud > 0.55 || target.rain === 0 ? ease(cur.rain, target.rain, 0.35) : ease(cur.rain, 0, 0.35); // rain waits for its clouds
        const wet = U.uOeWet.value;
        U.uOeWet.value = wetPin != null ? wetPin : cur.rain > 0.04 ? Math.min(1, wet + dt * (0.02 + 0.1 * cur.rain)) : Math.max(0, wet - dt / 150);
        U.uOeRain.value = cur.rain;
        U.uOeT.value = reduced ? tSec * 0.3 : tSec;
        if (su && su.cloudCoverage && baseClouds) {
          const ct = su.cloudTrim || 0; // (more cloud for a shot: the overture's sunset sky, overture.js)
          su.cloudCoverage.value = Math.min(0.97, baseClouds[0] + ct + (0.97 - baseClouds[0] - ct) * smooth(0, 1, cur.cloud));
          su.cloudDensity.value = baseClouds[1] + (0.85 - baseClouds[1]) * cur.cloud;
        }
        // the camera's velocity, smoothed, for the slant of the streaks
        if (dt > 0) { const v = camera.position.clone().sub(lastCam).divideScalar(dt); if (v.length() > 80) v.set(0, 0, 0); vel.lerp(v, Math.min(1, dt * 8)); }
        lastCam.copy(camera.position);
        // light (shed 1): no far streaks or splashes; a chosen weather shed further: no drops at all
        const raining = cur.rain > 0.01, light = level < 2;
        near.visible = raining && !dropless; far.visible = splash.visible = raining && !light;
        if (!raining) { occOn.value = 0; return; }
        const fwd = camera.getWorldDirection(new THREE.Vector3());
        const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
        shared.uCam.value.copy(camera.position); shared.uVel.value.copy(vel); shared.uFwd.value.copy(fwd); shared.uRes.value.copy(sz);
        // drizzle: small, slow drops; rain: big fast ones
        const heavy = smooth(0.25, 0.9, cur.rain);
        for (const m of [near, far]) {
          const u = m.material.uniforms;
          u.uSpeed.value = 3.2 + 5.6 * heavy;
          u.uCount.value = Math.min(1, cur.rain * 1.15);
          u.uWidth.value = (m === near ? 0.0028 : 0.004) + (m === near ? 0.0025 : 0.003) * heavy;
          u.uAlpha.value = u.uAlpha0.value * (0.55 + 0.45 * heavy);
          u.uShutter.value = 0.03;
        }
        splashMat.uniforms.uCount.value = Math.min(1, cur.rain * 1.1) * (0.25 + 0.75 * heavy);
        shared.uWind.value.set(0.5 + 0.9 * heavy, 0.25 + 0.4 * heavy);
        // the light on the drops: the haze's colour, brighter by day, warm from the city at night
        const day = Wd.day ?? 1, fc = world.fog ? world.fog.color : new THREE.Color(0.7, 0.75, 0.8);
        shared.uCol.value.copy(fc).multiplyScalar(1.0 + 0.9 * day).add(new THREE.Color(0.16, 0.13, 0.09).multiplyScalar(1 - day));
        // the occlusion map, when the camera has moved or a little time has passed
        if (occRT && (tSec - occT > (light ? 2 : 0.5) || camera.position.distanceTo(occAt) > (light ? 8 : 4))) {
          occT = tSec; occAt.copy(camera.position);
          renderOcc(tSec);
        }
        if (focus) api.focus = focus;
      },
      // while the game loads: the rain's own materials and its pass from above drawn once, so their
      // shaders compile then rather than in a stall as the first rain comes on
      warm() {
        if (api.shed >= 2) return;
        const was = [near.visible, far.visible, splash.visible];
        near.visible = far.visible = splash.visible = true;
        try { renderer.compile(world, camera); if (occRT) renderOcc(-9); } finally { [near.visible, far.visible, splash.visible] = was; occOn.value = 0; occT = -9; }
      },
      // is a point under cover (a roof within a few metres overhead)? from the last occlusion map
      covered: () => cover.roof,
      dispose() { if (occRT) occRT.dispose(); for (const m of [near, far, splash]) { world.remove(m); m.geometry.dispose(); m.material.dispose(); } },
    };
    // what the camera should not see from above: the sky, the stars and the moon, sprites and
    // labels, the rain itself, and whatever draws its own pass (a mirror)
    function hidden(tSec) {
      if (tSec - hideAt < 60 && tSec >= hideAt) return hideList; // (a walk of the whole scene: once a minute, not every few seconds)
      hideAt = tSec;
      hideList = [];
      const plain = THREE.Object3D.prototype.onBeforeRender;
      world.traverse(o => {
        if (o === world) return;
        const m = o.material;
        if (o.userData.oeNoOcc || o.isSprite || o.isPoints || o.isLine || o === Wd.sky || (o.onBeforeRender && o.onBeforeRender !== plain)
          || (m && !Array.isArray(m) && (m.transparent && m.opacity < 0.6 || m.depthWrite === false || m.side === THREE.BackSide))) hideList.push(o);
      });
      return hideList;
    }
    function renderOcc(tSec) {
      const c = camera.position, texel = 2 * OCC_R / T.occ;
      const cx = Math.round(c.x / texel) * texel, cz = Math.round(c.z / texel) * texel;
      occBase.value = Math.round(c.y);
      occCam.position.set(cx, c.y + 1500, cz);
      occCam.lookAt(cx, c.y, cz);
      occCam.near = 1; occCam.far = 1500 + Math.max(600, c.y + 200);
      occCam.updateProjectionMatrix(); occCam.updateMatrixWorld();
      occBox.value.set(cx, cz, 2 * OCC_R, -2 * OCC_R);
      const hide = hidden(tSec), was = hide.map(o => o.visible);
      hide.forEach(o => { o.visible = false; });
      const prev = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, alpha: renderer.getClearAlpha(), col: renderer.getClearColor(new THREE.Color()),
        bg: world.background, fog: world.fog, over: world.overrideMaterial, sh: renderer.shadowMap.autoUpdate };
      world.background = null; world.fog = null; world.overrideMaterial = occMat; renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(occRT);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(world, occCam);
      renderer.setRenderTarget(prev.rt);
      renderer.setClearColor(prev.col, prev.alpha);
      renderer.autoClear = prev.auto;
      world.background = prev.bg; world.fog = prev.fog; world.overrideMaterial = prev.over; renderer.shadowMap.autoUpdate = prev.sh;
      hide.forEach((o, i) => { o.visible = was[i]; });
      occOn.value = 1;
      // a roof over the camera's focus, read back without stalling the frame
      // (the map's v runs from +z at the bottom to -z at the top: occBox's negative depth)
      const f = api.focus || c, px = Math.floor(((f.x - cx) / (2 * OCC_R) + 0.5) * T.occ), iy = Math.floor(((f.z - cz) / (-2 * OCC_R) + 0.5) * T.occ);
      if (renderer.readRenderTargetPixelsAsync && px >= 0 && px < T.occ && iy >= 0 && iy < T.occ) {
        renderer.readRenderTargetPixelsAsync(occRT, px, iy, 1, 1, readBuf).then(b => {
          const h = THREE.DataUtils.fromHalfFloat(b[0]) + occBase.value, a = THREE.DataUtils.fromHalfFloat(b[3]);
          const over = h - f.y;
          cover = { roof: a > 0.5 && over > 0.4 && over < 12, h: over, at: tSec };
        }).catch(() => { /* a lost context */ });
      }
    }
    return api;
  }

  return { create, patch, wrap, season, wetChance, U, GLSL, KINDS, NAMES };
})();
