// A scramble's cycle and the queues at its arms over a run of the city's traffic (#264): every second, the
// phase, its state and time, the crowd still out on its road (busy), and per arm the cars queued and how long
// the head has stood. Prints a line when a head has stood longer than two cycles, and a summary.
//   GAME_TIME=10:00 xvfb-run -a node tools/scramble_cycle_probe.js shinjuku [seconds=300] [junction id]
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shinjuku', secs = '300', jid = ''] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  const pinned = await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  if (pinned) await p.evaluate(spec => { const g = window.__game, m = /(\d\d?):(\d\d)$/.exec(spec), min = +m[1] * 60 + +m[2]; if (Math.abs(g.clock.min - min) < 30) { g.setClock(g.clock.y, g.clock.m, g.clock.d, min); g.crowdAuto(true); } }, pinned.spec);
  if (process.env.BUSY) await p.evaluate(() => { globalThis.BUSY = 1; });
  const r = await p.evaluate(([secs, jid]) => {
    const g = window.__game, JN = g.junctions, C = g.cars.C, out = [];
    const S = JN.J.filter(j => j.scramble && (!jid || String(j.id) === jid));
    const stat = new Map(S.map(j => [j.id, { cycles: 0, redHeld: 0, busyMax: 0, worst: 0, phases: [] }]));
    for (let t = 0; t < secs; t++) {
      g.advance(1);
      for (const j of S) {
        const s = stat.get(j.id), key = `${j.ph}${j.st}`;
        if (s.last !== key) { s.phases.push(`${t}:${key}`); if (j.ph === 3 && j.st === 'g') s.cycles++; s.last = key; }
        if (j.ph === 3 && j.st === 'r') s.redHeld++;
        // (with BUSY=1: who keeps it busy through the cars' green)
        if (globalThis.BUSY && j.ph < 2 && j.st === 'g' && j.busy > 0 && t % 10 === 0) {
          const cr = g.crowd, who = [];
          for (let i = 0; i < cr.active; i++) {
            const q = cr.P[i];
            if (Math.hypot(q.x - j.x, q.y - j.y) > j.reach + 2) continue;
            if (q.pz && q.pz.j === j) { if (q.ph === 'cross' || (q.ph === 'stroll' && q.pz.road && q.pz.road(q.x, q.y))) who.push(`plaza#${i} ${q.ph} v ${(q.v || 0).toFixed(2)} at ${q.x.toFixed(1)},${q.y.toFixed(1)} T ${q.T.x.toFixed(1)},${q.T.y.toFixed(1)}${q.pz.road(q.T.x, q.T.y) ? ' (T in the road)' : ''} gate ${q.g ? `${q.g.x.toFixed(1)},${q.g.y.toFixed(1)} n ${q.g.n}` : '-'} pause ${(q.pause || 0).toFixed(1)}`); continue; }
            const X = cr.crossings && cr.crossings.byLine && cr.crossings.byLine.get(q.line);
            if (X) for (const x of X) if (x.scramble === j && Math.abs(x.s - q.s) < x.kerb - 0.3) who.push(`foot#${i} line ${q.line} s ${q.s.toFixed(1)} x.s ${x.s.toFixed(1)} kerb ${x.kerb.toFixed(1)} v ${(q.v || 0).toFixed(2)} state ${q.state || q.mode || ''} kw ${(q.kw || 0).toFixed(1)} pause ${(q.pause || 0).toFixed(1)}`);
          }
          out.push(`${t}s busy ${j.busy} at ${j.id} (${j.ph}${j.st} ${j.t.toFixed(0)} s): ${who.join('; ')}`);
        }
        s.busyMax = Math.max(s.busyMax, j.busy || 0);
        for (const a of j.arms) {
          if (!a.in) continue;
          const q = C.filter(c => c.line >= 0 && c.lineArm === a && c.v < 0.3 && c.toLine - c.half < 40);
          const hd = q.reduce((m, c) => (!m || c.toLine < m.toLine ? c : m), null);
          if (hd && (hd.still || 0) > s.worst) s.worst = hd.still;
          if (hd && (hd.still || 0) > 60 && JN.light(a, hd.lineEx) !== 'r' && !(a.flag > t - 4)) { a.flag = t; out.push(`${t}s junction ${j.id} arm ${a.i} (phase ${a.phase}): car ${C.indexOf(hd)} ${hd.why}${hd.heldBy ? ' by ' + hd.heldBy : ''} still ${hd.still.toFixed(0)} s, ${(hd.toLine - hd.half).toFixed(1)} m from its line, ${q.length} queued; light ${JN.light(a, hd.lineEx)}, now ${j.ph}${j.st} ${j.t.toFixed(0)} s, busy ${j.busy || 0}, active ${j.active.map(x => `car ${C.indexOf(x.c)} ${x.c.why} v ${(x.c.v || 0).toFixed(1)}`).join(', ') || 'none'}`); }
        }
      }
    }
    return { out, stat: [...stat].map(([id, s]) => ({ id, cycles: s.cycles, redHeld: s.redHeld, busyMax: s.busyMax, worstHead: +(+s.worst).toFixed(0), phases: s.phases.slice(0, 40).join(' ') })) };
  }, [+secs, jid]);
  for (const l of r.out) console.log(l);
  for (const s of r.stat) console.log(JSON.stringify(s));
  await b.close();
})();
