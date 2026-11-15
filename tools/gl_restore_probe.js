// Which WebGL calls are refused while a lost context comes back (glcare.js): the game is opened, the context is
// traced (glcare.js trace: the error asked for after every call), lost and restored as tools/glcare_step.js does
// for the game check, and what was refused is printed with the lines that made each call. An object made before
// the loss and used after it is INVALID_OPERATION: a buffer, a fence or a texture some module kept.
//   xvfb-run -a node tools/gl_restore_probe.js sydney [out_dir]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', outDir = '/tmp'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  if (process.env.NIGHT) await p.evaluate(() => { const x = document.querySelector('#gt-timechoice [data-t="night"]'); if (x) x.click(); });
  await startPlay(p, { asIs: true });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { window.__tr = window.OEGLCare.trace(document.getElementById('game-gl').getContext('webgl2')); });
  const gl = await require('./glcare_step')(p, { canvas: 'game-gl', api: '__game', outDir, prefix: `${city}-restore-` });
  await p.waitForTimeout(3000);
  // and what is made again afterwards: the governor's rungs resize and dispose targets made before the loss (the
  // shadow map and its cache, the scene's target with its samples), each a delete of the dead context's objects
  await p.evaluate(async () => {
    const g = window.__game, G = g.governor, frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    for (const [s, e, m] of [[0.8, 0.5, 2], [0.6, 0, 0], [G.max, 1, 4], [G.max, 1, 0]]) { G.set(s, e); if (g.atmos && g.atmos.setSamples) g.atmos.setSamples(m); await frames(3); }
  });
  const r = await p.evaluate(() => ({ refused: window.__tr.stop(), game: window.__game.glFound.slice() }));
  console.log(JSON.stringify({ restored: gl.drawn, ms: gl.ms }), JSON.stringify(r, null, 1));
  await b.close();
  if (r.refused.length) { console.log('FAIL'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
