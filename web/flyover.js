// The loading flyover: a recorded flight over the city (tools/flyover.js) that plays behind the
// progress bar while the city downloads and builds. Its last frame is the game's title camera,
// so the live scene takes over from it with the loader's fade. A city without one (cities.json
// "flyover"), or a visitor who prefers reduced motion, gets the plain loader.
'use strict';
window.OEFlyover = (function () {
  const runs = new WeakMap();
  // start the video in a loader (the game's or the model viewer's), as soon as the city is chosen
  function play(loader, city) {
    const info = city && city.flyover;
    if (!loader || !info || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto', poster: `data/${city.id}/${info.poster}` });
    // H.264 first, VP9 for browsers built without it; the browser takes the first it can play
    const files = [[info.video, 'video/mp4'], [info.webm, 'video/webm']].filter(f => f[0]);
    for (const [file, type] of files) { const src = document.createElement('source'); Object.assign(src, { src: `data/${city.id}/${file}`, type }); v.append(src); }
    v.className = 'flyover';
    v.setAttribute('aria-hidden', 'true');
    loader.prepend(v);
    loader.classList.add('has-flyover');
    const run = { v, ended: false, release: null };
    const end = () => { run.ended = true; if (run.release) run.release(); };
    v.addEventListener('ended', end);
    v.addEventListener('error', end); // no video after all: carry on as if it had played
    if (v.lastElementChild) v.lastElementChild.addEventListener('error', end);
    v.play().catch(end);
    runs.set(loader, run);
  }
  // resolves when the live scene may take over: at once without a video, else when the video
  // ends or the visitor chooses to start (a button, any key, or a click). True if a video played.
  function finish(loader) {
    const run = runs.get(loader);
    if (!run) return Promise.resolve(false);
    return new Promise(resolve => {
      const ac = new AbortController();
      run.release = () => { ac.abort(); resolve(true); };
      if (run.ended || run.v.ended) return run.release();
      const panel = loader.querySelector(':scope > div');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flyover-start';
      btn.textContent = 'Start';
      panel.append(btn);
      loader.classList.add('ready');
      btn.focus({ preventScroll: true });
      const go = e => { if (e) e.preventDefault(); run.ended = true; run.release(); };
      btn.addEventListener('click', go, { signal: ac.signal });
      loader.addEventListener('pointerdown', go, { signal: ac.signal });
      addEventListener('keydown', go, { signal: ac.signal, capture: true });
    });
  }
  // once the loader has faded: let the video go
  function stop(loader) {
    const run = runs.get(loader);
    if (!run) return;
    run.v.pause();
    run.v.replaceChildren(); // drop the sources, so the browser lets the video go
    run.v.load();
    runs.delete(loader);
  }
  return { play, finish, stop };
})();
