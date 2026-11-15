// What a frame is lit by and drawn with: the lights of each kind in the scene, the passes the composer runs, and the
// renderer's own counts, for a map at an hour (the cost a GPU pays per pixel grows with every light in a forward renderer).
//   xvfb-run -a node tools/light_probe.js shibuya [Q=story=1]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1001, height: 894 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p, { asIs: true });
  await p.waitForTimeout(+(process.env.WAIT || 60000));
  const r = await p.evaluate(() => {
    const g = window.__game, sc = g.world || g.scene, lights = {}, mats = new Set();
    let meshes = 0, skinned = 0, inst = 0;
    sc.traverse(o => {
      if (o.isLight) { const k = o.type + (o.castShadow ? '+shadow' : '') + (o.visible ? '' : ' (hidden)'); lights[k] = (lights[k] || 0) + 1; }
      if (o.isMesh && o.visible) { meshes++; if (o.isSkinnedMesh) skinned++; if (o.isInstancedMesh) inst++; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && mats.add(m)); }
    });
    const R = (g.atmos && g.atmos.composer && g.atmos.composer.renderer) || g.renderer, info = R.info;
    return { lights, meshes, skinned, inst, materials: mats.size, programs: info.programs && info.programs.length, calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries,
      passes: g.atmos && g.atmos.composer ? g.atmos.composer.passes.map(q => q.constructor.name + (q.enabled === false ? ' (off)' : '')) : null, story: g.story && g.story.state.phase };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
