// A day in half a minute: a time-lapse of one view of a city's game from before sunrise to night, to look at the
// sky, the clouds and the hour's grade in motion (docs/LOOK.md). The camera stands over a point and turns slowly;
// the clock runs from sunrise-40 to sunset+110 minutes; the clouds drift on the film's own clock.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/day_film.js shibuya out.mp4 [WxH] [seconds] [fps]
// AT=x,y (local metres; default the game's spawn), UP=metres over the ground there (default 28), LOOK=degrees
// clockwise from north the view starts at (default 250, west-south-west: the sun sets in frame), TURN=degrees it
// turns through (default 25), WEATHER=clear|overcast|rain, TIER=high, PORT.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [,, city = 'shibuya', out = 'day.mp4', size = '1280x720', seconds = '24', fps = '20'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number), N = Math.round(+seconds * +fps);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oe3d-day-'));
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.evaluate(() => window.__game.groundShown && window.__game.groundShown());
  const env = { at: process.env.AT ? process.env.AT.split(',').map(Number) : null, up: +(process.env.UP || 28), look: +(process.env.LOOK || 250), turn: +(process.env.TURN || 25), weather: process.env.WEATHER || 'clear' };
  const plan = await p.evaluate(env => {
    const g = window.__game, sp = (g.G.spawn || {}).at || [0, 0], at = env.at || sp, lim = g.dayLimits();
    if (g.weather) g.weather.set(env.weather, { now: true });
    return { at, z: Math.max(0, g.nav.terrain(at[0], at[1])) + env.up, t0: lim.sunrise - 40, t1: lim.sunset + 110 };
  }, env);
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const png = await p.evaluate(async ({ k, i, plan, env }) => {
      const g = window.__game, c = g.clock, a = (env.look + env.turn * (k - 0.5)) * Math.PI / 180;
      g.setClock(c.y, c.m, c.d, plan.t0 + (plan.t1 - plan.t0) * k);
      if (g.atmos) g.atmos.skyTime = i * 12; // (the clouds: twelve seconds a frame)
      g.flyover.camera({ cam: [plan.at[0], plan.at[1], plan.z], look: [plan.at[0] + Math.sin(a) * 400, plan.at[1] + Math.cos(a) * 400, plan.z + 70], shadow: 700 });
      for (let n = 0; n < 2; n++) await new Promise(r => requestAnimationFrame(r));
      return document.getElementById('game-gl').toDataURL('image/jpeg', 0.93);
    }, { k, i, plan, env });
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(png.split(',')[1], 'base64'));
    if (i % 40 === 0) console.log(`frame ${i}/${N}`);
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', path.join(dir, 'f%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });
