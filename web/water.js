// Open Earth 3D water, shared by every city: a wind-driven sea surface after Tidewater
// (github.com/dgreenheck/tidewater, MIT), ported from WebGPU compute to WebGL2.
//
//   spectrum   JONSWAP with the Horvath directional spread and the TMA depth correction,
//              seeded on the CPU once per wind (Tidewater's formulas and constants)
//   waves      cascaded FFT ocean (Tessendorf): per frame and per cascade, one pass evolves
//              the spectrum in time into four packed complex fields, then log2 N horizontal
//              and log2 N vertical Stockham passes run the inverse FFT, and a last pass
//              writes displacement (Dx, Dy, Dz, foam) and slopes. Foam is generated where
//              the surface compresses (Jacobian below a bias) and decays over time.
//   surface    a polar grid that follows the camera, displaced by every cascade, each one
//              faded out where the grid is too coarse for it; shading on the scene's own
//              lights (MeshPhysicalMaterial, ior 1.33): sun glints, sky and a planar
//              reflection of the city, unresolved slope as roughness (Cox-Munk)
//   shore      a signed distance to the shoreline with beach and rock masks
//              (shore.png, written by pipeline/build_scene.py): waves calm towards the
//              shore, foam runs along it, shallow water shows the bottom, and the ground
//              gets a wet band and a swash on sand (patchGround)
//
// Frame: three.js world, x east, y up, z = -north. Water level is y = 0.
//
// The spectrum and the FFT passes are ported from Tidewater, under its licence:
//
//   MIT License. Copyright (c) 2026 DRG Software Solutions LLC
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this
//   software and associated documentation files (the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify,
//   merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following
//   conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies
//   or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//   HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
//   OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
'use strict';
window.OEWater = (function () {
  const G = 9.81, TAU = Math.PI * 2;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  // ---------------------------------------------------------------- spectrum (CPU)
  // one wind system: speed U (m/s), the direction the waves travel (radians, three.js x
  // towards z), fetch (km); alpha and peak frequency are the fetch-limited JONSWAP fits
  function system(o) {
    const U = Math.max(0.1, o.wind_ms), F = Math.max(1, o.fetch_km * 1000);
    return { scale: o.scale ?? 1, angle: o.angle, spread: o.spread ?? 0.9, swell: o.swell ?? 0, gamma: o.gamma ?? 3.3,
      fade: o.short_fade ?? 0.01, alpha: 0.076 * Math.pow(G * F / (U * U), -0.22), peak: 22 * Math.pow(U * F / (G * G), -0.33) };
  }
  const dispersion = (k, d) => Math.sqrt(G * k * Math.tanh(Math.min(k * d, 20)));
  function dispersionDerivative(k, d) {
    const kd = Math.min(k * d, 20), th = Math.tanh(kd), ch = Math.cosh(kd);
    return G * (d * k / (ch * ch) + th) / dispersion(k, d) * 0.5;
  }
  function tma(omega, d) {
    const oh = omega * Math.sqrt(d / G);
    return oh <= 1 ? 0.5 * oh * oh : oh < 2 ? 1 - 0.5 * (2 - oh) * (2 - oh) : 1;
  }
  function jonswap(omega, s, d) {
    const sigma = omega <= s.peak ? 0.07 : 0.09, dd = omega - s.peak;
    const r = Math.exp(-dd * dd / (2 * sigma * sigma * s.peak * s.peak));
    return s.scale * tma(omega, d) * s.alpha * G * G * Math.pow(omega, -5) * Math.exp(-1.25 * Math.pow(s.peak / omega, 4)) * Math.pow(s.gamma, r);
  }
  function norm(sp) {
    return sp < 5 ? -0.000564 * sp ** 4 + 0.00776 * sp ** 3 - 0.044 * sp * sp + 0.192 * sp + 0.163
      : -4.80e-08 * sp ** 4 + 1.07e-05 * sp ** 3 - 9.53e-04 * sp * sp + 5.90e-02 * sp + 3.93e-01;
  }
  function direction(theta, omega, s) {
    const ratio = omega / s.peak;
    const sp = (omega > s.peak ? 9.77 * Math.pow(ratio, -2.5) : 6.97 * Math.pow(ratio, 5)) + 16 * Math.tanh(Math.min(ratio, 20)) * s.swell * s.swell;
    const dt = theta - s.angle, cosT = Math.cos(dt);
    const base = cosT > 0 ? cosT * cosT * 2 / Math.PI : 0;
    return base + (norm(sp) * Math.pow(Math.abs(Math.cos(dt * 0.5)), 2 * sp) - base) * s.spread;
  }
  function rng(seed) { // mulberry32
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // h0 for one cascade: (h0(k), conj(h0(-k))) per texel, texel (x, y) = wavenumber index (x - N/2, y - N/2)
  function spectrum(N, L, lo, hi, systems, depth, seed) {
    const dk = TAU / L, h = new Float32Array(N * N * 2), rand = rng(seed);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const kx = (x - N / 2) * dk, kz = (y - N / 2) * dk, k = Math.hypot(kx, kz), i = 2 * (y * N + x);
      const u1 = Math.max(1e-7, rand()), u2 = rand();
      if (k < lo || k > hi) continue;
      const omega = dispersion(k, depth), theta = Math.atan2(kz, kx);
      let S = 0;
      for (const s of systems) S += jonswap(omega, s, depth) * direction(theta, omega, s) * Math.exp(-s.fade * s.fade * k * k);
      // E|h0|^2 = S(k) dk^2 / 2, with S(k) = S(omega, theta) |d omega / dk| / k
      const amp = Math.sqrt(Math.max(S, 0) * Math.abs(dispersionDerivative(k, depth)) / k * dk * dk) * 0.5;
      const r = Math.sqrt(-2 * Math.log(u1));
      h[i] = r * Math.cos(TAU * u2) * amp; h[i + 1] = r * Math.sin(TAU * u2) * amp;
    }
    const out = new Float32Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, m = ((N - y) % N) * N + (N - x) % N;
      out.set([h[2 * i], h[2 * i + 1], h[2 * m], -h[2 * m + 1]], 4 * i);
    }
    return out;
  }
  // significant wave height of the spectrum (4 sigma), for the shore foam and the docs
  function significantHeight(h0s) {
    let v = 0;
    for (const h of h0s) for (let i = 0; i < h.length; i += 4) v += 2 * (h[i] * h[i] + h[i + 1] * h[i + 1]);
    return 4 * Math.sqrt(v);
  }

  // ---------------------------------------------------------------- FFT passes (GPU)
  const VS = `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const HEAD = `precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }`;
  // h(k, t) = h0(k) e^{-i w t} + conj(h0(-k)) e^{i w t}, so a mode travels along k; then the
  // displacement D = i k/|k| h (sharp crests for a positive choppiness, as in Tidewater) and the
  // slopes, packed two real fields per complex number:
  //   o0 = (Dx + i Dz, Dy + i dDx/dz)   o1 = (dDy/dx + i dDy/dz, dDx/dx + i dDz/dz)
  const FS_SPECTRUM = `${HEAD}
