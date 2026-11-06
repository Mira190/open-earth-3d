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
import { Fn, float, vec2, vec3, vec4, uv, mix, max, min, smoothstep, dot, normalize, length, sqrt, pow, uniform, mx_noise_float, clamp, attribute, cameraPosition, positionWorld } from 'three/tsl';

const hash = (i, k) => { let h = (i * 2654435761 + k * 40503 + 12345) >>> 0; h = ((h ^ (h >>> 15)) * 2246822519) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export function createClouds(ctx, light) {
  const { S, q, env, camera } = ctx;
  const nwarch = q.get('weather') === 'nwarch' && S.clouds && S.clouds.nwarch;
  const amount = q.get('clouds') !== null ? Number(q.get('clouds')) : nwarch ? 0.25 : 0.55;
  const group = new THREE.Group();
  if (nwarch) group.add(archDeck(S, light));
  if (!(amount > 0)) return { group, update() {} };
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
