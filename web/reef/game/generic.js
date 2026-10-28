// What any reef site gets, and the pieces the site files reuse: a ranger at the spawn who knows the model
// (its size, how much of it is sea, how deep, how clear), the fish ID survey, the reef health facts, stinger
// advice where Surf Life Saving Queensland's season applies, and the slate that works out where the red
// light went at your depth. Every line is computed from the model or cites game/sources.js.
const BUSTARD_HEADS_LAT = -24.02;      // SLSQ's stinger range runs from Bustard Heads (north of Bundaberg) northward

// ---- the tide now and its next turn, from the site's tide model (main.js ctx.tide; the gauge's predictions)
export function tidePage(G, src = 'model-tide') {
  const T = G.tide(); if (!T) return null;
  const z = G.tideNow(), n = G.tideTurns(1)[0], f = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} m`;
  return { t: `It's ${G.clock()}. The tide is ${f(z)} and ${T.rising(G.nowMs()) ? 'rising' : 'falling'}${n ? `; ${n.high ? 'high' : 'low'} water ${f(n.z)} at ${G.time(n.t)}` : ''}, by the ${T.gauge || 'nearest gauge'} predictions.`, src: [src, 'model-sun'], note: false };
}

// ---- the land around a point above mean sea level: a flood fill over the terrain grid (the cays are rebuilt from their
// mapped outlines, so this is the mapped island's area), in hectares; null if the point is not on land
export function landArea(G, x, n) {
  const d = G.ctx.d, t = d.scene.terrain, hs = d.heights, W = t.w, H = t.h;
  const i0 = Math.floor((x - t.x0) / t.cell_m), j0 = Math.floor((t.y1 - n) / t.cell_m);
  if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H || hs[j0 * W + i0] <= 0) return null;
  const seen = new Uint8Array(W * H), stack = [j0 * W + i0]; seen[stack[0]] = 1;
  let cells = 0;
  while (stack.length && cells < 200000) {
    const k = stack.pop(); cells++;
    const i = k % W, j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const kk = b * W + a; if (!seen[kk] && hs[kk] > 0) { seen[kk] = 1; stack.push(kk); }
    }
  }
  return cells * t.cell_m * t.cell_m / 1e4;
}

// ---- other sites' water optics (their scene.json), for comparing the water here with elsewhere
export function loadOptics(G, ids) {
  G._optics = G._optics || {};
  for (const id of ids) if (!(id in G._optics)) {
    G._optics[id] = null;
    fetch(new URL(`../../data/${id}/scene.json`, import.meta.url)).then(r => r.ok ? r.json() : null).then(s => { if (s && s.optics) G._optics[id] = { name: s.name, optics: s.optics }; }).catch(() => {});
  }
}
// the deep water's colour seen from the satellite (Rinf, blue over green) at another site, and the optics in use here
// (env.u.K and env.u.Rinf, what the renderer draws with) in the same [red, green, blue] form as scene.json
export function blueness(o) { return o && o.Rinf ? o.Rinf[2] / o.Rinf[1] : null; }
export function opticsHere(G) { const K = G.env.u.K.value, R = G.env.u.Rinf.value; return { K: [K.x, K.y, K.z], Rinf: [R.x, R.y, R.z] }; }

