// Walk down into a city's sunken promenade and back up (tools/promenade_walk.js) without the rest of
// tools/game_check.js: node tools/promenade_check.js kyoto [out_dir] under xvfb-run, with web/ served on PORT or 8800.
// Prints each check, saves a still of the walker on the floor, and exits 1 if one fails.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const walk = require('./promenade_walk');
const [,, city = 'kyoto', outDir = '.'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const r = await walk(p);
  let bad = 0;
  if (r.none) console.log(`${city}: no sunken promenade`);
  else for (const [ok, what] of r.checks) { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); }
  fs.mkdirSync(outDir, { recursive: true });
  await p.screenshot({ path: `${outDir}/${city}-promenade.png` });
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
