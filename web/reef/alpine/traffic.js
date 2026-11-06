// Traffic on an alpine site's state highways (roads.json "primary": SH80, Mount Cook Road; SH8 round the lakes):
// the shared Blender cars (web/assets/vehicles/cars.glb, the models every city's game drives, built by
// blender/build_vehicles.py) driving the OpenStreetMap centrelines in the left-hand lane, as New Zealand keeps left.
//
// The cities' traffic and cars.js run on WebGL materials patched with onBeforeCompile, which the reef viewer's
// WebGPU renderer cannot take, so this module draws the same glb with its own glTF materials and drives it itself:
// - each car on a road line in one direction, its lane 1.7 m left of the centreline (roadfield.js: 3.4 m lanes);
// - 100 km/h on the open road, 50 within 150 m of a building (the townships), slowed for bends to what a lateral
//   2.5 m/s^2 allows and for the car ahead in its lane (a two-second gap);
// - at a line's end it carries on along a line from the same node, the same road where there is one;
// - the wheels split off the body as cars.js splits them (a triangle with all its corners in a wheel's cylinder), so
//   they turn; three levels of detail by distance (vehicles.json lod1_m, lod2_m);
// - headlamps and tail lamps lit from dusk;
// - how many: about one car a kilometre each way by day (a rural state highway's traffic at 100 km/h; no count for
//   SH80 was found, so the figure is a judgement), fewer at night.
// ?traffic=0 leaves it out; ?traffic=<n> scales the number of cars.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from '../../gltf.js';

const KEEP = 1;                   // +1: keep left (New Zealand)
const LANE = 1.7;                 // m from the centreline to the lane's middle
const R_LIVE = 2200, R_SPAWN = [500, 2000];
// models and how often each is seen on the road to Aoraki: hatchbacks, sedans and SUVs, campervans (the van), coaches
const MODELS = [['Car_SUV', 0.3], ['Car_Hatch', 0.24], ['Car_Sedan', 0.22], ['Car_Van', 0.18], ['Bus', 0.06]];
// New Zealand's car colours, white and silver commonest (a judgement from photographs of the road; no published share)
const COLOURS = [['#f1f1ef', 0.27], ['#b9bcc0', 0.18], ['#5d6268', 0.14], ['#1b1c1e', 0.13], ['#24467a', 0.1], ['#9e1f24', 0.08], ['#d9d4c7', 0.05], ['#2f4a3a', 0.05]];
const pick = (list, r) => { let a = 0; for (const [v, w] of list) { a += w; if (r < a) return v; } return list[0][0]; };

