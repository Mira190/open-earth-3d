// A short film to judge the contact shadows (web/game/ao.js) in motion: their history (issue 375) is
// reprojected from frame to frame, and what that can get wrong only shows while things move (a trail
// behind a walker, shimmer on railings and on a car's edges, a smear after the camera turns). On foot the
// surveyor walks on from the game's start with the camera swinging slowly round; in a car (`car`) they
// drive your car off from where it is parked. The game's own frame loop is driven at 30 frames a second
// of game time and every frame is saved; ffmpeg makes <out>/<city>-ao-<mode><tag>.mp4 (30 fps, real time).
// The tier is forced to high (the full contact shadows). QUERY adds to the page's address: ?ao=show films the
// occlusion alone, ?aotaa=off the frames from scratch as before issue 375, to compare side by side.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=10:00 QUERY='?ao=show' xvfb-run -a node tools/ao_film.js shibuya out_dir foot [seconds, 8] [WxH, 960x540]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', outDir = '.', mode = 'foot', secs = '8', size = '960x540'] = process.argv;
const [w, h] = size.split('x').map(Number);
const query = process.env.QUERY || '';
const tag = query ? '-' + query.replace(/[^a-z0-9=]+/gi, '').replace(/=/g, '-') : '';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await pinClock(p, city);
  await p.addInitScript(t => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
    try { localStorage.setItem('oe3d-onboard', '1'); localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ }
  }, process.env.TIER || 'high');
  p.on('console', m => { if (/^frame: /.test(m.text())) console.log(m.text().slice(0, 600)); });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${query}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(3); });
  await p.evaluate(() => {
    window.__frames = { cbs: [], t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cbs.push(cb); return window.__frames.cbs.length; };
    window.__frames.step = t => { const q = window.__frames.cbs; window.__frames.cbs = []; for (const f of q) try { f(t); } catch (e) { console.log('frame: ' + (e && e.stack || e)); } };
  });
  await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 30000, polling: 50 });
  const how = await p.evaluate(mode => {
    const g = window.__game;
    if (g.atmos && g.atmos.ao) g.atmos.ao.set(2);
    if (mode === 'car') {
      const c = g.myCar && g.myCar();
      if (!c) return 'no car';
      const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1;
      g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
      g.advance(0.3); g.enterCar();
      for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
      return g.player.mode;
    }
    g.player.speed = 0;
    return 'foot';
  }, mode);
  console.log(`${city} ${mode}: ${how}`, await p.evaluate(() => window.__frames.cbs.length));
  const dir = path.join(outDir, `${city}-ao-${mode}${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const step = (save, i) => p.evaluate(([save, i, mode]) => {
    const g = window.__game, F = window.__frames;
    g.keys.clear();
    g.keys.add('KeyW');
    // on foot the camera swings slowly round (parallax on what is near: the history's hardest case); in the car it follows
    if (mode !== 'car') { g.cam.yaw += 0.006 * Math.sin(i / 50); g.cam.lastInput = -10; }
    F.t += 1000 / 30; F.step(F.t);
    return save ? document.getElementById('game-gl').toDataURL('image/jpeg', 0.88) : null;
  }, [save, i, mode]);
  const tick = async (save, i) => { if (process.env.DEBUG) console.log('tick', i, await p.evaluate(() => window.__frames.cbs.length)); await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 60000, polling: 50 }); return step(save, i); };
  for (let i = 0; i < 20; i++) await tick(false, i);
  for (let i = 0; i < secs * 30; i++) {
    const url = await tick(true, i);
    if (url) fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
  const mp4 = path.join(outDir, `${city}-ao-${mode}${tag}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, '%04d.jpg'), '-pix_fmt', 'yuv420p', mp4]);
  console.log(`${n} frames: ${mp4}`);
})();
