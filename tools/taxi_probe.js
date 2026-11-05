// Hail a taxi at your car's kerb, get in, and print the destinations the driver offers and what
// happens with each of the first few (for a city whose game check fails "drives off for").
//   xvfb-run -a node tools/taxi_probe.js <city>
const { chromium } = require('playwright');
const city = process.argv[2] || 'kyoto';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.waitForTimeout(3000);
  for (let pick = 0; pick < 3; pick++) {
    const r = await p.evaluate(pick => {
      const g = window.__game, c = g.myCar && g.myCar(), st = c && c.D.st;
      if (g.ride()) g.cancelRide();
      if (g.player.mode !== 'foot') g.exitCar();
      const k = g.KEEP === 'left' ? 1 : -1;
      g.player.x = st.x - Math.sin(st.h) * 12 - Math.cos(st.h) * 2.4 * k; g.player.y = st.y - Math.cos(st.h) * 12 + Math.sin(st.h) * 2.4 * k; g.player.z = st.z;
      g.advance(1); g.hail();
      const o = g.ride();
      if (!o) return { hailed: false };
      for (let t = 0; t < 150 && o.phase === 'coming'; t += 0.5) g.advance(0.5);
      g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      const choices = [...document.querySelectorAll('#gd-choices button')].map(b => b.textContent);
      g.dlg.choose(pick);
      g.advance(1);
      return { at: [o.drv.st.x, o.drv.st.y].map(v => +v.toFixed(0)), choices, picked: choices[pick], dest: o.dest && o.dest.name, phase: o.phase, toast: document.getElementById('g-toasts').textContent.slice(-160) };
    }, pick);
    console.log(JSON.stringify(r));
  }
  await b.close();
})();
