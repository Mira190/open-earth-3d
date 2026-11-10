// Milford Sound / Piopiotahi: who you meet and what you can do, at the places cities/milford-sound/city.json maps
// (scene.json pois, falls, flora and the ship's line in harbour.traffic).
//   Jess, a Department of Conservation ranger, on the Milford Foreshore Walk by the spawn, facing Mitre Peak: the
//     fiord (a fiord, not a sound; its length and depth; its names), Mitre Peak (the published height beside what the
//     model's terrain gives), the rain, the freshwater layer and the black coral under it, the bush on the walls and
//     its tree avalanches, the rātā, the lupins on the river flats, where to go
//   Finn, the nature guide of the Piopiotahi, at the Freshwater Basin terminal: where the cruise goes (the ship's own
//     line, measured), Stirling and Lady Bowen Falls (the published heights beside the drops traced on the model),
//     whether a rainbow can stand in the spray now (from the sun's altitude and bearing, the wall's shadow and where
//     the ship stops), the seals, dolphins and tawaki, the Tasman Sea and why Cook sailed past. He puts you aboard,
//     and while you ride he calls out each place the ship comes to
//   Signs on the foreshore and at Freshwater Basin
//   Quests: Mitre Peak from the foreshore, to Stirling Falls on the Piopiotahi (when the ship is in the build), the
//   lupins on the river flats (in their season).
// Māori names and tradition are given only as the cited pages give them; nobody here speaks for mana whenua.
// Every number is computed from the model and the clock while you play, or cites a page in SOURCES (fetched
// 2026-11-09).

