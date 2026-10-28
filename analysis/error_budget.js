// How much of the sun-access answer is numerical error, and how much could
// come from outside the model? Compares the production settings with finer
// ones, one factor at a time, and counts rays that leave the model extent
// while still low enough to be blocked by something we did not load.
//
//   node analysis/error_budget.js --city sydney   -> cities/<city>/analysis/error_budget.json
const fs = require('fs'), path = require('path');
const { S, load, instants, analysedPlaces, MONTH_21 } = require('./common');
const { B, P, T, frame, outDir, year } = load();

const PLACES = analysedPlaces(P, { unprotected: true }).map(p => p.name);
const G2 = S.buildDSM(T, B.s, Object.assign({ cell: 2 }, frame));
const G1 = S.buildDSM(T, B.s, Object.assign({ cell: 1 }, frame));
const prodSpacing = p => (p.area_m2 > 60000 ? 5 : 3);

function mean(G, place, spacing, step) {
  const smp = S.samplePlace(G, place.polygons, spacing);
  const ins = instants(place, MONTH_21, step, year);
  let s = 0;
  for (const i of ins) s += S.fractionSunlit(G, smp, i.sun);
  return 100 * s / ins.length;
}

// rays that leave the extent while still under the tallest roof in the model
function exits(G, place, spacing, step) {
  const smp = S.samplePlace(G, place.polygons, spacing), p = smp.pts, n = p.length / 3;
  let lit = 0, open = 0;
  for (const i of instants(place, MONTH_21, step, year)) {
    const { azimuth, altitude } = i.sun, dx = Math.sin(azimuth * S.RAD), dy = Math.cos(azimuth * S.RAD), tanA = Math.tan(altitude * S.RAD);
    for (let k = 0; k < n; k++) {
      const x = p[3 * k], y = p[3 * k + 1], z = p[3 * k + 2] + 0.5;
      if (!S.sunlit(G, x, y, z, i.sun)) continue;
      lit++;
      // distance to the extent edge along the ray
      const tx = dx > 0 ? (G.x0 + G.nx * G.cell - x) / dx : dx < 0 ? (G.x0 - x) / dx : Infinity;
      const ty = dy > 0 ? (G.y1 - y) / dy : dy < 0 ? (G.y1 - G.ny * G.cell - y) / dy : Infinity;
      if (z + Math.min(tx, ty) * tanA < G.max) open++;
    }
  }
  return { lit, open };
}

const rows = [];
for (const name of PLACES) {
  const pl = P.places.find(q => q.name === name);
  const sp = prodSpacing(pl);
  const t0 = Date.now();
  const r = {
    place: name,
    prod: mean(G2, pl, sp, 15),
    finer_samples: mean(G2, pl, sp / 2, 15),
    finer_dsm: mean(G1, pl, sp, 15),
    finer_time: mean(G2, pl, sp, 5),
    reference: mean(G1, pl, sp / 2, 5),
  };
  const e = exits(G2, pl, sp, 15);
  r.lit_rays_leaving_extent_low_pct = 100 * e.open / Math.max(1, e.lit);
  for (const k of ['prod', 'finer_samples', 'finer_dsm', 'finer_time', 'reference', 'lit_rays_leaving_extent_low_pct']) r[k] = Math.round(r[k] * 100) / 100;
  r.prod_minus_reference = Math.round((r.prod - r.reference) * 100) / 100;
  r.seconds = (Date.now() - t0) / 1000;
  rows.push(r);
  console.error(JSON.stringify(r));
}
const out = { note: 'Mean % of place area in direct sun over its protected window (or 10:00-14:00), 21st of each month.', year, rows,
  max_abs_numerical_error_pp: Math.max(...rows.map(r => Math.abs(r.prod_minus_reference))) };
fs.writeFileSync(path.join(outDir, 'error_budget.json'), JSON.stringify(out, null, 1));
console.log('| Place | Production | Finer samples | 1 m DSM | 5-min steps | All finer | Error (pp) | Lit rays leaving extent low |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.place} | ${r.prod.toFixed(1)} | ${r.finer_samples.toFixed(1)} | ${r.finer_dsm.toFixed(1)} | ${r.finer_time.toFixed(1)} | ${r.reference.toFixed(1)} | ${r.prod_minus_reference.toFixed(2)} | ${r.lit_rays_leaving_extent_low_pct.toFixed(1)}% |`);
