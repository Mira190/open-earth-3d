// The fare rules (web/game/fares.js price) on trips with known answers, under Node, and every live
// map's own table priced once for each pair of its stops. No browser: a second or so.
//   node tools/fares_check.js
'use strict';
const fs = require('fs'), path = require('path');
const F = require('../web/game/fares.js');
const ROOT = path.join(__dirname, '..');
let bad = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { bad++; console.log(`FAIL ${what}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// a city with every rule: bands, a pair, off-peak on trains only, a transfer, a lower cap from Friday, a week's cap
const C = { unit: 0.01, rides: { ferry: { bands: [[9, 7], [null, 9]], pairs: { 'a>c': 5.5 } }, rail: { bands: [[10, 4], [null, 5]] }, cable: { flat: 30, return: true } },
  offpeak: { discount: 0.3, kinds: ['rail'], peak: [['06:30', '10:00'], ['15:00', '19:00']], all_day: [4, 5, 6] }, transfer: { off: 2, within_min: 60 },
  caps: { day: 19, day_low: 9.5, low_weekdays: [4, 5, 6], week: 50, week_starts: 0 }, holidays: [[1, 26]] };
const on = (d, min) => ({ y: 2026, m: 11, d, min }); // November 2026: the 9th is a Monday, the 13th a Friday
check(F.dow(2026, 11, 9) === 0 && F.dow(2026, 11, 13) === 4 && F.dow(2026, 11, 15) === 6, 'the weekday of a date (0 is Monday)');
check(F.weekKey(on(15, 0)) === '2026-11-09' && F.weekKey(on(16, 0)) === '2026-11-16', 'a week runs Monday to Sunday');
let p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 3000, on: on(9, 600) }, F.fresh());
check(near(p.due, 7) && !p.lines.length && near(p.spent, 7), `a ferry inside the first band is its fare (${p.due})`);
check(near(F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 12000, on: on(9, 600) }, F.fresh()).due, 9), 'a longer one is the next band');
check(near(F.price(C, { kind: 'ferry', from: 'c', to: 'a', m: 12000, on: on(9, 600) }, F.fresh()).due, 5.5), 'a pair of stops has its own fare, either way');
check(F.price(C, { kind: 'bus', from: 'a', to: 'b', on: on(9, 600) }, F.fresh()) === null, 'a ride with no table costs nothing');
check(near(F.price(C, { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(9, 480) }, F.fresh()).due, 4), 'a train in the peak is the full fare');
check(near(F.price(C, { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(9, 660) }, F.fresh()).due, 2.8), 'off-peak it is 30% less');
check(near(F.price(C, { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(14, 480) }, F.fresh()).due, 2.8), 'and all of Saturday is off-peak');
check(near(F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(9, 660) }, F.fresh()).due, 7), 'a ferry has no off-peak fare');
// a change of transport within the hour, and not after it or to the same kind
p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(9, 480), off_min: 500 }, F.fresh());
let q = F.price(C, { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(9, 540) }, p.st);
check(near(q.due, 2) && near(q.spent, 9), `a train within the hour of a ferry is ${C.transfer.off} less (${q.due})`);
check(near(F.price(C, { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(9, 570) }, p.st).due, 4), 'past the hour it is not');
check(near(F.price(C, { kind: 'ferry', from: 'b', to: 'a', m: 2000, on: on(9, 510) }, p.st).due, 7), 'nor from a ferry to a ferry');
// the caps: three ferries on a Monday reach 19, the fourth is free; a Friday's is 9.5; the next day starts again
let st = F.fresh(), dues = [];
for (let i = 0; i < 4; i++) { p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(9, 600 + i * 90), off_min: 620 + i * 90 }, st); st = p.st; dues.push(p.due); }
check(near(dues[0], 7) && near(dues[1], 7) && near(dues[2], 5) && near(dues[3], 0) && p.capped === 'day' && near(p.spent, 19), `a Monday caps at 19: ${dues.join(', ')}`);
p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(10, 600) }, st);
check(near(p.due, 7) && near(p.spent, 7) && near(p.wspent, 26), 'the next day starts from nothing, the week goes on');
st = F.fresh(); dues = [];
for (let i = 0; i < 3; i++) { p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(13, 600 + i * 90), off_min: 620 + i * 90 }, st); st = p.st; dues.push(p.due); }
check(near(dues[0], 7) && near(dues[1], 2.5) && near(dues[2], 0) && p.capName !== 'Daily cap', `a Friday caps at 9.5: ${dues.join(', ')}`);
check(F.capOf(Object.assign({}, C), { y: 2026, m: 1, d: 26 }).low, 'a holiday has the lower cap');
// the week's cap: 45 spent by Thursday, so Thursday's second ferry is 5 and its third free
st = Object.assign(F.fresh(), { week: '2026-11-09', wspent: 45, day: '2026-11-11', spent: 19 });
p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(12, 600), off_min: 620 }, st);
q = F.price(C, { kind: 'ferry', from: 'b', to: 'a', m: 2000, on: on(12, 700), off_min: 720 }, p.st);
check(near(p.due, 5) && p.capped === 'week' && near(q.due, 0) && near(q.wspent, 50), `the week caps at 50 (${p.due}, then ${q.due})`);
p = F.price(C, { kind: 'ferry', from: 'a', to: 'b', m: 2000, on: on(16, 600) }, q.st);
check(near(p.due, 7) && near(p.wspent, 7), 'and Monday starts a new week');
// a return ticket: up paid, down free, up again paid; the day after, the way down is a new ticket
const T = { unit: 0.01, rides: C.rides }; // (a town of tickets: no caps)
p = F.price(T, { kind: 'cable', from: 'low', to: 'top', on: on(9, 600) }, F.fresh());
q = F.price(T, { kind: 'cable', from: 'top', to: 'low', on: on(9, 700) }, p.st);
const r = F.price(T, { kind: 'cable', from: 'low', to: 'top', on: on(9, 800) }, q.st);
check(near(p.due, 30) && q.ret && near(q.due, 0) && near(r.due, 30) && !r.ret, 'a return ticket pays the way up and not the way down');
check(near(F.price(T, { kind: 'cable', from: 'top', to: 'low', on: on(10, 600) }, p.st).due, 30), 'a return is good on its day only');
// amounts stay exact to the cent over a long day
st = F.fresh();
for (let i = 0; i < 40; i++) st = F.price(Object.assign({}, C, { caps: null }), { kind: 'rail', from: 'a', to: 'b', m: 2000, on: on(9, 660) }, st).st;
check(near(st.spent, 112), `forty off-peak trains come to 112.00 (${st.spent})`);

// each live map's table: every pair of stops of every ride has a fare above nothing and no dearer than its cap
const live = require('child_process').execFileSync(path.join(ROOT, 'tools', 'live_cities.sh'), { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
let maps = 0;
for (const c of live) {
  const lf = path.join(ROOT, 'web', 'data', c, 'life.json');
  if (!fs.existsSync(lf)) continue;
  const fares = JSON.parse(fs.readFileSync(lf, 'utf8')).fares;
  if (!fares) continue;
  maps++;
  const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'data', c, 'game.json'), 'utf8'));
  const W = Object.fromEntries((G.wharves || []).map(w => [w.id, w.berth || w.terminal]));
  const trips = [];
  for (const f of G.ferries || []) for (const a of f.stops) for (const b of f.stops) if (a !== b) trips.push({ kind: 'ferry', route: f.route, from: a, to: b, m: Math.hypot(W[a][0] - W[b][0], W[a][1] - W[b][1]) });
  for (const line of [((G.rail || {}).train || {}).stations, ((G.rail || {}).gondola || {}).stations, ((G.rail || {}).funicular || {}).stations, (G.trains || {}).stations]) {
    for (const a of line || []) for (const b of line || []) if (a !== b && a.id && b.id) trips.push({ kind: 'rail', from: a.id, to: b.id, m: 1000 });
  }
  let priced = 0;
  for (const t of trips) {
    const pr = F.price(fares, Object.assign({ on: on(9, 480) }, t), F.fresh());
    if (!fares.rides[t.kind]) continue;
    check(pr && pr.due > 0 && (pr.cap == null || pr.due <= pr.cap), `${c}: ${t.kind} ${t.route || ''} ${t.from} to ${t.to} has a fare (${pr ? pr.due : 'none'})`);
    priced++;
  }
  check(priced > 0, `${c}: its fares price at least one ride on the map`);
}
console.log(bad ? `FAIL fares: ${bad} of ${n}` : `ok   fares  ${n} checks: the rules, and ${maps} live maps' tables priced stop to stop`);
process.exit(bad ? 1 : 0);
