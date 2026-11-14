// What the game's collision holds round a point: each prism (buildings, landmarks, fine landmark cells) within
// `r` metres of (x, y), from knee height over the ground to 2 m, and whether a car's body has room there.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/wall_probe.js fushimi-inari -312 -229 [r]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city, X, Y, R = '2'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => window.__game.advance(4));
  const out = await p.evaluate(([x, y, r]) => {
    const nav = window.__game.nav, col = nav.col, g0 = nav.terrain(x, y), res = [];
    nav.prefetch(x, y, 48, Infinity);
    col.prisms.forEach(q => { if (q.zhi <= g0 + 0.3 || q.zlo >= g0 + 2) return; if (q.x1 < x - r || q.x0 > x + r || q.y1 < y - r || q.y0 > y + r) return;
      res.push(`tag ${q.tag} z ${(q.zlo - g0).toFixed(2)}..${(q.zhi - g0).toFixed(2)} x ${(q.x0 - x).toFixed(2)}..${(q.x1 - x).toFixed(2)} y ${(q.y0 - y).toFixed(2)}..${(q.y1 - y).toFixed(2)}`); });
    return [`ground ${g0.toFixed(2)}, room for 1.0 m: ${nav.room(x, y, g0, 1.0, 1.4)}`, ...res.sort()];
  }, [+X, +Y, +R]);
  console.log(out.join('\n'));
  await b.close();
})();
