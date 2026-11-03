// Places a city's game names (game.json "areas", "spots", "chatter"), for a city told street by street:
//   areas    the neighbourhoods; walking into one puts its name up on a station sign, as Tokyo's
//            platforms sign theirs (駅名標: the name, its reading, the stations either side, the line's colour)
//   spots    things to look at closely: E opens a few lines about them (a votive tablet's wish, a bathhouse's
//            price list), one picked at random where the spot has many
//   chatter  conversations you overhear as you pass, in bubbles over where they are said
// The model viewer does not use it.
'use strict';
window.OEPlaces = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function create({ G, W, camera, stage }) {
    const areas = G.areas || [], spots = G.spots || [], chatter = (G.chatter || []).map(c => Object.assign({ i: -1, t: 0, heard: -1e9 }, c));
    // the station sign
    const sign = document.createElement('div');
    sign.className = 'g-ekimei';
    sign.hidden = true;
    sign.setAttribute('role', 'status');
    stage.appendChild(sign);
    let inArea = null, due = null, signT = 0;
    function showSign(a) {
      sign.style.setProperty('--band', a.band || '#1f7a4d');
      sign.innerHTML = `<div class="ek-name">${esc(a.name)}</div><div class="ek-kana">${esc(a.kana || '')}</div>
        <div class="ek-band"><span>${esc(a.romaji || '')}</span></div>
        <div class="ek-next"><span>${a.left ? `◀ ${esc(a.left)}` : ''}</span><span>${a.right ? `${esc(a.right)} ▶` : ''}</span></div>
        ${a.note ? `<div class="ek-note">${esc(a.note)}</div>` : ''}`;
      sign.hidden = false;
      sign.classList.remove('out');
      signT = 4.5;
    }
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
      update(dt, px, py, pz, active) {
        // the area you are in, and its sign when you walk in (held while a camera move plays, such as the start)
        let a = null;
        for (const q of areas) if (Math.hypot(q.at[0] - px, q.at[1] - py) < q.radius && (!a || q.radius < a.radius)) a = q;
        if (a !== inArea) { inArea = a; due = a; }
        if (due && active) { showSign(due); due = null; }
        if (signT > 0) { signT -= dt; if (signT <= 0.6 && !sign.classList.contains('out')) sign.classList.add('out'); if (signT <= 0) sign.hidden = true; }
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
      area: () => inArea,
    };
  }
  return { create };
})();
