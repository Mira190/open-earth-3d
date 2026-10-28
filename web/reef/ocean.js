// The sea surface: a radial mesh around the camera, displaced by the wave spectrum (Gerstner
// swell and chop; the ripple band only bends normals), shaded by Fresnel reflection of the sky,
// sun glitter, foam from surface compression (the Jacobian of the horizontal displacement, so
// whitecaps form where crests squeeze the water, not where a texture says), and a shore: waves
// slow and steepen as the water shoals, break into foam lines, and run up the sand.
// Seen from below it is Snell's window and total internal reflection.
// The ripples (ripples.js) are a mipmapped tile: their slopes below the pixel are kept as a variance, and
// the sun glitter is the Cox-Munk slope distribution of what is left, so it stays right from a metre to
// the horizon. From above, the floor is refracted: the frame behind the water is resampled along each
// pixel's normal, by an amount that grows with how much water the ray crosses.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, abs, smoothstep, clamp, texture, positionLocal, positionWorld,
  cameraPosition, normalize, dot, reflect, sin, cos, pow, exp, sqrt, select, length, mx_noise_float, uniform, frontFacing,
  fwidth, screenUV, viewportSharedTexture, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, cameraViewMatrix, positionView } from 'three/tsl';
import { gridUV } from './world.js';

