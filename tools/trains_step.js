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
// Returns { none } in a city without a railway, or { checks: [[ok, what]] }.
module.exports = async function trainsStep(p) {
  return p.evaluate(() => {
    const g = window.__game, T = g.trains, checks = [], A = window.OEAudio;
    if (!T) return { none: true };
    const pl = g.player, keep = { x: pl.x, y: pl.y, z: pl.z, h: pl.h, yaw: g.cam.yaw, t: T.t, min: g.clock.min };
    if (!A.on) A.start();
    const wasMuted = A.muted;
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
    // ---- on the platform: where the map's travel point puts you
    const st = T.station, tp = (g.G.travel || []).find(q => Math.hypot(q.at[0] - st.at[0], q.at[1] - st.at[1]) < 200) || { at: st.at };
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
        for (const K of Object.values(T.kinds)) for (const m of K.meshes.slice(0, 1)) for (let i = 0; i < m.count; i++) {
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
    checks.push([['approach', 'arrive', 'close'].every(w => said.includes(w)) && !!first && first.ja.includes(`${n}番線`) && first.en.includes(`track ${n}`) && !!cap && cap.textContent.length > 10,
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
    return { checks };
  });
};
