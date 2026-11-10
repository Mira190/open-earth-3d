// The postcards (web/postcards.js, docs/POSTCARDS.md), checked two ways.
//
// The journey, in Node, with no browser: a player who comes back at odd intervals for six weeks.
//   - the first visit brings one postcard, a visit within six hours none, a long absence three at most;
//   - no card is dated before the visit before it or after the visit that found it, or in the small hours;
//   - a card's light is the sun's over that city at that minute, and its still is on disk;
//   - the journey stays two or three cards in a map, then moves on, and gets round every live map;
//   - every live city with a game has spots, every spot a line of the diary, and the album stays in its bound.
//
// The pages, in a browser (skipped with --journey): on a desktop and a phone, for a player back after a day,
//   - the pile comes up on the menu and says how many are new; opening it shows a picture that has loaded,
//     with its place, its time and its line; the arrows and the album change the card; Esc closes it;
//   - the title's keys are the viewer's while it is open (an arrow does not change the destination);
//   - "Go there" dives to the card's city with "@pc-<spot>.<light>", and on the desktop the game then stands
//     on the photographer's spot with the clock at the postcard's light, and its passport lists the card.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/postcards_check.js [--journey]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'web/sun.js'));
const P = require(path.join(ROOT, 'web/postcards.js'));
let fail = 0;
const check = (what, ok, detail) => { console.log(`${what}: ${ok ? 'ok' : 'FAIL ' + JSON.stringify(detail === undefined ? '' : detail)}`); if (!ok) fail++; };

const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/postcards.json'), 'utf8'));
const cities = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/cities.json'), 'utf8')).filter(c => c.built && c.game);
const live = execSync('bash tools/live_cities.sh', { cwd: ROOT }).toString().split(/\s+/).filter(Boolean);
const games = live.filter(id => cities.some(c => c.id === id));

// ------------------------------------------------------------ the data
check('data: every live city with a game has postcards', games.every(id => (M.cities[id] || []).length >= 5), games.filter(id => (M.cities[id] || []).length < 5));
check('data: no postcards for a city off the globe', Object.keys(M.cities).every(id => games.includes(id)), Object.keys(M.cities).filter(id => !games.includes(id)));
const noLine = [], noStill = [], badLine = [];
for (const [id, spots] of Object.entries(M.cities)) for (const s of spots) {
  for (const l of M.lights) {
    const lines = [].concat(s.lines[l] || s.lines.any || []);
    if (!lines.length) noLine.push(`${id}/${s.id}/${l}`);
    for (const t of lines) if (t.length < 30 || t.length > 190) badLine.push(`${id}/${s.id}: ${t.length} characters`);
    if (!fs.existsSync(path.join(ROOT, 'web/data', id, 'postcards', `${s.id}-${l}.webp`))) noStill.push(`${id}/${s.id}-${l}`);
  }
}
check('data: every spot has a line of the diary for every light', !noLine.length, noLine.slice(0, 6));
check('data: a line is a sentence or two (30 to 190 characters)', !badLine.length, badLine.slice(0, 6));
check('data: every spot has its four stills', !noStill.length, noStill.slice(0, 6));
// the stills on disk are the ones the index names: none left from a spot that was taken out
const stray = [];
for (const id of fs.readdirSync(path.join(ROOT, 'web/data'))) {
  const dir = path.join(ROOT, 'web/data', id, 'postcards');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) { const m = /^(.+)-(dawn|day|dusk|night)\.webp$/.exec(f); if (!m || !(M.cities[id] || []).some(s => s.id === m[1])) stray.push(`${id}/${f}`); }
}
check('data: no still without a spot', !stray.length, stray.slice(0, 6));
// the index is what pipeline/postcards.py writes from the cities' spot files now
const src = {};
for (const id of games) { const f = path.join(ROOT, 'cities', id, 'postcards.json'); if (fs.existsSync(f)) src[id] = JSON.parse(fs.readFileSync(f, 'utf8')).spots; }
const stale = Object.keys(M.cities).filter(id => !src[id] || M.cities[id].some(s => { const q = src[id].find(x => x.id === s.id); return !q || q.name !== s.name || JSON.stringify(q.lines || {}) !== JSON.stringify(s.lines) || q.at[0] !== s.at[0] || q.at[1] !== s.at[1]; }));
check('data: the index is up to date with cities/<id>/postcards.json (python pipeline/postcards.py index)', !stale.length, stale);
// the traveller in every map's stills, who signs its cards, is one tools/plush.js can make
{
  const kinds = fs.readFileSync(path.join(ROOT, 'tools/plush.js'), 'utf8');
  const bad = Object.keys(M.cities).filter(id => { const f = (M.friends || {})[id]; return !f || !f.name || !f.what || !new RegExp(`\\n    ${f.kind}: \\{`).test(kinds); });
  check('data: every map names its traveller in the index, of a kind tools/plush.js makes', !bad.length, bad);
}

