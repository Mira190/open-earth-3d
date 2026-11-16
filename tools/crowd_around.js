// Where the crowd is round a map's spawn: the walkers out at a clock time, counted by the bearing from the spawn in
// twelve 30-degree sectors and by distance (near: within the skinned people's 32 m; far: 32 to 120 m), and the
// sector with the most of both, as a point to look at. For framing stills with near and far walkers in one shot
// (tools/views/far_crowd_<city>.json, issue 475).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/crowd_around.js tokyo [HH:MM]
// TIER=low|medium|high (default high). WAIT=seconds before counting (default 8). SIM=seconds of the game stepped on before counting.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', time = '12:30'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await startPlay(p);
  const [h, m] = time.split(':').map(Number);
  await p.evaluate(min => { const g = window.__game; g.setClock(g.clock.y, g.clock.m, g.clock.d, min); g.clock.scale = 1; if (g.crowdAuto) g.crowdAuto(true); }, h * 60 + m);
  await p.waitForTimeout(+(process.env.WAIT || 8) * 1000); // (WAIT=seconds: how the crowd round the spawn holds as it walks on)
  // (SIM=seconds: the game stepped on that long at 30 steps a second, whatever the renderer's pace: what the square holds once those put there have walked on)
  if (process.env.SIM) await p.evaluate(secs => { window.requestAnimationFrame = () => 0; const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); for (let i = 0; i < secs * 30; i++) g.advance(1 / 30); }, +process.env.SIM);
  const r = await p.evaluate(() => {
    const g = window.__game, s = (g.G.start || {}).at || [g.player.x, g.player.y], sec = Array.from({ length: 12 }, () => ({ near: 0, far: 0 }));
    for (const q of g.crowd.P.slice(0, g.crowd.active)) {
      if (q.line < 0) continue;
      const dx = q.x - s[0], dy = q.y - s[1], d = Math.hypot(dx, dy);
      if (d < 3 || d > 120) continue;
      const k = Math.floor(((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360) / 30);
      sec[k][d < 32 ? 'near' : 'far']++;
    }
    const best = sec.map((c, k) => [Math.min(c.near * 3, c.far) + c.near + c.far / 3, k]).sort((a, b) => b[0] - a[0])[0][1];
    const a = (best * 30 + 15) * Math.PI / 180;
    return { at: s, near: sec.reduce((n, c) => n + c.near, 0), far: sec.reduce((n, c) => n + c.far, 0), out: g.crowd.active, sectors: sec.map((c, k) => `${k * 30}-${k * 30 + 30}: ${c.near} near, ${c.far} far`), look: [+(s[0] + 40 * Math.sin(a)).toFixed(1), +(s[1] + 40 * Math.cos(a)).toFixed(1)] };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