uniform sampler2D h0; uniform float N, L, depth, time;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 hv = texelFetch(h0, p, 0);
  float kx = (float(p.x) - N * 0.5) * 6.283185307 / L, kz = (float(p.y) - N * 0.5) * 6.283185307 / L, k = length(vec2(kx, kz));
  if (k < 1e-6) { o0 = vec4(0.0); o1 = vec4(0.0); return; }
  float w = sqrt(9.81 * k * tanh(min(k * depth, 20.0)));
  float ph = -mod(w * time, 6.283185307), cs = cos(ph), sn = sin(ph);
  float hr = hv.x * cs - hv.y * sn + hv.z * cs + hv.w * sn;
  float hi = hv.x * sn + hv.y * cs - hv.z * sn + hv.w * cs;
  float ik = 1.0 / k, fx = kx * ik, fz = kz * ik;
  vec2 c0 = vec2(-(fx * hi + fz * hr), fx * hr - fz * hi);
  float q = -kx * kz * ik;
  vec2 c1 = vec2(hr - q * hi, hi + q * hr);
  vec2 c2 = vec2(-(kx * hi + kz * hr), kx * hr - kz * hi);
  float a = -kx * kx * ik, b = -kz * kz * ik;
  vec2 c3 = vec2(a * hr - b * hi, a * hi + b * hr);
  o0 = vec4(c0, c1); o1 = vec4(c2, c3);
}`;
  // one Stockham radix-2 stage of the inverse DFT (e^{+i}), natural order in and out
  const FS_BUTTERFLY = `${HEAD}