// ------------------------------------------------------------ the journey
{
  const HOUR = 3600e3;
  let now = Date.UTC(2026, 10, 9, 23, 30), seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = P.fresh(now);
  const first = P.plan(st, now, M, cities);
  check('journey: the first visit brings one postcard', first.length === 1, first.length);
  check('journey: a visit an hour later brings none', P.plan(st, now + HOUR, M, cities).length === 0);
  const bad = [], stays = [], seen = new Set();
  let run = 0, last = null, most = 0, prev = now;
  for (let v = 0; v < 140; v++) {
    const gap = [2, 5, 7, 13, 26, 50, 200][Math.floor(rnd() * 7)] * HOUR * (0.8 + 0.4 * rnd());
    now += gap;
    const before = st.at, got = P.plan(st, now, M, cities);
    most = Math.max(most, got.length);
    if (now - before < P.EVERY && got.length) bad.push(`a card after ${((now - before) / HOUR).toFixed(1)} h`);
    if (now - before >= P.EVERY && !got.length) bad.push(`none after ${((now - before) / HOUR).toFixed(1)} h`);
    for (const k of got) {
      const c = cities.find(x => x.id === k.c), d = P.describe(k, M, cities);
      if (!d || !d.line || !d.where) { bad.push(`no text for ${k.c}/${k.s}`); continue; }
      if (k.t > now || k.t <= before) bad.push(`${k.c}/${k.s} dated outside the absence`);
      if (k.l !== P.light(k.t, c)) bad.push(`${k.c}/${k.s}: light ${k.l} is not the sun's`);
      const loc = S.utcToLocal(k.t, c.timezone);
      if (loc.minutes > 30 && loc.minutes < 300 && k.t - before > 6 * HOUR) bad.push(`${k.c}/${k.s} at ${d.time} in the small hours`);
      if (k.c === last) run++; else { if (last) stays.push(run); run = 1; last = k.c; }
      seen.add(k.c);
    }
    prev = now;
  }
  check('journey: cards come one for six hours away, never sooner, dated in the absence, in the sun\'s light', !bad.length, bad.slice(0, 6));
  check('journey: three at most at a visit', most === P.PER_VISIT, most);
  check('journey: two or three cards in a map, then on', stays.length > 20 && stays.every(n => n >= 1 && n <= 3) && stays.filter(n => n >= 2).length > stays.length * 0.7, stays.slice(0, 30));
  check('journey: it gets round every map', seen.size === Object.keys(M.cities).length, [...seen]);
  check('journey: the album keeps the newest', st.cards.length <= P.ALBUM && st.cards.every((k, i) => !i || k.t >= st.cards[i - 1].t), st.cards.length);
  const a = P.arrival(M, st.cards[0].c, `pc-${st.cards[0].s}.dusk`);
  check('journey: a card names where the game starts', a && a.postcard && a.light === 'dusk' && a.at.length >= 2 && P.arrival(M, st.cards[0].c, 'pc-nowhere.dusk') === null && P.arrival(M, st.cards[0].c, 't-shibuya') === null, a);
  void prev;
}

