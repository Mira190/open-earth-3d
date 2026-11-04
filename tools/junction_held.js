// Queues held at a green (#144, #150): run a city's street traffic headlessly and watch every car
// stopped at a signalled junction's stop line. A car that stands at its line through whole green
// phases of its own light, one after another, is held: by a movement in the junction that crosses
// its way ('cross'), one waiting longer ('turn'), no room on its exit ('room'), its lane ('lane'), or
// a light read wrong ('light' on green). For each it prints the junction, the car's why and, for
// every movement in the junction then, its car, its arm and exit, how long it has been in, its speed,
// why it stops and the junction it is headed for. Exits 1 when a car is held through more than
// MAX greens (default 2).
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=10:00 xvfb-run -a node tools/junction_held.js shibuya [seconds] [places] [jid,...]
// places: the start and then traffic_check.js's places on the roads; jid: junctions to stand by
// instead (their ids in junctions.J).
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const { heldStep } = require('./junction_held_step');
const [,, city = 'shibuya', secs = '240', places = '2', jids = ''] = process.argv;
const MAX = Number(process.env.MAX_GREENS || 2);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const sites = jids ? jids.split(',').map(s => ({ j: Number(s) })) : [...Array(Number(places)).keys()].map(i => ({ site: i }));
  let bad = 0;
  for (const st of sites) {
    const p = await b.newPage({ viewport: { width: 800, height: 500 } });
    await pinClock(p, city);
    p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    await p.evaluate(st => {
      window.requestAnimationFrame = () => 0;
      const g = window.__game, L = g.cars.netL;
      if (st.j != null) { const j = g.junctions.J[st.j]; g.player.x = j.x + 12; g.player.y = j.y + 12; g.player.z = j.z; }
      else if (st.site > 0) {
        const d = l => Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y);
        const cand = L.filter(l => l.len > 40 && d(l) > 250 * st.site && d(l) < 300 * st.site + 200);
        if (cand.length) { const l = cand[(st.site * 7919) % cand.length]; g.player.x = l.pts[0] + 8; g.player.y = l.pts[1] + 8; g.player.z = l.pts[2]; }
      }
      g.advance(1);
    }, st);
    const r = await p.evaluate(heldStep, { T: Number(secs), max: MAX });
    const where = st.j != null ? `junction ${st.j}` : `place ${st.site}`;
    console.log(`${city} ${where}: ${r.watched} cars watched at signalled lines, ${r.cleared} cleared, ${r.cycles} greens seen; held through more than ${MAX} greens: ${r.held.length}`);
    for (const h of r.held) console.log('  ' + h);
    bad += r.held.length;
    await p.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
