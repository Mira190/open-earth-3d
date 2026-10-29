// Open Earth 3D's title screen, cut like a film's opening.
//
// Boot: the stars come up first, with a counter and the name of each file as it loads
// (the Earth's textures are a few megabytes). Then the gate: Enter, with or without sound.
// The cold open runs about nine seconds. The camera crosses the real night side of the
// Earth, low over the brightest stretch of it that dawn is about to reach. It runs
// towards the real sun until the sun clears the limb: a riser, then a hit, a flare, and
// the title. Then the camera pulls back to the whole planet and the menu comes in. Any key
// or click skips straight to the menu.
//
// The menu lists the live destinations in the order the sun reaches them. Choosing one
// turns the globe to it; a card gives its figures, local time and sun, and the camera dives
// to it as the model loads. Later visits in the same session get a short version; coming
// back from a city pulls out from it.
'use strict';
window.OpenEarthGlobe = async function title(cities, notice, from) {
  const $ = id => document.getElementById(id);
  const E = window.OEEarth, A = window.OEScore, S = window.Sun, V3 = THREE.Vector3, RAD = Math.PI / 180;
  const app = $('globe-app'), stage = $('globe-stage'), canvas = $('globe-gl');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const narrow = () => stage.clientWidth < 860 || stage.clientWidth < stage.clientHeight;
  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t); return t * t * t * (t * (6 * t - 15) + 10); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3), easeIn = t => Math.pow(clamp(t), 3);
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const pad = n => String(n).padStart(2, '0');
  const fmtLat = v => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`, fmtLon = v => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
  const fmtN = n => n.toLocaleString('en');
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const off = [];
  const on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); off.push(() => el.removeEventListener(type, fn, opt)); };
  const later = [];
  const after = (ms, fn) => later.push(setTimeout(fn, ms));
  if (notice) { $('globe-notice').textContent = notice; $('globe-notice').hidden = false; after(6000, () => { $('globe-notice').hidden = true; }); }
  app.className = 'title-app';

  // ------------------------------------------------------------ the earth
  const t0 = Date.now();
  const earth = E.create({ canvas, month: new Date(t0).getUTCMonth() + 1, small, onProgress: loading });
  const cam = earth.camera;
  let sun = earth.setTime(t0);
  const shift = { x: 0, y: 0, tx: 0, ty: 0 };
  function applyShift() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (Math.abs(shift.x) < 1e-4 && Math.abs(shift.y) < 1e-4) cam.clearViewOffset();
    else cam.setViewOffset(w, h, -shift.x * w, shift.y * h, w, h);
  }
  function resize() { earth.resize(stage.clientWidth, stage.clientHeight); layout(); applyShift(); }
  const ro = new ResizeObserver(resize);

  // ------------------------------------------------------------ destinations
  const live = cities.filter(c => c.built), planned = cities.filter(c => !c.built);
  const dests = [];
  const groups = new Map();
  for (const c of live) {
    if (c.group) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); continue; }
    dests.push({ id: c.id, name: c.name, native: c.native, country: c.country, lat: c.lat, lon: c.lon, tz: c.timezone, c, sites: null });
  }
  for (const [name, cs] of groups) {
    const lat = cs.reduce((a, c) => a + c.lat, 0) / cs.length, lon = cs.reduce((a, c) => a + c.lon, 0) / cs.length;
    dests.push({ id: `group-${name}`, name, country: cs[0].country, lat, lon, tz: cs[0].timezone, c: cs[0], sites: cs });
  }
  // in the order the sun reaches them: east to west
  dests.sort((a, b) => Math.round(b.lon) - Math.round(a.lon) || live.indexOf(a.c) - live.indexOf(b.c));
  const totalBuildings = live.reduce((a, c) => a + (c.buildings || 0), 0);
  for (const d of dests) {
    d.beacon = earth.addCity(d.lat, d.lon);
    d.dir = E.ll(d.lat, d.lon);
  }
  const lang = d => (d.id === 'hong-kong' ? 'zh-Hant' : 'ja');
  const nativeName = d => (d.native ? `<small lang="${lang(d)}">${d.native}</small>` : '');

  // what this browser has done there: the model opened, stamps in the game
  function progress(d) {
    const ids = d.sites ? d.sites.map(c => c.id) : [d.id];
    let visited = false, stamps = 0;
    for (const id of ids) {
      if (store.get(`oe3d-intro-${id}`)) visited = true;
      try { const g = JSON.parse(store.get(`oe3d-game-${id}`) || 'null'); if (g && g.qs && g.qs.stamps) { stamps += g.qs.stamps.length; visited = true; } } catch (e) { /* not a save */ }
      if (store.get(`oe3d-reef-game-${id}`)) visited = true;
    }
    return { visited, stamps };
  }
  function sunAt(d, t) {
    const loc = S.utcToLocal(t, d.tz), alt = S.position(t, d.lat, d.lon).altitude;
    return { clock: `${pad(Math.floor(loc.minutes / 60))}:${pad(Math.floor(loc.minutes % 60))}`, zone: loc.zone, alt,
      state: alt > 0 ? 'up' : alt > -6 ? 'tw' : 'night', word: alt > 0 ? `sun ${alt.toFixed(0)}° up` : alt > -6 ? 'twilight' : 'night' };
  }

  const list = $('ts-list');
  list.innerHTML = dests.map((d, i) => {
    const p = progress(d);
    return `<li style="--i:${i + 1}"><button class="ts-item" data-i="${i}" aria-label="${d.name}, ${d.country}">
      <span class="n">${pad(i + 1)}</span><span class="nm">${d.name}${nativeName(d)}</span><span class="tm"><i></i><span></span></span>${p.visited ? '<span class="vis" title="Visited"></span>' : ''}</button></li>`;
  }).join('');
  const items = [...list.querySelectorAll('.ts-item')];
  $('ts-list').parentElement.querySelector('.ts-hint').style.setProperty('--i', dests.length + 1);
  function refreshTimes() {
    const t = Date.now();
    dests.forEach((d, i) => {
      const s = sunAt(d, t), tm = items[i].querySelector('.tm');
      tm.querySelector('i').className = s.state;
      tm.querySelector('span').textContent = s.clock;
    });
    if (sel >= 0) fillStats(dests[sel]);
  }
  $('ts-next').innerHTML = `Next in line <b>${planned.map(c => c.name).join(' · ')}</b>`;
  $('ts-tally').textContent = `${dests.length} destinations · ${fmtN(totalBuildings)} buildings measured · one real sun`;
  $('ts-planned').innerHTML = planned.map(c => `<li><b>${c.name}</b><span>${c.country}. ${c.data || ''}</span></li>`).join('');

  // labels on the globe
  const marks = $('ts-marks');
  const mk = (d, cls) => {
    const b = document.createElement('button');
    b.className = `ts-mark ${cls}`;
    b.innerHTML = `${d.name}<span class="co">${fmtLat(d.lat)} ${fmtLon(d.lon)}</span>`;
    b.tabIndex = -1;
    marks.appendChild(b);
    return b;
  };
  for (const d of dests) { d.mark = mk(d, 'live'); d.mark.onclick = () => select(dests.indexOf(d), true); d.mark.onpointerenter = () => hover(dests.indexOf(d)); }
  const plannedMarks = planned.map(c => ({ c, el: mk(c, 'plan'), p: E.ll(c.lat, c.lon) }));
  for (const m of plannedMarks) m.el.onclick = () => { $('globe-notice').textContent = `${m.c.name} is next in line. Open data to start from: ${m.c.data || 'to be surveyed'}`; $('globe-notice').hidden = false; };

  // ------------------------------------------------------------ the camera
  const pose = { pos: new V3(0, 0, 6), look: new V3(), up: new V3(0, 1, 0), fov: 30 };
  function apply(p) {
    cam.position.copy(p.pos);
    cam.up.copy(p.up);
    cam.lookAt(p.look);
    if (Math.abs(cam.fov - p.fov) > 1e-3) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
  }
  // the menu's orbit: the camera on a sphere round the earth, looking at its centre
  const orb = { lat: 10, lon: 135, dist: 4.6, fov: 28, tlat: 10, tlon: 135, tdist: 4.6, vlat: 0, vlon: 0 };
  // the menu opens on the Asia-Pacific, where most destinations are, turned a little towards
  // the sun so some of the globe is always lit
  function homeView() {
    const c = dests.reduce((a, d) => a.add(d.dir), new V3()).normalize();
    const m = c.addScaledVector(earth.sun, 0.55).normalize(), g = E.latlon(m);
    orb.tlat = clamp(g.lat, -30, 30); orb.tlon = g.lon; orb.tdist = fitDist();
  }
  function fitDist(scale = 1) {
    const v = orb.fov * RAD, h = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
    const half = Math.min(v, narrow() ? h : v) / 2;
    return 1 / Math.sin(half * (narrow() ? 0.8 : 0.9) * scale);
  }
  function orbitPose(o, out = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 }) {
    E.ll(o.lat, o.lon, o.dist, out.pos);
    out.look.set(0, 0, 0);
    out.up.set(0, 1, 0);
    out.fov = o.fov;
    return out;
  }
  function layout() {
    shift.tx = narrow() ? 0 : 0.13;
    shift.ty = narrow() ? 0.13 : 0;
    if (state === 'menu') orb.tdist = fitDist(sel >= 0 ? 0.92 : 1);
  }

  // ------------------------------------------------------------ the cold open, planned on the real sky
  const Y = new V3(0, 1, 0);
  const arc = (Sd, P, th, out = new V3()) => out.copy(Sd).multiplyScalar(Math.cos(th * RAD)).addScaledVector(P, Math.sin(th * RAD));
  const T_RISE = 4.0, V_ARC = 2.1, TAU = 0.9, R0 = 1.165;
  const ramp = t => t - TAU * (1 - Math.exp(-t / TAU)); // starts still, settles to full speed
  let plan = null;
  function planOpen() {
    const Sd = earth.sun.clone();
    const n0 = Y.clone().addScaledVector(Sd, -Y.dot(Sd)).normalize();
    let best = null;
    for (let az = 0; az < 360; az += 5) {
      const P = n0.clone().applyAxisAngle(Sd, az * RAD); // where the camera's path crosses the terminator
      if (new V3().crossVectors(Y, P).dot(Sd) < 0.2) continue; // dawn there: the earth's turn carries it into the sun
      const lat = E.latlon(P).lat;
      let score = 0;
      for (let th = 93; th <= 124; th += 1.5) {
        for (const side of [-7, -3.5, 0, 3.5, 7]) {
          const Q = arc(Sd, P, th).applyAxisAngle(Sd, side * RAD);
          score += earth.lightsAt(Q) * (th < 104 ? 1.6 : 1);
        }
      }
      score *= 1 - 0.7 * smooth((Math.abs(lat) - 48) / 20);
      if (!best || score > best.score) best = { P, score };
    }
    const P = best ? best.P : n0;
    const r = t => R0 + 0.04 * smooth(t / 10);
    // the hit lands as the sun clears the dense air at the limb (about 40 km up)
    const crit = t => 180 - Math.asin(1.006 / r(t)) / RAD;
    const thRise = crit(T_RISE) - 0.4;
    const thHold = thRise + V_ARC * ramp(T_RISE);
    const nadir = arc(Sd, P, thHold);
    return { S: Sd, P, r, thRise, thHold, nadir: E.latlon(nadir), dawn: E.latlon(P) };
  }
  // the camera crossing the night towards the sun: t seconds after Enter (negative: waiting at the gate)
  function nightPose(t, out = pose) {
    const { S: Sd, P } = plan;
    const after = Math.max(0, t - T_RISE);
    const th = t <= T_RISE ? plan.thHold - V_ARC * ramp(Math.max(0, t)) : plan.thRise - V_ARC * (after - 0.5 * after * after / 9) * (after < 9 ? 1 : 0);
    const C = arc(Sd, P, th).applyAxisAngle(Sd, (t < 0 ? t * 0.05 : 0) * RAD).multiplyScalar(plan.r(Math.max(0, t)));
    const up = C.clone().normalize();
    const tilt = lerp(5.2, 3.6, smooth(t / 7));
    const D = Sd.clone().addScaledVector(up, -Math.tan(tilt * RAD)).normalize();
    const roll = lerp(-4, 0.5, smooth((t + 2) / 9)) * RAD;
    out.pos.copy(C);
    out.look.copy(C).add(D);
    out.up.copy(up).applyAxisAngle(D, roll);
    out.fov = lerp(40, 37, smooth(t / 8));
    return out;
  }
  // the pull-back from the sunrise to the menu's orbit, over d seconds from time a
  const PULL_A = T_RISE + 2.5, PULL_D = 4.4;
  const _a = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 }, _b = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 };
  function blendPose(a, b, k, out = pose) {
    const ra = a.pos.length(), rb = b.pos.length();
    const da = a.pos.clone().normalize(), db = b.pos.clone().normalize();
    const kd = smooth(k), kr = smooth(span(k, 0.0, 0.9));
    const ang = da.angleTo(db), axis = new V3().crossVectors(da, db);
    const dir = axis.lengthSq() > 1e-10 ? da.clone().applyAxisAngle(axis.normalize(), ang * kd) : da.clone();
    out.pos.copy(dir).multiplyScalar(lerp(ra, rb, kr));
    // the look moves from a point on the shot's line of sight, as far off as the horizon, to the
    // orbit's target, so whatever the shot framed stays in frame as the camera pulls away
    const reach = Math.sqrt(Math.max(0.05, ra * ra - 1));
    const pa = a.look.clone().sub(a.pos).normalize().multiplyScalar(reach).add(a.pos);
    const kl = smooth(span(k, 0.0, 0.7));
    out.look.copy(pa).lerp(b.look, kl);
    out.up.copy(a.up).multiplyScalar(1 - kd).addScaledVector(b.up, kd).normalize();
    out.fov = lerp(a.fov, b.fov, kd);
    return out;
  }
  function menuStart() {
    homeView();
    orb.lat = orb.tlat; orb.lon = orb.tlon; orb.dist = orb.tdist;
  }

  // ------------------------------------------------------------ captions: data decoded on screen
  const GLYPHS = '0123456789°.:·NSEW';
  function decode(el, text, dur = 900) {
    if (reduced) { el.textContent = text; return; }
    const tStart = performance.now();
    const step = () => {
      const k = (performance.now() - tStart) / dur;
      if (k >= 1 || !running) { el.textContent = text; return; }
      el.textContent = text.split('').map((ch, i) => (ch === ' ' || i / text.length < k * 1.2 - 0.2 ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
      requestAnimationFrame(step);
    };
    step();
  }
  function minutesToSunrise(lat, lon, t) {
    for (let m = 0; m <= 900; m += 2) if (S.position(t + m * 60000, lat, lon).altitude > -0.833) return m;
    return null;
  }

  // ------------------------------------------------------------ the sequence
  let state = 'boot', running = true, raf = 0, tBegin = 0, frozen = null, sel = -1, hot = -1, lastInput = performance.now();
  const clock = () => (frozen != null ? frozen.now : performance.now() / 1000); // seconds; held for the film tool
  const cues = [];
  const cue = (t, fn, { sound = false } = {}) => cues.push({ t, fn, sound, done: false });
  let soundOn = false;
  const wordEl = $('ts-word');
  // one span per letter for the reveal; screen readers get the word whole
  wordEl.innerHTML = `<span class="ts-sr">${wordEl.textContent}</span>` + wordEl.textContent.split('').map(ch => `<i aria-hidden="true">${ch === ' ' ? '&nbsp;' : ch}</i>`).join('');
  const letters = [...wordEl.querySelectorAll('i')], titleEl = $('ts-title'), subEl = titleEl.querySelector('.s'), tallyEl = $('ts-tally');
  const capsEl = app.querySelector('.ts-caps'), barsEl = app.querySelector('.ts-bars');
  const expoOut = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
  // the title card and the letterbox, on the sequence clock (so a held frame is exact):
  // the letters come out of a blur one by one while the tracking closes up
  function titleFx(t) {
    const a = T_RISE + 0.1, narrowW = narrow();
    const out = smooth(span(t, PULL_A + 0.7, PULL_A + 1.7));
    titleEl.style.opacity = String(1 - out);
    titleEl.style.transform = `translateY(-50%) scale(${(1 - 0.04 * out).toFixed(4)})`;
    titleEl.style.filter = out > 0.001 ? `blur(${(out * 6).toFixed(2)}px)` : '';
    titleEl.style.setProperty('--scrim', smooth(span(t, a, a + 1.6)).toFixed(3));
    const track = lerp(narrowW ? 0.5 : 0.9, narrowW ? 0.22 : 0.34, expoOut(span(t, a, a + 3.8)));
    wordEl.style.letterSpacing = `${track.toFixed(4)}em`;
    wordEl.style.marginRight = `${(-track).toFixed(4)}em`;
    letters.forEach((el, i) => {
      const k = span(t, a + i * 0.045, a + i * 0.045 + 1.3), e = easeOut(k);
      el.style.opacity = smooth(k).toFixed(3);
      el.style.filter = e < 0.999 ? `blur(${(14 * (1 - e)).toFixed(2)}px)` : '';
      el.style.transform = e < 0.999 ? `translateY(${(0.18 * (1 - e)).toFixed(3)}em)` : '';
    });
    subEl.style.opacity = smooth(span(t, a + 0.7, a + 2.1)).toFixed(3);
    tallyEl.style.opacity = smooth(span(t, a + 1.6, a + 3.0)).toFixed(3);
    barsEl.style.setProperty('--bar', (smooth(span(t, 0, 1.6)) * (1 - smooth(span(t, PULL_A + 1.3, PULL_A + 2.9)))).toFixed(4));
    capsEl.style.setProperty('--caps', (1 - smooth(span(t, PULL_A + 0.4, PULL_A + 1.4))).toFixed(3));
  }
  const lensBase = { exposure: 1, bloom: 0.22 };
  const NIGHT_EXP = 1.35; // the eye open for the night side

  function loading(k, file) {
    $('ts-load-bar').style.width = `${(k * 100).toFixed(1)}%`;
    $('ts-load-pct').textContent = `${Math.round(k * 100)}%`;
    const names = { 'stars.json': 'Yale Bright Star Catalogue · 9,096 stars', 'milkyway.jpg': 'The Milky Way · ESO / S. Brunier', 'surface.jpg': 'Black Marble · the Earth at night',
      'clouds.jpg': 'Clouds · Blue Marble', [`day-${pad(new Date(t0).getUTCMonth() + 1)}.jpg`]: `Blue Marble · ${MONTHS[new Date(t0).getUTCMonth()]}` };
    $('ts-load-file').textContent = names[file] || '';
  }

  function begin(withSound) {
    if (state !== 'gate') return;
    store.set('oe3d-title', '1', true);
    store.set('oe3d-sound', withSound ? 'on' : 'off');
    soundOn = withSound && A.start(true);
    if (!withSound) A.start(false);
    setSoundUi();
    state = 'open';
    menuStart();
    plan.nadir = E.latlon(arc(plan.S, plan.P, plan.thHold));
    plan.dawn = E.latlon(plan.P);
    app.classList.add('started', 'opening');
    tBegin = clock();
    const at = A.now();
    if (soundOn && !reduced) { A.drone(2.2); A.riser(at + T_RISE, 3.2); A.hit(at + T_RISE + 0.03); }
    const d = new Date();
    cue(0.2, () => decode($('ts-cap1'), `Live · ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`, 800));
    const nd = plan.nadir, wait = minutesToSunrise(nd.lat, nd.lon, Date.now());
    cue(1.3, () => decode($('ts-cap2'), `Night below · ${fmtLat(nd.lat)} ${fmtLon(nd.lon)}${wait != null ? ` · sunrise in ${wait >= 60 ? `${Math.floor(wait / 60)} h ` : ''}${wait % 60} min` : ''}`, 1100));
    cue(T_RISE + 0.1, () => decode($('ts-cap3'), `Sunrise · ${fmtLat(plan.dawn.lat)} ${fmtLon(plan.dawn.lon)} · now`, 900));
    cue(PULL_A + 1.3, () => showMenu());
    cue(PULL_A + PULL_D, () => { titleFx(PULL_A + PULL_D); state = 'menu'; app.classList.remove('opening'); });
    if (reduced) skip();
  }

  // skip: straight to the menu, firing what the cues had left
  function skip() {
    if (state !== 'open') return;
    for (const c of cues) if (!c.done) { c.done = true; if (!c.sound) c.fn(); }
    titleFx(PULL_A + 4);
    if (soundOn && clock() - tBegin < T_RISE) { A.stop(0.15); after(200, () => { if (!running) return; A.start(true); A.pad(); }); }
    const from = { pos: cam.position.clone(), look: cam.position.clone().add(cam.getWorldDirection(new V3())), up: cam.up.clone(), fov: cam.fov };
    transition(from, reduced ? 0 : 1.4);
    state = 'menu';
    app.classList.remove('opening');
  }
  // a short blend from a pose into the orbit
  let trans = null;
  function transition(fromPose, dur) { trans = { from: fromPose, t0: clock(), dur }; }

  function showMenu() {
    app.classList.add('menu');
    menuShownAt = clock();
    if (sel < 0 && !narrow()) after(1600, () => { if (sel < 0 && state === 'menu' && performance.now() - lastInput > 1500) select(0, false, true); });
  }
  let menuShownAt = 0;

  // ------------------------------------------------------------ the menu
  function hover(i) {
    if (hot === i) return;
    hot = i;
    for (const d of dests) d.mark.classList.toggle('hot', dests.indexOf(d) === i || dests.indexOf(d) === sel);
  }
  function select(i, fromUser = false, quiet = false) {
    if (state === 'dive') return;
    if (i === sel && fromUser) return;
    sel = i;
    items.forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
    for (const d of dests) d.mark.classList.toggle('hot', dests.indexOf(d) === i);
    if (fromUser || !quiet) A.tick(2100, 0.035);
    const d = dests[i];
    // frame the city up and to the left of the globe's centre, clear of its card
    orb.tlat = clamp(d.lat - (narrow() ? 12 : 10), -55, 55);
    orb.tlon = d.lon + (narrow() ? 0 : 16);
    orb.tdist = fitDist(0.92);
    focusDir.copy(d.dir);
    showCard(d);
  }
  const focusDir = new V3(1, 0, 0);
  const card = $('ts-card');
  function fillStats(d) {
    const s = sunAt(d, Date.now());
    const el = card.querySelector('[data-k="time"]'), es = card.querySelector('[data-k="sun"]');
    if (el) el.innerHTML = `${s.clock}<small>${s.zone}</small>`;
    if (es) es.innerHTML = `${s.alt.toFixed(0)}°<small>${s.word}</small>`;
  }
  function showCard(d) {
    const p = progress(d);
    const km = d.c.extent_km ? `${d.c.extent_km[0]} × ${d.c.extent_km[1]}<small>km</small>` : '';
    // a group's span: the great-circle distance between its two furthest sites
    let spanKm = 0;
    if (d.sites) for (const a of d.sites) for (const b of d.sites) spanKm = Math.max(spanKm, E.ll(a.lat, a.lon).angleTo(E.ll(b.lat, b.lon)) * 6371);
    const stats = d.sites
      ? `<div><dt>Sites</dt><dd>${d.sites.length}</dd></div><div><dt>From end to end</dt><dd>${fmtN(Math.round(spanKm / 10) * 10)}<small>km</small></dd></div>`
      : `<div><dt>Buildings</dt><dd>${fmtN(d.c.buildings || 0)}</dd></div><div><dt>Model</dt><dd>${km}</dd></div>`;
    const prog = p.stamps ? `${p.stamps} stamp${p.stamps > 1 ? 's' : ''} in your passport` : p.visited ? 'Visited' : '';
    const actions = d.sites
      ? `<ul class="ts-sites">${d.sites.map(c => `<li><button data-site="${c.id}"><b>${c.name}</b><small>${c.tagline || ''}</small></button></li>`).join('')}</ul>`
      : `<div class="ts-actions">${d.c.game ? '<button class="ts-btn primary" data-go="play">Play <kbd>P</kbd></button>' : ''}<button class="ts-btn" data-go="model">Explore in 3D <kbd>↵</kbd></button></div>`;
    card.innerHTML = `<div><span class="eb">${d.country} · ${fmtLat(d.lat)} ${fmtLon(d.lon)}</span><h2>${d.name}${d.native ? `<small lang="${lang(d)}">${d.native}</small>` : ''}</h2></div>
      <p class="sum">${d.sites ? 'Five sites on the Great Barrier Reef, rebuilt from survey bathymetry and satellite imagery under the real sun, moon and tide. Walk, snorkel, dive, sail and fly.' : (d.c.summary || '')}</p>
      <dl class="ts-stats">${stats}<div><dt>Local time</dt><dd data-k="time"></dd></div><div><dt>Sun</dt><dd data-k="sun"></dd></div></dl>
      ${prog ? `<span class="ts-prog">${prog}</span>` : ''}${actions}`;
    fillStats(d);
    card.classList.remove('on', 'has-film');
    void card.offsetWidth;
    card.classList.add('on');
    if (window.OEFilm && !d.sites) OEFilm.card(card, d.c, { go: play => dive(d, play) }); // the city's film, if it has one (film.js)
  }
  on(card, 'click', e => {
    const b = e.target.closest('button');
    if (!b || sel < 0) return;
    if (b.dataset.site) dive(dests[sel], false, cities.find(c => c.id === b.dataset.site));
    else dive(dests[sel], b.dataset.go === 'play');
  });
  on(list, 'click', e => { const b = e.target.closest('.ts-item'); if (!b) return; lastInput = performance.now(); const i = +b.dataset.i; if (i === sel && !narrow()) dive(dests[i], false); else select(i, true); });
  let hoverT = 0;
  on(list, 'pointerover', e => {
    const b = e.target.closest('.ts-item');
    if (!b || e.pointerType === 'touch') return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => { lastInput = performance.now(); select(+b.dataset.i, true); }, 140);
  });
  on(list, 'pointerleave', () => clearTimeout(hoverT));
  on(list, 'focusin', e => { const b = e.target.closest('.ts-item'); if (b && state === 'menu') select(+b.dataset.i, true); });

  // the dive: down onto the city, faster and faster, into the dark where the model loads
  let diving = null;
  function dive(d, play, site) {
    if (state === 'dive' || (state !== 'menu' && state !== 'open')) return;
    if (state === 'open') skip();
    state = 'dive';
    if (window.OEFilm) OEFilm.stopPreview();
    app.classList.add('diving');
    A.confirm();
    A.whoosh(reduced ? 0.4 : 1.7);
    const target = site || d.c;
    const go = () => {
      if (manual) return; // the film tool ends on the black
      if (target.viewer) location.href = `${target.viewer}?city=${target.id}`;
      else location.hash = play ? `play-${target.id}` : target.id;
    };
    if (reduced) { earth.lens.uFade.value = 0; after(250, go); return; }
    diving = { t0: clock(), from: { pos: cam.position.clone(), fov: cam.fov }, dir: E.ll(target.lat, target.lon), go, done: false };
  }
  function diveStep(t) {
    const k = clamp((t - diving.t0) / 1.75);
    const da = diving.from.pos.clone().normalize(), db = diving.dir;
    const ang = da.angleTo(db), axis = new V3().crossVectors(da, db);
    const kd = smooth(span(k, 0, 0.55));
    const dir = axis.lengthSq() > 1e-10 ? da.applyAxisAngle(axis.normalize(), ang * kd) : da;
    const r0 = diving.from.pos.length();
    const r = lerp(r0, 1.0035, easeIn(span(k, 0.12, 1)));
    pose.pos.copy(dir).multiplyScalar(r);
    pose.look.set(0, 0, 0);
    pose.up.set(0, 1, 0);
    pose.fov = lerp(diving.from.fov, 62, easeIn(span(k, 0.3, 1)));
    shift.tx = 0; shift.ty = 0;
    const L = earth.lens;
    L.uZoom.value = easeIn(span(k, 0.25, 1)) * 1.1;
    L.uCA.value = 0.25 + 3.5 * easeIn(span(k, 0.3, 1));
    L.uExposure.value = lerp(L.uExposure.value, 1.25, 0.05);
    L.uFade.value = 1 - smooth(span(k, 0.8, 1));
    if (k >= 1 && !diving.done) { diving.done = true; diving.go(); }
  }

  // ------------------------------------------------------------ input
  let drag = null;
  on(canvas, 'pointerdown', e => {
    lastInput = performance.now();
    if (state === 'open') { skip(); return; }
    if (state !== 'menu') return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    orb.vlat = orb.vlon = 0;
  });
  on(canvas, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = 0.16 * orb.dist / 4.6, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const dt = Math.max(1, performance.now() - drag.t);
    orb.tlon -= dx * k; orb.tlat = clamp(orb.tlat + dy * k, -65, 65);
    orb.vlon = -dx * k / dt * 1000; orb.vlat = dy * k / dt * 1000;
    drag.x = e.clientX; drag.y = e.clientY; drag.t = performance.now();
    lastInput = performance.now();
  });
  const endDrag = () => { drag = null; };
  on(canvas, 'pointerup', endDrag);
  on(canvas, 'pointercancel', endDrag);
  on(canvas, 'wheel', e => {
    lastInput = performance.now();
    if (state === 'open') { skip(); return; }
    if (state !== 'menu') return;
    orb.tdist = clamp(orb.tdist * Math.exp(e.deltaY * 0.0012), 1.6, 9);
    e.preventDefault();
  }, { passive: false });
  on(window, 'keydown', e => {
    if (!running || e.metaKey || e.ctrlKey || e.altKey) return;
    lastInput = performance.now();
    if (!$('ts-about').hidden) { if (e.key === 'Escape') toggleAbout(false); return; }
    if (state === 'gate') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); begin(soundPref); } return; }
    if (state === 'open') { e.preventDefault(); skip(); return; }
    if (state !== 'menu') return;
    const k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 's' || k === 'arrowright') { e.preventDefault(); select((sel + 1 + dests.length) % dests.length, true); items[sel].focus({ preventScroll: true }); }
    else if (k === 'arrowup' || k === 'w' || k === 'arrowleft') { e.preventDefault(); select((sel - 1 + dests.length) % dests.length, true); items[sel].focus({ preventScroll: true }); }
    else if (k === 'enter' && sel >= 0 && !e.target.closest('.ts-card, .ts-top, .ts-foot')) { e.preventDefault(); const d = dests[sel]; if (d.sites) card.querySelector('[data-site]').focus(); else dive(d, false); }
    else if (k === 'p' && sel >= 0 && dests[sel].c.game && !dests[sel].sites) dive(dests[sel], true);
    else if (k === 'f' && sel >= 0 && window.OEFilm && OEFilm.hasReel()) OEFilm.openReel();
    else if (k === 'escape' && sel >= 0) { sel = -1; items.forEach(b => b.setAttribute('aria-current', 'false')); card.classList.remove('on'); orb.tdist = fitDist(); for (const d of dests) d.mark.classList.remove('hot'); }
  });
  // Enter starts with the sound the visitor chose last time; the small button, the other way
  const soundPref = store.get('oe3d-sound') !== 'off';
  on($('ts-enter'), 'click', () => begin(soundPref));
  on($('ts-quiet'), 'click', () => begin(!soundPref));
  on($('ts-skip'), 'click', e => { e.stopPropagation(); skip(); });
  on(stage, 'pointerdown', e => { if (state === 'open' && !e.target.closest('button')) skip(); });

  // sound in the menu
  function setSoundUi() {
    $('ts-sound').setAttribute('aria-pressed', String(A.on));
    $('ts-sound-l').textContent = A.on ? 'Sound on' : 'Sound off';
  }
  on($('ts-sound'), 'click', () => {
    if (!A.on) { A.start(true); A.setMuted(false); A.pad(); store.set('oe3d-sound', 'on'); }
    else { A.setMuted(true); store.set('oe3d-sound', 'off'); }
    setSoundUi();
  });
  function toggleAbout(show) { $('ts-about').hidden = !show; if (show) $('ts-about-x').focus(); }
  on($('ts-about-btn'), 'click', () => toggleAbout(true));
  on($('ts-about-x'), 'click', () => toggleAbout(false));
  on($('ts-about'), 'click', e => { if (e.target === $('ts-about')) toggleAbout(false); });
  on($('ts-replay'), 'click', () => { store.set('oe3d-title', '', true); location.reload(); });
  on($('ts-logo'), 'click', e => { e.preventDefault(); });

  // ------------------------------------------------------------ the frame
  const clockEl = $('ts-utc');
  function tickClock() {
    const d = new Date();
    clockEl.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  const clockTimer = setInterval(tickClock, 1000);
  tickClock();
  const sunTimer = setInterval(() => {
    if (state === 'open') return; // the plan holds the sun still for the shot
    sun = earth.setTime(Date.now());
    $('ts-subsolar').textContent = `Sun overhead ${fmtLat(sun.lat)} ${fmtLon(sun.lon)}`;
    refreshTimes();
  }, 20000);
  $('ts-subsolar').textContent = `Sun overhead ${fmtLat(sun.lat)} ${fmtLon(sun.lon)}`;

  const _v = new V3(), _n = new V3();
  function placeMarks() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const put = (el, p, always) => {
      _n.copy(p).normalize();
      const facing = _n.dot(_v.copy(cam.position).sub(p).normalize());
      _v.copy(p).project(cam);
      const vis = facing > 0.12 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
      if (!vis) { if (!el.hidden) el.hidden = true; return; }
      el.hidden = false;
      el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      el.style.opacity = String(Math.min(always ? 1 : 0.9, (facing - 0.12) / 0.25));
    };
    for (const d of dests) put(d.mark, d.dir, true);
    for (const m of plannedMarks) put(m.el, m.p, false);
    // a label that would overlap one already placed loses its text (its tick stays): the chosen
    // city first, then the live ones, then the planned
    const order = [...dests.map((d, i) => ({ el: d.mark, pri: i === sel ? 0 : i === hot ? 1 : 2 })), ...plannedMarks.map(m => ({ el: m.el, pri: 3 }))]
      .filter(o => !o.el.hidden).sort((x, y) => x.pri - y.pri);
    const placed = [];
    for (const o of order) {
      const r = o.el.getBoundingClientRect();
      const clash = placed.some(q => r.left < q.right + 6 && r.right + 6 > q.left && r.top < q.bottom + 2 && r.bottom + 2 > q.top);
      o.el.classList.toggle('mute', clash);
      if (!clash) placed.push(r);
    }
  }

  let lastT = performance.now() / 1000;
  let manual = false; // the film tool draws frames itself
  function frame(force) {
    if (!running) return;
    if (manual && force !== true) return;
    if (!manual) raf = requestAnimationFrame(frame);
    const now = clock();
    const dt = Math.min(0.1, Math.max(0, now - lastT));
    lastT = now;
    const L = earth.lens;
    if (state === 'boot' || state === 'gate') {
      if (plan) {
        // waiting at the gate: the camera holds over the dark, drifting along the dawn line
        if (!reduced) plan.P.applyAxisAngle(plan.S, -dt * 0.06 * RAD);
        apply(nightPose(0, pose));
        earth.ready.value = Math.min(1, earth.ready.value + dt * 0.5);
        earth.earth.uLights.value = 3.6;
      } else {
        // the stars come up while the earth loads: the Milky Way's core, turning slowly
        const t = now - bootAt;
        const look = E.ll(-29, 266.4 - E.gmst(Date.now()), 1);
        apply({ pos: look.clone().multiplyScalar(-40), look: look.clone().multiplyScalar(-39), up: new V3(0, 1, 0).applyAxisAngle(look, t * 0.01), fov: 46 });
      }
      L.uExposure.value = NIGHT_EXP;
      L.uFade.value = Math.min(1, L.uFade.value + dt * 0.45);
    } else if (state === 'open') {
      const t = frozen != null ? frozen.t : now - tBegin;
      for (const c of cues) if (!c.done && t >= c.t) { c.done = true; c.fn(); }
      titleFx(t);
      if (t < PULL_A) apply(nightPose(t, pose));
      else {
        nightPose(t, _a);
        orbitPose(orb, _b);
        apply(blendPose(_a, _b, span(t, PULL_A, PULL_A + PULL_D), pose));
        shift.x = shift.tx * smooth(span(t, PULL_A + 0.5, PULL_A + PULL_D));
        shift.y = shift.ty * smooth(span(t, PULL_A + 0.5, PULL_A + PULL_D));
        applyShift();
      }
      // the eye: open for the night, stopped down as the sun arrives, a burst of glare at the hit
      // the eye stops down as the glow grows, before the sun is out, so it arrives soft, not blown
      const rise = span(t, T_RISE - 1.4, T_RISE + 1.2);
      L.uExposure.value = lerp(NIGHT_EXP, 0.92, smooth(rise)) * (t > PULL_A ? lerp(1, menuExposure() / 0.92, smooth(span(t, PULL_A, PULL_A + PULL_D))) : 1);
      earth.bloom.strength = lensBase.bloom + 0.1 * Math.exp(-Math.pow((t - T_RISE - 0.3) / 0.7, 2));
      earth.earth.uLights.value = lerp(3.6, 3.4, smooth(span(t, PULL_A, PULL_A + PULL_D)));
      L.uFlash.value = 0;
      L.uFade.value = Math.min(1, L.uFade.value + dt * 0.8);
      earth.ready.value = 1;
    } else if (state === 'menu') {
      // the orbit: damped towards its targets, with inertia after a drag and a slow drift when idle
      if (!drag) {
        orb.tlon += orb.vlon * dt; orb.tlat = clamp(orb.tlat + orb.vlat * dt, -65, 65);
        orb.vlon *= Math.exp(-dt * 3); orb.vlat *= Math.exp(-dt * 3);
        if (!reduced && performance.now() - lastInput > 9000) orb.tlon -= dt * 1.4;
      }
      const kk = 1 - Math.exp(-dt * (trans ? 6 : 3.2));
      let dl = orb.tlon - orb.lon; dl = ((dl + 540) % 360) - 180;
      orb.lon += dl * kk; orb.lat += (orb.tlat - orb.lat) * kk; orb.dist += (orb.tdist - orb.dist) * kk;
      orbitPose(orb, _b);
      if (trans) {
        const k = trans.dur ? clamp((now - trans.t0) / trans.dur) : 1;
        apply(blendPose(trans.from, _b, k, pose));
        if (k >= 1) trans = null;
      } else apply(_b);
      shift.x += (shift.tx - shift.x) * kk; shift.y += (shift.ty - shift.y) * kk;
      applyShift();
      L.uExposure.value += (menuExposure() - L.uExposure.value) * (1 - Math.exp(-dt * 1.5));
      L.uFlare.value += (0.3 - L.uFlare.value) * kk; // under the menu, a flare is a distraction
      earth.bloom.strength = lensBase.bloom;
      L.uFade.value = Math.min(1, L.uFade.value + dt * 0.7);
      L.uFlash.value = 0;
      earth.ready.value = 1;
    } else if (state === 'dive') {
      diveStep(now);
      apply(pose);
      applyShift();
    }
    // the cities' lights: up one by one as the menu arrives, the chosen one brightest
    const since = now - menuShownAt;
    dests.forEach((d, i) => {
      const target = !menuShownAt ? 0 : smooth((since - 0.3 - i * 0.12) / 0.8) * (i === sel ? 1.7 : i === hot ? 1.2 : 0.65);
      d.beacon.intensity.value += (target - d.beacon.intensity.value) * Math.min(1, dt * 5);
    });
    earth.earth.uFocus.value.copy(focusDir);
    earth.earth.uFocusAmt.value += ((sel >= 0 && state === 'menu' ? 1 : 0) - earth.earth.uFocusAmt.value) * Math.min(1, dt * 3);
    earth.render(performance.now());
    if (state === 'menu' || state === 'dive' || (state === 'open' && app.classList.contains('menu'))) placeMarks();
  }
  // a night view wants the eye open a little wider than a day one
  function menuExposure() {
    const e = cam.position.clone().normalize().dot(earth.sun);
    return lerp(1.3, 0.95, smooth((e + 0.35) / 0.8));
  }

  // ------------------------------------------------------------ start
  let bootAt = performance.now() / 1000;
  ro.observe(stage);
  resize();
  earth.lens.uFade.value = 0;
  raf = requestAnimationFrame(frame);
  const returning = !!store.get('oe3d-title', true);
  const back = from && dests.find(d => d.id === from || (d.sites && d.sites.some(c => c.id === from)));
  try { await earth.load(); } catch (e) { console.warn('title: textures', e); }
  if (!running) return api();
  plan = planOpen();
  earth.ready.value = 0;
  earth.lens.uFade.value = 0;
  if (reduced || returning || back) {
    // straight to the menu: from the city just left, or a pull-in from further out
    store.set('oe3d-title', '1', true);
    app.classList.add('started', 'menu');
    state = 'menu';
    menuStart();
    if (back) {
      const i = dests.indexOf(back);
      select(i, false, true);
      orb.lat = orb.tlat; orb.lon = orb.tlon;
      transition({ pos: E.ll(back.lat, back.lon, 1.02), look: new V3(), up: new V3(0, 1, 0), fov: 50 }, reduced ? 0 : 2.6);
    } else {
      transition(orbitPose(Object.assign({}, orb, { dist: orb.dist * 1.9, lon: orb.lon + 25 })), reduced ? 0 : 3.2);
    }
    menuShownAt = clock();
    earth.ready.value = 1;
    if (store.get('oe3d-sound') === 'on') $('ts-sound').classList.add('nudge'); // sound was on last time: the browser needs a click to start it
    setSoundUi();
    showMenu();
  } else {
    state = 'gate';
    $('ts-loading').hidden = true;
    $('ts-gate').hidden = false;
    if (!soundPref) { $('ts-quiet').textContent = 'Enter with sound'; $('ts-gate').querySelector('small').textContent = 'Sound off, as you left it'; }
    $('ts-enter').focus({ preventScroll: true });
  }
  refreshTimes();

  // a hook for the headless checks: hold the sequence at a time after Enter
  window.__title = {
    get state() { return state; }, begin, skip, select: i => select(i, true), dests,
    hold(t) { if (state === 'gate') begin(false); frozen = { now: tBegin + t, t }; for (const c of cues) if (!c.done && c.t <= t && !c.sound) { c.done = true; c.fn(); } },
    release() { frozen = null; },
    dive(i, play) { dive(dests[i], play); },
    // draw one frame at time t after Enter, and stop the page drawing on its own
    still(t) { manual = true; cancelAnimationFrame(raf); this.hold(t); frame(true); },
    timing: { T_RISE, PULL_A, PULL_D }, earth,
  };

  function api() {
    return {
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        for (const f of off) f();
        for (const t of later) clearTimeout(t);
        clearInterval(clockTimer); clearInterval(sunTimer);
        ro.disconnect();
        A.stop(0.5);
        earth.dispose();
        if (window.__title) delete window.__title;
      },
    };
  }
  return api();
};
