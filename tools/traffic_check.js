// Measure a city's street traffic headlessly: load the game, leave the player on foot at a few
// places (the start, then points on its roads), run the traffic there for a while and report how
// it flowed: the share of cars standing still, the cars jammed for half a minute or more, the
// turns back where a jam would not clear, the cars caught up in one another, and, at the
// junctions (junctions.js), the cars that crossed a stop line on red and the movements let into a
// junction at once that cross. The game's own frame loop is stopped, so a run is the same each
// time. Exits 1 when the traffic jams, tangles or runs a red.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/traffic_check.js sydney [seconds per place] [places]
const { chromium } = require('playwright');
const [,, city = 'sydney', secs = '150', places = '3'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], runs = [];
  for (let site = 0; site < Number(places); site++) {
    const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
    p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    const r = await p.evaluate(([T, site]) => {
      window.requestAnimationFrame = () => 0; // the game's frame loop stops: the run steps only here
      const g = window.__game, A = g.cars, C = A.C, L = A.netL;
      if (site > 0) { // a place on the roads, the same each time: the middle of a road piece some way from the start
        const d = l => Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y);
        const cand = L.filter(l => l.len > 40 && d(l) > 250 * site && d(l) < 300 * site + 200);
        if (cand.length) { const l = cand[(site * 7919) % cand.length], k = Math.floor(l.pts.length / 6) * 3; g.player.x = l.pts[k]; g.player.y = l.pts[k + 1]; g.player.z = l.pts[k + 2]; }
      }
      g.advance(1);
      // footprints that overlap (separating axes), on one level
      const corners = c => { const fx = Math.sin(c.h), fy = Math.cos(c.h); return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [c.x + fx * c.half * a - fy * c.hw * b, c.y + fy * c.half * a + fx * c.hw * b]); };
      const sep = (P, Q, ax) => { const pr = R => R.map(v => v[0] * ax[0] + v[1] * ax[1]); const a = pr(P), b = pr(Q); return Math.max(...a) < Math.min(...b) - 0.05 || Math.max(...b) < Math.min(...a) - 0.05; };
      const overlap = (c, o) => {
        if (Math.abs(c.z - o.z) > 3 || Math.hypot(c.x - o.x, c.y - o.y) > c.half + o.half + 1) return false;
        const P = corners(c), Q = corners(o);
        return ![c.h, c.h + Math.PI / 2, o.h, o.h + Math.PI / 2].some(h => sep(P, Q, [Math.sin(h), Math.cos(h)]));
      };
      const prev = C.map(c => ({ line: c.line, dir: c.dir, x: c.x, y: c.y }));
      const still = C.map(() => 0);
      let samples = 0, stopped = 0, dist = 0, carSecs = 0, turns = 0, worstJam = 0, jammed = 0, jammedNow = 0, overlaps = 0, overlapMax = 0;
      const warm = Math.min(60, T / 4);
      for (let t = 0; t < T; t++) {
        g.advance(1);
        if (t < warm) { C.forEach((c, i) => { prev[i] = { line: c.line, dir: c.dir, x: c.x, y: c.y }; still[i] = c.v < 0.3 ? still[i] + 1 : 0; }); continue; }
        samples++;
        let ov = 0;
        jammedNow = 0;
        for (let i = 0; i < A.active; i++) {
          const c = C[i], q = prev[i];
          if (c.line < 0) { prev[i] = { line: -1 }; still[i] = 0; continue; }
          carSecs++;
          if (c.v < 0.3) stopped++;
          still[i] = c.v < 0.3 ? still[i] + 1 : 0;
          if (still[i] >= 30) jammedNow++;
          worstJam = Math.max(worstJam, still[i]);
          const d = q.line >= 0 ? Math.hypot(c.x - q.x, c.y - q.y) : 0;
          if (d < 40) dist += d; // (not a car put back in the traffic elsewhere)
          if (q.line === c.line && q.dir !== c.dir) turns++;
          for (let j = i + 1; j < A.active; j++) if (C[j].line >= 0 && overlap(c, C[j])) ov++;
          prev[i] = { line: c.line, dir: c.dir, x: c.x, y: c.y };
        }
        jammed += jammedNow;
        overlaps += ov; overlapMax = Math.max(overlapMax, ov);
      }
      const out = { at: [Math.round(g.player.x), Math.round(g.player.y)], cars: A.active, seconds: samples, stoppedShare: stopped / Math.max(1, carSecs), meanSpeed: dist / Math.max(1, carSecs),
        jammedShare: jammed / Math.max(1, carSecs), jammedAtEnd: jammedNow, longestStill: worstJam, turnsPerCarMin: turns / Math.max(1, carSecs / 60), overlapsPerSample: overlaps / Math.max(1, samples), overlapMax };
      if (A.stats) Object.assign(out, A.stats());
      return out;
    }, [Number(secs), site]);
    await p.close();
    runs.push(r);
    const f = (v, n = 2) => v.toFixed(n);
    console.log(`${city} at ${r.at}: ${r.cars} cars over ${r.seconds} s`);
    console.log(`  standing still ${(r.stoppedShare * 100).toFixed(0)}% of the time, mean speed ${f(r.meanSpeed, 1)} m/s (${f(r.meanSpeed * 3.6, 0)} km/h)`);
    console.log(`  jammed (still 30 s or more): ${(r.jammedShare * 100).toFixed(1)}% of the time, ${r.jammedAtEnd} at the end; longest still: ${r.longestStill} s`);
    console.log(`  turned back in the road: ${f(r.turnsPerCarMin, 3)} per car-minute; caught up in another car: ${f(r.overlapsPerSample)} pairs a second, ${r.overlapMax} at worst`);
    if (r.signals != null) console.log(`  red lights run: ${r.redRuns}; crossing movements in one junction at once: ${r.conflicts} (cars found over a line: ${r.overLine})`);
  }
  const r0 = runs[0] || {}, avg = k => runs.reduce((a, r) => a + r[k], 0) / Math.max(1, runs.length), sum = k => runs.reduce((a, r) => a + (r[k] || 0), 0);
  if (r0.signals != null) console.log(`junctions: ${r0.junctions}, ${r0.signals} with signals (${r0.mapped} mapped), ${r0.heads} signal heads, ${r0.stops} stop and ${r0.giveWays} give-way signs`);
  console.log(`all places: standing still ${(avg('stoppedShare') * 100).toFixed(0)}%, jammed ${(avg('jammedShare') * 100).toFixed(1)}%, ${(avg('meanSpeed') * 3.6).toFixed(0)} km/h, longest still ${Math.max(...runs.map(r => r.longestStill))} s`);
  for (const e of errors) console.log(`  pageerror: ${e}`);
  const fails = [];
  if (errors.length) fails.push('page errors');
  if (avg('stoppedShare') > 0.5) fails.push('most of the traffic stands still');
  if (avg('jammedShare') > 0.12) fails.push('jammed');
  if (avg('overlapsPerSample') > 1) fails.push('cars caught up in one another');
  if (sum('redRuns') > 0) fails.push('red lights run');
  if (sum('conflicts') > sum('overLine')) fails.push('crossing movements let in at once');
  console.log(fails.length ? `FAIL ${fails.join(', ')}` : 'ok');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
