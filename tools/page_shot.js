// Screenshot any dev page under web/ headlessly (software WebGL2). Like reef_shot.js but takes the page path:
//   NODE_PATH=$(npm root -g) node tools/page_shot.js "reef/lineup.html?still=1&gl=1&roles=player" out.png [waitMs] [WxH]
// Waits for window.__ready; prints console errors and '[test]' lines.
const { chromium } = require('playwright');
const [,, url, out, wait = '1500', size = '960x540'] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const [w, h] = size.split('x').map(Number);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  p.on('console', m => { const t = m.type(); if (['error', 'warning'].includes(t) || m.text().startsWith('[test]')) logs.push(t + ': ' + m.text().slice(0, 700)); });
  p.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 700)));
  await p.goto('http://localhost:' + (process.env.PORT || 8800) + '/' + url);
  try { await p.waitForFunction('window.__ready || (document.getElementById("err") && document.getElementById("err").textContent)', null, { timeout: 280000 }); } catch (e) { logs.push('timeout waiting ready'); }
  await p.waitForTimeout(Number(wait));
  await p.screenshot({ path: out });
  console.log(logs.slice(0, 40).join('\n'));
  await b.close();
})();