// ---- what you can see from a spot: named places of the given kinds within `range`, with a clear line over the model's
// terrain and the Earth's curve (an island or peak is aimed at the highest ground within 300 m of its point, the rest at
// 2 m above the ground or the sea), nearest first
const SHOW = new Set(['beach', 'bay', 'inlet', 'island', 'peak', 'lookout', 'marina']);
export function inSight(G, from, skip, o = {}) {
  const kinds = o.kinds || SHOW, out = [];
  for (const raw of G.S.pois || []) {
    const p = G.poi(raw.id);
    if (!kinds.has(p.kind) || p.id === skip || (o.exclude && o.exclude.includes(p.id))) continue;
    const d = G.dist(from, p); if (d < (o.min ?? 150) || d > (o.range ?? 7000)) continue;
    let up = 2;
    if (p.kind === 'island' || p.kind === 'peak') { const h0 = Math.max(G.height(p.x, p.north), G.tideNow()); let top = h0; for (let r = 50; r <= 300; r += 50) for (let a = 0; a < 6.283; a += 0.785) top = Math.max(top, G.height(p.x + Math.cos(a) * r, p.north + Math.sin(a) * r)); up = top - h0 + 2; }
    if (G.lineOfSight(from, p, 1.6, up)) out.push({ p, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, o.max ?? 4).map(x => `${x.p.name}, ${G.km(x.d)} ${G.dirName(G.bearing(from, x.p))}`);
}

// ---- standing room: dry land near a point, else the site's pontoon deck, else afloat at the surface (no-land sites)
// people stay dry through the tide: above the highest water the site's tide model gives over the next fortnight (computed
// once, hourly), or 0.6 m above mean sea level where there is no tide model
export function highWater(G) {
  if (G._highWater !== undefined) return G._highWater;
  const T = G.tide(); let hi = null;
  if (T) { const t0 = G.nowMs(); hi = -1e9; for (let h = 0; h < 15 * 24; h++) hi = Math.max(hi, T.at(t0 + h * 3600e3)); }
  return (G._highWater = hi);
}
export function standNear(G, x, n, o = {}) {
  const hw = highWater(G), dry = hw === null ? 0.6 : hw + 0.15;
  const p = G.landSpot(x, n, Object.assign({ msl: true, minH: dry, maxH: dry + 6, maxSlope: 0.3, maxR: 80, orNull: true }, o));
  if (p) return { x: p.x, north: p.north };
  const pt = G.boats && G.boats.pontoon;
  if (pt) return { vessel: pt, local: o.deck || [12.5, 0.55, -2.8] };
  return { x: x + 3, north: n + 3, up: G.tideNow() - 0.3, depth: 0.3, swim: true };
}

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
  { t: 'The Great Barrier Reef is over 2,900 reefs and 900 islands along 2,300 km, with about 400 species of coral and more than 1,500 species of fish.', src: ['wiki-gbr'] }
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

// ---- the fish ID survey: log species you get within a few metres of, with a mask on. Only animals can be logged
// (life.js nearestCreature returns fish, sharks, rays, turtles and giant clams), so the count comes from those
export const animals = G => G.species().filter(s => !s.group || /^(fish|shark|ray|turtle|clam)$/.test(s.group));
export const surveySize = (G, max = 5) => Math.min(max, animals(G).length);
export function surveyQuest(o = {}) {
  const giver = o.giver || 'ranger', max = o.max || 5;
  const kit = G => { const k = G.player && G.player.kit; return k ? { x: k.position.x, north: -k.position.z, name: 'Dive kit' } : null; };
  return {
    id: 'survey', title: 'Fish ID survey', summary: G => `Logged ${G.logged()} species for the survey.`, hint: `Ask the ${o.giverName || 'ranger'} about the fish ID survey.`,
    available: G => animals(G).length > 0, unavailable: 'Marine life is not in this build of the model yet, so there is nothing to survey.',
    steps: [
      { text: 'Put a mask on: E at the dive kit', target: kit, enter: (G, d) => { d.n = surveySize(G, max); }, check: G => G.player.S.gear.mask },
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
    id: 'ranger', role: o.role || 'ranger', name: o.name || 'Alex', title: o.title || 'Marine park ranger', gender: o.gender || 'W',
    at: o.at || (G2 => {
      const s = G2.spawn(), h = s.heading * Math.PI / 180, fx = Math.sin(h), fn = Math.cos(h), rx = Math.cos(h), rn = -Math.sin(h);
      const want = { x: s.x + fx * 6 + rx * 3, north: s.north + fn * 6 + rn * 3 };
      const p = standNear(G2, want.x, want.north, { toward: want });
      return Object.assign(p, { heading: p.vessel ? 0 : G2.bearing(p, s) });
    }),
    nodes: Object.assign({
      hello: { say: G2 => [
        { t: `${G2.greet()}! I'm ${o.name || 'Alex'}, the ranger here. Welcome to ${G2.S.name}.`, src: null }, tidePage(G2),
        { t: `This model is ${st.wKm.toFixed(0)} by ${st.hKm.toFixed(0)} km. At this tide ${st.wetPct}% of it is sea, down to ${st.deepest} m, and the highest ground is ${st.highest} m.`, src: ['model-terrain'] }],
        choices: [
          { text: 'Is it safe to swim?', go: 'swim', when: slsqApplies },
          { text: 'How is the reef doing?', go: 'reef', when: G2 => G2.S.kind === 'marine' },
          { text: 'Can I help with a survey?', go: 'survey', when: G2 => hasLife(G2) && !G2.state('survey') },
          { text: 'Where else can I go?', go: 'travel' }] },
      swim: { say: G2 => slsqPages(G2), next: 'hello' },
      reef: { say: reefPages, next: 'hello' },
      survey: { say: G2 => [{ t: `Yes please. Put a mask on, snorkel over the reef and log ${surveySize(G2)} species you can get within a few metres of. E when you're close.`, src: ['model-life'] }],
        do: G2 => G2.start('survey'), next: 'end' },
      surveyDone: surveyDoneNode(),
      travel: { say: 'The other Queensland reef sites are on the map: T, or the Map button.', do: null, choices: [{ text: 'Open the map', do: G2 => G2.openPanel('map'), go: 'end' }, { text: 'Thanks', go: 'end' }] }
    }, o.nodes || {})
  };
}

// ---- a guided dive: the instructor waits under water at `depth`, the slate works out the light left there, then you
// come up. o: { id, title, summary, hint, giver (npc id), giverName, gender, depth, point(G) -> { x, north, name },
// extra(G, depth) -> more slate pages }. resume(G) puts the instructor back under water after a reload mid-dive.
export function diveQuest(o) {
  const diverId = `${o.giver}-diving`, depth = o.depth || 8;
  const spawnDiver = G => {
    if (G.npc(diverId)) return;
    const d = o.point(G); if (!d) return;
    G.spawnNpc({ id: diverId, role: 'diveInstructor', name: o.giverName, gender: o.gender || 'M', talk: false,
      at: () => ({ x: d.x, north: d.north, up: G.tideNow() - (depth - 0.4), depth: depth - 0.4, swim: true, heading: 0 }) });
  };
  const quest = {
    id: o.id, title: o.title, summary: o.summary, hint: o.hint,
    steps: [
      { text: `Dive to ${depth} m and meet ${o.giverName}`, target: G => o.point(G), enter: G => spawnDiver(G),
        check: G => G.player.state === 'scuba' && G.player.depth >= depth - 0.6 && G.dist(G.here(), o.point(G)) < 60 },
      { text: 'Read the slate, then come up slowly: safety stop at 5 m', enter: G => {
        G.openDialogue({ name: o.giverName, role: 'Dive instructor, writing on a slate', id: 'slate' },
          { slate: { say: G2 => [...slatePages(G2, G2.player.depth), ...(o.extra ? o.extra(G2, G2.player.depth) : []), { t: 'Thumbs up: up we go, slowly. Three minutes at 5 metres.', src: null }], next: 'end' } }, 'slate');
      }, check: G => G.player.depth < 0.4 && !G.dialogue() }],
    onDone: G => G.hideNpc(G.npc(diverId), true)
  };
  return { quest, spawnDiver, resume: G => { if (G.isActive(o.id) && G.stepIndex(o.id) === 0) spawnDiver(G); } };
}

export default function site(G) {
  return { npcs: [ranger(G)], quests: [surveyQuest()] };
}
