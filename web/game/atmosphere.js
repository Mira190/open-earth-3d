// Open Earth 3D game atmosphere: what the game adds to the shared world's sky and light.
// Clouds drift over the city (the r186 Sky's own cloud layer; the model viewer keeps a
// clear sky for its analysis). After dark the stars come out where they really are for the
// city and the time (bright named stars, the Southern Cross among them, and a scatter of
// fainter ones), and the moon rises in its place in its real phase. The frame goes through
// a post stack: HDR bloom (lamps at night, glints on the water by day), then the title
// screen's lens (lens.js: its tone curve, grade, grain and vignette), or without it the
// world's own tone curve, a slight grade and a vignette.
'use strict';
window.OEAtmos = (function () {
  const RAD = Math.PI / 180;
  // [RA hours, Dec degrees, magnitude]: the brightest stars and the asterisms people look for
  const BRIGHT = [
    [6.752, -16.72, -1.46], [6.399, -52.70, -0.74], [14.660, -60.83, -0.27], [14.261, 19.18, -0.05], [18.616, 38.78, 0.03],
    [5.278, 45.99, 0.08], [5.242, -8.20, 0.13], [7.655, 5.22, 0.34], [1.629, -57.24, 0.46], [5.919, 7.41, 0.50], [14.064, -60.37, 0.61],
    [19.846, 8.87, 0.76], [12.443, -63.10, 0.77], [4.599, 16.51, 0.86], [16.490, -26.43, 0.96], [13.420, -11.16, 0.97], [7.755, 28.03, 1.14],
    [22.961, -29.62, 1.16], [20.690, 45.28, 1.25], [12.795, -59.69, 1.25], [10.140, 11.97, 1.35], [12.519, -57.11, 1.59], [12.252, -58.75, 2.79],
    [12.356, -60.40, 3.59], [5.679, -1.94, 1.77], [5.604, -1.20, 1.69], [5.533, -0.30, 2.23], [5.418, 6.35, 1.64], [5.796, -9.67, 2.06],
    [2.530, 89.26, 1.98], [11.062, 61.75, 1.79], [12.900, 55.96, 1.77], [13.792, 49.31, 1.86], [17.560, -37.10, 1.62], [8.159, -47.34, 1.83],
    [9.220, -69.72, 1.67], [8.375, -59.51, 1.86], [22.137, -46.96, 1.74], [20.427, -56.73, 1.94], [0.140, 29.09, 2.06], [3.405, 49.86, 1.79],
  ];

  // a low-precision lunar ephemeris (after Meeus, as in suncalc): right ascension and
  // declination in radians for a UTC time
  function moonRaDec(utcMs) {
    const d = utcMs / 864e5 - 10957.5, e = 23.4397 * RAD;
    const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.229350 * d) * RAD;
    const lon = L + 6.289 * RAD * Math.sin(M), lat = 5.128 * RAD * Math.sin(F);
    return { ra: Math.atan2(Math.sin(lon) * Math.cos(e) - Math.tan(lat) * Math.sin(e), Math.cos(lon)),
      dec: Math.asin(Math.sin(lat) * Math.cos(e) + Math.cos(lat) * Math.sin(e) * Math.sin(lon)) };
  }
  // the turn of the sky: columns take an equatorial unit vector (x to RA 0, z to the north
  // celestial pole) into the scene frame (x east, y up, z south)
  function skyBasis(utcMs, lat, lon, out) {
    const d = utcMs / 864e5 - 10957.5, lst = (280.16 + 360.9856235 * d) * RAD + lon * RAD, phi = lat * RAD;
    const N = new THREE.Vector3(0, 0, -1), Up = new THREE.Vector3(0, 1, 0), West = new THREE.Vector3(-1, 0, 0);
    const P = N.clone().multiplyScalar(Math.cos(phi)).addScaledVector(Up, Math.sin(phi));           // the celestial pole
    const Q = N.clone().multiplyScalar(-Math.sin(phi)).addScaledVector(Up, Math.cos(phi));          // the equator on the meridian
    const c1 = Q.clone().multiplyScalar(Math.cos(lst)).addScaledVector(West, Math.sin(lst));
    const c2 = Q.clone().multiplyScalar(Math.sin(lst)).addScaledVector(West, -Math.cos(lst));
    return out.makeBasis(c1, c2, P);
  }
  const eq = (ra, dec) => new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));

  function stars() {
    const pos = [], col = [], size = [];
    const add = (ra, dec, mag) => {
      const v = eq(ra, dec).multiplyScalar(18000);
      pos.push(v.x, v.y, v.z);
      const b = Math.pow(10, -0.4 * (mag - 1.5));
      const t = Math.random(), c = t < 0.2 ? [0.75, 0.82, 1] : t < 0.75 ? [1, 1, 1] : [1, 0.88, 0.72];
      col.push(...c.map(x => x * Math.min(1, 0.35 + 0.65 * b)));
      size.push(Math.min(5.5, 1.4 + 2.2 * Math.sqrt(b)));
    };
    for (const [h, dec, mag] of BRIGHT) add(h * 15 * RAD, dec * RAD, mag);
    // fainter stars, crowding towards the Milky Way's plane (north galactic pole RA 192.86, Dec 27.13)
    const gp = eq(192.86 * RAD, 27.13 * RAD);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2600; i++) {
      let v;
      do { v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
      v.normalize();
      if (Math.abs(v.dot(gp)) > 0.35 && rnd() < 0.55) { i--; continue; }
      add(Math.atan2(v.y, v.x), Math.asin(v.z), 3.2 + 3.0 * Math.pow(rnd(), 0.6));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uTime; uniform float uScale;
        void main() { vC = color * (0.85 + 0.15 * sin(uTime * 3.0 + position.x * 0.01 + position.y * 0.013));
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale; }`,
      fragmentShader: `varying vec3 vC; uniform float uOpacity;
        void main() { vec2 p = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(p)); gl_FragColor = vec4(vC * a * uOpacity, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, mat);
    pts.matrixAutoUpdate = false;
    pts.frustumCulled = false;
    pts.renderOrder = -1;
    return pts;
  }

  // the moon: a disc facing the camera, lit as a sphere from the sun's direction, with
  // maria from a few blobs of noise and a little earthshine on the dark side
  function moon() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main() { vP = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vP; uniform vec3 uSun; uniform float uOpacity;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float r = length(vP); if (r > 1.0) discard;
          vec3 N = vec3(vP, sqrt(1.0 - r * r));
          float lit = smoothstep(-0.04, 0.06, dot(N, normalize(uSun)));
          float maria = smoothstep(0.45, 0.75, n(vP * 2.3 + 3.1) * 0.6 + n(vP * 5.0) * 0.4);
          float albedo = mix(0.95, 0.62, maria) * (0.9 + 0.1 * n(vP * 14.0));
          vec3 c = vec3(1.0, 0.97, 0.9) * albedo * (lit * (0.35 + 0.65 * N.z) + 0.035);
          gl_FragColor = vec4(c * 2.2, smoothstep(1.0, 0.97, r) * uOpacity);
        }`,
      transparent: true, depthWrite: false, fog: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.frustumCulled = false;
    m.renderOrder = -1;
    return m;
  }

  // a grade and vignette after tone mapping (sRGB in, sRGB out)
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.22 }, uSat: { value: 1.14 }, uContrast: { value: 1.08 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform float uContrast; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, uSat);
        c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
        vec2 q = vUv - 0.5;
        c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
      }`,
  };

  // Wd: the world (world.js); city: scene.city (lat, lon); sky: game.sky ({clouds, cloud_density})
  function create(Wd, renderer, camera, { city, sky = {} } = {}) {
    const su = Wd.su, world = Wd.world, basis = new THREE.Matrix4();
    const clouds = sky.clouds ?? 0.3;
    if (su.cloudCoverage) {
      su.cloudCoverage.value = clouds; su.cloudDensity.value = sky.cloud_density ?? 0.45;
      su.cloudScale.value = 0.00022; su.cloudSpeed.value = 0.00003; su.cloudElevation.value = 0.55;
    }
    const skySat = sky.saturation ?? 1.7; // a blue sky rather than a white one (world.js)
    const S = stars(), M = moon();
    world.add(S, M);
    // the post stack, where the GPU can render to half-float targets (measured by quality.js),
    // with the tier's multisampling; elsewhere the scene goes straight to the screen
    let composer = null, bloom = null, grade = null, lens = null;
    const QC = window.OEQuality ? window.OEQuality.city() : { post: true, samples: 4 };
    const canPost = THREE.EffectComposer && renderer.capabilities.isWebGL2 && sky.post !== false && QC.post;
    if (canPost) {
      const size = renderer.getSize(new THREE.Vector2());
      // with the game's reversed depth buffer (game.js), a 32-bit float depth: it resolves a few
      // millimetres at two kilometres, where 24 bits behind a 0.3 m near plane resolve a metre, so
      // distant walls and roofs no longer fight over the same pixels as the camera moves
      const deep = renderer.capabilities.reversedDepthBuffer ? new THREE.DepthTexture(size.x, size.y, THREE.FloatType) : null;
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: QC.samples, depthTexture: deep });
      if (deep) rt.resolveDepthBuffer = false; // only its format is wanted, not the texture
      composer = new THREE.EffectComposer(renderer, rt);
      composer.addPass(new THREE.RenderPass(world, camera));
      bloom = new THREE.UnrealBloomPass(size.clone(), 0.15, 0.4, 6.0);
      composer.addPass(bloom);
      if (window.OELens && sky.lens !== false) {
        // the title screen's lens (lens.js): its tone curve, grade, grain and vignette, so the city
        // looks as the Earth does on the title and as the city does in its film
        lens = new THREE.ShaderPass(OELens.shader());
        Object.assign(lens.uniforms, { uGrain: { value: 0.03 }, uCA: { value: 0.15 }, uVignette: { value: 0.18 } });
        lens.uniforms.uAspect.value = size.x / Math.max(1, size.y);
        composer.addPass(lens);
      } else {
        composer.addPass(new THREE.OutputPass());
        grade = new THREE.ShaderPass(GRADE);
        composer.addPass(grade);
      }
    }
    const q = new THREE.Quaternion();
    let night = 0;
    const api = {
      composer, lens, stars: S, moon: M,
      // per frame: the sky's turn for this moment, the moon's place and phase, the clouds' drift
      update(utcMs, tSec, U) {
        night = U.uNight.value;
        if (su.time) su.time.value = tSec;
        if (su.uSkySat) su.uSkySat.value = 1 + (skySat - 1) * (1 - night); // not the night sky's red
        skyBasis(utcMs, city.lat, city.lon, basis);
        S.matrix.copy(basis).setPosition(camera.position);
        S.matrixWorldNeedsUpdate = true;
        S.material.uniforms.uOpacity.value = night * (1 - 0.6 * clouds);
        S.material.uniforms.uTime.value = tSec;
        S.material.uniforms.uScale.value = renderer.getPixelRatio();
        S.visible = night > 0.02;
        const md = moonRaDec(utcMs), dir = eq(md.ra, md.dec).applyMatrix4(basis).normalize();
        M.visible = dir.y > -0.02;
        M.position.copy(camera.position).addScaledVector(dir, 17000);
        M.quaternion.copy(camera.quaternion);
        M.scale.setScalar(17000 * Math.tan(0.26 * RAD) * 2 * 1.7);   // the moon's half a degree, a little larger as people remember it
        // the sun's direction in the disc's own frame, so the lit limb faces the sun
        q.copy(camera.quaternion).invert();
        M.material.uniforms.uSun.value.copy(Wd.sunDir).applyQuaternion(q);
        M.material.uniforms.uOpacity.value = 0.25 + 0.75 * night;
        if (bloom) { bloom.threshold = 6.0 - 4.4 * night; bloom.strength = 0.15 + 0.15 * night; }
        if (lens) {
          const L = lens.uniforms;
          L.uExposure.value = renderer.toneMappingExposure * 1.1; // the world's exposure, set for ACES, a little brighter under the film curve
          L.uLift.value = 1 - 0.7 * night;                         // at night the city keeps its blacks
          L.uContrast.value = 0.1 + 0.18 * night;
          L.uNightTone.value = night;                              // blue between the lights, amber in them
          L.uSat.value = 1.06;
          L.uTime.value = tSec;
        }
      },
      setSize(w, h) { if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } if (lens) lens.uniforms.uAspect.value = w / Math.max(1, h); },
      // draw the frame: through the post stack, or plainly
      render(scene, cam) { if (composer) composer.render(); else renderer.render(scene, cam); },
      dispose() { if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); } },
    };
    return api;
  }

  return { create, moonRaDec, skyBasis };
})();
