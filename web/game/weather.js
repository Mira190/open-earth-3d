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
    // settled snow and falling snow (0..1), fog (0..1), lightning (0..1), and the wind: x, z in m/s, the
    // gust 0..1 and the distance the air has travelled (metres, for whatever sways or drifts with it)
    uOeSnow: { value: 0 }, uOeSnowfall: { value: 0 }, uOeFog: { value: 0 }, uOeFlash: { value: 0 }, uOeWind: { value: null },
    // the rain occlusion map (heights of the tops of things round the camera, from above) and its frame
    uOeOcc: { value: null }, uOeOccBox: { value: null }, uOeOccOn: { value: 0 }, uOeOccBase: { value: 0 } };
  // what each weather asks for: rain, snow, fog and storm 0..1, cloud cover 0..1, the wind as a
  // multiple of the season's mean, and (snow) a temperature it may not rise above
  const KINDS = {
    clear: { rain: 0, cloud: 0 },
    overcast: { rain: 0, cloud: 0.85 },
    fog: { rain: 0, cloud: 0.55, fog: 0.85, windK: 0.25 },
    drizzle: { rain: 0.3, cloud: 0.95 },
    rain: { rain: 0.85, cloud: 1, windK: 1.4 },
    storm: { rain: 1, cloud: 1, storm: 1, windK: 2.4 },
    snow: { rain: 0, snow: 0.8, cloud: 0.95, windK: 0.7, tempMax: -1 },
  };
  const NAMES = { live: 'As the season brings it', clear: 'Clear', overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', off: 'Off' };
  // ------------------------------------------------------------ the one weather state
  // OEWeather.S: what the weather is now, eased frame by frame by the game's weather (create().update).
  // Everything that depends on the weather reads this (the sky and clouds, the trees, the water, the
  // traffic, the sound, the diary); nothing keeps its own copy. It is there before the game starts
  // (a clear, calm day) and on pages with no weather at all, so a reader needs no guard beyond
  // `window.OEWeather && OEWeather.S`. docs/WEATHER.md, "The weather state", has the table.
  const S = {
    kind: 'clear',      // clear | overcast | fog | drizzle | rain | storm | snow
    cover: 0,           // cloud cover, 0..1
    precip: 'none',     // none | rain | snow: what is falling
    rate: 0,            // how hard it falls, 0..1 (rain or snow, whichever falls)
    rain: 0, snow: 0,   // the same, split: 0..1 each
    mm: 0,              // millimetres an hour of water, roughly (a drizzle 0.5, rain 4, a storm 25)
    storm: 0,           // a thunderstorm over the city, 0..1
    flash: 0,           // lightning's light this frame, 0..1 (a few frames at a time)
    wind: { x: 0, z: 0 }, // where the wind blows TO, metres a second in the world's x and z (three.js: -z north), gusts in it
    windSpeed: 0,       // its length now, m/s
    windMean: 0,        // the steady wind under the gusts, m/s
    windFrom: 0,        // compass bearing it blows FROM, degrees
    gust: 0,            // 0..1: 0 in a lull, 1 at a gust's peak
    fog: 0,             // fog or mist, 0..1
    visibility: 40000,  // how far one sees, metres
    temp: 15,           // air temperature, degrees C
    wet: 0,             // how wet the ground is, 0..1 (lags the rain, dries by sun and wind)
    snowDepth: 0,       // settled snow, 0..1 (1 about 12 cm)
    grip: 1,            // tyre grip against a dry road's, 0.35..1 (wet 0.7, snow 0.4)
    day: 1,             // daylight, 0..1
    t: 0,               // the weather's own seconds
    source: 'season',   // season | pinned | live | off: who decided it
  };
  // the wind's unsteadiness at a time (seconds): gn 0..1, slow lulls and swells, and gust 0..1, its peaks
  const gustAt = t => { const gn = vnoise(t * 0.11) * 0.6 + vnoise(t * 0.37 + 9.1) * 0.3 + vnoise(t * 1.3 + 3.7) * 0.1; return { gn, gust: smooth(0.52, 0.85, gn) }; };
  const listeners = [];
  // call f(kind, S) whenever the kind changes (clear to rain, rain to storm...); returns a function that stops it
  function onChange(f) { listeners.push(f); return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; }
  // a few words for a HUD or a diary line: 'Light snow, -1°', 'Thunderstorm, 24°'
  function describe(s = S) {
    const w = s.kind === 'snow' ? (s.snow < 0.35 ? 'Light snow' : s.snow > 0.75 ? 'Heavy snow' : 'Snow')
      : s.kind === 'storm' ? 'Thunderstorm' : s.kind === 'rain' ? (s.rain > 0.8 ? 'Heavy rain' : 'Rain') : s.kind === 'drizzle' ? 'Drizzle'
        : s.kind === 'fog' ? (s.fog > 0.6 ? 'Fog' : 'Mist') : s.kind === 'overcast' ? 'Overcast' : s.cover > 0.3 ? 'Fair' : 'Clear';
    return `${w}${s.windSpeed > 10 ? ', windy' : ''}, ${Math.round(s.temp)}°`;
  }
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
    // (no puddles where none can stand, the people's clothes and skin: their noise and the ripples are left out of
    // the shader, not multiplied by nothing, which a compiler cannot fold away)
    const pools = !/^\s*0(\.0*)?\s*$/.test(puddles);
    if (!o.water) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float oeCamD = distance(vOeW, cameraPosition);
float oeOpen = 1.0 - oeCover(vOeW, 0.6);
float oeUp = smoothstep(0.15, 0.75, vOeN.y), oeFlat = smoothstep(0.96, 0.995, vOeN.y);
float oeWet = uOeWet * oeOpen * (0.3 + 0.7 * oeUp);
float oeGl = clamp(${gloss}, 0.0, 1.0) * oeWet;
diffuseColor.rgb *= mix(1.0, 1.0 - ${porous}, oeWet);
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.42), oeGl);
${pools ? `float oePd = uOeWet > 0.001 ? oePuddle(vOeW.xz) * clamp(${puddles}, 0.0, 1.0) * oeFlat * oeOpen : 0.0; // (dry: no noise to work out)
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, oePd);
roughnessFactor = mix(roughnessFactor, 0.06, oePd);` : 'const float oePd = 0.0;'}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${pools ? `if (oePd > 0.0) { vec2 oeR = oeRipple(vOeW.xz, oeCamD);
  normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, oePd * 0.9) + (viewMatrix * vec4(oeR.x, 0.0, oeR.y, 0.0)).xyz * oePd); }` : ''}`)
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
  const MDAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // a monthly table read at a date, eased between the middles of the months
  function monthly(a, m, d) {
    if (!Array.isArray(a)) return a;
    const x = m - 1 + (d - 0.5) / MDAYS[m - 1] - 0.5, i = Math.floor(x), f = x - i;
    return a[(i + 12) % 12] * (1 - f) + a[(i + 13) % 12] * f;
  }
  // the air's temperature at a local time: the normals' daily minimum near dawn and maximum in the
  // mid afternoon, each day a little off the mean (a hash of its date), cooler under cloud by day
  function tempAt(cl, y, m, d, min, cloud = 0) {
    const tx = cl && cl.temp_max ? monthly(cl.temp_max, m, d) : 20, tn = cl && cl.temp_min ? monthly(cl.temp_min, m, d) : 11;
    const dayN = Math.floor(Date.UTC(y, m - 1, d) / 864e5), salt = cl && cl.rain_days ? Math.round(cl.rain_days.reduce((a, b) => a + b, 0) * 10) : 7;
    const off = (ihash(dayN, salt + 5) + ihash(dayN, salt + 6) - 1) * 3.5;
    const k = 0.5 - 0.5 * Math.cos((min / 60 - 5) / 24 * 2 * Math.PI + 0.9 * Math.sin((min / 60 - 5) / 24 * 2 * Math.PI) * 0.5); // min at 05:00, max near 14:30
    const range = (tx - tn) * (1 - 0.45 * cloud);
    return tn + off + (tx - tn - range) * 0.5 + range * k;
  }
  // the weather the season brings at a local time: {rain, snow, fog, storm, cloud 0..1, temp C, windK}
  function season(cl, y, m, d, min) {
    const a = season0(cl, y, m, d, min);
    const out = { rain: a.rain, cloud: a.cloud, snow: 0, fog: 0, storm: 0, windK: 1 + 0.6 * a.rain, temp: tempAt(cl, y, m, d, min, a.cloud) };
    if (!cl || !cl.rain_days) return out;
    const dayN = Math.floor(Date.UTC(y, m - 1, d) / 864e5), salt = Math.round(cl.rain_days.reduce((p, q) => p + q, 0) * 10);
    const rd = Math.max(0.5, cl.rain_days[m - 1]), h = min / 60;
    // a snow day (the normals' days with snowfall, among the wet ones): what falls is snow, and the day is cold
    if (cl.snow_days && ihash(dayN, salt + 7) < Math.min(1, cl.snow_days[m - 1] / rd) && a.wet) {
      out.snow = Math.min(1, a.rain0 * 1.6 + 0.12 * a.wetDay); out.rain = 0; out.temp = Math.min(out.temp, 0.5 - 2.5 * ihash(dayN, salt + 8)); out.windK = 0.8;
    } else if (!cl.snow_days && out.temp < 0.8 && out.rain > 0) { out.snow = out.rain; out.rain = 0; } // (no table: by the thermometer)
    // a thunderstorm day (days with thunder): the day's hardest showers are storms, mostly after noon
    if (cl.thunder_days && !out.snow && a.wet && ihash(dayN, salt + 9) < Math.min(1, cl.thunder_days[m - 1] / rd)) {
      out.storm = smooth(0.45, 0.8, a.rain0) * (0.6 + 0.4 * smooth(11, 15, h));
      out.rain = Math.min(1, out.rain + 0.5 * out.storm); out.windK = 1.2 + 1.4 * out.storm;
    }
    // a foggy morning (days with fog): thickest before sunrise, gone by mid morning; and on any calm,
    // clear dawn a little mist
    const dawn = smooth(1.5, 4.5, h) * (1 - smooth(7, 9.5, h));
    if (cl.fog_days && ihash(dayN, salt + 10) < cl.fog_days[m - 1] / MDAYS[m - 1]) { out.fog = 0.85 * dawn; out.windK = Math.min(out.windK, 1 - 0.7 * dawn); }
    else if (!a.wet && a.cloud < 0.4) out.fog = 0.22 * dawn * (0.4 + 0.6 * ihash(dayN, salt + 11));
    return out;
  }
  function season0(cl, y, m, d, min) {
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
      if (!D.wet) return { rain: 0, rain0: 0, wet: false, wetDay: 0, cloud: D.grey ? 0.55 + 0.3 * vnoise(h / 5 + n) : 0.1 + 0.25 * vnoise(h / 4 + n) };
      const s = smooth(0.32, 0.72, vnoise(h / 2.6 + n * 3.1) * 0.75 + vnoise(h / 0.7 + n) * 0.25);
      return { rain: s * D.cap, rain0: s, wet: true, wetDay: 1, cloud: 0.75 + 0.25 * smooth(0, 0.3, s) };
    };
    const a = at(dayN);
    // a day's weather runs into the next across midnight
    const edge = min < 120 ? at(dayN - 1) : min > 1320 ? at(dayN + 1) : null;
    if (!edge) return a;
    const k = min < 120 ? 0.5 * (1 - min / 120) : 0.5 * (min - 1320) / 120;
    return { rain: a.rain + (edge.rain - a.rain) * k, rain0: a.rain0 + (edge.rain0 - a.rain0) * k, wet: a.wet, wetDay: a.wetDay, cloud: a.cloud + (edge.cloud - a.cloud) * k };
  }
  const kindOf = s => ((s.storm || 0) > 0.4 && s.rain > 0.3 ? 'storm' : (s.snow || 0) > 0.06 ? 'snow' : s.rain > 0.5 ? 'rain' : s.rain > 0.06 ? 'drizzle'
    : (s.fog || 0) > 0.3 ? 'fog' : s.cloud > 0.6 ? 'overcast' : 'clear');

  // ------------------------------------------------------------ the game's weather
  // Wd: the world (world.js); atmos: atmosphere.js; climate: game.json weather; QC: OEQuality.city()
  function create(Wd, renderer, camera, { climate = null, QC = null, sky = {}, wind: windCfg = null } = {}) {
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
    if (!U.uOeWind.value) U.uOeWind.value = new THREE.Vector4(0, 0, 0, 0);
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
      if (l === 0) { mode = 'off'; snap = true; wetPin = null; depthPin = null; custom = null; } // (a pinned wetness too: dry streets)
      remember(l === 0 ? 'off' : l === 1 ? 'light' : null);
      if (note) { guardNote = note; if (api.onGuard) { api.onGuard(note); guardNote = null; } }
    }
    const cur = { rain: 0, cloud: 0, snow: 0, fog: 0, storm: 0, windK: 1, temp: 15 }, target = { rain: 0, cloud: 0, snow: 0, fog: 0, storm: 0, windK: 1, temp: 15 };
    let custom = null, wetPin = null, depthPin = null, lastKind = 'clear', windRun = 0;
    // the wind: the season's mean (the climate's monthly wind_ms, or the wind the city's waves were made
    // for, water.waves), from the prevailing bearing, wandering a little, with gusts on top
    const windBase = () => (climate && climate.wind_ms != null ? (clockAt ? monthly(climate.wind_ms, clockAt[1], clockAt[2]) : monthly(climate.wind_ms, 6, 15)) : windCfg && windCfg.wind_ms != null ? windCfg.wind_ms * 0.7 : 3.2);
    const windFrom0 = (climate && climate.wind_from_deg) ?? (windCfg && windCfg.wind_from_deg) ?? 250;
    let clockAt = null, snap = true, cover = { roof: false, h: 0, at: 0 }, occT = -9, occAt = new THREE.Vector3(1e9, 0, 0), hideList = [], hideAt = -99;
    const lastCam = new THREE.Vector3().copy(camera.position), vel = new THREE.Vector3();
    const baseClouds = su && su.cloudCoverage ? [su.cloudCoverage.value, su.cloudDensity.value] : null;
    const readBuf = new Float32Array(4), readHalf = new Uint16Array(4);
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
      S,
      get state() { return { mode, level, kind: kindOf(cur), rain: cur.rain, snow: cur.snow, fog: cur.fog, storm: cur.storm, cloud: cur.cloud, wet: U.uOeWet.value, snowDepth: S.snowDepth, temp: S.temp, wind: S.windSpeed, covered: cover.roof, coverH: cover.h }; },
      // pin a weather ('clear', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'), or exact amounts
      // ({rain, snow, fog, storm, cloud, wet, snowDepth 0..1, temp C, wind m/s, windFrom degrees}, for
      // a still or a film), or follow the season ('live'); now: no easing in; keep: remember it for the
      // next visit
      set(m, { now = false, keep = false } = {}) {
        if (m && typeof m === 'object') {
          const k = kindOf({ rain: m.rain || 0, snow: m.snow, fog: m.fog, storm: m.storm, cloud: m.cloud ?? 0 }), K = KINDS[k];
          custom = { rain: m.rain ?? K.rain, snow: m.snow ?? 0, fog: m.fog ?? 0, storm: m.storm ?? 0, cloud: m.cloud ?? Math.max(K.cloud, (m.rain > 0.06 || m.snow > 0.06) ? 0.9 : 0),
            windK: K.windK, tempMax: K.tempMax, temp: m.temp, wind: m.wind, windFrom: m.windFrom };
          mode = 'custom'; wetPin = m.wet ?? null; depthPin = m.snowDepth ?? null; arm();
          if (now || m.now) snap = true;
          return;
        }
        if (!(KINDS[m] || m === 'live' || m === 'off')) return;
        mode = m; wetPin = null; depthPin = null;
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
        // the temperature: the season's for the hour, held under what a pinned weather needs (snow: below freezing)
        const tSeason = clockAt ? tempAt(climate, ...clockAt, want.cloud) : 15;
        target.rain = want.rain; target.cloud = want.cloud; target.snow = want.snow || 0; target.fog = want.fog || 0; target.storm = want.storm || 0;
        target.windK = want.windK ?? 1; target.temp = want.temp ?? (want.tempMax != null ? Math.min(tSeason, want.tempMax) : mode === 'live' || !(want.rain > 0.06) ? tSeason : Math.max(tSeason, 2));
        if (snap) {
          Object.assign(cur, target);
          U.uOeWet.value = target.rain > 0.05 ? Math.min(1, 0.5 + target.rain) : 0;
          S.snowDepth = target.snow > 0.05 ? Math.min(1, 0.35 + target.snow * 0.6) : 0;
          snap = false;
        }
        const ease = (a, b, rate) => a + (b - a) * Math.min(1, dt * rate);
        cur.cloud = ease(cur.cloud, target.cloud, 0.25);
        const clouded = cur.cloud > 0.55;
        cur.rain = clouded || target.rain === 0 ? ease(cur.rain, target.rain, 0.35) : ease(cur.rain, 0, 0.35); // rain waits for its clouds
        cur.snow = clouded || target.snow === 0 ? ease(cur.snow, target.snow, 0.3) : ease(cur.snow, 0, 0.3);
        cur.storm = cur.rain > 0.4 || target.storm === 0 ? ease(cur.storm, target.storm, 0.2) : ease(cur.storm, 0, 0.2); // and thunder for its rain
        cur.fog = ease(cur.fog, target.fog, 0.12);
        cur.windK = ease(cur.windK, target.windK, 0.15);
        cur.temp = ease(cur.temp, target.temp, 0.2);
        const day = Wd.day ?? 1, sunOut = day * (1 - cur.cloud);
        // the wind: a steady part, slow lulls and gusts (three octaves of noise over the seconds), a bearing that wanders
        const wMean = mode === 'custom' && custom.wind != null ? custom.wind : windBase() * cur.windK * (0.75 + 0.5 * vnoise(tSec / 240 + 3.3));
        const { gn, gust } = gustAt(tSec);
        const wSpeed = wMean * (0.72 + 0.5 * gn + 0.75 * gust * Math.min(1, 0.35 + wMean / 12));
        const from = (mode === 'custom' && custom.windFrom != null ? custom.windFrom : windFrom0 + 50 * (vnoise(tSec / 300 + 1.7) - 0.5) + 14 * (vnoise(tSec / 23 + 5.1) - 0.5) + 360) % 360;
        const wb = (from + 180) * Math.PI / 180, wx = Math.sin(wb) * wSpeed, wz = -Math.cos(wb) * wSpeed;
        if (dt > 0) windRun += wSpeed * Math.min(dt, 0.1) * (reduced ? 0.3 : 1);
        U.uOeWind.value.set(wx, wz, gust, windRun);
        // wet ground: fills in the rain (and from melting snow), dries by sun and wind
        const wet = U.uOeWet.value, melting = S.snowDepth > 0.02 && cur.temp > 0.5 ? Math.min(1, cur.temp / 6 + 0.5 * sunOut) : 0;
        const dry = (0.45 + 1.1 * sunOut + Math.min(1, wSpeed / 10) * 0.6 + Math.max(0, cur.temp - 15) / 30) / 150;
        U.uOeWet.value = wetPin != null ? wetPin : cur.rain > 0.04 ? Math.min(1, wet + dt * (0.02 + 0.1 * cur.rain)) : melting > 0 ? Math.max(wet - dt * dry, Math.min(0.7, wet + dt * 0.03 * melting)) : Math.max(0, wet - dt * dry);
        // settled snow: builds while it snows at or below about a degree, melts with warmth, sun and rain
        if (depthPin != null) S.snowDepth = depthPin;
        else if (cur.snow > 0.04 && cur.temp < 1.5) S.snowDepth = Math.min(1, S.snowDepth + dt * cur.snow / 70);
        else if (S.snowDepth > 0) S.snowDepth = Math.max(0, S.snowDepth - dt * (0.002 + Math.max(0, cur.temp) / 400 + sunOut / 220 + cur.rain / 40));
        U.uOeRain.value = cur.rain;
        U.uOeSnow.value = S.snowDepth; U.uOeSnowfall.value = cur.snow; U.uOeFog.value = cur.fog;
        U.uOeT.value = reduced ? tSec * 0.3 : tSec;
        // the state everything else reads (OEWeather.S)
        const kind = kindOf(cur);
        S.kind = kind; S.cover = cur.cloud; S.rain = cur.rain; S.snow = cur.snow; S.storm = cur.storm; S.fog = cur.fog;
        S.precip = cur.snow > 0.02 && cur.snow >= cur.rain ? 'snow' : cur.rain > 0.02 ? 'rain' : 'none';
        S.rate = Math.max(cur.rain, cur.snow);
        S.mm = cur.snow > cur.rain ? 2.5 * cur.snow * cur.snow : 0.3 * cur.rain + 5.5 * cur.rain * cur.rain + 20 * cur.storm * cur.rain;
        S.wind.x = wx; S.wind.z = wz; S.windSpeed = wSpeed; S.windMean = wMean; S.windFrom = from; S.gust = gust;
        S.temp = cur.temp; S.wet = U.uOeWet.value; S.day = day; S.t = tSec; S.flash = U.uOeFlash.value;
        S.visibility = 1 / (1 / 40000 + cur.cloud * cur.cloud / 60000 + cur.fog * cur.fog / 140 + cur.rain * cur.rain / 3500 + cur.storm * cur.rain / 2500 + cur.snow * cur.snow / 700);
        S.grip = Math.max(0.35, 1 - 0.3 * Math.min(1, S.wet * 1.5) - 0.45 * smooth(0.05, 0.4, S.snowDepth) - (cur.temp < 0 && S.wet > 0.2 ? 0.15 : 0));
        S.source = mode === 'live' ? 'season' : mode === 'off' ? 'off' : 'pinned';
        if (kind !== lastKind) { lastKind = kind; for (const f of listeners.slice()) try { f(kind, S); } catch (e) { console.warn(e); } }
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
        const fc = world.fog ? world.fog.color : new THREE.Color(0.7, 0.75, 0.8);
        shared.uCol.value.copy(fc).multiplyScalar(1.0 + 0.9 * day).add(new THREE.Color(0.16, 0.13, 0.09).multiplyScalar(1 - day));
        // the occlusion map, when the camera has moved or a little time has passed
        if (occRT && (tSec - occT > (light ? 2 : 0.5) || camera.position.distanceTo(occAt) > (light ? 8 : 4))) {
          occT = tSec; occAt.copy(camera.position);
          renderOcc(tSec);
        }
        if (focus) api.focus = focus;
      },
      // while the game loads: the rain's own materials and its pass from above drawn once, so their
      // shaders compile then rather than in a stall as the first rain comes on. compile(obj): the game's,
      // for the variant the main pass draws with (its post stack's target); without it the whole world was
      // compiled again for the screen, a variant nothing drew with, in one task (issue 259)
      warm(compile) {
        if (api.shed >= 2) return;
        const was = [near.visible, far.visible, splash.visible];
        near.visible = far.visible = splash.visible = true;
        try {
          if (compile) for (const m of [near, far, splash]) compile(m);
          else renderer.compile(world, camera);
        } finally { [near.visible, far.visible, splash.visible] = was; }
        // the occlusion map's programs compiled off the frame, then one map drawn (its target and depth buffer
        // made) without a read back: nothing is read from it until the rain comes (issue 299)
        if (!occRT) return;
        return occPrograms().then(() => {
          if (cur.rain > 0) return; // (the rain came on meanwhile: its own maps are drawn)
          renderOcc(-9, false);
          occOn.value = 0; occT = -9;
        });
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
    function renderOcc(tSec, read = true) {
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
      if (read && px >= 0 && px < T.occ && iy >= 0 && iy < T.occ) {
        const base = occBase.value, fy = f.y, done = (h, a) => { const over = h + base - fy; cover = { roof: a > 0.5 && over > 0.4 && over < 12, h: over, at: tSec }; };
        (window.OEWorld && OEWorld.readAsync ? OEWorld.readAsync(renderer, occRT, px, iy, 1, 1, readBuf).then(b => done(b[0], b[3]))
          : renderer.readRenderTargetPixelsAsync ? renderer.readRenderTargetPixelsAsync(occRT, px, iy, 1, 1, readHalf).then(b => done(THREE.DataUtils.fromHalfFloat(b[0]), THREE.DataUtils.fromHalfFloat(b[3])))
            : Promise.resolve()).catch(() => { /* a lost context */ });
      }
    }
    // The occlusion pass's programs (issue 299): the pass draws the city with one material in place of each
    // object's own, which three.js keys by the kind of object (instanced, skinned, with normals or without,
    // receiving shadows), so one object of each kind is compiled with it, into its target, without drawing,
    // and the programs are waited for off the frame and their first-use queries made then: the first map
    // drawn after costs no compile (it was 2.5 s on the loader's frame).
    function occPrograms() {
      const hide = new Set(hidden(-9)), kinds = new Map();
      world.traverse(o => {
        if (!o.isMesh || !o.material || hide.has(o)) return;
        const g = o.geometry, at = (g && g.attributes) || {};
        const key = [o.isSkinnedMesh, o.isInstancedMesh, !!o.instanceColor, o.isBatchedMesh, !!at.normal, !!at.tangent, !!(g && g.morphAttributes && Object.keys(g.morphAttributes).length), o.receiveShadow].join();
        if (!kinds.has(key)) kinds.set(key, o);
      });
      const list = [...kinds.values()], prev = renderer.getRenderTarget(), fog = world.fog;
      const just = { traverse: f => { for (const o of list) { const m = o.material; o.material = occMat; try { f(o); } finally { o.material = m; } } }, traverseVisible() {} };
      world.fog = null; renderer.setRenderTarget(occRT);
      try { renderer.compile(just, occCam, world); } catch (e) { return Promise.resolve(); } finally { world.fog = fog; renderer.setRenderTarget(prev); }
      const progs = () => [...((renderer.properties.get(occMat).programs || new Map()).values())];
      return new Promise(done => {
        const check = () => {
          if (progs().some(p => p.isReady && !p.isReady())) { setTimeout(check, 10); return; }
          for (const p of progs()) try { p.getUniforms(); p.getAttributes(); } catch (e) { /* on its first draw */ }
          done();
        };
        check();
      });
    }
    return api;
  }

  return { create, patch, wrap, season, tempAt, wetChance, U, S, onChange, describe, gustAt, GLSL, KINDS, NAMES };
})();
