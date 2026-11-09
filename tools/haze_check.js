// The haze at the model's edge as world.js works it out on the CPU (hazeOf, issue 327), against the same twelve
// pixels of the sky drawn on the GPU and read back: for suns from night to noon all round, clear and under cloud.
// Fails when any colour is off by more than 2% of its brightness (and a little absolute, for the night's).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/haze_check.js [city, default shibuya]
const { chromium } = require('playwright');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 640, height: 400 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__game && document.querySelector('#g-loader').hidden, null, { timeout: 600000, polling: 500 });
  const res = await p.evaluate(() => {
    const Wd = window.__game.Wd, su = Wd.su, out = [], RAD = Math.PI / 180, cov0 = su.cloudCoverage ? su.cloudCoverage.value : 0;
    for (const cov of su.cloudCoverage ? [0, 0.6] : [0]) {
      if (su.cloudCoverage) su.cloudCoverage.value = cov;
      for (const alt of [-14, -8, -4, -1, 0.5, 3, 8, 20, 45, 70]) for (const azd of [10, 100, 190, 280]) {
        Wd.setSun({ altitude: alt, azimuth: azd });
        const a = Wd.hazeProbe.cpu(azd * RAD), g = Wd.hazeProbe.gpu(azd * RAD);
        const err = a && g ? Math.max(...['r', 'g', 'b'].map(k => Math.abs(a[k] - g[k]) / (Math.max(a.r, a.g, a.b, g.r, g.g, g.b) * 0.02 + 2e-4))) : Infinity;
        out.push({ cov, alt, azd, err, cpu: a && [a.r, a.g, a.b].map(v => +v.toFixed(5)), gpu: g && [g.r, g.g, g.b].map(v => +v.toFixed(5)) });
      }
    }
    if (su.cloudCoverage) su.cloudCoverage.value = cov0;
    return out;
  });
  await b.close();
  const bad = res.filter(r => !(r.err <= 1));
  for (const r of res) if (process.env.ALL || !(r.err <= 1)) console.log(`clouds ${r.cov} sun ${r.alt}° at ${r.azd}°: cpu ${r.cpu} gpu ${r.gpu} (${r.err.toFixed(2)} of the tolerance)`);
  console.log(`${city}: ${res.length - bad.length} of ${res.length} hazes match the GPU's; the worst at ${Math.max(...res.map(r => r.err)).toFixed(2)} of the tolerance`);
  if (errors.length) console.log('page errors:', errors);
  process.exit(bad.length || errors.length ? 1 : 0);
})();
