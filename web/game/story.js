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
  //        hold(on): time held or let go (what hangs in the air), air(opts): the scene's leaves and birds, ride({to, name}): a car sent for you, film(spec, then): a flight, dress(date, light, weather), weather(kind), walkIn(seconds), floor(x, y) -> the ground's height there,
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
      // a case left unfinished in this browser: the button says so (which frame it takes up at), and a second one starts
      // the evening again from its first frame; nobody opens the page into the rain of the last frame without being told
      let left = null;
      try { left = JSON.parse(localStorage.getItem(`oe-story-${ep0.id}`) || 'null'); } catch (e) { left = null; }
      const going = left && left.fi > 0 && left.fi < (ep0.frames || []).length;
      if (q('#gt-play')) q('#gt-play').innerHTML = `<span>${going ? `Continue · frame ${left.fi + 1} of ${N}` : `${ep0.no ? `Episode ${esc(ep0.no)} · ` : ''}${esc(ep0.title || 'Begin')}`}</span><kbd>↵</kbd>`;
      if (going && q('#gt-play') && !q('#gt-anew')) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'gt-anew'; b.textContent = 'Start the evening again';
        b.addEventListener('click', () => { try { localStorage.removeItem(`oe-story-${ep0.id}`); } catch (e) { /* storage blocked */ } q('#gt-play').click(); });
        q('#gt-play').after(b);
      }
    }
    const el = (id, html, tag = 'div') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; ctx.stage.appendChild(e); return e; };
    const frames = el('g-story-frames', `<span><b></b>frames left</span><span class="strip">${'<i></i>'.repeat(N)}</span><em>${ctx.touch ? 'Tap' : '<kbd>Tab</kbd>'} · the roll</em>`, 'button'), card = el('g-story-card', '<div><small></small><span></span></div>'), veil = el('g-story-veil', ''), flash = el('g-story-flash', '');
    const goalEl = el('g-story-goal', '<small></small><span></span><em></em>'), mark = el('g-story-mark', '<u></u><i></i><b></b>'), keys = el('g-story-keys', ''), finder = el('g-story-finder', '');
    const shutter = el('g-story-shutter', `<i></i>Take the picture${ctx.touch ? '' : ' <kbd>F</kbd> · wheel: the lens'}`, 'button'), endEl = el('g-story-end', '');
    shutter.type = 'button';
    // the camera in the hand or at the eye: a button that says which, and what the key does; and a word in the middle of
    // the frame whenever something changes that the player did not do (time stopping, time running, the camera going down)
    const camBtn = el('g-story-cam', '', 'button'), chip = el('g-story-chip', '');
    camBtn.type = 'button';
    const sfx = name => { if (ctx.sfx) ctx.sfx(name); };
    const say = text => { sfx('word'); chip.textContent = text; chip.classList.remove('on'); void chip.offsetWidth; chip.classList.add('on'); };
    const camLabel = () => { camBtn.innerHTML = st.cam ? `<i></i>Lower the camera${ctx.touch ? '' : ' <kbd>R</kbd>'}` : `<i></i>Raise the camera${ctx.touch ? '' : ' <kbd>R</kbd>'}`; };
    function raise(on) {
      if (st.phase !== 'stop' || st.beat !== 'shoot' || st.cam === on) return;
      st.cam = on; camLabel(); camBtn.classList.toggle('up', on);
      shutter.classList.toggle('on', on); finder.classList.toggle('on', on);
      say(on ? `Camera up${finder.dataset.year ? ` · it sees ${finder.dataset.year}` : ''}` : 'Camera down'); sfx(on ? 'cam-up' : 'cam-down');
    }
    camBtn.addEventListener('click', () => raise(!st.cam));
    // a print's postmark: struck on it when it is taken, as a letter's stamp is cancelled; the place round the top,
    // the hour in the middle, the frame under it, and the wavy lines of the cancel running off to the side
    let pmN = 0;
    const postmark = (stamp, n) => { const id = `pm${++pmN}`, parts = String(stamp || '').split(/\s*·\s*/), hour = parts[parts.length - 1], place = parts.length > 1 ? parts.slice(0, -1).join(' · ') : (S.place || 'SHIBUYA · 渋谷');
      return `<svg class="pm" viewBox="0 0 212 120" aria-hidden="true"><defs><path id="${id}a" d="M16 60 a44 44 0 0 1 88 0"/><path id="${id}b" d="M10 60 a50 50 0 0 0 100 0"/></defs>
<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="60" cy="60" r="55"/><circle cx="60" cy="60" r="33" stroke-width="1.4"/>${[30, 46, 62, 78, 94].map(y => `<path d="M122 ${y} q11 -9 22 0 t22 0 t22 0 t22 0"/>`).join('')}</g>
<g fill="currentColor" font-family="ui-monospace, monospace" text-anchor="middle"><text font-size="10.5" letter-spacing="1.5"><textPath href="#${id}a" startOffset="50%">${esc(place.toUpperCase().slice(0, 22))}</textPath></text>
<text font-size="9.5" letter-spacing="2"><textPath href="#${id}b" startOffset="50%">${esc((S.title || '').toUpperCase())}</textPath></text>
<text x="60" y="59" font-size="16" font-weight="600">${esc(hour)}</text><text x="60" y="74" font-size="8.5" letter-spacing="1.5">FRAME ${n} OF ${N}</text></g></svg>`; };
    // the print in your hand for a moment after the shutter: the picture, its postmark struck on it, then away to the roll
    const printEl = el('g-story-print', '');
    function showPrint(p, n) {
      if (!p || !p.src) return;
      printEl.innerHTML = `<figure><img alt="" src="${p.src}">${postmark(p.stamp, n)}<figcaption><b>${n}</b>${esc(p.cap || p.stamp || '')}</figcaption></figure>`;
      printEl.classList.remove('on'); void printEl.offsetWidth; printEl.classList.add('on');
      later(720, () => sfx('stamp')); // (the postmark comes down)
      later(4200, () => printEl.classList.remove('on'));
    }
    // the roll so far: every print kept, laid out as prints on a table; opened from the film strip or with Tab
    const album = el('g-story-album', '');
    const fileName = n => `blue-hour-${(st.ep && st.ep.id) || 'roll'}-${n}`;
    function albumDraw(big) {
      const P = st.prints, cell = i => { const p = P[i]; return p ? `<li class="${i === big ? 'big' : ''}" style="--r:${((i * 37) % 7 - 3) * 0.6}deg"><button type="button" data-i="${i}" aria-label="Frame ${i + 1}">${p.src ? `<img alt="" src="${p.src}">` : '<i></i>'}${postmark(p.stamp, i + 1)}<span><b>${i + 1}</b>${esc(p.stamp)}</span></button>${p.cap ? `<p>${esc(p.cap)}</p>` : ''}${p.src ? `<a download="${fileName(`frame-${i + 1}`)}.jpg" href="${p.src}">Save this print</a>` : ''}</li>` : `<li class="blank"><span><b>${i + 1}</b>not yet taken</span></li>`; };
      album.innerHTML = `<div class="table"><header><small>${esc(S.title || '')}${st.ep && st.ep.no ? ` · Episode ${st.ep.no}` : ''}</small><h2>The roll</h2><span>${P.length} of ${N} frames taken</span></header>
<ol>${Array.from({ length: N }, (_, i) => cell(i)).join('')}</ol>
<div class="row">${P.some(p => p.src) ? '<button type="button" data-do="sheet">Save the contact sheet</button>' : ''}<button type="button" class="go" data-do="close">Back to the street${ctx.touch ? '' : ' <kbd>Tab</kbd>'}</button></div></div>`;
    }
    function albumOpen(on) {
      if (on && (st.phase === 'idle' || st.phase === 'dressed')) return;
      album.classList.toggle('on', on);
      if (on) { albumDraw(-1); if (document.exitPointerLock) document.exitPointerLock(); }
    }
    // the whole roll as one picture, to keep: the frames in a strip of film, numbered and stamped
    function saveSheet() {
      const P = st.prints, w = 560, h = 374, pad = 28, cols = 4, rows = Math.ceil(N / cols), c = document.createElement('canvas'), x = c.getContext('2d');
      c.width = pad + cols * (w + pad); c.height = 150 + rows * (h + 74) + 40;
      x.fillStyle = '#0b0d12'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#f4efe6'; x.font = '200 54px sans-serif'; x.textBaseline = 'top'; x.fillText((S.title || '').toUpperCase().split('').join(' '), pad, 40);
      x.fillStyle = '#ffcf8a'; x.font = '22px monospace'; x.fillText(`${st.ep && st.ep.no ? `EPISODE ${st.ep.no} · ` : ''}${((st.ep && st.ep.title) || '').toUpperCase()} · ${P.length} OF ${N} FRAMES`, pad, 104);
      Promise.all(P.map(p => new Promise(res => { if (!p.src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = p.src; }))).then(ims => {
        for (let i = 0; i < N; i++) {
          const X = pad + (i % cols) * (w + pad), Y = 150 + Math.floor(i / cols) * (h + 74), im = ims[i];
          x.fillStyle = '#05060a'; x.fillRect(X, Y, w, h);
          if (im) { const k = Math.max(w / im.width, h / im.height), sw = w / k, sh = h / k; x.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, X, Y, w, h); }
          x.strokeStyle = 'rgba(244,239,230,0.25)'; x.strokeRect(X + 0.5, Y + 0.5, w - 1, h - 1);
          x.fillStyle = '#ffcf8a'; x.font = '20px monospace'; x.fillText(`${i + 1}${P[i] ? ` · ${P[i].stamp}` : ''}`.toUpperCase().slice(0, 44), X, Y + h + 14);
        }
        c.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${fileName('contact-sheet')}.jpg`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/jpeg', 0.9);
      });
    }
    album.addEventListener('click', e => {
      const d = e.target.closest('button[data-do]'), b = e.target.closest('button[data-i]');
      if (d) return d.dataset.do === 'sheet' ? saveSheet() : albumOpen(false);
      if (b) { const li = b.parentNode, was = li.classList.contains('big'); album.querySelectorAll('li.big').forEach(q => q.classList.remove('big')); li.classList.toggle('big', !was); return; }
      if (e.target === album) albumOpen(false);
    });
    goalEl.setAttribute('role', 'status'); goalEl.setAttribute('aria-live', 'polite');
    const pulse = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
    // phase: idle, dressed, go (the world runs: a word with the living, the way to the next place), stop, after, done
    const st = { ep: null, phase: 'idle', beat: '', t: 0, left: N, fi: 0, fr: null, ghost: null, ghost2: null, target: null, prints: [], from: null, late: false, miss: 0, cast: {}, hinted: false, asked: 0, k: 1, orbit: 0 };
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
      const fresh = !goalText && st.beat !== 'shoot'; // (not with the camera up: the middle of the frame is the picture's) // (a goal where there was none is announced: it arrives large in the middle of the frame, then goes up to its line)
      goalText = text || '';
      if (!goalText) { goalEl.classList.remove('on', 'new'); return; }
      if (fresh) sfx('goal');
      goalEl.querySelector('span').textContent = goalText;
      if (fresh) { goalEl.classList.remove('new'); void goalEl.offsetWidth; goalEl.classList.add('new'); }
      goalEl.classList.add('on');
    }
    const clockOf = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    // a place as the beacon and the mark want it: [x, y, the height of a head there, the floor]
    const spot = p => { const z = p[2] != null ? p[2] : ctx.floor(p[0], p[1]); return [p[0], p[1], z + 1.2, z]; };
    const near = (p, r) => Math.hypot(p[0] - ctx.player.x, p[1] - ctx.player.y) < r && (p[2] == null || Math.abs(p[2] - ctx.player.z) < 4);
    // where the goal is: the light in the world, and its mark in the frame (held at the edge on the side it lies)
    function aimAt(at, turn) { st.target = at; ctx.beacon(at); if (!at) mark.classList.remove('on'); else if (turn && ctx.look) ctx.look(at); } // (turn: the view is brought round to it, so that a new goal is in front of you)
    function markTick() {
      if (!st.target) return;
      const via = ctx.via ? ctx.via(st.target) : null, to = via || st.target; // (a place up a tower: the lift's door first)
      if (String(via) !== String(st.via)) { st.via = via; ctx.beacon(to); }
      const q = ctx.screen(to), W = ctx.stage.clientWidth, H = ctx.stage.clientHeight, m = 46;
      let x = q.x * W, y = q.y * H;
      if (!q.front) { x = W - x; y = H - m; } // (behind: its mark at the foot of the frame, on its side)
      const off = !q.front || x < m || x > W - m || y < m || y > H - m;
      x = Math.max(m, Math.min(W - m, x)); y = Math.max(m + 70, Math.min(H - m, y));
      mark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      mark.querySelector('b').textContent = `${Math.max(1, Math.round(q.dist))} m${off ? (q.front ? '' : ' · behind you') : ''}`;
      mark.classList.toggle('on', q.dist > 4); mark.classList.toggle('off', off);
      if (off) mark.style.setProperty('--a', `${Math.atan2(y - H / 2, x - W / 2).toFixed(3)}rad`); // (its arrow points the way to turn)
    }
    const KEYS = ctx.touch ? '<span>Left thumb · walk</span><span>Drag · look</span>' : '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>walk</span><span><kbd>Shift</kbd>run</span><span>Mouse · look</span>';
    function hint(on) { if (on) keys.innerHTML = KEYS; keys.classList.toggle('on', on); }
    const voiceOf = a => Object.assign(a.year ? { pitch: 170, past: 1 } : a.age >= 70 ? { pitch: 160, breath: 1 } : { pitch: 200 }, a.voice || {}); // (someone of another year is heard twice; the old have breath in it)
    const who = a => ({ name: a.name || '', role: a.year ? String(a.year) : [a.age ? `${a.age}` : '', a.role || ''].filter(Boolean).join(' · '), alive: !a.year, voice: voiceOf(a) }); // (the living: their age tonight; an afterimage: its year)

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
      for (const [i, r] of (ep.set || []).entries()) if (ctx.relic && !st[`set${i}`]) st[`set${i}`] = ctx.relic(Object.assign({ set: true }, r)); // (tonight's own set dressing: a lift's doors, a sign)
      for (const c of ep.cast || []) if (!st.cast[c.id]) st.cast[c.id] = Object.assign(ctx.figure(Object.assign({ alive: true }, c), c.at), { name: c.name, role: c.role, age: c.age, voice: c.voice });
      const k = kept();
      if (k) { st.left = k.left; st.prints = k.prints; }
      if (ep.walk_in_s != null && !k) ctx.walkIn(ep.walk_in_s);
      show(); if (k) frames.classList.add('on');
      // a case begun at its first frame opens on a voice: who you are, why you are on this kerb at this hour, and the one
      // odd thing about the job (ep.prologue: {who, voice, lines}); a case taken up again goes straight to its frame
      const P = !k && ep.prologue;
      if (P && (P.lines || []).length) { st.phase = 'go'; st.beat = 'prologue'; ctx.say(Object.assign({ alive: true, voice: Object.assign({ pitch: 150 }, P.voice || {}) }, P.who || {}), P.lines, () => frame(0)); }
      else frame(k ? k.fi : 0);
    }
    // a frame begins: the sky it has, a word with the living if there is one, and the way to where the world will stop
    function frame(i) {
      const fr = st.ep.frames[i];
      st.fi = i; st.fr = fr; st.phase = 'go'; st.t = 0; st.late = false; st.asked = 0;
      if (fr.weather) ctx.weather(fr.weather, !!fr.wet);
      keep();
      // the scene's air (leaves, birds), made again only where the scene's differs; and a car, where the frame sends one
      { const a = JSON.stringify(fr.air || (fr.weather === 'rain' || st.rain ? { leaves: 40, birds: 0 } : {})); if (a !== st.air && ctx.air) { st.air = a; ctx.air(JSON.parse(a)); } }
      // the score, set to the scene: the evening going into night as the frames go, the roof's air, the rain
      if (ctx.score) ctx.score(Object.assign({ slot: i < 3 ? 'evening' : 'night', hour: 17.3 + i * 0.55, rain: fr.weather === 'rain' || st.rain ? 0.8 : 0, mode: i === 3 ? 'heli' : 'foot' }, fr.score || {}));
      if (fr.weather === 'rain' && !st.rain) { st.rain = true; later(1500, () => { say('It has begun to rain'); sfx('rain'); }); }
      const go = () => {
        if (st.fr !== fr) return;
        // a frame reached by car: one is sent, the goal is the car until you are in it, and the frame goes on where it sets you down
        // (or where you walk to: nobody has to take it)
        if (fr.ride && ctx.ride && !st.rode && ctx.ride(fr.ride)) { st.rode = true; st.beat = 'ride'; st.rideGo = go; goal(fr.ride.line || 'A car is coming for you.'); return; }
        st.rode = false;
        if (fr.meet) { st.beat = 'meet'; goal(fr.meet.goal || ''); const m = living(fr.meet); if (m) aimAt(spot([m.x, m.y, m.z]), true); }
        else approach();
      };
      // a frame reached by air: the flight to it first (ctx.film: the helicopter, the city under it, and the place it sets you down)
      if (fr.flight && ctx.film) { st.beat = 'flight'; goal(''); aimAt(null); frames.classList.remove('on'); ctx.film(fr.flight, () => { frames.classList.add('on'); go(); }); }
      else go();
    }
    const living = m => (m.cast ? st.cast[m.cast] : ctx.person(m.npc));
    function approach() {
      const fr = st.fr, a = fr.afterimage;
      st.beat = 'approach'; st.t = 0;
      goal(fr.goal || '');
      aimAt(fr.lead_s != null || !(fr.stop_at || a) ? null : spot(fr.stop_at || a.at), true);
    }
    // what the living ask: each question until it is answered rightly (a wrong answer costs nothing but the look they give you)
    function ask(m, w, done) {
      const q = (m.ask || [])[st.asked];
      if (!q) return done();
      ctx.ask(w, [q.q], q.options.map(text => ({ text })), c => {
        sfx(c && q.options.indexOf(c.text) === q.answer ? 'right' : 'wrong');
        if (c && q.options.indexOf(c.text) === q.answer) { st.asked++; return q.right ? ctx.say(w, [q.right], () => ask(m, w, done)) : ask(m, w, done); }
        ctx.say(w, [q.wrong || 'No. Look at the prints again.'], () => ask(m, w, done));
      });
    }
    function stop() {
      const ep = st.ep, fr = st.fr, a = fr.afterimage, first = st.fi === 0 && !st.late;
      st.phase = 'stop'; st.t = 0; st.beat = 'still';
      veil.classList.add('on'); ctx.stage.classList.add('story-stop');
      ctx.hush(true); ctx.hold(true); sfx('stop'); if (ctx.held) ctx.held(true);
      if (fr.light && ctx.light) ctx.light(fr.light); // (a Stop that goes back to an hour: the last one, to the blue hour she waited at)
      pulse();
      if (!first) say('Time has stopped');
      // the view turns through the held street: once round the first time, a quarter turn every time after, so that
      // what hangs in the air is seen to hang (it is the camera moving that shows a moment is held)
      st.orbit = first ? 0.5 : 0.32; later(first ? 4200 : 1500, () => { st.orbit = 0; }); // (the first time, the view turns round you through the held street)
      if (a && !st.ghost) { st.ghost = ctx.figure(a, a.at); st.ghost.face(ctx.player.x, ctx.player.y); }
      if (fr.afterimage2 && !st.ghost2) { st.ghost2 = ctx.figure(fr.afterimage2, fr.afterimage2.at); st.ghost2.face(ctx.player.x, ctx.player.y); }
      // the world holds a breath (the first time, the title falls on it), and then the one thing to do
      if (first) later(900, () => title(`${S.title || ''}${ep.no ? ` · Episode ${ep.no}` : ''}`, ep.title || '', 3.0));
      later(first ? 4300 : 1300, () => {
        if (st.phase !== 'stop' || st.beat !== 'still') return;
        show(); frames.classList.add('on');
        if (!a || !(a.lines || []).length) return task();
        st.beat = 'seek'; st.from = [ctx.player.x, ctx.player.y];
        // the guide (ep.guide, companion.js): the dog the bronze by the station is of walks in every Stop. He comes to you
        // (from beside his plinth where that is near, else from a few steps off), goes ahead of you to whoever is still
        // moving, waits when you fall behind, and sits by them
        const gd = st.ep.guide;
        if (gd && ctx.guide && !st.dog) {
          const d = ctx.guide(gd);
          if (d) { const nearHome = gd.from && near(gd.from, 70), at = nearHome ? gd.from : [ctx.player.x + 3, ctx.player.y + 2.5]; d.place(at[0], at[1], Math.atan2(ctx.player.y - at[1], ctx.player.x - at[0])); st.dog = d; if (st.fi === 0 && gd.line) later(600, () => ctx.toast(esc(gd.line))); }
        }
        if (st.dog && st.ghost) st.dog.lead([st.ghost.x, st.ghost.y], a.reach_m || 3.2);
        goal(a.seek || 'Someone is still moving. Go to them.');
        aimAt(spot([st.ghost.x, st.ghost.y, st.ghost.z]), true);
        if (!st.hinted) { st.hinted = true; hint(true); }
      });
    }
    // the photograph: of what, from where
    function task() {
      if (!st.fr.task) { resume(); return; }
      st.beat = 'shoot'; goalText = '';
      if (st.fr.task.relic && ctx.relic && !st.relic) st.relic = ctx.relic(st.fr.task.relic); // (what the camera sees here that tonight does not have)
      finder.dataset.year = (st.fr.afterimage && st.fr.afterimage.year) || ''; // (the year the finder shows: the camera sees the evening it was loaded for)
      st.cam = false; camLabel(); camBtn.classList.remove('up'); camBtn.classList.add('on');
      // (the guide goes to sit where the picture is taken from, or beside what it is of, looking at it)
      if (st.dog) { const T = st.fr.task, R = T.relic, px = ctx.player.x, py = ctx.player.y; let to = T.stand ? [T.stand[0] + 1.2, T.stand[1] + 0.8] : null; if (!to && R && Math.hypot(R.at[0] - px, R.at[1] - py) < 30) { const l = Math.hypot(px - R.at[0], py - R.at[1]) || 1; to = [R.at[0] + (px - R.at[0]) / l * 2.2 + 0.8, R.at[1] + (py - R.at[1]) / l * 2.2]; } if (to) st.dog.go(to, R ? [R.at[0], R.at[1], (R.at[2] != null ? R.at[2] : ctx.floor(R.at[0], R.at[1])) + 0.8] : T.subject || null); } // (in the hand: the player raises it)
    }
    // the finder's rectangle in the picture, as fractions from its top left
    const finderRect = () => { const f = finder.getBoundingClientRect(), s = ctx.stage.getBoundingClientRect(); return [(f.left - s.left) / s.width, (f.top - s.top) / s.height, (f.right - s.left) / s.width, (f.bottom - s.top) / s.height]; };
    // where the frame stands: in place, and on its subject
    function framed() {
      const T = st.fr.task, placed = !T.stand || near(T.stand, T.within_m || 4);
      let aimed;
      if (!st.cam) aimed = false; // (nothing is framed with the camera down)
      else if (T.relic) { const R = T.relic, z = R.at[2] != null ? R.at[2] : ctx.floor(R.at[0], R.at[1]), q = ctx.screen([R.at[0], R.at[1], z + (R.eye ?? 0.6)]), r = finderRect(); aimed = q.front && q.x > r[0] && q.x < r[2] && q.y > r[1] && q.y < r[3]; } // (the thing itself, inside the bright lines)
      else if (T.both) aimed = [st.ghost, st.ghost2].every(g => { if (!g) return true; const q = ctx.screen([g.x, g.y, g.z + 1.2]); return q.front && q.x > 0.06 && q.x < 0.94 && q.y > 0.06 && q.y < 0.94; });
      else aimed = !T.subject || ctx.aim(T.subject) <= (T.within_deg || 40);
      return { placed, aimed };
    }
    function shoot() {
      if (st.phase !== 'stop' || st.beat !== 'shoot') return;
      const fr = st.fr, T = fr.task, G = T.goals || {};
      if (!st.cam) return raise(true); // (the release with the camera down brings it up)
      const f = framed();
      if (!f.placed || !f.aimed) { goal(!f.placed ? G.stand || 'Not from here. Go to the light.' : G.aim || 'Turn towards the light, then take the picture.'); st.miss = 2.5; return; }
      // (the frame without the goal's marks on it: the beacon is a guide, not a thing in the street)
      ctx.beacon(null);
      let print = null;
      try { print = ctx.snap(); } catch (e) { print = null; }
      st.prints.push({ src: print, stamp: fr.stamp || '', cap: fr.caption || (T.relic && T.relic.cap) || '' });
showPrint(st.prints[st.prints.length - 1], st.prints.length);
      frames.classList.remove('kept'); void frames.offsetWidth; frames.classList.add('kept'); // (the strip says the print is kept, and where the roll is)
      pulse(); sfx('shutter'); sfx('wind');
      st.left = Math.max(0, st.left - 1); show();
      shutter.classList.remove('on'); finder.classList.remove('on'); camBtn.classList.remove('on', 'up'); st.cam = false; aimAt(null); goal('');
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
      shutter.classList.remove('on'); finder.classList.remove('on'); camBtn.classList.remove('on', 'up'); st.cam = false; hint(false); aimAt(null); goal('');
      ctx.hush(false); ctx.hold(false); st.orbit = 0;
      say('Time runs again'); sfx('run'); if (ctx.held) ctx.held(false);
      pulse();
      for (const k of ['ghost', 'ghost2', 'relic']) if (st[k]) { st[k].remove(); st[k] = null; }
      if (st.dog) { const d = st.dog; st.dog = null; d.leave((st.ep.guide || {}).from || [d.x, d.y], () => d.remove()); st.gone = d; } // (the guide runs off as the world runs on, and is gone before he gets anywhere)
      if (ctx.finder) ctx.finder(null);
      const said = late ? [fr.late || 'The lights changed. Come back to where it stopped, and it will stop again.'] : fr.after || [];
      said.forEach((line, i) => later(1400 + i * 4200, () => ctx.toast(esc(line))));
      st.wait = late ? 7 : 2.5 + said.length * 4.2;
      if (!late && fr.finale && st.cast[fr.crosses]) { const c = st.cast[fr.crosses]; c.walkTo(fr.cross_to[0], fr.cross_to[1], 0.8); } // (and the living cross)
    }
    // the last card: the whole roll, what it was, and two ways on
    function end() {
      const ep = st.ep, E = typeof ep.end === 'string' ? { title: ep.end } : ep.end || {};
      st.phase = 'done';
      forget(); sfx('end'); if (ctx.held) ctx.held(false);
      frames.classList.remove('on'); goal('');
      const last = st.prints[st.prints.length - 1];
      endEl.innerHTML = `<div class="card">${last && last.src ? `<figure><img alt="The last photograph you took" src="${last.src}"><figcaption><span>Frame ${st.prints.length} of ${N}</span><span>${esc(last.stamp)}</span></figcaption></figure>` : ''}
${st.prints.length > 1 ? `<ol class="sheet">${st.prints.slice(0, -1).map((p, i) => `<li>${p.src ? `<img alt="Frame ${i + 1}" src="${p.src}">` : ''}<span>${i + 1} · ${esc(p.stamp)}</span></li>`).join('')}</ol>` : ''}
<small>${esc(S.title || '')}${ep.no ? ` · Episode ${ep.no}` : ''}</small><h2>${esc(E.title || 'To be continued')}</h2>
${E.line ? `<p>${esc(E.line)}</p>` : ''}${E.next ? `<p class="next">${esc(E.next)}</p>` : ''}
<div class="row">${st.prints.some(p => p.src) ? '<button type="button" data-do="sheet">Save the contact sheet</button>' : ''}<button type="button" class="go" data-do="free">${esc(E.free || 'Walk the city')}</button><button type="button" data-do="again">Play it again</button></div></div>`;
      endEl.classList.add('on');
      requestAnimationFrame(() => endEl.classList.add('in'));
      const go = endEl.querySelector('button.go');
      if (go) go.focus({ preventScroll: true });
    }
    endEl.addEventListener('click', e => { const b = e.target.closest('button[data-do]'); if (b) (b.dataset.do === 'sheet' ? saveSheet : b.dataset.do === 'again' ? ctx.again : ctx.free)(); });
    shutter.addEventListener('click', shoot);
    frames.type = 'button'; frames.addEventListener('click', () => albumOpen(true));
    const onKey = e => {
      if (e.code === 'KeyF' && !e.repeat && st.beat === 'shoot') { e.preventDefault(); e.stopPropagation(); shoot(); }
      else if (e.code === 'KeyR' && !e.repeat && st.phase === 'stop' && st.beat === 'shoot') { e.preventDefault(); e.stopPropagation(); raise(!st.cam); }
      else if ((e.code === 'Tab' || (e.code === 'Escape' && album.classList.contains('on'))) && !e.repeat && st.phase !== 'idle' && st.phase !== 'dressed' && st.phase !== 'done') { e.preventDefault(); e.stopPropagation(); albumOpen(!album.classList.contains('on')); }
    };
    addEventListener('keydown', onKey, true);

    function tick(dt) {
      const ep = st.ep, fr = st.fr;
      if (st.gone) { st.gone.tick(dt); if (st.gone.state === 'away') st.gone = null; } // (a guide on his way off)
      if (!ep || !fr || st.phase === 'idle' || st.phase === 'dressed' || st.phase === 'done') return;
      { // under the goal, how: one plain line for whoever has not played a game like this (and the first frame says the keys)
        const K = ctx.touch ? 'Left thumb walks, drag to look.' : 'W A S D walk · mouse looks · Shift runs.', f = st.beat === 'shoot' && fr.task ? framed() : null;
        const how = !goalText ? '' : st.beat === 'meet' ? 'Walk up to them: they speak when you are close.' : st.beat === 'approach' ? `Follow the ring. ${st.fi === 0 ? K : ''}` : st.beat === 'seek' ? `${st.dog ? `Follow ${(st.ep.guide || {}).name || 'the dog'}: he goes ahead to the pale figure.` : 'Walk to the ring: the pale figure.'} ${st.fi === 0 ? K : ''}`
          : st.beat === 'ride' ? 'Walk to the car and press E to get in. Or walk the whole way.' : f ? (!f.placed ? 'Stand in the light on the ground.' : !st.cam ? 'The camera is in your hand. With it up you see what it sees.' : !f.aimed ? (fr.task.relic ? 'Look through the frame lines: something stands there that tonight does not have. Walk closer if it is small.' : 'Turn until it is inside the frame lines.') : ctx.touch ? 'Tap the shutter.' : 'Press F, or click the shutter.') : '';
        if (how !== st.how) { st.how = how; goalEl.querySelector('em').textContent = how; }
      }
      if (st.phase === 'go' && st.beat === 'ride') { // the car: its mark on it as it comes and waits; gone from the frame while you ride; on when you are out, or have walked there
        const r = ctx.rideNow(), R = fr.ride, there = near(R.to, 45);
        if (r && r.state !== 'in') { if (!st.target || Math.hypot(st.target[0] - r.at[0], st.target[1] - r.at[1]) > 1.5) aimAt(spot(r.at)); const text = r.state === 'coming' ? R.line || 'A car is coming for you.' : R.board || 'Your car is here. Get in.'; if (text !== goalText) goal(text); st.inCar = false; }
        else if (r) { if (!st.inCar) { st.inCar = true; aimAt(null); goal(R.riding || ''); if (ctx.score) ctx.score({ mode: 'ride' }); } }
        if (!r || (there && (!r || r.state !== 'in'))) { st.inCar = false; aimAt(null); goal(''); const f = st.rideGo; st.rideGo = null; f(); }
      }
      st.t += dt;
      // time is not cut, it is braked: the world slows to nothing over most of a second, and runs up again faster
      st.k = st.phase === 'stop' ? Math.max(0, st.k - dt / 0.95) : Math.min(1, st.k + dt / 0.6);
      for (const id in st.cast) st.cast[id].animate(dt * st.k * st.k); // (the living slow and hold with the world)
      if (st.phase === 'go') {
        goalEl.querySelector('small').textContent = `${S.title || ''} · Frame ${st.fi + 1} of ${N}`;
        if (st.beat === 'meet') {
          const m = living(fr.meet);
          if (!m) approach();
          else if (near([m.x, m.y, m.z], fr.meet.reach_m || 3)) {
            st.beat = 'talk'; aimAt(null); goal('');
            if (m.face) m.face(ctx.player.x, ctx.player.y);
            const w = { name: m.name || '', role: [m.age ? `${m.age}` : '', m.role || ''].filter(Boolean).join(' · '), alive: true, voice: voiceOf(Object.assign({}, m, { voice: m.voice || fr.meet.voice })) }; // (the living: their age tonight)
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
        if (st.dog) st.dog.tick(dt);
        if (st.beat === 'seek') {
          // the keys are put away once they have been used
          if (st.from && Math.hypot(ctx.player.x - st.from[0], ctx.player.y - st.from[1]) > 3) { st.from = null; hint(false); }
          if (g && near([g.x, g.y, g.z], a.reach_m || 3.2)) {
            st.beat = 'talk'; hint(false); aimAt(null); goal('');
            sfx('ghost'); ctx.say(who(a), a.lines || [], () => task());
          }
        }
        if (ctx.finder) ctx.finder(st.beat === 'shoot' && st.cam ? finderRect() : null);
        if (st.beat === 'shoot') { // the goal says where to stand, then when the lens is on it, and the button shows it
          const T = fr.task, G = T.goals || {}, f = framed(), on = f.placed && f.aimed;
          const text = !st.cam ? (!f.placed ? G.stand || 'Find where this was taken from.' : G.raise || `Raise the camera${ctx.touch ? '.' : ': R.'}`) : !f.placed ? G.stand || 'Find where this was taken from.' : on ? G.ready || 'That is it. Take the picture.' : G.shoot || 'Raise the camera and take the picture.';
          if (text !== goalText && !st.miss) goal(text);
          if (st.miss) st.miss = Math.max(0, st.miss - dt);
          const want = !f.placed ? spot(T.stand) : T.subject ? [T.subject[0], T.subject[1], T.subject[2], T.subject[2]] : null;
          if (String(want) !== String(st.target)) aimAt(want);
          if (f.placed && T.subject) ctx.beacon(null); // (the subject is marked in the frame, with no light standing on it)
          if (on && !st.ready) { sfx('found'); if (T.relic && T.relic.name) say(`In the frame · ${T.relic.name}`); } // (it is in the frame: glass, and its name)
          st.ready = on; finder.classList.toggle('ready', on);
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
      dress, begin, tick, shoot, raise, state: st,
      get stopped() { return st.phase === 'stop'; },
      get scale() { return st.phase === 'idle' || st.phase === 'dressed' || st.phase === 'done' ? 1 : st.k * st.k; }, // how much time the world is given: 1 running, 0 held
      get orbit() { return st.orbit; },
      // the camera's own view: while it is raised; and through the last frame's ending (the two of them meeting, and the
      // words after), which is watched from where the picture was taken, not from a camera behind you that has a wall in it
      get finder() { return (st.phase === 'stop' && ((st.beat === 'shoot' && !!st.cam) || st.beat === 'meeting' || (st.beat === 'shown' && !!(st.fr && st.fr.finale)))) || (st.phase === 'after' && !!(st.fr && st.fr.finale)); }, // the camera is raised: the game shows the lens's view
      get on() { return st.phase !== 'idle' && st.phase !== 'done'; },
      dispose() {
        timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); ctx.beacon(null);
        ctx.stage.classList.remove('story', 'story-on', 'story-stop');
        for (const e of [frames, card, veil, flash, goalEl, mark, keys, finder, shutter, endEl, album, printEl, camBtn, chip]) e.remove();
        for (const k of ['ghost', 'ghost2']) if (st[k]) st[k].remove();
        for (const id in st.cast) st.cast[id].remove();
      },
    };
  }
  return { create };
})();
