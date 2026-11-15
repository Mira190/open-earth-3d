// Plays a map's first story episode (web/game/story.js, ?story=1) and takes a still at each beat: the street
// running, the Stop, the afterimage from a few metres, her line, and the world running on again. Prints the
// episode's state at each beat and the page's errors; exits 1 if a beat is not reached.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/story_shot.js shibuya out_dir [WxH]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', out = '/tmp/story', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  require('fs').mkdirSync(out, { recursive: true });
  const state = () => p.evaluate(() => { const g = window.__game, s = g.story && g.story.state; return s ? { phase: s.phase, t: +s.t.toFixed(1), left: s.left, ghost: !!s.ghost, player: [+g.player.x.toFixed(1), +g.player.y.toFixed(1)], mode: g.player.mode } : null; });
  const until = async (what, fn, arg, timeout = 900000) => { try { await p.waitForFunction(fn, arg, { timeout, polling: 500 }); return true; } catch (e) { console.log(`FAIL ${what}: not reached`, JSON.stringify(await state())); return false; } };
  const shot = async name => { await p.screenshot({ path: `${out}/${name}.png` }); console.log(name, JSON.stringify(await state())); };
  let ok = true;
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?story=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p, { asIs: true });
  ok = await until('the episode begins', () => window.__game.story && window.__game.story.state.phase === 'lead') && ok;
  await until('the street runs a while', () => window.__game.story.state.t > 5 || window.__game.story.state.phase !== 'lead');
  await shot('1-running');
  ok = await until('the Stop', () => window.__game.story.state.phase === 'stop') && ok;
  await p.waitForTimeout(4000);
  await shot('2-stopped');
  // walk up to her: a few metres off first, then within reach
  const near = d => p.evaluate(d => { const g = window.__game, gh = g.story.state.ghost, pl = g.player; if (!gh) return false; const dx = pl.x - gh.x, dy = pl.y - gh.y, l = Math.hypot(dx, dy) || 1; pl.x = gh.x + dx / l * d; pl.y = gh.y + dy / l * d; pl.h = Math.atan2(-dx, -dy); if (g.cam) g.cam.yaw = pl.h; return true; }, d);
  if (await near(6.5)) { await p.waitForTimeout(5000); await shot('3-afterimage'); }
  await near(2.4);
  ok = await until('she speaks', () => { const d = document.getElementById('gd'); return d && !d.hidden; }, null, 180000) && ok;
  await p.waitForTimeout(6000);
  await shot('4-speaks');
  for (let i = 0; i < 12 && (await state()).phase === 'stop'; i++) { await p.keyboard.press('KeyE'); await p.waitForTimeout(2500); }
  ok = await until('the world runs on', () => window.__game.story.state.phase !== 'stop', null, 120000) && ok;
  await p.waitForTimeout(8000);
  await shot('5-after');
  for (const e of errors) console.log('pageerror:', e);
  await b.close();
  console.log(ok && !errors.length ? 'ok   story: the episode plays through its beats' : 'FAIL story');
  process.exit(ok && !errors.length ? 0 : 1);
})().catch(e => { console.log(`FAIL ${e.message}`); process.exit(1); });
