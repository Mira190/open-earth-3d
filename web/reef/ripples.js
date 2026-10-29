// The short waves (0.2-2.4 m) that carry the glitter and the caustics, as a periodic tile.
// Every frame a small quad pass sums 32 waves whose wave vectors fit the tile exactly, and writes
//   grad: (dh/dx, dh/dz, |grad h|^2, h)      hess: (d2h/dx2, d2h/dz2, d2h/dxdz, 0)
// into two mipmapped half-float textures. Sampling them instead of summing sines per pixel:
// - is anti-aliased: a mip level averages what one pixel covers, so distant water and distant
//   caustics settle to their mean instead of shimmering (the old lattice and moire);
// - keeps what the averaging loses: mean(|grad|^2) - |mean(grad)|^2 is the slope variance below
//   the pixel, which is what the sun glitter needs (Cox and Munk 1954);
// - is cheap enough for the water column, which every material evaluates.
// The tile is read twice, the second copy rotated and shrunk (same steepness, shorter waves), so
// the sum does not repeat on any visible scale.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, uniform, sin, cos, texture } from 'three/tsl';

const TAU = Math.PI * 2;
// the two copies: scale, rotation, weight (weights^2 sum to 1, so the slope variance is the tile's)
const COPIES = [{ s: 1, rot: 0, w: Math.SQRT1_2 }, { s: 0.61, rot: 0.72, w: Math.SQRT1_2 }];

// Cox and Munk (1954): total mean-square slope of the sea, 0.003 + 0.00512 U (U wind speed, m/s).
// The viewer's wind 0..1 maps to 3..14 m/s (boats.js windNow); at 0.6 the ripples carry the
// slope variance the wave bank was tuned to, and they calm down with the wind.
export const coxMunk = U => 0.003 + 0.00512 * U;
export const windSpeed = w => 3 + 11 * w;

