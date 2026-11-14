// Two cars each holding the other as the one in front (#312): run a city's street traffic headlessly
// for some minutes and, every second, find every pair of cars in which each lists the other as its
// `front` (whether braked for along its way or held by it as it steps) and both stand. Prints each
// such pair that stood longer than MIN seconds (default 10): where, how long, and how each sees
// the other (why, in a junction or not, its arm and exit). Exits 1 when any did.
//   cd web && python3 -m http.server 8800 &
//   GAME_TIME=10:00 xvfb-run -a node tools/mutual_front.js sydney [seconds] [places]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'sydney', secs = '300', places = '1'] = process.argv;
const MIN = Number(process.env.MIN || 10);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let bad = 0;
  for (let site = Number(process.env.FROM || 0); site < Number(places); site++) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    await pinClock(p, city);
    p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 300000 });
    await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
    const r = await p.evaluate(({ T, site, MIN, MORE }) => {
      window.requestAnimationFrame = () => 0;
      const g = window.__game, L = g.cars.netL, C = g.cars.C;
      if (site > 0) { // (beside a road some way off, as junction_held.js places you)
        const d = l => Math.hypot(l.pts[0] - g.player.x, l.pts[1] - g.player.y);
        const cand = L.filter(l => l.len > 40 && d(l) > 250 * site && d(l) < 300 * site + 200);
        if (cand.length) { const l = cand[(site * 7919) % cand.length], k = Math.floor(l.pts.length / 6) * 3; g.player.x = l.pts[k] + 8; g.player.y = l.pts[k + 1]; g.player.z = l.pts[k + 2]; }
      }
      const idx = new Map(C.map((c, i) => [c, i]));
      const run = new Map(), out = [];
      const desc = c => `car ${idx.get(c)} ${c.why}${c.heldBy ? ' by ' + c.heldBy : ''} v ${(c.v || 0).toFixed(1)} piece ${c.line} s ${c.s.toFixed(1)}${c.mv ? ` in junction ${c.mv.j.id} arm ${c.mv.a != null ? c.mv.a : '?'}` : ''}${c.lineArm ? ` at line of ${c.lineArm.j.id} arm ${c.lineArm.i} ${(c.toLine - c.half).toFixed(1)} m on` : ''}${MORE ? ` dir ${c.dir} ln ${c.ln || 0} lo ${(c.lo || 0).toFixed(2)} off ${(c.off || 0).toFixed(2)} narrowF ${(c.narrowF || 0).toFixed(2)} narrow ${(c.narrow || 0).toFixed(1)} rev ${!!c.rev} passBy ${c.passBy ? idx.get(c.passBy) : '-'} faceT ${(c.faceT || 0).toFixed(1)} inHeld ${(c.inHeld || 0).toFixed(1)} backoff ${(c.backoff || 0).toFixed(1)} stuck ${(c.stuck || 0).toFixed(1)} np ${c.np} x ${c.x.toFixed(1)},${c.y.toFixed(1)} h ${c.h.toFixed(2)}` : ''}`;
      let pairs = 0;
      for (let t = 0; t < T; t++) {
        g.advance(1);
        const seen = new Set();
        for (const c of C) {
          const o = c.front;
          if (!o || c.line < 0 || o.line == null || o.line < 0 || o.front !== c || c.v >= 0.3 || o.v >= 0.3) continue;
          const key = Math.min(idx.get(c), idx.get(o)) + '-' + Math.max(idx.get(c), idx.get(o));
          if (seen.has(key)) continue;
          seen.add(key);
          const e = run.get(key) || { t: 0, at: '' };
          e.t++; e.at = `at ${c.x.toFixed(1)},${c.y.toFixed(1)}: ${desc(c)} | ${desc(o)}`;
          run.set(key, e);
        }
        for (const [k, e] of run) if (!seen.has(k)) { if (e.t > MIN) out.push(`${e.t} s ${e.at}`); pairs++; run.delete(k); }
      }
      for (const [, e] of run) if (e.t > MIN) out.push(`${e.t} s (still) ${e.at}`);
      const S = g.cars.stats();
      return { out, pairs, stats: `backed out ${S.revs}, squeezed past ${S.squeezes}, red runs ${S.redRuns}` };
    }, { T: Number(secs), site, MIN, MORE: !!process.env.MORE });
    console.log(`${city} place ${site}: ${r.pairs} pairs held each other a moment; over ${MIN} s: ${r.out.length}; ${r.stats}`);
    for (const s of r.out) console.log('  ' + s);
    bad += r.out.length;
    await p.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
