// Observability: how many people visit, and whether the site keeps its service levels (docs/OBSERVABILITY.md).
// A classic script with no dependencies, loaded first by every page (index.html, reef/index.html), so it
// watches the pages from outside instead of being threaded through them:
//   - a view (the globe, a city's model, a city's game, a reef site) starts with the page or a change of
//     hash; it is ready when its loader fades (#loader / #g-loader take the class "out", the reef's #load
//     "done") and has failed when the loader shows its error ("err");
//   - the time a view is on screen and ready is counted in "time" events (sent when the tab is put away,
//     the view changes, the page closes, and every five minutes), so play time adds up even when a phone
//     kills the tab without a pagehide;
//   - frame times are taken from requestAnimationFrame while the view is ready and visible: the median
//     frame rate and the share of frames slower than 50 ms (a dropped-frame stutter a person notices);
//   - script errors, unhandled rejections and lost WebGL contexts are counted, a few per page at most;
//   - where in the view the visitor is and what they are doing is read once a second from the views' own
//     handles (window.__city, window.__game, window.__reef: the tour stop, the neighbourhood or nearest
//     landmark, on foot or in a car, the quest), summed into "dwell" events by spot and mode, and carried on
//     every event, so the last event of a page load says where the visitor left; "tour", "mode" and "quest"
//     events mark the steps, and "exit" says how the page ended;
//   - engaged time (input in the last minute, or a tour or camera move playing) is told apart from a tab left
//     open, and a page that died while on screen (a tab crash, an out-of-memory kill) is reported by the
//     next page load ("crash").
// Nothing is stored but a random visitor id in localStorage (no cookies, no fingerprinting, no IP kept by
// this code); nothing is sent at all until CONFIG names an endpoint, nor when the browser asks not to be
// tracked (Do Not Track or Global Privacy Control), nor from automated browsers (the checks in tools/).
// Events go in batches with navigator.sendBeacon (fetch keepalive as the fallback), in one of two formats:
//   "posthog": PostHog's /batch/ capture API (a project's public key is meant to sit in page code);
//   "jsonl":   { events: [...] } to a collector of your own (tools/telemetry_server.py, which writes
//              JSON lines that tools/slo_report.py reads).
// ?telemetry=debug logs each batch to the console instead of sending it; on localhost
// ?telemetry=<url> sends jsonl to that url, even from an automated browser (tools/telemetry_check.js).
'use strict';
window.OETelemetry = (function () {
  const CONFIG = {
    endpoint: 'https://eu.i.posthog.com/batch/',   // PostHog EU Cloud; or a collector of your own (format 'jsonl')
    format: 'posthog',     // 'posthog' or 'jsonl'
    key: 'phc_v8YPULU9RMwSuJD4K3WYDM8KaGck9Z2XeAFdKeVRD95B',   // the project's public capture key (it only writes events)
  };
  const VERSION = 2;
  const q = new URLSearchParams(location.search);
  const arg = q.get('telemetry');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const debug = arg === 'debug';
  let endpoint = CONFIG.endpoint, format = CONFIG.format;
  if (arg && /^https?:\/\//.test(arg) && local) { endpoint = arg; format = 'jsonl'; }
  const asked = (arg && arg !== 'off') && (debug || endpoint !== CONFIG.endpoint);
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const on = arg !== 'off' && !optOut && (debug || (!!endpoint && (asked || !navigator.webdriver)));
  const noop = { on: false, track() {}, flush() {}, view() {}, here() { return null; } };
  if (!on) return noop;

  const now = () => performance.now();
  const rid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  let vid = null;
  try { vid = localStorage.getItem('oe3d-vid'); if (!vid) { vid = rid(); localStorage.setItem('oe3d-vid', vid); } } catch (e) { vid = null; }
  const fresh = !vid;
  if (!vid) vid = rid();                 // storage blocked: a visitor id for this page only
  const sid = rid();                     // one page load
  // how many page loads this browser has made, and the days since the last: return visits without a profile
  let visit = { n: 1, days: null };
  try {
    const o = JSON.parse(localStorage.getItem('oe3d-visits') || 'null'), t = Date.now();
    if (o && o.n > 0) visit = { n: o.n + 1, days: Math.round((t - o.t) / 864e5 * 10) / 10 };
    localStorage.setItem('oe3d-visits', JSON.stringify({ n: visit.n, t }));
  } catch (e) { /* storage blocked */ }

  // the device, coarse: what the quality tiers and the SLO targets are split by
  const touch = matchMedia('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  const device = touch ? (short < 600 ? 'phone' : 'tablet') : 'desktop';
  const ref = (() => { try { const r = document.referrer && new URL(document.referrer); return r && r.host !== location.host ? r.host : ''; } catch (e) { return ''; } })();
  // the quality tier and WebGL 2, asked once (the probe makes a context) when quality.js has loaded
  let gpu = null;
  const tierOf = () => {
    if (gpu) return gpu;
    const Q = window.OEQuality;
    if (!Q) return {};
    try { const t = Q.tier(); gpu = { tier: t.name, tier_chosen: t.chosen, gl2: !!Q.probe().gl2, software: !!Q.probe().software }; } catch (e) { gpu = {}; }
    return gpu;
  };
  const base = () => Object.assign({ v: VERSION, sid, device, webgpu: !!navigator.gpu, lang: navigator.language || '', ref,
    app: (window.OE_VERSION && window.OE_VERSION.version) || '', w: innerWidth, h: innerHeight, dpr: Math.round(devicePixelRatio * 100) / 100 }, tierOf());

  // ---------------------------------------------------------------- the queue
  let queue = [];
  function track(event, props) {
    queue.push({ event, ts: new Date().toISOString(), props: Object.assign(base(), cur ? { view: cur.kind, city: cur.city } : {}, snap(), props || {}) });
    if (queue.length >= 20) flush();
  }
  function flush() {
    if (!queue.length) return;
    const events = queue; queue = [];
    if (debug) { console.info('[telemetry]', events); if (!endpoint) return; }
    let body;
    if (format === 'posthog') {
      body = JSON.stringify({ api_key: CONFIG.key, batch: events.map(e => ({ event: e.event, timestamp: e.ts,
        properties: Object.assign({ distinct_id: vid, $process_person_profile: false, $current_url: location.origin + location.pathname + location.hash, $referring_domain: ref || '$direct' }, e.props) })) });
    } else {
      body = JSON.stringify({ vid, events });
    }
    // text/plain keeps the request simple (no CORS preflight), which sendBeacon needs
    const blob = new Blob([body], { type: 'text/plain' });
    let sent = false;
    try { sent = navigator.sendBeacon && navigator.sendBeacon(endpoint, blob); } catch (e) { sent = false; }
    if (!sent) { try { fetch(endpoint, { method: 'POST', body: blob, keepalive: body.length < 60000, mode: 'no-cors', credentials: 'omit' }).catch(() => {}); } catch (e) { /* offline */ } }
  }

  // ---------------------------------------------------------------- views
  const reef = /\/reef\/?/.test(location.pathname);
  function where() {
    if (reef) return { kind: 'reef', city: q.get('city') || q.get('site') || 'whitsundays' };
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('@')[0];
    if (!h || h === 'globe') return { kind: 'globe', city: '' };
    if (/^play-/.test(h)) return { kind: 'game', city: h.slice(5) };
    return { kind: 'city', city: h };
  }
  const LOADERS = { city: 'loader', game: 'g-loader', reef: 'load' };
  let cur = null;           // { kind, city, t0, ready, failed, active, since, frames }
  let sinceFlush = 0;       // ms of active time in this view not yet sent
  let engFlush = 0;         // seconds of it the visitor was engaged (input in the last minute, or a tour playing)
  let slice = { inp: 0, heap: 0 };   // the slowest interaction (ms) and the most memory (MB) since the last "time"

  function activeNow() { return cur && cur.ready && !document.hidden; }
  function bank() {         // move the running stretch of active time into the view's tally
    if (cur && cur.since != null) { const d = now() - cur.since; cur.active += d; sinceFlush += d; cur.since = activeNow() ? now() : null; }
    else if (cur) cur.since = activeNow() ? now() : null;
  }
  function sendTime(final) {
    bank();
    if (!cur || (sinceFlush < 500 && !final)) return;
    const f = cur.frames, n = f.n;
    const props = { s: Math.round(sinceFlush / 100) / 10, total_s: Math.round(cur.active / 1000) };
    if (n >= 10) {
      // the median frame from the histogram (2 ms bins up to 200 ms)
      let k = 0, med = 0; for (let i = 0; i < f.bins.length; i++) { k += f.bins[i]; if (k >= n / 2) { med = (i + 0.5) * 2; break; } }
      props.fps = Math.round(1000 / Math.max(med, 1));
      props.slow = Math.round(f.slow / n * 1000) / 1000;
      props.frames = n;
    }
    props.eng_s = Math.round(engFlush / 100) / 10;
    if (slice.inp) props.inp = slice.inp;
    if (slice.heap) props.heap_mb = slice.heap;
    if (final) props.final = true;
    sinceFlush = 0; engFlush = 0; slice = { inp: 0, heap: 0 }; cur.frames = frames();
    if (props.s > 0 || final) track('time', props);
    // the time by spot and mode since the last one
    for (const [k, d] of cur.dwell) if (d.s >= 1) track('dwell', { spot: d.spot, mode: d.mode, s: Math.round(d.s * 10) / 10, eng_s: Math.round(d.eng * 10) / 10 });
    cur.dwell.clear();
  }
  const frames = () => ({ n: 0, slow: 0, bins: new Uint32Array(100) });

  function leave(why) {
    if (!cur) return;
    if (!cur.ready && !cur.failed) {
      const el = document.getElementById(LOADERS[cur.kind]);   // what the loader was saying when the visitor gave up
      track('load', { ok: false, why, ms: Math.round(now() - cur.t0), msg: el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : undefined });
    }
    sendTime(true);
    prev = { from: `${cur.kind}${cur.city ? `:${cur.city}` : ''}`, from_s: Math.round(cur.active / 1000) };
    cur = null;
  }
  let prev = {};
  function view(restored) {
    const w = where();
    if (cur && cur.kind === w.kind && cur.city === w.city) return;
    leave('left');
    // the first view is timed from the navigation itself (the page's own download is part of its wait)
    cur = { kind: w.kind, city: w.city, t0: views ? now() : 0, ready: w.kind === 'globe', failed: false, active: 0, since: null, frames: frames(),
      restored: restored === true, here: null, dwell: new Map(), tourMax: 0, tourDone: false, stamps: null };
    track('view', Object.assign({ first: !views++, new_visitor: fresh, visit_n: visit.n, days_since: visit.days }, prev));
    prev = {};
    while (crashes.length) crashes.shift()();
    if (cur.ready) bank();
    watchLoader();
    flush();
  }
  let views = 0;

  // the loader of the view: ready when it fades, failed when it says so
  let mo = null;
  function watchLoader() {
    if (mo) { mo.disconnect(); mo = null; }
    const id = LOADERS[cur.kind];
    if (!id) return;
    const v = cur;
    const check = () => {
      const el = document.getElementById(id);
      if (!el || v !== cur) return false;
      if (!v.ready && (el.classList.contains('out') || el.classList.contains('done'))) {
        v.ready = true; bank();
        if (!v.restored) { track('load', { ok: true, ms: Math.round(now() - v.t0) }); flush(); }
        return true;
      }
      if (!v.failed && el.classList.contains('err')) {
        v.failed = true;
        track('load', { ok: false, why: 'error', ms: Math.round(now() - v.t0), msg: (el.textContent || '').trim().slice(0, 160) }); flush();
        return true;
      }
      return false;
    };
    mo = new MutationObserver(() => { if (check() && mo) { mo.disconnect(); mo = null; } });
    // the router replaces a pane's markup when a view comes back (a fresh copy), so watch the whole document
    const start = () => { if (!check() && mo) mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true }); };
    if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  }

  // ---------------------------------------------------------------- frames
  let last = 0;
  function tick(t) {
    if (last && activeNow()) {
      const d = t - last;
      if (d < 1000) { const f = cur.frames; f.n++; if (d > 50) f.slow++; f.bins[Math.min(99, d / 2 | 0)]++; }
    }
    last = document.hidden ? 0 : t;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- where the visitor is, and what they are doing
  // Read from the views' own handles once a second while the view is ready and on screen; each view's code
  // stays as it is. A spot is a place a person would name: the tour stop, else the neighbourhood (game.json
  // "areas"), else the nearest landmark, travel point, wharf or trig within 300 m (the model viewer: the
  // nearest named place to what the camera looks at, within 400 m).
  const $id = id => document.getElementById(id);
  const clip = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  function nearest(list, x, y, r) { let best = null, bd = r; for (const p of list) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = p[2]; } } return best; }
  let named = null, namedFor = null;
  function names(g) {      // the game's named points, [x, y, name], built once per game
    if (namedFor === g) return named;
    namedFor = g; named = [];
    const G = g.G || {};
    for (const l of g.landmarks || []) if (l.at) named.push([l.at[0], l.at[1], l.name]);
    for (const t of G.travel || []) if (t.at) named.push([t.at[0], t.at[1], t.name]);
    for (const w of G.wharves || []) { const a = w.landing || w.terminal; if (a) named.push([a[0], a[1], w.name]); }
    for (const v of g.VP || []) named.push([v.x, v.y, v.name]);
    named = named.filter(p => p[2] && isFinite(p[0]) && isFinite(p[1]));
    return named;
  }
  function look(kind) {
    try {
      if (kind === 'city') {
        const c = window.__city;
        if (!c || !c.tour) return null;
        const t = c.tour, stops = document.querySelectorAll('#cap-bars span').length, n = t.i + 1;
        if (t.playing && n > 0) return { spot: `tour ${n}: ${clip(($id('cap-title') || {}).textContent)}`, mode: 'tour', stop: n, stops, done: false, watching: true };
        let spot = 'free look';
        if (c.controls && c.placeInfo) {
          const g = c.controls.target, p = nearest(c.placeInfo.filter(q => q.c).map(q => [q.c[0], q.c[1], q.name]), g.x, -g.z, 400);
          if (p) spot = clip(p);
        }
        const tab = document.querySelector('.panel [role="tab"][aria-selected="true"]');
        return { spot, mode: c.orbit && c.orbit.on ? 'orbit' : 'free', panel: tab ? tab.dataset.tab : undefined, stop: n, stops, done: !!t.done, watching: !!(c.orbit && c.orbit.on && t.done) };
      }
      if (kind === 'game') {
        const g = window.__game;
        if (!g || !g.player) return null;
        const ttl = $id('g-title');
        if (ttl && !ttl.hidden) return { spot: 'title screen', mode: 'menu' };
        const p = g.player, a = g.places && g.places.area && g.places.area();
        const spot = (a && a.name) || nearest(names(g), p.x, p.y, 300) || 'streets';
        const out = { spot: clip(spot), mode: g.photo && g.photo.on ? 'photo' : p.mode, watching: !!((g.cine && g.cine.active) || (g.onboard && g.onboard.active && g.onboard.active())) };
        const l = g.tracked && g.tracked();
        if (l && g.ls) { const st = g.ls(l); out.quest = `${l.id} ${st.qi + 1}.${st.si + 1}`; }
        try { out.stamps = g.qs().stamps.length; } catch (e) { /* no quests here */ }
        return out;
      }
      if (kind === 'reef') {
        const r = window.__reef, g = window.__game, pl = r && r.ctx && r.ctx.player;
        if (!pl || !pl.S) return null;
        const S = pl.S, x = S.pos.x, y = -S.pos.z;
        const spot = nearest((r.ctx.pois || []).map(q => [q.x, q.y, q.name || q.id]), x, y, 150) || (S.water ? 'open water' : 'shore');
        return { spot: clip(spot), mode: g && g.aboard ? 'boat' : S.state, depth: Math.round(S.depthBody || 0), watching: !!(g && g.arrival && g.arrival.on) };
      }
    } catch (e) { /* a view between states: try again next second */ }
    return null;
  }
  // the context every event carries: so the last event of a page load says where the visitor was when they left
  function snap() {
    const h = cur && cur.here;
    if (!h) return {};
    const o = { spot: h.spot, mode: h.mode };
    if (h.stops) o.tour = h.done || cur.tourDone ? 'done' : h.mode === 'tour' ? `${h.stop}/${h.stops}` : cur.tourMax ? `left ${cur.tourMax}/${h.stops}` : 'none';
    if (h.quest) o.quest = h.quest;
    return o;
  }
  let lastInput = -1e9, lastSample = 0;
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, () => { lastInput = now(); }, { capture: true, passive: true });
  function sample() {
    const t = now(), dt = Math.min(2, (t - lastSample) / 1000);
    lastSample = t;
    if (!activeNow()) return;
    const h = look(cur.kind), was = cur.here;
    if (!h) return;
    cur.here = h;
    const eng = h.watching || t - lastInput < 60000;
    if (eng) engFlush += dt * 1000;
    const k = `${h.spot}\u0001${h.mode}`;
    let d = cur.dwell.get(k);
    if (!d) cur.dwell.set(k, d = { spot: h.spot, mode: h.mode, s: 0, eng: 0 });
    d.s += dt; if (eng) d.eng += dt;
    // the steps: a tour stop reached, the tour ended or taken over; on foot to a car or a helicopter; a quest step done
    if (h.stops) {
      if (h.mode === 'tour' && (!was || was.stop !== h.stop || was.mode !== 'tour')) { cur.tourMax = Math.max(cur.tourMax, h.stop); track('tour', { action: 'stop', stop: h.stop, stops: h.stops }); }
      if (h.done && !cur.tourDone) { cur.tourDone = true; track('tour', { action: 'end', stops: h.stops }); }
      else if (was && was.mode === 'tour' && h.mode !== 'tour' && !h.done) track('tour', { action: 'leave', stop: was.stop, stops: h.stops });
    }
    if (was && !h.stops && was.mode !== h.mode && h.mode !== 'menu' && was.mode !== 'menu') track('mode', { from: was.mode, to: h.mode });
    if (was && was.mode === 'menu' && h.mode !== 'menu') track('mode', { from: 'menu', to: h.mode, start: true });
    if (h.stamps != null) {
      if (cur.stamps != null && h.stamps > cur.stamps) track('quest', { action: 'done', stamps: h.stamps });
      else if (was && was.quest && h.quest && was.quest !== h.quest && h.stamps === cur.stamps) track('quest', { action: 'step', from: was.quest });
      cur.stamps = h.stamps;
    }
    if (performance.memory) slice.heap = Math.max(slice.heap, Math.round(performance.memory.usedJSHeapSize / 1048576));
  }
  setInterval(sample, 1000);
  // how long the page takes to answer a tap or a key (the Event Timing API behind INP): the slowest in each piece
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId && e.duration > slice.inp) slice.inp = Math.round(e.duration); })
      .observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (e) { /* Safari before 18: no Event Timing */ }

  // ---------------------------------------------------------------- a page that died on screen
  // While the page is visible a small note says it is alive (refreshed every five seconds); it is taken away
  // when the tab is put away or the page closes. A note left behind, and older than half a minute (another
  // tab of the site keeps its own fresh), means the page ended without closing: the browser or the GPU
  // process crashed, or the system killed it for memory. The next page load reports it.
  const ALIVE = 'oe3d-alive-', crashes = [];   // the reports wait for the first view, so they carry its tier
  const alive = () => { try { localStorage.setItem(ALIVE + sid, JSON.stringify(Object.assign({ t: Date.now(), up: Math.round(now() / 1000), ready: !!(cur && cur.ready) }, cur ? { view: cur.kind, city: cur.city } : {}, snap()))); } catch (e) { /* storage blocked */ } };
  const gone = () => { try { localStorage.removeItem(ALIVE + sid); } catch (e) { /* storage blocked */ } };
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(ALIVE) || k === ALIVE + sid) continue;
      let o = null; try { o = JSON.parse(localStorage.getItem(k)); } catch (e) { o = null; }
      const age = o ? Date.now() - o.t : 1e12;
      if (age < 30000) continue;
      localStorage.removeItem(k);
      if (age < 3 * 864e5) crashes.push(() => track('crash', { prev_view: o.view, prev_city: o.city, prev_spot: o.spot, prev_mode: o.mode, prev_ready: o.ready, prev_up_s: o.up, ago_s: Math.round(age / 1000) }), 0);
    }
  } catch (e) { /* storage blocked */ }
  setInterval(() => { if (!document.hidden && !going) alive(); }, 5000);

  // ---------------------------------------------------------------- errors and the GPU
  let errors = 0;
  const err = (kind, msg, src) => { if (errors++ < 5) track('error', { kind, msg: String(msg || '').slice(0, 200), src: String(src || '').replace(location.origin, '').slice(0, 160) }); };
  addEventListener('error', e => {
    if (e.target && e.target !== window && e.target.tagName) { err('resource', e.target.tagName, e.target.src || e.target.href); return; }
    err('script', e.message, e.filename ? `${e.filename}:${e.lineno}` : '');
  }, true);
  addEventListener('unhandledrejection', e => err('promise', e.reason && (e.reason.message || e.reason), e.reason && e.reason.stack && e.reason.stack.split('\n')[1]));
  // a view that stops gives its context up on purpose (renderer.dispose), so a loss within a few seconds of
  // a change of view, or once the page is going, is not counted
  let going = false, changed = 0;
  addEventListener('webglcontextlost', () => { if (going || now() - changed < 4000) return; track('gl_lost', {}); flush(); }, true);

  // ---------------------------------------------------------------- the page's life
  addEventListener('hashchange', () => { changed = now(); view(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { gone(); sendTime(false); flush(); } else { alive(); bank(); }
  });
  // how the page ended: where the visitor was, how long the page was open, how long since they last touched it
  addEventListener('pagehide', () => {
    if (cur && !going) track('exit', { page_s: Math.round(now() / 1000), view_s: Math.round((cur.active + (cur.since != null ? now() - cur.since : 0)) / 1000), views,
      idle_s: lastInput > 0 ? Math.round((now() - lastInput) / 1000) : null, ready: cur.ready, tour_max: cur.tourMax || undefined, hidden: document.hidden });
    going = true; gone(); leave('closed'); flush();
  });
  // back from the back-forward cache: the page lives again, so its view starts over (ready already, no load)
  addEventListener('pageshow', e => { if (e.persisted) { going = false; alive(); view(true); } });
  setInterval(() => { if (activeNow()) { sendTime(false); flush(); } }, 300000);

  // how the page itself arrived: time to first byte and first paint, once per page
  addEventListener('load', () => setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0], fcp = performance.getEntriesByName('first-contentful-paint')[0];
    track('page', { ttfb: nav ? Math.round(nav.responseStart) : undefined, fcp: fcp ? Math.round(fcp.startTime) : undefined, dom: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined });
  }, 0), { once: true });

  // the first view once the page's scripts are in (so its events carry the quality tier)
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', view, { once: true }); else view();
  alive();
  return { on: true, track, flush, view, frames: () => (cur ? cur.frames.n : 0), here: () => (cur ? cur.here : null), sample };   // frames, here, sample: for tools/telemetry_check.js
})();
