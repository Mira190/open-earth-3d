// How close the crowd's walkers come to one another: run a city's game headless with you on foot,
// step it a tenth of a second at a time, and count the pairs of walkers whose centres come closer
// than a body's width (they show inside each other), split by how near to you they were.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=17:30 xvfb-run -a node tools/crowd_spacing.js shibuya [seconds]
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', secs = '60'] = process.argv;

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(1); });
  const out = await p.evaluate(secs => {
    const g = window.__game, P = g.crowd.P, me = g.player;
    const LIM = [0.3, 0.4, 0.5], pairs = LIM.map(() => ({ near: new Set(), far: new Set() }));
    let jumps = 0, frames = 0, walkers = 0, minD = Infinity, stuck = 0, turns = 0;
    const why = [], stuckWhy = [], jumpWhy = [], last = new Map(), snap = q => `${q.state} line ${q.line} s ${q.s.toFixed(2)} dir ${q.dir} lat ${(q.lat ?? 0).toFixed(2)} v ${(q.v ?? 0).toFixed(2)} (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`;
    let prev = new Map(), was = new Set();
    const queued = new Set(), stillT = new Map(), dirs = new Map();
    for (let t = 0; t < secs; t += 1 / 30) {
      g.advance(1 / 30);
      const px = me.x, py = me.y;
      const A = P.slice(0, g.crowd.active).map((q, i) => [q, i]).filter(([q]) => q.line >= 0 && q.mode !== 'sit');
      frames++; walkers += A.length;
      const now = new Set(), cur = new Map();
      for (const [q, i] of A) {
        cur.set(i, snap(q));
        // a jump: farther in one step than anyone walks (a corner taken with the offset swung across, say)
        const lp = last.get(i);
        if (lp) { const e = Math.hypot(q.x - lp[0], q.y - lp[1]); if (e > 0.25 && e < 20 && Math.hypot(q.x - px, q.y - py) < 60) { jumps++; if (jumpWhy.length < 6) jumpWhy.push(`t ${t.toFixed(2)} ${e.toFixed(2)} m: before ${prev.get(i)}  now ${cur.get(i)}`); } }
        last.set(i, [q.x, q.y]);
        if (Math.hypot(q.x - px, q.y - py) > 60 || q.state !== 'walk') continue;
        // stood still a long while, not at a kerb waiting for the walk: stuck
        // stood still a long while, not at a kerb waiting for the walk nor queued behind someone who is: stuck
        const ahead = A.find(([o]) => o !== q && Math.hypot(o.x - q.x, o.y - q.y) < 1.3 && ((o.x - q.x) * q.hx + (o.y - q.y) * q.hy) > 0 && (o.kw || (o.v ?? 0) < 0.05 && queued.has(o)));
        const st = (q.v ?? 0) < 0.05 && !q.kw && !ahead ? (stillT.get(i) || 0) + 1 / 30 : 0;
        if ((q.v ?? 0) < 0.05 && (q.kw || ahead)) queued.add(q); else queued.delete(q);
        if (st > 3 && (stillT.get(i) || 0) <= 3) {
          stuck++;
          if (stuckWhy.length < 8) { let bd = Infinity, bo = null; for (const [o] of A) if (o !== q) { const e = Math.hypot(o.x - q.x, o.y - q.y); if (e < bd) { bd = e; bo = o; } }
            stuckWhy.push(`t ${t.toFixed(1)} ${snap(q)} pause ${(q.pause || 0).toFixed(1)} wait ${(q.wait || 0).toFixed(1)}; nearest walker ${bd.toFixed(2)} m: ${bo ? snap(bo) + " kw " + (bo.kw || 0).toFixed(1) : '-'}`); }
        }
        stillT.set(i, st);
        if (dirs.has(i) && dirs.get(i)[0] === q.line && dirs.get(i)[1] !== q.dir) turns++;
        dirs.set(i, [q.line, q.dir]);
      }
      for (let a = 0; a < A.length; a++) for (let c = a + 1; c < A.length; c++) {
        const [q, i] = A[a], [r, j] = A[c];
        if (Math.abs(q.z - r.z) > 1.5) continue;
        const d = Math.hypot(q.x - r.x, q.y - r.y);
        if (d >= LIM[LIM.length - 1]) continue;
        const near = Math.hypot(q.x - px, q.y - py) < 60, key = i + '-' + j;
        LIM.forEach((L, k) => { if (d < L) pairs[k][near ? 'near' : 'far'].add(key); });
        if (near && d < minD) minD = d;
        if (near && d < 0.4) { now.add(key); if (!was.has(key) && why.length < 10) why.push(`t ${t.toFixed(2)} d ${d.toFixed(2)}\n    A before ${prev.get(i)}\n    A now    ${cur.get(i)}\n    B before ${prev.get(j)}\n    B now    ${cur.get(j)}`); }
      }
      prev = cur; was = now;
    }
    return { frames, walkers: Math.round(walkers / frames), minD, stuck, turns, pairs: LIM.map((L, k) => `< ${L} m: ${pairs[k].near.size} pairs within 60 m of you, ${pairs[k].far.size} farther`),  worst: why, stuckWhy, jumps, jumpWhy };
  }, +secs);
  console.log(`${city}: ${out.walkers} walkers on average over ${out.frames} steps, closest pair near you ${out.minD.toFixed(2)} m; near you ${out.stuck} times someone stood stuck over 3 s, ${out.turns} turned back`);
  for (const l of out.pairs) console.log('  ' + l);
  for (const l of out.worst) console.log('  ' + l);
  console.log(`  ${out.jumps} jumps of over 0.25 m in a step near you`);
  for (const l of out.jumpWhy) console.log('  jump: ' + l);
  for (const l of out.stuckWhy) console.log('  stuck: ' + l);
  await b.close();
})();
