// Lake Pukaki and Aoraki / Mount Cook (scene.json pois: peters-lookout, visitor-centre, glentanner-helipad,
// white-horse-hill, hooker-lake-view, aoraki ...).
//   Hana, a Department of Conservation ranger, at Peter's Lookout by the spawn: the lake (its colour, its size and
//     levels, the hydro storage, the drowned island on the old five-pound note), Aoraki (its height and summits, how
//     far it is from here over the model), the lupins in their season
//   Tom, a stargazing guide, on the south shore by the visitor centre: the dark-sky reserve, tonight's dark (sunset,
//     moonrise, how high the Milky Way's centre stands, computed from the sky the viewer draws)
//   Mia, a helicopter pilot, by the pad at Glentanner: the Tasman Glacier, a scenic flight round Aoraki
//   Eli, a walker, at White Horse Hill: the Hooker Valley Track
//   Signs: Peter's Lookout (what stands in sight over the model's terrain), the Alpine Memorial
//   Quests: the view from Peter's Lookout, lupins on the shore (in their season), Aoraki from the air, the Hooker
//   Valley, a dark night on the south shore.
// No character speaks as or for Ngāi Tahu: Aoraki's place in their tradition is left to sources this file could
// not read in full (docs/cities/lake-pukaki.md).
import { standNear } from './generic.js';

const SOURCES = {
  'wiki-pukaki': { title: 'Lake Pukaki', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Lake_Pukaki', checked: '2026-11-05',
    says: 'the largest of three roughly parallel alpine lakes along the northern edge of the Mackenzie Basin; formed when the terminal moraines of receding glaciers blocked the valley; the blue colour is from glacial flour, extremely finely ground rock particles from the glaciers; 178.7 km2; surface normally 518.2 to 532 m above sea level; fed by the braided Tasman River from the Tasman and Hooker glaciers; Ben Dhu (1,607 m) and Betty Hill (1,601 m) on the Ben Ohau Range to the west; views of Aoraki 70 km to the north from the southern shore; raised by 9 m in 1952 and 37 m in 1976, submerging Five Pound Note Island; an operating range of 13.8 m, 1,595 GWh of storage; with Tekapo over half of New Zealand\'s hydroelectric storage; the island Te Kohai on the second-series five pound note, 1940-1967, from a 1934 photograph by Bobbie Barwell; State Highway 80 runs along the western shore to Mount Cook Village' },
  'lakes380-pukaki': { title: 'Lake Pukaki datasheet', publisher: 'Our Lakes Our Future (Lakes380)', url: 'https://ourlakesourfuture.co.nz/lakes/lake-pukaki/', checked: '2026-11-05',
    says: 'depth 70 metres; area 17,274 hectares; Aoraki / Mount Cook can be seen 70 kilometres away from the southern shore on a clear day' },
  'wiki-aoraki': { title: 'Aoraki / Mount Cook', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Aoraki_/_Mount_Cook', checked: '2026-11-05',
    says: 'the highest mountain in New Zealand, 3,724 m as of 2014; three summits from south to north, the Low Peak (3,593 m), the Middle Peak (3,717 m) and the High Peak; slightly south and east of the Main Divide, the Tasman Glacier to the east and the Hooker Glacier to the south-west; the park, established in 1953, has more than 140 peaks over 2,000 m and 72 named glaciers covering 40 percent of its 700 km2; visible from most of State Highway 80 along Lake Pukaki; the lookout at the end of the Hooker Valley Track is about 10 km from the peak; the near-horizontal summit ridge forms a blocky shape from the east or west; moist westerlies bring orographic rain and snow, heaviest around 1,200 m' },
  'wiki-tasman-glacier': { title: 'Tasman Glacier', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Tasman_Glacier', checked: '2026-11-05',
    says: 'officially Haupapa / Tasman Glacier, the largest glacier in New Zealand; 23.5 km long, up to 4 km wide and 600 m thick, 101 km2, starting at 3,000 m; the upper reaches snow-covered, the lower glacier entirely rock-covered, which insulates the ice; its terminal lake drains to the braided Tasman River, which flows south into Lake Pukaki' },
  'wiki-hooker-track': { title: 'Hooker Valley Track', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Hooker_Valley_Track', checked: '2026-11-05',
    says: 'the most popular short walk in the park; 5 km long and climbing only about 100 m; views of Aoraki and the proglacial Hooker Lake, typically with icebergs; the lookout at the end is the closest any walking track comes to Aoraki; open alpine tussock; starts at the White Horse Hill camping ground, about 4 km from Mount Cook Village; passes the Alpine Memorial, whose plaque reads "To the memory of mountaineers and guides lost to the hills", and overlooks the lake of the Mueller Glacier; crosses the Hooker River on three bridges; named by Julius von Haast after the botanist William Jackson Hooker' },
  'wiki-dark-sky': { title: 'Aoraki Mackenzie International Dark Sky Reserve', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Aoraki_Mackenzie_International_Dark_Sky_Reserve', checked: '2026-11-05',
    says: '4,367 km2, designated by the International Dark-Sky Association in June 2012; it includes Aoraki / Mount Cook National Park, the Mackenzie Basin, Lake Pukaki and Lake Tekapo; level 2 on the nine-level Bortle scale; supported by a lighting by-law in the Mackenzie District Plan since 1981; the Mount John University Observatory is in the reserve' },
  'nzpcn-lupin': { title: 'Lupinus polyphyllus', publisher: 'New Zealand Plant Conservation Network', url: 'https://nzpcn.org.nz/flora_details.asp?ID=3144', checked: '2026-11-05',
    says: 'Russell lupin, naturalised; flowers September to February in lilac, purple, red and pink, white and yellow; invasive on gravel riverbeds and road verges' },
  'model-sky': { title: 'The night sky', model: true, what: 'web/reef/alpine/atmos.js: the sky\'s rotation for the clock and the place (sidereal time), the Milky Way laid on the J2000 galactic plane' },
  'model-lake': { title: 'The lake in this model', model: true, what: 'scene.json lakes: each lake\'s surface from the LiDAR\'s flattened water (pipeline/build_alpine.py), the main lake the viewer\'s water level' }
};

