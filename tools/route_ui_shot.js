// Stills of the route line's setting in a city's game (web/game/game.js): the pause menu with its
// Route line choice (On / Only when I ask / Off), and the page with the line off, its Show route
// button in the quest card and the route kept on the minimap, then with the line asked for (L).
// Whole-page screenshots, the HUD over the scene, at the desktop picture tier.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/route_ui_shot.js sydney out_dir [WxH]   # llvmpipe; without xvfb-run, SwiftShader
// Writes out_dir/<city>-routeui-{menu,off,asked}-<W>.png and prints the page's errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.ways.ready', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const shot = name => p.screenshot({ path: path.join(outDir, `${city}-routeui-${name}-${w}.png`) });
  const to = await p.evaluate(() => {
    const g = window.__game, me = { x: g.player.x, y: g.player.y, z: g.player.z };
    if (g.cine.active) g.cine.skip();
    const n = g.npcs.slice().sort((a, b) => Math.hypot(b.x - me.x, b.y - me.y) - Math.hypot(a.x - me.x, a.y - me.y)).find(q => g.ways.walk(me, q));
    if (n) g.waypoint([n.x, n.y]);
    const q = () => g.guide().pts;
    g.advance(0.6);
    if (q()) { // face along the route
      let i = 1, d = 0; const P = q();
      while (i < P.length - 1 && d < 25) { d += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); i++; }
      const yaw = Math.atan2(P[i][0] - g.player.x, P[i][1] - g.player.y);
      Object.assign(g.cam, { mode: 'chase', yaw, pitch: 0.28, dist: 7, distTo: 0, yawTo: null, lastInput: 1e9 }); g.player.h = yaw;
    }
    g.route.set('off'); g.advance(0.6);
    return n ? n.name : null;
  });
  console.log(`route to ${to}`);
  // the HUD back in after the opening shot
  await p.waitForFunction(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return !document.querySelector('.game-stage.cine, .game-stage.titled'); }, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  const cover = await p.evaluate(() => { const r = document.getElementById('gq-route').getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e && !e.closest('#gq-route') ? `${e.closest('[id]').id} (${e.tagName.toLowerCase()}.${e.className})` : ''; });
  if (cover) console.log(`the Show route button is covered by #${cover}`);
  await shot('off');
  await p.click('#gq-route', cover ? { force: true } : undefined);
  await p.waitForTimeout(1500);
  await shot('asked');
  await p.evaluate(() => { document.getElementById('g-menu').hidden = false; });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('gm-route').scrollIntoView({ block: 'center' }));
  await shot('menu');
  await p.evaluate(() => { window.__game.route.set('on'); });
  console.log(logs.length ? logs.join('\n') : 'no page errors');
  await b.close();
})();
