// The title screen's lens, for the cities: the same tone curve, grade, flare, grain and
// vignette that earth.js puts on the Earth from orbit, as a pass any EffectComposer can end
// on. It takes the scene in linear HDR (before any tone mapping) and writes display sRGB, so
// a city seen in the browser, in its film and on the title screen goes through one lens.
//   uExposure   scene exposure (the city's sun is several times brighter than the Earth's)
//   uFade       0 is space black (#04060b), 1 the picture; uFlash goes to white
//   uCA         chromatic fringes, growing towards the frame's edges
//   uGrain      film grain, strongest in the midtones (0 for a picture headed for a video encoder)
//   uSunUv/uSunVis  where the sun is on screen and how much of it shows, for the flare
//   uTint, uSat white balance and saturation, before the curve; uContrast the S-curve's weight
//   uLift       how far black is lifted to space's #04060b: 1 on the title, less for a city at night
'use strict';
window.OELens = (function () {
  function shader() {
    return {
      uniforms: {
        tDiffuse: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 }, uExposure: { value: 1 }, uFade: { value: 1 }, uFlash: { value: 0 },
        uCA: { value: 0.2 }, uGrain: { value: 0.03 }, uVignette: { value: 0.16 }, uLift: { value: 1 },
        uSunUv: { value: new THREE.Vector2(-9, -9) }, uSunVis: { value: 0 }, uFlare: { value: 1 }, uFlareTint: { value: new THREE.Color(1, 0.8, 0.6) },
        uLetterbox: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 0.1 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uAspect; uniform float uTime; uniform float uExposure; uniform float uFade; uniform float uFlash;
        uniform float uCA; uniform float uGrain; uniform float uVignette; uniform float uLift;
        uniform vec2 uSunUv; uniform float uSunVis; uniform float uFlare; uniform vec3 uFlareTint; uniform float uLetterbox;
        uniform vec3 uTint; uniform float uSat; uniform float uContrast;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // the title's tone curve: Khronos PBR Neutral with a long exponential shoulder from 0.42
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
          float unit = min(uAspect, 1.0);
          vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) / unit, s = (uSunUv - 0.5) * vec2(uAspect, 1.0) / unit, d = p - s;
          float r = length(d);
          vec3 c = vec3(0.0);
          c += vec3(0.6, 0.76, 1.0) * exp(-abs(d.y) * 1500.0) * exp(-abs(d.x) * 2.6) * 0.32;      // the anamorphic streak
          c += vec3(0.65, 0.8, 1.0) * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 5.0) * 0.035;
          c += uFlareTint * (exp(-r * 18.0) * 0.08 + exp(-r * 4.0) * 0.02);
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
          vec3 col = vec3(texture2D(tDiffuse, uv - off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + off).b);
          if (uSunVis > 0.0) col += flare(uv);
          col = film(col * uExposure * uTint);
          col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat), 0.0);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);                            // a little contrast (more at night)
          col *= mix(vec3(0.97, 1.0, 1.04), vec3(1.015, 1.0, 0.985), smoothstep(0.05, 0.7, l)); // cool shadows, warm light
          col = pow(max(col, 0.0), vec3(1.0 / 2.2));
          col *= 1.0 - uVignette * smoothstep(0.15, 0.95, dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) * 1.6 / max(uAspect, 1.0));
          float g = hash(uv * vec2(1931.7, 2713.3) + fract(uTime * 7.31)) - 0.5;
          col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
          vec3 space = vec3(0.016, 0.024, 0.043);                                                // #04060b, never pure black
          col = col * (1.0 - space * uLift) + space * uLift;
          col = mix(space, col, uFade);
          col = mix(col, vec3(1.0), uFlash);
          if (uLetterbox > 0.0) { float bar = (1.0 - 1.0 / (uLetterbox * uAspect)) * 0.5; if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0); }
          col += (hash(uv * 977.0 + uTime) - 0.5) / 255.0;                                      // dither the gradients
          gl_FragColor = vec4(col, 1.0);
        }`,
    };
  }

  // where the sun is on screen for this camera, 0..1 uv, and whether it is in front of it
  let tmp = null; // made on first use: this script runs before the three.js module has loaded
  function sunOnScreen(camera, sunDir) {
    tmp = tmp || new THREE.Vector3();
    tmp.copy(camera.position).addScaledVector(sunDir, 10000).project(camera);
    return { u: tmp.x * 0.5 + 0.5, v: tmp.y * 0.5 + 0.5, front: tmp.z < 1 && sunDir.dot(camera.getWorldDirection(new THREE.Vector3())) > 0 };
  }

  return { shader, sunOnScreen };
})();
