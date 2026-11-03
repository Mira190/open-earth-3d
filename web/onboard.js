// First-time onboarding, shared by the city games (game/game.js) and the reef sites (reef/game.js):
// whether this browser has been through the intro on any map (one flag in localStorage, so a player who
// has learnt the controls in Shibuya is not taught them again in Sydney or on Heron Island), and a short
// tour of the HUD: one step per control, each pointing at it with a soft spotlight and a card beside it.
// Every step is skippable (Esc or "Skip"), Enter or the right arrow moves on, and on a touch screen the
// card shows each step's touch wording. The tour never moves the camera and does not hold the player.
//   OEOnboard.done()           true once the intro has been finished or skipped on any map
//   OEOnboard.markDone(where)  remember it ("shibuya", "heron-island")
//   OEOnboard.forget()         as if never played (the menu's "Show the intro again" runs the tour instead)
//   OEOnboard.tour(steps, { onEnd(skipped), root }) -> { next(), back(), skip(), get step(), get active() }
//     steps: [{ id, title, text, touch?, target? }]; target is an element, a selector or a function
//     returning one (the step is centred when it is missing or hidden); text may hold <kbd>.
//   OEOnboard.active()         a tour is showing (the area sign and the guide's dialogue wait for it)
'use strict';
window.OEOnboard = (function () {
  const KEY = 'oe3d-onboard';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } };
  const write = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage blocked: the intro shows again next time */ } };
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const touchScreen = () => /[?&]touch=1\b/.test(location.search) || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // the title screen's tokens (web/index.html, title.css), with fallbacks for the reef page, which has its own
  const CSS = `
.ob-tour { position: fixed; inset: 0; z-index: 60; pointer-events: none; font: 400 13px/1.5 var(--f-body, "Inter Tight", "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--ink, #ece8e1); -webkit-font-smoothing: antialiased; }
.ob-tour * { box-sizing: border-box; }
.ob-ring { position: absolute; border-radius: 3px; border: 1px solid var(--accent, #ffb066); box-shadow: 0 0 0 200vmax rgba(2, 4, 8, 0.42), 0 0 24px rgba(255, 176, 102, 0.35);
  transition: left .5s var(--ease, cubic-bezier(.16,1,.3,1)), top .5s var(--ease, cubic-bezier(.16,1,.3,1)), width .5s var(--ease, cubic-bezier(.16,1,.3,1)), height .5s var(--ease, cubic-bezier(.16,1,.3,1)), opacity .35s; }
.ob-ring.none { opacity: 0; }
.ob-veil { position: absolute; inset: 0; background: rgba(2, 4, 8, 0.32); opacity: 0; transition: opacity .35s; }
.ob-veil.on { opacity: 1; }
.ob-card { position: absolute; width: min(344px, calc(100vw - 32px)); pointer-events: auto; padding: 16px 18px 14px; border-radius: var(--r, 2px);
  background: var(--hud-solid, rgba(8, 12, 20, 0.9)); -webkit-backdrop-filter: var(--blur, blur(22px) saturate(1.15)); backdrop-filter: var(--blur, blur(22px) saturate(1.15));
  border: 1px solid var(--line, rgba(236, 232, 225, 0.14)); box-shadow: var(--shadow, 0 12px 40px rgba(0, 0, 0, 0.35));
  transition: left .5s var(--ease, cubic-bezier(.16,1,.3,1)), top .5s var(--ease, cubic-bezier(.16,1,.3,1)), opacity .3s; }
.ob-card::before, .ob-card::after { content: ""; position: absolute; width: 10px; height: 10px; border: 0 solid var(--accent, #ffb066); pointer-events: none; }
.ob-card::before { left: -1px; top: -1px; border-width: 1px 0 0 1px; } .ob-card::after { right: -1px; bottom: -1px; border-width: 0 1px 1px 0; }
.ob-eb { display: flex; justify-content: space-between; gap: 10px; font: 400 9.5px/1.3 var(--f-mono, "JetBrains Mono", ui-monospace, Menlo, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--muted, #8a93a3); }
.ob-card h3 { margin: 9px 0 6px; font: 400 17px/1.25 var(--f-display, "Zalando Sans Expanded", "Michroma", system-ui, sans-serif); letter-spacing: .02em; color: #fff; }
.ob-card p { margin: 0; color: var(--ink-2, #c3c6cc); }
.ob-card kbd { display: inline-block; min-width: 18px; padding: 1px 5px; margin: 0 1px; border: 1px solid var(--line-2, rgba(236, 232, 225, 0.3)); border-radius: 2px;
  font: 400 10.5px/1.4 var(--f-mono, "JetBrains Mono", ui-monospace, Menlo, monospace); color: var(--ink, #ece8e1); text-align: center; background: rgba(236, 232, 225, 0.05); }
.ob-dots { display: flex; gap: 5px; margin: 14px 0 12px; }
.ob-dots i { flex: 1; height: 2px; background: rgba(236, 232, 225, 0.14); transition: background .3s; }
.ob-dots i.on { background: var(--accent, #ffb066); }
.ob-acts { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.ob-acts button { font: 500 12px/1 var(--f-body, "Inter Tight", system-ui, sans-serif); letter-spacing: .02em; border-radius: var(--r, 2px); cursor: pointer; padding: 10px 14px; min-height: 38px; }
.ob-skip { background: none; border: 1px solid transparent; color: var(--muted, #8a93a3); padding-left: 0 !important; }
.ob-skip:hover { color: var(--ink, #ece8e1); }
.ob-nav { display: flex; gap: 8px; }
.ob-back { background: rgba(236, 232, 225, 0.03); border: 1px solid var(--line, rgba(236, 232, 225, 0.14)); color: var(--ink, #ece8e1); }
.ob-next { background: var(--accent, #ffb066); border: 1px solid var(--accent, #ffb066); color: var(--accent-ink, #1a0f04); }
.ob-next:hover { background: var(--accent-2, #ffc48c); }
.ob-tour.in .ob-card { opacity: 1; } .ob-tour .ob-card { opacity: 0; }
@media (max-width: 640px) { .ob-card { padding: 14px 15px 12px; } .ob-card h3 { font-size: 15.5px; } .ob-card p { font-size: 12.5px; } }
@media (prefers-reduced-motion: reduce) { .ob-ring, .ob-card, .ob-veil { transition: none; } }
`;
  let cur = null;

  function tour(steps, { onEnd = null, root = document.body } = {}) {
    if (cur) cur.skip();
    if (!document.getElementById('ob-css')) { const s = document.createElement('style'); s.id = 'ob-css'; s.textContent = CSS; document.head.appendChild(s); }
    const touch = touchScreen();
    const el = document.createElement('div');
    el.className = 'ob-tour';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Getting started');
    el.dataset.hush = ''; // the area sign (game/places.js) waits while it shows
    el.innerHTML = `<div class="ob-veil"></div><div class="ob-ring none"></div><div class="ob-card" aria-live="polite"><div class="ob-eb"><span>Getting started</span><span class="ob-n"></span></div><h3></h3><p></p>
      <div class="ob-dots">${steps.map(() => '<i></i>').join('')}</div>
      <div class="ob-acts"><button class="ob-skip" type="button">Skip tour</button><span class="ob-nav"><button class="ob-back" type="button">Back</button><button class="ob-next" type="button">Next</button></span></div></div>`;
    root.appendChild(el);
    const $ = s => el.querySelector(s), ring = $('.ob-ring'), card = $('.ob-card'), veil = $('.ob-veil');
    let i = 0, ended = false, timer = 0;
    const targetOf = st => {
      let t = st && st.target;
      if (typeof t === 'function') t = t();
      if (typeof t === 'string') t = document.querySelector(t);
      if (!t || !t.getClientRects().length) return null;
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null;
    };
    // the ring round the control and the card beside it (below a control in the top half, above one in the
    // bottom half, centred when there is none), kept 16 px inside the screen
    function place() {
      const r = targetOf(steps[i]), W = innerWidth, H = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, pad = 6, g = 16;
      ring.classList.toggle('none', !r);
      veil.classList.toggle('on', !r);
      let x, y;
      if (r) {
        Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        x = r.left + r.width / 2 - cw / 2;
        y = r.top + r.height / 2 < H / 2 ? r.bottom + pad + 14 : r.top - pad - 14 - ch;
        if (y + ch > H - g || y < g) { // no room above or below (a tall control): beside it, at mid-height
          y = (H - ch) / 2;
          x = r.left + r.width / 2 > W / 2 ? r.left - pad - 14 - cw : r.right + pad + 14;
        }
      } else { x = (W - cw) / 2; y = Math.min(H * 0.66, H - ch - g); } // below the player, who stands mid-screen
      card.style.left = `${Math.round(Math.max(g, Math.min(W - cw - g, x)))}px`;
      card.style.top = `${Math.round(Math.max(g, Math.min(H - ch - g, y)))}px`;
    }
    function show() {
      const st = steps[i];
      $('.ob-n').textContent = `${i + 1} / ${steps.length}`;
      $('h3').textContent = st.title;
      $('p').innerHTML = touch && st.touch ? st.touch : st.text;
      el.querySelectorAll('.ob-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
      $('.ob-back').hidden = i === 0;
      $('.ob-next').textContent = i === steps.length - 1 ? 'Start exploring' : 'Next';
      el.dataset.step = st.id || String(i);
      place();
    }
    function end(skipped) {
      if (ended) return;
      ended = true; clearInterval(timer);
      removeEventListener('keydown', onKey, true); removeEventListener('resize', place);
      el.classList.remove('in');
      setTimeout(() => el.remove(), reduced() ? 0 : 320);
      if (cur === ctl) cur = null;
      if (onEnd) onEnd(skipped);
    }
    // the tour's own keys only; walking, looking and the rest go on to the game
    function onKey(e) {
      if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ctl.skip(); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) ctl.next(); }
      else if (e.code === 'ArrowLeft' || e.code === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) ctl.back(); }
    }
    const ctl = {
      next() { if (ended) return; if (i < steps.length - 1) { i++; show(); } else end(false); },
      back() { if (ended || i === 0) return; i--; show(); },
      skip() { end(true); },
      get step() { return ended ? -1 : i; },
      get id() { return ended ? '' : steps[i].id || String(i); },
      get active() { return !ended; },
      get count() { return steps.length; },
      el,
    };
    $('.ob-next').addEventListener('click', () => ctl.next());
    $('.ob-back').addEventListener('click', () => ctl.back());
    $('.ob-skip').addEventListener('click', () => ctl.skip());
    addEventListener('keydown', onKey, true);
    addEventListener('resize', place);
    timer = setInterval(place, 400); // the HUD moves under it (a panel opening, the phone's toolbar)
    cur = ctl;
    show();
    requestAnimationFrame(() => { if (!ended) el.classList.add('in'); });
    return ctl;
  }

  return {
    done: () => !!read().done,
    markDone(where) { write(Object.assign(read(), { done: 1, at: new Date().toISOString().slice(0, 10), where: where || '' })); },
    forget() { const o = read(); delete o.done; write(o); },
    tour,
    active: () => !!(cur && cur.active),
    current: () => cur,
    touchScreen,
  };
})();
