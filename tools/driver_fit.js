// Every character a ride can put at the wheel (the crowd's, people.json characters, less the ones you play) seated in
// the driving seat of every car a ride comes in (cars.js sit), and the top of the head measured against the roof over
// it (cars.js clearance): none may be through it (#392, #375 item 8: Tokyo's taxi driver 0.27 m through the roof).
// And a rider in the back. Each is seated, then animated as a ride animates its driver, frame by frame for ten
// seconds: the least room counts (#392: under a clip that held still for a frame, the legs began it bent, the body
// sat 0.38 m higher and the head went through the roof, on frames that depend on the frame times, so under load).
// Prints each character's clearance in each car and the scale it was seated at (ALL=1: every one, not only the
// failures); exits 1 when any head is through a roof.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/driver_fit.js tokyo
const { chromium } = require('playwright');
const [,, city = 'tokyo'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  const res = await p.evaluate(async () => {
    const g = window.__game, lib = g.peopleLib, vlib = g.vlib, out = [];
    if (!lib || !vlib) return { none: `${lib ? '' : 'no people'} ${vlib ? '' : 'no vehicles'}` };
    // (the cars' near models: a ride waits for them, game.js rideFromAround)
    if (!vlib.carsFull) await vlib.loadCars();
    const names = Object.keys(lib.info.characters).filter(n => !/^(W|M)_Worker$/.test(n));
    for (const n of names) await Promise.resolve(lib.require(n)).catch(() => {});
    for (const model of ['Car_Taxi', 'Car_Sedan', 'Car_SUV', 'Car_Hatch']) {
      if (!vlib.info.cars.models[model]) continue;
      const C = OECars.car(g.Wd.world, vlib, model, { colours: { paint: '#888888' }, keep: g.KEEP });
      C.place(g.player.x, g.player.y, g.player.z + 50, 0);
      for (const n of names) {
        if (!lib.tpl[n]) { out.push({ model, n, missing: true }); continue; }
        for (const seat of ['driver', g.KEEP === 'left' ? 'rear_left' : 'rear_right']) {
          const rig = OEPeople.person(lib, OEPeople.randomLook(lib, n, (g.G.crowd || {}).style));
          C.sit(rig, seat);
          const room0 = C.clearance(rig, seat);
          // (as the ride's step animates its driver from then on, frame by frame, for ten seconds: the least room)
          let room = room0;
          for (let f = 0; f < 600; f++) { C.animate(1 / 60, { v: 0, h: 0 }); rig.animate(1 / 60, 0, 'sit', f / 60); room = Math.min(room, C.clearance(rig, seat)); }
          out.push({ model, n, seat, room, room0, scale: rig.root.scale.x });
          rig.root.parent.remove(rig.root);
        }
      }
      g.Wd.world.remove(C.group);
    }
    return { out };
  });
  let bad = 0;
  if (res.none) console.log(`--   ${res.none}`);
  else for (const r of res.out) {
    if (r.missing) { console.log(`--   ${r.n} did not load`); continue; }
    const fail = !(r.room > 0);
    if (fail) bad++;
    if (fail || process.env.ALL) console.log(`${fail ? 'FAIL' : 'ok  '} ${r.n} in the ${r.seat} seat of a ${r.model}: ${r.room == null ? 'not measured' : `${r.room.toFixed(2)} m`} under the roof at the least over ten seconds, ${r.room0 == null ? '–' : r.room0.toFixed(2)} m as seated (at ${r.scale.toFixed(2)})`);
  }
  if (!res.none) console.log(`${bad ? 'FAIL' : 'ok  '} ${res.out.length} seatings, ${bad} through the roof`);
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await b.close();
  process.exit(bad ? 1 : 0);
})();
