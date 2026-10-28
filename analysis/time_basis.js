// Does "12:00-14:00" mean clock time or standard time? The clause's window could
// be read either way, and from October to April they differ by an hour of daylight
// saving. Recompute each protected place's sun under both readings.
//
//   node analysis/time_basis.js --city sydney   -> cities/<city>/analysis/time_basis.json
const fs = require('fs'), path = require('path');
const { S, load, datesFor, MONTH_21 } = require('./common');
const { B, P, T, frame, outDir, year } = load();
const G = S.buildDSM(T, B.s, Object.assign({ cell: 2 }, frame));
const PLACES = P.places.filter(p => p.period).map(p => p.name);
const STD = S.standardOffset(year);

function windowMean(place, smp, m, d, standard) {
  const from = S.hm(place.from), to = S.hm(place.to);
  let s = 0, n = 0;
  for (let t = from; t <= to; t += 15) {
    // standard time all year, so the clock reads later during daylight saving
    let utc = S.localToUtc(year, m, d, t);
    if (standard) utc += (S.offsetHours(utc) - STD) * 3600e3;
    s += S.fractionSunlit(G, smp, S.position(utc)); n++;
  }
  return 100 * s / n;
}
const rows = [];
for (const name of PLACES) {
  const pl = P.places.find(p => p.name === name), smp = S.samplePlace(G, pl.polygons, pl.area_m2 > 60000 ? 5 : 3);
  for (const [m, d] of datesFor(pl, MONTH_21)) {
    if (S.offsetHours(S.localToUtc(year, m, d, 720)) <= STD) continue; // only daylight-saving months differ
    const clock = windowMean(pl, smp, m, d, false), std = windowMean(pl, smp, m, d, true);
    rows.push({ place: name, month: m, clock_time: Math.round(clock * 10) / 10, standard_time: Math.round(std * 10) / 10, diff_pp: Math.round((std - clock) * 10) / 10 });
  }
}
const worst = rows.reduce((a, r) => (Math.abs(r.diff_pp) > Math.abs(a.diff_pp) ? r : a), rows[0]);
fs.writeFileSync(path.join(outDir, 'time_basis.json'), JSON.stringify({ rows, worst }, null, 1));
for (const r of rows) console.log(`${r.place.padEnd(16)} ${String(r.month).padStart(2)}: clock ${r.clock_time.toFixed(1)}  standard ${r.standard_time.toFixed(1)}  (${r.diff_pp >= 0 ? '+' : ''}${r.diff_pp})`);
console.log(worst ? `largest difference: ${JSON.stringify(worst)}` : 'no protected window falls in daylight saving time, so the two readings agree');
