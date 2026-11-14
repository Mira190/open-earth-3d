// What a step of the game's simulation costs on the CPU, by part: run a city's game headless, then
// time g.advance over a few hundred frames with the crowd's and the traffic's own updates timed
// inside it. For comparing a change with main (run each against its own server).
//   python3 -m http.server 8800 --directory web &
//   HOUR=12 xvfb-run -a node tools/sim_cost.js shibuya [frames]   # (HOUR: the clock set to that hour first)
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', framesArg = '300'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  const r = await p.evaluate(([n, hour]) => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game;
    if (g.cine && g.cine.active) g.cine.skip();
    if (hour != null) g.setClock(g.clock.y, g.clock.m, g.clock.d, hour * 60);
    g.advance(4);
    const wrap = (o, k) => { const f = o[k].bind(o); let t = 0; o[k] = (...a) => { const s = performance.now(); const r = f(...a); t += performance.now() - s; return r; }; return () => t; };
    const crowdT = wrap(g.crowd, 'update'), carsT = wrap(g.cars, 'update');
    const t0 = performance.now();
    for (let i = 0; i < n; i++) g.advance(1 / 30);
    const all = performance.now() - t0;
    return { all: all / n, crowd: crowdT() / n, cars: carsT() / n, walkers: g.crowd.active, cars: g.cars.active, carsMs: carsT() / n };
  }, [+framesArg, process.env.HOUR != null ? +process.env.HOUR : null]);
  console.log(`${city}: a step ${r.all.toFixed(2)} ms; crowd ${r.crowd.toFixed(2)} ms (${r.walkers} walkers); traffic ${r.carsMs.toFixed(2)} ms`);
  await b.close();
})();
