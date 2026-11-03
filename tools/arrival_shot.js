// The game's arrival camera, measured and filmed (#89): load a city's game (at "@<travel id>" if given), start it,
// and follow the camera frame by frame on the game clock through the arrival from the title shot down to the
// player, then through a map hop to a travel point. Prints each move's length, its peak turn rate (the view's
// bearing, in degrees a second), its peak pitch rate, its roll and whether it ever reversed its turn, and saves
// stills along the way (<out>/<city>[@point]-<size>-arrive-<n>.png, -hop-<n>.png) and the tour's first card.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/arrival_shot.js shibuya out_dir [desktop|phone] [travel id]
// Exits 1 when a move turns faster than MAX_RATE (default 45°/s), pitches faster than MAX_PITCH (60°/s), rolls, takes over 4.5 s to arrive (7 s to
// hop) or changes the direction of its turn.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'shibuya', outDir = '.', size = 'desktop', point = ''] = process.argv;
const MAX_RATE = Number(process.env.MAX_RATE || 45), MAX_PITCH = Number(process.env.MAX_PITCH || 60);
const VIEW = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }[size];
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, isMobile: !!VIEW.isMobile, hasTouch: !!VIEW.hasTouch, deviceScaleFactor: VIEW.deviceScaleFactor || 1 });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    try { localStorage.setItem('oe3d-quality', 'desktop'); localStorage.removeItem('oe3d-onboard'); } catch (e) { /* storage blocked */ }
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts); };
  });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  fs.mkdirSync(outDir, { recursive: true });
  const tag = `${city}${point ? '@' + point : ''}-${size}`;
  const still = async name => fs.writeFileSync(path.join(outDir, `${tag}-${name}.png`), await p.screenshot());
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}${point ? '@' + point : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 });
  await p.waitForTimeout(1500);
  await still('title');
  // follow the camera on the game clock: the view's bearing and pitch, its roll, until fn() says the move is over
  const follow = async (start, arg, label, maxT, shots = 4) => {
    await p.evaluate(start, arg);
    const rows = [];
    let next = 0;
    for (let i = 0; i < 2000; i++) {
      const r = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => {
        const g = window.__game, c = g.camera, d = c.getWorldDirection(new THREE.Vector3());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion);
        res({ x: +c.position.x.toFixed(1), y: +c.position.y.toFixed(1), z: +c.position.z.toFixed(1), t: g.t(), yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))), roll: Math.asin(Math.max(-1, Math.min(1, right.y))), up: up.y, on: g.cine.active, k: g.cine.k, label: g.cine.label });
      })));
      rows.push(r);
      if (r.on && r.k >= next / (shots - 1) - 1e-3 && next < shots) { await still(`${label}-${next}`); next++; }
      if (!r.on && i > 2) break;
      if (r.t - rows[0].t > maxT + 3) break;
    }
    await still(`${label}-${shots - 1}`);
    let peak = 0, peakP = 0, roll = 0, flips = 0, last = 0;
    for (let i = 1; i < rows.length; i++) {
      const dt = rows[i].t - rows[i - 1].t;
      if (dt <= 1e-4) continue;
      const dy = Math.atan2(Math.sin(rows[i].yaw - rows[i - 1].yaw), Math.cos(rows[i].yaw - rows[i - 1].yaw)), dp = rows[i].pitch - rows[i - 1].pitch;
      // the bearing of a view looking nearly straight down means little; weigh it by how level the view is
      const rate = Math.abs(dy) / dt * Math.cos(rows[i].pitch) * 180 / Math.PI;
      peak = Math.max(peak, rate); peakP = Math.max(peakP, Math.abs(dp) / dt * 180 / Math.PI);
      roll = Math.max(roll, Math.abs(rows[i].roll) * 180 / Math.PI);
      if (rate > 3) { const s = Math.sign(dy); if (last && s !== last) flips++; last = s; }
    }
    fs.writeFileSync(path.join(outDir, `${tag}-${label}.json`), JSON.stringify(rows));
    const dur = rows[rows.length - 1].t - rows[0].t;
    return { label, frames: rows.length, dur, peak, peakP, roll, flips };
  };
  const fails = [];
  const report = (m, maxDur) => {
    const ok = m.peak <= MAX_RATE && m.peakP <= MAX_PITCH && m.roll < 0.5 && m.dur <= maxDur && m.flips === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag} ${m.label}: ${m.dur.toFixed(2)} s, ${m.frames} frames, peak turn ${m.peak.toFixed(1)}°/s, peak pitch ${m.peakP.toFixed(1)}°/s, roll ${m.roll.toFixed(2)}°, ${m.flips} reversals`);
    if (!ok) fails.push(m.label);
  };
  report(await follow(() => document.getElementById('gt-play').click(), null, 'arrive', 4.5), 4.5);
  await p.waitForTimeout(800);
  const tour = await p.evaluate(() => { const t = window.OEOnboard.current(); return t ? t.id : ''; });
  console.log(`${tour ? 'ok  ' : 'FAIL'} the tour opens after the arrival (${tour || 'none'})`);
  if (!tour) fails.push('tour');
  await still('tour');
  await p.evaluate(() => window.OEOnboard.current() && window.OEOnboard.current().skip());
  // a hop across the map to the farthest travel point
  const hop = await p.evaluate(() => {
    const g = window.__game, far = (g.G.travel || []).slice().sort((a, b) => Math.hypot(b.at[0] - g.player.x, b.at[1] - g.player.y) - Math.hypot(a.at[0] - g.player.x, a.at[1] - g.player.y))[0];
    return far ? { id: far.id, name: far.name } : null;
  });
  if (hop) {
    report(await follow(id => { const g = window.__game, t = g.G.travel.find(x => x.id === id); g.travelTo({ kind: 'place', id: t.id, name: t.name, at: t.at }); }, hop.id, 'hop', 7), 7);
  }
  if (errs.length) { console.log('page errors:\n  ' + errs.join('\n  ')); fails.push('errors'); }
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
