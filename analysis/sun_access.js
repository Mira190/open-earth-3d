// Sun on a city's public places through the year, from the same
// surface model and ray caster the viewer uses (web/sun.js).
//
//   node analysis/sun_access.js --city sydney    -> cities/<city>/analysis/sun_access.json
//
// For each place: mean share of its area in direct sun across its protected
// window (or 10:00-14:00 where the window is unverified) on the 21st of each
// month, every 15 minutes. Also times the ray caster.
const fs = require('fs'), path = require('path');
const { S, load } = require('./common');
// a period that names single days (22 April, 22 June) protects their months too
const namesDayIn = (period, m) => (period || '').split(',').some(p => !p.includes('..') && p.trim() !== 'all' && +p.trim().split('-')[0] === m);
const { B, P, T, frame, outDir, year } = load();

let t = Date.now();
const G = S.buildDSM(T, B.s, Object.assign({ cell: 2 }, frame));
const dsmMs = Date.now() - t;
const out = { year, dsm: { cell_m: 2, nx: G.nx, ny: G.ny, build_ms: dsmMs }, places: [] };
let rays = 0;
t = Date.now();
for (const pl of P.places) {
  const smp = S.samplePlace(G, pl.polygons, pl.area_m2 > 60000 ? 5 : 3);
  const from = S.hm(pl.from || '10:00'), to = S.hm(pl.to || '14:00');
  const months = [];
  for (let m = 1; m <= 12; m++) {
    let sum = 0, n = 0;
    for (let tm = from; tm <= to; tm += 15) {
      const sun = S.position(S.localToUtc(year, m, 21, tm));
      sum += S.fractionSunlit(G, smp, sun); n++;
      rays += smp.pts.length / 3;
    }
    months.push(Math.round(100 * sum / n));
  }
  out.places.push({ name: pl.name, lep: pl.lep, period: pl.period, window: `${pl.from || '10:00'}-${pl.to || '14:00'}`,
    window_verified: !!pl.period, area_m2: pl.area_m2, samples: smp.pts.length / 3, mean_pct_in_sun_by_month: months,
    protected_months: months.map((_, i) => S.inPeriod(pl.period || 'all', i + 1, 21) || namesDayIn(pl.period, i + 1)) });
}
out.rays = rays;
out.ray_ms = Date.now() - t;
fs.writeFileSync(path.join(outDir, 'sun_access.json'), JSON.stringify(out, null, 1));
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
console.log(`DSM ${G.nx} x ${G.ny} in ${dsmMs} ms; ${rays.toLocaleString()} rays in ${out.ray_ms} ms`);
console.log('| Place | Window | ' + M.join(' | ') + ' |');
console.log('|---|---|' + M.map(() => '---:').join('|') + '|');
for (const p of out.places)
  console.log(`| ${p.name} | ${p.period ? `${p.period === 'all' ? 'all year' : p.period} ${p.window}` : `unverified (${p.window} shown)`} | ` +
    p.mean_pct_in_sun_by_month.map((v, i) => p.protected_months[i] ? `${v}` : `(${v})`).join(' | ') + ' |');
