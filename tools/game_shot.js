// Stills from a city's game, on foot: for each view the surveyor stands at `at` facing `look`, the
// chase camera behind at `dist` metres and `pitch` radians, at the clock time given (HH:MM local,
// or "sunset+20"); "date" [month, day] sets the day. Used to look at a change the way a player
// sees it, through the game's own post stack. Prints the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/game_shot.js sydney views.json out_dir [WxH]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{"name": "steps", "at": [x, y], "look": [x, y], "time": "15:30", "dist": 6, "pitch": 0.15}, ...]
// in the city's local frame (x east, y north, metres).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', size = '1440x900'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  // a software renderer picks the low tier for itself; stills are taken at the desktop one
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  for (const v of views) {
    await p.evaluate(v => {
      const g = window.__game, c = g.clock;
      if (g.cine.active) g.cine.skip();
      const lim = g.dayLimits ? g.dayLimits() : null, m = v.date ? v.date[0] : c.m, d = v.date ? v.date[1] : c.d;
      const rel = /^(sunrise|sunset)([+-]\d+)?$/.exec(v.time || '');
      let min = 12 * 60;
      if (rel && lim) min = Math.round(lim[rel[1]] + (+rel[2] || 0));
      else if (v.time) { const [hh, mm] = v.time.split(':').map(Number); min = hh * 60 + mm; }
      g.setClock(c.y, m, d, min);
      const [x, y] = v.at, f = g.nav.floorAt(x, y, 200);
      g.player.x = x; g.player.y = y; g.player.z = f ? f.z : 0;
      g.player.h = Math.atan2(v.look[0] - x, v.look[1] - y);
      Object.assign(g.cam, { mode: 'chase', yaw: g.player.h, pitch: v.pitch ?? 0.12, dist: v.dist ?? 5, distTo: 0, yawTo: null, lastInput: -10 });
      g.advance(2);
    }, v);
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(v.name);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
