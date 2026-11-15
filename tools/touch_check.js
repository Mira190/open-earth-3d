// A phone's game, played by touch: nothing on the screen names a key, and what a key does a thumb can do.
//   node tools/touch_check.js <city> [outDir]      (PORT: the server's port, 8800)
// An iPhone's page (a 390 x 844 view at 3x, touch, the low tier): the canvas is drawn at two device pixels to the
// CSS pixel; no <kbd> is shown in play and a message that names keys comes out naming buttons; at the kerb the
// prompt's "Hail a taxi" is a button and a tap on it brings a taxi; at the wheel the pad is the car's (Horn, Hand
// brake, Auto) and "Back on the road" and "Get out" are taps; two fingers on the picture zoom; and the taxi is
// ridden as a passenger (one row of buttons, the readout across the screen, the car on the road's surface, Skip
// and "Get out" by a tap). Stills of the kerb, the ride and the car go to outDir.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', outDir = '.'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await startPlay(p);
  await p.evaluate(async () => {
    const g = window.__game;
    for (let i = 0; i < 60 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine && g.cine.active) g.cine.skip();
    if (g.lateReady) await g.lateReady();
  });
  const frames = n => p.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  await frames(4);

  const page = await p.evaluate(() => {
    const cv = document.querySelector('#game-stage canvas'), st = document.getElementById('game-stage');
    const shown = [...st.querySelectorAll('kbd')].filter(k => k.id !== 'gp-key' && k.getClientRects().length).map(k => `${k.textContent} in ${(k.closest('[id]') || st).id}`);
    window.OEHud.toast('At the kerb <kbd>Y</kbd> hails. <kbd>E</kbd> gets in, <kbd>F</kbd> skips, <kbd>M</kbd> the map.');
    const t = document.querySelector('#g-toasts .g-toast:last-child');
    return { touch: document.documentElement.classList.contains('oe-touch'), pad: !document.getElementById('g-touch').hidden, w: cv.width, h: cv.height, cw: st.clientWidth, ch: st.clientHeight, shown, toast: t ? t.innerHTML : '' };
  });
  check(page.touch && page.pad, 'the page knows it is played by touch: the stick and the buttons are up');
  check(page.w / page.cw >= 1.9, `the canvas is drawn at two device pixels to the CSS pixel (${page.w} x ${page.h} for ${page.cw} x ${page.ch})`);
  check(page.shown.length === 0, `no key is named on the screen in play (${page.shown.join(', ') || 'none'})`);
  check(!/<kbd>/.test(page.toast) && /Hail a taxi/.test(page.toast) && /Skip/.test(page.toast) && /Map/.test(page.toast), `a message names buttons, not keys ("${page.toast.replace(/<[^>]+>/g, '')}")`);

  // at the kerb beside your parked car: the prompt offers a taxi, and a tap hails it
  const kerb = await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return { none: true };
    const st = c.D.st, k = g.KEEP === 'left' ? 1 : -1;
    if (g.player.mode !== 'foot') g.exitCar();
    g.player.x = st.x - Math.sin(st.h) * 12 - Math.cos(st.h) * 2.4 * k; g.player.y = st.y - Math.cos(st.h) * 12 + Math.sin(st.h) * 2.4 * k; g.player.z = st.z;
    g.advance(1);
    return { hint: !!g.kerbAction() };
  });
  if (kerb.none) check(true, 'no car of your own on this map: the kerb and the wheel are not played');
  else {
    await frames(6);
    const alt = await p.evaluate(() => { const a = document.getElementById('gp-alt'), r = a.getBoundingClientRect(); return { shown: !a.hidden && r.width > 0, text: document.getElementById('gp-alt-text').textContent.trim(), h: r.height, w: r.width }; });
    await p.screenshot({ path: path.join(outDir, `touch-${city}-kerb.png`) });
    check(kerb.hint && alt.shown && alt.text === 'Hail a taxi' && alt.h >= 40, `at the kerb the prompt's button reads "${alt.text}", ${Math.round(alt.w)} x ${Math.round(alt.h)} px`);
    if (alt.shown) await p.tap('#gp-alt');
    await frames(4);
    const hailed = await p.evaluate(() => { const o = window.__game.ride(); return o ? o.phase : null; });
    check(!!hailed, `a tap on it hails a taxi (${hailed || 'no ride'})`);

    // the ride as a passenger: the stick put away, the readout over one row of buttons, the car on the road it drives,
    // Skip and "Get out" by a tap
    const rode = await p.evaluate(async () => {
      const g = window.__game, o = g.ride(), frame = () => new Promise(r => requestAnimationFrame(r));
      if (!o) return null;
      for (let t = 0; t < 240 && o.phase === 'coming'; t += 0.5) g.advance(0.5);
      if (o.phase !== 'waiting') return { phase: o.phase };
      const st = o.drv.st;
      g.player.x = st.x + Math.cos(st.h) * 1.8; g.player.y = st.y - Math.sin(st.h) * 1.8; g.player.z = st.z;
      g.advance(0.2); g.boardRide();
      for (let i = 0; i < 16 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
      if (!g.dlg.hasChoices) return { phase: `no choice of where to go (${g.player.mode}, ${o.phase})` };
      g.dlg.choose(0);
      g.advance(1);
      let worst = 0, at = null, n = 0;
      for (let t = 0; t < 12 && o.phase === 'driving'; t += 0.25) {
        g.advance(0.25);
        const f = g.nav.floorAt(st.x, st.y, st.z + 1.6), d = f ? st.z - f.z : 0;
        n++; if (Math.abs(d) > Math.abs(worst)) { worst = d; at = [Math.round(st.x), Math.round(st.y)]; }
      }
      await frame(); await new Promise(r => setTimeout(r, 700)); await frame();
      const box = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return e.hidden || !r.width ? null : r; };
      const vh = box('g-vhud'), pad = [box('gt-cam'), box('gt-down'), box('gt-act')], pr = box('g-prompt');
      return { phase: o.phase, mode: g.player.mode, dest: o.dest && o.dest.name, worst, at, n, joy: !!box('gt-joy'), jump: !!box('gt-jump'), run: !!box('gt-run'), lens: !!box('gt-lens'),
        down: document.getElementById('gt-down').textContent.trim(), row: pad.every(b => b) && Math.abs(pad[0].top - pad[2].top) < 2 && Math.abs(pad[1].top - pad[2].top) < 2,
        clear: !!vh && pad.every(b => b && vh.bottom <= b.top + 1) && (!pr || pr.bottom <= vh.top + 1), wide: vh ? vh.width : 0 };
    });
    if (!rode || rode.mode !== 'ride') check(false, `the taxi comes and you ride it (${JSON.stringify(rode)})`);
    else {
      await p.screenshot({ path: path.join(outDir, `touch-${city}-ride.png`) });
      check(!rode.joy && !rode.jump && !rode.run && !rode.lens && rode.down === 'Skip' && rode.row, `a passenger's pad is one row (View, ${rode.down}, E), the stick put away, on the way to ${rode.dest}`);
      check(rode.clear && rode.wide > 300, `the ride's readout lies across the screen (${Math.round(rode.wide)} px), clear of the buttons and the prompt`);
      check(Math.abs(rode.worst) < 0.2, `the taxi rides on the road's surface (${rode.n} places: at most ${rode.worst.toFixed(2)} m off it${rode.at ? `, at ${rode.at}` : ''})`);
      await p.tap('#gt-down');
      await frames(6);
      const skipped = await p.evaluate(() => { const g = window.__game, o = g.ride(); for (let t = 0; t < 20 && o && o.phase === 'driving'; t += 0.5) g.advance(0.5); if (g.cine && g.cine.active) g.cine.skip(); g.advance(0.5); return o ? o.phase : 'gone'; });
      check(skipped === 'arrived', `a tap on Skip ends the trip at the door (${skipped})`);
      await frames(4);
      await new Promise(r => setTimeout(r, 500));
      await p.screenshot({ path: path.join(outDir, `touch-${city}-arrived.png`) });
      await p.tap('#gp-main');
      await frames(4);
      const left = await p.evaluate(async () => { const g = window.__game; g.advance(0.5); await new Promise(r => setTimeout(r, 500)); return { mode: g.player.mode, joy: !document.getElementById('gt-joy').hidden }; });
      check(left.mode === 'foot' && left.joy, `a tap on "Get out" puts you on the kerb with the stick back (${left.mode})`);
    }

    // two fingers on the picture zoom
    const cdp = await ctx.newCDPSession(p);
    const d0 = await p.evaluate(() => window.__game.cam.dist);
    const pts = s => [{ x: 195 - s, y: 330, id: 1 }, { x: 195 + s, y: 330, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
    for (let s = 40; s <= 110; s += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(s) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frames(2);
    const d1 = await p.evaluate(() => window.__game.cam.dist);
    check(d1 < d0 * 0.8, `two fingers spread on the picture bring the camera in (${d0.toFixed(1)} m to ${d1.toFixed(1)} m)`);

    // at the wheel
    const car = await p.evaluate(async () => {
      const g = window.__game, c = g.myCar(), st = c.D.st;
      g.player.x = st.x + Math.cos(st.h) * 1.6; g.player.y = st.y - Math.sin(st.h) * 1.6; g.player.z = st.z;
      g.enterCar(); g.advance(0.5);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.advance(0.2);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 600));
      const t = id => { const n = document.getElementById(id); return n.hidden || n.closest('[hidden]') ? '' : n.textContent.trim(); };
      const pr = document.getElementById('g-prompt').getBoundingClientRect(), vh = document.getElementById('g-vhud').getBoundingClientRect();
      return { mode: g.player.mode, down: t('gt-down'), jump: t('gt-jump'), run: t('gt-run'), alt: t('gp-alt-text'), main: t('gp-text'), clear: pr.bottom <= vh.top + 1 };
    });
    await p.screenshot({ path: path.join(outDir, `touch-${city}-car.png`) });
    check(car.mode === 'car' && car.down === 'Horn' && car.jump === 'Hand brake' && car.run === 'Auto', `at the wheel the pad is the car's (${car.down}, ${car.jump}, ${car.run})`);
    check(/Back on the road/.test(car.alt) && /Get out/.test(car.main) && car.clear, `and the prompt offers "${car.alt}" and "${car.main}" to a thumb, ${car.clear ? 'clear of' : 'UNDER'} the car's readout`);
    await p.tap('#gp-main');
    await frames(4);
    const out = await p.evaluate(() => window.__game.player.mode);
    check(out !== 'car', `a tap on "Get out" gets you out (${out})`);
  }
  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
