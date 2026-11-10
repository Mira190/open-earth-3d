// Observability: how many people visit, and whether the site keeps its service levels (docs/OBSERVABILITY.md).
// A classic script with no dependencies, loaded first by every page (index.html, reef/index.html), so it
// watches the pages from outside instead of being threaded through them:
//   - a view (the globe, a city's model, a city's game, a reef site) starts with the page or a change of
//     hash; it is ready when its loader fades (#loader / #g-loader take the class "out", the reef's #load
//     "done") and has failed when the loader shows its error ("err");
//   - the time a view is on screen and ready is counted in "time" events (sent when the tab is put away,
//     the view changes, the page closes, and every five minutes), so play time adds up even when a phone
//     kills the tab without a pagehide;
//   - a view's load is told in stages by the pages' own performance marks ("oe:fetched", "oe:decoded",
//     "oe:built", "oe:frame", and the title screen's "oe:ready"; see markOf): the times from the view's start to
//     its data fetched, decoded, its scene built (before its shaders compile), its first frame drawn and the
//     loader gone ride on the one "load" event, so the stages
//     cost no events of their own; the title screen, which has no loader, reports its "load" at "oe:ready";
//   - frame times are taken from requestAnimationFrame while the view is ready and visible: the median
//     frame rate and the share of frames slower than 50 ms (a dropped-frame stutter a person notices);
//     with them the frame's tail (the 95th and 99th percentile frame, the longest, the hitches over 100 ms),
//     and what the frame cost and why: the main thread's work per frame, the GPU's time per frame where the
//     browser has a timer query, the draw calls, triangles and full-screen passes of a frame sampled now and
//     then, and the pixels drawn, so each "time" event says whether the device was held back by its GPU or by
//     the page's script ("bound"); frames the browser calls long name the script that held them ("jank");
//   - the device, coarsely: the GPU's family and model as the browser names it (no driver version or device
//     id), the cores and memory the browser reports, the system and the browser;
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
  const VERSION = 4;   // 4: the device (gpu, cores, mem, os, browser), the frame's tail and cost (f95, f99, cpu_ms, gpu_ms,
                       //    draws, tris_k, passes, px_k, bound), "jank" and "quality" events, the load's weight (kb, req),
                       //    frame rate by spot on "dwell", and a first "time" half a minute into a view
                       // 3: load stages (fetch_ms, decode_ms, build_ms, frame_ms) and the title screen's load
  const q = new URLSearchParams(location.search);
  const arg = q.get('telemetry');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const debug = arg === 'debug';
  let endpoint = CONFIG.endpoint, format = CONFIG.format;
  if (arg && /^https?:\/\//.test(arg) && local) { endpoint = arg; format = 'jsonl'; }
  const asked = (arg && arg !== 'off') && (debug || endpoint !== CONFIG.endpoint);
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const on = arg !== 'off' && !optOut && (debug || (!!endpoint && (asked || !navigator.webdriver)));
  const noop = { on: false, track() {}, flush() {}, view() {}, set() {}, gpu() {}, here() { return null; } };
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
    try {
      const t = Q.tier(), c = Q.probe();
      gpu = { tier: t.name, tier_chosen: t.chosen, gl2: !!c.gl2, software: !!c.software, gpu: gpuName(c.renderer) || undefined, gpu_class: gpuClass(c.renderer),
        cores: c.cores || undefined, mem: c.memory || undefined, max_tex: c.maxTex || undefined };
    } catch (e) { gpu = {}; }
    return gpu;
  };
  // the GPU as the browser names it, cut down to its family and model: "ANGLE (Intel, Intel(R) Iris(R) Xe
  // Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)" becomes "intel iris xe graphics". No driver
  // version, device id or API level is kept: the name is for grouping devices, not telling them apart.
  function gpuName(r) {
    let s = String(r || '');
    const m = /^ANGLE \((.*)\)$/.exec(s);
    if (m) { const parts = m[1].split(','); s = parts.length > 1 ? parts[1] : parts[0]; }
    return s.replace(/ANGLE Metal Renderer:/i, '').replace(/\((R|TM|C)\)/gi, '').replace(/\(0x[0-9a-f]+\)/gi, '')
      .replace(/\b(Direct3D|OpenGL|Vulkan|D3D)\S*.*$/i, '').replace(/\/PCIe.*$/i, '').replace(/,? or similar/i, '')
      .replace(/\bvs_\S+|\bps_\S+/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);
  }
  function gpuClass(r) {
    const s = String(r || '').toLowerCase();
    if (!s) return undefined;
    if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(s)) return 'software';
    for (const [k, re] of [['apple', /apple/], ['nvidia', /nvidia|geforce|quadro|rtx|gtx/], ['amd', /amd|radeon|ati /], ['intel', /intel|iris|uhd|hd graphics/],
      ['adreno', /adreno|qualcomm/], ['mali', /mali|immortalis/], ['powervr', /powervr|imagination/], ['xclipse', /xclipse|samsung/]]) if (re.test(s)) return k;
    return 'other';
  }
  const ua = navigator.userAgent || '';
  const os = /Android/.test(ua) ? 'android' : (/iPhone|iPad|iPod/.test(ua) || (/Mac OS X/.test(ua) && navigator.maxTouchPoints > 1)) ? 'ios' : /Mac OS X/.test(ua) ? 'mac'
    : /Windows/.test(ua) ? 'windows' : /CrOS/.test(ua) ? 'chromeos' : /Linux/.test(ua) ? 'linux' : 'other';
  const bm = /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(ua);
  const browser = bm ? { Edg: 'edge', OPR: 'opera', Firefox: 'firefox', Chrome: 'chrome', Version: /Safari\//.test(ua) ? 'safari' : 'other' }[bm[1]] : 'other';
  const conn = navigator.connection || {};
  const base = () => Object.assign({ v: VERSION, sid, device, webgpu: !!navigator.gpu, lang: navigator.language || '', ref,
    app: (window.OE_VERSION && window.OE_VERSION.version) || '', w: innerWidth, h: innerHeight, dpr: Math.round(devicePixelRatio * 100) / 100,
    os, browser, browser_v: bm ? Number(bm[2]) : undefined, net: conn.effectiveType || undefined, save_data: conn.saveData || undefined }, tierOf());

  // PostHog's own session for its Web Analytics: a UUIDv7 kept in sessionStorage for the tab, renewed after
  // 30 minutes without an event (PostHog's own rule), so its sessions, bounce rate and session length add up
  let phs = null;
  const uuid7 = () => {
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    let t = Date.now(); for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
    b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  function phSession() {
    const t = Date.now();
    if (!phs) { try { phs = JSON.parse(sessionStorage.getItem('oe3d-phs') || 'null'); } catch (e) { phs = null; } }
    if (!phs || !phs.id || t - phs.t > 30 * 60e3) phs = { id: uuid7(), t };
    phs.t = t;
    try { sessionStorage.setItem('oe3d-phs', JSON.stringify(phs)); } catch (e) { /* storage blocked */ }
    return phs.id;
  }
  const referrer = (() => { try { return document.referrer && new URL(document.referrer).host !== location.host ? document.referrer : ''; } catch (e) { return ''; } })();

  // ---------------------------------------------------------------- the queue
  let queue = [];
  function track(event, props) {
    queue.push({ event, ts: new Date().toISOString(), url: location.origin + location.pathname + location.hash, props: Object.assign(base(), cur ? { view: cur.kind, city: cur.city } : {}, snap(), props || {}) });
    if (queue.length >= 20) flush();
  }
  function flush() {
    if (!queue.length) return;
    const events = queue; queue = [];
    if (debug) { console.info('[telemetry]', events); if (!endpoint) return; }
    let body;
    if (format === 'posthog') {
      // every "view" also goes as PostHog's standard $pageview, which its Web Analytics reads (visitors, pages,
      // referrers, countries, devices); the site's own events stay as they are for the dashboard and SLOs
      const session = phSession(), batch = [];
      for (const e of events) {
        const common = { distinct_id: vid, $process_person_profile: false, $session_id: session, $current_url: e.url,
          $host: location.host, $pathname: location.pathname, $referring_domain: ref || '$direct' };
        batch.push({ event: e.event, timestamp: e.ts, properties: Object.assign({}, common, e.props) });
        if (e.event === 'view') {
          batch.push({ event: '$pageview', timestamp: e.ts, properties: Object.assign({}, common, {
            $referrer: referrer || '$direct', $title: document.title, $screen_width: screen.width, $screen_height: screen.height,
            $viewport_width: innerWidth, $viewport_height: innerHeight, $device_type: device === 'desktop' ? 'Desktop' : device === 'phone' ? 'Mobile' : 'Tablet',
            $lib: 'oe3d-telemetry', view: e.props.view, city: e.props.city, first: e.props.first, app: e.props.app }) });
        }
      }
      body = JSON.stringify({ api_key: CONFIG.key, batch });
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
  // the slowest interaction (ms) and the most memory (MB) since the last "time"; the long frames the browser
  // reported (their count, the time they blocked input, and the worst with the script that held it)
  const fresh0 = () => ({ inp: 0, heap: 0, block: 0, loaf: 0, worst: null });
  let slice = fresh0();
  let extra = {};           // what the view says of its own state (OETelemetry.set): the governor's scale, what it shed

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
      // the tail: the frame 95% and 99% are no slower than (the upper edge of its 2 ms bin), the longest, and
      // the hitches a person feels (over 100 ms); the fastest rate the device kept for a twentieth of its frames
      const at = p => { let c = 0; for (let i = 0; i < f.bins.length; i++) { c += f.bins[i]; if (c >= n * p) return (i + 1) * 2; } return 200; };
      props.f95 = at(0.95); props.f99 = at(0.99); props.fmax = Math.round(f.max); props.hitch = f.hitch;
      const hz = 1000 / (at(0.05) - 1);
      props.hz = [30, 60, 72, 75, 90, 120, 144, 165, 240].reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
      // what the frame cost: the main thread's work and the GPU's time (medians and the 95th percentile, ms),
      // a sampled frame's draw calls, triangles and full-screen passes, and the pixels of the canvas
      const r1 = x => Math.round(x * 10) / 10;
      const c50 = qt(f.cpu, 0.5), g50 = qt(f.gpu, 0.5);
      if (c50 != null) { props.cpu_ms = r1(c50); props.cpu95 = r1(qt(f.cpu, 0.95)); }
      if (g50 != null) { props.gpu_ms = r1(g50); props.gpu95 = r1(qt(f.gpu, 0.95)); }
      const dr = qt(f.draws, 0.5);
      if (dr != null) { props.draws = Math.round(dr); props.tris_k = Math.round(qt(f.tris, 0.5) / 1000); props.passes = Math.round(qt(f.passes, 0.5)); }
      if (f.px) props.px_k = Math.round(f.px / 1000);
      // what held the frame rate: nothing ("ok": within a tenth of the display's rate), the GPU or the script.
      // Without a GPU timer, a slow frame the script does not account for is put down to the GPU ("gpu?").
      props.bound = props.fps >= props.hz * 0.9 ? 'ok' : g50 != null ? (g50 >= (c50 || 0) ? 'gpu' : 'cpu') : c50 != null ? (c50 > med * 0.6 ? 'cpu' : 'gpu?') : undefined;
    }
    props.eng_s = Math.round(engFlush / 100) / 10;
    if (slice.inp) props.inp = slice.inp;
    if (slice.heap) props.heap_mb = slice.heap;
    if (slice.loaf) { props.loaf = slice.loaf; props.block_ms = Math.round(slice.block); }
    if (final) props.final = true;
    const worst = slice.worst;
    sinceFlush = 0; engFlush = 0; slice = fresh0(); cur.frames = frames();
    if (props.s > 0 || final) track('time', Object.assign(props, extra));
    if (worst && (props.s > 0 || final)) track('jank', worst);
    // the time by spot and mode since the last one
    for (const [k, d] of cur.dwell) if (d.s >= 1) track('dwell', Object.assign({ spot: d.spot, mode: d.mode, s: Math.round(d.s * 10) / 10, eng_s: Math.round(d.eng * 10) / 10 },
      d.fn >= 10 ? { fps: Math.round(1000 * d.fn / d.fms), slow: Math.round(d.fslow / d.fn * 1000) / 1000 } : {}));
    cur.dwell.clear(); cur.dk = null;
  }
  // a reservoir of samples (240 kept, each as likely as any other), for a median and a 95th percentile
  const pool = () => ({ a: new Float32Array(240), n: 0 });
  const put = (r, v) => { if (r.n < r.a.length) r.a[r.n] = v; else { const j = Math.random() * (r.n + 1) | 0; if (j < r.a.length) r.a[j] = v; } r.n++; };
  const qt = (r, p) => { const m = Math.min(r.n, r.a.length); if (m < 1) return null; const s = Array.from(r.a.subarray(0, m)).sort((x, y) => x - y); return s[Math.min(m - 1, Math.floor(p * m))]; };
  const frames = () => ({ n: 0, slow: 0, hitch: 0, max: 0, bins: new Uint32Array(100), cpu: pool(), gpu: pool(), draws: pool(), tris: pool(), passes: pool(), px: 0 });
  // the view's own state, for the "time" events: OETelemetry.set({ scale: 0.85, shed: 2 }). A change is also an
  // event of its own ("quality"), so a governor's steps can be read in order; at most 30 a view.
  function set(o) {
    if (!cur || !o) return;
    let changed = false;
    for (const k in o) if (extra[k] !== o[k]) { extra[k] = o[k]; changed = true; }
    if (changed && cur.ready && (cur.qn = (cur.qn || 0) + 1) <= 30) track('quality', Object.assign({ at_s: Math.round(cur.active / 1000) }, extra));
  }

  function leave(why) {
    if (!cur) return;
    if (!cur.ready && !cur.failed) {
      const el = document.getElementById(LOADERS[cur.kind]);   // what the loader was saying when the visitor gave up
      track('load', Object.assign({ ok: false, why, ms: Math.round(now() - cur.t0), msg: el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : undefined }, stages(cur)));
    }
    sendTime(true);
    prev = { from: `${cur.kind}${cur.city ? `:${cur.city}` : ''}`, from_s: Math.round(cur.active / 1000) };
    cur = null; extra = {}; glDrop();
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
    globeReady();
    watchLoader();
    flush();
  }
  let views = 0;

  // the stages of a view's load, from the pages' performance marks: "oe:<stage>", with { detail: { view, city } }
  // where one page has several views (world.js serves the model and the game). The last mark of each stage
  // since the view started counts; a mark naming another view (one left while it loaded) does not.
  const STAGES = { fetched: 'fetch_ms', decoded: 'decode_ms', built: 'build_ms', frame: 'frame_ms' };
  function markOf(stage, v) {
    let at = null;
    try {
      for (const m of performance.getEntriesByName(`oe:${stage}`, 'mark')) {
        const d = m.detail;
        if (m.startTime >= v.t0 && (!d || !d.view || (d.view === v.kind && (d.city == null || d.city === v.city)))) at = m.startTime;
      }
    } catch (e) { /* no User Timing */ }
    return at;
  }
  function stages(v) {
    const o = {};
    for (const k in STAGES) { const t = markOf(k, v); if (t != null) o[STAGES[k]] = Math.round(t - v.t0); }
    return o;
  }
  // what the load brought over the network: kilobytes transferred, requests, and the share served from the cache
  try { performance.setResourceTimingBufferSize(3000); } catch (e) { /* the default 250 then */ }
  function weight(v) {
    let b = 0, n = 0, hit = 0;
    try { for (const r of performance.getEntriesByType('resource')) if (r.startTime >= v.t0) { n++; b += r.transferSize || 0; if (!r.transferSize && r.decodedBodySize) hit++; } } catch (e) { /* no Resource Timing */ }
    return n ? { kb: Math.round(b / 1024), req: n, cached: Math.round(hit / n * 100) / 100 } : {};
  }
  // the title screen has no loader: it is ready at its "oe:ready" mark (title.js), reported once per globe view
  function globeReady() {
    const v = cur;
    if (!v || v.kind !== 'globe' || v.loaded || v.restored) return;
    const t = markOf('ready', v);
    if (t == null) return;
    v.loaded = true;
    track('load', Object.assign({ ok: true, ms: Math.round(t - v.t0) }, stages(v)));
    flush();
  }
  try { new PerformanceObserver(() => globeReady()).observe({ type: 'mark' }); } catch (e) { /* checked each second instead */ }

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
        if (!v.restored) { track('load', Object.assign({ ok: true, ms: Math.round(now() - v.t0) }, stages(v), weight(v))); flush(); }
        return true;
      }
      if (!v.failed && el.classList.contains('err')) {
        v.failed = true;
        track('load', Object.assign({ ok: false, why: 'error', ms: Math.round(now() - v.t0), msg: (el.textContent || '').trim().slice(0, 160) }, stages(v))); flush();
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
  // This script loads first and asks for its frame first, so in every frame its callback runs before the
  // view's own: the time from here to a task posted from here (which the browser runs once the frame's
  // callbacks, style and layout are done) is the main thread's work for the frame, and whatever the view
  // draws falls between one of these callbacks and the next.
  let last = 0, fno = 0, cpuAt = 0;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { if (cpuAt && activeNow()) put(cur.frames.cpu, now() - cpuAt); cpuAt = 0; };
  function tick(t) {
    const live = activeNow();
    if (last && live) {
      const d = t - last;
      if (d < 1000) {
        const f = cur.frames; f.n++; if (d > 50) f.slow++; if (d > 100) f.hitch++; if (d > f.max) f.max = d; f.bins[Math.min(99, d / 2 | 0)]++;
        const k = cur.dk; if (k) { k.fn++; k.fms += d; if (d > 50) k.fslow++; }
      }
    }
    fno++;
    try { glTick(live); } catch (e) { glDrop(); }
    if (live && fno % 4 === 0) { cpuAt = now(); ch.port2.postMessage(0); }
    last = document.hidden ? 0 : t;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- what the GPU is asked for
  // The views' WebGL 2 contexts are noted as they are made (this script loads before any of them), so the
  // frame can be measured from outside without a line in the renderers:
  //   - the GPU's time for a frame, with a timer query (EXT_disjoint_timer_query_webgl2, where the browser has
  //     it: Chromium on desktop) begun in one of this script's callbacks and ended in the next, one frame in
  //     thirty; a query the view itself has open is left alone;
  //   - the draw calls, triangles and full-screen passes (a three-vertex draw with no index is one) of one
  //     frame in a hundred and twenty, counted by wrapping the context's draw calls for that frame only;
  //   - the canvas's pixels.
  // The reef and alpine sites draw with WebGPU, which this script cannot time from outside: the page reports its own
  // through OETelemetry.gpu({ ms, draws, tris, passes, px }) (reef/main.js: the GPU's time from timestamp queries
  // over a run of frames where the adapter has them, and a frame's draws and triangles from the renderer's info).
  const CANVAS = { globe: 'globe-gl', city: 'gl', game: 'game-gl' };
  const ctxs = new WeakMap();
  try {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      const c = get.apply(this, arguments);
      if (c && type === 'webgl2') { try { ctxs.set(this, c); } catch (e) { /* not a context we can key */ } }
      return c;
    };
  } catch (e) { /* no canvas prototype: no GPU figures */ }
  const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  let tq = null, cnt = null;     // an open timer query { gl, ext, q, run }; a frame being counted { gl, draws, tris, passes }
  function glDrop() {
    if (cnt) { for (const k of DRAWS) delete cnt.gl[k]; cnt = null; }
    if (tq) { try { if (tq.run) tq.gl.endQuery(tq.ext.TIME_ELAPSED_EXT); tq.gl.deleteQuery(tq.q); } catch (e) { /* the context has gone */ } tq = null; }
  }
  function glTick(live) {
    // close what the last frame opened
    if (cnt) {
      for (const k of DRAWS) delete cnt.gl[k];
      if (live && cnt.draws) { const f = cur.frames; put(f.draws, cnt.draws); put(f.tris, cnt.tris); put(f.passes, cnt.passes); }
      cnt = null;
    }
    if (tq) {
      const { gl, ext } = tq;
      if (gl.isContextLost()) { tq = null; }
      else if (tq.run) { gl.endQuery(ext.TIME_ELAPSED_EXT); tq.run = false; }
      else if (gl.getQueryParameter(tq.q, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(tq.q, gl.QUERY_RESULT), bad = gl.getParameter(ext.GPU_DISJOINT_EXT);
        gl.deleteQuery(tq.q); tq = null;
        if (live && !bad && ns > 0) put(cur.frames.gpu, ns / 1e6);
      }
    }
    if (!live || cur.frames.n < 10) return;
    const el = document.getElementById(CANVAS[cur.kind] || ''), gl = el && ctxs.get(el);
    if (!gl || gl.isContextLost()) return;
    cur.frames.px = el.width * el.height;
    if (fno % 120 === 45 || (!cur.frames.draws.n && !tq)) {     // and once early in each piece of time
      const c = cnt = { gl, draws: 0, tris: 0, passes: 0 };
      const tri = (mode, n, inst) => (mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0) * inst;
      gl.drawArrays = function (m, a, n) { c.draws++; c.tris += tri(m, n, 1); if (n === 3) c.passes++; return WebGL2RenderingContext.prototype.drawArrays.call(this, m, a, n); };
      gl.drawElements = function (m, n, t, o) { c.draws++; c.tris += tri(m, n, 1); return WebGL2RenderingContext.prototype.drawElements.call(this, m, n, t, o); };
      gl.drawRangeElements = function (m, s0, e0, n, t, o) { c.draws++; c.tris += tri(m, n, 1); return WebGL2RenderingContext.prototype.drawRangeElements.call(this, m, s0, e0, n, t, o); };
      gl.drawArraysInstanced = function (m, a, n, i) { c.draws++; c.tris += tri(m, n, i); return WebGL2RenderingContext.prototype.drawArraysInstanced.call(this, m, a, n, i); };
      gl.drawElementsInstanced = function (m, n, t, o, i) { c.draws++; c.tris += tri(m, n, i); return WebGL2RenderingContext.prototype.drawElementsInstanced.call(this, m, n, t, o, i); };
    } else if (!tq && fno % 30 === 0) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
      gl.getParameter(ext.GPU_DISJOINT_EXT);      // reading it clears it
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      tq = { gl, ext, q, run: true };
    }
  }
  // a view's own account of its GPU frame (the WebGPU pages): ms per frame, draws, triangles, passes, canvas pixels
  function gpu(o) {
    if (!o || !activeNow() || cur.frames.n < 10) return;
    const f = cur.frames;
    if (o.ms > 0 && o.ms < 1000) put(f.gpu, o.ms);
    if (o.draws > 0) { put(f.draws, o.draws); put(f.tris, o.tris || 0); put(f.passes, o.passes || 0); }
    if (o.px > 0) f.px = o.px;
  }
  // the frames the browser calls long (over 50 ms from its start to its paint; the Long Animation Frames API,
  // Chromium): how many, how long they blocked input, and the worst with the script that took most of it
  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (!activeNow()) continue;
        slice.loaf++; slice.block += e.blockingDuration || 0;
        if (e.duration < 150 || (slice.worst && e.duration <= slice.worst.ms)) continue;
        let top = null;
        for (const x of e.scripts || []) if (!top || x.duration > top.duration) top = x;
        slice.worst = { ms: Math.round(e.duration), block_ms: Math.round(e.blockingDuration || 0),
          script: top ? `${String(top.sourceURL || '').replace(location.origin, '').replace(/[?#].*$/, '').slice(-60)}:${top.sourceFunctionName || top.invokerType || ''}`.slice(0, 100) : '',
          script_ms: top ? Math.round(top.duration) : 0, style_ms: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0 };
      }
    }).observe({ type: 'long-animation-frame' });
  } catch (e) { /* no Long Animation Frames here (Safari, Firefox) */ }

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
    globeReady();
    if (!activeNow()) return;
    const h = look(cur.kind), was = cur.here;
    if (!h) return;
    cur.here = h;
    const eng = h.watching || t - lastInput < 60000;
    if (eng) engFlush += dt * 1000;
    const k = `${h.spot}\u0001${h.mode}`;
    let d = cur.dwell.get(k);
    if (!d) cur.dwell.set(k, d = { spot: h.spot, mode: h.mode, s: 0, eng: 0, fn: 0, fms: 0, fslow: 0 });
    d.s += dt; if (eng) d.eng += dt;
    cur.dk = d;      // the frames until the next sample count towards this spot and mode
    // a first "time" half a minute in, so a visit too short for the five-minute one still says how it ran
    if (!cur.early && cur.active + (cur.since != null ? t - cur.since : 0) > 30000) { cur.early = true; sendTime(false); flush(); cur.dk = null; }
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
      if (age < 3 * 864e5) crashes.push(() => track('crash', { prev_view: o.view, prev_city: o.city, prev_spot: o.spot, prev_mode: o.mode, prev_ready: o.ready, prev_up_s: o.up, ago_s: Math.round(age / 1000) }));
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
  return { on: true, track, flush, view, set, gpu, gpuName, frames: () => (cur ? cur.frames.n : 0), here: () => (cur ? cur.here : null), sample };   // frames, here, sample: for tools/telemetry_check.js
})();
