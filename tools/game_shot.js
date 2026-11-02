// Stills of a city in the game (its sky, clouds, crowd and post stack), one page load for several
// views, at the desktop picture tier (QUALITY=medium or low for the others). The camera is the
// scripted title camera that tools/flyover.js records with, so the views are the same as the
// model viewer's (tools/city_shot.js) for a side-by-side check.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/game_shot.js osaka views.json out_dir [width height]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{"name": "castle", "cam": [x, y, z], "tgt": [x, y, z], "date": [m, d], "time": "21:00"}, ...]
// ("time" may be "sunset+120" or "sunrise-20"), in the city's local frame (x east, y north, z up,
// metres). Writes out_dir/<name>.png and prints the page's errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', width = '1440', height = '900'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  // a software renderer picks the low tier for itself; stills are taken at the desktop one
  await p.addInitScript(q => { try { localStorage.setItem('oe3d-quality', q); } catch (e) { /* storage blocked */ } }, process.env.QUALITY || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) { return get.call(this, t, /webgl/.test(t) ? Object.assign({}, o, { preserveDrawingBuffer: true }) : o); };
  });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 400)}`));
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 900000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of views) {
    const ms = await p.evaluate(async v => {
      const g = window.__game, c = g.clock, [m, d] = v.date || [c.m, c.d];
      // "time": "HH:MM", or relative to the day's sun: "sunset+120", "sunrise-20", "sunset"
      g.setClock(c.y, m, d, c.min);
      const rel = v.time && /^(sunrise|sunset)([+-]\d+)?$/.exec(v.time), L = g.dayLimits();
      const min = rel ? Math.round(L[rel[1]] + (+rel[2] || 0)) : v.time ? v.time.split(':').reduce((h, x) => h * 60 + +x) : c.min;
      g.setClock(c.y, m, d, min);
      const tgt = v.tgt || [v.cam[0], v.cam[1] + 100, v.cam[2] - 30];
      g.flyover.camera({ cam: v.cam, look: tgt, shadow: Math.min(3000, Math.max(600, 0.7 * Math.hypot(v.cam[0] - tgt[0], v.cam[1] - tgt[1], v.cam[2] - tgt[2]))) });
      const frame = () => new Promise(r => requestAnimationFrame(r));
      for (let i = 0; i < 4; i++) await frame();
      const t = performance.now();
      for (let i = 0; i < 2; i++) await frame();
      return (performance.now() - t) / 2;
    }, v);
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${v.name}: ${ms.toFixed(0)} ms/frame`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
