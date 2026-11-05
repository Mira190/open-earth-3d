// Lint a reef/alpine site's game file without the viewer: every line of every person and sign renders (no
// "undefined"/"NaN", no exception) and every source it cites resolves, against a stand-in G built from
// cities/<site>/city.json (flat ground at 800 m, the sun and clock real).
//   node tools/reef_site_lint.mjs lake-tekapo [ISO time]
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const site = process.argv[2], when = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
const S = JSON.parse(fs.readFileSync(new URL(`../cities/${site}/city.json`, import.meta.url)));
globalThis.window = { Sun: require('../web/sun.js') };
const { SOURCES: BASE } = await import('../web/reef/game/sources.js');
const mod = await import(`../web/reef/game/${site}.js`);
const [lon0, lat0] = S.origin, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
const pois = new Map(S.pois.map(p => [p.id, Object.assign({}, p, p.lonlat ? { x: (p.lonlat[0] - lon0) * kx, north: (p.lonlat[1] - lat0) * ky } : { x: p.xy[0], north: p.xy[1] })]));
const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
let here = { x: S.spawn.x, north: S.spawn.y };
const G = {
  S, ctx: {}, player: { S: { camYaw: 0, camPitch: 0 } },
  poi: id => pois.get(id) || null, here: () => here, spawn: () => ({ x: S.spawn.x, north: S.spawn.y, heading: S.spawn.heading }),
  dist: (a, b) => Math.hypot(a.x - b.x, a.north - b.north), bearing: (a, b) => (Math.atan2(b.x - a.x, b.north - a.north) * 180 / Math.PI + 360) % 360,
  dirName: b => dirs[Math.round(((b % 360) + 360) % 360 / 45) % 8], km: d => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`,
  where(t, from) { const p = typeof t === 'string' ? pois.get(t) : t; const a = from || here; return `${G.km(G.dist(a, p))} ${G.dirName(G.bearing(a, p))}`; },
  height: (x, n) => 800 + 0.002 * n, landSpot: (x, n) => ({ x, north: n }), sign: () => null, npc: () => null,
  nowMs: () => when, greet: () => 'Morning', month: () => new Date(when).toLocaleString('en-NZ', { month: 'long', timeZone: S.timezone }),
  monthIndex: () => +new Date(when).toLocaleString('en-NZ', { month: 'numeric', timeZone: S.timezone }) - 1,
  time: ms => new Date(ms).toLocaleTimeString('en-NZ', { timeZone: S.timezone, hour: 'numeric', minute: '2-digit' }), clock: () => G.time(when),
  moonAlt: () => 12, isDone: () => false, start() {}, show() {}, skipTo() {}, note() {}
};
window.Sun.site({ lat: lat0, lon: lon0, tz: S.timezone });
const c = mod.default(G), src = Object.assign({}, BASE, c.sources), bad = [];
let pages = 0;
for (const d of [...c.npcs, ...(c.signs || [])]) for (const [k, node] of Object.entries(d.nodes || {})) {
  let p; try { p = typeof node.say === 'function' ? node.say(G) : node.say; } catch (e) { bad.push(`${d.id}.${k} threw ${e.message}`); continue; }
  for (const x of (Array.isArray(p) ? p : [p]).filter(Boolean)) { pages++;
    if (!x.t || /undefined|NaN|null/.test(x.t)) bad.push(`${d.id}.${k}: ${String(x.t).slice(0, 80)}`);
    for (const s of x.src || []) if (!src[s]) bad.push(`${d.id}.${k}: unknown source ${s}`); }
}
for (const q of c.quests) for (const s of q.steps) { if (typeof s.text === 'function') { try { const t = s.text(G, {}); if (/undefined|NaN/.test(t)) bad.push(`${q.id}: ${t}`); } catch (e) { bad.push(`${q.id} step text threw ${e.message}`); } }
  if (typeof s.target === 'string' && !s.target.includes(':') && !pois.get(s.target)) bad.push(`${q.id}: unknown target ${s.target}`); }
console.log(`${site}: ${c.npcs.length} people, ${(c.signs || []).length} signs, ${c.quests.length} quests, ${pages} pages`);
if (bad.length) { console.log(bad.join('\n')); process.exit(1); } else console.log('all lines render and every source resolves');
