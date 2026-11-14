// What lies on top at some points of a city's game: the name of the first mesh a ray from above meets, and
// its height over the terrain. For finding what pokes through a street (docs/HERO.md).
//   xvfb-run -a node tools/top_probe.js kamakura "-443,155;-446,153"
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'kamakura', pts = '0,0'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p);
  await p.waitForTimeout(+(process.env.SETTLE || 20) * 1000);
  const out = await p.evaluate(pts => {
    const g = window.__game, rc = new THREE.Raycaster(), res = [];
    rc.camera = g.camera;
    for (const [x, y] of pts) {
      const t = g.nav.terrain(x, y);
      rc.set(new THREE.Vector3(x, t + 30, -y), new THREE.Vector3(0, -1, 0));
      const hits = rc.intersectObjects(g.world.children, true).filter(h => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; }).slice(0, 4);
      res.push({ x, y, terrain: +t.toFixed(2), hits: hits.map(h => { const names = []; for (let o = h.object; o && names.length < 3; o = o.parent) names.push(o.name || o.type); return `${(h.point.y - t).toFixed(2)} ${names.join('<')} [${h.object.material && h.object.material.name}]`; }) });
    }
    return res;
  }, pts.split(';').map(s => s.split(',').map(Number)));
  for (const r of out) console.log(r.x, r.y, 'terrain', r.terrain, '\n   ' + r.hits.join('\n   '));
  await b.close();
})();
