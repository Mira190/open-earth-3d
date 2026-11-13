// Choosing a destination on the title screen, with real pointer clicks and taps as a person makes them
//   - a hover on the list lights the row, dims the others and turns the globe to it, with no card;
// (a click focuses the button first, and that focus must not count as the first of two clicks):
//   - the first click or tap on a destination opens its card; a city goes in on the second click;
//   - a group of maps (Tokyo's districts) never goes in from the list: the second click opens its
//     subway map full screen (title.js openFull), as the card's "Open map" does, and a tap on the
//     card's small map on a phone;
//   - until a station has been picked once, the map says it can be chosen from (the cue);
//   - the district buttons under the map are a thumb's size, and a touch beside a station lands on it;
//   - Esc or Back closes the full-screen map onto the globe, and a district's Explore goes in;
//   - the menu leads with Japan, opens framed on it (Tokyo and Kyoto both named on the globe), and
//     its one primary button goes straight into the Shibuya game (docs/HOMEPAGE.md).
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
    let p = await ctx.newPage();
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

    // a hover on the list previews a destination: its row lights and the others dim, the globe
    // turns to it, and no card comes up; leaving the list turns it back (title.js hover)
    if (!phone) {
      const markAt = () => p.evaluate(() => { const m = [...document.querySelectorAll('.ts-mark.live')].find(e => e.textContent.startsWith('Sydney'));
        const r = m.getBoundingClientRect(); return { x: r.left, y: r.top }; });
      const far = ({ x, y }) => Math.hypot(x - w * 0.62, y - h * 0.5);
      // the opening is over and the orbit has settled on the menu's first framing
      await p.waitForFunction(() => { const a = document.querySelector('.title-app'); return a && a.classList.contains('menu') && !a.classList.contains('opening'); }, null, { timeout: 60000 });
      await p.waitForTimeout(3500);
      const before = await markAt();
      await p.locator('.ts-item', { hasText: 'Sydney' }).first().hover();
      await p.waitForTimeout(3500);
      const on = await p.evaluate(() => ({ hovering: document.querySelector('.ts-list').classList.contains('hovering'),
        hot: (document.querySelector('.ts-item.hot') || {}).textContent || '', card: !!document.querySelector('.ts-card.on'),
        dim: getComputedStyle([...document.querySelectorAll('.ts-item')].find(b => !b.classList.contains('hot'))).opacity }));
      const after = await markAt();
      check(name, 'hover on Sydney lights its row, dims the others, opens no card', on.hovering && /Sydney/i.test(on.hot) && !on.card && +on.dim < 0.5, on);
      check(name, 'hover on Sydney turns the globe to it', far(after) < far(before) - 40, { before, after });
      await p.mouse.move(w - 20, h * 0.5);
      await p.waitForTimeout(3500);
      const back = await markAt();
      const off = await p.evaluate(() => document.querySelector('.ts-list').classList.contains('hovering'));
      check(name, 'leaving the list turns the globe back and undims the rows', !off && far(back) > far(after) + 40, { after, back, off });
    }

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
    // the landing: Japan first, framed on Japan, one press into Shibuya's game (a fresh visit: a page
    // that comes back from a city opens turned to that city instead)
    await ctx.close();
    const ctx2 = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await ctx2.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    p = await ctx2.newPage();
    p.on('pageerror', e => { fail++; console.log(`${name}: pageerror ${e}`); });
    await p.goto(BASE);
    await p.waitForSelector('.ts-item', { timeout: 120000 });
    await p.waitForFunction(() => { const a = document.querySelector('.title-app'); return a && a.classList.contains('menu') && !a.classList.contains('opening'); }, null, { timeout: 60000 });
    await p.waitForTimeout(3500);
    const land = await p.evaluate(([W, H]) => {
      const mark = n => { const m = [...document.querySelectorAll('.ts-mark.live')].find(e => e.textContent.startsWith(n)); if (!m || m.hidden || m.classList.contains('mute')) return false;
        const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= W && r.top >= 0 && r.bottom <= H; };
      return { first: [...document.querySelectorAll('.ts-item .nm')].slice(0, 2).map(e => e.firstChild.textContent.trim()), tokyo: mark('Tokyo'), kyoto: mark('Kyoto') };
    }, [w, h]);
    check(name, 'the menu leads with Tokyo and Kyoto, both named on the globe', land.first.join() === 'Tokyo,Kyoto' && land.tokyo && land.kyoto, land);
    const go = p.locator('.ts-hero .ts-go');
    const gb = await go.boundingBox();
    await press(go);
    await p.waitForFunction(() => location.hash.startsWith('#play-'), null, { timeout: 15000 }).catch(() => {});
    s = await state();
    check(name, `the primary button (${gb ? Math.round(gb.height) : 0} px, in view) goes straight to #play-shibuya`, s.hash === '#play-shibuya' && gb && gb.y + gb.height <= h && gb.height >= 44, { hash: s.hash, gb });
    await ctx2.close();
  }
  await b.close();
  console.log(fail ? `title_pick_check: ${fail} failure(s)` : 'title_pick_check: ok');
  process.exit(fail ? 1 : 0);
})();
