// Bonds: the people of a map you get to know. Each has five ranks; a rank is a short scene when they
// are free (their own hours, days and weather), with a true fact about the place, a question whose
// good answer keeps the hour from slipping by, and at set ranks an ability: a word with the cabbies,
// a key to a roof, a job. Between ranks they may ask something of you (a request), met by doing it
// in the city: the game reports what happens (life.emit) and the request listens.
// A map's people are life.json "bonds"; what you have with each is kept in the save (life.js).
'use strict';
window.OEBonds = (function () {
  const MAX = 5;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function create(L) {
    const ctx = L.ctx, c = ctx.clock;
    const all = () => L.data.bonds || [];
    const st = id => { const b = L.city().bonds; return b[id] || (b[id] = { rank: 0, slot: '', req: null, met: 0 }); };
    const npcOf = b => ctx.npcs.find(n => n.id === b.npc);
    const free = b => L.day.onNow(b.hours);
    const slotKey = () => `${L.day.date}|${L.day.slot}`;
    // a request met? ev and o are what the game reported
    function meets(r, ev, o) {
      if (!r || r.type !== ev) return false;
      if (r.type === 'guess') return (o.score || 0) >= (r.score || 0);
      if (r.type === 'photo') return (!r.golden || o.golden) && (!r.near || Math.hypot(ctx.player.x - r.near[0], ctx.player.y - r.near[1]) < (r.radius || 120));
      if (r.type === 'ride') return !r.kind || r.kind === o.kind || (r.kind === 'taxi' && o.kind === 'cab');
      if (r.type === 'skill') return L.level(r.skill) >= r.level;
      return r.id == null || r.id === o.id;
    }
    const pending = b => { const s = st(b.npc), r = s.rank > 0 && s.rank < MAX ? b.ranks[s.rank - 1].request : null; return r && !(s.req && s.req.done) ? r : null; };
    function heard(ev, o) {
      for (const b of all()) {
        const r = pending(b);
        if (!r) continue;
        if (meets(r, ev, o) || (r.type === 'skill' && L.level(r.skill) >= r.level)) done(b, r);
      }
    }
    function done(b, r) {
      const s = st(b.npc), n = npcOf(b);
      s.req = { done: true };
      ctx.H.toast(`<b>Done for ${n ? n.name : b.npc}</b><span>${esc(r.text)}</span>`);
      if (ctx.A.chime) ctx.A.chime();
      L.note(`For ${n ? n.name : b.npc}: ${r.text}`, 'request');
    }
    L.on('*', heard);
    // what you have been given, by the ranks reached
    function abilities() {
      const out = [];
      for (const b of all()) { const s = st(b.npc), n = npcOf(b); for (let i = 0; i < s.rank; i++) if (b.ranks[i].gives) out.push(Object.assign({ from: n ? n.name : b.npc }, b.ranks[i].gives)); }
      return out;
    }
    const ability = id => abilities().filter(a => a.id === id).sort((x, y) => (y.value || 0) - (x.value || 0))[0] || null;

    // ---- a talk with someone you can get to know (after the quests have had their say)
    function talk(n) {
      const b = all().find(x => x.npc === n.id);
      if (!b) return false;
      const s = st(b.npc), end = () => { n.talking = false; };
      s.met = s.met || 1;
      if (s.rank >= MAX) return false;
      const r = pending(b), next = b.ranks[s.rank];
      if (!next) return false;
      if (r) { ctx.dlg.show(n, [ctx.said(r.ask || `Did you get to it? ${r.text}.`)], null, end); return true; }
      if (!free(b)) {
        if (s.rank === 0) return false; // not yet someone you know: their everyday line
        ctx.dlg.show(n, [ctx.said(b.busy || `Can't stop now. Find me ${L.day.whenOn(b.hours)}.`)], null, end);
        return true;
      }
      if (s.slot === slotKey()) return false; // you have had this part of the day together
      if (next.needs && L.level(next.needs.skill) < next.needs.level) {
        const sk = L.SKILLS.find(k => k.id === next.needs.skill);
        ctx.dlg.show(n, [ctx.said(next.needs.text || `There's more I could show you, when you know the city better.`)], null, () => { end(); ctx.H.toast(`<b>${n.name}</b><span>Needs ${sk.name} ${next.needs.level}: ${sk.levels[next.needs.level - 1]}</span>`); });
        return true;
      }
      const slot = L.day.SLOT_NAME[L.day.slot].toLowerCase();
      ctx.dlg.show(n, [ctx.said((next.invite || '').replace('{slot}', slot) || (s.rank ? `Good timing. Have you a little of the ${slot} to spare?` : `You're new here, aren't you? If you have a little of the ${slot}, I'll show you something.`))],
        [{ text: `Spend the ${slot} with ${n.name.split(' ')[0]}`, go: true }, { text: 'Another time' }], ch => {
          if (!ch || !ch.go) return end();
          scene(n, b, next, end);
        });
      return true;
    }
    function scene(n, b, rank, end) {
      const lines = rank.talk.map(ctx.said).filter(Boolean);
      const ask = rank.ask;
      ctx.dlg.show(n, ask ? lines.concat(ctx.said(ask.q)) : lines, ask ? ask.options.map(o => ({ text: o.text, o })) : null, ch => {
        const o = ch && ch.o;
        if (o && o.reply) ctx.dlg.show(n, [ctx.said(o.reply)], null, () => rankUp(n, b, rank, !!o.good, end));
        else rankUp(n, b, rank, !!(o && o.good), end);
      });
    }
    function rankUp(n, b, rank, warm, end) {
      const s = st(b.npc);
      s.rank++; s.slot = slotKey(); s.req = null;
      end();
      L.note(`${n.name}: rank ${s.rank}${rank.title ? ` · ${rank.title}` : ''}`, 'rank');
      if (rank.fact) L.note(rank.fact, 'fact');
      const g = rank.gives;
      if (L.ui && L.ui.banner) L.ui.banner({ kind: 'rank', eyebrow: `${n.name} · ${b.title || n.role}`, title: `Rank ${s.rank}`, sub: g ? `${g.name}: ${g.text}` : rank.title || '', pips: [s.rank, MAX], color: n.color });
      else ctx.H.toast(`<b>${n.name}: rank ${s.rank}</b><span>${g ? `${g.name}: ${g.text}` : rank.title || ''}</span>`, 'stamp');
      if (ctx.A.chime) ctx.A.chime();
      if (L.music) L.music.sting('rank');
      if (g && g.id === 'xp') L.gain(g.skill, g.value);
      L.emit('rank', { id: b.npc, rank: s.rank, gives: g });
      const req = s.rank < MAX ? rank.request : null;
      if (req) setTimeout(() => ctx.H.toast(`<b>${n.name} asks</b><span>${esc(req.text)}</span>`), 3600);
      L.save();
      // the hour: it went with them, unless the talk was a good one
      if (warm) setTimeout(() => ctx.H.toast(`The ${L.day.SLOT_NAME[L.day.slot].toLowerCase()} is still yours: that went well.`), 5200);
      else if (ctx.held && ctx.held()) L.day.passTo(L.day.nextSlot()); // (a harness holds the world: no timers)
      else setTimeout(() => L.day.passTo(L.day.nextSlot()), 2600);
    }
    // ---- where they are at this hour: life.json bonds[].places, each { slots, weekdays, hours, weather, at, where, face },
    // the first that is on now; none on, they keep their own place (game.json). They move while you are not there to
    // see it (out of sight past 60 m of both places), or at once when the hour turns under the veil of passing time
    const home = new Map();
    const placeOf = b => (b.places || []).find(p => L.day.onNow(p)) || null;
    const whereOf = b => { const p = placeOf(b); return (p && p.where) || b.where || ''; };
    const SEEN_M = 60;
    function rounds(now) {
      for (const b of all()) {
        if (!b.places) continue;
        const n = npcOf(b);
        if (!n || !ctx.npcMove) continue;
        if (!home.has(b.npc)) home.set(b.npc, { at: [n.x, n.y, n.z], h: n.h, p: null });
        const hm = home.get(b.npc), p = placeOf(b), want = p ? p.at : hm.at;
        if (hm.p === p || n.talking) continue;
        const P = ctx.player, far = q => Math.hypot(P.x - q[0], P.y - q[1]) > SEEN_M;
        if (!now && !(far([n.x, n.y]) && far(want))) continue;
        if (ctx.npcMove(n, p ? p.at : hm.at, p ? (p.face != null ? p.face * Math.PI / 180 : null) : hm.h)) {
          hm.p = p;
          L.emit('moved', { id: b.npc, where: whereOf(b), at: [n.x, n.y] });
        }
      }
    }
    L.on('pass', () => rounds(true)); // (under the veil)
    // requests that are a place to be at (a "visit"): looked at twice a second
    let acc = 0, first = true;
    function tick(dt, paused, titled) {
      if (titled || paused || (acc += dt) < 0.5) return;
      acc = 0;
      rounds(first); first = false;
      for (const b of all()) {
        const r = pending(b);
        if (r && r.type === 'visit' && L.day.onNow(r.when) && Math.hypot(ctx.player.x - r.at[0], ctx.player.y - r.at[1]) < (r.radius || 30)) done(b, r);
      }
    }

    // ---- the diary's page of people
    function page() {
      if (!all().length) return '<p class="note">Nobody to know here yet.</p>';
      return `<ul class="lf-people">${all().map(b => {
        const n = npcOf(b), s = st(b.npc), r = pending(b), got = b.ranks.slice(0, s.rank).map(x => x.gives).filter(Boolean);
        const pips = Array.from({ length: MAX }, (_, i) => `<i class="${i < s.rank ? 'on' : ''}"></i>`).join('');
        const next = s.rank >= MAX ? 'You know each other well.' : r ? `Asked of you: ${r.text}` : !s.met ? 'Not met yet.' : free(b) ? (s.slot === slotKey() ? 'You have talked this part of the day.' : 'Free to talk now.') : `Free ${L.day.whenOn(b.hours) || 'another time'}.`;
        return `<li class="${free(b) && s.rank < MAX && !r ? 'on' : ''}" style="--npc:${(n && n.color) || 'var(--accent)'}"><div class="who"><b>${esc(n ? n.name : b.npc)}</b><span>${esc(b.title || (n && n.role) || '')}</span></div>`
          + `<div class="pips" aria-label="Rank ${s.rank} of ${MAX}">${pips}<span class="num">${s.rank}/${MAX}</span></div>`
          + `<p>${esc(whereOf(b) ? `${whereOf(b)}. ` : '')}${esc(next)}</p>`
          + (got.length ? `<p class="got">${got.map(g => `<span>${esc(g.name)}</span>`).join('')}</p>` : '') + '</li>';
      }).join('')}</ul>`;
    }
    L.day.addTab({ id: 'people', title: 'People', render: page, badge: () => all().filter(b => free(b) && st(b.npc).rank < MAX && st(b.npc).met && !pending(b) && st(b.npc).slot !== slotKey()).length || '' });
    (L.partsToday || (L.partsToday = [])).push(() => all().filter(b => st(b.npc).rank < MAX).map(b => { const n = npcOf(b), s = st(b.npc); return { title: n ? n.name : b.npc, note: `${whereOf(b) || (n && n.role) || ''}${free(b) ? '' : ` · ${L.day.whenOn(b.hours)}`}${s.rank ? ` · rank ${s.rank}` : ''}`, on: free(b) }; }));
    const B = { MAX, all, st, free, pending, ability, abilities, talk, meets, placeOf, whereOf, rounds,
      // who would talk now: for the map's marks and the phone
      ready: () => all().filter(b => st(b.npc).rank < MAX && free(b) && !pending(b) && st(b.npc).slot !== slotKey()) };
    L.use({ talk, tick, load() { first = true; } });
    L.bonds = B;
    return B;
  }
  return { create, MAX };
})();
