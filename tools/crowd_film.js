// A film of the crowd where it masses near you, to see how it moves (tools/crowd_press.js measures
// it): you stand at the game's start (or at x, y), the chase camera high behind you looking at the
// thickest of the crowd within 18 m, and the game's frame loop is driven at 30 frames a second of
// game time, every second frame saved. ffmpeg makes them into <out>/<city>-crowd.mp4 (15 fps, real time).
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=17:30 xvfb-run -a node tools/crowd_film.js shibuya out_dir [seconds, 40] [x y]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', outDir = '.', secs = '40', ax, ay] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  await pinClock(p, city);
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
    try { localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ }
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(3); });
  await p.evaluate(() => {
    window.__frames = { cb: null, t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cb = cb; return 1; };
  });
  await p.waitForFunction(() => window.__frames.cb, null, { timeout: 30000 });
  await p.evaluate(([ax, ay]) => {
    const g = window.__game;
    if (ax != null) { const s = g.nav.stand(+ax, +ay, 0, { rMax: 3 }); if (s) { g.player.x = s.x; g.player.y = s.y; g.player.z = s.z; } }
    g.player.speed = 0;
  }, [ax, ay]);
  const dir = path.join(outDir, `${city}-crowd`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const tick = async save => { await p.waitForFunction(() => window.__frames.cb, null, { timeout: 60000 }); return step(save); };
  const step = save => p.evaluate(save => {
    const g = window.__game, F = window.__frames, P = g.crowd.P, me = g.player;
    // aim at the thickest of the crowd within 18 m, eased
    let bx = 0, by = 0, bn = 0;
    for (let i = 0; i < g.crowd.active; i++) { const q = P[i]; if (q.line < 0) continue; const d = Math.hypot(q.x - me.x, q.y - me.y); if (d > 3 && d < 18) { let c = 0; for (let j = 0; j < g.crowd.active; j++) { const o = P[j]; if (o.line >= 0 && Math.abs(o.x - q.x) < 3 && Math.abs(o.y - q.y) < 3) c++; } if (c > bn) { bn = c; bx = q.x; by = q.y; } } }
    if (bn) { const yaw = Math.atan2(bx - me.x, by - me.y); const w = window.__aim == null ? yaw : window.__aim + Math.atan2(Math.sin(yaw - window.__aim), Math.cos(yaw - window.__aim)) * 0.01; window.__aim = w; }
    g.cam.mode = 'chase'; g.cam.dist = 8; g.cam.pitch = 0.42; if (window.__aim != null) { g.cam.yaw = window.__aim; me.h = window.__aim; }
    const cb = F.cb; F.cb = null; F.t += 1000 / 30; cb(F.t);
    return save ? document.getElementById('game-gl').toDataURL('image/jpeg', 0.85) : null;
  }, save);
  for (let i = 0; i < 30; i++) await tick(false);
  for (let i = 0; i < secs * 30; i++) {
    const url = await tick(i % 2 === 0);
    if (url) fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
  const mp4 = path.join(outDir, `${city}-crowd.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '15', '-i', path.join(dir, '%04d.jpg'), '-pix_fmt', 'yuv420p', mp4]);
  console.log(`${n} frames: ${mp4}`);
})();
