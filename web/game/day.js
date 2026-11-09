// The day: morning, daytime, evening and night as the frame of play, on top of the running clock,
// and the diary that shows today (the date, the weather, the sun's hours, what is on, who is free).
// The slots follow the sun of the city's own date, so an evening starts at golden hour in June and
// in December alike. Time gates what is on, never whether you may explore: nothing here stops a
// walker, and "pass the time" in the diary moves the clock to the next slot whenever you like.
//
// A map's calendar is life.json "events": things that happen at a real place on their real dates
// (a festival's nights, the first shrine visit of the year), each with the hours it runs.
'use strict';
window.OEDay = (function () {
  const SLOTS = ['morning', 'daytime', 'evening', 'night'];
  const SLOT_NAME = { morning: 'Morning', daytime: 'Daytime', evening: 'Evening', night: 'Night' };
  const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = n => String(n).padStart(2, '0'), hm = min => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.floor(min % 60))}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const doy = (m, d) => Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 864e5); // (a common year: a calendar's dates, not a year's)
  const dowOf = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

  // an event's dates: "dates": [[m, d], [m, d]] is a run of days (it may pass the new year), "days": [[m, d], ...] single ones
  function eventOn(ev, m, d) {
    if (ev.days) return ev.days.some(x => x[0] === m && x[1] === d);
    if (!ev.dates) return true;
    const a = doy(...ev.dates[0]), b = doy(...ev.dates[1]), t = doy(m, d);
    return a <= b ? t >= a && t <= b : t >= a || t <= b;
  }
  function daysUntil(ev, m, d) { // to its next first day, 0 when it is on
    if (eventOn(ev, m, d)) return 0;
    const t = doy(m, d), starts = ev.days ? ev.days.map(x => doy(...x)) : [doy(...ev.dates[0])];
    return Math.min(...starts.map(s => (s - t + 365) % 365));
  }

  function create(L) {
    const ctx = L.ctx, S = ctx.S, c = ctx.clock, $ = ctx.$, stage = ctx.stage;
    // ---- the slots of a date, from its sun
    let bKey = '', B = null;
    function bounds() {
      const k = `${c.y}-${c.m}-${c.d}`;
      if (k === bKey) return B;
      const t = kind => S.presetTime(kind, c.y, c.m, c.d);
      const sunrise = t('sunrise') ?? 360, golden = t('golden') ?? 1020, sunset = t('sunset') ?? 1080, night = t('night') ?? 1260;
      const morning = clamp(sunrise - 30, 240, 420), evening = clamp(golden, 900, 1170);
      bKey = k;
      return (B = { morning, daytime: 630, evening, night: clamp(night, evening + 60, 1350), sunrise, golden, sunset });
    }
    const slotAt = min => { const b = bounds(); return min < b.morning ? 'night' : min < b.daytime ? 'morning' : min < b.evening ? 'daytime' : min < b.night ? 'evening' : 'night'; };
    const D = {
      SLOTS, SLOT_NAME, eventOn, daysUntil, bounds, slotAt, hm,
      get slot() { return slotAt(c.min); },
      get date() { return `${c.y}-${c.m}-${c.d}`; },
      get dow() { return dowOf(c.y, c.m, c.d); },
      get weekend() { return D.dow >= 5; },
      // the weather as the diary says it (weather.js; one state for the whole game)
      weather() {
        const w = ctx.weather, st = w && w.state;
        const kind = (st && st.kind) || 'clear', names = (window.OEWeather && OEWeather.NAMES) || {};
        return { kind, name: names[kind] || kind[0].toUpperCase() + kind.slice(1), wet: !!(st && st.rain > 0.06), rain: st ? st.rain || 0 : 0 };
      },
      // is something that keeps hours on now? { slots, days (0 = Monday), hours: ["11:00", "22:00"], weather: "rain"|"dry", dates/days as an event }
      onNow(o, at = c.min) {
        if (!o) return true;
        if (o.slots && !o.slots.includes(slotAt(at))) return false;
        if (o.weekdays && !o.weekdays.includes(D.dow)) return false;
        if (o.hours) { const a = S.hm(o.hours[0]), b = S.hm(o.hours[1]); if (a <= b ? at < a || at >= b : at < a && at >= b) return false; }
        if (o.weather === 'rain' && !D.weather().wet) return false;
        if (o.weather === 'dry' && D.weather().wet) return false;
        if ((o.dates || o.days) && !eventOn(o, c.m, c.d)) return false;
        return true;
      },
      // when it is next on, in words: "evenings", "from 11:00", "on Saturdays"
      whenOn(o) {
        if (!o) return '';
        const out = [];
        if (o.slots) out.push(o.slots.map(s => SLOT_NAME[s].toLowerCase() + 's').join(' and '));
        if (o.hours) out.push(`${o.hours[0]} to ${o.hours[1]}`);
        if (o.weekdays) out.push(o.weekdays.length === 2 && o.weekdays.includes(5) && o.weekdays.includes(6) ? 'at the weekend' : `on ${o.weekdays.map(d => DOW[d] + 's').join(', ')}`);
        if (o.weather) out.push(o.weather === 'rain' ? 'when it rains' : 'when it is dry');
        return out.join(', ');
      },
      events: () => (L.data.events || []),
      today: () => D.events().filter(e => eventOn(e, c.m, c.d)),
      soon: (days = 21) => D.events().map(e => [daysUntil(e, c.m, c.d), e]).filter(([n]) => n > 0 && n <= days).sort((a, b) => a[0] - b[0]),
      // ---- pass the time: on to the start of a slot (tomorrow's, when today's has gone)
      passTo(slot) {
        if (ctx.busy && ctx.busy('pass')) { ctx.H.toast('Not while you are on the move.'); return false; }
        const b = bounds(), t = b[slot] + 1, next = t <= c.min;
        veil(() => {
          ctx.setClock(c.y, c.m, c.d, t + (next ? 1440 : 0));
          if (slotAt(c.min) !== slot) ctx.setClock(c.y, c.m, c.d, bounds()[slot] + 1); // (tomorrow's sun is a minute off today's)
          L.emit('pass', { slot }); check(true);
        });
        return true;
      },
      nextSlot: () => SLOTS[(SLOTS.indexOf(D.slot) + 1) % 4],
      show: () => openDiary('today'), close: closeDiary, get open() { return !!diary; },
      tabs: [], card: () => card(true), cardShown: () => shown,
      addTab(t) { D.tabs.push(t); },
    };

    // ---- the card: a new day (the date, the weather, what is on), or a new part of it
    let last = { date: '', slot: '' }, shown = { n: 0, kind: '', date: '', slot: '' }, cardEl = null, cardT = 0, pending = false;
    function veil(fn) { // time passing: the picture dips to dark and comes back on the new hour
      if (ctx.reduced || (ctx.held && ctx.held())) { fn(); return; }
      const v = document.createElement('div');
      v.className = 'lf-veil'; stage.appendChild(v);
      requestAnimationFrame(() => v.classList.add('on'));
      setTimeout(() => { fn(); v.classList.remove('on'); setTimeout(() => v.remove(), 450); }, 420);
    }
    function whatsOn(max = 3) {
      const out = D.today().map(e => ({ t: e.title, s: e.slots ? e.slots.map(s => SLOT_NAME[s]).join(' · ') : 'All day', on: D.onNow(e) }));
      for (const [n, e] of D.soon(7)) out.push({ t: e.title, s: n === 1 ? 'Tomorrow' : `In ${n} days` });
      return out.slice(0, max);
    }
    const quiet = /[?&]cards=0\b/.test(location.search); // (a film or a still of the world alone: ?cards=0 leaves the cards out)
    function card(day) {
      if (cardEl) cardEl.remove();
      if (quiet) { shown = { n: shown.n + 1, kind: day ? 'day' : 'slot', date: D.date, slot: D.slot }; return; }
      const b = bounds(), slot = D.slot, wx = D.weather(), ci = L.city();
      const k = clamp((c.min - b.sunrise) / Math.max(1, b.sunset - b.sunrise), -0.25, 1.25); // the sun along its day
      const el = cardEl = document.createElement('div');
      el.className = `lf-card ${day ? 'day' : 'slot'}`;
      el.dataset.slot = slot;
      el.setAttribute('role', 'status');
      el.setAttribute('data-hush', '');
      const on = whatsOn(day ? 3 : 1);
      el.innerHTML = day
        ? `<div class="lf-card-in"><span class="eyebrow">${esc(ctx.cityName)} · Day ${ci.days}</span>`
          + `<b class="lf-dow">${DOW[D.dow]}</b><b class="lf-date"><span class="num">${c.d}</span> ${MON[c.m - 1]}</b>`
          + `<div class="lf-arc" style="--k:${k.toFixed(3)}"><i></i><span class="a">${hm(b.sunrise)}</span><span class="b">${hm(b.sunset)}</span></div>`
          + `<div class="lf-row"><span class="lf-slot">${SLOT_NAME[slot]}</span><span>${esc(wx.name)}</span><span class="num">${hm(c.min)}</span></div>`
          + (on.length ? `<ul class="lf-on">${on.map(o => `<li><b>${esc(o.t)}</b><span>${esc(o.s)}</span></li>`).join('')}</ul>` : '') + '</div>'
        : `<div class="lf-card-in"><span class="eyebrow">${DOW[D.dow]} ${c.d} ${MON[c.m - 1]} · ${esc(wx.name)}</span><b class="lf-dow">${SLOT_NAME[slot]}</b>`
          + (on.length && on[0].on ? `<div class="lf-row"><span class="lf-slot">On now</span><span>${esc(on[0].t)}</span></div>` : '') + '</div>';
      stage.appendChild(el);
      cardT = day ? 4.6 : 2.8;
      shown = { n: shown.n + 1, kind: day ? 'day' : 'slot', date: D.date, slot };
      if (ctx.A.chime && day) ctx.A.chime();
      if (L.music) L.music.sting(day ? 'day' : 'slot');
    }
    // a new date or a new slot since the last look (force: now, whatever is on screen)
    function check(force) {
      const date = D.date, slot = D.slot;
      if (date === last.date && slot === last.slot) return;
      if (!force && ctx.busy && ctx.busy('card')) { pending = true; return; }
      pending = false;
      const ci = L.city(), newDay = date !== last.date;
      if (newDay && ci.last !== date) { ci.days++; ci.last = date; L.note(`Day ${ci.days} in ${ctx.cityName}`, 'day'); }
      const was = last;
      last = { date, slot };
      L.emit('slot', { slot, date, newDay, from: was.slot });
      card(newDay);
      if (diary) renderDiary();
    }

    // ---- the diary (J): today, and the pages the bonds, the passport and the jobs add
    let diary = null, tab = 'today', btn = null;
    function openDiary(t) {
      if (t) tab = t;
      if (!diary) {
        diary = document.createElement('div');
        diary.className = 'g-overlay lf-diary';
        diary.innerHTML = '<div class="g-panel lf-panel" role="dialog" aria-label="Diary"><header><h2>Diary</h2><nav class="lf-tabs" role="tablist"></nav><button class="x" aria-label="Close the diary">×</button></header><div class="lf-body"></div></div>';
        diary.addEventListener('click', e => {
          const b = e.target.closest('button');
          if (e.target === diary || (b && b.classList.contains('x'))) return closeDiary();
          if (!b) return;
          if (b.dataset.tab) { tab = b.dataset.tab; renderDiary(); }
          else if (b.dataset.pass) { closeDiary(); D.passTo(b.dataset.pass); }
          else if (b.dataset.act && acts[b.dataset.act]) acts[b.dataset.act](b);
        });
        stage.appendChild(diary);
      }
      renderDiary();
      L.emit('diary', { tab });
    }
    function closeDiary() { if (diary) { diary.remove(); diary = null; } }
    const acts = {};
    D.act = (id, fn) => { acts[id] = fn; };
    const tabsAll = () => [{ id: 'today', title: 'Today', render: renderToday }, ...D.tabs, { id: 'log', title: 'Pages', render: renderLog }];
    function renderDiary() {
      const tabs = tabsAll(), cur = tabs.find(t => t.id === tab) || tabs[0];
      diary.querySelector('.lf-tabs').innerHTML = tabs.map(t => `<button role="tab" data-tab="${t.id}" aria-selected="${t === cur}">${t.title}${t.badge && t.badge() ? `<i>${t.badge()}</i>` : ''}</button>`).join('');
      const body = diary.querySelector('.lf-body');
      body.className = `lf-body lf-${cur.id}`;
      body.innerHTML = cur.render();
    }
    function renderToday() {
      const b = bounds(), slot = D.slot, wx = D.weather(), ci = L.city();
      const k = clamp((c.min - b.sunrise) / Math.max(1, b.sunset - b.sunrise), -0.25, 1.25);
      const ribbon = SLOTS.map(s => `<li class="${s === slot ? 'now' : ''}"><b>${SLOT_NAME[s]}</b><span class="num">${hm(b[s])}</span></li>`).join('');
      const today = D.today(), soon = D.soon();
      const around = [];
      for (const p of L.partsToday || []) around.push(...p());
      const passes = SLOTS.filter(s => s !== slot).sort((x, y) => ((b[x] - c.min + 1440) % 1440) - ((b[y] - c.min + 1440) % 1440));
      return `<section class="lf-head"><div><span class="eyebrow">${esc(ctx.cityName)} · Day ${ci.days}</span><b class="lf-dow">${DOW[D.dow]}</b><b class="lf-date"><span class="num">${c.d}</span> ${MON[c.m - 1]} <span class="yr num">${c.y}</span></b></div>`
        + `<div class="lf-now"><b class="num">${hm(c.min)}</b><span>${esc(wx.name)}</span><span class="lf-purse num" title="Your wallet">${L.fmt(L.money)}</span></div></section>`
        + `<div class="lf-arc wide" style="--k:${k.toFixed(3)}"><i></i><span class="a">Sunrise ${hm(b.sunrise)}</span><span class="g">Golden hour ${hm(b.golden)}</span><span class="b">Sunset ${hm(b.sunset)}</span></div>`
        + `<ol class="lf-ribbon">${ribbon}</ol>`
        + `<h3>On today</h3>${today.length ? `<ul class="lf-list">${today.map(e => `<li class="${D.onNow(e) ? 'on' : ''}"><b>${esc(e.title)}${e.native ? ` <span class="jp">${esc(e.native)}</span>` : ''}</b><span>${esc(e.where || '')}${e.slots ? ` · ${e.slots.map(s => SLOT_NAME[s]).join(', ')}` : ''}${ci.events[e.id] ? ' · been' : ''}</span><p>${esc(e.text || '')}</p></li>`).join('')}</ul>` : '<p class="note">Nothing on the calendar today. The city is its ordinary self, which is the point.</p>'}`
        + (around.length ? `<h3>Around ${SLOT_NAME[slot].toLowerCase() === 'night' ? 'tonight' : `this ${SLOT_NAME[slot].toLowerCase()}`}</h3><ul class="lf-list">${around.map(a => `<li class="${a.on ? 'on' : ''}"><b>${esc(a.title)}</b><span>${esc(a.note || '')}</span></li>`).join('')}</ul>` : '')
        + (soon.length ? `<h3>Coming up</h3><ul class="lf-list soon">${soon.slice(0, 4).map(([n, e]) => `<li><b>${esc(e.title)}</b><span>${n === 1 ? 'Tomorrow' : `In ${n} days`} · ${e.dates ? `${e.dates[0][1]} ${MON[e.dates[0][0] - 1]}` : ''}${e.where ? ` · ${esc(e.where)}` : ''}</span></li>`).join('')}</ul>` : '')
        + `<h3>Pass the time</h3><div class="lf-pass-row">${passes.map(s => `<button class="btn" data-pass="${s}">Until ${SLOT_NAME[s].toLowerCase()}<span class="num">${hm(b[s])}${b[s] <= c.min ? ' +1' : ''}</span></button>`).join('')}</div>`
        + '<p class="note">The clock is the city\'s own. Nothing closes the streets: the hour only changes who is about and what is on.</p>';
    }
    function renderLog() {
      const log = L.city().log.slice().reverse();
      if (!log.length) return '<p class="note">Nothing written yet. What you do in the city is kept here, day by day.</p>';
      let d = '', out = '';
      for (const e of log) {
        if (e.d !== d) { d = e.d; const [y, m, dd] = d.split('-').map(Number); out += `${out ? '</ul>' : ''}<h3>${DOW[dowOf(y, m, dd)]} ${dd} ${MON[m - 1]}</h3><ul class="lf-log">`; }
        out += `<li data-k="${e.k || ''}"><span class="num">${hm(e.t)}</span><span>${esc(e.text)}</span></li>`;
      }
      return out + '</ul>';
    }
    // the Diary button, beside Map and Passport
    function button() {
      const row = $('.g-btns');
      if (!row || btn) return;
      btn = document.createElement('button');
      btn.className = 'chip-btn'; btn.id = 'g-diary-btn';
      btn.innerHTML = ctx.touch ? 'Diary' : 'Diary <kbd>J</kbd>';
      btn.addEventListener('click', () => (diary ? closeDiary() : openDiary()));
      row.insertBefore(btn, row.children[2] || null);
    }
    button();

    let acc = 0;
    L.use({
      tick(dt, paused, titled) {
        if (cardEl && (cardT -= dt) <= 0) { const el = cardEl; cardEl = null; el.classList.add('out'); setTimeout(() => el.remove(), 700); }
        if (titled) return;
        if ((acc += dt) < 0.5 && !pending) return;
        acc = 0;
        check(false);
      },
      key(code) { if (code === 'KeyJ') { diary ? closeDiary() : openDiary(); return true; } return false; },
      get open() { return !!diary; },
      close: closeDiary,
      reset() { last = { date: '', slot: '' }; },
      load() { if (diary) renderDiary(); },
    });
    L.day = D;
    return D;
  }
  return { create, SLOTS, SLOT_NAME, eventOn, daysUntil };
})();
