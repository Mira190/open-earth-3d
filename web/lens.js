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
//   uNightTone  a city at night (0..1): its shadows to blue and its lights to amber, as night photographs
//               are graded, so the dark between the lights is deep blue rather than grey
//
// The game's frame has one full-resolution pass after the scene, and this is it (issue 352):
// shader({ merge: true, shade }) reads the scene's own target and does, on the way to the grade,
// what three passes before it used to do each into a full-size half-float target: the contact
// shadows (shade: GLSL for float oeShade(vec2 uv), ao.js UPSAMPLE), the highlights' roll-off (uCap,
// uKnee: atmosphere.js) and the bloom (tBloom, the bloom chain's half-size composite; uBloom 0 or 1).
// merge() is the same without the lens, into a target, for the frames a camera effect comes between
// (photo mode, an opening shot), and bright() the bloom's first pass, which rolls the highlights off
// for itself. main() below reads top to bottom as the frame is made: the taps, then the grade from
// film() down, where a look is keyed at no pass of its own.
//
// A region's look (game/atmosphere.js LOOKS), all of it inside this one pass:
//   uShade, uHiTint  the split tone: what the shadows and the lit parts are multiplied by (cool shade, warm light)
//   uShadeLift       a colour the deepest shade is lifted towards, so shade is blue or violet and never grey or black
//   uVibrance        saturation given where colour is weak and withheld where it is already strong
//   uSunSeen         1: the flare and the shafts follow how much of the sun the frame really shows at uSunUv (a few
//                    lookups in the vertex shader, none per pixel), so a building or a cloud in front of it puts them out
//   uShafts          light shafts: a short march from each pixel towards the sun over the bright sky on the way (a
//                    few taps, jittered per pixel so that they read as haze and not as steps), only while the sun is
//                    in or near the frame; shader({ shafts: n }) sets the taps, 0 leaves the code out
'use strict';
window.OELens = (function () {
  // a NaN texel would show as a black dot and an infinite one turns the tone curve to NaN; the
  // test is on the bits, which a compiler's fast maths cannot fold away as it can isnan()
  const TAP = `
        vec3 tap(vec2 uv) {
          vec3 c = texture2D(tDiffuse, uv).rgb;
          if (any(greaterThan(floatBitsToUint(c) & 0x7fffffffu, uvec3(0x7f800000u)))) return vec3(0.0);
          return min(c, vec3(1024.0));
        }`;
  // Highlights that never blow out (in every view of the game, by day and by night): before the bloom and the
  // tone curve, each pixel brighter than a knee is rolled off towards a ceiling, scaled as a whole so its hue
  // holds (an orange lamp stays orange rather than going to a flat yellow-white slab), as hue-preserving tone
  // mappers do (Polyphony's GT curve, AgX with its emissive-colour option) and as games author emissive light:
  // a lamp, a lit window or a sign is bright but its face keeps its colour and shape, and only the bloom round
  // it says how bright it is. The ceiling follows the exposure (uCap, in scene units, atmosphere.js): 2.0
  // after it, which the tone curve takes to about 0.96, just short of white.
  const ROLLOFF = `
        uniform float uCap, uKnee;
        vec3 rolloff(vec3 c) {
          c = max(c, 0.0);
          float peak = max(c.r, max(c.g, c.b)), k = uKnee * uCap;
          if (peak > k) { float r = uCap - k; c *= (k + r * (1.0 - exp(-(peak - k) / r))) / peak; }
          return c;
        }`;
  const NOSHADE = 'float oeShade(vec2 uv) { return 1.0; }';
  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const merged = () => ({ tBloom: { value: null }, uBloom: { value: 0 }, uCap: { value: 8 }, uKnee: { value: 0.55 }, uShadeShow: { value: 0 },
    uSharp: { value: 0 }, uSrcPx: { value: new THREE.Vector2() } });

  // the scene with its contact shadows, rolled-off highlights and bloom, in linear HDR, for a pass that is not the lens
  function merge({ shade = NOSHADE } = {}) {
    return {
      uniforms: Object.assign({ tDiffuse: { value: null } }, merged()),
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse, tBloom; uniform float uBloom, uShadeShow; varying vec2 vUv;
        ${TAP}
        ${ROLLOFF}
        ${shade}
        void main() {
          float k = oeShade(vUv);
          vec3 col = uShadeShow > 0.5 ? vec3(k) : rolloff(tap(vUv) * k);
          if (uBloom > 0.0) col += texture2D(tBloom, vUv).rgb;
          gl_FragColor = vec4(col, 1.0);
        }`,
    };
  }

  // The bloom's first pass, drawn at half the frame's size (uSpread 0.5: each pixel the mean of the four under it)
  // or a quarter (uSpread 1: four bilinear taps, the sixteen under it): what the frame's one pass will show before
  // the bloom (shadowed, rolled off), kept where it is brighter than the threshold with a soft knee
  // (luminosityThreshold, smoothWidth: three.js's LuminosityHighPassShader, whose uniforms these are).
  // A pixel brighter than a half-float target holds (the sun's glint on glass or water) is stored
  // as infinite, and a pixel whose maths went wrong on one GPU (a zero-length normal, say) is NaN.
  // The bloom's blur carried either across the frame: the tone curve turned it into NaN and the
  // frame went black, and where a GPU's min() returns the number for a NaN (IEEE minNum) the old
  // ceiling of 60000 turned one bad pixel into a ball of light that flashed as the camera and the
  // sun moved. tap() drops NaN by its bits, before any arithmetic, and the highlight keeps its colour
  // but its peak is held to CEIL: far above anything the cities light (their lamps, windows and
  // sparkles peak near 16), so they bloom as before, while a glint blooms as a small star rather
  // than a ball.
  const BLOOM_CEIL = 64.0;
  function bright({ shade = NOSHADE } = {}) {
    return {
      uniforms: { tDiffuse: { value: null }, uSrcPx: { value: new THREE.Vector2() }, uSpread: { value: 0.5 }, luminosityThreshold: { value: 1 }, smoothWidth: { value: 0.01 },
        uCap: { value: 8 }, uKnee: { value: 0.55 } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uSrcPx; uniform float uSpread, luminosityThreshold, smoothWidth; varying vec2 vUv;
        ${TAP}
        ${ROLLOFF}
        ${shade}
        void main() {
          float k = oeShade(vUv);
          vec2 o = uSrcPx * uSpread;
          vec3 c = (rolloff(tap(vUv + vec2(-o.x, -o.y)) * k) + rolloff(tap(vUv + vec2(o.x, -o.y)) * k)
            + rolloff(tap(vUv + vec2(-o.x, o.y)) * k) + rolloff(tap(vUv + o) * k)) * 0.25;
          float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, dot(c, vec3(0.2126, 0.7152, 0.0722)));
          c *= a;
          c *= ${BLOOM_CEIL.toFixed(1)} / max(max(max(c.r, c.g), c.b), ${BLOOM_CEIL.toFixed(1)});
          gl_FragColor = vec4(c, a);
        }`,
    };
  }

  function shader({ merge = false, shade = NOSHADE, shafts = 0 } = {}) {
    return {
      uniforms: Object.assign(merge ? merged() : {}, {
        tDiffuse: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 }, uExposure: { value: 1 }, uFade: { value: 1 }, uFlash: { value: 0 },
        uCA: { value: 0.2 }, uGrain: { value: 0.03 }, uVignette: { value: 0.16 }, uLift: { value: 1 },
        uSunUv: { value: new THREE.Vector2(-9, -9) }, uSunVis: { value: 0 }, uFlare: { value: 1 }, uFlareTint: { value: new THREE.Color(1, 0.8, 0.6) },
        uLetterbox: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 0.1 }, uNightTone: { value: 0 },
        uShade: { value: new THREE.Vector3(0.97, 1.0, 1.04) }, uHiTint: { value: new THREE.Vector3(1.015, 1.0, 0.985) }, uShadeLift: { value: new THREE.Vector3(0, 0, 0) },
        uVibrance: { value: 0 }, uSunSeen: { value: 0 }, uShafts: { value: 0 },
      }),
      defines: shafts > 0 ? { OE_SHAFTS: Math.round(shafts) } : {},
      vertexShader: `varying vec2 vUv; varying float vSun; uniform sampler2D tDiffuse; uniform vec2 uSunUv; uniform float uSunVis, uSunSeen, uExposure, uAspect;
        void main() {
          vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vSun = uSunVis;
          if (uSunVis > 0.0 && uSunSeen > 0.0) {
            // how much of the sun's disc shows: its own brightness at five points on it, against anything that could stand in front
            float seen = 0.0;
            for (int i = 0; i < 5; i++) {
              vec2 o = i == 0 ? vec2(0.0) : vec2(i < 3 ? 0.0035 : 0.0, i < 3 ? 0.0 : 0.0035) * (i == 1 || i == 3 ? 1.0 : -1.0);
              vec2 q = uSunUv + o * vec2(1.0 / uAspect, 1.0);
              vec3 c = all(greaterThan(q, vec2(0.0))) && all(lessThan(q, vec2(1.0))) ? textureLod(tDiffuse, q, 0.0).rgb : vec3(1e3);
              seen += smoothstep(0.6, 1.1, min(dot(c, vec3(0.2126, 0.7152, 0.0722)), 64.0) * uExposure);
            }
            vSun *= mix(1.0, seen * 0.2, uSunSeen);
          }
        }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uAspect; uniform float uTime; uniform float uExposure; uniform float uFade; uniform float uFlash;
        uniform float uCA; uniform float uGrain; uniform float uVignette; uniform float uLift;
        uniform vec2 uSunUv; uniform float uSunVis; uniform float uFlare; uniform vec3 uFlareTint; uniform float uLetterbox;
        uniform vec3 uTint; uniform float uSat; uniform float uContrast; uniform float uNightTone;
        uniform vec3 uShade, uHiTint, uShadeLift; uniform float uVibrance, uShafts;
        varying vec2 vUv; varying float vSun;
        // grain and dither from an integer hash of the pixel and the frame (pcg3d, Jarzynski and Olano,
        // JCGT 2020): fract(sin(x) * 43758.5) loses its precision on many GPUs at the arguments a
        // full-frame grain gives it, and drew diagonal streaks that crawled across the sky
        float hash3(uvec3 v) {
          v = v * 1664525u + 1013904223u;
          v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
          v ^= v >> 16u;
          v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
          return float(v.x) * (1.0 / 4294967296.0);
        }
        float grainAt(float k) { return hash3(uvec3(uvec2(gl_FragCoord.xy), uint(abs(uTime) * 60.0) + uint(k))); }
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
          c += vec3(0.6, 0.76, 1.0) * exp(-abs(d.y) * 1500.0) * exp(-abs(d.x) * 7.5) * 0.24;      // the anamorphic streak, fading within a third of the frame
          c += vec3(0.65, 0.8, 1.0) * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 9.0) * 0.03;
          c += uFlareTint * (exp(-r * 18.0) * 0.08 + exp(-r * 4.0) * 0.02);
          vec2 axis = -s;
          c += ghost(p, s + axis * 0.62, 0.028, vec3(0.30, 0.55, 1.0) * 0.022);
          c += ghost(p, s + axis * 1.32, 0.06, vec3(0.5, 0.85, 1.0) * 0.008);
          c += ghost(p, s + axis * 1.6, 0.016, vec3(1.0, 0.6, 0.3) * 0.03);
          c += ghost(p, s + axis * 2.1, 0.1, vec3(0.6, 0.45, 1.0) * 0.006);
          return c * vSun * uFlare;
        }
        ${TAP}
        ${merge ? `uniform sampler2D tBloom; uniform float uBloom, uShadeShow, uSharp; uniform vec2 uSrcPx;
        ${ROLLOFF}
        ${shade}
        // A scene drawn below the canvas's size (the frame-time governor, quality.js) is brought up here, and
        // sharpened as it is: the centre against its four neighbours in the scene's own texels, as AMD's
        // FidelityFX RCAS does (robust contrast-adaptive sharpening, MIT: the lobe is limited by the local
        // minimum and maximum so that nothing rings), on colours brought into 0..1 first (c / (1 + peak)) so a
        // lamp against the night does not ring either. Returns the gain for the pixel's colour; uSharp 0..1.
        vec3 squash(vec3 c) { c = max(c, 0.0); return c / (1.0 + max(c.r, max(c.g, c.b))); }
        float sharpen(vec2 uv, vec3 centre) {
          vec3 e = squash(centre), a = squash(tap(uv + vec2(0.0, -uSrcPx.y))), b = squash(tap(uv + vec2(-uSrcPx.x, 0.0)));
          vec3 c = squash(tap(uv + vec2(uSrcPx.x, 0.0))), d = squash(tap(uv + vec2(0.0, uSrcPx.y)));
          const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
          float le = dot(e, Y), la = dot(a, Y), lb = dot(b, Y), lc = dot(c, Y), ld = dot(d, Y);
          float mn = min(le, min(min(la, lb), min(lc, ld))), mx = max(le, max(max(la, lb), max(lc, ld)));
          float hitMin = mn / (4.0 * mx + 1e-5), hitMax = (1.0 - mx) / (4.0 * mn - 4.0 - 1e-5);
          float lobe = max(-0.1875, min(max(-hitMin, hitMax), 0.0)) * uSharp;
          float l = (lobe * (la + lb + lc + ld) + le) / (4.0 * lobe + 1.0);
          return clamp(l / max(le, 1e-5), 0.5, 2.0);
        }` : ''}
        void main() {
          vec2 uv = vUv, dc = uv - 0.5;
          vec2 off = dc * uCA * (0.0015 + 0.03 * dot(dc, dc));
          ${merge ? `// the scene as the passes before the lens used to hand it over: contact shadows, highlights rolled off, bloom
          float k = oeShade(uv);
          vec3 col = uShadeShow > 0.5 ? vec3(k) : vec3(rolloff(tap(uv - off) * k).r, rolloff(tap(uv) * k).g, rolloff(tap(uv + off) * k).b);
          if (uSharp > 0.0 && uShadeShow < 0.5) col *= sharpen(uv, tap(uv));
          if (uBloom > 0.0) col = min(col + texture2D(tBloom, uv).rgb, vec3(1024.0));` : 'vec3 col = vec3(tap(uv - off).r, tap(uv).g, tap(uv + off).b);'}
          if (vSun > 0.0) {
            col += flare(uv);
            #ifdef OE_SHAFTS
            if (uShafts > 0.0) {
              // light shafts (after Mitchell, GPU Gems 3 ch. 13, without its occlusion pass: the bright sky is the light)
              vec2 dl = uSunUv - uv;
              float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), acc = 0.0;
              for (int i = 0; i < OE_SHAFTS; i++) {
                vec3 t = texture2D(tDiffuse, uv + dl * ((float(i) + ign) / float(OE_SHAFTS))).rgb;
                acc += smoothstep(0.75, 1.8, min(dot(t, vec3(0.2126, 0.7152, 0.0722)), 64.0) * uExposure);
              }
              float away = length(dl * vec2(uAspect, 1.0));
              col += uFlareTint * (acc / float(OE_SHAFTS)) * exp(-away * 2.6) * uShafts * vSun * 0.55 / max(uExposure, 1e-3);
            }
            #endif
          }
          col = film(col * uExposure * uTint);
          {
            float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722)), mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
            col = max(mix(vec3(l0), col, uSat * (1.0 + uVibrance * (1.0 - (mx > 0.0 ? (mx - mn) / mx : 0.0)))), 0.0);
          }
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);                            // a little contrast (more at night)
          col *= mix(uShade, uHiTint, smoothstep(0.05, 0.7, l));                                 // cool shadows, warm light
          { float sh = 1.0 - smoothstep(0.0, 0.42, l); col += uShadeLift * sh * sh; }            // and the deepest shade towards a colour, never grey
          col *= mix(vec3(1.0), mix(vec3(0.84, 0.95, 1.2), vec3(1.05, 1.0, 0.92), smoothstep(0.03, 0.45, l)), uNightTone); // at night, more so
          col = pow(max(col, 0.0), vec3(1.0 / 2.2));
          col *= 1.0 - uVignette * smoothstep(0.15, 0.95, dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) * 1.6 / max(uAspect, 1.0));
          float g = grainAt(0.0) - 0.5;
          col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
          vec3 space = vec3(0.016, 0.024, 0.043);                                                // #04060b, never pure black
          col = col * (1.0 - space * uLift) + space * uLift;
          col = mix(space, col, uFade);
          col = mix(col, vec3(1.0), uFlash);
          if (uLetterbox > 0.0) { float bar = (1.0 - 1.0 / (uLetterbox * uAspect)) * 0.5; if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0); }
          col += (grainAt(7919.0) - 0.5) / 255.0;                                      // dither the gradients
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

  // the same guard for three.js's own bright pass (the viewer's and the title's bloom): see bright() above
  function tameBloom(bloom) {
    const m = bloom && bloom.materialHighPassFilter, end = 'gl_FragColor = mix( outputColor, texel, alpha );';
    if (!m || !m.fragmentShader.includes(end)) return;
    m.fragmentShader = m.fragmentShader.replace(end, `${end}
			if ( any( greaterThan( floatBitsToUint( gl_FragColor ) & 0x7fffffffu, uvec4( 0x7f800000u ) ) ) ) gl_FragColor = vec4( 0.0 );
			gl_FragColor.rgb = min( gl_FragColor.rgb, vec3( 65504.0 ) );
			float oePeak = max( max( gl_FragColor.r, gl_FragColor.g ), gl_FragColor.b );
			gl_FragColor.rgb *= ${BLOOM_CEIL.toFixed(1)} / max( oePeak, ${BLOOM_CEIL.toFixed(1)} );`);
    m.needsUpdate = true;
  }

  // Every built-in three.js material (the buildings, ground, water, trees, landmarks, vehicles and
  // people) ends in the dithering chunk; a guard there keeps a NaN or an infinity from ever being
  // written, so no pass after it (MSAA's resolve, the bloom, the lens) has to meet one. A NaN
  // pixel goes to black, which MSAA averages with its neighbours' samples; a highlight keeps to
  // 1024, still white after the tone curve. Applied once, before the first material compiles.
  let guarded = false;
  function guardShaders() {
    if (guarded || !window.THREE || !THREE.ShaderChunk || typeof THREE.ShaderChunk.dithering_fragment !== 'string') return;
    guarded = true;
    THREE.ShaderChunk.dithering_fragment += `
{ // no NaN or infinity reaches the target (lens.js)
	bvec4 oeBad = greaterThan( floatBitsToUint( gl_FragColor ) & 0x7fffffffu, uvec4( 0x7f800000u ) );
	if ( any( oeBad.rgb ) ) gl_FragColor.rgb = vec3( 0.0 );
	if ( oeBad.a ) gl_FragColor.a = 0.0;
	gl_FragColor.rgb = min( gl_FragColor.rgb, vec3( 1024.0 ) );
}`;
  }
  // The area lights (neon.js: up to 9, the screens' light) are a loop three.js unrolls, a copy of the
  // linearly transformed cosines' evaluation for each light in every lit shader: on llvmpipe that was
  // more than half of each program's compile (38 ms of a plain building's 38 ms against 16 without
  // them, tools/shader_bench.js). Kept a loop, the shader compiles in 21 ms and draws the same: the
  // lights are a uniform array of plain structs (no samplers), which GLSL ES 3.00 indexes at run time.
  const unrolled = /#pragma unroll_loop_start(\s*for \( int i = 0; i < NUM_RECT_AREA_LIGHTS; i \+\+ \) \{[\s\S]*?\})\s*#pragma unroll_loop_end/;
  function loopAreaLights() {
    const C = THREE.ShaderChunk;
    if (typeof C.lights_fragment_begin === 'string') C.lights_fragment_begin = C.lights_fragment_begin.replace(unrolled, '$1');
  }
  function patchChunks() { guardShaders(); loopAreaLights(); }
  if (window.THREE) patchChunks(); else addEventListener('three-ready', patchChunks, { once: true });

  return { shader, merge, bright, sunOnScreen, tameBloom, guardShaders };
})();
