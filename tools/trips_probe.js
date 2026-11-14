// Where the traffic goes (#355, web/game/trips.js): a city's traffic run for a while at an hour, with the cars
// on trips and, for comparison, turning at random as before (TRIPS=0), and what the flows were: the share of
// the cars' time spent on the main roads (tertiary and up), how many cars crossed a cordon 300 m round the start
// inwards against outwards, how many stood, the longest any stood, and the trips ended.
//   GAME_TIME=08:00 xvfb-run -a node tools/trips_probe.js sydney [seconds]
//   TRIPS=0 GAME_TIME=08:00 xvfb-run -a node tools/trips_probe.js sydney
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', secs = '300'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  const pinned = await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.lateReady) await g.lateReady(); });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  const hm = /(\d\d?):(\d\d)$/.exec(process.env.GAME_TIME || '');
  const r = await p.evaluate(({ secs, off, min }) => {
    const g = window.__game, A = g.cars, L = g.roadNet.L, MAIN = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    g.clock.scale = 1; // (the hour held: a day's clock runs 30 times faster)
    if (min != null) { g.setClock(g.clock.y, g.clock.m, g.clock.d, min); g.crowdAuto(true); g.advance(1); } // (the hour asked for, whatever the title offered)
    const T = g.trips();
    if (off) g.junctions.setTrips(null);
    const cx = g.player.x, cy = g.player.y, o = { main: 0, all: 0, inb: 0, outb: 0, stood: 0, longest: 0, v: 0, n: 0 }, R = 300, was = new Map();
    for (let t = 0; t < secs; t++) {
      g.advance(1);
      if (t % 5 === 0) for (const c of A.C) if (c.line >= 0 && !c.park) { const l = c.line; c.line = -1; const d = A.footprint(c.x, c.y, c.z, c.h, c.half * 0.95, c.hw * 0.95, 0); c.line = l; if (d > (o.deep || 0)) o.deep = d; } // (a moving car's body in another's)
      for (const c of A.C) {
        if (c.line < 0) continue;
        o.all++; o.v += c.v;
        // a cordon R metres round where you stand, in town: the cars that cross it inwards, and outwards
        { const d = Math.hypot(cx - c.x, cy - c.y), p = was.get(c); if (p != null && Math.abs(d - p) < 30) { if (p > R && d <= R) o.inb++; else if (p <= R && d > R) o.outb++; } was.set(c, d); }
        if (c.park) { o.parkT = (o.parkT || 0) + 1; continue; }
        if (c.v < 0.3) o.stood++;
        o.longest = Math.max(o.longest, c.still || 0);
        if (!MAIN[L[c.line].c]) continue;
        o.main++;

      }
    }
    return { hour: g.clock.min / 60, places: T ? T.places.map(q => `${q.kind} ${L[q.line].c} ${Math.round(q.x)},${Math.round(q.y)}`) : null, share: T ? T.inbound(g.clock.min / 60) : null,
      main: o.main / o.all, inb: o.inb, outb: o.outb, stood: o.stood / o.all, longest: o.longest, v: o.v / o.all, cars: o.all / secs,
      onTrip: A.C.filter(c => c.line >= 0 && c.trip >= 0).length, parked: A.C.filter(c => c.line >= 0 && c.park).length, parkedIn: A.C.reduce((s, c) => s + (c.parkedIn || 0), 0), left: A.C.reduce((s, c) => s + (c.left || 0), 0), deep: o.deep, ps: A.parkStats, bus: [A.busStops.size, A.busStopped, g.crowd.boarded, g.crowd.alighted, A.deliveries, A.C.filter(c => c.bus).length, A.C.filter(c => c.van).length], ended: A.C.reduce((s, c) => s + (c.trips || 0), 0), mainRoads: L.filter(l => MAIN[l.c]).reduce((s, l) => s + l.len, 0) / L.reduce((s, l) => s + l.len, 0) };
  }, { secs: +secs, off: process.env.TRIPS === '0', min: hm ? +hm[1] * 60 + +hm[2] : null });
  if (process.env.PLACES) console.log(r.places);
  if (r.ps) console.log(JSON.stringify(r.ps));
  if (r.bus) console.log(`bus stops on ${r.bus[0]} pieces of road; ${r.bus[5]} buses stopped ${r.bus[1]} times, ${r.bus[2]} people got on and ${r.bus[3]} off; ${r.bus[6]} vans made ${r.bus[4]} deliveries`);
  console.log(`${city} ${Math.floor(r.hour)}:${String(Math.round(r.hour % 1 * 60)).padStart(2, '0')} ${process.env.TRIPS === '0' ? 'random turns' : `trips (${Math.round(r.share * 100)}% into town, ${r.places.length} places)`}: ${(r.main * 100).toFixed(0)}% of car time on main roads (${(r.mainRoads * 100).toFixed(0)}% of the road length), across a cordon 300 m round you ${r.inb} in : ${r.outb} out (${(r.inb / Math.max(1, r.inb + r.outb) * 100).toFixed(0)}% in), ${(r.stood * 100).toFixed(0)}% standing, longest ${r.longest.toFixed(0)} s, mean ${(r.v * 3.6).toFixed(0)} km/h, ${r.cars.toFixed(0)} cars, ${r.onTrip} on a trip, ${r.ended} trips ended, ${r.parked} at the kerb (${r.parkedIn} pulled in, ${r.left} pulled out), deepest overlap ${(r.deep || 0).toFixed(2)} m`);
  await b.close();
})();
