// The fishing step of tools/game_check.js (docs/FISHING.md), and the moves tools/fishing_shot.js
// poses its stills with. In a city with fishing spots (game.json "fishing"), for every spot:
// nothing of fishing is loaded until you are near; walk up and the code and the data arrive;
// E starts it at the water's edge; a cast lands in water; a bite comes; an easy fish is landed
// with the one button, logged and let go; and when you leave, what was drawn is freed.
// A city without spots passes with nothing done.
//   const { fishingStep } = require('./fishing_step');
//   fails.push(...await fishingStep(p, shot));
const say = m => console.log(`fishing: ${m}`);

// stand at a spot, a few metres back from the edge, facing the water
async function goTo(p, id) {
  return p.evaluate(id => {
    const g = window.__game, F = g.fishing(), sp = F.spots.find(s => s.id === id), back = 4;
    let x = sp.at[0], y = sp.at[1];
    // back from the water along the spot's heading until there is ground to stand on
    for (let d = 0; d <= 12; d += 0.5) { const qx = sp.at[0] - Math.sin(sp.h) * d, qy = sp.at[1] - Math.cos(sp.h) * d; if (!g.nav.isWater(qx, qy) && g.nav.walk(qx, qy, Math.max(0, g.nav.terrain(qx, qy))).ok) { x = qx; y = qy; if (d >= back) break; } }
    const f = g.nav.floorAt(x, y, Math.max(0, g.nav.terrain(x, y)) + 0.5);
    if (g.cine.active) g.cine.skip();
    g.player.x = x + 300; g.advance(0.05);            // (a long move first: the chase camera snaps after one)
    g.player.x = x; g.player.y = y; g.player.z = f ? f.z : Math.max(0, g.nav.terrain(x, y)); g.player.h = sp.h; g.player.speed = 0;
    Object.assign(g.cam, { mode: 'chase', yaw: sp.h, yawTo: null, lastInput: -10 });
    g.advance(1.2);
    return { x: g.player.x, y: g.player.y, z: g.player.z, water: g.nav.isWater(g.player.x, g.player.y) };
  }, id);
}
// the code and the data, as coming near fetches them
const loaded = p => p.evaluate(async () => { const g = window.__game; await g.fishLoad(); return !!g.fishing().api; });
const state = p => p.evaluate(() => { const a = window.__game.fishing().api; return a ? a.state() : null; });
// E at the spot, and on to the edge with the rod out
async function begin(p, seed = 7) {
  return p.evaluate(seed => {
    const g = window.__game, a = g.fishing().api;
    a.seed(seed);
    const act = a.action();
    if (!act || !act.act) return { err: `no action at the spot (${act ? act.text : 'none'})` };
    const text = act.text;
    act.act();
    for (let i = 0; i < 80 && a.state().st === 'walk'; i++) g.advance(0.1);
    return { text, st: a.state().st };
  }, seed);
}
// hold the button for `hold` s and let go: the cast, flown and landed
const cast = (p, hold = 0.7) => p.evaluate(hold => { const g = window.__game; g.advance(0.2); g.advance(hold, ['Space']); g.advance(1.0); return g.fishing().api.state(); }, hold);
// wait for the bite (not striking at the nibbles), up to `max` s; then strike
const bite = (p, max = 40) => p.evaluate(max => { const g = window.__game, a = g.fishing().api; for (let t = 0; t < max && a.state().st === 'wait'; t += 0.1) g.advance(0.1); return a.state(); }, max);
const strike = p => p.evaluate(() => { const g = window.__game; g.advance(0.1, ['Space']); return g.fishing().api.state(); });
// the fight, as a steady player would: wind while it rests, let go when it runs or the bar is in the red; `until` s at most
const play = (p, until = 70) => p.evaluate(until => {
  const g = window.__game, a = g.fishing().api;
  let top = 0;
  for (let t = 0; t < until && a.state().st === 'fight'; t += 0.1) { const s = a.state(); top = Math.max(top, s.T); g.advance(0.1, s.phase === 'rest' && s.T < 0.97 ? ['Space'] : []); }
  return Object.assign(a.state(), { top });
}, until);

