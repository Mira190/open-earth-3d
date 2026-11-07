// Stills of every destination card on the title screen (the travel-guide cards, cities/guide.json),
// on a desktop and a phone, for judging the cards' text and layout. Also fails on a card that
// overflows the screen or runs into the destination list.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/title_card_shot.js out_dir [names]   (names: comma-separated, default all)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, outDir = 'title-cards', only = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  fs.mkdirSync(outDir, { recursive: true });
  let fail = 0;
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on('pageerror', e => { fail++; console.log(`${name}: pageerror ${e}`); });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#globe`);
    await p.waitForSelector('.ts-item', { timeout: 120000 });
    await p.waitForTimeout(4000);
    const names = await p.$$eval('.ts-item .nm', els => els.map(e => e.textContent.trim()));
    for (const [i, n] of names.entries()) {
      if (only && !only.split(',').some(o => n.toLowerCase().includes(o.toLowerCase()))) continue;
      const it = p.locator('.ts-item').nth(i);
      await it.scrollIntoViewIfNeeded();
      await (phone ? it.tap() : it.click());
      await p.waitForTimeout(1600);
      const r = await p.evaluate(() => {
        const c = document.querySelector('.ts-card.on'); if (!c) return null;
        const a = c.getBoundingClientRect(), l = document.querySelector('.ts-list').getBoundingClientRect();
        return { top: a.top, bottom: a.bottom, listTop: l.top, guide: !!c.querySelector('.sum'), text: c.innerText.slice(0, 2000) };
      });
      const bad = !r || r.top < 0 || r.bottom > h || (phone && r.bottom > r.listTop + 1) || !r.guide;
      if (bad) fail++;
      console.log(`${name} ${n}: ${bad ? 'FAIL ' + JSON.stringify(r && { top: r.top, bottom: r.bottom, listTop: r.listTop, guide: r.guide }) : 'ok'}`);
      if (/data|LiDAR|PLATEAU|survey|bathymetry/i.test(r ? r.text : '')) { fail++; console.log(`${name} ${n}: FAIL card text names the data: ${r.text.match(/.{0,40}(data|LiDAR|PLATEAU|survey|bathymetry).{0,40}/i)[0]}`); }
      await p.screenshot({ path: path.join(outDir, `${name}-${n.toLowerCase().replace(/\W+/g, '-')}.png`) });
    }
    await ctx.close();
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
