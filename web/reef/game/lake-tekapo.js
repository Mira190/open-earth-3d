// Lake Tekapo / Takapō: who you meet and what you can do, at the places cities/lake-tekapo/city.json maps
// (scene.json pois).
//   Kate, a Department of Conservation ranger, on the path below the Church of the Good Shepherd by the spawn:
//     the church, the lake and its colour, the matagouri round the church, the lupins and the braided rivers,
//     the lake's other lakes, where to go
//   Ian, a runholder, by the sheepdog statue: the statue and the dog it was modelled on, the Mackenzie Country's
//     runs and their history, the frosts and the sun
//   Mei, a Dark Sky Project astronomy guide, by the Astro Café on Mt John: the observatory, the reserve, and the sky
//     over you now (sun, moon, the Southern Cross, the Magellanic Clouds, the Milky Way's centre), worked out live
//   Signs at the church, the footbridge and the summit of Mt John
//   Quests: the church at sunrise, the summit of Mt John, the lupins (in season), a night under the reserve.
// Ngāi Tahu tradition is given only as the cited page gives it; nobody here speaks for mana whenua.
// Every number is computed from the model and the clock while you play, or cites a page in SOURCES (fetched
// 2026-11-05). The stars' positions come from their right ascension and declination as the cited pages give them.