const CHECKED = '2026-11-09';
const SOURCES = {
  'wiki-milford': { title: 'Milford Sound', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Milford_Sound', checked: CHECKED,
    says: 'a fiord in the southwest of New Zealand\'s South Island, formed by glaciation over millions of years; runs 15 kilometres inland from the Tasman Sea at Dale Point (maximum length 15.1 km, maximum depth 291 m), surrounded by sheer rock faces that rise 1,200 m or more on either side; The Elephant 1,517 m, The Lion 1,302 m; known as Piopiotahi after the now extinct piopio, a thrush-like bird: a single piopio flew to the fiord in mourning following Māui\'s death, tahi meaning "one"; the sealer John Grono named it after Milford Haven in Wales (1823 in one section, about 1812 in another); European explorers initially overlooked it because its narrow entry did not appear to lead into such large interior bays, and sailing ship captains such as James Cook, who bypassed it for just this reason, feared the steep mountainsides, afraid that wind conditions would prevent escape; a mean annual rainfall of 6,412 mm, the wettest inhabited place in New Zealand and one of the wettest in the world, up to 250 mm in 24 hours; the rain creates dozens of temporary waterfalls; accumulated rainwater can cause portions of the rainforest to lose their grip on sheer cliff faces, resulting in tree avalanches into the fiord, whose regrowth can be seen in several places; two permanent waterfalls, Lady Bowen Falls and Stirling Falls; the 151-metre Stirling Falls named after Frederick Stirling, captain of HMS Clio; the surface is a layer of freshwater containing tannins from the surrounding rainforest, which filters much of the sunlight, so black coral is found as shallow as 10 m; the underwater observatory shows the fiord\'s marine environment at a depth of 10 m; home to seals and the southernmost wild population of bottlenose dolphins; a breeding site for the Fiordland penguin; humpback and southern right whales increasingly observed; between 550,000 and 1 million visitors per year; scenic flights by light aircraft and helicopter to and from Milford Sound Airport; Rudyard Kipling called it the eighth Wonder of the World' },
  'wiki-mitre': { title: 'Mitre Peak (New Zealand)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Mitre_Peak_(New_Zealand)', checked: CHECKED,
    says: 'rises to 1,690 metres with almost sheer drops to the water; the Māori name for the peak is Rahotu; named by Captain John Lort Stokes of HMS Acheron, who found its shape reminiscent of the mitre headwear of Christian bishops; actually a closely grouped set of five peaks; Jim Dennistoun, in 1911, continued on alone up steep, smooth slabs to reach the summit at 13:15, a claim Donald Sutherland disputed; the imposing setting makes the peak a favourite object for painters' },
  'wiki-bowen': { title: 'Bowen Falls', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Bowen_Falls', checked: CHECKED,
    says: 'the Bowen Falls (Māori: Hineteawa), also known as Lady Bowen Falls, 162 metres; the river and waterfalls named for Diamantina Bowen (Lady Bowen), the wife of the fifth governor of New Zealand, who visited Milford Sound aboard HMS Clio in 1871; the 9-kilometre Bowen River supplies the fall and is also used to generate electricity and supply drinking water to the nearby locality; the track from the Milford Sound wharf closed in 2002 after a rock face had become unstable, and for 15 years the fall could only be visited by boat; from 29 January 2018 a short on-demand boat service passes the unstable section' },
  'wiki-fiordland': { title: 'Fiordland National Park', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Fiordland_National_Park', checked: CHECKED,
    says: 'the largest of the 13 national parks in New Zealand, 12,607 km2, established 1952; occupies almost half of Te Wāhipounamu, a UNESCO World Heritage Site established in 1990; during the cooler past, glaciers carved many deep fiords; rainfall exceeding seven metres in many parts of the park; the dense forests, often clinging to steep valley sides, are mostly silver beech and mountain beech; in Māori mythology the fiords are created by the craft of Tū Te Rakiwhanoa, who carved indentations into the coastline to make it habitable; Hine-nui-te-pō created sandflies to keep people from becoming idle in Fiordland' },
  'wiki-wahipounamu': { title: 'Te Wāhipounamu', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Te_W%C4%81hipounamu', checked: CHECKED,
    says: 'Māori for "the place of greenstone"; inscribed on the World Heritage List in 1990, covering 26,000 square kilometres; incorporates four national parks: Aoraki / Mount Cook, Fiordland, Mount Aspiring and Westland Tai Poutini; some of the best modern representations of the original flora and fauna of Gondwana' },
  'wiki-rata': { title: 'Metrosideros umbellata', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Metrosideros_umbellata', checked: CHECKED,
    says: 'commonly known as southern rātā; grows to a height of up to 15 metres; masses of typically scarlet-coloured flowers from November to February (the description says summer, November to March); common in the West Coast Region; the flowers are visited by bellbirds, kākā, kea and tūī and by honeybees; particularly threatened by possum browsing' },
  'wiki-lupin': { title: 'Lupinus polyphyllus', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lupinus_polyphyllus', checked: CHECKED,
    says: 'known in New Zealand as the Russell lupin and classed as an invasive species; covers large areas next to roadsides, pastures and riverbeds, especially in the Canterbury region; first naturalised in 1958; threatens indigenous species especially when it invades the braided river beds in the South Island' },
  'nzpcn-lupin': { title: 'Lupinus polyphyllus', publisher: 'New Zealand Plant Conservation Network', url: 'https://nzpcn.org.nz/flora_details.asp?ID=3144', checked: CHECKED,
    says: 'Russell lupin; exotic, naturalised 1958, from North America; flowers September to February in lilac, purple, red/pink, white and yellow; establishes in waste places and lowland areas, streams, riverbeds and disturbed montane to subalpine areas; seriously invasive in South Canterbury, especially in gravel river beds and on road verges' },
  'wiki-tawaki': { title: 'Fiordland penguin', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Fiordland_penguin', checked: CHECKED,
    says: 'also known as the Fiordland crested penguin (in Māori, tawaki), Eudyptes pachyrhynchus; approximately 55 cm long and 3.5 kg on average; a broad yellow crest that begins at the base of the beak and extends over the eye, dropping down the neck; nests in colonies among tree roots and rocks in dense temperate coastal forest; breeds annually from July to December; the main threats are introduced predators such as dogs, cats, rats and especially stoats' },
  'doc-tawaki': { title: 'Fiordland crested penguin/tawaki', publisher: 'Department of Conservation', url: 'https://www.doc.govt.nz/nature/native-animals/birds/birds-a-z/penguins/fiordland-crested-penguin-tawaki/', checked: CHECKED,
    says: 'one of the rarest of New Zealand\'s mainland penguins; between 2,500 and 3,000 breeding pairs, in decline since the 1950s; the best time of year to see tawaki is during the breeding season from July to November; tawaki can also be seen in Milford Sound and at Jackson Bay; stoats and dogs pose a serious risk to tawaki colonies; tawaki are very timid, so do not approach birds, nests or areas of beach where penguin tracks are common' },
  'doc-foreshore': { title: 'Milford Foreshore Walk', publisher: 'Department of Conservation', url: 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/fiordland/places/fiordland-national-park/things-to-do/tracks/milford-foreshore-walk/', checked: CHECKED,
    says: 'an easy loop walk suited to all ages and accessible to wheelchairs; wander through beech forest and along the sandy foreshore of Milford Sound; some of the best views of Mitre Peak are from this walk; begins from the main visitor carpark at Milford Sound, at the end of the Milford Road; interpretation panels; there may be a lot of sandflies on this walk' },
  'wiki-fur-seal': { title: 'New Zealand fur seal', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/New_Zealand_fur_seal', checked: CHECKED,
    says: 'a fur seal found mainly around southern Australia and New Zealand, kekeno in Māori; males can be 2 m long and average about 126 kg; males can dive for about 15 minutes to a depth of about 380 m; commercial hunting until the late 19th century reduced the population to near extinction; there are now established and expanding colonies around the entire South Island; in New Zealand all wild pinnipeds cannot be touched or fed' },
  'wiki-piopio': { title: 'Piopio (bird)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Piopio_(bird)', checked: CHECKED,
    says: 'the piopio or turnagras, an extinct genus of passerine birds endemic to New Zealand, sometimes described as New Zealand thrushes; two species, of the North Island and the South Island; deforestation and introduced predators are believed to have caused both extinctions; the South Island piopio was last recorded in 1905; Walter Buller described their calls as being among the most beautiful of any New Zealand bird' },
  'wiki-black-coral': { title: 'Antipathella fiordensis', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Antipathella_fiordensis', checked: CHECKED,
    says: 'a species of colonial coral in the order Antipatharia (the black corals), described from the steep-sided fiords of Fiordland; occurs in the seas around New Zealand at depths of from 5 to 100 m; black corals do not need to live in sunlit places; colonies do not reach sexual maturity until they are about 0.7-1.0 m tall, aged at least 30 years' },
  'wiki-rainbow': { title: 'Rainbow', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Rainbow', checked: CHECKED,
    says: 'rainbows caused by sunlight always appear in the section of sky directly opposite the sun; the bow is the base of a cone, a circle at an angle of 40-42 degrees to the line between the observer\'s head and their shadow; when the sun\'s elevation exceeds 42 degrees a rainbow will not be visible against the sky; also caused by mist and spray, and commonly seen near waterfalls or fountains; in a primary rainbow the arc shows red on the outer part and violet on the inner side' },
  'model-heights': { title: 'Heights in this model', model: true, what: 'the site\'s terrain grid: LINZ\'s New Zealand LiDAR 1 m DEM where a capture reaches and the contour-interpolated 8 m DEM over the rest of Fiordland (CC BY 4.0), resampled to 10 m (scene.json terrain), above the fiord\'s surface; a peak is the highest ground within 500 m of its mapped point' },
  'model-fiord': { title: 'The falls in this model', model: true, what: 'web/reef/alpine/fiord.js: each fall is traced down the model\'s own wall from its mapped point by steepest descent; its drop is from that point to the sea, or to where the wall ends' },
  'model-bow': { title: 'The rainbow now', model: true, what: 'the sun\'s altitude and bearing from web/sun.js at the site and the viewer\'s clock; the bow on the cone 40 to 42 degrees round the point opposite the sun (the cited page); whether the terrain shades the foot of the fall (the skyline toward the sun on the terrain grid); the bearing of the fall\'s spray from where you are or from the ship\'s stop' },
  'model-route': { title: 'The ship\'s line', model: true, what: 'scene.json harbour.traffic: the waypoints the ship sails between and her speed; lengths are measured between them, and her position and speed are read from the ship while she sails' },
  'model-flora': { title: 'Lupins in this model', model: true, what: 'scene.json flora.lupins: the stands the viewer plants on the flats (web/reef/alpine/flora.js)' },
  'model-bush': { title: 'The bush in this model', model: true, what: 'web/reef/alpine/terrain.js: the rainforest drawn on the fiord\'s walls, with rātā crowns in flower low on them in the summer months' }
};