export async function init(ctx) {
  const { S, scene, camera, q } = ctx;
  if (S.kind !== 'alpine' || q.get('traffic') === '0') return null;
  const scale = q.get('traffic') ? Number(q.get('traffic')) : 1;
  const base = `../data/${S.id}/`;
  const [roads, glb, info, structs] = await Promise.all([
    fetch(base + 'roads.json').then(r => r.json()),
    new GLTFLoader().loadAsync(new URL('../../assets/vehicles/cars.glb', import.meta.url).href),
    fetch(new URL('../../assets/vehicles/vehicles.json', import.meta.url).href).then(r => r.json()),
    fetch(base + 'structures.json').then(r => r.json()).catch(() => null),
  ]);
  const I = info.cars;

  // ---- the network: the highway lines, joined at their ends
  const lines = (roads.lines || []).filter(l => l.c === 'primary' || l.c === 'trunk').map((l, i) => {
    const p = l.p, cum = [0];
    for (let k = 1; k < p.length; k++) cum.push(cum[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
    return { i, n: l.n || '', p, cum, len: cum[cum.length - 1], ends: [null, null], slow: null };
  }).filter(l => l.len > 5);
  if (!lines.length) return null;
  const nodes = new Map(), nk = (x, y) => `${Math.round(x / 3)},${Math.round(y / 3)}`;
  for (const L of lines) for (const e of [0, 1]) {
    const pt = e ? L.p[L.p.length - 1] : L.p[0], k = nk(pt[0], pt[1]);
    if (!nodes.has(k)) nodes.set(k, []);
    nodes.get(k).push([L, e]); L.ends[e] = k;
  }
  // the township limit: 50 km/h where a building stands within 150 m of the road (a grid of the buildings' cells)
  const built = new Set();
  for (const b of (structs && structs.structures) || []) {
    const c = b.p && b.p[0];
    if (Array.isArray(c) && c.length >= 2) built.add(`${Math.floor(c[0] / 150)},${Math.floor(c[1] / 150)}`);
  }
  const inTown = (x, y) => { const i = Math.floor(x / 150), j = Math.floor(y / 150); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (built.has(`${i + a},${j + b}`)) return true; return false; };
  // per vertex: the speed the bend there allows (the turn over the two segments either side), and the town limit
  for (const L of lines) {
    L.vmax = L.p.map((pt, k) => {
      let v = inTown(pt[0], pt[1]) ? 13.9 : 27.8;
      if (k > 0 && k < L.p.length - 1) {
        const a = L.p[k - 1], c = L.p[k + 1];
        const h1 = Math.atan2(pt[0] - a[0], pt[1] - a[1]), h2 = Math.atan2(c[0] - pt[0], c[1] - pt[1]);
        const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
        const arc = (L.cum[k + 1] - L.cum[k - 1]) / 2;
        if (turn > 0.02) v = Math.min(v, Math.sqrt(2.5 * arc / turn));
      }
      return Math.max(v, 6);
    });
  }
  const at = (L, s, out) => {
    s = Math.max(0, Math.min(L.len, s));
    let k = 1; while (k < L.p.length - 1 && L.cum[k] < s) k++;
    const a = L.p[k - 1], b = L.p[k], t = (s - L.cum[k - 1]) / Math.max(1e-6, L.cum[k] - L.cum[k - 1]);
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t;
    const h = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; out.hx = (b[0] - a[0]) / h; out.hy = (b[1] - a[1]) / h; out.k = k;
    return out;
  };
  // the speed the road allows ahead of s in direction dir, braking at 2 m/s^2 to each slower point
  const allowed = (L, s, dir) => {
    let v = 27.8;
    for (let k = 0; k < L.p.length; k++) {
      const ds = (L.cum[k] - s) * dir;
      if (ds < -2 || ds > 150) continue;
      v = Math.min(v, Math.sqrt(L.vmax[k] ** 2 + 2 * 2 * Math.max(0, ds)));
    }
    return v;
  };

  // ---- the models: body and wheels per level of detail
  glb.scene.updateMatrixWorld(true);
  const lodM = [0, I.lod1_m || 35, I.lod2_m || 110].map(v => v * 1.6);
  const geoms = {};
  for (const [name] of MODELS) {
    const M = I.models[name]; if (!M) continue;
    const hubs = [];
    for (const z of M.axles_m) for (const sd of [1, -1]) hubs.push({ x: sd * M.track_m / 2, z, r: M.wheel_r_m });
    geoms[name] = [0, 1, 2].map(lod => {
      const node = glb.scene.getObjectByName(lod ? `${name}_LOD${lod}` : name);
      if (!node) return null;
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), parts = [];
      node.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        const mat = o.material.name.replace(/\.\d+$/, '');
        if (lod === 0) split(g, hubs).forEach((pg, w) => { if (pg) parts.push({ g: pg, mat, w: w < hubs.length ? w : -1, src: o.material }); });
        else parts.push({ g, mat, w: -1, src: o.material });
      });
      return parts;
    });
    geoms[name].info = M; geoms[name].hubs = hubs;
  }
  // shared materials, the paint per car; the lamps one pair for every car, lit together at dusk
  const shared = {};
  const matOf = (src, name) => shared[name] || (shared[name] = src);
  const head = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, emissive: 0xfff3d6, emissiveIntensity: 0, roughness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 });

  // a soft contact shadow under each car (the ground's light comes from light.js, which casts no shadow of a car): a
  // dark oval a little larger than the body, fading out at its edge
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
  })();
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  blobMat.fog = false;
  // the headlamps' light on the road after dark: a pool spread ahead of the car, added to what is there (lights in the
  // scene would recompile every material as cars come and go)
  const beamTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(64, 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 64; i++) {
      const v = j / 127, u = (i / 63 - 0.5) * 2, spread = 0.25 + 0.75 * v;            // v: 0 at the bumper, 1 at 32 m
      const a = Math.max(0, 1 - Math.abs(u) / spread) ** 1.5 * Math.min(1, v * 8) * (1 - v) ** 2.6;
      const A = Math.round(255 * a); img.data.set([A, A, A, 255], (j * 64 + i) * 4);   // (an alpha map reads the green channel)
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.flipY = false; return t;
  })();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d8, alphaMap: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  beamMat.fog = false;
  const cars = [];
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  function makeCar(name) {
    const G = geoms[name], M = G.info, colour = name === 'Bus' ? '#f2f2ef' : pick(COLOURS, rnd());
    const paint = matOf(G[0][0].src, 'Paint').clone(); paint.color.set(colour);
    const paint2 = paint.clone(); paint2.color.set(name === 'Bus' ? '#1f5fa8' : colour);
    const mm = (p) => p.mat === 'Paint' ? paint : p.mat === 'Paint2' ? paint2 : p.mat === 'Light_Head' ? head : p.mat === 'Light_Tail' ? tail : matOf(p.src, p.mat);
    const root = new THREE.Group(), lodObj = new THREE.LOD(), wheels = [];
    G.forEach((parts, lod) => {
      if (!parts) return;
      const g = new THREE.Group();
      if (lod === 0) {
        const spins = G.hubs.map(h => { const at = new THREE.Group(); at.position.set(h.x, h.r, h.z); const sp = new THREE.Group(); at.add(sp); g.add(at); wheels.push(sp); return sp; });
        for (const p of parts) (p.w >= 0 ? spins[p.w] : g).add(new THREE.Mesh(p.g, mm(p)));
      } else for (const p of parts) g.add(new THREE.Mesh(p.g, mm(p)));
      lodObj.addLevel(g, lodM[lod]);
    });
    root.add(lodObj); scene.add(root);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(M.width_m * 1.25, M.length_m * 1.12).rotateX(-Math.PI / 2), blobMat);
    blob.position.y = 0.03; blob.renderOrder = 1; root.add(blob);
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 32).rotateX(-Math.PI / 2).rotateY(Math.PI), beamMat);
    beam.position.set(0, 0.05, M.length_m / 2 + 16); beam.renderOrder = 2; root.add(beam);
    return { name, M, root, lodObj, wheels, r: M.wheel_r_m, half: M.length_m / 2, L: null, s: 0, dir: 1, v: 20, spin: 0, x: 0, y: 0, h: 0 };
  }

  // ---- spawning: a car on a highway point between R_SPAWN of the eye (anywhere within it at the start)
  const P = { x: 0, y: 0, hx: 0, hy: 1, k: 1 };
  const total = lines.reduce((a, L) => a + L.len, 0);
  function place(c, near) {
    const cx = camera.position.x, cy = -camera.position.z;
    for (let tries = 0; tries < 40; tries++) {
      let r = rnd() * total, L = lines[0];
      for (const l of lines) { if (r < l.len) { L = l; break; } r -= l.len; }
      at(L, r, P);
      const d = Math.hypot(P.x - cx, P.y - cy);
      if (d > R_SPAWN[1] || (!near && d < R_SPAWN[0])) continue;
      c.L = L; c.s = r; c.dir = rnd() < 0.5 ? 1 : -1; c.v = allowed(L, r, c.dir) * 0.9; c.fresh = true;
      return true;
    }
    return false;
  }
  // the number of cars wanted: the highway within R_LIVE, about a car a kilometre each way by day, fewer at night
  const wanted = () => {
    const cx = camera.position.x, cy = -camera.position.z;
    let len = 0;
    for (const L of lines) for (let k = 1; k < L.p.length; k++) {
      const a = L.p[k - 1], b = L.p[k];
      if (Math.hypot((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy) < R_LIVE) len += L.cum[k] - L.cum[k - 1];
    }
    const hr = (new Date(ctx.clockMs ? ctx.clockMs() : Date.now()).getUTCHours() + 13) % 24;   // New Zealand's hour (daylight time)
    const day = hr >= 8 && hr < 19 ? 1 : hr >= 6 && hr < 22 ? 0.45 : 0.08;
    return Math.min(24, Math.round(len / 1000 * 2 * day * scale));
  };
  let want = wanted(), wantT = 0;

  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), e = new THREE.Euler();
  function advance(c, ds) {
    c.s += ds * c.dir;
    while (c.s < 0 || c.s > c.L.len) {
      const end = c.s > c.L.len ? 1 : 0, over = end ? c.s - c.L.len : -c.s;
      const opts = (nodes.get(c.L.ends[end]) || []).filter(([L]) => L !== c.L);
      if (!opts.length) return false;
      const same = opts.filter(([L]) => L.n && L.n === c.L.n), [L, e2] = (same.length ? same : opts)[Math.floor(rnd() * (same.length || opts.length))];
      c.L = L; c.dir = e2 === 0 ? 1 : -1; c.s = e2 === 0 ? over : L.len - over;
    }
    return true;
  }
  // the car on its lane and on the ground
  function pose(c, dt) {
      // the lane: left of the way the car is driving
      at(c.L, c.s, P);
      const hx = P.hx * c.dir, hy = P.hy * c.dir;
      c.x = P.x - hy * LANE * KEEP; c.y = P.y + hx * LANE * KEEP;
      const hNew = Math.atan2(hx, hy);
      c.h = c.h + Math.atan2(Math.sin(hNew - c.h), Math.cos(hNew - c.h)) * (dt && !c.fresh ? Math.min(1, dt * 6) : 1);
      c.fresh = false;
      // on the drawn ground: pitch from the axles' heights, roll from the sides'
      const sx = Math.sin(c.h), sy = Math.cos(c.h), ax = c.M.axles_m[0], ar = c.M.axles_m[1], tw = c.M.track_m / 2;
      const hf = ctx.height(c.x + sx * ax, c.y + sy * ax), hr = ctx.height(c.x + sx * ar, c.y + sy * ar);
      const hl = ctx.height(c.x - sy * tw, c.y + sx * tw), hrt = ctx.height(c.x + sy * tw, c.y - sx * tw);
      const pitch = Math.atan2(hf - hr, ax - ar), roll = Math.atan2(hl - hrt, 2 * tw);
      c.root.position.set(c.x, hr + (hf - hr) * (-ar) / (ax - ar), -c.y);   // the model's origin: on the ground between the axles
      // model frame: +z forward, +x left; heading clockwise from north
      e.set(-pitch, Math.atan2(sx, -sy), roll, 'YXZ');
      c.root.quaternion.setFromEuler(e);
  }
  // the cars there at the start, anywhere within reach
  for (let i = 0; i < want; i++) { const c = makeCar(pick(MODELS, rnd())); if (place(c, true)) { pose(c, 0); cars.push(c); } else { scene.remove(c.root); break; } }
  function update(dt) {
    dt = Math.min(dt, 0.1);
    const cx = camera.position.x, cy = -camera.position.z;
    if ((wantT -= dt) < 0) { wantT = 3; want = wanted(); }
    // the lamps: on from the end of the golden hour
    const sunUp = ctx.env.u.sunDir.value.y, lamps = THREE.MathUtils.smoothstep(-sunUp, -0.06, 0.04);
    head.emissiveIntensity = 2.5 * lamps * (ctx.env.u.adapt ? Math.min(ctx.env.u.adapt.value, 30) : 1); tail.emissiveIntensity = head.emissiveIntensity * 0.6;
    beamMat.opacity = 0.13 * lamps; beamMat.visible = lamps > 0.01;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      // the car ahead in this lane: within 120 m, in front, heading the same way, under 1.5 m to the side
      let gap = 1e9;
      const fx = Math.sin(c.h), fy = Math.cos(c.h);
      for (const o of cars) {
        if (o === c) continue;
        const dx = o.x - c.x, dy = o.y - c.y, f = dx * fx + dy * fy, side = Math.abs(dx * fy - dy * fx);
        if (f > 0 && f < 120 && side < 1.5 && Math.sin(o.h) * fx + Math.cos(o.h) * fy > 0.5) gap = Math.min(gap, f - c.half - o.half);
      }
      const vRoad = allowed(c.L, c.s, c.dir), vGap = Math.max(0, (gap - 4) / 2);
      const target = Math.min(vRoad, vGap);
      c.v += THREE.MathUtils.clamp(target - c.v, -6 * dt, 1.8 * dt);
      c.v = Math.max(0, c.v);
      const far = Math.hypot(c.x - cx, c.y - cy) > R_LIVE;
      if (!advance(c, c.v * dt) || (far && c.L) || cars.length > want + 2) {
        if (cars.length > want || !place(c, false)) { scene.remove(c.root); cars.splice(i, 1); continue; }
      }
      pose(c, dt);
      c.spin += c.v * dt / c.r;
      for (const w of c.wheels) w.rotation.x = c.spin;
    }
    // keep the count: new cars come on out of sight
    if (cars.length < want) { const c = makeCar(pick(MODELS, rnd())); if (place(c, false)) { pose(c, 0); cars.push(c); } else scene.remove(c.root); }
  }
  // for the gametest: how many cars, how many in the left-hand lane (1.2-2.2 m left of the centreline for the way they
  // drive), and how many on the drawn ground (the body's origin within 0.25 m of it)
  function stats() {
    let left = 0, ground = 0;
    for (const c of cars) {
      at(c.L, c.s, P);
      const hx = P.hx * c.dir, hy = P.hy * c.dir, lat = (c.x - P.x) * -hy + (c.y - P.y) * hx;
      if (lat * KEEP > 1.2 && lat * KEEP < 2.2) left++;
      if (Math.abs(c.root.position.y - ctx.height(c.x, c.y)) < 0.25) ground++;
    }
    return { n: cars.length, left, ground };
  }
  ctx.traffic = { cars, lines, stats };
  return { update };
}

