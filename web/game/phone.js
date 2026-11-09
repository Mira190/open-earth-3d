// The phone as the hub of the day (N): messages from the people you know and from the calendar, the
// diary, the map, the camera and the work on offer, beside the ride app that was there already
// (game.js draws the ride's pages; this adds the home screen's rows and the messages).
// Messages arrive as a part of the day begins: someone you know is free, something is on tonight.
'use strict';
window.OEPhone = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function create(L) {
    const ctx = L.ctx, c = ctx.clock;
    const box = () => { const ci = L.city(); return ci.msgs || (ci.msgs = []); };
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
      b.push({ from, text, key, d: `${c.d}/${c.m}`, t: Math.round(c.min) });
      if (b.length > 24) b.splice(0, b.length - 24);
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
        post(n.name, b.ranks[s.rank].message || `I'm ${(b.where || 'about').replace(/^[A-Z]/, m => m.toLowerCase())} this ${day.SLOT_NAME[o.slot].toLowerCase()}, if you're passing.`, `${key}|${b.npc}`);
        break; // one invitation at a time
      }
      for (const e of day.today()) if (day.onNow(e)) post('Calendar', `${e.title}${e.where ? `, ${e.where}` : ''}: on now.`, `${o.date}|${e.id}`);
      if (o.newDay) for (const [n, e] of day.soon(1)) post('Calendar', `Tomorrow: ${e.title}${e.where ? `, ${e.where}` : ''}.`, `${o.date}|soon|${e.id}`);
    });
    const Ph = {
      unread, post, box,
      // the home screen's rows, after the ride app's (item(text, note, act) makes a row; show(view) changes page)
      home(item, show) {
        const n = unread(), day = L.day, free = L.bonds ? L.bonds.ready().filter(b => L.bonds.st(b.npc).met).length : 0;
        return item('Messages', n ? `${n} new` : box().length ? 'Nothing new' : 'Nothing yet', () => show('messages'))
          + item('Diary', `${day.SLOT_NAME[day.slot]}${day.today().length ? ` · ${day.today()[0].title}` : ''}${free ? ` · ${free} free to talk` : ''}`, () => { show(false); day.show(); })
          + item('Work', L.jobs && L.jobs.active ? `On a job: ${L.jobs.active.j.title}` : `Wallet ${L.fmt(L.money)}`, () => { show(false); day.show(); const b = document.querySelector('.lf-tabs button[data-tab="work"]'); if (b) b.click(); })
          + item('Map', 'Travel, waypoints', () => { show(false); ctx.map(); })
          + item('Camera', 'Photo mode', () => { show(false); ctx.photo(); });
      },
      view: v => v === 'messages',
      title: () => 'Messages',
      render() {
        const b = box().slice().reverse();
        for (const m of box()) m.read = 1;
        badge();
        return (b.length ? `<ul class="lf-msgs">${b.map(m => `<li class="${m.read ? '' : 'new'}"><b>${esc(m.from)}</b><span class="num">${m.d} ${String(Math.floor(m.t / 60)).padStart(2, '0')}:${String(m.t % 60).padStart(2, '0')}</span><p>${esc(m.text)}</p></li>`).join('')}</ul>` : '<p class="note">No messages yet. People write once you know them.</p>')
          + '<div class="row"><button class="btn" data-back>Back</button></div>';
      },
    };
    L.use({ load: badge, reset: badge });
    L.phone = Ph;
    badge();
    return Ph;
  }
  return { create };
})();