const RAD = Math.PI / 180;
const R_EFF = 6371000 / (1 - 0.13);                      // the Earth's radius stretched by standard refraction
const BOW = [40, 42];                                    // the primary bow's cone round the point opposite the sun (wiki-rainbow)
const wrap180 = a => ((a % 360) + 540) % 360 - 180;
const deg = a => `${Math.round(((a % 360) + 360) % 360)}°`;
const facing = (G, brg, tol) => Math.abs(wrap180(G.player.S.camYaw / RAD - brg)) < tol;

export default function milfordSound(G) {
  const P = id => G.poi(id);
  const [lon, lat] = G.S.origin;
  const sunAt = t => window.Sun.position(t, lat, lon);
  const rawPoi = id => (G.S.pois || []).find(p => p.id === id) || {};
  const land = (x, n, o = {}) => G.landSpot(x, n, Object.assign({ maxSlope: 0.35, maxR: 60 }, o)) || { x, north: n };

  // ------------------------------------------------------------ the land, computed
  // the highest ground within 500 m of a mapped peak
  const tops = new Map();
  function topOf(id) {
    if (tops.has(id)) return tops.get(id);
    const p = P(id); let best = null;
    if (p) { best = { x: p.x, north: p.north, h: G.height(p.x, p.north) };
      for (let dx = -500; dx <= 500; dx += 10) for (let dn = -500; dn <= 500; dn += 10) { const h = G.height(p.x + dx, p.north + dn); if (h > best.h) best = { x: p.x + dx, north: p.north + dn, h }; } }
    tops.set(id, best); return best;
  }
  const m = h => Math.round(h).toLocaleString('en-NZ');
  // how high a top stands above the horizontal from a point (eyes 1.6 m up, the curved Earth)
  const angleTo = (from, top) => { const d = G.dist(from, top); return Math.atan2(top.h - d * d / (2 * R_EFF) - (Math.max(G.height(from.x, from.north), 0) + 1.6), d) / RAD; };
  // the highest angle of the terrain above the horizontal along a bearing, from `up` m above a point
  function skyline(from, up, brg, range = 14000) {
    const h0 = Math.max(G.height(from.x, from.north), 0) + up, s = Math.sin(brg * RAD), c = Math.cos(brg * RAD);
    let best = -90;
    for (let d = 40; d < range; d += d < 1500 ? 20 : 80) {
      const h = G.height(from.x + s * d, from.north + c * d);
      if (!Number.isFinite(h)) break;
      best = Math.max(best, Math.atan2(h - d * d / (2 * R_EFF) - h0, d) / RAD);
    }
    return best;
  }
  const peaksInSight = (from, max = 5) => (G.S.pois || []).filter(p => p.kind === 'peak').map(p => ({ p: P(p.id), top: topOf(p.id) })).filter(o => o.top && G.lineOfSight(from, o.top, 1.6, 2))
    .map(o => ({ o, d: G.dist(from, o.top) })).sort((a, b) => a.d - b.d).slice(0, max).map(({ o, d }) => `${o.p.name}, ${m(o.top.h)} m, ${G.km(d)} ${G.dirName(G.bearing(from, o.top))}`);

  // ------------------------------------------------------------ the falls and the ship, as the model has them
  // (alpine/fiord.js and the ship's model may be missing from a build: every line that uses them has a fallback)
  function fall(id) {
    const F = ((G.ctx.fiord && G.ctx.fiord.falls) || []).find(f => f.id === id);
    if (F && F.foot && Number.isFinite(F.drop)) return { foot: { x: F.foot.x, north: F.foot.n }, drop: F.drop, R: Math.min(60, 12 + F.drop * 0.2) * Math.sqrt(F.flow || 1) };
    const p = P(id); return p ? { foot: { x: p.x, north: p.north }, drop: null, R: 40 } : null;
  }
  const dropLine = (id, name) => { const f = fall(id); return f && f.drop !== null ? { t: `Measured down the wall from its lip, ${name} drops ${m(f.drop)} m here.`, src: ['model-fiord'] } : null; };
  const ship = () => G.vessels().find(v => v.kind === 'ship') || null;
  const shipAt = v => ({ x: v.x, north: -v.z });
  const onShip = () => { const v = G.aboard(); return v && v.kind === 'ship' ? v : null; };
  const line = (G.S.harbour && (G.S.harbour.traffic || []).find(r => r.kind === 'ship')) || null;
  const route = line ? line.route.map(P).filter(Boolean) : [];
  const routeM = route.reduce((s, p, i) => i ? s + G.dist(route[i - 1], p) : 0, 0);

  // ------------------------------------------------------------ the rainbow in a fall's spray, computed
  // The bow is the cone BOW degrees round the point opposite the sun. At an altitude `e` above the horizontal its two
  // sides stand `half` degrees either side of the bearing opposite the sun; the bow is in the spray when the foot of
  // the fall is sunlit and the spray's bearing from the eye falls on one of those sides (within the spray's own width).
  function bow(eye, f, t = G.nowMs()) {
    const s = sunAt(t), anti = (s.azimuth + 180) % 360, o = { alt: s.altitude, az: s.azimuth, anti, top: BOW[1] - s.altitude, up: s.altitude > 0, lit: false, inSpray: false };
    if (!o.up || !f) return o;
    o.lit = s.altitude > skyline(f.foot, 8, s.azimuth);
    const d = Math.max(G.dist(eye, f.foot), 1), e = Math.atan2(f.R * 0.4 - (eye.up || 0), d), a = s.altitude * RAD;
    const c = (Math.cos(41 * RAD) + Math.sin(e) * Math.sin(a)) / (Math.cos(e) * Math.cos(a));
    o.brg = G.bearing(eye, f.foot);
    if (Math.abs(c) > 1) return o;                         // at the spray's height the bow is nowhere (the sun is too high)
    o.half = Math.acos(c) / RAD; o.sides = [anti - o.half, anti + o.half];
    o.off = Math.min(...o.sides.map(b => Math.abs(wrap180(o.brg - b))));
    o.inSpray = o.lit && o.off < Math.atan2(f.R, d) / RAD + 1.5;
    return o;
  }
  const stopEye = () => { const p = P('wp-stirling') || P('stirling-falls'); return p ? { x: p.x, north: p.north, up: 5 } : null; };
  // the next time today (from now to sunset) the bow stands in the fall's spray from the ship's stop
  function bowLater(f) {
    const eye = stopEye(); if (!eye || !f) return null;
    const t0 = G.nowMs(), end = Math.max(t0, G.sunset().set);
    for (let t = t0; t <= end; t += 10 * 60e3) if (bow(eye, f, t).inSpray) return t;
    return null;
  }
  function bowPages() {
    const f = fall('stirling-falls'), eye = stopEye(), b = eye && f ? bow(eye, f) : null;
    const out = [{ t: 'A rainbow always stands directly opposite the sun, on a circle 40 to 42 degrees out from the shadow of your own head. Spray makes one as well as rain does, which is why you see them at waterfalls.', src: ['wiki-rainbow'] }];
    if (!b) return out;
    if (!b.up) { out.push({ t: `The sun is down now, ${Math.round(-b.alt)}° below the horizon, so there is no bow.`, src: ['model-bow'] }); return out; }
    out.push(b.top <= 0 ? { t: `Right now the sun is ${Math.round(b.alt)}° up in the ${G.dirName(b.az)}. That is higher than 42°, so the whole bow lies below the horizontal: nothing stands against the sky.`, src: ['model-bow', 'wiki-rainbow'] }
      : { t: `Right now the sun is ${Math.round(b.alt)}° up in the ${G.dirName(b.az)}. Turn your back to it and look ${G.dirName(b.anti)}: the top of the bow is ${Math.round(b.top)}° above the horizon there, red on the outside.`, src: ['model-bow', 'wiki-rainbow'] });
    const later = () => { const t = bowLater(f); return t ? ` It should stand there at about ${G.time(t)}.` : ' It does not come round to the boat\'s side of the fall again before sunset today.'; };
    if (!b.lit) out.push({ t: `But the mountains have the foot of Stirling Falls in shadow just now, and a bow needs the sun on the spray.${later()}`, src: ['model-bow', 'model-fiord', 'model-heights'] });
    else if (b.inSpray) out.push({ t: `Where the ship stops, the fall is toward ${deg(b.brg)} (${G.dirName(b.brg)}), and that is where one side of the bow comes down just now: it stands in the spray.`, src: ['model-bow', 'model-fiord', 'model-route'] });
    else out.push({ t: `Where the ship stops, the fall is toward ${deg(b.brg)} (${G.dirName(b.brg)}).${b.sides ? ` The bow comes down to the water toward ${deg(b.sides[0])} and ${deg(b.sides[1])}, ${Math.round(b.off)}° off the spray, so not from the boat just now.` : ' At the spray\'s height there is no bow at all just now.'}${later()}`, src: ['model-bow', 'model-fiord', 'model-route'] });
    return out;
  }

  // ------------------------------------------------------------ the seasons, from the clock
  const lupinSeason = () => { const k = G.monthIndex(); return k >= 8 || k <= 1; };            // September to February (nzpcn-lupin)
  const rataSeason = () => { const k = G.monthIndex(); return k >= 10 || k <= 1; };            // November to February (wiki-rata)
  const tawakiSeason = () => { const k = G.monthIndex(); return k >= 6 && k <= 10; };          // July to November (doc-tawaki)
  const stands = () => ((G.S.flora && G.S.flora.lupins) || []).map(l => ({ x: l.x, north: l.y, r: l.r_m || 60, name: 'the lupins' }));
  // the stand the quest sends you to: the nearest one that is a walk from the start, not the one at your feet
  const farStand = () => { const s = G.spawn(), all = stands().map(l => ({ l, d: G.dist(s, l) })).sort((a, b) => a.d - b.d); return (all.find(o => o.d > 150) || all[all.length - 1] || {}).l || null; };

  // ------------------------------------------------------------ Jess, DOC ranger, on the foreshore walk
  const jess = {
    id: 'ranger', role: 'ranger', name: 'Jess', title: 'Department of Conservation ranger', gender: 'W',
    look: { character: 'R_Female_Adult_12', clip: 'Idle' },
    at: G2 => { const s = G2.spawn(), a = (s.heading + 35) * RAD, p = land(s.x + Math.sin(a) * 5, s.north + Math.cos(a) * 5, { maxR: 30 }); return { x: p.x, north: p.north, heading: G2.bearing(p, s) }; },
    nodes: {
      hello: { say: G2 => [{ t: `${G2.greet()}! I'm Jess, a ranger with the Department of Conservation. You're on the Milford Foreshore Walk, and that is Mitre Peak across the water, ${G2.where('mitre-peak')} of you.`, src: ['model-pois'] },
        { t: 'Some of the best views of Mitre Peak are from this walk. There may be a lot of sandflies on it too.', src: ['doc-foreshore'] }],
        choices: [
          { text: 'Is it a sound or a fiord?', go: 'fiord' },
          { text: 'Tell me about Mitre Peak.', go: 'mitre' },
          { text: 'Does it always rain here?', go: 'rain' },
          { text: 'What grows on those walls?', go: 'bush' },
          { text: 'What are those flowers on the flats?', go: 'lupins' },
          { text: 'Where should I go?', go: 'where' }] },
      fiord: { say: G2 => [{ t: 'It is called a sound, but it is a fiord: it was formed by glaciation over millions of years.', src: ['wiki-milford'] },
        { t: `It runs 15 kilometres inland from the Tasman Sea at Dale Point, ${G2.where('dale-point')} of here, between sheer rock faces that rise 1,200 m or more on either side. At its deepest it is 291 m.`, src: ['wiki-milford', 'model-pois'] },
        { t: 'Its Māori name is Piopiotahi, after the piopio, a thrush-like bird that is now extinct. As the page tells it, a single piopio flew here in mourning after Māui\'s death; tahi means "one".', src: ['wiki-milford'] },
        { t: 'The South Island piopio was last recorded in 1905. Walter Buller described the piopio\'s calls as among the most beautiful of any New Zealand bird.', src: ['wiki-piopio'] },
        { t: 'In Māori mythology, as the park\'s page has it, the fiords are the craft of Tū Te Rakiwhanoa, who carved them into the coastline to make it habitable. And Hine-nui-te-pō created the sandflies, to keep people from becoming idle here.', src: ['wiki-fiordland'] }], next: 'hello' },
      mitre: { say: G2 => {
        const top = topOf('mitre-peak'), ele = rawPoi('mitre-peak').ele_m, here = G2.here();
        return [{ t: 'Captain John Lort Stokes of HMS Acheron named it: its shape reminded him of a bishop\'s mitre. The page gives its Māori name as Rahotu. It is really five peaks grouped closely together.', src: ['wiki-mitre'] },
          top ? { t: `The page gives 1,690 m, with almost sheer drops to the water.${ele ? ` The summit on the map is tagged ${m(ele)} m.` : ''} By the heights I work from, the top stands ${m(top.h)} m.`, src: ['wiki-mitre', 'model-pois', 'model-heights'] } : null,
          top ? { t: `From where you stand its top is ${G2.km(G2.dist(here, top))} away to the ${G2.dirName(G2.bearing(here, top))}, ${angleTo(here, top).toFixed(0)}° above the horizontal.`, src: ['model-heights'] } : null,
          { t: 'Jim Dennistoun climbed it in 1911: he went on alone up steep, smooth slabs and reached the summit at a quarter past one. Donald Sutherland disputed that he got there. Painters have long been fond of it.', src: ['wiki-mitre'] }];
      }, choices: [
        { text: 'I\'ll line it up from here.', go: 'end', when: G2 => !G2.state('mitre-view'), do: G2 => G2.start('mitre-view') },
        { text: 'Back', go: 'hello' }] },
      rain: { say: G2 => [{ t: 'Nearly. Milford is known as the wettest inhabited place in New Zealand and one of the wettest in the world: 6,412 mm of rain in an average year, and up to 250 mm in 24 hours.', src: ['wiki-milford'] },
        { t: 'The rain makes dozens of temporary waterfalls down the walls. Only two run all the time: Lady Bowen Falls and Stirling Falls.', src: ['wiki-milford'] },
        { t: 'It also lies on top of the sea. The surface of the fiord is a layer of fresh water, stained with tannins from the rainforest, and it filters out much of the sunlight.', src: ['wiki-milford'] },
        { t: 'So black coral is found here as shallow as 10 m. Black corals do not need a sunlit place, and they are slow: a colony is at least 30 years old before it breeds.', src: ['wiki-milford', 'wiki-black-coral'] },
        P('discovery-centre') ? { t: `The underwater observatory, ${G2.where('discovery-centre')}, shows you the fiord 10 m down.`, src: ['wiki-milford', 'model-pois'] } : null], next: 'hello' },
      bush: { say: G2 => [{ t: 'Rainforest: mostly silver beech and mountain beech, clinging to the steep sides.', src: ['wiki-fiordland'] },
        { t: 'When enough rainwater builds up, a piece of the forest can lose its grip on the sheer rock and slide into the fiord: a tree avalanche. You can see the regrowth in several places along the walls.', src: ['wiki-milford'] },
        { t: `The red in the canopy in summer is southern rātā: a tree up to 15 m tall with masses of scarlet flowers from November to February. It's ${G2.month()}, so ${rataSeason() ? 'look for it low on the walls' : 'it is not in flower'}.`, src: ['wiki-rata', 'model-bush', 'model-sun'] },
        { t: 'Bellbirds, kākā, kea and tūī come to the flowers. Possums browse the tree, and that is its particular threat.', src: ['wiki-rata'] }], next: 'hello' },
      lupins: { say: G2 => { const near = stands().map(l => ({ l, d: G2.dist(G2.here(), l) })).sort((a, b) => a.d - b.d)[0];
        return [{ t: `Russell lupins.${near ? ` The nearest stand is ${near.d < near.l.r ? 'all round you' : `${G2.where(near.l)} of here`}.` : ''}`, src: ['model-flora'] },
          { t: `They flower from September to February, in lilac, purple, pink, white and yellow. It's ${G2.month()}, so ${lupinSeason() ? 'they are out' : 'they are only leaves now'}.`, src: ['nzpcn-lupin', 'model-sun'] },
          { t: 'They are from North America, and here they are a weed: classed as invasive, covering roadsides and riverbeds, and a threat to native species above all where they get into braided river beds.', src: ['nzpcn-lupin', 'wiki-lupin'] }]; },
        do: G2 => { if (lupinSeason() && farStand()) G2.start('lupins'); }, next: 'hello' },
      where: { say: G2 => { const st = P('stirling-falls'), seen = st && G2.lineOfSight(G2.here(), st, 1.6, 60);
        return [G2.npc('naturalist') ? { t: `Finn is the nature guide on the Piopiotahi. You'll find him at the Freshwater Basin terminal, ${G2.where('npc:naturalist')}; he can put you aboard.`, src: ['model-pois'] } : null,
          { t: `Lady Bowen Falls is ${G2.where('bowen-falls')}.${st ? ` Stirling Falls is ${G2.where('stirling-falls')}${seen ? '' : ', out of sight behind the walls from here: that one needs the boat'}.` : ''}`, src: ['model-pois', 'model-heights'] },
          P('airport') ? { t: `The airport is ${G2.where('airport')}: scenic flights by light aircraft and helicopter come and go from it.`, src: ['model-pois', 'wiki-milford'] } : null]; },
        choices: [
          { text: 'Open the map', do: G2 => G2.openPanel('map'), go: 'end' },
          { text: 'Back', go: 'hello' }] },
      lupinsDone: { say: G2 => [{ t: 'Handsome, aren\'t they? And every one of them a weed. Russell lupins were first recorded growing wild in New Zealand in 1958.', src: ['wiki-lupin', 'nzpcn-lupin'] },
        { t: 'Gravel river beds and road verges are where they take hold, and the native plants of those beds lose out.', src: ['nzpcn-lupin', 'wiki-lupin'] }], next: 'hello' }
    }
  };

  // ------------------------------------------------------------ Finn, the Piopiotahi's nature guide, at the terminal
  const shipName = (line && line.name) || 'Piopiotahi';
  // on the terminal's ground at the water's edge, looking out at the berth; the sign stands a few steps inland of him
  const finnSpot = () => { const b = P('freshwater-basin'); return land(b.x, b.north, { maxR: 150, maxSlope: 0.3, toward: P('wp-berth') || b }); };
  const finn = {
    id: 'naturalist', role: 'guide', name: 'Finn', title: `Nature guide on the ${shipName}`, gender: 'M',
    look: { character: 'R_Male_Adult_05', clip: 'Idle' },
    at: G2 => { const b = P('freshwater-basin'), w = P('wp-berth') || b; if (!b) { const s = G2.spawn(), p = land(s.x - 9, s.north - 6); return { x: p.x, north: p.north, heading: G2.bearing(p, s) }; }
      const p = finnSpot(); return { x: p.x, north: p.north, heading: G2.bearing(p, w) }; },
    nodes: {
      hello: { say: G2 => { const v = ship();
        return [{ t: `${G2.greet()}! I'm Finn, the nature guide on the ${shipName}. This is Freshwater Basin, where the cruises leave from.`, src: ['model-pois'] },
          v ? { t: `She is ${G2.where(shipAt(v))} of here just now, making ${(Math.abs(v.speed) * 1.944).toFixed(1)} knots.`, src: ['model-route'], note: false }
            : { t: 'She is not on the water today, so I can only tell you about the trip.', src: null }]; },
        choices: [
          { text: 'Where does the cruise go?', go: 'route' },
          { text: 'Tell me about the waterfalls.', go: 'falls' },
          { text: 'Will there be a rainbow at the falls?', go: 'rainbow' },
          { text: 'What animals will I see?', go: 'wildlife' },
          { text: 'Why did Cook sail past?', go: 'sea' },
          { text: 'Take me out to her.', go: 'end', when: () => !!ship() && !onShip(), do: G2 => { const v = ship(); if (!G2.state('cruise')) G2.start('cruise'); if (v) G2.boardVessel(v); } },
          { text: 'Thanks, Finn.', go: 'end' }] },
      route: { say: G2 => { const el = topOf('the-elephant'), li = topOf('the-lion');
        return [{ t: 'Out along the south wall under Mitre Peak, past Copper Point and Dale Point to the Tasman Sea, then home under the north wall: The Elephant, Stirling Falls, The Lion and Harrison Cove.', src: ['model-route'] },
          route.length > 2 && line.vmax ? { t: `Her line is ${G2.km(routeM)} long: about ${Math.round(routeM / line.vmax / 60)} minutes at her ${(line.vmax * 1.944).toFixed(0)} knots, before the stops.`, src: ['model-route'] } : null,
          { t: `By the book The Elephant is 1,517 m and The Lion 1,302 m.${el && li ? ` I make their tops ${m(el.h)} m and ${m(li.h)} m above the water.` : ''}`, src: ['wiki-milford', 'model-heights'] }]; }, next: 'hello' },
      falls: { say: G2 => [{ t: `Stirling Falls is 151 m high, named after Frederick Stirling, captain of HMS Clio.${fall('stirling-falls') && P('wp-stirling') ? ` The ship's line comes within ${G2.km(G2.dist(P('wp-stirling'), fall('stirling-falls').foot))} of its foot.` : ''}`, src: ['wiki-milford', 'model-route', 'model-fiord'] },
        dropLine('stirling-falls', 'Stirling Falls'),
        { t: `Lady Bowen Falls, Hineteawa, is ${G2.where('bowen-falls')} of here: 162 m. It is named for Diamantina Bowen, the governor's wife; he came to Milford aboard HMS Clio in 1871.`, src: ['wiki-bowen', 'model-pois'] },
        dropLine('bowen-falls', 'Lady Bowen Falls'),
        { t: 'The Bowen River behind it is 9 km long. It also makes the electricity and the drinking water for the settlement here.', src: ['wiki-bowen'] }], next: 'hello' },
      rainbow: { say: () => bowPages(), next: 'hello' },
      wildlife: { say: G2 => [{ t: `Seals, for a start: Seal Rock on the map is ${G2.where('seal-rock')}. And the fiord has the southernmost wild population of bottlenose dolphins. Humpback and southern right whales are seen more and more.`, src: ['wiki-milford', 'model-pois'] },
        { t: 'The fur seal of New Zealand is the kekeno. A male can be 2 m long and about 126 kg, and can dive for a quarter of an hour, to about 380 m. Hunting had them near extinction by the late 1800s; now there are colonies right round the South Island.', src: ['wiki-fur-seal'] },
        { t: 'The fiord is a breeding site for the Fiordland penguin, the tawaki: about 55 cm long, with a broad yellow crest that runs from the beak back over the eye. They nest among tree roots and rocks in the coastal forest.', src: ['wiki-milford', 'wiki-tawaki'] },
        { t: `There are between 2,500 and 3,000 breeding pairs, and fewer every decade since the 1950s. The best time to see them is the breeding season, July to November. It's ${G2.month()}, so ${tawakiSeason() ? 'keep an eye on the rocks under the bush' : 'you would be lucky'}.`, src: ['doc-tawaki', 'model-sun'] },
        { t: 'They are very timid, so nobody goes near the birds or their nests. And no wild seal may be touched or fed.', src: ['doc-tawaki', 'wiki-fur-seal'] }], next: 'hello' },
      sea: { say: G2 => { const w = G2.wind();
        return [{ t: `At Dale Point, ${G2.where('dale-point')} of here, the fiord meets the Tasman Sea.`, src: ['wiki-milford', 'model-pois'] },
          { t: 'European explorers overlooked it at first: the narrow entry did not look as if it led to such large bays inside. James Cook passed it by for just that reason.', src: ['wiki-milford'] },
          { t: 'And the captains of sailing ships were wary of the steep mountainsides: afraid the wind would not let them out again.', src: ['wiki-milford'] },
          { t: 'The sealer John Grono named it after Milford Haven in Wales. The page says 1823 in one place and about 1812 in another. Rudyard Kipling called it the eighth wonder of the world.', src: ['wiki-milford'] },
          w ? { t: `The wind on the water now is ${w.kn.toFixed(0)} knots from the ${G2.dirName(w.from)}.`, src: ['model-wind'], note: false } : null]; }, next: 'hello' }
    }
  };

  // ------------------------------------------------------------ what Finn calls out while you ride, by the ship's waypoints
  const peakCall = (id, name, book) => () => { const t = topOf(id); return { t: `${name}: ${book} by the book${t ? `, ${m(t.h)} m by my measure` : ''}.`, src: ['wiki-milford', 'model-heights'] }; };
  const CALLS = {
    'wp-bowen': () => { const f = fall('bowen-falls'); return { t: `Lady Bowen Falls, Hineteawa: 162 m by the book${f && f.drop !== null ? `, ${m(f.drop)} m down the wall by my measure` : ''}.`, src: ['wiki-bowen', 'model-fiord'] }; },
    'wp-mitre': () => { const t = topOf('mitre-peak'); return { t: `Mitre Peak above you: 1,690 m by the book${t ? `, ${m(t.h)} m by my measure` : ''}, almost sheer to the water.`, src: ['wiki-mitre', 'model-heights'] }; },
    'wp-copper': v => ({ t: `Seal Rock is ${G.where('seal-rock', shipAt(v))}: watch the rocks for seals.`, src: ['model-pois', 'wiki-milford'] }),
    'wp-dale': () => ({ t: 'Dale Point, where the fiord meets the Tasman Sea, 15 km from its head.', src: ['wiki-milford'] }),
    'wp-tasman': () => ({ t: 'The Tasman Sea. Cook passed this entry by: from out here it does not look as if it leads to such large bays.', src: ['wiki-milford'] }),
    'wp-elephant': peakCall('the-elephant', 'The Elephant', '1,517 m'),
    'wp-stirling': v => { const f = fall('stirling-falls'), b = f ? bow(Object.assign(shipAt(v), { up: 5 }), f) : null;
      return { t: `Stirling Falls: 151 m by the book${f && f.drop !== null ? `, ${m(f.drop)} m by my measure` : ''}.${!b ? '' : b.inSpray ? ` Look ${G.dirName(b.brg)}: the bow is in the spray.` : !b.up ? ' No bow: the sun is down.' : !b.lit ? ' No bow just now: the foot of the fall is in shadow.' : ' No bow from here just now: the spray is not 42° from the point opposite the sun.'}`, src: ['wiki-milford', 'model-fiord', 'model-bow'] }; },
    'wp-lion': peakCall('the-lion', 'The Lion', '1,302 m'),
    'wp-harrison': () => ({ t: 'Harrison Cove. The underwater observatory shows the fiord 10 m down, where the black coral grows.', src: ['wiki-milford', 'model-pois'] })
  };
  const called = new Set();
  function tick(G2) {
    const v = onShip(); if (!v || G2.dialogue()) return;
    const at = shipAt(v);
    for (const id of Object.keys(CALLS)) {
      const p = P(id); if (!p || called.has(id) || G2.dist(at, p) > 320) continue;
      called.add(id);
      const c = CALLS[id](v);
      G2.say(`${finn.name}: ${c.t}`, { secs: 11 }); G2.note(`cruise:${id}`, c.t, c.src, finn.name);
      break;
    }
  }
  function start(G2) {
    // each time you board her the calls start over; arriving aboard (scene.json spawn.aboard) starts the cruise
    G2.on((ev, v) => { if (ev === 'board' && v && v.kind === 'ship') { called.clear(); if (!G2.state('cruise')) G2.start('cruise'); } });
  }

  // ------------------------------------------------------------ signs
  const signs = [];
  if (P('foreshore')) signs.push({ id: 'foreshore', title: 'Milford Foreshore Walk',
    at: G2 => { const s = G2.spawn(), a = (s.heading - 40) * RAD, p = land(s.x + Math.sin(a) * 6, s.north + Math.cos(a) * 6, { maxR: 30 }); return { x: p.x, north: p.north, heading: G2.bearing(p, s) }; },
    nodes: { read: { say: G2 => { const sg = G2.sign('foreshore'), at = sg ? { x: sg.x, north: sg.north } : G2.here(), seen = peaksInSight(at);
      return [{ t: 'Milford Foreshore Walk. An easy loop for all ages, wheelchairs too: through beech forest and along the sandy foreshore of Milford Sound.', src: ['doc-foreshore'] },
        seen.length ? { t: `In sight from here, with their heights above the fiord: ${seen.join('; ')}.`, src: ['model-heights', 'model-pois'] } : null,
        { t: 'Fiordland National Park: 12,607 square kilometres, the largest of New Zealand\'s 13 national parks, established in 1952.', src: ['wiki-fiordland'] },
        { t: 'The park is almost half of Te Wāhipounamu, "the place of greenstone": four national parks and 26,000 square kilometres, on the World Heritage List since 1990. It holds some of the best living examples of the plants and animals of Gondwana.', src: ['wiki-fiordland', 'wiki-wahipounamu'] }]; } } } });
  if (P('freshwater-basin')) signs.push({ id: 'freshwater-basin', title: 'Freshwater Basin',
    at: G2 => { const f = finnSpot(), w = P('wp-berth') || P('freshwater-basin'), a = (G2.bearing(w, f) + 35) * RAD, p = land(f.x + Math.sin(a) * 9, f.north + Math.cos(a) * 9, { maxR: 60, maxSlope: 0.3 }); return { x: p.x, north: p.north, heading: G2.bearing(w, p) }; },
    nodes: { read: { say: G2 => { const sg = G2.sign('freshwater-basin'), at = sg ? { x: sg.x, north: sg.north } : G2.here();
      return [{ t: 'Freshwater Basin, the cruise terminal. Milford Sound draws between 550,000 and 1 million visitors a year.', src: ['model-pois', 'wiki-milford'] },
        route.length > 2 && line.vmax ? { t: `The ${shipName}'s line: ${G2.km(routeM)} out to the Tasman Sea and back, about ${Math.round(routeM / line.vmax / 60)} minutes at ${(line.vmax * 1.944).toFixed(0)} knots.`, src: ['model-route'] } : null,
        P('bowen-falls') ? { t: `Lady Bowen Falls is ${G2.where('bowen-falls', at)}. The track to it from the wharf closed in 2002, when a rock face became unstable; since 29 January 2018 a short boat service has carried walkers past that stretch.`, src: ['model-pois', 'wiki-bowen'] } : null]; } } } });

  // ------------------------------------------------------------ quests
  const quests = [
    { id: 'mitre-view', title: 'Mitre Peak from the foreshore', summary: 'Read the board on the foreshore walk and lined Mitre Peak up across the water.', hint: 'Ask Jess about Mitre Peak.',
      steps: [
        { text: 'Read the sign on the foreshore walk', target: 'sign:foreshore', on: { sign: (G2, d, id) => id === 'foreshore' } },
        { text: 'From the foreshore, turn to face Mitre Peak', target: 'mitre-peak', enter: (G2, d) => { d.t = 0; },
          tick: (G2, dt, d) => { const top = topOf('mitre-peak'); d.t = top && G2.dist(G2.here(), P('foreshore')) < 400 && facing(G2, G2.bearing(G2.here(), top), 12) ? (d.t || 0) + dt : 0; },
          check: (G2, d) => d.t >= 1.5 }],
      onDone: G2 => { const top = topOf('mitre-peak'), h = G2.here(); G2.note('mitre-view', `Mitre Peak from the foreshore walk: ${G2.km(G2.dist(h, top))} ${G2.dirName(G2.bearing(h, top))}, its top ${angleTo(h, top).toFixed(0)}° above the horizontal; ${m(top.h)} m high, measured on the ground here.`, ['model-heights', 'model-pois'], 'Jess'); } },
    { id: 'cruise', title: `To Stirling Falls on the ${shipName}`, summary: `Rode the ${shipName} down the fiord to Stirling Falls.`, hint: 'Finn, at the Freshwater Basin terminal, can put you aboard.',
      available: () => !!ship(), unavailable: `The ${shipName} is not sailing today.`,
      steps: [
        { text: `Board the ${shipName}: ask Finn at Freshwater Basin`, target: 'npc:naturalist', on: { board: (G2, d, v) => !!v && v.kind === 'ship' }, check: () => !!onShip() },
        { text: G2 => { const v = onShip(), p = P('wp-stirling'); return `Ride her to Stirling Falls${v && p ? ` (${G2.km(G2.dist(shipAt(v), p))} from her now)` : ''}; V changes the view`; },
          target: G2 => { const f = fall('stirling-falls'); return f ? { x: f.foot.x, north: f.foot.north, name: 'Stirling Falls' } : P('wp-stirling'); },
          tick: G2 => { if (!onShip()) G2.advance('cruise', 0); },
          check: () => { const v = onShip(), f = fall('stirling-falls'), w = P('wp-stirling'); return !!v && ((!!w && G.dist(shipAt(v), w) < 200) || (!!f && G.dist(shipAt(v), f.foot) < 300)); } }],
      onDone: G2 => { const v = onShip(), f = fall('stirling-falls'), b = v && f ? bow(Object.assign(shipAt(v), { up: 5 }), f) : null;
        G2.note('cruise', `At Stirling Falls on the ${shipName} at ${G2.clock()}${f && f.drop !== null ? `: the water falls ${m(f.drop)} m` : ''}${b && b.up ? `; the sun ${Math.round(b.alt)}° up in the ${G2.dirName(b.az)}, ${b.inSpray ? 'a bow in the spray' : 'no bow in the spray'}` : ''}.`, ['model-fiord', 'model-bow'], 'Finn'); } },
    { id: 'lupins', title: 'Lupins on the river flats', summary: 'Walked among the lupins on the flats, and heard what they are.', hint: 'Ask Jess about the flowers on the flats (September to February).',
      available: () => lupinSeason() && !!farStand(), unavailable: 'Russell lupins flower from September to February (New Zealand Plant Conservation Network).',
      steps: [
        { text: 'Walk to the stand of lupins on the flats', target: () => farStand(), check: G2 => { const l = farStand(); return !!l && G2.dist(G2.here(), l) < Math.max(25, l.r * 0.6); } },
        { text: 'Tell Jess', target: 'npc:ranger', talkTo: 'ranger', node: 'lupinsDone' }] }
  ];

  return { sources: SOURCES, npcs: [jess, finn], signs, quests, tick, start };
}
