// The game as a player gets it after the map's overture, which the other still tools never play: the page
// is loaded with ?overture=1, Play is pressed, the overture is skipped after `skip` seconds (or left to
// play out, skip=0), at the place's time now or at one of the title card's hours, and a screenshot of the page is taken a few seconds after the game has the camera.
// Prints the lens's trim, the weather and the clock then: anything the overture left behind shows here.
//   xvfb-run -a node tools/overture_after.js shibuya out_dir [skip seconds] [now|morning|noon|night|...] [WxH]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const [,, city = 'shibuya', outDir = '.', skip = '4', time = '', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?overture=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout: 600000, polling: 250 });
  if (time) await p.evaluate(t => { const b = document.querySelector(`#gt-timechoice [data-t="${t}"]`); if (b) b.click(); }, time);
  await startPlay(p, { asIs: true });
  const state = () => p.evaluate(() => {
    const g = window.__game, o = g.overture(), lens = g.atmos && g.atmos.lens;
    return { overture: !!(o && o.active), variant: o && o.variant, trim: lens && lens.trim, weather: g.weather && g.weather.state, clock: `${Math.floor(g.clock.min / 60)}:${String(Math.floor(g.clock.min % 60)).padStart(2, '0')}`, scale: g.clock.scale, frozen: g.clock.frozen };
  });
  await p.waitForTimeout(1500);
  console.log('playing', JSON.stringify(await state()));
  if (+skip > 0) {
    await p.waitForTimeout(+skip * 1000);
    await p.screenshot({ path: `${outDir}/${city}-overture.png` });
    await p.keyboard.press('Space');
  }
  await p.waitForFunction(() => { const o = window.__game.overture(); return !o || !o.active; }, null, { timeout: 900000, polling: 500 });
  await p.waitForTimeout(6000);
  console.log('after', JSON.stringify(await state()));
  await p.screenshot({ path: `${outDir}/${city}-after.png` });
  for (const l of [...new Set(logs)].slice(0, 20)) console.log(l);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
