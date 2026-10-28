// Wakes. Two layers:
//  1. WakeField: a world-locked 256x256 height/foam texture (2 m cells, 512 m across) that follows the camera by ring
//     scrolling (the texel for world cell (i, j) is always (i mod 256, j mod 256), so nothing is copied when the window
//     moves, only the cells entering it are cleared). Vessels stamp bow, stern and hull foam into it; a damped 2D wave
//     equation spreads the stamps into Kelvin-like V wakes and the foam decays. The ocean shader reads it with
//     `wakeNode(worldXZ) -> { height, foam }` (height in metres, foam 0..1), see README notes in boats.js.
//  2. Trail ribbons: the visible white wake as a transparent strip behind each moving hull, so the wake looks right even
//     if the ocean does not sample the field.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, texture, fract, smoothstep, abs, max, exp, mix, clamp, attribute, mx_noise_float, positionWorld, uv, pow } from 'three/tsl';
import { shared } from './kit.js';

export const N = 256, CELL = 2, SIZE = N * CELL;

export function createWakeField(ctx) {
  const H = new Float32Array(N * N), Vv = new Float32Array(N * N), F = new Float32Array(N * N);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { data[i * 4] = 128; }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  const centre = uniform(new THREE.Vector2());
  let ox = 0, oz = 0, activeUntil = 0, acc = 0, dirty = true;
  const mod = (a) => ((a % N) + N) % N;

  function clearCol(i) { for (let j = 0; j < N; j++) { const k = j * N + i; H[k] = Vv[k] = F[k] = 0; } }
  function clearRow(j) { for (let i = 0; i < N; i++) { const k = j * N + i; H[k] = Vv[k] = F[k] = 0; } }
  function follow(cam) {
    const nx = Math.floor(cam.x / CELL) - N / 2, nz = Math.floor(cam.z / CELL) - N / 2;
    if (nx !== ox || nz !== oz) {
      if (Math.abs(nx - ox) >= N || Math.abs(nz - oz) >= N) { H.fill(0); Vv.fill(0); F.fill(0); }
      else {
        if (nx > ox) for (let w = ox + N; w < nx + N; w++) clearCol(mod(w)); else for (let w = nx; w < ox; w++) clearCol(mod(w));
        if (nz > oz) for (let w = oz + N; w < nz + N; w++) clearRow(mod(w)); else for (let w = nz; w < oz; w++) clearRow(mod(w));
      }
      ox = nx; oz = nz;
    }
    centre.value.set((ox + N / 2) * CELL, (oz + N / 2) * CELL);
  }
  // world point + radius (m): raise the water by `dh` (m) and lay down `foam` (0..1)
  function stamp(x, z, radius, dh, foam, now) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), rc = Math.ceil(radius / CELL) + 1;
    if (ci < ox + 2 || cj < oz + 2 || ci >= ox + N - 2 || cj >= oz + N - 2) return;
    const r2 = radius * radius;
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < ox || j < oz || i >= ox + N || j >= oz + N) continue;
      const dx = (i + 0.5) * CELL - x, dz = (j + 0.5) * CELL - z, d2 = dx * dx + dz * dz;
      if (d2 > r2 * 4) continue;
      const g = Math.exp(-d2 / r2), k = mod(j) * N + mod(i);
      H[k] += dh * g; if (foam > F[k] * 1) F[k] = Math.min(1, Math.max(F[k], foam * g));
    }
    activeUntil = now + 18;
  }
  const C2 = 0.0075;
  function step() {
    for (let j = 0; j < N; j++) {
      const jm = mod(j - 1) * N, jp = mod(j + 1) * N, j0 = j * N;
      for (let i = 0; i < N; i++) {
        const im = mod(i - 1), ip = mod(i + 1), k = j0 + i;
        const lap = H[j0 + im] + H[j0 + ip] + H[jm + i] + H[jp + i] - 4 * H[k];
        let v = (Vv[k] + C2 * lap) * 0.985;
        Vv[k] = v;
      }
    }
    for (let k = 0; k < N * N; k++) {
      let h = (H[k] + Vv[k]) * 0.9985;
      if (h > 0.7) h = 0.7; else if (h < -0.7) h = -0.7;
      H[k] = h;
      // steep crests break: foam from wave height, then it fades
      let f = F[k] * 0.9955 + (h > 0.1 ? (h - 0.1) * 0.5 : 0);
      F[k] = f > 1 ? 1 : f;
    }
  }
  function update(dt, now) {
    follow(ctx.camera.position);
    if (now > activeUntil) { if (dirty) { for (let i = 0; i < N * N; i++) { data[i * 4] = 128; data[i * 4 + 1] = 0; } tex.needsUpdate = true; dirty = false; H.fill(0); Vv.fill(0); F.fill(0); } return; }
    acc += dt;
    let n = 0;
    while (acc >= 1 / 30 && n < 2) { step(); acc -= 1 / 30; n++; }
    acc = Math.min(acc, 1 / 30);
    for (let k = 0; k < N * N; k++) {
      const h = H[k], f = F[k];
      data[k * 4] = Math.max(0, Math.min(255, 128 + h * (127 / 0.7)));
      data[k * 4 + 1] = Math.min(255, f * 255);
    }
    tex.needsUpdate = true; dirty = true;
  }
  // TSL: sample the field at a world xz. height is in metres (+-0.7 m), foam 0..1; faded to nothing toward the window edge.
  const wakeNode = (worldXZ) => {
    const s = texture(tex, worldXZ.div(SIZE)).level(0);
    const d = max(abs(worldXZ.x.sub(centre.x)), abs(worldXZ.y.sub(centre.y)));
    const fade = float(1).sub(smoothstep(SIZE * 0.36, SIZE * 0.49, d));
    return { height: s.r.sub(128 / 255).mul(255 * 0.7 / 127).mul(fade), foam: s.g.mul(fade) };
  };
  return { stamp, update, wakeNode, tex, centre, size: SIZE, cell: CELL, H, F };
}