// split a mesh's triangles between the body and the wheels (as cars.js does: a triangle with all three corners in a
// wheel's cylinder); each wheel comes back centred on its hub, the body last
function split(geo, wheels) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, n = P.count / 3;
  const parts = wheels.map(() => []).concat([[]]);
  for (let t = 0; t < n; t++) {
    let part = wheels.length;
    for (let w = 0; w < wheels.length && part === wheels.length; w++) {
      const q = wheels[w];
      let all = true;
      for (let c = 0; c < 3 && all; c++) {
        const i = 3 * t + c, dx = P.getX(i) - q.x, dy = P.getY(i) - q.r, dz = P.getZ(i) - q.z;
        all = Math.abs(dx) < 0.17 && dy * dy + dz * dz < q.r * q.r * 1.09;
      }
      if (all) part = w;
    }
    parts[part].push(t);
  }
  return parts.map((tris, p) => {
    if (!tris.length) return null;
    const out = new THREE.BufferGeometry(), q = wheels[p];
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name], size = a.itemSize, arr = new Float32Array(tris.length * 3 * size);
      let j = 0;
      for (const t of tris) for (let c = 0; c < 3; c++) for (let k = 0; k < size; k++) arr[j++] = a.getComponent(3 * t + c, k);
      if (name === 'position' && q) for (let k = 0; k < arr.length; k += 3) { arr[k] -= q.x; arr[k + 1] -= q.r; arr[k + 2] -= q.z; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized && false));
    }
    out.computeBoundingSphere();
    return out;
  });
}
