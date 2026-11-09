// Measure clipping in a city's game, headless: load it, let the traffic and the crowd run for a
// while with the player at the start, and count the things that pass through each other.
//   static:  lamp posts, trees and benches standing in a carriageway (the road as the game draws
//            it: each road line at its class's width), NPCs inside a building, a carriageway, a
//            post or a bench
//   running: with you on foot and a taxi hailed, then at the wheel of your car stopped in the
//            traffic's lane, then driving on: traffic cars inside each other, a lamp post or a tree
//            trunk, your car or a ride, or a building's wall; people inside a car, a post, a bench or
//            a wall (where the game lets nobody stand); NPCs inside a car; ferries inside each other
//            or over land; the helicopter on its pad
//   driven:  your car driven at a lamp post and at a tree, then stopped against the tree with
//            another car pressing in from behind, and you walked into a post: how far each gets into it
//   seated:  every crowd character (a ride's driver is one) in the driver's and the rear seats of
//            every car model: the top of the head under the roof
// Prints one line per measure and exits 1 when any is over its tolerance.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/clip_check.js sydney [seconds] [out.json]   # llvmpipe; without xvfb-run, SwiftShader
// GAME_TIME (HH:MM, or YYYY-MM-DDTHH:MM) pins the page's clock to that wall time in the city's own
// time zone (tools/pin_clock.js), as tools/check.sh does; unset or "live", the real clock
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const fs = require('fs');
const [,, city = 'sydney', secs = '60', outFile = ''] = process.argv;

