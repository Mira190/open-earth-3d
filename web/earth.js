// The title screen's Earth, as a camera in orbit would film it. By day, NASA's Blue Marble
// for this month (its snow and its vegetation); by night, the Black Marble's city lights.
// The clouds drift and cast their shadows, and the sun glints off the oceans. The
// atmosphere scatters the real sun (single scattering, Rayleigh and Mie), so the limb is
// blue by day and red at the terminator. The Milky Way and the bright stars of the Yale
// catalogue stand where they really are, and the Moon sits in its real place and phase.
// The frame goes through a lens: HDR bloom, an anamorphic flare when the sun is in shot,
// a neutral tone curve, a light grade, grain and a vignette.
//
// The globe frame is Earth-fixed and the Earth's radius is 1:
// x = cos(lat) cos(lon), y = sin(lat), z = -cos(lat) sin(lon), as in SphereGeometry's UVs.
// The textures are built by pipeline/fetch_earth.py.
'use strict';
window.OEEarth = (function () {
  const RAD = Math.PI / 180;
  const ATMO = 1.036, CLOUD = 1.0045, MOON_D = 60.27, MOON_R = 0.2727;
  const ll = (lat, lon, r = 1, out = new THREE.Vector3()) =>
    out.set(r * Math.cos(lat * RAD) * Math.cos(lon * RAD), r * Math.sin(lat * RAD), -r * Math.cos(lat * RAD) * Math.sin(lon * RAD));
  const latlon = v => { const r = v.length(); return { lat: Math.asin(v.y / r) / RAD, lon: Math.atan2(-v.z, v.x) / RAD }; };
  // Greenwich mean sidereal time in degrees: how far the Earth has turned under the stars
  const gmst = utcMs => (((280.46061837 + 360.98564736629 * (utcMs / 864e5 - 10957.5)) % 360) + 360) % 360;
  // a low-precision lunar ephemeris (after Meeus, as in game/atmosphere.js): RA and Dec in radians
  function moonRaDec(utcMs) {
    const d = utcMs / 864e5 - 10957.5, e = 23.4397 * RAD;
    const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.229350 * d) * RAD;
    const lon = L + 6.289 * RAD * Math.sin(M), lat = 5.128 * RAD * Math.sin(F);
    return { ra: Math.atan2(Math.sin(lon) * Math.cos(e) - Math.tan(lat) * Math.sin(e), Math.cos(lon)),
      dec: Math.asin(Math.sin(lat) * Math.cos(e) + Math.cos(lat) * Math.sin(e) * Math.sin(lon)) };
  }
  // J2000 equatorial (x to RA 0, z to the north celestial pole) to galactic (x to the galactic centre)
  const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];

  // sunlight through the air to a point where the sun stands at cos(zenith) mu: Kasten and
  // Young's air mass, a Rayleigh optical depth and a little aerosol
  const SUNLIGHT = `
    vec3 sunlight(float mu) {
      float z = degrees(acos(clamp(mu, -1.0, 1.0)));
      // the formula holds a little past the horizon (cloud tops still see the sun), where the
      // air mass climbs to the hundreds and only red gets through; beyond that, nothing
      float m = 1.0 / max(mu + 0.50572 * pow(max(96.07995 - z, 0.35), -1.6364), 0.004);
      return exp(-m * vec3(0.03, 0.068, 0.16)) * smoothstep(-0.07, -0.01, mu);
    }`;

  const EARTH_VS = `varying vec2 vUv; varying vec3 vPos;
    void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const EARTH_FS = `
    uniform sampler2D uDay; uniform sampler2D uSurf; uniform sampler2D uClouds; uniform sampler2D uLightsMap;
    uniform vec3 uSun; uniform vec3 uCam; uniform vec2 uTexel; uniform vec2 uLightsTexel;
    uniform float uSunE; uniform float uLights; uniform float uCloudU; uniform float uCloudH; uniform float uRelief; uniform float uReady;
    uniform vec3 uFocus; uniform float uFocusAmt; uniform float uTime;
    varying vec2 vUv; varying vec3 vPos;
    ${SUNLIGHT}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    // a cubic B-spline lookup from four bilinear taps: the lights' 10 km texels come out round, not square
    float bicubicR(sampler2D t, vec2 uv, vec2 size) {
      vec2 st = uv * size - 0.5, i = floor(st), f = fract(st);
      vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
      vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0, w3 = f * f * f / 6.0;
      vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (w1 / g0 - 1.0 + i + 0.5) / size, h1 = (w3 / g1 + 1.0 + i + 0.5) / size;
      return g0.y * (g0.x * texture2D(t, vec2(h0.x, h0.y)).r + g1.x * texture2D(t, vec2(h1.x, h0.y)).r) +
             g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)).r + g1.x * texture2D(t, vec2(h1.x, h1.y)).r);
    }
    void main() {
      vec3 N0 = normalize(vPos);
      vec3 V = normalize(uCam - vPos);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N0) + vec3(0.0, 0.0, 1e-5));
      vec3 north = cross(N0, east);
      float coslat = max(length(N0.xz), 0.04);
      vec4 s = texture2D(uSurf, vUv);
      // relief: the slope of the elevation, east and north
      float hx = texture2D(uSurf, vUv + vec2(uTexel.x, 0.0)).b - texture2D(uSurf, vUv - vec2(uTexel.x, 0.0)).b;
      float hy = texture2D(uSurf, vUv + vec2(0.0, uTexel.y)).b - texture2D(uSurf, vUv - vec2(0.0, uTexel.y)).b;
      vec2 slope = uRelief * vec2(hx / coslat, hy);
      slope *= min(1.0, 0.6 / max(length(slope), 1e-4)); // no tilt past ~30 degrees
      vec3 N = normalize(N0 - slope.x * east - slope.y * north);
      float water = smoothstep(0.3, 0.7, s.g);
      vec3 day = pow(texture2D(uDay, vUv).rgb, vec3(2.2));
      day = mix(day, mix(vec3(dot(day, vec3(0.3, 0.5, 0.2))), day, 0.75) * vec3(0.34, 0.44, 0.6), water); // the open ocean reads darker and greyer from orbit
      day = mix(vec3(dot(day, vec3(0.2126, 0.7152, 0.0722))), day, 0.82);
      float mu0 = dot(N0, uSun), mu = dot(N, uSun);
      vec3 sunC = sunlight(mu0);
      // the clouds over this point, and the cloud that stands between it and the sun
      vec2 cuv = vec2(vUv.x + uCloudU, vUv.y);
      float cl = texture2D(uClouds, cuv).r;
      vec3 st = uSun - N0 * mu0;
      vec2 toSun = vec2(dot(st, east) / coslat / 6.2831853, dot(st, north) / 3.1415927) * (uCloudH / max(mu0, 0.12));
      float shade = texture2D(uClouds, cuv + toSun).r;
      float diffuse = max((mu + 0.03) / 1.03, 0.0) * smoothstep(-0.06, 0.04, mu0); // relief can't light the night side
      vec3 col = day * sunC * diffuse * uSunE * (1.0 - 0.62 * smoothstep(0.1, 0.8, shade));
      // the sun's glint on open water, rough enough to spread with the wind
      vec3 H = normalize(uSun + V);
      float nh = max(dot(N0, H), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N0, V), 0.0), 5.0);
      float glint = pow(nh, 1400.0) * 7.0 + pow(nh, 200.0) * 0.55 + pow(nh, 18.0) * 0.035;
      col += sunC * glint * (0.35 + fres) * water * (1.0 - cl) * smoothstep(0.0, 0.1, mu0) * uSunE;
      col += vec3(0.05, 0.12, 0.25) * fres * water * smoothstep(-0.05, 0.2, mu0) * uSunE * 0.25;
      // night: the lights, warm sodium in the suburbs, whiter in the cores, dimmed under cloud
      float night = 1.0 - smoothstep(-0.11, 0.02, mu0);
      float L = uLightsTexel.x < 0.0002 ? texture2D(uLightsMap, vUv).r : bicubicR(uLightsMap, vUv, 1.0 / uLightsTexel); // the 8K map is sharp enough as it is
      // seen close, a lit texel is a cluster of lights, not a glow: where texels are bigger than a
      // pixel and a half, break them up with noise whose cells stay about that size on screen
      vec2 base = vUv / uLightsTexel;
      float fw = length(fwidth(base));
      float lv = log2(max(1.0 / (1.5 * fw), 1.0));
      if (lv > 0.0 && L > 0.002) {
        float l0 = floor(lv), fr = lv - l0;
        float n = mix(vnoise(base * exp2(l0) + 7.3), vnoise(base * exp2(l0 + 1.0) + 13.1), fr);
        float sparkle = smoothstep(0.42, 0.95, n) * 3.2 + 0.04;
        L *= mix(1.0, sparkle, smoothstep(0.0, 1.2, lv) * (1.0 - 0.3 * smoothstep(0.55, 1.0, L))); // the source clips city cores flat: keep some texture there too
      }
      vec3 lights = mix(vec3(1.0, 0.44, 0.13), vec3(1.0, 0.7, 0.4), smoothstep(0.35, 0.95, L)) * pow(L, 2.1) * 1.35;
      vec3 lit = lights * uLights;
      col += lit / (1.0 + 0.6 * lit) * night * (1.0 - 0.75 * cl); // soft-clipped, so a city glows rather than blows out
      col += day * 0.0012 * night; // earthshine and the moon
      // a survey reticle round the chosen city: rings at 100, 250 and 500 km
      if (uFocusAmt > 0.001) {
        float a = acos(clamp(dot(N0, uFocus), -1.0, 1.0)) * 6371.0;
        float w = fwidth(a) * 1.2;
        float ring = 0.0;
        ring += 1.0 - smoothstep(0.0, w, abs(a - 100.0));
        ring += 0.7 * (1.0 - smoothstep(0.0, w, abs(a - 250.0)));
        ring += 0.45 * (1.0 - smoothstep(0.0, w, abs(a - 500.0)));
        float sweep = smoothstep(0.0, 0.2, fract(uTime * 0.35 - a / 700.0)) * (1.0 - smoothstep(0.0, 700.0, a));
        col += vec3(1.0, 0.7, 0.35) * (ring * 0.7 + sweep * 0.05) * uFocusAmt;
      }
      gl_FragColor = vec4(col * uReady, 1.0);
    }`;

  const CLOUD_FS = `
    uniform sampler2D uClouds; uniform vec3 uSun; uniform vec3 uCam; uniform float uCloudU; uniform float uSunE; uniform float uReady;
    varying vec2 vUv; varying vec3 vPos;
    ${SUNLIGHT}
    void main() {
      vec3 N = normalize(vPos);
      float c = texture2D(uClouds, vec2(vUv.x + uCloudU, vUv.y)).r;
      float a = smoothstep(0.05, 0.85, c);
      vec3 V = normalize(uCam - vPos);
      a = min(1.0, a * (1.0 + 0.6 * pow(1.0 - max(dot(N, V), 0.0), 3.0))); // thicker seen edge-on
      float mu = dot(N, uSun);
      float lit = smoothstep(-0.08, 0.12, mu) * (0.45 + 0.55 * max(mu, 0.0));
      vec3 col = vec3(0.96, 0.98, 1.0) * sunlight(mu + 0.015) * lit * uSunE * 0.86 + vec3(0.0008, 0.001, 0.0016);
      a *= uReady;
      gl_FragColor = vec4(col * a, a);
    }`;

  // single scattering through a spherical shell, marched from the camera (or where the ray
  // enters the air) to the ground or out of the air again; jittered per pixel so the steps
  // show as grain rather than bands
  const ATMO_VS = `varying vec3 vWorld;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const ATMO_FS = `
    uniform vec3 uSun; uniform vec3 uCam; uniform vec3 uBetaR; uniform float uBetaM; uniform float uHR; uniform float uHM;
    uniform float uG; uniform float uSunE; uniform float uGain; uniform float uSunDisc;
    varying vec3 vWorld;
    const float RP = 1.0; const float RA = ${ATMO.toFixed(4)};
    vec2 hitSphere(vec3 ro, vec3 rd, float r) {
      float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
      if (d < 0.0) return vec2(1e9, -1e9);
      d = sqrt(d);
      return vec2(-b - d, -b + d);
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 rd = normalize(vWorld - uCam);
      vec2 ta = hitSphere(uCam, rd, RA);
      if (ta.y < 0.0 || ta.x > ta.y) discard;
      vec2 tp = hitSphere(uCam, rd, RP);
      float t0 = max(ta.x, 0.0), t1 = ta.y;
      if (tp.x > 0.0 && tp.x < tp.y) t1 = min(t1, tp.x);
      const int N = 14; const int NL = 6;
      float ds = (t1 - t0) / float(N);
      float j = hash(gl_FragCoord.xy);
      vec3 sumR = vec3(0.0), sumM = vec3(0.0);
      float odR = 0.0, odM = 0.0;
      for (int i = 0; i < N; i++) {
        vec3 p = uCam + rd * (t0 + ds * (float(i) + j));
        float h = length(p) - RP;
        float dR = exp(-h / uHR) * ds, dM = exp(-h / uHM) * ds;
        odR += dR; odM += dM;
        // the earth's shadow: no sun where the ray to it runs into the ground
        vec2 tg = hitSphere(p, uSun, RP);
        if (tg.x > 0.0 && tg.x < tg.y) continue;
        float tl = hitSphere(p, uSun, RA).y, dl = tl / float(NL), lR = 0.0, lM = 0.0;
        for (int k = 0; k < NL; k++) {
          float hq = length(p + uSun * dl * (float(k) + 0.5)) - RP;
          lR += exp(-hq / uHR) * dl; lM += exp(-hq / uHM) * dl;
        }
        vec3 att = exp(-(uBetaR * (odR + lR) + uBetaM * 1.11 * (odM + lM)));
        sumR += att * dR; sumM += att * dM;
      }
      float mu = dot(rd, uSun), g = uG;
      float pR = 0.0596831 * (1.0 + mu * mu);
      float pM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
      vec3 col = uSunE * uGain * (sumR * uBetaR * pR + sumM * uBetaM * pM);
      vec3 tr = exp(-(uBetaR * odR + uBetaM * 1.11 * odM));
      // the sun itself, where the ray clears the ground: reddened and dimmed by the air it crosses
      if (!(tp.x > 0.0 && tp.x < tp.y)) {
        float ang = acos(clamp(mu, -1.0, 1.0));
        float disc = 1.0 - smoothstep(0.0042, 0.0052, ang);
        float glow = exp(-ang * 90.0) * 0.05 + exp(-ang * 14.0) * 0.004;
        col += vec3(1.0, 0.96, 0.9) * (disc + glow) * uSunDisc * tr;
      }
      col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.82); // the limb's colours, a little less printed
      gl_FragColor = vec4(col, 1.0 - dot(tr, vec3(0.3333)));
    }`;

  // the sky at infinity: the Milky Way in galactic coordinates, and the sun's disc and glow
  const SKY_VS = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const SKY_FS = `
    uniform sampler2D uMW; uniform mat3 uGal; uniform vec3 uSun; uniform float uMWI; uniform float uSunDisc; uniform float uReady; uniform vec3 uCam;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float b = dot(uCam, d), c = dot(uCam, uCam) - ${(ATMO * ATMO).toFixed(5)};
      float inAir = (b * b - c > 0.0 && (-b + sqrt(max(b * b - c, 0.0))) > 0.0) ? 1.0 : 0.0;
      vec3 g = uGal * d;
      vec2 uv = vec2(fract(0.5 - atan(g.y, g.x) / 6.2831853), 0.5 + asin(clamp(g.z, -1.0, 1.0)) / 3.1415927);
      vec3 mw = pow(texture2D(uMW, uv).rgb, vec3(2.2)) * uMWI * uReady;
      float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
      float disc = 1.0 - smoothstep(0.0042, 0.0052, ang);
      float glow = exp(-ang * 90.0) * 0.05 + exp(-ang * 14.0) * 0.004;
      gl_FragColor = vec4(mw + vec3(1.0, 0.96, 0.9) * (disc + glow) * uSunDisc * (1.0 - inAir), 1.0);
    }`;

  const STAR_VS = `attribute float aSize; attribute vec3 aColor; uniform float uPx; uniform float uBright; varying vec3 vC;
    void main() { vC = aColor * uBright; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx; }`;
  const STAR_FS = `varying vec3 vC;
    void main() { vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; float a = exp(-r2 * 4.0) + 0.15 * exp(-r2 * 1.2); gl_FragColor = vec4(vC * a, 1.0); }`;

  const MOON_FS = `uniform vec3 uSun; uniform float uSunE; varying vec3 vN; varying vec3 vL;
    float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float n(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
    void main() {
      float maria = smoothstep(0.42, 0.7, n(vL * 2.2 + 3.0) * 0.65 + n(vL * 5.0) * 0.35);
      float alb = mix(0.16, 0.08, maria) * (0.85 + 0.3 * n(vL * 24.0));
      gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * alb * max(dot(normalize(vN), uSun), 0.0) * uSunE * 2.6, 1.0);
    }`;
  const MOON_VS = `varying vec3 vN; varying vec3 vL; void main() { vL = position * 4.0; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

  // a city: a shaft of light from the ground, and rings that pulse out over the surface
  const BEAM_VS = `attribute vec2 corner; uniform vec3 uBase; uniform vec3 uAxis; uniform float uH; uniform float uW; varying vec2 vC;
    void main() { vC = corner; vec3 toCam = normalize(cameraPosition - uBase); vec3 side = normalize(cross(uAxis, toCam)) * uW;
      gl_Position = projectionMatrix * viewMatrix * vec4(uBase + side * corner.x + uAxis * uH * corner.y, 1.0); }`;
  const BEAM_FS = `uniform vec3 uColor; uniform float uI; varying vec2 vC;
    void main() { float a = exp(-abs(vC.x) * 4.0) * pow(1.0 - vC.y, 3.0) * 0.35 + exp(-abs(vC.x) * 30.0) * pow(1.0 - vC.y, 1.4);
      gl_FragColor = vec4(uColor * a * uI, 1.0); }`;
  const RING_VS = `attribute vec2 corner; uniform vec3 uBase; uniform vec3 uAxis; uniform float uS; varying vec2 vC;
    void main() { vC = corner; vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), uAxis) + vec3(0.0, 0.0, 1e-5)); vec3 n = cross(uAxis, e);
      gl_Position = projectionMatrix * viewMatrix * vec4(uBase * 1.0006 + (e * corner.x + n * corner.y) * uS, 1.0); }`;
  const RING_FS = `uniform vec3 uColor; uniform float uI; uniform float uTime; varying vec2 vC;
    void main() { float r = length(vC); if (r > 1.0) discard; float w = fwidth(r) * 1.5;
      float ring = 0.0;
      for (int i = 0; i < 2; i++) { float k = fract(uTime * 0.45 + float(i) * 0.5); ring += (1.0 - smoothstep(0.0, w + 0.04, abs(r - k))) * (1.0 - k); }
      float core = exp(-r * r * 900.0) * 1.6 + (1.0 - smoothstep(0.0, w, abs(r - 0.12))) * 0.35;
      gl_FragColor = vec4(uColor * (ring * 0.28 + core) * uI, 1.0); }`;

  // the lens, after bloom: zoom blur for the dive, chromatic fringes at the edges, the flare
  // (an anamorphic streak, a halo and ghosts on the line through the centre), exposure, the
  // Khronos PBR Neutral tone curve, a light grade, then grain, a vignette and the fades
  const LENS = () => ({
    uniforms: {
      tDiffuse: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 }, uExposure: { value: 1 }, uFade: { value: 1 }, uFlash: { value: 0 },
      uCA: { value: 0.25 }, uGrain: { value: 0.045 }, uVignette: { value: 0.14 }, uZoom: { value: 0 },
      uSunUv: { value: new THREE.Vector2(-9, -9) }, uSunVis: { value: 0 }, uFlare: { value: 1 }, uFlareTint: { value: new THREE.Color(1, 0.8, 0.6) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uAspect; uniform float uTime; uniform float uExposure; uniform float uFade; uniform float uFlash;
      uniform float uCA; uniform float uGrain; uniform float uVignette; uniform float uZoom;
      uniform vec2 uSunUv; uniform float uSunVis; uniform float uFlare; uniform vec3 uFlareTint;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // the tone curve: after Khronos PBR Neutral (hue kept, so the oceans stay blue), but with
      // a long exponential shoulder from 0.42 instead of a short one from 0.76, so highlights
      // roll off like film rather than clip, and what is compressed fades towards white
      vec3 film(vec3 c) {
        const float s0 = 0.42, desat = 0.22;
        float x = min(c.r, min(c.g, c.b));
        float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
        c -= off * 0.6;
        float peak = max(c.r, max(c.g, c.b));
        if (peak <= s0) return c;
        float np = s0 + (1.0 - s0) * (1.0 - exp(-(peak - s0) / (1.0 - s0)));
        c *= np / peak;
        return mix(c, vec3(np), 1.0 - 1.0 / (desat * (peak - np) + 1.0));
      }
      vec3 ghost(vec2 p, vec2 at, float size, vec3 tint) {
        float r = length(p - at);
        return tint * ((1.0 - smoothstep(size * 0.82, size, r)) * 0.55 + (1.0 - smoothstep(0.0, size * 0.12, abs(r - size * 0.9))) * 0.6);
      }
      vec3 flare(vec2 uv) {
        float unit = min(uAspect, 1.0); // sized to the frame's short side, so a phone held upright gets the same flare
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) / unit, s = (uSunUv - 0.5) * vec2(uAspect, 1.0) / unit, d = p - s;
        float r = length(d);
        vec3 c = vec3(0.0);
        c += vec3(0.6, 0.76, 1.0) * exp(-abs(d.y) * 1500.0) * exp(-abs(d.x) * 2.6) * 0.32;      // a fine anamorphic streak
        c += vec3(0.65, 0.8, 1.0) * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 5.0) * 0.035;
        c += uFlareTint * (exp(-r * 18.0) * 0.08 + exp(-r * 4.0) * 0.02);                         // a soft veil round the sun
        vec2 axis = -s;
        c += ghost(p, s + axis * 0.62, 0.028, vec3(0.30, 0.55, 1.0) * 0.022);
        c += ghost(p, s + axis * 1.32, 0.06, vec3(0.5, 0.85, 1.0) * 0.008);
        c += ghost(p, s + axis * 1.6, 0.016, vec3(1.0, 0.6, 0.3) * 0.03);
        c += ghost(p, s + axis * 2.1, 0.1, vec3(0.6, 0.45, 1.0) * 0.006);
        return c * uSunVis * uFlare;
      }
      void main() {
        vec2 uv = vUv, dc = uv - 0.5;
        vec2 off = dc * uCA * (0.0015 + 0.03 * dot(dc, dc));
        vec3 col;
        if (uZoom > 0.001) {
          col = vec3(0.0);
          for (int i = 0; i < 12; i++) {
            float k = 1.0 - uZoom * 0.22 * float(i) / 11.0;
            vec2 q = 0.5 + dc * k;
            col += vec3(texture2D(tDiffuse, q - off).r, texture2D(tDiffuse, q).g, texture2D(tDiffuse, q + off).b);
          }
          col /= 12.0;
        } else {
          col = vec3(texture2D(tDiffuse, uv - off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + off).b);
        }
        if (uSunVis > 0.0) col += flare(uv);
        col = film(col * uExposure);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.1);                    // a little contrast
        col *= mix(vec3(0.97, 1.0, 1.04), vec3(1.015, 1.0, 0.985), smoothstep(0.05, 0.7, l)); // cool shadows, a little warmth in the light
        col = pow(max(col, 0.0), vec3(1.0 / 2.2));
        col *= 1.0 - uVignette * smoothstep(0.15, 0.95, dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) * 1.6 / max(uAspect, 1.0));
        float g = hash(uv * vec2(1931.7, 2713.3) + fract(uTime * 7.31)) - 0.5;
        col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));      // grain, strongest in the midtones
        col = col * (1.0 - vec3(0.016, 0.024, 0.043)) + vec3(0.016, 0.024, 0.043); // space is #04060b, not black
        col = mix(vec3(0.016, 0.024, 0.043), col, uFade);
        col = mix(col, vec3(1.0), uFlash);
        col += (hash(uv * 977.0 + uTime) - 0.5) / 255.0;                       // dither the gradients
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const blank = c => { const t = new THREE.DataTexture(new Uint8Array(c), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; };

  // an image fetched with its bytes counted, for a preloader that moves with the download
  async function fetchImage(url, onBytes) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const total = +r.headers.get('content-length') || 0;
    let blob;
    if (r.body && total) {
      const reader = r.body.getReader(), parts = [];
      let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(got, total); }
      blob = new Blob(parts);
    } else { blob = await r.blob(); onBytes(1, 1); }
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return img;
  }
  // a texture, drawn down to maxW on small screens to spare the GPU's memory
  function texture(img, renderer, maxW, mip = true) {
    let src = img;
    if (img.width > maxW) {
      const cv = document.createElement('canvas');
      cv.width = maxW; cv.height = Math.round(img.height * maxW / img.width);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      src = cv;
    }
    const t = new THREE.Texture(src);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.wrapS = THREE.RepeatWrapping;
    if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    t.needsUpdate = true;
    URL.revokeObjectURL(img.src);
    return t;
  }

  // stars: the catalogue's 9,096, coloured by spectral class, and a dusting of fainter ones
  // (seeded, so the sky is the same each visit) crowding towards the Milky Way
  function starField(cat) {
    const CLASS = [[0.62, 0.71, 1.0], [0.68, 0.76, 1.0], [0.82, 0.86, 1.0], [0.98, 0.97, 1.0], [1.0, 0.95, 0.86], [1.0, 0.82, 0.62], [1.0, 0.7, 0.48]];
    const pos = [], col = [], size = [];
    const add = (ra, dec, mag, cls) => {
      const v = ll(dec, ra, 900);
      pos.push(v.x, v.y, v.z);
      const b = Math.pow(10, -0.4 * (mag - 1.0));
      const k = Math.min(6, 0.07 + 0.95 * Math.pow(b, 0.55));
      col.push(...CLASS[cls].map(x => x * k));
      size.push(Math.min(6.5, 1.25 + 2.3 * Math.pow(b, 0.32)));
    };
    const s = cat ? cat.stars : [];
    for (let i = 0; i < s.length; i += 4) add(s[i] / 100, s[i + 1] / 100, s[i + 2] / 100, s[i + 3]);
    let seed = 20261029;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16000; i++) {
      // a direction in galactic coordinates, kept more often near the plane, turned to equatorial
      const l = rnd() * 360, sb = rnd() * 2 - 1, b = Math.asin(sb) / RAD;
      if (rnd() > 0.28 + 0.72 * Math.exp(-Math.abs(b) / 9)) { i--; continue; }
      const gx = Math.cos(b * RAD) * Math.cos(l * RAD), gy = Math.cos(b * RAD) * Math.sin(l * RAD), gz = Math.sin(b * RAD);
      const ex = GAL[0] * gx + GAL[3] * gy + GAL[6] * gz, ey = GAL[1] * gx + GAL[4] * gy + GAL[7] * gz, ez = GAL[2] * gx + GAL[5] * gy + GAL[8] * gz;
      add(Math.atan2(ey, ex) / RAD, Math.asin(ez) / RAD, 6.6 + 2.6 * Math.pow(rnd(), 0.5), Math.floor(2 + rnd() * 5));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uPx: { value: 1 }, uBright: { value: 1 } }, vertexShader: STAR_VS, fragmentShader: STAR_FS,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -9;
    return p;
  }

  function quad(corners) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(corners.length / 2 * 3).fill(0), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }

  // canvas: the WebGL canvas; month 1..12 picks the Blue Marble; onProgress(0..1, label)
  function create({ canvas, month, small = false, onProgress = () => {} }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x04060b, 1);
    const maxPR = Math.min(devicePixelRatio || 1, small ? 2 : 1.75);
    let pr = maxPR;
    renderer.setPixelRatio(pr);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.004, 2000);
    const sun = new THREE.Vector3(1, 0, 0);
    const uSunE = { value: 2.3 };
    const ready = { value: 0 };
    const tex = { day: blank([0, 0, 0, 255]), surf: blank([0, 255, 0, 255]), clouds: blank([0, 0, 0, 255]), mw: blank([0, 0, 0, 255]) };
    const W = small ? 2048 : 4096;

    // sky, stars and the moon
    const galM = new THREE.Matrix3();
    const sky = new THREE.Mesh(new THREE.IcosahedronGeometry(1000, 4), new THREE.ShaderMaterial({
      uniforms: { uMW: { value: tex.mw }, uGal: { value: galM }, uSun: { value: sun }, uMWI: { value: 0.32 }, uSunDisc: { value: 16 }, uReady: { value: 0 }, uCam: { value: camera.position } },
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    sky.renderOrder = -10;
    const skyDisc = sky.material.uniforms.uSunDisc;
    sky.frustumCulled = false;
    scene.add(sky);
    const starHolder = new THREE.Group();
    scene.add(starHolder);
    let stars = null;
    const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sun }, uSunE }, vertexShader: MOON_VS, fragmentShader: MOON_FS }));
    scene.add(moon);

    // the earth, its clouds and its air
    const shared = { uSun: { value: sun }, uCam: { value: camera.position }, uSunE, uReady: ready, uCloudU: { value: 0.0 } };
    const earthU = Object.assign({}, shared, {
      uDay: { value: tex.day }, uSurf: { value: tex.surf }, uClouds: { value: tex.clouds }, uTexel: { value: new THREE.Vector2(1 / W, 2 / W) },
      uLightsMap: { value: tex.surf }, uLightsTexel: { value: new THREE.Vector2(1 / W, 2 / W) },
      uLights: { value: 3.4 }, uCloudH: { value: 0.0016 }, uRelief: { value: small ? 0.9 : 1.6 }, uFocus: { value: new THREE.Vector3(1, 0, 0) },
      uFocusAmt: { value: 0 }, uTime: { value: 0 } });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, small ? 160 : 256, small ? 80 : 128),
      new THREE.ShaderMaterial({ uniforms: earthU, vertexShader: EARTH_VS, fragmentShader: EARTH_FS, extensions: { derivatives: true } }));
    scene.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(CLOUD, small ? 128 : 192, small ? 64 : 96), new THREE.ShaderMaterial({
      uniforms: Object.assign({}, shared, { uClouds: earthU.uClouds }), vertexShader: EARTH_VS, fragmentShader: CLOUD_FS,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    clouds.renderOrder = 2;
    scene.add(clouds);
    const atmoU = { uSun: shared.uSun, uCam: shared.uCam, uSunE, uSunDisc: null, uBetaR: { value: new THREE.Vector3(14.5, 33.8, 82) }, uBetaM: { value: 18 },
      uHR: { value: 0.0034 }, uHM: { value: 0.0009 }, uG: { value: 0.8 }, uGain: { value: 3.0 } };
    atmoU.uSunDisc = skyDisc;
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(ATMO, 160, 80), new THREE.ShaderMaterial({
      uniforms: atmoU, vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    atmo.renderOrder = 5;
    scene.add(atmo);

    // the cities
    const beams = new THREE.Group();
    beams.renderOrder = 3;
    scene.add(beams);
    const beamGeo = quad([-1, 0, 1, 0, 1, 1, -1, 1]), ringGeo = quad([-1, -1, 1, -1, 1, 1, -1, 1]);
    const time = { value: 0 };
    function addCity(lat, lon, color = [2.4, 1.25, 0.5]) {
      const base = ll(lat, lon), axis = base.clone().normalize(), c = new THREE.Vector3(...color);
      const uI = { value: 0 };
      const bm = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ uniforms: { uBase: { value: base }, uAxis: { value: axis }, uH: { value: 0.12 }, uW: { value: 0.006 }, uColor: { value: c }, uI },
        vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const rm = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ uniforms: { uBase: { value: base }, uAxis: { value: axis }, uS: { value: 0.03 }, uColor: { value: c }, uI, uTime: time },
        vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, extensions: { derivatives: true } }));
      for (const m of [bm, rm]) { m.frustumCulled = false; m.renderOrder = 3; beams.add(m); }
      return { base, axis, intensity: uI, beam: bm.material.uniforms, ring: rm.material.uniforms };
    }

    // post: HDR with 4x MSAA, bloom, the lens
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.88, 1.5);
    composer.addPass(bloom);
    const lens = new THREE.ShaderPass(LENS());
    composer.addPass(lens);
    const LU = lens.uniforms;

    let w = 1, h = 1;
    function resize(cw, ch) {
      w = Math.max(1, cw); h = Math.max(1, ch);
      renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
      renderer.setSize(w, h, false); composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      LU.uAspect.value = w / h;
      if (stars) stars.material.uniforms.uPx.value = pr;
    }

    // the sun and the sky for a UTC time
    let gm = 0;
    function setTime(utcMs) {
      const sub = window.Sun.subsolar(utcMs);
      ll(sub.lat, sub.lon, 1, sun);
      gm = gmst(utcMs);
      const t = gm * RAD, c = Math.cos(t), s = Math.sin(t);
      // world (earth-fixed) -> celestial (turned back by the sidereal time) -> equatorial -> galactic
      const R = new THREE.Matrix3().set(c, 0, s, 0, 1, 0, -s, 0, c);
      const P = new THREE.Matrix3().set(1, 0, 0, 0, 0, -1, 0, 1, 0);
      const G = new THREE.Matrix3().set(...GAL);
      galM.copy(G).multiply(P).multiply(R);
      starHolder.rotation.y = -t;
      const m = moonRaDec(utcMs);
      ll(m.dec / RAD, m.ra / RAD - gm, MOON_D, moon.position);
      return sub;
    }

    // loading: the sky first (small), then the night side, the day and the clouds
    async function load(base = 'assets/earth/') {
      const files = [['stars.json', 155e3], ['milkyway.jpg', 150e3], ['surface.jpg', 1.36e6], [`day-${String(month).padStart(2, '0')}.jpg`, 1.4e6], ['clouds.jpg', 1.78e6],
        ['lights.jpg', small ? 0 : 1.07e6]];
      const total = files.reduce((a, f) => a + f[1], 0), got = files.map(() => 0);
      const tick = (i, b, t) => { got[i] = files[i][1] * Math.min(1, b / (t || 1)); onProgress(got.reduce((a, x) => a + x, 0) / total, files[i][0]); };
      const cat = await fetch(base + files[0][0]).then(r => r.json()).catch(() => null);
      tick(0, 1, 1);
      stars = starField(cat);
      stars.material.uniforms.uPx.value = pr;
      starHolder.add(stars);
      const mw = fetchImage(base + files[1][0], (b, t) => tick(1, b, t)).then(img => {
        tex.mw = texture(img, renderer, 2048, false);
        sky.material.uniforms.uMW.value = tex.mw;
        sky.material.uniforms.uReady.value = 1;
      });
      const surf = fetchImage(base + files[2][0], (b, t) => tick(2, b, t)).then(img => {
        // a small copy of the lights, for the director to find where the night is brightest
        const cv = document.createElement('canvas');
        cv.width = 512; cv.height = 256;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 512, 256);
        const px = g.getImageData(0, 0, 512, 256).data;
        lights = new Uint8Array(512 * 256);
        for (let i = 0; i < lights.length; i++) lights[i] = px[i * 4];
        tex.surf = texture(img, renderer, W);
        earthU.uSurf.value = tex.surf;
        if (!tex.lights) earthU.uLightsMap.value = tex.surf;
      });
      const day = fetchImage(base + files[3][0], (b, t) => tick(3, b, t)).then(img => { tex.day = texture(img, renderer, W); earthU.uDay.value = tex.day; });
      const cl = fetchImage(base + files[4][0], (b, t) => tick(4, b, t)).then(img => { tex.clouds = texture(img, renderer, W); earthU.uClouds.value = tex.clouds; });
      // the lights at 8192 x 4096, one channel, where the screen is big enough to show them
      const li = small || renderer.capabilities.maxTextureSize < 8192 ? null : fetchImage(base + files[5][0], (b, t) => tick(5, b, t)).then(img => {
        const t = new THREE.Texture(img);
        t.format = THREE.RedFormat;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        t.wrapS = THREE.RepeatWrapping;
        t.needsUpdate = true;
        tex.lights = t;
        earthU.uLightsMap.value = t;
        earthU.uLightsTexel.value.set(1 / img.width, 1 / img.height);
      }).catch(() => null);
      await Promise.all([mw, surf, day, cl, li]);
      // upload now rather than on the first frame that shows them
      for (const t of [tex.surf, tex.day, tex.clouds, tex.lights]) if (t) renderer.initTexture(t);
    }

    // the night lights (0..1) at a point of the globe, once the surface has loaded
    let lights = null;
    function lightsAt(v) {
      if (!lights) return 0;
      const { lat, lon } = latlon(v);
      const x = Math.min(511, Math.floor((lon + 180) / 360 * 512)), y = Math.min(255, Math.floor((90 - lat) / 180 * 256));
      return lights[y * 512 + x] / 255;
    }

    // where the sun is on screen, and how much of its disc clears the limb
    const _v = new THREE.Vector3();
    function sunOnScreen() {
      const C = camera.position, d = C.length();
      const toEarth = _v.copy(C).multiplyScalar(-1 / d);
      const limb = Math.asin(Math.min(1, 1.006 / d)), sep = Math.acos(Math.max(-1, Math.min(1, toEarth.dot(sun))));
      const clear = sep - limb; // radians between the sun and the top of the dense air at the limb (negative: behind it)
      _v.copy(C).addScaledVector(sun, 50).project(camera);
      const inFront = camera.getWorldDirection(new THREE.Vector3()).dot(sun) > 0;
      const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
      const vis = inFront ? Math.max(0, Math.min(1, (clear + 0.003) / 0.012)) * Math.max(0, Math.min(1, (1.35 - edge) / 0.35)) : 0;
      return { uv: [(_v.x + 1) / 2, (_v.y + 1) / 2], vis, clear };
    }

    // dynamic resolution: if frames run long, render fewer pixels
    let acc = 0, n = 0, settled = false;
    function adapt(dt) {
      if (settled) return;
      acc += dt; n++;
      if (acc < 1.2) return;
      const ms = acc / n * 1000;
      acc = 0; n = 0;
      if (ms > 26 && pr > 0.75) { pr = Math.max(0.75, pr - 0.25); resize(w, h); }
      else if (ms < 18) settled = true;
    }

    let last = performance.now();
    function render(t = performance.now()) {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      adapt(dt);
      time.value = t / 1000;
      earthU.uTime.value = t / 1000;
      LU.uTime.value = t / 1000;
      shared.uCloudU.value = (shared.uCloudU.value + dt * 0.00035) % 1;
      sky.position.copy(camera.position);
      starHolder.position.copy(camera.position);
      const s = sunOnScreen();
      LU.uSunUv.value.set(s.uv[0], s.uv[1]);
      LU.uSunVis.value = s.vis;
      // the flare warms as the sun sinks into the air at the limb
      LU.uFlareTint.value.setRGB(1, 0.62 + 0.3 * Math.min(1, Math.max(0, s.clear / 0.05)), 0.38 + 0.5 * Math.min(1, Math.max(0, s.clear / 0.05)));
      composer.render(dt);
      return s;
    }

    function dispose() {
      composer.dispose?.();
      bloom.dispose();
      rt.dispose();
      for (const t of Object.values(tex)) t.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose();
      renderer.forceContextLoss(); // give the GPU its memory back before the city takes it
    }

    return { renderer, scene, camera, sun, earth: earthU, atmo: atmoU, lens: LU, bloom, sky: sky.material.uniforms, ready, uSunE,
      get stars() { return stars; }, resize, setTime, load, render, addCity, dispose, sunOnScreen, lightsAt,
      get pixelRatio() { return pr; } };
  }

  return { create, ll, latlon, gmst, ATMO };
})();
