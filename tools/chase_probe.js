// The chase camera at the wheel when the frames come unevenly: drive your car down a street at a
// steady speed, step the game frame by frame (the game's own simulate and camera, __game.frame)
// with frame times that are even, that alternate 1/60 s and 1/30 s, and that wander at random
// between 1/90 s and 1/25 s (a browser's frames under load), and measure how far the car is ahead
// of the camera along its heading, frame by frame. At a steady speed that distance should hold:
// one that grows and shrinks with the frame time is the car lurching back and forth in the picture.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/chase_probe.js tokyo
// Exits 1 if the distance moves by over 3 cm from one frame to the next at a steady speed (measured
// over 20 frames at least: a straight long enough).
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'tokyo'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(() => {
    const g = window.__game;
    if (!g.frame) return { none: 'no __game.frame' };
    g.advance(1);
    g.bringCar && g.bringCar();
    g.advance(1);
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    if (g.player.mode !== 'car') return { none: 'not at the wheel' };
    const st = g.myCar().D.st, cam = g.camera, out = {};
    // the patterns of frame times
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pats = { even: () => 1 / 60, alternate: i => (i % 2 ? 1 / 30 : 1 / 60), wander: () => 1 / 90 + rnd() * (1 / 25 - 1 / 90) };
    for (const [name, dtOf] of Object.entries(pats)) {
      // up to speed on a straight: a resetCar to the road, then the throttle held, steering kept off
      if (g.resetCar) g.resetCar();
      for (let i = 0; i < 60; i++) g.frame(1 / 60);
      g.keys.add('KeyW');
      for (let i = 0; i < 300 && st.speed < 12; i++) g.frame(1 / 60); // (up to speed with even frames)
      const ds = [], vs = [];
      for (let i = 0; i < 120; i++) {
        const dt = dtOf(i);
        if (st.speed > 13) g.keys.delete('KeyW'); else g.keys.add('KeyW'); // (about 13 m/s, near enough steady)
        g.frame(dt);
        if (st.speed < 9) break; // (at the end of the straight: what was measured so far)
        const fx = Math.sin(st.h), fy = Math.cos(st.h), cx = cam.position.x, cy = -cam.position.z;
        ds.push((st.x - cx) * fx + (st.y - cy) * fy); vs.push(st.v);
      }
      g.keys.delete('KeyW');
      let jump = 0, lo = Infinity, hi = -Infinity;
      for (let i = 10; i < ds.length; i++) { jump = Math.max(jump, Math.abs(ds[i] - ds[i - 1]) - Math.abs(vs[i] - vs[i - 1]) * 0.2); lo = Math.min(lo, ds[i]); hi = Math.max(hi, ds[i]); }
      out[name] = { jump: +jump.toFixed(3), range: +(hi - lo).toFixed(3), ahead: +((hi + lo) / 2).toFixed(2), v: vs.length ? +vs[vs.length - 1].toFixed(1) : 0, n: ds.length };
    }
    return out;
  });
  console.log(JSON.stringify(r));
  let bad = !!r.none;
  if (!r.none) for (const [k, v] of Object.entries(r)) { const ok = v.n >= 20 && v.jump < 0.03; if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} frames ${k}: the car ahead of the camera by ${v.ahead} m moves ${v.jump} m from a frame to the next at most (${v.range} m over ${v.n} frames, at ${v.v} m/s)`); }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
