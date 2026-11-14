// Stills of the crowd in the rain, to see that the umbrellas are held: the surveyor stands a few
// metres from the nearest walker with an umbrella up (a skinned person, near) and the camera looks
// at them; then a wider view down the street (the far crowd, instanced).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/umbrella_shot.js tokyo out_dir [WxH] [time]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const [,, city = 'tokyo', outDir = '.', size = '1440x900', time = '15:00'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
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
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  const grab = async name => {
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(name);
  };
  for (const [name, dist, pitch, off] of [['near', 2.2, 0.02, 3.2], ['far', 9, 0.18, 40]]) {
    const got = await p.evaluate(async ([dist, pitch, off, time]) => {
      const g = window.__game;
      if (g.cine.active) g.cine.skip();
      const c = g.clock, [hh, mm] = time.split(':').map(Number);
      g.setClock(c.y, c.m, c.d, hh * 60 + mm);
      g.weather.set('rain', { now: true });
      g.advance(1);
      // the walker nearest the player who is out on the street
      const P = g.crowd.P.filter(q => q.line >= 0 && q.state === 'walk');
      if (!P.length) return null;
      P.sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y));
      const q = P[0];
      // stand off to its side, looking at it
      const sx = q.x + Math.cos(q.h) * off, sy = q.y - Math.sin(q.h) * off;
      g.player.x = sx + 400; g.advance(0.05);
      g.player.x = sx; g.player.y = sy; g.player.z = q.z;
      g.player.h = Math.atan2(q.x - sx, q.y - sy);
      Object.assign(g.cam, { mode: 'chase', yaw: g.player.h, pitch, dist, distTo: 0, yawTo: null, lastInput: -10 });
      g.advance(1.5);
      const cd = g.crowdDraw();
      return { near: [...cd.active.values()].filter(r => r.umbOn).length, walkers: P.length };
    }, [dist, pitch, off, time]);
    console.log(name, JSON.stringify(got));
    await grab(name);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
