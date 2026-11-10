// What each weather costs a frame, by tier: stand where the game opens and, for a clear sky and then each
// weather in turn, measure the median frame time and count the draw calls and triangles of a frame (the
// counts transfer to a real GPU; the times from a software renderer only compare one state with another).
// A weather adds no full-screen pass and no render of the scene: the passes are counted to show it (draws
// of 3 or 6 vertices), and "occ" is the occlusion map from above, redrawn only as the camera moves or
// every half second while something falls (it was there for the rain before #356).
//   python3 -m http.server 8800 --directory web &
//   TIER=high xvfb-run -a node tools/weather_cost.js kyoto [frames]     # TIER=high|medium|low
const { chromium } = require('playwright');
const [,, city = 'kyoto', framesArg = '40'] = process.argv;
const STATES = [
  ['clear', 'clear'],
  ['overcast', 'overcast'],
  ['fog', 'fog'],
  ['rain', 'rain'],
  ['thunderstorm', 'storm'],
  ['after rain (wet, drying)', { rain: 0, cloud: 0.3, wet: 0.9 }],
  ['snow falling', 'snow'],
  ['snow lying, clear', { snow: 0, cloud: 0.1, snowDepth: 0.7, temp: -2 }],
];
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const tier = process.env.TIER || 'high';
  const p = await b.newPage({ viewport: tier === 'low' ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, tier);
  // count what a frame draws
  await p.addInitScript(() => {
    const C = window.__draws = { draws: 0, tris: 0, full: 0 };
    const P = WebGL2RenderingContext.prototype;
    const wrap = (name, count, inst) => { const f = P[name]; P[name] = function (...a) { const n = a[count] * (inst == null ? 1 : a[inst]); C.draws++; C.tris += n / 3; if (a[count] <= 6 && inst == null) C.full++; return f.apply(this, a); }; };
    wrap('drawElements', 1); wrap('drawArrays', 2); wrap('drawElementsInstanced', 1, 4); wrap('drawArraysInstanced', 2, 3);
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  p.on('console', m => { if (m.type() === 'error') console.log(`error: ${m.text().slice(0, 240)}`); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.waitForTimeout(4000);
  const out = await p.evaluate(async ([n, states]) => {
    const g = window.__game, W = g.weather, C = window.__draws;
    if (g.cine && g.cine.active) g.cine.skip();
    if (g.lateReady) await g.lateReady();
    W.guardForce(false);
    const frames = k => new Promise(res => { const ts = []; const f = t => { ts.push(t); if (ts.length > k) res(ts); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const rows = [];
    for (const [name, set] of states) {
      W.set(set, { now: true });
      await frames(10);
      C.draws = C.tris = C.full = 0;
      const ts = await frames(n), d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, c) => a - c);
      rows.push({ name, ms: +d[d.length >> 1].toFixed(0), draws: Math.round(C.draws / n), tris: Math.round(C.tris / n), full: Math.round(C.full / n), level: W.level, kind: OEWeather.S.kind });
    }
    W.set('clear', { now: true });
    return rows;
  }, [+framesArg, STATES]);
  const base = out[0];
  console.log(`${city}, ${tier} tier: median frame, draws, triangles and full-screen passes a frame; against clear in brackets`);
  for (const r of out) console.log(`  ${r.name.padEnd(26)} ${String(r.ms).padStart(5)} ms (${r.ms - base.ms >= 0 ? '+' : ''}${r.ms - base.ms})  ${String(r.draws).padStart(5)} draws (${r.draws - base.draws >= 0 ? '+' : ''}${r.draws - base.draws})  ${(r.tris / 1e6).toFixed(2)}M tris (${r.tris - base.tris >= 0 ? '+' : ''}${((r.tris - base.tris) / 1e3).toFixed(0)}k)  ${r.full} passes (${r.full - base.full >= 0 ? '+' : ''}${r.full - base.full})`);
  await b.close();
})();
