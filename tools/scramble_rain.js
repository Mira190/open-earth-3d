// The Shibuya scramble where the game opens, in the rain (the owner's report: walkers stuck in the
// road, a walk-signal post out on the stripes, the waiting crowd jittering). Runs the world in real
// time from the player's start and every half second records:
//   - stuck: the scramble's own walkers out on the carriageway (between the kerbs) getting no nearer the
//     far side, and the longest any one has stayed so;
//   - jitter: among those waiting at a kerb (or standing on a footway), how many flip between walking
//     and standing, or turn more than 20 degrees, from one sample to the next;
//   - posts: the walk-signal posts that stand on a crosswalk's stripes (within its width of its line).
// Stills at the start and every STILL seconds go to out_dir.
//   [PLAYER=x,y] xvfb-run -a node tools/scramble_rain.js [city] [seconds] [out_dir] [weather]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const [,, city = 'shibuya', secs = '60', outDir = '', weather = 'rain'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', process.env.TIER || 'low'); } catch (e) { /* storage blocked */ } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.waitForFunction('window.__game && !window.__game.arriving()', null, { timeout: 300000 }).catch(() => {});
  await p.evaluate(w => { const g = window.__game; if (g.weather) g.weather.set(w, { now: true }); }, weather);
  // PLAYER=x,y: stand the player there (out on the stripes, say, as people stop to look)
  if (process.env.PLAYER) await p.evaluate(([x, y]) => { const g = window.__game; Object.assign(g.player, { x, y, speed: 0, vz: 0 }); }, process.env.PLAYER.split(',').map(Number));
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const posts = await p.evaluate(() => {
    const g = window.__game, J = g.junctions, out = [];
    for (const j of J.J.filter(j => j.scramble)) {
      const pz = j.plaza;
      if (!pz || !pz.spans) continue;
      for (const o of J.heads.peds || []) {
        if (o.a.j !== j) continue;
        for (const w of pz.spans) {
          const ex = w[3] - w[0], ey = w[4] - w[1], L = Math.hypot(ex, ey), t = ((o.x - w[0]) * ex + (o.y - w[1]) * ey) / (L * L);
          const d = Math.abs((o.x - w[0]) * ey - (o.y - w[1]) * ex) / L;
          if (t > 0.02 && t < 0.98 && d < 3.6) out.push({ j: j.id, x: +o.x.toFixed(1), y: +o.y.toFixed(1), t: +t.toFixed(2), d: +d.toFixed(1), road: !!(pz.road && pz.road(o.x, o.y)) });
        }
      }
    }
    return out;
  }).catch(e => ({ error: String(e) }));
  console.log('posts on the stripes:', JSON.stringify(posts));
  const T = +secs, STILL = +(process.env.STILL || 15);
  let maxStuck = 0, sumStuck = 0, sumFlip = 0, sumTurn = 0, sumWait = 0, n = 0;
  for (let t = 0; t <= T; t += 0.5) {
    if (outDir && t % STILL === 0) await p.screenshot({ path: `${outDir}/${city}-${weather}-${String(t).padStart(3, '0')}.png` });
    const r = await p.evaluate(() => {
      const g = window.__game, C = g.crowd, pl = g.player;
      const prev = window.__srPrev || (window.__srPrev = new Map());
      let stuck = 0, longest = 0, flip = 0, turn = 0, wait = 0, cross = 0, active = 0;
      for (let i = 0; i < C.P.length; i++) {
        const q = C.P[i];
        if (q.line < 0 || Math.hypot(q.x - pl.x, q.y - pl.y) > 60) continue;
        active++;
        const moving = q.v > 0.05, still = q.pz ? q.ph === 'wait' : q.state === 'walk' && q.v < 0.3;
        const was = prev.get(i);
        // out on the carriageway and getting no nearer the far side over the last half second
        let out = false, togo = 0;
        if (q.pz && q.ph === 'cross') {
          cross++;
          const g0 = q.g, P2 = g0 && g0.partner;
          if (P2) {
            const ex = P2.x - g0.x, ey = P2.y - g0.y, u = ((q.x - g0.x) * ex + (q.y - g0.y) * ey) / (ex * ex + ey * ey);
            out = u > 0.08 && u < 0.92; togo = Math.hypot(q.T.x - q.x, q.T.y - q.y);
          }
        } else if (!q.pz && q.state === 'walk' && q.line >= 0) {
          const X = C.crossings.byLine.get(q.line), x = X && X.find(x => x.scramble && Math.abs(q.s - x.s) < x.kerb - 1);
          if (x) { out = true; togo = q.dir * (x.s - q.s) + x.kerb; }
        }
        if (out && was && was.out && was.togo - togo < 0.2) q.__st = (q.__st || 0) + 0.5; else q.__st = 0;
        if (q.__st > 1.5) stuck++;
        longest = Math.max(longest, q.__st || 0);
        if (still && was && was.still) {
          wait++;
          if (was.moving !== moving) flip++;
          const dh = Math.abs(Math.atan2(Math.sin(q.h - was.h), Math.cos(q.h - was.h)));
          if (dh > 0.35) turn++;
        }
        prev.set(i, { moving, still, h: q.h, out, togo });
      }
      const j = g.junctions.J.filter(j => j.scramble).sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y))[0];
      return { stuck, longest, flip, turn, wait, cross, active, ph: j ? `${j.ph}${j.st}` : null, busy: j ? j.busy : 0 };
    });
    n++; sumStuck += r.stuck; sumFlip += r.flip; sumTurn += r.turn; sumWait += r.wait; maxStuck = Math.max(maxStuck, r.longest);
    if (t % 5 === 0) console.log(`t=${t} ph=${r.ph} busy=${r.busy} active=${r.active} cross=${r.cross} stuck=${r.stuck} longest=${r.longest} waiting=${r.wait} flip=${r.flip} turn=${r.turn}`);
    await p.evaluate(() => { window.__game.advance(0.5); return new Promise(r => requestAnimationFrame(r)); });
  }
  console.log(JSON.stringify({ meanStuck: +(sumStuck / n).toFixed(2), longestStuck: maxStuck, flipRate: +(sumFlip / Math.max(1, sumWait)).toFixed(3), turnRate: +(sumTurn / Math.max(1, sumWait)).toFixed(3), posts: Array.isArray(posts) ? posts.length : posts }));
  await b.close();
})();
