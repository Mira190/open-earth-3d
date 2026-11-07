// HUD pieces: the minimap (heading-up, with the GPS route), the full map, the ride app's map, the
// dialogue box (typewriter lines with a voice beep per character, Short Hike style),
// toasts and HTML labels. The map is drawn once from the same data as the 3D scene:
// water mask, building footprints, parks and roads.
'use strict';
window.OEHud = (function () {
  const $ = s => document.querySelector(s);
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ------------------------------------------------------------ base map, 1 px = 2 m
  function baseMap(D) {
    const G = D.G, f = D.scene.frame, PX = 2, w = Math.round((f.x[1] - f.x[0]) / PX), h = Math.round((f.y[1] - f.y[0]) / PX);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const X = x => (x - f.x[0]) / PX, Y = y => (f.y[1] - y) / PX;
    g.fillStyle = css('--gm-land'); g.fillRect(0, 0, w, h);
    // water from the 5 m mask
    const wm = G.water, bytes = typeof wm.bits === 'string' ? Uint8Array.from(atob(wm.bits), c => c.charCodeAt(0)) : wm.bits, img = g.getImageData(0, 0, w, h);
    const wc = new THREE.Color(css('--gm-water'));
    const s = wm.cell / PX;
    for (let r = 0; r < wm.ny; r++) for (let c = 0; c < wm.nx; c++) {
      const k = r * wm.nx + c;
      if (!((bytes[k >> 3] >> (7 - (k & 7))) & 1)) continue;
      for (let yy = Math.floor(r * s); yy < Math.min(h, Math.floor((r + 1) * s)); yy++) for (let xx = Math.floor(c * s); xx < Math.min(w, Math.floor((c + 1) * s)); xx++) {
        const i = 4 * (yy * w + xx);
        img.data[i] = wc.r * 255; img.data[i + 1] = wc.g * 255; img.data[i + 2] = wc.b * 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = css('--gm-park');
    for (const p of D.P.places) for (const poly of p.polygons) {
      g.beginPath();
      for (const ring of poly) { for (let k = 0; k < ring.length; k += 2) { const x = X(ring[k] / 10), y = Y(ring[k + 1] / 10); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }
      g.fill('evenodd');
    }
    g.strokeStyle = css('--gm-road'); g.lineCap = 'round';
    for (const r of G.paths.road) {
      g.lineWidth = { motorway: 7, trunk: 6, primary: 5, secondary: 4.5, tertiary: 4 }[r.c] || 3;
      g.beginPath();
      for (let k = 0; k < r.p.length; k += 3) { const x = X(r.p[k] / 10), y = Y(r.p[k + 1] / 10); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = css('--gm-pier');
    for (const r of D.P.piers || []) { g.beginPath(); for (let k = 0; k < r.length; k += 2) { const x = X(r[k] / 10), y = Y(r[k + 1] / 10); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.fill(); }
    g.fillStyle = css('--gm-bldg');
    for (const sd of D.B.s) {
      const r = sd[4];
      g.beginPath();
      for (let k = 0; k < r.length; k += 2) { const x = X(r[k] / 10), y = Y(r[k + 1] / 10); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.fill();
    }
    return { canvas: cv, X, Y, PX };
  }

  // ------------------------------------------------------------ minimap
  function minimap(canvas, base) {
    const g = canvas.getContext('2d'), S = canvas.width;
    return function draw({ x, y, yaw, heading, radius, route, icons, ride }) {
      const k = (S / 2) / radius * base.PX; // canvas px per base px
      g.save();
      g.clearRect(0, 0, S, S);
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
      g.fillStyle = css('--gm-water'); g.fillRect(0, 0, S, S);
      g.translate(S / 2, S / 2);
      g.rotate(-yaw);
      g.scale(k, k);
      g.translate(-base.X(x), -base.Y(y));
      g.imageSmoothingEnabled = true;
      // only the square of the map the turned minimap can show, not the whole city each frame
      const cv = base.canvas, h = Math.ceil(radius / base.PX * Math.SQRT2) + 4;
      const sx = Math.max(0, Math.floor(base.X(x) - h)), sy = Math.max(0, Math.floor(base.Y(y) - h));
      const sw = Math.min(cv.width, Math.ceil(base.X(x) + h)) - sx, sh = Math.min(cv.height, Math.ceil(base.Y(y) + h)) - sy;
      if (sw > 0 && sh > 0) g.drawImage(cv, sx, sy, sw, sh, sx, sy, sw, sh);
      if (route && route.length > 1) {
        g.strokeStyle = css('--sun'); g.lineWidth = 3.5 / k; g.lineJoin = g.lineCap = 'round';
        g.beginPath();
        let pen = false; // (a route through a lift breaks where the lift goes up or down: a null, and the line goes on from the other floor)
        for (const p of route) { if (!p) { pen = false; continue; } if (pen) g.lineTo(base.X(p[0]), base.Y(p[1])); else g.moveTo(base.X(p[0]), base.Y(p[1])); pen = true; }
        g.stroke();
      }
      if (ride && ride.length > 1) rideLine(g, ride, base.X, base.Y, 1 / k);
      g.restore();
      // icons stay upright; clamp off-map ones to the rim
      g.save();
      g.translate(S / 2, S / 2);
      const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
      for (const ic of icons) {
        let dx = (ic.x - x) / radius * (S / 2), dy = -(ic.y - y) / radius * (S / 2);
        let px = dx * cs - dy * sn, py = dx * sn + dy * cs;
        const r = Math.hypot(px, py), lim = S / 2 - 10;
        if (r > lim) { if (!ic.pin) continue; px *= lim / r; py *= lim / r; }
        drawIcon(g, ic.h == null ? ic : Object.assign({}, ic, { rot: ic.h - yaw }), px, py);
      }
      // the player, at the centre
      g.rotate(heading - yaw);
      g.fillStyle = '#ffffff'; g.strokeStyle = css('--bg'); g.lineWidth = 2; // white on the gold route
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.strokeStyle = css('--line'); g.lineWidth = 2;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.stroke();
      // north mark
      const nx = S / 2 + Math.sin(-yaw) * (S / 2 - 12) * -1, ny = S / 2 - Math.cos(-yaw) * (S / 2 - 12);
      g.fillStyle = css('--ink'); g.font = '700 11px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', nx, ny);
    };
  }
  // a ride's route still to drive: a light line on a dark casing, as the ride apps draw it on a dark map
  // (X, Y: map metres to the canvas; px: one screen pixel in the canvas's units)
  function rideLine(g, pts, X, Y, px) {
    g.save();
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.strokeStyle = 'rgba(4,6,11,0.85)'; g.lineWidth = 6.5 * px; g.stroke();
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 3.4 * px; g.stroke();
    g.restore();
  }
  function drawIcon(g, ic, x, y) {
    g.save();
    g.translate(x, y);
    const col = ic.color || css('--ink');
    if (ic.kind === 'ridecar') { // the car coming for you, from above, facing the way it drives
      g.rotate(ic.rot || 0);
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
      g.fillStyle = ic.color || '#f4f1ea'; g.strokeStyle = '#04060b'; g.lineWidth = 1.2;
      g.beginPath(); g.roundRect ? g.roundRect(-4.6, -8.5, 9.2, 17, 3.2) : g.rect(-4.6, -8.5, 9.2, 17); g.fill();
      g.shadowColor = 'transparent'; g.stroke();
      g.fillStyle = 'rgba(4,6,11,0.78)'; // the windscreen and the back window
      g.beginPath(); g.moveTo(-3.4, -3.6); g.lineTo(3.4, -3.6); g.lineTo(2.8, -6.2); g.lineTo(-2.8, -6.2); g.closePath(); g.fill();
      g.fillRect(-3, 4, 6, 2);
    } else if (ic.kind === 'pickup') { // where the ride pulls in: a pin with a hole
      g.fillStyle = css('--accent'); g.strokeStyle = '#04060b'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-2.5, -5, -7, -8, -7, -13); g.arc(0, -13, 7, Math.PI, 0); g.bezierCurveTo(7, -8, 2.5, -5, 0, 0); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#04060b'; g.beginPath(); g.arc(0, -13, 2.6, 0, Math.PI * 2); g.fill();
    } else if (ic.kind === 'you') { // you, as the apps show you: a blue dot in a white ring, a soft halo, the way you face
      g.fillStyle = 'rgba(78,161,255,0.2)'; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
      if (ic.rot != null) { g.save(); g.rotate(ic.rot); g.fillStyle = 'rgba(78,161,255,0.45)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 15, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill(); g.restore(); }
      g.fillStyle = '#4ea1ff'; g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(0, 0, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
    } else if (ic.kind === 'dest') { // where you're going: a square on a stalk
      g.strokeStyle = '#f4f1ea'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -12); g.stroke();
      g.fillStyle = '#f4f1ea'; g.strokeStyle = '#04060b'; g.lineWidth = 1.2; g.fillRect(-5.5, -19, 11, 9); g.strokeRect(-5.5, -19, 11, 9);
      g.fillStyle = '#04060b'; g.fillRect(-2, -16.5, 4, 4);
    } else if (ic.kind === 'quest') {
      g.fillStyle = css('--sun'); g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 3.5 : 8; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
    } else if (ic.kind === 'npc') {
      g.fillStyle = col; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = '800 10px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ic.label || '!', 0, 0.5);
    } else if (ic.kind === 'quest2') { // where a line you are not tracking leads
      g.fillStyle = '#ffffff'; g.strokeStyle = css('--sun'); g.lineWidth = 1.8;
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 3 : 6.5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
    } else if (ic.kind === 'trig') { // a trig station: hollow until surveyed
      g.fillStyle = ic.done ? css('--sun') : '#ffffff'; g.strokeStyle = ic.done ? '#ffffff' : '#8a6d1d'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(0, -7.5); g.lineTo(7, 5); g.lineTo(-7, 5); g.closePath(); g.fill(); g.stroke();
    } else if (ic.kind === 'gull') { // a flock of gulls: a gull in flight on a pale disc
      g.fillStyle = '#ffffff'; g.strokeStyle = '#6d8796'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#33424c'; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-4.4, 0.4); g.quadraticCurveTo(-2.2, -2.6, 0, 0.8); g.quadraticCurveTo(2.2, -2.6, 4.4, 0.4); g.stroke();
    } else if (ic.kind === 'landmark' || ic.kind === 'place') { // somewhere to travel to: a ringed pin, a gold heart for a landmark, a gold ring for a place
      g.fillStyle = 'rgba(6, 10, 18, 0.78)'; g.beginPath(); g.arc(0, 0, 6.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ic.kind === 'landmark' ? '#f4efe6' : css('--sun'); g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 5.2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = ic.kind === 'landmark' ? css('--sun') : '#ffffff'; g.beginPath(); g.arc(0, 0, 2.6, 0, Math.PI * 2); g.fill();
    } else if (ic.kind === 'ferry' || ic.kind === 'heli' || ic.kind === 'wharf' || ic.kind === 'pad' || ic.kind === 'waypoint' || ic.kind === 'car' || ic.kind === 'ride') {
      const bg = { ferry: '#1e5b3a', heli: '#c62d2a', wharf: '#24577a', pad: '#c62d2a', waypoint: css('--accent'), car: '#2f5d8c', ride: '#d08a00' }[ic.kind];
      g.fillStyle = bg; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, ic.kind === 'ferry' || ic.kind === 'heli' ? 5 : 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = '800 8.5px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText({ wharf: 'F', pad: 'H', waypoint: '◆', ferry: '', heli: '', car: 'C', ride: ic.label || 'T' }[ic.kind], 0, 0.5);
    }
    g.restore();
  }

  // ------------------------------------------------------------ the ride app's map
  // North up and framed on what matters, as a ride app frames it: the car and the pick-up while
  // it comes (and you, if you're a walk from the pick-up), the car and where you're going on the
  // way. The frame glides to follow rather than jumping. The route still to drive is a light line
  // on a dark casing; you are the blue dot, with a dotted walk to the pick-up when it is a walk.
  function rideMap(canvas, base) {
    const g = canvas.getContext('2d');
    let view = null;
    return function draw({ route, car, pickup, you, dest, reset }) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      // the frame: everything in it, with a margin, and never closer than 160 m across
      const pts = [car, pickup, you, dest].filter(Boolean);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const pad = 34, span = Math.max(160, (x1 - x0) * h / w, y1 - y0);
      const want = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.min((w - 2 * pad) / Math.max(160, x1 - x0), (h - 2 * pad - 14) / span) };
      if (!view || reset) view = Object.assign({}, want);
      else { const e = 0.08; view.cx += (want.cx - view.cx) * e; view.cy += (want.cy - view.cy) * e; view.k *= Math.pow(want.k / view.k, e); }
      const { cx, cy, k } = view, ox = w / 2, oy = h / 2 + 7; // a little low, under the pins' heads
      const sx = x => ox + (x - cx) * k, sy = y => oy - (y - cy) * k;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = css('--gm-water'); g.fillRect(0, 0, w, h);
      // the base map (1 px = base.PX m), only the part in view
      const a = k * base.PX, bx = base.X(cx), by = base.Y(cy);
      g.save();
      g.setTransform(a * dpr, 0, 0, a * dpr, (ox - bx * a) * dpr, (oy - by * a) * dpr);
      g.imageSmoothingEnabled = true;
      const hw = w / 2 / a + 2, hh = h / 2 / a + 2, cv = base.canvas;
      const u0 = Math.max(0, Math.floor(bx - hw)), v0 = Math.max(0, Math.floor(by - hh)), u1 = Math.min(cv.width, Math.ceil(bx + hw)), v1 = Math.min(cv.height, Math.ceil(by + hh));
      if (u1 > u0 && v1 > v0) g.drawImage(cv, u0, v0, u1 - u0, v1 - v0, u0, v0, u1 - u0, v1 - v0);
      g.restore();
      g.fillStyle = 'rgba(4,6,11,0.18)'; g.fillRect(0, 0, w, h); // a touch darker, so the route reads
      if (route && route.length > 1) rideLine(g, route, sx, sy, 1);
      if (you && pickup && Math.hypot(you.x - pickup.x, you.y - pickup.y) > 15) { // the walk to the pick-up
        g.save(); g.setLineDash([2, 5]); g.lineCap = 'round'; g.strokeStyle = '#7fb8ff'; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(sx(you.x), sy(you.y)); g.lineTo(sx(pickup.x), sy(pickup.y)); g.stroke(); g.restore();
      }
      if (dest) drawIcon(g, { kind: 'dest' }, sx(dest.x), sy(dest.y));
      if (pickup) drawIcon(g, { kind: 'pickup' }, sx(pickup.x), sy(pickup.y));
      if (you) drawIcon(g, { kind: 'you', rot: you.h }, sx(you.x), sy(you.y));
      if (car) drawIcon(g, { kind: 'ridecar', rot: car.h, color: car.color }, sx(car.x), sy(car.y));
      // a scale bar, as a map has
      const m = [20, 50, 100, 200, 500, 1000, 2000].find(v => v * k > 44) || 2000, L = m * k;
      g.fillStyle = 'rgba(236,232,225,0.75)'; g.fillRect(10, h - 12, L, 1.5); g.fillRect(10, h - 16, 1.5, 5.5); g.fillRect(10 + L - 1.5, h - 16, 1.5, 5.5);
      g.font = '400 9px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'bottom'; g.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, 16 + L, h - 9);
    };
  }

  // ------------------------------------------------------------ dialogue: typewriter with voice beeps
  function dialogue(audio) {
    const box = $('#gd'), nameEl = $('#gd-name'), roleEl = $('#gd-role'), textEl = $('#gd-text'), choicesEl = $('#gd-choices'), hint = $('#gd-hint');
    let cur = null;
    function show(npc, lines, choices, done) {
      cur = { npc, lines, choices: choices || [], done, i: 0, typed: 0, full: '', t: 0 };
      box.hidden = false;
      box.style.setProperty('--npc', npc.color || 'var(--accent)');
      nameEl.textContent = npc.name; roleEl.textContent = npc.role || '';
      next(true);
    }
    function next(first) {
      if (!cur) return;
      if (!first && cur.typed < cur.full.length) { cur.typed = cur.full.length; textEl.textContent = cur.full; showChoices(); return; } // finish the line at once
      if (!first) cur.i++;
      if (cur.i >= cur.lines.length) { if (cur.choices.length) return; close(); return; }
      cur.full = cur.lines[cur.i]; cur.typed = 0; cur.t = 0;
      textEl.textContent = '';
      choicesEl.innerHTML = '';
      hint.textContent = cur.i < cur.lines.length - 1 || !cur.choices.length ? (matchMedia('(pointer: coarse)').matches ? 'Tap to continue' : 'E or click to continue') : '';
    }
    function showChoices() {
      if (!cur || cur.i < cur.lines.length - 1 || !cur.choices.length) return;
      hint.textContent = '';
      choicesEl.innerHTML = cur.choices.map((c, k) => `<button data-k="${k}"><kbd>${k + 1}</kbd>${c.text}</button>`).join('');
    }
    function choose(k) {
      if (!cur || !cur.choices[k]) return;
      const c = cur.choices[k], done = cur.done;
      close(c);
      if (done) done(c);
    }
    function close(choice) {
      const d = cur && !choice ? cur.done : null;
      cur = null;
      box.hidden = true;
      choicesEl.innerHTML = '';
      if (d) d(null);
    }
    function tick(dt) {
      if (!cur || cur.typed >= cur.full.length) return;
      const before = Math.floor(cur.typed);
      cur.typed = Math.min(cur.full.length, cur.typed + dt * 55);
      const n = Math.floor(cur.typed);
      if (n > before) {
        textEl.textContent = cur.full.slice(0, n);
        if (Math.floor(n / 3) > Math.floor(before / 3) && /\w/.test(cur.full[n - 1] || '')) audio.beep(cur.npc.pitch || 220);
        if (n >= cur.full.length) showChoices();
      }
    }
    choicesEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { e.stopPropagation(); choose(+b.dataset.k); } });
    box.addEventListener('click', () => next(false));
    return { show, next, choose, tick, get open() { return !!cur; }, get hasChoices() { return !!(cur && cur.choices.length && cur.i >= cur.lines.length - 1 && cur.typed >= cur.full.length); } };
  }

  // ------------------------------------------------------------ toasts
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `g-toast ${kind}`;
    el.innerHTML = text;
    const box = $('#g-toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove(); // keep the stack short
    setTimeout(() => el.classList.add('out'), kind === 'stamp' ? 4200 : 2800);
    setTimeout(() => el.remove(), kind === 'stamp' ? 4800 : 3400);
  }

  // ------------------------------------------------------------ a passport stamp comes down, then flies to the Passport button
  function stamp(text, sub) {
    const el = document.createElement('div');
    el.className = 'g-stampfx';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="stamp">${text}</span><span class="sub">${sub}</span>`;
    $('#game-stage').appendChild(el);
    const to = $('#g-pass-btn').getBoundingClientRect(), me = el.querySelector('.stamp').getBoundingClientRect();
    el.style.setProperty('--fx', `${to.left + to.width / 2 - (me.left + me.width / 2)}px`);
    el.style.setProperty('--fy', `${to.top + to.height / 2 - (me.top + me.height / 2)}px`);
    setTimeout(() => el.classList.add('fly'), 2300);
    setTimeout(() => el.remove(), 3200);
  }

  return { baseMap, minimap, rideMap, rideLine, dialogue, toast, drawIcon, stamp };
})();
