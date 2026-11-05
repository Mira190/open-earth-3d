// Open Earth 3D game: walk a real city, talk to people, take the ferry, fly the
// helicopter. The world is the same open-data model as the viewer (world.js), lit by
// the same sun (sun.js) in the city's own time zone. The NPCs talk like locals: the numbers
// they give (sun on public places, a landmark's height, tonight's sunset) are computed
// while you play, and where the data comes from stays in the viewer's tour and Sources
// panel, not in their mouths (tools/voice_check.py, issue #87).
'use strict';
window.OpenEarthGame = async function game(cityId) {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const S = window.Sun, RAD = Math.PI / 180, A = window.OEAudio, H = window.OEHud;
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const pad = n => String(n).padStart(2, '0');
  const fmtMin = m => { const t = Math.floor(m); return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
  const fmtSec = s => (s === Infinity ? '–' : `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const GULL = '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M0.7 4.2Q2.8 0.6 5 3.7Q7.2 0.6 9.3 4.2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>'; // a gull in flight, for labels
  const idle = () => new Promise(r => setTimeout(r, 0));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  const ac = new AbortController(), on = (el, ev, fn, o = {}) => el.addEventListener(ev, fn, Object.assign({ signal: ac.signal }, o));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // ------------------------------------------------------------ load
  const loadMsg = (t, f) => { $('#g-load-msg').textContent = t; $('#g-load-bar').style.width = `${Math.round(f * 100)}%`; };
  let D;
  try {
    D = await OEWorld.load(cityId, { game: true, onMsg: loadMsg });
  } catch (e) {
    loadMsg(`Could not load the game data (${e.message}). Reload the page to try again.`, 0);
    $('#g-loader').classList.add('err');
    return null;
  }
  // the game walks on a 5 m terrain that drops at the seawall (game.json), not the viewer's 10 m grid
  // (the ground mesh uses every second point, 10 m, except on the tiles near the player)
  let Tfine = D.T;
  if (D.G.terrain) {
    const t = D.G.terrain, raw = Uint8Array.from(atob(t.data), c => c.charCodeAt(0)), v = new Int16Array(raw.buffer);
    Tfine = { data: Float32Array.from(v, q => q * t.scale), nx: t.nx, ny: t.ny, cell: t.cell, x0: D.scene.frame.x[0], y1: D.scene.frame.y[1] };
    // land below the level of the sea (behind Osaka's river walls, in an underpass) would be drawn
    // under the water, which lies level everywhere: keep it just above
    const wm = D.G.water;
    if (wm && wm.nx === t.nx && wm.ny === t.ny) {
      const bits = Uint8Array.from(atob(wm.bits), c => c.charCodeAt(0)), d = Tfine.data;
      for (let i = 0; i < d.length; i++) if (d[i] < 0.15 && !((bits[i >> 3] >> (7 - (i & 7))) & 1)) d[i] = 0.15;
    }
    const nx = Math.ceil(t.nx / 2), ny = Math.ceil(t.ny / 2), c = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let k = 0; k < nx; k++) c[r * nx + k] = Tfine.data[(2 * r) * t.nx + 2 * k];
    D.T = { data: c, nx, ny, cell: t.cell * 2, x0: Tfine.x0, y1: Tfine.y1 };
    D.Tfine = Tfine; // the walls of the buildings reach down to whichever ground is drawn
  }
  const { scene, B, P, G, CITY } = D;
  document.title = `${G.title} · Open Earth 3D`;
  // "Paris on Foot": the place set large, "on foot" under it
  const tm = /^(.+?)\s+(on foot)$/i.exec(G.title), gtTitle = $('#gt-title');
  gtTitle.textContent = tm ? tm[1] : G.title;
  if (tm) { const sm = document.createElement('small'); sm.textContent = tm[2]; gtTitle.append(sm); }
  if (G.blurb) $('#gt-blurb').textContent = G.blurb;
  $('#gt-city').textContent = `${CITY.name}, ${CITY.country}`;
  if (G.blurb) $('#g-title p').textContent = G.blurb;
  // neighbouring areas you can go on to, such as the bayside from the city (game.links)
  // and the other maps of the same group (Tokyo's districts: cities/index.json groups), as on the subway map
  const me = (window.OE_CITIES || []).find(c => c.id === cityId), kin = me && me.group
    ? window.OE_CITIES.filter(c => c.group === me.group && c.id !== me.id && c.built && c.game).map(c => ({ id: c.id, name: `${c.name}${c.native ? ` ${c.native}` : ''}`, how: c.tagline })) : [];
  $('#gm-links').innerHTML = [...(G.links || []), ...kin.filter(k => !(G.links || []).some(l => l.id === k.id))]
    .map(l => `<a class="btn" href="#play-${l.id}">${l.name}</a><span class="note">${l.how || ''}</span>`).join('');
  const stage = $('#game-stage'), canvas = $('#game-gl');
  // the device's tier (quality.js): pixels, MSAA, shadows and how much detail the world carries;
  // reversed depth (where the GPU has EXT_clip_control) with the post stack's float depth buffer (atmosphere.js)
  const QC = window.OEQuality.city();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: QC.antialias, powerPreference: 'high-performance', reversedDepthBuffer: true });
  const BASE_FOV = 55, camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.3, 40000);
  let pxScale = 1; // the share of the tier's pixels drawn: shed() lowers it on a device that can't keep up
  let atmos = null; // clouds, stars, the moon and the post stack (atmosphere.js), once the world is up
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setPixelRatio(Math.max(0.6, QC.pixelRatio(w, h) * pxScale)); // (pxScale: shed, below)
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (atmos) atmos.setSize(w, h);
    if (mirror) { const z = renderer.getDrawingBufferSize(new THREE.Vector2()); mirror.setSize(z.x, z.y); }
  }
  let mirror = null; // a wet street's reflections (mirror.js), once the world is up
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  // after dark the far city's traffic is lights (night.js), the cars round the camera real ones (actors.js)
  const Wd = await OEWorld.create(D, renderer, { onMsg: loadMsg, small: QC.small, shadow: QC.shadow, game: true, nearCars: ((G.crowd || {}).radius_m || 450) + 100 });
  const world = Wd.world, U = Wd.U;
  const show = window.OELights ? OELights.create(world, D, Wd) : null; // the city's nightly light show, if it has one
  atmos = window.OEAtmos ? OEAtmos.create(Wd, renderer, camera, { city: D.scene.city, sky: G.sky || {}, look: G.look || {} }) : null;
  if (atmos) { const z = renderer.getSize(new THREE.Vector2()); atmos.setSize(z.x, z.y); }
  // the weather: dry, overcast, drizzle or rain, as the city's climate brings it for the date (weather.js)
  const weather = window.OEWeather ? OEWeather.create(Wd, renderer, camera, { climate: G.weather || null, QC, sky: G.sky || {} }) : null;
  if (atmos && atmos.composer) {
    Wd.skyHaze = true; // fog mixed before the tone curve: the haze takes the sky's colour (world.js)
    Wd.world.fog.near = 1500; Wd.world.fog.far = 24000; // and a little of it over the far city, for depth
    if (renderer.capabilities.reversedDepthBuffer) U.uNudge.value = 1.5e-5; // a float depth buffer needs less to order coplanar roofs (buildings.js)
  }
  // a lost WebGL context pauses the game under a note and comes back redrawn (glcare.js)
  const care = OEGLCare.watch({ renderer, host: stage, onRestored: () => { Wd.restoreGPU(); resize(); } });
  U.uTime = { value: 0 };
  // Close up, 1 m aerial imagery is a blur, lit twice (the photo's own sun and shadows, then the
  // scene's) and far too pale for paving: a sunlit forecourt read as a white sheet with grey
  // smudges. Near the camera the ground is made into a surface: the photo's baked shadows are
  // flattened towards their surroundings (the scene casts its own), the paving is brought to the
  // albedo concrete and sandstone have (about 0.3) instead of the photo's near-white, and paved
  // ground gets pavers (stretcher bond, joints anti-aliased by their screen size, each paver its
  // own shade), roads a fine aggregate, the rest a fine grain; all of it fades out with distance,
  // so from the air the ground is the photograph.
  for (const m of Wd.groundMeshes) m.material.onBeforeCompile = sh => {
    if (Wd.sea) Wd.sea.patchGround(sh); // the wet band and swash along the shore
    sh.uniforms.uStreet = m.material.userData.street = m.material.userData.street || { value: null };
    sh.uniforms.uStreetOn = m.material.userData.streetOn = m.material.userData.streetOn || { value: 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; uniform sampler2D uStreet; uniform float uStreetOn;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
// pavers 0.6 x 0.3 m in stretcher bond: x, 1 inside a paver and 0 in a joint; y, the paver's own shade
vec2 pavers(vec2 p) {
  vec2 q = p / vec2(0.6, 0.3);
  float row = floor(q.y);
  q.x += mod(row, 2.0) * 0.5;
  vec2 f = fract(q), w = fwidth(q) * 1.2, j = vec2(0.012 / 0.6, 0.012 / 0.3);
  float inside = smoothstep(j.x, j.x + w.x, f.x) * smoothstep(j.x, j.x + w.x, 1.0 - f.x) * smoothstep(j.y, j.y + w.y, f.y) * smoothstep(j.y, j.y + w.y, 1.0 - f.y);
  // joints finer than a pixel and a half fade to the mean instead of shimmering
  inside = mix(inside, 0.93, smoothstep(0.25, 0.6, max(w.x, w.y)));
  return vec2(inside, h2(floor(q) + vec2(row * 7.0, 3.0)));
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float camD = distance(vWP, cameraPosition);
float near = 1.0 - smoothstep(12.0, 70.0, camD);
float street = 1.0 - smoothstep(60.0, 420.0, camD); // street level, out to where the photo takes over
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
// the photo's baked shadows and blotches, flattened towards the ground around them
float l0 = dot(texture2D(map, vMapUv).rgb, LUM), l4 = dot(texture2D(map, vMapUv, 4.0).rgb, LUM);
diffuseColor.rgb *= mix(1.0, clamp(sqrt(l4 / max(l0, 0.01)), 0.7, 1.45), 0.75 * (1.0 - smoothstep(25.0, 160.0, camD)));
// the photo's road paint (zebras, stop lines, arrows) where no street is drawn over it, or the drawn
// one has thinned out: a pale, grey pixel much brighter than the grey ground about 6 m round it is
// paint (or a white car's roof), and is brought down to that ground, so roads read as asphalt rather
// than as pale blotches (issue 137). The neighbourhood is the photo's own mip at that size
vec2 oeTx = vec2(textureSize(map, 0));
float oeMpp = length(fwidth(vWP.xz)) / max(length(fwidth(vMapUv * oeTx)), 1e-5); // metres per photo pixel
vec3 nb = textureLod(map, vMapUv, clamp(log2(6.0 / max(oeMpp, 1e-3)), 0.0, 8.0)).rgb;
float lnb = dot(nb, LUM), lpx = dot(diffuseColor.rgb, LUM);
float nbSat = (max(nb.r, max(nb.g, nb.b)) - min(nb.r, min(nb.g, nb.b))) / max(max(nb.r, max(nb.g, nb.b)), 1e-3);
float paint = smoothstep(1.35, 1.9, lpx / max(lnb, 0.01)) * smoothstep(0.35, 0.2, lnb) * smoothstep(0.3, 0.15, nbSat)
  * (1.0 - smoothstep(160.0, 260.0, camD));
diffuseColor.rgb *= mix(1.0, lnb * 0.75 / max(lpx, 1e-3), paint);
// what kind of ground: paved (pale and grey), planted (green), the rest
float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), sat = (mx - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / max(mx, 1e-3);
float green = smoothstep(0.02, 0.08, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
float paved = smoothstep(0.32, 0.18, sat) * smoothstep(0.07, 0.16, dot(diffuseColor.rgb, LUM)) * (1.0 - green);
float roadway = 0.0;
if (uStreetOn > 0.5) { // drawn streets near the camera: no blur, no shadows baked into the photo
  vec4 st = sRGBTransferEOTF(texture2D(uStreet, vMapUv));
  // Gaps in the drawn carriageway (where the photo's road is wider than the width drawn, or where a
  // way stops short of a junction) are filled from the drawn streets 8 m round: a blurred level of
  // them, where it is mostly asphalt and no footway or kerb is drawn at the pixel itself
  // and 16 m round (where footways are drawn near, their pale paint keeps the wider level from
  // counting as carriageway, so it does not spread over a pavement or a forecourt)
  vec4 sb = textureLod(uStreet, vMapUv, 4.0), sc = textureLod(uStreet, vMapUv, 5.0);
  sb.rgb = sRGBTransferEOTF(vec4(sb.rgb / max(sb.a, 0.05), 1.0)).rgb; // (a mip averages in the empty pixels' black)
  sc.rgb = sRGBTransferEOTF(vec4(sc.rgb / max(sc.a, 0.05), 1.0)).rgb;
  float hb = smoothstep(0.4, 0.75, sb.a) * smoothstep(0.13, 0.09, dot(sb.rgb, LUM));
  float hc = smoothstep(0.3, 0.6, sc.a) * smoothstep(0.12, 0.09, dot(sc.rgb, LUM));
  if (hc > hb) sb.rgb = sc.rgb;
  float hole = (1.0 - st.a) * max(hb, hc) * (1.0 - green);
  st = vec4(mix(st.rgb, sb.rgb, hole / max(st.a + hole, 1e-3)), max(st.a, hole));
  float sl = dot(st.rgb, LUM);
  // The photo's own road paint (zebras, stop lines, arrows, the bright concrete of a junction) under
  // the drawn asphalt is flattened to the asphalt's albedo before the two are mixed, or it shows
  // through the street as pale blotches where the drawn layer thins out with distance (issue 137).
  // The drawn street carries its own markings; the photo keeps its paint only beyond 260 m, where
  // the drawn streets are gone too
  float asph = smoothstep(0.0, 0.5, st.a) * smoothstep(0.12, 0.07, sl) * (1.0 - smoothstep(160.0, 260.0, camD));
  float pl = dot(diffuseColor.rgb, LUM), cap = sl * 1.25 + 0.006;
  if (pl > cap) diffuseColor.rgb *= mix(1.0, (cap + (pl - cap) * 0.12) / pl, asph);
  float k = st.a * (1.0 - smoothstep(35.0, 140.0, camD)) * 0.92;
  diffuseColor.rgb = mix(diffuseColor.rgb, st.rgb, k);
  roadway = k * smoothstep(0.12, 0.07, sl);           // asphalt (dark), not the footways and kerbs drawn beside it
  paved = mix(paved, 1.0 - roadway, k);
}
// paving at the albedo it has, not the photo's near-white: a soft knee from 0.28
float L = dot(diffuseColor.rgb, LUM);
if (L > 0.28) diffuseColor.rgb *= mix(1.0, (0.28 + (L - 0.28) * 0.3) / L, street * mix(0.6, 1.0, paved));
// pavers on paved ground, a fine aggregate on the roads, a grain on the rest
vec2 pv = pavers(vWP.xz);
float pnear = 1.0 - smoothstep(8.0, 32.0, camD);
diffuseColor.rgb *= mix(1.0, (0.9 + 0.14 * pv.y) * mix(0.7, 1.0, pv.x), paved * (1.0 - roadway) * pnear * 0.85);
float agg = vn(vWP.xz * 31.0) * 0.6 + vn(vWP.xz * 7.0) * 0.4;
diffuseColor.rgb *= mix(1.0, 0.86 + 0.26 * agg, roadway * near);
float grain = vn(vWP.xz * 2.7) * 0.55 + vn(vWP.xz * 9.0) * 0.3 + vn(vWP.xz * 0.6) * 0.15;
diffuseColor.rgb *= mix(1.0, 0.82 + 0.34 * grain, near * 0.75 * (1.0 - paved * pnear));`);
    // in the rain: darker, glossier ground, and puddles on the roads and the paving (weather.js)
    if (window.OEWeather) OEWeather.patch(sh, { gloss: '1.0 - green', puddles: '1.0 - green', porous: 0.42 });
    Wd.gradePhoto(sh); // the photo's haze out (world.js), before the drawn streets go over it
  };
  loadMsg('Surface model for walking, flying and sunlight', 0.78);
  await idle();
  const T = D.T = Tfine;
  const fineTiles = scene.ground.map(() => null);
  // streets drawn from the footway and road data at 0.5 m per pixel, for the tiles near the player
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const FOOTW = OEActors.FOOTW;
  function streetTexture(i) {
    const t = scene.ground[i], PX = 0.5, w = Math.round((t.x1 - t.x0) / PX), h = Math.round((t.y1 - t.y0) / PX);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.lineCap = g.lineJoin = 'round';
    const inTile = p => { for (let k = 0; k < p.length; k += 3) { const x = p[k] / 10, y = p[k + 1] / 10; if (x > t.x0 - 30 && x < t.x1 + 30 && y > t.y0 - 30 && y < t.y1 + 30) return true; } return false; };
    const path = p => {
      g.beginPath();
      let pen = false;
      for (let k = 0; k < p.length; k += 3) {
        const x = p[k] / 10, y = p[k + 1] / 10, z = p[k + 2] / 10;
        if (z - nav.terrain(x, y) > 3) { pen = false; continue; } // on a bridge deck, not on the ground
        const cx = (x - t.x0) / PX, cy = (t.y1 - y) / PX;
        pen ? g.lineTo(cx, cy) : g.moveTo(cx, cy);
        pen = true;
      }
    };
    const foot = G.paths.foot.filter(f => inTile(f.p)), roads = G.paths.road.filter(r => inTile(r.p));
    for (const f of foot) { path(f.p); g.strokeStyle = '#b3ada1'; g.lineWidth = (FOOTW[f.c] || 3) / PX; g.stroke(); }
    for (const r of roads) { path(r.p); g.strokeStyle = '#9d988d'; g.lineWidth = ((ROADW[r.c] || 7) + 1) / PX; g.stroke(); } // kerbs
    for (const r of roads) { path(r.p); g.strokeStyle = '#4b4e52'; g.lineWidth = (ROADW[r.c] || 7) / PX; g.stroke(); }
    g.setLineDash([3 / PX, 6 / PX]);
    for (const r of roads) if ((ROADW[r.c] || 0) >= 9) { path(r.p); g.strokeStyle = '#e6e2d6'; g.lineWidth = 0.15 / PX; g.stroke(); }
    g.setLineDash([]);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  function fineTile(i) { // the 5 m version of a ground tile, built the first time the player comes near
    const g = Wd.tileGeometry(scene.ground[i], T), coarse = Wd.groundMeshes[i];
    const m = Wd.groundMesh(g, coarse.material);
    m.receiveShadow = true;
    world.add(m);
    return m;
  }
  function groundLod(x, y) {
    scene.ground.forEach((t, i) => {
      const d = Math.hypot(Math.max(t.x0 - x, 0, x - t.x1), Math.max(t.y0 - y, 0, y - t.y1));
      const near = d < 260;
      if (near && !fineTiles[i]) fineTiles[i] = fineTile(i);
      if (fineTiles[i]) fineTiles[i].visible = near;
      const ud = Wd.groundMeshes[i].material.userData;
      if (near && ud.street && !ud.street.value) ud.street.value = streetTexture(i);
      if (ud.streetOn) ud.streetOn.value = near && player.mode !== 'heli' ? 1 : 0;
      Wd.groundMeshes[i].visible = !near;
    });
  }
  const FRAME = { cell: 2, x0: scene.frame.x[0], x1: scene.frame.x[1], y0: scene.frame.y[0], y1: scene.frame.y[1] };
  const DSM = S.buildDSM(T, B.s, Object.assign({ ids: true }, FRAME));
  const nav = OENav.create(D, DSM);
  // the big screens light the street, the crowd and the buildings across from them (neon.js)
  const neon = window.OENeon ? await OENeon.create(Wd, renderer, { tier: QC.name, gain: (G.look || {}).neon ?? 1, fill: (G.look || {}).fill || [], ground: (x, y) => Math.max(0, nav.terrain(x, y)) }) : null;
  // a wet street mirrors the city (mirror.js, high tier): the ground, the paving and the road markings take it
  if (window.OEMirror) {
    mirror = OEMirror.create(Wd, renderer, camera, { tier: QC.name, ground: (x, y) => { const z = Math.max(0, nav.terrain(x, y)), f = nav.floorAt(x, y, z + 0.5); return f ? f.z : z; } });
    for (const m of Wd.groundMeshes) mirror.patch(m.material);
    for (const [k, m] of Object.entries((D.LM && D.LM.materials) || {})) if (m.street_lit || m.decal || m.pattern === 'deck_zones') { mirror.patch(Wd.lmMats[k]); mirror.patch(Wd.floodMats[k]); }
  }
  // landmark solids (the Opera House shells) and walkable strips (the bridge deck) shade the ground too
  for (const [name, m] of Object.entries(nav.tops)) if ((G.shade_landmarks || []).some(p => name.startsWith(p))) for (const [k, z] of m) if (z > DSM.data[k]) DSM.data[k] = z;
  for (const s of nav.strips) for (let i = 0; i < s.us.length - 1; i++) {
    const a = s.us[i], b = s.us[i + 1], w = s.half_width, P2 = (u, v) => [s.origin[0] + s.axis[0] * u - s.axis[1] * v, s.origin[1] + s.axis[1] * u + s.axis[0] * v];
    S.fillMax(DSM, [[...P2(a, -w), ...P2(b, -w), ...P2(b, w), ...P2(a, w)]], Math.max(s.zs[i], s.zs[i + 1]), -3);
  }
  // the helicopter, ferries and cars every city shares (vehicles.js); the box-built ones if they can't be loaded
  let vlib = null;
  // (the helicopter's model after the game opens, when a pad is in range: heliToPad, enterHeli; issue 148)
  try { vlib = await OEVehicles.load('assets/vehicles/', { ferry: (G.ferries || []).length > 0 && (G.ferry_style || {}), heli: 'later' }); } catch (e) { console.warn('Vehicle models unavailable, using simple ones:', e); }
  // decks under the mapped bridges and viaducts (decks.js): drawn, walked, and in the shade model. A
  // bridge over a ferry's course clears the boats with someone standing on the upper deck
  const FI = vlib && vlib.ferryInfo, fstyle = G.ferry_style || {};
  const boatTop = (FI ? FI.upper_deck_m * (fstyle.length_m ? fstyle.length_m / FI.length_m : 1) : 4.2) + 2.2;
  const deckPlan = OEDecks.plan(G.paths, nav, FRAME, { boats: (G.ferries || []).flatMap(f => (f.legs || []).map(l => l.path)), clear: boatTop });
  nav.addDecks(deckPlan.segs);
  for (const d of deckPlan.segs) {
    const L = Math.hypot(d.bx - d.ax, d.by - d.ay) || 1, nx = -(d.by - d.ay) / L * d.hw, ny = (d.bx - d.ax) / L * d.hw;
    S.fillMax(DSM, [[d.ax + nx, d.ay + ny, d.bx + nx, d.by + ny, d.bx - nx, d.by - ny, d.ax - nx, d.ay - ny]], Math.max(d.az, d.bz), -3);
  }
  world.add(OEDecks.mesh(deckPlan.runs, OEWorld.lin));
  // under the decks drawn over the water, the photograph of the same bridge or expressway lies on the bottom
  // and showed through the water as a road on the riverbed (Tokyo's Nihonbashi under the Shuto, issue 65):
  // the water closes over the bottom there. The mask is a little wider than the deck, more so the higher it
  // stands, since an aerial photograph leans a raised deck off its plan position
  if (Wd.sea && Wd.sea.setCover) {
    const wet = deckPlan.runs.filter(r => r.pts.some(q => nav.isWater(q[0], q[1])));
    if (wet.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const r of wet) for (const q of r.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      x0 -= 40; x1 += 40; y0 -= 40; y1 += 40;
      const res = Math.max(1, Math.max(x1 - x0, y1 - y0) / 4096), cv = document.createElement('canvas');
      cv.width = Math.ceil((x1 - x0) / res); cv.height = Math.ceil((y1 - y0) / res);
      const g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
      for (const r of wet) {
        const hi = Math.max(...r.pts.map(q => q[2]));
        g.lineWidth = (r.w + 2 * Math.max(2.5, 0.25 * hi)) / res;
        g.beginPath();
        r.pts.forEach((q, k) => g[k ? 'lineTo' : 'moveTo']((q[0] - x0) / res, (y1 - q[1]) / res));
        g.stroke();
      }
      g.filter = 'blur(2px)'; g.drawImage(cv, 0, 0); // a soft edge, not a cut line in the water
      const tex = new THREE.CanvasTexture(cv);
      tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.NoColorSpace;
      Wd.sea.setCover(tex, x0, y1, x1 - x0, y1 - y0);
    }
  }
  // where a walkable strip (a canal bridge's deck) is carried on to the quay (nav.js), the approach is drawn in the deck's stone
  const LMM = (D.LM && D.LM.materials) || {};
  if (nav.approaches.length) world.add(OEDecks.mesh(nav.approaches.map(a => {
    const s = a.strip, P3 = (u, z) => [s.origin[0] + s.axis[0] * u, s.origin[1] + s.axis[1] * u, z], back = a.to > a.from ? -0.3 : 0.3;
    return { pts: [P3(a.from + back, a.z0), P3(a.to, a.z1)], w: 2 * s.half_width, kind: 'foot', lift: 0, cols: [], parapet: false, colour: (LMM[s.mesh] || {}).color };
  }), OEWorld.lin));
  S.pyramid(DSM);
  // benches, street lamps and trees on the ground drawn under them (their heights in the data are
  // from the survey grid, which the drawn ground between its points can be below or above): on a
  // deck or pier at their height, else on the ground, else, on the bank of the water, a step back
  // from it; a tree the drawn ground would put under the water is not drawn
  const seat = (x, y, z) => {
    let on = Math.abs(nav.surfaceAt(x, y) - z) < 0.5;
    nav.decksAt(x, y, h => { if (Math.abs(h - z) < 0.5) on = true; });
    if (on) return [x, y, z];
    if (!nav.offGround(x, y)) return [x, y, nav.terrain(x, y)];
    const p = nav.stand(x, y, z, { rMax: 8 });
    return p ? [p.x, p.y, p.z] : [x, y, z];
  };
  for (const flat of Object.values(G.props || {})) for (let i = 0; i < flat.length; i += 3) {
    const q = seat(flat[i] / 10, flat[i + 1] / 10, flat[i + 2] / 10);
    for (let k = 0; k < 3; k++) flat[i + k] = Math.round(q[k] * 10);
  }
  // none in a wall (the data's points and the model's footprints disagree by a metre or two), nor, after
  // that step back from the water, in a carriageway (streets.js moved them out of those before; here
  // the roads are where decks.js has laid them, on their bridges' and viaducts' decks), nor under a
  // deck too low for it to stand under
  const roadsNow = OEStreets.carriageways(G.paths.road.map(r => ({ c: r.c, p: r.p.map(v => v / 10) })));
  const inRoad = (x, y, z, r) => roadsNow.depth(x, y, z, r) > 0;
  // (against the 2 m surface model, and where a landmark's 2 m cell says no, its triangles, nav.js
  // withoutFine: the fine cells of the whole city would cost seconds at the start; paving, padded 0.3 m
  // in the 2 m cells, stays under 0.45)
  const inWall = (x, y, z, r) => nav.withoutFine(() => nav.col.overlap(x, y, r, z + 0.3, z + 2.2, (i, p) => p.tag === 1 && p.zhi <= z + 0.3) || nav.landmarkHit(x, y, z + 0.45, z + 2.2));
  const underDeck = (x, y, z, top) => { let hit = false; nav.decksAt(x, y, h => { if (h > z + 0.5 && h < z + top) hit = true; }); const s = nav.surfaceAt(x, y); return hit || (s > z + 0.5 && s < z + top); };
  for (const [k, r] of [['street_lamp', 0.12], ['bench', 0.3]]) {
    const flat = (G.props || {})[k];
    if (!flat) continue;
    const keep = [];
    for (let i = 0; i < flat.length; i += 3) {
      const x = flat[i] / 10, y = flat[i + 1] / 10, z = flat[i + 2] / 10;
      if (!inWall(x, y, z, r) && !inRoad(x, y, z, k === 'bench' ? 0.6 : r) && !underDeck(x, y, z, k === 'bench' ? 2 : 7)) keep.push(flat[i], flat[i + 1], flat[i + 2]);
    }
    G.props[k] = keep;
  }
  if (Wd.trees && Wd.trees.reseat) Wd.trees.reseat((x, y) => { const g = nav.terrain(x, y); return g > 0 && !inWall(x, y, g, 0.3) && !inRoad(x, y, g, 0.4) && !underDeck(x, y, g, 8) ? g : null; });
  // night.js's poles, behind the kerb: where one would be in a wall, its lamp hangs on a bracket there
  // (and one beside a deck, in the road or under it, goes)
  if (Wd.night && Wd.night.hidePoles) Wd.night.hidePoles((x, y, z) => !inWall(x, y, z, 0.1) && !inRoad(x, y, z, 0.1) && !inRoad(x, y, nav.terrain(x, y), 0.1) && !underDeck(x, y, z, 7));
  // lamp posts and tree trunks are solid: for you on foot and at the wheel, the crowd and the traffic
  const posts = OEStreets.posts();
  { const L = G.props.street_lamp || [], NP = (Wd.night && Wd.night.poles) || [], TR = Wd.trees && Wd.trees.trunks ? Wd.trees.trunks() : [];
    for (let i = 0; i < L.length; i += 3) posts.add(L[i] / 10, L[i + 1] / 10, L[i + 2] / 10, 0.12, 'lamp');
    for (let i = 0; i < NP.length; i += 3) posts.add(NP[i], NP[i + 1], NP[i + 2], 0.12, 'lamp');
    for (let i = 0; i < TR.length; i += 4) posts.add(TR[i], TR[i + 1], TR[i + 2], TR[i + 3], 'tree'); }
  nav.posts = posts;
  // where someone or a car beside a mapped line stands: its deck, the surface the line is on (a pier, a
  // bridge's walkway, a flight of steps: not the ground under it), or the ground drawn there (null on the bank of the water)
  const lineGround = (x, y, at) => {
    if (at.deck) return at.z;
    const s = nav.surfaceAt(x, y);
    if (s > -Infinity && Math.abs(s - at.z) < 1.5) return s;
    return nav.offGround(x, y) ? null : nav.terrain(x, y);
  };
  // footways and roads that run into a building (an arcade, a station's concourse, a street under a
  // railway station's viaduct: the model's buildings are solid from the ground up) end at its wall, so
  // the crowd and the traffic keep to each mapped line only where they can be (r: how far the line
  // keeps from a wall; overDecks: leave what is on a deck alone, a viaduct over a building included)
  function cutAtWalls(lines, r = 0.1, overDecks = false) {
    const out = [];
    for (const l of lines) {
      const p = l.p, n = p.length / 3;
      let cur = null, curD = null, wallA = 0, wall = 0; // (w: 1 where a piece starts at a wall, 2 where it ends at one)
      const flush = (atWall = false) => {
        if (cur && cur.length >= 6) {
          let len = 0;
          for (let k = 3; k < cur.length; k += 3) len += Math.hypot(cur[k] - cur[k - 3], cur[k + 1] - cur[k - 2]);
          if (len >= 40) out.push(Object.assign({}, l, { p: cur, d: l.d ? Uint8Array.from(curD) : undefined, w: wallA | (atWall ? 2 : 0) }));
        }
        cur = curD = null;
        if (atWall) wall = 1;
      };
      const put = (x, y, z, d) => { if (!cur) { cur = []; curD = []; wallA = wall; wall = 0; } else curD.push(d); cur.push(x, y, z); };
      for (let k = 0; k < n; k++) {
        const x = p[3 * k], y = p[3 * k + 1], z = p[3 * k + 2], deck = l.d && k > 0 ? l.d[k - 1] : 0, skip = overDecks && deck;
        if (k > 0) { // every metre and a half along the stretch from the last point
          const ax = p[3 * k - 3], ay = p[3 * k - 2], az = p[3 * k - 1], m = Math.max(1, Math.ceil(Math.hypot(x - ax, y - ay) / 15));
          for (let j = 1; j < m; j++) {
            const qx = ax + (x - ax) * j / m, qy = ay + (y - ay) * j / m, qz = az + (z - az) * j / m;
            if (!skip && nav.solid(qx / 10, qy / 10, qz / 10, r)) flush(true);
            else if (!cur) put(Math.round(qx), Math.round(qy), Math.round(qz), deck);
          }
        }
        if (!skip && nav.solid(x / 10, y / 10, z / 10, r)) flush(true);
        else put(x, y, z, deck);
      }
      flush();
    }
    return out;
  }

  // ------------------------------------------------------------ street furniture: benches, lamps that light at night
  loadMsg('People, traffic and ferries: downloading the models every city shares', 0.86);
  await idle();
  const lin = OEWorld.lin, dummy = new THREE.Object3D();
  // the traffic keeps off the stretches of road that run through a wall (cutAtWalls); the crowd
  // walks the footways where a walker can, not through the buildings a mapped passage runs into
  // (route.js), nor through a wall
  // (against a landmark's triangles where its 2 m cells would cut the way, nav.js withoutFine: a crowd's
  // way through a gate's passage or between lanterns is kept where a walker gets through)
  const footNet = OEActors.network(G.paths.foot), roadNet = OEActors.network(nav.withoutFine(() => cutAtWalls(G.paths.road, 0.5, true)));
  loadMsg('Footways people can walk', 0.84);
  await idle();
  const crowdNet = OEActors.network(nav.withoutFine(() => cutAtWalls(OERoute.walkable(nav, G.paths.foot))));
  // benches face their footway, or the water behind it; each has two seats the crowd can use
  const benches = nav.withoutFine(() => OEActors.benches(G.props.bench || [], crowdNet, nav)), lamps = G.props.street_lamp || [];
  const benchMesh = new THREE.InstancedMesh(OEActors.boxes([ // seat, backrest and two ends; faces +z
    [1.7, 0.06, 0.42, 0, 0.42, 0.03, 0, 0], [1.7, 0.34, 0.05, 0, 0.66, -0.2, 0, 0], [0.07, 0.42, 0.44, 0.72, 0.21, 0, 0, 0], [0.07, 0.42, 0.44, -0.72, 0.21, 0, 0, 0]]),
  new THREE.MeshStandardMaterial({ color: lin('#6e5a44'), roughness: 0.9 }), benches.list.length);
  benches.list.forEach((b, i) => { dummy.position.copy(W(b.x, b.y, b.z)); dummy.rotation.y = Math.PI - b.h; dummy.updateMatrix(); benchMesh.setMatrixAt(i, dummy.matrix); });
  benchMesh.castShadow = benchMesh.receiveShadow = true;
  const nl = lamps.length / 3;
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 6).translate(0, 3.25, 0), new THREE.MeshStandardMaterial({ color: lin('#3b4248'), roughness: 0.6, metalness: 0.4 }), nl);
  const headMat = new THREE.MeshStandardMaterial({ color: lin('#d8d4c8'), emissive: lin('#ffcf8a'), emissiveIntensity: 0 });
  const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.18, 0.7).translate(0, 6.5, 0.25), headMat, nl);
  const glowPos = new Float32Array(nl * 3);
  for (let i = 0; i < nl; i++) {
    dummy.position.copy(W(lamps[3 * i] / 10, lamps[3 * i + 1] / 10, lamps[3 * i + 2] / 10)); dummy.rotation.y = (i * 1.7) % 6.28; dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix); headMesh.setMatrixAt(i, dummy.matrix);
    glowPos.set([dummy.position.x, dummy.position.y + 6.35, dummy.position.z], i * 3);
  }
  poleMesh.castShadow = true;
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.25, 'rgba(255,190,110,0.45)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glowMat = new THREE.PointsMaterial({ size: 9, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true });
  const glows = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(glowPos, 3)), glowMat);
  world.add(benchMesh, poleMesh, headMesh);
  if (!Wd.night) world.add(glows); // night.js lights these lamps with the rest of the street lights

  // ------------------------------------------------------------ people and traffic
  // realistic characters (people.js); the box-built rigs are the fallback if their files can't be loaded
  const PLAYER_KEY = 'oe3d-player', PLAYER_LOOKS = {
    W_Worker: { character: 'W_Worker', skin: '#d49c76', hair: '#33241b', scale: 0.92 },
    M_Worker: { character: 'M_Worker', skin: '#e3b08d', hair: '#4a3222', scale: 0.97 } };
  for (const [k, v] of Object.entries(G.player_looks || {})) if (PLAYER_LOOKS[k]) Object.assign(PLAYER_LOOKS[k], v); // a city's own look for the player
  let playerChar = 'W_Worker';
  try { if (PLAYER_LOOKS[localStorage.getItem(PLAYER_KEY)]) playerChar = localStorage.getItem(PLAYER_KEY); } catch (e) { /* storage blocked */ }
  let lib = null;
  const NPC_LOAD_M = 300, nearStart = n => !G.start || Math.hypot(n.at[0] - G.start.at[0], n.at[1] - G.start.at[1]) < NPC_LOAD_M;
  try {
    lib = await OEPeople.load('assets/people/');
    if ((G.crowd || {}).style) OEPeople.setStyle(G.crowd.style);
    if (Wd.streetLit) OEPeople.setLight(Wd.streetLit); // the street lights light the people after dark
  } catch (e) { console.warn('Realistic people unavailable, using simple figures:', e); lib = null; }
  // the box-built figures are the last resort, for a device that could load none of the people's
  // files: one character that fails to load (after its retries, gltf.js) leaves the rest of the
  // library in place, and whoever was to wear it wears another realistic character (stand-in)
  if (lib) {
    // the surveyors you play are the main characters (blender/build_people.py): the one you play now
    // loads here, the other when you switch; the old characters stand in if their files don't load
    for (const [k, h] of Object.entries({ W_Worker: 'H_Surveyor_W', M_Worker: 'H_Surveyor_M' })) if (lib.heroes[h]) PLAYER_LOOKS[k].hero = h;
    const pl = PLAYER_LOOKS[playerChar];
    if (pl.hero) await lib.require(pl.hero).then(() => Object.assign(pl, { character: pl.hero, scale: 1 })).catch(e => console.warn(`${pl.hero} unavailable:`, e));
    await lib.require(pl.character).catch(e => console.warn(`${pl.character} unavailable:`, e));
    // the NPCs near the start before the game opens, the others as you first come within NPC_LOAD_M of
    // them (npcStream; issue 148)
    await Promise.all(G.npcs.filter(nearStart).map(n => n.look.character).filter(Boolean).map(c => lib.require(c).catch(e => console.warn(`${c} unavailable:`, e))));
  }
  // a character that is loaded for one that is not: of the same sex, textured (an NPC's or a
  // surveyor's) before the crowd's, at its own size (the crowd's run large)
  const sexOf = c => (/^W_|Female|_W$/.test(c) ? 'W' : 'M');
  function standIn(look) {
    const want = sexOf(look.character), have = Object.keys(lib.tpl), rank = c => (sexOf(c) === want ? 0 : 4) + (/^R_/.test(c) ? 0 : /^H_/.test(c) ? 1 : 2);
    const c = have.sort((a, b) => rank(a) - rank(b))[0];
    return c && Object.assign({}, look, { character: c, scale: /^W_/.test(c) ? 0.91 : /^M_/.test(c) ? 0.96 : 1 });
  }
  const makeRig = (look, opts) => {
    const real = lib && look.character && (lib.tpl[look.character] ? look : standIn(look));
    return real ? OEPeople.person(lib, Object.assign({}, real)) : OEActors.makePerson(look, opts);
  };
  // an NPC whose character is still to load: nobody there yet (npcStream puts them in when it has come)
  const awaited = look => lib && look.character && !lib.tpl[look.character] && (lib.npcs[look.character] || lib.heroes[look.character] || lib.info.characters[look.character]);
  const pendingRig = () => ({ root: new THREE.Group(), pending: true, animate() {} });
  const CR = G.crowd || {};
  let crowdDraw = null; // the crowd's renderer (people.js), for umbrellas in the rain
  // the box-built fallback figures can't sit, so only the realistic crowd uses the benches
  // the walkers there are room for: on the medium and high tiers a city's peak (game.crowd.pedestrians_peak),
  // on the low tier its usual number, so a phone draws no more people than it did
  const crowdPool = QC.name === 'low' ? CR.pedestrians || 300 : CR.pedestrians_peak || CR.pedestrians || 300;
  const crowd = OEActors.crowd(world, crowdNet, U, crowdPool, CR.radius_m || 450, lib && (P => (crowdDraw = OEPeople.crowdRenderer(world, lib, U, P, { near: touch ? 6 : 14, style: CR.style }))),
    { benches: lib ? benches : null, ground: lineGround, wall: (x, y, z) => nav.solid(x, y, z, 0.2), posts, clear: (x, y, z) => nav.room(x, y, z, 0.3) });
  // the side of the road the city keeps to: game.keep, its trams', or the country's rule
  const KEEP = G.keep || ((G.rail || {}).tram || {}).keep || (/^(Australia|Japan|United Kingdom|Ireland|New Zealand|Singapore|Malaysia|Indonesia|Thailand|India|South Africa)$/.test(CITY.country)
    || /^(Hong Kong|Macau)/.test(CITY.name) ? 'left' : 'right');
  // the junctions and their rules (junctions.js): the mapped signals, stop and give-way signs, and the signal heads
  const junctions = OEJunctions.create(roadNet, { signals: G.props.traffic_signals || null, stops: G.props.stop || [], giveWay: G.props.give_way || [], keep: KEEP, lane: OECars.LANE,
    midCrossings: { signals: G.props.crossing_signals, zebra: G.props.crossing_zebra },
    // (and the crossings between junctions: signals or zebra stripes); the scrambles, every way at once in
    // a phase of their own: Shibuya's with its mapped crosswalks (scene landmarks), the others a city names
    scrambles: [(scene.landmarks || {}).scramble, ...(G.scrambles || [])].filter(Boolean), foot: crowdNet });
  junctions.build(world, { style: Object.assign({ country: CITY.country }, G.signals || {}), ground: lineGround, eye: camera });
  if (junctions.heads && junctions.heads.walkPosts) for (const q of junctions.heads.walkPosts) posts.add(q.x, q.y, q.z, 0.09, 'lamp'); // (a scramble's walk signals stand beside its crosswalks: walked round)
  // (is (x, y) in a carriageway, as the game draws the roads? nobody waits there)
  const ROAD_HALF = { motorway: 7, trunk: 6, primary: 6, secondary: 5, tertiary: 4.5, residential: 3.5, unclassified: 3, living_street: 2.5 };
  const onRoad = (x, y) => { const q = roadNet.nearest(x, y, 8); return !!q && q.d < (ROAD_HALF[roadNet.L[q.line].c] || 3.5) + 0.3; };
  // the crowd waits at the kerb for the walk signal where its footways cross a junction's roads
  crowd.crossings = { byLine: junctions.crossings(crowdNet, onRoad), walk: junctions.walk, walkLeft: junctions.walkLeft, call: junctions.call };
  // and gathers at the scrambles: a share of it their own, massing at the kerbs and surging across
  // every way at once (actors.js plazas), and more of it on the footways round them
  { const S = junctions.J.filter(j => j.scramble && j.spans && j.spans.length);
    if (S.length) {
      crowd.plazas = S.map(j => { const a = j.arms.find(q => q.in) || j.arms[0]; return (j.plaza = { j, x: j.x, y: j.y, spans: j.spans, weight: j.mapped3 ? 8 : 1, road: onRoad, walk: () => junctions.walk(a), left: () => junctions.walkLeft(a) }); });
      crowd.hot = S.map(j => ({ x: j.x, y: j.y, r: 90, share: 0.16 / S.length, pull: 0.5 }));
    } }
  const cars = OEActors.traffic(world, roadNet, U, CR.cars || 120, (CR.radius_m || 450) + 100, { lib: vlib, cfg: (G.vehicles || {}).cars || {}, eye: camera, keep: KEEP, ground: lineGround, crowd, nav, posts, junctions });
  const density = { low: 0.35, normal: 1, high: 1 };
  const playerLook = () => Object.assign({ shirt: '#2f4858', pants: '#2b3440', skin: '#e0ac85', hair: '#3b2a20' }, PLAYER_LOOKS[playerChar]);
  const player = { rig: makeRig(playerLook(), { vest: true }),
    x: 0, y: 0, z: 0, h: 0, vz: 0, speed: 0, ground: true, floor: 'ground', mode: 'foot', vehicle: null, auto: null, walking: false };
  world.add(player.rig.root);
  async function setPlayerCharacter(name) { // swap the player's character in place
    if (!lib || !PLAYER_LOOKS[name]) return;
    const pl = PLAYER_LOOKS[name];
    if (pl.hero && pl.character !== pl.hero) await lib.require(pl.hero).then(() => Object.assign(pl, { character: pl.hero, scale: 1 })).catch(e => console.warn(`${pl.hero} unavailable:`, e));
    await lib.require(pl.character).catch(() => {});
    playerChar = name;
    try { localStorage.setItem(PLAYER_KEY, name); } catch (e) { /* storage blocked */ }
    const old = player.rig, parent = old.root.parent, rig = makeRig(playerLook(), { vest: true });
    rig.root.position.copy(old.root.position); rig.root.rotation.copy(old.root.rotation);
    rig.legRake = old.legRake; rig.reach = old.reach; // in a seat, the same way
    if (parent) { parent.remove(old.root); parent.add(rig.root); }
    player.rig = rig;
  }
  const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const npcs = [];
  // the old characters run large; the Rocketbox ones (R_) are life size
  const npcLook = n => Object.assign({ scale: /^W_/.test(n.look.character) ? 0.91 : /^M_/.test(n.look.character) ? 0.96 : 1 }, n.look);
  for (const n of G.npcs) {
    const rig = awaited(n.look) ? pendingRig() : makeRig(npcLook(n));
    world.add(rig.root);
    // on the ground, or a strip or roof below 200 m (not up on a viaduct passing over), or at the height given;
    // off a bank sloping into the water, out of the road (and the room a car pulls in to at the kerb), clear
    // of the lamp posts, trunks and benches, and not on someone else's toes
    let f = nav.floorAt(n.at[0], n.at[1], n.at[2] != null ? n.at[2] + 1 : Math.max(200, nav.terrain(n.at[0], n.at[1]) + 1));
    if (f && f.kind === 'deck' && n.at[2] == null) f = nav.floorAt(n.at[0], n.at[1], nav.terrain(n.at[0], n.at[1]) + 1);
    const z0 = f ? f.z : Math.max(0, nav.terrain(n.at[0], n.at[1]));
    const clear = (x, y) => !npcs.some(q => Math.hypot(q.x - x, q.y - y) < 1.2) && !inRoad(x, y, z0, 0.3) && !posts.pushOut(x, y, 0.45, z0).hit
      && !benches.list.some(b => Math.abs(b.z - z0) < 1.5 && Math.abs((x - b.x) * Math.sin(b.h) + (y - b.y) * Math.cos(b.h)) < 0.6 && Math.abs(-(x - b.x) * Math.cos(b.h) + (y - b.y) * Math.sin(b.h)) < 1.2);
    const p = nav.stand(n.at[0], n.at[1], z0 + (f ? 0.5 : 1), { rMax: 15, ok: clear }) || nav.stand(n.at[0], n.at[1], z0 + (f ? 0.5 : 1),
      { rMax: 15, ok: (x, y) => !npcs.some(q => Math.hypot(q.x - x, q.y - y) < 1.2) }) || { x: n.at[0], y: n.at[1], z: f ? f.z : 0 };
    const o = Object.assign({}, n, { rig, x: p.x, y: p.y, z: p.z, h: hash(n.id) % 628 / 100, pitch: 150 + hash(n.id) % 170, color: n.look.top || n.look.shirt, eyes: new THREE.Vector3(),
      marker: OEActors.sprite('!', { bg: '#e0a21a', fg: '#1b1b1b', font: '900 44px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' }) });
    o.marker.scale.multiplyScalar(1.4);
    o.marker.position.set(0, 2.45, 0);
    rig.root.add(o.marker);
    rig.root.position.copy(W(o.x, o.y, o.z));
    rig.root.rotation.y = Math.PI - o.h;
    npcs.push(o);
  }
  const npcById = id => npcs.find(n => n.id === id);
  // an NPC's character, loaded and put in their place (or another realistic one if it can't be loaded)
  const npcLoad = n => n.loading || (n.loading = !n.rig.pending ? Promise.resolve() : lib.require(n.look.character).catch(e => console.warn(`${n.look.character} unavailable:`, e)).then(() => {
    const old = n.rig, rig = makeRig(npcLook(n));
    rig.root.position.copy(old.root.position); rig.root.rotation.copy(old.root.rotation);
    rig.root.add(n.marker);
    if (old.root.parent) old.root.parent.remove(old.root);
    world.add(rig.root);
    n.rig = rig;
  }));
  let npcBudget = 0;
  function npcStream(dt, cx, cy) { // twice a second: those within NPC_LOAD_M of you
    if ((npcBudget -= dt) > 0) return;
    npcBudget = 0.5;
    for (const n of npcs) if (n.rig.pending && !n.loading && Math.hypot(n.x - cx, n.y - cy) < NPC_LOAD_M) npcLoad(n);
  }
  const npcsReady = () => Promise.all(npcs.map(npcLoad)); // every NPC in place (for the tools that look at them)

  // ------------------------------------------------------------ vehicles
  const vopts = { lib: vlib, cfg: G.vehicles || {}, city: CITY, U, camera, renderer, water: Wd.sea };
  // a pad the data puts on the ground inside a building's footprint is on its roof (a hospital's, a
  // tower's): there, if the roof is clear above for the rotor, else on the nearest open ground with
  // clear sky (pipeline/game_data.py snaps new data the same way)
  for (const p of G.helipads) {
    const [x, y, z] = p.at, top = nav.col.topAt(x, y, Infinity, nav.BUILDING);
    if (!(top > z + 2)) continue;
    if (nav.free(x, y, top + 0.3, top + 600, 5)) { p.at = [x, y, top]; continue; }
    let best = null;
    for (let r = 4; r <= 120 && !best; r += 4) for (let k = 0, n = Math.ceil(2 * Math.PI * r / 4); k < n && !best; k++) {
      const a = 2 * Math.PI * k / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, f = nav.floorAt(px, py, nav.terrain(px, py) + 0.5);
      if (f && f.kind === 'ground' && !nav.offGround(px, py) && Math.abs(nav.groundBelow(px, py, f.z + 1) - f.z) < 0.5 && nav.free(px, py, f.z + 0.3, f.z + 600, 6)) best = [px, py, f.z];
    }
    if (best) p.at = best.map(v => Math.round(v * 10) / 10);
  }
  const padAt = (G.helipads[0] || { at: [G.start.at[0] + 20, G.start.at[1], 2] }).at;
  const heli = OEVehicles.helicopter(world, nav, padAt, vopts);
  if (G.helipads[0] && G.helipads[0].heading != null) heli.st.h = G.helipads[0].heading * Math.PI / 180;
  // One helicopter serves every pad. It starts on the first, by the start; walk (or ride) towards
  // another pad while it stands shut down far out of sight, and it is waiting there when you
  // arrive, as a pilot's quest expects (the pad within 300 m of you, it more than 700 m away).
  let padCheck = 0;
  function heliToPad() {
    if ((padCheck -= 1) > 0) return;
    padCheck = 30; // every half second or so
    const st = heli.st;
    if (!heli.loaded() && Math.hypot(st.x - player.x, st.y - player.y) < 800) heli.want(); // its model, once you are near it
    if (!st.landed || st.on || st.rotor > 0.02 || st.door > 0 || Math.hypot(st.x - player.x, st.y - player.y) < 700) return;
    for (const p of G.helipads) {
      if (Math.hypot(p.at[0] - player.x, p.at[1] - player.y) > 300 || Math.hypot(p.at[0] - st.x, p.at[1] - st.y) < 20) continue;
      Object.assign(st, { x: p.at[0], y: p.at[1], z: p.at[2], vx: 0, vy: 0, vz: 0, yawRate: 0, pitch: 0, roll: 0, speed: 0, under: null });
      if (p.heading != null) st.h = p.heading * Math.PI / 180;
      heli.update(0, {}, []);
      return;
    }
  }
  const fer = OEVehicles.ferries(world, G, nav, name => OEActors.sprite(name, { bg: 'rgba(30,91,58,0.9)' }), vopts);
  const wharfById = id => G.wharves.find(w => w.id === id);
  // where you stand to board at each wharf: by its terminal, or the nearest place on foot to it where
  // the terminal is mapped out on the water
  for (const w of G.wharves) { const p = nav.stand(w.terminal[0], w.terminal[1], 2, { rMax: 90, room: 100 }); w.landing = p ? [p.x, p.y] : w.terminal.slice(); }
  // street trams and a funicular, where the city has them (rail.js)
  const rail = G.rail && window.OERail ? OERail.create(world, G) : null;
  const railStation = (x, y, r = 25) => (rail ? rail.stations.find(st => Math.hypot(st.x - x, st.y - y) < r) : null);
  // neighbourhood signs, things to look at and conversations to overhear (places.js), and lifts between a
  // street door and a floor high up (game.json "lifts", from the city's landmarks)
  const places = window.OEPlaces ? OEPlaces.create({ G, W, camera, stage }) : null;
  const lifts = G.lifts || [];
  function liftStop(x, y, z) {
    for (const l of lifts) for (let i = 0; i < l.stops.length; i++) {
      const s = l.stops[i];
      if (Math.hypot(s.at[0] - x, s.at[1] - y) < 3.0 && Math.abs(s.at[2] - z) < 2.5) return { l, i };
    }
    return null;
  }

  // ------------------------------------------------------------ cars: your own, taxis and rides (cars.js)
  // Your car waits at the kerb near the start (game.vehicles.car: { model, colour, seat }) and
  // stays where you leave it; the phone brings it to you. Raise your hand at the kerb (Y) and a
  // taxi pulls in: the nearest free one coming your way, or one from round the corner. Or order
  // a ride on the phone (N), as GTA VI's Ryde Me app does: say where first, and a private-hire
  // car comes to your side of the street. You get in the back (a taxi driver asks where to), and
  // the driver takes you by road, talking about what you pass, as a local would. F skips
  // the trip, as in GTA V. Whichever it is arrives within half a minute: it sets out from a
  // street chosen so the trip, timed by driving it in a dry run, takes 14 to 25 s, and it drives
  // briskly while it is well out of your sight. The phone shows it coming as a ride app does: the
  // car on the map moving along its route to the pick-up, and the time it will take.
  const keepSign = KEEP === 'left' ? 1 : -1, kerbSeat = KEEP === 'left' ? 'rear_left' : 'rear_right';
  const CARS_OK = !!(vlib && vlib.cars && Object.values(vlib.info.cars.models).some(m => m.seats));
  const carCfg = Object.assign({ model: 'Car_Hatch', colour: '#c8372d', seat: '#34363a' }, (G.vehicles || {}).car);
  // the ways you can actually go, on foot, by road and in the air (route.js), worked out in slices behind the title
  const ways = OERoute.create({ nav, footNet, roadNet, DSM, helipads: G.helipads, lifts: G.lifts || [] });
  roadNet.avoid = ways.drive;
  const roads = OECars.router(roadNet, { avoid: ways.drive }), headlamp = CARS_OK ? OECars.headlamp(world) : null, rq = {};
  // a pose at the kerb of a place on the roads (router.place), facing the way it goes
  function kerbPose(pl, off) {
    roadNet.at(pl.line, pl.s, rq);
    const hx = rq.hx * pl.dir, hy = rq.hy * pl.dir, k = (off ?? OECars.kerbOf(roadNet.L[pl.line].c)) * keepSign;
    const x = rq.x - hy * k, y = rq.y + hx * k, f = nav.floorAt(x, y, rq.z + 1);
    return { x, y, z: f ? f.z : rq.z, h: Math.atan2(hx, hy) };
  }
  // a place on the roads moved along its street clear of a scramble: no stopping within 5 m of its
  // crosswalks (Japan's Road Traffic Act, art. 44), where its crowd masses at the kerb and surges out
  // (the crosswalks, each its two ends; a car's centre within 5 m and its half-length of one is too close)
  const SCR_AT = [].concat(...junctions.J.filter(j => j.scramble && j.spans && j.spans.length).map(j => j.spans));
  const nearSpan = (x, y, r) => SCR_AT.some(w => {
    const ex = w[3] - w[0], ey = w[4] - w[1], t = Math.max(0, Math.min(1, ((x - w[0]) * ex + (y - w[1]) * ey) / (ex * ex + ey * ey || 1)));
    return Math.hypot(x - w[0] - ex * t, y - w[1] - ey * t) < r;
  });
  // (and the box between them: out to the farthest crosswalk's middle)
  const SCR_BOX = junctions.J.filter(j => j.scramble && j.spans && j.spans.length).map(j => ({ x: j.x, y: j.y, r: Math.max(...j.spans.map(w => Math.hypot((w[0] + w[3]) / 2 - j.x, (w[1] + w[4]) / 2 - j.y))) }));
  const inScramble = (line, s) => { roadNet.at(line, s, rq); return nearSpan(rq.x, rq.y, 7.5) || SCR_BOX.some(j => Math.hypot(rq.x - j.x, rq.y - j.y) < j.r); };
  function offScramble(pl, room = false) { // (room: a car to drive off from it, the spot with road ahead first; a pick-up, the nearest)
    if (!pl || !SCR_AT.length || (!inScramble(pl.line, pl.s) && !(room && inScramble(pl.line, Math.max(0, Math.min(roadNet.L[pl.line].len, pl.s - 15 * pl.dir)))))) return pl;
    // (the nearest clear spot either way, the one with road ahead to drive off along first)
    const L = roadNet.L[pl.line].len, found = [];
    const clear = s => !inScramble(pl.line, s) && (!room || !inScramble(pl.line, Math.max(0, Math.min(L, s - 15 * pl.dir)))); // (a car: and the kerb behind it, room for a taxi to pull in there)
    for (const sg of [1, -1]) for (let d = 3; d <= 90; d += 3) {
      const s = pl.s + d * sg;
      if (s < 3 || s > L - 3) break;
      if (clear(s)) { found.push({ s, d, room: pl.dir > 0 ? L - s : s }); break; }
    }
    if (!found.length) return pl;
    found.sort((a, b) => (room ? (b.room > 25) - (a.room > 25) : 0) || a.d - b.d);
    roadNet.at(pl.line, found[0].s, rq);
    return Object.assign({}, pl, { s: found[0].s, x: rq.x, y: rq.y, z: rq.z });
  }
  // where to be picked up near (x, y): the nearest kerb within reach that is clear of a scramble, on
  // this street or one round it (a taxi never pulls in on a scramble's crosswalks or in its box)
  function pickupNear(x, y, z, within) {
    const pl = roads.place(x, y, within, keepSign, z);
    if (!pl || !SCR_AT.length || !inScramble(pl.line, pl.s)) return pl;
    let best = offScramble(pl), bd = inScramble(best.line, best.s) ? Infinity : Math.hypot(best.x - x, best.y - y);
    for (let r = 6; r <= Math.min(within, 40); r += 6) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, q = roads.place(x + Math.sin(a) * r, y + Math.cos(a) * r, 6, keepSign, z);
      if (!q || inScramble(q.line, q.s)) continue;
      roadNet.at(q.line, q.s, rq); // (going the way that keeps you on its kerb side)
      q.dir = roadNet.L[q.line].ow || (((x - rq.x) * -rq.hy + (y - rq.y) * rq.hx) * keepSign >= 0 ? 1 : -1);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  // the kerb near (x, y) at about height z, a few metres along the road (so a car isn't put on top of
  // you), at a spot where your car is clear of the traffic, the lamp posts and the trees
  const scrambleJ = junctions.J.filter(j => j.scramble);
  function kerbNear(x, y, z, ahead = 9, within = 250) {
    const pl0 = offScramble(roads.place(x, y, within, keepSign, z), true);
    if (!pl0) return null;
    const M = CARS_OK && vlib.info.cars.models[carCfg.model], half = M ? M.length_m / 2 : 2.2, hw = M ? M.width_m / 2 : 0.9;
    let first = null;
    const along = (pl, s0) => {
      const L = roadNet.L[pl.line].len;
      for (const d of [0, 6, -6, 12, -12, 18, -18, 24, -24]) {
        const q = Object.assign({}, pl, { s: Math.max(3, Math.min(L - 3, s0 + d * pl.dir)) });
        if (SCR_AT.length && (inScramble(q.line, q.s) || inScramble(q.line, Math.max(0, Math.min(L, q.s - 15 * q.dir))) || (q.dir > 0 ? L - q.s : q.s) < 12)) continue; // (not back by the scramble's crosswalks, nor the kerb behind it; and with road ahead to drive off along)
        const pose = kerbPose(q);
        first = first || { pl: q, pose };
        if (cars.footprint(pose.x, pose.y, pose.z, pose.h, half, hw, 0.3) > 0) continue;
        if (scrambleJ.some(j => Math.hypot(j.x - pose.x, j.y - pose.y) < 36)) continue; // (not at the mouth of a scramble, its crowd crossing every way)
        let hit = false;
        const fx = Math.sin(pose.h), fy = Math.cos(pose.h);
        posts.near(pose.x, pose.y, half + 1, p => {
          const dx = p.x - pose.x, dy = p.y - pose.y;
          if (Math.abs(dx * fx + dy * fy) < half + p.r + 0.2 && Math.abs(-dx * fy + dy * fx) < hw + p.r + 0.2) hit = true;
        }, pose.z);
        if (!hit) return { pl: q, pose };
      }
      return null;
    };
    let got = along(pl0, pl0.s + ahead * pl0.dir);
    // (by a scramble, its street too short for all that: the streets round, nearest first)
    if (!got && SCR_AT.length) for (let r = 15; r <= 75 && !got; r += 15) for (let k = 0; k < 12 && !got; k++) {
      const a = k / 12 * Math.PI * 2, q = roads.place(x + Math.sin(a) * r, y + Math.cos(a) * r, 8, keepSign, z);
      if (q && q.line !== pl0.line) got = along(q, q.s);
    }
    return got || first || { pl: pl0, pose: kerbPose(pl0) };
  }
  // where a car is on the roads, going the way it faces
  function placeOf(st) {
    const pl = roads.place(st.x, st.y, 60, keepSign, st.z);
    if (!pl) return null;
    roadNet.at(pl.line, pl.s, rq);
    pl.dir = Math.sin(st.h) * rq.hx + Math.cos(st.h) * rq.hy >= 0 ? 1 : -1;
    return pl;
  }
  let myCar = null, ride = null;
  function parkMyCar(pose) {
    if (!CARS_OK || !vlib.info.cars.models[carCfg.model]) return;
    if (!myCar) {
      const C = OECars.car(world, vlib, carCfg.model, { colours: { paint: carCfg.colour, seat: carCfg.seat }, keep: KEEP });
      myCar = { C, D: OECars.drive(C, nav, pose) };
    }
    Object.assign(myCar.D.st, { x: pose.x, y: pose.y, z: pose.z, h: pose.h, vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false, pitch: 0, roll: 0 });
    myCar.C.place(pose.x, pose.y, pose.z, pose.h); // there already behind the title
  }
  { const [cx, cy] = G.start.car || G.start.at; // (game.start.car: where it waits, when not by the start: Shibuya's start is at the scramble)
    const z = nav.floorAt(cx, cy, Math.max(0, nav.terrain(cx, cy)) + 1), k = kerbNear(cx, cy, z ? z.z : null); if (k) parkMyCar(k.pose); }
  const stOf = o => (o.D ? o.D.st : o.drv.st);
  // the ground beside a seat's door (o: your car or a ride)
  function doorAt(o, seat) {
    const C = o.C, st = stOf(o), p = C.seats[seat] || C.seats.driver, fx = Math.sin(st.h), fy = Math.cos(st.h);
    const l = Math.sign(p.x || 1) * (C.hw + 0.55), f = p.z + 0.2;
    return { x: st.x + fx * f - fy * l, y: st.y + fy * f + fx * l };
  }
  // how far (x, y) is from the side of a car
  function offCar(o, x, y) {
    const st = stOf(o), fx = Math.sin(st.h), fy = Math.cos(st.h), dx = x - st.x, dy = y - st.y;
    return Math.hypot(Math.max(0, Math.abs(dx * fx + dy * fy) - o.C.half), Math.max(0, Math.abs(-dx * fy + dy * fx) - o.C.hw));
  }
  // the cars near (x, y) as boxes (cars.js), less one (the one you are in)
  function carBoxes(x, y, r, but = null) {
    const out = [];
    for (const c of cars.C) if (c.line >= 0 && Math.abs(c.x - x) < r + c.half && Math.abs(c.y - y) < r + c.half) {
      const b = OECars.boxOf(c, c.half, c.hw || 0.9, c.top || 1.5);
      b.onHit = () => { c.v = 0; };
      out.push(b);
    }
    for (const o of [myCar, ride]) if (o && o !== but && Math.hypot(stOf(o).x - x, stOf(o).y - y) < r + 5) out.push((o.D || o.drv).box());
    return out;
  }
  // the lamp posts and trunks near (x, y), for a car to hit
  function postsNear(x, y, r) { const out = []; posts.near(x, y, r, q => out.push(q)); return out; }
  // the people near (x, y), for a car to stop for
  function peopleNear(x, y, r) {
    const out = [];
    for (const p of crowd.P) if (p.line >= 0 && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r) out.push({ x: p.x, y: p.y, z: p.z, onHit: () => { p.pause = Math.max(p.pause, 1.5); } });
    for (const n of npcs) if (Math.abs(n.x - x) < r && Math.abs(n.y - y) < r) out.push({ x: n.x, y: n.y, z: n.z });
    return out;
  }
  // into your car (walk round to the driver's door first), and out again
  function enterCar() {
    const d = doorAt(myCar, 'driver');
    player.auto = { x: d.x, y: d.y, t: 0, then: () => {
      player.mode = 'car'; player.vehicle = myCar;
      myCar.C.sit(player.rig, 'driver');
      if (headlamp) myCar.C.carry(headlamp);
      cam.mode = 'chase'; cam.dist = 7.5; cam.pitch = 0.2; cam.yaw = myCar.D.st.h;
      A.thump();
      H.toast('Your car. <kbd>W</kbd>/<kbd>S</kbd> drive, brake and reverse, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake, <kbd>H</kbd> horn, <kbd>V</kbd> view, <kbd>E</kbd> get out.');
    } };
  }
  // out of a car onto the ground beside a door, on foot again
  function stepOut(o, seat, at = null) {
    const st = stOf(o), d = !at && doorAt(o, seat), p = at || placeNear(d.x, d.y, st.z + 0.5, carBoxes(st.x, st.y, 12));
    if (!p) return false;
    o.C.body.remove(player.rig.root); world.add(player.rig.root);
    player.rig.root.scale.setScalar(1); // (a seat too low for you made you a little smaller: cars.js sit)
    player.rig.legRake = player.rig.reach = null;
    player.mode = 'foot'; player.vehicle = null; player.speed = 0; player.ground = true; player.vz = 0;
    [player.x, player.y, player.z] = p;
    player.h = st.h;
    player.rig.root.visible = true;
    if (cam.mode === 'cabin') cam.mode = 'chase';
    cam.dist = 6.5; camera.up.set(0, 1, 0);
    if (headlamp) o.C.drop(headlamp);
    A.car(0, 0, 0); A.skid(0); A.thump();
    return true;
  }
  function exitCar() {
    if (myCar.D.st.speed > 1.5) { H.toast('Stop first.'); return; }
    if (!stepOut(myCar, 'driver')) { H.toast('No room to get out here.'); return; }
    save();
  }
  function resetCar() { // back on the road, the right way up
    const k = kerbNear(myCar.D.st.x, myCar.D.st.y, myCar.D.st.z, 0);
    if (k) { parkMyCar(k.pose); H.toast('Back on the road.'); }
  }
  function bringCar() {
    if (!myCar) return;
    if (player.mode !== 'foot') { H.toast('Get out first.'); return; }
    const k = kerbNear(player.x, player.y, player.z, 10);
    if (!k) { H.toast('There is no street near enough to bring it to.'); return; }
    parkMyCar(k.pose);
    H.toast(`Your car is at the kerb, ${Math.round(Math.hypot(k.pose.x - player.x, k.pose.y - player.y))} m away.`);
    save();
  }
  let bumpCar = -9, carFov = 0;
  // your car over a stop line on red (junctions.js), with the cross road's green: a word about it
  const redRq = {};
  let redLast = -99, redAt = null, redT = 0;
  function redLight(st) {
    if ((redT += 1) % 6) return; // (five times a second is enough)
    const q = Math.abs(st.v) > 3 ? roadNet.nearest(st.x, st.y, 5, st.z, 2.5) : null;
    if (!q) { redAt = null; return; }
    roadNet.at(q.line, q.s, redRq);
    const dir = Math.sin(st.h) * redRq.hx + Math.cos(st.h) * redRq.hy > 0 ? 1 : -1, a = junctions.armAt(q.line, dir > 0 ? 1 : 0);
    const toLine = a ? (dir > 0 ? roadNet.L[q.line].len - q.s : q.s) - a.back : null;
    if (a && redAt && redAt.a === a && redAt.d > 0 && toLine <= 0 && junctions.light(a) === 'r' && a.j.st === 'g' && a.j.ph !== 2 /* (on the arrow your turn may have its green) */ && clockT - redLast > 20) {
      redLast = clockT;
      H.toast('Careful! That light was red.');
    }
    redAt = a ? { a, d: toLine } : null;
  }
  function carStep(dt, fwd, side) {
    const D = myCar.D, st = D.st, ev = [];
    D.step(dt, { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, side)), handbrake: k('Space') },
      { boxes: carBoxes(st.x, st.y, 14, myCar), people: peopleNear(st.x, st.y, 12), posts: postsNear(st.x, st.y, 10) }, ev);
    for (const e of ev) {
      if (e.speed > 2.5) A.thump();
      if (clockT - bumpCar < 2.5 || e.speed < 3) continue;
      bumpCar = clockT;
      if (e.type === 'bump') H.toast(e.what === 'person' ? 'Watch out for people!' : e.what === 'car' ? 'Careful! That was another car.' : e.what === 'lamp' ? 'Careful! That was a lamp post.' : e.what === 'tree' ? 'Careful! That was a tree.' : 'Careful! That was a wall.');
      if (e.type === 'edge') H.toast(nav.isWater(st.x + Math.sin(st.h) * 5, st.y + Math.cos(st.h) * 5) ? `That's the edge of ${G.water_name || 'the water'}.` : 'Too steep a drop.');
    }
    Object.assign(player, { x: st.x, y: st.y, z: st.z, h: st.h, speed: st.speed });
    redLight(st);
    A.car(st.rpm, Math.abs(fwd), 1);
    A.skid(Math.min(1, Math.max(0, st.slip - 2.2) / 6));
    player.rig.animate(dt, 0, 'sit', clockT);
  }
  // your car, a ride, and the people in them: where they are and what their lamps and wheels do
  function carsTick(dt) {
    const night = U.uNight.value;
    if (myCar) {
      const st = myCar.D.st, mine = player.mode === 'car';
      myCar.C.place(st.x, st.y, st.z, st.h, st.pitch, st.roll);
      myCar.C.animate(dt, { v: mine ? st.v : 0, h: st.h, steer: st.steer, brake: mine && (st.brake || (Math.abs(st.v) < 0.3 && k('KeyS'))), night, on: mine, inside: mine && cam.mode === 'cabin' });
    }
    if (ride) rideStep(dt, night);
  }

  // ------------------------------------------------------------ taxis and rides
  const FIRST = { Australia: ['Sam', 'Priya', 'Tom', 'Mei', 'Ahmed', 'Jess', 'Luca', 'Aroha'], Japan: ['Kenji', 'Yui', 'Haruto', 'Aiko', 'Takeshi', 'Emi'],
    France: ['Karim', 'Léa', 'Julien', 'Camille', 'Moussa', 'Inès'], China: ['Ka-ming', 'Wing', 'Chi-wai', 'Mei-ling', 'Siu-fung', 'Hoi-yan'] };
  const L1 = () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)], D1 = () => String(Math.floor(Math.random() * 10));
  const plate = () => ({ France: () => `${L1()}${L1()}-${D1()}${D1()}${D1()}-${L1()}${L1()}`, Japan: () => `${D1()}${D1()}-${D1()}${D1()}`,
    China: () => `${L1()}${L1()} ${D1()}${D1()}${D1()}${D1()}` }[CITY.country] || (() => `${L1()}${L1()}${L1()} ${D1()}${D1()}${L1()}`))();
  const MODEL_NAME = { Car_Sedan: 'sedan', Car_Taxi: 'taxi', Car_Hatch: 'hatchback', Car_SUV: 'SUV', Car_Van: 'van' };
  const COLOUR_NAME = [['white', '#f0f0ee'], ['black', '#1c1c1e'], ['silver', '#a9adb3'], ['grey', '#5a6470'], ['red', '#b3242b'], ['maroon', '#7a1f2b'], ['blue', '#1f4e8c'],
    ['beige', '#d8d3c8'], ['green', '#2f3b33'], ['gold', '#c9a227'], ['yellow', '#f2c21a']].map(([n, h]) => [n, new THREE.Color(h)]);
  const colourName = hex => { const c = new THREE.Color(hex); let best = '', bd = Infinity; for (const [n, q] of COLOUR_NAME) { const d = (c.r - q.r) ** 2 + (c.g - q.g) ** 2 + (c.b - q.b) ** 2; if (d < bd) { bd = d; best = n; } } return best; };
  const rideCar = o => `${colourName(o.hex)} ${MODEL_NAME[o.model] || 'car'}`;
  function driverLook() { // one of the crowd's characters (a main character has its own look, and isn't for hire)
    const names = lib ? Object.keys(lib.tpl).filter(n => !PLAYER_LOOKS[n] && lib.info.characters[n]) : [];
    return names.length ? OEPeople.randomLook(lib, names[Math.floor(Math.random() * names.length)], CR.style) : {};
  }
  // a ride coming for you drives at up to half as fast again while it is well out of sight of the
  // pick-up and of you (in the dry run that times it, of the pick-up), as games keep such cars on time
  const hurryTo = pickup => (st, dry) => {
    const d = Math.hypot(st.x - pickup.x, st.y - pickup.y), dp = dry ? d : Math.min(d, Math.hypot(st.x - player.x, st.y - player.y));
    const t = Math.max(0, Math.min(1, (dp - 130) / 90));
    return 1 + 0.5 * t * t * (3 - 2 * t);
  };
  const RIDE_T = [10, 20]; // the time a ride should take to reach you (s), leaving the rest of the half minute for the traffic in your sight
  const STUB = { half: 2.3, hw: 0.9, top: 1.5, wheelbase: 2.7 }; // a car's size, to time a trip before there is a car
  // the route from a place on the roads (from: { line, s, dir, v }) to the pick-up, and how long it takes
  // (the time with nothing in the way and no red lights, which it obeys only in your sight)
  // The traffic lights near the pick-up, which it stops at in your sight, add on average SIG_WAIT
  // each to the time: it has priority there, calling its green from far enough out that the lights
  // have changed (the other road's few seconds of green, amber, all red) and held it by the time it
  // gets there, so it seldom stops (tools/ride_check.js signals measures it); the time with them is
  // the one a ride is picked by and the app first says.
  const SIG_WAIT = 1;
  // A scramble's walk is the one turn its priority never cuts (junctions.js), and a ride keeps a
  // scramble's lights in sight or not, so a scramble near you adds more: coming up to it as the walk
  // starts, the walk and the all red round it, about half a minute. It is counted at near that, so
  // a taxi on your side of it is picked whenever there is one, and the time the app says holds.
  const SCR_WAIT = 24;
  // and the cars already queued at each signalled arm on its way (OECars.queueing), Q_CLEAR each to
  // move off ahead of it when the light turns green: a ride waits behind a queue, never round it (#107, #143)
  const Q_CLEAR = 1.8;
  const queuedAt = a => { let n = 0; for (const c of cars.C) if (c.line >= 0 && c.lineArm === a && OECars.queueing(c)) n++; return n; };
  const queueWait = (arms, s0, skip = null) => { let t = 0; for (const q of arms || []) if (q.s > s0 + 2 && q.a !== skip) t += Q_CLEAR * queuedAt(q.a); return t; };
  const rideClock = () => clockT; // the traffic's clock, which junctions.js keeps its turns by (a ride's driver asks it for its way across)
  function planRide(from, pickup) {
    const rt = roads.route({ line: from.line, s: from.s, dir: from.dir }, pickup, 4000);
    if (!rt) return null;
    const opts = { keep: keepSign, from: from.v ? 'lane' : 'kerb', v: from.v || 0, hurry: hurryTo(pickup), lights: junctions, priority: true, now: rideClock };
    const P = OECars.path(rt.pts), sig = [], scr = [], qArms = [];
    for (const nd of rt.nodes || []) {
      const p = rt.pts[nd.k], a = p ? junctions.armAt(nd.line, nd.end) : null;
      if (!a || !a.j.sig) continue;
      const s = P.cum[Math.min(nd.k, P.cum.length - 1)];
      qArms.push({ s, a });
      if (Math.hypot(p[0] - pickup.x, p[1] - pickup.y) < 140) {
        sig.push(s);
        if (a.j.scramble) scr.push(s); // (its walk: SCR_WAIT)
      }
    }
    for (const m of rt.mids || []) if (m.X.sig && Math.hypot(m.X.x - pickup.x, m.X.y - pickup.y) < 140) sig.push(m.at); // (and the crossings' lights between junctions)
    sig.sort((p, q) => p - q);
    const drive = OECars.chauffeur(STUB, rt, opts).total();
    return { rt, opts, drive, sig, scr, qArms, T: drive + SIG_WAIT * sig.length + SCR_WAIT * scr.length + queueWait(qArms, -Infinity) };
  }
  // a ride (kind 'taxi' or 'hire') from a traffic car or a place on the roads, on its planned route to the pick-up
  function newRide(kind, from, pickup, plan, dest = null) {
    const tcfg = Object.assign({}, vlib.info.cars.liveries.taxi, ((G.vehicles || {}).cars || {}).taxi);
    const model = kind === 'taxi' ? 'Car_Taxi' : OEActors.pick(['Car_Sedan', 'Car_SUV', 'Car_Sedan', 'Car_Hatch']);
    const hex = from.hex || (kind === 'taxi' ? OEActors.pick(tcfg.colours) : OEActors.pick(['#1c1c1e', '#8a9099', '#3d4146', '#e7e5df', '#1f2a3a']));
    const C = OECars.car(world, vlib, model, { colours: { paint: hex, seat: kind === 'taxi' ? '#2b2d30' : '#b9ae9c' }, keep: KEEP });
    const o = { kind, C, model, hex, name: OEActors.pick(FIRST[CITY.country] || FIRST.Australia), plate: plate(), pickup, dest, phase: 'coming',
      t0: clockT, meter: 0, talkT: 0, wait: 0, pitch: 140 + Math.floor(Math.random() * 140), rating: (4.7 + Math.random() * 0.29).toFixed(2).slice(0, 3) };
    // (never a step further into a car of the traffic where you could see it: out of sight, as nothing
    // else holds a driver up there, it would only be late)
    const opts = Object.assign({ solid: (x, y, z, h) => (inSight(x, y, z) ? cars.footprint(x, y, z, h, C.half, C.hw, 0) : 0) }, plan.opts);
    o.drv = OECars.chauffeur(C, plan.rt, opts);
    o.drv.opts = opts; // (for a new route round a jam)
    o.T0 = plan.T; o.sig = plan.sig; o.scr = plan.scr || []; o.qArms = plan.qArms; // (the lights it is to stop at near you, s along its route)
    const look = driverLook();
    o.driver = makeRig(look, {});
    C.sit(o.driver, 'driver');
    // none of the crowd's characters loaded yet (a ride in the first seconds of a game): a simple
    // figure at the wheel for now, and one of them as soon as it has loaded
    if (!look.character && lib) {
      const names = Object.keys(lib.info.characters).filter(n => !PLAYER_LOOKS[n]);
      const name = names[Math.floor(Math.random() * names.length)];
      if (name) Promise.resolve(lib.require(name)).then(() => {
        if (ride !== o || !lib.tpl[name]) return;
        const rig = makeRig(OEPeople.randomLook(lib, name, CR.style), {});
        if (o.driver.root.parent) o.driver.root.parent.remove(o.driver.root);
        o.driver = rig;
        C.sit(rig, 'driver');
      }).catch(() => {});
    }
    return o;
  }
  // one setting out from a street a couple of hundred metres off by road, chosen so it takes
  // RIDE_T to reach you and, where it can be, out of sight (behind you, or farther than you can see)
  function rideFromAround(kind, pickup, dest) {
    let best = bestFrom(pickup);
    // none can reach that kerb in time (a dead end the near side of the street faces into, a stub no
    // road feeds): the kerb across the street and the streets round it too, as a ride app moves the
    // pick-up (a few seconds' allowance for each metre further from yours)
    // (a scramble's walk on the way counts in the time the app gives, but no move of the pick-up gets round it: every way there crosses it)
    if (!best || best.plan.T - SCR_WAIT * (best.plan.scr || []).length > RIDE_T[1] + 5) {
      const alts = roadNet.L[pickup.line].ow ? [] : [Object.assign({}, pickup, { dir: -pickup.dir })];
      for (const [dx, dy] of [[25, 0], [-25, 0], [0, 25], [0, -25]]) {
        const q = roads.place(pickup.x + dx, pickup.y + dy, 30, keepSign, pickup.z);
        if (q && q.line !== pickup.line && !alts.some(a => a.line === q.line) && !(SCR_AT.length && inScramble(q.line, q.s))) alts.push(q);
      }
      for (const q of alts) {
        const b = bestFrom(q), walk = Math.hypot(q.x - pickup.x, q.y - pickup.y) / 3;
        if (b && (!best || b.plan.T + walk < best.plan.T)) best = b;
      }
    }
    // (and a slow one rather than none, the app saying so)
    return best && best.plan.T < 120 ? newRide(kind, best.pl, best.pickup, best.plan, dest) : null;
  }
  function bestFrom(pickup) {
    const fx = Math.sin(cam.yaw), fy = Math.cos(cam.yaw); // the way the camera looks, on the map
    // streets 110 to 270 m from the pick-up by road (the network searched backwards from it), each timed
    const cand = roads.behind(pickup, 110, 270, 36);
    for (let k = 0; cand.length < 6 && k < 12; k++) { const pl = roads.around(pickup.x, pickup.y, 120, 280); if (pl) cand.push(pl); } // (a pick-up the search can't leave)
    let best = null;
    // (not where it would pull out into a car of the traffic, or a queue: one at a crawl or stopped close by)
    const busy = pl => cars.C.some(c => c.line >= 0 && Math.abs(c.z - (pl.z ?? c.z)) < 3 && Math.hypot(c.x - pl.x, c.y - pl.y) < (c.v < 3 ? 25 : 12));
    let any = false;
    const pick = list => {
      for (const pl of list) {
        if (!any && busy(pl)) continue;
        const plan = planRide(pl, pickup);
        if (!plan) continue;
        const dx = pl.x - player.x, dy = pl.y - player.y, d = Math.hypot(dx, dy);
        const hidden = d > 240 || (dx * fx + dy * fy) / Math.max(1, d) < 0.3;
        const score = (plan.T < RIDE_T[0] ? RIDE_T[0] - plan.T : plan.T > RIDE_T[1] ? 4 * (plan.T - RIDE_T[1]) : 0) + (hidden ? 0 : 5) + Math.random();
        if (!best || score < best.score) best = { pl, plan, score, pickup };
      }
    };
    pick(cand);
    // none of those near enough in time (one-way streets, a slow way round): nearer ones too, 40 to 110 m off
    if (!best || best.plan.T > RIDE_T[1]) pick(roads.behind(pickup, 40, 110, 24));
    // and in streets as slow as Shibuya's, just round the corner, 15 to 40 m off (out of sight where it can be)
    if (!best || best.plan.T > RIDE_T[1] + 5) pick(roads.behind(pickup, 15, 40, 16));
    if (!best) { any = true; pick(cand); } // (all of them in the traffic: one of those rather than none)
    return best;
  }
  // the time to the pick-up (or, on the way, to where you're going), as the app shows it
  // (held up behind the traffic, it rises as it waits, as an app's does, rather than standing still)
  // Stopped at a red light, or queued behind a car that is, it is the time to that light's green
  // (junctions.toGreen: the signals know their change) with a couple of seconds for the queue to move
  // off, in place of the average for that light; held up behind cars otherwise, the time it has waited.
  function rideWait(st) {
    if (st.v > 1) return null;
    let b = st.block, n = 0; // (the queue ahead, car by car, to the one at the line)
    while (b && b.line != null && b.why === 'car' && b.front && b.v < 1 && n < 8) { b = b.front; n++; }
    const a = /^the line/.test(st.why || '') ? st.lineAt : b && b.line != null && b.why === 'light' ? b.lineArm : null;
    if (a && a.j.sig) return { light: true, a, t: junctions.toGreen(a) + (a === st.lineAt ? 0 : 1.5 * (n + 1)) };
    // (behind a car stuck where it is, at a wall or stopped for good: the driver swings out round it
    // once it has waited 6 s, cars.js gapAhead)
    const stuck = st.block && st.block.line != null && st.block.v < 0.1 && (st.block.why === 'wall' || st.block.still > 2);
    return { light: false, t: stuck ? Math.max(1, 7 - (st.held || 0)) : Math.max(0, (st.held || 0) - 2) };
  }
  const eta = o => {
    if (o.phase !== 'coming') return o.phase === 'driving' ? o.drv.timeLeft() : 0;
    const st = o.drv.st, w = rideWait(st), lights = (o.sig || []).filter(s => s > st.s + 2).length - (w && w.light ? 1 : 0);
    const scr = (o.scr || []).filter(s => s > st.s + 2).length - (w && w.light && st.lineAt && st.lineAt.j.scramble ? 1 : 0); // (the scrambles still ahead: their walk, as it comes)
    return o.drv.timeLeft() + SIG_WAIT * Math.max(0, lights) + SCR_WAIT * Math.max(0, scr) + (w ? w.t : 0) + queueWait(o.qArms, st.s, w && w.a); // (the queue it is in already counted by rideWait)
  };
  // Y at the kerb: a hand up, and the nearest free taxi coming your way pulls in
  function hail() {
    if (player.mode !== 'foot' || player.auto) return;
    if (!CARS_OK) { H.toast('There are no taxis to hail here.'); return; }
    if (ride && ride.phase !== 'leaving') { H.toast(ride.phase === 'coming' ? `${ride.name} is on the way.` : `${ride.name} is waiting for you.`); return; }
    const pickup = pickupNear(player.x, player.y, player.z, 40);
    if (!pickup) { H.toast('Stand at the kerb of a street to hail a taxi.'); return; }
    if (player.rig.wave) player.rig.wave(clockT);
    let best = null;
    for (const c of cars.C) {
      if (!c.taxi || c.line < 0) continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d > 300 || d < 12) continue;
      const from = { line: c.line, s: c.s, dir: c.dir, v: Math.max(1, c.v), hex: c.hex }, plan = planRide(from, pickup);
      // (one stopped at a red light waits for its green first: a scramble's walk can be half a minute)
      if (plan && c.v < 1 && c.lineArm && c.toLine < 12 && junctions.light(c.lineArm, c.lineEx) === 'r') plan.T += junctions.toGreen(c.lineArm);
      if (plan && plan.T <= RIDE_T[1] && (!best || plan.T < best.plan.T)) best = { c, from, plan };
    }
    let o = null;
    if (best) {
      const c = best.c;
      o = newRide('taxi', best.from, pickup, best.plan);
      cars.take(c); Object.assign(o.drv.st, { x: c.x, y: c.y, z: c.z, h: c.h });
    }
    if (!o) o = rideFromAround('taxi', pickup, null);
    if (!o) { H.toast('No taxis about. Try a busier street, or order a ride on your phone (N).'); return; }
    if (ride) { ride.drv.leave(); ride.C.dispose(); } // the last one, still driving off
    ride = o;
    A.honk();
    H.toast(best ? `A taxi has seen you: it'll pull in in about ${fmtSec(eta(o))}.` : `A taxi is coming round the corner, about ${fmtSec(eta(o))} away.`);
  }
  // the phone: a private-hire car to where you say
  function orderRide(dest) {
    if (player.mode !== 'foot') { H.toast('Order once you are on foot.'); return; }
    if (ride && ride.phase !== 'leaving') { H.toast(`${ride.name} is already on the way.`); return; }
    const pickup = pickupNear(player.x, player.y, player.z, 120);
    if (!pickup) { H.toast('There is no street near enough to be picked up from.'); return; }
    const o = rideFromAround('hire', pickup, dest);
    if (!o) { H.toast('No drivers near you. Try again in a moment.'); return; }
    if (ride) { ride.drv.leave(); ride.C.dispose(); } // the last one, still driving off
    ride = o;
    const walk = Math.hypot(o.pickup.x - player.x, o.pickup.y - player.y); // (the pick-up it was given, which may be across the street or round the corner)
    H.toast(`<b>${o.name}</b> is on the way in a ${rideCar(o)}, ${o.plate}: about ${fmtSec(eta(o))}.${walk > 25 ? ` Meet at the pick-up point, ${Math.round(walk)} m from you.` : ''}`);
  }
  function cancelRide() {
    if (!ride || player.mode === 'ride') return;
    H.toast(`Ride with ${ride.name} cancelled.`);
    rideAway();
  }
  function boardRide() {
    const o = ride, d = doorAt(o, kerbSeat);
    o.phase = 'boarding';
    player.auto = { x: d.x, y: d.y, t: 0, then: () => {
      if (ride !== o) return;
      player.mode = 'ride'; player.vehicle = o;
      o.C.sit(player.rig, kerbSeat);
      if (headlamp) o.C.carry(headlamp);
      cam.mode = 'chase'; cam.dist = 8; cam.pitch = 0.24; cam.yaw = o.drv.st.h;
      A.thump();
      if (o.dest) setOff(o.dest); else askWhereTo();
    }, cancel: () => { if (ride === o && o.phase === 'boarding') o.phase = 'waiting'; } }; // walked off: it waits on
  }
  // where you might go: the waypoint, the survey, your car, the landmarks, the wharves (each
  // somewhere whose nearest street is a drive away, not round the corner)
  const groundZ = (x, y) => { const f = nav.floorAt(x, y, Math.max(0, nav.terrain(x, y)) + 1); return f ? f.z : null; };
  function destinations(x, y) {
    const out = [], seen = new Set();
    const add = (id, name, at, note) => {
      if (!at || seen.has(id) || Math.hypot(at[0] - x, at[1] - y) < 150) return;
      const pl = roads.place(at[0], at[1], 300, keepSign, groundZ(at[0], at[1]));
      if (!pl || Math.hypot(pl.x - x, pl.y - y) < 180) return;
      seen.add(id); out.push({ id, name, at: [at[0], at[1]], note });
    };
    if (waypoint) add('waypoint', 'Your waypoint', waypoint, 'set on the map');
    const ob = objective();
    if (ob && ob.at) add('objective', ob.title || 'Your walk', ob.at, 'your walk');
    if (myCar && player.vehicle !== myCar) add('car', 'Your car', [myCar.D.st.x, myCar.D.st.y], 'where you left it');
    const marks = Object.entries(scene.labels || {}).map(([n, p]) => ({ n, p, d: Math.hypot(p[0] - x, p[1] - y) })).filter(m => m.d > 300).sort((a, b) => a.d - b.d);
    for (const m of marks.slice(0, 4)) add(`lm-${m.n}`, m.n, m.p, `${(m.d / 1000).toFixed(1)} km`);
    for (const t of G.travel || []) add(t.id, t.name, t.at, '');
    for (const w of G.wharves) add(w.id, w.name, w.terminal, 'ferry wharf');
    add('start', 'Where you started', G.start.at, '');
    return out.slice(0, 7);
  }
  function askWhereTo() {
    const o = ride;
    o.phase = 'asking';
    const list = destinations(o.drv.st.x, o.drv.st.y);
    dlg.show({ name: o.name, role: o.kind === 'taxi' ? 'Taxi driver' : 'Your driver', color: '#e0a21a', pitch: o.pitch }, [`${G.greeting ? `${G.greeting} ` : ''}Where to?`],
      list.map(d => ({ text: `${d.name}${d.note ? ` <span class="note">· ${d.note}</span>` : ''}`, dest: d })).concat([{ text: 'Nowhere, thanks. I\'ll get out here.', dest: null }]),
      c => { if (ride !== o) return; if (c && c.dest) setOff(c.dest); else { o.phase = 'driving'; leaveRide(); } });
  }
  function setOff(dest) {
    const o = ride, from = placeOf(o.drv.st) || o.drv.st.route.to;
    let to = roads.place(dest.at[0], dest.at[1], 300, keepSign, groundZ(dest.at[0], dest.at[1])) || roads.place(dest.at[0], dest.at[1], 300, keepSign), rt = to && roads.route(from, to, 30000);
    if (!rt && to) rt = roads.route(from, to = Object.assign({}, to, { dir: -to.dir }), 30000);
    if (!rt) { H.toast(`<b>${o.name}:</b> I can't get there by road, sorry.`); o.phase = 'driving'; if (player.mode === 'ride') leaveRide(); return; }
    Object.assign(o, { dest, phase: 'driving', meter: 0, talkT: clockT + 9, t0: clockT });
    o.drv.leave();
    o.drv = OECars.chauffeur(o.C, rt, { keep: keepSign, from: 'kerb', lights: junctions, now: rideClock });
    H.toast(`<b>${o.name}:</b> ${dest.name}, ${(rt.len / 1000).toFixed(1)} km by road. <kbd>F</kbd> to skip the trip.`);
  }
  // the car you are in, or have just got out of, pulls away and drives off
  function rideAway() {
    const o = ride;
    o.phase = 'leaving'; o.t0 = clockT;
    const pl = placeOf(o.drv.st), pts = pl ? roads.onward({ to: pl }, 260) : [];
    if (pts.length > 1) { o.drv.leave(); o.drv = OECars.chauffeur(o.C, { pts, end: false, nodes: pts.nodes, mids: pts.mids }, { keep: keepSign, from: o.drv.st.v > 1 ? 'lane' : 'kerb', v: o.drv.st.v, lights: junctions, now: rideClock }); }
  }
  function leaveRide() {
    const o = ride;
    if (!o) return;
    if (player.mode === 'ride') {
      if (o.drv.st.v > 0.5) { H.toast('Wait until the car stops.'); return; }
      if (!stepOut(o, kerbSeat)) { H.toast('No room to get out here.'); return; }
      if (o.phase === 'arrived') H.toast(`<b>${o.name}:</b> ${OEActors.pick(['Enjoy!', 'Have a good one.', 'Take care.', 'Thanks!'])}`);
      save();
    }
    rideAway();
  }
  function skipRide() {
    const o = ride;
    if (!o || o.phase !== 'driving' || cine.active) return;
    const end = {}, P = o.drv.path;
    P.at(o.drv.st.end, end);
    o.meter += o.drv.remaining();
    hopTo(end.x, end.y, end.z, o.dest.name, { cue: () => o.drv.finish(), quiet: true });
  }
  // what a ride's driver looks out for (cars.js chauffeur): the traffic, your car, you on foot
  // (one stopped for good, your car left in the lane or a car stuck in a jam, is driven round).
  // Out of your sight (inSight) nothing holds a driver up, as games keep the cars that come for you on time.
  function inTheWay(o) {
    const st = o.drv.st, out = [];
    // a scramble's crowd, out across its road on the walk (actors.js plazas), in sight or not: one that
    // drove through them would be seen there by those who come after (and is caught by tools/clip_check.js)
    if (crowd.plazas) for (let i = 0; i < crowd.active; i++) { const p = crowd.P[i]; if (p.pz && Math.abs(p.x - st.x) < 40 && Math.abs(p.y - st.y) < 40 && (p.ph === 'cross' || p.pz.road(p.x, p.y))) out.push({ x: p.x, y: p.y, half: 0.3, hw: 0.3, v: Math.max(0.2, p.v), walker: true }); } // (out on the road, never one to drive round: it waits for them; not those waiting on the pavement)
    if (!inSight(st.x, st.y, st.z)) return out;
    // a ride running late for you goes round a car holding it up instead of queueing behind it
    const late = o.phase === 'coming' && clockT - o.t0 > (o.T0 || 20) + 3;
    for (const c of cars.C) if (c.line >= 0 && Math.abs(c.x - st.x) < 60 && Math.abs(c.y - st.y) < 60) out.push(!OECars.queueing(c) && (c.stuck > 4 || (late && c.v < 2)) ? { x: c.x, y: c.y, half: c.half, hw: c.hw, still: true, stay: c.stuck > 10, line: c.line, v: c.v } : c);
    if (myCar) { const parked = player.mode !== 'car' && myCar.D.st.speed < 0.3; out.push({ x: myCar.D.st.x, y: myCar.D.st.y, half: myCar.C.half, hw: myCar.C.hw, still: parked, stay: parked }); }
    if (player.mode === 'foot' && o.phase !== 'coming') out.push(player);
    return out;
  }
  // in your sight: within 40 m of you, or on screen within 120 m
  function inSight(x, y, z) { const d = Math.hypot(x - player.x, y - player.y); return d < 40 || (d < 120 && inView(x, y, z)); }
  // whether a point is in the camera's view (not whether something hides it)
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4();
  function inView(x, y, z) {
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    return frustum.containsPoint(W(x, y, z + 1));
  }
  function rideStep(dt, night) {
    const o = ride;
    let st = o.drv.st;
    o.drv.update(dt, inTheWay(o), false, inSight(st.x, st.y, st.z) || SCR_BOX.some(j => Math.hypot(st.x - j.x, st.y - j.y) < j.r + 60)); // (and the lights, in sight, and a scramble's always: out of sight or not, nobody drives into its walk)
    // running well late in a jam and out of view, it finds its way round, a stretch at a time, to a
    // clear piece of road (games keep the cars that come for you on time); in view it queues as it would
    if (o.phase === 'coming' && clockT - o.t0 > (o.T0 || 20) + 6 && st.v < 0.5 && clockT - (o.hopT || 0) > 2.5 && !inView(st.x, st.y, st.z)) {
      o.hopT = clockT;
      const P = o.drv.path, at = {};
      for (let s = Math.min(st.end - 0.5, st.s + 22); s > st.s + 6; s -= 4) {
        P.at(s, at);
        if (!inView(at.x, at.y, at.z) && !cars.C.some(c => c.line >= 0 && Math.hypot(c.x - at.x, c.y - at.y) < (c.half || 2.4) + 3.5)) { o.drv.jump(s); break; }
      }
    }
    // held up more than 10 s behind a queue in view (one it can't pass for the traffic coming the
    // other way), it looks for another way from where it stands, round the piece of road the queue
    // is on, and takes it if it is no more than 300 m longer, as a driver with a map app does
    if (o.phase === 'coming' && st.held > 10 && st.block && st.block.line >= 0 && clockT - (o.rerouteT || 0) > 10) {
      o.rerouteT = clockT;
      const pl = placeOf(st), rt = pl && roads.route(pl, o.pickup, 4000, undefined, new Set([st.block.line]));
      if (rt && rt.len < st.end - st.s + 300 && !(rt.nodes || []).some(nd => nd.line === st.block.line) && pl.line !== st.block.line) {
        const opts = Object.assign({}, o.drv.opts, { from: 'lane', v: st.v });
        o.drv.leave();
        o.drv = OECars.chauffeur(o.C, rt, opts);
        o.drv.opts = opts;
        st = o.drv.st;
        o.sig = []; o.scr = []; o.qArms = []; o.rerouted = (o.rerouted || 0) + 1; // (the lights it was to stop at were on the old way)
      }
    }
    o.C.place(st.x, st.y, st.z, st.h, st.pitch, 0);
    o.C.animate(dt, { v: st.v, h: st.h, steer: st.steer, brake: st.brake, signal: st.signal, hazard: o.phase === 'waiting' || o.phase === 'arrived', night, on: true,
      inside: player.vehicle === o && cam.mode === 'cabin', near: st.gap,
      sign: o.kind === 'taxi' && (o.phase === 'coming' || o.phase === 'leaving') });
    o.driver.animate(dt, 0, 'sit', clockT);
    if (o.phase === 'driving') o.meter += st.v * dt;
    if (o.phase === 'coming' && st.done) {
      o.phase = 'waiting'; o.wait = 0; o.tArrived = clockT - o.t0;
      const far = Math.hypot(st.x - player.x, st.y - player.y);
      H.toast(`<b>${o.name}</b> has pulled in${o.kind === 'hire' ? ` in the ${rideCar(o)}, ${o.plate}` : ''}${far > 25 ? `, ${Math.round(far)} m from you` : ''}. <kbd>E</kbd> to get in.`);
      A.honk();
    }
    if (o.phase === 'waiting') {
      // a driver waits five minutes, as the apps' drivers do; one you have walked well away from, one
      o.wait += dt;
      if (o.wait > (Math.hypot(st.x - player.x, st.y - player.y) > 350 ? 60 : 300) && player.mode === 'foot' && !player.auto) { H.toast(`${o.name} couldn't wait any longer.`); rideAway(); }
    }
    if (player.mode === 'ride' && player.vehicle === o) {
      Object.assign(player, { x: st.x, y: st.y, z: st.z, h: st.h, speed: st.v });
      if (o.phase === 'driving' && clockT > o.talkT) { o.talkT = clockT + 24 + Math.random() * 18; H.toast(`<b>${o.name}:</b> ${smalltalk(st.x, st.y)}`); }
      if (o.phase === 'driving' && st.done) {
        o.phase = 'arrived';
        H.toast(`<b>${o.name}:</b> Here we are: ${o.dest.name}. That's ${(o.meter / 1000).toFixed(1)} km. <kbd>E</kbd> to get out.`);
        A.chime();
      }
      A.car(0.22 + Math.min(1, st.v / 22) * 0.45, st.brake ? 0 : 0.3, 0.35);
      player.rig.animate(dt, 0, 'sit', clockT);
    }
    if (o.phase === 'leaving' && (clockT - o.t0 > 45 || Math.hypot(st.x - player.x, st.y - player.y) > 240 || st.done)) { o.drv.leave(); o.C.dispose(); ride = null; }
  }
  // the hail hint at the kerb (Y), beside whatever E does
  function kerbAction() {
    if (player.mode !== 'foot' || player.auto || !CARS_OK || (ride && ride.phase !== 'leaving') || player.speed > 1.8) return null;
    return roadNet.nearest(player.x, player.y, 11, player.z, 2.5) ? { key: 'Y', text: 'Hail a taxi', act: hail } : null;
  }

  // ------------------------------------------------------------ the phone (N): order a ride, bring your car
  const phone = { el: $('#g-phone'), body: $('#gph-body'), map: $('#gph-map'), view: 'home', acts: [], at: 0, fresh: true };
  const rideOn = () => ride && ride.phase !== 'leaving';
  function phoneShow(view) {
    if (view === false) { phone.el.hidden = true; return; }
    phone.view = view || (rideOn() ? 'ride' : 'home');
    phone.el.hidden = false;
    phone.fresh = true;
    phoneRender();
  }
  // the ride on the phone's map: the route still to drive (to the pick-up, or on the way to where
  // you're going), the car, the pick-up, you, and where you're going
  function rideMapFrame() {
    const o = ride, st = o.drv.st, P = o.drv.path, i = P.pos(st.s, {}).i;
    const inside = player.mode === 'ride' && player.vehicle === o, toGo = o.phase === 'coming' || o.phase === 'driving';
    const route = toGo ? [[st.x, st.y]].concat(P.pts.slice(i + 1)) : null;
    const dest = o.dest ? { x: o.dest.at[0], y: o.dest.at[1] } : null;
    if (!phone.draw) phone.draw = H.rideMap(phone.map, base); // (the base map is drawn further down)
    phone.draw({ route, car: { x: st.x, y: st.y, h: st.h }, pickup: inside || o.phase === 'arrived' ? null : o.pickup,
      you: inside ? null : { x: player.x, y: player.y, h: player.h }, dest: inside || o.phase === 'arrived' ? dest : null, reset: phone.fresh });
    phone.fresh = false;
  }
  function phoneRender() {
    const acts = [], item = (text, note, act) => { acts.push(act); return `<button data-k="${acts.length - 1}"><kbd>${acts.length}</kbd><span><b>${text}</b>${note ? `<span class="note">${note}</span>` : ''}</span></button>`; };
    let html = '';
    phone.map.hidden = !(phone.view === 'ride' && rideOn());
    if (phone.view === 'home') {
      $('#gph-title').textContent = 'Phone';
      html = `<div class="list">${item('Order a ride', rideOn() ? `${ride.name} is ${ride.phase === 'coming' ? 'on the way' : ride.phase === 'waiting' ? 'waiting for you' : 'taking you'}` : 'A car to wherever you say, here in half a minute', () => phoneShow(rideOn() ? 'ride' : 'where'))}`
        + `${myCar ? item('Bring my car', `It's ${Math.round(Math.hypot(myCar.D.st.x - player.x, myCar.D.st.y - player.y))} m away`, () => { bringCar(); phoneShow(false); }) : ''}</div>`
        + `<p class="note">Or raise your hand at the kerb (<kbd>Y</kbd>) and a taxi will pull in.</p>`;
    } else if (phone.view === 'where') {
      $('#gph-title').textContent = 'Ride · where to?';
      const list = destinations(player.x, player.y);
      html = `<div class="list">${list.map(d => item(d.name, d.note, () => { orderRide(d); phoneShow(ride ? 'ride' : false); })).join('')}</div>`
        + `<div class="row"><button class="btn" data-back>Back</button></div>`;
    } else {
      const o = rideOn() ? ride : null;
      $('#gph-title').textContent = o ? (o.kind === 'taxi' ? 'Taxi' : 'Your ride') : 'Ride';
      if (o) {
        const st = o.drv.st, t = eta(o), walk = Math.hypot(o.pickup.x - player.x, o.pickup.y - player.y), near = Math.hypot(st.x - player.x, st.y - player.y);
        const inside = player.mode === 'ride' && player.vehicle === o;
        let big, line, k;
        if (o.phase === 'coming') { big = t < 4 ? 'Now' : fmtSec(Math.ceil(t)); line = t < 4 ? `${o.name} is arriving` : `${o.name} is on the way`; k = 1 - t / Math.max(1, o.T0); }
        else if (o.phase === 'waiting' || o.phase === 'boarding') { big = near < 12 ? 'Here' : 'Arrived'; line = near < 12 ? `${o.name} is beside you` : `${o.name} is waiting at the pick-up, ${Math.round(near)} m away`; k = 1; }
        else if (o.phase === 'asking') { big = '–'; line = 'Tell the driver where to'; k = 0; }
        else if (o.phase === 'driving') { big = fmtSec(Math.ceil(t)); line = `to ${o.dest.name} · ${(o.drv.remaining() / 1000).toFixed(1)} km`; k = st.s / Math.max(1, o.drv.path.len); }
        else { big = 'Arrived'; line = o.dest ? o.dest.name : ''; k = 1; }
        const stop = o.phase === 'coming' || o.phase === 'waiting' || o.phase === 'boarding'
          ? `<span class="pk"></span><span>Pick-up${walk > 20 && !inside ? ` · ${Math.round(walk)} m walk` : ''}</span>` : '';
        const to = o.dest ? `<span class="ds"></span><span>${o.dest.name}</span>` : o.kind === 'taxi' && !inside ? '<span class="ds"></span><span>Tell the driver when you get in</span>' : '';
        html = `<div class="gph-eta"><b class="num">${big}</b><span>${line}</span></div>`
          + `<div class="gph-bar" style="--k:${Math.max(0.02, Math.min(1, k)).toFixed(3)}"><i></i></div>`
          + `<div class="gph-driver"><span class="av" style="--c:${o.hex}">${o.name[0]}</span><span class="who"><b>${o.name} <span class="rt">★ ${o.rating}</span></b><span class="note">${rideCar(o)[0].toUpperCase()}${rideCar(o).slice(1)}</span></span><span class="gph-plate mono">${o.plate}</span></div>`
          + (stop || to ? `<div class="gph-trip">${stop}${to}</div>` : '')
          + `<div class="list">${player.mode === 'foot' && o.phase !== 'boarding' ? item('Cancel the ride', '', () => { cancelRide(); phoneShow('home'); }) : ''}</div>`;
      } else html = '<p class="note">No ride booked.</p>';
      html += `<div class="row"><button class="btn" data-back>Back</button></div>`;
    }
    phone.acts = acts;
    phone.body.innerHTML = html;
  }
  on($('#gph-body'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-back')) phoneShow('home');
    else if (phone.acts[+b.dataset.k]) phone.acts[+b.dataset.k]();
  });
  on($('#gph-close'), 'click', () => phoneShow(false));
  on($('#g-phone-btn'), 'click', () => phoneShow(phone.el.hidden ? undefined : false));

  // ------------------------------------------------------------ trig stations: survey points with a view
  // Hilltops, a headland and the bridge deck (game.json "viewpoints"). Each has a concrete
  // trig pillar; surveying it turns the camera once round you and names what is in sight.
  const pillarGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.25, 4, 1).rotateY(Math.PI / 4).translate(0, 0.625, 0);
  const pillarMat = new THREE.MeshStandardMaterial({ color: lin('#e9e6dc'), roughness: 0.85 });
  const plateMat = new THREE.MeshStandardMaterial({ color: lin('#b08a3a'), roughness: 0.4, metalness: 0.6 });
  const VP = (G.viewpoints || []).map(v => {
    let f = nav.floorAt(v.at[0], v.at[1], v.z_ref ?? 400);
    if (f && f.kind === 'deck' && v.z_ref == null) f = nav.floorAt(v.at[0], v.at[1], Math.max(0, nav.terrain(v.at[0], v.at[1])) + 1); // not up on a viaduct
    const o = Object.assign({}, v, { x: v.at[0], y: v.at[1], z: f ? f.z : Math.max(0, nav.terrain(v.at[0], v.at[1])) });
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(pillarGeo, pillarMat), plate = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12).translate(0, 1.27, 0), plateMat);
    pillar.castShadow = pillar.receiveShadow = true;
    g.add(pillar, plate);
    g.position.copy(W(o.x + 1.6, o.y, o.z)); // beside the spot you stand on
    world.add(g);
    return o;
  });
  const trigDone = () => qs.trig || (qs.trig = {});

  // ------------------------------------------------------------ wildlife: little penguins on their colony's rocks (penguins.js)
  const colonies = (G.wildlife || []).map(c => OEPenguins.create(world, c, A, nav.terrain)).filter(Boolean);
  // and silver gulls round a dropped box of chips by the water (gulls.js), marked on the map
  const flocks = (G.flocks || []).map(f => OEGulls.create(world, f, A, nav));
  let dayLim = null; // sunrise and sunset for the game's date, worked out once a day
  const dayLimits = () => { const k = `${clock.y}-${clock.m}-${clock.d}`; if (!dayLim || dayLim.k !== k) dayLim = Object.assign({ k }, S.dayLimits(clock.y, clock.m, clock.d)); return dayLim; };
  let viewingNoted = false;

  // ------------------------------------------------------------ objective marker and GPS route in the world
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 90, 12, 1, true).translate(0, 45, 0),
    new THREE.MeshBasicMaterial({ color: lin('#ffc23d'), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.visible = false;
  world.add(beam);
  const gold = OERoute.line(world, lin('#f2bd52')); // the route: on the ground, or in the air when flying
  // The route line in the world: always on, only when asked (L, or Show route in the quest card), or
  // off. The minimap keeps its route whichever: the quiet reference. Remembered in this browser.
  const ROUTE_KEY = 'oe-route-line', ROUTE_MODES = { on: 'On', ask: 'Only when I ask', off: 'Off' };
  let routeMode = 'on', routePeek = -1; // (clockT until which a line asked for stays up)
  try { const v = localStorage.getItem(ROUTE_KEY); if (ROUTE_MODES[v]) routeMode = v; } catch (e) { /* storage blocked */ }
  function setRouteMode(m) {
    if (!ROUTE_MODES[m]) return;
    routeMode = m; routePeek = -1;
    try { localStorage.setItem(ROUTE_KEY, m); } catch (e) { /* storage blocked */ }
    $$('#gm-route button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.r === m)));
  }
  const ROUTE_PEEK = 8; // seconds a line asked for stays up
  function peekRoute() {
    if (!guide.pts) { H.toast(waypoint || objective() ? 'No route from here.' : 'No objective to lead you to. Set a waypoint on the map (<kbd>M</kbd>).'); return; }
    routePeek = clockT + ROUTE_PEEK;
  }
  // whether the line is up, and its fade toward that: hidden in a conversation, a menu, a map, photo
  // mode or a cinematic shot, and in the last few metres to the objective
  function routeShow(dt, titled) {
    const want = (routeMode === 'on' || clockT < routePeek) && !!guide.pts && !titled && !photo.on && !dlg.open && !uiOpen() && !cine.active && gold.left > 6;
    gold.fade(want ? 1 : 0, dt);
    gold.night(U.uNight.value);
    const b = $('#gq-route');
    if (b) b.hidden = routeMode === 'on' || !guide.pts || clockT < routePeek || titled;
  }

  // ------------------------------------------------------------ text from the model
  const areaShare = (() => {
    const a = {};
    let tot = 0;
    for (const s of B.s) { const r = s[4]; let q = 0; for (let k = 0, n = r.length / 2; k < n; k++) { const j = (k + 1) % n; q += r[2 * k] * r[2 * j + 1] - r[2 * j] * r[2 * k + 1]; } q = Math.abs(q) / 200; const src = B.b[s[0]][4]; a[src] = (a[src] || 0) + q; tot += q; }
    for (const k in a) a[k] = Math.round(1000 * a[k] / tot) / 10;
    return a;
  })();
  const placeByName = n => P.places.find(p => p.name === n);
  const inPlace = (pl, x, y) => {
    if (!pl) return false;
    for (const poly of pl.polygons) {
      let inside = false;
      for (const ring of poly) for (let k = 0, n = ring.length / 2, j = n - 1; k < n; j = k++) {
        const xi = ring[2 * k] / 10, yi = ring[2 * k + 1] / 10, xj = ring[2 * j] / 10, yj = ring[2 * j + 1] / 10;
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  const centroid = pl => { let x = 0, y = 0, n = 0; for (const poly of pl.polygons) for (let k = 0; k < poly[0].length; k += 2) { x += poly[0][k] / 10; y += poly[0][k + 1] / 10; n++; } return [x / n, y / n]; };
  const sunLine = () => {
    if (!sun || sun.altitude <= 0) { const L = S.dayLimits(clock.y, clock.m, clock.d); return `The sun is down; it rises at ${fmtMin(L.sunrise)}.`; }
    return `The sun is ${sun.altitude.toFixed(0)}° up, so you cast a shadow ${(1.75 / Math.tan(sun.altitude * RAD)).toFixed(1)} m long.`;
  };
  const acc = scene.accuracy && scene.accuracy.summary;
  function fill(text) {
    return (text || '').replace(/\{([a-z_]+)(?::([^}]+))?\}/g, (all, kind, arg) => {
      if (kind === 'buildings') return B.b.length.toLocaleString();
      if (kind === 'time') return `${fmtMin(clock.min)} ${S.utcToLocal(S.localToUtc(clock.y, clock.m, clock.d, clock.min)).zone}`;
      if (kind === 'sun_line') return sunLine();
      if (kind === 'sunset') return fmtMin(dayLimits().sunset);
      // the part of the day and the season, in the guide's words ("this evening", "autumn"), for lines about what to see now
      if (kind === 'now') return !sun || sun.altitude < -6 ? 'tonight' : clock.min < 720 ? 'this morning' : sun.altitude < 12 && clock.min > 900 ? 'this evening' : 'this afternoon';
      if (kind === 'season') return ['winter', 'spring', 'summer', 'autumn'][(Math.floor((clock.m % 12) / 3) + (scene.frame.lat0 < 0 ? 2 : 0)) % 4];
      if (kind === 'penguins_from' || kind === 'penguins_to') { // when the first and the last rafts come in tonight
        const c = colonies[0] && colonies[0].colony;
        return c ? fmtMin(dayLimits().sunset + c.ashore_after_sunset_min[kind === 'penguins_from' ? 0 : 1]) : '–';
      }
      if (kind === 'share') return String(areaShare[arg] || 0);
      if (kind === 'acc') return acc && acc[arg] != null ? String(acc[arg]) : '–';
      if (kind === 'lidar') { const v = (arg.includes('.') ? arg : `survey.${arg}`).split('.').reduce((o, k) => (o == null ? o : o[k]), scene.lidar_check); return v == null ? '–' : String(v); }
      if (kind === 'landmark') { const v = arg.split('.').reduce((o, k) => (o == null ? o : o[k]), scene.landmarks); return typeof v === 'number' ? String(Math.round(v * 10) / 10) : String(v ?? '–'); }
      if (kind === 'sun') {
        const [name, md, hhmm] = arg.split('|'), pl = placeByName(name), [m, d] = md.split('-').map(Number);
        if (!pl) return '–';
        const smp = sampleCache[name] || (sampleCache[name] = S.samplePlace(DSM, pl.polygons, pl.area_m2 > 60000 ? 5 : 3));
        return String(Math.round(100 * S.fractionSunlit(DSM, smp, S.position(S.localToUtc(clock.y, m, d, S.hm(hhmm))))));
      }
      return all;
    });
  }
  const sampleCache = {};
  // a line as the player reads it: tokens filled, and on a touch screen without the keyboard's keys (the
  // walking and flying keys are the stick and the buttons there, and Q and G are the Lens and Guess buttons)
  function said(text) {
    const t = fill(text);
    if (!touch || !t) return t;
    return t.replace(/ ?\((?:a hand up at the kerb, )?Y\)/g, m => (m.includes('kerb') ? ' (a hand up at the kerb)' : ''))
      .replace(/\bpress Q\b/g, 'tap Lens').replace(/\bpress G\b/g, 'tap Guess').replace(/\(Q\)/g, '(Lens)')
      .split(/(?<=[.!?。])\s+/).filter(s => !/^(WASD|Space to climb|V (switches|is)|[A-Z] and [A-Z] )/.test(s)).join(' ').trim();
  }
  const SRC_TEXT = { mapped: 'its height is surveyed in OpenStreetMap', survey: 'its top level is surveyed by the mapping agency', lidar: 'its height was measured by an airborne LiDAR scan', '3dbag': 'its height was measured by the national airborne LiDAR and modelled in the 3DBAG', floors: 'its height is its floor count times a storey height', estimate: 'its height is estimated from its neighbours', typical: 'its height is the typical one for its kind (none is mapped)', plateau: 'its height was measured from the air for Project PLATEAU', plateau_lod1: 'its height is the block height in Project PLATEAU (no survey record)', bdtopo: 'its eaves were surveyed by IGN and its roof is the typical one',
    ml: 'its height is a machine-learning estimate, bias-corrected', reference: 'its height is the published figure (the open data was far too short)', verified: 'its height was checked by hand against a cited source', parametric: 'it is built from its published dimensions' };
  function smalltalk(x, y) {
    const opts = [`It's ${fill('{time}')}. ${sunLine()}`];
    // the nearest named building in view
    let best = null, bd = 160;
    for (const [name, p] of Object.entries(scene.labels || {})) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = name; } }
    if (best) {
      const m = B.b.find(b => b[0] && (b[0] === best || b[0].startsWith(best)));
      if (m) opts.push(m[2] > 60 ? `That's ${best} up there, ${Math.round(m[2])} metres of it.` : `That's ${best}, just there.`);
    }
    const w = G.wharves.reduce((a, q) => (Math.hypot(q.terminal[0] - x, q.terminal[1] - y) < (a ? Math.hypot(a.terminal[0] - x, a.terminal[1] - y) : 400) ? q : a), null);
    if (w) { const e = nextFerry(w.id); if (e) opts.push(`The next ferry from ${w.name} is ${e.v.name}, ${e.t < 5 ? 'boarding now' : `in ${fmtSec(e.t)}`}.`); }
    opts.push(...(G.smalltalk || [G.greeting || 'G\'day.', 'Lovely spot, isn\'t it?']));
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // ------------------------------------------------------------ clock: 30 times real time by default, as in GTA
  const clock = { y: CITY.year || new Date().getFullYear(), m: 3, d: 21, min: 600, scale: 30, frozen: false };
  let sun = null, clockUtc = Date.now();
  // the traffic's rules by the hour (junctions.js: turns banned and streets shut at some hours) go by this clock
  let dowKey = '', dow = 0;
  junctions.setClock(() => { const k = `${clock.y}-${clock.m}-${clock.d}`; if (k !== dowKey) { dowKey = k; dow = (new Date(Date.UTC(clock.y, clock.m - 1, clock.d)).getUTCDay() + 6) % 7; } return { dow, min: clock.min }; });
  function setClock(y, m, d, min) {
    const t = new Date(Date.UTC(y, m - 1, d) + Math.floor(min / 1440) * 864e5);
    Object.assign(clock, { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), min: ((min % 1440) + 1440) % 1440 });
    applySun();
  }
  function applySun() {
    clockUtc = S.localToUtc(clock.y, clock.m, clock.d, clock.min);
    sun = S.position(clockUtc);
    Wd.setSun(sun, clock.min);
    if (weather) { weather.clock(clock.y, clock.m, clock.d, clock.min); weather.light(); } // a weaker sun and a greyer sky under cloud
    Wd.setSeason(clock.m, clock.d);
    if (show) show.setClock(clock.min);
    const night = U.uNight.value;
    headMat.emissiveIntensity = 1.6 * night;
    glowMat.opacity = 0.85 * night;
    if (junctions.heads) junctions.heads.setNight(night);
    const loc = S.utcToLocal(S.localToUtc(clock.y, clock.m, clock.d, clock.min));
    $('#g-time').textContent = `${fmtMin(clock.min)} ${loc.zone}`;
    $('#g-date').textContent = `${clock.d} ${MONTHS[clock.m - 1]}${clock.frozen ? ' · paused' : clock.scale === 1 ? ' · real time' : ''}`;
  }

  // ------------------------------------------------------------ benches in the sun
  // People take the sun when it's cool and the shade when it's hot. The guide is the city's
  // average daily top for the month (game.json "climate") against a comfortable 22 °C, and a
  // low sun is gentler, so mornings and evenings lean towards the sun.
  const CLIMATE = G.climate && G.climate.mean_max_c;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function sunWant() { // -1 looks for shade .. +1 looks for sun
    if (!CLIMATE || !sun || sun.altitude <= 0) return 0;
    const month = Math.max(-1, Math.min(1, (22 - CLIMATE[clock.m - 1]) / 4));
    return Math.max(-1, Math.min(1, month + 0.8 * (1 - Math.min(1, sun.altitude / 50))));
  }
  const benchLit = b => (sun && sun.altitude > 0 ? S.sunlit(DSM, b.x, b.y, b.z + 1, sun) : null);
  let benchBudget = 0;
  // how likely a passer-by is to take a free seat on a bench: what it offers against what people want
  crowd.sitChance = b => {
    if (!sun || sun.altitude <= 0) return 0.06; // a few still sit out after dark
    if (b.lit == null) return 0.25;
    const w = sunWant();
    return 0.25 * (b.lit ? 1 + 0.9 * w : 1 - 0.9 * w);
  };
  // what someone on a bench says: when the sun comes to it or leaves it today, and why that suits
  function benchTalk(b) {
    if (!sun || sun.altitude <= 0) return 'Quiet out here after dark. I like it.';
    const lit = benchLit(b), w = sunWant(), tmax = CLIMATE ? `${Math.round(CLIMATE[clock.m - 1])}°` : null;
    let at = null, sets = false;
    for (let m = Math.ceil((clock.min + 1) / 10) * 10; m < 1440; m += 10) {
      const sp = S.position(S.localToUtc(clock.y, clock.m, clock.d, m));
      if (sp.altitude <= 0) { sets = true; at = m; break; }
      if (S.sunlit(DSM, b.x, b.y, b.z + 1, sp) !== lit) { at = m; break; }
    }
    const when = at == null ? null : fmtMin(at), month = MONTH_NAMES[clock.m - 1];
    if (lit) {
      const until = sets ? `until the sun goes down at about ${when}` : when ? `until about ${when}` : 'for the rest of the day';
      if (w > 0.3) return `This bench has the sun ${until}.${tmax ? ` On a ${tmax} ${month} day, that's what you want.` : ''}`;
      if (w < -0.3) return `Bit hot in the sun, honestly. It's on this bench ${until}.`;
      return `This bench has the sun ${until}.`;
    }
    const comes = when && !sets ? `The sun gets to this bench at about ${when}.` : 'The sun won\'t get to this bench again today.';
    if (w < -0.3) return `${tmax ? `${month} averages ${tmax} here. ` : ''}${when && !sets ? `This bench is in the shade until about ${when}.` : 'This bench is in the shade for the rest of the day.'}`;
    return `Shady here. ${comes}`;
  }

  // the time of day: now, or one of sun.js's presets (sunrise, morning, noon, golden hour, sunset, blue hour,
  // night), worked out from the sun on the clock's date, so a quest's date stays when you change the hour
  function presetTime(kind) {
    clock.scale = clock.scale === 1 ? 1 : 30;
    if (kind === 'live') { const now = S.utcToLocal(Date.now()); return setClock(now.y, now.m, now.d, now.minutes); }
    setClock(clock.y, clock.m, clock.d, S.presetTime(kind, clock.y, clock.m, clock.d) ?? 600);
  }
  // the buttons for those, each with its clock time on the clock's date (the title's choice and the menu's row)
  function fillTimes(box) {
    const was = box.querySelector('[aria-pressed="true"]'), pick = was ? was.dataset.t : null, now = box.querySelector('[data-t="live"]');
    box.querySelectorAll('[data-t]:not([data-t="live"])').forEach(b => b.remove());
    for (const [k, label] of S.PRESETS) {
      const b = document.createElement('button');
      b.dataset.t = k; b.dataset.label = label;
      b.innerHTML = `${label}<span class="num">${fmtMin(S.presetTime(k, clock.y, clock.m, clock.d))}</span>`;
      if (pick) b.setAttribute('aria-pressed', String(k === pick));
      box.insertBefore(b, null);
    }
    if (now) { now.dataset.label = 'Now'; box.insertBefore(now, box.firstChild); }
  }
  function menuSync() { // the menu's slider and date follow the clock
    $('#gm-clock').value = String(Math.round(clock.min));
    $('#gm-clock-v').textContent = `${fmtMin(clock.min)} · sun ${sun.altitude.toFixed(0)}°`;
    $('#gm-date').value = `${clock.y}-${pad(clock.m)}-${pad(clock.d)}`;
    if (weather) $$('#gm-weather button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.w === weather.mode)));
    fillTimes($('#gm-time'));
  }

  // ------------------------------------------------------------ quests, in parallel lines
  // A city's quests come in lines (game.json "lines", from city.json): each line is a
  // chain of quests that runs on its own, and a line opens once the lines it comes
  // after are finished. A prologue opens the others and a finale waits for them. Every
  // open line's current step can complete, tracked or not; the HUD, the route and the
  // beam follow the tracked line. Without "lines", all the quests make one line.
  const Q = G.quests || [];
  const LINES = (G.lines && G.lines.length ? G.lines : [{ id: 'main', title: '' }]).map(l => Object.assign({ after: [] }, l));
  for (const l of LINES) l.quests = Q.filter(q => (q.line || LINES[0].id) === l.id);
  const lineById = id => LINES.find(l => l.id === id);
  const freshQs = () => ({ lines: {}, track: LINES[0].id, stamps: [], visited: {}, docked: false });
  let qs = freshQs();
  const ls = l => qs.lines[l.id] || (qs.lines[l.id] = { qi: 0, started: false, si: -1, inspected: [], rideFrom: null });
  const lineDone = l => ls(l).qi >= l.quests.length;
  const lineOpen = l => l.after.every(id => lineById(id) && lineDone(lineById(id)));
  const openLines = () => LINES.filter(l => lineOpen(l) && !lineDone(l));
  function tracked() { // the tracked line, or the first open one when it is finished or shut
    let l = lineById(qs.track);
    if (!l || !lineOpen(l) || lineDone(l)) { l = openLines()[0] || null; if (l) qs.track = l.id; }
    return l;
  }
  const questOf = l => (l ? l.quests[ls(l).qi] : null);
  const stepOf = l => (l && ls(l).started && questOf(l) ? questOf(l).steps[ls(l).si] : null);
  const quest = () => questOf(tracked());
  const step = () => stepOf(tracked());
  function objective(l = tracked()) {
    const q = questOf(l);
    if (!q) return null;
    if (!ls(l).started) { const n = npcById(q.giver); return { text: `Talk to ${n.name} (${n.role})`, at: [n.x, n.y], title: q.title, line: l }; }
    const s = stepOf(l);
    if (!s) return null;
    const out = { text: said(s.text), title: q.title, line: l };
    if (s.type === 'talk') { const n = npcById(s.npc); out.at = [n.x, n.y]; }
    else if (s.type === 'spot') { const sp = (G.spots || []).find(q => q.id === s.spot); if (sp) out.at = sp.at.slice(0, 2); }
    else if (s.type === 'ride') { const w = wharfById(player.mode === 'ferry' ? s.to : s.from); out.at = w.landing; }
    else if (s.type === 'rail' && rail) { const st = rail.stations.find(o => o.id === (player.mode === 'rail' ? s.to : s.from)); if (st) out.at = [st.x, st.y]; }
    else if (s.type === 'surface' || s.type === 'under_bridge') { const st = nav.strips.find(x => x.name === (s.surface || x.name)); if (st) out.at = st.origin.slice(); }
    else if (s.type === 'land' || s.type === 'sun' || (s.type === 'visit' && s.place)) { const pl = placeByName(s.place); if (pl) out.at = centroid(pl); }
    else if (s.type === 'visit' || s.type === 'penguins') out.at = s.at || (colonies[0] && colonies[0].colony.viewing[0]);
    if (s.type === 'visit' && s.after_dark && sun.altitude >= -0.5) out.text += ` (after dark: sunset is ${fmtMin(dayLimits().sunset)})`;
    if (s.type === 'penguins') { const n = colonies.reduce((a, c) => a + c.near(player.x, player.y, s.radius || 40), 0); out.text += ` (${n} ashore near you)`; }
    if (s.type === 'inspect' || s.type === 'gable') out.text += ` (${ls(l).inspected.length}/${(s.sources || s.kinds).length})`;
    return out;
  }
  function completeStep(l) {
    const st = ls(l);
    st.si++;
    if (st.si >= questOf(l).steps.length) completeQuest(l);
    else { H.toast(`<b>Next:</b> ${said(questOf(l).steps[st.si].text)}`); save(); }
  }
  function completeQuest(l = tracked()) {
    const q = questOf(l), wasOpen = new Set(openLines());
    qs.stamps.push({ id: q.id, stamp: q.stamp, title: q.title, at: `${clock.d} ${MONTHS[clock.m - 1]} ${fmtMin(clock.min)}` });
    A.chime(); A.thump();
    H.stamp(q.stamp, q.title);
    Object.assign(ls(l), { qi: ls(l).qi + 1, started: false, si: -1, inspected: [], rideFrom: null });
    if (lineDone(l)) { // lines this one was holding back open now
      const opened = openLines().filter(x => !wasOpen.has(x));
      for (const x of opened) if (x.on_open) setTimeout(() => H.toast(x.on_open), 2600);
      if (opened.length === 1) qs.track = opened[0].id;
    }
    renderPassport();
    save();
  }
  function startQuest(l, q) {
    Object.assign(ls(l), { started: true, si: 0 });
    qs.track = l.id;
    if (!q.steps.length) completeQuest(l);
    else { H.toast(`<b>${q.title}</b><span>${said(q.steps[0].text)}</span>`); save(); }
  }
  function talkTo(n) {
    n.talking = true;
    const finish = () => { n.talking = false; };
    // a line waiting to talk to this person moves on, and may hand over its next quest
    for (const l of openLines()) {
      const s = stepOf(l);
      if (!s || s.type !== 'talk' || s.npc !== n.id) continue;
      completeStep(l);
      const nq = questOf(l);
      if (nq && nq.giver === n.id && !ls(l).started && lineOpen(l)) return giveQuest(n, l, nq);
    }
    const ready = openLines().find(l => questOf(l).giver === n.id && !ls(l).started);
    if (ready) return giveQuest(n, ready, questOf(ready));
    dlg.show(n, [said(n.idle[Math.floor(Math.random() * n.idle.length)]) || smalltalk(n.x, n.y)], null, finish);
  }
  function giveQuest(n, l, q) {
    const talk = q.talk.map(said).filter(Boolean);
    dlg.show(n, talk.length ? talk : q.talk.map(fill), q.choices, c => {
      n.talking = false;
      if (c && c.action === 'set_time') { const [m, d] = c.date; setClock(clock.y, m, d, S.hm(c.time)); H.toast(`Time set to ${c.time}, ${d} ${MONTHS[m - 1]}`); }
      if (c && c.action === 'set_weather' && weather) {
        if (c.date || c.time) { const [m, d] = c.date || [clock.m, clock.d]; setClock(clock.y, m, d, c.time ? S.hm(c.time) : clock.min); }
        weather.set(c.weather || 'rain');
        H.toast(`${OEWeather.NAMES[c.weather || 'rain']}${c.time ? ` at ${c.time}` : ''}${c.date ? `, ${c.date[1]} ${MONTHS[c.date[0] - 1]}` : ''}. Change it in the menu (Esc).`);
      }
      if (c && c.action === 'dusk') { const t = Math.round(dayLimits().sunset) - 10; setClock(clock.y, clock.m, clock.d, t); H.toast(`Time set to ${fmtMin(t)}, ten minutes before sunset`); }
      startQuest(l, q);
      if (c && c.action === 'track' && lineById(c.line)) { qs.track = c.line; save(); } // the prologue lets you pick where to start
    });
  }
  // track the next open line (T, or a tap on its name in the quest card)
  function cycleTrack(id) {
    const open = openLines();
    if (!open.length) return;
    const cur = tracked(), next = id ? lineById(id) : open[(open.indexOf(cur) + 1) % open.length];
    if (!next || !open.includes(next)) return;
    qs.track = next.id;
    guide.key = '';
    if (open.length > 1 || id) H.toast(`Tracking <b>${next.title || questOf(next).title}</b>`);
    save();
  }
  // the gait on foot, shown beside the sun chip with its keys (hidden off foot)
  let gaitShown = '';
  function gaitChip(g) {
    const el = $('#g-gait');
    if (!el) return;
    const want = player.mode === 'foot' ? g : '';
    if (want === gaitShown) return;
    gaitShown = want;
    el.hidden = !want;
    if (!want) return;
    el.dataset.g = want;
    el.innerHTML = touch ? `<b>${{ walk: 'Walking', run: 'Running', sprint: 'Sprinting' }[want]}</b>`
      : `<b>${{ walk: 'Walking', run: 'Running', sprint: 'Sprinting' }[want]}</b><span><kbd>X</kbd> ${want === 'walk' ? 'run' : 'walk'} · <kbd>Shift</kbd> sprint</span>`;
  }
  function checkSteps() {
    for (const l of openLines()) {
      const s = stepOf(l);
      if (!s) continue;
      if (s.type === 'surface' && player.mode === 'foot' && player.floor === s.surface) {
        const st = nav.strips.find(x => x.name === s.surface), [u] = nav.stripUV(st, player.x, player.y);
        if (u >= s.u[0] && u <= s.u[1]) completeStep(l);
      } else if (s.type === 'land' && player.mode === 'heli' && heli.st.landed && inPlace(placeByName(s.place), heli.st.x, heli.st.y)) completeStep(l);
      else if (s.type === 'sun' && player.mode === 'foot' && sunState === 'sun' && clock.m === s.date[0] && clock.d === s.date[1] &&
        clock.min >= S.hm(s.window[0]) && clock.min <= S.hm(s.window[1]) && inPlace(placeByName(s.place), player.x, player.y)) completeStep(l);
      else if (s.type === 'inspect' && s.sources.every(k => ls(l).inspected.includes(k))) completeStep(l);
      else if (s.type === 'gable' && s.kinds.every(k => ls(l).inspected.includes(k))) completeStep(l);
      else if (s.type === 'visit' && player.mode === 'foot' && (!s.after_dark || sun.altitude < -0.5) &&
        (s.place ? inPlace(placeByName(s.place), player.x, player.y) : Math.hypot(player.x - s.at[0], player.y - s.at[1]) < (s.radius || 25))) completeStep(l);
      else if (s.type === 'penguins' && player.mode === 'foot' && colonies.some(c => c.near(player.x, player.y, s.radius || 40) >= (s.count || 5))) completeStep(l);
    }
  }
  // who an open line wants to talk to, and where the lines you are not tracking lead
  const wantsTalk = n => openLines().some(l => { const s = stepOf(l); return ls(l).started ? s && s.type === 'talk' && s.npc === n.id : questOf(l).giver === n.id; });
  const sideObjectives = () => openLines().filter(l => l !== tracked()).map(l => objective(l)).filter(o => o && o.at);
  // the quest card's row of open lines: tap one to track it
  let linesKey = '';
  function renderLines() {
    const open = openLines().filter(l => l.quests.length), cur = tracked();
    const key = open.map(l => `${l.id}:${ls(l).qi}`).join('|') + `>${cur ? cur.id : ''}`;
    if (key === linesKey) return;
    linesKey = key;
    const el = $('#gq-lines');
    el.hidden = open.length < 2;
    el.innerHTML = open.map(l => `<button data-line="${l.id}" aria-pressed="${l === cur}" title="Track this walk">${l.title || questOf(l).title}<span class="num">${ls(l).qi}/${l.quests.length}</span></button>`).join('')
      + (touch ? '' : '<span class="key"><kbd>T</kbd> switch</span>');
  }
  // a save from before the lines (one chain, qs.qi): the stamps say which quests are done
  function migrate(old) {
    if (!old || old.lines) return old;
    const out = Object.assign(freshQs(), { stamps: old.stamps || [], visited: old.visited || {}, docked: !!old.docked, trig: old.trig, guesses: old.guesses });
    const done = new Set(out.stamps.map(x => x.id)), cur = Q[old.qi];
    for (const l of LINES) {
      const st = out.lines[l.id] = { qi: 0, started: false, si: -1, inspected: [], rideFrom: null };
      while (st.qi < l.quests.length && done.has(l.quests[st.qi].id)) st.qi++;
      const q = l.quests[st.qi];
      if (q && cur && cur.id === q.id && old.started) Object.assign(st, { started: true, si: Math.min(old.si, q.steps.length - 1), inspected: old.inspected || [], rideFrom: old.rideFrom || null });
      if (q && cur && cur.id === q.id) out.track = l.id;
    }
    return out;
  }

  // ------------------------------------------------------------ save (this browser only)
  const KEY = `oe3d-game-${cityId}`;
  function save() {
    const car = myCar && [myCar.D.st.x, myCar.D.st.y, myCar.D.st.z, myCar.D.st.h].map(v => Math.round(v * 100) / 100);
    try { localStorage.setItem(KEY, JSON.stringify({ qs, pos: [player.x, player.y, player.z], car, clock: { y: clock.y, m: clock.m, d: clock.d, min: clock.min, scale: clock.scale } })); } catch (e) { /* storage blocked */ }
  }
  function loadSave() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  // ------------------------------------------------------------ HUD
  const base = H.baseMap(D);
  const drawMini = H.minimap($('#g-minimap'), base);
  const mini = { r: 200 }; // the minimap's radius, eased as it opens out and closes in
  const dlg = H.dialogue(A);
  function renderPassport() {
    $('#gp-stamps').innerHTML = LINES.flatMap(l => l.quests).map(q => {
      const got = qs.stamps.find(s => s.id === q.id);
      return `<li class="${got ? 'got' : ''}"><span class="stamp">${got ? q.stamp : '?'}</span><span><b>${got ? q.title : 'Not yet'}</b><span class="note">${got ? got.at : ''}</span></span></li>`;
    }).join('') + (qs.stamps.some(s => s.id === 'ferry-master') ? '<li class="got"><span class="stamp">Ferry master</span><span><b>Docked by hand</b></span></li>' : '')
      + (VP.length ? (() => { const n = VP.filter(v => trigDone()[v.id]).length; return `<li class="${n === VP.length ? 'got' : ''}"><span class="stamp">${n === VP.length ? 'Trig master' : `△ ${n}/${VP.length}`}</span>`
        + `<span><b>Trig stations</b><span class="note">${n ? VP.filter(v => trigDone()[v.id]).map(v => v.name).join(', ') : 'Survey the view from each one'}</span></span></li>`; })() : '');
    $('#g-pass-count').textContent = `${qs.stamps.filter(s => Q.some(q => q.id === s.id)).length}/${Q.length}`;
  }
  // labels: landmarks, wharves, the helipad, NPC names
  const labelsEl = $('#g-labels'), labels = [];
  const addLabel = (text, get, maxD, cls = '') => { const el = document.createElement('div'); el.className = `lbl ${cls}`; el.innerHTML = text; el.hidden = true; labelsEl.appendChild(el); labels.push({ el, get, maxD }); };
  for (const [name, p] of Object.entries(scene.labels || {})) addLabel(name, () => W(p[0], p[1], p[2] + 6), 1400);
  for (const w of G.wharves) addLabel(`<span class="tag f">F</span>${w.name}`, () => W(w.terminal[0], w.terminal[1], 6), 300, 'wharf');
  for (const h of G.helipads) addLabel(`<span class="tag h">H</span>${h.name}`, () => W(h.at[0], h.at[1], h.at[2] + 6), 400, 'wharf');
  for (const v of VP) addLabel(`<span class="tag t">△</span>${v.name}`, () => W(v.x, v.y, v.z + 3.2), 260, 'wharf');
  for (const f of flocks) addLabel(`<span class="tag g">${GULL}</span>${f.flock.name}`, () => W(f.at[0], f.at[1], f.at[2] + 3.4), 220, 'wharf');
  for (const n of npcs) addLabel(`${n.name}<span class="role">${n.role}</span>`, () => W(n.x, n.y, n.z + (n.marker.visible ? 3.0 : 2.15)), 40, 'npc');
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, placed = [];
    const far = player.mode === 'heli' ? 2.2 : 1;
    for (const l of labels) {
      if (surveyLabels.length && !l.survey) { l.el.hidden = true; continue; } // during a survey, only what is in sight
      const p = l.get();
      tmpV.copy(p).project(camera);
      const d = camera.position.distanceTo(p);
      let vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05 && d < l.maxD * far && !(l.el.classList.contains('npc') && dlg.open);
      const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
      if (vis) {
        if (!l.w) { l.el.hidden = false; l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        const r = [x - l.w / 2 - 3, y - l.h - 2, x + l.w / 2 + 3, y + 2];
        vis = !placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        if (vis) placed.push(r);
      }
      l.el.hidden = !vis;
      if (vis) { l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; l.el.style.opacity = String(Math.min(1, (l.maxD * far - d) / (l.maxD * far * 0.3))); }
    }
  }

  // ------------------------------------------------------------ the route to go (route.js)
  // By the way you are going: on foot over the footways and streets as you can walk them, by car
  // along the roads on your side, in the helicopter over or round the buildings to a spot it can
  // come down on, and aboard a ferry its course to the stop. A step that needs the helicopter
  // leads you to it first. Worked out again when the target moves, when you stray off the line,
  // and (a ride, a ferry) as the trip goes on.
  const guide = { key: '', at: -9, pts: null, fail: false, n: 0 };
  ways.build().then(() => { guide.key = ''; }).catch(e => console.warn('Routes unavailable:', e));
  function routeGoal(target, ob) {
    const s = ob && !waypoint ? stepOf(ob.line) : null;
    if (s && (s.type === 'land' || s.type === 'under_bridge') && player.mode !== 'heli') { const d = heli.doorAt(); return { x: d.x, y: d.y, z: heli.st.z, kind: 'heli' }; }
    if (!target) return null;
    const n = npcs.find(q => Math.abs(q.x - target[0]) < 0.01 && Math.abs(q.y - target[1]) < 0.01); // someone to talk to stands at a known height
    return { x: target[0], y: target[1], z: n ? n.z : null, kind: s ? s.type : 'waypoint', step: s };
  }
  // a road route's points moved over to the lane on your side, or less far where a lane that
  // narrow has a wall closer (a back lane in Shibuya)
  const laneOf = pts => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (const f of [1, 0.5, 0]) {
      const k = OECars.LANE * keepSign * f, x = p[0] - (b[1] - a[1]) / l * k, y = p[1] + (b[0] - a[0]) / l * k;
      if (!f || nav.room(x, y, p[2], 0.6, 1.6, true)) return [x, y, p[2]];
    }
  });
  // a line on the ground: a point every metre, on the floor there (the street, a deck, the quay), a
  // little above it; broken where a lift takes you up (route.js marks the stop you get out at)
  function drape(pts, lift = 0.12) {
    const out = [], on = (x, y, z, jump) => { const f = nav.floorAt(x, y, z + 0.6), q = [x, y, (f && Math.abs(f.z - z) < 2.5 ? f.z : z) + lift]; if (jump) q.push(1); out.push(q); };
    if (pts.length) on(...pts[0].slice(0, 3));
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay, az] = pts[i - 1], [bx, by, bz, jump] = pts[i];
      if (jump) { on(bx, by, bz, 1); continue; }
      const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let k = 1; k <= m; k++) { const t = k / m; on(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t); }
    }
    return out;
  }
  function plan(goal) {
    const m = player.mode;
    if (m === 'foot') {
      const me = { x: player.x, y: player.y, z: player.z }, r = ways.walk(me, goal);
      if (r) return { pts: drape(r.pts), width: 0.8 };
      // no way there on foot (across the water): to the wharf of a ferry that calls nearest it
      const near = G.wharves.slice().sort((a, b) => Math.hypot(a.landing[0] - goal.x, a.landing[1] - goal.y) - Math.hypot(b.landing[0] - goal.x, b.landing[1] - goal.y))[0];
      const from = near ? G.wharves.filter(w => w !== near && (G.ferries || []).some(f => f.stops.includes(w.id) && f.stops.includes(near.id)))
        .sort((a, b) => Math.hypot(a.landing[0] - me.x, a.landing[1] - me.y) - Math.hypot(b.landing[0] - me.x, b.landing[1] - me.y)) : [];
      for (const w of from.slice(0, 3)) {
        const q = ways.walk(me, { x: w.landing[0], y: w.landing[1] });
        if (q) return { pts: drape(q.pts), width: 0.8, ferry: w };
      }
      return null;
    }
    if (m === 'car' && myCar) {
      const st = myCar.D.st, a = roads.place(st.x, st.y, 200, keepSign, st.z);
      if (!a) return null;
      roadNet.at(a.line, a.s, rq);
      a.dir = Math.sin(st.h) * rq.hx + Math.cos(st.h) * rq.hy >= 0 ? 1 : -1; // the way the car faces
      const b = roads.place(goal.x, goal.y, 300, keepSign, goal.z ?? groundZ(goal.x, goal.y)) || roads.place(goal.x, goal.y, 800, keepSign); // (in a park, the nearest kerb)
      let rt = b && roads.route(a, b, 30000);
      if (!rt && b) rt = roads.route(a, Object.assign({}, b, { dir: -b.dir }), 30000);
      if (!rt) { // that kerb is on a road cut off from the streets (inside the castle grounds): the nearest that isn't
        const near = [...new Set(roadNet.near(goal.x, goal.y, 0, 800))].map(i => {
          const l = roadNet.L[i];
          let bk = 0, bd = Infinity;
          for (let k = 0; k < l.pts.length / 3; k++) { const d = Math.hypot(l.pts[3 * k] - goal.x, l.pts[3 * k + 1] - goal.y); if (d < bd) { bd = d; bk = k; } }
          return { line: i, s: l.cum[bk], d: bd };
        }).sort((p, q) => p.d - q.d);
        for (const q of near.slice(0, 12)) { for (const dir of [1, -1]) if (!rt) rt = roads.route(a, { line: q.line, s: q.s, dir }, 30000); if (rt) break; }
      }
      return rt && { pts: drape([[st.x, st.y, st.z]].concat(laneOf(rt.pts)), 0.1), width: 1.3 };
    }
    if (m === 'ride' && ride && ride.phase === 'driving') return { pts: drape(laneOf(ride.drv.path.pts), 0.1), width: 1.3 };
    if (m === 'heli') {
      const st = heli.st, s = goal.step;
      if (s && s.type === 'under_bridge') {
        const strip = nav.strips.find(q => q.fly_under && (!s.surface || q.name === s.surface)), u = strip && ways.underSpan(st, strip), r = u && ways.flight(st, goal, { end: u.end, under: u });
        if (r) return { pts: r.pts, flat: false, width: 1.6 };
      }
      const r = ways.flight(st, goal);
      return r && { pts: r.pts, flat: false, width: 1.6, land: r.land };
    }
    if (m === 'ferry' && player.vehicle) { // the vessel's own course, on to the stop nearest the target
      const v = player.vehicle, out = [[v.x, v.y, 0.4]];
      let best = Infinity, cut = 1;
      for (let n = 0, ci = v.ci; n < v.cycle.length; n++, ci = (ci + 1) % v.cycle.length) {
        const c = v.cycle[ci], p = c.rev ? c.leg.p.slice().reverse() : c.leg.p, cum = c.rev ? c.leg.cum.map(q => c.leg.len - q).reverse() : c.leg.cum;
        for (let k = 0; k < p.length; k++) if (n || v.phase === 'dwell' || cum[k] > v.s) out.push([p[k][0], p[k][1], 0.4]);
        const w = wharfById(c.rev ? c.leg.from : c.leg.to), d = w ? Math.hypot(w.landing[0] - goal.x, w.landing[1] - goal.y) : Infinity;
        if (d < best - 1) { best = d; cut = out.length; }
      }
      return { pts: out.slice(0, cut), width: 3 };
    }
    return null;
  }
  function updateRoute(t, target, ob, titled) {
    const m = player.mode, me = m === 'heli' ? heli.st : m === 'ferry' ? player.vehicle : player;
    const goal = !titled ? routeGoal(target, ob) : null;
    const here = goal && Math.hypot(goal.x - me.x, goal.y - me.y) < (m === 'heli' ? 30 : 12) && (m !== 'heli' || heli.st.landed);
    if (!goal || here || m === 'rail' || m === 'board') { if (guide.pts) gold.set(null); guide.key = ''; guide.pts = null; return; }
    const off = gold.follow(me.x, me.y, m === 'heli' ? me.z : null);
    const key = `${m}|${Math.round(goal.x)},${Math.round(goal.y)}|${goal.kind}|${m === 'ride' && ride ? `${ride.phase}${ride.drv.path ? (ride.drv.path.rid ??= ++guide.n) : ''}` : ''}|${m === 'ferry' && me ? me.ci : ''}`;
    const stray = { foot: 6, car: 14, heli: 70 }[m] ?? Infinity;
    if (key === guide.key && (off < stray || t - guide.at < (guide.fail ? 3 : 0.6))) return;
    if ((m === 'foot' || m === 'heli') && !ways.ready) return;
    guide.key = key; guide.at = t;
    const r = plan(goal);
    if (r && r.ferry && guide.ferry !== r.ferry.id) H.toast(`No way there on foot from here. The gold line leads to <b>${r.ferry.name}</b> for the ferry.`);
    guide.ferry = r && r.ferry ? r.ferry.id : null;
    guide.fail = !r;
    guide.pts = r ? r.pts : null;
    gold.set(guide.pts, r || {});
    if (r) gold.follow(me.x, me.y, m === 'heli' ? me.z : null);
  }

  // ------------------------------------------------------------ input
  const keys = new Set();
  let preTitle = true; // until the loader hands over to the title screen (once the scene has been drawn)
  const settings = { density: 'normal' };
  // How busy the streets are now: game.crowd.hours, [[hour, share of the pool], ...] through the day,
  // weekend_night, more on Friday and Saturday nights (18:00 to 04:00), and weekend, more all day on
  // Saturday and Sunday, as Shibuya is (390,000 a day crossing at the weekend against 260,000 on a weekday). A city
  // without hours keeps its whole crowd out all day. crowdAuto off: a tool sets the crowd itself.
  function busy() {
    const H = CR.hours;
    if (!H || !H.length) return 1;
    const h = clock.min / 60;
    let v = H[H.length - 1][1];
    for (let i = 0; i < H.length; i++) {
      const [h1, v1] = H[i];
      if (h < h1) { const [h0, v0] = i ? H[i - 1] : [H[H.length - 1][0] - 24, H[H.length - 1][1]]; v = v0 + (v1 - v0) * (h - h0) / Math.max(1e-6, h1 - h0); break; }
    }
    const wd = new Date(Date.UTC(clock.y, clock.m - 1, clock.d)).getUTCDay();
    const party = ((wd === 5 || wd === 6) && h >= 18) || ((wd === 6 || wd === 0) && h < 4);
    return Math.max(0, Math.min(1, v * (party ? CR.weekend_night || 1 : 1) * (wd === 0 || wd === 6 ? CR.weekend || 1 : 1)));
  }
  // A busy crossing's sound (game.look.sound: {at, r, station: [x, y]}): the crowd's murmur as many
  // as are round you, the screens' music while they play, and now and then the station's
  // announcement, all rising as you come to it (heard from the camera, so a film hears what it
  // sees). The walk signals' calls, there and at every signalled crossing: walkcalls.js.
  const walkCalls = OEWalkCalls.create({ junctions, audio: A, country: CITY.country, cfg: (G.signals || {}).sound, hour: () => clock.min / 60 });
  const SND = (G.look || {}).sound;
  let sndJ = null, sndAnn = 20 + Math.random() * 30, sndNear = 0, sndCount = 0;
  if (SND) {
    let best = 60;
    for (const j of junctions.J) {
      if (!j.sig || !j.arms.length) continue;
      const d = Math.hypot(j.arms.reduce((s, a) => s + a.x, 0) / j.arms.length - SND.at[0], j.arms.reduce((s, a) => s + a.y, 0) / j.arms.length - SND.at[1]);
      if (d < best) { best = d; sndJ = j; }
    }
  }
  function crossingSound(dt) {
    if (!SND || !A.murmur) return;
    const cx = camera.position.x, cy = -camera.position.z, r = SND.r || 150, d = Math.hypot(cx - SND.at[0], cy - SND.at[1]);
    const level = Math.max(0, Math.min(1, (r - d) / (0.6 * r))) * Math.max(0.2, 1 - Math.max(0, camera.position.y - (SND.z || 30)) / 250);
    if ((sndNear -= dt) <= 0) { // how many people are round you, twice a second
      sndNear = 0.5; sndCount = 0;
      for (let i = 0; i < crowd.active; i++) { const p = crowd.P[i]; if (p.line >= 0 && Math.abs(p.x - cx) < 40 && Math.abs(p.y - cy) < 40) sndCount++; }
    }
    A.murmur(level * Math.min(1, 0.25 + sndCount / 80));
    const hr = clock.min / 60;
    A.screens(level * (hr >= 9 || hr < 0.1 ? 1 : 0));
    if (SND.station && (sndAnn -= dt) <= 0) {
      sndAnn = 45 + Math.random() * 60;
      const ds = Math.hypot(cx - SND.station[0], cy - SND.station[1]);
      if (ds < 260) A.announce(Math.min(1, (260 - ds) / 160));
    }
  }
  let crowdAuto = true;
  function applyDensity() { if (crowdAuto) crowd.active = Math.round(crowd.P.length * density[settings.density] * busy()); }
  // mode: 'chase', 'bird' (the helicopter's bird's-eye view) or 'cockpit' (the pilot's eyes, looking lookYaw left and lookPitch up)
  // distTo and yawTo, when set, ease the chase camera somewhere (out to the helicopter's view, round to its door)
  const cam = { yaw: 0, pitch: 0.36, tilt: 0, dist: 7.5, distTo: 0, yawTo: null, lastInput: -10, mode: 'chase', birdAlt: 320, lookYaw: 0, lookPitch: -0.1, lift: 0, liftHold: 0, pull: 1, floor: null, snap: false };
  const cine = OECine.director({ reduced }); // camera shots, on the game clock (clockT)
  let joy = { x: 0, y: 0 }, touchLift = 0, uiOpen = () => !$('#g-menu').hidden || !$('#g-bigmap').hidden || !$('#g-pass').hidden || !$('#g-title').hidden;
  const k = c => keys.has(c);
  on(window, 'keydown', e => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) { keys.add(c); return; }
    keys.add(c);
    if (preTitle) return; // the loader is still up
    if (!$('#g-title').hidden) { if (c === 'Enter') $('#gt-play').click(); return; }
    if (photo.on) { // photo mode: move with WASD (read in photoCamera), Enter saves, Esc or O leaves
      if (c === 'Enter') snapPhoto(); else if (c === 'Escape' || c === 'KeyO') photoMode(false);
      return;
    }
    if (closeup) { // looking closer: WASD read in closeupCamera, Enter saves a photo, E or Esc steps back
      if (c === 'Enter') snapPhoto(); else if (c === 'KeyE' || c === 'Escape') closeupEnd();
      return;
    }
    if (arriving) settleArrival(); // a key settles the arrival (and still walks, looks or opens what it opens)
    else if (cine.active && cine.label !== 'crane') { cine.skip(); return; } // a key ends a hop or a survey shot
    if (c === 'Escape') { if (!phone.el.hidden) phoneShow(false); else if (!$('#g-bigmap').hidden || !$('#g-pass').hidden) { $('#g-bigmap').hidden = $('#g-pass').hidden = true; } else toggleMenu(); return; }
    if (uiOpen()) {
      if (c === 'KeyM') toggleMap();
      else if (!$('#g-bigmap').hidden && /^(Equal|NumpadAdd|Minus|NumpadSubtract)$/.test(c)) zoomMap(/Equal|Add/.test(c) ? 1.6 : 1 / 1.6); // + and − zoom the map
      return;
    }
    if (dlg.open) {
      if (c === 'KeyE' || c === 'Enter' || c === 'Space' || c === 'KeyF') dlg.next(false);
      if (/^Digit[1-9]$/.test(c)) dlg.choose(+c.slice(5) - 1);
      return;
    }
    if (!phone.el.hidden && /^Digit[1-9]$/.test(c) && phone.acts[+c.slice(5) - 1]) { phone.acts[+c.slice(5) - 1](); return; }
    if (c === 'KeyE' || c === 'KeyF' && !(player.mode === 'ferry' || player.mode === 'rail' || player.mode === 'ride')) interact();
    else if (c === 'KeyF' && (player.mode === 'ferry' || player.mode === 'rail')) skip = !skip;
    else if (c === 'KeyF' && player.mode === 'ride') skipRide();
    else if (c === 'KeyY') hail();
    else if (c === 'KeyN') phoneShow(phone.el.hidden ? undefined : false);
    else if (c === 'KeyH' && player.mode === 'car') A.honk();
    else if (c === 'KeyV' && (player.mode === 'car' || player.mode === 'ride')) { cam.mode = cam.mode === 'cabin' ? 'chase' : 'cabin'; cam.lastInput = -10; if (cam.mode === 'cabin') cam.pitch = 0.2; }
    else if (c === 'KeyR' && player.mode === 'car') resetCar();
    else if (c === 'KeyQ') lens();
    else if (c === 'KeyG') guessStart();
    else if (c === 'KeyT') cycleTrack();
    else if (c === 'KeyL') peekRoute();
    else if (c === 'KeyO') photoMode(true);
    else if (c === 'Enter' && guess.bi >= 0 && !guess.revealed) guessCheck();
    else if (c === 'KeyV') nextView();
    else if (c === 'KeyM') toggleMap();
    else if (c === 'KeyP') togglePass();
    else if (c === 'KeyH' && player.mode === 'ferry') takeHelm();
    else if (c === 'KeyR' && player.mode === 'foot') unstuck();
    else if (c === 'KeyX' && player.mode === 'foot') { player.walking = !player.walking; H.toast(player.walking ? 'Walking. <kbd>X</kbd> to run, hold <kbd>Shift</kbd> to sprint.' : 'Running. <kbd>X</kbd> to walk, hold <kbd>Shift</kbd> to sprint.'); }
  });
  on(window, 'keyup', e => keys.delete(e.code));
  on(window, 'blur', () => keys.clear());
  let drag = null;
  on(canvas, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); A.start(); if (arriving) settleArrival(); else if (cine.active) cine.skip(); });
  on(canvas, 'pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (photo.on) { photo.az += dx * 0.006; photo.pitch = Math.max(-0.35, Math.min(1.5, photo.pitch + dy * 0.005)); photoSync(); return; }
    if (closeup) { closeup.c.turn(-dx * 0.004, -dy * 0.003); return; }
    if (player.mode === 'heli' && cam.mode === 'cockpit') { cam.lookYaw = Math.max(-2.4, Math.min(2.4, cam.lookYaw - dx * 0.005)); cam.lookPitch = Math.max(-1.1, Math.min(0.8, cam.lookPitch - dy * 0.004)); }
    else { cam.yawTo = null; cam.yaw += dx * 0.006; cam.pitch = Math.max(-0.25, Math.min(1.35, cam.pitch + dy * 0.005)); }
    cam.lastInput = clockT;
  });
  on(canvas, 'pointerup', e => { if (drag && drag.moved < 6 && dlg.open) dlg.next(false); drag = null; });
  on($('#gp-alt'), 'click', () => { const a = kerbAction(); if (a) { A.start(); a.act(); } });
  on(canvas, 'wheel', e => {
    e.preventDefault();
    if (photo.on) { photo.dist = Math.max(1.5, Math.min(400, photo.dist * (e.deltaY > 0 ? 1.1 : 0.91))); photoSync(); return; }
    if (player.mode === 'heli' && cam.mode === 'bird') cam.birdAlt = Math.max(120, Math.min(1200, cam.birdAlt * (e.deltaY > 0 ? 1.12 : 0.89)));
    else { cam.distTo = 0; cam.dist = Math.max(2.5, Math.min(player.mode === 'foot' ? 30 : 120, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }
  }, { passive: false });
  // touch: joystick on the left, buttons on the right
  if (touch) {
    $('#g-touch').hidden = false;
    const pad = $('#gt-joy'), knob = $('#gt-knob');
    let jid = null, c0 = null;
    on(pad, 'pointerdown', e => { jid = e.pointerId; c0 = [e.clientX, e.clientY]; pad.setPointerCapture(jid); A.start(); settleArrival(); });
    on(pad, 'pointermove', e => {
      if (e.pointerId !== jid) return;
      let dx = (e.clientX - c0[0]) / 50, dy = (e.clientY - c0[1]) / 50;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      joy = { x: dx, y: -dy }; knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    });
    const end = () => { jid = null; joy = { x: 0, y: 0 }; knob.style.transform = ''; };
    on(pad, 'pointerup', end); on(pad, 'pointercancel', end);
    const hold = (id, down, up) => { on($(id), 'pointerdown', e => { e.preventDefault(); down(); }); on($(id), 'pointerup', up || (() => {})); on($(id), 'pointercancel', up || (() => {})); };
    hold('#gt-act', () => (dlg.open ? dlg.next(false) : interact()));
    hold('#gt-jump', () => { if (player.mode === 'heli') touchLift = 1; else keys.add('Space'); }, () => { touchLift = 0; keys.delete('Space'); });
    hold('#gt-down', () => { if (player.mode === 'heli') touchLift = -1; else if (player.mode === 'car') A.honk(); else guessStart(); }, () => { touchLift = 0; }); // Down in the air, the horn in a car, Guess on foot
    hold('#gt-run', () => { keys.has('ShiftLeft') ? keys.delete('ShiftLeft') : keys.add('ShiftLeft'); $('#gt-run').setAttribute('aria-pressed', String(keys.has('ShiftLeft'))); });
    hold('#gt-cam', () => { if (player.mode === 'car' || player.mode === 'ride') cam.mode = cam.mode === 'cabin' ? 'chase' : 'cabin'; else nextView(); });
    hold('#gt-lens', () => lens());
  }
  let skip = false, waitFerry = null, lastDock = null;
  // V: the chase camera and the bird's-eye view, and in the helicopter the pilot's own view between them
  const VIEWS = { chase: ['Chase view', 'chase view'], cockpit: ['Cockpit view: drag to look round', 'cockpit'], bird: ["Bird's-eye view: scroll to change height", "bird's-eye"] };
  const viewOrder = () => (player.mode === 'heli' ? ['chase', 'cockpit', 'bird'] : ['chase', 'bird']);
  const nextViewOf = m => { const o = viewOrder(); return o[(o.indexOf(m) + 1) % o.length]; };
  function nextView() {
    cam.mode = nextViewOf(cam.mode);
    if (cam.mode === 'cockpit') { cam.lookYaw = 0; cam.lookPitch = -0.1; }
    camera.up.set(0, 1, 0);
    H.toast(VIEWS[cam.mode][0]);
  }

  // ------------------------------------------------------------ interaction
  // the next ferry calling at a wharf; with a destination, only ferries whose route goes there
  function nextFerry(wid, toward) {
    let best = null;
    for (const v of fer.vessels) if (v.stops.includes(wid) && (!toward || v.stops.includes(toward))) { const t = fer.eta(v, wid); if (!best || t < best.t) best = { v, t }; }
    return best;
  }
  const rideSteps = () => [tracked(), ...openLines()].filter(Boolean).map(l => [l, stepOf(l)]).filter(([, s]) => s && s.type === 'ride');
  const rideTarget = wid => { const r = rideSteps().find(([, s]) => s.from === wid); return r ? r[1].to : null; };
  function nearWharf(x, y, r = 30) {
    let best = null, bd = r;
    for (const w of G.wharves) { const d = Math.min(Math.hypot(w.terminal[0] - x, w.terminal[1] - y), Math.hypot(w.berth[0] - x, w.berth[1] - y), Math.hypot(w.landing[0] - x, w.landing[1] - y)); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  function currentAction() {
    if (closeup) return { key: 'E', text: 'Step back', act: closeupEnd };
    if (dlg.open || uiOpen() || cine.active || OEOnboard.active()) return null; // nothing to start while the tour is showing
    if (player.mode === 'board') return { key: '', text: boarding.dir > 0 ? (boarding.t < 0.3 ? 'Opening the door…' : 'Climbing aboard…') : (boarding.t < 0.25 ? 'Engine off. Opening the door…' : 'Climbing out…') };
    if (player.mode === 'heli') {
      if (heli.st.landed && heli.st.speed < 1) return { key: 'E', text: 'Get out', act: exitHeli };
      return null;
    }
    if (player.mode === 'ferry') {
      const v = player.vehicle, here = fer.stopOf(v);
      if (here) return { key: 'E', text: `Get off at ${wharfById(here).name}`, act: alight };
      return null;
    }
    if (player.mode === 'rail') {
      const here = rail.stationOf(player.vehicle.id);
      if (here && player.vehicle.moved) return { key: 'E', text: `Get off at ${here.name}`, act: alightRail };
      return null;
    }
    if (player.mode === 'car') return myCar.D.st.speed < 1.5 ? { key: 'E', text: 'Get out', act: exitCar } : null;
    if (player.mode === 'ride') return ride && ride.phase !== 'asking' && ride.drv.st.v < 0.5 ? { key: 'E', text: ride.phase === 'arrived' ? `Get out at ${ride.dest.name}` : 'Get out here', act: leaveRide } : null;
    if (player.auto) return player.auto.label ? { key: '', text: player.auto.label } : null;
    let bn = null, bd = 3.2;
    for (const n of npcs) { const d = Math.hypot(n.x - player.x, n.y - player.y); if (d < bd && Math.abs(n.z - player.z) < 2) { bd = d; bn = n; } }
    if (bn) return { key: 'E', text: `Talk to ${bn.name}`, act: () => talkTo(bn) };
    if (ride && ride.phase === 'waiting' && offCar(ride, player.x, player.y) < 4 && Math.abs(ride.drv.st.z - player.z) < 2)
      return { key: 'E', text: ride.kind === 'taxi' ? 'Get in the taxi' : `Get in ${ride.name}'s ${rideCar(ride)}`, act: boardRide };
    if (myCar && offCar(myCar, player.x, player.y) < 2.5 && Math.abs(myCar.D.st.z - player.z) < 2) return { key: 'E', text: 'Drive your car', act: enterCar };
    if (Math.hypot(heli.st.x - player.x, heli.st.y - player.y) < 10 && Math.abs(heli.st.z - player.z) < 3) return { key: 'E', text: 'Board the helicopter', act: enterHeli };
    const st = railStation(player.x, player.y);
    if (st && rail.cars.length) {
      const car = rail.cars.find(c => rail.stationOf(c.id) === st), other = rail.stations.find(o => o !== st);
      if (car) return { key: 'E', text: `Board the ${G.rail.funicular.name || 'funicular'} to ${other.name}`, act: () => boardRail(car, st) };
      return { key: '', text: `${st.name}: the next car is due in ${fmtSec(rail.eta())}` };
    }
    const ls_ = liftStop(player.x, player.y, player.z);
    if (ls_) { const to = (ls_.i + 1) % ls_.l.stops.length; return { key: 'E', text: `Take the lift to ${ls_.l.stops[to].name}`, act: () => rideLift(ls_.l, ls_.i, to) }; }
    const sp = places && places.spotNear(player.x, player.y, player.z);
    if (sp) return { key: 'E', text: sp.verb || `Look at ${sp.name}`, act: () => lookAt(sp) };
    const tv = VP.find(v => Math.hypot(v.x - player.x, v.y - player.y) < 7 && Math.abs(v.z - player.z) < 3);
    if (tv) return { key: 'E', text: `${trigDone()[tv.id] ? 'Survey again' : 'Survey the view'} from ${tv.name}`, act: () => survey(tv) };
    const w = nearWharf(player.x, player.y);
    if (w) {
      const toward = rideTarget(w.id);
      const docked = fer.vessels.find(v => fer.stopOf(v) === w.id && (!toward || v.stops.includes(toward)));
      if (docked) return { key: 'E', text: `Board ${docked.name} to ${wharfById(fer.nextStop(docked)).name}`, act: () => board(docked, w) };
      const nf = nextFerry(w.id, toward);
      if (waitFerry === w.id) return { key: '', text: `Waiting at ${w.name} for ${nf ? nf.v.name : 'the next ferry'}…` };
      return nf ? { key: 'E', text: `Wait for ${nf.v.name} (due in ${fmtSec(nf.t)})`, act: () => { waitFerry = w.id; } } : { key: '', text: w.name };
    }
    const pi = crowd.nearest(player.x, player.y, 2.4);
    if (pi >= 0) return { key: 'E', text: 'Say hello', act: () => {
      const p = crowd.P[pi];
      p.pause = 6; p.face = Math.atan2(player.x - p.x, player.y - p.y); p.wave = true;
      setTimeout(() => { p.face = null; }, 6000);
      dlg.show({ name: 'Passer-by', role: G.local_name || 'Local', pitch: 180 + (pi * 37) % 160, color: '#5b7f99' }, [p.state === 'sit' && p.seat ? benchTalk(p.seat.bench) : smalltalk(p.x, p.y)]);
    } };
    return null;
  }
  function interact() { const a = currentAction(); if (a && a.act) { A.start(); a.act(); } }
  // a spot (places.js): its lines, and a step waiting for it ("spot": its id) moves on
  function lookAt(sp) {
    if (sp.look && places) { closeupStart(sp); return; }
    dlg.show({ name: sp.name, role: sp.role || '', color: sp.color || '#6d5a3a', pitch: sp.pitch || 260 }, places.lines(sp).map(fill));
    spotDone(sp);
  }
  function spotDone(sp) { for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'spot' && s.spot === sp.id) completeStep(l); } }
  // a photo spot's look closer (places.js closer): the eye a metre off the thing, the walker out of the
  // way, and you look along it with A/D (or the stick) and W/S, drag to turn your head, read what is in
  // the middle of the view, save a photo with Enter, and step back with E or Esc
  let closeup = null;
  function closeupStart(sp) {
    if (photo.on || closeup) return;
    closeup = { sp, c: places.closer(sp, player.x, player.y), text: null };
    stage.classList.add('closer');
    $('#g-closer').hidden = false;
    $('#gc-name').textContent = sp.name + (sp.role ? ` · ${sp.role}` : '');
    player.rig.root.visible = false;
    spotDone(sp);
    const to = closeup.c.step(0, 0, 0), from = { pos: camera.position.clone(), look: live.look.clone() };
    const end = { pos: W(...to.pos), look: W(...to.look) };
    cine.play(OECine.mix(() => from, () => end, q => OECine.ease.smooth(q)), 0.8, { label: 'closer' });
  }
  function closeupEnd() {
    if (!closeup) return;
    closeup = null;
    stage.classList.remove('closer');
    $('#g-closer').hidden = true;
    player.rig.root.visible = true;
    const from = { pos: camera.position.clone(), look: live.look.clone() };
    cine.play(OECine.mix(() => from, () => live, q => OECine.ease.smooth(q)), 0.8, { label: 'closer' }); // (down at the eye's height: not lifted over the roofs)
  }
  const gcHold = { along: 0, up: 0 }; // the panel's arrows, held down on a touch screen
  function closeupCamera(dt) {
    if (cine.active && cine.label === 'closer') { updateCamera(dt, false); return; }
    const along = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + joy.x + gcHold.along;
    const up = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + joy.y + gcHold.up;
    const r = closeup.c.step(dt, Math.max(-1, Math.min(1, along)), Math.max(-1, Math.min(1, up)));
    if (camera.fov !== CLOSE_FOV || camera.near !== 0.05) { camera.fov = CLOSE_FOV; camera.near = 0.05; camera.updateProjectionMatrix(); }
    camera.up.set(0, 1, 0);
    camera.position.copy(W(...r.pos));
    const look = W(...r.look);
    camera.lookAt(look);
    live.look.copy(look); // (where the crane back to the walker starts from)
    Wd.fitShadow(look, 40);
    if (r.text !== closeup.text) { closeup.text = r.text; $('#gc-text').textContent = fill(r.text || ''); }
  }
  const CLOSE_FOV = 50;

  function board(v, w) {
    player.mode = 'ferry'; player.vehicle = v; v.rider = true;
    qs.visited[w.id] = true;
    for (const [l, s] of rideSteps()) if (s.from === w.id) ls(l).rideFrom = w.id;
    cam.yaw = v.h + 0.9; cam.dist = 42; cam.pitch = 0.32;
    H.toast(`Aboard ${v.name}, ${v.route}. Next stop: ${wharfById(fer.nextStop(v)).name}. <kbd>F</kbd> to skip ahead, <kbd>H</kbd> to take the helm.`);
    A.engine(0.5);
  }
  function boardRail(car, st) {
    player.mode = 'rail'; player.vehicle = car; car.rider = true; car.moved = false; car.from = st.id;
    cam.yaw = car.h + 1.4; cam.dist = 30; cam.pitch = 0.3;
    H.toast(`Aboard the ${G.rail.funicular.name || 'funicular'}. ${G.rail.funicular.note || ''} <kbd>F</kbd> to skip ahead.`);
  }
  function alightRail() {
    const car = player.vehicle, here = rail.stationOf(car.id);
    const p = placeNear(here.x, here.y, here.z + 1) || placeNear(car.x, car.y, car.z + 1);
    if (!p) { H.toast('No safe way off here.'); return; }
    car.rider = false; skip = false;
    player.mode = 'foot'; player.vehicle = null;
    [player.x, player.y, player.z] = p;
    for (const l of [tracked(), ...openLines()].filter(Boolean)) {
      const s = stepOf(l);
      if (s && s.type === 'rail' && car.from === s.from && here.id === s.to) { completeStep(l); break; }
    }
    save();
  }
  // a walkable spot close to (x, y), on the floor reached from z0 (the ground there if not given),
  // not inside any of the boxes in avoid (cars)
  function placeNear(x, y, z0, avoid = null, maxR = 45) {
    if (z0 == null) z0 = Math.max(0, nav.terrain(x, y));
    for (let r = 0; r < maxR; r += r < 45 ? 1.5 : 5) for (let a = 0; a < 6.28; a += r ? Math.max(0.5 / Math.max(1, r / 3), 3 / r) : 7) {
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, f = nav.floorAt(px, py, z0 + 3), w = f && nav.walk(px, py, f.z);
      if (w && w.ok && !(avoid && OECars.pushOut(px, py, w.z, 0.4, avoid).hit)) return [px, py, w.z];
    }
    return null;
  }
  function alight() {
    const v = player.vehicle, here = fer.stopOf(v), w = wharfById(here);
    const p = placeNear(w.landing[0], w.landing[1]) || placeNear(w.berth[0], w.berth[1], 2);
    if (!p) { H.toast('No safe way off here.'); return; }
    v.rider = false; skip = false;
    if (v.helm) fer.finishHelm(v);
    player.mode = 'foot'; player.vehicle = null;
    [player.x, player.y, player.z] = p;
    qs.visited[here] = true;
    for (const [l, s] of new Map(rideSteps())) if (ls(l).rideFrom === s.from && here === s.to) completeStep(l);
    A.engine(0);
    save();
  }
  function takeHelm() {
    const v = player.vehicle;
    if (!v || v.phase !== 'sail') { H.toast('Wait until she is under way.'); return; }
    v.helm = { manual: false, throttle: 0.6, input: {} };
    H.toast('The skipper hands you the wheel for the next wharf. Autopilot until the approach, then it\'s yours: W/S throttle, A/D rudder.');
  }
  // Getting in, as GTA and Sketchbook do it: walk round to the pilot's door, which swings open;
  // step up onto the skid and slide into the seat; the door shuts at once and the rotor spools
  // up. Out the same way round. The moves are in the helicopter's own frame (heli.way), with
  // the player riding in its group, so they work wherever it has landed. A line on screen
  // says what is happening, and the door is open for only a second.
  let boarding = null; // { dir: 1 in or -1 out, t, ... } while getting in or out (player.mode 'board')
  const HALF_PI = Math.PI / 2, ease = (t, a, b) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  function enterHeli() {
    if (!heli.loaded()) { heli.want(); heli.show(); } // in before its model has come: the simple one until you are out again
    const w = heli.way, me = heli.toLocal(player.x, player.y, player.z);
    // from the far side, round the nose (the tail boom is too low to walk under)
    const legs = [];
    if (me.x > -1.1) { if (me.x > 0) legs.push(new THREE.Vector3(1.6, 0, 5)); legs.push(new THREE.Vector3(-1.6, 0, 5)); }
    legs.push(w.stand);
    const go = () => {
      if (!legs.length) { // at the door, unless something was in the way
        const s = heli.toWorld(w.stand);
        if (Math.hypot(s.x - player.x, s.y - player.y) > 2.5) H.toast('You can\'t get round to the pilot\'s door from here.');
        else climbIn();
        return;
      }
      const q = heli.toWorld(legs.shift());
      player.auto = { x: q.x, y: q.y, t: 0, label: 'To the pilot\'s door…', then: go };
    };
    go();
  }
  function climbIn() {
    const root = player.rig.root;
    heli.group.attach(root); // the player rides in the helicopter's frame from here
    boarding = { dir: 1, t: 0, p0: root.position.clone(), yaw0: root.rotation.y };
    player.mode = 'board'; player.vehicle = heli; player.speed = 0;
    heli.st.doorTo = 1;
    cam.yawTo = heli.st.h - HALF_PI + 0.55; // look in at the door from behind it
  }
  function exitHeli() {
    const d = heli.doorAt(), p = placeNear(d.x, d.y, heli.st.z + 0.5);
    if (!p) { H.toast('Land somewhere you can step out.'); return; }
    // step down beside the door, or as near it as there is ground to stand on
    const out = heli.toLocal(...p), near = out.distanceTo(heli.way.stand) < 2;
    boarding = { dir: -1, t: 0, out: near ? out : heli.way.stand.clone(), land: p };
    player.mode = 'board'; heli.st.on = false; heli.st.doorTo = 1;
    if (cam.mode !== 'chase') { // from the cockpit or the bird's-eye view, a crane out to the chase camera
      const from = { pos: camera.position.clone(), look: live.look.clone() };
      cam.mode = 'chase'; camera.up.set(0, 1, 0);
      cine.play(OECine.mix(() => from, () => live, k => OECine.ease.smooth(k)), 0.9, { label: 'crane' });
    }
    cam.dist = Math.max(14, cam.dist); cam.distTo = 7.5; cam.yawTo = heli.st.h - HALF_PI + 0.55; // and in close by the door as you climb out
  }
  function boardStep(dt) {
    const b = boarding, w = heli.way, root = player.rig.root, step = w.step || w.stand;
    const inSeat = new THREE.Vector3(step.x, w.seat.y, step.z); // sitting down where the step is: the hips stay where they were
    b.t += dt;
    let pos, yaw, sit = false, speed = 0;
    if (b.dir > 0) {
      if (b.t < 0.55) { // face the door as it opens, then up onto the step
        const s = ease(b.t, 0, 0.3), u = ease(b.t, 0.25, 0.55);
        pos = b.p0.clone().lerp(w.stand, s).lerp(step, u); yaw = b.yaw0 + angDiff(HALF_PI, b.yaw0) * s; speed = u > 0 && u < 1 ? 1.6 : 0;
      } else { // and slide into the seat, turning to face forward
        const s = ease(b.t, 0.55, 1.15);
        pos = inSeat.clone().lerp(w.seat, s); yaw = HALF_PI * (1 - s); sit = true;
      }
    } else if (b.t < 0.8) { // turn to the door as it opens and slide out onto the step
      const s = ease(b.t, 0.25, 0.8);
      pos = w.seat.clone().lerp(inSeat, s); yaw = -HALF_PI * s; sit = true;
    } else { // and step down
      const s = ease(b.t, 0.8, 1.15);
      pos = step.clone().lerp(b.out, s); yaw = -HALF_PI; speed = s < 1 ? 1.6 : 0;
    }
    root.position.copy(pos); root.rotation.set(0, yaw, 0);
    player.rig.animate(dt, speed, sit ? 'sit' : 'ground', clockT);
    const q = heli.toWorld(pos);
    player.x = q.x; player.y = q.y; player.z = q.z; player.h = heli.st.h - yaw;
    if (b.dir > 0 && b.t >= 1.15) seated();
    else if (b.dir < 0 && b.t >= 1.15) stepOff();
  }
  function seated() { // in: the door shuts behind you and the rotor spools up
    boarding = null;
    player.mode = 'heli'; heli.st.on = true; heli.st.doorTo = 0;
    player.rig.root.position.copy(heli.way.seat); player.rig.root.rotation.set(0, 0, 0);
    cam.mode = 'chase'; cam.distTo = 24; // pull back to the chase view; it swings behind once under way
    H.toast('Door shut, rotor spooling up: it lifts at 90%. <kbd>Space</kbd> climb, <kbd>C</kbd> descend, <kbd>W</kbd>/<kbd>S</kbd>, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>V</kbd> change view.');
  }
  function stepOff() { // out: on your feet beside it, and the door swings shut
    const p = boarding.land;
    boarding = null;
    heli.st.doorTo = 0;
    world.attach(player.rig.root);
    player.rig.root.rotation.set(0, Math.PI - player.h, 0);
    player.mode = 'foot'; player.vehicle = null; player.speed = 0; player.ground = true; player.vz = 0;
    [player.x, player.y, player.z] = p;
    save();
  }
  function unstuck() {
    const p = placeNear(player.x, player.y, player.z) || placeNear(G.start.at[0], G.start.at[1]);
    if (p) { [player.x, player.y, player.z] = p; player.vz = 0; H.toast('Back on your feet.'); }
  }
  // survey lens: what is this building, and where does its height come from?
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  function aimed() { // the building under the reticle, within 600 m
    camera.updateMatrixWorld();
    ray.setFromCamera({ x: 0, y: 0.08 }, camera);
    ray.far = 600;
    const hit = ray.intersectObject(Wd.buildings)[0];
    return hit ? { bi: Wd.bGeo.attributes.bid.getX(hit.face.a), distance: hit.distance } : null;
  }
  // Amsterdam: the gables a house's fronts carry (rooftop kind 5 in buildings.json), by building, and
  // when each type was built (Grachtenmuseum); a 'gable' step asks the lens to find the kinds it lists
  const GABLE_KINDS = ['spout', 'step', 'neck', 'bell', 'cornice'];
  const GABLE_DATES = { spout: 'c. 1620-1720, mostly on warehouses', step: 'c. 1600-1665', neck: 'c. 1640-1770', bell: 'c. 1660-1790', cornice: '18th and 19th centuries' };
  let gablesOf = null;
  const gables = bi => {
    if (!gablesOf) {
      gablesOf = new Map();
      for (const p of B.p || []) if (p[1] === 5 && p.length > 9) {
        const b = B.s[p[0]][0], k = GABLE_KINDS[p[9]];
        if (!gablesOf.has(b)) gablesOf.set(b, []);
        if (!gablesOf.get(b).includes(k)) gablesOf.get(b).push(k);
      }
    }
    return gablesOf.get(bi) || [];
  };
  function lens() {
    if (player.mode !== 'foot') return;
    guess.bi = -1;
    const hit = aimed();
    if (!hit) { H.toast('Aim at a building and press Q.'); return; }
    const bi = hit.bi, m = B.b[bi];
    U.uSel.value = bi;
    const name = m[0] || (m[1] ? `Unnamed ${m[1].replace(/_/g, ' ')}` : 'Unnamed building');
    const osm = m[6] && /^[wr]\d+$/.test(m[6]) ? `<a href="https://www.openstreetmap.org/${m[6][0] === 'w' ? 'way' : 'relation'}/${m[6].slice(1)}" target="_blank" rel="noopener">${m[6]}</a>` : '–';
    const SRC = { plateau: 'Measured by aerial survey (Project PLATEAU)', plateau_lod1: 'Block height in Project PLATEAU (no survey record)', survey: 'Surveyed by the mapping agency', lidar: 'Measured by airborne LiDAR', '3dbag': 'Measured by airborne LiDAR (3DBAG)', bdtopo: 'Surveyed eaves (IGN BD TOPO) + typical roof', mapped: 'Surveyed in OpenStreetMap', floors: 'Floor count × storey height', estimate: 'Estimated from neighbours', typical: 'Typical height for its kind', ml: 'ML estimate, bias-corrected', reference: 'Published height (corrected)', verified: 'Verified from a cited source', parametric: 'Parametric landmark' };
    $('#g-lens').innerHTML = `<span class="eyebrow">Survey lens · ${Math.round(hit.distance)} m away</span><b>${name}</b>
      <dl class="kv"><dt>Height</dt><dd class="num">${m[2].toFixed(1)} m</dd><dt>Source</dt><dd>${SRC[m[4]] || m[4]}</dd>${m[3] ? `<dt>Floors</dt><dd class="num">${m[3]}</dd>` : ''}${B.roof_shapes && typeof m[15] === 'number' ? `<dt>Roof</dt><dd>${(B.roof_shapes[m[15]] || 'flat').replace(/_/g, ' ')}${B.roof_materials[m[13]] && m[15] ? `, ${B.roof_materials[m[13]]}` : ''}${(B.roof_sources || [])[m[16]] === 'measured' ? ' (measured)' : ''}</dd>` : ''}${gables(bi).length ? `<dt>Gable</dt><dd>${gables(bi).map(k => k === 'cornice' ? 'cornice front' : `${k} gable`).join(', ')} (${GABLE_DATES[gables(bi)[0]]})</dd>` : ''}${m[4] === 'reference' ? `<dt>Open data said</dt><dd class="num">${m[9].toFixed(1)} m</dd>` : ''}<dt>OSM</dt><dd>${osm}</dd></dl>`;
    $('#g-lens').hidden = false;
    clearTimeout(lens.t);
    lens.t = setTimeout(() => { $('#g-lens').hidden = true; U.uSel.value = -1; }, 6000);
    for (const l of openLines()) {
      const s = stepOf(l), got = ls(l).inspected;
      if (s && s.type === 'inspect' && s.sources.includes(m[4]) && !got.includes(m[4])) { got.push(m[4]); A.chime(); H.toast(`Found one: ${SRC[m[4]]} (${got.length}/${s.sources.length})`); checkSteps(); }
      if (s && s.type === 'gable') for (const k of gables(bi)) if (s.kinds.includes(k) && !got.includes(k)) {
        got.push(k); A.chime(); H.toast(`Found one: a ${k} gable, ${GABLE_DATES[k]} (${got.length}/${s.kinds.length})`); checkSteps();
      }
    }
  }

  // ------------------------------------------------------------ height challenge: guess, then see how good the data is
  // Aim at a building and press G. Your guess is scored against the model's height, and
  // set beside the error of the data itself: a floor-count height is good to about ±20%,
  // an estimate much less, so a guess can be as good as the open data.
  const guess = { bi: -1, revealed: false };
  const sigmaOf = src => (D.UNC && D.UNC.sigma && D.UNC.sigma[src]) || { mapped: 0.03, reference: 0.03, verified: 0.02 }[src] || 0.2;
  const sliderH = v => 3 * Math.pow(320 / 3, v / 1000); // a log scale, 3 to 320 m
  function guessStart() {
    if (player.mode !== 'foot') return;
    const hit = aimed();
    if (!hit) { H.toast('Aim at a building and press G to guess its height.'); return; }
    const m = B.b[hit.bi];
    if (m[4] === 'parametric') { H.toast('That one is built from its published dimensions. Try another building.'); return; }
    Object.assign(guess, { bi: hit.bi, revealed: false });
    U.uSel.value = hit.bi;
    clearTimeout(lens.t);
    const name = m[0] || (m[1] ? `Unnamed ${m[1].replace(/_/g, ' ')}` : 'Unnamed building');
    $('#g-lens').innerHTML = `<span class="eyebrow">Height challenge · ${Math.round(hit.distance)} m away</span><b>${name}</b>
      <span class="note">How tall is it, ground to roof?</span>
      <label class="g-guess"><input type="range" id="gg-range" min="0" max="1000" value="${Math.round(1000 * Math.log(30 / 3) / Math.log(320 / 3))}" aria-label="Your guess, in metres"><output id="gg-val" class="num"></output></label>
      <div class="row"><button class="btn primary" id="gg-go">Check <kbd>Enter</kbd></button><button class="btn" id="gg-no">Not now</button></div>`;
    $('#g-lens').hidden = false;
    const show = () => { $('#gg-val').textContent = `${Math.round(sliderH(+$('#gg-range').value))} m`; };
    show();
    $('#gg-range').addEventListener('input', show);
    $('#gg-range').addEventListener('keydown', e => { if (e.key === 'Enter') guessCheck(); });
    $('#gg-go').addEventListener('click', guessCheck);
    $('#gg-no').addEventListener('click', guessClose);
  }
  function guessClose() { guess.bi = -1; $('#g-lens').hidden = true; U.uSel.value = -1; }
  function guessCheck() {
    if (guess.bi < 0 || guess.revealed) return;
    guess.revealed = true;
    const m = B.b[guess.bi], h = m[2], g = Math.round(sliderH(+$('#gg-range').value));
    const err = Math.log(g / h), pts = Math.max(0, Math.round(100 * (1 - Math.abs(err) / Math.LN2))); // 0 points at twice or half
    const sig = sigmaOf(m[4]), lo = h * Math.exp(-1.645 * sig), hi = h * Math.exp(1.645 * sig), inside = g >= lo && g <= hi;
    const rec = qs.guesses || (qs.guesses = { n: 0, pts: 0, inside: 0 });
    rec.n++; rec.pts += pts; rec.inside += inside ? 1 : 0;
    save();
    const off = Math.round(100 * (g / h - 1));
    $('#g-lens').innerHTML = `<span class="eyebrow">Height challenge</span><b>${m[0] || 'This building'}: ${h.toFixed(1)} m</b>
      <span class="verdict">${pts} points${inside ? ' · as good as the data' : ''}</span>
      <span>Your guess, ${g} m, is ${off === 0 ? 'spot on' : `${Math.abs(off)}% ${off > 0 ? 'high' : 'low'}`}. ${SRC_TEXT[m[4]] ? SRC_TEXT[m[4]][0].toUpperCase() + SRC_TEXT[m[4]].slice(1) : 'Its height comes from the open data'},
      good to ${Math.round(lo)}–${Math.round(hi)} m nine times in ten.${inside ? ' Your guess is inside that range.' : ''}</span>
      <span class="note">${rec.n} guess${rec.n > 1 ? 'es' : ''}, ${Math.round(rec.pts / rec.n)} points on average; ${rec.inside} as good as the data. G for another.</span>`;
    if (inside) A.chime();
    clearTimeout(lens.t);
    lens.t = setTimeout(guessClose, 12000);
  }

  // ------------------------------------------------------------ surveying from a trig station
  // What can you see from here? A straight line of sight through the 2 m surface model
  // (with the Opera House shells and the bridge deck in it) to a point just under each
  // roof: the tallest part of every building within range.
  const roofs = (() => {
    const r = B.b.map(() => null);
    for (const sd of B.s) {
      const top = (sd[1] + sd[3]) / 10, ring = sd[4];
      if (r[sd[0]] && r[sd[0]][2] >= top) continue;
      let x = 0, y = 0;
      for (let k = 0; k < ring.length; k += 2) { x += ring[k]; y += ring[k + 1]; }
      r[sd[0]] = [x / (ring.length / 2) / 10, y / (ring.length / 2) / 10, top];
    }
    return r;
  })();
  function viewshed(ex, ey, ez, range) {
    const seen = [], { nx, ny, cell, x0, y1, data, ids } = DSM;
    for (let b = 0; b < roofs.length; b++) {
      const t = roofs[b];
      if (!t) continue;
      const dx = t[0] - ex, dy = t[1] - ey, d = Math.hypot(dx, dy);
      if (d > range || d < 4) continue;
      const tz = t[2] - 0.5, n = Math.ceil(d / 1.5);
      let ok = true;
      for (let i = 1; i < n; i++) {
        const f = i / n, c = Math.floor((ex + dx * f - x0) / cell), r = Math.floor((y1 - ey - dy * f) / cell);
        if (c < 0 || r < 0 || c >= nx || r >= ny) continue;
        const k = r * nx + c;
        if (data[k] > ez + (tz - ez) * f + 0.2) { ok = ids[k] === b; break; }
      }
      if (ok) seen.push(b);
    }
    return seen;
  }
  const SRC_GROUP = { mapped: 'surveyed', reference: 'surveyed', verified: 'surveyed', survey: 'surveyed', plateau: 'surveyed', plateau_lod1: 'surveyed', lidar: 'surveyed', bdtopo: 'surveyed', '3dbag': 'surveyed',
    floors: 'floors', ml: 'estimated', estimate: 'estimated', typical: 'estimated' };
  let surveyLabels = [], surveyFov = BASE_FOV;
  function survey(vp) {
    const ez = player.z + 1.6, seen = viewshed(player.x, player.y, ez, 3000);
    // label what is in sight: the named landmarks, then the tallest named buildings
    const named = seen.filter(b => B.b[b][0]).sort((a, b) => roofs[b][2] - roofs[a][2]);
    const marks = Object.entries(scene.labels || {}).map(([n, p]) => ({ n, p, b: named.find(b => B.b[b][0].startsWith(n)) })).filter(m => m.b != null);
    const extra = named.filter(b => !marks.some(m => m.b === b)).slice(0, 6).map(b => ({ n: B.b[b][0], p: roofs[b], b }));
    for (const m of [...marks, ...extra]) {
      // a parametric landmark's row is only its base; its label point carries its published height
      const row = B.b[m.b], para = row[4] === 'parametric', el = document.createElement('div');
      el.className = 'lbl npc survey';
      el.innerHTML = `${para ? m.n : row[0]}<span class="role">${para ? `${Math.round(m.p[2])} m · built from published dimensions`
        : `${Math.round(row[2])} m · ${{ surveyed: 'surveyed', floors: 'from floors', estimated: 'estimated' }[SRC_GROUP[row[4]]]}`}</span>`;
      el.hidden = true;
      labelsEl.appendChild(el);
      const at = para ? W(m.p[0], m.p[1], m.p[2] + 4) : W(roofs[m.b][0], roofs[m.b][1], roofs[m.b][2] + 4);
      surveyLabels.push({ el, get: () => at, maxD: 3200, survey: true });
    }
    labels.unshift(...surveyLabels);
    stage.classList.add('letterbox');
    A.chime();
    // You turn once round on the spot and the camera turns with you, over your right
    // shoulder with a longer lens, the horizon at eye level, then settles back into the
    // chase camera.
    cam.yaw = player.h;
    const c = head(), h0 = player.h, p0 = chasePolar(), pos = new THREE.Vector3(), lk = new THREE.Vector3();
    const round = k => {
      const b = Math.pow(Math.sin(Math.PI * k), 0.5), az = h0 + 2 * Math.PI * OECine.ease.inOut(k);
      player.h = az;
      OECine.around(c, az + Math.PI - 0.32 * b, OECine.lerp(p0.dist, 6, b), OECine.lerp(p0.h, 1, b), pos);
      OECine.around(c, az, 300 * b, -8 * b, lk); // the skyline ahead, just below eye level
      surveyFov = OECine.lerp(BASE_FOV, 34, b);
      return { pos, look: lk };
    };
    cine.play(OECine.mix(round, () => live, k => handOver(k, 0.92)), 11, { label: 'survey', onEnd: () => {
      player.h = cam.yaw = h0;
      stage.classList.remove('letterbox');
      for (const l of surveyLabels) { l.el.remove(); labels.splice(labels.indexOf(l), 1); }
      surveyLabels = [];
      fieldNotes(vp, ez, seen);
    } });
  }
  function fieldNotes(vp, ez, seen) {
    const first = !trigDone()[vp.id];
    trigDone()[vp.id] = true;
    const done = VP.filter(v => trigDone()[v.id]).length, all = done === VP.length;
    const lines = [`${vp.name}: your eyes are ${Math.round(ez)} m above sea level, and ${seen.length.toLocaleString()} buildings are in sight within 3 km.`];
    const top = seen.filter(b => B.b[b][0] && B.b[b][4] !== 'parametric').sort((a, b) => B.b[b][2] - B.b[a][2])[0];
    if (top != null) lines.push(`The tallest in sight is ${B.b[top][0]}, ${Math.round(B.b[top][2])} m tall: ${SRC_TEXT[B.b[top][4]] || 'its height comes from the open data'}.`);
    const n = { surveyed: 0, floors: 0, estimated: 0 };
    for (const b of seen) if (SRC_GROUP[B.b[b][4]]) n[SRC_GROUP[B.b[b][4]]]++;
    const tot = n.surveyed + n.floors + n.estimated;
    if (tot) lines.push(`Of the heights in sight, ${Math.round(100 * n.surveyed / tot)}% are surveyed or published, ${Math.round(100 * n.floors / tot)}% come from floor counts and ${Math.round(100 * n.estimated / tot)}% are estimated.`);
    lines.push(all ? `That's every trig station: ${done} of ${done}. The Trig master stamp is yours.` : `Trig stations surveyed: ${done} of ${VP.length}.`);
    if (first && all && !qs.stamps.some(s => s.id === 'trig-master')) {
      qs.stamps.push({ id: 'trig-master', stamp: 'Trig master', title: 'Every trig station surveyed', at: `${clock.d} ${MONTHS[clock.m - 1]} ${fmtMin(clock.min)}` });
      A.chime(); A.thump();
      H.stamp('Trig master', 'Every trig station surveyed');
    }
    renderPassport();
    save();
    dlg.show({ name: 'Field notes', role: vp.name, color: '#a8740b', pitch: 330 }, lines);
  }

  // ------------------------------------------------------------ photo mode
  // The world holds still and the HUD goes. Orbit the camera round a focus that starts on
  // you: drag to turn, scroll (or Distance) to come closer, Aperture for the depth of field, WASD and Space/C to move the
  // focus up to 300 m away. Time sets the sun for the photo (the clock stays there when
  // you leave); Lens is the field of view, shown as a 35 mm focal length. Saving draws a
  // caption with the place, the time and the sun's height into the corner.
  const FSTOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16]; // the aperture: depth of field focused on the focus point
  const photo = { fstop: 2.8, on: false, focus: new THREE.Vector3(), anchor: new THREE.Vector3(), az: 0, pitch: 0.3, dist: 8, fov: BASE_FOV, turn: false };
  const distOf = v => 1.5 * Math.pow(400 / 1.5, v / 1000), distTo = d => Math.round(1000 * Math.log(d / 1.5) / Math.log(400 / 1.5)); // a log slider, 1.5 to 400 m
  const focal = fov => Math.round(12 / Math.tan(fov * RAD / 2)); // a full-frame 35 mm camera, 24 mm tall
  function photoMode(on) {
    if (on === photo.on || !$('#g-title').hidden || closeup) return;
    if (on && dlg.open) { H.toast('Finish the conversation first.'); return; }
    if (on && cine.active) cine.skip();
    photo.on = on;
    stage.classList.toggle('photo', on);
    $('#g-photo').hidden = !on;
    if (on) {
      const p = OECine.polar(live.look, camera.position);
      photo.focus.copy(live.look); photo.anchor.copy(live.look);
      Object.assign(photo, { az: p.az, pitch: Math.atan2(p.h, Math.max(0.1, p.dist)), dist: Math.max(6, camera.position.distanceTo(live.look)), fov: camera.fov, turn: false });
      $('#ph-turn').setAttribute('aria-pressed', 'false');
      photoSync();
    } else {
      player.rig.root.visible = true;
      $('#ph-me').setAttribute('aria-pressed', 'true');
      stage.classList.remove('grid'); $('#ph-grid').setAttribute('aria-pressed', 'false');
      // back to the chase camera without a jump
      const from = { pos: camera.position.clone(), look: photo.focus.clone() };
      cine.play(OECine.mix(() => from, () => live, k => OECine.ease.smooth(k)), 0.9, { label: 'crane' });
    }
  }
  // the circle of confusion of a full-frame camera at this field of view and f-number, focused at
  // `focus` m, for a point at distance d: lensBlur(...) * |d - focus| / d of the frame's height
  function lensBlur(fov, focus, fstop) {
    const f = 0.012 / Math.tan(fov * RAD / 2); // the focal length, m, on a 24 mm tall frame
    return f * f / (fstop * Math.max(0.05, focus - f)) / 0.024;
  }
  function photoSync() { // the sliders follow the camera and the clock
    $('#ph-time').value = String(Math.round(clock.min));
    $('#ph-time-v').textContent = `${fmtMin(clock.min)} · sun ${sun.altitude.toFixed(0)}°`;
    $('#ph-fov').value = String(Math.round(photo.fov));
    $('#ph-fov-v').textContent = `${focal(photo.fov)} mm`;
    $('#ph-f').value = String(FSTOPS.indexOf(photo.fstop)); $('#ph-f-v').textContent = `f/${photo.fstop}`;
    $('#ph-dist').value = String(distTo(photo.dist));
    $('#ph-dist-v').textContent = `${photo.dist < 20 ? photo.dist.toFixed(1) : Math.round(photo.dist)} m`;
  }
  function photoCamera(dt) {
    const p = photo, f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + joy.y,
      sd = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + joy.x, up = (k('Space') ? 1 : 0) - (k('KeyC') ? 1 : 0);
    const h = p.az + Math.PI, sp = Math.max(4, p.dist * 0.7) * dt; // the way the camera looks; faster when further out
    p.focus.x += (Math.sin(h) * f + Math.cos(h) * sd) * sp;
    p.focus.z += (-Math.cos(h) * f + Math.sin(h) * sd) * sp;
    p.focus.y += up * sp;
    const off = Math.hypot(p.focus.x - p.anchor.x, p.focus.z - p.anchor.z);
    if (off > 300) { p.focus.x = p.anchor.x + (p.focus.x - p.anchor.x) * 300 / off; p.focus.z = p.anchor.z + (p.focus.z - p.anchor.z) * 300 / off; }
    p.focus.y = Math.min(Math.max(p.focus.y, nav.terrainBelow(p.focus.x, -p.focus.z, p.focus.y + 0.5) + 0.3), p.anchor.y + 300);
    if (p.turn) p.az += dt * 2 * Math.PI / 45;
    OECine.around(p.focus, p.az, p.dist * Math.cos(p.pitch), p.dist * Math.sin(p.pitch), camera.position);
    camera.position.y = Math.max(camera.position.y, nav.groundBelow(camera.position.x, -camera.position.z, camera.position.y) + 0.4);
    camera.up.set(0, 1, 0);
    camera.lookAt(p.focus);
    if (camera.fov !== p.fov) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
    Wd.fitShadow(p.focus, THREE.MathUtils.clamp(p.dist * 1.6, 150, 1600));
    if (f || sd || up || p.turn) photoSync();
  }
  // render once more and read the canvas back in the same task (it keeps no copy), then caption it
  function snapPhoto() {
    if (mirror) mirror.update(world, clockT);
    if (atmos) atmos.render(world, camera); else renderer.render(world, camera);
    const w = canvas.width, h = canvas.height, out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    g.drawImage(canvas, 0, 0);
    const loc = S.utcToLocal(S.localToUtc(clock.y, clock.m, clock.d, clock.min)), fs = Math.max(12, Math.round(h * 0.017)), pad = Math.round(fs * 0.9);
    const lines = [`${CITY.name} · ${clock.d} ${MONTHS[clock.m - 1]} ${clock.y}, ${fmtMin(clock.min)} ${loc.zone} · sun ${sun.altitude.toFixed(1)}° up`,
      'Open Earth 3D · buildings and streets © OpenStreetMap contributors, via Overture Maps'];
    g.font = `600 ${fs}px "Public Sans", sans-serif`;
    const tw = Math.max(...lines.map(t => g.measureText(t).width));
    g.fillStyle = 'rgba(8, 16, 24, 0.55)';
    g.fillRect(0, h - pad * 2 - fs * 2.3, tw + pad * 2, pad * 2 + fs * 2.3);
    g.fillStyle = '#ffffff'; g.textBaseline = 'bottom';
    g.fillText(lines[0], pad, h - pad - fs * 1.2);
    g.font = `400 ${Math.round(fs * 0.8)}px "Public Sans", sans-serif`; g.fillStyle = 'rgba(255, 255, 255, 0.82)';
    g.fillText(lines[1], pad, h - pad);
    A.shutter();
    stage.classList.remove('flash'); void stage.offsetWidth; stage.classList.add('flash');
    const name = `open-earth-3d-${cityId}-${clock.y}${String(clock.m).padStart(2, '0')}${String(clock.d).padStart(2, '0')}-${fmtMin(clock.min).replace(':', '')}.png`;
    // encode now, inside the click or key press: a download started later (toBlob's callback) can
    // outlive the user's gesture and be blocked
    const a = document.createElement('a');
    try { a.href = out.toDataURL('image/png'); } catch (e) { H.toast('Could not save the photo.'); return null; }
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    H.toast(`Saved <b>${name}</b>`);
    return name;
  }
  on($('#ph-time'), 'input', e => { setClock(clock.y, clock.m, clock.d, +e.target.value); photoSync(); });
  on($('#ph-fov'), 'input', e => { photo.fov = +e.target.value; photoSync(); });
  on($('#ph-f'), 'input', e => { photo.fstop = FSTOPS[+e.target.value] || 2.8; photoSync(); });
  on($('#ph-dist'), 'input', e => { photo.dist = distOf(+e.target.value); photoSync(); });
  on($('#ph-turn'), 'click', e => { photo.turn = !photo.turn; e.currentTarget.setAttribute('aria-pressed', String(photo.turn)); });
  on($('#ph-grid'), 'click', e => { const g = !stage.classList.contains('grid'); stage.classList.toggle('grid', g); e.currentTarget.setAttribute('aria-pressed', String(g)); });
  on($('#ph-me'), 'click', e => { const v = !player.rig.root.visible; player.rig.root.visible = v; e.currentTarget.setAttribute('aria-pressed', String(v)); });
  on($('#ph-snap'), 'click', snapPhoto);
  on($('#ph-done'), 'click', () => photoMode(false));
  on($('#g-photo-btn'), 'click', () => photoMode(true));
  on($('#gc-snap'), 'click', snapPhoto);
  on($('#gc-done'), 'click', closeupEnd);
  for (const b of document.querySelectorAll('#g-closer [data-hold]')) {
    const [a, u] = b.dataset.hold.split(',').map(Number);
    on(b, 'pointerdown', e => { gcHold.along = a; gcHold.up = u; b.setPointerCapture(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel']) on(b, ev, () => { gcHold.along = gcHold.up = 0; });
  }

  // ------------------------------------------------------------ menus, map, passport
  function toggleMenu() { $('#g-menu').hidden = !$('#g-menu').hidden; if (!$('#g-menu').hidden) menuSync(); }
  function togglePass() { renderPassport(); $('#g-pass').hidden = !$('#g-pass').hidden; }
  const bigCanvas = $('#g-bigmap-c'), mapPop = $('#g-mappop');
  let bigView = null, waypoint = null, bigPins = [], picked = null, travelKey = '';
  function toggleMap() {
    const el = $('#g-bigmap');
    el.hidden = !el.hidden;
    picked = null; mapPop.hidden = true;
    if (!el.hidden) { travelKey = ''; drawBig(); }
  }

  // ------------------------------------------------------------ map travel
  // Any time, from the map, as Genshin Impact's and Breath of the Wild's maps let you: to the city's
  // landmarks (scene.labels), its travel points, trig stations and wharves, your car, the start, or
  // any spot you pick, the way Flight Simulator's world map drops you anywhere. On foot, in your car
  // (it comes along to a kerb there) or in a taxi (it lets you out). A landmark is framed on arrival
  // as Google Earth's fly-to frames a place: you stand back from it by about its height, on a spot
  // with a clear line of sight to its upper part through the 2 m surface model, lit from behind you
  // by day, facing it, with the camera low enough to take in its top.
  const landmarks = Object.entries(scene.labels || {}).map(([name, p]) => ({ kind: 'landmark', id: `lm-${name}`, name, at: [p[0], p[1]], top: p[2] }));
  const dsmAt = (x, y) => {
    const c = Math.floor((x - DSM.x0) / DSM.cell), r = Math.floor((DSM.y1 - y) / DSM.cell);
    return c >= 0 && r >= 0 && c < DSM.nx && r < DSM.ny ? DSM.data[r * DSM.nx + c] : 0;
  };
  const inFrame = (x, y, m = 30) => x > FRAME.x0 + m && x < FRAME.x1 - m && y > FRAME.y0 + m && y < FRAME.y1 - m;
  // how far into the haze at the model's edge a point is, 0 to 1, as world.js edgeHaze draws it: standing in that band,
  // everything round you is veiled, the near things too
  const edgeFade = Math.min(500, Math.max(250, 0.1 * Math.min(FRAME.x1 - FRAME.x0, FRAME.y1 - FRAME.y0)));
  const hazeAt = (x, y) => {
    const ox = Math.max(0, Math.abs(x - (FRAME.x0 + FRAME.x1) / 2) - ((FRAME.x1 - FRAME.x0) / 2 - edgeFade));
    const oy = Math.max(0, Math.abs(y - (FRAME.y0 + FRAME.y1) / 2) - ((FRAME.y1 - FRAME.y0) / 2 - edgeFade));
    return THREE.MathUtils.smoothstep(Math.hypot(ox, oy), 0, edgeFade);
  };
  // the trees (places.json, decimetres: x, y, ground, height; mapped, and planted from the woods' canopy) as [x, y, top, crown radius] on a 20 m grid,
  // built on first use: the surface model has the buildings but not the trees, and a crown hides a tower as well
  let treeGrid = null;
  function treesNear(x, y, r) {
    if (!treeGrid) {
      treeGrid = new Map();
      const T = (P.trees || []).concat(P.woods || []);
      for (let i = 0; i + 3 < T.length; i += 4) {
        const tx = T[i] / 10, ty = T[i + 1] / 10, h = T[i + 3] / 10, k = `${Math.floor(tx / 20)},${Math.floor(ty / 20)}`;
        if (!treeGrid.has(k)) treeGrid.set(k, []);
        treeGrid.get(k).push([tx, ty, T[i + 2] / 10 + h, Math.max(3, h * 0.45)]); // a fig spreads as wide as it is tall
      }
    }
    const out = [];
    for (let i = Math.floor((x - r) / 20); i <= Math.floor((x + r) / 20); i++) for (let j = Math.floor((y - r) / 20); j <= Math.floor((y + r) / 20); j++) {
      for (const t of treeGrid.get(`${i},${j}`) || []) if (Math.hypot(t[0] - x, t[1] - y) < r + t[3]) out.push(t);
    }
    return out;
  }
  // a spot to stand and look at a landmark from: { x, y, z, face, pitch }, or null. Back from it by its
  // height or its breadth, whichever is more (the breadth read from the surface model round its label), so
  // a tower stands whole in the frame and the Opera House's shells fit across it; then, of the spots round
  // it, the one with the clearest line of sight to its upper part, room behind for the camera, and the
  // sun behind you by day
  // A city can steer it for the few landmarks the search gets wrong (city.json "arrivals", keyed by the label's
  // name): "front", the compass bearing its front faces (the arrival keeps within "arc" degrees of it, 70 if not
  // given), "dist", how far back to stand in metres, or "at", a hand-picked spot [x, y] in the local frame.
  // "top" frames a lower part than the label's top (metres above the ground): a theatre's front rather than the tower behind it.
  function standFor(lm, dbg = null) {
    const spec = ((scene.city && scene.city.arrivals) || {})[lm.name] || {};
    const [x, y] = lm.at, g = groundZ(x, y) ?? Math.max(0, nav.terrain(x, y)), top = spec.top ? g + spec.top : lm.top ?? g + 20, tall = Math.max(10, top - g);
    const reach = [];
    for (let i = 0; i < 16; i++) { // how far its high part runs out from the label, each way; the median of that
      const a = i / 16 * Math.PI * 2, ux = Math.sin(a), uy = Math.cos(a);
      let last = 0;
      for (let r = 0; r <= 220; r += 4) { if (dsmAt(x + ux * r, y + uy * r) >= g + tall * 0.3) last = r; else if (r - last > 12 && (last || r > 40)) break; } // a street ends it
      reach.push(last);
    }
    const R = reach.sort((a, b) => a - b)[8];
    const D = spec.dist || THREE.MathUtils.clamp(Math.max(tall * 1.4, R * 2.2 + 40), 45, 520);
    // off its front: 0 straight in front, rising to 0.45 at the edge of the arc, and out of it altogether beyond
    const arc = (spec.arc ?? 70) * Math.PI / 180, front = spec.front != null ? spec.front * Math.PI / 180 : null;
    const aside = (px, py) => {
      if (front == null) return 0;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(px - x, py - y) - front), Math.cos(Math.atan2(px - x, py - y) - front)));
      return off > arc ? Infinity : 0.45 * (1 - Math.cos(off)) / (1 - Math.cos(arc));
    };
    const day = sun && sun.altitude > 2, sx = day ? Math.sin(sun.azimuth * Math.PI / 180) : 0, sy = day ? Math.cos(sun.azimuth * Math.PI / 180) : 0;
    const body = bodyOf(lm, g, top);
    // what the camera behind you sees of the landmark from a spot (px, py, pz), facing it: the share of its body
    // in frame and in sight (through the surface model, and the tree crowns when asked), how much was cut off
    // by the frame's edges (and of its upper third off the top), and how much of the frame's height the part in
    // sight fills. The camera stands where the chase rig puts it: 7.5 m behind your head, a little to the side, at
    // the pitch (and the tilt up) that takes in its top.
    const aspect = Math.max(0.4, camera.aspect || 1.6), tanV = Math.tan(BASE_FOV / 2 * Math.PI / 180), tanH = tanV * aspect;
    const view = (px, py, pz, crowns, fixed = null) => {
      const face = Math.atan2(x - px, y - py), yaw = face + 0.12, hz = pz + 1.55;
      let el = -Infinity; // the highest point of it, seen from your head, sets the pitch: its top a little under the frame's top edge
      for (const q of body.pts) el = Math.max(el, Math.atan2(q[2] - hz, Math.max(1, Math.hypot(q[0] - px, q[1] - py) + 7.5)));
      // a camera under your head would be in the ground: it stays a little over it and tilts up instead (cam.tilt),
      // as far as keeps you in the frame
      const want = fixed ?? Math.atan(tanV * 0.78) - el, pitch = THREE.MathUtils.clamp(want, 0.06, 0.16), tilt = THREE.MathUtils.clamp(pitch - want, 0, 0.26);
      const cp = Math.cos(pitch), cx = px - Math.sin(yaw) * cp * 7.5, cy = py - Math.cos(yaw) * cp * 7.5;
      const cz = Math.max(hz + Math.sin(pitch) * 7.5, Math.max(0, nav.terrain(cx, cy)) + 0.5);
      const he = Math.atan2(hz - cz, Math.hypot(px - cx, py - cy)) + tilt, hh = Math.atan2(px - cx, py - cy);
      const fx = Math.sin(hh) * Math.cos(he), fy = Math.cos(hh) * Math.cos(he), fz = Math.sin(he);
      let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl; // right, level
      const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx; // up = right x forward
      let seen = 0, cut = 0, lo = Infinity, hi = -Infinity, over = 0;
      for (let k = 0; k < body.pts.length; k++) {
        const q = body.pts[k], wk = body.w[k], dx = q[0] - cx, dy = q[1] - cy, dz = q[2] - cz, zf = dx * fx + dy * fy + dz * fz;
        if (zf < 2) { cut += wk; if (q[2] >= body.high) over++; continue; }
        const u = (dx * rx + dy * ry) / (zf * tanH), v = (dx * ux + dy * uy + dz * uz) / (zf * tanV);
        if (q[2] >= body.high && v > 0.97) over++; // its upper part off the top of the frame, hidden or not
        if (!sightTo(cx, cy, cz, q, body, crowns)) continue;
        if (Math.abs(u) > 0.97 || Math.abs(v) > 0.97) { cut += wk; continue; }
        seen += wk; lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      const n = body.wSum;
      return { face, pitch, tilt, seen: seen / n, cut: cut / n, over: over / body.nHigh, fill: seen ? (hi - lo) / 2 : 0 };
    };
    // the score of a view: most of it in sight, filling a good part of the frame and not cut off, and the sun behind you
    const rate = (v, px, py) => 1.6 * v.seen + 0.5 * Math.min(1, v.fill / 0.45) - v.cut - 1.2 * v.over
      + (day ? 0.2 * Math.max(0, -((x - px) * sx + (y - py) * sy) / Math.hypot(x - px, y - py)) : 0);
    if (spec.at) { // a hand-picked spot: on it (or the nearest ground to it), facing the landmark
      const p = placeNear(spec.at[0], spec.at[1], Number.isFinite(spec.at[2]) ? spec.at[2] : null, null, 12);
      if (p) { const v = view(p[0], p[1], p[2], true); return { x: p[0], y: p[1], z: p[2], face: v.face, pitch: v.pitch, tilt: v.tilt }; }
    }
    // room for the chase camera behind you: the line from your head to where it will stand, as the rig tests it
    const room = f => {
      const yaw = f.face + 0.12, cp = Math.cos(f.pitch), hd = W(f.x, f.y, f.z + 1.55), cx = f.x - Math.sin(yaw) * cp * 7.5, cy = f.y - Math.cos(yaw) * cp * 7.5;
      const leafy = (qx, qy) => treesNear(qx, qy, 0).some(t => Math.hypot(t[0] - qx, t[1] - qy) < t[3] * 0.7);
      if (leafy(cx, cy) || leafy((cx + f.x) / 2, (cy + f.y) / 2)) return 0.5; // the camera in a crown: leaves across the lens
      return nav.clearFraction(hd, new THREE.Vector3(cx, hd.y + Math.sin(f.pitch) * 7.5, -cy));
    };
    // open ground round a spot (a square, a park, the waterfront rather than a lane): the share of rings 6 and 14 m out with nothing over 3 m on them
    const open = p => { let n = 0; for (const r of [6, 14]) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; if (dsmAt(p[0] + Math.sin(a) * r, p[1] + Math.cos(a) * r) < p[2] + 3) n++; } return n / 32; };
    const cands = [];
    // rings from close under it, looking up, to well back: what the camera sees decides, not the distance
    for (const k of spec.dist ? [1, 0.75, 1.3] : [1, 0.45, 0.7, 1.35]) for (let i = 0; i < 16; i++) {
      const a = (i + (k === 1 || k === 0.45 ? 0 : 0.5)) / 16 * Math.PI * 2, px = x + Math.sin(a) * D * k, py = y + Math.cos(a) * D * k, pz = nav.terrain(px, py);
      if (!inFrame(px, py) || pz <= -0.5 || aside(px, py) === Infinity || Math.hypot(px - x, py - y) < 25) continue;
      if (dsmAt(px, py) > Math.max(0, pz) + 3) continue; // inside a building
      cands.push({ px, py, score: rate(view(px, py, Math.max(0, pz), false), px, py) - 0.08 * Math.abs(k - 1) - aside(px, py) - 3 * hazeAt(px, py) });
    }
    cands.sort((a, b) => b.score - a.score);
    // the rig lifts a camera that a wall or the ground in front of it would block, looking down more: the view it will have
    const rig = (p, v) => {
      const hd = W(p[0], p[1], p[2] + 1.55), yaw = v.face + 0.12;
      for (const lift of [0, 0.25, 0.5, 0.8]) {
        const pt = Math.min(1.35, v.pitch + lift), cp = Math.cos(pt);
        const pos = new THREE.Vector3(hd.x - Math.sin(yaw) * cp * 7.5, hd.y + Math.sin(pt) * 7.5, hd.z + Math.cos(yaw) * cp * 7.5);
        if (nav.clearFraction(hd, pos) >= 0.97) return lift ? Object.assign(view(p[0], p[1], p[2], true, pt), { pitch: v.pitch, tilt: v.tilt }) : v;
      }
      return v;
    };
    const judge = p => {
      const v = rig(p, view(p[0], p[1], p[2], true)), f = { x: p[0], y: p[1], z: p[2], face: v.face, pitch: v.pitch, tilt: v.tilt }, rm = room(f);
      const fl = nav.floorAt(p[0], p[1], p[2] + 0.5), roof = fl && fl.kind === 'roof' ? 0.4 : 0; // the street rather than a roof level with it
      // out from under a walkway, a flyover or an overhang, for you and for the camera behind you
      const bx = p[0] - Math.sin(f.face + 0.12) * 7, by = p[1] - Math.cos(f.face + 0.12) * 7;
      const covered = (dsmAt(p[0], p[1]) > p[2] + 4 ? 0.6 : 0) + (dsmAt(bx, by) > p[2] + 4 ? 0.6 : 0);
      const score = rate(v, p[0], p[1]) + (rm > 0.97 ? 0.3 : rm === 0.5 ? -0.3 : -1) + 0.8 * open(p) - roof - covered - aside(p[0], p[1]) - 3 * hazeAt(p[0], p[1]);
      if (dbg) dbg.push({ p: p.map(v => Math.round(v)), seen: +v.seen.toFixed(2), cut: +v.cut.toFixed(2), over: +v.over.toFixed(2), fill: +v.fill.toFixed(2), room: +rm.toFixed(2), open: +open(p).toFixed(2), score: +score.toFixed(2) });
      return { f, score, rm, seen: v.seen };
    };
    // none of the rings sees much of it (a short building among towers): every open spot on a grid round it, once
    const grid = () => {
      if (best && best.seen >= 0.6) return [];
      const step = Math.max(10, D / 10), out = [];
      for (let gx = x - D * 1.6; gx <= x + D * 1.6; gx += step) for (let gy = y - D * 1.6; gy <= y + D * 1.6; gy += step) {
        const d = Math.hypot(gx - x, gy - y), pz = nav.terrain(gx, gy);
        if (d < 25 || d > D * 1.6 || !inFrame(gx, gy) || pz <= -0.5 || aside(gx, gy) === Infinity || dsmAt(gx, gy) > Math.max(0, pz) + 3) continue;
        out.push({ px: gx, py: gy, score: rate(view(gx, gy, Math.max(0, pz), false), gx, gy) - 3 * hazeAt(gx, gy) });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, 12);
    };
    let best = null;
    for (let pass = 0; pass < 2; pass++) for (const c of pass ? grid() : cands.slice(0, 24)) {
      const p = placeNear(c.px, c.py, null, null, 12);
      if (!p) continue;
      let j = judge(p);
      // a wall or a crown behind you: a few steps either side, or nearer or further, may clear it
      if (j.rm <= 0.97) {
        const ux = (x - p[0]) / Math.hypot(x - p[0], y - p[1]), uy = (y - p[1]) / Math.hypot(x - p[0], y - p[1]);
        for (const [s, t] of [[6, 0], [-6, 0], [0, 8], [0, -8], [12, 0], [-12, 0]]) {
          const q = placeNear(p[0] + uy * s + ux * t, p[1] - ux * s + uy * t, null, null, 3);
          if (q) { const k = judge(q); if (k.score > j.score) j = k; }
        }
      }
      if (!best || j.score > best.score) best = j;
    }
    if (best) return best.f;
    const p = placeNear(x, y, null, null, 150); // at its foot, or the nearest ground to it
    if (!p) return null;
    const v = view(p[0], p[1], p[2], false);
    return { x: p[0], y: p[1], z: p[2], face: v.face, pitch: v.pitch, tilt: v.tilt };
  }
  // the landmark's body, as points to look at: the cells of the surface model its buildings cover (those named
  // after it, or the one under its label), their tops and, along their edges, their walls; for a landmark the
  // surface model leaves out (an open iron tower), a column at its label. Cut at its "top" when a city.json
  // "arrivals" entry gives one.
  const bodies = new Map();
  function bodyOf(lm, g, top) {
    if (bodies.has(lm.name)) return bodies.get(lm.name);
    const [x, y] = lm.at, C = DSM.cell, rad = 250, c0 = Math.floor((x - DSM.x0) / C), r0 = Math.floor((DSM.y1 - y) / C), n = Math.ceil(rad / C);
    // named after it: the label's name, or the start of it ("Kabuki-za" of "Kabuki-za 歌舞伎座"), or any word of it in
    // another script ("歌舞伎座"), whole; not a longer name that starts the same ("Town Hall Station" for "Town Hall")
    const toks = lm.name.toLowerCase().split(/\s+/), cjk = t => /[^\x00-\x7f]/.test(t), lead = toks.slice(0, Math.max(1, toks.findIndex(cjk))).join(' ');
    const words = new Set([lm.name.toLowerCase(), toks.some(cjk) ? lead : '', ...toks.filter(t => cjk(t) && t.length > 1)].filter(Boolean));
    // or a name that ends in the label's words after a place's ("Tsim Sha Tsui Clock Tower" for "Clock Tower")
    const tail = ' ' + lm.name.toLowerCase();
    const named = id => { const m = B.b[id] && B.b[id][0] && B.b[id][0].toLowerCase(); return !!m && m.length > 1 && (words.has(m) || m.endsWith(tail)); };
    const ids = new Set(), near = new Map(), tall = new Set();
    for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
      if (r < 0 || c < 0 || r >= DSM.ny || c >= DSM.nx) continue;
      const id = DSM.ids[r * DSM.nx + c];
      if (id < 0) continue;
      const d = Math.hypot(c - c0, r - r0) * C;
      if (d < 150 && named(id)) ids.add(id);
      if (d < 16 && DSM.data[r * DSM.nx + c] > g + Math.min(8, (top - g) * 0.3)) near.set(id, (near.get(id) || 0) + 1);
      if (d < 40 && DSM.data[r * DSM.nx + c] >= g + (top - g) * 0.6) tall.add(id); // its high part, whatever building the cells were drawn for
    }
    // a landmark found by its name keeps to it and its unnamed parts: a neighbour named for something else is not
    // its high part (Hong Kong's Cultural Centre behind the Clock Tower), and framing both crops a phone's narrow view
    const byName = ids.size > 0;
    if (!ids.size && near.size) { const most = Math.max(...near.values()); for (const [id, k] of near) if (k >= most * 0.3) ids.add(id); }
    for (const id of tall) if (!byName || !(B.b[id] && B.b[id][0] && B.b[id][0].length > 1)) ids.add(id);
    const cells = [];
    for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
      if (r < 1 || c < 1 || r >= DSM.ny - 1 || c >= DSM.nx - 1) continue;
      const i = r * DSM.nx + c;
      if (ids.has(DSM.ids[i]) && DSM.data[i] > g + 2) cells.push([r, c, i]);
    }
    const pts = [], stride = Math.max(1, Math.ceil(Math.sqrt(cells.length / 90)));
    for (const [r, c, i] of cells) {
      const edge = !ids.has(DSM.ids[i - 1]) || !ids.has(DSM.ids[i + 1]) || !ids.has(DSM.ids[i - DSM.nx]) || !ids.has(DSM.ids[i + DSM.nx]);
      if (!edge && (r % stride || c % stride)) continue;
      if (edge && (r + c) % stride) continue;
      const px = DSM.x0 + (c + 0.5) * C, py = DSM.y1 - (r + 0.5) * C, h = Math.min(DSM.data[i], top);
      pts.push([px, py, h]);
      if (edge) for (const f of [0.25, 0.6]) pts.push([px, py, g + (h - g) * f]);
    }
    if (pts.length < 6) { pts.length = 0; ids.clear(); for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) for (const s of [-3, 3]) pts.push([x + s, y, g + (top - g) * f]); }
    // a part over its buildings that the surface model leaves out (HEP FIVE's wheel, a spire, an open iron tower on
    // a base): a column at its label up to its top, as many points as the buildings have, so it counts as much
    const hi = pts.reduce((m, q) => Math.max(m, q[2]), g);
    if (top > hi + Math.max(8, (top - g) * 0.15) && ids.size) { const k = Math.max(6, pts.length); for (let i = 0; i < k; i++) pts.push([x + (i % 2 ? 3 : -3), y, hi + (top - hi) * (i + 1) / k, 1]); } // over them: their roofs hide it
    // its upper third, which a frame cut off at the top loses first
    const zs = pts.map(q => q[2]).sort((a, b) => a - b), zTop = zs[zs.length - 1], high = g + (zTop - g) * 0.67;
    // each point weighs by its height: a tower is known by its upper floors, the podium round its foot is not
    const w = pts.map(q => 0.3 + Math.max(0, q[2] - g) / Math.max(1, zTop - g)), wSum = w.reduce((a, v) => a + v, 0);
    const b = { ids, pts, w, wSum, high, nHigh: Math.max(1, pts.filter(q => q[2] >= high).length) };
    bodies.set(lm.name, b);
    return b;
  }
  // how much of a landmark the camera sees now: the share of its body in frame and in sight (for tools/travel_shot.js)
  function seenNow(lm) {
    const spec = ((scene.city && scene.city.arrivals) || {})[lm.name] || {}, [x, y] = lm.at, g = groundZ(x, y) ?? Math.max(0, nav.terrain(x, y));
    const body = bodyOf(lm, g, spec.top ? g + spec.top : lm.top ?? g + 20), c = camera.position, v = new THREE.Vector3();
    camera.updateMatrixWorld();
    let n = 0;
    body.pts.forEach((q, k) => {
      v.copy(W(q[0], q[1], q[2])).project(camera);
      if (Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.97 && v.z < 1 && sightTo(c.x, -c.z, c.y, q, body, true)) n += body.w[k];
    });
    return n / body.wSum;
  }
  // a clear line from the camera (cx, cy, cz) to a point of a landmark's body: through the surface model in 2 m
  // steps until it meets the body itself (a wall of it in front of the point counts as seen, but not in front of
  // a point of the part over its roofs), and through the mapped tree crowns when asked
  function sightTo(cx, cy, cz, q, body, crowns) {
    const d = Math.hypot(q[0] - cx, q[1] - cy), n = Math.max(1, Math.ceil(d / 2));
    for (let k = 1; k < n; k++) {
      const t = k / n, qx = cx + (q[0] - cx) * t, qy = cy + (q[1] - cy) * t, line = cz + (q[2] - cz) * t;
      const c = Math.floor((qx - DSM.x0) / DSM.cell), r = Math.floor((DSM.y1 - qy) / DSM.cell);
      if (c < 0 || r < 0 || c >= DSM.nx || r >= DSM.ny) continue;
      const i = r * DSM.nx + c;
      if (DSM.data[i] > line + 0.5) return !q[3] && body.ids.has(DSM.ids[i]);
      if (crowns && k % 2 === 0 && d * (1 - t) > 6 && treesNear(qx, qy, 0).some(tr => tr[2] > line && Math.hypot(tr[0] - qx, tr[1] - qy) < tr[3] * 0.8)) return false;
    }
    return true;
  }
  // where a destination puts you: { x, y, z, face?, pitch? }, or null
  // a landmark that is a place to go up (an observation deck with its own lift, game.json "lifts", named for it):
  // its deck, where the city names a place to travel to up there (or else the lift's top stop), facing out from
  // its middle over the city; not a view of it from the street half a kilometre off
  function deckOf(lm) {
    const n = lm.name.toLowerCase(), l = lifts.find(l => l.stops.length > 1 && n.startsWith(l.name.toLowerCase()) && Math.hypot(l.stops[0].at[0] - lm.at[0], l.stops[0].at[1] - lm.at[1]) < 150);
    if (!l) return null;
    const g = Math.min(...l.stops.map(s => s.at[2]));
    const places = (G.travel || []).filter(t => t.at.length > 2 && t.at[2] > g + 60 && Math.hypot(t.at[0] - lm.at[0], t.at[1] - lm.at[1]) < 150).map(t => t.at);
    const stops = l.stops.filter(s => s.at[2] > g + 60).map(s => s.at);
    const all = [...places.sort((a, b) => b[2] - a[2]), ...stops.sort((a, b) => b[2] - a[2])];
    return all.length ? all : null;
  }
  // where on a deck you can stand: the first of its places with a floor at that level (not the street under it)
  function deckStand(decks) {
    for (const at of decks) { const p = placeNear(at[0], at[1], at[2], null, 45); if (p && Math.abs(p[2] - at[2]) < 6) return p; }
    return null;
  }
  // on a deck the chase camera looks down over the city past you, as you would at the glass (and under a deck's roof)
  const DECK_PITCH = 0.4;
  // the side of a deck that looks at the city: towards where the game starts (the heart of it: Shibuya's
  // scramble under SKY EDGE, Senso-ji from the Skytree), not over the edge of the map
  const heart = lm => { const dx = G.start.at[0] - lm.at[0], dy = G.start.at[1] - lm.at[1], n = Math.hypot(dx, dy); return n > 20 ? [dx / n, dy / n] : null; };
  const outward = (lm, p) => { const u = heart(lm); if (u) return Math.atan2(u[0], u[1]); const dx = p[0] - lm.at[0], dy = p[1] - lm.at[1]; return Math.hypot(dx, dy) > 2 ? Math.atan2(dx, dy) : null; };
  // a deck's spots, the one on its city side first: as far out from the landmark's middle as the deck's own spot is
  const facingSide = (lm, decks) => {
    const u = heart(lm);
    return u ? [...decks.map(at => { const r = Math.hypot(at[0] - lm.at[0], at[1] - lm.at[1]); return [lm.at[0] + u[0] * r, lm.at[1] + u[1] * r, at[2]]; }), ...decks] : decks;
  };
  function arrival(d) {
    const deck = d.kind === 'landmark' ? deckOf(d) : null;
    if (deck) {
      const p = deckStand(facingSide(d, deck));
      if (p) return { x: p[0], y: p[1], z: p[2], face: outward(d, p), pitch: DECK_PITCH };
    }
    if (d.kind === 'landmark') return standFor(d);
    if (d.kind === 'car' && myCar) {
      const st = myCar.D.st, dr = doorAt(myCar, 'driver'), p = placeNear(dr.x, dr.y, st.z + 0.5, carBoxes(st.x, st.y, 12));
      return p && { x: p[0], y: p[1], z: p[2], face: Math.atan2(st.x - p[0], st.y - p[1]), pitch: 0.24 };
    }
    const [x, y, z] = d.at, p = placeNear(x, y, Number.isFinite(z) ? z : null, null, d.kind === 'point' ? 150 : 45); // on a roof, or the ground
    if (!p) return null;
    // high up on a landmark (a deck the city names as a place): facing out over the city, as from its deck
    const lm = p[2] - Math.max(0, nav.terrain(p[0], p[1])) > 60 && landmarks.find(l => deckOf(l) && Math.hypot(l.at[0] - p[0], l.at[1] - p[1]) < 150);
    return lm ? { x: p[0], y: p[1], z: p[2], face: outward(lm, p), pitch: DECK_PITCH } : { x: p[0], y: p[1], z: p[2] };
  }
  function travelTo(d) { // a shot playing (the start, a survey) is skipped by the hop, which plays its cues
    if (!['foot', 'car', 'ride'].includes(player.mode)) {
      H.toast({ heli: 'Land and get out of the helicopter first, then travel from the map.', ferry: 'Get off the ferry first (E at a wharf), then travel from the map.', rail: 'Get off first, then travel from the map.' }[player.mode] || 'Not now.');
      return false;
    }
    const to = arrival(d);
    if (!to) { H.toast(`There is nowhere to stand near ${d.name}.`); return false; }
    $('#g-bigmap').hidden = true; mapPop.hidden = true; picked = null;
    if (player.auto) { const a = player.auto; player.auto = null; if (a.cancel) a.cancel(); }
    const was = player.mode, name = d.kind === 'point' ? 'your pin' : d.name;
    // in your car, the kerb nearest the spot, and the camera looking past the car at the landmark
    const kerb = was === 'car' && myCar ? kerbNear(to.x, to.y, to.z, 0) : null;
    // no street near the spot (the end of a pier): you go on foot, and the car waits on the nearest street there is
    const park = was === 'car' && myCar && !kerb ? kerbNear(to.x, to.y, null, 0, 1500) : null;
    const carYaw = kerb && (d.kind === 'landmark' ? Math.atan2(d.at[0] - kerb.pose.x, d.at[1] - kerb.pose.y) : to.face ?? kerb.pose.h);
    const cue = () => {
      if (kerb) { // the car comes too, facing along the street
        parkMyCar(kerb.pose);
        Object.assign(player, { x: kerb.pose.x, y: kerb.pose.y, z: kerb.pose.z, h: kerb.pose.h, speed: 0 });
        cam.mode = 'chase'; cam.yaw = carYaw; cam.pitch = Math.max(0.08, to.pitch ?? 0.2); cam.tilt = to.tilt || 0; cam.dist = 7.5;
        groundLod(kerb.pose.x, kerb.pose.y); save();
        return;
      }
      if (was === 'car' && myCar && player.mode === 'car') {
        stepOut(myCar, 'driver', [to.x, to.y, to.z]);
        if (park) { parkMyCar(park.pose); H.toast(`Your car is on the nearest street, ${fmtDist(Math.hypot(park.pose.x - to.x, park.pose.y - to.y))} away.`); }
      }
      if (was === 'ride' && ride && player.mode === 'ride') { stepOut(ride, kerbSeat, [to.x, to.y, to.z]); rideAway(); }
      [player.x, player.y, player.z] = [to.x, to.y, to.z];
      player.speed = 0; player.vz = 0; player.ground = true;
      if (to.face != null) player.h = to.face;
      cam.mode = 'chase'; cam.dist = 7.5;
      // the landmark a little left of the player rather than behind their head
      if (to.face != null) { cam.yaw = to.face + 0.12; cam.pitch = to.pitch ?? 0.3; cam.tilt = to.tilt || 0; } else { cam.yaw = player.h; cam.pitch = 0.36; cam.tilt = 0; }
      groundLod(to.x, to.y); save();
    };
    hopTo(kerb ? kerb.pose.x : to.x, kerb ? kerb.pose.y : to.y, kerb ? kerb.pose.z : to.z, name,
      { cue, yaw: kerb ? carYaw : to.face != null ? to.face + 0.12 : null, pitch: kerb ? Math.max(0.08, to.pitch ?? 0.2) : to.pitch });
    return true;
  }
  // everywhere the map offers, in groups, nearest first within a group except the landmarks (the city's own order)
  function travelGroups() {
    const quick = [];
    if (waypoint) quick.push({ kind: 'point', id: 'waypoint', name: 'Your waypoint', at: waypoint });
    if (myCar && player.mode !== 'car') quick.push({ kind: 'car', id: 'car', name: 'Your car', at: [myCar.D.st.x, myCar.D.st.y] });
    quick.push({ kind: 'start', id: 'start', name: 'Where you started', at: G.start.at });
    const near = l => l.sort((a, b) => Math.hypot(a.at[0] - player.x, a.at[1] - player.y) - Math.hypot(b.at[0] - player.x, b.at[1] - player.y));
    return [
      ['Places', (G.travel || []).map(t => ({ kind: 'place', id: t.id, name: t.name, at: t.at }))],
      ['Landmarks', landmarks],
      ['Trig stations', near(VP.map(v => ({ kind: 'trig', id: v.id, name: v.name, at: [v.x, v.y, v.z] })))],
      ['Ferry wharves', near(G.wharves.map(w => ({ kind: 'wharf', id: w.id, name: w.name, at: w.landing })))],
      ['Shortcuts', quick],
    ].filter(([, l]) => l.length);
  }
  const fmtDist = m => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
  let travelList = [];
  function renderTravel() {
    const groups = travelGroups(), key = groups.map(([t, l]) => `${t}:${l.map(d => `${d.id}@${Math.round(Math.hypot(d.at[0] - player.x, d.at[1] - player.y) / 50)}`).join(',')}`).join('|');
    if (key === travelKey) return;
    travelKey = key; travelList = [];
    $('#g-travel').innerHTML = groups.map(([title, list]) => `<li class="g-tgroup"><h4>${title}</h4><ul>${list.map(d => {
      travelList.push(d);
      return `<li><button data-k="${travelList.length - 1}"><span>${d.name}</span><span class="num">${fmtDist(Math.hypot(d.at[0] - player.x, d.at[1] - player.y))}</span></button></li>`;
    }).join('')}</ul></li>`).join('');
  }
  // the card over the map for a picked pin or spot: travel there, or set a waypoint
  function pick(d, cx, cy) {
    picked = d;
    $('#g-mappop-name').textContent = d.kind === 'point' ? 'Your pin' : d.name;
    const deck = d.kind === 'landmark' && deckOf(d) && deckStand(deckOf(d)), up = deck ? ` · travel takes you up to its deck, ${Math.round(deck[2] - Math.max(0, nav.terrain(deck[0], deck[1])))} m up` : '';
    $('#g-mappop-note').textContent = `${{ landmark: 'Landmark', place: 'Place', trig: 'Trig station', wharf: 'Ferry wharf', car: 'Your car', start: 'Where you started', point: 'Waypoint set' }[d.kind] || ''} · ${fmtDist(Math.hypot(d.at[0] - player.x, d.at[1] - player.y))} away${up}`;
    $('#g-mappop-way').hidden = d.kind === 'point';
    mapPop.hidden = false;
    placePop(cx, cy);
    $('#g-mappop-go').focus({ preventScroll: true });
  }
  function placePop(cx, cy) {
    const box = bigCanvas.getBoundingClientRect(), w = mapPop.offsetWidth, h = mapPop.offsetHeight;
    mapPop.style.left = `${Math.max(6, Math.min(box.width - w - 6, cx - w / 2))}px`;
    mapPop.style.top = `${cy - h - 14 > 6 ? cy - h - 14 : Math.min(box.height - h - 6, cy + 14)}px`;
  }
  // the map's zoom (1: the whole city fits) and the base-map pixel at its centre, kept while the map is closed;
  // the names are laid out afresh at each zoom, so the ones crowded out come back as you zoom in
  const mapZ = { z: 1, cx: null, cy: null }, touches = new Map();
  let mapDrag = null, dragged = false, bigNames = []; // a pan under way, and whether the press that ends it moved (then it is no click)
  const mapZMax = () => Math.max(4, 2 / (bigView ? bigView.fit : 0.25)); // up to about a metre a screen pixel
  function drawBig() {
    const box = bigCanvas.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(box.width * dpr), ch = Math.round(box.height * dpr);
    if (bigCanvas.width !== cw || bigCanvas.height !== ch) { bigCanvas.width = cw; bigCanvas.height = ch; }
    const bw = base.canvas.width, bh = base.canvas.height, fit = Math.min(cw / bw, ch / bh);
    mapZ.z = THREE.MathUtils.clamp(mapZ.z, 1, Math.max(4, 2 / fit));
    const g = bigCanvas.getContext('2d'), s = fit * mapZ.z;
    // the centre held where the map still fills the frame on that axis (or centred where it is narrower)
    const half = (c, n, full) => (n * s <= full ? n / 2 : THREE.MathUtils.clamp(c ?? n / 2, full / s / 2, n - full / s / 2));
    mapZ.cx = half(mapZ.cx, bw, cw); mapZ.cy = half(mapZ.cy, bh, ch);
    const ox = cw / 2 - mapZ.cx * s, oy = ch / 2 - mapZ.cy * s;
    bigView = { s, ox, oy, dpr, fit };
    g.clearRect(0, 0, bigCanvas.width, bigCanvas.height);
    g.drawImage(base.canvas, ox, oy, base.canvas.width * s, base.canvas.height * s);
    const P2 = (x, y) => [ox + base.X(x) * s, oy + base.Y(y) * s];
    g.lineWidth = 2 * dpr;
    for (const r of G.ferries) { g.strokeStyle = 'rgba(30,91,58,0.75)'; g.setLineDash([6 * dpr, 4 * dpr]); for (const l of r.legs) { g.beginPath(); l.path.forEach((p, i) => { const [x, y] = P2(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); } }
    g.setLineDash([]);
    const way = guide.pts && gold.ahead(); // the gold route still to go, as on the minimap and in the world
    if (way && way.length > 1) {
      g.save(); g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--sun') || '#ffc23d'; g.lineWidth = 3.5 * dpr; g.lineJoin = g.lineCap = 'round';
      g.beginPath(); way.forEach((p, i) => { const [x, y] = P2(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.restore();
    }
    g.save(); g.scale(dpr, dpr);
    bigPins = [];
    const marks = []; // every icon drawn, which the names keep clear of
    const icon = (ic, x, y, d) => { H.drawIcon(g, ic, x / dpr, y / dpr); marks.push([x / dpr - 7, y / dpr - 7, x / dpr + 7, y / dpr + 7]); if (d) bigPins.push({ x: x / dpr, y: y / dpr, d }); };
    // the landmarks and travel points; their names go on last, over everything but the player, the city's first
    // ones first, each beside its pin where it covers no other pin or name (else left off: a pin names itself when picked)
    const named = [...(G.travel || []).map(t => ({ kind: 'place', id: t.id, name: t.name, at: t.at })), ...landmarks];
    for (const d of named) icon({ kind: d.kind }, ...P2(d.at[0], d.at[1]), d);
    for (const w of G.wharves) icon({ kind: 'wharf' }, ...P2(...w.terminal), { kind: 'wharf', id: w.id, name: w.name, at: w.landing });
    for (const h of G.helipads) icon({ kind: 'pad' }, ...P2(h.at[0], h.at[1]));
    for (const v of VP) icon({ kind: 'trig', done: !!trigDone()[v.id] }, ...P2(v.x, v.y), { kind: 'trig', id: v.id, name: v.name, at: [v.x, v.y, v.z] });
    for (const f of flocks) icon({ kind: 'gull' }, ...P2(f.at[0], f.at[1]));
    for (const v of fer.vessels) icon({ kind: 'ferry' }, ...P2(v.x, v.y));
    if (player.mode !== 'heli') icon({ kind: 'heli' }, ...P2(heli.st.x, heli.st.y));
    if (myCar && player.mode !== 'car') icon({ kind: 'car' }, ...P2(myCar.D.st.x, myCar.D.st.y), { kind: 'car', id: 'car', name: 'Your car', at: [myCar.D.st.x, myCar.D.st.y] });
    if (ride && ride.phase !== 'leaving') {
      const st = ride.drv.st, P = ride.drv.path;
      if (ride.phase === 'coming' || ride.phase === 'driving') {
        g.restore(); H.rideLine(g, [[st.x, st.y]].concat(P.pts.slice(P.pos(st.s, {}).i + 1)), x => P2(x, 0)[0], y => P2(0, y)[1], dpr); g.save(); g.scale(dpr, dpr);
      }
      if (ride.phase === 'coming' || ride.phase === 'waiting') icon({ kind: 'pickup' }, ...P2(ride.pickup.x, ride.pickup.y));
      if (player.mode !== 'ride') icon({ kind: 'ridecar', rot: st.h }, ...P2(st.x, st.y));
    }
    for (const n of npcs) icon({ kind: 'npc', color: wantsTalk(n) ? '#e0a21a' : '#5b6b77', label: n.name[0] }, ...P2(n.x, n.y));
    for (const o of sideObjectives()) icon({ kind: 'quest2' }, ...P2(...o.at));
    const ob = objective();
    if (ob && ob.at) icon({ kind: 'quest' }, ...P2(...ob.at));
    if (waypoint) icon({ kind: 'waypoint' }, ...P2(...waypoint));
    const [px, py] = P2(player.mode === 'heli' ? heli.st.x : player.mode === 'ferry' ? player.vehicle.x : player.x, player.mode === 'heli' ? heli.st.y : player.mode === 'ferry' ? player.vehicle.y : player.y);
    // the city's first five landmarks are named over anything but another pin; the rest keep clear of every icon,
    // and a landmark is named before a travel place, which the list beside the map names too
    const me = [px / dpr - 11, py / dpr - 11, px / dpr + 11, py / dpr + 11], pinBox = bigPins.map(q => [q.x - 7, q.y - 7, q.x + 7, q.y + 7]);
    const taken = marks.concat([me]), first = new Set(landmarks.slice(0, 5)), firstTaken = pinBox.concat([me]);
    g.font = '600 11px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const said = []; // pins already named: a place and a landmark on the same spot take one name
    const rank = q => (first.has(q.d) ? 2 : q.d.kind === 'landmark' ? 1 : 0); // then the landmarks, then the travel places
    for (const q of bigPins.slice().sort((a, b) => rank(b) - rank(a))) {
      if ((q.d.kind !== 'landmark' && q.d.kind !== 'place') || said.some(o => Math.hypot(o.x - q.x, o.y - q.y) < 16)) continue;
      const w = g.measureText(q.d.name).width;
      // right, left, above or below its pin: [text x, text y, align]
      for (const [tx, ty, al] of [[q.x + 10, q.y, 'left'], [q.x - 10, q.y, 'right'], [q.x, q.y - 15, 'center'], [q.x, q.y + 15, 'center']]) {
        const x0 = al === 'left' ? tx - 1 : al === 'right' ? tx - w - 2 : tx - w / 2 - 2, r = [x0, ty - 7, x0 + w + 3, ty + 7];
        if (r[0] < 2 || r[2] > box.width - 2 || r[1] < 2 || r[3] > box.height - 2 || (first.has(q.d) ? firstTaken : taken).some(t => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1])) continue;
        taken.push(r); firstTaken.push(r); said.push(q);
        g.textAlign = al;
        g.strokeStyle = 'rgba(6, 10, 18, 0.82)'; g.lineWidth = 3.2; g.strokeText(q.d.name, tx, ty);
        g.fillStyle = q.d.kind === 'place' ? '#ffd9a8' : '#f4efe6'; g.fillText(q.d.name, tx, ty);
        break;
      }
    }
    bigNames = said.map(q => q.d.name);
    g.translate(px / dpr, py / dpr); g.rotate(player.mode === 'heli' ? heli.st.h : player.h);
    g.fillStyle = '#ffffff'; g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg'); g.lineWidth = 2; // white on the gold route
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    zoomUi();
    if (picked && !mapPop.hidden) { // the card follows its place as the map moves, and goes when it leaves the frame
      const q = picked.kind === 'point' ? waypoint || picked.at : picked.at, [cx, cy] = P2(q[0], q[1]);
      if (cx < 0 || cy < 0 || cx > cw || cy > ch) { mapPop.hidden = true; picked = null; } else placePop(cx / dpr, cy / dpr);
    }
    renderTravel();
  }
  // a click picks the pin under it, or drops a waypoint there; a double click travels at once
  const mapHit = e => {
    if (!bigView) return null;
    const r = bigCanvas.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top, reach = touch ? 22 : 14;
    let best = null, bd = reach;
    for (const p of bigPins) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = p; } }
    const bx = (cx * bigView.dpr - bigView.ox) / bigView.s, by = (cy * bigView.dpr - bigView.oy) / bigView.s;
    return { cx, cy, pin: best, at: [scene.frame.x[0] + bx * base.PX, scene.frame.y[1] - by * base.PX] };
  };
  // zoom about a point of the canvas (CSS pixels; its centre if none), keeping the spot under it in place
  let mapRaf = 0;
  const redrawBig = () => { if (!mapRaf) mapRaf = requestAnimationFrame(() => { mapRaf = 0; if (!$('#g-bigmap').hidden) drawBig(); }); };
  function zoomMap(k, sx, sy) {
    if (!bigView) return;
    const r = bigCanvas.getBoundingClientRect(), { s, ox, oy, dpr } = bigView;
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const z = THREE.MathUtils.clamp(mapZ.z * k, 1, mapZMax()), s2 = bigView.fit * z;
    const bx = (sx * dpr - ox) / s, by = (sy * dpr - oy) / s; // the base-map pixel under the point
    mapZ.z = z; mapZ.cx = bx - (sx * dpr - bigCanvas.width / 2) / s2; mapZ.cy = by - (sy * dpr - bigCanvas.height / 2) / s2;
    redrawBig();
  }
  const panMap = (dx, dy) => { if (!bigView) return; mapZ.cx -= dx * bigView.dpr / bigView.s; mapZ.cy -= dy * bigView.dpr / bigView.s; redrawBig(); };
  function zoomUi() {
    const z = $('#g-mapzoom');
    if (!z) return;
    z.querySelector('[data-z="in"]').disabled = mapZ.z >= mapZMax() - 1e-3;
    z.querySelector('[data-z="out"]').disabled = z.querySelector('[data-z="fit"]').disabled = mapZ.z <= 1 + 1e-3;
    bigCanvas.style.cursor = mapDrag && mapDrag.moved ? 'grabbing' : mapZ.z > 1 + 1e-3 ? 'grab' : '';
  }
  // the wheel (or a trackpad's pinch, which comes as a wheel with ctrl) zooms; a drag pans; two fingers pinch and pan
  on(bigCanvas, 'wheel', e => {
    e.preventDefault();
    const r = bigCanvas.getBoundingClientRect(), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    zoomMap(Math.exp(-THREE.MathUtils.clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  on(bigCanvas, 'pointerdown', e => {
    if (e.button > 0) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    try { bigCanvas.setPointerCapture(e.pointerId); } catch (err) { /* the pointer went already */ }
    if (touches.size === 1) { mapDrag = { x: e.clientX, y: e.clientY, moved: false }; dragged = false; } else mapDrag = { pinch: true, moved: true };
  });
  on(bigCanvas, 'pointermove', e => {
    const was = touches.get(e.pointerId);
    if (!was || !mapDrag) return;
    if (touches.size >= 2) {
      const [a, b] = [...touches.values()], other = a === was ? b : a;
      const d0 = Math.hypot(was[0] - other[0], was[1] - other[1]), d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      const r = bigCanvas.getBoundingClientRect(), mx = (e.clientX + other[0]) / 2 - r.left, my = (e.clientY + other[1]) / 2 - r.top;
      panMap((e.clientX - was[0]) / 2, (e.clientY - was[1]) / 2);
      if (d0 > 8) zoomMap(d1 / d0, mx, my);
      dragged = true;
    } else {
      if (!mapDrag.moved && Math.hypot(e.clientX - mapDrag.x, e.clientY - mapDrag.y) > (touch ? 9 : 5)) mapDrag.moved = dragged = true;
      if (mapDrag.moved) panMap(e.clientX - was[0], e.clientY - was[1]);
    }
    touches.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const lift = e => { touches.delete(e.pointerId); if (!touches.size) { mapDrag = null; zoomUi(); } else if (touches.size === 1) { const [p] = touches.values(); mapDrag = { x: p[0], y: p[1], moved: true }; } };
  on(bigCanvas, 'pointerup', lift);
  on(bigCanvas, 'pointercancel', lift);
  on($('#g-mapzoom'), 'click', e => {
    const b = e.target.closest('button[data-z]');
    if (!b) return;
    if (b.dataset.z === 'fit') { mapZ.z = 1; mapZ.cx = mapZ.cy = null; redrawBig(); } else zoomMap(b.dataset.z === 'in' ? 2 : 0.5);
  });
  on(bigCanvas, 'click', e => {
    if (dragged) { dragged = false; return; } // the end of a drag or a pinch is not a pick
    const h = mapHit(e);
    if (!h) return;
    if (h.pin) { pick(h.pin.d, h.pin.x, h.pin.y); return; }
    waypoint = h.at;
    drawBig();
    pick({ kind: 'point', id: 'waypoint', name: 'Your waypoint', at: waypoint }, h.cx, h.cy);
  });
  on(bigCanvas, 'dblclick', e => { if (dragged) return; const h = mapHit(e); if (h) travelTo(h.pin ? h.pin.d : { kind: 'point', id: 'waypoint', name: 'Your waypoint', at: waypoint || h.at }); });
  on($('#g-mappop-go'), 'click', () => { if (picked) travelTo(picked); });
  on($('#g-mappop-way'), 'click', () => { if (!picked) return; waypoint = picked.at.slice(0, 2); mapPop.hidden = true; picked = null; travelKey = ''; drawBig(); H.toast(routeMode === 'on' ? 'Waypoint set. Follow the gold route there.' : 'Waypoint set. Its route is on the minimap; <kbd>L</kbd> shows it in the world.'); });
  on($('#g-travel'), 'click', e => { const b = e.target.closest('button[data-k]'); if (b && travelList[+b.dataset.k]) travelTo(travelList[+b.dataset.k]); });
  $('#g-bigmap header .note').textContent = touch ? 'Tap a place to travel there · pinch to zoom' : 'Pick a place to travel there · double-click to go at once · scroll to zoom, drag to pan';
  on($('#g-map-btn'), 'click', toggleMap);
  on($('#gq-lines'), 'click', e => { const b = e.target.closest('button'); if (b) cycleTrack(b.dataset.line); });
  on($('#g-pass-btn'), 'click', togglePass);
  on($('#g-menu-btn'), 'click', toggleMenu);
  for (const id of ['#g-bigmap-close', '#g-pass-close', '#g-menu-close']) on($(id), 'click', () => { $(id).closest('.g-overlay').hidden = true; });
  on($('#gm-time'), 'click', e => { const b = e.target.closest('button'); if (b) { presetTime(b.dataset.t); menuSync(); H.toast(`Time: ${b.dataset.label || b.textContent}, ${fmtMin(clock.min)}`); } });
  on($('#gm-clock'), 'input', e => { setClock(clock.y, clock.m, clock.d, +e.target.value); menuSync(); });
  on($('#gm-date'), 'change', e => { const [y, m, d] = e.target.value.split('-').map(Number); if (y && m && d) { setClock(y, m, d, clock.min); menuSync(); } });
  on($('#gm-speed'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    clock.frozen = b.dataset.s === '0'; if (!clock.frozen) clock.scale = +b.dataset.s;
    $$('#gm-speed button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    applySun();
  });
  on($('#gm-density'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.density = b.dataset.d;
    applyDensity(); cars.active = Math.round(cars.C.length * density[b.dataset.d]);
    $$('#gm-density button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  on($('#gm-route'), 'click', e => { const b = e.target.closest('button'); if (b) setRouteMode(b.dataset.r); });
  on($('#gm-weather'), 'click', e => {
    const b = e.target.closest('button');
    if (!b || !weather) return;
    weather.set(b.dataset.w, { keep: true });
    menuSync();
    const s = weather.season(clock.y, clock.m, clock.d, clock.min);
    H.toast(b.dataset.w === 'live' ? `Weather as the season brings it: ${s.rain > 0.5 ? 'rain' : s.rain > 0.06 ? 'drizzle' : s.cloud > 0.6 ? 'overcast' : 'fair'} now` : `Weather: ${OEWeather.NAMES[b.dataset.w]}`);
  });
  setRouteMode(routeMode);
  on($('#gq-route'), 'click', e => { e.stopPropagation(); peekRoute(); });
  if (!lib) $('#gm-who').closest('.field').hidden = true;
  $$('#gm-who button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === playerChar)));
  on($('#gm-who'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setPlayerCharacter(b.dataset.c);
    $$('#gm-who button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  on($('#gm-sound'), 'change', e => A.setMuted(!e.target.checked));
  on($('#gm-intro'), 'click', () => { $('#g-menu').hidden = true; startTour(); });
  on($('#gm-reset'), 'click', () => {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    if ((player.mode === 'car' || player.mode === 'ride') && !stepOut(player.vehicle, player.mode === 'car' ? 'driver' : kerbSeat)) { player.vehicle.C.body.remove(player.rig.root); world.add(player.rig.root); player.rig.root.scale.setScalar(1); player.mode = 'foot'; player.vehicle = null; }
    if (ride) rideAway();
    qs = freshQs(); renderPassport(); spawn(); H.toast('A fresh start: a new passport.'); $('#g-menu').hidden = true;
  });

  // ------------------------------------------------------------ start
  // A city's opening shot (game.start.shot, #110): the title looks at shot.look (absolute, in metres) from behind
  // the start's view, and Play cranes down from there to over the player's shoulder in shot.dur seconds, the player
  // facing the start's way. At a scramble near the start (Shibuya's), its walk turns green shot.walk_in seconds into
  // the move, with the crowd gathered at its kerbs (musterScramble), so it is a few seconds into its walk, the crowd
  // stepping out round you, as control comes to you.
  const OPENING = G.start.shot ? (sh => ({ look: sh.look, dur: sh.dur || 4.2, walkIn: sh.walk_in ?? 2.2, sway: (sh.sway_deg ?? 8) * Math.PI / 180,
    face: Math.atan2((G.start.facing || [0, 1])[0] - G.start.at[0], (G.start.facing || [0, 1])[1] - G.start.at[1]), yaw: null, r: 470, h: 150 }))(G.start.shot) : null;
  // the title's view for the opening shot: from behind the start's view, turned by up to 30 degrees and raised
  // as far as it takes to see the screens clear of the towers in front of them (Shibuya's station towers)
  function openingView() {
    if (OPENING.yaw != null) return OPENING;
    const [lx, ly, lz] = OPENING.look;
    let best = null;
    for (const h of [150, 190, 240, 300]) for (let k = 0; k <= 12; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5 * Math.PI / 180, yaw = OPENING.face + off, r = 470;
      const cx = lx - Math.sin(yaw) * r, cy = ly - Math.cos(yaw) * r, cz = lz + h;
      let block = 0; // (over a fan of lines to points about the screens: the frame's middle open, not a slot between towers)
      for (const [u, w] of [[0, 0], [-90, 0], [90, 0], [-45, 40], [45, 40], [0, -15]]) {
        const tx = lx + Math.cos(yaw) * u, ty = ly - Math.sin(yaw) * u, tz = lz + w;
        for (let i = 1; i < 40; i++) { const t = i / 40, z = cz + (tz - cz) * t; block += Math.max(0, roofBelow(cx + (tx - cx) * t, cy + (ty - cy) * t) - z); }
      }
      const cost = block + h * 0.05 + Math.abs(off) * 20;
      if (!best || cost < best.cost) best = { cost, yaw, h };
    }
    return Object.assign(OPENING, { yaw: best.yaw, h: best.h });
  }
  const openingHere = () => !!OPENING && player.mode === 'foot' && Math.hypot(player.x - G.start.at[0], player.y - G.start.at[1]) < 8;
  // the crowd at a scramble near the player as its walk begins: a few at each kerb of every crosswalk, more at
  // the player's, ready to step out (the walkers farthest off are moved, out of sight)
  function musterScramble() {
    const j = junctions.J.find(q => q.scramble && Math.hypot(q.x - player.x, q.y - player.y) < 80);
    if (!j) return 0;
    const spots = [], tmp = {};
    for (const [line, xs] of crowd.crossings.byLine) for (const x of xs) {
      if (!x.scramble || x.a.j !== j) continue;
      for (const end of [-1, 1]) {
        const len = crowdNet.L[line].len, sk = Math.max(0, Math.min(len, x.s + end * x.kerb));
        crowdNet.at(line, sk, tmp);
        const mine = Math.hypot(tmp.x - player.x, tmp.y - player.y) < 6, n = mine ? 11 : 4;
        // behind the kerb, facing across; where the footway ends at the kerb, the first steps out onto the stripes
        const back = end > 0 ? len - sk : sk;
        for (let i = 0; i < n; i++) spots.push({ line, s: back > 1.5 ? sk + end * (0.3 + Math.random() * Math.min(back - 0.3, mine ? 3.5 : 2.5)) : sk - end * Math.random() * (mine ? 3 : 2), dir: -end, side: -1.6 + Math.random() * 3.6 });
      }
    }
    return crowd.muster(spots, player.x, player.y);
  }
  function spawn(pos, zRef) { // at ground level (or on steps built on it) unless a height is given
    const at = pos || G.start.at;
    let z0 = Math.max(0, nav.terrain(at[0], at[1]));
    for (const st of nav.strips) { const h = st.drape ? nav.stripHeight(st, at[0], at[1]) : null; if (h != null && h > z0) z0 = h; }
    // the nearest firm spot: not over the water or on the bank going down to it, not inside an NPC,
    // and not cut off (on a pier fragment below the quay, in a yard closed in by walls); at the start,
    // with a few steps clear towards the view (not at the very edge of the quay, facing the water)
    const fa = G.start.facing || [at[0], at[1] + 10];
    const ahead = (x, y) => {
      const h = Math.atan2(fa[0] - x, fa[1] - y), f = nav.floorAt(x, y, Math.max(zRef ?? z0 + 1, nav.terrain(x, y) + 1));
      let z = f ? f.z : 0;
      for (let d = 0.5; d <= 4 && f; d += 0.5) { const w = nav.walk(x + Math.sin(h) * d, y + Math.cos(h) * d, z); if (!w.ok) return false; z = w.z; }
      return !!f;
    };
    const ok = (x, y) => !npcs.some(n => Math.hypot(n.x - x, n.y - y) < 1.4), okStart = (x, y) => ok(x, y) && (pos || ahead(x, y));
    const p = nav.stand(at[0], at[1], zRef ?? z0 + 1, { ok: okStart, room: 100 }) || nav.stand(at[0], at[1], zRef ?? z0 + 1, { ok });
    player.x = p ? p.x : at[0]; player.y = p ? p.y : at[1]; player.z = p ? p.z : z0;
    player.vz = 0; player.ground = true;
    player.h = Math.atan2(fa[0] - player.x, fa[1] - player.y);
    cam.yaw = player.h; cam.pitch = 0.36; cam.dist = 7.5;
    if (typeof groundLod === 'function' && Wd.groundMeshes[0].material.userData.street) groundLod(player.x, player.y);
  }
  spawn();
  presetTime('live');
  fillTimes($('#gt-timechoice'));
  if (sun.altitude < -2) { // arriving at night shows little; offer the morning first
    presetTime('morning');
    $$('#gt-timechoice button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === 'morning')));
  }
  const saved = loadSave();
  if (saved) $('#gt-continue').hidden = false;
  $('#gt-skip').hidden = !OEOnboard.done(); // a returning player (any map): the intro is skipped unless they untick it
  // the title orbit's centre, so the camera can be carried with the player when the game starts somewhere else
  // (Continue, a district from the subway map): the arrival then starts from the same view of the new place
  const startGame = cont => {
    A.start();
    const was = [player.x, player.y, player.z];
    if (cont && saved) {
      qs = Object.assign(qs, migrate(saved.qs));
      // back on the deck or roof where you left off; at the start if that is no longer in the map (a map split in two)
      const F = scene.frame, inMap = p => Array.isArray(p) && p[0] > F.x[0] + 20 && p[0] < F.x[1] - 20 && p[1] > F.y[0] + 20 && p[1] < F.y[1] - 20;
      if (inMap(saved.pos)) spawn(saved.pos, saved.pos[2] != null ? saved.pos[2] + 0.5 : undefined);
      else spawn();
      if (saved.car && myCar && nav.floorAt(saved.car[0], saved.car[1], saved.car[2] + 1)) parkMyCar({ x: saved.car[0], y: saved.car[1], z: saved.car[2], h: saved.car[3] });
      if (saved.clock) { clock.scale = saved.clock.scale || 30; setClock(saved.clock.y, saved.clock.m, saved.clock.d, saved.clock.min); }
    }
    // arriving at a district of the map from the subway map (index.html router, "@<travel id>")
    const arrive = !cont && window.OE_ARRIVE && (G.travel || []).find(t => t.id === window.OE_ARRIVE);
    if (arrive) spawn(arrive.at, arrive.at[2] != null ? arrive.at[2] + 0.5 : undefined);
    const tc = $('#gt-timechoice [aria-pressed="true"]');
    if (!cont && tc) presetTime(tc.dataset.t);
    $('#g-title').hidden = true;
    const dv = W(player.x, player.y, player.z).sub(W(...was));
    if (dv.lengthSq() > 1) { camera.position.add(dv); titleLook.add(dv); }
    const skip = OEOnboard.done() && $('#gt-skip-on').checked;
    if (openingHere()) { // (#110: the opening shot, the scramble's walk turning green as it comes down)
      const j = junctions.J.find(q => q.scramble && Math.hypot(q.x - player.x, q.y - player.y) < 80);
      if (j) { junctions.walkIn(j, OPENING.walkIn); cars.clearBox(j.x, j.y, 45); musterScramble(); }
    }
    craneIn(() => (cont ? OEOnboard.markDone(CITY.id) : skip ? welcome(true) : startTour(() => welcome(false))));
    renderPassport();
  };
  // Onboarding, once in this browser across every map (onboard.js, #89): the first time, a short tour of the
  // HUD and then the guide's directions; on a later map, with "Skip the intro" (on for a returning player),
  // straight to the guide's own short welcome. "Show the intro again" in the menu runs the tour now.
  function welcome(short) {
    const q = quest(), n = npcById(q ? q.giver : npcs[0].id);
    if (!n) return;
    // (not the quest's first line: several begin "You're the new surveyor?", which a returning player is not)
    const way = routeMode === 'on' ? 'follow the gold route' : 'the route is on the minimap'; // (the menu's Route line, #90)
    H.toast(short ? `<b>${n.name}</b>: ${G.greeting || 'Hello!'} Welcome to ${CITY.name}. <span>${routeMode === 'on' ? 'Follow the gold line' : 'The minimap shows the way'} and come and find me.</span>`
      : `Find ${n.name}: ${way}, or ${touch ? 'tap <b>Map</b>' : 'press <kbd>M</kbd>'} for the map.`);
  }
  const tourSteps = () => [
    { id: 'move', title: 'Walk and look', target: touch ? '#gt-joy' : null,
      text: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk the way the camera faces. Hold <kbd>Shift</kbd> to sprint, <kbd>X</kbd> switches walking and running, <kbd>Space</kbd> jumps. Drag to look around, scroll to zoom.',
      touch: 'The stick walks the way the camera faces; <b>Run</b> switches to running and <b>Jump</b> jumps. Drag anywhere else to look around.' },
    { id: 'map', title: 'The map', target: '#g-map-btn',
      text: '<kbd>M</kbd> opens the map of the whole area: your objective, the people to meet, the ferries, the helipads and the trig stations (△).',
      touch: '<b>Map</b> opens the map of the whole area: your objective, the people to meet, the ferries, the helipads and the trig stations (△).' },
    { id: 'travel', title: 'Travel anywhere', target: '#g-minimap',
      text: 'On the map, pick a place, or a district from the list beside it, and <b>Travel here</b> takes you there in a few seconds. <b>Set waypoint</b> puts the gold line on it instead.',
      touch: 'On the map, tap a place, or a district from the list, and <b>Travel here</b> takes you there in a few seconds. <b>Set waypoint</b> puts the gold line on it instead.' },
    { id: 'taxi', title: 'Taxis and rides', target: null,
      text: 'At the kerb, <kbd>Y</kbd> raises your hand and a passing taxi pulls in. <kbd>E</kbd> gets in, pick where to go, <kbd>F</kbd> skips the trip and <kbd>E</kbd> gets out when it stops.',
      touch: 'At the kerb, <b>Hail a taxi</b> raises your hand and a passing taxi pulls in. <b>E</b> gets in, pick where to go, and <b>E</b> gets out when it stops.' },
    { id: 'passport', title: 'Your passport', target: '#g-pass-btn',
      text: 'Every place you survey and every quest you finish stamps your passport (<kbd>P</kbd>). The count is beside the button.',
      touch: 'Every place you survey and every quest you finish stamps your <b>Passport</b>. The count is beside the button.' },
    { id: 'phone', title: 'Your phone', target: '#g-phone-btn',
      text: '<kbd>N</kbd> takes out your phone: order a ride to anywhere on the map and watch it come to you, or have your car brought round.',
      touch: '<b>Phone</b>: order a ride to anywhere on the map and watch it come to you, or have your car brought round.' },
    { id: 'photo', title: 'Photo mode', target: '#g-photo-btn',
      text: '<kbd>O</kbd> holds the world still: set the sun, the lens and the angle, and save a picture.',
      touch: '<b>Photo</b> holds the world still: set the sun, the lens and the angle, and save a picture.' },
    { id: 'menu', title: 'The menu', target: '#g-menu-btn',
      text: '<kbd>Esc</kbd> pauses: the time of day and the date, the clock\'s speed, who you play, sound, every key, and <b>Show the intro again</b>.',
      touch: '<b>Menu</b> pauses: the time of day and the date, the clock\'s speed, who you play, sound, and <b>Show the intro again</b>.' },
    // (the menu's route setting: a three-way Route line, On, Only when I ask and Off, or a single checkbox)
    $('#gm-route [data-r]') ? { id: 'route', title: 'The route line', target: '#g-quest',
      text: 'This card is your objective. The gold line on the ground and on the minimap leads there. In the menu, <b>Route line</b> sets it On, Only when I ask (<kbd>L</kbd> shows it for a few seconds) or Off.',
      touch: 'This card is your objective. The gold line on the ground and on the minimap leads there. In the <b>Menu</b>, <b>Route line</b> sets it On, Only when I ask (<b>Show route</b> on this card) or Off.' }
      : { id: 'route', title: 'The route line', target: '#g-quest',
        text: 'This card is your objective. The gold line on the ground and on the minimap leads there; turn it off in the menu (<b>Show the route to the objective</b>).',
        touch: 'This card is your objective. The gold line on the ground and on the minimap leads there; turn it off in the <b>Menu</b> (<b>Show the route to the objective</b>).' },
  ];
  function startTour(then = null) {
    return OEOnboard.tour(tourSteps(), { root: document.body, onEnd: () => { OEOnboard.markDone(CITY.id); if (then) then(); } });
  }
  on($('#gt-play'), 'click', () => startGame(false));
  on($('#gt-continue'), 'click', () => startGame(true));
  on($('#gt-timechoice'), 'click', e => { const b = e.target.closest('button'); if (b) $$('#gt-timechoice button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  const nowLoc = S.utcToLocal(Date.now());
  $('#gt-now').textContent = `Now in ${CITY.name} (${fmtMin(nowLoc.minutes)})`;
  // the loader (its plate, plate.js) fades onto the title orbit; the title card is held back until
  // then, so it never shows over the loader, while the scene under it waits as on the title screen
  // (preTitle). fromFlyover() is for a recorded flyover that ends on the orbit's first pose
  // (tools/flyover.js); the plate has none, and resolves false
  // the loader stays up until the scene has been drawn twice: the shaders compile on the first
  // draw, which can take seconds, and a loader that faded before it showed a black frame
  let framesDrawn = 0, firstDrawn;
  const drawn = new Promise(r => { firstDrawn = r; });
  const warm = renderer.compileAsync ? renderer.compileAsync(world, camera).catch(() => {}) : Promise.resolve();
  Promise.all([OEPlate.finish($('#g-loader')), warm.then(() => drawn)]).then(([flew]) => {
    if (flew) fromFlyover();
    preTitle = false;
    $('#g-title').hidden = false;
    $('#g-loader').classList.add('out');
    setTimeout(() => { $('#g-loader').hidden = true; OEPlate.stop($('#g-loader')); }, reduced ? 0 : 700);
  });
  renderPassport();

  // ------------------------------------------------------------ the loop
  let last = performance.now(), clockT = 0, sunTimer = 0, sunState = 'sun', fpsAcc = [performance.now(), 0], fpsWarned = false, stepPhase = 0, bumpT = -9, waterT = -99;
  const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camSmooth = new THREE.Vector3();
  // What a device that can't keep up gives up, a step every four seconds below 24 frames a second,
  // nice-to-haves first: the far rain and its splashes, then every drop (the streets stay wet and the
  // sky grey), then the wet street's reflections, then pixels, down to 70% of the tier's. The people
  // keep their models and the city its detail: a crowd of boxes is not a city. False when there is
  // nothing left to shed.
  let shedLevel = 0;
  function shed() {
    const steps = [
      () => weather && weather.shed < 1 && (weather.shed = 1),
      () => weather && weather.shed < 2 && (weather.shed = 2),
      () => mirror && mirror.on && !mirror.off && (mirror.off = true),
      () => pxScale > 0.85 && ((pxScale = 0.85), resize(), true),
      () => pxScale > 0.7 && ((pxScale = 0.7), resize(), true),
    ];
    while (shedLevel < steps.length) if (steps[shedLevel++]()) { console.info(`Running slowly: shed step ${shedLevel}`); return true; }
    return false;
  }
  let running = true;
  function frame(now) {
    if (!running) return;
    if (care.lost) { last = now; requestAnimationFrame(frame); return; } // the game holds still until the picture is back
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // the first frame can be stamped before the loop started
    last = now; clockT += dt;
    U.uTime.value = clockT;
    const titleOn = preTitle || !$('#g-title').hidden, paused = titleOn || !$('#g-menu').hidden || photo.on;
    stage.classList.toggle('titled', titleOn);
    // time of day
    if (!clock.frozen && !paused) { clock.min += dt * clock.scale / 60; if (clock.min >= 1440) setClock(clock.y, clock.m, clock.d, clock.min); }
    sunTimer -= dt;
    if (sunTimer <= 0) {
      sunTimer = 0.25;
      applySun();
      const px = player.mode === 'heli' ? heli.st.x : player.mode === 'ferry' ? player.vehicle.x : player.x, py = player.mode === 'heli' ? heli.st.y : player.mode === 'ferry' ? player.vehicle.y : player.y;
      const pz = player.mode === 'heli' ? heli.st.z + 1 : player.mode === 'ferry' ? 3 : player.z + 1.6;
      sunState = sun.altitude <= 0 ? 'night' : S.sunlit(DSM, px, py, pz, sun) ? 'sun' : 'shade';
      $('#g-sun').dataset.s = sunState;
      const wx = weather ? weather.state : null;
      if (wx && wx.rain > 0.06) { sunState = 'rain'; $('#g-sun').dataset.s = 'rain'; }
      $('#g-sun span').textContent = sunState === 'rain' ? `${wx.kind === 'rain' ? 'Rain' : 'Drizzle'} · ${wx.covered ? 'under cover' : 'in the open'}`
        : sunState === 'night' ? 'Sun down' : sunState === 'sun' ? `In sun · ${sun.altitude.toFixed(0)}°` : `In shade · sun ${sun.altitude.toFixed(0)}°`;
      if (!paused) checkSteps();
    }
    if (!paused) simulate(dt);
    if (!paused) { crossingSound(dt); walkCalls.update(dt, camera); }
    else if (places) places.hush(); // a paused game (the title, the menu, photo mode) shows no caption
    if (player.mode !== 'heli') nav.prefetch(player.x, player.y); // the landmarks' fine collision ahead of the walker or the car, a few ms a frame
    if (Math.floor(clockT) !== Math.floor(clockT - dt)) groundLod(player.mode === 'heli' ? heli.st.x : player.x, player.mode === 'heli' ? heli.st.y : player.y);
    if (titleOn && titleYaw != null) { titleT += dt; titleYaw = openingHere() ? openingView().yaw + OPENING.sway * Math.sin(titleT * 0.06) : titleYaw + dt * 0.05; }
    if (photo.on) photoCamera(dt); else if (closeup && !titleOn) closeupCamera(dt); else updateCamera(dt, titleOn);
    stage.classList.toggle('cine', cine.active && (cine.label !== 'crane' || cine.k < 0.5));
    // world clocks and fades
    Wd.tick(now, camera);
    if (neon) neon.update(camera, dt);
    if (Math.floor(clockT) !== Math.floor(clockT - dt)) applyDensity();
    if (atmos) atmos.update(clockUtc, now / 1000, U);
    weatherTick(dt, titleOn);
    if (show) show.tick(now);
    if (window.OEKit) OEKit.setNight(U.uNight.value); // cabin windows and navigation lights
    fer.vessels.forEach(v => (v.events || []).splice(0).forEach(ev => onFerryEvent(ev)));
    dlg.tick(dt);
    // HUD
    const ob = titleOn ? null : objective();
    const target = waypoint || (ob && ob.at);
    // on foot with a ride on its way, the route leads to the pick-up first
    const toPickup = player.mode === 'foot' && ride && (ride.phase === 'coming' || ride.phase === 'waiting') && Math.hypot(ride.pickup.x - player.x, ride.pickup.y - player.y) > 40 ? [ride.pickup.x, ride.pickup.y] : null;
    updateRoute(clockT, toPickup || target, toPickup ? null : ob, titleOn);
    gold.tick(clockT);
    beam.visible = !!target && !titleOn && Math.hypot(target[0] - (player.mode === 'heli' ? heli.st.x : player.x), target[1] - (player.mode === 'heli' ? heli.st.y : player.y)) > 45;
    if (target) { const f = nav.floorAt(target[0], target[1], Math.max(300, nav.terrain(target[0], target[1]) + 1)); beam.position.copy(W(target[0], target[1], f ? f.z : 0)); beam.scale.set(1, player.mode === 'heli' ? 4 : 1, 1); }
    const me = player.mode === 'heli' ? heli.st : player.mode === 'ferry' ? player.vehicle : player;
    $('#gq-title').textContent = ob ? ob.title : (Q.length && LINES.every(lineDone) ? 'Free roam' : '');
    if (!titleOn) renderLines();
    const trigLeft = VP.filter(v => !trigDone()[v.id]).length;
    $('#gq-step').textContent = ob ? ob.text : trigLeft ? `The city is yours. ${trigLeft} trig station${trigLeft > 1 ? 's' : ''} still to survey (△ on the map), or change the time and fly anywhere.`
      : 'The city is yours. Change the time, ride the ferries, fly anywhere.';
    $('#gq-dist').textContent = target ? `${Math.round(Math.hypot(target[0] - me.x, target[1] - me.y))} m` : '';
    if (photo.on) beam.visible = false;
    routeShow(dt, titleOn);
    if (!titleOn && !photo.on) {
      const icons = [];
      for (const w of G.wharves) icons.push({ kind: 'wharf', x: w.terminal[0], y: w.terminal[1] });
      for (const h of G.helipads) icons.push({ kind: 'pad', x: h.at[0], y: h.at[1] });
      for (const v of VP) icons.push({ kind: 'trig', x: v.x, y: v.y, done: !!trigDone()[v.id] });
      for (const f of flocks) icons.push({ kind: 'gull', x: f.at[0], y: f.at[1] });
      for (const v of fer.vessels) icons.push({ kind: 'ferry', x: v.x, y: v.y });
      if (player.mode !== 'heli') icons.push({ kind: 'heli', x: heli.st.x, y: heli.st.y });
      if (myCar && player.mode !== 'car') icons.push({ kind: 'car', x: myCar.D.st.x, y: myCar.D.st.y });
      let rideRoute = null, radius = player.mode === 'heli' ? 700 : player.mode === 'ferry' ? 450 : player.mode === 'car' || player.mode === 'ride' ? 260 + Math.min(220, player.speed * 7) : 200;
      if (ride && player.mode !== 'ride' && ride.phase !== 'leaving') {
        const st = ride.drv.st;
        if (ride.phase === 'coming') { const P = ride.drv.path; rideRoute = [[st.x, st.y]].concat(P.pts.slice(P.pos(st.s, {}).i + 1)); }
        if (ride.phase !== 'arrived') icons.push({ kind: 'pickup', x: ride.pickup.x, y: ride.pickup.y, pin: true });
        icons.push({ kind: 'ridecar', x: st.x, y: st.y, h: st.h, pin: true });
        // on foot, the minimap opens out to show the car coming and the pick-up, as the app's map does
        if (player.mode === 'foot') radius = Math.max(radius, Math.min(480, 1.18 * Math.max(Math.hypot(st.x - player.x, st.y - player.y), Math.hypot(ride.pickup.x - player.x, ride.pickup.y - player.y))));
      }
      for (const n of npcs) { const hot = wantsTalk(n); n.marker.visible = hot && !dlg.open; if (hot) icons.push({ kind: 'npc', x: n.x, y: n.y, color: '#e0a21a', pin: true }); }
      for (const o of sideObjectives()) icons.push({ kind: 'quest2', x: o.at[0], y: o.at[1] });
      if (ob && ob.at) icons.push({ kind: 'quest', x: ob.at[0], y: ob.at[1], pin: true });
      if (waypoint) icons.push({ kind: 'waypoint', x: waypoint[0], y: waypoint[1], pin: true });
      drawMini({ x: me.x, y: me.y, yaw: player.mode !== 'heli' ? cam.yaw : cam.mode === 'bird' ? heli.st.h : cam.mode === 'cockpit' ? heli.st.h - cam.lookYaw : cam.yaw, heading: player.mode === 'heli' ? heli.st.h : player.mode === 'ferry' ? player.vehicle.h : player.h,
        radius: mini.r += (radius - mini.r) * Math.min(1, dt * 2.5), route: guide.pts ? [[me.x, me.y]].concat(gold.ahead()) : null, icons, ride: rideRoute });
      if (!$('#g-bigmap').hidden && Math.floor(clockT * 2) !== Math.floor((clockT - dt) * 2)) drawBig();
      const a = currentAction(), alt = kerbAction();
      $('#g-prompt').hidden = !a && !alt;
      $('#gp-main').hidden = !a; $('#gp-alt').hidden = !alt;
      if (a) { $('#gp-key').textContent = a.key; $('#gp-key').hidden = !a.key; $('#gp-text').textContent = a.text; }
      if (!phone.el.hidden && phone.view === 'ride') {
        if (clockT - phone.at > 0.5) { phone.at = clockT; phoneRender(); }
        if (rideOn() && !phone.map.hidden) rideMapFrame();
      }
      vehicleHud();
      if (player.mode !== 'foot') gaitChip('');
    }
    // a low frame rate: shed the extras first (shed), and only then hint at the crowd (slowroads does the same)
    if (titleOn || paused || framesDrawn < 2) fpsAcc = [now, 0];
    else if (++fpsAcc[1] && now - fpsAcc[0] > 4000 && !navigator.webdriver) { // (not for the tools' stills, films and checks on a software renderer: game_check calls shed itself)
      if (fpsAcc[1] * 1000 / (now - fpsAcc[0]) < 24 && !shed() && !fpsWarned) { fpsWarned = true; H.toast('Running slowly? Lower the crowd density in the menu (Esc).'); }
      fpsAcc = [now, 0];
    }
    if (player.rig.hideHead) player.rig.hideHead(player.mode === 'heli' && cam.mode === 'cockpit' && !photo.on && !(cine.active && cine.label !== 'crane'));
    // depth of field in photo mode, and with the camera's motion blur in the opening shot; never in play
    if (atmos && atmos.camFx) atmos.camFx(photo.on ? { focus: camera.position.distanceTo(photo.focus), aperture: lensBlur(camera.fov, camera.position.distanceTo(photo.focus), photo.fstop || 2.8) }
      : arriving && cine.active ? { focus: camera.position.distanceTo(live.look), aperture: lensBlur(camera.fov, camera.position.distanceTo(live.look), 4), blur: 0.5 } : null);
    if (mirror) mirror.update(world, clockT);
    if (atmos) atmos.render(world, camera); else renderer.render(world, camera);
    care.drawn();
    if (framesDrawn < 2 && ++framesDrawn === 2) firstDrawn();
    updateLabels();
    requestAnimationFrame(frame);
  }

  // the weather's frame (weather.js): the rain round the camera, the umbrellas, the sound of it
  function weatherTick(dt, titleOn) {
    if (!weather) return;
    const fx = player.mode === 'heli' ? heli.st.x : player.mode === 'ferry' ? player.vehicle.x : player.x, fy = player.mode === 'heli' ? heli.st.y : player.mode === 'ferry' ? player.vehicle.y : player.y;
    const fz = player.mode === 'heli' ? heli.st.z + 1 : player.mode === 'ferry' ? 3 : player.z + 1.7;
    weather.update(dt, clockT, W(fx, fy, fz));
    if (crowdDraw && crowdDraw.setRain) crowdDraw.setRain(weather.state.rain);
    if (A.rain) A.rain(titleOn ? 0 : weather.state.rain, weather.covered() && player.mode === 'foot', player.mode === 'car' || player.mode === 'ride' || player.mode === 'heli');
  }
  function simulate(dt) {
    const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + joy.y;
    const side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + joy.x;
    const held = dlg.open || !!closeup || cine.label === 'hop' || cine.label === 'survey' || cine.label === 'closer';
    if (player.mode === 'foot') walkStep(dt, held ? 0 : fwd, held ? 0 : side);
    else if (player.mode === 'board') boardStep(dt);
    else if (player.mode === 'heli') {
      const lift = (k('Space') ? 1 : 0) - (k('KeyC') || k('ShiftLeft') || k('ShiftRight') ? 1 : 0) + touchLift;
      const events = [];
      heli.update(dt, { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, side)), lift: Math.max(-1, Math.min(1, lift)) }, events);
      for (const ev of events) {
        if (ev.type === 'under_bridge') { H.toast(`<b>Under the ${ev.name || 'bridge'}!</b> ${G.under_bridge_note || ''}`); A.chime(); for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'under_bridge' && (!s.surface || s.surface === ev.surface)) completeStep(l); } }
        if (ev.type === 'bump' && clockT - bumpT > 2) { bumpT = clockT; H.toast('Careful! That was a building.'); }
      }
      A.rotor(heli.st.rotor, Math.abs(lift) + Math.abs(fwd) * 0.5);
      A.wind(Math.min(1, heli.st.speed / 60));
      player.rig.animate(dt, 0, 'sit', clockT);
    } else if (player.mode === 'rail') {
      player.rig.animate(dt, 0, 'ground', clockT);
    } else if (player.mode === 'car') {
      carStep(dt, held ? 0 : fwd, held ? 0 : side);
    } else if (player.mode === 'ferry') {
      const v = player.vehicle;
      if (v.helm) v.helm.input = { fwd, turn: side };
      if (v.helm && v.helm.manual && v.helm.started && clockT - v.helm.started > 100) { fer.finishHelm(v); H.toast('The skipper takes over and brings her in.'); }
      A.engine(0.3 + Math.min(1, Math.abs(v.speed) / 9) * 0.7);
      player.rig.animate(dt, 0, 'ground', clockT);
    }
    if (player.mode !== 'heli') { heli.update(dt, {}, []); A.rotor(heli.st.rotor * Math.max(0, 1 - Math.hypot(heli.st.x - player.x, heli.st.y - player.y) / 300)); }
    if (player.mode !== 'heli' && player.mode !== 'board') heliToPad();
    if (waitFerry && (player.mode !== 'foot' || !nearWharf(player.x, player.y, 40))) waitFerry = null;
    const wantTo = waitFerry && rideTarget(waitFerry);
    const here = waitFerry && fer.vessels.find(q => fer.stopOf(q) === waitFerry && (!wantTo || q.stops.includes(wantTo)));
    if (here) { waitFerry = null; H.toast(`${here.name} is alongside. <kbd>E</kbd> to board.`); }
    fer.update(dt, skip && player.mode === 'ferry' ? 8 : 1, clockT, waitFerry ? 25 : 1);
    if (rail) {
      rail.update(dt, clockT, [player.mode === 'foot' ? player : null, ...npcs], player.mode === 'rail' && skip);
      for (const ev of rail.events.splice(0)) {
        if (player.mode !== 'rail') continue;
        const car = player.vehicle;
        if (ev.type === 'depart') car.moved = true;
        if (ev.type === 'arrive' && car.moved) { skip = false; H.toast(`${rail.stationOf(car.id).name}. <kbd>E</kbd> to get off.`); }
      }
      if (player.mode === 'rail') { // standing in the car, by the downhill window
        const c = player.vehicle;
        player.x = c.x + Math.sin(c.h) * 3; player.y = c.y + Math.cos(c.h) * 3; player.z = c.z + 0.6 + Math.sin(c.pitch) * 3; player.h = c.h + Math.PI;
      }
    }
    if (player.mode === 'ferry') { // stand on the upper deck
      const v = player.vehicle, c = Math.cos(v.h), s = Math.sin(v.h), D = fer.deck;
      player.x = v.x + s * D.fwd + c * D.right; player.y = v.y + c * D.fwd - s * D.right; player.z = D.up; player.h = v.h;
      if (v.phase === 'dwell') skip = false;
    }
    carsTick(dt);
    if (player.mode !== 'heli' && player.mode !== 'board' && player.mode !== 'car' && player.mode !== 'ride') { player.rig.root.position.copy(W(player.x, player.y, player.z)); player.rig.root.rotation.y = Math.PI - player.h; }
    // NPCs: face the player when close, idle otherwise
    let gaze = null;
    for (const n of npcs) {
      const d = Math.hypot(player.x - n.x, player.y - n.y);
      if (d < 5 && player.mode === 'foot') n.h += angDiff(Math.atan2(player.x - n.x, player.y - n.y), n.h) * Math.min(1, dt * 4);
      n.rig.root.rotation.y = Math.PI - n.h;
      // look at the player when close; the player looks at whoever they are talking to
      n.rig.lookTarget = d < 9 && player.mode === 'foot' ? n.eyes.copy(W(player.x, player.y, player.z + 1.55)) : null;
      if (n.talking) gaze = W(n.x, n.y, n.z + 1.55);
      n.rig.animate(dt, 0, n.talking ? 'talk' : 'ground', clockT + n.pitch);
    }
    player.rig.lookTarget = gaze;
    const cx = player.mode === 'heli' ? heli.st.x : player.x, cy = player.mode === 'heli' ? heli.st.y : player.y;
    npcStream(dt, cx, cy);
    crowd.update(dt, cx, cy, clockT, player.mode === 'foot' ? player : player.mode === 'car' ? { x: player.x, y: player.y, h: player.h, speed: myCar.D.st.v, r: 1.1 } : null);
    if (colonies.length) {
      const L = dayLimits();
      for (const c of colonies) c.update(dt, { min: clock.min, sunset: L.sunset, sunrise: L.sunrise }, cx, cy, U.uNight.value);
      // on the viewing platform after dark, the colony's rule for visitors
      const c0 = colonies[0].colony;
      if (!viewingNoted && player.mode === 'foot' && player.floor === 'pier' && sun && sun.altitude < 0 && c0.viewing_note && c0.viewing.some(p => Math.hypot(p[0] - player.x, p[1] - player.y) < 40)) { viewingNoted = true; H.toast(c0.viewing_note); }
    }
    for (const f of flocks) f.update(dt, cx, cy, player.mode === 'foot', U.uNight.value);
    benchBudget += dt * 60; // keep what the benches near the player offer up to date, about 60 a second
    if (benchBudget >= 1) { benches.refresh(benchLit, cx, cy, CR.radius_m || 450, Math.floor(benchBudget)); benchBudget -= Math.floor(benchBudget); }
    // the traffic brakes for you on foot and for your car, and swings out round a car pulled in at the kerb
    const blockers = player.mode === 'foot' ? [player] : [];
    for (const n of npcs) if (Math.abs(n.x - cx) < 700 && Math.abs(n.y - cy) < 700) blockers.push({ x: n.x, y: n.y, z: n.z, fixed: true }); // (they stand their ground)
    // your car and a ride: the traffic won't drive into them, nor the crowd walk through them. A ride on
    // the move is left to its driver (soft: the traffic doesn't wait on it), so that one swinging out
    // round a queue and a car coming the other way never wait on each other for good
    cars.extra.length = 0;
    for (const o of [myCar, ride]) if (o) {
      const st = stOf(o);
      blockers.push({ x: st.x, y: st.y, z: st.z, half: o.C.half, hw: o.C.hw, parked: Math.abs(st.v) < 0.3 && (o === ride || player.mode !== 'car'), q: o === ride && !!st.q, qBy: o === ride ? st.qBy : null });
      cars.extra.push({ x: st.x, y: st.y, z: st.z, h: st.h, half: o.C.half, hw: o.C.hw, v: Math.max(0, st.v), line: 0, top: o.C.top, soft: o === ride && Math.abs(st.v) >= 0.3 });
    }
    cars.update(dt, cx, cy, clockT, blockers);
    if (places) {
      // the area caption waits for a quiet screen: no conversation, menu, map, phone, photo mode or
      // onboarding (anything marked data-hush that is showing holds it too)
      const active = player.mode === 'foot' && !cine.active;
      const calm = active && !dlg.open && !uiOpen() && phone.el.hidden && !photo.on && !document.querySelector('[data-hush]:not([hidden])');
      places.update(dt, player.x, player.y, player.z, active, calm);
    }
  }

  // on foot, m/s: a stroll, the default run (the surveyors' run clip is cut at 5.4 to 5.8 m/s, so it plays
  // near its own pace and the feet keep to the ground) and a sprint while Shift is held
  const GAIT = { walk: 1.4, run: 6, sprint: 8.5 };
  function walkStep(dt, fwd, side) {
    if (player.auto && player.auto.t > 0.2 && Math.hypot(fwd, side) > 0.3) { const a = player.auto; player.auto = null; if (a.cancel) a.cancel(); } // moving off cancels it
    if (player.auto) { // walking up to a door
      const a = player.auto, dx = a.x - player.x, dy = a.y - player.y, d = Math.hypot(dx, dy);
      a.t += dt;
      if (d < 0.7 || a.t > 5) { player.auto = null; a.then(); return; }
      fwd = 1; side = 0;
      player.h += angDiff(Math.atan2(dx, dy), player.h) * Math.min(1, dt * 8);
      const sp = 2.2, nx = player.x + Math.sin(player.h) * sp * dt, ny = player.y + Math.cos(player.h) * sp * dt, w = nav.walk(nx, ny, player.z);
      if (w.ok) { const c = OECars.pushOut(nx, ny, w.z, 0.35, carBoxes(nx, ny, 6)), o = posts.pushOut(c.x, c.y, 0.35, w.z); player.x = o.x; player.y = o.y; player.z = w.z; } else a.t = 9;
      player.rig.animate(dt, sp, 'ground', clockT);
      return;
    }
    const m = Math.min(1, Math.hypot(fwd, side));
    const run = k('ShiftLeft') || k('ShiftRight');
    const target = m > 0.05 ? (run ? GAIT.sprint : player.walking ? GAIT.walk : GAIT.run) * m : 0; // run, walk (X) or sprint (hold Shift)
    gaitChip(m > 0.05 ? (run ? 'sprint' : player.walking ? 'walk' : 'run') : player.walking ? 'walk' : 'run');
    player.speed += (target - player.speed) * Math.min(1, dt * (target > player.speed ? 6 : 10));
    if (m > 0.05) {
      const dir = cam.yaw + Math.atan2(side, fwd);
      player.h += angDiff(dir, player.h) * Math.min(1, dt * 10);
    }
    // move as Unreal's CharacterMovementComponent does: sweep the capsule and slide along the
    // walls it meets, then check the floor where it ends up (water, a drop). At the seawall,
    // where the floor check fails, try one axis at a time.
    const sx = Math.sin(player.h) * player.speed * dt, sy = Math.cos(player.h) * player.speed * dt, x0 = player.x, y0 = player.y;
    let moved = 0;
    for (const [mx, my] of [[sx, sy], [sx, 0], [0, sy]]) {
      if (!mx && !my) continue;
      const m = nav.slide(player.x, player.y, player.z, mx, my), w = nav.walk(m.x, m.y, player.z);
      if (w.ok) {
        moved = Math.hypot(m.x - player.x, m.y - player.y);
        player.x = m.x; player.y = m.y;
        if (player.ground && w.z < player.z - 0.6) player.ground = false; // stepped off an edge: fall
        player.floorZ = w.z; player.floor = w.kind;
        break;
      } else if (w.why === 'nogo' && clockT - waterT > 20) { waterT = clockT; H.toast(colonies[0] ? colonies[0].colony.keep_off_note : 'Keep out.');
      } else if (w.why === 'water' && clockT - waterT > 20) { waterT = clockT; H.toast(`No swimming in ${G.water_name || 'the water'}.${G.wharves.length ? ' Ferries leave from the wharves marked F.' : ''}`); }
    }
    // cars are solid too: out of any the move went into, or one that drove into you (back where you
    // were if that is a wall), and then out of the lamp posts and trunks, which a car can't shove you into
    const boxes = carBoxes(player.x, player.y, 6);
    if (boxes.length) {
      let o = OECars.pushOut(player.x, player.y, player.z, 0.35, boxes);
      if (o.hit) {
        o = posts.pushOut(o.x, o.y, 0.35, player.z);
        if (nav.walk(o.x, o.y, player.z).ok) { player.x = o.x; player.y = o.y; } else { player.x = x0; player.y = y0; }
        moved = Math.hypot(player.x - x0, player.y - y0);
      }
    }
    if (dt > 0) player.speed = Math.min(player.speed, moved / dt); // the speed is what the move achieved, so the walk cycle slows against a wall
    // an escalator (a surface with moving_ms) carries whoever stands on its moving stretch along its axis; the
    // steps take you through whatever stands beside them (a well's rim, the floor you come up through)
    const esc = player.ground && nav.strips.find(s => s.moving_ms && s.name === player.floor);
    if (esc) {
      const [u] = nav.stripUV(esc, player.x, player.y), mu = esc.moving_u || [-Infinity, Infinity];
      if (u >= mu[0] && u <= mu[1]) {
        const nx = player.x + esc.axis[0] * esc.moving_ms * dt, ny = player.y + esc.axis[1] * esc.moving_ms * dt;
        if (nav.stripHeight(esc, nx, ny) != null) { player.x = nx; player.y = ny; }
      }
    }
    const f = nav.floorAt(player.x, player.y, player.z);
    const floorZ = f ? f.z : player.z;
    if (f) player.floor = f.kind;
    if ((k('Space')) && player.ground) { player.vz = 5.2; player.ground = false; }
    if (!player.ground) {
      player.vz -= 14 * dt;
      player.z += player.vz * dt;
      if (player.z <= floorZ) { player.z = floorZ; player.vz = 0; player.ground = true; }
    } else {
      player.z += (floorZ - player.z) * Math.min(1, dt * 18); // steps and slopes
      if (floorZ < player.z - 0.6) player.ground = false;
    }
    player.rig.animate(dt, player.ground ? player.speed : 0, player.ground ? 'ground' : 'air', clockT);
    // footsteps on the beat of the walk cycle
    const ph = Math.floor(player.rig.phase / Math.PI);
    if (ph !== stepPhase && player.ground && player.speed > 0.5) A.step();
    stepPhase = ph;
  }

  // The camera: the title orbit, then the rig (chase or bird's-eye) unless a shot is
  // playing. Shots get the rig's live pose, so they can land exactly where it is.
  const titleLook = new THREE.Vector3(), live = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), half: 170 };
  // The title orbit, round a point near the start, ORBIT.r out and ORBIT.h up: from the bearing with
  // the most open foreground (openYaw) or, after a loading flyover, from the video's last frame
  // (FLY_END, where tools/flyover.js ends it: 420 m south and 210 m up, the orbit the videos were
  // made under), easing out to the orbit's own radius and height.
  const ORBIT = { r: 470, h: 150 }, FLY_END = { yaw: 0, r: 420, h: 210 };
  let titleYaw = null, titleR = ORBIT.r, titleH = ORBIT.h, flyCam = null, titleT = 0;
  if (OPENING) { titleR = openingView().r; titleH = OPENING.h; } // (no ease into the opening's own height on the first frame)
  // the orbit's centre: north-east of the start, or with an opening shot (game.start.shot, #110) the point it
  // looks at (Shibuya's: the screen over the scramble), the camera then swaying gently behind the start's view
  // and not orbiting, so the crane down from it to over the player's shoulder never swings round
  const titleAt = () => (openingHere() ? OPENING.look : [player.x + 120, player.y + 160, player.z + 20]);
  const titlePose = () => { const c = titleAt(), yaw = openingHere() ? openingView().yaw : FLY_END.yaw; return { look: c,
    cam: [c[0] - Math.sin(yaw) * FLY_END.r, c[1] - Math.cos(yaw) * FLY_END.r, c[2] + FLY_END.h] }; };
  function fromFlyover() { titleYaw = openingHere() ? openingView().yaw : FLY_END.yaw; titleR = FLY_END.r; titleH = FLY_END.h; }
  // where the title orbit starts: the bearing with the most open foreground (the least building
  // over the nearer part of the line of sight), so the title does not open on one big flat roof
  function openYaw(cx, cy, r) {
    let best = 0, least = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * 2 * Math.PI, x0 = cx - Math.sin(a) * r, y0 = cy - Math.cos(a) * r;
      let h = 0;
      for (let i = 1; i <= 12; i++) { const t = i / 12 * 0.7, x = x0 + (cx - x0) * t, y = y0 + (cy - y0) * t; h += roofBelow(x, y) - nav.terrain(x, y); }
      if (h < least) { least = h; best = a; }
    }
    return best;
  }
  function updateCamera(dt, titleOn) {
    if (titleOn && flyCam) { // a scripted camera over the title screen, for recording the flyover
      camera.up.set(0, 1, 0);
      camera.position.copy(flyCam.pos);
      camera.lookAt(flyCam.look);
      live.pos.copy(camera.position);
      Wd.fitShadow(flyCam.look, flyCam.shadow);
      return;
    }
    if (titleOn) { // slow orbit near the start for the title screen, low enough to see the skyline against the sky
      const c = titleAt();
      const O = openingHere() ? openingView() : ORBIT;
      if (titleYaw == null) titleYaw = O !== ORBIT ? O.yaw : openYaw(c[0], c[1], ORBIT.r);
      const k = Math.min(1, dt * 0.4);
      titleR += (O.r - titleR) * k; titleH += (O.h - titleH) * k;
      titleLook.copy(W(c[0], c[1], c[2]));
      camera.up.set(0, 1, 0);
      camera.position.copy(titleLook).add(new THREE.Vector3(Math.sin(titleYaw) * -titleR, titleH, Math.cos(titleYaw) * titleR));
      camera.lookAt(titleLook);
      live.pos.copy(camera.position);
      Wd.fitShadow(titleLook, 600);
      return;
    }
    rig(dt);
    // in a car the view widens with speed, and from a seat it is a little wider still
    const veh = player.mode === 'car' ? myCar.D.st : player.mode === 'ride' && ride ? ride.drv.st : null;
    carFov += ((veh ? (cam.mode === 'cabin' ? 8 : Math.max(0, Math.min(13, ((veh.speed ?? Math.abs(veh.v)) - 9) * 0.32))) : 0) - carFov) * Math.min(1, dt * 2);
    if (veh) player.rig.root.visible = cam.mode !== 'cabin';
    // the cockpit view takes a wider lens, as cockpit views in games do, and a near plane inside the cabin
    const shot = cine.step(clockT), cockpit = !shot && player.mode === 'heli' && cam.mode === 'cockpit';
    const fov = shot && cine.label === 'survey' ? surveyFov : cockpit ? 72 : BASE_FOV + (shot ? 0 : Math.round(carFov * 4) / 4), near = cockpit ? 0.12 : 0.3;
    if (camera.fov !== fov || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
    if (shot) {
      camera.up.set(0, 1, 0);
      camera.position.copy(shot.pos);
      // never inside a building; a film's shots (tools/film) are checked against the surface model when
      // they are planned, and go down to eye level among the crowd, so they are left where they are
      // the arrival and the hops keep clear of the roofs themselves (calmElevation) and come down into a street to the
      // player, where this clamp (the tallest roof in the cells round it) would pin them at the roofline: within 25 m
      // of what they look at they are left alone, as the chase camera is; the look closer is at the eye's height
      const own = (cine.label === 'crane' || cine.label === 'hop') && camera.position.distanceTo(shot.look) < 25;
      if (cine.label !== 'film' && cine.label !== 'closer' && !own) camera.position.y = Math.max(camera.position.y, roofBelow(camera.position.x, -camera.position.z) + 3);
      camera.lookAt(shot.look);
      Wd.fitShadow(shot.look, THREE.MathUtils.clamp(camera.position.distanceTo(shot.look) * 1.2, live.half, 1600));
      return;
    }
    camera.up.copy(live.up);
    camera.position.copy(live.pos);
    camera.lookAt(live.look);
    Wd.fitShadow(live.look, live.half);
  }
  const cabinQ = new THREE.Quaternion(), camProbe = new THREE.Vector3();
  const CAM_LIFTS = [0, 0.15, 0.3, 0.45, 0.6, 0.8]; // the chase camera's lifts over a wall behind, in radians of pitch
  function rig(dt) {
    const k2 = Math.min(1, dt * 6);
    if (player.mode === 'heli' && cam.mode === 'cockpit') {
      // the pilot's eyes, pitching and banking with the cabin; drag to look round. In flight the
      // view drifts back to straight ahead when you let it be
      if (clockT - cam.lastInput > 2.5 && heli.st.speed > 3) { const r = Math.min(1, dt * 1.2); cam.lookYaw -= cam.lookYaw * r; cam.lookPitch += (-0.1 - cam.lookPitch) * r; }
      heli.group.updateMatrixWorld();
      live.pos.copy(heli.way.eye).applyMatrix4(heli.group.matrixWorld);
      heli.group.getWorldQuaternion(cabinQ);
      const cp = Math.cos(cam.lookPitch);
      live.look.set(Math.sin(cam.lookYaw) * cp, Math.sin(cam.lookPitch), Math.cos(cam.lookYaw) * cp).applyQuaternion(cabinQ).add(live.pos);
      live.up.set(0, 1, 0).applyQuaternion(cabinQ);
      live.half = 520;
      return;
    }
    if (player.mode === 'heli' && cam.mode === 'bird') {
      const st = heli.st, g = nav.groundBelow(st.x, st.y, st.z);
      live.pos.lerp(W(st.x, st.y, Math.max(st.z, g) + cam.birdAlt), k2);
      live.up.set(Math.sin(st.h), 0, -Math.cos(st.h));
      live.look.copy(W(st.x, st.y, st.z));
      live.half = Math.min(2400, cam.birdAlt * 1.4);
      return;
    }
    live.up.set(0, 1, 0);
    const veh = player.mode === 'car' ? myCar : player.mode === 'ride' ? ride : null, vs = veh && stOf(veh);
    if (veh && cam.mode === 'cabin') { cabinView(dt, veh, vs); return; }
    let tx, ty, tz, follow;
    if (player.mode === 'heli') { tx = heli.st.x; ty = heli.st.y; tz = heli.st.z + 2.5; follow = heli.st.h; }
    else if (player.mode === 'ferry') { tx = player.vehicle.x; ty = player.vehicle.y; tz = 5; follow = null; }
    else if (player.mode === 'rail') { tx = player.vehicle.x; ty = player.vehicle.y; tz = player.vehicle.z + 3; follow = null; }
    else if (veh) { tx = vs.x; ty = vs.y; tz = vs.z + 1.5; follow = vs.h; }
    else { tx = player.x; ty = player.y; tz = player.z + 1.55; follow = player.h; }
    // drift behind the direction of travel when the player is not steering the camera (in a car, sooner and faster)
    const moving = veh ? Math.abs(vs.v) > 1 : player.mode === 'heli' ? heli.st.speed > 3 : player.speed > 1;
    if (follow != null && clockT - cam.lastInput > (veh ? 0.9 : 1.6) && moving) cam.yaw += angDiff(follow, cam.yaw) * Math.min(1, dt * (veh ? 2.6 : player.mode === 'heli' ? 1.6 : 0.9));
    if (cam.distTo) { cam.dist += (cam.distTo - cam.dist) * Math.min(1, dt * 2.5); if (Math.abs(cam.distTo - cam.dist) < 0.05) cam.distTo = 0; } // easing in or out
    if (cam.yawTo != null) { const d = angDiff(cam.yawTo, cam.yaw); cam.yaw += d * Math.min(1, dt * 2.5); if (Math.abs(d) < 0.01) cam.yawTo = null; }
    const dist = player.mode === 'heli' ? Math.max(cam.distTo ? cam.dist : 14, cam.dist) : player.mode === 'ferry' || player.mode === 'rail' ? Math.max(25, cam.dist) : veh ? Math.max(5, cam.dist) + Math.min(2.5, Math.abs(vs.v) * 0.05) : cam.dist;
    const close = player.mode === 'foot' || player.mode === 'board';
    camTarget.lerp(W(tx, ty, tz), close ? 1 : veh ? Math.min(1, dt * 14) : k2);
    // keep the camera out of walls and cars: first rise over them (look down on the player), then come
    // closer. The lift and the pull-in are eased at a bounded rate rather than switched between steps,
    // so a tight spot never makes the view jump from one frame to the next (#97): it rises quickly when
    // a wall comes between, holds a moment, and settles back slowly once the way behind is open
    const near = carBoxes(tx, ty, dist + 6, veh);
    const clear = (a, b) => Math.min(nav.clearFraction(a, b), near.length ? OECars.sweep({ x: a.x, y: -a.z, z: a.y }, { x: b.x, y: -b.z, z: b.y }, near) : 1);
    const orbit = (lift, out) => { const pitch = Math.min(1.35, cam.pitch + lift), cp = Math.cos(pitch); return out.set(camTarget.x - Math.sin(cam.yaw) * cp * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(cam.yaw) * cp * dist); };
    let want = null;
    for (const lift of CAM_LIFTS) {
      const f = clear(camTarget, orbit(lift, camProbe));
      if (!want || f > want.f + 0.05) want = { f, lift };
      if (f >= 0.97) break;
    }
    const jumped = cam.snap || camSmooth.lengthSq() === 0 || camSmooth.distanceTo(orbit(cam.lift, camProbe)) > 60; // after a teleport, or a stretch of advance()
    cam.snap = false;
    if (jumped) { cam.lift = want.lift; cam.liftHold = 0; }
    else if (want.lift > cam.lift) { cam.lift = Math.min(want.lift, cam.lift + Math.min((want.lift - cam.lift) * dt * 6, dt * 2)); cam.liftHold = 0.5; }
    else if ((cam.liftHold -= dt) <= 0) cam.lift = Math.max(want.lift, cam.lift - Math.min((cam.lift - want.lift) * dt * 2, dt * 0.5));
    const f = clear(camTarget, orbit(cam.lift, camPos)), pull = f < 1 ? Math.max(0.15, f - 0.04) : 1;
    if (jumped) cam.pull = pull;
    else cam.pull += pull < cam.pull ? -Math.min(cam.pull - pull, Math.max(dt * 2, (cam.pull - pull) * dt * 4)) : Math.min(pull - cam.pull, dt * 0.8);
    if (cam.pull < 1) camPos.lerpVectors(camTarget, camPos, cam.pull);
    // pulled in that close by a wall, it may be over a car: then it looks down over the roof
    for (const q of near) if (OECars.pushOut(camPos.x, -camPos.z, q.z + 0.5, 0.35, [q]).hit) camPos.y = Math.max(camPos.y, q.z + q.top + 0.45);
    if (jumped || camSmooth.distanceTo(camPos) > 60) camSmooth.copy(camPos);
    camSmooth.lerp(camPos, close ? Math.min(1, dt * 10) : veh ? Math.min(1, dt * 16) : 1);
    camPos.copy(camSmooth);
    // the floor under the camera: the ground (or the water; under a slab, the floor) at once, steps and
    // decks below the player's head eased in, so walking onto a stair or a deck lifts the view smoothly
    const ground = Math.max(0, nav.terrainBelow(camPos.x, -camPos.z, camTarget.y + 0.5));
    let gz = ground;
    for (const st of nav.strips) {
      const h = nav.stripHeight(st, camPos.x, -camPos.z);
      if (h != null && h < camTarget.y + 0.5 && h > gz) gz = h;
    }
    nav.decksAt(camPos.x, -camPos.z, h => { if (h < camTarget.y + 0.5 && h > gz) gz = h; });
    const y0 = camPos.y;
    cam.floor = jumped || cam.floor == null ? gz : cam.floor + (gz - cam.floor) * Math.min(1, dt * 8);
    camPos.y = Math.max(camPos.y, ground + 0.5, cam.floor + 0.5);
    const ceil = nav.ceilingAt(camPos.x, -camPos.z, camTarget.y - 1); // under a slab (a colonnade): below its soffit
    if (ceil !== null && camPos.y > ceil - 0.2) camPos.y = Math.max(ground + 0.5, ceil - 0.2);
    // lifted over steps (a stairwell's flight beside a colonnade), the line to the head can graze what the
    // probe went round, the edge of the slab over the well: then closer in along it
    if (camPos.y !== y0 && player.mode === 'foot') {
      const f = nav.clearFraction(camTarget, camPos);
      if (f < 1) camPos.lerpVectors(camTarget, camPos.clone(), Math.max(0.15, f - 0.04));
    }
    live.pos.copy(camPos);
    live.look.copy(camTarget);
    // looking up at a landmark on arrival (cam.tilt): over your head, until you move, steer or drag the view
    if (cam.tilt > 0.001) {
      if (moving || clockT - cam.lastInput < 0.5 || !(player.mode === 'foot' || player.mode === 'car')) cam.tilt *= Math.max(0, 1 - dt * 2.5);
      live.look.y += Math.tan(cam.tilt) * Math.hypot(camPos.x - camTarget.x, camPos.z - camTarget.z);
    } else cam.tilt = 0;
    live.half = player.mode === 'heli' ? 520 : player.mode === 'ferry' ? 320 : veh ? 220 : 170;
  }
  // from your seat: the eye over the cushion, looking ahead as the car turns (drag to look
  // round; the look comes back ahead when let go)
  const eye = new THREE.Vector3();
  function cabinView(dt, o, st) {
    const seat = o === myCar ? 'driver' : kerbSeat, back = clockT - cam.lastInput > 1.2 ? Math.max(0, 1 - dt * 3) : 1;
    o.C.body.updateWorldMatrix(true, false); // where the car is this frame, not where it was last drawn
    // (from the back seat, leaning in towards the middle, as a passenger does to see the road between the front seats' headrests)
    const s0 = o.C.seats[seat];
    o.C.body.localToWorld(seat === 'driver' ? eye.copy(s0).add(new THREE.Vector3(0, 0.7, 0.08)) : eye.set(s0.x * 0.3, s0.y + 0.66, s0.z + 0.12));
    cam.yaw = st.h + angDiff(cam.yaw, st.h) * back;
    cam.pitch = 0.2 + (cam.pitch - 0.2) * back;
    const p = -(cam.pitch - 0.2) * 0.8 - 0.06;
    live.pos.copy(eye);
    live.look.set(eye.x + Math.sin(cam.yaw) * Math.cos(p) * 10, eye.y + Math.sin(p) * 10, eye.z - Math.cos(cam.yaw) * Math.cos(p) * 10);
    live.half = 170;
    camTarget.copy(eye); camSmooth.copy(eye);
  }

  // ------------------------------------------------------------ camera shots (cine.js)
  // the highest surface (roof, deck or ground) within a cell of (x, y), and along a line in 16 m blocks
  function roofBelow(x, y) {
    const c = Math.floor((x - DSM.x0) / DSM.cell), r = Math.floor((DSM.y1 - y) / DSM.cell);
    let top = 0;
    for (let i = r - 1; i <= r + 1; i++) for (let j = c - 1; j <= c + 1; j++) if (i >= 0 && j >= 0 && i < DSM.ny && j < DSM.nx) top = Math.max(top, DSM.data[i * DSM.nx + j]);
    return top;
  }
  function roofAlong(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12), bs = 8 * DSM.cell;
    let top = 0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n, bc = Math.floor((x - DSM.x0) / bs), br = Math.floor((DSM.y1 - y) / bs);
      if (bc >= 0 && br >= 0 && bc < DSM.bx && br < DSM.by) top = Math.max(top, DSM.M[br * DSM.bx + bc]);
    }
    return top;
  }
  // the chase camera's bearing, distance and height from the player's head
  const head = () => W(player.x, player.y, player.z + 1.55);
  const chasePolar = () => ({ az: cam.yaw + Math.PI, dist: Math.cos(cam.pitch) * cam.dist, h: Math.sin(cam.pitch) * cam.dist });
  const handOver = (k, from = 0.8) => OECine.ease.smooth(OECine.span(k, from, 1)); // weight of the live rig at the end of a shot
  // Start (#89): one eased move from the title shot down to over the player's shoulder, calm enough not to
  // make anyone dizzy. The camera dollies in along the bearing it is already on, turning about the player by
  // at most ARRIVE.turn, spread evenly over the whole move (so it never swings round them, spins or changes
  // direction), with the horizon level. Its distance closes on a log scale, so the approach is a steady glide
  // and not a rush at the end, and the point it looks at closes on the player at the same rate, so the view's
  // direction hardly turns. The player turns to face the way the shot looks, as near the start's own view as
  // that turn allows with a few steps clear in front. The camera lifts smoothly over any roof on its line,
  // never jumping. A key or a tap settles it in under a second (settleArrival); with reduced motion it is a
  // cut under a short fade. Moving is allowed throughout. onDone runs once it has handed over.
  const ARRIVE = { dur: 3.6, turn: 50 * Math.PI / 180, pitch: 14 * Math.PI / 180, settle: 0.7 };
  let arriving = null;
  const clearAhead = h => { // a few steps' walk in front of the player along bearing h
    let z = player.z;
    for (let d = 0.5; d <= 3; d += 0.5) { const w = nav.walk(player.x + Math.sin(h) * d, player.y + Math.cos(h) * d, z); if (!w.ok) return false; z = w.z; }
    return true;
  };
  // the chase bearing (behind the player) within ARRIVE.turn of az0 that is nearest to want, with room to walk on
  function calmBearing(az0, want) {
    const t = OECine.turn(az0, want);
    if (Math.abs(t) <= ARRIVE.turn && clearAhead(want - Math.PI)) return want;
    const c = [];
    for (let a = -ARRIVE.turn; a <= ARRIVE.turn + 1e-6; a += ARRIVE.turn / 5) c.push(az0 + a);
    c.sort((a, b) => Math.abs(OECine.turn(a, want)) - Math.abs(OECine.turn(b, want)));
    return c.find(a => clearAhead(a - Math.PI)) ?? c[0];
  }
  // The elevation of a camera move about a centre c (bearing az(k), range r(k), elevation e(k), k 0..1 over dur
  // seconds), raised where the line would pass within `clear` m (8) of a roof while the camera is over rMin away, and made
  // into an envelope that rises and falls no faster than rate (rad/s): the camera comes over a tower and down again
  // without a jolt. Near the player the chase camera's own clearance takes over. With e0, the first frame keeps
  // that elevation and any lift is eased in. Returns k -> elevation.
  function calmElevation({ c, az, r, e, dur, rate, e0 = null, rMin = 40, upto = 0.85, clear = 8 }) {
    const N = 60, el = new Float32Array(N + 1), tmp = new THREE.Vector3(), S = OECine.ease.smooth;
    for (let i = 0; i <= N; i++) {
      const k = i / N, rk = r(k);
      let ek = e(k);
      if (k < upto && rk > rMin) for (let n = 0; n < 14; n++) { // up in steps until it is 8 m over what is below it
        OECine.around(c, az(k), rk * Math.cos(ek), rk * Math.sin(ek), tmp);
        if (tmp.y >= roofBelow(tmp.x, -tmp.z) + clear || ek > 1.3) break;
        ek = Math.min(1.3, ek + 0.08);
      }
      el[i] = ek;
    }
    const step = rate * dur / N;
    for (let i = 1; i <= N; i++) el[i] = Math.max(el[i], el[i - 1] - step);
    for (let i = N - 1; i >= 0; i--) el[i] = Math.max(el[i], el[i + 1] - step);
    const early = e0 != null ? el[0] - e0 : 0; // how far above the first frame the roofs want it straight away
    if (early > 0) { const M = N / 3; for (let i = 0; i <= M; i++) el[i] -= early * (1 - S(i / M)); }
    const fn = k => { const f = Math.max(0, Math.min(N, k * N)), i = Math.floor(f), j = Math.min(N, i + 1); return el[i] + (el[j] - el[i]) * (f - i); };
    fn.late = el[N] - e(1); // how far above its own last elevation the roofs held it: more time is needed to come down calmly
    fn.max = Math.max(...el); // the steepest it gets
    fn.early = early;
    return fn;
  }
  function craneIn(onDone = null) {
    const H0 = head(), lk0 = titleLook.clone().sub(H0), p0 = OECine.polar(H0, camera.position);
    const shot = openingHere(), dur = shot ? OPENING.dur : ARRIVE.dur;
    if (shot) player.h = OPENING.face; // (the start's own view: the shot was framed behind it)
    const best = calmBearing(p0.az, player.h + Math.PI);
    player.h = best - Math.PI;
    cam.mode = 'chase'; cam.yaw = player.h; cam.pitch = 0.36; cam.dist = 7.5; cam.tilt = 0;
    camSmooth.set(0, 0, 0);
    const p1 = chasePolar(), az1 = p0.az + OECine.turn(p0.az, p1.az);
    const r0 = Math.max(10, Math.hypot(p0.dist, p0.h)), r1 = Math.hypot(p1.dist, p1.h), e0 = Math.atan2(p0.h, p0.dist), e1 = Math.atan2(p1.h, p1.dist);
    const S = OECine.ease.smooth, pos = new THREE.Vector3(), lk = new THREE.Vector3();
    const rAt = k => r0 * Math.pow(r1 / r0, S(k)), azAt = k => p0.az + (az1 - p0.az) * S(k);
    const elAt = calmElevation({ c: H0, az: azAt, r: rAt, e: k => e0 + (e1 - e0) * S(k), dur, rate: ARRIVE.pitch, e0, clear: shot ? 24 : 8 }); // (an opening shot passes over the roofs' screens and signs, which the DSM leaves out)
    // the title's point of interest, closing on the player faster than the camera; in an opening shot held on
    // it (the screens) while the camera comes down to the street, then down to the player: the crane's tilt
    const lkW = shot ? k => 1 - S(OECine.span(k, 0.4, 0.92)) : (k, r) => Math.pow(r / r0, 1.5);
    const path = k => {
      const c = head(), r = rAt(k), e = elAt(k);
      OECine.around(c, azAt(k), r * Math.cos(e), r * Math.sin(e), pos);
      lk.copy(lk0).multiplyScalar(lkW(k, r)).add(c);
      return { pos, look: lk };
    };
    arriving = { onDone, settling: false };
    if (reduced) { stage.classList.remove('arrive-fade'); void stage.offsetWidth; stage.classList.add('arrive-fade'); }
    cine.play(OECine.mix(path, () => live, k => handOver(k)), dur, { label: 'crane', onEnd: () => { if (arriving && !arriving.settling) arrived(); } });
  }
  function arrived() {
    const a = arriving;
    arriving = null;
    if (a && a.onDone) a.onDone();
  }
  // a key or a tap during the arrival: ease from where the camera is to the chase camera, quickly but not a cut
  function settleArrival() {
    if (!arriving || arriving.settling || !cine.active || cine.label !== 'crane') return;
    arriving.settling = true;
    const from = { pos: camera.position.clone(), look: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.max(5, camera.position.distanceTo(head()))).add(camera.position) };
    cine.play(OECine.mix(() => from, () => live, k => OECine.ease.smooth(k)), ARRIVE.settle, { label: 'crane', onEnd: arrived });
  }
  // A lift: the camera climbs the tower's face (or comes down it) while the player rides, at the lift's own
  // speed with the time shortened, and hands back to the chase camera at the far stop, facing on.
  function rideLift(l, from, to) {
    const a = l.stops[from], b = l.stops[to], dz = b.at[2] - a.at[2];
    const realS = Math.abs(dz) / ((l.m_per_min || 240) / 60), dur = Math.min(9, Math.max(4.5, realS / 6));
    const A = head(), B = W(b.at[0], b.at[1], b.at[2] + 1.55), c = new THREE.Vector3(), p0 = OECine.polar(A, camera.position);
    const out = Math.max(70, Math.abs(dz) * 0.35), up = Math.max(p0.h, 12);
    const path = OECine.spiral({ center: k => c.lerpVectors(A, B, OECine.ease.inOut(k)), az: [p0.az, p0.az + 1.1], dist: [Math.max(p0.dist, 20), out], h: [up, 18], e: { dist: 'out' } });
    H.toast(`<b>${l.line || l.name}</b><span>${b.name}: ${Math.round(Math.abs(dz))} m in ${Math.round(realS)} s at ${l.m_per_min || 240} m a minute</span>`);
    cine.play(OECine.mix(path, () => live, k => handOver(k, 0.8)), dur, { label: 'hop',
      cues: [[0.5, () => {
        [player.x, player.y, player.z] = b.at;
        if (b.face) player.h = Math.atan2(b.face[0], b.face[1]);
        player.speed = 0; player.vz = 0; player.ground = true;
        cam.mode = 'chase'; cam.yaw = player.h; cam.pitch = 0.3; cam.dist = 6.5;
        groundLod(player.x, player.y);
        save();
      }]],
      onEnd: () => H.toast(`${b.name}.`) });
  }

  // Fast travel: rise over the player, fly across the city at a height that grows with
  // the distance, and come down behind them facing the way they flew. The player moves
  // at the top of the climb, out of sight.
  // (opts.cue, if given, moves whatever is travelling at the top of the climb instead of you; quiet: no arrival toast)
  const HOP_TURN_RATE = 45 * Math.PI / 180, HOP_PITCH_RATE = 30 * Math.PI / 180; // rad/s
  function hopTo(x, y, z, name, opts = {}) {
    const span = Math.hypot(x - player.x, y - player.y), bearing = Math.atan2(x - player.x, y - player.y);
    const roofs = roofAlong(player.x, player.y, x, y) - player.z; // cruise well clear of the tallest roof on the way
    const alt = Math.max(THREE.MathUtils.clamp(140 + span * 0.12, 180, 520), roofs + 110), top = { dist: alt * 0.84, h: alt }, az = bearing + Math.PI;
    const A = head(), B = W(x, y, z + 1.55), p0 = OECine.polar(A, camera.position), c = new THREE.Vector3();
    // the camera's bearing about the player turns once, evenly over the whole hop, and never faster than
    // HOP_TURN_RATE at its peak (#89): to frame a landmark (opts.yaw) the hop takes longer if it must; otherwise
    // it comes down only as far round towards the way you flew as that rate allows in the time
    const pe = opts.pitch ?? 0.36;
    let dur = Math.min(4.6, 3.2 + span / 2000), turnBy = OECine.turn(p0.az, opts.yaw != null ? opts.yaw + Math.PI : az);
    const peak = t => 1.875 * Math.abs(t) / dur; // the smootherstep's top speed
    if (opts.yaw != null) dur = Math.min(6.5, Math.max(dur, 1.875 * Math.abs(turnBy) / HOP_TURN_RATE));
    else if (peak(turnBy) > HOP_TURN_RATE) turnBy = Math.sign(turnBy) * HOP_TURN_RATE * dur / 1.875;
    const azAt = k => p0.az + turnBy * OECine.ease.smooth(k), azEnd = azAt(1);
    // up and down on a log scale of the range; the elevation one gentle rise to eT by 45% of the way and one fall to
    // the chase camera's, raised over the roofs on the way down (calmElevation): no plunge at the end
    const pos = new THREE.Vector3(), lk = new THREE.Vector3(), E = OECine.ease, L = OECine.lerp;
    const r0 = Math.max(2, Math.hypot(p0.dist, p0.h)), e0 = Math.atan2(p0.h, p0.dist), rT = Math.hypot(top.dist, top.h), eT = Math.atan2(top.h, top.dist), r1 = 7.5;
    const a = 0.26, b = 0.6, km = 0.45;
    // (out of the street it cranes up over the player's head before it pulls back: the range grows late in the rise)
    const rAt = k => (k < a ? r0 * Math.pow(rT / r0, E.in(OECine.span(k, 0, a))) : k < b ? rT : rT * Math.pow(r1 / rT, E.smooth(OECine.span(k, b, 1))));
    let eTop = eT; const peL = pe; // the elevation at the top, and the chase camera's pitch on landing
    const eBase = k => (k < km ? L(e0, eTop, E.smooth(k / km)) : L(eTop, peL, E.smooth(OECine.span(k, km, 1))));
    // Over tall roofs the way down has to be steeper. The top then already holds the steepest it will need, so the
    // camera only ever tilts one way on the way down; the hop takes the time it needs to tilt back calmly (to 6.5 s),
    // and the hand-over to the chase camera (the last 22%) takes what is left
    const fallOf = d => calmElevation({ c: B, az: k => azAt(L(b, 1, k)), r: k => rAt(L(b, 1, k)), e: k => eBase(L(b, 1, k)), dur: d * (1 - b), rate: HOP_PITCH_RATE, rMin: 14, upto: 0.7 });
    const riseOf = d => calmElevation({ c: A, az: k => azAt(L(0, a, k)), r: k => rAt(L(0, a, k)), e: k => eBase(L(0, a, k)), dur: d * a, rate: HOP_PITCH_RATE, rMin: 14, upto: 1, e0 });
    let fallEl = fallOf(dur), riseEl = riseOf(dur);
    for (let n = 0; n < 4; n++) {
      eTop = Math.min(1.2, Math.max(eT, fallEl.max, riseEl(1)));
      const short = Math.max(fallEl.late, riseEl.early); // the roofs want more tilt than the time allows
      if (short > 0.02 && dur < 6.5) dur = Math.min(6.5, dur + 1.3 * short / HOP_PITCH_RATE);
      fallEl = fallOf(dur); riseEl = riseOf(dur);
    }
    const path = k => {
      const ctr = k < a ? A : k < b ? c.lerpVectors(A, B, E.inOut(OECine.span(k, a, b))) : head(), r = rAt(k);
      const e = k < a ? Math.max(eBase(k), riseEl(k / a)) : k < b ? eBase(k) : Math.max(eBase(k), fallEl(OECine.span(k, b, 1)));
      OECine.around(ctr, azAt(k), r * Math.cos(e), r * Math.sin(e), pos);
      return { pos, look: lk.copy(ctr) };
    };
    const yawEnd = azEnd - Math.PI; // where the chase camera will be: behind the player, facing on
    cine.play(OECine.mix(path, () => live, k => handOver(k, 0.78)), dur, { label: 'hop',
      cues: [[a, opts.cue ? () => { opts.cue(); if (opts.yaw == null) cam.yaw = yawEnd; if (peL > pe + 0.01) cam.pitch = peL; groundLod(x, y); } : () => {
        [player.x, player.y, player.z] = [x, y, z];
        player.h = yawEnd; player.speed = 0; player.vz = 0; player.ground = true;
        cam.mode = 'chase'; cam.yaw = yawEnd; cam.pitch = peL; cam.dist = 7.5;
        groundLod(x, y);
        save();
      }]],
      onEnd: () => { if (!opts.quiet) H.toast(`You're at ${name}.`); } });
  }

  function onFerryEvent(ev) {
    const v = ev.v, mine = player.vehicle === v;
    const near = Math.hypot(v.x - player.x, v.y - player.y) < 700;
    if (ev.type === 'depart') { if (near) A.horn(); if (mine) H.toast(`Departing for ${wharfById(fer.nextStop(v)).name}.`); }
    if (ev.type === 'arrive' && mine) H.toast(`${wharfById(ev.at).name}. <kbd>E</kbd> to get off.`);
    if (ev.type === 'helm' && mine) H.toast('Approaching the wharf. You have the helm: W/S throttle, A/D rudder. Come alongside under 1.2 m/s.');
    if (ev.type === 'scrape' && mine && clockT - bumpT > 2) { bumpT = clockT; H.toast('Scraped the seawall. Ease off and steer clear.'); }
    if (ev.type === 'docked' && mine) {
      const sc = Math.max(10, ev.score);
      lastDock = sc;
      H.toast(`<b>Made fast!</b> Docking score ${sc}/100.`, 'stamp');
      A.chime();
      if (sc >= 60 && !qs.stamps.some(s => s.id === 'ferry-master')) { qs.stamps.push({ id: 'ferry-master', stamp: 'Ferry master', title: 'Docked by hand', at: fmtMin(clock.min) }); renderPassport(); save(); A.thump(); H.stamp('Ferry master', 'Docked by hand'); }
    }
    if (ev.type === 'helm' && mine) v.helm.started = clockT;
  }

  function vehicleHud() {
    const el = $('#g-vhud');
    if (touch) {
      $('#gt-down').hidden = player.mode === 'ferry' || player.mode === 'ride';
      $('#gt-down').textContent = player.mode === 'heli' ? 'Down' : player.mode === 'car' ? 'Horn' : 'Guess';
      $('#gt-jump').textContent = player.mode === 'heli' ? 'Up' : player.mode === 'car' ? 'Hand brake' : 'Jump';
    }
    if (player.mode === 'heli') {
      const st = heli.st, g = nav.groundBelow(st.x, st.y, st.z);
      el.hidden = false;
      el.innerHTML = `<div><b class="num">${Math.round(st.z)} m</b><span>altitude</span></div><div><b class="num">${Math.round(st.z - g)} m</b><span>above ground</span></div>
        <div><b class="num">${Math.round(st.speed * 3.6)}</b><span>km/h</span></div><div><b class="num">${Math.round(st.rotor * 100)}%</b><span>rotor</span></div>
        <p class="note">${st.rotor < 0.9 ? `<b>Rotor spooling up: it lifts at 90%</b> · ` : ''}Space climb · C descend · W/S · A/D turn · V ${VIEWS[nextViewOf(cam.mode)][1]}${st.landed ? ' · E get out' : ''}</p>`;
    } else if (player.mode === 'ferry') {
      const v = player.vehicle, nxt = wharfById(fer.nextStop(v));
      const t = v.phase === 'dwell' ? v.t : fer.eta(v, nxt.id);
      el.hidden = false;
      el.innerHTML = `<div><b>${v.name}</b><span>${v.route}</span></div><div><b>${v.phase === 'dwell' ? 'Departs' : nxt.name}</b><span>${v.phase === 'dwell' ? `in ${fmtSec(t)}` : `in ${fmtSec(t)}`}</span></div>
        <div><b class="num">${(Math.abs(v.speed) * 1.94).toFixed(0)}</b><span>knots</span></div>${v.helm && v.helm.manual ? `<div><b class="num">${Math.round(v.helm.dist || 0)} m</b><span>to berth</span></div>` : ''}
        <p class="note">${v.phase === 'dwell' ? 'E get off · ' : ''}F ${skip ? 'normal speed' : 'skip ahead'} · H take the helm · drag to look around</p>`;
    } else if (player.mode === 'car') {
      const st = myCar.D.st;
      el.hidden = false;
      el.innerHTML = `<div><b class="num">${Math.round(st.speed * 3.6)}</b><span>km/h</span></div><div><b class="num">${st.gear === 0 ? 'R' : st.speed < 0.3 ? 'N' : st.gear}</b><span>gear</span></div>
        <div><b class="num">${Math.round(st.z)} m</b><span>altitude</span></div><div><b class="num">${Math.round(st.rpm * 7000 / 100) * 100}</b><span>rpm</span></div>
        <p class="note">W/S drive, brake, reverse · A/D steer · Space handbrake · H horn · V ${cam.mode === 'cabin' ? 'chase view' : 'from the seat'} · R back on the road${st.speed < 1.5 ? ' · E get out' : ''}</p>`;
    } else if (player.mode === 'ride' && ride) {
      const o = ride, st = o.drv.st;
      el.hidden = false;
      el.innerHTML = `<div><b>${o.name}</b><span>${o.kind === 'taxi' ? 'taxi' : rideCar(o)}${o.kind === 'hire' ? ` · ${o.plate}` : ''}</span></div><div><b>${o.dest ? o.dest.name : 'Where to?'}</b><span>${o.phase === 'driving' ? `in ${fmtSec(eta(o))}` : o.phase === 'arrived' ? 'here' : ''}</span></div>
        <div><b class="num">${o.phase === 'driving' ? (o.drv.remaining() / 1000).toFixed(1) : '0.0'} km</b><span>to go</span></div><div><b class="num">${Math.round(st.v * 3.6)}</b><span>km/h</span></div>
        <p class="note">${o.phase === 'driving' ? 'F skip the trip · ' : ''}V ${cam.mode === 'cabin' ? 'chase view' : 'from the back seat'} · drag to look around${st.v < 0.5 && o.phase !== 'asking' ? ' · E get out' : ''}</p>`;
    } else if (player.mode === 'foot' && ride && (ride.phase === 'coming' || ride.phase === 'waiting')) {
      const o = ride;
      el.hidden = false;
      const walk = Math.hypot(o.pickup.x - player.x, o.pickup.y - player.y);
      el.innerHTML = `<div><b>${o.name}</b><span>${o.kind === 'taxi' ? 'taxi' : `${rideCar(o)} · ${o.plate}`}</span></div><div><b class="num">${o.phase === 'coming' ? (eta(o) < 4 ? 'now' : fmtSec(Math.ceil(eta(o)))) : 'here'}</b><span>${o.phase === 'coming' ? 'arriving' : 'at the pick-up'}</span></div>
        ${walk > 20 ? `<div><b class="num">${Math.round(walk)} m</b><span>walk to the pick-up</span></div>` : ''}
        <p class="note">${o.phase === 'coming' ? (walk > 20 ? 'Follow the route to the pick-up. ' : 'Wait at the kerb. ') : 'E beside it to get in. '}N your phone${o.kind === 'hire' ? ': the map, or cancel.' : '.'}</p>`;
    } else if (player.mode === 'rail') {
      const c = player.vehicle, F = rail.funicular, here = rail.stationOf(c.id);
      el.hidden = false;
      el.innerHTML = `<div><b>${G.rail.funicular.name || 'Funicular'}</b><span>${c.name}</span></div><div><b class="num">${Math.round(c.z)} m</b><span>above the datum</span></div>
        <div><b class="num">${Math.round(Math.tan(Math.abs(c.pitch)) * 100)}%</b><span>gradient</span></div><div><b class="num">${(c.speed * 3.6).toFixed(0)}</b><span>km/h</span></div>
        <p class="note">${here ? (c.moved ? 'E get off · ' : `Departs in ${fmtSec(F.cyc.t)} · `) : ''}F ${skip ? 'normal speed' : 'skip ahead'} · drag to look around</p>`;
    } else el.hidden = true;
  }

  requestAnimationFrame(frame);
  function advance(seconds, hold = []) {
    for (const c of hold) keys.add(c);
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) {
      clockT += 1 / 30; U.uTime.value = clockT;
      if (!clock.frozen) { clock.min += clock.scale / 60 / 30; if (clock.min >= 1440) setClock(clock.y, clock.m, clock.d, clock.min); }
      simulate(1 / 30);
      if (cine.active) cine.step(clockT);
      if (closeup) closeupCamera(1 / 30); // (looking closer reads the held keys as it goes)
      fer.vessels.forEach(v => (v.events || []).splice(0).forEach(ev => onFerryEvent(ev)));
      if (i % 8 === 0) { sunTimer = 0; applySun(); const px = player.mode === 'heli' ? heli.st.x : player.x, py = player.mode === 'heli' ? heli.st.y : player.y;
        sunState = sun.altitude <= 0 ? 'night' : S.sunlit(DSM, px, py, player.mode === 'heli' ? heli.st.z + 1 : player.z + 1.6, sun) ? 'sun' : 'shade'; checkSteps(); }
    }
    for (const c of hold) keys.delete(c);
    weatherTick(seconds, false);
    // and the route, as a frame works it out (by the way you are going now)
    const titled = preTitle || !$('#g-title').hidden, ob = titled ? null : objective();
    updateRoute(clockT, waypoint || (ob && ob.at), ob, titled);
    routeShow(Infinity, titled);
    groundLod(player.mode === 'heli' ? heli.st.x : player.x, player.mode === 'heli' ? heli.st.y : player.y);
    camTarget.copy(player.mode === 'heli' ? W(heli.st.x, heli.st.y, heli.st.z + 2.5) : player.mode === 'ferry' ? W(player.vehicle.x, player.vehicle.y, 5) : W(player.x, player.y, player.z + 1.55));
    cam.snap = n > 1; // a stretch run without the camera lands it where it would have settled (a step at a time, it eases)
    if (closeup) closeupCamera(0); else updateCamera(1 / 30, false);
    cam.snap = false;
    camera.updateMatrixWorld();
  }
  // the recorder's handles (tools/flyover.js): the title pose, a scripted title camera, and the orbit restarted from the video's last frame
  const flyover = { titlePose, camera: o => { flyCam = o ? { pos: W(...o.cam), look: W(...o.look), shadow: o.shadow || 600 } : null; }, restart: () => fromFlyover() };
  window.__game = { shed, shedLevel: () => shedLevel, pxScale: () => pxScale, walkCalls, npcsReady, neon, mirror, busy, sound: () => (SND ? { junction: sndJ ? sndJ.id : null, walk: !!(sndJ && sndJ.arms.some(a => junctions.walk(a))), near: sndCount } : null), crowdAuto: v => { crowdAuto = v !== false; applyDensity(); }, t: () => clockT, arriving: () => !!arriving, settleArrival, musterScramble, opening: () => OPENING, openingHere, startTour, welcome, onboard: OEOnboard, route: { get mode() { return routeMode; }, set: setRouteMode, peek: peekRoute, PEEK: ROUTE_PEEK }, vlib, peopleLib: lib, posts, junctions, rideEta: () => (ride ? eta(ride) : 0), flyover, Wd, colonies, flocks, dayLimits, footNet, crowdNet, travelTo, travelGroups, standFor, seenNow, bodyOf, B, landmarks, GAIT, toggleMap, scene, mapPins: () => bigPins, mapView: () => ({ z: mapZ.z, cx: mapZ.cx, cy: mapZ.cy, names: bigNames.slice(), picked: !mapPop.hidden }), benches, sunWant, benchTalk, advance, atmos, dlg, cine, photo, photoMode, snapPhoto, hopTo, craneIn, live, VP, viewshed, survey, renderPassport, guess, guessStart, guessCheck, completeQuest, LINES, ls, tracked, cycleTrack, openLines, lastDock: () => lastDock, waypoint: w => { waypoint = w; }, player, myCar: () => myCar, ride: () => ride, kerbAction, hail, orderRide, cancelRide, boardRide, leaveRide, skipRide, enterCar, exitCar, bringCar, resetCar, destinations, roads, carBoxes, phoneShow, KEEP, heli, helipads: G.helipads, fer, rail, npcs, crowd, cars, nav, clock, setClock, qs: () => qs, quest, step, completeStep, talkTo, board, alight, interact, enterHeli, exitHeli, spawn, objective, lens, camera, cam, DSM, G, ways, gold, guide: () => guide, roadNet, currentAction, keys, lifts, rideLift, deckOf, deckStand, places, lookAt, care, weather, crowdDraw: () => crowdDraw };
  return {
    stop() { running = false; ac.abort(); ro.disconnect(); care.dispose(); if (atmos) atmos.dispose(); if (weather) weather.dispose(); renderer.dispose(); Wd.dispose(); A.stop(); window.__game = null; },
  };
};
