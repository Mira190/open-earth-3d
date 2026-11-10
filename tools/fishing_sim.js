// Play the fishing rules (web/game/fishing.js `core`) in Node, without a browser, to tune them
// (docs/FISHING.md "Balance"). Three players of different quickness fight every species of a
// city's water a few thousand times each; the table says how often each lands it, how long the
// fight lasts and how much of it the button is held. Then a year at each spot: what a player
// who casts all day with each rig would log, month by month.
//   node tools/fishing_sim.js                # sydney and queenstown
//   node tools/fishing_sim.js sydney 4000    # a city, and how many fights per cell
// Exits 1 when a target is missed: the easiest fish must be all but sure for a beginner, the
// hardest must stay a fight for an expert and possible for a beginner, and no fight may run past
// the cap.
const fs = require('fs');
const path = require('path');
global.window = {};
require('../web/game/fishing.js');
const core = window.OEFishing.core;
const args = process.argv.slice(2), N = +(args.find(a => /^\d+$/.test(a)) || 2000);
const cities = args.filter(a => !/^\d+$/.test(a));
if (!cities.length) cities.push('sydney', 'queenstown');

// a player: the median time after a run starts before they let go, and after it ends before they
// wind again (s), log-normal with this spread, as reaction times are; reads: whether the warning
// before a run is acted on
const PLAYERS = [
  { name: 'new', off: 0.5, on: 0.6, spread: 0.45, reads: false },
  { name: 'steady', off: 0.3, on: 0.3, spread: 0.3, reads: false },
  { name: 'keen', off: 0.2, on: 0.15, spread: 0.2, reads: true },
];
// one fight: the player holds through a rest and lets go for a run, each after their delay; eases
// off when the bar is in the red if they are watching it
function play(s, cm, line, assist, p, rnd) {
  const f = core.fight(s, cm, line, assist);
  let reel = true, change = 0, held = 0, end = '';
  const delay = base => base * Math.exp(p.spread * (rnd() + rnd() + rnd() - 1.5) * 2);
  while (!end) {
    if (f.event === 'run' && !p.reads) change = f.t + delay(p.off);
    else if (f.event === 'warn' && p.reads) change = f.t + Math.max(0.3, delay(p.off));   // off as it turns, not before
    else if (f.event === 'rest') change = f.t + delay(p.on);
    if (change && f.t >= change) { reel = f.phase === 'rest'; change = 0; }
    // the keen player also watches the bar, and eases off when it has been red a moment
    const hold = reel && !(p.reads && f.T > 1 && f.over > 0.15);
    if (hold) held += core.STEP;
    end = core.fightStep(f, core.STEP, hold, rnd);
  }
  return { end, t: f.t, held: held / f.t, sweet: f.sweet / f.t };
}

