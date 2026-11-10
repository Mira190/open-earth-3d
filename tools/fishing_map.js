// The fishing spots on the maps (docs/FISHING.md): each is a pin on the big map and the minimap, is
// listed under "Fishing spots" in the map's travel list, and Travel there puts you within reach of it.
//   xvfb-run -a node tools/fishing_map.js sydney out_dir [WxH]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number), phone = w < 700;
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage(phone ? { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, phone ? 'low' : 'high');
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const q = document.getElementById('gt-play'); if (q) q.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async () => {
    const g = window.__game;
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    const O = window.OEOnboard, t = O && O.current && O.current(); if (t) t.skip();
  });
  const fails = [];
  const spots = await p.evaluate(() => window.__game.fishing().spots.map(s => ({ id: s.id, at: s.at })));
  await p.evaluate(() => window.__game.toggleMap());
  await p.waitForTimeout(800);
  const pins = await p.evaluate(() => window.__game.mapPins().filter(q => q.d.kind === 'fish').map(q => q.d.id));
  const groups = await p.evaluate(() => window.__game.travelGroups().map(([t, l]) => [t, l.map(d => d.id)]));
  for (const s of spots) {
    if (!pins.includes(`fish-${s.id}`)) fails.push(`${s.id}: no pin on the big map`);
    if (!(groups.find(g => g[0] === 'Fishing spots') || [, []])[1].includes(`fish-${s.id}`)) fails.push(`${s.id}: not in the travel list`);
  }
  await p.screenshot({ path: path.join(outDir, `${city}-map-${phone ? 'phone' : 'desktop'}.png`) });
  await p.evaluate(() => window.__game.toggleMap());
  for (const s of spots) {
    const r = await p.evaluate(id => { const g = window.__game, d = g.travelGroups().flatMap(x => x[1]).find(d => d.id === `fish-${id}`); const ok = g.travelTo(d); g.settleArrival && g.settleArrival(); g.advance(1.5); return { ok, x: g.player.x, y: g.player.y }; }, s.id);
    const dist = Math.hypot(r.x - s.at[0], r.y - s.at[1]);
    console.log(`${s.id}: travel ${r.ok}, ${dist.toFixed(1)} m from the spot`);
    if (!r.ok || dist > 12) fails.push(`${s.id}: travel left you ${dist.toFixed(1)} m away`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(outDir, `${city}-${s.id}-minimap-${phone ? 'phone' : 'desktop'}.png`) });
  }
  if (logs.length) console.log(logs.join('\n'));
  console.log(fails.length ? `FAIL\n${fails.join('\n')}` : 'ok   fishing_map');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
