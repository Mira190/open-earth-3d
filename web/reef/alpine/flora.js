// Plants and stones round the camera on an alpine site, placed by land cover (build_alpine.py COVER):
// - tussock (silver tussock and fescue on the basin, snow tussock higher up): clumps of fine blades, straw-gold
//   with green at the base, swaying in the wind's gusts, glowing when the sun is behind them;
// - Russell lupins (Lupinus x russellii, naturalised): flower spikes in purple, pink, blue, white and yellow on the
//   lake shore, the riverbeds and the roadsides, in flower from late spring (the clock's month sets how many);
// - matagouri and briar on scrubland, and stones on scree, moraine and the riverbeds.
// All are instanced meshes refilled by tiles as the camera moves; each is lit by light.js like the land under it,
// mountains' shadows included.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, sin, cos, smoothstep, clamp, dot, normalize, length, uniform, positionLocal,
  positionWorld, cameraPosition, attribute, mx_noise_float, exp, pow, abs, instanceIndex, varying, uv, normalWorld, positionGeometry } from 'three/tsl';

const TILE = 24;
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hash2 = (i, j, k = 0) => { let h = (i * 374761393 + j * 668265263 + k * 1442695041) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };

// ---- geometry
function tussockGeometry(blades = 64, segs = 4, wMul = 1) {
  seed = 7;
  const pos = [], nrm = [], uvs = [], idx = [];
  for (let b = 0; b < blades; b++) {
    // a dense mound: most blades near upright, the outer ones arching over
    const a = rnd() * Math.PI * 2, outer = rnd(), lean = 0.08 + outer * outer * 0.75, len = 0.32 + rnd() * 0.38, w = (0.006 + rnd() * 0.007) * wMul;
    const r0 = 0.03 + outer * 0.1, base = pos.length / 3;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, out = r0 + lean * len * t * t * 0.9, up = len * (t - 0.32 * lean * t * t);
      const ww = w * (1 - t * 0.85);
      for (const side of [-1, 1]) {
        pos.push(dx * out + px * ww * side, up, dz * out + pz * ww * side);
        const n = new THREE.Vector3(dx * (0.4 + t), 1 - lean * t, dz * (0.4 + t)).normalize();
        nrm.push(n.x, n.y, n.z); uvs.push(side * 0.5 + 0.5, t);
      }
      if (s < segs) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  return g;
}
// a lupin: a stem, a tapered spike of florets (a ribbed cone the shader colours in tiers), and palmate leaves at the foot
function lupinGeometry() {
  const parts = [];
  const spike = new THREE.CylinderGeometry(0.012, 0.055, 0.42, 10, 14, false).translate(0, 0.78, 0);
  // florets: bump the spike's surface outward in whorls
  const p = spike.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.45 * Math.max(0, Math.sin(y * 95) * Math.cos(a * 5 + y * 40));
    p.setXYZ(i, x * k, y, z * k);
  }
  spike.computeVertexNormals();
  const sUV = spike.attributes.uv; for (let i = 0; i < sUV.count; i++) sUV.setXY(i, 1, Math.min(1, Math.max(0, (spike.attributes.position.getY(i) - 0.57) / 0.42)));
  parts.push(spike);
  const stem = new THREE.CylinderGeometry(0.006, 0.009, 0.6, 5, 1).translate(0, 0.3, 0);
  const su = stem.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, 0, 0);
  parts.push(stem);
  for (let l = 0; l < 5; l++) {
    const leaf = new THREE.PlaneGeometry(0.03, 0.16, 1, 2).translate(0, 0.08, 0);
    const lp = leaf.attributes.position; for (let i = 0; i < lp.count; i++) { const yy = lp.getY(i); lp.setZ(i, -yy * yy * 1.2); }
    for (let f = 0; f < 7; f++) {
      const lf = leaf.clone().rotateX(-1.0).rotateY(f / 7 * Math.PI * 2).translate(0, 0.1 + l * 0.07, 0);
      lf.rotateY(l * 0.9);
      const u = lf.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, 0, 0);
      parts.push(lf);
    }
  }
  const merged = mergeAll(parts);
  return merged;
}
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  seed = 11;
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const k = 0.75 + 0.5 * hash2(Math.round(v.x * 10), Math.round(v.y * 10), Math.round(v.z * 10)); p.setXYZ(i, v.x * k, v.y * k * 0.62, v.z * k); }
  g.computeVertexNormals();
  return g;
}
function shrubGeometry() {
  // matagouri: a dense, twiggy, grey-green dome
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const k = 0.8 + 0.35 * hash2(Math.round(v.x * 7), Math.round(v.y * 7), Math.round(v.z * 7)); p.setXYZ(i, v.x * k, Math.max(v.y, -0.2) * k * 0.8 + 0.3, v.z * k); }
  g.computeVertexNormals();
  return g;
}
function mergeAll(geos) {
  const pos = [], nrm = [], uvs = [], idx = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); out.setIndex(idx);
  return out;
}

