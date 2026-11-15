// What a frame costs, for comparing two ways of drawing the same thing: a map at an hour and a weather, the player
// settled at the start, then the median time to draw and finish one frame, with and without the screens' area lights, and a still. A software renderer
// pays for every shader operation on the CPU, so the ratio between two runs is the ratio of their shading work
// (not a real GPU's frame time: that comes from the players' telemetry).
//   xvfb-run -a node tools/frame_cost.js shibuya out.png [HH:MM] [weather]     Q='arealight=ltc' GOV='0.6/0' TIER=high
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', out = '/tmp/frame.png', time = '17:38', weather = 'rain'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const [w, h] = (process.env.SIZE || '1001x894').split('x').map(Number);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p, { asIs: true });
  await p.evaluate(([t, wx, gov]) => {
    const g = window.__game, [hh, mm] = t.split(':').map(Number);
    g.setClock(g.clock.y, 10, 10, hh * 60 + mm); if (g.weather) g.weather.set(wx, { now: true });
    for (let i = 0; i < 200 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.1); }
    if (gov && g.governor) { const [s, e] = gov.split('/').map(Number); g.governor.set(s, e); }
  }, [time, weather, process.env.GOV || '']);
  await p.waitForTimeout(+(process.env.WARM || 45000)); // (the materials' programs, compiled as they are first drawn)
  await p.evaluate(() => window.__game.hold(true));
  // one frame drawn and finished, several times over: with the lights as they are, and with the screens' lights taken
  // out of the scene (what is left when they cost nothing)
  const draw = n => p.evaluate(n => {
    const g = window.__game, gl = document.querySelector('#game-gl').getContext('webgl2'), px = new Uint8Array(4), ts = [];
    for (let i = 0; i < n + 2; i++) {
      const t0 = performance.now();
      g.atmos.render(g.world, g.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 2) ts.push(performance.now() - t0);
    }
    ts.sort((a, c) => a - c);
    return Math.round(ts[ts.length >> 1]);
  }, n);
  const N = +(process.env.N || 5), r = { lit: await draw(N) };
  await p.evaluate(() => { const g = window.__game; g.world.traverse(o => { if (o.isRectAreaLight) { o.userData.was = o.visible; o.visible = false; } }); });
  r.unlit = await draw(N);
  await p.evaluate(() => { const g = window.__game; g.world.traverse(o => { if (o.isRectAreaLight) o.visible = o.userData.was; }); });
  await draw(1);
  const st = await p.evaluate(() => { const g = window.__game, gl = document.querySelector('#game-gl'); return { lights: g.neon ? g.neon.count : 0, mirror: g.mirror ? { on: g.mirror.on, off: !!g.mirror.off } : null, scale: g.pxScale(), canvas: [gl.width, gl.height], fit: window.OEGLCare && OEGLCare.fit ? OEGLCare.fit.level : null }; });
  await p.evaluate(() => { for (const e of document.querySelectorAll('#game-gl ~ *, .game-stage > *')) if (e.tagName !== 'CANVAS') e.style.visibility = 'hidden'; window.__game.atmos.render(window.__game.world, window.__game.camera); }); // (the picture alone)
  await p.screenshot({ path: out });
  console.log(JSON.stringify({ q: process.env.Q || '', gov: process.env.GOV || '', ms: r.lit, without_area_lights_ms: r.unlit, ...st }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
