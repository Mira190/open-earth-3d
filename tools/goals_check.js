// The goals' rules (web/game/goals.js) on a made-up map with known answers, and every live map's own
// lines and quests: sound as data (goals.js audit), played from the welcome to the last stamp with no
// browser, and kept and loaded half way. Then where each step lies: how far from the start, and
// whether a phone, which plays inside the map's district (city.json "phone_district"), can reach it.
// A step a phone cannot reach is printed, and fails the run with --strict or for a line the map
// marks "phone": true. A second or so.
//   node tools/goals_check.js [--strict] [city ...]
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const GOALS = require('../web/game/goals.js');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), strict = args.includes('--strict'), named = args.filter(a => !a.startsWith('--'));
let bad = 0, n = 0;
const check = (ok, what) => { n++; if (!ok) { bad++; console.log(`FAIL ${what}`); } return ok; };

// ---- the rules, on a map with one of everything
const world = o => Object.assign({ mode: 'foot', x: 0, y: 0, floor: null, sunState: 'shade', sunAlt: 30, clock: { m: 6, d: 21, min: 720 }, landed: null,
  stripU: () => 0, inPlace: (name, x, y) => name === 'Square' && Math.hypot(x, y) < 50, colonyNear: () => 0 }, o);
{
  const m = GOALS.met;
  const visit = { type: 'visit', at: [100, 0], radius: 10 };
  check(!m(visit, world({ x: 80 }), {}) && m(visit, world({ x: 95 }), {}), 'a visit is met inside its radius, not outside');
  check(!m(visit, world({ x: 95, mode: 'car' }), {}), 'and on foot only');
  const dark = { type: 'visit', at: [0, 0], after_dark: true };
  check(!m(dark, world({ sunAlt: 4 }), {}) && m(dark, world({ sunAlt: -3 }), {}), 'a visit after dark waits for the sun to be down');
  check(m({ type: 'visit', place: 'Square' }, world({ x: 10 }), {}) && !m({ type: 'visit', place: 'Square' }, world({ x: 90 }), {}), 'a visit to a place is met inside it');
  const sun = { type: 'sun', place: 'Square', date: [6, 21], window: ['12:00', '14:00'] };
  check(m(sun, world({ sunState: 'sun' }), {}), 'a place in the sun: in sun, on the date, in the window');
  check(!m(sun, world({ sunState: 'shade' }), {}) && !m(sun, world({ sunState: 'sun', clock: { m: 6, d: 22, min: 720 } }), {}) && !m(sun, world({ sunState: 'sun', clock: { m: 6, d: 21, min: 900 } }), {}), 'not in shade, on another day or after the window');
  const steps = { type: 'surface', surface: 'Steps', u: [5, 9] };
  check(m(steps, world({ floor: 'Steps', stripU: () => 6 }), {}) && !m(steps, world({ floor: 'Steps', stripU: () => 2 }), {}) && !m(steps, world({ floor: null, stripU: () => 6 }), {}), 'a surface is met on its strip, between the two distances');
  check(m({ type: 'land', place: 'Square' }, world({ mode: 'heli', landed: [5, 5] }), {}) && !m({ type: 'land', place: 'Square' }, world({ mode: 'heli', landed: null }), {}), 'a landing is met on the ground in the place');
  check(m({ type: 'inspect', sources: ['a', 'b'] }, world(), { inspected: ['b', 'a'] }) && !m({ type: 'inspect', sources: ['a', 'b'] }, world(), { inspected: ['a'] }), 'the lens has found one of each');
  check(m({ type: 'penguins', count: 3 }, world({ colonyNear: () => 4 }), {}) && !m({ type: 'penguins', count: 3 }, world({ colonyNear: () => 1 }), {}), 'enough penguins ashore near you');
  check(!m({ type: 'talk', npc: 'a' }, world(), {}), 'a talk is never met by standing somewhere');

  const said = [];
  const T = { npcs: [{ id: 'a' }, { id: 'b' }], spots: [{ id: 's' }], wharves: [{ id: 'w1' }, { id: 'w2' }],
    lines: [{ id: 'start' }, { id: 'one', after: ['start'] }, { id: 'two', after: ['start'] }, { id: 'end', after: ['one', 'two'], on_open: 'x' }],
    quests: [{ id: 'q0', line: 'start', giver: 'a', stamp: 'S0', title: 'T0', talk: ['hi'], steps: [] },
      { id: 'q1', line: 'one', giver: 'a', stamp: 'S1', title: 'T1', talk: ['hi'], steps: [{ type: 'visit', at: [100, 0], radius: 10, text: 'go' }, { type: 'talk', npc: 'b', text: 'talk' }] },
      { id: 'q1b', line: 'one', giver: 'b', stamp: 'S1b', title: 'T1b', talk: ['hi'], steps: [{ type: 'ride', from: 'w1', to: 'w2', text: 'ride' }] },
      { id: 'q2', line: 'two', giver: 'b', stamp: 'S2', title: 'T2', talk: ['hi'], steps: [{ type: 'spot', spot: 's', text: 'look' }, { type: 'rail', from: 'r1', to: 'r2', text: 'train' }, { type: 'under_bridge', text: 'fly' }] },
      { id: 'q3', line: 'end', giver: 'a', stamp: 'S3', title: 'T3', talk: ['hi'], steps: [] }] };
  check(GOALS.audit(T).length === 0, `the made-up map is sound (${GOALS.audit(T).join('; ')})`);
  const g = GOALS.create(T, { next: s => said.push(`next ${s.text}`), begun: q => said.push(`begun ${q.id}`), done: (q, l, opened) => said.push(`done ${q.id}${opened.length ? ` opens ${opened.map(x => x.id)}` : ''}`), when: () => 'now' });
  const ids = () => g.openLines().map(l => l.id).join();
  check(ids() === 'start', 'only the prologue is open at first');
  let t = g.talked('a');
  check(t && t.quest.id === 'q0', 'its giver hands it over');
  g.startQuest(t.line, t.quest);
  check(ids() === 'one,two' && g.qs.stamps.length === 1 && said.includes('done q0 opens one,two'), 'a quest with no steps is done as it is taken, and the lines behind it open');
  check(g.wantsTalk('a') && g.wantsTalk('b'), 'both givers are waiting');
  t = g.talked('a'); g.startQuest(t.line, t.quest);
  t = g.talked('b'); g.startQuest(t.line, t.quest);
  check(g.tracked().id === 'two', 'the line taken last is tracked');
  g.check(world({ x: 100 }));
  check(g.ls(g.lineById('one')).si === 1, 'a step of a line that is not tracked completes all the same');
  const kept = JSON.parse(JSON.stringify(g.qs)); // (a save here, loaded below)
  g.spotSeen('s');
  check(!g.railed('r1', 'r9') && g.railed('r1', 'r2'), 'the right train, to the right station');
  g.flewUnder('any');
  check(g.lineDone(g.lineById('two')) && ids() === 'one', 'line two is done; the finale still waits for line one');
  t = g.talked('b');
  check(t && t.quest.id === 'q1b', 'talking to someone ends that step, and they hand over the next quest');
  g.startQuest(t.line, t.quest);
  g.boarded('w2'); g.landedAt('w2');
  check(!g.lineDone(g.lineById('one')), 'a ferry boarded at the wrong wharf does not count');
  g.boarded('w1'); g.landedAt('w2');
  check(ids() === 'end' && g.tracked().id === 'end', 'the finale opens, and is tracked');
  t = g.talked('a'); g.startQuest(t.line, t.quest);
  check(g.allDone() && g.qs.stamps.map(s => s.id).join() === 'q0,q2,q1,q1b,q3', `every line done, stamped in the order played (${g.qs.stamps.map(s => s.id)})`);
  check(g.stamp('extra', 'E', 'e') && !g.stamp('extra', 'E', 'e'), 'a stamp of its own is given once');
  const h = GOALS.create(T); h.load(kept);
  check(h.ls(h.lineById('one')).si === 1 && h.tracked().id === 'two' && h.qs.stamps.length === 1, 'a save loads to where it was kept');
  h.reset();
  check(h.openLines().map(l => l.id).join() === 'start' && !h.qs.stamps.length, 'and a new game starts from the prologue');
  const old = GOALS.create(T); old.load({ qi: 1, started: true, si: 1, stamps: [{ id: 'q0' }] });
  check(old.ls(old.lineById('one')).started && old.ls(old.lineById('one')).si === 1 && old.lineDone(old.lineById('start')), 'a save from before the lines is read by its stamps');
  const B = JSON.parse(JSON.stringify(T)); B.lines[0].after = ['end']; B.quests[1].giver = 'nobody'; B.quests[3].steps[0].spot = 'none';
  check(GOALS.audit(B).length >= 4, 'a ring of lines, a giver and a spot that are not there are all found');
}

