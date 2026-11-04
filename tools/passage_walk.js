// Walk the passages through the landmarks end to end, for tools/game_check.js and tools/passage_check.js:
// the roads, cycle paths and footways OpenStreetMap maps through a landmark (a building passage, an arch, a
// covered way: landmarks.json "passages", pipeline/landmark_passages.py). Each is walked both ways on foot:
// from its first point (on the floor there) the walker steers through its points one after another and must
// reach the last within a metre, never more than 1.2 m off the passage's floor (on its floor or a platform the
// landmark draws over it, not on a roof). A passage for cars
// (a road's class) must also have room for one along it (a circle of 0.9 m up to 1.6 m over the floor, as
// route.js asks). A passage the landmark's model does not open yet (open: false) is not walked: { notYet: what it
// needs }. Returns [{ name, osm, cls, len, ok, why, at, rev, notYet }].
module.exports = async function walkPassages(p) {
  return p.evaluate(() => {
    const g = window.__game, nav = g.nav, pl = g.player, out = [];
    const P = nav.passages || [];
    if (!P.length) return out;
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw, mode: pl.mode };
    // the floor at the passage's own level: the ground, or a surface the city lays over it there (a flight of steps,
    // a loggia's floor: game.json surfaces), within a step of the height of the passage's points there, not a bridge
    // deck that runs high over it
    const ground = (x, y, zr) => { const f = nav.floorAt(x, y, zr + 0.6); return f ? f.z : nav.terrain(x, y); };
    const FOOT = new Set(['footway', 'pedestrian', 'path', 'living_street', 'steps', 'cycleway']);
    for (const pa of P) {
      if (pa.open === false) { out.push({ name: pa.name || `way ${pa.osm}`, osm: pa.osm, cls: pa.class, len: 0, rev: false, ok: true, notYet: pa.needs }); continue; }
      let len = 0;
      for (let i = 1; i < pa.pts.length; i++) len += Math.hypot(pa.pts[i][0] - pa.pts[i - 1][0], pa.pts[i][1] - pa.pts[i - 1][1]);
      for (const rev of [false, true]) {
        const pts = rev ? pa.pts.slice().reverse() : pa.pts;
        const r = { name: pa.name || `way ${pa.osm}`, osm: pa.osm, cls: pa.class, len, rev, ok: false };
        // from where one can stand at its first point (within 2 m: a way mapped along a wall's face, or from a quay's edge)
        const [sx, sy, sz] = pts[0];
        const f = nav.stand(sx, sy, sz + 0.5, { rMax: 2.0 });
        if (!f || Math.abs(f.z - (pa.floor ? sz : ground(f.x, f.y, sz))) > 1.2) { r.why = `no floor at its start (${f ? f.z.toFixed(2) : 'none'} for ${sz.toFixed(2)} m)`; r.at = [sx, sy]; out.push(r); continue; }
        Object.assign(pl, { mode: 'foot', vehicle: null, x: f.x, y: f.y, z: f.z, ground: true, vz: 0, speed: 0 });
        let k = 1, still = 0, best = Infinity, off = 0, offAt = null;
        for (let i = 0; i < 4000 && k < pts.length; i++) {
          const [tx, ty] = pts[k], d = Math.hypot(tx - pl.x, ty - pl.y);
          if (d < (k === pts.length - 1 ? 1.0 : 1.2)) { k++; best = Infinity; still = 0; continue; }
          if (d < best - 0.05) { best = d; still = 0; } else if (++still > 60) break;
          pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
          g.advance(0.05, ['KeyW']);
          // the floor the passage gives here: through a building, its points' height nearest along the way; under
          // a roof open at the sides, the ground or the surface laid over it (a platform the landmark draws stands within
          // the tolerance)
          const zp = pts[Math.max(0, k - 1)][2] + (pts[k] ? (pts[k][2] - pts[Math.max(0, k - 1)][2]) * 0.5 : 0);
          const zq = pa.floor ? zp : ground(pl.x, pl.y, zp);
          if (Math.abs(pl.z - zq) > Math.abs(off)) { off = pl.z - zq; offAt = [pl.x, pl.y]; }
        }
        const [ex, ey] = pts[pts.length - 1];
        r.d = Math.hypot(ex - pl.x, ey - pl.y);
        r.off = off;
        r.ok = k >= pts.length && Math.abs(off) <= 1.2;
        if (k < pts.length) { r.why = `stopped ${r.d.toFixed(1)} m short of its end`; r.at = [+pl.x.toFixed(1), +pl.y.toFixed(1), +pl.z.toFixed(2)]; }
        else if (Math.abs(off) > 1.2) { r.why = `${off.toFixed(2)} m off its floor`; r.at = offAt.map(v => +v.toFixed(1)); }
        // room for a car along a road
        if (r.ok && !FOOT.has(pa.class) && !rev) {
          for (let i = 1; i < pts.length && r.ok; i++) {
            const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
            for (let j = 0; j <= n && r.ok; j++) {
              const x = ax + (bx - ax) * j / n, y = ay + (by - ay) * j / n, fl = nav.floorAt(x, y, az + (bz - az) * j / n + 0.6);
              if (!fl || !nav.room(x, y, fl.z, 0.9, 1.6, nav.isDeck(fl.kind))) { r.ok = false; r.why = 'no room for a car'; r.at = [+x.toFixed(1), +y.toFixed(1)]; }
            }
          }
        }
        out.push(r);
      }
    }
    Object.assign(pl, { mode: keep.mode, x: keep.x, y: keep.y, z: keep.z, h: keep.h, speed: 0 }); g.cam.yaw = keep.yaw; g.advance(0.2);
    return out;
  });
};
