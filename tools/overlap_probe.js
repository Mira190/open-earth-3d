// Why two traffic cars end up inside each other: run a city's game headless with you on foot,
// step the traffic a tenth of a second at a time, and for each pair that comes to overlap print the
// last few seconds of both cars (where, how fast, what each braked for and why, held or squeezing,
// its movement through a junction), so the rule that let it happen can be read off.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=10:00 xvfb-run -a node tools/overlap_probe.js roppongi [seconds] [max pairs]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'roppongi', secs = '60', maxPairs = '6'] = process.argv;

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.advance(1); });
  const watch = (process.env.WATCH || '').split(',').map(Number); // WATCH=x,y,r: also every 2 s the cars within r of (x, y)
  const out = await p.evaluate(({ secs, maxPairs, watch }) => {
    const g = window.__game, C = g.cars.C, hist = new Map(), seen = new Set(), found = [];
    if (watch.length === 3) { // the road lines and junctions there
      const J = g.cars.junctions, L = g.cars.netL, lines = [];
      L.forEach((l, i) => { for (let k = 0; k < l.pts.length; k += 3) if (Math.hypot(l.pts[k] - watch[0], l.pts[k + 1] - watch[1]) < watch[2]) { lines.push(i); break; } });
      found.push({ t: 0, deep: 0, key: 'lines', a: lines.map(i => { const l = L[i], P = l.pts, n = P.length; return `line ${i} len ${l.len.toFixed(1)} ow ${l.ow || 0} lanes ${J.lanesOf(l)} (${P[0].toFixed(1)}, ${P[1].toFixed(1)}) -> (${P[n - 3].toFixed(1)}, ${P[n - 2].toFixed(1)}) arm0 ${J.armAt(i, 0) ? J.armAt(i, 0).j.id + ' back ' + J.armAt(i, 0).back.toFixed(1) : '-'} arm1 ${J.armAt(i, 1) ? J.armAt(i, 1).j.id + ' back ' + J.armAt(i, 1).back.toFixed(1) : '-'} inner ${J.inner(i) ? 1 : 0}`; }), b: [] });
    }
    const box = (a, b) => { // separating axes, how deep two cars' boxes overlap
      let deep = Infinity;
      for (const s of [a, b]) for (const ax of [[Math.sin(s.h), Math.cos(s.h)], [-Math.cos(s.h), Math.sin(s.h)]]) {
        const pr = c => Math.abs(Math.sin(c.h) * ax[0] + Math.cos(c.h) * ax[1]) * c.half + Math.abs(-Math.cos(c.h) * ax[0] + Math.sin(c.h) * ax[1]) * (c.hw || 0.9);
        const d = Math.abs((b.x - a.x) * ax[0] + (b.y - a.y) * ax[1]);
        deep = Math.min(deep, pr(a) + pr(b) - d);
      }
      return deep;
    };
    const snap = (c, t) => `t ${t.toFixed(1)} ${c.model || 'car'}#${C.indexOf(c)} line ${c.line} s ${c.s.toFixed(1)} dir ${c.dir} v ${c.v.toFixed(2)} (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) h ${(c.h * 57.3).toFixed(0)} ln ${c.ln} lo ${(+c.lo).toFixed(2)} off ${c.off.toFixed(2)} why ${c.why} held ${c.heldBy || '-'} front ${c.front ? (c.front.model ? C.indexOf(c.front) : 'you') : '-'} q ${c.q ? 1 : 0} mv ${c.mv ? c.mv.j.id + ':' + c.mv.a.line : '-'} toLine ${c.toLine != null ? (+c.toLine).toFixed(1) : '-'} inHeld ${(c.inHeld || 0).toFixed(1)} tangle ${(c.tangleT || 0).toFixed(1)} stuck ${(c.stuck || 0).toFixed(1)} np ${c.np}`;
    for (let t = 0; t < secs && found.filter(f => f.deep > 0).length < maxPairs; t += 0.1) {
      g.advance(0.1);
      const A = C.slice(0, g.cars.active).filter(c => c.line >= 0);
      for (const c of A) { const h = hist.get(c) || []; h.push(snap(c, t)); if (h.length > 40) h.shift(); hist.set(c, h); }
      if (watch.length === 3 && Math.round(t * 10) % 20 === 0) found.push({ t: +t.toFixed(1), deep: 0, key: 'watch', a: A.filter(c => Math.hypot(c.x - watch[0], c.y - watch[1]) < watch[2]).map(c => snap(c, t)), b: [] });
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
        const a = A[i], c = A[j];
        if (Math.abs(a.x - c.x) > 12 || Math.abs(a.y - c.y) > 12 || Math.abs(a.z - c.z) > 3) continue;
        const d = box(a, c), key = C.indexOf(a) + '-' + C.indexOf(c);
        if (d > 0.2 && !seen.has(key)) {
          seen.add(key);
          found.push({ t: +t.toFixed(1), deep: +d.toFixed(2), key, a: hist.get(a).slice(-30), b: hist.get(c).slice(-30) });
        }
      }
      // walkers inside a car: the car's last few seconds, and the walker where it is
      for (const q of g.crowd.P.slice(0, g.crowd.active)) {
        if (q.line < 0) continue;
        for (const c of A) {
          if (Math.abs(c.x - q.x) > 6 || Math.abs(c.y - q.y) > 6 || Math.abs(c.z - q.z) >= 2) continue;
          const fx = Math.sin(c.h), fy = Math.cos(c.h), dx = q.x - c.x, dy = q.y - c.y;
          const d = Math.min(c.half + 0.2 - Math.abs(dx * fx + dy * fy), (c.hw || 0.9) + 0.2 - Math.abs(-dx * fy + dy * fx));
          const key = 'w' + g.crowd.P.indexOf(q) + '-' + C.indexOf(c);
          if (d > 0.1 && !seen.has(key)) {
            seen.add(key);
            found.push({ t: +t.toFixed(1), deep: +d.toFixed(2), key, a: hist.get(c).slice(-30), b: [`walker (${q.x.toFixed(1)}, ${q.y.toFixed(1)}) state ${q.state} v ${(q.v || 0).toFixed(2)} give ${q.give ? 1 : 0} line ${q.line}`] });
          }
        }
      }
    }
    return found;
  }, { secs: +secs, maxPairs: +maxPairs, watch });
  for (const f of out) {
    console.log(`\n=== pair ${f.key} at t ${f.t}: ${f.deep} m deep`);
    console.log('-- a'); for (const l of f.a) console.log('  ' + l);
    console.log('-- b'); for (const l of f.b) console.log('  ' + l);
  }
  console.log(`${out.filter(f => f.deep > 0).length} pairs`);
  await b.close();
})();
