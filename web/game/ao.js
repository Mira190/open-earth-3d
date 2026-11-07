// Open Earth 3D ambient occlusion: contact shadows where facades meet the street, under eaves,
// awnings, benches, cars and trees, and in the corners of a square, on the medium and high tiers.
//
// One pass in the game's post stack (atmosphere.js), straight after the scene is drawn and before
// the bloom. It needs nothing but the depth buffer the scene was drawn with (the composer's target
// resolves it for this; the reversed float depth of game.js or an ordinary one), so the city is
// not drawn a second time:
//   1. at half the screen's size, each pixel's position is rebuilt from depth and its normal from
//      the neighbour on each side that lies nearest its plane (so an edge does not bend it); a
//      spiral of samples round it in a disc of a few metres, rotated per pixel by interleaved
//      gradient noise, gathers the occlusion with the falloff of McGuire's Scalable Ambient
//      Obscurance (f = (R^2 - v.v)^3 * max(v.n - bias, 0) / (v.v + e));
//   2. two depth-aware blurs at half size take the noise out without bleeding across an edge;
//   3. a depth-aware upsample (of the four half-size texels round each pixel, those at its own
//      depth) darkens the frame by it, fading out with distance so the far city and the sky keep
//      the photograph's look, and a little at night, when the light is the street's own.
// It is the approach of N8AO (N8python, CC0), written here for three.js r186's reversed float
// depth, which N8AO does not read. See docs/LOOK.md for the survey and what was adopted.
//
// A frame-time budget watches the frame: on a GPU that cannot keep up, AO steps down to half the
// samples and one blur, then off; if stepping down did not make the frame faster, AO was not the
// cost and its level comes back. A software renderer (only ever on a forced tier, for stills and
// films) keeps it on. ?ao=0 in the page's address turns it off, ?ao=1 keeps it on whatever the budget,
// ?ao=show shows the occlusion alone.
'use strict';
window.OEAO = (function () {
  const LEVELS = [
    null,                              // 0: off
    { samples: 8, blurs: 1 },          // 1: lite (medium tier, or a high tier over budget)
    { samples: 16, blurs: 2 },         // 2: full (high tier)
  ];
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
uniform mat4 uProj; uniform vec2 uTexel; uniform float uAspect, uRadius, uGrow, uMaxR, uIntensity, uFadeFar;
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
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float bias = 0.02 + dist * 0.0015, occ = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
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
  // the frame darkened by it, upsampled by depth
  const MIX = `
${DEPTH}
uniform sampler2D tColor, tAO; uniform vec2 uHalfPx; uniform float uStrength, uFadeNear, uFadeFar, uShow;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tColor, vUv);
  float d = oeD(vUv);
  if (oeSky(d)) { gl_FragColor = col; return; }
  float dist = -oeView(vUv, d).z;
  // the four half-size texels round the pixel, each by its bilinear weight and how near its depth is
  vec2 st = vUv / uHalfPx - 0.5, f = fract(st), b = (floor(st) + 0.5) * uHalfPx;
  vec2 t00 = texture2D(tAO, b).rg, t10 = texture2D(tAO, b + vec2(uHalfPx.x, 0.0)).rg;
  vec2 t01 = texture2D(tAO, b + vec2(0.0, uHalfPx.y)).rg, t11 = texture2D(tAO, b + uHalfPx).rg;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 dz = abs(vec4(t00.g, t10.g, t01.g, t11.g) - dist) / (0.02 * dist + 0.05);
  w *= 1.0 / (1.0 + dz * dz) + 1e-4;
  float ao = dot(w, vec4(t00.r, t10.r, t01.r, t11.r)) / dot(w, vec4(1.0));
  float k = uStrength * (1.0 - smoothstep(uFadeNear, uFadeFar, dist));
  gl_FragColor = vec4(uShow > 0.5 ? vec3(mix(1.0, ao, k)) : col.rgb * mix(1.0, ao, k), col.a);
}`;

  function create(renderer, camera, { tier = 'medium', budgetMs = null } = {}) {
    const q = new URLSearchParams(location.search).get('ao');
    let level = q === '0' ? 0 : tier === 'high' ? 2 : 1;
    const show = q === 'show'; // the occlusion alone, to look at
    const top = level, pinned = q === '1' || q === 'show';
    let software = !!(window.OEQuality && OEQuality.probe().software);
    let budget = budgetMs || (tier === 'high' ? 1000 / 50 : 1000 / 40);
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const draw = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, quadCam); };
    const half = () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const A = half(), B = half();
    const reversed = renderer.capabilities.reversedDepthBuffer ? 1 : 0;
    const common = () => ({ tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uReversed: { value: reversed } });
    const aoMat = n => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: AO(n), depthTest: false, depthWrite: false,
      uniforms: Object.assign(common(), { uProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uAspect: { value: 1 },
        uRadius: { value: 1.8 }, uGrow: { value: 0.016 }, uMaxR: { value: 0.12 }, uIntensity: { value: 3.0 }, uFadeFar: { value: 420 } }) });
    const mats = { 1: aoMat(LEVELS[1].samples), 2: aoMat(LEVELS[2].samples) };
    const blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: { tAO: { value: null }, uStep: { value: new THREE.Vector2() } } });
    const mixMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: MIX, depthTest: false, depthWrite: false,
      uniforms: Object.assign(common(), { tColor: { value: null }, tAO: { value: null }, uHalfPx: { value: new THREE.Vector2() }, uStrength: { value: 0.85 }, uShow: { value: 0 }, uFadeNear: { value: 160 }, uFadeFar: { value: 420 } }) });
    let night = 0;
    // the frame-time budget: an average over about a second; over budget for 3 s steps down once,
    // and 3 s later a step that bought nothing is taken back and the budget rests, a minute, then two...
    const B$ = { ema: 0, over: 0, last: 0, trial: null, rest: 0, misses: 0, sim: false };
    function watch(now) {
      const ms = B$.last ? now - B$.last : 0;
      B$.last = now;
      if (!ms || ms > 250) return; // the first frame, or back from a hidden tab
      B$.ema = B$.ema ? B$.ema * 0.95 + ms * 0.05 : ms;
      if (pinned || software || now < B$.rest) return;
      if (B$.trial && now - B$.trial.t > 3000) {
        if (B$.ema > B$.trial.ema * 0.92) { level = B$.trial.from; B$.rest = now + 60000 * 2 ** B$.misses++; } // not the AO's cost: back as it was, and a longer rest each time
        B$.trial = null; B$.over = 0;
        return;
      }
      if (B$.trial || level === 0) return;
      B$.over = B$.ema > budget ? B$.over + ms : 0;
      if (B$.over > 3000) { B$.trial = { from: level, ema: B$.ema, t: now }; level -= 1; B$.over = 0; }
    }
    const pass = {
      enabled: level > 0, needsSwap: true, clear: false, renderToScreen: false,
      materials: [mats[1], mats[2], blurMat, mixMat], quadGeometry: quad.geometry, // (what the post stack's warm-up compiles: atmosphere.js)
      setSize(w, h) {
        const hw = Math.max(2, Math.ceil(w / 2)), hh = Math.max(2, Math.ceil(h / 2));
        A.setSize(hw, hh); B.setSize(hw, hh);
        for (const m of Object.values(mats)) { m.uniforms.uTexel.value.set(1 / w, 1 / h); m.uniforms.uAspect.value = w / Math.max(1, h); }
        mixMat.uniforms.uHalfPx.value.set(1 / hw, 1 / hh);
      },
      render(r, writeBuffer, readBuffer) {
        const L = LEVELS[level];
        mixMat.uniforms.uStrength.value = 0; // (without a depth buffer the frame passes through)
        const prevAuto = r.autoClear;
        r.autoClear = false;
        camera.updateMatrixWorld();
        const depth = readBuffer.depthTexture;
        for (const m of [mats[1], mats[2], mixMat]) { m.uniforms.tDepth.value = depth; m.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse); }
        if (L && depth) {
          const m = mats[level];
          m.uniforms.uProj.value.copy(camera.projectionMatrix);
          draw(m, A);
          const sx = 1 / A.width, sy = 1 / A.height;
          for (let i = 0; i < L.blurs; i++) {
            blurMat.uniforms.tAO.value = A.texture; blurMat.uniforms.uStep.value.set(sx, 0); draw(blurMat, B);
            blurMat.uniforms.tAO.value = B.texture; blurMat.uniforms.uStep.value.set(0, sy); draw(blurMat, A);
          }
          mixMat.uniforms.uStrength.value = 0.85 * (1 - 0.35 * night);
        }
        mixMat.uniforms.tColor.value = readBuffer.texture;
        mixMat.uniforms.uShow.value = show ? 1 : 0;
        mixMat.uniforms.tAO.value = A.texture;
        draw(mixMat, this.renderToScreen ? null : writeBuffer);
        r.autoClear = prevAuto;
      },
      dispose() { A.dispose(); B.dispose(); for (const m of [mats[1], mats[2], blurMat, mixMat]) m.dispose(); quad.geometry.dispose(); },
    };
    return {
      pass,
      // per frame from atmosphere.js, drawn or not: how far into the night it is (0..1), and the budget
      update(n) { night = n; if (!B$.sim) watch(performance.now()); pass.enabled = level > 0; },
      // 0 off, 1 lite, 2 full (no higher than the tier's own); for stills, films and the menu
      set(v) { level = Math.max(0, Math.min(top || 2, v | 0)); pass.enabled = level > 0; B$.trial = null; B$.over = 0; },
      get level() { return level; },
      get frameMs() { return B$.ema; },
      // for tools/ao_cost.js: a budget in ms that also holds on a software renderer
      testBudget(ms) { budget = ms; software = false; B$.rest = 0; B$.misses = 0; B$.trial = null; B$.over = 0; },
      // for tools/ao_cost.js: the budget fed frames of the given lengths (ms) on a clock of its own,
      // as a GPU would show them; frameOf(level) gives each frame's length at the level then set.
      // Returns the level after each simulated second. The real frames are not watched meanwhile.
      testFrames(seconds, frameOf) {
        B$.sim = true; Object.assign(B$, { ema: 0, over: 0, last: 0, trial: null, rest: 0, misses: 0 });
        const seen = []; let t = 1e6;
        for (let s = 0; s < seconds; s++) {
          for (const end = t + 1000; t < end;) { t += frameOf(level); watch(t); }
          seen.push(level);
        }
        B$.sim = false; B$.last = 0; B$.ema = 0; B$.rest = 0; B$.trial = null; B$.over = 0;
        pass.enabled = level > 0;
        return seen.join('');
      },
    };
  }
  return { create, LEVELS };
})();
