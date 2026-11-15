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
//       "overture": { ... },                                  // its own opening (overture.js's spec, over the map's)
//       "lead_s": 1,                                          // the world stops this long after the street is yours
//       "walk_in_s": 0,                                       // a scramble by the start turns to walk after this long
//       "stop_s": 540,                                        // how long the Stop lasts if nothing ends it
//       "afterimage": { "character": "R_...", "name": "...", "year": 1964, "at": [x, y], "reach_m": 3.2,
//                       "lines": ["..."] },                   // who stands in the stopped world, and what they say
//       "task": { "subject": [x, y, z], "within_deg": 40,     // then one thing to do: a photograph of the subject
//                 "lines": ["..."] },                         // (what they say of it)
//       "goals": { "seek": "...", "shoot": "...", "aim": "..." }, // the one line on screen at each beat
//       "after": ["..."],                                     // said as the world runs on again
//       "end": { "title": "...", "line": "...", "next": "..." } // the episode's last card
//     }]
//   }
//
// A player new to the game is never left without the next thing to do: one line says it (the goal), a light stands
// where it is (the beacon, with its distance when it is out of the frame), the keys are named the first time they
// are needed, and the episode ends on a card with what comes next.
//   }
//
// The game asks `stopped` each frame and gives the world no time while it is true: the people, the traffic, the
// trains, the rain and the screens hold; the player, the camera and the afterimage do not.
'use strict';
window.OEStory = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS = `
#g-story-frames { position: absolute; left: max(18px, env(safe-area-inset-left)); bottom: max(18px, env(safe-area-inset-bottom)); z-index: 6; display: flex; align-items: baseline; gap: 10px;
  padding: 7px 14px 6px; border-radius: 999px; background: rgba(8, 12, 22, 0.55); backdrop-filter: blur(10px); color: #f4efe6; font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
  opacity: 0; transition: opacity 0.9s ease; pointer-events: none; }
#g-story-frames.on { opacity: 1; }
#g-story-frames b { font: 700 22px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0; color: #ffcf8a; font-variant-numeric: tabular-nums; }
#g-story-card { position: absolute; inset: 0; z-index: 7; display: grid; place-items: center; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; background: radial-gradient(ellipse at center, rgba(4, 8, 18, 0) 30%, rgba(4, 8, 18, 0.55) 100%); }
#g-story-card.on { opacity: 1; }
#g-story-card div { text-align: center; color: #f4efe6; text-shadow: 0 2px 24px rgba(0, 0, 0, 0.7); }
#g-story-card small { display: block; font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #ffcf8a; margin-bottom: 14px; }
#g-story-card span { display: block; font: 300 clamp(28px, 5vw, 54px)/1.1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.02em; }
/* the stopped world: colder, darker at its edges and drained of colour (a multiply never lifts the blacks into a grey veil) */
#g-story-veil { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0; transition: opacity 1.6s ease; background: radial-gradient(ellipse at 50% 45%, #e6edff 35%, #9aabe6 100%); mix-blend-mode: multiply; }
#g-story-veil.on { opacity: 1; transition: opacity 0.5s ease; }
#g-story-flash { position: absolute; inset: 0; z-index: 4; pointer-events: none; opacity: 0; background: #dfe9ff; }
#g-story-flash.on { animation: g-story-flash 0.7s ease-out; }
@keyframes g-story-flash { 0% { opacity: 0.75; } 100% { opacity: 0; } }
.game-stage.story-on #game-gl { transition: filter 1.4s ease; }
.game-stage.story-stop #game-gl { filter: brightness(0.92) contrast(1.12) saturate(0.5); transition: filter 0.45s ease; }
/* the story has its own goals: the walks' card, the prompts and the passers-by's talk are put away while it plays */
.game-stage:is(.story-on, .story-auto) :is(.g-quest, .g-prompt, .g-chatter, .g-labels, .lf-card) { display: none !important; }
.game-stage.story-stop .g-right { opacity: 0; transition: opacity 0.6s ease; }
.game-stage.story-auto #g-title { opacity: 0; pointer-events: none; }
/* the goal: the one thing to do now, and the Stop's minutes running out beside it */
#g-story-goal { position: absolute; left: 50%; top: max(22px, env(safe-area-inset-top)); transform: translateX(-50%); z-index: 6; max-width: min(92vw, 620px); text-align: center; pointer-events: none;
  opacity: 0; transition: opacity 0.7s ease; color: #f4efe6; text-shadow: 0 1px 14px rgba(0, 0, 0, 0.85); }
#g-story-goal.on { opacity: 1; }
#g-story-goal small { display: block; font: 600 11px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.28em; text-transform: uppercase; color: #ffcf8a; margin-bottom: 9px; font-variant-numeric: tabular-nums; }
#g-story-goal span { display: inline-block; padding: 9px 18px 10px; border-radius: 999px; background: rgba(8, 12, 22, 0.55); backdrop-filter: blur(10px); font: 500 clamp(15px, 2.1vw, 19px)/1.25 "Public Sans", system-ui, sans-serif; }
/* the beacon's mark on the screen: over the place itself, or held at the frame's edge on the side it lies */
#g-story-mark { position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; opacity: 0; transition: opacity 0.5s ease; will-change: transform; }
#g-story-mark.on { opacity: 1; }
#g-story-mark i { display: block; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid #cfe0ff; box-shadow: 0 0 14px 3px rgba(159, 196, 255, 0.75); animation: g-story-beat 1.6s ease-in-out infinite; }
#g-story-mark b { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); white-space: nowrap; font: 600 11px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.14em; color: #dfe9ff; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9); font-variant-numeric: tabular-nums; }
@keyframes g-story-beat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.5); } }
/* the keys, the first time they are needed */
#g-story-keys { position: absolute; left: 50%; bottom: max(86px, calc(env(safe-area-inset-bottom) + 86px)); transform: translateX(-50%); z-index: 6; pointer-events: none; opacity: 0; transition: opacity 0.6s ease;
  display: flex; gap: 18px; padding: 10px 18px; border-radius: 14px; background: rgba(8, 12, 22, 0.55); backdrop-filter: blur(10px); color: #f4efe6; font: 500 13px/1 "Public Sans", system-ui, sans-serif; white-space: nowrap; }
#g-story-keys.on { opacity: 1; }
#g-story-keys kbd { display: inline-block; min-width: 20px; padding: 4px 6px; margin-right: 6px; border-radius: 5px; border: 1px solid rgba(244, 239, 230, 0.5); font: 600 11px/1 "Public Sans", system-ui, sans-serif; text-align: center; }
/* the shutter: the one button of the episode */
#g-story-shutter { position: absolute; left: 50%; bottom: max(70px, calc(env(safe-area-inset-bottom) + 70px)); transform: translateX(-50%); z-index: 8; display: none; align-items: center; gap: 12px; padding: 0 22px 0 8px; height: 60px;
  border: 0; border-radius: 999px; background: rgba(8, 12, 22, 0.62); backdrop-filter: blur(10px); color: #f4efe6; font: 600 13px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
#g-story-shutter.on { display: flex; }
#g-story-shutter.ready { background: rgba(255, 207, 138, 0.22); box-shadow: 0 0 0 1px #ffcf8a, 0 0 24px rgba(255, 207, 138, 0.35); }
#g-story-shutter i { width: 44px; height: 44px; border-radius: 50%; border: 2px solid #f4efe6; box-shadow: inset 0 0 0 4px rgba(8, 12, 22, 0.9), inset 0 0 0 22px #ffcf8a; }
#g-story-shutter kbd { padding: 4px 7px; border-radius: 5px; border: 1px solid rgba(244, 239, 230, 0.5); font: 600 11px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0; }
#g-story-shutter:focus-visible { outline: 2px solid #ffcf8a; outline-offset: 3px; }
/* the viewfinder's corners while the camera is up */
#g-story-finder { position: absolute; inset: 12% 18%; z-index: 5; pointer-events: none; opacity: 0; transition: opacity 0.5s ease;
  background: linear-gradient(#f4efe6, #f4efe6) 0 0 / 34px 2px no-repeat, linear-gradient(#f4efe6, #f4efe6) 0 0 / 2px 34px no-repeat, linear-gradient(#f4efe6, #f4efe6) 100% 0 / 34px 2px no-repeat, linear-gradient(#f4efe6, #f4efe6) 100% 0 / 2px 34px no-repeat,
    linear-gradient(#f4efe6, #f4efe6) 0 100% / 34px 2px no-repeat, linear-gradient(#f4efe6, #f4efe6) 0 100% / 2px 34px no-repeat, linear-gradient(#f4efe6, #f4efe6) 100% 100% / 34px 2px no-repeat, linear-gradient(#f4efe6, #f4efe6) 100% 100% / 2px 34px no-repeat; }
#g-story-finder.on { opacity: 0.85; }
/* the last card: the print, what happened, what comes next */
#g-story-end { position: absolute; inset: 0; z-index: 9; display: none; place-items: center; background: rgba(4, 8, 18, 0.72); backdrop-filter: blur(6px); color: #f4efe6; opacity: 0; transition: opacity 1.2s ease; }
#g-story-end.on { display: grid; }
#g-story-end.in { opacity: 1; }
#g-story-end .card { display: grid; justify-items: center; gap: 18px; max-width: min(92vw, 560px); text-align: center; padding: 20px; }
#g-story-end img { width: min(72vw, 380px); aspect-ratio: 3 / 2; object-fit: cover; border: 10px solid #f4efe6; border-bottom-width: 34px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6); transform: rotate(-2.5deg); filter: saturate(0.85) contrast(1.05); }
#g-story-end small { font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #ffcf8a; }
#g-story-end h2 { margin: 0; font: 300 clamp(26px, 4.6vw, 44px)/1.1 "Public Sans", system-ui, sans-serif; }
#g-story-end p { margin: 0; font: 400 15px/1.5 "Public Sans", system-ui, sans-serif; color: rgba(244, 239, 230, 0.82); }
#g-story-end .row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 6px; }
#g-story-end button { height: 46px; padding: 0 22px; border-radius: 999px; border: 1px solid rgba(244, 239, 230, 0.55); background: transparent; color: #f4efe6; font: 600 12px/1 "Public Sans", system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
#g-story-end button.go { background: #ffcf8a; border-color: #ffcf8a; color: #0b1020; }
#g-story-end button:focus-visible { outline: 2px solid #ffcf8a; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { #g-story-mark i { animation: none; } #g-story-goal, #g-story-keys, #g-story-end { transition: none; } #g-story-frames, #g-story-card, #g-story-veil, .game-stage #game-gl { transition: none; } #g-story-flash.on { animation: none; } }`;

  // ctx: { story (the data), stage, player, touch, toast(html), say(who, lines, done), hush(on), dress(date, light, weather),
  //        walkIn(seconds), figure(look, at) -> { x, y, z, face(x, y), animate(dt), remove() },
  //        beacon(at | null): a light standing at [x, y] (none: taken away), screen(at) -> { x, y, front, dist } where
  //        [x, y, z] is in the frame (0..1), aim(at) -> degrees between the lens and it, snap() -> the frame as a data URL,
  //        again(), free(): the episode once more; the map without its story }
  function create(ctx) {
    const S = ctx.story, eps = S.episodes || [];
    if (!document.getElementById('g-story-css')) { const st = document.createElement('style'); st.id = 'g-story-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = (id, html, tag = 'div') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; ctx.stage.appendChild(e); return e; };
    const frames = el('g-story-frames', 'Frames left <b></b>'), card = el('g-story-card', '<div><small></small><span></span></div>'), veil = el('g-story-veil', ''), flash = el('g-story-flash', '');
    const goalEl = el('g-story-goal', '<small></small><span></span>'), mark = el('g-story-mark', '<i></i><b></b>'), keys = el('g-story-keys', ''), finder = el('g-story-finder', '');
    const shutter = el('g-story-shutter', `<i></i>Take the picture${ctx.touch ? '' : ' <kbd>F</kbd>'}`, 'button'), endEl = el('g-story-end', '');
    shutter.type = 'button';
    goalEl.setAttribute('role', 'status'); goalEl.setAttribute('aria-live', 'polite');
    const pulse = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
    const st = { ep: null, phase: 'idle', beat: '', t: 0, left: S.frames || 7, ghost: null, target: null, print: null, moved: 0, from: null, late: false, miss: 0 };
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const show = () => { frames.querySelector('b').textContent = String(st.left); };
    function title(small, big, secs) {
      card.querySelector('small').textContent = small; card.querySelector('span').textContent = big;
      card.classList.add('on');
      later(secs * 1000, () => card.classList.remove('on'));
    }
    // the goal: one line, with the Stop's time beside the story's name while it runs
    let goalText = '';
    function goal(text) {
      goalText = text || '';
      if (!goalText) { goalEl.classList.remove('on'); return; }
      goalEl.querySelector('span').textContent = goalText;
      goalEl.classList.add('on');
    }
    const clockOf = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    // where the goal is: the light in the world, and its mark in the frame (held at the edge on the side it lies)
    function aimAt(at) { st.target = at; ctx.beacon(at); if (!at) mark.classList.remove('on'); }
    function markTick() {
      if (!st.target) return;
      const q = ctx.screen(st.target), W = ctx.stage.clientWidth, H = ctx.stage.clientHeight, m = 46;
      let x = q.x * W, y = q.y * H;
      if (!q.front) { x = W - x; y = H - m; } // (behind: its mark at the foot of the frame, on its side)
      const off = !q.front || x < m || x > W - m || y < m || y > H - m;
      x = Math.max(m, Math.min(W - m, x)); y = Math.max(m + 40, Math.min(H - m, y));
      mark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      mark.querySelector('b').textContent = `${Math.max(1, Math.round(q.dist))} m${off ? (q.front ? '' : ' · behind you') : ''}`;
      mark.classList.toggle('on', q.dist > 4);
    }
    const KEYS = ctx.touch ? '<span>Left thumb · walk</span><span>Drag · look</span>' : '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>walk</span><span><kbd>Shift</kbd>run</span><span>Mouse · look</span>';
    function hint(on) { if (on) keys.innerHTML = KEYS; keys.classList.toggle('on', on); }

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
      st.phase = 'lead'; st.t = 0; st.beat = '';
      ctx.stage.classList.add('story-on');
      if (ep.walk_in_s != null) ctx.walkIn(ep.walk_in_s);
    }
    function stop() {
      const ep = st.ep, G = ep.goals || {};
      st.phase = 'stop'; st.t = 0; st.beat = 'still';
      veil.classList.add('on'); ctx.stage.classList.add('story-stop');
      ctx.hush(true);
      pulse();
      if (ep.afterimage) { st.ghost = ctx.figure(ep.afterimage, ep.afterimage.at); st.ghost.face(ctx.player.x, ctx.player.y); }
      // the world holds a breath, the title falls on it, and then the one thing to do
      later(900, () => title(`${S.title || ''}${ep.no ? ` · Episode ${ep.no}` : ''}`, ep.title || '', 3.0));
      later(4300, () => {
        if (st.phase !== 'stop' || st.beat !== 'still') return;
        st.beat = 'seek'; st.from = [ctx.player.x, ctx.player.y]; st.moved = 0;
        show(); frames.classList.add('on');
        goal(G.seek || 'Someone is still moving. Go to them.');
        if (st.ghost) aimAt([st.ghost.x, st.ghost.y, st.ghost.z + 1.2]);
        hint(true);
      });
    }
    // their task: one photograph, of what they ask for
    function task() {
      const ep = st.ep, T = ep.task, G = ep.goals || {};
      if (!T) { resume(); return; }
      st.beat = 'shoot';
      aimAt(T.subject || null);
      goal(G.shoot || 'Raise the camera and take the picture.');
      shutter.classList.add('on'); finder.classList.add('on');
    }
    function shoot() {
      if (st.phase !== 'stop' || st.beat !== 'shoot') return;
      const ep = st.ep, T = ep.task, G = ep.goals || {};
      if (T.subject && ctx.aim(T.subject) > (T.within_deg || 40)) { goal(G.aim || 'Turn towards the light, then take the picture.'); st.miss = 2.5; return; }
      // (the frame without the goal's marks on it: the beacon is a guide, not a thing in the street)
      ctx.beacon(null);
      try { st.print = ctx.snap(); } catch (e) { st.print = null; }
      pulse();
      st.left = Math.max(0, st.left - 1); show();
      shutter.classList.remove('on'); finder.classList.remove('on'); aimAt(null); goal('');
      st.beat = 'shown';
      const a = ep.afterimage || {};
      later(900, () => ctx.say({ name: a.name || '', role: a.year ? String(a.year) : '' }, T.lines || [], () => resume()));
    }
    function resume(late) {
      const ep = st.ep;
      st.phase = 'after'; st.t = 0; st.beat = ''; st.late = !!late;
      veil.classList.remove('on'); ctx.stage.classList.remove('story-stop');
      shutter.classList.remove('on'); finder.classList.remove('on'); hint(false); aimAt(null); goal('');
      ctx.hush(false);
      pulse();
      if (st.ghost) { st.ghost.remove(); st.ghost = null; }
      (late ? ep.late || [] : ep.after || []).forEach((line, i) => later(1400 + i * 4200, () => ctx.toast(esc(line))));
    }
    // the episode's last card: the print, what it was, what comes next, and two ways on
    function end() {
      const ep = st.ep, E = typeof ep.end === 'string' ? { title: ep.end } : ep.end || {}, late = st.late;
      st.phase = 'done';
      frames.classList.remove('on');
      endEl.innerHTML = `<div class="card">${st.print ? `<img alt="The photograph you took" src="${st.print}">` : ''}
<small>${esc(S.title || '')}${ep.no ? ` · Episode ${ep.no}` : ''}</small><h2>${esc(late ? E.late_title || 'The lights changed without you' : E.title || 'To be continued')}</h2>
${(late ? E.late_line : E.line) ? `<p>${esc(late ? E.late_line : E.line)}</p>` : ''}${!late && E.next ? `<p><b>${esc(E.next)}</b></p>` : ''}
<div class="row"><button type="button" class="go" data-do="${late ? 'again' : 'free'}">${late ? 'Try again' : esc(E.free || 'Walk the city')}</button><button type="button" data-do="${late ? 'free' : 'again'}">${late ? esc(E.free || 'Walk the city') : 'Play it again'}</button></div></div>`;
      endEl.classList.add('on');
      requestAnimationFrame(() => endEl.classList.add('in'));
      const go = endEl.querySelector('button.go');
      if (go) go.focus({ preventScroll: true });
    }
    endEl.addEventListener('click', e => { const b = e.target.closest('button[data-do]'); if (b) (b.dataset.do === 'again' ? ctx.again : ctx.free)(); });
    shutter.addEventListener('click', shoot);
    const onKey = e => { if (e.code === 'KeyF' && !e.repeat && st.beat === 'shoot') { e.preventDefault(); e.stopPropagation(); shoot(); } };
    addEventListener('keydown', onKey, true);

    function tick(dt) {
      const ep = st.ep;
      if (!ep || st.phase === 'idle' || st.phase === 'dressed' || st.phase === 'done') return;
      st.t += dt;
      if (st.phase === 'lead') { if (st.t >= (ep.lead_s ?? 1)) stop(); }
      else if (st.phase === 'stop') {
        const g = st.ghost, a = ep.afterimage, leftS = Math.max(0, (ep.stop_s || 540) - st.t);
        goalEl.querySelector('small').textContent = `The Stop · ${clockOf(leftS)}`;
        if (g) { g.animate(dt); g.face(ctx.player.x, ctx.player.y); }
        if (st.beat === 'seek') {
          // the keys are put away once they have been used
          if (st.from && Math.hypot(ctx.player.x - st.from[0], ctx.player.y - st.from[1]) > 3) { st.from = null; hint(false); }
          if (g && Math.hypot(g.x - ctx.player.x, g.y - ctx.player.y) < (a.reach_m || 3.2)) {
            st.beat = 'talk'; hint(false); aimAt(null); goal('');
            ctx.say({ name: a.name || '', role: a.year ? String(a.year) : '' }, a.lines || [], () => task());
          }
        }
        if (st.beat === 'shoot') { // the goal says when the lens is on it, and the button shows it
          const T = ep.task, G = ep.goals || {}, on = !T.subject || ctx.aim(T.subject) <= (T.within_deg || 40);
          const text = on ? G.ready || 'That is it. Take the picture.' : G.shoot || 'Raise the camera and take the picture.';
          if (text !== goalText && !st.miss) goal(text);
          if (st.miss) st.miss = Math.max(0, st.miss - dt);
          shutter.classList.toggle('ready', on);
        }
        markTick();
        if (leftS <= 0 && st.beat !== 'talk' && st.beat !== 'shown') resume(true);
      } else if (st.phase === 'after' && st.t > (st.late ? 6 : 11)) end();
    }
    return {
      dress, begin, tick, shoot, state: st,
      get stopped() { return st.phase === 'stop'; },
      get on() { return st.phase !== 'idle' && st.phase !== 'done'; },
      dispose() {
        timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); ctx.beacon(null);
        ctx.stage.classList.remove('story-on', 'story-stop');
        for (const e of [frames, card, veil, flash, goalEl, mark, keys, finder, shutter, endEl]) e.remove();
        if (st.ghost) st.ghost.remove();
      },
    };
  }
  return { create };
})();
