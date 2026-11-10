// Clouds over an alpine site: the cumulus that builds over the Main Divide on a fine day (the westerlies rise over
// the Alps and cloud forms against the peaks, docs/cities/lake-pukaki.md), as clusters of soft puffs round the
// high peaks, with flat bases at the condensation level and tops the peaks can stand clear of.
// Each puff is a camera-facing sheet shaded as a lumpy sphere: lit tops in the sun's colour, blue-grey bases in the
// sky's light, a bright rim when the sun is behind; it takes the scene's air like everything else (the fog node), so
// far clouds fade into the sky. ?clouds=0 clears the sky, ?clouds=0.2..1 sets how much builds.
// ?weather=nwarch: a nor'west arch, Canterbury's sign of a nor'wester: a deck of high cloud over the basins and the
// plains, ending in the west in a long straight edge parallel to the Main Divide, with the clear foehn gap under it over
// the Alps, and the deck's underside lit orange and red at sunrise and sunset. The edge is city.json clouds.nwarch {edge: [x, y], bearing_deg} (a point on it
// and its bearing); the deck is at 6 km, streaked along the wind like the lenticular cloud it is made of.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, mix, max, min, abs, floor, fract, smoothstep, dot, normalize, length, sqrt, pow, uniform, mx_noise_float, clamp, attribute, cameraPosition, positionWorld } from 'three/tsl';

const hash = (i, k) => { let h = (i * 2654435761 + k * 40503 + 12345) >>> 0; h = ((h ^ (h >>> 15)) * 2246822519) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export function createClouds(ctx, light) {
  const { S, q, env, camera } = ctx;
  const nwarch = q.get('weather') === 'nwarch' && S.clouds && S.clouds.nwarch;
  const amount = q.get('clouds') !== null ? Number(q.get('clouds')) : nwarch ? 0.25 : 0.55;
  const group = new THREE.Group();
  if (nwarch) group.add(archDeck(S, light));
  if (!(amount > 0)) return { group, update() {} };
  if (S.clouds && S.clouds.field) return cumulusField(ctx, light, group, q.get('clouds') !== null ? amount : (S.clouds.field.amount ?? 0.55));
  const datum = S.terrain.datum_m || 0;
  const base = 2350 - datum;                        // the cumulus base, m above the lake (about 2,350 m above the sea)
  const seedsIds = ['aoraki', 'mt-tasman', 'mt-sefton', 'mt-haidinger', 'malte-brun', 'mt-elie-de-beaumont', 'footstool', 'mt-hicks'];
  const centres = seedsIds.map(id => (S.pois || []).find(p => p.id === id)).filter(Boolean);
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const seedA = attribute('aSeed', 'float');
  const right = uniform(new THREE.Vector3(1, 0, 0)), upv = uniform(new THREE.Vector3(0, 1, 0)), fwd = uniform(new THREE.Vector3(0, 0, 1));
  const uvc = Fn(() => uv().mul(2).sub(1))();
  const shape = Fn(() => {
    const p = uvc;
    // billows: three octaves on the rim, so the edge is a cauliflower, not a blur
    const n = mx_noise_float(vec3(p.mul(1.9), seedA)).mul(0.26).add(mx_noise_float(vec3(p.mul(4.7), seedA.add(7))).mul(0.12))
      .add(mx_noise_float(vec3(p.mul(11.0), seedA.add(13))).mul(0.05));
    const r = length(p.mul(vec2(1, 1.15))).add(n);
    const flatBase = smoothstep(-0.55, -0.47, p.y.add(mx_noise_float(vec3(p.mul(5.0), seedA.add(3))).mul(0.025)));
    return smoothstep(0.93, 0.8, r).mul(flatBase);
  })();
  mat.colorNode = Fn(() => {
    const p = uvc;
    const z = sqrt(max(float(1).sub(dot(p, p)), 0.05));
    // the puff's own surface normal, in the world (the sheet faces the camera)
    const N = normalize(vec3(right).mul(p.x).add(vec3(upv).mul(p.y)).add(vec3(fwd).mul(z)));
    const L = light.u.sunDir;
    const wrap = clamp(dot(N, L).mul(0.6).add(0.4), 0, 1);
    const V = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(max(dot(V.negate(), L), 0), 6).mul(smoothstep(0.5, 1.0, length(p))).mul(1.6);
    const sun = vec3(light.u.sunE).mul(wrap.mul(0.85).add(rim));   // (above the ridges: the land's shadow map does not reach them)
    const sky = vec3(light.u.skyE).mul(p.y.mul(0.35).add(0.75));
    return sun.add(sky).mul(0.92 / Math.PI);
  })();
  mat.opacityNode = shape.mul(0.97);
  const puffs = [];
  let k = 0;
  for (const [ci, c] of centres.entries()) {
    const n = Math.round(6 + 10 * amount * hash(ci, 1));
    for (let i = 0; i < n; i++, k++) {
      const a = hash(k, 2) * Math.PI * 2, rr = 400 + hash(k, 3) * 2600 * (0.5 + amount);
      const size = 350 + hash(k, 4) * 900;
      const lift = hash(k, 5) * 900 * amount;
      const m = new THREE.Mesh(geo, mat);
      m.geometry = geo.clone(); m.geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(4).fill(hash(k, 6) * 50), 1));
      m.position.set(c.x + Math.cos(a) * rr + 600, base + size * 0.45 + lift, -(c.y + Math.sin(a) * rr));
      m.scale.set(size * (1.2 + hash(k, 7) * 0.6), size, 1);
      m.renderOrder = 5;
      group.add(m); puffs.push(m);
    }
  }
  const q4 = new THREE.Quaternion();
  function update() {
    // every puff faces the camera (all share the camera's orientation: sheets parallel to the screen)
    q4.copy(camera.quaternion);
    for (const m of puffs) m.quaternion.copy(q4);
    right.value.set(1, 0, 0).applyQuaternion(q4); upv.value.set(0, 1, 0).applyQuaternion(q4); fwd.value.set(0, 0, 1).applyQuaternion(q4);
  }
  update();
  return { group, update };
}

