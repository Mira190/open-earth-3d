// Walk down into a sunken promenade and back up (Kyoto's Horikawa: inland.js promenade, nav.js's 'promenade'
// floor), for tools/game_check.js. From the pavement beside the top of a flight of steps (where the railing opens)
// the walker goes down it to the paved floor, along it, tries to walk into the stream and into the wall, and comes
// back up the same flight to the pavement; and so down and up every flight. Then, from the street beside the channel, it walks at the railing: it must stop there, not drop
// in. Returns { none } where the city has no promenade, else { checks: [[ok, what], ...] }.
module.exports = async function promenadeWalk(p) {
  return p.evaluate(() => {
    const g = window.__game, nav = g.nav, pl = g.player, IN = nav.inland;
    if (!IN || !IN.flights || !IN.flights.length) return { none: true };
    const keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw, mode: pl.mode };
    const traffic = g.cars.active; g.cars.active = 0; g.advance(0.05);
    const checks = [], f2 = v => v.toFixed(2);
    // steer to (tx, ty) on foot; true once within `tol` m. Records the lowest and highest feet on the way
    const go = (tx, ty, tol = 0.6, max = 400) => {
      let best = Infinity, still = 0;
      for (let i = 0; i < max; i++) {
        const d = Math.hypot(tx - pl.x, ty - pl.y);
        if (d < tol) return true;
        if (d < best - 0.02) { best = d; still = 0; } else if (++still > 40) return false;
        pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
        g.advance(0.05, ['KeyW']);
      }
      return false;
    };
    // the pavement beside a flight's top, through the gap in the railing: [x, y] on the bank, or null
    // (the first place off the channel, within 5 m, where the street is within half a metre of the flight's top: a
    // mapped bridge's approach can lie between)
    const pavement = f => {
      const u = Math.min(0.6, IN.FLIGHT_GATE / 2);
      for (let v = f.w / 2 + 0.3; v < f.w / 2 + 5; v += 0.25) {
        const x = f.x + f.ux * u + f.nx * v, y = f.y + f.uy * u + f.ny * v;
        if (IN.water(x, y)) continue;
        const q = [x + f.nx * 0.6, y + f.ny * 0.6], fl = nav.floorAt(q[0], q[1], f.zt + 0.3);
        if (fl && fl.kind === 'ground' && Math.abs(fl.z - f.zt) < 0.5 && nav.walk(q[0], q[1], fl.z).ok) return q;
      }
      return null;
    };
    // a flight with floor room past its foot (8 m on along it, not on another flight or in the stream)
    const fl = IN.flights.find(f => [2, 5, 8].every(d => { const q = IN.promenade(f.x + f.ux * (f.run + d), f.y + f.uy * (f.run + d)); return q && !q.flight; })) || IN.flights[0];
    const at = (u, v = 0) => [fl.x + fl.ux * u + fl.nx * v, fl.y + fl.uy * u + fl.ny * v];
    // on the pavement beside the top of the flight
    const pv = pavement(fl), onPave = (q, fs = fl) => { const f = q && nav.floorAt(q[0], q[1], fs.zt + 0.3); return f && f.kind === 'ground' && Math.abs(f.z - fs.zt) < 0.5 ? f : null; };
    const s = onPave(pv);
    if (!s) {
      checks.push([false, `stands on the pavement at the top of the Horikawa's steps (${pv ? pv.map(v => v.toFixed(1)) : 'none'} for ${f2(fl.zt)} m)`]);
    } else {
      Object.assign(pl, { mode: 'foot', vehicle: null, x: pv[0], y: pv[1], z: s.z, ground: true, vz: 0, speed: 0 });
      g.advance(0.2);
      // through the railing's gap onto the top of the flight, down it to the floor
      const floorZ = IN.promenade(...at(fl.run + 2)).z;
      const down = go(...at(0.6)) && go(...at(fl.run + 2)) && Math.abs(pl.z - floorZ) < 0.25 && pl.floor === 'promenade';
      checks.push([down, `walks down the steps into the Horikawa (${f2(fl.zt - fl.zb)} m) to its floor (feet ${f2(pl.z)} m on ${pl.floor} for ${f2(floorZ)} m)`]);
      if (down) {
        // along the floor
        const along = go(...at(fl.run + 8)) && pl.floor === 'promenade' && Math.abs(pl.z - IN.promenade(pl.x, pl.y).z) < 0.1;
        checks.push([along, `walks along the promenade's floor (${f2(Math.hypot(pl.x - at(fl.run + 2)[0], pl.y - at(fl.run + 2)[1]))} m on, on ${pl.floor})`]);
        // into the stream and into the wall: held on the floor
        const z0 = pl.z, x0 = pl.x, y0 = pl.y;
        go(x0 - fl.nx * 6, y0 - fl.ny * 6, 0.3, 60);
        const inStream = !IN.promenade(pl.x, pl.y) || Math.abs(pl.z - z0) > 0.2;
        go(x0 + fl.nx * 6, y0 + fl.ny * 6, 0.3, 80);
        const inWall = Math.abs(pl.z - z0) > 0.2 || !IN.water(pl.x, pl.y);
        checks.push([!inStream && !inWall, `stays on the floor at the stream's edge and at the wall (${inStream ? 'in the stream' : 'held at the stream'}, ${inWall ? `out through the wall at ${f2(pl.z)} m` : 'held at the wall'})`]);
        // back up the flight to the crossing
        const up = go(...at(fl.run + 1.5)) && go(...at(0.6), 0.25) && go(...pv) && Math.abs(pl.z - fl.zt) < 0.4 && Math.hypot(pl.x - pv[0], pl.y - pv[1]) < 0.7;
        checks.push([up, `walks back up the steps to the pavement (feet ${f2(pl.z)} m on ${pl.floor} for ${f2(fl.zt)} m)`]);
      }
      // at the railing from the street: on the bank 2 m out from the wall beside the floor past the flight's foot,
      // walking at the channel
      const [bx, by] = at(fl.run + 6, fl.w / 2 + 0.3);
      let bank = null;
      for (let o = 0.5; o < 6 && !bank; o += 0.25) { const q = [bx + fl.nx * o, by + fl.ny * o]; if (!IN.water(...q)) bank = [q[0] + fl.nx * 1.5, q[1] + fl.ny * 1.5]; }
      const b = bank && nav.stand(bank[0], bank[1], fl.zt + 1, { rMax: 1.5 });
      if (!b) checks.push([false, 'stands on the street beside the Horikawa']);
      else {
        Object.assign(pl, { mode: 'foot', vehicle: null, x: b.x, y: b.y, z: b.z, ground: true, vz: 0, speed: 0 });
        g.advance(0.2);
        const z0 = pl.z;
        go(b.x - fl.nx * 8, b.y - fl.ny * 8, 0.3, 80);
        checks.push([Math.abs(pl.z - z0) < 0.3 && !IN.water(pl.x, pl.y), `stops at the Horikawa's railing from the street (feet ${f2(pl.z)} m for ${f2(z0)} m)`]);
      }
    }
    // up the seating steps along the wall (the Horikawa's between Nijo and Oshikoji) from the floor to the top tier,
    // and down again
    // (each block of them: the pieces that follow one another along a wall)
    const blocks = [];
    for (const q of IN.seats || []) { const l = blocks[blocks.length - 1]; if (l && Math.hypot(q.x - l[l.length - 1].x, q.y - l[l.length - 1].y) < 8) l.push(q); else blocks.push([q]); }
    for (const blk of blocks) {
      const q = blk[Math.floor(blk.length / 2)], mid = q.len / 2;
      const at2 = d => [q.x + q.ux * mid - q.nx * d, q.y + q.uy * mid - q.ny * d];
      const top = q.zf + q.rise * q.n;
      let start = null;
      for (let d = q.n * q.tread + 0.4; d < q.n * q.tread + 2.5 && !start; d += 0.2) { const pr = IN.promenade(...at2(d)); if (pr && !pr.flight && !pr.seat) start = d; }
      if (start == null) checks.push([false, 'stands on the floor in front of the seating steps']);
      else {
        Object.assign(pl, { mode: 'foot', vehicle: null, x: at2(start)[0], y: at2(start)[1], z: IN.promenade(...at2(start)).z, ground: true, vz: 0, speed: 0 });
        g.advance(0.1);
        const up = go(...at2(q.tread * 0.4), 0.3) && Math.abs(pl.z - top) < 0.15;
        const zUp = pl.z;
        const down = go(...at2(start), 0.4) && Math.abs(pl.z - IN.promenade(...at2(start)).z) < 0.2;
        checks.push([up && down, `climbs the seating steps at ${q.x.toFixed(0)},${q.y.toFixed(0)} to the top tier and back down (${q.n} tiers of ${q.rise} m: feet ${f2(zUp)} m for ${f2(top)} m, then ${f2(pl.z)} m)`]);
      }
    }
    // across the stream on each slab and each row of stepping stones (#322), from the floor on one side to the floor
    // on the other and back, never down in the stream
    const rows = [];
    for (const c of IN.crossings || []) {
      const r = rows.find(r => Math.hypot(r.x - c.x, r.y - c.y) < 1.6 && (r.m > 0.1) === (c.m > 0.1));
      if (r) { r.k++; r.x += (c.x - r.x) / r.k; r.y += (c.y - r.y) / r.k; r.half = Math.max(r.half, Math.hypot(c.x - r.x, c.y - r.y) + c.len / 2); } else rows.push({ x: c.x, y: c.y, ux: c.ux, uy: c.uy, half: c.len / 2, zt: c.zt, m: c.m, k: 1 });
    }
    const crossBad = [];
    for (const r of rows) {
      const side = s => { for (let d = r.half + 0.4; d < r.half + 3; d += 0.2) { const q = [r.x + r.ux * d * s, r.y + r.uy * d * s], pr = IN.promenade(...q); if (pr && !pr.flight && !pr.crossing) return [q, pr.z]; } return null; };
      const a = side(-1), b = side(1), what = r.m > 0.1 ? 'stones' : 'slab';
      if (!a || !b) { crossBad.push(`${what} at ${r.x.toFixed(0)},${r.y.toFixed(0)}: no floor either side`); continue; }
      Object.assign(pl, { mode: 'foot', vehicle: null, x: a[0][0], y: a[0][1], z: a[1], ground: true, vz: 0, speed: 0 });
      g.advance(0.1);
      let low = Infinity;
      const track = (tx, ty) => { for (let i = 0; i < 200; i++) { const d = Math.hypot(tx - pl.x, ty - pl.y); if (d < 0.3) return true; pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y); g.advance(0.05, ['KeyW']); low = Math.min(low, pl.z); } return false; };
      const over = track(...b[0]) && Math.abs(pl.z - b[1]) < 0.15, back = over && track(...a[0]) && Math.abs(pl.z - a[1]) < 0.15;
      if (!over || !back || low < r.zt - 0.12) crossBad.push(`${what} at ${r.x.toFixed(0)},${r.y.toFixed(0)}: ${over ? (back ? `down to ${f2(low)} m for a top at ${f2(r.zt)} m` : 'not back') : `stopped at ${f2(pl.z)} m`}`);
    }
    if (rows.length) checks.push([!crossBad.length, `walks over the Horikawa's ${rows.length} slabs and rows of stepping stones and back${crossBad.length ? ` (${crossBad.join('; ')})` : ''}`]);
    // down and up the floor's steps where it drops with the stream (#322): over the widest riser of each, both ways
    const steps = [];
    for (const b of IN.walledBodies || []) for (const [ax, ay, bx, by, zt, zb] of (b.terrace && b.terrace.risers) || []) {
      const L = Math.hypot(bx - ax, by - ay);
      if (L > 2 && !IN.onDeck((ax + bx) / 2, (ay + by) / 2) && !IN.onDeck(ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25)) steps.push({ mx: (ax + bx) / 2, my: (ay + by) / 2, nx: (ay - by) / L, ny: (bx - ax) / L, zt, zb, L });
    }
    const stepBad = [];
    for (const s of steps) {
      const p0 = [s.mx + s.nx * 1.2, s.my + s.ny * 1.2], p1 = [s.mx - s.nx * 1.2, s.my - s.ny * 1.2];
      const z0 = IN.promenade(...p0), z1 = IN.promenade(...p1);
      if (!z0 || !z1) { stepBad.push(`${s.mx.toFixed(0)},${s.my.toFixed(0)}: no floor`); continue; }
      Object.assign(pl, { mode: 'foot', vehicle: null, x: p0[0], y: p0[1], z: z0.z, ground: true, vz: 0, speed: 0 });
      g.advance(0.1);
      const ok = go(...p1, 0.3) && Math.abs(pl.z - z1.z) < 0.05 && go(...p0, 0.3) && Math.abs(pl.z - z0.z) < 0.05;
      if (!ok || Math.abs(Math.abs(z0.z - z1.z) - (s.zt - s.zb)) > 0.03) stepBad.push(`${s.mx.toFixed(0)},${s.my.toFixed(0)}: feet ${f2(pl.z)} m, floor ${f2(z0.z)} / ${f2(z1.z)} m for a step of ${f2(s.zt - s.zb)} m`);
    }
    if (steps.length) checks.push([!stepBad.length, `walks down and up the Horikawa floor's ${steps.length} steps with its drops${stepBad.length ? ` (${stepBad.join('; ')})` : ''}`]);
    // and every flight: down from its crossing to the floor and back up
    const bad = [];
    for (const [i, f] of IN.flights.entries()) {
      const pt = (u) => [f.x + f.ux * u, f.y + f.uy * u];
      const q = pavement(f), st = onPave(q, f);
      if (!st) { bad.push(`${i}: no pavement beside its top`); continue; }
      Object.assign(pl, { mode: 'foot', vehicle: null, x: q[0], y: q[1], z: st.z, ground: true, vz: 0, speed: 0 });
      g.advance(0.1);
      const fz = IN.promenade(...pt(f.run + 0.8));
      if (!go(...pt(0.6)) || !go(...pt(f.run + 0.8)) || !fz || Math.abs(pl.z - fz.z) > 0.25) { bad.push(`${i}: down, stopped at ${pl.x.toFixed(1)},${pl.y.toFixed(1)} ${f2(pl.z)} m`); continue; }
      if (!go(...pt(f.run * 0.5)) || !go(...pt(0.6), 0.25) || !go(...q) || Math.abs(pl.z - st.z) > 0.3) bad.push(`${i}: up, stopped at ${pl.x.toFixed(1)},${pl.y.toFixed(1)} ${f2(pl.z)} m`);
    }
    checks.push([!bad.length, `walks down and back up each of the Horikawa's ${IN.flights.length} flights of steps${bad.length ? ` (${bad.join('; ')})` : ''}`]);
    Object.assign(pl, { mode: keep.mode, x: keep.x, y: keep.y, z: keep.z, h: keep.h, ground: true, vz: 0, speed: 0 }); g.cam.yaw = keep.yaw;
    g.cars.active = traffic; g.advance(0.05);
    return { checks };
  });
};
