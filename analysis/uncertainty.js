// Which buildings shade each protected place, and how sure are the sun numbers?
//
//   node analysis/uncertainty.js --city sydney [draws]   -> cities/<city>/analysis/uncertainty.json, web/data/<city>/uncertainty.json
//
// 1. Shade attribution: for every sample point and protected instant (21st of
//    each month, every 15 minutes) the ray caster names the building that blocks
//    the sun. That gives each place's "shadow catchment" and how much of its
//    shade rests on each kind of height evidence.
// 2. Monte Carlo: every draw perturbs each building's height with an error drawn
//    from what was measured for its height source (pipeline/build_scene.py writes
//    the cross-validation residuals to analysis/height_model.json), plus a shared
//    storey-height error for floor-count heights, rebuilds the surface model and
//    recomputes the sun on each place. The spread is the uncertainty that comes
//    from the data; numerical error is under 1.1 points (error_budget.js).
const fs = require('fs'), path = require('path');
const { S, load, instants, analysedPlaces, numArg, MONTH_21, KEY_DATES } = require('./common');
const { B, P, T, frame, dataDir, outDir, year } = load();
const HM = JSON.parse(fs.readFileSync(path.join(outDir, 'height_model.json')));
const DRAWS = numArg(40);
const PLACES = analysedPlaces(P).map(p => p.name);
const spacing = p => (p.area_m2 > 60000 ? 5 : 3);

// deterministic random numbers so the published intervals are reproducible
let seed = 20261028;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const pick = a => a[Math.floor(rand() * a.length)];

// residuals are log(estimate / truth), so truth = estimate * exp(-r)
const POOLS = { floors: HM.residuals.floors, estimate: HM.residuals.estimate, ml: HM.residuals.ml };
// buildings whose estimate was corrected for informative missingness: the truth may lie
// anywhere from "no correction was needed" to "the full measured ratio applied"
const MISS = HM.missing_correction || {};
const missRange = i => { const m = MISS[i]; return m ? [-Math.log(m[1] / m[0]), Math.log(m[0])] : [0, 0]; };
function heightFactors() {
  const shared = Math.exp(0.03 * gauss()); // storey-height calibration error, common to all floor counts
  return B.b.map((m, i) => {
    const src = m[4];
    if (POOLS[src]) {
      const [lo, hi] = missRange(i);
      return Math.exp(-pick(POOLS[src]) + lo + (hi - lo) * rand()) * (src === 'floors' ? shared : 1);
    }
    return Math.exp(0.03 * gauss()); // surveyed, published or parametric
  });
}
// a plausible low and high height factor for one building (5th and 95th percentiles)
const qs = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.round((s.length - 1) * f)]; };
function factorRange(i) {
  const src = B.b[i][4];
  if (!POOLS[src]) return [0.94, 1.06];
  const [lo, hi] = missRange(i);
  return [Math.exp(-qs(POOLS[src], 0.95) + lo), Math.exp(-qs(POOLS[src], 0.05) + hi)];
}
const scaled = f => B.s.map(s => { const t = s.slice(); t[3] = Math.max(s[2] + 10, Math.round(s[3] * f[s[0]])); return t; });

const places = PLACES.map(name => P.places.find(p => p.name === name));
const G0 = S.buildDSM(T, B.s, Object.assign({ cell: 2, ids: true }, frame));
const samples = places.map(p => S.samplePlace(G0, p.polygons, spacing(p)));
const inst = places.map(p => instants(p, MONTH_21, 15, year));
const months = inst.map(list => [...new Set(list.map(i => i.m))]);

function sunByMonth(G, k) {
  const acc = {};
  for (const i of inst[k]) {
    (acc[i.m] = acc[i.m] || []).push(S.fractionSunlit(G, samples[k], i.sun));
  }
  return months[k].map(m => 100 * acc[m].reduce((a, b) => a + b, 0) / acc[m].length);
}

// ---- 1. shade attribution
const out = { draws: DRAWS, error_model: { floors: 'bootstrap of floor-count vs surveyed residuals, plus a shared 3% storey error',
  estimate: 'bootstrap of neighbour-estimate cross-validation residuals', ml: 'bootstrap of ML-blend cross-validation residuals',
  other: 'lognormal, 3%' }, places: [] };
