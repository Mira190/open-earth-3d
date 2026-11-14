// Stills of the title screen's menu as a visitor first sees it, at a chosen time of day, and the
// timings that matter on landing: the first frame of the Earth, the opening's start, the menu.
// Also prints the menu's order and what is in view (which marks are on screen and inside the
// first screenful), so a check can see that Japan leads and is framed.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/home_shot.js out_dir [WxH] [utc,utc,...] [--play] [--pick=N]
//     utc: ISO times for the sun (default now); --play also runs the whole opening in real time
//     instead of skipping it, so the menu is shot as the opening leaves it; --pick=N chooses the Nth place
//     on the list (from 0) first, so its card and the still of the place behind it are in the shot
// Writes out_dir/<W>x<H>-<utc>.png. Phones (W < 600) run at the low tier, others at high
// (TIER= to force one).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const play = process.argv.includes('--play');
const pick = (process.argv.find(a => a.startsWith('--pick=')) || '').slice(7);
const [outDir = 'home-shot', size = '1440x900', utcs = ''] = args;
const [w, h] = size.split('x').map(Number);
const phone = w < 600;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  fs.mkdirSync(outDir, { recursive: true });
  for (const at of (utcs || '').split(',')) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([tier, at, manual]) => {
      try { localStorage.setItem('oe3d-quality', tier); } catch (e) { /* storage blocked */ }
      if (manual) window.__titleManual = true;
      if (at) {
        const D = Date, shift = D.parse(at) - D.now();
        window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + shift])); } static now() { return D.now() + shift; } };
      }
    }, [process.env.TIER || (phone ? 'low' : 'high'), at, !play]);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const t0 = Date.now();
    await p.goto(`http://localhost:${process.env.PORT || 8800}/index.html`, { timeout: 120000 });
    await p.waitForFunction(() => window.__title, null, { timeout: 300000 });
    const tTitle = Date.now() - t0;
    await p.waitForFunction(() => ['gate', 'open', 'menu'].includes(window.__title.state), null, { timeout: 300000 });
    const tEarth = Date.now() - t0;
    if (!play) await p.evaluate(() => { if (window.__title.state === 'gate') window.__title.begin(false); window.__title.skip(); });
    await p.waitForFunction(() => window.__title.state === 'menu' && document.getElementById('globe-app').classList.contains('menu'), null, { timeout: 300000 });
    const tMenu = Date.now() - t0;
    await p.waitForTimeout(play ? 2500 : 4000); // the orbit settles
    if (pick) {
      const it = p.locator('.ts-item').nth(+pick);
      await (phone ? it.tap() : it.click());
      await p.waitForTimeout(5000); // the globe turns, the picture comes up
    }
    const info = await p.evaluate(([W, H]) => {
      const T = window.__title;
      const inView = el => { const r = el.getBoundingClientRect(); return !el.hidden && r.width > 0 && r.left >= 0 && r.right <= W && r.top >= 0 && r.bottom <= H && getComputedStyle(el).opacity !== '0'; };
      const mk = n => { const e = performance.getEntriesByName(n)[0]; return e ? Math.round(e.startTime) : null; };
      return {
        firstFrame: mk('oe:frame'), ready: mk('oe:ready'),
        order: T.dests.map(d => d.name),
        marks: T.dests.filter(d => inView(d.mark)).map(d => d.name),
        hero: [...document.querySelectorAll('.ts-menu [data-hero]')].filter(inView).map(e => e.textContent.trim().replace(/\s+/g, ' ')),
      };
    }, [w, h]);
    const file = path.join(outDir, `${w}x${h}-${(at || 'now').replace(/[:]/g, '')}${pick ? `-pick${pick}` : ''}.png`);
    await p.screenshot({ path: file, timeout: 240000 });
    console.log(JSON.stringify({ file, at, tTitle, tEarth, tMenu, ...info }));
    if (errors.length) console.log('errors:', errors.join(' | '));
    await ctx.close();
  }
  await b.close();
})();
