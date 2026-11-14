// The daily life of a city's game: one store for what you carry from visit to visit (the passport's
// skills, your wallet, and for each map its diary, the people you know and the jobs you have done),
// an event bus the game reports to ("a height guessed", "a ferry ridden"), and the rules that turn
// those into skills. The day and its diary are day.js; bonds, jobs and the phone build on the same
// store. Nothing here draws the world: game.js calls tick() and emit(), and asks action() what E does.
//
// The design (docs/GAME.md "Daily life"): time gates what is on, never whether you may explore. The
// clock is the city's real clock unless you change it, so today's date and weather are the calendar.
'use strict';
window.OELife = (function () {
  const KEY = 'oe3d-life', V = 1;
  // the passport's five skills, each grown by doing the thing in the real place
  const SKILLS = [
    { id: 'eye', name: 'Eye', what: 'Heights judged by eye', levels: ['Rough guess', 'To the storey', 'To the metre', 'Plumb line', 'Surveyor\'s eye'] },
    { id: 'bearings', name: 'Bearings', what: 'Stations surveyed, places found, ways pointed', levels: ['Visitor', 'Finds the way', 'Knows the streets', 'Walking map', 'True north'] },
    { id: 'light', name: 'Light', what: 'Sun studies and pictures at their best hour', levels: ['Daylight', 'Reads the shade', 'Golden hour', 'Blue hour', 'Master of light'] },
    { id: 'lines', name: 'Lines', what: 'Ferries, trains, lifts and cabs ridden to the end', levels: ['Passenger', 'Commuter', 'Regular', 'Knows the timetable', 'Line captain'] },
    { id: 'taste', name: 'Taste', what: 'Dishes tried where they are made', levels: ['Curious', 'A second helping', 'Regular', 'Knows the counter', 'Local palate'] },
  ];
  const XP = [0, 6, 16, 32, 56]; // xp at which each level starts
  const levelOf = xp => { let l = 0; while (l < XP.length - 1 && xp >= XP[l + 1]) l++; return l + 1; };
  // step: what pay and prices are rounded to; unit: the smallest coin, which a transit fare is exact to (fares.js)
  const MONEY = { JPY: { symbol: '¥', start: 3000, step: 10, unit: 1, fare: [500, 420] }, AUD: { symbol: 'A$', start: 40, step: 1, unit: 0.01, fare: [4, 3] }, NZD: { symbol: 'NZ$', start: 40, step: 1, unit: 0.01, fare: [4, 3] }, EUR: { symbol: '€', start: 30, step: 1, unit: 0.01, fare: [3, 2] }, HKD: { symbol: 'HK$', start: 300, step: 1, unit: 0.1, fare: [29, 10] } };
  const CURRENCY = { Japan: 'JPY', Australia: 'AUD', 'New Zealand': 'NZD', France: 'EUR', Netherlands: 'EUR', 'Hong Kong': 'HKD', China: 'HKD' };

  function read() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && o.v === V ? o : null; } catch (e) { return null; } }
  const fresh = () => ({ v: V, skills: {}, wallets: {}, cities: {} });
  const freshCity = () => ({ days: 0, last: '', bonds: {}, jobs: {}, events: {}, dishes: [], shelf: [], seen: {}, log: [], flags: {} });

  // ctx: what game.js lends (see its "daily life" block): cityId, country, the clock and setClock, the
  // sun library, the HUD, the audio, the dialogue box, the player, the NPCs, the weather, and helpers
  function create(ctx) {
    let store = read() || fresh();
    const city = () => store.cities[ctx.cityId] || (store.cities[ctx.cityId] = freshCity());
    const code = (ctx.data && ctx.data.currency) || CURRENCY[ctx.country] || 'AUD';
    const cur = MONEY[code] || MONEY.AUD;
    if (store.wallets[code] == null) store.wallets[code] = cur.start;
    let dirty = false, data = { hours: {}, bonds: [], jobs: [], events: [], shops: [], messages: [] };
    const subs = {}, parts = [];
    const L = {
      SKILLS, XP, levelOf, ctx, code, cur,
      get data() { return data; },
      get store() { return store; },
      city,
      on(ev, fn) { (subs[ev] || (subs[ev] = [])).push(fn); },
      // something happened in the game: skills grow by it, and the day, the bonds and the jobs hear of it
      emit(ev, o = {}) {
        const rule = RULES[ev];
        if (rule) rule(o);
        for (const fn of subs[ev] || []) fn(o);
        for (const fn of subs['*'] || []) fn(ev, o);
        dirty = true;
      },
      save() { try { localStorage.setItem(KEY, JSON.stringify(store)); dirty = false; } catch (e) { /* storage blocked */ } },
      // the save read again from the browser, as the next visit will read it
      reload() { const o = read(); if (o) { store = o; if (store.wallets[code] == null) store.wallets[code] = cur.start; } return !!o; },
      // this map's diary, people and jobs start again (the menu's "New game"); the passport's skills and the wallet stay
      reset() { store.cities[ctx.cityId] = freshCity(); if (store.album) store.album = store.album.filter(a => a.city !== ctx.cityId); L.save(); for (const p of parts) if (p.reset) p.reset(); },
      wipe() { store = fresh(); store.wallets[code] = cur.start; L.save(); for (const p of parts) if (p.reset) p.reset(); },
      // ---- skills
      xp: id => (store.skills[id] || 0),
      level: id => levelOf(store.skills[id] || 0),
      gain(id, n, why) {
        if (!SKILLS.some(s => s.id === id) || !(n > 0)) return;
        const was = L.level(id);
        store.skills[id] = (store.skills[id] || 0) + n;
        const now = L.level(id), sk = SKILLS.find(s => s.id === id);
        dirty = true;
        if (now > was) {
          L.note(`${sk.name}: ${sk.levels[now - 1]}`, 'skill');
          if (L.ui && L.ui.banner) L.ui.banner({ kind: 'skill', eyebrow: `Passport · ${sk.name}`, title: sk.levels[now - 1], sub: `Level ${now} of 5${why ? ` · ${why}` : ''}` });
          else ctx.H.toast(`<b>${sk.name} ${now}</b><span>${sk.levels[now - 1]}</span>`);
          if (ctx.A.chime) ctx.A.chime();
          for (const fn of subs.level || []) fn({ skill: id, level: now });
        } else if (why) ctx.H.toast(`<b>${sk.name} +${n}</b><span>${why}</span>`);
      },
      // something done once only (per map): true the first time
      first(kind, id) { const s = city().seen, k = `${kind}:${id}`; if (s[k]) return false; s[k] = 1; dirty = true; return true; },
      // ---- the wallet, in the city's own money
      get money() { return store.wallets[code]; },
      // (whole amounts as they were; an amount with cents in it to the cent)
      fmt: n => { const v = Math.round(n / cur.unit) * cur.unit, d = Math.abs(v - Math.round(v)) < cur.unit / 2 ? 0 : cur.unit < 0.1 ? 2 : 1; return `${cur.symbol}${v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`; },
      earn(n, why) { n = Math.round(n / cur.step) * cur.step; if (!(n > 0)) return 0; store.wallets[code] += n; dirty = true; if (why) ctx.H.toast(`<b>+${L.fmt(n)}</b><span>${why}</span>`); return n; },
      // paying never strands you: what you can't cover is let go, and the caller is told how much was paid
      // (exact: to the smallest coin, as a transit fare is, not to the step prices are rounded to)
      pay(n, exact) {
        const u = exact ? cur.unit : cur.step, r = v => Math.round(v / cur.unit) * cur.unit;
        n = Math.round(n / u) * u;
        const p = r(Math.max(0, Math.min(n, store.wallets[code])));
        store.wallets[code] = r(store.wallets[code] - p); dirty = true;
        return { paid: p, short: r(n - p) };
      },
      // ---- the diary's log: what you did, by the city's date
      note(text, kind = '') {
        const c = ctx.clock, log = city().log;
        log.push({ d: `${c.y}-${c.m}-${c.d}`, t: Math.round(c.min), k: kind, text });
        if (log.length > 80) log.splice(0, log.length - 80);
        dirty = true;
      },
      // a cab's fare for a trip of m metres, paid on arrival: flag fall and a rate a kilometre in the city's money, less
      // what a friend's word takes off. Never a wall: short of it, the driver lets the rest go
      fare(m, kind) {
        const full = Math.round((cur.fare[0] + cur.fare[1] * m / 1000) / cur.step) * cur.step, off = L.ability('fare');
        const due = off ? Math.round(full * (1 - off.value) / cur.step) * cur.step : full, r = L.pay(due);
        L.note(`${kind === 'taxi' ? 'Taxi' : 'Ride'}, ${(m / 1000).toFixed(1)} km: ${L.fmt(r.paid)}`, 'fare');
        return `, ${L.fmt(due)}${off ? ` (${Math.round(off.value * 100)}% off: ${off.from})` : ''}${r.short ? '. "Short? Next time," says the driver' : ''}`;
      },
      ability(id) { return (L.bonds && L.bonds.ability) ? L.bonds.ability(id) : null; },
      // ---- the frame, the test harness's advance(), and what E does here
      use(part) { parts.push(part); return part; },
      tick(dt, paused, titled) { for (const p of parts) if (p.tick) p.tick(dt, paused, titled); if (dirty && (saveT -= dt) <= 0) { saveT = 5; L.save(); } },
      action() { for (const p of parts) { const a = p.action && p.action(); if (a) return a; } return null; },
      talk(n) { for (const p of parts) if (p.talk && p.talk(n)) return true; return false; },
      get open() { return parts.some(p => p.open); },
      close() { for (const p of parts) if (p.close) p.close(); },
      key(c) { for (const p of parts) if (p.key && p.key(c)) return true; return false; },
      // a map's own lines (web/data/<id>/life.json, from cities/<id>/life.json by pipeline/life.py)
      load(d) {
        if (!d) return;
        // every place of the day's life on firm ground: the nearest spot a walker can stand (a kerb for a cab's pick-up stays as written)
        const snap = (o, k) => { if (o && Array.isArray(o[k]) && ctx.place) { const q = ctx.place(o[k][0], o[k][1], o[k][2]); if (q) o[k] = q.map(v => Math.round(v * 10) / 10); } };
        for (const j of d.jobs || []) if (j.type !== 'fare') { snap(j, 'at'); snap(j, 'to'); }
        for (const s of d.shops || []) snap(s, 'at');
        for (const e of d.events || []) snap(e, 'at');
        data = Object.assign(data, d); for (const p of parts) if (p.load) p.load(data);
      },
    };
    let saveT = 5;
    // what grows which skill (once a thing where it says "first")
    const RULES = {
      guess: o => L.gain('eye', Math.max(1, Math.round((o.score || 0) / 20)), o.score >= 80 ? 'a guess inside the margin' : ''),
      survey: o => L.gain('bearings', o.first ? 6 : 1, o.first ? `${o.name}: the whole view taken in` : ''),
      spot: o => { if (L.first('spot', o.id)) L.gain('bearings', 1); },
      area: o => { if (L.first('area', o.id)) L.gain('bearings', 1); },
      stamp: o => L.gain('bearings', 2),
      sun: o => L.gain('light', 5, 'a sun study'),
      photo: o => { const k = `${ctx.clock.y}-${ctx.clock.m}-${ctx.clock.d}:${o.golden ? 'g' : 'd'}`; if (L.first('photo', k)) L.gain('light', o.golden ? 4 : 1, o.golden ? `a picture at ${o.hour}` : ''); },
      ride: o => { if (o.kind === 'cab') o = Object.assign({}, o, { kind: 'taxi' }); const k = `${o.kind}:${o.from || ''}>${o.to || ''}`; L.gain('lines', L.first('ride', k) ? (o.kind === 'taxi' || o.kind === 'lift' ? 2 : 4) : 1, L.first('ridekind', o.kind) ? `first ${o.kind === 'rail' ? 'train' : o.kind}` : ''); },
      dish: o => { if (!city().dishes.includes(o.id)) { city().dishes.push(o.id); L.gain('taste', 3, o.name); } },
    };
    // ---- the score (music.js): the hour, the weather, the place and what you are doing, told to it once a second.
    // It starts with the game's sound (a browser allows none before a click or a key) and has its own volume in the menu
    if (window.OEMusic) {
      const music = L.music = OEMusic.create();
      const KYOTO = /^(kyoto|higashiyama|fushimi-inari|tetsugaku)$/;
      const palette = () => (data.music && data.music.palette) || (KYOTO.test(ctx.cityId) ? 'kyoto' : { Japan: 'tokyo', Australia: 'sydney', 'New Zealand': 'alpine' }[ctx.country] || null);
      let t = 0;
      L.use({ tick(dt, paused, titled) {
        if ((t += dt) < 1) return;
        t = 0;
        const A = ctx.A;
        if (!A.on || !A.ctx || !A.musicBus) return;
        if (ctx.quiet && ctx.quiet()) { if (music.playing) music.stop(); return; } // (a performance is on: the score rests)
        if (!music.playing && !music.off && !titled) music.start(A.ctx, A.musicBus());
        if (!music.playing) return;
        const wx = L.day ? L.day.weather() : { rain: 0 }, on = L.day ? L.day.today().find(e => L.day.onNow(e)) : null;
        music.set({ slot: L.day ? L.day.slot : null, hour: ctx.clock.min / 60, rain: wx.rain, snow: wx.kind === 'snow', palette: palette(), district: ctx.cityId,
          mode: ['car', 'ride', 'ferry', 'heli', 'rail'].includes(ctx.player.mode) ? ctx.player.mode : 'foot', talking: ctx.dlg.open, event: on ? on.id : null });
      } });
      ctx.signal.addEventListener('abort', () => music.stop());
      // the menu's row: the music's own volume, beside the Sound switch (which silences everything)
      const snd = ctx.$('#gm-sound');
      if (snd && !ctx.$('#gm-music')) {
        const f = document.createElement('div');
        f.className = 'field';
        f.innerHTML = '<label for="gm-music"><span>Music</span><output class="num" id="gm-music-v"></output></label><input type="range" id="gm-music" min="0" max="100" step="5" aria-label="Music volume">';
        snd.closest('label').after(f);
      }
      const sl = ctx.$('#gm-music'), out = ctx.$('#gm-music-v');
      if (sl) {
        const show = () => { sl.value = String(Math.round(music.volume() * 100)); out.textContent = music.off ? 'Off' : music.playing ? music.describe() : `${sl.value}%`; };
        ctx.on(sl, 'input', () => { music.volume(+sl.value / 100); if (!music.off && !music.playing && ctx.A.ctx) music.start(ctx.A.ctx, ctx.A.musicBus()); show(); });
        ctx.on(ctx.$('#g-menu'), 'pointerenter', show);
        show();
      }
    }
    window.addEventListener('pagehide', () => { if (dirty) L.save(); }, { signal: ctx.signal });
    return L;
  }
  return { create, SKILLS, levelOf, KEY };
})();
