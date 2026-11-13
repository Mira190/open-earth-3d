// Rooms behind a landmark's windows (landmarks.json "interior": {"room_m": [w, h, d], "win_m": [w, h]}):
// interior mapping, as web/buildings.js draws the generic buildings' windows and as games draw a city's
// (a ray from the eye through the glass meets the back wall, the floor, the ceiling or a side wall of a
// box room behind it). The glass's texture coordinates are metres across the opening from its left jamb
// and up from its sill; the room is room_m wide (centred on the opening), high (from a floor 0.9 m under
// the sill) and deep. By day the room is dim, lit from the window; after dark it takes the material's
// emissive (its lamps: a floodlit material's glow, which the night turns up), brightest on the ceiling's
// light and falling off to the back. Each room's walls are a shade of their own.
// Shared by every city and by the hero levels' windows (web/game/hero.js win* materials may call apply).
'use strict';
window.OEInterior = (function () {
  // mat: a MeshStandardMaterial whose mesh has uv in metres; spec: landmarks.json "interior"; night: {value} 0..1
  function apply(mat, spec, { night = { value: 0 } } = {}) {
    const [rw, rh, rd] = spec.room_m || [3.6, 3.4, 4.5], [ww, wh] = spec.win_m || [1.5, 2.6];
    mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
    const own = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (own) own(sh, r);
      Object.assign(sh.uniforms, { uIrRoom: { value: new THREE.Vector3(rw, rh, rd) }, uIrWin: { value: new THREE.Vector2(ww, wh) }, uIrNight: night });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIrW; varying vec3 vIrN;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vIrW = (modelMatrix * vec4(transformed, 1.0)).xyz; vIrN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uIrRoom; uniform vec2 uIrWin; uniform float uIrNight; varying vec3 vIrW; varying vec3 vIrN;
float irH(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 N = normalize(vIrN), V = normalize(vIrW - cameraPosition);
    if (dot(V, N) > 0.0) N = -N; // (glass drawn from either side: the room is on the far side of it)
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
    // where the eye's ray enters the room's box, in the room's own units (0..1 across and up, 0..1 deep)
    vec2 p0 = vec2((vUv.x + 0.5 * (uIrRoom.x - uIrWin.x)) / uIrRoom.x, (vUv.y + 0.9) / uIrRoom.y);
    vec3 d = vec3(dot(V, T) / uIrRoom.x, V.y / uIrRoom.y, -dot(V, N) / uIrRoom.z);
    vec3 inv = 1.0 / max(abs(d), vec3(1e-4));
    float tx = (d.x > 0.0 ? 1.0 - p0.x : p0.x) * inv.x, ty = (d.y > 0.0 ? 1.0 - p0.y : p0.y) * inv.y, tz = inv.z;
    float t = min(min(tx, ty), tz);
    vec3 hp = vec3(p0, 0.0) + d * t;
    vec2 id = floor(vIrW.xz / uIrRoom.x * 0.7 + vIrW.y / uIrRoom.y);
    float rr = irH(id);
    vec3 wallC = mix(vec3(0.72, 0.66, 0.56), vec3(0.6, 0.62, 0.6), rr);
    vec3 c;
    if (tz <= t * 1.0001 + 1e-5) {
      c = wallC;
      c *= 1.0 - 0.45 * step(0.4, rr) * step(hp.y, 0.3) * step(0.2, hp.x) * step(hp.x, 0.8); // a cabinet, a desk
      c = mix(c, vec3(0.25, 0.2, 0.16), step(0.75, rr) * step(0.35, hp.y) * step(hp.y, 0.75) * step(0.3, hp.x) * step(hp.x, 0.7)); // a picture
    } else if (ty <= t * 1.0001 + 1e-5) {
      c = d.y > 0.0 ? vec3(0.86, 0.84, 0.8) : mix(vec3(0.38, 0.27, 0.18), vec3(0.42, 0.36, 0.3), rr); // ceiling, floor
    } else c = wallC * 0.82;
    float depth = clamp(hp.z, 0.0, 1.0);
    float spot = d.y > 0.0 && ty <= t * 1.0001 + 1e-5 ? 1.0 + 1.5 * exp(-10.0 * dot(hp.xz - vec2(0.5, 0.45), hp.xz - vec2(0.5, 0.45))) : 1.0;
    vec3 lamp = totalEmissiveRadiance * spot * mix(1.25, 0.55, depth);
    vec3 day = c * 0.09 * (1.0 - uIrNight) * mix(1.0, 0.4, depth);
    // the room fades to its mean where a window is a pixel or two
    float far = smoothstep(0.08, 0.3, max(fwidth(vUv.x), fwidth(vUv.y)));
    totalEmissiveRadiance = mix(c * lamp + day, totalEmissiveRadiance * 0.7 + 0.04 * (1.0 - uIrNight), far); }`);
    };
    const key = mat.customProgramCacheKey && mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
    mat.customProgramCacheKey = () => `ir|${key ? key() : ''}`;
  }
  return { apply };
})();
