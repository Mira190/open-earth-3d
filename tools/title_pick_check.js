// Choosing a destination on the title screen, with real pointer clicks and taps as a person makes them
// (a click focuses the button first, and that focus must not count as the first of two clicks):
//   - the first click or tap on a destination opens its card; a city goes in on the second click;
//   - a group of maps (Tokyo's districts) never goes in from the list: the second click opens its
//     subway map full screen (title.js openFull), as the card's "Open map" does, and a tap on the
//     card's small map on a phone;
//   - until a station has been picked once, the map says it can be chosen from (the cue);
//   - the district buttons under the map are a thumb's size, and a touch beside a station lands on it;
//   - Esc or Back closes the full-screen map onto the globe, and a district's Explore goes in.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/title_pick_check.js
const { chromium } = require('playwright');
const BASE = `http://localhost:${process.env.PORT || 8800}/#globe`;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  let fail = 0;
  const check = (name, what, ok, detail) => { console.log(`${name}: ${what}: ${ok ? 'ok' : 'FAIL ' + JSON.stringify(detail)}`); if (!ok) fail++; };
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on('pageerror', e => { fail++; console.log(`${name}: pageerror ${e}`); });
    const press = async loc => (phone ? loc.tap() : loc.click());
    const state = () => p.evaluate(() => ({
      hash: location.hash, diving: !!document.querySelector('.diving'),
      card: !!document.querySelector('.ts-card.on .ts-metro'), full: !!document.querySelector('.ts-mfull:not([hidden]) .ts-metro'),
      cue: !!document.querySelector('.ts-metro.cue'), pick: (document.querySelector('.ts-mfull:not([hidden]) .mt-pick b') || document.querySelector('.mt-pick b') || {}).textContent,
    }));
    await p.goto(BASE);
    await p.waitForSelector('.ts-item', { timeout: 120000 });
    await p.waitForTimeout(4000);
    const item = p.locator('.ts-item', { hasText: 'Tokyo' }).first();

    await press(item);
    await p.waitForTimeout(1200);
    let s = await state();
    check(name, 'first press on Tokyo opens its card with the subway map', !s.diving && s.hash === '#globe' && s.card && !s.full && s.cue, s);

    // a district's button under the map picks it (on a desktop those are on the full-screen map)
    if (!phone) { await press(p.locator('.ts-card [data-full]').first()); await p.waitForTimeout(1600); }
    const chip = p.locator(`${phone ? '.ts-card' : '.ts-mfull'} .mt-chip[data-mapid="shinjuku"]`).first();
    const box = await chip.boundingBox();
    await press(chip);
    await p.waitForTimeout(400);
    s = await state();
    check(name, `district button (${Math.round(box.height)} px tall) picks Shinjuku and ends the cue`, s.pick === 'Shinjuku' && !s.cue && box.height >= 44, s);

    // open it full screen: a tap on the small map on a phone, the second click on Tokyo on a desktop
    if (phone) await p.locator('.ts-card .ts-metro svg').first().tap();
    else { await p.keyboard.press('Escape'); await p.waitForTimeout(600); await item.click(); }
    await p.waitForTimeout(1800);
    s = await state();
    check(name, `${phone ? 'a tap on the small map' : 'second click on Tokyo'} opens the map full screen, still on the globe`, s.full && !s.diving && s.hash === '#globe' && s.pick === 'Shinjuku', s);

    // a touch a little off a station still lands on it
    const dot = await p.locator('.ts-mfull .mt-stn.on[aria-label^="Shibuya"] .mt-dot').first().boundingBox();
    const tx = dot.x + dot.width / 2 + 10, ty = dot.y + dot.height / 2 + 8;
    await (phone ? p.touchscreen.tap(tx, ty) : p.mouse.click(tx, ty));
    await p.waitForTimeout(400);
    s = await state();
    check(name, 'a touch 13 px beside Shibuya picks Shibuya', s.pick === 'Shibuya', s);

    if (!phone) {
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(300);
      s = await state();
      check(name, 'the arrow keys walk the lit stations', s.pick && s.pick !== 'Shibuya', s);
      await p.keyboard.press('Escape');
    } else await p.locator('.ts-mfull [data-close]').tap();
    await p.waitForTimeout(800);
    s = await state();
    check(name, `${phone ? 'Back' : 'Esc'} closes the full-screen map onto the card`, !s.full && s.card && s.hash === '#globe', s);

    // in again by the card's Open map, then a district's Explore goes to it
    await press(p.locator('.ts-card [data-full]').first());
    await p.waitForTimeout(1600);
    await press(p.locator('.ts-mfull .mt-chip[data-mapid="shibuya"]').first());
    await p.waitForTimeout(300);
    await press(p.locator('.ts-mfull .mt-pick [data-go="model"]').first());
    await p.waitForTimeout(3500);
    s = await state();
    check(name, 'Open map, Shibuya, Explore goes to #shibuya', s.hash === '#shibuya', s);

    // a city on its own: the first click shows its card (Play, Explore), the second goes in
    if (!phone) {
      await p.goto(BASE);
      await p.waitForSelector('.ts-item', { timeout: 120000 });
      await p.waitForTimeout(4000);
      const one = p.locator('.ts-item', { hasText: 'Sydney' }).first();
      await one.click();
      await p.waitForTimeout(1200);
      const c1 = await p.evaluate(() => ({ diving: !!document.querySelector('.diving'), play: !!document.querySelector('.ts-card.on [data-go="play"]') }));
      await one.click();
      await p.waitForTimeout(3500);
      const h2 = await p.evaluate(() => location.hash);
      check(name, 'Sydney: card on the first click, in on the second', !c1.diving && c1.play && h2 === '#sydney', { c1, h2 });
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `title_pick_check: ${fail} failure(s)` : 'title_pick_check: ok');
  process.exit(fail ? 1 : 0);
})();
