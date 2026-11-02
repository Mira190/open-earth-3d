// Why the traffic stands: run a city's street traffic headlessly at one of traffic_check.js's
// places and, at the end, list the cars that have stood still for a while, each with what holds it
// (c.why: 'car', 'light', 'cross', 'turn', 'give', 'room', 'lane', 'stop', 'person', 'held'), the
// road and lane it is in, its junction and the light it has, and the car in front of it and what
// holds that one; then a count by reason. A place to start on a jam traffic_check.js reports.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/traffic_why.js sydney [place: 0 the start, 1, 2...] [seconds] [still: s]
const { chromium } = require('playwright');
const [,, city = 'sydney', place = '2', secs = '150', minStill = '20'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const out = await p.evaluate(([T, site, minStill]) => {
    window.requestAnimationFrame = () => 0;
    const g = window.__game, A = g.cars, C = A.C, L = A.netL, JN = A.junctions;
    if (site > 0) { // as traffic_check.js picks its places
      const d = l => Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y);
      const cand = L.filter(l => l.len > 40 && d(l) > 250 * site && d(l) < 300 * site + 200);
      if (cand.length) { const l = cand[(site * 7919) % cand.length], k = Math.floor(l.pts.length / 6) * 3; // (beside the road, on the kerb: not standing in the traffic's way)
          const ex = l.pts[k + 3] - l.pts[k], ey = l.pts[k + 4] - l.pts[k + 1], el = Math.hypot(ex, ey) || 1;
          let off = 7.5;
          for (const o of [6, -6, 9, -9, 12, -12, 16, -16]) if (!g.roadNet.nearest(l.pts[k] - ey / el * o, l.pts[k + 1] + ex / el * o, 5)) { off = o; break; }
          g.player.x = l.pts[k] - ey / el * off; g.player.y = l.pts[k + 1] + ex / el * off; g.player.z = l.pts[k + 2]; }
    }
    g.advance(1);
    const still = C.map(() => 0);
    // (and the movements let into a junction at once that cross, as they happen: by whom and how)
    const pairs = new Map(), idx0 = new Map(C.map((c, i) => [c, i]));
    const mvDesc = (j, o) => { const a = j.arms[o.k], e = (a.exits || []).find(x => x.m.i === (o.m & 15)); return `car ${idx0.get(o.c)} from arm ${o.k} (${L[a.line].c}${L[a.line].ow ? ' one-way' : ''}) lane ${o.m >> 4} to arm ${o.m & 15}${e ? ` (turn ${e.turn.toFixed(2)})` : ''} at ${o.t.toFixed(1)} s${o.forced ? ` (found over its line: ${o.c.overWhy})` : ''}`; };
    for (let t = 0; t < T; t++) {
      g.advance(1);
      C.forEach((c, i) => { still[i] = c.line >= 0 && c.v < 0.3 ? still[i] + 1 : 0; });
      for (const j of JN.J) for (let x = 0; x < j.active.length; x++) for (let y = x + 1; y < j.active.length; y++) {
        const p = j.active[x], q = j.active[y], key = `${j.id}:${p.t}:${q.t}`;
        if (!pairs.has(key) && JN.conflict(j, p.k, p.m, q.k, q.m)) pairs.set(key, `junction ${j.id} (${j.arms.length} arms${j.sig ? ', signals' : ''}): ${mvDesc(j, p)} and ${mvDesc(j, q)}`);
      }
    }
    const idx = new Map(C.map((c, i) => [c, i]));
    const rows = [], by = {};
    C.forEach((c, i) => {
      if (c.line < 0 || still[i] < minStill) return;
      const l = L[c.line], a = c.lineArm, j = a && a.j, f = c.front;
      const r = { car: i, still: still[i], why: c.why + (c.heldBy ? ` by ${c.heldBy}${c.inHeld ? ` ${c.inHeld.toFixed(0)} s` : ''}` : ''), at: [Math.round(c.x), Math.round(c.y)], road: `${l.c}${l.ow ? ' one-way' : ''}, ${JN.lanesOf(l)} lane(s), in ${c.ln || 0}`,
        line: c.line, len: Math.round(l.len), q: !!c.q, mv: c.mv ? `in junction ${c.mv.j.id}` : '',
        junction: a ? `${j.id} (${j.arms.length} arms${j.sig ? ', signals' : ''}${j.arrow ? ', arrow' : ''}), line ${(c.toLine - c.half).toFixed(1)} m ahead, light ${JN.light(a, c.lineEx)}, exit lanes ${c.lineEx ? c.lineEx.lanes : '-'}` : '',
        front: f ? `car ${idx.get(f)} (${f.why}${f.heldBy ? ' by ' + f.heldBy : ''}, still ${still[idx.get(f)]} s, ${f.v.toFixed(2)} m/s, ${Math.hypot(f.x - c.x, f.y - c.y).toFixed(1)} m off, piece ${f.line} ${L[f.line] ? L[f.line].c : ''}${f.mv ? ' in junction ' + f.mv.j.id : ''}${f.lineArm ? `, line ${(f.toLine - f.half).toFixed(1)} m ahead` : ''})` : '' };
      const w = c.why === 'person' && c.who >= 0 && g.crowd.P[c.who];
      if (w) { const X = g.crowd.crossings && g.crowd.crossings.byLine.get(w.line); r.front = `walker ${c.who} (${w.state}, ${w.v.toFixed(2)} m/s, at ${Math.round(w.x)},${Math.round(w.y)}, footway ${w.line} at ${w.s.toFixed(1)} going ${w.dir}${X ? ', crossings at ' + X.map(x => `${x.s.toFixed(1)} (kerb ${x.kerb.toFixed(1)}, walk ${g.crowd.crossings.walk(x.a)})`).join(' ') : ''})`; }
      if (a && (c.why === 'cross' || c.why === 'turn')) r.junction += '; in it: ' + (j.active.map(o => `car ${idx.get(o.c)} (${o.c.why}${o.c.heldBy ? ' by ' + o.c.heldBy : ''} [inHeld ${(o.c.inHeld || 0).toFixed(1)} behindT ${(o.c.behindT || 0).toFixed(1)} tangleT ${(o.c.tangleT || 0).toFixed(1)} backoff ${(o.c.backoff || 0).toFixed(1)} stuck ${(o.c.stuck || 0).toFixed(1)}], ${o.c.v.toFixed(1)} m/s, piece ${o.c.line}${o.c.front ? `, behind car ${idx.get(o.c.front)}` : ''}${o.forced ? ', over its line' : ''})`).join(', ') || 'nothing') + (j.pend.length ? '; waiting longer: ' + j.pend.map(o => `car ${idx.get(o.c)}`).join(', ') : '');
      rows.push(r);
      by[c.why] = (by[c.why] || 0) + 1;
    });
    rows.sort((x, y) => y.still - x.still);
    // and the cars caught up in one another now (footprints that overlap, as traffic_check.js finds them)
    const corners = c => { const fx = Math.sin(c.h), fy = Math.cos(c.h); return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [c.x + fx * c.half * a - fy * c.hw * b, c.y + fy * c.half * a + fx * c.hw * b]); };
    const sep = (P, Q, ax) => { const pr = R => R.map(v => v[0] * ax[0] + v[1] * ax[1]); const a = pr(P), b = pr(Q); return Math.max(...a) < Math.min(...b) - 0.05 || Math.max(...b) < Math.min(...a) - 0.05; };
    const desc = c => `car ${idx.get(c)} (${c.why}${c.heldBy ? ' by ' + c.heldBy : ''}, ${c.v.toFixed(1)} m/s, ${L[c.line].c}${L[c.line].ow ? ' one-way' : ''} piece ${c.line}, ${JN.lanesOf(L[c.line])} lane(s), in ${c.ln || 0} (off ${(c.lo || 0).toFixed(1)} m)${c.mv ? ', in junction ' + c.mv.j.id : ''})`;
    const caught = [];
    for (let i = 0; i < C.length; i++) for (let k = i + 1; k < C.length; k++) {
      const a = C[i], o = C[k];
      if (a.line < 0 || o.line < 0 || Math.abs(a.z - o.z) > 3 || Math.hypot(a.x - o.x, a.y - o.y) > a.half + o.half + 1) continue;
      const P = corners(a), Q = corners(o);
      if (![a.h, a.h + Math.PI / 2, o.h, o.h + Math.PI / 2].some(h => sep(P, Q, [Math.sin(h), Math.cos(h)]))) caught.push(`at ${Math.round(a.x)},${Math.round(a.y)}: ${desc(a)} and ${desc(o)}`);
    }
    return { at: [Math.round(g.player.x), Math.round(g.player.y)], rows, by, caught, crossing: [...pairs.values()] };
  }, [Number(secs), Number(place), Number(minStill)]);
  console.log(`${city} at ${out.at}: cars still ${minStill} s or more at the end, by what holds them: ${JSON.stringify(out.by)}`);
  for (const r of out.rows) console.log(`  car ${r.car} still ${r.still} s: ${r.why}${r.q ? ' (queueing)' : ''}; ${r.road}; piece ${r.line} (${r.len} m) at ${r.at}${r.mv ? '; ' + r.mv : ''}${r.junction ? '; junction ' + r.junction : ''}${r.front ? '; behind ' + r.front : ''}`);
  if (out.crossing.length) console.log(`movements in a junction at once that cross (${out.crossing.length}):\n  ` + out.crossing.slice(0, 40).join('\n  '));
  if (out.caught.length) console.log('caught up in one another now:\n  ' + out.caught.join('\n  '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
