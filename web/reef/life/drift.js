// Things that drift in the water column near the camera, computed entirely in the vertex shader:
//   plankton / marine snow: a fixed random field that repeats every BOX metres, wrapped around the camera,
//   so it never needs a CPU update; only under water, fading out with distance.
//   coral spawning: egg-sperm bundles rising slowly from the hard corals around the camera on the
//   nights after the October / November full moon (see life.js for the clock).
import * as THREE from 'three/webgpu';
import { Fn, float, vec3, max, sin, cos, fract, floor, length, smoothstep, select, uniform, attribute, positionGeometry, cameraPosition } from 'three/tsl';
import { Herd, rng, hash } from './kit.js';
import * as G from './geo.js';

const BOX = 18;

export function createDrift(ctx, torch, reef, ground) {
  const { env } = ctx, u = env.u;
  const group = new THREE.Group(); group.name = 'life:drift';
  const right = uniform(new THREE.Vector3(1, 0, 0)), up = uniform(new THREE.Vector3(0, 1, 0));

  // ---------------------------------------------------------------- plankton
  const NP = 2600;
  const pg = new THREE.InstancedBufferGeometry(), quad = G.quad();
  pg.index = quad.index; pg.setAttribute('position', quad.attributes.position); pg.setAttribute('aux', quad.attributes.aux);
  const seeds = new Float32Array(NP * 4), R = rng(0.137);
  for (let i = 0; i < NP; i++) { seeds[i * 4] = R(); seeds[i * 4 + 1] = R(); seeds[i * 4 + 2] = R(); seeds[i * 4 + 3] = R(); }
  pg.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
  pg.instanceCount = NP;
  const seed = attribute('seed', 'vec4'), aux = attribute('aux', 'vec4');
  const pm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const centre = Fn(() => {
    const drift = vec3(sin(u.time.mul(0.11).add(seed.w.mul(40))).mul(0.25), u.time.mul(-0.006).mul(seed.w.add(0.5)), cos(u.time.mul(0.09).add(seed.x.mul(30))).mul(0.25));
    const p = seed.xyz.mul(BOX).add(drift);
    return cameraPosition.add(fract(p.sub(cameraPosition).div(BOX).add(0.5)).sub(0.5).mul(BOX));
  })();
  const size = seed.w.mul(seed.w).mul(0.012).add(0.003);
  pm.positionNode = centre.add(right.mul(aux.x.mul(size))).add(up.mul(aux.y.mul(size)));
  const dist = length(centre.sub(cameraPosition));
  pm.colorNode = vec3(0.75, 0.8, 0.72).mul(u.white.mul(0.9));     // unlit, so scaled by the (adapted) light of a white surface
  pm.opacityNode = Fn(() => {
    const disc = float(1).sub(smoothstep(0.35, 1.0, length(vec3(aux.x, aux.y, 0))));
    const under = select(centre.y.lessThan(u.tide.sub(0.05)), float(1), float(0)).mul(select(cameraPosition.y.lessThan(u.tide), float(1), float(0)));
    return disc.mul(under).mul(smoothstep(BOX * 0.5, BOX * 0.2, dist)).mul(smoothstep(0.15, 0.6, dist)).mul(0.55);
  })();
  const plankton = new THREE.Mesh(pg, pm);
  plankton.frustumCulled = false; plankton.renderOrder = 21; plankton.name = 'life:plankton';
  group.add(plankton);

  // ---------------------------------------------------------------- spawning: bundles rising from hard corals
  const NB = 9000, HARD = ['branching', 'table', 'boulder', 'brain'];
  const bundles = new Herd('spawn', G.speck(), null, NB, { order: 22 });
  const A = attribute('iA', 'vec4'), B = attribute('iB', 'vec4'), C = attribute('iC', 'vec4');
  const on = uniform(0);
  const bm = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
  // iA = source (x, top y, z, size), iB = (rise m/s, phase, height to the surface, drift phase), iC = colour and the colony's radius
  const bpos = Fn(() => {
    const H = max(B.z, 0.5), t = u.time.mul(B.x).add(B.y.mul(H));
    const rise = t.sub(floor(t.div(H)).mul(H));                         // metres above the colony, looping to the surface
    const cyc = floor(t.div(H));
    const jx = fract(sin(cyc.mul(12.9898).add(B.w.mul(78.233))).mul(43758.5)).sub(0.5), jz = fract(sin(cyc.mul(39.346).add(B.w.mul(11.135))).mul(24634.6)).sub(0.5);
    const sway = vec3(sin(u.time.mul(0.5).add(B.w.mul(6)).add(rise.mul(0.9))), 0, cos(u.time.mul(0.43).add(B.w.mul(5)).add(rise.mul(0.7)))).mul(rise.mul(0.06).add(0.05));
    return vec3(A.x.add(jx.mul(C.w)), A.y.add(rise), A.z.add(jz.mul(C.w))).add(sway);
  });
  const bc = bpos();
  bm.positionNode = positionGeometry.mul(A.w.mul(on)).add(bc);
  bm.colorNode = C.rgb;
  bm.emissiveNode = torch.light(C.rgb).mul(0.55);          // pale bundles are bright in a torch beam; kept below white so the pink and orange survive the tone curve
  bundles.mesh.material = bm;
  group.add(bundles.mesh);

  // pick the colonies near the camera and give each a stream of bundles
  let srcKey = '';
  function sources(cam) {
    const k = `${Math.round(cam.x / 6)},${Math.round(cam.z / 6)}`;
    if (k === srcKey) return; srcKey = k;
    const tide = u.tide.value, S = [];
    for (const t of reef.active()) {
      if (t.dist > 9) continue;
      for (const kind of HARD) {
        const a = t.items[kind]; if (!a) continue;
        for (let i = 0; i < a.length; i += 16) {
          const dx = a[i] - cam.x, dz = a[i + 2] - cam.z;
          if (dx * dx + dz * dz > 9 * 9) continue;
          // not every colony spawns on the same night: about half of them, the same half every time
          if (hash(Math.round(a[i] * 10), Math.round(a[i + 2] * 10), 5) > 0.55) continue;
          S.push([a[i], a[i + 1] + a[i + 3] * (kind === 'table' ? 0.3 * a[i + 11] : kind === 'branching' ? 0.45 * a[i + 11] : 0.45 * a[i + 11]), a[i + 2], a[i + 3]]);
        }
      }
    }
    let n = 0;
    if (S.length) {
      const per = Math.max(4, Math.min(300, Math.floor(NB / S.length)));
      const R2 = rng(0.71);
      for (const s of S) for (let j = 0; j < per && n < NB; j++) {
        // most bundles are still close above their colony (released over the last hour or so), some on their way to the surface
        const H = Math.max(0.5, R2() < 0.7 ? Math.min(tide - s[1], 1.2 + R2() * 1.5) : tide - s[1]), col = R2() < 0.55 ? [0.95, 0.42, 0.52] : R2() < 0.6 ? [0.98, 0.58, 0.3] : [0.95, 0.8, 0.62];
        const size = 0.011 + R2() * 0.007;                                   // drawn far larger than a real bundle (a millimetre or so) so the eye can find them
        bundles.put(n++, s[0], s[1], s[2], size, 0.012 + R2() * 0.02, R2(), H, R2() * 50, col[0], col[1], col[2], s[3] * 0.8, 0, 0, 0, 0);
      }
    }
    bundles.commit(n);
  }
  function update(cam, spawning, dt) {
    const camR = ctx.camera;
    right.value.setFromMatrixColumn(camR.matrixWorld, 0); up.value.setFromMatrixColumn(camR.matrixWorld, 1);
    pg.instanceCount = cam.y < u.tide.value + 0.2 ? NP : 0;
    on.value = spawning ? 1 : 0;
    if (!spawning && bundles.n) bundles.commit(0);
    if (spawning) sources(cam); else srcKey = '';
  }
  return { group, update, plankton, bundles, counts: () => ({ plankton: pg.instanceCount, bundles: bundles.n }) };
}