export default function lakePukaki(G) {
  const P = id => G.poi(id);
  const datum = G.S.terrain.datum_m || 0;
  const asl = h => Math.round(h + datum);
  const lake = (G.S.lakes || []).find(l => l.main);
  // stand on dry ground near a POI, at any height (an alpine site's people are not on a beach)
  const near = (id, o = {}) => G2 => {
    const p = P(id); if (!p) return G2.spawn();
    const s = G2.landSpot(p.x + (o.dx || 0), p.north + (o.dn || 0), { maxSlope: 0.35, maxR: o.maxR || 120, toward: o.toward ? P(o.toward) : p });
    return Object.assign(s || standNear(G2, p.x, p.north), { heading: o.face ? G2.bearing(s || p, P(o.face)) : (o.heading ?? 0) });
  };
  const sunsetLine = G2 => { const s = G2.sunset(); return { t: `Sunrise today was at ${G2.time(s.rise)}; the sun sets at ${G2.time(s.set)}.`, src: ['model-sun'] }; };
  // the galactic centre's height and direction now, from the same sky the viewer draws
  function coreNow(G2) {
    const atm = G2.ctx.atm; if (!atm) return null;
    const M = atm.u.eq.value.clone().transpose();          // equatorial -> local (an orthonormal matrix's inverse)
    const ra = (17 + 45.6 / 60) / 12 * Math.PI, dec = -29.0 * Math.PI / 180;
    const e = new G2.THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(M);
    const alt = Math.asin(Math.max(-1, Math.min(1, e.y))) * 180 / Math.PI, az = (Math.atan2(e.x, -e.z) * 180 / Math.PI + 360) % 360;
    return { alt, az };
  }

  // ------------------------------------------------------------ Hana, the ranger at Peter's Lookout
  const hana = {
    id: 'ranger', role: 'ranger', name: 'Hana', title: 'Department of Conservation ranger', gender: 'W',
    at: near('peters-lookout', { dx: 6, dn: 4, face: 'aoraki' }),
    nodes: {
      hello: { say: G2 => {
        const a = P('aoraki'), here = G2.here();
        return [{ t: `${G2.greet()}! I'm Hana, with the Department of Conservation. This is Tapataia Mahaka, Peter's Lookout, above the west shore of Lake Pukaki.`, src: ['model-pois'] },
          a ? { t: `That white block at the head of the lake is Aoraki / Mount Cook, ${G2.km(G2.dist(here, a))} ${G2.dirName(G2.bearing(here, a))} of us over the model's terrain.`, src: ['model-terrain', 'model-pois'] } : null];
      }, choices: [
        { text: 'Why is the lake that colour?', go: 'colour' },
        { text: 'Tell me about Aoraki.', go: 'aoraki' },
        { text: 'How big is the lake?', go: 'lake' },
        { text: 'Are those lupins?', go: 'lupins' },
        { text: 'What can I do here?', go: 'todo' }] },
      colour: { say: [
        { t: 'Glacial flour: rock ground to a powder under the Tasman and Hooker glaciers, carried down the braided Tasman River and held in the water.', src: ['wiki-pukaki'] },
        { t: 'The lake itself is dammed by the moraine the old glacier left when it retreated, like Tekapo and Ōhau.', src: ['wiki-pukaki'] }], next: 'hello' },
      aoraki: { say: G2 => {
        const a = P('aoraki');
        return [{ t: 'New Zealand\'s highest mountain: 3,724 m since the 2014 survey. Three summits along that flat ridge, the Low Peak, the Middle Peak and the High Peak.', src: ['wiki-aoraki'] },
          a ? { t: `In this model its top stands ${asl(G2.height(a.x, a.north))} m above sea level, on LINZ's LiDAR averaged to a ${G2.S.terrain.cell_m} m grid, so the sharpest point is rounded off.`, src: ['model-terrain'] } : null,
          { t: 'You can see it from most of State Highway 80 along the lake. Cloud often sits on it: the westerlies off the Tasman Sea hit the Alps there first.', src: ['wiki-aoraki'] }];
      }, next: 'hello' },
      lake: { say: G2 => [
        { t: 'About 179 square kilometres and 70 m deep at its deepest.', src: ['wiki-pukaki', 'lakes380-pukaki'] },
        { t: 'It is a hydro lake now: raised 9 m in 1952 and 37 m in 1976, and run over a 13.8 m range, from 518.2 to 532 m. With Tekapo it holds over half of New Zealand\'s hydro storage.', src: ['wiki-pukaki'] },
        lake ? { t: `In this model the surface is at ${lake.level_nzvd.toFixed(1)} m, where the LiDAR found it.`, src: ['model-lake'] } : null,
        { t: 'The 1976 raising drowned Te Kohai, the island on the old five-pound note: from a 1934 photograph by Bobbie Barwell.', src: ['wiki-pukaki'] }], next: 'hello' },
      lupins: { say: G2 => {
        const m = G2.monthIndex(), on = m >= 8 || m <= 1;
        return [{ t: 'Russell lupins. They are not native: naturalised, and invasive on the gravel riverbeds and road verges.', src: ['nzpcn-lupin'] },
          { t: `They flower from September to February, purple and lilac, pink, white and a few yellow. It's ${G2.month()}${on ? ', so look along the shore and the verges.' : ', so they are only leaves now.'}`, src: ['nzpcn-lupin', 'model-sun'] }];
      }, choices: [{ text: 'I\'ll go down to the shore.', do: G2 => G2.start('lupins'), go: 'end', when: G2 => !G2.state('lupins') }, { text: 'Back', go: 'hello' }] },
      todo: { say: G2 => [
        { t: 'Read the board and line Aoraki up over the lake: that is the photograph everyone stops for here.', src: null },
        { t: `Mia flies scenic flights from Glentanner, ${G2.where('glentanner-helipad')}. The Hooker Valley Track starts at White Horse Hill, ${G2.where('white-horse-hill')}.`, src: ['model-pois'] },
        { t: `Tom runs stargazing on the south shore, ${G2.where('visitor-centre')}.`, src: ['model-pois'] }],
        choices: [
          { text: 'Line up the view.', do: G2 => G2.start('view'), go: 'end', when: G2 => !G2.state('view') },
          { text: 'I\'d like to fly round Aoraki.', do: G2 => G2.start('flight'), go: 'end', when: G2 => !G2.state('flight') },
          { text: 'Open the map', do: G2 => G2.openPanel('map'), go: 'end' },
          { text: 'Back', go: 'hello' }] }
    }
  };

  // ------------------------------------------------------------ Tom, stargazing guide on the south shore
  const tom = {
    id: 'stargazer', role: 'guide', name: 'Tom', title: 'Stargazing guide', gender: 'M',
    at: near('view-of-mt-cook', { dx: 8, dn: -6, face: 'aoraki' }),
    nodes: {
      hello: { say: G2 => [
        { t: `${G2.greet()}! I'm Tom. I take people out to see the night sky here: this is all inside the Aoraki Mackenzie International Dark Sky Reserve.`, src: ['wiki-dark-sky'] },
        sunsetLine(G2)],
        choices: [{ text: 'How dark does it get?', go: 'dark' }, { text: 'What will be up tonight?', go: 'tonight' }, { text: 'Can we wait for dark?', go: 'wait', when: G2 => G2.sunNow().alt > -12 }, { text: 'Thanks, Tom.', go: 'end' }] },
      dark: { say: [
        { t: '4,367 square kilometres, made a reserve by the International Dark-Sky Association in June 2012: the national park, the basin, Pukaki and Tekapo.', src: ['wiki-dark-sky'] },
        { t: 'It rates 2 on the nine-step Bortle scale: a truly dark site. The district has had a lighting by-law since 1981.', src: ['wiki-dark-sky'] }], next: 'hello' },
      tonight: { say: G2 => {
        const c = coreNow(G2), mr = G2.moonrise(G2.nowMs());
        return [c ? (c.alt > 0 ? { t: `Right now the centre of the Milky Way, in Sagittarius, is ${Math.round(c.alt)}° up in the ${G2.dirName(c.az)}.`, src: ['model-sky', 'model-sun'] }
          : { t: `Right now the centre of the Milky Way, in Sagittarius, is below the horizon (${Math.round(c.alt)}°, toward the ${G2.dirName(c.az)}).`, src: ['model-sky', 'model-sun'] }) : null,
          mr ? { t: `The moon rises at ${G2.time(mr)}${G2.moonAlt(G2.nowMs()) > 0 ? ', and it is up now' : ''}.`, src: ['model-sun'] } : null,
          { t: 'The Magellanic Clouds never set here: look south, away from the mountains.', src: ['model-sky'] }];
      }, next: 'hello' },
      wait: { say: G2 => [{ t: 'Let\'s come back an hour after sunset.', src: null }], do: G2 => { const s = G2.sunset(); G2.start('dark'); G2.skipTo(s.set + 75 * 60e3); }, next: 'end' }
    }
  };

  // ------------------------------------------------------------ Mia, pilot at Glentanner
  const heli = () => G.vessels().find(v => v.kind === 'helicopter' && v.mode !== 'orbit');
  const mia = {
    id: 'pilot', role: 'pilot', name: 'Mia', title: 'Helicopter pilot', gender: 'W',
    at: G2 => { const h = heli(); const p = h ? { x: h.x + 9, north: -h.z + 5 } : P('glentanner-helipad'); const s = G2.landSpot(p.x, p.north, { maxR: 60, maxSlope: 0.25 }) || p; return Object.assign(s, { heading: h ? G2.bearing(s, { x: h.x, north: -h.z }) : 0 }); },
    nodes: {
      hello: { say: G2 => [
        { t: `${G2.greet()}! I'm Mia. I fly scenic flights up the Tasman Valley from here.`, src: null },
        { t: `Aoraki is ${G2.km(G2.dist(G2.here(), P('aoraki')))} ${G2.dirName(G2.bearing(G2.here(), P('aoraki')))} of the pad, up the Tasman Glacier.`, src: ['model-pois'] }],
        choices: [{ text: 'Tell me about the glacier.', go: 'glacier' }, { text: 'Can I fly?', do: G2 => { if (!G2.state('flight')) G2.start('flight'); }, go: 'fly' }, { text: 'Thanks, Mia.', go: 'end' }] },
      glacier: { say: [
        { t: 'Haupapa / Tasman Glacier is the biggest in New Zealand: 23.5 km long, up to 4 km wide and 600 m thick, from 3,000 m down.', src: ['wiki-tasman-glacier'] },
        { t: 'The lower glacier is all rock-covered, which slows the melt. It ends in its own lake, and that drains down the braided Tasman River into Pukaki.', src: ['wiki-tasman-glacier'] }], next: 'hello' },
      fly: { say: 'She\'s fuelled. E by the door, Space to climb, and fly her up the valley; F once you\'re back on the ground.', next: 'end' }
    }
  };

  // ------------------------------------------------------------ Eli, at White Horse Hill
  const eli = {
    id: 'walker', role: 'walker', name: 'Eli', title: 'Walker on the Hooker Valley Track', gender: 'M',
    at: near('white-horse-hill', { dx: 10, dn: 6, face: 'hooker-lake-view' }),
    nodes: {
      hello: { say: G2 => [
        { t: `${G2.greet()}. Off up the Hooker Valley? It's 5 km and only about 100 m of climb, all open tussock.`, src: ['wiki-hooker-track'] },
        { t: `The lake at the end is ${G2.where('hooker-lake-view')}. It's the closest any track gets to Aoraki: about 10 km from the summit.`, src: ['model-pois', 'wiki-aoraki'] }],
        choices: [{ text: 'What will I see on the way?', go: 'way' }, { text: 'Let\'s walk it.', do: G2 => G2.start('hooker'), go: 'end', when: G2 => !G2.state('hooker') }, { text: 'Thanks.', go: 'end' }] },
      way: { say: [
        { t: 'Past the Alpine Memorial, over the Mueller Glacier\'s lake, then three bridges across the Hooker River.', src: ['wiki-hooker-track'] },
        { t: 'Hooker Lake usually has icebergs in it. Haast named all of it after the botanist William Jackson Hooker.', src: ['wiki-hooker-track'] }], next: 'hello' }
    }
  };

  // ------------------------------------------------------------ signs
  const lookoutSign = {
    id: 'peters-lookout', title: 'Tapataia Mahaka / Peter\'s Lookout',
    at: G2 => { const p = P('peters-lookout'); const s = G2.landSpot(p.x, p.north, { maxR: 40, maxSlope: 0.3 }) || p; return { x: s.x, north: s.north, heading: 0 }; },
    nodes: { read: { say: G2 => {
      const sg = G2.sign('peters-lookout'), at = sg ? { x: sg.x, north: sg.north } : P('peters-lookout');
      const seen = [];
      for (const id of ['aoraki', 'mt-tasman', 'mt-sefton', 'ben-dhu', 'betty-hill', 'mt-haidinger', 'malte-brun']) {
        const p = P(id); if (!p) continue;
        if (G2.lineOfSight(at, p, 1.6, 30)) seen.push(`${p.name}, ${asl(G2.height(p.x, p.north))} m, ${G2.km(G2.dist(at, p))} ${G2.dirName(G2.bearing(at, p))}`);
      }
      return [{ t: 'Tapataia Mahaka / Peter\'s Lookout, as mapped.', src: ['model-pois'] },
        { t: `This board stands ${asl(G2.height(at.x, at.north))} m above sea level, ${Math.round(G2.height(at.x, at.north))} m above the lake's surface in this model.`, src: ['model-terrain', 'model-lake'] },
        seen.length ? { t: `In sight from here over the model's terrain: ${seen.slice(0, 5).join('; ')}.`, src: ['model-terrain', 'model-pois'] } : null];
    } } } };
  const memorial = P('alpine-memorial') ? {
    id: 'alpine-memorial', title: 'Alpine Memorial',
    at: G2 => { const p = P('alpine-memorial'); const s = G2.landSpot(p.x, p.north, { maxR: 30, maxSlope: 0.3 }) || p; return { x: s.x, north: s.north, heading: 30 }; },
    nodes: { read: { say: [{ t: '"To the memory of mountaineers and guides lost to the hills."', src: ['wiki-hooker-track'] },
      { t: 'The memorial looks over the lake of the Mueller Glacier.', src: ['wiki-hooker-track'] }] } } } : null;

  // ------------------------------------------------------------ quests
  const facing = (G2, id, tol) => { const p = P(id); if (!p) return false; const want = G2.bearing(G2.here(), p), have = ((G2.player.S.camYaw * -180 / Math.PI) % 360 + 360) % 360; const d = Math.abs(((want - have) % 360 + 540) % 360 - 180); return d < tol; };
  const quests = [
    { id: 'view', title: 'The view up the lake', summary: 'Read the board at Peter\'s Lookout and lined Aoraki up over the lake.', hint: 'Ask Hana what to do at the lookout.',
      steps: [
        { text: 'Read the board at Peter\'s Lookout', target: 'sign:peters-lookout', on: { sign: (G2, d, id) => id === 'peters-lookout' } },
        { text: 'Turn to face Aoraki over the lake', target: 'aoraki', check: G2 => G2.dist(G2.here(), P('peters-lookout')) < 300 && facing(G2, 'aoraki', 12) }] },
    { id: 'lupins', title: 'Lupins on the shore', summary: 'Walked down from the lookout to the lake shore.', hint: 'Ask Hana about the lupins.',
      steps: [{ text: 'Walk down to the shore below the lookout', target: G2 => { const p = P('peters-lookout'); for (let r = 50; r < 1500; r += 25) for (const a of [90, 70, 110, 50, 130]) { const x = p.x + Math.sin(a * Math.PI / 180) * r, n = p.north + Math.cos(a * Math.PI / 180) * r; if (G2.depth(x, n) > 0) return { x: x - 20, north: n, name: 'the shore' }; } return p; },
        check: G2 => { const h = G2.here(); for (let a = 0; a < 6.28; a += 0.52) if (G2.depth(h.x + Math.cos(a) * 25, h.north + Math.sin(a) * 25) > 0) return G2.dist(h, P('peters-lookout')) < 2500; return false; } }] },
    { id: 'flight', title: 'Aoraki from the air', summary: 'Flew from Glentanner up the Tasman Valley and round Aoraki.', hint: 'Talk to Mia at Glentanner.',
      steps: [
        { text: 'Take the helicopter', target: () => { const h = heli(); return h ? { x: h.x, north: -h.z, name: h.name } : null; }, on: { board: (G2, d, v) => v.kind === 'helicopter' } },
        { text: 'Fly within 2 km of Aoraki\'s summit, above 3,000 m', target: 'aoraki', check: G2 => { const v = G2.aboard(); return !!v && v.y + datum > 3000 && G2.dist({ x: v.x, north: -v.z }, P('aoraki')) < 2000; } },
        { text: 'Fly back, land and step out (F)', target: 'glentanner-helipad', on: { leave: () => true } }] },
    { id: 'hooker', title: 'The Hooker Valley', summary: 'Walked the Hooker Valley Track to the lake below Aoraki.', hint: 'Talk to Eli at White Horse Hill (the map can take you there).',
      steps: [
        { text: 'Walk to the Alpine Memorial', target: 'alpine-memorial', check: G2 => G2.dist(G2.here(), P('alpine-memorial')) < 60 },
        { text: 'Cross the Hooker River on the bridges', target: 'upper-hooker-bridge', check: G2 => G2.dist(G2.here(), P('upper-hooker-bridge')) < 80 },
        { text: 'Reach the Hooker Lake viewpoint', target: 'hooker-lake-view', check: G2 => G2.dist(G2.here(), P('hooker-lake-view')) < 80 }] },
    { id: 'dark', title: 'A dark night', summary: 'Stood on the south shore under the dark-sky reserve\'s night.', hint: 'Tom on the south shore can wait for dark with you.',
      steps: [{ text: 'Be on the south shore after nautical dusk', target: 'view-of-mt-cook', check: G2 => G2.sunNow().alt < -12 && G2.dist(G2.here(), P('view-of-mt-cook')) < 800 }] }
  ];

  return { sources: SOURCES, quests, signs: [lookoutSign, memorial].filter(Boolean), npcs: [hana, tom, mia, eli] };
}
