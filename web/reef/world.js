// Terrain for the reef viewer: the 30 m survey grid as chunked, level-of-detail meshes under the
// ground colour, plus the height texture the water reads to know how deep it is.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, mix, max, min, smoothstep, clamp, texture, positionWorld, normalWorld,
  mx_noise_float, sin, abs, select } from 'three/tsl';

export const CHUNK = 64;

export async function loadScene(base) {
  const scene = await (await fetch(base + 'scene.json')).json();
  const t = scene.terrain;
  const raw = new Int16Array(await (await fetch(base + t.file)).arrayBuffer());
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] * t.units_m;
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const img = await loadImg(base + scene.ground.file);
  // the habitat classes: one byte per ground pixel, read back from the PNG
  const hi = await loadImg(base + scene.habitat.file);
  const cv = document.createElement('canvas'); cv.width = hi.width; cv.height = hi.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(hi, 0, 0);
  const px = cx.getImageData(0, 0, hi.width, hi.height).data, habitat = new Uint8Array(hi.width * hi.height);
  for (let i = 0; i < habitat.length; i++) habitat[i] = px[i * 4];
  return { scene, heights, img, habitat };
}

// the local frame (x east, y north, z up) is drawn at (x, z, -y)
export function terrainHeight(d, x, north) {
  const t = d.scene.terrain, W = t.w, H = t.h;
  const fx = (x - t.x0) / t.cell_m - 0.5, fy = (t.y1 - north) / t.cell_m - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
  const g = (i, j) => d.heights[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay;
}

export function heightTexture(d) {
  const t = d.scene.terrain;
  const half = new Uint16Array(d.heights.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(d.heights[i]);
  const tex = new THREE.DataTexture(half, t.w, t.h, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// world xz -> uv into the height grid
export function gridUV(d, wx, wz) {
  const t = d.scene.terrain;
  return vec2(wx.sub(t.x0).div(t.w * t.cell_m), wz.add(t.y1).div(t.h * t.cell_m));
}

function chunkGeometry(d, cx, cy, stride) {
  const t = d.scene.terrain, W = t.w, H = t.h, hs = d.heights;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const nx = Math.min(CHUNK, W - 1 - x0), ny = Math.min(CHUNK, H - 1 - y0);
  const sx = Math.max(1, Math.ceil(nx / stride)), sy = Math.max(1, Math.ceil(ny / stride));
  const pos = [], nor = [], idx = [];
  const at = (i, j) => hs[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  const vert = (i, j, drop) => {
    const h = at(i, j), x = t.x0 + (i + 0.5) * t.cell_m, north = t.y1 - (j + 0.5) * t.cell_m;
    pos.push(x, h - drop, -north);
    const hx = (at(i + 1, j) - at(i - 1, j)) / (2 * t.cell_m), hy = (at(i, j + 1) - at(i, j - 1)) / (2 * t.cell_m);
    // gradient wrt east and north; the three.js normal is (-hE, 1, +hN) since z = -north
    const n = new THREE.Vector3(-hx, 1, hy).normalize();
    nor.push(n.x, n.y, n.z);
  };
  const cols = sx + 1;
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) vert(x0 + Math.min(nx, i * stride), y0 + Math.min(ny, j * stride), 0);
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  // skirts hide the cracks between neighbouring levels of detail
  const edge = [];
  for (let i = 0; i <= sx; i++) { edge.push([i, 0]); edge.push([i, sy]); }
  for (let j = 1; j < sy; j++) { edge.push([0, j]); edge.push([sx, j]); }
  const base = pos.length / 3;
  const drop = 18 * stride;
  const skirt = new Map();
  for (const [i, j] of edge) { skirt.set(j * cols + i, pos.length / 3); vert(x0 + Math.min(nx, i * stride), y0 + Math.min(ny, j * stride), drop); }
  const quad = (p, q) => {
    const sp = skirt.get(p), sq = skirt.get(q);
    if (sp === undefined || sq === undefined) return;
    idx.push(p, sp, q, q, sp, sq); idx.push(p, q, sp, q, sq, sp);
  };
  for (let i = 0; i < sx; i++) { quad(i, i + 1); quad(sy * cols + i, sy * cols + i + 1); }
  for (let j = 0; j < sy; j++) { quad(j * cols, (j + 1) * cols); quad(j * cols + sx, (j + 1) * cols + sx); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function createTerrain(d, env, renderer) {
  const t = d.scene.terrain;
  const tex = new THREE.Texture(d.img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  const ground = d.scene.ground;
  const gUV = Fn(() => vec2(positionWorld.x.sub(t.x0).div(ground.w * ground.px_m), positionWorld.z.add(t.y1).div(ground.h * ground.px_m)));

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const swashLevel = env.swash;
  mat.colorNode = Fn(() => {
    const base = texture(tex, gUV()).rgb;
    const y = positionWorld.y;
    // fine grain the 10 m imagery cannot hold: sand ripples and speckle
    const n1 = mx_noise_float(vec3(positionWorld.x.mul(0.8), 0, positionWorld.z.mul(0.8)));
    const n2 = mx_noise_float(vec3(positionWorld.x.mul(7.0), 0, positionWorld.z.mul(7.0)));
    let c = base.mul(float(1).add(n1.mul(0.10)).add(n2.mul(0.06)));
    // wet sand: the beach darkens up to where the last wave reached, and dries upward
    const wet = float(1).sub(smoothstep(swashLevel, swashLevel.add(0.7), y)).mul(smoothstep(env.u.tide.sub(0.05), env.u.tide.add(0.05), y));
    c = mix(c, c.mul(vec3(0.60, 0.58, 0.56)), wet);
    return c;
  })();
  const mesh = new THREE.Group();
  const cw = Math.ceil((t.w - 1) / CHUNK), ch = Math.ceil((t.h - 1) / CHUNK);
  const chunks = [];
  const geoCache = new Map();
  const getGeo = (cx, cy, lod) => {
    const key = (cy * cw + cx) * 4 + lod;
    if (!geoCache.has(key)) geoCache.set(key, chunkGeometry(d, cx, cy, [1, 2, 4, 8][lod]));
    return geoCache.get(key);
  };
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const m = new THREE.Mesh(getGeo(cx, cy, 3), mat);
    m.userData = { cx, cy, lod: 3, centre: new THREE.Vector3(t.x0 + (cx + 0.5) * CHUNK * t.cell_m, 0, -(t.y1 - (cy + 0.5) * CHUNK * t.cell_m)) };
    m.receiveShadow = true;
    mesh.add(m); chunks.push(m);
  }
  const RANGE = [900, 2600, 6500]; // metres at which a chunk drops to the next level
  function update(cam) {
    for (const m of chunks) {
      const c = m.userData.centre, dd = Math.hypot(cam.x - c.x, cam.z - c.z);
      const lod = dd < RANGE[0] ? 0 : dd < RANGE[1] ? 1 : dd < RANGE[2] ? 2 : 3;
      if (lod !== m.userData.lod) { m.userData.lod = lod; m.geometry = getGeo(m.userData.cx, m.userData.cy, lod); }
    }
  }
  // beyond the survey: a flat abyss to the horizon so the water has a floor everywhere
  const abyssMat = new THREE.MeshBasicNodeMaterial();
  abyssMat.colorNode = vec3(0.16, 0.17, 0.15).mul(env.u.white);
  const abyss = new THREE.Mesh(new THREE.CircleGeometry(80000, 48).rotateX(-Math.PI / 2), abyssMat);
  abyss.position.y = -150;
  mesh.add(abyss);
  return { group: mesh, update, material: mat };
}

// the habitat class under a point (local frame: x east, north); see HABITAT in pipeline/build_marine.py
export function habitatAt(d, x, north) {
  const g = d.scene.ground, i = Math.floor((x - d.scene.terrain.x0) / g.px_m), j = Math.floor((d.scene.terrain.y1 - north) / g.px_m);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return d.habitat[j * g.w + i];
}
