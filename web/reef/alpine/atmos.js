// The air over an alpine site: a clear sky and the aerial perspective of the ranges, from one physical
// model, so a ridge 70 km away fades into exactly the sky behind it.
//
// Single scattering in an atmosphere of air molecules (Rayleigh) and aerosol (Mie), each thinning with height
// exponentially, over a spherical Earth, with an ozone layer for the blue of twilight. The parameters are the
// standard clear-sky ones (Bruneton and Neyret 2008, Hillaire 2020: Rayleigh 5.8, 13.6, 33.1 x 1e-6 /m at sea
// level, scale height 8 km; Mie scale height 1.2 km; ozone 0.65, 1.88, 0.085 x 1e-6 /m), with the Mie
// coefficient set for the very clear air of the Mackenzie Basin. No look-up tables are rendered: the column of air
// along a ray is closed form (an exponential atmosphere's optical depth is the Chapman function, here Schüler's
// 2012 approximation, extended below the horizon through the ray's lowest point), and the light reaching each
// stretch of the ray is the sun's light through the column above it. That keeps it one pass, the same on the
// WebGPU and WebGL2 paths. Multiple scattering is a single isotropic term.
//
// The sky dome (sky), the sky the lakes reflect (skyRefl) and the haze between the eye and any surface
// (aerial) all call the same functions; a CPU twin (sunColour, skyAmbient) sets the sun and sky lights.
// Heights are metres above the main lake (the viewer's y); `datum` is the lake's height above sea level.
import * as THREE from 'three/webgpu';
import { Fn, float, vec3, exp, max, min, sqrt, pow, clamp, dot, mix, smoothstep, normalize, abs, select, uniform, length,
  sin, cos, fract, floor, mx_noise_float, atan, asin, PI } from 'three/tsl';

const RE = 6371e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];  // per metre at sea level (Hillaire 2020's red, green, blue)
const H_R = 8000, H_M = 1200, H_O = 25000, W_O = 15000;
const BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];
const G_MIE = 0.78;
const MS = 0.12;                                  // multiple scattering, as a share of the single-scattered light, isotropic
// the photographic response: a landscape camera (and the eye) sees a clear sky bluer and brighter than three display
// primaries sampling the spectrum give it (green carries too much of Rayleigh's light at 550 nm). The sky and the
// air's veil take the same gain and tint, so a far ridge still fades into exactly the sky behind it. Set against
// photographs of the lake (docs/cities/lake-pukaki.md)
const PHOTO = [0.62, 0.86, 1.32], PHOTO_GAIN = 1.4;

