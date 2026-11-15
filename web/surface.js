// Surface: photographed asphalt and concrete on the street at eye level, in the game.
//
// From a few metres up a street is half the frame, and a procedural grain over a flat colour reads as
// a model of a street, not a street. Here the ground's close range takes scanned PBR surfaces (Poly
// Haven, CC0: pipeline/surfaces.py packs each into one RGBA image, the luminance over its mean, the
// roughness, and the normal's x and y), sampled in metres in world space:
//  - the colour keeps each material's own tone (the city's asphalt, its paving) and takes the scan's
//    detail as a ratio about it, so no city changes colour from the air;
//  - the normal perturbs the shading normal about the surface's own, so the aggregate's stones catch a
//    low sun, the street lights and the screens' light (neon.js), and the roughness polishes the stones
//    and leaves the tar between them matte: the glint a real road has at a grazing angle;
//  - the tile does not repeat visibly: two lookups at offsets that change across the street, blended by
//    a value noise (Inigo Quilez's "texture repetition", technique 3, MIT-licensed shader code on
//    Shadertoy; here with value noise in place of its noise texture), under a slower variation of tone;
//  - road paint ("paint") is worn through to the asphalt under it where feet and tyres wear it, and
//    greyed where it is not, as the paint of a busy crossing is.
// It fades out with distance (a pixel of the texture under a pixel of the screen and it would shimmer),
// so from the air the street is what it was. On the low tier (phones) nothing is loaded and no shader
// changes: the surfaces cost the high tier two 1024 px layers of one array texture (11 MB of GPU memory with mips) and the
// medium tier two at 512 px (3 MB), loaded after the game is playable.
//
//   OESurface.active                 whether this tier draws them
//   OESurface.load(renderer)         fetch the textures (once; the shaders show nothing until they come)
//   OESurface.ground(sh, masks)      the game's ground tiles: masks.road, masks.paved are GLSL floats in scope
//   OESurface.material(mat, kind)    a landmark's paving: kind 'asphalt', 'concrete' or 'paint'
//   OESurface.kindOf(spec)           the kind a landmark material takes (landmarks.json), or null
'use strict';
window.OESurface = (function () {
  const tier = (() => { try { return window.OEQuality ? OEQuality.city().name : 'low'; } catch (e) { return 'low'; } })();
  const off = /[?&]surface=off/.test(location.search);
  const SIZE = { high: 1024, medium: 512 }[tier] || 0;
  const active = !!SIZE && !off;
  // the surfaces' tiles in metres (pipeline/surfaces.py)
  const U = {
    uSf: { value: null }, uSfOn: { value: 0 }, // (the two surfaces as the layers of one array texture: one texture unit, not two)
    uSfTile: { value: null }, // vec2: asphalt, concrete (set once THREE is up)
  };
  let loading = null;

  function load(renderer) {
    if (!active || loading) return loading;
    const ld = new THREE.TextureLoader(), aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    const one = name => new Promise(res => ld.load(`assets/surface/${name}_${SIZE}.webp`, t => {
      Object.assign(t, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace, anisotropy: aniso });
      t.needsUpdate = true;
      res(t);
    }, undefined, () => res(null)));
    loading = Promise.all([one('asphalt'), one('concrete')]).then(([a, c]) => {
      if (!a || !c || !renderer) return false;
      // A fragment shader has sixteen texture units on an Apple GPU or a phone, and the ground's needs every one
      // (glcare.js fit): the two scans are copied into the layers of one array texture, texel for texel, and the
      // shaders read a layer. (Copied on the GPU: a canvas would multiply the colour by the alpha, which here is
      // the normal's y.) A restored context has lost the copy, and it is made again from the images.
      const rt = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, 2, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace, anisotropy: aniso });
      const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, uniforms: { t: { value: null } },
        vertexShader: 'in vec3 position; out vec2 v; void main() { v = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'precision highp float; uniform sampler2D t; in vec2 v; out vec4 o; void main() { o = texture(t, v); }' });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      const tri = new THREE.Mesh(geo, mat), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      tri.frustumCulled = false;
      const copy = () => {
        const was = renderer.getRenderTarget(), layer = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), auto = renderer.autoClear, xr = renderer.xr.enabled;
        renderer.autoClear = false; renderer.xr.enabled = false;
        [a, c].forEach((t, i) => {
          Object.assign(t, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, anisotropy: 1 }); t.needsUpdate = true;
          mat.uniforms.t.value = t;
          renderer.setRenderTarget(rt, i);
          renderer.render(tri, cam);
          t.dispose(); // (its copy on the GPU: the image stays, for a restored context)
        });
        renderer.setRenderTarget(was, layer, mip);
        renderer.autoClear = auto; renderer.xr.enabled = xr;
      };
      copy();
      renderer.domElement.addEventListener('webglcontextrestored', () => setTimeout(() => { try { copy(); } catch (e) { U.uSfOn.value = 0; } }, 0));
      U.uSf.value = rt.texture; U.uSfOn.value = 1;
      return true;
    });
    return loading;
  }

  // the shared GLSL: anti-tiled lookup, and what a lookup gives (detail, roughness, normal in world space)
  const PARS = `
uniform highp sampler2DArray uSf; uniform float uSfOn; uniform vec2 uSfTile;
float sfH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sfN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sfH(i), sfH(i + vec2(1, 0)), f.x), mix(sfH(i + vec2(0, 1)), sfH(i + vec2(1, 1)), f.x), f.y); }
// x in tiles: two lookups, each at an offset that a noise across the tiles picks, blended where it changes
vec4 sfTap(float t, vec2 x) { // (t: the layer, 0 the asphalt and 1 the concrete)
  float k = sfN(x * 0.55) * 0.6 + sfN(x * 1.7 + 4.3) * 0.4;
  vec2 dx = dFdx(x), dy = dFdy(x);
  float l = k * 8.0, f = fract(l), ia = floor(l), ib = ia + 1.0;
  vec4 a = textureGrad(uSf, vec3(x + sin(vec2(3.0, 7.0) * ia), t), dx, dy), b = textureGrad(uSf, vec3(x + sin(vec2(3.0, 7.0) * ib), t), dx, dy);
  float s = a.r - b.r;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * s));
}
// sampled at a world point (three.js: y up), the surface's normal nW (world): x = colour ratio, y = roughness,
// zw = the normal's x and y in the tangent frame east and north along the surface
vec4 sfSample(int kind, vec3 wp) {
  vec2 p = vec2(wp.x, -wp.z);
  return kind == 0 ? sfTap(0.0, p / uSfTile.x) : sfTap(1.0, p / uSfTile.y);
}
vec3 sfNormalW(vec4 s, vec3 nW, float strength) {
  vec2 nxy = (s.zw * 2.0 - 1.0) * strength;
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - nW * nW.x), B = cross(nW, T);
  return normalize(T * nxy.x + B * nxy.y + nW * sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
}
// how near: the scan's detail to about 60 m, where a 3 mm texel is far under a pixel
float sfNear(vec3 wp) { return uSfOn * (1.0 - smoothstep(18.0, 70.0, distance(wp, cameraPosition))); }
`;

  const VARY_V = sh => sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSfWP;')
    .replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
vSfWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vSfWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);

  function tile() {
    if (!U.uSfTile.value) U.uSfTile.value = new THREE.Vector2(3.0, 2.0);
  }

  // the game's ground tiles: masks.road and masks.paved are floats the ground's own shader computed
  // in its map stage (game.js); the asphalt goes on the road, the concrete's grain on the paving
  const short = () => !!(window.OEGLCare && OEGLCare.fit.off('surface')); // (a GPU short of texture units: glcare.js fit)
  function ground(sh, masks) {
    if (!active || short()) return;
    tile();
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VARY_V(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSfWP;${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec4 sfA = vec4(0.5, 0.8, 0.5, 0.5), sfC = vec4(0.5, 0.8, 0.5, 0.5);
float sfK = sfNear(vSfWP), sfRoad = 0.0, sfPave = 0.0;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (sfK > 0.002) {
  sfRoad = clamp(${masks.road}, 0.0, 1.0) * sfK; sfPave = clamp(${masks.paved}, 0.0, 1.0) * (1.0 - clamp(${masks.road}, 0.0, 1.0)) * sfK;
  if (sfRoad > 0.002) sfA = sfSample(0, vSfWP);
  if (sfPave > 0.002) sfC = sfSample(1, vSfWP);
  // the aggregate's tone, kept gentle so the road reads as an even surface, not a speckle; a slow, soft
  // patch tone across it (wheel tracks, dust at the kerb), its contrast held low to stay easy on the eye
  float sfMac = 0.95 + 0.07 * (sfN(vSfWP.xz * 0.09) * 0.65 + sfN(vSfWP.xz * 0.31 + 9.1) * 0.35);
  diffuseColor.rgb *= mix(1.0, clamp(sfA.r * 2.0, 0.78, 1.22) * sfMac, sfRoad * 0.7);
  diffuseColor.rgb *= mix(1.0, clamp(sfC.r * 2.0, 0.82, 1.18), sfPave * 0.6);
  roughnessFactor = mix(roughnessFactor, mix(0.72, 0.98, sfA.g), sfRoad * 0.8);
  roughnessFactor = mix(roughnessFactor, mix(0.78, 0.98, sfC.g), sfPave * 0.6);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (sfRoad + sfPave > 0.004) {
  vec3 sfNW = inverseTransformDirection(normal, viewMatrix);
  vec3 sfA3 = sfNormalW(sfA, sfNW, 0.5), sfC3 = sfNormalW(sfC, sfNW, 0.4);
  vec3 sfP = normalize(sfNW + (sfA3 - sfNW) * sfRoad + (sfC3 - sfNW) * sfPave);
  normal = normalize((viewMatrix * vec4(sfP, 0.0)).xyz);
}`);
  }

  // which kind a landmark material takes: its own "surface", or by what it is: paving under the street
  // lights that is dark and grey is asphalt, near-white and laid over it ("decal") is road paint, the rest
  // paving; a material with an image or one that glows takes none
  function kindOf(m) {
    if (!m) return null;
    if (m.surface !== undefined) return m.surface || null;
    if (!m.street_lit || m.map || m.pbr || m.emissive || m.opacity < 1) return null; // (a tiled PBR set, pbr.js, keeps its own)
    const c = String(m.color || '#808080').replace('#', ''), v = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
    const mx = Math.max(...v), mn = Math.min(...v), L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    if (L < 0.36 && mx - mn < 0.08) return 'asphalt';
    if (m.decal && L > 0.7 && mx - mn < 0.1) return 'paint';
    if (mx - mn < 0.25) return 'concrete';
    return null;
  }

  // a landmark's material (world.js lmMats): wraps its own onBeforeCompile
  function material(mat, kind) {
    if (!active || !kind) return;
    tile();
    const own = mat.onBeforeCompile, isPaint = kind === 'paint', idx = kind === 'concrete' ? 1 : 0;
    mat.onBeforeCompile = (sh, r) => {
      if (own) own(sh, r);
      if (short()) return;
      Object.assign(sh.uniforms, U);
      sh.vertexShader = VARY_V(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSfWP;${PARS}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float sfK = sfNear(vSfWP) * smoothstep(0.6, 0.85, abs(normalize(cross(dFdx(vSfWP), dFdy(vSfWP))).y)); // (the ground, not a kerb's face)
vec4 sfS = vec4(0.5, 0.8, 0.5, 0.5);
if (sfK > 0.002) {
  sfS = sfSample(${idx}, vSfWP);
  float sfMac = 0.96 + 0.06 * (sfN(vSfWP.xz * 0.09) * 0.65 + sfN(vSfWP.xz * 0.31 + 9.1) * 0.35);
${isPaint ? `  // the paint: a little grime so it is not a flat white, and worn only softly along a few broad lanes where
  // feet cross most, to a muted grey (never a black speckle), so a crossing reads as painted, not dirty
  float sfLane = sfN(vSfWP.xz * 0.14) * 0.6 + sfN(vSfWP.xz * 0.5 + 2.0) * 0.4;             // broad, slow: where it wears
  float sfWear = smoothstep(0.62, 0.86, sfLane) * 0.5 * sfK;                                // soft, sparse, shallow
  vec3 sfGrey = vec3(0.34, 0.35, 0.36) * clamp(sfS.r * 2.0, 0.85, 1.12);
  diffuseColor.rgb *= mix(1.0, (0.95 + 0.05 * sfS.r) * (0.97 + 0.03 * sfN(vSfWP.xz * 0.4)), sfK); // faint grime, low contrast
  diffuseColor.rgb = mix(diffuseColor.rgb, sfGrey, sfWear);
  roughnessFactor = mix(roughnessFactor, mix(0.5, 0.85, sfS.g), sfWear);
  sfK *= 0.5;                                                                               // the paint takes little of the stones' relief`
    : `  diffuseColor.rgb *= mix(1.0, clamp(sfS.r * 2.0, ${idx ? '0.82, 1.18' : '0.78, 1.22'}) * sfMac, sfK * ${idx ? '0.6' : '0.7'});
  roughnessFactor = mix(roughnessFactor, ${idx ? 'mix(0.78, 0.98, sfS.g)' : 'mix(0.72, 0.98, sfS.g)'}, sfK * 0.8);`}
}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (sfK > 0.002) {
  vec3 sfNW = inverseTransformDirection(normal, viewMatrix);
  vec3 sfP = normalize(mix(sfNW, sfNormalW(sfS, sfNW, ${idx ? '0.4' : '0.5'}), sfK));
  normal = normalize((viewMatrix * vec4(sfP, 0.0)).xyz);
}`);
    };
    const key = mat.customProgramCacheKey && mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
    mat.customProgramCacheKey = () => `${key ? key() : mat.uuid}|sf-${kind}`;
  }

  return { active, tier, load, ground, material, kindOf, U };
})();
