// What the game stands a walker and a car on across a rectangle: prints a map of nav.floorAt round (x, y), a character a
// cell (g ground, l landmark, r roof, d deck, p pier, s a strip, . nothing) with its height over the terrain grid in
// centimetres where it is off it by more than 2, rows going north (a walker at the terrain's height steps up to 0.75 m).
//   xvfb-run -a node tools/floor_scan.js sydney x y [half=8] [step=0.5] [walk]
// With walk: where a walker can stand instead (nav.walk at the floor a walker on the terrain takes): '.' yes, '#' a wall,
// '~' water or kept off, 'v' a drop, ' ' nothing to stand on.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', X, Y, HALF = '8', STEP = '0.5', MODE = ''] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  const out = await p.evaluate(([x, y, half, step, mode]) => {
    const g = window.__game, nav = g.nav;
    if (g.cine.active) g.cine.skip();
    nav.prefetch(x, y, half + 30, Infinity);
    const rows = [];
    for (let j = Math.round(half / step); j >= -Math.round(half / step); j--) {
      const cells = [];
      for (let i = -Math.round(half / step); i <= Math.round(half / step); i++) {
        const px = x + i * step, py = y + j * step, t = nav.terrain(px, py), f = nav.floorAt(px, py, t + 0.1);
        if (mode === 'walk') { const w = f && nav.walk(px, py, f.z + 0.3, true); cells.push(!f ? ' ' : w.ok ? '.' : w.why === 'wall' ? '#' : w.why === 'drop' ? 'v' : '~'); continue; }
        if (!f) { cells.push('    .'); continue; }
        const d = Math.round((f.z - t) * 100), c = f.kind === 'ground' ? 'g' : f.kind === 'landmark' ? 'l' : f.kind === 'roof' ? 'r' : f.kind === 'deck' ? 'd' : f.kind === 'pier' ? 'p' : 's';
        cells.push(`${c}${Math.abs(d) > 2 ? String(d) : ''}`.padStart(5));
      }
      rows.push(`${(y + j * step).toFixed(1).padStart(8)} ${cells.join(mode === 'walk' ? '' : '')}`);
    }
    return `x from ${x - half} to ${x + half} every ${step} m; the terrain at the centre ${nav.terrain(x, y).toFixed(2)} m\n${rows.join('\n')}`;
  }, [+X, +Y, +HALF, +STEP, MODE]);
  console.log(out);
  await b.close();
})();
