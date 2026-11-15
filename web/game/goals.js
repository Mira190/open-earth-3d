// A map's goals: its quests in parallel lines, what has been done of them, and the rules by which a
// step is met. Nothing here draws, reads the page or knows a city: a map's goals are its data
// (game.json "lines" and "quests", from cities/<id>/city.json), and a new map brings its own with no
// change here. game.js lends a host (what to show when something completes) and, each time it looks,
// a view of the world (where the player is, the hour, the sun); tools/goals_check.js runs the same
// code under Node against every live map's data, with no browser.
//
// Lines: each line is a chain of quests that runs on its own, and a line opens once the lines it
// comes after are finished. A prologue opens the others and a finale waits for them. Every open
// line's current step can complete, tracked or not; the HUD, the route and the beam follow the
// tracked line. Without "lines", all the quests make one line.
//
// A step is one of these, and a map uses only what it has:
//   talk         { npc }                         speak to someone
//   visit        { at, radius } or { place }     stand there on foot (after_dark: once the sun is down)
//   spot         { spot }                        look at a thing up close
//   surface      { surface, u: [from, to] }      stand on a named strip (steps, a deck) between two distances along it
//   ride         { from, to }                    a ferry from one wharf to another
//   rail         { from, to }                    a train from one station to another
//   land         { place }                       put the helicopter down in a place
//   under_bridge { surface? }                    fly under a span
//   sun          { place, date, window }         stand in direct sun in a place on a date between two hours
//   inspect      { sources }, gable { kinds }    find one of each with the lens
//   penguins     { radius, count }               wait where a colony comes ashore
// The steps met by where and when the player is are judged here (met); the ones that are an act
// (a talk, a ride, a spot looked at) are reported by the game as they happen (the methods below).
'use strict';
(function (root) {
  const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const POSITIONAL = ['surface', 'land', 'sun', 'inspect', 'gable', 'visit', 'penguins'];

  // Is this step met in the world as it is? w is the game's view of it:
  //   mode ('foot', 'heli', ...), x, y, floor (the strip stood on), sunState ('sun', 'shade', ...),
  //   sunAlt (degrees), clock { m, d, min }, stripU(name) the distance along that strip,
  //   landed (the helicopter's [x, y] on the ground, or null), inPlace(name, x, y), colonyNear(radius)
  // st is the line's own state (what the lens has found for it).
  function met(s, w, st) {
    if (s.type === 'surface') {
      if (w.mode !== 'foot' || w.floor !== s.surface) return false;
      const u = w.stripU(s.surface);
      return u >= s.u[0] && u <= s.u[1];
    }
    if (s.type === 'land') return w.mode === 'heli' && !!w.landed && w.inPlace(s.place, w.landed[0], w.landed[1]);
    if (s.type === 'sun') return w.mode === 'foot' && w.sunState === 'sun' && w.clock.m === s.date[0] && w.clock.d === s.date[1] &&
      w.clock.min >= hm(s.window[0]) && w.clock.min <= hm(s.window[1]) && w.inPlace(s.place, w.x, w.y);
    if (s.type === 'inspect') return s.sources.every(k => st.inspected.includes(k));
    if (s.type === 'gable') return s.kinds.every(k => st.inspected.includes(k));
    if (s.type === 'visit') return w.mode === 'foot' && (!s.after_dark || w.sunAlt < -0.5) &&
      (s.place ? w.inPlace(s.place, w.x, w.y) : Math.hypot(w.x - s.at[0], w.y - s.at[1]) < (s.radius || 25));
    if (s.type === 'penguins') return w.mode === 'foot' && w.colonyNear(s.radius || 40) >= (s.count || 5);
    return false;
  }

  // G: a map's game data. host: what the game does when the goals move on, each optional:
  //   next(step, quest, line)      a step done, this one is next
  //   begun(quest, line)           a quest taken, its first step is next
  //   done(quest, line, opened)    a quest finished and stamped; opened: the lines that this let open
  //   met(step, line)              a step judged met by check(), before it completes
  //   tracking(line, asked)        the tracked line changed by cycle()
  //   when()                       the date and hour to write on a stamp
  //   save()                       keep the state
  function create(G, host = {}) {
    const Q = G.quests || [];
    const LINES = (G.lines && G.lines.length ? G.lines : [{ id: 'main', title: '' }]).map(l => Object.assign({ after: [] }, l));
    for (const l of LINES) l.quests = Q.filter(q => (q.line || LINES[0].id) === l.id);
    const lineById = id => LINES.find(l => l.id === id);
    const fresh = () => ({ lines: {}, track: LINES[0].id, stamps: [], visited: {}, docked: false });
    const qs = fresh(); // one object for the life of the game: reset() and load() fill it in place
    const call = (k, ...a) => (host[k] ? host[k](...a) : undefined);
    const save = () => call('save');
    const ls = l => qs.lines[l.id] || (qs.lines[l.id] = { qi: 0, started: false, si: -1, inspected: [], rideFrom: null });
    const lineDone = l => ls(l).qi >= l.quests.length;
    const lineOpen = l => l.after.every(id => lineById(id) && lineDone(lineById(id)));
    const openLines = () => LINES.filter(l => lineOpen(l) && !lineDone(l));
    function tracked() { // the tracked line, or the first open one when it is finished or shut
      let l = lineById(qs.track);
      if (!l || !lineOpen(l) || lineDone(l)) { l = openLines()[0] || null; if (l) qs.track = l.id; }
      return l;
    }
    const questOf = l => (l ? l.quests[ls(l).qi] : null);
    const stepOf = l => (l && ls(l).started && questOf(l) ? questOf(l).steps[ls(l).si] : null);

    function completeStep(l) {
      const st = ls(l);
      st.si++;
      if (st.si >= questOf(l).steps.length) completeQuest(l);
      else { call('next', questOf(l).steps[st.si], questOf(l), l); save(); }
    }
    function completeQuest(l = tracked()) {
      const q = questOf(l), wasOpen = new Set(openLines());
      qs.stamps.push({ id: q.id, stamp: q.stamp, title: q.title, at: call('when') || '' });
      Object.assign(ls(l), { qi: ls(l).qi + 1, started: false, si: -1, inspected: [], rideFrom: null });
      const opened = lineDone(l) ? openLines().filter(x => !wasOpen.has(x)) : []; // lines this one was holding back open now
      if (opened.length === 1) qs.track = opened[0].id;
      call('done', q, l, opened);
      save();
    }
    function startQuest(l, q) {
      Object.assign(ls(l), { started: true, si: 0 });
      qs.track = l.id;
      if (!q.steps.length) completeQuest(l);
      else { call('begun', q, l); save(); }
    }
    // a stamp that is no quest's (a spot read, a ferry docked by hand): true the first time
    function stamp(id, name, title) {
      if (qs.stamps.some(s => s.id === id)) return false;
      qs.stamps.push({ id, stamp: name, title, at: call('when') || '' });
      return true;
    }

    // ---- what the game reports as it happens
    // spoken to: the lines waiting for this person move on. Returns the line and quest they now hand over, if any.
    function talked(npcId) {
      for (const l of openLines()) {
        const s = stepOf(l);
        if (!s || s.type !== 'talk' || s.npc !== npcId) continue;
        completeStep(l);
        const nq = questOf(l);
        if (nq && nq.giver === npcId && !ls(l).started && lineOpen(l)) return { line: l, quest: nq };
      }
      const ready = openLines().find(l => questOf(l).giver === npcId && !ls(l).started);
      return ready ? { line: ready, quest: questOf(ready) } : null;
    }
    const wantsTalk = npcId => openLines().some(l => { const s = stepOf(l); return ls(l).started ? s && s.type === 'talk' && s.npc === npcId : questOf(l).giver === npcId; });
    function spotSeen(spotId) { for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'spot' && s.spot === spotId) completeStep(l); } }
    const rideSteps = () => [tracked(), ...openLines()].filter(Boolean).map(l => [l, stepOf(l)]).filter(([, s]) => s && s.type === 'ride');
    function boarded(wharfId) { qs.visited[wharfId] = true; for (const [l, s] of rideSteps()) if (s.from === wharfId) ls(l).rideFrom = wharfId; }
    function landedAt(wharfId) { qs.visited[wharfId] = true; for (const [l, s] of new Map(rideSteps())) if (ls(l).rideFrom === s.from && wharfId === s.to) completeStep(l); }
    function railed(from, to) {
      for (const l of [tracked(), ...openLines()].filter(Boolean)) {
        const s = stepOf(l);
        if (s && s.type === 'rail' && from === s.from && to === s.to) { completeStep(l); return true; }
      }
      return false;
    }
    function flewUnder(surface) { for (const l of openLines()) { const s = stepOf(l); if (s && s.type === 'under_bridge' && (!s.surface || s.surface === surface)) completeStep(l); } }
    // the lens found something: found(step) returns the kinds this step asks for that it shows; each new one is kept
    function inspected(found, each) {
      for (const l of openLines()) {
        const s = stepOf(l), got = ls(l).inspected;
        if (!s || (s.type !== 'inspect' && s.type !== 'gable')) continue;
        for (const k of found(s) || []) if (!got.includes(k)) { got.push(k); if (each) each(k, got.length, s); }
      }
    }
    // every open line's step that the world now meets completes
    function check(w) {
      for (const l of openLines()) {
        const s = stepOf(l);
        if (s && POSITIONAL.includes(s.type) && met(s, w, ls(l))) { call('met', s, l); completeStep(l); }
      }
    }

    // ---- which line is followed
    // arriving somewhere: track the open line whose next quest is given by someone standing there, not the
    // map's first line, whose giver may be across the map. giverAt(id) is where that person stands.
    function trackNear(at, giverAt, within = 250) {
      let best = null, bd = within;
      for (const l of openLines()) {
        const q = questOf(l), p = q && !ls(l).started ? giverAt(q.giver) : null;
        const d = p ? Math.hypot(p[0] - at[0], p[1] - at[1]) : Infinity;
        if (d < bd) { bd = d; best = l; }
      }
      if (best) qs.track = best.id;
      return best;
    }
    function cycle(id) { // the next open line, or the one named
      const open = openLines();
      if (!open.length) return null;
      const cur = tracked(), next = id ? lineById(id) : open[(open.indexOf(cur) + 1) % open.length];
      if (!next || !open.includes(next)) return null;
      qs.track = next.id;
      call('tracking', next, open.length > 1 || !!id);
      save();
      return next;
    }

    // ---- the save
    // a save from before the lines (one chain, qs.qi): the stamps say which quests are done
    function migrate(old) {
      if (!old || old.lines) return old;
      const out = Object.assign(fresh(), { stamps: old.stamps || [], visited: old.visited || {}, docked: !!old.docked, trig: old.trig, guesses: old.guesses });
      const done = new Set(out.stamps.map(x => x.id)), cur = Q[old.qi];
      for (const l of LINES) {
        const st = out.lines[l.id] = { qi: 0, started: false, si: -1, inspected: [], rideFrom: null };
        while (st.qi < l.quests.length && done.has(l.quests[st.qi].id)) st.qi++;
        const q = l.quests[st.qi];
        if (q && cur && cur.id === q.id && old.started) Object.assign(st, { started: true, si: Math.min(old.si, q.steps.length - 1), inspected: old.inspected || [], rideFrom: old.rideFrom || null });
        if (q && cur && cur.id === q.id) out.track = l.id;
      }
      return out;
    }
    function reset() { for (const k of Object.keys(qs)) delete qs[k]; Object.assign(qs, fresh()); }
    function load(saved) { Object.assign(qs, migrate(saved)); }

    return { Q, LINES, qs, ls, lineById, lineDone, lineOpen, openLines, tracked, questOf, stepOf, quest: () => questOf(tracked()), step: () => stepOf(tracked()),
      completeStep, completeQuest, startQuest, stamp, talked, wantsTalk, spotSeen, rideSteps, boarded, landedAt, railed, flewUnder, inspected, check,
      trackNear, cycle, migrate, reset, load, allDone: () => Q.length > 0 && LINES.every(lineDone) };
  }

  // What is wrong with a map's goals as data, before anyone plays them: a list of plain sentences, empty
  // when sound. Looks at what the lines and quests name (each other, people, spots, wharves), not at the map.
  function audit(G) {
    const out = [], Q = G.quests || [], lines = G.lines && G.lines.length ? G.lines : [{ id: 'main' }];
    const ids = new Set(lines.map(l => l.id)), npcs = new Set((G.npcs || []).map(n => n.id)), spots = new Set((G.spots || []).map(s => s.id)), wharves = new Set((G.wharves || []).map(w => w.id));
    const seen = new Set();
    for (const l of lines) {
      if (seen.has(l.id)) out.push(`line "${l.id}" is listed twice`);
      seen.add(l.id);
      for (const a of l.after || []) if (!ids.has(a)) out.push(`line "${l.id}" comes after "${a}", which is no line`);
      if (!Q.some(q => (q.line || lines[0].id) === l.id) && (l.after || []).length) out.push(`line "${l.id}" has no quest`);
    }
    // a line that waits on itself, directly or round a ring, never opens
    const after = id => (lines.find(l => l.id === id) || {}).after || [];
    const waits = (id, on, depth = 0) => depth < 64 && after(id).some(a => a === on || waits(a, on, depth + 1));
    for (const l of lines) if (waits(l.id, l.id)) out.push(`line "${l.id}" waits on itself and never opens`);
    const qseen = new Set();
    for (const q of Q) {
      if (qseen.has(q.id)) out.push(`quest "${q.id}" is listed twice`);
      qseen.add(q.id);
      if (q.line && !ids.has(q.line)) out.push(`quest "${q.id}" is on line "${q.line}", which is no line`);
      if (!npcs.has(q.giver)) out.push(`quest "${q.id}" is given by "${q.giver}", who is not on the map`);
      if (!q.stamp) out.push(`quest "${q.id}" has no stamp`);
      if (!(q.talk || []).length) out.push(`quest "${q.id}" is given without a word`);
      (q.steps || []).forEach((s, i) => {
        const at = `quest "${q.id}" step ${i + 1} (${s.type})`;
        if (!s.text) out.push(`${at} has no text`);
        if (s.type === 'talk' && !npcs.has(s.npc)) out.push(`${at} names "${s.npc}", who is not on the map`);
        else if (s.type === 'spot' && !spots.has(s.spot)) out.push(`${at} names the spot "${s.spot}", which is not on the map`);
        else if (s.type === 'ride') { for (const k of ['from', 'to']) if (!wharves.has(s[k])) out.push(`${at} names the wharf "${s[k]}", which is not on the map`); }
        else if (s.type === 'visit' && !s.place && !(Array.isArray(s.at) && s.at.length >= 2)) out.push(`${at} says neither where (at) nor in what place`);
        else if (s.type === 'surface' && !(s.surface && Array.isArray(s.u))) out.push(`${at} needs a surface and a stretch of it (u)`);
        else if (s.type === 'sun' && !(s.place && s.date && s.window)) out.push(`${at} needs a place, a date and a window of hours`);
        else if (s.type === 'land' && !s.place) out.push(`${at} needs a place`);
        else if (!['talk', 'spot', 'ride', 'rail', 'visit', 'surface', 'sun', 'land', 'under_bridge', 'inspect', 'gable', 'penguins'].includes(s.type)) out.push(`${at} is a kind of step the game does not know`);
      });
    }
    return out;
  }

  const api = { create, met, audit, hm, POSITIONAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OEGoals = api;
})(typeof window !== 'undefined' ? window : globalThis);
