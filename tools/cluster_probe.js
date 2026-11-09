// Watch the traffic round a few junctions (a cluster that jams, #330/#331): load a city's game with
// the clock pinned, leave the player on foot at the start (or at x,y), step the traffic T seconds and
// report, every `every` seconds, each car within R m of the place that has stood still 20 s or more,
// with what holds it, the head of its queue and every movement in the junctions named. At the end:
// the longest stand seen, the car-seconds stood 30 s or more in the place, and the junctions' layout.
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=10:00 xvfb-run -a node tools/cluster_probe.js shinjuku [T=400] [jids=1103,1105,1106,1108,1120] [R=250] [every=20] [x,y]
// Exits 1 when a car stood 90 s or more (STAND_MAX) in the place.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shinjuku', secs = '400', jids = '1103,1105,1106,1108,1120', rad = '250', every = '20', at = ''] = process.argv;
const MAXS = Number(process.env.STAND_MAX || 90);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await pinClock(p, city);
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const r = await p.evaluate(([T, jids, R, every, at]) => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game, A = g.cars, C = A.C, JN = g.junctions, L = A.netL;
    if (at) { const [x, y] = at.split(',').map(Number); g.player.x = x; g.player.y = y; }
    const ox = g.player.x, oy = g.player.y, ids = jids ? jids.split(',').map(Number) : [];
    const idx = new Map(C.map((c, i) => [c, i]));
    const out = [];
    const lay = ids.map(id => { const j = JN.J[id]; return `junction ${id}${j.scramble ? ' (scramble)' : ''} at ${j.x.toFixed(0)},${j.y.toFixed(0)} sig ${!!j.sig}: ` + j.arms.map(a => `arm ${a.i} piece ${a.line} (len ${L[a.line].len.toFixed(0)}, end ${a.end}, back ${a.back.toFixed(1)}${L[a.line].ow ? ', one-way ' + L[a.line].ow : ''})`).join('; '); });
    const desc = c => `car ${idx.get(c)}${c.model && !/^Car_(Sedan|Taxi|Hatch|SUV)$/.test(c.model) ? ` (${c.model})` : ''} ${c.why}${c.heldBy ? ' by ' + c.heldBy : ''} v ${c.v.toFixed(1)} still ${(c.still || 0).toFixed(0)} on ${c.line}/${c.dir} s ${c.s.toFixed(1)}/${L[c.line].len.toFixed(0)}${c.lineArm ? ` line j${c.lineArm.j.id}a${c.lineArm.i} ${(c.toLine - c.half).toFixed(1)} m lt ${JN.light(c.lineArm, c.lineEx)}` : ''}${c.mv ? ` in j${c.mv.j.id} ${c.mv.a.i}->${c.mv.e.m.i}` : ''}${c.mv0 ? ` mv0 j${c.mv0.j.id}` : ''}${c.rev ? ` REV d ${c.rev.d.toFixed(1)} wait ${c.rev.wait.toFixed(1)}` : ''}${c.revEnd ? ` revEnd(${c.revEnd})` : ''}${c.front && c.front.line != null ? ` > ${idx.has(c.front) ? 'car ' + idx.get(c.front) : 'extra'}` : ''}`;
    const head = c => { let x = c, k = 0; const seen = new Set(); while (x.front && x.front.line != null && idx.has(x.front) && !seen.has(x.front) && k < 40) { seen.add(x); x = x.front; k++; } return { x, k, ring: seen.has(x.front) }; };
    let longest = 0, longestWhat = '', stood30 = 0;
    const lost = new Map(), gl = new Map(), thru = new Map(), seenMv = new Set(); // (junction/arm/why of the head of each standing queue -> car-seconds stood behind it, itself included)
    for (let s = 1; s <= T; s++) {
      g.advance(1);
      for (const c of C) if (c.line >= 0 && Math.hypot(c.x - ox, c.y - oy) < R) {
        if ((c.still || 0) >= 30) stood30++;
        if ((c.still || 0) >= 10) { const h = head(c).x, k = h.lineArm ? `j${h.lineArm.j.id} arm ${h.lineArm.i} (piece ${h.lineArm.line}) ${h.why}` : h.mv ? `in j${h.mv.j.id} ${h.why}` : `piece ${h.line} ${h.why}`; lost.set(k, (lost.get(k) || 0) + 1); }
        if ((c.still || 0) > longest) { longest = c.still; longestWhat = `t ${s}: ` + desc(c) + (h => h.x !== c ? ` | head (${h.k} on${h.ring ? ', RING' : ''}): ` + desc(h.x) : '')(head(c)); }
      }
      // (the cars let into the junctions named, by arm: each movement once)
      for (const id of ids) for (const o of JN.J[id].active) { const k = `${id}:${idx.get(o.c)}:${o.t}`; if (!seenMv.has(k)) { seenMv.add(k); const a = `j${id} arm ${o.k}`; thru.set(a, (thru.get(a) || 0) + 1); } }
      // (green lost at the junctions named: a car at the head of an arm's queue, at its line, standing on its green, and why)
      for (const c of C) if (c.line >= 0 && c.lineArm && ids.includes(c.lineArm.j.id) && c.toLine - c.half < 3 && c.v < 0.3 && JN.light(c.lineArm, c.lineEx) === 'g') { const k = `j${c.lineArm.j.id} arm ${c.lineArm.i}: ${c.why}${c.heldBy ? ' by ' + c.heldBy : ''}`; gl.set(k, (gl.get(k) || 0) + 1); }
      if (s % every === 0) {
        const st = C.filter(c => c.line >= 0 && Math.hypot(c.x - ox, c.y - oy) < R && (c.still || 0) >= 20).sort((a, b) => b.still - a.still);
        const heads = new Map();
        for (const c of st) { const h = head(c); const e = heads.get(h.x) || { n: 0, h }; e.n++; heads.set(h.x, e); }
        out.push(`t ${s}: ${st.length} cars stood 20 s+ within ${R} m; queue heads:`);
        for (const [x, e] of heads) out.push(`   ${e.n} behind/at: ${desc(x)}${e.h.ring ? ' RING' : ''}`);
        for (const id of ids) { const j = JN.J[id]; if (j.active.length) out.push(`   j${id} ph ${j.ph} ${j.st}: ` + j.active.map(o => desc(o.c) + ` (in ${(s - (o.t || 0)).toFixed ? '' : ''})`).join(' | ')); }
      }
    }
    out.push('car-seconds stood (10 s+) by the head of their queue:');
    for (const [k, n] of [...lost].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`   ${String(n).padStart(5)}  ${k}`);
    out.push('cars let in, by arm: ' + [...thru].sort().map(([k, n]) => `${k} ${n}`).join(', '));
    out.push('seconds a head stood at its line on green, by why:');
    for (const [k, n] of [...gl].sort((a, b) => b[1] - a[1]).slice(0, 12)) out.push(`   ${String(n).padStart(5)}  ${k}`);
    return { lay, out, longest, longestWhat, stood30, stats: A.stats ? (s => ({ revs: s.revs, outOfRing: s.outOfRing, redRuns: s.redRuns })) (A.stats()) : {} };
  }, [Number(secs), jids, Number(rad), Number(every), at]);
  for (const l of r.lay) console.log(l);
  for (const l of r.out) console.log(l);
  console.log(`longest stand ${r.longest.toFixed(0)} s: ${r.longestWhat}`);
  console.log(`car-seconds stood 30 s+ within ${rad} m: ${r.stood30}; ${JSON.stringify(r.stats)}`);
  // EXPR: a JavaScript expression evaluated in the page afterwards (g the game, A its traffic, C the cars, JN the junctions), printed as JSON
  if (process.env.EXPR) console.log(JSON.stringify(await p.evaluate(e => { const g = window.__game, A = g.cars, C = A.C, JN = g.junctions, L = A.netL; return eval(e); }, process.env.EXPR), null, 1));
  await b.close();
  process.exit(r.longest >= MAXS ? 1 : 0);
})();
