// Stills of the helicopter's cockpit view (issue 335), one per variant of the pilot's eye, lens and look, from the
// same place in the air, to tune what the pilot sees: aboard, up to `alt` m and flying ahead, then each variant
// held for a second of game time and drawn. Writes <out>/<city>-cockpit-<name>.jpg.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/cockpit_shot.js sydney out_dir variants.json [WxH]
// variants.json: [{"name": "now"}, {"name": "low", "fov": 60, "pitch": -0.2, "eye": [0, -0.05, 0.2]}, ...]
// PICK="0.39,0.59;0.3,0.71" prints what of the helicopter is under those points of the picture (fractions across and down).
// (eye: moved from the model's Eye_Pilot, +x left, +y up, +z forward, m; fov: vertical, degrees; pitch: radians)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, city = 'sydney', outDir = '.', vfile, size = '1440x900'] = process.argv;
const [VW, VH] = size.split('x').map(Number);
const variants = vfile ? JSON.parse(fs.readFileSync(vfile, 'utf8')) : [{ name: 'now' }];
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('oe3d-quality', 'high'); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ }
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  p.on('console', m => { if (m.type() === 'error' || m.text().startsWith('picks ')) console.log(m.type() === 'error' ? `error: ${m.text().slice(0, 300)}` : m.text()); });
  if (process.env.PICK) await p.addInitScript(pk => { window.__pick = pk; }, process.env.PICK.split(';').map(q => q.split(',').map(Number)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; if (g.heli && g.heli.want) await g.heli.want(); });
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const bt = document.getElementById('gt-play'); if (bt) bt.click(); });
    await p.waitForTimeout(1000);
  }
  const ok = await p.evaluate(async alt => {
    const g = window.__game, st = g.heli.st;
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    const d = g.heli.doorAt();
    g.player.x = d.x; g.player.y = d.y; g.player.z = st.z;
    g.advance(0.3); g.enterHeli();
    for (let i = 0; i < 20 && g.player.mode !== 'heli'; i++) g.advance(0.5);
    for (let i = 0; i < 80 && st.z < alt; i++) g.advance(0.5, ['Space']);
    for (let i = 0; i < 6; i++) g.advance(0.5, ['KeyW']);
    while (g.cam.mode !== 'cockpit') g.nextView();
    window.__g0 = g;
    return g.player.mode === 'heli';
  }, +(process.env.ALT || 150));
  if (!ok) { console.log('not aboard'); await b.close(); return; }
  await p.evaluate(() => {
    window.addEventListener('error', e => { window.__lastErr = String(e.message || e.error); });
    // (every callback asked for in a frame, not only the last: a one-off animation's, a toast fading, asked after the
    // game's own frame would otherwise take its place, and the game would stop)
    window.__frames = { cbs: [], t: performance.now(), get cb() { return this.cbs.length ? () => {} : null; } };
    window.requestAnimationFrame = cb => { window.__frames.cbs.push(cb); return window.__frames.cbs.length; };
    window.__frames.step = t => { const q = window.__frames.cbs; window.__frames.cbs = []; for (const f of q) f(t); };
  });
  await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 30000 });
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of variants) {
    const url = await p.evaluate(v => {
      const g = window.__game, C = g.COCKPIT, F = window.__frames;
      if (!C.base) C.base = { fov: C.fov, pitch: C.pitch };
      if (!C.base.eye) C.base.eye = C.eye.toArray();
      C.fov = v.fov ?? C.base.fov; C.pitch = v.pitch ?? C.base.pitch; C.eye.fromArray(v.eye || C.base.eye);
      g.cam.lookYaw = v.yaw || 0; g.cam.lookPitch = C.pitch; g.viewBlend.t = 1;
      for (let i = 0; i < 30; i++) { if (!F.cbs.length) return `error: the game stopped asking for frames at step ${i} (${window.__lastErr || '?'})`; F.t += 1000 / 30; g.keys.add('KeyW'); F.step(F.t); g.keys.delete('KeyW'); g.heli.st.vx *= 0.97; g.heli.st.vy *= 0.97; }
      // PICK="x,y;x,y" (fractions of the picture): what of the helicopter is under each point, nearest first
      const picks = (window.__pick || []).map(([px, py]) => {
        const rc = new THREE.Raycaster(), cam = g.camera;
        rc.setFromCamera(new THREE.Vector2(px * 2 - 1, 1 - py * 2), cam);
        return `${px},${py}: ` + rc.intersectObject(g.heli.group, true).slice(0, 3).map(h => `${h.object.name}/${[].concat(h.object.material)[h.face ? h.face.materialIndex || 0 : 0].name} ${h.distance.toFixed(2)} m`).join(' | ');
      });
      if (picks.length) console.log('picks ' + picks.join('\n'));
      return document.getElementById('game-gl').toDataURL('image/jpeg', 0.9);
    }, v);
    if (url.startsWith('error')) { console.log(v.name, url); continue; }
    const f = path.join(outDir, `${city}-cockpit-${v.name}.jpg`);
    fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
    console.log(f);
  }
  await b.close();
})();
