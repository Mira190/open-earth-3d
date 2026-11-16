// Stills of a bus of a city's traffic (or another of its models), from round it at chosen distances: to see each of the
// model's three meshes (near, mid, far: vehicles.json lod1_m, lod2_m) as the game draws it, from every side (issue 525).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/bus_shot.js <city> <out_dir> [views] [WxH]
// views: "dist:az:up:fov,..." a camera `dist` metres from the bus's middle, `az` degrees round from its nose (clockwise
// seen from above: 90 its right side, 180 its tail), `up` metres over the road, with a field of view of `fov` degrees
// (the game's unless given: a long lens to look at the mid and far meshes). Default: both sides, nose and tail from
// 9 m, then 50 m and 150 m off its nose quarter through a long lens.
// Env: TIER (quality.js: high by default; low, medium), LEAN=1 (a phone, as tools/game_shot.js), TIME ("12:00"),
// MODEL (a model's name instead of the bus, "Car_Van"), FAR_ONLY=1 keeps the near models from coming (cars.glb is
// refused), so that every still is of the far stand-in, as in the seconds after the game opens.
// A view is taken from the nearest bearing to the one asked that shows the bus (the frame drawn with it and without,
// compared), the world run on until there is one. Prints, per still, the bus's place, the bearing taken, the share
// of the frame it fills, the mesh it was drawn in and how many of each mesh were drawn.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = '.', viewsArg = '9:90:1.7,9:-90:1.7,9:20:1.7,9:160:1.7,50:20:3:14,150:10:8:6', size = '1440x900'] = process.argv;
const views = viewsArg.split(',').map(s => { const [dist, az = 90, up = 1.7, fov = 0] = s.split(':').map(Number); return { dist, az, up, fov }; });
(async () => {
  const [w, h] = size.split('x').map(Number), lean = !!process.env.LEAN, tier = process.env.TIER || (lean ? 'low' : 'high');
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = lean ? await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' }) : b;
  const p = lean ? await ctx.newPage() : await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, tier);
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  if (process.env.FAR_ONLY) await p.route('**/assets/vehicles/cars.glb', r => r.abort());
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await startPlay(p);
  await p.evaluate(async () => {
    const g = window.__game;
    for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine.active) g.cine.skip();
  });
  // the near and mid models in (or kept out), then a bus on the road
  if (!process.env.FAR_ONLY) await p.evaluate(() => window.__game.lateReady && window.__game.lateReady());
  const found = await p.evaluate(async ([model, time]) => {
    const g = window.__game, C = g.cars.C, c0 = g.clock;
    const [hh, mm] = time.split(':').map(Number);
    g.setClock(c0.y, c0.m, c0.d, hh * 60 + mm); c0.scale = 0;
    if (g.weather) g.weather.set('clear', { now: true });
    const is = c => (model ? c.model === model : c.bus) && c.line >= 0 && Number.isFinite(c.x);
    for (let i = 0; i < 120 && !C.some(is); i++) g.advance(0.5);
    window.__bus = C.find(is) || null;
    return window.__bus ? { model: window.__bus.model, hex: window.__bus.hex, late: g.late && g.late() } : null;
  }, [process.env.MODEL || '', process.env.TIME || '12:00']);
  if (!found) { console.log(`no ${process.env.MODEL || 'bus'} in ${city}'s traffic`); await b.close(); process.exit(1); }
  console.log(JSON.stringify(found));
  for (const v of views) {
    const name = `${city}_${lean ? 'phone' : tier}${process.env.FAR_ONLY ? '_faronly' : ''}_d${v.dist}_az${v.az}${v.fov ? `_fov${v.fov}` : ''}`;
    const info = await p.evaluate(async v => {
      const g = window.__game, c = window.__bus, RAD = Math.PI / 180;
      // you stand beside it (the traffic and the map are kept round you), out of the picture; photo mode holds the camera
      const side = g.nav.stand(c.x + Math.cos(c.h) * 7, c.y - Math.sin(c.h) * 7, c.z + 0.5, { rMax: 6 }) || { x: c.x + 7, y: c.y, z: c.z };
      g.photoMode(false); g.advance(0.05);
      g.player.x = side.x; g.player.y = side.y; g.player.z = side.z; g.advance(1.2);
      for (let i = 0; i < 60 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.1); } // (an arrival that began late)
      if (g.cine.active) g.cine.skip();
      g.photoMode(true);
      if (!g.photo.on) return { error: 'photo mode did not open' };
      g.player.rig.root.visible = false;
      const F = g.cars.fleet && g.cars.fleet[c.model], frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); };
      const aim = az => {
        const a = c.h + az * RAD, P = g.photo, lz = c.z + 1.5, hgt = c.z + v.up - lz;
        P.focus.set(c.x, lz, -c.y); P.anchor.copy(P.focus);
        Object.assign(P, { az: Math.atan2(Math.sin(a), Math.cos(a)), pitch: Math.atan2(hgt, v.dist), dist: Math.hypot(v.dist, hgt), fstop: 16 }, v.fov ? { fov: v.fov } : {});
      };
      // How much of the frame the bus takes, as drawn: the frame with its model's meshes and without, compared. (A street
      // wall, a deck or a roof the camera was moved onto hides it; what is drawn is the only sure test of that.)
      const small = document.createElement('canvas'); small.width = 360; small.height = 225;
      const ctx2 = small.getContext('2d', { willReadFrequently: true });
      const grab = async () => { await frames(3); ctx2.drawImage(document.getElementById('game-gl'), 0, 0, 360, 225); return ctx2.getImageData(0, 0, 360, 225).data; };
      const diff = (A, B) => { let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) n++; return n / (A.length / 4); };
      const shown = async () => {
        const A = await grab(), A2 = await grab(); // (twice: what moves on its own, leaves in the wind, is not the bus)
        for (const m of F) m.visible = false;
        const B = await grab();
        for (const m of F) m.visible = true;
        if (!F.some(m => m.count)) return 0; // (left out: behind the street wall, visibility.js)
        return Math.max(0, diff(A, B) - 2 * diff(A, A2));
      };
      // the nearest bearing to the one asked that shows it whole (half of what its side and end would fill from there, at
      // least), the world run on a few seconds at a time until there is one
      const want = az => Math.min(0.5, 0.5 * (12 * Math.abs(Math.sin(az * RAD)) + 2.5 * Math.abs(Math.cos(az * RAD))) * 3 / (g.camera.aspect * (2 * v.dist * Math.tan((v.fov || g.camera.fov) * RAD / 2)) ** 2));
      let az = null, seen = 0;
      // (the world is held in photo mode; each frame the traffic is drawn again for the camera as it is: actors.js review)
      for (let tries = 0; tries < 4 && az == null; tries++) {
        for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
          const a = v.az + k * 15;
          aim(a); seen = await shown();
          if (seen >= want(a)) { az = a; break; }
        }
        if (az == null) { g.photoMode(false); g.advance(4); if (g.cine.active) g.cine.skip(); g.photoMode(true); g.player.rig.root.visible = false; }
      }
      if (az == null) return { error: 'no clear view of it from that far', at: [c.x, c.y, c.z].map(n => +n.toFixed(1)), seen };
      await frames(3);
      const I = g.vlib.info.cars, d = g.camera.position.distanceTo(new THREE.Vector3(c.x, c.z, -c.y));
      const lod = d < I.lod1_m ? 0 : d < I.lod2_m ? 1 : 2;
      return { at: [c.x, c.y, c.z, c.h].map(n => +n.toFixed(1)), az, frame: +seen.toFixed(3), eye_m: +d.toFixed(1), lod, drawn: F ? F.map(m => m.count) : null, triangles: F ? F.map(m => m.geometry.index.count / 3) : null };
    }, v);
    if (info.error) { console.log(name, JSON.stringify(info)); continue; }
    const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(name, JSON.stringify(info));
  }
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await b.close();
})();
