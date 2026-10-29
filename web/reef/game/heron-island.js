// Heron Island, a coral cay near the Tropic of Capricorn (scene.json pois: heron-beach, heron-jetty, heron-helipad,
// protector-wreck, research-station, heron-reef, wistari-reef).
//   Ben, ranger, on the north shore by the spawn: the island and its reef, its size in the model, the noon sun today,
//     how it was found and named, the national park, turtles, seabirds and whales (season-aware), stingers, reef health
//   Kai, a visiting reef scientist, by the research station: the station's history, the water against the Whitsundays,
//     the fish ID survey
//   A sign by the channel for the wreck of the Protector, and a snorkel out to it at high tide
//   Quests: the wreck, a helicopter flight over Heron and Wistari reefs, the survey.
import { ranger, surveyQuest, surveyDoneNode, reefPages, slsqPages, slsqApplies, tidePage, landArea, loadOptics, blueness, opticsHere, standNear, surveySize } from './generic.js';

const SOURCES = {
  'wiki-heron': { title: 'Heron Island (Queensland)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Heron_Island_(Queensland)', checked: '2026-10-28',
    says: 'a coral cay near the Tropic of Capricorn, 87 km north-east of Gladstone, on the leeward (western) side of Heron Reef, which supports around 900 of the 1,500 fish species and 72% of the coral species of the GBR; about 800 m by 300 m, about 16 hectares, highest point 3.6 m; found on 12 January 1843 by a Royal Navy expedition (HMS Fly and the cutter Bramble), named by Lieutenant Charles Bampfield Yule; the whole island declared a National Park on 11 September 1943, the eastern half now part of the Capricornia Cays National Park with a permanent ranger station; the research station established in the 1950s by the Great Barrier Reef Committee, the University of Queensland a partner from 1970, a large fire on 30 March 2007, labs reopened in February 2009; the wreck of the Protector at the channel entrance, a breakwater; a major nesting site for green and loggerhead turtles, about 98% of nesting turtles green; seabirds breed October to April, over 120,000 white-capped noddies; around early October humpback whales pass on their migration to the subantarctic' },
  'wiki-hirs': { title: 'Heron Island Research Station', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Heron_Island_Research_Station', checked: '2026-10-28',
    says: 'the oldest and largest marine research station on the Great Barrier Reef; in the 1960s much research from the station on the plague of crown-of-thorns starfish; the 2007 fire destroyed research laboratories, student accommodation and the teaching labs' },
  'wiki-protector': { title: 'HMAS Protector (1884)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/HMAS_Protector_(1884)', checked: '2026-10-28',
    says: 'a gunboat bought by the South Australian government in 1884; served in the Boxer Rebellion, World War I and World War II; requisitioned for war service in July 1943 and, on the way to New Guinea, damaged in a collision with a tug off Gladstone; the hull taken to Heron Island and sunk as a breakwater; the reef around the wreck gives good diving and snorkelling at high tide' }
};

