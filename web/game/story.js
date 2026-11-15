// A map's story, and the Stop: the minutes in which the world holds still and only whoever carries the camera
// walks on. Nothing here names a city or draws the world: the story is data (game.json "story", from
// cities/<id>/city.json; docs/STORY.md is the story itself), and game.js lends what a story needs of the game
// (a figure to stand somewhere, the dialogue, the weather, the scramble's lights, the frame as a picture).
//
// An episode is one case, played through in one go: a run of frames, each one photograph. Nothing is scored
// between them; the only card is the last, with the whole roll on it.
//
//   "story": {
//     "title": "Blue Hour", "frames": 7,                      // the film left in the camera
//     "card": { "eyebrow": "...", "native": "...", "line": "..." }, // the title: over the name, under it, the line below
//     "episodes": [{
//       "id": "late", "title": "You came late", "no": 1,
//       "date": [10, 10], "light": "blue", "weather": "clear", // the evening it is set in (sun.js's presets)
//       "overture": { ... },                                   // its own opening (overture.js's spec, over the map's)
//       "walk_in_s": 0,                                        // a scramble by the start turns to walk after this long
//       "cast": [{ "id": "old", "character": "R_...", "name": "...", "at": [x, y] }], // the living, there all evening
//       "frames": [{
//         "stamp": "17:14",                                    // under its print
//         "weather": "rain",                                   // the sky turns as the frame begins
//         "meet": { "npc": "shun" | "cast": "old", "goal": "...", "lines": ["..."], // first, a word with the living
//                   "ask": [{ "q": "...", "options": ["..."], "answer": 0, "wrong": "..." }] }, // and what they ask you
//         "goal": "...",                                       // then where to go: the line on screen
//         "lead_s": 1,                                         // the world stops this long after (else: on coming near)
//         "stop_r": 12, "stop_s": 420, "stop_at": [x, y],      // how near (to stop_at, else the afterimage); how long the Stop lasts
//         "afterimage": { "character": "R_...", "name": "...", "year": 1964, "at": [x, y, z?], "reach_m": 3.2,
//                         "seek": "...", "lines": ["..."] },   // who moves in the stopped world, and what they say
//         "afterimage2": { ... },                              // a second, who says nothing
//         "task": { "subject": [x, y, z], "within_deg": 40,    // the photograph: of what,
//                   "stand": [x, y, z?], "within_m": 4,        // from where (if it matters),
//                   "both": true,                              // or: with both afterimages in the frame
//                   "goals": { "stand": "...", "shoot": "...", "ready": "...", "aim": "..." },
//                   "lines": ["..."] },                        // and what is said of the print
//         "after": ["..."],                                    // said as the world runs on again
//         "finale": true, "crosses": "old", "cross_to": [x, y] // the last frame: the afterimages meet; then one of the living crosses
//       }],
//       "end": { "title": "...", "line": "...", "next": "...", "free": "..." } // the last card
//     }]
//   }
//
// A player is never left without the next thing to do: one line says it (the goal), a light stands where it is
// (the beacon, with its distance when it is out of the frame), and the keys are named the first time they are needed.
// A Stop that runs out costs nothing but the minute: the world runs on, and stops again when you come back.
// The frames taken are kept in this browser, so a page closed in the middle of a case opens again at the frame it was at.
//
// The game asks `stopped` each frame and gives the world no time while it is true: the people, the traffic, the
// trains, the rain and the screens hold; the player, the camera and the afterimages do not.
'use strict';
window.OEStory = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ctx: { story (the data), stage, player, touch, toast(html), say(who, lines, done), ask(who, lines, choices, done), hush(on),
  //        dress(date, light, weather), weather(kind), walkIn(seconds), floor(x, y) -> the ground's height there,
  //        figure(look, at) -> { x, y, z, face(x, y), walkTo(x, y, speed), animate(dt), remove() } (look.alive: a living person),
  //        person(id) -> one of the map's people { x, y, z, name, role }, beacon(at | null): a light standing at [x, y, , floor]
  //        (none: taken away), screen(at) -> { x, y, front, dist } where [x, y, z] is in the frame (0..1), aim(at) -> degrees
  //        between the lens and it, snap() -> the frame as a data URL, again(), free(): the episode once more; the map without its story }
  function create(ctx) {
    const S = ctx.story, eps = S.episodes || [], N = S.frames || 7;
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
    const frames = el('g-story-frames', `<span><b></b>frames left</span><span class="strip">${'<i></i>'.repeat(N)}</span>`), card = el('g-story-card', '<div><small></small><span></span></div>'), veil = el('g-story-veil', ''), flash = el('g-story-flash', '');
    const goalEl = el('g-story-goal', '<small></small><span></span>'), mark = el('g-story-mark', '<i></i><b></b>'), keys = el('g-story-keys', ''), finder = el('g-story-finder', '');
    const shutter = el('g-story-shutter', `<i></i>Take the picture${ctx.touch ? '' : ' <kbd>F</kbd> · wheel: the lens'}`, 'button'), endEl = el('g-story-end', '');
    shutter.type = 'button';
    goalEl.setAttribute('role', 'status'); goalEl.setAttribute('aria-live', 'polite');
    const pulse = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
    // phase: idle, dressed, go (the world runs: a word with the living, the way to the next place), stop, after, done
    const st = { ep: null, phase: 'idle', beat: '', t: 0, left: N, fi: 0, fr: null, ghost: null, ghost2: null, target: null, prints: [], from: null, late: false, miss: 0, cast: {}, hinted: false, asked: 0 };
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const show = () => { frames.querySelector('b').textContent = String(st.left).padStart(2, '0'); frames.querySelectorAll('.strip i').forEach((c, i) => c.classList.toggle('spent', i < N - st.left)); };
    function title(small, big, secs) {
      card.querySelector('small').textContent = small; card.querySelector('span').textContent = big;
      card.classList.add('on');
      later(secs * 1000, () => card.classList.remove('on'));
    }
    // the case kept in this browser: the frame it is at and the prints so far
    const KEY = () => `oe-story-${st.ep ? st.ep.id : ''}`;
    const keep = () => { try { localStorage.setItem(KEY(), JSON.stringify({ fi: st.fi, left: st.left, prints: st.prints })); } catch (e) { /* storage full or blocked: the case is played in one go */ } };
    const kept = () => { try { const k = JSON.parse(localStorage.getItem(KEY()) || 'null'); return k && k.fi > 0 && k.fi < (st.ep.frames || []).length && Array.isArray(k.prints) ? k : null; } catch (e) { return null; } };
    const forget = () => { try { localStorage.removeItem(KEY()); } catch (e) { /* storage blocked */ } };
    // the goal: one line, under the Stop's minutes or the frame the case is at
    let goalText = '';
    function goal(text) {
      goalText = text || '';
      if (!goalText) { goalEl.classList.remove('on'); return; }
      goalEl.querySelector('span').textContent = goalText;
      goalEl.classList.add('on');
    }
    const clockOf = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    // a place as the beacon and the mark want it: [x, y, the height of a head there, the floor]
    const spot = p => { const z = p[2] != null ? p[2] : ctx.floor(p[0], p[1]); return [p[0], p[1], z + 1.2, z]; };
    const near = (p, r) => Math.hypot(p[0] - ctx.player.x, p[1] - ctx.player.y) < r && (p[2] == null || Math.abs(p[2] - ctx.player.z) < 4);
    // where the goal is: the light in the world, and its mark in the frame (held at the edge on the side it lies)
    function aimAt(at) { st.target = at; ctx.beacon(at); if (!at) mark.classList.remove('on'); }
    function markTick() {
      if (!st.target) return;
      const q = ctx.screen(st.target), W = ctx.stage.clientWidth, H = ctx.stage.clientHeight, m = 46;
      let x = q.x * W, y = q.y * H;
      if (!q.front) { x = W - x; y = H - m; } // (behind: its mark at the foot of the frame, on its side)
      const off = !q.front || x < m || x > W - m || y < m || y > H - m;
      x = Math.max(m, Math.min(W - m, x)); y = Math.max(m + 70, Math.min(H - m, y));
      mark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      mark.querySelector('b').textContent = `${Math.max(1, Math.round(q.dist))} m${off ? (q.front ? '' : ' · behind you') : ''}`;
      mark.classList.toggle('on', q.dist > 4);
    }
    const KEYS = ctx.touch ? '<span>Left thumb · walk</span><span>Drag · look</span>' : '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>walk</span><span><kbd>Shift</kbd>run</span><span>Mouse · look</span>';
    function hint(on) { if (on) keys.innerHTML = KEYS; keys.classList.toggle('on', on); }
    const who = a => ({ name: a.name || '', role: a.year ? String(a.year) : a.role || '', alive: !a.year });

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
      ctx.stage.classList.add('story-on');
      for (const c of ep.cast || []) if (!st.cast[c.id]) st.cast[c.id] = Object.assign(ctx.figure(Object.assign({ alive: true }, c), c.at), { name: c.name, role: c.role });
      const k = kept();
      if (k) { st.left = k.left; st.prints = k.prints; }
      if (ep.walk_in_s != null && !k) ctx.walkIn(ep.walk_in_s);
      show(); if (k) frames.classList.add('on');
      frame(k ? k.fi : 0);
    }
    // a frame begins: the sky it has, a word with the living if there is one, and the way to where the world will stop
    function frame(i) {
      const fr = st.ep.frames[i];
      st.fi = i; st.fr = fr; st.phase = 'go'; st.t = 0; st.late = false; st.asked = 0;
      if (fr.weather) ctx.weather(fr.weather);
      keep();
      if (fr.meet) { st.beat = 'meet'; goal(fr.meet.goal || ''); const m = living(fr.meet); if (m) aimAt(spot([m.x, m.y, m.z])); }
      else approach();
    }
    const living = m => (m.cast ? st.cast[m.cast] : ctx.person(m.npc));
    function approach() {
      const fr = st.fr, a = fr.afterimage;
      st.beat = 'approach'; st.t = 0;
      goal(fr.goal || '');
      aimAt(fr.lead_s != null || !(fr.stop_at || a) ? null : spot(fr.stop_at || a.at));
    }
    // what the living ask: each question until it is answered rightly (a wrong answer costs nothing but the look they give you)
    function ask(m, w, done) {
      const q = (m.ask || [])[st.asked];
      if (!q) return done();
      ctx.ask(w, [q.q], q.options.map(text => ({ text })), c => {
        if (c && q.options.indexOf(c.text) === q.answer) { st.asked++; return q.right ? ctx.say(w, [q.right], () => ask(m, w, done)) : ask(m, w, done); }
        ctx.say(w, [q.wrong || 'No. Look at the prints again.'], () => ask(m, w, done));
      });
    }
    function stop() {
      const ep = st.ep, fr = st.fr, a = fr.afterimage, first = st.fi === 0 && !st.late;
      st.phase = 'stop'; st.t = 0; st.beat = 'still';
      veil.classList.add('on'); ctx.stage.classList.add('story-stop');
      ctx.hush(true);
      pulse();
      if (a && !st.ghost) { st.ghost = ctx.figure(a, a.at); st.ghost.face(ctx.player.x, ctx.player.y); }
      if (fr.afterimage2 && !st.ghost2) { st.ghost2 = ctx.figure(fr.afterimage2, fr.afterimage2.at); st.ghost2.face(ctx.player.x, ctx.player.y); }
      // the world holds a breath (the first time, the title falls on it), and then the one thing to do
      if (first) later(900, () => title(`${S.title || ''}${ep.no ? ` · Episode ${ep.no}` : ''}`, ep.title || '', 3.0));
      later(first ? 4300 : 1300, () => {
        if (st.phase !== 'stop' || st.beat !== 'still') return;
        show(); frames.classList.add('on');
        if (!a || !(a.lines || []).length) return task();
        st.beat = 'seek'; st.from = [ctx.player.x, ctx.player.y];
        goal(a.seek || 'Someone is still moving. Go to them.');
        aimAt(spot([st.ghost.x, st.ghost.y, st.ghost.z]));
        if (!st.hinted) { st.hinted = true; hint(true); }
      });
    }
    // the photograph: of what, from where
    function task() {
      if (!st.fr.task) { resume(); return; }
      st.beat = 'shoot'; goalText = '';
      shutter.classList.add('on'); finder.classList.add('on');
    }
    // where the frame stands: in place, and on its subject
    function framed() {
      const T = st.fr.task, placed = !T.stand || near(T.stand, T.within_m || 4);
      let aimed;
      if (T.both) aimed = [st.ghost, st.ghost2].every(g => { if (!g) return true; const q = ctx.screen([g.x, g.y, g.z + 1.2]); return q.front && q.x > 0.06 && q.x < 0.94 && q.y > 0.06 && q.y < 0.94; });
      else aimed = !T.subject || ctx.aim(T.subject) <= (T.within_deg || 40);
      return { placed, aimed };
    }
    function shoot() {
      if (st.phase !== 'stop' || st.beat !== 'shoot') return;
      const fr = st.fr, T = fr.task, G = T.goals || {}, f = framed();
      if (!f.placed || !f.aimed) { goal(!f.placed ? G.stand || 'Not from here. Go to the light.' : G.aim || 'Turn towards the light, then take the picture.'); st.miss = 2.5; return; }
      // (the frame without the goal's marks on it: the beacon is a guide, not a thing in the street)
      ctx.beacon(null);
      let print = null;
      try { print = ctx.snap(); } catch (e) { print = null; }
      st.prints.push({ src: print, stamp: fr.stamp || '', cap: fr.caption || '' });
      pulse();
      st.left = Math.max(0, st.left - 1); show();
      shutter.classList.remove('on'); finder.classList.remove('on'); aimAt(null); goal('');
      st.beat = 'shown';
      if (fr.finale) return finale();
      later(900, () => ((T.lines || []).length ? ctx.say(who(fr.afterimage || {}), T.lines, () => resume()) : resume()));
    }
    // the last frame: every light to walk, and the two of them leave their kerbs and meet in the middle
    function finale() {
      const a = st.ghost, b = st.ghost2 || st.ghost, mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      ctx.walkIn(0);
      for (const g of [st.ghost, st.ghost2]) if (g) { const dx = g.x - mid[0], dy = g.y - mid[1], l = Math.hypot(dx, dy) || 1; g.walkTo(mid[0] + dx / l * 0.45, mid[1] + dy / l * 0.45, 1.1); }
      st.beat = 'meeting'; st.t = 0;
    }
    function resume(late) {
      const fr = st.fr;
      st.phase = 'after'; st.t = 0; st.beat = ''; st.late = !!late;
      veil.classList.remove('on'); ctx.stage.classList.remove('story-stop');
      shutter.classList.remove('on'); finder.classList.remove('on'); hint(false); aimAt(null); goal('');
      ctx.hush(false);
      pulse();
      for (const k of ['ghost', 'ghost2']) if (st[k]) { st[k].remove(); st[k] = null; }
      const said = late ? [fr.late || 'The lights changed. Come back to where it stopped, and it will stop again.'] : fr.after || [];
      said.forEach((line, i) => later(1400 + i * 4200, () => ctx.toast(esc(line))));
      st.wait = late ? 7 : 2.5 + said.length * 4.2;
      if (!late && fr.finale && st.cast[fr.crosses]) { const c = st.cast[fr.crosses]; c.walkTo(fr.cross_to[0], fr.cross_to[1], 0.8); } // (and the living cross)
    }
    // the last card: the whole roll, what it was, and two ways on
    function end() {
      const ep = st.ep, E = typeof ep.end === 'string' ? { title: ep.end } : ep.end || {};
      st.phase = 'done';
      forget();
      frames.classList.remove('on'); goal('');
      const last = st.prints[st.prints.length - 1];
      endEl.innerHTML = `<div class="card">${last && last.src ? `<figure><img alt="The last photograph you took" src="${last.src}"><figcaption><span>Frame ${st.prints.length} of ${N}</span><span>${esc(last.stamp)}</span></figcaption></figure>` : ''}
${st.prints.length > 1 ? `<ol class="sheet">${st.prints.slice(0, -1).map((p, i) => `<li>${p.src ? `<img alt="Frame ${i + 1}" src="${p.src}">` : ''}<span>${i + 1} · ${esc(p.stamp)}</span></li>`).join('')}</ol>` : ''}
<small>${esc(S.title || '')}${ep.no ? ` · Episode ${ep.no}` : ''}</small><h2>${esc(E.title || 'To be continued')}</h2>
${E.line ? `<p>${esc(E.line)}</p>` : ''}${E.next ? `<p class="next">${esc(E.next)}</p>` : ''}
<div class="row"><button type="button" class="go" data-do="free">${esc(E.free || 'Walk the city')}</button><button type="button" data-do="again">Play it again</button></div></div>`;
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
      const ep = st.ep, fr = st.fr;
      if (!ep || st.phase === 'idle' || st.phase === 'dressed' || st.phase === 'done') return;
      st.t += dt;
      for (const id in st.cast) if (st.phase !== 'stop') st.cast[id].animate(dt); // (the living hold still with the world)
      if (st.phase === 'go') {
        goalEl.querySelector('small').textContent = `${S.title || ''} · Frame ${st.fi + 1} of ${N}`;
        if (st.beat === 'meet') {
          const m = living(fr.meet);
          if (!m) approach();
          else if (near([m.x, m.y, m.z], fr.meet.reach_m || 3)) {
            st.beat = 'talk'; aimAt(null); goal('');
            if (m.face) m.face(ctx.player.x, ctx.player.y);
            const w = { name: m.name || '', role: m.role || '', alive: true };
            ctx.say(w, fr.meet.lines || [], () => ask(fr.meet, w, () => approach()));
          }
        } else if (st.beat === 'approach') {
          const a = fr.afterimage, at = fr.stop_at || (a && a.at);
          if (fr.lead_s != null && !st.late ? st.t >= fr.lead_s : !at || (near(at, fr.stop_r || 12) && st.t > (st.late ? 6 : 0.5))) stop();
        }
        markTick();
      } else if (st.phase === 'stop') {
        const g = st.ghost, a = fr.afterimage, leftS = Math.max(0, (fr.stop_s || 420) - st.t);
        goalEl.querySelector('small').textContent = st.beat === 'meeting' ? S.title || '' : `The Stop · ${clockOf(leftS)}`;
        for (const q of [g, st.ghost2]) if (q) { q.animate(dt); if (!q.to) q.face(ctx.player.x, ctx.player.y); }
        if (st.beat === 'seek') {
          // the keys are put away once they have been used
          if (st.from && Math.hypot(ctx.player.x - st.from[0], ctx.player.y - st.from[1]) > 3) { st.from = null; hint(false); }
          if (g && near([g.x, g.y, g.z], a.reach_m || 3.2)) {
            st.beat = 'talk'; hint(false); aimAt(null); goal('');
            ctx.say(who(a), a.lines || [], () => task());
          }
        }
        if (st.beat === 'shoot') { // the goal says where to stand, then when the lens is on it, and the button shows it
          const T = fr.task, G = T.goals || {}, f = framed(), on = f.placed && f.aimed;
          const text = !f.placed ? G.stand || 'Find where this was taken from.' : on ? G.ready || 'That is it. Take the picture.' : G.shoot || 'Raise the camera and take the picture.';
          if (text !== goalText && !st.miss) goal(text);
          if (st.miss) st.miss = Math.max(0, st.miss - dt);
          const want = !f.placed ? spot(T.stand) : T.subject ? [T.subject[0], T.subject[1], T.subject[2], T.subject[2]] : null;
          if (String(want) !== String(st.target)) aimAt(want);
          if (f.placed && T.subject) ctx.beacon(null); // (the subject is marked in the frame, with no light standing on it)
          shutter.classList.toggle('ready', on);
        }
        if (st.beat === 'meeting') { // they meet where you stand, and go out like a breath let go
          const met = [g, st.ghost2].every(q => !q || !q.to);
          if (met && !st.met) { st.met = st.t; pulse(); }
          if ((st.met && st.t > st.met + 2.6) || st.t > 40) resume();
        }
        markTick();
        if (leftS <= 0 && (st.beat === 'seek' || st.beat === 'shoot' || st.beat === 'still')) resume(true);
      } else if (st.phase === 'after' && st.t > st.wait) {
        if (st.late) { st.phase = 'go'; approach(); }
        else if (st.fi + 1 < ep.frames.length) frame(st.fi + 1);
        else end();
      }
    }
    return {
      dress, begin, tick, shoot, state: st,
      get stopped() { return st.phase === 'stop'; },
      get finder() { return st.phase === 'stop' && st.beat === 'shoot'; }, // the camera is raised: the game shows the lens's view
      get on() { return st.phase !== 'idle' && st.phase !== 'done'; },
      dispose() {
        timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); ctx.beacon(null);
        ctx.stage.classList.remove('story', 'story-on', 'story-stop');
        for (const e of [frames, card, veil, flash, goalEl, mark, keys, finder, shutter, endEl]) e.remove();
        for (const k of ['ghost', 'ghost2']) if (st[k]) st[k].remove();
        for (const id in st.cast) st.cast[id].remove();
      },
    };
  }
  return { create };
})();
