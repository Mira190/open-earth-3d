// Stills of the fishing (docs/FISHING.md), at each of a city's spots: the wait with the float out,
// the fight with the rod bent, and the catch with its card, as a page screenshot (the panel is
// part of what is judged). At the times given (HH:MM, or sunset+20 as tools/game_shot.js), on a
// desktop or a phone.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/fishing_shot.js sydney out_dir [WxH] [times, comma separated] [spot id]
//   xvfb-run -a node tools/fishing_shot.js queenstown out 390x844 sunset-20,23:00
// FISH=<species id> hooks that one; MOVES=1 only prints the states (no stills).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const F = require('./fishing_step');
const [,, city = 'sydney', outDir = '.', size = '1440x900', times = '10:00', only = ''] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number), phone = w < 700;
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage(phone ? { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); localStorage.removeItem('oe3d-fishing'); } catch (e) { /* storage blocked */ } }, process.env.TIER || (phone ? 'low' : 'high'));
  const logs = [], t0 = Date.now(), at = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${at()} ${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`${at()} pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
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
    const O = window.OEOnboard, t = O && O.current && O.current(); if (t) t.skip();
    g.hold(true);                                   // the still's moment is set by advance(), not by the frames
  });
  const shot = async name => {
    if (process.env.MOVES) return;
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    await p.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 120000 });
    console.log(`${at()} ${name}`);
  };
  const spots = (await p.evaluate(() => window.__game.fishing().spots.map(s => s.id))).filter(id => !only || id === only);
  for (const time of times.split(',')) for (const id of spots) {
    const tag = `${city}-${id}-${time.replace(/[:+]/g, '')}-${phone ? 'phone' : 'desktop'}`;
    await p.evaluate(time => {
      const g = window.__game, c = g.clock, rel = /^(sunrise|sunset)([+-]\d+)?$/.exec(time);
      let min; if (rel) min = Math.round(g.dayLimits()[rel[1]] + (+rel[2] || 0)); else { const [hh, mm] = time.split(':').map(Number); min = hh * 60 + mm; }
      g.setClock(c.y, c.m, c.d, min); c.frozen = true;
      if (g.weather) g.weather.set('clear', { now: true });
    }, time);
    const at = await F.goTo(p, id);
    if (!(await F.loaded(p))) { console.log(`${id}: fishing did not load`); continue; }
    await p.evaluate(fish => { const a = window.__game.fishing().api; a.force(fish || a.easiest()); }, process.env.FISH || '');
    await shot(`${tag}-0-offer`);
    const b0 = await F.begin(p, 11);
    console.log(`${id} at ${at.x.toFixed(0)}, ${at.y.toFixed(0)}, ${at.z.toFixed(1)}: ${JSON.stringify(b0)}`);
    if (b0.st !== 'aim') continue;
    await p.evaluate(() => { for (let i = 0; i < 40; i++) window.__game.advance(0.05); });   // (the camera eases a step for each advance)
    await shot(`${tag}-1-aim`);
    const c = await F.cast(p, 0.8);
    console.log(`  cast: ${c.st}, ${c.line.toFixed(1)} m, wait ${c.wait.toFixed(1)} s, a ${c.cm} cm ${c.fish}`);
    await p.evaluate(() => window.__game.advance(1.5));
    await shot(`${tag}-2-wait`);
    const w = await F.bite(p);
    await shot(`${tag}-3-bite`);
    const s = await F.strike(p);
    // a few seconds into the fight, the rod bent
    const mid = await p.evaluate(() => { const g = window.__game, a = g.fishing().api; for (let t = 0; t < 3.5 && a.state().st === 'fight'; t += 0.1) { const q = a.state(); g.advance(0.1, q.phase === 'rest' && q.T < 0.97 ? ['Space'] : []); } return a.state(); });
    console.log(`  ${w.st} -> ${s.st}; mid-fight ${mid.phase}, tension ${(mid.T || 0).toFixed(2)}, ${(mid.d || 0).toFixed(1)} m`);
    await shot(`${tag}-4-fight`);
    const e = await F.play(p);
    await p.evaluate(() => { for (let i = 0; i < 60; i++) window.__game.advance(0.05); });   // the camera comes round to the fish's side (it eases a step for each advance)
    console.log(`  ended ${e.st}, tension up to ${e.top.toFixed(2)}, ${e.drawn} drawn`);
    await p.evaluate(() => window.__game.advance(2.5));   // (the camera has come round, the rod has swung to show the fish)
    console.log('  fish on screen', JSON.stringify(await F.fishInFrame(p)));
    await shot(`${tag}-5-catch`);
    await p.evaluate(() => { const g = window.__game, a = g.fishing().api; a.showLog(true); });
    await shot(`${tag}-6-log`);
    await p.evaluate(() => { const g = window.__game, a = g.fishing().api; a.showLog(false); let act = a.action(); if (act && act.act) act.act(); g.advance(0.2); a.stop(true); g.advance(0.2); });
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
