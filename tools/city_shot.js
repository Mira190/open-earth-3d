// Screenshot the city model viewer headlessly (software WebGL through SwiftShader), one page
// load for several views. Used to check building changes before and after.
//   cd web && python3 -m http.server 8800 &
//   node tools/city_shot.js sydney views.json out_dir [width height]
// views.json: [{"name": "cbd", "cam": [x, y, z], "tgt": [x, y, z], "date": [m, d], "time": "09:30"}, ...]
// in the city's local frame (x east, y north, z up, metres); "agl": true measures z from the ground. Writes out_dir/<name>.png and
// prints the page's errors and the frame time of each view.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', width = '1280', height = '720'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  // keep the drawing buffer so the canvas can be read back between frames (page screenshots
  // wait for a compositor frame, which a software renderer may not deliver in time)
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
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 300000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(await p.evaluate(() => window.__buildings || null)));
  await p.keyboard.press('Shift'); // a key skips the establishing shot, which would otherwise hold the camera
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of views) {
    const ms = await p.evaluate(async v => {
      const C = window.__city;
      C.setTourPlaying(false);
      if (v.date) C.setDate(C.state.y, v.date[0], v.date[1]);
      if (v.time) { const [h, m] = v.time.split(':').map(Number); C.setTime(h * 60 + m); }
      // "agl": camera and target heights above the ground instead of above the datum
      const cam = v.agl ? [v.cam[0], v.cam[1], v.cam[2] + C.DSM.ground(v.cam[0], v.cam[1])] : v.cam;
      const tgt = v.agl ? [v.tgt[0], v.tgt[1], v.tgt[2] + C.DSM.ground(v.tgt[0], v.tgt[1])] : v.tgt;
      C.flyTo(cam, tgt, 0); // also cancels a flight in progress
      const frame = () => new Promise(r => requestAnimationFrame(r));
      for (let i = 0; i < 3; i++) await frame();
      const t = performance.now();
      for (let i = 0; i < 3; i++) await frame();
      return (performance.now() - t) / 3;
    }, v);
    const png = await p.evaluate(() => document.getElementById('gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${v.name}: ${ms.toFixed(0)} ms/frame`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
