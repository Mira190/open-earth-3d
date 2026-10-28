// The sea surface: a radial mesh around the camera, displaced by the wave spectrum (Gerstner
// swell and chop; the ripple band only bends normals), shaded by Fresnel reflection of the sky,
// sun glitter, foam from surface compression (the Jacobian of the horizontal displacement, so
// whitecaps form where crests squeeze the water, not where a texture says), and a shore: waves
// slow and steepen as the water shoals, break into foam lines, and run up the sand.
// Seen from below it is Snell's window and total internal reflection.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, abs, smoothstep, clamp, texture, positionLocal, positionWorld,
  cameraPosition, normalize, dot, reflect, sin, cos, pow, exp, sqrt, select, length, mx_noise_float, uniform, frontFacing } from 'three/tsl';
import { gridUV } from './world.js';

export function createOcean(d, env, heightTex) {
  const u = env.u, waves = env.waves;
  const centre = uniform(new THREE.Vector3());
  const depthAt = (wx, wz) => u.tide.sub(texture(heightTex, gridUV(d, wx, wz)).level(0).r);

  // radial mesh: rings spaced geometrically so detail sits where the camera is
  const RINGS = 150, SEG = 192, R0 = 1.2, R1 = 45000;
  const pos = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const r = R0 * Math.pow(R1 / R0, i / RINGS) - R0 * 0.999;
    for (let j = 0; j <= SEG; j++) { const a = (j / SEG) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
    const a = i * (SEG + 1) + j, b = a + 1, c = a + SEG + 1, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);

  // ---- the wave field, evaluated at a horizontal position
  // returns { off: vec3 displacement, n: vec3 normal, jac: compression }, with the swell and chop
  // growing as the water shoals and dying where it breaks
  const field = (x, z, depth, includeRipples, dist) => {
    let dy = float(0), dx = float(0), dz = float(0);
    let hx = float(0), hz = float(0);
    let jxx = float(0), jzz = float(0), jxz = float(0);
    const shoal = float(1).add(float(0.7).mul(float(1).sub(smoothstep(0.6, 6, depth))));            // steepen toward shore
    const gate = smoothstep(0.0, 0.7, depth);                                        // gone on dry sand
    const Q = 0.85;
    for (const w of waves) {
      if (!w.disp && !includeRipples) continue;
      const ph = x.mul(w.dx * w.k).add(z.mul(w.dz * w.k)).sub(u.time.mul(w.w)).add(w.ph);
      const s = sin(ph), c = cos(ph);
      // a wave is only drawn while the pixel is smaller than its wavelength: it fades out with distance
      const fade = clamp(float(1).sub(dist.div(w.lam * (w.disp ? 1400 : 380))), 0, 1);
      const amp = w.disp ? float(w.a).mul(shoal).mul(gate).mul(u.wind).mul(fade) : float(w.a).mul(fade.mul(fade)).mul(gate.max(0.35));
      dy = dy.add(amp.mul(s));
      hx = hx.add(amp.mul(w.k * w.dx).mul(c));
      hz = hz.add(amp.mul(w.k * w.dz).mul(c));
      if (w.disp) {
        const qa = amp.mul(Q);
        dx = dx.add(qa.mul(c).mul(w.dx)); dz = dz.add(qa.mul(c).mul(w.dz));
        const qk = qa.mul(w.k).mul(s);
        jxx = jxx.add(qk.mul(w.dx * w.dx)); jzz = jzz.add(qk.mul(w.dz * w.dz)); jxz = jxz.add(qk.mul(w.dx * w.dz));
      }
    }
    const jac = float(1).sub(jxx).mul(float(1).sub(jzz)).sub(jxz.mul(jxz));
    return { dy, dx, dz, n: normalize(vec3(hx.negate(), 1, hz.negate())), jac };
  };

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: true });
  mat.fog = false;

  // vertex: ring position around the camera (snapped, so crests do not crawl), then the swell
  const world = Fn(() => {
    const snap = centre.xz.div(6).floor().mul(6);
    return vec2(positionLocal.x.add(snap.x), positionLocal.z.add(snap.y));
  });
  mat.positionNode = Fn(() => {
    const xz = world();
    const depth = depthAt(xz.x, xz.y);
    const f = field(xz.x, xz.y, depth, false, length(xz.sub(centre.xz)));
    return vec3(xz.x.add(f.dx.negate()), u.tide.add(f.dy), xz.y.add(f.dz.negate()));
  })();

  mat.outputNode = Fn(() => {
    const P = positionWorld;
    const toCam = cameraPosition.sub(P);
    const dist = length(toCam);
    const V = toCam.div(dist);
    const depth = depthAt(P.x, P.z);
    const above = cameraPosition.y.greaterThan(u.tide);
    const f = field(P.x, P.z, depth, true, dist);
    let N = f.n.toVar();
    // the shore: a wave front slows and steepens as it shoals, the waterline swashes in and out
    const swashPhase = u.time.mul(0.62);
    const nz = mx_noise_float(vec3(P.x.mul(0.05), P.z.mul(0.05), u.time.mul(0.1)));
    const wl = depth.add(sin(swashPhase.add(nz.mul(2))).mul(0.14)).add(sin(u.time.mul(0.23).add(nz)).mul(0.1)); // depth at the moving waterline
    const edge = smoothstep(0.0, 0.07, wl);              // water thins to nothing on the sand
    // foam: compression, plus a lace line where the swash meets the sand, plus the break zone
    const lace = mx_noise_float(vec3(P.x.mul(0.7), P.z.mul(0.7), u.time.mul(0.2)));
    const comp = float(1).sub(smoothstep(0.3, 0.62, f.jac)).mul(smoothstep(0.1, 1.0, depth)).mul(u.wind.mul(1.2));
    const swashFoam = smoothstep(0.0, 0.02, wl).mul(float(1).sub(smoothstep(0.05, 0.22, wl))).mul(smoothstep(-0.2, 0.5, lace.add(0.25)));
    const brk = float(1).sub(smoothstep(0.4, 1.6, depth)).mul(smoothstep(0.1, 0.5, depth)).mul(smoothstep(0.1, 0.9, lace.mul(2).add(sin(depth.mul(6).sub(u.time.mul(1.4))).mul(0.5))));
    const foam = clamp(comp.add(swashFoam.mul(0.95)).add(brk.mul(0.55).mul(u.wind)), 0, 1);

    const Fr = (n, v) => float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(n, v), 0)), 5)));
    // ---- from above
    const R = reflect(V.negate(), N).toVar();
    R.assign(vec3(R.x, abs(R.y), R.z));
    const F = Fr(N, V);
    const sunRefl = env.sky(R);
    const foamCol = vec3(0.92, 0.95, 0.96).mul(u.white.mul(0.85).add(0.1));
    const haze = float(1).sub(exp(dist.mul(u.haze).negate()));
    let above_c = mix(sunRefl, env.sky(normalize(vec3(V.x.negate(), 0.04, V.z.negate()))), haze.mul(0.6));
    above_c = mix(above_c, foamCol, foam);
    const above_a = clamp(F.add(foam).mul(edge).max(float(0.0)), 0, 1).max(float(1).sub(edge).mul(0.0));
    // ---- from below: Snell's window and total internal reflection (n = 1.34)
    const nd = N.negate();
    const I = V.negate();
    const cosi = max(dot(nd, I).negate(), 0);
    const eta = float(1.34);
    const k = float(1).sub(eta.mul(eta).mul(float(1).sub(cosi.mul(cosi))));
    const T = I.mul(eta).add(nd.mul(eta.mul(cosi).sub(sqrt(max(k, 0)))));
    const window = smoothstep(0.0, 0.04, k);
    const Fb = Fr(nd, V.negate().negate()).mul(0.0).add(float(0.02));
    const skyT = env.sky(normalize(T)).mul(float(1).sub(Fb));
    // beyond the window the surface is a mirror: it shows the water itself, at the camera's depth
    const dC = u.tide.sub(cameraPosition.y).max(0);
    const bodyCol = u.Rinf.mul(u.white).mul(exp(u.K.mul(dC.mul(u.lightPath)).negate())).mul(3.6);
    const under_rgb = mix(bodyCol, env.medium(skyT, P), window);
    return select(above, vec4(above_c, above_a), vec4(under_rgb, float(1)));
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  function update(cam) { centre.value.set(cam.x, 0, cam.z); }
  return { mesh, update, material: mat };
}
