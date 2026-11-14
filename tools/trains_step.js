// The railway (web/game/trains.js), for tools/game_check.js, in a city whose game.json has "trains":
//   - the timetable: over ten minutes every stopping train stands at its platform for its dwell, a train
//     that runs through never slows, and no two trains on a track come within a train's length;
//   - the Keihin-Tohoku Line's rapid trains run through by day and stop in the evening (rapid_h);
//   - drawn: with a train at the platform its cars are instanced, each on its track and between the
//     sheds' mouths;
//   - on foot: the place to travel to stands you on the platform, and a walker cannot get down onto the
//     track through the platform doors;
//   - heard: a train near the camera has a voice, and none back where the game began; through an arrival
//     the platform says the train is coming, names the station and closes the doors, in Japanese and
//     English, with the right track number; muted, nothing is spoken.
// part: 'watch' (all but the ride), 'ride' (the ride alone: tools/game_check.js runs it last, as the time it takes
// moves the traffic every step after it sees), or 'all'.
// Returns { none } in a city without a railway, or { checks: [[ok, what]] }.
module.exports = async function trainsStep(p, part = 'all') {
  return p.evaluate(part => {
    const g = window.__game, T = g.trains, checks = [], A = window.OEAudio;
    if (!T) return { none: true };
    const pl = g.player, keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw, t: T.t, min: g.clock.min };
    if (!A.on) A.start();
    const wasMuted = A.muted;
    if (part !== 'ride') {
      // ---- the timetable, as a function of the time alone
      g.setClock(g.clock.y, g.clock.m, g.clock.d, 18 * 60);
      const slow = {}, close = {};
      for (let t = 0; t < 600; t += 0.5) {
        const live = T.at(t), by = {};
        for (const tr of live) {
          const id = tr.s.track;
          if (!tr.stops && tr.v < tr.s.v_ms - 0.01) slow[id] = 1;
          for (const o of by[id] || []) if (Math.abs(o.x - tr.x) < tr.s.len + 20) close[id] = 1;
          (by[id] = by[id] || []).push(tr);
        }
      }
      const stops = T.services.filter(s => T.stopsNow(s)), dwell = stops.map(s => { const r = T.run(s, 0, true, {}); return r.t3 - r.t2; });
      checks.push([stops.length > 0 && dwell.every(d => d >= 20) && !Object.keys(slow).length && !Object.keys(close).length,
        `the railway's timetable: ${T.services.length} services on ${Object.keys(T.tracks).length} tracks, ${stops.length} stopping (each stands ${Math.round(Math.max(0, ...dwell))} s)` +
        `${Object.keys(slow).length ? `; a through train slowed on ${Object.keys(slow)}` : ''}${Object.keys(close).length ? `; two trains too close on ${Object.keys(close)}` : ''}`]);
      const rapid = T.services.filter(s => s.rapid_h);
      if (rapid.length) {
        g.setClock(g.clock.y, g.clock.m, g.clock.d, 12 * 60);
        const day = rapid.every(s => !T.stopsNow(s));
        g.setClock(g.clock.y, g.clock.m, g.clock.d, 18 * 60);
        checks.push([day && rapid.every(s => T.stopsNow(s)), `the rapid trains run through at noon and stop at six in the evening (${rapid.map(s => s.track).join(', ')})`]);
      }
      // no column of a deck over the line (an expressway on the station's roof) stands in a train's way
      { const q = {}; let worst = Infinity, n = 0;
        for (const r of g.deckPlan.runs) for (const c of r.cols || []) for (const tr of Object.values(T.tracks)) {
          tr.c.at(0, q); if (c.z1 < q.z + 1 || c.z0 > q.z + 4) continue;
          let best = Infinity; for (let d = 0; d <= tr.c.L; d += 0.5) { tr.c.at(d, q); best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y)); }
          if (best < 12) { n++; worst = Math.min(worst, best - Math.max(c.hx, c.hy)); }
        }
        checks.push([worst > 1.6, `the columns of the decks over the line stand clear of the trains (${n} by the tracks${n ? `, the nearest face ${worst.toFixed(2)} m from a track's middle` : ''})`]); }
      if (T.stations.some(s => !s.under)) {
        // ---- on the platform: where the map's travel point puts you
        const st = T.station, tp = (g.G.travel || []).find(q => Math.hypot(q.at[0] - st.at[0], q.at[1] - st.at[1]) < 200 && Math.abs((q.at[2] ?? 1e9) - st.at[2]) < 1) || { at: st.at };
        const f = g.nav.floorAt(tp.at[0], tp.at[1], tp.at[2] + 0.5);
        checks.push([!!f && Math.abs(f.z - st.at[2]) < 0.15, `the platform is a floor at ${st.at[2].toFixed(1)} m (${f ? f.z.toFixed(2) : 'none'} m at the place to travel to)`]);
        // the service that stops at the nearest track, and a second before its train is announced
        const stopping = T.services.filter(s => s.tr.platform != null && T.stopsNow(s));
        const cOf = s => { const o = {}; s.tr.c.at(s.tr.stop_m, o); return o; };
        const sv = stopping.sort((a, b) => Math.hypot(cOf(a).x - tp.at[0], cOf(a).y - tp.at[1]) - Math.hypot(cOf(b).x - tp.at[0], cOf(b).y - tp.at[1]))[0];
        const r0 = T.run(sv, 0, true, {});
        Object.assign(pl, { x: tp.at[0], y: tp.at[1], z: f ? f.z : st.at[2], ground: true, vz: 0, speed: 0, mode: 'foot' });
        // towards the track, straight across: the platform doors hold you on the platform
        const c = { x: 0, y: 0 };
        { let best = Infinity; const q = {}; for (let d = 0; d <= sv.tr.c.L; d += 0.5) { sv.tr.c.at(d, q); const dd = Math.hypot(q.x - pl.x, q.y - pl.y); if (dd < best) { best = dd; c.x = q.x; c.y = q.y; } } }
        pl.h = g.cam.yaw = Math.atan2(c.x - pl.x, c.y - pl.y);
        g.advance(0.3);
        let low = pl.z;
        for (let i = 0; i < 120; i++) { pl.h = g.cam.yaw = Math.atan2(c.x - pl.x, c.y - pl.y); g.advance(0.05, ['KeyW']); low = Math.min(low, pl.z); }
        const off = Math.hypot(c.x - pl.x, c.y - pl.y);
        checks.push([low > st.at[2] - 0.2 && off > 1.6 && off < 4 && pl.mode === 'foot', `the platform doors keep a walker off the track (stopped ${off.toFixed(2)} m from its middle, at ${low.toFixed(2)} m)`]);
        // a platform with no doors along it holds a walker on it all the same (a strip's "hold": Kyoto's JR platforms)
        const hold = (g.G.surfaces || []).find(q => q.hold && q.type === 'strip' && !/^rail_platform_1[13]/.test(q.mesh || '') && q.profile[0][1] < st.at[2] - 3) || (g.G.surfaces || []).find(q => q.hold && q.type === 'strip');
        if (hold) {
          const back = { x: pl.x, y: pl.y, z: pl.z, h: pl.h };
          const u = (hold.profile[0][0] + hold.profile[hold.profile.length - 1][0]) / 2, z0 = (hold.profile[0][1] + hold.profile[hold.profile.length - 1][1]) / 2;
          Object.assign(pl, { x: hold.origin[0] + hold.axis[0] * u, y: hold.origin[1] + hold.axis[1] * u, z: z0, ground: true, vz: 0, speed: 0, mode: 'foot' });
          g.advance(0.3);
          const z1 = pl.z; let lowH = pl.z;
          for (let i = 0; i < 100; i++) { pl.h = g.cam.yaw = Math.atan2(-hold.axis[1], hold.axis[0]); g.advance(0.05, ['KeyW']); lowH = Math.min(lowH, pl.z); }
          const v = -(pl.x - hold.origin[0]) * hold.axis[1] + (pl.y - hold.origin[1]) * hold.axis[0];
          checks.push([lowH > z1 - 0.2 && Math.abs(v) <= hold.half_width + 0.6, `a platform without doors holds a walker at its edge (${hold.name}: ${Math.abs(v).toFixed(2)} m out of a half width of ${hold.half_width}, the lowest ${(lowH - z1).toFixed(2)} m)`]);
          Object.assign(pl, back); g.advance(0.3);
        }
        // ---- an arrival, heard and seen from there
        A.setMuted(false);
        const spoken = [];
        const ss = window.speechSynthesis, speak0 = ss && ss.speak;
        if (ss) ss.speak = u => spoken.push(u.lang); // (counted, not played: a harness has no speakers)
        T.said.length = 0;
        T.t = sv.offset_s + r0.t1 - 9;
        let voice = 0, drawn = 0, offTrack = 0, standing = 0;
        const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q = {};
        for (let t = 0; t < r0.t3 - r0.t1 + 14; t += 0.1) {
          g.advance(0.1);
          voice = Math.max(voice, ...T.voices);
          const tr = T.live.find(o => o.s === sv && o.ph === 'stand');
          if (tr && !standing) {
            standing = 1;
            for (const K of Object.values(T.kinds)) for (const L of K.lods) for (const m of L.meshes.slice(0, 1)) for (let i = 0; i < m.count; i++) {
              m.getMatrixAt(i, m4); v3.setFromMatrixPosition(m4); drawn++;
              let best = Infinity;
              for (const s of T.services) for (let d = 0; d <= s.tr.c.L; d += 0.5) { s.tr.c.at(d, q); const dd = Math.hypot(q.x - v3.x, q.y + v3.z); if (dd < best) best = dd; }
              if (best > 0.5) offTrack++;
            }
          }
        }
        const said = T.said.filter(o => o.track === sv.track).map(o => o.what), n = sv.tr.platform, first = T.said.find(o => o.track === sv.track && o.what === 'approach');
        const cap = document.getElementById('g-announce');
        checks.push([standing === 1 && drawn > 0 && offTrack === 0, `a train stands at track ${n}: ${drawn} cars drawn on the line${offTrack ? `, ${offTrack} off their track` : ''}`]);
        // the Blender cars (assets/vehicles/railstock.glb) have taken the box models' place
        if (T.services.some(s => s.S.model)) {
          const glb = Object.values(T.kinds).filter(K => K.glb), drawnGlb = glb.reduce((a, K) => a + K.lods.reduce((b, L) => b + L.n, 0), 0);
          checks.push([T.models && glb.length > 0 && drawnGlb > 0, `the trains are the modelled cars (${glb.length} kinds, ${drawnGlb} cars drawn${T.models ? '' : '; railstock.glb not loaded'})`]);
        }
        checks.push([['approach', 'arrive', 'close'].every(w => said.includes(w)) && !!first && (!first.ja || new RegExp(`${n}番(線|のりば)`).test(first.ja)) && new RegExp(`(track|platform) ${n}\\b`).test(first.en) && !!cap && cap.textContent.length > 10,
          `the platform announces the train on track ${n}, the station and the doors (${said.join(', ') || 'nothing'}; "${first ? first.en : ''}")`]);
        checks.push([voice > 0.2, `the train is heard from the platform (its voice up to ${voice.toFixed(2)})`]);
        if (ss && window.SpeechSynthesisUtterance && ss.getVoices().length) checks.push([spoken.length > 0, `and spoken by the browser's voices (${spoken.length} utterances: ${[...new Set(spoken)].join(', ')})`]);
        // muted: nothing spoken
        A.setMuted(true);
        const n0 = spoken.length;
        T.t = sv.offset_s + r0.t1 - 9;
        for (let t = 0; t < 12; t += 0.25) g.advance(0.25);
        checks.push([spoken.length === n0, `muted, nothing is spoken (${spoken.length - n0})`]);
        A.setMuted(false);
        if (ss) ss.speak = speak0;
        Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h }); g.cam.yaw = keep.yaw;
        T.t = keep.t; g.setClock(g.clock.y, g.clock.m, g.clock.d, keep.min);
        A.setMuted(wasMuted);
        g.advance(0.3);
        // back where you were, far from the line: no train has a voice
        g.advance(2.5); // (the chase camera, which hears, snaps back with you)
        const nearest = Math.min(Infinity, ...T.live.filter(o => o.v > 0.05).map(o => o.near));
        checks.push([nearest < 240 || Math.max(...T.voices) === 0, `away from the line no train is heard (the nearest moving train ${nearest.toFixed(0)} m off, its voice ${Math.max(...T.voices).toFixed(2)})`]);
      } else {
        // ---- a line whose stations all stand inside buildings (Shibuya's): over ten minutes, trains are drawn on the open
        // line between them, never inside a station's box, and every car drawn is on its track
        let drawn = 0, inBox = 0, offTrack = 0;
        const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q = {};
        for (let t = 0; t < 600; t += 20) {
          T.t = keep.t + t; g.advance(0.05);
          for (const K of Object.values(T.kinds)) for (const L of K.lods) for (const m of L.meshes.slice(0, 1)) for (let i = 0; i < m.count; i++) {
            m.getMatrixAt(i, m4); v3.setFromMatrixPosition(m4); drawn++;
            let best = Infinity, dark = false;
            for (const s of T.services) for (let d = 0; d <= s.tr.c.L; d += 1) { s.tr.c.at(d, q); const dd = Math.hypot(q.x - v3.x, q.y + v3.z); if (dd < best) { best = dd; dark = (s.tr.dark || []).some(([a, b]) => d > a + 12 && d < b - 12); } }
            if (best > 0.8) offTrack++;
            if (dark && best < 0.8) inBox++;
          }
        }
        T.t = keep.t; g.advance(0.3);
        checks.push([drawn > 0 && inBox === 0 && offTrack === 0, `the trains run on the open line between the stations (${drawn} cars drawn over ten minutes, ${inBox} inside a station's building, ${offTrack} off their track)`]);
      }
    }
    // ---- a ride, where the line has a second station: from a platform, wait for a train that stops at the next
    // station, see its doors and the platform doors open, board it, ride, and get off onto the next station's platform
    const Rd = T.ride;
    if (part !== 'watch' && Rd && g.rail === Rd && T.stations.length > 1) {
      // (on foot, wherever the steps before left you: out of your car, out of a taxi or a ride and done with it)
      if (pl.mode === 'car') { g.exitCar(); g.advance(0.5); }
      if (pl.mode === 'ride') { g.leaveRide(); g.advance(1); }
      if (g.ride && g.ride() && g.cancelRide) { g.cancelRide(); g.advance(0.5); }
      if (pl.mode !== 'foot') { Object.assign(pl, { mode: 'foot', vehicle: null }); pl.rig.root.visible = true; }
      g.setClock(g.clock.y, g.clock.m, g.clock.d, 18 * 60);
      const from = T.stations.find(s => !s.under) || T.stations[0], sv2 = T.services.find(s => T.stopsNow(s) && s.halts.findIndex(h => h.st === from) >= 0 && s.halts.findIndex(h => h.st === from) < s.halts.length - 1);
      const h0 = sv2.halts.find(h => h.st === from), to = sv2.halts[sv2.halts.indexOf(h0) + 1].st;
      const q0 = {}; sv2.tr.c.at(h0.m, q0);
      const side = h0.side || 1, a = {}, b = {}; sv2.tr.c.at(h0.m - 1, a); sv2.tr.c.at(h0.m + 1, b);
      const hx = (b.x - a.x) / 2, hy = (b.y - a.y) / 2, px = from.under ? from.x : q0.x - hy * side * 3.2, py = from.under ? from.y : q0.y + hx * side * 3.2, f0 = g.nav.floorAt(px, py, from.z + 0.5);
      Object.assign(pl, { x: px, y: py, z: f0 ? f0.z : from.z, ground: true, vz: 0, speed: 0, mode: 'foot', vehicle: null });
      g.advance(0.3);
      let act = g.currentAction(); const waitText = act ? act.text : '';
      // the clock to a few seconds before this service's train stands here
      const L = T.plan(sv2, true).legs.find(l => l.h === h0), k = Math.ceil((T.t - sv2.offset_s - L.t2) / sv2.every_s) + 1;
      T.t = sv2.offset_s + k * sv2.every_s + L.t2 - 6;
      let car = null, doorsCar = 0, psdOpen = 0;
      for (let t = 0; t < 20 && !car; t += 0.25) {
        g.advance(0.25);
        car = Rd.cars.find(c => c.s === sv2 && Rd.stationOf(c.id) === from);
      }
      for (let t = 0; t < 4; t += 0.25) { g.advance(0.25); }
      doorsCar = T.doorways || 0;
      psdOpen = Math.max(0, ...T.doorsOpen.filter(d => d.track === sv2.track && d.station === from.id).map(d => d.f));
      act = g.currentAction();
      const boardText = act ? act.text : '';
      if (car) g.boardRail(car, from);
      g.advance(0.3);
      const aboard = pl.mode === 'rail' && pl.vehicle === car;
      let left = false, top = 0, arrived = false, inside = true, veiled = false;
      const money0 = g.life ? g.life.money : 0;
      if (g.life) g.life.store.wallets[g.life.code] = 1e5; // (a wallet that covers the fare, whatever the steps before spent; put back after)
      const money1 = g.life ? g.life.money : 0;
      for (let t = 0; t < 400 && car && !arrived; t += 0.5) {
        g.advance(0.5);
        if (T.veiled) veiled = true;
        if (car.moved) left = true;
        top = Math.max(top, car.speed);
        if (pl.mode === 'rail') { const d = Math.hypot(pl.x - car.x, pl.y - car.y); if (d > sv2.len / 2 + 1) inside = false; }
        arrived = left && (Rd.stationOf(car.id) === to || pl.mode === 'foot');
      }
      for (let t = 0; t < 6 && pl.mode === 'rail'; t += 0.5) { act = g.currentAction(); if (act && /^Get off/.test(act.text)) { act.act(); break; } g.advance(0.5); }
      if (pl.mode === 'rail') { act = g.currentAction(); if (act && act.act) act.act(); }
      g.advance(0.6);
      const offF = g.nav.floorAt(pl.x, pl.y, pl.z + 0.3), offZ = pl.z - to.z, offD = Math.hypot(pl.x - to.x, pl.y - to.y);
      checks.push([/next train|Board/.test(waitText), `on ${from.name}'s platform ${h0.platform} the game offers the train ("${waitText}")`]);
      checks.push([!!car && /^Board/.test(boardText) && (from.under || doorsCar > 0) && (!h0.psd || psdOpen > 0.9), `the ${sv2.line.en} train for ${sv2.for ? sv2.for.en : '?'} stands with its doors open (${doorsCar} doorways drawn, the platform doors ${(psdOpen * 100).toFixed(0)}% open${T.doorsOpen.some(d => d.track === sv2.track && d.station === from.id) ? '' : ': none here'}): "${boardText}"`]);
      checks.push([aboard && left && inside, `boards it and rides in it (${aboard ? 'aboard' : 'not aboard'}, ${left ? 'left' : 'did not leave'}${inside ? '' : ', the rider off the train'})`]);
      checks.push([arrived && top * 3.6 > 40 && top * 3.6 < 100, `rides to ${to.name} (${(top * 3.6).toFixed(0)} km/h at most)`]);
      if (to.under) { // a station under the ground: the tunnel veiled, and up at its street entrance, the veil lifted
        checks.push([veiled && !T.veiled && pl.mode === 'foot' && Math.abs(offZ) < 1.5 && offD < 15 && !!offF, `rides through the tunnel (veiled: ${veiled}) and comes up at ${to.name}'s entrance (${offD.toFixed(1)} m from it, ${offZ.toFixed(2)} m off its level; the veil ${T.veiled ? 'still up' : 'lifted'})`]);
        const f = g.life && g.life.data.fares;
        if (f && f.rides.rail) checks.push([money1 - g.life.money > 0, `the ride is charged by ${f.card.name} (${g.life.fmt(money1 - g.life.money)})`]);
      } else checks.push([pl.mode === 'foot' && Math.abs(offZ) < 0.5 && offD < (to.r || 150) && !!offF, `gets off onto ${to.name}'s platform (${offZ.toFixed(2)} m off its level, ${offD.toFixed(0)} m from its middle)`]);
      if (g.life) g.life.store.wallets[g.life.code] = money0;
      Object.assign(pl, { x: keep.x, y: keep.y, z: keep.z, h: keep.h, mode: 'foot', vehicle: null }); pl.rig.root.visible = true; g.cam.yaw = keep.yaw;
      T.t = keep.t; g.setClock(g.clock.y, g.clock.m, g.clock.d, keep.min);
      g.advance(0.3);
    }
    return { checks };
  }, part);
};
