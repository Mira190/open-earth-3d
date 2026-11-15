// A map's story, told in episodes, and the Stop: the minutes after sunset in which the world holds still and
// only whoever carries the camera walks on. Nothing here names a city or draws the world: a map's story is its
// data (game.json "story", from cities/<id>/city.json), and game.js lends what a story needs of the game
// (the clock, the weather, a figure to stand somewhere, the dialogue, the scramble's lights).
//
//   "story": {
//     "title": "Blue Hour", "frames": 7,                     // the film left in the camera
//     "card": { "eyebrow": "...", "native": "...", "line": "..." }, // the title: over the name, under it, and the line below
//     "episodes": [{
//       "id": "late", "title": "You came late", "no": 1, "stamp": "10 Oct · 17:14",   // (the stamp: under its print)
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

  // ctx: { story (the data), stage, player, touch, toast(html), say(who, lines, done), hush(on), dress(date, light, weather),
  //        walkIn(seconds), figure(look, at) -> { x, y, z, face(x, y), animate(dt), remove() },
  //        beacon(at | null): a light standing at [x, y] (none: taken away), screen(at) -> { x, y, front, dist } where
  //        [x, y, z] is in the frame (0..1), aim(at) -> degrees between the lens and it, snap() -> the frame as a data URL,
  //        again(), free(): the episode once more; the map without its story }
  function create(ctx) {
    const S = ctx.story, eps = S.episodes || [];
    // the story's own interface (story.css): the map's instruments are put away for as long as the story is here
    ctx.stage.classList.add('story');
    { // the title: the story's name, the evening, and one button
      const q = sel => ctx.stage.querySelector(sel), ep0 = eps[0] || {}, T = S.card || {};
      if (q('#gt-city')) q('#gt-city').textContent = T.eyebrow || '';
      if (q('#gt-title')) q('#gt-title').innerHTML = `${esc(S.title || '')}${T.native ? `<small lang="ja">${esc(T.native)}</small>` : ''}`;
      if (q('#gt-blurb')) q('#gt-blurb').textContent = T.line || '';
      if (q('#gt-play')) q('#gt-play').innerHTML = `<span>${ep0.no ? `Episode ${esc(ep0.no)} · ` : ''}${esc(ep0.title || 'Begin')}</span><kbd>↵</kbd>`;
    }
    const el = (id, html, tag = 'div') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; ctx.stage.appendChild(e); return e; };
    const frames = el('g-story-frames', `<span><b></b>frames left</span><span class="strip">${'<i></i>'.repeat(S.frames || 7)}</span>`), card = el('g-story-card', '<div><small></small><span></span></div>'), veil = el('g-story-veil', ''), flash = el('g-story-flash', '');
    const goalEl = el('g-story-goal', '<small></small><span></span>'), mark = el('g-story-mark', '<i></i><b></b>'), keys = el('g-story-keys', ''), finder = el('g-story-finder', '');
    const shutter = el('g-story-shutter', `<i></i>Take the picture${ctx.touch ? '' : ' <kbd>F</kbd>'}`, 'button'), endEl = el('g-story-end', '');
    shutter.type = 'button';
    goalEl.setAttribute('role', 'status'); goalEl.setAttribute('aria-live', 'polite');
    const pulse = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
    const st = { ep: null, phase: 'idle', beat: '', t: 0, left: S.frames || 7, ghost: null, target: null, print: null, moved: 0, from: null, late: false, miss: 0 };
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const show = () => { frames.querySelector('b').textContent = String(st.left).padStart(2, '0'); frames.querySelectorAll('.strip i').forEach((c, i) => c.classList.toggle('spent', i < (S.frames || 7) - st.left)); };
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
      endEl.innerHTML = `<div class="card">${st.print ? `<figure><img alt="The photograph you took" src="${st.print}"><figcaption><span>Frame ${(S.frames || 7) - st.left} of ${S.frames || 7}</span><span>${esc(ep.stamp || '')}</span></figcaption></figure>` : ''}
<small>${esc(S.title || '')}${ep.no ? ` · Episode ${ep.no}` : ''}</small><h2>${esc(late ? E.late_title || 'The lights changed without you' : E.title || 'To be continued')}</h2>
${(late ? E.late_line : E.line) ? `<p>${esc(late ? E.late_line : E.line)}</p>` : ''}${!late && E.next ? `<p class="next">${esc(E.next)}</p>` : ''}
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
        ctx.stage.classList.remove('story', 'story-on', 'story-stop');
        for (const e of [frames, card, veil, flash, goalEl, mark, keys, finder, shutter, endEl]) e.remove();
        if (st.ghost) st.ghost.remove();
      },
    };
  }
  return { create };
})();
