// Runs the page's own frame-cost scan (web/game/perf.js, ?perf) and prints its table: here to see that it runs through;
// its numbers mean something on the device a player has.
//   xvfb-run -a node tools/perf_scan.js shibuya [Q=story=1]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1001, height: 894 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  let bad = 0;
  p.on('pageerror', e => { bad++; console.log(`pageerror: ${String(e).slice(0, 300)}`); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?perf=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p, { asIs: true });
  await p.waitForFunction(() => { const e = document.getElementById('g-perf'); return e && /Sent with/.test(e.textContent); }, null, { timeout: 2400000, polling: 2000 });
  console.log(await p.evaluate(() => document.getElementById('g-perf').textContent));
  if (process.argv[3]) await p.screenshot({ path: process.argv[3] });
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