async function fishingStep(p, shot) {
  const fails = [], F = await p.evaluate(() => { const f = window.__game.fishing && window.__game.fishing(); return f ? { spots: f.spots.map(s => s.id), api: !!f.api, code: !!window.OEFishing, near: !!f.near } : null; });
  if (!F) return fails;                                   // a city without fishing
  if ((F.code || F.api) && !F.near) fails.push('fishing.js was loaded though the player has not been within sight of a spot');   // (an earlier step may have walked past one)
  // every spot is on the map's travel list (and so a pin there: tools/fishing_map.js looks at the pins)
  const listed = await p.evaluate(() => window.__game.travelGroups().flatMap(g => g[1]).filter(d => d.kind === 'fish').map(d => d.id));
  for (const id of F.spots) if (!listed.includes(`fish-${id}`)) fails.push(`fishing ${id}: not on the map's travel list`);
  let first = true;
  for (const id of F.spots) {
    const at = await goTo(p, id);
    if (at.water) { fails.push(`fishing ${id}: no ground to stand on at the spot`); continue; }
    if (!(await loaded(p))) { fails.push(`fishing ${id}: fishing.js or fishing.json did not load`); break; }
    if (first) await p.evaluate(() => window.__game.fishing().api.forget());   // a new angler: the first cast's short wait, the first stamp
    const b = await begin(p);
    if (b.err || b.st !== 'aim') { fails.push(`fishing ${id}: ${b.err || `after E the state is ${b.st}, not aim`}`); await p.evaluate(() => window.__game.fishing().api.stop(true)); continue; }
    // the easiest fish of the water, so that the step tests the plumbing and not the player
    await p.evaluate(() => { const a = window.__game.fishing().api; a.force(a.easiest()); });
    // the fish are drawn (fishart.js): every kind has a portrait for the log, and a body for the line
    if (first) {
      const art = await p.evaluate(() => {
        const g = window.__game, AR = window.OEFishArt, out = { ids: [], bad: [] };
        if (!AR) return { missing: true };
        const THREE = window.THREE;
        for (const sp of g.fishing().api.species) { out.ids.push(sp.id); const svg = AR.portrait(sp), sil = AR.portrait(sp, { silhouette: true }); if (!/<svg/.test(svg) || !/<svg/.test(sil)) out.bad.push(`${sp.id}: no portrait`); const geo = AR.geometry(THREE, sp, false), tris = geo.index.count / 3; if (!(tris > 300 && tris < 3000)) out.bad.push(`${sp.id}: ${tris} triangles`); geo.dispose(); }
        return out;
      });
      if (art.missing) fails.push('fishing: fishart.js did not load with fishing.js');
      else { if (!art.ids.length) fails.push('fishing: no species to draw'); for (const b of art.bad) fails.push(`fishing fish: ${b}`); }
    }
    const c = await cast(p);
    if (c.st !== 'wait') { fails.push(`fishing ${id}: the cast ended in ${c.st}, not on the water`); await p.evaluate(() => window.__game.fishing().api.stop(true)); continue; }
    if (shot) await shot(`fishing-${id}-wait`);
    const w = await bite(p);
    if (w.st !== 'bite') { fails.push(`fishing ${id}: no bite in 40 s (${w.st})`); await p.evaluate(() => window.__game.fishing().api.stop(true)); continue; }
    const s = await strike(p);
    if (s.st !== 'fight') { fails.push(`fishing ${id}: the strike did not hook it (${s.st})`); continue; }
    const e = await play(p);
    if (e.st !== 'card') fails.push(`fishing ${id}: the ${e.fish} was not landed (${e.st}, tension up to ${e.top.toFixed(2)})`);
    else if (!e.log[e.fish] || e.log[e.fish].n < 1) fails.push(`fishing ${id}: the catch is not in the log`);
    if (shot) await shot(`fishing-${id}-catch`);
    say(`${id}: ${b.text}; cast ${c.line.toFixed(0)} m; a ${e.cm} cm ${e.fish} ${e.st === 'card' ? 'landed' : e.st}; ${e.drawn} things drawn`);
    if (e.drawn > 5) fails.push(`fishing ${id}: ${e.drawn} draw calls with a line out (5 at most)`);
    // let it go, pack up, and walk away: nothing left drawn
    const end = await p.evaluate(() => {
      const g = window.__game, a = g.fishing().api;
      let act = a.action(); if (act && act.act) act.act();          // let it go
      g.advance(0.3);
      act = a.action(); const text = act && act.text; if (act && act.act) act.act();   // pack up
      g.advance(0.3);
      const st = a.state().st;
      g.player.x += 400; g.advance(0.5);
      return { text, st, drawn: a.state().drawn };
    });
    if (end.st !== 'off') fails.push(`fishing ${id}: still ${end.st} after packing up (${end.text})`);
    if (end.drawn) fails.push(`fishing ${id}: ${end.drawn} things still drawn 400 m from the water`);
    first = false;
  }
  return fails;
}
module.exports = { fishingStep, goTo, loaded, state, begin, cast, bite, strike, play };
