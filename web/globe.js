// Open Earth 3D landing page: the Earth with today's day and night, and the
// cities that have a 3D model (live) or are next in line (planned).
// Globe frame: x = cos(lat) cos(lon), y = sin(lat), z = -cos(lat) sin(lon),
// which matches the UV layout of THREE.SphereGeometry for an equirectangular map.
'use strict';
window.OpenEarthGlobe = async function globe(cities, notice) {
  const $ = s => document.querySelector(s);
  const S = window.Sun, RAD = Math.PI / 180;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ll = (lat, lon, r = 1) => new THREE.Vector3(r * Math.cos(lat * RAD) * Math.cos(lon * RAD), r * Math.sin(lat * RAD), -r * Math.cos(lat * RAD) * Math.sin(lon * RAD));
  const pad = n => String(n).padStart(2, '0');
  const fmtLat = v => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`, fmtLon = v => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;
  if (notice) { $('#globe-notice').textContent = notice; $('#globe-notice').hidden = false; }

  // ------------------------------------------------------------ base map texture
  let world = null;
  try { world = await fetch('data/world.json').then(r => r.json()); } catch (e) { world = null; }
  const small = Math.min(innerWidth, innerHeight) < 700;
  const TW = small ? 2048 : 4096, TH = TW / 2;
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d');
  const px = (lon, lat) => [(lon + 180) / 360 * TW, (90 - lat) / 180 * TH];
  g.fillStyle = css('--g-ocean'); g.fillRect(0, 0, TW, TH);
  g.strokeStyle = css('--g-grid'); g.lineWidth = TW / 4096;
  for (let lon = -180; lon <= 180; lon += 15) { g.beginPath(); g.moveTo(...px(lon, 90)); g.lineTo(...px(lon, -90)); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { g.beginPath(); g.moveTo(...px(-180, lat)); g.lineTo(...px(180, lat)); g.stroke(); }
  const trace = (flat, q) => { for (let k = 0; k < flat.length; k += 2) { const [x, y] = px(flat[k] * q, flat[k + 1] * q); k ? g.lineTo(x, y) : g.moveTo(x, y); } };
  if (world) {
    const q = world.q;
    g.fillStyle = css('--g-land'); g.strokeStyle = css('--g-coast'); g.lineWidth = 1.4 * TW / 4096;
    for (const poly of world.land) { g.beginPath(); for (const r of poly) { trace(r, q); g.closePath(); } g.fill('evenodd'); g.stroke(); }
    g.fillStyle = css('--g-ocean');
    for (const poly of world.lakes) { g.beginPath(); for (const r of poly) { trace(r, q); g.closePath(); } g.fill('evenodd'); g.stroke(); }
    g.strokeStyle = css('--g-border'); g.lineWidth = 1.1 * TW / 4096;
    for (const line of world.borders) { g.beginPath(); trace(line, q); g.stroke(); }
  }

  // ------------------------------------------------------------ renderer and globe
  const canvas = $('#globe-gl'), stage = $('#globe-stage');
  let flight = null;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const controls = new THREE.OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 1.7, maxDistance: 7, rotateSpeed: 0.45,
    zoomSpeed: 0.6, autoRotate: !reduced, autoRotateSpeed: 0.35 });
  camera.position.copy(ll(-8, 128, 4.6));
  controls.update();
  let touched = false;
  // distance that fits the globe and its halo in the narrower field of view
  const fitDistance = () => {
    const v = camera.fov * RAD, h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    return Math.min(controls.maxDistance, 1.2 / Math.sin(Math.min(v, h) / 2));
  };

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const uni = { map: { value: tex }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, night: { value: new THREE.Color(css('--g-night')) },
    nightMix: { value: parseFloat(css('--g-night-mix')) || 0.62 } };
  const globeMat = new THREE.ShaderMaterial({
    uniforms: uni,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() { vUv = uv; vN = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform vec3 night; uniform float nightMix;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        float mu = dot(vN, sunDir);
        float day = smoothstep(-0.10, 0.06, mu);            // civil twilight is ~6 deg, sin(6 deg) = 0.10
        vec3 lit = c * (0.9 + 0.12 * clamp(mu, 0.0, 1.0));
        vec3 dark = mix(c, night, nightMix);
        vec3 col = mix(dark, lit, day);
        col = mix(col, vec3(1.0, 0.72, 0.42), 0.16 * (1.0 - abs(day * 2.0 - 1.0))); // warm terminator
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), globeMat);
  scene.add(earth);
  // thin atmosphere: a back-facing shell, brightest at the limb
  // (seen from inside the shell, the normal and the view ray agree near the globe and part at the shell's rim)
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.04, 96, 48), new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(css('--g-atmo')) } }, side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 glow; varying vec3 vN; varying vec3 vV; void main() { float f = smoothstep(0.0, 0.3, dot(vN, vV)); gl_FragColor = vec4(glow, f * f * 0.75); }',
  }));
  scene.add(atmo);

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (!touched && !flight) camera.position.setLength(fitDistance());
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // ------------------------------------------------------------ sun
  let sub = { lat: 0, lon: 0 };
  function updateSun() {
    const t = Date.now();
    sub = S.subsolar(t);
    uni.sunDir.value.copy(ll(sub.lat, sub.lon));
    const d = new Date(t);
    $('#globe-sun').textContent = `Sun overhead at ${fmtLat(sub.lat)}, ${fmtLon(sub.lon)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
    for (const c of live) {
      const loc = S.utcToLocal(t, c.timezone), p = S.position(t, c.lat, c.lon);
      const el = document.querySelector(`[data-clock="${c.id}"]`);
      if (el) el.textContent = `${pad(Math.floor(loc.minutes / 60))}:${pad(Math.floor(loc.minutes % 60))} ${loc.zone} · ${p.altitude > 0 ? `sun ${p.altitude.toFixed(0)}° up` : p.altitude > -6 ? 'twilight' : 'night'}`;
    }
  }

  // ------------------------------------------------------------ markers and city list
  const live = cities.filter(c => c.built), planned = cities.filter(c => !c.built);
  const markersEl = $('#markers'), markers = [];
  // live sites that share a `group` (the Queensland reef sites, a few hundred km apart) would sit on one dot:
  // they get one marker that opens a short list of the sites
  const groups = new Map();
  for (const c of live) if (c.group) groups.set(c.group, [...(groups.get(c.group) || []), c]);
  const grouped = new Set([...groups.values()].filter(g => g.length > 1).flat());
  const pop = document.createElement('div');
  pop.className = 'marker-pop'; pop.hidden = true; pop.setAttribute('role', 'menu');
  let popAt = null;
  const closePop = () => { pop.hidden = true; popAt = null; };
  for (const c of [...planned, ...live.filter(c => !grouped.has(c))]) {
    const b = document.createElement('button');
    b.className = `marker ${c.built ? 'live' : 'planned'}`;
    b.setAttribute('aria-label', c.built ? `Open ${c.name} in 3D` : `${c.name}: planned`);
    b.innerHTML = `<i></i><span>${c.name}</span>`;
    b.dataset.id = c.id;
    b.onclick = () => (c.built ? open(c) : focus(c));
    markersEl.appendChild(b);
    markers.push({ el: b, c, p: ll(c.lat, c.lon, 1.002) });
  }
  for (const [name, cs] of groups) {
    if (cs.length < 2) continue;
    const lat = cs.reduce((a, c) => a + c.lat, 0) / cs.length, lon = cs.reduce((a, c) => a + c.lon, 0) / cs.length;
    const b = document.createElement('button');
    b.className = 'marker live group';
    b.setAttribute('aria-label', `${name}: ${cs.length} sites`); b.setAttribute('aria-haspopup', 'menu');
    b.innerHTML = `<i></i><span>${name} <small>${cs.length}</small></span>`;
    b.dataset.ids = cs.map(c => c.id).join(' ');
    const m = { el: b, c: { id: name, name, lat, lon, built: true }, p: ll(lat, lon, 1.002), members: cs };
    b.onclick = e => {
      e.stopPropagation();
      if (popAt === m) return closePop();
      pop.innerHTML = `<b>${name}</b>` + cs.map(c => `<button data-id="${c.id}" role="menuitem"><span>${c.name}</span><small>${c.tagline || ''}</small></button>`).join('');
      pop.hidden = false; popAt = m;
    };
    markersEl.appendChild(b);
    markers.push(m);
  }
  markersEl.appendChild(pop);
  pop.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { closePop(); open(cities.find(c => c.id === b.dataset.id)); } });
  addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  canvas.addEventListener('pointerdown', closePop);
  const sunEl = document.createElement('div');
  sunEl.className = 'subsolar';
  sunEl.setAttribute('aria-hidden', 'true');
  markersEl.appendChild(sunEl);

  $('#live-list').innerHTML = live.map(c => `<li class="city-card" data-id="${c.id}">
      <span class="city-head"><b>${c.name}</b><span class="note">${c.country}</span></span>
      <span class="city-sum">${c.summary || ''}</span>
      <span class="city-foot"><span class="mono note" data-clock="${c.id}"></span>
        <span class="city-go"><button class="btn" data-go="model" data-id="${c.id}">Open in 3D</button>${c.game ? `<button class="btn primary" data-go="play" data-id="${c.id}">Play</button>` : ''}</span></span></li>`).join('');
  $('#planned-list').innerHTML = planned.map(c => `<li><button class="plan-row" data-id="${c.id}"><b>${c.name}</b><span class="note">${c.country}</span>
      <span class="plan-data">${c.data || ''}</span></button></li>`).join('');
  $('#live-count').textContent = String(live.length);
  $('#planned-count').textContent = String(planned.length);
  const byId = id => cities.find(c => c.id === id);
  $('#live-list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) open(byId(b.dataset.id), b.dataset.go === 'play'); });
  $('#planned-list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) focus(byId(b.dataset.id)); });
  for (const list of ['#live-list', '#planned-list']) {
    $(list).addEventListener('pointerover', e => { const b = e.target.closest('button'); hilite(b ? b.dataset.id : null); });
    $(list).addEventListener('pointerleave', () => hilite(null));
  }
  function hilite(id) { for (const m of markers) m.el.classList.toggle('hot', m.c.id === id || !!(m.members && m.members.some(c => c.id === id))); }

  // ------------------------------------------------------------ flights
  let running = true;
  function flyTo(c, dist, done) {
    controls.autoRotate = false;
    const from = camera.position.clone(), r0 = from.length(), r1 = dist || Math.min(r0, 3.2);
    const to = ll(c.lat, c.lon).normalize();
    flight = { from: from.clone().normalize(), to, r0, r1, t0: performance.now(), dur: reduced ? 1 : 1400, done };
  }
  function stepFlight(t) {
    if (!flight) return;
    const k = Math.min(1, (t - flight.t0) / flight.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const dir = flight.from.clone().lerp(flight.to, e).normalize();
    if (dir.lengthSq() < 1e-6) dir.copy(flight.to);
    camera.position.copy(dir.multiplyScalar(flight.r0 + (flight.r1 - flight.r0) * e));
    if (k >= 1) { const d = flight.done; flight = null; if (d) d(); }
  }
  function focus(c) {
    flyTo(c, 3.0);
    $('#globe-notice').textContent = `${c.name} is planned. Open data to start from: ${c.data || 'to be surveyed'}`;
    $('#globe-notice').hidden = false;
  }
  // a city with its own viewer (the marine worlds) opens that page instead of the in-page model
  function open(c, play) { flyTo(c, 1.9, () => { if (c.viewer) location.href = `${c.viewer}?city=${c.id}`; else location.hash = play ? `play-${c.id}` : c.id; }); }
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; flight = null; touched = true; });
  canvas.addEventListener('wheel', () => { controls.autoRotate = false; touched = true; }, { passive: true });

  // ------------------------------------------------------------ labels on the near side only
  const v = new THREE.Vector3(), toCam = new THREE.Vector3();
  function placeMarkers() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const put = (el, p) => {
      toCam.copy(camera.position).sub(p);
      const facing = p.clone().normalize().dot(toCam.normalize());
      v.copy(p).project(camera);
      const vis = facing > 0.08 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.hidden = !vis;
      if (vis) {
        el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
        el.style.opacity = String(Math.min(1, (facing - 0.08) / 0.2));
      }
    };
    for (const m of markers) put(m.el, m.p);
    put(sunEl, ll(sub.lat, sub.lon, 1.002));
    if (popAt) {
      if (popAt.el.hidden) closePop();
      else {
        const r = popAt.el.getBoundingClientRect(), sr = stage.getBoundingClientRect(), up = r.top - sr.top > h - pop.offsetHeight - 40;
        pop.style.transform = popAt.el.style.transform + (up ? ' translateY(-100%)' : '');
        pop.classList.toggle('left', r.left - sr.left > w - 320); pop.classList.toggle('up', up);
      }
    }
    // a label that would overlap one already placed (live cities first) is hidden; its dot stays
    const placed = [];
    for (const m of [...markers].reverse()) {
      const span = m.el.lastChild;
      if (m.el.hidden) continue;
      const r = m.el.getBoundingClientRect(), wl = span.offsetWidth;
      const box = [r.left, r.top, r.left + 20 + wl, r.bottom];
      const clash = placed.some(q => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]);
      span.style.visibility = clash ? 'hidden' : '';
      placed.push(clash ? [r.left, r.top, r.left + 14, r.bottom] : box);
    }
  }

  updateSun();
  const sunTimer = setInterval(updateSun, 20000);
  function frame(t) {
    if (!running) return;
    stepFlight(t);
    controls.update();
    renderer.render(scene, camera);
    placeMarkers();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $('#globe-loader').hidden = true;

  // the router calls stop() before it starts a city, so the two views never render at once
  return {
    stop() { running = false; clearInterval(sunTimer); ro.disconnect(); controls.dispose(); renderer.dispose(); tex.dispose(); },
    camera, controls, markers,
  };
};
