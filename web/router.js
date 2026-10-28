// Router: "#<city id>" opens that city's 3D model, "#play-<city id>" its game,
// anything else shows the globe. Views switch in place, without reloading the page:
// the old view stops, and a view shown before gets a fresh copy of its markup so no
// old listeners remain.
(async function route() {
  const $ = id => document.getElementById(id);
  const ids = ['globe-app', 'city-app', 'game-app'];
  const fresh = Object.fromEntries(ids.map(id => [id, $(id).cloneNode(true)]));
  const used = new Set();
  const pane = id => {
    if (used.has(id)) { const el = fresh[id].cloneNode(true); $(id).replaceWith(el); }
    used.add(id);
    return $(id);
  };
  let cities = [];
  try { cities = await fetch('data/cities.json').then(r => r.json()); } catch (e) { cities = []; }
  const hashId = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  let current = null;
  async function show() {
    const id = hashId(), play = /^play-/.test(id), cid = id.replace(/^play-/, '');
    const city = cities.find(c => c.id === cid && c.built && (!play || c.game));
    const prev = current;
    current = null;
    if (prev) { const ctl = await prev; if (ctl) ctl.stop(); }
    for (const x of ids) $(x).hidden = true;
    if (city && play) {
      pane('game-app').hidden = false;
      $('g-load-title').textContent = `Loading ${city.name}`;
      $('gm-model').href = `#${city.id}`;
      current = window.OpenEarthGame(city.id);
    } else if (city) {
      const el = pane('city-app');
      el.hidden = false;
      $('load-title').textContent = `Building ${city.name}`;
      if (city.game) { $('btn-play').hidden = false; $('btn-play').href = `#play-${city.id}`; }
      current = window.OpenEarthCity(city.id);
    } else {
      pane('globe-app').hidden = false;
      current = window.OpenEarthGlobe(cities, id && id !== 'globe' ? `“${id}” has no 3D model yet. Pick a live city.` : '');
    }
  }
  document.addEventListener('click', e => { if (e.target.closest('#back-globe')) { e.preventDefault(); location.hash = 'globe'; } });
  addEventListener('hashchange', show);
  show();
})();
