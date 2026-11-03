// Measure a city's street traffic headlessly: load the game, leave the player on foot at a few
// places (the start, then points on its roads), run the traffic there for a while and report how
// it flowed: the share of cars standing still, the cars jammed for half a minute or more, the
// turns back where a jam would not clear, the cars caught up in one another, the cars in a wall
// (a road the data runs through a building), and, at the junctions (junctions.js), the cars that
// crossed a stop line on red, the movements let into a junction at once that cross, and the cars
// found over a line they couldn't stop at (on amber, say) and the movements they cross. The game's
// own frame loop is stopped, so a run is about the same each time. Exits 1 when the traffic jams,
// tangles, drives through walls, runs a red or lets in movements that cross. It also reports the
// waits at a red (#108): the mean, the 95th percentile and the longest, for cars and for walkers
// (WAITS_JSON=file appends a line of the figures for each city, WAITS_LABEL=before names them).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/traffic_check.js sydney [seconds per place] [places]
const { chromium } = require('playwright');
const [,, city = 'sydney', secs = '150', places = '3'] = process.argv;
// the mean and the 95th percentile of a list of waits (s), and how many
const pct = (v, q) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0; };
const mean = v => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const waitLine = v => `mean ${mean(v).toFixed(1)} s, 95% ${pct(v, 0.95).toFixed(1)} s, longest ${pct(v, 1).toFixed(0)} s (${v.length})`;
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
        if (cand.length) { const l = cand[(site * 7919) % cand.length], k = Math.floor(l.pts.length / 6) * 3; // (beside the road, on the kerb: not standing in the traffic's way)
          const ex = l.pts[k + 3] - l.pts[k], ey = l.pts[k + 4] - l.pts[k + 1], el = Math.hypot(ex, ey) || 1;
          let off = 7.5;
          for (const o of [6, -6, 9, -9, 12, -12, 16, -16]) if (!g.roadNet.nearest(l.pts[k] - ey / el * o, l.pts[k + 1] + ex / el * o, 5)) { off = o; break; }
          g.player.x = l.pts[k] - ey / el * off; g.player.y = l.pts[k + 1] + ex / el * off; g.player.z = l.pts[k + 2]; }
      }
      g.advance(1);
      // the traffic update's cost: the time in A.update per call (a frame's), timed from here
      const upd = A.update; let ut = 0, un = 0;
      A.update = function (...args) { const t0 = performance.now(), r = upd.apply(this, args); ut += performance.now() - t0; un++; return r; };
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
      let samples = 0, stopped = 0, dist = 0, carSecs = 0, turns = 0, worstJam = 0, jammed = 0, jammedNow = 0, overlaps = 0, overlapMax = 0, inWall = 0, onFlagged = 0;
      const nav = g.nav, avoid = () => g.roadNet.avoid;
      const warm = Math.min(60, T / 4);
      // the waits at a red: a car's from stopping at the line, or in the queue behind one stopped
      // there, till it moves on; a walker's from coming up to the kerb till stepping out (actors.js)
      const red = C.map(() => 0), carWaits = [];
      const atRed = c => { for (let k = 0, o = c; o && k < 40; k++, o = o.front) { if (o.why === 'light') return true; if (o.why !== 'car') return false; } return false; };
      for (let t = 0; t < T; t++) {
        g.advance(1);
        if (t === warm && g.crowd && g.crowd.kerbWaits) g.crowd.kerbWaits.length = 0;
        if (t < warm) { C.forEach((c, i) => { prev[i] = { line: c.line, dir: c.dir, x: c.x, y: c.y }; still[i] = c.v < 0.3 ? still[i] + 1 : 0; }); continue; }
        samples++;
        let ov = 0;
        jammedNow = 0;
        for (let i = 0; i < A.active; i++) {
          const c = C[i], q = prev[i];
          if (c.line < 0) { prev[i] = { line: -1 }; still[i] = 0; if (red[i]) carWaits.push(red[i]); red[i] = 0; continue; }
          if (c.v < 0.3 && atRed(c)) red[i]++;
          else if (red[i]) { carWaits.push(red[i]); red[i] = 0; }
          carSecs++;
          if (c.v < 0.3) stopped++;
          // in a building or a landmark (its middle, most of its width, knee to roof height), or on a road a car doesn't fit along
          if (!nav.room(c.x, c.y, c.z, c.hw * 0.8, 1.4, c.z > nav.terrain(c.x, c.y) + 2)) inWall++;
          if (avoid() && avoid()[c.line]) onFlagged++;
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
        jammedShare: jammed / Math.max(1, carSecs), jammedAtEnd: jammedNow, longestStill: worstJam, turnsPerCarMin: turns / Math.max(1, carSecs / 60), overlapsPerSample: overlaps / Math.max(1, samples), overlapMax,
        inWallShare: inWall / Math.max(1, carSecs), onFlaggedShare: onFlagged / Math.max(1, carSecs) };
      for (const w of red) if (w) carWaits.push(w); // (still waiting at the end: as long as it has been)
      out.carWaits = carWaits; out.walkWaits = g.crowd && g.crowd.kerbWaits ? g.crowd.kerbWaits.filter(w => w > 0.5).map(w => Math.round(w * 10) / 10) : [];
      out.updateMs = ut / Math.max(1, un);
      out.kerbWait = g.crowd ? g.crowd.kerbWait : 0; // walker-seconds at a kerb for the walk signal (since the start)
      A.update = upd;
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
    console.log(`  in a wall: ${(r.inWallShare * 100).toFixed(2)}% of the time; on a road a car doesn't fit along: ${(r.onFlaggedShare * 100).toFixed(2)}%`);
    console.log(`  the traffic update: ${f(r.updateMs)} ms a frame`);
    if (r.laneChanges != null) console.log(`  lane changes: ${r.laneChanges}; walkers waiting at a kerb for the walk signal: ${f(r.kerbWait / Math.max(1, r.seconds), 1)} on average`);
    console.log(`  wait at a red: cars ${waitLine(r.carWaits)}; walkers ${waitLine(r.walkWaits)}`);
    for (const l of r.crossLog || []) console.log(`    crossing movements: ${l}`);
    if (r.signals != null) console.log(`  red lights run: ${r.redRuns}; crossing movements let into one junction at once: ${r.conflicts}; cars found over a line: ${r.overLine}, crossing ${r.crossedOver || 0} movements in the junction`);
  }
  const r0 = runs[0] || {}, avg = k => runs.reduce((a, r) => a + r[k], 0) / Math.max(1, runs.length), sum = k => runs.reduce((a, r) => a + (r[k] || 0), 0);
  if (r0.signals != null) console.log(`junctions: ${r0.junctions}, ${r0.signals} with signals (${r0.mapped} mapped, ${r0.arrows || 0} with a turn arrow), ${r0.heads} signal heads, ${r0.stops} stop and ${r0.giveWays} give-way signs; ${r0.midSignals || 0} crossings with signals and ${r0.zebras || 0} zebras between junctions; ${r0.bans || 0} banned turns (${sum('bannedExits')} exits left out where cars came)`);
  console.log(`all places: standing still ${(avg('stoppedShare') * 100).toFixed(0)}%, jammed ${(avg('jammedShare') * 100).toFixed(1)}%, ${(avg('meanSpeed') * 3.6).toFixed(0)} km/h, longest still ${Math.max(...runs.map(r => r.longestStill))} s, update ${avg('updateMs').toFixed(2)} ms a frame`);
  const cw = runs.flatMap(r => r.carWaits || []), ww = runs.flatMap(r => r.walkWaits || []);
  console.log(`all places: wait at a red: cars ${waitLine(cw)}; walkers ${waitLine(ww)}`);
  if (process.env.WAITS_JSON) require('fs').appendFileSync(process.env.WAITS_JSON, JSON.stringify({ city, label: process.env.WAITS_LABEL || '', cars: { mean: mean(cw), p95: pct(cw, 0.95), max: pct(cw, 1), n: cw.length }, walkers: { mean: mean(ww), p95: pct(ww, 0.95), max: pct(ww, 1), n: ww.length },
    stopped: avg('stoppedShare'), jammed: avg('jammedShare'), kmh: avg('meanSpeed') * 3.6, longestStill: Math.max(...runs.map(r => r.longestStill)), overLine: sum('overLine'), crossed: sum('crossedOver'), redRuns: sum('redRuns'), conflicts: sum('conflicts') }) + '\n');
  for (const e of errors) console.log(`  pageerror: ${e}`);
  const fails = [];
  if (errors.length) fails.push('page errors');
  if (avg('stoppedShare') > 0.5) fails.push('most of the traffic stands still');
  if (avg('jammedShare') > 0.12) fails.push('jammed');
  if (avg('overlapsPerSample') > 1) fails.push('cars caught up in one another');
  if (sum('redRuns') > 0) fails.push('red lights run');
  if (avg('inWallShare') > 0.01) fails.push('cars driving through walls');
  if (sum('conflicts') > 0) fails.push('crossing movements let in at once');
  console.log(fails.length ? `FAIL ${fails.join(', ')}` : 'ok');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
