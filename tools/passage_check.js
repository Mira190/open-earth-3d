// Walk every passage through a city's landmarks end to end (tools/passage_walk.js): node tools/passage_check.js
// amsterdam [paris ...] under xvfb-run, with web/ served on PORT or 8800. Prints each passage both ways and
// exits 1 if any is blocked.
'use strict';
const { chromium } = require('playwright');
const walk = require('./passage_walk');
const cities = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  let bad = 0;
  for (const city of cities) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    const res = await walk(p);
    if (!res.length) console.log(`${city}: no passages through its landmarks`);
    for (const r of res) {
      if (r.notYet) { console.log(`${city}: not yet ${r.name} (w${r.osm}): ${r.notYet}`); continue; }
      if (!r.ok) bad++;
      console.log(`${city}: ${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (w${r.osm}, ${r.cls}, ${r.len.toFixed(0)} m${r.rev ? ', back' : ''})${r.ok ? '' : `: ${r.why} at ${r.at}`}`);
    }
    await p.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
