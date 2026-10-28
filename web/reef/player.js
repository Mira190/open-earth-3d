// The player: a person who can walk, wade, swim, snorkel, free-dive and scuba dive on the Whitsunday
// reef. A module for the reef viewer: `init(ctx)` sets ctx.controller (taking the camera from the
// default fly camera) and exposes ctx.player, ctx.people and ctx.hud for the game module.
//
// The state follows the water depth under the player (ctx.depth):
//   dry sand .. 0.15 m: walk / run        0.15 .. 1.35 m: wade (slower, spray)
//   deeper than ~1.35 m: swim at the surface (no gear), snorkel (mask on), freedive (duck-dive from
//   the surface, breath-hold to 10 m), scuba (BCD buoyancy, air, no-deco limit, safety stop).
// Controls: WASD/arrows move, mouse drag or click-to-lock looks, Shift run/fast, Space jump/up, Ctrl or C dive/down,
// E use, V view (third / shoulder / first), F and G add and vent BCD air, Q equalise, B clear the snorkel, H help, M sound.
// Touch: stick, drag to look, four buttons. Gamepad: sticks, A up, B or RT down, X use, Y view, LB/RB BCD.
// Query hooks for tests: autotest=1 (script every state, log "[test]" lines), player=1&x&y&z&yaw (place, z < 0 is under water),
// snorkel=1 | scuba=1 | equip=<gear>, dive=1, view=first|shoulder, cam=<heading>,<pitch>,<dist>, settle=<s>&hold=f,down,up,run
// (run the sim before the first frame), demo=npcs | crowd&n=, mute=1, nolock=1.
// Axes: local (east, north, up) is drawn at three.js (x, y, -z). Heading 0 = north, 90 = east.
import * as THREE from 'three/webgpu';
import * as P from './people.js';
import { createHud } from './hud.js';
import { createFx } from './fx.js';
import { Diver, BreathHold, Ears, waterTemp, ambient, ndlAt } from './dive.js';

const V3 = THREE.Vector3, clamp = THREE.MathUtils.clamp;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const SPAWN = { x: 505, north: 445, heading: 90 };
const WADE_FROM = 0.15, SWIM_ENTER = 1.35, SWIM_EXIT = 1.0, MAX_SLOPE = 0.95, FREEDIVE_MAX = 10, BODY_FLOAT = 0.15;

