// Open Earth 3D game atmosphere: what the game adds to the shared world's sky and light.
// Clouds drift over the city (the r186 Sky's own cloud layer; the model viewer keeps a
// clear sky for its analysis). After dark the stars come out where they really are for the
// city and the time (bright named stars, the Southern Cross among them, and a scatter of
// fainter ones), and the moon rises in its place in its real phase. The frame goes through
// a post stack: contact shadows (ao.js, on the medium and high tiers), HDR bloom (lamps at
// night, glints on the water by day), then the title screen's lens (lens.js: its tone curve,
// grade, grain and vignette), or without it the world's own tone curve, a slight grade and a
// vignette.
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

  function stars(su) {
    const cl = !!(su && su.uCloudTex && window.OEClouds); // the clouds hide the stars behind them (clouds.js oeCloudCover, at each star)
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
      uniforms: Object.assign({ uOpacity: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } },
        cl ? { uCloudTex: su.uCloudTex, cloudCoverage: su.cloudCoverage, uCloudK: su.uCloudK, uCloudDrift: su.uCloudDrift, uCloudFair: su.uCloudFair } : {}),
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uTime; uniform float uScale;
        ${cl ? 'uniform sampler2D uCloudTex; uniform float cloudCoverage, uCloudFair; uniform vec4 uCloudK, uCloudDrift;' + OEClouds.COVER : ''}
        void main() { vC = color * (0.85 + 0.15 * sin(uTime * 3.0 + position.x * 0.01 + position.y * 0.013));
          ${cl ? 'vC *= 1.0 - oeCloudCover(normalize(mat3(modelMatrix) * position));' : ''}
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

  // The grade through the day, under the title's lens: keyed on the sun's height (degrees), each key
  // an exposure (ev, on the world's own), a white balance (tint), a saturation and the curve's
  // contrast. By day a little warmth and contrast; in the golden hour warmer; in the blue hour a
  // lift and a cool balance, so the dusk sky and the first lights read together rather than the
  // street going grey; at night the deepest contrast, with lens.js uNightTone taking the shadows to
  // blue and the lights to amber. A city can key its own (game.look.grade: {night, blue, golden, day}).
  const GRADE_KEYS = [['night', -12], ['blue', -4], ['golden', 3], ['day', 20]];
  const GRADE_DEF = {
    night: { ev: 1.1, tint: [1, 1, 1], sat: 1.06, contrast: 0.28 },
    blue: { ev: 1.18, tint: [0.98, 0.99, 1.03], sat: 1.08, contrast: 0.2 },
    golden: { ev: 1.08, tint: [1.05, 1.0, 0.93], sat: 1.1, contrast: 0.15 },
    day: { ev: 1.04, tint: [1.02, 1.0, 0.97], sat: 1.08, contrast: 0.14 },
  };
  // A region's look (game.look.preset in cities/<id>/city.json; docs/LOOK.md): "film" everywhere, "shinkai" on the
  // Japanese maps. Each is numbers for what is already drawn: the sky and its clouds (clouds.js), the hour's grade,
  // the lens (lens.js) and the shade's colour (world.js). No preset adds a pass.
  //   sky     saturation of the day's sky; clouds: the fair-weather cover; towers: cumulus standing on the horizon;
  //           high: altocumulus and cirrus; edge: how drawn the clouds' edges are; glow: the sun through thin cloud;
  //           milky: the Milky Way on a clear night; meteors: shooting stars an hour on a clear night
  //   grade   the hour's grade on GRADE_DEF's (ev, tint, sat, contrast) and the lens's split tone: shade and hi (what the
  //           shadows and the lit parts are multiplied by), lift (what the deepest shade is lifted towards), vib (vibrance)
  //   light   shade: the colour of the light in the shade by day (the sky's, world.js's hemisphere light), bounce: how much
  //           of the sun's light the ground throws back up onto walls; flare and shafts: the sun in the lens
  const LOOKS = {
    film: { palette: 'film', light: { shade: [0.74, 0.84, 0.95], bounce: 0.3, flare: 0.55, shafts: 0.5 },
      grade: { night: { vib: 0.1 }, blue: { vib: 0.15, lift: [0.0, 0.004, 0.012] }, golden: { vib: 0.18, shade: [0.95, 0.98, 1.07], hi: [1.03, 1.0, 0.96] }, day: { vib: 0.18, shade: [0.95, 0.99, 1.06] } },
      sky: { saturation: 1.7, clouds: 0.3, towers: 0.45, high: 0.4, edge: 0.3, glow: 0.5, milky: 0.35, meteors: 6 } },
    shinkai: { palette: 'shinkai', light: { shade: [0.62, 0.76, 1.0], bounce: 0.5, flare: 0.9, shafts: 1.0 },
      grade: {
        night: { sat: 1.14, vib: 0.25, lift: [0.0, 0.003, 0.014] },
        blue: { ev: 1.24, tint: [0.97, 0.98, 1.06], sat: 1.2, vib: 0.35, shade: [0.92, 0.94, 1.12], hi: [1.05, 0.99, 0.98], lift: [0.006, 0.006, 0.03] },
        golden: { tint: [1.06, 1.0, 0.92], sat: 1.18, vib: 0.4, shade: [0.92, 0.9, 1.14], hi: [1.05, 1.0, 0.94], lift: [0.012, 0.006, 0.03] },
        day: { ev: 1.06, tint: [1.02, 1.0, 0.98], sat: 1.14, vib: 0.42, contrast: 0.16, shade: [0.93, 0.98, 1.1], hi: [1.02, 1.0, 0.97], lift: [0.0, 0.005, 0.016] },
      },
      sky: { saturation: 1.95, clouds: 0.3, towers: 1.0, high: 0.5, edge: 0.45, glow: 0.8, milky: 1.0, meteors: 24 } },
  };
  // (each key may also carry the lens's split tone and vibrance: shade, hi, lift, vib; lens.js)
  const GRADE_LENS = { shade: [0.97, 1.0, 1.04], hi: [1.015, 1.0, 0.985], lift: [0, 0, 0], vib: 0 };
  function gradeAt(keys, alt, out) {
    let i = 0;
    while (i < GRADE_KEYS.length - 1 && alt > GRADE_KEYS[i + 1][1]) i++;
    const [a, a0] = GRADE_KEYS[i], [b, b0] = GRADE_KEYS[Math.min(i + 1, GRADE_KEYS.length - 1)];
    const t = b0 > a0 ? Math.max(0, Math.min(1, (alt - a0) / (b0 - a0))) : 0, k = t * t * (3 - 2 * t), A = keys[a], B = keys[b];
    out.ev = A.ev + (B.ev - A.ev) * k; out.sat = A.sat + (B.sat - A.sat) * k; out.contrast = A.contrast + (B.contrast - A.contrast) * k;
    for (let j = 0; j < 3; j++) out.tint[j] = A.tint[j] + (B.tint[j] - A.tint[j]) * k;
    for (const n of ['shade', 'hi', 'lift']) { const a = A[n] || GRADE_LENS[n], b = B[n] || GRADE_LENS[n], o = out[n] || (out[n] = [0, 0, 0]); for (let j = 0; j < 3; j++) o[j] = a[j] + (b[j] - a[j]) * k; }
    out.vib = (A.vib ?? 0) + ((B.vib ?? 0) - (A.vib ?? 0)) * k;
    return out;
  }

  // The camera's own effects, for photo mode and the opening shot only (never in play): depth of
  // field, a disc of 24 taps whose radius is the circle of confusion for the focus distance and the
  // lens, and the camera's motion blur, each pixel smeared along the way it moved on screen since
  // the last frame (its point rebuilt from the depth buffer the scene was drawn with, as the ambient
  // occlusion does, ao.js, put back into the world and seen from the last frame's camera). It reads the
  // depth the scene already wrote: a second pass drawing the whole city's distance from the camera
  // doubled the geometry in the opening shot and compiled a depth shader for every kind of mesh
  // (instanced, skinned) the moment the shot began, a freeze of seconds as the game opened.
  const CAMFX = () => ({ // (made when the stack is: this script runs before three.js has loaded)
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uReversed: { value: 0 }, uFocus: { value: 10 }, uAperture: { value: 0 }, uBlur: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uFar: { value: 3000 }, uAspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse, tDepth; uniform float uReversed, uFocus, uAperture, uBlur, uFar, uAspect; uniform mat4 uInvProj, uCamWorld, uPrevVP; varying vec2 vUv;
      // the point in the camera's frame: reversed depth ([1 at the near plane, 0 at the far one], clip control 0..1) or not
      vec3 viewAt(vec2 uv) { float z = texture2D(tDepth, uv).x; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, uReversed > 0.5 ? z : z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
      float dist(vec2 uv) { return min(length(viewAt(uv)), uFar); }
      float coc(float d) { return clamp(uAperture * abs(d - uFocus) / max(d, 0.1), 0.0, 0.025); } // (a fraction of the frame's height)
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float d = dist(vUv);
        if (uAperture > 0.0) {
          float r = coc(d), w = 1.0;
          if (r > 0.0007) {
            for (int i = 0; i < 24; i++) {
              float a = float(i) * 2.39996, q = sqrt((float(i) + 0.5) / 24.0);
              vec2 o = vec2(cos(a), sin(a)) * q * r * vec2(1.0 / uAspect, 1.0);
              float dn = dist(vUv + o), rn = coc(dn);
              float k = dn < d ? smoothstep(0.0, 1.0, rn / max(q * r, 1e-4)) : 1.0;   // a nearer, sharper sample doesn't bleed behind
              c += texture2D(tDiffuse, vUv + o).rgb * k; w += k;
            }
            c /= w;
          }
        }
        // The motion blur (issue 265: its 8 even taps up to 3% of the frame drew each edge as a row of jagged
        // copies, the far rock smeared over the near deck, and a cut smeared the whole frame): 12 taps offset
        // by a per-pixel noise (interleaved gradient noise, Jimenez 2014), so the steps dissolve into grain
        // instead of copies; a shorter streak; a sample further off than the pixel itself doesn't bleed over
        // it (only the nearer one smears over what is behind); and a jump of the camera (a cut, or the first
        // frame after a long one) draws no blur at all rather than a frame-wide smear.
        if (uBlur > 0.0) {
          vec4 wp = uCamWorld * vec4(normalize(viewAt(vUv)) * min(d, uFar * 0.99), 1.0), pp = uPrevVP * wp;
          vec2 prev = pp.xy / max(pp.w, 1e-4) * 0.5 + 0.5, raw = vUv - prev;
          float cut = 1.0 - smoothstep(0.05, 0.09, length(raw)) ;
          vec2 mv = raw * uBlur * cut;
          float ml = length(mv);
          if (ml > 0.012) mv *= 0.012 / ml;
          if (ml * float(textureSize(tDiffuse, 0).y) > 1.0) {
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            vec3 m = c; float w = 1.0;
            for (int i = 0; i < 12; i++) {
              vec2 uv = vUv - mv * ((float(i) + ign) / 12.0 - 0.5);
              float k = dist(uv) > d * 1.15 + 0.5 ? 0.15 : 1.0;
              m += texture2D(tDiffuse, uv).rgb * k; w += k;
            }
            c = m / w;
          }
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

  // The animated film's lens, for a map's overture only (overture.js; never in play, off unless asked):
  // after the title's lens, on the picture as it will be shown. In one pass and no target of its own:
  //   a painted look  a Kuwahara filter (each pixel takes the mean of whichever of its four quadrants is
  //                   the most even), which turns surfaces into flat brushed planes and keeps their edges,
  //                   as the painted backgrounds of animated films are; radius in pixels at 900 lines
  //   the grade       shadows lifted towards a clear blue, highlights warmed towards peach, colour where it
  //                   is weak given more than where it is already strong (vibrance)
  //   light           crepuscular rays from the sun where it is in frame (a march of 20 taps towards it over
  //                   the bright pixels), and a soft halation round the brightest
  const ANIME = () => ({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uReversed: { value: 0 }, uInvProj: { value: new THREE.Matrix4() }, uDepth: { value: 0 },
      uHaze: { value: new THREE.Vector3(0.2, 0.22, 0.4) }, uHazeD: { value: 1500 }, uHazeK: { value: 0 }, uRim: { value: 0 }, uRimC: { value: new THREE.Vector3(0.7, 0.6, 1.0) },
      uRes: { value: new THREE.Vector2(1, 1) }, uK: { value: 0 }, uRadius: { value: 3 }, uGrade: { value: 0 },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uRays: { value: 0 }, uStreak: { value: 0 }, uWarm: { value: new THREE.Vector3(1.0, 0.82, 0.62) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes, uSunUv; uniform float uK, uRadius, uGrade, uSunVis, uRays, uStreak, uReversed, uDepth, uHazeD, uHazeK, uRim;
      uniform vec3 uWarm, uHaze, uRimC; uniform mat4 uInvProj; varying vec2 vUv;
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      // the distance of what the pixel shows (1e6 for the sky), from the scene's depth (reversed or not)
      float dist(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        if (uReversed > 0.5 ? z <= 0.0 : z >= 1.0) return 1e6;
        vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, uReversed > 0.5 ? z : z * 2.0 - 1.0, 1.0); return length(p.xyz / p.w);
      }
      void main() {
        vec3 src = texture2D(tDiffuse, vUv).rgb, c = src;
        // depth: the far city sinks into the air (layers, as a painted background is built), and a nearer roofline
        // against something far behind it catches a thin rim of the sky's light
        if (uDepth > 0.5) {
          float d = dist(vUv);
          if (d < 1e5) {
            float a = (1.0 - exp(-d / uHazeD)) * uHazeK;
            c = mix(c, uHaze + c * 0.35, a);
            vec2 px = 1.6 / uRes;
            float far = max(max(dist(vUv + vec2(0.0, px.y)), dist(vUv - vec2(0.0, px.y))), max(dist(vUv + vec2(px.x, 0.0)), dist(vUv - vec2(px.x, 0.0))));
            float edge = smoothstep(1.25, 2.5, far / max(d, 1.0)) * (far > 9e5 ? 1.0 : 0.6);
            c += uRimC * edge * uRim * (0.6 + 0.4 * exp(-d / 800.0));
          }
        }
        // the painted look
        if (uK > 0.0 && uRadius >= 1.0) {
          vec2 px = vec2(uRes.y / 900.0) / uRes;
          vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0), s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
          float n = 0.0;
          for (int j = 0; j <= 4; j++) for (int i = 0; i <= 4; i++) {
            if (float(i) > uRadius || float(j) > uRadius) continue;
            vec2 o = vec2(float(i), float(j)) * px;
            vec3 a = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb, b = texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb;
            vec3 d = texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb, e = texture2D(tDiffuse, vUv + o).rgb;
            m0 += a; s0 += a * a; m1 += b; s1 += b * b; m2 += d; s2 += d * d; m3 += e; s3 += e * e; n += 1.0;
          }
          m0 /= n; m1 /= n; m2 /= n; m3 /= n;
          float v0 = dot(s0 / n - m0 * m0, vec3(1.0)), v1 = dot(s1 / n - m1 * m1, vec3(1.0)), v2 = dot(s2 / n - m2 * m2, vec3(1.0)), v3 = dot(s3 / n - m3 * m3, vec3(1.0));
          // (a soft choice between the quadrants, weighted by how even each is, rather than the hard minimum: no blocks)
          float w0 = 1.0 / (1e-5 + v0 * v0 * 4e3), w1 = 1.0 / (1e-5 + v1 * v1 * 4e3), w2 = 1.0 / (1e-5 + v2 * v2 * 4e3), w3 = 1.0 / (1e-5 + v3 * v3 * 4e3);
          vec3 k = (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / (w0 + w1 + w2 + w3);
          c = mix(c, k, uK);
        }
        // after dark, the lens a film's night is shot through: each lamp, lit sign and headlight drawn out sideways into
        // a thin streak in its own colour (an anamorphic lens's flare), longer the brighter it is
        if (uStreak > 0.0) {
          vec2 px = vec2(uRes.y / 900.0) / uRes; vec3 acc = vec3(0.0);
          for (int i = 1; i <= 14; i++) {
            float f = float(i), w = exp(-f * 0.24); vec2 o = vec2(f * f * 0.5 + f * 2.0, 0.0) * px;
            vec3 a = texture2D(tDiffuse, vUv + o).rgb, b = texture2D(tDiffuse, vUv - o).rgb;
            acc += (a * smoothstep(0.8, 1.0, max(a.r, max(a.g, a.b))) + b * smoothstep(0.8, 1.0, max(b.r, max(b.g, b.b)))) * w;
          }
          c += acc * 0.075 * uStreak * vec3(0.85, 0.93, 1.12);
        }
        // light: rays from the sun over the bright pixels on the way to it, and a halation of the brightest
        if (uSunVis > 0.0 && uRays > 0.0) {
          vec2 dlt = (uSunUv - vUv) / 20.0; vec2 uv = vUv; float acc = 0.0, w = 1.0;
          for (int i = 0; i < 20; i++) { uv += dlt; vec3 t = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb; acc += smoothstep(0.62, 0.95, luma(t)) * w; w *= 0.93; }
          float r = acc / 9.0 * uSunVis * uRays * (1.0 - smoothstep(0.0, 0.9, distance(vUv * vec2(uRes.x / uRes.y, 1.0), uSunUv * vec2(uRes.x / uRes.y, 1.0))));
          c += uWarm * r * 0.55;
        }
        if (uGrade > 0.0) {
          float l = luma(c);
          vec3 g = c;
          g = mix(g, g + vec3(-0.01, 0.025, 0.07), (1.0 - smoothstep(0.0, 0.45, l)) * 0.9);      // shadows: a clear blue, never grey
          g = mix(g, g * uWarm * 1.08, smoothstep(0.55, 1.0, l) * 0.55);                        // highlights: peach
          float mx = max(g.r, max(g.g, g.b)), mn = min(g.r, min(g.g, g.b)), sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
          g = mix(vec3(luma(g)), g, 1.0 + 0.55 * (1.0 - sat));                                    // vibrance
          vec3 h = max(g - 0.86, 0.0); g += h * h * 0.9 * uWarm;                                  // a touch of halation on the brightest (the roll-off keeps them from white)
          c = mix(c, g, uGrade);
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });

  // Highlights that never blow out (in every view of the game, by day and by night): before the bloom and the
  // title's tone curve, each pixel brighter than a knee is rolled off towards a ceiling, scaled as a whole so
  // its hue holds (an orange lamp stays orange rather than going to a flat yellow-white slab), as hue-preserving
  // tone mappers do (Polyphony's GT curve, AgX with its emissive-colour option) and as games author emissive
  // light: a lamp, a lit window or a sign is bright but its face keeps its colour and shape, and only the bloom
  // round it says how bright it is. The ceiling follows the exposure (uCap, in scene units): 2.0 after it,
  // which the title's curve takes to about 0.96, just short of white. A small lamp a pixel or two across still
  // blooms; a lantern filling the frame from a metre away is a soft warm glow, not a white wall.
  const HIGHLIGHT = () => ({
    uniforms: { tDiffuse: { value: null }, uCap: { value: 8 }, uKnee: { value: 0.55 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uCap, uKnee; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(tDiffuse, vUv); vec3 c = max(t.rgb, 0.0);
        float peak = max(c.r, max(c.g, c.b)), k = uKnee * uCap;
        if (peak > k) { float r = uCap - k, np = k + r * (1.0 - exp(-(peak - k) / r)); c *= np / peak; }
        gl_FragColor = vec4(c, t.a);
      }`,
  });

  // Wd: the world (world.js); city: scene.city (lat, lon); sky: game.sky ({clouds, cloud_density}); look: game.look ({grade})
  function create(Wd, renderer, camera, { city, sky = {}, look = {} } = {}) {
    const keys = {};
    
    const gr = { ev: 1, sat: 1, contrast: 0, tint: [1, 1, 1], vib: 0 };
    const su = Wd.su, world = Wd.world, basis = new THREE.Matrix4();
    const LK = LOOKS[look.preset] || (city && city.country_code === 'JP' ? LOOKS.shinkai : LOOKS.film), // (the Japanese maps: the animated film's look)
       SK = Object.assign({}, LK.sky, sky);
    const LT = Object.assign({}, LK.light, look.light);
    for (const [k] of GRADE_KEYS) keys[k] = Object.assign({}, GRADE_DEF[k], (LK.grade || {})[k], (look.grade || {})[k]);
    // the shade's colour and the ground's bounce (world.js setSun calls this once it has set the hour's light): by day the
    // light in the shade is the sky's, bluer than the grey-blue it was, and sunlit ground throws warm light back onto the
    // walls over it, through the hemisphere light's ground colour: no lights are added
    const shadeC = new THREE.Color(), bounceC = new THREE.Color();
    Wd.shadeLight = (hemi, sun, day) => {
      const ov = window.OEWeather ? OEWeather.U.uOeOvercast.value : 0, k = day * (1 - 0.8 * ov);
      hemi.color.lerp(shadeC.setRGB(LT.shade[0], LT.shade[1], LT.shade[2]), 0.6 * k);
      const up = Math.max(0, Wd.sunDir ? Wd.sunDir.y : 0); // (the ground's share of the sun)
      hemi.groundColor.setHex(0x4d463a).lerp(bounceC.copy(sun.color).multiply(shadeC.setRGB(1.0, 0.86, 0.7)), Math.min(1, LT.bounce * k * (0.35 + 0.65 * up) * 1.6));
    };
    const clouds = SK.clouds;
    const painted = !!(su.uCloudTex && window.OEClouds); // the cloud layers of clouds.js; else the Sky's own layer
    if (su.cloudCoverage) {
      su.cloudCoverage.value = clouds; su.cloudDensity.value = sky.cloud_density ?? 0.45;
      su.cloudScale.value = 0.00022; su.cloudSpeed.value = 0.00003; su.cloudElevation.value = 0.55;
    }
    if (painted) {
      su.uCloudTex.value = OEClouds.texture();
      su.uCloudK.value.set(SK.towers, SK.high, SK.edge, SK.glow);
      // the clouds' colours for the hour, keyed to the sky (world.js setSun calls it before it takes the sky's light)
      // (under a thunderstorm the sheet is darker still, and lightning lights it from within: weather.js S.storm, S.flash)
      Wd.cloudLight = (alt, ref) => {
        const WS = (window.OEWeather && OEWeather.S) || {}, WU = window.OEWeather ? OEWeather.U : null;
        OEClouds.light(su, alt, ref.zen, ref.hor, { palette: LK.palette, overcast: WU ? WU.uOeOvercast.value : 0, rain: Math.min(1, (WU ? WU.uOeRain.value : 0) + 0.6 * (WS.storm || 0)) });
        if (WS.flash > 0) { su.uCloudShade.value.multiplyScalar(1 + 5 * WS.flash); su.uCloudLit.value.multiplyScalar(1 + 3 * WS.flash); }
      };
    }
    const skySat = SK.saturation; // a blue sky rather than a white one (world.js)
    const wind = { x: 3.8, z: -1.4 }, drift = { x: 0, z: 0, e: 0, w: 0, t: null }; // (a light west-south-westerly, m/s, unless the weather has its own: weather.js S.wind)
    const meteor = { next: -1, t0: 0, dur: 0 }, galPole = eq(192.86 * RAD, 27.13 * RAD), galCentre = eq(266.4 * RAD, -28.94 * RAD);
    const S = stars(su), M = moon();
    world.add(S, M);
    // the post stack, where the GPU can render to half-float targets (measured by quality.js),
    // with the tier's multisampling; elsewhere the scene goes straight to the screen
    let highlight = null, composer = null, bloom = null, grade = null, lens = null, anime = null, camFx = null, fx = null, ao = null, rt = null, wantAO = false, sceneDepth = null;
    const FAR = 3000, prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(); // (FAR: the camera effects' depth of field reaches 3 km)
    const QC = window.OEQuality ? window.OEQuality.city() : { post: true, samples: 4 };
    const canPost = THREE.EffectComposer && renderer.capabilities.isWebGL2 && sky.post !== false && QC.post;
    if (canPost) {
      const size = renderer.getSize(new THREE.Vector2());
      // with the game's reversed depth buffer (game.js), a 32-bit float depth: it resolves a few
      // millimetres at two kilometres, where 24 bits behind a 0.3 m near plane resolve a metre, so
      // distant walls and roofs no longer fight over the same pixels as the camera moves
      // ambient occlusion (ao.js) on the medium and high tiers reads that depth, so there it is
      // resolved from the multisampled buffer into the texture; elsewhere only its format is wanted
      // the camera's effects (CAMFX) read it too, while they are on
      wantAO = !!window.OEAO && QC.name !== 'low' && sky.ao !== false;
      const wantFx = !!window.OELens && sky.lens !== false;
      const deep = renderer.capabilities.reversedDepthBuffer ? new THREE.DepthTexture(size.x, size.y, THREE.FloatType)
        : wantAO || wantFx ? new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType) : null;
      rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: QC.samples, depthTexture: deep });
      if (deep) rt.resolveDepthBuffer = wantAO;
      composer = new THREE.EffectComposer(renderer, rt);
      if (window.OEWorld && OEWorld.leanComposer) OEWorld.leanComposer(composer); // the scene alone multisampled (world.js)
      // the scene's pass, noting which target's depth it drew (the composer's two targets take turns)
      const scenePass = new THREE.RenderPass(world, camera), drawScene = scenePass.render.bind(scenePass);
      scenePass.render = (r, wb, rb, ...rest) => { sceneDepth = rb.depthTexture || null; return drawScene(r, wb, rb, ...rest); };
      composer.addPass(scenePass);
      if (wantAO) { ao = OEAO.create(renderer, camera, { tier: QC.name }); composer.addPass(ao.pass); }
      if (window.OELens && sky.lens !== false) { highlight = new THREE.ShaderPass(HIGHLIGHT()); composer.addPass(highlight); }
      bloom = new THREE.UnrealBloomPass(size.clone(), 0.15, 0.4, 6.0);
      if (window.OELens) OELens.tameBloom(bloom); // no black frame from a glint (lens.js)
      composer.addPass(bloom);
      if (window.OELens && sky.lens !== false) {
        // the title screen's lens (lens.js): its tone curve, grade, grain and vignette, so the city
        // looks as the Earth does on the title and as the city does in its film
        lens = new THREE.ShaderPass(OELens.shader({ shafts: QC.name === 'high' ? 6 : QC.name === 'medium' ? 4 : 0 }));
        Object.assign(lens.uniforms, { uGrain: { value: 0.03 }, uCA: { value: 0.15 }, uVignette: { value: 0.18 } });
        lens.uniforms.uAspect.value = size.x / Math.max(1, size.y);
        camFx = new THREE.ShaderPass(CAMFX());
        camFx.enabled = false;
        camFx.uniforms.uReversed.value = renderer.capabilities.reversedDepthBuffer ? 1 : 0;
        const drawFx = camFx.render.bind(camFx);
        camFx.render = (...a) => { camFx.uniforms.tDepth.value = sceneDepth; return drawFx(...a); }; // (the depth this frame's scene was drawn with)
        composer.addPass(camFx);
        composer.addPass(lens);
        anime = new THREE.ShaderPass(ANIME());
        anime.enabled = false;
        anime.uniforms.uReversed.value = renderer.capabilities.reversedDepthBuffer ? 1 : 0;
        const drawAnime = anime.render.bind(anime);
        anime.render = (...a) => { anime.uniforms.tDepth.value = sceneDepth; anime.uniforms.uDepth.value = sceneDepth && anime.depthOn ? 1 : 0; anime.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse); return drawAnime(...a); };
        composer.addPass(anime);
      } else {
        composer.addPass(new THREE.OutputPass());
        grade = new THREE.ShaderPass(GRADE);
        composer.addPass(grade);
      }
    }
    const q = new THREE.Quaternion();
    let night = 0;
    const api = {
      composer, lens, ao, stars: S, moon: M, keys, sky: SK, meteor, // (meteor: set next to 0 to send one now, for a still)
       // (keys: the grade by the hour, for a film's lens: tools/film/director.js)
      // per frame: the sky's turn for this moment, the moon's place and phase, the clouds' drift
      update(utcMs, tSec, U) {
        night = U.uNight.value;
        const ov = window.OEWeather ? OEWeather.U.uOeOvercast.value : 0; // cloud cover from the weather (weather.js)
        if (su.time) su.time.value = tSec;
        if (painted) {
          // the layers drift with the weather's wind (weather.js; in real seconds, a little quickened so that it shows),
          // and change shape slowly; all of it wraps where the noise repeats
          // (api.skyTime: seconds on a film's own clock, for a time-lapse: tools/day_film.js)
          const ts = api.skyTime ?? tSec, WS = window.OEWeather && OEWeather.S, W = WS && WS.wind && Math.hypot(WS.wind.x, WS.wind.z) > 0.3 ? WS.wind : wind, dt = drift.t == null ? 0 : Math.max(0, Math.min(api.skyTime != null ? 600 : 0.25, ts - drift.t)), D = su.uCloudDrift.value;
          drift.t = ts;
          const k = dt * 3 / 9000, sp = Math.hypot(W.x, W.z); // (W: where the wind blows to, m/s)
          drift.x = (drift.x - W.x * k + 100) % 100; drift.z = (drift.z - W.z * k + 100) % 100;
          drift.e = (drift.e + dt * 0.0016) % 100; drift.w = (drift.w + dt * 0.00012 * sp / 4) % 100;
          D.set(drift.x, drift.z, drift.e, drift.w);
          su.uCloudK.value.z = SK.edge * (1 - 0.75 * night); // softer after dark
          su.uCloudFair.value = 1 - 0.6 * night;            // and fewer: fair-weather cumulus thins out with the sun gone
          if (Wd.skyRef && Wd.lastSun) Wd.cloudLight(Wd.lastSun.sp.altitude, Wd.skyRef); // (the weather's cover changes between two suns)
        }
        if (su.uSkySat) su.uSkySat.value = (1 + (skySat - 1) * (1 - night)) * (1 - 0.55 * ov) * ((lens && lens.trim && lens.trim.skySat) || 1); // not the night sky's red; a pale sky under cloud
        skyBasis(utcMs, city.lat, city.lon, basis);
        S.matrix.copy(basis).setPosition(camera.position);
        S.matrixWorldNeedsUpdate = true;
        S.material.uniforms.uOpacity.value = night * (painted ? 1 : 1 - 0.6 * clouds) * (1 - ov);
        if (painted) {
          // the Milky Way where it is tonight, and now and then a shooting star, on a clear night
          const clear = night * (1 - ov) * (1 - ov);
          su.uMilky.value = SK.milky * 0.09 * clear * ((lens && lens.trim && lens.trim.stars) || 1);
          su.uGalPole.value.copy(galPole).applyMatrix4(basis).normalize(); su.uGalCentre.value.copy(galCentre).applyMatrix4(basis).normalize();
          if (meteor.next < 0) meteor.next = tSec + 20 + 3600 / Math.max(1, SK.meteors) * Math.random();
          if (tSec > meteor.next && clear > 0.6) {
            // from a point well up the sky, falling a way across it, in under a second
            const a = Math.random() * 6.2832, e = (25 + 50 * Math.random()) * RAD, b = a + (Math.random() - 0.5) * 1.2, len = 0.18 + 0.2 * Math.random();
            su.uMeteorA.value.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
            su.uMeteorB.value.set(Math.cos(e - len) * Math.cos(b), Math.sin(e - len), Math.cos(e - len) * Math.sin(b)).sub(su.uMeteorA.value).normalize().multiplyScalar(len).add(su.uMeteorA.value);
            meteor.t0 = tSec; meteor.dur = 0.5 + 0.5 * Math.random();
            meteor.next = tSec + 3600 / Math.max(1, SK.meteors) * (0.3 + 1.4 * Math.random());
          }
          const mt = meteor.dur ? (tSec - meteor.t0) / meteor.dur : 2;
          su.uMeteorT.value = mt > 0 && mt < 1 && clear > 0.3 ? mt : 0;
        }
        S.material.uniforms.uTime.value = tSec;
        S.material.uniforms.uScale.value = renderer.getPixelRatio() * ((lens && lens.trim && lens.trim.stars) || 1); // (a shot's starrier sky: overture.js)
        S.visible = night > 0.02;
        const md = moonRaDec(utcMs), dir = eq(md.ra, md.dec).applyMatrix4(basis).normalize();
        M.visible = dir.y > -0.02;
        M.position.copy(camera.position).addScaledVector(dir, 17000);
        M.quaternion.copy(camera.quaternion);
        M.scale.setScalar(17000 * Math.tan(0.26 * RAD) * 2 * 1.7);   // the moon's half a degree, a little larger as people remember it
        // the sun's direction in the disc's own frame, so the lit limb faces the sun
        q.copy(camera.quaternion).invert();
        M.material.uniforms.uSun.value.copy(Wd.sunDir).applyQuaternion(q);
        M.material.uniforms.uOpacity.value = (0.25 + 0.75 * night) * (1 - 0.92 * ov);
        if (ao) ao.update(night);
        if (bloom) { const bt = (lens && lens.trim && lens.trim.bloom) || 1; bloom.threshold = (6.0 - 4.4 * night) / Math.sqrt(bt); bloom.strength = (0.15 + 0.15 * night) * bt; } // (a dreamier glow for a shot: overture.js)
        if (lens) {
          const L = lens.uniforms;
          const trim = lens.trim || null;                          // a shot's own exposure, saturation and tint on the hour's grade (overture.js)
          gradeAt(keys, Wd.lastSun ? Wd.lastSun.sp.altitude : 30, gr);
          L.uExposure.value = renderer.toneMappingExposure * gr.ev * (trim ? trim.ev : 1); // the world's exposure, set for ACES, graded for the hour under the film curve
          L.uLift.value = 1 - 0.7 * night;                         // at night the city keeps its blacks
          L.uContrast.value = gr.contrast;
          L.uNightTone.value = night;                              // blue between the lights, amber in them
          L.uSat.value = (gr.sat - 0.1 * ov) * (trim ? trim.sat : 1);                        // under cloud a little cooler and softer, not grey
          L.uContrast.value += 0.05 * ov;
          L.uTint.value.set(gr.tint[0] * (trim ? trim.tint[0] : 1), gr.tint[1] * (trim ? trim.tint[1] : 1), gr.tint[2] * (trim ? trim.tint[2] : 1));
          L.uTime.value = tSec;
          L.uShade.value.fromArray(gr.shade); L.uHiTint.value.fromArray(gr.hi); L.uVibrance.value = gr.vib * (1 - 0.5 * ov);
          L.uShadeLift.value.fromArray(gr.lift).multiplyScalar(1 - 0.6 * ov);
          // the sun in the lens: the flare and the light shafts while it is in or near the frame, up and not behind cloud
          // (an overture's shot sets its own: overture.js)
          if (!trim && window.OELens) {
            const sdir = Wd.sunDir, alt = Wd.lastSun ? Wd.lastSun.sp.altitude : 30, on = sdir ? OELens.sunOnScreen(camera, sdir) : null;
            const m = on && on.front ? Math.max(0, 1 - Math.max(0, Math.max(Math.abs(on.u - 0.5), Math.abs(on.v - 0.5)) - 0.5) / 0.25) : 0; // (fading out a quarter of a frame off it)
            const up = Math.max(0, Math.min(1, (alt + 1.5) / 3)) * (1 - ov);
            L.uSunSeen.value = 1;
            L.uSunVis.value = m * up;
            if (on) L.uSunUv.value.set(on.u, on.v);
            L.uFlare.value = LT.flare; L.uShafts.value = LT.shafts;
            const low = 1 - Math.max(0, Math.min(1, (alt - 2) / 25));
            L.uFlareTint.value.setRGB(1, 0.9 - 0.3 * low, 0.78 - 0.45 * low);
          }
          // the ceiling for the highlights, in scene units, from the exposure; the bloom starts below it, so what is
          // rolled off still glows
          if (highlight) {
            const cap = 2.0 / Math.max(1e-3, L.uExposure.value);
            highlight.uniforms.uCap.value = cap;
            // (after dark only: by day nothing is meant to bloom but the sun's own glints, and a lower threshold would
            // make sunlit white paint glow)
            if (bloom && night > 0.3) { bloom.threshold = Math.min(bloom.threshold, 0.45 * cap); bloom.strength *= 1.15; }
            // a soft knee rather than a hard edge at the threshold (as engines' bloom prefilters do), so a lamp's halo
            // grows with its brightness instead of switching on
            if (bloom && bloom.highPassUniforms) bloom.highPassUniforms.smoothWidth.value = night > 0.3 ? 0.4 * cap : 0.01;
          }
        }
      },
      setSize(w, h) { if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } if (lens) lens.uniforms.uAspect.value = w / Math.max(1, h); },
      // draw the frame: through the post stack, or plainly
      // photo mode and the opening shot: {focus: m, aperture: 0..1, blur: 0..1}, or null (off, as in play)
      camFx(o) { if (o && !fx) o.fresh = true; fx = o && camFx ? o : null; },
      // the overture's animated-film lens: {k, radius, grade, rays, sunUv, sunVis} or null (off: it costs nothing)
      anime(o) {
        if (!anime) return false;
        anime.enabled = !!o;
        if (!o) return true;
        const A = anime.uniforms, z = renderer.getDrawingBufferSize(new THREE.Vector2());
        A.uRes.value.set(z.x, z.y); A.uK.value = o.k || 0; A.uRadius.value = o.radius ?? 3; A.uGrade.value = o.grade || 0;
        A.uRays.value = o.rays || 0; A.uSunVis.value = o.sunVis || 0; if (o.sunUv) A.uSunUv.value.copy(o.sunUv); A.uStreak.value = o.streak || 0;
        anime.depthOn = !!(rt && rt.depthTexture) && ((o.haze || 0) > 0 || (o.rim || 0) > 0);
        A.uHazeK.value = o.haze || 0; A.uRim.value = o.rim || 0; if (o.hazeD) A.uHazeD.value = o.hazeD;
        if (o.hazeC) A.uHaze.value.set(...o.hazeC); if (o.rimC) A.uRimC.value.set(...o.rimC);
        return true;
      },
      // every pass's programs, compiled behind the loader rather than by the first frame drawn through the post
      // stack, the camera's effects among them (they come on with the opening shot and photo mode): world.js warmPasses
      warm() { return composer && window.OEWorld && OEWorld.warmPasses ? OEWorld.warmPasses(renderer, composer) : Promise.resolve(); },
      render(scene, cam) {
        if (camFx) camFx.enabled = !!fx && (fx.aperture > 0 || fx.blur > 0) && !!rt.depthTexture;
        // the scene's depth resolved from the multisampled buffer while something reads it (the ambient occlusion, the camera's effects)
        if (rt) composer.renderTarget1.resolveDepthBuffer = composer.renderTarget2.resolveDepthBuffer = wantAO || !!(camFx && camFx.enabled) || !!(anime && anime.enabled && anime.depthOn);
        if (camFx && camFx.enabled) {
          const z = renderer.getDrawingBufferSize(new THREE.Vector2()), F = camFx.uniforms;
          cam.updateMatrixWorld();
          curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
          Object.assign(F.uFocus, { value: fx.focus || 10 }); F.uAperture.value = fx.aperture || 0; F.uBlur.value = fx.blur || 0; F.uFar.value = FAR;
          F.uInvProj.value.copy(cam.projectionMatrixInverse); F.uCamWorld.value.copy(cam.matrixWorld);
          F.uPrevVP.value.copy(fx.fresh ? curVP : prevVP); F.uAspect.value = z.x / Math.max(1, z.y);
          fx.fresh = false;
        }
        if (camFx) { cam.updateMatrixWorld(); prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); }
        if (composer) composer.render(); else renderer.render(scene, cam);
      },
      dispose() { if (ao) ao.pass.dispose(); if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); } },
    };
    return api;
  }

  return { create, moonRaDec, skyBasis, gradeAt, GRADE_DEF };
})();
