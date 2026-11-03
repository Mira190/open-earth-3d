// Stills of a city's opening shot (game.start.shot, #110): the crane from the title down to over the
// player's shoulder, through the game's own grade, then the first frame with control and 3 s after it.
// Frames: "title" (Play pressed), "crane" (1.4 s), "street" (2.8 s), "control" (the hand-over) and
// "after3"; with the HUD over it as the page shows it ("control-page"). Times as tools/start_shot.js:
// "11:00", "sunset+20", "night" (22:00).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/opening_shot.js shibuya out_dir [1440x900] [11:00,sunset+20,night]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = '.', size = '1440x900', times = '11:00'] = process.argv;
const [W, H] = size.split('x').map(Number);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const tag = W < 600 ? 'phone' : 'desk', logs = [], out = [];
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const t of times.split(',')) {
    const p = await b.newPage({ viewport: { width: W, height: H }, isMobile: W < 600, hasTouch: W < 600 });
    await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
    await p.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, opts) {
        return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
      };
    });
    p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
    const n = t.replace(/[:+]/g, '');
    const shot = async name => {
      await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `${city}-open-${n}-${name}-${tag}.png`), Buffer.from(png.split(',')[1], 'base64'));
    };
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    await p.evaluate(t => { // the light of the hour asked, set after Play (which sets the title's choice)
      const g = window.__game, c = g.clock, sun = /^sunset([+-]\d+)?$/.exec(t);
      const min = t === 'night' ? 22 * 60 : sun ? Math.round(g.dayLimits().sunset + (+sun[1] || 0)) : t.split(':').reduce((a, v, i) => a + (i ? +v : v * 60), 0);
      g.setClock(c.y, c.m, c.d, min);
    }, t);
    await shot('title');
    let at = 0;
    const until = async T => { const d = T - at; if (d > 0) await p.evaluate(d => { const g = window.__game; for (let s = 0; s < d - 1e-6; s += 0.1) g.advance(Math.min(0.1, d - s)); }, d); at = Math.max(at, T); };
    await until(1.4); await shot('crane');
    await until(2.8); await shot('street');
    const arrived = await p.evaluate(async () => { const g = window.__game; let t = 0; while (g.arriving() && t < 8) { g.advance(0.1); t += 0.1; } return t; });
    at += arrived;
    await shot('control');
    await p.screenshot({ path: path.join(outDir, `${city}-open-${n}-control-page-${tag}.png`) });
    const state = async () => p.evaluate(() => {
      const g = window.__game, pl = g.player, j = g.junctions.J.find(q => q.scramble && Math.hypot(q.x - pl.x, q.y - pl.y) < 80);
      return { t: +g.t().toFixed(1), ph: j ? `${j.ph}${j.st}` : null, walkers10: g.crowd.P.filter(q => q.line >= 0 && Math.hypot(q.x - pl.x, q.y - pl.y) < 10).length };
    });
    const s0 = await state();
    await until(at + 3); await shot('after3');
    out.push({ time: t, handover_s: +at.toFixed(1), control: s0, after3: await state() });
    await p.close();
  }
  console.log(JSON.stringify({ shots: out, errors: logs }));
  await b.close();
})();
