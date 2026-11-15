// Does whoever stands in a hero level stand on what it draws? Plays a city's game (web/ served on PORT or 8800, under
// xvfb-run), stands in each hero level (docs/HERO.md) until it is shown, and samples every STEP metres inside it (2 m in
// from its edge): the level's drawn ground (a ray down onto its "ground" materials, the highest hit within 1.5 m of the
// walked floor) against the floor a walker stands on there (nav.floorAt), where that floor is the ground's. Prints, per level, how many points have drawn
// ground, the rms and the share off by more than 3, 6 and 15 cm, the worst places, and how even the drawn ground is
// itself (changes of grade of more than 6 % over STEP either side, along x and y). With "export", writes the drawn
// ground as a grid ({id, x0, y0, cell, nx, ny, z: [cm or null], lift}) to OUT for pipeline/hero_floor.py.
//   xvfb-run -a node tools/hero_ground_probe.js shibuya [step=1] [export out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', STEP = '1', MODE = '', OUT = ''] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); g.advance(0.5); });
  const levels = await p.evaluate(() => (window.__game.G.hero || []).filter(h => h.at && h.r).map(h => h.id));
  const out = [];
  for (const id of levels) {
    // stand in its middle until it is shown
    await p.evaluate(id => { const g = window.__game, h = g.G.hero.find(q => q.id === id), pl = g.player; pl.x = h.at[0]; pl.y = h.at[1]; pl.z = g.nav.terrain(pl.x, pl.y); g.advance(0.5); }, id);
    await p.waitForFunction(id => { const h = window.__game.hero(); const s = h && h.state().find(q => q.id === id); window.__game.advance(0.2); return s && s.shown; }, id, { timeout: 180000, polling: 1000 }).catch(() => {});
    const r = await p.evaluate(([id, step, exp]) => {
      const g = window.__game, nav = g.nav, THREE = window.THREE, H = g.G.hero.find(q => q.id === id), hero = g.hero(), L = hero.levels.find(q => q.h.id === id);
      const meshes = [];
      if (L && L.root) { L.root.updateMatrixWorld(true); L.root.traverse(o => { if (o.isMesh && /ground/i.test([].concat(o.material).map(m => m && m.name).join(' '))) meshes.push(o); }); }
      if (!meshes.length) return { id, none: true };
      const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
      const n = Math.floor((H.r - 2) / step), nx = 2 * n + 1, z = new Array(nx * nx).fill(null), w = new Array(nx * nx).fill(null);
      const d = [];
      for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
        const x = H.at[0] + (i - n) * step, y = H.at[1] + (j - n) * step;
        if (Math.hypot(x - H.at[0], y - H.at[1]) > H.r - 2 || nav.isWater(x, y)) continue;
        const t = nav.terrain(x, y), f = nav.floorAt(x, y, t + 0.1);
        if (!f) continue;
        from.set(x, f.z + 1.5, -y); ray.set(from, down); ray.far = 3;
        const hit = ray.intersectObjects(meshes, false)[0];
        if (!hit) continue;
        z[j * nx + i] = hit.point.y; w[j * nx + i] = f.z;
        if (f.kind === 'ground') d.push({ x, y, drawn: hit.point.y, walked: f.z, kind: f.kind, off: hit.point.y - f.z }); // (on the ground: a landmark's floor over it, a planter or a platform, is the landmark's)
      }
      const abs = d.map(q => Math.abs(q.off));
      const rms = Math.sqrt(d.reduce((a, q) => a + q.off * q.off, 0) / Math.max(1, d.length));
      // the drawn ground's own creases: grade change over step either side, along x and y
      let creases = 0, cn = 0;
      for (let j = 1; j < nx - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const c = z[j * nx + i];
        if (c == null) continue;
        for (const [a, b2] of [[z[j * nx + i - 1], z[j * nx + i + 1]], [z[(j - 1) * nx + i], z[(j + 1) * nx + i]]]) {
          if (a == null || b2 == null) continue;
          cn++;
          if (Math.abs((b2 - c) - (c - a)) / step > 0.06) creases++;
        }
      }
      const worst = d.slice().sort((a, q) => Math.abs(q.off) - Math.abs(a.off)).filter((q, k, A) => A.slice(0, k).every(o => Math.hypot(o.x - q.x, o.y - q.y) > 8)).slice(0, 10)
        .map(q => ({ at: [q.x, q.y], drawn: +q.drawn.toFixed(2), walked: +q.walked.toFixed(2), off: +q.off.toFixed(2), kind: q.kind }));
      const res = { id, meshes: meshes.length, points: d.length, rms_cm: +(rms * 100).toFixed(1), over3: abs.filter(v => v > 0.03).length, over6: abs.filter(v => v > 0.06).length, over15: abs.filter(v => v > 0.15).length,
        creases_over_6pc: creases, crease_samples: cn, worst };
      if (exp) res.grid = { id, x0: H.at[0] - n * step, y0: H.at[1] - n * step, cell: step, nx, ny: nx, z: z.map(v => (v == null ? null : Math.round(v * 100))), lift: H.lift || 0 };
      return res;
    }, [id, +STEP, MODE === 'export']);
    out.push(r);
    if (r.none) { console.log(`${city} ${id}: no drawn ground (not shown)`); continue; }
    console.log(`${city} ${id}: ${r.points} points on its drawn ground (${r.meshes} meshes); off the walked floor ${r.rms_cm} cm rms, ${r.over3} over 3 cm, ${r.over6} over 6 cm, ${r.over15} over 15 cm; the drawn ground's creases over 6 %: ${r.creases_over_6pc} of ${r.crease_samples}`);
    for (const q of r.worst.slice(0, 6)) console.log(`   ${q.at.map(v => v.toFixed(1))}: drawn ${q.drawn}, walked ${q.walked} (${q.off > 0 ? '+' : ''}${q.off}) on ${q.kind}`);
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(MODE === 'export' ? out.filter(r => r.grid).map(r => r.grid) : out));
  await b.close();
})();
