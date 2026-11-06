// Where does a car stand at a wall? Plays a city's game headless (web/ served on PORT or 8800, run under
// xvfb-run) and lets the traffic run for SECONDS (default 60), printing each car that stands still for 6 s or
// more with why === 'wall' (game_check.js's "no car waits at a wall"): its place, height, road line and class.
//   xvfb-run -a node tools/car_wall_probe.js amsterdam [seconds]
const { chromium } = require('playwright');
(async () => {
  const city = process.argv[2] || 'amsterdam', secs = +(process.argv[3] || 60);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && window.__game.cars && window.__game.roadNet, null, { timeout: 600000 });
  const out = await p.evaluate(secs => {
    const g = window.__game, C = g.cars.C, RL = g.roadNet.L, still = new Map(), seen = new Map();
    for (let t = 0; t < secs; t++) {
      g.advance(1);
      for (const c of C) {
        if (c.line < 0) continue;
        const s = c.why === 'wall' && c.v < 0.1 ? (still.get(c) || 0) + 1 : 0;
        still.set(c, s);
        if (s >= 6) { const l = RL[c.line] || {}; seen.set(c, { t, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(2), line: c.line, cls: l.cls || l.class, name: l.name, s }); }
      }
    }
    return [...seen.values()];
  }, secs);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