export async function init(ctx) {
  const { scene, camera, env, q } = ctx;
  const hud = createHud();
  { const h0 = document.getElementById('hud'); if (h0) Object.assign(h0.style, { left: 'auto', right: '12px', bottom: 'auto', top: '62px', fontSize: '11px', padding: '4px 8px', opacity: '.7', display: matchMedia('(pointer: coarse)').matches ? 'none' : '' }); }   // the viewer's debug line makes room for ours
  const fx = createFx(ctx);
  const msg = (kind, text) => hud.say(text, { kind: kind === 'info' ? '' : kind, secs: kind === 'bad' ? 7 : 5 });
  const diver = new Diver({ onEvent: msg });
  const breath = new BreathHold({ onEvent: msg });
  const ears = new Ears({ onEvent: msg });
  const whenMs = q.get('time') ? Date.parse(q.get('time')) : Date.now(), t0 = performance.now();
  const nowMs = () => ctx.clockMs ? ctx.clockMs() : whenMs + (performance.now() - t0);
  const season = P.stingerSeason(new Date(whenMs));

  // ------------------------------------------------------------ the sea surface, on the CPU
  // the same sum of swell and chop as ocean.js (ripples only bend normals), for bobbing and bubbles
  function surfaceAt(x, z) {
    const u = env.u, tide = u.tide.value, wind = u.wind.value, t = u.time.value;
    const depth = tide - ctx.height(x, -z);
    const shoal = 1 + 0.7 * sm(6, 0.6, depth), gate = sm(0, 0.7, depth);
    let y = 0;
    for (const w of env.waves) if (w.disp) y += w.a * shoal * gate * wind * Math.sin(x * w.dx * w.k + z * w.dz * w.k - t * w.w + w.ph);
    return tide + y;
  }

  // ------------------------------------------------------------ player state
  const S = {
    pos: new V3(), vel: new V3(), vy: 0, grounded: true, water: false, state: 'walk', dive: false,
    camYaw: THREE.MathUtils.degToRad(SPAWN.heading), camPitch: -0.12, bodyYaw: THREE.MathUtils.degToRad(SPAWN.heading), bodyPitch: 0,
    view: 'third', dist: 3.4, focus: new V3(), camSide: 1, speed: 0, kick: 0, stride: 0, dep: 0, depthBody: 0, surf: 0, floor: 0,
    gear: { mask: false, snorkel: false, fins: false, scuba: false }, bcd: { n: 0 }, breathT: 0, emergency: false, lastDeep: 0, step: 0, splashT: 0,
    virt: null, airborne: 0, time: 0, mouth: new V3(), dressKey: ''
  };
  const listeners = [];
  const setState = s => {
    if (s === S.state) return;
    const old = S.state; S.state = s;
    for (const cb of listeners) { try { cb(s, old, player); } catch (e) { console.error(e); } }
    if (s === 'snorkel') hud.hint('Hold Ctrl or C to duck-dive · release to float up · B blows the snorkel clear', 9);
    else if (s === 'scuba') hud.hint(S.depthBody < 1 ? 'G: let air out of the BCD to descend · F adds air · Q equalises your ears' : '', 9);
    else if (s === 'swim') hud.hint('Swimming. Equip a mask (E at the kit) to look at the reef below', 7);
    else if (s === 'wade') hud.hint('', 0);
  };

  // ------------------------------------------------------------ the character
  const look = P.makeLook('player', { gender: q.get('gender') || 'M', skin: q.get('skin') || undefined, hair: q.get('hair') || undefined, season });
  let rig = await P.createPerson(look);
  scene.add(rig.group);

  function outfit() {
    const g = S.gear;
    if (g.scuba) return { suit: { color: '#1d7f9f', top: '#1d7f9f', legs: '#14465e', legN: 2, arms: 2, torso: true }, sleeve: null };   // blue and teal read well at depth, where red goes black
    if (g.mask) return season ? { suit: { color: '#16324f', top: '#16324f', legs: '#16324f', legN: 2, arms: 2, torso: true }, sleeve: null } : { suit: { color: '#e4572e', top: '#e4572e', arms: 2, legN: 0, torso: true }, sleeve: null };
    return null;
  }
  const baseOutfit = { suit: look.suit, sleeve: look.sleeve };
  // what is shown depends on gear and where the player is: mask on the forehead on land, over the eyes in the water, fins only afloat
  function dress() {
    const g = S.gear, wet = S.water || S.dep > 0.5, maskDown = S.water || S.dep > 0.9;
    const key = [g.mask, g.snorkel, g.fins, g.scuba, wet, maskDown].join();
    if (key === S.dressKey) return;
    S.dressKey = key;
    const o = outfit() || baseOutfit;
    rig.setLook({ suit: o.suit, sleeve: o.sleeve });
    rig.show('hat', !g.mask && !g.scuba && !S.water && !!(look.accessories || []).find(a => a.type === 'hat'));
    rig.show('sunnies', !g.mask && !S.water && !!(look.accessories || []).find(a => a.type === 'sunnies' && a.show !== false));
    rig.show('mask', g.mask); if (g.mask && rig.acc.mask.userData.set) rig.acc.mask.userData.set(maskDown);
    rig.show('snorkel', g.snorkel && !g.scuba);
    rig.show('fins', g.fins && wet);
    for (const k of ['bcd', 'tank', 'regulator']) rig.show(k, g.scuba);
    if (rig.acc.thongs) rig.show('thongs', !g.fins || !wet);
  }

  // ------------------------------------------------------------ input
  const keys = new Set(), pressed = new Set();
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName);
  addEventListener('keydown', e => {
    if (typing(e)) return;
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    audio.unlock();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const canvas = ctx.renderer.domElement;
  let dragging = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; if (e.pointerType === 'mouse' && e.button === 0 && canvas.requestPointerLock && !q.get('nolock')) { try { canvas.requestPointerLock(); } catch (_) {} } audio.unlock(); });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', e => {
    if (touch.lookId === e.pointerId) { look2(e.movementX || e.clientX - touch.lx, e.movementY || e.clientY - touch.ly, 0.006); touch.lx = e.clientX; touch.ly = e.clientY; return; }
    if (document.pointerLockElement === canvas || (dragging && e.pointerType === 'mouse')) look2(e.movementX, e.movementY, 0.0024);
  });
  const look2 = (dx, dy, k) => { S.camYaw += dx * k; S.camPitch = clamp(S.camPitch - dy * k, -1.45, 1.25); };
  addEventListener('wheel', e => { S.dist = clamp(S.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.6, 9); }, { passive: true });

  // touch: a virtual stick on the left, drag the right half to look, four buttons
  const touch = { x: 0, y: 0, id: null, lookId: null, lx: 0, ly: 0, btn: new Set() };
  const isTouch = q.get('touch') === '1' || (matchMedia && matchMedia('(pointer: coarse)').matches);
  if (isTouch) {
    hud.touch(true);
    const st = hud.parts.stick, kn = hud.parts.knob;
    const setStick = e => { const r = st.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / 55, dy = (e.clientY - cy) / 55; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } touch.x = dx; touch.y = dy; kn.style.transform = `translate(${dx * 30}px,${dy * 30}px)`; };
    st.addEventListener('pointerdown', e => { touch.id = e.pointerId; st.setPointerCapture(e.pointerId); setStick(e); audio.unlock(); });
    st.addEventListener('pointermove', e => { if (touch.id === e.pointerId) setStick(e); });
    const end = e => { if (touch.id === e.pointerId) { touch.id = null; touch.x = touch.y = 0; kn.style.transform = ''; } };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.clientX > innerWidth * 0.4) { touch.lookId = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; } });
    addEventListener('pointerup', e => { if (touch.lookId === e.pointerId) touch.lookId = null; });
    hud.parts.btns.forEach(b => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', () => { touch.btn.add(k); pressed.add(k); b.classList.add('d'); });
      const up = () => { touch.btn.delete(k); b.classList.remove('d'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
  }
  // gamepad (optional): left stick moves, right stick looks, A up/jump, B or RT down, X use, Y view, LB/RB BCD
  const padState = { f: 0, r: 0, up: 0, down: 0, run: 0, inflate: 0, deflate: 0, prev: [] };
  function pollPad(dt) {
    const gp = (navigator.getGamepads && navigator.getGamepads() || []).find(g => g && g.connected);
    if (!gp) { padState.f = padState.r = padState.up = padState.down = padState.run = padState.inflate = padState.deflate = 0; return; }
    const dz = v => Math.abs(v) < 0.15 ? 0 : v;
    padState.r = dz(gp.axes[0]); padState.f = -dz(gp.axes[1]);
    look2(dz(gp.axes[2]) * dt * 900, dz(gp.axes[3]) * dt * 900, 0.0024);
    const b = i => gp.buttons[i] && gp.buttons[i].pressed;
    padState.up = b(0) ? 1 : 0; padState.down = (b(1) || b(7)) ? 1 : 0; padState.run = b(10) ? 1 : 0; padState.inflate = b(5) ? 1 : 0; padState.deflate = b(4) ? 1 : 0;
    [[2, 'KeyE'], [3, 'KeyV'], [6, 'KeyQ']].forEach(([i, k]) => { if (b(i) && !padState.prev[i]) pressed.add(k); padState.prev[i] = b(i); });
  }
  function input() {
    if (S.virt) return S.virt;
    const k = c => keys.has(c) || touch.btn.has(c);
    const f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) - touch.y + padState.f;
    const r = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + touch.x + padState.r;
    return { f: clamp(f, -1, 1), r: clamp(r, -1, 1), up: k('Space') ? 1 : padState.up, down: (k('ControlLeft') || k('ControlRight') || k('KeyC')) ? 1 : padState.down,
      run: (k('ShiftLeft') || k('ShiftRight')) ? 1 : padState.run, inflate: k('KeyF') ? 1 : padState.inflate, deflate: k('KeyG') ? 1 : padState.deflate };
  }

  // ------------------------------------------------------------ sound: footsteps on sand and in the shallows, synthesised
  const audio = (() => {
    let ac = null, buf = null, on = q.get('mute') !== '1';
    return {
      unlock() { if (ac || !on) return; try { ac = new (window.AudioContext || window.webkitAudioContext)(); const n = ac.sampleRate * 0.4; buf = ac.createBuffer(1, n, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } catch (_) { ac = null; } },
      toggle() { on = !on; if (!on && ac) { ac.close(); ac = null; } else this.unlock(); return on; },
      step(kind, vol = 1) {
        if (!ac || !on) return;
        try {
          const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
          s.buffer = buf; f.type = 'lowpass';
          const water = kind === 'water';
          f.frequency.value = water ? 900 + Math.random() * 500 : 1500 + Math.random() * 900;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((water ? 0.16 : 0.1) * vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + (water ? 0.28 : 0.11));
          s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t, Math.random() * 0.1, 0.35);
        } catch (_) {}
      }
    };
  })();

  // ------------------------------------------------------------ interaction
  const interactables = [];
  const gearCrate = new THREE.Group();     // the dive kit on the beach: E cycles snorkel, scuba, none
  {
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x8a6a45, roughness: 0.9 }), orange = new THREE.MeshStandardNodeMaterial({ color: 0xe8741c, roughness: 0.7 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), wood); box.position.y = 0.25; gearCrate.add(box);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 14), new THREE.MeshStandardNodeMaterial({ color: 0xb9c2c9, roughness: 0.35, metalness: 0.7 })); tank.position.set(0.3, 0.8, 0); tank.rotation.z = 0.12; gearCrate.add(tank);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.5), orange); fin.position.set(-0.2, 0.52, 0.05); fin.rotation.y = 0.5; gearCrate.add(fin);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), wood); pole.position.set(-0.45, 1.6, -0.2); gearCrate.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardNodeMaterial({ color: 0xd62828, roughness: 0.8, side: THREE.DoubleSide })); flag.position.set(-0.1, 2.35, -0.2); gearCrate.add(flag);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.08), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide })); stripe.position.set(-0.1, 2.35, -0.199); stripe.rotation.z = 0.5; gearCrate.add(stripe);
    scene.add(gearCrate);
  }
  function placeCrate(x, north) { const h = ctx.height(x, north); gearCrate.position.set(x, h, -north); gearCrate.rotation.y = -0.4; }
  const cycleGear = () => { const g = S.gear; equip(g.scuba ? 'none' : g.snorkel ? 'scuba' : 'snorkel'); };
  function addInteractable(o) { const it = Object.assign({ radius: 2.4, key: 'E' }, o); interactables.push(it); return it; }
  function nearest() {
    let best = null, bd = 1e9;
    for (const it of interactables) {
      if (it.enabled && !it.enabled(player)) continue;
      const p = it.x !== undefined ? { x: it.x, z: -it.north } : it.object ? it.object.position : S.pos;
      const d = Math.hypot(p.x - S.pos.x, (p.z) - S.pos.z);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    return best;
  }
  function interact() { const it = nearest(); if (it) { it.action && it.action(player, it); return true; } return false; }

  // ------------------------------------------------------------ gear
  function equip(name) {
    const g = S.gear, was = g.scuba;
    if (name === 'none' || name === 'off') Object.assign(g, { mask: false, snorkel: false, fins: false, scuba: false });
    else if (name === 'mask') g.mask = true;
    else if (name === 'fins') g.fins = true;
    else if (name === 'snorkel') Object.assign(g, { mask: true, snorkel: true, fins: true, scuba: false });
    else if (name === 'scuba') { Object.assign(g, { mask: true, snorkel: false, fins: true, scuba: true }); }
    else return false;
    if (g.scuba && !was) { diver.reset(true); S.bcd.n = 5; hud.say('Scuba kit on: 300 bar tank, BCD, regulator. Check your air, then descend.', { kind: 'good', secs: 6 }); }
    else if (name === 'snorkel') hud.say(season ? 'Mask, snorkel and fins on, in a full-body stinger suit (stinger season: October to May).' : 'Mask, snorkel and fins on, in a long-sleeve rash vest.', { secs: 6 });
    else if (name === 'none') hud.say('Gear off.', 2);
    dress();
    return true;
  }
  interactables.push({ id: 'kit', object: gearCrate, radius: 2.4, key: 'E', get label() { return S.gear.scuba ? 'E: take the scuba kit off' : S.gear.snorkel ? 'E: swap to the scuba kit' : 'E: put on mask, snorkel and fins'; }, action: cycleGear });

  // ------------------------------------------------------------ simulation
  const fwdV = new V3(), rightV = new V3(), tmp = new V3(), tmp2 = new V3();
  function teleport(x, north, up, heading) {
    const h = ctx.height(x, north), dep = env.u.tide.value - h;
    S.vel.set(0, 0, 0); S.vy = 0; S.dive = false; S.emergency = false;
    if (heading !== undefined) { S.camYaw = S.bodyYaw = THREE.MathUtils.degToRad(heading); }
    S.pos.set(x, h, -north); S.grounded = true; S.water = false;
    if (up !== undefined) { S.pos.y = up; S.grounded = up <= h + 0.05; }
    S.dep = dep;
    if (dep >= SWIM_ENTER && (up === undefined || up > h + 0.5)) { S.water = true; S.pos.y = up !== undefined ? up : surfaceAt(x, -north) - BODY_FLOAT; S.grounded = false; }
    S.focus.copy(S.pos); S.focus.y += S.water ? 0.3 : 1.5;
    S.state = S.water ? (S.gear.scuba ? 'scuba' : S.gear.mask ? 'snorkel' : 'swim') : dep > WADE_FROM ? 'wade' : 'walk';
    S.dressKey = '';
    ears.eq = S.water ? Math.max(0, env.u.tide.value - S.pos.y - BODY_FLOAT) : 0; breath.t = 0;   // teleported divers arrive equalised
    if (S.water && up !== undefined && S.gear.scuba) S.bcd.n = Math.max(0, ambient(Math.max(0, env.u.tide.value - up)) * 4.5 - 3);   // dropped in at depth: start roughly neutral
    return player;
  }

  function simulate(dt, inp) {
    S.time += dt;
    const x = S.pos.x, z = S.pos.z, north = -z;
    S.floor = ctx.height(x, north);
    S.dep = env.u.tide.value - S.floor;
    S.surf = surfaceAt(x, z);
    const g = S.gear;
    // camera-relative directions on the horizontal plane
    fwdV.set(Math.sin(S.camYaw), 0, -Math.cos(S.camYaw)); rightV.set(Math.cos(S.camYaw), 0, Math.sin(S.camYaw));
    const wish = tmp.set(0, 0, 0).addScaledVector(fwdV, inp.f).addScaledVector(rightV, inp.r);
    const mag = Math.min(1, wish.length()); if (mag > 0) wish.normalize();
    if (pressed.has('KeyV')) { S.view = S.view === 'third' ? 'shoulder' : S.view === 'shoulder' ? 'first' : 'third'; }
    if (pressed.has('KeyE')) interact();
    if (pressed.has('KeyH')) hud.help();
    if (pressed.has('KeyM')) hud.say(audio.toggle() ? 'Sound on' : 'Sound off', 1.5);
    if (pressed.has('KeyQ') && (S.water || S.dep > 0)) { if (ears.equalise()) hud.say('Ears equalised', 1.5); }
    if (pressed.has('KeyB') && rig.has('snorkel') && S.depthBody < 0.3) blowClear();
    pressed.clear();

    if (!S.water) onFoot(dt, inp, wish, mag); else inWater(dt, inp, wish, mag);
    if (!S.water) { ears.eq = 0; ears.update(0); }
  }

  const blowClear = () => { rig.snorkelTip(tmp2); fx.splash(tmp2, 14, 2.6, 1.8); };

  function onFoot(dt, inp, wish, mag) {
    const run = inp.run && S.dep < 0.6;
    const wading = S.dep > WADE_FROM;
    let vmax = (run ? 4.0 : 1.7) * mag;
    if (g_scubaHeavy()) vmax *= 0.8;
    if (wading) vmax *= 1 - 0.5 * sm(0.1, 1.3, S.dep);          // water drag: thigh-deep is half speed
    S.vel.x = damp(S.vel.x, wish.x * vmax, 9, dt); S.vel.z = damp(S.vel.z, wish.z * vmax, 9, dt);
    // move with a slope limit: blocked steps slide along one axis
    const step = (nx, nz) => {
      const h0 = ctx.height(S.pos.x, -S.pos.z), h1 = ctx.height(nx, -nz), d = Math.hypot(nx - S.pos.x, nz - S.pos.z);
      return d < 1e-6 || (h1 - h0) / d < MAX_SLOPE || h1 < h0;
    };
    const nx = S.pos.x + S.vel.x * dt, nz = S.pos.z + S.vel.z * dt;
    if (step(nx, nz)) { S.pos.x = nx; S.pos.z = nz; }
    else if (step(nx, S.pos.z)) { S.pos.x = nx; S.vel.z = 0; }
    else if (step(S.pos.x, nz)) { S.pos.z = nz; S.vel.x = 0; }
    else { S.vel.x = S.vel.z = 0; }
    S.speed = Math.hypot(S.vel.x, S.vel.z);
    const h = ctx.height(S.pos.x, -S.pos.z), dep = env.u.tide.value - h;
    S.dep = dep;
    // ground following, jumping
    if (S.grounded) {
      S.pos.y = damp(S.pos.y, h, 30, dt); if (Math.abs(S.pos.y - h) < 0.002) S.pos.y = h;
      if (inp.up && dep < 0.9) { S.grounded = false; S.vy = 4.1 * (dep > WADE_FROM ? 0.75 : 1); }
    } else {
      S.vy -= 9.8 * dt; S.pos.y += S.vy * dt;
      if (S.pos.y <= h) { S.pos.y = h; S.grounded = true; S.vy = 0; audio.step(dep > WADE_FROM ? 'water' : 'sand', 1.3); if (dep > WADE_FROM) splashAtFeet(6, 2); }
    }
    // body heading follows the way we move
    if (S.speed > 0.25) S.bodyYaw += angDiff(S.bodyYaw, Math.atan2(S.vel.x, -S.vel.z)) * Math.min(1, dt * 9);
    // footsteps: one per stride, a splash in the water
    S.stride += S.speed * dt;
    const stride = run ? 1.35 : 0.8;
    if (S.stride > stride) { S.stride = 0; if (S.grounded) { audio.step(wading ? 'water' : 'sand', clamp(S.speed / 2.5, 0.4, 1.2)); if (wading) splashAtFeet(2 + (S.speed > 1 ? 2 : 0), 1.3); } }
    // into deeper water
    if (S.dep >= SWIM_ENTER && S.grounded) { enterWater(); return; }
    setState(wading ? 'wade' : run && S.speed > 2 ? 'run' : 'walk');
  }
  const g_scubaHeavy = () => S.gear.scuba;
  function splashAtFeet(n, sp) { tmp2.set(S.pos.x + S.vel.x * 0.15, Math.max(S.surf, S.floor), S.pos.z + S.vel.z * 0.15); fx.splash(tmp2, n, sp, 0.9); }
  function enterWater() {
    S.water = true; S.grounded = false; S.vy = 0;
    S.pos.y += 0.9;                                                // the hips, not the feet, are the body's reference now
    splashAtFeet(10, 2.2);
    if (season && !S.gear.mask) hud.say('Marine stinger season: a stinger suit is the safe way in.', { kind: 'warn', secs: 5 });
  }

  function inWater(dt, inp, wish, mag) {
    const gear = S.gear, floor = S.floor, surf = S.surf;
    const floating = surf - BODY_FLOAT;
    S.depthBody = Math.max(0, surf - S.pos.y - BODY_FLOAT);        // how far the diver is below the surface
    // back to standing when the floor comes up and we are near the surface
    if (S.dep < SWIM_EXIT && S.depthBody < 0.6) { exitWater(); return; }
    const fins = gear.fins ? 1.3 : 1;
    const base = gear.scuba ? 0.85 : gear.mask ? 0.95 : 1.05;
    let hv = base * fins * (inp.run ? 1.6 : 1) * mag;
    const underwater = S.depthBody > 0.5;
    // the dive key from the surface: a duck-dive
    if (!gear.scuba && !S.dive && inp.down && S.depthBody < 0.5 && S.dep > 1.8) { S.dive = true; S.vy = -0.9; hud.hint('Looking and kicking down takes you deeper · Space goes up · Q equalises', 8); }
    if (!gear.scuba && S.dive && S.depthBody < 0.25 && !inp.down && S.vy >= 0) { S.dive = false; if (S.lastDeep > 1.5) { rig.snorkelTip(tmp2); if (rig.has('snorkel')) fx.splash(tmp2, 14, 2.6, 1.8); } S.lastDeep = 0; }
    // free-dive vertical control, scuba buoyancy, or floating at the surface
    let vyTarget = 0, ay = 0, effort = 0.3 + 0.7 * Math.min(1, Math.hypot(S.vel.x, S.vel.z) / 1.3);
    const pitchSteer = inp.f > 0 && underwater ? Math.sin(S.camPitch) : 0;
    if (gear.scuba) {
      const amb = ambient(S.depthBody), bn = S.bcd;
      if (inp.inflate) bn.n += 2.6 * dt; if (inp.deflate || (inp.down && S.depthBody < 2 && bn.n > 0)) bn.n = Math.max(0, bn.n - (inp.deflate ? 3.2 : 2.0) * dt);
      if (S.emergency) bn.n = Math.max(bn.n, 4.2 * amb);          // out of air: the BCD fills and carries us up
      bn.n = Math.max(0, bn.n);
      if (bn.n / amb > 8.5) bn.n = 8.5 * amb;                        // the overpressure valve dumps the excess
      const lung = 0.55 * Math.sin(S.time * 1.4);                    // breathing in lifts you, breathing out lets you sink
      const net = bn.n / amb + 3.0 / amb - 4.5 + (1 - diver.air / diver.tankBar) * 1.8 + lung;
      const kick = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
      ay = net * 0.9 + kick * 1.2 - 2.2 * S.vy + pitchSteer * hv * 2.2;
      if (S.emergency) ay += (0.28 - S.vy) * 3.5;
      effort = Math.min(1, effort + Math.abs(kick) * 0.4);
      S.vy += ay * dt;
      if (ears.level === 2 && S.vy < -0.3) S.vy = damp(S.vy, -0.3, 3, dt);
    } else if (S.dive) {
      const bd = S.depthBody;
      let cmd = inp.down ? -1.15 : inp.up ? 1.3 : inp.f > 0 ? pitchSteer * hv * 1.3 : 0.45;
      if (ears.level === 2 && cmd < 0) cmd *= 0.3;
      if (bd >= FREEDIVE_MAX && cmd < 0) { cmd = 0.1; hud.hint('10 m: the limit for a breath-hold dive. Head up.', 3); }
      if (breath.fraction >= 1) cmd = 1.6;                           // out of breath: the body decides
      S.vy = damp(S.vy, cmd, 2.6, dt);
      effort = Math.min(1, effort + Math.abs(cmd) * 0.25);
    }
    if (!gear.scuba && !S.dive) {                                    // on top of the water
      S.vy = 0;
      S.pos.y = damp(S.pos.y, floating, 10, dt);
    } else {
      S.pos.y += S.vy * dt;
      if (S.pos.y > floating) { S.pos.y = floating; if (S.vy > 0) S.vy = 0; }       // cannot rise out of the sea
      if (S.pos.y < floor + 0.35) { S.pos.y = floor + 0.35; if (S.vy < 0) S.vy = 0; }
      if (S.pos.y >= floating - 0.001 && gear.scuba) S.pos.y = damp(S.pos.y, floating, 10, dt);
    }
    S.depthBody = Math.max(0, surf - S.pos.y - BODY_FLOAT);
    if (S.dive) S.lastDeep = Math.max(S.lastDeep, S.depthBody);
    // horizontal swimming, with inertia: the water is thick
    hv *= (underwater || S.dive || gear.scuba) ? 1 : 1;
    S.vel.x = damp(S.vel.x, wish.x * hv, 2.4, dt); S.vel.z = damp(S.vel.z, wish.z * hv, 2.4, dt);
    S.pos.x += S.vel.x * dt; S.pos.z += S.vel.z * dt;
    // the sea floor and the shore stop us
    const fl = ctx.height(S.pos.x, -S.pos.z);
    if (S.pos.y < fl + 0.35) S.pos.y = fl + 0.35;
    S.speed = Math.hypot(S.vel.x, S.vel.z);
    S.kick += dt * (2.2 + 4.2 * Math.min(1, S.speed / (fins > 1 ? 1.4 : 1.1))) * (gear.fins ? 0.75 : 1);
    if (S.speed > 0.2) S.bodyYaw += angDiff(S.bodyYaw, Math.atan2(S.vel.x, -S.vel.z)) * Math.min(1, dt * 3);
    else if (Math.abs(S.vy) > 0.05 || S.camYaw !== S.bodyYaw) S.bodyYaw += angDiff(S.bodyYaw, S.camYaw) * Math.min(1, dt * 0.6);
    // body pitch follows where the diver is going
    const travelPitch = clamp(Math.atan2(S.vy, Math.max(S.speed, 0.25)), -1.2, 1.2);
    S.bodyPitch = damp(S.bodyPitch, underwater || S.dive || gear.scuba ? -travelPitch : 0, 3, dt);

    // physiology and state
    const eff = effort;
    if (gear.scuba) {
      diver.update(dt, S.depthBody, eff, true);
      ears.update(S.depthBody);
      if (diver.outOfAir && !S.emergency && S.depthBody > 0.5) { S.emergency = true; }
      if (S.emergency && S.depthBody < 0.3) { S.emergency = false; hud.say('Surface. The tank is empty: take the kit off (E) and grab a full one.', { kind: 'warn', secs: 6 }); S.bcd.n = 5; diver.air = 0.5; diver.outOfAir = false; }
      // exhale: a burst of bubbles from the regulator
      S.breathT -= dt;
      if (S.breathT <= 0 && S.depthBody > 0.4) { S.breathT = 3.8 + Math.random() * 1.2; rig.group.updateMatrixWorld(true); rig.mouth(tmp2); fx.bubbles(tmp2, 8 + Math.floor(Math.random() * 6), 0.026, 0.06); }
      setState('scuba');
    } else {
      diver.update(dt, 0, 0, false);
      const holding = S.dive && S.depthBody > 0.3;
      breath.update(dt, S.depthBody, eff, holding);
      if (holding) ears.update(S.depthBody); else ears.update(0);
      if (S.dive) { if (S.depthBody > 0.8) setState('freedive'); }
      else setState(gear.mask ? 'snorkel' : 'swim');
      if (S.dive && S.depthBody <= 0.8 && S.state !== 'freedive') setState(gear.mask ? 'snorkel' : 'swim');
    }
    // surface spray while kicking hard
    if (S.depthBody < 0.3 && S.speed > 0.8) { S.splashT -= dt; if (S.splashT <= 0) { S.splashT = 0.18; tmp2.set(S.pos.x - S.vel.x * 0.9, surf, S.pos.z - S.vel.z * 0.9); fx.splash(tmp2, 2, 1.1, 0.7); } }
  }
  function exitWater() {
    S.water = false; S.dive = false; S.emergency = false; S.vy = 0; S.grounded = true;
    S.pos.y = Math.max(S.floor, S.pos.y - 0.5); S.bodyPitch = 0;
    setState(S.dep > WADE_FROM ? 'wade' : 'walk');
  }

  // ------------------------------------------------------------ the person and the camera
  const eye = new V3(), want = new V3(), look3 = new V3();
  function animate(dt) {
    const inW = S.water, st = S.state;
    // pose
    rig.group.position.copy(S.pos);
    const targetYaw = Math.PI - S.bodyYaw;
    rig.group.rotation.y = targetYaw; rig.heading = targetYaw;
    const P_ = rig.proc;
    const kt = inW ? 1 : 0;
    P_.k = damp(P_.k, kt, 7, dt); if (Math.abs(P_.k - kt) < 0.01) P_.k = kt;
    if (inW) {
      P_.mode = st === 'swim' ? 'crawl' : 'snorkel';
      P_.phase = S.kick; P_.amp = 0.45 + 0.55 * clamp(S.speed / 1.1, 0, 1); P_.fin = S.gear.fins ? 1.5 : 1; P_.pitch = S.bodyPitch;
      rig.play('Idle', { fade: 0.3 });
    } else if (P_.k < 0.02) { P_.mode = 'none'; rig.locomote(S.grounded ? S.speed : 0, 0.2); }
    else { P_.mode = 'snorkel'; rig.locomote(S.speed, 0.2); }
    rig.setSwim(P_.k, { pitch: P_.pitch });
    dress();
    if (rig.acc.bcd && rig.acc.bcd.userData.inflate) rig.acc.bcd.userData.inflate(clamp((S.bcd.n / ambient(S.depthBody)) / 8, 0, 1));
    rig.update(dt, camera);

    // camera
    const sc = rig.look.scale || 1;
    const headY = inW ? S.pos.y + 0.3 : S.pos.y + 1.52 * sc;
    S.focus.x = damp(S.focus.x, S.pos.x, 14, dt); S.focus.z = damp(S.focus.z, S.pos.z, 14, dt); S.focus.y = damp(S.focus.y, headY, 9, dt);
    const cp = Math.cos(S.camPitch), dir = look3.set(Math.sin(S.camYaw) * cp, Math.sin(S.camPitch), -Math.cos(S.camYaw) * cp);
    rig.group.visible = S.view !== 'first';
    if (S.view === 'first') {
      eye.set(S.pos.x, inW ? S.pos.y + 0.02 : S.pos.y + 1.62 * sc, S.pos.z);
      eye.addScaledVector(fwdFlat(), inW ? 0.35 : 0.12);
      camera.position.copy(eye);
    } else {
      const shoulder = S.view === 'shoulder' ? 0.55 : 0;
      let d = S.dist * (inW ? 1.25 : 1);
      want.copy(S.focus);
      rightFlat(tmp2); want.addScaledVector(tmp2, shoulder);
      // pull the camera in until it clears the ground and the sea floor
      let dd = d;
      for (let i = 1; i <= 12; i++) {
        const t = d * i / 12;
        const px = want.x - dir.x * t, py = want.y - dir.y * t, pz = want.z - dir.z * t;
        if (py < ctx.height(px, -pz) + 0.35) { dd = Math.max(0.5, d * (i - 1) / 12); break; }
      }
      camera.position.copy(want).addScaledVector(dir, -dd);
    }
    // never sit on the sea surface: that is where the water mesh flickers between its two faces
    const cs = surfaceAt(camera.position.x, camera.position.z);
    if (Math.abs(camera.position.y - cs) < 0.3) {
      const above = camera.position.y - cs >= 0 || (S.camSide > 0 && camera.position.y - cs > -0.06);
      S.camSide = above ? 1 : -1;
      camera.position.y = cs + S.camSide * 0.3;
    } else S.camSide = camera.position.y > cs ? 1 : -1;
    camera.position.y = Math.max(camera.position.y, ctx.height(camera.position.x, -camera.position.z) + 0.25);
    camera.quaternion.setFromEuler(new THREE.Euler(S.camPitch, -S.camYaw, 0, 'YXZ'));
    // (three.js yaw about +y turns left; heading 0 is north = -z, 90 is east = +x, so the Euler yaw is -heading)
  }
  const fwdFlat = () => tmp.set(Math.sin(S.camYaw), 0, -Math.cos(S.camYaw));
  const rightFlat = o => o.set(Math.cos(S.camYaw), 0, Math.sin(S.camYaw));

  // mask frame, hud
  function hudFrame(dt) {
    const inW = S.water, wearMask = S.gear.mask && inW;
    const eyeUnder = camera.position.y < env.u.tide.value - 0.05;
    hud.mask(wearMask && (eyeUnder || S.view === 'first'));
    const near = nearest();
    hud.promptAuto(near ? near.label : '');
    const sc = S.state, below = S.depthBody;
    let gauge = null;
    if (sc === 'scuba') {
      const stop = diver.stopDue || diver.decoDue ? diver.stopLeft : (diver.maxDepth >= 10 ? 0 : null);
      gauge = { depth: below, label: 'scuba', bar: diver.air / diver.tankBar, barWarn: diver.air < 50, cells: [
        { k: 'Air', v: `${diver.air.toFixed(0)} bar`, c: diver.air < 50 ? 'b' : diver.air < 100 ? 'w' : '' },
        { k: 'No-deco', v: diver.decoDue ? 'DECO' : diver.ndl > 99 ? '99+ min' : `${diver.ndl.toFixed(0)} min`, c: diver.decoDue ? 'b' : diver.ndl < 5 ? 'w' : '' },
        { k: 'Vertical', v: `${diver.rate >= 0 ? '↑' : '↓'} ${Math.abs(diver.rate).toFixed(0)} m/min`, c: diver.rate > 18 ? 'b' : diver.rate > 14 ? 'w' : '' },
        { k: 'Safety stop', v: stop === null ? 'none due' : stop > 0 ? `${Math.floor(stop / 60)}:${String(Math.floor(stop % 60)).padStart(2, '0')}` : 'done', c: stop === 0 ? 'g' : stop > 0 && below >= 4 && below <= 6 ? 'w' : '' }] };
    } else if (sc === 'freedive') {
      gauge = { depth: below, label: 'free dive', bar: breath.fraction, barWarn: breath.fraction > 0.7, cells: [
        { k: 'Breath', v: `${Math.floor(breath.left / 60)}:${String(Math.floor(breath.left % 60)).padStart(2, '0')} left`, c: breath.fraction > 0.8 ? 'b' : breath.fraction > 0.5 ? 'w' : '' },
        { k: 'Ears', v: ears.level === 2 ? 'pain: Q' : ears.level === 1 ? 'press: Q' : 'clear', c: ears.level === 2 ? 'b' : ears.level === 1 ? 'w' : '' }] };
    }
    const temp = waterTemp(new Date(whenMs), below);
    hud.update(dt, { heading: THREE.MathUtils.radToDeg(S.camYaw), clockMs: nowMs(), tz: ctx.S && ctx.S.timezone, temp, gauge });
  }

  // ------------------------------------------------------------ the public player
  const player = {
    S, rig, look: rig.look,
    get position() { return S.pos; },
    get state() { return S.state; },
    get depth() { return S.depthBody; },
    get gear() { return Object.assign({}, S.gear); },
    get view() { return S.view; }, set view(v) { S.view = v; },
    get local() { return { x: S.pos.x, north: -S.pos.z, up: S.pos.y }; },
    get heading() { return THREE.MathUtils.radToDeg(S.camYaw); },
    diver, breath, ears,
    teleport, equip, onChange(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
    unequip() { return equip('none'); },
    addInteractable, interact, setHeading(deg) { S.camYaw = S.bodyYaw = THREE.MathUtils.degToRad(deg); return player; },
    // change gender, skin, hair: rebuilds the person
    async setLook(opts = {}) {
      const nl = P.makeLook('player', Object.assign({ gender: rig.look.gender, season }, opts));
      const old = rig; scene.remove(old.group);
      const r = await P.createPerson(nl); r.group.position.copy(old.group.position); scene.add(r.group);
      rig = r; player.rig = r; player.look = r.look; S.dressKey = ''; baseOutfit.suit = nl.suit; baseOutfit.sleeve = nl.sleeve; dress();
      return r;
    },
    wave() { rig.wave(); },
    placeKit: placeCrate, kit: gearCrate
  };
  player.interactables = interactables;

  // ---- spawn: Whitehaven Beach, facing the sea
  teleport(SPAWN.x, SPAWN.north, undefined, SPAWN.heading);
  placeCrate(SPAWN.x - 7, SPAWN.north - 5);
  for (const k of ['equip', 'snorkel', 'scuba', 'gear']) { const v = q.get(k); if (v) equip(k === 'equip' || k === 'gear' ? v : k); }
  if (q.get('x') !== null && q.get('y') !== null && q.get('player') === '1') teleport(Number(q.get('x')), Number(q.get('y')), q.get('z') !== null ? Number(q.get('z')) : undefined, q.get('yaw') !== null ? Number(q.get('yaw')) : undefined);
  if (q.get('view')) S.view = q.get('view');
  if (q.get('cam')) { const c = q.get('cam').split(',').map(Number); S.camYaw = THREE.MathUtils.degToRad(c[0]); S.camPitch = THREE.MathUtils.degToRad(c[1] ?? -10); S.dist = c[2] ?? S.dist; }

  // ---- NPCs and crowds for the game module
  const npcs = new Set();
  function spawnPerson(role, opts = {}) {
    const holder = new THREE.Group(); holder.name = 'npc:' + role;
    const queue = [];
    const npc = { role, group: holder, rig: null, ready: null, opts, name: opts.name || role };
    const defer = fn => { if (npc.rig) fn(npc.rig); else queue.push(fn); return npc; };
    npc.say = (t, s) => defer(r => r.say(t, s)); npc.faceTowards = (v, snap) => defer(r => r.faceTowards(v && v.position ? v.position : v, snap));
    npc.play = (clip, o) => defer(r => r.play(clip, o)); npc.wave = () => defer(r => r.wave());
    npc.setHeading = deg => defer(r => r.setHeading(Math.PI - THREE.MathUtils.degToRad(deg)));
    npc.setPosition = (x, north, up) => { holder.position.set(x, up ?? ctx.height(x, north), -north); return npc; };
    npc.show = (acc, v) => defer(r => r.show(acc, v));
    npc.dispose = () => { npcs.delete(npc); defer(r => r.dispose()); holder.removeFromParent(); };
    const lookData = P.makeLook(role, Object.assign({ season }, opts.look || {}, opts.gender ? { gender: opts.gender } : {}, opts.skin ? { skin: opts.skin } : {}, opts.seed !== undefined ? { seed: opts.seed } : {}));
    if (opts.x !== undefined) npc.setPosition(opts.x, opts.north ?? opts.y ?? 0, opts.up);
    if (opts.parent) opts.parent.add(holder); else scene.add(holder);
    npc.ready = P.createPerson(lookData, { onSay: opts.onSay }).then(r => {
      npc.rig = r; npc.look = r.look; holder.add(r.group);
      if (opts.heading !== undefined) r.setHeading(Math.PI - THREE.MathUtils.degToRad(opts.heading));
      for (const a of opts.gear || []) r.show(a, true);
      r.play(opts.animation || 'Idle', { fade: 0 });
      if (opts.timeOffset) r.mixer.update(opts.timeOffset);
      queue.splice(0).forEach(f => f(r));
      return npc;
    });
    npcs.add(npc);
    return npc;
  }
  function makeCrowd(n, center, radius, o = {}) {
    const c = { group: new THREE.Group(), count: 0, ready: null };
    scene.add(c.group);
    c.ready = P.makeCrowd(ctx, n, center, radius, o).then(r => { c.group.add(r.group); c.count = r.count; c.people = r.people; c.meshes = r.meshes; return c; });
    return c;
  }

  // ------------------------------------------------------------ frame
  let acc = 0;
  const controller = {
    update(dt) {
      if (S.auto) return;
      dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;           // still-frame tests can hand in a negative step
      pollPad(dt);
      simulate(dt, input());
      animate(dt);
      fx.update(dt, surfaceAt);
      hudFrame(dt);
    }
  };
  ctx.controller = controller;
  const api = { player, spawnPerson, makeCrowd, makeLook: P.makeLook, createPerson: P.createPerson, hud, fx, interactables, surfaceAt, ears, breath, diver, people: P,
    update(dt) { dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60; for (const n of npcs) if (n.rig) { const d = n.group.position.distanceTo(camera.position); if (d < 220) n.rig.update(dt, camera); } } };
  ctx.player = player; ctx.people = api; ctx.hud = hud; ctx.spawnPerson = spawnPerson; ctx.makeCrowd = makeCrowd;
  window.__player = api;

  // ---- test and demo hooks (query): dive=1 duck-dives, demo=npcs|crowd places people, settle=<s> runs the sim before the first frame
  if (q.get('dive')) S.dive = true;
  const demoWait = [];
  if (q.get('demo')) {
    const here = player.local, ah = THREE.MathUtils.degToRad(S.camYaw * 0 + SPAWN.heading);
    const dx = Math.sin(S.camYaw), dn = Math.cos(S.camYaw), rx = Math.cos(S.camYaw), rn = -Math.sin(S.camYaw);
    if (q.get('demo') === 'npcs') ['skipper', 'guide', 'ranger', 'traditionalOwner'].forEach((role, i) => {
      const o = (i - 1.5) * 1.5, x = here.x + dx * 5 + rx * o, nn = here.north + dn * 5 + rn * o;
      const n = spawnPerson(role, { x, north: nn, heading: THREE.MathUtils.radToDeg(S.camYaw) + 180 + (i - 1.5) * -8, gender: ['M', 'W', 'W', 'W'][i], animation: i === 1 ? 'Wave' : 'Idle' });
      if (i === 3) n.say('Welcome to Ngaro Country.', 60);
      demoWait.push(n.ready);
    });
    if (q.get('demo') === 'crowd') demoWait.push(makeCrowd(Number(q.get('n') || 40), [here.x + dx * 12, here.north + dn * 12], 22).ready);
  }
  await Promise.all(demoWait);
  const settle = Number(q.get('settle') || 0);
  if (settle) {
    const hold = (q.get('hold') || '').split(',');
    S.virt = { f: hold.includes('f') ? 1 : 0, r: 0, up: hold.includes('up') ? 1 : 0, down: hold.includes('down') ? 1 : 0, run: hold.includes('run') ? 1 : 0, inflate: 0, deflate: hold.includes('deflate') ? 1 : 0 };
    for (let i = 0; i < settle / 0.05; i++) controller.update(0.05);
    S.virt = null;
  }

  // ------------------------------------------------------------ ?autotest=1: script the transitions headlessly
  if (q.get('autotest') === '1') await autotest(api, { ctx, simulate, animate, S, input, equip, teleport, fx, surfaceAt, hudFrame, season });
  return api;
}

// A scripted run through every state with virtual input, stepping the physics without rendering.
// Logs "[test] ..." lines and sets window.__autotest = { pass, fail, log }.
async function autotest(api, T) {
  const { player, hud } = api, { S, ctx } = T;
  const log = [], R = { pass: 0, fail: 0, log };
  const out = (ok, name, extra = '') => { (ok ? R.pass++ : R.fail++); const l = `[test] ${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`; log.push(l); console.log(l); };
  const dt = 0.05;
  S.auto = true;
  const V = (o = {}) => Object.assign({ f: 0, r: 0, up: 0, down: 0, run: 0, inflate: 0, deflate: 0 }, o);
  let maxSplash = 0;
  const run = (secs, inp, until) => { const n = Math.round(secs / dt); S.virt = inp; for (let i = 0; i < n; i++) { T.simulate(dt, inp); maxSplash = Math.max(maxSplash, api.fx.splashCount); T.animate(dt); T.fx.update(dt, T.surfaceAt); T.hudFrame(dt); if (until && until()) return i * dt; } return secs; };
  const seen = new Set(); player.onChange(s => seen.add(s));
  const must = (cond, name, extra) => out(!!cond, name, extra || '');
  try {
    // 1. the beach: walk, run, then wade and swim out to sea
    T.teleport(505, 445, undefined, 90);
    must(player.state === 'walk' || player.state === 'wade', 'spawn on Whitehaven', `state=${player.state} dep=${S.dep.toFixed(2)}`);
    run(2, V({ f: 1 })); must(S.speed > 1.2 && S.speed < 2, 'walk speed', S.speed.toFixed(2));
    run(2, V({ f: 1, run: 1 })); must(S.speed > 2.5 || player.state === 'wade', 'run speed', `${S.speed.toFixed(2)} ${player.state}`);
    S.camYaw = Math.PI / 2;
    run(120, V({ f: 1 }), () => player.state === 'swim');
    must(seen.has('wade'), 'wade state entered'); must(maxSplash > 0, 'wading throws spray', String(maxSplash)); must(player.state === 'swim', 'swim state entered', `${player.state} depth=${S.dep.toFixed(2)} x=${S.pos.x.toFixed(0)}`);
    must(Math.abs(S.pos.y - (S.surf - 0.15)) < 0.3, 'floats at the surface', `y=${S.pos.y.toFixed(2)} surf=${S.surf.toFixed(2)}`);
    // 2. snorkel and duck-dive
    let spot = null;
    for (let r = 200; r < 6000 && !spot; r += 100) for (let a = 0; a < 6.28; a += 0.3) { const x = 505 + Math.cos(a) * r, n = 445 + Math.sin(a) * r; const d = ctx.depth(x, n); if (d > 24 && d < 34) { spot = [x, n, d]; break; } }
    must(!!spot, 'found a 24-34 m site for the dive tests', spot ? spot.map(v => v.toFixed(0)).join(',') : 'none');
    const site = spot || [800, 445, 5];
    T.equip('snorkel'); run(1.5, V());
    must(player.state === 'snorkel', 'snorkel at the surface', player.state);
    run(1, V({ f: 1 })); must(S.speed > 0.3, 'finning forward', S.speed.toFixed(2));
    T.teleport(site[0], site[1], undefined, 90); run(1.5, V());
    run(8, V({ f: 0.2, down: 1 }));
    must(player.state === 'freedive' && S.depthBody > 2, 'duck dive to depth', `${player.state} ${S.depthBody.toFixed(1)} m`);
    must(api.breath.t > 1, 'breath timer runs', api.breath.t.toFixed(1));
    run(14, V({ down: 1 })); must(S.depthBody <= 10.6, 'freedive limited to 10 m', S.depthBody.toFixed(1));
    must(api.ears.level > 0 || api.ears.eq > 0 || S.depthBody < 2, 'ears need equalising', `level=${api.ears.level}`);
    const tt = run(40, V(), () => S.state === 'snorkel' && S.depthBody < 0.3);
    must(player.state === 'snorkel', 'returns to the surface and snorkels', `${player.state} after ${tt.toFixed(0)} s`);
    // 3. scuba at depth
    T.teleport(site[0], site[1], undefined, 90); T.equip('scuba'); run(1.5, V());
    must(player.state === 'scuba' && S.depthBody < 0.5, 'scuba at the surface', `${player.state} ${S.depthBody.toFixed(2)}`);
    const air0 = api.diver.air;
    run(10, V({ down: 1, deflate: 1 })); must(S.depthBody > 2, 'descends with the BCD deflated', S.depthBody.toFixed(1));
    run(60, V({ down: 1, f: 0.4 }), () => S.depthBody > 17);
    must(S.depthBody > 12, 'reaches depth', S.depthBody.toFixed(1));
    must(api.diver.air < air0, 'air falls', `${air0.toFixed(0)} -> ${api.diver.air.toFixed(1)} bar`);
    // hover: neutral buoyancy by BCD (hold depth for 10 s, the drift should be small)
    run(2, V());
    // a diver's trim: an integral on the vertical speed finds the BCD volume that holds the depth
    for (let i = 0; i < 1200; i++) { S.virt = V(); S.bcd.n = Math.max(0, S.bcd.n - S.vy * 12 * dt * (1 + S.depthBody / 10)); T.simulate(dt, S.virt); T.animate(dt); }
    const d2 = S.depthBody; run(6, V()); const d3 = S.depthBody;
    must(Math.abs(d3 - d2) < 1.5, 'neutral buoyancy can be held', `${d2.toFixed(1)} -> ${d3.toFixed(1)} m  (n=${S.bcd.n.toFixed(1)})`);
    must(api.fx.bubbleCount > 0, 'regulator bubbles exist', String(api.fx.bubbleCount));
    must(api.diver.ndl < 99 && api.diver.ndl > 0, 'no-deco time is computed', api.diver.ndl.toFixed(0) + ' min');
    // uncontrolled ascent: the BCD air expands, rate warning fires
    S.bcd.n = 14; let maxRate = 0; S.virt = V({ up: 1, inflate: 1 });
    for (let i = 0; i < 160; i++) { T.simulate(dt, S.virt); T.animate(dt); maxRate = Math.max(maxRate, api.diver.rate); if (S.depthBody < 0.5) break; }
    must(maxRate > 18, 'a fast ascent reads above 18 m/min', maxRate.toFixed(0));
    run(15, V());
    must(player.state === 'scuba', 'still scuba at the surface', `${player.state} depth=${S.depthBody.toFixed(1)}`);
    // out of air triggers a safe emergency ascent
    T.teleport(site[0], site[1], undefined, 90); S.bcd.n = 2; run(12, V({ down: 1, deflate: 1 })); api.diver.air = 0.2;
    run(50, V(), () => S.depthBody < 0.4 && !S.emergency);
    must(S.depthBody < 1 && !S.emergency, 'out of air: emergency ascent reaches the surface', S.depthBody.toFixed(1));
    // 4. back to the beach: walking out of the water
    T.equip('none');
    T.teleport(560, 445, undefined, 270); run(40, V({ f: 1 }), () => player.state === 'walk');
    must(['walk', 'wade'].includes(player.state), 'wades back ashore', `${player.state} x=${S.pos.x.toFixed(0)}`);
    // 4b. interaction hook: the dive kit on the beach cycles the gear; customising the character rebuilds it
    T.teleport(player.kit.position.x + 1, -player.kit.position.z + 1, undefined, 90); run(0.2, V());
    must(player.interact() && player.gear.mask, 'E at the kit puts the gear on', JSON.stringify(player.gear));
    player.equip('none');
    const oldRig = player.rig; await player.setLook({ gender: 'W', skin: 'deep', hair: 'white' });
    must(player.rig !== oldRig && player.look.gender === 'W', 'setLook rebuilds the character', player.look.character);
    const np = api.spawnPerson('traditionalOwner', { x: 520, north: 445, gender: 'W' }); await np.ready; np.say('Hello', 2); np.faceTowards(S.pos); np.play('Wave'); api.update(0.05);
    must(np.rig && np.group.children.length > 0, 'spawnPerson returns a working NPC', np.look.character);
    np.dispose();
    // 4c. the dive tables and the stops, on the physiology model alone
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    must(near(ndlAt(18), 56, 1) && near(ndlAt(21), 37, 1) && near(ndlAt(24), 29, 1) && near(ndlAt(30), 20, 1), 'no-deco table: 18 m 56, 21 m 37, 24 m 29, 30 m 20', [18, 21, 24, 30].map(d => ndlAt(d).toFixed(0)).join('/'));
    const ev = [], D = new Diver({ onEvent: (k, t) => ev.push(k + ':' + t) });
    for (let t = 0; t < 21 * 60; t += 1) D.update(1, 30, 0.4, true);
    must(D.decoDue && ev.some(e => /passed/.test(e)), '30 m for 21 min passes the no-deco limit (warning only)', `load=${D.load.toFixed(2)}`);
    const D2 = new Diver({ onEvent: (k, t) => ev.push(k + ':' + t) });
    for (let t = 0; t < 8 * 60; t++) D2.update(1, 18, 0.4, true);
    must(D2.stopDue && D2.ndl > 30 && D2.air < 300, 'a normal 18 m dive owes a safety stop', `ndl=${D2.ndl.toFixed(0)} stop=${D2.stopDue}`);
    for (let t = 0; t < 200; t++) D2.update(1, 5, 0.2, true);
    must(!D2.stopDue, 'three minutes at 5 m clears the safety stop', `left=${D2.stopLeft.toFixed(0)}`);
    // 5. views, interaction hooks
    for (const v of ['first', 'shoulder', 'third']) { S.view = v; run(0.3, V()); }
    must(typeof player.addInteractable === 'function' && typeof api.spawnPerson === 'function', 'API present');
    must(S.state && Number.isFinite(S.pos.x) && Number.isFinite(S.pos.y), 'no NaNs in the player state');
  } catch (e) { out(false, 'exception', String(e && e.stack || e)); }
  S.auto = false; S.virt = null;
  T.teleport(505, 445, undefined, 90); T.equip('none');
  console.log(`[test] DONE pass=${R.pass} fail=${R.fail}`);
  window.__autotest = R;
}
