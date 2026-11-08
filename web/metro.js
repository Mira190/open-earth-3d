// The subway map of a city drawn as maps of its own (Tokyo: a group in cities/index.json whose
// group_meta.kind is "metro"). The districts are stations, as games draw Tokyo (Persona 5's subway
// map, where a station is a district to go to): the lines and stations at their real positions, each
// built map's extent shaded behind its stations, the districts still to build in grey.
//
// One map for every page: the title screen's card and its full-screen map (title.js), the game's
// "change district" (game.js) and the 3D model's district bar (index.html) all draw it from here and
// open the same full-screen view, so it looks and answers the same wherever it is opened.
//
//   OEMetro.group(cities, id)          the group of the city `id`, as the map wants it, or null
//   OEMetro.map(g, cities, { full })    the map's markup (a card's, or the full-screen one's)
//   OEMetro.nearest(g, svg, x, y)       the station a touch at (x, y) meant, or -1
//   OEMetro.pick(root, g, i, cities, o) show station i picked in every copy of the map under root
//   OEMetro.full(o)                     open the full-screen map; returns { close, el }
//   OEMetro.isOpen(), OEMetro.close()   whether a full-screen map is open (a game pauses under it); close it
(function () {
  const RAD = Math.PI / 180;
  const escH = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const fmtLL = g => `${Math.abs(g.lat).toFixed(2)}°${g.lat >= 0 ? 'N' : 'S'} ${Math.abs(g.lon).toFixed(2)}°${g.lon >= 0 ? 'E' : 'W'}`;

  function group(cities, id) {
    const me = cities.find(c => c.id === id);
    const meta = me && me.group_meta;
    if (!meta || meta.kind !== 'metro') return null;
    const sites = cities.filter(c => c.group === me.group && c.built);
    const lat = sites.reduce((a, c) => a + c.lat, 0) / sites.length, lon = sites.reduce((a, c) => a + c.lon, 0) / sites.length;
    return { id: `group-${me.group}`, name: me.group, native: meta.native, country: me.country, lat, lon, meta, sites };
  }
  // the station a map is entered at: its own (not a travel point within it), else its first
  function home(g, mapId) {
    const ds = g.meta.districts;
    const j = ds.findIndex(s => s.map === mapId && !s.travel);
    return j >= 0 ? j : ds.findIndex(s => s.map === mapId);
  }

  function map(g, cities, o = {}) {
    const m = g.meta, pts = [], full = !!o.full, here = o.here || null;
    for (const l of m.lines) for (const [la, lo] of l.stops) pts.push([la, lo]);
    for (const s of m.districts) pts.push([s.lat, s.lon]);
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length, k = Math.cos(lat0 * RAD);
    const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = 400, pad = 26, sc = (W - 2 * pad) / (x1 - x0), H = Math.round((y1 - y0) * sc + 2 * pad);
    const P = (la, lo) => [pad + (lo * k - x0) * sc, pad + (-la - y0) * sc];
    const f = v => v.toFixed(1);
    // the built maps' extents, shaded
    const areas = g.sites.map(c => {
      if (!c.extent_km) return '';
      const [cx, cy] = P(c.lat, c.lon), w = c.extent_km[0] / 111.32 / Math.cos(c.lat * RAD) * k * sc, h = c.extent_km[1] / 111.32 * sc;
      return `<rect class="mt-area${c.id === here ? ' here' : ''}" x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="3"/>`;
    }).join('');
    const lines = m.lines.map((l, li) => {
      const ps = l.stops.map(([la, lo]) => P(la, lo).map(f).join(',')).join(' ');
      const tag = l.loop ? 'polygon' : 'polyline';
      return `<${tag} class="mt-line" points="${ps}" pathLength="1" style="--c:${l.colour};--k:${li}"><title>${escH(l.name)} ${escH(l.native || '')}</title></${tag}>`;
    }).join('');
    g.mtXY = m.districts.map(s => P(s.lat, s.lon));
    const hereAt = here ? home(g, here) : -1;
    const stns = m.districts.map((s, i) => {
      // the label on the side the group's config says (l, r, t, b), clear of its neighbours
      const [x, y] = g.mtXY[i], at = s.label || (x < W * 0.62 ? 'r' : 'l');
      const [tx, ty, an] = { r: [x + 11, y + 5, 'start'], l: [x - 11, y + 5, 'end'], t: [x, y - 12, 'middle'], b: [x, y + 21, 'middle'] }[at];
      // where the player is: a marker over the station of the map they are in
      // (on the side away from the station's name: left of a name on the right, and so on)
      // (and under the station where that side has no room for it: ~70 units of text)
      const side = at === 'r' && x < 84 ? 'below' : at === 'l' && x > W - 84 ? 'below' : at;
      const [mx, my, ma] = { r: [x - 12, y + 3, 'end'], l: [x + 12, y + 3, 'start'], t: [x, y + 20, 'middle'], b: [x, y - 13, 'middle'], below: [x, y + 21, 'middle'] }[side];
      const mark = i === hereAt ? `<g class="mt-you" aria-hidden="true"><circle class="mt-youring" cx="${f(x)}" cy="${f(y)}" r="11"/><text x="${f(mx)}" y="${f(my)}" text-anchor="${ma}">YOU ARE HERE</text></g>` : '';
      return `<g class="mt-stn${s.map ? ' on' : ''}${s.map && s.map === here ? ' here' : ''}" style="--k:${i}" data-district="${i}" tabindex="0" role="button" aria-label="${escH(s.name)}${s.map ? '' : ', coming soon'}${i === hereAt ? ', you are here' : ''}">
        ${s.map ? `<circle class="mt-ring" cx="${f(x)}" cy="${f(y)}" r="7"/>` : ''}<circle class="mt-dot" cx="${f(x)}" cy="${f(y)}" r="${s.map ? 7 : 5}"/><text x="${f(tx)}" y="${f(ty)}" text-anchor="${an}" lang="ja">${escH(s.native)}</text>${mark}</g>`;
    }).join('');
    const legend = m.lines.map(l => `<span style="--c:${l.colour}"><i></i>${escH(l.native || l.name)}</span>`).join('');
    // the built maps as buttons under the subway map: big enough for a thumb, and they say in words
    // what the lit stations are, for a visitor who would not think to touch a map
    const maps = [...new Set(m.districts.filter(s => s.map).map(s => s.map))].map(id => cities.find(c => c.id === id && c.built)).filter(Boolean);
    const chips = maps.map(c => `<button class="mt-chip" data-chip="${home(g, c.id)}" data-mapid="${c.id}"><b>${escH(c.name)}${c.id === here ? ' <i>Here</i>' : ''}</b>${c.native ? `<small lang="ja">${escH(c.native)}</small>` : ''}</button>`).join('');
    // until a station has been picked once in this browser, the lit ones pulse under a line that says
    // they can be chosen
    const cue = !store.get('oe3d-metro-picked');
    // on a card the map is small: a phone opens it full screen to choose from (a fingertip is bigger
    // than its stations there), a desktop can pick on it or open it
    const say = full ? `${touch() ? 'Tap' : 'Click'} a lit station, or a name` : touch() ? 'Tap the map' : 'Click a station';
    const grow = full ? '' : `<button class="mt-expand" data-full aria-label="Open the map of ${escH(g.name)} full screen"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5"/></svg>Open map</button>`;
    return `<div class="ts-metro${cue ? ' cue' : ''}${full ? ' big' : ''}"><div class="mt-cue"><i></i><span>${here ? 'Change district' : 'Choose a district'}</span><em>${say}</em>${grow}</div>
      <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Districts of ${escH(g.name)}">${areas}${lines}${stns}</svg>
      <div class="mt-chips" role="group" aria-label="Built maps">${chips}</div>
      <div class="mt-legend">${legend}</div><div class="mt-pick" aria-live="polite"></div></div>`;
  }

  // a touch on the map picks the station nearest to it, lit ones first: a fingertip covers several of
  // the small dots, and a near miss should still land on the district meant
  function nearest(g, svg, cx, cy) {
    const ctm = svg.getScreenCTM();
    if (!ctm || !g.mtXY) return -1;
    const pt = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    const reach = 26 / Math.max(0.2, ctm.a) * (touch() ? 1 : 0.6); // ~26 css px on a phone
    let best = -1, bd = Infinity;
    g.mtXY.forEach(([x, y], i) => {
      const dist = Math.hypot(x - pt.x, y - pt.y) * (g.meta.districts[i].map ? 1 : 1.5);
      if (dist < bd) { bd = dist; best = i; }
    });
    return bd <= reach * 1.5 ? best : -1;
  }

  // o.byUser: a person picked it (ends the cue); o.here: the map the player is in, whose own station
  // offers to stay; o.play: the primary button goes into the game (else the 3D model)
  function pick(root, g, i, cities, o = {}) {
    const s = g.meta.districts[i];
    if (!s) return;
    if (o.byUser) { store.set('oe3d-metro-picked', '1'); root.querySelectorAll('.ts-metro').forEach(tm => tm.classList.remove('cue')); }
    root.querySelectorAll('.mt-stn').forEach(el => el.classList.toggle('sel', +el.dataset.district === i));
    root.querySelectorAll('.mt-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mapid === s.map)));
    const c = s.map && cities.find(x => x.id === s.map && x.built);
    const arrive = s.travel ? ` data-arrive="${escH(s.travel)}"` : '';
    const stay = c && o.here === c.id && i === home(g, o.here); // (another station of your map: a travel point in it)
    const travel = o.here && c && !stay;
    const label = o.here ? (o.play === false ? 'Explore in 3D' : 'Travel here') : 'Play';
    const acts = !c ? ''
      : stay ? `<div class="ts-actions"><button class="ts-btn primary" data-close>Stay here <kbd>Esc</kbd></button></div>`
      : o.play === false ? `<div class="ts-actions"><button class="ts-btn primary" data-map="${c.id}" data-go="model">${label} <kbd>↵</kbd></button>${c.game ? `<button class="ts-btn" data-map="${c.id}" data-go="play"${arrive}>Play <kbd>P</kbd></button>` : ''}</div>`
      : `<div class="ts-actions">${c.game ? `<button class="ts-btn primary" data-map="${c.id}" data-go="play"${arrive}>${o.here ? label : `<span class="ts-bl">${label}<small>at ${escH(s.name)}</small></span>`} <kbd>${travel ? '↵' : 'P'}</kbd></button>` : ''}<button class="ts-btn" data-map="${c.id}" data-go="model">Explore in 3D${travel ? '' : ' <kbd>↵</kbd>'}</button></div>`;
    const tag = !c ? '<em class="next">Coming soon</em>' : stay ? '<em>You are here</em>' : `<em>${escH(c.name)} map</em>`;
    // as a travel guide reads (cities/guide.json): the district's hook and its sights, else the map's line
    const sg = s.guide || {};
    const note = sg.line || (c ? (s.travel ? s.note || c.tagline || '' : c.tagline || '') : s.note || '');
    const spots = sg.spots ? `<ul class="mt-spots">${sg.spots.map(n => `<li>${escH(n)}</li>`).join('')}</ul>` : '';
    for (const el of root.querySelectorAll('.mt-pick')) {
      el.innerHTML = `<div class="mt-name"><b>${escH(s.name)}</b><small lang="ja">${escH(s.native)}</small>${tag}</div><p>${escH(note)}</p>${spots}${acts}`;
    }
  }

  // ------------------------------------------------------------ the map, full screen
  // Choosing a district gets the whole screen, as a game's world map does: what is behind dims, the
  // lines draw themselves and the stations light up one after another, the stations grow to a
  // fingertip's size, and the district picked comes up beside the map (under it on a phone) with what
  // can be done there. Esc or Back returns; the arrow keys walk the lit stations.
  //   o.host      where it goes (default: the page, fixed over everything)
  //   o.g, o.cities, o.here, o.sel   the group, the cities, the map the player is in, the station to show
  //   o.play      false: Enter and the primary button open the 3D model, not the game
  //   o.onGo(city, play, arrive)    a district chosen; default: go there by the address
  //   o.onPick(i, byUser)           a station picked (the title keeps its card in step); default: pick()
  //   o.onClose(quiet)              closed (quiet: because the page is going somewhere)
  let open = null;
  function full(o) {
    if (open) open.close(true);
    const g = o.g, cities = o.cities, solo = !o.host;
    const el = document.createElement('section');
    el.className = `ts-mfull${solo ? ' solo' : ''}`;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', `Districts of ${g.name}`);
    el.innerHTML = `<div class="mf-head"><div><span class="eb">${escH(g.country)} · ${fmtLL(g)}</span><h2>${escH(g.name)}${g.native ? `<small lang="ja">${escH(g.native)}</small>` : ''}</h2></div>
      <button class="mf-x" data-close aria-label="${escH(o.backLabel || 'Back')}">${escH(innerWidth >= 860 && o.backWord || 'Back')} <kbd>Esc</kbd></button></div>${map(g, cities, { full: true, here: o.here })}`;
    (o.host || document.body).appendChild(el);
    const from = document.activeElement;
    let cur = -1;
    const doPick = (i, byUser) => {
      if (i < 0) return;
      cur = i;
      if (o.onPick) o.onPick(i, byUser); else pick(el, g, i, cities, { byUser, here: o.here, play: o.play });
    };
    const go = (city, play, arrive) => {
      if (o.onGo) { o.onGo(city, play, arrive); return; }
      ctl.close(true);
      location.hash = play ? `play-${city.id}${arrive ? `@${arrive}` : ''}` : city.id;
    };
    const step = dir => {
      const lit = g.meta.districts.map((s, i) => (s.map ? i : -1)).filter(i => i >= 0);
      const i = lit[(lit.indexOf(cur) + dir + lit.length) % lit.length];
      doPick(i, true);
      const st = el.querySelector(`.mt-stn[data-district="${i}"]`);
      if (st) st.focus({ preventScroll: true });
    };
    const onClick = e => {
      if (e.target.closest('[data-close]')) { ctl.close(); return; }
      const ch = e.target.closest('[data-chip]');
      if (ch) { doPick(+ch.dataset.chip, true); return; }
      const b = e.target.closest('button[data-map]');
      if (b) { go(cities.find(c => c.id === b.dataset.map), b.dataset.go === 'play', b.dataset.arrive); return; }
      const svg = e.target.closest('svg');
      if (svg && svg.closest('.ts-metro')) {
        const st = e.target.closest('[data-district]');
        doPick(e.detail === 0 && st ? +st.dataset.district : nearest(g, svg, e.clientX, e.clientY), true);
      }
    };
    // the keys are the map's while it is open: nothing behind it (the game, the globe) sees them
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.stopImmediatePropagation(); // (a key sent to the window itself reaches its other listeners otherwise)
      const k = e.key.toLowerCase(), st = e.target.closest && e.target.closest('[data-district]');
      const btn = sel => el.querySelector(sel);
      if (k === 'escape') { e.preventDefault(); ctl.close(); }
      else if (st && (k === 'enter' || k === ' ')) { e.preventDefault(); doPick(+st.dataset.district, true); }
      else if (['arrowright', 'arrowdown', 'd', 's'].includes(k)) { e.preventDefault(); step(1); }
      else if (['arrowleft', 'arrowup', 'a', 'w'].includes(k)) { e.preventDefault(); step(-1); }
      else if (k === 'p' && btn('[data-map][data-go="play"]')) btn('[data-map][data-go="play"]').click();
      else if (k === 'enter' && !(e.target.closest && e.target.closest('button'))) {
        e.preventDefault();
        const b = o.play === false ? btn('[data-map][data-go="model"]') : o.here ? btn('.mt-pick .primary') : btn('[data-map][data-go="model"]');
        if (b) b.click();
      }
    };
    const onHash = () => ctl.close(true);
    el.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', onHash);
    const ctl = open = {
      el,
      close(quiet = false) {
        if (!el.isConnected) return;
        el.remove();
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('hashchange', onHash);
        if (open === ctl) open = null;
        if (!quiet && from && from.isConnected && from.focus) from.focus({ preventScroll: true });
        if (o.onClose) o.onClose(quiet);
      },
    };
    doPick(o.sel != null && o.sel >= 0 ? o.sel : o.here ? home(g, o.here) : g.meta.districts.findIndex(x => x.map), false);
    const st = el.querySelector('.mt-stn.sel') || el.querySelector('.mt-stn.on');
    if (st) st.focus({ preventScroll: true });
    return ctl;
  }

  window.OEMetro = { group, home, map, nearest, pick, full, isOpen: () => !!open, close: () => { if (open) open.close(true); } };
})();
