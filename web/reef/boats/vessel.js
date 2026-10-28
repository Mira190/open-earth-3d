// A vessel in the world: pose, buoyancy on the CPU wave field, sails that follow the wind, wake trails, and
// the AI that follows a route. The local frame of the model: +X bow, +Y up, +Z starboard (see vessels.js).
// World: x east, z = -north (three.js); `hdg` is the compass heading in radians (0 = north, clockwise).
import * as THREE from 'three/webgpu';
import { Trail } from './wake.js';
import { sstep } from './kit.js';

const TAU = Math.PI * 2;
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angDiff = (a, b) => wrap(a - b);
const damp = (cur, tgt, dt, tau) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));

const TAUS = { tinnie: 0.18, yacht: 0.35, cat: 0.5, daycat: 0.7, seaplane: 0.3, pontoon: 1.2, helipad: 1.0, mooring: 0.12, jetty: 1 };
const SPECS = {   // max speed (m/s), turn rate (rad/s), acceleration (m/s^2), trail life and width
  yacht: { vmax: 3.9, turn: 0.35, acc: 0.35, life: 14 }, cat: { vmax: 4.8, turn: 0.3, acc: 0.4, life: 14 },
  daycat: { vmax: 15, turn: 0.22, acc: 0.9, life: 26 }, tinnie: { vmax: 16, turn: 0.9, acc: 3.2, life: 18 }, seaplane: { vmax: 28, turn: 0.35, acc: 1.5, life: 20 }
};

export class Vessel {
  constructor(api, id, name, desc, o = {}) {
    this.api = api; this.id = id; this.name = name; this.desc = desc; this.kind = desc.kind;
    this.root = new THREE.Group(); this.root.rotation.order = 'YZX'; this.root.add(desc.group);
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.hdg = o.hdg ?? 0; this.speed = 0; this.vy = 0;
    this.mode = o.mode ?? 'anchored';         // anchored | docked | static | ai | player | flying
    this.pitch = 0; this.roll = 0; this.y = api.surf.heightAt(this.x, this.z, undefined, 0); this.tau = TAUS[this.kind] ?? 0.4;
    this.spec = { ...(SPECS[this.kind] || SPECS.yacht), ...(o.spec || {}) };
    this.swing = o.swing ?? 0; this.phase = Math.random() * 6;
    this.ai = null; this.sail = { want: 'furled', furl: 1, raise: 0.05, boom: 0, jib: 0, heel: 0, bill: 0.3 };
    this.keepOut = o.keepOut ?? false;
    this.pts = (desc.buoy && desc.buoy.length ? desc.buoy : desc.float?.pts || [[0, 0]]);
    this.k = desc.float?.k ?? 1;               // how much of the swell a floating platform follows
    this.air = 0;                              // flight state: altitude above the water
    this.trails = [];
    if (desc.trails) {
      const sp = this.spec;
      for (const [tx, tz, w] of desc.trails) { const tr = new Trail(api.surf, { life: sp.life, w0: w, spread: 0.3, max: 150 }); tr.origin = [tx, tz]; this.trails.push(tr); api.scene.add(tr.mesh); }
      if (['tinnie', 'daycat', 'yacht', 'cat'].includes(this.kind)) {
        const bow = new Trail(api.surf, { life: 3.2, w0: 0.25, spread: 0.7, max: 40, minSpeed: this.kind === 'tinnie' ? 3 : this.kind === 'daycat' ? 5 : 99, spd: 9 });
        bow.origin = [desc.L * 0.42, 0]; bow.isBow = true; this.trails.push(bow); api.scene.add(bow.mesh);
      }
    }
    this.root.userData.vessel = this;
    this.place();
  }

  place() {
    const r = this.root;
    r.position.set(this.x, this.y, this.z);
    r.rotation.set(this.roll, Math.PI / 2 - this.hdg, this.pitch);
  }
  fwd() { return [Math.sin(this.hdg), Math.cos(this.hdg)]; }        // (east, north)
  // local (lx, lz) -> world scene (x, z)
  toWorld(lx, lz, out = [0, 0]) {
    const c = Math.cos(this.hdg), s = Math.sin(this.hdg);
    // forward = (east s, north c) = scene (s, -c); starboard = (east c, north -s) = scene (c, s)
    out[0] = this.x + lx * s + lz * c; out[1] = this.z - lx * c + lz * s; return out;
  }

