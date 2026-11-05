// Mirror: a wet street's reflections, on the high tier. When the ground is wet (the weather's
// uWet, game/weather.js), the scene is drawn a second time from the camera mirrored in the ground
// under it, at half the screen's size, and the street's puddles and its wet film show that picture:
// the screens, signs, shopfronts, lamps and headlights reflected as long, rippling images, which
// is most of what makes a city in the rain look as it does at night. It is the planar reflection of
// three.js's Reflector (MIT), done for the ground's own materials rather than a mirror mesh: the
// mirror camera, its texture matrix, and a clipping plane at the ground (rather than an oblique
// near plane, which the game's reversed depth buffer would need worked out again) so that nothing
// under the street is drawn into it. The ground is not flat everywhere, so the mirror follows the
// ground under the camera; where the street slopes away from it the reflection drifts a little,
// which the blur and the ripples hide.
// The materials it is given (the ground tiles, paving and road markings) take the picture by
// Fresnel's law for water (F0 0.02), in the puddles and, weaker and rougher, on the wet film
// between them. Below the high tier the wet street keeps the reflections of the sky and of the
// screens' area lights (neon.js) that its lower roughness gives it.
'use strict';
window.OEMirror = (function () {
  // a puddle mask, 0..1, in world xz metres: the weather's where it has one (game/weather.js)
  const NOISE = `
float oeMirH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float oeMirN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(oeMirH(i), oeMirH(i + vec2(1, 0)), f.x), mix(oeMirH(i + vec2(0, 1)), oeMirH(i + vec2(1, 1)), f.x), f.y); }`;
  const PUDDLE = `
float oePuddle(vec2 xz) { float n = oeMirN(xz * 0.11) * 0.6 + oeMirN(xz * 0.37) * 0.3 + oeMirN(xz * 1.3) * 0.1; return smoothstep(0.5, 0.62, n); }`;
  const W = () => (window.OEWeather && OEWeather.U) || null;
  const wetU = () => (W() && W().uOeWet) || null;

  function create(Wd, renderer, camera, { tier = 'low', ground = () => 0 } = {}) {
    const own = { value: 0 };
    const U = { uMirror: { value: null }, uMirrorMat: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 }, uMirrorTime: { value: 0 },
      uMirrorPx: { value: new THREE.Vector2(1, 1) }, uMirrorDark: { value: window.OEWeather ? 0 : 1 }, uWetM: { value: 0 }, uRainM: (W() && W().uOeRain) || { value: 0 } };
    const high = tier === 'high' && renderer.capabilities.isWebGL2;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // a third of the screen's size: the picture is blurred and rippled down to far less than that anyway
    const DIV = 3, dim = v => Math.max(2, Math.round(v / DIV));
    const rt = high ? new THREE.WebGLRenderTarget(dim(size.x), dim(size.y), { type: THREE.HalfFloatType, samples: 0 }) : null;
    let tick = 0;
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    U.uMirror.value = blank;
    const cam = new THREE.PerspectiveCamera();
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), look = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3();
    const patched = new WeakSet();
    const puddle = PUDDLE; // (the weather's own oePuddle where its patch is in the shader: game/weather.js)

    // a material takes the mirror: its own patch first, then the reflection into the outgoing light
    function patch(mat) {
      if (!rt || !mat || patched.has(mat) || !mat.isMeshStandardMaterial) return; // (below the high tier the shaders stay as they were)
      patched.add(mat);
      const before = mat.onBeforeCompile, key = mat.customProgramCacheKey;
      mat.onBeforeCompile = (sh, r) => {
        if (before) before.call(mat, sh, r);
        Object.assign(sh.uniforms, U);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMirror; uniform mat4 uMirrorMat; uniform float uMirrorOn, uMirrorTime, uWetM, uRainM, uMirrorDark; uniform vec2 uMirrorPx;
${NOISE}
${/oePuddle\s*\(/.test(sh.fragmentShader) ? '' : puddle}`)
          .replace('#include <opaque_fragment>', `
  if (uWetM > 0.003) {
    vec3 oeN = (vec4(normal, 0.0) * viewMatrix).xyz, oeP = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
    float oeUp = smoothstep(0.75, 0.95, oeN.y), oePd = oePuddle(oeP.xz) * smoothstep(0.25, 0.75, uWetM);
    vec3 oeV = normalize(cameraPosition - oeP);
    float oeF = 0.02 + 0.98 * pow(1.0 - max(dot(oeV, vec3(0.0, 1.0, 0.0)), 0.0), 5.0);   // water, seen at the angle the street is
    float oeK = oeUp * uWetM * mix(0.55, 1.0, oePd) * oeF;
    // the street's grain and, in the rain, rings in the puddles: the picture wavers
    vec2 oeR = vec2(oeMirN(oeP.xz * 2.3 + uMirrorTime * 0.7), oeMirN(oeP.zx * 2.9 - uMirrorTime * 0.6)) - 0.5;
    oeR += (vec2(oeMirN(oeP.xz * 9.0 + uMirrorTime * 4.0), oeMirN(oeP.zx * 8.0 - uMirrorTime * 3.5)) - 0.5) * uRainM * oePd;
    vec4 oeC = uMirrorMat * vec4(oeP, 1.0);
    vec2 oeUv = oeC.xy / max(oeC.w, 1e-4) + oeR * mix(0.012, 0.004, oePd);
    // the film between the puddles is rough: a wider blur, smeared down the screen as wet asphalt smears a light
    float oeB = mix(4.0, 1.0, oePd);
    vec3 oeM = texture2D(uMirror, oeUv).rgb * 0.2;
    for (int i = -4; i <= 4; i++) { if (i == 0) continue; float fi = float(i); oeM += texture2D(uMirror, oeUv + vec2(0.35 * sin(fi * 1.7), fi * 2.2) * oeB * uMirrorPx).rgb * 0.1; }
    float oeIn = smoothstep(0.0, 0.03, oeUv.x) * smoothstep(1.0, 0.97, oeUv.x) * smoothstep(0.0, 0.03, oeUv.y) * smoothstep(1.0, 0.8, oeUv.y) * step(0.0, oeC.w);
    outgoingLight *= 1.0 - 0.45 * oeUp * uWetM * uMirrorDark;   // (darkened here only where no weather does it)
    outgoingLight = mix(outgoingLight, oeM, oeK * oeIn * uMirrorOn);
  }
#include <opaque_fragment>`);
      };
      mat.customProgramCacheKey = () => `${key ? key.call(mat) : ''}|mirror`;
      mat.needsUpdate = true;
    }

    const api = {
      on: !!rt, uniforms: U, patch,
      // wetness 0..1 where there is no weather to say (a still, a film)
      set wet(v) { (wetU() || own).value = v; }, get wet() { return (wetU() || own).value; },
      // per frame, before the main render: the reflection from the mirrored camera
      update(scene, t) {
        U.uMirrorTime.value = t;
        const w = (wetU() || own).value;
        U.uWetM.value = w;
        if (!rt || api.off || w < 0.003) { U.uMirrorOn.value = 0; return; } // (off: game.js sheds it on a device that can't keep up)
        const h = ground(camera.position.x, -camera.position.z);
        if (camera.position.y - h > 120) { U.uMirrorOn.value = 0; return; } // high over the city: the street's reflections are lost in the distance
        // drawn every other frame: the last picture is kept with the mirrored camera it was drawn from
        // (uMirrorMat), so in between it still lands where it should, a frame behind what moves in it
        if ((tick++ & 1) && U.uMirrorOn.value === 1 && !api.every) return;
        camera.updateMatrixWorld();
        cam.copy(camera, false);
        camera.getWorldDirection(dir);
        up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        cam.position.set(camera.position.x, 2 * h - camera.position.y, camera.position.z);
        dir.y = -dir.y; up.y = -up.y; up.multiplyScalar(-1);
        cam.up.copy(up).multiplyScalar(-1);
        cam.lookAt(look.copy(cam.position).add(dir));
        cam.updateMatrixWorld();
        cam.projectionMatrix.copy(camera.projectionMatrix);
        cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        U.uMirrorMat.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
        plane.constant = -(h - 0.05);
        const prevT = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate, prevClip = renderer.clippingPlanes, prevLocal = renderer.localClippingEnabled;
        U.uMirror.value = blank; U.uMirrorOn.value = 0;      // not into itself
        renderer.shadowMap.autoUpdate = false;
        renderer.clippingPlanes = [plane];
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.setRenderTarget(prevT);
        renderer.clippingPlanes = prevClip; renderer.localClippingEnabled = prevLocal;
        renderer.shadowMap.autoUpdate = prevShadow;
        U.uMirror.value = rt.texture; U.uMirrorOn.value = 1;
      },
      setSize(w, h) { if (rt) { rt.setSize(dim(w), dim(h)); U.uMirrorPx.value.set(1 / dim(w), 1 / dim(h)); } },
      // draw it once while the game loads, whatever the weather: the scene's materials compile again
      // for the mirror's clipping plane, seconds of stall that would otherwise come with the first rain
      warm(scene) {
        if (!rt) return;
        const u = wetU() || own, w = u.value;
        u.value = 1; api.every = true;
        try { api.update(scene, 0); } finally { u.value = w; api.every = false; U.uMirrorOn.value = 0; U.uWetM.value = w; }
      },
      dispose() { if (rt) rt.dispose(); blank.dispose(); },
    };
    api.setSize(size.x, size.y);
    return api;
  }
  return { create, PUDDLE };
})();
