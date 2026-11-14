// Take a city's seats (tools/seat_step.js) on their own, with a still from each:
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=20:30 xvfb-run -a node tools/seat_probe.js sydney out_dir [WxH]   # (GAME_TIME: tools/pin_clock.js)
//   TOUCH=1 ... sydney out_dir 390x844                                            # on a phone: tapped, a finger to look round
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', outDir = '.', size = '1440x900'] = process.argv;
const time = (process.env.GAME_TIME || '').replace(/.*T/, '');
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const touch = !!process.env.TOUCH; // a phone: touch, the touch controls, the action button tapped (seat_step)
  const p = await b.newPage({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : {}) });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  await pinClock(p, city);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(() => { window.__game.hold(true, true); });
  // past the title: one click on Play once it is there (a click that lands before the button is ready leaves the
  // title up, and no action is offered under it: then one more)
  for (let k = 0; k < 2; k++) {
    await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
    let up = true;
    for (let i = 0; i < 24 && up; i++) { up = await p.evaluate(() => { const t = document.getElementById('g-title'); window.__game.advance(0.25); return !!t && !t.hidden; }); if (up) await p.waitForTimeout(250); }
    if (!up) break;
  }
  await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 80; i++) g.advance(0.25); }); // (the arrival's shot over: actions are offered)
  const res = await require('./seat_step')(p, { outDir, prefix: `${city}-${time.replace(':', '')}-${touch ? 'phone-' : ''}`, touch });
  for (const r of res) console.log(r.ok ? 'ok  ' : 'FAIL', JSON.stringify(r));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