const CHECKED = '2026-11-05';
const SOURCES = {
  'wiki-lake': { title: 'Lake Tekapo', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lake_Tekapo', checked: CHECKED,
    says: 'Takapō in Māori, "Tekapo" a misspelling; Takapō means "to leave in haste at night"; the Mackenzie District Council began using both names in 2021; in Ngāi Tahu tradition one of the lakes dug by the Waitaha explorer Rākaihautū with his digging stick Tūwhakaroria; Motuariki, the island, an ancestor from the Āraiteuru waka turned to an island; 83 km2 at about 710 m; fed at its northern end by the braided Godley and Macaulay rivers; glacial silt gives the turquoise; Two Thumb Range to the east; Mount John (1,031 m) closest to the town, Lake Alexandrina further north; surface water 5.8-5.9 C in September, 17 C in January; more than 2,400 sunshine hours a year; Aoraki Mackenzie International Dark Sky Reserve 2012, 4,367 km2; lupins bloom from around mid-November to the end of December; Russell lupins introduced in the 1940s; in 1949 Connie Scott of Godley Peaks Station scattered about 100 pounds worth of seed along the roadside; they modify the ecosystems of braided rivers; fewer flowered in December 2020 when the lake was too high; drivers warned about stopping on State Highway 8 for them; the bronze sheepdog statue: sculptor Innes Elliott of Kaikōura, modelled on a neighbour\'s dog called Haig, about fifteen months to sculpt, clay from the insulator works at Temuka, a plaster cast sent to London in 1966 where it was cast; Tekapo A online 1951, a 1.4 km tunnel under the town, a 26 km canal to Tekapo B on Lake Pukaki' },
  'wiki-town': { title: 'Lake Tekapo (town)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lake_Tekapo_(town)', checked: CHECKED,
    says: '558 residents at the 2018 census, an estimated 620 in June 2025; James Mackenzie, a Scottish sheep thief, found the basin for Europeans in 1855; John and Barbara Hay set up the first sheep farm in the Mackenzie on the shore of the lake in 1857; control gates at the outlet completed 1940, State Highway 8 runs across them; on average 101.6 nights a year below freezing (1991-2020); 2,505 hours of sunshine a year; Mount John University Observatory set up by the University of Pennsylvania, now run by the University of Canterbury; a US Air Force satellite tracking station beside it from 1969 to 1983; the Dark Sky Project, jointly owned by Hide Ozawa, Graeme Murray and Ngāi Tahu, with a restored 1894 Brashear telescope with an 18-inch lens; the 125 m footbridge opened in 2015, crossing the Tekapo River and joining the Church of the Good Shepherd to the rest of the township' },
  'wiki-church': { title: 'Church of the Good Shepherd, Lake Tekapo', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Church_of_the_Good_Shepherd,_Lake_Tekapo', checked: CHECKED,
    says: 'built in 1935 as a memorial church to the early settlers; Rev. W. E. D. Davies, vicar of Fairlie, suggested the large window, after St James Church at Franz Josef (1930); land given by Braemar Station; sketches by Esther Hope of Grampians Station, design by R. S. D. Harman; foundation stone laid by Prince Henry, Duke of Gloucester, on 16 January 1935; local stone left with its lichen as cladding on concrete; the bell given by the Barker and Sealy families; dedicated 3 August 1935; Australian oak shingles replaced with slate in 1957; Category I, Heritage New Zealand register no. 311, 5 September 1985; photography inside no longer permitted; a fence put up in late 2017; about 600,000 visitors a year (2018)' },
  'heritage-311': { title: 'Church of the Good Shepherd (List no. 311)', publisher: 'Heritage New Zealand Pouhere Taonga', url: 'https://www.heritage.org.nz/list-details/311/311', checked: CHECKED,
    says: 'poured concrete faced with local boulders chosen for size, shape and colour and left with their lichen; buttresses along the sides; a small belfry to the left of the main entrance; a concrete cross on the north gable; the plate glass window above the altar takes the place of reredos and stained glass; carvings by Frederick Gurnsey, including the Good Shepherd on the altar and alpine flora and fauna on the Oamaru stone font; a Book of Remembrance listing the original Mackenzie runholders; the surroundings left in their natural state with matagouri, tussock and rock' },
  'wiki-mjuo': { title: 'Mount John University Observatory', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Mount_John_University_Observatory', checked: CHECKED,
    says: 'University of Canterbury Mount John Observatory, New Zealand\'s premier astronomical research observatory, at 1,029 m on Mount John, established 1965; about 20% of nights photometric; the 1.8 m MOA telescope, opened December 2004, the largest optical telescope in New Zealand; the 1.0 m McLellan telescope installed February 1986, named for Alister McLellan, the first director; Bortle 2; in 2008 the MOA-II telescope found MOA-2007-BLG-192Lb, then the smallest known planet outside the Solar System, about 3.3 times Earth\'s size, 3,000 light years away' },
  'wiki-reserve': { title: 'Aoraki Mackenzie International Dark Sky Reserve', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Aoraki_Mackenzie_International_Dark_Sky_Reserve', checked: CHECKED,
    says: '4,367 km2, designated by the International Dark-Sky Association in June 2012, then the largest in the world and the only one in the Southern Hemisphere; covers Aoraki / Mount Cook National Park, the Mackenzie Basin and Lakes Pukaki and Tekapo; level 2 on the nine-level Bortle scale; a lighting by-law in the Mackenzie District Plan since 1981' },
  'wiki-basin': { title: 'Mackenzie Basin', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Mackenzie_Basin', checked: CHECKED,
    says: 'Te Manahuna in Māori; the largest intermontane basin in New Zealand, about 100 km north to south and 40 km east to west; named after James Mckenzie, a shepherd caught with allegedly stolen sheep; divided into sheep stations in 1857; the original vegetation completely transformed by fire and farming' },
  'wiki-two-thumb': { title: 'Two Thumb Range', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Two_Thumb_Range', checked: CHECKED,
    says: 'east of Lake Tekapo, about 45 km long, several peaks around 2,500 m; The Thumbs twin peaks "like two giant thumbs"; Te Araroa crosses it at Stag Saddle, at 1,925 m the trail\'s highest point' },
  'wiki-lupin': { title: 'Lupinus polyphyllus', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lupinus_polyphyllus', checked: CHECKED,
    says: 'known in New Zealand as the Russell lupin, classed as invasive, covering roadsides, pastures and riverbeds especially in Canterbury; first naturalised in 1958; threatens indigenous species especially in the braided river beds of the South Island' },
  'wiki-matagouri': { title: 'Discaria toumatou (matagouri)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Discaria_toumatou', checked: CHECKED,
    says: 'matagouri, tūmatakuru or wild Irishman: a tangle-branched thorny shrub endemic to New Zealand; the only native plant with spines of this kind; Samuel Butler in 1863 called it "a very uncomfortable prickly shrub, which they call Irishman"' },
  'wiki-doc': { title: 'Department of Conservation (New Zealand)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Department_of_Conservation_(New_Zealand)', checked: CHECKED,
    says: 'Te Papa Atawhai; formed on 1 April 1987 under the Conservation Act 1987; manages about 30% of New Zealand\'s land area' },
  'wiki-godley': { title: 'Godley River', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Godley_River', checked: CHECKED,
    says: 'an alpine braided river from the Godley Glacier in Aoraki / Mount Cook National Park, flowing south 30 km into the top of Lake Tekapo' },
  'wiki-mcgregor': { title: 'Lake McGregor', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lake_McGregor', checked: CHECKED,
    says: 'between Lake Alexandrina to the west and Lake Tekapo to the east; shallow, of glacial origin, fed by the outlet of Lake Alexandrina and draining by a short stream into Lake Tekapo' },
  'wiki-crux': { title: 'Crux', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Crux', checked: CHECKED,
    says: 'the Southern Cross; Acrux the brightest (magnitude 0.8); IAU boundaries between right ascension 11h 56.13m and 12h 57.45m and declination -55.68 and -64.70 degrees; circumpolar south of the 34th parallel south; a line from Gacrux through Acrux, about 4.5 times its length, points close to the south celestial pole; Alpha and Beta Centauri are the Pointers; the Māori name is Māhutonga, thought of as the anchor (Te Punga) of Tama-rereti\'s waka (the Milky Way); the Coalsack nebula beside it' },
  'wiki-lmc': { title: 'Large Magellanic Cloud', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Large_Magellanic_Cloud', checked: CHECKED,
    says: 'a dwarf satellite galaxy about 163,000 light years away; declination about -70 degrees; about 10 degrees long to the naked eye from dark sites; the first discrete X-ray source in Dorado, at RA 05h 20m Dec -69, was the LMC' },
  'wiki-smc': { title: 'Small Magellanic Cloud', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Small_Magellanic_Cloud', checked: CHECKED,
    says: 'a dwarf galaxy about 200,000 light years away, among the most distant objects visible to the naked eye; about 4.2 degrees across; 20 degrees west of the LMC; SMC X-1 at RA 01h 15m Dec -73.7' },
  'wiki-galactic-centre': { title: 'Galactic Center', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Galactic_Center', checked: CHECKED,
    says: 'about 26,000 light years away toward Sagittarius, Ophiuchus and Scorpius, where the Milky Way looks brightest; at RA 17h 45m 40s, Dec -29 00\'' },
  'model-lidar': { title: 'Heights in this model', model: true, what: 'the site\'s terrain grid: LINZ\'s New Zealand LiDAR 1 m DEM (CC BY 4.0) resampled to 30 m (scene.json terrain), sampled where you are and along lines of sight' },
  'model-sky': { title: 'The sky now', model: true, what: 'each object\'s altitude and bearing from its right ascension and declination (the cited pages) at the site\'s latitude and longitude and the viewer\'s clock (sidereal time from the IAU 1982 formula); the sun from web/sun.js; the moon\'s age as env.js draws it' },
  'model-landmarks': { title: 'The landmark models', model: true, what: 'cities/lake-tekapo/analysis/landmarks.json: footprints from OpenStreetMap via Overture, heights from LINZ\'s 1 m LiDAR DSM and DEM (pipeline/tekapo_landmarks.py)' }
};

