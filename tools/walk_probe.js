// Whether a walker can stand at some points of a city's game, and what stops one that cannot: for checking that
// what a hero level draws as a wall is a wall in the city under it (game.hero[].solid, .open; docs/HERO.md).
//   xvfb-run -a node tools/walk_probe.js sydney "-201.3,259.4;-177,198"
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'sydney', pts = '0,0'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p);
  await p.waitForTimeout(+(process.env.SETTLE || 5) * 1000);
  const out = await p.evaluate(pts => {
    const g = window.__game;
    if (g.nav.layAll) g.nav.layAll();
    return pts.map(([x, y]) => {
      const t = g.nav.terrain(x, y), f = g.nav.floorAt(x, y, t + 0.5), w = f ? g.nav.walk(x, y, f.z) : null;
      return { x, y, terrain: +t.toFixed(2), floor: f ? +f.z.toFixed(2) : null, kind: f ? f.kind || '' : '', ok: !!(w && w.ok), why: w && w.why || '' };
    });
  }, pts.split(';').map(s => s.split(',').map(Number)));
  for (const r of out) console.log(`${r.x},${r.y}\tterrain ${r.terrain}\tfloor ${r.floor} ${r.kind}\t${r.ok ? 'walkable' : 'stopped' + (r.why ? ' (' + r.why + ')' : '')}`);
  await b.close();
})();
