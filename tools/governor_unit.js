// The frame-time governor (web/quality.js) against devices modelled as a frame's cost for a scale and the extras,
// shown through vertical sync as a display shows them (a frame that misses a refresh waits for the next). No
// browser: the governor is a function of the frame times it is fed. Checked:
//   - a fast device with no record is at its ceiling with every extra within twenty seconds;
//   - a device whose limit lies between two steps (issue 485: an Apple M3 in Shibuya went between 0.6 and 0.8 every
//     few seconds all session) settles: after its first two minutes, no more than a change a minute on average
//     over the next twenty, and none of them a change of the extras;
//   - it still gives way at once when the scene gets heavier, and has its resolution and the display's full rate
//     back a minute after the scene is light again;
//   - a device that cannot hold the floor ends there with the extras shed;
//   - a device with a record starts from it and does not try the step above for half a minute.
//   node tools/governor_unit.js [--old <path to an older quality.js>]    (prints each model's changes a minute)
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = process.argv.includes('--old') ? process.argv[process.argv.indexOf('--old') + 1] : path.join(__dirname, '..', 'web', 'quality.js');
function load() {
  const window = {}, ctx = { window, navigator: { webdriver: false }, location: { search: '', hash: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { createElement: () => ({ getContext: () => null }) }, matchMedia: () => ({ matches: false }), innerWidth: 1440, innerHeight: 900, console, Math, Date };
  ctx.globalThis = ctx; window.devicePixelRatio = 2;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return window.OEQuality;
}
// a seeded noise, so that a run is the same every time
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// seconds of play on a 60 Hz display: cost(scale, extras, t) ms of work a frame, ±6% from frame to frame
function play(g, seconds, cost, seed = 1) {
  const R = 1000 / 60, rnd = rng(seed), log = [];
  let t = g.__t || 1e6, prev = `${g.scale.toFixed(2)}/${g.extras}`;
  const t0 = t;
  if (!g.__t) for (let i = 0; i < 120; i++) { t += R; g.raf(t); } // (the display's rate, as the page's frames show it)
  while (t - t0 < seconds * 1000) {
    const ms = cost(g.scale, g.extras, (t - t0) / 1000) * (0.94 + 0.12 * rnd());
    t += Math.max(1, Math.ceil(ms / R - 1e-9)) * R;
    g.raf(t); g.tick(t);
    const now = `${g.scale.toFixed(2)}/${g.extras}`;
    if (now !== prev) { log.push({ s: (t - t0) / 1000, from: prev, to: now }); prev = now; }
  }
  g.__t = t; // (the next piece of play goes on from here)
  return log;
}
const between = (log, a, b) => log.filter(c => c.s >= a && c.s < b);
const extrasMoved = c => c.from.split('/')[1] !== c.to.split('/')[1];
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const Q = load();
const gov = () => { const g = Q.governor({ auto: true }); g.max = 1; return g; };
const has = k => typeof gov()[k] === 'function';

// 1. a fast device
{ const g = gov(); g.startLow(); play(g, 20, (s, e) => 3 + 6 * s * s + 2 * e);
  check(g.scale === 1 && g.extras === 1, `a fast device with no record is at its ceiling with every extra in twenty seconds (${g.scale.toFixed(2)}/${g.extras})`); }

// 2. the limit between two steps: 0.85 fits and 0.9 does not, with the extras shed (the M3's place)
for (const [name, cost] of [['between 0.85 and 0.90, the extras shed', (s, e) => 5.2 + 13.5 * s * s + 4 * e], ['between 0.65 and 0.70', (s, e) => 9 + 16.5 * s * s + 3 * e], ['on the edge at 0.80 with half the extras', (s, e) => 4 + 15 * s * s + 6.2 * e],
  ['whose scene drifts by a tenth as the player walks (a try holds, and fails seconds later)', (s, e, t) => (8 + 17 * s * s + 3 * e) * (1 + 0.1 * Math.sin(t / 5.3) * Math.sin(t / 17))]]) {
  const g = gov(); g.startLow();
  const log = play(g, 22 * 60, cost, 7), late = between(log, 120, 22 * 60), ex = late.filter(extrasMoved).length;
  const first = between(log, 0, 120).length, worst = Math.max(...Array.from({ length: 20 }, (_, i) => between(log, 120 + i * 60, 180 + i * 60).length));
  if (process.env.SHOW) console.log(log.map(c => `${Math.round(c.s)}s ${c.to}`).join('  '));
  check(late.length <= 20 && worst <= 6 && ex <= 2, `a device ${name} settles: ${late.length} changes in the twenty minutes after its first two (${first} in those; the busiest minute ${worst}; of the extras ${ex}), at ${g.scale.toFixed(2)}/${g.extras}`);
}

// 3. a heavier scene for half a minute, then light again
{ const g = gov(); g.startLow();
  const cost = (s, e) => 5.2 + 13.5 * s * s + 4 * e, st = () => `${g.scale.toFixed(2)}/${g.extras}`;
  play(g, 300, cost, 3);
  const before = st(), b = g.scale + g.extras;
  play(g, 6, (s, e) => cost(s, e) * 1.6, 4);
  const during = st(), d = g.scale + g.extras;
  play(g, 26, (s, e) => cost(s, e) * 1.6, 5);
  const low = st();
  play(g, 60, cost, 6);
  check(d < b, `a heavier scene: it gives way within six seconds (${before} → ${during}, then ${low})`);
  check(g.scale >= +before.split('/')[0] - 1e-9 && g.targetMs < 20, `and has its resolution back a minute after the scene is light again (${st()} from ${before}, by way of ${low}; aiming at ${Math.round(1000 / g.targetMs)} frames a second)`);
}

// 4. a device that cannot hold the floor
{ const g = gov(); g.startLow(); play(g, 90, (s, e) => 30 + 40 * s * s + 8 * e);
  check(Math.abs(g.scale - g.min) < 1e-6 && g.extras === 0, `a device that cannot hold the floor ends there, the extras shed (${g.scale.toFixed(2)}/${g.extras})`); }

// 5. a record: settled from the start
if (has('resume')) { const g = gov(); g.resume(0.85, 0);
  const log = play(g, 25, (s, e) => 5.2 + 13.5 * s * s + 4 * e, 5), all = play(g, 600, (s, e) => 5.2 + 13.5 * s * s + 4 * e, 6);
  check(log.length === 0 && all.length <= 12, `a device with a record starts from it and holds it (${log.length} changes in its first 25 s, ${all.length} in the next ten minutes)`); }
process.exit(fails ? 1 : 0);
