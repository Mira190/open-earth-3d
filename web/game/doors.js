// Doors that open as someone comes up to them, and the rooms behind them (game.json "doors" and
// "interiors", from a city's landmark builder: Queenstown's Skyline restaurant, St Peter's and Williams
// Cottage, cities/queenstown/interiors.py).
//
// A door's leaves are the landmark's own meshes, drawn shut. They are not walls to the walkers
// (material solid: false, web/game/nav.js), so the doorway is always open to the collision world; what
// a person sees is the leaf swinging on its hinges (a church's oak door, a cottage's plank door) or
// sliding aside (a restaurant's automatic glass), timed so that it is open before anyone walking up
// reaches it, and shutting again a moment after they have gone through: the way Half-Life 2's and The
// Last of Us's proximity doors read, without a key to press.
//   doors:     [{id, name, at: [x, y, z], reach, time, leaves: [{meshes: [...], hinge: [x, y], deg} |
//              {meshes: [...], slide: [dx, dy]}]}]: at, the doorway's middle at its sill; reach (m),
//              how near someone must come; time (s), how long it takes to open; frames: [{a, b, t, z0, z1, top}],
//              its doorway's jambs and head, which the walkers meet as exact boxes (web/game/nav.js, #326)
//   interiors: [{id, name, floor, height, ring: [x, y, ...], door, lit}]: each room's outline (m), its
//              floor's level and height, and the door that leads into it (for the toast as you step in)
// The landmark's interior furnishings carry "far" in landmarks.json (web/world.js), and the low tier
// draws them nearer still (quality.js): the room's shell and its lit windows stay at every distance.
'use strict';
window.OEDoors = (function () {
  const smooth = k => k * k * (3 - 2 * k);
  function create({ G, world }) {
    const find = names => (names || []).map(n => world.getObjectByName(n)).filter(Boolean);
    const doors = (G.doors || []).map(d => Object.assign({}, d, { k: 0, leaves: (d.leaves || []).map(l => Object.assign({}, l, { m: find(l.meshes) })) }));
    const rooms = (G.interiors || []).map(r => Object.assign({}, r, { pts: r.ring }));
    // pose each leaf, open by k (0 shut, 1 open): a swing about its hinge (anticlockwise in plan for
    // positive deg), or a slide along [dx, dy]; in three.js's frame a point (x, y, z) is (x, z, -y)
    function pose(d) {
      const e = smooth(d.k);
      for (const l of d.leaves) {
        if (l.hinge) {
          const a = e * (l.deg || 90) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hx = l.hinge[0], hz = -l.hinge[1];
          for (const m of l.m) { m.rotation.y = a; m.position.set(hx - (hx * c + hz * s), 0, hz - (-hx * s + hz * c)); }
        } else if (l.slide) {
          for (const m of l.m) m.position.set(l.slide[0] * e, 0, -l.slide[1] * e);
        }
      }
    }
    // who: the people who open doors this frame ([{x, y, z, speed}]: you, on foot)
    function update(dt, who) {
      for (const d of doors) {
        // (someone running at it is sensed further off, so that it is open by the time they reach it)
        const T = d.time || 0.8, reachOf = p => (d.reach || 3.2) + Math.max(0, p.speed || 0) * T * 1.2;
        const near = who.some(p => { if (!p) return false; const r = reachOf(p); return Math.abs(p.x - d.at[0]) < r && Math.abs(p.y - d.at[1]) < r && Math.hypot(p.x - d.at[0], p.y - d.at[1]) < r && Math.abs(p.z - d.at[2]) < 2.5; });
        const want = near ? 1 : 0, k = d.k + Math.max(-dt / T, Math.min(dt / T, want - d.k));
        if (k !== d.k) { d.k = k; pose(d); }
      }
    }
    const inRing = (r, x, y) => {
      let inside = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
        if ((r[i + 1] > y) !== (r[j + 1] > y) && x < r[j] + (y - r[j + 1]) / (r[i + 1] - r[j + 1]) * (r[i] - r[j])) inside = !inside;
      return inside;
    };
    // the room (x, y, z) stands in, or null
    function roomAt(x, y, z) {
      for (const r of rooms) if (z > r.floor - 0.6 && z < r.floor + (r.height || 3) && inRing(r.pts, x, y)) return r;
      return null;
    }
    return { doors, rooms, update, roomAt, pose };
  }
  return { create };
})();
