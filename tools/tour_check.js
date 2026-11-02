// Play a city's guided tour in the model viewer headless and check it as a visitor sees it:
//   - every stop comes in order, its caption reads "NN / NN" and the bar has one segment per stop;
//   - the last stop's button says Finish; when its time is up the tour ends there instead of
//     starting over: the end card shows (Explore, Watch again, Play where the city has a game),
//     every segment is full, the camera turns slowly, and a few seconds on it has not moved on;
//   - Watch again starts from the first stop, and Finish on the last stop ends the tour too;
//   - at every stop the scene, drawn into a float target, holds no NaN or infinity and nothing
//     brighter than a lit city (the bloom turns one such pixel into a ball of light that flashes),
//     and no more than GLARE_SHARE of it above 16, where a low sun's glare over water blooms into a
//     veil or a column (issue 42; tools/glare_probe.js takes such a view apart);
//   - no frame in a flight between stops is a flat colour, and two frames of a still view differ
//     as a frame that flashes or pumps would: the mean by under 3 levels, under a tenth of 4x4 blocks.
//   - the context lost on purpose (WEBGL_lose_context): the view holds under a note, and once the
//     context is back the next frame is drawn, lit as before (web/glcare.js).
// Writes two stills per stop (stop-NN.jpg, stop-NNb.jpg), one from each flight (fly-NN.jpg), the end card
// (end.png) and the view either side of the lost context (ctx-before.jpg, ctx-after.jpg) to out_dir; prints one line per check and exits 1 if any failed.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/tour_check.js tokyo /tmp/tour-tokyo [1280x800]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'tokyo', outDir = `/tmp/tour-${city}`, size = '1280x800'] = process.argv;
const [W, H] = size.split('x').map(Number);
const PORT = process.env.PORT || 8800;
const HDR_MAX = 1024; // the materials' own ceiling (lens.js); a lit city peaks near 16
const GLARE_SHARE = 0.008; // the share of the frame above 16: Sydney's blown column was 1.2%, a glitter path stays under 0.6%

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  // the desktop tier, as for the films and stills (a software renderer would pick the low one)
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  // a lost WebGL context draws nothing but black: named as such, not left to read as a flat frame
  await p.addInitScript(() => {
    window.__ctxLost = 0;
    addEventListener('webglcontextlost', () => { window.__ctxLost++; }, true);
  });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error' && !/\/version\.json$/.test((m.location() || {}).url || '')) errors.push(m.text().slice(0, 300)); });
  const results = [];
  const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };

  const t0 = Date.now();
  await p.goto(`http://localhost:${PORT}/#${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000 });
  console.log(`${city}: loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.keyboard.press('Shift'); // skips the establishing shot, which ends on the first stop
  await p.waitForFunction('window.__city.tour.i === 0', null, { timeout: 120000 });

  const frame = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  // the canvas as luma (every 4th pixel), its mean and spread, and a JPEG for the record
  const grab = async file => {
    const r = await p.evaluate(() => {
      const c = document.getElementById('gl'), w = 320, h = Math.round(320 * c.height / c.width);
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      const g = o.getContext('2d'); g.drawImage(c, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
      return { url: c.toDataURL('image/jpeg', 0.85), L: Array.from(L) };
    });
    if (file) fs.writeFileSync(path.join(outDir, file), Buffer.from(r.url.split(',')[1], 'base64'));
    const L = r.L, n = L.length, mean = L.reduce((a, v) => a + v, 0) / n;
    return { L, mean, sd: Math.sqrt(L.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n) };
  };
  // the scene alone, in a float target at half size: its brightest pixel and any NaN or infinity
  const hdr = () => p.evaluate(() => {
    const C = window.__city, R = C.renderer, w = R.domElement.width >> 1, h = R.domElement.height >> 1;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    R.setRenderTarget(rt); R.render(C.world, C.camera); R.setRenderTarget(null);
    const px = new Float32Array(w * h * 4);
    R.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    let max = 0, bad = 0, over = 0;
    for (let i = 0; i < w * h; i++) {
      const m = Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
      if (!Number.isFinite(m)) bad++; else { if (m > max) max = m; if (m > 16) over++; }
    }
    return { max, bad, share: over / (w * h) };
  });
  const state = () => p.evaluate(() => {
    const C = window.__city, $ = s => document.querySelector(s);
    return { i: C.tour.i, n: $('#tour-list').children.length, playing: C.tour.playing, done: C.tour.done, orbit: C.orbit.on,
      step: $('#cap-step').textContent, title: $('#cap-title').textContent, skip: $('#cap-skip').hidden ? null : $('#cap-skip').textContent,
      caption: !$('#caption').hidden, card: $('#caption').classList.contains('done') && !$('#cap-end').hidden,
      play: !$('#cap-play').hidden, segs: [...document.querySelectorAll('#cap-bars i')].map(i => parseFloat(i.style.width) || 0),
      tourBtn: $('#btn-tour').textContent, panelBtn: $('#tour-play').textContent, game: !$('#btn-play').hidden };
  });
  // Hold the stop in hand at its start while it is checked (a software renderer's frames are so
  // slow that a stop would run out on its own between two checks): the flight there still runs.
  // Then run the stop to its end: its time is skipped, the flight that follows is not.
  const freeze = () => p.evaluate(() => { window.__city.tour.t0 = performance.now() + 1e9; window.__stopAt = performance.now(); });
  // the flight takes 3.2 s; the light settles a moment after (the sky's last rebuild, world.js envEvery)
  const landed = () => p.waitForFunction(() => performance.now() - window.__stopAt > 4500, null, { timeout: 60000 });
  const finishStop = () => p.evaluate(() => { window.__city.tour.t0 = performance.now() - 1e7; });

  const n = (await state()).n;
  const pad = v => String(v).padStart(2, '0');
  let worstHdr = { max: 0, bad: 0 }, flat = [], flicker = 0;
  await freeze();
  for (let i = 0; i < n; i++) {
    const s = await state();
    check(`stop ${i + 1}: caption`, s.i === i && s.step === `${pad(i + 1)} / ${pad(n)}` && s.caption && s.segs.length === n,
      `${s.step} "${s.title}"`);
    if (i === n - 1) check('last stop says Finish', s.skip === 'Finish', `button: ${s.skip}`);
    else if (i > 0) check(`stop ${i + 1}: says Next`, s.skip === 'Next');
    // the stop, with the flight done: its still, its HDR range and two frames apart
    await landed();
    await frame();
    const h = await hdr();
    worstHdr = { max: Math.max(worstHdr.max, h.max), bad: worstHdr.bad + h.bad };
    check(`stop ${i + 1}: no NaN, infinity or runaway highlight`, h.bad === 0 && h.max <= HDR_MAX, `max ${h.max.toFixed(1)}, non-finite ${h.bad}`);
    check(`stop ${i + 1}: no glare that blooms`, h.share <= GLARE_SHARE, `${(h.share * 100).toFixed(2)}% of the frame above 16`);
    const a = await grab(`stop-${pad(i + 1)}.jpg`);
    check(`stop ${i + 1}: drawn`, a.sd >= 4, `luma ${a.mean.toFixed(0)} ± ${a.sd.toFixed(1)}`);
    await p.waitForTimeout(400);
    await frame();
    const c = await grab(`stop-${pad(i + 1)}b.jpg`);
    // compared in 4 x 4 blocks of the 320-wide grab. Leaves in the wind and waves on the water
    // move a few per cent of them (Melbourne's bay, close up, nearly 4%); a frame that flashes or
    // pumps moves its mean or most of its blocks. (A highlight that flashes is caught at its
    // source, by the float target above, which a two-frame difference cannot tell from a wave.)
    const BW = 80, BH = Math.floor(a.L.length / 320 / 4), blockMean = L => {
      const m = new Float32Array(BW * BH);
      for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
        let t = 0;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) t += L[(by * 4 + y) * 320 + bx * 4 + x];
        m[by * BW + bx] = t / 16;
      }
      return m;
    };
    const ma = blockMean(a.L), mc = blockMean(c.L), at = [];
    ma.forEach((v, j) => { if (Math.abs(v - mc[j]) > 24) at.push(j); });
    const jump = at.length / ma.length, dMean = Math.abs(a.mean - c.mean);
    flicker = Math.max(flicker, jump);
    const where = at.length ? `, around (${Math.round(at.reduce((q, j) => q + j % BW, 0) / at.length / BW * 100)}%, ${Math.round(at.reduce((q, j) => q + Math.floor(j / BW), 0) / at.length / BH * 100)}%) of the frame` : '';
    check(`stop ${i + 1}: steady`, jump < 0.1 && dMean < 3, `${(jump * 100).toFixed(2)}% of blocks jumped${where}, mean moved ${dMean.toFixed(1)}`);
    if (i === n - 1) break;
    // on to the next stop, and a frame from the middle of the flight
    await finishStop();
    await p.waitForFunction(k => window.__city.tour.i === k, i + 1, { timeout: 120000 });
    await freeze();
    await p.waitForTimeout(1400);
    const f = await grab(`fly-${pad(i + 1)}.jpg`);
    if (f.sd < 4) flat.push(i + 1);
    check(`flight ${i + 1} to ${i + 2}: not a flat frame`, f.sd >= 4, `luma ${f.mean.toFixed(0)} ± ${f.sd.toFixed(1)}`);
  }

  // the end, when the last stop's time is up
  await finishStop();
  await p.waitForFunction(() => window.__city.tour.done, null, { timeout: 120000 });
  await p.waitForTimeout(3000); // long enough for a tour that wrapped round to have flown off again
  const e = await state();
  check('the tour ends on its last stop', e.done && !e.playing && e.i === n - 1, `stop ${e.i + 1} of ${n}, playing ${e.playing}`);
  check('the end card shows', e.caption && e.card && e.skip === null && (!e.game || e.play), `"${e.step}" "${e.title}"`);
  check('every segment is full', e.segs.every(v => v >= 99.9), e.segs.join(' '));
  check('the camera turns slowly at the end', e.orbit);
  check('the buttons offer the tour again', e.tourBtn === 'Tour' && e.panelBtn === 'Watch again', `${e.tourBtn} / ${e.panelBtn}`);
  // the end card as the page shows it, for the record (a software renderer's compositor can be slow
  // to hand over a frame; a still that does not come is not a failed check)
  await p.screenshot({ path: path.join(outDir, 'end.png'), timeout: 180000 }).catch(e => console.log(`(no end.png: ${String(e).split('\n')[0]})`));

  await p.evaluate(() => document.getElementById('cap-again').click());
  await freeze();
  await frame();
  const r = await state();
  check('Watch again starts from the first stop', r.i === 0 && r.playing && !r.done && !r.card && r.segs.slice(1).every(v => v === 0), `stop ${r.i + 1}, ${r.step}, playing ${r.playing}, done ${r.done}, card ${r.card}, segments ${r.segs.join(' ')}`);
  // Finish on the last stop ends the tour as well
  await p.evaluate(k => document.querySelector(`#tour-list button[data-i="${k}"]`).click(), n - 1);
  await freeze();
  await frame();
  await p.evaluate(() => document.getElementById('cap-skip').click());
  await frame();
  const z = await state();
  check('Finish on the last stop ends the tour', z.done && z.card && z.i === n - 1);
  await p.evaluate(() => document.getElementById('cap-explore').click());
  await frame();
  check('Explore puts the card away', !(await state()).caption);

  const lost = await p.evaluate(() => window.__ctxLost);
  check('the WebGL context was never lost', lost === 0, lost ? `lost ${lost} time(s) under load${(await p.evaluate(() => window.__city.care.stats.drawn)) ? ', and drawn again after' : ''}` : '');
  // and then lost on purpose (WEBGL_lose_context): the view holds under a note, and once the
  // context is back the next frame is drawn, lit as it was (web/glcare.js, tools/glcare_step.js)
  await p.evaluate(() => window.__city.setOrbit(false)); // a still view, to compare before and after
  const g = await require('./glcare_step')(p, { canvas: 'gl', api: '__city', outDir });
  check('a lost context holds the view under a note', g.paused && g.note, `paused ${g.paused}, note ${g.note}`);
  check('the context restored, the next frame is drawn', g.drawn && g.noteGone && g.reloads === 0 && g.after.sd >= 4,
    `in ${(g.ms / 1000).toFixed(1)} s, luma ${g.after.mean.toFixed(0)} ± ${g.after.sd.toFixed(1)}, note gone ${g.noteGone}, reloads ${g.reloads}`);
  check('and lit as before (the sky\'s light rebuilt)', Math.abs(g.after.mean - g.before.mean) < 8, `luma ${g.before.mean.toFixed(1)} before, ${g.after.mean.toFixed(1)} after`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${city}: ${results.filter(Boolean).length}/${results.length} checks passed; brightest ${worstHdr.max.toFixed(1)}, `
    + `most blocks jumping ${(flicker * 100).toFixed(2)}%, flat flights ${flat.length ? flat.join(', ') : 'none'}`);
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
