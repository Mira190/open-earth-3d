// Walk onto each escalator (a game surface with moving_ms) from the floor before its entry, the way a player
// does: stand 2.5 m back from its comb facing along it, hold W (walking) for a moment, let go, and see whether
// the steps take you to the far end. Prints the track every second.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/escalator_walk.js shibuya
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { const g = window.__game; g.advance(1); if (g.cine && g.cine.active && g.cine.skip) g.cine.skip(); g.advance(3); });
  const out = await p.evaluate(async () => {
    const g = window.__game, pl = g.player, nav = g.nav, res = [];
    for (const s of nav.strips.filter(q => q.moving_ms)) {
      const mu = s.moving_u || [s.us[0], s.us[s.us.length - 1]], u0 = s.us[0] - 2.5;
      const x = s.origin[0] + s.axis[0] * u0, y = s.origin[1] + s.axis[1] * u0;
      nav.prefetch(x, y, 48, Infinity);
      const f = nav.floorAt(x, y, s.zs[0] + 0.5);
      [pl.x, pl.y, pl.z] = [x, y, f ? f.z : s.zs[0]]; pl.mode = 'foot'; pl.ground = true; pl.vz = 0; pl.walking = true;
      pl.h = Math.atan2(s.axis[0], s.axis[1]); g.cam.yaw = pl.h;
      const track = [];
      const at = t => { const [u] = nav.stripUV(s, pl.x, pl.y); track.push({ t, u: +u.toFixed(2), z: +pl.z.toFixed(2), floor: pl.floor }); };
      at(0);
      for (let t = 0.5; t <= 3; t += 0.5) { g.cam.yaw = Math.atan2(s.axis[0], s.axis[1]); g.advance(0.5, ['KeyW']); at(t); }
      for (let t = 4; t <= 50; t += 1) { g.advance(1); at(t); }
      res.push({ name: s.name, us: [s.us[0], s.us[s.us.length - 1]], mu, zs: [s.zs[0], s.zs[s.zs.length - 1]], track });
    }
    return res;
  });
  for (const r of out) {
    console.log(`${r.name}: strip u ${r.us}, moving ${r.mu}, z ${r.zs}`);
    for (const q of r.track) console.log(`  t ${q.t}  u ${q.u}  z ${q.z}  ${q.floor}`);
  }
  console.log(logs.join('\n'));
  await b.close();
})();
