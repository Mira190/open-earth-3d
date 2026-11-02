// Stills of the title screen at chosen moments of the opening, for judging the picture: the
// menu's Earth, the night pass, the sunrise. Optionally at a given time of day, and with shader
// uniforms overridden to compare a change before and after without editing the code.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/title_shot.js out_dir [WxH] [moments] [utc] [overrides]
//     moments: comma-separated seconds into the opening, or 'menu' (default 'menu')
//     utc: an ISO time for the sun and the night side, e.g. 2026-11-02T00:41:00Z (default now)
//     overrides: JSON {"lens.uGrain": 0, "earth.uSunE": 1.2, "bloom.strength": 0.1, "js": "<code run with e = the renderer's handles>"}
// Writes out_dir/<W>x<H>-<moment>.png at the desktop tier (TIER=low or medium for the others).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, outDir = 'title-shot', size = '1440x900', moments = 'menu', utc = '', overrides = '{}'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(([tier, at]) => {
    try { localStorage.setItem('oe3d-quality', tier); } catch (e) { /* storage blocked */ }
    window.__titleManual = true;
    if (at) {
      const D = Date, shift = D.parse(at) - D.now();
      window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + shift])); } static now() { return D.now() + shift; } };
    }
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  }, [process.env.TIER || 'high', utc]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error' && !/\/version\.json$/.test((m.location() || {}).url || '')) errors.push(m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/index.html#globe`, { timeout: 120000 });
  await p.waitForFunction(() => window.__title && ['gate', 'menu'].includes(window.__title.state), null, { timeout: 300000 });
  fs.mkdirSync(outDir, { recursive: true });
  const T = await p.evaluate(() => window.__title.timing);
  for (const m of moments.split(',')) {
    const t = m === 'menu' ? T.PULL_A + T.PULL_D + 1.5 : +m;
    await p.evaluate(([t, o]) => {
      const e = window.__title.earth;
      for (const [k, v] of Object.entries(o)) {
        if (k === 'js') { new Function('e', v)(e); continue; } // e.g. "e.scene.children[3].visible = false"
        const [obj, key] = k.split('.');
        const u = e[obj] && e[obj][key];
        if (u && typeof u === 'object' && 'value' in u) u.value = v; else if (e[obj]) e[obj][key] = v;
      }
      window.__title.hold(t); e.lens.uFade.value = 1; e.ready.value = 1; window.__title.still(t);
    }, [t, JSON.parse(overrides)]);
    const file = path.join(outDir, `${w}x${h}-${m}.png`);
    await p.screenshot({ path: file, timeout: 240000 });
    console.log(file);
  }
  if (errors.length) console.log('errors:', errors.join(' | '));
  await b.close();
})();
