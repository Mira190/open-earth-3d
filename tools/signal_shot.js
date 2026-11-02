// Stills of a city's signalised junctions in the game (junctions.js): for each of the first few
// junctions with signals near the start (or the ones named), the surveyor stands on a corner and
// the camera looks over the shoulder across the junction, at each clock time given, after the
// traffic has run a while. Prints what the signals and the traffic were doing and the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/signal_shot.js sydney out_dir [count|id,id] [HH:MM,HH:MM] [WxH]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', which = '3', times = '10:30,19:40,22:00', size = '1440x900'] = process.argv;
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
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const ids = await p.evaluate(which => {
    const g = window.__game, J = g.cars.junctions.J, x0 = g.player.x, y0 = g.player.y;
    if (/^[\d,]+$/.test(which) && which.includes(',')) return which.split(',').filter(Boolean).map(Number);
    return J.filter(j => j.sig).sort((a, b) => Math.hypot(a.x - x0, a.y - y0) - Math.hypot(b.x - x0, b.y - y0)).slice(0, Number(which)).map(j => j.id);
  }, which);
  for (const id of ids) {
    for (const hhmm of times.split(',')) {
      const [hh, mm] = hhmm.split(':').map(Number);
      const info = await p.evaluate(([id, min]) => {
        const g = window.__game, JN = g.cars.junctions, j = JN.J[id], c = g.clock;
        if (g.cine.active) g.cine.skip();
        g.setClock(c.y, c.m, c.d, min);
        // a driver's view: on the kerb of the main road's arm, back from its stop line, looking into the junction
        const a = j.arms.filter(q => q.in).sort((p2, q) => q.rank - p2.rank)[0], back = a.back + 13, side = g.KEEP === 'right' ? -1 : 1;
        const hx = -Math.sin(a.out), hy = -Math.cos(a.out); // the way the arm's traffic comes in
        const x = a.x - hx * back - hy * 5.5 * side, y = a.y - hy * back + hx * 5.5 * side;
        g.player.x = x; g.player.y = y; g.player.z = g.nav.terrain ? g.nav.terrain(x, y) : j.z;
        g.player.h = Math.atan2(j.x - x, j.y - y);
        Object.assign(g.cam, { mode: 'chase', yaw: g.player.h, pitch: 0.02, dist: 4, distTo: 0, yawTo: null, lastInput: -10 });
        g.advance(25);
        const lights = j.arms.filter(a => a.in).map(a => JN.light(a)).join('');
        return { id, at: [Math.round(j.x), Math.round(j.y)], arms: j.arms.length, lights, cars: g.cars.C.filter(q => q.line >= 0 && Math.hypot(q.x - j.x, q.y - j.y) < 60).length };
      }, [id, hh * 60 + mm]);
      const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
      const file = path.join(outDir, `${city}-j${id}-${hhmm.replace(':', '')}-${w}.png`);
      fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
      console.log(`${file}: junction ${info.id} at ${info.at}, ${info.arms} arms, lights ${info.lights}, ${info.cars} cars within 60 m`);
    }
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
