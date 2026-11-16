// Plays a map's first story episode (web/game/story.js, ?story=1) and takes a still at each beat: the Stop,
// the goal a new player is given, the afterimage from a few metres, her line, the photograph she asks for, the world
// running on again and the last card. Prints the
// episode's state at each beat and the page's errors; exits 1 if a beat is not reached.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/story_shot.js shibuya out_dir [WxH]
// OVERTURE=1: with the map's overture before it, as a player has it (stills of the overture too, every few seconds)
// AUTO=1: as arrived from that link, without the globe (the game starts by itself, with its overture)
// FROM_GLOBE=1: from the story's link on the home page (?story=<map>): the globe, its button, the dive, the game starting by itself
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
  p.on('pageerror', e => { errors.push(String(e).slice(0, 300)); console.log('pageerror:', String(e).slice(0, 300), (e.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 400)); });
  require('fs').mkdirSync(out, { recursive: true });
  const state = () => p.evaluate(() => { const g = window.__game, s = g.story && g.story.state; return s ? { phase: s.phase, beat: s.beat, t: +s.t.toFixed(1), left: s.left, ghost: !!s.ghost, dog: s.dog ? `${s.dog.state} ${s.dog.clip} ${s.dog.x.toFixed(1)},${s.dog.y.toFixed(1)}` : null, player: [+g.player.x.toFixed(1), +g.player.y.toFixed(1)], mode: g.player.mode } : null; });
  const until = async (what, fn, arg, timeout = 900000) => { try { await p.waitForFunction(fn, arg, { timeout, polling: 500 }); return true; } catch (e) { console.log(`FAIL ${what}: not reached`, JSON.stringify(await state())); return false; } };
  // (a software renderer can take longer over one frame of an overture than a screenshot waits: a still missed is said, not fatal)
  const snap = async name => { try { await p.screenshot({ path: `${out}/${name}.png`, timeout: 150000 }); return true; } catch (e) { console.log(`(no still ${name}: ${String(e.message).split('\n')[0]})`); return false; } };
  const shot = async name => { await snap(name); console.log(name, JSON.stringify(await state())); };
  let ok = true;
  if (process.env.FROM_GLOBE) { // as a visitor has it: the story's link on the home page, the globe, one button, and on by itself
    await p.goto(`http://localhost:${process.env.PORT || 8800}/?story=${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForTimeout(9000);
    await snap('g1-globe');
    ok = await until('the story\'s button on the globe', () => !!document.getElementById('ts-begin'), null, 240000) && ok;
    await p.waitForTimeout(2500);
    await snap('g2-begin');
    await p.evaluate(() => { const b = document.getElementById('ts-begin'); if (b) b.click(); });
    await p.waitForTimeout(1500);
    await snap('g3-dive');
    ok = await until('the game opens from the globe', () => /^#play-/.test(location.hash) && window.__game && window.__game.flyover, null, 900000) && ok;
    await snap('g4-loading');
  } else if (process.env.AUTO) { // as arrived from the globe's story link, without the globe: no card, the overture, the episode
    await p.addInitScript(c => { try { sessionStorage.setItem('oe-story-auto', c); } catch (e) { /* storage blocked */ } }, city);
    await p.goto(`http://localhost:${process.env.PORT || 8800}/?story=${city}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  } else {
    await p.goto(`http://localhost:${process.env.PORT || 8800}/?story=1&overture=${process.env.OVERTURE ? 1 : 0}${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
    await startPlay(p, { asIs: true });
  }
  if (process.env.OVERTURE || process.env.FROM_GLOBE || process.env.AUTO) for (let i = 0; i < 10 && !(await p.evaluate(() => !!(window.__game && window.__game.story && !['idle', 'dressed'].includes(window.__game.story.state.phase)))); i++) { await p.waitForTimeout(25000); await snap(`0-overture-${i}`); }
  // (the opening crane over a wet street at night is the slowest stretch on a software renderer: a CI runner took over 15 minutes for it)
  ok = await until('the episode begins', () => window.__game.story && window.__game.story.state.phase !== 'idle' && window.__game.story.state.phase !== 'dressed', null, 1800000) && ok;
  ok = await until('the Stop', () => window.__game.story.state.phase === 'stop') && ok;
  await shot('1-stopped');
  // a new player is told what to do: the goal's line, its beacon's mark and the keys
  ok = await until('the goal is on screen', () => window.__game.story.state.beat === 'seek' && document.querySelector('#g-story-goal.on span').textContent.length > 8 && document.querySelector('#g-story-keys.on')) && ok;
  await p.waitForTimeout(1500);
  await shot('2-goal');
  const near = d => p.evaluate(d => { const g = window.__game, gh = g.story.state.ghost, pl = g.player; if (!gh) return false; const dx = pl.x - gh.x, dy = pl.y - gh.y, l = Math.hypot(dx, dy) || 1; pl.x = gh.x + dx / l * d; pl.y = gh.y + dy / l * d; pl.h = Math.atan2(-dx, -dy); if (g.cam) g.cam.yaw = pl.h; return true; }, d);
  // the guide: it waits where the data stands it, comes to you, then goes ahead of you to her and sits there
  // (its seconds are given to it here: a software renderer's frames are too few to wait for a dog to cross a square)
  const run = secs => p.evaluate(n => { const st = window.__game.story; for (let i = 0; i < n; i++) st.tick(0.1); }, Math.round(secs * 10));
  const dogIs = () => p.evaluate(() => { const g = window.__game, s = g.story.state, d = s.dog, gh = s.ghost, T = g.G.story.episodes[0].task; return d ? { state: d.state, clip: d.clip, toYou: Math.hypot(d.x - g.player.x, d.y - g.player.y), toHer: gh ? Math.hypot(d.x - gh.x, d.y - gh.y) : -1, youToHer: gh ? Math.hypot(g.player.x - gh.x, g.player.y - gh.y) : -1, toStand: T.stand ? Math.hypot(d.x - T.stand[0], d.y - T.stand[1]) : -1 } : null; });
  const guided = await p.evaluate(() => !!window.__game.G.story.episodes[0].guide);
  if (guided) {
    ok = await until('the guide is there', () => { const d = window.__game.story.state.dog; return d && d.ready; }, null, 240000) && ok;
    await run(16);
    let d = await dogIs();
    if (!(d.toYou < 9 && /lead|wait/.test(d.state))) { console.log('FAIL the guide did not come to the player', JSON.stringify(d)); ok = false; }
    await p.waitForTimeout(4000); await shot('2b-guide');
    await near(14); await run(5);
    d = await dogIs();
    if (!(d.toHer < d.youToHer)) { console.log('FAIL the guide is not ahead of the player on the way', JSON.stringify(d)); ok = false; }
    await p.waitForTimeout(4000); await shot('2c-led');
    await near(7); await run(9);
    d = await dogIs();
    if (!(d.state === 'sit' && d.toHer < 4)) { console.log('FAIL the guide did not sit down by her', JSON.stringify(d)); ok = false; }
  }
  // walk up to her: a few metres off first, then within reach
  if (await near(6.5)) { await p.waitForTimeout(5000); await shot('3-afterimage'); }
  await near(2.4);
  ok = await until('she speaks', () => { const d = document.getElementById('gd'); return d && !d.hidden; }, null, 180000) && ok;
  await p.waitForTimeout(4000);
  await shot('4-speaks');
  for (let i = 0; i < 14 && (await state()).beat === 'talk'; i++) { await p.keyboard.press('KeyE'); await p.waitForTimeout(2500); }
  // her task: the shutter is offered; away from the subject it asks to turn, towards it the frame is spent
  ok = await until('the camera is offered', () => window.__game.story.state.beat === 'shoot' && document.querySelector('#g-story-shutter.on')) && ok;
  const face = to => p.evaluate(to => { const g = window.__game, T = g.G.story.episodes[0].task.subject, pl = g.player, a = Math.atan2(T[0] - pl.x, T[1] - pl.y) + (to ? 0 : Math.PI); pl.h = a; if (g.cam) { g.cam.yaw = a; if ('pitch' in g.cam) g.cam.pitch = to ? -0.25 : 0.1; } }, to);
  await face(false);
  ok = await until('the lens turned away from the subject', () => !document.querySelector('#g-story-shutter.ready'), null, 240000) && ok; // (the chase camera comes round in its own time)
  await p.keyboard.press('KeyF'); await p.waitForTimeout(800);
  if ((await state()).left !== 7) { console.log('FAIL a picture taken with its back to the subject spent a frame'); ok = false; }
  await face(true);
  ok = await until('the lens on the subject', () => !!document.querySelector('#g-story-shutter.ready'), null, 240000) && ok;
  await p.waitForTimeout(3000); // (the line about turning has gone)
  if (guided) { await run(8); const d = await dogIs(); if (!(d.state === 'sit' && d.toStand < 1)) { console.log('FAIL the guide did not go to sit where the picture is taken from', JSON.stringify(d)); ok = false; } await p.waitForTimeout(3000); }
  await shot('5-finder');
  await p.keyboard.press('KeyF');
  ok = await until('the frame is spent', () => window.__game.story.state.left === 6 && !!window.__game.story.state.print, null, 60000) && ok;
  for (let i = 0; i < 12 && (await state()).phase === 'stop'; i++) { await p.waitForTimeout(2500); await p.keyboard.press('KeyE'); }
  ok = await until('the world runs on', () => window.__game.story.state.phase !== 'stop', null, 120000) && ok;
  await p.waitForTimeout(6000);
  await shot('6-after');
  if (guided) { await run(8); const d = await dogIs(); if (d.state !== 'away') { console.log('FAIL the guide is still there after the world runs on', JSON.stringify(d)); ok = false; } }
  await p.evaluate(() => window.__game.story.tick(12)); // (the seconds before the last card: a software renderer's are minutes)
  ok = await until('the last card, with two ways on', () => document.querySelectorAll('#g-story-end.on button[data-do]').length === 2, null, 240000) && ok;
  await p.waitForTimeout(2500);
  await shot('7-end');
  for (const e of errors) console.log('pageerror:', e);
  await b.close();
  console.log(ok && !errors.length ? 'ok   story: the episode plays through its beats' : 'FAIL story');
  process.exit(ok && !errors.length ? 0 : 1);
})().catch(e => { console.log(`FAIL ${e.message}`); process.exit(1); });
