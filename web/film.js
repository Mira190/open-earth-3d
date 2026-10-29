// A city's film: the highlights of each live city, rendered from its own model by
// tools/city_film.js, shown from the title screen's destination card.
//
// In the card, the film's teaser plays silently in a 2.39:1 frame (not on a phone, with
// reduced motion or a data saver: there it is a still with a play button). Choosing it opens the
// theatre: the film full-bleed and letterboxed, with sound if the title has sound on. The titles
// are type, not pixels: they are set over the picture from the film's cue sheet
// (web/films/<id>.json) in the title screen's faces, and driven by the video's own clock, so
// they stay in time when the picture stalls or is scrubbed. The chapters run along the bottom.
// While the film plays the city's model downloads in the background, so the dive afterwards
// is quicker. It ends on a card: explore the model, play the game, or watch again.
'use strict';
window.OEFilm = (function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saver = () => !!(navigator.connection && navigator.connection.saveData);
  const narrow = () => innerWidth < 860 || innerWidth < innerHeight;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
  const out3 = t => 1 - Math.pow(1 - clamp(t), 3);
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let index = null;
  const cues = {};
  const ready = fetch('films/index.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(j => { index = j; return j; });
  async function cue(id) {
    await ready;
    if (!index || !index[id]) return null;
    if (!cues[id]) cues[id] = fetch(index[id].json).then(r => r.json()).catch(() => null);
    return cues[id];
  }

  // ------------------------------------------------------------ the reel in the card
  let reel = null;
  async function card(cardEl, city, opts = {}) {
    stopPreview();
    const c = await cue(city.id);
    if (!c || !cardEl.isConnected) return;
    const still = reduced || saver() || narrow();
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'fm-reel';
    el.setAttribute('aria-label', `Watch the film of ${city.name}, ${fmt(c.duration)}`);
    el.innerHTML = `<img alt="" src="${esc(c.poster)}" decoding="async">${still ? '' : `<video muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video>`}
      <span class="fm-reel-ui"><span class="fm-play" aria-hidden="true"></span><span class="fm-reel-t">Watch the film</span><span class="fm-reel-d">${fmt(c.duration)}</span></span>
      <span class="fm-reel-eb">Film · ${esc(city.name)}</span>`;
    cardEl.prepend(el);
    cardEl.classList.add('has-film');
    const v = el.querySelector('video');
    const run = { el, v, city, c, opts };
    reel = run;
    if (v) {
      const [a, b] = c.teaser || [c.duration * 0.35, c.duration * 0.8];
      v.src = c.video;
      v.addEventListener('loadedmetadata', () => { v.currentTime = a; }, { once: true });
      v.addEventListener('timeupdate', () => { if (v.currentTime >= b) v.currentTime = a; });
      v.addEventListener('playing', () => el.classList.add('live'), { once: true });
      // only once the card has settled, so a quick run down the list doesn't start nine downloads
      run.t = setTimeout(() => { if (reel === run) v.play().catch(() => {}); }, 650);
    }
    el.addEventListener('click', e => { e.stopPropagation(); open(city, opts); }); // the card's own handler would dive
  }
  function stopPreview() {
    if (!reel) return;
    clearTimeout(reel.t);
    if (reel.v) { reel.v.pause(); reel.v.removeAttribute('src'); reel.v.load(); }
    reel = null;
  }
  // the card's film for the keyboard (F), if it has one
  function hasReel() { return !!(reel && reel.el.isConnected); }
  function openReel() { if (hasReel()) open(reel.city, reel.opts); }

  // ------------------------------------------------------------ the theatre
  let th = null;
  const grainUrl = (() => {
    let url = null;
    return () => {
      if (url) return url;
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const g = c.getContext('2d'), im = g.createImageData(160, 160);
      for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      g.putImageData(im, 0, 0);
      return (url = c.toDataURL());
    };
  })();

  // the city's model, fetched while the film plays so the dive is quicker
  function prefetch(city, play) {
    const base = `data/${city.id}/`, files = ['scene.json', 'buildings.json', 'landmarks.json', 'terrain.json'].concat(play ? ['game.json'] : []);
    for (const f of files) fetch(base + f, { priority: 'low' }).catch(() => {});
  }

  async function open(city, opts = {}) {
    const c = await cue(city.id);
    if (!c || th) return;
    stopPreview();
    const host = document.getElementById('globe-app') || document.body;
    const el = document.createElement('div');
    el.className = 'fm-theatre';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', `${c.name}: the film`);
    const chapters = [];
    for (const s of c.shots) {
      if (s.chapter || !chapters.length) chapters.push({ t0: s.t0, t1: s.t1, name: s.chapter || c.name });
      else chapters[chapters.length - 1].t1 = s.t1;
    }
    el.innerHTML = `
      <video class="fm-video" playsinline preload="auto" src="${esc(c.video)}" poster="${esc(c.poster)}"></video>
      <div class="fm-grain" aria-hidden="true"></div>
      <div class="fm-titles" aria-live="polite"></div>
      <div class="fm-chrome">
        <div class="fm-top"><span class="fm-eb">Film · ${esc(c.name)} · ${fmt(c.duration)}</span><span class="fm-tools"><button class="fm-fs" type="button">Full screen</button><button class="fm-x" type="button">Close <kbd>Esc</kbd></button></span></div>
        <p class="fm-rotate" aria-hidden="true">Turn your phone for the full picture</p>
        <div class="fm-bottom">
          <button class="fm-pp" type="button" aria-label="Pause"><i></i></button>
          <div class="fm-chapters" role="group" aria-label="Chapters">${chapters.map((h, i) => `<button type="button" class="fm-ch" data-i="${i}" style="flex:${(h.t1 - h.t0).toFixed(2)}"><span>${esc(h.name)}</span><i><b></b></i></button>`).join('')}</div>
          <span class="fm-time">0:00 / ${fmt(c.duration)}</span>
          <button class="fm-snd" type="button" aria-pressed="false"><span class="fm-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="fm-snd-l">Sound off</span></button>
        </div>
      </div>
      <div class="fm-end" hidden>
        <p class="fm-end-eb">${esc(city.country || '')}</p>
        <h2>${esc(c.name)}</h2>
        <p class="fm-end-l">${esc((c.titles.find(t => t.kind === 'end') || {}).line || '')}</p>
        <div class="fm-end-a">
          ${city.game ? '<button type="button" class="ts-btn primary" data-go="play">Play <kbd>P</kbd></button>' : ''}
          <button type="button" class="ts-btn" data-go="model">Explore in 3D <kbd>↵</kbd></button>
          <button type="button" class="ts-btn fm-again" data-go="again">Watch again <kbd>R</kbd></button>
        </div>
        <p class="fm-credit">${esc(c.credit || '')}</p>
      </div>`;
    host.append(el);
    host.classList.add('film-open'); // the title stops drawing the Earth behind the film
    el.querySelector('.fm-grain').style.backgroundImage = `url(${grainUrl()})`;
    const v = el.querySelector('video'), titles = el.querySelector('.fm-titles'), endEl = el.querySelector('.fm-end');
    const prevFocus = document.activeElement;
    const ac = new AbortController(), sig = { signal: ac.signal };
    // sound: the title's choice; its own music steps aside while the film plays
    const S = window.OEScore, titleSound = !!(S && S.on);
    if (S && titleSound) S.setMuted(true);
    let sound = titleSound;
    const setSound = on => {
      sound = on; v.muted = !on;
      const b = el.querySelector('.fm-snd');
      b.setAttribute('aria-pressed', String(on));
      el.querySelector('.fm-snd-l').textContent = on ? 'Sound on' : 'Sound off';
    };
    setSound(sound);
    th = { el, v, c, city, opts, ac, raf: 0, titleSound };
    // the titles, built once and moved by the clock
    const T = c.titles.map(t => ({ t, el: titleEl(t, c, city) }));
    for (const x of T) if (x.el) titles.append(x.el);
    prefetch(city, !!city.game);

    // chrome: shown on any movement, hidden after a while of playing
    let idle = 0;
    const wake = () => { el.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => { if (!v.paused) el.classList.add('idle'); }, 2400); };
    el.addEventListener('pointermove', wake, sig);
    el.addEventListener('pointerdown', wake, sig);
    wake();

    const pp = el.querySelector('.fm-pp');
    const toggle = () => { if (v.ended || endEl.hidden === false) again(); else if (v.paused) v.play(); else v.pause(); };
    v.addEventListener('play', () => { pp.setAttribute('aria-label', 'Pause'); el.classList.remove('paused'); wake(); }, sig);
    v.addEventListener('pause', () => { pp.setAttribute('aria-label', 'Play'); el.classList.add('paused'); wake(); }, sig);
    v.addEventListener('ended', () => showEnd(true), sig);
    v.addEventListener('click', toggle, sig);
    pp.addEventListener('click', toggle, sig);
    el.querySelector('.fm-x').addEventListener('click', close, sig);
    // full screen, and on a phone the landscape it was made for; an iPhone has full screen for video only
    el.querySelector('.fm-fs').addEventListener('click', async () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      } else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    }, sig);
    el.querySelector('.fm-snd').addEventListener('click', () => setSound(!sound), sig);
    el.querySelectorAll('.fm-ch').forEach(b => b.addEventListener('click', () => { const h = chapters[+b.dataset.i]; showEnd(false); v.currentTime = h.t0 + 0.01; v.play(); }, sig));
    endEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.go === 'again') again();
      else go(b.dataset.go === 'play');
    }, sig);
    function again() { showEnd(false); v.currentTime = 0; v.play(); }
    function go(play) {
      const f = opts.go;
      close();
      if (f) f(play);
    }
    function showEnd(on) {
      endEl.hidden = !on;
      titles.hidden = on;
      el.classList.toggle('ended', on);
      if (on) { const b = endEl.querySelector('.primary') || endEl.querySelector('button'); b.focus({ preventScroll: true }); }
    }
    addEventListener('keydown', e => {
      if (!th) return;
      const k = e.key.toLowerCase();
      // the theatre has the keys while it is open
      e.stopImmediatePropagation();
      if (k === 'escape') { e.preventDefault(); close(); }
      else if (k === 'f') el.querySelector('.fm-fs').click();
      else if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
      else if (k === 'm') setSound(!sound);
      else if (k === 'r') again();
      else if (k === 'p' && city.game) go(true);
      else if (k === 'enter' && !e.target.closest('button')) { e.preventDefault(); go(false); }
      else if (k === 'arrowright') v.currentTime = Math.min(c.duration, v.currentTime + 5);
      else if (k === 'arrowleft') { showEnd(false); v.currentTime = Math.max(0, v.currentTime - 5); }
      else if (k === 'tab') trap(e);
      wake();
    }, { capture: true, signal: ac.signal });
    function trap(e) {
      const f = [...el.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }

    // the clock: the titles, the chapters and the time follow the picture
    const chEls = [...el.querySelectorAll('.fm-ch')], timeEl = el.querySelector('.fm-time');
    const tick = () => {
      if (!th || th.el !== el) return;
      const t = v.currentTime || 0;
      for (const x of T) if (x.el) place(x, t);
      chapters.forEach((h, i) => {
        const k = clamp((t - h.t0) / (h.t1 - h.t0));
        chEls[i].querySelector('b').style.transform = `scaleX(${k})`;
        chEls[i].classList.toggle('on', t >= h.t0 && t < h.t1);
      });
      timeEl.textContent = `${fmt(t)} / ${fmt(c.duration)}`;
      th.raf = requestAnimationFrame(tick);
    };
    th.raf = requestAnimationFrame(tick);
    requestAnimationFrame(() => el.classList.add('on'));
    el.querySelector('.fm-x').focus({ preventScroll: true });
    th.prevFocus = prevFocus;
    // a film with sound needs the click that opened it; without one it plays silent
    v.play().catch(() => { setSound(false); v.play().catch(() => el.classList.add('paused')); });
  }

  function close() {
    if (!th) return;
    const { el, v, ac, raf, titleSound, prevFocus } = th;
    th = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    cancelAnimationFrame(raf);
    ac.abort();
    v.pause();
    el.classList.remove('on');
    if (el.parentElement) el.parentElement.classList.remove('film-open');
    setTimeout(() => { v.removeAttribute('src'); v.load(); el.remove(); }, reduced ? 0 : 450);
    if (window.OEScore && titleSound) OEScore.setMuted(false);
    if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ the titles
  function titleEl(t, c, city) {
    const el = document.createElement('div');
    el.className = `fm-t fm-${t.kind === 'end' ? 'endtitle' : t.kind}`;
    if (t.kind === 'caption') {
      el.innerHTML = (t.lines || []).map((l, i) => `<span class="${i === 0 ? 'live' : ''}" data-text="${esc(l)}"></span>`).join('');
    } else if (t.kind === 'main') {
      const letters = [...String(t.name).toUpperCase()].map(ch => (ch === ' ' ? ' ' : `<i>${esc(ch)}</i>`)).join('');
      el.innerHTML = `<span class="w" aria-label="${esc(t.name)}">${letters}</span>${t.native ? `<span class="nat">${esc(t.native)}</span>` : ''}<span class="s">${esc(t.sub || '')}</span><span class="m">${esc(t.figures || '')}</span>`;
    } else if (t.kind === 'lower') {
      el.innerHTML = `<i class="rule"></i><span class="eb">${esc(t.eyebrow || '')}</span><span class="hd">${esc(t.head || '')}</span><span class="tx">${esc(t.text || '')}</span>`;
    } else if (t.kind === 'end') {
      el.innerHTML = `<span class="w">${esc(String(t.name).toUpperCase())}</span><span class="m">Open Earth 3D</span>`;
    } else return null;
    return el;
  }
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789°·:/';
  // where a title is at film time t: in, held, out; scrubbing anywhere gives the right frame
  function place(x, t) {
    const { t: d, el } = x, a = t - d.t0, life = d.t1 - d.t0, outK = clamp((d.t1 - t) / 0.5);
    const on = a >= 0 && t <= d.t1;
    el.style.visibility = on ? 'visible' : 'hidden';
    if (!on) return;
    if (d.kind === 'caption') {
      el.style.opacity = String(outK);
      el.querySelectorAll('span').forEach((s, i) => {
        const txt = s.dataset.text, k = clamp((a - i * 0.45) / 0.9);
        if (reduced || k >= 1) { if (s.textContent !== txt) s.textContent = txt; return; }
        const seed = Math.floor(t * 24);
        s.textContent = k <= 0 ? '' : [...txt].map((ch, j) => (ch === ' ' || j / txt.length < k * 1.2 - 0.2 ? ch : GLYPHS[(j * 7 + seed * 13) % GLYPHS.length])).join('');
      });
    } else if (d.kind === 'main') {
      const letters = el.querySelectorAll('.w i');
      // the tracking closes as the letters come out of the blur, one by one
      const k = out3(a / 1.8);
      el.querySelector('.w').style.letterSpacing = `${(0.9 - 0.5 * k).toFixed(3)}em`;
      el.querySelector('.w').style.marginRight = `${-(0.9 - 0.5 * k).toFixed(3)}em`;
      letters.forEach((l, i) => {
        const q = smooth((a - 0.08 * i) / 0.7);
        l.style.opacity = String(q * outK);
        l.style.filter = reduced ? '' : `blur(${((1 - q) * 14).toFixed(1)}px)`;
      });
      for (const [sel, at] of [['.nat', 0.6], ['.s', 0.8], ['.m', 1.15]]) {
        const s = el.querySelector(sel); if (!s) continue;
        const q = smooth((a - at) / 0.6);
        s.style.opacity = String(q * outK);
        s.style.transform = `translateY(${((1 - q) * 6).toFixed(1)}px)`;
      }
      el.style.setProperty('--scrim', String(smooth(a / 0.8) * outK));
    } else if (d.kind === 'lower') {
      const q = out3(a / 0.7);
      el.style.opacity = String(Math.min(q, outK));
      el.style.transform = `translateY(${((1 - q) * 10).toFixed(1)}px)`;
      el.querySelector('.rule').style.transform = `scaleX(${out3((a - 0.1) / 0.9)})`;
      el.querySelector('.tx').style.opacity = String(smooth((a - 0.35) / 0.6));
    } else if (d.kind === 'end') {
      const q = smooth(a / 1.2);
      el.style.opacity = String(q * clamp((life - a + 0.4) / 0.4));
      el.querySelector('.w').style.letterSpacing = `${(0.7 - 0.25 * out3(a / 2)).toFixed(3)}em`;
    }
  }

  return { ready, cue, card, open, close, stopPreview, hasReel, openReel, get isOpen() { return !!th; } };
})();
