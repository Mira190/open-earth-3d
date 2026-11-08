// Walk into each room a city opens (game.json "interiors": Queenstown's Skyline restaurant, St Peter's and Williams
// Cottage) and out again, for tools/game_check.js and tools/interior_shot.js. From the first point of the room's
// "way" (outside, in front of its door) the walker steers on foot through each point in turn (the door, just
// inside, the room's middle) and back, as a player holding W and turning would. On the way in the door must be
// open by the time the walker is in its doorway, the walker must end in the room (doors.js roomAt), on its floor,
// and the room's name must show; on the way out the walker must come back to where it started, and the door must
// shut behind it. Returns [{ id, name, ok, why, ... }]; with outDir, a still from inside each room.
const fs = require('fs');
const path = require('path');

module.exports = async function walkInteriors(p, { outDir = null, prefix = '' } = {}) {
  const ids = await p.evaluate(() => (window.__game.G.interiors || []).map(r => r.id));
  const res = [];
  for (const id of ids) {
    const r = await p.evaluate(id => {
      const g = window.__game, pl = g.player, room = g.G.interiors.find(q => q.id === id), D = g.doors;
      const door = D.doors.find(d => d.id === room.door);
      const walk = (pts, opened) => {
        let stuck = 0;
        for (let k = 1; k < pts.length; k++) {
          const [tx, ty] = pts[k];
          let last = Infinity, still = 0;
          for (let i = 0; i < 400; i++) {
            const d = Math.hypot(tx - pl.x, ty - pl.y);
            if (d < 0.45) break;
            if (door && Math.hypot(pl.x - door.at[0], pl.y - door.at[1]) < 0.6) opened.min = Math.min(opened.min, door.k);
            if (i % 20 === 19) { if (last - d < 0.05) still++; else still = 0; last = d; if (still >= 2) { stuck++; break; } }
            pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
            g.advance(0.05, ['KeyW']);
          }
        }
        return stuck;
      };
      const [sx, sy] = room.way[0];
      const s = g.nav.stand(sx, sy, room.floor + 1, { rMax: 3 });
      if (!s) return { id, name: room.name, ok: false, why: 'nowhere to stand in front of the door' };
      Object.assign(pl, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, ground: true, vz: 0, speed: 0 });
      g.advance(1.5); // (the door shut, the walker settled)
      const shut0 = door ? door.k : 0;
      const opened = { min: 1 };
      const stuckIn = walk(room.way, opened);
      g.advance(0.3);
      const inside = { x: pl.x, y: pl.y, z: pl.z, room: g.room() ? g.room().id : null, end: room.way[room.way.length - 1] };
      const dIn = Math.hypot(inside.x - inside.end[0], inside.y - inside.end[1]);
      // look round the room for the still: towards the door's side, from the middle
      pl.h = g.cam.yaw = Math.atan2(door.at[0] - pl.x, door.at[1] - pl.y) + Math.PI * 0.85;
      g.advance(0.6);
      const back = room.way.slice().reverse(), outOpened = { min: 1 };
      const stuckOut = walk(back, outOpened);
      g.advance(2.0); // (time for the door to swing shut behind)
      const dOut = Math.hypot(pl.x - sx, pl.y - sy);
      const o = { id, name: room.name, shut0, openIn: opened.min, openOut: outOpened.min, shutAfter: door ? door.k : 0, room: inside.room, dIn, dz: inside.z - room.floor,
        dOut, outRoom: g.room() ? g.room().id : null, stuck: stuckIn + stuckOut, mode: pl.mode };
      o.ok = o.shut0 < 0.05 && o.openIn > 0.8 && o.openOut > 0.8 && o.room === id && o.dIn < 0.8 && Math.abs(o.dz) < 0.25 && o.dOut < 0.8 && !o.outRoom && o.shutAfter < 0.05 && o.mode === 'foot';
      o.why = o.ok ? '' : [o.shut0 >= 0.05 && 'the door stood open before', o.openIn <= 0.8 && `the door only ${(o.openIn * 100).toFixed(0)}% open in the doorway`,
        o.room !== id && `not in the room (${o.room})`, o.dIn >= 0.8 && `stopped ${o.dIn.toFixed(1)} m short inside`, Math.abs(o.dz) >= 0.25 && `${o.dz.toFixed(2)} m off its floor`,
        o.openOut <= 0.8 && 'the door not open on the way out', o.dOut >= 0.8 && `stopped ${o.dOut.toFixed(1)} m short outside`, o.outRoom && 'still in the room',
        o.shutAfter >= 0.05 && 'the door left open'].filter(Boolean).join('; ');
      return o;
    }, id);
    res.push(r);
  }
  if (outDir) {
    // a still from inside each room, looking in from its door's side
    for (const id of ids) {
      await p.evaluate(id => {
        const g = window.__game, pl = g.player, room = g.G.interiors.find(q => q.id === id), [ex, ey] = room.way[room.way.length - 1], [dx, dy] = room.way[1];
        const s = g.nav.stand(ex, ey, room.floor + 0.5, { rMax: 2 }) || { x: ex, y: ey, z: room.floor };
        Object.assign(pl, { mode: 'foot', vehicle: null, x: s.x, y: s.y, z: s.z, ground: true, vz: 0, speed: 0 });
        pl.h = g.cam.yaw = Math.atan2(ex - dx, ey - dy);
        g.advance(1.0);
      }, id);
      const png = await p.evaluate(() => document.getElementById('game-gl').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `${prefix}interior-${id}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
  }
  return res;
};
