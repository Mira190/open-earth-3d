// Hardy Reef, on the outer Great Barrier Reef. There is no land: you start in the water off the Reefworld pontoon
// (scene.json poi `reefworld`, placed by boats.js), and the people stand on its deck and ride its swell.
//   Lena, pontoon host, at the south end: snorkel gear, Heart Reef, the water out here against the Whitsundays (the
//     satellite's deep-water colour and green attenuation, from both sites' optics), the reef's health
//   Sam, dive instructor, by the ladders: down the channel wall to 12 m, with the light left there on a slate
//   Heart Reef (poi `heart-reef`) is a scenic-flight objective: it is protected, so swimming near it gets a reminder.
// Every number is computed from the model or cited (sources below, game/sources.js, docs/GAME_REEF.md).
import { surveyQuest, surveyDoneNode, reefPages, slsqPages, slsqApplies, tidePage, loadOptics, blueness, opticsHere, diveQuest, standNear, surveySize } from './generic.js';

const SOURCES = {
  'tw-heart-reef': { title: 'How to see Heart Reef', publisher: 'Tourism Whitsundays', url: 'https://www.tourismwhitsundays.com.au/blog/how-to-see-heart-reef', checked: '2026-10-28',
    says: 'Heart Reef is located within Hardy Reef; first spotted by a local pilot in 1975; Heart Reef itself is protected, so swimming and snorkelling are not permitted at the formation; in-water experiences take place at nearby lagoons, reef pontoons and designated sites within Hardy Reef; the best way to see it is from the air' },
  'vdw-2015': { title: 'Comparative immune responses of corals to stressors associated with offshore reef-based tourist platforms (van de Water et al. 2015, Conservation Physiology 3: cov032)', publisher: 'Conservation Physiology',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4778433/', checked: '2026-10-28',
    says: 'Hardy Reef, located 75 km offshore within the central Great Barrier Reef, an outer reef; corals monitored beside a high-use and an unused reef-based tourist platform and at a nearby control site without one over seven summer months; signs of white syndromes in 31% of study corals near tourist platforms in the warmest summer month' }
};

// spots on the pontoon deck, in its own frame (x along the long side, south at +x with the mapped heading of 180; deck at 0.55 m)
const HOST_DECK = [12.5, 0.55, -2.8], DIVE_DECK = [3.5, 0.55, 4.0];

