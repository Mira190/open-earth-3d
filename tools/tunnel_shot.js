// Stills of a train ride to a station under the ground (web/game/trains.js "under": Sydney's City Circle from
// Circular Quay to Wynyard): standing aboard at the platform, the tunnel's veil, and coming up at the station's
// street entrance, each a screenshot of the page with the HUD.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/tunnel_shot.js sydney out_dir [WxH] [HH:MM]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900', time = '13:00'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number), phone = w < 600;
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?tier=desktop#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.life', null, { timeout: 300000 });
  await p.waitForSelector('#gt-play', { state: 'visible', timeout: 300000 });
  await p.click('#gt-play');
  await p.waitForFunction(() => { const g = window.__game; return !g.cine.active && !g.arriving() && g.player.mode === 'foot'; }, null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(16000); // (the day's card)
  const tag = `${size}-${time.replace(':', '')}`, shot = async name => { await p.waitForTimeout(900); await p.screenshot({ path: path.join(outDir, `${city}-tunnel-${name}-${tag}.png`) }); console.log(name); };
  // to the platform, a train for the station under the ground standing there, aboard
  const ok = await p.evaluate(time => {
    const g = window.__game, T = g.trains, Rd = T && T.ride;
    if (!Rd || !Rd.hidden) return 'no railway with a station under the ground';
    const [hh, mm] = time.split(':').map(Number); g.setClock(g.clock.y, g.clock.m, g.clock.d, hh * 60 + mm);
    const from = T.stations.find(s => !s.under), sv = T.services.find(s => { const i = s.halts.findIndex(q => q.st === from); return i >= 0 && s.halts[i + 1] && s.halts[i + 1].st.under; });
    if (!sv) return 'no service to a station under the ground';
    const h0 = sv.halts.find(q => q.st === from), L = T.plan(sv, true).legs.find(l => l.h === h0), k = Math.ceil((T.t - sv.offset_s - L.t2) / sv.every_s) + 1;
    T.t = sv.offset_s + k * sv.every_s + L.t2 + 2;
    g.advance(0.3);
    const car = Rd.cars.find(c => c.s === sv && Rd.stationOf(c.id) === from);
    if (!car) return 'no train standing';
    g.boardRail(car, from); g.advance(0.5);
    window.__tunnelCar = car;
    return '';
  }, time);
  if (ok) { console.log(ok); await b.close(); process.exit(1); }
  await shot('aboard');
  await p.keyboard.press('KeyF'); // (skip ahead, as a rider would)
  await p.waitForFunction(() => window.__game.trains.veiled, null, { timeout: 240000 }).catch(async () => console.log('never veiled', await p.evaluate(() => { const c = window.__tunnelCar, g = window.__game; return JSON.stringify({ mode: g.player.mode, x: c.tr && c.tr.x, leg: c.leg, ph: c.ph, hidden: g.trains.ride.hidden(c) }); })));
  await p.waitForTimeout(700);
  await shot('veil');
  await p.waitForFunction(() => window.__game.player.mode === 'foot', null, { timeout: 240000 }).catch(() => console.log('never arrived'));
  await p.waitForTimeout(1600);
  await shot('street');
  await b.close();
})();
