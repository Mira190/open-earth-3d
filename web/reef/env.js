// The shared physical environment of the reef viewer: sun and sky, the wave spectrum, and the
// water column. Every material in the scene takes the same `medium()` as its fog node, so a
// coral, a fish, a diver and the sea floor are all lit, absorbed and veiled by the same water.
//
// The water column follows the model the build inverts (pipeline/build_marine.py):
//   floor seen through water  R = A e^(-K (Lw + m z)) + Rinf (1 - e^(-K (Lw + m z)))
// with Lw the view path inside the water, z the floor's depth and m the sun's slant factor.
// Rinf and K come from the Sentinel-2 imagery, so a render from above reproduces the satellite.
import * as THREE from 'three/webgpu';
import { coxMunk, windSpeed } from './ripples.js';
import { Fn, uniform, float, vec2, vec3, vec4, exp, max, min, abs, mix, length, normalize, dot, select,
  sin, cos, pow, clamp, smoothstep, sqrt, positionWorld, cameraPosition, texture, mx_noise_float } from 'three/tsl';

const TAU = Math.PI * 2;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- the wave spectrum: swell and wind chop as a sum of Gerstner waves (these move the surface,
// the boats and the swimmer); the ripples are a periodic tile in ripples.js.
// Each wave is a direction, a wavelength and a slope (a k); the amplitude follows from them.
export function makeWaves(windDeg = 120, sheltered = 0.5) {
  seed = 7;
  const bands = [
    { n: 4, l: [38, 90], slope: [0.010, 0.018], spread: 25, disp: true },   // swell (sheltered inside the outer reef)
    { n: 9, l: [3, 18], slope: [0.035, 0.060], spread: 60, disp: true }     // wind chop
  ];
  const waves = [];
  for (const b of bands) {
    for (let i = 0; i < b.n; i++) {
      const t = (i + rnd() * 0.8) / b.n;
      const lam = b.l[0] * Math.pow(b.l[1] / b.l[0], t);
      const k = TAU / lam, ang = (windDeg + (rnd() * 2 - 1) * b.spread) * Math.PI / 180;
      const s = (b.slope[0] + rnd() * (b.slope[1] - b.slope[0])) * (b.disp ? sheltered * 2 : 1);
      waves.push({ dx: -Math.sin(ang), dz: Math.cos(ang), k, w: Math.sqrt(9.81 * k), a: s / k, ph: rnd() * TAU, disp: b.disp, lam });
    }
  }
  return waves;
}

export function createEnv(scene, optics, waves, ripples, chop) {
  const u = {
    time: uniform(0),
    sunDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5).normalize()),
    sunAlt: uniform(0.8),
    tide: uniform(0),
    K: uniform(new THREE.Vector3(...optics.K)),
    Rinf: uniform(new THREE.Vector3(...optics.Rinf)),
    white: uniform(1),            // radiance of a white horizontal surface, in the lights' units
    lightPath: uniform(1.3),      // slant factor m for light reaching depth
    haze: uniform(3.5e-5),
    zenith: uniform(new THREE.Color(0.10, 0.28, 0.62)),
    horizon: uniform(new THREE.Color(0.62, 0.76, 0.88)),
    sunCol: uniform(new THREE.Color(1, 0.95, 0.85)),
    night: uniform(0),
    moonDir: uniform(new THREE.Vector3(0, -1, 0)),
    moonLit: uniform(0),
    wind: uniform(0.5),
    caustic: uniform(1),
    sunI: uniform(2.8),           // the sun's irradiance on a surface facing it, in the lights' units
    moonI: uniform(0),            // the same for the moon (2.3e-6 of the sun when full and overhead)
    skyScale: uniform(1),         // the sky's brightness relative to a clear day (twilight, night)
    adapt: uniform(1),            // the eye's adaptation, already in the lights (main.js); post.js reads it for night vision
    torchOn: uniform(0), torchFwd: uniform(new THREE.Vector3(0, 0, -1))   // a diver's torch at night (main.js)
  };
  // the ripples scale with the wind as the Cox-Munk slope variance does (unity at wind 0.6)
  const c0 = coxMunk(windSpeed(0.6));
  const rippleAmp = coxMunk(windSpeed(0)) / c0, rippleAmpW = 0.00512 * 11 / c0;
  const fw = sqrt(u.wind.mul(rippleAmpW).add(rippleAmp));
  const ripple = (xz, opts) => ripples.sample(xz, fw, opts);
  const chopTile = chop ? (xz => chop.sample(xz, u.wind, { hess: false })) : null;

  // ---- sky: gradient, sun glow, tropical cumulus; the same function colours the dome and the
  // reflection on the water
  const skyFn = disc => Fn(([dir]) => {
    const up = clamp(dir.y, 0, 1);
    const g = pow(float(1).sub(up), 3.2);
    let c = mix(u.zenith, u.horizon, g).toVar();
    const mu = max(dot(dir, u.sunDir), 0);
    c.addAssign(u.sunCol.mul(disc ? pow(mu, 8).mul(0.18).add(pow(mu, 200).mul(2.5)).add(pow(mu, 3000).mul(40)) : pow(mu, 8).mul(0.18).add(pow(mu, 200).mul(0.6))));
    // warm band near the sun when it is low
    const low = float(1).sub(clamp(u.sunAlt.mul(4), 0, 1));
    c.addAssign(vec3(1.0, 0.45, 0.2).mul(pow(mu, 4).mul(low).mul(0.9).mul(g.add(0.2))));
    // the sky's light through twilight to night, in true proportion and adapted (main.js); the moonlit sky a dim blue
    c = c.mul(u.skyScale).add(vec3(0.10, 0.16, 0.30).mul(u.moonI).mul(0.25).mul(smoothstep(-0.05, 0.2, u.moonDir.y))).toVar();
    // the moon (disc and halo) and the stars as an adapted eye sees them
    const mm = max(dot(dir, u.moonDir), 0);
    c.addAssign(vec3(0.85, 0.9, 1.0).mul(pow(mm, 1500).mul(disc ? 3 : 1.2).add(pow(mm, 40).mul(0.05)).mul(u.moonLit)).mul(smoothstep(-0.05, 0.1, u.moonDir.y)));
    const sp = dir.mul(160);
    const star = pow(max(mx_noise_float(sp.mul(1.0)).mul(0.5).add(0.5), 0), 40).mul(smoothstep(0.05, 0.4, dir.y));
    c.addAssign(vec3(0.9, 0.95, 1).mul(star.mul(u.night).mul(1.6)));
    return c;
  });
  // the dome; and the sky as the sea reflects it, whose sun is the glitter in ocean.js
  const sky = skyFn(true), skyRefl = skyFn(false);

  // ---- caustics: the sun's light focused by the wave field. A ray that crosses the surface where the
  // water's curvature is positive is bent toward its neighbours; the density of rays on the floor is
  // 1 / |det J|, with J = I - c D H (H the Hessian of the surface height, D the depth, c = 1 - 1/n).
  // The same wave bank as the surface, so the pattern follows the visible ripples and sharpens
  // with depth until the web of lines smears out.
  const causticAt = level => Fn(([P]) => {
    const D = u.tide.sub(P.y).max(0);
    const slant = sqrt(max(float(1).sub(u.sunDir.y.mul(u.sunDir.y)), 1e-4)).div(max(u.sunDir.y, 0.15)).mul(0.75); // tan of the refracted ray
    const sxz = vec2(u.sunDir.x, u.sunDir.z).div(sqrt(max(float(1).sub(u.sunDir.y.mul(u.sunDir.y)), 1e-4)));
    const xs = vec2(P.x, P.z).add(sxz.mul(D.mul(slant)));
    const R = ripple(xs, level === undefined ? {} : { level });
    let hxx = R.H.x, hzz = R.H.y, hxz = R.H.z;
    for (const w of waves) {
      if (w.lam > 20 || !w.disp) continue;
      const ph = xs.x.mul(w.dx * w.k).add(xs.y.mul(w.dz * w.k)).sub(u.time.mul(w.w)).add(w.ph);
      const m = sin(ph).mul(float(-w.a * w.k * w.k).mul(u.wind));
      hxx = hxx.add(m.mul(w.dx * w.dx)); hzz = hzz.add(m.mul(w.dz * w.dz)); hxz = hxz.add(m.mul(w.dx * w.dz));
    }
    const cD = D.mul(0.25);
    const det = float(1).sub(cD.mul(hxx)).mul(float(1).sub(cD.mul(hzz))).sub(cD.mul(cD).mul(hxz).mul(hxz));
    const I = clamp(float(1).div(abs(det).add(0.3)), 0, 3.2);
    const fadeD = exp(D.negate().div(11)).mul(smoothstep(0.0, 0.25, D));
    const sunUp = smoothstep(0.02, 0.25, u.sunDir.y);
    return mix(float(1), I.mul(0.62), fadeD.mul(0.85).mul(sunUp));
  });
  // per pixel (mip level from the screen), and at a fixed blur for the light-shaft march
  const caustic = causticAt(), causticSoft = causticAt(2.5);

  // ---- the light field under water, by direction. The satellite's Rinf is the water-leaving radiance seen
  // from above, as a fraction of a white surface (u.white). Just under the surface the upwelling radiance is
  // higher by the refraction and transmission of the surface: rrs = Rrs / (0.52 + 1.7 Rrs) (Lee et al. 2002),
  // about 1.9x for clear water. And the radiance is far from the same in every direction: in clear water the
  // horizontal radiance is roughly three times the nadir and the zenith (outside the sun) some tens of times
  // (the asymptotic distributions measured by Tyler 1960 and later). radiance(y) / nadir is fitted through
  // 1 at y = -1, 3 at y = 0 and 40 at y = +1 (y the sine of the elevation of the line of sight).
  const radiance = y => exp(float(1.1).add(y.mul(1.845)).add(y.mul(y).mul(0.745))).mul(1.9);
  // the background the water shows at depth d (m) along a direction with elevation sine y
  const waterBg = (d, y) => u.Rinf.mul(u.white).mul(exp(u.K.mul(d.mul(u.lightPath)).negate())).mul(radiance(y));

  // ---- water column
  // returns the colour of `col`, seen from the camera, after the air and the water between
  const medium = Fn(([col, P]) => {
    const C = cameraPosition;
    const d = P.sub(C), L = length(d).max(1e-3);
    const fc = u.tide.sub(C.y), fp = u.tide.sub(P.y);
    const both = fc.greaterThan(0).and(fp.greaterThan(0));
    const none = fc.lessThanEqual(0).and(fp.lessThanEqual(0));
    const frac = select(both, float(1), select(none, float(0), max(fc, fp).div(abs(fc.sub(fp)).max(1e-4))));
    const Lw = L.mul(frac), La = L.sub(Lw);
    const dP = fp.max(0), dC = fc.max(0);
    // light reaching the point, and the path from it to the eye
    const lightAtt = exp(u.K.mul(dP.mul(u.lightPath)).negate());
    const T = exp(u.K.mul(Lw).negate());
    // in-scatter along the path (closed form of the single-scatter integral)
    const nu = dP.sub(dC).div(Lw.max(1e-3));
    const g = float(1).add(u.lightPath.mul(nu)).max(0.15);
    const veil = u.Rinf.mul(u.white).mul(exp(u.K.mul(dC.mul(u.lightPath)).negate())).mul(float(1).sub(exp(u.K.mul(Lw).mul(g).negate())));
    // sunlit caustic modulation lives in the materials; the water only dims and veils
    // from under water the path radiance follows the light field's direction (radiance above); from
    // above the water it is what the satellite sees, so a render from above reproduces the imagery
    const boost = select(dC.greaterThan(0), radiance(d.y.div(L)), float(1));
    let out = col.mul(lightAtt).mul(T).mul(mix(float(1), caustic(P), select(dP.greaterThan(0), float(1), float(0)))).add(veil.mul(boost).mul(select(frac.greaterThan(0), float(1), float(0)))).toVar();
    // air: aerial perspective toward the sky colour
    const a = float(1).sub(exp(La.mul(u.haze).negate()));
    out.assign(mix(out, sky(normalize(d).mul(vec3(1, 0.4, 1)).normalize()).mul(0.9), a.mul(select(frac.lessThan(1), float(1), float(0)))));
    return out;
  });

  // the last reach of the swash: a little above the tide, breathing with the sets of waves
  const swash = u.tide.add(0.35).add(sin(u.time.mul(0.62)).mul(0.12)).add(sin(u.time.mul(0.23).add(1.3)).mul(0.1));
  // ---- a dive torch for night dives (from life/kit.js): an emissive term for materials, light(albedo). The medium
  // dims every colour by the sun's path down to the point and the path back to the eye; for torch light the first is
  // wrong, so it is swapped for the torch's own path out from the camera
  const torchLight = Fn(([alb]) => {
    const d = positionWorld.sub(cameraPosition), L = max(length(d), 0.05);
    const cone = smoothstep(0.65, 0.92, dot(d.div(L), u.torchFwd)).mul(0.85).add(0.15);
    const fall = float(1).div(L.mul(L).mul(0.12).add(1));
    const dP = max(u.tide.sub(positionWorld.y), 0);
    const comp = exp(u.K.mul(min(dP.mul(u.lightPath), 30).sub(L)));
    return alb.mul(u.torchOn.mul(cone).mul(fall).mul(2.2)).mul(comp);
  });
  const torch = { on: u.torchOn, fwd: u.torchFwd, light: torchLight };
  return { u, torch, sky, skyRefl, medium, radiance, waterBg, caustic, causticSoft, ripple, rippleAmp: fw, chopTile, waves, ripples, scene, swash };
}

