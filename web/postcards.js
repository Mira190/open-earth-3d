// Postcards from the road (docs/POSTCARDS.md).
//
// While you are away, the plush friends keep travelling, one to each map (a white Inari fox at Fushimi
// Inari, a koala in Sydney...): one photograph every six hours of real time, from a spot in one of the
// live cities, the friend held up in front of the view, with a line of its diary. The title screen shows
// what has come since the last visit (three at most) as a small pile of postcards; opening one shows
// the picture, where and when it was taken and the sun there at that minute, and "Go there" starts
// the city's game on that spot, in that light.
//
// Nothing here needs a server. The journey is worked out when the page opens, from a seed kept in
// localStorage and the time since the last visit. A postcard's picture is a still of the game's own
// world (pipeline/postcards.py, four lights for each spot); the one shown is the light the real sun
// gave that city at the minute the card is dated, by the same NOAA equations the cities use (sun.js).
//
// Works in the browser (window.OEPostcards) and in Node (require('./postcards.js')), where
// tools/postcards_check.js runs the journey over a few weeks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sun.js'));
  else root.OEPostcards = factory(root.Sun);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  const KEY = 'oe3d-postcards';
  const EVERY = 6 * 3600e3;   // one postcard every six hours away
  const PER_VISIT = 3;        // and no more than three at a visit, however long it has been
  const ALBUM = 48;           // the album keeps the newest
  const MIN = 60e3;

  // a small seeded generator (mulberry32), so a journey can be replayed in a check
  const rng = seed => () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // which of the four stills the sun over the city gave at that minute
  function light(t, city) {
    const a = S.position(t, city.lat, city.lon).altitude;
    if (a > 8) return 'day';
    if (a < -5) return 'night';
    return S.position(t + 10 * MIN, city.lat, city.lon).altitude > a ? 'dawn' : 'dusk';
  }

  const fresh = now => ({ v: 1, seed: (now % 2147483647) | 0, at: 0, n: 0, where: null, was: null, left: 0, cards: [] });

  // The postcards that have come since state.at, added to state.cards (newest last). M: data/postcards.json;
  // cities: data/cities.json. Returns the new ones.
  function plan(state, now, M, cities) {
    const maps = cities.filter(c => M.cities[c.id] && M.cities[c.id].length);
    if (!maps.length) return [];
    const first = !state.at;
    const n = first ? 1 : Math.min(PER_VISIT, Math.floor((now - state.at) / EVERY));
    if (n < 1) return [];
    const R = rng(state.seed + state.n * 7919);
    // when each was taken: the newest within the last hour and a half, the others about six hours apart before
    // it, none before the last visit
    const times = [];
    let t = now - (20 + 70 * R()) * MIN;
    for (let i = 0; i < n; i++) {
      times.unshift(Math.max(t, state.at + (n - i) * MIN));
      t -= EVERY * (0.75 + 0.5 * R());
    }
    const out = [];
    for (let t of times) {
      // a stay of two or three postcards in one map, then on to another: not the last two, and the
      // map the album has the fewest from, so the journey gets round them all
      if (!state.left || !maps.some(c => c.id === state.where)) {
        const count = id => state.cards.filter(k => k.c === id).length;
        let pool = maps.filter(c => c.id !== state.where && c.id !== state.was);
        if (!pool.length) pool = maps.filter(c => c.id !== state.where);
        if (!pool.length) pool = maps;
        const least = Math.min(...pool.map(c => count(c.id)));
        pool = pool.filter(c => count(c.id) <= least + 1);
        state.was = state.where;
        state.where = pool[Math.floor(R() * pool.length)].id;
        state.left = 2 + (R() < 0.5 ? 1 : 0);
      }
      const city = maps.find(c => c.id === state.where), spots = M.cities[city.id];
      // nobody photographs a street at four in the morning: a card dated in the small hours is
      // from the evening before
      const loc = S.utcToLocal(t, city.timezone);
      if (loc.minutes > 30 && loc.minutes < 300) t = Math.max(t - (loc.minutes + 30 + 150 * R()) * MIN, state.at + MIN);
      // a spot the album does not have yet, if there is one
      const have = new Set(state.cards.filter(k => k.c === city.id).map(k => k.s));
      let pick = spots.filter(s => !have.has(s.id));
      if (!pick.length) { const last = state.cards.length ? state.cards[state.cards.length - 1].s : null; pick = spots.filter(s => s.id !== last); }
      if (!pick.length) pick = spots;
      const spot = pick[Math.floor(R() * pick.length)], l = light(t, city);
      const card = { c: city.id, s: spot.id, l, t: Math.round(t), k: Math.floor(R() * 1000), seen: 0 };
      state.cards.push(card);
      state.left--;
      state.n++;
      out.push(card);
    }
    state.cards.sort((a, b) => a.t - b.t);
    if (state.cards.length > ALBUM) state.cards.splice(0, state.cards.length - ALBUM);
    state.at = now;
    return out;
  }

  // what a card says: the map and the spot, the local date and time, the sun, the line of the diary
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function describe(card, M, cities) {
    const city = cities.find(c => c.id === card.c), spot = city && (M.cities[card.c] || []).find(s => s.id === card.s);
    if (!spot) return null;
    const loc = S.utcToLocal(card.t, city.timezone), alt = S.position(card.t, city.lat, city.lon).altitude;
    const hh = Math.floor(loc.minutes / 60), mm = Math.floor(loc.minutes % 60), pad = v => String(v).padStart(2, '0');
    const wd = WD[new Date(Date.UTC(loc.y, loc.m - 1, loc.d)).getUTCDay()];
    const lines = [].concat(spot.lines[card.l] || spot.lines.any || []), f = (M.friends || {})[card.c];
    return {
      city, spot,
      from: f ? `${f.name}, ${f.what}` : 'a friend on the road',
      where: city.district ? `${city.group} · ${city.district}` : city.name,
      date: `${wd} ${loc.d} ${MO[loc.m - 1]}`, day: `${loc.d} ${MO[loc.m - 1]} ${loc.y}`,
      time: `${pad(hh)}:${pad(mm)}`, zone: loc.zone,
      sun: `Sun ${Math.abs(Math.round(alt))}° ${alt >= 0 ? 'up' : 'down'}`,
      line: lines.length ? lines[card.k % lines.length] : '',
      src: `data/${card.c}/postcards/${card.s}-${card.l}.webp`,
      arrive: `pc-${card.s}.${card.l}`,
    };
  }

  // "#play-<city>@pc-<spot>.<light>": where the game starts and at what light (game.js)
  function arrival(M, cityId, arrive) {
    const m = /^pc-([a-z0-9-]+)\.(dawn|day|dusk|night)$/.exec(arrive || ''), spot = m && M && (M.cities[cityId] || []).find(s => s.id === m[1]);
    return spot ? { id: arrive, name: spot.name + (spot.native ? ` ${spot.native}` : ''), at: spot.at, look: spot.look, light: m[2], postcard: true } : null;
  }
  // the clock time (minutes) of a light on a date, as the stills were taken (pipeline/postcards.py LIGHTS)
  function lightTime(l, y, m, d) {
    const L = S.dayLimits(y, m, d);
    return l === 'dawn' ? L.sunrise + 25 : l === 'dusk' ? L.sunset + 8 : l === 'night' ? Math.min(1430, L.sunset + 100) : 11 * 60;
  }

  // ------------------------------------------------------------ the browser
  let manifest = null;
  const load = () => manifest || (manifest = fetch('data/postcards.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
  function read() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.v === 1 && Array.isArray(s.cards) ? s : null; } catch (e) { return null; }
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }
  // the album's cards from one map, newest first, described (the game's passport)
  async function album(cityId, cities) {
    const M = await load(), s = read();
    if (!M || !s) return [];
    return s.cards.filter(k => !cityId || k.c === cityId).map(k => Object.assign({ card: k }, describe(k, M, cities))).filter(k => k.spot).reverse();
  }

  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  // The pile on the title screen and the viewer over it. host: the title's stage; onGo(city, arrive): the dive;
  // tick(): the menu's tick, if there is sound; track(event, props): telemetry. Returns { open, close, isOpen, stop }.
  async function mount({ host, cities, onGo, tick = () => {}, track = () => {}, now = Date.now() }) {
    const M = await load();
    if (!M || !host.isConnected) return null;
    const state = read() || fresh(now);
    const came = plan(state, now, M, cities);
    write(state);
    let cards = state.cards.map(k => Object.assign({ card: k }, describe(k, M, cities))).filter(k => k.spot).reverse(); // newest first
    if (!cards.length) return null;
    const fresh0 = cards.filter(k => !k.card.seen).length;
    track('postcards_shown', { new: came.length, unseen: fresh0, album: cards.length });

    const pile = document.createElement('button');
    pile.className = 'ts-post'; pile.id = 'ts-post'; pile.type = 'button';
    const view = document.createElement('div');
    view.className = 'ts-postview'; view.id = 'ts-postview'; view.hidden = true;
    view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true'); view.setAttribute('aria-label', 'Postcards from the road');
    view.innerHTML = `<div class="pv-card">
      <button class="pv-x" aria-label="Close the postcards">×</button>
      <figure class="pv-photo"><img alt="" width="960" height="640" decoding="async"><figcaption class="pv-mark" aria-hidden="true"><b></b><i></i><span></span></figcaption></figure>
      <div class="pv-text">
        <p class="pv-where ts-mono"></p>
        <h2></h2>
        <p class="pv-when ts-mono" aria-live="polite"></p>
        <p class="pv-line"></p>
        <p class="pv-from ts-mono"></p>
        <div class="pv-act"><button class="pv-go">Go there<kbd>↵</kbd></button><button class="pv-nav" data-d="1" aria-label="The one before">←</button><span class="pv-n ts-mono"></span><button class="pv-nav" data-d="-1" aria-label="The next one">→</button></div>
      </div>
      <ol class="pv-album" aria-label="The album"></ol>
    </div>`;
    host.append(pile, view);
    const $ = q => view.querySelector(q);
    let at = 0, opener = null;

    function drawPile() {
      const unseen = cards.filter(k => !k.card.seen).length, top = cards.slice(0, 3);
      pile.innerHTML = `<span class="pile">${top.map((k, i) => `<i style="--i:${i};background-image:url(${esc(k.src)})"></i>`).reverse().join('')}</span>`
        + `<span class="pl"><b>From the road</b><small>${unseen ? `${unseen} new · ` : ''}${esc(top[0].city.district || top[0].city.name)}</small></span>`;
      pile.classList.toggle('new', unseen > 0);
      pile.setAttribute('aria-label', `Postcards from the road: ${unseen ? `${unseen} new` : `${cards.length} in the album`}`);
    }
    function drawAlbum() {
      $('.pv-album').innerHTML = cards.map((k, i) => `<li><button data-i="${i}" aria-label="${esc(k.spot.name)}, ${esc(k.where)}, ${esc(k.date)}"${i === at ? ' aria-current="true"' : ''}${k.card.seen ? '' : ' class="new"'}><img src="${esc(k.src)}" alt="" loading="lazy" width="96" height="64"></button></li>`).join('');
    }
    function show(i, by) {
      at = (i + cards.length) % cards.length;
      const k = cards[at];
      const img = $('.pv-photo img');
      img.classList.remove('in');
      img.onload = () => img.classList.add('in');
      img.src = k.src; img.alt = `${k.spot.name}, ${k.where}: a photograph at ${k.time}`;
      if (img.complete) img.classList.add('in');
      $('.pv-mark b').textContent = k.city.district || k.city.name;
      $('.pv-mark i').textContent = k.day;
      $('.pv-mark span').textContent = k.time;
      $('.pv-where').textContent = k.where;
      $('h2').innerHTML = esc(k.spot.name) + (k.spot.native ? `<small lang="ja">${esc(k.spot.native)}</small>` : '');
      $('.pv-when').textContent = `${k.date} · ${k.time} ${k.zone} · ${k.sun}`;
      $('.pv-line').textContent = k.line;
      $('.pv-from').textContent = `From the road · ${k.from}`;
      $('.pv-n').textContent = `${cards.length - at} / ${cards.length}`;
      if (!k.card.seen) { k.card.seen = 1; write(state); drawPile(); }
      drawAlbum();
      const cur = $('.pv-album [aria-current]');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
      if (by) { tick(); track('postcard_open', { city: k.card.c, spot: k.card.s, light: k.card.l, by }); }
    }
    const isOpen = () => !view.hidden;
    function open(i = 0) {
      if (isOpen()) return;
      opener = document.activeElement;
      view.hidden = false;
      host.classList.add('posting');
      show(i, 'pile');
      $('.pv-go').focus({ preventScroll: true });
    }
    function close() {
      if (!isOpen()) return;
      view.hidden = true;
      host.classList.remove('posting');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    }
    function go() {
      const k = cards[at];
      track('postcard_go', { city: k.card.c, spot: k.card.s, light: k.card.l });
      close();
      onGo(k.city, k.arrive);
    }
    const ac = new AbortController(), o = { signal: ac.signal };
    pile.addEventListener('click', e => { e.stopPropagation(); open(Math.max(0, cards.map(k => !k.card.seen).lastIndexOf(true))); }, o); // the oldest unread first
    view.addEventListener('click', e => {
      e.stopPropagation();
      const nav = e.target.closest('.pv-nav'), th = e.target.closest('.pv-album button');
      if (e.target === view || e.target.closest('.pv-x')) close();
      else if (e.target.closest('.pv-go')) go();
      else if (nav) show(at + +nav.dataset.d, 'arrow');
      else if (th) show(+th.dataset.i, 'album');
    }, o);
    // the keys are the viewer's while it is open (the title's own handler stands down: title.js)
    document.addEventListener('keydown', e => { // (on the document: a click on the picture leaves the focus on the page)
      if (!isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(at + 1, 'arrow'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(at - 1, 'arrow'); }
      else if (e.key === 'Enter' && !e.target.closest('button:not(.pv-go)')) { e.preventDefault(); go(); }
      else if (e.key === 'Tab') { // the focus stays in the dialog
        const f = [...view.querySelectorAll('button')], a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && (document.activeElement === z || !view.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
      }
    }, { signal: ac.signal, capture: true });
    for (const type of ['pointerdown', 'wheel', 'touchstart']) view.addEventListener(type, e => e.stopPropagation(), { signal: ac.signal, passive: true });
    for (const type of ['pointerdown', 'keydown']) pile.addEventListener(type, e => e.stopPropagation(), o);
    drawPile();
    return { open, close, isOpen, el: pile, cards: () => cards, stop() { ac.abort(); pile.remove(); view.remove(); } };
  }

  return { KEY, EVERY, PER_VISIT, ALBUM, light, lightTime, fresh, plan, describe, arrival, load, album, mount };
});
