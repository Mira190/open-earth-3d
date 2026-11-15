// Your car kept on its wheels (tools/game_check.js runs it after "drives your car"). Driven from where it is parked
// (window.__kerb, or where it stands) at the nearest ledge a walker steps up onto and a car does not (a planter's coping,
// a plinth, more than 0.3 m over the street: Shibuya's Hachiko planter, which your car went up onto and stood tipped on,
// nose and side up against the wall behind), and turned in at the kerb beside it, it must stay upright (pitch and roll
// within 9 degrees of the ground's own slope: a wheel up the highest kerb it mounts, cars.js CAR_STEP, tilts it 8) and at the street's level (its
// wheels under 0.45 m over the ground: off the top of a bank it may leave it for a moment; on a planter it was 0.74); R must put it back on the road
// the right way up. The car is left parked where it was, and you on foot where you stood.
// tipStep runs in the page (page.evaluate(tipStep)); tipChecks(check, result) adds its lines. Alone:
//   xvfb-run -a node tools/car_tip_step.js shibuya
function tipStep() {
  const g = window.__game, c = g.myCar && g.myCar();
  if (!c) return { none: true };
  const st = c.D.st, nav = g.nav, D = 180 / Math.PI, s = g.KEEP === 'left' ? 1 : -1;
  const k = window.__kerb || { x: st.x, y: st.y, z: st.z, h: st.h }, was = g.player.mode === 'foot' ? [g.player.x, g.player.y, g.player.z] : null;
  const put = q => { Object.assign(st, q, { vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false, pitch: 0, roll: 0, reverse: false }); c.C.place(st.x, st.y, st.z, st.h); };
  const lowFloor = (x, y, z) => nav.floorAt(x, y, z - nav.STEP + OECars.CAR_STEP);
  put(k);
  if (g.player.mode !== 'car') {
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3); g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
  }
  const r = { inCar: g.player.mode === 'car', runs: [] };
  let ledge = null;
  for (let d = 3; d <= 40 && !ledge; d += 0.5) for (let i = 0, n = Math.max(8, Math.round(d * 6)); i < n && !ledge; i++) {
    const a = i / n * Math.PI * 2, x = k.x + Math.sin(a) * d, y = k.y + Math.cos(a) * d, lo = lowFloor(x, y, k.z), hi = nav.floorAt(x, y, k.z + 0.1);
    if (lo && hi && hi.z > lo.z + 0.3 && Math.abs(lo.z - k.z) < 0.5) ledge = { x, y, over: hi.z - lo.z, kind: hi.kind };
  }
  const runs = [['into the kerb', k, ['KeyW', s > 0 ? 'KeyA' : 'KeyD']]];
  if (ledge) {
    const h = Math.atan2(ledge.x - k.x, ledge.y - k.y), back = Math.max(0, Math.hypot(ledge.x - k.x, ledge.y - k.y) - 4 - c.C.half);
    const x = k.x + Math.sin(h) * back, y = k.y + Math.cos(h) * back, f = lowFloor(x, y, k.z);
    runs.push([`at a ledge ${ledge.over.toFixed(2)} m high (${ledge.kind} at ${ledge.x.toFixed(1)}, ${ledge.y.toFixed(1)})`, { x, y, z: f ? f.z : k.z, h }, ['KeyW']]);
  }
  for (const [name, from, keys] of runs) {
    put(from);
    let pitch = 0, roll = 0, rise = 0;
    for (let t = 0; t < 40; t++) {
      g.advance(0.1, keys);
      // (off the ground's own slope there: the terrain under its axles and its sides, as cars.js tilts it on a hill)
      const fx = Math.sin(st.h), fy = Math.cos(st.h), wb = c.C.wheelbase / 2, T = nav.terrain;
      const gp = -Math.atan2(T(st.x + fx * wb, st.y + fy * wb) - T(st.x - fx * wb, st.y - fy * wb), 2 * wb), gr = Math.atan2(T(st.x - fy * c.C.hw, st.y + fx * c.C.hw) - T(st.x + fy * c.C.hw, st.y - fx * c.C.hw), 2 * c.C.hw);
      pitch = Math.max(pitch, Math.abs(st.pitch - gp) * D); roll = Math.max(roll, Math.abs(st.roll - gr) * D); rise = Math.max(rise, st.z - T(st.x, st.y));
    }
    r.runs.push({ name, pitch, roll, rise });
  }
  g.resetCar(); g.advance(1);
  r.reset = { pitch: Math.abs(st.pitch) * D, roll: Math.abs(st.roll) * D, rise: st.z - nav.terrain(st.x, st.y) };
  g.afoot(); g.advance(0.5);
  put(k);
  if (was) { [g.player.x, g.player.y, g.player.z] = was; g.advance(0.2); } // (and you where you stood)
  return r;
}
function tipChecks(check, tip) {
  if (tip.none) return;
  for (const q of tip.runs) check(tip.inCar && q.pitch < 9 && q.roll < 9 && q.rise < 0.45, `your car driven ${q.name} stays on its wheels at the street's level (pitch ${q.pitch.toFixed(1)}° and roll ${q.roll.toFixed(1)}° off the ground's slope, ${q.rise.toFixed(2)} m over the ground)`);
  check(tip.reset.pitch < 3 && tip.reset.roll < 3 && Math.abs(tip.reset.rise) < 0.35, `R puts your car back on the road the right way up (pitch ${tip.reset.pitch.toFixed(1)}°, roll ${tip.reset.roll.toFixed(1)}°, ${tip.reset.rise.toFixed(2)} m)`);
}
module.exports = { tipStep, tipChecks };

if (require.main === module) {
  const { chromium } = require('playwright');
  const { startPlay } = require('./start_play');
  const city = process.argv[2] || 'shibuya';
  (async () => {
    const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
    await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 600000 });
    await startPlay(p);
    await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return g.lateReady && g.lateReady(); });
    await p.waitForFunction(() => window.__game.myCar && window.__game.myCar(), null, { timeout: 120000 }).catch(() => {});
    let bad = 0;
    tipChecks((ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; }, await p.evaluate(tipStep));
    await b.close();
    process.exit(bad ? 1 : 0);
  })();
}
