// A piece of the road network as the traffic has it, in numbers: its class, length, direction, whether it starts or
// ends at a wall (game.js cutAtWalls), what joins each of its ends, and along it every few metres the ground, the
// room a car's body has (nav.room: 1 free, 0 in a wall) and the head room under what is over it. For a step of the
// game check that names a piece ("car 76 on road 4279 ... in a wall").
//   xvfb-run -a node tools/road_piece.js shibuya 4279 [more pieces...] [step=4: metres between samples]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const { pinClock } = require('./pin_clock');
const args = process.argv.slice(2), city = args.shift() || 'shibuya';
const step = +((args.find(a => /^step=/.test(a)) || 'step=4').slice(5)), pieces = args.filter(a => /^\d+$/.test(a)).map(Number);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await pinClock(p, city);
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await startPlay(p);
  await p.evaluate(() => { const g = window.__game; if (g.cine.active) g.cine.skip(); return g.lateReady && g.lateReady(); });
  const out = await p.evaluate(([pieces, step]) => {
    const g = window.__game, net = g.roadNet, L = net.L, nav = g.nav, q = {}, lines = [];
    for (const i of pieces) {
      const l = L[i];
      if (!l) { lines.push(`piece ${i}: none (${L.length} pieces)`); continue; }
      const n = l.pts.length / 3, a = [l.pts[0], l.pts[1], l.pts[2]], e = [l.pts[3 * n - 3], l.pts[3 * n - 2], l.pts[3 * n - 1]];
      const joins = end => { const o = []; for (let j = 0; j < L.length; j++) { if (j === i) continue; const m = L[j].pts.length / 3; for (const [k, nm] of [[0, 'start'], [m - 1, 'end']]) if (Math.hypot(L[j].pts[3 * k] - end[0], L[j].pts[3 * k + 1] - end[1]) < 2.5) o.push(`${j} (${L[j].c}${L[j].ow ? ' one-way' : ''}, its ${nm})`); } return o.join(', ') || 'nothing'; };
      lines.push(`piece ${i}: ${l.c}, ${l.len.toFixed(0)} m, ${l.ow ? `one-way ${l.ow > 0 ? 'with' : 'against'} its points` : 'two-way'}, wall ${l.wall} (1 starts at one, 2 ends at one)${l.deck && l.deck.some(d => d) ? ', part on a deck' : ''}${g.roadNet.fit ? `, fit ${g.roadNet.fit[i]}` : ''}`);
      lines.push(`  from ${a.map(v => v.toFixed(1))}: ${joins(a)}`);
      lines.push(`  to   ${e.map(v => v.toFixed(1))}: ${joins(e)}`);
      for (let s = 0; s <= l.len + 0.01; s += Math.min(step, Math.max(0.5, l.len - s) || step)) {
        net.at(i, s, q);
        const T = nav.terrain(q.x, q.y), f = nav.floorAt(q.x, q.y, q.z + 0.3), c = nav.ceilingAt ? nav.ceilingAt(q.x, q.y, q.z + 0.3) : null;
        lines.push(`  s ${s.toFixed(0).padStart(4)}  ${q.x.toFixed(1)},${q.y.toFixed(1)}  line ${q.z.toFixed(2)}  terrain ${T.toFixed(2)}  floor ${f ? `${f.z.toFixed(2)} ${f.kind || ''}` : 'none'}  ${q.deck ? 'deck ' : ''}room ${[0.6, 0.9, 1.1].map(r => nav.room(q.x, q.y, q.z, r, 1.4, q.z > T + 2) ? 1 : 0).join('')} (0.6/0.9/1.1 m round)  solid ${nav.solid(q.x, q.y, q.z, 0.5) ? 1 : 0}${c != null && isFinite(c) ? `  ceiling ${(+c - q.z).toFixed(2)} m over` : ''}`);
        if (s >= l.len) break;
      }
    }
    return lines;
  }, [pieces, step]);
  console.log(out.join('\n'));
  await b.close();
})();
