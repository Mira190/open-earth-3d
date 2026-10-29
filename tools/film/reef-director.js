// The reef film's director, run inside web/reef/index.html by tools/city_film.js for a film whose
// "engine" is "reef" (e.g. cities/whitsundays/film.json, the Great Barrier Reef). The reef plays on:
// the sea, the tide, the fish, turtles and boats. The director takes the camera (as the viewer's
// ctx.controller), the model clock (ctx.setClock: sun, moon, tide and lamps follow it) and the
// exposure; a director's boat can be sailed along a line, and the camera can swim beside an animal.
// Time is virtual (tools/film/clock.js), so each frame is drawn on demand, 1/fps after the last.
//
// A shot names its `site` (the tool opens reef/index.html?city=<site> for each run of shots on one
// site). Positions are the site's local metres [x east, y north, z up about mean sea level; z < 0 is
// under water], as in web/data/<site>/scene.json and its `pois`.
//   move   {from, to, look | lookFrom/lookTo}          a straight dolly, crane or flyover
//   orbit  {at, az: [from, to], dist, h}               round a point; az is the compass bearing of the camera from it
//   track  {boat: {vessel, from, to, speed} | animal: {species, near}, az, dist, h}
//          beside a boat the director sails from `from` to `to` (az relative to its course), or an animal
//          of `species`, the nearest to `near` when the shot starts (az relative to its heading)
// Other fields: under (keep the lens below the surface), clear (m above the waves, default 1.2), lookUp,
// lookAhead, hand, ease, fov, time (["HH:MM"] or a time-lapse ["HH:MM", "HH:MM"], local), date, fadeIn,
// fadeOut, ev, tint, sat.
// The grade is applied as the frame is taken from the canvas: exposure (ev, through the renderer's
// own tone mapping), white balance (tint), saturation (sat), a light vignette, and fades from black.
'use strict';
window.OEReefDirector = (function () {
  const RAD = Math.PI / 180;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    linear: t => t,
    glide: t => { const a = 0.18; return t < a ? t * t / (2 * a * (1 - a)) : t > 1 - a ? 1 - (1 - t) * (1 - t) / (2 * a * (1 - a)) : (t - a / 2) / (1 - a); },
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    smooth: t => t * t * t * (t * (6 * t - 15) + 10),
  };
  const ch = (v, k, e) => (Array.isArray(v) ? lerp(v[0], v[1], e(k)) : v);
  const minutes = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const nz = (t, seed) => { let v = 0, a = 1; for (let o = 0; o < 3; o++) { v += Math.sin(t * (0.9 + o * 1.7) * (1 + seed * 0.13) + seed * 7.1 + o * 2.3) * a; a *= 0.5; } return v / 1.75; };

  let R, ctx, cam, V3, spec, cur = null, baseExp = 1, year = 2026, grade = { f: 1, tint: [1, 1, 1], sat: 1 };
  let pos, look, out, g2;

  function setup(s) {
    spec = s;
    R = window.__reef; ctx = R.ctx; cam = R.camera;
    V3 = cam.position.constructor;
    pos = new V3(); look = new V3();
    year = s.year || 2026;
    baseExp = R.renderer.toneMappingExposure;
    for (const id of ['hud', 'load', 'err']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    cam.near = 0.2; cam.far = 90000;
    // the camera is the director's: the viewer's fly keys are off while a controller is set
    ctx.controller = { update() { cam.position.copy(pos); cam.lookAt(look); } };
    // the frame as it is taken: the canvas, graded, vignetted and faded on a 2D canvas the size of the film
    out = document.createElement('canvas');
    out.width = s.size[0]; out.height = s.size[1];
    g2 = out.getContext('2d');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute';
    svg.innerHTML = '<filter id="oe-grade" color-interpolation-filters="sRGB"><feColorMatrix id="oe-grade-m" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>';
    document.body.appendChild(svg);
    return { site: ctx.site, shots: spec.shots.filter(q => q.site === ctx.site).length };
  }

  function shotAt(t) {
    let s = spec.shots[0];
    for (const q of spec.shots) if (t >= q.t0 - 1e-6) s = q;
    return s;
  }
  const W = p => new V3(p[0], p[2], -p[1]);

  function enter(s) {
    if (s.site !== ctx.site) console.warn('film: shot', s.id, 'is on', s.site, 'but the page is', ctx.site);
    s.vessel = null; s.prey = null; s.hd = null; s.ap = null;
    if (s.boat) s.vessel = sail(s);
  }

  // a boat the director sails: taken off its route and moved along the shot's line at its speed, its wake built up first
  function sail(s) {
    const b = s.boat, B = ctx.boats;
    const v = B && (B.byName(b.vessel) || B.vessels.find(x => x.kind === b.vessel));
    if (!v) { console.warn('film: no boat', b.vessel); return null; }
    v.mode = 'static'; v.ai = null;
    if (b.sails && v.sail) { v.sail.want = b.sails; v.snapSails && v.snapSails(); }
    const L = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1]);
    v.film = { ux: (b.to[0] - b.from[0]) / L, uy: (b.to[1] - b.from[1]) / L, from: b.from, speed: b.speed || 6, t0: s.t0 };
    v.hdg = Math.atan2(v.film.ux, v.film.uy);
    v.speed = v.film.speed;
    // the wake: run the boat up to its mark for a few seconds before the shot
    const pre = b.pre ?? 8, dt = 1 / 24;
    for (let i = Math.round(pre / dt); i > 0; i--) { moveBoat(v, s.t0 - i * dt); B.update(dt); }
    return v;
  }
  function moveBoat(v, t) {
    const f = v.film, d = (t - f.t0) * f.speed;
    v.x = f.from[0] + f.ux * d; v.z = -(f.from[1] + f.uy * d);
    v.hdg = Math.atan2(f.ux, f.uy); v.speed = f.speed;
  }

  // the nearest animal of a species (or of any of a list) to a point, among those the life module simulates round the camera
  function findAnimal(sp, near) {
    const L = ctx.life;
    if (!L || !L.animals) return null;
    const c = W(near);
    const want = [].concat(sp);
    let best = null, bd = Infinity;
    for (const a of L.animals) { if (!want.includes(a.sp) || a.hidden) continue; const d = (a.x - c.x) ** 2 + (a.y - c.y) ** 2 + (a.z - c.z) ** 2; if (d < bd) { bd = d; best = a; } }
    return best;
  }

  function shotPose(s, k, t) {
    const e = EASE[s.ease || 'glide'];
    if (s.type === 'orbit') {
      const az = ch(s.az, k, e) * RAD, d = ch(s.dist, k, e), h = ch(s.h, k, e), c = W(s.at);
      pos.set(c.x + Math.sin(az) * d, c.y + h, c.z - Math.cos(az) * d);
      look.copy(s.look ? W(s.look) : c);
    } else if (s.type === 'move') {
      pos.lerpVectors(W(s.from), W(s.to), e(k));
      if (s.look) look.copy(W(s.look));
      else look.lerpVectors(W(s.lookFrom), W(s.lookTo), e(k));
    } else if (s.type === 'track') {
      let cx, cy, cz, hd;
      if (s.vessel) { cx = s.vessel.x; cy = s.vessel.y; cz = s.vessel.z; hd = s.vessel.hdg; }
      else {
        if (!s.prey) s.prey = findAnimal(s.animal.species, s.animal.near);
        const a = s.prey;
        if (!a) { const c = W(s.animal.near); cx = c.x; cy = c.y; cz = c.z; hd = 0; }
        else {
          // the animal's heading, smoothed, so the camera does not swing with every turn of its swim
          const yaw = Math.atan2(Math.cos(a.yaw), Math.sin(a.yaw));
          s.hd = s.hd == null ? yaw : s.hd + Math.atan2(Math.sin(yaw - s.hd), Math.cos(yaw - s.hd)) * 0.04;
          s.ap = s.ap ? s.ap.lerp(new V3(a.x, a.y, a.z), 0.25) : new V3(a.x, a.y, a.z);
          cx = s.ap.x; cy = s.ap.y; cz = s.ap.z; hd = s.hd;
        }
      }
      const az = hd + ch(s.az, k, e) * RAD, d = ch(s.dist, k, e), h = ch(s.h, k, e);
      pos.set(cx + Math.sin(az) * d, cy + h, cz - Math.cos(az) * d);
      look.set(cx, cy + (s.lookUp || 0), cz);
      if (s.lookAhead) { look.x += Math.sin(hd) * s.lookAhead; look.z -= Math.cos(hd) * s.lookAhead; }
    }
    if (s.hand) {
      const tt = t * 0.8, d = pos.distanceTo(look) * 0.004 * s.hand;
      look.x += nz(tt, 1) * d; look.y += nz(tt, 2) * d * 0.7; look.z += nz(tt, 3) * d;
      pos.y += nz(tt, 4) * 0.05 * s.hand;
    }
    // under water, keep the lens clear of the surface; above it, clear of the waves
    const tide = ctx.env.u.tide.value;
    if (s.under) pos.y = Math.min(pos.y, tide - 0.35);
    else if (s.over !== false && pos.y > tide - 0.5) pos.y = Math.max(pos.y, tide + (s.clear ?? 1.2));
  }

  // set the frame at film time t; the viewer's next frame draws it
  function apply(t) {
    const s = shotAt(t);
    const k = clamp((t - s.t0) / s.dur);
    const tm = s.time || ['12:00'], m0 = minutes(tm[0]), m1 = minutes(tm[1] || tm[0]);
    const date = s.date || spec.date || [11, 26];
    const min = lerp(m0, m1, EASE[s.timeEase || 'linear'](k));
    ctx.setClock(Sun.localToUtc(s.year || year, date[0], date[1], min));
    // the tide for the new time now (the viewer sets it as it draws), so a boat sailed into the shot floats at it
    if (ctx.tide && ctx.q.get('tide') === null) ctx.env.u.tide.value = ctx.tide.at(ctx.clockMs());
    if (s !== cur) { cur = s; enter(s); }
    if (s.vessel) moveBoat(s.vessel, t);
    shotPose(s, k, t);
    cam.position.copy(pos); cam.lookAt(look);
    cam.fov = ch(s.fov ?? 40, k, EASE[s.ease || 'glide']);
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    R.renderer.toneMappingExposure = baseExp * (spec.exposure ?? 1) * Math.pow(2, s.ev || 0);
    let f = 1;
    if (s.fadeIn) f = Math.min(f, EASE.smooth(clamp((t - s.t0) / s.fadeIn)));
    if (s.fadeOut) f = Math.min(f, EASE.smooth(clamp((s.t0 + s.dur - t) / s.fadeOut)));
    grade = { f, tint: s.tint || spec.tint || [1, 1, 1], sat: s.sat ?? spec.sat ?? 1, vignette: spec.vignette ?? 0.22 };
    return { shot: s.id, k, tide: +ctx.env.u.tide.value.toFixed(2) };
  }

  // the frame, taken from the canvas just drawn: graded, vignetted and faded
  function grab(q = 0.95) {
    const src = R.renderer.domElement, w = out.width, h = out.height, { f, tint, sat, vignette } = grade;
    // white balance and saturation as one colour matrix (Rec. 709 luma)
    const lr = 0.2126, lg = 0.7152, lb = 0.0722, s = sat;
    const m = [[lr * (1 - s) + s, lg * (1 - s), lb * (1 - s)], [lr * (1 - s), lg * (1 - s) + s, lb * (1 - s)], [lr * (1 - s), lg * (1 - s), lb * (1 - s) + s]];
    const vals = [];
    for (let r = 0; r < 3; r++) vals.push(m[r][0] * tint[r], m[r][1] * tint[r], m[r][2] * tint[r], 0, 0);
    document.getElementById('oe-grade-m').setAttribute('values', vals.join(' ') + ' 0 0 0 1 0');
    g2.filter = (s !== 1 || tint.some(x => x !== 1)) ? 'url(#oe-grade)' : 'none';
    g2.drawImage(src, 0, 0, w, h);
    g2.filter = 'none';
    if (vignette > 0) {
      const gr = g2.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${vignette})`);
      g2.fillStyle = gr; g2.fillRect(0, 0, w, h);
    }
    if (f < 1) { g2.fillStyle = `rgba(0,0,0,${1 - f})`; g2.fillRect(0, 0, w, h); }
    return out.toDataURL('image/jpeg', q);
  }

  return { setup, apply, grab, EASE, get shot() { return cur; } };
})();
