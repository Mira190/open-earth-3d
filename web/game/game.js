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
  $('#gt-city').textContent = `${CITY.name}, ${CITY.country}`;
  const stage = $('#game-stage'), canvas = $('#game-gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 40000);
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
  const FOOTW = { pedestrian: 8, footway: 3, path: 2.5, steps: 3, cycleway: 2.5, living_street: 5 };
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
    const t = scene.ground[i], w = t.x1 - t.x0, h = t.y1 - t.y0, coarse = Wd.groundMeshes[i];
    const g = new THREE.PlaneGeometry(w, h, Math.round(w / T.cell), Math.round(h / T.cell));
    g.rotateX(-Math.PI / 2);
    g.translate((t.x0 + t.x1) / 2, 0, -(t.y0 + t.y1) / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, S.terrainAt(T, p.getX(k), -p.getZ(k)));
    g.computeVertexNormals();
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
  const benches = G.props.bench || [], lamps = G.props.street_lamp || [];
  const benchMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.45, 0.55).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: lin('#6e5a44'), roughness: 0.9 }), benches.length / 3);
  for (let i = 0; i < benches.length / 3; i++) { dummy.position.copy(W(benches[3 * i] / 10, benches[3 * i + 1] / 10, benches[3 * i + 2] / 10)); dummy.rotation.y = (i * 2.399) % Math.PI; dummy.updateMatrix(); benchMesh.setMatrixAt(i, dummy.matrix); }
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
  let playerChar = 'W_Worker';
  try { if (PLAYER_LOOKS[localStorage.getItem(PLAYER_KEY)]) playerChar = localStorage.getItem(PLAYER_KEY); } catch (e) { /* storage blocked */ }
  let lib = null;
  try {
    lib = await OEPeople.load('assets/people/');
    await Promise.all([...Object.keys(PLAYER_LOOKS), ...G.npcs.map(n => n.look.character).filter(Boolean)].map(lib.require));
  } catch (e) { console.warn('Realistic people unavailable, using simple figures:', e); lib = null; }
  const makeRig = (look, opts) => (lib && look.character && lib.tpl[look.character] ? OEPeople.person(lib, Object.assign({}, look)) : OEActors.makePerson(look, opts));
  const footNet = OEActors.network(G.paths.foot), roadNet = OEActors.network(G.paths.road);
  const CR = G.crowd || {};
  const crowd = OEActors.crowd(world, footNet, U, CR.pedestrians || 300, CR.radius_m || 450, lib && (P => OEPeople.crowdRenderer(world, lib, U, P, { near: touch ? 6 : 14 })));
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
      marker: OEActors.sprite('!', { bg: '#e0a21a', fg: '#1b1b1b', font: '900 44px "Public Sans", sans-serif' }) });
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
  const SRC_TEXT = { mapped: 'its height is surveyed in OpenStreetMap', floors: 'its height is its floor count times a storey height', estimate: 'its height is estimated from its neighbours',
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
    opts.push('G\'day.', 'Lovely spot, isn\'t it?');
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
    Wd.setSun(sun);
    const night = U.uNight.value;
    headMat.emissiveIntensity = 1.6 * night;
    glowMat.opacity = 0.85 * night;
    const loc = S.utcToLocal(S.localToUtc(clock.y, clock.m, clock.d, clock.min));
    $('#g-time').textContent = `${fmtMin(clock.min)} ${loc.zone}`;
    $('#g-date').textContent = `${clock.d} ${MONTHS[clock.m - 1]}${clock.frozen ? ' · paused' : clock.scale === 1 ? ' · real time' : ''}`;
  }
  function presetTime(kind) {
    const now = S.utcToLocal(Date.now());
    clock.scale = clock.scale === 1 ? 1 : 30;
    if (kind === 'live') return setClock(now.y, now.m, now.d, now.minutes);
    const L = S.dayLimits(now.y, now.m, now.d);
    const min = { morning: 9 * 60, noon: L.noon, golden: L.sunset - 50, night: 21 * 60 }[kind] ?? 600;
    setClock(now.y, now.m, now.d, min);
  }

  // ------------------------------------------------------------ quests
  const Q = G.quests || [];
  let qs = { qi: 0, started: false, si: -1, stamps: [], visited: {}, inspected: [], rideFrom: null, docked: false };
  const quest = () => Q[qs.qi];
  const step = () => (qs.started && quest() ? quest().steps[qs.si] : null);
  function objective() {
    const q = quest();
    if (!q) return null;
    if (!qs.started) { const n = npcById(q.giver); return { text: `Talk to ${n.name} (${n.role})`, at: [n.x, n.y], title: q.title }; }
    const s = step();
    if (!s) return null;
    const out = { text: s.text, title: q.title };
    if (s.type === 'talk') { const n = npcById(s.npc); out.at = [n.x, n.y]; }
    else if (s.type === 'ride') { const w = wharfById(player.mode === 'ferry' ? s.to : s.from); out.at = w.terminal; }
    else if (s.type === 'surface' || s.type === 'under_bridge') { const st = nav.strips.find(x => x.name === (s.surface || x.name)); if (st) out.at = st.origin.slice(); }
    else if (s.type === 'land' || s.type === 'sun') { const pl = placeByName(s.place); if (pl) out.at = centroid(pl); }
    if (s.type === 'inspect') out.text += ` (${qs.inspected.length}/${s.sources.length})`;
    return out;
  }
  function completeStep() {
    qs.si++;
    if (qs.si >= quest().steps.length) completeQuest();
    else { H.toast(`<b>Next:</b> ${quest().steps[qs.si].text}`); save(); }
  }
  function completeQuest() {
    const q = quest();
    qs.stamps.push({ id: q.id, stamp: q.stamp, title: q.title, at: `${clock.d} ${MONTHS[clock.m - 1]} ${fmtMin(clock.min)}` });
    A.chime();
    H.toast(`<span class="eyebrow">Passport stamp</span><b>${q.stamp}</b><span>${q.title}</span>`, 'stamp');
    qs.qi++; qs.started = false; qs.si = -1; qs.inspected = []; qs.rideFrom = null;
    renderPassport();
    save();
  }
  function startQuest(q) {
    qs.started = true; qs.si = 0;
    if (!q.steps.length) completeQuest();
    else { H.toast(`<b>${q.title}</b><span>${q.steps[0].text}</span>`); save(); }
  }
  function talkTo(n) {
    const q = quest(), s = step();
    n.talking = true;
    const finish = () => { n.talking = false; };
    if (s && s.type === 'talk' && s.npc === n.id) {
      completeStep();
      const nq = quest();
      if (nq && nq.giver === n.id && !qs.started) return giveQuest(n, nq);
    }
    if (q && !qs.started && q.giver === n.id) return giveQuest(n, q);
    dlg.show(n, [fill(n.idle[Math.floor(Math.random() * n.idle.length)] || smalltalk(n.x, n.y))], null, finish);
  }
  function giveQuest(n, q) {
    dlg.show(n, q.talk.map(fill), q.choices, c => {
      n.talking = false;
      if (c && c.action === 'set_time') { const [m, d] = c.date; setClock(clock.y, m, d, S.hm(c.time)); H.toast(`Time set to ${c.time}, ${d} ${MONTHS[m - 1]}`); }
      startQuest(q);
    });
  }
  function checkSteps() {
    const s = step();
    if (!s) return;
    if (s.type === 'surface' && player.mode === 'foot' && player.floor === s.surface) {
      const st = nav.strips.find(x => x.name === s.surface), [u] = nav.stripUV(st, player.x, player.y);
      if (u >= s.u[0] && u <= s.u[1]) completeStep();
    } else if (s.type === 'land' && player.mode === 'heli' && heli.st.landed && inPlace(placeByName(s.place), heli.st.x, heli.st.y)) completeStep();
    else if (s.type === 'sun' && player.mode === 'foot' && sunState === 'sun' && clock.m === s.date[0] && clock.d === s.date[1] &&
      clock.min >= S.hm(s.window[0]) && clock.min <= S.hm(s.window[1]) && inPlace(placeByName(s.place), player.x, player.y)) completeStep();
    else if (s.type === 'inspect' && s.sources.every(k => qs.inspected.includes(k))) completeStep();
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
    $('#gp-stamps').innerHTML = Q.map(q => {
      const got = qs.stamps.find(s => s.id === q.id);
      return `<li class="${got ? 'got' : ''}"><span class="stamp">${got ? q.stamp : '?'}</span><span><b>${got ? q.title : 'Not yet'}</b><span class="note">${got ? got.at : ''}</span></span></li>`;
    }).join('') + (qs.stamps.some(s => s.id === 'ferry-master') ? '<li class="got"><span class="stamp">Ferry master</span><span><b>Docked by hand</b></span></li>' : '');
    $('#g-pass-count').textContent = `${qs.stamps.filter(s => Q.some(q => q.id === s.id)).length}/${Q.length}`;
  }
  // labels: landmarks, wharves, the helipad, NPC names
  const labelsEl = $('#g-labels'), labels = [];
  const addLabel = (text, get, maxD, cls = '') => { const el = document.createElement('div'); el.className = `lbl ${cls}`; el.innerHTML = text; el.hidden = true; labelsEl.appendChild(el); labels.push({ el, get, maxD }); };
  for (const [name, p] of Object.entries(scene.labels || {})) addLabel(name, () => W(p[0], p[1], p[2] + 6), 1400);
  for (const w of G.wharves) addLabel(`<span class="tag f">F</span>${w.name}`, () => W(w.terminal[0], w.terminal[1], 6), 300, 'wharf');
  for (const h of G.helipads) addLabel(`<span class="tag h">H</span>${h.name}`, () => W(h.at[0], h.at[1], h.at[2] + 6), 400, 'wharf');
  for (const n of npcs) addLabel(`${n.name}<span class="role">${n.role}</span>`, () => W(n.x, n.y, n.z + (n.marker.visible ? 3.0 : 2.15)), 40, 'npc');
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, placed = [];
    const far = player.mode === 'heli' ? 2.2 : 1;
    for (const l of labels) {
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
  let joy = { x: 0, y: 0 }, touchLift = 0, uiOpen = () => !$('#g-menu').hidden || !$('#g-bigmap').hidden || !$('#g-pass').hidden || !$('#g-title').hidden;
  const k = c => keys.has(c);
  on(window, 'keydown', e => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) { keys.add(c); return; }
    keys.add(c);
    if (!$('#g-title').hidden) { if (c === 'Enter') $('#gt-play').click(); return; }
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
  on(canvas, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); A.start(); });
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
    hold('#gt-down', () => { touchLift = -1; }, () => { touchLift = 0; });
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
  const rideTarget = wid => { const s = step(); return s && s.type === 'ride' && s.from === wid ? s.to : null; };
  function nearWharf(x, y, r = 30) {
    let best = null, bd = r;
    for (const w of G.wharves) { const d = Math.min(Math.hypot(w.terminal[0] - x, w.terminal[1] - y), Math.hypot(w.berth[0] - x, w.berth[1] - y)); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  function currentAction() {
    if (dlg.open || uiOpen()) return null;
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
      dlg.show({ name: 'Passer-by', role: G.local_name || 'Local', pitch: 180 + (pi * 37) % 160, color: '#5b7f99' }, [smalltalk(p.x, p.y)]);
    } };
    return null;
  }
  function interact() { const a = currentAction(); if (a && a.act) { A.start(); a.act(); } }

  function board(v, w) {
    player.mode = 'ferry'; player.vehicle = v; v.rider = true;
    qs.visited[w.id] = true;
    const s = step();
    if (s && s.type === 'ride' && s.from === w.id) qs.rideFrom = w.id;
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
    const s = step();
    if (s && s.type === 'ride' && qs.rideFrom === s.from && here === s.to) completeStep();
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
  function lens() {
    if (player.mode !== 'foot') return;
    camera.updateMatrixWorld();
    ray.setFromCamera({ x: 0, y: 0.08 }, camera);
    ray.far = 600;
    const hit = ray.intersectObject(Wd.buildings)[0];
    if (!hit) { H.toast('Aim at a building and press Q.'); return; }
    const bi = Wd.bGeo.attributes.bid.getX(hit.face.a), m = B.b[bi];
    U.uSel.value = bi;
    const name = m[0] || (m[1] ? `Unnamed ${m[1].replace(/_/g, ' ')}` : 'Unnamed building');
    const osm = m[6] && /^[wr]\d+$/.test(m[6]) ? `<a href="https://www.openstreetmap.org/${m[6][0] === 'w' ? 'way' : 'relation'}/${m[6].slice(1)}" target="_blank" rel="noopener">${m[6]}</a>` : '–';
    const SRC = { mapped: 'Surveyed in OpenStreetMap', floors: 'Floor count × storey height', estimate: 'Estimated from neighbours', ml: 'ML estimate, bias-corrected', reference: 'Published height (corrected)', verified: 'Verified from a cited source', parametric: 'Parametric landmark' };
    $('#g-lens').innerHTML = `<span class="eyebrow">Survey lens · ${Math.round(hit.distance)} m away</span><b>${name}</b>
      <dl class="kv"><dt>Height</dt><dd class="num">${m[2].toFixed(1)} m</dd><dt>Source</dt><dd>${SRC[m[4]] || m[4]}</dd>${m[3] ? `<dt>Floors</dt><dd class="num">${m[3]}</dd>` : ''}${m[4] === 'reference' ? `<dt>Open data said</dt><dd class="num">${m[9].toFixed(1)} m</dd>` : ''}<dt>OSM</dt><dd>${osm}</dd></dl>`;
    $('#g-lens').hidden = false;
    clearTimeout(lens.t);
    lens.t = setTimeout(() => { $('#g-lens').hidden = true; U.uSel.value = -1; }, 6000);
    const s = step();
    if (s && s.type === 'inspect' && s.sources.includes(m[4]) && !qs.inspected.includes(m[4])) { qs.inspected.push(m[4]); A.chime(); H.toast(`Found one: ${SRC[m[4]]} (${qs.inspected.length}/${s.sources.length})`); checkSteps(); }
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
    for (const v of fer.vessels) icon({ kind: 'ferry' }, ...P2(v.x, v.y));
    if (player.mode !== 'heli') icon({ kind: 'heli' }, ...P2(heli.st.x, heli.st.y));
    const q = quest();
    for (const n of npcs) icon({ kind: 'npc', color: q && (!qs.started ? q.giver === n.id : step() && step().npc === n.id) ? '#e0a21a' : '#5b6b77', label: n.name[0] }, ...P2(n.x, n.y));
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
    if (p) { [player.x, player.y, player.z] = p; $('#g-bigmap').hidden = true; H.toast(`You took a taxi to ${b.textContent}.`); }
  });
  on($('#g-map-btn'), 'click', toggleMap);
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
  on($('#gm-reset'), 'click', () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } qs = { qi: 0, started: false, si: -1, stamps: [], visited: {}, inspected: [], rideFrom: null }; renderPassport(); spawn(); H.toast('New survey started.'); $('#g-menu').hidden = true; });

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
      qs = Object.assign(qs, saved.qs);
      spawn(saved.pos);
      if (saved.clock) { clock.scale = saved.clock.scale || 30; setClock(saved.clock.y, saved.clock.m, saved.clock.d, saved.clock.min); }
    }
    const tc = $('#gt-timechoice [aria-pressed="true"]');
    if (!cont && tc) presetTime(tc.dataset.t);
    $('#g-title').hidden = true;
    renderPassport();
    if (!cont) H.toast(`Find ${npcById(Q[0] ? Q[0].giver : npcs[0].id).name}: follow the gold route, or press <kbd>M</kbd> for the map.`);
  };
  on($('#gt-play'), 'click', () => startGame(false));
  on($('#gt-continue'), 'click', () => startGame(true));
  on($('#gt-timechoice'), 'click', e => { const b = e.target.closest('button'); if (b) $$('#gt-timechoice button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  const nowLoc = S.utcToLocal(Date.now());
  $('#gt-now').textContent = `Now in ${CITY.name} (${fmtMin(nowLoc.minutes)})`;
  $('#g-loader').hidden = true;
  renderPassport();

  // ------------------------------------------------------------ the loop
  let last = performance.now(), clockT = 0, sunTimer = 0, sunState = 'sun', fpsAcc = [0, 0], fpsWarned = false, stepPhase = 0, bumpT = -9, waterT = -99;
  const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camSmooth = new THREE.Vector3();
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
    else if (titleOn) { cam.yaw += dt * 0.05; }
    updateCamera(dt, titleOn);
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
    $('#gq-title').textContent = ob ? ob.title : (Q.length && qs.qi >= Q.length ? 'Free roam' : '');
    $('#gq-step').textContent = ob ? ob.text : 'The city is yours. Change the time, ride the ferries, fly anywhere.';
    $('#gq-dist').textContent = target ? `${Math.round(Math.hypot(target[0] - me.x, target[1] - me.y))} m` : '';
    if (!titleOn) {
      const icons = [];
      for (const w of G.wharves) icons.push({ kind: 'wharf', x: w.terminal[0], y: w.terminal[1] });
      for (const h of G.helipads) icons.push({ kind: 'pad', x: h.at[0], y: h.at[1] });
      for (const v of fer.vessels) icons.push({ kind: 'ferry', x: v.x, y: v.y });
      if (player.mode !== 'heli') icons.push({ kind: 'heli', x: heli.st.x, y: heli.st.y });
      const q = quest();
      for (const n of npcs) { const hot = q && (!qs.started ? q.giver === n.id : step() && step().npc === n.id); n.marker.visible = !!hot && !dlg.open; if (hot) icons.push({ kind: 'npc', x: n.x, y: n.y, color: '#e0a21a', pin: true }); }
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
    if (player.mode === 'foot') walkStep(dt, dlg.open ? 0 : fwd, dlg.open ? 0 : side);
    else if (player.mode === 'heli') {
      const lift = (k('Space') ? 1 : 0) - (k('KeyC') || k('ShiftLeft') || k('ShiftRight') ? 1 : 0) + touchLift;
      const events = [];
      heli.update(dt, { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, side)), lift: Math.max(-1, Math.min(1, lift)) }, events);
      for (const ev of events) {
        if (ev.type === 'under_bridge') { H.toast(`<b>Under the ${ev.name || 'bridge'}!</b> ${G.under_bridge_note || ''}`); A.chime(); const s = step(); if (s && s.type === 'under_bridge') completeStep(); }
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
    // move, sliding along walls
    const sx = Math.sin(player.h) * player.speed * dt, sy = Math.cos(player.h) * player.speed * dt;
    let moved = false;
    for (const [mx, my] of [[sx, sy], [sx, 0], [0, sy]]) {
      if (!mx && !my) continue;
      const w = nav.walk(player.x + mx, player.y + my, player.z);
      if (w.ok) {
        player.x += mx; player.y += my; moved = true;
        if (player.ground && w.z < player.z - 0.6) player.ground = false; // stepped off an edge: fall
        player.floorZ = w.z; player.floor = w.kind;
        break;
      } else if (w.why === 'water' && clockT - waterT > 20) { waterT = clockT; H.toast(`No swimming in the ${G.water_name || 'water'}.${G.wharves.length ? ' Ferries leave from the wharves marked F.' : ''}`); }
    }
    if (!moved) player.speed *= 0.5;
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

  function updateCamera(dt, titleOn) {
    const k2 = Math.min(1, dt * 6);
    if (titleOn) { // slow orbit around the start for the title screen
      camTarget.copy(W(player.x + 120, player.y + 160, player.z + 20));
      camPos.copy(camTarget).add(new THREE.Vector3(Math.sin(cam.yaw) * -420, 210, Math.cos(cam.yaw) * 420));
      camera.position.copy(camPos); camera.lookAt(camTarget);
      Wd.fitShadow(camTarget, 600);
      return;
    }
    if (player.mode === 'heli' && cam.mode === 'bird') {
      const st = heli.st, g = nav.groundBelow(st.x, st.y, st.z);
      camera.position.lerp(W(st.x, st.y, Math.max(st.z, g) + cam.birdAlt), k2);
      camera.up.set(Math.sin(st.h), 0, -Math.cos(st.h));
      camera.lookAt(W(st.x, st.y, st.z));
      Wd.fitShadow(W(st.x, st.y, st.z), Math.min(2400, cam.birdAlt * 1.4));
      return;
    }
    camera.up.set(0, 1, 0);
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
    camera.position.copy(camPos);
    camLook.copy(camTarget);
    camera.lookAt(camLook);
    Wd.fitShadow(camTarget, player.mode === 'heli' ? 520 : player.mode === 'ferry' ? 320 : 170);
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
      if (sc >= 60 && !qs.stamps.some(s => s.id === 'ferry-master')) { qs.stamps.push({ id: 'ferry-master', stamp: 'Ferry master', title: 'Docked by hand', at: fmtMin(clock.min) }); renderPassport(); save(); }
    }
    if (ev.type === 'helm' && mine) v.helm.started = clockT;
  }

  function vehicleHud() {
    const el = $('#g-vhud');
    if (touch) { $('#gt-down').hidden = player.mode !== 'heli'; $('#gt-jump').textContent = player.mode === 'heli' ? 'Up' : 'Jump'; }
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
  window.__game = { advance, dlg, lastDock: () => lastDock, waypoint: w => { waypoint = w; }, player, heli, fer, npcs, crowd, cars, nav, clock, setClock, qs: () => qs, quest, step, completeStep, talkTo, board, alight, interact, enterHeli, exitHeli, spawn, objective, lens, camera, cam, DSM, graph, currentAction, keys };
  return {
    stop() { running = false; ac.abort(); ro.disconnect(); renderer.dispose(); Wd.dispose(); A.stop(); window.__game = null; },
  };
};
