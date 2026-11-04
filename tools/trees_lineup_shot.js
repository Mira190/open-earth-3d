// A still of web/trees-lineup.html: the shared trees in a row as the game draws them.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/trees_lineup_shot.js out.png "species=pine,sugi&date=11,28" [WxH]
const { chromium } = require('playwright');
const [,, out = 'lineup.png', query = '', size = '1600x700'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/trees-lineup.html?${query}`);
  await p.waitForFunction('window.__frames > 8', null, { timeout: 180000 });
  await p.screenshot({ path: out });
  const err = await p.$eval('#err', e => e.textContent);
  if (err || errs.length) console.log(err, errs.join('\n'));
  await b.close();
})();
