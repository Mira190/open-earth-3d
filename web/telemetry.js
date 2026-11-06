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
//   - script errors, unhandled rejections and lost WebGL contexts are counted, a few per page at most.
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
    endpoint: '',          // e.g. 'https://eu.i.posthog.com/batch/' or 'https://stats.example.org/e'
    format: 'posthog',     // 'posthog' or 'jsonl'
    key: '',               // PostHog project API key (phc_...), public by design
  };
  const VERSION = 1;
  const q = new URLSearchParams(location.search);
  const arg = q.get('telemetry');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const debug = arg === 'debug';
  let endpoint = CONFIG.endpoint, format = CONFIG.format;
  if (arg && /^https?:\/\//.test(arg) && local) { endpoint = arg; format = 'jsonl'; }
  const asked = (arg && arg !== 'off') && (debug || endpoint !== CONFIG.endpoint);
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const on = arg !== 'off' && !optOut && (debug || (!!endpoint && (asked || !navigator.webdriver)));
  const noop = { on: false, track() {}, flush() {}, view() {} };
  if (!on) return noop;

  const now = () => performance.now();
  const rid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  let vid = null;
  try { vid = localStorage.getItem('oe3d-vid'); if (!vid) { vid = rid(); localStorage.setItem('oe3d-vid', vid); } } catch (e) { vid = null; }
  const fresh = !vid;
  if (!vid) vid = rid();                 // storage blocked: a visitor id for this page only
  const sid = rid();                     // one page load

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
    queue.push({ event, ts: new Date().toISOString(), props: Object.assign(base(), cur ? { view: cur.kind, city: cur.city } : {}, props || {}) });
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
    if (final) props.final = true;
    sinceFlush = 0; cur.frames = frames();
    if (props.s > 0 || final) track('time', props);
  }
  const frames = () => ({ n: 0, slow: 0, bins: new Uint32Array(100) });

  function leave(why) {
    if (!cur) return;
    if (!cur.ready && !cur.failed) track('load', { ok: false, why, ms: Math.round(now() - cur.t0) });
    sendTime(true);
    cur = null;
  }
  function view() {
    const w = where();
    if (cur && cur.kind === w.kind && cur.city === w.city) return;
    leave('left');
    // the first view is timed from the navigation itself (the page's own download is part of its wait)
    cur = { kind: w.kind, city: w.city, t0: views ? now() : 0, ready: w.kind === 'globe', failed: false, active: 0, since: null, frames: frames() };
    track('view', { first: !views++, new_visitor: fresh });
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
        track('load', { ok: true, ms: Math.round(now() - v.t0) }); flush();
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
    if (document.hidden) { sendTime(false); flush(); } else bank();
  });
  addEventListener('pagehide', () => { going = true; leave('closed'); flush(); });
  setInterval(() => { if (activeNow()) { sendTime(false); flush(); } }, 300000);

  // how the page itself arrived: time to first byte and first paint, once per page
  addEventListener('load', () => setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0], fcp = performance.getEntriesByName('first-contentful-paint')[0];
    track('page', { ttfb: nav ? Math.round(nav.responseStart) : undefined, fcp: fcp ? Math.round(fcp.startTime) : undefined, dom: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined });
  }, 0), { once: true });

  // the first view once the page's scripts are in (so its events carry the quality tier)
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', view, { once: true }); else view();
  return { on: true, track, flush, view };
})();
