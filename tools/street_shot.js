// Street-level stills from a city's game at given places and times, at the desktop picture tier: you on foot or
// at the wheel of your car there, the camera behind you. One page load for all the views.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/street_shot.js sydney views.json out_dir [WxH]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{ "name": "town-hall", "at": [x, y], "time": "10:36", "car": true, "face": [x, y] or "h": radians,
//   "yaw": radians off the heading (0: from behind), "pitch": 0.25, "dist": 8, "wait": 3 }, ...]
// in the city's local frame (x east, y north, metres). With "car", your car is put in the traffic's lane
// of the road nearest "at", facing along it (towards "face" if given), and you are at the wheel.
// Writes out_dir/<city>-<name>-<W>.png and prints the page's errors.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', size = '1440x900'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => window.__game.advance(1));
  for (const v of views) {
    const where = await p.evaluate(v => {
      const g = window.__game, c = g.myCar && g.myCar();
      if (g.cine.active) g.cine.skip();
      if (v.time) { const [hh, mm] = v.time.split(':').map(Number), k = g.clock; g.setClock(k.y, k.m, k.d, hh * 60 + mm); }
      let heading = v.h || 0;
      if (v.car && c) {
        if (g.player.mode !== 'car') { g.enterCar(); for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5); }
        const st = c.D.st, keep = g.KEEP === 'left' ? 1 : -1, pl = g.roads.place(v.at[0], v.at[1], 60, keep);
        if (pl) {
          const q = {};
          g.roadNet.at(pl.line, pl.s, q);
          let dir = pl.dir;
          if (v.face && (v.face[0] - q.x) * q.hx * dir + (v.face[1] - q.y) * q.hy * dir < 0) dir = -dir;
          const hx = q.hx * dir, hy = q.hy * dir, k = OECars.LANE * keep;
          heading = Math.atan2(hx, hy);
          Object.assign(st, { x: q.x - hy * k, y: q.y + hx * k, z: q.z, h: heading, vx: 0, vy: 0, v: 0, speed: 0, r: 0 });
        }
      } else {
        if (g.player.mode === 'car') g.exitCar();
        const s = g.nav.stand(v.at[0], v.at[1], g.nav.terrain(v.at[0], v.at[1]) + 1, { rMax: 10 });
        if (s) { g.player.x = s.x; g.player.y = s.y; g.player.z = s.z; }
        if (v.face) heading = Math.atan2(v.face[0] - g.player.x, v.face[1] - g.player.y);
        g.player.h = heading;
      }
      Object.assign(g.cam, { mode: 'chase', yaw: heading + (v.yaw || 0), pitch: v.pitch ?? 0.22, dist: v.dist || 8, distTo: 0, yawTo: null, lastInput: -10 });
      g.advance(v.wait || 3);
      Object.assign(g.cam, { yaw: heading + (v.yaw || 0), pitch: v.pitch ?? 0.22 });
      g.advance(0.1);
      return { x: +g.player.x.toFixed(1), y: +g.player.y.toFixed(1), mode: g.player.mode };
    }, v);
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    const file = path.join(outDir, `${city}-${v.name}-${w}.png`);
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${file}: ${where.mode} at (${where.x}, ${where.y})`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
