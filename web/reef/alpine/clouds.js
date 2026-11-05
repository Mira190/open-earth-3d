// Clouds over an alpine site: the cumulus that builds over the Main Divide on a fine day (the westerlies rise over
// the Alps and cloud forms against the peaks, docs/cities/lake-pukaki.md), as clusters of soft puffs round the
// high peaks, with flat bases at the condensation level and tops the peaks can stand clear of.
// Each puff is a camera-facing sheet shaded as a lumpy sphere: lit tops in the sun's colour, blue-grey bases in the
// sky's light, a bright rim when the sun is behind; it takes the scene's air like everything else (the fog node), so
// far clouds fade into the sky. ?clouds=0 clears the sky, ?clouds=0.2..1 sets how much builds.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, mix, max, min, smoothstep, dot, normalize, length, sqrt, pow, uniform, mx_noise_float, clamp, attribute, cameraPosition, positionWorld } from 'three/tsl';

const hash = (i, k) => { let h = (i * 2654435761 + k * 40503 + 12345) >>> 0; h = ((h ^ (h >>> 15)) * 2246822519) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export function createClouds(ctx, light) {
  const { S, q, env, camera } = ctx;
  const amount = q.get('clouds') !== null ? Number(q.get('clouds')) : 0.55;
  const group = new THREE.Group();
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
