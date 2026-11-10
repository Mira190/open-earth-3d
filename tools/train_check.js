// The railway on its own (rail.js "train"): the timetable's meets, a ride between two stations and a level
// crossing closing for a train, as tools/game_check.js checks them (tools/train_step.js), without the rest of it.
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=10:00 xvfb-run -a node tools/train_check.js kamakura
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const { trainStep, trainChecks } = require('./train_step');
const [,, city = 'kamakura'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await pinClock(p, city);
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const fails = [];
  p.on('pageerror', e => { console.log('pageerror', String(e).slice(0, 300)); fails.push('page error'); });
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
  });
  // (the modelled trains, which come after the game opens)
  await p.waitForFunction(() => window.__game.rail && window.__game.rail.train && window.__game.rail.train.modelled, null, { timeout: 60000 }).catch(() => {});
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const train = await p.evaluate(trainStep);
  if (train.none) console.log('no railway in this city'); else trainChecks(train, check);
  if (fails.length) console.log(JSON.stringify(train));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
