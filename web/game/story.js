// A map's story, told in episodes, and the Stop: the minutes after sunset in which the world holds still and
// only whoever carries the camera walks on. Nothing here names a city or draws the world: a map's story is its
// data (game.json "story", from cities/<id>/city.json), and game.js lends what a story needs of the game
// (the clock, the weather, a figure to stand somewhere, the dialogue, the scramble's lights).
//
//   "story": {
//     "title": "Blue Hour", "frames": 7,                     // the film left in the camera
//     "episodes": [{
//       "id": "late", "title": "You came late", "no": 1,
//       "date": [10, 10], "light": "blue", "weather": "rain", // the evening it is set in (sun.js's presets)
//       "lead_s": 8,                                          // the world runs this long, then stops
//       "walk_in_s": 2.5,                                     // a scramble by the start turns to walk after this long
//       "stop_s": 540,                                        // how long the Stop lasts if nothing ends it
//       "afterimage": { "character": "R_...", "name": "...", "year": 1964, "at": [x, y], "reach_m": 3.2,
//                       "lines": ["..."] },                   // who stands in the stopped world, and what they say
//       "after": ["..."]                                      // said as the world runs on again
//     }]
//   }
//
// The game asks `stopped` each frame and gives the world no time while it is true: the people, the traffic, the
// trains, the rain and the screens hold; the player, the camera and the afterimage do not.
'use strict';
window.OEStory = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS = `
#g-story-frames { position: absolute; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 6; display: flex; align-items: baseline; gap: 10px;
  padding: 7px 14px 6px; border-radius: 999px; background: rgba(8, 12, 22, 0.55); backdrop-filter: blur(10px); color: #f4efe6; font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
  opacity: 0; transition: opacity 0.9s ease; pointer-events: none; }
#g-story-frames.on { opacity: 1; }
#g-story-frames b { font: 700 22px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0; color: #ffcf8a; font-variant-numeric: tabular-nums; }
#g-story-card { position: absolute; inset: 0; z-index: 7; display: grid; place-items: center; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; background: radial-gradient(ellipse at center, rgba(4, 8, 18, 0) 30%, rgba(4, 8, 18, 0.55) 100%); }
#g-story-card.on { opacity: 1; }
#g-story-card div { text-align: center; color: #f4efe6; text-shadow: 0 2px 24px rgba(0, 0, 0, 0.7); }
#g-story-card small { display: block; font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #ffcf8a; margin-bottom: 14px; }
#g-story-card span { display: block; font: 300 clamp(28px, 5vw, 54px)/1.1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.02em; }
#g-story-veil { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0; transition: opacity 0.35s ease; background: radial-gradient(ellipse at center, rgba(120, 160, 255, 0) 45%, rgba(40, 70, 160, 0.22) 100%); mix-blend-mode: screen; }
#g-story-veil.on { opacity: 1; transition: opacity 2.4s ease; }
@media (prefers-reduced-motion: reduce) { #g-story-frames, #g-story-card, #g-story-veil { transition: none; } }`;

  // ctx: { story (the data), stage, toast(html), say(who, lines, done), figure(look, at) -> { x, y, z, face(x, y), animate(dt), remove() },
  //        player, dress(date, light, weather), walkIn(seconds), hush(on), flash() }
  function create(ctx) {
    const S = ctx.story, eps = S.episodes || [];
    if (!document.getElementById('g-story-css')) { const st = document.createElement('style'); st.id = 'g-story-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = (id, html) => { const e = document.createElement('div'); e.id = id; e.innerHTML = html; ctx.stage.appendChild(e); return e; };
    const frames = el('g-story-frames', 'Frames left <b></b>'), card = el('g-story-card', '<div><small></small><span></span></div>'), veil = el('g-story-veil', '');
    const st = { ep: null, phase: 'idle', t: 0, left: S.frames || 7, ghost: null, spoke: false };
    const show = () => { frames.querySelector('b').textContent = String(st.left); };
    function title(small, big, secs) {
      card.querySelector('small').textContent = small; card.querySelector('span').textContent = big;
      card.classList.add('on');
      setTimeout(() => card.classList.remove('on'), secs * 1000);
    }
    // before the opening shot: the evening the episode is set in
    function dress(id) {
      const ep = eps.find(e => e.id === id) || eps[0];
      if (!ep) return null;
      st.ep = ep; st.phase = 'dressed'; st.t = 0;
      ctx.dress(ep.date || null, ep.light || 'blue', ep.weather || null);
      return ep;
    }
    // as the player is given the street
    function begin() {
      const ep = st.ep || dress();
      if (!ep) return;
      st.phase = 'lead'; st.t = 0; st.spoke = false;
      if (ep.walk_in_s != null) ctx.walkIn(ep.walk_in_s);
      title(`${S.title || ''}${ep.no ? ` · ${ep.no}` : ''}`, ep.title || '', 3.2);
    }
    function stop() {
      const ep = st.ep;
      st.phase = 'stop'; st.t = 0;
      veil.classList.add('on');
      ctx.hush(true);
      ctx.flash();
      if (ep.afterimage) { st.ghost = ctx.figure(ep.afterimage, ep.afterimage.at); st.ghost.face(ctx.player.x, ctx.player.y); }
      show(); frames.classList.add('on');
    }
    function resume() {
      const ep = st.ep;
      st.phase = 'after'; st.t = 0;
      veil.classList.remove('on');
      ctx.hush(false);
      ctx.flash();
      if (st.ghost) { st.ghost.remove(); st.ghost = null; }
      (ep.after || []).forEach((line, i) => setTimeout(() => ctx.toast(esc(line)), 1400 + i * 4200));
    }
    function tick(dt) {
      const ep = st.ep;
      if (!ep || st.phase === 'idle' || st.phase === 'dressed' || st.phase === 'done') return;
      st.t += dt;
      if (st.phase === 'lead' && st.t >= (ep.lead_s || 8)) stop();
      else if (st.phase === 'stop') {
        const g = st.ghost, a = ep.afterimage;
        if (g) {
          g.animate(dt);
          g.face(ctx.player.x, ctx.player.y);
          if (!st.spoke && Math.hypot(g.x - ctx.player.x, g.y - ctx.player.y) < (a.reach_m || 3.2)) {
            st.spoke = true;
            ctx.say({ name: a.name || '', role: a.year ? String(a.year) : '' }, a.lines || [], () => resume());
          }
        }
        if (!st.spoke && st.t >= (ep.stop_s || 540)) resume();
      } else if (st.phase === 'after' && st.t > 12) st.phase = 'done';
    }
    return {
      dress, begin, tick, state: st,
      get stopped() { return st.phase === 'stop'; },
      get on() { return st.phase !== 'idle' && st.phase !== 'done'; },
      spend() { st.left = Math.max(0, st.left - 1); show(); return st.left; },
      dispose() { for (const e of [frames, card, veil]) e.remove(); if (st.ghost) st.ghost.remove(); },
    };
  }
  return { create };
})();