export function createAtmos(opts) {
  const u = {
    datum: uniform(opts.datum || 0),
    betaM: uniform(opts.betaM ?? 2.2e-6),          // aerosol scattering at sea level, /m
    E0: uniform(2.8),                              // the sun's irradiance above the air, in the viewer's light units (adapted)
    Emoon: uniform(0),
    stars: uniform(0),                             // how much of the starry sky the adapted eye sees
    eq: uniform(new THREE.Matrix3()),              // local direction -> equatorial (J2000) unit vector
    twi: uniform(0),                               // the twilight sky's brightness once the sun is low or down (main.js)
  };
  const BR = vec3(...BETA_R), BO = vec3(...BETA_O);
  const BMs = u.betaM, BMe = u.betaM.mul(1.11);

  // the column of air (metres at sea-level density) from height h (asl) along direction cosine mu, for scale height Hs.
  // Above the horizon: Schüler's Chapman approximation; below: through the ray's lowest point and out again, or
  // effectively infinite when the ray meets the ground (the Earth's shadow)
  const chH = (X, mu) => { const c = sqrt(X.mul(Math.PI / 2)); return c.div(c.sub(1).mul(mu).add(1)); };
  const column = (h, mu, Hs) => {
    const r = h.add(RE), X = r.div(Hs);
    const up = float(Hs).mul(exp(h.negate().div(Hs))).mul(chH(X, abs(mu)));
    const s = sqrt(max(float(1).sub(mu.mul(mu)), 0));
    const ht = r.mul(s).sub(RE);                    // the lowest point of the ray
    const Xt = ht.add(RE).div(Hs);
    // (the exponent is held finite: where the ray meets the Earth the column is "infinite" anyway, and an
    // overflow here would turn the mix below into a NaN that blackens the frame)
    const tang = float(Hs).mul(exp(min(ht.negate().div(Hs), 30))).mul(sqrt(max(Xt, 0).mul(Math.PI / 2)));
    const down = min(tang.mul(2).sub(up), 3e7);
    const blocked = smoothstep(-200, 200, ht);      // 0 where the ray hits the Earth
    return select(mu.greaterThanEqual(0), up, mix(float(3e7), down, blocked));
  };
  const ozone = mu => float(W_O).div(sqrt(max(mu.mul(mu).add(0.0079), 1e-4)));
  const tau = (h, mu) => BR.mul(column(h, mu, H_R)).add(vec3(BMe.mul(column(h, mu, H_M)))).add(BO.mul(ozone(mu)));
  // the sun's (or moon's) light that reaches height h, as a fraction of what arrives above the air
  const trans = (h, dir) => exp(tau(h, dir.y).negate());
  const phaseR = nu => nu.mul(nu).add(1).mul(3 / (16 * Math.PI));
  const phaseM = nu => {
    const g = G_MIE, g2 = g * g;
    return float(3 * (1 - g2) / (8 * Math.PI * (2 + g2))).mul(nu.mul(nu).add(1)).div(pow(float(1 + g2).sub(nu.mul(2 * g)), 1.5));
  };

  // light scattered toward the eye along a stretch of air with columns dR, dM (metres at sea-level density),
  // T its transmittance, lit by a source of irradiance E from direction L reaching the stretch with transmittance
  // TsR (molecules' altitude) and TsM (aerosol's)
  const inscatter = (dR, dM, T, nu, E, TsR, TsM) => {
    const ext = BR.mul(dR).add(vec3(BMe.mul(dM))).max(1e-7);
    const single = BR.mul(dR).mul(phaseR(nu)).mul(TsR).add(vec3(BMs.mul(dM).mul(phaseM(nu))).mul(TsM));
    // (lit by the sun as the molecules' altitude sees it: the higher light of the second and later orders)
    const multi = BR.mul(dR).add(vec3(BMs.mul(dM))).mul(MS).mul(TsR);
    return single.add(multi).div(ext).mul(float(1).sub(T)).mul(E).mul(vec3(...PHOTO).mul(PHOTO_GAIN));
  };

  // ---- the sky in a direction, from the eye at height y (viewer frame)
  const skyFn = disc => Fn(([dir, y, sunDir, moonDir]) => {
    const h0 = max(y.add(u.datum), 0);
    const mu = max(dir.y, -0.03);
    const dR = column(h0, mu, H_R), dM = column(h0, mu, H_M);
    const T = exp(BR.mul(dR).add(vec3(BMe.mul(dM))).add(BO.mul(ozone(mu))).negate());
    const lift = max(mu, 0);
    const hR = h0.add(lift.mul(H_R)), hM = h0.add(lift.mul(H_M));
    let c = inscatter(dR, dM, T, dot(dir, sunDir), u.E0, trans(hR, sunDir), trans(hM, sunDir)).toVar();
    c.addAssign(inscatter(dR, dM, T, dot(dir, moonDir), u.Emoon, trans(hR, moonDir), trans(hM, moonDir)));
    c.addAssign(twilight(dir, sunDir));
    if (disc) {
      // the sun: 0.27 degrees across, limb-darkened, through the air in front of it
      const cs = dot(dir, sunDir);
      const r = sqrt(max(float(1).sub(cs.mul(cs)), 0)).div(0.00466);
      const limb = sqrt(max(float(1).sub(r.mul(r)), 0)).mul(0.6).add(0.4);
      c.addAssign(T.mul(u.E0).mul(smoothstep(1.05, 0.95, r).mul(limb).mul(90)).mul(smoothstep(-0.02, 0.0, dir.y)).mul(select(cs.greaterThan(0), float(1), float(0))));
      // the moon's disc, lit by its phase (main.js gives moonLit)
      const cm = dot(dir, moonDir);
      const rm = sqrt(max(float(1).sub(cm.mul(cm)), 0)).div(0.0045);
      c.addAssign(T.mul(vec3(0.95, 0.93, 0.88)).mul(smoothstep(1.05, 0.95, rm)).mul(u.Emoon.mul(9000)).mul(smoothstep(-0.02, 0.0, dir.y)).mul(select(cm.greaterThan(0), float(1), float(0))));
      c.addAssign(T.mul(starfield(dir)).mul(u.stars).mul(smoothstep(-0.01, 0.05, dir.y)));
    }
    return c;
  });

  // ---- twilight: once the sun is near or under the horizon, single scattering from the low air goes dark while the
  // high air is still lit. Its pattern as photographed: a warm glow over the sun's point on the horizon, fading up into a
  // deep blue zenith (the ozone's Chappuis band), and opposite the sun the pink anti-twilight arch (the Belt of Venus)
  // over the blue-grey of the Earth's own shadow. Brightness follows the measured fall of skylight through twilight
  // (main.js skyLight, adapted), so dusk joins the day and the night without a step
  function twilight(dir, sunDir) {
    const e = max(dir.y, -0.02);
    const hd = normalize(vec3(dir.x, 0, dir.z).add(vec3(1e-5, 0, 0))), hs = normalize(vec3(sunDir.x, 0, sunDir.z).add(vec3(1e-5, 0, 0)));
    const cosA = dot(hd, hs);
    const low = smoothstep(0.1, -0.05, sunDir.y);            // the twilight pattern takes over as the sun goes
    const zen = vec3(0.07, 0.15, 0.44).mul(float(1).sub(e.mul(0.35)));
    const glow = vec3(1.0, 0.46, 0.17).mul(exp(e.div(-0.10))).mul(pow(cosA.mul(0.5).add(0.5), 3.0)).mul(smoothstep(-0.30, -0.02, sunDir.y).mul(1.8));
    const band = exp(e.sub(0.07).div(0.055).pow(2).negate()).mul(pow(float(0.5).sub(cosA.mul(0.5)), 2.0));
    const belt = vec3(0.62, 0.36, 0.44).mul(band).mul(smoothstep(-0.14, -0.01, sunDir.y));
    const shadow = vec3(0.10, 0.13, 0.24).mul(exp(e.div(-0.05))).mul(pow(float(0.5).sub(cosA.mul(0.5)), 2.0));
    return zen.add(glow).add(belt).add(shadow).mul(u.twi).mul(low.mul(0.85).add(0.15));
  }

  // ---- the night sky: the Milky Way as it lies across the southern sky, the Magellanic Clouds, and stars.
  // Positions are real (J2000 galactic pole and centre); brightness and texture are a model, not a survey
  const GAL = new THREE.Matrix3().set(   // equatorial (J2000) -> galactic, rows: galactic x (to the centre), y, z (north pole)
    -0.0548755604, -0.8734370902, -0.4838350155,
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762);
  const galU = uniform(GAL);
  const lmc = new THREE.Vector3(), smc = new THREE.Vector3();
  const radec = (ra, dec, v) => v.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  radec((5 + 23.6 / 60) / 12 * Math.PI, -69.75 * Math.PI / 180, lmc);
  radec((0 + 52.7 / 60) / 12 * Math.PI, -72.83 * Math.PI / 180, smc);
  const lmcU = uniform(lmc), smcU = uniform(smc);
  const hash3 = p => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
  function starfield(dir) {
    const e = u.eq.mul(dir);                         // equatorial unit vector
    const g = galU.mul(e);
    const b = asin(clamp(g.z, -1, 1));                // galactic latitude
    const l = atan(g.y, g.x);                         // galactic longitude, 0 at the centre
    // the band: a few degrees thick, wider and brighter toward the bulge in Sagittarius and Scorpius
    const width = float(0.10).add(exp(l.mul(l).div(-0.35)).mul(0.12));
    const band = exp(b.mul(b).div(width.mul(width)).negate());
    const bulge = exp(l.mul(l).div(-0.18)).mul(exp(b.mul(b).div(-0.03))).mul(1.6);
    // dust: the Great Rift and the Coalsack, as noise lanes along the plane
    const dust = smoothstep(0.15, 0.65, mx_noise_float(vec3(l.mul(6), b.mul(14), 3.1)).mul(0.5).add(0.5))
      .mul(exp(b.add(0.02).mul(b.add(0.02)).div(-0.004))).mul(0.85);
    const grain = mx_noise_float(e.mul(40)).mul(0.25).add(mx_noise_float(e.mul(110)).mul(0.12)).add(0.75);
    let mw = band.mul(0.55).add(bulge).mul(float(1).sub(dust)).mul(grain);
    const cloud = (c, s, k) => exp(float(1).sub(dot(e, c)).div(-s)).mul(k);
    mw = mw.add(cloud(lmcU, 0.0012, 0.55)).add(cloud(smcU, 0.0005, 0.35));
    const col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.86, 0.66), clamp(bulge.mul(0.8), 0, 1)).mul(mw).mul(0.11);
    // stars: one per cell of a direction grid, at a random place in it, brightness from a steep power law
    const cells = float(420);
    const p = e.mul(cells), ip = floor(p), fp = fract(p);
    const rnd = hash3(ip), rnd2 = hash3(ip.add(17.3)), rnd3 = hash3(ip.add(41.7));
    const centre = vec3(rnd, rnd2, rnd3).mul(0.7).add(0.15);
    const d = length(fp.sub(centre));
    const mag = pow(rnd3, 14).mul(4).add(pow(rnd, 40).mul(30));
    const tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.65), rnd2);
    const star = smoothstep(0.22, 0.0, d).mul(mag).mul(float(1).add(band.mul(2)));
    // and the natural glow of a dark sky (airglow and starlight, about 21.6 mag per square arcsecond here)
    return col.add(tint.mul(star).mul(1.6)).add(vec3(0.010, 0.012, 0.020));
  }

  // ---- the air between the eye C and a surface point P: returns col dimmed and veiled
  const aerial = Fn(([col, C, P, sunDir, moonDir]) => {
    const d = P.sub(C), L = length(d).max(0.1), v = d.div(L);
    const hC = max(C.y.add(u.datum), 0), hP = max(P.y.add(u.datum), 0);
    const dh = hP.sub(hC);
    const seg = Hs => {
      const a = exp(hC.negate().div(Hs)), b = exp(hP.negate().div(Hs));
      const flat = abs(dh).lessThan(1);
      return select(flat, L.mul(exp(hC.add(hP).mul(-0.5).div(Hs))), L.mul(Hs).mul(a.sub(b)).div(dh));
    };
    const dR = seg(H_R), dM = seg(H_M);
    const T = exp(BR.mul(dR).add(vec3(BMe.mul(dM))).negate());
    const hm = hC.add(hP).mul(0.5);
    const Ts = trans(hm, sunDir), Tm = trans(hm, moonDir);
    const veil = inscatter(dR, dM, T, dot(v, sunDir), u.E0, Ts, Ts).add(inscatter(dR, dM, T, dot(v, moonDir), u.Emoon, Tm, Tm));
    // after sunset the air between is lit by the twilight sky, not by the sun: it veils toward the twilight horizon,
    // or a far range would only lose its blue to the air and turn yellow
    const tw = twilight(normalize(vec3(v.x, max(v.y, 0.0), v.z)), sunDir).mul(float(1).sub(T.g));
    return col.mul(T).add(veil).add(tw.mul(0.9));
  });

  // ---- the CPU twin: the sun's colour and the sky's light at height y, for the scene's lights
  const tauCPU = (h, mu) => {
    const col = (Hs) => {
      const r = h + RE, X = r / Hs, c = Math.sqrt(X * Math.PI / 2);
      const up = Hs * Math.exp(-h / Hs) * c / ((c - 1) * Math.abs(mu) + 1);
      if (mu >= 0) return up;
      const ht = r * Math.sqrt(1 - mu * mu) - RE;
      if (ht < -200) return 3e7;
      const tang = Hs * Math.exp(-ht / Hs) * Math.sqrt((ht + RE) / Hs * Math.PI / 2);
      return 2 * tang - up;
    };
    const cR = col(H_R), cM = col(H_M), cO = W_O / Math.sqrt(Math.max(mu * mu + 0.0079, 1e-4));
    return [0, 1, 2].map(i => BETA_R[i] * cR + u.betaM.value * 1.11 * cM + BETA_O[i] * cO);
  };
  function sunColour(y, mu) {                         // transmittance of the direct sun to height y
    return tauCPU(Math.max(y + u.datum.value, 0), mu).map(t => Math.exp(-t));
  }
  // the sky's irradiance on a horizontal surface, as a fraction of the sun's above the air, in rgb: integrated
  // roughly over the dome (a few directions), for the hemisphere light
  function skyAmbient(y, sunMu) {
    const h0 = Math.max(y + u.datum.value, 0), out = [0, 0, 0];
    const Ts = sunColour(y + 2000, sunMu);
    for (const mu of [0.05, 0.3, 0.6, 0.9]) {
      const t = tauCPU(h0, mu), w = mu * 0.25 * 2 * Math.PI;   // cosine-weighted, 4 rings over the hemisphere
      for (let i = 0; i < 3; i++) {
        const ext = Math.max(t[i], 1e-7), sc = BETA_R[i] / (BETA_R[i] + u.betaM.value);
        out[i] += w * (1 - Math.exp(-ext)) * (sc * (1 / (4 * Math.PI)) * 1.6 + MS) * Ts[i];
      }
    }
    return out;
  }
  return { u, sky: skyFn(true), skyRefl: skyFn(false), aerial, trans, sunColour, skyAmbient, starfield };
}

