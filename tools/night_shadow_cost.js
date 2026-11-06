// What the sun's shadow map costs at night (issue 201 item 4). The sun stays a light below the horizon
// after dark, so that sunset and sunrise recompile nothing, and every lit fragment still samples its
// shadow map. This opens the game at night, holds the camera and the world still, and times the frames
// with the sun casting its shadow, then without (after the recompile that takes), then with it again.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/night_shadow_cost.js sydney [hh:mm, 23:00] [seconds a pass, 12]
// TIER=medium (default) forces a quality tier. Software WebGL (llvmpipe) gives an upper bound: its
// fragments cost far more than a GPU's, and the share is what to read.
const { chromium } = require('playwright');
const [,, city = 'sydney', at = '23:00', secs = '12'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 600) }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'medium');
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && !document.querySelector('#g-title').hidden && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  await p.evaluate(() => document.querySelector('#gt-play').click());
  await p.waitForTimeout(15000); // the arrival
  const [hh, mm] = at.split(':').map(Number);
  await p.evaluate(min => { const g = window.__game, c = g.clock; g.setClock(c.y, c.m, c.d, min); g.hold(true); }, hh * 60 + mm);
  await p.waitForTimeout(6000);
  const pass = async label => p.evaluate(async ([label, secs]) => {
    const fr = [];
    await new Promise(res => { const t0 = performance.now(); const f = t => { fr.push(t); if (t - t0 < secs * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const d = []; for (let i = 1; i < fr.length; i++) d.push(fr[i] - fr[i - 1]);
    d.sort((a, b) => a - b);
    return { label, frames: d.length, mean: +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1), median: +d[d.length >> 1].toFixed(1) };
  }, [label, +secs]);
  const sun = on => p.evaluate(on => {
    let n = 0;
    window.__game.Wd.world.traverse(o => { if (o.isDirectionalLight && (o.castShadow || o.userData.wasShadow)) { o.userData.wasShadow = true; o.castShadow = on; n++; } });
    return n;
  }, on);
  const out = [];
  out.push(await pass('shadow on'));
  const lights = await sun(false);
  await p.waitForTimeout(20000); // (the recompile)
  out.push(await pass('shadow off'));
  await sun(true);
  await p.waitForTimeout(20000);
  out.push(await pass('shadow on again'));
  const on = (out[0].median + out[2].median) / 2, off = out[1].median;
  console.log(JSON.stringify({ city, at, tier: process.env.TIER || 'medium', lights, passes: out, costMs: +(on - off).toFixed(1), share: +((on - off) / on * 100).toFixed(1), errors }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
