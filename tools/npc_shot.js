// Stills of a city's NPCs in the game: for each, the surveyor walks up to 2.6 m in front of it and
// the camera looks past the surveyor's shoulder at its face, at the clock time given. Prints the
// characters each NPC was drawn with and the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/npc_shot.js tokyo out_dir [ids,...|all] [HH:MM] [WxH]   # llvmpipe; without xvfb-run, SwiftShader
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'tokyo', outDir = '.', idsArg = 'all', hhmm = '10:30', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const [hh, mm] = hhmm.split(':').map(Number);
  const npcs = await p.evaluate(min => {
    const g = window.__game, c = g.clock;
    g.setClock(c.y, c.m, c.d, min);
    g.advance(1);
    return g.npcs.map(n => ({ id: n.id, character: n.look.character, clip: n.look.clip || '', drawn: n.rig.character || 'simple figure' }));
  }, hh * 60 + mm);
  for (const n of npcs) console.log(`${n.id.padEnd(10)} ${n.character} ${n.clip} -> ${n.drawn}`);
  const ids = idsArg === 'all' ? npcs.map(n => n.id) : idsArg.split(',');
  for (const id of ids) {
    await p.evaluate(id => {
      const g = window.__game, n = g.npcs.find(q => q.id === id), V = (x, y, z) => new THREE.Vector3(x, z, -y);
      if (g.cine.active) g.cine.skip();
      // the side with a clear view from the camera to the face, nearest the way the NPC faces
      let best = null;
      for (let k = 0; k < 16; k++) {
        const a = n.h + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8, s = Math.sin(a), c = Math.cos(a);
        const f = g.nav.clearFraction(V(n.x, n.y, n.z + 1.6), V(n.x + s * 6.2, n.y + c * 6.2, n.z + 1.9));
        if (!best || f > best.f + 0.02) best = { a, f };
        if (f > 0.99) break;
      }
      g.player.x = n.x + Math.sin(best.a) * 2.6; g.player.y = n.y + Math.cos(best.a) * 2.6; g.player.z = n.z;
      g.player.h = Math.atan2(n.x - g.player.x, n.y - g.player.y);
      Object.assign(g.cam, { mode: 'chase', yaw: g.player.h + 0.35, pitch: 0.06, dist: 3.6, distTo: 0, yawTo: null, lastInput: -10 });
      g.advance(1.5);
    }, id);
    // the game draws on the next animation frame: read the canvas after two
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    fs.writeFileSync(path.join(outDir, `${city}-${id}-${hhmm.replace(':', '')}-${w}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
