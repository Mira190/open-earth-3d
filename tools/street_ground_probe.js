// How even is the ground the game walks and drives on round the spawn? Plays a city's game (web/ served on PORT or
// 8800, under xvfb-run) and samples, every half metre along each road's centre line and each footway within RADIUS
// (default 300 m) of the start, where they lie on the ground (not on a deck): the height a walker's feet follow
// (nav.floorAt from the height a step before), the height your car follows (the same, as cars.js drive reads it), the
// terrain grid the ground tiles are drawn from, and, inside a hero level, the level's own drawn ground (a ray down onto
// its "ground" materials). Reports
//   steps    a rise or drop of more than 5 cm in half a metre that is not a deck's or a strip's (none of the ground's
//            kerbs are walked: a step on it is a fault, a building or a landmark's floor taken as the street)
//   bumps    the walked height off a smooth line through it (a 20 m running mean along the way) by more than 10 cm
//   grade    a change of grade of more than 6 % between the 2.5 m before a point and the 2.5 m after it (a crease)
//   feet     a hero level's drawn ground more than 6 cm over or under the walked height (feet sunk or floating)
// with the worst places of each, so that a fault can be found and looked at.
//   xvfb-run -a node tools/street_ground_probe.js shibuya [radius=300] [out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', RADIUS = '300', OUT] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); } catch (e) { /* storage blocked */ } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); g.spawn(); g.advance(0.5); });
  // (the hero level loads round the camera: wait for it to be shown)
  await p.waitForFunction(() => { const h = window.__game.hero(); return !h || h.state().every(s => s.state === 'shown' || s.shown || s.state === 'idle'); }, null, { timeout: 120000 }).catch(() => {});
  await p.evaluate(() => window.__game.advance(1));
  const r = await p.evaluate(R => {
    const g = window.__game, nav = g.nav, THREE = window.THREE, [sx, sy] = g.G.start.at;
    nav.prefetch(sx, sy, R + 20, Infinity);
    if (nav.layAll) nav.layAll(); // (every landmark's fine cells, as they are once you have walked there)
    const hero = g.hero && g.hero(), heroMeshes = [];
    if (hero) hero.group.traverse(o => { if (o.isMesh && o.visible !== false && /ground/i.test([].concat(o.material).map(m => m && m.name).join(' '))) heroMeshes.push(o); });
    hero && hero.group.updateMatrixWorld(true);
    const levels = (g.G.hero || []).filter(h => h.at && h.r);
    const inHero = (x, y) => levels.some(h => Math.hypot(x - h.at[0], y - h.at[1]) < h.r - 3);
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
    // the hero level's drawn ground at (x, y) near height z (the game's frame: x east, y north; three.js: x, z up, -y)
    const drawn = (x, y, z) => {
      if (!heroMeshes.length) return null;
      from.set(x, z + 1.2, -y); ray.set(from, down); ray.far = 2.5;
      const h = ray.intersectObjects(heroMeshes, false)[0];
      return h ? h.point.y : null;
    };
    const res = {};
    for (const [netName, net] of [['road', g.roadNet], ['foot', g.footNet]]) {
      const st = { samples: 0, steps: [], bumps: [], grade: [], feet: [], kinds: {}, rough: 0 };
      for (let li = 0; li < net.L.length; li++) {
        const l = net.L[li], n = l.pts.length / 3;
        let near = false;
        for (let k = 0; k < n && !near; k++) if (Math.hypot(l.pts[3 * k] - sx, l.pts[3 * k + 1] - sy) < R) near = true;
        if (!near) continue;
        // runs of the line on the ground, sampled every half metre
        const run = [];
        const flush = () => {
          if (run.length < 3) { run.length = 0; return; }
          const z = run.map(q => q.zw);
          for (let i = 0; i < run.length; i++) {
            const q = run[i];
            st.samples++; st.kinds[q.kind] = (st.kinds[q.kind] || 0) + 1;
            if (i > 0) {
              const dz = q.zw - run[i - 1].zw, dc = q.zc - run[i - 1].zc;
              if ((Math.abs(dz) > 0.05 || Math.abs(dc) > 0.05) && !(q.deckish || run[i - 1].deckish)) st.steps.push({ at: [q.x, q.y], dz: +dz.toFixed(2), car: +dc.toFixed(2), kinds: `${run[i - 1].kind}>${q.kind}`, line: li });
            }
            let a = 0, c = 0;
            for (let k = Math.max(0, i - 20); k <= Math.min(run.length - 1, i + 20); k++) { a += z[k]; c++; }
            const off = z[i] - a / c;
            if (i >= 20 && i < run.length - 20) { st.rough += off * off; if (Math.abs(off) > 0.1) st.bumps.push({ at: [q.x, q.y], off: +off.toFixed(2), kind: q.kind, line: li }); }
            if (i >= 5 && i < run.length - 5) {
              const g0 = (z[i] - z[i - 5]) / 2.5, g1 = (z[i + 5] - z[i]) / 2.5;
              if (Math.abs(g1 - g0) > 0.06) st.grade.push({ at: [q.x, q.y], from: +(g0 * 100).toFixed(1), to: +(g1 * 100).toFixed(1), kind: q.kind, line: li });
            }
            if (q.drawn != null && Math.abs(q.drawn - q.zw) > 0.06) st.feet.push({ at: [q.x, q.y], drawn: +q.drawn.toFixed(2), walked: +q.zw.toFixed(2), d: +(q.drawn - q.zw).toFixed(2), kind: q.kind });
          }
          run.length = 0;
        };
        let zw = null, zc = null;
        for (let k = 1; k < n; k++) {
          if (l.deck && l.deck[k - 1]) { flush(); zw = zc = null; continue; }
          const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], az = l.pts[3 * k - 1], bx = l.pts[3 * k], by = l.pts[3 * k + 1], bz = l.pts[3 * k + 2];
          const L = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.round(L / 0.5));
          for (let j = k === 1 ? 0 : 1; j <= m; j++) {
            const t = j / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, zl = az + (bz - az) * t;
            if (Math.hypot(x - sx, y - sy) > R || nav.isWater(x, y)) { flush(); zw = zc = null; continue; }
            const f0 = zw == null ? nav.floorAt(x, y, zl + 0.5) : nav.floorAt(x, y, zw), fc = zc == null ? nav.floorAt(x, y, zl + 0.6) : nav.floorAt(x, y, zc + 0.1);
            if (!f0 || !fc) { flush(); zw = zc = null; continue; }
            zw = f0.z; zc = fc.z;
            const deckish = f0.kind !== 'ground' && f0.kind !== 'roof' && f0.kind !== 'landmark';
            run.push({ x: +x.toFixed(1), y: +y.toFixed(1), zw, zc, kind: f0.kind === fc.kind ? f0.kind : `${f0.kind}/${fc.kind}`, deckish, drawn: inHero(x, y) ? drawn(x, y, zw) : null });
          }
        }
        flush();
      }
      // the worst places, one per 10 m
      const worst = (list, key) => {
        const seen = new Set(), out = [];
        for (const e of list.slice().sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))) {
          const k = `${Math.round(e.at[0] / 10)},${Math.round(e.at[1] / 10)}`;
          if (seen.has(k)) continue; seen.add(k); out.push(e);
          if (out.length >= 12) break;
        }
        return out;
      };
      const kindsOf = list => list.reduce((o, e) => { const k = e.kinds || e.kind; o[k] = (o[k] || 0) + 1; return o; }, {});
      res[netName] = { samples: st.samples, kinds: st.kinds, rms_cm: +(Math.sqrt(st.rough / Math.max(1, st.samples)) * 100).toFixed(2),
        steps: st.steps.length, stepKinds: kindsOf(st.steps), carSteps: st.steps.filter(e => Math.abs(e.car) > 0.05).length, bumps: st.bumps.length, bumpKinds: kindsOf(st.bumps), grade: st.grade.length, feet: st.feet.length,
        worstSteps: worst(st.steps, 'dz'), worstBumps: worst(st.bumps, 'off'), worstGrade: worst(st.grade.map(e => Object.assign(e, { dg: e.to - e.from })), 'dg'), worstFeet: worst(st.feet, 'd') };
    }
    res.heroMeshes = heroMeshes.length;
    return res;
  }, +RADIUS);
  const txt = JSON.stringify(r, null, 1);
  if (OUT) fs.writeFileSync(OUT, txt);
  for (const k of ['road', 'foot']) {
    const q = r[k];
    console.log(`${city} ${k}: ${q.samples} samples ${JSON.stringify(q.kinds)}; off a smooth line ${q.rms_cm} cm rms; steps ${q.steps} (car ${q.carSteps}) ${JSON.stringify(q.stepKinds)}; bumps ${q.bumps} ${JSON.stringify(q.bumpKinds)}; creases ${q.grade}; feet off the hero ground ${q.feet}`);
  }
  console.log(`hero ground meshes ${r.heroMeshes}`);
  await b.close();
})();
