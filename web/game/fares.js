// What a ride costs, by the city's own rules (docs/GAME.md "Fares"). You tap on with your phone as you
// board a ferry, a train or a gondola and tap off as you step ashore; the fare is the operator's own
// (a map's life.json "fares": its table, the day it took effect and its source), with what that city
// gives back: Sydney's off-peak fares, its discount for changing from one kind of transport to another,
// and its caps on a day's and a week's travel, lower from Friday to Sunday. Past a cap the rest of the
// day is free, so a fare never argues against one more ride.
//
// The rules are one function of the table, the trip and what was spent before it (price), with nothing
// of the browser in it: tools/fares_check.js prices trips with it under Node. The rest is the tap's
// card on the HUD, the phone's page and the diary's line. A wallet short of a fare pays what it has
// and the gate lets you through (life.js pay): a fare is never a wall.
'use strict';
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const dow = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 is Monday
  const dayKey = t => `${t.y}-${pad(t.m)}-${pad(t.d)}`;
  // the first day of the week t falls in (starts: 0 Monday, as Sydney's)
  function weekKey(t, starts = 0) {
    const back = (dow(t.y, t.m, t.d) - starts + 7) % 7, w = new Date(Date.UTC(t.y, t.m - 1, t.d - back));
    return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
  }
  const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  // A city's public holidays in a year, as a set of 'm-d'. Each entry of life.json "holidays" is one of:
  //   [m, d]              a fixed date
  //   [m, d, "weekday"]   a fixed date, and when it falls on a Saturday or a Sunday the next weekday that is not a
  //                       holiday already (NSW's New Year's Day, Australia Day, Christmas and Boxing Day, in that order)
  //   ["easter", k]       k days from Easter Sunday (-2 Good Friday, 1 Easter Monday)
  //   ["nth", m, wd, n]   the n-th weekday wd (0 Monday) of month m (NSW's King's Birthday: ["nth", 6, 0, 2])
  function easter(y) { // the Gregorian computus (Meeus, Jones and Butcher): [month, day] of Easter Sunday
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
  }
  const md = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return [t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCFullYear()]; };
  const HOL = new WeakMap();
  function holidaysOf(cfg, y) {
    let byYear = HOL.get(cfg);
    if (!byYear) HOL.set(cfg, byYear = {});
    if (byYear[y]) return byYear[y];
    const set = new Set(), key = (m, d) => `${m}-${d}`, later = [];
    for (const h of cfg.holidays || []) {
      if (h[0] === 'easter') { const [em, ed] = easter(y), [m, d] = md(y, em, ed + h[1]); set.add(key(m, d)); }
      else if (h[0] === 'nth') { const [, m, wd, n] = h, first = (wd - dow(y, m, 1) + 7) % 7 + 1; set.add(key(m, first + 7 * (n - 1))); }
      else { set.add(key(h[0], h[1])); if (h[2] === 'weekday' && dow(y, h[0], h[1]) >= 5) later.push(h); }
    }
    for (const h of later) { // in the table's order, each to the first weekday after it that is not a holiday yet
      for (let k = 1; k < 8; k++) { const [m, d, yy] = md(y, h[0], h[1] + k); if (yy === y && dow(y, m, d) < 5 && !set.has(key(m, d))) { set.add(key(m, d)); break; } }
    }
    return (byYear[y] = set);
  }
  const isHoliday = (cfg, t) => holidaysOf(cfg, t.y).has(`${t.m}-${t.d}`);
  // the table for this kind of ride, a route's own over it (two operators' boats on one map)
  function rideOf(cfg, trip) {
    const r = cfg && cfg.rides && cfg.rides[trip.kind];
    if (!r) return null;
    return r.routes && r.routes[trip.route] ? Object.assign({}, r, r.routes[trip.route]) : r;
  }
  // the fare in full: a pair of stops by name, else a band by distance, else one price for the ride
  function full(r, trip) {
    const P = r.pairs || {}, v = P[`${trip.from}>${trip.to}`] != null ? P[`${trip.from}>${trip.to}`] : P[`${trip.to}>${trip.from}`];
    if (v != null) return v;
    if (r.bands) { const km = (trip.m || 0) / 1000; for (const [upto, f] of r.bands) if (upto == null || km <= upto) return f; }
    // by the hour of the tap: [["HH:MM", fare], ...] from the first hour on, each until the next (SHIBUYA SKY's afternoon price)
    if (r.times) { let f = r.times[0][1]; const at = trip.on ? trip.on.min : 0; for (const [t0, v] of r.times) if (at >= hm(t0)) f = v; return f; }
    return r.flat != null ? r.flat : null;
  }
  const fresh = () => ({ day: '', spent: 0, week: '', wspent: 0, last: null, returns: {}, trips: [] });
  // what was spent, as of the day of t: yesterday's total is not today's, nor last week's this week's
  function asOf(cfg, st, t) {
    const s = Object.assign(fresh(), st), day = dayKey(t), week = weekKey(t, (cfg.caps || {}).week_starts || 0);
    if (s.day !== day) { s.day = day; s.spent = 0; s.trips = []; s.returns = {}; s.last = null; }
    if (s.week !== week) { s.week = week; s.wspent = 0; }
    return s;
  }
  // today's cap, if the city has one: { cap, low } (low: the lower one, of a weekend or a holiday)
  function capOf(cfg, t) {
    const c = cfg.caps;
    if (!c || c.day == null) return null;
    const low = c.day_low != null && ((c.low_weekdays || []).includes(dow(t.y, t.m, t.d)) || isHoliday(cfg, t));
    return { cap: low ? c.day_low : c.day, low, name: low ? c.low_name || 'Weekend cap' : 'Daily cap' };
  }
  // trip: { kind, route, from, to, m (metres), on: { y, m, d, min } (the tap on), off_min (the tap off) }
  // st: what the card remembers (fresh() to start). Returns null where the ride has no fare, else
  // { full, due, lines: [[label, amount]], cap, spent, capped, ret, st } with st the card afterwards
  function price(cfg, trip, st) {
    const r = rideOf(cfg, trip);
    if (!r) return null;
    const f = full(r, trip);
    if (f == null) return null;
    const unit = cfg.unit || 1, rnd = v => Math.round(v / unit) * unit, t = trip.on;
    const s = asOf(cfg, st, t), lines = [], abs = t.min, key = `${trip.kind}:${trip.route || ''}`;
    let due = f, ret = false;
    // a return ticket: the way back on the day it was bought is paid for already
    if (r.return && s.returns[key] && s.returns[key] !== trip.from) { ret = true; lines.push(['Return ticket', -due]); due = 0; }
    const op = cfg.offpeak;
    if (due && op && (op.kinds || []).includes(trip.kind)) {
      const all = (op.all_day || []).includes(dow(t.y, t.m, t.d)) || isHoliday(cfg, t);
      if (all || !(op.peak || []).some(([a, b]) => abs >= hm(a) && abs < hm(b))) { const v = rnd(due * (1 - op.discount)); lines.push([`Off-peak, ${Math.round(op.discount * 100)}% off`, v - due]); due = v; }
    }
    const tr = cfg.transfer;
    if (due && tr && s.last && s.last.kind !== trip.kind && abs - s.last.min >= 0 && abs - s.last.min <= tr.within_min) { const v = Math.max(0, rnd(due - tr.off)); lines.push([tr.name || 'Transfer', v - due]); due = v; }
    const cap = capOf(cfg, t), wcap = cfg.caps && cfg.caps.week;
    let capped = '';
    if (cap) { const left = Math.max(0, rnd(cap.cap - s.spent)); if (due >= left) { if (due > left) lines.push([cap.name, left - due]); due = left; capped = 'day'; } }
    if (wcap != null) { const left = Math.max(0, rnd(wcap - s.wspent)); if (due >= left) { if (due > left) lines.push(['Weekly cap', left - due]); due = left; capped = 'week'; } }
    due = rnd(due);
    s.spent = rnd(s.spent + due); s.wspent = rnd(s.wspent + due);
    s.last = { kind: trip.kind, min: trip.off_min != null ? trip.off_min : abs };
    if (r.return && !ret) s.returns[key] = trip.from; else if (ret) delete s.returns[key];
    s.trips.push({ t: Math.round(abs), kind: trip.kind, from: trip.fromName || trip.from, to: trip.toName || trip.to, due, full: f });
    if (s.trips.length > 12) s.trips.shift();
    return { full: f, due, lines, cap: cap ? cap.cap : null, capName: cap ? cap.name : '', week: wcap != null ? wcap : null, spent: s.spent, wspent: s.wspent, capped, ret, ticket: !!r.return, st: s };
  }

  // ---- in the game: the tap, its card, the phone's page
  function create(L) {
    const ctx = L.ctx, esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cfg = () => L.data.fares || null, c = ctx.clock;
    const now = () => ({ y: c.y, m: c.m, d: c.d, min: c.min });
    const card = () => { const ci = L.city(); return ci.fares || (ci.fares = fresh()); };
    const hmm = min => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.floor(min) % 60)}`;
    const KIND = { ferry: 'Ferry', rail: 'Train', lift: 'Ticket' };
    const kindName = trip => { const r = rideOf(cfg(), trip); return (r && r.name) || KIND[trip.kind] || 'Ride'; };
    let open = null, el = null, hideT = 0;
    // The tap itself: the surveyor holds the phone out to the reader, the right hand rising from the hip to a reader's
    // height (about 1.0 m, a gate's reader) a forearm in front, for a second, and back. Only on foot and with the hand free (not with a
    // rod or an umbrella in it); rig.hold is where people.js puts the fist.
    const gesture = { t: 0, on: false, phone: null, at: null };
    const TAP = { up: 0.22, hold: 0.55, down: 0.3 };
    function phoneMesh() {
      if (gesture.phone || !window.THREE || !ctx.world) return gesture.phone;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.15, 0.009), new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.25, metalness: 0.5 }));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.138), new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: 0x4f8fd0, emissiveIntensity: 0.9, roughness: 0.05 }));
      glass.position.z = 0.0048; m.add(glass); m.name = 'tap_phone'; m.visible = false; m.frustumCulled = false;
      ctx.world.add(m);
      return (gesture.phone = m);
    }
    function tapStep(dt) {
      const pl = ctx.player, rig = pl && pl.rig;
      if (!gesture.on || !rig || !rig.fist) return;
      gesture.t += dt;
      const T = TAP.up + TAP.hold + TAP.down, t = gesture.t, mine = rig.hold === gesture.at || rig.hold == null;
      if (t >= T || pl.mode !== 'foot' || !mine) {
        if (rig.hold === gesture.at) rig.hold = null;
        if (gesture.phone) gesture.phone.visible = false;
        gesture.on = false; return;
      }
      const e = x => x * x * (3 - 2 * x), k = t < TAP.up ? e(t / TAP.up) : t < TAP.up + TAP.hold ? 1 : e(1 - (t - TAP.up - TAP.hold) / TAP.down);
      const s = Math.sin(pl.h), c = Math.cos(pl.h), fwd = 0.12 + 0.24 * k, right = 0.22 - 0.08 * k, up = 0.86 + 0.16 * k;
      const x = pl.x + s * fwd + c * right, y = pl.y + c * fwd - s * right, z = pl.z + up;
      gesture.at = gesture.at || new THREE.Vector3();
      gesture.at.set(x, z, -y); // (the world's frame: x east, y up, z south)
      rig.hold = gesture.at;
      const ph = phoneMesh();
      if (ph) { // in the hand, upright, its screen to the reader in front
        const f = rig.fist(ph.position) || ph.position.copy(gesture.at);
        ph.position.set(f.x + s * 0.09, f.y + 0.03, f.z - c * 0.09);
        ph.rotation.set(-0.35 * k, Math.PI - pl.h, 0, 'YXZ');
        ph.visible = k > 0.25;
      }
    }
    // the card on the HUD: the reader's answer to a tap. o: { on, title, place, amount, lines, bar: { k, text }, note }
    function show(o) {
      if (!el) { el = document.createElement('div'); el.className = 'lf-tap'; el.setAttribute('role', 'status'); ctx.stage.appendChild(el); }
      const f = cfg(), name = (f.card && f.card.name) || 'Card';
      el.dataset.state = o.on ? 'on' : o.capped ? 'capped' : 'off';
      el.innerHTML = `<div class="lf-tap-chip"><i></i><i></i><i></i></div>`
        + `<div class="lf-tap-main"><span class="eyebrow">${esc(name)} · ${esc(o.title)}</span><b>${esc(o.place)}</b>`
        + (o.lines && o.lines.length ? `<ul>${o.lines.map(([k, v]) => `<li><span>${esc(k)}</span><span class="num">${v < 0 ? '−' : ''}${L.fmt(Math.abs(v))}</span></li>`).join('')}</ul>` : '')
        + (o.bar ? `<div class="lf-tap-bar" style="--k:${Math.max(0, Math.min(1, o.bar.k)).toFixed(3)}"><i></i></div><span class="lf-tap-cap">${esc(o.bar.text)}</span>` : '')
        + (o.note ? `<span class="lf-tap-cap">${esc(o.note)}</span>` : '') + '</div>'
        + (o.amount != null ? `<b class="lf-tap-fare num">${o.amount ? L.fmt(o.amount) : 'Free'}</b>` : `<b class="lf-tap-fare num">${hmm(c.min)}</b>`);
      el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
      gesture.t = 0; gesture.on = true;
      hideT = o.on ? 3.2 : 6.5;
      // the reader's tone: one note for a tap on, two for a tap off, three rising at a cap
      const A = ctx.A;
      if (A && A.chime && o.capped) A.chime(); else if (A && A.beep) { A.beep(1560); if (!o.on) setTimeout(() => A.beep(1960), 110); }
    }
    const F = {
      price, fresh, capOf, get gesture() { return gesture; }, get card() { return card(); }, get open() { return open; }, get shown() { return el && el.classList.contains('in') ? el : null; },
      // the fare table's lines for the phone and the diary: what a ride costs here and what the city gives back
      rules() {
        const f = cfg(), out = [];
        if (!f) return out;
        for (const [k, r0] of Object.entries(f.rides || {})) for (const r of r0.routes ? Object.entries(r0.routes).map(([n, v]) => Object.assign({ name: n }, r0, v, { routes: null })) : [r0]) {
          const vals = r.pairs ? Object.values(r.pairs) : r.bands ? r.bands.map(b => b[1]) : r.times ? r.times.map(b => b[1]) : [r.flat], lo = Math.min(...vals), hi = Math.max(...vals);
          out.push([r.name || KIND[k] || k, `${L.fmt(lo)}${hi > lo ? ` to ${L.fmt(hi)}` : ''}${r.return ? ' return' : ''}${r.text ? ` · ${r.text}` : ''}`]);
        }
        const cp = f.caps, op = f.offpeak, tr = f.transfer;
        if (op) out.push(['Off-peak', `${Math.round(op.discount * 100)}% off ${op.text || 'outside the peaks'}`]);
        if (tr) out.push([tr.name || 'Transfer', `${L.fmt(tr.off)} off a change within ${tr.within_min} minutes`]);
        if (cp && cp.day != null) out.push(['Daily cap', `${L.fmt(cp.day)}${cp.day_low != null ? `, ${L.fmt(cp.day_low)} ${cp.low_text || 'at the weekend'}` : ''}`]);
        if (cp && cp.week != null) out.push(['Weekly cap', `${L.fmt(cp.week)}, ${cp.week_text || 'Monday to Sunday'}`]);
        return out;
      },
      // boarding: the tap on (nothing is paid until the tap off)
      on(o) {
        const f = cfg();
        open = null;
        if (!f || !rideOf(f, o)) return;
        open = { kind: o.kind, route: o.route, from: o.from, fromName: o.name, on: now() };
        const r = rideOf(f, o), back = r.return && asOf(f, card(), open.on).returns[`${o.kind}:${o.route || ''}`];
        show({ on: true, title: r.return ? (back && back !== o.from ? 'Return ticket' : 'Ticket') : 'Tap on', place: o.name, note: r.return ? (back && back !== o.from ? 'The way back is on your ticket.' : `${kindName(o)}: paid as you step off.`) : '' });
      },
      // stepping off: the tap off, and the fare
      off(o) {
        const f = cfg(), was = open;
        open = null;
        if (!f || !rideOf(f, o) || !was || was.kind !== o.kind) return null;
        const trip = { kind: o.kind, route: was.route || o.route, from: was.from, to: o.to, fromName: was.fromName, toName: o.name, m: o.m, on: was.on, off_min: was.on.min + ((c.min - was.on.min + 1440) % 1440) };
        const p = price(f, trip, card());
        if (!p) return null;
        const paid = L.pay(p.due, true);
        L.city().fares = p.st;
        const lines = p.lines.length ? [['Fare', p.full]].concat(p.lines) : [];
        if (paid.short > 0) lines.push(['Short on the card: let through', -paid.short]);
        const bar = p.cap != null ? { k: p.spent / p.cap, text: p.capped === 'week' ? `Weekly cap of ${L.fmt(p.week)} reached: free until Monday.` : p.capped ? `${p.capName} of ${L.fmt(p.cap)} reached: the rest of today is free.` : `Today ${L.fmt(p.spent)} of ${L.fmt(p.cap)} · ${p.capName}` } : null;
        show({ title: p.ticket ? (p.ret ? 'Return ticket' : 'Ticket') : 'Tap off', place: `${was.fromName} to ${o.name}`, amount: paid.paid, lines, bar, capped: !!p.capped });
        L.note(`${kindName(trip)}, ${was.fromName} to ${o.name}: ${p.due ? L.fmt(paid.paid) : 'free'}${p.capped ? ' (capped)' : ''}`, 'fare');
        return p;
      },
    };
    // a ticket at the gate (game.json lifts, a ride of kind "lift" by the lift's id): bought going up from the paying
    // stop ("from") and good for the way down; a first visit can be on the survey's pass ("first_free": its line)
    F.admit = function (o) {
      const f = cfg(), r = f && rideOf(f, o);
      if (!r || (r.from && o.from !== r.from)) return null;
      const trip = { kind: o.kind, route: o.route, from: o.from, to: o.to, fromName: o.name || o.from, toName: o.toName || o.to, on: now() };
      if (r.first_free && L.first('ticket', `${o.kind}:${o.route}`)) {
        show({ title: 'Ticket', place: r.name || o.name, amount: 0, note: r.first_free });
        L.note(`${r.name || 'Ticket'}: on the survey's pass`, 'fare');
        return { due: 0, free: true };
      }
      const p = price(f, trip, card());
      if (!p) return null;
      const paid = L.pay(p.due, true);
      L.city().fares = p.st;
      const band = r.times ? r.times.filter(([t0]) => c.min >= hm(t0)).pop() : null;
      const lines = band && r.times.length > 1 ? [[hm(band[0]) ? `Admission from ${band[0]}` : `Admission before ${r.times[1][0]}`, p.full]] : [];
      if (paid.short > 0) lines.push(['Short: the desk waves you through', -paid.short]);
      show({ title: 'Ticket', place: r.name || o.name, amount: paid.paid, lines, note: r.text || '' });
      L.note(`${r.name || 'Ticket'}: ${L.fmt(paid.paid)}`, 'fare');
      return p;
    };
    L.on('board', o => F.on(o));
    L.on('ride', o => { if (o.kind === 'lift') F.admit(o); });
    L.on('ride', o => { if (o.kind === 'ferry' || o.kind === 'rail') F.off(o); });
    L.use({ tick(dt) { tapStep(dt); if (el && hideT > 0 && (hideT -= dt) <= 0) { el.classList.remove('in'); el.classList.add('out'); } }, reset() { open = null; } });
    // the phone's page: the card, today's rides and the city's rules
    if (L.phone && L.phone.page) L.phone.page({
      id: 'fares', title: () => (cfg().card && cfg().card.name) || 'Fares', on: () => !!cfg(),
      row(item, show) {
        const f = cfg(), s = asOf(f, card(), now()), cap = capOf(f, now());
        return item((f.card && f.card.name) || 'Fares', cap ? `Today ${L.fmt(s.spent)} of ${L.fmt(cap.cap)}${s.spent >= cap.cap ? ' · free now' : ''}` : s.trips.length ? `Today ${L.fmt(s.spent)}` : (f.card && f.card.text) || 'What a ride costs here', () => show('fares'));
      },
      render() {
        const f = cfg(), s = asOf(f, card(), now()), cap = capOf(f, now()), wk = f.caps && f.caps.week;
        const meter = (label, v, of) => `<div class="lf-fare-meter"><span class="eyebrow">${label}</span><b class="num">${L.fmt(v)}<span> / ${L.fmt(of)}</span></b><div class="lf-tap-bar" style="--k:${Math.min(1, v / of).toFixed(3)}"><i></i></div></div>`;
        return `<div class="lf-fare-card"><span class="eyebrow">Balance</span><b class="num">${L.fmt(L.money)}</b><span class="note">${esc((f.card && f.card.text) || '')}</span></div>`
          + (cap ? meter(cap.name, s.spent, cap.cap) : '') + (wk != null ? meter('This week', s.wspent, wk) : '')
          + (s.trips.length ? `<ul class="lf-fare-trips">${s.trips.slice().reverse().map(t => `<li><span class="num">${hmm(t.t)}</span><span>${esc(t.from)} to ${esc(t.to)}</span><b class="num">${t.due ? L.fmt(t.due) : 'Free'}</b></li>`).join('')}</ul>` : '<p class="note">No rides yet today. Tap on as you board; the fare is taken as you step off.</p>')
          + `<dl class="lf-fare-rules">${F.rules().map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
          + (f.as_of ? `<p class="note">${esc(f.operator || '')}${f.operator ? ', ' : ''}fares ${esc(f.as_of)}.</p>` : '')
          + '<div class="row"><button class="btn" data-back>Back</button></div>';
      },
    });
    L.fares = F;
    return F;
  }
  const api = { create, price, fresh, asOf, capOf, weekKey, dow, easter, holidaysOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OEFares = api;
})(typeof window !== 'undefined' ? window : globalThis);
