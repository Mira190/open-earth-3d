// Film a city's loading screen and its hand-over to the live scene, frame by frame, and flag what a
// visitor would see as a flash: a frame much darker than the ones either side of it, or a black one.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/load_check.js kyoto out_dir [play|model] [WxH] [everyMs]
// HOLD=1 keeps the loading screen up (the buildings never arrive), to look at it.
// Writes out_dir/<n>.jpg (every frame) and prints one line per frame (time, mean brightness, whether
// the loader is up) and a verdict. Exits 1 if it saw a flash or the city never opened.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = 'load-check', mode = 'play', size = '1440x900', every = '250'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  // the moment the loader starts to fade, what the 3D view under it holds: a frame drawn, or still
  // black (the flash a visitor sees). Screenshots can't catch it: the page is too busy then to give one.
  await ctx.addInitScript(sel => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
    const lumOf = c => {
      const k = document.createElement('canvas'); k.width = 64; k.height = 40;
      const g = k.getContext('2d'); g.drawImage(c, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    };
    const watch = () => {
      const l = document.querySelector(sel);
      if (!l) return setTimeout(watch, 50);
      new MutationObserver(() => {
        if (!l.classList.contains('out') || window.__handover) return;
        const cv = [...document.querySelectorAll('canvas')].filter(c => c.offsetParent && c.width > 200).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        window.__handover = { t: performance.now() / 1000, lum: cv ? lumOf(cv) : -1 };
      }).observe(l, { attributes: true, attributeFilter: ['class'] });
    };
    watch();
  }, mode === 'play' ? '#g-loader' : '#loader');
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  fs.mkdirSync(outDir, { recursive: true });
  const loaderSel = mode === 'play' ? '#g-loader' : '#loader';
  // HOLD=1: the buildings never arrive, so the loading screen stays up to be looked at
  if (process.env.HOLD) await p.route(/buildings\.json$/, () => {});
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#${mode === 'play' ? 'play-' : ''}${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const t0 = Date.now(), frames = [];
  let goneAt = null;
  for (let n = 0; n < 2400; n++) {
    const file = path.join(outDir, `${String(n).padStart(4, '0')}.jpg`);
    let buf;
    try { buf = await p.screenshot({ type: 'jpeg', quality: 70, timeout: 60000 }); } catch (e) { continue; }
    fs.writeFileSync(file, buf);
    // the frame's mean brightness, from a small copy drawn in the page (no image library needed here)
    const lum = await p.evaluate(async b64 => {
      const im = new Image(); im.src = `data:image/jpeg;base64,${b64}`; await im.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 40;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    }, buf.toString('base64'));
    const up = await p.evaluate(sel => { const l = document.querySelector(sel); return !!l && !l.hidden; }, loaderSel);
    const t = (Date.now() - t0) / 1000;
    frames.push({ n, t, lum, up });
    console.log(`${String(n).padStart(4)} ${t.toFixed(1).padStart(6)} s  ${lum.toFixed(1).padStart(6)}  ${up ? 'loader' : 'scene'}`);
    if (!up && goneAt === null) goneAt = t;
    if (goneAt !== null && t - goneAt > 6) break;
    if (t > 900) break;
    await p.waitForTimeout(+every);
  }
  // a flash: a frame at least 45% darker than both neighbours, or a black frame once anything was shown
  const flashes = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1].lum, m = frames[i].lum, c = frames[i + 1].lum;
    if ((m < 0.55 * a && m < 0.55 * c) || (m < 4 && Math.max(a, c) > 12)) flashes.push(frames[i]);
  }
  console.log(goneAt === null ? 'FAIL the city never opened' : `opened after ${goneAt.toFixed(1)} s`);
  const hand = await p.evaluate(() => window.__handover || null);
  if (hand) {
    console.log(hand.lum >= 4 ? `ok   the view was drawn when the loader began to fade (brightness ${hand.lum.toFixed(1)})` : `FAIL the view was black when the loader began to fade (${hand.lum.toFixed(1)})`);
    if (hand.lum < 4) flashes.push({ n: -1, t: hand.t, lum: hand.lum });
  }
  console.log(flashes.length ? `FAIL ${flashes.length} flash(es): ${flashes.map(f => `#${f.n} at ${f.t.toFixed(1)} s (${f.lum.toFixed(1)})`).join(', ')}` : 'ok   no flash');
  if (errors.length) console.log('errors:', errors.join(' | '));
  await b.close();
  process.exit(goneAt === null || flashes.length ? 1 : 0);
})();
