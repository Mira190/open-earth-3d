// What is solid is drawn, and what is drawn solid is solid: an audit of a map's walking model against the picture.
// Round each hero level of a city's game (or `at` and `r`), on a half-metre grid:
//   unseen walls   a place a walker is kept out of (nav.walk says "wall", or a post pushes them off) where nothing
//                  is drawn between the knee and the head within a metre: a wall no one can see. Shibuya's scramble
//                  had one across a crosswalk: guard pipes of a landmark mesh the hero level hides and draws
//                  elsewhere, still solid where they had stood.
//   walked through a place a walker can stand, and get to from the level's middle, where something drawn stands from
//                  the shin to the chest (a railing, a box, a lamp post that is not solid), named by its mesh: listed,
//                  not failed. The crowd is sent away first and the cars' models are not read; a cell beside a lamp
//                  post or a trunk that is solid is the post's own.
//   floor          how far the floor a walker stands on is from the ground drawn under them (the highest thing drawn
//                  within 12 cm above or 30 cm below their soles): feet in the paving, or over it.
// It reads the page's own scene (every visible mesh's triangles near the ground, in a grid) and its own nav, so it
// checks what a player gets, whichever generation of data drew it.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/unseen_walls.js shibuya            # each hero level of the map
//   xvfb-run -a node tools/unseen_walls.js sydney -195 230 60  # round a point
//   CDP=http://localhost:9333 node tools/unseen_walls.js shibuya   # a page already open (with a debugging port)
//   footways barred  a mapped footway (the lines the crowd walks) that runs into something solid: a railing across a
//                  crosswalk's end, a post in a path.
// Exits 1 when an unseen wall of three cells or more or a barred footway is found.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', ax, ay, ar] = process.argv;

