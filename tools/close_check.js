// Walk up to each thing a city's game names to see up close (tools/close_step.js) and take a
// still from behind the walker at each, without the rest of tools/game_check.js:
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/close_check.js shibuya out_dir
// CLOSE='[{"name":"…","at":[x,y,z]}]' adds targets of your own (local metres), to probe a place
// before its builder names it. Exits 1 if any target is not reached.
const { chromium } = require('playwright');
const fs = require('fs');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', outDir = '.'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  await pinClock(p, city);
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const nv = await p.evaluate(() => { const n = window.__game.nav; return [n.startMs, n.fineBoxes, n.fineMs].map(Math.round); });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s; landmark tiles sorted in ${nv[0]} ms, ${nv[1]} fine boxes laid so far in ${nv[2]} ms`);
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(extra => { const G = window.__game.G; G.close = (G.close || []).concat(extra); window.__game.advance(1); }, JSON.parse(process.env.CLOSE || '[]'));
  const res = await require('./close_step')(p, { outDir, prefix: `${city}-` });
  let bad = 0;
  res.forEach((r, n) => {
    if (!r.ok) bad++;
    if (r.look) { console.log(`${r.ok ? 'ok  ' : 'FAIL'} looks closer at ${r.name}: ${JSON.stringify(r)}`); return; }
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${n}] walks up to ${r.name}: ${r.d == null ? r.why : `${r.d.toFixed(2)} m from it (within ${r.within}, keep ${r.keep})${r.on ? `, standing ${r.dz.toFixed(2)} m off its floor` : ''} from ${r.from}${r.ok ? '' : `: ${r.why}`}`}`);
  });
  if (!res.length) console.log('no targets');
  for (const e of errors) console.log(`pageerror: ${e}`);
  await b.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
