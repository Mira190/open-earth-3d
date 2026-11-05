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
    col.anisotropy = 16; // three.js holds it to what the GPU allows: the land is mostly seen at a low angle
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, emissive: lin('#ffd9a8'), emissiveIntensity: 0 });
    mat.defines = { OE_FAR: '' };
    const night = { value: 0 };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uPhotoGrade: PG, uFarCol: { value: col }, uFarLights: { value: lightTex }, uFarNight: night,
        uFarBox: { value: new THREE.Vector3(cx - H, cy - H, 2 * H) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFarUV; varying vec2 vFarXZ; varying vec3 vFarW; uniform vec3 uFarBox;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vFarW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFarXZ = vFarW.xz;
  vFarUV = vec2((vFarXZ.x - uFarBox.x) / uFarBox.z, (-vFarXZ.y - uFarBox.y) / uFarBox.z);`)
        ;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${PHOTO_GRADE}
uniform sampler2D uFarCol, uFarLights; uniform float uFarNight; varying vec2 vFarUV; varying vec2 vFarXZ; varying vec3 vFarW;
// the size of a pixel's footprint on the ground in units of p: the geometric mean of its two axes,
// so that land seen at a low angle (a pixel a few metres across but hundreds deep) keeps its grain
float farFw(vec2 p) { return sqrt(length(dFdx(p)) * length(dFdy(p))); }
float farH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float farN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(farH(i), farH(i + vec2(1, 0)), f.x), mix(farH(i + vec2(0, 1)), farH(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `{
  // the land cover's colour, with what its 78 m cells average away put back as a grain of fields,
  // blocks and woods at 40 to 300 m, which fades out where a pixel covers it
  vec3 c = photoGrade(texture2D(uFarCol, vFarUV).rgb);
  vec2 p = vFarXZ; float fw = farFw(p);
  float g = (farN(p / 300.0) - 0.5) * 0.25 * (1.0 - smoothstep(60.0, 200.0, fw))
          + (farN(p / 90.0 + 7.0) - 0.5) * 0.45 * (1.0 - smoothstep(18.0, 60.0, fw))
          + (farN(p / 33.0 + 3.0) - 0.5) * 0.3 * (1.0 - smoothstep(7.0, 22.0, fw));
  // built-up land (where Black Marble sees lights) as roofs: blocks of 40 to 50 m, each a shade
  // lighter or darker than its neighbours, which is what a city reads as from a tower when its
  // buildings are too small to see (no street lines: at a low angle they alias into a grid)
  float bu = smoothstep(0.35, 0.8, texture2D(uFarLights, vec2(vFarUV.x, 1.0 - vFarUV.y)).r);
  // (only at a low angle: from above, the land cover's own colour is the better picture)
  float cosV = abs(normalize(cameraPosition - vFarW).y);
  vec2 bi = floor(p / vec2(38.0, 52.0));
  float roofs = (farH(bi + 31.7) - 0.5) * 0.4;
  g += bu * roofs * (1.0 - smoothstep(14.0, 45.0, fw)) * (1.0 - smoothstep(0.1, 0.3, cosV));
  // and seen at a low angle a city is its walls more than its roofs, half of them in shade
  float wall = bu * pow(1.0 - cosV, 6.0);
  c *= mix(vec3(1.0), vec3(0.8, 0.85, 0.92), wall); // partly in shade, and lit by the sky's blue more than the sun
  // seen through kilometres of air the land's colours are thinner than the photo's close by
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.8);
  diffuseColor.rgb *= c * (1.0 + g);
}`)
        .replace('#include <emissivemap_fragment>', `{
  // after dark the built-up land's lights as a night photograph from the air shows them: not a lit
  // sheet nor a scatter of dots but streets, a lattice of them, lamps strung along each, a soft pool
  // of light round each lamp on the road, the main roads brighter and continuous with their traffic,
  // the lattice turned to each district's own bearing; how many streets are lit follows Black
  // Marble's brightness (a core lit end to end, a suburb here and there). Each part fades to its mean
  // where a pixel covers it, so that seen from far off the land glows evenly, as from a plane
  float L = texture2D(uFarLights, vec2(vFarUV.x, 1.0 - vFarUV.y)).r; L *= L;
  vec2 p = vFarXZ * vec2(1.0, -1.0);
  float fw = max(farFw(p), 0.05); // metres a pixel covers (the geometric mean of its two axes: a grazing pixel is long and thin)
  // the district (a jittered 650 m cell): its bearing and its block sizes
  vec2 di = floor(p / 650.0 + 0.5 * vec2(farN(p / 900.0), farN(p / 900.0 + 9.0)));
  float ang = (farH(di + 3.7) - 0.5) * 1.4 + 0.35, ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y) + farH(di + 1.3) * 400.0;
  q += (vec2(farN(q / 260.0), farN(q / 260.0 + 4.0)) - 0.5) * 16.0; // streets that wander a little
  vec2 bs = vec2(62.0, 84.0) + vec2(farH(di + 2.1), farH(di + 4.4)) * vec2(46.0, 60.0);
  vec2 cell = floor(q / bs), f = q - (cell + 0.5) * bs; // f: metres from the block's centre
  vec2 toLine = 0.5 * bs - abs(f);                        // metres to the street on each axis
  float lit = clamp(L * 1.6, 0.0, 1.0);
  vec3 em = vec3(0.0);
  for (int ax = 0; ax < 2; ax++) {
    // the street along this axis nearest the pixel: its index, whether it is lit, a main road
    float side = ax == 0 ? sign(f.x) : sign(f.y);
    float li = (ax == 0 ? cell.x : cell.y) + max(side, 0.0);
    vec2 id = vec2(li, float(ax) * 31.0) + di * 7.0;
    float main = step(0.88, farH(id + 0.7));
    // lit block by block: a side street lit along one block, dark along the next
    float seg = ax == 0 ? cell.y : cell.x;
    float on = step(farH(id + vec2(seg * 1.7, 2.9)), mix(0.12, 0.8, lit) + main);
    float d = ax == 0 ? toLine.x : toLine.y;        // across the street
    float along = ax == 0 ? q.y : q.x;              // along it
    // lamps every 28 m (a main road's 22 m, both sides), a few out
    float sp = main > 0.5 ? 22.0 : 28.0, k = floor(along / sp + 0.5), u = along - k * sp;
    float lampOn = on * step(0.12, farH(id + vec2(k, 5.0)));
    float dl = length(vec2(d - (main > 0.5 ? 4.0 : 2.5), u));
    // the lamp itself: a point no smaller than a pixel, its light spread over the pixel when it is
    float rc = max(0.7, fw * 0.75), core = (1.0 - smoothstep(0.4 * rc, rc, dl)) * (0.7 * 0.7) / (rc * rc);
    // its pool on the road, long along it
    float pool = exp(-(d * d) / 10.0 - (u * u) / (sp * sp * 0.05));
    // a main road's traffic: a thin line of headlights and tail lights, bunched as cars are
    float traffic = main * exp(-(d * d) / max(9.0, fw * fw)) * (0.04 + 0.16 * smoothstep(0.35, 0.8, farN(vec2(along / 35.0, li)))) * min(1.0, 3.0 / max(fw, 3.0));
    // the mean of the lamps and pools over the street's width, for a pixel that covers them
    float w = main > 0.5 ? 1.6 : 0.55 + 0.35 * farH(id + vec2(seg, 6.0)); // a main road brighter
    float mean = lampOn * (0.7 * 0.7 * 3.14 * 1.6 / sp + 0.3 * sqrt(10.0 * 3.14) * sqrt(sp * sp * 0.05 * 3.14) / sp) / bs[1 - ax];
    float detail = lampOn * (core * 1.6 + pool * 0.3) + traffic;
    float near = 1.0 - smoothstep(6.0, 22.0, fw);
    float v = w * mix(mean * 2.2 + main * on * 0.004, detail, near);
    // a sodium street's orange, an LED main road's warm white
    vec3 tint = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.9, 0.78), main * 0.7 + 0.3 * farH(id + 8.2));
    em += tint * v;
  }
  // the glow over the district from all of it (a faint veil, so the streets keep their contrast)
  em += vec3(1.0, 0.8, 0.6) * 0.022 * lit;
  // a city's lights are points that shine every way, not a lit surface: seen at a low angle a
  // pixel takes in more of them, so the land toward the horizon glows brighter (the band of light a
  // city shows from a tower or an aircraft), up to four times
  float cosV = abs(normalize(cameraPosition - vFarW).y);
  totalEmissiveRadiance *= em * L * 10.0 * uFarNight * clamp(1.0 / max(cosV, 0.02), 1.0, 4.0);
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

  // HALF: a city's far land reaches this far either side of the frame's centre (far_land.py HALF_M)
  return { load, geometry, create, EDGE, RAMP, BASE, AIR, HALF: 40000 };
})();
