// The Whitsundays: who you meet and what you can do, at the places the site config maps (scene.json pois).
//   Kim, ranger, on Whitehaven Beach by the spawn: the silica sand, Country, stingers, the reef's health, the survey
//   Jo, day-boat skipper, at South Whitehaven: boat runs (Hill Inlet Lookout, the dive boat, Chance Bay), the islands,
//     a scenic flight in the helicopter or the amphibian
//   Mia, guide, at Hill Inlet Lookout: the inlet's sand and water at this tide, computed from the model and the tide
//   Raf, dive instructor, on a catamaran anchored off South Whitehaven: down to 8 m to see where the red light went;
//     the night snorkel when life.js says the corals are spawning
//   Signs at the three lookouts on Whitsunday Island that carry Ngaro names, as signed and mapped.
// Ngaro and Gia content is limited to what the cited pages say and to the mapped names; nobody here speaks for
// Traditional Owners. Every number is computed while you play or cited (sources below and game/sources.js).
import { ranger, surveyQuest, surveyDoneNode, slatePages, reefPages } from './generic.js';

const SOURCES = {
  'wiki-whitehaven': { title: 'Whitehaven Beach', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Whitehaven_Beach', checked: '2026-10-28',
    says: 'seven kilometres long; 98% pure silica; retains a lot less heat, comfortable barefoot on a hot day; silica is not in the local rocks, surmised to have been brought by currents over millions of years; very fine, can damage phones and cameras; named in 1879 by Staff Commander E. P. Bedwell, Admiralty surveyor for Queensland, after the English town in Cumberland' },
  'wiki-whitsundays': { title: 'Whitsunday Islands', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Whitsunday_Islands', checked: '2026-10-28',
    says: '74 continental islands; the traditional lands and waters of the Ngaro and Gia peoples, who are the traditional owners, also called canoe people; Cook sailed through on Sunday 3 June 1770 (Whitsun) and named the passage Whitsundays\' Passage; the Whitsunday Ngaro Sea Trail is seaways and short walks across South Molle, Hook and Whitsunday islands' },
  'wiki-np': { title: 'Whitsunday Islands National Park', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Whitsunday_Islands_National_Park', checked: '2026-10-28',
    says: 'marine stingers are found in the waters of the islands between October and May; a walking track links Whitehaven Beach to Chance Bay' },
  'msq-tide': { title: 'Shute Harbour tide predictions (CC BY 4.0)', publisher: 'Maritime Safety Queensland', what: 'fitted to harmonic constituents in web/data/whitsundays/tide.json (tide.js)',
    url: 'https://www.data.qld.gov.au/dataset/7993f06a-f666-4231-8b9e-7f36ebaadae7/resource/0cde2f64-1684-4cc1-bbde-abe97871b862', checked: '2026-10-28',
    says: 'predicted tide at Shute Harbour, on the mainland 25 km west of Whitehaven Beach; times on the islands differ by some minutes' }
};

const NGARO_LOOKOUTS = ['bari-dhili-lookout', 'bilbili-dhili-lookout', 'murmuru-bari-lookout'];
const SHOW = new Set(['beach', 'bay', 'inlet', 'island', 'peak', 'lookout', 'marina']);   // what a sign lists as in sight

