// The phone as the hub of the day (N): messages from the people you know and from the calendar, the
// diary, the map, the camera and the work on offer, beside the ride app that was there already
// (game.js draws the ride's pages; this adds the home screen's rows and the messages).
// Messages arrive as a part of the day begins: someone you know is free, something is on tonight.
'use strict';
window.OEPhone = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function create(L) {
    const ctx = L.ctx, c = ctx.clock;
    // ---- the box: one message for one thing said, in the order of the city's clock
    // A message has a key (what it is about: a calendar event's run, a friend's hour) and the date and minute it came.
    // tidy() keeps the box true to that whatever wrote it: a save from before a season was one message (a key for
    // each day it was on) is keyed again by the event's run, a key is there once (the first time it came), the same
    // words from the same sender once (the last time), and the box is in time order, oldest first, at most MAX long.
    const MAX = 24, tidied = new WeakSet();
    let loaded = false;
    const when = m => { const [d, mo] = String(m.d).split('/').map(Number); return (((m.y || 0) * 12 + (mo || 0)) * 31 + (d || 0)) * 1440 + (m.t || 0); };
    const OLD = /^(\d+)-(\d+)-(\d+)\|(soon\|)?([^|]+)$/; // a calendar key as it was: the day it was posted, and the event
    function tidy(b) {
      const evs = (L.data && L.data.events) || [], D = window.OEDay;
      for (const m of b) {
        const k = /^(\d+)-\d+-\d+\|/.exec(m.key || ''), [d, mo] = String(m.d).split('/').map(Number);
        // the year it came in: written since, in an older key's date, or else the last time that day came round
        if (!m.y) m.y = k ? +k[1] : (mo > c.m || (mo === c.m && d > c.d) ? c.y - 1 : c.y);
        const o = m.from === 'Calendar' && OLD.exec(m.key || ''), e = o && evs.find(x => x.id === o[5]);
        if (!e) continue;
        const t = new Date(Date.UTC(+o[1], +o[2] - 1, +o[3] + (o[4] ? 1 : 0))), run = D.runOf(e, t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
        if (run) m.key = `${o[4] ? 'soon' : 'on'}|${e.id}|${run}`;
      }
      const sorted = b.map((m, i) => [when(m), i, m]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]);
      const keys = new Set(), said = new Set(), out = [];
      for (const m of sorted) { if (m.key && keys.has(m.key)) continue; if (m.key) keys.add(m.key); out.push(m); }
      // (the same words are told apart from an old key's copies only once the calendar is read: until then they stay)
      for (let i = out.length - 1; i >= 0 && loaded; i--) { const s = `${out[i].from}\n${out[i].text}`; if (said.has(s)) out.splice(i, 1); else said.add(s); }
      b.splice(0, b.length, ...out.slice(-MAX));
      tidied.add(b);
      return b;
    }
    // (a save is tidied once the map's calendar is read: an old key needs its event's dates)
    const raw = () => { const ci = L.city(); return ci.msgs || (ci.msgs = []); };
    const box = () => { const b = raw(); return loaded && !tidied.has(b) ? tidy(b) : b; };
    const unread = () => box().filter(m => !m.read).length;
    function badge() {
      const b = ctx.$('#g-phone-btn');
      if (!b) return;
      let i = b.querySelector('.lf-badge');
      const n = unread();
      if (!n) { if (i) i.remove(); return; }
      if (!i) { i = document.createElement('span'); i.className = 'lf-badge num'; b.appendChild(i); }
      i.textContent = n;
    }
    function post(from, text, key) {
      const b = box();
      if (key && b.some(m => m.key === key)) return;
      // the same words again from the same sender (a friend free at the same place the next evening): the one message, come again
      const i = b.findIndex(m => m.from === from && m.text === text);
      if (i >= 0) b.splice(i, 1);
      b.push({ from, text, key, y: c.y, d: `${c.d}/${c.m}`, t: Math.round(c.min) });
      tidy(b);
      ctx.H.toast(`<b>Message · ${esc(from)}</b><span>${esc(text)}</span>`);
      if (L.music) L.music.sting('message'); else if (ctx.A.beep) ctx.A.beep(520);
      badge();
    }
    // as a part of the day begins: who is free that you know, and what is on
    L.on('slot', o => {
      const day = L.day, key = `${o.date}|${o.slot}`;
      // the first day on a map: where the loop is
      if (L.city().days === 1 && !L.city().flags.hello) {
        L.city().flags.hello = 1;
        post('Diary', `Day 1 in ${ctx.cityName}. People here keep their hours and so do the counters: your diary (${ctx.touch ? 'the Diary button' : 'J'}) has today's page, who is free to talk and what work is going.`, 'hello');
      }
      for (const b of (L.bonds ? L.bonds.ready() : [])) {
        const s = L.bonds.st(b.npc), n = ctx.npcs.find(x => x.id === b.npc);
        if (!s.rank || !n) continue;
        post(n.name, b.ranks[s.rank].message || `I'm ${(L.bonds.whereOf(b) || 'about').replace(/^[A-Z]/, m => m.toLowerCase())} this ${day.SLOT_NAME[o.slot].toLowerCase()}, if you're passing.`, `${key}|${b.npc}`);
        break; // one invitation at a time
      }
      // a friend who reads the weather: rain on its way within six hours, once a day
      const fa = L.ability('forecast'), f = fa && !day.weather().wet && day.forecast(6, 1);
      if (f && f.from != null) post(fa.from, `${fa.rain || 'Rain on the way'}: from about ${day.hm(f.from)}${f.to != null ? ` to ${day.hm(f.to)}` : ''}. ${fa.tip || 'Somewhere with a roof, then.'}`, `${o.date}|rain`);
      // the calendar writes once for each run of an event (a season of four weeks is one message, not one a day),
      // and once the day before it begins
      const next = new Date(Date.UTC(c.y, c.m - 1, c.d + 1));
      for (const e of day.today()) if (day.onNow(e)) post('Calendar', `${e.title}${e.where ? `, ${e.where}` : ''}: on now.`, `on|${e.id}|${day.runOf(e, c.y, c.m, c.d)}`);
      if (o.newDay) for (const [n, e] of day.soon(1)) post('Calendar', `Tomorrow: ${e.title}${e.where ? `, ${e.where}` : ''}.`, `soon|${e.id}|${day.runOf(e, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())}`);
    });
    const pages = []; // other modules' pages (fares.js): { id, title(), on(), row(item, show), render() }
    const Ph = {
      unread, post, box, tidy,
      page(p) { pages.push(p); },
      // the home screen's rows, after the ride app's (item(text, note, act) makes a row; show(view) changes page)
      home(item, show) {
        const n = unread(), day = L.day, free = L.bonds ? L.bonds.ready().filter(b => L.bonds.st(b.npc).met).length : 0;
        return item(`Messages${n ? '<i class="lf-dot" aria-hidden="true"></i>' : ''}`, n ? `${n} new` : box().length ? 'Nothing new' : 'Nothing yet', () => show('messages'))
          + item('Diary', `${day.SLOT_NAME[day.slot]}${day.today().length ? ` · ${day.today()[0].title}` : ''}${free ? ` · ${free} free to talk` : ''}`, () => { show(false); day.show(); })
          + pages.filter(p => p.on()).map(p => p.row(item, show)).join('')
          + item('Work', L.jobs && L.jobs.active ? `On a job: ${L.jobs.active.j.title}` : `Wallet ${L.fmt(L.money)}`, () => { show(false); day.show(); const b = document.querySelector('.lf-tabs button[data-tab="work"]'); if (b) b.click(); })
          + item('Map', 'Travel, waypoints', () => { show(false); ctx.map(); })
          + item('Camera', 'Photo mode', () => { show(false); ctx.photo(); });
      },
      view: v => v === 'messages' || pages.some(p => p.id === v && p.on()),
      title: v => { const p = pages.find(q => q.id === v); return p ? p.title() : 'Messages'; },
      render(v) {
        const pg = pages.find(q => q.id === v);
        if (pg) return pg.render();
        // the newest first; what has not been read is marked as it is drawn, and is read from then on
        const b = box().map((m, i) => [when(m), i, m]).sort((x, y) => y[0] - x[0] || y[1] - x[1]).map(x => x[2]);
        const list = b.map(m => `<li class="${m.read ? '' : 'new'}"><b>${esc(m.from)}</b><span class="num">${m.d} ${String(Math.floor(m.t / 60)).padStart(2, '0')}:${String(m.t % 60).padStart(2, '0')}</span><p>${esc(m.text)}</p></li>`).join('');
        for (const m of b) m.read = 1;
        badge();
        return (b.length ? `<ul class="lf-msgs">${list}</ul>` :'<p class="note">No messages yet. People write once you know them.</p>')
          + '<div class="row"><button class="btn" data-back>Back</button></div>';
      },
    };
    L.use({ load() { loaded = true; tidy(raw()); badge(); }, reset: badge });
    L.phone = Ph;
    badge();
    return Ph;
  }
  return { create };
})();
