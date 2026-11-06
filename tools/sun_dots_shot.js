// Stills of a place's sun sample dots, as the Sun access table shows them when a row is clicked.
// On the winter solstice, at noon and at 16:00.
// node tools/sun_dots_shot.js <city> "<place>" <outDir> [width height]   (run under xvfb-run -a)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [,, city = 'queenstown', place = 'Marine Parade Reserve', outDir = '.', W = '1440', H = '900'] = process.argv;
const PORT = process.env.PORT || 8800;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${PORT}/#${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000 });
  await p.keyboard.press('Shift');
  await p.evaluate(() => window.__city.setTourPlaying(false));
  for (const [tag, time] of [['noon', 720], ['afternoon', 960]]) {
    await p.evaluate(([pl, t]) => {
      const C = window.__city, i = C.placeInfo.findIndex(q => q.name === pl);
      C.setDate(C.state.y, 6, 21); C.setTime(t);
      document.querySelectorAll('#places tbody tr')[i].click();
    }, [place, time]);
    await p.waitForTimeout(6000);
    const has = await p.evaluate(() => window.__city.world.children.some(o => o.isPoints && o.userData.name));
    await p.screenshot({ path: path.join(outDir, `${city}-${tag}-${W}.jpg`), quality: 85, timeout: 180000 });
    console.log(tag, 'dots shown:', has);
  }
  await b.close();
})();
