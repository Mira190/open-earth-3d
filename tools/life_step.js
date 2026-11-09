// The daily life's step of tools/game_check.js (issue #357): a day passing, a skill growing, a rank
// earned with someone, a job done and paid, a dish bought, an event of the calendar kept, and all of
// it still there when the save is read back. A map without a life.json is checked for the day and
// the diary only. Runs with the world held (window.__game.hold), on a save of its own that it puts
// back afterwards, so the steps after it meet the game as they would have.
//   const { lifeStep } = require('./life_step');  await lifeStep(p, check, city);
//   xvfb-run -a node tools/life_step.js shibuya        # alone
async function lifeStep(p, check, city) {
  const r = await p.evaluate(async () => {
    const g = window.__game, L = g.life, out = { has: !!L };
    if (!L) return out;
    const kept = localStorage.getItem('oe3d-life'), c = g.clock, was = { y: c.y, m: c.m, d: c.d, min: c.min, frozen: c.frozen, x: g.player.x, y0: g.player.y, z: g.player.z };
    const held = g.held();
    g.hold(true);
    // (the steps before may leave you in a cab or your car: the day's life is lived on foot, so for this step you are,
    // and afterwards you are back where you were, in what you were in)
    const mode0 = g.player.mode;
    g.player.mode = 'foot';
    L.wipe();
    const D = L.day, talkOut = () => { for (let i = 0; i < 40 && g.dlg.open && !g.dlg.hasChoices; i++) { g.dlg.next(false); g.dlg.tick(5); } };
    try {
      // ---- the day
      g.advance(1);
      out.slot0 = D.slot; out.cards0 = D.cardShown().n; out.days0 = L.city().days;
      const date0 = D.date;
      D.passTo(D.nextSlot()); g.advance(1);
      out.slot1 = D.slot; out.cards1 = D.cardShown().n;
      D.passTo('morning'); g.advance(1); // round to tomorrow morning at the latest
      if (D.date === date0) { D.passTo('night'); g.advance(1); D.passTo('morning'); g.advance(1); }
      out.newDay = D.date !== date0; out.days1 = L.city().days; out.cardKind = D.cardShown().kind; out.slot2 = D.slot;
      D.show(); out.diary = !!document.querySelector('.lf-diary .lf-head'); out.tabs = [...document.querySelectorAll('.lf-tabs button')].map(b => b.dataset.tab);
      for (const t of out.tabs) document.querySelector(`.lf-tabs button[data-tab="${t}"]`).click();
      D.close();
      // ---- a skill
      const eye0 = L.xp('eye'); L.emit('guess', { score: 90 }); out.eye = L.xp('eye') - eye0;
      // ---- the map's own life (web/data/<id>/life.json)
      for (let i = 0; i < 50 && !L.data.bonds.length && !L.data.jobs.length; i++) await new Promise(r => setTimeout(r, 100));
      out.bonds = L.data.bonds.length; out.jobs = L.data.jobs.length; out.shops = L.data.shops.length; out.events = L.data.events.length;
      if (g.weather) g.weather.set('clear', { now: true });
      const b = L.data.bonds[0];
      if (b) {
        const n = g.npcs.find(x => x.id === b.npc), slot = (b.hours && b.hours.slots ? b.hours.slots[0] : 'daytime');
        if (D.slot !== slot) { D.passTo(slot); g.advance(1); }
        // a weekday they keep
        for (let i = 0; i < 7 && !L.bonds.free(b); i++) { g.setClock(c.y, c.m, c.d, c.min + 1440); g.advance(1); }
        out.free = L.bonds.free(b);
        const before = D.slot;
        out.talked = L.bonds.talk(n); talkOut();
        out.offer = g.dlg.hasChoices;
        g.dlg.choose(0); talkOut();
        if (g.dlg.hasChoices) { const k = b.ranks[0].ask.options.findIndex(o => !o.good); g.dlg.choose(k < 0 ? 0 : k); talkOut(); }
        g.advance(1);
        out.rank = L.bonds.st(b.npc).rank; out.spent = D.slot !== before; out.npcFree = !n.talking;
        out.banner = L.ui.shown().some(o => o.kind === 'rank');
        out.again = L.bonds.talk(n) && !g.dlg.hasChoices; talkOut(); // a request to do first, or their everyday line: not another rank in the same hour
        if (g.dlg.open) { g.dlg.choose(1); talkOut(); }
        out.rankSame = L.bonds.st(b.npc).rank === out.rank;
      }
      // ---- a job: a delivery where the map has one, else the first
      const j = L.data.jobs.find(x => x.type === 'deliver' && !x.needs) || L.data.jobs.find(x => x.type === 'point');
      if (j) {
        const lock = j.locked; j.locked = false;
        const slot = j.when && j.when.slots ? j.when.slots[0] : D.slot;
        if (D.slot !== slot) { D.passTo(slot); g.advance(1); }
        const m0 = L.money, P = g.player, put = at => { P.x = at[0]; P.y = at[1]; P.z = at[2] != null ? at[2] : g.nav.terrain(at[0], at[1]); };
        out.took = L.jobs.start(j.id);
        put(j.at); g.advance(1);
        out.running = !!(L.jobs.active && L.jobs.active.phase === 'run');
        if (j.type === 'deliver') { put(j.to); g.advance(1); }
        else for (let i = 0; i < j.targets.length; i++) { const a = g.currentAction(); out.pointAct = !!(a && /That way/.test(a.text)); L.jobs.pointAt(); }
        out.paid = L.money - m0; out.jobDone = !L.jobs.active && L.jobs.st(j.id).n === 1; out.jobType = j.type;
        out.twice = L.jobs.start(j.id); // not again in the same part of the day
        j.locked = lock;
      }
      // ---- a counter and the calendar
      const s = L.data.shops[0];
      if (s) {
        const m0 = L.money, t0 = L.xp('taste');
        g.setClock(c.y, c.m, c.d, s.hours ? +s.hours[0].slice(0, 2) * 60 + 90 : c.min); g.advance(1);
        g.player.x = s.at[0]; g.player.y = s.at[1]; if (s.at[2] != null) g.player.z = s.at[2];
        const a = L.action(); out.counter = !!(a && a.act);
        if (a && a.act) { a.act(); talkOut(); g.dlg.choose(s.menu.findIndex(m => !m.keep)); talkOut(); }
        out.dish = m0 - L.money; out.taste = L.xp('taste') - t0;
      }
      const e = L.data.events.find(x => x.at);
      if (e) {
        const md = e.dates ? e.dates[0] : e.days[0], b2 = () => D.bounds();
        g.setClock(c.y, md[0], md[1], 720); g.advance(1);
        if (e.slots) { g.setClock(c.y, md[0], md[1], b2()[e.slots[0]] + 5); g.advance(1); }
        if (e.hours) { g.setClock(c.y, md[0], md[1], +e.hours[0].slice(0, 2) * 60 + +e.hours[0].slice(3) + 5); g.advance(1); }
        out.listed = D.today().some(x => x.id === e.id);
        g.player.x = e.at[0]; g.player.y = e.at[1]; if (e.at[2] != null) g.player.z = e.at[2];
        const a = L.action(); out.eventAct = !!(a && a.act);
        if (a && a.act) { a.act(); talkOut(); }
        out.kept = !!L.city().events[e.id];
      }
      // ---- fireworks, where the calendar has them
      const fw = L.data.events.find(x => x.fx === 'fireworks' && x.at);
      if (fw && L.fx) {
        const md = fw.dates ? fw.dates[0] : fw.days[0];
        g.setClock(c.y, md[0], md[1], fw.hours ? +fw.hours[0].slice(0, 2) * 60 + +fw.hours[0].slice(3) + 2 : D.bounds().night + 30);
        for (let i = 0; i < 8; i++) g.advance(0.5);
        out.fireworks = L.fx.alive(); out.fwOn = !!L.fx.on;
        g.setClock(c.y, md[0], md[1], 720); for (let i = 0; i < 12; i++) g.advance(0.5);
        out.fwOff = L.fx.alive();
      }
      // ---- the score: it starts with the sound and follows the hour and the weather
      if (L.music && g.life.ctx.A.start) {
        L.ctx.A.start();
        g.advance(1.2); g.advance(1.2);
        out.music = L.music.playing; out.score0 = L.music.describe();
        if (out.music) { D.passTo('night'); if (g.weather) g.weather.set('rain', { now: true }); g.advance(1.2); g.advance(1.2); out.want = L.music.state; await new Promise(r => setTimeout(r, 6000)); out.score1 = L.music.describe(); if (g.weather) g.weather.set('clear', { now: true }); }
        out.vol = (() => { const v = L.music.volume(); L.music.volume(0); const off = L.music.off; L.music.volume(v); return off && L.music.volume() === v; })();
      }
      // ---- the save, read back
      L.save();
      const snap = JSON.stringify([L.store.skills, L.store.wallets, L.city().bonds, L.city().jobs, L.city().days]);
      L.store.skills.eye = 0;
      out.reloaded = L.reload();
      out.restored = JSON.stringify([L.store.skills, L.store.wallets, L.city().bonds, L.city().jobs, L.city().days]) === snap;
      out.passport = (() => { g.renderPassport(); return document.querySelectorAll('#g-pass .lf-skills li').length; })();
    } catch (err) { out.error = String(err && err.stack || err).slice(0, 400); }
    // as it was
    L.jobs.drop(); L.close(); while (g.dlg.open) { if (g.dlg.hasChoices) g.dlg.choose(0); else g.dlg.next(false); g.dlg.tick(5); }
    if (kept == null) localStorage.removeItem('oe3d-life'); else localStorage.setItem('oe3d-life', kept);
    if (!L.reload()) L.wipe();
    if (g.weather) g.weather.set('live');
    g.setClock(was.y, was.m, was.d, was.min); c.frozen = was.frozen;
    g.player.mode = mode0;
    g.player.x = was.x; g.player.y = was.y0; g.player.z = was.z;
    g.waypoint(null);
    g.advance(0.2);
    document.querySelectorAll('.lf-card, .lf-banner').forEach(el => el.remove());
    if (!held) g.hold(false);
    return out;
  });
  if (!r.has) { check(false, 'daily life: life.js is loaded'); return r; }
  check(!r.error, `daily life: the step ran${r.error ? ` (${r.error})` : ''}`);
  check(r.cards0 >= 1 && r.days0 === 1, `the day: a card for day 1 as play begins (${r.slot0})`);
  check(r.slot1 !== r.slot0 && r.cards1 > r.cards0, `the day: passing the time moves on to the next part of it (${r.slot0} to ${r.slot1}), with its card`);
  check(r.newDay && r.days1 === r.days0 + 1 && r.slot2 === 'morning' && r.cardKind === 'day', `the day: on to tomorrow morning, day ${r.days1}`);
  check(r.diary && r.tabs.includes('today') && r.tabs.includes('people') && r.tabs.includes('work') && r.tabs.includes('log'), `the diary opens on today, with its pages (${(r.tabs || []).join(', ')})`);
  check(r.eye > 0 && r.passport === 5, `the passport: a good guess grows the eye (+${r.eye}), and its five skills are drawn`);
  if (r.bonds) {
    check(r.free && r.talked && r.offer, `bonds: ${city}'s first is free at their hour and offers the time`);
    check(r.rank === 1 && r.banner && r.npcFree, 'bonds: a rank earned, with its banner');
    check(r.spent, 'bonds: the talk took the rest of that part of the day');
    check(r.rankSame, 'bonds: no second rank in the same hour');
  }
  if (r.jobs) {
    check(r.took && r.running, `jobs: a ${r.jobType} job taken and started at its place`);
    check(r.jobDone && r.paid > 0, `jobs: done and paid (+${r.paid})`);
    check(!r.twice, 'jobs: not offered again in the same part of the day');
  }
  if (r.shops) check(r.counter && r.dish > 0 && r.taste > 0, `a counter: a dish bought (${r.dish}) grows the taste`);
  if (r.events) check(r.listed && r.eventAct && r.kept, 'the calendar: an event is listed on its date, joined at its place and kept');
  if (r.music != null) check(r.music && r.want && r.want.slot === 'night' && r.want.rain > 0.2 && !!r.want.palette === /Japan|Australia|New Zealand/.test(r.country || 'Japan') && r.vol, `the score plays with the sound and follows the hour and the weather ("${r.score0}" to "${r.score1}"), with its own volume`);
  if (r.fireworks != null) check(r.fwOn && r.fireworks > 50 && r.fwOff === 0, `the calendar's fireworks go up while their event is on (${r.fireworks} sparks) and stop after`);
  check(r.reloaded && r.restored, 'the save: skills, wallet, ranks, jobs and days read back as they were');
  return r;
}
module.exports = { lifeStep };

if (require.main === module) (async () => {
  const { chromium } = require('playwright');
  const city = process.argv[2] || 'shibuya';
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const logs = [], fails = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e.stack || e).slice(0, 400)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.life', null, { timeout: 900000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.evaluate(() => { const g = window.__game; g.hold(true); document.getElementById('gt-play').click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const g = window.__game; if (g.overture() && g.overture().active) g.overture().skip(); g.settleArrival(); if (g.cine.active) g.cine.skip(); g.advance(2); });
  const r = await lifeStep(p, (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); }, city);
  if (process.env.DEBUG) console.log(JSON.stringify(r));
  if (logs.length) console.log(logs.join('\n'));
  await b.close();
  process.exit(fails.length || logs.some(l => /pageerror/.test(l)) ? 1 : 0);
})();
