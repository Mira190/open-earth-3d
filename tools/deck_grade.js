// decks.js's grading of overlapping decks, run in Node on what tools/deck_dump.js wrote, and measured as
// tools/deck_room.js measures it in the game: the places where a deck's slab is in the body of someone on a deck or a
// strip under it. Seconds instead of a game load, for working on the grading (#432).
//   node tools/deck_grade.js out/decks_shibuya.json [-v]
const fs = require('fs'), path = require('path');
const [,, file, flag] = process.argv;
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'web', 'game', 'decks.js'), 'utf8'));
const D = JSON.parse(fs.readFileSync(file, 'utf8')), k2 = (x, y) => x.toFixed(2) + ',' + y.toFixed(2);
const T = new Map(D.nav.T), W = new Set(D.nav.W), S = new Map(D.nav.S);
D.strips.forEach((s, i) => { s.i = i; });
const nav = {
  strips: D.strips, terrain: (x, y) => T.get(k2(x, y)) ?? 0, isWater: (x, y) => W.has(k2(x, y)),
  stripHeight: (s, x, y) => S.get(s.i + '|' + k2(x, y)) ?? null,
};
const recs = D.recs.map(r => ({ o: r.o, cls: Uint8Array.from(r.cls), zs: Float32Array.from(r.zs), kind: r.kind }));
const meta = D.segs.map(d => ({ li: d.li, k: d.k }));
const cr = window.OEDecks.together(D.runs, D.segs, recs, nav, () => false);
const KNEE = 0.4, HEAD = 1.8, CELL = 20, cells = new Map(), out = [];
D.segs.forEach((d, i) => {
  d.i = i;
  for (let x = Math.floor((Math.min(d.ax, d.bx) - d.hw) / CELL); x <= Math.floor((Math.max(d.ax, d.bx) + d.hw) / CELL); x++)
    for (let y = Math.floor((Math.min(d.ay, d.by) - d.hw) / CELL); y <= Math.floor((Math.max(d.ay, d.by) + d.hw) / CELL); y++) {
      const kk = `${x},${y}`;
      if (!cells.has(kk)) cells.set(kk, []);
      cells.get(kk).push(d);
    }
});
const half = (d, t, left) => { const h = d.hl ? (left ? d.hl : d.hr) : null; return h ? h[0] + (h[1] - h[0]) * t : d.hw; }; // (a piece narrowed on one side tapers: decks.js)
const name = o => `[${o.ax.toFixed(0)}, ${o.ay.toFixed(0)}, ${o.az.toFixed(1)}] to [${o.bx.toFixed(0)}, ${o.by.toFixed(0)}, ${o.bz.toFixed(1)}]`;
for (const d of D.segs) {
  const L = Math.hypot(d.bx - d.ax, d.by - d.ay) || 1, ex = (d.bx - d.ax) / L, ey = (d.by - d.ay) / L;
  const joined = o => [[o.ax, o.ay, o.az], [o.bx, o.by, o.bz]].some(a => [[d.ax, d.ay, d.az], [d.bx, d.by, d.bz]].some(c => Math.hypot(a[0] - c[0], a[1] - c[1]) < 3 && Math.abs(a[2] - c[2]) < 1));
  for (let u = 0; u <= L; u += 1) for (let hr = half(d, u / L, false), hl = half(d, u / L, true), v = -hr + 0.3; v <= hl - 0.3 + 1e-6; v += Math.max(0.5, (hl + hr - 0.6) / 4)) {
    const x = d.ax + ex * u - ey * v, y = d.ay + ey * u + ex * v, h = d.az + (d.bz - d.az) * u / L, lo = h - (d.th || 0.9);
    const under = [];
    for (const s of D.strips) { const z = nav.stripHeight(s, x, y); if (z != null) under.push([z, `strip ${s.name}`, null]); }
    for (const o of cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || []) {
      if (o === d || joined(o)) continue;
      // (as nav.js decksAt takes it)
      const M = Math.hypot(o.bx - o.ax, o.by - o.ay) || 1, fx = (o.bx - o.ax) / M, fy = (o.by - o.ay) / M, uu = (x - o.ax) * fx + (y - o.ay) * fy;
      if (uu < -0.3 || uu > M + 0.3) continue;
      const t = Math.max(0, Math.min(1, uu / M));
      const w = -(x - o.ax) * fy + (y - o.ay) * fx;
      if (Math.abs(w) > half(o, t, w > 0)) continue;
      under.push([o.az + (o.bz - o.az) * t, `a deck from ${name(o)}`, o]);
    }
    for (const [z, what, o] of under) if (h > z + KNEE && lo < z + HEAD) out.push({ x, y, h, room: lo - z, what, d, o });
  }
}
const groups = [];
for (const r of out) { const g = groups.find(q => Math.hypot(q[0].x - r.x, q[0].y - r.y) < 6 && q[0].what === r.what); if (g) g.push(r); else groups.push([r]); }
if (flag === '-v') for (const q of groups) {
  const lo = q.reduce((m, r) => Math.min(m, r.room), Infinity), d = q[0].d, o = q[0].o, c = s => { const m = meta[s.i], r = D.recs[m.li].o; return `${r.c}${r.o ? ' one-way' : ''} ${(2 * s.hw).toFixed(1)} m line ${m.li}`; };
  console.log(`LOW  [${q[0].x.toFixed(1)}, ${q[0].y.toFixed(1)}] ${name(d)} (${c(d)}) over ${q[0].what}${o ? ` (${c(o)})` : ''}, ${lo.toFixed(2)} m (${q.length})`);
}
// how steep the grading left the roads' decks (a deck pulled to another's level over one piece)
let steep = 0, steepest = 0;
for (const d of D.segs) { const r = D.recs[meta[d.i].li]; if (r.kind !== 'road') continue; const g = Math.abs(d.bz - d.az) / Math.max(1, Math.hypot(d.bx - d.ax, d.by - d.ay)); if (g > 0.12) { steep++; if (flag === '-s') console.log(`STEEP ${name(d)} ${r.o.c} ${(g * 100).toFixed(0)}%`); } steepest = Math.max(steepest, g); }
console.log(`  road decks steeper than 12%: ${steep} pieces, the steepest ${(steepest * 100).toFixed(0)}%`);
console.log(`${path.basename(file)}: ${groups.length} places, ${out.length} samples (graded in ${cr.rounds} rounds, ${cr.ms} ms, ${cr.left} left; moved: ${cr.over2} over 2 m, at most ${cr.maxMove} m; ${cr.narrowed} narrowed)`);
