// A short film of the chase camera in tight spots, for looking at what tools/game_check.js measures
// (#97): the game's own frame loop is driven at 30 frames a second of game time, and each frame is
// drawn and saved while the camera swings round a wall close behind the player and then follows
// them along it. ffmpeg makes the frames into <out>/<city>-chase.mp4.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/chase_film.js shibuya out_dir [spots]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [,, city = 'shibuya', outDir = '.', nSpots = '3'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
    try { localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ }
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => window.__game.advance(3));
  // take over the frame loop: the game asks for its next frame, and the film calls it at a fixed step
  await p.evaluate(() => {
    // (every callback asked for in a frame, not only the last: a one-off animation's, a toast fading, asked after the
    // game's own frame would otherwise take its place, and the game would stop)
    window.__frames = { cbs: [], t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cbs.push(cb); return window.__frames.cbs.length; };
    window.__frames.step = t => { const q = window.__frames.cbs; window.__frames.cbs = []; for (const f of q) f(t); };
  });
  await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 30000 });
  const spots = await p.evaluate(n => {
    const g = window.__game, V = (x, y, z) => new THREE.Vector3(x, z, -y), x0 = g.player.x, y0 = g.player.y, out = [];
    for (let k = 0; k < 400 && out.length < n; k++) {
      const a = k * 2.39996, d = 20 + 280 * Math.sqrt(k / 400), s = g.nav.stand(x0 + Math.cos(a) * d, y0 + Math.sin(a) * d, 0, { rMax: 3 });
      if (!s || out.some(q => Math.hypot(q.x - s.x, q.y - s.y) < 40)) continue;
      for (let j = 0; j < 8; j++) {
        const yaw = j * Math.PI / 4, f = g.nav.clearFraction(V(s.x, s.y, s.z + 1.55), V(s.x - Math.sin(yaw) * 6.9, s.y - Math.cos(yaw) * 6.9, s.z + 4.15));
        if (f > 0.2 && f < 0.6) { out.push({ x: s.x, y: s.y, z: s.z, yaw }); break; }
      }
    }
    return out;
  }, +nSpots);
  const dir = path.join(outDir, `${city}-chase`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const tick = (each, keys = []) => p.evaluate(({ each, keys }) => {
    const g = window.__game, F = window.__frames;
    if (each) g.cam.yaw += each;
    keys.forEach(k => g.keys.add(k));
    F.t += 1000 / 30; F.step(F.t);
    keys.forEach(k => g.keys.delete(k));
    return document.getElementById('game-gl').toDataURL('image/jpeg', 0.85);
  }, { each, keys });
  for (const s of spots) {
    await p.evaluate(s => {
      const g = window.__game;
      g.player.x = s.x; g.player.y = s.y; g.player.z = s.z; g.player.speed = 0; g.player.h = s.yaw;
      g.cam.mode = 'chase'; g.cam.dist = 7.5; g.cam.pitch = 0.36; g.cam.yaw = s.yaw + 1.2;
    }, s);
    for (let i = 0; i < 30; i++) await tick(0); // settle, not filmed
    for (let i = 0; i < 150; i++) {
      const url = await tick(i < 75 ? -0.032 : 0, i >= 75 ? ['KeyW'] : []);
      fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  await b.close();
  const mp4 = path.join(outDir, `${city}-chase.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, '%04d.jpg'), '-pix_fmt', 'yuv420p', '-vf', 'scale=960:-2', mp4]);
  console.log(`${spots.length} spots, ${n} frames: ${mp4}`);
})();
