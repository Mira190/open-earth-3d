// The beach and the sea floor close to the camera. The survey grid is 30 m, which cannot hold a
// beach, so around the camera a finer patch (2 m cells) rides on a bicubic (Catmull-Rom) read of
// the same grid plus dunes and ripples that are added in world space, so they do not swim as the
// patch follows the camera. The coarse terrain is cut away underneath it. Sand gets ripples
// (wave-oriented under water, finer on the dry beach) as a bump; wet sand, up to the last reach of
// the swash, is darker and glossier.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, mix, max, min, abs, floor, fract, smoothstep, clamp, select, texture, uniform,
  positionWorld, mx_noise_float, sin, normalize, dot, varying, positionLocal, length, normalWorld, transformDirection, cameraViewMatrix } from 'three/tsl';
import { gridUV } from './world.js';

const HALF = 160, CELLS = 160;   // patch: 320 m square, 2 m cells

export function createShore(d, env, heightTex, terrain) {
  const t = d.scene.terrain;
  const centre = uniform(new THREE.Vector2());
  const u = env.u;

  // ---- bicubic height from the survey grid (Catmull-Rom, 16 taps)
  const cr = f => [f.mul(f).mul(f).mul(-0.5).add(f.mul(f)).sub(f.mul(0.5)),
    f.mul(f).mul(f).mul(1.5).sub(f.mul(f).mul(2.5)).add(1),
    f.mul(f).mul(f).mul(-1.5).add(f.mul(f).mul(2)).add(f.mul(0.5)),
    f.mul(f).mul(f).mul(0.5).sub(f.mul(f).mul(0.5))];
  const bicubic = (wx, wz) => {
    const gx = wx.sub(t.x0).div(t.cell_m).sub(0.5), gy = wz.add(t.y1).div(t.cell_m).sub(0.5);
    const ix = floor(gx), iy = floor(gy), wxs = cr(gx.sub(ix)), wys = cr(gy.sub(iy));
    let h = float(0);
    for (let j = 0; j < 4; j++) {
      let row = float(0);
      for (let i = 0; i < 4; i++) {
        const uv = vec2(ix.add(i - 1 + 0.5).div(t.w), iy.add(j - 1 + 0.5).div(t.h));
        row = row.add(texture(heightTex, uv).level(0).r.mul(wxs[i]));
      }
      h = h.add(row.mul(wys[j]));
    }
    return h;
  };
  const bilinear = (wx, wz) => texture(heightTex, gridUV(d, wx, wz)).level(0).r;

  // ---- relief the grid cannot hold: dunes behind the beach, nothing in the water
  const relief = (wx, wz, h) => {
    const dry = smoothstep(u.tide.add(0.1), u.tide.add(1.2), h);
    const dune = mx_noise_float(vec3(wx.mul(0.045), 0, wz.mul(0.045))).mul(0.45)
      .add(mx_noise_float(vec3(wx.mul(0.2), 0, wz.mul(0.2))).mul(0.12));
    const low = float(1).sub(smoothstep(3, 14, h));                 // dunes, not mountains: fade out up the hill
    return dune.mul(dry).mul(low);
  };
  const detailHeight = (wx, wz) => { const h = bicubic(wx, wz); return h.add(relief(wx, wz, h)); };

  const geo = new THREE.PlaneGeometry(2 * HALF, 2 * HALF, CELLS, CELLS).rotateX(-Math.PI / 2);
  const mat = terrain.material.clone();
  const snapped = Fn(() => vec2(positionLocal.x, positionLocal.z).add(centre));
  mat.positionNode = Fn(() => {
    const p = snapped();
    const rim = max(abs(positionLocal.x), abs(positionLocal.z)).div(HALF);
    const k = smoothstep(0.82, 1.0, rim);
    const hd = detailHeight(p.x, p.y), hb = bilinear(p.x, p.y);
    // blend to the coarse surface at the rim, and tuck the rim just under it so no crack opens
    return vec3(p.x, mix(hd, hb, k).sub(k.mul(k).mul(0.12)), p.y);
  })();
  // normals by differences of the same height function
  const e = 0.9;
  const nrm = Fn(() => {
    const p = snapped();
    const dx = detailHeight(p.x.add(e), p.y).sub(detailHeight(p.x.sub(e), p.y)).div(2 * e);
    const dz = detailHeight(p.x, p.y.add(e)).sub(detailHeight(p.x, p.y.sub(e))).div(2 * e);
    return normalize(vec3(dx.negate(), 1, dz.negate()));
  });
  const vN = varying(nrm(), 'vShoreNormal');

  // ---- sand ripples and wet sand, shared by the patch and the coarse terrain
  const wetness = Fn(([y]) => float(1).sub(smoothstep(env.swash, env.swash.add(0.7), y)).mul(smoothstep(u.tide.sub(0.05), u.tide.add(0.05), y)));
  // ripple relief in metres at a world point (a bump: only its gradient is used)
  const ripH = (x, z, y) => {
    const under = float(1).sub(smoothstep(u.tide.sub(0.3), u.tide.add(0.1), y));
    // ripple crests lie across the wave direction (wind from 125 deg: waves travel toward 305)
    const a = 125 * Math.PI / 180, dx = Math.sin(a), dz = Math.cos(a);
    const along = x.mul(dx).add(z.mul(dz));
    const warp = mx_noise_float(vec3(x.mul(0.35), 0, z.mul(0.35))).mul(1.6);
    const patchy = smoothstep(-0.3, 0.5, mx_noise_float(vec3(x.mul(0.09), 7, z.mul(0.09)))).mul(0.8).add(0.2);
    const lam = mix(float(0.07), float(0.17), under);
    const crest = sin(along.div(lam).mul(6.2831).add(warp.mul(6)));
    const speck = mx_noise_float(vec3(x.mul(35), 0, z.mul(35))).mul(0.25);
    return crest.mul(mix(float(0.0011), float(0.0045), under)).mul(patchy).add(speck.mul(0.0008)).mul(float(1).sub(wetness(y).mul(0.7)));
  };
  const rippled = base => Fn(() => {
    const x = positionWorld.x, z = positionWorld.z, y = positionWorld.y, e = 0.02;
    const gx = ripH(x.add(e), z, y).sub(ripH(x.sub(e), z, y)).div(2 * e);
    const gz = ripH(x, z.add(e), y).sub(ripH(x, z.sub(e), y)).div(2 * e);
    return transformDirection(normalize(base.sub(vec3(gx, 0, gz))), cameraViewMatrix);
  })();
  for (const m of [terrain.material, mat]) {
    m.roughnessNode = Fn(() => mix(float(0.95), float(0.22), wetness(positionWorld.y)))();
  }
  mat.normalNode = rippled(vN);
  terrain.material.normalNode = rippled(normalWorld);
  // the coarse terrain is cut away under the patch
  terrain.material.opacityNode = Fn(() => {
    const dx = abs(positionWorld.x.sub(centre.x)), dz = abs(positionWorld.z.sub(centre.y));
    return select(max(dx, dz).lessThan(HALF * 0.985), float(0), float(1));
  })();
  terrain.material.alphaTest = 0.5;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  function update(cam) { centre.value.set(Math.round(cam.x / 8) * 8, Math.round(cam.z / 8) * 8); }
  return { mesh, update, height: detailHeight };
}
