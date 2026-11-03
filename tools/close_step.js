// Walk up to the things people come to see up close, for tools/game_check.js and
// tools/close_check.js: a shrine's ema rack, a lantern, an incense burner, a statue, a gate's
// posts, a flight of monumental steps. Each target is a point on the thing at the height of the
// floor before it (game.json "close", and the "reach" of each spot, from the city's landmark
// builders: cities/<id>/city.py game_extras). From where it says to start (or from each of eight
// directions six metres out, where one can stand), the walker steers straight at the point on foot
// and must come within `within` metres of it (1.5 unless given), sliding round what stands in the
// way, and never closer than `keep` (the thing's own half-thickness: nobody walks through it).
// Then the look closer at each spot with a "look" (its own entry, look: true).
// Returns [{ name, d, keep, within, from, at, ok, why }]; with outDir, a still of each from behind
// the walker, `${prefix}close-<n>.png`.
const fs = require('fs');
const path = require('path');

module.exports = async function walkUpClose(p, { outDir = null, prefix = '' } = {}) {
  const targets = await p.evaluate(() => {
    const G = window.__game.G, out = [];
    for (const t of G.close || []) out.push(t);
    for (const s of G.spots || []) for (const t of s.reach || []) out.push(Object.assign({ name: s.name }, t));
    return out;
  });
  const res = [];
  for (let n = 0; n < targets.length; n++) {
    const r = await p.evaluate(t => {
      const g = window.__game, nav = g.nav, pl = g.player, [tx, ty, tz] = t.at, within = t.within || 1.5, keep = t.keep || 0;
      const starts = t.from ? [t.from] : [...Array(8)].map((_, k) => [tx + 6 * Math.sin(k * Math.PI / 4), ty + 6 * Math.cos(k * Math.PI / 4)]);
      let best = null;
      for (const [sx, sy] of starts) {
        const s = nav.stand(sx, sy, tz + 0.5, { rMax: 3 });
        if (!s || Math.abs(s.z - tz) > 2.5) continue;
        Object.assign(pl, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, ground: true, vz: 0, speed: 0 });
        let dmin = Infinity, closest = Infinity, still = 0, last = Infinity;
        for (let i = 0; i < 300; i++) {
          const dx = tx - pl.x, dy = ty - pl.y, d = Math.hypot(dx, dy);
          dmin = Math.min(dmin, d); closest = Math.min(closest, d);
          if (d < Math.max(0.3, keep * 0.5)) break;
          if (i % 20 === 19) { if (last - dmin < 0.05) still++; else still = 0; last = dmin; if (still >= 2) break; }
          pl.h = g.cam.yaw = Math.atan2(dx, dy);
          g.advance(0.05, ['KeyW']);
        }
        const r = { d: dmin, from: [Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10], end: [pl.x, pl.y, pl.z], dz: pl.z - tz, mode: pl.mode };
        if (!best || r.d < best.d) best = r;
        if (best.d <= within) break;
      }
      if (!best) return { name: t.name, ok: false, why: 'nowhere to start from', at: t.at, within, keep };
      // stand where the walk got to and face the thing, for the still
      Object.assign(pl, { x: best.end[0], y: best.end[1], z: best.end[2], speed: 0 });
      pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
      g.advance(0.3);
      const ok = best.d <= within && best.d >= keep - 0.05 && best.mode === 'foot' && Math.abs(best.dz) < 1.2;
      return { name: t.name, ok, d: best.d, from: best.from, at: t.at, within, keep, dz: best.dz,
        why: ok ? '' : best.d > within ? `stopped ${best.d.toFixed(2)} m short of it` : best.d < keep - 0.05 ? 'walked into it' : `on ${best.mode}, ${best.dz.toFixed(1)} m off its floor` };
    }, targets[n]);
    if (outDir) {
      const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `${prefix}close-${n}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    res.push(r);
  }
  // the look closer at each spot with a "look" (web/game/places.js): from where the walk up to it ended,
  // E brings the eye in to about dist_m off its face with the walker hidden, something to read comes up,
  // D looks along it, and E steps back to the walker
  const spots = await p.evaluate(() => (window.__game.G.spots || []).filter(s => s.look && (s.reach || []).length).map(s => s.id));
  for (const id of spots) {
    const r = await p.evaluate(id => {
      const g = window.__game, pl = g.player, sp = g.G.spots.find(s => s.id === id), L = sp.look, t = sp.reach[0];
      const s = g.nav.stand(...t.from, t.at[2] + 0.5, { rMax: 3 });
      Object.assign(pl, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, speed: 0 });
      for (let i = 0; i < 200 && Math.hypot(t.at[0] - pl.x, t.at[1] - pl.y) > 1.2; i++) { pl.h = g.cam.yaw = Math.atan2(t.at[0] - pl.x, t.at[1] - pl.y); g.advance(0.05, ['KeyW']); }
      const a = g.currentAction();
      const out = { name: sp.name, offered: a ? a.text : null };
      if (!a || !/closer/i.test(a.text)) return out;
      g.interact(); g.advance(1.2);
      const cam = g.camera.position, [cx, cy, cz] = L.at, n = [-L.along[1], L.along[0]];
      const off = (cam.x - cx) * n[0] + (-cam.z - cy) * n[1];
      const panel = document.getElementById('g-closer'), text = document.getElementById('gc-text').textContent;
      const u0 = (cam.x - cx) * L.along[0] + (-cam.z - cy) * L.along[1];
      g.advance(1.0, ['KeyD']);
      const u1 = (g.camera.position.x - cx) * L.along[0] + (-g.camera.position.z - cy) * L.along[1];
      Object.assign(out, { open: !panel.hidden, hidden: !pl.rig.root.visible, eye: Math.abs(off) - (L.faces || 0), dz: cam.y - cz, text, moved: Math.abs(u1 - u0),
        text2: document.getElementById('gc-text').textContent });
      return out;
    }, id);
    if (outDir && r.open) {
      const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `${prefix}closer-${id}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    if (r.open) Object.assign(r, await p.evaluate(() => { const g = window.__game; g.interact(); g.advance(1.2); return { closed: document.getElementById('g-closer').hidden, back: g.player.rig.root.visible }; }));
    r.look = true;
    r.ok = !!(r.open && r.hidden && r.eye > 0.5 && r.eye < 1.5 && Math.abs(r.dz) < 0.8 && r.text && r.moved > 0.2 && r.closed && r.back);
    res.push(r);
  }
  return res;
};
