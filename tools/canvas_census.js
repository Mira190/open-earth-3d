// The 2D canvases and decoded pictures a city's game makes on a phone's tier, and which are still alive once it
// plays: each canvas that asks for a '2d' context (and each OffscreenCanvas) is noted with the line that made
// it, and after a collection the live ones are summed by that line at their present size (4 bytes a pixel).
// A canvas kept after its picture went to the GPU is memory an iPhone counts and the player never sees
// (docs/PERFORMANCE.md, "A map built round the player").
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/canvas_census.js shibuya [seconds, default 45]      (TIER=low|medium|high)
const { chromium } = require('playwright');
const [city = 'shibuya', secs = '45'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(t => {
    try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ }
    const seen = [], peak = { now: 0, max: 0, at: 0 };
    const where = () => (new Error().stack || '').split('\n').slice(3, 6).map(l => l.replace(/^\s*at\s+/, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/, '')).join(' < ');
    const note = (c, kind) => { if (!c.__census) { c.__census = 1; seen.push({ ref: new WeakRef(c), kind, where: where(), t: performance.now() }); } };
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { if (type === '2d') note(this, '2d'); return get.call(this, type, ...a); };
    if (window.OffscreenCanvas) {
      const og = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function (type, ...a) { if (type === '2d') note(this, 'offscreen'); return og.call(this, type, ...a); };
    }
    window.__census = () => {
      const by = new Map();
      let live = 0, made = 0;
      for (const s of seen) {
        made++;
        const c = s.ref.deref();
        if (!c || !c.width || !c.height) continue;
        live++;
        const k = s.where, e = by.get(k) || { where: k, n: 0, bytes: 0, big: '' };
        e.n++; e.bytes += c.width * c.height * 4;
        if (!e.big || c.width * c.height > e.px) { e.px = c.width * c.height; e.big = `${c.width}x${c.height}${c.isConnected ? ' (in the page)' : ''}`; }
        by.set(k, e);
      }
      return { made, live, rows: [...by.values()].sort((a, b) => b.bytes - a.bytes) };
    };
  }, process.env.TIER || 'low');
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}${process.env.QUERY || ''}`).catch(() => {});
  await p.waitForTimeout(+secs * 1000);
  await p.evaluate(() => { if (window.gc) { gc(); gc(); } });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => window.__census());
  const total = r.rows.reduce((s, e) => s + e.bytes, 0);
  console.log(`${city}: ${r.made} 2D canvases made, ${r.live} alive, ${(total / 1048576).toFixed(0)} MB`);
  for (const e of r.rows.slice(0, +(process.env.TOP || 25))) console.log(`${(e.bytes / 1048576).toFixed(1).padStart(7)} MB  ${String(e.n).padStart(4)} x  largest ${e.big.padEnd(26)} ${e.where}`);
  await b.close();
})();
