// The 2D canvases, decoded pictures and decoded sounds a city's game holds on a phone's tier, with who made each:
// what tools/mem_infra.js counts as canvas, image and allocator memory but cannot name. A canvas is counted while
// something still refers to it (a WeakRef that has not been collected), at 4 bytes a pixel; a picture while its
// element is alive; a sound by its samples.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/canvas_mem.js shibuya [seconds=40]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [city = 'shibuya', secs = '40'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  await ctx.addInitScript(() => {
    const where = () => (new Error().stack || '').split('\n').slice(3, 6).map(l => l.replace(/^\s*at\s+/, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*/, '')).join(' < ');
    const T = window.__mem = { canvases: [], images: [], sounds: [] };
    const ce = Document.prototype.createElement;
    Document.prototype.createElement = function (n, ...r) { const e = ce.call(this, n, ...r); if (/^canvas$/i.test(n)) T.canvases.push({ ref: new WeakRef(e), at: where() }); if (/^img$/i.test(n)) T.images.push({ ref: new WeakRef(e), at: where() }); return e; };
    const I = window.Image;
    window.Image = function (...a) { const e = new I(...a); T.images.push({ ref: new WeakRef(e), at: where() }); return e; };
    window.Image.prototype = I.prototype;
    if (window.OffscreenCanvas) { const O = window.OffscreenCanvas; window.OffscreenCanvas = function (w, h) { const e = new O(w, h); T.canvases.push({ ref: new WeakRef(e), at: where() }); return e; }; window.OffscreenCanvas.prototype = O.prototype; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const d = AC.prototype.decodeAudioData; AC.prototype.decodeAudioData = function (...a) { const at = where(), p = d.apply(this, a); if (p && p.then) p.then(buf => T.sounds.push({ ref: new WeakRef(buf), at })).catch(() => {}); return p; }; }
    const cib = window.createImageBitmap;
    if (cib) window.createImageBitmap = function (...a) { const at = where(); return cib.apply(this, a).then(bm => { T.images.push({ ref: new WeakRef(bm), at: `bitmap ${at}` }); return bm; }); };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('page error:', e.message));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ''}#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await startPlay(p);
  await p.waitForTimeout(+secs * 1000);
  const out = await p.evaluate(async () => {
    if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 500)); window.gc(); }
    const T = window.__mem, sum = (list, bytes, label) => {
      const by = new Map(); let total = 0, n = 0;
      for (const c of list) { const e = c.ref.deref(); if (!e) continue; const bts = bytes(e); if (!bts) continue; total += bts; n++; const k = `${label(e)}  ${c.at}`, v = by.get(k) || [0, 0]; v[0] += bts; v[1]++; by.set(k, v); }
      return { total, n, top: [...by].sort((a, c) => c[1][0] - a[1][0]).slice(0, 14).map(([k, v]) => `${(v[0] / 1048576).toFixed(1)} MB x${v[1]}  ${k}`) };
    };
    return { canvases: sum(T.canvases, e => (e.width * e.height > 300 * 150 || e.getContext ? e.width * e.height * 4 : 0), e => `${e.width}x${e.height}`),
      images: sum(T.images, e => (e.naturalWidth || e.width || 0) * (e.naturalHeight || e.height || 0) * 4, e => `${e.naturalWidth || e.width}x${e.naturalHeight || e.height} ${(e.src || '').replace(/^.*\//, '').slice(0, 40)}`),
      sounds: sum(T.sounds, e => e.length * e.numberOfChannels * 4, e => `${e.duration.toFixed(0)} s x${e.numberOfChannels}`) };
  });
  for (const [k, v] of Object.entries(out)) { console.log(`${k}: ${v.n} alive, ${(v.total / 1048576).toFixed(0)} MB`); for (const l of v.top) console.log(`  ${l}`); }
  await b.close();
})();