const t0 = Date.now();
places.forEach((p, k) => {
  const by = new Map(), bySrc = {};
  let shaded = 0, rays = 0;
  for (const i of inst[k]) {
    const pts = samples[k].pts, n = pts.length / 3;
    for (let j = 0; j < n; j++) {
      const b = S.blocker(G0, pts[3 * j], pts[3 * j + 1], pts[3 * j + 2] + 0.5, i.sun);
      rays++;
      if (b === -1) continue;
      shaded++;
      by.set(b, (by.get(b) || 0) + 1);
      const src = b >= 0 ? B.b[b][4] : 'terrain';
      bySrc[src] = (bySrc[src] || 0) + 1;
    }
  }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const catchment = top.filter(([, v]) => v / shaded >= 0.005);
  out.places.push({
    name: p.name, period: p.period, window: `${p.from || '10:00'}-${p.to || '14:00'}`, months: months[k],
    shaded_share_pct: Math.round(1000 * shaded / rays) / 10,
    catchment_buildings: catchment.length,
    shade_by_height_source_pct: Object.fromEntries(Object.entries(bySrc).map(([s, v]) => [s, Math.round(1000 * v / shaded) / 10])),
    top_blockers: top.slice(0, 6).map(([b, v]) => b < 0 ? { name: 'terrain', share_pct: Math.round(1000 * v / shaded) / 10 } :
      { building: b, name: B.b[b][0] || `unnamed ${B.b[b][1] || 'building'}`, height_m: B.b[b][2], source: B.b[b][4], osm_id: B.b[b][6],
        share_pct: Math.round(1000 * v / shaded) / 10 }),
    base_by_month: sunByMonth(G0, k).map(v => Math.round(v * 10) / 10),
  });
});
console.error(`attribution in ${(Date.now() - t0) / 1000} s`);

// ---- 2. which single buildings move the answer most: each candidate set to its low and
// high plausible height, everything else unchanged, sun recomputed on the key dates
const keyInst = places.map(p => instants(p, KEY_DATES, 15, year));
const keyMean = (G, k) => 100 * keyInst[k].reduce((a, i) => a + S.fractionSunlit(G, samples[k], i.sun), 0) / Math.max(1, keyInst[k].length);
const keyBase = places.map((p, k) => keyMean(G0, k));
const cand = new Map(); // building -> places it may affect
places.forEach((p, k) => {
  const pl = out.places[k];
  for (const b of pl.top_blockers) if (b.building !== undefined && !['mapped', 'reference', 'parametric'].includes(b.source)) (cand.get(b.building) || cand.set(b.building, new Set()).get(b.building)).add(k);
  // estimated buildings near the place could start to shade it if they are taller than we think
  const [cx, cy] = [p.polygons[0][0].filter((_, j) => j % 2 === 0).reduce((a, v) => a + v, 0) / (p.polygons[0][0].length / 2) / 10,
    p.polygons[0][0].filter((_, j) => j % 2 === 1).reduce((a, v) => a + v, 0) / (p.polygons[0][0].length / 2) / 10];
  const near = [];
  for (const s of B.s) {
    const m = B.b[s[0]];
    if (!['estimate', 'ml'].includes(m[4])) continue;
    const d = Math.hypot(s[4][0] / 10 - cx, s[4][1] / 10 - cy);
    if (d < 250 + Math.sqrt(p.area_m2)) near.push([d, s[0]]);
  }
  near.sort((a, b) => a[0] - b[0]).slice(0, 12).forEach(([, b]) => (cand.get(b) || cand.set(b, new Set()).get(b)).add(k));
});
const fixes = [];
for (const [b, ks] of cand) {
  const [lo, hi] = factorRange(b);
  const variant = f => S.buildDSM(T, B.s.map(s => { if (s[0] !== b) return s; const t = s.slice(); t[3] = Math.max(s[2] + 10, Math.round(s[3] * f)); return t; }),
    Object.assign({ cell: 2 }, frame));
  const Glo = variant(lo), Ghi = variant(hi);
  for (const k of ks) {
    const dLo = keyMean(Glo, k) - keyBase[k], dHi = keyMean(Ghi, k) - keyBase[k];
    if (Math.abs(dLo) + Math.abs(dHi) < 0.2) continue;
    const m = B.b[b];
    fixes.push({ place: places[k].name, building: b, name: m[0] || `unnamed ${m[1] || 'building'}`, osm_id: m[6], height_m: m[2], source: m[4],
      plausible_m: [Math.round(m[2] * lo), Math.round(m[2] * hi)], sun_change_pp: [Math.round(dHi * 10) / 10, Math.round(dLo * 10) / 10],
      swing_pp: Math.round((Math.abs(dLo) + Math.abs(dHi)) * 10) / 10 });
  }
}
fixes.sort((a, b) => b.swing_pp - a.swing_pp);
out.fix_list = fixes.slice(0, 25);
console.error(`sensitivity: ${cand.size} candidates in ${(Date.now() - t0) / 1000} s`);

