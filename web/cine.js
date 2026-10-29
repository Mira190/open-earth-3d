// Camera moves shared by the model viewer (city.js) and the game (game/game.js):
// the establishing shot when a city opens, orbits around whatever you pick, the
// crane down from the title shot into play, the hop over the city for fast travel
// and the panorama at a trig station. A shot maps progress k (0..1) to a camera
// pose {pos, look} in three.js coordinates. The director plays one shot at a time
// on the caller's clock; cues fire as k passes them, and skipping a shot fires the
// cues it had left, so a shot that moves the player still moves them when skipped.
// Bearings are compass bearings (radians, clockwise from north) of the camera as
// seen from the centre, in the local frame (x east, y north), drawn at (x, z, -y).
'use strict';
window.OECine = (function () {
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    linear: t => t,
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    smooth: t => t * t * t * (t * (6 * t - 15) + 10),
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
  };
  // k remapped to the stretch [a, b] of a shot, clamped
  const span = (k, a, b) => clamp01((k - a) / (b - a));
  // the short way from bearing a to bearing b
  const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // a point on the cylinder around c: bearing az, horizontal distance dist, height h above c
  function around(c, az, dist, h, out = new THREE.Vector3()) {
    return out.set(c.x + Math.sin(az) * dist, c.y + h, c.z - Math.cos(az) * dist);
  }
  // bearing, horizontal distance and height of pos seen from c
  function polar(c, pos) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    return { az: Math.atan2(dx, -dz), dist: Math.hypot(dx, dz), h: pos.y - c.y };
  }

  // A spiral around a centre that may move. Each of az, dist and h is a number or
  // [from, to]; e names the easing per channel. look defaults to the centre.
  function spiral({ center, az, dist, h, look = null, e = {} }) {
    const fn = v => (typeof v === 'function' ? v : () => v);
    const C = fn(center), L = look && fn(look);
    const ch = (v, k, name, def) => (Array.isArray(v) ? lerp(v[0], v[1], ease[e[name] || def](k)) : v);
    const pos = new THREE.Vector3(), lk = new THREE.Vector3();
    return k => {
      const c = C(k);
      around(c, ch(az, k, 'az', 'inOut'), ch(dist, k, 'dist', 'inOut'), ch(h, k, 'h', 'inOut'), pos);
      lk.copy(L ? L(k) : c);
      return { pos, look: lk };
    };
  }

  // shot a, handing over to shot b while w(k) goes from 0 to 1
  function mix(a, b, w) {
    const pos = new THREE.Vector3(), lk = new THREE.Vector3();
    return k => {
      const p = a(k), pa = p.pos.clone(), la = p.look.clone(), q = b(k), t = w(k);
      pos.lerpVectors(pa, q.pos, t);
      lk.lerpVectors(la, q.look, t);
      return { pos, look: lk };
    };
  }

  // one shot at a time on the caller's clock (seconds); with reduced motion every
  // shot is a cut to its last frame
  function director({ reduced = false } = {}) {
    let cur = null, pending = null;
    const fire = (c, upto) => { while (c.cues.length && c.cues[0][0] <= upto) c.cues.shift()[1](); };
    const d = {
      play(shot, dur, { onEnd = null, cues = [], label = '' } = {}) {
        if (cur) d.skip();
        pending = null;
        cur = { shot, dur: reduced ? 0 : dur, t0: null, k: 0, onEnd, label, cues: cues.slice().sort((a, b) => a[0] - b[0]) };
        return d;
      },
      // this frame's pose, or null when no shot is playing (a skipped shot's last pose comes once more)
      step(t) {
        if (!cur) { const p = pending; pending = null; return p; }
        const c = cur;
        if (c.t0 == null) c.t0 = t;
        c.k = c.dur > 0 ? clamp01((t - c.t0) / c.dur) : 1;
        fire(c, c.k);
        const pose = c.shot(c.k);
        if (c.k >= 1 && cur === c) { cur = null; if (c.onEnd) c.onEnd(false); }
        return pose;
      },
      // jump to the end: remaining cues fire, then onEnd(true); the next step() returns the last pose
      skip() {
        if (!cur) return null;
        const c = cur;
        cur = null;
        fire(c, 1);
        const p = c.shot(1);
        pending = { pos: p.pos.clone(), look: p.look.clone() };
        if (c.onEnd) c.onEnd(true);
        return pending;
      },
      stop() { cur = null; pending = null; },
      get active() { return !!cur; },
      get label() { return cur ? cur.label : ''; },
      get k() { return cur ? cur.k : 1; },
    };
    return d;
  }

  return { ease, span, turn, lerp, around, polar, spiral, mix, director };
})();
