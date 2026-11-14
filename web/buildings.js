// Open Earth 3D buildings: the walls, LOD2 roofs, facades and rooftops of a city from
// buildings.json, as one mesh that the model viewer and the game share (raycasts read its
// bid attribute), plus instanced rooftop plant.
//
// The pipeline writes, per building, a facade style, storey and ground-floor heights and a
// seed; per solid a roof mesh (pitched roofs) and the street frontages that get shopfronts
// and awnings (typology.py, roofs.py). Here every wall run between sharp corners gets a
// whole number of window bays, floors follow the storey height, and the fragment shader
// draws the facade: windows with frames and sills, curtain-wall mullions and spandrels,
// shopfronts, glass that reflects the sky and shows a room behind it (interior mapping),
// and lights at night on an occupancy schedule for the building type and the local hour.
// Walls are darkened by a sky-openness term baked from a 4 m surface model (street
// canyons), flat roofs get parapets and the aerial photo, pitched roofs tile or metal.
// buildings.json files written before these fields existed get styles from class and height.
// Works with three.js r128 and later (WebGL1 or 2; dynamic uniform indexing stays in the
// vertex shader).
'use strict';
window.OEBuildings = (function () {
  // the shared part (buildings-geo.js): the walls, roofs and decks as vertex arrays, built in a Worker where
  // there is one (pack-worker.js, issue 344), and the styles' constants the facade shader reads
  const GEO = window.OEBuildingsGeo;
  const { canopyPosts, POST, STYLES, GRID, LOOK, REGION_GRID, ROOF_MAT, hash1 } = GEO;

  // the options build() takes for a city's data D (world.js): the ground drawn under the walls, the solids not
  // drawn, the region's grids and every colour the rows name, through the page's lin()
  function geoOptions(D, { lin, SRC, small = false, cells = null }) {
    const scene = D.scene, colours = {};
    for (const h of GEO.colourNames(D.B)) { const c = lin(h); colours[h] = [c.r, c.g, c.b]; }
    return { T: D.T, Tfine: D.Tfine || null, frame: scene.frame, hidden: scene.hidden_solids || [], demolished: (D.LM && D.LM.demolished) || [],
      region: scene.city.architecture || (scene.city.country === 'Japan' ? 'japan' : ''),
      photoOK: !!(scene.ground && scene.ground.length), SRC, small, colours, cells };
  }
  // Starts building the walls' arrays as soon as the ground under them is final (world.js, before the aerial
  // imagery is draped), in the Worker that decoded buildings.bin and kept it (OEPack.buildIn); resolves with
  // the arrays, or null where there is no such Worker (create() then builds them here)
  // dsm: { T, frame } also makes that surface model there (Sun.buildDSM with ids; the game's, game.js), which
  // create() leaves in D.dsm
  function start(D, opt) {
    if (!window.OEPack || !OEPack.buildIn) return Promise.resolve(null);
    const o = geoOptions(D, opt), t0 = performance.now();
    if (opt.dsm) o.dsm = opt.dsm;
    const job = OEPack.buildIn('buildings', o).then(a => {
      if (a) console.info(`buildings: ${Math.round(a.ms)} ms in a worker${a.cells ? ` (${a.cells.length} cells round the player, ${a.n.toLocaleString()} vertices)` : ''}${a.dsm ? `, its surface model ${Math.round(a.dsmMs)} ms` : ''}, back after ${Math.round(performance.now() - t0)} ms`);
      return a;
    }, e => { console.warn('buildings: built on the page,', e.message || e); return null; });
    job.T = opt.dsm ? opt.dsm.T : null;
    job.opt = o; // (what the walls were built from: cells built again later take the same)
    return job;
  }

  // progress(f): how far the walls are, 0..1. Built here, the walls are raised in slices of about SLICE ms,
  // yielding between them, so the loader's frames keep coming (issue 299: one frame of 2.5 s in Shibuya).
  // job: start()'s promise. Resolves with the meshes
  const SLICE = 40, pause = () => new Promise(r => setTimeout(r, 0));
  // cells: { size, at, near, mid, tall } builds the map round the player (buildings-geo.js; a small device's game:
  // world.js): the walls come as a group of meshes, one a cell of the grid, each at the level of detail its
  // distance gives it, and what create() resolves with has `stream`: near(x, y) builds again the cells whose level
  // the player's new place changes (here, in slices: the Worker has let its copy of the data go) and swaps them in.
  // onCell(mesh, added) is called for each mesh put in the group or taken out of it.
  async function create(D, { lin, U, renderer, SRC, small = false, photoGrade = null, night = null, progress = null, pictures = null, job = null, cells = null, onCell = null }) {
    const t0 = performance.now();
    const { B, scene } = D;
    const region = scene.city.architecture || (scene.city.country === 'Japan' ? 'japan' : '');
    const GRIDS = Object.assign({}, GRID, REGION_GRID[region] || {});
    const meta = B.b, hidden = new Set(scene.hidden_solids || []), photoOK = !!(scene.ground && scene.ground.length);
    let A = job ? await job : null;
    if (!A) {
      const T3 = THREE.ShapeUtils;
      A = await GEO.build(B, Object.assign(geoOptions(D, { lin, SRC, small, cells }), { slice: SLICE, progress, triangulate: (c, h) => T3.triangulateShape(c, h) }));
    } else if (progress) progress(1);
    if (A.dsm) { const T = job.T; D.dsm = Object.assign(A.dsm, { ground: (x, y) => Math.max(0, window.Sun.terrainAt(T, x, y)) }); }
    const deckZ = new Map();
    for (let i = 0; i < A.deckSi.length; i++) deckZ.set(A.deckSi[i], A.deckZ[i]);

    await pause();
    const geometryOf = a => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3, true));
      g.setAttribute('color', new THREE.BufferAttribute(a.color, 3, true));
      g.setAttribute('fac', new THREE.BufferAttribute(a.fac, 2));
      g.setAttribute('inf', new THREE.BufferAttribute(a.inf, 4));
      g.setAttribute('ext', new THREE.BufferAttribute(a.ext, 3));
      g.setAttribute('bid', new THREE.BufferAttribute(a.bid, 1));
      g.setAttribute('srcCode', new THREE.BufferAttribute(a.srcCode, 1));
      g.setIndex(new THREE.BufferAttribute(a.index, 1));
      return g;
    };
    const geometry = A.cells ? null : geometryOf(A);
    if (geometry) geometry.computeBoundingSphere();

    // the share of homes lit by cool white ceiling lights rather than warm lamps: most in Japan and
    // Hong Kong, a few elsewhere (docs/NIGHT.md)
    const coolHomes = { JP: 0.55, HK: 0.6 }[scene.city.country_code] ?? 0.15;
    const material = facadeMaterial(U, renderer, GRIDS, scene.city.signage ?? (region === 'japan' ? 1 : 0), photoGrade, night, coolHomes);
    let mesh, stream = null;
    if (A.cells) {
      // the map round the player: a mesh a cell, swapped for another level's as the player moves
      mesh = new THREE.Group();
      mesh.name = 'buildings'; mesh.matrixAutoUpdate = false; mesh.material = material;
      const byId = new Map(), T3 = THREE.ShapeUtils, open = A.open || null, base = (job && job.opt) || geoOptions(D, { lin, SRC, small, cells });
      let lods = {}, at = cells.at.slice(), busy = null;
      const put = res => {
        for (const a of res.cells) {
          const old = byId.get(a.id);
          if (old) { mesh.remove(old); byId.delete(a.id); if (onCell) onCell(old, false); old.geometry.dispose(); }
          if (!a.n) continue;
          const g = geometryOf(a);
          g.computeBoundingBox();
          g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
          const m = new THREE.Mesh(g, material);
          m.castShadow = m.receiveShadow = true; m.name = 'buildings-cell'; m.userData.cell = a.id; m.userData.lod = a.lod;
          m.matrixAutoUpdate = false; m.updateMatrix();
          byId.set(a.id, m); mesh.add(m);
          if (onCell) onCell(m, true);
        }
        lods = res.lods;
        let v = 0, t = 0;
        for (const m of byId.values()) { v += m.geometry.attributes.position.count; t += m.geometry.index.count / 3; }
        Object.assign(stream, { vertices: v, triangles: t, builds: stream.builds + 1 });
      };
      stream = { cells: byId, grid: A.grid, vertices: 0, triangles: 0, builds: 0, ms: 0, get at() { return at; }, get lods() { return lods; },
        // the player is at x, y: once that is `step` metres from where the cells were last built round, the cells
        // whose level it changes are built again. Resolves when they are in (null: nothing to do, or one under way)
        near(x, y, step = cells.step || 100) {
          if (busy || Math.hypot(x - at[0], y - at[1]) < step) return null;
          at = [x, y];
          const t1 = performance.now();
          busy = GEO.build(B, Object.assign({}, base, { cells: Object.assign({}, cells, { at, have: lods }), dsm: null, open, slice: 6, triangulate: (c, h) => T3.triangulateShape(c, h) }))
            .then(res => { put(res); stream.ms = performance.now() - t1; mesh.updateMatrixWorld(true); return res.cells.length; })
            .catch(e => { console.warn('buildings: cells not built again,', e); return 0; })
            .finally(() => { busy = null; });
          return busy;
        } };
      put(A);
    } else {
      mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
    }

    // ------------------------------------------------------------ rooftop plant (instanced)
    const props = new THREE.Group();
    const PR = B.p || [];
    if (PR.length && !small) {
      const kinds = [
        { colour: '#a3a7a8', rough: 0.55, metal: 0.35 }, // plant boxes: galvanised steel
        { colour: '#b9b6ae', rough: 0.8, metal: 0.0 },   // plant room / lift overrun
        { colour: '#cfd6d8', rough: 0.6, metal: 0.1 },   // water tank (FRP panels)
      ];
      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      kinds.forEach((kd, kind) => {
        const rows = PR.filter(p => p[1] === kind && deckZ.has(p[0]));
        if (!rows.length) return;
        const im = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kd.rough, metalness: kd.metal }), rows.length);
        rows.forEach((p, i) => {
          const z = deckZ.get(p[0]), lift = kind === 2 ? 1.0 : 0;
          dummy.position.set(p[2] / 10, z + lift, -p[3] / 10);
          dummy.rotation.set(0, p[7] / 100 * Math.PI / 180, 0);
          dummy.scale.set(p[4] / 10, p[6] / 10, p[5] / 10);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const v = 0.85 + 0.3 * hash1(p[2] * 31 + p[3]);
          im.setColorAt(i, col.copy(lin(kind === 1 ? meta[B.s[p[0]][0]][7] : kd.colour)).multiplyScalar(kind === 1 ? 0.92 * v : v));
        });
        im.castShadow = im.receiveShadow = true;
        props.add(im);
        if (kind === 2) { // the stand under each tank
          const legs = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: lin('#5d6264'), roughness: 0.7, metalness: 0.4 }), rows.length);
          rows.forEach((p, i) => {
            dummy.position.set(p[2] / 10, deckZ.get(p[0]), -p[3] / 10);
            dummy.rotation.set(0, p[7] / 100 * Math.PI / 180, 0);
            dummy.scale.set(p[4] / 10 * 0.9, 1.0, p[5] / 10 * 0.9);
            dummy.updateMatrix();
            legs.setMatrixAt(i, dummy.matrix);
          });
          props.add(legs);
        }
      });
    }

    // ------------------------------------------------------------ Paris mansards: dormers and chimney stacks
    // rows with an absolute base (p[8]); dormers face the street (+z after the row's rotation)
    const PA = PR.filter(p => p.length > 8 && (p[1] === 3 || p[1] === 4) && !hidden.has(p[0]));
    if (PA.length && !small) {
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      const place = (im, p, i, sx, sy, sz, dx = 0, dy = 0, dz = 0) => {
        const a = p[7] / 100 * Math.PI / 180, c = Math.cos(a), s_ = Math.sin(a);
        // offset (dx along the edge, dz outward) in the row's frame
        dummy.position.set(p[2] / 10 + dx * c + dz * s_, p[8] / 10 + dy, -(p[3] / 10 + dx * s_ - dz * c));
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      };
      // a dormer row: the first dormer, then count, step (dm) along the row's angle and a bitmask of empty bays
      const dorm = [];
      for (const p of PA) if (p[1] === 3) {
        const a = p[7] / 100 * Math.PI / 180, n = p[9] || 1, st = p[10] || 0;
        for (let j = 0; j < n; j++) if (!((p[11] || 0) & (1 << j)))
          dorm.push([p[0], 3, p[2] + Math.cos(a) * st * j, p[3] + Math.sin(a) * st * j, p[4], p[5], p[6], p[7], p[8]]);
      }
      const stacks = PA.filter(p => p[1] === 4);
      if (dorm.length) {
        // a zinc dormer: cheeks, a gabled cap, a painted frame and the glass
        const g = new THREE.BufferGeometry(), P = [], N = [], C = [];
        const zinc = [0.24, 0.27, 0.29], paint = [0.78, 0.76, 0.72], glass = [0.012, 0.015, 0.02];
        const quad = (a, b, c2, d, n, k) => { for (const v of [a, b, c2, a, c2, d]) { P.push(...v); N.push(...n); C.push(...k); } };
        quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 0.7, 0.5], [-0.5, 0.7, -0.5], [-1, 0, 0], zinc);
        quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 0.7, -0.5], [0.5, 0.7, 0.5], [1, 0, 0], zinc);
        quad([-0.55, 0.68, -0.5], [-0.55, 0.68, 0.55], [0, 1, 0.55], [0, 1, -0.5], [-0.53, 0.85, 0], zinc);
        quad([0, 1, -0.5], [0, 1, 0.55], [0.55, 0.68, 0.55], [0.55, 0.68, -0.5], [0.53, 0.85, 0], zinc);
        for (const [y0, y1, x0, x1, k, z] of [[0, 0.7, -0.5, 0.5, paint, 0.5], [0.1, 0.62, -0.33, 0.33, glass, 0.505]])
          quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], k);
        for (const v of [[-0.55, 0.68, 0.55], [0.55, 0.68, 0.55], [0, 1, 0.55]]) { P.push(...v); N.push(0, 0, 1); C.push(...paint); }
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), dorm.length);
        dorm.forEach((p, i) => place(im, p, i, p[4] / 10, p[6] / 10, p[5] / 10));
        im.castShadow = im.receiveShadow = true;
        props.add(im);
      }
      if (stacks.length) {
        // a rendered masonry stack under a stone cap, a row of terracotta pots on top
        const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        const body = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), stacks.length * 2);
        const pots = [];
        stacks.forEach((p, i) => {
          const w = p[4] / 10, d = p[5] / 10, h = p[6] / 10;
          place(body, p, 2 * i, w, h, d);
          place(body, p, 2 * i + 1, w + 0.14, 0.12, d + 0.14, 0, h);
          const v = hash1(p[2] * 17 + p[3]);
          body.setColorAt(2 * i, col.copy(lin(v < 0.62 ? '#d9cbb3' : v < 0.85 ? '#c9b391' : '#a9715a')));
          body.setColorAt(2 * i + 1, col.copy(lin('#cfc5b4')));
          const n = Math.max(1, Math.floor(w / 0.42));
          for (let j = 0; j < n; j++) pots.push([p, (j + 0.5) * w / n - w / 2, h + 0.12]);
        });
        body.castShadow = body.receiveShadow = true;
        props.add(body);
        const potIm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 1, 8).translate(0, 0.5, 0),
          new THREE.MeshStandardMaterial({ color: lin('#b0644a'), roughness: 0.85 }), pots.length);
        pots.forEach(([p, dx, dy], i) => place(potIm, p, i, 1, 0.45 + 0.25 * hash1(dx * 13 + p[2]), 1, dx, dy));
        potIm.castShadow = true;
        props.add(potIm);
      }
    }

    // ------------------------------------------------------------ Amsterdam: canal-house gables
    // rows [k, 5, x, y, width, thickness, height (dm), angle, base (dm, absolute), type]: a slab in
    // the plane of the street front, its face at local z = 0 and its depth behind, cut to the
    // outline of its type (spout, step, neck, bell, cornice); x across the front (-0.5..0.5) and
    // y up from the eaves (0..1) in the row's units. The body takes the house's wall colour; white
    // sandstone trims, the attic's hoisting door and its beam are a second mesh in fixed colours.
    const GA = PR.filter(p => p[1] === 5 && p.length > 9 && !hidden.has(p[0]));
    if (GA.length && !small) {
      const dummy = new THREE.Object3D(), col = new THREE.Color();
      const stoneC = [0.85, 0.83, 0.77], darkC = [0.09, 0.08, 0.07], doorC = [0.13, 0.17, 0.14];
      const mirror = half => half.concat(half.slice().reverse().map(([x, y]) => [-x, y]));
      const steps = [[-0.5, 0]], bell = [[-0.5, 0]];
      for (let k = 0; k < 4; k++) steps.push([-0.5 + k * 0.1025, 0.2 + 0.18 * k], [-0.5 + (k + 1) * 0.1025, 0.2 + 0.18 * k]);
      steps.push([-0.09, 1.0]);
      for (let i = 0; i <= 12; i++) { const t = i / 12; bell.push([-(0.5 - 0.33 * (3 * t * t - 2 * t * t * t)), 0.25 + 0.6 * t]); }
      for (let i = 1; i < 6; i++) { const a = Math.PI - i / 6 * Math.PI / 2; bell.push([0.17 * Math.cos(a), 0.85 + 0.15 * Math.sin(a)]); }
      const BODY = [
        [[-0.5, 0], [0.5, 0], [0.5, 0.08], [0.12, 0.92], [0.12, 1], [-0.12, 1], [-0.12, 0.92], [-0.5, 0.08]],
        mirror(steps).reverse(),
        [[-0.5, 0], [0.5, 0], [0.5, 0.3], [0.2, 0.3], [0.2, 0.86], [0.24, 0.86], [0, 1], [-0.24, 0.86], [-0.2, 0.86], [-0.2, 0.3], [-0.5, 0.3]],
        [[0.5, 0]].concat(mirror(bell.slice(1)).reverse(), [[-0.5, 0]]),
        [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]],
      ];
      const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const claw = s => { const p = [[0.2 * s, 0.3]]; for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; p.push([s * (0.2 + 0.24 * Math.cos(a)), 0.3 + 0.32 * Math.sin(a)]); } return s > 0 ? p : p.reverse(); };
      // a window in the gable: a white frame round dark glass; a loading door: green shutters
      const glassC = [0.07, 0.085, 0.1];
      const win = (x, y0, y1, w) => [[rect(x - w / 2 - 0.015, y0 - 0.012, x + w / 2 + 0.015, y1 + 0.012), stoneC, 0, 0.04], [rect(x - w / 2, y0, x + w / 2, y1), glassC, 0, 0.05]];
      const door = (y0, y1) => [[rect(-0.08, y0, 0.08, y1), doorC, 0, 0.06]];
      const beam = y => [[rect(-0.025, y, 0.025, y + 0.05), darkC, 0, 2.0]];
      const row = (xs, y0, y1, w) => xs.flatMap(x => win(x, y0, y1, w));
      // [outline, colour, z0, z1] in the slab's units (its depth is 1)
      const TRIM = [
        [[rect(-0.15, 0.98, 0.15, 1.03), stoneC, -0.9, 0.1], ...door(0.1, 0.3), ...door(0.38, 0.56), ...door(0.62, 0.78), ...beam(0.84)],
        [...[0, 1, 2, 3].flatMap(k => [-1, 1].map(sg => { const x0 = -0.5 + k * 0.1025, x1 = x0 + 0.1025, y = 0.2 + 0.18 * k;
          return [rect(sg < 0 ? x0 - 0.01 : -x1, y - 0.02, sg < 0 ? x1 : -x0 + 0.01, y + 0.015), stoneC, -0.9, 0.1]; })),
          [rect(-0.1, 0.98, 0.1, 1.02), stoneC, -0.9, 0.1], ...row([-0.29, 0, 0.29], 0.04, 0.16, 0.13), ...row([-0.14, 0.14], 0.24, 0.35, 0.11),
          ...win(0, 0.42, 0.53, 0.11), ...door(0.6, 0.72), ...beam(0.77)],
        [[claw(1), stoneC, -0.6, 0.08], [claw(-1), stoneC, -0.6, 0.08], [[[-0.26, 0.85], [0.26, 0.85], [0, 1.0]], stoneC, 0.02, 0.12],
          [rect(-0.22, 0.83, 0.22, 0.86), stoneC, 0, 0.12], ...row([-0.3, 0, 0.3], 0.05, 0.23, 0.13), ...win(0, 0.36, 0.52, 0.15),
          ...door(0.6, 0.76), ...beam(0.79)],
        [[BODY[3].map(([x, y]) => [x * 1.06, y * 1.03]), stoneC, -0.95, -0.15], [rect(-0.19, 0.83, 0.19, 0.87), stoneC, 0, 0.1],
          ...row([-0.28, 0, 0.28], 0.05, 0.21, 0.12), ...row([-0.12, 0.12], 0.34, 0.5, 0.11), ...door(0.58, 0.74), ...beam(0.78)],
        [[rect(-0.51, 0.7, 0.51, 0.92), stoneC, 0, 0.8], [rect(-0.5, 0.92, 0.5, 1.0), stoneC, 0, 0.1]],
      ];
      const extrude = (pts, z0, z1) => {
        const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
        g.translate(0, 0, z0);
        return g.index ? g.toNonIndexed() : g;
      };
      const merged = parts => { // [[geometry, rgb]] -> one geometry with vertex colours
        const P = [], N = [], C = [];
        for (const [g, c] of parts) {
          P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array);
          for (let i = 0; i < g.attributes.position.count; i++) C.push(...c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        return g;
      };
      const place = (im, p, i) => {
        const a = p[7] / 100 * Math.PI / 180;
        dummy.position.set(p[2] / 10, p[8] / 10, -p[3] / 10);
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(p[4] / 10, p[6] / 10, p[5] / 10);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      };
      const brick = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const trimM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      BODY.forEach((outline, t) => {
        const rows = GA.filter(p => p[9] === t);
        if (!rows.length) return;
        const body = new THREE.InstancedMesh(extrude(outline, -1, 0), brick, rows.length);
        const trim = new THREE.InstancedMesh(merged(TRIM[t].map(([pts, c, z0, z1]) => [extrude(pts, z0, z1), c])), trimM, rows.length);
        rows.forEach((p, i) => {
          place(body, p, i);
          place(trim, p, i);
          body.setColorAt(i, col.copy(lin(meta[B.s[p[0]][0]][7])).multiplyScalar(0.95 + 0.1 * hash1(p[2] * 7 + p[3])));
        });
        body.castShadow = body.receiveShadow = trim.castShadow = trim.receiveShadow = true;
        props.add(body, trim);
      });
    }

    // ------------------------------------------------------------ the aerial photo for flat roofs
    if (photoOK) loadPhoto(scene, renderer, pictures, tex => {
      U.uPhoto.value = tex;
      U.uPhotoOn.value = 1;
    });

    // for tools and tests (tools/city_shot.js prints it)
    window.__buildings = { vertices: stream ? stream.vertices : geometry.attributes.position.count, triangles: stream ? stream.triangles : geometry.index.count / 3, props: PR.length,
      roofs: (B.r || []).length, build_ms: Math.round(performance.now() - t0), stream };
    for (const o of props.children.slice()) cellInstances(o);
    return { mesh, geometry, material, props, styles: STYLES, stream };
  }

  // the ground tiles drawn into one canvas (at most 4096 px a side) for flat roofs: from world.js's ground
  // pictures (pics: the overview first, then the tiles near the start, then the rest once they come, issue 335),
  // sent to the GPU when each of those three is in rather than at every tile; or, without them, every tile
  function loadPhoto(scene, renderer, pics, show) {
    const fr = scene.frame, w = fr.x[1] - fr.x[0], h = fr.y[1] - fr.y[0];
    const max = Math.min(4096, renderer.capabilities.maxTextureSize || 4096);
    const k = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const g = cv.getContext('2d');
    const dir = `data/${scene.city.id}/`;
    const draw = (t, im) => { if (im) g.drawImage(im, (t.x0 - fr.x[0]) * k, (fr.y[1] - t.y1) * k, (t.x1 - t.x0) * k, (t.y1 - t.y0) * k); return !!im; };
    let tex = null;
    const sent = () => {
      if (!tex) {
        tex = new THREE.CanvasTexture(cv);
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; else tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        show(tex);
      } else tex.needsUpdate = true;
    };
    const tiles = pics ? pics.tiles : scene.ground.map(t => new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = dir + t.file;
    }));
    const lo = pics && pics.overview ? pics.overview.then(im => draw(scene.ground_lo, im)) : Promise.resolve(false);
    const draws = scene.ground.map((t, i) => lo.then(() => tiles[i]).then(im => draw(t, im))); // (each tile over the overview)
    const part = which => Promise.all(draws.filter((d, i) => which(i))).then(ok => ok.some(Boolean));
    const first = pics ? i => pics.first[i] : () => true;
    Promise.all([lo, part(first)]).then(([low, any]) => {
      if (any || low) sent(); // (the overview, at least, if it came)
      if (pics && pics.first.some(f => !f)) part(i => !first(i)).then(more => { if (more) sent(); });
    });
  }

  // ------------------------------------------------------------ the facade and roof shader
  // photoGrade: GLSL for photoGrade(), the correction world.js gives the aerial photo on the ground;
  // night: GLSL for streetLight(), the street lights' light at a world position (night.js)
  function facadeMaterial(U, renderer, GRIDS, signage, photoGrade, night, coolHomes = 0.15) {
    const grid = STYLES.map(s => new THREE.Vector4(...GRIDS[s])), look = STYLES.map(s => new THREE.Vector4(...LOOK[s]));
    while (grid.length < 16) { grid.push(new THREE.Vector4()); look.push(new THREE.Vector4(1, 0, 0, 0.9)); }
    Object.assign(U, {
      uGrid: { value: grid }, uLook: { value: look }, uHour: U.uHour || { value: 12 }, uSunW: U.uSunW || { value: new THREE.Vector3(0, 1, 0) },
      uPhoto: { value: new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1) }, uPhotoOn: { value: 0 },
      uFrame: { value: new THREE.Vector4(0, 0, 1, 1) }, uSigns: { value: signage }, uCoolHomes: { value: coolHomes }, uNudge: U.uNudge || { value: 4e-5 },
      uGlyphs: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, uGlyphOn: { value: 0 },
    });
    U.uGlyphs.value.needsUpdate = true;
    // the words on the signs (pipeline/sign_glyphs.py); until they load, or if they don't, the
    // signs carry strokes in the shape of characters
    if (signage > 0) new THREE.TextureLoader().load('assets/signs/glyphs.png', tex => {
      tex.minFilter = tex.magFilter = THREE.LinearFilter; // the shader reads each word's length from a cell; a mipmap would blur it
      tex.generateMipmaps = false;
      U.uGlyphs.value = tex; U.uGlyphOn.value = 1;
    }, undefined, () => {});
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    mat.extensions = Object.assign(mat.extensions || {}, { derivatives: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
  attribute vec2 fac; attribute vec4 inf; attribute vec3 ext; attribute float bid; attribute float srcCode;
  uniform vec4 uGrid[16]; uniform vec4 uLook[16]; uniform float uNudge;
  varying vec2 vFac; varying vec4 vInf; varying vec3 vExt; varying float vBid; varying float vSrc;
  varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vGrid; varying vec4 vLook;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFac = fac; vInf = vec4(inf.x, inf.y * 0.01, inf.z * 0.01, inf.w / 65535.0);
  vExt = vec3(ext.x / 65535.0, ext.y, ext.z); vBid = bid; vSrc = srcCode;
  vColor.rgb *= vColor.rgb; // colours are stored as square roots
  int styleI = int(mod(inf.x, 16.0) + 0.5);
  vGrid = uGrid[styleI]; vLook = uLook[styleI];
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);`)
        // Two sources can map the same building, so some solids overlap with their roofs in one
        // plane, which the depth test cannot order: the roof speckles as the camera moves. Each
        // building is drawn a tiny share of its distance nearer the camera (along the view ray, so
        // it stays where it is on screen), its own share, and one of the two always wins.
        .replace('#include <project_vertex>', `#include <project_vertex>
  gl_Position = projectionMatrix * vec4(mvPosition.xyz * (1.0 - uNudge * fract(bid * 0.618034)), 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
  uniform float uNight; uniform float uSel; uniform float uMode; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
  uniform float uHour; uniform sampler2D uPhoto; uniform float uPhotoOn; uniform vec4 uFrame; uniform float uSigns; uniform float uCoolHomes; uniform sampler2D uGlyphs; uniform float uGlyphOn;
  varying vec2 vFac; varying vec4 vInf; varying vec3 vExt; varying float vBid; varying float vSrc;
  varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vGrid; varying vec4 vLook;
  ${photoGrade || 'vec3 photoGrade(vec3 c) { return c; }'}
  ${night || 'vec3 streetLight(vec3 wp) { return vec3(0.0); }'}
  // a pixel's footprint along a coordinate: the length of its screen gradient (fwidth's sum of
  // the two runs up to 1.4 times wider and would blur the windows more than they need)
  float footprint(float x) { return max(length(vec2(dFdx(x), dFdy(x))), 1e-4); }
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float h31(vec3 p) { return h21(p.xy + p.z * 17.17); }
  // a sign's character on a 5 x 5 grid, p 0..1 across it: a horizontal stroke on some rows and an
  // upright on some columns, each over a run of cells, as a CJK character reads from across a street
  float glyph(vec2 p, float id) {
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
    vec2 c = min(floor(p * 5.0), 4.0), f = fract(p * 5.0);
    float r0 = h21(vec2(c.y, id)), r1 = h21(vec2(c.y + 9.1, id)), r2 = h21(vec2(c.y + 3.7, id * 1.3));
    float a = floor(r1 * 3.0), b = a + 1.0 + floor(r2 * (4.0 - a));
    float hs = step(r0, 0.55) * step(a, c.x) * step(c.x, b) * step(abs(f.y - 0.5), 0.2);
    float k0 = h21(vec2(c.x + 5.3, id)), k1 = h21(vec2(c.x + 1.9, id * 0.7)), k2 = h21(vec2(c.x + 7.7, id * 1.9));
    float va = floor(k1 * 3.0), vb = va + 1.0 + floor(k2 * (4.0 - va));
    float vs = step(k0, 0.4) * step(va, c.y) * step(c.y, vb) * step(abs(f.x - 0.5), 0.2);
    return max(hs, vs);
  }
  // a character of the signs' words (assets/signs/glyphs.png, 8 x 32 cells): cell (column, row), q 0..1
  // across it from its bottom left; and the length of the word in a row (the grey of its last cell)
  float sgCell(vec2 cell, vec2 q) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
    return texture2D(uGlyphs, vec2((cell.x + q.x) / 8.0, 1.0 - (cell.y + 1.0 - q.y) / 32.0)).r;
  }
  float sgLen(float row) { return floor(texture2D(uGlyphs, vec2(7.5 / 8.0, 1.0 - (row + 0.5) / 32.0)).r * 255.0 / 16.0 + 0.5); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  // an anti-aliased box: 1 inside [a, b] on coordinate x, with a filter width w
  float band(float x, float a, float b, float w) { return clamp((x - a) / w + 0.5, 0.0, 1.0) * clamp((b - x) / w + 0.5, 0.0, 1.0); }
  // the same box repeated in every unit period of x (a row of windows, slats, courses), averaged
  // over a filter w wide: exact for any w, so a row too fine for its pixels settles on its mean
  // coverage instead of shimmering (integrals taken from floor(x) to keep their precision)
  float pulse(float x, float a, float b, float w) {
    float d = clamp(b - a, 0.0, 1.0), t = x - a, c = floor(t), t0 = t - c - 0.5 * w, t1 = t - c + 0.5 * w;
    return ((floor(t1) - floor(t0)) * d + min(fract(t1), d) - min(fract(t0), d)) / w;
  }
  // occupancy: the share of rooms lit at this local hour, by style. Offices empty through the
  // evening: four floors in five lit at 17:00, three in four at 18:00, half at 19:00, a third at
  // 20:00, a fifth at 21:00 (some floors work late, the cleaners go up the building), and a few
  // all night. Homes light through the evening, but never every window: rooms nobody is in, and
  // curtains, keep it under half. (Each building's own share is about this times 0.3 to 1.7.)
  float occupancy(float style, float hr) {
    float evening = smoothstep(16.5, 19.0, hr) * (1.0 - smoothstep(22.5, 24.5, hr)) + (1.0 - smoothstep(0.0, 1.5, hr)) * 0.5;
    float work = smoothstep(6.5, 8.5, hr) * (1.0 - smoothstep(18.0, 21.0, hr));
    if (style > 3.5 && style < 5.5 || style > 8.5 && style < 9.5) {
      float staff = smoothstep(6.5, 8.5, hr) * (1.0 - smoothstep(17.0, 21.0, hr)), late = smoothstep(6.5, 8.5, hr) * (1.0 - smoothstep(19.0, 24.0, hr));
      return 0.05 + 0.55 * staff + 0.22 * late;
    }
    if (style > 6.5 && style < 7.5) return 0.1 + 0.85 * smoothstep(7.0, 8.0, hr) * (1.0 - smoothstep(21.0, 22.5, hr));
    if (style > 5.5 && style < 6.5) return 0.05 + 0.5 * work + 0.15 * evening;
    return 0.05 + 0.4 * evening + 0.2 * smoothstep(6.0, 7.0, hr) * (1.0 - smoothstep(8.5, 9.5, hr));
  }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  float kind = floor(vInf.x / 16.0 + 0.01), style = floor(vInf.x - kind * 16.0 + 0.5);
  float storey = max(vInf.y, 2.4), ground = max(vInf.z, 2.4), seed = floor(vInf.w * 997.0 + 0.5) / 997.0;
  // hashes take whole numbers: an interpolated varying is not bit-exact, and a hash of it would flicker
  float bidI = floor(vBid + 0.5), bidH = fract(bidI * 0.618034) * 97.0;
  float glass = 0.0, roughB = vLook.w, metalB = 0.0, aoW = vExt.x;
  vec3 emitB = vec3(0.0);
  vec3 N = normalize(vWNrm);
  float dist = length(vWPos - cameraPosition);
  if (kind < 0.5) {
    // ---------------------------------------------------------------- facade
    float h = vFac.y, s = vFac.x, nb = vExt.z;
    float q = h < ground ? h / ground : 1.0 + (h - ground) / storey; // continuous floor coordinate
    float fl = floor(q), fy = fract(q), bay = floor(s), fx = fract(s);
    // the pixel's footprint in bays and floors. The rows of windows, frames and slats are filtered
    // over it (pulse), and what changes from one window to the next (blinds, rooms, lit windows,
    // signs) settles on its average as the windows shrink to a few pixels, so a facade keeps its
    // tone at any distance and does not sparkle as the camera moves.
    vec2 fw = vec2(footprint(s), footprint(q));
    float fwH = footprint(h);
    float far = smoothstep(0.12, 0.4, max(fw.x, fw.y));
    float crisp = 1.0 - smoothstep(0.05, 0.14, max(fw.x, fw.y)); // close enough to see into the rooms
    float inRun = band(s, 0.0, nb, fw.x);
    float flags = floor(vExt.y + 0.5); // whole again: interpolated, 64 can arrive as 63.99999 and read as a shopfront
    float shop = (fl < 0.5 && mod(flags, 2.0) > 0.5) ? 1.0 : 0.0;
    float floorsIn = floor(flags / 32.0 + 0.01);
    float ww = vGrid.y, sill = vGrid.z, head = vGrid.w;
    float win = 0.0, frame = 0.0, spandrel = 0.0, py = 1.0, lintelY = 0.0;
    if (style > 4.5 && style < 5.5) {
      // curtain wall: mullions every module, an opaque spandrel at each slab
      float mull = 1.0 - pulse(s, 0.035, 0.965, fw.x);
      spandrel = 1.0 - pulse(q, 0.24, 0.985, fw.y);
      win = (1.0 - mull) * (1.0 - spandrel);
      frame = mull * (1.0 - spandrel);
    } else if (shop > 0.5) {
      win = pulse(s, 0.05, 0.95, fw.x) * pulse(q, 0.06, 0.8, fw.y);
      frame = pulse(s, 0.03, 0.97, fw.x) * pulse(q, 0.04, 0.82, fw.y) - win;
      float mullion = 1.0 - pulse(s * 2.0, 0.03, 0.97, fw.x * 2.0);
      win *= 1.0 - mullion * 0.9;
    } else {
      float wx = 0.5 * ww;
      if (style > 5.5 && style < 6.5 && fl < 0.5) { wx *= 0.9; sill = 0.18; } // rusticated base, taller openings
      if (style > 0.5 && style < 2.5 && fl < 0.5 && mod(bay, 3.0) < 0.5) { wx = 0.2; sill = 0.0; head = 0.78; } // a door
      py = pulse(q, sill, head, fw.y);
      lintelY = pulse(q, head - 0.08, head, fw.y); // the top of the opening, in the lintel's shadow
      win = pulse(s, 0.5 - wx, 0.5 + wx, fw.x) * py;
      frame = pulse(s, 0.5 - wx - 0.035, 0.5 + wx + 0.035, fw.x) * pulse(q, sill - 0.04, head + 0.03, fw.y) - win;
      // heritage: round-headed windows and a string course at each floor
      if (style > 5.5 && style < 6.5) {
        float r = wx, cy = head - r * 0.9 * (storey > 0.0 ? 3.6 / storey : 1.0);
        float arch = step(cy, fy) * (1.0 - smoothstep(r * r * 0.95, r * r * 1.05, pow(fx - 0.5, 2.0) + pow((fy - cy) * storey / 3.6, 2.0)));
        win *= mix(mix(1.0, arch, step(cy, fy)), 0.92, far);
        float course = pulse(q, 0.0, 0.05, fw.y);
        diffuseColor.rgb *= 1.0 + 0.12 * course;
        diffuseColor.rgb *= 1.0 - 0.06 * pulse(h / 0.45, 0.0, 0.08, fwH / 0.45) * step(fl, 0.5);
      }
      // apartments: slab edges and balcony balustrades on alternate buildings
      if (style > 2.5 && style < 3.5 && seed > 0.45 && fl > 0.5) {
        float slab = pulse(q, 0.0, 0.07, fw.y);
        float rail = pulse(q, 0.07, 0.36, fw.y) * pulse(s, 0.04, 0.96, fw.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, slab);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.07), rail * 0.55);
        win *= 1.0 - rail * 0.6;
      }
      // offices: panel joints at each floor
      if (style > 3.5 && style < 4.5) diffuseColor.rgb *= 1.0 - 0.1 * pulse(q, 0.0, 0.025, fw.y);
      // Haussmann (Paris, 1853-1914): ashlar courses, a rusticated base, and wrought iron: a balcony
      // along the whole front on the second and top floors, a railing across each French window
      // on the others
      if (style > 12.5 && style < 13.5) {
        float course = pulse(h / 0.45, 0.0, 0.07, fwH / 0.45 * 1.5);
        diffuseColor.rgb *= 1.0 - (fl < 0.5 ? 0.17 : 0.05) * course;
        if (fl < 0.5) diffuseColor.rgb *= 1.0 - 0.12 * band(fract(s * 1.6 + step(0.5, fract(h / 0.9)) * 0.5), 0.0, 0.05, fw.x * 1.6) * (1.0 - far);
        float topF = floorsIn - 1.0;
        float filant = (abs(fl - 2.0) < 0.5 || (abs(fl - topF) < 0.5 && topF > 3.5)) ? 1.0 : 0.0;
        // the ironwork: a handrail and a bottom rail, thin balusters and a band of lattice between
        // them, settling to its mean cover before a baluster is under a pixel
        float rq = (q - sill - 0.01) / 0.28, fq = fw.y / 0.28;
        float rails = max(band(rq, 0.86, 1.0, fq), band(rq, 0.0, 0.08, fq));
        float bal = pulse(s * 20.0, 0.0, 0.16, fw.x * 20.0);
        float lat = max(band(abs(fract(s * 6.0 + rq * 0.9) - 0.5), 0.0, 0.05, fw.x * 6.0 + fq),
                        band(abs(fract(s * 6.0 - rq * 0.9) - 0.5), 0.0, 0.05, fw.x * 6.0 + fq)) * band(rq, 0.3, 0.7, fq);
        float bars = mix(max(rails, max(bal, lat)), 0.42, smoothstep(0.3, 0.8, max(fw.x * 20.0, fq * 6.0)));
        float rail = pulse(q, sill + 0.01, min(sill + 0.29, 0.31), fw.y) * step(0.5, fl) * step(fl, topF + 0.5)
          * mix(pulse(s, 0.5 - wx - 0.04, 0.5 + wx + 0.04, fw.x), 1.0, filant);
        float slab = pulse(q, 0.0, sill + 0.01, fw.y) * filant * step(0.5, fl);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.1 + 0.02, slab);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.035, 0.04), rail * bars * 0.92 * (1.0 - 0.6 * far));
        win *= 1.0 - rail * bars * 0.8;
        frame *= 1.0 - rail * bars;
        // the cornice: a lit moulding over a shadow, above the top floor
        float attic = step(topF + 0.5, fl);
        diffuseColor.rgb *= 1.0 - attic * (0.22 * pulse(q, 0.0, 0.18, fw.y) - 0.08 * pulse(q, 0.18, 0.4, fw.y));
      }
      // Amsterdam canal house (grachtenpand): brick in courses with staggered joints, a stone
      // lintel over each tall sash window, and glazing bars: two uprights, a meeting rail and a
      // bar across each sash
      if (style > 13.5 && style < 14.5) {
        float bh = h / 0.065, bx = s * vGrid.x / 0.22 + 0.5 * mod(floor(bh), 2.0);
        vec2 fb = max(fwidth(vec2(bx, bh)), vec2(1e-4));
        float joint = max(band(fract(bh), 0.0, 0.17, fb.y * 1.5), band(fract(bx), 0.0, 0.05, fb.x * 1.5));
        diffuseColor.rgb *= 1.0 - 0.16 * joint * (1.0 - smoothstep(0.25, 0.6, max(fb.x, fb.y)));
        float lintel = band(fy, head + 0.02, head + 0.08, fw.y) * band(fx, 0.5 - wx - 0.05, 0.5 + wx + 0.05, fw.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.82, 0.76), lintel * (1.0 - 0.6 * far));
        float wxr = (fx - 0.5 + wx) / max(2.0 * wx, 1e-3), wyr = (fy - sill) / max(head - sill, 1e-3);
        vec2 fr = max(fwidth(vec2(wxr, wyr)), vec2(1e-4));
        float bars = max(band(abs(fract(wxr * 3.0 + 0.5) - 0.5), 0.0, 0.06, fr.x * 3.0),
                         band(abs(fract(wyr * 4.0 + 0.5) - 0.5), 0.0, 0.05, fr.y * 4.0)) * (1.0 - far);
        frame = max(frame, win * bars);
        win *= 1.0 - bars;
      }
      // shopfront fascia band
    }
    if (shop > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, pulse(q, 0.82, 1.0, fw.y) * 0.6);
    // machiya: a timber lattice (koshi) across the ground floor, plaster with slit windows above
    if (style > 9.5 && style < 10.5) {
      if (fl < 0.5) {
        float slat = pulse(s * 22.0, 0.0, 0.42, fw.x * 22.0) * pulse(q, 0.04, 0.84, fw.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.1, 0.08), slat);
        win *= 1.0 - slat;
      } else {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.82), pulse(q, 0.1, 0.95, fw.y) * 0.7);
        float slit = pulse(s * 8.0, 0.35, 0.65, fw.x * 8.0) * pulse(s, 0.2, 0.8, fw.x) * pulse(q, 0.35, 0.72, fw.y);
        win = slit * 0.9; frame = 0.0; lintelY = 0.0;
      }
    }
    // Japanese mixed-use mid-rise: shop signs on some floors and a vertical sign on a corner bay, backlit at night
    float sign = 0.0; vec3 signC = vec3(0.0);
    if (style > 10.5 && style < 11.5 && uSigns > 0.0 && fl > 0.5) {
      float sr = h21(vec2(fl, floor(bay / 2.0)) + bidH * 1.7);
      // a panel spans two bays and only where both are in the run, never into its margins; the
      // vertical sign takes the first bay of the one run the building gives it (flag 4)
      float pane = step(sr, 0.22 * uSigns) * band(fy, 0.12, 0.88, fw.y) * band(fract(bay / 2.0) * 2.0 + fx, 0.08, 1.92, fw.x)
                 * step(-0.5, bay) * step(2.0 * floor(bay / 2.0) + 2.0, nb + 0.5);
      float vert = step(0.45, seed) * step(-0.5, bay) * step(bay, 0.5) * step(0.5, nb) * step(0.5, mod(floor(flags / 4.0), 2.0))
                 * band(fx, 0.18, 0.82, fw.x);
      float hue = h21(vec2(floor(bay / 2.0), fl) * 1.3 + bidH);
      signC = hue < 0.3 ? vec3(0.85, 0.12, 0.1) : hue < 0.5 ? vec3(0.95, 0.8, 0.15) : hue < 0.7 ? vec3(0.92, 0.92, 0.9) : hue < 0.85 ? vec3(0.1, 0.35, 0.8) : vec3(0.1, 0.6, 0.3);
      if (vert > 0.5) signC = seed < 0.7 ? vec3(0.9, 0.9, 0.88) : vec3(0.85, 0.15, 0.12);
      // lettering: a line of characters across a panel, a column of them down the corner sign, dark on a
      // light sign and white on a dark one (lit from behind at night), settling to its mean tone before a
      // stroke is under a pixel. Characters about a third of a storey high
      float gm = 0.32 * storey, bw = max(vGrid.x, 1.0), txt = 0.0, sub = gm / 5.0 / bw;
      if (vert > 0.5) {
        if (uGlyphOn > 0.5) { // a tenant a floor, two characters each, read top to bottom
          float yy = (fy - 0.5) * storey / (gm * 1.18), k = floor(h21(vec2(fl, bidH * 7.3 + 2.0)) * 40.0);
          txt = abs(yy) < 1.0 ? sgCell(vec2(mod(k, 4.0) * 2.0 + (yy >= 0.0 ? 0.0 : 1.0), 22.0 + floor(k / 4.0)),
                                       vec2((fx - 0.5) * bw / gm + 0.5, (fract(yy) - 0.5) * 1.18 + 0.5)) : 0.0;
        } else {
          float gy = h / (gm * 1.18), gi = floor(gy);
          txt = glyph(vec2((fx - 0.5) * bw / gm + 0.5, 1.0 - fract(gy) * 1.18), gi + bidH * 3.1 + 40.0);
        }
      } else if (pane > 0.0) {
        float xm = ((fract(bay / 2.0) * 2.0 + fx) * bw - 0.5) / (gm * 1.15), gi = floor(xm);
        float n = floor((1.84 * bw - 0.6) / (gm * 1.15)); // characters that fit the panel
        if (uGlyphOn > 0.5) { // a word, centred on the panel (a two-character one where a longer one won't fit)
          float w = floor(h21(vec2(floor(bay / 2.0), fl) + bidH * 3.3) * 22.0), L = sgLen(w);
          if (L > n) { w = 1.0; L = 2.0; }
          float ci = gi - floor((n - L) * 0.5);
          txt = ci >= 0.0 && ci < L ? sgCell(vec2(ci, w), vec2(fract(xm) * 1.15, (fy - 0.5) * storey / gm + 0.5)) : 0.0;
        } else {
          txt = gi < n ? glyph(vec2(fract(xm) * 1.15, 1.0 - (fy - 0.5) * storey / gm - 0.5), gi + sr * 61.0 + bidH) : 0.0;
        }
      }
      txt = mix(txt, 0.3 * max(pane, vert), smoothstep(0.35, 1.0, max(fw.x / sub, fw.y * storey / (gm / 5.0))));
      signC = mix(signC, dot(signC, vec3(0.3, 0.5, 0.2)) > 0.5 ? vec3(0.07, 0.06, 0.06) : vec3(0.97, 0.96, 0.92), txt * (1.0 - far));
      // far off: the signs' share of the wall in their mean colour
      sign = mix(max(pane, vert), 0.15 * uSigns, far);
      signC = mix(signC, vec3(0.66, 0.52, 0.41), far);
      win *= 1.0 - sign;
      frame *= 1.0 - sign;
    }
    float onFloor = step(fl + 0.5, floorsIn) * (1.0 - far) + far;
    win *= inRun * onFloor; frame *= inRun * onFloor;
    // per window: lit at night, blinds, a room
    vec2 cellId = vec2(bay, fl);
    float rnd = h31(vec3(cellId, bidH + seed * 31.0));
    float office = step(3.5, style) * step(style, 5.5) + step(8.5, style) * step(style, 9.5);
    float unitW = style > 3.5 && style < 5.5 ? 6.0 : 2.0;
    float runFar = smoothstep(0.75, 1.6, max(fw.x / unitW, fw.y)); // a run of rooms under a pixel: from here on, its mean
    // offices light by the floor (a tenant, the cleaners going up the building), so a tower reads in
    // bands of lit floors; homes light room by room. Each building keeps its own evening, a tower
    // with a tenant working late beside one all but empty, so a skyline is not one even grey.
    float unitR = h31(vec3(floor(bay / unitW), fl, bidH * 1.37));
    if (office > 0.5) unitR = mix(h21(vec2(fl, bidH * 1.91 + 2.7)), unitR, 0.3);
    float occ = clamp(occupancy(style, uHour) * (0.3 + 1.4 * h21(vec2(bidH * 1.13 + 4.1, 2.9))), 0.0, 0.97);
    float unitLit = step(unitR, occ), shopLit = 0.85 * step(0.0, occupancy(7.0, uHour) - 0.3);
    // rooms lit in different lights: offices under cool white (4000-5000 K LED and fluorescent
    // tubes), a floor in four warmer; homes under warm lamps, or a share of them (uCoolHomes: most
    // in Japan and Hong Kong) under cool ceiling lights; until a run of rooms is under a pixel
    float tintR = h31(vec3(floor(bay / unitW), fl, bidH * 2.3 + 5.1));
    vec3 coolC = vec3(0.8, 0.9, 1.0), whiteC = vec3(1.0, 0.84, 0.62), warmC = vec3(1.0, 0.62, 0.32);
    vec3 lampC = office > 0.5 ? (tintR < 0.75 ? coolC : whiteC) : tintR < uCoolHomes ? coolC : tintR < uCoolHomes + 0.2 ? whiteC : warmC;
    lampC = mix(lampC, office > 0.5 ? 0.75 * coolC + 0.25 * whiteC : uCoolHomes * coolC + 0.2 * whiteC + (0.8 - uCoolHomes) * warmC, runFar);
    // and as bright as their lamps are: a tower at night is a dark mass with most of its lit rooms
    // at office or room light and a few floors bright, not a grid of equal windows
    float bR = h31(vec3(floor(bay / unitW), fl, bidH * 0.77 + 9.3));
    float unitB = mix(0.25 + 0.6 * pow(bR, 1.5) + 0.5 * step(0.9, bR), 0.56, runFar), litGain = 1.6;
    float lit = unitLit * step(0.12, rnd);
    if (shop > 0.5) lit = step(0.15, rnd) * step(0.0, occupancy(7.0, uHour) - 0.3);
    // an office tower's lobby stays lit all night
    float lobby = office * step(fl, 0.5) * (1.0 - shop);
    lit = max(lit, lobby); unitB = mix(unitB, 1.0, lobby);
    // a little farther, whole runs of rooms lit or dark along each floor, as a tower reads from
    // across the city at night; farther still, where a run is under a pixel, the share of windows
    // lit rather than which ones are (later than the rest, as a lit window reads as one whatever is
    // behind it, down to a pixel or two)
    lit = mix(lit, shop > 0.5 ? shopLit : 0.88 * unitLit, smoothstep(0.45, 1.0, max(fw.x, fw.y)));
    lit = mix(lit, shop > 0.5 ? shopLit : 0.88 * occ, runFar);
    rnd = mix(rnd, 0.5, far);
    float blind = step(0.72, h31(vec3(cellId, bidH * 0.53 + 3.1))) * (style > 4.5 && style < 5.5 ? 0.0 : 1.0);
    float blindY = 0.55 + 0.4 * h21(cellId + bidH);
    float isBlind = mix(blind * clamp((fy - blindY) / fw.y + 0.5, 0.0, 1.0), 0.07 * step(0.5, abs(style - 5.0)), far);
    // interior mapping: a room behind the glass, lit by day from outside and by its lamps at night
    vec3 room = vec3(0.0);
    if (win > 0.01) {
      float bw = max(vGrid.x, 1.0), depth = vLook.x;
      vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N)), V = normalize(vWPos - cameraPosition);
      vec3 d = vec3(dot(V, T) / bw, V.y / storey, -dot(V, N) / bw);
      vec2 p0 = vec2(style > 4.5 && style < 5.5 ? fx : clamp((fx - 0.5 + 0.5 * ww) / max(ww, 0.05), 0.0, 1.0), fy);
      if (shop > 0.5) p0 = vec2(fx, fy);
      vec3 inv = 1.0 / max(abs(d), vec3(1e-4));
      float tx = (d.x > 0.0 ? 1.0 - p0.x : p0.x) * inv.x, ty = (d.y > 0.0 ? 1.0 - p0.y : p0.y) * inv.y, tz = depth * inv.z;
      float t = min(min(tx, ty), tz);
      // which face the ray meets, with a tolerance and a fixed order so near-ties do not flicker
      float hitZ = step(tz, t * 1.0001 + 1e-5), hitY = (1.0 - hitZ) * step(ty, t * 1.0001 + 1e-5);
      vec3 hp = vec3(p0, 0.0) + d * t;
      float roomR = h31(vec3(cellId, bidH * 0.71 + 7.3));
      vec3 wallC = mix(vec3(0.62, 0.58, 0.52), vec3(0.55, 0.6, 0.62), roomR);
      vec3 c;
      if (hitZ > 0.5) {
        c = wallC * (0.8 + 0.2 * mix(0.5, step(0.5, h21(floor(hp.xy * vec2(3.0, 2.0)) + roomR)), crisp));
        c *= 1.0 - 0.5 * crisp * band(hp.y, 0.0, 0.42, 0.02) * step(0.45, roomR) * band(hp.x, 0.15, 0.75, 0.02); // furniture
      } else if (hitY > 0.5) {
        c = d.y > 0.0 ? vec3(0.8, 0.79, 0.76) : mix(vec3(0.42, 0.3, 0.2), vec3(0.35, 0.36, 0.38), roomR);
      } else c = wallC * 0.85;
      c *= mix(1.0, 0.45, clamp(hp.z / depth, 0.0, 1.0));
      c = mix(c, vec3(0.36, 0.345, 0.32), far); // a room too small to see into: its mean
      // day: dim, lit by the window; night: the room's lamps when occupied
      float dayL = (style > 4.5 && style < 5.5 ? 0.06 : 0.2) * (1.0 - uNight);
      float lamp = lit * uNight * (0.3 + 0.3 * rnd) * unitB * litGain;
      float ceilingSpot = mix(hitY > 0.5 && d.y > 0.0 ? 1.0 + 0.8 * exp(-8.0 * dot(hp.xz - vec2(0.5, depth * 0.5), hp.xz - vec2(0.5, depth * 0.5))) : 1.0, 1.1, far);
      room = c * (dayL + lamp * 1.0 * lampC * ceilingSpot * (0.75 + 0.5 * mix(h21(vec2(fl, bidH)), 0.5, far)));
      room *= 1.0 - smoothstep(500.0, 900.0, dist) * 0.6;
    }
    // far windows at night: average glow instead of rooms
    float glowFar = lit * uNight * far;
    vec3 frameC = (style > 0.5 && style < 3.5) || (style > 5.5 && style < 6.5) || style > 12.5 ? mix(vec3(0.78, 0.76, 0.7), diffuseColor.rgb, 0.25 + 0.5 * step(0.6, seed))
      : diffuseColor.rgb * (1.0 - vLook.y);
    vec3 blindC = mix(vec3(0.82, 0.8, 0.74), vec3(0.6, 0.62, 0.6), rnd);
    if (style > 4.5 && style < 5.5) {
      // curtain-wall glass tint per building; the spandrel takes the frame colour
      // coated glass: a tinted mirror (F0 about 0.3) over a dim interior
      vec3 tint = seed < 0.3 ? vec3(0.26, 0.36, 0.42) : seed < 0.55 ? vec3(0.34, 0.37, 0.39) : seed < 0.75 ? vec3(0.2, 0.27, 0.34)
        : seed < 0.9 ? vec3(0.3, 0.38, 0.34) : vec3(0.38, 0.32, 0.26);
      tint *= 0.9 + 0.2 * mix(h21(vec2(bay, fl) * 0.37 + bidH), 0.5, far);
      diffuseColor.rgb = mix(diffuseColor.rgb, frameC * 0.8, frame);
      diffuseColor.rgb = mix(diffuseColor.rgb, tint, win);
      metalB = mix(0.25, 0.86, win);
      roughB = mix(0.4, 0.04 + 0.08 * rnd, win);
    } else {
      diffuseColor.rgb = mix(diffuseColor.rgb, frameC, clamp(frame, 0.0, 1.0));
      vec3 glassC = vec3(0.09, 0.1, 0.11);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(glassC, blindC, isBlind), win);
      metalB = win * (1.0 - isBlind) * vLook.z;
      roughB = mix(roughB, mix(0.07, 0.6, isBlind), win);
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, signC, sign);
    // a sign is lit as bright as a lit room, whatever the city's density of signs, and a white or yellow
    // one less than a red: a backlit panel reads as colour, not as a white glare
    emitB += sign * signC * (0.04 + 0.75 * uNight * min(uSigns, 1.0)) * (1.0 - 0.45 * dot(signC, vec3(0.3, 0.5, 0.2)));
    roughB = mix(roughB, 0.35, sign);
    glass = win * (1.0 - isBlind);
    // the top of each opening in the lintel's shadow
    diffuseColor.rgb *= 1.0 - 0.45 * win * min(1.0, lintelY / max(py, 1e-3));
    // glass a few pixels across: its reflections widen a little, so the sun's glint glides
    // over a facade instead of flashing from window to window
    roughB = max(roughB, 0.16 * far);
    emitB += room * glass;
    emitB += win * isBlind * lit * uNight * lampC * vec3(1.0, 0.88, 0.75) * 0.35 * unitB * litGain; // a blind lit from behind
    emitB += glowFar * win * lampC * (0.34 + 0.3 * rnd) * unitB * litGain;
    // ground contact: a darker plinth and less sky near the street
    aoW *= mix(0.72, 1.0, smoothstep(0.0, 3.0, h));
    // fine plaster noise up close
    diffuseColor.rgb *= 0.94 + 0.12 * mix(vnoise(vec2(s * 7.0 + bidH, h * 3.0)), 0.5, smoothstep(0.25, 0.6, max(fw.x * 7.0, fwH * 3.0)));
  } else if (kind < 1.5) {
    // ---------------------------------------------------------------- blank wall, gable, parapet
    vec2 fwn = fwidth(vFac) * vec2(1.3, 2.1);
    diffuseColor.rgb *= 0.95 + 0.1 * mix(vnoise(vFac * vec2(1.3, 2.1) + bidH), 0.5, smoothstep(0.25, 0.6, max(fwn.x, fwn.y)));
    if (style > 14.5 && style < 15.5) {
      // a precinct wall (pipeline/walls.py): plaster stained under its coping, the white lines of a
      // suji-bei (as many as the ground-floor field says) under the eaves, and a plinth of dressed stone
      float hW = vFac.y, eaveW = vInf.y, nL = floor(vInf.z + 0.5);
      vec2 fv = max(fwidth(vFac), vec2(1e-4));
      float near = 1.0 - smoothstep(0.08, 0.3, max(fv.x, fv.y));
      float stain = smoothstep(0.45, 0.9, vnoise(vec2(vFac.x * 0.9 + bidH, 0.3)));
      diffuseColor.rgb *= 1.0 - 0.13 * stain * smoothstep(0.4 * eaveW, eaveW, hW) - 0.06 * (1.0 - smoothstep(0.55, 1.4, hW));
      if (nL > 0.5) {
        float gap = 0.2, y0 = eaveW - 0.5 - nL * gap, k = (hW - y0) / gap;
        float inL = step(0.0, k) * step(k, nL);
        float ln = mix(band(fract(k), 0.3, 0.68, fv.y / gap * 1.5), 0.38, 1.0 - near) * inL;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.8), ln);
      }
      float plinthW = 1.0 - smoothstep(0.6 - fv.y, 0.6 + fv.y, hW);
      float joint = max(band(fract(hW / 0.3), 0.0, 0.07, fv.y / 0.3 * 1.5),
                        band(fract(vFac.x / 0.95 + 0.5 * step(0.5, fract(hW / 0.6))), 0.0, 0.03, fv.x / 0.95 * 1.5)) * near;
      vec3 stoneW = vec3(0.34, 0.3, 0.25) * (0.88 + 0.24 * vnoise(vFac * vec2(1.1, 3.3) + bidH));
      diffuseColor.rgb = mix(diffuseColor.rgb, stoneW * (1.0 - 0.4 * joint), plinthW);
      roughB = 0.95;
    }
    aoW *= mix(0.75, 1.0, smoothstep(0.0, 3.0, vFac.y));
  } else if (kind < 2.5) {
    // ---------------------------------------------------------------- pitched roof
    float m = vExt.z; // 3 tile, 4 metal, 5 slate, 6 kawara, 7 copper, 10 zinc
    vec2 r = vFac;
    vec2 fwr = max(fwidth(r), vec2(1e-4));
    // tiles and ribs a few centimetres across fade to their mean tone before they shrink below a pixel
    float fade = 1.0 - smoothstep(0.035, 0.11, max(fwr.x, fwr.y));
    vec3 base = diffuseColor.rgb;
    if (uPhotoOn > 0.5) {
      vec2 uv = vec2((vWPos.x - uFrame.x) * uFrame.z, (-vWPos.z - uFrame.y) * uFrame.w);
      vec3 ph = photoGrade(texture2D(uPhoto, uv).rgb);
      base = mix(base, ph * 0.9, 0.35);
    }
    float pat = 1.0, mean = 1.0, slope = 1.0;
    if (m > 2.5 && m < 3.5) { // terracotta tile: courses down the slope, rounded pans across
      float course = fract(r.y / 0.34), pan = fract(r.x / 0.24 + 0.5 * step(0.5, fract(r.y / 0.68)));
      pat = 0.78 + 0.22 * smoothstep(0.0, 0.85, course) * (0.75 + 0.25 * sin(pan * 6.2832));
      pat *= 0.92 + 0.16 * h21(floor(vec2(r.x / 0.24, r.y / 0.34)) + bidH);
      mean = 0.875;
    } else if (m > 3.5 && m < 4.5) { // corrugated steel: ribs running down the slope
      pat = 0.88 + 0.12 * sin(r.x / 0.19 * 6.2832); mean = 0.88;
      metalB = 0.35; roughB = 0.42;
    } else if (m > 4.5 && m < 5.5) { // slate
      float course = fract(r.y / 0.28), sl = fract(r.x / 0.3 + 0.5 * step(0.5, fract(r.y / 0.56)));
      pat = 0.85 + 0.15 * smoothstep(0.0, 0.9, course) * smoothstep(0.0, 0.06, sl) * smoothstep(1.0, 0.94, sl);
      roughB = 0.6; mean = 0.92;
    } else if (m > 5.5 && m < 6.5) { // kawara: deep rounded rows and dark glaze
      pat = 0.7 + 0.3 * pow(abs(sin(r.x / 0.3 * 3.1416)), 0.6);
      pat *= 0.9 + 0.1 * smoothstep(0.0, 0.2, fract(r.y / 0.28));
      roughB = 0.45; metalB = 0.1; mean = 0.91;
    } else if (m > 9.5 && m < 10.5) { // rolled zinc: standing seams every 0.65 m down the slope
      float seam = band(fract(r.x / 0.65), 0.0, 0.05, fwr.x / 0.65 * 1.5);
      pat = 0.93 + 0.1 * vnoise(r * vec2(0.3, 1.7) + bidH) + 0.16 * seam; mean = 0.98;
      slope = mix(1.0, 0.82, smoothstep(0.35, 0.15, abs(N.y))); // the steep brisis reads darker than the terrasson
      metalB = 0.4; roughB = 0.4;
    } else if (m > 6.5 && m < 7.5) { // copper patina
      base = mix(base, vec3(0.22, 0.42, 0.36), 0.6);
      pat = 0.85 + 0.25 * vnoise(r * 1.5); mean = 0.975;
      roughB = 0.55; metalB = 0.25;
    } else roughB = 0.8;
    diffuseColor.rgb = base * mix(mean, pat, fade) * slope;
    aoW = 1.0;
  } else if (kind < 3.5) {
    // ---------------------------------------------------------------- flat deck
    vec3 base = diffuseColor.rgb;
    if (uPhotoOn > 0.5 && mod(floor(vExt.y / 16.0 + 0.03), 2.0) > 0.5) { // (+0.03: 16 can arrive as 15.99999)
      vec2 uv = vec2((vWPos.x - uFrame.x) * uFrame.z, (-vWPos.z - uFrame.y) * uFrame.w);
      // the photo, a little softened and leaned towards the roof's median colour: close up a 1 m photo is noise
      base = mix(base, photoGrade(texture2D(uPhoto, uv, 1.0).rgb) * 0.92, 0.65);
    } else {
      float fwd = max(fwidth(vFac.x), 1e-3);
      base *= 0.9 + 0.2 * mix(vnoise(vFac * 0.35 + bidH), 0.5, smoothstep(0.7, 1.7, fwd));
      base *= 1.0 - 0.08 * (1.0 - pulse(vFac.x / 1.2, 0.02, 0.98, max(fwd / 1.2, 0.02)));
    }
    diffuseColor.rgb = base;
    roughB = 0.88; aoW = 0.95;
  } else if (kind < 4.5) {
    roughB = 0.7; aoW = 0.95; // coping, awnings
  } else {
    roughB = 0.8; aoW = 0.9; // awning soffit, lit at night
    emitB += diffuseColor.rgb * uNight * 0.55 * occupancy(7.0, uHour);
  }
  // the street lights on the lower floors: the light on the pavement in front of the wall, fading
  // up the facade from the lamps' height, less on glass, which shows the room behind it instead
  if (kind < 1.5) emitB += diffuseColor.rgb * streetLight(vWPos + vec3(N.x, 0.0, N.z) * 2.5) * exp(-max(vFac.y - 2.0, 0.0) / 9.0) * (1.0 - 0.6 * glass);
  float win = glass;
  if (uMode > 0.0) { // colour by height source; the viewer fades it in and out (0..1)
    diffuseColor.rgb = mix(diffuseColor.rgb, vSrc < 0.5 ? uC0 : (vSrc < 1.5 ? uC1 : (vSrc < 2.5 ? uC2 : vec3(0.8))), uMode);
    emitB *= 1.0 - uMode; metalB *= 1.0 - uMode; roughB = mix(roughB, 0.85, uMode); glass *= 1.0 - uMode;
  }
  if (abs(bidI - uSel) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.42, 0.12), 0.6);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = roughB;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = metalB;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += emitB;`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= aoW;
  reflectedLight.indirectSpecular *= mix(aoW, 1.0, glass * 0.5);
  reflectedLight.directDiffuse *= mix(1.0, aoW, 0.35);`);
    };
    mat.customProgramCacheKey = () => `oe-facade-9${night ? '-night' : ''}`;
    return mat;
  }

  // The city's walls and roofs are one geometry, which suits building it and picking a building in it but
  // leaves the GPU nothing to skip: every frame drew all of it twice, for the view and for the sun's shadow
  // map, though the shadow map covers a few hundred metres round the player and the view half the city at
  // most. These are the same triangles as meshes over a grid of cells, sharing the one geometry's vertex
  // buffers (nothing more is uploaded but the indices, the same count again), each with its own bounds, so
  // three.js's frustum culling leaves out the cells behind the camera and outside the shadow camera's box.
  // What is drawn is what was drawn, triangle for triangle; the cells' size keeps them to a few dozen draws.
  function cells(mesh, target = 64) {
    const g = mesh.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null;
    if (!I || I.length < 3 * 20000) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox, w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
    const cell = Math.max(300, Math.sqrt(w * d / target)), nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
    const count = new Uint32Array(nx * nz), of = new Uint32Array(I.length / 3);
    for (let t = 0, k = 0; t < I.length; t += 3, k++) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const cx = Math.min(nx - 1, Math.floor(((P[a] + P[b] + P[c]) / 3 - bb.min.x) / cell));
      const cz = Math.min(nz - 1, Math.floor(((P[a + 2] + P[b + 2] + P[c + 2]) / 3 - bb.min.z) / cell));
      of[k] = cx * nz + cz; count[of[k]]++;
    }
    const big = g.attributes.position.count > 65535, idx = [], fill = new Uint32Array(nx * nz);
    for (let i = 0; i < nx * nz; i++) idx.push(count[i] ? (big ? new Uint32Array(3 * count[i]) : new Uint16Array(3 * count[i])) : null);
    for (let t = 0, k = 0; t < I.length; t += 3, k++) { const a = idx[of[k]], f = fill[of[k]]; a[f] = I[t]; a[f + 1] = I[t + 1]; a[f + 2] = I[t + 2]; fill[of[k]] = f + 3; }
    const group = new THREE.Group();
    group.name = 'buildings';
    const v = new THREE.Vector3();
    idx.forEach(a => {
      if (!a) return;
      const cg = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) cg.setAttribute(name, attr); // (the same buffers)
      cg.setIndex(new THREE.BufferAttribute(a, 1));
      const box = new THREE.Box3();
      for (let i = 0; i < a.length; i++) box.expandByPoint(v.fromArray(P, 3 * a[i]));
      cg.boundingBox = box;
      cg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(cg, mesh.material);
      m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
      m.renderOrder = mesh.renderOrder; m.name = 'buildings-cell';
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    });
    group.matrixAutoUpdate = false;
    return group;
  }

  // A static instanced mesh is culled as one: its bounding sphere spans every instance, so a rooftop
  // plant box across the city is drawn for the view and the sun's shadow map wherever the camera is.
  // cellInstances splits it in place over a grid of `size` metres: the mesh keeps one cell's instances
  // and takes the others as child instanced meshes with the same geometry and material, each with its
  // own bounds, so frustum culling (the shadow camera's included) drops the cells out of sight. The
  // picture is the same. Only for meshes whose instances are never changed afterwards by index, and
  // whose geometry has no per-instance attributes of its own.
  function cellInstances(im, size = 400) {
    if (!im || !im.isInstancedMesh || im.children.length || im.userData.cells) return im;
    const g = im.geometry, n = im.count, per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (n * per < 30000) return im; // a few draws more cost an old device's CPU more than these triangles its GPU
    for (const a of Object.values(g.attributes)) if (a.isInstancedBufferAttribute) return im;
    const A = im.instanceMatrix.array, C = im.instanceColor ? im.instanceColor.array : null, by = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(A[16 * i + 12] / size) * 65536 + Math.floor(A[16 * i + 14] / size);
      let l = by.get(k); if (!l) by.set(k, l = []); l.push(i);
    }
    if (by.size < 2) return im;
    const fill = (m, list) => {
      const M = new Float32Array(16 * list.length), K = C ? new Float32Array(3 * list.length) : null;
      list.forEach((i, j) => { M.set(A.subarray(16 * i, 16 * i + 16), 16 * j); if (K) K.set(C.subarray(3 * i, 3 * i + 3), 3 * j); });
      m.instanceMatrix = new THREE.InstancedBufferAttribute(M, 16);
      m.instanceColor = K ? new THREE.InstancedBufferAttribute(K, 3) : null;
      m.count = list.length;
      m.boundingSphere = null; m.boundingBox = null; m.computeBoundingSphere();
    };
    const lists = [...by.values()];
    for (const list of lists.slice(1)) {
      const c = new THREE.InstancedMesh(g, im.material, list.length);
      c.castShadow = im.castShadow; c.receiveShadow = im.receiveShadow; c.renderOrder = im.renderOrder;
      c.customDepthMaterial = im.customDepthMaterial; c.customDistanceMaterial = im.customDistanceMaterial;
      c.layers.mask = im.layers.mask; c.name = im.name; c.userData.cellOf = im;
      fill(c, list);
      im.add(c);
    }
    fill(im, lists[0]);
    im.userData.cells = by.size;
    return im;
  }

  return { create, start, cells, cellInstances, STYLES, guessStyle: GEO.guessStyle, canopyPosts, POST };
})();
