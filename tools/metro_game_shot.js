// Stills of the subway map opened from inside a game or a 3D model (metro.js, Tokyo's districts):
// the game started, B pressed, the map drawn over the held game, then a district picked; and the 3D
// model's district bar with its map open. On a desktop and a phone.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/metro_game_shot.js out_dir [city]   # default: shibuya
const { chromium } = require('playwright');
const fs = require('fs');
const [,, out = 'metro-game-shot', city = 'shibuya'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const BASE = `http://localhost:${process.env.PORT || 8800}/`;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const errs = [];
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); localStorage.setItem('oe3d-metro-picked', '1'); } catch (e) { /* storage blocked */ } });
    await ctx.addInitScript(() => { // the canvas kept between frames, so a screenshot has the picture
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e}`));
    // the game
    await p.goto(`${BASE}#play-${city}`);
    await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
    await p.waitForTimeout(1500);
    await p.waitForSelector('#gt-play', { state: 'visible', timeout: 600000 });
    await p.click('#gt-play');
    await p.waitForFunction('document.getElementById("g-title").hidden', null, { timeout: 60000 });
    await p.waitForFunction('!document.querySelector("#game-stage.cine") && !window.__game.arriving()', null, { timeout: 300000 }).catch(() => {});
    await p.waitForTimeout(1500);
    await p.evaluate(() => { const t = window.OEOnboard && OEOnboard.current(); if (t) t.skip(); });
    await p.waitForTimeout(1000);
    if (phone) await p.locator('#g-metro-btn').tap(); else await p.keyboard.press('b');
    await p.waitForTimeout(3000);
    await p.screenshot({ path: `${out}/${name}-game-map.png` });
    const chip = p.locator(`.ts-mfull .mt-chip:not([data-mapid="${city}"])`).first(); // another map of the group
    if (phone) await chip.tap(); else await chip.click();
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/${name}-game-pick.png` });
    console.log(name, 'game:', JSON.stringify(await p.evaluate(() => document.querySelector('.ts-mfull .mt-pick').innerText)));
    // the 3D model
    await p.goto(`${BASE}#${city}`);
    await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000 });
    await p.keyboard.press('Shift'); // skips the opening flight (city.js skipIntro)
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${out}/${name}-model-bar.png` });
    if (phone) await p.locator('#city-districts .tc-metro').tap(); else await p.locator('#city-districts .tc-metro').click();
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/${name}-model-map.png` });
    await ctx.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
