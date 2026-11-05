// The land of an alpine site: the LiDAR grid as chunked, level-of-detail meshes under the satellite colour,
// shaded by light.js (the sun through the air, the mountains' shadows, the sky), with detail the 30 m grid and the
// 10 m imagery cannot hold added by land cover (build_alpine.py COVER): grain and glints in the snow, strata and
// fractures in rock, stones in scree and riverbeds, hummocks in the tussock. Around the camera a finer patch
// (2 m cells) rides on a bicubic read of the grid plus relief by cover; its CPU twin (heightAt) is what the
// player and the people stand on.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, uniform, float, int, vec2, vec3, vec4, mix, max, min, abs, floor, fract, smoothstep, clamp, texture, select,
  positionWorld, positionLocal, normalWorld, cameraPosition, length, normalize, dot, sin, varying, mx_noise_float, exp, pow } from 'three/tsl';
import { CHUNK } from '../world.js';

const HALF = 240, CELLS = 240;          // the detail patch: 480 m square, 2 m cells

// ---- the relief the grid cannot hold, by cover class: value noise with the same integer hash in TSL and JS,
// so the CPU (people, the player) stands on exactly the surface the GPU draws
const RELIEF = { 2: 0.35, 3: 0.9, 4: 1.2, 5: 0.55, 6: 0.28, 7: 0.22, 8: 0.25, 9: 0.3, 10: 0.2, 11: 0.06, 12: 0.12, 13: 0, 14: 0, 15: 0.12, 1: 0.05, 0: 0.4 };
const relAmp = Array.from({ length: 16 }, (_, k) => RELIEF[k] ?? 0.2);
const hashJS = (i, j) => { const s = Math.sin(((i % 289) + 289) % 289 * 127.1 + (((j % 289) + 289) % 289) * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoiseJS(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashJS(i, j), b = hashJS(i + 1, j), c = hashJS(i, j + 1), e = hashJS(i + 1, j + 1);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy) * 2 - 1;
}
const fbmJS = (x, z) => vnoiseJS(x / 9, z / 9) * 0.55 + vnoiseJS(x / 3.7, z / 3.7) * 0.3 + vnoiseJS(x / 1.6, z / 1.6) * 0.15;

const mod289 = v => v.sub(floor(v.div(289)).mul(289));
const hashT = (i, j) => fract(sin(mod289(i).mul(127.1).add(mod289(j).mul(311.7))).mul(43758.5453));
const vnoiseT = (x, y) => {
  const i = floor(x), j = floor(y), fx = x.sub(i), fy = y.sub(j);
  const sx = fx.mul(fx).mul(float(3).sub(fx.mul(2))), sy = fy.mul(fy).mul(float(3).sub(fy.mul(2)));
  const a = hashT(i, j), b = hashT(i.add(1), j), c = hashT(i, j.add(1)), e = hashT(i.add(1), j.add(1));
  return a.add(b.sub(a).mul(sx)).add(c.sub(a).mul(sy)).add(a.sub(b).sub(c).add(e).mul(sx).mul(sy)).mul(2).sub(1);
};
const fbmT = (x, z) => vnoiseT(x.div(9), z.div(9)).mul(0.55).add(vnoiseT(x.div(3.7), z.div(3.7)).mul(0.3)).add(vnoiseT(x.div(1.6), z.div(1.6)).mul(0.15));

export function createAlpineTerrain(d, env, renderer, light, heightTex, ctx_clock = null) {
  const t = d.scene.terrain, g = d.scene.ground, W = t.w, H = t.h;
  const lightU = light.u;
  // ---- textures: the ground strips, the cover classes
  const strips = d.strips.map((img, i) => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return { tex, row0: g.strips[i].row0, rows: g.strips[i].rows };
  });
  const cv = d.scene.cover;
  const coverTex = new THREE.DataTexture(d.habitat, cv.w, cv.h, THREE.RedFormat, THREE.UnsignedByteType);
  coverTex.magFilter = coverTex.minFilter = THREE.NearestFilter; coverTex.generateMipmaps = false; coverTex.needsUpdate = true;
  const coverAt = (x, z) => texture(coverTex, vec2(x.sub(t.x0).div(cv.w * cv.px_m), z.add(t.y1).div(cv.h * cv.px_m))).level(0).r.mul(255).add(0.5).floor();
  const ampTex = new THREE.DataTexture(new Uint8Array(16).map((_, k) => Math.round(relAmp[k] / 1.5 * 255)), 16, 1, THREE.RedFormat, THREE.UnsignedByteType);
  ampTex.magFilter = ampTex.minFilter = THREE.NearestFilter; ampTex.needsUpdate = true;
  const ampOf = cls => texture(ampTex, vec2(cls.add(0.5).div(16), 0.5)).level(0).r.mul(1.5);
  // a smooth cover amplitude: the relief of the four nearest cover pixels, blended (no steps at class edges)
  const reliefAmp = (x, z) => {
    const fx = x.sub(t.x0).div(cv.px_m).sub(0.5), fz = z.add(t.y1).div(cv.px_m).sub(0.5);
    const ix = floor(fx), iz = floor(fz), ax = fx.sub(ix), az = fz.sub(iz);
    const at = (i, j) => ampOf(texture(coverTex, vec2(ix.add(i + 0.5).div(cv.w), iz.add(j + 0.5).div(cv.h))).level(0).r.mul(255).add(0.5).floor());
    return mix(mix(at(0, 0), at(1, 0), ax), mix(at(0, 1), at(1, 1), ax), az);
  };

  // ---- the aerial patches (alpine_detail.py): one at a time, the one nearest the camera, loaded when it comes near
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); blank.needsUpdate = true;
  const detailNode = texture(blank);
  const dU = { x0: uniform(0), y1: uniform(0), w: uniform(1), h: uniform(1), on: uniform(0) };
  const areas = (d.scene.detail || []).map(a => ({ ...a, tex: null, loading: false }));
  const base = d.base || '';
  function detailUpdate(cam) {
    let best = null, bd = 1e9;
    for (const a of areas) {
      const cx = a.x0 + a.w * a.px_m / 2, cn = a.y1 - a.h * a.px_m / 2;
      const dd = Math.max(Math.abs(cam.x - cx) - a.w * a.px_m / 2, Math.abs(-cam.z - cn) - a.h * a.px_m / 2, 0);
      if (dd < bd) { bd = dd; best = a; }
    }
    const want = best && bd < 1500 && cam.y < 2500 ? best : null;
    if (want && !want.tex && !want.loading) {
      want.loading = true;
      const im = new Image();
      im.onload = () => {
        const tex = new THREE.Texture(im); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
        tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
        want.tex = tex;
      };
      im.onerror = () => { want.loading = false; };
      im.src = base + want.file;
    }
    if (want && want.tex) {
      detailNode.value = want.tex;
      dU.x0.value = want.x0; dU.y1.value = want.y1; dU.w.value = want.w * want.px_m; dU.h.value = want.h * want.px_m;
      dU.on.value = Math.min(1, dU.on.value + 0.05);
    } else dU.on.value = 0;
  }
  // the patch under a camera position, loaded before the first frame (a still, or the arrival)
  function prepare(cam) {
    detailUpdate(cam);
    const a = areas.find(a => a.loading && !a.tex);
    if (!a) return Promise.resolve();
    return new Promise(res => { const t0 = performance.now(); const tick = () => (a.tex || performance.now() - t0 > 20000) ? res() : setTimeout(tick, 50); tick(); })
      .then(() => { dU.on.value = 0.95; detailUpdate(cam); });
  }
  const detailBlend = (x, z, alb) => {
    const du = vec2(x.sub(dU.x0).div(dU.w), z.add(dU.y1).div(dU.h));
    const edge = min(min(du.x, float(1).sub(du.x)), min(du.y, float(1).sub(du.y)));
    const k = smoothstep(0.0, 0.12, edge).mul(dU.on);
    return mix(alb, detailNode.sample(du).rgb, k);
  };

  // ---- the season's snow (alpine_snow.py: the latest clear Sentinel-2 passes): laid over the summer mosaic from winter
  // into early summer, by the clock's month (snowSeason, set in update)
  const snowS = d.scene.snow;
  let snowTex = null;
  if (d.snowImg && snowS) {
    snowTex = new THREE.Texture(d.snowImg); snowTex.colorSpace = THREE.NoColorSpace; snowTex.flipY = false;
    snowTex.magFilter = snowTex.minFilter = THREE.LinearFilter; snowTex.generateMipmaps = false; snowTex.needsUpdate = true;
  }
  const snowSeason = uniform(0);
  const SEASON = [0, 0, 0, 0.3, 0.7, 1, 1, 1, 1, 1, 1, 0.5];      // Jan..Dec: the spring snow holds from June to November
  const seasonSnow = (x, z) => {
    if (!snowTex) return float(0);
    const v = texture(snowTex, vec2(x.sub(t.x0).div(snowS.w * snowS.px_m), z.add(t.y1).div(snowS.h * snowS.px_m))).level(0).r;
    // 255 is no reading (cloud): the summer colour stays
    return select(v.greaterThan(0.995), float(0), v.mul(255 / 254)).mul(snowSeason);
  };

  // ---- the material, one per ground strip
  const time = env.u.time;
  function makeMat(strip, detailNormal) {
    const mat = new THREE.MeshBasicNodeMaterial();
    const v0 = strip.row0 / g.h, vs = strip.rows / g.h;
    const gUV = (x, z) => vec2(x.sub(t.x0).div(g.w * g.px_m), z.add(t.y1).div(g.h * g.px_m).sub(v0).div(vs));
    mat.colorNode = Fn(() => {
      const P = positionWorld, x = P.x, z = P.z;
      const dist = length(P.sub(cameraPosition));
      const near = float(1).sub(smoothstep(60, 900, dist));
      const cls = coverAt(x, z);
      let alb = texture(strip.tex, gUV(x, z)).rgb.toVar();
      alb.assign(detailBlend(x, z, alb));
      // the imagery's own colour noise at 10 m, broken up below the pixel
      const n1 = mx_noise_float(vec3(x.mul(0.31), 0, z.mul(0.31))), n2 = mx_noise_float(vec3(x.mul(1.9), 0.5, z.mul(1.9)));
      const isSnow = cls.equal(2).or(cls.equal(3).and(alb.g.greaterThan(0.45)));
      const rock = cls.equal(4).or(cls.equal(5)).or(cls.equal(3)).or(cls.equal(6));
      const tuss = cls.equal(7).or(cls.equal(8));
      // tussock: straw and green-grey clumps; rock and scree: stones lighter and darker; snow: faint blue in the hollows
      const grain = select(tuss, n2.mul(0.22).add(n1.mul(0.12)), select(rock, n2.mul(0.28).add(n1.mul(0.1)), n2.mul(0.06)));
      alb.assign(alb.mul(float(1).add(grain.mul(near))));
      alb.assign(select(tuss, mix(alb, alb.mul(vec3(1.08, 1.0, 0.82)), smoothstep(0.1, 0.6, n1).mul(near).mul(0.5)), alb));
      // within a few tens of metres: the grass between the clumps, short blades and the dark gaps at their feet
      const close = float(1).sub(smoothstep(8, 45, dist));
      const blades = mx_noise_float(vec3(x.mul(7.0), 0.3, z.mul(2.2))).mul(0.5).add(mx_noise_float(vec3(x.mul(2.4), 1.7, z.mul(8.0))).mul(0.5));
      const grassy = tuss.or(cls.equal(11)).or(cls.equal(12)).or(cls.equal(9));
      alb.assign(select(grassy, alb.mul(float(1).add(blades.mul(0.35).mul(close))), alb));
      // the imagery's snow is a little grey from the 10 m mix of snow and rock; fresh snow is near white
      alb.assign(select(isSnow, mix(alb, vec3(0.86, 0.89, 0.93), 0.35), alb));
      // the season's snow over the summer ground, thinning to tussock and rock showing through at its edge
      const ss = seasonSnow(x, z);
      const patchy = smoothstep(0.25, 0.75, ss.add(n1.mul(0.25)));
      alb.assign(mix(alb, vec3(0.84, 0.87, 0.92), patchy));
      const N = detailNormal ? detailNormal(cls, near) : normalize(normalWorld);
      // glints in the snow: facets catching the sun, a few per square metre, only close up
      const sp = select(isSnow.or(patchy.greaterThan(0.5)), float(1), select(cls.equal(15).or(cls.equal(6)), float(0.35), float(0)));
      let c = light.shade(alb, N, P, { spec: sp }).toVar();
      const glint = smoothstep(0.86, 0.98, mx_noise_float(vec3(x.mul(9), P.y.mul(9), z.mul(9)).add(cameraPosition.mul(0.35)))).mul(isSnow.select(1, 0)).mul(float(1).sub(smoothstep(8, 60, dist)));
      c.addAssign(vec3(lightU.sunE).mul(glint.mul(0.6).mul(light.sunVis(P))));
      return c;
    })();
    return mat;
  }
  // the detail normal: the grid's normal bent by the relief's gradient (the same fbm as the patch), near the camera
  const relief = (x, z) => fbmT(x, z).mul(reliefAmp(x, z));
  const bumped = (cls, near) => {
    const P = positionWorld, e = 0.6;
    const gx = relief(P.x.add(e), P.z).sub(relief(P.x.sub(e), P.z)).div(2 * e);
    const gz = relief(P.x, P.z.add(e)).sub(relief(P.x, P.z.sub(e))).div(2 * e);
    // fine grain on top, strongest in rock and scree
    const fine = vec3(mx_noise_float(vec3(P.x.mul(2.2), P.y.mul(2.2), P.z.mul(2.2))), 0, mx_noise_float(vec3(P.z.mul(2.2), P.x.mul(2.2), P.y.mul(2.2) .add(7)))).mul(0.18);
    return normalize(normalize(normalWorld).sub(vec3(gx, 0, gz).add(fine).mul(near)));
  };
  const mats = strips.map(s => makeMat(s, bumped));

  // ---- chunks (as world.js), each with its strip's material
  const stripOf = cy => { const row = (cy + 0.5) * CHUNK * t.cell_m / g.px_m; return strips.findIndex(s => row >= s.row0 && row < s.row0 + s.rows); };
  const hs = d.heights;
  const at = (i, j) => hs[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  function chunkGeometry(cx, cy, stride) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const nx = Math.min(CHUNK, W - 1 - x0), ny = Math.min(CHUNK, H - 1 - y0);
    const sx = Math.max(1, Math.ceil(nx / stride)), sy = Math.max(1, Math.ceil(ny / stride));
    const pos = [], nor = [], idx = [];
    const vert = (i, j, drop) => {
      const h = at(i, j), x = t.x0 + (i + 0.5) * t.cell_m, north = t.y1 - (j + 0.5) * t.cell_m;
      pos.push(x, h - drop, -north);
      const hx = (at(i + 1, j) - at(i - 1, j)) / (2 * t.cell_m), hy = (at(i, j + 1) - at(i, j - 1)) / (2 * t.cell_m);
      const n = new THREE.Vector3(-hx, 1, hy).normalize();
      nor.push(n.x, n.y, n.z);
    };
    const cols = sx + 1;
    for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) vert(x0 + Math.min(nx, i * stride), y0 + Math.min(ny, j * stride), 0);
    for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const a = j * cols + i, b = a + 1, c = a + cols, e = c + 1; idx.push(a, c, b, b, c, e); }
    const edge = [];
    for (let i = 0; i <= sx; i++) { edge.push([i, 0]); edge.push([i, sy]); }
    for (let j = 1; j < sy; j++) { edge.push([0, j]); edge.push([sx, j]); }
    const drop = 12 * stride, skirt = new Map();
    for (const [i, j] of edge) { skirt.set(j * cols + i, pos.length / 3); vert(x0 + Math.min(nx, i * stride), y0 + Math.min(ny, j * stride), drop); }
    const quad = (p, q) => { const sp = skirt.get(p), sq = skirt.get(q); if (sp === undefined || sq === undefined) return; idx.push(p, sp, q, q, sp, sq); idx.push(p, q, sp, q, sq, sp); };
    for (let i = 0; i < sx; i++) { quad(i, i + 1); quad(sy * cols + i, sy * cols + i + 1); }
    for (let j = 0; j < sy; j++) { quad(j * cols, (j + 1) * cols); quad(j * cols + sx, (j + 1) * cols + sx); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    return geo;
  }
  const group = new THREE.Group();
  const cw = Math.ceil((W - 1) / CHUNK), ch = Math.ceil((H - 1) / CHUNK);
  const chunks = [], geoCache = new Map();
  const getGeo = (cx, cy, lod) => { const k = (cy * cw + cx) * 4 + lod; if (!geoCache.has(k)) geoCache.set(k, chunkGeometry(cx, cy, [1, 2, 4, 8][lod])); return geoCache.get(k); };
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const m = new THREE.Mesh(getGeo(cx, cy, 3), mats[Math.max(0, stripOf(cy))]);
    m.userData = { cx, cy, lod: 3, centre: new THREE.Vector3(t.x0 + (cx + 0.5) * CHUNK * t.cell_m, 0, -(t.y1 - (cy + 0.5) * CHUNK * t.cell_m)) };
    group.add(m); chunks.push(m);
  }
  const RANGE = [1400, 3800, 9000];
  const B = 4, FAR = RANGE[1] + 600, blocks = [];
  for (let by = 0; by < ch; by += B) for (let bx = 0; bx < cw; bx += B) {
    const members = chunks.filter(m => m.userData.cx >= bx && m.userData.cx < bx + B && m.userData.cy >= by && m.userData.cy < by + B);
    const geo = mergeGeometries(members.map(m => getGeo(m.userData.cx, m.userData.cy, 3)), false);
    const bm = new THREE.Mesh(geo, members[0].material); bm.visible = false;
    const x0 = t.x0 + bx * CHUNK * t.cell_m, x1 = t.x0 + Math.min(cw, bx + B) * CHUNK * t.cell_m;
    const z0 = -(t.y1 - by * CHUNK * t.cell_m), z1 = -(t.y1 - Math.min(ch, by + B) * CHUNK * t.cell_m);
    bm.userData.box = [Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)];
    group.add(bm); blocks.push({ mesh: bm, members, far: null });
  }

  // ---- the detail patch around the camera
  const centre = uniform(new THREE.Vector2());
  const cr = f => [f.mul(f).mul(f).mul(-0.5).add(f.mul(f)).sub(f.mul(0.5)), f.mul(f).mul(f).mul(1.5).sub(f.mul(f).mul(2.5)).add(1),
    f.mul(f).mul(f).mul(-1.5).add(f.mul(f).mul(2)).add(f.mul(0.5)), f.mul(f).mul(f).mul(0.5).sub(f.mul(f).mul(0.5))];
  const bicubic = (wx, wz) => {
    const gx = wx.sub(t.x0).div(t.cell_m).sub(0.5), gy = wz.add(t.y1).div(t.cell_m).sub(0.5);
    const ix = floor(gx), iy = floor(gy), wxs = cr(gx.sub(ix)), wys = cr(gy.sub(iy));
    let h = float(0);
    for (let j = 0; j < 4; j++) {
      let row = float(0);
      for (let i = 0; i < 4; i++) row = row.add(texture(heightTex, vec2(ix.add(i - 1 + 0.5).div(W), iy.add(j - 1 + 0.5).div(H))).level(0).r.mul(wxs[i]));
      h = h.add(row.mul(wys[j]));
    }
    return h;
  };
  const bilinear = (wx, wz) => texture(heightTex, vec2(wx.sub(t.x0).div(W * t.cell_m), wz.add(t.y1).div(H * t.cell_m))).level(0).r;
  const detailHeight = (wx, wz) => bicubic(wx, wz).add(relief(wx, wz));
  const geo = new THREE.PlaneGeometry(2 * HALF, 2 * HALF, CELLS, CELLS).rotateX(-Math.PI / 2);
  const snapped = Fn(() => vec2(positionLocal.x, positionLocal.z).add(centre));
  // the patch's normal from differences of its own height, carried to the fragment, with fine grain on top
  const e = 1.0;
  const pN = Fn(() => {
    const p = snapped();
    const dx = detailHeight(p.x.add(e), p.y).sub(detailHeight(p.x.sub(e), p.y)).div(2 * e);
    const dz = detailHeight(p.x, p.y.add(e)).sub(detailHeight(p.x, p.y.sub(e))).div(2 * e);
    return normalize(vec3(dx.negate(), 1, dz.negate()));
  });
  const vN = varying(pN(), 'vAlpPatchN');
  const patchNormal = () => {
    const P = positionWorld;
    const fine = vec3(mx_noise_float(vec3(P.x.mul(2.2), P.y.mul(2.2), P.z.mul(2.2))), 0, mx_noise_float(vec3(P.z.mul(2.2), P.x.mul(2.2), P.y.mul(2.2).add(7)))).mul(0.16);
    return normalize(normalize(vN).sub(fine));
  };
  const patchMats = strips.map(s => {
    const m = makeMat(s, patchNormal);
    m.positionNode = Fn(() => {
      const p = snapped();
      const rim = max(abs(positionLocal.x), abs(positionLocal.z)).div(HALF);
      const k = smoothstep(0.8, 1.0, rim);
      return vec3(p.x, mix(detailHeight(p.x, p.y), bilinear(p.x, p.y), k).sub(k.mul(k).mul(0.15)), p.y);
    })();
    return m;
  });
  // one patch mesh per strip; only the one under the camera is shown (a patch never spans two strips by more than its rim)
  const patches = patchMats.map(m => { const p = new THREE.Mesh(geo, m); p.frustumCulled = false; p.visible = false; group.add(p); return p; });
  // the coarse chunks are cut away under the patch
  for (const m of mats) {
    m.opacityNode = Fn(() => {
      const dx = abs(positionWorld.x.sub(centre.x)), dz = abs(positionWorld.z.sub(centre.y));
      return select(max(dx, dz).lessThan(HALF * 0.985), float(0), float(1));
    })();
    m.alphaTest = 0.5;
  }

  // ---- CPU twin of the patch's surface
  const ampAt = (x, north) => {
    const fx = (x - t.x0) / cv.px_m - 0.5, fz = (t.y1 - north) / cv.px_m - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz;
    const a = (i, j) => { const ii = Math.min(cv.w - 1, Math.max(0, i)), jj = Math.min(cv.h - 1, Math.max(0, j)); return Math.round(relAmp[d.habitat[jj * cv.w + ii]] / 1.5 * 255) / 255 * 1.5; };
    return (a(ix, iz) * (1 - ax) + a(ix + 1, iz) * ax) * (1 - az) + (a(ix, iz + 1) * (1 - ax) + a(ix + 1, iz + 1) * ax) * az;
  };
  const crJS = f => [-0.5 * f ** 3 + f * f - 0.5 * f, 1.5 * f ** 3 - 2.5 * f * f + 1, -1.5 * f ** 3 + 2 * f * f + 0.5 * f, 0.5 * f ** 3 - 0.5 * f * f];
  function bicubicJS(x, north) {
    const gx = (x - t.x0) / t.cell_m - 0.5, gy = (t.y1 - north) / t.cell_m - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), wx = crJS(gx - ix), wy = crJS(gy - iy);
    let h = 0;
    for (let j = 0; j < 4; j++) { let r = 0; for (let i = 0; i < 4; i++) r += at(ix + i - 1, iy + j - 1) * wx[i]; h += r * wy[j]; }
    return h;
  }
  const heightAt = (x, north) => bicubicJS(x, north) + fbmJS(x, -north) * ampAt(x, north);

  let monthSeen = -1;
  function update(cam) {
    detailUpdate(cam);
    const m = new Date((ctx_clock ? ctx_clock() : Date.now()) + 12 * 3600e3).getUTCMonth();   // New Zealand's month, near enough
    if (m !== monthSeen) { monthSeen = m; snowSeason.value = SEASON[m]; }
    centre.value.set(Math.round(cam.x / 8) * 8, Math.round(cam.z / 8) * 8);
    const si = Math.max(0, strips.findIndex(s => { const row = (cam.z + t.y1) / g.px_m; return row >= s.row0 && row < s.row0 + s.rows; }));
    // high above the land the patch is not worth drawing
    const show = cam.y - heightAt(cam.x, -cam.z) < 600;
    patches.forEach((p, i) => { p.visible = show && i === si; });
    for (const b of blocks) {
      const [x0, x1, z0, z1] = b.mesh.userData.box;
      const far = Math.hypot(cam.x - Math.min(Math.max(cam.x, x0), x1), cam.z - Math.min(Math.max(cam.z, z0), z1)) > FAR;
      if (far !== b.far) { b.far = far; b.mesh.visible = far; for (const m of b.members) m.visible = !far; }
      if (far) continue;
      for (const m of b.members) {
        const c = m.userData.centre, dd = Math.hypot(cam.x - c.x, cam.z - c.z);
        const lod = dd < RANGE[0] ? 0 : dd < RANGE[1] ? 1 : dd < RANGE[2] ? 2 : 3;
        if (lod !== m.userData.lod) { m.userData.lod = lod; m.geometry = getGeo(m.userData.cx, m.userData.cy, lod); }
      }
    }
  }
  return { group, update, prepare, material: mats[0], materials: mats, heightAt, coverAt, coverTex };
}
