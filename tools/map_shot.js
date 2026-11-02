// Stills of the game's big map at the whole city, zoomed in on its densest landmarks, and panned, on a
// desktop (the wheel and a mouse drag) or a phone (a two-finger pinch and a one-finger drag, as pointer
// events). Prints the zoom and how many landmark names the map shows at each step.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/map_shot.js tokyo out_dir [phone]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'tokyo', outDir = '.', kind = 'desktop'] = process.argv;
const phone = kind === 'phone';
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  // the title card comes up once the loader has faded, which on a loaded machine is well after window.__game:
  // wait for it, then play (through the DOM, which a busy page cannot time out)
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => console.log('no title card'));
  await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
  await p.evaluate(() => { const g = window.__game; g.advance(5); g.toggleMap(); });
  await p.waitForTimeout(300);
  const box = await p.evaluate(() => { const r = document.getElementById('g-bigmap-c').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const still = async (name) => {
    await p.waitForTimeout(250);
    const v = await p.evaluate(() => window.__game.mapView());
    await p.screenshot({ path: path.join(outDir, `${city}-${kind}-${name}.png`), timeout: 600000 });
    console.log(`${name}: zoom ×${v.z.toFixed(2)}, ${v.names.length} names${v.picked ? ', a card open' : ''}`);
    return v;
  };
  // where the landmark pins are thickest: the pin with the most others within 60 px
  const dense = await p.evaluate(() => {
    const q = window.__game.mapPins().filter(q => q.d.kind === 'landmark');
    let best = q[0], bn = -1;
    for (const a of q) { const n = q.filter(b => Math.hypot(a.x - b.x, a.y - b.y) < 60).length; if (n > bn) { bn = n; best = a; } }
    return best ? { x: best.x, y: best.y } : null;
  });
  const fx = box.x + (dense ? dense.x : box.w / 2), fy = box.y + (dense ? dense.y : box.h / 2);
  await still('fit');
  // synthetic pointer events on the map canvas: a pinch (two pointers spreading) or a drag (one pointer)
  const pointers = (moves) => p.evaluate(moves => {
    const c = document.getElementById('g-bigmap-c');
    for (const [type, id, x, y] of moves) c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1, button: 0 }));
  }, moves);
  if (phone) {
    const m = [['pointerdown', 1, fx - 20, fy], ['pointerdown', 2, fx + 20, fy]];
    for (let k = 1; k <= 12; k++) m.push(['pointermove', 1, fx - 20 - k * 8, fy], ['pointermove', 2, fx + 20 + k * 8, fy]);
    m.push(['pointerup', 1, fx - 116, fy], ['pointerup', 2, fx + 116, fy]);
    await pointers(m);
  } else {
    await p.mouse.move(fx, fy);
    for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(40); }
  }
  const z = await still('zoom');
  if (phone) {
    const m = [['pointerdown', 1, box.x + box.w / 2, box.y + box.h / 2]];
    for (let k = 1; k <= 10; k++) m.push(['pointermove', 1, box.x + box.w / 2 - k * 9, box.y + box.h / 2 - k * 5]);
    m.push(['pointerup', 1, box.x + box.w / 2 - 90, box.y + box.h / 2 - 50]);
    await pointers(m);
  } else {
    await p.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await p.mouse.down(); await p.mouse.move(box.x + box.w / 2 - 180, box.y + box.h / 2 - 100, { steps: 8 }); await p.mouse.up();
  }
  const pan = await still('pan');
  if (Math.hypot(pan.cx - z.cx, pan.cy - z.cy) < 5) console.log('MISS the drag did not pan the map');
  if (pan.picked) console.log('MISS the drag opened a card');
  // a pin picked while zoomed in: its card
  const pin = await p.evaluate(([w, h]) => window.__game.mapPins().find(q => q.d.kind === 'landmark' && q.x > 60 && q.y > 120 && q.x < w - 60 && q.y < h - 60), [box.w, box.h]);
  if (pin) { if (phone) await p.touchscreen.tap(box.x + pin.x, box.y + pin.y); else await p.mouse.click(box.x + pin.x, box.y + pin.y); await still('pick'); }
  if (logs.length) console.log(logs.join('\n'));
  await b.close();
})();