  // heave, pitch and roll from the wave field: a least-squares plane through the surface under the sample points
  buoyancy(dt, near) {
    const surf = this.api.surf, t = this.api.env.u.time.value;
    if (this.kind === 'mooring' || !near) {
      const h = surf.heightAt(this.x, this.z, t, 4);
      this.y = damp(this.y, h, dt, this.tau); return;
    }
    const pts = this.pts, n = pts.length, w = [0, 0];
    let mx = 0, mz = 0, mh = 0; const hs = new Array(n);
    for (let i = 0; i < n; i++) {
      this.toWorld(pts[i][0], pts[i][1], w);
      hs[i] = surf.surfaceAt(w[0], w[1], t).h;
      mx += pts[i][0]; mz += pts[i][1]; mh += hs[i];
    }
    mx /= n; mz /= n; mh /= n;
    let sxx = 1e-6, sxh = 0, szz = 1e-6, szh = 0;
    for (let i = 0; i < n; i++) { const a = pts[i][0] - mx, b = pts[i][1] - mz, h = hs[i] - mh; sxx += a * a; sxh += a * h; szz += b * b; szh += b * h; }
    const k = this.k, tide = this.api.env.u.tide.value;
    let pitchT = Math.atan(sxh / sxx) * k, rollT = -Math.atan(szh / szz) * k;
    const yT = tide + (mh - tide) * k;
    // planing hulls lift and trim bow-up with speed
    const plane = this.desc.planing ? sstep(3, 9, this.speed) : 0;
    const lift = plane * 0.22 + (this.kind === 'daycat' ? sstep(4, 14, this.speed) * 0.22 : 0);
    pitchT += plane * 0.07 + (this.kind === 'daycat' ? sstep(5, 14, this.speed) * 0.025 : 0);
    // sails heel the boat to leeward
    rollT += this.sail.heel;
    // the filtered heave keeps a boat from snapping with every ripple; heavier hulls respond slower
    this.y = damp(this.y, yT + lift, dt, this.tau);
    this.pitch = damp(this.pitch, pitchT, dt, this.tau * 1.3);
    this.roll = damp(this.roll, rollT, dt, this.tau * 1.3);
  }

