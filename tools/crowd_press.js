// How the crowd behaves where it masses: run a city's game headless with you on foot, step it at
// 30 frames a second, and for the walkers within a radius of you measure what reads as a crowd
// gone wrong: one that wants to get somewhere (a spot at a kerb not yet reached, a crossing under
// way) and has covered next to no ground for over a second, pressing into the backs of others;
// the longest any of them has pressed; how many stand closer than a body to someone; and the
// densest anyone stands (others within a metre). Split by the scramble's crowd and the footways'.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=17:30 xvfb-run -a node tools/crowd_press.js shibuya [seconds, 60] [radius m, 40]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', secs = '60', rad = '40'] = process.argv;
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
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(1); });
  const out = await p.evaluate(([secs, rad]) => {
    const g = window.__game, P = g.crowd.P, me = g.player, dt = 1 / 30;
    const S = new Map(), K = () => ({ t: 0, press: 0, close: 0, dense: 0, maxPress: 0, why: {} });
    const R = { plaza: K(), foot: K() };
    let maxN = 0;
    // wants to move: a scramble walker short of its spot, or out crossing; a footway walker not waiting by choice
    const wants = q => q.pz ? (q.ph === 'cross' || (q.T && Math.hypot(q.T.x - q.x, q.T.y - q.y) > 0.8))
      : q.state === 'walk' && !(q.pause > 0) && !q.kw && !q.atKerb;
    for (let f = 0; f < secs * 30; f++) {
      g.advance(dt);
      const A = [];
      for (let i = 0; i < g.crowd.active; i++) { const q = P[i]; if (q.line >= 0 && q.mode !== 'sit' && Math.hypot(q.x - me.x, q.y - me.y) < rad) A.push(i); }
      const keep = new Set(A);
      for (const i of [...S.keys()]) if (!keep.has(i)) S.delete(i);
      for (const i of A) {
        const q = P[i], k = q.pz ? R.plaza : R.foot;
        k.t += dt;
        let s = S.get(i); if (!s) S.set(i, s = { hist: [], press: 0 });
        s.hist.push(q.x, q.y); if (s.hist.length > 60) s.hist.splice(0, 2);
        const gone = s.hist.length >= 60 ? Math.hypot(q.x - s.hist[0], q.y - s.hist[1]) : 1;
        if (wants(q) && gone < 0.3) { s.press += dt; if (s.press > 0) { k.press += dt; const w = q.pz ? q.ph : (q.kerbNext || q.kerbBack) ? 'held at a line end' : q.wait > 0 ? 'step refused' : q.v < 0.05 ? 'stopped' : 'edging'; const byPz = A.some(j => P[j].pz && Math.hypot(P[j].x - q.x, P[j].y - q.y) < 2); const w2 = w + (q.pz ? '' : byPz ? ' by the scramble crowd' : ''); k.why[w2] = (k.why[w2] || 0) + dt; } }
        else s.press = 0;
        k.maxPress = Math.max(k.maxPress, s.press);
        let n1 = 0, cl = false;
        for (const j of A) { if (j === i) continue; const o = P[j], d = Math.hypot(o.x - q.x, o.y - q.y); if (d < 1) n1++; if (d < 0.4) cl = true; }
        if (cl) k.close += dt;
        if (n1 >= 4) k.dense += dt;
        maxN = Math.max(maxN, n1);
      }
    }
    const f = k => ({ walkers: k.t / secs, press: k.press / Math.max(1e-9, k.t), close: k.close / Math.max(1e-9, k.t), dense: k.dense / Math.max(1e-9, k.t), maxPress: k.maxPress, why: Object.fromEntries(Object.entries(k.why).map(([a, b]) => [a, +b.toFixed(1)])) });
    return { plaza: f(R.plaza), foot: f(R.foot), maxN };
  }, [+secs, +rad]);
  const pc = x => (x * 100).toFixed(1) + '%';
  for (const [name, k] of [['scramble crowd', out.plaza], ['footways', out.foot]])
    console.log(`${city} ${name}: ${k.walkers.toFixed(1)} walkers within ${rad} m; pressing without getting anywhere ${pc(k.press)} of the time (longest ${k.maxPress.toFixed(1)} s, ${JSON.stringify(k.why)}); closer than 0.4 m to someone ${pc(k.close)}; 4+ others within 1 m ${pc(k.dense)}`);
  console.log(`  the most others within 1 m of anyone: ${out.maxN}`);
  const bad = out.plaza.press > 0.03 || out.foot.press > 0.03 || out.plaza.maxPress > 8;
  if (process.env.FAIL && bad) { console.log('  FAIL: the crowd presses'); process.exitCode = 1; }
  await b.close();
})();
