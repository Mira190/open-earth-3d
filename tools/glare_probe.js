// Where a view's highlights come from, and whether a low sun over open water blows out.
// Loads a city in the model viewer, draws the scene alone into a float target at half size and
// reports its brightest pixel and the share of the frame brighter than a lit city (16), with
// everything drawn and without the water.
//   python3 -m http.server 8800 --directory web &
//   one view, taken apart (also without the sky, and without the sun's own light, which leaves
//   what the sky's light gives; with out_dir, its stills with everything, without the water and
//   without the city: all.png, no-water.png, no-city.png):
//     xvfb-run -a node tools/glare_probe.js sydney '[-1750,-1650,760]' '[-260,-620,40]' 6-21 08:00 [1440x900 [out_dir]]
//   every tour stop at its first, middle and last minute, and from each stop's camera turned to
//   the sun an hour after sunrise and an hour before sunset; exits 1 if any view has more than
//   GLARE_SHARE of its frame above 16 (a glare that blooms into a veil or a column, issue 42):
//     xvfb-run -a node tools/glare_probe.js sydney --tour [1440x900 [out_dir]]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const city = argv[0] || 'sydney', tour = argv[1] === '--tour';
const [camS, tgtS, date, time, size, shotDir] = tour ? [null, null, null, null, argv[2] || '1440x900', argv[3] || '']
  : [argv[1] || 'null', argv[2] || 'null', argv[3] || '6-21', argv[4] || '08:00', argv[5] || '1440x900', argv[6] || ''];
