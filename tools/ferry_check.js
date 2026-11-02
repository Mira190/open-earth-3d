// The ferries over a long stretch of a city's game time, headless: whether any two hulls pass
// through each other, and whether every vessel keeps calling at its stops (none waiting on
// another for good). tools/clip_check.js samples the ferries over its 40 s; this runs them for
// many minutes, which is what a deadlock or a meeting at a shared berth takes to show.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/ferry_check.js tokyo [seconds=900]   # llvmpipe; without xvfb-run, SwiftShader
// Prints each vessel's calls and how long it was held by one lying in its way, then the first of
// each pair that overlapped (deeper than 0.5 m, as boxes of the vessel's length and beam), and
// exits 1 if any pair did or a vessel never called.
const { chromium } = require('playwright');
const [,, city = 'tokyo', secs = '900'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 640, height: 400 } })).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.advance(1); });
  const r = await p.evaluate(secs => {
    const g = window.__game, V = g.fer.vessels, hits = [], calls = V.map(() => 0), held = V.map(() => 0), last = V.map(v => v.phase);
    // the corners of a vessel's box, and how far two boxes overlap (the least overlap over the four axes)
    const corners = o => { const fx = Math.sin(o.h), fy = Math.cos(o.h), L = o.len / 2, B = o.beam / 2; return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, w]) => [o.x + fx * u * L + fy * w * B, o.y + fy * u * L - fx * w * B]); };
    const overlap = (A, B) => {
      let best = Infinity;
      for (const P of [A, B]) for (let i = 0; i < 4; i++) {
        const a = P[i], c = P[(i + 1) % 4], nx = c[1] - a[1], ny = a[0] - c[0], l = Math.hypot(nx, ny);
        const pa = A.map(q => (q[0] * nx + q[1] * ny) / l), pb = B.map(q => (q[0] * nx + q[1] * ny) / l);
        best = Math.min(best, Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)));
      }
      return best;
    };
    const desc = v => { const c = v.cycle[v.ci]; return `${v.name} (${v.route}, ${c.rev ? c.leg.to : c.leg.from} to ${c.rev ? c.leg.from : c.leg.to}, ${v.phase} at ${v.s.toFixed(0)} of ${c.leg.len.toFixed(0)} m, ${v.speed.toFixed(1)} m/s)`; };
    for (let t = 0; t < secs; t += 0.5) {
      g.advance(0.5);
      V.forEach((v, k) => { if (v.phase === 'dwell' && last[k] !== 'dwell') calls[k]++; last[k] = v.phase; if (v.heldT > 0) held[k] += 0.5; });
      for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
        const a = V[i], c = V[j];
        if (Math.hypot(a.x - c.x, a.y - c.y) > (a.len + c.len) / 2 + 5) continue;
        const d = overlap(corners(a), corners(c));
        if (d > 0.5) hits.push({ t, d, pair: `${a.name}|${c.name}`, what: `${desc(a)} and ${desc(c)}` });
      }
    }
    return { vessels: V.map((v, k) => ({ name: v.name, calls: calls[k], held: held[k] })), hits };
  }, +secs);
  console.log(`${city}: ${r.vessels.length} vessels over ${secs} s`);
  for (const v of r.vessels) console.log(`     ${v.name}: ${v.calls} calls${v.held ? `, held ${v.held} s by one lying in its way` : ''}`);
  const first = new Map();
  for (const h of r.hits) if (!first.has(h.pair)) first.set(h.pair, h);
  const deepest = r.hits.reduce((m, h) => Math.max(m, h.d), 0);
  const ok = !r.hits.length && r.vessels.every(v => v.calls > 0) && !errors.length;
  console.log(`${r.hits.length ? 'FAIL' : 'ok  '} ferries inside each other: ${r.hits.length} samples${r.hits.length ? `, up to ${deepest.toFixed(1)} m` : ''}`);
  for (const h of first.values()) console.log(`     at ${h.t} s, ${h.d.toFixed(1)} m: ${h.what}`);
  console.log(`${r.vessels.every(v => v.calls > 0) ? 'ok  ' : 'FAIL'} every vessel calls at its stops`);
  if (errors.length) console.log('FAIL page errors:', errors.join(' | '));
  await b.close();
  process.exit(ok ? 0 : 1);
})();
