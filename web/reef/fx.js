// Particles for the player: regulator bubbles that rise and swell as the pressure falls, and spray
// from wading, kicking and clearing the snorkel. Plain CPU pools drawn as two InstancedMeshes
// (one draw call each); the scene's fogNode tints them like everything else in the water.
import * as THREE from 'three/webgpu';

export function createFx(ctx) {
  const { scene } = ctx;
  const dummy = new THREE.Object3D();
  const mk = (geo, color, opacity, max, fog = true) => {
    const m = new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity, depthWrite: false });
    m.fog = fog;
    const im = new THREE.InstancedMesh(geo, m, max);
    im.frustumCulled = false; im.count = 0; im.renderOrder = 20;
    scene.add(im);
    return im;
  };
  const BUB = 260, SPL = 200;
  const bubMesh = mk(new THREE.IcosahedronGeometry(1, 1), 0xbfe9f5, 0.5, BUB, false)   // bubbles flash the sun back: left out of the water's dimming so they stay readable;
  const splMesh = mk(new THREE.IcosahedronGeometry(1, 0), 0xf4fbff, 0.8, SPL);
  const bub = [], spl = [];
  let tNow = 0;

  // a puff of bubbles at `p`; r is the size in metres at the surface pressure
  function bubbles(p, n = 8, r = 0.03, spread = 0.05) {
    for (let i = 0; i < n && bub.length < BUB; i++) {
      bub.push({ x: p.x + (Math.random() - 0.5) * spread, y: p.y + Math.random() * spread, z: p.z + (Math.random() - 0.5) * spread,
        r0: r * (0.5 + Math.random() * 0.9), vy: 0.22 + Math.random() * 0.18, ph: Math.random() * 6.28, delay: Math.random() * 0.5, amb0: Math.max(1, 1 + (ctx.env.u.tide.value - p.y) / 10) });
    }
  }
  // droplets thrown up from `p` (at the water surface); speed in m/s
  function splash(p, n = 6, speed = 1.6, up = 1.0) {
    for (let i = 0; i < n && spl.length < SPL; i++) {
      const a = Math.random() * 6.28, s = speed * (0.3 + Math.random() * 0.7);
      spl.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s * 0.6, vy: (0.6 + Math.random()) * up * speed * 0.8, vz: Math.sin(a) * s * 0.6, r: 0.012 + Math.random() * 0.02, life: 0.5 + Math.random() * 0.4 });
    }
  }
  function update(dt, surfaceAt) {
    tNow += dt;
    let k = 0;
    for (let i = bub.length - 1; i >= 0; i--) {
      const b = bub[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.y += b.vy * dt;
      b.x += Math.sin(tNow * 3.1 + b.ph) * 0.05 * dt; b.z += Math.cos(tNow * 2.7 + b.ph) * 0.05 * dt;
      const surf = surfaceAt(b.x, b.z);
      if (b.y >= surf - 0.02) { bub.splice(i, 1); continue; }
    }
    for (const b of bub) {
      if (b.delay > 0) continue;
      const amb = 1 + Math.max(ctx.env.u.tide.value - b.y, 0) / 10;
      const r = b.r0 * Math.cbrt(b.amb0 / amb) * 1.4;                    // Boyle: the bubble swells as it rises (exaggerated a little for the eye)
      dummy.position.set(b.x, b.y, b.z); dummy.scale.setScalar(r); dummy.updateMatrix();
      bubMesh.setMatrixAt(k++, dummy.matrix);
    }
    bubMesh.count = k; bubMesh.instanceMatrix.needsUpdate = true;
    k = 0;
    for (let i = spl.length - 1; i >= 0; i--) {
      const s = spl[i];
      s.life -= dt; s.vy -= 9.8 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.life <= 0 || s.y < surfaceAt(s.x, s.z) - 0.05 && s.vy < 0) { spl.splice(i, 1); continue; }
      dummy.position.set(s.x, s.y, s.z); dummy.scale.setScalar(s.r * Math.min(1, s.life * 3)); dummy.updateMatrix();
      splMesh.setMatrixAt(k++, dummy.matrix);
    }
    splMesh.count = k; splMesh.instanceMatrix.needsUpdate = true;
  }
  return { bubbles, splash, update, get bubbleCount() { return bub.length; }, get splashCount() { return spl.length; }, meshes: [bubMesh, splMesh] };
}
