// Driving and flying. A controller is installed in ctx.controller (main.js then hands it the frame instead of free-fly)
// and the previous one is restored when it ends. Arcade handling: boats keep to depth > 2 m and are stopped softly by land;
// the seaplane takes off from the water; the helicopter lifts from a pad or ground and settles on one.
import * as THREE from 'three/webgpu';
import { angDiff } from './vessel.js';
import { sstep } from './kit.js';

const keys = new Set();
let hud = null;
function setHud(t) {
  if (!hud) { hud = document.createElement('div'); hud.id = 'boathud'; hud.style.cssText = 'position:fixed;right:16px;bottom:16px;padding:8px 12px;background:#04202ccc;border-radius:8px;color:#e8f1f4;font:13px/1.4 system-ui,sans-serif;max-width:44ch;text-align:right;white-space:pre-line;pointer-events:none'; document.body.appendChild(hud); }
  hud.style.display = t ? 'block' : 'none'; if (t) hud.textContent = t;
}
let wired = false;
function wire(target) {
  if (wired) return; wired = true;
  addEventListener('keydown', e => { keys.add(e.code); if (target.active && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (target.onKey) target.onKey(e.code); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('pointermove', e => { if (target.active && e.buttons) { target.orbit.yaw -= e.movementX * 0.005; target.orbit.pitch = Math.max(-0.2, Math.min(1.2, target.orbit.pitch + e.movementY * 0.004)); } });
}
const down = c => keys.has(c);
const kd = (a, b) => (down(a) ? 1 : 0) - (down(b) ? 1 : 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createControl(ctx, api) {
  const { THREE: _T, camera } = ctx, surf = api.surf;
  const st = { active: null, prev: null, orbit: { yaw: 0, pitch: 0 }, cam: new THREE.Vector3(), camInit: false, player: null, onKey: null };
  wire(st);

  function chase(v, dist, up, dt, lookUp = 1.5, lead = 0) {
    const h = v.hdg + st.orbit.yaw;
    const el = 0.28 + st.orbit.pitch * 0.5;
    const goal = new THREE.Vector3(v.x - Math.sin(h) * dist * Math.cos(el), v.y + up + dist * Math.sin(el), v.z + Math.cos(h) * dist * Math.cos(el));
    const sy = surf.heightAt(goal.x, goal.z, undefined, 3);
    goal.y = Math.max(goal.y, sy + 1.2);
    if (!st.camInit) { st.cam.copy(goal); st.camInit = true; }
    st.cam.lerp(goal, 1 - Math.exp(-dt / 0.18));
    camera.position.copy(st.cam);
    camera.lookAt(v.x + Math.sin(v.hdg) * lead, v.y + lookUp, v.z - Math.cos(v.hdg) * lead);
  }

  function begin(v, ctl, text, player) {
    if (st.active) end();
    st.prev = ctx.controller; st.player = player || null; st.camInit = false; st.orbit.yaw = 0; st.orbit.pitch = 0;
    st.active = { v, ctl };
    ctx.controller = { update: (dt, t) => ctl.update(dt, t), vessel: v };
    if (player) { player.boarded = v; if (player.group) player.group.visible = false; if (player.onBoard) player.onBoard(v); }
    setHud(text);
  }
  function end(ret) {
    if (!st.active) return false;
    const a = st.active, v = a.v;
    ctx.controller = st.prev; st.prev = null; st.active = null;
    const p = st.player; st.player = null;
    if (p) { if (p.group) p.group.visible = true; p.boarded = null; if (p.onLeave) p.onLeave(v); }
    setHud('');
    v.mode = a.ctl.after || 'anchored'; v.speed = Math.min(v.speed, 1);
    if (a.ctl.onEnd) a.ctl.onEnd();
    return true;
  }
  st.onKey = code => { if (code === 'KeyF' && st.active) end(); if (st.active && st.active.ctl.key) st.active.ctl.key(code); };

  // ---- boats ----
  function driveBoat(v, player) {
    const sp = v.spec, isYacht = v.kind === 'yacht' || v.kind === 'cat';
    const vMax = v.kind === 'tinnie' ? 15 : v.kind === 'daycat' ? 14 : 3.8;
    let thr = 0, useSail = false;
    v.mode = 'player'; v.ai = null;
    const ctl = {
      after: 'anchored',
      key(code) { if (isYacht && code === 'KeyR') { useSail = !useSail; v.setSails(useSail ? 'sail' : 'motor'); } if (code === 'Space') thr = 0; },
      update(dt, t) {
        const wind = api.wind();
        thr = clamp(thr + kd('KeyW', 'KeyS') * dt * 0.6 + kd('ArrowUp', 'ArrowDown') * dt * 0.6, -0.3, 1);
        let target = thr * vMax;
        if (useSail) {
          const twa = Math.abs(angDiff(v.hdg, wind.from));
          const pol = twa < 0.75 ? 0.1 : 0.55 + 0.45 * Math.sin(Math.min(Math.PI, (twa - 0.5) * 0.95));
          target = Math.min(vMax * 1.15, wind.speed * 0.46 * pol + 0.3);
        }
        v.speed += clamp(target - v.speed, -sp.acc * 2 * dt, sp.acc * dt);
        const steer = kd('KeyD', 'KeyA') + kd('ArrowRight', 'ArrowLeft');
        const eff = clamp(Math.abs(v.speed) / 2.5, 0.12, 1) * Math.sign(v.speed || 1);
        v.hdg += steer * sp.turn * 1.4 * eff * dt;
        // move, keeping to depth > 2 m: slide along the obstacle, lose speed
        const [fx, fy] = v.fwd(), s = v.speed * dt;
        const nx = v.x + fx * s, nz = v.z - fy * s;
        const D = (x, z) => ctx.depth(x, -z);
        const minD = 2.0 + v.desc.draft * 0.5;
        if (D(nx, nz) > minD && D(nx + fx * 8, nz - fy * 8) > minD * 0.6) { v.x = nx; v.z = nz; }
        else if (D(nx, v.z) > minD) { v.x = nx; v.speed *= 0.97; }
        else if (D(v.x, nz) > minD) { v.z = nz; v.speed *= 0.97; }
        else { v.speed *= 0.55; thr = Math.min(thr, 0); }
        v.sail.want = useSail ? 'sail' : v.sail.want;
        chase(v, v.desc.L * 2.0 + 6, v.desc.L * 0.22 + 2.5, dt, v.desc.L * 0.12 + 0.8, 4);
        setHud(`${v.name}\n${(v.speed * 1.944).toFixed(1)} kn · throttle ${(thr * 100) | 0}%` + (isYacht ? ` · ${useSail ? 'under sail' : 'engine'}` : '') + `\nW/S throttle · A/D steer · ${isYacht ? 'R sails · ' : ''}drag to look · F leave`);
      }
    };
    if (isYacht) v.setSails('motor');
    begin(v, ctl, '', player);
    return ctl;
  }

  // ---- seaplane ----
  function flySeaplane(v, player) {
    const P = { thr: 0, pitch: 0, bank: 0, alt: 0, vs: 0, vz: 0 };
    v.mode = 'player'; v.ai = null; v.air = v.air || 0;
    P.alt = v.air;
    const vr = 24, vStall = 19, vMax = 48;
    const ctl = {
      after: 'anchored',
      update(dt, t) {
        P.thr = clamp(P.thr + kd('KeyW', 'KeyS') * dt * 0.35, 0, 1);
        const pc = kd('ArrowDown', 'ArrowUp') + kd('Space', 'KeyC');        // + = nose up
        const roll = kd('KeyD', 'KeyA') + kd('ArrowRight', 'ArrowLeft');
        P.pitch += (pc * 0.38 - P.pitch) * Math.min(1, dt * 2.2);
        P.bank += (roll * 0.62 - P.bank) * Math.min(1, dt * 1.8);
        const air = P.alt > 0.6;
        // thrust vs drag: the floats' water drag falls away on the step
        const drag = air ? 0.0009 : 0.0016 + 0.02 / (1 + v.speed * 0.15);
        v.speed += ((P.thr * 4.2) - drag * v.speed * v.speed - (air ? 0.4 * Math.max(0, P.pitch) * v.speed * 0.1 : 0.15)) * dt;
        v.speed = clamp(v.speed, 0, vMax);
        // heading: rudder on the water, bank in the air
        if (air) v.hdg += (9.81 * Math.tan(P.bank) / Math.max(v.speed, 15)) * dt;
        else v.hdg += roll * 0.5 * clamp(v.speed / 6, 0.05, 1) * dt * (v.speed > 25 ? 0.4 : 1);
        // vertical: lift needs speed; the nose sets the climb
        const lift = sstep(vStall - 2, vr + 6, v.speed);
        let vs;
        if (!air && !(v.speed > vr && P.pitch > 0.12)) vs = 0;
        else vs = (P.pitch * 0.9 * lift * v.speed * 0.55 - (1 - lift) * 4.5) - (P.pitch < 0.02 ? 0.4 * (P.alt > 0 ? 1 : 0) : 0);
        if (air && lift > 0.99 && Math.abs(P.pitch) < 0.05) vs *= 0.2;
        P.vs += (vs - P.vs) * Math.min(1, dt * 2.5);
        P.alt += P.vs * dt;
        // movement; the terrain is solid
        const [fx, fy] = v.fwd();
        const nx = v.x + fx * v.speed * dt, nz = v.z - fy * v.speed * dt;
        const ground = Math.max(0, ctx.height(nx, -nz) - ctx.env.u.tide.value);   // height of the ground above the sea
        const floor = ground > 0.2 ? ground + 3.2 : 0;
        if (P.alt < floor) {
          if (ground > 0.2 && P.alt < ground + 0.5) { v.speed *= 0.6; P.vs = 0; P.alt = ground + 3.2; if (P.alt > 6 && !air) P.alt = ground + 3.2; }
          else { if (-P.vs > 6) { P.vs = -P.vs * 0.25; v.speed *= 0.85; } else if (P.vs < 0) P.vs = 0; P.alt = Math.max(floor, 0); }
        }
        if (ground > 0.2 && !air) { v.speed *= 0.3; } else { v.x = nx; v.z = nz; }
        if (ground > 0.2 && P.alt <= ground + 3.3 && v.speed > 0) { v.x = nx; v.z = nz; }
        v.air = P.alt;
        const wave = surf.surfaceAt(v.x, v.z, undefined);
        v.api.floatAir(v, dt, P.alt, P.pitch, P.bank, wave);
        if (v.desc.prop) { v.propRpm = 3 + P.thr * 70; v.desc.prop.rotation.x += v.propRpm * dt; v.desc.prop.children[v.desc.prop.children.length - 1].visible = P.thr > 0.4; }
        chase(v, 30, 6.5, dt, 2.5, 14);
        const altTxt = P.alt > 0.6 ? `alt ${P.alt.toFixed(0)} m` : (v.speed > 1 ? 'taxiing' : 'afloat');
        setHud(`${v.name}\n${(v.speed * 1.944).toFixed(0)} kn · ${altTxt} · throttle ${(P.thr * 100) | 0}%\nW/S throttle · A/D bank/turn · Space/Down pull up · C/Up nose down\nrotate above ${(vr * 1.944).toFixed(0)} kn · land on the water · F leave (when afloat)`);
      },
      key(code) { if (code === 'KeyF' && P.alt > 1) { /* cannot leave in the air */ } },
      onEnd() { v.propRpm = 0; }
    };
    const origEnd = end;
    begin(v, ctl, '', player);
    ctl.canLeave = () => P.alt < 1.0 && v.speed < 6;
    return ctl;
  }

  // ---- helicopter ----
  function flyHeli(v, player) {
    const P = { alt: v.air || 0, fwd: 0, side: 0, vs: 0, yaw: 0, rpm: v.rpm || 0 };
    v.mode = 'player'; v.ai = null;
    const ctl = {
      after: 'static',
      update(dt, t) {
        // ground: the helipad (heaves with the sea), land, or never below 4 m over open water
        const g = api.groundUnder(v);
        const fwdT = kd('KeyW', 'KeyS') * (kd('KeyW', 'KeyS') > 0 ? 28 : 8) + (down('ShiftLeft') && down('KeyW') ? 14 : 0);
        const strafeT = kd('KeyE', 'KeyQ') * 9;
        const climbT = kd('Space', 'KeyC') * 5;
        const yawT = kd('KeyD', 'KeyA') * 0.9;
        const landed = P.alt <= g.y + 0.02 && !g.water;
        const engineOn = down('KeyW') || down('KeyS') || down('Space') || P.alt > g.y + 0.05 || down('KeyE') || down('KeyQ');
        P.rpm += ((engineOn ? 1 : 0) - P.rpm) * Math.min(1, dt * 0.6);
        const power = sstep(0.55, 0.95, P.rpm);
        const f = landed && climbT <= 0 ? 0 : power;
        P.fwd += (fwdT * f - P.fwd) * Math.min(1, dt * 0.9); P.side += (strafeT * f - P.side) * Math.min(1, dt * 1.2);
        P.yaw += (yawT * f - P.yaw) * Math.min(1, dt * 2);
        P.vs += ((climbT * power) - P.vs) * Math.min(1, dt * 1.6);
        P.alt += P.vs * dt;
        const ground = g.y + (g.water ? 3.5 : 0);
        if (P.alt < ground) { P.alt = ground; if (P.vs < 0) P.vs = 0; }
        v.hdg += P.yaw * dt;
        const [fx, fy] = v.fwd(), sx = Math.cos(v.hdg), sz = Math.sin(v.hdg);
        let nx = v.x + (fx * P.fwd + sx * P.side) * dt, nz = v.z + (-fy * P.fwd + sz * P.side) * dt;
        v.x = nx; v.z = nz;
        v.air = P.alt; v.rpm = P.rpm;
        v.api.placeAir(v, P.alt, -P.fwd * 0.011 - (P.vs > 0 ? 0 : 0), P.side * 0.014 + P.yaw * 0.12);
        if (v.desc.prop) v.desc.prop.rotation.y += (P.rpm * 38) * dt;
        if (v.desc.tail) v.desc.tail.rotation.z += P.rpm * 50 * dt;
        chase(v, 22, 5, dt, 1.5, 6);
        const agl = P.alt - g.y;
        setHud(`${v.name}\n${(Math.hypot(P.fwd, P.side) * 1.944).toFixed(0)} kn · ${agl > 0.3 ? 'alt ' + P.alt.toFixed(0) + ' m' : 'landed'}\nW/S fwd/back · Q/E sideways · A/D yaw · Space/C up/down · Shift+W fast\nland on a pad or the shore · F leave (when landed)`);
      },
      onEnd() {}
    };
    begin(v, ctl, '', player);
    ctl.canLeave = () => P.alt < api.groundUnder(v).y + 0.4;
    return ctl;
  }
  // F while flying: only leave when safe
  const baseOnKey = st.onKey;
  st.onKey = code => {
    if (code === 'KeyF' && st.active && st.active.ctl.canLeave && !st.active.ctl.canLeave()) return;
    baseOnKey(code);
  };
  return { driveBoat, flySeaplane, flyHeli, end, state: st, chase, isActive: () => !!st.active };
}
