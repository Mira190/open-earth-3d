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
    uOeGlint: { value: 0 }, uOeSnow: { value: 0 }, uOeSnowfall: { value: 0 }, uOeFog: { value: 0 }, uOeFlash: { value: 0 }, uOeWind: { value: null },
    // the rain occlusion map (heights of the tops of things round the camera, from above) and its frame
    uOeOcc: { value: null }, uOeOccBox: { value: null }, uOeOccOn: { value: 0 }, uOeOccBase: { value: 0 },
    // the tracks in lying snow round the player (trail(), below): how trodden each texel is, its frame (x0, y0 in the
    // map's metres, east and north; 1 / its width), and whether it is kept
    uOeTrail: { value: null }, uOeTrailBox: { value: null }, uOeTrailOn: { value: 0 } }; // (uOeTrailBox: a Vector4 from create(): three.js is not loaded yet here)
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
  const NAMES = { live: 'As the season brings it', now: 'Live, as it is there now', clear: 'Clear', overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', off: 'Off' };
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
  // ------------------------------------------------------------ live weather (opt-in)
  // The city's conditions now, from Open-Meteo (open-meteo.com: no key, CORS open, data CC BY 4.0). It is
  // a request from the visitor's browser to a third party, so it is made only when the visitor picks
  // "Live" in the menu (or the address says ?weather=now), carries nothing but the city's own
  // coordinates rounded to 0.01 degree (never the visitor's), sends no cookies or referrer, is kept for
  // 15 minutes (the service's own step), and when it fails the season's weather carries on, silently.
  // WMO weather codes: 0-1 clear, 2 fair, 3 overcast, 45/48 fog, 51-57 drizzle, 61-67 and 80-82 rain,
  // 71-77 and 85-86 snow, 95-99 thunderstorm.
  const NOW_KEY = 'oe3d-weather-now', NOW_TTL = 15 * 60e3;
  const nowUrl = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,precipitation,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility&wind_speed_unit=ms`;
  // an Open-Meteo "current" block as the amounts the weather eases to
  function fromNow(c) {
    if (!c || typeof c !== 'object') return null;
    const n = v => (Number.isFinite(+v) ? +v : 0), code = n(c.weather_code), mm = n(c.precipitation) * 4, vis = c.visibility == null ? 40000 : n(c.visibility); // (precipitation: the last 15 minutes' sum)
    const snowy = (code >= 71 && code <= 77) || code === 85 || code === 86 || n(c.snowfall) > 0, stormy = code >= 95 && code <= 99;
    const drizzly = code >= 51 && code <= 57, rainy = (code >= 61 && code <= 67) || (code >= 80 && code <= 82) || stormy;
    const amount = Math.max(mm > 0 ? Math.min(1, Math.sqrt(mm / 9)) : 0, snowy ? 0.3 : stormy ? 0.8 : rainy ? 0.45 : drizzly ? 0.15 : 0);
    const foggy = code === 45 || code === 48 || vis < 1000;
    return { rain: snowy ? 0 : amount, snow: snowy ? Math.max(0.25, amount) : 0, storm: stormy ? 0.9 : 0, fog: foggy ? Math.max(0.35, Math.min(0.95, 1 - vis / 1400)) : vis < 5000 ? 0.2 * (1 - vis / 5000) : 0,
      cloud: Math.max(n(c.cloud_cover) / 100, amount > 0.05 ? 0.85 : 0, code === 3 ? 0.85 : 0), temp: n(c.temperature_2m), wind: n(c.wind_speed_10m), windFrom: n(c.wind_direction_10m), code };
  }
  function fetchNow(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    try { const k = JSON.parse(localStorage.getItem(NOW_KEY) || 'null'); if (k && k.key === key && Date.now() - k.at < NOW_TTL && k.at <= Date.now()) return Promise.resolve(fromNow(k.cur)); } catch (e) { /* storage blocked */ }
    return fetch(nowUrl(lat, lon), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { const cur = j && j.current; if (!cur) return null; try { localStorage.setItem(NOW_KEY, JSON.stringify({ key, at: Date.now(), cur })); } catch (e) { /* storage blocked */ } return fromNow(cur); })
      .catch(() => null);
  }
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

  const hash2 = (x, y) => { const q = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return q - Math.floor(q); };
  const vnoise2 = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
    return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v; };
  // ------------------------------------------------------------ shared GLSL
  const GLSL = `
uniform float uOeWet; uniform float uOeRain; uniform float uOeT; uniform float uOeSnow; uniform float uOeSnowfall; uniform vec4 uOeWind; uniform float uOeGlint;
uniform sampler2D uOeOcc; uniform vec4 uOeOccBox; uniform float uOeOccOn; uniform float uOeOccBase;
uniform sampler2D uOeTrail; uniform vec4 uOeTrailBox; uniform float uOeTrailOn;
// how trodden the snow is at p (three.js world), 0..1, from the trail round the player; 0 beyond it
float oeTrail(vec3 p) {
  if (uOeTrailOn < 0.5) return 0.0;
  vec2 uv = (vec2(p.x, -p.z) - uOeTrailBox.xy) * uOeTrailBox.z;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return textureLod(uOeTrail, uv, 0.0).r * smoothstep(0.0, 0.08, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
}
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
// settled snow on a surface, 0..1: on what faces up and lies open to the sky, first on the flat and, as it
// deepens, on slopes too, patchy at its edges (after the world-normal snow masks of Unreal's and Godot's
// material examples; no geometry). tread 0..1: where wheels and feet keep it thin (roads, paving)
float oeSnowOn(vec3 p, vec3 n, float open, float tread) {
  if (uOeSnow < 0.004 || open <= 0.0) return 0.0;
  float nz = oeN(p.xz * 0.31) * 0.6 + oeN(p.xz * 1.7 + 3.1) * 0.4;
  float deep = smoothstep(0.0, 0.55, uOeSnow) * (1.0 - 0.55 * tread * (1.0 - smoothstep(0.6, 1.0, uOeSnow)));
  float need = mix(1.04, 0.3, deep);
  float on = smoothstep(need - 0.1, need + 0.12, n.y + (nz - 0.5) * 0.3) * open * smoothstep(0.0, 0.1, deep - tread * 0.25 * nz);
  // where wheels and feet go it is worn to slush in patches until it lies deep
  if (tread > 0.01) on *= mix(1.0, smoothstep(0.34, 0.62, oeN(p.xz * 0.55 + 9.0) * 0.6 + oeN(p.xz * 2.7) * 0.4 + (uOeSnow - 0.62) * 1.1), tread);
  return on;
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
      // a material that projects its vertices itself (the far trees' cards, trees.js): its position is the world's
      // already, and a card has no normal to speak of; snow takes its upper part first
      if (sh.vertexShader.indexOf('vOeW = ') < 0) {
        const at = sh.vertexShader.lastIndexOf('}');
        sh.vertexShader = `${sh.vertexShader.slice(0, at)}  vOeW = transformed; vOeN = vec3(0.0, ${o.card ? '0.62 + 0.62 * position.y' : '1.0'}, 0.0);
}${sh.vertexShader.slice(at + 1)}`;
      }
    }
    // (a material the mirror patched first carries the mirror's stand-in for oePuddle: the weather's own takes its place)
    sh.fragmentShader = sh.fragmentShader.replace(/\nfloat oePuddle\(vec2 xz\) \{[^\n]*\}/, '').replace('#include <common>', `#include <common>
varying vec3 vOeW; varying vec3 vOeN;
${GLSL}`);
    const porous = (o.porous ?? 0.4).toFixed(3), puddles = o.puddles || '0.0', gloss = o.gloss || '1.0', tread = o.tread || '0.0';
    // (no puddles where none can stand, the people's clothes and skin: their noise and the ripples are left out of
    // the shader, not multiplied by nothing, which a compiler cannot fold away)
    const pools = !/^\s*0(\.0*)?\s*$/.test(puddles);
    if (!o.water) {
      // (all of it inside one test of the state: on a dry day with no snow lying a fragment pays for that test and
      // nothing else, so the buildings, trees and cars that now carry the patch cost what they did)
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float oeCamD = distance(vOeW, cameraPosition);
float oeUp = 0.0, oeFlat = 0.0, oeOpen = 1.0, oeWet = 0.0, oeGl = 0.0, oePd = 0.0, oeSn = 0.0;
if (uOeWet + uOeSnow > 0.001) {
  vec3 oeNw = gl_FrontFacing ? vOeN : -vOeN; // (the face seen: the underside of a thin roof faces down)
  oeUp = smoothstep(0.15, 0.75, oeNw.y); oeFlat = smoothstep(0.96, 0.995, oeNw.y);
  // (a wall: is the air in front of it open; and the map's texels are broken up at a roof's edge, where snow and rain blow in a little)
  oeOpen = 1.0 - oeCover(vOeW + vec3(oeNw.x, 0.0, oeNw.z) * (0.8 * (1.0 - oeUp)) + vec3(oeN(vOeW.xz * 2.7) - 0.5, 0.0, oeN(vOeW.zx * 2.7 + 11.0) - 0.5) * 0.45, 0.6);
  // a wall takes the rain in streaks down it, and less of it than what faces the sky
  oeWet = uOeWet * oeOpen * mix(0.22 + 0.3 * oeN(vec2(dot(vOeW.xz, vec2(0.83, 0.56)) * 0.9, vOeW.y * 0.07)), 1.0, oeUp);
  oeGl = clamp(${gloss}, 0.0, 1.0) * oeWet;
  diffuseColor.rgb *= mix(1.0, 1.0 - ${porous}, oeWet);
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, mix(0.42, 0.2, uOeGlint)), oeGl); // (uOeGlint: the sun out on a street still wet, its film at its smoothest)
${pools ? `  if (uOeWet > 0.001) { // (dry: no noise to work out)
    oePd = oePuddle(vOeW.xz) * clamp(${puddles}, 0.0, 1.0) * oeFlat * oeOpen;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, oePd);
    roughnessFactor = mix(roughnessFactor, 0.06, oePd);
  }` : ''}
  oeSn = oeSnowOn(vOeW, oeNw, oeOpen, clamp(${tread}, 0.0, 1.0))${o.card ? ' * 0.62' : o.person ? ' * 0.7' : ''}; // (a far tree's card: frosted, not buried; a person: a dusting on the shoulders and the hair, which they shake off)
${o.tread ? `  if (oeSn > 0.0 && uOeTrailOn > 0.5) { // trodden: packed down to a greyer, glossier crust, the ground showing through in the ruts
    float oeTr = oeTrail(vOeW) * oeFlat;
    diffuseColor.rgb *= 1.0 - 0.18 * oeTr * oeSn;
    oeSn *= 1.0 - 0.55 * oeTr * (1.0 - 0.4 * smoothstep(0.5, 1.0, uOeSnow));
    roughnessFactor = mix(roughnessFactor, 0.45, oeTr * 0.5);
  }
` : ''}  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.76, 0.83) * (0.86 + 0.2 * oeN(vOeW.xz * 0.9 + 5.0)) * (0.93 + 0.1 * oeN(vOeW.xz * 0.07 + 2.0)) * (1.0 - 0.3 * clamp(${tread}, 0.0, 1.0) * (1.0 - uOeSnow)), oeSn);
  roughnessFactor = mix(roughnessFactor, 0.82, oeSn);
}`)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - oeSn;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${pools ? `if (oePd > 0.0) { vec2 oeR = oeRipple(vOeW.xz, oeCamD);
  normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, oePd * 0.9) + (viewMatrix * vec4(oeR.x, 0.0, oeR.y, 0.0)).xyz * oePd); }` : ''}`)
        // the sky a wet street reflects is mostly hidden by the street's own walls and trees: the
        // reflection of the open sky (the only one the environment map holds) is held well down
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  radiance *= mix(1.0, mix(0.42, 0.95, uOeGlint), max(oeGl, oePd)) * (1.0 - 0.6 * oeSn); // (and when the sun is back out the sky it mirrors is bright again)
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
    // (three.js's default key is the text of onBeforeCompile, which is this wrapper's from here on: the text of the
    // material's own patch is kept in its place, so two materials with different patches never share a program)
    const plain = ownKey === THREE.Material.prototype.customProgramCacheKey, ownText = plain && own ? own.toString() : '';
    mat.onBeforeCompile = function (sh, r) { if (own) own.call(this, sh, r); patch(sh, o); };
    mat.customProgramCacheKey = function () { return `${plain ? ownText : ownKey.call(this)}|oew|${key}`; };
    mat.needsUpdate = true;
  }

  // ------------------------------------------------------------ the rain
  const STREAK_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uVel; uniform vec3 uFwd; uniform vec3 uBox;