// the nor'west arch's deck: a plane 6 km above the sea, its density from the distance east of the edge
// (wavering a little along it), streaked along the north-westerly, lit from above (the underside takes the sky's
// light and, with the sun low, the sun's colour through the deck's thin edge)
function archDeck(S, light) {
  const A = S.clouds.nwarch, datum = S.terrain.datum_m || 0;
  const b = (A.bearing_deg ?? 37) * Math.PI / 180;
  const along = new THREE.Vector2(Math.sin(b), Math.cos(b)), across = new THREE.Vector2(-along.y, along.x);   // across: to the north-west
  const geo = new THREE.PlaneGeometry(220000, 220000, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const E = uniform(new THREE.Vector2(A.edge[0], A.edge[1])), U = uniform(along), V = uniform(across);
  const dens = Fn(() => {
    const P = vec2(positionWorld.x, positionWorld.z.negate()).sub(E);
    const s = dot(P, U), w = dot(P, V).negate();                // along the edge, and east of it (m)
    const waver = mx_noise_float(vec3(s.mul(0.00004), 0, 1.7)).mul(2500).add(mx_noise_float(vec3(s.mul(0.0003), 0, 4.1)).mul(400));
    const edge = smoothstep(0, 2500, w.add(waver));
    // streaks along the wind (across the edge), and a little texture
    const streak = mx_noise_float(vec3(s.mul(0.0006), w.mul(0.00008), 2.3)).mul(0.35).add(0.75);
    const fine = mx_noise_float(vec3(s.mul(0.003), w.mul(0.001), 5.1)).mul(0.15).add(0.9);
    return clamp(edge.mul(streak).mul(fine), 0, 1);
  })();
  mat.colorNode = Fn(() => {
    const d = dens;
    const sy = light.u.sunDir.y, low = float(1).sub(smoothstep(0.02, 0.35, sy));
    // the underside: grey in the sky's light, the sun's light through the thin deck (most at its edge), and round sunset,
    // while the sun is still above the deck's own horizon (it is 6 km up: about 2.5 degrees below the land's), the
    // orange and red the nor'west arch is known for, in proportion to the sky's light so it follows the eye's adaptation
    const skyL = dot(vec3(light.u.skyE), vec3(0.2126, 0.7152, 0.0722));
    const sky = vec3(light.u.skyE).mul(0.35).add(vec3(skyL).mul(0.9));
    const sun = vec3(light.u.sunE).mul(float(0.55).add(low.mul(0.6))).mul(float(1.15).sub(d.mul(0.6)));
    const glow = vec3(1.0, 0.42, 0.18).mul(smoothstep(-0.06, 0.0, sy).mul(float(1).sub(smoothstep(0.04, 0.2, sy)))).mul(skyL.mul(9));
    return sky.add(sun).add(glow).mul(0.9 / Math.PI);
  })();
  mat.opacityNode = dens.mul(0.92);
  mat.fog = false;     // (above most of the air: the haze between the eye and the land would hide it in the sky)
  const m = new THREE.Mesh(geo, mat);
  m.position.set(A.edge[0] - across.x * 90000, 6000 - datum, -(A.edge[1] - across.y * 90000));
  m.renderOrder = 4; m.frustumCulled = false; m.name = 'nwarch';
  return m;
}

// A fair-weather sky (city.json clouds.field): cumulus scattered over the whole view at one condensation level, each
// cloud a heap of soft puffs with a flat base, drifting on the wind, and a cap of cloud building on the peaks named in
// `caps`. All of it is one mesh: a quad a puff, turned to the eye in the vertex stage, drawn back to front (the order
// is re-sorted a few times a second). A puff is shaded as part of its cloud: the heap's sunward side and top are
// white, its base and lee blue-grey, its edge bright when the sun is behind it.
//   field: { base_m (above the sea), count, radius_m, wind_deg (where it blows from), wind_ms, caps: [poi ids], amount }
function cumulusField(ctx, light, group, amount) {
  const { S, env, camera } = ctx;
  const F = S.clouds.field, datum = S.terrain.datum_m || 0;
  const base = (F.base_m ?? 1800) - datum, R = F.radius_m ?? 42000, span = 2 * R;
  const wd = ((F.wind_deg ?? 250) + 180) * Math.PI / 180, ws = F.wind_ms ?? 7;
  const wind = new THREE.Vector2(Math.sin(wd) * ws, -Math.cos(wd) * ws);            // three.js x, z per second
  const clouds = [];
  const n = Math.round((F.count ?? 44) * amount / 0.55);
  for (let i = 0; i < n; i++) {
    // (a stratified scatter: no two heaps on top of each other, none missing from a quarter of the sky)
    const g = Math.ceil(Math.sqrt(n)), gx = i % g, gz = Math.floor(i / g);
    const x = ((gx + 0.15 + 0.7 * hash(i, 11)) / g * 2 - 1) * R, z = ((gz + 0.15 + 0.7 * hash(i, 12)) / g * 2 - 1) * R;
    const w = 900 + 2600 * hash(i, 13) ** 1.6;
    clouds.push({ x, z, w, h: w * (0.32 + 0.3 * hash(i, 14)), drift: 1, seed: i });
  }
  for (const [ci, id] of (F.caps || []).entries()) {
    const p = (S.pois || []).find(p => p.id === id); if (!p) continue;
    for (let k = 0; k < 2; k++) clouds.push({ x: p.x + 500 + (hash(ci, 20 + k) - 0.5) * 2200, z: -(p.y + (hash(ci, 22 + k) - 0.5) * 2200), w: 1500 + 1500 * hash(ci, 24 + k), h: 800 + 500 * hash(ci, 26 + k), drift: 0, seed: 500 + ci * 2 + k });
  }
  const puffs = [];
  for (const c of clouds) {
    const m = Math.round(14 + c.w / 110);
    for (let k = 0; k < m; k++) {
      const a = hash(c.seed * 131 + k, 2) * Math.PI * 2, d = Math.sqrt(hash(c.seed * 131 + k, 3));
      const ox = Math.cos(a) * d * c.w * 0.5, oz = Math.sin(a) * d * c.w * 0.34;
      // towers near the middle, low shoulders at the rim; every puff's foot at the base
      const top = c.h * (0.3 + 0.7 * (1 - d * d) * (0.45 + 0.55 * hash(c.seed * 131 + k, 4)));
      const r = Math.max(top * 0.5, c.w * 0.1) * (0.7 + 0.6 * hash(c.seed * 131 + k, 5));
      const oy = Math.max(top - r * 0.75, r * 0.42);
      puffs.push({ c, ox, oy, oz, r, seed: hash(c.seed * 131 + k, 6) * 60 });
      // a second, smaller puff under a tall one fills the trunk of the tower
      if (oy > r * 1.1) puffs.push({ c, ox: ox * 0.9, oy: r * 0.5, oz: oz * 0.9, r: r * 0.95, seed: hash(c.seed * 131 + k, 7) * 60 });
    }
  }
  const N = puffs.length;
  const pos = new Float32Array(N * 12), uvs = new Float32Array(N * 8), aC = new Float32Array(N * 12), aK = new Float32Array(N * 16), aR = new Float32Array(N * 16);
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  puffs.forEach((p, i) => {
    for (let v = 0; v < 4; v++) {
      const o = i * 4 + v;
      pos.set([corner[v][0], corner[v][1], 0], o * 3); uvs.set([corner[v][0] * 0.5 + 0.5, corner[v][1] * 0.5 + 0.5], o * 2);
      aC.set([p.c.x + p.ox, base + p.oy, p.c.z + p.oz], o * 3);
      aK.set([p.c.x, p.c.z, p.c.drift, p.r], o * 4);
      // where the puff sits in its heap (-1..1 across, 0..1 up), and its own seed
      aR.set([p.ox / (p.c.w * 0.5), p.oy / p.c.h, p.oz / (p.c.w * 0.5), p.seed], o * 4);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aC', new THREE.BufferAttribute(aC, 3)); geo.setAttribute('aK', new THREE.BufferAttribute(aK, 4)); geo.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  const index = new Uint32Array(N * 6);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const order = Uint32Array.from({ length: N }, (_, i) => i), dist = new Float32Array(N);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const right = uniform(new THREE.Vector3(1, 0, 0)), upv = uniform(new THREE.Vector3(0, 1, 0)), fwd = uniform(new THREE.Vector3(0, 0, 1));
  const uOff = uniform(new THREE.Vector2()), uEye = uniform(new THREE.Vector2());
  const C = attribute('aC', 'vec3'), K = attribute('aK', 'vec4'), Rl = attribute('aR', 'vec4');
  // the drift: the whole heap moves with the wind and comes round again, in a square that follows the eye
  const wrap = v => v.sub(floor(v.div(span).add(0.5)).mul(span));
  const shift = Fn(() => {
    const c = vec2(K.x, K.y).add(uOff).sub(uEye);
    return mix(vec2(0, 0), vec2(wrap(c.x), wrap(c.y)).add(uEye).sub(vec2(K.x, K.y)), K.z);
  })();
  mat.positionNode = Fn(() => {
    const s = shift, p = attribute('position', 'vec3');
    return vec3(C.x.add(s.x), C.y, C.z.add(s.y)).add(vec3(right).mul(p.x.mul(K.w).mul(1.25))).add(vec3(upv).mul(p.y.mul(K.w)));
  })();
  const uvc = Fn(() => uv().mul(2).sub(1))();
  const seedA = Rl.w;
  const shape = Fn(() => {
    const p = uvc;
    const nz = mx_noise_float(vec3(p.mul(1.7), seedA)).mul(0.24).add(mx_noise_float(vec3(p.mul(4.3), seedA.add(7))).mul(0.12)).add(mx_noise_float(vec3(p.mul(10.0), seedA.add(13))).mul(0.055));
    const r = length(p).add(nz);
    // a flat base where the puff stands on the condensation level
    const foot = C.y.add(p.y.mul(K.w)).sub(base);
    const flat = smoothstep(-40, 90, foot.add(mx_noise_float(vec3(p.x.mul(4), seedA, 3)).mul(50)));
    return smoothstep(0.9, 0.7, r).mul(flat);
  })();
  mat.colorNode = Fn(() => {
    const p = uvc, z = sqrt(max(float(1).sub(dot(p, p)), 0.04));
    const Np = normalize(vec3(right).mul(p.x).add(vec3(upv).mul(p.y)).add(vec3(fwd).mul(z)));
    // the heap's own shape: outward from its middle and up
    const Nc = normalize(vec3(Rl.x, Rl.y.mul(1.6).sub(0.35), Rl.z).add(vec3(0, 0.25, 0)));
    const Nn = normalize(Np.mul(0.55).add(Nc.mul(0.75)));
    const L = light.u.sunDir;
    // billows inside the puff: its own lumps catch the sun and shade each other
    const lump = mx_noise_float(vec3(p.mul(2.6), seedA.add(21))).mul(0.6).add(mx_noise_float(vec3(p.mul(6.5), seedA.add(29))).mul(0.4));
    const lit = clamp(dot(Nn, L).mul(0.62).add(0.44).add(lump.mul(0.22)), 0, 1).mul(mix(float(0.86), float(1.06), fract(seedA.mul(0.37))));
    // light does not reach far into a heap: its base and its core are in its own shade
    const deep = smoothstep(0.0, 0.55, Rl.y.add(p.y.mul(0.25)));
    const V = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(max(dot(V.negate(), L), 0), 5).mul(smoothstep(0.45, 0.95, length(p))).mul(1.4);
    const sun = vec3(light.u.sunE).mul(lit.mul(mix(float(0.5), float(1), deep)).add(rim));
    const sky = vec3(light.u.skyE).mul(mix(float(0.62), float(1.0), deep)).add(vec3(light.u.groundE).mul(0.5));
    return sun.mul(0.86).add(sky.mul(0.9)).mul(0.95 / Math.PI);
  })();
  // thinner toward the edge of the field, so a heap coming round again fades in
  const edge = Fn(() => { const c = vec2(K.x, K.y).add(shift).sub(uEye); return mix(float(1), smoothstep(R, R * 0.82, max(abs(c.x), abs(c.y))), K.z); })();
  mat.opacityNode = shape.mul(0.96).mul(edge);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'cumulus';
  group.add(mesh);
  const wrapJS = v => v - Math.floor(v / span + 0.5) * span;
  let tick = 0;
  function sort() {
    const ex = camera.position.x, ey = camera.position.y, ez = camera.position.z, ox = uOff.value.x, oz = uOff.value.y;
    for (let i = 0; i < N; i++) {
      const p = puffs[i], c = p.c;
      const sx = c.drift ? wrapJS(c.x + ox - ex) + ex - c.x : 0, sz = c.drift ? wrapJS(c.z + oz - ez) + ez - c.z : 0;
      const dx = c.x + p.ox + sx - ex, dy = base + p.oy - ey, dz = c.z + p.oz + sz - ez;
      dist[i] = dx * dx + dy * dy + dz * dz;
    }
    order.sort((a, b) => dist[b] - dist[a]);
    for (let k = 0; k < N; k++) { const o = order[k] * 4; index.set([o, o + 1, o + 2, o, o + 2, o + 3], k * 6); }
    geo.index.needsUpdate = true;
  }
  function update() {
    const t = env.u.time.value;
    uOff.value.set(wind.x * t, wind.y * t); uEye.value.set(camera.position.x, camera.position.z);
    right.value.set(1, 0, 0).applyQuaternion(camera.quaternion); upv.value.set(0, 1, 0).applyQuaternion(camera.quaternion); fwd.value.set(0, 0, 1).applyQuaternion(camera.quaternion);
    if (tick++ % 20 === 0) sort();
  }
  update();
  return { group, update };
}
