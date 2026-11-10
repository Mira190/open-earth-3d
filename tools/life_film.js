// A film of a day of the daily life in a city's game (issue #357), about two minutes: the morning's
// card, the diary, a talk that earns a rank, a job, a counter, the evening, the phone, the night and
// the next day's card, with the score the game would play (rendered offline, music.js bounce) under
// it. The game's frame loop is driven at 24 frames a second of game time and every second frame of
// the page saved (the HUD and the cards are the point), so the film plays in real time at 12 fps.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/life_film.js shibuya out_dir [WxH, 1280x720]
// The script below is written for any map with a life.json: it uses the map's first person, a
// "point" job if there is one, and its first counter.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [,, city = 'shibuya', outDir = '.', size = '1280x720'] = process.argv;
const FPS = 12, SUB = 2; // saved frames a second, game frames to each
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); localStorage.removeItem('oe3d-life'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.life', null, { timeout: 900000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => window.__game.life.data.bonds.length, null, { timeout: 20000 }).catch(() => {});
  // the morning, on a clear day; the game started and the arrival settled
  await p.evaluate(() => {
    const g = window.__game, c = g.clock;
    document.getElementById('gt-play').click();
    if (g.overture() && g.overture().active) g.overture().skip();
    g.settleArrival(); if (g.cine.active) g.cine.skip();
    if (g.weather) g.weather.set('clear', { now: true });
    g.setClock(c.y, c.m, c.d, 7 * 60 + 40); c.scale = 30;
    g.life.wipe();
    window.__frames = { cbs: [], t: performance.now() };
    window.requestAnimationFrame = cb => { window.__frames.cbs.push(cb); return window.__frames.cbs.length; };
    // (and the page's timeouts run on the film's clock too: a banner held 3.4 s, a toast, a card's exit are seconds of
    // the film, not of the minutes a software renderer takes over them)
    const F = window.__frames, timers = F.timers = [];
    window.setTimeout = (f, ms = 0, ...a) => { const id = 1e9 + timers.length + Math.floor(Math.random() * 1e6); timers.push({ id, at: F.t + ms, f: () => f(...a) }); return id; };
    const clr = window.clearTimeout.bind(window);
    window.clearTimeout = id => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); else clr(id); };
    F.step = t => { const q = F.cbs; F.cbs = []; for (const f of q) f(t); for (const x of timers.filter(x => x.at <= t)) { timers.splice(timers.indexOf(x), 1); x.f(); } };
    // helpers for the script
    const L = g.life, b = L.data.bonds[0], n = b && g.npcs.find(x => x.id === b.npc);
    window.__f = {
      b, n,
      beside(at, d = 2.2, face = null) { const s = g.nav.stand ? g.nav.stand(at[0] + d, at[1] - d * 0.6, at[2] || 0, { rMax: 6 }) : null; const q = s || { x: at[0] + d, y: at[1] - d * 0.6, z: at[2] != null ? at[2] : g.nav.terrain(at[0], at[1]) };
        g.player.x = q.x; g.player.y = q.y; g.player.z = q.z; const f = face || at; g.player.h = g.cam.yaw = Math.atan2(f[0] - q.x, f[1] - q.y); g.cam.pitch = 0.22; g.cam.dist = 6; },
      say() { if (g.dlg.open && !g.dlg.hasChoices) g.dlg.next(false); },
      tab(t) { const x = document.querySelector(`.lf-tabs button[data-tab="${t}"]`); if (x) x.click(); },
      job: L.data.jobs.find(x => x.type === 'point') || L.data.jobs.find(x => x.type === 'deliver'),
      shop: L.data.shops.find(s => s.hours) || L.data.shops[0],
    };
  });
  await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 60000 });
  // the script: [second, what happens]
  const S = [
    [0.5, () => { window.__game.life.day.card(); window.__game.keys.add('KeyW'); }],
    [7, () => { window.__game.keys.delete('KeyW'); window.__game.life.day.show(); }],
    [13, () => window.__f.tab('people')],
    [17, () => window.__f.tab('work')],
    [21, () => { const g = window.__game, f = window.__f; g.life.day.close(); if (f.n) { g.life.day.passTo((f.b.hours && f.b.hours.slots || ['daytime'])[0]); } }],
    [25, () => { const g = window.__game, f = window.__f; if (f.n) { f.beside([f.n.x, f.n.y, f.n.z]); } }],
    [27, () => { const g = window.__game, f = window.__f; if (f.n) g.life.bonds.talk(f.n); }],
    [31, () => { const g = window.__game; if (g.dlg.hasChoices) g.dlg.choose(0); }],
    [35, () => window.__f.say()], [39, () => window.__f.say()], [43, () => window.__f.say()], [46, () => window.__f.say()],
    [49, () => { const g = window.__game, f = window.__f; if (g.dlg.hasChoices) { const k = f.b.ranks[0].ask ? f.b.ranks[0].ask.options.findIndex(o => o.good) : 0; g.dlg.choose(Math.max(0, k)); } }],
    [54, () => { const g = window.__game; for (let i = 0; i < 6 && g.dlg.open; i++) g.dlg.next(false); }],
    [62, () => { const g = window.__game, f = window.__f; if (f.job) { f.job.locked = false; delete f.job.when; g.life.day.show(); f.tab('work'); } }],
    [66, () => { const g = window.__game, f = window.__f; g.life.day.close(); if (f.job) { g.life.jobs.start(f.job.id); f.beside(f.job.at, 0.5, f.job.targets ? f.job.targets[0].at : f.job.to); } }],
    [70, () => { const g = window.__game, f = window.__f, a = g.life.jobs.active; if (a && a.j.targets) { const t = a.j.targets[a.i].at; g.cam.yaw = Math.atan2(t[0] - g.player.x, t[1] - g.player.y) + 0.07; } }],
    [72, () => { const a = window.__game.life.jobs.active; if (a && a.j.targets) window.__game.life.jobs.pointAt(); }],
    [74, () => { const g = window.__game, a = g.life.jobs.active; if (a && a.j.targets) { const t = a.j.targets[a.i].at; g.cam.yaw = Math.atan2(t[0] - g.player.x, t[1] - g.player.y) - 0.2; } }],
    [76, () => { const a = window.__game.life.jobs.active; if (a && a.j.targets) window.__game.life.jobs.pointAt(); }],
    [78, () => { const g = window.__game, a = g.life.jobs.active; if (a && a.j.targets) { const t = a.j.targets[a.i].at; g.cam.yaw = Math.atan2(t[0] - g.player.x, t[1] - g.player.y) + 0.5; } }],
    [80, () => { const g = window.__game, a = g.life.jobs.active; if (a && a.j.targets) g.life.jobs.pointAt(); else if (a) { g.player.x = a.j.to[0]; g.player.y = a.j.to[1]; } }],
    [86, () => { const g = window.__game; g.life.day.passTo('evening'); }],
    [91, () => { const g = window.__game, f = window.__f; if (f.shop) { f.beside(f.shop.at, 0.8); } }],
    [93, () => { const g = window.__game, a = g.life.action(); if (a && a.act) a.act(); }],
    [96, () => { const g = window.__game, f = window.__f; if (g.dlg.hasChoices) g.dlg.choose(Math.max(0, f.shop.menu.findIndex(m => !m.keep))); }],
    [101, () => { const g = window.__game; for (let i = 0; i < 6 && g.dlg.open; i++) g.dlg.next(false); g.phoneShow('home'); }],
    [105, () => window.__game.phoneShow('messages')],
    [109, () => { const g = window.__game; g.phoneShow(false); g.life.day.passTo('night'); g.keys.add('KeyW'); }],
    [115, () => { const g = window.__game; g.keys.delete('KeyW'); g.renderPassport(); document.getElementById('g-pass').hidden = false; }],
    [119, () => { const g = window.__game; document.getElementById('g-pass').hidden = true; g.life.day.passTo('morning'); }],
  ];
  const END = 125;
  const dir = path.join(outDir, `${city}-life`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0, si = 0;
  const cues = []; // the score's cues: [second, state]
  for (let i = 0; i < END * FPS; i++) {
    const t = i / FPS;
    while (si < S.length && S[si][0] <= t) { await p.evaluate(S[si][1]); si++; }
    for (let k = 0; k < SUB; k++) {
      await p.waitForFunction(() => window.__frames.cbs.length, null, { timeout: 120000 });
      await p.evaluate(dt => { const F = window.__frames; F.t += dt; F.step(F.t); }, 1000 / (FPS * SUB));
    }
    if (i % FPS === 0) {
      const st = await p.evaluate(() => { const g = window.__game, L = g.life; return { slot: L.day.slot, talking: g.dlg.open }; });
      if (!cues.length || cues[cues.length - 1][1].slot !== st.slot || cues[cues.length - 1][1].talking !== st.talking) cues.push([t, st]);
    }
    await p.screenshot({ path: path.join(dir, `${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88, timeout: 240000 });
    if (i % (FPS * 10) === 0) console.log(`${Math.round(t)} s of ${END}`);
  }
  // the score for those cues, rendered offline
  const wav = await p.evaluate(async ([cues, secs, pal]) => {
    if (!window.OEMusic) return null;
    const states = cues.map(([at, s]) => Object.assign({ at, palette: pal }, s));
    states[0].stings = [[1, 'day'], [56, 'rank'], [82, 'job'], [87, 'day'], [110, 'day'], [120, 'day']];
    const buf = await OEMusic.bounce(secs, states);
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, out = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { out[i * 2] = Math.max(-1, Math.min(1, L[i] * 2.2)) * 32767; out[i * 2 + 1] = Math.max(-1, Math.min(1, R[i] * 2.2)) * 32767; }
    let s = ''; const u8 = new Uint8Array(out.buffer); for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return { rate: buf.sampleRate, pcm: btoa(s) };
  }, [cues, END, /^(kyoto|higashiyama|fushimi-inari|tetsugaku)$/.test(city) ? 'kyoto' : /sydney/.test(city) ? 'sydney' : /queenstown/.test(city) ? 'alpine' : 'tokyo']).catch(e => { console.log(`no score: ${String(e).slice(0, 200)}`); return null; });
  await b.close();
  const mp4 = path.join(outDir, `${city}-life.mp4`), args = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg')];
  if (wav) { const pcm = path.join(dir, 'score.pcm'); fs.writeFileSync(pcm, Buffer.from(wav.pcm, 'base64')); args.push('-f', 's16le', '-ar', String(wav.rate), '-ac', '2', '-i', pcm, '-c:a', 'aac', '-b:a', '160k', '-shortest'); }
  execFileSync('ffmpeg', args.concat(['-r', '24', '-pix_fmt', 'yuv420p', '-crf', '20', mp4]));
  console.log(`${n} frames${wav ? ', with the score' : ''}: ${mp4}`);
})();