uniform float uSpeed; uniform float uShutter; uniform float uWidth; uniform float uCount; uniform float uAlpha;
uniform vec2 uWind; uniform vec2 uDrift; uniform vec2 uRes;
varying vec2 vUv; varying float vA;
${GLSL}
void main() {
  vUv = position.xy; vA = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uCount) return;
  float rnd = fract(aSeed.x * 91.7 + aSeed.z * 13.3 + aSeed.y * 5.1);
  vec3 B = uBox * 2.0, c = uCam + uFwd * vec3(uBox.x, 0.0, uBox.z) * 0.6;
  vec3 fall = vec3(uWind.x, -uSpeed * (0.85 + 0.3 * rnd), uWind.y);
  // (carried by the wind's run so far, uDrift, not wind x time: a gust slants the drops without moving them all at once)
  vec3 p = aSeed.xyz * B + vec3(uDrift.x, fall.y * uOeT, uDrift.y);
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
  // a snowflake: a soft dot facing the camera, falling slowly, carried by the wind and fluttering; in the
  // rain's shells (the same instances), kept out from under cover by the same occlusion map
  const FLAKE_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uFwd; uniform vec3 uBox;
uniform float uCount; uniform float uSize; uniform float uAlpha; uniform vec2 uDrift; uniform vec2 uRes;
varying vec2 vUv; varying float vA;
${GLSL}
void main() {
  vUv = vec2(position.x, position.y * 2.0 - 1.0); vA = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uCount) return;
  float rnd = fract(aSeed.x * 91.7 + aSeed.z * 13.3 + aSeed.y * 5.1), r2 = fract(rnd * 57.3);
  vec3 B = uBox * 2.0, c = uCam + uFwd * vec3(uBox.x, 0.0, uBox.z) * 0.6;
  vec3 p = aSeed.xyz * B + vec3(uDrift.x * (0.8 + 0.4 * r2), -(0.75 + 0.8 * rnd) * uOeT, uDrift.y * (0.8 + 0.4 * r2));
  p.xz += vec2(sin(uOeT * (0.9 + r2) + rnd * 40.0), cos(uOeT * (0.7 + rnd) + r2 * 31.0)) * (0.1 + 0.12 * r2);
  p = c + mod(p - c + 0.5 * B, B) - 0.5 * B;
  vec3 e = abs(p - c) / uBox;
  float edge = max(e.x, max(e.y, e.z));
  if (oeCover(p, 0.05) > 0.5) return;
  vec4 h = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (h.w < 0.35) return;
  float rpx = uSize * (0.6 + 0.9 * rnd) * projectionMatrix[1][1] * 0.5 * uRes.y / h.w, r = max(rpx, 1.1);
  vA = uAlpha * min(1.0, rpx / r * 1.6) * smoothstep(1.0, 0.75, edge) * smoothstep(0.35, 1.2, h.w) * (0.7 + 0.3 * r2);
  h.xy += vUv * r / (0.5 * uRes) * h.w;
  gl_Position = h;
}`;
  const FLAKE_FS = `
