// Can your car be tipped onto a wall where it is parked? Plays a city's game (web/ served on PORT or 8800, under
// xvfb-run), puts you in your car where the game parks it at the start, and drives it from there into what is round
// it: forward, back, and on full lock both ways each, for a few seconds each, every run from the parked pose again.
// Prints, per run, the steepest pitch and roll the car took, how far its body rose over the street under it, and
// where it ended; then R ("back on the road") from where the worst run left it.
//   xvfb-run -a node tools/car_tip_probe.js shibuya [seconds per run = 4] [ledge x,y: drive at the ledge there, not the nearest]
// (Shibuya's Hachiko planter, the wall your car was found tipped against: 383,-1040)
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', secs = '4', LEDGE] = process.argv;
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
  const r = await p.evaluate(([secs, want]) => {
    const g = window.__game, c = g.myCar && g.myCar(), nav = g.nav, D = 180 / Math.PI;
    if (!c) return { none: true };
    const st = c.D.st, park = { x: st.x, y: st.y, z: st.z, h: st.h }, s = g.KEEP === 'left' ? 1 : -1;
    g.player.x = st.x + Math.cos(st.h) * 2.6 * s; g.player.y = st.y - Math.sin(st.h) * 2.6 * s; g.player.z = st.z;
    g.advance(0.3); g.enterCar();
    for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5);
    const street = (x, y) => nav.terrain(x, y);
    if (nav.layAll) nav.layAll(); // (every landmark's fine floors, as they are round a player who has walked there)
    const out = { mode: g.player.mode, park: [park.x, park.y, park.z, park.h].map(v => +v.toFixed(2)), ground: +street(park.x, park.y).toFixed(2), runs: [] };
    const runs = { fwd: ['KeyW'], back: ['KeyS'], fwdLeft: ['KeyW', 'KeyA'], fwdRight: ['KeyW', 'KeyD'], backLeft: ['KeyS', 'KeyA'], backRight: ['KeyS', 'KeyD'] };
    let worst = null;
    for (const [name, keys] of Object.entries(runs)) {
      Object.assign(st, park, { vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false, pitch: 0, roll: 0, reverse: false });
      let mp = 0, mr = 0, rise = 0, where = '';
      for (let t = 0; t < secs * 10; t++) {
        g.advance(0.1, keys);
        const lift = st.z - street(st.x, st.y);
        if (Math.abs(st.pitch) * D > mp) mp = Math.abs(st.pitch) * D;
        if (Math.abs(st.roll) * D > mr) mr = Math.abs(st.roll) * D;
        if (lift > rise) { rise = lift; const f = nav.floorAt(st.x, st.y, st.z + 0.1); where = f ? f.kind : 'none'; }
      }
      const run = { name, pitch: +mp.toFixed(1), roll: +mr.toFixed(1), rise: +rise.toFixed(2), on: where, end: [st.x, st.y, st.z].map(v => +v.toFixed(1)), moved: +Math.hypot(st.x - park.x, st.y - park.y).toFixed(1) };
      out.runs.push(run);
      if (!worst || run.pitch + run.roll + run.rise * 20 > worst.pitch + worst.roll + worst.rise * 20) worst = Object.assign({ st: { x: st.x, y: st.y, z: st.z, h: st.h } }, run);
    }
    // and at the nearest ledge a walker steps up onto and a car does not (a planter's coping, a plinth: more than 0.3 m and
    // no more than a walker's step over the ground) within 30 m of where it is parked: put 4 m short of it, facing it, and
    // driven at it for 3 s, then backed off it
    let ledge = null;
    if (want) { const f = nav.floorAt(want[0], want[1], park.z + 0.1); ledge = { x: want[0], y: want[1], z: f ? f.z : park.z, kind: f ? f.kind : 'none' }; }
    if (want) out.scan = Array.from({ length: 31 }, (_, i) => { const x = want[0] - 7.5 + i * 0.5, f = nav.floorAt(x, want[1], park.z + 0.1); return f ? `${x}:${f.kind[0]}${(f.z - park.z).toFixed(2)}` : `${x}:-`; }).join(' ');
    for (let r = 1; r <= 30 && !ledge; r += 0.5) for (let k = 0; k < Math.max(8, r * 6) && !ledge; k++) {
      const a = k / Math.max(8, r * 6) * Math.PI * 2, x = park.x + Math.sin(a) * r, y = park.y + Math.cos(a) * r;
      const lo = nav.floorAt(x, y, park.z + 0.1 - nav.STEP + 0.3), hi = nav.floorAt(x, y, park.z + 0.1);
      if (lo && hi && hi.z > lo.z + 0.35 && Math.abs(lo.z - park.z) < 0.5) ledge = { x, y, z: hi.z, kind: hi.kind, a };
    }
    if (ledge) {
      // (4 m short of it on the line from where the car is parked, or with a ledge named, from the west of it)
      const from = want ? { x: want[0] - 20, y: want[1] } : park;
      const h = Math.atan2(ledge.x - from.x, ledge.y - from.y), d = Math.hypot(ledge.x - from.x, ledge.y - from.y), s0 = Math.max(0, d - 4 - c.C.half);
      const at = { x: from.x + Math.sin(h) * s0, y: from.y + Math.cos(h) * s0, h };
      at.z = (nav.floorAt(at.x, at.y, park.z + 0.1 - nav.STEP + 0.3) || { z: park.z }).z;
      Object.assign(st, at, { vx: 0, vy: 0, v: 0, speed: 0, r: 0, vz: 0, steer: 0, air: false, pitch: 0, roll: 0, reverse: false });
      let mp = 0, mr = 0, rise = 0;
      for (let t = 0; t < 30; t++) {
        g.advance(0.1, ['KeyW']);
        mp = Math.max(mp, Math.abs(st.pitch) * D); mr = Math.max(mr, Math.abs(st.roll) * D); rise = Math.max(rise, st.z - street(st.x, st.y));
      }
      const atLedge = { x: st.x, y: st.y, z: st.z, h: st.h };
      for (let t = 0; t < 20; t++) { g.advance(0.1, ['KeyS']); mp = Math.max(mp, Math.abs(st.pitch) * D); mr = Math.max(mr, Math.abs(st.roll) * D); }
      out.ledge = { at: [ledge.x, ledge.y, ledge.z].map(v => +v.toFixed(2)), kind: ledge.kind, over: +(ledge.z - park.z).toFixed(2), pitch: +mp.toFixed(1), roll: +mr.toFixed(1), rise: +rise.toFixed(2),
        stopped: [atLedge.x, atLedge.y, atLedge.z].map(v => +v.toFixed(1)), backed: +Math.hypot(st.x - atLedge.x, st.y - atLedge.y).toFixed(1) };
      if (!worst || out.ledge.pitch + out.ledge.roll + out.ledge.rise * 20 > worst.pitch + worst.roll + worst.rise * 20) worst = Object.assign({ st: atLedge, name: 'ledge' }, out.ledge);
    }
    // R from where the worst run left it
    Object.assign(st, worst.st, { vx: 0, vy: 0, v: 0, speed: 0 });
    g.advance(0.2);
    g.resetCar(); g.advance(1);
    out.reset = { at: [st.x, st.y, st.z].map(v => +v.toFixed(1)), lift: +(st.z - street(st.x, st.y)).toFixed(2), pitch: +(st.pitch * D).toFixed(1), roll: +(st.roll * D).toFixed(1) };
    return out;
  }, [+secs, LEDGE ? LEDGE.split(',').map(Number) : null]);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