uniform sampler2D s0, s1; uniform int N, sub;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
#ifdef HORIZONTAL
  int index = p.x;
#else
  int index = p.y;
#endif
  int hs = sub / 2, ev = (index / sub) * hs + index % hs;
#ifdef HORIZONTAL
  ivec2 pe = ivec2(ev, p.y), po = ivec2(ev + N / 2, p.y);
#else
  ivec2 pe = ivec2(p.x, ev), po = ivec2(p.x, ev + N / 2);
#endif
  float ang = 6.283185307 * float(index % sub) / float(sub);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 e0 = texelFetch(s0, pe, 0), d0 = texelFetch(s0, po, 0), e1 = texelFetch(s1, pe, 0), d1 = texelFetch(s1, po, 0);
  o0 = vec4(e0.xy + cmul(w, d0.xy), e0.zw + cmul(w, d0.zw));
  o1 = vec4(e1.xy + cmul(w, d1.xy), e1.zw + cmul(w, d1.zw));
}`;
  // sign correction for the centred spectrum, choppiness, and persistent foam (Tidewater's)
  const FS_ASSEMBLE = `${HEAD}
uniform sampler2D s0, s1, prev; uniform float lambda, dt, foamBias, foamGain, foamDecay, foamAdd;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float sg = ((p.x + p.y) & 1) == 0 ? 1.0 : -1.0;
  vec4 A = texelFetch(s0, p, 0) * sg, B = texelFetch(s1, p, 0) * sg;
  float jxx = 1.0 + lambda * B.z, jzz = 1.0 + lambda * B.w, jxz = lambda * A.w;
  float J = jxx * jzz - jxz * jxz;
  float gen = clamp((foamBias - J) * foamGain, 0.0, 1.0);
  float f = texelFetch(prev, p, 0).w * exp(-foamDecay * dt) + gen * foamAdd * dt;
  o0 = vec4(lambda * A.x, A.z, lambda * A.y, clamp(max(f, gen * 0.5), 0.0, 1.5));
  o1 = vec4(B.x, B.y, lambda * B.z, lambda * B.w);
}`;

  function FFT(renderer, o) {
    const N = o.N, C = o.sizes.length, LOG = Math.log2(N);
    const float = renderer.extensions.has('EXT_color_buffer_float');
    const type = float ? THREE.FloatType : THREE.HalfFloatType;
    const rt = opts => new THREE.WebGLRenderTarget(N, N, Object.assign({ count: 2, type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false }, opts));
    const work = [rt(), rt()];
    const outOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping, generateMipmaps: true };
    const cascades = o.sizes.map((L, c) => {
      const out = [rt(outOpts), rt(outOpts)];
      for (const r of out) for (const t of r.textures) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; }
      const h0 = new THREE.DataTexture(o.h0[c], N, N, THREE.RGBAFormat, THREE.FloatType);
      h0.needsUpdate = true;
      return { L, h0, out, cur: 0 };
    });
    const mat = (fs, uniforms, defines = {}) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false });
    const uSpec = { h0: { value: null }, N: { value: N }, L: { value: 1 }, depth: { value: o.depth }, time: { value: 0 } };
    const mSpec = mat(FS_SPECTRUM, uSpec);
    const uBf = { s0: { value: null }, s1: { value: null }, N: { value: N }, sub: { value: 2 } };
    const mH = mat(FS_BUTTERFLY, uBf, { HORIZONTAL: 1 }), mV = mat(FS_BUTTERFLY, uBf);
    const uAs = { s0: { value: null }, s1: { value: null }, prev: { value: null }, lambda: { value: o.choppiness }, dt: { value: 0 },
      foamBias: { value: 0.58 }, foamGain: { value: 3.0 }, foamDecay: { value: 0.35 }, foamAdd: { value: 2.5 } };
    const mAs = mat(FS_ASSEMBLE, uAs);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(geo, mSpec), sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad.frustumCulled = false;
    sc.add(quad);
    const draw = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(sc, cam); };
    function step(t, dt) {
      const prevRT = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, sh = renderer.shadowMap.autoUpdate;
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
      uSpec.time.value = t; uAs.dt.value = Math.min(dt, 0.1);
      for (const cc of cascades) {
        uSpec.h0.value = cc.h0; uSpec.L.value = cc.L;
        draw(mSpec, work[0]);
        let a = 0;
        for (const m of [mH, mV]) for (let s = 0; s < LOG; s++) {
          uBf.s0.value = work[a].textures[0]; uBf.s1.value = work[a].textures[1]; uBf.sub.value = 2 << s;
          draw(m, work[1 - a]); a = 1 - a;
        }
        const next = 1 - cc.cur;
        uAs.s0.value = work[a].textures[0]; uAs.s1.value = work[a].textures[1]; uAs.prev.value = cc.out[cc.cur].textures[0];
        draw(mAs, cc.out[next]);
        cc.cur = next;
      }
      renderer.setRenderTarget(prevRT); renderer.xr.enabled = prevXr; renderer.shadowMap.autoUpdate = sh;
    }
    // the current displacement and slope textures of cascade c
    const disp = c => cascades[c].out[cascades[c].cur].textures[0], deriv = c => cascades[c].out[cascades[c].cur].textures[1];
    function dispose() {
      for (const r of work) r.dispose();
      for (const cc of cascades) { cc.h0.dispose(); for (const r of cc.out) r.dispose(); }
      for (const m of [mSpec, mH, mV, mAs]) m.dispose();
      geo.dispose();
    }
    return { N, C, step, disp, deriv, dispose, cascades, float };
  }

  // ---------------------------------------------------------------- surface grid
  // rings from r0 out, each spacing (1 + q) times the last, then one flat ring to the horizon
  function polarGrid(r0, q, rMax, segs, horizon) {
    const radii = [0];
    for (let r = r0, d = r0; r < rMax; d *= 1 + q, r += d) radii.push(r);
    radii.push(horizon);
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let i = 1; i < radii.length; i++) for (let j = 0; j < segs; j++) {
      const a = TAU * j / segs;
      pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + (j + 1) % segs, 1 + j);
    for (let i = 1; i < radii.length - 1; i++) {
      const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), horizon);
    return g;
  }

  // ---------------------------------------------------------------- the water
  // cfg: city.json "water" block ("waves", "colour", "shallow_colour", "clarity_m"); shore:
  // { texture, x0, y1, w, h, slopes, floor_m } in local metres (scene.json "shore"), or null;
  // opts: { world, small, software, quality }
  function create(renderer, cfg, shore, opts) {
    const W = cfg.waves || {}, small = !!opts.small, soft = !!opts.software;
    // wind from a compass bearing (where it blows from) to the direction the waves travel, in three.js x-z
    const toAngle = from => { const b = (from + 180) * Math.PI / 180; return Math.atan2(-Math.cos(b), Math.sin(b)); };
    const systems = [system({ wind_ms: W.wind_ms ?? 5, fetch_km: W.fetch_km ?? 5, angle: toAngle(W.wind_from_deg ?? 0), spread: 0.85 })];
    if (W.swell_m) systems.push(system({ wind_ms: W.swell_wind_ms ?? 8, fetch_km: 1200, angle: toAngle(W.swell_from_deg ?? 0), spread: 1, swell: 0.9, short_fade: 0.1, scale: W.swell_m }));
    const sizes = W.cascades_m || [157, 33.3, 7.1], depth = W.depth_m ?? 15, N = soft || small ? 128 : 256;
    const h0 = sizes.map((L, c) => spectrum(N, L, c === 0 ? 1e-4 : TAU / L * 6, c === sizes.length - 1 ? 9999 : TAU / sizes[c + 1] * 6, systems, depth, 1337 + 7919 * c));
    const Hs = significantHeight(h0);
    const fft = FFT(renderer, { N, sizes, h0, depth, choppiness: W.choppiness ?? 0.9 });

    const u = {
      uDisp: { value: sizes.map((_, c) => fft.disp(c)) }, uDeriv: { value: sizes.map((_, c) => fft.deriv(c)) },
      uSize: { value: sizes.slice() }, uTime: { value: 0 }, uHs: { value: Hs },
      uShore: { value: shore ? shore.texture : null }, uShoreOn: { value: shore ? 1 : 0 },
      uShoreBox: { value: shore ? new THREE.Vector4(shore.x0, shore.y1, shore.w, shore.h) : new THREE.Vector4(0, 0, 1, 1) },
      uDeep: { value: lin(cfg.colour || '#0f2b33') }, uShallow: { value: lin(cfg.shallow_colour || '#2f6b66') },
      uClarity: { value: cfg.clarity_m ?? 4 }, uSlopes: { value: new THREE.Vector3(...['sand', 'rock', 'built'].map(k => (shore && shore.slopes || {})[k] ?? { sand: 0.04, rock: 0.25, built: 1 }[k])) },
      uFloor: { value: shore && shore.floor_m || 4 },
      uRefl: { value: null }, uReflOn: { value: 0 }, uReflMat: { value: new THREE.Matrix4() }, uWind: { value: W.wind_ms ?? 5 }
    };
    const C = sizes.length;
    const COMMON = `