uniform vec3 uCol; varying vec2 vUv; varying float vA;
void main() {
  float a = vA * smoothstep(1.0, 0.25, length(vUv));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, a * 0.9);
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
    // (the count is of days on which any snow was seen, flurries and sleet among them: half of them, at most
    // seven wet days in ten, bring snow that falls as snow, and of those the colder ones settle)
    if (cl.snow_days && ihash(dayN, salt + 7) < Math.min(0.7, (cl.snow_share ?? 0.5) * cl.snow_days[m - 1] / rd) && a.wet) {
      out.snow = Math.min(1, a.rain0 * 1.6 + 0.12 * a.wetDay); out.rain = 0; out.temp = Math.min(out.temp, 2.6 - 4.5 * ihash(dayN, salt + 8)); out.windK = 0.8;
    } else if (!cl.snow_days && out.temp < 0.8 && out.rain > 0) { out.snow = out.rain; out.rain = 0; } // (no table: by the thermometer)
    // a thunderstorm day (days with thunder): the day's hardest showers are storms, mostly after noon
    if (cl.thunder_days && !out.snow && a.wet && ihash(dayN, salt + 9) < Math.min(1, cl.thunder_days[m - 1] / rd)) {
      out.storm = smooth(0.45, 0.8, a.rain0) * (0.6 + 0.4 * smooth(11, 15, h));
      out.rain = Math.min(1, out.rain + 0.5 * out.storm); out.windK = 1.2 + 1.4 * out.storm;
    }
    // a typhoon's day (typhoon_days: the days a month one passes near): rain without a break, a gale, thunder in it
    if (cl.typhoon_days && a.wet && !out.snow && ihash(dayN, salt + 12) < Math.min(0.5, cl.typhoon_days[m - 1] / rd)) {
      out.rain = Math.min(1, 0.7 + 0.3 * a.rain0); out.cloud = 1; out.storm = Math.max(out.storm, 0.5 * smooth(0.3, 0.7, a.rain0)); out.windK = 3.4 + 1.2 * a.rain0; out.typhoon = 1;
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
  function create(Wd, renderer, camera, { climate = null, QC = null, sky = {}, wind: windCfg = null, geo = null } = {}) {
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
        else if (m.userData.paving || /pav|plaza|flagstone|^sk_stone|gravel|path/i.test(k)) wrap(m, { puddles: '0.6', porous: 0.35, tread: '0.85' }, k); // (walked and driven on: its snow wears to slush)
      }
      if (Wd.waterMat) wrap(Wd.waterMat, { water: true }, 'waterMat');
      armSea();
      onArm.forEach(f => f());
      dress();
    }
    // Everything else that stands in the weather: roofs and walls, the landmarks, the trees' crowns and
    // trunks, the cars and the street furniture take the same patch without puddles, so snow settles on
    // what faces the sky and walls darken in the rain. Called again as the world fills (dress(obj) for
    // something just loaded, before it is first compiled; a walk of the world every few seconds for the rest).
    // Left out: what the weather does not touch or what has its own (glass and anything see-through,
    // lit screens, the sea). The near people are skinned: their position and normal are the skinned ones by the
    // time the patch reads them (three.js skins objectNormal and transformed before project_vertex), so they take
    // it too, as the far crowd's instanced copies did (issue 381, item 7), and so do the umbrellas over them.
    let dressAt = -9;
    function dress(root = world) {
      if (!armed) return 0;
      let n = 0;
      if (Wd.groundMeshes) for (const g of Wd.groundMeshes) g.material.userData.oeWeather = true; // (the ground's own patch has it: game.js)
      root.traverse(o => {
        if (!o.isMesh || o.userData.oeNoOcc || o === Wd.sky || (Wd.sea && o === Wd.sea.mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || !m.isMeshStandardMaterial || m.userData.oeWeather || m.userData.oeDry) continue;
          if (m.transparent || m.depthWrite === false || m.side === THREE.BackSide || m.emissiveIntensity > 1.2 || m.transmission > 0) { m.userData.oeDry = true; continue; }
          const card = /-far$/.test(o.name || '') && o.isInstancedMesh && m.alphaTest > 0; // (a far tree's card)
          if (o.isSkinnedMesh) wrap(m, { porous: 0.12, gloss: '0.15', person: true }, 'person');
          else wrap(m, { porous: 0.26, gloss: '0.4', card }, card ? 'card' : 'dress');
          n++;
        }
      });
      return n;
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
      uWind: { value: new THREE.Vector2(0.6, 0.3) }, uDrift: { value: new THREE.Vector2(0, 0) }, uRes: { value: new THREE.Vector2(1, 1) }, uCol: { value: new THREE.Color(0.8, 0.85, 0.9) } }, U);
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
    // the snow: the same instances as the rain's two shells, drawn as flakes (never both at once at full count)
    const snowCol = { value: new THREE.Color(1, 1, 1) };
    const flakes = (rain, box, size, alpha) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, shared, { uCol: snowCol, uBox: { value: new THREE.Vector3(box[0], box[1], box[0]) }, uSize: { value: size }, uCount: { value: 0 }, uAlpha: { value: alpha } }),
        vertexShader: FLAKE_VS, fragmentShader: FLAKE_FS, transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, fog: false });
      const m = new THREE.Mesh(rain.geometry, mat);
      m.frustumCulled = false; m.renderOrder = 5; m.visible = false; m.userData.oeNoOcc = true;
      world.add(m);
      return m;
    };
    const fNear = flakes(near, [8, 6], 0.011, 0.95), fFar = flakes(far, [26, 16], 0.026, 0.8);
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
    const known = v => !!(KINDS[v] || v === 'live' || v === 'off' || v === 'now');
    let mode = known(asked) ? asked : navigator.webdriver ? 'clear' : 'live';
    let chosen = !!asked; // the visitor (or the page's address) chose the weather: the guard never turns it off then
    try { if (!asked && !navigator.webdriver) { const v = localStorage.getItem('oe3d-weather'); if (v && known(v)) { mode = v; chosen = true; } } } catch (e) { /* storage blocked */ }
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
    let shedOff = false; // the season's weather turned off by shedding in this session (it may come back: shed's setter)
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
    // the live conditions (mode 'now'): asked for when the mode is picked and every 15 minutes while it stays
    let nowWx = null, nowAt = -1e12, nowBusy = false;
    function askNow() {
      if (nowBusy || !geo || !Number.isFinite(geo.lat) || performance.now() - nowAt < NOW_TTL) return;
      nowBusy = true; nowAt = performance.now();
      fetchNow(geo.lat, geo.lon).then(w => { nowWx = w; nowBusy = false; if (api.onNow) api.onNow(w); });
    }
    const cur = { rain: 0, cloud: 0, snow: 0, fog: 0, storm: 0, windK: 1, temp: 15 }, target = { rain: 0, cloud: 0, snow: 0, fog: 0, storm: 0, windK: 1, temp: 15 };
    let custom = null, wetPin = null, depthPin = null, lastKind = 'clear', windRun = 0, runX = 0, runZ = 0;
    // the light as the hour and the weather left it (light, air), which a lightning flash adds to and gives back
    const lit = { hemi: 0, exp: 1, flash: 0, hazeOn: 0, hazeH: 0.05, fog: new THREE.Color(), haze: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color() };
    // lightning: the flash in play (its strokes: [start s, peak 0..1]), the next one's time, the thunder still on its way
    const bolt = { next: -1, strokes: null, t0: 0, dist: 0, thunder: [], count: 0, last: null };
    // the wind: the season's mean (the climate's monthly wind_ms, or the wind the city's waves were made
    // for, water.waves), from the prevailing bearing, wandering a little, with gusts on top
    const windBase = () => (climate && climate.wind_ms != null ? (clockAt ? monthly(climate.wind_ms, clockAt[1], clockAt[2]) : monthly(climate.wind_ms, 6, 15)) : windCfg && windCfg.wind_ms != null ? windCfg.wind_ms * 0.7 : 3.2);
    const windFrom0 = (climate && climate.wind_from_deg) ?? (windCfg && windCfg.wind_from_deg) ?? 250;
    let clockAt = null, snap = true, cover = { roof: false, h: 0, at: 0 }, occT = -9, occAt = new THREE.Vector3(1e9, 0, 0), hideList = [], hideAt = -99;
    const lastCam = new THREE.Vector3().copy(camera.position), vel = new THREE.Vector3();
    const baseClouds = su && su.cloudCoverage ? [su.cloudCoverage.value, su.cloudDensity.value] : null;
    const readBuf = new Float32Array(4), readHalf = new Uint16Array(4);
    // ---- lightning (docs/WEATHER.md): a flash is two to five return strokes 40-80 ms apart, the first or
    // second the brightest, over 0.2-0.6 s; one in three reaches the ground (a drawn bolt), the rest light
    // the cloud from inside. It lights the sky's light, the air and the exposure for those frames (no light
    // is added to the scene, no pass), and its thunder comes when sound has covered the distance (343 m/s).
    const BOLT_N = 96;
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_N * 4 * 3), 3));
    boltGeo.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(BOLT_N * 4 * 3), 3));
    boltGeo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(BOLT_N * 4 * 2), 2));
    { const ix = []; for (let i = 0; i < BOLT_N; i++) ix.push(4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 2, 4 * i + 1, 4 * i + 3); boltGeo.setIndex(ix); }
    const boltMat = new THREE.ShaderMaterial({
      uniforms: { uFlash: U.uOeFlash, uRes: shared.uRes },
      vertexShader: `attribute vec3 aDir; attribute vec2 aSide; uniform vec2 uRes; varying float vS; varying float vW;
        void main() { vS = aSide.x; vW = aSide.y;
          vec4 a = projectionMatrix * viewMatrix * vec4(position, 1.0), b = projectionMatrix * viewMatrix * vec4(position + aDir, 1.0);
          vec2 d = normalize((b.xy / max(b.w, 1e-3) - a.xy / max(a.w, 1e-3)) * uRes + 1e-5);
          a.xy += vec2(-d.y, d.x) * aSide.x * max(1.6, aSide.y * uRes.y * projectionMatrix[1][1] * 0.5 / max(a.w, 1.0)) / (0.5 * uRes) * a.w;
          gl_Position = a; }`,
      fragmentShader: `uniform float uFlash; varying float vS; varying float vW;
        void main() { float c = 1.0 - abs(vS); gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * (c * c * 26.0 * uFlash * (0.35 + 0.65 * min(1.0, vW / 2.0))), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide }); // (its quads face either way as the channel turns)
    const boltMesh = new THREE.Mesh(boltGeo, boltMat);
    boltMesh.frustumCulled = false; boltMesh.visible = false; boltMesh.renderOrder = 4; boltMesh.userData.oeNoOcc = true;
    world.add(boltMesh);
    // a bolt from the cloud base to the ground: a path displaced at its midpoints again and again, with a
    // few branches that leave it going down and stop short (the oldest way to draw one; Reed and Wyvill 1994)
    function forge(x, z, top, ground, rnd) {
      const P = boltGeo.attributes.position.array, D = boltGeo.attributes.aDir.array, Sd = boltGeo.attributes.aSide.array;
      let n = 0;
      const seg = (a, b, w) => { if (n >= BOLT_N) return; const o = 12 * n, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        for (let k = 0; k < 4; k++) { const e = k < 2 ? a : b; P[o + 3 * k] = e[0]; P[o + 3 * k + 1] = e[1]; P[o + 3 * k + 2] = e[2]; D[o + 3 * k] = d[0]; D[o + 3 * k + 1] = d[1]; D[o + 3 * k + 2] = d[2];
          Sd[8 * n + 2 * k] = k % 2 ? 1 : -1; Sd[8 * n + 2 * k + 1] = w; } n++; };
      const path = (a, b, depth, sway) => { let pts = [a, b];
        for (let it = 0; it < depth; it++) { const q = [pts[0]]; for (let i = 1; i < pts.length; i++) { const u = pts[i - 1], v = pts[i], L = Math.hypot(v[0] - u[0], v[1] - u[1], v[2] - u[2]) * sway;
          q.push([(u[0] + v[0]) / 2 + (rnd() - 0.5) * L, (u[1] + v[1]) / 2 + (rnd() - 0.5) * L * 0.3, (u[2] + v[2]) / 2 + (rnd() - 0.5) * L], v); } pts = q; }
        return pts; };
      const main = path([x + (rnd() - 0.5) * 400, top, z + (rnd() - 0.5) * 400], [x, ground, z], 5, 0.42);
      for (let i = 1; i < main.length; i++) seg(main[i - 1], main[i], 2.4);
      for (let b = 0; b < 4; b++) { const i = 4 + Math.floor(rnd() * (main.length - 10)), a = main[i], len = (0.15 + 0.3 * rnd()) * (a[1] - ground);
        const br = path(a, [a[0] + (rnd() - 0.5) * len * 1.6, a[1] - len, a[2] + (rnd() - 0.5) * len * 1.6], 3, 0.4);
        for (let k = 1; k < br.length; k++) seg(br[k - 1], br[k], 0.9); }
      boltGeo.setDrawRange(0, n * 6);
      boltGeo.attributes.position.needsUpdate = boltGeo.attributes.aDir.needsUpdate = boltGeo.attributes.aSide.needsUpdate = true;
    }
    let boltSeed = 7;
    const brnd = () => ((boltSeed = (boltSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // strike now (the checks and the films ask for one): dist m away on bearing a (radians), to the ground or not
    function strike(tSec, { dist = 300 + 5200 * brnd() * brnd(), bearing = brnd() * 6.2832, ground = brnd() < 0.36 } = {}) {
      const n = 2 + Math.floor(brnd() * 4), strokes = [];
      let t = 0;
      for (let i = 0; i < n; i++) { strokes.push([t, i === (brnd() < 0.6 ? 0 : 1) ? 1 : 0.35 + 0.5 * brnd()]); t += 0.04 + 0.05 * brnd() + (brnd() < 0.2 ? 0.12 : 0); }
      strokes[Math.min(1, n - 1)][1] = Math.max(strokes[0][1], strokes[Math.min(1, n - 1)][1]) >= 1 ? strokes[Math.min(1, n - 1)][1] : 1;
      const x = camera.position.x + Math.sin(bearing) * dist, z = camera.position.z - Math.cos(bearing) * dist;
      Object.assign(bolt, { strokes, t0: tSec, dist, ground, count: bolt.count + 1, last: { dist, bearing, ground, strokes: n, at: tSec }, cam: camera.position.clone() });
      boltMesh.visible = ground && level > 0 && !dropless;
      if (boltMesh.visible) forge(x, z, (api.groundY ?? 0) + 1400 + 500 * brnd(), (api.groundY ?? 0), brnd);
      if (dist < 16000 && api.flashPin == null) bolt.thunder.push({ at: performance.now() + dist / 343 * 1000, dist });
      return bolt.last;
    }
    function storms(dt, tSec) {
      const st = cur.storm;
      if (st > 0.25 && !reduced) {
        if (bolt.next < 0 || tSec < bolt.next - 60) bolt.next = tSec + 1.5 + 5 * brnd();
        if (tSec >= bolt.next) { strike(tSec); bolt.next = tSec + (2.5 + 14 * brnd()) / (0.4 + st); }
      } else bolt.next = -1;
      let fl = 0;
      if (bolt.strokes) {
        const e = tSec - bolt.t0;
        for (const [t0, pk] of bolt.strokes) if (e >= t0) fl = Math.max(fl, pk * Math.exp(-(e - t0) / 0.045));
        if (e > bolt.strokes[bolt.strokes.length - 1][0] + 0.35 || e < 0) { bolt.strokes = null; boltMesh.visible = false; fl = 0; }
        fl *= 1 / (1 + (bolt.dist / 2500) * (bolt.dist / 2500)); // a far flash is a flicker on the horizon
        if (reduced) fl *= 0.25;
      }
      // (a still's held flash: struck again from where the camera now is, if it has been moved since)
      if (api.flashPin != null && bolt.last && bolt.cam && bolt.cam.distanceTo(camera.position) > 30) strike(tSec, { dist: bolt.last.dist, bearing: bolt.last.bearing, ground: bolt.last.ground });
      if (api.flashPin != null) { fl = api.flashPin; boltMesh.visible = fl > 0 && !!(bolt.last && bolt.last.ground) && level > 0; } // (a still: the flash held)
      U.uOeFlash.value = S.flash = fl;
      // the flash on the scene: the sky's light, the air and the lens, added to what light() and air() left
      if (fl > 0 || lit.flash > 0) {
        const night = 1 - (Wd.day ?? 1), k = fl * (0.5 + 1.1 * night);
        if (Wd.hemi) { // (the night's sky light is nearly black: the flash brings its own blue-white, from above and off the wet ground)
          Wd.hemi.intensity = lit.hemi * (1 + 1.2 * k) + 1.5 * k;
          Wd.hemi.color.copy(lit.sky).lerp(new THREE.Color(0.78, 0.84, 1.0), Math.min(0.92, 1.3 * k));
          if (Wd.hemi.groundColor) Wd.hemi.groundColor.copy(lit.ground).lerp(new THREE.Color(0.4, 0.44, 0.55), Math.min(0.8, k));
        }
        renderer.toneMappingExposure = lit.exp * (1 + 0.35 * k);
        if (world.fog) world.fog.color.copy(lit.fog).lerp(new THREE.Color(0.62, 0.68, 0.85), Math.min(0.7, 0.55 * k));
        if (su && su.uHaze) { // (the sky: its haze band takes the flash and reaches higher up the dome for those frames)
          su.uHaze.value.copy(lit.haze).lerp(new THREE.Color(0.7, 0.76, 0.95), Math.min(0.8, 0.7 * k));
          if (su.uHazeOn) su.uHazeOn.value = Math.max(lit.hazeOn, Math.min(1, 0.9 * k));
          if (su.uHazeH) su.uHazeH.value = lit.hazeH + 0.55 * Math.min(1, k);
        }
        lit.flash = fl;
      }
      // thunder, when it arrives
      const now = performance.now();
      for (let i = bolt.thunder.length - 1; i >= 0; i--) if (now >= bolt.thunder[i].at) { const th = bolt.thunder.splice(i, 1)[0]; if (api.onThunder) api.onThunder(th.dist); }
    }
    // ---- the fog's top, seen from above (issue 381, item 3). The scene's fog has no height (three.js's fog chunk
    // takes no uniform of ours without recompiling every program), so from a helicopter a fog only thinned. A
    // radiation fog lies in a layer with a flat, soft top some tens of metres up, which towers and hills stand out
    // of. That top is drawn as three stacked translucent sheets, 10 m apart, round the camera (one mesh, one draw;
    // depth-tested, so what rises through it hides it and the sheets below soften where it does), only while there
    // is fog and the camera is above it; inside it the scene's own fog is the fog. Its billows are noise in the
    // world's frame, drifting with the wind; lit by the sun from above, pale and blue in the shade of the hour.
    const DECK_R = 4500, deckGeo = new THREE.BufferGeometry();
    { const v = [], ix = [], ring = 48, rings = 10;
      for (let L = 0; L < 3; L++) {
        const base = v.length / 3;
        v.push(0, -L * 10, 0);
        for (let r = 1; r <= rings; r++) for (let i = 0; i < ring; i++) { const a = i / ring * Math.PI * 2, rr = DECK_R * Math.pow(r / rings, 2); v.push(Math.cos(a) * rr, -L * 10, Math.sin(a) * rr); }
        for (let i = 0; i < ring; i++) ix.push(base, base + 1 + (i + 1) % ring, base + 1 + i);
        for (let r = 1; r < rings; r++) for (let i = 0; i < ring; i++) { const a = base + 1 + (r - 1) * ring, b = base + 1 + r * ring, j = (i + 1) % ring; ix.push(a + i, a + j, b + i, a + j, b + j, b + i); }
      }
      deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); deckGeo.setIndex(ix); }
    const deckMat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uCol: { value: new THREE.Color() }, uLit: { value: new THREE.Color() }, uRun: { value: new THREE.Vector2() } },
      vertexShader: `varying vec3 vW; varying float vL;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = -position.y / 10.0; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uK; uniform vec3 uCol, uLit; uniform vec2 uRun; varying vec3 vW; varying float vL;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 p = (vW.xz - uRun) / 260.0 + vL * 3.7;
          float b = n(p) * 0.5 + n(p * 2.3 + 1.7) * 0.3 + n(p * 5.1 - 2.9) * 0.2; // the billows
          float d = distance(vW.xz, cameraPosition.xz);
          float a = uK * mix(0.62, 0.42, vL) * (0.7 + 0.5 * b) * (1.0 - smoothstep(${(DECK_R * 0.55).toFixed(1)}, ${(DECK_R * 0.98).toFixed(1)}, d));
          vec3 c = mix(uCol, uLit, (1.0 - vL * 0.45) * (0.55 + 0.45 * b));
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
        }`,
      transparent: true, depthWrite: false, fog: false });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.frustumCulled = false; deck.visible = false; deck.renderOrder = 2; deck.userData.oeNoOcc = true;
    world.add(deck);
    function fogDeck() {
      const f = cur.fog, g = api.groundY ?? 0, top = g + 25 + 85 * smooth(0.15, 1, f), up = camera.position.y - top;
      const k = smooth(0.12, 0.6, f) * smooth(2, 30, up);
      deck.visible = k > 0.01 && level > 0;
      if (!deck.visible) return;
      deck.position.set(camera.position.x, top, camera.position.z);
      deckMat.uniforms.uK.value = k;
      const day = Wd.day ?? 1, fc = world.fog ? world.fog.color : deckMat.uniforms.uCol.value;
      deckMat.uniforms.uCol.value.copy(fc).multiplyScalar(0.92);
      // the top in the sun: white with the sun's colour by day, the fog's own colour by night
      const sun = Wd.sunLight ? Wd.sunLight.color : fc, sy = Wd.sunDir ? Math.max(0, Wd.sunDir.y) : 0;
      deckMat.uniforms.uLit.value.copy(fc).lerp(sun, 0.5 * day).multiplyScalar(1 + 0.35 * day * smooth(0, 0.3, sy));
      const w = U.uOeWind.value; if (w) deckMat.uniforms.uRun.value.set(runX * 0.4, runZ * 0.4);
    }

    // ---- the rainbow: when the sun comes out low (under 42 degrees) with rain still falling or just gone,
    // a bow 42 degrees round the point opposite the sun, red outside, with the fainter second bow at 51 and
    // Alexander's darker band between them. One thin ring of quads far out, added to the frame; nothing
    // else is drawn for it.
    const BOW_SEG = 72, bowGeo = new THREE.BufferGeometry();
    { const v = [], ix = []; for (let i = 0; i <= BOW_SEG; i++) { const a = i / BOW_SEG * Math.PI * 2; v.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1); if (i < BOW_SEG) ix.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 2, 2 * i + 1, 2 * i + 3); }
      bowGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); bowGeo.setIndex(ix); }
    const bowMat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uAxis: { value: new THREE.Vector3(0, 0, 1) }, uX: { value: new THREE.Vector3(1, 0, 0) }, uY: { value: new THREE.Vector3(0, 1, 0) }, uCam: shared.uCam },
      vertexShader: `uniform vec3 uAxis, uX, uY, uCam; varying float vA; varying float vUp;
        void main() { float ang = radians(mix(38.5, 54.5, position.z)); vA = mix(38.5, 54.5, position.z);
          vec3 d = normalize(uAxis * cos(ang) + (uX * position.x + uY * position.y) * sin(ang)); vUp = d.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(uCam + d * 9000.0, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: `uniform float uK; varying float vA; varying float vUp;
        vec3 hue(float t) { return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0); }
        void main() {
          float p = smoothstep(40.2, 40.7, vA) * smoothstep(42.6, 42.1, vA), s2 = smoothstep(50.2, 51.0, vA) * smoothstep(53.6, 52.8, vA);
          vec3 c = hue(0.78 * (1.0 - clamp((vA - 40.4) / 2.0, 0.0, 1.0))) * p + hue(0.78 * clamp((vA - 50.4) / 3.0, 0.0, 1.0)) * s2 * 0.3;
          c += vec3(0.05) * smoothstep(40.6, 38.6, vA); // the sky inside the bow is a little brighter
          gl_FragColor = vec4(c * uK * smoothstep(-0.01, 0.07, vUp), 1.0); }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide });
    const bow = new THREE.Mesh(bowGeo, bowMat);
    bow.frustumCulled = false; bow.visible = false; bow.renderOrder = 3; bow.userData.oeNoOcc = true;
    world.add(bow);
    let bowK = 0, rainAgo = 1e9;
    function rainbow(dt) {
      rainAgo = cur.rain > 0.08 ? 0 : rainAgo + dt;
      const sd = Wd.sunDir, alt = sd ? Math.asin(Math.max(-1, Math.min(1, sd.y))) * 180 / Math.PI : -9;
      // rain in the air (now or within the last minutes), the sun out and low
      const want = api.bowPin != null ? api.bowPin : smooth(1, 6, alt) * (1 - smooth(34, 42, alt)) * (1 - smooth(0.45, 0.8, cur.cloud)) * (1 - smooth(60, 240, rainAgo)) * (Wd.day ?? 1);
      bowK = api.bowPin != null ? want : bowK + (want - bowK) * Math.min(1, dt * 0.25);
      bow.visible = bowK > 0.01 && level > 0 && !!sd;
      S.rainbow = bow.visible ? bowK : 0;
      if (!bow.visible) return;
      const ax = bowMat.uniforms.uAxis.value.copy(sd).negate().normalize(), x = bowMat.uniforms.uX.value.set(0, 1, 0).cross(ax);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize(); bowMat.uniforms.uY.value.copy(ax).cross(x).normalize();
      bowMat.uniforms.uK.value = bowK * 0.22 * (0.4 + 0.6 * (Wd.day ?? 1));
      shared.uCam.value.copy(camera.position);
    }
    // ------------------------------------------------------------ tracks in the snow (issue 381, item 2)
    // A small texture round the player, 256 texels over 96 m (0.375 m each), of how trodden the lying snow is:
    // every walker near the player leaves a stippled path, every car two ruts, written on the CPU from where they
    // were and where they are (game.js passes them to tread()), and new snow fills them back in. The ground and
    // the paving read it (patch: o.tread) and pack the snow down to a greyer crust there. No render: one small
    // upload a few times a second while snow lies; nothing at all otherwise. Recentred in whole texels as the
    // player moves, so a track stays where it was made. (Surveyed alternatives, docs/WEATHER.md: a depth capture
    // of the walkers from below each frame, or displaced snow geometry, each a render or a mesh of its own.)
    const TR = { n: 256, size: 96, x0: 0, y0: 0, on: false, dirty: false, upT: 0, last: new Map() };
    TR.data = new Uint8Array(TR.n * TR.n);
    TR.tex = new THREE.DataTexture(TR.data, TR.n, TR.n, THREE.RedFormat, THREE.UnsignedByteType);
    TR.tex.minFilter = TR.tex.magFilter = THREE.LinearFilter; TR.tex.generateMipmaps = false; TR.tex.needsUpdate = true;
    U.uOeTrail.value = TR.tex;
    if (!U.uOeTrailBox.value) U.uOeTrailBox.value = new THREE.Vector4(0, 0, 1, 0);
    const trStamp = (x, y, r, k) => { // a soft disc of radius r metres at (x, y), k: how hard it presses (0..255)
      const px = TR.size / TR.n, cx = (x - TR.x0) / px, cy = (y - TR.y0) / px, rr = Math.max(0.5, r / px);
      const i0 = Math.max(0, Math.floor(cx - rr)), i1 = Math.min(TR.n - 1, Math.ceil(cx + rr)), j0 = Math.max(0, Math.floor(cy - rr)), j1 = Math.min(TR.n - 1, Math.ceil(cy + rr));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / rr;
        if (d >= 1) continue;
        const o = j * TR.n + i, v = TR.data[o] + k * (1 - d * d);
        TR.data[o] = v > 255 ? 255 : v;
      }
      TR.dirty = true;
    };
    const trRecentre = (x, y) => { // keep the player in the middle half, the texels shifted whole
      const px = TR.size / TR.n, half = TR.size / 2;
      if (TR.on && Math.abs(x - (TR.x0 + half)) < TR.size / 4 && Math.abs(y - (TR.y0 + half)) < TR.size / 4) return;
      const nx0 = Math.round((x - half) / px) * px, ny0 = Math.round((y - half) / px) * px;
      const di = Math.round((nx0 - TR.x0) / px), dj = Math.round((ny0 - TR.y0) / px), n = TR.n, old = TR.data.slice();
      TR.data.fill(0);
      if (TR.on && Math.abs(di) < n && Math.abs(dj) < n) for (let j = Math.max(0, -dj); j < Math.min(n, n - dj); j++) TR.data.set(old.subarray((j + dj) * n + Math.max(0, di), (j + dj) * n + Math.min(n, n + di)), j * n + Math.max(0, -di));
      TR.x0 = nx0; TR.y0 = ny0; TR.dirty = true;
    };
    // movers: [{id, x, y, h, car}] in the map's metres (x east, y north; h the heading, 0 north): who walks or drives
    // near the player this frame, the player first. Called by the game every frame; costs nothing without snow lying.
    function tread(movers, dt) {
      if (!(S.snowDepth > 0.02) || level === 0) { if (TR.on) { TR.on = false; U.uOeTrailOn.value = 0; TR.data.fill(0); TR.last.clear(); TR.dirty = true; } return; }
      const me = movers[0];
      if (!me) return;
      trRecentre(me.x, me.y);
      TR.on = true; U.uOeTrailOn.value = 1;
      U.uOeTrailBox.value.set(TR.x0, TR.y0, 1 / TR.size, 0);
      const seen = new Set();
      for (const m of movers) {
        seen.add(m.id);
        const was = TR.last.get(m.id);
        TR.last.set(m.id, { x: m.x, y: m.y, s: was ? was.s : 0, f: was ? was.f : 0 });
        if (!was) continue;
        const dx = m.x - was.x, dy = m.y - was.y, d = Math.hypot(dx, dy);
        if (d < 0.05 || d > 6) continue; // (standing, or a jump: a teleport, a respawn)
        const sx = Math.sin(m.h), sy = Math.cos(m.h), nx = sy, ny = -sx; // (forward and to the right)
        if (m.car) { // two ruts 1.5 m apart, 0.3 m wide, along the way it came
          for (let t = 0; t < d; t += 0.3) for (const side of [-0.75, 0.75]) trStamp(was.x + dx * t / d + nx * side, was.y + dy * t / d + ny * side, 0.22, 70);
        } else { // footprints, left and right, every 0.7 m of the way
          const L = TR.last.get(m.id);
          let s = L.s + d;
          while (s >= 0.7) { s -= 0.7; L.f ^= 1; const f = (d - s) / d, foot = L.f ? 0.13 : -0.13; trStamp(was.x + dx * f + nx * foot, was.y + dy * f + ny * foot, 0.2, 150); }
          L.s = s;
        }
      }
      for (const k of TR.last.keys()) if (!seen.has(k)) TR.last.delete(k);
      // new snow fills the tracks back in: in about a minute of heavy snow, five of light
      const fill = cur.snow * dt * 255 / 60 + (S.snowDepth < 0.1 ? dt * 8 : 0);
      if (fill > 0) { TR.fillAcc = (TR.fillAcc || 0) + fill; if (TR.fillAcc >= 1) { const f = Math.floor(TR.fillAcc); TR.fillAcc -= f; for (let i = 0; i < TR.data.length; i++) if (TR.data[i]) TR.data[i] = TR.data[i] > f ? TR.data[i] - f : 0; TR.dirty = true; } }
      TR.upT += dt;
      if (TR.dirty && TR.upT > 0.12) { TR.upT = 0; TR.dirty = false; TR.tex.needsUpdate = true; }
    }

    const api = {
      U, kinds: Object.keys(KINDS), tread, names: NAMES, meshes: { near, far, splash, fNear, fFar, deck }, occ: occRT, dress,
      get mode() { return mode; },
      get kind() { return kindOf(cur); },
      // how much a slow device has shed (0 nothing, 1 light, 2 off or, for a chosen weather, no drops):
      // game.js shed raises it a step at a time (see above)
      get shed() { return level === 0 || dropless ? 2 : 2 - level; },
      set shed(v) {
        if (v >= 2 && this.shed < 2) {
          if (chosen) { dropless = true; setLevel(1); }
          else { shedOff = true; setLevel(0, 'Weather is off: this device is busy enough without it. Turn it on in the menu (Esc).'); }
        } else if (v === 1 && level === 2) setLevel(1);
        else if (v < this.shed) {
          // the frame has room again (a two-way governor, issue 352): back up to what was asked, light (1) or
          // full (0). Only what this session's shedding took comes back; a device that starts with the
          // weather off (its tier, or what was remembered from another visit) keeps it off.
          if (level === 0 && !shedOff) return;
          if (level === 0) { mode = 'live'; shedOff = false; arm(); }
          dropless = dropless && v >= 2;
          setLevel(v <= 0 ? 2 : 1);
        }
      },
      // the level (2 full, 1 light, 0 off), whether the wet look is compiled in, and a callback for
      // whatever else needs recompiling once it is (the ground: game.js)
      get level() { return level; },
      get armed() { return armed; },
      onArm(f) { onArm.push(f); },
      // what was shed, to say once the game can show it
      onGuard: null,
      // lightning: strike(t, {dist, bearing, ground}) makes one now; onThunder(dist m) is called as its thunder arrives
      groundY: 0, // the ground's height where the player is (the game sets it each frame)
      strike, onThunder: null, bolt, bowPin: null, flashPin: null, // (bowPin, flashPin: a rainbow or a flash held at that strength, for a still)
      // live weather: called with what came back (null: nothing did, the season carries on)
      onNow: null, get now() { return nowWx; },
      takeNote() { const n = guardNote; guardNote = null; return n; },
      guardState: () => ({ level, mode, chosen, dropless, tier }),
      // for the checks: the device rules on or off, and forget what was remembered and shed
      guardForce(v) { guardOn = !!v; },
      guardReset() { remember(null); level = 2; dropless = false; shedOff = false; chosen = false; if (mode === 'off') mode = 'live'; arm(); },
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
        if (!known(m)) return;
        mode = m; wetPin = null; depthPin = null;
        if (m === 'now') { nowAt = -1e12; askNow(); }
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
        if (!(o > 0.001)) { api.air(); return; }
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
        api.air();
      },
      // fog, mist, falling snow and summer haze, through the scene's own fog and the sky's haze band (no pass
      // of its own): the view shortens to the state's visibility, the air takes a pale tone (the hour's own
      // colour half kept, so a dawn mist is warm and a night fog holds the city's glow), and the sky goes
      // into it from the horizon up. From above the layer (a helicopter, a tower) one sees further.
      // Called after light() and on its own when only the air has changed.
      air() {
        const f = cur.fog, sn = cur.snow, day = Wd.day ?? 1, fog = world.fog;
        const heat = smooth(27, 34, cur.temp) * day * (1 - cur.cloud);
        const thick = Math.max(f, sn * 0.6, heat * 0.3);
        if (fog && thick > 0.002) {
          // (pale, and lit by the low sun where there is one: a dawn mist is warm, not grey)
          const pale = new THREE.Color(0.82, 0.85, 0.88).multiplyScalar(0.14 + 0.86 * day);
          if (Wd.sunLight && Wd.sunDir && Wd.sunDir.y > -0.02) pale.lerp(Wd.sunLight.color.clone().multiplyScalar(0.3 + 0.6 * day), 0.45 * (1 - smooth(0.25, 0.6, Wd.sunDir.y)));
          const mist = fog.color.clone().lerp(pale, 0.6);
          if (heat > 0) mist.lerp(new THREE.Color(0.86, 0.84, 0.78), 0.3 * heat);
          fog.color.lerp(mist, Math.min(1, thick * 1.2));
          const above = 1 + Math.max(0, camera.position.y - (api.groundY ?? 0) - 40) / 90 * Math.max(f, sn * 0.5);
          const vis = S.visibility * above * (1 - 0.45 * heat);
          fog.far = Math.min(fog.far, vis * 1.7);
          fog.near = Math.min(fog.near, fog.far * 0.02 + fog.near * Math.max(0, 1 - 1.6 * thick));
          if (Wd.sunLight) Wd.sunLight.intensity *= 1 - 0.65 * f - 0.25 * sn;
          if (Wd.hemi) Wd.hemi.intensity *= 1 + 0.35 * f * day;
          renderer.toneMappingExposure *= 1 + 0.16 * f * day; // (fog scatters the light it takes from the sun: the frame stays as bright)
          if (su && su.uHaze && su.uHazeOn) {
            if (su.uHazeOn.value < 0.5) su.uHaze.value.copy(fog.color); else su.uHaze.value.lerp(fog.color, Math.min(1, thick * 1.3));
            su.uHazeOn.value = Math.max(su.uHazeOn.value, Math.min(1, thick * 1.6));
            su.uHazeH.value += (1.6 - su.uHazeH.value) * Math.min(1, thick * thick * 1.4);
          }
        }
        // settled snow lifts the light from below (its albedo), a little
        if (Wd.hemi && S.snowDepth > 0.05) Wd.hemi.intensity *= 1 + 0.18 * Math.min(1, S.snowDepth * 2) * day;
        if (Wd.hemi) { lit.sky.copy(Wd.hemi.color); if (Wd.hemi.groundColor) lit.ground.copy(Wd.hemi.groundColor); }
        lit.hemi = Wd.hemi ? Wd.hemi.intensity : 0; lit.exp = renderer.toneMappingExposure; lit.flash = 0;
        if (fog) lit.fog.copy(fog.color);
        if (su && su.uHaze) { lit.haze.copy(su.uHaze.value); lit.hazeOn = su.uHazeOn ? su.uHazeOn.value : 0; lit.hazeH = su.uHazeH ? su.uHazeH.value : 0.05; }
      },
      update(dt, tSec, focus) {
        // what the weather should be now
        if (mode === 'now') askNow();
        const live = mode === 'now' && nowWx;
        let want = live ? nowWx : mode === 'live' || mode === 'now' ? (clockAt ? season(climate, ...clockAt) : { rain: 0, cloud: 0.2 }) : mode === 'custom' ? custom : KINDS[mode] || KINDS.clear; // (off: a clear sky, dry streets)
        // the temperature: the season's for the hour, held under what a pinned weather needs (snow: below freezing)
        const tSeason = clockAt ? tempAt(climate, ...clockAt, want.cloud) : 15;
        // showers and storms come in cells some hundreds of metres across that ride the wind over the map:
        // the rain is heavier under one and lighter between them (a steady rain or a drizzle hardly varies)
        const cell = vnoise2((camera.position.x - runX * 6) / 520, (camera.position.z - runZ * 6) / 520), cellK = (want.storm || 0) > 0.1 || mode === 'live' || mode === 'now' ? 0.5 * Math.max(want.storm || 0, 0.5) : 0;
        want = cellK > 0 && want.rain > 0.3 ? Object.assign({}, want, { rain: Math.min(1, want.rain * (1 - cellK + 2 * cellK * smooth(0.25, 0.75, cell))) }) : want;
        S.cell = cell;
        target.rain = want.rain; target.cloud = want.cloud; target.snow = want.snow || 0; target.fog = want.fog || 0; target.storm = want.storm || 0;
        target.windK = want.windK ?? 1; target.temp = want.temp ?? (want.tempMax != null ? Math.min(tSeason, want.tempMax) : mode === 'live' || mode === 'now' || !(want.rain > 0.06) ? tSeason : Math.max(tSeason, 2));
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
        const wMean = live ? nowWx.wind : mode === 'custom' && custom.wind != null ? custom.wind : windBase() * cur.windK * (0.75 + 0.5 * vnoise(tSec / 240 + 3.3));
        const { gn, gust } = gustAt(tSec);
        const wSpeed = wMean * (0.72 + 0.5 * gn + 0.75 * gust * Math.min(1, 0.35 + wMean / 12));
        const from = (live ? nowWx.windFrom + 14 * (vnoise(tSec / 23 + 5.1) - 0.5) + 360 : mode === 'custom' && custom.windFrom != null ? custom.windFrom : windFrom0 + 50 * (vnoise(tSec / 300 + 1.7) - 0.5) + 14 * (vnoise(tSec / 23 + 5.1) - 0.5) + 360) % 360;
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
        U.uOeGlint.value = Math.min(1, U.uOeWet.value * 1.5) * sunOut * (1 - Math.min(1, cur.rain * 3)); // light after rain
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
        S.source = live ? 'live' : mode === 'live' || mode === 'now' ? 'season' : mode === 'off' ? 'off' : 'pinned';
        if (kind !== lastKind) { lastKind = kind; for (const f of listeners.slice()) try { f(kind, S); } catch (e) { console.warn(e); } }
        if (dt > 0) { runX += wx * Math.min(dt, 0.1); runZ += wz * Math.min(dt, 0.1); }
        storms(dt, tSec);
        rainbow(dt);
        fogDeck();
        if (su && su.cloudCoverage && baseClouds) {
          const ct = su.cloudTrim || 0; // (more cloud for a shot: the overture's sunset sky, overture.js)
          su.cloudCoverage.value = Math.min(0.97, baseClouds[0] + ct + (0.97 - baseClouds[0] - ct) * smooth(0, 1, cur.cloud));
          su.cloudDensity.value = baseClouds[1] + (0.85 - baseClouds[1]) * cur.cloud;
        }
        // the camera's velocity, smoothed, for the slant of the streaks
        if (dt > 0) { const v = camera.position.clone().sub(lastCam).divideScalar(dt); if (v.length() > 80) v.set(0, 0, 0); vel.lerp(v, Math.min(1, dt * 8)); }
        lastCam.copy(camera.position);
        // light (shed 1): no far streaks or splashes; a chosen weather shed further: no drops at all
        const raining = cur.rain > 0.01, snowing = cur.snow > 0.01, light = level < 2, falling = raining || snowing;
        near.visible = raining && !dropless; far.visible = splash.visible = raining && !light;
        fNear.visible = snowing && !dropless; fFar.visible = snowing && !light;
        if (tSec - dressAt > 3 || tSec < dressAt) { dressAt = tSec; dress(); }
        // (while the ground is wet or snow lies, the map of what is under cover is kept, redrawn only as the camera moves)
        if (!falling && !(S.snowDepth > 0.004) && !(U.uOeWet.value > 0.004)) { occOn.value = 0; return; }
        if (dt > 0) shared.uDrift.value.set(shared.uDrift.value.x + wx * 0.55 * Math.min(dt, 0.1), shared.uDrift.value.y + wz * 0.55 * Math.min(dt, 0.1));
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
        fNear.material.uniforms.uCount.value = Math.min(1, cur.snow * 1.2); fFar.material.uniforms.uCount.value = Math.min(0.5, cur.snow * 0.6); // (the far shell at half: more read as noise)
        shared.uWind.value.set(wx * 0.55, wz * 0.55); // the drops ride the wind near the ground (about half the 10 m wind)
        // the light on the drops: the haze's colour, brighter by day, warm from the city at night
        const fc = world.fog ? world.fog.color : new THREE.Color(0.7, 0.75, 0.8);
        shared.uCol.value.copy(fc).multiplyScalar(1.0 + 0.9 * day).add(new THREE.Color(0.16, 0.13, 0.09).multiplyScalar(1 - day));
        snowCol.value.copy(fc).multiplyScalar(1.4 + 1.2 * day).add(new THREE.Color(0.07, 0.065, 0.06).multiplyScalar(1 - day)); // flakes: lighter than the air behind them; at night only as the city's glow lights them
        fFar.material.uniforms.uAlpha.value = 0.25 + 0.35 * day; // (far flakes against a night sky read as stars: held down after dark) // flakes: lighter than the air behind them
        // the occlusion map, when the camera has moved or a little time has passed
        if (occRT && ((falling && tSec - occT > (light ? 2 : 0.5)) || occOn.value < 0.5 || tSec < occT || camera.position.distanceTo(occAt) > (!falling ? 14 : light ? 8 : 4))) {
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
        const all = [near, far, splash, fNear, fFar, boltMesh, bow, deck], was = all.map(m => m.visible);
        all.forEach(m => { m.visible = true; });
        try {
          if (compile) for (const m of all) compile(m);
          else renderer.compile(world, camera);
        } finally { all.forEach((m, i) => { m.visible = was[i]; }); }
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
      dispose() { TR.tex.dispose(); if (occRT) occRT.dispose(); for (const m of [near, far, splash, fNear, fFar, boltMesh, bow, deck]) { world.remove(m); if (m !== fNear && m !== fFar) m.geometry.dispose(); m.material.dispose(); } },
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

  return { create, patch, wrap, season, tempAt, wetChance, U, S, onChange, describe, gustAt, fromNow, nowUrl, GLSL, KINDS, NAMES };
})();
