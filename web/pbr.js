// Tiled PBR surfaces for landmark materials (landmarks.json "pbr": {"set": name, "tile_m": [w, h]}):
// a colour map, a normal map and a roughness map from web/assets/pbr/ (Poly Haven, CC0; fetched and
// sized by pipeline/fetch_pbr.py), repeated every tile_m metres of the mesh's texture coordinates
// (which are in metres, as the patterns' are).
//
// The material's own colour and roughness stay what it averages to: the textures are divided by their
// set's mean (assets/pbr/sets.json), so a mesh reads the same whether its maps have loaded or not, and
// a city tunes a surface by its colour as before. The low tier takes the 512 px maps and no roughness
// map; the others the 1024 px ones; a phone (the lean part of the low tier) none. Two things break the repeat that a tiled photograph shows over a
// wall of a hundred metres: a slow variation of tone across the surface (a few metres across, from the
// world position, so two walls never repeat alike), and weathering at the foot of a wall (darker,
// rougher, splashed by the rain) up "grime_m" metres over the ground ("grime_z": the ground's height).
// Shared by every city: a landmark names a set, it does not keep its own copy.
'use strict';
window.OEPbr = (function () {
  const BASE = 'assets/pbr/';
  let sets = null, setsP = null;
  const cache = {};
  function load() {
    if (!setsP) setsP = fetch(BASE + 'sets.json').then(r => r.json()).then(j => (sets = j)).catch(() => (sets = {}));
    return setsP;
  }
  function tex(file, srgb, aniso) {
    if (cache[file]) return cache[file];
    const t = new THREE.TextureLoader().load(BASE + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return (cache[file] = t);
  }
  // mat: a MeshStandardMaterial with its colour and roughness set; spec: landmarks.json's "pbr"
  // (off on a phone: OEQuality.city().lean, where every megabyte of the GPU counts; the material keeps its colour)
  const lean = (() => { try { return !!(window.OEQuality && OEQuality.city().lean); } catch (e) { return false; } })();
  function apply(mat, spec, { small = false, aniso = 4 } = {}) {
    const s = sets && sets[spec.set];
    if (!s || lean) return;
    const size = small ? '512' : '1k', [tw, th] = spec.tile_m || [2, 2];
    const set = (t) => { const c = t.clone(); c.repeat.set(1 / tw, 1 / th); c.needsUpdate = true; return c; };
    mat.map = set(tex(`${spec.set}_col_${size}.webp`, true, aniso));
    mat.normalMap = set(tex(`${spec.set}_nrm_${size}.webp`, false, aniso));
    const ns = spec.normal ?? 1;
    mat.normalScale = new THREE.Vector2(ns, ns);
    if (!small) mat.roughnessMap = set(tex(`${spec.set}_rgh_${size}.webp`, false, aniso));
    // the maps average to the material's colour and roughness
    mat.color.r /= s.mean[0]; mat.color.g /= s.mean[1]; mat.color.b /= s.mean[2];
    if (!small) mat.roughness = Math.min(1, mat.roughness / Math.max(0.05, s.rough));
    const vary = spec.vary ?? 0.14, grime = spec.grime_m || 0, gz = spec.grime_z || 0;
    const own = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (own) own(sh, r);
      sh.uniforms.uPbrV = { value: new THREE.Vector3(vary, grime, gz) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPbrW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vPbrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uPbrV; varying vec3 vPbrW; float pbrGrime;
float pbrN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
  { vec2 wp = vPbrW.xz + vPbrW.y * 0.37;
    float n = pbrN(wp * 0.21) * 0.6 + pbrN(wp * 0.83) * 0.4;
    diffuseColor.rgb *= 1.0 + uPbrV.x * (n - 0.5) * 2.0;
    pbrGrime = 0.0;
    if (uPbrV.y > 0.0) {
      float h = vPbrW.y - uPbrV.z; // the world's y is up in the scene
      pbrGrime = (1.0 - smoothstep(0.0, uPbrV.y, h)) * (0.65 + 0.35 * pbrN(wp * 1.7));
      diffuseColor.rgb *= 1.0 - 0.32 * pbrGrime;
    } }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = min(1.0, roughnessFactor + 0.12 * pbrGrime);');
    };
    const key = mat.customProgramCacheKey && mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
    mat.customProgramCacheKey = () => `pbr|${key ? key() : ''}|${small}`;
  }
  return { load, apply };
})();
