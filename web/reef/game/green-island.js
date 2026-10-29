// Green Island, a coral cay off Cairns (scene.json pois: green-beach, green-jetty, green-snorkel, green-lookout,
// green-helipad, michaelmas-cay ...).
//   Ava, ranger, on the western beach by the spawn: how the cay formed, its size in the model, the national park,
//     stingers by Surf Life Saving Queensland's dates, the reef's health
//   Noah, snorkel guide, on the shore by the jetty: gear, the reef flat there (depth at this tide, the model's habitat
//     mix), the fish ID survey
//   A sign at the south-east viewpoint: what is in sight over the model's terrain
//   Quests: snorkel survey by the jetty, walk to the viewpoint, a helicopter flight over the cay and out to Michaelmas Cay.
// The Gungganyji name and stories for the island are left out: only a secondary source was reachable (docs/GAME_REEF.md).
import { ranger, surveyQuest, surveyDoneNode, reefPages, slsqPages, slsqApplies, tidePage, landArea, inSight, standNear, surveySize } from './generic.js';

const SOURCES = {
  'wiki-green-island': { title: 'Green Island (Queensland)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Green_Island_(Queensland)', checked: '2026-10-28',
    says: 'a coral cay 27 km offshore from Cairns, within the Great Barrier Reef Marine Park World Heritage Area, surrounded by coral reef and protected in the Green Island National Park; formed approximately 6,000 years ago by waves depositing sand, coral and other debris onto its coral foundations; dry coastal plants and a vine thicket rain forest; no natural freshwater springs, the vegetation relies on rainwater and a small freshwater lens; named by Lieutenant James Cook on 10 June 1770, for its vegetation or possibly after Charles Green, astronomer aboard the Endeavour; an underwater observatory was installed in 1954' }
};
const HABITAT = { 1: 'sand', 2: 'reef and rock', 3: 'seagrass and algae', 4: 'rubble' };   // pipeline/build_marine.py HABITAT (under water)

