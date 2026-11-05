// Light on an alpine site: the sun through the air (its colour from atmos.js), the mountains' shadows, the sky's
// light and the light bounced off the land. Shared by the terrain, the lakes and the plants, so a tussock and the
// slope it stands on are lit alike.
//
// The mountains' shadows: a pass renders the sun's visibility over the whole site into a texture, by marching
// each cell's ray toward the sun over the height grid (the Earth's curvature and the sun's half-degree disc
// included, so the penumbra of a ridge 10 km away is wide and soft). The sun moves slowly, so the pass runs
// again only when it has moved; every material then reads the shadow with one texture lookup.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, uniform, texture, max, min, clamp, smoothstep, dot, mix, normalize, exp, positionWorld, cameraPosition } from 'three/tsl';

export function createLight(renderer, d, env, atm, heightTex) {
  const t = d.scene.terrain, W = t.w, H = t.h;
  const u = {
    sunE: uniform(new THREE.Color(1, 1, 1)),      // the sun's irradiance on a surface facing it, rgb, adapted
    skyE: uniform(new THREE.Color(0.3, 0.4, 0.6)), // the sky's irradiance on a horizontal surface, rgb, adapted
    groundE: uniform(new THREE.Color(0.2, 0.18, 0.12)), // light bounced up from the land
    moonE: uniform(new THREE.Color(0, 0, 0)),
    sunDir: env.u.sunDir, moonDir: env.u.moonDir,
  };
  // ---- the shadow pass
  const SW = Math.ceil(W / 2), SH = Math.ceil(H / 2);
  const rt = new THREE.RenderTarget(SW, SH, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  const hAt = (x, z) => texture(heightTex, vec2(x.sub(t.x0).div(W * t.cell_m), z.add(t.y1).div(H * t.cell_m))).level(0).r;
  const STEPS = 34;
  const pass = Fn(() => {
    const p = uv();
    const x = p.x.mul(W * t.cell_m).add(t.x0), z = p.y.mul(H * t.cell_m).sub(t.y1);
    const h0 = hAt(x, z).add(2.0);
    const s = u.sunDir, horiz = max(vec2(s.x, s.z).length(), 1e-4);
    const dir = vec2(s.x, s.z).div(horiz), tanE = s.y.div(horiz);
    let margin = float(1).toVar();
    let dist = 45.0;
    for (let i = 0; i < STEPS; i++) {
      const dd = dist;
      const hx = hAt(x.add(dir.x.mul(dd)), z.add(dir.y.mul(dd)));
      // the ray's height over the terrain, as an angle (radians) seen from the cell; the Earth falls away beneath it
      const ray = h0.add(tanE.mul(dd)).sub(dd * dd / (2 * 6371e3 * 1.15));
      margin.assign(min(margin, ray.sub(hx).div(dd)));
      dist *= 1.2;
    }
    // the sun's disc is 0.0093 rad across; a little more softening for the grid's own scale
    const vis = smoothstep(-0.012, 0.012, margin).mul(smoothstep(-0.02, 0.03, s.y));
    return vec4(vis, vis, vis, 1);
  })();
  const pm = new THREE.MeshBasicNodeMaterial(); pm.colorNode = pass; pm.fog = false; pm.toneMapped = false;
  const quad = new THREE.QuadMesh(pm);
  const last = new THREE.Vector3(9, 9, 9);
  function update(force = false) {
    if (!force && last.distanceToSquared(u.sunDir.value) < 1e-7) return false;   // about 0.02 degrees
    last.copy(u.sunDir.value);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); quad.render(renderer); renderer.setRenderTarget(prev);
    return true;
  }
  const shadowTex = texture(rt.texture);
  const sunVis = Fn(([P]) => shadowTex.sample(vec2(P.x.sub(t.x0).div(W * t.cell_m), P.z.add(t.y1).div(H * t.cell_m))).r);

  // ---- shading: albedo (linear) and a world normal -> radiance, before the air (the fog node adds the air)
  // spec: a glossy share (snow, wet gravel, ice), ao: the ground's own occlusion
  const shade = (albedo, N, P, { spec = null, ao = float(1), vis = null } = {}) => {
    const V = vis ?? sunVis(P);
    const nl = max(dot(N, u.sunDir), 0);
    const ml = max(dot(N, u.moonDir), 0);
    const up = N.y.mul(0.5).add(0.5);
    const irr = vec3(u.sunE).mul(nl.mul(V)).add(vec3(u.moonE).mul(ml)).add(vec3(u.skyE).mul(up.mul(0.75).add(0.25)).mul(ao))
      .add(vec3(u.groundE).mul(float(1).sub(up)).mul(ao));
    let c = albedo.mul(irr).mul(1 / Math.PI);
    if (spec) {
      // a broad lobe toward the sun's mirror direction (snow's forward scatter, wet gravel)
      const Vd = normalize(positionWorld.sub(cameraPosition));
      const R = Vd.sub(N.mul(dot(Vd, N).mul(2)));
      const lobe = exp(float(1).sub(max(dot(R, u.sunDir), 0)).mul(-60)).mul(spec);
      c = c.add(vec3(u.sunE).mul(lobe.mul(V).mul(nl.mul(0.8).add(0.2))).mul(0.06));
    }
    return c;
  };
  return { u, update, sunVis, shade, rt, SW, SH };
}
