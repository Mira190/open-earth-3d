// Screenshot the game headlessly from scripted cameras over its title screen (the hook tools/flyover.js
// records with), several views a page load: the game's own sky, clouds, haze and grade, at the desktop
// picture tier (TIER=medium or low for the others). For checking a change to the world the viewer and the
// game share (world.js, water.js) in the game as well as in the viewer (tools/city_shot.js).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/game_shot.js sydney views.json out_dir [width height]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{"name": "harbour", "cam": [x, y, z], "tgt": [x, y, z], "date": [m, d], "time": "sunset-25"}, ...]
// in the city's local frame (x east, y north, z up, metres); "time" is "HH:MM" or relative to the day's sun
// ("sunset+15", "sunrise-20"). Writes out_dir/<name>.png and prints the page's errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', width = '1280', height = '720'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  // a software renderer picks the low tier for itself; stills are taken at the desktop one
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
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
      const g = window.__game, c = g.clock;
      const [m, d] = v.date || [c.m, c.d];
      g.setClock(c.y, m, d, c.min);
      const rel = v.time && /^(sunrise|sunset)([+-]\d+)?$/.exec(v.time);
      if (rel) g.setClock(c.y, m, d, Math.round(g.dayLimits()[rel[1]] + (+rel[2] || 0)));
      else if (v.time) { const [h, mm] = v.time.split(':').map(Number); g.setClock(c.y, m, d, h * 60 + mm); }
      g.flyover.camera({ cam: v.cam, look: v.tgt, shadow: Math.min(3000, Math.max(600, 0.7 * Math.hypot(v.cam[0] - v.tgt[0], v.cam[1] - v.tgt[1], v.cam[2] - v.tgt[2]))) });
      const frame = () => new Promise(r => requestAnimationFrame(r));
      for (let i = 0; i < 3; i++) await frame();
      const t = performance.now();
      for (let i = 0; i < 3; i++) await frame();
      return (performance.now() - t) / 3;
    }, v);
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${v.name}: ${ms.toFixed(0)} ms/frame`);
  }
  await p.evaluate(() => window.__game.flyover.camera(null));
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