// ------------------------------------------------------------ the sky, computed
const RAD = Math.PI / 180;
// the stars and clouds the guide points out, [right ascension (hours), declination (degrees)], from the cited pages
const SKY = {
  crux: { name: 'the Southern Cross', ra: (11 + 56.13 / 60 + 12 + 57.45 / 60) / 2, dec: (-55.68 - 64.70) / 2, src: 'wiki-crux' },   // the middle of its IAU boundaries
  lmc: { name: 'the Large Magellanic Cloud', ra: 5 + 20 / 60, dec: -69, src: 'wiki-lmc' },
  smc: { name: 'the Small Magellanic Cloud', ra: 1 + 15 / 60, dec: -73.7, src: 'wiki-smc' },
  core: { name: 'the centre of the Milky Way', ra: 17 + 45 / 60 + 40 / 3600, dec: -29 - 28 / 3600, src: 'wiki-galactic-centre' }
};
// altitude and compass bearing of a fixed object at the site and time (Greenwich mean sidereal time, IAU 1982)
export function skyAltAz(ra, dec, ms, lat, lon) {
  const D = ms / 864e5 + 2440587.5 - 2451545.0;
  const lst = ((18.697374558 + 24.06570982441908 * D + lon / 15) % 24 + 24) % 24;
  const H = (lst - ra) * 15 * RAD, phi = lat * RAD, d = dec * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.cos(phi) * Math.sin(d) - Math.sin(phi) * Math.cos(d) * Math.cos(H));
  return { alt: alt / RAD, az: ((az / RAD) % 360 + 360) % 360 };
}
const SYN = 29.530588;
const moonAge = t => (((t / 864e5 + 2440587.5 - 2451550.1) / SYN) % 1 + 1) % 1;   // as the viewer draws it (env.js)
const moonLit = t => Math.round(50 * (1 - Math.cos(2 * Math.PI * moonAge(t))));

