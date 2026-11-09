// The loading plate: while a city downloads and builds, the loader shows the city's own aerial
// survey assembling itself, tile by tile as each arrives, under a survey grid with the city's
// landmarks marked on it, and the progress on a card over it. It replaces a recorded flyover
// video, which was soft, stuttered while the city built on the main thread and flashed black.
//
// Everything on it is sharp at any size: the tiles are the model's own ground imagery at full
// resolution (the city loads the same files next, so they come from the cache), the grid and the
// type are vector. Everything that moves is a CSS transform or opacity, which the compositor runs
// on its own thread, so the plate keeps moving while the city is parsed and built. A visitor who
// prefers reduced motion gets it still.
'use strict';
window.OEPlate = (function () {
  const runs = new WeakMap();
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtLL = c => `${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? 'N' : 'S'}  ${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? 'E' : 'W'}`;
  // a source's name, without its licence and detail: "Project PLATEAU Kyoto City 2022"
  const short = s => String(s || '').split(/[(:;,]/)[0].replace(/\s+/g, ' ').trim();

  // show the plate in a loader (the game's or the model viewer's) as soon as the city is chosen
  // (district: a district of the city's map the visitor is going to, named on the plate with its map)
  function play(loader, city, district) {
    stop(loader);
    if (!loader || !city) return;
    const plate = document.createElement('figure'); // not a div: the loader styles its div, the progress card
    plate.className = 'plate';
    plate.setAttribute('aria-hidden', 'true');
    plate.innerHTML = `<div class="plate-map"></div><div class="plate-scan"></div><div class="plate-shade"></div>
      <div class="plate-hud">
        <span class="ph-c tl"></span><span class="ph-c tr"></span><span class="ph-c bl"></span><span class="ph-c br"></span>
        <span class="ph-t tl">Survey plate · <b>${esc(district ? `${district.name} · on the ${city.name} map` : city.name)}</b></span>
        <span class="ph-t tr">${esc(fmtLL(city))}</span>
        <span class="ph-t bl"><i class="ph-scale"><s></s><em></em></i></span>
        <span class="ph-t br"></span>
      </div>`;
    loader.prepend(plate);
    loader.classList.add('has-plate');
    if (reduced()) plate.classList.add('still');
    const run = { plate, imgs: [], ac: new AbortController(), fit: null };
    runs.set(loader, run);
    const facts = [];
    if (city.buildings) facts.push(`${Number(city.buildings).toLocaleString('en')} buildings`);
    if (city.extent_km) facts.push(`${city.extent_km[0]} × ${city.extent_km[1]} km`);
    plate.querySelector('.ph-t.br').textContent = facts.join(' · ');
    fetch(`data/${city.id}/scene.json`, { signal: run.ac.signal }).then(r => (r.ok ? r.json() : null)).then(scene => {
      if (scene && runs.get(loader) === run) build(run, city, scene);
    }).catch(() => {});
  }

  function build(run, city, scene) {
    const map = run.plate.querySelector('.plate-map'), f = scene.frame;
    const mw = f.x[1] - f.x[0], mh = f.y[1] - f.y[0];
    const X = x => `${((x - f.x[0]) / mw * 100).toFixed(3)}%`, Y = y => `${((f.y[1] - y) / mh * 100).toFixed(3)}%`;
    // the survey grid: a line every 250 m, stronger every kilometre, which carries its distance
    // from the city's centre
    const step = 250, lines = [], ticks = [];
    for (let x = Math.ceil(f.x[0] / step) * step; x <= f.x[1]; x += step) {
      const km = x % 1000 === 0, px = (x - f.x[0]) / mw * 1000;
      lines.push(`<line x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="1000" class="${km ? 'km' : ''}"/>`);
      if (km && x) ticks.push(`<span class="plate-tick x" style="left:${X(x)}">${x > 0 ? '+' : '−'}${Math.abs(x / 1000)} km E</span>`);
    }
    for (let y = Math.ceil(f.y[0] / step) * step; y <= f.y[1]; y += step) {
      const km = y % 1000 === 0, py = (f.y[1] - y) / mh * 1000;
      lines.push(`<line x1="0" y1="${py.toFixed(1)}" x2="1000" y2="${py.toFixed(1)}" class="${km ? 'km' : ''}"/>`);
      if (km && y) ticks.push(`<span class="plate-tick y" style="top:${Y(y)}">${y > 0 ? '+' : '−'}${Math.abs(y / 1000)} km N</span>`);
    }
    // the model's own ground imagery: its overview where it has one (scene.json ground_lo, one picture of the
    // whole frame, so that the plate doesn't fetch the far tiles the game loads only once it is open: issue
    // 335), else each tile, shown as it arrives
    const pics = scene.ground_lo ? [scene.ground_lo] : (scene.ground || []);
    const tiles = pics.map((t, i) =>
      `<img alt="" decoding="async" data-i="${i}" style="left:${X(t.x0)};top:${Y(t.y1)};width:${((t.x1 - t.x0) / mw * 100).toFixed(3)}%;height:${((t.y1 - t.y0) / mh * 100).toFixed(3)}%">`).join('');
    // the landmarks, marked one after another
    const labels = Object.entries(scene.labels || {}).filter(([, p]) => p[0] > f.x[0] && p[0] < f.x[1] && p[1] > f.y[0] && p[1] < f.y[1]).slice(0, 14)
      .map(([name, p], i) => `<span class="plate-pin" style="left:${X(p[0])};top:${Y(p[1])};animation-delay:${(0.9 + i * 0.32).toFixed(2)}s"><i></i>${esc(name)}</span>`).join('');
    map.innerHTML = `${tiles}<svg class="plate-grid" viewBox="0 0 1000 1000" preserveAspectRatio="none">${lines.join('')}</svg>${ticks.join('')}${labels}`;
    map.querySelectorAll('img').forEach(img => {
      const t = pics[+img.dataset.i], jpeg = `data/${city.id}/${t.file}`;
      img.onload = () => img.classList.add('in');
      img.onerror = () => { if (!img.src.endsWith(jpeg)) img.src = jpeg; }; // (no AVIF here: the JPEG)
      img.src = t.avif ? `data/${city.id}/${t.avif}` : jpeg;
      run.imgs.push(img);
    });
    const src = scene.sources || {};
    const credit = [short(src.imagery) && `Imagery ${short(src.imagery)}`, short(src.heights || src.buildings) && `Heights ${short(src.heights || src.buildings)}`].filter(Boolean).join(' · ');
    if (credit) run.plate.querySelector('.ph-t.tl').insertAdjacentHTML('beforeend', `<small>${esc(credit)}</small>`);
    // fit: cover the loader with the model's frame, with room for the drift
    const fit = () => {
      const W = run.plate.clientWidth, H = run.plate.clientHeight;
      if (!W || !H) return;
      const s = Math.max(W / mw, H / mh) * 1.06;
      map.style.width = `${(mw * s).toFixed(1)}px`;
      map.style.height = `${(mh * s).toFixed(1)}px`;
      // a scale bar a round number of metres long, about a sixth of the frame's width
      const target = W / 6 / s, nice = [100, 200, 250, 500, 1000, 2000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
      const bar = run.plate.querySelector('.ph-scale');
      bar.querySelector('s').style.width = `${(nice * s).toFixed(1)}px`;
      bar.querySelector('em').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    };
    run.fit = fit;
    fit();
    addEventListener('resize', fit, { signal: run.ac.signal });
    map.classList.add('on');
  }

  // resolves when the live scene may take over: at once (nothing to wait for, unlike a video)
  function finish(loader) {
    const run = runs.get(loader);
    if (run) run.plate.classList.add('done');
    return Promise.resolve(false);
  }
  // once the loader has faded: let the plate and its images go
  function stop(loader) {
    const run = loader && runs.get(loader);
    if (!run) return;
    run.ac.abort();
    for (const img of run.imgs) { img.onload = null; img.removeAttribute('src'); }
    run.plate.remove();
    loader.classList.remove('has-plate');
    runs.delete(loader);
  }
  return { play, finish, stop };
})();