// ------------------------------------------------------------ the pages
(async () => {
  if (process.argv.includes('--journey')) { console.log(fail ? `${fail} failed` : 'postcards: all ok'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const BASE = `http://localhost:${process.env.PORT || 8800}/#globe`;
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, w, h, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    // a player who was here a day ago and has one card already, read
    await ctx.addInitScript(([key, card]) => {
      try {
        localStorage.setItem('oe3d-quality', 'low');
        localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 }));
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ v: 1, seed: 7, at: Date.now() - 26 * 3600e3, n: 1, where: card.c, was: null, left: 0, cards: [Object.assign(card, { t: Date.now() - 30 * 3600e3 })] }));
      } catch (e) { /* storage blocked */ }
    }, [P.KEY, { c: 'sydney', s: M.cities.sydney[0].id, l: 'day', k: 0, seen: 1 }]);
    const p = await ctx.newPage();
    p.on('pageerror', e => { fail++; console.log(`${name}: pageerror ${e}`); });
    const press = async loc => (phone ? loc.tap() : loc.click());
    await p.goto(BASE);
    await p.waitForSelector('.title-app.menu', { timeout: 180000 }).catch(() => {});
    await p.evaluate(() => { const t = window.__title; if (t && t.state === 'open') t.skip(); });
    await p.waitForSelector('.title-app.menu #ts-post', { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(2500); // (the pile fades in after the menu)
    const pile = await p.evaluate(() => {
      const el = document.getElementById('ts-post'); if (!el) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const over = [...document.querySelectorAll('.ts-item, .ts-card.on, .ts-foot > *, .ts-top > *')].filter(o => { const q = o.getBoundingClientRect(); return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; }).map(o => o.className || o.id);
      return { text: el.textContent, isNew: el.classList.contains('new'), n: el.querySelectorAll('.pile i').length, box: [r.left, r.top, r.right, r.bottom].map(Math.round), opacity: +cs.opacity, over, w: innerWidth, h: innerHeight };
    });
    check(`${name}: the pile is on the menu, with three new`, pile && pile.isNew && /3 new/.test(pile.text) && pile.n === 3 && pile.opacity > 0.9, pile);
    if (!pile) { await ctx.close(); continue; }
    check(`${name}: the pile is inside the screen and over nothing else`, pile.box[0] >= 0 && pile.box[1] >= 0 && pile.box[2] <= pile.w && pile.box[3] <= pile.h && !pile.over.length, pile);
    await press(p.locator('#ts-post'));
    const card = () => p.evaluate(() => {
      const v = document.getElementById('ts-postview'), img = v.querySelector('.pv-photo img'), r = v.querySelector('.pv-card').getBoundingClientRect(), g = v.querySelector('.pv-go').getBoundingClientRect();
      return { open: !v.hidden, src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth === 960, where: v.querySelector('.pv-where').textContent, name: v.querySelector('h2').textContent,
        when: v.querySelector('.pv-when').textContent, line: v.querySelector('.pv-line').textContent, from: v.querySelector('.pv-from').textContent, n: v.querySelector('.pv-n').textContent, thumbs: v.querySelectorAll('.pv-album button').length,
        wide: Math.round(r.width), over: Math.round(Math.max(0, r.right - innerWidth, -r.left)), go: [Math.round(g.width), Math.round(g.height)], sel: (document.querySelector('.ts-item[aria-current="true"] .nm') || {}).textContent || '' };
    });
    await p.waitForFunction(() => { const i = document.querySelector('.pv-photo img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 }).catch(() => {});
    const c1 = await card();
    check(`${name}: opening it shows the oldest unread card, its picture loaded, with its place, time and line`,
      c1.open && c1.loaded && c1.where && c1.name && /\d\d:\d\d .*Sun \d+° (up|down)/.test(c1.when) && c1.line.length > 30 && /^From the road · \S+, the /.test(c1.from) && c1.n === '2 / 4' && c1.thumbs === 4, c1); // (the album's second card: one was read before, three are new)
    check(`${name}: the card fits the screen, and Go there is a thumb's size`, c1.over === 0 && c1.go[1] >= 44, c1);
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(300);
    const c2 = await card();
    check(`${name}: the right arrow shows the next card, and the destination behind does not change`, c2.n === '3 / 4' && c2.src !== c1.src && c2.sel === c1.sel, c2);
    await press(p.locator('.pv-album button').nth(3));
    await p.waitForTimeout(300);
    const c3 = await card();
    check(`${name}: the album opens the first card`, c3.n === '1 / 4' && /sydney/.test(c3.src), c3);
    await p.keyboard.press('Escape');
    const shut = await p.evaluate(() => ({ hidden: document.getElementById('ts-postview').hidden, text: document.getElementById('ts-post').textContent, isNew: document.getElementById('ts-post').classList.contains('new') }));
    check(`${name}: Esc closes it, and the pile counts what is still unread`, shut.hidden && /1 new/.test(shut.text), shut);
    // back in: the last unread, then Go there
    await press(p.locator('#ts-post'));
    await p.waitForTimeout(300);
    const c4 = await card();
    await press(p.locator('.pv-go'));
    await p.waitForFunction(() => /^#play-/.test(location.hash), null, { timeout: 30000 }).catch(() => {});
    const hash = await p.evaluate(() => decodeURIComponent(location.hash));
    const m = /^#play-([a-z-]+)@pc-([a-z0-9-]+)\.(dawn|day|dusk|night)$/.exec(hash);
    check(`${name}: Go there dives to the card's city, spot and light`, m && c4.src === `data/${m[1]}/postcards/${m[2]}-${m[3]}.webp`, { hash, src: c4.src });
    if (m && !phone) {
      const spot = M.cities[m[1]].find(s => s.id === m[2]);
      await p.waitForFunction(() => window.__game && !document.getElementById('g-title').hidden, null, { timeout: 900000, polling: 500 }).catch(() => {});
      const at = await p.evaluate(() => { const g = window.__game; return g ? { x: g.player.x, y: g.player.y, min: g.clock.min, pressed: (document.querySelector('#gt-timechoice [aria-pressed="true"]') || {}).textContent, title: document.getElementById('gt-title').textContent } : null; });
      const c = cities.find(x => x.id === m[1]);
      S.site({ lat: c.lat, lon: c.lon, tz: c.timezone });
      const now = S.utcToLocal(Date.now()), want = P.lightTime(m[3], now.y, now.m, now.d);
      check(`desktop: the game's title is over the photographer's spot, in the postcard's light`,
        at && Math.hypot(at.x - spot.at[0], at.y - spot.at[1]) < 25 && Math.abs(at.min - want) < 3 && /postcard/i.test(at.pressed || '') && at.title.includes(spot.name.split(',')[0]), { at, spot: spot.at, want });
      await p.evaluate(() => document.getElementById('gt-play').click());
      await p.waitForFunction(() => document.getElementById('g-title').hidden, null, { timeout: 60000 }).catch(() => {});
      const played = await p.evaluate(async () => {
        const g = window.__game;
        document.getElementById('g-pass-btn').click();
        await new Promise(r => setTimeout(r, 1500));
        return { x: g.player.x, y: g.player.y, min: g.clock.min, cards: document.querySelectorAll('#gp-post li').length, shown: !document.getElementById('gp-post').hidden };
      });
      check(`desktop: play starts there, at that light, and the passport lists the map's postcards`,
        Math.hypot(played.x - spot.at[0], played.y - spot.at[1]) < 25 && Math.abs(played.min - want) < 30 && played.shown && played.cards >= 1, { played, want });
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `${fail} failed` : 'postcards: all ok');
  process.exit(fail ? 1 : 0);
})();
