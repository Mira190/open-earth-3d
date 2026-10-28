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
    return null;
  }
  // the game walks on a 5 m terrain that drops at the seawall (game.json), not the viewer's 10 m grid
  // (the ground mesh uses every second point, 10 m, except on the tiles near the player)
  let Tfine = D.T;
  if (D.G.terrain) {
    const t = D.G.terrain, raw = Uint8Array.from(atob(t.data), c => c.charCodeAt(0)), v = new Int16Array(raw.buffer);
    Tfine = { data: Float32Array.from(v, q => q * t.scale), nx: t.nx, ny: t.ny, cell: t.cell, x0: D.scene.frame.x[0], y1: D.scene.frame.y[1] };
    const nx = Math.ceil(t.nx / 2), ny = Math.ceil(t.ny / 2), c = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let k = 0; k < nx; k++) c[r * nx + k] = Tfine.data[(2 * r) * t.nx + 2 * k];
    D.T = { data: c, nx, ny, cell: t.cell * 2, x0: Tfine.x0, y1: Tfine.y1 };
  }
  const { scene, B, P, G, CITY } = D;
  document.title = `${G.title} · Open Earth 3D`;
  $('#gt-title').textContent = G.title;
  if (G.blurb) $('#gt-blurb').textContent = G.blurb;
  $('#gt-city').textContent = `${CITY.name}, ${CITY.country}`;
  const stage = $('#game-stage'), canvas = $('#game-gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const BASE_FOV = 55, camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.3, 40000);
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  const Wd = await OEWorld.create(D, renderer, { onMsg: loadMsg });
  const world = Wd.world, U = Wd.U;
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
  S.pyramid(DSM);

  // ------------------------------------------------------------ street furniture: benches, lamps that light at night
  loadMsg('People, traffic, ferries', 0.86);
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
    await Promise.all([...Object.keys(PLAYER_LOOKS), ...G.npcs.map(n => n.look.character).filter(Boolean)].map(lib.require));
  } catch (e) { console.warn('Realistic people unavailable, using simple figures:', e); lib = null; }
  const makeRig = (look, opts) => (lib && look.character && lib.tpl[look.character] ? OEPeople.person(lib, Object.assign({}, look)) : OEActors.makePerson(look, opts));
  const CR = G.crowd || {};
  // the box-built fallback figures can't sit, so only the realistic crowd uses the benches
  const crowd = OEActors.crowd(world, footNet, U, CR.pedestrians || 300, CR.radius_m || 450, lib && (P => OEPeople.crowdRenderer(world, lib, U, P, { near: touch ? 6 : 14, style: CR.style })),
    { benches: lib ? benches : null });
  const cars = OEActors.traffic(world, roadNet, U, CR.cars || 120, (CR.radius_m || 450) + 100);
  const density = { low: 0.35, normal: 1, high: 1 };
  const playerLook = () => Object.assign({ shirt: '#2f4858', pants: '#2b3440', skin: '#e0ac85', hair: '#3b2a20' }, PLAYER_LOOKS[playerChar]);
  const player = { rig: makeRig(playerLook(), { vest: true }),
    x: 0, y: 0, z: 0, h: 0, vz: 0, speed: 0, ground: true, floor: 'ground', mode: 'foot', vehicle: null, auto: null, walking: false };
  world.add(player.rig.root);
  function setPlayerCharacter(name) { // swap the player's character in place
    if (!lib || !PLAYER_LOOKS[name]) return;
    playerChar = name;
    try { localStorage.setItem(PLAYER_KEY, name); } catch (e) { /* storage blocked */ }
    const old = player.rig, parent = old.root.parent, rig = makeRig(playerLook(), { vest: true });
    rig.root.position.copy(old.root.position); rig.root.rotation.copy(old.root.rotation);
    if (parent) { parent.remove(old.root); parent.add(rig.root); }
    player.rig = rig;
  }
  const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const npcs = G.npcs.map(n => {
    const rig = makeRig(Object.assign({ scale: (n.look.character || '')[0] === 'W' ? 0.91 : 0.96 }, n.look));
    world.add(rig.root);
    const f = nav.floorAt(n.at[0], n.at[1], 200);
    const o = Object.assign({}, n, { rig, x: n.at[0], y: n.at[1], z: f ? f.z : 0, h: hash(n.id) % 628 / 100, pitch: 150 + hash(n.id) % 170, color: n.look.top || n.look.shirt, eyes: new THREE.Vector3(),
      marker: OEActors.sprite('!', { bg: '#e0a21a', fg: '#1b1b1b', font: '900 44px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' }) });
    o.marker.scale.multiplyScalar(1.4);
    o.marker.position.set(0, 2.45, 0);
    rig.root.add(o.marker);
    rig.root.position.copy(W(o.x, o.y, o.z));
    rig.root.rotation.y = Math.PI - o.h;
    return o;
  });
  const npcById = id => npcs.find(n => n.id === id);

  // ------------------------------------------------------------ vehicles
  // the helicopter and ferry models every city shares (vehicles.js); the box-built ones if they can't be loaded
  let vlib = null;
  try { vlib = await OEVehicles.load('assets/vehicles/', { ferry: (G.ferries || []).length > 0 }); } catch (e) { console.warn('Vehicle models unavailable, using simple ones:', e); }
  const vopts = { lib: vlib, cfg: G.vehicles || {}, city: CITY, U, camera, renderer };
  const padAt = (G.helipads[0] || { at: [G.start.at[0] + 20, G.start.at[1], 2] }).at;
  const heli = OEVehicles.helicopter(world, nav, padAt, vopts);
  const fer = OEVehicles.ferries(world, G, nav, name => OEActors.sprite(name, { bg: 'rgba(30,91,58,0.9)' }), vopts);
  const wharfById = id => G.wharves.find(w => w.id === id);

  // ------------------------------------------------------------ trig stations: survey points with a view
  // Hilltops, a headland and the bridge deck (game.json "viewpoints"). Each has a concrete
  // trig pillar; surveying it turns the camera once round you and names what is in sight.
  const pillarGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.25, 4, 1).rotateY(Math.PI / 4).translate(0, 0.625, 0);
  const pillarMat = new THREE.MeshStandardMaterial({ color: lin('#e9e6dc'), roughness: 0.85 });
  const plateMat = new THREE.MeshStandardMaterial({ color: lin('#b08a3a'), roughness: 0.4, metalness: 0.6 });
  const VP = (G.viewpoints || []).map(v => {
    const f = nav.floorAt(v.at[0], v.at[1], v.z_ref ?? 400);
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
      if (kind === 'share') return String(areaShare[arg] || 0);
      if (kind === 'acc') return acc && acc[arg] != null ? String(acc[arg]) : '–';
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
  const SRC_TEXT = { mapped: 'its height is surveyed in OpenStreetMap', floors: 'its height is its floor count times a storey height', estimate: 'its height is estimated from its neighbours', plateau: 'its height was measured from the air for Project PLATEAU', plateau_lod1: 'its height is the block height in Project PLATEAU (no survey record)',
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
  let sun = null;
  function setClock(y, m, d, min) {
    const t = new Date(Date.UTC(y, m - 1, d) + Math.floor(min / 1440) * 864e5);
    Object.assign(clock, { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), min: ((min % 1440) + 1440) % 1440 });
    applySun();
  }
  function applySun() {
    sun = S.position(S.localToUtc(clock.y, clock.m, clock.d, clock.min));
    Wd.setSun(sun, clock.min);
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

  function presetTime(kind) {
    const now = S.utcToLocal(Date.now());
    clock.scale = clock.scale === 1 ? 1 : 30;
    if (kind === 'live') return setClock(now.y, now.m, now.d, now.minutes);
    const L = S.dayLimits(now.y, now.m, now.d);
    const min = { morning: 9 * 60, noon: L.noon, golden: L.sunset - 50, night: 21 * 60 }[kind] ?? 600;
    setClock(now.y, now.m, now.d, min);
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
    else if (s.type === 'ride') { const w = wharfById(player.mode === 'ferry' ? s.to : s.from); out.at = w.terminal; }
    else if (s.type === 'surface' || s.type === 'under_bridge') { const st = nav.strips.find(x => x.name === (s.surface || x.name)); if (st) out.at = st.origin.slice(); }
    else if (s.type === 'land' || s.type === 'sun') { const pl = placeByName(s.place); if (pl) out.at = centroid(pl); }
    if (s.type === 'inspect') out.text += ` (${ls(l).inspected.length}/${s.sources.length})`;
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
    try { localStorage.setItem(KEY, JSON.stringify({ qs, pos: [player.x, player.y], clock: { y: clock.y, m: clock.m, d: clock.d, min: clock.min, scale: clock.scale } })); } catch (e) { /* storage blocked */ }
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
  const settings = { route: true, density: 'normal' };
  const cam = { yaw: 0, pitch: 0.36, dist: 7.5, lastInput: -10, mode: 'chase', birdAlt: 320 };
  const cine = OECine.director({ reduced }); // camera shots, on the game clock (clockT)
  let joy = { x: 0, y: 0 }, touchLift = 0, uiOpen = () => !$('#g-menu').hidden || !$('#g-bigmap').hidden || !$('#g-pass').hidden || !$('#g-title').hidden;
  const k = c => keys.has(c);
  on(window, 'keydown', e => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) { keys.add(c); return; }
    keys.add(c);
    if (!$('#g-title').hidden) { if (c === 'Enter') $('#gt-play').click(); return; }
    if (cine.active && cine.label !== 'crane') { cine.skip(); return; } // a key ends a hop or a survey shot
    if (c === 'Escape') { if (!$('#g-bigmap').hidden || !$('#g-pass').hidden) { $('#g-bigmap').hidden = $('#g-pass').hidden = true; } else toggleMenu(); return; }
    if (uiOpen()) { if (c === 'KeyM') toggleMap(); return; }
    if (dlg.open) {
      if (c === 'KeyE' || c === 'Enter' || c === 'Space' || c === 'KeyF') dlg.next(false);
      if (/^Digit[1-9]$/.test(c)) dlg.choose(+c.slice(5) - 1);
      return;
    }
    if (c === 'KeyE' || c === 'KeyF' && !(player.mode === 'ferry')) interact();
    else if (c === 'KeyF' && player.mode === 'ferry') skip = !skip;
    else if (c === 'KeyQ') lens();
    else if (c === 'KeyG') guessStart();
    else if (c === 'KeyT') cycleTrack();
    else if (c === 'Enter' && guess.bi >= 0 && !guess.revealed) guessCheck();
    else if (c === 'KeyV') { cam.mode = cam.mode === 'bird' ? 'chase' : 'bird'; H.toast(cam.mode === 'bird' ? "Bird's-eye view: scroll to change height" : 'Chase view'); }
    else if (c === 'KeyM') toggleMap();
    else if (c === 'KeyP') togglePass();
    else if (c === 'KeyH' && player.mode === 'ferry') takeHelm();
    else if (c === 'KeyR' && player.mode === 'foot') unstuck();
    else if (c === 'KeyX' && player.mode === 'foot') { player.walking = !player.walking; H.toast(player.walking ? 'Walking. X to jog.' : 'Jogging. X to walk.'); }
  });
  on(window, 'keyup', e => keys.delete(e.code));
  on(window, 'blur', () => keys.clear());
  let drag = null;
  on(canvas, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); A.start(); if (cine.active) cine.skip(); });
  on(canvas, 'pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    cam.yaw += dx * 0.006; cam.pitch = Math.max(-0.25, Math.min(1.35, cam.pitch + dy * 0.005));
    cam.lastInput = clockT;
  });
  on(canvas, 'pointerup', e => { if (drag && drag.moved < 6 && dlg.open) dlg.next(false); drag = null; });
  on(canvas, 'wheel', e => {
    e.preventDefault();
    if (player.mode === 'heli' && cam.mode === 'bird') cam.birdAlt = Math.max(120, Math.min(1200, cam.birdAlt * (e.deltaY > 0 ? 1.12 : 0.89)));
    else cam.dist = Math.max(2.5, Math.min(player.mode === 'foot' ? 30 : 120, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
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
    hold('#gt-down', () => { if (player.mode === 'heli') touchLift = -1; else guessStart(); }, () => { touchLift = 0; }); // Down in the air, Guess on foot
    hold('#gt-run', () => { keys.has('ShiftLeft') ? keys.delete('ShiftLeft') : keys.add('ShiftLeft'); $('#gt-run').setAttribute('aria-pressed', String(keys.has('ShiftLeft'))); });
    hold('#gt-cam', () => { cam.mode = cam.mode === 'bird' ? 'chase' : 'bird'; });
    hold('#gt-lens', () => lens());
  }
  let skip = false, waitFerry = null, lastDock = null;

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
    for (const w of G.wharves) { const d = Math.min(Math.hypot(w.terminal[0] - x, w.terminal[1] - y), Math.hypot(w.berth[0] - x, w.berth[1] - y)); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  function currentAction() {
    if (dlg.open || uiOpen() || cine.active) return null;
    if (player.mode === 'heli') {
      if (heli.st.landed && heli.st.speed < 1) return { key: 'E', text: 'Get out', act: exitHeli };
      return null;
    }
    if (player.mode === 'ferry') {
      const v = player.vehicle, here = fer.stopOf(v);
      if (here) return { key: 'E', text: `Get off at ${wharfById(here).name}`, act: alight };
      return null;
    }
    if (player.auto) return null;
    let bn = null, bd = 3.2;
    for (const n of npcs) { const d = Math.hypot(n.x - player.x, n.y - player.y); if (d < bd && Math.abs(n.z - player.z) < 2) { bd = d; bn = n; } }
    if (bn) return { key: 'E', text: `Talk to ${bn.name}`, act: () => talkTo(bn) };
    if (Math.hypot(heli.st.x - player.x, heli.st.y - player.y) < 10 && Math.abs(heli.st.z - player.z) < 3) return { key: 'E', text: 'Fly the helicopter', act: enterHeli };
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

  function board(v, w) {
    player.mode = 'ferry'; player.vehicle = v; v.rider = true;
    qs.visited[w.id] = true;
    for (const [l, s] of rideSteps()) if (s.from === w.id) ls(l).rideFrom = w.id;
    cam.yaw = v.h + 0.9; cam.dist = 42; cam.pitch = 0.32;
    H.toast(`Aboard ${v.name}, ${v.route}. Next stop: ${wharfById(fer.nextStop(v)).name}. <kbd>F</kbd> to skip ahead, <kbd>H</kbd> to take the helm.`);
    A.engine(0.5);
  }
  function placeNear(x, y, z0) { // a walkable spot close to (x, y)
    for (let r = 0; r < 45; r += 1.5) for (let a = 0; a < 6.28; a += r ? 0.5 / Math.max(1, r / 3) : 7) {
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, f = nav.walk(px, py, z0 + 3);
      if (f.ok) return [px, py, f.z];
    }
    return null;
  }
  function alight() {
    const v = player.vehicle, here = fer.stopOf(v), w = wharfById(here);
    const p = placeNear(w.terminal[0], w.terminal[1], 2) || placeNear(w.berth[0], w.berth[1], 2);
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
  function enterHeli() {
    const d = heli.doorAt();
    player.auto = { x: d.x, y: d.y, t: 0, then: () => {
      player.mode = 'heli'; player.vehicle = heli; heli.st.on = true;
      heli.group.add(player.rig.root);
      player.rig.root.position.copy(heli.seat); player.rig.root.rotation.set(0, 0, 0);
      cam.mode = 'chase'; cam.dist = 24; cam.pitch = 0.28; cam.yaw = heli.st.h;
      H.toast('Rotor spooling up. Space climb, C (or Shift) descend, W/S forward/back, A/D turn, V bird\'s-eye view.');
    } };
  }
  function exitHeli() {
    const d = heli.doorAt(), p = placeNear(d.x, d.y, heli.st.z + 0.5);
    if (!p) { H.toast('Land somewhere you can step out.'); return; }
    heli.st.on = false;
    heli.group.remove(player.rig.root); world.add(player.rig.root);
    player.mode = 'foot'; player.vehicle = null;
    [player.x, player.y, player.z] = p;
    cam.mode = 'chase'; cam.dist = 6.5;
    camera.up.set(0, 1, 0);
    save();
  }
  function unstuck() {
    const p = placeNear(player.x, player.y, player.z) || placeNear(G.start.at[0], G.start.at[1], 3);
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
  function lens() {
    if (player.mode !== 'foot') return;
    guess.bi = -1;
    const hit = aimed();
    if (!hit) { H.toast('Aim at a building and press Q.'); return; }
    const bi = hit.bi, m = B.b[bi];
    U.uSel.value = bi;
    const name = m[0] || (m[1] ? `Unnamed ${m[1].replace(/_/g, ' ')}` : 'Unnamed building');
    const osm = m[6] && /^[wr]\d+$/.test(m[6]) ? `<a href="https://www.openstreetmap.org/${m[6][0] === 'w' ? 'way' : 'relation'}/${m[6].slice(1)}" target="_blank" rel="noopener">${m[6]}</a>` : '–';
    const SRC = { plateau: 'Measured by aerial survey (Project PLATEAU)', plateau_lod1: 'Block height in Project PLATEAU (no survey record)', mapped: 'Surveyed in OpenStreetMap', floors: 'Floor count × storey height', estimate: 'Estimated from neighbours', ml: 'ML estimate, bias-corrected', reference: 'Published height (corrected)', verified: 'Verified from a cited source', parametric: 'Parametric landmark' };
    $('#g-lens').innerHTML = `<span class="eyebrow">Survey lens · ${Math.round(hit.distance)} m away</span><b>${name}</b>
      <dl class="kv"><dt>Height</dt><dd class="num">${m[2].toFixed(1)} m</dd><dt>Source</dt><dd>${SRC[m[4]] || m[4]}</dd>${m[3] ? `<dt>Floors</dt><dd class="num">${m[3]}</dd>` : ''}${m[4] === 'reference' ? `<dt>Open data said</dt><dd class="num">${m[9].toFixed(1)} m</dd>` : ''}<dt>OSM</dt><dd>${osm}</dd></dl>`;
    $('#g-lens').hidden = false;
    clearTimeout(lens.t);
    lens.t = setTimeout(() => { $('#g-lens').hidden = true; U.uSel.value = -1; }, 6000);
    for (const l of openLines()) {
      const s = stepOf(l), got = ls(l).inspected;
      if (s && s.type === 'inspect' && s.sources.includes(m[4]) && !got.includes(m[4])) { got.push(m[4]); A.chime(); H.toast(`Found one: ${SRC[m[4]]} (${got.length}/${s.sources.length})`); checkSteps(); }
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
  const SRC_GROUP = { mapped: 'surveyed', reference: 'surveyed', verified: 'surveyed', floors: 'floors', ml: 'estimated', estimate: 'estimated' };
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

  // ------------------------------------------------------------ menus, map, passport
  function toggleMenu() { $('#g-menu').hidden = !$('#g-menu').hidden; }
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
    for (const v of fer.vessels) icon({ kind: 'ferry' }, ...P2(v.x, v.y));
    if (player.mode !== 'heli') icon({ kind: 'heli' }, ...P2(heli.st.x, heli.st.y));
    for (const n of npcs) icon({ kind: 'npc', color: wantsTalk(n) ? '#e0a21a' : '#5b6b77', label: n.name[0] }, ...P2(n.x, n.y));
    for (const o of sideObjectives()) icon({ kind: 'quest2' }, ...P2(...o.at));
    const ob = objective();
    if (ob && ob.at) icon({ kind: 'quest' }, ...P2(...ob.at));
    if (waypoint) icon({ kind: 'waypoint' }, ...P2(...waypoint));
    const [px, py] = P2(player.mode === 'heli' ? heli.st.x : player.mode === 'ferry' ? player.vehicle.x : player.x, player.mode === 'heli' ? heli.st.y : player.mode === 'ferry' ? player.vehicle.y : player.y);
    g.translate(px / dpr, py / dpr); g.rotate(player.mode === 'heli' ? heli.st.h : player.h);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent'); g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // fast travel to wharves you have used, the helipad and the start
    const dest = [{ id: 'start', name: 'Where you started', at: G.start.at }].concat(G.wharves.filter(w => qs.visited[w.id]).map(w => ({ id: w.id, name: w.name, at: w.terminal })));
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
    const [x, y] = b.dataset.at.split(',').map(Number), p = placeNear(x, y, 3);
    if (p) { $('#g-bigmap').hidden = true; hopTo(p[0], p[1], p[2], b.textContent); }
  });
  on($('#g-map-btn'), 'click', toggleMap);
  on($('#gq-lines'), 'click', e => { const b = e.target.closest('button'); if (b) cycleTrack(b.dataset.line); });
  on($('#g-pass-btn'), 'click', togglePass);
  on($('#g-menu-btn'), 'click', toggleMenu);
  for (const id of ['#g-bigmap-close', '#g-pass-close', '#g-menu-close']) on($(id), 'click', () => { $(id).closest('.g-overlay').hidden = true; });
  on($('#gm-time'), 'click', e => { const b = e.target.closest('button'); if (b) { presetTime(b.dataset.t); H.toast(`Time: ${b.textContent}`); } });
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
  on($('#gm-reset'), 'click', () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } qs = freshQs(); renderPassport(); spawn(); H.toast('New survey started.'); $('#g-menu').hidden = true; });

  // ------------------------------------------------------------ start
  function spawn(pos, zRef) { // at ground level (or on steps built on it) unless a height is given
    const at = pos || G.start.at;
    let z0 = Math.max(0, nav.terrain(at[0], at[1]));
    for (const st of nav.strips) { const h = st.drape ? nav.stripHeight(st, at[0], at[1]) : null; if (h != null && h > z0) z0 = h; }
    const f = nav.floorAt(at[0], at[1], zRef ?? z0 + 1);
    player.x = at[0]; player.y = at[1]; player.z = f ? f.z : 2;
    const fa = G.start.facing || [at[0], at[1] + 10];
    player.h = Math.atan2(fa[0] - at[0], fa[1] - at[1]);
    cam.yaw = player.h; cam.pitch = 0.36; cam.dist = 7.5;
    if (typeof groundLod === 'function' && Wd.groundMeshes[0].material.userData.street) groundLod(player.x, player.y);
  }
  spawn();
  presetTime('live');
  if (sun.altitude < -2) { // arriving at night shows little; offer nine in the morning first
    presetTime('morning');
    $$('#gt-timechoice button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === 'morning')));
  }
  const saved = loadSave();
  if (saved) $('#gt-continue').hidden = false;
  const startGame = cont => {
    A.start();
    if (cont && saved) {
      qs = Object.assign(qs, migrate(saved.qs));
      spawn(saved.pos);
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
  $('#g-loader').classList.add('out');
  setTimeout(() => { $('#g-loader').hidden = true; }, reduced ? 0 : 700);
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
    const titleOn = !$('#g-title').hidden, paused = titleOn || !$('#g-menu').hidden;
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
    if (titleOn) titleYaw += dt * 0.05;
    updateCamera(dt, titleOn);
    stage.classList.toggle('cine', cine.active && (cine.label !== 'crane' || cine.k < 0.5));
    // world clocks and fades
    Wd.tick(now, camera);
    if (window.OEKit) OEKit.setNight(U.uNight.value); // cabin windows and navigation lights
    fer.vessels.forEach(v => (v.events || []).splice(0).forEach(ev => onFerryEvent(ev)));
    dlg.tick(dt);
    // HUD
    const ob = titleOn ? null : objective();
    const target = waypoint || (ob && ob.at);
    updateRoute(clockT, player.mode === 'foot' ? target : null);
    beam.visible = !!target && !titleOn && Math.hypot(target[0] - (player.mode === 'heli' ? heli.st.x : player.x), target[1] - (player.mode === 'heli' ? heli.st.y : player.y)) > 45;
    if (target) { const f = nav.floorAt(target[0], target[1], 300); beam.position.copy(W(target[0], target[1], f ? f.z : 0)); beam.scale.set(1, player.mode === 'heli' ? 4 : 1, 1); }
    const me = player.mode === 'heli' ? heli.st : player.mode === 'ferry' ? player.vehicle : player;
    $('#gq-title').textContent = ob ? ob.title : (Q.length && LINES.every(lineDone) ? 'Free roam' : '');
    if (!titleOn) renderLines();
    const trigLeft = VP.filter(v => !trigDone()[v.id]).length;
    $('#gq-step').textContent = ob ? ob.text : trigLeft ? `The city is yours. ${trigLeft} trig station${trigLeft > 1 ? 's' : ''} still to survey (△ on the map), or change the time and fly anywhere.`
      : 'The city is yours. Change the time, ride the ferries, fly anywhere.';
    $('#gq-dist').textContent = target ? `${Math.round(Math.hypot(target[0] - me.x, target[1] - me.y))} m` : '';
    if (!titleOn) {
      const icons = [];
      for (const w of G.wharves) icons.push({ kind: 'wharf', x: w.terminal[0], y: w.terminal[1] });
      for (const h of G.helipads) icons.push({ kind: 'pad', x: h.at[0], y: h.at[1] });
      for (const v of VP) icons.push({ kind: 'trig', x: v.x, y: v.y, done: !!trigDone()[v.id] });
      for (const v of fer.vessels) icons.push({ kind: 'ferry', x: v.x, y: v.y });
      if (player.mode !== 'heli') icons.push({ kind: 'heli', x: heli.st.x, y: heli.st.y });
      for (const n of npcs) { const hot = wantsTalk(n); n.marker.visible = hot && !dlg.open; if (hot) icons.push({ kind: 'npc', x: n.x, y: n.y, color: '#e0a21a', pin: true }); }
      for (const o of sideObjectives()) icons.push({ kind: 'quest2', x: o.at[0], y: o.at[1] });
      if (ob && ob.at) icons.push({ kind: 'quest', x: ob.at[0], y: ob.at[1], pin: true });
      if (waypoint) icons.push({ kind: 'waypoint', x: waypoint[0], y: waypoint[1], pin: true });
      drawMini({ x: me.x, y: me.y, yaw: cam.mode === 'bird' && player.mode === 'heli' ? heli.st.h : cam.yaw, heading: player.mode === 'heli' ? heli.st.h : player.mode === 'ferry' ? player.vehicle.h : player.h,
        radius: player.mode === 'heli' ? 700 : player.mode === 'ferry' ? 450 : 200, route, icons });
      if (!$('#g-bigmap').hidden && Math.floor(clockT * 2) !== Math.floor((clockT - dt) * 2)) drawBig();
      const a = currentAction();
      $('#g-prompt').hidden = !a;
      if (a) { $('#gp-key').textContent = a.key; $('#gp-key').hidden = !a.key; $('#gp-text').textContent = a.text; }
      vehicleHud();
    }
    // a low frame rate is worth a hint (slowroads does the same)
    fpsAcc[0] += dt; fpsAcc[1]++;
    if (fpsAcc[0] > 6) { if (!fpsWarned && fpsAcc[1] / fpsAcc[0] < 22 && !titleOn) { fpsWarned = true; H.toast('Running slowly? Lower the crowd density in the menu (Esc).'); } fpsAcc = [0, 0]; }
    renderer.render(world, camera);
    updateLabels();
    requestAnimationFrame(frame);
  }

  function simulate(dt) {
    const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + joy.y;
    const side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + joy.x;
    const held = dlg.open || cine.label === 'hop' || cine.label === 'survey';
    if (player.mode === 'foot') walkStep(dt, held ? 0 : fwd, held ? 0 : side);
    else if (player.mode === 'heli') {
      const lift = (k('Space') ? 1 : 0) - (k('KeyC') || k('ShiftLeft') || k('ShiftRight') ? 1 : 0) + touchLift;
      const events = [];
      heli.update(dt, { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, side)), lift: Math.max(-1, Math.min(1, lift)) }, events);
      for (const ev of events) {
        if (ev.type === 'under_bridge') { H.toast(`<b>Under the ${ev.name || 'bridge'}!</b> ${G.under_bridge_note || ''}`); A.chime(); for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'under_bridge') completeStep(l); } }
        if (ev.type === 'bump' && clockT - bumpT > 2) { bumpT = clockT; H.toast('Careful! That was a building.'); }
      }
      A.rotor(heli.st.rotor, Math.abs(lift) + Math.abs(fwd) * 0.5);
      A.wind(Math.min(1, heli.st.speed / 60));
      player.rig.animate(dt, 0, 'sit', clockT);
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
    fer.update(dt, skip ? 8 : 1, clockT, waitFerry ? 25 : 1);
    if (player.mode === 'ferry') { // stand on the upper deck
      const v = player.vehicle, c = Math.cos(v.h), s = Math.sin(v.h), D = fer.deck;
      player.x = v.x + s * D.fwd + c * D.right; player.y = v.y + c * D.fwd - s * D.right; player.z = D.up; player.h = v.h;
      if (v.phase === 'dwell') skip = false;
    }
    if (player.mode !== 'heli') { player.rig.root.position.copy(W(player.x, player.y, player.z)); player.rig.root.rotation.y = Math.PI - player.h; }
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
    crowd.update(dt, cx, cy, clockT, player.mode === 'foot' ? player : null);
    benchBudget += dt * 60; // keep what the benches near the player offer up to date, about 60 a second
    if (benchBudget >= 1) { benches.refresh(benchLit, cx, cy, CR.radius_m || 450, Math.floor(benchBudget)); benchBudget -= Math.floor(benchBudget); }
    cars.update(dt, cx, cy, clockT, player.mode === 'foot' ? [player] : []);
  }

  function walkStep(dt, fwd, side) {
    if (player.auto) { // walking up to a door
      const a = player.auto, dx = a.x - player.x, dy = a.y - player.y, d = Math.hypot(dx, dy);
      a.t += dt;
      if (d < 0.7 || a.t > 5) { player.auto = null; a.then(); return; }
      fwd = 1; side = 0;
      player.h += angDiff(Math.atan2(dx, dy), player.h) * Math.min(1, dt * 8);
      const sp = 2.2, nx = player.x + Math.sin(player.h) * sp * dt, ny = player.y + Math.cos(player.h) * sp * dt, w = nav.walk(nx, ny, player.z);
      if (w.ok) { player.x = nx; player.y = ny; player.z = w.z; } else a.t = 9;
      player.rig.animate(dt, sp, 'ground', clockT);
      return;
    }
    const m = Math.min(1, Math.hypot(fwd, side));
    const run = k('ShiftLeft') || k('ShiftRight');
    const target = m > 0.05 ? (run ? 5.4 : player.walking ? 1.35 : 2.8) * m : 0; // jog, walk (X) or sprint (Shift)
    player.speed += (target - player.speed) * Math.min(1, dt * (target > player.speed ? 6 : 10));
    if (m > 0.05) {
      const dir = cam.yaw + Math.atan2(side, fwd);
      player.h += angDiff(dir, player.h) * Math.min(1, dt * 10);
    }
    // move as Unreal's CharacterMovementComponent does: sweep the capsule and slide along the
    // walls it meets, then check the floor where it ends up (water, a drop). At the seawall,
    // where the floor check fails, try one axis at a time.
    const sx = Math.sin(player.h) * player.speed * dt, sy = Math.cos(player.h) * player.speed * dt;
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
      } else if (w.why === 'water' && clockT - waterT > 20) { waterT = clockT; H.toast(`No swimming in ${G.water_name || 'the water'}.${G.wharves.length ? ' Ferries leave from the wharves marked F.' : ''}`); }
    }
    if (dt > 0) player.speed = Math.min(player.speed, moved / dt); // the speed is what the move achieved, so the walk cycle slows against a wall
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
  let titleYaw = 0;
  function updateCamera(dt, titleOn) {
    if (titleOn) { // slow orbit near the start for the title screen
      titleLook.copy(W(player.x + 120, player.y + 160, player.z + 20));
      camera.up.set(0, 1, 0);
      camera.position.copy(titleLook).add(new THREE.Vector3(Math.sin(titleYaw) * -420, 210, Math.cos(titleYaw) * 420));
      camera.lookAt(titleLook);
      live.pos.copy(camera.position);
      Wd.fitShadow(titleLook, 600);
      return;
    }
    rig(dt);
    const shot = cine.step(clockT), fov = shot && cine.label === 'survey' ? surveyFov : BASE_FOV;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (shot) {
      camera.up.set(0, 1, 0);
      camera.position.copy(shot.pos);
      camera.position.y = Math.max(camera.position.y, roofBelow(camera.position.x, -camera.position.z) + 3); // never inside a building
      camera.lookAt(shot.look);
      Wd.fitShadow(shot.look, THREE.MathUtils.clamp(camera.position.distanceTo(shot.look) * 1.2, live.half, 1600));
      return;
    }
    camera.up.copy(live.up);
    camera.position.copy(live.pos);
    camera.lookAt(live.look);
    Wd.fitShadow(live.look, live.half);
  }
  function rig(dt) {
    const k2 = Math.min(1, dt * 6);
    if (player.mode === 'heli' && cam.mode === 'bird') {
      const st = heli.st, g = nav.groundBelow(st.x, st.y, st.z);
      live.pos.lerp(W(st.x, st.y, Math.max(st.z, g) + cam.birdAlt), k2);
      live.up.set(Math.sin(st.h), 0, -Math.cos(st.h));
      live.look.copy(W(st.x, st.y, st.z));
      live.half = Math.min(2400, cam.birdAlt * 1.4);
      return;
    }
    live.up.set(0, 1, 0);
    let tx, ty, tz, follow;
    if (player.mode === 'heli') { tx = heli.st.x; ty = heli.st.y; tz = heli.st.z + 2.5; follow = heli.st.h; }
    else if (player.mode === 'ferry') { tx = player.vehicle.x; ty = player.vehicle.y; tz = 5; follow = null; }
    else { tx = player.x; ty = player.y; tz = player.z + 1.55; follow = player.h; }
    // drift behind the direction of travel when the player is not steering the camera
    if (follow != null && clockT - cam.lastInput > 1.6 && (player.mode === 'heli' ? heli.st.speed > 3 : player.speed > 1)) cam.yaw += angDiff(follow, cam.yaw) * Math.min(1, dt * (player.mode === 'heli' ? 1.6 : 0.9));
    const dist = player.mode === 'heli' ? Math.max(14, cam.dist) : player.mode === 'ferry' ? Math.max(25, cam.dist) : cam.dist;
    camTarget.lerp(W(tx, ty, tz), player.mode === 'foot' ? 1 : k2);
    // keep the camera out of walls: first rise over them (look down on the player), then come closer
    let best = null;
    for (const lift of [0, 0.25, 0.5, 0.8]) {
      const pitch = Math.min(1.35, cam.pitch + lift), cp = Math.cos(pitch);
      const pos = new THREE.Vector3(camTarget.x - Math.sin(cam.yaw) * cp * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(cam.yaw) * cp * dist);
      const f = nav.clearFraction(camTarget, pos);
      if (!best || f > best.f + 0.05) best = { f, pos };
      if (f >= 0.97) break;
    }
    camPos.copy(best.pos);
    if (best.f < 1) camPos.lerpVectors(camTarget, best.pos, Math.max(0.15, best.f - 0.04));
    if (camSmooth.lengthSq() === 0 || camSmooth.distanceTo(camPos) > 60) camSmooth.copy(camPos); // after a teleport
    camSmooth.lerp(camPos, player.mode === 'foot' ? Math.min(1, dt * 10) : 1);
    camPos.copy(camSmooth);
    let gz = nav.terrain(camPos.x, -camPos.z);
    for (const st of nav.strips) { // steps and decks below the player's head lift the camera too
      const h = nav.stripHeight(st, camPos.x, -camPos.z);
      if (h != null && h < camTarget.y + 0.5 && h > gz) gz = h;
    }
    if (camPos.y < gz + 0.5) camPos.y = gz + 0.5;
    live.pos.copy(camPos);
    live.look.copy(camTarget);
    live.half = player.mode === 'heli' ? 520 : player.mode === 'ferry' ? 320 : 170;
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
  // Fast travel: rise over the player, fly across the city at a height that grows with
  // the distance, and come down behind them facing the way they flew. The player moves
  // at the top of the climb, out of sight.
  function hopTo(x, y, z, name) {
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
      cues: [[a, () => {
        [player.x, player.y, player.z] = [x, y, z];
        player.h = bearing; player.speed = 0; player.vz = 0; player.ground = true;
        cam.mode = 'chase'; cam.yaw = bearing; cam.pitch = 0.36; cam.dist = 7.5;
        groundLod(x, y);
        save();
      }]],
      onEnd: () => H.toast(`You're at ${name}.`) });
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
    if (touch) { $('#gt-down').hidden = player.mode === 'ferry'; $('#gt-down').textContent = player.mode === 'heli' ? 'Down' : 'Guess'; $('#gt-jump').textContent = player.mode === 'heli' ? 'Up' : 'Jump'; }
    if (player.mode === 'heli') {
      const st = heli.st, g = nav.groundBelow(st.x, st.y, st.z);
      el.hidden = false;
      el.innerHTML = `<div><b class="num">${Math.round(st.z)} m</b><span>altitude</span></div><div><b class="num">${Math.round(st.z - g)} m</b><span>above ground</span></div>
        <div><b class="num">${Math.round(st.speed * 3.6)}</b><span>km/h</span></div><div><b class="num">${Math.round(st.rotor * 100)}%</b><span>rotor</span></div>
        <p class="note">Space climb · C descend · W/S · A/D turn · V ${cam.mode === 'bird' ? 'chase view' : "bird's-eye"}${st.landed ? ' · E get out' : ''}</p>`;
    } else if (player.mode === 'ferry') {
      const v = player.vehicle, nxt = wharfById(fer.nextStop(v));
      const t = v.phase === 'dwell' ? v.t : fer.eta(v, nxt.id);
      el.hidden = false;
      el.innerHTML = `<div><b>${v.name}</b><span>${v.route}</span></div><div><b>${v.phase === 'dwell' ? 'Departs' : nxt.name}</b><span>${v.phase === 'dwell' ? `in ${fmtSec(t)}` : `in ${fmtSec(t)}`}</span></div>
        <div><b class="num">${(Math.abs(v.speed) * 1.94).toFixed(0)}</b><span>knots</span></div>${v.helm && v.helm.manual ? `<div><b class="num">${Math.round(v.helm.dist || 0)} m</b><span>to berth</span></div>` : ''}
        <p class="note">${v.phase === 'dwell' ? 'E get off · ' : ''}F ${skip ? 'normal speed' : 'skip ahead'} · H take the helm · drag to look around</p>`;
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
  window.__game = { footNet, benches, sunWant, benchTalk, advance, dlg, lastDock: () => lastDock, waypoint: w => { waypoint = w; }, player, heli, fer, npcs, crowd, cars, nav, clock, setClock, qs: () => qs, quest, step, completeStep, talkTo, board, alight, interact, enterHeli, exitHeli, spawn, objective, lens, camera, cam, DSM, graph, currentAction, keys, cine, hopTo, craneIn, live, VP, viewshed, survey, renderPassport, guess, guessStart, guessCheck, completeQuest, LINES, ls, tracked, cycleTrack, openLines };
  return {
    stop() { running = false; ac.abort(); ro.disconnect(); renderer.dispose(); Wd.dispose(); A.stop(); window.__game = null; },
  };
};
