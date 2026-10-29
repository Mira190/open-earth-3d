// Lady Elliot Island, the southernmost coral cay of the Great Barrier Reef (scene.json pois: lei-beach, lei-lighthouse,
// lei-airstrip, lady-elliot-island, lei-reef).
//   Tess, island guide, on the western beach by the spawn: the cay (how it formed, its size in the model, the Green
//     Zone, the airstrip), manta rays, turtles, whales and birds (season-aware), snorkel gear and the water out here
//   A sign at the old lighthouse: its history, the guano miners and the replanting
//   Quests: read the lighthouse sign, the fish ID survey, and a manta ray for the survey when life.js has one.
// The water's attenuation here is a placeholder while the offshore sites' Kd fits are revised (docs/cities/lady-elliot-island.md),
// so no visibility numbers are given: the comparison uses the satellite's deep-water colour, read from env.u.Rinf at runtime.
import { ranger, surveyQuest, surveyDoneNode, reefPages, tidePage, landArea, loadOptics, opticsHere } from './generic.js';

const SOURCES = {
  'wiki-lei': { title: 'Lady Elliot Island', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lady_Elliot_Island', checked: '2026-10-28',
    says: 'southernmost coral cay of the GBR, 46 nautical miles (85 km) north-east of Bundaberg, about 45 hectares; in a Green Zone with a total ban on fishing or taking anything; far offshore, excellent water clarity; a vegetated shingle cay, uncommon; manta rays abundant, attracted to the plankton; green and loggerhead turtles nest November to March, hatchlings January to April; whales common June to October; over 100,000 birds nest in the summer breeding season; first above sea level around 1500 BC as a coral rubble spit, a mature cay over the next 3,000 years; named in 1816 by Captain Thomas Stewart aboard the vessel Lady Elliot; guano mined 1863-1873, virtually all trees and 3 feet of topsoil removed, revegetation from 1966 by lighthouse staff; first lighthouse 1866, the third in Queensland and the first offshore on the GBR, destroyed by a cyclone six years later; the 1873 lighthouse, timber-framed with cast iron cladding made in England, 15 m, used until 1995 when vegetation blocked its beam; Commonwealth Heritage List 2004; grass airstrip built in 1969 by Don Adams, still used' },
  'unisc-manta': { title: 'Study to uncover secrets of hidden manta ray habitat (2023)', publisher: 'University of the Sunshine Coast', url: 'https://www.unisc.edu.au/about/unisc-news/news-archive/2023/june/study-to-uncover-secrets-of-hidden-manta-ray-habitat', checked: '2026-10-28',
    says: 'Project Manta started at two main study sites, Lady Elliot Island and North Stradbroke Island; researching manta rays in Australian waters since 2006; a national database of over 3000 individuals' }
};
const isManta = s => /manta/i.test(`${s.id} ${s.common}`);

