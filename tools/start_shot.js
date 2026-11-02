// Stills of where a city's game starts you: the opening view, and the helicopter waiting on the
// first pad seen from 30 m (with how far it is from the start, and the nearest wharf and kerb),
// at the desktop picture tier. Times: "11:00", "sunset+20", "night" (22:00).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/start_shot.js sydney out_dir [1440x900] [11:00,sunset+20,night]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900', times = '11:00'] = process.argv;
const [W, H] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, isMobile: W < 600, hasTouch: W < 600 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  fs.mkdirSync(outDir, { recursive: true });
  const tag = W < 600 ? 'phone' : 'desk';
  const shot = async name => {
    // advance() moves the game without drawing: wait for two real frames
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${city}-${name}-${tag}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const info = await p.evaluate(() => {
    const g = window.__game, pl = g.player;
    g.advance(4); // past the crane shot that opens the game
    if (g.cine.active) g.cine.skip();
    g.advance(1);
    const k = g.roads.place(pl.x, pl.y, 400, 1, pl.z);
    const w = (g.fer && g.fer.wharves) || null;
    return { at: [pl.x, pl.y, pl.z].map(v => +v.toFixed(1)), heli: g.heli ? Math.round(Math.hypot(g.heli.st.x - pl.x, g.heli.st.y - pl.y)) : null,
      kerb: k ? Math.round(k.d) : null, h: pl.h };
  });
  for (const t of times.split(',')) {
    await p.evaluate(t => {
      const g = window.__game, c = g.clock;
      const sun = /^sunset([+-]\d+)?$/.exec(t);
      const min = t === 'night' ? 22 * 60 : sun ? Math.round(g.dayLimits().sunset + (+sun[1] || 0)) : t.split(':').reduce((a, v, i) => a + (i ? +v : v * 60), 0);
      g.setClock(c.y, c.m, c.d, min);
      g.advance(0.5);
    }, t).catch(e => logs.push(String(e)));
    const n = t.replace(/[:+]/g, '');
    await p.evaluate(() => { const g = window.__game; g.cam.yaw = g.player.h; g.cam.pitch = 0.2; g.advance(0.6); });
    await shot(`start-${n}`);
    // the helicopter from 30 m, from the start's side
    await p.evaluate(() => {
      const g = window.__game, s = g.heli.st, pl = g.player;
      // from the start's side first, then round it: open ground with room to walk to it
      const a0 = Math.atan2(pl.x - s.x, pl.y - s.y);
      for (let i = 0; i < 12; i++) {
        const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 6, x = s.x + Math.sin(a) * 30, y = s.y + Math.cos(a) * 30;
        const f = g.nav.stand(x, y, s.z + 1, { rMax: 6, room: 100 });
        if (f && Math.abs(f.z - s.z) < 3) { pl.x = f.x; pl.y = f.y; pl.z = f.z; break; }
      }
      pl.h = Math.atan2(s.x - pl.x, s.y - pl.y); g.cam.yaw = pl.h; g.cam.pitch = 0.25;
      g.advance(1.5);
    });
    await shot(`heli-${n}`);
    await p.evaluate(() => { const g = window.__game; g.spawn(); g.advance(0.3); });
  }
  console.log(JSON.stringify(Object.assign(info, { errors: logs })));
  await b.close();
})();
