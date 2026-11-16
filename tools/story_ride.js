// Takes the car a story's frame sends (tools/story_play.js walks instead): from the frame before the last, waits for the
// car, gets in where it pulls up, rides to where it sets down, gets out; stills on the way. Exits 1 if it does not arrive.
//   python3 -m http.server 8800 --directory web &
//   node tools/story_ride.js out_dir     (on a real GPU: Chromium with ANGLE's Metal)
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '/tmp/story-ride';
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 750 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300), (e.stack || '').split('\n').slice(1, 3).join(' | ').slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); localStorage.setItem('oe-story-late', JSON.stringify({ fi: 5, left: 2, prints: [0,1,2,3,4].map(i => ({ src: null, stamp: 'f' + i, cap: '' })) })); } catch (e) {} });
  await p.goto('http://localhost:8800/?overture=0', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return window.__game && t && !t.hidden; }, null, { timeout: 300000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('gt-play').click());
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const pl = window.__game.player; pl.x = 498; pl.y = -1046; }); // (where the flight sets you down)
  let last = '';
  for (let i = 0; i < 80; i++) {
    await p.waitForTimeout(2000);
    const s = await p.evaluate(() => { const g = window.__game, pl = g.player, s = g.story.state; return { mode: pl.mode, x: +pl.x.toFixed(0), y: +pl.y.toFixed(0), beat: s.beat, toast: (document.querySelector('.g-toast, #g-toast') || {}).textContent || '', prompt: [...document.querySelectorAll('[id*=prompt]')].map(e => e.textContent).join('|').slice(0, 80) }; });
    const d = Math.hypot(s.x - 372.5, s.y + 1042.5), key = `${s.mode} ${s.prompt}`;
    if (key !== last || i % 8 === 0) { console.log(i, JSON.stringify(s).slice(0, 260)); last = key; await p.screenshot({ path: `${out}/r${String(i).padStart(2, '0')}.png` }); }
    const r = await p.evaluate(() => { const g = window.__game, r = g.story && null; return null; });
    const goal = await p.evaluate(() => document.querySelector('#g-story-goal span').textContent);
    if (/is here|at the kerb/.test(goal) && s.mode === 'foot') { await p.evaluate(() => { const g = window.__game, t = g.story.state.target, pl = g.player; if (t) { pl.x = t[0] + 2.2; pl.y = t[1] + 1.5; } }); await p.waitForTimeout(700); await p.keyboard.press('KeyE'); }
    if (s.mode === 'ride' && /Get out at/.test(s.prompt)) await p.keyboard.press('KeyE');
    if (s.mode === 'ride' && i % 3 === 0) await p.screenshot({ path: `${out}/d${String(i).padStart(2, '0')}.png` });
    if (i % 6 === 0) console.log('  goal:', goal, '| d', Math.round(d));
    if (s.mode === 'foot' && d < 40 && i > 10) break;
  }
  const end = await p.evaluate(() => { const g = window.__game; return [g.player.mode, g.story.state.beat]; });
  console.log('ended', end.join(' '));
  await b.close();
  process.exit(end[0] === 'foot' && end[1] !== 'ride' ? 0 : 1);
})();