// ---- places that depend on the running model (the boats are placed by boats.js; the tide moves the shore)
const diveBoat = G => {
  if (G._diveBoat !== undefined) return G._diveBoat;
  const p = G.poi('whitehaven-anchorage'); let best = null, bd = 4000;
  if (p) for (const v of G.vessels()) {
    if (v.mode !== 'anchored' || !(v.kind === 'cat' || v.kind === 'yacht')) continue;
    const d = Math.hypot(v.x - p.x, -v.z - p.north) - (v.kind === 'cat' ? 600 : 0);   // a catamaran's open cockpit suits a dive boat
    if (d < bd) { bd = d; best = v; }
  }
  return (G._diveBoat = best);
};
// the nearest water near the boat that stays 8 m deep at the lowest tide the gauge predicts for today (or 10 m below MSL)
function divePoint(G) {
  if (G._divePoint) return G._divePoint;
  const v = diveBoat(G), c = v ? { x: v.x, north: -v.z } : G.poi('whitehaven-anchorage');
  const lows = G.tideTurns(4).filter(t => !t.high).map(t => t.z), floor = Math.min(-1.0, ...lows) - 8.6;
  let best = null, deepest = null;
  for (let r = 20; r < 1200 && !best; r += 15) for (let a = 0; a < 6.283; a += 15 / r) {
    const x = c.x + Math.cos(a) * r, n = c.north + Math.sin(a) * r, h = G.height(x, n);
    if (h < floor) { best = { x, north: n }; break; }
    if (!deepest || h < deepest.h) deepest = { x, north: n, h };
  }
  return (G._divePoint = Object.assign(best || deepest, { name: '8 m with Raf' }));
}
const aircraft = G => G.vessels().filter(v => (v.kind === 'helicopter' || v.kind === 'seaplane') && v.mode !== 'orbit' && v.mode !== 'player');
const vesselTarget = v => v ? { x: v.x, north: -v.z, name: v.name } : null;
const nearestAircraft = G => { const h = G.here(); let b = null, bd = 1e9; for (const v of aircraft(G)) { const d = Math.hypot(v.x - h.x, -v.z - h.north); if (d < bd) { bd = d; b = v; } } return b; };
// a beach a boat can put you on, near a place (the tide decides where the water's edge is)
const dropNear = (G, id, face) => { const p = G.poi(id); if (!p) return null; const s = G.landSpot(p.x, p.north, { minH: 0.2, maxH: 1.6, maxSlope: 0.25, wet: 1.2, maxR: 1500 }); return Object.assign(s, { face: face ? G.poi(face) || p : p }); };

// Hill Inlet in numbers: the sand and shallows within R of the inlet (ground between -2.5 and +2.5 m about mean sea
// level), and the share of it under water at a given tide
function inlet(G, R = 900) {
  const p = G.poi('hill-inlet'), hs = [];
  for (let dx = -R; dx <= R; dx += 30) for (let dn = -R; dn <= R; dn += 30) {
    if (dx * dx + dn * dn > R * R) continue;
    const h = G.height(p.x + dx, p.north + dn); if (h > -2.5 && h < 2.5) hs.push(h);
  }
  const wet = z => Math.round(100 * hs.filter(h => h < z).length / Math.max(1, hs.length));
  return { R, km2: hs.length * 900 / 1e6, wet };
}

// what you can see from a spot: named places within 7 km with a clear line over the model's terrain
function inSight(G, from, skip) {
  const out = [];
  for (const raw of G.S.pois || []) {
    const p = G.poi(raw.id);
    if (!SHOW.has(p.kind) || p.id === skip || NGARO_LOOKOUTS.includes(p.id)) continue;
    const d = G.dist(from, p); if (d < 150 || d > 7000) continue;
    if (G.lineOfSight(from, p, 1.6, p.kind === 'island' || p.kind === 'peak' ? 25 : 2)) out.push({ p, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, 4).map(o => `${o.p.name}, ${G.km(o.d)} ${G.dirName(G.bearing(from, o.p))}`);
}

const tideLine = G => {
  const T = G.tide(); if (!T) return null;
  const z = G.tideNow(), n = G.tideTurns(1)[0];
  return { t: `It's ${G.clock()}. The tide is ${z >= 0 ? '+' : ''}${z.toFixed(1)} m and ${T.rising(G.nowMs()) ? 'rising' : 'falling'}${n ? `; ${n.high ? 'high' : 'low'} water ${n.z >= 0 ? '+' : ''}${n.z.toFixed(1)} m at ${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: G.S.timezone }).format(new Date(n.t))}` : ''}, by the Shute Harbour predictions 25 km west, so give or take a few minutes here.`, src: ['msq-tide', 'model-sun'], note: false };
};

