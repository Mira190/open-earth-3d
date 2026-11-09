// Stills of map travel in a city's game: the map with its landmarks, a picked landmark's card, and the
// view on arrival at each landmark (or the ones named), at the desktop picture tier. Prints where each
// hop put the player: how much of the landmark's body the camera sees (in frame and not hidden by buildings
// or trees; under 30% is a MISS), how far from it, on what floor, and whether its centre was in frame.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/travel_shot.js sydney out_dir [width height]     # llvmpipe; without xvfb-run, SwiftShader
// env: ONLY="Opera,Tower" (names containing these), LIMIT=6 (the first n landmarks), TIME=17:30 and DATE=6-21
// (the local clock), CAR=1 (travel in your car), TIER=high|medium|low, ARRIVALS='{"HEP FIVE": {"front": 154}}' (city.json
// "arrivals" entries to try before they go in).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', width = '1440', height = '900'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  const frames = n => p.evaluate(n => new Promise(r => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }), n);
  const shot = async name => {
    await frames(3);
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${city}-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // the title card comes up once the loader has faded, which on a loaded machine is well after window.__game:
  // wait for it, then play (through the DOM, which a busy page cannot time out)
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => console.log('no title card'));
  await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return !t || t.hidden; }, null, { timeout: 120000 }).catch(() => console.log('the title is still up'));
  await p.evaluate(([time, date, extra]) => {
    const g = window.__game;
    if (extra) g.scene.city.arrivals = Object.assign(g.scene.city.arrivals || {}, JSON.parse(extra));
    g.advance(1);
    if (time || date) {
      const [h, m] = (time || '10:30').split(':').map(Number), [mo, d] = date ? date.split('-').map(Number) : [g.clock.m, g.clock.d];
      g.setClock(g.clock.y, mo, d, h * 60 + m); g.clock.frozen = true;
    }
    g.advance(4); // past the opening crane
  }, [process.env.TIME, process.env.DATE, process.env.ARRIVALS || '']);

  // the map, then a landmark picked on it
  await p.evaluate(() => window.__game.toggleMap());
  await frames(3);
  await p.screenshot({ path: path.join(outDir, `${city}-map.png`), timeout: 180000 }).catch(e => console.log(`map still: ${e.message.split('\n')[0]}`));
  const pin = await p.evaluate(() => { const q = window.__game.mapPins().find(q => q.d.kind === 'landmark'); return q && { x: q.x, y: q.y }; });
  if (pin) {
    const r = await p.evaluate(() => { const b = document.getElementById('g-bigmap-c').getBoundingClientRect(); return { x: b.left, y: b.top }; });
    await p.mouse.click(r.x + pin.x, r.y + pin.y);
    await frames(2);
    await p.screenshot({ path: path.join(outDir, `${city}-map-pick.png`), timeout: 180000 }).catch(e => console.log(`map still: ${e.message.split('\n')[0]}`));
  }
  await p.evaluate(() => { document.getElementById('g-bigmap').hidden = true; });

  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  const list = await p.evaluate(([only, limit]) => window.__game.landmarks.map((d, i) => ({ i, name: d.name }))
    .filter(d => !only.length || only.some(o => d.name.includes(o))).slice(0, limit), [only, +(process.env.LIMIT || 99)]);
  if (process.env.CAR) await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return;
    g.player.x = c.D.st.x + 2; g.player.y = c.D.st.y; g.player.z = c.D.st.z; g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
  });
  for (const d of list) {
    const r = await p.evaluate(i => {
      const g = window.__game, lm = g.landmarks[i], ok = g.travelTo(lm);
      for (let k = 0; k < 40 && g.cine.active; k++) g.advance(0.25);
      g.advance(0.5);
      const pl = g.player, dx = lm.at[0] - pl.x, dy = lm.at[1] - pl.y;
      // in frame: the landmark's centre at two thirds of its height above its ground, projected through the camera
      // (a city.json "arrivals" top, the part it frames, in place of the label's)
      const spec = ((g.scene.city || {}).arrivals || {})[lm.name] || {}, gz = Math.max(0, g.nav.terrain(lm.at[0], lm.at[1]));
      const top = spec.top ? gz + spec.top : lm.top || gz + 20, v = new THREE.Vector3(lm.at[0], gz + (top - gz) * 0.66, -lm.at[1]).project(g.camera);
      // the camera over what is under it: the terrain, a floor below the player's head, and the 2 m surface model
      const c = g.camera.position, cx = c.x, cy = -c.z, D = g.DSM, ci = Math.floor((cx - D.x0) / D.cell), cj = Math.floor((D.y1 - cy) / D.cell);
      const fl = g.nav.floorAt(cx, cy, pl.z + 1.5), under = Math.max(Math.max(0, g.nav.terrain(cx, cy)), fl ? fl.z : -1e9);
      const cam = { over: c.y - under, dsm: c.y - (ci >= 0 && cj >= 0 && ci < D.nx && cj < D.ny ? D.data[cj * D.nx + ci] : 0) };
      return { ok, seen: g.seenNow ? g.seenNow(lm) : NaN, mode: pl.mode, dist: Math.hypot(dx, dy), z: pl.z, floor: pl.floor, cam, inFrame: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, ndc: [v.x, v.y] };
    }, d.i);
    console.log(`${r.ok && r.inFrame && !(r.seen < 0.3) ? 'ok  ' : 'MISS'} ${d.name}: seen ${(r.seen * 100).toFixed(0)}%, ${r.mode}, ${r.dist.toFixed(0)} m away, z ${r.z.toFixed(1)} (${r.floor}), in frame ${r.inFrame} [${r.ndc.map(x => x.toFixed(2))}], camera ${r.cam.over.toFixed(1)} m over the ground and ${r.cam.dsm.toFixed(1)} m over the surface model${r.cam.over < 0.3 || r.cam.dsm < -1 ? ' BURIED' : ''}`);
    await shot(`lm${String(d.i).padStart(2, '0')}`);
  }
  if (logs.length) console.log(logs.slice(0, 15).join('\n'));
  await b.close();
})();
