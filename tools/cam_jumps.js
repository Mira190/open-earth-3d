// The chase camera's jumps (the view "changes suddenly"): from the map's start, walk a scripted minute
// (forward, turns, a drag of the view, a run, through the crowd and past the poles), then bring your car,
// get in, drive a short way with turns and get out, a game frame at a time (advance(1/30): a phone's frame
// rate). Every frame keeps the camera's place, the player's head, and what the rig did (game.js rig, cam.trace),
// and a frame where the camera moves about the player, or turns, far more than the frames round it is a
// jump, printed with its cause: a cut (jumped), the pull-in, the lift over a wall, the floor or a ceiling
// clamp, a change of mode, or the follow / something else.
//   python3 -m http.server 8833 --directory web &
//   PORT=8833 xvfb-run -a node tools/cam_jumps.js shibuya [seconds of walk, 60]   (SHORT=1: game_check's 14 s walk, NOCAR=1: no car, PHONE=1: as a phone)
// OUT=file.json writes the frames, IN=file.json reads them back instead of playing. Exits 1 when a jump is found.
const { chromium } = require('playwright');
const fs = require('fs');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', secs = '60'] = process.argv;

// the walk, as [seconds, keys, view drag in rad/s]; repeated until the walk's seconds are used
const WALK = [[5, ['KeyW']], [2.5, ['KeyW', 'KeyD']], [4, ['KeyW']], [2.5, ['KeyW', 'KeyA']], [1, ['KeyW'], 1.2], [5, ['KeyW']],
  [3, ['KeyW', 'ShiftLeft']], [2, ['KeyD']], [4, ['KeyW']], [1.5, []], [1, ['KeyW'], -1.6], [4, ['KeyW', 'KeyA']], [5, ['KeyW', 'ShiftLeft']], [3, ['KeyS']]];
// the short walk tools/game_check.js plays from the start (SHORT=1 here): forward, back towards the camera, across it, round
const SHORT = [[3, ['KeyW']], [3, ['KeyS']], [2, ['KeyD']], [2.5, ['KeyW', 'KeyA']], [3.5, ['KeyW', 'ShiftLeft']]];

async function camRun(p, { walkSecs = 60, car = true, plan = WALK } = {}) {
  return p.evaluate(([walkSecs, car, plan]) => {
    const g = window.__game, V = (x, y, z) => new THREE.Vector3(x, z, -y), frames = [];
    const head = () => {
      const m = g.player.mode, c = g.myCar && g.myCar();
      if (m === 'car' && c) { const s = c.D.st; return V(s.x, s.y, s.z + 1.5); }
      if (m === 'ride' && g.ride()) { const s = g.ride().drv.st; return V(s.x, s.y, s.z + 1.5); }
      return V(g.player.x, g.player.y, g.player.z + 1.55);
    };
    g.cam.trace = {};
    const rec = (phase, drag = 0) => {
      const c = g.camera.position, h = head(), d = new THREE.Vector3();
      g.camera.getWorldDirection(d);
      const t = g.cam.trace;
      frames.push({ phase, drag: !!drag, mode: g.player.mode, cam: c.toArray(), head: h.toArray(), dir: d.toArray(), lift: g.cam.lift, pull: g.cam.pull, yaw: g.cam.yaw, pitch: g.cam.pitch, dist: g.cam.dist,
        jumped: !!t.jumped, f: t.f, pullWant: t.pullWant, wantLift: t.wantLift, floorUp: t.floorUp || 0, ceilDown: t.ceilDown || 0, pre: t.pre, blend: g.viewBlend.t });
      t.jumped = false; t.pre = null;
    };
    const step = (keys, drag = 0, phase = 'walk') => {
      if (drag) { g.cam.yaw += drag / 30; g.cam.lastInput = g.t(); }
      g.advance(1 / 30, keys);
      rec(phase, drag);
    };
    // the walk
    let t = 0;
    for (let k = 0; t < walkSecs; k++) {
      const [s, keys, drag] = plan[k % plan.length];
      for (let i = 0; i < Math.round(s * 30) && t < walkSecs; i++, t += 1 / 30) step(keys, drag || 0);
    }
    const out = { frames, carNote: null };
    if (!car) return out;
    // the car: brought, walked up to and got into, a short drive with turns, and out
    if (g.bringCar) g.bringCar();
    for (let i = 0; i < 30; i++) step([], 0, 'bring');
    { // (walked up to it, as a player gets in: stood a few steps behind it, and a second to settle)
      const st = g.myCar().D.st, s = g.nav.stand(st.x - Math.sin(st.h) * 4, st.y - Math.cos(st.h) * 4, st.z + 1, { rMax: 3 });
      if (s) { g.player.x = s.x; g.player.y = s.y; g.player.z = s.z; g.player.h = st.h; }
      g.cam.snap = true;
      for (let i = 0; i < 30; i++) step([], 0, 'bring');
    }
    g.enterCar();
    for (let i = 0; i < 240 && g.player.mode !== 'car'; i++) step([], 0, 'enter');
    if (g.player.mode !== 'car') { out.carNote = 'not at the wheel'; return out; }
    for (let i = 0; i < 45; i++) step([], 0, 'enter');
    const DRIVE = [[4, ['KeyW']], [2, ['KeyW', 'KeyA']], [3, ['KeyW']], [2, ['KeyW', 'KeyD']], [3, ['KeyW']], [2, ['KeyS']]];
    for (const [s, keys] of DRIVE) for (let i = 0; i < s * 30; i++) step(keys, 0, 'drive');
    for (let i = 0; i < 30; i++) step(['Space'], 0, 'drive');
    g.exitCar();
    for (let i = 0; i < 90; i++) step([], 0, 'exit');
    for (let i = 0; i < 90; i++) step(['KeyW'], 0, 'exit');
    return out;
  }, [walkSecs, car, plan]);
}

