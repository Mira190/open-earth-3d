// People and cars. Pedestrians walk the city's footways (keeping left, as Australians
// do), step aside for each other and for the player, and stop to sit on benches. Cars
// drive the roads on the left, at the speed limit Overture gives or a default for the
// road class. Cars are instanced meshes, a handful of draw calls for
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
    if (cars) mat.defines = Object.assign({}, mat.defines, { TONE_CARS: '' });
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
vEmit = tone > 5.5 && tone < 7.5 ? (tone < 6.5 ? 1.0 : 0.7) : tone > 11.5 && tone < 12.5 ? 0.6 : 0.0;
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
    const L = lines.map(o => {
      const p = o.p || o, n = p.length / 3, pts = new Float32Array(n * 3), cum = new Float32Array(n);
      for (let i = 0; i < n; i++) { pts[3 * i] = p[3 * i] / 10; pts[3 * i + 1] = p[3 * i + 1] / 10; pts[3 * i + 2] = p[3 * i + 2] / 10; }
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2]);
      return { pts, cum, len: cum[n - 1], v: o.v || 0, c: o.c || '' };
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
      while (k < n - 1 && l.cum[k] < s) k++;
      const t = (s - l.cum[k - 1]) / Math.max(1e-6, l.cum[k] - l.cum[k - 1]);
      const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], az = l.pts[3 * k - 1], bx = l.pts[3 * k], by = l.pts[3 * k + 1], bz = l.pts[3 * k + 2];
      out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t; out.z = az + (bz - az) * t;
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
    // the closest point on any line within maxD of (x, y): {line, s, x, y, z, d} or null
    function nearest(x, y, maxD) {
      let best = null;
      for (const i of new Set(near(x, y, 0, maxD))) {
        const l = L[i], n = l.pts.length / 3;
        for (let k = 1; k < n; k++) {
          const ax = l.pts[3 * k - 3], ay = l.pts[3 * k - 2], ex = l.pts[3 * k] - ax, ey = l.pts[3 * k + 1] - ay, L2 = ex * ex + ey * ey;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
          const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(x - qx, y - qy);
          if (d < maxD && (!best || d < best.d)) best = { line: i, s: l.cum[k - 1] + t * Math.sqrt(L2), x: qx, y: qy, z: l.pts[3 * k - 1] + (l.pts[3 * k + 2] - l.pts[3 * k - 1]) * t, d };
        }
      }
      return best;
    }
    function next(i, end) { // another line meeting line i's end (0 start, 1 end)
      const l = L[i], k = end ? l.pts.length / 3 - 1 : 0;
      const opts2 = (nodes.get(key(l.pts[3 * k], l.pts[3 * k + 1])) || []).filter(o => o[0] !== i);
      return opts2.length ? opts2[Math.floor(rnd() * opts2.length)] : null;
    }
    return { L, at, near, nearest, next };
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
  const HORIZON = 4;   // seconds of look-ahead
  const BODY = 0.6;    // two walkers closer than this are in each other's way (m, centre to centre)
  const CLOSE = 0.45;  // a walker never steps closer than this to another (m, centre to centre)
  const KERB = 0.45;   // how far a walker keeps from a car's side or bumper (m, centre to body)
  const MOVING = 1.2;  // and the seconds of a moving car's path ahead it won't step into
  const NEAR = 60, FAR = 150; // walkers farther than these from the player take a step every 2nd, 4th frame (m)
  function crowd(world, net, U, n, radius, makeRenderer, { benches: BN = null } = {}) {
    const P = [], tmp = {};
    for (let i = 0; i < n; i++) P.push({ line: -1, s: 0, dir: 1, speed: 1.1 + rnd() * 0.6, phase: rnd() * 6.28, side: 0.6 + rnd() * 1.2, lat: null, dodge: 0, v: 0, vx: 0, vy: 0,
      pause: 0, x: 0, y: 0, z: 0, h: 0, scale: 0.92 + rnd() * 0.16, state: 'walk', mode: 'ground', seat: null, t: 0, rest: rnd() * 30 });
    const R = makeRenderer ? makeRenderer(P) : boxRenderer(world, U, P);
    function release(p) { if (p.seat) { p.seat.by = -1; p.seat = null; } }
    function respawn(p, cx, cy, rMin) {
      release(p);
      p.state = 'walk'; p.mode = 'ground'; p.lat = null;
      const cand = net.near(cx, cy, rMin, radius);
      p.line = -1;
      for (let k = 0; k < 4 && cand.length; k++) { // somewhere clear of the cars and benches
        const line = cand[Math.floor(rnd() * cand.length)], s = rnd() * net.L[line].len, dir = rnd() < 0.5 ? 1 : -1;
        net.at(line, s, tmp);
        const x = tmp.x - tmp.hy * dir * p.side, y = tmp.y + tmp.hx * dir * p.side;
        gather(x, y, p, true);
        if (blocked(x, y) > 0) continue;
        p.line = line; p.s = s; p.dir = dir;
        return;
      }
    }
    const api = { R, P, active: n, benches: BN, cars: null, sitChance: () => 0 };
    // the benches as obstacles: for each 4 m cell, those in it and the cells round it
    const benchAt = new Map(), bkey = (cx, cy) => (cx + 8192) * 16384 + cy + 8192; // a small integer key, for speed
    if (BN) for (const b of BN.list) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const k = bkey(Math.floor(b.x / 4) + a, Math.floor(b.y / 4) + c);
      if (!benchAt.has(k)) benchAt.set(k, []);
      benchAt.get(k).push(b);
    }
    // the cars and benches near a walker: the benches each step, the cars every third (a
    // little farther out; where they are is read as they move)
    const none = [];
    let nearBenches = none, nearCars = none;
    const addCar = o => { nearCars.push(o); };
    function gather(x, y, q, fresh) {
      nearBenches = benchAt.size ? benchAt.get(bkey(Math.floor(x / 4), Math.floor(y / 4))) || none : none;
      nearCars = q.cars || (q.cars = []);
      if (!fresh) return;
      nearCars.length = 0;
      if (api.cars) api.cars.near(x, y, 10, addCar);
    }
    // how deep (x, y) is in those benches and in those cars' footprints and the paths the
    // moving ones are about to take, each grown by the room a walker keeps: 0 when clear
    function blocked(x, y, benches = true) {
      let deep = 0;
      if (benches) for (const bn of nearBenches) {
        const fx = Math.sin(bn.h), fy = Math.cos(bn.h), dx = x - bn.x, dy = y - bn.y;
        const ea = 0.22 + 0.25 - Math.abs(dx * fx + dy * fy), eb = 0.85 + 0.25 - Math.abs(-dx * fy + dy * fx);
        if (ea > 0 && eb > 0) deep += Math.min(ea, eb);
      }
      for (const o of nearCars) {
        const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, a = dx * fx + dy * fy;
        const ea = Math.min(a + o.half + KERB, o.half + KERB + o.v * MOVING - a), eb = o.halfW + KERB - Math.abs(-dx * fy + dy * fx);
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
      let best = player ? Math.min(CLOSE, Math.hypot(player.x - x, player.y - y) - 0.15) : CLOSE;
      for (let k = 0; k < nn; k++) { const o = P[nbr[k]], dx = o.x - x, dy = o.y - y; if (Math.abs(dx) < best && Math.abs(dy) < best) best = Math.min(best, Math.hypot(dx, dy)); }
      return best;
    }
    function seeCar(o) { // a row of discs along the car, each as wide as the car
      const fx = Math.sin(o.h), fy = Math.cos(o.h), k = Math.max(1, Math.round(o.half / o.halfW)), r = o.halfW + KERB;
      for (let j = 0; j < k; j++) {
        const u = k === 1 ? 0 : -o.half + o.halfW + (2 * o.half - 2 * o.halfW) * j / (k - 1);
        see(o.x + fx * u, o.y + fy * u, fx * o.v, fy * o.v, r, 1.4);
      }
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
          gather(p.x, p.y, p, (frame + i) % 6 < 2 || !p.cars);
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
        p.x = tmp.x - p.hy * p.lat; p.y = tmp.y + p.hx * p.lat; p.z = tmp.z;
      }
      hx = p.hx; hy = p.hy; // the lane's direction where the walker is, from the last step
      push = 0; cap = p.speed; nn = 0;
      const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let j = head[bucket(c0 + a, r0 + b)]; j >= 0; j = chain[j]) if (j !== i) { const o = P[j]; see(o.x, o.y, o.vx, o.vy, BODY, 1); nbr[nn++] = j; }
      }
      if (player) see(player.x, player.y, pvx, pvy, BODY + 0.15, 1.6); // give the player a little more room
      gather(p.x, p.y, p, (p.steps = (p.steps || 0) + 1) % 2 === 0 || !p.cars);
      // the benches' two seats: step round them, without slowing (it may be passing to sit down)
      let cap0 = cap;
      for (const bn of nearBenches) for (const st of bn.seats) if (st.by !== i) see(st.x, st.y, 0, 0, 0.5 + BODY / 2, 1);
      cap = cap0;
      // a walker caught beside a car (it pulled up, say) steps on out rather than wait for it
      const was = blocked(p.x, p.y);
      cap0 = cap;
      for (const o of nearCars) seeCar(o);
      if (was > 0) cap = cap0;
      // sideways within the footway (a little past its edge for whoever keeps far left), and speed
      const hw = Math.max(1, (FOOTW[l.c] || 3) / 2);
      p.dodge += (Math.max(-1.5, Math.min(1.5, push * 1.2)) - p.dodge) * Math.min(1, dt * 4);
      const want = Math.max(-hw + 0.3, Math.min(Math.max(hw, p.side) + 0.2, p.side + p.dodge));
      const dl = Math.max(-0.9 * dt, Math.min(0.9 * dt, want - p.lat));
      p.lat += dl;
      const target = p.pause > 0 ? 0 : Math.min(p.speed, cap);
      p.v = Math.max(0, p.v + Math.max(-3 * dt, Math.min(1.2 * dt, target - p.v)));
      // face to face with someone neither can get round: after a while, turn back
      p.still = p.pause <= 0 && p.v < 0.05 ? (p.still || 0) + dt : 0;
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

  // ------------------------------------------------------------ traffic (drives on the left)
  // With the shared Blender cars (opts.lib from OEVehicles.load) each slot drives one model
  // (sedans, hatches, SUVs, vans, the city's taxis and buses), drawn near, mid or far by
  // distance from opts.eye; without them, one box car for all.
  // Every car is a rectangle on the ground (`half` its length, `halfW` its width, halved).
  // It brakes for whatever is in its path: another car whose footprint reaches into its lane
  // (where two paths cross, the one farther from the crossing gives way), the player and the
  // walkers of opts.crowd. Junctions are taken one car at a time: a car claims the node it is
  // coming up to, or waits short of it, and gives it up once clear of it on the other side.
  // And it never moves into another car or a person: it waits, and turns round if a jam
  // won't clear. The crowd keeps out of the cars' footprints (cars.near), and opts.nav stops
  // the player walking into one (nav.movers).
  const LANE = 1.7;    // a lane's centre, left of the road's line (m)
  const JUNCTION = 5;  // a junction's box: this far round the node where roads meet (m)
  const STUCK = 10;    // seconds stopped behind a car that won't move before turning round
  function traffic(world, net, U, n, radius, { lib = null, cfg = {}, eye = null, crowd = null, nav = null } = {}) {
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
        const M = I.models[k], box = geos[k][0].boundingBox;
        C.push({ line: -1, s: 0, dir: 1, v: 0, x: 0, y: 0, z: 0, h: 0, model: k, half: (box.max.z - box.min.z) / 2, halfW: (box.max.x - box.min.x) / 2, stuck: 0, held: [],
          c0: lin(M.taxi ? pick(taxi.colours) : M.bus ? bus.colour : pick(colours)), c1: lin(M.bus ? bus.band : taxi.band || '#1c1d1f') });
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
        setC(mesh.geometry.attributes.aC0, i, pick(CARS));
        C.push({ line: -1, s: 0, dir: 1, v: 0, x: 0, y: 0, z: 0, h: 0, half: 2.2, halfW: 0.98, stuck: 0, held: [] });
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
    // where a car on line `line` at s, driving dir, sits: its lane, left of the line
    function lanePos(line, s, dir, out) {
      net.at(line, s, out);
      out.hx *= dir; out.hy *= dir;
      out.x -= out.hy * LANE; out.y += out.hx * LANE;
      return out;
    }
    // is (x, y) clear of every other car by d (centre to centre)?
    function clear(x, y, d, self) {
      for (let j = 0; j < api.active; j++) { const o = C[j]; if (o !== self && o.line >= 0 && Math.abs(o.x - x) < d && Math.abs(o.y - y) < d && Math.hypot(o.x - x, o.y - y) < d) return false; }
      return true;
    }
    // how deep car c, at (x, y) heading (hx, hy), would be in other cars' footprints grown
    // by a margin (along, across): 0 when clear
    // (and `ahead`: is the deepest of them ahead of it?)
    let depth = 0, most = 0, ahead = false, oc = null, ox0 = 0, oy0 = 0, ohx = 0, ohy = 0, mL = 0, mW = 0;
    const overlapTest = o => {
      if (o === oc) return;
      const dx = o.x - ox0, dy = o.y - oy0, ox = Math.sin(o.h), oy = Math.cos(o.h), cs = Math.abs(ox * ohx + oy * ohy), sn = Math.abs(-ox * ohy + oy * ohx);
      const ea = oc.half + cs * o.half + sn * o.halfW + mL - Math.abs(dx * ohx + dy * ohy), eb = oc.halfW + sn * o.half + cs * o.halfW + mW - Math.abs(-dx * ohy + dy * ohx);
      if (ea > 0 && eb > 0) { const d = Math.min(ea, eb); depth += d; if (d > most) { most = d; ahead = dx * ohx + dy * ohy > 0; } }
    };
    function overlaps(c, x, y, hx, hy, ml = 0.5, mw = 0.2) {
      depth = most = 0; ahead = false; oc = c; ox0 = x; oy0 = y; ohx = hx; ohy = hy; mL = ml; mW = mw;
      near(x, y, c.half + 1, overlapTest);
      return depth;
    }
    // and how deep the people (the player, the crowd) would be in it
    function peopleIn(c, x, y, hx, hy) {
      let d = 0;
      const c0 = Math.floor((x - c.half - 1) / CELL), c1 = Math.floor((x + c.half + 1) / CELL), r0 = Math.floor((y - c.half - 1) / CELL), r1 = Math.floor((y + c.half + 1) / CELL);
      for (let a = c0; a <= c1; a++) for (let b = r0; b <= r1; b++) {
        for (let j = bhead[bucket(a, b)]; j >= 0; j = bchain[j]) {
          const dx = bx[j] - x, dy = by[j] - y, ea = c.half + br[j] - Math.abs(dx * hx + dy * hy), eb = c.halfW + br[j] - Math.abs(-dx * hy + dy * hx);
          if (ea > 0 && eb > 0) d += Math.min(ea, eb);
        }
      }
      return d;
    }
    function respawn(c, cx, cy, rMin) {
      const cand = net.near(cx, cy, rMin, radius);
      releaseAll(c);
      c.line = -1;
      for (let k = 0; k < 4 && cand.length; k++) { // somewhere no other car is
        const line = cand[Math.floor(rnd() * cand.length)], s = rnd() * net.L[line].len, dir = rnd() < 0.5 ? 1 : -1;
        lanePos(line, s, dir, tmp);
        if (!clear(tmp.x, tmp.y, 12, c) || peopleIn(c, tmp.x, tmp.y, tmp.hx, tmp.hy) > 0) continue;
        c.line = line; c.s = s; c.dir = dir; c.v = net.L[line].v * 0.7; c.stuck = 0; c.nx = undefined;
        c.x = tmp.x; c.y = tmp.y; c.z = tmp.z; c.h = Math.atan2(tmp.hx, tmp.hy);
        return;
      }
    }
    // a spatial hash of 16 m cells over the cars (rebuilt each frame) and over what they brake for
    const CELL = 16, NB = 1024, head = new Int32Array(NB), chain = new Int32Array(n), bhead = new Int32Array(NB);
    let bchain = new Int32Array(1024), bx = new Float32Array(1024), by = new Float32Array(1024), br = new Float32Array(1024), nb = 0;
    const bucket = (cx, cy) => ((cx * 73856093) ^ (cy * 19349663)) & (NB - 1);
    head.fill(-1); bhead.fill(-1);
    function addBlocker(x, y, r) {
      if (nb === bx.length) { const g = a => { const b = new a.constructor(a.length * 2); b.set(a); return b; }; bx = g(bx); by = g(by); br = g(br); bchain = g(bchain); }
      bx[nb] = x; by[nb] = y; br[nb] = r;
      const k = bucket(Math.floor(x / CELL), Math.floor(y / CELL));
      bchain[nb] = bhead[k]; bhead[k] = nb++;
    }
    // call fn(car) for every car with its centre within about r of (x, y)
    function near(x, y, r, fn) {
      const R = r + 7; // the longest car's centre is this far from its farthest corner
      const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL), r0 = Math.floor((y - R) / CELL), r1 = Math.floor((y + R) / CELL);
      for (let a = c0; a <= c1; a++) for (let b = r0; b <= r1; b++) {
        for (let j = head[bucket(a, b)]; j >= 0; j = chain[j]) { const o = C[j]; if (o.line >= 0 && Math.abs(o.x - x) <= r + o.half && Math.abs(o.y - y) <= r + o.half) fn(o); }
      }
    }
    // how far (x, y) is inside car o's footprint grown by m: the way out, or null when it isn't
    function into(o, x, y, m) {
      const fx = Math.sin(o.h), fy = Math.cos(o.h), dx = x - o.x, dy = y - o.y, a = dx * fx + dy * fy, b = -dx * fy + dy * fx;
      const ea = o.half + m - Math.abs(a), eb = o.halfW + m - Math.abs(b);
      if (ea <= 0 || eb <= 0) return null;
      return ea < eb ? { x: fx * Math.sign(a || 1) * ea, y: fy * Math.sign(a || 1) * ea } : { x: -fy * Math.sign(b || 1) * eb, y: fx * Math.sign(b || 1) * eb };
    }
    // (x, y) moved out of every car's footprint grown by r
    function pushOut(x, y, r) {
      for (let it = 0; it < 3; it++) {
        let moved = false;
        near(x, y, r + 1, o => { const e = into(o, x, y, r); if (e) { x += e.x * 1.01; y += e.y * 1.01; moved = true; } });
        if (!moved) break;
      }
      return { x, y };
    }
    // junctions: the node at either end of each line, and which car holds it
    // (a junction drawn as several nodes a few metres apart counts as one: a node is taken
    // while another car holds one within JUNCTION * 2 of it)
    const holds = new Set();
    function claim(c, line, end, left) { // car c, `left` metres short of the node: does it get it?
      const l = net.L[line], j = end ? l.pts.length / 3 - 1 : 0, x = l.pts[3 * j], y = l.pts[3 * j + 1];
      for (const h of holds) if (h.car !== c && Math.abs(h.x - x) < JUNCTION * 2 && Math.abs(h.y - y) < JUNCTION * 2) return false;
      for (const h of c.held) if (h.x === x && h.y === y) return true;
      const h = { car: c, x, y, d: -left }; // d: how far past the node it has gone
      holds.add(h); c.held.push(h);
      return true;
    }
    function releaseAll(c) {
      for (const h of c.held) holds.delete(h);
      c.held = [];
    }
    const api = { mesh, fleet, C, active: n, near, pushOut };
    if (crowd) crowd.cars = api;
    if (nav) nav.movers = api;
    function update(dt, cx, cy, t, blockers) {
      if (fleet) for (const k in fleet) for (const M of fleet[k]) M.count = 0;
      head.fill(-1); bhead.fill(-1); nb = 0;
      for (let i = 0; i < api.active; i++) {
        const c = C[i];
        if (c.line < 0) continue;
        const k = bucket(Math.floor(c.x / CELL), Math.floor(c.y / CELL));
        chain[i] = head[k]; head[k] = i;
      }
      for (const b of blockers) addBlocker(b.x, b.y, 0.4);
      if (crowd) for (let i = 0; i < crowd.active; i++) { const p = crowd.P[i]; if (p.line >= 0) addBlocker(p.x, p.y, 0.3); }
      for (let i = 0; i < n; i++) {
        const c = C[i];
        if (i >= api.active) { if (c.line >= 0) releaseAll(c); c.line = -1; if (mesh) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } continue; }
        if (c.line < 0 || Math.hypot(c.x - cx, c.y - cy) > radius * 1.15) respawn(c, cx, cy, c.line < 0 && t < 1 ? 0 : radius * 0.6);
        if (c.line < 0) { if (mesh) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } continue; }
        const l = net.L[c.line];
        // brake for anything in the lane ahead: other cars, the player, pedestrians in the road;
        // the gap is bumper to bumper, so a bus keeps its length back
        const fx = Math.sin(c.h), fy = Math.cos(c.h), reach = Math.min(40, l.v / 0.9 + 4 + c.half);
        // which road it takes at the end of this one, chosen in time to look along it
        if (c.nx === undefined) c.nx = net.next(c.line, c.dir > 0 ? 1 : 0);
        const left = c.dir > 0 ? l.len - c.s : c.s, nl = c.nx ? c.nx[0] : -1, nd = c.nx ? (c.nx[1] === 0 ? 1 : -1) : 0;
        let gap = 40, byCar = false;
        const g0 = Math.floor((c.x + fx * reach / 2 - reach / 2) / CELL), g1 = Math.floor((c.x + fx * reach / 2 + reach / 2) / CELL);
        const h0 = Math.floor((c.y + fy * reach / 2 - reach / 2) / CELL), h1 = Math.floor((c.y + fy * reach / 2 + reach / 2) / CELL);
        for (let ga = g0 - 1; ga <= g1 + 1; ga++) for (let gb = h0 - 1; gb <= h1 + 1; gb++) {
          const k = bucket(ga, gb);
          for (let j = head[k]; j >= 0; j = chain[j]) {
            if (j === i) continue;
            const o = C[j];
            if (o.line === c.line || o.line === nl) { // on my road or the next: the distance along it
              if (o.line === c.line && o.dir !== c.dir) continue; // the other lane
              if (o.line === c.line ? (o.s - c.s) * c.dir > 0 : o.dir === nd) {
                const g = (o.line === c.line ? (o.s - c.s) * c.dir : left + (nd > 0 ? o.s : net.L[nl].len - o.s)) - o.half - c.half;
                if (g < gap) { gap = g; byCar = true; }
              }
              if (o.line === c.line || o.dir === nd) continue;
            }
            const dx = o.x - c.x, dy = o.y - c.y, a = dx * fx + dy * fy;
            if (a <= 0 || a > reach + o.half) continue;
            const b = -dx * fy + dy * fx, ox = Math.sin(o.h), oy = Math.cos(o.h), cs = Math.abs(ox * fx + oy * fy), sn = Math.abs(-ox * fy + oy * fx);
            if (Math.abs(b) >= sn * o.half + cs * o.halfW + c.halfW + 0.4) continue; // its footprint is clear of my lane
            // and am I in its way too? Then whichever is nearer the other's path goes first
            const a2 = -dx * ox - dy * oy, b2 = dx * oy - dy * ox;
            if (a2 > 0 && Math.abs(b2) < sn * c.half + cs * c.halfW + o.halfW + 0.4) {
              if (cs < 0.7 && (Math.abs(b2) < Math.abs(b) || (Math.abs(b2) === Math.abs(b) && i < j))) continue;
            }
            const g = a - (cs * o.half + sn * o.halfW) - c.half;
            if (g < gap) { gap = g; byCar = true; }
          }
          for (let j = bhead[k]; j >= 0; j = bchain[j]) { // people: only what is past my front bumper
            const dx = bx[j] - c.x, dy = by[j] - c.y, a = dx * fx + dy * fy;
            if (a + br[j] < c.half || a > reach) continue;
            if (Math.abs(-dx * fy + dy * fx) >= c.halfW + br[j] + 0.1) continue;
            const g = a - br[j] - c.half;
            if (g < gap) { gap = g; byCar = false; }
          }
        }
        // the junction ahead: claim it in time to stop short of it, or stop short of it
        if (c.nx && left < c.half + JUNCTION + 3 + c.v * c.v / 10) {
          if (!claim(c, c.line, c.dir > 0 ? 1 : 0, left)) { const g = left - c.half - JUNCTION + 2.6; if (g < gap) { gap = g; byCar = true; } }
        }
        // caught up in another car (two stopped for each other can't get out by waiting): the
        // one in front creeps on, as far as that frees it, and the other backs off (below)
        const tangled = c.v < 0.5 ? overlaps(c, c.x, c.y, fx, fy, 0, 0) : 0, behind = tangled > 0 && ahead;
        const want = tangled > 0 && !behind ? 1.5 : gap < 2.6 ? 0 : Math.min(l.v, (gap - 2.6) * 0.9);
        c.v += Math.max(-8 * dt, Math.min(3 * dt, want - c.v));
        let s = c.s + c.dir * c.v * dt, line = c.line, dir = c.dir;
        if (c.stuck > (tangled > 0 ? 2 : STUCK)) { dir = -dir; c.stuck = 0; } // a jam that won't clear: turn round
        // give up a junction once the whole car is clear of it
        for (let h = c.held.length - 1; h >= 0; h--) {
          const H = c.held[h];
          if ((H.d += c.v * dt) > 2 * c.half + JUNCTION) { holds.delete(H); c.held.splice(h, 1); }
        }
        if (s < 0 || s > l.len) {
          if (dir === c.dir && c.nx) { line = nl; dir = nd; s = nd > 0 ? 0 : net.L[line].len; }
          else { dir = -dir; s = Math.max(0, Math.min(l.len, s)); }
        }
        lanePos(line, s, dir, tmp);
        let dh = Math.atan2(tmp.hx, tmp.hy) - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const turn = line !== c.line || dir !== c.dir, h = c.h + (line === c.line && dir !== c.dir ? dh : dh * Math.min(1, dt * 8)); // turning round: at once
        // never into another car: turning round puts the car in the other lane, and turning into
        // a road may meet a car coming into it from another, so those wait for the way to be
        // clear; any other step waits unless the car is already caught up with one
        let held = false;
        const hx1 = Math.sin(h), hy1 = Math.cos(h), hx0 = Math.sin(c.h), hy0 = Math.cos(c.h);
        if (turn) { const d1 = overlaps(c, tmp.x, tmp.y, hx1, hy1, tangled > 0 ? 0 : 0.5, tangled > 0 ? 0 : 0.2); held = d1 > 0 && !(d1 < tangled); }
        else if (s !== c.s || h !== c.h) { // (caught up side by side, creeping on gets no deeper: that will do)
          const d1 = overlaps(c, tmp.x, tmp.y, hx1, hy1, 0.15, 0.05), d0 = d1 > 0 ? overlaps(c, c.x, c.y, hx0, hy0, 0.15, 0.05) : 0;
          held = d1 > 0 && (tangled > 0 ? d1 > d0 + 1e-4 : d1 >= d0 - 1e-4);
        }
        if (!held && (turn || s !== c.s || h !== c.h)) { const d1 = peopleIn(c, tmp.x, tmp.y, hx1, hy1); held = d1 > 0 && d1 >= peopleIn(c, c.x, c.y, hx0, hy0) - 1e-4; }
        if (behind && !turn) held = true;
        if (held && tangled > 0) { // can't get out ahead: try another road next, and back up a little
          c.nx = undefined;
          const sb = Math.max(0, Math.min(l.len, c.s - c.dir * 1.5 * dt));
          lanePos(c.line, sb, c.dir, tmp);
          if (overlaps(c, tmp.x, tmp.y, hx0, hy0, 0, 0) < tangled - 1e-4 && peopleIn(c, tmp.x, tmp.y, hx0, hy0) <= peopleIn(c, c.x, c.y, hx0, hy0)) { c.s = sb; c.x = tmp.x; c.y = tmp.y; c.z = tmp.z; }
        }
        if (held) c.v = 0;
        else {
          if (turn) c.nx = undefined;
          if (line === c.line && dir !== c.dir) releaseAll(c); // turned round
          c.line = line; c.s = s; c.dir = dir;
          c.x = tmp.x; c.y = tmp.y; c.z = tmp.z; c.h = h;
        }
        c.stuck = c.v < 0.1 && (byCar || held) ? c.stuck + dt : 0;
        q.setFromAxisAngle(up, Math.PI - c.h);
        m4.compose(W(c.x, c.y, c.z), q, one);
        place(i, c);
      }
      // a car that has come up against the player (turning in, say) moves them out of its way
      if (nav) for (const b of blockers) {
        const o = pushOut(b.x, b.y, 0.35);
        if ((o.x !== b.x || o.y !== b.y) && nav.walk(o.x, o.y, b.z).ok) { b.x = o.x; b.y = o.y; }
      }
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
      if (fleet) for (const k in fleet) for (const M of fleet[k]) {
        M.instanceMatrix.needsUpdate = true;
        M.geometry.attributes.aC0.needsUpdate = M.geometry.attributes.aC1.needsUpdate = true;
      }
    }
    return Object.assign(api, { update });
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
