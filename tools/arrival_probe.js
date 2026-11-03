// Where map travel puts you at a city's landmarks, without rendering: each landmark's label point, top and
// ground, the arrival standFor picks (distance, bearing from the landmark, the city.json "arrivals" entry if
// any), its best-scored candidates, and a character map of the 2 m surface model round it ('#' over 30 m
// above the ground, '+' over 10 m, '.' over 3 m, '~' water, '=' a main road's centre line, 'L' the label, '@' the arrival). For choosing
// a landmark's "front" or a hand-picked "at" spot in city.json.
//   python3 -m http.server 8800 --directory web &
//   node tools/arrival_probe.js osaka [names, comma-separated substrings] [radius m]
// env: ARRIVALS='{"HEP FIVE": {"front": 154}}' tries "arrivals" entries before they go in city.json; SIZE=390x844
// scores the views in a phone's frame (640x400 by default).
const { chromium } = require('playwright');
const [,, city = 'osaka', names = '', radius = '160'] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const [vw, vh] = (process.env.SIZE || '640x400').split('x').map(Number);
  const p = await b.newPage({ viewport: { width: vw, height: vh } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  const out = await p.evaluate(([names, R, extra]) => {
    const g = window.__game;
    if (extra) g.scene.city.arrivals = Object.assign(g.scene.city.arrivals || {}, JSON.parse(extra));
    const D = g.DSM, only = names.split(',').filter(Boolean), lines = [];
    const dsm = (x, y) => { const c = Math.floor((x - D.x0) / D.cell), r = Math.floor((D.y1 - y) / D.cell); return c >= 0 && r >= 0 && c < D.nx && r < D.ny ? D.data[r * D.nx + c] : 0; };
    const cfg = (g.scene.city && g.scene.city.arrivals) || {};
    for (const lm of g.landmarks.filter(l => !only.length || only.some(o => l.name.includes(o)))) {
      const dbg = [], f = g.standFor(lm, dbg), [x, y] = lm.at, gz = Math.max(0, g.nav.terrain(x, y));
      const brg = f ? ((Math.atan2(f.x - x, f.y - y) * 180 / Math.PI) + 360) % 360 : NaN;
      lines.push(`\n${lm.name}: label [${x.toFixed(0)}, ${y.toFixed(0)}], ground ${gz.toFixed(1)}, top ${lm.top}${cfg[lm.name] ? `, arrivals ${JSON.stringify(cfg[lm.name])}` : ''}`);
      const bd = g.bodyOf(lm, gz, cfg[lm.name] && cfg[lm.name].top ? gz + cfg[lm.name].top : lm.top ?? gz + 20);
      lines.push(`  body: ${bd.pts.length} points up to ${Math.max(...bd.pts.map(q => q[2])).toFixed(0)} m on ${[...bd.ids].map(i => JSON.stringify((g.B.b[i] || [])[0] || `#${i}`)).join(', ') || 'a column at the label'}`);
      lines.push(f ? `  arrival [${f.x.toFixed(0)}, ${f.y.toFixed(0)}, ${f.z.toFixed(1)}], ${Math.hypot(f.x - x, f.y - y).toFixed(0)} m away on a bearing of ${brg.toFixed(0)}°` : '  no arrival');
      for (const c of dbg.sort((a, b) => b.score - a.score).slice(0, 5)) lines.push(`  cand ${JSON.stringify(c)}`);
      const step = Math.max(4, R / 40), roads = new Set();
      for (const r of g.G.paths.road) if (/^(motorway|trunk|primary|secondary|tertiary)/.test(r.c)) for (let k = 0; k + 5 < r.p.length; k += 3) {
        const ax = r.p[k] / 10, ay = r.p[k + 1] / 10, bx = r.p[k + 3] / 10, by = r.p[k + 4] / 10, n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2);
        for (let i = 0; i <= n; i++) { const qx = ax + (bx - ax) * i / n, qy = ay + (by - ay) * i / n; if (Math.abs(qx - x) < R + step && Math.abs(qy - y) < R + step) roads.add(`${Math.round((qx - x + R) / step)},${Math.round((y + R - qy) / (step * 2))}`); }
      }
      for (let yy = y + R, j = 0; yy >= y - R; yy -= step * 2, j++) {
        let row = '  ';
        for (let xx = x - R, i = 0; xx <= x + R; xx += step, i++) {
          const near = (px, py) => Math.abs(px - xx) < step / 2 && Math.abs(py - yy) < step;
          if (near(x, y)) { row += 'L'; continue; }
          if (f && near(f.x, f.y)) { row += '@'; continue; }
          const h = dsm(xx, yy) - Math.max(0, g.nav.terrain(xx, yy)), wet = g.nav.isWater(xx, yy);
          if (roads.has(`${i},${j}`)) { row += '='; continue; }
          row += h > 30 ? '#' : h > 10 ? '+' : h > 3 ? '.' : wet ? '~' : ' ';
        }
        lines.push(row);
      }
    }
    return lines.join('\n');
  }, [names, +radius, process.env.ARRIVALS || '']);
  console.log(out);
  await b.close();
})();