// ---- every live map's own goals
const live = named.length ? named : execSync('tools/live_cities.sh', { cwd: ROOT }).toString().split('\n').filter(Boolean);
for (const id of live) {
  const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data', id, 'game.json'), 'utf8'));
  const city = JSON.parse(fs.readFileSync(path.join(ROOT, 'cities', id, 'city.json'), 'utf8'));
  if (!(G.quests || []).length) { console.log(`${id}: no quests`); continue; }
  for (const w of GOALS.audit(G)) check(false, `${id}: ${w}`);
  // played through: each line's giver spoken to, each step done as the game would report it
  const play = (g, limit = 400) => {
    for (let i = 0; i < limit && !g.allDone(); i++) {
      const l = g.openLines()[i % g.openLines().length], q = g.questOf(l), s = g.stepOf(l);
      const take = t => { if (t) g.startQuest(t.line, t.quest); };
      if (!g.ls(l).started) take(g.talked(q.giver));
      else if (s.type === 'talk') take(g.talked(s.npc));
      else if (s.type === 'spot') g.spotSeen(s.spot);
      else if (s.type === 'ride') { g.boarded(s.from); g.landedAt(s.to); }
      else if (s.type === 'rail') g.railed(s.from, s.to);
      else if (s.type === 'under_bridge') g.flewUnder(s.surface);
      else {
        const at = s.at || [0, 0], hmid = s.window ? (GOALS.hm(s.window[0]) + GOALS.hm(s.window[1])) / 2 : 720;
        g.ls(l).inspected.push(...(s.sources || s.kinds || []));
        g.check({ mode: s.type === 'land' ? 'heli' : 'foot', x: at[0], y: at[1], floor: s.surface, sunState: 'sun', sunAlt: s.after_dark ? -10 : 30, clock: { m: (s.date || [6])[0], d: (s.date || [6, 21])[1], min: hmid },
          landed: [0, 0], stripU: () => (s.u ? (s.u[0] + s.u[1]) / 2 : 0), inPlace: () => true, colonyNear: () => 99 });
      }
    }
    return g.allDone();
  };
  const g = GOALS.create(G);
  const done = play(g);
  check(done, `${id}: the lines play through to the end${done ? '' : ` (stuck with ${g.openLines().map(l => `${l.id}: ${(g.questOf(l) || {}).id}`).join(', ') || 'no line open'})`}`);
  const got = g.qs.stamps.map(s => s.id);
  check(G.quests.every(q => got.filter(x => x === q.id).length === 1), `${id}: every quest is stamped once (${got.length} of ${G.quests.length})`);
  const half = GOALS.create(G); play(half, Math.ceil(G.quests.length * 1.5));
  const again = GOALS.create(G); again.load(JSON.parse(JSON.stringify(half.qs)));
  check(play(again), `${id}: kept half way and loaded, it plays on to the end`);

  // where each step is: from the start, and inside the district a phone plays in
  const start = G.start.at, D = city.phone_district, npc = k => (G.npcs || []).find(o => o.id === k), lineOf = q => (G.lines || []).find(l => l.id === q.line) || {};
  const where = s => (s.type === 'talk' ? (npc(s.npc) || {}).at : s.type === 'spot' ? ((G.spots || []).find(o => o.id === s.spot) || {}).at
    : s.type === 'ride' ? ((G.wharves || []).find(o => o.id === s.to) || {}).landing : s.at) || null;
  const inD = at => !D || (at[0] >= D.x[0] && at[0] <= D.x[1] && at[1] >= D.y[0] && at[1] <= D.y[1]);
  let far = 0, out = 0, placed = 0;
  for (const q of G.quests) {
    const stops = [[`given by ${q.giver}`, (npc(q.giver) || {}).at], ...q.steps.map(s => [s.text, where(s)])];
    for (const [text, at] of stops) {
      if (!at) continue;
      placed++;
      const d = Math.hypot(at[0] - start[0], at[1] - start[1]);
      far = Math.max(far, d);
      if (inD(at)) continue;
      out++;
      const must = strict || lineOf(q).phone === true;
      console.log(`${must ? 'FAIL' : 'note'} ${id}: a phone cannot reach "${q.id}" (${text}), ${Math.round(d)} m from the start and outside its district`);
      if (must) { n++; bad++; }
    }
  }
  console.log(`${id}: ${G.quests.length} quests on ${(G.lines || []).length || 1} lines play through; ${placed} places, the farthest ${Math.round(far)} m from the start, ${out} outside a phone's district`);
}
console.log(bad ? `goals: ${bad} of ${n} checks failed` : `ok   goals  ${n} checks: the rules, and ${live.length} live maps' lines played to the last stamp`);
process.exit(bad ? 1 : 0);