// cfg: tile (m), res (px), lam [min, max] (m), spread (deg either side of the wind), target slope variance, seed.
// The defaults are the ripple band; ocean.js makes a second, coarser tile for the wind chop's normals at range.
export function createRipples(renderer, windDeg = 120, cfg = {}) {
  const TILE = cfg.tile ?? 16, RES = cfg.res ?? 256, LAM = cfg.lam ?? [0.3, 2.4], SPREAD = cfg.spread ?? 150;
  let seed = cfg.seed ?? 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const N = cfg.n ?? 32, waves = [], used = new Set();
  const TARGET = cfg.target ?? 0.045;          // tile slope variance at wind 0.6 (ripples: as the old ripple band)
  for (let i = 0; waves.length < N && i < 400; i++) {
    const t = (waves.length + rnd() * 0.8) / N;
    const lam = LAM[0] * Math.pow(LAM[1] / LAM[0], t);
    const ang = (windDeg + (rnd() * 2 - 1) * SPREAD) * Math.PI / 180;
    // snap the wave vector to the tile's lattice so the field is periodic
    const m = Math.round(TILE / lam * -Math.sin(ang)), n = Math.round(TILE / lam * Math.cos(ang));
    if (!m && !n || used.has(m + ',' + n)) continue;
    used.add(m + ',' + n);
    const kx = TAU * m / TILE, kz = TAU * n / TILE, k = Math.hypot(kx, kz);
    waves.push({ kx, kz, k, w: Math.sqrt(9.81 * k + 7.3e-5 * k * k * k), steep: 0.7 + rnd() * 0.6, ph: rnd() * TAU, lam: TAU / k });
  }
  // amplitudes: sum of (a k)^2 / 2 = TARGET
  const s2 = waves.reduce((s, w) => s + w.steep * w.steep / 2, 0), norm = Math.sqrt(TARGET / s2);
  for (const w of waves) w.a = w.steep * norm / w.k;

  const time = uniform(0);
  const rt = () => {
    const r = new THREE.RenderTarget(RES, RES, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    r.texture.wrapS = r.texture.wrapT = THREE.RepeatWrapping;
    r.texture.generateMipmaps = true;
    r.texture.minFilter = THREE.LinearMipmapLinearFilter;
    r.texture.anisotropy = 4;
    return r;
  };
  const gradRT = rt(), hessRT = rt();
  const sum = (part) => Fn(() => {
    const p = uv().mul(TILE);
    let h = float(0), hx = float(0), hz = float(0), hxx = float(0), hzz = float(0), hxz = float(0);
    for (const w of waves) {
      const ph = p.x.mul(w.kx).add(p.y.mul(w.kz)).sub(time.mul(w.w)).add(w.ph);
      const s = sin(ph), c = cos(ph);
      if (part === 'grad') { h = h.add(s.mul(w.a)); hx = hx.add(c.mul(w.a * w.kx)); hz = hz.add(c.mul(w.a * w.kz)); }
      else { const m = s.mul(-w.a); hxx = hxx.add(m.mul(w.kx * w.kx)); hzz = hzz.add(m.mul(w.kz * w.kz)); hxz = hxz.add(m.mul(w.kx * w.kz)); }
    }
    return part === 'grad' ? vec4(hx, hz, hx.mul(hx).add(hz.mul(hz)), h) : vec4(hxx, hzz, hxz, 0);
  })();
  const mk = part => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = sum(part); m.fog = false; m.toneMapped = false; return new THREE.QuadMesh(m); };
  const gradQ = mk('grad'), hessQ = mk('hess');

  function update(t) {
    time.value = t;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(gradRT); gradQ.render(renderer);
    if (cfg.hess !== false) { renderer.setRenderTarget(hessRT); hessQ.render(renderer); }
    renderer.setRenderTarget(prev);
  }

  // ---- sampling, in world xz (metres; scene z = -north). `amp` scales the field (wind), `bias` is a mip bias.
  // returns { g: vec2 gradient, H: vec3 (hxx, hzz, hxz), v: unresolved slope variance }
  const gT = texture(gradRT.texture), hT = texture(hessRT.texture);
  function sample(xz, amp, opts = {}) {
    let g = vec2(0), H = vec3(0), v = float(0);
    for (const c of COPIES) {
      const co = Math.cos(c.rot), si = Math.sin(c.rot);
      // tile coordinates of the copy: p = R xz / s
      const px = xz.x.mul(co).sub(xz.y.mul(si)).div(c.s), pz = xz.x.mul(si).add(xz.y.mul(co)).div(c.s);
      const tuv = vec2(px, pz).div(TILE);
      let G = gT.sample(tuv), Hs = opts.hess === false ? null : hT.sample(tuv);
      if (opts.level !== undefined) { G = G.level(opts.level); if (Hs) Hs = Hs.level(opts.level); }
      // back to world: grad = w R^T gt (the copy's amplitude scales with s, so slopes keep their size);
      // H = (w / s) R^T Ht R
      const gx = G.x, gz = G.y;
      g = g.add(vec2(gx.mul(co).add(gz.mul(si)), gx.mul(-si).add(gz.mul(co))).mul(c.w));
      v = v.add(G.z.sub(gx.mul(gx)).sub(gz.mul(gz)).max(0).mul(c.w * c.w));
      if (Hs) {
        const a = Hs.x, b = Hs.y, e = Hs.z, k = c.w / c.s;
        // R^T [[a, e], [e, b]] R with R = [[co, -si], [si, co]]
        const hxx = a.mul(co * co).add(b.mul(si * si)).add(e.mul(2 * co * si));
        const hzz = a.mul(si * si).add(b.mul(co * co)).sub(e.mul(2 * co * si));
        const hxz = a.mul(-co * si).add(b.mul(co * si)).add(e.mul(co * co - si * si));
        H = H.add(vec3(hxx, hzz, hxz).mul(k));
      }
    }
    return { g: g.mul(amp), H: H.mul(amp), v: v.mul(amp.mul(amp)) };
  }
  return { update, sample, waves, gradRT, hessRT, TILE, RES, COPIES, time };
}
