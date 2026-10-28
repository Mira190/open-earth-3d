// What any reef site gets, and the pieces the site files reuse: a ranger at the spawn who knows the model
// (its size, how much of it is sea, how deep, how clear), the fish ID survey, the reef health facts, stinger
// advice where Surf Life Saving Queensland's season applies, and the slate that works out where the red
// light went at your depth. Every line is computed from the model or cites game/sources.js.
const BUSTARD_HEADS_LAT = -24.02;      // SLSQ's stinger range runs from Bustard Heads (north of Bundaberg) northward

// ---- the model in numbers, computed once per site from the terrain grid
export function siteStats(G) {
  if (G._stats) return G._stats;
  const d = G.ctx.d, t = d.scene.terrain, hs = d.heights, tide = G.tideNow();
  let wet = 0, n = 0, deep = 0, high = -1e9;
  for (let j = 0; j < t.h; j += 3) for (let i = 0; i < t.w; i += 3) { const h = hs[j * t.w + i]; n++; if (h < tide) wet++; if (h < deep) deep = h; if (h > high) high = h; }
  const ext = G.S.extent_m || [t.x0, t.x0 + t.w * t.cell_m, t.y1 - t.h * t.cell_m, t.y1];
  return (G._stats = { wKm: (ext[1] - ext[0]) / 1000, hKm: (ext[3] - ext[2]) / 1000, wetPct: Math.round(100 * wet / n), deepest: Math.round(tide - deep), highest: Math.round(high), cell: t.cell_m });
}

// ---- light at depth: the dive slate. Light comes down depth x lightPath (the sun's slant under the surface) and the
// eye is close; the same exponentials env.js medium() renders with
export function slatePages(G, depth) {
  const L = G.light(depth, 0), pc = v => v >= 0.1 ? Math.round(v * 100) : (v * 100).toFixed(1), f2 = v => v.toFixed(v < 0.1 ? 3 : 2);
  const torch = Math.exp(-L.K.r * 2);                    // a torch 1 m from the coral: 1 m out and 1 m back
  return [
    { t: `(writes on a slate) ${depth.toFixed(1)} m. Light coming down to here has kept ${pc(L.r)}% of its red, ${pc(L.g)}% of its green and ${pc(L.b)}% of its blue.`, src: ['model-optics', 'model-sun'] },
    { t: `Water soaks up red first. Here red fades by ${f2(L.K.r)} per metre, green by ${f2(L.K.g)}, blue by ${f2(L.K.b)}, and the sun's slant makes the path ${L.m.toFixed(2)} times the depth. So red halves every ${L.halfR.toFixed(1)} m and is down to a tenth by ${L.tenthR.toFixed(1)} m; blue takes ${L.halfB.toFixed(0)} m to halve.`, src: ['model-optics', 'wiki-colour-of-water'] },
    { t: `A red fin can only look red if red light reaches it. Hold a torch a metre from it: that is 2 m of water out and back, and ${Math.round(torch * 100)}% of the torch's red comes back to you.`, src: ['model-optics'] }
  ];
}

// ---- the Great Barrier Reef's bleaching record, as facts
export const reefPages = [
  { t: 'Mass bleaching from marine heatwaves hit the Great Barrier Reef in the summers of 1998, 2002, 2006, 2016, 2017 and 2020, and another mass bleaching was confirmed in March 2022.', src: ['wiki-gbr'] },
  { t: 'In 2024 the Reef Snapshot from the Reef Authority, AIMS and CSIRO recorded bleaching on 73 per cent of the surveyed reefs in the Marine Park: the fifth widespread bleaching since 2016.', src: ['csiro-2024'] },
  { t: 'The reef is over 2,900 reefs and 900 islands along 2,300 km, with about 400 species of coral and more than 1,500 species of fish.', src: ['wiki-gbr'] }
];

// ---- stingers by Surf Life Saving Queensland's dates (November to May), where their range applies
export const slsqApplies = G => G.S.origin && G.S.origin[1] > BUSTARD_HEADS_LAT;
export function slsqPages(G) {
  const m = G.monthIndex(), inSeason = m >= 10 || m <= 4;
  return [
    { t: `Surf Life Saving Queensland gives the marine stinger season as November to May, from Bustard Heads north. It's ${G.month()}${inSeason ? ', so it is stinger season now' : ''}.`, src: ['slsq-stingers', 'model-sun'] },
    { t: 'Box jellyfish and irukandji are the dangerous ones. Their advice is a full-body stinger suit whenever you are in the ocean in the season.', src: ['slsq-stingers'] }
  ];
}

