// How a bus (or any long vehicle of the traffic) turns at a junction: follow the buses round you until
// several have turned, and trace each turn every tenth of a second: the sideways slip of its rear axle
// (a real vehicle's rear wheels roll along its heading: a slip is the body skating sideways), how fast its
// heading changes against what its wheelbase allows at that speed, and the jumps in its heading.
// With OUT, stills from above of the worst turn. DETAIL=1: the samples round its biggest jump in heading
// (x, y, heading in degrees, speed, piece, s, dir, why).
//   GAME_TIME=10:00 xvfb-run -a node tools/bus_turn.js tokyo [turns=6]
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'tokyo', want = '6'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.cars', null, { timeout: 400000 });
  const r = await p.evaluate(async ([want, detail]) => {
    const g = window.__game, C = g.cars.C, turns = [], track = new Map();
    for (let t = 0; g.arriving() && t < 10; t += 0.25) g.advance(0.25);
    const ang = a => Math.atan2(Math.sin(a), Math.cos(a));
    for (let k = 0; k < 6000 && turns.length < want; k++) {
      g.advance(0.1);
      for (const c of C) {
        if (c.line < 0 || !(c.half > 3.5)) { track.delete(c); continue; }
        let T = track.get(c);
        if (!T) track.set(c, T = { pts: [], mv: false });
        const lp = T.pts[T.pts.length - 1];
        if (lp && Math.hypot(c.x - lp[0], c.y - lp[1]) > 5) { T.pts = []; T.mv = false; } // (put back elsewhere, or turned round in the road: not a turn)
        T.pts.push([c.x, c.y, c.h, c.v, !!c.mv, c.line, +c.s.toFixed(2), c.dir, c.why]);
        if (c.mv) T.mv = true;
        if (T.pts.length > 400) T.pts.shift();
        if (T.mv && !c.mv) { // through a junction: was it a turn?
          const P = T.pts, i0 = Math.max(0, P.findIndex(q => q[4]) - 30), Q = P.slice(i0), dh = ang(Q[Q.length - 1][2] - Q[0][2]);
          T.mv = false; T.pts = [];
          if (Math.abs(dh) < 0.6) continue;
          const wb = c.half * 1.15, rear = c.half * 0.55; // (a 12 m bus: about 6.9 m between its axles, the rear axle 3.3 m behind its middle)
          let slip = 0, over = 0, jump = 0, at = null, ji = 0;
          for (let i = 1; i < Q.length; i++) {
            const [x0, y0, h0] = Q[i - 1], [x1, y1, h1, v] = Q[i];
            const rx0 = x0 - Math.sin(h0) * rear, ry0 = y0 - Math.cos(h0) * rear, rx1 = x1 - Math.sin(h1) * rear, ry1 = y1 - Math.cos(h1) * rear;
            const mx = rx1 - rx0, my = ry1 - ry0, side = -mx * Math.cos(h1) + my * Math.sin(h1); // (sideways of its heading: x east, y north, h from north)
            if (Math.abs(side) / 0.1 > Math.abs(slip)) { slip = side / 0.1; at = [x1, y1]; }
            const yaw = Math.abs(ang(h1 - h0)) / 0.1, lim = Math.max(0.05, v) / (wb / Math.tan(0.6)); // (lock about 34 degrees)
            over = Math.max(over, yaw / lim);
            if (Math.abs(ang(h1 - h0)) > jump) { jump = Math.abs(ang(h1 - h0)); ji = i; }
          }
          turns.push({ id: C.indexOf(c), turn: +(dh * 57.3).toFixed(0), slip: +slip.toFixed(2), yawOverLock: +over.toFixed(2), jumpDeg: +(jump * 57.3).toFixed(1), at: at && at.map(Math.round), half: +c.half.toFixed(2), ...(detail ? { near: Q.slice(Math.max(0, ji - 4), ji + 3).map(q => [+q[0].toFixed(2), +q[1].toFixed(2), +(q[2] * 57.3).toFixed(1), +q[3].toFixed(1), q[5], q[6], q[7], q[8]]) } : {}) });
        }
      }
    }
    return turns;
  }, [+want, !!process.env.DETAIL]);
  for (const t of r) console.log(JSON.stringify(t));
  await b.close();
})();
