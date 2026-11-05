// Watch every scramble a city has through two cycles of its signals (tools/scramble_step.js, which
// tools/game_check.js runs for the city's principal one): its walk phase, lights and walk signals,
// its crowd surging across and the diagonals, nobody out on the road in the traffic's turns and no
// car among them. Prints one line per check; exits 1 on failure.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/scramble_check.js shinjuku    # llvmpipe; without xvfb-run, SwiftShader
const { chromium } = require('playwright');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.waitForSelector('#gt-play', { state: 'visible', timeout: 60000 }).catch(() => null);
  if (play) await play.click({ timeout: 10000 }).catch(() => p.evaluate(() => document.getElementById('gt-play').click()));
  await p.evaluate(() => window.__game.advance(1));
  let fails = 0;
  const res = await require('./scramble_step')(p, { all: true });
  for (const r of res) for (const [ok, what] of r.checks) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; }
  if (!res.length) console.log(`${city} has no scramble`);
  for (const e of errs) { console.log(`pageerror: ${e}`); fails++; }
  await b.close();
  process.exit(fails ? 1 : 0);
})();