const [W, H] = size.split('x').map(Number);
// The share of the frame above 16 that reads as a blown glare: the issue's column was 1.2% of
// it; a low sun's glitter path with the glass towers it lights stays near 0.3%.
const GLARE_SHARE = 0.008;

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000 });
  await p.keyboard.press('Shift');
  await p.evaluate(async () => {
    const C = window.__city, frame = () => new Promise(r => requestAnimationFrame(r));
    C.setTourPlaying(false);
    await frame(); await frame();
    C.setTourPlaying(false);
    // the float target and its measure, kept on the page
    window.__glare = parts => {
      const R = C.renderer, Wd = C.Wd, w = R.domElement.width >> 1, h = R.domElement.height >> 1;
      const measure = () => {
        const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
        R.setRenderTarget(rt); R.render(C.world, C.camera); R.setRenderTarget(null);
        const px = new Float32Array(w * h * 4);
        R.readRenderTargetPixels(rt, 0, 0, w, h, px);
        rt.dispose();
        let max = 0, at = [0, 0], over = 0;
        const rows = new Array(10).fill(0);
        for (let i = 0; i < w * h; i++) {
          const v = Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
          if (v > max) { max = v; at = [i % w, Math.floor(i / w)]; }
          if (v > 16) { over++; rows[9 - Math.floor(Math.floor(i / w) / h * 10)]++; }
        }
        return { max: +max.toFixed(1), at: [+(at[0] / w).toFixed(2), +(1 - at[1] / h).toFixed(2)], share: +(over / (w * h)).toFixed(4), rows };
      };
      const r = { sunAlt: +(Math.asin(Wd.sunDir.y) * 180 / Math.PI).toFixed(1), all: measure() };
      Wd.water.visible = false; r.noWater = measure(); Wd.water.visible = true;
      if (parts) {
        Wd.sky.visible = false; r.noSky = measure(); Wd.sky.visible = true;
        Wd.sunLight.visible = false; r.noSunLight = measure(); Wd.sunLight.visible = true;
      }
      return r;
    };
  });
  // set a view: camera and target in the city's frame, [month, day], minutes (or rel: [sunrise or
  // sunset, minutes]); face turns the camera to the sun's bearing, looking a little down (as
  // tools/city_shot.js does)
  const view = (v, parts) => p.evaluate(async ({ v, parts }) => {
    const C = window.__city, frame = () => new Promise(r => requestAnimationFrame(r));
    C.setTourPlaying(false);
    if (v.date) C.setDate(C.state.y, v.date[0], v.date[1]);
    if (v.rel) C.setTime(Math.round(C.state.limits[v.rel[0]] + v.rel[1])); else C.setTime(v.min);
    if (v.cam) C.flyTo(v.cam, v.tgt, 0);
    if (v.face) {
      const q = C.camera.position, d = C.Wd.sunDir, h = Math.hypot(d.x, d.z) || 1, at = [q.x, -q.z, q.y];
      C.flyTo(at, [at[0] + d.x / h * 4000, at[1] - d.z / h * 4000, Math.max(0, at[2] - 600)], 0);
    }
    for (let i = 0; i < 4; i++) await frame();
    await new Promise(r => setTimeout(r, 600)); // the sky's light rebuilt (envEvery)
    for (let i = 0; i < 2; i++) await frame();
    return window.__glare(parts);
  }, { v, parts });
  const still = async file => {
    const url = await p.evaluate(() => document.getElementById('gl').toDataURL('image/jpeg', 0.88));
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

  if (!tour) {
    const [m, d] = date.split('-').map(Number);
    const out = await view({ cam: JSON.parse(camS), tgt: JSON.parse(tgtS), date: [m, d], min: hm(time) }, true);
    console.log(JSON.stringify(out));
    if (shotDir) {
      fs.mkdirSync(shotDir, { recursive: true });
      for (const [name, hide] of [['all', ''], ['no-water', 'water'], ['no-city', 'city']]) {
        const url = await p.evaluate(async hide => {
          const C = window.__city, Wd = C.Wd, frame = () => new Promise(r => requestAnimationFrame(r));
          const off = hide === 'water' ? [Wd.water] : hide === 'city' ? C.world.children.filter(o => o.visible && o !== Wd.water && o !== Wd.sky && !o.isLight && !Wd.groundMeshes.includes(o)) : [];
          off.forEach(o => { o.visible = false; });
          for (let i = 0; i < 3; i++) await frame();
          const u = document.getElementById('gl').toDataURL('image/png');
          off.forEach(o => { o.visible = true; });
          return u;
        }, hide);
        fs.writeFileSync(path.join(shotDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
      }
    }
    if (errors.length) console.log(errors.join('\n'));
    await b.close();
    return;
  }

  const stops = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cities', city, 'city.json'), 'utf8')).tour || [];
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  let worst = { share: 0 }, bad = 0, n = 0;
  for (const [i, s] of stops.entries()) {
    if (!s.cam) continue;
    const from = hm(s.from || s.time || '12:00'), to = s.to ? hm(s.to) : from;
    const views = [['from', { min: from }], ['mid', { min: Math.round((from + to) / 2) }], ['to', { min: to }],
      ['sunrise+60', { rel: ['sunrise', 60], face: true }], ['sunset-60', { rel: ['sunset', -60], face: true }]]
      .filter(([k]) => !(to === from && (k === 'mid' || k === 'to')));
    for (const [k, v] of views) {
      const r = await view(Object.assign({ cam: s.cam, tgt: s.tgt, date: s.date }, v), false);
      const ok = r.all.share <= GLARE_SHARE;
      n++; if (!ok) bad++;
      const name = `stop-${String(i + 1).padStart(2, '0')}-${k.replace(/[+-]/, '')}`;
      if (r.all.share > worst.share) worst = { share: r.all.share, name };
      if (shotDir && (!ok || v.face)) await still(path.join(shotDir, `${name}.jpg`));
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${city} stop ${i + 1} ${k.padEnd(10)} sun ${String(r.sunAlt).padStart(5)}°  max ${String(r.all.max).padStart(6)}  above 16: ${(r.all.share * 100).toFixed(2)}% (without the water ${(r.noWater.share * 100).toFixed(2)}%)`);
    }
  }
  console.log(`${city}: ${n - bad}/${n} views without a blown glare; most above 16: ${(worst.share * 100).toFixed(2)}% (${worst.name || '-'})`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
