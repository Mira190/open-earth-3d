// Open Earth 3D game: walk a real city, talk to people, take the ferry, fly the
// helicopter. The world is the same open-data model as the viewer (world.js), lit by
// the same sun (sun.js) in the city's own time zone. Everything the NPCs say about the
// city is computed from the model: heights and their sources, sun on public places,
// the bridge's geometry.
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
  $('#gm-links').innerHTML = (G.links || []).map(l => `<a class="btn" href="#play-${l.id}">${l.name}</a><span class="note">${l.how || ''}</span>`).join('');
  const stage = $('#game-stage'), canvas = $('#game-gl');
  // the device's tier (quality.js): pixels, MSAA, shadows and how much detail the world carries;
  // reversed depth (where the GPU has EXT_clip_control) with the post stack's float depth buffer (atmosphere.js)
  const QC = window.OEQuality.city();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: QC.antialias, powerPreference: 'high-performance', reversedDepthBuffer: true });
  const BASE_FOV = 55, camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.3, 40000);
  let atmos = null; // clouds, stars, the moon and the post stack (atmosphere.js), once the world is up
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setPixelRatio(QC.pixelRatio(w, h));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (atmos) atmos.setSize(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  const Wd = await OEWorld.create(D, renderer, { onMsg: loadMsg, small: QC.small, shadow: QC.shadow });
  const world = Wd.world, U = Wd.U;
  const show = window.OELights ? OELights.create(world, D, Wd) : null; // the city's nightly light show, if it has one
  atmos = window.OEAtmos ? OEAtmos.create(Wd, renderer, camera, { city: D.scene.city, sky: G.sky || {} }) : null;
  if (atmos) { const z = renderer.getSize(new THREE.Vector2()); atmos.setSize(z.x, z.y); }
  if (atmos && atmos.composer) {
    Wd.skyHaze = true; // fog mixed before the tone curve: the haze takes the sky's colour (world.js)
    Wd.world.fog.near = 1500; Wd.world.fog.far = 24000; // and a little of it over the far city, for depth
    if (renderer.capabilities.reversedDepthBuffer) U.uNudge.value = 1.5e-5; // a float depth buffer needs less to order coplanar roofs (buildings.js)
  }
  U.uTime = { value: 0 };
  // close up, 1 m aerial imagery is a blur: add fine noise that fades out with distance
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
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float camD = distance(vWP, cameraPosition);
float near = 1.0 - smoothstep(12.0, 70.0, camD);
if (uStreetOn > 0.5) { // drawn streets near the camera: no blur, no shadows baked into the photo
  vec4 st = sRGBTransferEOTF(texture2D(uStreet, vMapUv));
  diffuseColor.rgb = mix(diffuseColor.rgb, st.rgb, st.a * (1.0 - smoothstep(35.0, 140.0, camD)) * 0.92);
}
float grain = vn(vWP.xz * 2.7) * 0.55 + vn(vWP.xz * 9.0) * 0.3 + vn(vWP.xz * 0.6) * 0.15;
diffuseColor.rgb *= mix(1.0, 0.82 + 0.34 * grain, near * 0.75);`);
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
    for (const f of foot) { path(f.p); g.strokeStyle = '#c4beb2'; g.lineWidth = (FOOTW[f.c] || 3) / PX; g.stroke(); }
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
    const m = new THREE.Mesh(g, coarse.material);
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
  // landmark solids (the Opera House shells) and walkable strips (the bridge deck) shade the ground too
  for (const [name, m] of Object.entries(nav.tops)) if ((G.shade_landmarks || []).some(p => name.startsWith(p))) for (const [k, z] of m) if (z > DSM.data[k]) DSM.data[k] = z;
  for (const s of nav.strips) for (let i = 0; i < s.us.length - 1; i++) {
    const a = s.us[i], b = s.us[i + 1], w = s.half_width, P2 = (u, v) => [s.origin[0] + s.axis[0] * u - s.axis[1] * v, s.origin[1] + s.axis[1] * u + s.axis[0] * v];
    S.fillMax(DSM, [[...P2(a, -w), ...P2(b, -w), ...P2(b, w), ...P2(a, w)]], Math.max(s.zs[i], s.zs[i + 1]), -3);
  }
  // the helicopter, ferries and cars every city shares (vehicles.js); the box-built ones if they can't be loaded
  let vlib = null;
  try { vlib = await OEVehicles.load('assets/vehicles/', { ferry: (G.ferries || []).length > 0 && (G.ferry_style || {}) }); } catch (e) { console.warn('Vehicle models unavailable, using simple ones:', e); }
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
  if (Wd.trees && Wd.trees.reseat) Wd.trees.reseat((x, y) => { const g = nav.terrain(x, y); return g > 0 ? g : null; });
  // where someone or a car beside a mapped line stands: its deck, or the ground drawn there (null on the bank of the water)
  const lineGround = (x, y, at) => (at.deck ? at.z : nav.offGround(x, y) ? null : nav.terrain(x, y));

  // ------------------------------------------------------------ street furniture: benches, lamps that light at night
  loadMsg('People, traffic and ferries: downloading the models every city shares', 0.86);
  await idle();
  const lin = OEWorld.lin, dummy = new THREE.Object3D();
  const footNet = OEActors.network(G.paths.foot), roadNet = OEActors.network(G.paths.road);
  // benches face their footway, or the water behind it; each has two seats the crowd can use
  const benches = OEActors.benches(G.props.bench || [], footNet, nav), lamps = G.props.street_lamp || [];
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
  world.add(benchMesh, poleMesh, headMesh, glows);

  // ------------------------------------------------------------ people and traffic
  // realistic characters (people.js); the box-built rigs are the fallback if their files can't be loaded
  const PLAYER_KEY = 'oe3d-player', PLAYER_LOOKS = {
    W_Worker: { character: 'W_Worker', skin: '#d49c76', hair: '#33241b', scale: 0.92 },
    M_Worker: { character: 'M_Worker', skin: '#e3b08d', hair: '#4a3222', scale: 0.97 } };
  for (const [k, v] of Object.entries(G.player_looks || {})) if (PLAYER_LOOKS[k]) Object.assign(PLAYER_LOOKS[k], v); // a city's own look for the player
  let playerChar = 'W_Worker';
  try { if (PLAYER_LOOKS[localStorage.getItem(PLAYER_KEY)]) playerChar = localStorage.getItem(PLAYER_KEY); } catch (e) { /* storage blocked */ }
  let lib = null;
  try {
    lib = await OEPeople.load('assets/people/');
    if ((G.crowd || {}).style) OEPeople.setStyle(G.crowd.style);
    // the surveyors you play are the main characters (blender/build_people.py): the one you play now
    // loads here, the other when you switch; the old characters stand in if their files don't load
    for (const [k, h] of Object.entries({ W_Worker: 'H_Surveyor_W', M_Worker: 'H_Surveyor_M' })) if (lib.heroes[h]) PLAYER_LOOKS[k].hero = h;
    const pl = PLAYER_LOOKS[playerChar];
    if (pl.hero) await lib.require(pl.hero).then(() => Object.assign(pl, { character: pl.hero, scale: 1 })).catch(e => console.warn(`${pl.hero} unavailable:`, e));
    await Promise.all([pl.character, ...G.npcs.map(n => n.look.character).filter(Boolean)].map(lib.require));
  } catch (e) { console.warn('Realistic people unavailable, using simple figures:', e); lib = null; }
  const makeRig = (look, opts) => (lib && look.character && lib.tpl[look.character] ? OEPeople.person(lib, Object.assign({}, look)) : OEActors.makePerson(look, opts));
  const CR = G.crowd || {};
  // the box-built fallback figures can't sit, so only the realistic crowd uses the benches
  const crowd = OEActors.crowd(world, footNet, U, CR.pedestrians || 300, CR.radius_m || 450, lib && (P => OEPeople.crowdRenderer(world, lib, U, P, { near: touch ? 6 : 14, style: CR.style })),
    { benches: lib ? benches : null, ground: lineGround });
  // the side of the road the city keeps to: game.keep, its trams', or the country's rule
  const KEEP = G.keep || ((G.rail || {}).tram || {}).keep || (/^(Australia|Japan|United Kingdom|Ireland|New Zealand|Singapore|Malaysia|Indonesia|Thailand|India|South Africa)$/.test(CITY.country)
    || /^(Hong Kong|Macau)/.test(CITY.name) ? 'left' : 'right');
  const cars = OEActors.traffic(world, roadNet, U, CR.cars || 120, (CR.radius_m || 450) + 100, { lib: vlib, cfg: (G.vehicles || {}).cars || {}, eye: camera, keep: KEEP, ground: lineGround, crowd, nav });
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
  for (const n of G.npcs) {
    const rig = makeRig(Object.assign({ scale: (n.look.character || '')[0] === 'W' ? 0.91 : 0.96 }, n.look));
    world.add(rig.root);
    // on the ground, or a strip or roof below 200 m (not up on a viaduct passing over), or at the height given;
    // off a bank sloping into the water, and not on someone else's toes
    let f = nav.floorAt(n.at[0], n.at[1], n.at[2] != null ? n.at[2] + 1 : Math.max(200, nav.terrain(n.at[0], n.at[1]) + 1));
    if (f && f.kind === 'deck' && n.at[2] == null) f = nav.floorAt(n.at[0], n.at[1], nav.terrain(n.at[0], n.at[1]) + 1);
    const p = nav.stand(n.at[0], n.at[1], f ? f.z + 0.5 : Math.max(0, nav.terrain(n.at[0], n.at[1])) + 1,
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

  // ------------------------------------------------------------ vehicles
  const vopts = { lib: vlib, cfg: G.vehicles || {}, city: CITY, U, camera, renderer, water: Wd.sea };
  const padAt = (G.helipads[0] || { at: [G.start.at[0] + 20, G.start.at[1], 2] }).at;
  const heli = OEVehicles.helicopter(world, nav, padAt, vopts);
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
  // the driver takes you by road, talking about what you pass, all of it from the model. F skips
  // the trip, as in GTA V.
  const keepSign = KEEP === 'left' ? 1 : -1, kerbSeat = KEEP === 'left' ? 'rear_left' : 'rear_right';
  const CARS_OK = !!(vlib && vlib.cars && Object.values(vlib.info.cars.models).some(m => m.seats));
  const carCfg = Object.assign({ model: 'Car_Hatch', colour: '#c8372d', seat: '#34363a' }, (G.vehicles || {}).car);
  const roads = OECars.router(roadNet), headlamp = CARS_OK ? OECars.headlamp(world) : null, rq = {};
  // a pose at the kerb of a place on the roads (router.place), facing the way it goes
  function kerbPose(pl, off) {
    roadNet.at(pl.line, pl.s, rq);
    const hx = rq.hx * pl.dir, hy = rq.hy * pl.dir, k = (off ?? OECars.kerbOf(roadNet.L[pl.line].c)) * keepSign;
    const x = rq.x - hy * k, y = rq.y + hx * k, f = nav.floorAt(x, y, rq.z + 1);
    return { x, y, z: f ? f.z : rq.z, h: Math.atan2(hx, hy) };
  }
  // the kerb near (x, y) at about height z, a few metres along the road (so a car isn't put on top of you)
  function kerbNear(x, y, z, ahead = 9) {
    const pl = roads.place(x, y, 250, keepSign, z);
    if (!pl) return null;
    pl.s = Math.max(3, Math.min(roadNet.L[pl.line].len - 3, pl.s + ahead * pl.dir));
    return { pl, pose: kerbPose(pl) };
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
  { const z = nav.floorAt(G.start.at[0], G.start.at[1], Math.max(0, nav.terrain(G.start.at[0], G.start.at[1])) + 1), k = kerbNear(G.start.at[0], G.start.at[1], z ? z.z : null); if (k) parkMyCar(k.pose); }
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
  function stepOut(o, seat) {
    const st = stOf(o), d = doorAt(o, seat), p = placeNear(d.x, d.y, st.z + 0.5, carBoxes(st.x, st.y, 12));
    if (!p) return false;
    o.C.body.remove(player.rig.root); world.add(player.rig.root);
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
  function carStep(dt, fwd, side) {
    const D = myCar.D, st = D.st, ev = [];
    D.step(dt, { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, side)), handbrake: k('Space') },
      { boxes: carBoxes(st.x, st.y, 14, myCar), people: peopleNear(st.x, st.y, 12) }, ev);
    for (const e of ev) {
      if (e.speed > 2.5) A.thump();
      if (clockT - bumpCar < 2.5 || e.speed < 3) continue;
      bumpCar = clockT;
      if (e.type === 'bump') H.toast(e.what === 'person' ? 'Watch out for people!' : e.what === 'car' ? 'Careful! That was another car.' : 'Careful! That was a wall.');
      if (e.type === 'edge') H.toast(nav.isWater(st.x + Math.sin(st.h) * 5, st.y + Math.cos(st.h) * 5) ? `That's the edge of ${G.water_name || 'the water'}.` : 'Too steep a drop.');
    }
    Object.assign(player, { x: st.x, y: st.y, z: st.z, h: st.h, speed: st.speed });
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
  function driverLook() {
    const names = lib ? Object.keys(lib.tpl).filter(n => !PLAYER_LOOKS[n]) : [];
    return names.length ? OEPeople.randomLook(lib, names[Math.floor(Math.random() * names.length)], CR.style) : {};
  }
  // a ride (kind 'taxi' or 'hire') from a traffic car or a place on the roads, routed to the pick-up
  function newRide(kind, from, pickup, dest = null) {
    const tcfg = Object.assign({}, vlib.info.cars.liveries.taxi, ((G.vehicles || {}).cars || {}).taxi);
    const model = kind === 'taxi' ? 'Car_Taxi' : OEActors.pick(['Car_Sedan', 'Car_SUV', 'Car_Sedan', 'Car_Hatch']);
    const hex = from.hex || (kind === 'taxi' ? OEActors.pick(tcfg.colours) : OEActors.pick(['#1c1c1e', '#8a9099', '#3d4146', '#e7e5df', '#1f2a3a']));
    const rt = roads.route({ line: from.line, s: from.s, dir: from.dir }, pickup, 4000);
    if (!rt) return null;
    const C = OECars.car(world, vlib, model, { colours: { paint: hex, seat: kind === 'taxi' ? '#2b2d30' : '#b9ae9c' }, keep: KEEP });
    const o = { kind, C, model, hex, name: OEActors.pick(FIRST[CITY.country] || FIRST.Australia), plate: plate(), pickup, dest, phase: 'coming',
      t0: clockT, meter: 0, talkT: 0, wait: 0, pitch: 140 + Math.floor(Math.random() * 140) };
    o.drv = OECars.chauffeur(C, rt, { keep: keepSign, from: from.v ? 'lane' : 'kerb', v: from.v || 0 });
    o.driver = makeRig(driverLook(), {});
    C.sit(o.driver, 'driver');
    return o;
  }
  // one setting out from somewhere a few hundred metres off by road, out of sight
  function rideFromAround(kind, pickup, dest) {
    for (let k = 0; k < 8; k++) {
      const pl = roads.around(pickup.x, pickup.y, 170, 340);
      const o = pl && newRide(kind, pl, pickup, dest);
      if (o && o.drv.path.len < 1400) return o;
      if (o) o.C.dispose();
    }
    return null;
  }
  const eta = o => (o.phase === 'coming' || o.phase === 'driving' ? o.drv.remaining() / 9 + 3 : 0);
  // Y at the kerb: a hand up, and the nearest free taxi coming your way pulls in
  function hail() {
    if (player.mode !== 'foot' || player.auto) return;
    if (!CARS_OK) { H.toast('There are no taxis to hail here.'); return; }
    if (ride && ride.phase !== 'leaving') { H.toast(ride.phase === 'coming' ? `${ride.name} is on the way.` : `${ride.name} is waiting for you.`); return; }
    const pickup = roads.place(player.x, player.y, 40, keepSign, player.z);
    if (!pickup) { H.toast('Stand at the kerb of a street to hail a taxi.'); return; }
    if (player.rig.wave) player.rig.wave(clockT);
    let best = null;
    for (const c of cars.C) {
      if (!c.taxi || c.line < 0) continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d > 280 || d < 12) continue;
      const rt = roads.route({ line: c.line, s: c.s, dir: c.dir }, pickup, 800);
      if (rt && rt.len < 800 && (!best || rt.len < best.len)) best = { c, len: rt.len };
    }
    let o = null;
    if (best) {
      const c = best.c;
      o = newRide('taxi', { line: c.line, s: c.s, dir: c.dir, v: Math.max(1, c.v), hex: c.hex }, pickup);
      if (o) { cars.take(c); Object.assign(o.drv.st, { x: c.x, y: c.y, z: c.z, h: c.h }); }
    }
    if (!o) o = rideFromAround('taxi', pickup);
    if (!o) { H.toast('No taxis about. Try a busier street, or order a ride on your phone (N).'); return; }
    ride = o;
    A.honk();
    H.toast(best ? `A taxi has seen you: it'll pull in, about ${fmtSec(eta(o))} away.` : `A taxi is coming round the corner, about ${fmtSec(eta(o))} away.`);
  }
  // the phone: a private-hire car to where you say
  function orderRide(dest) {
    if (player.mode !== 'foot') { H.toast('Order once you are on foot.'); return; }
    if (ride && ride.phase !== 'leaving') { H.toast(`${ride.name} is already on the way.`); return; }
    const pickup = roads.place(player.x, player.y, 120, keepSign, player.z);
    if (!pickup) { H.toast('There is no street near enough to be picked up from.'); return; }
    const o = rideFromAround('hire', pickup, dest);
    if (!o) { H.toast('No drivers near you. Try again in a moment.'); return; }
    ride = o;
    H.toast(`<b>${o.name}</b> is on the way in a ${rideCar(o)}, ${o.plate}: about ${fmtSec(eta(o))}.`);
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
    if (ob && ob.at) add('objective', ob.title || 'The survey', ob.at, 'the survey');
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
    o.drv = OECars.chauffeur(o.C, rt, { keep: keepSign, from: 'kerb' });
    H.toast(`<b>${o.name}:</b> ${dest.name}, ${(rt.len / 1000).toFixed(1)} km by road. <kbd>F</kbd> to skip the trip.`);
  }
  // the car you are in, or have just got out of, pulls away and drives off
  function rideAway() {
    const o = ride;
    o.phase = 'leaving'; o.t0 = clockT;
    const pl = placeOf(o.drv.st), pts = pl ? roads.onward({ to: pl }, 260) : [];
    if (pts.length > 1) o.drv = OECars.chauffeur(o.C, { pts, end: false }, { keep: keepSign, from: o.drv.st.v > 1 ? 'lane' : 'kerb', v: o.drv.st.v });
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
    P.at(P.len, end);
    o.meter += o.drv.remaining();
    hopTo(end.x, end.y, end.z, o.dest.name, { cue: () => o.drv.finish(), quiet: true });
  }
  // what a ride's driver looks out for (cars.js chauffeur): the traffic, your car, you on foot
  function inTheWay(o) {
    const st = o.drv.st, out = [];
    for (const c of cars.C) if (c.line >= 0 && Math.abs(c.x - st.x) < 60 && Math.abs(c.y - st.y) < 60) out.push(c);
    if (myCar) out.push({ x: myCar.D.st.x, y: myCar.D.st.y, half: myCar.C.half });
    if (player.mode === 'foot' && o.phase !== 'coming') out.push(player);
    return out;
  }
  function rideStep(dt, night) {
    const o = ride, st = o.drv.st;
    o.drv.update(dt, inTheWay(o));
    o.C.place(st.x, st.y, st.z, st.h, st.pitch, 0);
    o.C.animate(dt, { v: st.v, h: st.h, steer: st.steer, brake: st.brake, signal: st.signal, hazard: o.phase === 'waiting' || o.phase === 'arrived', night, on: true,
      inside: player.vehicle === o && cam.mode === 'cabin',
      sign: o.kind === 'taxi' && (o.phase === 'coming' || o.phase === 'leaving') });
    o.driver.animate(dt, 0, 'sit', clockT);
    if (o.phase === 'driving') o.meter += st.v * dt;
    if (o.phase === 'coming' && st.done) {
      o.phase = 'waiting'; o.wait = 0;
      H.toast(`<b>${o.name}</b> has pulled in${o.kind === 'hire' ? ` in the ${rideCar(o)}, ${o.plate}` : ''}. <kbd>E</kbd> to get in.`);
      A.honk();
    }
    if (o.phase === 'waiting') {
      o.wait += dt;
      if (o.wait > (Math.hypot(st.x - player.x, st.y - player.y) > 90 ? 30 : 180) && player.mode === 'foot' && !player.auto) { H.toast(`${o.name} couldn't wait any longer.`); rideAway(); }
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
    if (o.phase === 'leaving' && (clockT - o.t0 > 45 || Math.hypot(st.x - player.x, st.y - player.y) > 240 || st.done)) { o.C.dispose(); ride = null; }
  }
  // the hail hint at the kerb (Y), beside whatever E does
  function kerbAction() {
    if (player.mode !== 'foot' || player.auto || !CARS_OK || (ride && ride.phase !== 'leaving') || player.speed > 1.8) return null;
    return roadNet.nearest(player.x, player.y, 11, player.z, 2.5) ? { key: 'Y', text: 'Hail a taxi', act: hail } : null;
  }

  // ------------------------------------------------------------ the phone (N): order a ride, bring your car
  const phone = { el: $('#g-phone'), body: $('#gph-body'), view: 'home', acts: [], at: 0 };
  function phoneShow(view) {
    if (view === false) { phone.el.hidden = true; return; }
    phone.view = view || (ride && ride.kind === 'hire' && ride.phase !== 'leaving' ? 'ride' : 'home');
    phone.el.hidden = false;
    phoneRender();
  }
  function phoneRender() {
    const acts = [], item = (text, note, act) => { acts.push(act); return `<button data-k="${acts.length - 1}"><kbd>${acts.length}</kbd><span><b>${text}</b>${note ? `<span class="note">${note}</span>` : ''}</span></button>`; };
    let html = '';
    if (phone.view === 'home') {
      $('#gph-title').textContent = 'Phone';
      html = `<div class="list">${item('Order a ride', ride && ride.kind === 'hire' && ride.phase !== 'leaving' ? `${ride.name} is on the way` : 'A car to wherever you say', () => phoneShow(ride && ride.kind === 'hire' && ride.phase !== 'leaving' ? 'ride' : 'where'))}`
        + `${myCar ? item('Bring my car', `It's ${Math.round(Math.hypot(myCar.D.st.x - player.x, myCar.D.st.y - player.y))} m away`, () => { bringCar(); phoneShow(false); }) : ''}</div>`
        + `<p class="note">Or raise your hand at the kerb (<kbd>Y</kbd>) and a taxi will pull in.</p>`;
    } else if (phone.view === 'where') {
      $('#gph-title').textContent = 'Ride · where to?';
      const list = destinations(player.x, player.y);
      html = `<div class="list">${list.map(d => item(d.name, d.note, () => { orderRide(d); phoneShow(ride ? 'ride' : false); })).join('')}</div>`
        + `<div class="row"><button class="btn" data-back>Back</button></div>`;
    } else {
      $('#gph-title').textContent = 'Ride';
      const o = ride && ride.kind === 'hire' ? ride : null;
      html = o ? `<div class="gph-card"><b>${o.name}</b><span>${rideCar(o)} · <span class="mono">${o.plate}</span></span><span>to ${o.dest ? o.dest.name : '–'}</span>
        <b class="num">${o.phase === 'coming' ? `${fmtSec(eta(o))} away` : o.phase === 'waiting' ? 'Waiting at the kerb' : o.phase === 'driving' ? `${fmtSec(eta(o))} to go` : o.phase === 'arrived' ? 'Arrived' : 'On the way'}</b></div>`
        + `<div class="list">${player.mode === 'foot' ? item('Cancel the ride', '', () => { cancelRide(); phoneShow('home'); }) : ''}</div>` : '<p class="note">No ride booked.</p>';
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
  const routeMat = new THREE.LineDashedMaterial({ color: lin('#ffc23d'), dashSize: 2.2, gapSize: 1.4, transparent: true, opacity: 0.95 });
  let routeLine = null;

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
  const SRC_TEXT = { mapped: 'its height is surveyed in OpenStreetMap', survey: 'its top level is surveyed by the mapping agency', lidar: 'its height was measured by an airborne LiDAR scan', '3dbag': 'its height was measured by the national airborne LiDAR and modelled in the 3DBAG', floors: 'its height is its floor count times a storey height', estimate: 'its height is estimated from its neighbours', typical: 'its height is the typical one for its kind (none is mapped)', plateau: 'its height was measured from the air for Project PLATEAU', plateau_lod1: 'its height is the block height in Project PLATEAU (no survey record)', bdtopo: 'its eaves were surveyed by IGN and its roof is the typical one',
    ml: 'its height is a machine-learning estimate, bias-corrected', reference: 'its height is the published figure (the open data was far too short)', verified: 'its height was checked by hand against a cited source', parametric: 'it is built from its published dimensions' };
  function smalltalk(x, y) {
    const opts = [`It's ${fill('{time}')}. ${sunLine()}`];
    // the nearest named building in view
    let best = null, bd = 160;
    for (const [name, p] of Object.entries(scene.labels || {})) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = name; } }
    if (best) {
      const m = B.b.find(b => b[0] && (b[0] === best || b[0].startsWith(best)));
      if (m) opts.push(`That's ${best}, ${Math.round(m[2])} m. ${SRC_TEXT[m[4]] ? SRC_TEXT[m[4]][0].toUpperCase() + SRC_TEXT[m[4]].slice(1) : ''}.`);
    }
    const w = G.wharves.reduce((a, q) => (Math.hypot(q.terminal[0] - x, q.terminal[1] - y) < (a ? Math.hypot(a.terminal[0] - x, a.terminal[1] - y) : 400) ? q : a), null);
    if (w) { const e = nextFerry(w.id); if (e) opts.push(`The next ferry from ${w.name} is ${e.v.name}, ${e.t < 5 ? 'boarding now' : `in ${fmtSec(e.t)}`}.`); }
    opts.push(...(G.smalltalk || [G.greeting || 'G\'day.', 'Lovely spot, isn\'t it?']));
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // ------------------------------------------------------------ clock: 30 times real time by default, as in GTA
  const clock = { y: CITY.year || new Date().getFullYear(), m: 3, d: 21, min: 600, scale: 30, frozen: false };
  let sun = null, clockUtc = Date.now();
  function setClock(y, m, d, min) {
    const t = new Date(Date.UTC(y, m - 1, d) + Math.floor(min / 1440) * 864e5);
    Object.assign(clock, { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), min: ((min % 1440) + 1440) % 1440 });
    applySun();
  }
  function applySun() {
    clockUtc = S.localToUtc(clock.y, clock.m, clock.d, clock.min);
    sun = S.position(clockUtc);
    Wd.setSun(sun, clock.min);
    Wd.setSeason(clock.m, clock.d);
    if (show) show.setClock(clock.min);
    const night = U.uNight.value;
    headMat.emissiveIntensity = 1.6 * night;
    glowMat.opacity = 0.85 * night;
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
    const out = { text: s.text, title: q.title, line: l };
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
    else { H.toast(`<b>Next:</b> ${questOf(l).steps[st.si].text}`); save(); }
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
    else { H.toast(`<b>${q.title}</b><span>${q.steps[0].text}</span>`); save(); }
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
    dlg.show(n, [fill(n.idle[Math.floor(Math.random() * n.idle.length)] || smalltalk(n.x, n.y))], null, finish);
  }
  function giveQuest(n, l, q) {
    dlg.show(n, q.talk.map(fill), q.choices, c => {
      n.talking = false;
      if (c && c.action === 'set_time') { const [m, d] = c.date; setClock(clock.y, m, d, S.hm(c.time)); H.toast(`Time set to ${c.time}, ${d} ${MONTHS[m - 1]}`); }
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
    routeFor = '';
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
    el.innerHTML = open.map(l => `<button data-line="${l.id}" aria-pressed="${l === cur}" title="Track this survey">${l.title || questOf(l).title}<span class="num">${ls(l).qi}/${l.quests.length}</span></button>`).join('')
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

  // ------------------------------------------------------------ GPS route over footways and roads (Dijkstra)
  const graph = (() => {
    const nodes = new Map(), xy = [], adj = [];
    const node = (x, y) => { const k = `${Math.round(x / 3)},${Math.round(y / 3)}`; if (!nodes.has(k)) { nodes.set(k, xy.length); xy.push([x, y]); adj.push([]); } return nodes.get(k); };
    const lines = [];
    for (const net of [footNet, roadNet]) for (const l of net.L) {
      if (l.c === 'motorway') continue; // no one walks the expressway
      const n = l.pts.length / 3, a = node(l.pts[0], l.pts[1]), b = node(l.pts[3 * n - 3], l.pts[3 * n - 2]);
      const li = lines.push(l) - 1;
      adj[a].push([b, l.len, li, 0]); adj[b].push([a, l.len, li, 1]);
    }
    const GC = 60, grid = new Map();
    xy.forEach(([x, y], i) => { const k = `${Math.floor(x / GC)},${Math.floor(y / GC)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const nearest = (x, y) => {
      let best = -1, bd = 150;
      for (let cx = Math.floor(x / GC) - 2; cx <= Math.floor(x / GC) + 2; cx++) for (let cy = Math.floor(y / GC) - 2; cy <= Math.floor(y / GC) + 2; cy++)
        for (const i of grid.get(`${cx},${cy}`) || []) { const d = Math.hypot(xy[i][0] - x, xy[i][1] - y); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    function route(ax, ay, bx, by) {
      const s = nearest(ax, ay), t = nearest(bx, by);
      if (s < 0 || t < 0) return null;
      const dist = new Float64Array(xy.length).fill(Infinity), prev = new Int32Array(xy.length).fill(-1), via = [];
      const heap = [[0, s]];
      dist[s] = 0;
      const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      let settled = 0;
      while (heap.length) {
        const [d, u] = pop();
        if (d > dist[u]) continue;
        if (u === t || ++settled > 60000) break;
        for (const [v, w, li, rev] of adj[u]) {
          const h = Math.hypot(xy[v][0] - bx, xy[v][1] - by) - Math.hypot(xy[u][0] - bx, xy[u][1] - by); // A*-style tie-break toward the goal
          const nd = d + w + h * 0.001;
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; via[v] = [li, rev]; push([nd, v]); }
        }
      }
      if (prev[t] < 0 && s !== t) return null;
      const pts = [[bx, by]];
      for (let v = t; v !== s; v = prev[v]) {
        const [li, rev] = via[v], l = lines[li], n = l.pts.length / 3;
        for (let k = 0; k < n; k++) { const kk = rev ? k : n - 1 - k; pts.push([l.pts[3 * kk], l.pts[3 * kk + 1], l.pts[3 * kk + 2]]); }
      }
      pts.push([ax, ay]);
      return pts.reverse();
    }
    return { route };
  })();
  let route = null, routeFor = '', routeAt = 0, routeFrom = [0, 0];
  // in a car the minimap's route keeps to the roads: the ride's own route, or one to the target from where you are
  const byRoad = { key: '', at: -9, pts: null };
  function roadRoute(target) {
    if (player.mode === 'ride' && ride && ride.phase === 'driving') { const P = ride.drv.path, i = P.pos(ride.drv.st.s, {}).i; return [[player.x, player.y]].concat(P.pts.slice(i + 1)); }
    if (player.mode !== 'car' || !target) return null;
    const key = `${Math.round(target[0])},${Math.round(target[1])}`;
    if (key !== byRoad.key || clockT - byRoad.at > 2) {
      byRoad.key = key; byRoad.at = clockT;
      const a = placeOf(myCar.D.st), b = roads.place(target[0], target[1], 300, keepSign, groundZ(target[0], target[1])), rt = a && b && roads.route(a, b, 30000);
      byRoad.pts = rt ? rt.pts : null;
    }
    return byRoad.pts && [[player.x, player.y]].concat(byRoad.pts);
  }
  function updateRoute(t, target) {
    const key = target ? `${Math.round(target[0])},${Math.round(target[1])}` : '';
    if (!target || player.mode !== 'foot' || !settings.route || Math.hypot(target[0] - player.x, target[1] - player.y) < 35) {
      route = null; routeFor = '';
      if (routeLine) { world.remove(routeLine); routeLine.geometry.dispose(); routeLine = null; }
      return;
    }
    if (key === routeFor && t - routeAt < 1.5) return;
    if (key === routeFor && Math.hypot(player.x - routeFrom[0], player.y - routeFrom[1]) < 25) return;
    routeFor = key; routeAt = t; routeFrom = [player.x, player.y];
    route = graph.route(player.x, player.y, target[0], target[1]) || [[player.x, player.y], target];
    if (routeLine) { world.remove(routeLine); routeLine.geometry.dispose(); }
    const pts = route.map(p => { const f = nav.floorAt(p[0], p[1], (p[2] ?? player.z) + 1); return W(p[0], p[1], (f ? f.z : p[2] ?? 0) + 0.35); });
    routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), routeMat);
    routeLine.computeLineDistances();
    world.add(routeLine);
  }

  // ------------------------------------------------------------ input
  const keys = new Set();
  let preTitle = true; // until the loader hands over to the title screen (after a loading flyover, when it ends)
  const settings = { route: true, density: 'normal' };
  // mode: 'chase', 'bird' (the helicopter's bird's-eye view) or 'cockpit' (the pilot's eyes, looking lookYaw left and lookPitch up)
  // distTo and yawTo, when set, ease the chase camera somewhere (out to the helicopter's view, round to its door)
  const cam = { yaw: 0, pitch: 0.36, dist: 7.5, distTo: 0, yawTo: null, lastInput: -10, mode: 'chase', birdAlt: 320, lookYaw: 0, lookPitch: -0.1 };
  const cine = OECine.director({ reduced }); // camera shots, on the game clock (clockT)
  let joy = { x: 0, y: 0 }, touchLift = 0, uiOpen = () => !$('#g-menu').hidden || !$('#g-bigmap').hidden || !$('#g-pass').hidden || !$('#g-title').hidden;
  const k = c => keys.has(c);
  on(window, 'keydown', e => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) { keys.add(c); return; }
    keys.add(c);
    if (preTitle) return; // the loader is still up (a flyover playing)
    if (!$('#g-title').hidden) { if (c === 'Enter') $('#gt-play').click(); return; }
    if (photo.on) { // photo mode: move with WASD (read in photoCamera), Enter saves, Esc or O leaves
      if (c === 'Enter') snapPhoto(); else if (c === 'Escape' || c === 'KeyO') photoMode(false);
      return;
    }
    if (cine.active && cine.label !== 'crane') { cine.skip(); return; } // a key ends a hop or a survey shot
    if (c === 'Escape') { if (!phone.el.hidden) phoneShow(false); else if (!$('#g-bigmap').hidden || !$('#g-pass').hidden) { $('#g-bigmap').hidden = $('#g-pass').hidden = true; } else toggleMenu(); return; }
    if (uiOpen()) { if (c === 'KeyM') toggleMap(); return; }
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
  on(canvas, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); A.start(); if (cine.active) cine.skip(); });
  on(canvas, 'pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (photo.on) { photo.az += dx * 0.006; photo.pitch = Math.max(-0.35, Math.min(1.5, photo.pitch + dy * 0.005)); photoSync(); return; }
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
    on(pad, 'pointerdown', e => { jid = e.pointerId; c0 = [e.clientX, e.clientY]; pad.setPointerCapture(jid); A.start(); });
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
    if (dlg.open || uiOpen() || cine.active) return null;
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
    dlg.show({ name: sp.name, role: sp.role || '', color: sp.color || '#6d5a3a', pitch: sp.pitch || 260 }, places.lines(sp).map(fill));
    for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'spot' && s.spot === sp.id) completeStep(l); }
  }

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
  function placeNear(x, y, z0, avoid = null) {
    if (z0 == null) z0 = Math.max(0, nav.terrain(x, y));
    for (let r = 0; r < 45; r += 1.5) for (let a = 0; a < 6.28; a += r ? 0.5 / Math.max(1, r / 3) : 7) {
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
  // you: drag to turn, scroll (or Distance) to come closer, WASD and Space/C to move the
  // focus up to 300 m away. Time sets the sun for the photo (the clock stays there when
  // you leave); Lens is the field of view, shown as a 35 mm focal length. Saving draws a
  // caption with the place, the time and the sun's height into the corner.
  const photo = { on: false, focus: new THREE.Vector3(), anchor: new THREE.Vector3(), az: 0, pitch: 0.3, dist: 8, fov: BASE_FOV, turn: false };
  const distOf = v => 1.5 * Math.pow(400 / 1.5, v / 1000), distTo = d => Math.round(1000 * Math.log(d / 1.5) / Math.log(400 / 1.5)); // a log slider, 1.5 to 400 m
  const focal = fov => Math.round(12 / Math.tan(fov * RAD / 2)); // a full-frame 35 mm camera, 24 mm tall
  function photoMode(on) {
    if (on === photo.on || !$('#g-title').hidden) return;
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
  function photoSync() { // the sliders follow the camera and the clock
    $('#ph-time').value = String(Math.round(clock.min));
    $('#ph-time-v').textContent = `${fmtMin(clock.min)} · sun ${sun.altitude.toFixed(0)}°`;
    $('#ph-fov').value = String(Math.round(photo.fov));
    $('#ph-fov-v').textContent = `${focal(photo.fov)} mm`;
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
    p.focus.y = Math.min(Math.max(p.focus.y, nav.terrain(p.focus.x, -p.focus.z) + 0.3), p.anchor.y + 300);
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
  on($('#ph-dist'), 'input', e => { photo.dist = distOf(+e.target.value); photoSync(); });
  on($('#ph-turn'), 'click', e => { photo.turn = !photo.turn; e.currentTarget.setAttribute('aria-pressed', String(photo.turn)); });
  on($('#ph-grid'), 'click', e => { const g = !stage.classList.contains('grid'); stage.classList.toggle('grid', g); e.currentTarget.setAttribute('aria-pressed', String(g)); });
  on($('#ph-me'), 'click', e => { const v = !player.rig.root.visible; player.rig.root.visible = v; e.currentTarget.setAttribute('aria-pressed', String(v)); });
  on($('#ph-snap'), 'click', snapPhoto);
  on($('#ph-done'), 'click', () => photoMode(false));
  on($('#g-photo-btn'), 'click', () => photoMode(true));

  // ------------------------------------------------------------ menus, map, passport
  function toggleMenu() { $('#g-menu').hidden = !$('#g-menu').hidden; if (!$('#g-menu').hidden) menuSync(); }
  function togglePass() { renderPassport(); $('#g-pass').hidden = !$('#g-pass').hidden; }
  const bigCanvas = $('#g-bigmap-c');
  let bigView = null, waypoint = null;
  function toggleMap() {
    const el = $('#g-bigmap');
    el.hidden = !el.hidden;
    if (!el.hidden) drawBig();
  }
  function drawBig() {
    const box = bigCanvas.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    bigCanvas.width = box.width * dpr; bigCanvas.height = box.height * dpr;
    const g = bigCanvas.getContext('2d'), s = Math.min(bigCanvas.width / base.canvas.width, bigCanvas.height / base.canvas.height);
    const ox = (bigCanvas.width - base.canvas.width * s) / 2, oy = (bigCanvas.height - base.canvas.height * s) / 2;
    bigView = { s, ox, oy, dpr };
    g.clearRect(0, 0, bigCanvas.width, bigCanvas.height);
    g.drawImage(base.canvas, ox, oy, base.canvas.width * s, base.canvas.height * s);
    const P2 = (x, y) => [ox + base.X(x) * s, oy + base.Y(y) * s];
    g.lineWidth = 2 * dpr;
    for (const r of G.ferries) { g.strokeStyle = 'rgba(30,91,58,0.75)'; g.setLineDash([6 * dpr, 4 * dpr]); for (const l of r.legs) { g.beginPath(); l.path.forEach((p, i) => { const [x, y] = P2(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); } }
    g.setLineDash([]);
    g.save(); g.scale(dpr, dpr);
    const icon = (ic, x, y) => H.drawIcon(g, ic, x / dpr, y / dpr);
    for (const w of G.wharves) icon({ kind: 'wharf' }, ...P2(...w.terminal));
    for (const h of G.helipads) icon({ kind: 'pad' }, ...P2(h.at[0], h.at[1]));
    for (const v of VP) icon({ kind: 'trig', done: !!trigDone()[v.id] }, ...P2(v.x, v.y));
    for (const f of flocks) icon({ kind: 'gull' }, ...P2(f.at[0], f.at[1]));
    for (const v of fer.vessels) icon({ kind: 'ferry' }, ...P2(v.x, v.y));
    if (player.mode !== 'heli') icon({ kind: 'heli' }, ...P2(heli.st.x, heli.st.y));
    if (myCar && player.mode !== 'car') icon({ kind: 'car' }, ...P2(myCar.D.st.x, myCar.D.st.y));
    if (ride && player.mode !== 'ride' && ride.phase !== 'leaving') icon({ kind: 'ride', label: ride.kind === 'taxi' ? 'T' : 'R' }, ...P2(ride.drv.st.x, ride.drv.st.y));
    for (const n of npcs) icon({ kind: 'npc', color: wantsTalk(n) ? '#e0a21a' : '#5b6b77', label: n.name[0] }, ...P2(n.x, n.y));
    for (const o of sideObjectives()) icon({ kind: 'quest2' }, ...P2(...o.at));
    const ob = objective();
    if (ob && ob.at) icon({ kind: 'quest' }, ...P2(...ob.at));
    if (waypoint) icon({ kind: 'waypoint' }, ...P2(...waypoint));
    const [px, py] = P2(player.mode === 'heli' ? heli.st.x : player.mode === 'ferry' ? player.vehicle.x : player.x, player.mode === 'heli' ? heli.st.y : player.mode === 'ferry' ? player.vehicle.y : player.y);
    g.translate(px / dpr, py / dpr); g.rotate(player.mode === 'heli' ? heli.st.h : player.h);
    g.fillStyle = '#ffffff'; g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg'); g.lineWidth = 2; // white on the gold route
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // fast travel to wharves you have used, the helipad and the start
    const dest = [{ id: 'start', name: 'Where you started', at: G.start.at }].concat(G.wharves.filter(w => qs.visited[w.id]).map(w => ({ id: w.id, name: w.name, at: w.landing })),
      (G.travel || []).filter(t => t.always || qs.visited[t.id]).map(t => ({ id: t.id, name: t.name, at: t.at })));
    $('#g-travel').innerHTML = dest.map(d => `<li><button data-at="${d.at.join(',')}">${d.name}</button></li>`).join('');
  }
  on(bigCanvas, 'click', e => {
    if (!bigView) return;
    const r = bigCanvas.getBoundingClientRect(), x = (e.clientX - r.left) * bigView.dpr, y = (e.clientY - r.top) * bigView.dpr;
    const bx = (x - bigView.ox) / bigView.s, by = (y - bigView.oy) / bigView.s;
    waypoint = [scene.frame.x[0] + bx * base.PX, scene.frame.y[1] - by * base.PX];
    H.toast('Waypoint set. The route shows on the minimap.');
    drawBig();
  });
  on($('#g-travel'), 'click', e => {
    const b = e.target.closest('button');
    if (!b || player.mode !== 'foot') { if (b) H.toast('Fast travel works on foot.'); return; }
    const [x, y, z] = b.dataset.at.split(',').map(Number), p = placeNear(x, y, Number.isFinite(z) ? z : null); // on a roof, or the ground
    if (p) { $('#g-bigmap').hidden = true; hopTo(p[0], p[1], p[2], b.textContent); }
  });
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
    crowd.active = Math.round(crowd.P.length * density[b.dataset.d]); cars.active = Math.round(cars.C.length * density[b.dataset.d]);
    $$('#gm-density button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  on($('#gm-route'), 'change', e => { settings.route = e.target.checked; });
  if (!lib) $('#gm-who').closest('.field').hidden = true;
  $$('#gm-who button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === playerChar)));
  on($('#gm-who'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setPlayerCharacter(b.dataset.c);
    $$('#gm-who button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  on($('#gm-sound'), 'change', e => A.setMuted(!e.target.checked));
  on($('#gm-reset'), 'click', () => {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    if ((player.mode === 'car' || player.mode === 'ride') && !stepOut(player.vehicle, player.mode === 'car' ? 'driver' : kerbSeat)) { player.vehicle.C.body.remove(player.rig.root); world.add(player.rig.root); player.mode = 'foot'; player.vehicle = null; }
    if (ride) rideAway();
    qs = freshQs(); renderPassport(); spawn(); H.toast('New survey started.'); $('#g-menu').hidden = true;
  });

  // ------------------------------------------------------------ start
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
  const startGame = cont => {
    A.start();
    if (cont && saved) {
      qs = Object.assign(qs, migrate(saved.qs));
      spawn(saved.pos, saved.pos[2] != null ? saved.pos[2] + 0.5 : undefined); // back on the deck or roof where you left off
      if (saved.car && myCar && nav.floorAt(saved.car[0], saved.car[1], saved.car[2] + 1)) parkMyCar({ x: saved.car[0], y: saved.car[1], z: saved.car[2], h: saved.car[3] });
      if (saved.clock) { clock.scale = saved.clock.scale || 30; setClock(saved.clock.y, saved.clock.m, saved.clock.d, saved.clock.min); }
    }
    const tc = $('#gt-timechoice [aria-pressed="true"]');
    if (!cont && tc) presetTime(tc.dataset.t);
    $('#g-title').hidden = true;
    craneIn();
    renderPassport();
    if (!cont) H.toast(`Find ${npcById(quest() ? quest().giver : npcs[0].id).name}: follow the gold route, or press <kbd>M</kbd> for the map.`);
  };
  on($('#gt-play'), 'click', () => startGame(false));
  on($('#gt-continue'), 'click', () => startGame(true));
  on($('#gt-timechoice'), 'click', e => { const b = e.target.closest('button'); if (b) $$('#gt-timechoice button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  const nowLoc = S.utcToLocal(Date.now());
  $('#gt-now').textContent = `Now in ${CITY.name} (${fmtMin(nowLoc.minutes)})`;
  // the loading flyover, if it played, ends on the title orbit's first pose, so the orbit takes over from
  // its last frame as the loader fades; the title card is held back until then, so it never shows over
  // the loader, while the scene under it waits as on the title screen (preTitle)
  OEFlyover.finish($('#g-loader')).then(flew => {
    if (flew) fromFlyover();
    preTitle = false;
    $('#g-title').hidden = false;
    $('#g-loader').classList.add('out');
    setTimeout(() => { $('#g-loader').hidden = true; OEFlyover.stop($('#g-loader')); }, reduced ? 0 : 700);
  });
  renderPassport();

  // ------------------------------------------------------------ the loop
  let last = performance.now(), clockT = 0, sunTimer = 0, sunState = 'sun', fpsAcc = [0, 0], fpsWarned = false, stepPhase = 0, bumpT = -9, waterT = -99;
  const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camSmooth = new THREE.Vector3();
  let running = true;
  function frame(now) {
    if (!running) return;
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
      $('#g-sun span').textContent = sunState === 'night' ? 'Sun down' : sunState === 'sun' ? `In sun · ${sun.altitude.toFixed(0)}°` : `In shade · sun ${sun.altitude.toFixed(0)}°`;
      if (!paused) checkSteps();
    }
    if (!paused) simulate(dt);
    if (Math.floor(clockT) !== Math.floor(clockT - dt)) groundLod(player.mode === 'heli' ? heli.st.x : player.x, player.mode === 'heli' ? heli.st.y : player.y);
    if (titleOn && titleYaw != null) titleYaw += dt * 0.05;
    if (photo.on) photoCamera(dt); else updateCamera(dt, titleOn);
    stage.classList.toggle('cine', cine.active && (cine.label !== 'crane' || cine.k < 0.5));
    // world clocks and fades
    Wd.tick(now, camera);
    if (atmos) atmos.update(clockUtc, now / 1000, U);
    if (show) show.tick(now);
    if (window.OEKit) OEKit.setNight(U.uNight.value); // cabin windows and navigation lights
    fer.vessels.forEach(v => (v.events || []).splice(0).forEach(ev => onFerryEvent(ev)));
    dlg.tick(dt);
    // HUD
    const ob = titleOn ? null : objective();
    const target = waypoint || (ob && ob.at);
    updateRoute(clockT, player.mode === 'foot' ? target : null);
    beam.visible = !!target && !titleOn && Math.hypot(target[0] - (player.mode === 'heli' ? heli.st.x : player.x), target[1] - (player.mode === 'heli' ? heli.st.y : player.y)) > 45;
    if (target) { const f = nav.floorAt(target[0], target[1], Math.max(300, nav.terrain(target[0], target[1]) + 1)); beam.position.copy(W(target[0], target[1], f ? f.z : 0)); beam.scale.set(1, player.mode === 'heli' ? 4 : 1, 1); }
    const me = player.mode === 'heli' ? heli.st : player.mode === 'ferry' ? player.vehicle : player;
    $('#gq-title').textContent = ob ? ob.title : (Q.length && LINES.every(lineDone) ? 'Free roam' : '');
    if (!titleOn) renderLines();
    const trigLeft = VP.filter(v => !trigDone()[v.id]).length;
    $('#gq-step').textContent = ob ? ob.text : trigLeft ? `The city is yours. ${trigLeft} trig station${trigLeft > 1 ? 's' : ''} still to survey (△ on the map), or change the time and fly anywhere.`
      : 'The city is yours. Change the time, ride the ferries, fly anywhere.';
    $('#gq-dist').textContent = target ? `${Math.round(Math.hypot(target[0] - me.x, target[1] - me.y))} m` : '';
    if (photo.on) { beam.visible = false; if (routeLine) routeLine.visible = false; }
    else if (routeLine) routeLine.visible = true;
    if (!titleOn && !photo.on) {
      const icons = [];
      for (const w of G.wharves) icons.push({ kind: 'wharf', x: w.terminal[0], y: w.terminal[1] });
      for (const h of G.helipads) icons.push({ kind: 'pad', x: h.at[0], y: h.at[1] });
      for (const v of VP) icons.push({ kind: 'trig', x: v.x, y: v.y, done: !!trigDone()[v.id] });
      for (const f of flocks) icons.push({ kind: 'gull', x: f.at[0], y: f.at[1] });
      for (const v of fer.vessels) icons.push({ kind: 'ferry', x: v.x, y: v.y });
      if (player.mode !== 'heli') icons.push({ kind: 'heli', x: heli.st.x, y: heli.st.y });
      if (myCar && player.mode !== 'car') icons.push({ kind: 'car', x: myCar.D.st.x, y: myCar.D.st.y });
      if (ride && player.mode !== 'ride' && ride.phase !== 'leaving') icons.push({ kind: 'ride', x: ride.drv.st.x, y: ride.drv.st.y, pin: true, label: ride.kind === 'taxi' ? 'T' : 'R' });
      for (const n of npcs) { const hot = wantsTalk(n); n.marker.visible = hot && !dlg.open; if (hot) icons.push({ kind: 'npc', x: n.x, y: n.y, color: '#e0a21a', pin: true }); }
      for (const o of sideObjectives()) icons.push({ kind: 'quest2', x: o.at[0], y: o.at[1] });
      if (ob && ob.at) icons.push({ kind: 'quest', x: ob.at[0], y: ob.at[1], pin: true });
      if (waypoint) icons.push({ kind: 'waypoint', x: waypoint[0], y: waypoint[1], pin: true });
      drawMini({ x: me.x, y: me.y, yaw: player.mode !== 'heli' ? cam.yaw : cam.mode === 'bird' ? heli.st.h : cam.mode === 'cockpit' ? heli.st.h - cam.lookYaw : cam.yaw, heading: player.mode === 'heli' ? heli.st.h : player.mode === 'ferry' ? player.vehicle.h : player.h,
        radius: player.mode === 'heli' ? 700 : player.mode === 'ferry' ? 450 : player.mode === 'car' || player.mode === 'ride' ? 260 + Math.min(220, player.speed * 7) : 200, route: roadRoute(target) || route, icons });
      if (!$('#g-bigmap').hidden && Math.floor(clockT * 2) !== Math.floor((clockT - dt) * 2)) drawBig();
      const a = currentAction(), alt = kerbAction();
      $('#g-prompt').hidden = !a && !alt;
      $('#gp-main').hidden = !a; $('#gp-alt').hidden = !alt;
      if (a) { $('#gp-key').textContent = a.key; $('#gp-key').hidden = !a.key; $('#gp-text').textContent = a.text; }
      if (!phone.el.hidden && phone.view === 'ride' && clockT - phone.at > 0.5) { phone.at = clockT; phoneRender(); }
      vehicleHud();
      if (player.mode !== 'foot') gaitChip('');
    }
    // a low frame rate is worth a hint (slowroads does the same)
    fpsAcc[0] += dt; fpsAcc[1]++;
    if (fpsAcc[0] > 6) { if (!fpsWarned && fpsAcc[1] / fpsAcc[0] < 22 && !titleOn) { fpsWarned = true; H.toast('Running slowly? Lower the crowd density in the menu (Esc).'); } fpsAcc = [0, 0]; }
    if (player.rig.hideHead) player.rig.hideHead(player.mode === 'heli' && cam.mode === 'cockpit' && !photo.on && !(cine.active && cine.label !== 'crane'));
    if (atmos) atmos.render(world, camera); else renderer.render(world, camera);
    updateLabels();
    requestAnimationFrame(frame);
  }

  function simulate(dt) {
    const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + joy.y;
    const side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + joy.x;
    const held = dlg.open || cine.label === 'hop' || cine.label === 'survey';
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
    crowd.update(dt, cx, cy, clockT, player.mode === 'foot' ? player : player.mode === 'car' ? { x: player.x, y: player.y, h: player.h, speed: myCar.D.st.v, r: 1.1 } : null);
    if (colonies.length) {
      const L = dayLimits();
      for (const c of colonies) c.update(dt, { min: clock.min, sunset: L.sunset, sunrise: L.sunrise }, cx, cy, U.uNight.value);
      // on the viewing platform after dark, the colony's rule for visitors
      const c0 = colonies[0].colony;
      if (!viewingNoted && player.mode === 'foot' && player.floor === 'pier' && sun && sun.altitude < 0 && c0.viewing_note && c0.viewing.some(p => Math.hypot(p[0] - player.x, p[1] - player.y) < 40)) { viewingNoted = true; H.toast(c0.viewing_note); }
    }
    for (const f of flocks) f.update(dt, cx, cy, player.mode === 'foot', U.uNight.value);
    for (const t of G.travel || []) if (!qs.visited[t.id] && !t.always && player.mode === 'foot' && Math.hypot(t.at[0] - player.x, t.at[1] - player.y) < 30 && Math.abs((t.at[2] ?? player.z) - player.z) < 15) {
      qs.visited[t.id] = true; H.toast(`<b>${t.name}</b> is on your map now: open it (M) to come back here.`);
    }
    benchBudget += dt * 60; // keep what the benches near the player offer up to date, about 60 a second
    if (benchBudget >= 1) { benches.refresh(benchLit, cx, cy, CR.radius_m || 450, Math.floor(benchBudget)); benchBudget -= Math.floor(benchBudget); }
    // the traffic brakes for you on foot and for your car, and swings out round a car pulled in at the kerb
    const blockers = player.mode === 'foot' ? [player] : [];
    for (const o of [myCar, ride]) if (o) { const st = stOf(o); blockers.push({ x: st.x, y: st.y, z: st.z, half: o.C.half, hw: o.C.hw, parked: Math.abs(st.v) < 0.3 && (o === ride || player.mode !== 'car') }); }
    cars.update(dt, cx, cy, clockT, blockers);
    if (places) places.update(dt, player.x, player.y, player.z, player.mode === 'foot' && !cine.active);
  }

  function walkStep(dt, fwd, side) {
    if (player.auto && player.auto.t > 0.2 && Math.hypot(fwd, side) > 0.3) { const a = player.auto; player.auto = null; if (a.cancel) a.cancel(); } // moving off cancels it
    if (player.auto) { // walking up to a door
      const a = player.auto, dx = a.x - player.x, dy = a.y - player.y, d = Math.hypot(dx, dy);
      a.t += dt;
      if (d < 0.7 || a.t > 5) { player.auto = null; a.then(); return; }
      fwd = 1; side = 0;
      player.h += angDiff(Math.atan2(dx, dy), player.h) * Math.min(1, dt * 8);
      const sp = 2.2, nx = player.x + Math.sin(player.h) * sp * dt, ny = player.y + Math.cos(player.h) * sp * dt, w = nav.walk(nx, ny, player.z);
      if (w.ok) { const o = OECars.pushOut(nx, ny, w.z, 0.35, carBoxes(nx, ny, 6)); player.x = o.x; player.y = o.y; player.z = w.z; } else a.t = 9;
      player.rig.animate(dt, sp, 'ground', clockT);
      return;
    }
    const m = Math.min(1, Math.hypot(fwd, side));
    const run = k('ShiftLeft') || k('ShiftRight');
    const target = m > 0.05 ? (run ? 7 : player.walking ? 1.4 : 4.5) * m : 0; // run, walk (X) or sprint (hold Shift)
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
    // cars are solid too: out of any the move went into, or one that drove into you (back where you were if that is a wall)
    const boxes = carBoxes(player.x, player.y, 6);
    if (boxes.length) {
      const o = OECars.pushOut(player.x, player.y, player.z, 0.35, boxes);
      if (o.hit) {
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
  let titleYaw = null, titleR = ORBIT.r, titleH = ORBIT.h, flyCam = null;
  const titlePose = () => ({ look: [player.x + 120, player.y + 160, player.z + 20],
    cam: [player.x + 120 - Math.sin(FLY_END.yaw) * FLY_END.r, player.y + 160 - Math.cos(FLY_END.yaw) * FLY_END.r, player.z + 20 + FLY_END.h] });
  function fromFlyover() { titleYaw = FLY_END.yaw; titleR = FLY_END.r; titleH = FLY_END.h; }
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
      if (titleYaw == null) titleYaw = openYaw(player.x + 120, player.y + 160, ORBIT.r);
      const k = Math.min(1, dt * 0.4);
      titleR += (ORBIT.r - titleR) * k; titleH += (ORBIT.h - titleH) * k;
      titleLook.copy(W(player.x + 120, player.y + 160, player.z + 20));
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
      if (cine.label !== 'film') camera.position.y = Math.max(camera.position.y, roofBelow(camera.position.x, -camera.position.z) + 3);
      camera.lookAt(shot.look);
      Wd.fitShadow(shot.look, THREE.MathUtils.clamp(camera.position.distanceTo(shot.look) * 1.2, live.half, 1600));
      return;
    }
    camera.up.copy(live.up);
    camera.position.copy(live.pos);
    camera.lookAt(live.look);
    Wd.fitShadow(live.look, live.half);
  }
  const cabinQ = new THREE.Quaternion();
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
    // keep the camera out of walls and cars: first rise over them (look down on the player), then come closer
    const near = carBoxes(tx, ty, dist + 6, veh);
    const clear = (a, b) => Math.min(nav.clearFraction(a, b), near.length ? OECars.sweep({ x: a.x, y: -a.z, z: a.y }, { x: b.x, y: -b.z, z: b.y }, near) : 1);
    let best = null;
    for (const lift of [0, 0.25, 0.5, 0.8]) {
      const pitch = Math.min(1.35, cam.pitch + lift), cp = Math.cos(pitch);
      const pos = new THREE.Vector3(camTarget.x - Math.sin(cam.yaw) * cp * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(cam.yaw) * cp * dist);
      const f = clear(camTarget, pos);
      if (!best || f > best.f + 0.05) best = { f, pos };
      if (f >= 0.97) break;
    }
    camPos.copy(best.pos);
    if (best.f < 1) camPos.lerpVectors(camTarget, best.pos, Math.max(0.15, best.f - 0.04));
    // pulled in that close by a wall, it may be over a car: then it looks down over the roof
    for (const q of near) if (OECars.pushOut(camPos.x, -camPos.z, q.z + 0.5, 0.35, [q]).hit) camPos.y = Math.max(camPos.y, q.z + q.top + 0.45);
    if (camSmooth.lengthSq() === 0 || camSmooth.distanceTo(camPos) > 60) camSmooth.copy(camPos); // after a teleport
    camSmooth.lerp(camPos, close ? Math.min(1, dt * 10) : veh ? Math.min(1, dt * 16) : 1);
    camPos.copy(camSmooth);
    let gz = Math.max(0, nav.terrain(camPos.x, -camPos.z)); // over the water, its surface
    for (const st of nav.strips) { // steps and decks below the player's head lift the camera too
      const h = nav.stripHeight(st, camPos.x, -camPos.z);
      if (h != null && h < camTarget.y + 0.5 && h > gz) gz = h;
    }
    nav.decksAt(camPos.x, -camPos.z, h => { if (h < camTarget.y + 0.5 && h > gz) gz = h; });
    if (camPos.y < gz + 0.5) camPos.y = gz + 0.5;
    live.pos.copy(camPos);
    live.look.copy(camTarget);
    live.half = player.mode === 'heli' ? 520 : player.mode === 'ferry' ? 320 : veh ? 220 : 170;
  }
  // from your seat: the eye over the cushion, looking ahead as the car turns (drag to look
  // round; the look comes back ahead when let go)
  const eye = new THREE.Vector3();
  function cabinView(dt, o, st) {
    const seat = o === myCar ? 'driver' : kerbSeat, back = clockT - cam.lastInput > 1.2 ? Math.max(0, 1 - dt * 3) : 1;
    o.C.body.updateWorldMatrix(true, false); // where the car is this frame, not where it was last drawn
    o.C.body.localToWorld(eye.copy(o.C.seats[seat]).add(new THREE.Vector3(0, seat === 'driver' ? 0.7 : 0.64, 0.08)));
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
  // Start: from the title orbit, close in over the player at height, drop down beside
  // them and swing in behind, then hand over to the chase camera. Moving is allowed.
  function craneIn() {
    const look0 = titleLook.clone(), p0 = OECine.polar(head(), camera.position);
    cam.mode = 'chase'; cam.yaw = player.h; cam.pitch = 0.36; cam.dist = 7.5;
    camSmooth.set(0, 0, 0);
    const p1 = chasePolar(), lk = new THREE.Vector3();
    const path = OECine.spiral({ center: head, az: [p0.az, p0.az + OECine.turn(p0.az, p1.az)], dist: [p0.dist, p1.dist], h: [p0.h, p1.h],
      look: k => lk.lerpVectors(look0, head(), OECine.ease.inOut(Math.min(1, k * 1.4))), e: { dist: 'out', h: 'in' } });
    cine.play(OECine.mix(path, () => live, k => handOver(k)), 3.2, { label: 'crane' });
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
  function hopTo(x, y, z, name, opts = {}) {
    const span = Math.hypot(x - player.x, y - player.y), bearing = Math.atan2(x - player.x, y - player.y);
    const roofs = roofAlong(player.x, player.y, x, y) - player.z; // cruise well clear of the tallest roof on the way
    const alt = Math.max(THREE.MathUtils.clamp(140 + span * 0.12, 180, 520), roofs + 110), top = { dist: alt * 0.3, h: alt }, az = bearing + Math.PI;
    const A = head(), B = W(x, y, z + 1.55), p0 = OECine.polar(A, camera.position), c = new THREE.Vector3();
    const rise = OECine.spiral({ center: A, az: [p0.az, p0.az + OECine.turn(p0.az, az)], dist: [p0.dist, top.dist], h: [p0.h, top.h], e: { dist: 'inOut', h: 'out' } });
    const cross = OECine.spiral({ center: k => c.lerpVectors(A, B, k), az, dist: top.dist, h: top.h });
    const fall = OECine.spiral({ center: head, az, dist: [top.dist, Math.cos(0.36) * 7.5], h: [top.h, Math.sin(0.36) * 7.5], e: { dist: 'out', h: 'in' } });
    const a = 0.26, b = 0.66;
    const path = k => (k < a ? rise(OECine.span(k, 0, a)) : k < b ? cross(OECine.ease.inOut(OECine.span(k, a, b))) : fall(OECine.span(k, b, 1)));
    cine.play(OECine.mix(path, () => live, k => handOver(k, 0.86)), Math.min(4.6, 2.4 + span / 1500), { label: 'hop',
      cues: [[a, opts.cue ? () => { opts.cue(); cam.yaw = bearing; groundLod(x, y); } : () => {
        [player.x, player.y, player.z] = [x, y, z];
        player.h = bearing; player.speed = 0; player.vz = 0; player.ground = true;
        cam.mode = 'chase'; cam.yaw = bearing; cam.pitch = 0.36; cam.dist = 7.5;
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
      el.innerHTML = `<div><b>${o.name}</b><span>${o.kind === 'taxi' ? 'taxi' : `${rideCar(o)} · ${o.plate}`}</span></div><div><b class="num">${o.phase === 'coming' ? fmtSec(eta(o)) : 'here'}</b><span>${o.phase === 'coming' ? 'away' : 'at the kerb'}</span></div>
        <p class="note">${o.phase === 'coming' ? 'Wait at the kerb. ' : 'E beside it to get in. '}${o.kind === 'hire' ? 'N to cancel.' : ''}</p>`;
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
      fer.vessels.forEach(v => (v.events || []).splice(0).forEach(ev => onFerryEvent(ev)));
      if (i % 8 === 0) { sunTimer = 0; applySun(); const px = player.mode === 'heli' ? heli.st.x : player.x, py = player.mode === 'heli' ? heli.st.y : player.y;
        sunState = sun.altitude <= 0 ? 'night' : S.sunlit(DSM, px, py, player.mode === 'heli' ? heli.st.z + 1 : player.z + 1.6, sun) ? 'sun' : 'shade'; checkSteps(); }
    }
    for (const c of hold) keys.delete(c);
    groundLod(player.mode === 'heli' ? heli.st.x : player.x, player.mode === 'heli' ? heli.st.y : player.y);
    camTarget.copy(player.mode === 'heli' ? W(heli.st.x, heli.st.y, heli.st.z + 2.5) : player.mode === 'ferry' ? W(player.vehicle.x, player.vehicle.y, 5) : W(player.x, player.y, player.z + 1.55));
    updateCamera(1 / 30, false);
    camera.updateMatrixWorld();
  }
  // the recorder's handles (tools/flyover.js): the title pose, a scripted title camera, and the orbit restarted from the video's last frame
  const flyover = { titlePose, camera: o => { flyCam = o ? { pos: W(...o.cam), look: W(...o.look), shadow: o.shadow || 600 } : null; }, restart: () => fromFlyover() };
  window.__game = { flyover, Wd, colonies, flocks, dayLimits, footNet, benches, sunWant, benchTalk, advance, atmos, dlg, cine, photo, photoMode, snapPhoto, hopTo, craneIn, live, VP, viewshed, survey, renderPassport, guess, guessStart, guessCheck, completeQuest, LINES, ls, tracked, cycleTrack, openLines, lastDock: () => lastDock, waypoint: w => { waypoint = w; }, player, myCar: () => myCar, ride: () => ride, kerbAction, hail, orderRide, cancelRide, boardRide, leaveRide, skipRide, enterCar, exitCar, bringCar, resetCar, destinations, roads, carBoxes, phoneShow, KEEP, heli, fer, rail, npcs, crowd, cars, nav, clock, setClock, qs: () => qs, quest, step, completeStep, talkTo, board, alight, interact, enterHeli, exitHeli, spawn, objective, lens, camera, cam, DSM, graph, currentAction, keys, lifts, rideLift, places, lookAt };
  return {
    stop() { running = false; ac.abort(); ro.disconnect(); if (atmos) atmos.dispose(); renderer.dispose(); Wd.dispose(); A.stop(); window.__game = null; },
  };
};
