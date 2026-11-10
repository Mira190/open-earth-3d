// The frame-time governor (web/quality.js) in a city's game: fed slow frames on a clock of its own it must take
// the scene's resolution down, then the extras, and bring the resolution back when the frames are fast; and a
// still of the same view with the scene at full size and at 0.6 of it, to judge the lens's sharpened upscale.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/governor_probe.js sydney out_dir [WxH]      TIER=high|medium|low, TIME=HH:MM
const { chromium } = require('playwright');
const path = require('path');
const [,, city = 'sydney', outDir = '.', size = '1440x900'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.atmos', null, { timeout: 600000 });
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const x = document.getElementById('gt-play'); if (x) x.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async t => {
    const g = window.__game, [H, M] = t.split(':').map(Number), c = g.clock;
    g.setClock(c.y, c.m, c.d, H * 60 + M); c.frozen = true;
    for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let i = 0; i < 40 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine && g.cine.active) g.cine.skip();
    const O = window.OEOnboard, tour = O && O.current && O.current(); if (tour) tour.skip();
    g.hold(true);
  }, process.env.TIME || '15:30');
  await p.waitForTimeout(4000);
  const frames = n => p.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async name => { await frames(4); await p.screenshot({ path: path.join(outDir, `${name}.png`) }); };
  await shot('scale-1.00');
  const res = await p.evaluate(() => {
    const G = window.__game.governor, cost = base => (s, e) => base * (0.35 + 0.5 * s * s + 0.15 * e);
    const out = { max: G.max, fast: G.simulate(10, cost(10)).pop() };
    out.slow = G.simulate(40, cost(40)).filter((x, i, a) => !i || x !== a[i - 1]).join(' ');
    const C = window.__game.atmos.composer; out.msaaSlow = C ? C.samples : null;
    out.recovered = G.simulate(240, cost(9)).pop();
    out.msaaBack = C ? C.samples : null;
    G.set(0.6, 1);
    const c = window.__game.atmos.composer;
    out.target = c ? `${c.renderTarget1.width}x${c.renderTarget1.height} of ${c.renderer.domElement.width}x${c.renderer.domElement.height}` : 'no post stack';
    return out;
  });
  await shot('scale-0.60');
  await p.evaluate(() => window.__game.governor.set(0.8, 1));
  await shot('scale-0.80');
  console.log(JSON.stringify(res), errs.length ? `errors: ${errs.join(' | ')}` : '');
  await b.close();
  const ok = res.fast === `${res.max.toFixed(2)}/1` && /0\.60\/0/.test(res.slow) && res.recovered === `${res.max.toFixed(2)}/1` && !errs.length
    && (res.msaaSlow == null || res.msaaSlow === 0) && (res.msaaBack == null || res.msaaBack === (process.env.TIER === 'medium' ? 2 : process.env.TIER === 'low' ? 0 : 4));
  if (!ok) { console.log('FAIL'); process.exit(1); }
})();
