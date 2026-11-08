// The crowd and the player on one narrow way: you stand still on a footway (a torii tunnel two people wide,
// say) and walkers come at you along it. Each should step round you, or, where there is no room, turn back
// at once, rather than stand in front of you for seconds. Prints, for each walker sent, how long it stood
// stopped within 2 m of you (in front of you, or face to face with one that turned back there) and whether it
// got past or turned; fails if any stood more than MAX s (3: one walker alone steps round you or turns back
// within a second; a file of them squeezing past you in a 1.5 m tunnel waits on each other a little longer).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/crowd_yield.js fushimi-inari -181.4 73.8      # a point on the footway (local frame)
// env: N=8 walkers, MAX=3, OFF=0.4 (you stand that far left of the footway's line, m),
// TRACE=1 (that walker every 0.5 s: [t, distance, speed, dir, lat, detour left, stuck, still, squeeze])
const { chromium } = require('playwright');
const [,, city = 'fushimi-inari', X = '-181.4', Y = '73.8'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => {});
  await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return !t || t.hidden; }, null, { timeout: 120000 }).catch(() => {});
  const r = await p.evaluate(([x, y, N, MAX, OFF, TRACE]) => {
    const g = window.__game, net = g.crowdNet, C = g.crowd, tmp = {};
    g.advance(5);
    // the footway line nearest the point, and where on it
    let best = null;
    for (let li = 0; li < net.L.length; li++) {
      const L = net.L[li].len;
      for (let s = 0; s <= L; s += 0.5) { net.at(li, s, tmp); const d = Math.hypot(tmp.x - x, tmp.y - y); if (!best || d < best.d) best = { li, s, d, x: tmp.x - tmp.hy * OFF, y: tmp.y + tmp.hx * OFF, z: tmp.z }; }
    }
    if (!best || best.d > 5) return { error: `no footway within 5 m of ${x}, ${y}` };
    const L = net.L[best.li].len;
    Object.assign(g.player, { x: best.x, y: best.y, z: best.z, speed: 0, vz: 0, ground: true });
    g.crowdAuto(false);
    // clear the way, then walkers on the same line coming at you, every 4 m from 4 m off
    const far = (q) => { q.line = -1; };
    for (const q of C.P) if (Math.hypot(q.x - best.x, q.y - best.y) < 40) far(q);
    const room = best.s > L / 2 ? -1 : 1; // (the longer side of the line)
    const sent = [], trace = [];
    for (const q of C.P) {
      if (sent.length >= N) break;
      if (q.line >= 0 && Math.hypot(q.x - best.x, q.y - best.y) < 60) continue;
      const s = best.s + room * (4 + sent.length * 4);
      if (s < 0 || s > L) break;
      q.line = best.li; q.s = s; q.dir = -room; q.lat = null; q.side = 0.3; q.state = 'walk'; q.mode = 'ground'; q.pause = 0; q.seat = null; q.pz = null;
      q.still = q.slow = q.stuckT = q.pStuck = 0; q.detourT = 0;
      sent.push({ q, stop: 0, maxStop: 0, past: false, turned: false });
    }
    C.active = C.P.length;
    for (let k = 0; k < 300; k++) { // 30 s
      g.player.x = best.x; g.player.y = best.y; g.player.speed = 0;
      g.advance(0.1);
      if (TRACE && k % 5 === 0 && sent[TRACE - 1]) { const q = sent[TRACE - 1].q; trace.push([k / 10, +Math.hypot(q.x - best.x, q.y - best.y).toFixed(2), +q.v.toFixed(2), q.dir, +(q.lat || 0).toFixed(2), +(q.detourT || 0).toFixed(1), +(q.stuckT || 0).toFixed(1), +(q.still || 0).toFixed(1), +(q.squeeze || 0).toFixed(1)]); }
      for (const w of sent) {
        const q = w.q, d = Math.hypot(q.x - best.x, q.y - best.y);
        if (q.line !== best.li) { if (!w.past && !w.turned) w.left = true; continue; }
        if (d < 2 && q.v < 0.1 && !(q.pause > 0)) { w.stop += 0.1; w.maxStop = Math.max(w.maxStop, w.stop); } else w.stop = 0;
        if ((q.s - best.s) * room < -0.5) w.past = true;
        if (q.dir === room && !w.past) w.turned = true;
      }
    }
    return { trace: TRACE ? trace : undefined, line: best.li, len: L, at: best.s, walkers: sent.map(w => ({ maxStop: +w.maxStop.toFixed(1), past: w.past, turned: w.turned, left: !!w.left })) };
  }, [+X, +Y, +(process.env.N || 8), +(process.env.MAX || 3), +(process.env.OFF || 0), +(process.env.TRACE || 0)]);
  console.log(JSON.stringify(r));
  const MAX = +(process.env.MAX || 3), worst = r.walkers ? Math.max(0, ...r.walkers.map(w => w.maxStop)) : Infinity;
  console.log(r.walkers ? `longest stand in front of you: ${worst.toFixed(1)} s (limit ${MAX})` : r.error);
  await b.close();
  process.exit(worst <= MAX ? 0 : 1);
})();
