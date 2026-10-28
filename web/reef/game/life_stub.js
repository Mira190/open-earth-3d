// A stand-in for life.js, for testing the game only (loaded by game.js when the query has lifestub=1 and no
// ctx.life exists). It follows the contract the game codes against:
//   species: [{ id, common, scientific, group, depth: [min, max], facts: [{ text, source }] }]
//   nearestCreature(x, north, up, maxDist = 12) -> { species, id, position: { x, north, up }, distance } | null
//   counts() -> { [speciesId]: n }      spawning: { active, nightsAfterFullMoon }
// Three species, two animals each, circling in 2-5 m of water near the spawn, drawn as plain shapes so a
// screenshot shows where they are. The facts are real and cited; the depth ranges are only where the stub
// puts them, not data.
import * as THREE from 'three/webgpu';

const SPECIES = [
  { id: 'green-turtle', common: 'Green sea turtle', scientific: 'Chelonia mydas', group: 'turtle', depth: [2, 5], color: 0x6b7a3c, len: 0.9,
    facts: [{ text: 'Unlike other sea turtles it is mostly herbivorous: adults feed mostly on seagrasses.', source: 'https://en.wikipedia.org/wiki/Green_sea_turtle' }] },
  { id: 'moorish-idol', common: 'Moorish idol', scientific: 'Zanclus cornutus', group: 'fish', depth: [2, 5], color: 0xf2e6a0, len: 0.2,
    facts: [{ text: 'The only member of its genus, Zanclus, and the only living species of its family, the Zanclidae.', source: 'https://en.wikipedia.org/wiki/Moorish_idol' }] },
  { id: 'humphead-wrasse', common: 'Humphead (Māori) wrasse', scientific: 'Crassilabrus undulatus', group: 'fish', depth: [2, 5], color: 0x3f8f7a, len: 0.8,
    facts: [{ text: 'The largest wrasse; a top reef predator that eats invertebrates, including the crown-of-thorns starfish.', source: 'https://en.wikipedia.org/wiki/Humphead_wrasse' }] }
];

export function createLifeStub(ctx) {
  const sp = ctx.S.spawn || {}, X = sp.x ?? 0, N = sp.y ?? 0;
  // water 2-5 m deep, nearest the spawn first
  const spots = [];
  for (let r = 20; r < 2500 && spots.length < 12; r += 6) for (let a = 0; a < 6.283; a += 0.5) {   // out past a wide reef flat (Heron) if need be
    const x = X + Math.cos(a) * r, n = N + Math.sin(a) * r, d = ctx.depth(x, n);
    if (d > 2.2 && d < 5 && !spots.some(s => Math.hypot(s[0] - x, s[1] - n) < 9)) { spots.push([x, n, d]); if (spots.length >= 12) break; }
  }
  const group = new THREE.Group(); group.name = 'life-stub'; ctx.scene.add(group);
  const animals = [];
  SPECIES.forEach((s, i) => {
    const mat = new THREE.MeshStandardNodeMaterial({ color: s.color, roughness: 0.6 });
    for (let k = 0; k < 2; k++) {
      const p = spots[(i * 2 + k) % Math.max(1, spots.length)] || [X + 30, N, 3];
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat);
      body.scale.set(s.len, s.len * (s.group === 'turtle' ? 0.35 : 0.6), s.len * (s.group === 'turtle' ? 0.8 : 0.25));
      const m = new THREE.Group(); m.add(body); group.add(m);
      animals.push({ s, id: `${s.id}-${k}`, cx: p[0], cn: p[1], up: ctx.env.u.tide.value - Math.min(p[2] - 0.8, 2.2), r: 2 + k, th: i + k * 2, w: 0.25 + 0.1 * k, m, pos: { x: 0, north: 0, up: 0 } });
    }
  });
  const place = a => { a.pos.x = a.cx + Math.cos(a.th) * a.r; a.pos.north = a.cn + Math.sin(a.th) * a.r; a.pos.up = a.up; a.m.position.set(a.pos.x, a.pos.up, -a.pos.north); a.m.rotation.y = -a.th; };
  animals.forEach(place);
  // spawning: the inner reefs spawn in the week after the October full moon (Wikipedia, Great Barrier Reef);
  // nights since the last full moon from the sun/moon model the viewer already runs
  const age = ctx.sun && ctx.sun.moonAge !== undefined ? ctx.sun.moonAge : 0;
  const nights = ((age - 0.5 + 1) % 1) * 29.530588;
  const when = ctx.q.get('time') ? new Date(Date.parse(ctx.q.get('time'))) : new Date();
  const month = when.getUTCMonth(), fullMoonMonth = new Date(when.getTime() - nights * 864e5).getUTCMonth();
  const spawning = { active: fullMoonMonth === 9 && nights < 8, nightsAfterFullMoon: Math.floor(nights), stub: true, month };
  const life = {
    stub: true, species: SPECIES, spawning,
    nearestCreature(x, north, up, maxDist = 12) {
      let best = null, bd = maxDist;
      for (const a of animals) { const d = Math.hypot(a.pos.x - x, a.pos.north - north, a.pos.up - up); if (d < bd) { bd = d; best = a; } }
      return best ? { species: best.s, id: best.id, position: best.pos, distance: bd } : null;
    },
    counts() { const c = {}; for (const a of animals) c[a.s.id] = (c[a.s.id] || 0) + 1; return c; },
    update(dt) { for (const a of animals) { a.th += a.w * dt / a.r * 2; place(a); } }
  };
  ctx.updaters.push(dt => life.update(Math.max(0, Math.min(dt, 0.1))));
  return life;
}
