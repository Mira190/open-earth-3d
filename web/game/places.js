// Places a city's game names (game.json "areas", "spots", "chatter"), for a city told street by street:
//   areas    the neighbourhoods; walking into one puts its name up briefly on a small station sign, as
//            Tokyo's platforms sign theirs (駅名標: the name, its reading, the line's colour, and here the
//            areas either side you can walk to)
//   spots    things to look at closely: E opens a few lines about them (a votive tablet's wish, a bathhouse's
//            price list), one picked at random where the spot has many
//   chatter  conversations you overhear as you pass, in bubbles over where they are said
// A spot with a "look" is a photo spot: E brings the camera in to look closer (closer(), below),
// a metre from the thing, and you look along it (a shrine's ema rack, rail by rail).
// The model viewer does not use it.
'use strict';
window.OEPlaces = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function create({ G, W, camera, stage }) {
    const areas = G.areas || [], spots = G.spots || [], chatter = (G.chatter || []).map(c => Object.assign({ i: -1, t: 0, heard: -1e9 }, c));
    // the station sign: a brief arrival caption in the upper third (the name, its reading, the line's colour
    // and the areas either side you can walk to), up for about 2.8 s. It waits while anything else has the
    // player's attention (a conversation, the onboarding, a camera move, a menu), is dropped if you have
    // left the area by then, and an area signs itself at most once every few minutes
    const sign = document.createElement('div');
    sign.className = 'g-ekimei';
    sign.hidden = true;
    sign.setAttribute('role', 'status');
    stage.appendChild(sign);
    const SHOW = 2.8, FADE = 0.45, SETTLE = 1.0, AGAIN = 240;
    const leaveR = q => q.radius + Math.max(25, q.radius * 0.12); // hysteresis: in at the radius, out a little beyond it
    const seen = new Map(); // area -> sim time its sign was last up
    let inArea = null, shown = null, due = null, signT = 0, calmT = 0, now = 0;
    const km = d => (d < 950 ? `${Math.round(d / 50) * 50} m` : `${(d / 1000).toFixed(1)} km`);
    // the nearest other area to the west (◀) and to the east (▶), as a map reads
    function sides(a) {
      let w = null, e = null;
      for (const q of areas) {
        if (q === a) continue;
        const dx = q.at[0] - a.at[0], d = Math.hypot(dx, q.at[1] - a.at[1]);
        if (dx < 0 && (!w || d < w.d)) w = { q, d };
        if (dx >= 0 && (!e || d < e.d)) e = { q, d };
      }
      return [w, e];
    }
    function showSign(a) {
      const [w, e] = sides(a);
      const side = (s, left) => s ? `<span class="${left ? 'l' : 'r'}">${left ? '◀ ' : ''}<b>${esc(s.q.name)}</b> <i>${esc(km(s.d))}</i>${left ? '' : ' ▶'}</span>` : '<span></span>';
      sign.style.setProperty('--band', a.band || '#1f7a4d');
      sign.innerHTML = `<div class="ek-top"><span class="ek-name">${esc(a.name)}</span><span class="ek-kana">${esc(a.kana || '')}</span></div>
        <div class="ek-band"><span>${esc(a.romaji || '')}</span></div>
        ${w || e ? `<div class="ek-next" title="Areas nearby you can walk to">${side(w, true)}<span class="ek-what">walk to</span>${side(e, false)}</div>` : ''}
        ${a.note ? `<div class="ek-note">${esc(a.note)}</div>` : ''}`;
      sign.hidden = false;
      sign.classList.remove('out');
      void sign.offsetWidth; // restart the fade in
      sign.classList.add('in');
      signT = SHOW;
      shown = a;
      seen.set(a, now);
    }
    // hide it now, and queue it again if it was up too briefly to be read
    function hush() {
      if (signT > 0) { if (signT > SHOW - 1.2 && shown === inArea) { seen.delete(shown); due = shown; } hideSign(); }
      calmT = 0;
    }
    function hideSign() { signT = 0; sign.hidden = true; sign.classList.remove('in', 'out'); }
    // overheard bubbles, drawn over the scene where they are said
    const layer = document.createElement('div');
    layer.className = 'g-chatter';
    stage.appendChild(layer);
    const tmp = new THREE.Vector3();
    function place(el, x, y, z) {
      tmp.copy(W(x, y, z)).project(camera);
      const r = stage.getBoundingClientRect(), behind = tmp.z > 1;
      el.style.display = behind ? 'none' : '';
      el.style.transform = `translate(${((tmp.x + 1) / 2) * r.width}px, ${((1 - tmp.y) / 2) * r.height}px) translate(-50%, -100%)`;
    }
    return {
      // the spot within reach of a walker at (x, y, z), if any
      spotNear(x, y, z) {
        let best = null, bd = Infinity;
        for (const s of spots) {
          const d = Math.hypot(s.at[0] - x, s.at[1] - y);
          if (d < (s.radius || 2.5) && d < bd && (s.at[2] == null || Math.abs(s.at[2] - z) < 3)) { bd = d; best = s; }
        }
        return best;
      },
      // a spot's lines: all of them, or one picked at random ("pick": 1)
      lines(s) { return s.pick ? [s.lines[Math.floor(Math.random() * s.lines.length)]] : s.lines; },
      // active: on foot and no camera move; calm: active, and nothing else on screen wants the player
      update(dt, px, py, pz, active, calm = active) {
        now += dt;
        // the area you are in: the smallest whose radius you are inside, kept until you are a little beyond it
        let a = inArea && Math.hypot(inArea.at[0] - px, inArea.at[1] - py) < leaveR(inArea) ? inArea : null;
        for (const q of areas) if (q !== a && Math.hypot(q.at[0] - px, q.at[1] - py) < q.radius && (!a || q.radius < a.radius)) a = q;
        if (a !== inArea) {
          inArea = a;
          due = a && !(seen.has(a) && now - seen.get(a) < AGAIN) ? a : null;
        }
        if (due && due !== inArea) due = null; // left before it could show
        if (!calm) hush(); // something else took the screen: the caption gives way at once
        else calmT += dt;
        if (due && calmT >= SETTLE && signT <= 0) { showSign(due); due = null; }
        if (signT > 0) {
          signT -= dt;
          if (signT <= FADE && !sign.classList.contains('out')) sign.classList.add('out');
          if (signT <= 0) hideSign();
        }
        // conversations: start when you come within earshot, a line every few seconds, then quiet for a while
        for (const c of chatter) {
          const near = active && Math.hypot(c.at[0] - px, c.at[1] - py) < (c.radius || 14) && Math.abs((c.at[2] ?? pz) - pz) < 8;
          if (c.i < 0 && near && performance.now() - c.heard > 90000) { c.i = 0; c.t = 0; }
          if (c.i < 0) { if (c.el) { c.el.remove(); c.el = null; } continue; }
          c.t += dt;
          if (c.t > (c.every || 3.4)) { c.i++; c.t = 0; }
          if (c.i >= c.lines.length || !near) { c.i = -1; c.heard = performance.now(); continue; }
          const [who, text] = c.lines[c.i];
          if (!c.el) { c.el = document.createElement('div'); c.el.className = 'g-bubble'; layer.appendChild(c.el); }
          const html = `${who ? `<b>${esc(who)}</b>` : ''}${esc(text)}`;
          if (c.el.innerHTML !== html) c.el.innerHTML = html;
          const off = c.side ? (c.i % 2 ? 1.2 : -1.2) : 0;
          place(c.el, c.at[0] + off, c.at[1], (c.at[2] ?? pz) + 2.4);
        }
      },
      hush, // for a paused game, which doesn't update
      area: () => inArea,
      forget: () => seen.clear(), // (for the checks: every area may sign itself again)
      sign: () => ({ shown: !sign.hidden, name: shown && shown.name, t: signT, due: due && due.name, area: inArea && inArea.name }),
      closer,
    };
  }

  // The look closer at a spot's "look" {at: [x, y, z] the middle of the thing, along: its long axis,
  // half_m: how far either way to look along it, dist_m: how far the eye stands off its face, faces:
  // how far each face is out from the middle, rails: the heights to look at (the lowest to the highest),
  // tablets: [[u, rail, side, layer, text], ...] what hangs where, texts}. From the side the walker stands
  // on, at the point along it nearest them. step(dt, along, up) moves the eye along and up and down (keys
  // or a drag, from -1 to 1, along in the screen's sense) and returns {pos, look, text}: the eye and the
  // point it looks at in local metres, and the text of what is in the middle of the view.
  function closer(sp, px, py) {
    const L = sp.look, [cx, cy, cz] = L.at, ax = L.along[0], ay = L.along[1], nx = -ay, ny = ax;
    const half = L.half_m || 1, dist = L.dist_m || 1, face = L.faces || 0, rails = L.rails || [cz], zlo = Math.min(...rails), zhi = Math.max(...rails);
    const side = (px - cx) * nx + (py - cy) * ny >= 0 ? 1 : -1;
    const st = { u: Math.max(-half, Math.min(half, (px - cx) * ax + (py - cy) * ay)), z: rails[Math.floor(rails.length / 2)], yaw: 0, pitch: 0 };
    const sense = -side; // looking at the face on `side`, screen right runs along -side * along
    const at = (u, off, z) => [cx + ax * u + nx * off, cy + ay * u + ny * off, z];
    function text() {
      let best = null, bd = Infinity;
      for (const t of L.tablets || []) {
        if (t[2] !== side) continue;
        const d = Math.abs(t[0] - st.u) + Math.abs(rails[t[1]] - st.z) * 1.5 - t[3] * 0.03; // the outer layer, where two overlap
        if (d < bd) { bd = d; best = t; }
      }
      return best && L.texts ? L.texts[best[4]] : null;
    }
    return {
      side, state: st,
      step(dt, along, up) {
        st.u = Math.max(-half, Math.min(half, st.u + along * sense * 0.55 * dt));
        st.z = Math.max(zlo, Math.min(zhi, st.z + up * 0.45 * dt));
        const look = at(st.u, side * face, st.z), eye = at(st.u, side * (face + dist), st.z + 0.08);
        // a turn of the head (a drag) looks a little either way, then eases back to the face
        const yaw = st.yaw, h = Math.atan2(look[0] - eye[0], look[1] - eye[1]) + yaw, D = Math.hypot(look[0] - eye[0], look[1] - eye[1]);
        st.yaw *= Math.max(0, 1 - dt * 0.8); st.pitch *= Math.max(0, 1 - dt * 0.8);
        return { pos: eye, look: [eye[0] + Math.sin(h) * D, eye[1] + Math.cos(h) * D, look[2] - 0.08 + st.pitch * D], text: text(), u: st.u, z: st.z };
      },
      turn(dx, dy) { st.yaw = Math.max(-0.6, Math.min(0.6, st.yaw + dx)); st.pitch = Math.max(-0.5, Math.min(0.5, st.pitch + dy)); },
    };
  }
  return { create };
})();
