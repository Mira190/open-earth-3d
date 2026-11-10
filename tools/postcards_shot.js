// Stills of the title screen's postcards (web/postcards.js): the pile on the menu, the viewer on its newest
// card and on an older one, for a player who has been away long enough to have an album, on a desktop and a phone.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/postcards_shot.js out_dir [WxH] [days since the first visit, 24 by default]
// Writes out_dir/<W>x<H>-pile.png, -card.png and -album.png.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, outDir = 'postcards-shot', size = '1440x900', days = '24'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(tier => {
    try { localStorage.setItem('oe3d-quality', tier); } catch (e) { /* storage blocked */ }
    window.__titleManual = true;
  }, process.env.TIER || 'high');
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/index.html#globe`, { timeout: 120000 });
  await p.waitForFunction(() => window.__title && ['gate', 'menu'].includes(window.__title.state), null, { timeout: 300000 });
  // the album a player would have after that many days: a visit a day, planned before the menu mounts the pile
  await p.evaluate(async days => {
    const P = window.OEPostcards, M = await P.load(), cities = window.OE_CITIES.filter(c => c.built && c.game);
    const now = Date.now(), st = P.fresh(now - days * 86400e3);
    for (let d = days; d >= 4; d--) P.plan(st, now - d * 86400e3 + (d % 3) * 3600e3, M, cities); // (and three days away since)
    for (const k of st.cards) k.seen = 1;
    localStorage.setItem(P.KEY, JSON.stringify(st));
  }, +days);
  await p.evaluate(() => { if (window.__title.state === 'gate') window.__title.begin(false); window.__title.skip(); });
  await p.waitForFunction(() => window.__title.state === 'menu', null, { timeout: 60000 });
  await p.waitForSelector('#ts-post', { timeout: 60000 });
  await p.evaluate(() => window.__title.select(2));
  await p.waitForTimeout(4500);
  fs.mkdirSync(outDir, { recursive: true });
  const shot = async name => { await p.screenshot({ path: path.join(outDir, `${w}x${h}-${name}.png`) }); console.log(`${w}x${h}-${name}`); };
  await shot('pile');
  await p.evaluate(() => window.__title.postcards.open(0));
  await p.waitForFunction(() => { const i = document.querySelector('.pv-photo img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(900);
  await shot('card');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(900);
  await shot('album');
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  await b.close();
})();