export default function hardyReef(G) {
  const P = id => G.poi(id);
  const pontoon = () => G.boats && G.boats.pontoon;
  const base = () => { const p = pontoon(); return p ? { x: p.x, north: -p.z, name: p.name } : Object.assign(G.spawn(), { name: 'the spawn' }); };
  const aircraft = () => G.vessels().filter(v => (v.kind === 'helicopter' || v.kind === 'seaplane') && v.mode !== 'orbit' && v.mode !== 'player');
  const pct = v => v >= 0.1 ? Math.round(v * 100) : (v * 100).toFixed(1);

  // the channel wall under the pontoon: the depth there, and the deepest water within 120 m (the model's 30 m grid)
  let wallCache = null;
  const wall = () => {
    if (wallCache) return wallCache;
    const b = base(), top = G.depth(b.x, b.north);
    let bottom = top, r = 0;
    for (let rr = 15; rr <= 120; rr += 15) for (let a = 0; a < 6.283; a += 0.26) { const d = G.depth(b.x + Math.cos(a) * rr, b.north + Math.sin(a) * rr); if (d > bottom) { bottom = d; r = rr; } }
    return (wallCache = { top, bottom, r });
  };
  // where Sam waits: the nearest water to the pontoon that is 14 m below mean sea level (12 m deep at the lowest tide)
  let diveCache = null;
  const divePoint = () => {
    if (diveCache) return diveCache;
    const b = base(); let best = null;
    for (let r = 20; r < 500 && !best; r += 10) for (let a = 0; a < 6.283; a += 10 / r) { const x = b.x + Math.cos(a) * r, n = b.north + Math.sin(a) * r; if (G.height(x, n) < -14) { best = { x, north: n }; break; } }
    return (diveCache = Object.assign(best || { x: b.x + 40, north: b.north }, { name: '12 m with Sam' }));
  };
  // the water here against the Whitsundays: the deep water's colour from the satellite and the green attenuation, here from
  // env.u.Rinf and env.u.K (what the renderer uses, so a refit of the site's Kd shows up as it is) and there from its scene.json
  const whitsundays = () => (G._optics || {}).whitsundays || null;
  const waterPages = () => {
    const here = opticsHere(G), wh = whitsundays(), b = blueness(here), wb = wh ? blueness(wh.optics) : null;
    const site = (G.travel.list || []).find(s => s.id === 'whitsundays');
    const pages = [];
    if (b) pages.push({ t: `From the satellite, the deep water out here sends back ${b.toFixed(2)} times as much blue light as green${wb ? `; over the Whitsundays it is ${wb.toFixed(2)}` : ''}. Bluer water${site && site.km ? `, ${Math.round(site.km)} km from the islands` : ''}.`, src: ['model-optics'] });
    if (wh) { const h = Math.LN2 / here.K[1], w = Math.LN2 / wh.optics.K[1]; pages.push({ t: `Green light halves every ${h.toFixed(1)} m of water here, against ${w.toFixed(1)} m in the Whitsundays.`, src: ['model-optics'] }); }
    const W = wall();
    pages.push({ t: `Right under the pontoon the reef wall drops from ${W.top.toFixed(0)} m to ${W.bottom.toFixed(0)} m within ${W.r} m, at this tide.`, src: G.tide() ? ['model-terrain', 'model-tide'] : ['model-terrain'] });
    return pages;
  };

  // ------------------------------------------------------------ Lena, the pontoon host
  const lena = {
    id: 'host', role: 'guide', name: 'Lena', title: 'Pontoon host', gender: 'W',
    at: G2 => { const p = pontoon(); if (p) return { vessel: p, local: HOST_DECK }; const s = G2.spawn(); return standNear(G2, s.x, s.north); },
    nodes: {
      hello: { say: G2 => [{ t: `${G2.greet()}! Welcome to the pontoon. On the map it's Reefworld, moored on Hardy Reef.`, src: ['model-pois'] }, tidePage(G2)],
        choices: [
          { text: 'Can I get in the water?', go: 'gear' },
          { text: 'What is Heart Reef?', go: 'heart' },
          { text: 'How is the water out here?', go: 'water' },
          { text: 'How is this reef doing?', go: 'reef' }] },
      gear: { say: G2 => [{ t: 'Here you go: a mask, a snorkel and fins.', src: null }, ...(slsqApplies(G2) ? slsqPages(G2) : [])],
        do: G2 => { if (!G2.player.S.gear.mask) G2.player.equip('snorkel'); },
        choices: [
          { text: 'Can I help with a survey?', go: 'survey', when: G2 => G2.species().length > 0 && !G2.state('survey') },
          { text: 'I want to dive the wall.', go: 'sam', when: () => !G.state('wall') },
          { text: 'Thanks, Lena.', go: 'end' }] },
      sam: { say: G2 => `Sam takes the dives. She's ${G2.where('npc:instructor')} of here, by the ladders.`, src: ['model-pois'], next: 'end' },
      heart: { say: G2 => {
        const h = aircraft().find(v => v.kind === 'helicopter'), s = aircraft().find(v => v.kind === 'seaplane');
        const pages = [{ t: `Heart Reef is ${G2.where('heart-reef', base())} of here, inside Hardy Reef.`, src: ['model-pois', 'tw-heart-reef'] },
          { t: 'A local pilot first spotted it in 1975. It is protected: no swimming or snorkelling at the formation, so the way to see it is from the air.', src: ['tw-heart-reef'] }];
        if (h || s) pages.push({ t: `${h ? `The helicopter is on its pad, ${G2.where({ x: h.x, north: -h.z })}` : ''}${h && s ? ', and the' : s ? 'The' : ''}${s ? ` amphibian is tied up ${G2.where({ x: s.x, north: -s.z })}` : ''}.`, src: ['model-pois'] });
        return pages;
      }, choices: [{ text: 'I\'d like to fly over it.', do: G2 => G2.start('heart'), go: 'end', when: G2 => !G2.state('heart') && aircraft().length > 0 }, { text: 'Back', go: 'hello' }] },
      water: { say: () => waterPages(), next: 'hello' },
      reef: { say: [
        { t: 'Hardy Reef is an outer reef, about 75 km offshore.', src: ['vdw-2015'] },
        { t: 'In 2015 a study here followed corals beside two tourist platforms and at a nearby site without one, through a summer. In the warmest month, signs of white syndromes showed on 31% of the study corals near the platforms.', src: ['vdw-2015'] },
        ...reefPages,
        { t: 'The outer reefs like this one spawn in November and December.', src: ['wiki-gbr', 'vdw-2015'] }], next: 'hello' },
      survey: { say: G2 => [{ t: `Yes please. Mask on, and log ${surveySize(G2)} species you can get within a few metres of: E when you're close.`, src: ['model-life'] }], do: G2 => G2.start('survey'), next: 'end' },
      surveyDone: surveyDoneNode()
    }
  };

  // ------------------------------------------------------------ Sam, dive instructor, by the ladders
  const dive = diveQuest({ id: 'wall', title: 'Down the wall', summary: 'Dived the channel wall to 12 m with Sam.', hint: 'Ask Sam, by the pontoon\'s ladders.',
    giver: 'instructor', giverName: 'Sam', gender: 'W', depth: 12, point: () => divePoint(),
    extra: (G2, d) => {
      const wh = whitsundays(); if (!wh) return [];
      const m = G2.env.u.lightPath.value, here = Math.exp(-G2.env.u.K.value.y * d * m), there = Math.exp(-wh.optics.K[1] * d * m);
      return [{ t: `Green light left at this depth: ${pct(here)}% here, ${pct(there)}% at the same depth in the Whitsundays.`, src: ['model-optics'] }];
    } });
  const sam = {
    id: 'instructor', role: 'diveInstructor', name: 'Sam', title: 'Dive instructor', gender: 'W',
    at: G2 => { const p = pontoon(); if (p) return { vessel: p, local: DIVE_DECK }; const s = G2.spawn(); return standNear(G2, s.x + 6, s.north); },
    nodes: {
      hello: { say: () => { const W = wall(); return [{ t: `I take the dives down the wall. Beside us it drops from ${W.top.toFixed(0)} m to ${W.bottom.toFixed(0)} m.`, src: ['model-terrain'] }]; },
        choices: [{ text: 'Take me down the wall.', go: 'dive', when: G2 => !G2.state('wall') }, { text: 'Thanks, Sam.', go: 'end' }] },
      dive: { say: G2 => { const d = divePoint(); return [{ t: 'Here\'s a tank, a BCD and a regulator.', src: null },
        { t: `I'll wait for you at 12 m, ${G2.where(d, base())} of the pontoon, where the bottom is ${Math.round(G2.depth(d.x, d.north))} m down at this tide. G lets air out of the BCD, Q equalises your ears.`, src: ['model-terrain'] }]; },
        do: G2 => { G2.player.equip('scuba'); G2.start('wall'); }, next: 'end' },
      surveyDone: surveyDoneNode()
    }
  };

  // ------------------------------------------------------------ quests
  const quests = [
    { id: 'heart', title: 'Heart Reef from the air', summary: 'Flew over Heart Reef.', hint: 'Ask Lena about Heart Reef.',
      steps: [
        { text: 'Take the helicopter or the amphibian', target: () => { const a = aircraft()[0]; return a ? { x: a.x, north: -a.z, name: a.name } : null; }, on: { board: (G2, d, v) => v.kind === 'helicopter' || v.kind === 'seaplane' } },
        { text: 'Fly over Heart Reef, above 100 m', target: 'heart-reef', check: G2 => { const v = G2.aboard(); return !!v && v.y - G2.tideNow() > 100 && G2.dist({ x: v.x, north: -v.z }, P('heart-reef')) < 400; } },
        { text: 'Fly back to the pontoon, land and step out (F)', target: () => base(), on: { leave: () => true } }],
      onDone: G2 => G2.note('heart-flight', 'Flew over Heart Reef, first spotted by a local pilot in 1975 and protected: seen from the air, not in the water.', ['tw-heart-reef'], 'Lena') },
    dive.quest,
    surveyQuest({ giver: 'host', giverName: 'Lena', max: 5 })
  ];

  let warned = false;
  return {
    sources: SOURCES, quests, signs: [], npcs: [lena, sam],
    start(G2) { loadOptics(G2, ['whitsundays']); dive.resume(G2); },
    // swimming near Heart Reef: it is protected (once a visit)
    tick(G2) {
      if (warned || !G2.player || !G2.player.S.water) return;
      const h = P('heart-reef'); if (!h || G2.dist(G2.here(), h) > 150) return;
      warned = true;
      G2.say('Heart Reef is protected: no swimming or snorkelling at the formation. See it from the air.', { kind: 'warn', secs: 7 });
      G2.note('heart-protected', 'Heart Reef is protected: swimming and snorkelling are not permitted at the formation.', ['tw-heart-reef'], 'Lena');
    }
  };
}
