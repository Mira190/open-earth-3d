// Page stills (the HUD included) of a city's area caption (web/game/places.js): the player walks into an
// area at noon, at sunset and at night, and the page is shot with the caption fully up.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/caption_shot.js shibuya out_dir [WxH] [area index, default 0]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = '.', size = '1440x900', which = '0'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  for (const [name, time] of [['day', '12:00'], ['dusk', 'sunset'], ['night', '22:00']]) {
    const ok = await p.evaluate(([time, k]) => {
      const g = window.__game, c = g.clock, a = (g.G.areas || [])[k];
      if (!a || !g.places) return false;
      if (g.cine.active) g.cine.skip();
      while (g.dlg.open) { if (g.dlg.hasChoices) g.dlg.choose(0); else g.dlg.next(); }
      g.setClock(c.y, c.m, c.d, time === 'sunset' && g.dayLimits ? Math.round(g.dayLimits().sunset) : time.split(':').reduce((h, m) => h * 60 + +m));
      g.places.forget();
      g.spawn([a.at[0] + a.radius * 3, a.at[1]]); g.advance(0.5); // out of it first
      g.spawn([a.at[0], a.at[1]]);
      Object.assign(g.cam, { mode: 'chase', yaw: g.player.h, pitch: 0.12, dist: 5, distTo: 0, yawTo: null, lastInput: -10 });
      for (let t = 0; t < 4 && !g.places.sign().shown; t += 0.1) g.advance(0.1);
      g.advance(0.4);
      return g.places.sign().shown;
    }, [time, +which]);
    if (!ok) { console.log(`${name}: no caption`); continue; }
    await p.waitForTimeout(900); // the fade in, on the page's clock
    await p.screenshot({ path: path.join(outDir, `${city}-caption-${name}-${w}x${h}.png`) });
    console.log(`${name}`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