export default function whitsundays(G) {
  const P = id => G.poi(id);
  const inSeason = () => { const m = G.monthIndex(); return m >= 9 || m <= 4; };            // October to May (Wikipedia, national park)
  const signRead = id => !!G.st().signs[id];

  // ------------------------------------------------------------ Kim, the ranger
  const kim = ranger(G, { name: 'Kim', gender: 'W', nodes: {
    hello: { say: G => [
      { t: `${G.greet()}! I'm Kim, one of the rangers. This is Whitehaven Beach, on Whitsunday Island.`, src: ['model-pois', 'wiki-whitehaven'] },
      tideLine(G) || { t: `It's ${G.clock()}, and the sun is ${Math.round(G.sunNow().alt)}° up.`, src: ['model-sun'], note: false }],
      choices: [
        { text: 'Tell me about this sand.', go: G => G.isDone('sand') ? 'sandAgain' : G.isActive('sand') ? 'sandWalk' : 'sand' },
        { text: 'Whose Country is this?', go: 'country' },
        { text: 'Is it safe to swim here?', go: 'swim' },
        { text: 'What is there to do?', go: 'todo' }] },
    sand: { say: 'Before I tell you about it, walk 200 metres of it barefoot. Then come back and I\'ll tell you what you were walking on.', do: G => G.start('sand'), next: 'end' },
    sandWalk: { say: G => `${Math.round((G.data('sand') || {}).walked || 0)} of 200 m so far. Keep going.`, next: 'end' },
    sandFacts: { say: G => {
      const w = Math.round((G.data('sand') || {}).walked || 200);
      return [{ t: `${w} metres. The whole beach is seven kilometres long, so that was ${(100 * w / 7000).toFixed(1)}% of it.`, src: ['model-walk', 'wiki-whitehaven'] }, ...sandPages];
    }, next: 'hello' },
    sandAgain: { say: () => sandPages, next: 'hello' },
    country: { say: G => [
      { t: 'These islands and waters are the traditional homelands of the Ngaro and Gia peoples, the Traditional Owners, also called the canoe people.', src: ['wiki-whitsundays'] },
      { t: `Three lookouts on this island carry Ngaro names, as signed and mapped: ${NGARO_LOOKOUTS.map(id => `${P(id).name.replace(/ Lookout$/, '')}, ${G.where(id)}`).join('; ')}.`, src: ['model-pois'] },
      { t: 'Their stories are theirs to tell, not mine. What I can do is point you to the signs at those lookouts.', src: null }],
      choices: [{ text: 'I\'ll find those signs.', do: G => G.start('lookouts'), go: 'end', when: G => !G.state('lookouts') }, { text: 'Back', go: 'hello' }] },
    swim: { say: G => {
      const pages = [{ t: `Marine stingers are in the waters of these islands from October to May. It's ${G.month()}${inSeason() ? ', so the season is on' : ''}.`, src: ['wiki-np', 'model-sun'] },
        { t: 'Surf Life Saving Queensland\'s advice is a full-body stinger suit whenever you\'re in the ocean in the season. Box jellyfish and irukandji are the dangerous ones.', src: ['slsq-stingers'] }];
      if (inSeason() && !G.player.S.gear.mask) pages.push({ t: 'There\'s a suit in the dive kit by the red flag: E at the kit.', src: null });
      return pages;
    }, do: G => { if (inSeason()) G.start('stinger'); },
      choices: [{ text: 'How is the reef doing?', go: 'reef' }, { text: 'Can I help with a survey?', go: 'survey', when: G => G.species().length > 0 && !G.state('survey') }, { text: 'Back', go: 'hello' }] },
    reef: { say: [...reefPages, { t: 'Reefs like the ones around these islands are fringing reefs, attached to high islands.', src: ['wiki-gbr'] }], next: 'swim' },
    todo: { say: G => {
      const pages = [{ t: `Jo's day boat works from South Whitehaven, ${G.where('npc:skipper')} along the beach. Jo can run you round to Hill Inlet Lookout, or out to the dive boat.`, src: ['model-pois'] }];
      const h = G.vessels().find(v => v.kind === 'helicopter' && v.mode !== 'orbit');
      if (h) pages.push({ t: `And the scenic helicopter is on its pad, ${G.where(vesselTarget(h))} of here.`, src: ['model-pois'] });
      return pages;
    }, choices: [
      { text: 'I\'ll walk down to Jo.', do: G => G.start('dayboat'), go: 'end', when: G => !G.state('dayboat') },
      { text: 'Can you call the boat for me?', do: G => { G.start('dayboat'); runTo(G, 'skipper'); }, go: 'end' },
      { text: 'I want to see Hill Inlet.', do: G => G.start('inlet'), go: 'end', when: G => !G.state('inlet') },
      { text: 'Back', go: 'hello' }] }
  } });
  const sandPages = [
    { t: 'It\'s 98% pure silica. It holds a lot less of the sun\'s heat than ordinary sand, which is why it\'s comfortable barefoot on a hot day.', src: ['wiki-whitehaven'] },
    { t: 'There\'s no silica in the local rocks, so the thinking is that ocean currents carried it here over millions of years. It\'s fine enough to damage phones and cameras.', src: ['wiki-whitehaven'] },
    { t: 'The beach was named in 1879 by Staff Commander E. P. Bedwell, the Admiralty surveyor for Queensland, after Whitehaven in Cumberland, England.', src: ['wiki-whitehaven'] }];

  // ------------------------------------------------------------ boat runs (skip the trip)
  const RUNS = {
    lookout: { label: 'Hill Inlet Lookout', spot: G => dropNear(G, 'hill-inlet-lookout', 'hill-inlet-lookout'), title: 'Round to the beach below Hill Inlet Lookout' },
    diveboat: { label: 'the dive boat', title: 'Out to the dive boat', spot: G => {
      const v = diveBoat(G); if (!v) return null;
      const fx = Math.sin(v.hdg), fn = Math.cos(v.hdg), back = v.desc.L / 2 + 2.5;
      return { x: v.x - fx * back, north: -v.z - fn * back, face: { x: v.x, north: -v.z } };
    } },
    chance: { label: 'Chance Bay', spot: G => dropNear(G, 'chance-bay', 'bari-dhili-lookout'), title: 'Round to Chance Bay' },
    north: { label: 'the north end of Whitehaven', spot: G => { const s = G.spawn(); return { x: s.x, north: s.north, heading: s.heading }; }, title: 'Back up Whitehaven Beach' },
    skipper: { label: 'South Whitehaven', spot: G => { const r = G.npc('skipper'); if (!r) return null; const p = r.npc.group.position; const s = G.landSpot(p.x + 3, -p.z - 3, { msl: true, minH: 0.5, maxH: 4, maxR: 40 }); return Object.assign(s, { face: { x: p.x, north: -p.z } }); }, title: 'The tender runs you down to South Whitehaven' }
  };
  function runTo(G, key) {
    const r = RUNS[key], s = r && r.spot(G);
    if (!s) { G.say('No boat can get there right now.', 3); return; }
    const d = G.dist(G.here(), s);
    G.transfer(s, r.title, `${G.km(d)} by boat`);
  }

  // ------------------------------------------------------------ Jo, the skipper
  const jo = {
    id: 'skipper', role: 'skipper', name: 'Jo', title: 'Day-boat skipper', gender: 'M',
    at: G => {
      const p = P('whitehaven-south'), v = diveBoat(G), face = v ? { x: v.x, north: -v.z } : P('whitehaven-anchorage');
      const s = G.landSpot(p.x, p.north, { msl: true, minH: 1.8, maxH: 5, maxSlope: 0.3, maxR: 300, toward: face });
      return { x: s.x, north: s.north, heading: G.bearing(s, face) };
    },
    nodes: {
      hello: { say: G => {
        const w = G.wind(), pages = [{ t: 'G\'day, I\'m Jo. I skipper the day boat.', src: null }];
        if (w) pages.push({ t: `Wind's ${Math.round(w.kn)} knots from the ${G.dirName(w.from)} today.`, src: ['model-wind'] });
        return pages;
      }, choices: [
        { text: 'Can you run me somewhere?', go: 'runs' },
        { text: 'Tell me about the islands.', go: 'islands' },
        { text: 'Can I see it from the air?', go: 'flight', when: G => aircraft(G).length > 0 },
        { text: 'See you, Jo.', go: 'end' }] },
      runs: { say: 'Where to?', choices: [
        { text: G => `Hill Inlet Lookout (${G.where(RUNS.lookout.spot(G) || P('hill-inlet-lookout'))} by boat)`, do: G => runTo(G, 'lookout'), go: 'end' },
        { text: 'Out to the dive boat', do: G => runTo(G, 'diveboat'), go: 'end', when: G => !!diveBoat(G) },
        { text: 'Chance Bay, for Bari Dhili Lookout', do: G => runTo(G, 'chance'), go: 'end' },
        { text: 'The north end of Whitehaven', do: G => runTo(G, 'north'), go: 'end' }] },
      islands: { say: G => {
        const r = G.npc('skipper'), from = r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z } : G.here();
        const seen = inSight(G, from, 'whitehaven-south').filter(s => !/^Whitehaven/.test(s));
        return [{ t: 'There are 74 continental islands in the Whitsundays.', src: ['wiki-whitsundays'] },
          { t: 'Captain Cook sailed through on Sunday 3 June 1770, the day Whitsun was celebrated, and named it Whitsundays\' Passage.', src: ['wiki-whitsundays'] },
          seen.length ? { t: `From here, in sight over the model's terrain: ${seen.join('; ')}.`, src: ['model-terrain', 'model-pois'] } : null];
      }, next: 'hello' },
      flight: { say: G => {
        const h = aircraft(G).find(v => v.kind === 'helicopter'), s = aircraft(G).find(v => v.kind === 'seaplane');
        return [{ t: `${h ? `The helicopter is on its pad, ${G.where(vesselTarget(h))}` : ''}${h && s ? ', and the' : s ? 'The' : ''}${s ? ` Reef Air amphibian is anchored ${G.where(vesselTarget(s))}` : ''}. Take one up over Hill Inlet and Whitehaven, then put it down again.`, src: ['model-pois'] }];
      }, do: G => G.start('flight'), next: 'end' }
    }
  };

  // ------------------------------------------------------------ Mia, the guide at Hill Inlet Lookout
  const mia = {
    id: 'guide', role: 'guide', name: 'Mia', title: 'Reef guide', gender: 'W', animation: 'Idle_Neutral',
    at: G => {
      const p = P('hill-inlet-lookout'), inl = P('hill-inlet');
      const s = G.landSpot(p.x, p.north, { msl: true, minH: 3, maxH: 400, maxSlope: 0.6, maxR: 40, toward: inl });
      return { x: s.x, north: s.north, heading: G.bearing(s, G.here()) };
    },
    nodes: {
      hello: { say: 'Hi, I\'m Mia. I bring the day-boat groups up here.', choices: [
        { text: 'What am I looking at?', go: 'inlet', do: G => { if (!G.state('inlet')) G.start('inlet'); if (G.isActive('inlet') && G.stepIndex('inlet') < 2) G.advance('inlet', 2); } },
        { text: 'Take me back to the beach.', do: G => runTo(G, 'skipper'), go: 'end' },
        { text: 'Bye, Mia.', go: 'end' }] },
      inlet: { say: G => {
        const r = G.npc('guide'), me = r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z } : P('hill-inlet-lookout');
        const elev = Math.round(G.height(me.x, me.north)), I = inlet(G), z = G.tideNow(), T = G.tide(), next = G.tideTurns(1)[0];
        const pages = [{ t: `This lookout is ${elev} m above mean sea level in the model. Hill Inlet is ${G.where('hill-inlet', me)} of us.`, src: ['model-terrain', 'model-pois'] },
          { t: `Within ${I.R} m of the inlet, ${I.km2.toFixed(1)} km² of the model is sand and shallows, between 2.5 m below and 2.5 m above mean sea level. At ${T ? `this tide, ${z >= 0 ? '+' : ''}${z.toFixed(1)} m` : 'mean sea level'}, ${I.wet(z)}% of it is under water.`, src: T ? ['model-terrain', 'msq-tide'] : ['model-terrain'] }];
        if (T && next) pages.push({ t: `${next.high ? 'High' : 'Low'} water is ${next.z >= 0 ? '+' : ''}${next.z.toFixed(1)} m at ${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: G.S.timezone }).format(new Date(next.t))} by the Shute Harbour predictions, and then ${I.wet(next.z)}% of it will be under water. That is what moves the sand and water patterns around all day.`, src: ['msq-tide', 'model-terrain'] });
        else pages.push({ t: `A metre more water would cover ${I.wet(1)}% of it, a metre less ${I.wet(-1)}%. The tide moves those patterns around all day.`, src: ['model-terrain'] });
        pages.push({ t: 'Go on, have a proper look out over the inlet.', src: null });
        return pages;
      }, next: 'end' }
    }
  };

  // ------------------------------------------------------------ Raf, dive instructor, on the anchored dive boat
  const raf = {
    id: 'instructor', role: 'diveInstructor', name: 'Raf', title: 'Dive instructor', gender: 'M', radius: 7,
    at: G => {
      const v = diveBoat(G);
      if (v) return { vessel: v, local: v.kind === 'cat' ? [-5.6, 1.45, 0.7] : [-3.6, 1.15, 0.5], heading: 0 };
      const s = dropNear(G, 'whitehaven-south'); return s ? { x: s.x, north: s.north, heading: 90 } : null;
    },
    nodes: {
      hello: { say: G => {
        const v = diveBoat(G);
        return [{ t: `${v ? `Welcome to ${v.name}. ` : ''}I'm Raf; I run the dives off this boat.`, src: null },
          { t: `My computer reads ${G.waterTemp(0).toFixed(0)} °C at the surface today.`, src: ['model-dive'] }];
      }, choices: [
        { text: 'Where does the red go, deeper down?', go: 'red', when: G => !G.state('red') },
        { text: 'Can I see the corals spawn?', go: 'spawn', when: G => !!(G.life() && G.life().spawning && G.life().spawning.active) && !G.isDone('spawning') },
        { text: 'Back to the beach, please.', do: G => runTo(G, 'skipper'), go: 'end' },
        { text: 'Thanks, Raf.', go: 'end' }] },
      red: { say: G => {
        const d = divePoint(G);
        return [{ t: 'Come down to 8 metres with me and see for yourself. Here\'s a tank, a BCD and a regulator.', src: null },
          { t: `I'll wait for you at 8 m, ${G.where(d)} of here, where the bottom is ${Math.round(G.tideNow() - G.height(d.x, d.north))} m down at this tide. G lets air out of the BCD, Q equalises your ears. Come up slowly.`, src: ['model-terrain'] }];
      }, do: G => { G.player.equip('scuba'); G.start('red'); }, next: 'end' },
      spawn: { say: G => {
        const sp = G.life().spawning, s = G.sunset().set, rise = G.moonrise(s - 3 * 3600e3), gap = rise && rise > s ? Math.round((rise - s) / 60000) : 0;
        return [{ t: `The inner reefs spawn in the week after the October full moon. By the model it's ${sp.nightsAfterFullMoon} night${sp.nightsAfterFullMoon === 1 ? '' : 's'} since the full moon.`, src: ['wiki-gbr', 'model-life'] },
          { t: `It comes in the evening or at night, and the cue seems to be the dark between sunset and moonrise. Tonight the sun sets at ${G.time(s)}${rise ? `, and by the model's moon it rises at ${G.time(rise)}${gap ? `: ${Math.floor(gap / 60)} h ${gap % 60} min of dark` : ', before the sun is down'}` : ''}.`, src: ['wiki-coral', 'model-sun'] },
          { t: 'Snorkel over the reef then, mask on.', src: null }];
      }, do: G => G.start('spawning'), choices: [
        { text: 'Skip ahead to half an hour after sunset', do: G => G.skipTo(G.sunset().set + 1800e3), go: 'end', when: G => G.sunNow().alt > -6 },
        { text: 'I\'ll come back later.', go: 'end' }] },
      surveyDone: surveyDoneNode()
    }
  };
  // Raf under water, waiting at 8 m while the dive is on
  function diver(G) {
    if (G.npc('raf-diving')) return;
    const d = divePoint(G), b = diveBoat(G);
    G.spawnNpc({ id: 'raf-diving', role: 'diveInstructor', name: 'Raf', gender: 'M', talk: false,
      at: () => ({ x: d.x, north: d.north, up: G.tideNow() - 7.6, depth: 7.6, swim: true, heading: b ? G.bearing(d, { x: b.x, north: -b.z }) : 0 }) });
  }

  // ------------------------------------------------------------ signs at the lookouts
  // a sign by the lookout, `side` metres to the left of the view (so a person standing at the lookout is not in front of it)
  const signAt = (id, face, side = 0) => G => {
    const p = P(id); if (!p) return null;
    const f = P(face) || p, b = G.bearing(p, f) * Math.PI / 180;
    const s = G.landSpot(p.x - Math.cos(b) * side, p.north + Math.sin(b) * side, { msl: true, minH: 2, maxH: 600, maxSlope: 0.6, maxR: 40 });
    return { x: s.x, north: s.north, heading: G.bearing(s, f) };
  };
  const signNodes = id => ({ read: { say: G => {
    const p = P(id), sg = G.sign(id), at = sg ? { x: sg.x, north: sg.north } : p, elev = Math.round(G.height(at.x, at.north)), seen = inSight(G, at, id);
    const ngaro = NGARO_LOOKOUTS.includes(id);
    return [{ t: `${p.name}. ${ngaro ? 'A lookout named in Ngaro, as signed and mapped; the English in brackets is part of the mapped name. ' : ''}${elev} m above mean sea level in the model.`, src: ['model-pois', 'model-terrain'] },
      seen.length ? { t: `In sight from here over the model's terrain: ${seen.join('; ')}.`, src: ['model-terrain', 'model-pois'] } : null];
  } } });
  const signs = [
    ...NGARO_LOOKOUTS.map(id => ({ id, title: P(id) ? P(id).name : id, at: signAt(id, 'whitehaven'), nodes: signNodes(id) })),
    { id: 'hill-inlet-lookout', title: 'Hill Inlet Lookout', at: signAt('hill-inlet-lookout', 'hill-inlet', 9), nodes: signNodes('hill-inlet-lookout') }
  ].filter(s => P(s.id));

  // ------------------------------------------------------------ quests
  const onFoot = G => ['walk', 'run', 'wade'].includes(G.player.state);
  const quests = [
    { id: 'sand', title: 'Whitehaven sand', summary: 'Walked the silica and heard what it is.', hint: 'Ask Kim, the ranger, about the sand.',
      steps: [
        { text: (G, d) => `Walk 200 m on the sand, barefoot (${Math.round(d.walked || 0)} m)`, enter: (G, d) => { d.walked = 0; d.last = null; },
          tick: (G, dt, d) => {
            const h = G.here(), low = G.height(h.x, h.north) < 4;           // the beach, not the dunes or the bush behind
            if (d.last && onFoot(G) && low) d.walked += Math.min(G.dist(d.last, h), 8 * dt);
            d.last = { x: h.x, north: h.north };
          }, check: (G, d) => d.walked >= 200 },
        { text: 'Tell Kim how it felt', target: 'npc:ranger', talkTo: 'ranger', node: 'sandFacts' }] },
    { id: 'dayboat', title: 'The day boat', summary: 'Met Jo, who runs the day boat from South Whitehaven.', hidden: true,
      steps: [{ text: 'Find Jo at South Whitehaven', target: 'npc:skipper', talkTo: 'skipper', node: 'hello' }] },
    { id: 'inlet', title: 'Hill Inlet from above', summary: 'Looked out over Hill Inlet with Mia.', hint: 'Get up to Hill Inlet Lookout: Jo\'s boat can drop you below it.',
      steps: [
        { text: 'Get up to Hill Inlet Lookout (Jo\'s boat can drop you below it)', target: 'hill-inlet-lookout', check: G => G.dist(G.here(), P('hill-inlet-lookout')) < 60 },
        { text: 'Talk to Mia at the lookout', target: 'npc:guide', talkTo: 'guide', node: 'inlet' },
        { text: 'Look out over the inlet', target: 'hill-inlet', enter: (G, d) => { d.look = 0; },
          tick: (G, dt, d) => { const h = G.here(), b = G.bearing(h, P('hill-inlet')), off = Math.abs(((b - G.player.heading) % 360 + 540) % 360 - 180); if (off < 25 && G.dist(h, P('hill-inlet-lookout')) < 80) d.look += dt; else d.look = Math.max(0, d.look - dt); },
          check: (G, d) => d.look >= 2 }],
      onDone: G => G.say('That\'s the view: sand and water, and the tide moving them.', { kind: 'good', secs: 5 }) },
    surveyQuest({ giver: 'ranger', giverName: 'Kim', max: 5 }),
    { id: 'red', title: 'Where did the red go?', summary: 'Dived to 8 m with Raf and read the slate.', hint: 'Ask Raf, on the dive boat off South Whitehaven. Jo can run you out.',
      steps: [
        { text: 'Dive to 8 m and meet Raf', target: G => divePoint(G), enter: G => diver(G),
          check: G => G.player.state === 'scuba' && G.player.depth >= 7.4 && G.dist(G.here(), divePoint(G)) < 60 },
        { text: 'Read the slate, then come up slowly: safety stop at 5 m', enter: G => {
          G.openDialogue({ name: 'Raf', role: 'Dive instructor, writing on a slate', id: 'slate' }, { slate: { say: G2 => [...slatePages(G2, G2.player.depth), { t: 'Thumbs up: up we go, slowly. Three minutes at 5 metres.', src: null }], next: 'end' } }, 'slate');
        }, check: G => G.player.depth < 0.4 && !G.dialogue() }],
      onDone: G => G.hideNpc(G.npc('raf-diving'), true) },
    { id: 'flight', title: 'Scenic flight', summary: 'Flew over Hill Inlet and Whitehaven Beach.', hint: 'Ask Jo about seeing it from the air.',
      steps: [
        { text: 'Take the helicopter or the amphibian', target: G => vesselTarget(nearestAircraft(G)), on: { board: (G, d, v) => v.kind === 'helicopter' || v.kind === 'seaplane' } },
        { text: 'Fly over Hill Inlet, above 100 m', target: 'hill-inlet', check: G => { const v = G.aboard(); return !!v && v.y - G.tideNow() > 100 && G.dist({ x: v.x, north: -v.z }, P('hill-inlet')) < 900; } },
        { text: 'Fly along Whitehaven Beach', target: 'whitehaven', check: G => { const v = G.aboard(); return !!v && v.y - G.tideNow() > 40 && G.dist({ x: v.x, north: -v.z }, P('whitehaven')) < 900; } },
        { text: 'Land, and step out with F', on: { leave: () => true } }] },
    { id: 'lookouts', title: 'Lookouts with Ngaro names', summary: 'Read the signs at the three lookouts named in Ngaro.', hint: 'Ask Kim whose Country this is.', hidden: true,
      steps: [{ text: () => `Read the signs at the three Ngaro-named lookouts (${NGARO_LOOKOUTS.filter(signRead).length}/3)`,
        target: G => { const h = G.here(); let b = null, bd = 1e9; for (const id of NGARO_LOOKOUTS) { if (signRead(id)) continue; const s = G.sign(id); if (s && G.dist(h, s) < bd) { bd = G.dist(h, s); b = { x: s.x, north: s.north, name: s.title }; } } return b; },
        check: () => NGARO_LOOKOUTS.every(signRead) }] },
    { id: 'stinger', title: 'Stinger suit', summary: 'Suited up for stinger season.', hidden: true, available: () => inSeason(),
      steps: [{ text: 'Put on the stinger suit: E at the dive kit', target: G => { const k = G.player.kit; return { x: k.position.x, north: -k.position.z, name: 'Dive kit' }; }, check: G => G.player.S.gear.mask }] },
    { id: 'spawning', title: 'Spawning night', summary: 'Snorkelled over the reef on a spawning night.', hidden: true,
      available: G => !!(G.life() && G.life().spawning && G.life().spawning.active),
      steps: [
        { text: G => `Wait for dark (sunset ${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: G.S.timezone }).format(new Date(G.sunset().set))})`, check: G => G.sunNow().alt < -6 },
        { text: (G, d) => `Snorkel over the reef in the dark, mask on (${Math.round(d.t || 0)}/20 s)`, enter: (G, d) => { d.t = 0; },
          target: G => { const r = G.npc('instructor'); return r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z, name: 'the dive boat' } : null; },
          tick: (G, dt, d) => { const h = G.here(); if (G.player.S.water && G.player.S.gear.mask && G.ctx.habitat(h.x, h.north) === 2) d.t += dt; }, check: (G, d) => d.t >= 20 }],
      onDone: G => G.note('spawning-night', 'Snorkelled over the reef after dark in the week after the October full moon, when the inner reefs spawn.', ['wiki-gbr', 'model-life'], 'Raf') }
  ];

  return {
    sources: SOURCES, quests, signs,
    npcs: [kim, jo, mia, raf],
    start(G) {
      const v = diveBoat(G); if (v && G.boats) G.noBoard(v);                // the dive boat stays at anchor: you swim to it and talk to Raf
      if (G.isActive('red') && G.stepIndex('red') === 0) diver(G);
      // in the season, Kim calls out when you head into the water without a stinger suit (once a visit)
      let told = false;
      if (G.player) G.player.onChange(s => {
        if (told || !inSeason() || G.player.S.gear.mask || !(s === 'wade' || s === 'swim')) return;
        const k = G.npc('ranger'); if (!k || !k.npc.rig) return;
        const p = k.npc.group.position, h = G.here(); if (Math.hypot(p.x - h.x, -p.z - h.north) > 60) return;
        told = true;
        const t = 'Stinger season! A full-body suit before you swim: there\'s one in the dive kit by the flag.';
        k.npc.say(t, 6); G.say(`Kim: ${t}`, { kind: 'warn', secs: 6 });
        G.note('kim-stinger-call', 'Marine stingers are in the waters of these islands from October to May; the advice is a full-body stinger suit in the ocean in the season.', ['wiki-np', 'slsq-stingers'], 'Kim');
      });
    }
  };
}
