// Places a city's game names (game.json "areas", "spots", "chatter"), for a city told street by street:
//   areas    the neighbourhoods; walking into one puts its name up briefly on a small station sign, as
//            Tokyo's platforms sign theirs (駅名標: the name, its reading, the line's colour, and here the
//            areas either side you can walk to)
//   spots    things to look at closely: E opens a few lines about them (a votive tablet's wish, a bathhouse's
//            price list), one picked at random where the spot has many
//   chatter  conversations you overhear as you pass, in bubbles over where they are said
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
    };
  }
  return { create };
})();
