// Walk into Queenstown's rooms and out again (tools/interior_step.js) on its own, with a still from inside each:
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/interior_probe.js queenstown out_dir [HH:MM]
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'queenstown', outDir = '.', time = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* blocked */ } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); });
  const play = await p.$('#gt-play'); if (play) await play.click().catch(() => {});
  if (time) await p.evaluate(t => { const g = window.__game, [h, m] = t.split(':').map(Number); g.setClock(g.clock.y, g.clock.m, g.clock.d, h * 60 + m); }, time);
  await p.evaluate(() => window.__game.advance(1));
  const res = await require('./interior_step')(p, { outDir, prefix: `${city}-${time.replace(':', '')}-` });
  for (const r of res) console.log(r.ok ? 'ok  ' : 'FAIL', JSON.stringify(r));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
