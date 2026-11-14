// A film of an autopilot drive (#355): you are put at the wheel of your car, the autopilot is sent to a place,
// and the game's own frame loop is driven at a fixed step while each frame, with the game's HUD, is saved.
// ffmpeg makes the frames into <out>/<city>-autopilot.mp4. The camera is the autopilot's own film
// (web/game/autopilot.js film). Films force the desktop tier.
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=16:40 xvfb-run -a node tools/autopilot_film.js sydney out_dir
//   DEST=opera SCENIC=1 WEATHER=rain SECONDS=70 FPS=24 W=1280 H=720 ...   (DEST: part of a destination's name; the farthest offered if none)
//   FROM=barangaroo: start from the kerb by that landmark (part of its name)
//   FULLHUD=1: the whole HUD (by default the quest, prompts, labels, toasts and menu row are off)
//   STILLS=1: a still every five seconds of the drive instead (<out>/<city>-autopilot-NN.jpg), to look before filming
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', outDir = '.'] = process.argv;
const FPS = +(process.env.FPS || 24), SECONDS = +(process.env.SECONDS || 60), W = +(process.env.W || 1280), H = +(process.env.H || 720), STILLS = !!process.env.STILLS;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  // (a film of the drive: the game's own clutter off, as photo mode has it, the toasts and the menu row with it; the
  // clock, the minimap and the autopilot's panel stay. FULLHUD=1 keeps it all)
  if (!process.env.FULLHUD) await p.addStyleTag({ content: '.g-quest, .g-prompt, .g-labels, .g-reticle, .g-btns, #g-toasts, .g-dialog, .g-chatter { display: none !important; }' });
  const set = await p.evaluate(({ want, scenic, weather, from }) => {
    const g = window.__game, c = g.myCar && g.myCar();
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    g.advance(2);
    if (!c) return { none: 'no car' };
    const st = c.D.st, s = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3); g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    // (FROM: part of a landmark's name, the map's travel in your car to the kerb by it, where the drive starts)
    const lm = from && g.landmarks.find(l => l.name.toLowerCase().includes(from));
    if (lm && g.travelTo(lm)) { for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25); g.advance(4); }
    const list = g.destinations(st.x, st.y).filter(d => d.id !== 'car');
    let dest = want ? list.find(d => d.name.toLowerCase().includes(want)) : null, best = 0;
    // (or a landmark of that name, not among the places offered from here: the kerb by it)
    if (want && !dest) { const l2 = g.landmarks.find(l => l.name.toLowerCase().includes(want)); if (l2) dest = { id: `film-${l2.name}`, name: l2.name, at: l2.at }; }
    if (!dest) for (const d of list) { if (g.pilotTo(d, { quiet: true, scenic }) && g.pilot().len > best) { best = g.pilot().len; dest = d; } g.pilotOff(); }
    if (!dest || !g.pilotTo(dest, { scenic })) return { none: 'nowhere to drive to', offered: list.map(d => d.name) };
    if (weather && g.weather) g.weather.set(weather, { now: true }); // (WEATHER=rain: the drive in the rain)
    g.hold(false);
    return { from: lm ? lm.name : null, landmarks: g.landmarks.map(l => l.name), dest: dest.name, len: g.pilot().len, share: g.pilot().share, offered: list.map(d => d.name) };
  }, { want: (process.env.DEST || '').toLowerCase(), scenic: !!process.env.SCENIC, weather: process.env.WEATHER || '', from: (process.env.FROM || '').toLowerCase() });
  console.log(JSON.stringify(set));
  if (set.none) { await b.close(); process.exit(1); }
  // take over the frame loop: the game asks for its next frame, and the film calls it at a fixed step
  await p.evaluate(() => {
    window.__frames = { cbs: [], t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cbs.push(cb); return window.__frames.cbs.length; };
    window.__frames.step = t => { const q = window.__frames.cbs; window.__frames.cbs = []; for (const f of q) f(t); };
  });
  await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 30000 });
  const dir = path.join(outDir, `${city}-autopilot`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tick = () => p.evaluate(fps => { const F = window.__frames, g = window.__game; F.t += 1000 / fps; F.step(F.t); const o = g.pilot(); return o ? { s: o.drv.st.s, v: o.drv.st.v, shot: o.film.name } : null; }, FPS);
  let n = 0, t0 = Date.now(), last = null;
  for (let i = 0; i < SECONDS * FPS; i++) {
    const st = await tick();
    if (!st && last) { for (let k = 0; k < FPS * 3; k++) { await tick(); if (!STILLS) await p.screenshot({ path: path.join(dir, `${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 }); } break; } // (three seconds of the arrival)
    last = st;
    if (STILLS) { if (i % (FPS * 5) === FPS * 2) { await p.screenshot({ path: path.join(outDir, `${city}-autopilot-${String(n++).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 90 }); console.log(`still ${n} at ${(i / FPS).toFixed(0)} s: ${JSON.stringify(st)}`); } continue; }
    await p.screenshot({ path: path.join(dir, `${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
    if (i % (FPS * 5) === 0) console.log(`${(i / FPS).toFixed(0)} s filmed in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(st)}`);
  }
  await b.close();
  if (STILLS) return;
  const mp4 = path.join(outDir, `${city}-autopilot.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${n} frames: ${mp4}`);
})();