// the share of lupins in flower by month: September to February (NZPCN), November to February on the Mackenzie's
// riverflats (DOC's braided river field guide), at their best from mid November to the end of December
const BLOOM = [0.6, 0.25, 0, 0, 0, 0, 0, 0, 0.08, 0.3, 0.75, 1.0];

export async function init(ctx) {
  const { scene, env, camera, S } = ctx;
  if (S.kind !== 'alpine' || !ctx.light) return null;
  const light = ctx.light, terrain = ctx.terrain;
  const quality = ctx.q.get('flora') === '0' ? 0 : (Math.min(innerWidth, innerHeight) < 700 ? 0.55 : 1);
  if (!quality) return null;
  const wind = env.u.wind, time = env.u.time;
  const windDir = new THREE.Vector2(Math.sin(125 * Math.PI / 180), -Math.cos(125 * Math.PI / 180));
  const wd = uniform(windDir);

  // the wind in the grass: gusts that roll across the land with the wind, bending the tips most
  const sway = (P0, h, stiff) => {
    const P = vec3(P0.x, 0, P0.y);
    const g = mx_noise_float(vec3(P.x.mul(0.05).sub(time.mul(wd.x).mul(0.9)), time.mul(0.15), P.z.mul(0.05).sub(time.mul(wd.y).mul(0.9)))).mul(0.5).add(0.6);
    const flutter = sin(time.mul(3.1).add(P.x.mul(1.7)).add(P.z.mul(1.3))).mul(0.18);
    const bend = h.mul(h).mul(wind.mul(0.35).add(0.05)).mul(g.add(flutter)).div(stiff);
    return vec3(wd.x, 0, wd.y).mul(bend);
  };
  const lit = (alb, N, P, trans) => {
    // light through thin leaves when the sun is behind them, from the eye's side
    const V = normalize(cameraPosition.sub(P));
    const back = pow(max(dot(V.negate(), light.u.sunDir), 0), 4).mul(trans);
    return light.shade(alb, N, P).add(vec3(light.u.sunE).mul(alb).mul(back.mul(light.sunVis(P)).mul(0.22)));
  };

  // ---- tussock
  const tGeo = tussockGeometry(), tMax = Math.round(2600 * quality);
  const tfGeo = tussockGeometry(18, 2, 2.2), tfMax = Math.round(14000 * quality);
  const tMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const tTint = attribute('aTint', 'vec3');
  // (on an instanced mesh the position node already sees the instance's transform: the height off the ground is the geometry's own)
  tMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y, 1)))();
  tMat.colorNode = Fn(() => {
    const t = uv().y;
    const base = mix(vec3(0.16, 0.17, 0.08), vec3(0.58, 0.46, 0.25), smoothstep(0.0, 0.6, t));
    const alb = mix(base, base.mul(vec3(1.15, 1.1, 0.95)), smoothstep(0.7, 1.0, t)).mul(tTint);
    const N = normalize(mix(vec3(0, 1, 0), normalize(normalWorld), 0.4));
    return lit(alb, N, positionWorld, float(1)).mul(t.mul(0.55).add(0.45));    // self-shadowed low in the clump
  })();
  const tussock = new THREE.InstancedMesh(tGeo, tMat, tMax); tussock.count = 0; tussock.frustumCulled = false;
  const tTintAttr = new THREE.InstancedBufferAttribute(new Float32Array(tMax * 3), 3); tGeo.setAttribute('aTint', tTintAttr);
  const tPos = new THREE.InstancedBufferAttribute(new Float32Array(tMax * 2), 2); tGeo.setAttribute('aPos', tPos);
  // beyond 28 m a clump of 18 broader blades stands in for the 64
  const tussockFar = new THREE.InstancedMesh(tfGeo, tMat, tfMax); tussockFar.count = 0; tussockFar.frustumCulled = false;
  const tfTint = new THREE.InstancedBufferAttribute(new Float32Array(tfMax * 3), 3); tfGeo.setAttribute('aTint', tfTint);
  const tfPos = new THREE.InstancedBufferAttribute(new Float32Array(tfMax * 2), 2); tfGeo.setAttribute('aPos', tfPos);

  // ---- lupins
  const lGeo = lupinGeometry(), lMax = Math.round(5000 * quality);
  const lMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const lCol = attribute('aFlower', 'vec4');      // rgb flower colour, a: in flower (0..1)
  lMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y, 2.2)))();
  lMat.colorNode = Fn(() => {
    const tier = uv().y, isSpike = uv().x.greaterThan(0.5);
    // florets open from the bottom of the spike up; above the open ones, green buds
    const open = float(1).sub(smoothstep(lCol.w.sub(0.08), lCol.w.add(0.08), tier.mul(0.85)));
    const fl = mix(vec3(0.18, 0.30, 0.12), lCol.xyz, open);
    const leaf = vec3(0.12, 0.26, 0.10);
    const alb = isSpike.select(fl, leaf);
    const N = normalize(normalWorld);
    return lit(alb, N, positionWorld, isSpike.select(float(0.6), float(1)));
  })();
  const lupins = new THREE.InstancedMesh(lGeo, lMat, lMax); lupins.count = 0; lupins.frustumCulled = false;
  const lColAttr = new THREE.InstancedBufferAttribute(new Float32Array(lMax * 4), 4); lGeo.setAttribute('aFlower', lColAttr);
  const lPos = new THREE.InstancedBufferAttribute(new Float32Array(lMax * 2), 2); lGeo.setAttribute('aPos', lPos);

  // ---- stones and shrubs
  const rGeo = rockGeometry(), rMax = Math.round(6000 * quality);
  const rMat = new THREE.MeshBasicNodeMaterial();
  const rTint = attribute('aTint', 'vec3');
  rMat.colorNode = Fn(() => {
    const P = positionWorld;
    const n = mx_noise_float(P.mul(3.0)).mul(0.15).add(mx_noise_float(P.mul(11.0)).mul(0.08));
    const alb = vec3(0.42, 0.41, 0.39).mul(rTint).mul(float(1).add(n));
    return light.shade(alb, normalize(normalWorld), P);
  })();
  const rocks = new THREE.InstancedMesh(rGeo, rMat, rMax); rocks.count = 0; rocks.frustumCulled = false;
  const rTintAttr = new THREE.InstancedBufferAttribute(new Float32Array(rMax * 3), 3); rGeo.setAttribute('aTint', rTintAttr);
  const sGeo = shrubGeometry(), sMax = Math.round(2500 * quality);
  const sMat = new THREE.MeshBasicNodeMaterial();
  sMat.positionNode = Fn(() => positionLocal.add(sway(attribute('aPos', 'vec2'), positionGeometry.y.mul(0.3), 3)))();
  sMat.colorNode = Fn(() => {
    const P = positionWorld;
    const n = mx_noise_float(P.mul(6.0)).mul(0.25);
    const alb = vec3(0.16, 0.18, 0.11).mul(float(1).add(n));
    return lit(alb, normalize(normalWorld), P, float(0.4));
  })();
  const shrubs = new THREE.InstancedMesh(sGeo, sMat, sMax); shrubs.count = 0; shrubs.frustumCulled = false;
  const sPos = new THREE.InstancedBufferAttribute(new Float32Array(sMax * 2), 2); sGeo.setAttribute('aPos', sPos);
  scene.add(tussock, tussockFar, lupins, rocks, shrubs);

  // ---- placement by tiles round the camera
  // wild stands run blue to purple (Wikipedia: Lupinus polyphyllus), with pinks, white and a few yellow (NZPCN, DOC);
  // no count of the shares is published, so these are a judgement from photographs
  const LUPINS = [[0.30, 0.22, 0.70], [0.45, 0.20, 0.62], [0.66, 0.22, 0.50], [0.82, 0.40, 0.62], [0.88, 0.86, 0.82], [0.86, 0.68, 0.16]];
  const LUPW = [0.28, 0.22, 0.16, 0.14, 0.15, 0.05];
  const pickLupin = r => { let a = 0; for (let i = 0; i < LUPW.length; i++) { a += LUPW[i]; if (r < a) return LUPINS[i]; } return LUPINS[0]; };
  const month = () => new Date(ctx.clockMs ? ctx.clockMs() : Date.now()).getUTCMonth();   // NZ is ahead of UTC: within a day, fine for a season
  const roadNear = (x, n) => { for (const [dx, dn] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12], [22, 0], [-22, 0], [0, 22], [0, -22]]) if (ctx.habitat(x + dx, n + dn) === 13) return true; return false; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let lastKey = '';
  function fill(cam) {
    const tx = Math.floor(cam.x / TILE), tn = Math.floor(-cam.z / TILE);
    const key = tx + ',' + tn + ',' + month();
    if (key === lastKey) return; lastKey = key;
    const bloom = BLOOM[month()];
    let nt = 0, ntf = 0, nl = 0, nr = 0, ns = 0;
    const R = { t: 95 * Math.sqrt(quality), l: 130 * Math.sqrt(quality), r: 110 * Math.sqrt(quality), s: 220 * Math.sqrt(quality) };
    const span = Math.ceil(R.s / TILE);
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
      const ci = tx + i, cj = tn + j;
      const cxm = (ci + 0.5) * TILE, cnm = (cj + 0.5) * TILE;
      const dc = Math.hypot(cxm - cam.x, cnm + cam.z);
      if (dc > R.s + TILE) continue;
      // a fixed set of candidate spots per tile, by hash, so a tile looks the same whenever it comes back
      const K = dc < R.t + TILE ? 200 : 60;           // tussock wants many spots; further out only shrubs
      for (let k = 0; k < K; k++) {
        const hx = hash2(ci, cj, k * 3), hn = hash2(ci, cj, k * 3 + 1), hk = hash2(ci, cj, k * 3 + 2);
        const x = (ci + hx) * TILE, n = (cj + hn) * TILE;
        const dd = Math.hypot(x - cam.x, n + cam.z);
        if (dd > R.s) continue;
        const cls = ctx.habitat(x, n);
        if (cls === 0 || cls === 13 || cls === 14 || cls === 2 || cls === 11 || cls === 10) continue;
        const maybe = ((cls === 7 || cls === 8 || cls === 12) && dd < R.t) || (dd < R.l && (cls === 15 || cls === 6 || k % 3 === 0)) ||
          ((cls === 4 || cls === 5 || cls === 6 || cls === 3 || cls === 15) && dd < R.r) || cls === 9 || cls === 7;
        if (!maybe) continue;
        if (ctx.depth(x, n) > -0.05) continue;                         // not in the water
        const h = terrain.heightAt(x, n);
        pv.set(x, h, -n);
        const clump = mx2(x, n);
        if ((cls === 7 || cls === 8 || cls === 12) && dd < R.t && hk < (cls === 8 ? 0.45 : 0.95) * (0.45 + 0.55 * clump)) {
          const near = dd < 28;
          if (near ? nt < tMax : ntf < tfMax) {
            const s = 0.75 + hash2(ci, cj, k + 500) * 0.6;
            q.setFromAxisAngle(up, hk * 40); sc.set(s, s * (0.8 + 0.4 * hash2(ci, cj, k + 900)), s);
            m4.compose(pv, q, sc);
            const g = 0.85 + 0.3 * hash2(ci, cj, k + 77);
            if (near) { tussock.setMatrixAt(nt, m4); tPos.setXY(nt, x, -n); tTintAttr.setXYZ(nt, g, g * (0.95 + 0.1 * clump), g * 0.9); nt++; }
            else { tussockFar.setMatrixAt(ntf, m4); tfPos.setXY(ntf, x, -n); tfTint.setXYZ(ntf, g, g * (0.95 + 0.1 * clump), g * 0.9); ntf++; }
          }
        }
        const lupinSpot = cls === 15 || cls === 6 || (k % 3 === 0 && roadNear(x, n));
        if (lupinSpot && dd < R.l && nl < lMax && hk < 0.9 * smoothClump(clump)) {
          const s = 0.75 + hash2(ci, cj, k + 300) * 0.55;
          q.setFromAxisAngle(up, hk * 50); sc.set(s, s, s);
          lupins.setMatrixAt(nl, m4.compose(pv, q, sc)); lPos.setXY(nl, x, -n);
          const c = pickLupin(hash2(ci, cj, k + 1300)), on = bloom > hash2(ci, cj, k + 1700) ? Math.min(1, bloom * 1.2) * (0.6 + 0.4 * hash2(ci, cj, k + 2100)) : 0;
          lColAttr.setXYZW(nl, c[0], c[1], c[2], on);
          nl++;
        }
        if ((cls === 4 || cls === 5 || cls === 6 || cls === 3 || cls === 15) && dd < R.r && nr < rMax && hk < (cls === 6 ? 0.35 : 0.6)) {
          const s = (cls === 4 || cls === 3 ? 0.6 : 0.25) + Math.pow(hash2(ci, cj, k + 400), 3) * (cls === 4 ? 2.5 : 1.1);
          q.setFromEuler(new THREE.Euler(hk * 3, hk * 17, hn * 5)); sc.set(s, s, s);
          pv.y = h - s * 0.25;
          rocks.setMatrixAt(nr, m4.compose(pv, q, sc));
          const g = 0.75 + 0.5 * hash2(ci, cj, k + 600); rTintAttr.setXYZ(nr, g, g * 0.98, g * 0.95);
          nr++;
        }
        if ((cls === 9 || (cls === 7 && hk > 0.985)) && dd < R.s && ns < sMax && hk > 0.55) {
          const s = 0.6 + hash2(ci, cj, k + 800) * 1.1;
          q.setFromAxisAngle(up, hk * 30); sc.set(s * 1.2, s, s * 1.2);
          pv.y = h;
          shrubs.setMatrixAt(ns, m4.compose(pv, q, sc)); sPos.setXY(ns, x, -n);
          ns++;
        }
      }
    }
    for (const [m, n, attrs] of [[tussock, nt, [tTintAttr, tPos]], [tussockFar, ntf, [tfTint, tfPos]], [lupins, nl, [lColAttr, lPos]], [rocks, nr, [rTintAttr]], [shrubs, ns, [sPos]]]) {
      m.count = n; m.instanceMatrix.needsUpdate = true;
      for (const a of attrs) a.needsUpdate = true;
    }
  }
  // clumps: a low-frequency field so plants come in drifts, not evenly
  const mx2 = (x, n) => { const v = Math.sin(x * 0.043 + Math.sin(n * 0.031) * 2.1) * 0.5 + Math.sin(n * 0.057 - Math.sin(x * 0.027) * 1.7) * 0.5; return v * 0.5 + 0.5; };
  const smoothClump = c => Math.max(0, (c - 0.35) / 0.65);
  fill(camera.position);
  return { update() { fill(camera.position); } };
}
