// Open Earth 3D's title screen, cut like a film's opening.
//
// Boot: the stars come up first, with a counter and the name of each file as it loads
// (the Earth's textures are a few megabytes). Then it starts on its own, without sound,
// since browsers allow sound only after a click or a key; a Sound button brings the score in
// where the shot has got to. While the textures load the Earth is a pale dot in front of the
// Milky Way's core, some 250,000 km out. Then the camera falls towards it, the sky wheeling
// round as it lines up on the night side, and pitches up out of the dive onto the horizon:
// one unbroken move from deep space to low orbit, about five seconds. The cold open then runs
// about nine seconds more. The camera crosses the real night side of the Earth, low over the brightest stretch of city lights that the
// terminator is about to reach: dawn's, or dusk's when the night before dawn is open ocean.
// It runs towards the real sun until the sun clears the limb: a riser, then a hit, a flare,
// and the title. Then the camera pulls back to the whole planet and the menu comes in. Any
// key or click skips straight to the menu.
//
// The picture is as good as the device affords (quality.js). A frame of the sunlit side is
// rendered and read back before the opening; if it comes out black the pipeline steps down,
// and if it is still black, or the device has no WebGL 2, or the GPU drops the context twice,
// the menu runs over a still picture of the Earth instead of a black screen.
//
// The menu lists the places most worked on first (Tokyo, Kyoto while it is live, Sydney), then the rest of Japan, and the other live
// destinations after it in the order the sun reaches them; it opens framed on Japan, with one
// button that goes straight into the Shibuya game (docs/HOMEPAGE.md). Choosing one
// turns the globe to it; a card gives its figures, local time and sun, and the camera dives
// to it as the model loads. Later visits in the same session get a short version; coming
// back from a city pulls out from it.
'use strict';
window.OpenEarthGlobe = async function title(cities, notice, from) {
  const $ = id => document.getElementById(id);
  const E = window.OEEarth, A = window.OEScore, S = window.Sun, V3 = THREE.Vector3, RAD = Math.PI / 180;
  const app = $('globe-app'), stage = $('globe-stage'), canvas = $('globe-gl');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // what this device can draw; why: what put it on the still picture, if anything did
  const Q = window.OEQuality, tier = Q.tier();
  let mode = tier.name, drawing = mode !== 'still', why = mode === 'still' && !Q.probe().gl2 ? 'this browser has no WebGL 2' : '';
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
  let earth;
  try {
    earth = mode === 'still' ? E.still()
      : E.create({ canvas, month: new Date(t0).getUTCMonth() + 1, q: tier.settings, onProgress: loading, onLost: contextLost, onRestored: contextRestored });
  } catch (e) {
    console.warn('title: the Earth cannot be drawn here', e);
    mode = 'still'; drawing = false; why = 'WebGL failed to start';
    earth = E.still();
  }
  if (mode === 'still') app.classList.add('fallback');
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
    const meta = cs[0].group_meta || null;
    dests.push({ id: `group-${name}`, name, native: meta && meta.native, country: cs[0].country, lat, lon, tz: cs[0].timezone, c: cs[0], sites: cs, meta });
  }
  // the places most worked on first: Tokyo, Kyoto (while it is on the globe), Sydney, then the rest of
  // Japan; the others after it in the order the sun reaches them, east to west
  const LEAD = ['Tokyo', 'Kyoto', 'Sydney'];
  const rank = d => { const k = LEAD.indexOf(d.name); return k >= 0 ? k : d.country === 'Japan' ? LEAD.length : LEAD.length + 1; };
  dests.sort((a, b) => rank(a) - rank(b) || Math.round(b.lon) - Math.round(a.lon) || live.indexOf(a.c) - live.indexOf(b.c));
  // the point the menu opens on: between Tokyo and Kyoto, over Honshu (on Tokyo while Kyoto is parked)
  const jp = dests.filter(d => LEAD.includes(d.name) && d.country === 'Japan');
  const JAPAN = jp.length ? { lat: jp.reduce((a, d) => a + d.lat, 0) / jp.length, lon: jp.reduce((a, d) => a + d.lon, 0) / jp.length } : null;
  const totalBuildings = live.reduce((a, c) => a + (c.buildings || 0), 0);
  for (const d of dests) {
    d.beacon = earth.addCity(d.lat, d.lon);
    d.dir = E.ll(d.lat, d.lon);
  }
  const lang = d => (d.id === 'hong-kong' ? 'zh-Hant' : 'ja');
  const escH = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
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
      state: alt > 0 ? 'up' : alt > -6 ? 'tw' : 'night', word: alt > 0 ? 'sun up' : alt > -6 ? 'twilight' : 'night' };
  }

  // One list, city then district: a city of several playable maps (Tokyo) names them on a line under its
  // row, each one press into its game. One of them is where the visitor starts, and carries the page's one
  // amber mark: the map of the game last played in this browser (Continue), or for a new visitor the first
  // map of the first such city (Play). P with nothing chosen presses it. The line shows under that city
  // until another place is chosen, and under a chosen city of several maps.
  const START = ['shibuya', 'tokyo'];
  const first = c => START.indexOf(c.id) + 1 || 99;
  const saves = live.filter(c => c.game).map(c => {
    try { const g = JSON.parse(store.get(`oe3d-game-${c.id}`) || 'null'); return g && (g.pos || g.qs) ? { c, at: g.at || 0, stamps: g.qs && g.qs.stamps ? g.qs.stamps.length : 0 } : null; } catch (e) { return null; }
  }).filter(Boolean).sort((x, y) => y.at - x.at || first(x.c) - first(y.c));
  const resume = saves[0] || null;
  const destOf = c => dests.find(d => d.c === c || (d.sites && d.sites.includes(c)));
  const leadDest = resume ? destOf(resume.c) : dests.find(d => d.sites && d.sites.some(c => c.game));
  const startMap = resume ? resume.c : leadDest ? leadDest.sites.filter(c => c.game).sort((x, y) => first(x) - first(y))[0] : null;
  const maps = d => (d.sites ? d.sites.filter(c => c.game) : d === leadDest ? [d.c] : []).sort((x, y) => (y === startMap) - (x === startMap) || first(x) - first(y));
  const GO = resume ? 'Continue' : 'Play';
  // (a city that is one map has no district to name: its line says what is kept there)
  const dn = c => (destOf(c).sites ? escH(c.district || c.name) : resume && resume.stamps ? `${resume.stamps} stamp${resume.stamps > 1 ? 's' : ''} in your passport` : 'Your game');
  const mapBtn = c => (c === startMap
    ? `<button class="ts-d ts-go" data-hero="${c.id}" aria-label="${GO} ${escH(c.district || c.name)}"><span>${dn(c)}</span><em>${GO}<kbd>P</kbd></em></button>`
    : `<button class="ts-d" data-hero="${c.id}" aria-label="Play ${dn(c)}"><span>${dn(c)}</span></button>`);
  const list = $('ts-list');
  list.innerHTML = dests.map((d, i) => {
    const p = progress(d), ms = maps(d);
    return `<li style="--i:${i + 1}"${d === leadDest ? ' class="lead"' : ''}><button class="ts-item" data-i="${i}" aria-label="${d.name}, ${d.country}">
      <span class="n">${pad(i + 1)}</span><span class="nm">${d.name}${nativeName(d)}</span><span class="tm"><i></i><span></span></span>${p.visited ? '<span class="vis" title="Visited"></span>' : ''}</button>${
      ms.length ? `<div class="ts-sub">${ms.map(mapBtn).join('')}</div>` : ''}</li>`;
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
  // on a phone the list is a strip of names with no room under one: the start sits on a slim line over it
  const heroEl = $('ts-hero');
  if (heroEl && startMap) {
    const nm = escH(startMap.district || startMap.name);
    heroEl.innerHTML = `<button class="ts-d ts-go" data-hero="${startMap.id}" aria-label="${GO} ${nm}"><span>${nm}${startMap.native ? `<small lang="ja">${escH(startMap.native)}</small>` : ''}</span><em>${GO}</em></button>`;
    heroEl.hidden = false;
  }
  on(list.parentElement, 'click', e => {
    const b = e.target.closest('[data-hero]'); if (!b) return;
    const c = cities.find(x => x.id === b.dataset.hero), d = destOf(c);
    lastInput = performance.now();
    if (d) dive(d, true, d.sites ? c : undefined);
  });
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

  // ------------------------------------------------------------ the camera
  const pose = { pos: new V3(0, 0, 6), look: new V3(), up: new V3(0, 1, 0), fov: 30 };
  function apply(p) {
    cam.position.copy(p.pos);
    cam.up.copy(p.up);
    cam.lookAt(p.look);
    if (Math.abs(cam.fov - p.fov) > 1e-3) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
  }
  // the menu's orbit: the camera on a sphere round the earth, looking at its centre
  const orb = { lat: 10, lon: 135, dist: 4.6, fov: 28, tlat: 10, tlon: 135, tdist: 4.6, vlat: 0, vlon: 0, pitch: 0, tpitch: 0, roll: 0, troll: 0 };
  // The menu opens on Japan. On a wide screen it is a low orbit's view, not the whole disc: the camera
  // stands over the Philippine Sea, south-west of Honshu and less than two radii up, and looks north to
  // the limb, so the Earth's curve and its air cross the top of the frame, Japan lies in the middle of
  // the globe's side of it and Asia runs off under the list; the horizon leans a few degrees. (The whole
  // disc at night was a small patch of lights with the black Pacific over two fifths of the picture.) On
  // a phone it is the disc, tilted, over the strip of places. Whatever the hour it is Japan's real sky:
  // noon, a dusk with the terminator across it, or the lights at night.
  // Without Japan on the list it falls back to the Asia-Pacific, turned a little towards the sun.
  let home = true; // still on the opening view: the idle drift sways round it instead of carrying it off
  const HOME_TILT = 9, HOME = { south: 21, west: 12, dist: 2.6, pitch: 12, roll: -5 };
  const low = () => !narrow() && home && JAPAN && sel < 0; // the low orbit's view
  const homeLon = () => JAPAN.lon - (narrow() ? 0 : HOME.west);
  function homeView() {
    home = true;
    setShift();
    if (JAPAN) {
      orb.tlat = JAPAN.lat - (narrow() ? HOME_TILT : HOME.south); orb.tlon = homeLon(); orb.tdist = homeDist();
      return;
    }
    const c = dests.reduce((a, d) => a.add(d.dir), new V3()).normalize();
    const m = c.addScaledVector(earth.sun, 0.55).normalize(), g = E.latlon(m);
    orb.tlat = clamp(g.lat, -30, 30); orb.tlon = g.lon; orb.tdist = fitDist();
  }
  // a phone: close enough that Japan fills the middle of the frame and the globe's limb still shows
  function homeDist() { return !JAPAN ? fitDist() : narrow() ? fitDist() * 0.68 : HOME.dist; }
  function fitDist(scale = 1) {
    const v = orb.fov * RAD, h = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
    const half = Math.min(v, narrow() ? h : v) / 2;
    return 1 / Math.sin(half * (narrow() ? 0.8 : 0.9) * scale);
  }
  const _op = new V3();
  function orbitPose(o, out = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 }) {
    E.ll(o.lat, o.lon, o.dist, out.pos);
    out.look.set(0, 0, 0);
    out.up.set(0, 1, 0);
    // pitched up from the Earth's centre towards the northern limb, and rolled about the line of sight
    if (Math.abs(o.pitch) > 1e-3 || Math.abs(o.roll) > 1e-3) {
      const p = _op.copy(out.pos).normalize(), n = out.look.set(0, 1, 0).addScaledVector(p, -p.y).normalize();
      n.multiplyScalar(o.dist * Math.tan(o.pitch * RAD));
      out.up.applyAxisAngle(_op.copy(out.look).sub(out.pos).normalize(), o.roll * RAD);
    }
    out.fov = o.fov;
    return out;
  }
  // the globe sits off-centre, clear of the list: right of it on a wide screen, above it on a phone
  // (the opening view on Japan a little further right, as its globe is drawn larger)
  function setShift() {
    shift.tx = narrow() ? 0 : low() ? 0.04 : 0.13;
    shift.ty = narrow() ? 0.13 : 0;
    orb.tpitch = low() ? HOME.pitch : 0; orb.troll = low() ? HOME.roll : 0;
  }
  function layout() {
    setShift();
    if (state === 'menu') orb.tdist = sel >= 0 ? fitDist(0.92) : home ? homeDist() : fitDist();
  }

  // ------------------------------------------------------------ the cold open, planned on the real sky
  const Y = new V3(0, 1, 0);
  const arc = (Sd, P, th, out = new V3()) => out.copy(Sd).multiplyScalar(Math.cos(th * RAD)).addScaledVector(P, Math.sin(th * RAD));
  const T_RISE = 4.0, V_ARC = 2.1, TAU = 0.9, R0 = 1.165;
  // the fall from deep space: from T_IN seconds before the night pass starts, done T_JOIN after
  const T_IN = 4.8, T_JOIN = 1.0, BOOT_R = 40;
  const ramp = t => t - TAU * (1 - Math.exp(-t / TAU)); // starts still, settles to full speed
  let plan = null;
  // The camera's path is a great circle through the sun's direction; P is where it crosses the
  // terminator. Dawn is the idea (the earth's turn carries P into the sun), but when the night
  // before the dawn line is open ocean the shot flies to dusk instead: flying from the night
  // towards the terminator, the sun clears the limb ahead either way. Dusk has to be clearly
  // brighter to win.
  const DUSK_WINS = 1.5;
  function planOpen() {
    const Sd = earth.sun.clone();
    const n0 = Y.clone().addScaledVector(Sd, -Y.dot(Sd)).normalize();
    const best = { dawn: null, dusk: null };
    for (let az = 0; az < 360; az += 5) {
      const P = n0.clone().applyAxisAngle(Sd, az * RAD); // where the camera's path crosses the terminator
      const turn = new V3().crossVectors(Y, P).dot(Sd);
      if (Math.abs(turn) < 0.2) continue; // near the poles the terminator barely moves
      const side = turn > 0 ? 'dawn' : 'dusk';
      const lat = E.latlon(P).lat;
      let score = 0;
      for (let th = 93; th <= 124; th += 1.5) {
        for (const off of [-7, -3.5, 0, 3.5, 7]) {
          const q = arc(Sd, P, th).applyAxisAngle(Sd, off * RAD);
          score += earth.lightsAt(q) * (th < 104 ? 1.6 : 1);
        }
      }
      score *= 1 - 0.7 * smooth((Math.abs(lat) - 48) / 20);
      if (!best[side] || score > best[side].score) best[side] = { P, score };
    }
    const dawnScore = best.dawn ? best.dawn.score : 0, duskScore = best.dusk ? best.dusk.score : 0;
    const dusk = duskScore > DUSK_WINS * dawnScore;
    const pick = dusk ? best.dusk : best.dawn;
    const P = pick ? pick.P : n0;
    const r = t => R0 + 0.04 * smooth(t / 10);
    // the hit lands as the sun clears the dense air at the limb (about 40 km up)
    const crit = t => 180 - Math.asin(1.006 / r(t)) / RAD;
    const thRise = crit(T_RISE) - 0.4;
    const thHold = thRise + V_ARC * ramp(T_RISE);
    const nadir = arc(Sd, P, thHold);
    return { S: Sd, P, r, thRise, thHold, nadir: E.latlon(nadir), dawn: E.latlon(P), dusk, dawnScore, duskScore };
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
  // deep space while the textures load: the Earth a dot in front of the Milky Way's core, the
  // frame turning slowly round it
  function bootPose(t, out = pose) {
    const core = E.ll(-29, 266.4 - E.gmst(Date.now()), 1);
    out.pos.copy(core).multiplyScalar(-BOOT_R);
    out.look.set(0, 0, 0);
    out.up.set(0, 1, 0).applyAxisAngle(core, t * 0.01);
    out.fov = 46;
    return out;
  }
  // the fall from the boot shot onto the night pass, t seconds after Enter (from -T_IN): the
  // distance falls geometrically, so the Earth grows at an even rate rather than all at the end;
  // the camera swings round onto the night side while it is still far out, the frame rolling
  // towards the coming heading, and then pitches up out of the dive onto the horizon
  const _night = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 };
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), O = new V3();
  function approachPose(t, out = pose) {
    const from = plan.from, to = nightPose(t, _night);
    const s = span(t, -T_IN, T_JOIN);
    const r0 = from.pos.length(), r1 = to.pos.length();
    const da = from.pos.clone().normalize(), db = to.pos.clone().normalize();
    const axis = new V3().crossVectors(da, db);
    if (axis.lengthSq() > 1e-10) _qt.setFromAxisAngle(axis.normalize(), da.angleTo(db) * smooth(span(s, 0, 0.62))); else _qt.identity();
    const dir = da.applyQuaternion(_qt);
    out.pos.copy(dir).multiplyScalar(r0 * Math.pow(r1 / r0, smooth(s)));
    // looking at the centre: the boot's up carried round with the camera, turned to the heading
    const fwd = to.look.clone().sub(to.pos).normalize(), view = dir.clone().negate();
    const upA = from.up.clone().applyQuaternion(_qt), head = fwd.clone().addScaledVector(view, -fwd.dot(view));
    if (head.lengthSq() > 1e-6) upA.lerp(head.normalize(), smooth(span(s, 0.2, 0.62)));
    if (upA.lengthSq() < 1e-6) upA.copy(head);
    _qa.setFromRotationMatrix(_m4.lookAt(out.pos, O, upA));
    _qb.setFromRotationMatrix(_m4.lookAt(out.pos, fwd.clone().add(out.pos), to.up));
    _qa.slerp(_qb, smooth(span(s, 0.55, 1)));
    out.look.set(0, 0, -1).applyQuaternion(_qa).add(out.pos);
    out.up.set(0, 1, 0).applyQuaternion(_qa);
    out.fov = lerp(from.fov, to.fov, smooth(s));
    return out;
  }
  // the pull-back from the sunrise to the menu's orbit, over d seconds from time a
  const PULL_A = T_RISE + 2.5, PULL_D = 6.4;
  const _a = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 }, _b = { pos: new V3(), look: new V3(), up: new V3(), fov: 0 };
  // From one pose to another round the globe, with no lurch and no tumble. The camera turns
  // round the globe only while it is far out, where a turn reads as the globe turning and not as
  // the ground racing past: going out, it rises first and turns after; coming in, it turns
  // first and falls after. The camera's orientation is carried round with it and eased from the
  // first pose's to the second's as one rotation, so the frame never rolls over.
  function blendPose(a, b, k, out = pose) {
    const ra = a.pos.length(), rb = b.pos.length(), inbound = ra > rb * 1.5;
    const da = a.pos.clone().normalize(), db = b.pos.clone().normalize();
    const kd = smooth(inbound ? span(k, 0, 0.65) : span(k, 0.25, 1));
    const kr = smooth(inbound ? k : span(k, 0, 0.78));
    const ko = smooth(inbound ? span(k, 0.15, 1) : span(k, 0, 0.72));
    const axis = new V3().crossVectors(da, db);
    if (axis.lengthSq() > 1e-10) _qt.setFromAxisAngle(axis.normalize(), da.angleTo(db) * kd); else _qt.identity();
    out.pos.copy(da).applyQuaternion(_qt).multiplyScalar(ra * Math.pow(rb / ra, kr));
    _qa.setFromRotationMatrix(_m4.lookAt(a.pos, a.look, a.up)).premultiply(_qt);
    _qb.setFromRotationMatrix(_m4.lookAt(out.pos, b.look, b.up));
    _qa.slerp(_qb, ko);
    out.look.set(0, 0, -1).applyQuaternion(_qa).add(out.pos);
    out.up.set(0, 1, 0).applyQuaternion(_qa);
    out.fov = lerp(a.fov, b.fov, ko);
    return out;
  }
  // frame a destination up and to the left of the globe's centre, clear of its card
  function frameOn(d) {
    home = false;
    setShift();
    orb.tlat = clamp(d.lat - (narrow() ? 12 : 10), -55, 55);
    orb.tlon = d.lon + (narrow() ? 0 : 16);
    orb.tdist = fitDist(0.92);
  }
  // where the menu's orbit starts: framed on Japan, with no card open until one is asked for
  function menuStart() {
    homeView();
    orb.lat = orb.tlat; orb.lon = orb.tlon; orb.dist = orb.tdist; orb.pitch = orb.tpitch; orb.roll = orb.troll;
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
  function minutesSinceSunset(lat, lon, t) {
    for (let m = 0; m <= 900; m += 2) if (S.position(t - m * 60000, lat, lon).altitude > -0.833) return m;
    return null;
  }
  const hm = m => `${m >= 60 ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min`;

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
  const INK = '#f4f1ea', GLOW = '0 0 40px rgba(255, 190, 120, 0.18)'; // the wordmark's colour and glow (title.css .ts-title .w)
  function titleFx(t) {
    const a = T_RISE + 0.1, narrowW = narrow();
    const out = smooth(span(t, PULL_A + 0.7, PULL_A + 1.7));
    titleEl.style.opacity = String(1 - out);
    titleEl.style.transform = `translateY(-50%) scale(${(1 - 0.04 * out).toFixed(4)})`;
    // The blurs here are text shadows under transparent letters, not CSS filters. A filter gives each letter a
    // layer of its own, re-made every frame as its radius changes, and Safari on an iPhone drew those layers'
    // edges for a frame or two: a magenta line down the screen beside the last letters, and the outline of their boxes.
    wordEl.style.color = out > 0.001 ? 'transparent' : '';
    wordEl.style.textShadow = out > 0.001 ? `0 0 ${(out * 6).toFixed(2)}px ${INK}` : '';
    titleEl.style.setProperty('--scrim', smooth(span(t, a, a + 1.6)).toFixed(3));
    const track = lerp(narrowW ? 0.5 : 0.9, narrowW ? 0.22 : 0.34, expoOut(span(t, a, a + 3.8)));
    wordEl.style.letterSpacing = `${track.toFixed(4)}em`;
    wordEl.style.marginRight = `${(-track).toFixed(4)}em`;
    letters.forEach((el, i) => {
      const k = span(t, a + i * 0.045, a + i * 0.045 + 1.3), e = easeOut(k);
      el.style.opacity = smooth(k).toFixed(3);
      el.style.color = e < 0.999 ? 'transparent' : '';
      el.style.textShadow = e < 0.999 ? `0 0 ${(14 * (1 - e)).toFixed(2)}px ${INK}, ${GLOW}` : '';
      el.style.transform = e < 0.999 ? `translateY(${(0.18 * (1 - e)).toFixed(3)}em)` : '';
    });
    subEl.style.opacity = smooth(span(t, a + 0.7, a + 2.1)).toFixed(3);
    tallyEl.style.opacity = smooth(span(t, a + 1.6, a + 3.0)).toFixed(3);
    barsEl.style.setProperty('--bar', (smooth(span(t, -1.6, 0.4)) * (1 - smooth(span(t, PULL_A + 1.3, PULL_A + 2.9)))).toFixed(4));
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
    store.set('oe3d-title', String(Date.now()), true);
    store.set('oe3d-sound', withSound ? 'on' : 'off');
    soundOn = withSound && A.start(true); // without sound, no audio context until the visitor asks for one
    setSoundUi();
    state = 'open';
    menuStart();
    plan.nadir = E.latlon(arc(plan.S, plan.P, plan.thHold));
    plan.dawn = E.latlon(plan.P);
    plan.from = bootPose(clock() - bootAt, { pos: new V3(), look: new V3(), up: new V3(), fov: 0 });
    app.classList.add('started', 'opening');
    $('ts-hear').hidden = false;
    tBegin = clock() + T_IN; // the sequence's clock: the fall runs from -T_IN, the night pass from 0
    const at = A.now() + T_IN;
    if (soundOn && !reduced) { A.drone(2.2 + T_IN); A.riser(at + T_RISE, 3.2); A.hit(at + T_RISE + 0.03); }
    const d = new Date();
    cue(-T_IN + 0.5, () => decode($('ts-cap1'), `Live · ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`, 800));
    const nd = plan.nadir, wait = plan.dusk ? minutesSinceSunset(nd.lat, nd.lon, Date.now()) : minutesToSunrise(nd.lat, nd.lon, Date.now());
    const when = wait == null ? '' : plan.dusk ? ` · sunset ${hm(wait)} ago` : ` · sunrise in ${hm(wait)}`;
    cue(1.3, () => decode($('ts-cap2'), `Night below · ${fmtLat(nd.lat)} ${fmtLon(nd.lon)}${when}`, 1100));
    cue(T_RISE + 0.1, () => decode($('ts-cap3'), `${plan.dusk ? 'Sunset' : 'Sunrise'} · ${fmtLat(plan.dawn.lat)} ${fmtLon(plan.dawn.lon)} · now`, 900));
    cue(PULL_A + 2.8, () => showMenu());
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
    transition(from, reduced ? 0 : 2.6);
    state = 'menu';
    app.classList.remove('opening');
  }
  // a short blend from a pose into the orbit
  let trans = null;
  function transition(fromPose, dur) { trans = { from: fromPose, t0: clock(), dur }; }

  function showMenu() {
    app.classList.add('menu');
    menuShownAt = clock();
    postcards();
  }
  // postcards from the road (postcards.js): what Mugi has sent since the last visit joins the album here, and
  // the menu shows none of it; each map's passport lists its own
  let postAsked = false;
  function postcards() {
    if (postAsked || !window.OEPostcards || manual) return;
    postAsked = true;
    const T = window.OETelemetry;
    OEPostcards.collect(cities.filter(c => c.built && c.game)).then(came => { if (came.length && T && T.track) T.track('postcards_came', { new: came.length }); }).catch(e => console.warn('Postcards unavailable:', e));
  }
  let menuShownAt = 0;

  // ------------------------------------------------------------ the menu
  // A hover previews a destination without opening its card: its row lights and the others dim,
  // its mark lights on the globe, and the globe turns to it. Leaving the list turns it back to the
  // chosen destination, or to where it was before the hover. The turn waits a beat, so a pointer
  // crossing the list on its way somewhere else does not swing the globe.
  let hoverT = 0, preHover = null, listHot = -1;
  function hover(i, turn = false) {
    if (hot !== i) {
      hot = i;
      for (const d of dests) d.mark.classList.toggle('hot', dests.indexOf(d) === i || dests.indexOf(d) === sel);
      items.forEach((b, k) => b.classList.toggle('hot', k === i));
      list.classList.toggle('hovering', i >= 0);
    }
    // only a hover on the list turns the globe: a mark on the globe would move from under the pointer
    if (!turn || listHot === i) return;
    listHot = i;
    clearTimeout(hoverT);
    if (state !== 'menu' || fullOpen() || narrow()) return;
    lastInput = performance.now();
    if (i >= 0) {
      hoverT = setTimeout(() => {
        if (listHot !== i || state !== 'menu' || fullOpen()) return;
        if (!preHover) preHover = { tlat: orb.tlat, tlon: orb.tlon, tdist: orb.tdist };
        orb.vlon = orb.vlat = 0;
        frameOn(dests[i]);
      }, 110);
    } else if (preHover) {
      hoverT = setTimeout(() => {
        if (listHot >= 0 || state !== 'menu' || !preHover) return;
        if (sel >= 0) frameOn(dests[sel]);
        else { orb.tlat = preHover.tlat; orb.tlon = preHover.tlon; orb.tdist = preHover.tdist; }
        preHover = null;
      }, 220);
    }
  }
  function select(i, fromUser = false, quiet = false) {
    if (state === 'dive') return;
    // nothing is picked before the menu shows: a pointer resting where the (still invisible) list
    // will be would otherwise bring a card up over the opening's title
    if (!app.classList.contains('menu')) return;
    if (i === sel && fromUser) return;
    closeFull(true);
    sel = i; preHover = null;
    items.forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
    for (const d of dests) d.mark.classList.toggle('hot', dests.indexOf(d) === i);
    if (fromUser || !quiet) A.tick(2100, 0.035);
    const d = dests[i];
    frameOn(d);
    focusDir.copy(d.dir);
    showCard(d);
  }
  // The place itself behind its card: a still of the map as it is played now (web/plates, tools/plates.sh),
  // full bleed, at the hour it is there (day, dusk or night by the real sun), on a slow push in. The globe
  // turns to the place first and the picture comes up over it; Esc, or the dive, gives the globe back.
  const plateEl = $('ts-plate');
  let plates = null, plateOn = '', plateSide = 0;
  const plateList = () => plates || (plates = fetch('plates/index.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})));
  function hidePlate() {
    plateOn = '';
    for (const l of plateEl.children) l.className = '';
    app.classList.remove('plated');
  }
  async function showPlate(id, d) {
    const P = await plateList(), e = id && P[id];
    if (sel < 0 || dests[sel] !== d) return;
    if (!e) { hidePlate(); return; }
    const alt = sunAt(d, Date.now()).alt, when = alt > 9 ? 'day' : alt > -5 ? 'dusk' : 'night';
    const src = `plates/${id}-${e.times.includes(when) ? when : e.times[0]}.webp`;
    if (src === plateOn) return;
    plateOn = src;
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch (err) { if (plateOn === src) hidePlate(); return; }
    if (plateOn !== src) return;
    const next = plateEl.children[plateSide ^= 1], prev = plateEl.children[plateSide ^ 1];
    next.style.backgroundImage = `url("${src}")`;
    next.style.backgroundPosition = e.focus || '50% 50%';
    next.className = ''; void next.offsetWidth; next.className = 'on';
    prev.className = '';
    app.classList.add('plated');
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
    const metro = d.meta && d.meta.kind === 'metro';
    // a city of a few districts, without a map of its own (Melbourne: the centre and the bayside)
    const city = d.meta && d.meta.kind === 'city';
    // a travel guide's card, as a game's location card reads: a line that sells the place, the sights
    // to see, a local custom and the best hour to come (cities/guide.json), not the data behind the model
    const g = (d.meta && d.meta.guide) || (!d.sites && d.c.guide) || {};
    const best = g.best ? `<div><dt>Best at</dt><dd class="best">${escH(g.best[0])}<small>${escH(g.best[1] || '')}</small></dd></div>` : '';
    const stats = metro
      ? `<div><dt>Districts</dt><dd>${d.meta.districts.filter(s => s.map).length}${d.meta.districts.some(s => !s.map) ? `<small>of ${d.meta.districts.length} open</small>` : '<small>all open</small>'}</dd></div>${best}`
      : best;
    const prog = p.stamps ? `${p.stamps} stamp${p.stamps > 1 ? 's' : ''} in your passport` : p.visited ? 'Visited' : '';
    const hook = c => escH((c.guide && c.guide.hook) || c.tagline || '');
    const actions = metro ? metroHTML(d)
      : city ? `<span class="ts-k ts-where">Where to go</span><ul class="ts-sites ts-districts">${d.sites.map(c => `<li><button data-site="${c.id}" aria-label="${c.district || c.name}: explore in 3D"><b>${c.district || c.name}</b><small>${hook(c)}</small></button>${c.game ? `<button class="ts-dplay" data-site="${c.id}" data-go="play" aria-label="Play ${c.district || c.name}">Play</button>` : ''}</li>`).join('')}</ul>`
      : d.sites ? `<span class="ts-k ts-where">Where to go</span><ul class="ts-sites">${d.sites.map(c => `<li><button data-site="${c.id}"><b>${c.name}</b><small>${hook(c)}</small></button></li>`).join('')}</ul>`
      : `<div class="ts-actions">${d.c.game ? '<button class="ts-btn primary" data-go="play">Play <kbd>P</kbd></button>' : ''}<button class="ts-btn" data-go="model">Explore in 3D <kbd>↵</kbd></button></div>`;
    const line = g.line || (d.sites ? '' : d.c.tagline || '');
    const spots = g.spots && g.spots.length ? `<div class="ts-spots"><span class="ts-k">Must see</span><ol>${g.spots.map(([n, t], i) => `<li style="--i:${i}"><i>${String(i + 1).padStart(2, '0')}</i><b>${escH(n)}</b><span>${escH(t)}</span></li>`).join('')}</ol></div>` : '';
    const local = g.local ? `<p class="ts-local"><span class="ts-k">${escH(g.local[0])}</span>${escH(g.local[1])}</p>` : '';
    card.innerHTML = `<div><span class="eb">${d.country} · ${fmtLat(d.lat)} ${fmtLon(d.lon)}</span><h2>${d.name}${d.native ? `<small lang="${lang(d)}">${d.native}</small>` : ''}</h2></div>
      ${line ? `<p class="sum">${escH(line)}</p>` : ''}${spots}${local}
      <dl class="ts-stats">${stats}<div><dt>Local time</dt><dd data-k="time"></dd></div><div><dt>Sun</dt><dd data-k="sun"></dd></div></dl>
      ${prog ? `<span class="ts-prog">${prog}</span>` : ''}${actions}`;
    fillStats(d);
    card.scrollTop = 0;
    card.classList.toggle('metro', !!metro);
    // (its map opens on the district the list leads with: Shibuya, or the one last played)
    const want = metro && maps(d)[0], at = want ? d.meta.districts.findIndex(x => x.map === want.id) : -1;
    if (metro) metroPick(d, metroSel[d.id] ?? (at >= 0 ? at : d.meta.districts.findIndex(x => x.map)));
    else showPlate(d.sites ? null : d.id, d);
    card.classList.remove('on', 'has-film');
    void card.offsetWidth;
    card.classList.add('on');
    // the city's film, if it has one (film.js); a group of sites has one film, named after the group
    if (window.OEFilm) OEFilm.card(card, d.sites ? { id: d.id.replace(/^group-/, '').toLowerCase().replace(/\W+/g, '-'), name: d.name, country: d.country, game: false } : d.c,
      { go: play => (d.sites ? dive(d, false, d.sites[0]) : dive(d, play)) });
  }
  const metroClick = e => {
    if (e.target.closest('[data-close]')) { closeFull(); return; }
    if (e.target.closest('[data-full]')) { if (sel >= 0) openFull(dests[sel]); return; }
    const ch = e.target.closest('[data-chip]');
    if (ch && sel >= 0) { metroPick(dests[sel], +ch.dataset.chip, true); return; }
    const svg = e.target.closest('.ts-metro svg');
    // on a phone the card's map is too small to aim at: a touch on it opens it full screen
    if (svg && sel >= 0 && !svg.closest('.ts-mfull') && matchMedia('(pointer: coarse)').matches) { openFull(dests[sel]); return; }
    if (svg && sel >= 0) {
      const st = e.target.closest('[data-district]');
      const i = e.detail === 0 && st ? +st.dataset.district : metroNearest(dests[sel], svg, e.clientX, e.clientY);
      if (i >= 0) metroPick(dests[sel], i, true);
      return;
    }
    const b = e.target.closest('button');
    if (!b || sel < 0) return;
    if (b.dataset.map) dive(dests[sel], b.dataset.go === 'play', cities.find(c => c.id === b.dataset.map), b.dataset.arrive);
    else if (b.dataset.site) dive(dests[sel], b.dataset.go === 'play', cities.find(c => c.id === b.dataset.site));
    else dive(dests[sel], b.dataset.go === 'play');
  };
  on(card, 'click', metroClick);
  // A first click opens the card; only a second click on the same destination goes in. A click focuses
  // its button before it lands, and the focus selects (focusin, below), so what counts is what was
  // selected when the pointer went down: without that one click went straight in and the card,
  // with its Play button or Tokyo's subway map, was never seen.
  let downSel = null;
  on(list, 'pointerdown', e => { downSel = e.target.closest('.ts-item') ? sel : null; });
  on(list, 'click', e => {
    const b = e.target.closest('.ts-item'); if (!b) return;
    lastInput = performance.now();
    const i = +b.dataset.i, was = downSel ?? sel;
    downSel = null;
    if (i === was && !narrow()) goFrom(dests[i]); else select(i, true);
  });
  // going in from the list: a city straight in; a group of maps never to a default one, but to the
  // card, where its districts (Tokyo's subway map) or sites are chosen
  function goFrom(d) {
    if (!d.sites) { dive(d, false); return; }
    if (d.meta && d.meta.kind === 'metro') { openFull(d); return; }
    const to = card.querySelector('.mt-stn.sel') || card.querySelector('.mt-stn.on') || card.querySelector('[data-site]');
    if (to) to.focus({ preventScroll: true });
  }
  // a card comes up only when asked for (a click, a tap or the keyboard), never on a hover or by itself
  on(list, 'pointerover', e => { const b = e.target.closest('.ts-item'); if (b && e.pointerType !== 'touch') hover(+b.dataset.i, true); });
  on(list, 'pointerleave', () => hover(-1, true));
  on(list, 'focusin', e => { const b = e.target.closest('.ts-item'); if (b && state === 'menu') select(+b.dataset.i, true); });

  // the dive: down onto the city, faster and faster, into the dark where the model loads
  let diving = null;
  // ------------------------------------------------------------ a group drawn as a subway map (Tokyo)
  // The districts are maps of their own, as games draw Tokyo (Persona 5's subway map, where a station
  // is a district to go to): the lines and stations at their real positions, each built map's extent
  // shaded behind its stations, the districts still to build in grey. Choosing a station shows what
  // is there and goes in at that district.
  // (the map itself, its picking and its full-screen view are metro.js, shared with the game and the
  // 3D model; the title keeps the card's copy in step and dims the globe behind the full-screen one)
  const metroSel = {};
  const metroHTML = d => OEMetro.map(d, cities);
  const metroNearest = (d, svg, x, y) => OEMetro.nearest(d, svg, x, y);
  function metroPick(d, i, byUser = false) {
    if (!d.meta.districts[i]) return;
    metroSel[d.id] = i;
    if (byUser) A.tick(2600, 0.03);
    OEMetro.pick(app, d, i, cities, { byUser });
    if (sel >= 0 && dests[sel] === d) showPlate(d.meta.districts[i].map, d);
  }
  // ------------------------------------------------------------ the subway map, full screen
  // The globe dims and leans in behind it (metro.js draws it)
  let fullCtl = null;
  const fullOpen = () => !!(fullCtl && fullCtl.el.isConnected);
  function openFull(d) {
    if (!d || !d.meta || d.meta.kind !== 'metro' || fullOpen()) return;
    app.classList.add('metro-full');
    A.tick(1500, 0.04);
    orb.tdist = fitDist(0.92) * 0.82; // the globe leans in behind the map
    fullCtl = OEMetro.full({
      host: stage, g: d, cities, sel: metroSel[d.id] ?? d.meta.districts.findIndex(x => x.map), backLabel: 'Back to the globe',
      onPick: (i, byUser) => metroPick(d, i, byUser),
      onGo: (c, play, arrive) => dive(d, play, c, arrive),
      onClose: quiet => {
        fullCtl = null;
        app.classList.remove('metro-full');
        if (sel >= 0 && !quiet) frameOn(dests[sel]);
      },
    });
  }
  function closeFull(quiet = false) { if (fullCtl) fullCtl.close(quiet); }
  on(card, 'keydown', e => { const st = e.target.closest('[data-district]'); if (st && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); metroPick(dests[sel], +st.dataset.district, true); } });

  function dive(d, play, site, arrive) {
    if (state === 'dive' || (state !== 'menu' && state !== 'open')) return;
    if (state === 'open') skip();
    closeFull(true);
    state = 'dive';
    if (window.OEFilm) OEFilm.stopPreview();
    app.classList.add('diving');
    A.confirm();
    A.whoosh(reduced ? 0.4 : 1.7);
    const target = site || d.c;
    const go = () => {
      if (manual) return; // the film tool ends on the black
      if (target.viewer) location.href = `${target.viewer}?city=${target.id}`;
      else location.hash = play ? `play-${target.id}${arrive ? `@${arrive}` : ''}` : target.id;
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
    preHover = null; drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    orb.vlat = orb.vlon = 0;
  });
  on(canvas, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = 0.16 * orb.dist / 4.6, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const dt = Math.max(1, performance.now() - drag.t);
    orb.tlon -= dx * k; orb.tlat = clamp(orb.tlat + dy * k, -65, 65);
    if (home && Math.abs(dx) + Math.abs(dy) > 2) { home = false; setShift(); }
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
    home = false; setShift();
    e.preventDefault();
  }, { passive: false });
  on(window, 'keydown', e => {
    if (!running || e.metaKey || e.ctrlKey || e.altKey) return;
    lastInput = performance.now();
    if (!$('ts-about').hidden) { if (e.key === 'Escape') toggleAbout(false); return; }
    if (state === 'open') { if (e.target.closest && e.target.closest('button')) return; e.preventDefault(); skip(); return; } // a key on Sound or Skip is that button's
    if (state !== 'menu' || fullOpen()) return; // (the full-screen map has the keys: metro.js)
    const k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 's' || k === 'arrowright') { e.preventDefault(); select((sel + 1 + dests.length) % dests.length, true); items[sel].focus({ preventScroll: true }); }
    else if (k === 'arrowup' || k === 'w' || k === 'arrowleft') { e.preventDefault(); select((sel - 1 + dests.length) % dests.length, true); items[sel].focus({ preventScroll: true }); }
    else if (k === 'enter' && sel >= 0 && !e.target.closest('.ts-card, .ts-top, .ts-foot')) { e.preventDefault(); const d = dests[sel]; const mb = card.querySelector('[data-map][data-go="model"]'); if (mb) mb.click(); else if (d.sites) card.querySelector('[data-site]').focus(); else dive(d, false); }
    else if (k === 'p' && sel >= 0 && dests[sel].sites && card.querySelector('[data-map][data-go="play"]')) card.querySelector('[data-map][data-go="play"]').click();
    else if (k === 'p' && sel >= 0 && dests[sel].sites && card.querySelector('.ts-dplay')) card.querySelector('.ts-dplay').focus();
    else if (k === 'p' && sel >= 0 && dests[sel].c.game && !dests[sel].sites) dive(dests[sel], true);
    else if (k === 'p' && sel < 0 && startMap) list.parentElement.querySelector('.ts-go').click();
    else if (k === 'f' && sel >= 0 && window.OEFilm && OEFilm.hasReel()) OEFilm.openReel();
    else if (k === 'escape' && sel >= 0) { sel = -1; items.forEach(b => b.setAttribute('aria-current', 'false')); card.classList.remove('on'); hidePlate(); homeView(); for (const d of dests) d.mark.classList.remove('hot'); }
  });
  on($('ts-skip'), 'click', e => { e.stopPropagation(); skip(); });
  // sound during the opening: the score joins the shot where it has got to
  let scored = false;
  on($('ts-hear'), 'click', e => {
    e.stopPropagation();
    if (A.on) { A.setMuted(true); store.set('oe3d-sound', 'off'); setSoundUi(); return; }
    A.start(true); A.setMuted(false);
    store.set('oe3d-sound', 'on');
    const t = clock() - tBegin, at = A.now();
    if (!scored && state === 'open' && t < T_RISE - 0.6 && !reduced) { A.drone(1.2); A.riser(at + T_RISE - t, Math.min(3.2, T_RISE - t)); A.hit(at + T_RISE - t + 0.03); }
    else A.pad();
    scored = soundOn = true;
    setSoundUi();
  });
  on(stage, 'pointerdown', e => { if (state === 'open' && !e.target.closest('button')) skip(); });

  // sound in the menu
  function setSoundUi() {
    for (const [b, l] of [['ts-sound', 'ts-sound-l'], ['ts-hear', 'ts-hear-l']]) {
      $(b).setAttribute('aria-pressed', String(A.on));
      $(l).textContent = A.on ? 'Sound on' : 'Sound off';
    }
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
  const menuEl = stage.querySelector('.ts-menu'), topEl = stage.querySelector('.ts-top'), footEl = stage.querySelector('.ts-foot');
  function placeMarks() {
    const w = stage.clientWidth, h = stage.clientHeight;
    // project every label, read their widths in one go, then write: one layout a frame, not one a label
    const all = dests.map(d => [d.mark, d.dir, true]);
    // on a narrow screen the menu lies over the foot of the Earth and the header over its top: a place under
    // either has no label (half of one showed above the Play button, cut by it)
    const slim = narrow(), sr = slim ? stage.getBoundingClientRect() : null;
    const floor = slim ? menuEl.getBoundingClientRect().top - sr.top - 16 : Infinity, roof = slim ? topEl.getBoundingClientRect().bottom - sr.top + 10 : -Infinity;
    const at = all.map(([el, p]) => {
      _n.copy(p).normalize();
      const facing = _n.dot(_v.copy(cam.position).sub(p).normalize());
      _v.copy(p).project(cam);
      const y = (-_v.y * 0.5 + 0.5) * h;
      return { facing, x: (_v.x * 0.5 + 0.5) * w, y, vis: facing > 0.12 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05 && y > roof && y < floor && (slim || y < h - 26) }; // (a label half off the foot of a wide screen is not drawn)
    });
    // widths that do not depend on how the label was drawn last frame: the name alone, and the name with
    // the chosen place's coordinates (measured once while they show). Read as drawn, a label that lost its
    // coordinates for being too wide measured narrow, got them back, measured wide again: on a phone it
    // flickered every frame with half of it off the screen
    const widths = all.map(([el], i) => {
      if (!at[i].vis) return [0, 0];
      const co = el.querySelector('.co'), cw = co ? co.offsetWidth : 0, ww = el.offsetWidth;
      if (cw) el._cow = cw + 4;
      const name = ww - (cw ? el._cow : 0);
      return [name, name + (el.classList.contains('hot') ? el._cow || 0 : 0)];
    });
    all.forEach(([el, , always], i) => {
      const { facing, x, y, vis } = at[i];
      if (!vis) { if (!el.hidden) el.hidden = true; return; }
      el.hidden = false;
      // a label that would run off the right edge goes on the other side of its point; the chosen place's
      // coordinates go first when they make it too wide; one that fits on neither side (a long name on a
      // phone) keeps its tick and loses its text
      const back = el.classList.contains('plan') ? -6 : 20, fits = v => x + v + 10 <= w - 12 || x - v - back >= 12;
      const noco = widths[i][1] > widths[i][0] && !fits(widths[i][1]);
      el.classList.toggle('noco', noco);
      const lw = widths[i][noco ? 0 : 1];
      const right = x + lw + 10 <= w - 12, left = x - lw - back >= 12, flip = !right && (left || x > w / 2);
      el.classList.toggle('flip', flip);
      el.dataset.cramped = right || left ? '' : '1';
      el.style.transform = `translate(${(flip ? x - lw - back : x).toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.dataset.x = x.toFixed(1); el.dataset.y = y.toFixed(1);
      el.style.opacity = String(Math.min(always ? 1 : 0.9, (facing - 0.12) / 0.25));
    });
    // a label that would overlap one already placed loses its text (its tick stays): the chosen
    // city first, then the others
    const order = dests.map((d, i) => ({ el: d.mark, pri: i === sel ? 0 : i === hot ? 1 : 2 }))
      .filter(o => !o.el.hidden).sort((x, y) => x.pri - y.pri);
    // the list, an open card and the foot's lines are text already: a label that would lie on one loses its text
    // (the places to come are named once, in the foot, and not on the globe as well)
    const keep = slim ? [] : [menuEl, ...footEl.children, ...(card.classList.contains('on') ? [card] : [])].filter(e => !e.hidden).map(e => e.getBoundingClientRect()).filter(r => r.width);
    const placed = [];
    const over = r => keep.some(q => r.left < q.right + 14 && r.right + 14 > q.left && r.top < q.bottom + 8 && r.bottom + 8 > q.top);
    const hits = r => over(r) || placed.some(q => r.left < q.right + 6 && r.right + 6 > q.left && r.top < q.bottom + 2 && r.bottom + 2 > q.top);
    for (const o of order) {
      let r = o.el.getBoundingClientRect();
      let clash = !!o.el.dataset.cramped || hits(r);
      // two places close together (Tokyo and Kyoto from orbit): try the label on the other side first
      if (clash && !o.el.dataset.cramped && o.el.dataset.x) {
        const x = +o.el.dataset.x, y = +o.el.dataset.y, lw = r.width, back = o.el.classList.contains('plan') ? -6 : 20, flip = !o.el.classList.contains('flip');
        const nx = flip ? x - lw - back : x;
        if (nx >= 12 && nx + lw <= stage.clientWidth - 12) {
          const moved = new DOMRect(r.left + (nx - (flip ? x : x - lw - back)), r.top, r.width, r.height);
          if (!hits(moved)) { o.el.classList.toggle('flip', flip); o.el.style.transform = `translate(${nx.toFixed(1)}px, ${y.toFixed(1)}px)`; r = moved; clash = false; }
        }
      }
      o.el.classList.toggle('mute', clash);
      if (!clash) placed.push(r);
    }
  }

  // the load's stages for the telemetry (telemetry.js markOf): textures in (earth.js), decoded and sent to the GPU,
  // the first frame (the stars, while the earth loads), and ready: the first frame of the opening or the menu
  const stageMark = s => { try { performance.mark(`oe:${s}`, { detail: { view: 'globe', city: '' } }); } catch (e) { /* no User Timing */ } };
  let firstFrame = true, shown = false;
  let lastT = performance.now() / 1000;
  let manual = false; // the film tool draws frames itself
  function frame(force) {
    if (!running) return;
    if (manual && force !== true) return;
    if (!manual) raf = requestAnimationFrame(frame);
    if (app.classList.contains('film-open') && force !== true) return; // a city's film covers the Earth: don't draw it (film.js)
    const now = clock();
    const dt = Math.min(0.1, Math.max(0, now - lastT));
    lastT = now;
    const L = earth.lens;
    if (state === 'boot' || state === 'gate') {
      // the stars come up while the earth loads: a pale dot before the Milky Way's core
      apply(bootPose(now - bootAt, pose));
      if (plan) { earth.ready.value = Math.min(1, earth.ready.value + dt * 0.5); earth.earth.uLights.value = 3.6; }
      L.uExposure.value = NIGHT_EXP;
      L.uFade.value = Math.min(1, L.uFade.value + dt * 0.45);
    } else if (state === 'open') {
      const t = frozen != null ? frozen.t : now - tBegin;
      for (const c of cues) if (!c.done && t >= c.t) { c.done = true; c.fn(); }
      titleFx(t);
      if (t < T_JOIN) apply(approachPose(t, pose));
      else if (t < PULL_A) apply(nightPose(t, pose));
      else {
        nightPose(t, _a);
        orbitPose(orb, _b);
        apply(blendPose(_a, _b, span(t, PULL_A, PULL_A + PULL_D), pose));
        shift.x = shift.tx * smooth(span(t, PULL_A + 0.5, PULL_A + PULL_D));
        shift.y = shift.ty * smooth(span(t, PULL_A + 0.5, PULL_A + PULL_D));
        applyShift();
      }
      // the height above the ground, counting down through the fall until the night's caption takes the line
      if (t > -T_IN + 1.0 && t < 1.3) $('ts-cap2').textContent = `Altitude · ${fmtN(Math.round((cam.position.length() - 1) * 637.1) * 10)} km`;
      // the eye: open for the night, stopped down as the sun arrives, a burst of glare at the hit
      // the eye stops down as the glow grows, before the sun is out, so it arrives soft, not blown
      const rise = span(t, T_RISE - 1.4, T_RISE + 1.2);
      L.uExposure.value = lerp(NIGHT_EXP, 0.92, smooth(rise)) * (t > PULL_A ? lerp(1, menuExposure() / 0.92, smooth(span(t, PULL_A, PULL_A + PULL_D))) : 1);
      if (t < T_JOIN) {
        // falling in: stopped down for the sunlit disc as it grows, open again for the night
        const s = span(t, -T_IN, T_JOIN);
        L.uExposure.value = lerp(lerp(NIGHT_EXP, menuExposure(), smooth(span(s, 0, 0.3))), NIGHT_EXP, smooth(span(s, 0.5, 0.92)));
      }
      earth.bloom.strength = lensBase.bloom + 0.1 * Math.exp(-Math.pow((t - T_RISE - 0.3) / 0.7, 2));
      earth.earth.uLights.value = lerp(3.6, 3.4, smooth(span(t, PULL_A, PULL_A + PULL_D)));
      L.uFlash.value = 0;
      L.uFade.value = Math.min(1, L.uFade.value + dt * 0.8);
      earth.ready.value = Math.min(1, earth.ready.value + dt * 0.8);
    } else if (state === 'menu') {
      // the orbit: damped towards its targets, with inertia after a drag and a slow drift when idle
      if (!drag) {
        orb.tlon += orb.vlon * dt; orb.tlat = clamp(orb.tlat + orb.vlat * dt, -65, 65);
        orb.vlon *= Math.exp(-dt * 3); orb.vlat *= Math.exp(-dt * 3);
        // idle: on the opening view the globe sways a few degrees either side of Japan; elsewhere it drifts
        if (!reduced && performance.now() - lastInput > 9000) {
          if (home && JAPAN && sel < 0) orb.tlon = homeLon() + 3 * Math.sin((performance.now() - lastInput - 9000) / 1000 * 0.07);
          else orb.tlon -= dt * 1.4;
        }
      }
      const kk = 1 - Math.exp(-dt * (trans ? 6 : 3.2));
      let dl = orb.tlon - orb.lon; dl = ((dl + 540) % 360) - 180;
      orb.lon += dl * kk; orb.lat += (orb.tlat - orb.lat) * kk; orb.dist += (orb.tdist - orb.dist) * kk;
      orb.pitch += (orb.tpitch - orb.pitch) * kk; orb.roll += (orb.troll - orb.roll) * kk;
      orbitPose(orb, _b);
      if (trans) {
        const k = trans.dur ? clamp((now - trans.t0) / trans.dur) : 1;
        apply(blendPose(trans.from, _b, k, pose));
        if (k >= 1) trans = null;
      } else apply(_b);
      shift.x += (shift.tx - shift.x) * kk; shift.y += (shift.ty - shift.y) * kk;
      applyShift();
      L.uExposure.value += (menuExposure() - L.uExposure.value) * (1 - Math.exp(-dt * 1.5));
      L.uFlare.value += (0.1 - L.uFlare.value) * kk; // under the menu a flare is a distraction, and its streak reads as a scratch
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
    if (drawing) earth.render(performance.now());
    if (firstFrame) { firstFrame = false; stageMark('frame'); }
    if (!shown && state !== 'boot') { shown = true; stageMark('ready'); }
    if (state === 'menu' || state === 'dive' || (state === 'open' && app.classList.contains('menu'))) placeMarks();
  }
  // a night view wants the eye open a little wider than a day one
  function menuExposure() {
    const e = cam.position.clone().normalize().dot(earth.sun);
    return lerp(1.3, 0.95, smooth((e + 0.35) / 0.8));
  }

  // ------------------------------------------------------------ the picture
  // a still of the Earth behind the menu, for a device that cannot draw it live
  function goStill(reason) {
    mode = 'still'; drawing = false; why = reason;
    app.classList.add('fallback');
    renderPicture();
  }
  // a lost context (the GPU took its memory back) shows the still until three.js has it back,
  // one step down; a second loss stays on the still
  function contextLost(n) {
    drawing = false;
    app.classList.add('fallback');
    if (n >= 2) goStill('the GPU dropped the picture twice');
  }
  function contextRestored() {
    if (mode === 'still') return;
    earth.degrade();
    const st = earth.selfTest();
    if (st.ok) { drawing = true; app.classList.remove('fallback'); } else goStill(`after a lost context the test frame came out ${st.why}`);
    renderPicture();
  }
  function renderPicture() {
    const c = Q.probe(), st = earth.stats();
    const gpu = (c.renderer.match(/(Apple [^,)]*|Mali[^,)]*|Adreno[^,)]*|PowerVR[^,)]*|Intel[^,)]*|NVIDIA [^,(]*|GeForce[^,(]*|Radeon[^,(]*|AMD [^,(]*|SwiftShader|llvmpipe)/i) || [c.renderer || 'unknown GPU'])[0].trim();
    $('ts-pic-now').textContent = mode === 'still'
      ? `${Q.NAMES.still}${why ? ` · ${why}` : ''}`
      : `${Q.NAMES[mode]}${tier.chosen ? '' : ', chosen for this device'} · ${gpu} · ${st.pixelRatio.toFixed(2)}× pixels · about ${st.gpuMB} MB of graphics memory`;
    for (const b of $('ts-pic').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.q || null) === Q.override()));
  }
  on($('ts-pic'), 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Q.setOverride(b.dataset.q || null);
    location.reload();
  });

  // ------------------------------------------------------------ start
  let bootAt = performance.now() / 1000;
  ro.observe(stage);
  resize();
  earth.lens.uFade.value = 0;
  raf = requestAnimationFrame(frame);
  // the opening seen in this tab in the last quarter of an hour: the short version
  const seen = +store.get('oe3d-title', true) || 0, returning = seen > 0 && Date.now() - seen < 15 * 60e3;
  const back = from && dests.find(d => d.id === from || (d.sites && d.sites.some(c => c.id === from)));
  try { await earth.load(); } catch (e) { console.warn('title: textures', e); }
  if (!running) return api();
  stageMark('decoded');
  if (mode !== 'still') {
    if (earth.renderer.getContext().isContextLost()) {
      // lost while the textures went up (memory runs short then): the still holds until the
      // context comes back, and contextRestored() tests it; a context that stays away is given up
      after(6000, () => { if (!drawing && mode !== 'still') goStill('the GPU did not give the picture back'); });
    } else {
      let st = earth.selfTest();
      if (!st.ok && earth.degrade()) st = earth.selfTest();
      if (!st.ok) goStill(`the test frame came out ${st.why}`);
    }
  }
  renderPicture();
  plan = planOpen();
  earth.ready.value = 0;
  earth.lens.uFade.value = 0;
  if (reduced || returning || back || mode === 'still') {
    // straight to the menu: from the city just left, or a pull-in from further out (over the
    // still picture there is no shot to film)
    if (!seen) store.set('oe3d-title', String(Date.now()), true);
    const fromBoot = bootPose(clock() - bootAt, { pos: new V3(), look: new V3(), up: new V3(), fov: 0 });
    app.classList.add('started', 'menu');
    state = 'menu';
    menuStart();
    if (back) {
      frameOn(back); // turned to the city just left, its card closed until it is clicked
      focusDir.copy(back.dir);
      orb.lat = orb.tlat; orb.lon = orb.tlon;
      transition({ pos: E.ll(back.lat, back.lon, 1.02), look: new V3(), up: new V3(0, 1, 0), fov: 50 }, reduced ? 0 : 2.6);
    } else {
      // from the dot in deep space, straight in to the globe without a cut
      transition(fromBoot, reduced ? 0 : 3.6);
    }
    menuShownAt = clock();
    earth.ready.value = 1;
    if (store.get('oe3d-sound') === 'on') $('ts-sound').classList.add('nudge'); // sound was on last time: the browser needs a click to start it
    setSoundUi();
    showMenu();
  } else {
    // ready: it starts on its own (the film tool and the checks hold it here with __titleManual)
    state = 'gate';
    $('ts-loading').hidden = true;
    if (!window.__titleManual) begin(false);
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
    timing: { T_IN, T_RISE, PULL_A, PULL_D }, earth,
    // the opening's plan for another moment (for checks across the day), and what is being drawn
    plan(utcMs) { earth.setTime(utcMs); const p = planOpen(); earth.setTime(Date.now()); return { dusk: p.dusk, dawnScore: p.dawnScore, duskScore: p.duskScore, nadir: p.nadir, terminator: p.dawn }; },
    get picture() { return { mode, why, auto: tier.auto, chosen: tier.chosen, caps: Q.probe(), stats: earth.stats() }; },
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
