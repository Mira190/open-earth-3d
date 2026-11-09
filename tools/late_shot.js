// What the game shows before the models it fetches after the game opens have come (issue 335), and after: the
// late files (the cars' near models, the near trees, the NPCs' characters, the helicopter) are held back at the
// network, the game is played from the title, and the same view is taken with the stand-ins (the cars' far
// models, the mid trees) and again once the files are let through and in place. On foot at the start, the
// chase camera behind the surveyor.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/late_shot.js shibuya out_dir [WxH, 1440x900] [HH:MM, 10:00]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', outDir = '.', size = '1440x900', time = '10:00'] = process.argv;
const LATE = /\/assets\/(vehicles\/(cars|helicopter)\.glb|trees\/trees_near\.glb|people\/R_)/;
(async () => {
  const [w, h] = size.split('x').map(Number), phone = w < 600;
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  const p = await ctx.newPage();
  process.env.GAME_TIME = process.env.GAME_TIME || time;
  await pinClock(p, city);
  const errors = [], held = [];
  let hold = true;
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.route(LATE, r => (hold ? held.push(r) : r.continue()));
  fs.mkdirSync(outDir, { recursive: true });
  const shot = async name => { const f = path.join(outDir, `${city}-${w}x${h}-${name}.png`); await p.screenshot({ path: f }); console.log(f); };
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__game && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 250 });
  await p.waitForTimeout(1500);
  await shot('title-standins');
  await p.evaluate(() => { const s = document.querySelector('#gt-skip-on'); if (s) s.checked = true; document.querySelector('#gt-play').click(); });
  await p.waitForTimeout(1000);
  await p.evaluate(() => { const g = window.__game, o = g.overture(); if (o && o.active) o.skip(); if (g.arriving()) g.settleArrival(); });
  await p.waitForFunction(() => !window.__game.arriving(), null, { timeout: 120000, polling: 250 });
  await p.evaluate(() => { const g = window.__game; g.hold(true); });
  await p.waitForTimeout(1500);
  const before = await p.evaluate(() => window.__game.late());
  await shot('foot-standins');
  // and turned to the nearest car of the traffic in front of you (its far model standing in at that range)
  const face = () => p.evaluate(() => {
    const g = window.__game, pl = g.player;
    let best = null;
    for (const c of g.cars.live) { const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (c.line >= 0 && d > 8 && d < 100 && (!best || d < best.d)) best = { c, d }; }
    if (!best) return null;
    // (the world held: the camera stays where it is put, at eye height a few metres from the car, looking at it)
    const c = best.c, k = Math.min(1, 9 / best.d), ex = c.x + (pl.x - c.x) * k, ey = c.y + (pl.y - c.y) * k;
    g.camera.position.set(ex, pl.z + 1.7, -ey); g.camera.lookAt(c.x, c.z + 0.8, -c.y);
    return +best.d.toFixed(1);
  });
  const carD = await face();
  await p.waitForTimeout(1500);
  if (carD != null) await shot('car-standins');
  hold = false;
  for (const r of held.splice(0)) await r.continue();
  await p.evaluate(() => window.__game.lateReady());
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => window.__game.late());
  if (carD != null) { await face(); await p.waitForTimeout(1000); await shot('car-late'); }
  console.log(`the nearest car ${carD} m off`);
  console.log('held back:', before, '\nafter:', after, errors.length ? `\npage errors: ${errors.join(' | ')}` : '');
  await b.close();
})();
