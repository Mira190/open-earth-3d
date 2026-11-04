// What the trees cost where they are thickest: stands the surveyor at each spot in a city's game and
// counts the tree instances drawn there and their triangles (the shared trees, web/trees.js: the
// meshes whose geometry carries its 'tc' attribute), per level of detail, and the frame time.
// For the woods planted from the canopy (pipeline/woods.py) against main's mapped trees alone.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/woods_probe.js kyoto 357,2590 100,1880   # x,y in the city's local frame
// TIER=low takes the small device's share of the woods. The shadow figure is what the sun's shadow
// map draws again (each caster, every frame the shadows update).
const { chromium } = require('playwright');
const [,, city = 'kyoto', ...spots] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  for (const s of spots.length ? spots : ['0,0']) {
    const [x, y] = s.split(',').map(Number);
    const r = await p.evaluate(async ([x, y]) => {
      const g = window.__game;
      if (g.cine.active) g.cine.skip();
      const f = g.nav.floorAt(x, y, g.nav.terrain(x, y) + 0.5);
      g.player.x = x; g.player.y = y; g.player.z = f ? f.z : 0;
      g.advance(2);
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
      const ms = (performance.now() - t0) / 4;
      const per = {};
      let tris = 0, shadow = 0;
      g.Wd.world.traverse(o => {
        if (!o.isInstancedMesh || !o.geometry.getAttribute('tc') || !o.count) return;
        const t = (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
        tris += t * o.count;
        if (o.castShadow) shadow += t * o.count;
        per[t] = (per[t] || 0) + o.count;
      });
      const T = g.Wd.trees, species = T ? T.species.map((sp, k) => `${sp} ${T.count[k]}`).join(', ') : '';
      return { species, trees: g.Wd.trees ? g.Wd.trees.n : 0, tris: Math.round(tris), shadow: Math.round(shadow), perMeshTriangles: per, ms: Math.round(ms) };
    }, [x, y]);
    console.log(`${city} [${process.env.TIER || 'high'}] at ${x},${y}: ${r.trees} trees in all; ${(r.tris / 1e6).toFixed(2)} M tree triangles drawn, ${(r.shadow / 1e6).toFixed(2)} M of them into the shadow map (per mesh size: ${JSON.stringify(r.perMeshTriangles)}); ${r.ms} ms a frame`);
    if (s === spots[0] || !spots.length) console.log(`  species: ${r.species}`);
  }
  if (logs.length) console.log(logs.join('\n'));
  await b.close();
})();
