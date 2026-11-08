// The big map's region (game.js region): a city drawn as maps of its own shows its other districts round the one
// you are in. Stills of the map at this district, at the whole city and with another district's station picked,
// then Go: the other map loads and you arrive at that station. Fails on a missing chip, pin or arrival.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/region_map_shot.js kyoto out_dir [phone] [station name]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'kyoto', outDir = '.', kind = 'desktop', want = 'Kiyomizu-dera'] = process.argv;
const phone = kind === 'phone';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const logs = [];
  let fail = 0;
  const miss = m => { fail++; console.log(`MISS ${m}`); };
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  const start = async id => {
    await p.waitForFunction(id => window.__game && window.__game.scene && location.hash.includes(id) && document.getElementById('g-title'), id, { timeout: 600000 });
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => {});
    await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b && !document.getElementById('g-title').hidden) b.click(); });
  };
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await start(city);
  if (!(await p.evaluate(() => !!window.__game.region))) { miss(`${city} has no region`); await b.close(); process.exit(1); }
  await p.evaluate(() => { const g = window.__game; g.advance(5); g.toggleMap(); });
  await p.waitForTimeout(400);
  const box = await p.evaluate(() => { const r = document.getElementById('g-bigmap-c').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const still = async name => { await p.waitForTimeout(300); await p.screenshot({ path: path.join(outDir, `${city}-${kind}-${name}.png`), timeout: 600000 }); };
  await still('here');
  const chips = await p.evaluate(() => window.__game.mapChips());
  const pins0 = await p.evaluate(() => window.__game.mapPins().filter(q => q.d.kind === 'district').length);
  console.log(`here: ${chips.length} edge chips (${chips.map(c => c.id).join(', ')}), ${pins0} district pins`);
  await p.click('#g-mapscope [data-scope="all"]');
  await still('all');
  const v = await p.evaluate(() => window.__game.mapView());
  const pressed = await p.evaluate(() => document.querySelector('#g-mapscope [aria-pressed="true"]').dataset.scope);
  if (pressed !== 'all') miss(`the switch shows "${pressed}" pressed at the whole city`);
  const vis = await p.evaluate(([w, h]) => window.__game.mapPins().filter(q => q.d.kind === 'district' && q.x > 0 && q.y > 0 && q.x < w && q.y < h).map(q => q.d.name), [box.w, box.h]);
  console.log(`all: zoom ×${v.z.toFixed(2)}, ${vis.length} districts in view, names: ${v.names.join(', ')}`);
  if (v.z >= 1) miss('the whole city did not zoom out');
  const pin = await p.evaluate(n => window.__game.mapPins().find(q => q.d.kind === 'district' && q.d.name === n), want);
  if (!pin) { miss(`no pin for ${want}`); } else {
    if (phone) await p.touchscreen.tap(box.x + pin.x, box.y + pin.y); else await p.mouse.click(box.x + pin.x, box.y + pin.y);
    await still('pick');
    const card = await p.evaluate(() => ({ open: !document.getElementById('g-mappop').hidden, go: document.getElementById('g-mappop-go').textContent, note: document.getElementById('g-mappop-note').textContent }));
    console.log(`card: ${card.open ? 'open' : 'MISSING'} · ${card.go} · ${card.note}`);
    if (!card.open) miss('no card');
    const to = pin.d.map.id;
    await p.click('#g-mappop-go');
    await start(to);
    await p.waitForTimeout(1500);
    const at = await p.evaluate(() => { const g = window.__game, pl = g.player; return { id: location.hash, x: pl.x, y: pl.y }; });
    const tgt = await p.evaluate(t => { const s = (window.__game.G.travel || []).find(x => x.id === t); return s ? s.at : null; }, pin.d.travel);
    const d = tgt ? Math.hypot(at.x - tgt[0], at.y - tgt[1]) : null;
    console.log(`arrived: ${at.id} at ${at.x.toFixed(0)}, ${at.y.toFixed(0)}${d != null ? `, ${d.toFixed(0)} m from ${pin.d.travel}` : ''}`);
    if (!at.id.includes(to)) miss('did not go to the other map');
    if (d != null && d > 120) miss('arrived far from the station');
    await p.waitForTimeout(2500);
    await still('arrived');
    // the way back: the map there shows where you came from
    await p.evaluate(() => window.__game.toggleMap());
    await p.waitForTimeout(300);
    await p.click('#g-mapscope [data-scope="all"]');
    await still('back-all');
  }
  if (logs.length) { console.log(logs.join('\n')); fail++; }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
