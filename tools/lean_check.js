// A phone whose load of a game died is given a lighter level the next time (quality.js loadBegan, issue 443): the
// game opened as an iPhone, its page crashed while it loads (the renderer killed, as iOS ends a tab that grows too
// large), opened again and crashed again. Each load after a death must be one level lighter, reach its first frame,
// and name the level; a page that was put away, not killed, must leave no note behind; and the telemetry's note of
// the page must say which step of the load it was at.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/lean_check.js [city, default sydney]
const { chromium } = require('playwright');
const city = process.argv[2] || 'sydney';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } });
  const url = `http://localhost:${process.env.PORT || 8800}/?telemetry=debug#play-${city}`; // (the telemetry on, logged instead of sent)
  const bad = [];
  const state = p => p.evaluate(() => {
    const q = OEQuality.city();
    let alive = '';
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k.indexOf('oe3d-alive-')) alive = (JSON.parse(localStorage.getItem(k)) || {}).stage || ''; }
    return { lean: q.lean, level: q.level, near: q.budget && q.budget.map.near, tiles: q.budget && q.budget.groundTiles, shadow: q.shadow, note: JSON.parse(localStorage.getItem('oe3d-loading') || 'null'), alive };
  });
  const frame = p => p.waitForFunction(() => performance.getEntriesByName('oe:frame', 'mark').length > 0, null, { timeout: 300000, polling: 500 });
  let last = null;
  for (let k = 0; k < 4; k++) {
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await frame(p);
    const s = await state(p), want = Math.min(2, k);
    console.log(`load ${k + 1}: level ${s.level} (whole within ${s.near} m, ${s.tiles} aerial tiles, shadow map ${s.shadow}), the page's note at "${s.alive}"`);
    if (!s.lean) bad.push('not the phone tier');
    if (s.level !== want) bad.push(`load ${k + 1}: level ${s.level}, not ${want}`);
    if (!s.note || s.note.level !== want || s.note.city !== city) bad.push(`load ${k + 1}: the loading note is ${JSON.stringify(s.note)}`);
    if (last && want > last.level && !(s.near < last.near)) bad.push(`load ${k + 1}: no lighter than the last`);
    if (!s.alive) bad.push(`load ${k + 1}: the page's note names no step of the load`);
    last = s;
    if (k < 3) { // (a crashed renderer answers nothing: the crash is sent and waited for by its event, not its reply)
      const cdp = await ctx.newCDPSession(p), dead = new Promise(r => p.once('crash', r));
      cdp.send('Page.crash').catch(() => {});
      await Promise.race([dead, new Promise(r => setTimeout(r, 5000))]);
      await p.close().catch(() => {});
      continue;
    }
    // the last one is put away instead: no note left, and the level stays for the load after
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const gone = await p.evaluate(() => localStorage.getItem('oe3d-loading'));
    if (gone) bad.push('a page put away left its loading note');
    await p.close();
    const p2 = await ctx.newPage();
    await p2.goto(url, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => !!localStorage.getItem('oe3d-loading'), null, { timeout: 120000 });
    const s2 = await state(p2);
    console.log(`after a page put away: level ${s2.level}`);
    if (s2.level !== 2) bad.push(`after a page put away the level is ${s2.level}, not 2`);
    await p2.close();
  }
  await b.close();
  if (bad.length) { console.log('FAIL ' + bad.join('; ')); process.exit(1); }
  console.log(`ok   ${city}: each load after a death one level lighter, to its first frame; none after a page put away`);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
