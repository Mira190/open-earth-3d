// The ground a city's game walks on and draws, sampled on a grid over a rectangle, for a hero level to be laid
// on it (docs/HERO.md: a level's paving lies 4 cm over the ground the game already has, so it must be built on
// the game's own surface, with its quays raised and its terrain softened, not on the survey's).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/ground_probe.js sydney x0 y0 x1 y1 [step=1] > cities/sydney/hero_ground.json
// Prints {x0, y0, step, nx, ny, z: [row-major from (x0, y0), rows go north; null over water], water: 0|1 per cell}.
const { chromium } = require('playwright');
const [,, city, X0, Y0, X1, Y1, STEP = '1'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.waitForTimeout(1500);
  const out = await p.evaluate(({ x0, y0, x1, y1, step }) => {
    const g = window.__game, nx = Math.round((x1 - x0) / step) + 1, ny = Math.round((y1 - y0) / step) + 1, z = [], water = [];
    // the 5 m terrain round the player is laid where they stand: stand in the rectangle's middle first
    g.hold(true);
    g.player.x = (x0 + x1) / 2; g.player.y = (y0 + y1) / 2; g.player.z = g.nav.terrain(g.player.x, g.player.y);
    g.advance(0.2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, y = y0 + j * step, w = g.nav.isWater ? g.nav.isWater(x, y) : false;
      const f = g.nav.floorAt(x, y, g.nav.terrain(x, y) + 0.5);
      z.push(Math.round((f ? f.z : g.nav.terrain(x, y)) * 1000) / 1000); water.push(w ? 1 : 0);
    }
    return { x0, y0, step, nx, ny, z, water: water.join('') };
  }, { x0: +X0, y0: +Y0, x1: +X1, y1: +Y1, step: +STEP });
  console.log(JSON.stringify(out));
  await b.close();
})();
