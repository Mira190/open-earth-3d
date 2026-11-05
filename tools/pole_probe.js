// Your car driven straight at the poles standing at the junctions (the signal poles and the walk
// signals' posts, junctions.js) and the lamp posts: for each of the poles nearest the start, the
// car set 9 m off on the road side, aimed at it, and driven at it with the throttle held for 3 s;
// how far the car's body ever goes into the pole (its box against the pole's circle).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/pole_probe.js tokyo [poles=24]
// Exits 1 if the car goes 5 cm into any pole.
const { chromium } = require('playwright');
const [,, city = 'tokyo', nPoles = '24'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const r = await p.evaluate(n => {
    const g = window.__game, H = g.junctions.heads, out = { tried: 0, worst: [] };
    g.advance(1);
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    if (g.player.mode !== 'car') return { none: 'not at the wheel' };
    const car = g.myCar(), st = car.D.st, C = car.C || car.D.C || {};
    const half = C.half || 2.3, hw = C.hw || 0.9;
    const x0 = st.x, y0 = st.y;
    const poles = [].concat((H.list || []).map(o => ({ x: o.x, y: o.y, z: o.z, r: 0.09, kind: 'signal' })), (H.peds || []).map(o => ({ x: o.x, y: o.y, z: o.z, r: 0.07, kind: 'walk' })))
      .sort((a, b) => Math.hypot(a.x - x0, a.y - y0) - Math.hypot(b.x - x0, b.y - y0)).slice(0, n);
    for (const q of poles) {
      // from the road side: towards the nearest road line, 9 m off
      const nr = g.roadNet.nearest ? g.roadNet.nearest(q.x, q.y, 20) : null;
      let ux, uy;
      if (nr && nr.x != null) { const d = Math.hypot(nr.x - q.x, nr.y - q.y) || 1; ux = (nr.x - q.x) / d; uy = (nr.y - q.y) / d; } else { ux = 1; uy = 0; }
      const sx = q.x + ux * 9, sy = q.y + uy * 9, f = g.nav.floorAt(sx, sy, q.z + 2);
      if (!f || Math.abs(f.z - q.z) > 1.5) continue;
      g.keys.clear();
      st.x = sx; st.y = sy; st.z = f.z; st.h = Math.atan2(-ux, -uy); st.vx = st.vy = st.v = 0; st.speed = 0; st.steer = 0;
      g.advance(0.2);
      let deep = -Infinity;
      for (let i = 0; i < 90; i++) {
        g.advance(1 / 30, ['KeyW']);
        const fx = Math.sin(st.h), fy = Math.cos(st.h), dx = q.x - st.x, dy = q.y - st.y;
        const lx = Math.abs(dx * fx + dy * fy), ly = Math.abs(-dx * fy + dy * fx);
        const ox = Math.max(0, lx - half), oy = Math.max(0, ly - hw);
        const d = ox || oy ? Math.hypot(ox, oy) : -Math.min(half - lx, hw - ly);
        deep = Math.max(deep, q.r - d);
      }
      g.keys.clear();
      out.tried++;
      out.worst.push({ kind: q.kind, x: Math.round(q.x), y: Math.round(q.y), deep: +deep.toFixed(2) });
    }
    out.worst.sort((a, b) => b.deep - a.deep);
    return out;
  }, +nPoles);
  if (r.none) { console.log('FAIL', r.none); process.exit(1); }
  const bad = r.worst.filter(w => w.deep > 0.05);
  console.log(`${bad.length ? 'FAIL' : 'ok  '} your car driven at ${r.tried} poles: into ${bad.length} of them by over 5 cm; the deepest ${JSON.stringify(r.worst.slice(0, 5))}`);
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
