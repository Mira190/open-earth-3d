// HUD pieces: the minimap (heading-up, with the GPS route), the full map, the
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
    const wm = G.water, bytes = Uint8Array.from(atob(wm.bits), c => c.charCodeAt(0)), img = g.getImageData(0, 0, w, h);
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
    return function draw({ x, y, yaw, heading, radius, route, icons }) {
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
      g.drawImage(base.canvas, 0, 0);
      if (route && route.length > 1) {
        g.strokeStyle = css('--sun'); g.lineWidth = 3.5 / k; g.lineJoin = g.lineCap = 'round';
        g.beginPath();
        route.forEach((p, i) => (i ? g.lineTo(base.X(p[0]), base.Y(p[1])) : g.moveTo(base.X(p[0]), base.Y(p[1]))));
        g.stroke();
      }
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
        drawIcon(g, ic, px, py);
      }
      // the player, at the centre
      g.rotate(heading - yaw);
      g.fillStyle = css('--accent'); g.strokeStyle = '#fff'; g.lineWidth = 2;
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
  function drawIcon(g, ic, x, y) {
    g.save();
    g.translate(x, y);
    const col = ic.color || css('--ink');
    if (ic.kind === 'quest') {
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
    } else if (ic.kind === 'ferry' || ic.kind === 'heli' || ic.kind === 'wharf' || ic.kind === 'pad' || ic.kind === 'waypoint') {
      const bg = { ferry: '#1e5b3a', heli: '#c62d2a', wharf: '#24577a', pad: '#c62d2a', waypoint: css('--accent') }[ic.kind];
      g.fillStyle = bg; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, ic.kind === 'ferry' || ic.kind === 'heli' ? 5 : 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = '800 8.5px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText({ wharf: 'F', pad: 'H', waypoint: '◆', ferry: '', heli: '' }[ic.kind], 0, 0.5);
    }
    g.restore();
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
      hint.textContent = cur.i < cur.lines.length - 1 || !cur.choices.length ? 'E or click to continue' : '';
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

  return { baseMap, minimap, dialogue, toast, drawIcon, stamp };
})();
