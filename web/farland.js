// Open Earth 3D: the land past the model's frame (pipeline/far_land.py, web/data/<city>/far.*).
//
// Past the frame the city is haze (world.js edgeHaze) and the sea carries on where there is
// open water (sea.jpg). Under that haze this draws the land that is really there: a low terrain
// from Copernicus GLO-30 heights, coloured by ESA WorldCover's land cover in the city's own
// photo's colours, so the hills rise into the haze, forest reads darker than suburbs and
// farmland, a lake up in the hills keeps its water, and after dark the built-up land glows as it
// does in a night photograph from the air (NASA Black Marble, sharpened by WorldCover's built-up
// share). It takes the scene's fog with the edge haze's own rule (OE_FAR in world.js): full haze
// at the frame, where the city has faded into it, clearing over the first FAR_RAMP metres to
// FAR_BASE, then the distance's own fog.
//
// The grid is finer near the frame and coarser far out (a power law in each axis), and coarser
// still on a small device (quality.js "low"). Built from the height map on the CPU once; one draw
// call, no shadows.
'use strict';
window.OEFarLand = (function () {
  // world.js edgeHaze reads them: the haze over the far land at the frame (EDGE, as much as the city's
  // own edge takes there), how far out it clears (RAMP, metres) and to how much (BASE)
  const EDGE = 0.2, RAMP = 350, BASE = 0.04, AIR = 30000; // AIR: metres of air to a 63% veil
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  // the far land's bytes: far.json, the height map's pixels and the colour texture; null if there are none
  async function load(DATA) {
    try {
      const meta = await fetch(DATA + 'far.json').then(r => (r.ok ? r.json() : null));
      if (!meta) return null;
      const blob = await fetch(DATA + 'far.png').then(r => (r.ok ? r.blob() : null));
      if (!blob) return null;
      // the bytes as written: no colour management, no premultiplying
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const col = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = DATA + 'far.jpg'; });
      if (!col) return null;
      return { meta, px, n: bmp.width, col };
    } catch (e) {
      console.warn('far land: none', e);
      return null;
    }
  }

  // the terrain's geometry and the night lights' texels, shared with the reef sites (reef/farland.js).
  // F: load()'s result; frame: {x: [x0, x1], y: [y0, y1]}, the model's own ground inside it;
  // ground(x, y): that ground's height; small: the lighter set; T: the three.js namespace
  // landMin: the lowest the land past the frame may be (a reef site's highest tide), so the sea never laps over it
  function geometry(F, { frame, ground, small, landMin = -Infinity }, T) {
    const { meta, px, n } = F, H = meta.half_m, cx = meta.cx, cy = meta.cy, cell = 2 * H / n;
    const fx0 = frame.x[0], fx1 = frame.x[1], fy0 = frame.y[0], fy1 = frame.y[1];
    // height at a local point (bilinear on the height map; row 0 north)
    const hAt = (r, c) => { r = Math.min(n - 1, Math.max(0, r)); c = Math.min(n - 1, Math.max(0, c)); const i = 4 * (r * n + c); return (px[i] * 256 + px[i + 1]) / 4 - 100; };
    const height = (x, y) => {
      const fc = (x - (cx - H)) / cell - 0.5, fr = ((cy + H) - y) / cell - 0.5;
      const c = Math.floor(fc), r = Math.floor(fr), u = fc - c, v = fr - r;
      return (hAt(r, c) * (1 - u) + hAt(r, c + 1) * u) * (1 - v) + (hAt(r + 1, c) * (1 - u) + hAt(r + 1, c + 1) * u) * v;
    };
    const past = (x, y) => Math.hypot(Math.max(fx0 - x, 0, x - fx1), Math.max(fy0 - y, 0, y - fy1));
    // a grid with its lines closer together near the centre: x = H t^P, so about 40 m apart at the
    // frame and a few hundred far out
    const N = small ? 128 : 256, P = 1.7;
    const axis = c0 => Array.from({ length: N + 1 }, (_, i) => { const t = 2 * i / N - 1; return c0 + Math.sign(t) * H * Math.pow(Math.abs(t), P); });
    const xs = axis(cx), ys = axis(cy);
    const pos = new Float32Array((N + 1) * (N + 1) * 3), inside = new Uint8Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = xs[i], y = ys[N - j], k = j * (N + 1) + i, d = past(x, y);
      let h;
      if (d <= 0) {
        // under the city's own ground (never seen; it keeps the triangles that cross the frame whole)
        h = ground(x, y) - 12; inside[k] = 1;
      } else {
        // from the city's terrain at its edge to the measured relief over the first kilometre
        const ex = Math.min(fx1, Math.max(fx0, x)), ey = Math.min(fy1, Math.max(fy0, y));
        const t = Math.min(1, d / 1000), s = t * t * (3 - 2 * t);
        let hm = height(x, y);
        if (hm > 0) hm = Math.max(hm, landMin);
        h = (ground(ex, ey) - 2) * (1 - s) + hm * s;
      }
      pos[3 * k] = x; pos[3 * k + 1] = h; pos[3 * k + 2] = -y;
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    // the night lights as a texture, from the height map's blue channel (stored as a square root)
    const lights = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) { const v = px[4 * i + 2]; lights[4 * i] = lights[4 * i + 1] = lights[4 * i + 2] = v; lights[4 * i + 3] = 255; }
    return { geo, lights, n, height, tris: idx.length / 3 };
  }

  // the city's far land (world.js). PG, PHOTO_GRADE: the city photo's grade, which the colours were measured under
  function create(F, { frame, ground, small, PG, PHOTO_GRADE }) {
    const { meta } = F, H = meta.half_m, cx = meta.cx, cy = meta.cy;
    const { geo, lights, n, height, tris } = geometry(F, { frame, ground, small }, THREE);
    const lightTex = new THREE.DataTexture(lights, n, n);
    lightTex.flipY = false; // row 0 north: flipped in the shader
    lightTex.magFilter = THREE.LinearFilter; lightTex.minFilter = THREE.LinearMipmapLinearFilter; lightTex.generateMipmaps = true;
    lightTex.needsUpdate = true;
    const col = new THREE.Texture(F.col);
    col.needsUpdate = true;
    col.colorSpace = THREE.SRGBColorSpace;
    col.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, emissive: lin('#ffd9a8'), emissiveIntensity: 0 });
    mat.defines = { OE_FAR: '' };
    const night = { value: 0 };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uPhotoGrade: PG, uFarCol: { value: col }, uFarLights: { value: lightTex }, uFarNight: night,
        uFarBox: { value: new THREE.Vector3(cx - H, cy - H, 2 * H) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFarUV; varying vec2 vFarXZ; uniform vec3 uFarBox;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vFarXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
  vFarUV = vec2((vFarXZ.x - uFarBox.x) / uFarBox.z, (-vFarXZ.y - uFarBox.y) / uFarBox.z);`)
        ;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${PHOTO_GRADE}
uniform sampler2D uFarCol, uFarLights; uniform float uFarNight; varying vec2 vFarUV; varying vec2 vFarXZ;
float farH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float farN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(farH(i), farH(i + vec2(1, 0)), f.x), mix(farH(i + vec2(0, 1)), farH(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `{
  // the land cover's colour, with what its 78 m cells average away put back as a grain of fields,
  // blocks and woods at 40 to 300 m, which fades out where a pixel covers it
  vec3 c = photoGrade(texture2D(uFarCol, vFarUV).rgb);
  vec2 p = vFarXZ; float fw = max(fwidth(p.x), fwidth(p.y));
  float g = (farN(p / 300.0) - 0.5) * 0.25 * (1.0 - smoothstep(60.0, 200.0, fw))
          + (farN(p / 90.0 + 7.0) - 0.5) * 0.45 * (1.0 - smoothstep(18.0, 60.0, fw))
          + (farN(p / 33.0 + 3.0) - 0.5) * 0.3 * (1.0 - smoothstep(7.0, 22.0, fw));
  // seen through kilometres of air the land's colours are thinner than the photo's close by
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.8);
  diffuseColor.rgb *= c * (1.0 + g);
}`)
        .replace('#include <emissivemap_fragment>', `{
  // after dark the built-up land's lights: Black Marble's glow, broken up as a city's lights are
  // seen from the air (streets of points, not a lit sheet), the grain fading where a pixel covers it
  float L = texture2D(uFarLights, vec2(vFarUV.x, 1.0 - vFarUV.y)).r; L *= L;
  // points of light in 24 m cells, at a random place in each, more of them the brighter the land
  // (a core's streets lit end to end, a suburb's here and there), over a faint glow; the mean over
  // a cell is about 1, which is what a pixel covering many cells shows
  vec2 q = vFarXZ / 24.0, iq = floor(q), fq = fract(q) - 0.5;
  vec2 o = vec2(farH(iq), farH(iq + 17.3)) - 0.5;
  float fw = max(fwidth(q.x), fwidth(q.y)), dens = 0.08 + 0.5 * L;
  float on = step(1.0 - dens, farH(iq + 5.1)), r = length(fq - 0.6 * o);
  // a dot of radius 0.07 cells; one smaller than a pixel is drawn a pixel wide and dimmer by the
  // ratio of the areas (as a camera sees a point of light: its light spread over the pixel), so
  // the mean over many cells stays at about 1 at any distance
  float rr = max(0.07, fw), k = 0.07 / rr, dots = on * (1.0 - smoothstep(rr * 0.5, rr, r)) * k * k / (dens * 0.0090);
  // where the points merge, the glow they leave: brighter than their strict mean, as a camera's
  // tone curve shows a sea of sub-pixel lights, so that the two meet without a step
  float grain = 0.2 + mix(0.8 * dots, 1.8, smoothstep(0.15, 1.2, fw));
  L *= L; // Black Marble's visual product saturates over a city: more contrast between core and suburb
  totalEmissiveRadiance *= L * grain * uFarNight;
}`);
    };
    mat.customProgramCacheKey = () => 'farland';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'far-land';
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    console.info(`far land: ${tris.toLocaleString()} triangles, relief to ${meta.relief_m[1]} m`);
    return {
      mesh, height,
      // after dark (world.js setSun, U.uNight 0..1)
      setNight(k) { night.value = k; mat.emissiveIntensity = k > 0 ? 0.05 : 0; },
      dispose() { geo.dispose(); mat.dispose(); lightTex.dispose(); col.dispose(); },
    };
  }

  return { load, geometry, create, EDGE, RAMP, BASE, AIR };
})();
