// The railway's checks on their own (tools/trains_step.js, which tools/game_check.js also runs), and the climb up
// each flight of the station's stairs, without the rest of the game's smoke test: a few minutes instead of the hour.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/trains_check.js tokyo
const { chromium } = require('playwright');
const [,, city = 'tokyo'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e.stack || e).slice(0, 500)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const q = document.getElementById('gt-play'); if (q) q.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async () => {
    const g = window.__game;
    for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine.active) g.cine.skip();
    g.hold(true);
  });
  let fails = 0;
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
  const r = await require('./trains_step')(p);
  if (r.none) console.log(`(no railway in ${city})`); else for (const [ok, what] of r.checks) check(ok, what);
  // the stairs (game.json surfaces with "check"), as tools/game_check.js climbs them
  const climbs = await p.evaluate(() => {
    const g = window.__game, pl = g.player, out = [];
    for (const s of (g.G.surfaces || []).filter(q => q.check && q.type === 'strip')) {
      const [ox, oy] = s.origin, [ax, ay] = s.axis, P = s.profile, uf = P[P.length - 1][0], ut = P[0][0], zf = P[P.length - 1][1], zt = P[0][1];
      const x0 = ox + ax * (uf + 1.0), y0 = oy + ay * (uf + 1.0), tx = ox + ax * (ut + 0.6), ty = oy + ay * (ut + 0.6), f = g.nav.floorAt(x0, y0, zf + 0.5), r = { name: s.name, from: zf, to: zt };
      if (!f) { out.push(r); continue; }
      Object.assign(pl, { x: x0, y: y0, z: f.z, ground: true, vz: 0, speed: 0, mode: 'foot' });
      let low = f.z, high = f.z;
      for (let i = 0; i < 400 && Math.hypot(tx - pl.x, ty - pl.y) > 0.4; i++) { pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y); g.advance(0.05, ['KeyW']); low = Math.min(low, pl.z); high = Math.max(high, pl.z); }
      out.push(Object.assign(r, { z: pl.z, d: Math.hypot(tx - pl.x, ty - pl.y), low, high, start: f.z, at: [pl.x.toFixed(1), pl.y.toFixed(1)] }));
    }
    return out;
  });
  for (const c of climbs) check(c.z != null && c.d < 1.0 && Math.abs(c.z - c.to) < 0.35 && c.low > Math.min(c.start, c.from) - 0.3 && c.high < c.to + 0.35,
    `climbs ${c.name}: ${c.z == null ? 'no floor at its foot' : `from ${c.start.toFixed(2)} m to ${c.z.toFixed(2)} m (the top at ${c.to}), ${c.d.toFixed(2)} m from its head, at ${c.at}`}`);
  for (const l of logs) console.log(l);
  await b.close();
  process.exit(fails || logs.length ? 1 : 0);
})();
