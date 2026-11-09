// Stills of the cars parked at the kerb (#355, actors.js parkNow): the game is started, the traffic run for a
// while, and you are stood on the footway beside the nearest few parked cars, looking along the street at each.
//   GAME_TIME=10:00 xvfb-run -a node tools/kerb_shot.js sydney out_dir [n] [WxH]
const { chromium } = require('playwright');
const fs = require('fs');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', outDir = '.', n = '3', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  fs.mkdirSync(outDir, { recursive: true });
  const spots = await p.evaluate(n => {
    const g = window.__game;
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    g.advance(20);
    const P = g.cars.C.filter(c => c.line >= 0 && c.park).map(c => ({ x: c.x, y: c.y, z: c.z, h: c.h, d: Math.hypot(c.x - g.player.x, c.y - g.player.y), model: c.model, cls: g.roadNet.L[c.line].c }));
    P.sort((a, b) => a.d - b.d);
    const out = [];
    for (const q of P) { if (out.length < n && !out.some(o => Math.hypot(o.x - q.x, o.y - q.y) < 40)) out.push(q); }
    return { parked: P.length, out };
  }, +n);
  console.log(`${spots.parked} cars at the kerb; stills of ${spots.out.length}`);
  let k = 0;
  for (const q of spots.out) {
    await p.evaluate(q => {
      const g = window.__game, s = g.KEEP === 'left' ? 1 : -1;
      // on the footway side of it, 9 m back along the street, looking along the kerb past the car
      const bx = q.x - Math.sin(q.h) * 9 - Math.cos(q.h) * 2.2 * s, by = q.y - Math.cos(q.h) * 9 + Math.sin(q.h) * 2.2 * s;
      const st = g.nav.stand(bx, by, q.z, { rMax: 4 }) || { x: bx, y: by, z: q.z };
      Object.assign(g.player, { x: st.x, y: st.y, z: st.z, h: q.h, speed: 0 });
      g.cam.mode = 'chase'; g.cam.dist = 5.5; g.cam.pitch = 0.16; g.cam.yaw = q.h + 0.25 * s; g.cam.lastInput = g.t();
      g.advance(0.5);
    }, q);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${outDir}/${city}-kerb-${k++}.jpg`, type: 'jpeg', quality: 90 });
    console.log(`still ${k}: a ${q.model} on a ${q.cls} street, ${q.d.toFixed(0)} m from the start`);
  }
  await b.close();
})();
