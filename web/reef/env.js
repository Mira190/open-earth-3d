// The shared physical environment of the reef viewer: sun and sky, the wave spectrum, and the
// water column. Every material in the scene takes the same `medium()` as its fog node, so a
// coral, a fish, a diver and the sea floor are all lit, absorbed and veiled by the same water.
//
// The water column follows the model the build inverts (pipeline/build_marine.py):
//   floor seen through water  R = A e^(-K (Lw + m z)) + Rinf (1 - e^(-K (Lw + m z)))
// with Lw the view path inside the water, z the floor's depth and m the sun's slant factor.
// Rinf and K come from the Sentinel-2 imagery, so a render from above reproduces the satellite.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, exp, max, min, abs, mix, length, normalize, dot, select,
  sin, cos, pow, clamp, smoothstep, sqrt, positionWorld, cameraPosition, texture } from 'three/tsl';

const TAU = Math.PI * 2;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- the wave spectrum: three bands, as in a cascaded ocean (swell, wind chop, ripples).
// Each wave is a direction, a wavelength and a slope (a k); the amplitude follows from them.
export function makeWaves(windDeg = 120, sheltered = 0.5) {
  seed = 7;
  const bands = [
    { n: 4, l: [38, 90], slope: [0.010, 0.018], spread: 25, disp: true },   // swell (sheltered inside the outer reef)
    { n: 8, l: [4, 18], slope: [0.035, 0.060], spread: 45, disp: true },    // wind chop
    { n: 10, l: [0.25, 1.6], slope: [0.07, 0.13], spread: 80, disp: false } // ripples: normals, caustics, glitter
  ];
  const waves = [];
  for (const b of bands) {
    for (let i = 0; i < b.n; i++) {
      const t = (i + rnd() * 0.8) / b.n;
      const lam = b.l[0] * Math.pow(b.l[1] / b.l[0], t);
      const k = TAU / lam, ang = (windDeg + (rnd() * 2 - 1) * b.spread) * Math.PI / 180;
      const s = (b.slope[0] + rnd() * (b.slope[1] - b.slope[0])) * (b.disp ? sheltered * 2 : 1);
      waves.push({ dx: Math.sin(ang), dz: Math.cos(ang), k, w: Math.sqrt(9.81 * k), a: s / k, ph: rnd() * TAU, disp: b.disp, lam });
    }
  }
  return waves;
}

export function createEnv(scene, optics, waves) {
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
    wind: uniform(0.5),
    caustic: uniform(1)
  };

  // ---- sky: gradient, sun glow, tropical cumulus; the same function colours the dome and the
  // reflection on the water
  const sky = Fn(([dir]) => {
    const up = clamp(dir.y, 0, 1);
    const g = pow(float(1).sub(up), 3.2);
    let c = mix(u.zenith, u.horizon, g).toVar();
    const mu = max(dot(dir, u.sunDir), 0);
    c.addAssign(u.sunCol.mul(pow(mu, 8).mul(0.18).add(pow(mu, 200).mul(2.5)).add(pow(mu, 3000).mul(40))));
    // warm band near the sun when it is low
    const low = float(1).sub(clamp(u.sunAlt.mul(4), 0, 1));
    c.addAssign(vec3(1.0, 0.45, 0.2).mul(pow(mu, 4).mul(low).mul(0.9).mul(g.add(0.2))));
    return c.mul(float(1).sub(u.night.mul(0.97)));
  });

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
    let out = col.mul(lightAtt).mul(T).add(veil.mul(select(frac.greaterThan(0), float(1), float(0)))).toVar();
    // air: aerial perspective toward the sky colour
    const a = float(1).sub(exp(La.mul(u.haze).negate()));
    out.assign(mix(out, sky(normalize(d).mul(vec3(1, 0.4, 1)).normalize()).mul(0.9), a.mul(select(frac.lessThan(1), float(1), float(0)))));
    return out;
  });

  // the last reach of the swash: a little above the tide, breathing with the sets of waves
  const swash = u.tide.add(0.35).add(sin(u.time.mul(0.62)).mul(0.12)).add(sin(u.time.mul(0.23).add(1.3)).mul(0.1));
  return { u, sky, medium, waves, scene, swash };
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
  // light slant under water: Snell's law, n = 1.34
  const sinT = Math.cos(alt) / 1.34, cosR = Math.sqrt(1 - sinT * sinT);
  u.lightPath.value = 1 / Math.max(cosR, 0.3);
  return { alt, az, dir, day };
}
