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
    for (let t = 0; t < T; t++) { g.advance(1); C.forEach((c, i) => { still[i] = c.line >= 0 && c.v < 0.3 ? still[i] + 1 : 0; }); }
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
      rows.push(r);
      by[c.why] = (by[c.why] || 0) + 1;
    });
    rows.sort((x, y) => y.still - x.still);
    return { at: [Math.round(g.player.x), Math.round(g.player.y)], rows, by };
  }, [Number(secs), Number(place), Number(minStill)]);
  console.log(`${city} at ${out.at}: cars still ${minStill} s or more at the end, by what holds them: ${JSON.stringify(out.by)}`);
  for (const r of out.rows) console.log(`  car ${r.car} still ${r.still} s: ${r.why}${r.q ? ' (queueing)' : ''}; ${r.road}; piece ${r.line} (${r.len} m) at ${r.at}${r.mv ? '; ' + r.mv : ''}${r.junction ? '; junction ' + r.junction : ''}${r.front ? '; behind ' + r.front : ''}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
