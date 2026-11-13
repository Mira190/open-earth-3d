// Stills of the daily-life screens (web/game/life.js, day.js and the modules on them) in a city's game:
// the day card, a slot card, the diary's pages, and whatever a later module adds to SHOTS below.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/life_shot.js shibuya out_dir [WxH] [HH:MM] [M-D]     # 1440x900, or 390x844 for a phone
// Prints the page's errors and exits 1 on one.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = 'life-shots', size = '1440x900', time = '17:10', date = ''] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number), phone = w < 600;
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const cx = await b.newContext(phone ? Object.assign({}, devices['iPhone 13'], { viewport: { width: w, height: h } }) : { viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await cx.newPage();
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || (phone ? 'low' : 'high'));
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.life', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  const tag = phone ? 'phone' : 'desktop';
  // (a software renderer takes seconds over a screenshot: the banners hold until each still is taken)
  await p.evaluate(() => { const ui = window.__game.life.ui, b = ui.banner; ui.banner = o => b(Object.assign({}, o, { hold: 25000 })); });
  const shot = async name => { await p.waitForTimeout(1500); await p.screenshot({ path: path.join(outDir, `${city}-${name}-${tag}.png`), timeout: 240000 }); console.log(`${city}-${name}-${tag}`); };
  await p.evaluate(([time, date]) => {
    const g = window.__game, c = g.clock, [hh, mm] = time.split(':').map(Number), [m, d] = date ? date.split('-').map(Number) : [c.m, c.d];
    g.setClock(c.y, m, d, hh * 60 + mm);
    if (g.weather) g.weather.set('clear', { now: true });
    document.getElementById('gt-play').click();
    window.__setClock = () => { g.setClock(c.y, m, d, hh * 60 + mm); c.frozen = true; };
  }, [time, date]);
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const g = window.__game; if (g.overture() && g.overture().active) g.overture().skip(); g.settleArrival(); if (g.cine.active) g.cine.skip(); });
  await p.evaluate(() => window.__setClock());
  await p.waitForTimeout(2500);
  // (the pages as a player well in sees them: the forecast a friend gave, and the keepsakes bought on this map in the album)
  await p.evaluate(() => {
    const L = window.__game.life, fb = L.data.bonds.find(x => x.ranks.some(r => r.gives && r.gives.id === 'forecast'));
    if (fb) L.bonds.st(fb.npc).rank = Math.max(L.bonds.st(fb.npc).rank, fb.ranks.findIndex(r => r.gives && r.gives.id === 'forecast') + 1);
    const al = L.jobs.album();
    for (const s of L.data.shops) for (const m of s.menu) if (m.keep && !al.some(a => a.id === m.id)) { L.city().shelf.push(m.id); al.push({ city: L.ctx.cityId, place: L.ctx.cityName, id: m.id, name: m.name, text: m.text, glyph: m.glyph || '', shop: s.name, d: L.day.date }); }
  });
  await p.evaluate(() => window.__game.life.day.card());
  await shot('day-card');
  await p.evaluate(() => { document.querySelectorAll('.lf-card').forEach(e => e.remove()); const d = window.__game.life.day; d.close(); d.show(); });
  await shot('diary-today');
  if (await p.evaluate(() => { const f = document.querySelector('.lf-diary .lf-fc'); if (f) f.previousElementSibling.scrollIntoView({ block: 'start' }); return !!f; })) await shot('diary-forecast');
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.lf-tabs button')].map(b => b.dataset.tab));
  for (const t of tabs.slice(1)) { await p.evaluate(t => document.querySelector(`.lf-tabs button[data-tab="${t}"]`).click(), t); await shot(`diary-${t}`); }
  await p.evaluate(() => window.__game.life.day.close());
  // the people, the work and the phone, as they come up in play
  const act = async (name, fn, arg) => { await p.evaluate(fn, arg); await shot(name); };
  const quiet = () => p.evaluate(() => { const g = window.__game; g.life.close(); for (let i = 0; i < 30 && g.dlg.open; i++) { if (g.dlg.hasChoices) g.dlg.choose(1); else g.dlg.next(false); } g.phoneShow(false); document.getElementById('g-pass').hidden = true; });
  const has = await p.evaluate(() => ({ bonds: window.__game.life.data.bonds.length, jobs: window.__game.life.data.jobs.length }));
  if (has.bonds) {
    await p.evaluate(() => { const g = window.__game, L = g.life, b = L.data.bonds[0], n = g.npcs.find(x => x.id === b.npc); window.__b = { b, n };
      if (b.hours && b.hours.slots && !b.hours.slots.includes(L.day.slot)) { g.clock.frozen = false; g.setClock(g.clock.y, g.clock.m, g.clock.d, L.day.bounds()[b.hours.slots[0]] + 20); g.clock.frozen = true; }
    }); // (talked to from where you stand: the stills are of the screens, over the street as it is)
    await p.waitForTimeout(3500);
    await p.evaluate(() => document.querySelectorAll('.lf-card').forEach(e => e.remove()));
    await act('bond-invite', () => { const g = window.__game; g.life.bonds.talk(window.__b.n); for (let i = 0; i < 3 && !g.dlg.hasChoices; i++) g.dlg.next(false); });
    await act('bond-scene', () => { const g = window.__game; g.dlg.choose(0); g.dlg.next(false); });
    await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 30 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.next(false); });
    await shot('bond-ask');
    await p.evaluate(() => { const g = window.__game, k = window.__b.b.ranks[0].ask ? window.__b.b.ranks[0].ask.options.findIndex(o => o.good) : 0; g.dlg.choose(Math.max(0, k)); for (let i = 0; i < 30 && g.dlg.open; i++) g.dlg.next(false); });
    await p.waitForTimeout(700);
    await shot('rank-up');
    await p.evaluate(() => window.__game.life.ui.clear());
    await quiet();
    await act('diary-people-known', () => { const d = window.__game.life.day; d.show(); document.querySelector('.lf-tabs button[data-tab="people"]').click(); });
    await quiet();
  }
  if (has.jobs) {
    await act('job', () => { const g = window.__game, L = g.life, j = L.data.jobs.find(x => x.type === 'point') || L.data.jobs[0]; j.locked = false; delete j.when;
      L.jobs.start(j.id); g.player.x = j.at[0]; g.player.y = j.at[1]; if (j.at[2] != null) g.player.z = j.at[2]; });
    await p.waitForTimeout(1500);
    await shot('job-running');
    await p.evaluate(() => { const g = window.__game, L = g.life; while (L.jobs.active && L.jobs.active.j.type === 'point') L.jobs.pointAt(); });
    await p.waitForTimeout(900);
    await shot('job-done');
    await p.evaluate(() => window.__game.life.ui.clear());
  }
  await act('phone', () => { window.__game.life.phone.post('Calendar', 'The diary has today: who is free, what is on.', 'shot'); window.__game.phoneShow('home'); });
  await act('phone-messages', () => window.__game.phoneShow('messages'));
  await quiet();
  await act('passport', () => { window.__game.life.emit('guess', { score: 90 }); window.__game.renderPassport(); document.getElementById('g-pass').hidden = false; });
  await quiet();
  if (logs.length) { console.log(logs.join('\n')); process.exitCode = 1; }
  await b.close();
})();
