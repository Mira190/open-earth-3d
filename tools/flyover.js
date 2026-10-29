// Record a city's loading flyover: a spiral from high over the whole model down to the game's
// title camera, rendered in the game itself (its sky, clouds and grade) and encoded as an
// H.264 MP4 and a VP9 WebM (for browsers without H.264), with a poster frame. The loader plays it while the city downloads and builds,
// and the live title screen takes over from its last frame (web/flyover.js).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/flyover.js kyoto [seconds=14] [render_fps=8] [time=10:30] [date=2026-04-15]
// A software renderer takes many seconds per frame over a whole city, so frames are rendered at
// render_fps and ffmpeg interpolates them to 30 fps (a smooth camera over a still scene).
// WIDTH and HEIGHT set the render and video size (default 960 x 540; about 2 MB for 14 s).
// Writes web/data/<city>/flyover.mp4, flyover.webm, flyover.jpg and flyover.json; then run
// `python -c "import sys; sys.path.insert(0, 'pipeline'); import build_scene; build_scene.write_index()"`
// so cities.json lists it.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const [,, city = 'kyoto', seconds = '14', fps = '8', time = '10:30', date = '2026-04-15'] = process.argv;
const W = +(process.env.WIDTH || 960), H = +(process.env.HEIGHT || 540), N = Math.round(+seconds * +fps) + 1, OUT_FPS = 30;
const out = path.join(__dirname, '..', 'web', 'data', city);
const frames = fs.mkdtempSync(path.join(os.tmpdir(), `flyover-${city}-`));

(async () => {
  // under xvfb-run, Mesa's llvmpipe draws the frames, about four times faster than SwiftShader
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  // the tier a desktop GPU gets (quality.js): a software renderer would pick 'low' for itself, with
  // no antialiasing, no bloom and the small set of buildings' details
  await p.addInitScript(q => { try { localStorage.setItem('oe3d-quality', q); } catch (e) { /* storage blocked */ } }, process.env.QUALITY || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) { return get.call(this, t, /webgl/.test(t) ? Object.assign({}, o, { preserveDrawingBuffer: true }) : o); };
  });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  // the path, in the local frame (x east, y north, z up): the look point moves from the model's
  // centre to the title orbit's centre while the camera spirals in over 200 degrees and comes down
  const plan = await p.evaluate(async ([y, m, d, min, city]) => {
    const g = window.__game;
    g.setClock(y, m, d, min);
    const f = (await (await fetch(`data/${city}/scene.json`)).json()).frame, tp = g.flyover.titlePose();
    return { tp, centre: [(f.x[0] + f.x[1]) / 2, (f.y[0] + f.y[1]) / 2, tp.look[2]], ext: Math.max(f.x[1] - f.x[0], f.y[1] - f.y[0]) };
  }, [y, m, d, hh * 60 + mm, city]);
  const smooth = k => k * k * k * (k * (k * 6 - 15) + 10), out_ = k => 1 - (1 - k) ** 3, lerp = (a, b, k) => a + (b - a) * k;
  const L = plan.tp.look, E = plan.tp.cam;
  const azEnd = Math.atan2(E[0] - L[0], E[1] - L[1]), dEnd = Math.hypot(E[0] - L[0], E[1] - L[1]), hEnd = E[2] - L[2];
  const az0 = azEnd - 200 * Math.PI / 180, d0 = plan.ext * 0.5, h0 = plan.ext * 0.42;
  const pose = k => {
    const kc = smooth(Math.min(1, k * 1.15)), ka = smooth(k), kd = out_(k);
    const look = [lerp(plan.centre[0], L[0], kc), lerp(plan.centre[1], L[1], kc), lerp(plan.centre[2], L[2], kc)];
    const az = lerp(az0, azEnd, ka), dist = lerp(d0, dEnd, kd), h = lerp(h0, hEnd, kd);
    return { look, cam: [look[0] + Math.sin(az) * dist, look[1] + Math.cos(az) * dist, look[2] + h], shadow: Math.min(3000, Math.max(600, 0.7 * Math.hypot(dist, h))) };
  };
  const t0 = Date.now();
  let last = 0;
  for (let i = 0; i < N; i++) {
    let jpg = '';
    // now and then a frame comes back black (the game skipped that draw): a black JPEG is a fraction
    // of the size of its neighbours, so take it again, up to three times
    for (let tries = 0; tries < 4 && (!jpg || jpg.length < last * 0.4); tries++) {
      jpg = await p.evaluate(async o => {
        window.__game.flyover.camera(o);
        // one frame: the game's loop, registered first, draws the new pose before this callback runs
        await new Promise(r => requestAnimationFrame(r));
        return document.getElementById('game-gl').toDataURL('image/jpeg', 0.93);
      }, pose(i / (N - 1)));
    }
    last = jpg.length;
    fs.writeFileSync(path.join(frames, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'));
    if (i % 8 === 0 || i < 3) console.log(`frame ${i}/${N} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await p.evaluate(() => { window.__game.flyover.camera(null); window.__game.flyover.restart(); });
  await b.close();
  fs.mkdirSync(out, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', path.join(frames, 'f%04d.jpg'),
    '-filter_complex', `[0]minterpolate=fps=${OUT_FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,split=2[a][b]`,
    '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'flyover.mp4'),
    '-map', '[b]', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '44', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', path.join(out, 'flyover.webm')]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, 'f0000.jpg'), '-vf', 'scale=960:-2', '-q:v', '5', path.join(out, 'flyover.jpg')]);
  fs.writeFileSync(path.join(out, 'flyover.json'), JSON.stringify({ video: 'flyover.mp4', webm: 'flyover.webm', poster: 'flyover.jpg', size: [W, H], seconds: (N - 1) / +fps, fps: OUT_FPS,
    date, time, note: 'Rendered by tools/flyover.js; the last frame is the game title camera at the start of its orbit.' }, null, 1) + '\n');
  fs.rmSync(frames, { recursive: true, force: true });
  const mb = f => (fs.statSync(path.join(out, f)).size / 1e6).toFixed(2);
  console.log(`${city}: flyover.mp4 ${mb('flyover.mp4')} MB, flyover.webm ${mb('flyover.webm')} MB, flyover.jpg ${mb('flyover.jpg')} MB, ${N} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (errs.length) console.log(errs.join('\n'));
})();
