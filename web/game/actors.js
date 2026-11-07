// People and cars. Pedestrians walk the city's footways (keeping left, as Australians
// do), step aside for each other and for the player, and stop to sit on benches. Cars
// drive the roads on the city's side (the left unless it keeps right), at the speed limit
// Overture gives or a default for the road class, and swing out round a car pulled in at
// the kerb. Cars are instanced meshes, a handful of draw calls for
// hundreds. People are drawn by people.js (realistic characters); the box-built rigs
// here are the fallback when those files can't be loaded.
'use strict';
window.OEActors = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const SHIRTS = ['#c94f3d', '#2f5d8c', '#e9e4d8', '#3d6b4a', '#1f2328', '#d9a441', '#7a4e8f', '#5b7f99', '#b5654b', '#f2f0ea', '#355c7d', '#8c2f39'];
  const PANTS = ['#2b3440', '#1d1f24', '#4b5563', '#3a3026', '#6b7280', '#24384f', '#c7b89a'];
  const SKIN = ['#f1c8a6', '#e0ac85', '#c68a64', '#a8714f', '#8d5a3c', '#6b4429'];
  const HAIR = ['#1b1311', '#3b2a20', '#6b4a2b', '#a37a45', '#c9a35b', '#8a8a8a', '#2a1d17'];
  // footway widths by class (m), for drawing the streets and for how far walkers can step aside
  const FOOTW = { pedestrian: 8, footway: 3, path: 2.5, steps: 3, cycleway: 2.5, living_street: 5 };
  const CARS = ['#f2f2f2', '#1c1c1e', '#8a9099', '#b3242b', '#1f4e8c', '#d8d3c8', '#2f3b33', '#c9a227', '#5a6470', '#7a1f2b'];

  // ------------------------------------------------------------ articulated person (player, NPCs)
  function box(w, h, d, color, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: lin(color), roughness: 0.8 }));
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  function limb(len, w, color) { // pivot at the top, hangs down
    const g = new THREE.Group(), m = box(w, len, w, color, -len / 2);
    g.add(m);
    return g;
  }
  function makePerson(look = {}, { vest = false } = {}) {
    const shirt = look.shirt || pick(SHIRTS), pants = look.pants || pick(PANTS), skin = look.skin || pick(SKIN), hair = look.hair || pick(HAIR);
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const hips = new THREE.Group();
    hips.position.y = 0.94;
    body.add(hips);
    const torso = box(0.4, 0.56, 0.22, shirt, 0.3);
    hips.add(torso);
    if (vest) { // hi-vis survey vest with reflective bands
      const v = box(0.42, 0.42, 0.24, '#ff7a1a', 0.33);
      hips.add(v);
      for (const y of [0.22, 0.42]) hips.add(box(0.43, 0.04, 0.25, '#e8eef2', y));
    }
    const neck = new THREE.Group();
    neck.position.y = 0.62;
    hips.add(neck);
    const head = box(0.2, 0.24, 0.22, skin, 0.13);
    neck.add(head);
    neck.add(box(0.22, 0.08, 0.24, hair, 0.27));
    neck.add(box(0.22, 0.12, 0.05, hair, 0.18).translateZ(-0.1));
    const legL = limb(0.47, 0.15, pants), legR = limb(0.47, 0.15, pants);
    legL.position.set(0.1, 0, 0); legR.position.set(-0.1, 0, 0);
    hips.add(legL, legR);
    const shinL = limb(0.45, 0.13, pants), shinR = limb(0.45, 0.13, pants);
    shinL.position.y = -0.47; shinR.position.y = -0.47;
    legL.add(shinL); legR.add(shinR);
    for (const sh of [shinL, shinR]) { const f = box(0.14, 0.07, 0.26, '#2a2622', -0.47); f.position.z = 0.05; sh.add(f); }
    const armL = limb(0.3, 0.11, shirt), armR = limb(0.3, 0.11, shirt);
    armL.position.set(0.26, 0.55, 0); armR.position.set(-0.26, 0.55, 0);
    hips.add(armL, armR);
    const foreL = limb(0.28, 0.1, skin), foreR = limb(0.28, 0.1, skin);
    foreL.position.y = -0.3; foreR.position.y = -0.3;
    armL.add(foreL); armR.add(foreR);
    const rig = { root, body, hips, neck, legL, legR, shinL, shinR, armL, armR, foreL, foreR, phase: 0 };
    // pose: speed in m/s, mode 'ground' | 'air' | 'sit' | 'talk'
    rig.animate = (dt, speed, mode = 'ground', t = 0) => {
      if (mode === 'sit') {
        legL.rotation.x = legR.rotation.x = -1.45; shinL.rotation.x = shinR.rotation.x = 1.45;
        armL.rotation.x = armR.rotation.x = -0.35; foreL.rotation.x = foreR.rotation.x = -0.6;
        hips.position.y = 0.5;
        return;
      }
      hips.position.y = 0.94;
      if (mode === 'air') {
        legL.rotation.x = -0.5; legR.rotation.x = 0.25; shinL.rotation.x = 0.7; shinR.rotation.x = 0.3;
        armL.rotation.x = -0.9; armR.rotation.x = 0.6; foreL.rotation.x = foreR.rotation.x = -0.4;
        return;
      }
      const run = Math.min(1, Math.max(0, (speed - 2.2) / 3));
      rig.phase += dt * (speed > 0.1 ? 2.2 + speed * 1.6 : 0);
      const s = Math.sin(rig.phase), amp = Math.min(1, speed / 1.6) * (0.55 + 0.35 * run);
      legL.rotation.x = s * amp; legR.rotation.x = -s * amp;
      shinL.rotation.x = Math.max(0, -Math.cos(rig.phase)) * amp * 1.3;
      shinR.rotation.x = Math.max(0, Math.cos(rig.phase)) * amp * 1.3;
      armL.rotation.x = -s * amp * 0.8; armR.rotation.x = s * amp * 0.8;
      foreL.rotation.x = foreR.rotation.x = -0.25 - run * 0.9;
      hips.position.y = 0.94 + Math.abs(Math.cos(rig.phase)) * 0.04 * amp;
      body.rotation.x = run * 0.18;
      if (speed < 0.1) { // idle: breathe, glance around; talking adds gestures
        const b = Math.sin(t * 1.7) * 0.012;
        hips.position.y = 0.94 + b;
        neck.rotation.y = Math.sin(t * 0.37) * 0.35;
        if (mode === 'talk') { armR.rotation.x = -0.5 + Math.sin(t * 3.1) * 0.25; foreR.rotation.x = -0.9; neck.rotation.y = 0; }
      } else neck.rotation.y *= 0.9;
    };
    return rig;
  }

  // ------------------------------------------------------------ instanced bodies, animated in the shader
  // tone: 0..3 take per-instance colours aC0..aC3; 4 glass, 5 tyre, 6 headlight, 7 tail light;
  // the Blender cars add 8 trim, 9 chrome, 10 wheel, 11 number plate, 12 taxi sign, 13 indicator,
  // and (with `cars`) their baked occlusion and a finish per tone: gloss paint, glass, metal.
  // part: 0 rigid, 1/2 left/right leg (pivot at hips), 3/4 left/right arm (pivot at shoulders)
  function toneMaterial(U, { cars = false } = {}) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
    // a car is drawn on both sides, its inside dark: where a far copy (or an arch) leaves a gap,
    // it reads as the shadowed inside of a car, not as a hole through it
    if (cars) { mat.defines = Object.assign({}, mat.defines, { TONE_CARS: '' }); mat.side = THREE.DoubleSide; }
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uNight = U.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float tone; attribute float part; attribute vec3 aC0; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aC3; attribute vec3 aAnim;
uniform float uTime; varying vec3 vCol; varying float vEmit;
#ifdef TONE_CARS
attribute float ao; varying float vAO; varying float vTone;
#endif
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float sw = sin(uTime * aAnim.y + aAnim.x) * aAnim.z;
float ang = part > 0.5 && part < 1.5 ? sw : part > 1.5 && part < 2.5 ? -sw : part > 2.5 && part < 3.5 ? -sw * 0.8 : part > 3.5 ? sw * 0.8 : 0.0;
float piv = part < 2.5 ? 0.94 : 1.49;
objectNormal = rx(ang) * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.y -= piv; transformed = rx(ang) * transformed; transformed.y += piv;
vCol = tone < 0.5 ? aC0 : tone < 1.5 ? aC1 : tone < 2.5 ? aC2 : tone < 3.5 ? aC3 : tone < 4.5 ? vec3(0.03, 0.045, 0.06) : tone < 5.5 ? vec3(0.02) : tone < 6.5 ? vec3(0.9, 0.88, 0.8) : tone < 7.5 ? vec3(0.5, 0.02, 0.02)
  : tone < 8.5 ? vec3(0.03) : tone < 9.5 ? vec3(0.8) : tone < 10.5 ? vec3(0.42, 0.43, 0.45) : tone < 11.5 ? vec3(0.78, 0.78, 0.72) : tone < 12.5 ? vec3(0.9, 0.8, 0.42) : vec3(0.7, 0.32, 0.02);