export default function greenIsland(G) {
  const P = id => G.poi(id);
  const npcAt = id => { const r = G.npc(id); return r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z } : G.here(); };
  // the floor around a spot by the model's habitat classes (inferred from the satellite colours, not surveyed)
  function habitatMix(c, R = 150) {
    const n = {}; let all = 0;
    for (let dx = -R; dx <= R; dx += 10) for (let dn = -R; dn <= R; dn += 10) {
      if (dx * dx + dn * dn > R * R || G.depth(c.x + dx, c.north + dn) <= 0) continue;
      const h = G.ctx.habitat(c.x + dx, c.north + dn); if (!HABITAT[h]) continue; n[h] = (n[h] || 0) + 1; all++;
    }
    return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, k]) => `${Math.round(100 * k / all)}% ${HABITAT[h]}`);
  }

  // ------------------------------------------------------------ Ava, the ranger
  const ava = ranger(G, { name: 'Ava', gender: 'W', nodes: {
    hello: { say: G2 => [{ t: `${G2.greet()}! I'm Ava, one of the rangers. This is Green Island, a coral cay 27 km off Cairns.`, src: ['wiki-green-island'] }, tidePage(G2)],
      choices: [
        { text: 'How did the island get here?', go: 'cay' },
        { text: 'Is it safe to swim?', go: 'swim', when: slsqApplies },
        { text: 'How is the reef doing?', go: 'reef' },
        { text: 'What can I do here?', go: 'todo' }] },
    cay: { say: G2 => {
      const c = P('green-island'), ha = c ? landArea(G2, c.x, c.north) : null;
      return [{ t: 'It formed about 6,000 years ago, when waves piled sand, coral and other debris onto the reef.', src: ['wiki-green-island'] },
        ha ? { t: `In this model the mapped island is ${ha.toFixed(0)} hectares above mean sea level.`, src: ['model-terrain', 'model-pois'] } : null,
        { t: 'There is no freshwater spring. The plants live on rain and a small lens of fresh water under the island; the middle is vine-thicket rainforest.', src: ['wiki-green-island'] },
        { t: 'Cook named it on 10 June 1770: maybe for its green, maybe after Charles Green, the Endeavour\'s astronomer.', src: ['wiki-green-island'] },
        { t: 'The island and its reef are protected: Green Island National Park, inside the Great Barrier Reef Marine Park.', src: ['wiki-green-island'] }];
    }, next: 'hello' },
    swim: { say: G2 => slsqPages(G2), next: 'hello' },
    reef: { say: reefPages, next: 'hello' },
    todo: { say: G2 => {
      const pages = [{ t: `Noah takes the snorkellers out from the shore by the jetty, ${G2.where('npc:guide')} of here.`, src: ['model-pois'] },
        { t: 'Tourism has been the main thing here since the early twentieth century; an underwater observatory went in back in 1954.', src: ['wiki-green-island'] },
        { t: `There's a viewpoint on the south-east shore, ${G2.where('green-lookout')}.`, src: ['model-pois'] }];
      const h = G2.vessels().find(v => v.kind === 'helicopter' && v.mode !== 'orbit');
      if (h) pages.push({ t: `And the scenic helicopter is on its pad, ${G2.where({ x: h.x, north: -h.z })}.`, src: ['model-pois'] });
      return pages;
    }, choices: [
      { text: 'I\'ll walk round to the viewpoint.', do: G2 => G2.start('viewpoint'), go: 'end', when: G2 => !G2.state('viewpoint') },
      { text: 'I\'d like to fly over it.', do: G2 => G2.start('flight'), go: 'end', when: G2 => !G2.state('flight') && G2.vessels().some(v => v.kind === 'helicopter' && v.mode !== 'orbit') },
      { text: 'Back', go: 'hello' }] }
  } });

  // ------------------------------------------------------------ Noah, snorkel guide by the jetty
  const noah = {
    id: 'guide', role: 'guide', name: 'Noah', title: 'Snorkel guide', gender: 'M',
    at: G2 => { const s = P('green-snorkel') || P('green-jetty'), p = standNear(G2, s.x, s.north, { maxR: 120, toward: s }); return Object.assign(p, { heading: p.vessel ? 0 : G2.bearing(p, s) }); },
    nodes: {
      hello: { say: G2 => {
        const s = P('green-snorkel'), mix = s ? habitatMix(s) : [];
        return [{ t: 'G\'day, I\'m Noah. I take people snorkelling off the beach here.', src: null },
          s ? { t: `The reef flat beside the jetty is ${G2.depth(s.x, s.north).toFixed(1)} m deep at this tide.`, src: G2.tide() ? ['model-terrain', 'model-tide'] : ['model-terrain'] } : null,
          mix.length ? { t: `In the model's habitat map, read from the satellite colours, the floor within 150 m is ${mix.join(', ')}.`, src: ['model-terrain'] } : null];
      }, choices: [
        { text: 'Can I borrow a mask?', do: G2 => { if (!G2.player.S.gear.mask) G2.player.equip('snorkel'); }, go: 'gear' },
        { text: 'Can I help with a survey?', go: 'survey', when: G2 => G2.species().length > 0 && !G2.state('survey') },
        { text: 'Thanks, Noah.', go: 'end' }] },
      gear: { say: G2 => [{ t: 'Mask, snorkel and fins: there you go.', src: null }, ...(slsqApplies(G2) ? slsqPages(G2).slice(1) : [])], next: 'hello' },
      survey: { say: G2 => [{ t: `Log ${surveySize(G2)} species for me: get within a few metres with your mask on, and E.`, src: ['model-life'] }], do: G2 => G2.start('survey'), next: 'end' },
      surveyDone: surveyDoneNode()
    }
  };

  // ------------------------------------------------------------ the viewpoint sign
  const signs = P('green-lookout') ? [{ id: 'green-lookout', title: 'Viewpoint, south-east shore',
    at: G2 => { const p = P('green-lookout'), s = G2.landSpot(p.x, p.north, { msl: true, minH: 1.2, maxH: 6, maxSlope: 0.4, maxR: 40 }); return { x: s.x, north: s.north, heading: 135 }; },
    nodes: { read: { say: G2 => {
      const sg = G2.sign('green-lookout'), at = sg ? { x: sg.x, north: sg.north } : P('green-lookout');
      const seen = inSight(G2, at, 'green-lookout', { kinds: new Set(['island', 'marina']), range: 20000, exclude: ['green-island'] });
      return [{ t: 'Viewpoint, south-east shore of Green Island, as mapped.', src: ['model-pois'] },
        seen.length ? { t: `In sight from here over the model's terrain: ${seen.join('; ')}.`, src: ['model-terrain', 'model-pois'] } : { t: `From eye height here the sea horizon is ${G2.km(G2.horizonM(at))} away, and nothing mapped stands above it.`, src: ['model-terrain', 'model-pois'] }];
    } } } }] : [];

  // ------------------------------------------------------------ quests
  const quests = [
    surveyQuest({ giver: 'guide', giverName: 'Noah', max: 5 }),
    { id: 'viewpoint', title: 'Round the cay', summary: 'Walked to the south-east viewpoint and read its sign.', hint: 'Ask Ava what there is to do.',
      steps: [{ text: 'Walk to the viewpoint on the south-east shore and read the sign', target: 'sign:green-lookout', on: { sign: (G2, d, id) => id === 'green-lookout' } }] },
    { id: 'flight', title: 'The cay from the air', summary: 'Flew over Green Island and out to Michaelmas Cay.', hint: 'Ask Ava about seeing it from the air.',
      steps: [
        { text: 'Take the helicopter', target: () => { const h = G.vessels().find(v => v.kind === 'helicopter' && v.mode !== 'orbit'); return h ? { x: h.x, north: -h.z, name: h.name } : null; }, on: { board: (G2, d, v) => v.kind === 'helicopter' || v.kind === 'seaplane' } },
        { text: 'Fly over Green Island, above 100 m', target: 'green-island', check: G2 => { const v = G2.aboard(); return !!v && v.y - G2.tideNow() > 100 && G2.dist({ x: v.x, north: -v.z }, P('green-island')) < 500; } },
        { text: 'Fly out to Michaelmas Cay', target: 'michaelmas-cay', check: G2 => { const v = G2.aboard(); return !!v && v.y - G2.tideNow() > 60 && G2.dist({ x: v.x, north: -v.z }, P('michaelmas-cay')) < 700; } },
        { text: 'Fly back, land and step out (F)', target: 'green-helipad', on: { leave: () => true } }] }
  ];

  return { sources: SOURCES, quests, signs, npcs: [ava, noah] };
}
