// The land of an alpine site: the LiDAR grid as chunked, level-of-detail meshes under the satellite colour,
// shaded by light.js (the sun through the air, the mountains' shadows, the sky), with detail the 30 m grid and the
// 10 m imagery cannot hold added by land cover (build_alpine.py COVER): grain and glints in the snow, strata and
// fractures in rock, stones in scree and riverbeds, hummocks in the tussock. Around the camera a finer patch
// (2 m cells) rides on a bicubic read of the grid plus relief by cover; its CPU twin (heightAt) is what the
// player and the people stand on.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, If, uniform, float, int, vec2, vec3, vec4, mix, max, min, abs, floor, fract, smoothstep, clamp, texture, select,
  positionWorld, positionLocal, normalWorld, cameraPosition, length, normalize, dot, sin, varying, mx_noise_float, mx_noise_vec3, exp, pow, fwidth } from 'three/tsl';
import { CHUNK } from '../world.js';
import { createRoadField, DASH_ON, DASH } from './roadfield.js';

const HALF = 240, CELLS = 240;          // the detail patch: 480 m square, 2 m cells
const ALB_KNEE = 1.1;
const GREEN_VIBRANCE = 1.4;              // how much deeper green grass is drawn than the photographs give it                    // imagery -> albedo: a linear 0.45 becomes 0.30, 0.1 stays 0.09

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
// a cheap cellular noise for the bush's crowns: the nearest of the feature points in the 2 x 2 x 2 cells round p (one
// point a cell, jittered within 0.7 of it), as Gustavson's cellular2x2x2. Returns vec4(F1, the unit direction from that
// point to p): the direction is the crown's own slope, so its sunlit side needs no second evaluation. Eight cells where
// MaterialX's worley searches 27, and one call where the crowns took four (a fortieth of the work)
const hash3 = c => {
  const m = mod289(c);
  return fract(sin(vec3(dot(m, vec3(127.1, 311.7, 74.7)), dot(m, vec3(269.5, 183.3, 246.1)), dot(m, vec3(113.5, 271.9, 124.6)))).mul(43758.5453));
};
const cell2 = p => {
  const b = floor(p.sub(0.5));
  let best = null;
  for (let k = 0; k < 8; k++) {
    const c = b.add(vec3(k & 1, (k >> 1) & 1, k >> 2));
    const d = p.sub(c.add(hash3(c).sub(0.5).mul(0.7)).add(0.5));
    const dd = dot(d, d);
    best = best ? { dd: min(best.dd, dd), d: select(dd.lessThan(best.dd), d, best.d) } : { dd, d };
  }
  const f1 = best.dd.max(1e-8).sqrt();
  return vec4(f1, best.d.div(f1));
};

