// Stills of the camera's own effects (atmosphere.js CAMFX), to look at after a change to them: photo mode's
// depth of field at f/1.4 focused on the surveyor and the same view at f/16 (none), and the opening shot's
// motion blur and depth of field part way down the crane.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/camfx_shot.js sydney out_dir [WxH]
// Writes <out>/<city>-camfx-{sharp,dof,crane-1,crane-2}.png and prints the frames' mean luma, and how much the
// depth of field changed the frame (mean absolute difference from the sharp one, 0-255). PORT picks the server.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('oe3d-quality', 'desktop'); } catch (e) { /* storage blocked */ }
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  fs.mkdirSync(outDir, { recursive: true });
  const grab = async name => {
    const url = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    const file = path.join(outDir, `${city}-camfx-${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return url;
  };
  // mean luma of a frame, and the mean absolute difference between two, measured in the page on a small copy
  const measure = (a, z) => p.evaluate(async ([a, z]) => {
    const px = async u => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = 320; c.height = 200;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 320, 200); return g.getImageData(0, 0, 320, 200).data; };
    const A = await px(a), Z = z ? await px(z) : null;
    let l = 0, d = 0;
    for (let i = 0; i < A.length; i += 4) { l += 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2]; if (Z) d += (Math.abs(A[i] - Z[i]) + Math.abs(A[i + 1] - Z[i + 1]) + Math.abs(A[i + 2] - Z[i + 2])) / 3; }
    return { luma: l / (A.length / 4), diff: Z ? d / (A.length / 4) : null };
  }, [a, z]);
  const frames = n => p.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && !document.getElementById('g-title').hidden, null, { timeout: 900000, polling: 500 });
  // the opening shot, part way down: the camera's effects are on while it moves
  await p.evaluate(() => { const b = document.querySelector('#gt-timechoice [data-t="morning"]'); if (b) b.click(); document.getElementById('gt-play').click(); });
  const crane = [];
  for (const k of [0.35, 0.6]) {
    await p.waitForFunction(k => { const c = window.__game.cine; return !c.active || c.k >= k; }, k, { timeout: 300000, polling: 'raf' });
    crane.push(await grab(`crane-${crane.length + 1}`));
  }
  await p.waitForFunction(() => !window.__game.arriving(), null, { timeout: 300000, polling: 500 });
  // photo mode, held still on the surveyor: at f/16 (sharp) and at f/1.4
  await p.evaluate(() => { const g = window.__game; if (window.OEOnboard.current()) window.OEOnboard.current().skip(); g.photoMode(true); g.photo.fstop = 16; });
  await frames(4);
  const sharp = await grab('sharp');
  await p.evaluate(() => { window.__game.photo.fstop = 1.4; });
  await frames(4);
  const dof = await grab('dof');
  const ms = await measure(sharp), md = await measure(dof, sharp), c1 = await measure(crane[0]), c2 = await measure(crane[1]);
  console.log(`${city} ${size}: sharp luma ${ms.luma.toFixed(1)}; f/1.4 luma ${md.luma.toFixed(1)}, differs from sharp by ${md.diff.toFixed(2)}; crane luma ${c1.luma.toFixed(1)}, ${c2.luma.toFixed(1)}`);
  if (errs.length) console.log('page errors:', errs);
  await b.close();
})();
