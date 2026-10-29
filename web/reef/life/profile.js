// What lives where: a site's profile comes from the `life` block of cities/<id>/city.json, which
// pipeline/marine_meta.py copies into scene.json (ctx.S.life). Anything a site leaves out falls back to
// the Whitsundays' (continental islands of the inshore central reef), which is the default below.
//
// flora:    minAbove   m above mean sea level where land plants start (the vegetation line; on a cay the
//                      highest astronomical tide)
//           coastR     [r1, r2] m: a plant is "coastal" when sea or open sand is within r1 (six probes) or r2
//           coastMaxAbove  m: above this nothing counts as coastal (hills behind a beach)
//           forest / coast / grass / shrub / wetland / mangrove   { treeId: weight } for each setting
//           density    { class: share of candidate spots planted } (10 forest, 11 shrub, 12 grass, 14 mangrove,
//                      16 wetland, "coast")
//           steep      { treeId: [k, max] } extra weight k x slope (capped) in the forest (hoop pines on headlands)
//           high       { treeId: [m, add] } extra weight above m metres
//           clear      [{ xy: [[x, north], ...] }] polygons kept bare (an airstrip); marine_meta.py projects lonlat
// fauna:    { speciesId: multiplier } on how often a wanderer (turtle, shark, ray, manta, trevally school) is
//           met per 128 m cell of water; manta: { p, share } p per cell, share of the time in the water
//           (an occasional visitor by default; resident where mantas gather)
// nesting:  turtles crawling up the beach at night in season: { months, species: { id: share }, perKm, around }
// spawning: { lag, window } lunar months after the inshore reefs' October full moon (offshore reefs spawn one
//           lunation later, Willis et al. 1985), and the nights after that full moon
export const DEFAULT = {
  flora: {
    minAbove: 2.2, coastR: [25, 55], coastMaxAbove: 14,
    forest: { 'hoop-pine': 0.12, carbeen: 0.88 },
    coast: { pandanus: 0.36, casuarina: 0.36, carbeen: 0.18, 'hoop-pine': 0.1 },
    grassSwap: { 'hoop-pine': 'carbeen' },
    mangrove: { mangrove: 1 },
    steep: { 'hoop-pine': [0.45, 0.35] }, high: { 'hoop-pine': [120, 0.1] },
    density: { 10: 0.85, 11: 0.5, 12: 0.14, 14: 0.85, 16: 0.35 },
    clear: []
  },
  fauna: {},
  nesting: null,
  spawning: { lag: 0, window: [1, 7] }
};

export function siteProfile(S) {
  const L = (S && S.life) || {}, F = L.flora || {};
  const flora = Object.assign({}, DEFAULT.flora, F, { density: Object.assign({}, DEFAULT.flora.density, F.density || {}) });
  // a site that names its own plants does not inherit the Whitsundays' boosts
  if (F.forest || F.coast) { if (!F.steep) flora.steep = {}; if (!F.high) flora.high = {}; if (!F.grassSwap) flora.grassSwap = {}; if (!F.mangrove) flora.mangrove = {}; }
  const used = new Set();
  for (const k of ['forest', 'coast', 'grass', 'shrub', 'wetland', 'mangrove']) for (const id of Object.keys(flora[k] || {})) used.add(id);
  for (const id of Object.values(flora.grassSwap || {})) used.add(id);
  return { id: S && S.id, flora, used, fauna: Object.assign({}, DEFAULT.fauna, L.fauna || {}), nesting: L.nesting || null,
    spawning: Object.assign({}, DEFAULT.spawning, L.spawning || {}), note: L.note || '' };
}

// pick from { id: weight } with r in 0..1 (in insertion order, so a site's list order is meaningful)
export function pick(weights, r, extra) {
  let tot = 0;
  for (const k in weights) tot += weights[k] + (extra && extra[k] || 0);
  if (!tot) return null;
  let acc = 0;
  for (const k in weights) { acc += (weights[k] + (extra && extra[k] || 0)) / tot; if (r < acc) return k; }
  return Object.keys(weights).pop();
}

// point in polygon ([[x, north], ...])
export function inside(poly, x, n) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > n) !== (yj > n) && x < (xj - xi) * (n - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