export function createAlpineTerrain(d, env, renderer, light, heightTex, ctx_clock = null, { range = 1 } = {}) {
  const t = d.scene.terrain, g = d.scene.ground, W = t.w, H = t.h;
  const lightU = light.u;
  // the sealed roads round the eye (roadfield.js): painted into the ground, with the relief laid flat under them
  const roads = createRoadField(d.base || '');
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

  // the share of snow and ice (class 2), blended over the four nearest cover pixels: a hard test on the nearest pixel drew
  // the summits' snow, and the brightness kept for it, in 20 m squares
  const snowClsTex = new THREE.DataTexture(new Uint8Array(16).map((_, k) => (k === 2 ? 255 : 0)), 16, 1, THREE.RedFormat, THREE.UnsignedByteType);
  snowClsTex.magFilter = snowClsTex.minFilter = THREE.NearestFilter; snowClsTex.needsUpdate = true;
  const snowShare = (x, z) => {
    const fx = x.sub(t.x0).div(cv.px_m).sub(0.5), fz = z.add(t.y1).div(cv.px_m).sub(0.5);
    const ix = floor(fx), iz = floor(fz), ax = fx.sub(ix), az = fz.sub(iz);
    const at = (i, j) => texture(snowClsTex, vec2(texture(coverTex, vec2(ix.add(i + 0.5).div(cv.w), iz.add(j + 0.5).div(cv.h))).level(0).r.mul(255).add(0.5).floor().add(0.5).div(16), 0.5)).level(0).r;
    return mix(mix(at(0, 0), at(1, 0), ax), mix(at(0, 1), at(1, 1), ax), az);
  };

  // the shares of the ground looks the colour steers, blended over the four nearest cover pixels like the relief (a
  // class edge is then a 20 m fade, not a square step): r tussock, g rock and scree, b grass of any kind, a gravel and shore
  const LOOK = { 7: [1, 0, 1, 0], 8: [1, 0, 1, 0], 9: [0, 0, 0.6, 0], 11: [0, 0, 1, 0], 12: [0, 0, 0.8, 0],
    3: [0, 1, 0, 0], 4: [0, 1, 0, 0], 5: [0, 1, 0, 0], 6: [0, 0.6, 0, 1], 15: [0, 0.3, 0, 1] };
  const lookTex = new THREE.DataTexture(new Uint8Array(64).map((_, i) => Math.round(((LOOK[i >> 2] || [0, 0, 0, 0])[i & 3]) * 255)), 16, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  lookTex.magFilter = lookTex.minFilter = THREE.NearestFilter; lookTex.needsUpdate = true;
  const lookAt = (x, z) => {
    const fx = x.sub(t.x0).div(cv.px_m).sub(0.5), fz = z.add(t.y1).div(cv.px_m).sub(0.5);
    const ix = floor(fx), iz = floor(fz), ax = fx.sub(ix), az = fz.sub(iz);
    const at = (i, j) => texture(lookTex, vec2(texture(coverTex, vec2(ix.add(i + 0.5).div(cv.w), iz.add(j + 0.5).div(cv.h))).level(0).r.mul(255).add(0.5).floor().add(0.5).div(16), 0.5)).level(0);
    return mix(mix(at(0, 0), at(1, 0), ax), mix(at(0, 1), at(1, 1), ax), az);
  };

  // ---- a fiord's walls (scene.biome "fiordland"): rainforest and wet rock, which a 10 m photograph taken from above
  // cannot show on ground that stands near the vertical. The shares by cover, blended like the looks above:
  // r bush (forest), g scrub, b bare rock and scree
  const FIORD = d.scene.biome === 'fiordland';
  const LOOK2 = { 10: [1, 0, 0, 0], 9: [0.25, 1, 0, 0], 12: [0, 0.6, 0, 0], 4: [0, 0, 1, 0], 5: [0, 0, 1, 0], 3: [0, 0, 1, 0] };
  const look2Tex = new THREE.DataTexture(new Uint8Array(64).map((_, i) => Math.round(((LOOK2[i >> 2] || [0, 0, 0, 0])[i & 3]) * 255)), 16, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  look2Tex.magFilter = look2Tex.minFilter = THREE.NearestFilter; look2Tex.needsUpdate = true;
  const look2At = (x, z) => {
    const fx = x.sub(t.x0).div(cv.px_m).sub(0.5), fz = z.add(t.y1).div(cv.px_m).sub(0.5);
    const ix = floor(fx), iz = floor(fz), ax = fx.sub(ix), az = fz.sub(iz);
    const at = (i, j) => texture(look2Tex, vec2(texture(coverTex, vec2(ix.add(i + 0.5).div(cv.w), iz.add(j + 0.5).div(cv.h))).level(0).r.mul(255).add(0.5).floor().add(0.5).div(16), 0.5)).level(0);
    return mix(mix(at(0, 0), at(1, 0), ax), mix(at(0, 1), at(1, 1), ax), az);
  };
  const rataSeason = uniform(0);                                  // southern rata in flower: December to February
  const RATA = [1, 0.8, 0.15, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.7];
  // returns { alb, rockW }: the ground's colour with the bush canopy and the rock laid in
  const fiordLook = (alb0, P, dist, snowK) => {
    const x = P.x, y = P.y, z = P.z, Ng = normalize(normalWorld);
    const l2 = look2At(x, z);
    const land = float(1).sub(snowK).mul(smoothstep(0.2, 1.5, y));          // not the snow, not the bed under the water
    const steep = smoothstep(0.68, 0.36, Ng.y);                    // 47 to 69 degrees: bush clings to anything less
    // the land cover's "rock and cliff" on a fiord's walls is mostly bush in fact: silver beech, ferns and moss hold on to
    // faces near the vertical, with bare rock in the strips tree avalanches leave and in the cracks between; the bare
    // faces are wide only above the bushline. Below it the class is drawn as bush with those strips, long down the wall
    // (drawn as rock in full, it covered whole walls in a pale grey, brighter than the bush beside it by several times)
    const hi = smoothstep(750, 1250, y.add(mx_noise_float(P.div(300)).mul(150)));
    const strip = smoothstep(0.22, 0.55, mx_noise_float(vec3(x.div(30), y.div(360), z.div(30)).add(11)));
    const rockC = l2.b.mul(mix(strip.mul(0.9), float(1), hi));
    const veg = l2.r.add(l2.g).add(l2.b.sub(rockC)).min(1);
    // bare faces break the bush where the wall is steepest: slips and slabs, long down the wall and narrow across it (tree
    // avalanches strip a fiord's walls in strips from the top; round patches 300 m across read as pale blotches)
    // (steepness opens them but does not make them: at 0.9 of the test it alone stripped every face past 69 degrees)
    const bare = smoothstep(0.55, 0.9, steep.mul(0.45).add(mx_noise_float(vec3(x.div(70), y.div(420), z.div(70))).mul(0.6)));
    // ---- rock: Fiordland's gneiss and granite, dark grey with a warm cast where it is dry; beds a few metres thick
    // dipping across the face, flutes worn down it by water, dark seeps, and bush on the ledges the beds make
    const ledge = smoothstep(0.32, 0.5, mx_noise_float(vec3(x, y.mul(1.6), z).div(210).add(9))).mul(float(1).sub(smoothstep(700, 1200, y)));
    const bushW = veg.mul(float(1).sub(bare.mul(0.9))).add(ledge.mul(0.75).mul(float(1).sub(veg.mul(float(1).sub(bare))))).min(1).mul(land);
    const rockW = rockC.add(veg.mul(bare).mul(0.9)).add(steep.mul(float(1).sub(veg)).mul(0.8)).min(1).mul(float(1).sub(ledge.mul(0.75))).mul(land);
    // (the rock's colour and relief only where there is rock, the bush's only where there is bush: branches on the two
    // weights, so a fragment pays for what it shows; nearly all of a wall is one or the other)
    const alb = alb0.toVar(), seep = float(0).toVar(), bend = vec3(0).toVar(), ao = float(1).toVar();
    If(rockW.greaterThan(0.002), () => {
      const sAx = dot(P, vec3(0.24, 0.96, 0.14));
      const bed = mx_noise_float(vec3(sAx.mul(0.045), x.mul(0.003), z.mul(0.003)));
      const tone = mx_noise_float(P.div(120)).mul(0.5).add(0.5);
      // (wet most days of the year, streaked with water and moss: a darker grey than the dry rock of the lakes; at 0.15 to
      // 0.24 the faces came out a pale lilac grey under the sky's light and the haze, brighter than the bush round them by four)
      const rock = mix(vec3(0.06, 0.062, 0.057), vec3(0.115, 0.11, 0.1), tone).toVar();
      rock.assign(mix(rock, rock.mul(vec3(0.86, 1.02, 0.78)), smoothstep(-0.2, 0.5, mx_noise_float(vec3(x.div(40), y.div(160), z.div(40)).add(5))).mul(0.6)));
      rock.mulAssign(float(1).add(bed.mul(0.1)));
      const flute = mx_noise_float(vec3(x.mul(0.09), y.mul(0.007), z.mul(0.09))).mul(0.6).add(mx_noise_float(vec3(x.mul(0.33), y.mul(0.02), z.mul(0.33))).mul(0.4));
      rock.mulAssign(float(1).add(flute.mul(0.07).mul(steep.mul(0.7).add(0.3))));
      seep.assign(smoothstep(0.2, 0.7, mx_noise_float(vec3(x.mul(0.05), y.mul(0.004), z.mul(0.05)).add(40))).mul(steep));
      rock.mulAssign(float(1).sub(seep.mul(0.3)));
      alb.assign(mix(alb0, mix(rock, alb0, 0.06), rockW));
      // the rock's own relief, for the light: buttresses, slabs and cracks as a bent normal, the shade in the cracks
      // (ribs: the wall's buttresses and chutes run down it, so the bend is sideways only and long in the vertical)
      const rib = mx_noise_vec3(vec3(x, y.mul(0.12), z).div(130));
      bend.assign(vec3(rib.x, 0, rib.z).mul(0.3));
      // (clean rock: no fine mottling, which reads as dirt)
      ao.assign(mix(float(1), mix(float(0.9), float(1.03), smoothstep(-0.4, 0.4, rib.y)), rockW));
    });
    // ---- bush: silver beech and podocarp canopy as domed crowns about 9 m across (a cell pattern in the wall's own
    // space, so a crown is round on a cliff too), each lit on its sunward side and dark in the gaps between
    const pc0 = vec3(x, y.mul(0.8), z).div(8.5);
    // (toVar: emitted here, in uniform control flow, not at its first use inside the branches below, where WGSL refuses a
    // derivative)
    const crownK = float(1).sub(smoothstep(0.25, 0.75, fwidth(pc0.x).max(fwidth(pc0.z)).max(fwidth(pc0.y)))).toVar();
    If(bushW.greaterThan(0.002), () => {
      // (the crowns, the warp under them and the boughs only where a crown is bigger than a pixel)
      const dome = float(0.5).toVar(), sunny = float(0.55).toVar(), bough = float(0).toVar();
      If(crownK.greaterThan(0.002), () => {
        const pc = pc0.add(mx_noise_vec3(P.div(6.5)).mul(0.3));
        // (two sizes of crown, the small ones breaking the big: a canopy of one size reads as a quilt of balls)
        const c1 = cell2(pc), c2 = cell2(pc.mul(2.3).add(17));
        const w0 = c1.x.mul(0.62).add(c2.x.mul(0.38));
        dome.assign(float(1).sub(smoothstep(0.1, 0.8, w0)));
        // the sunlit side: how much the dome falls toward the sun over a fifth of a crown (its slope from the two cells'
        // directions and the smoothstep's own slope), as the difference of two domes a step apart gave it
        const tS = clamp(w0.sub(0.1).div(0.7), 0, 1), dS = tS.mul(float(1).sub(tS)).mul(6 / 0.7);
        const sd = vec3(lightU.sunDir);
        const fall = dS.mul(0.2).mul(dot(c1.yzw, sd).mul(0.62).add(dot(c2.yzw, sd).mul(0.38 * 2.3)));
        sunny.assign(clamp(fall.mul(1.7).add(0.55), 0, 1));
        // near the eye a crown breaks into boughs and sprays of leaf (two finer octaves), so it is not one smooth dome
        If(dist.lessThan(900), () => {
          bough.assign(mx_noise_float(P.div(2.3)).mul(0.5).add(mx_noise_float(P.div(0.8).add(3)).mul(0.5).mul(float(1).sub(smoothstep(60, 300, dist)))).mul(float(1).sub(smoothstep(250, 900, dist))));
        });
      });
      const kind = mx_noise_float(P.div(38)).mul(0.5).add(0.5), kind2 = mx_noise_float(P.div(13).add(31)).mul(0.5).add(0.5);
      const bush = mix(vec3(0.036, 0.068, 0.026), vec3(0.085, 0.135, 0.04), kind.mul(0.7).add(kind2.mul(0.3))).toVar();
      bush.assign(mix(bush, alb0.mul(1.15), 0.4));
      // tree ferns and broadleaf at the water's edge and in the gullies: a fresher green low down
      bush.assign(mix(bush, bush.mul(vec3(0.95, 1.22, 0.8)), float(1).sub(smoothstep(20, 260, y)).mul(kind2)));
      const crown = mix(float(0.42), float(1.12), dome).mul(mix(float(0.5), float(1.2), sunny)).mul(float(1).add(bough.mul(0.42)));
      // (beech and podocarp are a dark, olive green in full sun: the photograph's lawn-green is pulled down)
      bush.assign(mix(vec3(dot(bush, vec3(0.2126, 0.7152, 0.0722))), bush, 0.82).mul(0.8));
      bush.mulAssign(mix(float(1), crown, crownK));
      // southern rata in flower, in its season, below 800 m
      If(rataSeason.greaterThan(0).and(y.lessThan(800)), () => {
        const rata = smoothstep(0.6, 0.68, mx_noise_float(P.div(10).add(20))).mul(smoothstep(-0.1, 0.25, mx_noise_float(P.div(260).add(3)))).mul(float(1).sub(smoothstep(500, 800, y))).mul(rataSeason);
        bush.assign(mix(bush, vec3(0.2, 0.018, 0.02).mul(mix(float(0.7), float(1.25), dome)), rata.mul(0.85).mul(mix(float(0.6), dome, crownK))));
      });
      alb.assign(mix(alb, bush, bushW));
    });
    // the wet shine of the faces water runs down
    const wet = rockW.mul(seep.mul(0.8).add(0.2));
    return { alb, rockW, bushW, bend, ao, wet };
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
  async function prepare(cam) {
    detailUpdate(cam);
    await roads.ready; roads.update(cam);
    const a = areas.find(a => a.loading && !a.tex);
    if (!a) return;
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
  const wx = { fresh: uniform(0), line: uniform(1e5), wet: uniform(0) };    // the weather's snow and wet (../weather.js sets them)
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
      const snowK = max(snowShare(x, z), select(cls.equal(3).and(alb.g.greaterThan(0.45)), float(1), float(0)));
      // the photographs are printed for a screen, their pale ground stretched toward white: dry tussock and gravel come
      // out near 0.45 where the ground reflects 0.25 to 0.3. Brightness is eased toward that (hue kept; snow is set below)
      const lum0 = dot(alb, vec3(0.2126, 0.7152, 0.0722));
      alb.assign(mix(alb.mul(float(1).div(lum0.mul(ALB_KNEE).add(1))), alb, snowK));
      // the sealed roads: chipseal, its painted lines and a gravel shoulder, within the road field's window (about 250 m)
      const rf = roads.sample(x, z);
      const ruv = vec2(x.sub(roads.origin.x), z.negate().sub(roads.origin.y)).div(roads.span);
      const inWin = smoothstep(0.0, 0.01, ruv.x).mul(smoothstep(1.0, 0.99, ruv.x)).mul(smoothstep(0.0, 0.01, ruv.y)).mul(smoothstep(1.0, 0.99, ruv.y));
      const rKind = floor(rf.a.div(16).add(1e-3)), rHw = rf.a.sub(rKind.mul(16)), rd = abs(rf.r), raa = fwidth(rf.r).max(0.004);
      const rOn = select(rKind.greaterThan(0.5), float(1), float(0)).mul(inWin).mul(roads.valid(x, z, rf.r)).mul(float(1).sub(smoothstep(190, 240, length(P.xz.sub(cameraPosition.xz)))));
      const seal = float(1).sub(smoothstep(rHw.sub(raa), rHw.add(raa).add(0.12), rd)).mul(rOn).toVar();
      const shoulder = float(1).sub(smoothstep(rHw.add(0.3), rHw.add(1.1), rd)).mul(rOn).sub(seal).max(0);
      // (a branch: only the fragments on or beside a road within the window pay for the chipseal and its lines; the fades
      // by derivative are taken before it, since a derivative needs uniform control flow)
      const fineK = float(1).sub(smoothstep(0.3, 0.9, fwidth(x.mul(30)).max(fwidth(z.mul(30))))).toVar();
      If(rOn.greaterThan(0.001).and(rd.lessThan(rHw.add(1.2))), () => {
        // New Zealand's chipseal: dark grey stones in bitumen, a little darker and smoother in the wheel paths; the
        // grain fades as it shrinks under a pixel
        const chip = mx_noise_float(vec3(x.mul(30), 0.7, z.mul(30))).mul(fineK).mul(0.22).add(mx_noise_float(vec3(x.mul(2.1), 0.2, z.mul(2.1))).mul(0.08));
        const wheel = float(1).sub(smoothstep(0.25, 0.45, abs(rd.sub(0.95)))).add(float(1).sub(smoothstep(0.25, 0.45, abs(rd.sub(2.45))))).min(1);
        // (the greywacke chips weather pale: a sunlit seal photographs a mid grey, near a tenth reflectance; a third of the
        // photograph's own colour is kept, so the seal sits in the aerial patches and the mosaic without a step)
        const photoL = dot(alb, vec3(0.2126, 0.7152, 0.0722));
        const asphalt = mix(vec3(0.105, 0.103, 0.098), vec3(photoL).mul(vec3(1.0, 0.99, 0.95)).min(0.2), 0.33).mul(float(1).add(chip)).mul(float(1).sub(wheel.mul(0.12)));
        alb.assign(mix(alb, mix(alb, vec3(0.2, 0.185, 0.16), 0.55), shoulder));
        alb.assign(mix(alb, asphalt, seal));
        // the lines: white edge lines on a state highway at the lanes' outer edges, a broken centre line on the highway
        // and the secondary roads (a 3 m stripe, a 7 m gap); a worn white paint with glass beads
        const line = (v, c, w) => float(1).sub(smoothstep(raa.negate(), raa, abs(v.sub(c)).sub(w / 2)));
        const lane = select(rKind.lessThan(1.5), float(3.4), float(3.2));
        const edge = line(rd, lane.add(0.05), 0.1).mul(select(rKind.lessThan(1.5), float(1), float(0)));
        const ph = roads.phase(rf);
        const dash = smoothstep(0.0, 0.01, ph).mul(float(1).sub(smoothstep(DASH_ON / DASH - 0.01, DASH_ON / DASH, ph)));
        const centre = line(rf.r, float(0), 0.1).mul(dash).mul(select(rKind.lessThan(2.5), float(1), float(0)));
        const paint = edge.add(centre).min(1).mul(seal).mul(float(0.85).add(mx_noise_float(vec3(x.mul(6), 0.1, z.mul(6))).mul(0.15)));
        alb.assign(mix(alb, vec3(0.62, 0.62, 0.6), paint));
      });
      const offRoad = float(1).sub(seal);
      const look0 = lookAt(x, z), look = look0.mul(offRoad), wTuss = look.r, wRock = look.g, wGrass = look.b;
      // the imagery's own colour noise at 10 m, broken up below the pixel, from a few km in to a few tens of metres;
      // closer than that a 3 m blotch reads as a stain on the ground, so it hands over to the fine grain below
      const n1 = mx_noise_float(vec3(x.mul(0.31), 0, z.mul(0.31)));
      const mid = near.mul(smoothstep(12, 40, dist));
      If(mid.greaterThan(0.001), () => {
        const n2 = mx_noise_float(vec3(x.mul(1.9), 0.5, z.mul(1.9)));
        const grain = n2.mul(mix(float(0.06), float(0.2), max(wTuss, wRock))).add(n1.mul(mix(float(0.0), float(0.11), max(wTuss, wRock))));
        alb.assign(alb.mul(float(1).add(grain.mul(mid))));
        alb.assign(mix(alb, alb.mul(vec3(1.08, 1.0, 0.82)), smoothstep(0.1, 0.6, n1).mul(mid).mul(0.5).mul(wTuss)));
      });
      // close up: the ground's own fine texture, three octaves from 25 cm to 3 cm, each fading as it shrinks under a
      // pixel (no shimmer); mostly darker than the mean (blade shadows, gaps between stones), so the ground keeps its
      // colour and gains depth instead of a pale sheen
      const close = float(1).sub(smoothstep(10, 60, dist));
      const fpx = fwidth(x).max(fwidth(z)).toVar();
      const fade = f => float(1).sub(smoothstep(0.35, 0.9, fpx.mul(f))).toVar();
      const k4 = fade(4.0), k11 = fade(11.0), k29 = fade(29.0), k27 = fade(27.0);
      If(close.greaterThan(0.001), () => {
        const oct = (f, k, kf) => mx_noise_float(vec3(x.mul(f), P.y.mul(f * 0.5).add(k), z.mul(f))).mul(kf);
        const fine = oct(4.0, 0.0, k4).mul(0.5).add(oct(11.0, 3.1, k11).mul(0.32)).add(oct(29.0, 7.7, k29).mul(0.18));
        // grass: thin blade streaks and their dark roots; stones: sharper light and dark
        const blade = mx_noise_float(vec3(x.mul(26.0), 0.3, z.mul(7.0))).mul(0.5).add(mx_noise_float(vec3(x.mul(8.0), 1.7, z.mul(27.0))).mul(0.5)).mul(k27);
        const detail = fine.mul(mix(float(0.34), float(0.5), wRock)).add(blade.mul(0.3).mul(wGrass)).sub(mix(float(0.05), float(0.09), wGrass));
        alb.assign(alb.mul(float(1).add(detail.mul(close))));
      });
      // seen low along the ground, grass hides the soil and shows its blades: richer and a little darker than the
      // straight-down photograph the colour comes from (most at eye level, none from above)
      const Vd = normalize(cameraPosition.sub(P));
      const graze = pow(float(1).sub(abs(dot(normalize(normalWorld), Vd))), 2).mul(wGrass.add(wTuss.mul(0.5)).min(1)).mul(float(1).sub(smoothstep(1500, 4000, dist)));
      const lumA = dot(alb, vec3(0.2126, 0.7152, 0.0722));
      // (the extra colour only for green to straw hues: red-brown scrub on the far slopes went magenta under it)
      const redness = smoothstep(0.0, 0.12, alb.r.sub(alb.g).div(alb.r.max(1e-3)));
      alb.assign(mix(alb, mix(vec3(lumA), alb, mix(float(1.45), float(1.0), redness)).mul(vec3(0.86, 0.9, 0.72)).max(0), graze.mul(0.65)));
      // living grass a summer green: where the ground is green already (green over red), its colour is deepened toward a
      // fresh green, as it is in photographs of the lakes in spring; the straw tussock, gravel and rock keep theirs
      const lumB = dot(alb, vec3(0.2126, 0.7152, 0.0722));
      const greenness = smoothstep(0.02, 0.22, alb.g.sub(alb.r).div(alb.g.max(1e-3))).mul(float(1).sub(snowK));
      // (a vibrance, not a saturation: grey-green ground gains most, a lawn already bright green little, or it glows)
      const satB = alb.g.sub(min(alb.r, alb.b)).div(alb.g.max(1e-3));
      const vib = mix(float(GREEN_VIBRANCE), float(1.05), smoothstep(0.35, 0.75, satB));
      alb.assign(mix(alb, mix(vec3(lumB), alb, vib).mul(mix(vec3(1), vec3(0.9, 1.06, 0.82), float(1).sub(smoothstep(0.35, 0.75, satB)))).max(0), greenness));
      // the imagery's snow is a little grey from the 10 m mix of snow and rock; fresh snow is near white
      alb.assign(mix(alb, vec3(0.86, 0.89, 0.93), snowK.mul(0.35)));
      // the season's snow over the summer ground, thinning to tussock and rock showing through at its edge
      const ss = seasonSnow(x, z);
      const patchy = smoothstep(0.25, 0.75, ss.add(n1.mul(0.25))).toVar();
      // the weather's snow (../weather.js): fresh snow lying down to the snow line, thin at its edge and on the steep
      // faces it slides off; and the ground darker and glossier while it is wet
      If(wx.fresh.greaterThan(0.004).or(wx.wet.greaterThan(0.004)), () => {
        const flat = smoothstep(0.55, 0.85, normalize(normalWorld).y);
        const lie = smoothstep(wx.line.sub(90), wx.line.add(90), P.y.add(n1.mul(60))).mul(smoothstep(0.0, 0.35, wx.fresh)).mul(flat.mul(0.75).add(0.25));
        alb.assign(alb.mul(float(1).sub(wx.wet.mul(0.28).mul(float(1).sub(snowK)))));
        patchy.assign(max(patchy, lie));
      });
      alb.assign(mix(alb, vec3(0.84, 0.87, 0.92), patchy));
      let N = detailNormal ? detailNormal(cls, near) : normalize(normalWorld);
      let fAo = float(1), fWet = float(0);
      if (FIORD) {
        const f = fiordLook(alb, P, dist, max(snowK, smoothstep(0.4, 0.6, patchy)));
        alb.assign(f.alb);
        N = normalize(N.add(f.bend.mul(f.rockW))).toVar();
        // (the canopy's own grain in the light, where a 26 m wobble is still more than a pixel or two)
        If(f.bushW.greaterThan(0.002).and(dist.lessThan(4000)), () => { N.assign(normalize(N.add(mx_noise_vec3(P.div(26)).mul(f.bushW.mul(0.16).mul(float(1).sub(smoothstep(2500, 4000, dist))))))); });
        fAo = f.ao; fWet = f.wet;
      }
      const sp = mix(look.a.mul(0.35).add(fWet.mul(1.6)).add(wx.wet.mul(0.6)), float(1), max(snowK, smoothstep(0.4, 0.6, patchy)));
      let c = light.shade(alb, N, P, { spec: sp, ao: fAo }).toVar();
      if (FIORD) {
        // wet rock in the sun: the cracks' shade on the sun's own light too, and points of glitter where a film of
        // water faces the eye's mirror of the sun
        const Vd2 = normalize(P.sub(cameraPosition)), R2 = Vd2.sub(N.mul(dot(Vd2, N).mul(2)));
        const lobe = pow(max(dot(R2, vec3(lightU.sunDir)), 0), 24);
        const spark = float(0.5);
        c.addAssign(vec3(lightU.sunE).mul(light.sunVis(P)).mul(lobe.mul(spark).mul(fWet).mul(0.5 / Math.PI)));
      }
      // glints in the snow: facets catching the sun, a few per square metre, only close up
      If(dist.lessThan(60).and(snowK.greaterThan(0.01)), () => {
        const glint = smoothstep(0.86, 0.98, mx_noise_float(vec3(x.mul(9), P.y.mul(9), z.mul(9)).add(cameraPosition.mul(0.35)))).mul(snowK).mul(float(1).sub(smoothstep(8, 60, dist)));
        c.addAssign(vec3(lightU.sunE).mul(glint.mul(0.6).mul(light.sunVis(P))));
      });
      return c;
    })();
    return mat;
  }
  // the detail normal: the grid's normal bent by the relief's gradient (the same fbm as the patch), near the camera
  const relief = (x, z) => fbmT(x, z).mul(reliefAmp(x, z));
  // (beyond 900 m, where near is 0, a branch skips it; the cover's amplitude is read once, not at each of the four
  // samples: it is blended over 20 m and barely changes across the 1.2 m the difference spans)
  const bumped = (cls, near) => {
    const P = positionWorld, e = 0.6;
    const N0 = normalize(normalWorld), N = N0.toVar();
    If(near.greaterThan(0.001), () => {
      const amp = reliefAmp(P.x, P.z);
      const gx = fbmT(P.x.add(e), P.z).sub(fbmT(P.x.sub(e), P.z)).mul(amp).div(2 * e);
      const gz = fbmT(P.x, P.z.add(e)).sub(fbmT(P.x, P.z.sub(e))).mul(amp).div(2 * e);
      // fine grain on top, strongest in rock and scree
      const fine = vec3(mx_noise_float(vec3(P.x.mul(2.2), P.y.mul(2.2), P.z.mul(2.2))), 0, mx_noise_float(vec3(P.z.mul(2.2), P.x.mul(2.2), P.y.mul(2.2).add(7)))).mul(0.18);
      N.assign(normalize(N0.sub(vec3(gx, 0, gz).add(fine).mul(near))));
    });
    return N;
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
  // the chunks' levels by distance (the low tier keeps the finer ones nearer the eye: range < 1)
  const RANGE = [1400, 3800, 9000].map(r => r * range);
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
  const detailHeight = (wx, wz) => bicubic(wx, wz).add(relief(wx, wz).mul(float(1).sub(roads.flat(wx, wz))));
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
  // the grid as the GPU reads it: the height texture holds half floats (steps of 0.125 m at 200 m over the lake,
  // 0.25 m at 300 m), so the twin reads the same rounded values, not the exact ones
  const half = heightTex.image && heightTex.image.data instanceof Uint16Array && heightTex.image.data.length === W * H ? heightTex.image.data : null;
  const atQ = half ? (i, j) => THREE.DataUtils.fromHalfFloat(half[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))]) : at;
  function bicubicJS(x, north) {
    const gx = (x - t.x0) / t.cell_m - 0.5, gy = (t.y1 - north) / t.cell_m - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), wx = crJS(gx - ix), wy = crJS(gy - iy);
    let h = 0;
    for (let j = 0; j < 4; j++) { let r = 0; for (let i = 0; i < 4; i++) r += atQ(ix + i - 1, iy + j - 1) * wx[i]; h += r * wy[j]; }
    return h;
  }
  // the patch's surface exactly as drawn: its vertices (on a world grid of STEP metres, since the patch's centre snaps to
  // 8 m) carry the bicubic grid plus the relief, and each cell is two triangles split along the diagonal from its
  // (x0, z1) corner to its (x1, z0) corner, as PlaneGeometry builds them. Standing on the smooth function instead put feet
  // up to 0.3 m into rock and scree, whose finest relief the 2 m cells cannot hold
  const STEP = 2 * HALF / CELLS;
  const vertexH = (x, z) => bicubicJS(x, -z) + fbmJS(x, z) * ampAt(x, -z) * (1 - roads.flatJS(x, -z));
  const heightAt = (x, north) => {
    const z = -north, x0 = Math.floor(x / STEP) * STEP, z0 = Math.floor(z / STEP) * STEP, u = (x - x0) / STEP, v = (z - z0) / STEP;
    const hb = vertexH(x0, z0 + STEP), hd = vertexH(x0 + STEP, z0);
    if (u + v <= 1) { const ha = vertexH(x0, z0); return ha + (hd - ha) * u + (hb - ha) * v; }
    const hc = vertexH(x0 + STEP, z0 + STEP);
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  };

  let monthSeen = -1;
  function update(cam) {
    detailUpdate(cam);
    roads.update(cam);
    const m = new Date((ctx_clock ? ctx_clock() : Date.now()) + 12 * 3600e3).getUTCMonth();   // New Zealand's month, near enough
    if (m !== monthSeen) { monthSeen = m; snowSeason.value = SEASON[m]; rataSeason.value = RATA[m]; }
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
  return { group, update, prepare, material: mats[0], materials: mats, heightAt, coverAt, coverTex, roads, weather: wx };
}