// tolerances: how deep (m) counts as clipping, and how many such samples a run may have
const TOL = {
  props: { deep: 0.05, n: 0 },     // street furniture inside a carriageway
  npcs: { deep: 0.05, n: 0 },      // NPCs inside a building, a carriageway, a post or a bench
  carCar: { deep: 0.2, n: 10 },    // traffic cars inside each other (sample pairs: two caught part within 4 s, actors.js)
  carPost: { deep: 0.05, n: 0 },   // traffic cars inside a post or trunk
  carMine: { deep: 0.1, n: 0 },    // traffic inside your car
  carRide: { deep: 0.1, n: 0 },    // traffic inside a ride (noted: the ride's driver, cars.js chauffeur, is not taught to avoid it here)
  carWall: { deep: 0.6, n: 4 },    // traffic cars inside a building's wall (noted: a building modelled solid over a road)
  people: { deep: 0.1, n: 6 },     // walkers inside a car (sample walker-cars)
  peoplePost: { deep: 0.05, n: 4 },// walkers inside a post, trunk or bench
  peopleWall: { deep: 0.1, n: 6, rate: 0.002 }, // walkers inside a building wall (or 1 sample in 500)
  npcCar: { deep: 0.1, n: 0 },     // traffic inside an NPC
  ferry: { deep: 1.0, n: 0 },      // ferries inside each other
  drive: { deep: 0.05, n: 0 },     // your car driven into a post or trunk
  walk: { deep: 0.05, n: 0 },      // you walked into a post
};

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const pinned = await pinClock(p, city); // (GAME_TIME)
  if (pinned) console.log(`clock pinned to ${pinned.spec} in ${pinned.tz} (${pinned.utc})`);
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady()); // (the cars' near models and your car come after the game opens, issue 335)
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  // the numbers need no pictures: stop drawing frames, so the simulation runs as fast as it can
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.advance(1); });
  console.log(`${city}: loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // ------------------------------------------------------------ helpers, in the page
  await p.evaluate(() => {
    const g = window.__game, G = g.G, ROADW = OECars.ROADW, LEVEL = 3, LANE = OECars.LANE;
    const H = window.__clip = { worst: {} };
    // the carriageways: each road line's pieces at half its drawn width, through a grid of 16 m cells
    const segs = [], grid = new Map(), GC = 16;
    for (const r of G.paths.road) {
      const q = r.p, hw = (r.cw || ROADW[r.c] || 7) / 2; // (a bank lane drawn narrower than its class: game.json cw)
      for (let k = 3; k < q.length; k += 3) {
        const s = { ax: q[k - 3] / 10, ay: q[k - 2] / 10, az: q[k - 1] / 10, bx: q[k] / 10, by: q[k + 1] / 10, bz: q[k + 2] / 10, hw };
        const i = segs.push(s) - 1;
        for (let cx = Math.floor((Math.min(s.ax, s.bx) - hw) / GC); cx <= Math.floor((Math.max(s.ax, s.bx) + hw) / GC); cx++)
          for (let cy = Math.floor((Math.min(s.ay, s.by) - hw) / GC); cy <= Math.floor((Math.max(s.ay, s.by) + hw) / GC); cy++) {
            const k2 = cx * 100003 + cy;
            if (!grid.has(k2)) grid.set(k2, []);
            grid.get(k2).push(i);
          }
      }
    }
    // how far a circle (x, y, radius r, feet at z) reaches into a carriageway, and how near a road's line it is
    H.road = (x, y, z, r = 0) => {
      let deep = 0, centre = Infinity;
      for (const i of grid.get(Math.floor(x / GC) * 100003 + Math.floor(y / GC)) || []) {
        const s = segs[i], ex = s.bx - s.ax, ey = s.by - s.ay, L2 = ex * ex + ey * ey;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / L2)) : 0;
        if (Math.abs(s.az + (s.bz - s.az) * t - z) >= LEVEL) continue;
        const d = Math.hypot(x - s.ax - ex * t, y - s.ay - ey * t);
        deep = Math.max(deep, s.hw + r - d); centre = Math.min(centre, d);
      }
      return { deep, centre };
    };
    // the solid street furniture: lamp posts the game draws (its own and night.js's), trunks, benches
    const posts = [];
    const lamps = (G.props || {}).street_lamp || [];
    for (let i = 0; i + 2 < lamps.length; i += 3) posts.push({ x: lamps[i] / 10, y: lamps[i + 1] / 10, z: lamps[i + 2] / 10, r: 0.1, kind: 'lamp' });
    const np = g.Wd.night && g.Wd.night.poles ? g.Wd.night.poles : [];
    for (let i = 0; i + 2 < np.length; i += 3) posts.push({ x: np[i], y: np[i + 1], z: np[i + 2], r: 0.1, kind: 'pole' });
    const tr = g.Wd.trees && g.Wd.trees.trunks ? g.Wd.trees.trunks() : [];
    for (let i = 0; i + 3 < tr.length; i += 4) posts.push({ x: tr[i], y: tr[i + 1], z: tr[i + 2], r: tr[i + 3], kind: 'tree' });
    H.posts = posts;
    const pgrid = new Map(), PC = 8;
    posts.forEach((q, i) => { const k = Math.floor(q.x / PC) * 100003 + Math.floor(q.y / PC); if (!pgrid.has(k)) pgrid.set(k, []); pgrid.get(k).push(i); });
    H.postsNear = (x, y, r, fn) => {
      for (let cx = Math.floor((x - r) / PC); cx <= Math.floor((x + r) / PC); cx++) for (let cy = Math.floor((y - r) / PC); cy <= Math.floor((y + r) / PC); cy++)
        for (const i of pgrid.get(cx * 100003 + cy) || []) fn(posts[i]);
    };
    H.benches = g.benches.list;
    // an oriented box: { x, y, z, h (heading, clockwise from north), hl (half length), hw (half width) }
    const axes = o => [[Math.sin(o.h), Math.cos(o.h)], [-Math.cos(o.h), Math.sin(o.h)]];
    // how deep two boxes overlap (separating axes), 0 when apart
    H.boxBox = (a, b) => {
      let deep = Infinity;
      const A = axes(a), B = axes(b), dx = b.x - a.x, dy = b.y - a.y;
      for (const [ux, uy] of [...A, ...B]) {
        const ra = a.hl * Math.abs(A[0][0] * ux + A[0][1] * uy) + a.hw * Math.abs(A[1][0] * ux + A[1][1] * uy);
        const rb = b.hl * Math.abs(B[0][0] * ux + B[0][1] * uy) + b.hw * Math.abs(B[1][0] * ux + B[1][1] * uy);
        const o = ra + rb - Math.abs(dx * ux + dy * uy);
        if (o <= 0) return 0;
        deep = Math.min(deep, o);
      }
      return deep;
    };
    // how deep a circle (x, y, r) is in a box, 0 when clear
    H.boxCircle = (o, x, y, r) => {
      const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, u = dx * fx + dy * fy, w = -dx * fy + dy * fx;
      const cu = Math.max(-o.hl, Math.min(o.hl, u)), cw = Math.max(-o.hw, Math.min(o.hw, w));
      if (Math.abs(u) <= o.hl && Math.abs(w) <= o.hw) return r + Math.min(o.hl - Math.abs(u), o.hw - Math.abs(w));
      return Math.max(0, r - Math.hypot(u - cu, w - cw));
    };
    // a ferry's hull, length and beam, from its meshes (+z is its length)
    H.hull = v => {
      if (v.len && v.beam) return { l: v.len, b: v.beam }; // the game's own (vehicles.json, at the city's length)
      if (v.hullSize) return v.hullSize;
      const r = v.g.rotation.clone(), q = v.g.position.clone(), bx = new THREE.Box3(), bb = new THREE.Box3();
      v.g.rotation.set(0, 0, 0); v.g.position.set(0, 0, 0); v.g.updateMatrixWorld(true);
      v.g.traverse(o => { if (o.isMesh && o.geometry && o.visible) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bx.union(bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } });
      v.g.rotation.copy(r); v.g.position.copy(q); v.g.updateMatrixWorld(true);
      return (v.hullSize = { l: bx.max.z - bx.min.z, b: bx.max.x - bx.min.x });
    };
    H.carBox = c => ({ x: c.x, y: c.y, z: c.z, h: c.h, hl: c.half, hw: c.hw || 0.9 });
    H.benchBox = bn => ({ x: bn.x, y: bn.y, z: bn.z, h: bn.h, hl: 0.22, hw: 0.85 });
    // inside a building's or a landmark's walls, at body height
    H.inWall = (x, y, z, r) => g.nav.col.overlap(x, y, r, z + 0.5, z + 1.6, (i, q) => q.tag === 1 && q.zhi <= z + 0.75);
    // keep the worst few of each kind, for looking at
    H.note = (kind, deep, at) => {
      const l = H.worst[kind] = H.worst[kind] || [];
      l.push(Object.assign({ deep: +deep.toFixed(2) }, at));
      l.sort((a, b2) => b2.deep - a.deep);
      if (l.length > 5) l.length = 5;
    };
  });

  // ------------------------------------------------------------ static: furniture and NPCs
  const stat = await p.evaluate(({ TOL }) => {
    const g = window.__game, H = window.__clip, out = { props: {}, lane: {}, npcs: 0 };
    for (const q of H.posts) {
      const r = H.road(q.x, q.y, q.z, q.r);
      if (r.deep > TOL.props.deep) { out.props[q.kind] = (out.props[q.kind] || 0) + 1; H.note(`${q.kind} in road`, r.deep, { x: +q.x.toFixed(1), y: +q.y.toFixed(1), z: +q.z.toFixed(1) }); }
      if (r.centre < 3.2 + q.r) out.lane[q.kind] = (out.lane[q.kind] || 0) + 1;
    }
    for (const bn of H.benches) {
      const r = H.road(bn.x, bn.y, bn.z, 0.5);
      if (r.deep > TOL.props.deep) { out.props.bench = (out.props.bench || 0) + 1; H.note('bench in road', r.deep, { x: +bn.x.toFixed(1), y: +bn.y.toFixed(1) }); }
      if (r.centre < 3.7) out.lane.bench = (out.lane.bench || 0) + 1;
    }
    for (const n of g.npcs) {
      let why = '';
      // (someone seated is in their chair, at their table: their head and shoulders, over the chair's back, are what
      // must be clear)
      if (H.inWall(n.x, n.y, n.z + (n.sit ? 0.6 : 0), 0.2)) why = 'in a wall';
      else if (H.road(n.x, n.y, n.z, 0.25).deep > TOL.npcs.deep) why = 'in a carriageway';
      H.postsNear(n.x, n.y, 2, q => { if (!why && Math.abs(q.z - n.z) < 2 && Math.hypot(q.x - n.x, q.y - n.y) < q.r + 0.25 - TOL.npcs.deep) why = `in a ${q.kind}`; });
      for (const bn of H.benches) if (!why && Math.abs(bn.z - n.z) < 1 && H.boxCircle(H.benchBox(bn), n.x, n.y, 0.25) > TOL.npcs.deep) why = 'in a bench';
      if (why) { out.npcs++; H.note('npc', 1, { id: n.id, why, x: +n.x.toFixed(1), y: +n.y.toFixed(1) }); }
    }
    out.counts = { posts: H.posts.length, lamps: H.posts.filter(q => q.kind === 'lamp').length, poles: H.posts.filter(q => q.kind === 'pole').length,
      trees: H.posts.filter(q => q.kind === 'tree').length, benches: H.benches.length, npcs: g.npcs.length };
    return out;
  }, { TOL });

  // ------------------------------------------------------------ running: traffic, the crowd, ferries
  // a taxi hailed at the start, to have a ride in the street with the traffic going round it
  await p.evaluate(() => {
    const g = window.__game, c = g.myCar && g.myCar();
    if (!c) return;
    const st = c.D.st, k = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x - Math.sin(st.h) * 12 - Math.cos(st.h) * 2.4 * k; g.player.y = st.y - Math.cos(st.h) * 12 + Math.sin(st.h) * 2.4 * k; g.player.z = st.z;
    g.advance(0.5);
    g.hail();
  });
  const total = +secs, chunk = 0.5;
  const run = { samples: 0, cars: 0, walkers: 0, carCar: 0, carCarPairs: 0, carPost: 0, carMine: 0, carRide: 0, people: 0, peoplePost: 0, peopleWall: 0, npcCar: 0, ferry: 0, ferryLand: 0, carWall: 0, heli: null, phases: {} };
  const pairs = new Set();
  // then, for a third of the time again, you at the wheel of your car stopped in the traffic's lane
  // of the street it was parked in, with the traffic queueing behind you and going round, and then
  // driving on along it
  const phases = [['on foot', total], ['stopped in the lane', total / 3], ['driving on', total / 6]];
  let walked = [];
  for (const [phase, secsOf] of phases) {
    // on foot still: you walked into a lamp post near the start
    if (phase === 'stopped in the lane') walked = await p.evaluate(({ TOL }) => {
      const g = window.__game, H = window.__clip, c = g.myCar && g.myCar(), out = [];
      const at = c ? c.D.st : g.player;
      const post = H.posts.filter(q => q.kind !== 'tree' && Math.hypot(q.x - at.x, q.y - at.y) < 300 && g.nav.walk(q.x - 2.5, q.y, q.z).ok && !g.nav.col.overlap(q.x - 1.2, q.y, 0.4, q.z + 0.4, q.z + 1.8))
        .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
      if (!post || g.player.mode !== 'foot') return out;
      g.player.x = post.x - 2.5; g.player.y = post.y; g.player.z = g.nav.walk(post.x - 2.5, post.y, post.z).z; g.cam.yaw = Math.PI / 2;
      let deep = 0;
      for (let k = 0; k < 20; k++) { g.advance(0.1, ['KeyW']); deep = Math.max(deep, post.r + 0.3 - Math.hypot(g.player.x - post.x, g.player.y - post.y)); }
      out.push({ what: `walked into a ${post.kind}`, deep: +deep.toFixed(2), x: +post.x.toFixed(1), y: +post.y.toFixed(1) });
      if (deep > TOL.walk.deep) H.note(`walked into a ${post.kind}`, deep, { x: +post.x.toFixed(1), y: +post.y.toFixed(1) });
      return out;
    }, { TOL });
    if (phase === 'stopped in the lane') await p.evaluate(() => {
      const g = window.__game, c = g.myCar && g.myCar();
      if (!c) return;
      if (g.ride()) g.cancelRide();
      g.enterCar();
      for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
      const st = c.D.st, pl = g.roads.place(st.x, st.y, 30, g.KEEP === 'left' ? 1 : -1, st.z);
      if (!pl) return;
      const q = {}, k = OECars.LANE * (g.KEEP === 'left' ? 1 : -1), L = g.roadNet.L[pl.line].len;
      for (const d of [0, 8, -8, 16, -16, 24, -24, 32, -32]) { // (where no traffic car is: you can't drive into the lane through one)
        g.roadNet.at(pl.line, Math.max(2, Math.min(L - 2, pl.s + d)), q);
        const hx = q.hx * pl.dir, hy = q.hy * pl.dir, x = q.x - hy * k, y = q.y + hx * k, h = Math.atan2(hx, hy);
        if (g.cars.footprint(x, y, q.z, h, c.C.half, c.C.hw, 0.5) > 0) continue;
        Object.assign(st, { x, y, z: q.z, h, vx: 0, vy: 0, v: 0, speed: 0, r: 0 });
        break;
      }
    });
    const keys = phase === 'driving on' ? ['KeyW'] : [];
    let carCar0 = run.carCar, carMine0 = run.carMine;
  for (let t = 0; t < secsOf; t += chunk) {
    const r = await p.evaluate(({ chunk, TOL, keys }) => {
      const g = window.__game, H = window.__clip, LEVEL = 3;
      g.advance(chunk, keys);
      const C = g.cars.C.slice(0, g.cars.active).filter(c => c.line >= 0), o = { cars: C.length, walkers: 0, carCar: 0, pairs: [], carPost: 0, carMine: 0, carRide: 0, people: 0, peoplePost: 0, peopleWall: 0, npcCar: 0, ferry: 0, ferryLand: 0, carWall: 0 };
      const boxes = C.map(H.carBox);
      // cars inside each other
      const cell = new Map();
      boxes.forEach((bx, i) => { const k = Math.floor(bx.x / 20) * 100003 + Math.floor(bx.y / 20); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); });
      boxes.forEach((a, i) => {
        for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) for (const j of cell.get((Math.floor(a.x / 20) + cx) * 100003 + Math.floor(a.y / 20) + cy) || []) {
          if (j <= i || Math.abs(boxes[j].z - a.z) >= LEVEL) continue;
          const d = H.boxBox(a, boxes[j]);
          if (d > TOL.carCar.deep) {
            o.carCar++; o.pairs.push(`${g.cars.C.indexOf(C[i])}-${g.cars.C.indexOf(C[j])}`);
            const A = C[i], B = C[j];
            H.note('car in car', d, { x: +A.x.toFixed(1), y: +A.y.toFixed(1), a: `${A.model || 'car'} line ${A.line} s ${A.s.toFixed(1)} dir ${A.dir} v ${A.v.toFixed(1)} off ${A.off.toFixed(2)} lo ${(A.lo || 0).toFixed(2)} ln ${A.ln} np ${A.np} ${A.why || ''}${A.mv ? ' in a junction' : ''}`,
              b: `${B.model || 'car'} line ${B.line} s ${B.s.toFixed(1)} dir ${B.dir} v ${B.v.toFixed(1)} off ${B.off.toFixed(2)} lo ${(B.lo || 0).toFixed(2)} ln ${B.ln} np ${B.np} ${B.why || ''}${B.mv ? ' in a junction' : ''}` });
          }
        }
        // a building's wall through it
        if (a.z - g.nav.terrain(a.x, a.y) < 2 && H.inWall(a.x, a.y, a.z, 0.6)) { o.carWall++; H.note('car in wall', 1, { x: +a.x.toFixed(1), y: +a.y.toFixed(1), car: `${C[i].model || 'car'} line ${C[i].line}` }); }
        // a lamp post or a trunk inside it
        H.postsNear(a.x, a.y, a.hl + 1, q => {
          if (Math.abs(q.z - a.z) >= LEVEL) return;
          const d = H.boxCircle(a, q.x, q.y, q.r);
          if (d > TOL.carPost.deep) { o.carPost++; H.note(`car in ${q.kind}`, d, { x: +q.x.toFixed(1), y: +q.y.toFixed(1), car: `${C[i].model || 'car'} line ${C[i].line} off ${C[i].off.toFixed(2)} v ${C[i].v.toFixed(1)}${C[i].mv ? ' in a junction' : ''}${C[i].postPass > 0 ? ' with leave past a post' : ''} ${C[i].why || ''}` }); }
        });
      });
      // your car and a ride
      const mine = [];
      if (g.myCar()) { const s = g.myCar().D.st, c = g.myCar().C; mine.push({ x: s.x, y: s.y, z: s.z, h: s.h, hl: c.half, hw: c.hw, what: 'your car' }); }
      if (g.ride()) { const s = g.ride().drv.st, c = g.ride().C; mine.push({ x: s.x, y: s.y, z: s.z, h: s.h, hl: c.half, hw: c.hw, what: 'the ride', v: s.v }); }
      for (const m of mine) boxes.forEach((a, i) => {
        if (Math.abs(a.z - m.z) >= LEVEL) return;
        const d = H.boxBox(a, m);
        if (d > TOL.carMine.deep) { o[m.what === 'your car' ? 'carMine' : 'carRide']++; H.note(`car in ${m.what}`, d, { x: +a.x.toFixed(1), y: +a.y.toFixed(1), car: `${C[i].model || 'car'} line ${C[i].line} v ${C[i].v.toFixed(1)} off ${C[i].off.toFixed(2)}` }); }
      });
      const allCars = boxes.concat(mine);
      // the crowd: inside a car, a post, a bench or a wall
      const P = g.crowd.P.slice(0, g.crowd.active);
      for (const q of P) {
        if (q.line < 0) continue;
        o.walkers++;
        for (const a of allCars) {
          if (Math.abs(a.z - q.z) >= 2 || Math.abs(a.x - q.x) > a.hl + 1 || Math.abs(a.y - q.y) > a.hl + 1) continue;
          const d = H.boxCircle(a, q.x, q.y, 0.2);
          if (d > TOL.people.deep) { o.people++; H.note('walker in car', d, { x: +q.x.toFixed(1), y: +q.y.toFixed(1), state: q.state, v: +(q.v || 0).toFixed(2), kerb: +(q.kw || 0).toFixed(1), line: q.line, car: a.what || 'traffic', carV: a.v != null ? +a.v.toFixed(2) : null, t: +g.t().toFixed(1) }); }
        }
        if (q.state === 'sit') continue;
        H.postsNear(q.x, q.y, 2, s => {
          if (Math.abs(s.z - q.z) >= 2) return;
          const d = s.r + 0.2 - Math.hypot(s.x - q.x, s.y - q.y);
          if (d > TOL.peoplePost.deep) { o.peoplePost++; H.note(`walker in ${s.kind}`, d, { x: +q.x.toFixed(1), y: +q.y.toFixed(1) }); }
        });
        if (q.state === 'walk') for (const bn of H.benches) {
          if (Math.abs(bn.x - q.x) > 2 || Math.abs(bn.y - q.y) > 2 || Math.abs(bn.z - q.z) > 1) continue;
          const d = H.boxCircle(H.benchBox(bn), q.x, q.y, 0.2);
          if (d > TOL.peoplePost.deep) { o.peoplePost++; H.note('walker in bench', d, { x: +q.x.toFixed(1), y: +q.y.toFixed(1) }); }
        }
        if (q.state === 'walk' && g.nav.solid(q.x, q.y, q.z, 0.2 - TOL.peopleWall.deep)) { o.peopleWall++; H.note('walker in wall', 1, { x: +q.x.toFixed(1), y: +q.y.toFixed(1), z: +q.z.toFixed(1) }); }
      }
      // NPCs in the traffic's way
      for (const n of g.npcs) for (const a of boxes) {
        if (Math.abs(a.z - n.z) >= 2 || Math.abs(a.x - n.x) > a.hl + 1 || Math.abs(a.y - n.y) > a.hl + 1) continue;
        const d = H.boxCircle(a, n.x, n.y, 0.25);
        if (d > TOL.npcCar.deep) { o.npcCar++; H.note('car in npc', d, { id: n.id, x: +n.x.toFixed(1), y: +n.y.toFixed(1) }); }
      }
      // ferries: inside each other, and their hulls over land (a bank, a pier's deck is fine alongside)
      const V = (g.fer && g.fer.vessels) || [];
      const fb = V.map(v => { const z = H.hull(v); return { x: v.x, y: v.y, h: v.h, hl: z.l / 2, hw: z.b / 2, v }; });
      for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
        const d = H.boxBox(fb[i], fb[j]);
        if (d > TOL.ferry.deep) { o.ferry++; H.note('ferry in ferry', d, { x: +fb[i].x.toFixed(0), y: +fb[i].y.toFixed(0), a: fb[i].v.name, b: fb[j].v.name, phase: `${fb[i].v.phase}/${fb[j].v.phase}` }); }
      }
      for (const f of fb) {
        const fx = Math.sin(f.h), fy = Math.cos(f.h);
        let land = 0;
        for (let u = -0.9; u <= 0.9; u += 0.3) for (const w of [-0.8, 0, 0.8]) {
          const x = f.x + fx * u * f.hl - fy * w * f.hw, y = f.y + fy * u * f.hl + fx * w * f.hw;
          if (!g.nav.isWater(x, y) && g.nav.terrain(x, y) > 0.3) land++;
        }
        if (land > 2) { o.ferryLand++; H.note('ferry over land', land, { x: +f.x.toFixed(0), y: +f.y.toFixed(0), name: f.v.name, phase: f.v.phase }); }
      }
      return o;
    }, { chunk, TOL, keys });
    run.samples++; run.cars += r.cars; run.walkers += r.walkers;
    for (const k of ['carCar', 'carPost', 'carMine', 'carRide', 'people', 'peoplePost', 'peopleWall', 'npcCar', 'ferry', 'ferryLand', 'carWall']) run[k] += r[k];
    for (const q of r.pairs) pairs.add(q);
  }
    run.phases[phase] = { carCar: run.carCar - carCar0, carMine: run.carMine - carMine0 };
  }
  run.carCarPairs = pairs.size;

  // ------------------------------------------------------------ the helicopter on its pad
  run.heli = await p.evaluate(() => {
    const g = window.__game, h = g.heli;
    if (!h) return null;
    const st = h.st, below = g.nav.groundBelow(st.x, st.y, st.z + 0.5);
    return { gap: +(st.z - below).toFixed(2), rotor: g.nav.col.overlap(st.x, st.y, 5, st.z + 2.6, st.z + 3.4) };
  });

  // ------------------------------------------------------------ driven: your car at a post and a tree, you into a post
  const drive = await p.evaluate(({ TOL }) => {
    const g = window.__game, H = window.__clip, c = g.myCar && g.myCar(), out = [];
    if (!c) return out;
    if (g.ride()) g.cancelRide();
    const st = c.D.st, home = { x: st.x, y: st.y, z: st.z, h: st.h };
    // the nearest few posts and trunks a car could reach: on open ground beside a road, with 14 m of room to run up
    const cand = H.posts.filter(q => Math.hypot(q.x - home.x, q.y - home.y) < 400 && Math.abs(q.z - home.z) < 3).sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
    const tried = {};
    let pressed = null;
    g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    if (g.player.mode !== 'car') return [{ what: 'could not get in' }];
    for (const q of cand) {
      const kind = q.kind === 'tree' ? 'tree' : 'post';
      if ((tried[kind] || 0) >= 2) continue;
      const near = g.roads.place(q.x, q.y, 9, 1, q.z);
      if (!near) continue;
      // run up at it square on: from the road's side, or along the kerb either way
      const ux = q.x - near.x, uy = q.y - near.y, L = Math.hypot(ux, uy), h0 = L > 0.5 ? Math.atan2(ux, uy) : 0;
      let h = null, sx = 0, sy = 0, f = null;
      for (const hh of [h0, h0 + Math.PI / 2, h0 - Math.PI / 2]) {
        const x0 = q.x - Math.sin(hh) * 12, y0 = q.y - Math.cos(hh) * 12, f0 = g.nav.floorAt(x0, y0, q.z + 1);
        if (!f0 || Math.abs(f0.z - q.z) > 1) continue;
        let clearRun = true;
        for (let k = 0; k <= 10 && clearRun; k++) { const x = q.x - Math.sin(hh) * (12 - k), y = q.y - Math.cos(hh) * (12 - k); if (H.inWall(x, y, q.z, 1.1)) clearRun = false; }
        H.postsNear(q.x - Math.sin(hh) * 6, q.y - Math.cos(hh) * 6, 6, o => { if (o !== q && H.boxCircle({ x: q.x - Math.sin(hh) * 6.5, y: q.y - Math.cos(hh) * 6.5, h: hh, hl: 6, hw: 1.2 }, o.x, o.y, o.r) > 0) clearRun = false; });
        if (clearRun) { h = hh; sx = x0; sy = y0; f = f0; break; }
      }
      if (h == null) continue;
      tried[kind] = (tried[kind] || 0) + 1;
      Object.assign(st, { x: sx, y: sy, z: f.z, h, vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false });
      let deep = 0, top = 0;
      for (let k = 0; k < 40; k++) {
        g.advance(0.1, ['KeyW']);
        top = Math.max(top, st.speed);
        deep = Math.max(deep, H.boxCircle({ x: st.x, y: st.y, h: st.h, hl: c.C.half, hw: c.C.hw }, q.x, q.y, q.r));
      }
      out.push({ what: `car at a ${q.kind}`, deep: +deep.toFixed(2), kmh: Math.round(top * 3.6), x: +q.x.toFixed(1), y: +q.y.toFixed(1) });
      if (deep > TOL.drive.deep) H.note(`drove into a ${q.kind}`, deep, { x: +q.x.toFixed(1), y: +q.y.toFixed(1) });
      if (q.kind === 'tree' && !pressed) pressed = { q, h, z: f.z };
      if (tried.tree >= 2 && tried.post >= 2) break;
    }
    // nose to the first trunk, another car's box creeping into yours from behind (square,
    // and angled, across its width): yours may go round the trunk but never into it (a traffic car
    // swinging round you pushed it 0.87 m into one in Sydney, #96)
    if (pressed) {
      const C = c.C, fx = Math.sin(pressed.h), fy = Math.cos(pressed.h), gap = C.half + pressed.q.r + 0.02;
      const x = pressed.q.x - fx * gap, y = pressed.q.y - fy * gap, fl = g.nav.floorAt(x, y, pressed.q.z + 1);
      const q = { q: pressed.q, h: pressed.h, z: fl ? fl.z : pressed.z, x, y }; // (nose to the trunk, on the run-up's heading, on the floor there)
      let deep = 0;
      for (const side of [-1.2, -0.6, 0, 0.6, 1.2]) for (const ang of [0, 0.3, -0.3]) {
        Object.assign(st, { x: q.x, y: q.y, z: q.z, h: q.h, vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false });
        const near = [];
        g.posts.near(q.x, q.y, 10, o => near.push(o)); // (the game's own posts, as your car meets them)
        for (let k = 0; k < 120; k++) {
          const back = -(C.half + 2.2) + 0.015 * k;
          const box = { x: q.x + fx * back - fy * side, y: q.y + fy * back + fx * side, z: q.z, h: q.h + ang, hl: 2.2, hw: 0.9, top: 1.5 };
          c.D.step(1 / 30, { fwd: 0, turn: 0 }, { boxes: [box], people: [], posts: near }, []);
          deep = Math.max(deep, H.boxCircle({ x: st.x, y: st.y, h: st.h, hl: C.half, hw: C.hw }, q.q.x, q.q.y, q.q.r));
        }
      }
      out.push({ what: 'car pushed at a tree', deep: +deep.toFixed(2), kmh: null, x: +q.q.x.toFixed(1), y: +q.q.y.toFixed(1) });
      if (deep > TOL.drive.deep) H.note('pushed into a tree', deep, { x: +q.q.x.toFixed(1), y: +q.q.y.toFixed(1) });
    }
    Object.assign(st, home, { vx: 0, vy: 0, v: 0, speed: 0, r: 0 });
    g.advance(0.2);
    return out;
  }, { TOL });
  drive.unshift(...walked);
  // ------------------------------------------------------------ seated: every crowd character in every car's seats
  // (a ride's driver is one of the crowd's characters; you and a passenger sit in the back): the
  // head under the roof, with the character as tall as a look makes it
  const seats = await p.evaluate(async () => {
    const g = window.__game, lib = g.peopleLib, vlib = g.vlib, out = { n: 0, worst: [], fails: 0 };
    if (!lib || !vlib || !vlib.cars) return out;
    const M = vlib.info.cars.models, names = Object.keys(lib.info.characters);
    const models = Object.keys(M).filter(k => M[k].seats);
    const cars = models.map(k => OECars.car(g.Wd.world, vlib, k, { keep: g.KEEP }));
    cars.forEach((c, i) => c.place(i * 8, -5000, 0, 0));
    // how far the top of the figure (the vertices of its top 8 cm, as posed and skinned, and a hat)
    // is under the car's roof: the least distance up to the shell over any of them, or, for one
    // with no roof over it, minus its height over the roof
    const ray = new THREE.Raycaster(), v = new THREE.Vector3(), w = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0), dnV = new THREE.Vector3(0, -1, 0);
    const shells = cars.map(c => c.body.children.filter(o => o.isMesh).map(m => { // (with bounds trees, for fast rays; these cars are thrown away after)
      m.geometry.boundsTree = new THREE.MeshBVH(m.geometry);
      m.raycast = THREE.acceleratedRaycast;
      return m;
    }));
    const topOf = (c, rig) => { // the top 8 cm of the seated figure, in its root's frame (the same in every seat)
      c.group.updateMatrixWorld(true); // (a skinned mesh's bind matrix follows only through updateMatrixWorld)
      const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert(), pts = [];
      rig.model.traverse(o => {
        if (!o.isMesh || !o.visible) return;
        const P = o.geometry.attributes.position;
        for (let i = 0; i < P.count; i++) {
          if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(P, i);
          v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          pts.push(v.clone());
        }
      });
      const top = Math.max(...pts.map(q => q.y)), crown = pts.filter(q => q.y > top - 0.08);
      return crown.filter((q, i) => i % Math.max(1, Math.floor(crown.length / 60)) === 0);
    };
    const underRoof = (ci, rig, crown) => {
      const c = cars[ci], shell = shells[ci];
      c.group.updateMatrixWorld(true);
      rig.root.updateWorldMatrix(true, false);
      let least = Infinity;
      for (const q of crown) {
        v.copy(q).applyMatrix4(rig.root.matrixWorld);
        ray.set(v, upV); ray.far = 1.5;
        const h = ray.intersectObjects(shell, false)[0];
        if (h) { least = Math.min(least, h.distance); continue; }
        ray.set(w.copy(v).add(upV).add(upV), dnV); ray.far = 4;
        const d = ray.intersectObjects(shell, false)[0];
        least = Math.min(least, d ? Math.min(0, d.point.y - v.y) : -1);
      }
      return least;
    };
    for (const name of names) {
      try { await lib.require(name); } catch (e) { continue; }
      for (const scale of [null, 1.05]) {
        const look = OEPeople.randomLook(lib, name);
        if (scale) look.scale = scale;
        const rig = OEPeople.person(lib, look), crowns = [];
        // the head as it moves through a few seconds of the seated idle
        cars[0].sit(rig, 'driver');
        for (let k = 0; k < 8; k++) { rig.animate(k ? 0.6 : 0.1, 0, 'sit', k * 0.6); crowns.push(topOf(cars[0], rig)); }
        for (let ci = 0; ci < cars.length; ci++) for (const seat of ['driver', 'rear_left', 'rear_right']) {
          const c = cars[ci];
          if (!c.seats[seat]) continue;
          c.sit(rig, seat);
          const cl = Math.min(...crowns.map(crown => underRoof(ci, rig, crown)));
          c.body.remove(rig.root);
          if (cl == null) continue;
          out.n++;
          if (cl <= 0) out.fails++;
          out.worst.push({ cl: +cl.toFixed(3), who: name, scale: +(look.scale || 1).toFixed(2), car: c.name, seat });
        }
      }
    }
    out.worst.sort((a, b) => a.cl - b.cl);
    out.worst.length = Math.min(out.worst.length, 6);
    for (const c of cars) c.dispose();
    return out;
  });
  const worst = await p.evaluate(() => window.__clip.worst);

  // ------------------------------------------------------------ report
  const fails = [];
  const line = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const nProps = Object.values(stat.props).reduce((a, v) => a + v, 0);
  console.log(`furniture: ${stat.counts.lamps} mapped lamps, ${stat.counts.poles} street-light poles, ${stat.counts.trees} trees, ${stat.counts.benches} benches; ${stat.counts.npcs} NPCs`);
  line(nProps <= TOL.props.n, `furniture in a carriageway: ${nProps} (${JSON.stringify(stat.props)}); within a lane's reach of a road's line: ${JSON.stringify(stat.lane)}`);
  line(stat.npcs <= TOL.npcs.n, `NPCs inside a wall, a carriageway, a post or a bench: ${stat.npcs}`);
  console.log(`ran ${total} s: ${run.samples} samples, ${(run.cars / run.samples).toFixed(0)} cars and ${(run.walkers / run.samples).toFixed(0)} walkers on average`);
  line(run.carCar <= TOL.carCar.n, `traffic cars inside each other: ${run.carCar} sampled pairs (${run.carCarPairs} distinct); by phase ${JSON.stringify(run.phases)}`);
  line(run.carPost <= TOL.carPost.n, `traffic cars inside a lamp post or a trunk: ${run.carPost}`);
  console.log(`${run.carWall > TOL.carWall.n ? 'note' : 'ok  '} traffic cars inside a building's wall: ${run.carWall} (a building modelled solid over a road: the data, not the traffic)`);
  line(run.carMine <= TOL.carMine.n, `traffic inside your car: ${run.carMine}`);
  console.log(`${run.carRide > TOL.carRide.n ? 'note' : 'ok  '} traffic inside a ride: ${run.carRide} (the ride's own driving, cars.js chauffeur, is not covered by this check)`);
  line(run.people <= TOL.people.n, `walkers inside a car: ${run.people}`);
  line(run.peoplePost <= TOL.peoplePost.n, `walkers inside a post, a trunk or a bench: ${run.peoplePost}`);
  line(run.peopleWall <= Math.max(TOL.peopleWall.n, run.walkers * TOL.peopleWall.rate), `walkers inside a building's wall: ${run.peopleWall} of ${run.walkers} walker samples`);
  line(run.npcCar <= TOL.npcCar.n, `traffic inside an NPC: ${run.npcCar}`);
  line(run.ferry <= TOL.ferry.n, `ferries inside each other: ${run.ferry}`);
  console.log(`     ferries with their hull over land: ${run.ferryLand} samples`);
  if (run.heli) line(Math.abs(run.heli.gap) < 0.05 && !run.heli.rotor, `helicopter on its pad: ${run.heli.gap} m over the floor${run.heli.rotor ? ', rotor in a wall' : ''}`);
  for (const d of drive) line(d.deep == null || d.deep <= TOL[d.what.startsWith('walk') ? 'walk' : 'drive'].deep, `${d.what}${d.deep == null ? '' : `: ${d.deep} m into it${d.kmh != null ? ` at ${d.kmh} km/h` : ''} (${d.x}, ${d.y})`}`);
  if (!drive.length) console.log('     no post or trunk near enough to drive at');
  if (seats.n) line(!seats.fails, `seated heads under the roof: ${seats.n - seats.fails} of ${seats.n} (every crowd character, driver and rear seats); lowest: ${seats.worst.slice(0, 3).map(q => `${q.who} ${q.scale} in a ${q.car} ${q.seat} ${q.cl} m`).join(', ')}`);
  for (const [k, l] of Object.entries(worst)) console.log(`     worst ${k}: ${l.map(q => JSON.stringify(q)).join(' ')}`);
  line(!logs.length, `no page errors${logs.length ? `: ${logs.slice(0, 3).join(' | ')}` : ''}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ city, stat, run, drive, seats, worst, fails }, null, 1));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
