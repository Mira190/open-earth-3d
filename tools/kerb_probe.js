// How far a taxi has to come for you: the nearest kerb the game's roads offer (g.roads.place, as
// tools/game_check.js asks of the start) from each spot, in a city's game.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/kerb_probe.js queenstown -978.8,474.9 -984.9,469.7   # x,y[,z] in the local frame
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'sydney', ...spots] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); g.spawn(); g.advance(0.5); });
  for (const s of spots) {
    const [x, y, z] = s.split(',').map(Number);
    const r = await p.evaluate(([x, y, z]) => {
      const g = window.__game, f = g.nav.floorAt(x, y, (z ?? g.nav.terrain(x, y)) + 0.5), pl = g.player;
      pl.x = x; pl.y = y; pl.z = f ? f.z : g.nav.terrain(x, y);
      g.advance(0.2);
      const k = g.roads.place(pl.x, pl.y, 400, 1, pl.z);
      return k ? { d: +k.d.toFixed(1), at: [+k.x?.toFixed?.(1), +k.y?.toFixed?.(1)] } : null;
    }, [x, y, z]);
    console.log(s, JSON.stringify(r));
  }
  await b.close();
})();
