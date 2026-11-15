// A save as a player had it before a season was one message, opened in the game: the phone's Messages and the
// passport's postcards, looked at and written out (web/game/phone.js tidy(), web/postcards.js, docs/POSTCARDS.md).
// The save: four copies of one calendar notice, a copy for each day it was on and out of order, after the first
// day's note; and a postcard album from a day and a half ago with a card from this map, one from another live map
// and one from a map that has since been taken off the globe. The link goes straight into the game, past the title.
//   xvfb-run -a node tools/messages_shot.js [city] [out.png]     (PORT, default 8800; exit 1 when a check fails)
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const city = process.argv[2] || 'sydney', out = process.argv[3] || '', PORT = process.env.PORT || 8800;
let fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fail++; };
(async () => {
  const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..');
  const life = JSON.parse(fs.readFileSync(path.join(ROOT, 'cities', city, 'life.json'), 'utf8')), M = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/postcards.json'), 'utf8'));
  // (an event that is on today, where the calendar has one: the day's own notice must not add a copy either)
  const now = new Date(), md = now.getUTCMonth() * 31 + now.getUTCDate(), on = e => { const a = (e.dates[0][0] - 1) * 31 + e.dates[0][1], z = (e.dates[1][0] - 1) * 31 + e.dates[1][1]; return a <= z ? md > a + 8 && md < z : md > a + 8 || md < z; };
  const ev = life.events.find(e => e.dates && on(e)) || life.events.find(e => e.dates), other =Object.keys(M.cities).find(id => id !== city);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => { fail++; console.log(`pageerror ${e}`); });
  await p.addInitScript(([city, ev, mine, other]) => {
    try {
      if (localStorage.getItem('oe3d-life')) return; // (a reload keeps what the first load made of it)
      const y = new Date().getFullYear(), [m, d] = ev.dates[0], text = `${ev.title}${ev.where ? `, ${ev.where}` : ''}: on now.`;
      const day = k => { const t = new Date(Date.UTC(y, m - 1, d + k)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
      const copy = (k, t) => { const [yy, mm, dd] = day(k); return { from: 'Calendar', text, key: `${yy}-${mm}-${dd}|${ev.id}`, d: `${dd}/${mm}`, t, read: 1 }; };
      const [, m0, d0] = day(0), last = Math.min(7, Math.round((Date.UTC(y + (ev.dates[1][0] < m ? 1 : 0), ev.dates[1][0] - 1, ev.dates[1][1]) - Date.UTC(y, m - 1, d)) / 864e5)); // (each copy from a day of the run)
      localStorage.setItem('oe3d-quality', 'low');
      localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 }));
      localStorage.setItem('oe3d-life', JSON.stringify({ v: 1, skills: {}, wallets: {}, cities: { [city]: { days: 4, last: '', bonds: {}, jobs: {}, events: {}, dishes: [], shelf: [], seen: {}, log: [], flags: { hello: 1 },
        msgs: [{ from: 'Diary', text: 'Day 1 here.', key: 'hello', d: `${d0}/${m0}`, t: 930, read: 1 }, copy(last, 868), copy(1, 0), copy(0, 939), copy(Math.min(2, last), 933)] } } }));
      const now = Date.now(), H = 3600e3;
      localStorage.setItem('oe3d-postcards', JSON.stringify({ v: 1, seed: 7, at: now - 36 * H, n: 3, where: mine.c, was: null, left: 0,
        cards: [{ c: 'kyoto', s: 'gate', l: 'day', t: now - 60 * H, k: 0, seen: 1 }, Object.assign({ l: 'day', t: now - 50 * H, k: 0, seen: 1 }, other), Object.assign({ l: 'day', t: now - 40 * H, k: 0, seen: 1 }, mine)] }));
    } catch (e) { /* storage blocked */ }
  }, [city, ev, { c: city, s: M.cities[city][0].id }, { c: other, s: M.cities[other][0].id }]);
  await p.goto(`http://localhost:${PORT}/#play-${city}`);
  await startPlay(p, { asIs: true });
  await p.waitForFunction(() => window.__game && window.__game.life && window.__game.life.data.events.length, null, { timeout: 120000, polling: 250 });
  const r = await p.evaluate(async () => {
    const g = window.__game, L = g.life;
    g.advance(1);
    const box = L.phone.box().map(m => ({ from: m.from, key: m.key, d: m.d, t: m.t, y: m.y }));
    g.phoneShow('messages');
    const shown = [...document.querySelectorAll('.lf-msgs li')].map(li => `${li.querySelector('b').textContent} ${li.querySelector('.num').textContent}`);
    L.save();
    const saved = JSON.parse(localStorage.getItem('oe3d-life')).cities[g.life.ctx.cityId].msgs.length;
    await new Promise(res => setTimeout(res, 3000));
    g.renderPassport();
    await new Promise(res => setTimeout(res, 1500));
    const pc = JSON.parse(localStorage.getItem('oe3d-postcards'));
    return { box, shown, saved, here: document.querySelectorAll('#gp-post li').length, hereShown: !document.getElementById('gp-post').hidden,
      else: [...document.querySelectorAll('#gp-post-else li .note')].map(n => n.textContent), elseShown: !document.getElementById('gp-post-else').hidden,
      cards: pc.cards.map(k => k.c), date: `${g.clock.d}/${g.clock.m}` };
  }, null);
  console.log(JSON.stringify(r, null, 1));
  const cal = r.box.filter(m => m.from === 'Calendar');
  check(cal.filter(m => /^on\|/.test(m.key)).length === 1 && cal.length <= 2 && r.saved === r.box.length, `messages: the save's four copies are one, and saved so (${r.box.length} in the box)`);
  const stamp = s => { const m = /(\d+)\/(\d+) (\d+):(\d+)$/.exec(s); return ((+m[2]) * 31 + +m[1]) * 1440 + +m[3] * 60 + +m[4]; };
  check(r.shown.length === r.box.length && r.shown.every((s, i) => !i || stamp(s) <= stamp(r.shown[i - 1])), `messages: listed newest first (${r.shown.join(' | ')})`);
  check(r.cards.includes('kyoto') && r.cards.length > 3, `postcards: a link straight into the game brings what came while away (${r.cards.length} in the album), the parked map's card kept`);
  check(r.hereShown && r.here >= 1 && r.elseShown && r.else.length >= 1, `postcards: the passport lists this map's (${r.here}) and the other maps' (${r.else.length})`);
  if (out) {
    await p.screenshot({ path: out });
    await p.evaluate(() => { window.__game.phoneShow(false); document.getElementById('g-pass').hidden = false; const e = document.getElementById('gp-post'); if (e) e.scrollIntoView(); });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: out.replace(/(\.\w+)$/, '-passport$1') });
  }
  await b.close();
  console.log(fail ? `${fail} failed` : 'messages: all ok');
  process.exit(fail ? 1 : 0);
})();
