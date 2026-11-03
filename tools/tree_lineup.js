// Stills of the shared trees as the game draws them (web/trees.js, blender/build_trees.py): for each
// species a city plants, finds one of its trees with open ground round it and stands the surveyor
// 11 m off, looking at it, through tools/game_shot.js, so a species is seen in the city's own light
// and next to its neighbours. Writes out_dir/<species>.png and out_dir/lineup.json (the views).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/tree_lineup.js kyoto out_dir [species,...] [HH:MM] [month,day]
// NEAR=x,y,r looks only for trees within r metres of x, y (a park's lawn rather than a street).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [,, city = 'kyoto', outDir = '.', only = '', time = '14:00', date = ''] = process.argv;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.Wd && window.__game.Wd.trees', null, { timeout: 600000 });
  const near0 = (process.env.NEAR || '').split(',').map(Number);
  const found = await p.evaluate(([only, N]) => {
    const T = window.__game.Wd.trees, want = only ? only.split(',') : T.species, out = [];
    const pts = Array.from({ length: T.n }, (_, i) => T.at(i));
    // a grid of 10 m cells, to count a tree's neighbours
    const cell = new Map(), key = (x, y) => `${Math.floor(x / 10)},${Math.floor(y / 10)}`;
    pts.forEach((q, i) => { if (!q) return; const [x, y] = q; const k = key(x, y); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); });
    const near = (x, y) => {
      let c = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of cell.get(key(x + a * 10, y + b * 10)) || []) {
        if (!pts[j]) continue; const dx = pts[j][0] - x, dy = pts[j][1] - y; if (dx * dx + dy * dy < 144) c++;
      }
      return c;
    };
    for (const sp of want) {
      const k = T.species.indexOf(sp);
      if (k < 0) continue;
      let best = null, bestN = 1e9;
      for (let i = 0; i < T.n; i++) if (pts[i] && T.kind(i) === k && (N.length < 3 || Math.hypot(pts[i][0] - N[0], pts[i][1] - N[1]) < N[2])) { const c = near(...pts[i]); if (c < bestN) { bestN = c; best = pts[i]; } if (c <= 1) break; }
      if (best) out.push([sp, best]);
    }
    return out;
  }, [only, near0.length === 3 && near0.every(Number.isFinite) ? near0 : []]);
  await b.close();
  const views = found.map(([sp, [x, y]]) => Object.assign({ name: sp, at: [x - 15, y - 6], look: [x, y + 2], time, dist: 4, pitch: -0.02, street: true },
    date ? { date: date.split(',').map(Number) } : {}));
  const file = path.join(outDir, 'lineup.json');
  fs.writeFileSync(file, JSON.stringify(views, null, 1));
  execFileSync('node', [path.join(__dirname, 'game_shot.js'), city, file, outDir], { stdio: 'inherit' });
})();
