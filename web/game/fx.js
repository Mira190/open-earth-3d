// What the calendar puts in the sky: fireworks over an event's place while it is on (life.json
// events with "fx": "fireworks", and "fx_at" where the shells burst if not over the event itself).
// One Points cloud of a fixed size, additive, drawn only while an event with fireworks is on:
// shells go up every second or so, burst into a sphere of sparks that fall and fade. Nothing is
// allocated after the first shell, and nothing runs when no such event is on.
'use strict';
window.OEFx = (function () {
  const SHELLS = 10, SPARKS = 110, N = SHELLS * SPARKS;
  const PALETTE = [[1, 0.78, 0.42], [1, 0.42, 0.36], [0.55, 0.8, 1], [0.7, 1, 0.62], [1, 0.62, 0.9], [1, 0.95, 0.8]];
  function create(L) {
    const ctx = L.ctx;
    let pts = null, pos, col, vel, life, born, next = 0, shell = 0, seed = 7, on = null, acc = 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    function build() {
      const g = new THREE.BufferGeometry();
      pos = new Float32Array(N * 3); col = new Float32Array(N * 3); vel = new Float32Array(N * 3); life = new Float32Array(N); born = new Float32Array(N * 3);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: 5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
      pts = new THREE.Points(g, m);
      pts.frustumCulled = false; pts.renderOrder = 9;
      ctx.world.add(pts);
    }
    function launch(e) {
      const at = e.fx_at || e.at, s = (shell++ % SHELLS) * SPARKS, c = PALETTE[Math.floor(rnd() * PALETTE.length)];
      const x = at[0] + (rnd() - 0.5) * 140, y = at[1] + (rnd() - 0.5) * 140, z = (at[2] != null ? at[2] : ctx.ground(at[0], at[1])) + 130 + rnd() * 110, sp = 22 + rnd() * 16;
      const w = ctx.W(x, y, z);
      for (let i = 0; i < SPARKS; i++) {
        const k = s + i, u = rnd() * 2 - 1, a = rnd() * 6.2832, r = Math.sqrt(1 - u * u), v = sp * (0.82 + rnd() * 0.18);
        pos[k * 3] = w.x; pos[k * 3 + 1] = w.y; pos[k * 3 + 2] = w.z;
        vel[k * 3] = r * Math.cos(a) * v; vel[k * 3 + 1] = u * v; vel[k * 3 + 2] = r * Math.sin(a) * v;
        born[k * 3] = c[0]; born[k * 3 + 1] = c[1]; born[k * 3 + 2] = c[2];
        life[k] = 1.9 + rnd() * 0.7;
      }
      if (ctx.A.thump && rnd() < 0.5) ctx.A.thump();
    }
    function tick(dt, paused, titled) {
      if ((acc += dt) >= 1) { acc = 0; on = titled ? null : L.day.today().find(e => e.fx === 'fireworks' && e.at && L.day.onNow(e)) || null; }
      if (!on && !pts) return;
      if (on && !pts) build();
      if (on && !paused && (next -= dt) <= 0) { next = 0.5 + rnd() * 1.1; launch(on); }
      let alive = 0;
      for (let k = 0; k < N; k++) {
        if (life[k] <= 0) continue;
        life[k] -= dt; alive++;
        const d = Math.exp(-1.1 * dt), f = Math.max(0, Math.min(1, life[k] / 1.2));
        vel[k * 3] *= d; vel[k * 3 + 1] = vel[k * 3 + 1] * d - 6 * dt; vel[k * 3 + 2] *= d;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        col[k * 3] = born[k * 3] * f * 2.4; col[k * 3 + 1] = born[k * 3 + 1] * f * 2.4; col[k * 3 + 2] = born[k * 3 + 2] * f * 2.4;
      }
      pts.visible = alive > 0;
      if (alive) { pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; }
    }
    L.use({ tick });
    L.fx = { get on() { return on; }, alive: () => (life ? life.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) : 0) };
    return L.fx;
  }
  return { create };
})();