function audit({ at, r }) {
  const g = window.__game, nav = g.nav, STEP = 0.5, CELL = 0.5;
  const x0 = at[0] - r - 2, y0 = at[1] - r - 2, n = Math.ceil((2 * r + 4) / CELL);
  // what is drawn, per cell: the lowest and highest point between the shin and the head (lo, hi), and the highest
  // point near the ground (top)
  const lo = new Float32Array(n * n).fill(Infinity), hi = new Float32Array(n * n).fill(-Infinity), top = new Float32Array(n * n).fill(-Infinity);
  const who = new Array(n * n), names = [], nameId = new Map(); // which mesh stands highest in each cell between the shin and the head
  let cur = 0;
  const ground = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ground[j * n + i] = nav.terrain(x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL);
  const mark = (x, y, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL);
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const k = j * n + i, h = z - ground[k];
    if (h > 0.3 && h < 1.8) { if (h < lo[k]) lo[k] = h; if (h > hi[k]) { hi[k] = h; who[k] = cur; } }
    if (h > -0.4 && h < 0.3 && h > top[k]) top[k] = h;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m4 = new THREE.Matrix4(), sph = new THREE.Sphere();
  const centre = new THREE.Vector3(at[0], 0, -at[1]);
  let meshes = 0, tris = 0;
  const tri = () => { // a, b, c in world space: sampled every 0.2 m
    const zmin = Math.min(a.y, b.y, c.y), zmax = Math.max(a.y, b.y, c.y);
    if (Math.min(a.x, b.x, c.x) > at[0] + r + 2 || Math.max(a.x, b.x, c.x) < at[0] - r - 2 || Math.min(-a.z, -b.z, -c.z) > at[1] + r + 2 || Math.max(-a.z, -b.z, -c.z) < at[1] - r - 2) return;
    if (zmax < gmin - 0.5 || zmin > gmax + 1.9) return;
    tris++;
    const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), s = Math.min(400, Math.max(1, Math.ceil(e / 0.2)));
    for (let i = 0; i <= s; i++) for (let j = 0; j <= s - i; j++) {
      const u = i / s, v = j / s, w = 1 - u - v;
      mark(a.x * w + b.x * u + c.x * v, -(a.z * w + b.z * u + c.z * v), a.y * w + b.y * u + c.y * v);
    }
  };
  let gmin = Infinity, gmax = -Infinity;
  for (const z of ground) { if (z < gmin) gmin = z; if (z > gmax) gmax = z; }
  const car = g.myCar && g.myCar(), mine = car && car.C ? car.C.group : null;
  g.Wd.world.updateMatrixWorld(true);
  g.Wd.world.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let q = o; q; q = q.parent) if (!q.visible || q === mine) return; // (nor your own car, parked in the level)
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every(m => !m || m.visible === false || (m.transparent && m.opacity < 0.05))) return;
    const ge = o.geometry, P = ge.attributes.position, I = ge.index;
    if (!ge.boundingSphere) ge.computeBoundingSphere();
    const count = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < count; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, m4); m4.premultiply(o.matrixWorld); } else m4.copy(o.matrixWorld);
      sph.copy(ge.boundingSphere).applyMatrix4(m4);
      if (Math.hypot(sph.center.x - centre.x, sph.center.z - centre.z) > r + 3 + sph.radius) continue;
      if (sph.center.y + sph.radius < gmin - 0.5 || sph.center.y - sph.radius > gmax + 1.9) continue;
      meshes++;
      const chain = [];
      for (let q = o; q && chain.length < 3; q = q.parent) { const t = q.name || (q.userData && (q.userData.name || q.userData.kind)) || ''; if (t && t !== chain[chain.length - 1]) chain.push(t); }
      if (chain.some(t => /^(Car_|Bus_|Taxi_|Truck_|Van_|Body$|Body_mesh|Wheel)/.test(t))) continue; // (a car of the traffic or your own, parked: the shared vehicle models' parts)
      const nm = (chain.reverse().join(' > ') || o.type) + (mats[0] && mats[0].name ? ` [${mats[0].name}]` : '');
      if (!nameId.has(nm)) nameId.set(nm, names.push(nm) - 1);
      cur = nameId.get(nm);
      const nt = (I ? I.count : P.count) / 3;
      for (let t = 0; t < nt; t++) {
        const i0 = I ? I.getX(3 * t) : 3 * t, i1 = I ? I.getX(3 * t + 1) : 3 * t + 1, i2 = I ? I.getX(3 * t + 2) : 3 * t + 2;
        a.fromBufferAttribute(P, i0).applyMatrix4(m4); b.fromBufferAttribute(P, i1).applyMatrix4(m4); c.fromBufferAttribute(P, i2).applyMatrix4(m4);
        tri();
      }
    }
  });
  // what the walking model says, on the same grid
  const seenNear = (i, j, R) => { for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < n && jj < n && hi[jj * n + ii] > -Infinity) return true; } return false; };
  // where a walker can get to from the level's middle, cell to cell: a place shut in behind walls (the inside of a
  // block a landmark draws) is no one's to walk through
  const okAt = new Uint8Array(n * n), reach = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL, f = nav.floorAt(x, y, ground[j * n + i] + 0.6);
    if (f && f.kind === 'ground' && Math.abs(f.z - ground[j * n + i]) <= 0.4 && nav.walk(x, y, f.z, true).ok) okAt[j * n + i] = 1;
  }
  {
    const c0 = Math.floor((at[0] - x0) / CELL), r0 = Math.floor((at[1] - y0) / CELL), q = [];
    for (let R = 0; R < 40 && !q.length; R++) for (let dj = -R; dj <= R && !q.length; dj++) for (let di = -R; di <= R; di++) { const k = (r0 + dj) * n + c0 + di; if (okAt[k]) { q.push(k); reach[k] = 1; break; } }
    while (q.length) { const k = q.pop(), i = k % n, j = (k - i) / n; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, kk = jj * n + ii; if (ii >= 0 && jj >= 0 && ii < n && jj < n && okAt[kk] && !reach[kk]) { reach[kk] = 1; q.push(kk); } } }
  }
  const unseen = [], through = [], floors = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL;
    if (Math.hypot(x - at[0], y - at[1]) > r) continue;
    const k = j * n + i, f = nav.floorAt(x, y, ground[k] + 0.6);
    if (!f || f.kind !== 'ground' || Math.abs(f.z - ground[k]) > 0.4) continue; // (the street's level: not a deck, a roof or a stair)
    // (inside a building's footprint or against its wall: the buildings are drawn from the solids that keep one out)
    if (nav.buildingId(x, y) >= 0 || nav.col.overlap(x, y, 0.8, f.z + 0.3, f.z + 1.7, pi => nav.col.tagOf(pi) !== nav.BUILDING)) continue;
    const w = nav.walk(x, y, f.z, true), post = nav.posts ? nav.posts.pushOut(x, y, 0.2, f.z).hit : false;
    const blocked = (!w.ok && w.why === 'wall') || post;
    if (blocked && !post && !seenNear(i, j, 2)) unseen.push([x, y, 'wall']); // (a post may be someone standing: the people are not read)
    // (not beside a lamp post or a trunk, whose cell a walker's own cell shares, and only where a walker can get to)
    if (!blocked && w.ok && reach[k] && lo[k] < 0.6 && hi[k] > 1.0 && nav.walk(x, y, f.z).ok && !(nav.posts && nav.posts.pushOut(x, y, 0.6, f.z).hit)) through.push([x, y, names[who[k]]]);
    if (w.ok && top[k] > -Infinity && lo[k] === Infinity) floors.push(f.z - ground[k] - top[k]);
  }
  // where the crowd walks, nothing stands: every mapped footway inside the zone, each half metre of it
  const barred = [], net = g.crowdNet || g.footNet, tmp = {};
  if (net && net.L) for (let li = 0; li < net.L.length; li++) {
    const len = net.L[li].len;
    for (let d = 0; d <= len; d += 0.5) {
      net.at(li, d, tmp);
      if (Math.hypot(tmp.x - at[0], tmp.y - at[1]) > r) continue;
      const f = nav.floorAt(tmp.x, tmp.y, tmp.z + 0.6);
      if (!f || Math.abs(f.z - tmp.z) > 0.6) continue;
      const w = nav.walk(tmp.x, tmp.y, f.z);
      const ph = nav.posts ? nav.posts.pushOut(tmp.x, tmp.y, 0.1, f.z).hit : null;
      if ((!w.ok && w.why === 'wall') || ph) {
        // what it is: the post's kind, or the mesh drawn nearest there between the shin and the head
        let what = ph && w.ok ? `post: ${ph.kind}` : 'wall';
        if (what === 'wall') {
          const ci = Math.floor((tmp.x - x0) / CELL), cj = Math.floor((tmp.y - y0) / CELL);
          for (let R = 0; R <= 2 && what === 'wall'; R++) for (let dj = -R; dj <= R && what === 'wall'; dj++) for (let di = -R; di <= R; di++) {
            const ii = ci + di, jj = cj + dj;
            if (ii >= 0 && jj >= 0 && ii < n && jj < n && hi[jj * n + ii] > -Infinity) { what = `wall: ${names[who[jj * n + ii]]}`; break; }
          }
        }
        const lp = net.L[li].pts, ln = lp.length;
        barred.push([tmp.x, tmp.y, `${what}; on the line ${lp[0].toFixed(1)}, ${lp[1].toFixed(1)} to ${lp[ln - 3].toFixed(1)}, ${lp[ln - 2].toFixed(1)}, ${d.toFixed(1)} m along its ${len.toFixed(1)}`]);
      }
    }
  }
  // clusters: cells within a metre of one another
  const cluster = L => {
    const out = [], left = L.slice();
    while (left.length) {
      const grp = [left.pop()];
      for (let q = 0; q < grp.length; q++) for (let s = left.length - 1; s >= 0; s--) if (Math.abs(left[s][0] - grp[q][0]) <= 1 && Math.abs(left[s][1] - grp[q][1]) <= 1) grp.push(left.splice(s, 1)[0]);
      const mx = grp.reduce((t, p) => t + p[0], 0) / grp.length, my = grp.reduce((t, p) => t + p[1], 0) / grp.length;
      const cnt = {};
      for (const q of grp) cnt[q[2]] = (cnt[q[2]] || 0) + 1;
      out.push({ at: [+mx.toFixed(1), +my.toFixed(1)], cells: grp.length, kind: Object.keys(cnt).sort((u, v) => cnt[v] - cnt[u])[0] });
    }
    return out.sort((p, q) => q.cells - p.cells);
  };
  floors.sort((p, q) => p - q);
  const pc = q => (floors.length ? +(floors[Math.floor(q * (floors.length - 1))] * 100).toFixed(1) : null);
  return { meshes, tris, unseen: cluster(unseen), through: cluster(through), barred: cluster(barred), floor_cm: { n: floors.length, p02: pc(0.02), p50: pc(0.5), p98: pc(0.98) } };
}

