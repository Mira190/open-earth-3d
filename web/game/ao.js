// Open Earth 3D ambient occlusion: contact shadows where facades meet the street, under eaves,
// awnings, benches, cars and trees, and in the corners of a square, on the medium and high tiers.
//
// It needs nothing but the depth buffer the scene was drawn with (the scene's target resolves it for
// this; the reversed float depth of game.js or an ordinary one), so the city is not drawn a second time,
// and it adds no full-resolution pass of its own (issue 352):
//   1. at half the screen's size, each pixel's position is rebuilt from depth and its normal from
//      the neighbour on each side that lies nearest its plane (so an edge does not bend it); a
//      spiral of samples round it in a disc of a few metres, rotated per pixel by interleaved
//      gradient noise, gathers the occlusion with the falloff of McGuire's Scalable Ambient
//      Obscurance (f = (R^2 - v.v)^3 * max(v.n - bias, 0) / (v.v + e));
//   2. the frames before carry most of it (issue 375): the last frame's result is reprojected with the last frame's
//      view and projection and blended in at nine parts to one where its distance agrees with this pixel's (a
//      walker that has moved, a wall behind a corner just turned, or a frame after a cut takes this frame's
//      own), clamped to the range of this frame's neighbours (no trail behind what moves), so the spiral turns
//      a little every frame and a few samples a frame add up to some fifty;
//   3. one depth-aware blur at half size takes the rest of the noise out without bleeding across an edge;
//   4. the frame's one full-resolution pass, the lens (lens.js, atmosphere.js), darkens each pixel by
//      it as it reads the scene: a depth-aware upsample (UPSAMPLE below: of the four half-size texels
//      round the pixel, those at its own depth), fading out with distance so the far city and the
//      sky keep the photograph's look, and a little at night, when the light is the street's own.
// It is the approach of N8AO (N8python, CC0), written here for three.js r186's reversed float
// depth, which N8AO does not read. See docs/LOOK.md for the survey and what was adopted.
//
// The frame-time governor (quality.js, through game.js) sets its ceiling on a device that cannot keep up:
// fewer samples, then off, and back as the frame time allows (limit()). ?aotaa=off draws each frame from scratch
// again (16 or 8 samples and two blurs, as before issue 375), to compare. ?ao=0 in the
// page's address turns it off, ?ao=1 keeps it on whatever the governor says, ?ao=show shows the occlusion alone.
'use strict';
window.OEAO = (function () {
  const TAA = new URLSearchParams(location.search).get('aotaa') !== 'off';
  const LEVELS = TAA ? [
    null,                              // 0: off
    { samples: 4, blurs: 1 },          // 1: lite (medium tier, or a high tier over budget)
    { samples: 6, blurs: 1 },          // 2: full (high tier)
  ] : [null, { samples: 8, blurs: 1 }, { samples: 16, blurs: 2 }];
  const VERT = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // reading depth: reversed ([1 at the near plane, 0 at the far one], clip control 0..1) or not
  const DEPTH = `
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform float uReversed;
float oeD(vec2 uv) { return texture2D(tDepth, uv).x; }
bool oeSky(float d) { return uReversed > 0.5 ? d <= 1e-7 : d >= 0.999999; }
vec3 oeView(vec2 uv, float d) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, uReversed > 0.5 ? d : d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}`;
  const AO = n => `
#define N ${n}
${DEPTH}
uniform mat4 uProj; uniform vec2 uTexel; uniform float uAspect, uRadius, uGrow, uMaxR, uIntensity, uFadeFar, uFrame;
varying vec2 vUv;
void main() {
  // (a half-size pixel's centre falls between two full-size depth texels: take one of them, or
  // the rows would alternate between their depths and the normal with them)
  vec2 uv = (floor(vUv / uTexel) + 0.5) * uTexel;
  float d = oeD(uv);
  if (oeSky(d)) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 P = oeView(uv, d);
  float dist = -P.z;
  if (dist > uFadeFar) { gl_FragColor = vec4(1.0, dist, 0.0, 1.0); return; }
  // the normal from the neighbours nearest the pixel's own plane on each axis
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  vec3 Pr = oeView(uv + ex, oeD(uv + ex)), Pl = oeView(uv - ex, oeD(uv - ex));
  vec3 Pu = oeView(uv + ey, oeD(uv + ey)), Pd = oeView(uv - ey, oeD(uv - ey));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 Nn = normalize(cross(dx, dy));
  if (dot(Nn, P) > 0.0) Nn = -Nn;
  // a few metres, less right by the camera and a little more further off, so a street corner 100 m away still
  // reads; never more than a fraction of the screen (the cost, and a halo round a near shoulder)
  float R = min(uRadius, 0.4 + dist * 0.12) + dist * uGrow, R2 = R * R; // (smaller close up: no halo on the street behind a passer-by)
  float rs = min(R * uProj[1][1] * 0.5 / dist, uMaxR);
  if (rs < 2.0 * uTexel.y) { gl_FragColor = vec4(1.0, dist, 0.0, 1.0); return; }
  // interleaved gradient noise, moved on each frame (Jimenez 2014) so the history gathers other directions
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uFrame, vec2(0.06711056, 0.00583715))));
  float t0 = fract(0.5 + uFrame * 0.6180340);
  float bias = 0.02 + dist * 0.0015, occ = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + t0) / float(N);
    float a = ang + float(i) * 2.3999632;
    vec2 suv = uv + vec2(cos(a) / uAspect, sin(a)) * rs * t;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sd = oeD(suv);
    if (oeSky(sd)) continue;
    vec3 v = oeView(suv, sd) - P;
    float vv = dot(v, v), f = max(R2 - vv, 0.0);
    occ += f * f * f * max((dot(v, Nn) - bias) / (vv + 0.01 * R2), 0.0);
  }
  occ /= R2 * R2 * R2;
  // (never darker than 0.45: a walker or a bollard leaves a contact shadow, not a black pool)
  float ao = max(0.45, 1.0 - occ * uIntensity * 5.0 / float(N));
  gl_FragColor = vec4(ao, dist, 0.0, 1.0);
}`;
  // The history (issue 375): this frame's occlusion (tAO, half size, r the occlusion, g the distance) with the last
  // frame's result (tHist) where it lands: uReproj takes this frame's view space to the last frame's clip space.
  // The last frame's value is taken only where the distance it stored is the distance this point had then, and
  // only within the range this frame's 3 x 3 neighbours span (a trail behind a walker falls outside it).
  const RESOLVE = `
${DEPTH}
uniform sampler2D tAO, tHist; uniform mat4 uReproj; uniform vec2 uTexel, uHalf; uniform float uHistOn, uKeep;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float lo = c.r, hi = c.r;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    float a = texture2D(tAO, vUv + vec2(float(i), float(j)) * uHalf).r;
    lo = min(lo, a); hi = max(hi, a);
  }
  float ao = c.r;
  if (uHistOn > 0.5 && c.g < 1e4) {
    vec2 uv = (floor(vUv / uTexel) + 0.5) * uTexel; // (the depth texel the occlusion was taken at)
    vec4 q = uReproj * vec4(oeView(uv, oeD(uv)), 1.0);
    vec2 pv = q.xy / q.w * 0.5 + 0.5;
    if (q.w > 0.0 && all(greaterThan(pv, vec2(0.0))) && all(lessThan(pv, vec2(1.0)))) {
      vec2 h = texture2D(tHist, pv).rg;
      float ok = 1.0 - smoothstep(0.5, 1.0, abs(h.g - q.w) / (0.03 * q.w + 0.06));
      // (a little room past the neighbours' range: the clamp should catch a trail, not flatten the noise's average)
      float pad = 0.15 * (hi - lo) + 0.02;
      ao = mix(c.r, clamp(h.r, lo - pad, hi + pad), uKeep * ok);
    }
  }
  gl_FragColor = vec4(ao, c.g, 0.0, 1.0);
}`;
  // a depth-aware blur along one axis at half size: r the occlusion, g the distance
  const BLUR = `
uniform sampler2D tAO; uniform vec2 uStep; varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float sum = c.r, w = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 s = texture2D(tAO, vUv + uStep * float(i)).rg;
    float k = exp(-float(i * i) / 8.0) * max(0.0, 1.0 - abs(s.g - c.g) / (0.04 * c.g + 0.05));
    sum += s.r * k; w += k;
  }
  gl_FragColor = vec4(sum / w, c.g, 0.0, 1.0);
}`;
  // The occlusion at a full-resolution pixel, for the pass that reads the scene (the lens, or the merge before the
  // camera's effects): 1 where there is none. Upsampled by depth: the four half-size texels round the pixel, each
  // by its bilinear weight and how near its depth is. With uAOStrength 0 (off, or no depth) it costs no texture read.
  const UPSAMPLE = `
${DEPTH}
uniform sampler2D tAO; uniform vec2 uHalfPx; uniform float uAOStrength, uFadeNear, uFadeFar;
float oeShade(vec2 uv) {
  if (uAOStrength <= 0.0) return 1.0;
  float d = oeD(uv);
  if (oeSky(d)) return 1.0;
  float dist = -oeView(uv, d).z;
  vec2 st = uv / uHalfPx - 0.5, f = fract(st), b = (floor(st) + 0.5) * uHalfPx;
  vec2 t00 = texture2D(tAO, b).rg, t10 = texture2D(tAO, b + vec2(uHalfPx.x, 0.0)).rg;
  vec2 t01 = texture2D(tAO, b + vec2(0.0, uHalfPx.y)).rg, t11 = texture2D(tAO, b + uHalfPx).rg;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 dz = abs(vec4(t00.g, t10.g, t01.g, t11.g) - dist) / (0.02 * dist + 0.05);
  w *= 1.0 / (1.0 + dz * dz) + 1e-4;
  float ao = dot(w, vec4(t00.r, t10.r, t01.r, t11.r)) / dot(w, vec4(1.0));
  return mix(1.0, ao, uAOStrength * (1.0 - smoothstep(uFadeNear, uFadeFar, dist)));
}`;
  // the same for the bloom's bright pass, which is drawn at the occlusion's own size: its texel, as it is
  const COARSE = `
uniform sampler2D tAO; uniform float uAOStrength, uFadeNear, uFadeFar;
float oeShade(vec2 uv) {
  if (uAOStrength <= 0.0) return 1.0;
  vec2 a = texture2D(tAO, uv).rg;
  return mix(1.0, a.r, uAOStrength * (1.0 - smoothstep(uFadeNear, uFadeFar, a.g)));
}`;

  function create(renderer, camera, { tier = 'medium' } = {}) {
    const q = new URLSearchParams(location.search).get('ao');
    let level = q === '0' ? 0 : tier === 'high' ? 2 : 1;
    const show = q === 'show'; // the occlusion alone, to look at
    const top = level, pinned = q === '1' || q === 'show';
    let asked = level; // the level set (the tier's, or a still's or the menu's): the governor's ceiling is over it
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry(); // one triangle over the frame: no diagonal seam shaded twice
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const quad = new THREE.Mesh(tri);
    quad.frustumCulled = false;
    const draw = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, quadCam); };
    const half = () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const A = half(), B = half(), H = [half(), half()]; // (H: the history, this frame's and the last)
    const reversed = renderer.capabilities.reversedDepthBuffer ? 1 : 0;
    const common = () => ({ tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uReversed: { value: reversed } });
    const aoMat = n => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: AO(n), depthTest: false, depthWrite: false,
      uniforms: Object.assign(common(), { uProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uAspect: { value: 1 },
        uRadius: { value: 1.8 }, uGrow: { value: 0.016 }, uMaxR: { value: 0.12 }, uIntensity: { value: 3.0 }, uFadeFar: { value: 420 }, uFrame: { value: 0 } }) });
    const mats = { 1: aoMat(LEVELS[1].samples), 2: aoMat(LEVELS[2].samples) };
    const resolveMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: RESOLVE, depthTest: false, depthWrite: false,
      uniforms: Object.assign(common(), { tAO: { value: null }, tHist: { value: null }, uReproj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2() }, uHistOn: { value: 0 }, uKeep: { value: 0.9 } }) });
    const blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: { tAO: { value: null }, uStep: { value: new THREE.Vector2() } } });
    // what the pass that reads the scene takes (UPSAMPLE): shared objects, so one write here reaches every material
    const uniforms = Object.assign(common(), { tAO: { value: null }, uHalfPx: { value: new THREE.Vector2() }, uAOStrength: { value: 0 }, uFadeNear: { value: 160 }, uFadeFar: { value: 420 } });
    let night = 0;
    // (the stack's entry for it: on or off, its size, and what the warm-up compiles: atmosphere.js)
    const pass = {
      enabled: level > 0, materials: [mats[1], mats[2], resolveMat, blurMat], quadGeometry: tri,
      setSize(w, h) {
        const hw = Math.max(2, Math.ceil(w / 2)), hh = Math.max(2, Math.ceil(h / 2));
        A.setSize(hw, hh); B.setSize(hw, hh); H[0].setSize(hw, hh); H[1].setSize(hw, hh); fresh = true;
        resolveMat.uniforms.uTexel.value.set(1 / w, 1 / h); resolveMat.uniforms.uHalf.value.set(1 / hw, 1 / hh);
        for (const m of Object.values(mats)) { m.uniforms.uTexel.value.set(1 / w, 1 / h); m.uniforms.uAspect.value = w / Math.max(1, h); }
        uniforms.uHalfPx.value.set(1 / hw, 1 / hh);
      },
      dispose() { A.dispose(); B.dispose(); H[0].dispose(); H[1].dispose(); for (const m of [mats[1], mats[2], resolveMat, blurMat]) m.dispose(); tri.dispose(); },
    };
    // The occlusion for this frame from the scene's depth, into the half-size texture the lens reads. False (and
    // a strength of 0, so the lens reads nothing) when it is off or there is no depth to read.
    // the history: the last frame's view-projection, and whether there is one to take (none after a resize, a frame
    // without the occlusion, or a cut: the camera jumped further than a car goes in a frame or turned a right angle)
    let frame = 0, fresh = true, cur = 0;
    const prevVP = new THREE.Matrix4(), vp = new THREE.Matrix4(), prevPos = new THREE.Vector3(), prevDir = new THREE.Vector3(), dir = new THREE.Vector3();
    function compute(r, depth) {
      const L = LEVELS[level];
      uniforms.uAOStrength.value = 0;
      if (!L || !depth || !pass.enabled) { fresh = true; return false; }
      const prevAuto = r.autoClear;
      r.autoClear = false;
      camera.updateMatrixWorld();
      const m = mats[level];
      m.uniforms.tDepth.value = uniforms.tDepth.value = depth;
      m.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse); uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      m.uniforms.uProj.value.copy(camera.projectionMatrix);
      m.uniforms.uFrame.value = TAA ? frame++ % 64 : 0;
      draw(m, A);
      const sx = 1 / A.width, sy = 1 / A.height;
      let src = A;
      if (TAA) {
        camera.getWorldDirection(dir);
        const cut = fresh || camera.position.distanceToSquared(prevPos) > 30 * 30 || dir.dot(prevDir) < 0.7;
        const R = resolveMat.uniforms, dst = H[cur];
        R.tDepth.value = depth; R.uInvProj.value.copy(camera.projectionMatrixInverse);
        R.tAO.value = A.texture; R.tHist.value = H[1 - cur].texture; R.uHistOn.value = cut ? 0 : 1;
        R.uReproj.value.multiplyMatrices(prevVP, camera.matrixWorld); // (this frame's view space to the last frame's clip space)
        draw(resolveMat, dst);
        vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); prevVP.copy(vp);
        prevPos.copy(camera.position); prevDir.copy(dir); fresh = false; cur = 1 - cur;
        src = dst;
      }
      for (let i = 0; i < L.blurs; i++) {
        blurMat.uniforms.tAO.value = src.texture; blurMat.uniforms.uStep.value.set(sx, 0); draw(blurMat, B);
        blurMat.uniforms.tAO.value = B.texture; blurMat.uniforms.uStep.value.set(0, sy); draw(blurMat, A);
        src = A;
      }
      uniforms.tAO.value = src.texture;
      uniforms.uAOStrength.value = 0.85 * (1 - 0.35 * night);
      r.autoClear = prevAuto;
      return true;
    }
    return {
      pass, compute, uniforms, show,
      // per frame from atmosphere.js, drawn or not: how far into the night it is (0..1)
      update(n) { night = n; pass.enabled = level > 0; },
      // 0 off, 1 lite, 2 full (no higher than the tier's own); for stills, films and the menu
      set(v) { asked = level = Math.max(0, Math.min(top || 2, v | 0)); pass.enabled = level > 0; },
      // forget the history (a cut the camera's own jump does not show: a film's next shot from nearby)
      reset() { fresh = true; },
      // the governor's ceiling (0, 1 or 2) on the level set; lifted again with limit(2)
      limit(v) { if (!pinned) level = Math.min(asked, Math.max(0, v | 0)); pass.enabled = level > 0; },
      get level() { return level; },
    };
  }
  return { create, LEVELS, UPSAMPLE, COARSE };
})();