  // ---- sails ----
  snapSails() { const S = this.sail; S.furl = S.want === 'sail' ? 0 : 1; S.raise = S.want === 'furled' ? 0.05 : 1; }
  setSails(want) { this.sail.want = want; }   // 'sail' | 'motor' | 'furled'
  rig(dt, wind) {
    const R = this.desc.rig; if (!R) return;
    const S = this.sail, spd = this.speed;
    const tgtFurl = S.want === 'sail' ? 0 : 1, tgtRaise = S.want === 'furled' ? 0.05 : 1;
    S.furl = damp(S.furl, tgtFurl, dt, 3.2) + 0; S.raise = damp(S.raise, tgtRaise, dt, 5.0);
    // apparent wind: wind velocity (toward) minus boat velocity, in (east, north)
    const hx = Math.sin(this.hdg), hy = Math.cos(this.hdg);
    const vx = wind.vx - spd * hx, vy = wind.vy - spd * hy;
    const aws = Math.hypot(vx, vy) + 1e-6;
    const rf = (vx * hx + vy * hy), rs = (vx * hy - vy * hx);   // rs > 0: wind blowing toward starboard (from port)
    const awa = Math.acos(Math.max(-1, Math.min(1, -rf / aws)));  // 0 = on the nose, pi = dead astern
    const lee = rs >= 0 ? 1 : -1;
    const sailing = S.want === 'sail';
    const mag = Math.max(4, Math.min(82, (awa * 57.3 - 18) * 0.62 + 5)) * Math.PI / 180;
    const mainA = (sailing ? mag : 6 * Math.PI / 180);
    S.boom = damp(S.boom, lee * mainA, dt, 1.2);
    S.jib = damp(S.jib, lee * Math.min(1.45, mag * 1.25), dt, 1.2);
    R.main.pivot.rotation.y = S.boom;
    R.main.uni.raise.value = S.raise; R.main.uni.furl.value = 0;
    R.main.uni.side.value = Math.sign(S.boom) || 1;
    R.main.uni.bill.value = (sailing ? 0.55 + 0.3 * Math.min(1, aws / 10) : 0.12) * (S.raise > 0.5 ? 1 : 0.3);
    const g = R.genoa;
    if (g.sgn === undefined) g.sgn = Math.sign(g.clew.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(g.axis, 0.3)).z) || 1;
    g.pivot.quaternion.setFromAxisAngle(g.axis, S.jib * g.sgn);
    g.uni.furl.value = S.furl; g.uni.raise.value = 1;
    g.uni.side.value = Math.sign(S.jib) || 1;
    g.uni.bill.value = sailing ? 0.6 + 0.3 * Math.min(1, aws / 10) : 0.1;
    const heelT = sailing && S.furl < 0.5 ? lee * Math.min(0.32, 0.0025 * aws * aws * Math.sin(Math.min(awa, 2.4)) + 0.02) : 0;
    S.heel = damp(S.heel, heelT, dt, 1.6);
  }

  // ---- AI route following ----
  setRoute(pts, o = {}) {
    // pts: [[x, north]..]; o.loop 'pingpong' | 'repeat' | false; o.dwell: seconds at the end; o.sail: allow sailing
    this.ai = { pts, i: Math.min(1, pts.length - 1), dir: 1, loop: o.loop ?? 'pingpong', dwell: o.dwell ?? 20, wait: 0, vmax: o.vmax ?? this.spec.vmax, canSail: o.sail ?? (this.kind === 'yacht' || this.kind === 'cat'), hide: o.hide ?? false, hdgEnd: o.hdgEnd };
    this.mode = 'ai';
  }
  aiStep(dt, wind) {
    const a = this.ai; if (!a) return;
    if (a.wait > 0) {
      a.wait -= dt; this.speed = damp(this.speed, 0, dt, 2.0);
      if (a.hide) this.root.visible = a.wait <= 0 ? true : false;
      if (a.wait > 0) { this.drift(dt); this.setSails('furled'); return; }
    }
    const p = a.pts[a.i], dx = p[0] - this.x, dn = p[1] + this.z, dist = Math.hypot(dx, dn);   // north = -z
    const last = (a.dir > 0 && a.i === a.pts.length - 1) || (a.dir < 0 && a.i === 0);
    const want = Math.atan2(dx, dn);
    const dh = angDiff(want, this.hdg), maxT = this.spec.turn;
    this.hdg += Math.max(-maxT * dt, Math.min(maxT * dt, dh * 1.5));
    // wind: can the boat sail this heading? Not within ~42 deg of the wind.
    const twa = Math.abs(angDiff(this.hdg, wind.from));       // 0 = heading into the wind
    let vTarget = a.vmax;
    this.sailMode = 'motor';
    if (a.canSail && twa > 0.75) { // under sail
      const pol = 0.55 + 0.45 * Math.sin(Math.min(Math.PI, (twa - 0.5) * 0.95)) ;
      vTarget = Math.min(a.vmax, wind.speed * 0.46 * pol + 0.3); this.sailMode = 'sail';
    } else if (a.canSail) vTarget = Math.min(a.vmax, 2.9);
    // slow for the corner and the stop
    const turnSlow = 1 - 0.55 * Math.min(1, Math.abs(dh) / 1.2);
    vTarget *= turnSlow;
    if (last) vTarget = Math.min(vTarget, 0.25 + dist * 0.08);
    this.speed += Math.max(-this.spec.acc * dt * 2, Math.min(this.spec.acc * dt, vTarget - this.speed));
    const [fx, fy] = this.fwd();
    this.x += fx * this.speed * dt; this.z -= fy * this.speed * dt;
    if (this.sailMode === 'sail' && this.speed > 1) this.setSails('sail'); else if (this.sailMode === 'motor' && a.canSail) this.setSails('motor');
    if (this.kind === 'tinnie' || this.kind === 'daycat') this.setSails('furled');
    const reach = last ? Math.max(6, this.desc.L * 0.5) : 55;
    if (dist < reach) {
      if (last) {
        if (a.loop === 'pingpong') { a.dir = -a.dir; a.i += a.dir; a.wait = a.dwell; }
        else if (a.loop === 'repeat') { a.i = 0; a.wait = a.dwell; if (a.hide) { const q = a.pts[0]; this.x = q[0]; this.z = -q[1]; } }
        else { this.mode = 'anchored'; this.ai = null; }
      } else a.i += a.dir;
    }
  }
  drift(dt) { const [fx, fy] = this.fwd(); this.x += fx * this.speed * dt; this.z -= fy * this.speed * dt; }

  // anchored boats lie to the wind and swing a little
  anchorStep(dt, wind, t) {
    const tgt = wind.from + this.swing + Math.sin(t * 0.09 + this.phase) * 0.22;
    this.hdg += angDiff(tgt, this.hdg) * Math.min(1, dt * 0.35);
    this.speed = 0;
    this.setSails('furled');
  }

  // ---- wake: ribbons behind the hulls; the field gets a stamp at the bow, the hull and the stern ----
  wake(dt, t, near, field) {
    const w = [0, 0];
    for (const tr of this.trails) {
      this.toWorld(tr.origin[0], tr.origin[1], w);
      tr.push(w[0], w[1], this.speed, t);
      tr.rebuild(t, near);
    }
    if (near && this.speed > 0.8 && field) {
      const sp = Math.min(1, this.speed / 8), L = this.desc.L, B = Math.min(this.desc.B, 6);
      const hulls = this.desc.trails.length ? this.desc.trails.map(p => p[1]) : [0];
      for (const hz of hulls) {
        this.toWorld(L * 0.42, hz, w); field.stamp(w[0], w[1], 1.6 + B * 0.2, 0.05 * sp * dt * 30 * (this.kind === 'daycat' ? 2 : 1), 0.0, t);
        this.toWorld(0, hz, w); field.stamp(w[0], w[1], 1.2 + B * 0.18, -0.03 * sp * dt * 30, 0.1 * sp, t);
        this.toWorld(-L * 0.45, hz, w); field.stamp(w[0], w[1], 1.4 + B * 0.2, 0.05 * sp * dt * 30, 0.55 * sp + 0.1, t);
      }
    }
  }
  dispose() { this.api.scene.remove(this.root); for (const tr of this.trails) this.api.scene.remove(tr.mesh); }
}