// ---- the fish ID survey: log species you get within a few metres of, with a mask on
export function surveyQuest(o = {}) {
  const giver = o.giver || 'ranger', max = o.max || 5;
  const kit = G => { const k = G.player && G.player.kit; return k ? { x: k.position.x, north: -k.position.z, name: 'Dive kit' } : null; };
  return {
    id: 'survey', title: 'Fish ID survey', summary: G => `Logged ${G.logged()} species for the survey.`, hint: `Ask the ${o.giverName || 'ranger'} about the fish ID survey.`,
    available: G => G.species().length > 0, unavailable: 'Marine life is not in this build of the model yet, so there is nothing to survey.',
    steps: [
      { text: 'Put a mask on: E at the dive kit', target: kit, enter: (G, d) => { d.n = Math.min(max, G.species().length); }, check: G => G.player.S.gear.mask },
      { text: (G, d) => `Snorkel and log ${d.n} species: get within a few metres, E (${G.logged()}/${d.n})`, check: (G, d) => G.logged() >= d.n },
      { text: `Tell ${o.giverName || 'the ranger'} what you found`, target: `npc:${giver}`, talkTo: giver, node: 'surveyDone' }
    ]
  };
}
export function surveyDoneNode(next = 'hello') {
  return { say: G => {
    const L = G.st().species, ids = Object.keys(L), deep = ids.reduce((m, k) => Math.max(m, L[k].depth || 0), 0), names = ids.map(k => (G.speciesById(k) || { common: k }).common);
    return [{ t: `${ids.length} species: ${names.join(', ')}. The deepest you logged was at ${deep.toFixed(1)} m. Good work.`, src: ['model-life'] },
      { t: 'More than 1,500 species of fish live on the Great Barrier Reef, so the survey never really ends.', src: ['wiki-gbr'] }];
  }, next };
}

// ---- the ranger every site gets
export function ranger(G, o = {}) {
  const st = siteStats(G);
  const hasLife = G2 => G2.species().length > 0;
  return {
    id: 'ranger', role: 'ranger', name: o.name || 'Alex', title: 'Marine park ranger', gender: o.gender || 'W',
    at: o.at || (G2 => {
      const s = G2.spawn(), h = s.heading * Math.PI / 180, fx = Math.sin(h), fn = Math.cos(h), rx = Math.cos(h), rn = -Math.sin(h);
      const want = { x: s.x + fx * 6 + rx * 3, north: s.north + fn * 6 + rn * 3 };
      const p = G2.landSpot(want.x, want.north, { msl: true, minH: 0.6, maxH: 6, maxSlope: 0.3, maxR: 60, toward: want });
      return { x: p.x, north: p.north, heading: G2.bearing(p, s) };
    }),
    nodes: Object.assign({
      hello: { say: G2 => [
        { t: `${G2.greet()}! I'm ${o.name || 'Alex'}, the ranger here. Welcome to ${G2.S.name}.`, src: null },
        { t: `This model is ${st.wKm.toFixed(0)} by ${st.hKm.toFixed(0)} km. At this tide ${st.wetPct}% of it is sea, down to ${st.deepest} m, and the highest ground is ${st.highest} m.`, src: ['model-terrain'] }],
        choices: [
          { text: 'Is it safe to swim?', go: 'swim', when: slsqApplies },
          { text: 'How is the reef doing?', go: 'reef', when: G2 => G2.S.kind === 'marine' },
          { text: 'Can I help with a survey?', go: 'survey', when: G2 => hasLife(G2) && !G2.state('survey') },
          { text: 'Where else can I go?', go: 'travel' }] },
      swim: { say: G2 => slsqPages(G2), next: 'hello' },
      reef: { say: reefPages, next: 'hello' },
      survey: { say: G2 => [{ t: `Yes please. Put a mask on, snorkel over the reef and log ${Math.min(5, G2.species().length)} species you can get within a few metres of. E when you're close.`, src: ['model-life'] }],
        do: G2 => G2.start('survey'), next: 'end' },
      surveyDone: surveyDoneNode(),
      travel: { say: 'The other Queensland reef sites are on the map: T, or the Map button.', do: null, choices: [{ text: 'Open the map', do: G2 => G2.openPanel('map'), go: 'end' }, { text: 'Thanks', go: 'end' }] }
    }, o.nodes || {})
  };
}

export default function site(G) {
  return { npcs: [ranger(G)], quests: [surveyQuest()] };
}