// ---- the sun for the model's own clock
export function setSun(env, utcMs, lat, lon) {
  const S = window.Sun.position(utcMs, lat, lon);
  const alt = S.altitude * Math.PI / 180, az = S.azimuth * Math.PI / 180;
  // azimuth from north, clockwise; scene is x east, z south
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  const u = env.u;
  u.sunDir.value.copy(dir);
  u.sunAlt.value = Math.sin(alt);
  const day = THREE.MathUtils.smoothstep(Math.sin(alt), -0.08, 0.15);
  u.night.value = 1 - THREE.MathUtils.smoothstep(Math.sin(alt), -0.25, -0.02); // 1 at night
  const warm = 1 - THREE.MathUtils.smoothstep(Math.sin(alt), 0.05, 0.4);
  u.sunCol.value.setRGB(1, 0.96 - 0.35 * warm, 0.88 - 0.6 * warm);
  u.zenith.value.setRGB(0.10, 0.27, 0.62).multiplyScalar(0.25 + 0.75 * day);
  u.horizon.value.setRGB(0.60, 0.74, 0.86).lerp(new THREE.Color(0.95, 0.55, 0.35), warm * 0.55).multiplyScalar(0.2 + 0.8 * day);
  // the moon, to a few degrees: it trails the sun's hour angle by its phase (age/29.53 of a day)
  const SYN = 29.530588, JD = utcMs / 86400000 + 2440587.5;
  const age = ((JD - 2451550.1) / SYN % 1 + 1) % 1;                    // 0 new, 0.5 full
  const M = window.Sun.position(utcMs - age * 86400000, lat, lon);
  const ma = M.altitude * Math.PI / 180, maz = M.azimuth * Math.PI / 180;
  u.moonDir.value.set(Math.sin(maz) * Math.cos(ma), Math.sin(ma), -Math.cos(maz) * Math.cos(ma));
  u.moonLit.value = 0.5 - 0.5 * Math.cos(age * TAU);
  // light slant under water: Snell's law, n = 1.34
  const sinT = Math.cos(alt) / 1.34, cosR = Math.sqrt(1 - sinT * sinT);
  u.lightPath.value = 1 / Math.max(cosR, 0.3);
  return { alt, az, dir, day, moonAlt: ma, moonLit: u.moonLit.value, moonAge: age };
}