uniform sampler2D uDisp[${C}], uDeriv[${C}], uShore; uniform float uSize[${C}], uTime, uHs, uShoreOn, uClarity, uFloor, uReflOn, uWind;
uniform vec4 uShoreBox; uniform vec3 uDeep, uShallow, uSlopes; uniform sampler2D uRefl; uniform mat4 uReflMat;
// shore.png: r signed distance to the shoreline (0.5 m per level, 128 = shore, water positive),
// g sand, b rock; outside the map it is open water
vec4 shoreAt(vec2 xz) {
  vec2 uv = vec2((xz.x - uShoreBox.x) / uShoreBox.z, (-xz.y - uShoreBox.y) / -uShoreBox.w);
  if (uShoreOn < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(64.0, 0.0, 0.0, 0.0);
  vec4 s = texture(uShore, uv);
  return vec4((s.r * 255.0 - 128.0) * 0.5, s.g, s.b, 1.0);
}
// how much of cascade c a grid this coarse (m) can carry
float cascadeWeight(int c, float spacing) { return 1.0 - smoothstep(0.35, 0.7, spacing * 64.0 / uSize[c]); }`;
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, ior: 1.33, transparent: true, premultipliedAlpha: true, depthWrite: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${COMMON}
varying vec3 vWave; varying vec2 vXZ; varying float vSpacing;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp0.xz;
  float dist = length(xz - cameraPosition.xz);
  vSpacing = 0.5 + 0.03 * dist;
  float calm = smoothstep(1.0, 14.0, shoreAt(xz).x);
  vec3 d = vec3(0.0);
${sizes.map((_, c) => `  d += textureLod(uDisp[${c}], xz / uSize[${c}], 0.0).xyz * cascadeWeight(${c}, vSpacing);`).join('\n')}
  d *= calm;
  transformed += d;
  vXZ = xz; vWave = d;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
${COMMON}
varying vec3 vWave; varying vec2 vXZ; varying float vSpacing;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
float wAlpha; float wFoam; vec3 wN;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec4 sh0 = shoreAt(vXZ);
  float camD = length(vXZ - cameraPosition.xz);
  // slopes of every cascade, faded where the pixel footprint is wider than the waves
  float fp = camD * 0.0015 + 0.02;
  vec4 sl = vec4(0.0); float foam = 0.0, lost = 0.0;
${sizes.map((_, c) => `  { float k = 1.0 - smoothstep(0.25, 1.0, fp * 128.0 / uSize[${c}]); vec2 uv = vXZ / uSize[${c}];
    sl += texture(uDeriv[${c}], uv) * k; foam += texture(uDisp[${c}], uv).w * k; lost += 1.0 - k; }`).join('\n')}
  float calm = smoothstep(1.0, 14.0, sh0.x);
  // near the shore the heights calm (so the sea never climbs the land) but the ripples stay
  vec2 slope = sl.xy / max(vec2(1.0 + sl.z, 1.0 + sl.w), vec2(0.2)) * mix(0.75, 1.0, calm);
  wN = normalize(vec3(-slope.x, 1.0, -slope.y));
  // shore foam, by the kind of shore and the size of the waves: a faint broken lap against a
  // seawall, splash patches off rock, and lines of swash running in on a beach
  float lace = smoothstep(0.45, 0.85, wNoise(vXZ * 1.3 + vec2(uTime * 0.25, -uTime * 0.1)));
  float hs = clamp(uHs / 0.5, 0.0, 1.0);
  float lap = smoothstep(0.3 + 1.5 * uHs, 0.0, sh0.x) * lace * mix(0.08, 0.45, sh0.z);
  float splash = sh0.z * smoothstep(0.6 + 4.0 * uHs, 0.0, sh0.x) * smoothstep(0.62, 0.8, wNoise(vXZ * 0.45 + uTime * 0.3)) * (0.3 + 0.7 * hs);
  float band = 1.0 + 10.0 * uHs;
  float runIn = fract(sh0.x / (0.35 * band) + uTime * 0.15 + wNoise(vXZ * 0.05) * 0.8);
  float swash = sh0.y * smoothstep(band, 0.2 * band, sh0.x) * smoothstep(0.72, 0.95, runIn) * (0.5 + 0.5 * lace);
  // a line thinner than a pixel covers only part of it
  float shoreFoam = sh0.w * clamp(lap + splash + swash, 0.0, 1.0) * clamp((0.4 + 3.0 * uHs) / fp, 0.15, 1.0);
  wFoam = clamp(smoothstep(0.25, 1.0, foam) + shoreFoam, 0.0, 1.0);
  // the modelled depth of pipeline/shore.py (no bathymetry), through which the bottom shows:
  // the distance to the shore times the slope for its kind (sand, rock or built), to a floor
  float wd = sh0.w > 0.5 ? min(uFloor, max(sh0.x, 0.0) * mix(mix(uSlopes.z, uSlopes.y, sh0.z), uSlopes.x, sh0.y)) : 30.0;
  vec3 V = normalize(cameraPosition - vec3(vXZ.x, 0.0, vXZ.y));
  float path = wd / max(V.y, 0.15);
  wAlpha = clamp(1.0 - exp(-path / uClarity), 0.0, 1.0);
  // murky water hides the bottom off seawalls and mostly off rock; beaches show their sand
  wAlpha = max(wAlpha, mix(mix(0.9, 0.55, sh0.z), 0.0, sh0.y) * sh0.w);
  wAlpha = max(wAlpha, wFoam);
  diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, uFloor, wd)) * 0.12;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82), wFoam);
  // crests catch light through the water (a cheap subsurface term)
  diffuseColor.rgb += uShallow * 0.06 * clamp(vWave.y / max(uHs, 0.05), 0.0, 1.5);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  // unresolved slope variance (Cox-Munk mean square slope 0.003 + 0.00512 U) as roughness
  roughnessFactor = clamp(sqrt(roughnessFactor * roughnessFactor + (0.003 + 0.00512 * uWind) * 2.0 * clamp(lost / float(${C}), 0.0, 1.0)), 0.02, 1.0);
  roughnessFactor = mix(roughnessFactor, 0.7, wFoam);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
  nonPerturbedNormal = normal;`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  if (uReflOn > 0.5) {
    // the city in the water, broken up by the ripples; where the waves are too small to
    // resolve, their roughness blurs it towards the sky's own (prefiltered) reflection
    vec4 rp = uReflMat * vec4(vXZ.x, 0.0, vXZ.y, 1.0);
    vec2 ruv = rp.xy / rp.w + wN.xz * 0.2 / (1.0 + camD * 0.003);
    vec3 city = texture(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
    radiance = mix(radiance, city, (1.0 - wFoam) * (1.0 - 0.6 * clamp(lost / float(${C}), 0.0, 1.0)));
  }
#endif`)
        // premultiplied: the reflection (already Fresnel-weighted) adds on top; what lies under
        // the water shows through what the water column and the surface's reflection leave
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          `float wF = 0.02 + 0.98 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
  vec3 outgoingLight = (totalDiffuse + totalEmissiveRadiance) * wAlpha * (1.0 - wF) + totalSpecular;`)
        .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight, 1.0 - (1.0 - wAlpha) * (1.0 - wF));')
        .replace('#include <premultiplied_alpha_fragment>', '');
    };
    const geo = polarGrid(0.5, small || soft ? 0.05 : 0.03, small || soft ? 9000 : 16000, small || soft ? 160 : 256, 60000);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;

    // planar reflection of the city, half resolution, where the GPU can afford a second render
    let refl = null;
    const reflOn = opts.quality === 'high' || (opts.quality !== 'low' && !soft && !small);
    if (reflOn && THREE.Reflector) {
      const sz = new THREE.Vector2();
      renderer.getDrawingBufferSize(sz);
      refl = new THREE.Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: Math.round(sz.x / 2), textureHeight: Math.round(sz.y / 2), clipBias: 0.02, multisample: 0 });
      refl.rotation.x = -Math.PI / 2;
      refl.updateMatrixWorld();
      u.uRefl.value = refl.getRenderTarget().texture;
    }
    const inv = new THREE.Matrix4(), snap = 4;
    let last = null;
    function update(tMs, camera, world) {
      const t = tMs / 1000, dt = last == null ? 0 : t - last;
      last = t;
      fft.step(t, dt);
      for (let c = 0; c < C; c++) { u.uDisp.value[c] = fft.disp(c); u.uDeriv.value[c] = fft.deriv(c); }
      u.uTime.value = t;
      mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
      u.uReflOn.value = 0;
      if (refl && camera.position.y > 0.3) {
        const sz = new THREE.Vector2();
        renderer.getDrawingBufferSize(sz);
        const rt = refl.getRenderTarget();
        if (rt.width !== Math.round(sz.x / 2) || rt.height !== Math.round(sz.y / 2)) rt.setSize(Math.round(sz.x / 2), Math.round(sz.y / 2));
        mesh.visible = false;
        refl.onBeforeRender(renderer, world, camera);
        mesh.visible = true;
        u.uReflMat.value.copy(refl.material.uniforms.textureMatrix.value).multiply(inv.copy(refl.matrixWorld).invert());
        u.uReflOn.value = 1;
      }
    }

    // the ground's share: a wet band along the waterline and the swash on sand
    const GROUND = `
uniform sampler2D uShore; uniform float uShoreOn, uTime, uHs; uniform vec4 uShoreBox;
varying vec3 vShoreWP;
vec4 shoreAt(vec2 xz) {
  vec2 uv = vec2((xz.x - uShoreBox.x) / uShoreBox.z, (-xz.y - uShoreBox.y) / -uShoreBox.w);
  if (uShoreOn < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(64.0, 0.0, 0.0, 0.0);
  vec4 s = texture(uShore, uv);
  return vec4((s.r * 255.0 - 128.0) * 0.5, s.g, s.b, 1.0);
}`;
    function patchGround(sh) {
      Object.assign(sh.uniforms, { uShore: u.uShore, uShoreOn: u.uShoreOn, uShoreBox: u.uShoreBox, uTime: u.uTime, uHs: u.uHs });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShoreWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvShoreWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GROUND)
        .replace('#include <map_fragment>', `#include <map_fragment>
  vec4 gs = shoreAt(vShoreWP.xz);
  // the swash runs up and back on sand; above it the sand stays damp for a while
  float run = (0.3 + 1.8 * uHs) * (0.55 + 0.45 * sin(uTime * 0.9 + gs.x * 0.15));
  float above = vShoreWP.y, wet = gs.w * (1.0 - smoothstep(0.05, 0.2 + 0.6 * gs.y + uHs * 0.6, above));
  float swash = gs.w * gs.y * smoothstep(0.0, 0.8, -gs.x) * (1.0 - smoothstep(run - 0.5, run, -gs.x));
  diffuseColor.rgb *= 1.0 - 0.35 * max(wet, swash);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), swash * smoothstep(run - 0.9, run - 0.3, -gs.x) * 0.6);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.25, max(wet, swash) * 0.8);`);
    }

    function dispose() { fft.dispose(); geo.dispose(); mat.dispose(); if (refl) { refl.getRenderTarget().dispose(); refl.material.dispose(); } }
    return { mesh, material: mat, update, patchGround, dispose, Hs, fft, uniforms: u, reflections: !!refl, N };
  }

  // a software rasteriser (SwiftShader, llvmpipe): smaller FFTs, a coarser grid, no reflection
  function software(renderer) {
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return /swiftshader|llvmpipe|software|basic render/i.test(dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '');
  }

  return { create, software, FFT, spectrum, significantHeight, system, polarGrid };
})();
