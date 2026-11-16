// Evaluate an expression (or the body of an async function, given a file) in a city's game once it is played and its
// walking network is built, and print the JSON result: a quick question to the game's own nav, ways and data.
//   xvfb-run -a node tools/game_eval.js tokyo "window.__game.ways.walk({x: 553, y: 1195, z: 3}, {x: 690, y: 1225, z: 10.3}).len"
//   xvfb-run -a node tools/game_eval.js tokyo @probe.js      (the file's text is an async function's body; g is window.__game)
// web/ served on PORT or 8800. TIER=low|medium|high (default low).
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', what = 'null'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); g.spawn(); g.advance(0.5); return g.lateReady && g.lateReady(); });
  await p.waitForFunction('window.__game.ways.ready', null, { timeout: 300000 });
  const body = what[0] === '@' ? fs.readFileSync(what.slice(1), 'utf8') : `return (${what});`;
  const r = await p.evaluate(`(async () => { const g = window.__game; ${body} })()`);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