// the jumps in a run's frames
function jumps(frames) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = v => Math.hypot(v[0], v[1], v[2]);
  const off = frames.map(f => sub(f.cam, f.head));
  const dOff = frames.map((f, i) => (i ? len(sub(off[i], off[i - 1])) : 0));
  const dDist = frames.map((f, i) => (i ? Math.abs(len(off[i]) - len(off[i - 1])) : 0));
  const turn = frames.map((f, i) => (i ? Math.acos(Math.max(-1, Math.min(1, f.dir[0] * frames[i - 1].dir[0] + f.dir[1] * frames[i - 1].dir[1] + f.dir[2] * frames[i - 1].dir[2]))) * 180 / Math.PI : 0));
  const med = (a, i) => { const w = []; for (let j = Math.max(1, i - 6); j <= Math.min(a.length - 1, i + 6); j++) if (j !== i) w.push(a[j]); w.sort((x, y) => x - y); return w.length ? w[w.length >> 1] : 0; };
  const ev = [];
  for (let i = 2; i < frames.length; i++) {
    const f = frames[i], q = frames[i - 1];
    if (f.phase === 'bring') continue; // (the harness moving you up to the car)
    // (moved about the player by a spike, and in the world by more than the player moved: a hand-over that holds the camera
    // while what it looks at changes is not a jump)
    const dCam = len(sub(f.cam, q.cam)) - len(sub(f.head, q.head));
    const move = dOff[i] > Math.max(0.3, 3.5 * med(dOff, i)) && dCam > 0.3, dist = dDist[i] > Math.max(0.25, 3.5 * med(dDist, i)) && dCam > 0.3, tn = turn[i] > Math.max(5, 3.5 * med(turn, i));
    if (!move && !dist && !tn) continue;
    const why = [];
    if (f.mode !== q.mode) why.push(`mode ${q.mode}>${f.mode}`);
    if (f.jumped) why.push('cut');
    if (Math.abs(f.pull - q.pull) > 0.04) why.push(`pull ${q.pull.toFixed(2)}>${f.pull.toFixed(2)} (wants ${f.pullWant != null ? f.pullWant.toFixed(2) : '?'})`);
    if (Math.abs(f.lift - q.lift) > 0.02) why.push(`lift ${q.lift.toFixed(2)}>${f.lift.toFixed(2)}`);
    if (Math.abs(f.floorUp - q.floorUp) > 0.15) why.push(`floor clamp ${q.floorUp.toFixed(2)}>${f.floorUp.toFixed(2)}`);
    if (Math.abs(f.ceilDown - q.ceilDown) > 0.15) why.push(`ceiling/reclear ${q.ceilDown.toFixed(2)}>${f.ceilDown.toFixed(2)}`);
    if (Math.abs(f.dist - q.dist) > 0.2 || Math.abs(f.pitch - q.pitch) > 0.05) why.push(`cam.dist/pitch set ${q.dist.toFixed(1)}/${q.pitch.toFixed(2)}>${f.dist.toFixed(1)}/${f.pitch.toFixed(2)}`);
    const dy = Math.abs(((f.yaw - q.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dy > 0.08) why.push(`yaw ${(dy * 180 / Math.PI).toFixed(0)}°`);
    const hd = len(sub(f.head, q.head));
    if (hd > 0.4) why.push(`head moved ${hd.toFixed(2)} m`);
    if (f.blend < 1) why.push('view blend');
    ev.push({ i, phase: f.phase, t: +(i / 30).toFixed(2), move: +dOff[i].toFixed(2), dist: +dDist[i].toFixed(2), turn: +turn[i].toFixed(1), why: why.join(', ') || 'other' });
  }
  // the whips: the camera swinging about the player faster than a person follows comfortably, unasked (no drag):
  // over 100 degrees a second round, or 45 up or down, held for a tenth of a second or more
  const az = off.map(o => Math.atan2(o[0], o[2])), el = off.map(o => Math.atan2(o[1], Math.hypot(o[0], o[2])));
  const whips = [];
  let run = null, dragged = -99;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], q = frames[i - 1];
    if (f.drag) dragged = i;
    const daz = Math.abs(((az[i] - az[i - 1] + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 30 * 180 / Math.PI, del = Math.abs(el[i] - el[i - 1]) * 30 * 180 / Math.PI;
    const fast = i - dragged > 9 && f.phase !== 'bring' && f.mode === q.mode && (daz > 100 || del > 45);
    if (fast) {
      if (!run) run = { i, phase: f.phase, t: +(i / 30).toFixed(2), n: 0, az: 0, el: 0, lift: 0, pull: 0, yaw: 0, blend: f.blend < 1 };
      run.n++; run.az = Math.max(run.az, daz); run.el = Math.max(run.el, del);
      run.lift += Math.abs(f.lift - q.lift); run.pull += Math.abs(f.pull - q.pull); run.yaw += Math.abs(((f.yaw - q.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    } else if (run) { if (run.n >= 3) whips.push(run); run = null; }
  }
  // (a hand-over's blend, into or out of a car, is a deliberate quick ease: listed, not counted)
  const blends = whips.filter(w => w.blend);
  whips.splice(0, whips.length, ...whips.filter(w => !w.blend));
  for (const w of whips.concat(blends)) w.why = [w.yaw > 0.15 && `follow swung ${(w.yaw * 180 / Math.PI).toFixed(0)}°`, w.lift > 0.1 && `lift ${w.lift.toFixed(2)} rad`, w.pull > 0.1 && `pull ${w.pull.toFixed(2)}`].filter(Boolean).join(', ') || 'other';
  // the pull-in pumping in and out: each time it fell under 0.8 and came back over 0.97
  let pumps = 0, down = false, pulled = 0;
  for (const f of frames) { if (f.pull < 0.8) down = true; if (down && f.pull > 0.97) { pumps++; down = false; } if (f.pull < 0.97) pulled++; }
  return { ev, whips, blends, pumps, pulledSecs: +(pulled / 30).toFixed(1), worstMove: +Math.max(...dOff.slice(2)).toFixed(2), worstTurn: +Math.max(...turn.slice(2)).toFixed(1) };
}

async function open(city, { width = 1100, height = 650 } = {}) {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage(process.env.PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width, height } }); // (PHONE=1: a phone, its district and its touch controls)
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady());
  await startPlay(p);
  await p.waitForFunction(() => !window.__game.arriving() && !window.__game.cine.active, null, { timeout: 120000, polling: 500 }).catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.settleArrival && window.__game.settleArrival(); window.__game.advance(1); });
  return { b, p };
}

