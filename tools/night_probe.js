// What the night is drawn with, where the player stands: the wet street's mirror, the bloom, the exposure and the
// hero level's materials (which are ground, which glow), printed as JSON. For working on the night's look.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/night_probe.js shibuya [HH:MM] [weather]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', time = '20:30', weather = 'rain'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p, { asIs: true });
  await p.evaluate(([t, w]) => { const g = window.__game, [h, m] = t.split(':').map(Number); g.setClock(g.clock.y, 10, 10, h * 60 + m); if (g.weather) g.weather.set(w, { now: true }); }, [time, weather]);
  await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 200 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.1); } });
  await p.waitForTimeout(8000);
  const out = await p.evaluate(() => {
    const g = window.__game, L = g.lens && g.lens.uniforms, mats = {};
    const names = new Set();
    (g.Wd.scene || g.Wd.world || { traverse() {} }).traverse(o => { for (const m of [].concat(o.material || [])) if (m && m.name) names.add(m.name); });
    return {
      mirror: g.mirror ? { on: g.mirror.on, off: !!g.mirror.off, drawn: g.mirror.uniforms.uMirrorOn.value, wet: g.mirror.uniforms.uWetM.value } : null,
      weather: g.weather && g.weather.state, governor: g.governor ? { scale: g.governor.scale, extras: g.governor.extras } : null,
      lens: L ? { exposure: L.uExposure.value, night: L.uNightTone.value, lift: L.uLift.value, sat: L.uSat.value, contrast: L.uContrast.value } : null,
      cam: (() => { const c = g.camera, T = window.THREE, look = new T.Vector3(0, -1, 0.5).unproject(c).sub(c.position), z = Math.max(0, g.nav.terrain(c.position.x, -c.position.z)), f = g.nav.floorAt(c.position.x, -c.position.z, z + 0.5); return { y: c.position.y, ground: f ? f.z : z, lowestRay: look.y / Math.hypot(look.x, look.z), reversed: !!c.reversedDepth, playing: g.player.mode, sceneType: typeof g.scene }; })(),
      named: [...names].filter(n => /^(ground|glow|tube|chase|win)/.test(n)).sort(),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
