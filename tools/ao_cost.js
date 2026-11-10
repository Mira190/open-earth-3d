// What the game's contact shadows (web/game/ao.js) cost: the mean frame time in a city's game at
// each AO level (off, lite, full), on the same view, the tier forced (high unless TIER is set).
// On a software renderer the numbers say how the levels compare, not what a GPU takes. Then the
// frame-time governor's ceiling on it (quality.js: extras 1, 0.5, 0) must take it to lite, to off and
// back. Exits 1 if it does not or the page throws.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/ao_cost.js shibuya [frames] [WxH]
const { chromium } = require('playwright');
const [,, city = 'shibuya', frames = '40', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.atmos', null, { timeout: 600000 });
  await p.waitForTimeout(8000);
  const out = await p.evaluate(async n => {
    const g = window.__game, ao = g.atmos.ao, res = {};
    if (!ao) return { ao: 'none on this tier' };
    const top = ao.level;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    for (const lv of [0, 1, 2, 0]) {
      ao.set(lv);
      for (let i = 0; i < 5; i++) await frame();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) await frame();
      res[`level ${lv}${res[`level ${lv}`] ? ' again' : ''}`] = +((performance.now() - t0) / n).toFixed(1);
    }
    // the governor's ceiling: full with every extra, lite at half of them, off with none, and back
    const seen = [2, 1, 0, 2].map(v => { ao.limit(v); return ao.level; });
    res.limit = seen.join('');
    res.budget = res.limit === `${Math.min(2, top)}${Math.min(1, top)}0${Math.min(2, top)}` ? 'ok' : 'FAIL';
    return res;
  }, +frames);
  console.log(JSON.stringify(out), errs.length ? `errors: ${errs.join(' | ')}` : '');
  await b.close();
  if (out.budget !== 'ok' || errs.length) process.exit(1);
})();
