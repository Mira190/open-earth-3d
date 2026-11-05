// Whether the traffic near you moves smoothly: run a city's game headless with you on foot, step it
// a frame at a time (1/30 s or 1/60 s), and for the cars within 80 m of you count what reads as
// judder: a car that moves backwards along its own heading in a frame, and one whose speed swings
// up and down (its acceleration changing sign with over 1.5 m/s² either way within half a second)
// while it is moving. Also the cars' mean speed while moving, and the share of time they stand.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=17:30 xvfb-run -a node tools/traffic_smooth.js tokyo [seconds] [fps]
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'tokyo', secs = '40', fps = '30'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(2); });
  const out = await p.evaluate(({ secs, fps }) => {
    const g = window.__game, C = g.cars.C, me = g.player, dt = 1 / fps, hist = new Map();
    let back = 0, swings = 0, moving = 0, standing = 0, vSum = 0, n = 0;
    const why = [];
    for (let t = 0; t < secs; t += dt) {
      g.advance(dt);
      for (let i = 0; i < g.cars.active; i++) {
        const c = C[i];
        if (c.line < 0 || Math.hypot(c.x - me.x, c.y - me.y) > 80) { hist.delete(c); continue; }
        const h = hist.get(c);
        n++;
        if (c.v > 0.3) { moving++; vSum += c.v; } else standing++;
        if (h) {
          const fx = Math.sin(h.h), fy = Math.cos(h.h), d = (c.x - h.x) * fx + (c.y - h.y) * fy;
          if (d < -0.02 && Math.hypot(c.x - h.x, c.y - h.y) < 5 && !c.rev) { back++; if (why.length < 6) why.push(`t ${t.toFixed(2)} back ${(-d).toFixed(2)} m, v ${c.v.toFixed(2)} why ${c.why}`); }
          const a = (c.v - h.v) / dt;
          h.acc.push([t, a]); while (h.acc.length && t - h.acc[0][0] > 0.5) h.acc.shift();
          if (c.v > 1 && h.acc.some(e => e[1] > 1.5) && h.acc.some(e => e[1] < -1.5) && t - (h.sw || -9) > 0.5) { swings++; h.sw = t; }
          h.x = c.x; h.y = c.y; h.h = c.h; h.v = c.v;
        } else hist.set(c, { x: c.x, y: c.y, h: c.h, v: c.v, acc: [] });
      }
    }
    return { back, swings, mean: vSum / Math.max(1, moving), stand: standing / Math.max(1, n), carSeconds: n * dt, why };
  }, { secs: +secs, fps: +fps });
  console.log(`${city} at ${fps} fps: ${out.carSeconds.toFixed(0)} car-seconds within 80 m; moving at ${out.mean.toFixed(1)} m/s (${(out.mean * 3.6).toFixed(0)} km/h) on average, standing ${(out.stand * 100).toFixed(0)}% of the time`);
  console.log(`  ${out.back} frames a car moved backwards, ${out.swings} speed swings (per minute of car time: ${(out.swings / (out.carSeconds / 60)).toFixed(2)})`);
  for (const l of out.why) console.log('  ' + l);
  await b.close();
})();
