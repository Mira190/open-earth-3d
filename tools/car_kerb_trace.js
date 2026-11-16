// Where does your car leave the street's level when it is driven into the kerb? The kerb run of tools/car_tip_step.js
// (W and the wheel turned to the kerb, 4 s from where the car is parked), after the same drive the game check makes
// before it (8 half-seconds of W, the brakes, out), with the car traced every tenth of a second: its place, its
// height, the terrain under it, the floor its wheels take (cars.js carFloor) and what a walker would stand on there.
//   xvfb-run -a node tools/car_kerb_trace.js tokyo [low: the low tier, as the probes; default the tier the page picks]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'tokyo', tier = ''] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await pinClock(p, city);
  if (tier) await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, tier);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return g.lateReady && g.lateReady(); });
  await p.waitForFunction(() => window.__game.myCar && window.__game.myCar(), null, { timeout: 120000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const g = window.__game, c = g.myCar(), st = c.D.st, nav = g.nav, s = g.KEEP === 'left' ? 1 : -1, D = 180 / Math.PI;
    const k = { x: st.x, y: st.y, z: st.z, h: st.h }, out = { k, rows: [] };
    const put = q => { Object.assign(st, q, { vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false, pitch: 0, roll: 0, reverse: false }); c.C.place(st.x, st.y, st.z, st.h); };
    const seat = () => { g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z; g.advance(0.3); g.enterCar(); for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5); };
    seat(); g.advance(0.5);
    for (let i = 0; i < 8; i++) g.advance(0.5, ['KeyW']);
    for (let i = 0; i < 100 && st.v > 1.5; i++) g.advance(0.1, ['KeyS']);
    for (let i = 0; i < 40 && st.speed > 0.3; i++) g.advance(0.1, ['Space']);
    g.advance(0.5); g.exitCar(); g.advance(1);
    put(k); seat();
    out.inCar = g.player.mode === 'car';
    put(k);
    const lowFloor = (x, y, z) => nav.floorAt(x, y, z - nav.STEP + OECars.CAR_STEP);
    for (let t = 0; t < 40; t++) {
      g.advance(0.1, ['KeyW', s > 0 ? 'KeyA' : 'KeyD']);
      const lo = lowFloor(st.x, st.y, st.z), hi = nav.floorAt(st.x, st.y, st.z + 0.1), T = nav.terrain(st.x, st.y);
      out.rows.push(`${(t / 10).toFixed(1)}s ${st.x.toFixed(2)},${st.y.toFixed(2)} z ${st.z.toFixed(2)} terrain ${T.toFixed(2)} rise ${(st.z - T).toFixed(2)} v ${st.speed.toFixed(1)} pitch ${(st.pitch * D).toFixed(1)} roll ${(st.roll * D).toFixed(1)} air ${st.air} | car floor ${lo ? `${lo.z.toFixed(2)} ${lo.kind}` : 'none'} | walker's ${hi ? `${hi.z.toFixed(2)} ${hi.kind}` : 'none'} | ledges under ${OECars.ledgesUnder(nav, st, c.C.half, c.C.hw)}`);
    }
    return out;
  });
  console.log(`parked at ${r.k.x.toFixed(2)},${r.k.y.toFixed(2)} z ${r.k.z.toFixed(2)} h ${r.k.h.toFixed(2)}; at the wheel ${r.inCar}`);
  for (const l of r.rows) console.log(l);
  await b.close();
})();
