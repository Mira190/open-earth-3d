// Mirror: a wet street's reflections, on the high tier. When the ground is wet (the weather's
// uWet, game/weather.js), the scene is drawn a second time from the camera mirrored in the ground
// under it, at half the screen's size, and the street's puddles and its wet film show that picture:
// the screens, signs, shopfronts, lamps and headlights reflected as long, rippling images, which
// is most of what makes a city in the rain look as it does at night. It is the planar reflection of
// three.js's Reflector (MIT), done for the ground's own materials rather than a mirror mesh: the
// mirror camera, its texture matrix, and an oblique near plane at the ground (Lengyel's, as the
// Reflector has it, worked out for the reversed depth buffer too) so that nothing under the street
// is drawn into it. Not renderer.clippingPlanes: a clipping plane is a variant of every shader, a
// second program for each of the scene's materials (about 120 more in Sydney) to compile before the
// first rain; the oblique plane is in the projection only, and the mirror draws with the programs the
// screen does (issue 266). The ground is not flat everywhere, so the mirror follows the
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
      uMirrorPx: { value: new THREE.Vector2(1, 1) }, uMirrorDark: { value: window.OEWeather ? 0 : 1 }, uWetM: { value: 0 }, uMirrorNight: (Wd && Wd.U && Wd.U.uNight) || { value: 0 }, uMirrorShow: { value: /[?&]mirror=show\b/.test(location.search) ? 1 : 0 }, uRainM: (W() && W().uOeRain) || { value: 0 } };
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
    const vplane = new THREE.Plane(), C = new THREE.Vector4(), Q = new THREE.Vector4();
    const reversed = !!(renderer.capabilities && renderer.capabilities.reversedDepthBuffer);
    // The mirror camera's near plane laid on the ground (plane, in world space): the projection's third
    // row is swapped for one that puts the clip test of the near plane on the plane, and its far plane
    // through the far corner of the frustum on the plane's side (Q), so depth keeps its range. With a
    // standard depth range the near test is z + w >= 0, so row3 = a C - row4, a = 2 (row4.Q) / (C.Q);
    // with a reversed one (z in 0..w, the near plane at z = w) it is w - z >= 0, so row3 = row4 - a C,
    // a = (row4.Q) / (C.Q), and the far plane z = 0 passes through Q. row4 is (0, 0, -1, 0).
    function oblique() {
      vplane.copy(plane).applyMatrix4(cam.matrixWorldInverse);
      C.set(vplane.normal.x, vplane.normal.y, vplane.normal.z, vplane.constant);
      const e = cam.projectionMatrix.elements;
      Q.set(Math.sign(C.x) || 1, Math.sign(C.y) || 1, reversed ? 0 : 1, 1).applyMatrix4(cam.projectionMatrixInverse);
      const cq = C.dot(Q), r4q = -Q.z;
      // (false: the mirrored camera is not under the plane, the screen's camera under the ground it stands
      // over, where depth would run backwards; or the frustum's far side is all under the street)
      if (!(C.w < 0) || !(cq > 1e-9) || !(r4q > 0)) return false;
      if (reversed) { const a = r4q / cq; e[2] = -a * C.x; e[6] = -a * C.y; e[10] = -1 - a * C.z; e[14] = -a * C.w; }
      else { const a = 2 * r4q / cq; e[2] = a * C.x; e[6] = a * C.y; e[10] = a * C.z + 1; e[14] = a * C.w; }
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      return true;
    }
    const patched = new WeakSet(), mats = [];
    const puddle = PUDDLE; // (the weather's own oePuddle where its patch is in the shader: game/weather.js)

    // a material takes the mirror: its own patch first, then the reflection into the outgoing light
    function patch(mat) {
      if (!rt || !mat || patched.has(mat) || !mat.isMeshStandardMaterial) return; // (below the high tier the shaders stay as they were)
      patched.add(mat); mats.push(mat);
      const before = mat.onBeforeCompile, key = mat.customProgramCacheKey;
      mat.onBeforeCompile = (sh, r) => {
        if (before) before.call(mat, sh, r);
        if (window.OEGLCare && OEGLCare.fit.off('mirror')) return; // (a GPU short of texture units: glcare.js fit)
        Object.assign(sh.uniforms, U);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMirror; uniform mat4 uMirrorMat; uniform float uMirrorOn, uMirrorTime, uWetM, uRainM, uMirrorDark, uMirrorShow, uMirrorNight; uniform vec2 uMirrorPx;
${NOISE}
${/oePuddle\s*\(/.test(sh.fragmentShader) ? '' : puddle}`)
          .replace('#include <opaque_fragment>', `
  if (uWetM > 0.003) {
    vec3 oeN = (vec4(normal, 0.0) * viewMatrix).xyz, oeP = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
    float oeUp = smoothstep(0.75, 0.95, oeN.y), oePd = oePuddle(oeP.xz) * smoothstep(0.25, 0.75, uWetM);
    vec3 oeV = normalize(cameraPosition - oeP);
    // water, seen at the angle the street is: by Fresnel in a puddle, and a little sooner on the film, whose facets
    // lean towards whoever looks
    float oeCos = max(dot(oeV, vec3(0.0, 1.0, 0.0)), 0.0);
    float oeF = mix(0.04 + 0.96 * pow(1.0 - oeCos, 4.0), 0.02 + 0.98 * pow(1.0 - oeCos, 5.0), oePd);
    float oeK = oeUp * uWetM * mix(0.8, 1.0, oePd) * oeF;
    // Standing water is a mirror, shaken only by the rain's rings. The film between the puddles lies on the asphalt's
    // grain: every facet of it tilts a little, and at the angle a street is seen from that tilt moves a light's
    // image a long way up and down the street and hardly at all across it. So a light is not a wavering picture
    // there but a long streak towards whoever looks, as a wet street shows a sign in a photograph: the picture
    // taken along the screen's vertical, far and with most weight near, each pixel from its own places (the grain).
    vec2 oeR = (vec2(oeMirN(oeP.xz * 9.0 + uMirrorTime * 4.0), oeMirN(oeP.zx * 8.0 - uMirrorTime * 3.5)) - 0.5) * uRainM * oePd;
    vec4 oeC = uMirrorMat * vec4(oeP, 1.0);
    vec2 oeUv = oeC.xy / max(oeC.w, 1e-4) + oeR * 0.004;
    float oeJ = mix(oeMirN(oeP.xz * 23.0), 0.5, smoothstep(4.0, 13.0, length(vViewPosition))); // (the grain is the street's: it stays where it lies as the camera moves, and never flickers)
    float oeLen = mix(0.45, 0.008, oePd);
    vec3 oeM = vec3(0.0); float oeWs = 0.0;
    for (int i = 0; i < 12; i++) {
      float ft = (float(i) + oeJ) / 12.0, fw = 1.0 / (1.0 + 9.0 * ft * ft); // (a long tail, as a rough film's lobe has)
      float fs = ft * ft * oeLen;
      vec2 oeO = vec2((oeMirN(oeP.zx * 19.0 + float(i) * 3.1) - 0.5) * 3.0 * uMirrorPx.x * (1.0 - oePd) * (1.0 - smoothstep(4.0, 13.0, length(vViewPosition))), fs);
      // (up the picture only as far as it goes: past its edge there is nothing to take)
      vec2 oeA = oeUv + oeO, oeB = oeUv - oeO;
      oeM += texture2D(uMirror, vec2(oeA.x, min(oeA.y, 0.995))).rgb * fw + texture2D(uMirror, vec2(oeB.x, max(oeB.y, 0.005))).rgb * fw;
      oeWs += 2.0 * fw;
    }
    // (a streak holds a light's energy over its length: the lights are far brighter than the picture keeps them,
    // so the film's share is lifted where the puddle's is not)
    oeM *= mix(1.7 + 0.5 * uMirrorNight, 1.0 + 0.25 * uMirrorNight, oePd) / oeWs;
    oeM = oeM / (1.0 + 0.22 * max(oeM.r, max(oeM.g, oeM.b))); // (a soft knee: a shop front's image in a puddle keeps its colour instead of burning to white)
    float oeIn = smoothstep(0.0, 0.03, oeUv.x) * smoothstep(1.0, 0.97, oeUv.x) * smoothstep(0.0, 0.03, oeUv.y) * smoothstep(1.0, 0.9, oeUv.y) * step(0.0, oeC.w);
    outgoingLight *= 1.0 - 0.45 * oeUp * uWetM * uMirrorDark;   // (darkened here only where no weather does it)
    // after dark a wet street is near black between its lights (water fills the grain that scattered the light back),
    // and what it shows is the lights' images: the lit ground is held down so that they are what reads
    outgoingLight *= 1.0 - 0.5 * oeUp * uWetM * uMirrorNight * uMirrorOn;
    outgoingLight = mix(outgoingLight, oeM, oeK * oeIn * uMirrorOn);
    if (uMirrorShow > 0.5) outgoingLight = oeM * oeIn * uMirrorOn; // (?mirror=show: the picture alone, to look at what the street is given)
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
        if (camera.position.y - h > 120 && !api.every) { U.uMirrorOn.value = 0; return; } // high over the city: the street's reflections are lost in the distance
        // looking up past the horizon (the frame's lowest ray climbs): no street in the picture to reflect anything
        look.set(0, -1, 0.5).unproject(camera).sub(camera.position);
        if (look.y > 0.05 * Math.hypot(look.x, look.z) && !api.every) { U.uMirrorOn.value = 0; return; }
        // drawn every other frame: the last picture is kept with the mirrored camera it was drawn from
        // (uMirrorMat), so in between it still lands where it should, a frame behind what moves in it
        if ((tick++ & 1) && U.uMirrorOn.value === 1 && !api.every) return;
        camera.updateMatrixWorld();
        cam.copy(camera, false);
        camera.getWorldDirection(dir);
        // The mirrored camera stands under the street where the screen's would be seen in a mirror, but it does not look
        // where that one would: it looks at what the street in the frame can show. A ray that meets the street at an
        // angle leaves it at the same angle, so the street in view mirrors the elevations from the frame's lowest ray
        // to its highest that still meets the ground (lo..hi); and the film's grain smears a light down from a good way
        // above that (the streaks: patch, above), which is where a street's signs and screens are when one looks along
        // it. So the picture is taken from lo to hi and some 30 degrees more, whatever the screen's camera does.
        const half = Math.atan(Math.tan(camera.fov * Math.PI / 360) / (camera.zoom || 1)), pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
        const lo = Math.max(0, -(pitch + half)), hi = Math.max(lo + 0.35, Math.min(1.36, -(pitch - half) + 0.52));
        const el = (lo + hi) / 2, hv = (hi - lo) / 2 + 0.05;
        let hx = dir.x, hz = dir.z, hl = Math.hypot(hx, hz);
        if (hl < 1e-3) { up.set(0, 1, 0).applyQuaternion(camera.quaternion); hx = up.x; hz = up.z; hl = Math.hypot(hx, hz) || 1; } // (looking straight down: the frame's top is ahead)
        cam.position.set(camera.position.x, 2 * h - camera.position.y, camera.position.z);
        cam.up.set(0, -1, 0);
        cam.lookAt(look.set(hx / hl * Math.cos(el), Math.sin(el), hz / hl * Math.cos(el)).add(cam.position));
        cam.updateMatrixWorld();
        cam.fov = hv * 360 / Math.PI; cam.zoom = 1;
        cam.aspect = Math.tan(half) * camera.aspect * 1.3 / Math.tan(hv);
        if (reversed) cam._reversedDepth = true; // (the depth range the renderer draws with: three.js turns a camera to the reversed range on its first draw, and would rebuild this one's, oblique plane and all)
        cam.updateProjectionMatrix();
        U.uMirrorMat.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse); // (the texture lookup keeps the plain projection)
        plane.constant = -(h - 0.05);
        if (!oblique()) { U.uMirrorOn.value = 0; return; }
        const prevT = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate;
        U.uMirror.value = blank; U.uMirrorOn.value = 0;      // not into itself
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(rt);
        renderer.clear();
        // What mirrors is not in the mirror: a street does not reflect itself, and seen from under it (where the
        // mirrored camera stands) the paving, the kerbs and the paint over the plane were a ceiling between the camera
        // and the city: from a carriageway, at a walker's eye height, the street showed nothing but that ceiling.
        for (const m of mats) { m.userData.oeMirVis = m.visible; m.visible = false; }
        try { renderer.render(scene, cam); } finally { for (const m of mats) m.visible = m.userData.oeMirVis; }
        renderer.setRenderTarget(prevT);
        renderer.shadowMap.autoUpdate = prevShadow;
        U.uMirror.value = rt.texture; U.uMirrorOn.value = 1;
      },
      setSize(w, h) { if (rt) { rt.setSize(dim(w), dim(h)); U.uMirrorPx.value.set(1 / dim(w), 1 / dim(h)); } },
      // draw it once while the game loads, whatever the weather: anything the screen's own draws have not
      // compiled (what is out of view from the title's orbit, a variant for the mirror's render target)
      // compiles then, not with the first rain. Compiled first in slices (world.js compile), so that no one
      // task builds them all, which for the most part only looks up the screen's programs; then drawn.
      // Returns a promise where it compiles in slices.
      warm(scene, { hold = null } = {}) {
        if (!rt) return;
        const draw = () => {
          const u = wetU() || own, w = u.value;
          u.value = 1; api.every = true;
          try { api.update(scene, 0); } finally { u.value = w; api.every = false; U.uMirrorOn.value = 0; U.uWetM.value = w; }
        };
        if (!(window.OEWorld && OEWorld.compile)) return draw();
        return OEWorld.compile(renderer, scene, camera, { target: rt, behind: true, hold, shadows: false }).then(draw);
      },
      dispose() { if (rt) rt.dispose(); blank.dispose(); },
    };
    api.setSize(size.x, size.y);
    return api;
  }
  return { create, PUDDLE };
})();