export default function ladyElliot(G) {
  const P = id => G.poi(id);
  const month = () => G.monthIndex();                      // 0 = January
  // the deep water's colour from the satellite, here against the other reef sites built so far (their scene.json optics)
  function waterPage(G2) {
    const all = Object.assign({}, G2._optics || {}); all[G2.ctx.site] = { name: G2.S.name, optics: opticsHere(G2) };
    const sites = Object.values(all).filter(s => s && s.optics && s.optics.Rinf);
    if (sites.length < 2) return null;
    sites.sort((a, b) => a.optics.Rinf[1] - b.optics.Rinf[1]);
    const rank = sites.findIndex(s => s.name === G2.S.name), wh = (G2._optics || {}).whitsundays;
    const f = v => v.toFixed(4);
    return { t: `From the satellite, the deep water here reflects ${rank === 0 ? 'the least' : `the ${rank + 1}${['st', 'nd', 'rd'][rank] || 'th'} least`} green light of the ${sites.length} reef sites in this model: ${f(opticsHere(G2).Rinf[1])}${wh ? `, against ${f(wh.optics.Rinf[1])} over the Whitsundays` : ''}.`, src: ['model-optics'] };
  }

  // ------------------------------------------------------------ Tess, the island guide
  const tess = ranger(G, { name: 'Tess', gender: 'W', role: 'guide', title: 'Island guide', nodes: {
    hello: { say: G2 => [{ t: `${G2.greet()}! I'm Tess, one of the island guides. Welcome to Lady Elliot Island, the southernmost coral cay of the Great Barrier Reef.`, src: ['wiki-lei'] }, tidePage(G2)],
      choices: [
        { text: 'Tell me about the island.', go: 'island' },
        { text: 'What lives out here?', go: 'wildlife' },
        { text: 'Can I go snorkelling?', go: 'snorkel' },
        { text: 'What is that old lighthouse?', go: 'lighthouse' }] },
    island: { say: G2 => {
      const c = P('lady-elliot-island'), ha = c ? landArea(G2, c.x, c.north) : null;
      return [{ t: 'It first rose above the sea around 1500 BC, as a spit of coral rubble, and took about 3,000 years to become a mature cay.', src: ['wiki-lei'] },
        ha ? { t: `Wikipedia gives about 45 hectares; the mapped outline in this model gives ${ha.toFixed(0)} above mean sea level.`, src: ['wiki-lei', 'model-terrain'] } : null,
        { t: 'It is a shingle cay with plants on it, which is uncommon: most are too narrow to hold fresh water, or too mobile for plants to take hold.', src: ['wiki-lei'] },
        { t: 'The waters around it are a Green Zone of the Marine Park: no fishing, and nothing taken.', src: ['wiki-lei'] },
        { t: `Captain Thomas Stewart named it in 1816, after his ship, the Lady Elliot. It's 85 km north-east of Bundaberg; the grass airstrip, ${G2.where('lei-airstrip')}, was built in 1969 by Don Adams and is still in use.`, src: ['wiki-lei', 'model-pois'] }];
    }, next: 'hello' },
    wildlife: { say: G2 => {
      const m = month(), nest = m >= 10 || m <= 2, hatch = m >= 0 && m <= 3, whales = m >= 5 && m <= 9;
      return [{ t: 'Manta rays are common here, drawn by the plankton around the island.', src: ['wiki-lei'] },
        { t: 'Project Manta began with two main study sites, this island and North Stradbroke Island. Its national database now holds over 3,000 individual mantas.', src: ['unisc-manta'] },
        { t: `Green and loggerhead turtles nest on the beaches from November to March, and the hatchlings make for the sea from January to April.${nest || hatch ? ` It's ${G2.month()}, so that's ${nest && hatch ? 'nesting and hatching' : nest ? 'nesting' : 'hatching'} season now.` : ''}`, src: ['wiki-lei', 'model-sun'] },
        { t: `Whales are common around the island from June to October${whales ? `, and it's ${G2.month()}` : ''}. Over 100,000 birds nest here in the summer breeding season.`, src: ['wiki-lei'] }];
    }, next: 'hello' },
    snorkel: { say: G2 => [{ t: 'Mask, snorkel and fins: there you go.', src: null },
      { t: 'Being far offshore, at the southern end of the reef, gives it excellent water clarity.', src: ['wiki-lei'] }, waterPage(G2)],
      do: G2 => { if (!G2.player.S.gear.mask) G2.player.equip('snorkel'); },
      choices: [
        { text: 'Can I help with a survey?', go: 'survey', when: G2 => G2.species().length > 0 && !G2.state('survey') },
        { text: 'Where would I see a manta?', go: 'manta', when: G2 => G2.species().some(isManta) && !G2.state('manta') },
        { text: 'How is the reef doing?', go: 'reef' },
        { text: 'Thanks, Tess.', go: 'end' }] },
    manta: { say: [{ t: 'They come in for the plankton. Snorkel off the reef edge, and when one comes close, log it for the survey.', src: ['wiki-lei'] }], do: G2 => G2.start('manta'), next: 'end' },
    reef: { say: reefPages, next: 'hello' },
    lighthouse: { say: G2 => [{ t: `The old lighthouse is ${G2.where('lei-lighthouse')}. There's a sign on its history.`, src: ['model-pois'] }], do: G2 => G2.start('history'), next: 'end' },
    surveyDone: surveyDoneNode()
  } });

  // ------------------------------------------------------------ the lighthouse sign
  const signs = P('lei-lighthouse') ? [{ id: 'lei-lighthouse', title: 'Old Lady Elliot Lighthouse',
    at: G2 => { const p = P('lei-lighthouse'), s = G2.landSpot(p.x + 6, p.north - 4, { msl: true, minH: 1.5, maxH: 6, maxSlope: 0.4, maxR: 40 }); return { x: s.x, north: s.north, heading: G2.bearing(s, p) + 180 }; },
    nodes: { read: { say: [
      { t: 'Old Lady Elliot Lighthouse. The first lighthouse here went up in 1866: the third in Queensland and the first built offshore on the Great Barrier Reef. A cyclone destroyed it six years later.', src: ['wiki-lei', 'model-pois'] },
      { t: 'This one dates from 1873: a 15 m timber frame clad in cast iron, made in England and shipped out in pieces. It was in use until 1995, when the trees had grown tall enough to block its beam, and a new tower took over.', src: ['wiki-lei'] },
      { t: 'From 1863 to 1873 guano miners stripped the island of nearly all its trees and three feet of topsoil. Lighthouse staff began replanting in 1966.', src: ['wiki-lei'] },
      { t: 'The lighthouse has been on the Commonwealth Heritage List since 2004.', src: ['wiki-lei'] }] } } }] : [];

  // ------------------------------------------------------------ quests
  const quests = [
    { id: 'history', title: 'The old lighthouse', summary: 'Read the history of the old lighthouse.', hint: 'Ask Tess about the old lighthouse.',
      steps: [{ text: 'Read the sign at the old lighthouse', target: 'sign:lei-lighthouse', on: { sign: (G2, d, id) => id === 'lei-lighthouse' } }] },
    surveyQuest({ giver: 'ranger', giverName: 'Tess', max: 5 }),
    { id: 'manta', title: 'Manta ray', summary: 'Logged a manta ray for the survey.', hint: 'Ask Tess where to see a manta.', hidden: true,
      available: G2 => G2.species().some(isManta),
      steps: [{ text: 'Snorkel off the reef edge and log a manta ray (E when close)', target: 'lei-reef', check: G2 => Object.keys(G2.st().species).some(id => isManta(G2.speciesById(id) || { id, common: '' })) }] }
  ];

  return { sources: SOURCES, quests, signs, npcs: [tess],
    start(G2) { G2.travel.load().then(l => loadOptics(G2, (l || []).filter(s => s.ready && !s.current).map(s => s.id))); } };
}
