// Stills from inside a taxi waiting in a queue at a red light (#107): you hail a taxi (or order a
// ride), get in, and it is put on a road behind a queue at a red light (tools/ride_queue.js); once it
// has stopped behind the queue, a still from the back seat (the cabin view) and one from the chase
// camera, at each time given. Prints, for each, how far out of its lane the taxi went and what it
// waits behind. Stills are taken at the desktop tier.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/ride_shot.js shibuya out_dir [WxH] [times]
// times: comma-separated, HH:MM local or relative to the sun ("sunset+15"); default 10:00,sunset+15,21:30
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { findQueue } = require('./ride_queue');
const [,, city = 'shibuya', outDir = '.', size = '1440x900', timesArg = '10:00,sunset+15,21:30'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(src => { window.__findQueue = eval(`(${src})`); }, findQueue.toString());
  const grab = async name => {
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const tag = `${city}-${w}x${h}`;
  for (const time of timesArg.split(',')) {
    const r = await p.evaluate(time => {
      const g = window.__game, c = g.clock;
      if (g.arriving()) g.settleArrival();
      if (g.cine.active) g.cine.skip();
      if (g.ride()) { if (g.player.mode === 'ride') { g.skipRide(); g.advance(6); g.leaveRide(); } else g.cancelRide(); }
      if (g.player.mode !== 'foot') g.exitCar();
      const rel = /^(sunrise|sunset)([+-]\d+)?$/.exec(time);
      let min;
      if (rel) min = Math.round(g.dayLimits()[rel[1]] + (+rel[2] || 0));
      else { const [hh, mm] = time.split(':').map(Number); min = hh * 60 + mm; }
      g.setClock(c.y, c.m, c.d, min);
      g.advance(1);
      // a taxi hailed at the kerb (or a ride ordered on the phone), and in the back
      g.hail();
      if (!g.ride()) { const dest = g.destinations(g.player.x, g.player.y)[0]; if (dest) g.orderRide(dest); }
      const o = g.ride();
      if (!o) return { none: 'no taxi or ride' };
      for (let t = 0; t < 90 && o.phase === 'coming'; t += 0.5) g.advance(0.5);
      g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      if (g.dlg.open) g.dlg.choose(0);
      if (g.player.mode !== 'ride') return { none: 'not in the taxi' };
      const pick = window.__findQueue(g, new Set(), [g.player.x, g.player.y]) || window.__findQueue(g, new Set());
      if (!pick) return { none: 'no queue at a red light' };
      o.drv.leave();
      o.drv = OECars.chauffeur(o.C, pick.rt, { keep: g.KEEP === 'left' ? 1 : -1, from: 'lane', v: 0, lights: g.junctions, now: g.t });
      const st = o.drv.st;
      let shift = 0, waited = 0;
      for (let t = 0; t < 40 && waited < 2; t += 0.25) {
        g.advance(0.25);
        shift = Math.max(shift, Math.abs(st.shift));
        waited = st.q && st.v < 0.1 ? waited + 0.25 : 0;
      }
      Object.assign(g.cam, { mode: 'cabin', pitch: 0.05, lastInput: -10 });
      g.advance(0.5);
      const bl = st.block;
      return { shift, q: !!st.q, v: st.v, why: st.why, behind: bl ? `car ${g.cars.C.indexOf(bl)} (${bl.why}${bl.q ? ', queueing' : ''})` : 'the line', at: [Math.round(st.x), Math.round(st.y)] };
    }, time);
    if (r.none) { console.log(`${time}: ${r.none}`); continue; }
    const name = `${tag}-${time.replace(/[:+]/g, '')}`;
    await grab(`${name}-cabin`);
    await p.evaluate(() => { const g = window.__game; Object.assign(g.cam, { mode: 'chase', pitch: 0.18, dist: 9, lastInput: -10 }); g.advance(1); });
    await grab(`${name}-chase`);
    console.log(`${name}: at ${r.at}, out of its lane by ${r.shift.toFixed(2)} m at most, queueing ${r.q}, v ${r.v.toFixed(1)}, waiting behind ${r.behind} (${r.why})`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
