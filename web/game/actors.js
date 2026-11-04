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
    function nearest(x, y, maxD, z = null, dz = 3) {
      let best = null;
      for (const i of new Set(near(x, y, 0, maxD))) {
        const l = L[i], n = l.pts.length / 3;
        for (let k = 1; k < n; k++) {
          const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], ex = l.pts[3 * k] - ax, ey = l.pts[3 * k + 1] - ay, L2 = ex * ex + ey * ey;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
          const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(x - qx, y - qy), qz = l.pts[3 * k - 1] + (l.pts[3 * k + 2] - l.pts[3 * k - 1]) * t;
          if (d < maxD && (!best || d < best.d) && (z == null || Math.abs(qz - z) < dz)) best = { line: i, s: l.cum[k - 1] + t * Math.sqrt(L2), x: qx, y: qy, z: qz, d };
        }
      }
      return best;
    }
    // another line meeting line i's end (0 start, 1 end): [line, its end there], not one to avoid;
    // with `legal`, only one a car may drive into from there (not against a one-way street)
    function next(i, end, legal = false) {
      const l = L[i], k = end ? l.pts.length / 3 - 1 : 0, av = api.avoid;
      const opts2 = (nodes.get(key(l.pts[3 * k], l.pts[3 * k + 1])) || []).filter(o => o[0] !== i && !(av && av[o[0]]) && (!legal || L[o[0]].ow !== (o[1] === 0 ? -1 : 1)));
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
    const api = { L, at, near: (x, y, rMin, rMax) => (api.avoid ? near(x, y, rMin, rMax).filter(i => !api.avoid[i]) : near(x, y, rMin, rMax)), nearest, next, only, nodes, key, avoid: null };
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
  const BODY = 0.6;    // two walkers closer than this are in each other's way (m, centre to centre)
  const CLOSE = 0.45;  // a walker never steps closer than this to another (m, centre to centre)
  const KERB = 0.45;   // how far a walker keeps from a car's side or bumper (m, centre to body)
  const POST = 0.25;   // and from a lamp post or a trunk
  const MOVING = 1.2;  // and the seconds of a moving car's path ahead it won't step into
  const NEAR = 60, FAR = 150; // walkers farther than these from the player take a step every 2nd, 4th frame (m)
  // ground(x, y, at): the height to stand at beside the line at `at` (net.at), or null where no one can stand;
  // wall(x, y, z): is that inside a building's wall? posts: the lamp posts and trunks (streets.js), solid;
  // clear(x, y, z): whether someone standing there is clear of the walls (a facade the footway runs along)
  const WALL_LOOK = 1.5; // how far ahead a walker looks for a wall beside its line (m)
  function crowd(world, net, U, n, radius, makeRenderer, { benches: BN = null, ground = null, wall = null, posts: PO = null, clear = null } = {}) {
    const P = [], tmp = {}, ahead = {};
    for (let i = 0; i < n; i++) P.push({ line: -1, s: 0, dir: 1, speed: 1.1 + rnd() * 0.6, phase: rnd() * 6.28, side: 0.6 + rnd() * 1.2, lat: null, dodge: 0, v: 0, vx: 0, vy: 0,
      pause: 0, x: 0, y: 0, z: 0, h: 0, scale: 0.92 + rnd() * 0.16, state: 'walk', mode: 'ground', seat: null, t: 0, rest: rnd() * 30 });
    const R = makeRenderer ? makeRenderer(P) : boxRenderer(world, U, P);
    function release(p) { if (p.seat) { p.seat.by = -1; p.seat = null; } }
    function respawn(p, cx, cy, rMin) {
      release(p);
      p.state = 'walk'; p.mode = 'ground'; p.lat = null; p.side = 0.6 + rnd() * 1.2;
      const cand = net.near(cx, cy, rMin, radius);
      p.line = -1;
      for (let k = 0; k < 4 && cand.length; k++) { // somewhere clear of the cars and benches
        const line = cand[Math.floor(rnd() * cand.length)], s = rnd() * net.L[line].len, dir = rnd() < 0.5 ? 1 : -1;
        net.at(line, s, tmp);
        const x = tmp.x - tmp.hy * dir * p.side, y = tmp.y + tmp.hx * dir * p.side;
        gather(x, y, p, true, tmp.z);
        if (blocked(x, y) > 0 || (wall && wall(x, y, tmp.z))) continue;
        p.line = line; p.s = s; p.dir = dir;
        return;
      }
    }
    const api = { R, P, active: n, benches: BN, cars: null, sitChance: () => 0, crossings: null, kerbWait: 0, kerbWaits: [] };
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
    const addCar = o => { nearCars.push(o); }, addPost = o => { nearPosts.push(o); };
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
      if (ahead > 0) cap = Math.min(cap, Math.max(0, ovx * hx + ovy * hy) + Math.max(0, ahead - rr) * 0.8);
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
      net.at(q.line, Math.max(0, Math.min(net.L[q.line].len, q.s + q.dir * WALL_LOOK)), ahead);
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
      net.at(q.line, q.s, tmp);
      q.back = { x: tmp.x - tmp.hy * q.dir * q.side, y: tmp.y + tmp.hx * q.dir * q.side, z: tmp.z };
    }
    let frame = 0;
    function update(dt, cx, cy, t, player) {
      R.begin(dt, cx, cy, t, api.active);
      frame++;
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
        if (i >= api.active) { R.hide(i); release(p); p.line = -1; continue; }
        if (p.line < 0 || Math.hypot(p.x - cx, p.y - cy) > radius * 1.15) respawn(p, cx, cy, p.line < 0 && t < 1 ? 0 : radius * 0.6);
        if (p.line < 0) { R.hide(i); continue; }
        if (p.pause > 0) p.pause -= dt;
        if (p.state === 'walk') { // farther off, a longer step every few frames does
          const d = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)), k = d < NEAR ? 1 : d < FAR ? 2 : 4;
          if ((frame + i) % k === 0) walk(i, k * dt, player, pvx, pvy);
        }
        else if (p.state === 'sit') {
          p.v = p.vx = p.vy = 0;
          if ((p.t -= dt) <= 0) { release(p); backTo(p); p.state = 'leave'; }
        } else { // to a seat or back to the footway, in a straight line
          const g = p.state === 'approach' ? p.seat : p.back, dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy);
          gather(p.x, p.y, p, (frame + i) % 6 < 2 || !p.cars, p.z);
          // (not into a car pulled up by the bench: wait for it)
          const st = d > 1e-3 && blocked(p.x + dx / d * 0.05, p.y + dy / d * 0.05, false) > blocked(p.x, p.y, false) + 1e-4 ? 0 : Math.min(d, p.speed * 0.8 * dt);
          if (d > 1e-3) { p.x += dx / d * st; p.y += dy / d * st; p.z += (g.z - p.z) * st / d; p.h = Math.atan2(dx, dy); }
          p.v = dt > 0 ? st / dt : 0; p.vx = d > 1e-3 ? dx / d * p.v : 0; p.vy = d > 1e-3 ? dy / d * p.v : 0;
          if (d - st < 0.02) {
            if (p.state === 'approach') { p.state = 'sit'; p.x = g.x; p.y = g.y; p.z = g.z; p.h = g.h; p.t = 25 + rnd() * 50; }
            else { p.state = 'walk'; p.lat = null; p.dodge = 0; p.rest = 40 + rnd() * 60; } // walk() picks up the new direction
          }
        }
        p.mode = p.state === 'sit' ? 'sit' : 'ground';
        R.place(i, p, p.state !== 'sit' && p.v > 0.05);
      }
      R.end();
    }
    function walk(i, dt, player, pvx, pvy) {
      const l = net.L[p.line];
      if (p.lat == null) { // just placed: put it there
        p.lat = p.side; p.v = p.speed; net.at(p.line, p.s, tmp); p.hx = tmp.hx * p.dir; p.hy = tmp.hy * p.dir;
        p.lat = p.lim = wallFree(p, p.limWant = p.side, Math.max(1, (FOOTW[l.c] || 3) / 2)); // (placed out of sight: straight to where there is room)
        p.x = tmp.x - p.hy * p.lat; p.y = tmp.y + p.hx * p.lat; p.z = tmp.z;
        settle(p);
      }
      if (p.give) { // stood in the road in front of a car that has waited on them: turn back, out of its way
        p.give = false;
        if (p.v < 0.3 && p.pause <= 0) { p.dir = -p.dir; p.hx = -p.hx; p.hy = -p.hy; p.wait = p.still = 0; }
      }
      hx = p.hx; hy = p.hy; // the lane's direction where the walker is, from the last step
      push = 0; cap = p.speed; nn = 0;
      const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let j = head[bucket(c0 + a, r0 + b)]; j >= 0; j = chain[j]) if (j !== i) { const o = P[j]; see(o.x, o.y, o.vx, o.vy, BODY, 1); nbr[nn++] = j; }
      }
      if (player) see(player.x, player.y, pvx, pvy, BODY + (player.r || 0.15), 1.6); // give the player a little more room (a car more)
      gather(p.x, p.y, p, (p.steps = (p.steps || 0) + 1) % 2 === 0 || !p.cars, p.z);
      // the benches' two seats: step round them, without slowing (it may be passing to sit down)
      let cap0 = cap;
      for (const bn of nearBenches) for (const st of bn.seats) if (st.by !== i) see(st.x, st.y, 0, 0, 0.5 + BODY / 2, 1);
      for (const o of nearPosts) see(o.x, o.y, 0, 0, o.r + POST + BODY / 2, 1); // and round the posts and trunks
      cap = cap0;
      // a walker caught beside a car (it pulled up, say) steps on out rather than wait for it
      const was = blocked(p.x, p.y);
      cap0 = cap;
      for (const o of nearCars) seeCar(o);
      if (was > 0) cap = cap0;
      // sideways within the footway (a little past its edge for whoever keeps far left), and speed
      const hw = Math.max(1, (FOOTW[l.c] || 3) / 2);
      p.dodge += (Math.max(-1.5, Math.min(1.5, push * 1.2)) - p.dodge) * Math.min(1, dt * 4);
      let want = Math.max(-hw + 0.3, Math.min(Math.max(hw, p.side) + 0.2, p.side + p.dodge));
      // a facade beside the line, here or a little ahead: in towards the line (looked at every few steps)
      if (clear && ((p.wallStep = (p.wallStep || 0) + 1) % 3 === 0 || p.lim == null)) { net.at(p.line, p.s, tmp); p.lim = wallFree(p, want, hw); p.limWant = want; }
      if (clear && p.lim != null && p.lim !== p.limWant) want = p.limWant >= 0 ? Math.min(want, p.lim) : Math.max(want, p.lim); // (no further out on that side)
      const dl = Math.max(-0.9 * dt, Math.min(0.9 * dt, want - p.lat));
      p.lat += dl;
      // a road ahead at a junction with signals, its traffic free to go: up to the kerb, and wait
      // there (the button pressed) for the walk signal; someone already out in the road walks on
      let atKerb = false;
      const X = api.crossings && api.crossings.byLine.get(p.line);
      if (X && !X.some(x => Math.abs(x.s - p.s) < x.kerb - 0.3)) for (const x of X) { // (not while out in a road: over a median, it crosses the other half too)
        const d = (x.s - p.s) * p.dir;
        if (d > x.kerb - 0.4 && d < x.kerb + 3 && !api.crossings.walk(x.a)) { atKerb = true; api.crossings.call(x.a); cap = Math.min(cap, Math.max(0, (d - x.kerb) * 1.5)); }
      }
      if (atKerb && p.v < 0.05) api.kerbWait += dt;
      // each wait at a kerb for the walk, from coming up to it to stepping out (tools/traffic_check.js)
      if (atKerb) p.kw = (p.kw || 0) + dt;
      else if (p.kw) { if (api.kerbWaits.length < 4000) api.kerbWaits.push(p.kw); p.kw = 0; }
      const target = p.pause > 0 ? 0 : Math.min(p.speed, cap);
      p.v = Math.max(0, p.v + Math.max(-3 * dt, Math.min(1.2 * dt, target - p.v)));
      // face to face with someone neither can get round: after a while, turn back
      p.still = p.pause <= 0 && p.v < 0.05 && !atKerb ? (p.still || 0) + dt : 0;
      if (p.still > 4) { p.dir = -p.dir; p.hx = -p.hx; p.hy = -p.hy; p.still = 0; }
      const s0 = p.s, line0 = p.line, dir0 = p.dir;
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
        const nx = net.next(p.line, p.s > l.len ? 1 : 0);
        if (nx && rnd() < 0.9) { p.line = nx[0]; p.dir = nx[1] === 0 ? 1 : -1; p.s = nx[1] === 0 ? 0 : net.L[p.line].len; }
        else { p.dir = -p.dir; p.s = Math.max(0, Math.min(l.len, p.s)); }
      }
      net.at(p.line, p.s, tmp);
      const nhx = tmp.hx * p.dir, nhy = tmp.hy * p.dir;
      // a step into a car, a bench or someone: stay put (whoever is already in one may walk
      // out of it, or along it), and after a while turn back
      const nx1 = tmp.x - nhy * p.lat, ny1 = tmp.y + nhx * p.lat, room1 = closest(nx1, ny1, player);
      if (blocked(nx1, ny1) > was + 1e-4 || (room1 < CLOSE && room1 < closest(p.x, p.y, player))) {
        p.line = line0; p.s = s0; p.dir = dir0; p.lat -= dl; p.v = 0;
        p.vx = p.vy = 0;
        if (was > 0) for (const d of [0.9 * dt, -0.9 * dt]) { // in a car's way and stuck: a step sideways, out
          const x = p.x - p.hy * d, y = p.y + p.hx * d;
          if (blocked(x, y) < was - 1e-4) { p.lat += d; p.x = x; p.y = y; break; }
        }
        if ((p.wait = (p.wait || 0) + dt) > (was > 0 ? 0.3 : 6)) { p.dir = -p.dir; p.hx = -p.hx; p.hy = -p.hy; p.wait = 0; }
        return;
      }
      p.wait = 0;
      hx = p.hx = nhx; hy = p.hy = nhy;
      p.x = tmp.x - hy * p.lat; p.y = tmp.y + hx * p.lat; p.z = tmp.z; // keep left
      settle(p);
      const lr = dt > 0 ? dl / dt : 0;
      p.vx = hx * p.v - hy * lr; p.vy = hy * p.v + hx * lr;
      if (p.face != null) p.h = p.face;
      else if (p.v > 0.05) { const h = Math.atan2(p.vx, p.vy); p.h += Math.atan2(Math.sin(h - p.h), Math.cos(h - p.h)) * Math.min(1, dt * 8); }
    }
    function nearest(x, y, maxD) {
      let best = -1, bd = maxD;
      for (let i = 0; i < n; i++) { const d = Math.hypot(P[i].x - x, P[i].y - y); if (P[i].line >= 0 && d < bd) { bd = d; best = i; } }
      return best;
    }
    return Object.assign(api, { update, nearest });
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
  const STUCK = 20;    // seconds stopped behind a car that won't move (not queueing at a junction) before turning round
  const LEVEL = 3;     // cars and people this far apart in height are on different levels: a deck over a street (m)
  const STEP = 1.5, NPATH = 32; // a car's way ahead, in points this far apart (m), and at most this many
  const pathQ = new Float32Array(2 * (NPATH + 64)), pathNext = [];
  function traffic(world, net, U, n, radius, { lib = null, cfg = {}, eye = null, keep = 'left', ground = null, crowd = null, nav = null, posts = null, junctions = null } = {}) {
    const side = keep === 'right' ? -1 : 1; // the lane is to the left of the centre line, or to the right
    const JN = junctions || OEJunctions.create(net, { keep, lane: LANE, signals: [] });
    const I = lib && lib.cars && lib.info.cars, C = [], tmp = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let mesh = null, fleet = null;
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
      if (o === oc || (o.soft && Math.sin(o.h) * ohx + Math.cos(o.h) * ohy < 0.5)) return; // (a ride on the move, but for one it follows: game.js)
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
    let inWho = -1; // (the walker deepest in it, from the last peopleIn)
    function peopleIn(c, x, y, hx, hy) {
      let d = 0, most = 0;
      inWho = -1;
      if (posts) posts.near(x, y, c.half + 0.3, q => {
        if (Math.abs(q.z - c.z) >= LEVEL) return;
        const dx = q.x - x, dy = q.y - y, ea = c.half + q.r - Math.abs(dx * hx + dy * hy), eb = c.hw + q.r - Math.abs(-dx * hy + dy * hx);
        if (ea > 0 && eb > 0) d += Math.min(ea, eb);
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
        if (JN.inner(line) || L1.len < 15) continue;
        const ahead = dir > 0 ? L1.len - s : s, ar = JN.armAt(line, dir > 0 ? 1 : 0);
        if (ar && ahead < ar.back + 10) continue; // not at a junction's line, or over it
        if (JN.midsOn && (JN.midsOn(line) || []).some(X => Math.abs(X.mid - s) < 30)) continue; // nor at a crossing's
        if (JN.shutNow && JN.shutNow(line, dir)) continue; // nor on a street shut to cars at this hour
        const ln = JN.lanesOf(L1) > 1 && rnd() < 0.5 && !(JN.laneRun && ahead + JN.laneRun(line, dir > 0 ? 1 : 0) < 120) ? 1 : 0, lo = side * JN.shiftOf(L1, ln); // (not in a second lane about to end)
        lanePos(line, s, dir, tmp, lo);
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
      return free >= Math.min(need, JN.reach(e) - 1);
    }
    let redRuns = 0, laneChanges = 0;
    const redLog = []; // (the last few cars over a crossing's line on red, how: tools/traffic_why.js)
    const api = { mesh, fleet, C, active: n, near, pushOut, junctions: JN, netL: net.L, extra: [] };
    if (crowd) crowd.cars = api;
    if (nav) nav.movers = api;
    // a car leaves the traffic (a taxi you hailed): its slot comes back elsewhere, out of sight
    function take(c) { JN.forget(c); c.line = -1; c.v = 0; }
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
    // blockers: the player on foot { x, y, z } and your car or a ride { x, y, half (half length),
    // hw (half width), parked }; a parked one beside the lane is passed by swinging out round it
    let tick = 0;
    const FAR = 160; // cars farther than this from the eye (m, along x and y) take a step every second frame
    function update(dt0, cx, cy, t, blockers) {
      const dt = dt0;
      tick++;
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
          c.ex = arm ? (c.exA && c.exA.a === arm ? c.exA.e : c.ex2 && c.ex2.a === arm ? c.ex2.e : JN.choose(arm)) : null;
          if (c.exA && c.exA.a === arm) c.exA = null;
          if (c.ex2 && c.ex2.a === arm) c.ex2 = null;
          c.plan = c.ex ? c.ex.steps.slice(1) : null;
          c.nx = c.ex ? c.ex.steps[0] : net.next(c.line, end, true);
        }
        const left = c.dir > 0 ? l.len - c.s : c.s, nl = c.nx ? c.nx[0] : -1, nd = c.nx ? (c.nx[1] === 0 ? 1 : -1) : 0;
        let gap = 40, byCar = false, swerve = 0, front = null, why = '', walker = -1;
        // the road ends ahead in nothing (a stub at the map's edge, a dead end): it slows to turn round there
        if (!c.nx && !arm && left + 4 < gap) { gap = left + 4; why = 'end'; }
        // its way ahead: points every STEP metres from its front bumper along its lane, on to the
        // next piece and its way across a junction (as lanePos smooths it round corners)
        const P = c.ps || (c.ps = new Float32Array(2 * NPATH)), Q = pathQ;
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
            Q[2 * nq] = pt[b3 - 3] + (pt[b3] - pt[b3 - 3]) * tt; Q[2 * nq + 1] = pt[b3 - 2] + (pt[b3 + 1] - pt[b3 - 2]) * tt; nq++;
            si += di * step;
          }
          // offset into the lane by the direction over two steps either side; the first point kept is the front bumper
          const k0 = Math.round((Math.abs(c.s - sb) + c.half) / step);
          pk0 = k0; laneAt = lane;
          for (let k = k0; k < nq && np < NPATH; k++) {
            const ka = Math.max(0, k - 2), kb = Math.min(nq - 1, k + 2);
            let hx = Q[2 * kb] - Q[2 * ka], hy = Q[2 * kb + 1] - Q[2 * ka + 1];
            const h = Math.sqrt(hx * hx + hy * hy) || 1; hx /= h; hy /= h; // (sqrt: hypot is slow)
            P[2 * np] = Q[2 * k] - hy * lane; P[2 * np + 1] = Q[2 * k + 1] + hx * lane; np++;
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
        // in a junction and stopped behind a car waiting at another of its lines (an awkward corner,
        // a short arm whose line can't be set back far enough): that one backs off a little, and
        // after 8 s the car goes on as if it weren't there, to squeeze past it as cars caught up do
        const atLine2 = front && c.mv && !front.mv && front.lineArm && front.lineArm.j === c.mv.j && front.v < 0.3 && front.toLine - front.half < 4;
        if (atLine2 && c.v < 0.3) {
          if (!(front.backoff > 0)) front.backoff = 1.5;
          c.waitOn = c.waitOnCar === front ? (c.waitOn || 0) + dt : 0; c.waitOnCar = front;
          if (c.waitOn > 8) { c.passBy = front; c.waitOn = 0; }
        } else if (!front || front !== c.waitOnCar) { c.waitOn = 0; c.waitOnCar = null; }
        if (c.passBy && (!c.mv || Math.hypot(c.passBy.x - c.x, c.passBy.y - c.y) > c.half + c.passBy.half + 4)) c.passBy = null;
        // your car and a ride: one parked beside the lane is passed side by side with a hand's width
        // between, or round it: a short swing out towards the kerb, or out over the centre line round
        // one left in the lane, as traffic goes round a stopped car; otherwise braked for like a car ahead
        let youQ = false; // (the one braked for is a ride queueing for a junction: this car queues behind it)
        for (const b of blockers) {
          if (!b.half || (b.z != null && Math.abs(b.z - c.z) >= LEVEL)) continue;
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
            const atJ = arm && left - arm.back < a + b.half + 15;
            const toKerb = w0 + side * need, toCentre = w0 - side * need; // (the kerb is on the keep side)
            const sw = Math.abs(toKerb) < 1.6 && Math.abs(toKerb) < Math.abs(toCentre) ? toKerb : Math.abs(toCentre) < 2.6 ? toCentre : null;
            if (sw != null && !atJ) { if (Math.abs(sw) > Math.abs(swerve)) swerve = sw; continue; }
          }
          if (a > 0 && Math.abs(w) < Math.max(1.6, c.hw + (b.hw || 0.9) + 0.2) && a - b.half - c.half < gap) { gap = a - b.half - c.half; byCar = true; front = null; why = 'you'; youQ = !!b.q && b.qBy !== c; } // (a ride pulling in still reaches into the lane)
        }
        // a lamp post or a trunk in the way (at a corner taken wide): braked for like a car stopped there
        if (posts) posts.near(c.x + fx * reach / 2, c.y + fy * reach / 2, reach / 2 + 1, q => {
          if (Math.abs(q.z - c.z) >= LEVEL) return;
          const dx = q.x - c.x, dy = q.y - c.y, a = dx * fx + dy * fy;
          if (a + q.r < c.half || a > reach || Math.abs(-dx * fy + dy * fx) >= c.hw + q.r + 0.1) return;
          const g = a - q.r - c.half;
          if (g < gap) { gap = g; byCar = true; front = null; why = 'post'; }
        });
        // (a facade beside its lane: in from it, below, until its back has passed the place: c.narrow is the
        // metres to go, not a time, so a car that stops beside a facade stays in from it however long it waits)
        // (and only once it is close to the place: one waiting short of a narrow stretch for a car coming the
        // other way through it keeps to its lane, out of that car's way)
        if (c.narrow > 0) {
          c.narrow -= c.v * dt; c.narrowIn = Math.max(0, (c.narrowIn ?? 0) - c.v * dt);
          if (c.narrow <= 0) { c.wallT = 0; c.narrowIn = Infinity; }
          if (!swerve && c.narrowIn < 6 + c.v) swerve = -LANE * side * (c.narrowF || 0);
        } else { c.narrowF = 0; c.narrowIn = Infinity; }
        c.off += (swerve - c.off) * Math.min(1, dt * (c.narrow > 0 && Math.abs(swerve) > Math.abs(c.off) ? 3.5 : 1.6)); // (in from a facade the sooner)
        // the junction ahead: in time to stop at its line, the light, a stop sign, the way across
        // and the room beyond it; then in, or wait at the line (the longest waiting goes first)
        let atLine = false;
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
            if (!c.exA || c.exA.a !== a2) c.exA = { a: a2, e: JN.choose(a2) };
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
            }
          }
          const lt = JN.light(jArm, jEx), stop = c.v * c.v / 8 < toLine - c.half - 0.3; // (can stop by the line, at 4 m/s²)
          if (c.mv && c.mv.a === jArm && lt !== 'g' && lt != null && stop) { JN.release(c); c.rel = 'lights'; } // the lights changed before it got there
          if (!c.mv || c.mv.a !== jArm) {
            JN.approach(c, jArm, JN.mv(c, jEx), Math.max(0, toLine - c.half) / Math.max(c.v, 2));
            if (toLine < c.half + 4 + c.v * c.v / 6) {
              let go = lt == null || lt === 'g' || (lt === 'y' && !stop);
              if (toLine - c.half < -1) { c.overWhy = `${c.rel || ''} ${c.why} v ${c.v.toFixed(1)} toLine ${(toLine - c.half).toFixed(1)} lane ${c.ln} lo ${c.lo.toFixed(1)} lt ${lt}`; JN.enter(c, jArm, jEx, t, true); c.mv.via = [c.line]; go = false; } // already over the line: in the junction, so through it
              if (go && jArm.sign === 'stop' && !c.halt) go = false;
              if (go && !room(c, jEx)) go = false;
              const inLane = jEx.lanes.includes(c.ln || 0) && Math.abs(c.lo - side * JN.shiftOf(l, c.ln)) < 0.3; // (in a lane its movement can't go from, or still moving across: it waits)
              if (!inLane) go = false;
              // a junction just after, too close to wait between: crossed with this one, its way chosen now
              const a2 = go ? JN.after(jEx, 2 * c.half + 3) : null;
              if (a2) {
                if (!c.ex2 || c.ex2.a !== a2) c.ex2 = { a: a2, e: JN.choose(a2) };
                const lt2 = JN.light(a2, c.ex2.e);
                if (!c.ex2.e || !(lt2 == null || lt2 === 'g') || a2.sign === 'stop' || !room(c, c.ex2.e)) go = false;
              }
              const r = c.mv && c.mv.a === jArm ? true : go ? JN.request(c, jArm, jEx, t, a2, a2 && c.ex2.e) : false;
              if (r === true && go) { // the pieces it may still be on before each junction's arm
                if (a2) { c.mv0.via = [c.line]; c.mv.via = [c.line].concat(jEx.steps.map(st => st[0])); } else c.mv.via = [c.line];
              }
              if (r !== true) {
                const g = toLine - c.half + 2.4;
                if (g < gap) { gap = g; byCar = false; atLine = true; front = null; why = r || (lt === 'r' || lt === 'y' ? 'light' : jArm.sign === 'stop' && !c.halt ? 'stop' : !inLane ? 'lane' : 'room'); }
                if (toLine - c.half < 2.5 && c.v < 0.6) {
                  if (jArm.sign === 'stop') c.halt = true;
                  if (r) { JN.wait(c, jArm, jEx, t); c.wj = jArm.j; } // its turn comes: it waits for the way across, not for a light or room
                }
              }
            }
          }
          c.toLine = toLine; c.lineArm = jArm; c.lineEx = jEx;
        } else c.lineArm = null;
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
            const deck = c.z > nav.terrain(c.x, c.y) + 2;
            let nF = 0, nEnd = 0, nIn = Infinity; // (how far in from its lane it needs to be on the 25 m ahead, for how far, and from where)
            for (let k = 0; k < np; k++) {
              if (nav.room(P[2 * k], P[2 * k + 1], c.z, c.hw * 0.8, 1.4, deck)) continue;
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
                  if (nav.room(qx + ux * at, qy + uy * at, c.z, c.hw * 0.8, 1.4, deck)) { f = F; break; }
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
          c.atWall = why === 'wall' && c.v < 0.1 ? (c.atWall || 0) + dt : 0;
          if (c.atWall > 1.5) {
            c.atWall = 0; c.wallT = 0;
            if (far) { respawn(c, cx, cy, radius * 0.6); continue; }
            c.stuck = STUCK + 1; // (turned round below, as from a jam; on a one-way street it waits to be out of sight)
          }
        }
        c.q = atLine || (byCar && c.v < 0.5 && (front != null ? !!front.q : why === 'you' && youQ)); // queueing at a junction (behind a car, or a ride, queueing there)
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
        const want = tangled > 0 && !behind ? 1.5 : gap < 2.6 ? 0 : Math.min(l.v, (gap - 2.6) * 0.9, Math.sqrt(7 * (gap - 2.6)) + 0.5);
        c.v += Math.max(-8 * dt, Math.min(3 * dt, want - c.v));
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
        if (c.lineArm && c.toLine > 0 && c.toLine - c.v * dt <= 0 && JN.light(c.lineArm, c.lineEx) === 'r' && c.lineArm.j.st === 'g' && !(c.mv && c.mv.a === c.lineArm)) redRuns++;
        const onto = line !== c.line, nx2 = c.plan && c.plan.length ? [c.plan[0][0], c.plan[0][1] === 0 ? 1 : -1] : null;
        // (across to its lane a little at a time, slowly while it is barely moving, nosing that way)
        // (in a junction it keeps the lane it went in by: its way across is that lane's)
        const back = line === c.line && dir !== c.dir, keepIt = c.mv && !back, lnNow = keepIt ? c.ln : !back && JN.lanesOf(net.L[line]) > 1 ? c.ln : 0, loT = side * JN.shiftOf(net.L[line], lnNow);
        const rate = Math.min(1.3, 0.4 + 0.15 * c.v) * dt, lo1 = back ? 0 : keepIt ? c.lo : c.lo + Math.max(-rate, Math.min(rate, loT - c.lo));
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
        if (held && holder && c.mv && !holder.mv && holder.v < 0.3 && holder.toLine != null && holder.toLine - holder.half < 4) holder.backoff = 1.5;
        // held a long time all the same by one that isn't moving either (an awkward corner, two
        // stopped nose to nose): it squeezes past, in a junction sooner; and by one that only
        // inches along, caught up with it (the time counts on while it is held by one that moves)
        c.inHeld = held ? (c.inHeld || 0) + dt : 0;
        // (and in a junction, caught up behind one for 10 s: it squeezes past that one too)
        c.behindT = behind && !turn ? (c.behindT || 0) + dt : 0;
        const squeeze = c.inHeld > (holder && holder.v >= 0.3 ? 25 : c.mv ? 10 : 15) || (c.mv && c.behindT > 10);
        if (squeeze) held = false;
        if (!held && (turn || moves)) {
          const d1 = peopleIn(c, tmp.x, tmp.y, hx1, hy1), who = inWho;
          held = d1 > (c.pw > 5 ? (turn ? 1.2 : 0.35) : 0.02) && d1 > peopleIn(c, c.x, c.y, hx0, hy0) + 1e-3;
          if (held && who >= 0) walker = who; // (a walker against it: asked to turn back, below, if it waits on them)
        }
        if (behind && !turn && !squeeze) held = true;
        if (c.backoff > 0) { // backing off for a car that can't get past, a metre or two, if the way behind is clear
          c.backoff -= dt; c.v = 0;
          const sb = Math.max(0, Math.min(l.len, c.s - c.dir * 1.2 * dt));
          lanePos(c.line, sb, c.dir, tmp, c.off + c.lo, c.pv, c.nx ? [nl, nd] : null);
          if (overlaps(c, tmp.x - hx0 * 0.6, tmp.y - hy0 * 0.6, hx0, hy0, 0.3, 0.1) === 0 && peopleIn(c, tmp.x, tmp.y, hx0, hy0) === 0) { c.s = sb; c.x = tmp.x; c.y = tmp.y; onGround(c, tmp); }
          held = true;
        }
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
          if (!turn && !squeeze) {
            const kn = free ? caught : null, d1 = overlaps(c, c.x, c.y, Math.sin(c.h), Math.cos(c.h), 0, 0, null, kn), f1 = free ? fresh : d1;
            if (f1 > 0 && f1 > (overlaps(c, was[3], was[4], Math.sin(was[6]), Math.cos(was[6]), 0, 0, null, kn), free ? fresh : depth) + 1e-3) {
              [c.line, c.s, c.dir, c.x, c.y, c.z, c.h] = was;
              [c.lo, c.ln] = wasLane;
              c.v = 0;
            }
          }
        }
        c.stuck = c.v < 0.1 && (byCar || held) && !c.q ? c.stuck + dt : 0;
        c.zebraT = why === 'zebra' && c.v < 0.3 ? (c.zebraT || 0) + dt : 0;
        if (c.zebraT > 15) { c.zebraT = 0; c.zebraOff = 6; }
        c.why = held ? 'held' : why; c.front = held ? holder : front; c.who = walker; c.heldBy = held ? (holder ? 'car' : c.backoff > 0 ? 'backing off' : behind ? 'caught up' : 'person') : '';
        c.pw = walker >= 0 && c.v < 0.6 ? (c.pw || 0) + dt : walker >= 0 ? c.pw : 0;
        if (c.pw > 3 && c.pw - dt <= 3 && crowd) crowd.P[walker].give = true;
        if (c.pw > 12) c.pw = 0;
        q.setFromAxisAngle(up, Math.PI - c.h);
        m4.compose(W(c.x, c.y, c.z), q, one);
        place(i, c);
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
    return Object.assign(api, { update, take, footprint, stats: () => Object.assign(JN.stats(), { redRuns, redLog, laneChanges, conflicts: JN.conflicts() }) });
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
