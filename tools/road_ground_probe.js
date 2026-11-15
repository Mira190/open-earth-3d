// Where a road's own heights and the ground drawn under it part: a car follows the road's line, so where the line
// lies under the drawn ground the car sinks into it, and where it lies above, the car floats.
//   node tools/road_ground_probe.js <city> [outDir]      (LEAN=1: a phone's page and its district; PORT)
// Every drivable line of the map, sampled each 3 m: its height against the walking terrain (nav.terrain) and
// against the ground mesh drawn there (a ray down through the fine tiles). Prints the worst places and takes a
// still of the worst one from behind a car's eye.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', outDir = '.'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const lean = !!process.env.LEAN;
  const ctx = await b.newContext(lean ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' } : { viewport: { width: 1100, height: 650 } });
  const p = await ctx.newPage();
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, lean ? 'low' : 'medium');
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await startPlay(p);
  await p.evaluate(async () => {
    const g = window.__game;
    for (let i = 0; i < 60 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine && g.cine.active) g.cine.skip();
    g.hold(true);
  });
  const res = await p.evaluate(() => {
    const g = window.__game, L = g.cars.netL, out = [], T = window.THREE;
    const info = { lines: L.length, keys: Object.keys(L[0] || {}).join(','), nav: Object.keys(g.nav).join(',') };
    let n = 0, over = 0, under = 0;
    for (let i = 0; i < L.length; i++) {
      const pts = L[i].pts; if (!pts) continue;
      for (let k = 0; k + 5 < pts.length; k += 3) {
        const ax = pts[k], ay = pts[k + 1], az = pts[k + 2], bx = pts[k + 3], by = pts[k + 4], bz = pts[k + 5], len = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.round(len / 3));
        for (let j = 0; j < m; j++) {
          const t = j / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, tz = g.nav.terrain(x, y), gb = g.nav.groundBelow(x, y, z + 0.6);
          n++;
          const d = z - tz;
          if (d < -0.25) under++; else if (d > 0.25 && Math.abs(z - gb) > 0.25) over++;
          if (Math.abs(d) > 0.25) out.push({ i, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(2), terrain: +tz.toFixed(2), below: +gb.toFixed(2), d: +d.toFixed(2), deck: L[i].deck || L[i].level || 0 });
        }
      }
    }
    out.sort((a, b) => a.d - b.d);
    return { info, n, under, over, lowest: out.slice(0, 25), highest: out.filter(o => Math.abs(o.z - o.below) > 0.25).slice(-15) };
  });
  console.log(JSON.stringify(res.info));
  console.log(`${res.n} samples; ${res.under} lie more than 0.25 m under the terrain; ${res.over} more than 0.25 m over it and over whatever is below`);
  for (const o of res.lowest) console.log('under', JSON.stringify(o));
  for (const o of res.highest) console.log('over ', JSON.stringify(o));
  fs.writeFileSync(path.join(outDir, `road-ground-${city}.json`), JSON.stringify(res));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
