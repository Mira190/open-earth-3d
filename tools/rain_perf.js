// What the rain costs a frame: stand where the game opens (or at `at`), and time frames with a clear
// sky, then in rain, then in rain with each of its parts left out in turn (the streaks, the
// splashes, the occlusion map, the wet look), on foot and driving. The desktop tier unless TIER says.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/rain_perf.js shibuya [frames]
const { chromium } = require('playwright');
const [,, city = 'shibuya', framesArg = '60'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.waitForTimeout(3000);
  const out = await p.evaluate(async n => {
    const g = window.__game, W = g.weather;
    if (g.cine && g.cine.active) g.cine.skip();
    const frames = k => new Promise(res => { const ts = []; const f = t => { ts.push(t); if (ts.length > k) res(ts); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const time = async () => { await frames(8); const ts = await frames(n); const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); return { mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p90: +d[Math.floor(d.length * 0.9)].toFixed(1), max: +d[d.length - 1].toFixed(1) }; };
    // the time inside the weather's own frame (CPU) and its occlusion pass
    let upd = 0, occ = 0, nUpd = 0;
    const u0 = W.update.bind(W); W.update = function (...a) { const t = performance.now(); const r = u0(...a); upd += performance.now() - t; nUpd++; return r; };
    const r = {};
    const run = async name => { upd = 0; nUpd = 0; const t = await time(); r[name] = Object.assign(t, { weatherCpu: +(upd / Math.max(1, nUpd)).toFixed(2) }); };
    W.set('clear', { now: true }); await run('clear');
    // what the first rain frame spends where: the weather's own work, the mirror's draw, the main draw
    const M0 = g.mirror && g.mirror.update; let mT = 0; if (M0) g.mirror.update = function (...a) { const t = performance.now(); const r = M0.apply(this, a); mT += performance.now() - t; return r; };
    // the first frames as the rain comes on: what it compiles and builds the first time
    W.set('rain', { now: true });
    { const t0 = performance.now(); const ts = await frames(6); r['rain, its first 6 frames'] = { mean: +((ts[ts.length - 1] - t0) / 6).toFixed(1), p90: 0, max: +Math.max(...ts.slice(1).map((t, i) => t - ts[i]), ts[0] - t0).toFixed(1), weatherCpu: +(upd / Math.max(1, nUpd)).toFixed(2), mirror: +mT.toFixed(0) }; }
    await run('rain');
    if (g.mirror) { g.mirror.off = true; await run('rain, no street reflections'); }
    // and no occlusion pass from above either
    const R0 = THREE.WebGLRenderer.prototype.render;
    if (W.occ) { THREE.WebGLRenderer.prototype.render = function (sc, ca) { if (this.getRenderTarget() === W.occ) return; return R0.call(this, sc, ca); }; await run('rain, no reflections, no occlusion pass'); THREE.WebGLRenderer.prototype.render = R0; }
    if (g.mirror) g.mirror.off = false;
    const M = W.meshes;
    // the streaks' and splashes' visibility is set every frame from the shed level: hold them off by
    // wrapping the meshes' visible flag
    const pin = (m, v) => Object.defineProperty(m, 'visible', { configurable: true, get: () => v, set: () => {} });
    const unpin = m => { delete m.visible; m.visible = true; };
    pin(M.far, false); pin(M.splash, false); await run('rain, no far streaks or splashes');
    pin(M.near, false); await run('rain, no streaks at all');
    unpin(M.near); unpin(M.far); unpin(M.splash);
    const U = W.U;
    W.set('clear', { now: true });
    U.uOeWet.value = 1; await run('dry sky, wet streets (puddles)');
    U.uOeWet.value = 0;
    return { r, tier: (window.OEQuality && OEQuality.city && OEQuality.city().name) || '?', walkers: g.crowd.active };
  }, +framesArg);
  console.log(city, out.tier, `${out.walkers} walkers`);
  for (const [k, v] of Object.entries(out.r)) console.log(`  ${k.padEnd(36)} ${String(v.mean).padStart(6)} ms mean, p90 ${v.p90}, max ${v.max}; weather.update ${v.weatherCpu} ms${v.mirror != null ? `; mirror ${v.mirror} ms in all` : ''}`);
  await b.close();
})();
