// What the lights that are dark cost (issue 352): every light in the scene is in every lit shader whatever its
// intensity (the car's headlamp and the helicopter's searchlight by day, the night's fill, the screens' area lights),
// because three.js builds a program for the number of lights of each kind, not for the ones that shine. This
// measures a city's game on foot with the lights as they are, then with every light of intensity 0 taken out of the
// scene (visible = false: the programs are rebuilt without them), and prints the lights by kind and the median
// frame time of each. On a software renderer the times compare the two; they are not a GPU's.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/light_cost.js shibuya [frames] [WxH]      TIER=high|medium|low, TIME=HH:MM (13:00)
// HIDE=RectAreaLight takes every light of that kind out instead (what the screens' area lights cost while they shine).
const { chromium } = require('playwright');
const [,, city = 'shibuya', frames = '12', size = '1440x900'] = process.argv;
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
    for (let k = 0; k < 10 && (!g.arriving || !g.arriving()); k += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let i = 0; i < 40 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine && g.cine.active) g.cine.skip();
    const O = window.OEOnboard, tour = O && O.current && O.current(); if (tour) tour.skip();
    g.hold(true);
  }, process.env.TIME || '13:00');
  await p.waitForTimeout(5000);
  const out = await p.evaluate(async ([n, hide]) => {
    const g = window.__game, world = g.atmos.composer.passes[0].scene, gl = g.atmos.composer.renderer.getContext();
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const med = async () => { const a = []; for (let i = 0; i < 4; i++) await frame(); for (let i = 0; i < n; i++) { const t = performance.now(); await frame(); gl.finish(); a.push(performance.now() - t); } return +a.sort((x, y) => x - y)[n >> 1].toFixed(0); };
    const lights = []; world.traverse(o => { if (o.isLight) lights.push(o); });
    const kinds = {}; for (const l of lights) { const k = `${l.type}${l.intensity > 0 && l.visible ? '' : ' (dark)'}`; kinds[k] = (kinds[k] || 0) + 1; }
    const res = { kinds, withDark: await med() };
    const dark = lights.filter(l => l.visible && (hide ? l.type === hide : !(l.intensity > 0)));
    res.out = dark.length; res.peak = Math.max(0, ...dark.map(l => l.intensity));
    for (const l of dark) l.visible = false;
    for (let i = 0; i < 12; i++) await frame(); // (the programs rebuilt)
    res.withoutDark = await med();
    for (const l of dark) l.visible = true;
    for (let i = 0; i < 12; i++) await frame();
    res.withDarkAgain = await med();
    return res;
  }, [+frames, process.env.HIDE || '']);
  console.log(city, process.env.TIER || 'high', process.env.TIME || '13:00', JSON.stringify(out), errs.length ? `errors: ${errs.join(' | ')}` : '');
  await b.close();
})();
