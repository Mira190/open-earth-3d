// Stills of the fares (web/game/fares.js) as a player sees them: the reader's card at a tap on, at a
// tap off and at the day's cap, and the phone's page, each a screenshot of the page with the HUD.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/fare_shot.js sydney out_dir [WxH] [HH:MM]
// The wallet and the card are the page's own for the run (a fresh browser profile); nothing is kept.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900', time = ''] = process.argv;
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
  await p.waitForFunction('window.__game && window.__game.life && window.__game.life.data.bonds.length', null, { timeout: 300000 });
  await p.waitForSelector('#gt-play', { state: 'visible', timeout: 120000 });
  await p.click('#gt-play');
  await p.waitForTimeout(9000);
  const shot = async name => { await p.waitForTimeout(1200); await p.screenshot({ path: path.join(outDir, `${city}-fare-${name}-${size}.png`) }); console.log(`${name}: ${await p.evaluate(() => { const e = window.__game.life.fares.shown; return e ? e.textContent.replace(/\s+/g, ' ') : ''; })}`); };
  const trip = await p.evaluate(time => {
    const g = window.__game, L = g.life, f = L.data.fares;
    if (time) { const [hh, mm] = time.split(':').map(Number); g.setClock(g.clock.y, g.clock.m, g.clock.d, hh * 60 + mm); }
    L.city().fares = L.fares.fresh();
    if (f.rides.ferry && g.G.wharves && g.G.ferries.length) { const r = g.G.ferries[0], W = id => g.G.wharves.find(q => q.id === id), a = W(r.stops[0]), c = W(r.stops[1]); return { kind: 'ferry', route: r.route, from: a.id, fromName: a.name, to: c.id, name: c.name, m: Math.hypot(a.berth[0] - c.berth[0], a.berth[1] - c.berth[1]) }; }
    if (!f.rides.rail) return null;
    const [a, c] = Object.keys(f.rides.rail.pairs)[0].split('>'), S = id => (g.rail.stations.find(q => q.id === id) || { name: id }).name;
    return { kind: 'rail', route: '', from: a, fromName: S(a), to: c, name: S(c), m: 1000 };
  }, time);
  // the tap itself, seen from behind and beside: the phone held out to the reader (a ticket gate's tap where there is no ride)
  const tapNow = () => p.evaluate(t => {
    const L = window.__game.life, f = L.data.fares;
    if (t) return L.fares.on({ kind: t.kind, from: t.from, name: t.fromName, route: t.route });
    const [id, r] = Object.entries(f.rides.lift.routes)[0]; L.fares.admit({ kind: 'lift', route: id, from: r.from, to: 'top', name: r.name });
  }, trip);
  await p.waitForFunction(() => { const g = window.__game; return !g.cine.active && !g.arriving() && g.player.mode === 'foot'; }, null, { timeout: 120000 }).catch(() => console.log('the opening did not end'));
  await p.evaluate(() => { const b = document.querySelector('.ob-skip'); if (b && b.offsetParent) b.click(); });
  await p.waitForTimeout(2000);
  const sideOn = () => p.evaluate(() => { const g = window.__game; g.cam.mode = 'chase'; g.cam.dist = 2.4; g.cam.pitch = 0.1; g.cam.yaw = g.player.h + 1.1; g.cam.lastInput = g.t(); });
  await sideOn(); await p.waitForTimeout(800);
  await tapNow(); await p.waitForFunction(() => { const g = window.__game.life.fares.gesture; return g.on && g.t > 0.35; }, null, { timeout: 10000 }).catch(() => {});
  await sideOn();
  console.log('tap:', await p.evaluate(() => { const g = window.__game, f = new THREE.Vector3(); g.player.rig.fist(f); const ph = g.world.getObjectByName('tap_phone'); return `hand ${(f.y - g.player.z).toFixed(2)} m up, phone ${ph && ph.visible ? 'shown' : 'hidden'}, t ${g.life.fares.gesture.t.toFixed(2)}`; }));
  // the canvas alone, drawn in the frame it was rendered (the hand, without the HUD over it)
  const png = await p.evaluate(async () => { await new Promise(r => requestAnimationFrame(r)); const c = document.getElementById('game-gl'), s = document.createElement('canvas'); s.width = c.width; s.height = c.height; s.getContext('2d').drawImage(c, 0, 0); return s.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(path.join(outDir, `${city}-fare-tap-${size}.png`), Buffer.from(png, 'base64'));
  await p.evaluate(() => { const g = window.__game; g.cam.dist = 5.5; g.cam.pitch = 0.3; g.cam.yaw = g.player.h; });
  // tickets at a gate (SHIBUYA SKY): the survey's first visit, then one paid at the hour's price
  if (await p.evaluate(() => !!window.__game.life.data.fares.rides.lift)) {
    const admit = () => p.evaluate(() => { const L = window.__game.life, [id, r] = Object.entries(L.data.fares.rides.lift.routes)[0]; return L.fares.admit({ kind: 'lift', route: id, from: r.from, to: 'top', name: r.name }); });
    await p.evaluate(() => { const L = window.__game.life; for (const k of Object.keys(L.city().seen)) if (k.startsWith('ticket:')) delete L.city().seen[k]; });
    await admit(); await shot('ticket-free');
    await admit(); await shot('ticket');
  }
  if (!trip) { await p.evaluate(() => window.__game.phoneShow('fares')); await p.waitForTimeout(800); await p.screenshot({ path: path.join(outDir, `${city}-fare-phone-${size}.png`) }); await b.close(); return; }
  const on = () => p.evaluate(t => window.__game.life.fares.on({ kind: t.kind, from: t.from, name: t.fromName, route: t.route }), trip);
  const off = () => p.evaluate(t => { const r = window.__game.life.fares.off(t); return r && { due: r.due, capped: r.capped }; }, trip);
  await on(); await shot('on');
  let r = await off(); await shot('off');
  for (let i = 0; i < 10 && r && !(r.capped && r.due === 0); i++) { await on(); r = await off(); }
  if (r && r.capped) await shot('capped');
  await p.evaluate(() => { const g = window.__game; g.phoneShow('fares'); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(outDir, `${city}-fare-phone-${size}.png`) });
  await p.evaluate(() => window.__game.phoneShow('home'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(outDir, `${city}-fare-home-${size}.png`) });
  await b.close();
})();
