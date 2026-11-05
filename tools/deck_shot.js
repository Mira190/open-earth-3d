// Stills of travelling from the map to each landmark with a deck you go up (an observation deck with its own
// lift: game.json "lifts"): the hop lands you on the deck, facing out; a still there at day, dusk and night.
// Prints where you landed and the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/deck_shot.js shibuya out_dir [WxH]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = '.', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => { // the canvas keeps its frame, to read back
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { const g = window.__game; g.advance(1); if (g.settleArrival) g.settleArrival(); for (let i = 0; i < 20; i++) g.advance(0.25); });
  const names = await p.evaluate(() => window.__game.landmarks.filter(l => window.__game.deckOf(l)).map(l => l.name));
  for (const name of names) {
    const r = await p.evaluate(name => {
      const g = window.__game, lm = g.landmarks.find(l => l.name === name);
      g.travelTo(lm);
      for (let i = 0; i < 60 && g.cine.active; i++) g.advance(0.25);
      g.advance(1);
      return { x: g.player.x, y: g.player.y, z: g.player.z, up: g.player.z - Math.max(0, g.nav.terrain(g.player.x, g.player.y)), h: g.player.h };
    }, name);
    console.log(`${name}: on foot at ${[r.x, r.y, r.z].map(v => v.toFixed(1))}, ${r.up.toFixed(0)} m over the street, facing ${(r.h * 180 / Math.PI).toFixed(0)}°`);
    for (const [tag, min] of [['day', 14 * 60], ['dusk', 17 * 60 + 5], ['night', 20 * 60 + 30]]) {
      await p.evaluate(min => { const g = window.__game, c = g.clock; g.setClock(c.y, c.m, c.d, min); for (let i = 0; i < 8; i++) g.advance(0.25); }, min);
      await p.waitForTimeout(1500);
      const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `${city}-${name.split(' ')[0].toLowerCase()}-deck-${tag}-${w}x${h}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
  }
  console.log(logs.join('\n'));
  await b.close();
})();
