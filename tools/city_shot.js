// Screenshot the city model viewer headlessly, one page load for several views, at the desktop
// picture tier (TIER=medium or low for the others; QUERY=water=high adds the water's reflection,
// which a software renderer leaves out). Used to check changes before and after.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/city_shot.js sydney views.json out_dir [width height]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{"name": "cbd", "cam": [x, y, z], "tgt": [x, y, z], "date": [m, d], "time": "09:30"}, ...]
// ("time" may be "sunset+15" or "sunrise-20"; without "cam" the view is the city's opening camera;
// "face": "sun" or "away" turns that camera to the sun's bearing or away from it; "js" is evaluated
// with C = window.__city before the frame, to take a part away and compare)
// in the city's local frame (x east, y north, z up, metres); "agl": true measures z from the ground. Writes out_dir/<name>.png and
// prints the page's errors and the frame time of each view.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', width = '1280', height = '720'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  // under xvfb-run, Mesa's llvmpipe draws the frames, several times faster than SwiftShader
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  // a software renderer picks the low tier for itself; stills are taken at the desktop one
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
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
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY ? `?${process.env.QUERY}` : ''}#${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(await p.evaluate(() => window.__buildings || null)));
  await p.keyboard.press('Shift'); // a key skips the establishing shot, which would otherwise hold the camera
  // the skip lands on the tour's first stop on the next frame: let it, or it takes the first view's
  // camera. Pause the tour first: a software frame can outlast a stop's hold, and the tour would move
  // on a stop a frame (to a sun-access place, whose sample points stay drawn). The views keep the
  // first stop's date unless they give one.
  await p.evaluate(async () => {
    const C = window.__city, frame = () => new Promise(r => requestAnimationFrame(r));
    C.setTourPlaying(false);
    await frame(); await frame();
    C.startStop(0, true);
    C.setTourPlaying(false);
  });
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of views) {
    const ms = await p.evaluate(async v => {
      const C = window.__city;
      C.setTourPlaying(false);
      if (v.date) C.setDate(C.state.y, v.date[0], v.date[1]);
      // "time": "HH:MM", or relative to the day's sun: "sunset+15", "sunrise-20", "sunset"
      const rel = v.time && /^(sunrise|sunset)([+-]\d+)?$/.exec(v.time);
      if (rel) C.setTime(Math.round(C.state.limits[rel[1]] + (+rel[2] || 0)));
      else if (v.time) { const [h, m] = v.time.split(':').map(Number); C.setTime(h * 60 + m); }
      // "agl": camera and target heights above the ground instead of above the datum
      const cam = v.cam && v.agl ? [v.cam[0], v.cam[1], v.cam[2] + C.DSM.ground(v.cam[0], v.cam[1])] : v.cam;
      const tgt = v.tgt && v.agl ? [v.tgt[0], v.tgt[1], v.tgt[2] + C.DSM.ground(v.tgt[0], v.tgt[1])] : v.tgt;
      if (cam) C.flyTo(cam, tgt, 0); // also cancels a flight in progress (no "cam": the city's own opening view)
      // "face": "sun" (or "away"): from that camera, or the opening one, turn to the sun's bearing (or
      // away from it), looking a little down, as for the golden hour's sky over the city
      if (v.face) {
        const p = C.camera.position, d = C.Wd.sunDir, k = v.face === 'away' ? -1 : 1, h = Math.hypot(d.x, d.z) || 1;
        const at = [p.x, -p.z, p.y];
        C.flyTo(at, [at[0] + k * d.x / h * 4000, at[1] - k * d.z / h * 4000, Math.max(0, at[2] - 600)], 0);
      }
      if (v.js) new Function('C', v.js)(C);
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
