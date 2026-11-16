// The ground round a point of a city's game, as numbers: the terrain's height (nav.terrain) and the floor a walker
// stands on (nav.floorAt, with its kind where it is not the ground) on a grid, to find a step, a pit or a patch's edge.
//   xvfb-run -a node tools/ground_grid.js tokyo 575,1194 [half-width m = 12] [step m = 2]
// Prints the grid north at the top, heights in centimetres over the lowest; a letter after a height names a floor
// that is not the terrain (its kind's first letter), and '!' a floor more than 0.25 m off the terrain.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'tokyo', at = '0,0', half = '12', step = '2'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return g.lateReady && g.lateReady(); });
  const [x0, y0] = at.split(',').map(Number);
  const r = await p.evaluate(([x0, y0, half, step]) => {
    const g = window.__game, nav = g.nav, rows = [], kinds = {};
    let lo = Infinity;
    for (let y = y0 + half; y >= y0 - half; y -= step) {
      const row = [];
      for (let x = x0 - half; x <= x0 + half; x += step) {
        const T = nav.terrain(x, y), f = nav.floorAt(x, y, T + 0.5);
        lo = Math.min(lo, T);
        if (f && f.kind) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
        row.push({ T, f: f ? f.z : null, kind: f ? f.kind || '' : '' });
      }
      rows.push({ y, row });
    }
    return { lo, rows, kinds };
  }, [x0, y0, +half, +step]);
  console.log(`${city} round ${x0},${y0}: heights in cm over ${r.lo.toFixed(2)} m; floors ${JSON.stringify(r.kinds)}`);
  let head = '        ';
  for (let x = x0 - +half; x <= x0 + +half; x += +step) head += String(Math.round(x)).padStart(7);
  console.log(head);
  for (const { y, row } of r.rows) console.log(String(Math.round(y)).padStart(7) + ' ' + row.map(c => { const t = Math.round((c.T - r.lo) * 100), f = c.f == null ? null : Math.round((c.f - r.lo) * 100); return (f == null ? `${t}-` : Math.abs(f - t) > 2 ? `${t}/${f}${(c.kind || '?')[0]}${Math.abs(f - t) > 25 ? '!' : ''}` : `${t}${c.kind && c.kind !== 'ground' ? c.kind[0] : ''}`).padStart(7); }).join(''));
  await b.close();
})();