// ------------------------------------------------------------ the land, computed
// the highest angle of the terrain above the horizontal along a bearing, from eyes 1.6 m up (curved Earth, k = 0.13)
const R_EFF = 6371000 / (1 - 0.13);
function skyline(G, from, brg, range = 40000) {
  const h0 = G.height(from.x, from.north) + 1.6, s = Math.sin(brg * RAD), c = Math.cos(brg * RAD);
  let best = -90;
  for (let d = 60; d < range; d += d < 2000 ? 30 : 90) {
    const h = G.height(from.x + s * d, from.north + c * d);
    if (!Number.isFinite(h)) break;
    best = Math.max(best, Math.atan2(h - d * d / (2 * R_EFF) - h0, d) / RAD);
  }
  return best;
}
// a clear line between two points over the terrain (both 1.6 m / `up` m above the ground; the curved Earth)
function clear(G, a, b, up = 2) {
  const d = G.dist(a, b), ha = G.height(a.x, a.north) + 1.6, hb = G.height(b.x, b.north) + up - d * d / (2 * R_EFF), n = Math.max(4, Math.ceil(d / 30));
  for (let i = 1; i < n; i++) { const f = i / n, h = G.height(a.x + (b.x - a.x) * f, a.north + (b.north - a.north) * f) - (d * f) ** 2 / (2 * R_EFF); if (h > ha + (hb - ha) * f) return false; }
  return true;
}
const SIGHT = new Set(['lake', 'peak', 'island', 'church', 'observatory', 'delta', 'range', 'skifield', 'town']);
function inView(G, from, skip, max = 5) {
  const out = [];
  for (const raw of G.S.pois || []) {
    const p = G.poi(raw.id);
    if (!p || !SIGHT.has(p.kind) || (skip || []).includes(p.id)) continue;
    const d = G.dist(from, p); if (d < 300 || d > 45000) continue;
    if (clear(G, from, p, p.kind === 'peak' || p.kind === 'range' ? 3 : 2)) out.push({ p, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max).map(o => `${o.p.name}, ${G.km(o.d)} ${G.dirName(G.bearing(from, o.p))}`);
}

// the church's long axis, toward the altar window (OpenStreetMap footprint; city.json landmarks)
const CHURCH_AXIS = 16.5;
// alpine sites keep heights above the main lake's surface (the viewer's water level 0); datum_m is that surface above NZVD2016
const lakeLevel = G => (G.S.terrain && Number.isFinite(G.S.terrain.datum_m)) ? G.S.terrain.datum_m : null;
const asl = (G, h) => h + (lakeLevel(G) || 0);
const yawDeg = G => ((G.player.S.camYaw / RAD) % 360 + 360) % 360;
const pitchDeg = G => (G.player.S.camPitch || 0) / RAD;
const facing = (G, brg, tol) => Math.abs(((yawDeg(G) - brg + 540) % 360) - 180) < tol;

export default function lakeTekapo(G) {
  const P = id => G.poi(id);
  const [lon, lat] = G.S.origin;
  const sunAt = t => window.Sun.position(t, lat, lon);
  const sky = (k, t = G.nowMs()) => skyAltAz(SKY[k].ra, SKY[k].dec, t, lat, lon);
  const skyWords = k => { const a = sky(k); return a.alt > 0 ? `${a.alt.toFixed(0)}° up in the ${G.dirName(a.az)}` : `below the horizon (${(-a.alt).toFixed(0)}° down, ${G.dirName(a.az)})`; };
  const circumpolar = k => SKY[k].dec < -(90 + lat);   // never sets at this latitude (lat is negative)
  const dark = (t = G.nowMs()) => sunAt(t).altitude < -18;

  // the day's sunrise and the next one after now; astronomical dusk tonight
  const dayAt = (t, fn) => { const l = window.Sun.utcToLocal(t); return fn(l.y, l.m, l.d); };
  const riseOf = t => dayAt(t, (y, m, d) => window.Sun.localToUtc(y, m, d, window.Sun.dayLimits(y, m, d).sunrise));
  const nextSunrise = () => { const t = G.nowMs(), r = riseOf(t); return r > t - 3600e3 ? r : riseOf(t + 864e5); };
  const duskOf = t => dayAt(t, (y, m, d) => { const m18 = window.Sun.altitudeTime(y, m, d, -18, true); return m18 == null ? null : window.Sun.localToUtc(y, m, d, m18); });
  const nextDusk = () => { const t = G.nowMs(), d = duskOf(t); return d && d > t ? d : duskOf(t + 864e5); };
  // when the rising sun clears the terrain to the east of a point (the skyline along its bearing, sampled each minute)
  function sunClears(from, rise) {
    for (let k = -10; k < 240; k += 2) {
      const t = rise + k * 60e3, s = sunAt(t);
      if (s.altitude > -1 && s.altitude > skyline(G, from, s.azimuth, 30000)) return { t, az: s.azimuth, alt: s.altitude };
    }
    return null;
  }
  const lupinSeason = () => { const m = G.monthIndex(); return m === 10 || m === 11; };   // November and December

  // ------------------------------------------------------------ Kate, DOC ranger, by the church
  const kate = {
    id: 'ranger', role: 'ranger', name: 'Kate', title: 'Department of Conservation ranger', gender: 'W',
    look: { character: 'R_Female_Adult_12', clip: 'idle' },
    at: G2 => { const c = P('church-good-shepherd'), s = G2.spawn(), p = G2.landSpot(s.x + 7, s.north + 4, { maxSlope: 0.35, maxR: 25 }) || { x: s.x + 7, north: s.north + 4 };
      return { x: p.x, north: p.north, heading: G2.bearing(p, s) }; },
    nodes: {
      hello: { say: G2 => [{ t: `${G2.greet()}! I'm Kate, with the Department of Conservation, Te Papa Atawhai. That's the Church of the Good Shepherd ${G2.where('church-good-shepherd')} of you.`, src: ['wiki-doc', 'model-pois'] },
        { t: 'It was built in 1935 as a memorial to the first settlers here, and they say it is one of the most photographed buildings in New Zealand.', src: ['wiki-church'] }],
        choices: [
          { text: 'Tell me about the church.', go: 'church' },
          { text: 'Why is the lake that colour?', go: 'lake' },
          { text: 'What are those flowers along the shore?', go: 'lupins' },
          { text: 'When is the best light here?', go: 'sunrise' },
          { text: 'Where should I go?', go: 'where' }] },
      church: { say: G2 => [{ t: 'Esther Hope, an artist from Grampians Station, sketched it, and R. S. D. Harman of Christchurch designed it. Prince Henry, Duke of Gloucester, laid the foundation stone on 16 January 1935, and it was dedicated that August.', src: ['wiki-church'] },
        { t: 'It is poured concrete faced with boulders from round here, chosen for their size, shape and colour and left with their lichen on. The oak shingles did not stand the winters, so it has had slate since 1957.', src: ['heritage-311', 'wiki-church'] },
        { t: 'Inside, the plate glass window over the altar frames the lake and the mountains, in place of a stained glass window. The idea came from St James Church at Franz Josef.', src: ['heritage-311', 'wiki-church'] },
        { t: 'They asked for the ground round it to be left as it was: matagouri, tussock and rock. Matagouri is the thorny one, the only native plant with spines like that. Mind your legs.', src: ['heritage-311', 'wiki-matagouri'] }], next: 'hello' },
      lake: { say: G2 => {
        const lv = lakeLevel(G2), here = G2.here(), mt = P('mt-john');
        return [{ t: 'Meltwater from the Southern Alps carries glacial silt, and that turns it turquoise. The braided Godley and Macaulay rivers feed it at the top end.', src: ['wiki-lake', 'wiki-godley'] },
          { t: `The head of the lake is ${G2.where('godley-delta')} of here. It covers about 83 square kilometres.`, src: ['model-pois', 'wiki-lake'] },
          lv !== null ? { t: `The lake sits about ${lv.toFixed(1)} m above sea level, and you're ${G2.height(here.x, here.north).toFixed(1)} m above it. Mt John is ${G2.height(mt.x, mt.north).toFixed(0)} m above the lake.`, src: ['model-lidar'] } : null,
          { t: `Its Māori name is Takapō. Since 2021 the district council uses both names. In Ngāi Tahu tradition it is one of the lakes Rākaihautū dug with his digging stick, Tūwhakaroria.`, src: ['wiki-lake'] },
          { t: `The surface water is about 6 °C in September and 17 °C in January. It's ${G2.month()}.`, src: ['wiki-lake', 'model-sun'] }];
      }, next: 'hello' },
      lupins: { say: G2 => [{ t: `Russell lupins. They flower along the shore from about mid-November to the end of December.${lupinSeason() ? ` It's ${G2.month()}, so they're out.` : ` It's ${G2.month()}, so you're ${G2.monthIndex() < 10 ? 'early' : 'late'} for them.`}`, src: ['wiki-lake', 'model-sun'] },
        { t: 'They came into the Mackenzie in the 1940s. In 1949 Connie Scott of Godley Peaks Station scattered about a hundred pounds\' worth of seed along the roads.', src: ['wiki-lake'] },
        { t: 'They are pretty, but they are an invasive weed here. They take over the braided river beds, and the native plants and birds of those beds lose out.', src: ['wiki-lupin', 'wiki-lake'] },
        { t: 'And please don\'t stop on the highway to photograph them; people do, and it isn\'t safe.', src: ['wiki-lake'] }],
        do: G2 => { if (lupinSeason()) G2.start('lupins'); }, next: 'hello' },
      sunrise: { say: G2 => {
        const r = nextSunrise(), c = P('church-good-shepherd'), cl = sunClears(c, r);
        return [{ t: `Sunrise is at ${G2.time(r)}. Be here then and look up the lake through the church: the light comes across from the east onto the water and the mountains at the head of the lake.`, src: ['model-sun'] },
          cl && cl.t - r > 6 * 60e3 ? { t: `The sun comes up behind the hills to the ${G2.dirName(cl.az)}; at the church it clears them at about ${G2.time(cl.t)}, ${cl.alt.toFixed(0)}° up.`, src: ['model-sun', 'model-lidar'] }
            : cl ? { t: `The skyline that way is low from here, so the sun reaches the church within minutes of rising, in the ${G2.dirName(cl.az)}.`, src: ['model-sun', 'model-lidar'] } : null];
      }, choices: [
        { text: 'Wake me before sunrise.', go: 'end', do: G2 => { G2.start('church-sunrise'); G2.skipTo(nextSunrise() - 25 * 60e3); } },
        { text: 'I\'ll come back for it.', go: 'end', do: G2 => G2.start('church-sunrise') },
        { text: 'Back', go: 'hello' }] },
      where: { say: G2 => [{ t: `Mt John is ${G2.where('mt-john')}: the walk goes up from the hot pools to the observatory and the café on top. Mei, one of the astronomy guides, is up there.`, src: ['model-pois'] },
        { t: `Ian farms out this way; you'll often find him by the sheepdog statue, ${G2.where('sheepdog-statue')}.`, src: ['model-pois'] },
        { t: `The footbridge over the Tekapo River is ${G2.where('footbridge')}; it joins the church to the township. Lake Alexandrina is ${G2.where('lake-alexandrina')}, behind Mt John.`, src: ['model-pois', 'wiki-town'] }],
        do: G2 => G2.start('mt-john'), next: 'hello' },
      lupinsDone: { say: G2 => [{ t: 'Beautiful, aren\'t they? Now picture them all the way up the braided bed of the Godley, thirty kilometres of it.', src: ['wiki-godley'] },
        { t: 'That\'s the trouble with them. Russell lupins were first recorded growing wild in New Zealand in 1958, and the braided river beds are where they do the most harm to the native plants.', src: ['wiki-lupin'] },
        { t: G2.isDone('church-sunrise') ? 'You\'ve seen the church at sunrise too. Not many get both.' : 'Come back to the church for a sunrise some morning.', src: null }], next: 'hello' }
    }
  };

  // ------------------------------------------------------------ Ian, a runholder, by the sheepdog statue
  const ian = {
    id: 'runholder', role: 'guide', name: 'Ian', title: 'Runholder', gender: 'M',
    look: { character: 'R_Male_Adult_13_m017_grey', clip: 'idle' },
    at: G2 => { const s = P('sheepdog-statue'), p = G2.landSpot(s.x - 4, s.north - 3, { maxSlope: 0.35, maxR: 30 }) || { x: s.x - 4, north: s.north - 3 }; return { x: p.x, north: p.north, heading: G2.bearing(p, s) }; },
    nodes: {
      hello: { say: G2 => [{ t: `${G2.greet()}. Ian. My family's had a run out past the lake a long while. You've found the dog.`, src: null },
        { t: 'The Mackenzie Country people had him made to honour the sheepdog: their living depended on them.', src: ['wiki-lake'] }],
        choices: [
          { text: 'Who made the statue?', go: 'statue' },
          { text: 'How did the farming start here?', go: 'runs' },
          { text: 'What is the weather like?', go: 'weather' },
          { text: 'Thanks, Ian.', go: 'end' }] },
      statue: { say: G2 => {
        return [{ t: 'Innes Elliott of Kaikōura sculpted him. He\'s based on a neighbour\'s dog called Haig, and it took about fifteen months.', src: ['wiki-lake'] },
          { t: 'The clay came from the insulator works at Temuka. They made a plaster cast and sent it to London in 1966, and it was cast in bronze there.', src: ['wiki-lake'] },
          { t: 'He stands on a cairn of stone above the shore; from the ground to the top of his ears is about three metres.', src: ['model-landmarks'] }];
      }, next: 'hello' },
      runs: { say: G2 => [{ t: 'Te Manahuna, the Mackenzie Basin, is the biggest basin of its kind in the country: a hundred kilometres north to south.', src: ['wiki-basin'] },
        { t: 'It\'s named after James Mackenzie, a Scotsman caught in 1855 with sheep that weren\'t his. That\'s how Europeans came to know the high country.', src: ['wiki-town', 'wiki-basin'] },
        { t: 'John and Barbara Hay set up the first sheep run in the Mackenzie in 1857, right on the shore of this lake. Within a couple of years the whole basin was taken up in runs.', src: ['wiki-town', 'wiki-basin'] },
        { t: 'The church\'s Book of Remembrance lists the original runholders. Braemar Station, across the lake, gave the land for the church.', src: ['heritage-311', 'wiki-church'] }], next: 'hello' },
      weather: { say: G2 => {
        const s = sunAt(G2.nowMs());
        return [{ t: 'Sunniest place you\'ll find: about two and a half thousand hours of sun a year.', src: ['wiki-town'] },
          { t: 'And cold at night. A hundred nights a year below freezing on average, and you can get a frost in summer.', src: ['wiki-town'] },
          { t: s.altitude > 0 ? `The sun's ${s.altitude.toFixed(0)}° up in the ${G2.dirName(s.azimuth)} just now.` : `The sun's down: ${(-s.altitude).toFixed(0)}° below the horizon.`, src: ['model-sun'] }];
      }, next: 'hello' }
    }
  };

  // ------------------------------------------------------------ Mei, astronomy guide, on the summit of Mt John
  const mei = {
    id: 'astronomer', role: 'guide', name: 'Mei', title: 'Dark Sky Project astronomy guide', gender: 'W',
    look: { character: 'R_Female_Adult_14', clip: 'idle' },
    at: G2 => { const c = P('astro-cafe') || P('mt-john'), p = G2.landSpot(c.x + 6, c.north - 6, { maxSlope: 0.3, maxR: 40 }) || { x: c.x + 6, north: c.north - 6 };
      return { x: p.x, north: p.north, heading: G2.bearing(p, P('mt-john-observatory') || c) }; },
    nodes: {
      hello: { say: G2 => [{ t: `${G2.greet()}! I'm Mei, I guide the night tours up here. Welcome to the top of Mt John.`, src: null },
        { t: 'The University of Canterbury has run the observatory since it opened in 1965; the University of Pennsylvania first set it up, looking for a site in the southern hemisphere.', src: ['wiki-mjuo', 'wiki-town'] }],
        choices: [
          { text: 'What do the telescopes do?', go: 'telescopes' },
          { text: 'What is the dark sky reserve?', go: 'reserve' },
          { text: 'What can I see in the sky now?', go: 'sky' },
          { text: 'Take me stargazing.', go: 'stargaze' },
          { text: 'Thanks, Mei.', go: 'end' }] },
      telescopes: { say: G2 => [{ t: 'The big dome is MOA: a 1.8 m telescope, opened in December 2004, the largest optical telescope in New Zealand.', src: ['wiki-mjuo'] },
        { t: 'In 2008 the MOA team announced MOA-2007-BLG-192Lb, at the time the smallest planet known outside our solar system: about 3.3 times the size of Earth, 3,000 light years away.', src: ['wiki-mjuo'] },
        { t: 'The 1 m McLellan telescope went in in 1986, named for Alister McLellan, the observatory\'s first director.', src: ['wiki-mjuo'] },
        { t: 'From 1969 to 1983 the US Air Force had a satellite tracking station right beside it.', src: ['wiki-town'] }], next: 'hello' },
      reserve: { say: G2 => [{ t: 'In June 2012 the International Dark-Sky Association named 4,367 square kilometres round here the Aoraki Mackenzie International Dark Sky Reserve: Aoraki / Mount Cook, the basin, Pukaki and Tekapo.', src: ['wiki-reserve'] },
        { t: 'The sky rates 2 on the nine-step Bortle scale: a truly dark site. The district has had a lighting rule in its plan since 1981, so the town\'s lights point down.', src: ['wiki-reserve'] }], next: 'hello' },
      sky: { say: G2 => {
        const t = G2.nowMs(), s = sunAt(t), lit = moonLit(t), mAlt = G2.moonAlt(t);
        return [{ t: s.altitude > -6 ? `The sun is ${s.altitude >= 0 ? `${s.altitude.toFixed(0)}° up` : `just ${(-s.altitude).toFixed(0)}° down`}: too bright for stars yet.` : s.altitude > -18 ? `The sun is ${(-s.altitude).toFixed(0)}° below the horizon: twilight. Full dark comes at 18°.` : `The sun is ${(-s.altitude).toFixed(0)}° down: properly dark.`, src: ['model-sky'] },
          { t: `The moon is ${mAlt > 0 ? `up, ${mAlt.toFixed(0)}° high` : 'down'} and ${lit}% lit.${mAlt > 0 && lit > 50 ? ' It washes out the faint stuff tonight.' : ''}`, src: ['model-sky'] },
          { t: `The Southern Cross is ${skyWords('crux')}. At this latitude it never sets.`, src: ['wiki-crux', 'model-sky'] },
          { t: `The Large Magellanic Cloud is ${skyWords('lmc')}, and the Small one ${skyWords('smc')}: two galaxies 163,000 and 200,000 light years away that you can see without a telescope.`, src: ['wiki-lmc', 'wiki-smc', 'model-sky'] },
          { t: `The centre of the Milky Way, toward Sagittarius, is ${skyWords('core')}.`, src: ['wiki-galactic-centre', 'model-sky'] }];
      }, next: 'hello' },
      stargaze: { say: G2 => {
        const d = nextDusk();
        return dark() ? [{ t: 'It\'s dark now. Let your eyes adjust, then look up. I\'ll show you how to find south.', src: ['model-sky'] }]
          : [{ t: `Full dark tonight, when the sun is 18° down, is at ${d ? G2.time(d) : 'midsummer\'s midnight'}. Come back then, or I can skip you ahead.`, src: ['model-sky'] }];
      }, do: G2 => G2.start('stargazing'), choices: [
        { text: 'Skip to full dark.', go: 'end', when: () => !dark(), do: G2 => { const d = nextDusk(); if (d) G2.skipTo(d + 10 * 60e3); } },
        { text: 'Let\'s go.', go: 'end' }] },
      crux: { say: G2 => {
        const c = sky('crux');
        return [{ t: `That's it: Māhutonga, the Southern Cross, ${c.alt.toFixed(0)}° up in the ${G2.dirName(c.az)}. Acrux, the brightest, is the foot of the cross.`, src: ['wiki-crux', 'model-sky'] },
          { t: 'Run a line from the top of the cross through Acrux, about four and a half times its length, and you are near the south celestial pole. The two bright Pointers beside it are Alpha and Beta Centauri.', src: ['wiki-crux'] },
          { t: 'In Māori tradition Māhutonga is the anchor, Te Punga, of Tama-rereti\'s waka, which is the Milky Way.', src: ['wiki-crux'] },
          circumpolar('crux') ? { t: `Here at ${(-lat).toFixed(0)}° south, anything within ${(90 + lat).toFixed(0)}° of the pole never sets, and the cross is ${(90 + SKY.crux.dec).toFixed(0)}° from it: it wheels round the pole all night.`, src: ['wiki-crux', 'model-sky'] } : null];
      }, next: 'hello' }
    }
  };

  // ------------------------------------------------------------ signs
  const signs = [];
  if (P('church-good-shepherd')) signs.push({ id: 'church', title: 'Church of the Good Shepherd',
    at: G2 => { const c = P('church-good-shepherd'), s = G2.landSpot(c.x - 3, c.north - 9, { maxSlope: 0.4, maxR: 20 }) || { x: c.x - 3, north: c.north - 9 }; return { x: s.x, north: s.north, heading: G2.bearing(s, c) }; },
    nodes: { read: { say: G2 => [{ t: 'Church of the Good Shepherd, 1935. Built by the people of the Mackenzie Country in memory of its first settlers. Heritage New Zealand Category I, list no. 311.', src: ['wiki-church', 'heritage-311'] },
      { t: 'The carvings are by Frederick Gurnsey: the Good Shepherd on the altar, and alpine plants and animals on the Oamaru stone font.', src: ['heritage-311'] },
      { t: 'The bell was given by the Barker and Sealy families. Please, no photography inside during services; the grounds are open in daylight hours.', src: ['wiki-church'] },
      { t: `The altar window looks ${G2.dirName(CHURCH_AXIS)} up the lake. In sight from here: ${inView(G2, G2.sign('church') || G2.here(), ['church-good-shepherd']).join('; ') || 'the lake'}.`, src: ['model-landmarks', 'model-lidar', 'model-pois'] }] } } });
  if (P('footbridge')) signs.push({ id: 'footbridge', title: 'Lake Tekapo footbridge',
    at: G2 => { const b = P('footbridge'), s = G2.landSpot(b.x + 70, b.north + 4, { maxSlope: 0.4, maxR: 30 }) || { x: b.x + 70, north: b.north }; return { x: s.x, north: s.north, heading: G2.bearing(s, b) }; },
    nodes: { read: { say: G2 => {
      return [{ t: 'The footbridge, opened in 2015, crosses the Tekapo River just below the lake\'s outlet and joins the church to the township. It is 125 m long.', src: ['wiki-town'] },
        { t: 'The control gates at the outlet were finished in 1940; State Highway 8 runs across them. The lake\'s water now goes mostly through a tunnel under the town to Tekapo A power station, and on by a 26 km canal to Lake Pukaki.', src: ['wiki-town', 'wiki-lake'] },
        { t: 'Its deck stands 8 to 11 m above the river, on three piers.', src: ['model-landmarks'] }]; } } } });
  if (P('mt-john')) signs.push({ id: 'summit', title: 'Mt John summit',
    at: G2 => { const m = P('mt-john'), s = G2.landSpot(m.x + 8, m.north + 8, { maxSlope: 0.4, maxR: 40 }) || m; return { x: s.x, north: s.north, heading: 40 }; },
    nodes: { read: { say: G2 => { const s = G2.sign('summit') || G2.here(), lv = lakeLevel(G2);
      return [{ t: `Mt John summit, ${asl(G2, G2.height(s.x, s.north)).toFixed(0)} m above sea level${lv !== null ? `, ${G2.height(s.x, s.north).toFixed(0)} m above Lake Tekapo` : ''}.`, src: ['model-lidar'] },
        { t: `Lake Alexandrina is ${G2.where('lake-alexandrina', s)}, and small Lake McGregor ${G2.where('lake-mcgregor', s)}, between it and Lake Tekapo; McGregor drains into Lake Tekapo by a short stream.`, src: ['model-pois', 'wiki-mcgregor'] },
        { t: `In sight from here: ${inView(G2, s, ['mt-john', 'mt-john-observatory'], 6).join('; ')}.`, src: ['model-lidar', 'model-pois'] },
        { t: 'Across the lake, the Two Thumb Range runs north for about 45 km; Te Araroa, the trail the length of the country, crosses it at Stag Saddle, its highest point.', src: ['wiki-two-thumb'] }]; } } } });

  // ------------------------------------------------------------ quests
  const church = () => P('church-good-shepherd');
  const quests = [
    { id: 'church-sunrise', title: 'The church at sunrise', summary: G2 => 'Saw the sun come up on the lake from the Church of the Good Shepherd.',
      hint: 'Ask Kate about the best light.',
      steps: [
        { text: G2 => { const r = nextSunrise(); return `Be at the church at sunrise (${G2.time(r)})`; }, target: 'church-good-shepherd',
          check: G2 => { const t = G2.nowMs(), r = riseOf(t); return G2.dist(G2.here(), church()) < 30 && t > r - 30 * 60e3 && t < r + 75 * 60e3; } },
        { text: 'Look up the lake, the way the altar window looks', target: 'godley-delta',
          enter: (G2, d) => { d.t = 0; }, tick: (G2, dt, d) => { d.t = facing(G2, CHURCH_AXIS, 30) && G2.dist(G2.here(), church()) < 40 ? (d.t || 0) + dt : 0; },
          check: (G2, d) => d.t >= 3 }],
      onDone: G2 => { const r = riseOf(G2.nowMs()), cl = sunClears(church(), r);
        G2.note('church-sunrise', `Sunrise ${G2.time(r)} at the Church of the Good Shepherd${cl ? `; the sun cleared the hills at ${G2.time(cl.t)}, ${G2.dirName(cl.az)}` : ''}.`, ['model-sun', 'model-lidar'], 'Kate'); } },
    { id: 'mt-john', title: 'The summit of Mt John', summary: 'Climbed Mt John and read the summit view.', hint: 'Ask Kate where to go.',
      steps: [
        { text: 'Climb to the summit of Mt John', target: 'mt-john', check: G2 => G2.dist(G2.here(), P('mt-john')) < 60 },
        { text: 'Read the summit sign', target: 'sign:summit', on: { sign: (G2, d, id) => id === 'summit' } },
        { text: 'Meet Mei by the café', target: 'npc:astronomer', talkTo: 'astronomer', node: 'hello' }],
      onDone: G2 => G2.note('mt-john', `Mt John: ${asl(G2, G2.height(P('mt-john').x, P('mt-john').north)).toFixed(0)} m above sea level, the observatory's domes and the three lakes below.`, ['model-lidar', 'wiki-mjuo'], 'Mei') },
    { id: 'lupins', title: 'Lupins on the shore', summary: 'Walked among the lupins on the lakeshore, and heard what they do to the rivers.',
      hint: 'Ask Kate about the flowers along the shore (mid-November to December).',
      available: () => lupinSeason(), unavailable: 'The lupins flower from about mid-November to the end of December (Wikipedia, Lake Tekapo).',
      steps: [
        { text: 'Walk the lakeshore east of the footbridge, among the lupins', target: 'lupins-shore', check: G2 => G2.dist(G2.here(), P('lupins-shore')) < 70 },
        { text: 'Tell Kate', target: 'npc:ranger', talkTo: 'ranger', node: 'lupinsDone' }] },
    { id: 'stargazing', title: 'A night under the reserve', summary: 'Found the Southern Cross from Mt John under the dark sky reserve.',
      hint: 'Ask Mei to take you stargazing.',
      steps: [
        { text: G2 => { const d = nextDusk(); return dark() ? 'Be on Mt John in the dark' : `Be on Mt John after full dark (${d ? G2.time(d) : 'tonight'})`; }, target: 'mt-john',
          check: G2 => dark() && G2.dist(G2.here(), P('mt-john')) < 250 },
        { text: (G2, d) => `Let your eyes adjust: look up at the sky (${Math.round((d && d.t) || 0)}/20 s)`, enter: (G2, d) => { d.t = 0; },
          tick: (G2, dt, d) => { if (pitchDeg(G2) > 30) d.t = (d.t || 0) + dt; }, check: (G2, d) => d.t >= 20 },
        { text: G2 => `Find the Southern Cross: ${skyWords('crux')}`,
          check: G2 => { const c = sky('crux'); return c.alt > 0 && facing(G2, c.az, 20) && Math.abs(pitchDeg(G2) - c.alt) < 18; } },
        { text: 'Tell Mei what you found', target: 'npc:astronomer', talkTo: 'astronomer', node: 'crux' }],
      onDone: G2 => { const c = sky('crux'); G2.note('stargazing', `Found Māhutonga, the Southern Cross, ${c.alt.toFixed(0)}° up in the ${G2.dirName(c.az)}, from Mt John at ${G2.clock()}.`, ['wiki-crux', 'model-sky'], 'Mei'); } }
  ];

  return { sources: SOURCES, npcs: [kate, ian, mei], signs, quests };
}
