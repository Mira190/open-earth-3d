// The traffic getting out of your car's way (issue 335), alone and quickly: the game held in lockstep, your
// car put 26 m ahead of the nearest moving cars in their lanes, coming at each at 10 m/s, and what each does
// over the next second, a tenth of a second at a time: its dodge, how far it is out of its lane, its speed,
// its horn. tools/game_check.js runs the same step among the others.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/dodge_probe.js shibuya [cars to try, default 4]
const { chromium } = require('playwright');
const [,, city = 'shibuya', tries = '4'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); g.advance(20); });
  const out = await p.evaluate(n => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return ['no car'];
    const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3); g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    if (g.player.mode !== 'car') return ['not in the car'];
    const lines = [];
    const cands = g.cars.C.filter(o => o.line >= 0 && o.v > 5 && !o.mv && Math.abs(o.z - st.z) < 3).sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y));
    for (const o of cands.slice(0, n)) {
      const fx = Math.sin(o.h), fy = Math.cos(o.h);
      Object.assign(st, { x: o.x + fx * 26, y: o.y + fy * 26, z: o.z, h: o.h + Math.PI, vx: -fx * 10, vy: -fy * 10, v: 10, speed: 10, r: 0, steer: 0 });
      o.honkAt = null;
      const off0 = o.off, row = [];
      for (let i = 0; i < 12 && o.line >= 0; i++) {
        g.advance(0.1, ['KeyW']);
        row.push(`${(o.dodgeT > 0 ? 'D' : '.')}${o.v.toFixed(1)}/${(o.off - off0).toFixed(2)}`);
      }
      lines.push(`${o.model} ${o.line < 0 ? '(left the traffic)' : ''} horn ${o.honkAt != null} gap ${Math.hypot(st.x - o.x, st.y - o.y).toFixed(1)} m: ${row.join(' ')}`);
      for (let i = 0; i < 40 && st.speed > 0.3; i++) g.advance(0.1, ['Space']);
    }
    return lines;
  }, +tries);
  for (const l of out) console.log(l);
  await b.close();
})();