// ---- ribbon trails ---------------------------------------------------------------------------------------
let ribbonMat = null;
function ribbonMaterial() {
  if (ribbonMat) return ribbonMat;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const wk = attribute('wk', 'vec2');                // x: strength (speed), y: age 0..1
  const u = uv().x;                                  // -1..1 across the ribbon
  const env = shared.env;
  m.colorNode = Fn(() => vec3(0.93, 0.96, 0.97).mul(env.u.white.mul(0.95)))();
  m.opacityNode = Fn(() => {
    const age = wk.y, str = wk.x, au = abs(u);
    const P = positionWorld;
    const n1 = mx_noise_float(vec3(P.x.mul(0.55), P.z.mul(0.55), env.u.time.mul(0.35)));
    const n2 = mx_noise_float(vec3(P.x.mul(2.2), P.z.mul(2.2), env.u.time.mul(0.6)));
    const lace = smoothstep(-0.25, 0.5, n1.mul(0.7).add(n2.mul(0.75)).add(float(0.3).sub(age.mul(0.7))));
    const life = float(1).sub(age);
    const core = exp(au.mul(au).mul(-7.0)).mul(pow(life, 1.3)).mul(float(0.25).add(str.mul(0.7)));
    const arms = smoothstep(0.55, 0.88, au).mul(float(1).sub(smoothstep(0.88, 1.0, au))).mul(pow(life, 0.8)).mul(str.mul(0.75));
    const fill = float(1).sub(smoothstep(0.0, 0.95, au)).mul(life.mul(life)).mul(str.mul(0.18));
    const head = smoothstep(0.0, 0.015, age);
    const edge = float(1).sub(smoothstep(0.82, 1.0, au));
    return clamp(core.add(arms.mul(float(0.55).add(lace.mul(0.6)))).add(fill).mul(lace.mul(0.85).add(0.2)).mul(head).mul(edge.mul(0.5).add(0.5)), 0, 0.85);
  })();
  m.fog = true;
  ribbonMat = m;
  return m;
}

export class Trail {
  constructor(surf, o = {}) {
    this.surf = surf; this.max = o.max ?? 140; this.life = o.life ?? 24; this.w0 = o.w0 ?? 1.2; this.spread = o.spread ?? 0.3;
    this.pts = []; this.last = null; this.str = 0; this.minSpeed = o.minSpeed ?? 0.6; this.spd = o.spd ?? 9;
    const n = this.max + 1;
    this.pos = new Float32Array(n * 2 * 3); this.uvA = new Float32Array(n * 2 * 2); this.wkA = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvA, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('wk', new THREE.BufferAttribute(this.wkA, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, ribbonMaterial());
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.mesh.visible = false;
  }
  // x, z: current stern position (scene); speed m/s; t: clock s
  push(x, z, speed, t) {
    const sp = Math.min(1, speed / this.spd);
    this.str = this.str * 0.9 + sp * 0.1;
    const spacing = Math.min(3, Math.max(0.7, speed * 0.2));
    if (speed > this.minSpeed) {
      if (!this.last || Math.hypot(x - this.last[0], z - this.last[1]) >= spacing) {
        this.pts.unshift({ x, z, t, s: Math.max(0.15, sp) });
        this.last = [x, z];
        if (this.pts.length > this.max) this.pts.pop();
      }
    }
    this.cur = [x, z, speed, sp];
    this.pruneAt = t;
  }
  prefill(x, z, dirx, dirz, speed, t, life) {
    const sp = Math.min(1, speed / this.spd), spacing = Math.min(3, Math.max(0.7, speed * 0.2));
    this.pts = [];
    if (speed <= this.minSpeed) return;
    for (let i = 1; i * spacing < speed * Math.min(life * 0.9, this.life * 0.9) && i < this.max; i++) {
      this.pts.push({ x: x - dirx * i * spacing, z: z - dirz * i * spacing, t: t - i * spacing / speed, s: Math.max(0.15, sp) });
    }
    this.last = [x, z]; this.str = sp;
  }
  rebuild(t, vis) {
    const pts = this.pts;
    while (pts.length && t - pts[pts.length - 1].t > this.life) pts.pop();
    if (!this.cur || pts.length < 1 || !vis) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const all = [{ x: this.cur[0], z: this.cur[1], t, s: this.cur[3] }, ...pts];
    const n = all.length;
    const P = this.pos, U = this.uvA, W = this.wkA, surf = this.surf;
    for (let i = 0; i < n; i++) {
      const a = all[Math.max(0, i - 1)], b = all[Math.min(n - 1, i + 1)];
      let tx = a.x - b.x, tz = a.z - b.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const age = t - all[i].t, f = age / this.life;
      const w = this.w0 + age * this.spread * (0.35 + all[i].s);
      const nx = -tz, nz = tx;
      const y = surf.heightAt(all[i].x, all[i].z, undefined, 5) + 0.12;
      const k = i * 2;
      P[k * 3] = all[i].x + nx * w; P[k * 3 + 1] = y; P[k * 3 + 2] = all[i].z + nz * w;
      P[k * 3 + 3] = all[i].x - nx * w; P[k * 3 + 4] = y; P[k * 3 + 5] = all[i].z - nz * w;
      U[k * 2] = 1; U[k * 2 + 1] = 0; U[k * 2 + 2] = -1; U[k * 2 + 3] = 0;
      W[k * 2] = all[i].s; W[k * 2 + 1] = f; W[k * 2 + 2] = all[i].s; W[k * 2 + 3] = f;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = g.attributes.wk.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
  }
}