let bad = 0;
const fail = m => { bad++; console.log(`FAIL ${m}`); };
for (const city of cities) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'data', city, 'fishing.json'), 'utf8'));
  console.log(`\n== ${city}: ${data.water} (${N} fights a cell; landed %, median fight s, held %)`);
  console.log(`${'species'.padEnd(26)}${'usual cm'.padEnd(10)}` + PLAYERS.map(p => p.name.padEnd(20)).join('') + 'big one, new'.padEnd(14) + 'new, helped');
  const rate = {};
  for (const s of data.species) {
    let row = `${s.name.padEnd(26)}${String(s.cm[1]).padEnd(10)}`;
    for (const p of PLAYERS) {
      const rnd = core.rng(1234 + s.name.length * 31 + p.name.length);
      let won = 0, held = 0; const ts = [];
      for (let i = 0; i < N; i++) { const r = play(s, s.cm[1], 16, 0, p, rnd); if (r.end === 'landed') won++; ts.push(r.t); held += r.held; if (r.t > 46) fail(`${s.id}: a fight of ${r.t.toFixed(0)} s`); }
      ts.sort((a, b) => a - b);
      rate[`${s.id}:${p.name}`] = won / N;
      row += `${(100 * won / N).toFixed(0).padStart(3)}%  ${ts[N >> 1].toFixed(0).padStart(2)} s  ${(100 * held / N).toFixed(0)}%`.padEnd(20);
    }
    // the largest of the species, and a beginner after two losses (the game then helps one notch: core.learn)
    const rnd = core.rng(77), P = PLAYERS[0];
    let big = 0, helped = 0;
    for (let i = 0; i < N; i++) { if (play(s, s.cm[2], 22, 0, P, rnd).end === 'landed') big++; if (play(s, s.cm[1], 16, 1, P, rnd).end === 'landed') helped++; }
    rate[`${s.id}:helped`] = helped / N;
    console.log(row + `${(100 * big / N).toFixed(0)}%`.padEnd(14) + `${(100 * helped / N).toFixed(0)}%`);
  }
  // targets
  const by = p => data.species.map(s => rate[`${s.id}:${p}`]);
  const easiest = Math.max(...by('new')), hardest = data.species.reduce((a, s) => (s.fight.pull > a.fight.pull ? s : a));
  if (easiest < 0.9) fail(`${city}: a beginner lands the easiest fish only ${(easiest * 100).toFixed(0)}% of the time (want 90%)`);
  if (rate[`${hardest.id}:keen`] < 0.8) fail(`${city}: the keen player lands ${hardest.name} ${(rate[`${hardest.id}:keen`] * 100).toFixed(0)}% of the time (want 80%)`);
  if (rate[`${hardest.id}:helped`] < 0.4) fail(`${city}: a beginner with help lands ${hardest.name} ${(rate[`${hardest.id}:helped`] * 100).toFixed(0)}% of the time (want 40%)`);
  for (const s of data.species) if (rate[`${s.id}:keen`] < rate[`${s.id}:new`] - 0.03) fail(`${city}: ${s.name} is easier for the slow player than the quick one`);

  // a year of casting: what takes the bait, by rig, at dusk and at midday, at the first spot
  const spot = data.spots[0], out = new Float32Array(32);
  console.log(`\n   ${spot.name}: share of the takes (%) and seconds to a bite, by rig, in January and July`);
  for (const rig of data.rigs) for (const [month, light] of [[1, 'dusk'], [1, 'day'], [7, 'dusk'], [7, 'day']]) {
    const env = { month, light, rain: 0, rig: rig.id, cast: (rig.cast[0] + rig.cast[1]) / 2, school: 0.4 };
    const sum = core.weights(data, spot, env, out), rnd = core.rng(5);
    let wait = 0; for (let i = 0; i < 400; i++) wait += core.plan(data, spot, env, rnd, 0, false).wait;
    console.log(`   ${rig.id.padEnd(9)}${String(month).padStart(2)} ${light.padEnd(5)} ${(wait / 400).toFixed(0).padStart(2)} s  ` + data.species.map((s, i) => `${s.name.split(' ').pop()} ${(100 * out[i] / sum).toFixed(0)}`).join(' · '));
  }
  // every species must be catchable somewhere in the year with some rig (5% of the takes or more)
  for (const [i, s] of data.species.entries()) {
    let best = 0;
    for (const sp of data.spots) for (const rig of data.rigs) for (let m = 1; m <= 12; m++) for (const light of ['dawn', 'day', 'dusk', 'night']) for (const cast of [0.1, 0.5, 0.9]) {
      const sum = core.weights(data, sp, { month: m, light, rain: 0, rig: rig.id, cast, school: 1 }, out); best = Math.max(best, out[i] / sum);
    }
    if (best < 0.05) fail(`${city}: ${s.name} is never more than ${(best * 100).toFixed(1)}% of the takes`);
  }
}
console.log(bad ? `\n${bad} target(s) missed` : '\nok   fishing_sim   every target met');
process.exit(bad ? 1 : 0);