module.exports = { camRun, jumps, open, SHORT };

if (require.main === module) (async () => {
  const W = +(process.env.W || 1100), H = +(process.env.H || 650);
  // IN=file.json: the frames of an earlier run (OUT), read again
  const { b, p } = process.env.IN ? { b: { close() {} } } : await open(city, { width: W, height: H });
  const r = process.env.IN ? JSON.parse(fs.readFileSync(process.env.IN, 'utf8')) : await camRun(p, process.env.SHORT ? { walkSecs: 14, car: false, plan: SHORT } : { walkSecs: +secs, car: !process.env.NOCAR });
  const j = jumps(r.frames);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(r));
  const by = {};
  for (const e of j.ev) { const k = e.phase + ': ' + e.why.replace(/[\d.]+/g, '#'); by[k] = (by[k] || 0) + 1; }
  console.log(`${city}: ${r.frames.length} frames, ${j.ev.length} jumps; pull-in pumped ${j.pumps} times, pulled in ${j.pulledSecs} s; worst ${j.worstMove} m about the player, ${j.worstTurn}° a frame${r.carNote ? '; car: ' + r.carNote : ''}`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${k}`);
  console.log(`  ${j.whips.length} whips (over 100°/s round or 45°/s up/down for 0.1 s, unasked)`);
  for (const w of j.blends) console.log(`  (a hand-over's blend at ${w.t}s, ${w.phase}: up to ${w.az.toFixed(0)}°/s round over ${(w.n / 30).toFixed(2)} s)`);
  for (const w of j.whips.slice(0, 30)) console.log(`  whip ${w.phase} t=${w.t}s for ${(w.n / 30).toFixed(2)} s, up to ${w.az.toFixed(0)}°/s round, ${w.el.toFixed(0)}°/s up/down: ${w.why}`);
  for (const e of j.ev.slice(0, +(process.env.LIST || 40))) console.log(`  ${e.phase} t=${e.t}s moved ${e.move} m, dist ${e.dist} m, turned ${e.turn}°: ${e.why}`);
  await b.close();
  process.exit(j.ev.length || j.whips.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