export function createOcean(d, env, heightTex) {
  const u = env.u, waves = env.waves;
  const centre = uniform(new THREE.Vector3());
  // significant wave height of the bank at wind 1: 4 x the standard deviation of the surface
  const Hs = 4 * Math.sqrt(waves.filter(w => w.disp).reduce((a, w) => a + w.a * w.a / 2, 0));
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
  // returns { dy, dx, dz: displacement, n: normal, jac: compression, v: slope variance the pixel cannot show },
  // with the swell and chop growing as the water shoals and dying where it breaks
  const field = (x, z, depth, includeRipples, dist) => {
    let dy = float(0), dx = float(0), dz = float(0), dyc = float(0);
    let hx = float(0), hz = float(0), lost = float(0);
    let jxx = float(0), jzz = float(0), jxz = float(0);
    const shoal = float(1).add(float(0.7).mul(float(1).sub(smoothstep(0.6, 6, depth))));            // steepen toward shore
    const gate = smoothstep(0.0, 0.7, depth);                                        // gone on dry sand
    const Q = 0.85;
    // in the fragment the chop's slopes hand over from the nine waves that move the surface to the chop tile
    // (env.chopTile) between 40 and 200 m: the same slope statistics, but broadband, and mipmapped with range
    const tileW = includeRipples && env.chopTile ? smoothstep(40, 200, dist) : float(0);
    for (const w of waves) {
      if (!w.disp) continue;
      const ph = x.mul(w.dx * w.k).add(z.mul(w.dz * w.k)).sub(u.time.mul(w.w)).add(w.ph);
      const s = sin(ph), c = cos(ph);
      // a wave is only drawn while it is resolved: in the mesh while the rings (about 0.07 r apart) sample it
      // at least twice; in the shading while its phase moves less than about a radian from one pixel to the
      // next (fwidth: right at any distance and any grazing angle). The slope it carried then goes into the
      // variance the glitter spreads over
      const fade = includeRipples ? clamp(float(1.6).sub(fwidth(ph).mul(0.55)), 0, 1) : clamp(float(1).sub(dist.div(w.lam * 7)), 0, 1);
      const full = float(w.a).mul(shoal).mul(gate).mul(u.wind), amp = full.mul(fade);
      const chop = includeRipples && env.chopTile && w.lam < 20;
      if (includeRipples && !chop) lost = lost.add(full.mul(w.k).pow(2).mul(float(1).sub(fade.mul(fade))).mul(0.5));
      const ns = chop ? amp.mul(float(1).sub(tileW)) : amp;
      dy = dy.add(amp.mul(s));
      if (w.lam < 20) dyc = dyc.add(amp.mul(s));
      hx = hx.add(ns.mul(w.k * w.dx).mul(c));
      hz = hz.add(ns.mul(w.k * w.dz).mul(c));
      const qa = amp.mul(Q);
      dx = dx.add(qa.mul(c).mul(w.dx)); dz = dz.add(qa.mul(c).mul(w.dz));
      const qk = qa.mul(w.k).mul(s);
      jxx = jxx.add(qk.mul(w.dx * w.dx)); jzz = jzz.add(qk.mul(w.dz * w.dz)); jxz = jxz.add(qk.mul(w.dx * w.dz));
    }
    if (includeRipples && env.chopTile) {
      const C = env.chopTile(vec2(x, z)), cw = tileW.mul(shoal).mul(gate);
      hx = hx.add(C.g.x.mul(cw)); hz = hz.add(C.g.y.mul(cw));
      lost = lost.add(C.v.mul(cw.mul(cw)));
    }
    if (includeRipples) {
      const R = env.ripple(vec2(x, z)), rg = gate.max(0.35);
      hx = hx.add(R.g.x.mul(rg)); hz = hz.add(R.g.y.mul(rg));
      lost = lost.add(R.v.mul(rg.mul(rg)));
    }
    const jac = float(1).sub(jxx).mul(float(1).sub(jzz)).sub(jxz.mul(jxz));
    return { dy, dyc, dx, dz, n: normalize(vec3(hx.negate(), 1, hz.negate())), jac, v: lost };
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
    // whitecaps: where the crests compress the water most, streaked by noise; the threshold follows the wind so the
    // covered share stays near Monahan and O'Muircheartaigh's (1980) 3.84e-6 U^3.41 (about 1% at 10 m/s)
    const streak = smoothstep(0.15, 0.75, mx_noise_float(vec3(P.x.mul(0.35), P.z.mul(1.1), u.time.mul(0.15))).mul(0.5).add(0.5));
    const comp = float(1).sub(smoothstep(u.wind.mul(0.25).sub(0.05), u.wind.mul(0.25).add(0.12), f.jac)).mul(streak).mul(smoothstep(0.1, 1.0, depth)).mul(smoothstep(0.15, 0.5, u.wind));
    const swashFoam = smoothstep(0.0, 0.02, wl).mul(float(1).sub(smoothstep(0.05, 0.22, wl))).mul(smoothstep(-0.2, 0.5, lace.add(0.25)));
    // breakers: a wave breaks once its height passes 0.78 of the depth (McCowan 1894); the foam rides the crests
    // that have broken (where the surface stands high), so it moves in with the waves instead of sitting still
    const Hl = float(Hs).mul(u.wind).mul(1.7), Hb = Hl.div(0.78);
    const crestUp = smoothstep(Hl.mul(0.12), Hl.mul(0.4), f.dy);
    const brk = float(1).sub(smoothstep(Hb.mul(0.6), Hb, depth)).mul(smoothstep(0.05, 0.2, depth)).mul(crestUp).mul(smoothstep(-0.3, 0.6, lace));
    const foam = clamp(comp.add(swashFoam.mul(0.95)).add(brk.mul(0.55).mul(u.wind)), 0, 1);

    const Fr = (n, v) => float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(n, v), 0)), 5)));
    // ---- from above
    const R = reflect(V.negate(), N).toVar();
    R.assign(vec3(R.x, abs(R.y), R.z));
    const F = Fr(N, V);
    const foamCol = vec3(0.92, 0.95, 0.96).mul(u.white.mul(0.85).add(0.1));
    const haze = float(1).sub(exp(dist.mul(u.haze).negate()));
    // light scattered back out of the swell: turquoise glow in thin crests and the shallows
    // (the wind waves' thin crests close by: the long, low swell does not light up like this)
    const crest = smoothstep(0.0, 0.5, f.dyc.mul(1.6)).mul(u.wind).mul(smoothstep(1.0, 4.0, depth)).mul(smoothstep(250, 60, dist));
    const glow = vec3(0.02, 0.18, 0.2).mul(u.white).mul(crest);
    const refl = mix(env.skyRefl(R).mul(0.85), env.sky(normalize(vec3(V.x.negate(), 0.04, V.z.negate()))), haze.mul(0.6));
    // sun glitter (Cox and Munk 1954): the facets that send the sun to the eye have the half-vector as their
    // normal; their share is the Gaussian slope density of what the pixel cannot resolve, around the slope it can.
    // radiance = E_sun F p / (4 cos(view) cos^4(facet tilt))
    const Hh = normalize(V.add(u.sunDir));
    const need = vec2(Hh.x, Hh.z).div(Hh.y.max(0.05)).negate(), have = vec2(N.x, N.z).div(N.y).negate();
    const sig2 = f.v.add(env.rippleAmp.mul(env.rippleAmp).mul(0.002)).max(1.5e-4);
    const dd = need.sub(have);
    const pS = exp(dot(dd, dd).div(sig2).negate()).div(sig2.mul(3.14159));
    const hy = Hh.y.max(0.05);
    const glint = u.sunCol.mul(u.sunI).mul(Fr(Hh, V)).mul(pS).div(V.y.max(0.03).mul(4).mul(hy.mul(hy).mul(hy).mul(hy)))
      .mul(smoothstep(-0.02, 0.04, u.sunDir.y)).mul(float(1).sub(haze));
    // the floor through the water, bent by the surface: resample the frame behind along the view-space normal,
    // by an amount that grows with the water the ray crosses; keep the straight sample where the bent one
    // would pick up something in front of the water (a hull, a swimmer)
    const Nv = cameraViewMatrix.mul(vec4(N, 0)).xyz;
    const zS = positionView.z;
    const zB0 = perspectiveDepthToViewZ(viewportDepthTexture(screenUV).x, cameraNear, cameraFar);
    const thick = zS.sub(zB0).max(0);
    const shift = vec2(Nv.x, Nv.y).mul(clamp(thick, 0, 4).mul(0.11).div(zS.negate().max(1))).clamp(-0.04, 0.04);
    const uvR = screenUV.add(shift);
    const zB = perspectiveDepthToViewZ(viewportDepthTexture(uvR).x, cameraNear, cameraFar);
    const uvB = select(zB.lessThan(zS), uvR, screenUV);
    const behind = viewportSharedTexture(uvB).rgb;
    let above_c = mix(behind, refl, F.mul(edge)).add(glint.mul(edge)).add(glow.mul(edge)).toVar();
    above_c.assign(mix(above_c, foamCol, foam.mul(edge)));
    // ---- from below: Snell's window and total internal reflection (n = 1.34)
    const nd = N.negate();
    const I = V.negate();
    const cosi = max(dot(nd, I).negate(), 0);
    const eta = float(1.34);
    const k = float(1).sub(eta.mul(eta).mul(float(1).sub(cosi.mul(cosi))));
    const T = I.mul(eta).add(nd.mul(eta.mul(cosi).sub(sqrt(max(k, 0)))));
    // the window's edge is as ragged as the slopes the pixel averages over
    const ww = sqrt(f.v).mul(1.5).add(0.04);
    const window = smoothstep(ww.negate().mul(0.5), ww, k);
    const skyT = env.sky(normalize(T)).mul(0.98);
    // beyond the window the surface is a mirror of the water below it: it shows the light field looking
    // down along the mirrored ray, dimmer the steeper that ray (env.waterBg)
    const dC = u.tide.sub(cameraPosition.y).max(0);
    const Rm = reflect(I, nd);                               // the mirrored ray, down into the water
    const mirror = env.medium(env.waterBg(dC, Rm.y.min(0)), P);
    const under_rgb = mix(mirror, env.medium(skyT, P), window);
    // ?odbg=1 glitter, 2 foam, 3 the refracted frame, 4 the unresolved slope variance (x 20), 5 normal, 6 height, 7 reflection
    const dbg = { 1: glint, 2: vec3(foam), 3: behind, 4: vec3(f.v.mul(20)), 5: N.mul(0.5).add(0.5), 6: vec3(f.dy.mul(2).add(0.5)), 7: refl.mul(F) }[new URLSearchParams(location.search).get('odbg')];
    if (dbg) return vec4(dbg, 1);
    return select(above, vec4(above_c, float(1)), vec4(under_rgb, float(1)));
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  function update(cam) { centre.value.set(cam.x, 0, cam.z); }
  return { mesh, update, material: mat };
}
