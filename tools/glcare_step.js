// A lost WebGL context on purpose, for tools/tour_check.js and tools/game_check.js: lose the
// view's context (WEBGL_lose_context) as a phone that puts the tab away or a driver that resets
// would, give it back, and see what a visitor sees (web/glcare.js):
//   - while it is lost the view holds (care.lost) under a note;
//   - once it is back the next frame is drawn (care.stats.drawn), the note goes, nothing reloads;
//   - and the frame is lit as it was before (the sky's light, a PMREM target that comes back
//     empty, is rebuilt: without it the city goes dark grey), judged on the mean luma.
// Returns { paused, note, drawn, noteGone, reloads, before, after, ms }; stills ctx-before.jpg and
// ctx-after.jpg go to outDir when it is given.
const fs = require('fs');
const path = require('path');

module.exports = async function loseAndRestore(p, { canvas, api, outDir, prefix = '' }) {
  const frames = n => p.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const luma = async file => {
    const r = await p.evaluate(id => {
      const c = document.getElementById(id), w = 320, h = Math.round(320 * c.height / c.width);
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      const g = o.getContext('2d'); g.drawImage(c, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let s = 0, s2 = 0;
      for (let i = 0; i < w * h; i++) { const l = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; s += l; s2 += l * l; }
      const mean = s / (w * h);
      return { mean, sd: Math.sqrt(Math.max(0, s2 / (w * h) - mean * mean)), url: c.toDataURL('image/jpeg', 0.85) };
    }, canvas);
    if (outDir && file) fs.writeFileSync(path.join(outDir, `${prefix}${file}`), Buffer.from(r.url.split(',')[1], 'base64'));
    return { mean: r.mean, sd: r.sd };
  };
  const note = () => p.evaluate(id => { const n = document.getElementById(id).parentElement.querySelector('.gl-note'); return !!n && !n.hidden; }, canvas);
  await frames(3);
  const before = await luma('ctx-before.jpg');
  const t0 = Date.now();
  await p.evaluate(id => {
    const gl = document.getElementById(id).getContext('webgl2');
    window.__loseCtx = gl.getExtension('WEBGL_lose_context');
    window.__loseCtx.loseContext();
  }, canvas);
  await p.waitForTimeout(800);
  const paused = await p.evaluate(a => !!window[a].care.lost, api), noteUp = await note();
  await p.evaluate(() => window.__loseCtx.restoreContext());
  let drawn = true;
  await p.waitForFunction(a => window[a].care.stats.drawn >= 1, api, { timeout: 120000 }).catch(() => { drawn = false; });
  const ms = Date.now() - t0;
  await frames(3);
  await p.waitForTimeout(500);
  await frames(2);
  const after = await luma('ctx-after.jpg');
  const reloads = await p.evaluate(a => window[a].care.stats.reloads, api);
  return { paused, note: noteUp, drawn, noteGone: !(await note()), reloads, before, after, ms };
};