// ---- 3. Monte Carlo
const runs = places.map(() => []);
for (let d = 0; d < DRAWS; d++) {
  const G = S.buildDSM(T, scaled(heightFactors()), Object.assign({ cell: 2 }, frame));
  places.forEach((p, k) => runs[k].push(sunByMonth(G, k)));
  if (d % 10 === 9) console.error(`draw ${d + 1}/${DRAWS} at ${(Date.now() - t0) / 1000} s`);
}
const q = (a, f) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * f, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
out.places.forEach((pl, k) => {
  pl.p05_by_month = months[k].map((_, j) => Math.round(q(runs[k].map(r => r[j]), 0.05) * 10) / 10);
  pl.p95_by_month = months[k].map((_, j) => Math.round(q(runs[k].map(r => r[j]), 0.95) * 10) / 10);
  const mean = r => r.reduce((a, b) => a + b, 0) / r.length;
  const annual = runs[k].map(mean);
  pl.window_mean = { base: Math.round(mean(pl.base_by_month) * 10) / 10, p05: Math.round(q(annual, 0.05) * 10) / 10, p95: Math.round(q(annual, 0.95) * 10) / 10 };
  pl.max_halfwidth_pp = Math.round(10 * Math.max(...pl.p95_by_month.map((v, j) => (v - pl.p05_by_month[j]) / 2))) / 10;
});
out.seconds = (Date.now() - t0) / 1000;
// compact copy for the viewer: per place, month -> [p05, base, p95]; per-source lognormal sigma
// (robust, from the same residual pools) for the viewer's quick robustness check; the fix list
const mad = a => { const m = qs(a, 0.5); return 1.4826 * qs(a.map(v => Math.abs(v - m)), 0.5); };
const sigma = Object.fromEntries(Object.entries(POOLS).map(([k, a]) => [k, Math.round(mad(a) * 1000) / 1000]));
out.sigma = sigma;
fs.writeFileSync(path.join(outDir, 'uncertainty.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(dataDir, 'uncertainty.json'), JSON.stringify({ draws: DRAWS, sigma,
  fix_list: out.fix_list.slice(0, 8).map(f => ({ place: f.place, name: f.name, height_m: f.height_m, source: f.source, plausible_m: f.plausible_m, swing_pp: f.swing_pp, osm_id: f.osm_id })),
  places: Object.fromEntries(out.places.map(p =>
  [p.name, { months: p.months, base: p.base_by_month, p05: p.p05_by_month, p95: p.p95_by_month, top: p.top_blockers.slice(0, 3),
    sources: p.shade_by_height_source_pct, catchment: p.catchment_buildings }])) }));
console.log('\nBuildings whose height uncertainty moves the answer most (key dates, window mean):');
for (const f of out.fix_list.slice(0, 15)) console.log(`  ${f.place.padEnd(16)} ${f.name.slice(0, 30).padEnd(30)} ${String(f.height_m).padStart(6)} m ${f.source.padEnd(8)} plausible ${f.plausible_m[0]}-${f.plausible_m[1]} m -> sun ${f.sun_change_pp[0]}..+${f.sun_change_pp[1]} pp (swing ${f.swing_pp})  ${f.osm_id}`);
for (const p of out.places) {
  console.log(`\n${p.name} (${p.window}, ${p.period || 'unverified'}): ${p.catchment_buildings} buildings cast 99.5% of its shade; shade by source ${JSON.stringify(p.shade_by_height_source_pct)}`);
  console.log('  top: ' + p.top_blockers.map(b => `${b.name} ${b.height_m || ''}m ${b.source || ''} ${b.share_pct}%`).join('; '));
  console.log('  month ' + p.months.join('   '));
  console.log('  sun%  ' + p.base_by_month.map((v, j) => `${v.toFixed(0)} [${p.p05_by_month[j].toFixed(0)}-${p.p95_by_month[j].toFixed(0)}]`).join(' '));
}
