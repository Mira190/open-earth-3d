// Stills of the title screen's destination cards: the menu, with each named destination picked,
// for judging the card (a city's districts, a reef's sites) on a desktop and a phone. Also
// prints the menu's entries in order, so a check can see that each city is listed once.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/menu_shot.js out_dir [WxH] [names]
//     names: comma-separated destination names as the menu shows them (default: every one)
// Writes out_dir/<W>x<H>-<name>.png.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, outDir = 'menu-shot', size = '1440x900', names = ''] = process.argv;
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
  await p.evaluate(() => { if (window.__title.state === 'gate') window.__title.begin(false); window.__title.skip(); });
  await p.waitForFunction(() => window.__title.state === 'menu', null, { timeout: 60000 });
  const dests = await p.evaluate(() => window.__title.dests.map(d => ({ name: d.name, sites: d.sites ? d.sites.map(c => c.district || c.name) : null })));
  console.log(dests.map((d, i) => `${String(i + 1).padStart(2, '0')} ${d.name}${d.sites ? ` [${d.sites.join(' | ')}]` : ''}`).join('\n'));
  fs.mkdirSync(outDir, { recursive: true });
  const want = names ? names.split(',') : dests.map(d => d.name);
  for (const n of want) {
    const i = dests.findIndex(d => d.name === n);
    if (i < 0) { console.log(`no destination named ${n}`); continue; }
    await p.evaluate(i => window.__title.select(i), i);
    await p.waitForTimeout(2500); // the globe turns and the card comes in
    const file = path.join(outDir, `${w}x${h}-${n.toLowerCase().replace(/\W+/g, '-')}.png`);
    await p.screenshot({ path: file, timeout: 240000 });
    console.log(file);
  }
  if (errors.length) console.log('errors:', errors.join(' | '));
  await b.close();
})();
