// Stills of a group's subway map on the title screen (Tokyo's districts, title.js metroHTML): the
// card as it opens, then with a station picked, then the map full screen (title.js openFull) as it
// draws itself and once it has, on a desktop and a phone.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/metro_shot.js out_dir [group name] [station]   # defaults: Tokyo, Asakusa
const { chromium } = require('playwright');
const fs = require('fs');
const [,, out = 'metro-shot', group = 'Tokyo', station = 'Asakusa'] = process.argv;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  const errs = [];
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e}`));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#globe`);
    await p.waitForSelector('.ts-item', { timeout: 120000 });
    await p.waitForTimeout(3000);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(2500);
    await p.locator('.ts-item', { hasText: group }).first().focus();
    await p.waitForSelector('.ts-metro', { timeout: 20000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/${name}-card.png` });
    await p.locator(`.mt-stn[aria-label^="${station}"]`).first().dispatchEvent('click');
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${name}-${station.toLowerCase()}.png` });
    const pick = await p.evaluate(() => document.querySelector('.mt-pick').innerText);
    console.log(name, JSON.stringify(pick));
    // (on a phone the touch on the card's map has already opened it full screen)
    if (!(await p.$('.ts-mfull:not([hidden])'))) await p.locator('.ts-card [data-full]').first().click();
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${name}-full-drawing.png` });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/${name}-full.png` });
    await ctx.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
