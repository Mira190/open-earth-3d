// The city film's director, run inside the game page by tools/city_film.js. The game plays
// on: crowds walk, ferries cross, the city's lights come on. The director takes the camera
// (through the game's own cine director), the clock and the lens. Time is virtual: the page's
// requestAnimationFrame and performance.now are held by tools/film/clock.js, so each frame is
// drawn on demand, 1/fps of a second after the last, however long software WebGL takes.
//
// A shot (cities/<id>/film.json) is one camera move over `dur` seconds:
//   orbit  {at, az: [from, to], dist, h}      round a point; az is the compass bearing of the camera from it
//   move   {from, to, look | lookFrom/lookTo} a straight dolly, crane or flyover
//   track  {ferry: {route, from, to, s}, az, dist, h}  alongside a ferry under way; az is relative to its course
// Any of dist, h and fov may be a number or [from, to]. Positions are local metres [x east,
// y north, z up]. A shot can run the clock (time: ["17:40", "18:30"] is a time-lapse), put the
// crowd round a point (people: [x, y]), shake like a hand-held camera (hand: 1), fade, and
// take its own exposure (ev), white balance (tint: [r, g, b]) and saturation (sat).
'use strict';
window.OEFilmDirector = (function () {
  const V3 = THREE.Vector3, RAD = Math.PI / 180;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const W = (x, y, z) => new V3(x, z, -y);
  const EASE = {
    linear: t => t,
    // a drone's move: a short ramp in and out, constant speed through the cut
    glide: t => { const a = 0.18; return t < a ? t * t / (2 * a * (1 - a)) : t > 1 - a ? 1 - (1 - t) * (1 - t) / (2 * a * (1 - a)) : (t - a / 2) / (1 - a); },
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    smooth: t => t * t * t * (t * (6 * t - 15) + 10),
  };
  const ch = (v, k, e) => (Array.isArray(v) ? lerp(v[0], v[1], e(k)) : v);
  const minutes = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  // smooth value noise for a hand-held camera
  const nz = (t, seed) => { let v = 0, a = 1; for (let o = 0; o < 3; o++) { v += Math.sin(t * (0.9 + o * 1.7) * (1 + seed * 0.13) + seed * 7.1 + o * 2.3) * a; a *= 0.5; } return v / 1.75; };

  let G, spec, lens, cur = null, fov = 40, year = 2026;
  const pose = { pos: new V3(), look: new V3() };
  const probe = new THREE.PerspectiveCamera(40, 1, 1, 50000);

  function setup(s) {
    spec = s;
    G = window.__game;
    year = s.year || new Date().getUTCFullYear();
    // no title screen, no menus, no crane; the player is off camera
    for (const id of ['g-title', 'g-menu', 'g-bigmap', 'g-pass']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    G.cine.stop();
    G.clock.frozen = true;
    // the whole crowd and all the traffic
    G.crowd.active = G.crowd.P.length;
    if (G.cars && G.cars.C) G.cars.active = G.cars.C.length;
    // the post stack ends on the title's lens: scene, bloom, lens (no ACES, no game grade)
    const comp = G.atmos && G.atmos.composer;
    if (!comp) throw new Error('the film needs the post stack (WebGL2)');
    const bloomAt = comp.passes.findIndex(p => 'strength' in p && 'threshold' in p);
    while (comp.passes.length > bloomAt + 1) comp.removePass(comp.passes[comp.passes.length - 1]);
    lens = new THREE.ShaderPass(OELens.shader());
    comp.addPass(lens);
    lens.uniforms.uGrain.value = s.grain ?? 0;      // grain goes on in the player, not into the encoder
    lens.uniforms.uCA.value = s.ca ?? 0.18;
    lens.uniforms.uVignette.value = s.vignette ?? 0.2;
    // the film's own focal lengths: the game resets the fov to its own each frame
    const cam = G.camera, upm = cam.updateProjectionMatrix.bind(cam);
    cam.updateProjectionMatrix = () => { cam.fov = fov; upm(); };
    cam.near = 1.5; cam.far = 60000;
    // one endless cine shot whose pose the director writes each frame
    G.cine.play(() => pose, 1e9, { label: 'film' });
    return { shots: spec.shots.length };
  }

  function shotAt(t) {
    let s = spec.shots[0];
    for (const q of spec.shots) if (t >= q.t0 - 1e-6) s = q;
    return s;
  }

  // put the crowd on the footways round (x, y), as if they had been walking there all along
  function crowdAround(x, y, r) {
    const C = G.crowd, net = G.footNet, cand = net.near(x, y, 0, r), tmp = {};
    if (!cand.length) return;
    let seed = Math.floor(x * 31 + y * 17) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const p of C.P) {
      if (p.seat) { p.seat.by = -1; p.seat = null; }
      p.state = 'walk'; p.mode = 'ground'; p.lat = null; p.pause = 0; p.dodge = 0;
      p.line = cand[Math.floor(rnd() * cand.length)];
      p.s = rnd() * net.L[p.line].len;
      p.dir = rnd() < 0.5 ? 1 : -1;
      net.at(p.line, p.s, tmp);
      p.x = tmp.x; p.y = tmp.y; p.z = tmp.z;
    }
  }

  // the height of the ground or deck a person would stand on at (x, y)
  function floor(x, y) {
    const nav = G.nav;
    let z0 = Math.max(0, nav.terrain(x, y));
    for (const st of nav.strips) { const h = st.drape ? nav.stripHeight(st, x, y) : null; if (h != null && h > z0) z0 = h; }
    const f = nav.floorAt(x, y, z0 + 1);
    return f ? f.z : z0;
  }
  function enter(s) {
    // "agl": the shot's heights are above the ground (or the deck) below each point, not above the datum
    if (s.agl && !s.agl_done) {
      for (const k of ['from', 'to', 'at', 'look', 'lookFrom', 'lookTo']) if (s[k]) s[k] = [s[k][0], s[k][1], s[k][2] + floor(s[k][0], s[k][1])];
      s.agl_done = true;
    }
    if (s.ferry) s.vessel = cast(s.ferry);
    const a = s.people || s.anchor || (s.vessel ? [s.vessel.x, s.vessel.y] : (s.at || s.look || s.to || s.from).slice(0, 2));
    G.spawn([a[0], a[1]]);
    G.player.speed = 0;
    if (s.people) crowdAround(a[0], a[1], s.crowd_r || 140);
  }

  // put a ferry where the shot needs it: under way on a leg of its route, s metres out
  function cast(f) {
    const vs = (G.fer && G.fer.vessels) || [];
    for (const v of vs) {
      if (f.route && v.route !== f.route) continue;
      if (f.vessel && v.name !== f.vessel) continue;
      const ci = v.cycle.findIndex(c => (c.rev ? c.leg.to : c.leg.from) === f.from && (c.rev ? c.leg.from : c.leg.to) === f.to);
      if (ci < 0) continue;
      Object.assign(v, { ci, phase: 'sail', s: f.s || 0, speed: f.speed || 6, helm: null, lx: null, ly: null });
      return v;
    }
    console.warn('film: no ferry for', JSON.stringify(f));
    return null;
  }

  function shotPose(s, k) {
    const e = EASE[s.ease || 'glide'];
    if (s.type === 'orbit') {
      const az = ch(s.az, k, e) * RAD, d = ch(s.dist, k, e), h = ch(s.h, k, e), c = W(...s.at);
      pose.pos.set(c.x + Math.sin(az) * d, c.y + h, c.z - Math.cos(az) * d);
      pose.look.copy(s.look ? W(...s.look) : c);
      if (s.lookRise) pose.look.y += ch(s.lookRise, k, e);
    } else if (s.type === 'move') {
      pose.pos.lerpVectors(W(...s.from), W(...s.to), e(k));
      if (s.look) pose.look.copy(W(...s.look));
      else pose.look.lerpVectors(W(...s.lookFrom), W(...s.lookTo), e(k));
    } else if (s.type === 'track') {
      const v = s.vessel;
      const vx = v ? v.x : s.at[0], vy = v ? v.y : s.at[1], vh = v ? (v.dir ?? v.h) : 0;
      const az = vh + ch(s.az, k, e) * RAD, d = ch(s.dist, k, e), h = ch(s.h, k, e), c = W(vx, vy, 3);
      pose.pos.set(c.x + Math.sin(az) * d, c.y + h, c.z - Math.cos(az) * d);
      pose.look.copy(s.look ? W(...s.look) : c);
    }
    if (s.hand) { // a hand-held camera: a slow drift of the aim, a touch of float in the position
      const t = (s.t0 + k * s.dur) * 0.8, d = pose.pos.distanceTo(pose.look) * 0.004 * s.hand;
      pose.look.x += nz(t, 1) * d; pose.look.y += nz(t, 2) * d * 0.7; pose.look.z += nz(t, 3) * d;
      pose.pos.y += nz(t, 4) * 0.05 * s.hand;
    }
  }

  // set the frame at film time t; the game's next frame draws it
  function apply(t) {
    const s = shotAt(t);
    if (s !== cur) { cur = s; enter(s); }
    const k = clamp((t - s.t0) / s.dur);
    const tm = s.time || ['12:00'], m0 = minutes(tm[0]), m1 = minutes(tm[1] || tm[0]);
    const date = s.date || spec.date || [3, 21];
    const min = lerp(m0, m1, EASE[s.timeEase || 'linear'](k));
    G.setClock(s.year || year, date[0], date[1], min);
    shotPose(s, k);
    fov = ch(s.fov ?? 40, k, EASE[s.ease || 'glide']);
    G.camera.updateProjectionMatrix(); // the game re-applies its own fov only when it changes, so set the film's here
    // exposure follows the game's own for the light, trimmed by the shot
    const L = lens.uniforms;
    L.uExposure.value = renderer().toneMappingExposure * (spec.exposure ?? 1.1) * Math.pow(2, s.ev || 0);
    const tint = s.tint || spec.tint || [1, 1, 1];
    L.uTint.value.set(tint[0], tint[1], tint[2]);
    L.uSat.value = s.sat ?? spec.sat ?? 1;
    const sp = Sun.position(Sun.localToUtc(s.year || year, date[0], date[1], min));
    // at night the city keeps its blacks: less lift, a firmer curve
    const night = clamp((-sp.altitude - 2) / 8);
    L.uLift.value = 1 - 0.7 * night;
    L.uContrast.value = 0.1 + 0.18 * night;
    L.uAspect.value = innerWidth / innerHeight;
    L.uTime.value = t;
    // fades: in from space black at the head of the film and of a shot that asks, out at the tail
    let f = 1;
    if (s.fadeIn) f = Math.min(f, EASE.smooth(clamp((t - s.t0) / s.fadeIn)));
    if (s.fadeOut) f = Math.min(f, EASE.smooth(clamp((s.t0 + s.dur - t) / s.fadeOut)));
    L.uFade.value = f;
    // the flare, when the sun is in shot and not behind a building
    const alt = sp.altitude * RAD, az = sp.azimuth * RAD;
    const dir = new V3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    probe.fov = fov; probe.aspect = innerWidth / innerHeight; probe.updateProjectionMatrix();
    probe.position.copy(pose.pos); probe.lookAt(pose.look); probe.updateMatrixWorld();
    const on = OELens.sunOnScreen(probe, dir);
    let vis = 0;
    if (on.front && sp.altitude > -1 && on.u > -0.1 && on.u < 1.1 && on.v > -0.1 && on.v < 1.1) {
      const lx = pose.pos.x, ly = -pose.pos.z, lz = pose.pos.y;
      vis = Sun.sunlit(G.DSM, lx, ly, lz, sp) ? clamp((sp.altitude + 1) / 3) : 0;
    }
    L.uSunUv.value.set(on.u, on.v);
    L.uSunVis.value = vis * (s.flare ?? 1);
    L.uFlareTint.value.setRGB(1, 0.62 + 0.25 * clamp(sp.altitude / 20), 0.42 + 0.4 * clamp(sp.altitude / 25));
    G.player.rig.root.visible = false;
    return { shot: s.id, k };
  }
  const renderer = () => G.atmos.composer.renderer;

  // the director's plan: the city from straight above with every shot's camera path, where it
  // looks, and a check that the camera is clear of the buildings and can see what it looks at
  function plan(px = 1600) {
    const D = G.DSM, sc = G.atmos.composer.passes[0].scene, rd = renderer();
    const x0 = D.x0, x1 = D.x0 + D.nx * D.cell, y1 = D.y1, y0 = D.y1 - D.ny * D.cell;
    const w = px, h = Math.round(px * (y1 - y0) / (x1 - x0));
    G.setClock(year, 3, 21, 12 * 60);
    const cam = new THREE.OrthographicCamera(x0, x1, -y0, -y1, -5000, 5000); // looking down -y in three.js: x right, -z (north) up
    cam.position.set(0, 3000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    cam.left = x0; cam.right = x1; cam.top = y1; cam.bottom = y0; cam.updateProjectionMatrix();
    const size = rd.getSize(new THREE.Vector2());
    rd.setSize(w, h, false);
    rd.render(sc, cam);
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g = c2.getContext('2d');
    g.drawImage(rd.domElement, 0, 0, w, h);
    rd.setSize(size.x, size.y, false);
    const X = x => (x - x0) / (x1 - x0) * w, Y = y => (y1 - y) / (y1 - y0) * h;
    const dsm = (x, y) => { const c = Math.floor((x - x0) / D.cell), r = Math.floor((y1 - y) / D.cell); return c < 0 || r < 0 || c >= D.nx || r >= D.ny ? 0 : D.data[r * D.nx + c]; };
    const report = [];
    const hues = [0, 35, 60, 130, 190, 230, 280, 320];
    spec.shots.forEach((s, i) => {
      cur = s; enter(s);
      const col = `hsl(${hues[i % hues.length]}, 90%, 55%)`;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3; g.font = 'bold 18px sans-serif';
      let minClear = Infinity, blocked = 0, n = 0;
      g.beginPath();
      for (let j = 0; j <= 12; j++) {
        const k = j / 12;
        if (s.ferry) { for (let f = 0; f < (j ? s.dur * 24 / 12 : 1); f++) G.fer.update(1 / 24, 1, s.t0 + k * s.dur); }
        shotPose(s, k);
        const px_ = pose.pos.x, py_ = -pose.pos.z, pz = pose.pos.y, lx = pose.look.x, ly = -pose.look.z, lz = pose.look.y;
        j ? g.lineTo(X(px_), Y(py_)) : g.moveTo(X(px_), Y(py_));
        minClear = Math.min(minClear, pz - dsm(px_, py_));
        // the line of sight: blocked if a roof stands above it between 4 % and 60 % of the way (a landmark looked at may stand round the point)
        const L = Math.hypot(lx - px_, ly - py_, lz - pz);
        for (let q = 0.04; q < 0.6; q += 2 / L) { const x = px_ + (lx - px_) * q, y = py_ + (ly - py_) * q, z = pz + (lz - pz) * q; if (dsm(x, y) > z) { blocked++; break; } }
        n++;
      }
      g.stroke();
      shotPose(s, 0.5);
      g.setLineDash([6, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(pose.pos.x), Y(-pose.pos.z)); g.lineTo(X(pose.look.x), Y(-pose.look.z)); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(X(pose.look.x), Y(-pose.look.z), 5, 0, 7); g.fill();
      shotPose(s, 0);
      g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText(s.id, X(pose.pos.x) + 6, Y(-pose.pos.z) - 6); g.fillText(s.id, X(pose.pos.x) + 6, Y(-pose.pos.z) - 6);
      report.push({ id: s.id, clearance_m: +minClear.toFixed(1), blocked_samples: `${blocked}/${n}` });
    });
    cur = null;
    return { png: c2.toDataURL('image/jpeg', 0.9), report };
  }

  return { setup, apply, plan, EASE, get lens() { return lens; } };
})();
