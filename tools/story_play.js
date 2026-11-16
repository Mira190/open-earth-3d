// Plays a story's episode from the title to its last card, frame by frame, as a player who knows the way would:
// to each of the living, through what they say and ask, to where the world stops, to the afterimage, to the
// standpoint, the photograph, and on. It walks by being put there (the way between places is not what it checks),
// takes a still at each beat, prints the state at each, and exits 1 if the last card is not reached or the page throws.
//   python3 -m http.server 8800 --directory web &
//   node tools/story_play.js out_dir [WxH]          (GPU=metal on a Mac; under xvfb-run -a elsewhere)
// FROM=6: from the last frame only. LIMIT=seconds: how long the whole play may take.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, out = '/tmp/story-play', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const args = process.env.GPU === 'metal' ? ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu']
    : process.env.DISPLAY ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] : ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 500, isMobile: w < 500 });
  const errors = [];
  p.on('pageerror', e => { errors.push(String(e)); console.log('pageerror:', String(e).slice(0, 300), (e.stack || '').split('\n').slice(1, 3).join(' | ').slice(0, 300)); });
  p.on('response', r => { if (r.status() >= 400) console.log('http', r.status(), r.url()); });
  fs.mkdirSync(out, { recursive: true });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  // FROM=n: as a case left at frame n (counted from 0) and opened again
  if (process.env.FROM) await p.addInitScript(n => { try { localStorage.setItem('oe-story-late', JSON.stringify({ fi: n, left: 7 - n, prints: Array.from({ length: n }, (_, i) => ({ src: null, stamp: `frame ${i + 1}`, cap: '' })) })); } catch (e) { /* storage blocked */ } }, +process.env.FROM);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.Q || ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return window.__game && t && !t.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForTimeout(2000);
  const snap = async name => { try { await p.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); } catch (e) { console.log(`(no still ${name})`); } };
  await snap('00-title');
  await p.evaluate(() => document.getElementById('gt-play').click());
  const state = () => p.evaluate(() => { const g = window.__game, s = g.story.state, d = document.getElementById('gd'); return { phase: s.phase, beat: s.beat, fi: s.fi, t: +s.t.toFixed(1), left: s.left, dlg: d && !d.hidden, choices: [...document.querySelectorAll('#gd-choices button')].map(x => x.textContent), goal: document.querySelector('#g-story-goal span').textContent, at: [+g.player.x.toFixed(1), +g.player.y.toFixed(1), +g.player.z.toFixed(1)] }; });
  // put the player a little short of a place, facing it
  const goTo = (at, d = 1.6) => p.evaluate(([at, d]) => { const g = window.__game, pl = g.player; let dx = pl.x - at[0], dy = pl.y - at[1], l = Math.hypot(dx, dy); if (l < 0.5 || l > 60) { dx = 1; dy = 0; l = 1; } pl.x = at[0] + dx / l * d; pl.y = at[1] + dy / l * d; if (at[2] != null) pl.z = at[2] + 0.2; pl.h = Math.atan2(-dx, -dy); if (g.cam) g.cam.yaw = pl.h; }, [at, d]);
  const face = at => p.evaluate(at => { const g = window.__game, pl = g.player; pl.h = Math.atan2(at[0] - pl.x, at[1] - pl.y); if (g.cam) { g.cam.yaw = pl.h; g.cam.pitch = 0.25; } }, at);
  const seen = new Set();
  const mark = async (s, name) => { const k = `${s.fi}-${name}`; if (seen.has(k)) return; seen.add(k); console.log(k, JSON.stringify(s)); await p.waitForTimeout(1200); await snap(`${s.fi + 1}-${name}`); };
  const t0 = Date.now(); let done = false, last = '', same = 0;
  while (Date.now() - t0 < (+process.env.LIMIT || 1500) * 1000) {
    const s = await state();
    if (s.phase === 'done') { done = true; break; }
    const key = `${s.phase}/${s.beat}/${s.fi}/${s.dlg}`; same = key === last ? same + 1 : 0; last = key;
    if (same > 240) { console.log('FAIL stuck', JSON.stringify(s)); break; }
    if (s.dlg) {
      await mark(s, `said-${s.phase}-${s.beat}`);
      if (s.choices.length) await p.evaluate(() => { const st = window.__game.story.state, q = st.fr.meet.ask[st.asked], want = q.options[q.answer]; const bt = [...document.querySelectorAll('#gd-choices button')].find(x => x.textContent.endsWith(want)); (bt || document.querySelector('#gd-choices button')).click(); });
      else await p.keyboard.press('KeyE');
      await p.waitForTimeout(350); continue;
    }
    if (s.phase === 'go' && s.beat === 'meet') { const at = await p.evaluate(() => { const t = window.__game.story.state.target; return t ? [t[0], t[1], t[3]] : null; }); if (at) await goTo(at, 1.8); }
    else if (s.phase === 'go' && s.beat === 'approach') { const at = await p.evaluate(() => { const st = window.__game.story.state, fr = st.fr, a = fr.stop_at || (fr.afterimage && fr.afterimage.at); return fr.lead_s != null && !st.late ? null : a; }); if (at) await goTo(at, 4); }
    else if (s.phase === 'stop' && s.beat === 'seek') { const at = await p.evaluate(() => { const g = window.__game.story.state.ghost; return g ? [g.x, g.y, g.z] : null; }); await mark(s, 'stop'); if (at) { await goTo(at, 6); await p.waitForTimeout(800); await snap(`${s.fi + 1}-afterimage`); await goTo(at, 2.2); } }
    else if (s.phase === 'stop' && s.beat === 'shoot') {
      const T = await p.evaluate(() => { const st = window.__game.story.state, T = st.fr.task; return { stand: T.stand || null, subject: T.subject || null, both: !!T.both, a: st.ghost && [st.ghost.x, st.ghost.y], b: st.ghost2 && [st.ghost2.x, st.ghost2.y] }; });
      if (T.stand) await goTo(T.stand, 0.6);
      if (T.both) { const m = [(T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2], n = [-(T.b[1] - T.a[1]), T.b[0] - T.a[0]], l = Math.hypot(...n); await goTo([m[0] + n[0] / l * 30, m[1] + n[1] / l * 30], 0); await face(m); }
      else if (T.subject) await face(T.subject);
      await p.waitForTimeout(1500); await mark(s, 'aimed');
      await p.evaluate(() => window.__game.story.shoot());
    } else if (s.phase === 'stop' && s.beat === 'meeting') await mark(s, 'meeting');
    else if (s.phase === 'after') await mark(s, 'after');
    await p.waitForTimeout(500);
  }
  if (done) { await p.waitForTimeout(3000); await snap('end'); console.log('end', JSON.stringify(await state())); }
  else console.log('FAIL the last card was not reached', JSON.stringify(await state()));
  console.log(`played in ${Math.round((Date.now() - t0) / 1000)} s; page errors: ${errors.length}`);
  await b.close();
  process.exit(done && !errors.length ? 0 : 1);
})();
