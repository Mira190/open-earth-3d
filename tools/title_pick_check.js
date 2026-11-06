// A destination on the title screen opens its card on the first click or tap, and goes in only when
// asked a second time; a group (Tokyo's districts) never goes in from the list: its card's subway
// map is where a district is chosen. Real pointer clicks, as a person makes them (a click focuses
// the button first, and the focus must not count as the first of the two).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/title_pick_check.js [group]   # default Tokyo
const { chromium } = require('playwright');
const [,, group = 'Tokyo'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] });
  let fail = 0;
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); localStorage.setItem('oe3d-title', '1'); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on('pageerror', e => { fail++; console.log(`${name}: pageerror ${e}`); });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#globe`);
    await p.waitForSelector('.ts-item', { timeout: 120000 });
    await p.waitForFunction(() => document.getElementById('ts-app') ? document.getElementById('ts-app').classList.contains('menu') : document.querySelector('.menu'), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(3500);
    const item = p.locator('.ts-item', { hasText: group }).first();
    const tap = () => (phone ? item.tap() : item.click());
    await tap();
    await p.waitForTimeout(1200);
    const after1 = await p.evaluate(() => ({ hash: location.hash, diving: !!document.querySelector('.diving'), metro: !!document.querySelector('.ts-card.on .ts-metro') }));
    const ok1 = !after1.diving && after1.hash === '#globe' && after1.metro;
    console.log(`${name}: first ${phone ? 'tap' : 'click'} on ${group}: ${ok1 ? 'card with the subway map, still on the globe' : 'FAIL ' + JSON.stringify(after1)}`);
    if (!ok1) fail++;
    await tap();
    await p.waitForTimeout(1200);
    const after2 = await p.evaluate(() => ({ hash: location.hash, diving: !!document.querySelector('.diving'), focus: document.activeElement && document.activeElement.className && String(document.activeElement.className.baseVal ?? document.activeElement.className) }));
    const ok2 = !after2.diving && after2.hash === '#globe';
    console.log(`${name}: second ${phone ? 'tap' : 'click'}: ${ok2 ? `stays on the map (focus: ${after2.focus})` : 'FAIL ' + JSON.stringify(after2)}`);
    if (!ok2) fail++;
    // a station on the map, then its Explore button, goes to that district
    const stn = p.locator('.mt-stn.on[aria-label^="Shibuya"]').first();
    if (phone) await stn.tap(); else await stn.click();
    await p.waitForTimeout(500);
    await p.locator('.mt-pick [data-go="model"]').first().click();
    await p.waitForTimeout(3500);
    const hash = await p.evaluate(() => location.hash);
    const ok3 = hash === '#shibuya';
    console.log(`${name}: Shibuya station, Explore: ${ok3 ? 'goes to #shibuya' : 'FAIL ' + hash}`);
    if (!ok3) fail++;
    // a city on its own: the first click shows its card (Play, Explore), the second goes in
    if (!phone) {
      await p.goto(`http://localhost:${process.env.PORT || 8800}/#globe`);
      await p.waitForSelector('.ts-item', { timeout: 120000 });
      await p.waitForTimeout(3500);
      const one = p.locator('.ts-item', { hasText: 'Sydney' }).first();
      await one.click();
      await p.waitForTimeout(1200);
      const c1 = await p.evaluate(() => ({ diving: !!document.querySelector('.diving'), play: !!document.querySelector('.ts-card.on [data-go="play"]') }));
      await one.click();
      await p.waitForTimeout(3500);
      const h2 = await p.evaluate(() => location.hash);
      const ok4 = !c1.diving && c1.play && h2 === '#sydney';
      console.log(`${name}: Sydney: ${ok4 ? 'card on the first click, in on the second' : 'FAIL ' + JSON.stringify({ c1, h2 })}`);
      if (!ok4) fail++;
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `title_pick_check: ${fail} failure(s)` : 'title_pick_check: ok');
  process.exit(fail ? 1 : 0);
})();