vEmit = tone > 5.5 && tone < 7.5 ? (tone < 6.5 ? 1.0 : 0.7) : tone > 11.5 && tone < 12.5 ? 0.3 : 0.0; // (a taxi's roof sign: a lit panel, not a lamp, that blooms across the car behind it)
#ifdef TONE_CARS
vAO = ao; vTone = tone;
#endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight; varying vec3 vCol; varying float vEmit;
#ifdef TONE_CARS
varying float vAO; varying float vTone;
#endif`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( vCol, opacity );
#ifdef TONE_CARS
diffuseColor.rgb *= mix(1.0, vAO, 0.45);
if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.02);
#endif`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef TONE_CARS
roughnessFactor = vTone < 1.5 ? 0.28 : vTone < 3.5 ? roughnessFactor : vTone < 4.5 ? 0.05 : vTone < 5.5 ? 0.9 : vTone < 7.5 ? 0.2 : vTone < 8.5 ? 0.6 : vTone < 9.5 ? 0.12 : vTone < 10.5 ? 0.32 : 0.45;
#endif`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef TONE_CARS
metalnessFactor = vTone > 8.5 && vTone < 10.5 ? 0.9 : 0.0;
#endif`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
#ifdef TONE_CARS
reflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;
#endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vCol * vEmit * (0.25 + 2.5 * uNight);`);
    };
    return mat;
  }
  // merge boxes into one geometry with tone and part attributes
  function boxes(list) {
    const pos = [], nrm = [], tone = [], part = [], idx = [];
    for (const [w, h, d, x, y, z, t, p] of list) {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      const base = pos.length / 3, P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); tone.push(t); part.push(p); }
      for (const i of g.index.array) idx.push(base + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('tone', new THREE.Float32BufferAttribute(tone, 1));
    g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    return g;
  }
  const PERSON = () => boxes([
    [0.38, 0.56, 0.21, 0, 1.24, 0, 0, 0], [0.19, 0.23, 0.21, 0, 1.68, 0, 2, 0], [0.21, 0.08, 0.23, 0, 1.82, 0, 3, 0],
    [0.15, 0.92, 0.15, 0.1, 0.47, 0, 1, 1], [0.15, 0.92, 0.15, -0.1, 0.47, 0, 1, 2],
    [0.14, 0.06, 0.25, 0.1, 0.03, 0.05, 5, 1], [0.14, 0.06, 0.25, -0.1, 0.03, 0.05, 5, 2],
    [0.1, 0.56, 0.1, 0.25, 1.21, 0, 0, 3], [0.1, 0.56, 0.1, -0.25, 1.21, 0, 0, 4],
    [0.09, 0.1, 0.09, 0.25, 0.88, 0, 2, 3], [0.09, 0.1, 0.09, -0.25, 0.88, 0, 2, 4],
  ]);
  const CAR = () => boxes([ // 4.4 m long, nose towards +z
    [1.8, 0.62, 4.4, 0, 0.62, 0, 0, 0], [1.6, 0.52, 2.3, 0, 1.18, -0.25, 4, 0], [1.62, 0.06, 2.1, 0, 1.47, -0.25, 0, 0],
    [0.24, 0.62, 0.62, 0.86, 0.31, 1.35, 5, 0], [0.24, 0.62, 0.62, -0.86, 0.31, 1.35, 5, 0],
    [0.24, 0.62, 0.62, 0.86, 0.31, -1.35, 5, 0], [0.24, 0.62, 0.62, -0.86, 0.31, -1.35, 5, 0],
    [0.36, 0.16, 0.05, 0.62, 0.72, 2.21, 6, 0], [0.36, 0.16, 0.05, -0.62, 0.72, 2.21, 6, 0],
    [0.36, 0.14, 0.05, 0.62, 0.74, -2.21, 7, 0], [0.36, 0.14, 0.05, -0.62, 0.74, -2.21, 7, 0],
  ]);
  function instanced(geo, mat, n) {
    for (const a of ['aC0', 'aC1', 'aC2', 'aC3', 'aAnim']) geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geo.attributes.aAnim.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }
  const setC = (attr, i, hex) => { const c = lin(hex); attr.setXYZ(i, c.r, c.g, c.b); };

  // the shared Blender cars (assets/vehicles/cars.glb): one geometry per model and distance,
  // the materials folded into tone slots and the baked occlusion into 'ao'
  function carGeometries(gltf, tones) {
    const out = {};
    gltf.scene.updateMatrixWorld(true);
    for (const node of gltf.scene.children) {
      if (/_Cabin$/.test(node.name)) continue; // seats and wheel, for the cars people get into (cars.js)
      const parts = [];
      node.traverse(o => { if (o.isMesh) parts.push(o); });
      const pos = [], nrm = [], tone = [], ao = [], idx = [];
      for (const m of parts) {
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld), P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
        const name = m.material.name.replace(/\.\d+$/, ''), t = name in tones ? tones[name] : 8, base = pos.length / 3;
        for (let i = 0; i < P.count; i++) {
          pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i));
          tone.push(t); ao.push(C ? C.getX(i) : 1);
        }
        if (g.index) for (const i of g.index.array) idx.push(base + i);
        else for (let i = 0; i < P.count; i++) idx.push(base + i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('tone', new THREE.Float32BufferAttribute(tone, 1));
      g.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
      g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
      g.setIndex(idx);
      g.computeBoundingBox();
      const [model, lod] = node.name.split('_LOD');
      (out[model] = out[model] || [])[lod ? +lod : 0] = g;
    }
    return out;
  }

  // ------------------------------------------------------------ polyline networks (footways, roads)
  function network(lines, opts = {}) {
    const L = lines.map((o, i0) => {
      const p = o.p || o, n = p.length / 3, pts = new Float32Array(n * 3), cum = new Float32Array(n);
      for (let i = 0; i < n; i++) { pts[3 * i] = p[3 * i] / 10; pts[3 * i + 1] = p[3 * i + 1] / 10; pts[3 * i + 2] = p[3 * i + 2] / 10; }
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2]);
      // deck: per segment, 1 where the line is off the ground (decks.js); ow: one-way with its points (1) or against them (-1);
      // i0: its place in the lines given; nt: the turns banned from its ends, tl the arrows on its lanes
      // (OSM's turn:lanes) at its ends (junctions.js); ntw: turns banned at some hours, tb: the hours
      // it is shut to cars (pipeline/road_rules.py); nl: OSM's count of its lanes each way (road_lanes.py);
      // wall: 1 where it starts at a wall, 2 where it ends at one (a road the data runs into a building: game.js cutAtWalls)
      return { pts, cum, len: cum[n - 1], v: o.v || 0, c: o.c || '', deck: o.d || null, ow: o.o || 0, i0, nt: o.nt || null, tl: o.tl || null, ntw: o.ntw || null, tb: o.tb || null, nl: o.nl || 0, wall: o.w || 0 };
    }).filter(l => l.len > 4);
    const key = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
    const nodes = new Map(), grid = new Map(), GC = 100;
    L.forEach((l, i) => {
      const n = l.pts.length / 3;
      for (const [end, k] of [[0, 0], [1, n - 1]]) {
        const kk = key(l.pts[3 * k], l.pts[3 * k + 1]);
        if (!nodes.has(kk)) nodes.set(kk, []);
        nodes.get(kk).push([i, end]);
      }
      for (let k = 0; k < n; k += 2) {
        const gk = `${Math.floor(l.pts[3 * k] / GC)},${Math.floor(l.pts[3 * k + 1] / GC)}`;
        if (!grid.has(gk)) grid.set(gk, new Set());
        grid.get(gk).add(i);
      }
    });
    for (const [k, v] of grid) grid.set(k, [...v]);
    function at(i, s, out) { // position and heading at distance s along line i
      const l = L[i], n = l.pts.length / 3;
      s = Math.max(0, Math.min(l.len, s));
      let k = 1;
      if (n > 6) { let hi = n - 1; while (hi - k > 0) { const m = (k + hi) >> 1; if (l.cum[m] < s) k = m + 1; else hi = m; } }
      else while (k < n - 1 && l.cum[k] < s) k++;
      const t = (s - l.cum[k - 1]) / Math.max(1e-6, l.cum[k] - l.cum[k - 1]);
      const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], az = l.pts[3 * k - 1], bx = l.pts[3 * k], by = l.pts[3 * k + 1], bz = l.pts[3 * k + 2];
      out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t; out.z = az + (bz - az) * t;
      out.deck = l.deck ? l.deck[k - 1] : 0;
      out.k = k;
      out.hx = bx - ax; out.hy = by - ay;
      const h = Math.hypot(out.hx, out.hy) || 1;
      out.hx /= h; out.hy /= h;
      return out;
    }
    // lines with a vertex in the ring between rMin and rMax around (x, y)
    function near(x, y, rMin, rMax) {
      const out = [], c0 = Math.floor((x - rMax) / GC), c1 = Math.floor((x + rMax) / GC), r0 = Math.floor((y - rMax) / GC), r1 = Math.floor((y + rMax) / GC);
      for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) {
        const d = Math.hypot((cx + 0.5) * GC - x, (cy + 0.5) * GC - y);
        if (d > rMax + GC || d < rMin - GC) continue;
        const g = grid.get(`${cx},${cy}`);
        if (g) out.push(...g);
      }
      return out;
    }
    // the closest point on any line within maxD of (x, y): {line, s, x, y, z, d} or null; with z,
    // only where the line is within dz of that height (the street you are on, not the flyover above it)
    // the nearest point on the lines within maxD of (x, y), within dz of height z (when given), and
    // with a grade, within dz + grade * the distance: a street down a slope from a raised plaza
    // (Melbourne's Federation Square) counts, a road on a deck right above or below does not;
    // skip(i): lines to pass over
    function nearest(x, y, maxD, z = null, dz = 3, grade = 0, skip = null) {
      let best = null;
      for (const i of new Set(near(x, y, 0, maxD))) {
        if (skip && skip(i)) continue;
        const l = L[i], n = l.pts.length / 3;
        for (let k = 1; k < n; k++) {
          const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], ex = l.pts[3 * k] - ax, ey = l.pts[3 * k + 1] - ay, L2 = ex * ex + ey * ey;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
          const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(x - qx, y - qy), qz = l.pts[3 * k - 1] + (l.pts[3 * k + 2] - l.pts[3 * k - 1]) * t;
          if (d < maxD && (!best || d < best.d) && (z == null || Math.abs(qz - z) < dz + grade * d)) best = { line: i, s: l.cum[k - 1] + t * Math.sqrt(L2), x: qx, y: qy, z: qz, d };
        }
      }
      return best;
    }
    // another line meeting line i's end (0 start, 1 end): [line, its end there], not one to avoid;
    // with `legal`, only one a car may drive into from there (not against a one-way street)
    // (hw: a vehicle's half-width; a street too narrow for it, api.fit, only if there is no other)
    function next(i, end, legal = false, hw = 0) {
      const l = L[i], k = end ? l.pts.length / 3 - 1 : 0, av = api.avoid;
      let opts2 = (nodes.get(key(l.pts[3 * k], l.pts[3 * k + 1])) || []).filter(o => o[0] !== i && !(av && av[o[0]]) && (!legal || L[o[0]].ow !== (o[1] === 0 ? -1 : 1)));
      if (hw && api.fit && opts2.length > 1) { const w = opts2.filter(o => api.fit[o[0]] >= hw); if (w.length) opts2 = w; }
      return opts2.length ? opts2[Math.floor(rnd() * opts2.length)] : null;
    }
    // the one line a car can drive on into from line i's end, where it simply continues (or null)
    function only(i, end) {
      const l = L[i], k = end ? l.pts.length / 3 - 1 : 0, at2 = nodes.get(key(l.pts[3 * k], l.pts[3 * k + 1])) || [];
      if (at2.length !== 2) return null;
      const o = at2[0][0] === i ? at2[1] : at2[0];
      return L[o[0]].ow !== (o[1] === 0 ? -1 : 1) && !(api.avoid && api.avoid[o[0]]) ? o : null;
    }
    // avoid: per line, 1 for a line no one should be put on or turn into (a road through a
    // building, which route.js finds); set by the game once it knows
    const api = { L, at, near: (x, y, rMin, rMax) => (api.avoid ? near(x, y, rMin, rMax).filter(i => !api.avoid[i]) : near(x, y, rMin, rMax)), nearest, next, only, nodes, key, avoid: null, fit: null }; // (fit: per line, the widest vehicle's half-width it has room for, game.js)
    return api;
  }

  // ------------------------------------------------------------ the crowd
  // the box-built crowd, for when the realistic people can't be loaded
  function boxRenderer(world, U, P) {
    const n = P.length, mesh = instanced(PERSON(), toneMaterial(U), n), A = mesh.geometry.attributes;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    world.add(mesh);
    for (let i = 0; i < n; i++) { setC(A.aC0, i, pick(SHIRTS)); setC(A.aC1, i, pick(PANTS)); setC(A.aC2, i, pick(SKIN)); setC(A.aC3, i, pick(HAIR)); }
    return {
      meshes: [mesh],
      begin() {},
      hide(i) { mesh.setMatrixAt(i, zero); },
      place(i, p, moving) {
        q.setFromAxisAngle(up, Math.PI - p.h); // models face +z; local heading is clockwise from north
        m4.compose(W(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
        mesh.setMatrixAt(i, m4);
        A.aAnim.setXYZ(i, p.phase, 2.2 + p.speed * 1.6, moving ? 0.5 : 0);
        p.wave = false;
      },
      end() { mesh.instanceMatrix.needsUpdate = true; A.aAnim.needsUpdate = true; },
    };
  }
  // ------------------------------------------------------------ benches: places to sit
  // Each bench is a smart object in the sense of Unreal's Smart Objects (find, claim, use,
  // release), placed from open data the way GTA V places its scenario points: two seats, a
  // facing, and the point on a footway where a walker leaves the path for it. It advertises
  // sun or shade, as objects advertise what they offer in The Sims; game.js keeps `lit` up to
  // date and decides how much that matters today.
  function benches(flat, net, nav) {
    const list = [], byLine = new Map(), tmp = {};
    const fwd = h => [Math.sin(h), Math.cos(h)];
    const waterAhead = (x, y, h) => { const [fx, fy] = fwd(h); for (let d = 6; d <= 40; d += 4) if (nav.isWater(x + fx * d, y + fy * d)) return true; return false; };
    // a facing is better with water ahead and a wall behind, and bad facing a wall
    const score = (x, y, z, h) => {
      const [fx, fy] = fwd(h);
      return (waterAhead(x, y, h) ? 2 : 0) + (nav.walk(x - fx * 1.2, y - fy * 1.2, z).ok ? 0 : 0.5) - (nav.walk(x + fx * 1.2, y + fy * 1.2, z).ok ? 0 : 2);
    };
    // can a walker get from the footway to the seat without meeting a wall, the water or a step?
    const wayClear = (q, st) => {
      const d = Math.hypot(st.x - q.x, st.y - q.y), n = Math.max(1, Math.ceil(d / 0.5));
      for (let k = 0; k <= n; k++) {
        const w = nav.walk(q.x + (st.x - q.x) * k / n, q.y + (st.y - q.y) * k / n, st.z);
        if (!w.ok || Math.abs(w.z - st.z) > 0.6) return false;
      }
      return true;
    };
    for (let i = 0; i < flat.length / 3; i++) {
      const x = flat[3 * i] / 10, y = flat[3 * i + 1] / 10, z = flat[3 * i + 2] / 10, q = net.nearest(x, y, 12);
      let h = (i * 2.399) % Math.PI; // nowhere near a footway: any way round
      if (q) { // face the footway, or turn round to the view if there is water behind it
        net.at(q.line, q.s, tmp);
        const hp = q.d > 0.6 ? Math.atan2(q.x - x, q.y - y) : Math.atan2(tmp.hx, tmp.hy) + Math.PI / 2;
        let best = -Infinity;
        for (const [hh, base] of [[hp, q.d > 0.6 ? 1 : 0], [hp + Math.PI, 0]]) { const v = base + score(x, y, z, hh); if (v > best) { best = v; h = hh; } }
      }
      const [fx, fy] = fwd(h), b = { i, x, y, z, h, seats: [], line: -1, s: 0, lit: null };
      for (const a of [-0.42, 0.42]) b.seats.push({ x: x + Math.cos(h) * a - fx * 0.08, y: y - Math.sin(h) * a - fy * 0.08, z, h, by: -1, bench: b });
      if (q && b.seats.every(st => wayClear(q, st))) {
        b.line = q.line; b.s = q.s;
        if (!byLine.has(q.line)) byLine.set(q.line, []);
        byLine.get(q.line).push(b);
      }
      list.push(b);
    }
    let cursor = 0;
    // re-test what the benches within r of (cx, cy) offer, a few per call: test(bench) -> true (sun), false (shade) or null (night)
    function refresh(test, cx, cy, r, budget) {
      for (let k = 0; k < list.length && budget > 0; k++) {
        const b = list[cursor = (cursor + 1) % list.length];
        if (b.line < 0 || Math.abs(b.x - cx) > r || Math.abs(b.y - cy) > r) continue;
        b.lit = test(b);
        budget--;
      }
    }
    return { list, byLine, refresh, usable: byLine.size ? [...byLine.values()].reduce((a, l) => a + l.length, 0) : 0 };
  }

  // ------------------------------------------------------------ walking, stepping aside, sitting down
  // Walkers follow footway lines with a sideways offset, keeping left. They avoid each other
  // and the player as RVO and Detour Crowd do, but on the lane: each looks ahead for whoever
  // it will pass too close to within a few seconds, steps aside within the footway's width,
  // and slows to match whoever it can't get round. Benches and cars (`cars`, which traffic()
  // sets) are in the way the same way, a car as a row of discs along its length; and a walker
  // never steps into a car's footprint, a bench or another walker, but waits, and turns back
  // if the way stays blocked. A walker passing a bench with a free seat may claim it
  // (benches(), and `sitChance`, which game.js sets), walk over, sit a while, and walk on.
  // At a junction with signals (`crossings`, which game.js sets from junctions.js) a walker
  // coming up to a road its traffic may go on waits at the kerb and presses the button, and
  // crosses when the walk signal shows.
  const HORIZON = 4;   // seconds of look-ahead
  const BODY = 0.8;    // two walkers closer than this are in each other's way (m, centre to centre)
  const CLOSE = 0.56;  // a walker never steps closer than this to another (m, centre to centre): a
                       // Rocketbox body is about 0.45 m across the shoulders and its arms swing out, so
                       // two passing at this keep a hand's width between them rather than show inside each other
  const HALF = 0.3;    // a walker's own half-width, for the room it gives a bench or a post
  const KERB = 0.45;   // how far a walker keeps from a car's side or bumper (m, centre to body)
  const HOT_MIN = 45;  // how near the player a walker may be put where the crowd gathers (m: lost in the crowd there)
  const SCR_HW = 3.4;  // the half-width of a scramble's crosswalk the crowd spreads across (m: Shibuya's are about 8 m wide)
  const POST = 0.25;   // and from a lamp post or a trunk
  const MOVING = 1.2;  // and the seconds of a moving car's path ahead it won't step into
  const NEAR = 60, FAR = 150; // walkers farther than these from the player take a step every 2nd, 4th frame (m)
  // ground(x, y, at): the height to stand at beside the line at `at` (net.at), or null where no one can stand;
  // wall(x, y, z): is that inside a building's wall? posts: the lamp posts and trunks (streets.js), solid;
  // clear(x, y, z): whether someone standing there is clear of the walls (a facade the footway runs along)
  const WALL_LOOK = 1.5; // how far ahead a walker looks for a wall beside its line (m)
  function crowd(world, net, U, n, radius, makeRenderer, { benches: BN = null, ground = null, wall = null, posts: PO = null, clear = null } = {}) {
    const P = [], tmp = {}, ahead = {};
    for (let i = 0; i < n; i++) P.push({ line: -1, s: 0, dir: 1, speed: 1.1 + rnd() * 0.6, phase: rnd() * 6.28, side: 0.6 + rnd() * 1.2, spread: rnd() * 2 - 1, lat: null, dodge: 0, v: 0, vx: 0, vy: 0,
      pause: 0, x: 0, y: 0, z: 0, h: 0, scale: 0.92 + rnd() * 0.16, state: 'walk', mode: 'ground', seat: null, t: 0, rest: rnd() * 30 });
    const R = makeRenderer ? makeRenderer(P) : boxRenderer(world, U, P);
    // a point along a line and its heading (net.at), the heading turned smoothly through each bend over
    // a metre or so either side of the vertex: walkers keep their offset across the footway from it, so
    // with the bare segment's heading one well out to the side would jump round the corner in a step
    function lineAt(i, s, out) {
      net.at(i, s, out);
      const l = net.L[i], c = l.cum, pts = l.pts, n = pts.length / 3, k = out.k;
      if (!c || n < 3) return out;
      s = Math.max(0, Math.min(l.len, s));
      const v = s - c[k - 1] < c[k] - s ? k - 1 : k;
      if (v <= 0 || v >= n - 1) return out;
      const R = Math.min(1.5, (c[v] - c[v - 1]) / 2, (c[v + 1] - c[v]) / 2), d = s - c[v];
      if (!(R > 0.05) || Math.abs(d) >= R) return out;
      let ax = pts[3 * v] - pts[3 * v - 3], ay = pts[3 * v + 1] - pts[3 * v - 2], bx = pts[3 * v + 3] - pts[3 * v], by = pts[3 * v + 4] - pts[3 * v + 1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1, f = (d + R) / (2 * R);
      ax = ax / la * (1 - f) + bx / lb * f; ay = ay / la * (1 - f) + by / lb * f;
      const h = Math.hypot(ax, ay);
      if (h > 1e-3) { out.hx = ax / h; out.hy = ay / h; }
      return out;
    }
    function release(p) { if (p.seat) { p.seat.by = -1; p.seat = null; } }
    function respawn(p, cx, cy, rMin) {
      release(p);
      p.fx = p.gx = p.av = null; p.moving = false; // (somewhere new: nothing of the pace or the way it went before)
      p.state = 'walk'; p.mode = 'ground'; p.lat = null; p.side = 0.6 + rnd() * 1.2; p.kerbNext = null; p.kerbBack = false;
      // (a share of them where the crowd gathers, api.hot: a scramble; out of the player's way there)
      const H = api.hot && api.hot.filter(h => Math.hypot(h.x - cx, h.y - cy) < radius);
      const hot = H && H.length && rnd() < H.reduce((a, h) => a + h.share, 0) ? H[Math.floor(rnd() * H.length)] : null;
      const cand = hot ? net.near(hot.x, hot.y, 0, hot.r).filter(i => near1(net.L[i], hot.x, hot.y, hot.r)) : net.near(cx, cy, rMin, radius);
      const rMe = hot ? Math.min(rMin, HOT_MIN) : 0;
      p.line = -1;
      for (let k = 0; k < (hot ? 8 : 4) && cand.length; k++) { // somewhere clear of the cars and benches
        const line = cand[Math.floor(rnd() * cand.length)], s = rnd() * net.L[line].len, dir = rnd() < 0.5 ? 1 : -1;
        lineAt(line, s, tmp);
        const x = tmp.x - tmp.hy * dir * p.side, y = tmp.y + tmp.hx * dir * p.side;
        if (hot && (Math.hypot(x - hot.x, y - hot.y) > hot.r || Math.hypot(x - cx, y - cy) < rMe)) continue;
        const X = api.crossings && api.crossings.byLine.get(line);
        if (X && X.some(q => Math.abs(q.s - s) < q.kerb + 0.5)) continue; // (not out in a road at a crossing)
        if (api.crossings && api.crossings.major && api.crossings.road && api.crossings.road(tmp.x, tmp.y) && api.crossings.major(tmp.x, tmp.y)) continue; // (nor out in a major road)
        gather(x, y, p, true, tmp.z);
        if (blocked(x, y) > 0 || (wall && wall(x, y, tmp.z)) || crowded(x, y, p, CLOSE + 0.1)) continue;
        p.line = line; p.s = s; p.dir = dir;
        return;
      }
    }
    const api = { R, P, active: n, benches: BN, cars: null, sitChance: () => 0, crossings: null, kerbWait: 0, kerbWaits: [], hot: null, plazas: null, muster };
    // where footway li steps off the kerb onto a road with no crossing marked there, each way along it
    // ({ s, dir, x, y }): found the first time a walker is on it, a metre at a time (crossings.road, from
    // game.js, says what is carriageway; crossings.zebra, a zebra's stripes, where the cars give way instead)
    const entries = new Map();
    function roadEntries(li) {
      let E = entries.get(li);
      if (E) return E;
      E = [];
      const l = net.L[li], C = api.crossings, n = Math.max(1, Math.ceil(l.len));
      let was = null;
      for (let k = 0; k <= n; k++) {
        const s = Math.min(l.len, k * l.len / n);
        net.at(li, s, tmp);
        const on = !!C.road(tmp.x, tmp.y);
        // (a footway that crosses the road there, not one along the kerb that dips into the carriageway's edge)
        if (was !== null && on !== was && !(C.zebra && C.zebra(tmp.x, tmp.y)) && (!C.across || C.across(tmp.x, tmp.y, tmp.hx, tmp.hy))) E.push({ s, dir: on ? 1 : -1, x: tmp.x, y: tmp.y, major: !!(C.major && C.major(tmp.x, tmp.y)) });
        was = on;
      }
      // (a footway that lies out in a major road its whole length, never stepping off a kerb, a crossing mapped as a
      // footway without its signals or stripes: crossed away from a crosswalk all the same; Tetsugaku's footway 952
      // in a secondary road, where walkers stood in the road)
      const all = was && E.length === 0 && C.major && (() => { net.at(li, l.len / 2, tmp); return !!C.road(tmp.x, tmp.y) && !!C.major(tmp.x, tmp.y) && !(C.zebra && C.zebra(tmp.x, tmp.y)); })();
      if (all && !(C.byLine && (C.byLine.get(li) || []).length)) { E.push({ s: 0, dir: 1, x: tmp.x, y: tmp.y, major: true }, { s: l.len, dir: -1, x: tmp.x, y: tmp.y, major: true }); }
      // (a major road, C.major: crossed only at a crosswalk, its signals or a zebra, as the law asks where one
      // is near (Japan's Road Traffic Act, art. 12; the UK's Highway Code, rule 8) and as a city's crowd does;
      // where the footway's step off the kerb is a signalled junction's own crossing, it is that crossing)
      const X = C.byLine && C.byLine.get(li);
      for (const e of E) if (e.major && X && X.some(x => Math.abs(x.s - e.s) < x.kerb + 2.5)) e.major = false;
      E.banned = [E.some(e => e.major && e.dir === -1), E.some(e => e.major && e.dir === 1)]; // (walking against, along the line)
      if (entries.size > 3000) entries.clear(); // (only the footways walked near you are kept)
      entries.set(li, E);
      return E;
    }
    // is a car (of the traffic, your car or a ride) coming that would reach (x, y) within 3.5 s?
    function carComing(x, y, z) {
      let yes = false;
      api.cars.near(x, y, 35, o => {
        if (yes || (o.v || 0) < 0.8) return;
        const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, a = dx * fx + dy * fy;
        if (a < -o.half || Math.abs(-dx * fy + dy * fx) > (o.hw || 0.9) + 1.6) return;
        if ((a - o.half) / o.v < 3.5) yes = true;
      }, z);
      return yes;
    }
    const near1 = (l, x, y, r) => { for (let k = 0; k < l.pts.length; k += 3) if (Math.hypot(l.pts[k] - x, l.pts[k + 1] - y) < r) return true; return false; };
    // would a walker set off at s along line `line` heading `dir` be out in a road at a crossing
    // whose walk isn't on (or, at a scramble, too short for it to reach the far kerb)? Then its button is pressed
    function heldAt(line, s, dir, p) {
      const C = api.crossings, X = C && C.byLine.get(line);
      if (!X) return false;
      for (const x of X) {
        const d = Math.abs(x.s - s);
        if (d >= x.kerb) continue;
        const far = (x.s - s) * dir + x.kerb;
        if (x.at && toPlaza(p, x.at)) return 'plaza';
        if (!C.walk(x.a) || (x.scramble && C.walkLeft(x.a) < far / (p.speed * 0.65))) { C.call(x.a); return true; }
      }
      return false;
    }
    // where a walker goes on at the end of its line: any way on, and near a place the crowd gathers
    // (api.hot), more often the way towards it, so that the crowd stays thick there
    // a way on that doesn't lead across a major road away from a crossing (roadEntries): a few tries, or none
    function nextOk(line, end) {
      let o = null;
      for (let k = 0; k < 6; k++) {
        o = net.next(line, end);
        if (!o || !banned(o[0], o[1] === 0 ? 1 : -1)) return o;
      }
      return null;
    }
    const banned = (li, dir) => { const C = api.crossings; if (!C || !C.road || !C.major) return false; const B = roadEntries(li).banned; return !!(B && B[dir > 0 ? 1 : 0]); };
    function onward(p, end) {
      let nx = nextOk(p.line, end);
      const h = nx && api.hot && api.hot.find(q => Math.hypot(p.x - q.x, p.y - q.y) < q.r * 1.6);
      if (h && rnd() < h.pull) {
        const far = o => { const l = net.L[o[0]], k = o[1] === 0 ? l.pts.length - 3 : 0; return Math.hypot(l.pts[k] - h.x, l.pts[k + 1] - h.y); };
        let best = null, bd = Math.hypot(p.x - h.x, p.y - h.y) - 2; // (only a way that does lead nearer: no back and forth in a pocket)
        for (let k = 0; k < 4; k++) { const o = nextOk(p.line, end), d = o && far(o); if (o && d < bd) { best = o; bd = d; } }
        if (best) nx = best;
      }
      return nx;
    }
    // a crowd gathered somewhere at once (the scramble as the game opens on its walk): each of `spots`
    // ({ line, s, dir, side: its place across the footway, m }) takes the walker farthest from (cx, cy), placed on the next step
    function muster(spots, cx, cy) {
      const order = P.slice(0, api.active).map((q, i) => [i, q.line < 0 ? 1e9 : Math.hypot(q.x - cx, q.y - cy)]).sort((a, b) => b[1] - a[1]);
      // spaced out: a spot within a body's width of one already taken moves along or across a little,
      // or is dropped, so no two of the gathered crowd stand inside each other
      const taken = [], at = (sp, o) => { lineAt(sp.line, Math.max(0, Math.min(net.L[sp.line].len, sp.s + o[0])), tmp); const sd = (sp.side ?? 1) + o[1]; return [tmp.x - tmp.hy * sp.dir * sd, tmp.y + tmp.hx * sp.dir * sd]; };
      const OFF = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.6, 0.6], [-0.6, -0.6], [1.2, 0], [-1.2, 0]];
      spots = spots.map(sp => {
        for (const o of OFF) {
          const xy = at(sp, o);
          if (taken.some(t => Math.hypot(t[0] - xy[0], t[1] - xy[1]) < CLOSE + 0.08)) continue;
          taken.push(xy);
          return Object.assign({}, sp, { s: sp.s + o[0], side: (sp.side ?? 1) + o[1] });
        }
        return null;
      }).filter(Boolean);
      spots.slice(0, order.length).forEach((sp, k) => {
        const q = P[order[k][0]];
        release(q);
        q.state = 'walk'; q.mode = 'ground'; q.lat = null; q.side = sp.side ?? 0.3 + rnd() * 1.4; q.pause = 0; q.still = 0; q.wait = 0;
        q.line = sp.line; q.s = Math.max(0, Math.min(net.L[sp.line].len, sp.s)); q.dir = sp.dir;
        lineAt(q.line, q.s, tmp); q.x = tmp.x; q.y = tmp.y; q.z = tmp.z; // (walk() puts it beside the line)
      });
      return Math.min(spots.length, order.length);
    }
    // the benches as obstacles: for each 4 m cell, those in it and the cells round it
    const benchAt = new Map(), bkey = (cx, cy) => (cx + 8192) * 16384 + cy + 8192; // a small integer key, for speed
    if (BN) for (const b of BN.list) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const k = bkey(Math.floor(b.x / 4) + a, Math.floor(b.y / 4) + c);
      if (!benchAt.has(k)) benchAt.set(k, []);
      benchAt.get(k).push(b);
    }
    // the cars, benches and posts near a walker: the benches each step, the cars and posts every
    // other (a little farther out; where the cars are is read as they move)
    const none = [];
    let nearBenches = none, nearCars = none, nearPosts = none;
    const addCar = o => { nearCars.push(o); }, addPost = o => { if (o.kind !== 'signal') nearPosts.push(o); }; // (not the junctions' poles: solid for the cars, but a walker steering round a walk signal's post at the kerb, where the crossing begins, is pushed out into the road and stands in the traffic's way)
    function gather(x, y, q, fresh, z) { // (z: the cars on that level, not on a deck over it or a street under it)
      nearBenches = benchAt.size ? benchAt.get(bkey(Math.floor(x / 4), Math.floor(y / 4))) || none : none;
      nearCars = q.cars || (q.cars = []);
      nearPosts = q.posts || (q.posts = []);
      if (!fresh) return;
      nearCars.length = 0; nearPosts.length = 0;
      if (api.cars) api.cars.near(x, y, 10, addCar, z);
      if (PO) PO.near(x, y, 3, addPost, z);
    }
    // how deep (x, y) is in those benches, posts and cars' footprints and the paths the moving
    // ones are about to take, each grown by the room a walker keeps: 0 when clear
    function blocked(x, y, benches = true) {
      let deep = 0;
      for (const o of nearPosts) { const e = o.r + POST - Math.hypot(x - o.x, y - o.y); if (e > 0) deep += e; }
      if (benches) for (const bn of nearBenches) {
        const fx = Math.sin(bn.h), fy = Math.cos(bn.h), dx = x - bn.x, dy = y - bn.y;
        const ea = 0.22 + 0.25 - Math.abs(dx * fx + dy * fy), eb = 0.85 + 0.25 - Math.abs(-dx * fy + dy * fx);
        if (ea > 0 && eb > 0) deep += Math.min(ea, eb);
      }
      for (const o of nearCars) {
        const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, a = dx * fx + dy * fy;
        const ea = Math.min(a + o.half + KERB, o.half + KERB + o.v * MOVING - a), eb = o.hw + KERB - Math.abs(-dx * fy + dy * fx);
        if (ea > 0 && eb > 0) deep += Math.min(ea, eb);
      }
      return deep;
    }
    // neighbours: a spatial hash of 3 m cells (bucket heads and a next-in-bucket chain)
    const CELL = 3, NB = 4096, head = new Int32Array(NB), chain = new Int32Array(n);
    const bucket = (cx, cy) => ((cx * 73856093) ^ (cy * 19349663)) & (NB - 1);
    // what agent p does about another body at (ox, oy) moving at (ovx, ovy): sets push (sideways, + = left) and cap (speed)
    let p = null, hx = 0, hy = 0, push = 0, cap = 0;
    // the walker it slows for (seeJ: whose body see() is looking at, -1 for anything else): its index,
    // how far ahead and how far across (+ = to the left) it is
    let seeJ = -1, blk = -1, blkAhead = 0, blkLat = 0;
    function see(ox, oy, ovx, ovy, rr, w) {
      const dx = ox - p.x, dy = oy - p.y, d2 = dx * dx + dy * dy;
      if (d2 > 36) return;
      const wx = p.vx - ovx, wy = p.vy - ovy, w2 = wx * wx + wy * wy; // closing velocity
      let t = w2 > 1e-4 ? (dx * wx + dy * wy) / w2 : 0;             // time of closest approach
      if (t < 0) { if (d2 >= rr * rr) return; t = 0; }
      t = Math.min(t, HORIZON); // someone gaining slowly is still in the way
      const cx = dx - wx * t, cy = dy - wy * t, c = Math.hypot(cx, cy);
      if (c >= rr) return;
      const u = (1 - c / rr) * Math.min(1, 1.5 / (t + 0.5)) * w; // the sooner, the stronger
      // step away from the side it is on now (judged by where it will be, both would mirror each
      // other's sidestep and cross into each other); dead ahead, pass on the right
      const now = dx * -hy + dy * hx, then = cx * -hy + cy * hx;
      push += (Math.abs(now) > 0.05 ? now : then) > 0 ? -u : u;
      const ahead = dx * hx + dy * hy;
      // slow for it only on a course that would really meet it: another walker it will pass a body's
      // width clear of it steps round (push) without braking
      if (ahead > 0 && (seeJ < 0 || c < CLOSE + 0.12)) {
        const v = Math.max(0, ovx * hx + ovy * hy) + Math.max(0, ahead - (seeJ < 0 ? rr : CLOSE + 0.12)) * 0.8;
        if (v < cap) { cap = v; if (seeJ >= 0) { blk = seeJ; blkAhead = ahead; blkLat = now; } }
      }
    }
    // how close the nearest other walker (or the player, given a little more room) is to
    // (x, y), up to CLOSE (of the nn neighbours walk() found)
    const nbr = new Int32Array(n);
    let nn = 0;
    function closest(x, y, player) {
      let best = player ? Math.min(CLOSE, Math.hypot(player.x - x, player.y - y) - (player.r || 0.15)) : CLOSE;
      for (let k = 0; k < nn; k++) { const o = P[nbr[k]], dx = o.x - x, dy = o.y - y; if (Math.abs(dx) < best && Math.abs(dy) < best) best = Math.min(best, Math.hypot(dx, dy)); }
      return best;
    }
    // whether any other walker (on the ground, walking or sitting) is within r of (x, y): the
    // neighbour hash as this step began, for those placed or moved outside walk()
    function crowded(x, y, self, r) {
      const c0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let j = head[bucket(c0 + a, r0 + b)]; j >= 0; j = chain[j]) {
          const o = P[j];
          if (o !== self && o.line >= 0 && Math.abs(o.x - x) < r && Math.abs(o.y - y) < r && Math.hypot(o.x - x, o.y - y) < r) return true;
        }
      }
      return false;
    }
    function seeCar(o) { // a row of discs along the car, each as wide as the car
      const fx = Math.sin(o.h), fy = Math.cos(o.h), k = Math.max(1, Math.round(o.half / o.hw)), r = o.hw + KERB;
      for (let j = 0; j < k; j++) {
        const u = k === 1 ? 0 : -o.half + o.hw + (2 * o.half - 2 * o.hw) * j / (k - 1);
        see(o.x + fx * u, o.y + fy * u, fx * o.v, fy * o.v, r, 1.4);
      }
    }
    // walker q, beside the line at tmp: on the ground drawn there; off the bank of the water, closer in to the line
    function settle(q) {
      for (let k = 0; (ground || wall) && k < 3; k++) {
        const z = ground ? ground(q.x, q.y, tmp) : tmp.z;
        if (z != null && !(wall && k < 2 && wall(q.x, q.y, z))) { q.z = z; break; } // (in a wall beside the line: closer in)
        q.lat = k < 1 ? q.lat / 2 : 0;
        if (z != null) q.side = Math.max(0.3, Math.min(q.side, Math.abs(q.lat))); // and keep in from that wall
        q.x = tmp.x - q.hy * q.lat; q.y = tmp.y + q.hx * q.lat;
      }
    }
    // the offset nearest `want` (sideways from the line, + = left of the way it walks) that keeps a walker
    // out of the walls here and WALL_LOOK ahead: tried from `want` in 0.2 m steps in to the line, then out
    // the other side; `want` itself where nowhere is clear (the line grazing a corner). walk() moves the
    // walker's offset towards it no faster than a sidestep, so it closes in on a facade, never jumps
    function wallFree(q, want, hw) {
      if (!clear) return want;
      lineAt(q.line, Math.max(0, Math.min(net.L[q.line].len, q.s + q.dir * WALL_LOOK)), ahead);
      const ok = lat => {
        for (const a of [tmp, ahead]) {
          const hx = a.hx * q.dir, hy = a.hy * q.dir, x = a.x - hy * lat, y = a.y + hx * lat, z = ground ? ground(x, y, a) : a.z;
          if (z == null || !clear(x, y, z)) return false;
        }
        return true;
      };
      if (ok(want)) return want;
      const sg = want >= 0 ? 1 : -1;
      for (let l = want - sg * 0.2; l * sg > 0; l -= sg * 0.2) if (ok(l)) return l;
      for (let l = 0; Math.abs(l) <= hw + 1e-6; l -= sg * 0.2) if (ok(l)) return l;
      return want;
    }
    function backTo(q) { // the point on the footway a walker returns to from a bench
      q.dir = rnd() < 0.5 ? 1 : -1;
      lineAt(q.line, q.s, tmp);
      q.back = { x: tmp.x - tmp.hy * q.dir * q.side, y: tmp.y + tmp.hx * q.dir * q.side, z: tmp.z };
    }
    // ------------------------------------------------ a scramble's own crowd
    // api.plazas (game.js, from junctions.js): per scramble { x, y, spans: its crosswalks kerb to kerb
    // [ax, ay, az, bx, by, bz], walk(), left() }. Near the player a share of the crowd is the
    // scramble's: massed on the pavement behind the kerbs where its crosswalks land, deeper the more
    // wait, each stepping out when the walk comes on (a moment's reaction, the front rows first, and
    // only with the time to make the far kerb); then out across the broad stripes to the far side,
    // the diagonal too, free in the road as the real crowd is: not in single file but weaving
    // through those coming the other way, a little to the left as they meet, so that lanes form as
    // they do in any thick crossing flow (Helbing and Molnar's social forces). On the far side it
    // strolls to a kerb of that corner and waits again; away from the player it goes back to the footways.
    const PLAZA_SHARE = 0.3, PLAZA_R = 0.8; // (of the crowd; within this share of its radius of the player)
    function gatesOf(pz) {
      if (pz.gates) return pz.gates;
      const G = [];
      for (const w of pz.spans) {
        const len = Math.hypot(w[3] - w[0], w[4] - w[1]);
        if (len < 4) continue;
        const ux = (w[3] - w[0]) / len, uy = (w[4] - w[1]) / len;
        const a = { x: w[0], y: w[1], z: w[2], ox: -ux, oy: -uy, len, n: 0 }, b = { x: w[3], y: w[4], z: w[5], ox: ux, oy: uy, len, n: 0 };
        a.partner = b; b.partner = a; G.push(a, b);
      }
      // (a crosswalk landing in a road, at an island or another street, isn't one to wait at either end of)
      const on = (g, d, u) => pz.road && pz.road(g.x + g.ox * d - g.oy * u * SCR_HW, g.y + g.oy * d + g.ox * u * SCR_HW);
      const off = g => spotAt(g, 0, 0.8, {}, pz.road).ok !== false; // (and somewhere off the road behind it to wait)
      const ok = G.filter(g => !(on(g, 3, 0) && on(g, 5, 0)) && !(on(g.partner, 3, 0) && on(g.partner, 5, 0)) && off(g) && off(g.partner));
      for (const g of ok) g.corner = ok.filter(h => h !== g && h !== g.partner && Math.hypot(h.x - g.x, h.y - g.y) < 16);
      return (pz.gates = ok);
    }
    // a place to wait at gate g, behind its kerb (u: across the stripes' width, -1 to 1), or to land at
    // it; drawn in towards the stripes' line, and nearer the kerb, where that would be in a road
    function spotAt(g, u, depth, out, road = null) {
      for (let k = 0; k < 6; k++) {
        out.x = g.x + g.ox * depth - g.oy * u * SCR_HW; out.y = g.y + g.oy * depth + g.ox * u * SCR_HW;
        if (!road || !road(out.x, out.y)) return out;
        u *= 0.6; depth = 0.8 + (depth - 0.8) * 0.6;
      }
      // (still in a road at the kerb: further back from it, on the stripes' line, where the pavement is; a spot left
      // in the road massed its crowd on the carriageway, where it held the signals' all-red and the cars' greens,
      // Shinjuku's 1106, #264)
      for (const d of [1.5, 2.5, 3.5, 5, 6.5]) {
        out.x = g.x + g.ox * d; out.y = g.y + g.oy * d;
        if (!road(out.x, out.y)) return out;
      }
      out.ok = false;
      return out;
    }
    function toGate(q, g, depth) { // to wait at gate g
      if (q.g) q.g.n--;
      q.g = g; g.n++; q.ph = 'stroll'; q.react = 0.2 + rnd() * 2.2;
      spotAt(g, q.spread, depth != null ? depth : 0.7 + Math.max(0, Math.min(3.5, g.n * 0.07)) + rnd() * 1.6, q.T || (q.T = {}), q.pz && q.pz.road);
    }
    function plazas(t, cx, cy) {
      // (the share split between those near, a landmark's the most)
      const near = (api.plazas || []).filter(q => Math.hypot(q.x - cx, q.y - cy) < radius * PLAZA_R && gatesOf(q).length), W = near.reduce((a, q) => a + (q.weight || 1), 0) || 1;
      for (const pz of api.plazas || []) {
        const G = gatesOf(pz);
        if (!G.length) continue;
        const want = near.includes(pz) ? Math.min(G.reduce((a, h) => a + h.len * 0.32, 0), Math.round(api.active * PLAZA_SHARE * (pz.weight || 1) / W)) : 0; // (no more than its crosswalks can carry)
        let have = 0;
        for (let i = 0; i < api.active; i++) if (P[i].pz === pz) have++;
        // (more than its share: with the player gone, back to the footways at once, out of sight; else
        // each leaves along a footway as it reaches the far side, pz.owe)
        if (!want) for (let i = 0; i < api.active && have > 0; i++) { const q = P[i]; if (q.pz === pz && q.ph !== 'cross') { release(q); if (q.g) q.g.n--; q.pz = q.g = null; q.state = 'walk'; q.line = -1; have--; } }
        pz.owe = Math.max(0, have - want);
        // (taken from those well out of sight, or all at once as the game starts)
        for (let i = 0; i < api.active && have < want; i++) {
          const q = P[i];
          if (q.pz || q.state !== 'walk' || (t >= 1 && q.line >= 0 && Math.hypot(q.x - cx, q.y - cy) < 120)) continue;
          const g = G[Math.floor(rnd() * G.length)];
          q.pz = pz; q.state = 'scr'; q.mode = 'ground'; q.line = Math.max(0, q.line); q.g = null; q.pause = 0;
          toGate(q, g);
          q.x = q.T.x; q.y = q.T.y; q.z = g.z; q.ph = 'wait'; q.v = q.vx = q.vy = 0; q.h = Math.atan2(-g.ox, -g.oy);
          gather(q.x, q.y, q, true, q.z);
          if (carDepth(q.x, q.y) > 0) { g.n--; q.pz = q.g = null; q.state = 'walk'; q.line = -1; continue; } // (not put inside a car waiting there)
          have++;
        }
      }
    }
    // the crowd on the footways and a scramble's own trade places at its kerbs: one walking up to it
    // joins those waiting there (they cross the scramble's way, free of the footways' single file),
    // and one of them, on the far side, walks off along the footway it stands by
    function toPlaza(p, j, reach = 9) {
      const pz = j.plaza, G = pz && pz.gates;
      if (!G || !G.length || !api.plazas || !api.plazas.includes(pz)) return false;
      let g = null, bd = reach;
      for (const h of G) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; g = h; } }
      if (!g) return false;
      release(p);
      p.pz = pz; p.state = 'scr'; p.mode = 'ground'; p.g = null; p.kerbNext = null; p.kerbBack = false;
      toGate(p, g, 0.7 + rnd() * 1.5);
      p.vx = p.vy = 0;
      return true;
    }
    // walker p (on the footways) joins scramble pz's crowd where it stands, waiting at its nearest kerb
    function joinPlaza(p, pz) {
      const G = pz.gates;
      if (!G || !G.length || !api.plazas || !api.plazas.includes(pz) || (pz.road && pz.road(p.x, p.y))) return false;
      let g = null, bd = 16;
      for (const h of G) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; g = h; } }
      if (!g) return false;
      release(p);
      p.pz = pz; p.state = 'scr'; p.mode = 'ground'; p.g = null; p.kerbNext = null; p.kerbBack = false;
      toGate(p, g, 0.7);
      p.T.x = p.x; p.T.y = p.y; p.ph = 'wait'; p.vx = p.vy = 0;
      return true;
    }
    function toFootway(q) {
      const near = net.nearest(q.x, q.y, 6, q.z, 2);
      if (!near) return false;
      const X = api.crossings && api.crossings.byLine.get(near.line);
      if (X && X.some(x => Math.abs(x.s - near.s) < x.kerb + 0.5)) return false; // (not out in the road)
      net.at(near.line, near.s, tmp);
      const j = q.pz.j, away = (tmp.x - j.x) * tmp.hx + (tmp.y - j.y) * tmp.hy >= 0 ? 1 : -1; // (on away from the scramble)
      if (q.g) q.g.n--;
      q.pz = q.g = null; q.state = 'walk'; q.mode = 'ground';
      q.line = near.line; q.s = near.s; q.dir = away;
      q.hx = tmp.hx * away; q.hy = tmp.hy * away;
      q.lat = q.lim = (q.x - tmp.x) * -q.hy + (q.y - tmp.y) * q.hx; q.limWant = q.side = Math.max(0.3, Math.min(1.8, Math.abs(q.lat)));
      q.dodge = 0; q.v = Math.hypot(q.vx, q.vy);
      return true;
    }
    const ZAT = { z: 0, deck: 0 };
    function carDepth(x, y, m = 0.3) { // how deep (x, y) is in the cars near (gathered): each its box, grown m all round (the corners too)
      let deep = 0;
      for (const o of nearCars) {
        const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y;
        const ea = o.half + m - Math.abs(dx * fx + dy * fy), eb = o.hw + m - Math.abs(-dx * fy + dy * fx);
        if (ea > 0 && eb > 0) deep += Math.min(ea, eb);
      }
      return deep;
    }
    // how far the nearest other walker is from (x, y), up to 1 m (the neighbour hash as this step began)
    function nearest1(self, x, y) {
      let best = 1;
      const c0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let k = head[bucket(c0 + a, r0 + b)]; k >= 0; k = chain[k]) {
          if (k === self) continue;
          const o = P[k], ex = o.x - x, ey = o.y - y;
          if (o.line < 0 || Math.abs(ex) > best || Math.abs(ey) > best) continue;
          const e = Math.hypot(ex, ey);
          if (e < best) best = e;
        }
      }
      return best;
    }
    // a scramble's crowd crosses briskly, as Shibuya's does (about 1.5 m/s, the slowest a little under,
    // the quickest near 1.8): junctions.js times the walk by it (SCR_V), #199
    const xSpeed = q => Math.max(q.speed, 1.38) * 1.05;
    // whether someone still waiting at gate g stands just in front of q, between it and the road
    function aheadWaits(i, q, g) {
      const c0 = Math.floor(q.x / CELL), r0 = Math.floor(q.y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let k = head[bucket(c0 + a, r0 + b)]; k >= 0; k = chain[k]) {
          if (k === i) continue;
          const o = P[k];
          if (o.g !== g || o.ph !== 'wait') continue;
          const ex = o.x - q.x, ey = o.y - q.y, fwd = -(ex * g.ox + ey * g.oy), lat = Math.abs(ex * g.oy - ey * g.ox);
          if (fwd > 0.15 && fwd < 1.1 && lat < 0.45) return true;
        }
      }
      return false;
    }
    function plazaStep(i, q, dt, player) {
      const pz = q.pz, g = q.g;
      let sp = 0;
      if (q.ph === 'wait') {
        // the walk on, and time enough to make the far kerb: out, after a moment's reaction
        const far = g.len + 1; // (the crosswalk's length: the deepest of the crowd at the kerb a little behind the front rows)
        if (pz.walk() && pz.left() > far / (xSpeed(q) * 0.85)) { // (with time in hand for a crowd in the way)
          // a crowd at a kerb sets off as a wave from the front, as a real one does (and as Detour's and Mass's
          // queues do, each agent moving once the one ahead has): the front row on its reaction, each row behind
          // it later by how deep it stands and only once whoever stands in front of it has stepped off, rather
          // than every row at once walking into the backs of the row ahead. Never held more than 4 s by that
          const depth = Math.max(0, (q.x - g.x) * g.ox + (q.y - g.y) * g.oy - 0.8);
          if ((q.react -= dt) <= -0.35 * depth && (q.react < -4 || !aheadWaits(i, q, g))) { q.ph = 'cross'; spotAt(g.partner, -q.spread + (rnd() - 0.5) * 0.5, 0.6 + rnd() * 1.4, q.T, pz.road); g.n--; }
        }
      }
      else if (q.ph === 'cross') { // (still behind the kerb as the walk ends, or with too little of it left: back to wait)
        const P2 = g.partner, ex = P2.x - g.x, ey = P2.y - g.y, t = ((q.x - g.x) * ex + (q.y - g.y) * ey) / (ex * ex + ey * ey);
        if (t < 0.03 && (!pz.walk() || pz.left() < g.len / (xSpeed(q) * 0.85))) { q.ph = 'wait'; g.n++; spotAt(g, q.spread, 0.7 + rnd() * 1.6, q.T, pz.road); q.react = 0.2 + rnd() * 2.2; }
      }
      const dx = q.T.x - q.x, dy = q.T.y - q.y, d = Math.hypot(dx, dy);
      if (q.ph === 'cross') { sp = xSpeed(q); pz.busy = (pz.busy || 0) + 1; } else if (q.ph === 'stroll') {
        sp = q.speed * 0.75;
        if (pz.road && pz.road(q.x, q.y)) {
          sp = xSpeed(q);
          // (still out on the road, held up short of its spot by the crowd massed at the kerb: a spot further back
          // behind it, twice, then another kerb of that corner, and after that it edges on through as it can, no
          // longer counted as out crossing: the signals held their all-red and the cars' greens for such a one, a
          // minute at a time, Shinjuku's 1105, #264)
          if (!((q.sTries || 0) > 3)) pz.busy = (pz.busy || 0) + 1;
          q.sjam = q.v < 0.15 ? (q.sjam || 0) + dt : 0;
          if (q.sjam > 3) {
            q.sjam = 0; q.sTries = (q.sTries || 0) + 1;
            if (q.sTries <= 2 && q.g) spotAt(q.g, q.spread * 0.5, 2 + 1.5 * q.sTries, q.T, pz.road);
            else if (q.sTries === 3 && q.g && q.g.corner && q.g.corner.length) { const c = q.g.corner; toGate(q, c[Math.floor(rnd() * c.length)]); q.sTries = 3; }
          }
        } else q.sTries = 0;
      } else sp = d > 0.6 ? 0.5 : 0;
      if (q.pause > 0) sp = 0;
      let vx = d > 1e-3 ? dx / d * Math.min(sp, d / Math.max(dt, 1e-3)) : 0, vy = d > 1e-3 ? dy / d * Math.min(sp, d / Math.max(dt, 1e-3)) : 0;
      // the others near: apart, and, meeting someone coming the other way, a step to the left
      let fx = 0, fy = 0;
      const c0 = Math.floor(q.x / CELL), r0 = Math.floor(q.y / CELL), vv = Math.hypot(vx, vy);
      // (caught a while in the press, mid-road: shuffles on through it, as for the footways' knots)
      q.stuck = q.ph === 'cross' && q.v < 0.15 ? (q.stuck || 0) + dt : 0;
      if (q.ph === 'cross' && !pz.walk() && pz.left() < 3) q.squeeze = Math.max(q.squeeze || 0, 0.3); // (the walk over and still out on the road: on through the press, hurrying)
      if (q.stuck > 2) { q.squeeze = 1.5; q.stuck = 0; }
      if (q.squeeze > 0) q.squeeze -= dt;
      if (!(q.squeeze > 0)) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let k = head[bucket(c0 + a, r0 + b)]; k >= 0; k = chain[k]) {
          if (k === i) continue;
          const o = P[k], ex = q.x - o.x, ey = q.y - o.y, e = Math.hypot(ex, ey);
          if (e > 2.4 || e < 1e-4) continue;
          const keep = q.ph === 'wait' && sp === 0 ? 0.55 : 0.75; // (stood waiting: shoulder to shoulder, as a crowd at a kerb stands, not shoved about by every neighbour)
          if (e < keep) { const f = (keep - e) / e * 2.2; fx += ex * f; fy += ey * f; }
          if (vv > 0.3 && e < 2.4 && (o.vx * vx + o.vy * vy) < 0 && (-ex * vx - ey * vy) > 0) { const f = 0.5 * (2.4 - e) / 2.4; fx += -vy / vv * f; fy += vx / vv * f; } // (left: + across the heading)
        }
      }
      if (player) { const ex = q.x - player.x, ey = q.y - player.y, e = Math.hypot(ex, ey); if (e < 1.1 && e > 1e-4) { const f = (1.1 - e) / e * 2.5; fx += ex * f; fy += ey * f; } }
      // and round a car caught in the box (a row of discs along it), and the posts
      gather(q.x, q.y, q, (frame + i) % 3 === 0 || !q.cars, q.z);
      for (const o of nearPosts) {
        const ex = q.x - o.x, ey = q.y - o.y, e = Math.hypot(ex, ey), rr = o.r + POST + 0.25;
        if (e < rr + 0.5 && e > 1e-4) { const f = Math.max(0, rr - e) / e * 3, side = vx * -ey + vy * ex > 0 ? 1 : -1, t = (rr + 0.5 - e) / e * Math.max(0.6, vv) * 0.9; fx += ex * f - ey * side * t; fy += ey * f + ex * side * t; }
      }
      for (const o of nearCars) {
        // (one on the move a second ahead too: out of its way before it gets there)
        const ox = Math.sin(o.h), oy = Math.cos(o.h), ahead = Math.min(6, (o.v || 0) * 1.0), k = Math.max(1, Math.round((o.half + ahead / 2) / o.hw)), rr = o.hw + KERB + 0.25;
        for (let m = 0; m < k; m++) {
          const u = k === 1 ? 0 : -o.half + o.hw + (2 * o.half + ahead - 2 * o.hw) * m / (k - 1), ex = q.x - (o.x + ox * u), ey = q.y - (o.y + oy * u), e = Math.hypot(ex, ey);
          if (e < rr + 0.6 && e > 1e-4) {
            const f = Math.max(0, rr - e) / e * (q.tight ? 0.6 : 3), side = vx * -ey + vy * ex > 0 ? 1 : -1, t = (rr + 0.6 - e) / e * Math.max(0.6, vv) * 0.9;
            fx += ex * f - ey * side * t; fy += ey * f + ex * side * t; // (out of it, and round it, on the side it is already heading for)
          }
        }
      }
      vx += fx; vy += fy;
      // (waiting: a nudge under a slow step is stood through, not shuffled to; a real push still moves them)
      if (q.ph === 'wait' && sp === 0 && Math.hypot(vx, vy) < 0.35) vx = vy = 0;
      const m = Math.hypot(vx, vy), top = Math.max(sp, 0.6) * 1.15;
      if (m > top) { vx *= top / m; vy *= top / m; }
      // eased, as a body speeds up and turns
      const k = Math.min(1, dt * 5);
      q.vx += (vx - q.vx) * k; q.vy += (vy - q.vy) * k;
      // never a step into a car (one edging out of the box): stand, and let it by
      // (held up a while against a car caught in the box, with others round it: close along its side to get by)
      // (slow to forget: shuffling a step at a time is still stuck, and so is being put back out of a car's way)
      q.jam = q.ph === 'cross' && (q.v < 0.15 || q.ejected) ? (q.jam || 0) + dt : Math.max(0, (q.jam || 0) - dt * 0.25);
      q.tight = q.ph === 'cross' && (q.jam > 3 || (q.tight && q.jam > 0)); // (once close along a car's side, it stays close until it is through: no flipping back to the wide berth)
      const M = q.tight ? 0.12 : 0.3;
      q.ejected = false;
      if (q.jam > (pz.walk() ? 6 : 3)) { // (and still stuck: off the road by the nearest kerb whose way is clear, the one it set out
        // from or any other of the scramble's; sooner once the walk is over, the traffic's turn waiting on it, #197)
        let best = null, bd = Infinity;
        for (const h of gatesOf(pz)) {
          const back = spotAt(h, q.spread, 0.8, {}, pz.road), d = Math.hypot(back.x - q.x, back.y - q.y);
          if (d >= bd || d > 30) continue;
          let clear = true;
          for (let k = 1; k <= 8 && clear; k++) if (carDepth(q.x + (back.x - q.x) * k / 8, q.y + (back.y - q.y) * k / 8, 0.12) > 0) clear = false;
          if (clear) { best = h; bd = d; }
        }
        if (best) { q.g = null; toGate(q, best, 0.8 + rnd()); q.jam = 0; return; }
        q.jam = pz.walk() ? 3.5 : 1.5;
      }
      const was = carDepth(q.x, q.y, M), nx = q.x + q.vx * dt, ny = q.y + q.vy * dt;
      if (was > 0.02) { // (caught by one, a car pulling up: straight out of it, the shortest way)
        const e = 0.05, gx = carDepth(q.x + e, q.y, M) - carDepth(q.x - e, q.y, M), gy = carDepth(q.x, q.y + e, M) - carDepth(q.x, q.y - e, M), gl = Math.hypot(gx, gy);
        let ux = -gx, uy = -gy, ul = gl;
        if (gl < 0.02) { // (on its long axis the discs' pulls cancel: out to the side, the one nearer where it was going)
          let o = null, best = -1;
          for (const c of nearCars) { const e = Math.hypot(q.x - c.x, q.y - c.y); if (e < c.half + c.hw + M && (best < 0 || e < best)) { best = e; o = c; } }
          if (o) { const sx = Math.cos(o.h), sy = -Math.sin(o.h), lat = (q.x - o.x) * sx + (q.y - o.y) * sy, toT = (q.T.x - q.x) * sx + (q.T.y - q.y) * sy, sd = Math.abs(lat) > 0.05 ? Math.sign(lat) : toT >= 0 ? 1 : -1; ux = sx * sd; uy = sy * sd; ul = 1; }
        }
        if (ul > 1e-6) { q.x += ux / ul * 1.2 * dt; q.y += uy / ul * 1.2 * dt; q.vx = ux / ul * 1.2; q.vy = uy / ul * 1.2; q.ejected = true; }
      } else if (carDepth(nx, ny, M) > was + 1e-4) { q.vx *= 0.3; q.vy *= 0.3; }
      else {
        // and never a step inside anyone: shoulder to shoulder at the kerb (0.45 m apart, centre to
        // centre), shoulders brushing out on the crossing or squeezing through (0.32 m); a step that
        // would come closer slides along them on one axis, or waits
        const hard = q.squeeze > 0 || q.ph === 'cross' ? 0.32 : 0.45, n0 = Math.min(hard, nearest1(i, q.x, q.y));
        if (nearest1(i, nx, ny) >= n0 - 1e-4) { q.x = nx; q.y = ny; }
        else if (nearest1(i, nx, q.y) >= n0 - 1e-4) { q.x = nx; q.vy *= 0.3; }
        else if (nearest1(i, q.x, ny) >= n0 - 1e-4) { q.y = ny; q.vx *= 0.3; }
        else { q.vx *= 0.3; q.vy *= 0.3; }
      }
      q.v = Math.hypot(q.vx, q.vy);
      ZAT.z = q.z;
      const z = ground ? ground(q.x, q.y, ZAT) : null;
      if (z != null) q.z = z;
      // short of its spot at the kerb and getting nowhere for a second, the crowd there in its way: it stands where
      // it is, at the back of them, as people do on reaching a crowd, instead of walking on the spot into their
      // backs until someone gives way (Shibuya: some pressed so for 27 s; tools/crowd_press.js)
      if ((q.ph === 'stroll' || q.ph === 'wait') && Math.hypot(q.T.x - q.x, q.T.y - q.y) > 0.6 && !(pz.road && pz.road(q.x, q.y))) {
        q.held = (q.av ?? q.v) < 0.15 ? (q.held || 0) + dt : 0;
        if (q.held > 1) { q.T.x = q.x; q.T.y = q.y; q.ph = 'wait'; q.held = 0; }
      } else q.held = 0;
      // (waiting, pushed aside a step: the body keeps facing the road, as it does, rather than turning to every shove)
      if (q.ph === 'wait' && q.v > 0 && Math.hypot(q.T.x - q.x, q.T.y - q.y) < 0.6 && !(pz.road && pz.road(q.x, q.y))) { q.T.x = q.x; q.T.y = q.y; } // (and stays where it was pushed, not back into the one who pushed it)
      const fw = heading(q, q.vx, q.vy, dt);
      if (q.face != null) q.h = q.face;
      else if (q.v > (q.ph === 'wait' ? 0.45 : 0.15) && fw > 0.12) turnTo(q, dt, 6, fw);
      else if (q.ph === 'wait') { const h = Math.atan2(-g.ox, -g.oy); q.h += Math.atan2(Math.sin(h - q.h), Math.cos(h - q.h)) * Math.min(1, dt * 2); } // (facing the road)
      // there: on the far side, on to a kerb of that corner (or this one) to wait again
      if (Math.hypot(q.T.x - q.x, q.T.y - q.y) < 0.5) {
        if (q.ph === 'cross' && pz.owe > 0 && toFootway(q)) pz.owe--;
        else if (q.ph === 'cross') { const c = g.partner.corner, n2 = rnd() < 0.55 && c.length ? c[Math.floor(rnd() * c.length)] : g.partner; q.g = null; toGate(q, n2); }
        else if (q.ph === 'stroll') q.ph = 'wait';
      }
    }
    // the way the body faces, out of where it is going: its velocity eased over a good part of a second,
    // so the jostle of a crowd (a shove one way, a step back the other) averages out rather than swinging
    // the body to and fro, and a slow shuffle, weighing little, turns it slowly. Returns the eased speed
    function heading(p, vx, vy, dt) {
      const k = Math.min(1, dt * 2.5);
      if (p.fx == null) { p.fx = vx; p.fy = vy; } else { p.fx += (vx - p.fx) * k; p.fy += (vy - p.fy) * k; }
      return Math.hypot(p.fx, p.fy);
    }
    function turnTo(p, dt, rate, fw) {
      const h = Math.atan2(p.fx, p.fy);
      p.h += Math.atan2(Math.sin(h - p.h), Math.cos(h - p.h)) * Math.min(1, dt * rate * Math.min(1, fw / 0.9));
    }
    // the pace the body shows: the ground it really covered (a sidestep round someone included, a step
    // put back for bumping into them not), eased over a quarter second, and walking or standing with a
    // margin between the two, so that a walker edging along in a queue or nudged in a crowd at a kerb
    // walks or stands rather than flickering between the two clips every few frames
    function gait(p, dt) {
      const lx = p.gx, ly = p.gy;
      p.gx = p.x; p.gy = p.y;
      let v = lx == null || !(dt > 0) ? p.v || 0 : Math.hypot(p.x - lx, p.y - ly) / dt;
      if (v > 4) v = p.v || 0; // (put somewhere else, not a pace)
      p.av = p.av == null ? v : p.av + (v - p.av) * Math.min(1, dt * 4);
      p.moving = p.state !== 'sit' && (p.moving ? p.av > 0.12 : p.av > 0.35);
    }
    let frame = 0;
    function update(dt, cx, cy, t, player) {
      R.begin(dt, cx, cy, t, api.active);
      frame++;
      if (api.plazas && (frame % 15 === 1 || t < 1)) plazas(t, cx, cy);
      if (api.plazas) for (const pz of api.plazas) if (pz.j) { pz.j.busy = pz.busy || 0; pz.busy = 0; } // (who was out on its road last step: the signals wait for them)
      head.fill(-1);
      for (let i = 0; i < api.active; i++) {
        const q = P[i];
        if (q.line < 0) continue;
        const k = bucket(Math.floor(q.x / CELL), Math.floor(q.y / CELL));
        chain[i] = head[k]; head[k] = i;
      }
      const pvx = player ? Math.sin(player.h) * player.speed : 0, pvy = player ? Math.cos(player.h) * player.speed : 0;
      for (let i = 0; i < n; i++) {
        p = P[i];
        if (i >= api.active) { R.hide(i); release(p); if (p.pz) { if (p.g) p.g.n--; p.pz = p.g = null; p.state = 'walk'; } p.line = -1; continue; }
        if (p.pz) { if (p.pause > 0) p.pause -= dt; plazaStep(i, p, dt, player); p.mode = 'ground'; gait(p, dt); R.place(i, p, p.moving); continue; }
        if (p.line < 0 || Math.hypot(p.x - cx, p.y - cy) > radius * 1.15) respawn(p, cx, cy, p.line < 0 && t < 1 ? 0 : radius * 0.6);
        if (p.line < 0) { R.hide(i); continue; }
        if (p.pause > 0) p.pause -= dt;
        if (p.state === 'walk') { // farther off, a longer step every few frames does
          const d = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)), k = d < NEAR ? 1 : d < FAR ? 2 : 4;
          if ((frame + i) % k === 0) { walk(i, k * dt, player, pvx, pvy); gait(p, k * dt); }
        }
        else if (p.state === 'sit') {
          p.v = p.vx = p.vy = 0;
          if ((p.t -= dt) <= 0) { release(p); backTo(p); p.state = 'leave'; }
        } else { // to a seat or back to the footway, in a straight line
          const g = p.state === 'approach' ? p.seat : p.back, dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy);
          gather(p.x, p.y, p, (frame + i) % 6 < 2 || !p.cars, p.z);
          // (not into a car pulled up by the bench: wait for it)
          let st = d > 1e-3 && blocked(p.x + dx / d * 0.05, p.y + dy / d * 0.05, false) > blocked(p.x, p.y, false) + 1e-4 ? 0 : Math.min(d, p.speed * 0.8 * dt);
          // nor into someone walking by: wait for them to pass (a few seconds at most, then on)
          if (st > 0 && d > 0.3 && (p.yield || 0) < 3 && crowded(p.x + dx / d * st, p.y + dy / d * st, p, CLOSE) && !crowded(p.x, p.y, p, CLOSE)) { st = 0; p.yield = (p.yield || 0) + dt; }
          else if (st > 0) p.yield = 0;
          if (d > 1e-3) { p.x += dx / d * st; p.y += dy / d * st; p.z += (g.z - p.z) * st / d; p.h = Math.atan2(dx, dy); }
          p.v = dt > 0 ? st / dt : 0; p.vx = d > 1e-3 ? dx / d * p.v : 0; p.vy = d > 1e-3 ? dy / d * p.v : 0;
          if (d - st < 0.02) {
            if (p.state === 'approach') { p.state = 'sit'; p.x = g.x; p.y = g.y; p.z = g.z; p.h = g.h; p.t = 25 + rnd() * 50; }
            else { p.state = 'walk'; p.lat = null; p.dodge = 0; p.rest = 40 + rnd() * 60; } // walk() picks up the new direction
          }
        }
        p.mode = p.state === 'sit' ? 'sit' : 'ground';
        if (p.state !== 'walk') gait(p, dt);
        R.place(i, p, p.state !== 'sit' && p.moving);
      }
      R.end();
    }
    // turn round where it stands: the way along the line and the offset across it both flip, so the
    // walker stays on the spot (and drifts over to its own side as it walks on) rather than jump
    // across the footway
    function turn(q) {
      q.dir = -q.dir; q.hx = -q.hx; q.hy = -q.hy;
      if (q.lat != null) q.lat = -q.lat;
      q.dodge = -q.dodge;
      if (q.fx != null) { q.fx = -q.fx; q.fy = -q.fy; } // (turned back: faces the new way at once, not walking backwards until the eased way catches up)
      if (q.lim != null) { q.lim = -q.lim; q.limWant = -q.limWant; }
    }
    function walk(i, dt, player, pvx, pvy) {
      const l = net.L[p.line];
      if (p.lat == null) { // just placed: put it there
        p.lat = p.side; p.v = p.speed; lineAt(p.line, p.s, tmp); p.hx = tmp.hx * p.dir; p.hy = tmp.hy * p.dir;
        p.lat = p.lim = wallFree(p, p.limWant = p.side, Math.max(1, (FOOTW[l.c] || 3) / 2)); // (placed out of sight: straight to where there is room)
        p.x = tmp.x - p.hy * p.lat; p.y = tmp.y + p.hx * p.lat; p.z = tmp.z;
        settle(p);
      }
      if (p.give) { // stood in the road in front of a car that has waited on them: turn back, out of its way
        p.give = false;
        if (p.v < 0.3 && p.pause <= 0) { turn(p); p.wait = p.still = 0; }
      }
      hx = p.hx; hy = p.hy; // the lane's direction where the walker is, from the last step
      push = 0; cap = p.speed; nn = 0; blk = -1;
      const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let j = head[bucket(c0 + a, r0 + b)]; j >= 0; j = chain[j]) if (j !== i) { const o = P[j]; if (!(p.squeeze > 0)) { seeJ = j; see(o.x, o.y, o.vx, o.vy, BODY, 1); } nbr[nn++] = j; }
      }
      // (squeezing through a knot it brakes and steers for no one, but still never steps inside anyone: closest() below)
      if (p.squeeze > 0) p.squeeze -= dt;
      seeJ = -1;
      const capPeople = cap, blkI = blk, blkA = blkAhead, blkL = blkLat;
      if (player) see(player.x, player.y, pvx, pvy, BODY + (player.r || 0.15), 1.6); // give the player a little more room (a car more)
      gather(p.x, p.y, p, (p.steps = (p.steps || 0) + 1) % 2 === 0 || !p.cars, p.z);
      // the benches' two seats: step round them, without slowing (it may be passing to sit down)
      let cap0 = cap;
      for (const bn of nearBenches) for (const st of bn.seats) if (st.by !== i) see(st.x, st.y, 0, 0, 0.5 + HALF, 1);
      for (const o of nearPosts) see(o.x, o.y, 0, 0, o.r + POST + HALF, 1); // and round the posts and trunks
      cap = cap0;
      // a walker caught beside a car (it pulled up, say) steps on out rather than wait for it
      const was = blocked(p.x, p.y);
      cap0 = cap;
      for (const o of nearCars) seeCar(o);
      if (was > 0) cap = cap0;
      // sideways within the footway (a little past its edge for whoever keeps far left), and speed
      // (out on a scramble's crosswalk, a band of stripes 4 to 6 m wide: across its width, each walker keeping to
      // its left so the two crowds pass rather than meet face to face in the middle of the road)
      const X = api.crossings && api.crossings.byLine.get(p.line), band = X && X.some(x => x.scramble && Math.abs(x.s - p.s) < x.kerb);
      const hw = band ? 2.6 : Math.max(1, (FOOTW[l.c] || 3) / 2), side = band ? 1.2 + 0.5 * Math.max(-1.6, Math.min(1.6, p.side)) : p.side; // (lat: to the walker's left)
      p.dodge += (Math.max(-1.5, Math.min(1.5, push * 1.2)) - p.dodge) * Math.min(1, dt * 4);
      let want = Math.max(-hw + 0.3, Math.min(Math.max(hw, side) + 0.2, side + p.dodge));
      // someone stood in its way (it has slowed right down for them): after a moment, a detour round
      // them, as people do, to the side of them that is clear of the walls and inside the footway (its
      // own side first), wide enough to pass a body's width clear. Of two face to face the first takes
      // it and the other waits for it; a second later the other goes round if the first could not
      if (p.detourT > 0) p.detourT -= dt;
      const stopped = blkI >= 0 && Math.abs(cap - capPeople) < 1e-6 && p.v < 0.35 && blkA < 1.5;
      p.stuckT = stopped ? (p.stuckT || 0) + dt : 0;
      if (stopped && !(p.detourT > 0) && p.stuckT > (i < blkI ? 0.35 : 1.1)) {
        const o = P[blkI];
        if (!(o.detourT > 0 && o.detourOf === i)) {
          const olat = p.lat + blkL, gap = CLOSE + 0.22, lo = -hw + 0.25, hi = Math.max(hw, side) + 0.2, own = side >= 0 ? 1 : -1;
          if (clear) lineAt(p.line, p.s, tmp);
          let best = null;
          for (const sg of [own, -own]) {
            const tl = olat + sg * gap;
            if (tl < lo || tl > hi || (clear && Math.abs(wallFree(p, tl, hw) - tl) > 1e-6)) continue;
            if (!best || Math.abs(tl - p.lat) < Math.abs(best - p.lat) - 0.3) best = tl;
          }
          if (best != null) { p.detourT = 2.5; p.detourLat = best; p.detourOf = blkI; }
          else p.stuckT = 0; // (no way round: it waits, and in the end turns back)
        }
      }
      // slowed to a crawl by the crowd at a scramble's kerb, just ahead: one of them, standing where it is at the
      // back of them, as someone coming up to a crowd at a crossing does, rather than creeping into their backs
      // and in the end turning back (Shibuya: a tenth of the footways' walkers near you at any moment).
      // Unreal's Mass and Detour's crowds settle an agent that reaches a queue the same way
      let pzAhead = null;
      if (p.v < 0.3) for (let k = 0; k < nn; k++) {
        const o = P[nbr[k]], ex = o.x - p.x, ey = o.y - p.y;
        if (o.pz && o.ph !== 'cross' && ex * ex + ey * ey < 2.6 && ex * hx + ey * hy > 0.1) { pzAhead = o.pz; break; }
      }
      p.pzSlow = pzAhead ? (p.pzSlow || 0) + dt : 0;
      if (p.pzSlow > 0.6 && joinPlaza(p, pzAhead)) { p.pzSlow = 0; return; }
      if (p.detourT > 0) want = p.detourLat;
      // (counted out on a scramble's crosswalk, for its signals to wait for; and massed at its kerbs, spread
      // across the stripes' width rather than in single file)
      if (X && X.scramble) for (const x of X) if (x.scramble && Math.abs(x.s - p.s) < x.kerb - 0.3 && x.scramble.plaza) x.scramble.plaza.busy = (x.scramble.plaza.busy || 0) + 1;
      if (!band && X && X.scramble && X.some(x => x.scramble && Math.abs(x.s - p.s) < x.kerb + 5)) want = Math.max(-SCR_HW, Math.min(SCR_HW, p.spread * SCR_HW + p.dodge));
      // a facade beside the line, here or a little ahead: in towards the line (looked at every few steps)
      if (clear && ((p.wallStep = (p.wallStep || 0) + 1) % 3 === 0 || p.lim == null)) { lineAt(p.line, p.s, tmp); p.lim = wallFree(p, want, hw); p.limWant = want; }
      if (clear && p.lim != null && p.lim !== p.limWant) want = p.limWant >= 0 ? Math.min(want, p.lim) : Math.max(want, p.lim); // (no further out on that side)
      const lv = p.v < 0.2 && p.kw > 0.5 ? 0.25 : 0.9; // (stood at a kerb a while: a slow shuffle across, not a slide)
      let dl = Math.max(-lv * dt, Math.min(lv * dt, want - p.lat));
      p.lat += dl;
      // a road ahead at a junction with signals, its traffic free to go: up to the kerb, and wait
      // there (the button pressed) for the walk signal; someone already out in the road walks on
      // (at a scramble, only with the time to reach the far kerb before the traffic moves)
      let atKerb = false;
      // (out in a scramble's road when its walk is over: off it with its own crowd, to the nearest kerb they wait at)
      if (X) for (const x of X) if (x.at && Math.abs(x.s - p.s) < x.kerb - 0.3 && !api.crossings.walk(x.a) && toPlaza(p, x.at, 30)) return;
      if (X && !X.some(x => Math.abs(x.s - p.s) < x.kerb - 0.3)) for (const x of X) { // (not while out in a road: over a median, it crosses the other half too)
        const d = (x.s - p.s) * p.dir;
        if (x.at && d > x.kerb - 0.4 && d < x.kerb + 1.5 && toPlaza(p, x.at)) return; // (to the scramble's own crowd)
        if (d > x.kerb - 0.4 && d < x.kerb + 3 && (!api.crossings.walk(x.a) || (x.scramble && api.crossings.walkLeft(x.a) < (d + x.kerb) / (p.speed * 0.65)))) {
          atKerb = true; api.crossings.call(x.a); cap = Math.min(cap, Math.max(0, (d - x.kerb) * 1.5));
        }
      }
      // a road ahead with no crossing marked on it (no signals, no zebra): a look both ways first, and a wait at
      // the kerb while a car would be there within 3.5 s, as the law asks of someone crossing away from a
      // crossing (Japan's Road Traffic Act, art. 13; the UK's Highway Code, rule 7) and as people do. Before,
      // the crowd stepped out regardless and every car stopped for it, one after another: on the streets east
      // of Shibuya station a queue stood for the people crossing, car after car, for minutes. Out in the road,
      // it goes on across; after 20 s at the kerb it takes its chance at walking pace, the cars braking for it
      if (!atKerb && api.crossings && api.crossings.road && api.cars && !(X && X.some(x => Math.abs(x.s - p.s) < x.kerb + 2))) {
        const E = roadEntries(p.line);
        let held = false;
        for (const e of E) {
          if (e.dir !== p.dir) continue;
          const d = (e.s - p.s) * p.dir;
          if (d < -0.2 || d > 2.2) continue;
          if (e.major) { turn(p); p.gw = 0; break; } // (a major road with no crossing here: back, to the crossing another way)
          if ((p.gw || 0) < 20 && carComing(e.x, e.y, p.z)) { held = true; cap = Math.min(cap, Math.max(0, (d - 0.3) * 1.5)); }
          break;
        }
        p.gw = held ? (p.gw || 0) + dt : 0;
        if (held) atKerb = true;
      }
      if (atKerb && p.v < 0.05) api.kerbWait += dt;
      // each wait at a kerb for the walk, from coming up to it to stepping out (tools/traffic_check.js)
      if (atKerb) p.kw = (p.kw || 0) + dt;
      else if (p.kw) { if (api.kerbWaits.length < 4000) api.kerbWaits.push(p.kw); p.kw = 0; }
      const target = p.pause > 0 ? 0 : Math.min(p.speed, cap);
      p.v = Math.max(0, p.v + Math.max(-3 * dt, Math.min(1.2 * dt, target - p.v)));
      // face to face with someone neither can get round: after a while, turn back
      p.still = p.pause <= 0 && p.v < 0.05 && !atKerb && !p.kerbNext && !p.kerbBack ? (p.still || 0) + dt : 0;
      // caught in a knot of walkers where footways meet (a thick crowd's head-on): shuffle on through
      // it for a moment, as people in a crush do (and off a road, through those waiting at its kerb);
      // never into the crowd massed at a kerb, though
      p.slow = p.pause <= 0 && p.v < 0.25 && !atKerb && !p.kerbNext && !p.kerbBack ? (p.slow || 0) + dt : 0; // (or barely edging through it)
      if ((p.still > 1.5 || p.wait > 1.5 || p.slow > 2.5) && !(X && X.some(x => { const d = (x.s - p.s) * p.dir; return d > x.kerb - 0.3 && d < x.kerb + 10; }))) { p.squeeze = 1.2; p.slow = 0; }
      if (p.still > 2.5) { turn(p); p.still = 0; } // (and so takes another way: a different line at the next corner)
      const s0 = p.s, line0 = p.line, dir0 = p.dir, lat0 = p.lat - dl;
      p.s += p.dir * p.v * dt;
      // a bench on this stretch with a free seat: maybe sit down
      p.rest -= dt;
      const here = BN && p.rest <= 0 && p.v > 0.3 ? BN.byLine.get(p.line) : null;
      if (here) for (const b of here) {
        if ((b.s - s0) * (b.s - p.s) > 0) continue;
        const seat = b.seats.find(q => q.by < 0);
        if (!seat || rnd() >= api.sitChance(b)) continue;
        seat.by = i; p.seat = seat; p.state = 'approach';
        return;
      }
      if (p.s < 0 || p.s > l.len) {
        // on along the next line, or back; but where that steps straight out into a road at a
        // crossing whose walk isn't on (a crosswalk mapped from the kerb), the walker waits at the
        // end, the way chosen kept for when it is
        const nx = p.kerbNext || onward(p, p.s > l.len ? 1 : 0), back = p.kerbNext ? false : p.kerbBack || !nx || rnd() >= 0.9;
        const nl = back ? p.line : nx[0], nd = back ? -p.dir : nx[1] === 0 ? 1 : -1, ns = back ? Math.max(0, Math.min(l.len, p.s)) : nx[1] === 0 ? 0 : net.L[nl].len;
        const held = heldAt(nl, ns, nd, p);
        if (held === 'plaza') return;
        if (held) {
          p.kerbNext = back ? null : nx; p.kerbBack = back;
          p.s = Math.max(0, Math.min(l.len, p.s)); p.v = 0;
          api.kerbWait += dt;
        } else { p.kerbNext = null; p.kerbBack = false; if (back) turn(p); else { p.line = nl; p.dir = nd; } p.s = ns; } // (back: turned where it stands)
      }
      lineAt(p.line, p.s, tmp);
      const nhx = tmp.hx * p.dir, nhy = tmp.hy * p.dir;
      // a step into a car, a bench or someone: stay put (whoever is already in one may walk
      // out of it, or along it), and after a while turn back
      let nx1 = tmp.x - nhy * p.lat, ny1 = tmp.y + nhx * p.lat, room1 = closest(nx1, ny1, player);
      // out in a carriageway on a crossing, getting off it comes first: there a walker may close in to
      // shoulders brushing (0.32 m) to clear it, never inside anyone; everywhere else it keeps CLOSE
      const inRoad = !!(X && X.some(x => Math.abs(x.s - p.s) < x.kerb)), lim = inRoad ? 0.32 : CLOSE;
      const room0 = closest(p.x, p.y, player), bad = (x, y, r) => blocked(x, y) > was + 1e-4 || (r < lim && r < room0);
      if (dl !== 0 && bad(nx1, ny1, room1)) { // drifting across into someone it is passing: straight on instead
        const lat2 = p.lat - dl, x2 = tmp.x - nhy * lat2, y2 = tmp.y + nhx * lat2, r2 = closest(x2, y2, player);
        if (!bad(x2, y2, r2)) { p.lat = lat2; dl = 0; nx1 = x2; ny1 = y2; room1 = r2; }
      }
      if (bad(nx1, ny1, room1)) {
        if (p.dir !== dir0) turn(p);
        p.line = line0; p.s = s0; p.lat = lat0; p.v = 0;
        p.vx = p.vy = 0;
        if (was > 0) for (const d of [0.9 * dt, -0.9 * dt]) { // in a car's way and stuck: a step sideways, out
          const x = p.x - p.hy * d, y = p.y + p.hx * d;
          if (blocked(x, y) < was - 1e-4) { p.lat += d; p.x = x; p.y = y; break; }
        }
        else if (room1 < CLOSE) { // someone in the way: a step aside, as people do, away from whoever is
          // nearest across (both of two face to face so go to their own right, and pass), and keep
          // going that way a while (dodge) so it walks round them rather than back and forth
          let ox = 0, oy = 0, bd = Infinity;
          for (let k = 0; k < nn; k++) { const o = P[nbr[k]], e = Math.hypot(o.x - nx1, o.y - ny1); if (e < bd) { bd = e; ox = o.x; oy = o.y; } }
          const across = (ox - p.x) * -p.hy + (oy - p.y) * p.hx, first = across > 0.02 ? -1 : 1;
          for (const sg of [first, -first]) {
            const d = sg * 0.9 * dt, lat = p.lat + d;
            if (lat < -hw + 0.2 || lat > Math.max(hw, side) + 0.3) continue;
            const x = p.x - p.hy * d, y = p.y + p.hx * d;
            if (blocked(x, y) > was + 1e-4 || closest(x, y, player) < Math.min(CLOSE, room0) - 1e-4) continue;
            if (clear && !clear(x, y, p.z)) continue;
            p.lat = lat; p.x = x; p.y = y; p.vx = -p.hy * sg * 0.9; p.vy = p.hx * sg * 0.9;
            p.dodge = Math.max(-1.5, Math.min(1.5, p.dodge + d * 2));
            p.wait = Math.max(0, (p.wait || 0) - dt * 0.5); // (on the move: not yet a reason to turn back)
            break;
          }
        }
        if ((p.wait = (p.wait || 0) + dt) > (was > 0 ? 0.3 : 3)) { turn(p); p.wait = 0; }
        return;
      }
      p.wait = 0;
      const ohx = p.hx, ohy = p.hy, ox = p.x, oy = p.y, oz = p.z;
      hx = p.hx = nhx; hy = p.hy = nhy;
      p.x = tmp.x - hy * p.lat; p.y = tmp.y + hx * p.lat; p.z = tmp.z; // keep left
      settle(p);
      // never farther in a step than a brisk walk: where the line itself turns sharply between two
      // lines or the offset is cut in by a wall, the walker catches up over a few steps, not in one
      const jx = p.x - ox, jy = p.y - oy, jd = Math.hypot(jx, jy), jmax = (p.v + 1.3) * dt + 0.01;
      if (jd > jmax) { p.x = ox + jx * jmax / jd; p.y = oy + jy * jmax / jd; }
      // and where it ends up (pulled in from a wall, or catching up) no closer to anyone than the
      // check above allowed: otherwise it stays where it was this step
      if (jd > 1e-6 && (closest(p.x, p.y, player) < Math.min(lim, room0) - 1e-4 || blocked(p.x, p.y) > was + 1e-4)) {
        if (p.dir !== dir0) turn(p);
        p.line = line0; p.s = s0; p.lat = lat0; p.hx = ohx; p.hy = ohy; p.x = ox; p.y = oy; p.z = oz; p.v = 0; p.vx = p.vy = 0;
        return;
      }
      const lr = dt > 0 ? dl / dt : 0;
      p.vx = hx * p.v - hy * lr; p.vy = hy * p.v + hx * lr;
      // (the body faces the way it goes along the footway; drifting across to pass someone turns it only a little)
      const fw = heading(p, hx * p.v - hy * lr * 0.4, hy * p.v + hx * lr * 0.4, dt);
      if (p.face != null) p.h = p.face;
      else if (fw > 0.3) turnTo(p, dt, 8, fw);
      else if (p.v > 0.05) { const h = Math.atan2(hx, hy); p.h += Math.atan2(Math.sin(h - p.h), Math.cos(h - p.h)) * Math.min(1, dt * 3); } // (barely moving, a sidestep: still facing the way it goes, not turned sideways to every shuffle)
    }
    function nearest(x, y, maxD) {
      let best = -1, bd = maxD;
      for (let i = 0; i < n; i++) { const d = Math.hypot(P[i].x - x, P[i].y - y); if (P[i].line >= 0 && d < bd) { bd = d; best = i; } }
      return best;
    }
    return Object.assign(api, { update, nearest, respawn });
  }

  // ------------------------------------------------------------ traffic (drives on the left, or on the right)
  // With the shared Blender cars (opts.lib from OEVehicles.load) each slot drives one model
  // (sedans, hatches, SUVs, vans, the city's taxis and buses), drawn near, mid or far by
  // distance from opts.eye; without them, one box car for all.
  // Every car is a rectangle on the ground (`half` its length, `hw` its width, halved; `top` its
  // height), on the side of the road the city keeps to (opts.keep), and on the ground drawn under
  // it or its deck (opts.ground, as for the crowd).
  // It brakes for whatever is in its path: another car whose footprint reaches into its lane
  // (where two paths cross, the one farther from the crossing gives way), the player and the
  // walkers of opts.crowd, and your car or a ride (blockers with a length), swinging out round
  // one pulled in at the kerb. It drives a one-way street only its way. On a main road it has two
  // lanes each way (junctions.js lanesOf): it moves across into the other when the car ahead in
  // its own is slow and the other is clear beside it, and into the one its movement at the
  // junction ahead needs in time (straight on may go from either, a turn from the first). At a junction
  // (opts.junctions, junctions.js) it picks its exit as it comes up, stops at the line for a red
  // light or a stop sign, gives way, and goes in only when its way across is clear of the
  // movements in the junction and there is room for it beyond, so a queue never locks the
  // junction up; it gives the movement up once clear of it.
  // And it never moves into another car or a person: it waits, and, if a jam that is not a queue
  // at a junction won't clear, turns round on a two-way street (or, out of sight, comes back
  // elsewhere). The crowd keeps out of the cars' footprints (cars.near), and opts.nav stops the
  // player walking into one (nav.movers).
  const LANE = 1.7;    // a lane's centre, on the keep side of the road's line (m)
  const PACE = 1.25;   // the traffic drives a quarter over the posted limit, as drivers do on an open street (the data's
                       // limits are the signs': 30 km/h on a side street reads as a crawl in play); a ride's route,
                       // its time and how it passes a queue stay on the limits (cars.js chauffeur)
  const STUCK = 20;    // seconds stopped behind a car that won't move (not queueing at a junction) before turning round
  const LEVEL = 3;     // cars and people this far apart in height are on different levels: a deck over a street (m)
  const STEP = 1.5, NPATH = 32; // a car's way ahead, in points this far apart (m), and at most this many
  const pathQ = new Float32Array(2 * (NPATH + 64)), pathZ = new Float32Array(NPATH + 64), pathNext = [];
  // a car coming the other way within reach ahead of car c (heading fx, fy), on its road or a step from
  // its centre line: one it would meet swinging out over that line
  function oncomingIn(C, c, fx, fy, reach) {
    for (const o of C) {
      if (o === c || o.line < 0 || Math.abs(o.z - c.z) >= LEVEL) continue;
      const dx = o.x - c.x, dy = o.y - c.y, a = dx * fx + dy * fy;
      if (a <= 0 || a > reach || Math.abs(-dx * fy + dy * fx) > 4.5) continue;
      if (Math.sin(o.h) * fx + Math.cos(o.h) * fy < -0.5) return true;
    }
    return false;
  }
  function traffic(world, net, U, n, radius, { lib = null, cfg = {}, eye = null, keep = 'left', ground = null, crowd = null, nav = null, posts = null, junctions = null } = {}) {
    const side = keep === 'right' ? -1 : 1; // the lane is to the left of the centre line, or to the right
    const JN = junctions || OEJunctions.create(net, { keep, lane: LANE, signals: [] });
    const I = lib && lib.cars && lib.info.cars, C = [], tmp = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let mesh = null, fleet = null;
    const oncoming = (c, fx, fy, reach) => oncomingIn(C, c, fx, fy, reach);
    if (I) {
      const geos = carGeometries(lib.cars, I.tones), names = Object.keys(I.models).filter(k => geos[k] && geos[k].length === 3);
      const taxi = Object.assign({}, I.liveries.taxi, cfg.taxi), bus = Object.assign({}, I.liveries.bus, cfg.bus);
      const own = names.filter(k => !I.models[k].taxi && !I.models[k].bus), sum = own.reduce((a, k) => a + I.models[k].weight, 0);
      const share = k => (I.models[k].taxi ? taxi.share : I.models[k].bus ? bus.share : (1 - taxi.share - bus.share) * I.models[k].weight / sum);
      const colours = cfg.colours || I.liveries.colours;
      for (let i = 0; i < n; i++) {
        let r = rnd(), k = names[names.length - 1];
        for (const name of names) { if ((r -= share(name)) < 0) { k = name; break; } }
        const M = I.models[k], box = geos[k][0].boundingBox, hex = M.taxi ? pick(taxi.colours) : M.bus ? bus.colour : pick(colours);
        C.push({ line: -1, s: 0, dir: 1, v: 0, x: 0, y: 0, z: 0, h: 0, off: 0, ln: 0, lo: 0, model: k, half: (box.max.z - box.min.z) / 2, hw: (box.max.x - box.min.x) / 2, top: box.max.y,
          stuck: 0, taxi: !!M.taxi, hex, c0: lin(hex), c1: lin(M.bus ? bus.band : taxi.band || '#1c1d1f') });
      }
      const mat = toneMaterial(U, { cars: true });
      fleet = {};
      for (const k of names) {
        const cap = C.filter(c => c.model === k).length;
        if (!cap) continue;
        fleet[k] = geos[k].map(g => { const m = instanced(g, mat, cap); m.count = 0; world.add(m); return m; });
      }
    } else {
      mesh = instanced(CAR(), toneMaterial(U), n);
      world.add(mesh);
      for (let i = 0; i < n; i++) {
        const hex = pick(CARS);
        setC(mesh.geometry.attributes.aC0, i, hex);
        C.push({ line: -1, s: 0, dir: 1, v: 0, x: 0, y: 0, z: 0, h: 0, off: 0, ln: 0, lo: 0, half: 2.2, hw: 0.98, top: 1.5, stuck: 0, hex });
      }
    }
    const at = new THREE.Vector3();
    function place(i, c) { // into the box mesh's slot, or the next free slot of the model's mesh for this distance
      if (!fleet) { mesh.setMatrixAt(i, m4); return; }
      const d = eye ? eye.position.distanceTo(at.setFromMatrixPosition(m4)) : 0;
      const M = fleet[c.model][d < I.lod1_m ? 0 : d < I.lod2_m ? 1 : 2], j = M.count++, A = M.geometry.attributes;
      M.setMatrixAt(j, m4);
      A.aC0.setXYZ(j, c.c0.r, c.c0.g, c.c0.b); A.aC1.setXYZ(j, c.c1.r, c.c1.g, c.c1.b);
    }
    // where a car on line `line` at s, driving dir, sits: its lane, on the keep side of the line,
    // and off metres farther left (a swing out round a car at the kerb)
    // (its way, the line's direction smoothed over a few metres either side, on to the next
    // piece and back to the one it came from (prev, next: [line, dir]), so the lane turns
    // corners and goes through junctions without jumping, and oncoming lanes stay apart round a bend)
    const pA = {}, pB = {};
    function along(line, s, dir, u, prev, next, out) { // the point u metres on from s, the way the car goes
      const l = net.L[line], t = s + dir * u;
      if (t >= 0 && t <= l.len) return net.at(line, t, out);
      const over = t > l.len ? t - l.len : -t, ahead = (t > l.len) === (dir > 0), o = ahead ? next : prev;
      if (!o) return net.at(line, Math.max(0, Math.min(l.len, t)), out);
      const L2 = net.L[o[0]], d = Math.min(L2.len, over);
      return net.at(o[0], (ahead ? o[1] > 0 : o[1] < 0) ? d : L2.len - d, out);
    }
    function lanePos(line, s, dir, out, off = 0, prev = null, next = null) {
      along(line, s, dir, -3, prev, next, pA); along(line, s, dir, 3, prev, next, pB);
      net.at(line, s, out);
      let hx = pB.x - pA.x, hy = pB.y - pA.y;
      const h = Math.sqrt(hx * hx + hy * hy);
      if (h > 0.5) { hx /= h; hy /= h; } else { hx = out.hx * dir; hy = out.hy * dir; }
      out.hx = hx; out.hy = hy;
      const lane = LANE * side + off;
      out.x -= hy * lane; out.y += hx * lane;
      return out;
    }
    // its height: the lane's, or the ground drawn under it or its deck (opts.ground)
    function onGround(c, at) {
      c.z = at.z;
      const gz = ground && ground(c.x, c.y, at);
      if (gz != null) c.z = gz;
    }
    // is (x, y) clear of every other car by d (centre to centre)?
    function clear(x, y, d, self, z) {
      for (let j = 0; j < api.active; j++) { const o = C[j]; if (o !== self && o.line >= 0 && Math.abs(o.z - z) < LEVEL && Math.abs(o.x - x) < d && Math.abs(o.y - y) < d && Math.hypot(o.x - x, o.y - y) < d) return false; }
      return true;
    }
    // how deep car c, at (x, y) heading (hx, hy), would be in other cars' footprints grown
    // by a margin (along, across): 0 when clear
    // (and `ahead`: is the deepest of them ahead of it? mostCar: that one; intoSet: a set to add them
    // to; `fresh`: how deep it is in the ones not in knownSet, the cars it is already caught up with)
    let depth = 0, most = 0, ahead = false, oc = null, ox0 = 0, oy0 = 0, ohx = 0, ohy = 0, mL = 0, mW = 0, mostCar = null, inSet = null, known = null, fresh = 0;
    const overlapTest = o => {
      if (o === oc || (o.soft && Math.sin(o.h) * ohx + Math.cos(o.h) * ohy < 0.5)) return; // (a ride on its way to you, but for one it follows: game.js)
      const dx = o.x - ox0, dy = o.y - oy0, ox = Math.sin(o.h), oy = Math.cos(o.h), cs = Math.abs(ox * ohx + oy * ohy), sn = Math.abs(-ox * ohy + oy * ohx);
      const ea = oc.half + cs * o.half + sn * o.hw + mL - Math.abs(dx * ohx + dy * ohy), eb = oc.hw + sn * o.half + cs * o.hw + mW - Math.abs(-dx * ohy + dy * ohx);
      if (ea > 0 && eb > 0) {
        // (and on the other car's axes too: two cars at an angle, nose to nose on a bend with the
        // oncoming lane, are clear of each other along one of its sides even when their boxes
        // projected on this car's axes alone overlap)
        const ec = o.half + cs * oc.half + sn * oc.hw + mL - Math.abs(dx * ox + dy * oy);
        if (ec <= 0) return;
        const ed = o.hw + sn * oc.half + cs * oc.hw + mW - Math.abs(-dx * oy + dy * ox);
        if (ed <= 0) return;
        const d = Math.min(ea, eb, ec, ed);
        depth += d;
        if (d > most) { most = d; ahead = dx * ohx + dy * ohy > 0; mostCar = o; }
        if (inSet) inSet.add(o);
        if (known && !known.has(o)) fresh += d;
      }
    };
    function overlaps(c, x, y, hx, hy, ml = 0.5, mw = 0.2, intoSet = null, knownSet = null) {
      depth = most = fresh = 0; ahead = false; mostCar = null; oc = c; ox0 = x; oy0 = y; ohx = hx; ohy = hy; mL = ml; mW = mw; inSet = intoSet; known = knownSet;
      near(x, y, c.half + 1, overlapTest, c.z);
      inSet = known = null;
      return depth;
    }
    // and how deep the people (the player, the crowd) and the lamp posts and trunks would be in it
    let inWho = -1, inPosts = 0; // (the walker deepest in it, from the last peopleIn)
    function peopleIn(c, x, y, hx, hy) {
      let d = 0, most = 0;
      inWho = -1; inPosts = 0;
      if (posts && !(c.postPass > 0)) posts.near(x, y, c.half + 0.3, q => { // (not while it has leave to edge past a post, below)
        if (Math.abs(q.z - c.z) >= LEVEL) return;
        const dx = q.x - x, dy = q.y - y, ea = c.half + q.r - Math.abs(dx * hx + dy * hy), eb = c.hw + q.r - Math.abs(-dx * hy + dy * hx);
        if (ea > 0 && eb > 0) { d += Math.min(ea, eb); inPosts += Math.min(ea, eb); }
      });
      const c0 = Math.floor((x - c.half - 1) / CELL), c1 = Math.floor((x + c.half + 1) / CELL), r0 = Math.floor((y - c.half - 1) / CELL), r1 = Math.floor((y + c.half + 1) / CELL);
      for (let a = c0; a <= c1; a++) for (let b = r0; b <= r1; b++) {
        for (let j = bhead[bucket(a, b)]; j >= 0; j = bchain[j]) {
          if (Math.abs(bz[j] - c.z) >= LEVEL) continue;
          const dx = bx[j] - x, dy = by[j] - y, ea = c.half + br[j] - Math.abs(dx * hx + dy * hy), eb = c.hw + br[j] - Math.abs(-dx * hy + dy * hx);
          if (ea > 0 && eb > 0) { const e = Math.min(ea, eb); d += e; if (e > most) { most = e; inWho = bi[j]; } }
        }
      }
      return d;
    }
    // someone of the crowd on a zebra's stripes, or about to step onto them from its kerb
    function onStripes(X) {
      const half = X.half, P = crowd.P;
      for (let i = 0; i < crowd.active; i++) {
        const p = P[i];
        if (p.line < 0 || Math.abs(p.x - X.x) > half + 3 || Math.abs(p.y - X.y) > half + 3 || Math.abs(p.z - X.z) >= LEVEL) continue;
        const dx = p.x - X.x, dy = p.y - X.y, along = Math.abs(dx * X.hx + dy * X.hy), across = Math.abs(-dx * X.hy + dy * X.hx);
        if (along > 2.6 || across > half + 1.2) continue;
        if (across < half || (p.v > 0.2 && Math.abs((p.hx || 0) * X.hx + (p.hy || 0) * X.hy) < 0.6)) return true; // (in the road, or walking out across it)
      }
      return false;
    }
    if (crowd) JN.onStripes = onStripes; // (a ride's driver gives way at a zebra too: cars.js chauffeur)
    function respawn(c, cx, cy, rMin) {
      const cand = net.near(cx, cy, rMin, radius);
      JN.forget(c);
      c.line = -1;
      for (let k = 0; k < 4 && cand.length; k++) { // somewhere no other car is, the way the street goes, not inside a junction
        const line = cand[Math.floor(rnd() * cand.length)], L1 = net.L[line], s = L1.len * (0.1 + 0.8 * rnd()), dir = L1.ow || (rnd() < 0.5 ? 1 : -1);
        if (JN.inner(line) || L1.len < 15 || (net.fit && net.fit[line] < c.hw)) continue; // (nor on a street too narrow for it)
        if (L1.ow && !net.next(line, dir > 0 ? 1 : 0, true)) continue; // (not on a one-way street that leads nowhere: stuck at its end)
        const ahead = dir > 0 ? L1.len - s : s, ar = JN.armAt(line, dir > 0 ? 1 : 0);
        if (ar && ahead < ar.back + 10) continue; // not at a junction's line, or over it
        if (JN.midsOn && (JN.midsOn(line) || []).some(X => Math.abs(X.mid - s) < 30)) continue; // nor at a crossing's
        if (JN.shutNow && JN.shutNow(line, dir)) continue; // nor on a street shut to cars at this hour
        const ln = JN.lanesOf(L1) > 1 && rnd() < 0.5 && !(JN.laneRun && ahead + JN.laneRun(line, dir > 0 ? 1 : 0) < 120) ? 1 : 0, lo = side * JN.shiftOf(L1, ln); // (not in a second lane about to end)
        lanePos(line, s, dir, tmp, lo);
        if (JN.inScramble && JN.inScramble(tmp.x, tmp.y)) continue;
        c.z = tmp.z;
        if (!clear(tmp.x, tmp.y, 12, c, tmp.z) || overlaps(c, tmp.x, tmp.y, tmp.hx, tmp.hy, 3, 1) > 0 || peopleIn(c, tmp.x, tmp.y, tmp.hx, tmp.hy) > 0) continue; // (and not on your car or a ride)
        c.line = line; c.s = s; c.dir = dir; c.v = L1.v * 0.7; c.stuck = 0; c.nx = undefined; c.plan = c.ex = c.ex2 = c.exA = c.pv = null; c.halt = false; c.q = false; c.off = 0;
        c.ln = ln; c.lo = lo; c.lcT = 0; c.lnWait = 0;
        c.wallGap = Infinity; c.wallT = 0; c.atWall = 0; c.narrow = 0; c.narrowF = 0; c.narrowIn = Infinity; // (a wall seen where it was is not one here: looked for at once)
        c.x = tmp.x; c.y = tmp.y; onGround(c, tmp); c.h = Math.atan2(tmp.hx, tmp.hy);
        return;
      }
    }
    // a spatial hash of 16 m cells over the cars (rebuilt each frame) and over what they brake for
    const CELL = 16, NB = 1024, head = new Int32Array(NB), chain = new Int32Array(n), bhead = new Int32Array(NB);
    let bchain = new Int32Array(1024), bx = new Float32Array(1024), by = new Float32Array(1024), bz = new Float32Array(1024), br = new Float32Array(1024), bi = new Int32Array(1024), nb = 0;
    const bucket = (cx, cy) => ((cx * 73856093) ^ (cy * 19349663)) & (NB - 1);
    head.fill(-1); bhead.fill(-1);
    function addBlocker(x, y, z, r, who = -1) { // (who: the walker's place in the crowd)
      if (nb === bx.length) { const g = a => { const b = new a.constructor(a.length * 2); b.set(a); return b; }; bx = g(bx); by = g(by); bz = g(bz); br = g(br); bi = g(bi); bchain = g(bchain); }
      bx[nb] = x; by[nb] = y; bz[nb] = z; br[nb] = r; bi[nb] = who;
      const k = bucket(Math.floor(x / CELL), Math.floor(y / CELL));
      bchain[nb] = bhead[k]; bhead[k] = nb++;
    }
    // call fn(car) for every car with its centre within about r of (x, y) (and, given z, on that level):
    // the traffic's, and the cars in api.extra (your car and a ride, which game.js keeps up to date)
    let ownOnly = false;
    function near(x, y, r, fn, z = null) {
      if (!ownOnly) for (const o of api.extra) if (Math.abs(o.x - x) <= r + o.half && Math.abs(o.y - y) <= r + o.half && (z == null || Math.abs(o.z - z) < LEVEL)) fn(o);
      const R = r + 7; // the longest car's centre is this far from its farthest corner
      const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL), r0 = Math.floor((y - R) / CELL), r1 = Math.floor((y + R) / CELL);
      for (let a = c0; a <= c1; a++) for (let b = r0; b <= r1; b++) {
        for (let j = head[bucket(a, b)]; j >= 0; j = chain[j]) { const o = C[j]; if (o.line >= 0 && Math.abs(o.x - x) <= r + o.half && Math.abs(o.y - y) <= r + o.half && (z == null || Math.abs(o.z - z) < LEVEL)) fn(o); }
      }
    }
    // how far (x, y) is inside car o's footprint grown by m: the way out, or null when it isn't
    function into(o, x, y, m) {
      const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, a = dx * fx + dy * fy, b = -dx * fy + dy * fx;
      const ea = o.half + m - Math.abs(a), eb = o.hw + m - Math.abs(b);
      if (ea <= 0 || eb <= 0) return null;
      return ea < eb ? { x: fx * Math.sign(a || 1) * ea, y: fy * Math.sign(a || 1) * ea } : { x: -fy * Math.sign(b || 1) * eb, y: fx * Math.sign(b || 1) * eb };
    }
    // (x, y) moved out of every car's footprint grown by r (of the cars on level z, if given)
    function pushOut(x, y, r, z = null) {
      for (let it = 0; it < 3; it++) {
        let moved = false;
        near(x, y, r + 1, o => { const e = into(o, x, y, r); if (e) { x += e.x * 1.01; y += e.y * 1.01; moved = true; } }, z);
        if (!moved) break;
      }
      return { x, y };
    }
    // the first point of a way (points st metres apart) inside car o's footprint grown by (gl, gw),
    // refined between points: the distance along it, or -1
    let hO = null, hX = 0, hY = 0, hL = 0, hW = 0;
    const hIn = (x, y) => { const dx = x - hO.x, dy = y - hO.y; return Math.abs(dx * hX + dy * hY) < hL && Math.abs(-dx * hY + dy * hX) < hW; };
    function hitAt(Pa, n, o, gl, gw, st) {
      hO = o; hX = Math.sin(o.h); hY = Math.cos(o.h); hL = gl; hW = gw;
      for (let k = 0; k < n; k++) {
        if (!hIn(Pa[2 * k], Pa[2 * k + 1])) continue;
        if (k === 0) return 0;
        let lo = 0, hi = 1;
        for (let it = 0; it < 4; it++) { const m = (lo + hi) / 2; if (hIn(Pa[2 * k - 2] + (Pa[2 * k] - Pa[2 * k - 2]) * m, Pa[2 * k - 1] + (Pa[2 * k + 1] - Pa[2 * k - 1]) * m)) hi = m; else lo = m; }
        return (k - 1 + hi) * st;
      }
      return -1;
    }
    const onWay = line => { for (let k = 0; k < pathNext.length; k += 2) if (pathNext[k] === line) return true; return false; }; // (the pieces of the way just worked out)
    // the cars on each line this frame (for the room beyond a junction)
    const onLine = new Map();
    // a car coming up exit e's piece towards the junction, near, on a street too narrow for two to pass (one of
    // them in from a facade, narrowF): car c waits at its line for it rather than turn in and stop just inside,
    // nose to nose with it, as that one waits at its own line for c's movement to clear the junction (each for
    // the other: Shibuya's junction 931, a car stood 75 s so with five queues behind)
    function narrowComing(c, e) {
      const m = e.m, ml = net.L[m.line], toward = m.end === 0 ? -1 : 1;
      if (ml.ow || JN.lanesOf(ml) > 1) return false;
      for (const j of onLine.get(m.line) || []) {
        const o = C[j];
        if (o === c || o.dir !== toward) continue;
        const d = toward < 0 ? o.s : ml.len - o.s;
        if (d < 30 && (o.narrowF > 0.2 || o.narrow > 0)) return true;
      }
      return false;
    }
    // is there room for car c on exit e of a junction, beyond it, behind the last car going out
    // that way (and the cars already crossing to it)?
    // (on an exit with two lanes, behind the cars in the lane it will be in)
    function room(c, e) {
      const m = e.m, ml = net.L[m.line], out = m.end === 0 ? 1 : -1, two = JN.lanesOf(ml) > 1, ln = c.ln && e.lanes.includes(c.ln) ? c.ln : 0;
      let free = JN.reach(e), need = 2 * c.half + 2.5;
      for (const j of onLine.get(m.line) || []) {
        const o = C[j];
        if (o === c || o.dir !== out || (two && (o.ln || 0) !== ln)) continue;
        free = Math.min(free, (out > 0 ? o.s : ml.len - o.s) - o.half - m.back);
      }
      for (const a of m.j.active) if ((a.m & 15) === m.i && (!two || (a.m >> 4) === ln) && a.c !== c && a.c.line !== m.line) need += 2 * a.c.half + 2.5;
      // a short exit that simply runs on into another piece, no junction between (a slip road, a loop
      // back): the room is on those pieces too, up to the next junction's line, behind the last car on
      // them, or a car let in stops part way, still across this junction, in the queue for the next
      let reach = JN.reach(e), li = m.line, end = 1 - m.end, base = ml.len - m.back;
      for (let k = 0; k < 3 && reach < need && free >= reach && !JN.armAt(li, end); k++) {
        const nx = net.only(li, end);
        if (!nx) break;
        const l2 = net.L[nx[0]], d2 = nx[1] === 0 ? 1 : -1, a2 = JN.armAt(nx[0], 1 - nx[1]);
        reach = free = base + l2.len - (a2 ? a2.back : 0);
        for (const j of onLine.get(nx[0]) || []) {
          const o = C[j];
          if (o === c || o.dir !== d2) continue;
          free = Math.min(free, base + (d2 > 0 ? o.s : l2.len - o.s) - o.half);
        }
        li = nx[0]; end = 1 - nx[1]; base += l2.len;
      }
      return free >= Math.min(need, reach - 1);
    }
    // is car c's way across the junction at arm a (its line toLine ahead of its centre; its way ahead P,
    // np points step apart from its bumper) blocked by a ride or your car standing in it? That car, or null
    function wayBlocked(c, a, toLine, P, np, step) {
      const from = toLine - c.half - 0.5, j = a.j;
      let hit = null;
      for (const o of api.extra) {
        if ((o.v || 0) >= 0.5 || Math.abs(o.z - c.z) >= LEVEL || Math.hypot(o.x - j.x, o.y - j.y) > 35) continue;
        if (hitAt(P, np, o, o.half + 0.3, o.hw + c.hw + 0.15, step) >= from) { hit = o; break; }
      }
      return hit;
    }
    let redRuns = 0, laneChanges = 0, outOfRing = 0, squeezes = 0;
    const redLog = []; // (the last few cars over a crossing's line on red, how: tools/traffic_why.js)
    const api = { mesh, fleet, C, active: n, near, pushOut, junctions: JN, netL: net.L, extra: [] };
    // who goes first where two cars' ways meet (car c's way comes into o's box d metres ahead of its
    // bumper, and o's into c's d2 ahead): read the same way by both, so that one goes and the other
    // waits and never both. A car that can no longer stop short of the place goes; then the one in
    // the junction (of two in it, the one in first); then the one nearer the place; at a dead heat,
    // the one first in the list (ic, io: the traffic's index, or -1 for a ride or your car). This is
    // what a ride's driver (cars.js chauffeur) reads too, as the traffic reads it of a ride.
    function first(c, o, d, d2, ic, io) {
      const cs = (c.v || 0) * (c.v || 0) / 8 > d + 0.3, os = (o.v || 0) * (o.v || 0) / 8 > d2 + 0.3; // (braking at 4 m/s²)
      if (cs !== os) return cs;
      if (c.mv && o.mv && c.mv.j === o.mv.j) return c.mvT < o.mvT || (c.mvT === o.mvT && ic < io);
      if (c.mv && !o.mv && o.toLine > 0) return true;
      if (!c.mv && o.mv && c.toLine > 0) return false;
      // (already touching, each in the other's way at once: the one in front goes on and the one behind waits,
      // as the one behind can't drive through it; at a dead heat the ride's driver, which never steps
      // further into a car it can see, and the car that gave it way would both stand for good)
      if (d < 0.5 && d2 < 0.5) { const a = (o.x - c.x) * Math.sin(c.h) + (o.y - c.y) * Math.cos(c.h); if (Math.abs(a) > 0.3) return a < 0; }
      return d < d2 - 0.5 || (Math.abs(d - d2) <= 0.5 && ic < io);
    }
    JN.first = first;
    // the Intelligent Driver Model's interaction term: the acceleration a car at speed v takes for
    // something gap metres ahead (bumper to it) moving at vl along its way; s0 the gap it stops at, T its
    // time gap, a and b its comfortable acceleration and braking. (The free road term is the limit above.)
    function idm(v, gap, vl, s0, T, a, b) {
      const ss = s0 + Math.max(0, v * T + v * (v - vl) / (2 * Math.sqrt(a * b)));
      return a * (1 - (ss / Math.max(0.05, gap)) * (ss / Math.max(0.05, gap)));
    }
    if (crowd) crowd.cars = api;
    if (nav) nav.movers = api;
    // clear a junction's box (a scramble whose walk the opening shot turns green at once, #110): a car
    // in it, or still moving within r of its node, comes back elsewhere, out past r, rather than being
    // caught in the box by the crowd stepping off the kerbs
    api.clearBox = (x, y, r) => {
      let k = 0;
      for (const c of C) {
        if (c.line < 0 || Math.hypot(c.x - x, c.y - y) > r || !(JN.inner(c.line) || c.v > 1.5)) continue;
        respawn(c, x, y, r + 20); k++;
      }
      return k;
    };
    // a car leaves the traffic (a taxi you hailed): its slot comes back elsewhere, out of sight
    function take(c) { JN.forget(c); c.line = -1; c.v = 0; }
    // ask traffic car o to back off for t seconds (not your car or a ride, and not one that has
    // already backed off a good while without moving on since): whether it will
    // has it room on its piece to back off into (not at the very start of it)?
    const canBack = o => o.line >= 0 && (o.dir > 0 ? o.s > 0.5 : o.s < net.L[o.line].len - 0.5);
    function backOff(o, t) {
      if (o.stuck === undefined || o.line < 0 || o.boSpent > 6) return false;
      o.backoff = Math.max(o.backoff || 0, t);
      return true;
    }
    // how deep a car-sized box (x, y at height z, heading h, half length and width, grown by m) would
    // be in the traffic's cars (not api.extra): 0 when clear. For a car driven by something else (a
    // ride) to wait rather than move into one, as the traffic waits for it
    const probe = { half: 0, hw: 0, z: 0 };
    function footprint(x, y, z, h, half, hw, m = 0.15) {
      Object.assign(probe, { half, hw, z });
      ownOnly = true;
      const d = overlaps(probe, x, y, Math.sin(h), Math.cos(h), m, m);
      ownOnly = false;
      return d;
    }
    // a ride's driver nose to nose with cars of the traffic that won't move off (each waiting on the other):
    // the ones up against its box (x, y, z, heading h, half length and width, grown by m) are asked to back
    // off a metre or two, as one of two of the traffic is (backOff). Whether any will
    function makeWay(x, y, z, h, half, hw, m = 0.8) {
      Object.assign(probe, { half, hw, z });
      ownOnly = true;
      const set = new Set();
      overlaps(probe, x, y, Math.sin(h), Math.cos(h), m, m, set);
      ownOnly = false;
      let k = 0;
      for (const o of set) if (canBack(o) && backOff(o, 2)) k++;
      return k > 0;
    }
    JN.makeWay = makeWay;
    JN.room = (c, e) => room(c, e); // (a ride's driver waits at the line for room beyond, as the traffic does: never stopped in the box)
    // blockers: the player on foot { x, y, z } and your car or a ride { x, y, half (half length),
    // hw (half width), parked }; a parked one beside the lane is passed by swinging out round it
    let tick = 0;
    const FAR = 160; // cars farther than this from the eye (m, along x and y) take a step every second frame
    // is car c where the camera can see it: near enough, and not behind it or far out to a side?
    const look = new THREE.Vector3();
    function inView(c) {
      if (!eye) return false;
      const dx = c.x - eye.position.x, dy = c.y + eye.position.z, d = Math.hypot(dx, dy);
      const h = Math.hypot(look.x, look.z); // (looking down from high up, all round it)
      return d < 12 || (d < 200 && (h < 0.3 ? d < 150 : (dx * look.x - dy * look.z) / (d * h) > 0.3)); // (sim y is -z)
    }
    function update(dt0, cx, cy, t, blockers) {
      const dt = dt0;
      tick++;
      if (eye) eye.getWorldDirection(look);
      if (fleet) for (const k in fleet) for (const M of fleet[k]) M.count = 0;
      head.fill(-1); bhead.fill(-1); nb = 0;
      for (const a of onLine.values()) a.length = 0;
      for (let i = 0; i < api.active; i++) {
        const c = C[i];
        if (c.line < 0) continue;
        const k = bucket(Math.floor(c.x / CELL), Math.floor(c.y / CELL));
        chain[i] = head[k]; head[k] = i;
        if (!onLine.has(c.line)) onLine.set(c.line, []);
        onLine.get(c.line).push(i);
      }
      JN.update(dt, t);
      for (const b of blockers) if (!b.half) addBlocker(b.x, b.y, b.z, 0.4); // the player on foot and the NPCs (your car and a ride: below)
      if (crowd) for (let i = 0; i < crowd.active; i++) { const p = crowd.P[i]; if (p.line >= 0) addBlocker(p.x, p.y, p.z, 0.3, i); }
      for (let i = 0; i < n; i++) {
        const c = C[i];
        if (i >= api.active) { if (c.line >= 0) JN.forget(c); c.line = -1; if (mesh) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } continue; }
        if (c.line < 0 || Math.hypot(c.x - cx, c.y - cy) > radius * 1.15) respawn(c, cx, cy, c.line < 0 && t < 1 ? 0 : radius * 0.6);
        if (c.line < 0) { if (mesh) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } continue; }
        // far off, a step of two frames every second frame (the same traffic at half the work)
        const half = eye && Math.abs(eye.position.x - c.x) + Math.abs(eye.position.z + c.y) > FAR;
        if (half && (tick + i) & 1) { q.setFromAxisAngle(up, Math.PI - c.h); m4.compose(W(c.x, c.y, c.z), q, one); place(i, c); continue; }
        const dt = half ? 2 * dt0 : dt0;
        const l = net.L[c.line];
        // brake for anything in its way ahead: other cars, the player, pedestrians in the road;
        // the gap is bumper to bumper, so a bus keeps its length back
        const fx = Math.sin(c.h), fy = Math.cos(c.h), reach = Math.min(40, l.v / 0.9 + 4 + c.half);
        // which road it takes at the end of this one, chosen in time to look along it: at a
        // junction, its exit and the pieces across to it (c.ex, c.plan); else the next piece
        const end = c.dir > 0 ? 1 : 0, arm = JN.armAt(c.line, end);
        if (c.nx === undefined) {
          // (the way across chosen before it got here: coming up to it, or crossing the junction before with it)
          c.ex = arm ? (c.exA && c.exA.a === arm ? c.exA.e : c.ex2 && c.ex2.a === arm ? c.ex2.e : JN.choose(arm, c.hw, c.half)) : null;
          if (c.exA && c.exA.a === arm) c.exA = null;
          if (c.ex2 && c.ex2.a === arm) c.ex2 = null;
          c.plan = c.ex ? c.ex.steps.slice(1) : null;
          c.nx = c.ex ? c.ex.steps[0] : net.next(c.line, end, true, c.hw);
        }
        const left = c.dir > 0 ? l.len - c.s : c.s, nl = c.nx ? c.nx[0] : -1, nd = c.nx ? (c.nx[1] === 0 ? 1 : -1) : 0;
        let gap = 40, byCar = false, swerve = 0, front = null, why = '', walker = -1;
        // the road ends ahead in nothing (a stub at the map's edge, a dead end): it slows to turn round there
        if (!c.nx && !arm && left + 4 < gap) { gap = left + 4; why = 'end'; }
        // its way ahead: points every STEP metres from its front bumper along its lane, on to the
        // next piece and its way across a junction (as lanePos smooths it round corners)
        const P = c.ps || (c.ps = new Float32Array(2 * NPATH)), PZ = c.pz || (c.pz = new Float32Array(NPATH)), Q = pathQ;
        let np = 0, pk0 = 0, laneAt = 0; // (laneAt: how far across from the road's line the points are)
        // (far from the eye, points twice as far apart: they serve as well there, at half the work)
        const step = !eye || Math.abs(eye.position.x - c.x) + Math.abs(eye.position.z + c.y) < 250 ? STEP : 2 * STEP;
        c.pst = step;
        {
          const sb = Math.max(0, Math.min(l.len, c.s - c.dir * 2 * step)); // from two steps back (or the start of the line), for the direction
          let li = c.line, di = c.dir, si = sb, q = 0, nq = 0, ck = -1;
          // (moving across to another lane: its way between the two, where it sees the cars in both)
          const loT0 = side * JN.shiftOf(l, c.ln), lane = LANE * side + c.off + (Math.abs(c.lo - loT0) > 0.15 ? (c.lo + loT0) / 2 : c.lo), nxt = pathNext;
          nxt.length = 0;
          if (c.nx) { nxt.push(nl, nd); if (c.plan) for (const st of c.plan) nxt.push(st[0], st[1] === 0 ? 1 : -1); }
          const total = c.half + reach + 2 * step;
          for (let d = 0; d <= total + 2 * step && nq < NPATH + 4; d += step) {
            const L1 = net.L[li];
            if (si < 0 || si > L1.len) {
              if (q + 1 >= nxt.length) break;
              const over = si > L1.len ? si - L1.len : -si;
              li = nxt[q]; di = nxt[q + 1]; q += 2; ck = -1;
              si = di > 0 ? over : net.L[li].len - over;
              if (si < 0 || si > net.L[li].len) break;
            }
            // (the point at si: walking the line's segments on from the last point's, not searching them)
            const Lc = net.L[li], cum = Lc.cum, pt = Lc.pts, nn = cum.length, sc = si < 0 ? 0 : si > Lc.len ? Lc.len : si;
            if (ck < 0) { let lo = 1, hi = nn - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < sc) lo = m + 1; else hi = m; } ck = lo; }
            else { while (ck < nn - 1 && cum[ck] < sc) ck++; while (ck > 1 && cum[ck - 1] > sc) ck--; }
            const tt = (sc - cum[ck - 1]) / Math.max(1e-6, cum[ck] - cum[ck - 1]), b3 = 3 * ck;
            Q[2 * nq] = pt[b3 - 3] + (pt[b3] - pt[b3 - 3]) * tt; Q[2 * nq + 1] = pt[b3 - 2] + (pt[b3 + 1] - pt[b3 - 2]) * tt; pathZ[nq] = pt[b3 - 1] + (pt[b3 + 2] - pt[b3 - 1]) * tt; nq++;
            si += di * step;
          }
          // offset into the lane by the direction over two steps either side; the first point kept is the front bumper
          const k0 = Math.round((Math.abs(c.s - sb) + c.half) / step);
          pk0 = k0; laneAt = lane;
          for (let k = k0; k < nq && np < NPATH; k++) {
            const ka = Math.max(0, k - 2), kb = Math.min(nq - 1, k + 2);
            let hx = Q[2 * kb] - Q[2 * ka], hy = Q[2 * kb + 1] - Q[2 * ka + 1];
            const h = Math.sqrt(hx * hx + hy * hy) || 1; hx /= h; hy /= h; // (sqrt: hypot is slow)
            P[2 * np] = Q[2 * k] - hy * lane; P[2 * np + 1] = Q[2 * k + 1] + hx * lane; PZ[np] = pathZ[k]; np++;
          }
          if (np && Math.hypot(P[0] - c.x, P[1] - c.y) > c.half + step + 1) np = 0; // (it has left its line: off a swing out, say)
        }
        c.np = np;
        if (np) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let k = 0; k < np; k++) { const x = P[2 * k], y = P[2 * k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          const g0 = Math.floor((x0 - 8) / CELL), g1 = Math.floor((x1 + 8) / CELL), h0 = Math.floor((y0 - 8) / CELL), h1 = Math.floor((y1 + 8) / CELL);
          for (let ga = g0; ga <= g1; ga++) for (let gb = h0; gb <= h1; gb++) {
            const k = bucket(ga, gb);
            for (let j = head[k]; j >= 0; j = chain[j]) {
              if (j === i) continue;
              const o = C[j];
              if (o.x < x0 - 8 || o.x > x1 + 8 || o.y < y0 - 8 || o.y > y1 + 8) continue;
              if (Math.abs(o.z - c.z) >= LEVEL && o.line !== c.line && !onWay(o.line)) continue; // over or under this road, on a deck (not on its own way, where heights can be out)
              const d = hitAt(P, np, o, o.half + 0.6, o.hw + c.hw + 0.25, step);
              if (d < 0 || o === c.passBy) continue; // (not the car it squeezes past: below)
              // is it coming into my way as I come into its? Then whoever is in the junction first, or
              // nearer the place where the two ways meet, goes first, and the other waits
              const d2 = o.np ? hitAt(o.ps, o.np, c, c.half + 0.6, c.hw + o.hw + 0.25, o.pst || STEP) : -1;
              // two coming at each other up a street too narrow for both (each in from a facade): the one already in
              // the narrow stretch goes on, and the other waits short of it, in its lane; never into the other
              const headOn = d2 >= 0 && o.line === c.line && o.dir !== c.dir && (c.narrowF > 0.2 || o.narrowF > 0.2);
              if (headOn) {
                const cIn = c.narrow > 0 && c.narrowIn < 1, oIn = o.narrow > 0 && o.narrowIn < 1;
                let g = d + 0.6, w = 'car';
                if (!cIn && c.narrowIn < Infinity && (oIn || d2 < d)) { const g2 = Math.max(0, c.narrowIn - 1.5); if (g2 < g) { g = g2; w = 'narrow'; } }
                if (g < gap) { gap = g; byCar = true; front = o; why = w; }
                continue;
              }
              if (d2 >= 0) {
                const first = c.mv && o.mv && c.mv.j === o.mv.j ? c.mvT < o.mvT || (c.mvT === o.mvT && i < j) : c.mv && !o.mv && o.toLine > 0 ? true : !c.mv && o.mv && c.toLine > 0 ? false : d < d2 - 0.5 || (Math.abs(d - d2) <= 0.5 && i < j);
                if (first) continue;
              }
              const g = d + 0.6;
              if (g < gap) { gap = g; byCar = true; front = o; why = 'car'; }
            }
            for (let j = bhead[k]; j >= 0; j = bchain[j]) { // people in its way
              if (Math.abs(bz[j] - c.z) >= LEVEL || bx[j] < x0 - 3 || bx[j] > x1 + 3 || by[j] < y0 - 3 || by[j] > y1 + 3) continue;
              const r = c.hw + br[j] + 0.15, r2 = r * r, px = bx[j], py = by[j];
              for (let q2 = 0; q2 < np; q2++) {
                const ex = P[2 * q2] - px, ey = P[2 * q2 + 1] - py;
                if (ex * ex + ey * ey >= r2) continue;
                const g = Math.max(c.pw > 5 ? 2.9 : 0, q2 * step - br[j]); // (after a while waiting on someone standing in the road, it edges on, and they step aside)
                if (g < gap) { gap = g; byCar = false; front = null; why = 'person'; walker = bi[j]; }
                break;
              }
            }
          }
        }
        // a ride or your car on the move, along its way as a car of the traffic is (not along a straight line from
        // the bonnet, which misses one round the corner it is turning), and given way to by the same rule as the
        // traffic's (first): the one that goes on is the one that would. A ride stopped on its way counts as on
        // the move (live); one parked, at the kerb, is left to the blockers below (passed side by side, swung out
        // round, or braked for)
        let sawX = null, leadX = null, xQ = false, youBy = null; // (youBy: which of yours it brakes for, and how, for the checks)
        if (np) for (const o of api.extra) {
          if (o.soft || (o.v < 0.3 && !o.live) || (o.z != null && Math.abs(o.z - c.z) >= LEVEL) || Math.abs(o.x - c.x) > 60 || Math.abs(o.y - c.y) > 60) continue;
          // (a ride stopped at a junction's line, waiting its turn, is measured by its own size by a car crossing that
          // junction, not with the margins kept from one on the move: with them the car stood in the box for the
          // ride's nose while the ride waited at its line for that car's movement, each for the other, #243)
          const waiting = c.mv && !o.mv && o.v < 0.3 && o.toLine != null && o.toLine >= 0 && o.toLine < 6;
          const d = hitAt(P, np, o, o.half + (waiting ? 0.1 : 0.6), o.hw + c.hw + (waiting ? 0.05 : 0.25), step);
          if (d < 0) continue;
          (sawX || (sawX = new Set())).add(o.id);
          const d2 = o.np ? hitAt(o.ps, o.np, c, c.half + 0.6, c.hw + o.hw + 0.25, o.pst || STEP) : -1;
          if (d2 >= 0 && first(c, o, d, d2, i, -1)) continue;
          // (and not one whose driver is giving way to this car already, as its own reading of the rule had it last
          // frame: the two readings measure with different margins and could each give way to the other, a car
          // standing in Shinjuku's junction 1105 for the taxi coming for you while the taxi stood for it, 15 s, #254)
          if (o.xBlock && (o.xBlock === c || o.xBlock.of === c)) continue;
          const g = d + 0.6;
          if (g < gap) { gap = g; byCar = true; front = null; why = 'you'; leadX = o; xQ = !!o.q && o.qBy !== c; youBy = o.id + ' on its way'; } // (a ride queueing for a junction: this car queues behind it)
        }
        // in a junction and stopped behind a car waiting at another of its lines (an awkward corner,
        // a short arm whose line can't be set back far enough): that one backs off a little, and
        // after 8 s the car goes on as if it weren't there, to squeeze past it as cars caught up do
        const atLine2 = front && c.mv && !front.mv && front.lineArm && front.lineArm.j === c.mv.j && front.v < 0.3 && front.toLine - front.half < 4;
        if (atLine2 && c.v < 0.3) {
          if (!(front.backoff > 0)) front.backoff = 1.5;
          c.waitOn = c.waitOnCar === front ? (c.waitOn || 0) + dt : 0; c.waitOnCar = front;
          if (c.waitOn > 8) { c.passBy = front; c.waitOn = 0; }
        } else if (!front || front !== c.waitOnCar) { c.waitOn = 0; c.waitOnCar = null; }
        // two in a junction, each stopped for the other as the car ahead (nose to nose where their ways
        // cross, each path seeing the other): after 4 s the one that went in first goes on as if the
        // other weren't there, and the other gives way to it when they touch (below; #144)
        // (or held by each other, a step each took back into the other: neither has the other on its way ahead, and the
        // two stood 63 s in Sydney's junction 461, out of neighbouring lanes of one arm, #243)
        const fr = front || (c.why === 'held' && c.front && c.front.why === 'held' && c.front.front === c ? c.front : null);
        if (fr && c.mv && fr.mv && fr.front === c && c.v < 0.3 && fr.v < 0.3) {
          c.faceAll = c.faceCar === fr ? (c.faceAll || 0) + dt : 0;
          c.faceT = c.faceCar === fr ? (c.faceT || 0) + dt : 0; c.faceCar = fr;
          const cb = canBack(c), fb = canBack(fr); // (the one that can't back off goes on, else the one in first)
          if (c.faceT > 4 && (cb !== fb ? fb : c.mvT < fr.mvT || (c.mvT === fr.mvT && i < C.indexOf(fr)))) { c.passBy = fr; c.faceT = 0; }
        } else { c.faceT = c.faceAll = 0; c.faceCar = null; }
        if (c.passBy && (!c.mv || Math.hypot(c.passBy.x - c.x, c.passBy.y - c.y) > c.half + c.passBy.half + 4)) c.passBy = null;
        // your car and a ride: one parked beside the lane is passed side by side with a hand's width
        // between, or round it: a short swing out towards the kerb, or out over the centre line round
        // one left in the lane, as traffic goes round a stopped car; otherwise braked for like a car ahead
        let youQ = xQ; // (the one braked for is a ride queueing for a junction: this car queues behind it)
        for (const b of blockers) {
          if (!b.half || (b.z != null && Math.abs(b.z - c.z) >= LEVEL)) continue;
          if (!b.parked && b.id && sawX && sawX.has(b.id)) continue; // (on the move and on its way: given way to, or not, above)
          if (np && !b.parked && b.id && api.extra.some(o => o.id === b.id && o.np)) { // (on the move with a way of its own, not on this car's: only one straight across its bonnet, close, holds it)
            const xo = api.extra.find(o => o.id === b.id);
            if (xo && xo.block && (xo.block === c || xo.block.of === c)) continue; // (not one held up by this car itself: the two would wait on each other)
            const dx = b.x - c.x, dy = b.y - c.y, a = dx * fx + dy * fy, w = -dx * fy + dy * fx;
            if (a > 0 && a < c.half + b.half + 4 && Math.abs(w) < c.hw + (b.hw || 0.9) + 0.2 && a - b.half - c.half < gap) { gap = Math.max(0, a - b.half - c.half); byCar = true; front = null; why = 'you'; youBy = b.id + ' across its bonnet'; }
            continue;
          }
          const dx = b.x - c.x, dy = b.y - c.y, a = dx * fx + dy * fy, w = -dx * fy + dy * fx;
          // (never round a ride queueing at a red light, b.q: it waits its turn there, and so does this car)
          if (b.parked && !b.q) {
            const need = c.hw + (b.hw || 0.9) + 0.3;
            // (w0: where it is across from the car's own lane, without the swing out the car has already
            // taken, so that the swing is the whole way out round it and not half of it: with w the swing
            // would stop where it is as far again from the one needed)
            const w0 = w + c.off;
            if (a < -b.half - c.half || a > 45 || Math.abs(w0) >= need) continue;
            // (not round one stopped at a junction's line, a taxi waiting for its turn: it queues behind)
            // (your car parked by the kerb near a junction is not a car waiting at its line: it is gone round)
            const atJ = b.id !== 'car' && arm && left - arm.back < a + b.half + 15;
            const toKerb = w0 + side * need, toCentre = w0 - side * need; // (the kerb is on the keep side)
            // (over the centre line only with nothing coming the other way up to 40 m ahead: else it waits behind,
            // as a driver does; one coming down a narrow street, in from a facade, would meet it head on)
            const sw = Math.abs(toKerb) < 1.6 && Math.abs(toKerb) < Math.abs(toCentre) ? toKerb : Math.abs(toCentre) < 2.6 && !oncoming(c, fx, fy, a + b.half + 30) ? toCentre : null;
            if (sw != null && !atJ) { if (Math.abs(sw) > Math.abs(swerve)) swerve = sw; continue; }
          }
          if (a > 0 && Math.abs(w) < Math.max(1.6, c.hw + (b.hw || 0.9) + 0.2) && a - b.half - c.half < gap) { gap = a - b.half - c.half; byCar = true; front = null; why = 'you'; youQ = !!b.q && b.qBy !== c; youBy = (b.id || 'you on foot') + (b.parked ? ' parked' : '') + ' ahead'; } // (a ride pulling in still reaches into the lane)
        }
        // a lamp post or a trunk in the way (at a corner taken wide): braked for like a car stopped there
        // (along its way ahead, P, round a corner as it will drive it: a line straight on from its heading
        // crossed the corner of a turn, and a car braked to a stop in the junction for the walk-signal post
        // on that corner, which its way never comes near, and the cars behind it ran into it; Roppongi,
        // tools/clip_check.js. With no way ahead, straight on as before)
        if (posts) posts.near(c.x + fx * reach / 2, c.y + fy * reach / 2, reach / 2 + 1, q => {
          if (Math.abs(q.z - c.z) >= LEVEL) return;
          const dx = q.x - c.x, dy = q.y - c.y, a = dx * fx + dy * fy, r = c.hw + q.r + 0.1;
          let g = Infinity;
          if (np) {
            if (a < c.half - r) return; // (beside or behind it)
            const r2 = r * r;
            for (let k = 0; k < np; k++) { const ex = P[2 * k] - q.x, ey = P[2 * k + 1] - q.y; if (ex * ex + ey * ey < r2) { g = k * step - q.r; break; } }
            if (g === Infinity && a + q.r >= c.half && a <= c.half + step && Math.abs(-dx * fy + dy * fx) < r) g = a - q.r - c.half; // (between its bumper and the first point)
          } else if (a + q.r >= c.half && a <= reach && Math.abs(-dx * fy + dy * fx) < r) g = a - q.r - c.half;
          if (g < gap && !(c.postPass > 0)) { gap = g; byCar = true; front = null; why = 'post'; }
        });
        // (stopped for one more than 10 s, a post its way runs into in a junction, say: it edges past it, #144)
        c.postT = why === 'post' && c.v < 0.3 ? (c.postT || 0) + dt : 0;
        if (c.postT > 10 && !inView(c)) { c.postT = 0; respawn(c, cx, cy, radius * 0.6); continue; } // (out of view: it leaves the traffic rather than drive through it)
        if (c.postT > 10) { c.postT = 0; c.postPass = c.mv ? 30 : 6; } else if (c.postPass > 0) c.postPass -= dt; // (in a junction, for the rest of its turn: a bus held there by a walker meanwhile ran out its 6 s and stood at the post again, 200 s in Kyoto's 309)
        // (a facade beside its lane: in from it, below, until its back has passed the place: c.narrow is the
        // metres to go, not a time, so a car that stops beside a facade stays in from it however long it waits)
        // (and only once it is close to the place: one waiting short of a narrow stretch for a car coming the
        // other way through it keeps to its lane, out of that car's way)
        if (c.narrow > 0) {
          c.narrow -= c.v * dt; c.narrowIn = Math.max(0, (c.narrowIn ?? 0) - c.v * dt);
          if (c.narrow <= 0) { c.wallT = 0; c.narrowIn = Infinity; }
          if (!swerve && c.narrowIn < 6 + c.v) swerve = -LANE * side * (c.narrowF || 0);
        } else { c.narrowF = 0; c.narrowIn = Infinity; }
        // (and one slow or stopped in its lane with its body in a facade, a queue along a street that has room only nearer
        // its middle, which the look ahead from the bumper missed: half way in, as one on the move would be, #202;
        // Higashiyama's road 138 kept a queue in a wall)
        if (nav && c.v < 2 && !c.ln && !c.mv && !JN.centred(c.line) && (c.wallChk = (c.wallChk || 0) - dt) <= 0) {
          c.wallChk = 0.5;
          c.inWallNow = !nav.room(c.x, c.y, c.z, c.hw * 0.8, 1.4, false) && Math.abs(c.off) < LANE * 0.4;
        } else if (c.v >= 2 || c.ln || c.mv) c.inWallNow = false;
        if (!swerve && c.inWallNow) swerve = -LANE * side * 0.5;
        // (and such a street is single file there: it counts as in a narrow stretch, so that one coming the other
        // way waits short of it, in its lane, as the narrow rule makes moving cars do, rather than brush past, #264)
        if (c.inWallNow) { c.narrowF = Math.max(c.narrowF || 0, 0.5); c.narrow = Math.max(c.narrow > 0 ? c.narrow : 0, 2 * c.half + 1.5); c.narrowIn = 0; }
        c.off += (swerve - c.off) * Math.min(1, dt * (c.narrow > 0 && Math.abs(swerve) > Math.abs(c.off) ? 3.5 : 1.6)); // (in from a facade the sooner)
        // the junction ahead: in time to stop at its line, the light, a stop sign, the way across
        // and the room beyond it; then in, or wait at the line (the longest waiting goes first)
        let atLine = false, lineGap = Infinity;
        // the junction it comes up to: at the end of this piece, or of the next if that is a short one
        // (its line can be close to where the car comes onto it), with its way across (c.ex, or c.exA)
        let jArm = arm, jEx = c.ex, toLine = arm ? left - arm.back : 0;
        if (!arm && c.nx) { // (on through short pieces that simply follow one another)
          let a2 = null, d2 = left, li = nl, ld = nd;
          for (let k = 0; k < 4 && li >= 0 && d2 < 60; k++) {
            a2 = JN.armAt(li, ld > 0 ? 1 : 0);
            if (a2) { d2 += net.L[li].len - a2.back; break; }
            d2 += net.L[li].len;
            const n2 = net.L[li].len < 30 ? net.only(li, ld > 0 ? 1 : 0) : null;
            if (!n2) break;
            li = n2[0]; ld = n2[1] === 0 ? 1 : -1;
          }
          if (a2 && d2 < c.half + 6 + c.v * c.v / 6) {
            if (!c.exA || c.exA.a !== a2) c.exA = { a: a2, e: JN.choose(a2, c.hw, c.half) };
            if (c.exA.e) { jArm = a2; jEx = c.exA.e; toLine = d2; }
          }
        }
        if (jArm && jEx) {
          // the lane its movement needs, at the line: another way across from the lane it is in, if
          // it could not get across in time (also while it still holds its way through the junction
          // behind, as one pushed over a line there and out onto a short piece before this one: it
          // can't change lanes while it holds that, and waiting for the lane there held that
          // junction, and the queue behind it at a green, for good)
          if ((!c.mv || c.mv.j !== jArm.j) && !jEx.lanes.includes(c.ln || 0) && toLine - c.half < 20) {
            const alt0 = JN.exits(jArm).filter(e => e.lanes.includes(c.ln || 0)), alt1 = alt0.filter(e => !JN.closedNow(e)), alt = alt1.length ? alt1 : alt0; // (not one closed at this hour)
            if (alt.length) {
              const e2 = alt[Math.floor(rnd() * alt.length)];
              if (jArm === arm) { c.ex = jEx = e2; c.plan = e2.steps.slice(1); c.nx = e2.steps[0]; } else { c.exA.e = jEx = e2; }
            } else if (c.mv || c.mv0) c.anyLane = jArm; // (no way on from its lane, and it can't move across while it holds the junction behind: it goes from the lane it is in, #144)
          }
          const lt = JN.light(jArm, jEx), stop = c.v * c.v / 8 < toLine - c.half - 0.3; // (can stop by the line, at 4 m/s²)
          if (c.mv && c.mv.a === jArm && lt !== 'g' && lt != null && stop) { JN.release(c); c.rel = 'lights'; } // the lights changed before it got there
          if (!c.mv || c.mv.a !== jArm) {
            JN.approach(c, jArm, JN.mv(c, jEx), Math.max(0, toLine - c.half) / Math.max(c.v, 2));
            if (toLine < c.half + 4 + c.v * c.v / 6) {
              let go = lt == null || lt === 'g' || (lt === 'y' && !stop);
              if (toLine - c.half < -1) { c.overWhy = `${c.rel || ''} ${c.why} v ${c.v.toFixed(1)} toLine ${(toLine - c.half).toFixed(1)} lane ${c.ln} lo ${c.lo.toFixed(1)} lt ${lt}`; JN.enter(c, jArm, jEx, t, true); c.mv.via = [c.line]; go = false; } // already over the line: in the junction, so through it
              if (go && jArm.sign === 'stop' && !c.halt) go = false;
              let noRoom = false;
              // (an exit too short to wait on before the next junction's line is crossed with that junction, below,
              // and the room asked for is beyond it: asked here, a piece shorter than a car up to that line never had
              // room, and no car ever took it; Shibuya's 811 onto a 39 m piece whose far line is 28 m back, a car stood
              // 121 s at it, #243. Not with a car on the short piece going that way: it waits behind that one)
              const pair = go ? JN.after(jEx, 2 * c.half + 3) : null;
              const through = pair && !(onLine.get(jEx.m.line) || []).some(j => C[j] !== c && C[j].dir === (jEx.m.end === 0 ? 1 : -1));
              if (go && !through && !room(c, jEx)) { go = false; noRoom = true; }
              let narrowOut = false;
              if (go && narrowComing(c, jEx)) { go = false; noRoom = narrowOut = true; } // (and after 5 s, another way out, as for room, below)
              // keep the box clear: not in while its way across is blocked by a ride or your car standing in the
              // junction (it would stop half way across, the junction held, and the two nose to nose, each waiting
              // on the other, until one drove through the other: SUMO's keep-clear, A/B Street's "don't block the
              // box"). After 12 s it goes in all the same, and is given way to as before, so that a car left there
              // for good never shuts the movement out. (One of the traffic waiting at another line with its nose in
              // the way is asked to back off once this car is in, below: kept out for it, the traffic jammed more,
              // 6.1% of the time in Shibuya against 4.8%.) Looked at four times a second while it waits, not every frame
              if (go && np && (c.boxT || 0) < 12 && !((c.wbT = (c.wbT || 0) - dt) > 0)) { c.wbT = 0.25; c.wbCar = wayBlocked(c, jArm, toLine, P, np, step); }
              const wb = go && np && (c.boxT || 0) < 12 ? c.wbCar : null;
              if (wb) { go = false; c.boxT = (c.boxT || 0) + dt; } else if (!go || toLine - c.half > 4) c.boxT = 0;
              // (in a lane its movement can't go from, or still moving across: it waits; but not one still
              // holding its way through the junction behind, whose place in the road stays as it went in
              // by until it is clear of that one: forced over its line there onto a piece too short to wait
              // on, it would wait for good, holding that junction and its queues through every green, #144)
              const inLane = (c.anyLane === jArm && (c.mv || c.mv0)) || (jEx.lanes.includes(c.ln || 0) && (Math.abs(c.lo - side * JN.shiftOf(l, c.ln)) < 0.3 || (c.mv && c.mv.j !== jArm.j)));
              if (!inLane) go = false;
              // a junction just after, too close to wait between: crossed with this one, its way chosen now
              const a2 = go ? JN.after(jEx, 2 * c.half + 3) : null;
              if (a2) {
                if (!c.ex2 || c.ex2.a !== a2) c.ex2 = { a: a2, e: JN.choose(a2, c.hw, c.half) };
                const lt2 = JN.light(a2, c.ex2.e);
                if (!c.ex2.e || !(lt2 == null || lt2 === 'g') || a2.sign === 'stop' || !room(c, c.ex2.e)) go = false;
                // (held at this line by the next one's light: a call for its phase, as if at its line, and the time
                // counted lost on this green, junctions.js; a 6 s green at Shinjuku's 1105 went by on 1103's red, #264)
                if (c.ex2.e && lt2 && lt2 !== 'g') { if (!a2.j.scramble) JN.want(a2); if (toLine - c.half < 3 && jArm.j.sig) jArm.lost1 = true; }
              }
              // (in it already: its way through this junction let in, or, crossing two close junctions together, this
              // one's let in with the one just after, mv0: then a light turning red behind it, or the room beyond
              // filling, doesn't stop it at the line it was let over, holding both junctions' boxes there, as a car
              // stood 87 s at Shibuya's 813 with the cars at the junction's other arms waiting on it, #178)
              const r = (c.mv && c.mv.a === jArm) || (c.mv0 && c.mv0.a === jArm && c.mv && c.mv.j !== jArm.j) ? true : go ? JN.request(c, jArm, jEx, t, a2, a2 && c.ex2.e) : false;
              if (r === true && go) { // the pieces it may still be on before each junction's arm
                if (a2) { c.mv0.via = [c.line]; c.mv.via = [c.line].concat(jEx.steps.map(st => st[0])); } else c.mv.via = [c.line];
              }
              if (r !== true) {
                const g = toLine - c.half + 2.4;
                lineGap = Math.min(lineGap, g);
                if (g < gap) { gap = g; byCar = false; atLine = true; front = null; why = r || (lt === 'r' || lt === 'y' ? 'light' : jArm.sign === 'stop' && !c.halt ? 'stop' : !inLane ? 'lane' : narrowOut ? 'narrow' : 'room'); }
                // no room on its way out for 5 s, at its line with its light green: another way out with room, if
                // there is one (the traffic wanders, so any way will do). A queue that waits for room behind a queue
                // that waits for room, round a block and back, is a ring that never moves: Shibuya's station streets
                // had a car stand 220 s at its line so. Taking another way out breaks the ring, as drivers do
                c.roomT = noRoom && toLine - c.half < 2.5 && c.v < 0.6 && !c.mv ? (c.roomT || 0) + dt : 0;
                if (c.roomT > 5) {
                  c.roomT = 0;
                  // (as JN.choose weighs them: ahead before a turn, a main road before a lane; never a turn back, a road
                  // the data runs through a building, a lesser road than the one it meant to take, or a one-way street
                  // that leads nowhere)
                  const alt = JN.exits(jArm).filter(e => e !== jEx && e.lanes.includes(c.ln || 0) && !JN.closedNow(e) && Math.abs(e.turn) < 2.4 && e.m.rank >= jEx.m.rank
                    && !(net.avoid && net.avoid[e.m.line]) && !(net.L[e.m.line].ow && !net.next(e.m.line, 1 - e.m.end, true)) && room(c, e) && (JN.light(jArm, e) == null || JN.light(jArm, e) === 'g'));
                  if (alt.length) {
                    const w = alt.map(e => Math.max(0.15, (1 + 1.6 * Math.cos(e.turn)) * (0.6 + 0.2 * e.m.rank)));
                    let r = rnd() * w.reduce((a, b) => a + b, 0), e2 = alt[alt.length - 1];
                    for (let k = 0; k < alt.length; k++) if ((r -= w[k]) < 0) { e2 = alt[k]; break; }
                    if (jArm === arm) { c.ex = jEx = e2; c.plan = e2.steps.slice(1); c.nx = e2.steps[0]; } else if (c.exA) c.exA.e = jEx = e2;
                    c.reroutes = (c.reroutes || 0) + 1; outOfRing++;
                  }
                }
                if (toLine - c.half < 2.5 && c.v < 0.6) {
                  if (jArm.sign === 'stop') c.halt = true;
                  if (r) { JN.wait(c, jArm, jEx, t); c.wj = jArm.j; } // its turn comes: it waits for the way across, not for a light or room
                }
              }
            }
          }
          c.toLine = toLine; c.lineArm = jArm; c.lineEx = jEx;
        } else c.lineArm = null;
        // caught in a scramble's box when its walk comes on (held up on its way out, say): out at a
        // walking pace, the crowd parting round it and anyone in its way stopping it, as a taxi caught there does
        if (JN.scrambles && JN.scrambles.length) for (const sj of JN.scrambles) {
          if (sj.ph === 3 && Math.hypot(c.x - sj.x, c.y - sj.y) < sj.reach * 0.75 && 4.8 < gap) { gap = 4.8; byCar = false; front = null; why = 'walk'; }
        }
        // a crossing between junctions ahead, on this piece or the next (junctions.js): held at its line
        // by its lights, or at a zebra by someone on the stripes or stepping onto them (not for ever: a
        // walker who stands there, it edges on after a while, braking for them as for anyone in the road)
        if (JN.midsOn) for (let pass = 0; pass < 2; pass++) {
          const li = pass ? nl : c.line, di = pass ? nd : c.dir, base = pass ? left : 0, Ms = li >= 0 ? JN.midsOn(li) : null;
          if (!Ms) continue;
          for (const X of Ms) {
            const d = base + (pass ? (di > 0 ? X.mid : net.L[li].len - X.mid) : (di > 0 ? X.mid - c.s : c.s - X.mid));
            const a = X.arms.find(b => b.end === (di > 0 ? 1 : 0));
            if (!a || d < 0 || d > reach + c.half + 20) continue;
            const toStop = d - a.back - c.half; // (its front bumper to the line)
            if (toStop < -0.5) continue; // over it already: on across
            let hold = false;
            if (X.sig) {
              const lt = JN.light(a), can = c.v * c.v / 8 < toStop - 0.3;
              hold = lt === 'r' || (lt === 'y' && can);
              if (lt === 'r' && X.ph === 1 && toStop > 0 && toStop - c.v * dt <= 0 && !pass) { redRuns++; if (redLog.length < 20) redLog.push(`crossing ${X.id}: v ${c.v.toFixed(1)} to its line ${toStop.toFixed(2)} ${why} gap ${gap.toFixed(1)} t ${X.t.toFixed(1)}`); }
            } else if (crowd && !(c.zebraOff > 0) && c.v * c.v / 8 < toStop + 0.5) hold = onStripes(X);
            if (hold) {
              const g = toStop + 2.4;
              if (g < gap) { gap = g; byCar = false; atLine = true; front = null; why = X.sig ? 'light' : 'zebra'; }
            }
            break; // (the nearest one ahead rules)
          }
        }
        if (c.zebraOff > 0) c.zebraOff -= dt;
        // out of a junction: its movement given up once the whole car is clear of the box (on its exit
        // past the stop line there), or once it is on a piece that is none of its way there and across
        for (const key of ['mv0', 'mv']) {
          const mv = c[key];
          if (!mv) continue;
          const m = mv.e.m;
          if (c.line === m.line) { if ((m.end === 0 ? c.s : l.len - c.s) > m.back + c.half + 0.5) JN.release(c, key); }
          else if (c.line !== mv.a.line && !mv.j.inner.has(c.line) && !(mv.via && mv.via.includes(c.line))) JN.release(c, key);
        }
        // lanes, on a road with two each way: the one its way on needs (its movement at the junction
        // ahead, or the road it simply goes on into), or else the other when the car ahead in this one
        // is slow (an overtake); across once it is clear beside it there, never in a junction, and
        // close to a line only into the lane it must be in
        if (JN.lanesOf(l) > 1) {
          c.lcT = (c.lcT || 0) + dt;
          // (the lane ends, or moves across, on the road ahead before the next junction: JN.laneRun looks
          // past the pieces between, so that a car moves across in time where a short stretch comes first)
          const endAt = arm || !JN.laneRun ? Infinity : left + JN.laneRun(c.line, c.dir > 0 ? 1 : 0), ends = ln => ln && endAt < 90 + 2 * c.v;
          const wrong = ln => (jArm && jEx && toLine < 150 && !jEx.lanes.includes(ln)) || ends(ln) || (ln && c.noL1 > 0); // (noL1: a facade beside the second lane, below)
          if (c.noL1 > 0) c.noL1 -= dt;
          let to = c.ln || 0, must = false;
          if (wrong(to) && !wrong(1 - to)) { to = 1 - to; must = true; }
          else if (wrong(to) && jArm && jEx && arm === jArm && !jEx.lanes.includes(to)) { // (neither will do: another way on from the lane it is in)
            const alt0 = JN.exits(jArm).filter(e => e.lanes.includes(to)), alt1 = alt0.filter(e => !JN.closedNow(e)), alt = alt1.length ? alt1 : alt0; // (not one closed at this hour)
            if (alt.length) { const e2 = alt[Math.floor(rnd() * alt.length)]; c.ex = jEx = e2; c.plan = e2.steps.slice(1); c.nx = e2.steps[0]; }
          }
          else if (front && why === 'car' && front.v < Math.min(5, 0.6 * l.v) && gap < 30 && c.lcT > 4 && !wrong(1 - to)) to = 1 - to;
          if (to !== (c.ln || 0) && !c.mv && !c.mv0 && (must || !(jArm && toLine - c.half < 8))) {
            c.lnWait = must ? (c.lnWait || 0) + dt : 0;
            lanePos(c.line, c.s, c.dir, tmp, c.off + side * JN.shiftOf(l, to), c.pv, c.nx ? [nl, nd] : null);
            const ml = c.lnWait > 15 ? 0.3 : 0.8 + c.v * 0.9; // (waiting long at a line, it squeezes in)
            // (one at a time: not while a car close by on this road is moving across itself)
            let busy = false;
            for (const j of onLine.get(c.line) || []) { const o = C[j]; if (o !== c && o.dir === c.dir && Math.abs(o.s - c.s) < ml + o.half + c.half + 6 && Math.abs(o.lo - side * JN.shiftOf(l, o.ln)) > 0.15) { busy = true; break; } }
            if (!busy && overlaps(c, tmp.x, tmp.y, fx, fy, ml, 0.25) === 0 && peopleIn(c, tmp.x, tmp.y, fx, fy) === 0) { c.ln = to; c.lcT = 0; c.lnWait = 0; laneChanges++; }
          }
        } else c.ln = 0;
        // given its way across but not yet at its line, and stopped there behind a car that is not in
        // that junction (one waiting at another of its lines, where two roads come in side by side,
        // for this very movement to clear): it gives the movement up and waits its turn
        c.mvHold = c.mv && c.mv.a === jArm && toLine - c.half > 0.5 && c.v < 0.3 && byCar && front && !(front.mv && front.mv.j === c.mv.j) ? (c.mvHold || 0) + dt : 0;
        if (c.mvHold > 4) { JN.release(c); c.mvHold = 0; c.rel = 'hold'; }
        // a wall across its way: a road the data runs through a building (route.js flags it, net.avoid, a
        // second or two after the start, when cars can already be on it) or a lane into a facade. Its way
        // ahead is looked along every half second (on a flagged road every frame): braked for like a car
        // stopped there; out of sight a car on a flagged road, or stopped at a wall, leaves the traffic
        // (its slot comes back elsewhere), and in sight one stopped at a wall turns round as from a jam
        const flagged = !!(net.avoid && net.avoid[c.line]), far = !eye || Math.hypot(eye.position.x - c.x, -eye.position.z - c.y) > 140;
        if (flagged && far) { respawn(c, cx, cy, radius * 0.6); continue; }
        if (nav && np) {
          // (between looks, a wall found comes nearer as the car drives on; none found is none: Infinity, not
          // the 40 m the look reaches, which counted down would read as a wall just ahead of every car)
          if (c.wallGap == null) c.wallGap = Infinity;
          else if (c.wallGap < Infinity) c.wallGap -= c.v * dt;
          if ((c.wallT = (c.wallT || 0) - dt) <= 0 || flagged) {
            c.wallT = 0.5; c.wallGap = Infinity;
            // (each point at the height of the road there, not the car's: up a canal bridge's ramp, the deck
            // ahead stands higher than a car at its foot, and at the car's height read as a wall across the
            // way, where the car stopped; tools/game_check.js, Amsterdam)
            const PZ = c.pz, dz = c.z - PZ[0];
            let nF = 0, nEnd = 0, nIn = Infinity; // (how far in from its lane it needs to be on the 25 m ahead, for how far, and from where)
            for (let k = 0; k < np; k++) {
              const zk = PZ[k] + dz, deck = zk > nav.terrain(P[2 * k], P[2 * k + 1]) + 2;
              if (nav.room(P[2 * k], P[2 * k + 1], zk, c.hw * 0.8, 1.4, deck)) continue;
              // a facade beside its lane, but room nearer the middle of the street: it moves in only as far as it
              // needs to there (so that two coming the other way up a narrow street can still pass). How far in
              // is measured from its own lane, not from where it already is: from there (half way in, say) the
              // share found would be taken as the whole swing, and it would stay half way, brushing the facade
              const q = pk0 + k, qx = pathQ[2 * q], qy = pathQ[2 * q + 1];
              let f = -1;
              if (Math.abs(laneAt) > 0.05) {
                const ux = (P[2 * k] - qx) / laneAt, uy = (P[2 * k + 1] - qy) / laneAt, base = laneAt - c.off;
                for (const F of [0.25, 0.5, 0.75, 1]) {
                  const at = base - LANE * side * F;
                  if (nav.room(qx + ux * at, qy + uy * at, zk, c.hw * 0.8, 1.4, deck)) { f = F; break; }
                }
              }
              if (f >= 0) { if (k * step < 25) { nF = Math.max(nF, f); nEnd = Math.max(nEnd, k * step + 2 * c.half + 1.5); nIn = Math.min(nIn, k * step); } continue; }
              c.wallGap = k * step; break;
            }
            // (a facade still beside it from before, further in: it keeps to that one until it is past it)
            if (nF > 0) { if (!(c.narrow > 0) || nF >= c.narrowF) c.narrowF = nF; c.narrow = Math.max(c.narrow > 0 ? c.narrow : 0, nEnd); c.narrowIn = Math.min(c.narrow > 0 && c.narrowIn != null ? c.narrowIn : Infinity, nIn); c.narrowNow = true; } else c.narrowNow = false;
          }
          if (c.ln && (c.wallGap < 40 || c.narrowNow)) c.noL1 = 6; // (a facade by the second lane: back to the first)
          if (c.wallGap < gap) { gap = c.wallGap; byCar = false; front = null; why = 'wall'; }
          // (stood at it, or creeping up to it under 1 m/s with less than 3 m left: a bus nosing along a one-way
          // street that hugs a facade crept into the wall for seconds at 0.3 m/s before it gave up, #202)
          c.atWall = why === 'wall' && (c.v < 0.1 || (c.v < 1 && gap < 3)) ? (c.atWall || 0) + dt : 0;
          if (c.atWall > 1.5) {
            c.atWall = 0; c.wallT = 0;
            if (far) { respawn(c, cx, cy, radius * 0.6); continue; }
            c.stuck = STUCK + 1; // (turned round below, as from a jam; on a one-way street it waits to be out of sight)
          }
        }
        c.q = atLine || (why === 'person' && walker >= 0 && c.v < 0.5 && lineGap < gap + 4) || (byCar && c.v < 0.5 && (front != null ? !!front.q : why === 'you' && youQ)); // queueing at a junction (behind a car, or a ride, queueing there; or held by the crowd crossing at its line, not by you, who may stand there for good)
        // counted at its arm for the signals' max-pressure (junctions.js): queued, and whether the head of the queue waits for room beyond
        if (c.q && c.lineArm && c.lineArm.j.sig && c.toLine < 80) { const a = c.lineArm; a.qn1 = (a.qn1 || 0) + 1; if (why === 'room' && c.toLine - c.half < 3) a.full1 = true; if (why === 'cross' && c.toLine - c.half < 3) a.lost1 = true; }
        // caught up in another car (two stopped for each other can't get out by waiting): the
        // one in front creeps on, as far as that frees it, and the other backs off (below)
        // (getting out of one never takes it into another: `caught` holds the ones it is caught up with)
        const caught = c.caught || (c.caught = new Set());
        caught.clear();
        const tangled = c.v < 0.5 ? overlaps(c, c.x, c.y, fx, fy, 0, 0, caught) : 0, cg = tangled > 0 ? caught : null;
        // still caught after 4 s (two that each wait for the other): out of sight it leaves
        // the traffic (its slot comes back elsewhere), in sight it drives on out of the other, as long
        // as that takes it into nothing else
        c.tangleT = tangled > 0 ? (c.tangleT || 0) + dt : 0;
        if (c.tangleT > 4 && Math.hypot(c.x - cx, c.y - cy) > 140) { JN.forget(c); c.line = -1; c.tangleT = 0; if (mesh) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } continue; }
        const free = c.tangleT > 4, behind = tangled > 0 && ahead && !free;
        // up to the limit, and braking in time for what is ahead (gently from far off, at most 3.5 m/s²)
        const want = tangled > 0 && !behind ? 1.5 : gap < 2.6 ? 0 : Math.min(l.v * PACE, (gap - 2.6) * 0.9, Math.sqrt(7 * (gap - 2.6)) + 0.5);
        // and what it closes on, by the Intelligent Driver Model's interaction term (Treiber, Hennecke and
        // Helbing 2000): the gap it wants grows with its speed and with how fast it closes, so it starts to
        // brake early and gently for a queue or a red line seen from 40 m, rather than at the last moment at
        // 8 m/s² as the limit above alone did. Never faster than that limit: only earlier, softer braking
        let dv = Math.max(-8 * dt, Math.min(3 * dt, want - c.v));
        if (gap < 40 && !(tangled > 0 && !behind)) {
          const ld = front || leadX, vl = ld ? (ld.v || 0) * (Math.sin(ld.h) * fx + Math.cos(ld.h) * fy) : 0;
          dv = Math.min(dv, idm(c.v, gap, vl, 2.6, 0.8, 2.5, 3) * dt);
        }
        c.v = Math.max(0, c.v + Math.max(-8 * dt, dv)); // (never below a stop: braking for what is close ahead took a stopped car's speed below 0, and it ran away backwards, at up to 17 m/s into the walls, #202)
        let s = c.s + c.dir * c.v * dt, line = c.line, dir = c.dir;
        const away = !eye || Math.hypot(eye.position.x - c.x, -eye.position.z - c.y) > 90;
        c.still = c.v < 0.3 ? (c.still || 0) + dt : 0;
        // (and one that has gone nowhere for a minute, however it has edged, turned or stopped and
        // started where it stands, a minute and a half in a queue: a knot no rule here undoes, out of sight)
        if (c.ax === undefined || Math.abs(c.x - c.ax) + Math.abs(c.y - c.ay) > 4) { c.ax = c.x; c.ay = c.y; c.idle = 0; } else c.idle += dt;
        if ((c.still > 45 && !c.q || c.idle > (c.q ? 90 : 60)) && (!eye || Math.hypot(eye.position.x - c.x, -eye.position.z - c.y) > 150)) { c.still = c.idle = 0; respawn(c, cx, cy, radius * 0.6); continue; } // out of sight, a car stuck a long time (not queueing) comes back elsewhere
        if (c.stuck > (tangled > 0 ? 2 : STUCK)) { // a jam that won't clear: turn round, or out of sight on a one-way street, come back elsewhere
          c.stuck = 0;
          if (!l.ow) dir = -dir;
          else if (away) { respawn(c, cx, cy, radius * 0.6); continue; }
        }
        if (s < 0 || s > l.len) {
          if (dir === c.dir && c.nx) { line = nl; dir = nd; s = nd > 0 ? 0 : net.L[line].len; }
          else if (l.ow && away) { respawn(c, cx, cy, radius * 0.6); continue; } // the end of a one-way street (the edge of the map)
          else if (l.ow) { s = Math.max(0, Math.min(l.len, s)); c.v = 0; } // in sight: it waits there (turned round it would meet the traffic head on in its one lane) and comes back elsewhere once out of sight
          else { dir = -dir; s = Math.max(0, Math.min(l.len, s)); }
        }
        // across its stop line on red, with the cross road's green (the checks count it: tools/traffic_check.js)
        if (c.lineArm && c.toLine > 0 && c.toLine - c.v * dt <= 0 && JN.light(c.lineArm, c.lineEx) === 'r' && c.lineArm.j.st === 'g' && !(c.mv && c.mv.a === c.lineArm)) {
          redRuns++;
          const j = c.lineArm.j;
          if (redLog.length < 20) redLog.push(`junction ${j.id}: arm ${c.lineArm.i} (phase ${c.lineArm.phase}) at phase ${j.ph} green ${j.t.toFixed(1)} s: v ${c.v.toFixed(1)} to its line ${c.toLine.toFixed(2)} ${why} gap ${gap.toFixed(1)}`);
        }
        const onto = line !== c.line, nx2 = c.plan && c.plan.length ? [c.plan[0][0], c.plan[0][1] === 0 ? 1 : -1] : null;
        // (across to its lane a little at a time, slowly while it is barely moving, nosing that way)
        // (in a junction it keeps the lane it went in by: its way across is that lane's)
        const back = line === c.line && dir !== c.dir, keepIt = c.mv && !back, lnNow = keepIt ? c.ln : !back && JN.lanesOf(net.L[line]) > 1 ? c.ln : 0, loT = side * JN.shiftOf(net.L[line], lnNow);
        // (but not over the middle of a two-way road: out of a one-way street's lane nearest the middle,
        // the lane kept across the junction is the oncoming one there, so it moves across at once, and
        // can do so standing, where a car waiting at that road's line would otherwise hold it until it squeezed through)
        const across = !back && !net.L[line].ow && LANE + side * (c.off + c.lo) < c.hw + 0.2;
        const rate = Math.min(1.3, 0.4 + 0.15 * c.v) * dt, lo1 = back ? 0 : keepIt && !across ? c.lo : c.lo + Math.max(-rate, Math.min(rate, loT - c.lo));
        lanePos(line, s, dir, tmp, c.off + lo1, onto ? [c.line, c.dir] : dir === c.dir ? c.pv : null, onto ? nx2 : dir === c.dir && c.nx ? [nl, nd] : null);
        let dh = Math.atan2(tmp.hx, tmp.hy) - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const yaw = !back && dt > 0 ? Math.atan2((lo1 - c.lo) / dt, Math.max(c.v, 1.5)) : 0; // (a lane change: nosing across, left of the way it goes for a shift to the left)
        const turn = line !== c.line || dir !== c.dir, h = c.h + (back ? dh : dh * Math.min(1, dt * 8)) - yaw * Math.min(1, dt * 8); // turning round: at once
        // never into another car: turning round puts the car in the other lane, and turning into
        // a road may meet a car coming into it from another, so those wait for the way to be
        // clear; any other step waits unless the car is already caught up with one
        let held = false, holder = null;
        const hx1 = Math.sin(h), hy1 = Math.cos(h), hx0 = Math.sin(c.h), hy0 = Math.cos(c.h);
        const moves = s !== c.s || h !== c.h || tmp.x !== c.x || tmp.y !== c.y; // (a swing out moves it sideways where it stands)
        if (turn) { const d1 = overlaps(c, tmp.x, tmp.y, hx1, hy1, tangled > 0 ? 0 : 0.5, tangled > 0 ? 0 : 0.2, null, cg); held = d1 > 0 && (!(d1 < tangled) || fresh > 0); holder = mostCar; }
        else if (moves) { // (close beside one, or caught up with one, a move that gets no closer will do; caught up, never into a third)
          const d1 = overlaps(c, tmp.x, tmp.y, hx1, hy1, 0.15, 0.05, null, cg), o = mostCar, f1 = fresh, d0 = d1 > 0 ? overlaps(c, c.x, c.y, hx0, hy0, 0.15, 0.05, null, cg) : 0;
          held = d1 > 0 && (tangled > 0 ? (d1 > d0 + 1e-4 && !free) || f1 > fresh + 1e-4 : d1 > d0 + 1e-3); holder = o;
        }
        // in a junction and held there by a car waiting at its line (a bus swinging wide, say): that one backs off a little
        if (held && holder && c.mv && !holder.mv && holder.v < 0.3 && holder.toLine != null && holder.toLine - holder.half < 4) backOff(holder, 1.5);
        // (a step taken back below, last frame, is held too, by the car it would have gone into: #144)
        const revBy = !held && c.revT > 0 && c.revBy && c.revBy.line >= 0 ? c.revBy : null;
        c.revT = 0; // (set again below if this frame's step is taken back too)
        c.inHeld = held || revBy ? (c.inHeld || 0) + dt : 0;
        // held a while by a car that is stopped too (an awkward corner, two nose to nose where a turn
        // cuts across the other lane): one of them gives way, backing off a metre or two, and the cars
        // behind it back off in turn to make it room (below). The one not in the junction gives way to
        // the one in it; of two in it, the one that went in later; of two on a street, one of the two
        const heldBy0 = held ? holder : revBy;
        if (heldBy0 && heldBy0.v < 0.3 && c.inHeld > 3 && !(c.giveT > 0)) {
          c.giveT = 5;
          const mutual = heldBy0.front === c, j = C.indexOf(heldBy0);
          const yieldC = c.mv && heldBy0.mv ? mutual && (c.mvT > heldBy0.mvT || (c.mvT === heldBy0.mvT && i > j)) : !c.mv && heldBy0.mv ? mutual : !c.mv && !heldBy0.mv && mutual && i > j;
          let yl = yieldC ? c : heldBy0;
          if (!canBack(yl) && canBack(yl === c ? heldBy0 : c)) yl = yl === c ? heldBy0 : c; // (not one at the very start of its piece, with nowhere to back off to: the other)
          backOff(yl, 1.5);
        }
        if (c.giveT > 0) c.giveT -= dt;
        // held a long time all the same (a knot no backing off undoes), or in a junction caught up behind
        // one for 10 s: out of view (behind the camera, or far off) it leaves the traffic (its slot comes
        // back elsewhere); in view it waits on, and only after a minute and a half squeezes past, through
        // the other car, as the last way out of a knot you stand and watch
        c.behindT = behind && !turn ? (c.behindT || 0) + dt : 0;
        const long = c.inHeld > (holder && holder.v >= 0.3 ? 25 : c.mv ? 10 : 15) || (c.mv && c.behindT > 10);
        if (long && !inView(c)) { c.inHeld = c.behindT = 0; respawn(c, cx, cy, radius * 0.6); continue; }
        // (the one of two nose to nose in a junction that goes on, held by the other 20 s, the queue behind
        // that one too close for it to back off: it squeezes past then, not after the minute and a half)
        // (or, of two held by each other that backing off hasn't parted in 30 s, the one in the junction first: two head-on
        // at the mouth of a piece stood 61 s in Sydney's junction 472, the one that could back off boxed in behind, #243)
        const stuckPair = heldBy0 && heldBy0.front === c && c.inHeld > 30 && (!heldBy0.mv || (c.mv && (c.mvT < heldBy0.mvT || (c.mvT === heldBy0.mvT && i < C.indexOf(heldBy0)))));
        const squeeze = long && (c.inHeld > 90 || (c.passBy && c.passBy === heldBy0 && c.faceAll > 20) || stuckPair);
        if (squeeze && !c.squeezing) squeezes++;
        c.squeezing = squeeze;
        if (squeeze) held = false;
        if (!held && (turn || moves)) {
          const d1 = peopleIn(c, tmp.x, tmp.y, hx1, hy1), who = inWho;
          const p1 = inPosts;
          held = d1 > (c.pw > 5 ? 0.12 : 0.02) && d1 > peopleIn(c, c.x, c.y, hx0, hy0) + 1e-3; // (waited on a while, it edges up to them, not into them: they step aside, below)
          if (held && who >= 0) walker = who; // (a walker against it: asked to turn back, below, if it waits on them)
          // (held by a post alone, its body's corner swinging over the kerb at a junction's corner: after 10 s it has
          // leave to edge past, as for a post ahead, above; a bus stood 106 s so in Tokyo's 689, the junction's queues behind)
          c.postHeld = held && who < 0 && p1 >= d1 - 1e-3 ? (c.postHeld || 0) + dt : 0;
          // (out of view it leaves the traffic instead, as a knot does below: edged past, a bus's body went through a street
          // light at Shibuya's 1916 in the clip check)
          if (c.postHeld > 10 && !inView(c)) { c.postHeld = 0; respawn(c, cx, cy, radius * 0.6); continue; }
          if (c.postHeld > 10) { c.postHeld = 0; c.postPass = c.mv ? 30 : 6; held = false; }
        }
        if (behind && !turn && !squeeze) held = true;
        if (c.backoff > 0) { // backing off for a car that can't get past, a metre or two, if the way behind is clear
          c.v = 0; c.boSpent = (c.boSpent || 0) + dt;
          const sb = Math.max(0, Math.min(l.len, c.s - c.dir * 1.2 * dt));
          lanePos(c.line, sb, c.dir, tmp, c.off + c.lo, c.pv, c.nx ? [nl, nd] : null);
          const bd = overlaps(c, tmp.x - hx0 * 0.6, tmp.y - hy0 * 0.6, hx0, hy0, 0.3, 0.1), bk = mostCar;
          if (bd === 0 && peopleIn(c, tmp.x, tmp.y, hx0, hy0) === 0) { c.s = sb; c.x = tmp.x; c.y = tmp.y; onGround(c, tmp); c.backoff -= dt; }
          else if (bk && bk.v < 0.5 && (bk.x - c.x) * hx0 + (bk.y - c.y) * hy0 < 0 && Math.sin(bk.h) * hx0 + Math.cos(bk.h) * hy0 > 0.5 && backOff(bk, c.backoff)) c.backoff -= dt * 0.25; // (the car behind it, stopped and going its way, backs off first)
          else c.backoff -= dt;
          held = true;
        } else if (c.v > 2) c.boSpent = 0;
        if (held && tangled > 0) { // can't get out ahead: try another road next (if it isn't in a junction yet), and back up a little
          if (!c.mv) { c.nx = undefined; c.plan = c.ex = null; }
          const sb = Math.max(0, Math.min(l.len, c.s - c.dir * 1.5 * dt));
          lanePos(c.line, sb, c.dir, tmp, c.off + c.lo, c.pv, c.nx ? [nl, nd] : null);
          if (overlaps(c, tmp.x, tmp.y, hx0, hy0, 0, 0, null, caught) < tangled - 1e-4 && fresh === 0 && peopleIn(c, tmp.x, tmp.y, hx0, hy0) <= peopleIn(c, c.x, c.y, hx0, hy0)) { c.s = sb; c.x = tmp.x; c.y = tmp.y; onGround(c, tmp); }
        }
        // held part way across to another lane: back to the one it came from (it moves across later)
        c.lnHeld = held && !back && Math.abs(c.lo - loT) > 0.15 ? (c.lnHeld || 0) + dt : 0;
        if (c.lnHeld > 1.5 && JN.lanesOf(l) > 1 && !c.mv) { c.ln = c.ln ? 0 : 1; c.lnHeld = 0; c.lcT = 0; }
        if (held) c.v = 0;
        else {
          const was = [c.line, c.s, c.dir, c.x, c.y, c.z, c.h];
          const wasLane = [c.lo, c.ln];
          if (turn) { // onto the next piece: of its way across a junction, or a new one
            c.pv = line !== c.line ? [c.line, c.dir] : null;
            if (line !== c.line && c.plan && c.plan.length) c.nx = c.plan.shift();
            else { c.nx = undefined; c.plan = c.ex = null; }
            c.halt = false; c.toLine = undefined;
            if (c.wj) JN.unwait(c);
          }
          if (line === c.line && dir !== c.dir) { JN.forget(c); c.v = Math.min(c.v, 1.5); } // turned round (slowly: never at speed)
          c.line = line; c.s = s; c.dir = dir; c.lo = lo1; c.ln = lnNow;
          c.x = tmp.x; c.y = tmp.y; onGround(c, tmp); c.h = h;
          // and a step along its road that took it deeper into another car is taken back (one parting
          // from a car it has long been caught with: deeper into any other), unless it is squeezing past
          // one it has waited on a long time; a step onto the next road was checked above, with the junction
          // Taken back, it is held by that car, as by a step held above: in a junction, by one waiting at
          // its line whose nose is in the way out (and which waits for this very movement to clear), that one
          // backs off; and it squeezes past in time, as one held is (#144: the step was taken back unseen,
          // the time held never counted, and two nose to nose, or a movement out of a junction and the car
          // waiting on it, stood for good)
          if (!turn && !squeeze) {
            const kn = free ? caught : null, d1 = overlaps(c, c.x, c.y, Math.sin(c.h), Math.cos(c.h), 0, 0, null, kn), f1 = free ? fresh : d1, o1 = mostCar;
            if (f1 > 0 && f1 > (overlaps(c, was[3], was[4], Math.sin(was[6]), Math.cos(was[6]), 0, 0, null, kn), free ? fresh : depth) + 1e-3) {
              [c.line, c.s, c.dir, c.x, c.y, c.z, c.h] = was;
              [c.lo, c.ln] = wasLane;
              c.v = 0;
              held = true; holder = o1; c.revT = dt; c.revBy = o1;
              if (o1 && c.mv && !o1.mv && o1.v < 0.3 && o1.toLine != null && o1.toLine - o1.half < 4) backOff(o1, 1.5);
            }
          }
        }
        c.stuck = c.v < 0.1 && (byCar || held || (why === 'person' && walker < 0)) && !c.q ? c.stuck + dt : 0; // (and held by you, or someone not of the crowd, who won't step aside: as from a jam, in the end it turns round)
        c.zebraT = why === 'zebra' && c.v < 0.3 ? (c.zebraT || 0) + dt : 0;
        if (c.zebraT > 15) { c.zebraT = 0; c.zebraOff = 6; }
        c.why = held ? 'held' : why; c.youBy = why === 'you' ? youBy : null; c.front = held ? holder : front; c.who = walker; c.heldBy = held ? (holder ? 'car' : c.backoff > 0 ? 'backing off' : behind ? 'caught up' : 'person') : '';
        c.pw = walker >= 0 && c.v < 0.6 ? (c.pw || 0) + dt : walker >= 0 ? c.pw : 0;
        if (c.pw > 3 && c.pw - dt <= 3 && crowd) crowd.P[walker].give = true;
        if (c.pw > 12) c.pw = 0;
        q.setFromAxisAngle(up, Math.PI - c.h);
        m4.compose(W(c.x, c.y, c.z), q, one);
        place(i, c);
      }
      // and a walker it has come up against (a corner taken, edging up to one who stands in the road),
      // or who has stepped up against it where it stands: a step out of its way, along the footway and across it, if that is not into a wall
      if (crowd) for (let i = 0; i < api.active; i++) {
        const c = C[i];
        if (c.line < 0) continue;
        const R = c.half + 0.5, a0 = Math.floor((c.x - R) / CELL), a1 = Math.floor((c.x + R) / CELL), b0 = Math.floor((c.y - R) / CELL), b1 = Math.floor((c.y + R) / CELL);
        for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let j = bhead[bucket(a, b)]; j >= 0; j = bchain[j]) {
          if (bi[j] < 0 || Math.abs(bz[j] - c.z) >= LEVEL) continue;
          const e = into(c, bx[j], by[j], 0.25), p = crowd.P[bi[j]];
          if (!e || p.state !== 'walk' || p.line < 0) continue;
          const x = bx[j] + e.x * 1.02, y = by[j] + e.y * 1.02;
          if (nav && !nav.walk(x, y, p.z).ok) continue;
          const dx = x - p.x, dy = y - p.y; // (p.line is the crowd's network's, not the roads': past its end, walk() takes it on)
          p.lat += -dx * p.hy + dy * p.hx;
          p.s += p.dir * (dx * p.hx + dy * p.hy);
          p.x = bx[j] = x; p.y = by[j] = y;
        }
      }
      // a car that has come up against the player (turning in, say) moves them out of its way
      if (nav) for (const b of blockers) {
        if (b.half || b.fixed) continue;
        let o = pushOut(b.x, b.y, 0.35, b.z);
        if (o.x !== b.x || o.y !== b.y) {
          if (nav.posts) o = nav.posts.pushOut(o.x, o.y, 0.35, b.z); // (and not into a lamp post or a trunk)
          if (nav.walk(o.x, o.y, b.z).ok) { b.x = o.x; b.y = o.y; }
        }
      }
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
      if (fleet) for (const k in fleet) for (const M of fleet[k]) {
        M.instanceMatrix.needsUpdate = true;
        M.geometry.attributes.aC0.needsUpdate = M.geometry.attributes.aC1.needsUpdate = true;
      }
    }
    return Object.assign(api, { update, take, footprint, stats: () => Object.assign(JN.stats(), { redRuns, redLog, laneChanges, outOfRing, squeezes, conflicts: JN.conflicts() }) });
  }

  // ------------------------------------------------------------ text sprites (names, markers)
  function sprite(text, { bg = 'rgba(18,32,42,0.82)', fg = '#ffffff', size = 44, pad = 16, font = '600 40px "Public Sans", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' } = {}) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + pad * 2;
    c.width = w; c.height = size + pad;
    g.font = font;
    g.fillStyle = bg;
    const r = (size + pad) / 2;
    g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, size + pad); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); g.fill();
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, w / 2, r + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(w / (size + pad) * 0.42, 0.42, 1);
    s.renderOrder = 10;
    return s;
  }

  return { makePerson, network, benches, crowd, traffic, sprite, boxes, lin, rnd, pick, FOOTW };
})();
