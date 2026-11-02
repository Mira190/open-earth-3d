// Ask the game's walker what it stands on at a few points: node tools/probe_walk.js sydney '[[x, y, z], ...]'
// (under xvfb-run, with web/ served on PORT or 8800): prints nav.floorAt, nav.walk and the terrain there.
'use strict';
const { chromium } = require('playwright');
const [,, city = 'sydney', pts = '[]'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const out = await p.evaluate(P => P.map(([x, y, z]) => {
    const nav = window.__game.nav;
    return { at: [x, y, z], terrain: nav.terrain(x, y), floor: nav.floorAt(x, y, z), walk: nav.walk(x, y, z), solid: nav.landmarkHit(x, y, z + 0.4, z + 1.8) };
  }), JSON.parse(pts));
  for (const o of out) console.log(JSON.stringify(o));
  await b.close();
})();
