// The lakes other than the main one: Tasman, Hooker, Mueller and the tarns, each at its own surface (the LiDAR's
// flattened water, build_alpine.py), as a flat sheet cut to the lake by the lake-id grid and the shore's height.
// Glacial lakes: milky grey-green water from the rock flour (their colour is the satellite's, which is what the
// ground under them keeps), the sky reflected by Fresnel, and the sun's glitter.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, pow, dot, normalize, texture, positionWorld, cameraPosition, uniform, clamp,
  smoothstep, length, exp, select, mx_noise_float } from 'three/tsl';

export function createLakes(d, env, atm, light, heightTex) {
  const S = d.scene, t = S.terrain, W = t.w, H = t.h;
  const idTex = new THREE.DataTexture(d.lakeIds, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  idTex.magFilter = idTex.minFilter = THREE.NearestFilter; idTex.generateMipmaps = false; idTex.needsUpdate = true;
  const gUV = (x, z) => vec2(x.sub(t.x0).div(W * t.cell_m), z.add(t.y1).div(H * t.cell_m));
  const group = new THREE.Group();
  const lakes = (S.lakes || []).map((l, i) => ({ ...l, idx: i + 1 })).filter(l => !l.main && l.area_km2 >= 0.01);
  for (const l of lakes) {
    const [x0, y0, x1, y1] = l.box, pad = 60;
    const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
    const geo = new THREE.PlaneGeometry(w, h, 1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: false });
    const level = float(l.level);
    // the lake's own colour: what the satellite saw, a milky grey-green; deeper water a touch more saturated
    const tint = vec3(0.10, 0.17, 0.17);
    mat.colorNode = Fn(() => {
      const P = positionWorld;
      const V = normalize(cameraPosition.sub(P));
      // small wind ripples: a normal from two noise octaves, calmer on small tarns
      const rx = mx_noise_float(vec3(P.x.mul(0.35), env.u.time.mul(0.25), P.z.mul(0.35))).mul(0.05)
        .add(mx_noise_float(vec3(P.x.mul(1.7), env.u.time.mul(0.6), P.z.mul(1.7))).mul(0.025));
      const rz = mx_noise_float(vec3(P.z.mul(0.35), env.u.time.mul(0.25).add(3), P.x.mul(0.35))).mul(0.05)
        .add(mx_noise_float(vec3(P.z.mul(1.7), env.u.time.mul(0.6).add(5), P.x.mul(1.7))).mul(0.025));
      const N = normalize(vec3(rx, 1, rz));
      const cosI = max(dot(N, V), 0);
      const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosI), 5)));
      const R = V.negate().sub(N.mul(dot(V.negate(), N).mul(2)));
      const sky = atm.skyRefl(normalize(vec3(R.x, max(R.y, 0.01), R.z)), P.y, env.u.sunDir, env.u.moonDir);
      const body = light.shade(tint, vec3(0, 1, 0), P);
      const glit = pow(max(dot(R, env.u.sunDir), 0), 900).mul(light.sunVis(P)).mul(30);
      return mix(body, sky, F).add(vec3(light.u.sunE).mul(glit).mul(F));
    })();
    // cut to the lake: its id in the grid (one cell grown, so the sheet reaches the shore) and the shore above it
    mat.opacityNode = Fn(() => {
      const P = positionWorld, uv = gUV(P.x, P.z);
      const ground = texture(heightTex, uv).level(0).r;
      let inLake = float(0);
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const id = texture(idTex, uv.add(vec2(ox / W, oz / H))).level(0).r.mul(255).add(0.5).floor();
        inLake = max(inLake, select(id.equal(l.idx), float(1), float(0)));
      }
      return inLake.mul(select(ground.lessThan(level.add(0.05)), float(1), float(0)));
    })();
    mat.alphaTest = 0.5;
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, l.level, -(y0 + y1) / 2);
    group.add(m);
  }
  // the lake (if any) whose surface is under a point: { lake, depth } for the player and the game
  function lakeAt(x, north) {
    const i = Math.floor((x - t.x0) / t.cell_m), j = Math.floor((t.y1 - north) / t.cell_m);
    if (i < 0 || j < 0 || i >= W || j >= H) return null;
    const id = d.lakeIds[j * W + i];
    return id ? S.lakes[id - 1] : null;
  }
  return { group, lakeAt, idTex };
}
