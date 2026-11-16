// Could a car drive a straight line the roads do not have? The ground, the walker's floor, whether the point is in
// a wall (nav.solid), the room a car's body has (nav.room) and the building over it, every few metres from A to B.
// For a gap in a road (a tunnel part the pipeline left out) before it is joined.
//   xvfb-run -a node tools/line_room.js shibuya 466.4,-1197.9 508.6,-1181.4 [step m = 3]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', A = '0,0', B = '10,0', step = '3'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return g.lateReady && g.lateReady(); });
  const out = await p.evaluate(([a, b, step]) => {
    const g = window.__game, nav = g.nav, len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step)), lines = [];
    for (let i = 0; i <= n; i++) {
      const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n, T = nav.terrain(x, y), f = nav.floorAt(x, y, T + 0.6, true);
      const id = nav.buildingId ? nav.buildingId(x, y) : null, top = nav.buildingTop ? nav.buildingTop(x, y) : null, hit = nav.landmarkHit ? nav.landmarkHit(x, y, T + 1) : null;
      lines.push(`${(len * i / n).toFixed(0).padStart(4)} m  ${x.toFixed(1)},${y.toFixed(1)}  terrain ${T.toFixed(2)}  floor ${f ? `${f.z.toFixed(2)} ${f.kind || ''}` : 'none'}  solid ${nav.solid(x, y, T, 0.5) ? 1 : 0}  room ${[0.6, 0.9, 1.1].map(r => nav.room(x, y, T, r, 1.6, false) ? 1 : 0).join('')}  building ${id == null ? '-' : id}${top != null ? ` top ${(+top).toFixed(1)}` : ''}${hit ? ` landmark ${typeof hit === 'object' ? JSON.stringify(hit).slice(0, 60) : hit}` : ''}`);
    }
    return lines;
  }, [A.split(',').map(Number), B.split(',').map(Number), +step]);
  console.log(out.join('\n'));
  await b.close();
})();
