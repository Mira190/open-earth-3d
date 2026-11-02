// Where the street traffic's update spends its time: run a city's traffic headlessly for a while
// with the browser's sampling profiler on, and list the functions of web/game/actors.js and
// junctions.js by their own time, with the update's mean cost a frame.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/traffic_profile.js sydney [seconds]
const { chromium } = require('playwright');
const [,, city = 'sydney', secs = '40'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.advance(20); }); // warm up: the junctions' ways worked out, the code compiled
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const ms = await p.evaluate(T => {
    const A = window.__game.cars, upd = A.update; let ut = 0, un = 0;
    A.update = function (...a) { const t0 = performance.now(), r = upd.apply(this, a); ut += performance.now() - t0; un++; return r; };
    window.__game.advance(T);
    A.update = upd;
    return ut / Math.max(1, un);
  }, Number(secs));
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map(n => [n.id, n]));
  const counts = new Map();
  for (let i = 0; i < profile.samples.length; i++) counts.set(profile.samples[i], (counts.get(profile.samples[i]) || 0) + (dt[i] || 0));
  for (const [id, t] of counts) {
    const f = byId.get(id).callFrame, file = (f.url || '').split('/').pop();
    if (!/actors|junctions/.test(file)) continue;
    const k = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + t / 1000);
  }
  const total = [...self.values()].reduce((a, v) => a + v, 0);
  console.log(`${city}: the traffic update ${ms.toFixed(2)} ms a frame; own time in actors.js and junctions.js over ${secs} s of play:`);
  for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${(t).toFixed(0).padStart(6)} ms ${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`);
  // and the lines of the traffic's own update() that take the most samples
  const lines = new Map();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    if (!/actors\.js$/.test(f.url || '') || f.functionName !== 'update' || !n.positionTicks) continue;
    for (const t of n.positionTicks) lines.set(t.line, (lines.get(t.line) || 0) + t.ticks);
  }
  const tl = [...lines.values()].reduce((a, v) => a + v, 0);
  if (tl) console.log('busiest lines of the update functions in actors.js (share of their samples):');
  for (const [l, t] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${(100 * t / tl).toFixed(1).padStart(5)}%  actors.js:${l}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
