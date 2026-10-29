// Open Earth 3D city viewer: three.js view of the scene pipeline/build_scene.py
// wrote to web/data/<city>/. Everything city-specific (tour, labels, rules for
// protected places, time zone) comes from the scene's "city" block, which is a
// copy of cities/<city>/city.json.
// Local frame from the data: x east, y north, z up (metres above the city's
// vertical datum). three.js is y-up, so a local point (x, y, z) is drawn at (x, z, -y).
'use strict';
window.OpenEarthCity = async function main(cityId) {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const S = window.Sun, RAD = Math.PI / 180;
  const DATA = `data/${cityId}/`;
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const pad = n => String(n).padStart(2, '0');
  const fmtMin = m => { const t = Math.round(m); return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idle = () => new Promise(r => setTimeout(r, 0));

  // ------------------------------------------------------------ load
  const loadMsg = (t, f) => { $('#load-msg').textContent = t; $('#load-bar').style.width = `${Math.round(f * 100)}%`; };
  $('#stage').classList.add('intro'); // the HUD stays out of the establishing shot
  let D;
  try {
    D = await OEWorld.load(cityId, { onMsg: loadMsg });
  } catch (e) {
    loadMsg(`Could not load the model data (${e.message}). Reload the page to try again.`, 0);
    return;
  }
  const { scene, B, P, LM, UNC, T, CITY, ground } = D;
  setupPage();
  loadMsg('Setting up the renderer', 0.25);
  await idle();

  // page text from the city config: titles, hemisphere-aware date chips, time zone, protection rules
  function setupPage() {
    document.title = `${CITY.name} · Open Earth 3D`;
    $('#city-name').textContent = CITY.name;
    $('#city-country').textContent = CITY.country || '';
    $('#city-desc').textContent = CITY.description || '';
    $('#stage').setAttribute('aria-label', `3D model of ${CITY.name}`);
    $('#time').setAttribute('aria-label', `Time of day, ${CITY.name} clock time`);
    const chips = CITY.lat < 0 ? [['6-21', 'Winter solstice'], ['9-22', 'Equinox'], ['12-21', 'Summer solstice']]
      : [['12-21', 'Winter solstice'], ['3-20', 'Equinox'], ['6-21', 'Summer solstice']];
    $('#date-chips').innerHTML = chips.map(([md, l]) => `<button data-md="${md}">${l}</button>`).join('') + '<button data-md="today">Today</button>';
    const y = CITY.year || new Date().getFullYear(), std = S.standardOffset(y);
    const z = [0, 6].map(mo => S.utcToLocal(Date.UTC(y, mo, 15, 12)));
    const dst = z.find(q => q.offset > std), stz = z.find(q => q.offset === std);
    $('#tz-note').textContent = dst ? `${CITY.name} clock time (${CITY.timezone}): ${stz.zone} standard time, ${dst.zone} during daylight saving, with the changeover dates from the time zone database.`
      : `${CITY.name} clock time (${CITY.timezone}, ${stz.zone}; no daylight saving).`;
    const PR = CITY.protection;
    if (PR) {
      $('#prot-title').textContent = PR.title;
      $('#prot-summary').textContent = `${PR.summary} The table shows the share of each place in direct sun now, and below it the average over this month's protected window (read as clock time) with its 90% range from the height uncertainty.`;
      $('#prot-source').textContent = PR.source_note || '';
      $('#prot-reading').textContent = PR.reading_note || '';
      if (PR.tip) $('#tw-msg').textContent = PR.tip;
    } else {
      $('#prot-title').textContent = 'Public places';
      $('#prot-summary').textContent = 'The share of each public place in direct sun now, ray-cast through the 2 m surface model.';
      $('#prot-source').hidden = $('#prot-reading').hidden = true;
    }
  }

  // ------------------------------------------------------------ renderer, camera
  const canvas = $('#gl'), stage = $('#stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const camera = new THREE.PerspectiveCamera(38, 1, 3, 70000);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 40;
  controls.maxDistance = 9000;
  controls.screenSpacePanning = false;

  let post = null, lens = null; // the title screen's lens over the model, once the world is built
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (post) { post.setPixelRatio(renderer.getPixelRatio()); post.setSize(w, h); lens.uniforms.uAspect.value = w / Math.max(1, h); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // ------------------------------------------------------------ the shared world (world.js)
  const Wd = await OEWorld.create(D, renderer, { onMsg: loadMsg });
  const { world, groundMeshes, buildings, bGeo, U, SRC } = Wd;
  const show = window.OELights ? OELights.create(world, D, Wd) : null; // the city's nightly light show, if it has one
  // the title screen's lens (lens.js): the model in the same tone curve, grade, grain and vignette
  // as the Earth on the title, the game and the city's film; plain tone mapping without WebGL 2
  if (window.OELens && THREE.EffectComposer && renderer.capabilities.isWebGL2) {
    post = new THREE.EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
    post.addPass(new THREE.RenderPass(world, camera));
    post.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.12, 0.4, 6.0));
    lens = new THREE.ShaderPass(OELens.shader());
    Object.assign(lens.uniforms, { uGrain: { value: 0.025 }, uCA: { value: 0.12 }, uVignette: { value: 0.16 } });
    post.addPass(lens);
    resize();
  }

  // ------------------------------------------------------------ places
  const placeInfo = P.places.map(pl => {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, cx = 0, cy = 0, n = 0;
    for (const poly of pl.polygons) for (let k = 0; k < poly[0].length; k += 2) {
      const x = poly[0][k] / 10, y = poly[0][k + 1] / 10;
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      cx += x; cy += y; n++;
    }
    return Object.assign({}, pl, { c: [cx / n, cy / n], bbox: [xmin, ymin, xmax, ymax], tested: !!pl.period });
  });
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, depthTest: true });
  for (const pl of placeInfo) {
    if (!pl.lep) continue;
    for (const poly of pl.polygons) {
      const r = poly[0].map(v => v / 10), pts = [];
      for (let k = 0; k < r.length; k += 2) {
        const ax = r[k], ay = r[k + 1], bx = r[(k + 2) % r.length], by = r[(k + 3) % r.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
        for (let s = 0; s < steps; s++) { const x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps; pts.push(W(x, y, ground(x, y) + 1.2)); }
      }
      pts.push(pts[0].clone());
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outlineMat));
    }
  }

  // ------------------------------------------------------------ labels
  // landmark and place labels are buttons: click one to fly round it
  const labelsEl = $('#labels'), labels = [];
  const addLabel = (text, x, y, z, cls = '', pick = null) => {
    const el = document.createElement(pick ? 'button' : 'div');
    el.className = `lbl ${cls}${pick ? ' pick' : ''}`;
    el.textContent = text;
    if (pick) { el.type = 'button'; el.title = `Fly round ${text}`; el.addEventListener('click', pick); }
    labelsEl.appendChild(el);
    labels.push({ el, p: W(x, y, z) });
  };
  const minor = new Set(CITY.minor_labels || []), placeLabels = new Set(CITY.place_labels || []);
  for (const [name, p] of Object.entries(scene.labels || {})) {
    if (minor.has(name)) addLabel(name, p[0], p[1], p[2] + 4, 'place', () => orbitLandmark(name, p));
    else addLabel(name, p[0], p[1], p[2] + 6, '', () => orbitLandmark(name, p));
  }
  for (const pl of placeInfo) if (placeLabels.has(pl.name)) addLabel(pl.name, pl.c[0], pl.c[1], ground(pl.c[0], pl.c[1]) + 3, 'place', () => orbitPlace(pl));
  const tmpV = new THREE.Vector3();
  // labels in priority order (landmarks first); one that would overlap a placed label is hidden
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, placed = [];
    for (const l of labels) {
      tmpV.copy(l.p).project(camera);
      const d = camera.position.distanceTo(l.p);
      let vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05 && d < 5200;
      const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
      if (vis) {
        if (!l.w) { l.el.hidden = false; l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        const r = [x - l.w / 2 - 4, y - l.h - 2, x + l.w / 2 + 4, y + 2];
        vis = !placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        if (vis) placed.push(r);
      }
      l.el.hidden = !vis;
      if (vis) {
        l.el.style.left = `${x}px`;
        l.el.style.top = `${y}px`;
        l.el.style.opacity = String(Math.min(1, (5200 - d) / 1500));
      }
    }
  }

  // ------------------------------------------------------------ sun and time
  const today = S.utcToLocal(Date.now());
  const now = new Date();
  const state = { y: CITY.year || now.getFullYear(), m: 6, d: 21, min: 720, playing: false, speed: 90 };
  let sunDir = new THREE.Vector3(0, 1, 0), sunPos = null;
  function setDate(y, m, d) {
    Object.assign(state, { y, m, d });
    $('#date').value = `${y}-${pad(m)}-${pad(d)}`;
    $$('#date-chips button').forEach(b => {
      const md = b.dataset.md === 'today' ? `${today.m}-${today.d}` : b.dataset.md;
      b.setAttribute('aria-pressed', String(md === `${m}-${d}` && (b.dataset.md !== 'today' || y === today.y)));
    });
    const L = S.dayLimits(y, m, d);
    state.limits = L;
    const lo = +$('#time').min, hi = +$('#time').max;
    $('#daylight').style.left = `${(L.sunrise - lo) / (hi - lo) * 100}%`;
    $('#daylight').style.width = `${(L.sunset - L.sunrise) / (hi - lo) * 100}%`;
    $('#sun-stats').innerHTML = [
      [fmtMin(L.sunrise), 'Sunrise'], [`${L.noonAltitude.toFixed(1)}°`, `Noon sun, ${fmtMin(L.noon)}`], [fmtMin(L.sunset), 'Sunset']
    ].map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    applySun();
    refreshPlaces(true);
  }
  function setTime(min) {
    state.min = min;
    $('#time').value = String(Math.round(min));
    applySun();
  }
  function applySun() {
    const utc = S.localToUtc(state.y, state.m, state.d, state.min);
    const sp = S.position(utc);
    sunPos = sp;
    Wd.setSun(sp, state.min);
    Wd.setSeason(state.m, state.d);
    if (show) show.setClock(state.min);
    sunDir = Wd.sunDir;
    const loc = S.utcToLocal(utc);
    $('#clock').textContent = `${fmtMin(state.min)} ${loc.zone}`;
    $('#sun-read').textContent = `${state.d} ${MONTHS[state.m - 1]} · sun ${sp.altitude.toFixed(1)}° at ${Math.round(sp.azimuth)}°`;
    placesDirty = true;
  }

  function fitShadow() {
    const tgt = controls.target, dist = camera.position.distanceTo(tgt);
    const half = THREE.MathUtils.clamp(dist * 0.75, 260, 2400);
    Wd.fitShadow(tgt, half);
  }

  // ------------------------------------------------------------ surface model for analysis
  loadMsg('Rasterising the 2 m surface model for shadow analysis', 0.8);
  await idle();
  const FRAME = { cell: 2, x0: scene.frame.x[0], x1: scene.frame.x[1], y0: scene.frame.y[0], y1: scene.frame.y[1] };
  const DSM = S.buildDSM(T, B.s, Object.assign({ ids: true }, FRAME));
  const samples = new Map(placeInfo.map(pl => [pl.name, S.samplePlace(DSM, pl.polygons, pl.area_m2 > 60000 ? 5 : 3)]));

  // ------------------------------------------------------------ sun access table
  const fmtPeriod = p => {
    if (!p.period) return '<span class="note">window not verified</span>';
    const day = s => { const [m, d] = s.trim().split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
    const per = p.period === 'all' ? 'All year' : p.period.split(',').map(part => part.split('..').map(day).join(' – ')).join(', ');
    return `${per}<br><span class="note mono">${p.from}–${p.to}</span>`;
  };
  const tbody = $('#places tbody');
  const PROT = CITY.protection || {};
  tbody.innerHTML = placeInfo.map((p, i) => `<tr class="place-row" data-i="${i}" tabindex="0"><td><b>${p.name}</b>${p.lep ? '' : `<br><span class="note">${PROT.unprotected_label || 'not protected'}</span>`}</td>
    <td>${fmtPeriod(p)}</td><td class="r"><span class="num" data-pct>–</span><div class="meter"><i data-bar style="width:0"></i></div>
    <span class="note mono" data-band></span></td></tr>`).join('');
  const bName = b => B.b[b][0] || `unnamed ${(B.b[b][1] || 'building').replace(/_/g, ' ')}`;
  let placesDirty = true, lastPlaces = 0;
  function refreshPlaces(force) {
    if (!force && (!placesDirty || performance.now() - lastPlaces < 350)) return;
    placesDirty = false;
    lastPlaces = performance.now();
    const rows = tbody.querySelectorAll('tr');
    placeInfo.forEach((p, i) => {
      const f = sunPos.altitude > 0 ? S.fractionSunlit(DSM, samples.get(p.name), sunPos) : 0;
      p.now = f;
      rows[i].querySelector('[data-pct]').textContent = `${Math.round(f * 100)}%`;
      rows[i].querySelector('[data-bar]').style.width = `${f * 100}%`;
      // precomputed window mean on the 21st of this month, with its 90% range from height uncertainty
      const u = UNC && UNC.places[p.name], j = u ? u.months.indexOf(state.m) : -1;
      rows[i].querySelector('[data-band]').textContent = j >= 0 ? `window ${Math.round(u.base[j])}% (${Math.round(u.p05[j])}–${Math.round(u.p95[j])})` : '';
    });
    if (focusPlace) { paintSamples(focusPlace); shadeNow(focusPlace); }
  }

  // which buildings shade the focused place at this moment (ray caster names the first blocker)
  function shadeNow(name) {
    const smp = samples.get(name), n = smp.pts.length / 3, by = new Map();
    let shaded = 0;
    if (sunPos.altitude > 0) for (let i = 0; i < n; i++) {
      const b = S.blocker(DSM, smp.pts[3 * i], smp.pts[3 * i + 1], smp.pts[3 * i + 2] + 0.5, sunPos);
      if (b === -1) continue;
      shaded++;
      if (b >= 0) by.set(b, (by.get(b) || 0) + 1);
    }
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const u = UNC && UNC.places[name];
    const year = u && u.top.length ? ` Over the year: ${u.top.map(t => `${t.name} (${t.share_pct}%)`).join(', ')}.` : '';
    $('#shade-now').textContent = sunPos.altitude <= 0 ? `${name}: the sun is down.` : !shaded ? `${name} is fully in sun now.${year}` :
      `${name}, shade now from: ${top.map(([b, c]) => `${bName(b)}, ${Math.round(B.b[b][2])} m (${Math.round(100 * c / shaded)}%)`).join('; ')}.${year}`;
  }

  // sample points of the focused place, gold where lit and indigo where shaded
  let focusPlace = null, samplePoints = null;
  const ptsMat = new THREE.PointsMaterial({ size: 2.6, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false });
  function paintSamples(name) {
    const smp = samples.get(name), n = smp.pts.length / 3;
    if (!samplePoints || samplePoints.userData.name !== name) {
      if (samplePoints) { world.remove(samplePoints); samplePoints.geometry.dispose(); }
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[3 * i] = smp.pts[3 * i]; pos[3 * i + 1] = smp.pts[3 * i + 2] + 1.0; pos[3 * i + 2] = -smp.pts[3 * i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      samplePoints = new THREE.Points(g, ptsMat);
      samplePoints.userData.name = name;
      world.add(samplePoints);
    }
    const lit = S.litMask(DSM, smp, sunPos), c = samplePoints.geometry.attributes.color;
    const a = lin('#ffd25e'), b = lin('#3c3a8f');
    for (let i = 0; i < n; i++) { const k = lit[i] ? a : b; c.setXYZ(i, k.r, k.g, k.b); }
    c.needsUpdate = true;
  }
  function clearSamples() {
    focusPlace = null;
    if (samplePoints) { world.remove(samplePoints); samplePoints.geometry.dispose(); samplePoints = null; }
  }

  // ------------------------------------------------------------ camera flights
  // cam and tgt are local [x, y, z] or three.js vectors; done runs when the camera arrives
  let flight = null;
  function flyTo(cam, tgt, dur = 3.2, done = null) {
    const V = a => (Array.isArray(a) ? W(...a) : a.clone());
    const to = { p: V(cam), t: V(tgt) };
    if (reduced || dur === 0) { camera.position.copy(to.p); controls.target.copy(to.t); controls.update(); flight = null; if (done) done(); return; }
    flight = { from: { p: camera.position.clone(), t: controls.target.clone() }, to, t0: performance.now(), dur: dur * 1000, done };
  }
  function stepFlight(t) {
    if (!flight) return;
    const k = Math.min(1, (t - flight.t0) / flight.dur), e = ease(k);
    camera.position.lerpVectors(flight.from.p, flight.to.p, e);
    // lift the path a little so long flights do not graze the towers
    camera.position.y += Math.sin(Math.PI * e) * Math.min(400, flight.from.p.distanceTo(flight.to.p) * 0.15);
    controls.target.lerpVectors(flight.from.t, flight.to.t, e);
    if (k >= 1) { const d = flight.done; flight = null; if (d) d(); }
  }
  const placeView = p => {
    const g = ground(p.c[0], p.c[1]), span = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
    const d = THREE.MathUtils.clamp(span * 1.6, 260, 1100);
    return { cam: [p.c[0] - d * 0.35, p.c[1] - d * 0.75, g + d * 0.85], tgt: [p.c[0], p.c[1], g] };
  };

  // ------------------------------------------------------------ tour
  // stops come from city.json; text may hold tokens filled from the model:
  //   {buildings}  {sun:Place|M-D|HH:MM}  {landmark:key.field}  {acc:field}  {share:source} (% of footprint area)
  //   {lidar:field} (the surveyed heights against the LiDAR, or a path in scene.lidar_check)
  const byName = n => placeInfo.find(p => p.name === n);
  let shareOf = null;
  const share = src => {
    if (!shareOf) {
      shareOf = {};
      let tot = 0;
      for (const s of B.s) {
        const r = s[4];
        let q = 0;
        for (let k = 0, n = r.length / 2; k < n; k++) { const j = (k + 1) % n; q += r[2 * k] * r[2 * j + 1] - r[2 * j] * r[2 * k + 1]; }
        q = Math.abs(q);
        shareOf[B.b[s[0]][4]] = (shareOf[B.b[s[0]][4]] || 0) + q;
        tot += q;
      }
      for (const k in shareOf) shareOf[k] = Math.round(1000 * shareOf[k] / tot) / 10;
    }
    return String(shareOf[src] || 0);
  };
  const pctAt = (p, m, d, min) => Math.round(100 * S.fractionSunlit(DSM, samples.get(p.name), S.position(S.localToUtc(state.y, m, d, min))));
  const acc = scene.accuracy && scene.accuracy.summary;
  const lidarStat = (sc, arg) => { const v = (arg.includes('.') ? arg : `survey.${arg}`).split('.').reduce((o, k) => (o == null ? o : o[k]), sc.lidar_check); return v == null ? '–' : String(v); };
  const fill = text => (text || '').replace(/\{([a-z]+)(?::([^}]+))?\}/g, (all, kind, arg) => {
    if (kind === 'buildings') return B.b.length.toLocaleString();
    if (kind === 'sun') {
      const [name, md, hhmm] = arg.split('|'), p = byName(name), [m, d] = md.split('-').map(Number);
      return p ? String(pctAt(p, m, d, S.hm(hhmm))) : '–';
    }
    if (kind === 'landmark') {
      const v = arg.split('.').reduce((o, k) => (o == null ? o : o[k]), scene.landmarks);
      return typeof v === 'number' ? v.toFixed(1) : String(v ?? '–');
    }
    if (kind === 'acc') return acc && acc[arg] != null ? String(acc[arg]) : '–';
    if (kind === 'lidar') return lidarStat(scene, arg);
    if (kind === 'share') return share(arg);
    return all;
  });
  const TOUR = (CITY.tour || []).filter(s => !s.place || byName(s.place)).map(s => Object.assign({}, s,
    { from: S.hm(s.from), to: S.hm(s.to || s.from), text: () => fill(s.text) }));
  if (!TOUR.length) TOUR.push({ title: `${CITY.name} from open data`, text: () => fill('{buildings} buildings from OpenStreetMap via Overture Maps.'),
    cam: CITY.start.cam, tgt: CITY.start.tgt, date: CITY.start.date, from: S.hm(CITY.start.time), to: S.hm(CITY.start.time) + 60, hold: 10 });
  $('#tour-intro').textContent = `${TOUR.length === 1 ? 'One stop' : `${TOUR.length} stops`} through the model. Drag the view at any time to take over; the tour waits for you.`;
  if (!placeInfo.length) $('[data-tab="access"]').hidden = true;
  if (!placeInfo.some(p => p.tested)) $('#tower-group').hidden = true;
  $('#tour-list').innerHTML = TOUR.map((s, i) => `<li><button data-i="${i}"><span class="n">${pad(i + 1)}</span><span><b>${s.title}</b><span>${s.date[1]} ${MONTHS[s.date[0] - 1]}, ${fmtMin(s.from)}</span></span></button></li>`).join('');
  const tour = { i: -1, playing: true, phase: 'idle', t0: 0 };
  const stopView = s => (s.place ? placeView(byName(s.place)) : s);
  // here: the camera is already at the stop (the establishing shot ends there), so no flight
  function startStop(i, here = false) {
    tour.i = (i + TOUR.length) % TOUR.length;
    const s = TOUR[tour.i];
    if (state.m !== s.date[0] || state.d !== s.date[1]) setDate(state.y, s.date[0], s.date[1]);
    setTime(s.from);
    setProvenance(!!s.provenance);
    clearSamples();
    setOrbit(false);
    const view = stopView(s);
    if (s.place) focusPlace = s.place;
    if (!here) flyTo(view.cam, view.tgt);
    $('#cap-step').textContent = `${tour.i + 1} / ${TOUR.length}`;
    $('#cap-title').textContent = s.title;
    $('#cap-text').textContent = typeof s.text === 'function' ? s.text() : s.text;
    $$('#tour-list button').forEach(b => b.setAttribute('aria-current', String(+b.dataset.i === tour.i)));
    tour.t0 = performance.now() - (here && !reduced ? 3200 : 0);
    if (focusPlace) refreshPlaces(true);
  }
  function stepTour(t) {
    if (tour.i < 0 || !tour.playing) return;
    const s = TOUR[tour.i];
    const fly = reduced ? 0 : 3200, el = t - tour.t0 - fly;
    const k = Math.max(0, Math.min(1, el / (s.hold * 1000)));
    $('#cap-bar').style.width = `${k * 100}%`;
    if (el > 0 && s.to !== s.from) setTime(s.from + (s.to - s.from) * k);
    if (k >= 1) startStop(tour.i + 1);
  }
  function setTourPlaying(on) {
    tour.playing = on;
    if (on) setOrbit(false);
    $('#btn-tour').setAttribute('aria-pressed', String(on));
    $('#tour-play').textContent = on ? 'Pause tour' : 'Resume tour';
    $('#caption').hidden = !on;
    $('#btn-tour').textContent = on ? 'Tour' : 'Resume tour';
    $('#cap-skip').textContent = on ? 'Next' : 'Resume';
    if (on) tour.t0 = performance.now() - (reduced ? 0 : 3200) - parseFloat($('#cap-bar').style.width || 0) / 100 * TOUR[Math.max(0, tour.i)].hold * 1000;
  }
  $('#tour-list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setTourPlaying(true); startStop(+b.dataset.i); } });
  $('#tour-play').onclick = () => { if (tour.i < 0) { setTourPlaying(true); startStop(0); } else setTourPlaying(!tour.playing); };
  $('#tour-restart').onclick = () => { setTourPlaying(true); startStop(0); };
  $('#btn-tour').onclick = () => { if (tour.i < 0) { setTourPlaying(true); startStop(0); } else setTourPlaying(!tour.playing); };
  $('#cap-skip').onclick = () => { if (!tour.playing) setTourPlaying(true); else startStop(tour.i + 1); };
  canvas.addEventListener('pointerdown', () => { if (tour.playing) setTourPlaying(false); flight = null; setOrbit(false, 0, true); });
  canvas.addEventListener('wheel', () => { if (tour.playing) setTourPlaying(false); flight = null; }, { passive: true });

  // ------------------------------------------------------------ orbit: circle what you are looking at
  // Time-based (OrbitControls' autoRotate turns by a fixed angle per frame, so its speed
  // depends on the frame rate). It eases in and out; grabbing the view stops it at once.
  const orbit = { on: false, rate: 2 * Math.PI / 90, w: 0 };
  function setOrbit(on, rate = 0, grabbed = false) {
    orbit.on = on;
    if (rate) orbit.rate = rate;
    if (grabbed) orbit.w = 0;
    if (on && tour.playing) setTourPlaying(false);
    $('#btn-orbit').setAttribute('aria-pressed', String(on));
  }
  function stepOrbit(dt) {
    orbit.w += ((orbit.on ? orbit.rate : 0) - orbit.w) * Math.min(1, dt * 1.2);
    if (Math.abs(orbit.w) < 1e-4 || flight) return;
    const p = OECine.polar(controls.target, camera.position);
    OECine.around(controls.target, p.az + orbit.w * dt, p.dist, p.h, camera.position);
  }
  $('#btn-orbit').onclick = () => setOrbit(!orbit.on, 2 * Math.PI / 90);
  // fly to a three-quarter view of a point (three.js vector) and circle it; size (m) sets the distance
  function orbitAround(look, size) {
    setTourPlaying(false);
    setOrbit(false);
    const d = THREE.MathUtils.clamp(size * 2.9, 220, 2800), pitch = 22 * RAD;
    const az = OECine.polar(look, camera.position).az; // keep the bearing so the flight is short
    flyTo(OECine.around(look, az, d * Math.cos(pitch), d * Math.sin(pitch)), look, 2.6, () => setOrbit(true, 2 * Math.PI / 60));
  }
  // a building's footprint box and top, over all its solids (b: one id or a list)
  function buildingBox(b) {
    const set = new Set([].concat(b));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 0;
    for (const s of B.s) {
      if (!set.has(s[0])) continue;
      const r = s[4];
      for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k] / 10); x1 = Math.max(x1, r[k] / 10); y0 = Math.min(y0, r[k + 1] / 10); y1 = Math.max(y1, r[k + 1] / 10); }
      top = Math.max(top, (s[1] + s[3]) / 10);
    }
    if (!isFinite(x0)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { cx, cy, r: Math.hypot(x1 - x0, y1 - y0) / 2, top, g: ground(cx, cy) };
  }
  function orbitBuilding(bi) {
    const b = buildingBox(bi);
    if (b) orbitAround(W(b.cx, b.cy, b.g + (b.top - b.g) * 0.45), Math.max(b.top - b.g, b.r * 1.6, 50));
  }
  // a landmark label: frame every building named after it (both bridge pylons, say), and
  // open the inspector on the one under the label
  function orbitLandmark(name, p) {
    const named = B.b.map((m, i) => (m[0] && m[0].startsWith(name) ? i : -1)).filter(i => i >= 0 && Math.hypot(centroids[i][0] - p[0], centroids[i][1] - p[1]) < 600);
    const box = named.length ? buildingBox(named) : null, g = ground(p[0], p[1]);
    const top = Math.max(p[2], box ? box.top : 0), size = Math.max(top - g, box ? box.r * 1.6 : 0, 60);
    orbitAround(W(box ? box.cx : p[0], box ? box.cy : p[1], g + (top - g) * 0.45), size);
    const c = Math.floor((p[0] - DSM.x0) / DSM.cell), r = Math.floor((DSM.y1 - p[1]) / DSM.cell), under = DSM.ids[r * DSM.nx + c];
    const bi = B.b.findIndex(m => m[0] === name);
    const pick = bi >= 0 ? bi : under >= 0 && (B.b[under][0] || '').startsWith(name) ? under : -1;
    if (pick >= 0) inspect(pick); else closeInspector();
  }
  function orbitPlace(pl) {
    const i = placeInfo.indexOf(pl);
    if (pl.lep && i >= 0) { // a protected place: its row in Sun access shows the sun on it
      $('[data-tab="access"]').click();
      tbody.querySelectorAll('tr')[i].click();
      if (flight) flight.done = () => setOrbit(true, 2 * Math.PI / 60);
      return;
    }
    const span = Math.max(pl.bbox[2] - pl.bbox[0], pl.bbox[3] - pl.bbox[1]);
    orbitAround(W(pl.c[0], pl.c[1], ground(pl.c[0], pl.c[1])), span * 0.7);
  }

  // ------------------------------------------------------------ the establishing shot
  // From high over the city the camera spirals down onto the first tour stop, so the
  // whole model is seen once before the tour starts and the tour picks up where the
  // shot ends. It is long the first time and short after that; any click or key skips it.
  const cine = OECine.director({ reduced });
  const INTRO_KEY = `oe3d-intro-${cityId}`;
  const ac = new AbortController();
  function playIntro() {
    let seen = false;
    try { seen = !!localStorage.getItem(INTRO_KEY); localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* storage blocked */ }
    const s = TOUR[0], v = stopView(s);
    if (state.m !== s.date[0] || state.d !== s.date[1]) setDate(state.y, s.date[0], s.date[1]);
    setTime(s.from);
    const look = W(...v.tgt), end = OECine.polar(look, W(...v.cam));
    const f = scene.frame, ext = Math.max(f.x[1] - f.x[0], f.y[1] - f.y[0]);
    const h0 = Math.max(end.h * 2.5, ext * 1.15), sweep = (seen ? 70 : 150) * RAD, dur = seen ? 4.5 : 9.5;
    const shot = OECine.spiral({ center: look, az: [end.az - sweep, end.az], dist: [h0 * 0.12, end.dist], h: [h0, end.h], e: { h: 'out' } });
    const L = S.utcToLocal(S.localToUtc(state.y, state.m, state.d, state.min)), f2 = n => n.toLocaleString(CITY.locale || undefined);
    $('#intro-eyebrow').textContent = `Open Earth 3D · ${CITY.country || ''}`;
    $('#intro-name').textContent = CITY.name;
    $('#intro-facts').textContent = `${f2(B.b.length)} buildings · ${f2((P.trees || []).length / 4)} trees · ${((f.x[1] - f.x[0]) / 1000).toFixed(1)} × ${((f.y[1] - f.y[0]) / 1000).toFixed(1)} km · `
      + `${state.d} ${MONTHS[state.m - 1]}, ${fmtMin(state.min)} ${L.zone}, sun ${sunPos.altitude.toFixed(0)}° up`;
    $('#intro').hidden = false;
    stage.classList.add('intro');
    cine.play(shot, dur, { label: 'intro', onEnd() {
      $('#intro').hidden = true;
      stage.classList.remove('intro');
      startStop(0, true);
    } });
  }
  // anything the visitor does ends the shot first; a click on the view only skips it
  const skipIntro = e => {
    if (cine.label !== 'intro') return;
    cine.skip();
    if (e && e.type === 'pointerdown' && stage.contains(e.target)) e.stopPropagation();
  };
  document.addEventListener('pointerdown', skipIntro, { capture: true, signal: ac.signal });
  addEventListener('keydown', skipIntro, { capture: true, signal: ac.signal });
  stage.addEventListener('wheel', skipIntro, { capture: true, passive: true, signal: ac.signal });

  // ------------------------------------------------------------ provenance view
  function setProvenance(on) {
    U.uMode.value = on ? 1 : 0;
    $('#btn-prov').setAttribute('aria-pressed', String(on));
  }
  $('#btn-prov').onclick = () => setProvenance(U.uMode.value < 0.5);

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true; // with a BVH, stop at the nearest hit
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -(e.clientY - r.top) / r.height * 2 + 1 }, camera);
    if (tower.placing) {
      const hit = ray.intersectObjects(groundMeshes.concat([buildings]))[0];
      if (hit) placeTower(hit.point.x, -hit.point.z);
      return;
    }
    const hit = ray.intersectObject(buildings)[0];
    if (!hit) { closeInspector(); return; }
    inspect(bGeo.attributes.bid.getX(hit.face.a));
  });
  const SRC_LABEL = { mapped: 'Surveyed height (OpenStreetMap)', survey: 'Surveyed top level (the mapping agency\'s building record)',
    plateau: 'Measured height (Project PLATEAU, airborne survey)', plateau_lod1: 'Block height from Project PLATEAU (LOD1 model, no survey record)',
    lidar: 'Measured by airborne LiDAR', bdtopo: 'Surveyed eaves (IGN BD TOPO) plus the median measured roof',
    '3dbag': 'Measured by airborne LiDAR (AHN), modelled in the 3DBAG',
    reference: 'Published height (corrected)',
    verified: 'Verified from a cited source (it moves a sun-access result)', floors: 'Floor count × storey height',
    ml: 'Microsoft ML height, bias-corrected and blended with neighbours', estimate: 'Estimated from nearby known heights and footprint size',
    typical: 'Typical height for its kind (no height mapped)', parametric: 'Parametric landmark model' };
  function inspect(bi) {
    const m = B.b[bi];
    U.uSel.value = bi;
    $('#insp-name').textContent = m[0] || (m[1] ? `Unnamed ${m[1].replace(/_/g, ' ')}` : 'Unnamed building');
    const osm = m[6] && /^[wr]\d+$/.test(m[6]) ? `<a href="https://www.openstreetmap.org/${m[6][0] === 'w' ? 'way' : 'relation'}/${m[6].slice(1)}" target="_blank" rel="noopener">${m[6]}</a>` : '–';
    const rows = [['Height', `<span class="num">${m[2].toFixed(1)} m</span>`], ['Height from', SRC_LABEL[m[4]] || m[4]]];
    if (m[4] === 'reference') rows.push(['Open data said', `<span class="num">${m[9].toFixed(1)} m</span>`]);
    if (m[3]) rows.push(['Floors', `<span class="num">${m[3]}</span>`]);
    if (m[1]) rows.push(['Type', m[1].replace(/_/g, ' ')]);
    if (B.styles && typeof m[10] === 'number') {
      const how = ['ruled by size and type', "drawn from the region's mapped roofs", 'mapped in OpenStreetMap', m[4] === 'lidar' ? 'measured: LiDAR HD over the surveyed eaves' : m[4] === '3dbag' ? "measured from the 3DBAG's LOD2.2 model" : "measured from Project PLATEAU's LOD2 model"][m[16]] || '';
      rows.push(['Roof', `${(B.roof_shapes[m[15]] || 'flat').replace(/_/g, ' ')}, ${B.roof_materials[m[13]] || ''} <span class="note">(${how})</span>`],
        ['Facade', `${B.styles[m[10]]}, ${m[11]} m storeys`]);
    }
    rows.push(['Footprint', m[5] === 'O' ? 'OpenStreetMap' : m[5] === 'P' ? 'Project PLATEAU' : m[5] === 'B' ? 'IGN BD TOPO (cadastre)' : m[5] === 'D' ? 'BAG (cadastre), via the 3DBAG' : 'Microsoft ML'], ['OSM record', osm]);
    $('#insp-kv').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#inspector').hidden = false;
  }
  function closeInspector() { $('#inspector').hidden = true; U.uSel.value = -1; }
  $('#insp-close').onclick = closeInspector;
  $('#insp-orbit').onclick = () => { if (U.uSel.value >= 0) orbitBuilding(U.uSel.value); };

  // ------------------------------------------------------------ proposed tower
  const tower = { placing: false, x: 0, y: 0, mesh: null };
  const towerMat = new THREE.MeshStandardMaterial({ color: lin(css('--tower') || '#d4562a'), roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.88 });
  function towerSize() { return { h: +$('#tw-h').value, w: +$('#tw-w').value }; }
  function placeTower(x, y) {
    tower.placing = false;
    tower.x = x; tower.y = y;
    $('#tw-place').textContent = 'Move tower';
    $('#tw-check').disabled = false;
    $('#tw-remove').hidden = false;
    $('#tw-msg').textContent = `Tower at ${Math.round(x)} m E, ${Math.round(y)} m N of the model origin. Adjust it, then check.`;
    $('#tw-result').innerHTML = '';
    drawTower();
  }
  function drawTower() {
    if (!tower.mesh) { tower.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), towerMat); tower.mesh.castShadow = true; world.add(tower.mesh); }
    const { h, w } = towerSize(), g = ground(tower.x, tower.y);
    tower.mesh.scale.set(w, h, w);
    tower.mesh.position.set(tower.x, g + h / 2, -tower.y);
  }
  $('#tw-place').onclick = () => { tower.placing = true; setTourPlaying(false); $('#tw-msg').textContent = 'Click on the map to place the tower.'; };
  $('#tw-remove').onclick = () => {
    if (tower.mesh) { world.remove(tower.mesh); tower.mesh = null; }
    $('#tw-check').disabled = true; $('#tw-remove').hidden = true; $('#tw-place').textContent = 'Place a tower';
    $('#tw-result').innerHTML = ''; $('#tw-msg').textContent = 'Tower removed.';
  };
  for (const id of ['tw-h', 'tw-w']) $(`#${id}`).addEventListener('input', () => {
    const { h, w } = towerSize();
    $('#tw-h-v').textContent = `${h} m`; $('#tw-w-v').textContent = `${w} × ${w} m`;
    if (tower.mesh) drawTower();
    $('#tw-result').innerHTML = '';
  });
  // The clause: a place fails if its total shadow across the protected hours is greater after
  // the development. Sampled on the rule's dates (or the solstices and equinoxes) in each period, every 15 minutes;
  // total shadow is shaded area x time. The tower replaces the buildings whose footprint centre
  // is on its site, so a redevelopment can also remove shadow.
  const DATES = PROT.test_dates || [[3, 21], [6, 21], [9, 22], [12, 21]]; // a rule's own dates where it names them
  if (PROT.test_dates) $('#tw-dates').textContent = `the rule's own dates (${PROT.test_dates.map(([m, d]) => `${d} ${MONTHS[m - 1]}`).join(', ')})`;
  let basis = PROT.default_time_basis || 'clock';
  $$('#tw-basis button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.b === basis)));
  $('#tw-basis').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    basis = b.dataset.b;
    $$('#tw-basis button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#tw-result').innerHTML = '';
  });
  $('#tw-replace').addEventListener('change', () => { $('#tw-result').innerHTML = ''; });
  // standard time all year, so during daylight saving the clock reads later
  const windowSun = (m, d, t) => {
    let utc = S.localToUtc(state.y, m, d, t);
    if (basis === 'standard') utc += (S.offsetHours(utc) - S.standardOffset(state.y)) * 3600e3;
    return S.position(utc);
  };
  const centroids = (() => {
    const c = B.b.map(() => [0, 0, 0]);
    for (const s of B.s) {
      const r = s[4], n = r.length / 2;
      let a = 0, x = 0, y = 0;
      for (let k = 0; k < n; k++) { const j2 = (k + 1) % n, cr = r[2 * k] * r[2 * j2 + 1] - r[2 * j2] * r[2 * k + 1]; a += cr; x += (r[2 * k] + r[2 * j2]) * cr; y += (r[2 * k + 1] + r[2 * j2 + 1]) * cr; }
      if (Math.abs(a) > 1e-6) { c[s[0]][0] += x / (3 * a) / 10 * Math.abs(a); c[s[0]][1] += y / (3 * a) / 10 * Math.abs(a); c[s[0]][2] += Math.abs(a); }
    }
    return c.map(([x, y, a]) => (a ? [x / a, y / a] : [NaN, NaN]));
  })();
  function compare(Gb, Ga) {
    const out = [];
    for (const p of placeInfo.filter(q => q.tested)) {
      const smp = samples.get(p.name), cellArea = smp.spacing ** 2, dt = 0.25;
      let before = 0, after = 0, worst = { area: 0 }, n = 0;
      for (const [m, d] of DATES) {
        if (!S.inPeriod(p.period, m, d)) continue;
        for (let t = S.hm(p.from); t <= S.hm(p.to); t += 15) {
          const sun = windowSun(m, d, t);
          if (sun.altitude <= 0) continue;
          const lb = S.litMask(Gb, smp, sun), la = S.litMask(Ga, smp, sun);
          let sb = 0, sa = 0, added = 0;
          for (let i = 0; i < lb.length; i++) { sb += !lb[i]; sa += !la[i]; added += lb[i] && !la[i]; }
          before += sb * cellArea * dt; after += sa * cellArea * dt; n++;
          if (added * cellArea > worst.area) worst = { area: added * cellArea, m, d, t };
        }
      }
      out.push({ p, before, after, net: after - before, worst, n });
    }
    return out;
  }
  function towerModels(scale) {
    const { h, w } = towerSize(), g = ground(tower.x, tower.y);
    const ring = [tower.x - w / 2, tower.y - w / 2, tower.x + w / 2, tower.y - w / 2, tower.x + w / 2, tower.y + w / 2, tower.x - w / 2, tower.y + w / 2];
    const inSite = b => Math.abs(centroids[b][0] - tower.x) <= w / 2 && Math.abs(centroids[b][1] - tower.y) <= w / 2;
    const replaced = $('#tw-replace').checked ? new Set(B.b.map((_, b) => b).filter(inSite)) : new Set();
    const solids = scale ? B.s.map(s => { const c = s.slice(); c[3] = Math.max(s[2] + 10, Math.round(s[3] * scale[s[0]])); return c; }) : B.s;
    const Gb = scale ? S.buildDSM(T, solids, FRAME) : DSM;
    const Ga = S.addSolid(replaced.size ? S.buildDSM(T, solids.filter(s => !replaced.has(s[0])), FRAME) : S.cloneDSM(Gb), [ring], g + h);
    return { Gb, Ga, replaced };
  }
  // seeded lognormal height scenarios from the measured per-source errors
  function scenario(k) {
    let seed = 7919 * (k + 1);
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const sig = (UNC && UNC.sigma) || { floors: 0.07, estimate: 0.18, ml: 0.25 };
    return B.b.map(m => Math.exp((sig[m[4]] || 0.03) * g()));
  }
  const fmtArea = v => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString()}`;
  $('#tw-check').onclick = async () => {
    const btn = $('#tw-check');
    btn.disabled = true;
    const { h, w } = towerSize();
    $('#tw-msg').textContent = 'Comparing total shadow before and after…';
    await idle();
    const { Gb, Ga, replaced } = towerModels(null);
    const res = compare(Gb, Ga);
    const SCEN = 4, holds = res.map(() => 0);
    for (let k = 0; k < SCEN; k++) {
      $('#tw-msg').textContent = `Re-checking with plausible height errors, scenario ${k + 1} of ${SCEN}…`;
      await idle();
      const mm = towerModels(scenario(k));
      compare(mm.Gb, mm.Ga).forEach((r, i) => { if ((r.net > 0) === (res[i].net > 0)) holds[i]++; });
    }
    const instants = res.reduce((a, r) => a + r.n, 0);
    $('#tw-msg').textContent = `${w} × ${w} m tower, ${h} m tall${replaced.size ? `, replacing ${replaced.size} building${replaced.size > 1 ? 's' : ''}` : ''}; ${instants} instants, ${basis} time.`;
    $('#tw-result').innerHTML = `<table><thead><tr><th>Place</th><th class="r">Change in total shadow</th><th>Result</th></tr></thead><tbody>${res.map((r, i) => `<tr><td>${r.p.name}</td>
      <td class="r"><span class="num">${fmtArea(r.net)} m²·h</span><br><span class="note mono">${r.before ? `${(100 * r.net / r.before).toFixed(1)}% of ${Math.round(r.before).toLocaleString()}` : 'no shadow before'}</span>${r.worst.area ? `<br><span class="note mono">most added ${Math.round(r.worst.area).toLocaleString()} m², ${r.worst.d} ${MONTHS[r.worst.m - 1]} ${fmtMin(r.worst.t)}</span>` : ''}</td>
      <td>${r.p.lep ? (r.net > 0 ? '<span class="pill fail">More shadow</span>' : '<span class="pill pass">No more shadow</span>')
        : `<span class="pill na">${r.net > 0 ? 'More shadow' : 'No more shadow'}</span><br><span class="note">${PROT.unprotected_label || 'not protected'}: a judgement, not a test</span>`}<br><span class="note">same in ${holds[i]}/${SCEN} height scenarios</span></td></tr>`).join('')}</tbody></table>`;
    btn.disabled = false;
  };

  // ------------------------------------------------------------ sun hours map
  const hr = CITY.sun_hours_region || [scene.frame.x[0] + 300, scene.frame.x[1] - 300, scene.frame.y[0] + 300, scene.frame.y[1] - 300];
  const HEAT = { x0: hr[0], x1: hr[1], y0: hr[2], y1: hr[3], cell: 8 }; // 2 m when the GPU casts the rays
  const RAMP = ['#3a2504', '#6f4306', '#a8680b', '#d9952a', '#f3c467', '#fde8b0'];
  $('#heat-ramp').style.background = `linear-gradient(90deg, ${RAMP.join(', ')})`;
  let heatMesh = null;
  const rampAt = f => {
    const x = Math.max(0, Math.min(1, f)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), k = x - i;
    const a = new THREE.Color(RAMP[i]), b = new THREE.Color(RAMP[i + 1]);
    return a.lerp(b, k);
  };
  $('#heat-run').onclick = async () => {
    const btn = $('#heat-run');
    btn.disabled = true;
    // on the GPU (sun-gpu.js): every 2 m cell of the surface model, every 10 minutes;
    // on the CPU (sun.js): 8 m cells every 20 minutes
    const gpu = window.SunGPU && SunGPU.available(DSM);
    HEAT.cell = gpu ? DSM.cell : 8;
    const nx = Math.round((HEAT.x1 - HEAT.x0) / HEAT.cell), ny = Math.round((HEAT.y1 - HEAT.y0) / HEAT.cell);
    const L = state.limits, step = gpu ? 10 : 20, times = [];
    for (let t = Math.ceil(L.sunrise / step) * step; t < L.sunset; t += step) times.push(t);
    const suns = times.map(t => S.position(S.localToUtc(state.y, state.m, state.d, t))).filter(s => s.altitude > 0);
    const hours = new Float32Array(nx * ny), roofed = new Uint8Array(nx * ny);
    const t0 = performance.now();
    const pts = [], at = [];
    for (let r = 0; r < ny; r++) {
      const y = HEAT.y1 - (r + 0.5) * HEAT.cell;
      for (let c = 0; c < nx; c++) {
        const x = HEAT.x0 + (c + 0.5) * HEAT.cell, g = ground(x, y);
        const dc = Math.floor((x - DSM.x0) / DSM.cell), dr = Math.floor((DSM.y1 - y) / DSM.cell);
        if (DSM.data[dr * DSM.nx + dc] > g + 2.5) { roofed[r * nx + c] = 1; continue; }
        pts.push(x, y, g + 0.5); at.push(r * nx + c);
      }
    }
    if (gpu) {
      const lit = await SunGPU.count(DSM, new Float32Array(pts), suns, f => { $('#heat-msg').textContent = `Ray casting on the GPU… ${Math.round(f * 100)}%`; });
      for (let i = 0; i < at.length; i++) hours[at[i]] = lit[i] * step / 60;
    } else {
      for (let i = 0; i < at.length; i++) {
        let lit = 0;
        for (const s of suns) if (S.sunlit(DSM, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], s)) lit++;
        hours[at[i]] = lit * step / 60;
        if (i % 4000 === 0) { $('#heat-msg').textContent = `Ray casting… ${Math.round(i / at.length * 100)}%`; await idle(); }
      }
    }
    const maxH = (L.sunset - L.sunrise) / 60;
    const cv = document.createElement('canvas');
    cv.width = nx; cv.height = ny;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(nx, ny);
    for (let i = 0; i < nx * ny; i++) {
      if (roofed[i]) continue;
      const col = rampAt(hours[i] / maxH);
      img.data[4 * i] = col.r * 255; img.data[4 * i + 1] = col.g * 255; img.data[4 * i + 2] = col.b * 255; img.data[4 * i + 3] = 190;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    if (heatMesh) { world.remove(heatMesh); heatMesh.geometry.dispose(); }
    const w = HEAT.x1 - HEAT.x0, h = HEAT.y1 - HEAT.y0;
    const g = new THREE.PlaneGeometry(w, h, Math.round(w / 10), Math.round(h / 10));
    g.rotateX(-Math.PI / 2);
    g.translate((HEAT.x0 + HEAT.x1) / 2, 0, -(HEAT.y0 + HEAT.y1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), -p.getZ(i)) + 0.9);
    heatMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    heatMesh.renderOrder = 2;
    world.add(heatMesh);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `${(f * maxH).toFixed(1)} h`);
    $('#heat-ticks').innerHTML = ticks.map(t => `<span>${t}</span>`).join('');
    $('#heat-legend').hidden = false;
    $('#heat-clear').hidden = false;
    $('#heat-msg').textContent = `${state.d} ${MONTHS[state.m - 1]}: ${(nx * ny).toLocaleString()} points (${HEAT.cell} m) × ${suns.length} sun positions in ${((performance.now() - t0) / 1000).toFixed(1)} s${gpu ? ' on the GPU' : ''}.`;
    btn.disabled = false;
  };
  $('#heat-clear').onclick = () => {
    if (heatMesh) { world.remove(heatMesh); heatMesh.geometry.dispose(); heatMesh = null; }
    $('#heat-legend').hidden = true; $('#heat-clear').hidden = true; $('#heat-msg').textContent = '';
  };

  // ------------------------------------------------------------ data tab
  (function dataTab() {
    const area = {}, total = { v: 0 };
    for (const s of B.s) {
      const r = s[4];
      let a = 0;
      for (let k = 0, n = r.length / 2; k < n; k++) { const j = (k + 1) % n; a += r[2 * k] * r[2 * j + 1] - r[2 * j] * r[2 * k + 1]; }
      a = Math.abs(a) / 200;
      const code = SRC[B.b[s[0]][4]] ?? 2;
      area[code] = (area[code] || 0) + a; total.v += a;
    }
    const cats = [[0, 'Surveyed, published or verified height', 'var(--s1)'], [1, 'Floor count × storey height', 'var(--s2)'],
      [2, 'Estimated (neighbours, footprint, ML)', 'var(--s3)'], [3, 'Parametric landmark', 'var(--muted)']];
    $('#src-bar').innerHTML = cats.map(([k, , c]) => `<i style="width:${(area[k] || 0) / total.v * 100}%;background:${c}" title="${((area[k] || 0) / total.v * 100).toFixed(1)}%"></i>`).join('');
    const pct = k => ((area[k] || 0) / total.v * 100).toFixed(1);
    const st = scene.storey || { non: { per_floor_m: 3.9, plus_m: 0 }, res: { per_floor_m: 3, plus_m: 2.8 } };
    const fmtSt = q => `${q.per_floor_m} m${q.plus_m ? ` + ${q.plus_m} m` : ''}`;
    $('#src-note').innerHTML = `Share of building footprint area. ${+pct(0) >= 50 ? '' : 'Only '}${pct(0)}% has a surveyed or published height; ${pct(1)}% comes from floor counts times a calibrated storey height (${fmtSt(st.non)} offices, ${fmtSt(st.res)} homes). Turn on <b>Height sources</b> above the view to see them on the buildings.`;
    $('#src-legend').innerHTML = cats.map(([k, l, c]) => `<div><i style="background:${c}"></i><span>${l}</span><span class="num">${((area[k] || 0) / total.v * 100).toFixed(1)}%</span></div>`).join('');
    if (acc) {
      $('#acc-stats').innerHTML = [[`${acc.median_abs_error_pct}%`, 'median error'], [`${acc.within_10pct}/${acc.matched}`, 'within 10%'], [`${acc.gross_short}`, 'over 40% short']]
        .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
      const bs = acc.by_source;
      const fixed = B.b.filter(m => m[4] === 'reference');
      const fixNote = fixed.length ? ` ${fixed.length === 1 ? 'One tower' : `${fixed.length} towers`} the open data had far too short ${fixed.length === 1 ? 'is' : 'are'} corrected from the published figure${fixed.length === 1 ? '' : 's'}: ${fixed.map(m => `${m[0]}, ${Math.round(m[9])} m → ${Math.round(m[2])} m`).join('; ')}.` : '';
      const how = scene.accuracy.method ? `${acc.matched} buildings ${scene.accuracy.method}. Median disagreement ${acc.median_abs_error_pct}%.` : `${acc.matched} of ${CITY.name}'s tallest buildings, matched by street address or building name. Surveyed heights: median error ${bs.mapped ? bs.mapped.median_abs_error_pct : '–'}%; floor-count heights: ${bs.floors ? bs.floors.median_abs_error_pct : '–'}%.`;
      $('#acc-note').textContent = `${how} Published heights include spires, so a short model is not always wrong.${fixNote}`;
    } else $('#acc-group').hidden = true;
    if (!UNC || !UNC.fix_list || !UNC.fix_list.length) $('#fix-group').hidden = true;
    if (UNC && UNC.fix_list) $('#fix-list tbody').innerHTML = UNC.fix_list.map(f => `<tr><td>${f.name}<br><span class="note">${f.source === 'estimate' ? 'estimated' : f.source === 'floors' ? 'floor count' : f.source}</span></td>
      <td>${f.place}</td><td class="r"><span class="num">${Math.round(f.height_m)} m</span><br><span class="note mono">${f.plausible_m[0]}–${f.plausible_m[1]}</span></td>
      <td class="r"><span class="num">${f.swing_pp}</span><br><span class="note">points</span></td></tr>`).join('');
    const SRC_NAMES = { buildings: 'Buildings', terrain: 'Terrain', imagery: 'Imagery', places: 'Places', trees: 'Trees',
      reference_heights: 'Reference heights', landmarks: 'Landmark dimensions' };
    $('#sources').innerHTML = Object.entries(scene.sources || {}).map(([k, v]) => `<li>${SRC_NAMES[k] || k}: ${v}</li>`).join('');
  })();

  // ------------------------------------------------------------ controls wiring
  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
  $('#time').addEventListener('input', e => { setTourPlaying(false); setTime(+e.target.value); });
  $('#time').addEventListener('change', () => refreshPlaces(true));
  $('#date').addEventListener('change', e => { const [y, m, d] = e.target.value.split('-').map(Number); if (y) { setTourPlaying(false); setDate(y, m, d); } });
  $('#date-chips').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setTourPlaying(false);
    if (b.dataset.md === 'today') setDate(today.y, today.m, today.d);
    else { const [m, d] = b.dataset.md.split('-').map(Number); setDate(state.y, m, d); }
  });
  $('#speed').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.speed = +b.dataset.s;
    $$('#speed button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  const playIcon = on => { $('#play-icon').innerHTML = on ? '<path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/>' : '<path d="M3 1.5v11l9-5.5z" fill="currentColor"/>'; };
  $('#play').onclick = () => {
    state.playing = !state.playing;
    if (state.playing) { setTourPlaying(false); if (state.min >= state.limits.sunset) setTime(Math.floor(state.limits.sunrise)); }
    playIcon(state.playing);
    $('#play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play the day');
  };
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const p = placeInfo[+tr.dataset.i];
    setTourPlaying(false);
    focusPlace = p.name;
    tbody.querySelectorAll('tr').forEach(r => r.removeAttribute('aria-current'));
    tr.setAttribute('aria-current', 'true');
    const v = placeView(p);
    flyTo(v.cam, v.tgt, 2.4);
    refreshPlaces(true);
  });
  tbody.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('tr') && e.target.closest('tr').click(); });

  // ------------------------------------------------------------ go
  const st0 = CITY.start || { date: [3, 21], time: '09:00', cam: [2000, 2500, 1300], tgt: [0, 0, 30] };
  setDate(state.y, st0.date[0], st0.date[1]);
  setTime(S.hm(st0.time));
  camera.position.copy(W(...st0.cam));
  controls.target.copy(W(...st0.tgt));
  controls.update();
  loadMsg('Ready', 1);
  $('#loader').classList.add('out');
  setTimeout(() => { $('#loader').hidden = true; }, reduced ? 0 : 700);
  playIntro();

  let last = performance.now(), running = true;
  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (state.playing) {
      let m = state.min + dt * state.speed;
      if (m > state.limits.sunset + 20) m = state.limits.sunrise - 20;
      setTime(m);
    }
    stepTour(t);
    stepFlight(t);
    stepOrbit(dt);
    const shot = cine.step(t / 1000);
    if (shot) {
      camera.position.copy(shot.pos); controls.target.copy(shot.look); camera.lookAt(shot.look);
      if (cine.label === 'intro') $('#intro').style.opacity = String(Math.min(1, OECine.span(cine.k, 0.04, 0.16), 1 - OECine.span(cine.k, 0.82, 0.96)));
    } else controls.update();
    fitShadow();
    Wd.tick(t, camera);
    if (show) show.tick(t);
    refreshPlaces();
    if (post) {
      const L = lens.uniforms, night = U.uNight.value;
      L.uExposure.value = renderer.toneMappingExposure * 1.1; L.uLift.value = 1 - 0.7 * night; L.uContrast.value = 0.1 + 0.18 * night;
      L.uSat.value = 1.06; L.uTime.value = t / 1000;
      post.render();
    } else renderer.render(world, camera);
    updateLabels();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__city = { id: cityId, state, setDate, setTime, startStop, setTourPlaying, DSM, placeInfo, camera, controls, inspect, flyTo, W, placeTower,
    cine, orbit, setOrbit, orbitBuilding, orbitLandmark, tour };
  // the router calls stop() before it shows another view
  return {
    stop() { running = false; ac.abort(); ro.disconnect(); controls.dispose(); if (post) { post.renderTarget1.dispose(); post.renderTarget2.dispose(); } renderer.dispose(); Wd.dispose(); window.__city = null; },
  };
};
