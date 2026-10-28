// Evaluate a JS expression in a dev page after window.__ready and print the JSON result.
//   PORT=8811 NODE_PATH=$(npm root -g) node tools/page_eval.js "reef/lineup.html?still=1&gl=1" "window.rigs.length"
const { chromium } = require('playwright');
const [,, url, expr] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => console.log('console.' + m.type() + ':', m.text().slice(0, 500)));
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 500)));
  await p.goto('http://localhost:' + (process.env.PORT || 8800) + '/' + url);
  await p.waitForFunction('window.__ready', null, { timeout: 280000 });
  console.log(JSON.stringify(await p.evaluate(expr)));
  await b.close();
})();
