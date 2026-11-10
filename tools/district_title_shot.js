// A district that shares a bigger map (Sangenjaya, on Shibuya's): its link (#play-<city>@<travel id>) opened,
// then on from it in the game. Checks that the loader, the title card and the tab name the district, not the map
// it shares; that the HUD stays off the title; that the subway map marks the district as where you are; and that
// the map's own station is then a hop across the map, not the map loaded again. Saves a still of each. Exits 1
// when one fails.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/district_title_shot.js shibuya t-sancha out_dir [desktop|phone]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', point = 't-sancha', outDir = '.', size = 'desktop'] = process.argv;
const VIEW = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }[size];
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, isMobile: !!VIEW.isMobile, hasTouch: !!VIEW.hasTouch, deviceScaleFactor: VIEW.deviceScaleFactor || 1 });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'desktop'); } catch (e) { /* storage blocked */ } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  fs.mkdirSync(outDir, { recursive: true });
  const still = async name => fs.writeFileSync(path.join(outDir, `${city}@${point}-${size}-${name}.png`), await p.screenshot());
  const url = h => `http://localhost:${process.env.PORT || 8800}/#${h}`;
  const titleUp = async () => {
    await p.waitForFunction('window.__game', null, { timeout: 600000 });
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 });
    await p.waitForTimeout(1500);
  };
  const read = () => p.evaluate(() => {
    const vis = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.05;
    const q = s => document.querySelector(s);
    return {
      title: q('#g-title h1').textContent, eyebrow: q('#gt-city').textContent, blurb: q('#gt-blurb') ? q('#gt-blurb').textContent : '', tab: document.title,
      load: q('#g-load-title').textContent, loadNative: q('#g-load-native').textContent,
      over: [...document.querySelectorAll('#game-app :is(.g-quest, .g-right, .g-prompt, .g-labels > *)')].filter(vis).map(e => (e.id || e.className) + ':' + e.textContent.trim().slice(0, 40)),
      player: window.__game.player ? [window.__game.player.x, window.__game.player.y] : null,
    };
  });
  const out = {};
  // 1: the link opened directly; the loading plate's name is read while it loads
  await p.goto(url(`play-${city}@${point}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById('game-app').hidden, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  await still('loading');
  out.loading = await p.evaluate(() => ({ load: document.getElementById('g-load-title').textContent, loadNative: document.getElementById('g-load-native').textContent }));
  await titleUp();
  out.direct = await read();
  await still('direct');
  // 2: on from there in the game: the subway map marks the district as where you are, and another station of the
  // same map is a hop across it (the map is not loaded again: the game is the same one), the address following
  await p.evaluate(() => { const s = document.getElementById('gt-skip-on'); if (s) s.checked = true; try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: true })); } catch (e) { /* storage blocked */ } document.getElementById('gt-play').click(); });
  await p.waitForFunction(() => window.__game && window.__game.playing && !window.__game.cine.active, null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(3000);
  await still('arrived');
  await p.evaluate(() => { window.__g0 = window.__game; document.getElementById('g-metro-btn').click(); });
  await p.waitForTimeout(1200);
  await still('metro');
  out.metro = await p.evaluate(() => {
    const el = document.querySelector('.ts-mfull'), you = el && el.querySelector('.mt-you'), stn = you && you.closest('.mt-stn');
    const r = { here: stn ? stn.getAttribute('aria-label') : null, stay: !!(el && el.querySelector('.mt-pick [data-close]')) };
    const homeStn = el && [...el.querySelectorAll('.mt-stn.here')].find(st => st !== stn);
    if (homeStn) { homeStn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); r.tag = el.querySelector('.mt-pick .mt-name').textContent; const b = el.querySelector('.mt-pick .primary'); r.button = b.textContent.trim(); b.click(); }
    return r;
  });
  const at0 = out.direct.player; // (the hop's shot runs on the game clock: slow on a software renderer)
  await p.waitForFunction(a => Math.hypot(window.__game.player.x - a[0], window.__game.player.y - a[1]) > 300 && !window.__game.cine.active, at0, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1500);
  out.hop = await p.evaluate(() => ({ same: window.__game === window.__g0, hash: location.hash, loader: !document.getElementById('g-loader').hidden, player: [Math.round(window.__game.player.x), Math.round(window.__game.player.y)] }));
  await still('hop');
  console.log(JSON.stringify(out, null, 1));
  const fails = [];
  const want = (ok, msg) => { if (!ok) fails.push(msg); };
  const D = out.direct, name = D.title.replace(/[\u3000-\u9fff].*$/, '');
  want(out.loading.load === name, `the loader is named for the district (${out.loading.load})`);
  want(D.tab.startsWith(name) && !/Shibuya/.test(D.tab) === !/Shibuya/.test(name), `the tab is named for it (${D.tab})`);
  want(!D.over.length, `nothing of the HUD shows over the title (${D.over.join(' | ')})`);
  want(out.metro.here && out.metro.here.startsWith(name) && out.metro.stay, `the subway map marks the district as where you are (${out.metro.here})`);
  want(out.hop.same && !out.hop.loader && out.hop.hash === `#play-${city}`, `the map's own station is a hop within the game, not a reload (${JSON.stringify(out.hop)})`);
  want(Math.hypot(out.hop.player[0] - D.player[0], out.hop.player[1] - D.player[1]) > 300, 'the hop moved the player');
  want(!errs.length, `no page errors (${errs.join('; ')})`);
  for (const f of fails) console.log('FAIL', f);
  if (!fails.length) console.log('ok   district title, subway map and hop');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