(async () => {
  let b, p;
  if (process.env.CDP) { b = await chromium.connectOverCDP(process.env.CDP); p = b.contexts()[0].pages()[0]; } else {
    b = await chromium.launch(process.env.DISPLAY
      ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
      : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    p = await b.newPage({ viewport: { width: 960, height: 600 } });
    await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 900000 });
    await startPlay(p, { asIs: true });
    await p.waitForTimeout(1500);
    await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); if (g.settleArrival) try { g.settleArrival(); } catch (e) { /* no arrival */ } });
  }
  const zones = ax != null ? [{ id: 'point', at: [+ax, +ay], r: +(ar || 60) }]
    : await p.evaluate(() => (window.__game.G && window.__game.G.hero ? window.__game.G.hero : []).map(h => ({ id: h.id, at: h.at, r: Math.min(h.r, 110) })));
  if (!zones.length) { console.log(`${city}: no hero level; give a point: unseen_walls.js ${city} x y r`); await b.close(); process.exit(2); }
  let bad = 0;
  for (const z of zones) {
    // stand in it, so that it is loaded and shown, and the nav's fine cells round it are laid
    await p.evaluate(async z => {
      const g = window.__game;
      g.player.x = z.at[0]; g.player.y = z.at[1]; g.player.z = g.nav.terrain(z.at[0], z.at[1]);
      g.advance(2);
      if (g.nav.layAll) try { await g.nav.layAll(); } catch (e) { /* laid as walked */ }
      // the people leave the picture: the crowd is drawn, and read as something standing where a walker can
      if (g.crowdAuto) g.crowdAuto(false);
      if (g.crowd) { g.crowd.active = 0; g.advance(0.2); }
      if (g.hero && g.hero()) for (let i = 0; i < 1200; i++) { await new Promise(r => requestAnimationFrame(r)); if (i > 3 && !g.hero().state().some(h => h.state === 'loading')) break; }
    }, z);
    const R = await p.evaluate(audit, z);
    console.log(`${city} ${z.id}: ${R.meshes} meshes, ${R.tris} triangles near the ground within ${z.r} m of ${z.at}`);
    console.log(`  floor over the ground drawn, cm: median ${R.floor_cm.p50}, 2% ${R.floor_cm.p02}, 98% ${R.floor_cm.p98} (${R.floor_cm.n} cells)`);
    const big = R.unseen.filter(u => u.cells >= 3);
    bad += big.length;
    console.log(`  unseen walls: ${big.length}${R.unseen.length > big.length ? ` (and ${R.unseen.length - big.length} of one or two cells)` : ''}`);
    for (const u of big.slice(0, 40)) console.log(`    at ${u.at}: ${u.cells} cells (${u.kind})`);
    bad += R.barred.filter(u => /^wall/.test(u.kind)).length; // (a post on a line is walked round)
    console.log(`  footways barred (something solid stands on a line the crowd walks): ${R.barred.length}`);
    for (const u of R.barred.slice(0, 40)) console.log(`    at ${u.at}: ${u.cells} samples (${u.kind})`);
    const thr = R.through.filter(u => u.cells >= 3);
    console.log(`  walked through: ${thr.length}`);
    for (const u of thr.slice(0, 60)) console.log(`    at ${u.at}: ${u.cells} cells (${u.kind})`);
  }
  if (!process.env.CDP) await b.close();
  process.exit(bad ? 1 : 0);
})();