export default function heronIsland(G) {
  const P = id => G.poi(id);
  const month = () => G.monthIndex();
  const at = id => { const r = G.npc(id); return r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z } : G.here(); };
  const nextHigh = () => G.tideTurns(3).find(t => t.high) || null;
  const heli = () => G.vessels().find(v => v.kind === 'helicopter' && v.mode !== 'orbit' && v.mode !== 'player');

  // ------------------------------------------------------------ Ben, the ranger
  const ben = ranger(G, { name: 'Ben', gender: 'M', nodes: {
    hello: { say: G2 => [{ t: `${G2.greet()}! I'm Ben, one of the rangers. This is Heron Island, a coral cay near the Tropic of Capricorn, 87 km north-east of Gladstone.`, src: ['wiki-heron'] }, tidePage(G2)],
      choices: [
        { text: 'Tell me about the island.', go: 'island' },
        { text: 'What nests here?', go: 'wildlife' },
        { text: 'Is it safe to swim?', go: 'swim', when: slsqApplies },
        { text: 'How is the reef doing?', go: 'reef' }] },
    island: { say: G2 => {
      const c = P('heron-island'), ha = c ? landArea(G2, c.x, c.north) : null;
      const l = window.Sun.utcToLocal(G2.nowMs()), noon = window.Sun.dayLimits(l.y, l.m, l.d).noonAltitude;
      return [{ t: 'It sits at the western, leeward end of Heron Reef, a platform reef with around 900 of the Great Barrier Reef\'s 1,500 fish species and 72% of its coral species.', src: ['wiki-heron'] },
        ha ? { t: `Wikipedia gives about 16 hectares, 800 m long and 300 m wide; the mapped outline in this model gives ${ha.toFixed(0)} hectares above mean sea level.`, src: ['wiki-heron', 'model-terrain'] } : null,
        { t: `Today the sun reaches ${noon.toFixed(0)}° above the horizon here at noon.`, src: ['model-sun'] },
        { t: 'A Royal Navy expedition, HMS Fly and the cutter Bramble, found it on 12 January 1843, and Lieutenant Charles Bampfield Yule of the Bramble named it.', src: ['wiki-heron'] },
        { t: 'The whole island was declared a National Park on 11 September 1943; the eastern half is now part of the Capricornia Cays National Park.', src: ['wiki-heron'] }];
    }, choices: [
      { text: 'What is the research station?', go: 'station' },
      { text: 'What is the wreck by the channel?', go: 'wreck' },
      { text: 'Can I see it from the air?', go: 'flight', when: () => !!heli() },
      { text: 'Back', go: 'hello' }] },
    station: { say: G2 => [{ t: `The research station is ${G2.where('research-station')}. Kai, one of the visiting scientists, is about.`, src: ['model-pois'] }], next: 'end' },
    wreck: { say: G2 => [{ t: `That's the Protector, ${G2.where('protector-wreck')}, at the channel entrance. There's a sign about her by the shore.`, src: ['model-pois', 'wiki-heron'] }], do: G2 => G2.start('wreck'), next: 'end' },
    flight: { say: G2 => { const h = heli(); return [{ t: `The helicopter is on its pad, ${G2.where({ x: h.x, north: -h.z })}. From the air you see all of Heron Reef, and Wistari Reef across the channel.`, src: ['model-pois'] }]; },
      do: G2 => G2.start('flight'), next: 'end' },
    wildlife: { say: G2 => {
      const m = month(), birds = m >= 9 || m <= 3;
      return [{ t: 'Green and loggerhead turtles nest on the island; about 98% of the nesting turtles are greens.', src: ['wiki-heron'] },
        { t: `Seabirds breed here from October to April, and over 120,000 white-capped noddies nest then.${birds ? ` It's ${G2.month()}, so the season is on.` : ''}`, src: ['wiki-heron', 'model-sun'] },
        { t: 'Around early October, humpback whales pass the island on their way to the subantarctic for the summer.', src: ['wiki-heron'] }];
    }, next: 'hello' },
    swim: { say: G2 => slsqPages(G2), next: 'hello' },
    reef: { say: reefPages, next: 'hello' }
  } });

  // ------------------------------------------------------------ Kai, a visiting scientist by the research station
  const kai = {
    id: 'scientist', role: 'guide', name: 'Kai', title: 'Visiting reef scientist', gender: 'M',
    at: G2 => { const s = P('research-station') || P('heron-island'), p = standNear(G2, s.x, s.north, { maxR: 120 }); return Object.assign(p, { heading: p.vessel ? 0 : G2.bearing(p, G2.spawn()) }); },
    nodes: {
      hello: { say: [{ t: 'Hello! I\'m Kai, here for a few weeks at the research station.', src: null },
        { t: 'It has been here since the 1950s: the Great Barrier Reef Committee set it up, and the University of Queensland became a partner in 1970.', src: ['wiki-heron'] },
        { t: 'It is the oldest and largest marine research station on the Great Barrier Reef. In the 1960s people here studied the plague of crown-of-thorns starfish.', src: ['wiki-hirs'] },
        { t: 'A fire on 30 March 2007 destroyed the labs and the student rooms; the new research building opened in February 2009.', src: ['wiki-heron', 'wiki-hirs'] }],
        choices: [
          { text: 'Can I help with a survey?', go: 'survey', when: G2 => G2.species().length > 0 && !G2.state('survey') },
          { text: 'How is the water out here?', go: 'water' },
          { text: 'Thanks, Kai.', go: 'end' }] },
      water: { say: G2 => {
        const b = blueness(opticsHere(G2)), wh = (G2._optics || {}).whitsundays, wb = wh ? blueness(wh.optics) : null;
        return [b ? { t: `From the satellite, the deep water around this reef sends back ${b.toFixed(2)} times as much blue light as green${wb ? `; over the Whitsundays it is ${wb.toFixed(2)}` : ''}.`, src: ['model-optics'] } : null,
          { t: `Out on the reef flat the water is ${Math.max(0, G2.depth(P('heron-reef').x, P('heron-reef').north)).toFixed(1)} m deep at this tide, by the model.`, src: G2.tide() ? ['model-terrain', 'model-tide'] : ['model-terrain'] }];
      }, next: 'hello' },
      survey: { say: G2 => [{ t: `Log ${surveySize(G2)} species for me: mask on, get within a few metres, and E.`, src: ['model-life'] }], do: G2 => G2.start('survey'), next: 'end' },
      surveyDone: surveyDoneNode()
    }
  };

  // ------------------------------------------------------------ the wreck's sign, on the shore facing it
  const signs = P('protector-wreck') ? [{ id: 'protector-wreck', title: 'Wreck of HMCS Protector',
    at: G2 => { const w = P('protector-wreck'), s = G2.landSpot(w.x, w.north, { msl: true, minH: 1.2, maxH: 6, maxSlope: 0.4, maxR: 300 }); return { x: s.x, north: s.north, heading: G2.bearing(s, w) }; },
    nodes: { read: { say: G2 => {
      const w = P('protector-wreck'), sg = G2.sign('protector-wreck'), from = sg ? { x: sg.x, north: sg.north } : G2.here(), hw = nextHigh();
      return [{ t: 'Wreck of HMCS Protector, as mapped. She was a gunboat bought by the South Australian government in 1884, and served in the Boxer Rebellion and both world wars.', src: ['model-pois', 'wiki-protector'] },
        { t: 'Taken up for war service in 1943, she was damaged in a collision off Gladstone on her way to New Guinea. Her hull was brought here and sunk as a breakwater at the entrance to the channel.', src: ['wiki-protector', 'wiki-heron'] },
        { t: `The wreck is ${G2.where(w, from)} of this sign, in ${Math.max(0, G2.depth(w.x, w.north)).toFixed(1)} m of water at this tide.`, src: G2.tide() ? ['model-pois', 'model-terrain', 'model-tide'] : ['model-pois', 'model-terrain'] },
        { t: `The reef around it is good snorkelling at high tide.${hw ? ` The next high water is at ${G2.time(hw.t)}.` : ''}`, src: G2.tide() ? ['wiki-protector', 'model-tide'] : ['wiki-protector'] }];
    } } } }] : [];

  // ------------------------------------------------------------ quests
  const quests = [
    { id: 'wreck', title: 'The Protector', summary: 'Read about the Protector and snorkelled out to her at high tide.', hint: 'Ask Ben about the wreck by the channel.',
      steps: [
        { text: 'Read the sign about the wreck, by the channel', target: 'sign:protector-wreck', on: { sign: (G2, d, id) => id === 'protector-wreck' } },
        { text: G2 => { const hw = nextHigh(); return `Snorkel out to the wreck at high tide${G2.tideNow() > 0.3 ? ' (the tide is up now)' : hw ? ` (next high water ${G2.time(hw.t)})` : ''}`; }, target: 'protector-wreck',
          check: G2 => G2.player.S.water && G2.player.S.gear.mask && G2.tideNow() > 0.3 && G2.dist(G2.here(), P('protector-wreck')) < 35 }],
      onDone: G2 => G2.note('protector-snorkel', 'Snorkelled out to the wreck of the Protector at high tide.', ['wiki-protector'], 'Ben') },
    { id: 'flight', title: 'Heron Reef from the air', summary: 'Flew over Heron Reef and Wistari Reef.', hint: 'Ask Ben about seeing it from the air.',
      steps: [
        { text: 'Take the helicopter', target: () => { const h = heli(); return h ? { x: h.x, north: -h.z, name: h.name } : null; }, on: { board: (G2, d, v) => v.kind === 'helicopter' || v.kind === 'seaplane' } },
        { text: 'Fly over Heron Reef, above 100 m', target: 'heron-reef', check: G2 => { const v = G2.aboard(); return !!v && v.y - G2.tideNow() > 100 && G2.dist({ x: v.x, north: -v.z }, P('heron-reef')) < 1200; } },
        { text: 'Cross the channel to Wistari Reef', target: 'wistari-reef', check: G2 => { const v = G2.aboard(); return !!v && v.y - G2.tideNow() > 60 && G2.dist({ x: v.x, north: -v.z }, P('wistari-reef')) < 1200; } },
        { text: 'Fly back, land and step out (F)', target: 'heron-helipad', on: { leave: () => true } }] },
    surveyQuest({ giver: 'scientist', giverName: 'Kai', max: 5 })
  ];

  return { sources: SOURCES, quests, signs, npcs: [ben, kai], start(G2) { loadOptics(G2, ['whitsundays']); } };
}
