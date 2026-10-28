// The sea surface on the CPU: the same Gerstner swell and chop as ocean.js (the displacement bands of
// env.waves), so a hull sampled here sits on the water the renderer draws. A vertex of the mesh at grid
// position p is drawn at p - D(p), so to read the surface at a world point X we invert that with a few
// fixed-point steps (Q = 0.85 < 1, so it converges quickly).
import { sstep } from './kit.js';

export function makeSurface(ctx) {
  const env = ctx.env, u = env.u, camera = ctx.camera;
  const W = env.waves.filter(w => w.disp);
  const Q = 0.85;
  // scratch, so a frame of sampling allocates nothing
  const out = { h: 0, nx: 0, ny: 1, nz: 0 };
  let cx = 0, cz = 0;

  // x east, z scene (= -north). Writes into `o` ({h, nx, ny, nz}); h is absolute (includes the tide).
  function surfaceAt(x, z, t = u.time.value, o = out, ripples = false) {
    const wind = u.wind.value, tide = u.tide.value;
    let gx = x, gz = z, depth = 20;
    for (let it = 0; it < 3; it++) {
      depth = ctx.depth(gx, -gz);
      let dx = 0, dz = 0;
      const sh = 1 + 0.7 * (1 - sstep(0.6, 6, depth)), gate = sstep(0, 0.7, depth);
      const dist = Math.hypot(gx - cx, gz - cz);
      for (const w of W) {
        const fade = Math.max(0, Math.min(1, 1 - dist / (w.lam * 1400)));
        const amp = w.a * sh * gate * wind * fade;
        const c = Math.cos(gx * w.dx * w.k + gz * w.dz * w.k - t * w.w + w.ph);
        const qa = amp * Q;
        dx += qa * c * w.dx; dz += qa * c * w.dz;
      }
      gx = x + dx; gz = z + dz;
    }
    depth = ctx.depth(gx, -gz);
    const sh = 1 + 0.7 * (1 - sstep(0.6, 6, depth)), gate = sstep(0, 0.7, depth);
    const dist = Math.hypot(gx - cx, gz - cz);
    let dy = 0, hx = 0, hz = 0;
    for (const w of W) {
      const fade = Math.max(0, Math.min(1, 1 - dist / (w.lam * 1400)));
      const amp = w.a * sh * gate * wind * fade;
      const ph = gx * w.dx * w.k + gz * w.dz * w.k - t * w.w + w.ph;
      dy += amp * Math.sin(ph);
      const c = amp * w.k * Math.cos(ph);
      hx += c * w.dx; hz += c * w.dz;
    }
    const l = Math.hypot(hx, 1, hz);
    o.h = tide + dy; o.nx = -hx / l; o.ny = 1 / l; o.nz = -hz / l;
    return o;
  }
  // cheaper: height only, no inversion (used for ribbons and far-away vessels, error is a few cm)
  function heightAt(x, z, t = u.time.value, minLam = 0) {
    const wind = u.wind.value;
    let dy = 0;
    for (const w of W) { if (w.lam < minLam) continue; dy += w.a * wind * Math.sin(x * w.dx * w.k + z * w.dz * w.k - t * w.w + w.ph); }
    return u.tide.value + dy;
  }
  const update = () => { cx = camera.position.x; cz = camera.position.z; };
  return { surfaceAt, heightAt, update };
}
