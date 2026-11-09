// A short film of the helicopter in flight (issue 335), to look at what tools/heli_feel.js measures: aboard and
// up, then a run at speed in the chase view, a hard turn, a let-go to a hover, the cockpit view (V) through a
// turn the other way, the bird's-eye view (V) and back to the chase (V). The game's own frame loop is driven at
// 30 frames a second of game time; ffmpeg makes the frames into <out>/<city>-heli.mp4.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/heli_film.js sydney out_dir [WxH]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [,, city = 'sydney', outDir = '.', size = '1280x720'] = process.argv;
const [VW, VH] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('oe3d-quality', 'high'); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ }
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; if (g.heli && g.heli.want) await g.heli.want(); });
  // (the title comes up once the loader has drawn the scene twice; a click before it does nothing: as tools/game_shot.js)
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async () => {
    const g = window.__game;
    for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    g.advance(1);
  });
  // aboard and up to about 120 m (not filmed)
  const ok = await p.evaluate(() => {
    const g = window.__game, st = g.heli.st, d = g.heli.doorAt();
    if (g.cine && g.cine.active && g.cine.skip) g.cine.skip();
    g.player.x = d.x; g.player.y = d.y; g.player.z = st.z;
    g.advance(0.3); g.enterHeli();
    for (let i = 0; i < 20 && g.player.mode !== 'heli'; i++) g.advance(0.5);
    for (let i = 0; i < 60 && st.z < 120; i++) g.advance(0.5, ['Space']);
    return g.player.mode === 'heli';
  });
  if (!ok) { console.log('not aboard'); await b.close(); return; }
  await p.evaluate(() => {
    window.__frames = { cb: null, t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cb = cb; return 1; };
  });
  await p.waitForFunction(() => window.__frames.cb, null, { timeout: 30000 });
  const dir = path.join(outDir, `${city}-heli`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const tick = (keys = [], press = null) => p.evaluate(({ keys, press }) => {
    const g = window.__game, F = window.__frames;
    if (press) { window.dispatchEvent(new KeyboardEvent('keydown', { code: press, key: press })); window.dispatchEvent(new KeyboardEvent('keyup', { code: press, key: press })); g.keys.delete(press); }
    keys.forEach(k => g.keys.add(k));
    const cb = F.cb; F.cb = null; F.t += 1000 / 30; cb(F.t);
    keys.forEach(k => g.keys.delete(k));
    return document.getElementById('game-gl').toDataURL('image/jpeg', 0.85);
  }, { keys, press });
  const film = async (frames, keys, press) => {
    for (let i = 0; i < frames; i++) {
      const url = await tick(keys, i === 0 ? press : null);
      fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
  };
  for (let i = 0; i < 20; i++) await tick(); // settle, not filmed
  await film(120, ['KeyW']); // a run at speed
  await film(75, ['KeyW', 'KeyD']); // a hard turn
  await film(75, []); // let go: to a hover
  await film(105, ['KeyW', 'KeyA'], 'KeyV'); // the cockpit, a turn the other way
  await film(60, ['KeyW'], 'KeyV'); // the bird's-eye view
  await film(75, ['KeyW'], 'KeyV'); // back to the chase
  await b.close();
  const mp4 = path.join(outDir, `${city}-heli.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, '%04d.jpg'), '-pix_fmt', 'yuv420p', '-vf', `scale=${VW}:-2`, mp4]);
  console.log(`${n} frames: ${mp4}`);
})();
