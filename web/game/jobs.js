// Things to do for money, and things to spend it on. Each uses the real place and what the game
// already has:
//   deliver  carry something from one real door to another against the clock, by any means you like
//            (a cab is quicker and costs its fare);
//   fare     drive your own car as a cab: stop for the passenger, take them where they say;
//   point    someone asks the way: turn to face the landmark's true bearing and say "that way",
//            scored by the angle you are off;
//   photo    a list of real subjects to photograph (photo mode), more for the hour that suits them.
// And counters (life.json "shops"): open at their hours, a dish or a keepsake each with a line
// about it. A map's jobs and shops are in its life.json; what you have done is in the save.
// The passport's page of skills is drawn here too (the game's Passport panel calls life.passport).
'use strict';
window.OEJobs = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtS = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const TYPE = { deliver: 'Delivery', fare: 'Cab fare', point: 'Show the way', photo: 'Photographs' };
  function create(L) {
    const ctx = L.ctx, P = ctx.player;
    const all = () => L.data.jobs || [], shops = () => L.data.shops || [];
    const st = id => { const j = L.city().jobs; return j[id] || (j[id] = { n: 0, slot: '' }); };
    const slotKey = () => `${L.day.date}|${L.day.slot}`;
    const dist = at => Math.hypot(P.x - at[0], P.y - at[1]);
    const unlocked = j => !j.locked || L.bonds.abilities().some(a => a.id === 'job' && a.job === j.id);
    const open = j => unlocked(j) && L.day.onNow(j.when) && (!j.needs || L.level(j.needs.skill) >= j.needs.level);
    const offered = () => all().filter(j => unlocked(j));
    let cur = null, chip = null; // the job in hand: { j, phase: 'go'|'run', t0, i, got, score }
    const say = (t, sub) => ctx.H.toast(`<b>${esc(t)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
    function start(id) {
      const j = all().find(x => x.id === id);
      if (!j || cur) return false;
      if (!open(j)) { say(j.title, j.needs && L.level(j.needs.skill) < j.needs.level ? `Needs ${L.SKILLS.find(k => k.id === j.needs.skill).name} ${j.needs.level}` : `Offered ${L.day.whenOn(j.when)}`); return false; }
      if (st(id).slot === slotKey()) { say(j.title, 'Done for this part of the day. There is more later.'); return false; }
      cur = { j, phase: 'go', t0: 0, i: 0, got: [], score: 0 };
      ctx.waypoint(j.at.slice(0, 2));
      say(TYPE[j.type], j.type === 'fare' ? `Bring your car to ${j.at_name || 'the pick-up'}` : `Go to ${j.at_name || 'the start'}`);
      L.emit('job_start', { id });
      render();
      return true;
    }
    function drop(why) { if (!cur) return; cur = null; ctx.waypoint(null); render(); if (why) say('Job dropped', why); }
    function finish(k = 1, note = '') { // k: the share of the pay earned (late or wide of the mark earns less, never nothing)
      const j = cur.j, s = st(j.id), tip = L.ability('tip');
      const pay = j.pay * k * (tip ? 1 + tip.value : 1);
      s.n++; s.slot = slotKey(); s.best = Math.max(s.best || 0, Math.round(k * 100));
      cur = null; ctx.waypoint(null); render();
      const got = L.earn(pay);
      if (L.ui && L.ui.banner) L.ui.banner({ kind: 'job', eyebrow: `${TYPE[j.type]} · ${j.title}`, title: `+${L.fmt(got)}`, sub: `${note}${tip ? ` ${Math.round(tip.value * 100)}% more: ${tip.from}.` : ''}${j.done ? ` ${j.done}` : ''}`.trim(), hold: 3000 });
      else say(`+${L.fmt(got)}`, note);
      if (ctx.A.chime) ctx.A.chime();
      if (L.music) L.music.sting('job');
      if (j.skill) L.gain(j.skill, Math.max(1, Math.round((j.xp || 4) * k)));
      L.note(`${TYPE[j.type]}: ${j.title}, ${L.fmt(got)}`, 'job');
      L.emit('job', { id: j.id, share: k });
      L.save();
    }
    // the way you face, as a compass bearing (0 north, clockwise), from the camera
    const V = new THREE.Vector3();
    const facing = () => { ctx.camera.getWorldDirection(V); return Math.atan2(V.x, -V.z); };
    const bearing = at => Math.atan2(at[0] - P.x, at[1] - P.y);
    const off = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180 / Math.PI;
    function pointAt() {
      const j = cur.j, t = j.targets[cur.i], err = off(facing(), bearing(t.at));
      const k = err <= 8 ? 1 : err <= 20 ? 0.7 : err <= 45 ? 0.35 : 0.1, km = Math.hypot(t.at[0] - P.x, t.at[1] - P.y) / 1000;
      cur.score += k; cur.got.push(Math.round(err));
      say(err <= 8 ? 'Dead on' : err <= 20 ? 'Near enough' : err <= 45 ? 'Roughly' : 'Not that way', `${t.name} is ${Math.round(err)}° ${err <= 8 ? 'off at most' : 'from where you pointed'}, ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away.`);
      if (++cur.i >= j.targets.length) finish(cur.score / j.targets.length, `Off by ${cur.got.join('°, ')}°.`);
      else render();
    }
    // a photograph: which of the job's subjects are in the frame (in front, inside the middle four fifths, near enough)
    function snapped(o) {
      if (!cur || cur.j.type !== 'photo' || cur.phase !== 'run') return;
      const j = cur.j;
      for (const [i, sub] of j.subjects.entries()) {
        if (cur.got.includes(i)) continue;
        const z = sub.at[2] != null ? sub.at[2] : (ctx.ground ? ctx.ground(sub.at[0], sub.at[1]) : 0) + (sub.up || 8);
        V.copy(ctx.W(sub.at[0], sub.at[1], z));
        const d = V.distanceTo(ctx.camera.position);
        V.project(ctx.camera);
        if (V.z < 1 && Math.abs(V.x) < 0.8 && Math.abs(V.y) < 0.85 && d < (sub.within || 500)) { cur.got.push(i); cur.score += o.golden ? 1.25 : 1; say(sub.name, o.golden ? `In the frame, at ${o.hour}: a quarter more.` : 'In the frame.'); }
      }
      if (cur.got.length >= j.subjects.length) finish(cur.score / j.subjects.length, `${j.subjects.length} subjects.`);
      else render();
    }
    L.on('photo', snapped);

    let acc = 0;
    function tick(dt, paused, titled) {
      if (!cur || titled || paused) return;
      if ((acc += dt) < 0.2) return;
      const j = cur.j, now = ctx.now(), inCar = P.mode === 'car', stopped = !inCar || ctx.car().D.st.speed < 1.5;
      acc = 0;
      if (cur.phase === 'go') {
        const ok = j.type === 'fare' ? inCar && stopped && dist(j.at) < 18 : P.mode === 'foot' && dist(j.at) < (j.radius || 10);
        if (!ok) return;
        cur.phase = 'run'; cur.t0 = now;
        if (j.type === 'deliver' || j.type === 'fare') ctx.waypoint(j.to.slice(0, 2)); else ctx.waypoint(null);
        say(j.type === 'fare' ? `${j.who || 'Your passenger'} gets in` : j.type === 'point' ? (j.who || 'A visitor') : j.title, j.type === 'point' ? `"Which way is ${j.targets[0].name}?" Turn to face it and press E.` : j.text || '');
        render();
      } else if (j.type === 'deliver' || j.type === 'fare') {
        const left = j.time_s - (now - cur.t0);
        const ok = j.type === 'fare' ? inCar && stopped && dist(j.to) < 18 : (P.mode === 'foot' || stopped) && dist(j.to) < (j.radius || 10);
        if (ok) finish(left > j.time_s / 2 ? 1.25 : left > 0 ? 1 : 0.6, left > j.time_s / 2 ? 'With time to spare: a quarter more.' : left > 0 ? 'On time.' : 'Late, and still glad of it.');
        else if (chip) { const b = chip.querySelector('.t'); if (b) { b.textContent = left > 0 ? fmtS(left) : 'Late'; chip.style.setProperty('--k', Math.max(0, left / j.time_s).toFixed(3)); } }
      }
    }
    // the chip that shows the job in hand, at the top of the picture
    function render() {
      if (!cur) { if (chip) { chip.remove(); chip = null; } return; }
      if (!chip) { chip = document.createElement('div'); chip.className = 'g-hud lf-job brackets'; chip.setAttribute('aria-live', 'polite'); ctx.stage.appendChild(chip); chip.addEventListener('click', e => { if (e.target.closest('button')) drop('You can take it again later.'); }); }
      const j = cur.j;
      const what = cur.phase === 'go' ? (j.type === 'fare' ? `Bring your car to ${j.at_name || 'the pick-up'}` : `Go to ${j.at_name || 'the start'}`)
        : j.type === 'deliver' ? `To ${j.to_name}` : j.type === 'fare' ? `Drive to ${j.to_name}` : j.type === 'point' ? `Face ${j.targets[cur.i].name}, then E (${cur.i + 1}/${j.targets.length})`
          : `Photograph: ${j.subjects.filter((_, i) => !cur.got.includes(i)).map(s => s.name).join(', ')}`;
      chip.innerHTML = `<span class="eyebrow">${TYPE[j.type]} · ${L.fmt(j.pay)}</span><b>${esc(j.title)}</b><span>${esc(what)}</span>`
        + (cur.phase === 'run' && j.time_s ? '<span class="bar"><i></i></span><span class="t num"></span>' : '') + '<button aria-label="Drop the job">×</button>';
    }

    // ---- counters: a dish, a keepsake
    function order(s) {
      const who = { name: s.name, role: s.role || 'Counter', color: s.color || '#8a6a3a', pitch: s.pitch || 240 };
      const items = s.menu.map(m => ({ text: `${m.name} · ${L.fmt(m.price)}`, m })).concat({ text: 'Nothing just now' });
      ctx.dlg.show(who, [ctx.said(s.hello || 'What will it be?')], items, ch => {
        const m = ch && ch.m;
        if (!m) return;
        if (L.money < m.price) { ctx.dlg.show(who, [`That's ${L.fmt(m.price)}, and you have ${L.fmt(L.money)}. There is work about: look in your diary.`]); return; }
        L.pay(m.price);
        ctx.dlg.show(who, [ctx.said(m.text)], null, () => {
          if (m.keep) { const sh = L.city().shelf; if (!sh.includes(m.id)) { sh.push(m.id); say(m.name, 'Kept: it is in your passport.'); } }
          else L.emit('dish', { id: `${s.id}:${m.id}`, name: m.name });
          L.note(`${m.name} at ${s.name}, ${L.fmt(m.price)}`, m.keep ? 'keep' : 'dish');
          L.emit('shop', { id: s.id, item: m.id });
        });
      });
    }
    // ---- what is on the calendar here and now: an event at its place
    function attend(e) {
      const who = { name: e.title, role: e.where || '', color: '#b8743a', pitch: 300 };
      ctx.dlg.show(who, (e.lines || [e.text]).map(ctx.said), null, () => {
        const been = L.city().events, y = ctx.clock.y;
        if (!(been[e.id] || []).includes(y)) {
          (been[e.id] || (been[e.id] = [])).push(y);
          if (L.ui && L.ui.banner) L.ui.banner({ kind: 'event', eyebrow: `${ctx.clock.d} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][ctx.clock.m - 1]} · ${e.where || ctx.cityName}`, title: e.stamp || e.title, sub: 'You were there. It is in your diary.' });
          L.note(`${e.title}${e.where ? `, ${e.where}` : ''}`, 'event');
          if (e.skill) L.gain(e.skill, e.xp || 4, e.title);
          L.emit('event', { id: e.id });
        }
      });
    }
    function action() {
      if (P.mode !== 'foot') return null;
      if (cur && cur.phase === 'run' && cur.j.type === 'point') return { key: 'E', text: `That way: ${cur.j.targets[cur.i].name}`, act: pointAt };
      // (a counter first: it is a few steps wide, and an event's ground may take it in)
      for (const s of shops()) if (dist(s.at) < (s.radius || 4.5) && L.day.onNow(s)) return { key: 'E', text: `Order at ${s.name}`, act: () => order(s) };
      for (const e of L.day.today()) if (e.at && dist(e.at) < (e.radius || 14) && L.day.onNow(e)) return { key: 'E', text: e.verb || `Join ${e.title}`, act: () => attend(e) };
      for (const s of shops()) if (dist(s.at) < (s.radius || 4.5)) return { key: '', text: `${s.name}: open ${L.day.whenOn(s)}` };
      return null;
    }

    // ---- the diary's page of work, and the passport's page of skills
    function page() {
      const list = offered();
      const rows = list.map(j => {
        const s = st(j.id), on = open(j) && s.slot !== slotKey();
        const why = !L.day.onNow(j.when) ? `Offered ${L.day.whenOn(j.when)}` : j.needs && L.level(j.needs.skill) < j.needs.level ? `Needs ${L.SKILLS.find(k => k.id === j.needs.skill).name} ${j.needs.level}` : s.slot === slotKey() ? 'Done for now' : '';
        return `<li class="${on ? 'on' : ''}"><b>${esc(j.title)}</b><span>${TYPE[j.type]} · ${L.fmt(j.pay)}${j.time_s ? ` · ${fmtS(j.time_s)}` : ''}${s.n ? ` · done ${s.n}×` : ''}</span><p>${esc(j.blurb || '')}</p>`
          + (cur && cur.j === j ? '<button class="btn" data-act="job-drop">Drop it</button>' : on && !cur ? `<button class="btn primary" data-act="job" data-id="${j.id}">Take it</button>` : `<span class="why">${esc(why || (cur ? 'One job at a time' : ''))}</span>`) + '</li>';
      }).join('');
      const sh = shops().map(s => `<li class="${L.day.onNow(s) ? 'on' : ''}"><b>${esc(s.name)}</b><span>${esc(s.where || '')}${L.day.onNow(s) ? ' · open now' : ` · open ${L.day.whenOn(s)}`}</span></li>`).join('');
      return `<section class="lf-head"><div><span class="eyebrow">Your wallet</span><b class="lf-dow num">${L.fmt(L.money)}</b></div></section>`
        + `<h3>Work</h3>${rows ? `<ul class="lf-list lf-jobs">${rows}</ul>` : '<p class="note">No work on this map yet.</p>'}`
        + (sh ? `<h3>Counters</h3><ul class="lf-list">${sh}</ul>` : '');
    }
    L.day.addTab({ id: 'work', title: 'Work', render: page, badge: () => (cur ? '•' : '') });
    L.day.act('job', b => { L.day.close(); start(b.dataset.id); });
    L.day.act('job-drop', () => { drop(); L.day.show(); });
    (L.partsToday || (L.partsToday = [])).push(() => offered().filter(j => open(j) && st(j.id).slot !== slotKey()).slice(0, 3).map(j => ({ title: j.title, note: `${TYPE[j.type]} · ${L.fmt(j.pay)}`, on: true }))
      .concat(shops().filter(s => L.day.onNow(s)).slice(0, 3).map(s => ({ title: s.name, note: `${s.where || 'Counter'} · open`, on: true }))));
    L.passport = panel => {
      let el = panel.querySelector('.lf-skills');
      if (!el) { el = document.createElement('section'); el.className = 'lf-skills'; panel.appendChild(el); }
      const ci = L.city(), dishes = ci.dishes.length, keeps = shops().flatMap(s => s.menu.filter(m => m.keep && ci.shelf.includes(m.id)));
      el.innerHTML = '<h3>What you have learned</h3><ul>' + L.SKILLS.map(k => {
        const xp = L.xp(k.id), lv = L.level(k.id), a = L.XP[lv - 1], b = L.XP[lv] || a;
        return `<li><b>${k.name}</b><span class="lv">${k.levels[lv - 1]}</span><span class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`
          + `<span class="bar" style="--k:${lv >= 5 ? 1 : ((xp - a) / Math.max(1, b - a)).toFixed(3)}"><i></i></span><span class="what">${k.what}</span></li>`;
      }).join('') + '</ul>'
        + `<p class="note">${dishes} dish${dishes === 1 ? '' : 'es'} tried here${Object.keys(ci.events).length ? ` · ${Object.keys(ci.events).length} day${Object.keys(ci.events).length === 1 ? '' : 's'} of the calendar kept` : ''}${keeps.length ? ` · kept: ${keeps.map(m => esc(m.name)).join(', ')}` : ''}</p>`;
    };
    const J = { all, start, drop, open, st, get active() { return cur; }, finish, pointAt, facing, bearing, order, attend, shops };
    L.use({ tick, action, reset() { drop(); } });
    L.jobs = J;
    return J;
  }
  return { create };
})();
