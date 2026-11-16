// Stills for the loading screen (web/assets/story/<episode>/key-N.webp are made from them): the episode's opening
// and its flight, filmed at 1920x1080 with every word and bar taken off the picture.
//   python3 -m http.server 8800 --directory web &
//   node tools/key_art.js out_dir          (on a real GPU: Chromium with ANGLE's Metal; GPU=gl under xvfb elsewhere)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2] || '/tmp/key-art';
  fs.mkdirSync(out, { recursive: true });
  const args = process.env.GPU === 'gl' ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] : ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu'];
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args });
  const bare = `.ov-title, .ov-cap, .ov-skip, [id^="g-story-"], .g-hud, .g-toasts, #g-toasts, .g-prompt { display: none !important; } .game-stage.letterbox::before, .game-stage.letterbox::after { display: none !important; } .game-stage.letterbox canvas { inset: 0 !important; height: 100% !important; top: 0 !important; }`;
  for (const [name, from, times] of [['open', 0, [3500, 7500, 14500]], ['flight', 4, [3200, 9000, 13000, 16500]]]) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
    await p.addInitScript(([from]) => { try { localStorage.setItem('oe3d-quality', 'high'); if (from) localStorage.setItem('oe-story-late', JSON.stringify({ fi: from, left: 7 - from, prints: Array.from({ length: from }, (_, i) => ({ src: null, stamp: 'f' + i, cap: '' })) })); } catch (e) { /* storage blocked */ } }, [from]);
    await p.goto(`http://localhost:${process.env.PORT || 8800}/${from ? '?overture=0' : ''}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { const t = document.getElementById('g-title'); return window.__game && t && !t.hidden; }, null, { timeout: 600000 });
    await p.waitForTimeout(1500);
    await p.addStyleTag({ content: bare });
    await p.evaluate(() => document.getElementById('gt-play').click());
    let t0 = 0;
    for (let i = 0; i < times.length; i++) { await p.waitForTimeout(times[i] - t0); t0 = times[i]; await p.screenshot({ path: `${out}/${name}-${i}.png` }); console.log(name, i); }
    await p.close();
  }
  await b.close();
})();