// local (x east, y up, z south) -> equatorial J2000 unit vector, for the sky's rotation at a moment and place
export function equatorialMatrix(utcMs, lat, lon, m = new THREE.Matrix3()) {
  const JD = utcMs / 86400000 + 2440587.5, T = (JD - 2451545.0);
  const gmst = ((280.46061837 + 360.98564736629 * T) % 360 + 360) % 360;
  const lst = (gmst + lon) * Math.PI / 180, phi = lat * Math.PI / 180;
  // a local direction (east E, north N, up U) has hour angle / declination; equatorial x toward RA 0
  // a star at hour angle H (west +), declination d is (cos d cos H, -cos d sin H, sin d) in that frame, and RA = LST - H
  const sp = Math.sin(phi), cp = Math.cos(phi), sl = Math.sin(lst), cl = Math.cos(lst);
  // columns for local basis vectors in three.js terms: x = east, y = up, z = south (north = -z)
  const col = (E, U, N) => {
    const mx = -sp * N + cp * U, my = E, mz = cp * N + sp * U;    // the hour-angle frame: x the meridian's equator point, z the pole, y east
    return [cl * mx - sl * my, sl * mx + cl * my, mz];
  };
  const cx = col(1, 0, 0), cy = col(0, 1, 0), cz = col(0, 0, -1);
  m.set(cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]);
  return m;
}
