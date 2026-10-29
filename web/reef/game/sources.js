// Where every fact a character says comes from. A line in a dialogue carries `src: [ids]`; the
// dialogue shows them under the line and the journal keeps them with the note. Two kinds:
//   cited    a page that was fetched and read when the line was written (`checked` is that date);
//            the line says only what the page says, in plain words.
//   model    computed while you play from the viewer's own data: the survey depths, the optics
//            fitted to the satellite imagery, the sun, the place names. `what` says what is used.
// Site files add their own (game/<site>.js `sources`). Nothing here is general knowledge.
export const SOURCES = {
  // ---- cited (checked 2026-10-28)
  'wiki-gbr': { title: 'Great Barrier Reef', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Great_Barrier_Reef', checked: '2026-10-28',
    says: 'over 2,900 reefs and 900 islands over 2,300 km; about 400 coral species; more than 1,500 fish species; six sea turtle species breed there; mass bleaching from marine heatwaves in the summers of 1998, 2002, 2006, 2016, 2017 and 2020; another mass bleaching confirmed in March 2022; inner reefs spawn in the week after the October full moon, outer reefs in November and December; fringing reefs are attached to high islands such as the Whitsundays' },
  'csiro-2024': { title: 'Reef snapshot details widespread coral bleaching on the Great Barrier Reef (17 April 2024)', publisher: 'CSIRO', url: 'https://www.csiro.au/en/news/All/News/2024/April/Reef-snapshot-details-widespread-coral-bleaching-on-the-Great-Barrier-Reef', checked: '2026-10-28',
    says: 'Reef Snapshot 2023-24 by the Reef Authority, AIMS and CSIRO: bleaching on 73 per cent of surveyed reefs in the Marine Park; the fifth widespread bleaching event since 2016' },
  'slsq-stingers': { title: 'Swimmers urged to take advice during marine stinger season (31 October 2023)', publisher: 'Surf Life Saving Queensland', url: 'https://lifesaving.com.au/news/swimmers-urged-to-take-advice-during-marine-stinger-season', checked: '2026-10-28',
    says: 'from November to May marine stingers can be found at Queensland beaches from Bustard Heads (north of Bundaberg) to Port Douglas and further north, including box jellyfish and irukandji; wear a full body stinger suit in the ocean during stinger season' },
  'wiki-coral': { title: 'Coral', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Coral', checked: '2026-10-28',
    says: 'spawning frequently takes place in the evening or at night; mass spawning often occurs at night on days following a full moon; the most immediate cue appears to be the dark portion of the night between sunset and moonrise' },
  'wiki-colour-of-water': { title: 'Color of water', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Color_of_water', checked: '2026-10-28',
    says: 'the red, orange and yellow wavelengths of light are absorbed, so the light left is green, cyan and blue' },
  // ---- computed from the model
  'model-terrain': { title: 'Depths and heights in this model', model: true, what: 'the site\'s survey grid (scene.json terrain; for the Great Barrier Reef sites the AusSeabed 30 m bathymetry), sampled where you are' },
  'model-optics': { title: 'Light in the water', model: true, what: 'env.u.K, the diffuse attenuation per metre in red, green and blue derived from the Sentinel-2 imagery: from the deep water\'s colour (QAA, Lee et al.), or a fit of the floor\'s darkening with depth where that passes a quality test (cities/<site>/analysis/optics.json), and env.u.lightPath, the sun\'s slant under water after Snell\'s law; the same numbers the renderer uses (env.js medium)' },
  'model-sun': { title: 'Sun and clock', model: true, what: 'web/sun.js (NOAA solar position equations) for the site\'s time zone and the viewer\'s clock' },
  'model-pois': { title: 'Place names and positions', model: true, what: 'scene.json pois: OpenStreetMap contributors (ODbL) read through Overture Maps, projected to the local frame' },
  'model-dive': { title: 'Dive computer', model: true, what: 'web/reef/dive.js: the water temperature by month and depth the player\'s HUD shows' },
  'model-wind': { title: 'Wind', model: true, what: 'the wind boats.js derives from the same wave bank the sea is drawn from' },
  'model-walk': { title: 'Your own track', model: true, what: 'distance you walked, measured by the game' },
  'model-life': { title: 'Marine life', model: true, what: 'ctx.life (life.js): species list, positions and spawning state' }
};

// a source id -> a short label for the line under a dialogue ("Wikipedia: Whitehaven Beach", "computed: Light in the water")
export function srcLabel(s) { return !s ? '' : s.model ? `computed: ${s.title}` : `${s.publisher}: ${s.title}`; }
