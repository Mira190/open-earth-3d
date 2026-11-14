// Rail for the game: street trams and a funicular, on the lines game.json "rail" carries from
// OpenStreetMap (pipeline/game_data.py). Hong Kong has both: the double-deck "ding ding" trams
// along the north shore of the island, and the Peak Tram up the hill. Each kind is optional and
// takes its dimensions and livery from the city's config (game.rail.<kind>).
//
//   tram       double-deck cars on every tram line, running with traffic on the left or the
//              right (`keep`), stopping every `stop_every_m` and for anyone on the track ahead,
//              ringing their bell as they pull away
//   funicular  two cars on one cable: as one climbs the other comes down, and they pass at the
//              middle of the line. The player can ride one, from end to end.
//   train      a single-track railway with passing loops, stations and level crossings (the Enoden): trains of
//              two-car articulated sets coupled in twos, on a timetable; the player rides between stations,
//              and cars and walkers wait at the crossings (see trainSystem below)
//   gondola    a detachable gondola (Queenstown's Skyline): cabins on a loop of cable, up one
//              side and down the other, slowing through each station round its bullwheel. The
//              line (`lines[0].p`) is the cable's profile from the bottom station up, with its
//              sag between the towers; the towers, stations and cable are the city's landmarks.
//              The player can ride a cabin from one station to the other.
'use strict';
window.OERail = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  // a polyline in decimetres [x, y, z, ...] -> { pts, s (cumulative metres), L, at(s) }
  function line(p) {
    const pts = [];
    for (let k = 0; k < p.length; k += 3) pts.push([p[k] / 10, p[k + 1] / 10, p[k + 2] / 10]);
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const L = s[s.length - 1];
    function at(d) { // position, heading (radians from north, clockwise) and grade at distance d
      d = Math.max(0, Math.min(L, d));
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
      const a = pts[lo], b = pts[hi], t = (d - s[lo]) / Math.max(1e-6, s[hi] - s[lo]);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], run = Math.hypot(dx, dy);
      return { x: a[0] + dx * t, y: a[1] + dy * t, z: a[2] + dz * t, h: Math.atan2(dx, dy), pitch: Math.atan2(dz, run) };
    }
    return { pts, s, L, at };
  }

  // ------------------------------------------------------------ models (model frame: +z forward, +y up, +x to the left)
  function tramModel(o, livery) {
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = o.length_m || 12, Bw = o.width_m || 2.3, Hh = o.height_m || 4.4;
    const paint = new THREE.MeshStandardMaterial({ color: lin(livery), roughness: 0.45 });
    const cream = M.cream, d1 = 0.55, deck = 2.15; // floor above the rail, lower deck height
    kit.add(M.dark, K.box(Bw * 0.8, 0.5, L * 0.86, 0, 0.3, 0)); // bogies and skirt
    kit.add(paint, K.box(Bw, 1.0, L, 0, d1 + 0.5, 0)); // lower panels
    kit.add(paint, K.box(Bw, 0.55, L, 0, d1 + deck + 0.25, 0)); // between the decks
    kit.add(paint, K.box(Bw, 0.35, L, 0, Hh - 0.55, 0)); // upper rail
    kit.add(cream, K.box(Bw * 0.96, 0.18, L * 0.98, 0, Hh - 0.28, 0)); // roof
    kit.add(paint, K.box(Bw * 0.8, 0.12, L * 0.9, 0, Hh - 0.12, 0));
    for (const [y0, h] of [[d1 + 1.0, deck - 1.0 - 0.1], [d1 + deck + 0.5, Hh - 0.7 - (d1 + deck + 0.5)]]) { // window bands, both decks
      kit.add(M.glass, K.box(Bw * 0.99, h, L * 0.97, 0, y0 + h / 2, 0));
      for (let z = -L / 2 + 0.6; z <= L / 2 - 0.5; z += 1.1) kit.add(paint, K.box(Bw * 1.005, h, 0.12, 0, y0 + h / 2, z)); // pillars
    }
    for (const s of [-1, 1]) { // ends: a dash, the destination box and the trolley pole's base
      kit.add(paint, K.box(Bw * 0.96, 1.1, 0.2, 0, d1 + 0.55, s * (L / 2 + 0.08)));
      kit.add(M.black, K.box(1.1, 0.32, 0.06, 0, d1 + deck + 0.25, s * (L / 2 + 0.03)));
      K.lamp(g, s > 0 ? '#fff4d6' : '#ff3b2f', 0, d1 + 0.75, s * (L / 2 + 0.2), 0.7);
    }
    kit.add(M.dark, K.rod([0, Hh, -1.5], [0, Hh + 2.0, -5.4], 0.035)); // trolley pole to the overhead wire
    kit.build(g);
    return g;
  }

  function funicularModel(o) {
    // a car on a slope: its floor is stepped, and the body is built level along its length and
    // pitched with the line, so the car looks level-bodied on the grade like the real ones
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = o.length_m || 28, Bw = o.width_m || 2.8, Hh = o.height_m || 3.3;
    const paint = new THREE.MeshStandardMaterial({ color: lin(o.livery || '#7a1f1f'), roughness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: lin(o.trim || '#e8dcc0'), roughness: 0.5 });
    kit.add(M.dark, K.box(Bw * 0.7, 0.5, L * 0.9, 0, 0.25, 0));
    kit.add(paint, K.box(Bw, 0.9, L, 0, 0.95, 0));
    kit.add(M.glass, K.box(Bw * 0.99, 1.35, L * 0.97, 0, 2.08, 0));
    for (let z = -L / 2 + 0.7; z <= L / 2 - 0.6; z += 1.6) kit.add(paint, K.box(Bw * 1.005, 1.35, 0.14, 0, 2.08, z));
    kit.add(trim, K.box(Bw, 0.12, L, 0, 1.45, 0));
    kit.add(paint, K.box(Bw, 0.4, L, 0, Hh - 0.35, 0));
    kit.add(trim, K.box(Bw * 0.94, 0.14, L * 0.98, 0, Hh - 0.08, 0));
    for (const s of [-1, 1]) kit.add(paint, K.box(Bw, Hh - 0.5, 0.18, 0, (Hh - 0.5) / 2 + 0.4, s * L / 2));
    K.lamp(g, '#fff4d6', 0, 1.2, L / 2 + 0.2, 0.8);
    K.lamp(g, '#fff4d6', 0, 1.2, -L / 2 - 0.2, 0.8);
    kit.build(g);
    return g;
  }


  function cabinModel(o) {
    // a cabin hanging from its grip: the hanger arm, a rounded glazed body with a solid floor band
    // and roof, the doors on the uphill side (model frame: +z forward along the line, +y up; origin
    // at the grip on the cable)
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const Bw = o.width_m || 1.8, L = o.length_m || 1.9, Hh = o.height_m || 2.05, drop = o.hanger_m || 2.6;
    const paint = new THREE.MeshStandardMaterial({ color: lin(o.livery || '#1d2a33'), roughness: 0.35, metalness: 0.3 });
    const trim = new THREE.MeshStandardMaterial({ color: lin(o.trim || '#c9ced1'), roughness: 0.35, metalness: 0.6 });
    const y0 = -drop - Hh; // the floor
    kit.add(trim, K.box(0.5, 0.35, 0.9, 0, -0.1, 0)); // grip and its carriage on the cable
    kit.add(M.dark, K.cyl(0.11, 0.11, 0.9).rotateX(Math.PI / 2).translate(0, -0.05, 0));
    kit.add(trim, K.rod([0, -0.25, 0], [0, -drop * 0.55, -0.18], 0.07)); // the hanger arm, bent to clear the cabin
    kit.add(trim, K.rod([0, -drop * 0.55, -0.18], [0, -drop, 0], 0.07));
    kit.add(trim, K.box(0.9, 0.12, 0.25, 0, -drop + 0.05, 0));
    const plan = K.rrect(Bw, L, 0.35);
    kit.add(paint, K.slab(plan, y0, 0.55, 0.06)); // floor band
    kit.add(M.glassClear, K.slab(K.rrect(Bw * 0.98, L * 0.98, 0.33), y0 + 0.55, Hh - 0.85, 0.02));
    kit.add(paint, K.slab(K.rrect(Bw * 1.01, L * 1.01, 0.35), y0 + Hh - 0.3, 0.3, 0.08)); // roof
    for (const [x, z] of [[Bw / 2 - 0.08, L / 2 - 0.08], [-Bw / 2 + 0.08, L / 2 - 0.08], [Bw / 2 - 0.08, -L / 2 + 0.08], [-Bw / 2 + 0.08, -L / 2 + 0.08]])
      kit.add(paint, K.box(0.1, Hh - 0.8, 0.1, x * 0.97, y0 + 0.55 + (Hh - 0.85) / 2, z * 0.97)); // corner posts
    kit.add(M.seat, K.box(Bw * 0.8, 0.12, 0.42, 0, y0 + 0.45 + 0.42, L / 2 - 0.3)); // the two benches
    kit.add(M.seat, K.box(Bw * 0.8, 0.12, 0.42, 0, y0 + 0.45 + 0.42, -L / 2 + 0.3));
    kit.build(g);
    return g;
  }

  // the track: two rails on sleepers along a line, merged into one mesh per material
  // the sun's glint along each rail (OEWorld.railGlint, world.js): aRail, each vertex's rail direction, from trackMesh
  const glint = mat => (window.OEWorld && OEWorld.railGlint ? OEWorld.railGlint(mat) : mat);

  function trackMesh(ln, gauge, lift, mat, every = 1) {
    const pos = [], idx = [], tan = [];
    glint(mat);
    // a rail: its head, w wide at h, and its two sides 0.14 m down (each face its own vertices, so that the
    // normals stay square), wound to face out: the head had been wound face down, so that from above the
    // rails were culled and only the sleepers showed
    const add = (a, b, w, h) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
      const dz = b[2] - a[2], tl = Math.hypot(l, dz) || 1;
      const quad = (o0, z0, o1, z1) => { // from offset o0 (in half widths, + on the left) at z0 to o1 at z1, a to b
        const n = pos.length / 3;
        for (const p of [a, b]) {
          pos.push(p[0] + nx * o0, p[1] + ny * o0, p[2] + h + z0, p[0] + nx * o1, p[1] + ny * o1, p[2] + h + z1);
          for (let k = 0; k < 2; k++) tan.push(dx / tl, dz / tl, -dy / tl);
        }
        idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      };
      quad(1, 0, -1, 0); // the head, facing up
      quad(-1, 0, -1, -0.14); // the right side, facing right
      quad(1, -0.14, 1, 0); // the left side, facing left
    };
    const P = ln.pts;
    for (let i = 0; i + every < P.length; i += every) {
      const a = P[i], b = P[i + every], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      for (const side of [-1, 1]) {
        const ox = -dy / l * side * gauge / 2, oy = dx / l * side * gauge / 2;
        add([a[0] + ox, a[1] + oy, a[2]], [b[0] + ox, b[1] + oy, b[2]], 0.09, lift);
      }
    }
    const g = new THREE.BufferGeometry();
    const v = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { v[i] = pos[i]; v[i + 1] = pos[i + 2]; v[i + 2] = -pos[i + 1]; }
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.setAttribute('aRail', new THREE.BufferAttribute(new Float32Array(tan), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  const bell = () => { if (window.OEAudio && OEAudio.bell) OEAudio.bell(); };
  // ============================================================ a railway (game.rail.train)
  // One track, trains both ways, as on a Japanese private railway (the Enoden at Kamakura). The line, its
  // passing loops, stations and level crossings come from pipeline/game_rail.py.
  //
  // The timetable is a function of the railway's own clock: a train of each direction every `H` seconds, the
  // two directions meeting in the loops, where each waits for the other (as on the real line: Enoshima,
  // Minegahara, Inamuragasaki). A run is integrated once from the speed limits (the line's, the street's, the
  // points', each curve's) and the stops, then every train is that run shifted in time; so a level crossing's
  // state, the next arrival at a platform and the trains themselves all follow from the clock, and it can be
  // run fast (waiting on a platform), held (someone on the rails in the street) or set (cue) without a
  // collision. If one train is late they all are, as on a single track.
  const TRAIN = {
    acc: 0.75, brake: 0.85, lat: 0.65,      // m/s2: pulling away, braking, and what a curve may ask sideways
    dwell: 22, early: 8, after: 5,          // s: at a platform; in a loop before the other train is due, and after
    warn: 26, armAt: 7, armDown: 6, armUp: 5, clear: 1.5, // s: a crossing's alarm before the train; its arms start, fall, rise
    railTop: 0.05, floor: 1.1, wire: 4.9,   // m: the rail head over the line's level; a car's floor and the contact wire over the rail head
    flash: 1.2, bell: 60 / 130,             // s: the lamps' cycle (50 flashes a minute each), the bell's stroke (130 a minute)
  };
  const STOCK = { // a two-car articulated set, by series (assets/vehicles/trains.json): its length, its bodies' width and roof, its bogie centres, where the middle window's seat is from a body's middle (m), its livery
    enoden_300: { name: '300 series', set_m: 24.1, width_m: 2.4, roof_m: 3.41, bogies_m: 8.7, seat_m: -0.29, body: '#3f7a52', band: '#efe3bf', roof: '#8d9390', doors: 2, windows: 5 },
    enoden_1000: { name: '1000 series', set_m: 25.4, width_m: 2.4, roof_m: 3.4, bogies_m: 9.5, seat_m: -0.91, body: '#1f5a3c', band: '#f1e7c6', roof: '#9a9d9a', line: '#c9a84a', doors: 2, windows: 3 },
    enoden_500: { name: '500 series', set_m: 25.4, width_m: 2.5, roof_m: 3.515, bogies_m: 9.5, seat_m: -0.93, body: '#2a6a47', band: '#f3ead0', roof: '#a4a8a6', line: '#c9a84a', doors: 2, windows: 3 },
  };

  // one body of a set, simply: the stand-in until the modelled one loads (opts.trains), and where it does not
  function bodyStandIn(S, cab) {
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = S.set_m / 2 - 0.15, B = S.width_m, top = S.roof_m, fl = TRAIN.floor; // (heights over the rail head)
    const paint = new THREE.MeshStandardMaterial({ color: lin(S.body), roughness: 0.42 }), band = new THREE.MeshStandardMaterial({ color: lin(S.band), roughness: 0.5 });
    const roof = new THREE.MeshStandardMaterial({ color: lin(S.roof), roughness: 0.7 }), inside = new THREE.MeshStandardMaterial({ color: lin('#8a8f86'), roughness: 0.8 });
    const sill = fl + 0.82, head = sill + 0.88, y0 = 0.42;
    kit.add(M.dark, K.box(B * 0.78, 0.5, L * 0.94, 0, 0.5, 0)); // underframe and its boxes
    for (const z of [-S.bogies_m / 2 + (cab ? 0 : 0), S.bogies_m / 2]) kit.add(M.dark, K.box(B * 0.86, 0.62, 2.3, 0, 0.4, Math.max(-L / 2 + 1.2, Math.min(L / 2 - 1.2, z))));
    kit.add(paint, K.box(B, sill - y0 - 0.3, L, 0, (sill + y0 + 0.3) / 2, 0)); // the lower panels
    kit.add(band, K.box(B, head - sill + 0.24, L, 0, (head + sill) / 2, 0)); // the window band
    kit.add(paint, K.box(B, top - head - 0.32, L, 0, (top + head) / 2 - 0.04, 0)); // over the windows
    kit.add(roof, K.box(B * 0.9, 0.22, L * 0.985, 0, top - 0.02, 0));
    kit.add(roof, K.box(B * 0.55, 0.3, 3.2, 0, top + 0.2, cab ? -1.2 : 1.2)); // the air conditioner
    kit.add(inside, K.box(B * 0.94, 0.06, L * 0.97, 0, fl, 0)); // the floor
    // the glass: a band along each side, the pillars and the doors over it
    for (const sx of [-1, 1]) {
      kit.add(M.glass, K.box(0.03, head - sill - 0.12, L - 1.6, sx * (B / 2 + 0.006), (head + sill) / 2, 0));
      const nd = S.doors, pitch = (L - 3.4) / (nd - 1 || 1);
      for (let d = 0; d < nd; d++) {
        const z = -(L - 3.4) / 2 + d * pitch;
        kit.add(band, K.box(0.05, head - fl - 0.05, 0.95, sx * (B / 2 + 0.012), (head + fl) / 2 + 0.02, z));
        kit.add(M.glass, K.box(0.03, 0.75, 0.6, sx * (B / 2 + 0.04), sill + 0.45, z));
      }
      const nw = S.windows + 3;
      for (let k = 0; k <= nw; k++) kit.add(band, K.box(0.04, head - sill, 0.13, sx * (B / 2 + 0.012), (head + sill) / 2, -(L - 1.6) / 2 + k * (L - 1.6) / nw));
      if (S.line) kit.add(new THREE.MeshStandardMaterial({ color: lin(S.line), roughness: 0.4, metalness: 0.5 }), K.box(0.02, 0.05, L, sx * (B / 2 + 0.012), sill - 0.1, 0));
    }
    // the ends: the cab's face with its windows and lamps, and the gangway at the articulated end
    const zc = (cab ? 1 : -1) * L / 2;
    kit.add(paint, K.box(B, sill - y0 - 0.3, 0.12, 0, (sill + y0 + 0.3) / 2, zc));
    kit.add(band, K.box(B, head - sill + 0.24, 0.12, 0, (head + sill) / 2, zc));
    kit.add(paint, K.box(B, top - head - 0.32, 0.12, 0, (top + head) / 2 - 0.04, zc));
    if (cab) {
      for (const [x, w] of [[-0.78, 0.55], [0, 0.82], [0.78, 0.55]]) kit.add(M.glass, K.box(w, head - sill - 0.14, 0.03, x, (head + sill) / 2, zc + 0.07));
      kit.add(M.black, K.box(0.8, 0.2, 0.03, 0, sill - 0.2, zc + 0.07)); // the destination board
      K.lamp(g, '#fff4d6', -0.82, sill - 0.42, zc + 0.14, 0.55); K.lamp(g, '#fff4d6', 0.82, sill - 0.42, zc + 0.14, 0.55);
      K.lamp(g, '#ff3b2f', -0.82, sill - 0.62, zc + 0.14, 0.3); K.lamp(g, '#ff3b2f', 0.82, sill - 0.62, zc + 0.14, 0.3);
      const pz = zc - Math.sign(zc) * 2.6, py = top + 0.12; // the diamond pantograph over the cab end
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.9, 0.9]) { kit.add(M.dark, K.rod([sx, py, pz + sz], [sx * 0.4, py + 0.7, pz], 0.025)); kit.add(M.dark, K.rod([sx * 0.4, py + 0.7, pz], [sx, py + TRAIN.wire - top - 0.2, pz + sz * 0.1], 0.025)); }
      kit.add(M.dark, K.box(1.5, 0.05, 0.3, 0, TRAIN.wire - TRAIN.railTop + 0.3 - 0.06, pz));
      kit.add(M.dark, K.box(0.5, 0.35, 0.5, 0, 0.75, zc + 0.3)); // the coupler
    }
    // inside: the long seats under the windows and the handrails
    for (const sx of [-1, 1]) kit.add(M.seat, K.box(0.46, 0.42, L - 4.6, sx * (B / 2 - 0.3), fl + 0.24, cab ? -0.6 : 0.6));
    kit.build(g);
    return g;
  }

  function trainSystem(world, G, out, steel, opts) {
    const T = G.rail.train, K = OEKit, M = K.materials();
    const main = line(T.lines[0].p), L = main.L;
    const loops = (T.loops || []).map(l => ({ s0: l.s0, s1: l.s1, side: l.side, ln: line(l.p) }));
    const street = T.street || [];
    const inStreet = s => street.some(([a, b]) => s >= a && s <= b);
    const loopAt = s => loops.findIndex(l => s > l.s0 && s < l.s1);
    // where a train of direction dir (+1 with rising s) is at s: on the left track through a loop
    const tmpA = {};
    function posAt(s, dir) {
      const k = loopAt(s);
      if (k >= 0 && (loops[k].side > 0) === (dir > 0)) { const l = loops[k]; return l.ln.at((s - l.s0) / (l.s1 - l.s0) * l.ln.L); }
      const p = main.at(s);
      if (s < 0 || s > L) { const o = s < 0 ? s : s - L; p.x += Math.sin(p.h) * o; p.y += Math.cos(p.h) * o; } // (past the frame the line runs straight on)
      return p;
    }

    // ---------------------------------------------------------- the stock
    const series = (T.series && T.series.length ? T.series : ['enoden_300', 'enoden_1000', 'enoden_500']).filter(k => STOCK[k]);
    const sets = Math.max(1, T.sets || 2);
    const setLen = Math.max(...series.map(k => STOCK[k].set_m)), trainLen = sets * setLen + (sets - 1) * 0.6, halfT = trainLen / 2;

    // ---------------------------------------------------------- the run of each direction
    const vMax = T.speed_ms || 12.5, vStreet = T.street_speed_ms || 4.2, vLoop = T.loop_speed_ms || 6.9;
    const N = Math.ceil(L), curv = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) { // curvature over 16 m, as a body's two bogies feel it
      const a = main.at(Math.max(0, i - 8)), b = main.at(Math.min(L, i + 8));
      let d = b.h - a.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      curv[i] = Math.abs(d) / 16;
    }
    const limit = s => {
      let v = vMax;
      if (inStreet(s)) v = Math.min(v, vStreet);
      if (loops.some(l => s > l.s0 - 15 && s < l.s1 + 15)) v = Math.min(v, vLoop);
      const c = curv[Math.max(0, Math.min(N, Math.round(s)))];
      if (c > 1e-4) v = Math.min(v, Math.max(3.3, Math.sqrt(TRAIN.lat / c)));
      return v;
    };
    const stationAt = l => (T.stations || []).find(st => st.s > l.s0 - 5 && st.s < l.s1 + 5);
    function run(dir) {
      const U = s => (dir > 0 ? s : L - s); // distance run from where the train comes into the frame
      const stops = [];
      for (const st of T.stations || []) stops.push({ u: U(st.s), st, loop: loops.findIndex(l => st.s > l.s0 - 5 && st.s < l.s1 + 5) });
      loops.forEach((l, k) => { if (!stationAt(l)) stops.push({ u: U((l.s0 + l.s1) / 2), st: null, loop: k }); });
      stops.sort((a, b) => a.u - b.u);
      const cap = new Float32Array(N + 2);
      for (let i = 0; i <= N; i++) cap[i] = limit(dir > 0 ? i : L - i);
      for (const sp of stops) cap[Math.round(sp.u)] = 0;
      cap[N + 1] = cap[N];
      for (let i = N; i >= 0; i--) cap[i] = Math.min(cap[i], Math.sqrt(cap[i + 1] * cap[i + 1] + 2 * TRAIN.brake)); // (ds = 1 m)
      // the legs: seconds at each metre from the stop before (or from coming into the frame)
      const marks = [0, ...stops.map(sp => Math.round(sp.u)), N], legs = [];
      for (let j = 0; j + 1 < marks.length; j++) {
        const ts = [0];
        let v = j === 0 ? cap[0] : 0, t = 0;
        for (let i = marks[j]; i < marks[j + 1]; i++) {
          const v1 = Math.min(cap[i + 1] || 0, Math.sqrt(v * v + 2 * TRAIN.acc));
          t += v + v1 > 0.05 ? 2 / (v + v1) : Math.sqrt(2 / TRAIN.acc);
          v = v1; ts.push(t);
        }
        legs.push(ts);
      }
      return { dir, U, stops, marks, legs };
    }
    const runs = { 1: run(1), [-1]: run(-1) };
    // the headway: long enough for both directions to get from every loop to the next between two meets
    let need = 0;
    for (const R of [runs[1], runs[-1]]) {
      let acc = 0, open = false;
      R.stops.forEach((sp, j) => {
        if (open) acc += R.legs[j][R.legs[j].length - 1];
        if (sp.loop >= 0) { if (open) need = Math.max(need, acc + TRAIN.early + TRAIN.after); acc = 0; open = true; } else if (open) acc += TRAIN.dwell;
      });
    }
    const H = Math.max(T.headway_s || 720, 2 * need + 4), Kl = loops.length;
    // each run as a timeline: [t, u] knots, the stops' arrivals and departures; t = 0 at the first meet
    for (const R of [runs[1], runs[-1]]) {
      const first = R.stops.findIndex(sp => sp.loop >= 0), tl = [], n = R.stops.length;
      const arr = new Array(n).fill(0), dep = new Array(n).fill(0);
      let m = 0;
      if (first < 0) { // no loop in the frame: straight through
        let t = 0;
        R.stops.forEach((sp, j) => { t += R.legs[j][R.legs[j].length - 1]; arr[j] = t; t += TRAIN.dwell; dep[j] = t; });
      } else {
        dep[first] = TRAIN.after; arr[first] = -TRAIN.early - 6;
        for (let j = first - 1; j >= 0; j--) { dep[j] = arr[j + 1] - R.legs[j + 1][R.legs[j + 1].length - 1]; arr[j] = dep[j] - TRAIN.dwell; }
        for (let j = first + 1; j < n; j++) {
          arr[j] = dep[j - 1] + R.legs[j][R.legs[j].length - 1];
          if (R.stops[j].loop >= 0) { m++; dep[j] = Math.max(arr[j] + TRAIN.early, m * H / 2) + TRAIN.after; } else dep[j] = arr[j] + TRAIN.dwell;
        }
      }
      const t0 = (n ? arr[0] : 0) - R.legs[0][R.legs[0].length - 1];
      const push = (ts, from, base) => { for (let i = 0; i < ts.length; i++) tl.push(base + ts[i], from + i); };
      push(R.legs[0], 0, t0);
      for (let j = 0; j < n; j++) push(R.legs[j + 1], R.marks[j + 1], dep[j]);
      R.t = new Float64Array(tl.filter((_, i) => i % 2 === 0)); R.u = new Float32Array(tl.filter((_, i) => i % 2 === 1));
      R.t0 = t0; R.t1 = R.t[R.t.length - 1]; R.arr = arr; R.dep = dep;
      // geography fixes the other direction's phase: both must be in each loop at once
      R.c = R.dir > 0 ? 0 : (((1 - Kl) % 2) + 2) % 2 * H / 2;
      R.uAt = tau => { // metres run at time tau of the run, and the speed there
        const t = R.t; let lo = 0, hi = t.length - 1;
        if (tau <= t[0]) return [R.u[0], 0];
        if (tau >= t[hi]) return [R.u[hi], 0];
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= tau) lo = mid; else hi = mid; }
        const dt = t[hi] - t[lo], f = dt > 1e-9 ? (tau - t[lo]) / dt : 0;
        return [R.u[lo] + (R.u[hi] - R.u[lo]) * f, dt > 1e-9 ? (R.u[hi] - R.u[lo]) / dt : 0];
      };
      R.tAt = u => { // when the run first reaches u metres (the knots are a metre apart, a stop a pair at one u)
        const U = R.u; let lo = 0, hi = U.length - 1;
        if (u <= U[0]) return R.t[0];
        if (u >= U[hi]) return R.t[hi];
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (U[mid] < u) lo = mid; else hi = mid; }
        const du = U[hi] - U[lo];
        return R.t[lo] + (du > 1e-9 ? (u - U[lo]) / du : 0) * (R.t[hi] - R.t[lo]);
      };
    }
    const span = Math.max(runs[1].t1 - runs[1].t0, runs[-1].t1 - runs[-1].t0), POOL = Math.max(2, Math.ceil(span / H) + 1);

    // ---------------------------------------------------------- stations, as the game's rail stations
    const stations = (T.stations || []).map(st => {
      const p = main.at(st.s), k = loops.findIndex(l => st.s > l.s0 - 5 && st.s < l.s1 + 5);
      const o = { id: st.id, name: st.name, native: st.native, d: st.s, s: st.s, side: st.side, p0: st.p0, p1: st.p1, loop: k, r: Math.max(26, (st.p1 - st.p0) / 2 + 8), train: true };
      // where each direction's train is boarded: the middle of its platform (pipeline/game_rail.py platforms)
      o.plat = {};
      for (const pf of T.platforms || []) if (pf.station === st.id) for (const d of pf.dirs) o.plat[d] = { x: pf.origin[0] + pf.axis[0] * pf.length_m / 2, y: pf.origin[1] + pf.axis[1] * pf.length_m / 2, z: pf.z };
      for (const d of [1, -1]) if (!o.plat[d]) o.plat[d] = o.plat[-d] || { x: p.x, y: p.y, z: p.z };
      const q = o.plat[1]; o.x = q.x; o.y = q.y; o.z = q.z;
      return o;
    });
    for (const st of stations) out.stations.push(st);

    // ---------------------------------------------------------- the track, its bed, the wire and its poles
    {
      // (the rails a little towards the eye in depth: in a street and over a crossing they lie in the road's surface)
      const rails = new THREE.MeshStandardMaterial({ color: lin('#6f6258'), roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -60 });
      rails.name = 'rail_steel'; // (the landmarks' rails' name: the look finds them by it)
      // what a walker meets of the railway (game.js lays them into the collision world): the bed every 2 m of open track,
      // its top over the rail's foot, and the platforms' furniture, each a box { x, y, h, hl, hw, zlo, zhi } (h: radians
      // from north; half-lengths along and across it)
      out.bed = []; out.solids = [];
      const bedMat = new THREE.MeshStandardMaterial({ color: lin('#7d776c'), roughness: 0.95 }), tie = new THREE.MeshStandardMaterial({ color: lin('#4a4038'), roughness: 0.9 });
      const wireMat = new THREE.MeshStandardMaterial({ color: lin('#3a3a38'), roughness: 0.6, metalness: 0.5 }), poleMat = new THREE.MeshStandardMaterial({ color: lin('#8b8d88'), roughness: 0.7, metalness: 0.3 });
      const gauge = T.gauge_m || 1.067;
      const strips = { bed: [], idx: [] }, ties = [];
      const ribbon = (ln, a, b, w, lift, skirt) => { // a strip along ln from a to b, w wide at lift, with sides falling `skirt`
        const pos = strips.bed, idx = strips.idx;
        let prev = -1;
        for (let s = a; s <= b + 1e-6; s += 2) {
          const p = ln.at(Math.min(b, s)), nx = -Math.cos(p.h), ny = Math.sin(p.h), n = pos.length / 3;
          for (const [o, dz] of [[-w / 2 - skirt * 1.4, -skirt], [-w / 2, 0], [w / 2, 0], [w / 2 + skirt * 1.4, -skirt]]) pos.push(p.x + nx * o, p.z + lift + dz, -(p.y + ny * o));
          if (prev >= 0) for (let k = 0; k < 3; k++) idx.push(prev + k, n + k, prev + k + 1, prev + k + 1, n + k, n + k + 1);
          prev = n;
        }
      };
      const tracks = [[main, 0, L, null]].concat(loops.map(l => [l.ln, 0, l.ln.L, l]));
      for (const [ln, a, b, lp] of tracks) {
        // open track: ballast and sleepers; in the street the rails lie in the road
        const open = [];
        if (lp) open.push([a, b]);
        else { let s0 = 0; for (const [u, v] of street) { if (u > s0) open.push([s0, u]); s0 = v; } if (s0 < L) open.push([s0, L]); }
        for (const [u, v] of open) {
          ribbon(ln, u, v, 2.5, TRAIN.railTop - 0.13, 0.5);
          for (let s = u; s <= v; s += 0.66) { const p = ln.at(s); ties.push(p); }
          for (let s = u + 1; s < v; s += 2) { const p = ln.at(s); out.bed.push({ x: p.x, y: p.y, h: p.h, top: p.z + TRAIN.railTop - 0.13, hl: 1.05, hw: 1.95 }); } // (the bed to the game's walkers, game.js)
        }
        const rm = trackMesh(ln, gauge, TRAIN.railTop, rails); rm.renderOrder = 1; world.add(rm);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strips.bed), 3)); g.setIndex(strips.idx); g.computeVertexNormals();
      const bed = new THREE.Mesh(g, bedMat); bed.receiveShadow = true; world.add(bed);
      const tm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.14, 0.22), tie, ties.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
      ties.forEach((p, i) => { e.set(-p.pitch, Math.PI - p.h, 0, 'YXZ'); m4.compose(W(p.x, p.y, p.z + TRAIN.railTop - 0.13), q.setFromEuler(e), one); tm.setMatrixAt(i, m4); });
      tm.receiveShadow = true; world.add(tm);
      // the contact wire and its messenger over every track, hung from poles every 36 m on the side away from the platform
      const kit = new K.Kit();
      const wire = (ln, a, b, y, r) => { const pts = []; for (let s = a; s <= b + 1e-6; s += 6) { const p = ln.at(Math.min(b, s)); pts.push([p.x, p.z + y, -p.y]); } if (pts.length > 1) for (let i = 0; i + 1 < pts.length; i++) kit.add(wireMat, K.rod(pts[i], pts[i + 1], r, r, 4)); };
      for (const [ln, a, b] of tracks) wire(ln, a, b, TRAIN.wire + TRAIN.railTop, 0.012);
      for (let s = 12; s < L; s += 36) {
        const p = main.at(s), k = loopAt(s), st = stations.find(o => s > o.p0 - 4 && s < o.p1 + 4);
        let side = st && st.loop < 0 ? -(st.side || 1) : 1, reach = 2.6;
        if (k >= 0) { side = Math.sign(loops[k].side); reach = Math.abs(loops[k].side) + 2.6; }
        else if (inStreet(s)) reach = 3.6;
        const nx = -Math.cos(p.h) * side, ny = Math.sin(p.h) * side, bx = p.x + nx * reach, by = p.y + ny * reach, top = p.z + TRAIN.railTop + TRAIN.wire + 1.0;
        kit.add(poleMat, K.rod([bx, p.z - 0.3, -by], [bx, top + 0.3, -by], 0.11, 0.09, 8));
        const tx = p.x - nx * 0.6, ty = p.y - ny * 0.6; // the bracket arm out over the track, and its stay
        kit.add(poleMat, K.rod([bx, top - 0.45, -by], [tx, top - 0.45, -ty], 0.035, 0.035, 5));
        kit.add(poleMat, K.rod([bx, top + 0.2, -by], [tx, top - 0.4, -ty], 0.02, 0.02, 4));
        kit.add(wireMat, K.rod([p.x, top - 0.45, -p.y], [p.x, p.z + TRAIN.railTop + TRAIN.wire, -p.y], 0.012, 0.012, 4));
      }
      // the platforms: a slab along the track with a ramp at each end, a yellow line, and a shelter over the middle
      const plat = new THREE.MeshStandardMaterial({ color: lin('#a9a59b'), roughness: 0.9 }), edge = new THREE.MeshStandardMaterial({ color: lin('#e6c21c'), roughness: 0.7 });
      const timber = new THREE.MeshStandardMaterial({ color: lin('#6b5a48'), roughness: 0.85 }), tin = new THREE.MeshStandardMaterial({ color: lin('#5d6b66'), roughness: 0.6, metalness: 0.3 });
      for (const sp of T.platforms || []) {
        const [ax, ay] = sp.axis, h = Math.atan2(ax, ay), rot = new THREE.Matrix4().makeRotationY(Math.PI - h), len = sp.length_m, wdt = sp.half_width * 2;
        const at = (u, v, z) => new THREE.Matrix4().makeTranslation(sp.origin[0] + ax * u - ay * v, z, -(sp.origin[1] + ay * u + ax * v)).multiply(rot);
        kit.add(plat, K.box(wdt, sp.height_m + 0.5, len), at(len / 2, 0, sp.z - sp.height_m / 2 - 0.25));
        for (const u of [-sp.ramp_m / 2, len + sp.ramp_m / 2]) if (!sp.ramps || sp.ramps[u < 0 ? 0 : 1]) kit.add(plat, K.box(wdt, 0.12, Math.hypot(sp.ramp_m, sp.height_m)).rotateX((u < 0 ? -1 : 1) * Math.atan2(sp.height_m, sp.ramp_m)), at(u, 0, sp.z - sp.height_m / 2 - 0.06));
        for (const ts of sp.track_side ? [sp.track_side] : [1, -1]) {
          kit.add(edge, K.box(0.3, 0.012, len), at(len / 2, ts * (sp.half_width - 0.75), sp.z + 0.008));
          // (its edge over the track holds a walker on the platform, and one on the track off it)
          out.solids.push({ x: sp.origin[0] + ax * len / 2 - ay * ts * (sp.half_width + 0.05), y: sp.origin[1] + ay * len / 2 + ax * ts * (sp.half_width + 0.05), h: Math.atan2(ax, ay), hl: len / 2, hw: 0.05, zlo: sp.z - sp.height_m - 0.3, zhi: sp.z + 1.0 });
        }
        if (sp.shelter !== false && len > 12) { // posts, a pent roof falling away from the track, a bench and a back rail
          const sl = Math.min(len - 6, 22), tsd = sp.track_side || 1, back = sp.track_side ? -tsd * (sp.half_width - 0.25) : 0;
          const solid = (u, v, hl, hw, z0, z1) => out.solids.push({ x: sp.origin[0] + ax * u - ay * v, y: sp.origin[1] + ay * u + ax * v, h, hl, hw, zlo: z0, zhi: z1 });
          for (let u = -sl / 2; u <= sl / 2 + 0.01; u += sl / 4) { kit.add(timber, K.box(0.14, 2.7, 0.14), at(len / 2 + u, back, sp.z + 1.35)); solid(len / 2 + u, back, 0.1, 0.1, sp.z, sp.z + 2.7); }
          kit.add(tin, K.box(wdt + 0.5, 0.08, sl + 1).rotateZ(sp.track_side * 0.08), at(len / 2, 0, sp.z + 2.78));
          kit.add(timber, K.box(0.45, 0.06, sl * 0.5), at(len / 2, back + tsd * 0.3, sp.z + 0.45)); solid(len / 2, back + tsd * 0.3, sl * 0.25, 0.25, sp.z, sp.z + 0.5);
          kit.add(timber, K.box(0.06, 1.0, sl), at(len / 2, back, sp.z + 0.6)); solid(len / 2, back, sl / 2, 0.06, sp.z, sp.z + 1.1);
        }
      }
      kit.build(world);
    }

    // ---------------------------------------------------------- level crossings
    const lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.12, 0.08) }), lampOff = new THREE.MeshStandardMaterial({ color: lin('#3a0d0b'), roughness: 0.4 });
    const yellow = new THREE.MeshStandardMaterial({ color: lin('#e8bf12'), roughness: 0.6 }), black = new THREE.MeshStandardMaterial({ color: lin('#161616'), roughness: 0.6 });
    const grey = new THREE.MeshStandardMaterial({ color: lin('#8f918c'), roughness: 0.6, metalness: 0.3 }), red = new THREE.MeshStandardMaterial({ color: lin('#b3211c'), roughness: 0.5 });
    const crossings = (T.crossings || []).map(c => {
      const o = { id: c.id, name: c.name, kind: c.kind, x: c.at[0], y: c.at[1], z: c.at[2], s: c.s, h: c.h, road_h: c.road_h, half_m: c.half_m, width_m: c.width_m, closed: false, t: 1e9, arm: 0, lamps: [], arms: [], win: {} };
      if (c.kind === 'street') return o;
      // the alarm's window in each direction's run: from `warn` before the nose is at the crossing until the tail is clear
      for (const R of [runs[1], runs[-1]]) { const u = R.U(c.s); o.win[R.dir] = [R.tAt(u - halfT - c.half_m) - TRAIN.warn, R.tAt(u + halfT + c.half_m) + TRAIN.clear]; }
      // its gear: on each approach a post on the left of the road (Japan keeps left) with the cross, two lamps and the
      // bell's speaker, and by it a barrier across the road (a road's; a path has the post alone)
      const w = Math.min(8, c.width_m), gated = c.kind === 'gated';
      for (const a of [1, -1]) {
        const ht = c.road_h + (a < 0 ? Math.PI : 0), fx = Math.sin(ht), fy = Math.cos(ht), lx = -fy, ly = fx;
        const bx = c.at[0] - fx * (c.half_m + 1.7) + lx * (w / 2 + 0.45), by = c.at[1] - fy * (c.half_m + 1.7) + ly * (w / 2 + 0.45);
        const g = new THREE.Group(), kit = new K.Kit();
        g.position.copy(W(bx, by, c.at[2])); g.rotation.y = Math.PI - ht;
        for (let k = 0; k < 11; k++) kit.add(k % 2 ? black : yellow, K.cyl(0.057, 0.057, 0.3, 10), 0, 0.15 + k * 0.3, 0);
        for (const r of [-1, 1]) kit.add(yellow, K.box(1.2, 0.18, 0.02).rotateZ(r * 0.654), 0, 3.05, -0.07); // the cross, 75 degrees between its boards
        kit.add(black, K.box(0.2, 0.2, 0.025), 0, 3.05, -0.075);
        kit.add(black, K.box(0.86, 0.3, 0.05), 0, 2.42, -0.03); // the lamps' backboard
        kit.add(grey, K.cyl(0.11, 0.07, 0.2, 10).rotateX(Math.PI / 2), 0, 3.42, 0); // the speaker
        kit.add(grey, K.box(0.3, 0.5, 0.26), 0, 0.25, 0.3); // the relay case at its foot
        kit.build(g);
        for (const [x, ph] of [[-0.26, 0], [0.26, 1]]) for (const zf of [-0.07, 0.07]) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16).rotateX(Math.PI / 2), lampOff);
          m.position.set(x, 2.42, zf); g.add(m); o.lamps.push([m, ph]);
        }
        if (gated) { // the barrier's machine and its arm: yellow and black, 0.8 m over the road when down
          const mk = new K.Kit(), arm = new THREE.Group(), ak = new K.Kit();
          mk.add(grey, K.box(0.34, 1.0, 0.34), -0.5, 0.5, 0.25); mk.build(g);
          arm.position.set(-0.5, 0.85, 0.05);
          const len = w + 0.3;
          for (let u = 0, k = 0; u < len; k++) { const d = Math.min(len - u, k % 2 ? 0.2 : 0.3); ak.add(k % 2 ? black : yellow, K.box(d, 0.07, 0.045), -(u + d / 2) - 0.1, 0, 0); u += d; }
          ak.add(grey, K.box(0.5, 0.16, 0.1), 0.2, 0, 0); // the counterweight end
          for (const u of [0.35, 0.7]) ak.add(red, K.cyl(0.04, 0.04, 0.05, 10).rotateX(Math.PI / 2), -len * u, 0, 0.03);
          ak.build(arm); arm.rotation.z = -1.4;
          g.add(arm); o.arms.push([arm, a]);
        }
        world.add(g);
      }
      return o;
    });

    // ---------------------------------------------------------- the trains
    const slots = [];
    for (const dir of [1, -1]) for (let i = 0; i < POOL; i++) {
      const bodies = [], g = new THREE.Group();
      for (let k = 0; k < sets; k++) {
        const key = series[(i * 2 + k + (dir > 0 ? 0 : 1)) % series.length], S = STOCK[key];
        for (const cab of [1, -1]) { // the set's two bodies: the leading one's cab ahead, the other's behind, joined over the shared bogie
          const m = new THREE.Group(), inner = new THREE.Group(), mid = (sets - 1) / 2 * (setLen + 0.6) - k * (setLen + 0.6);
          if (cab < 0) inner.rotation.y = Math.PI;
          inner.add(bodyStandIn(S, true)); m.add(inner);
          bodies.push({ m, inner, cab, joint: mid, off: mid + cab * S.set_m / 4, S, key }); g.add(m);
        }
      }
      g.visible = false; world.add(g);
      const car = { id: slots.length, train: true, dir, slot: i, g, bodies, name: STOCK[bodies[0].key].name, rider: false, x: 0, y: 0, z: 0, h: 0, pitch: 0, speed: 0, s: 0, live: false, stop: -1, k: null };
      slots.push(car); out.cars.push(car);
    }
    const st = { clk: (T.start_s != null ? T.start_s : 0.31 * H), rate: 1, hold: false, bellAt: 0, rang: -1 };
    // the run time of train k of a direction now, and which k each slot carries
    const tauOf = (R, k) => st.clk - (k * H + R.c);
    function place(car) {
      const R = runs[car.dir], kTop = Math.floor((st.clk - R.c - R.t0) / H);
      let k = kTop - ((((kTop - car.slot) % POOL) + POOL) % POOL); // the newest train whose number is this slot's
      const tau = tauOf(R, k);
      const was = car.stop, wasLive = car.live && car.k === k;
      car.k = k; car.live = tau >= R.t0 && tau <= R.t1;
      car.g.visible = car.live;
      if (!car.live) { car.stop = -1; car.speed = 0; return; }
      const [u, v] = R.uAt(tau);
      car.s = car.dir > 0 ? u : L - u; car.speed = v; car.tau = tau;
      car.stop = R.stops.findIndex((sp, j) => tau >= R.arr[j] - 0.05 && tau <= R.dep[j] + 0.05);
      const c = posAt(car.s, car.dir);
      car.x = c.x; car.y = c.y; car.z = c.z + TRAIN.railTop; car.h = car.dir > 0 ? c.h : c.h + Math.PI; car.pitch = car.dir > 0 ? c.pitch : -c.pitch;
      for (const b of car.bodies) { // each body from the set's shared bogie to its own, so a set bends in the middle through a curve
        const sj = car.s + car.dir * b.joint, j = posAt(sj, car.dir), o = posAt(sj + car.dir * b.cab * b.S.bogies_m, car.dir);
        const dx = (o.x - j.x) * b.cab, dy = (o.y - j.y) * b.cab, dz = (o.z - j.z) * b.cab, run2 = Math.hypot(dx, dy) || 1, half = b.S.set_m / 4 * b.cab;
        b.h = Math.atan2(dx, dy); b.pitch = Math.atan2(dz, run2);
        b.x = j.x + dx / run2 * half; b.y = j.y + dy / run2 * half; b.z = j.z + dz / run2 * half + TRAIN.railTop;
        b.m.position.copy(W(b.x, b.y, b.z));
        b.m.rotation.order = 'YXZ'; b.m.rotation.set(-b.pitch, Math.PI - b.h, 0);
      }
      if (car.rider && wasLive) {
        if (was >= 0 && car.stop < 0) out.events.push({ type: 'depart', car });
        if (was < 0 && car.stop >= 0 && R.stops[car.stop].st) out.events.push({ type: 'arrive', car });
      }
    }
    const stationOfCar = car => { const sp = car.live && car.stop >= 0 ? runs[car.dir].stops[car.stop] : null; return sp && sp.st ? stations.find(o => o.id === sp.st.id) : null; };
    const prevStationOf = out.stationOf;
    out.stationOf = id => { const c = out.cars[id]; return c && c.train ? stationOfCar(c) : prevStationOf ? prevStationOf(id) : null; };
    // when the next train of a direction is at a stop of its run (s from now), and the nearest of both at a station
    function due(R, j, from = st.clk) { const a = R.arr[j]; const k = Math.ceil((from - R.c - a) / H); return k * H + R.c + a - from; }
    const prevEta = out.eta;
    out.eta = station => {
      if (!station || !station.train) return prevEta ? prevEta(station) : 0;
      let best = Infinity;
      for (const R of [runs[1], runs[-1]]) { const j = R.stops.findIndex(sp => sp.st && sp.st.id === station.id); if (j >= 0) best = Math.min(best, due(R, j)); }
      return best;
    };
    const ends = T.towards || ['the west', 'the east']; // where a -1 train and a +1 train are bound
    out.towards = car => ends[car.dir > 0 ? 1 : 0];
    out.nextStop = car => { const R = runs[car.dir]; const sp = R.stops.find((q, j) => q.st && R.arr[j] > car.tau + 0.1); return sp ? stations.find(o => o.id === sp.st.id) : null; };
    out.alightAt = car => { const o = stationOfCar(car); if (!o) return null; const q = o.plat[car.dir]; return [q.x, q.y, q.z]; };
    out.departsIn = car => (car.stop >= 0 ? Math.max(0, runs[car.dir].dep[car.stop] - car.tau) : 0);
    // inside: where a rider stands (the second body, by the doors) and the eyes of the views from the seat and the cab
    const scenic = T.scenic_bearing_deg != null ? T.scenic_bearing_deg * Math.PI / 180 : null;
    const sideOf = car => { // +1: the left of the train is the side to look out of (the sea's)
      if (scenic == null) return 1;
      const b = car.bodies[0]; return Math.sin(scenic - b.h) < 0 ? 1 : -1;
    };
    // a point in a body: lx m to its left, ly over the rail head, lz ahead of its middle
    const inBody = (b, lx, ly, lz) => ({ x: b.x - Math.cos(b.h) * lx + Math.sin(b.h) * lz, y: b.y + Math.sin(b.h) * lx + Math.cos(b.h) * lz, z: b.z + ly });
    out.riderPos = c => {
      if (!c.train) return null;
      const sd = sideOf(c), b = c.bodies[1], q = inBody(b, sd * 0.4, TRAIN.floor + 0.03, -1.6);
      return { x: q.x, y: q.y, z: q.z, h: b.h - sd * Math.PI / 2 - Math.PI }; // (the game turns a rider round: facing out of the window)
    };
    out.eye = (c, mode) => {
      const sd = sideOf(c), b = c.bodies[mode === 'cab' ? 0 : 1];
      if (mode === 'cab') { const q = inBody(b, 0.3, TRAIN.floor + 1.5, b.S.set_m / 4 - 1.3); return { x: q.x, y: q.y, z: q.z, h: b.h, pitch: b.pitch }; }
      // on the long seat across the aisle, looking over it out of the windows on the sea's side, as a passenger sits
      // (the second body stands back to back with the first: its windows mirrored)
      const q = inBody(b, -sd * (b.S.width_m / 2 - 0.55), TRAIN.floor + 1.12, b.S.seat_m * b.cab);
      return { x: q.x, y: q.y, z: q.z, h: b.h - sd * 1.45, pitch: -0.06 };
    };
    // every body as a box (cars.js boxOf's shape), for what must keep clear of a train
    out.trainBoxes = () => {
      const o = [];
      for (const c of slots) if (c.live) for (const b of c.bodies) o.push({ x: b.x, y: b.y, z: b.z - TRAIN.railTop, h: b.h, hl: b.S.set_m / 4, hw: b.S.width_m / 2, top: b.S.roof_m + 0.6, len: b.S.set_m / 2, wid: b.S.width_m, v: c.speed, ref: c });
      return o;
    };
    // the lowered arms as boxes (cars.js pushOut's shape): someone on foot does not walk through one
    out.gateBoxes = (x, y, r) => {
      const o = [];
      for (const c of shut) if (c.arm > 0.6 && Math.abs(c.x - x) < r + 12 && Math.abs(c.y - y) < r + 12) for (const [, a] of c.arms) {
        const ht = c.road_h + (a < 0 ? Math.PI : 0), fx = Math.sin(ht), fy = Math.cos(ht);
        o.push({ x: c.x - fx * (c.half_m + 1.65), y: c.y - fy * (c.half_m + 1.65), z: c.z, h: ht + Math.PI / 2, hl: Math.min(8, c.width_m) / 2 + 0.3, hw: 0.12, top: 1.15, ref: c });
      }
      return o;
    };
    out.crossings = crossings;
    // for someone walking at (x, y) the way (hx, hy): how far to the line to wait behind at a closed crossing just
    // ahead (m), or null. Someone already between the gates walks on out.
    let shut = [];
    out.gateAhead = (x, y, hx, hy) => {
      for (const c of shut) {
        const dx = c.x - x, dy = c.y - y;
        if (Math.abs(dx) > 14 || Math.abs(dy) > 14) continue;
        const tx = Math.sin(c.h), ty = Math.cos(c.h), across = dx * -ty + dy * tx, along = dx * tx + dy * ty, zone = 1.9;
        if (Math.abs(along) > c.width_m / 2 + 3 || Math.abs(across) < zone || Math.abs(across) > zone + 3.5) continue;
        if ((hx * -ty + hy * tx) * across <= 0.15) continue; // (not walking towards the rails)
        return Math.max(0, Math.abs(across) - zone - 0.7);
      }
      return null;
    };
    out.crossingClosed = (x, y, r = 6) => crossings.find(c => c.closed && Math.hypot(c.x - x, c.y - y) < r + c.half_m) || null;
    // bring the next train's nose to the line at s in `seconds` (a film's cue, a photo spot's arrival): the clock is set, not run
    out.cue = (s, seconds = 30, dir = 0) => {
      let best = Infinity;
      for (const R of [runs[1], runs[-1]]) {
        if (dir && R.dir !== dir) continue;
        const a = R.tAt(R.U(s) - halfT), k = Math.ceil((st.clk - R.c - a) / H);
        best = Math.min(best, k * H + R.c + a - st.clk);
      }
      if (best < Infinity) st.clk += best - seconds;
      for (const c of slots) { c.live = false; place(c); }
      out.updateTrain(0, [], false);
      for (const c of crossings) if (c.on != null) c.arm = c.on >= 0 ? Math.min(1, Math.max(0, (c.on - TRAIN.armAt) / TRAIN.armDown)) : 0;
      return best;
    };
    // the distance along the line nearest a point
    out.sNear = (x, y) => { let bs = 0, bd = Infinity; for (let i = 0; i < main.pts.length; i++) { const d = Math.hypot(main.pts[i][0] - x, main.pts[i][1] - y); if (d < bd) { bd = d; bs = main.s[i]; } } return bs; };
    // set the clock so that a train of direction dir has stood at a station for `since` seconds; the train
    out.cueStation = (id, dir = 1, since = 3) => {
      const R = runs[dir], j = R.stops.findIndex(sp => sp.st && sp.st.id === id);
      if (j < 0) return null;
      st.clk += due(R, j) + since;
      for (const c of slots) { c.live = false; place(c); }
      out.updateTrain(0, [], false);
      return slots.find(c => c.dir === dir && c.live && c.stop === j) || null;
    };
    // the modelled bodies (assets/vehicles/trains.glb, blender/build_trains.py) in place of the stand-ins, once loaded:
    // each series' node by its name, and its decimated copy for a train far off
    out.useModels = scene => {
      const tune = o => o.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; const mt = q.material; if (mt && mt.name === 'Glass') { mt.transparent = true; mt.depthWrite = false; mt.opacity = 0.3; q.castShadow = false; q.renderOrder = 2; } if (mt && /^Light_/.test(mt.name)) { mt.emissiveIntensity = mt.name === 'Light_Cabin' ? 0.9 : 1.6; mt.toneMapped = false; } } });
      for (const c of slots) for (const b of c.bodies) {
        const name = b.key.replace(/^enoden/, 'Enoden'), src = scene.getObjectByName(name), far = scene.getObjectByName(name + '_LOD1');
        if (!src) continue;
        b.inner.clear();
        b.near = src.clone(); b.near.position.set(0, 0, 0); tune(b.near); b.inner.add(b.near);
        if (far) { b.far = far.clone(); b.far.position.set(0, 0, 0); tune(b.far); b.far.visible = false; b.inner.add(b.far); }
      }
      out.train.modelled = true;
    };
    out.train = { T, H, runs, slots, stations, crossings, loops, state: st, length_m: trainLen, posAt, main, modelled: false };

    out.updateTrain = (dt, people, skip) => {
      // someone on the rails ahead of a train in the street: the railway waits (its clock slows to a stand)
      let block = false;
      for (const c of slots) if (c.live && c.speed > 0.05 && inStreet(c.s + c.dir * (halfT + 6))) {
        for (const ahead of [halfT + 3, halfT + 8, halfT + 13]) {
          const p = posAt(Math.max(0, Math.min(L, c.s + c.dir * ahead)), c.dir);
          for (const q of people) if (q && Math.hypot(q.x - p.x, q.y - p.y) < 2.6 && Math.abs((q.z || 0) - p.z) < 3) block = true;
          if (out.blocked && out.blocked(p.x, p.y, p.z, c)) block = true;
        }
      }
      st.hold = block;
      st.rate += Math.max(-dt * 0.9, Math.min(dt * 0.5, (block ? 0 : 1) - st.rate));
      const dtc = dt * st.rate * (skip ? 8 : 1);
      st.clk += dtc;
      for (const c of slots) place(c);
      const eyeAt = out.ear;
      if (eyeAt && out.train.modelled) for (const c of slots) if (c.live) for (const b of c.bodies) if (b.far) { const farOff = Math.hypot(b.x - eyeAt.x, b.y - eyeAt.y) > 170 && !c.rider; if (b.far.visible !== farOff) { b.far.visible = farOff; b.near.visible = !farOff; } }
      // the crossings: the alarm from the clock, the lamps alternating, the arms by how long it has been on
      const me = out.ear || people[0];
      let near = null, nd = 160;
      for (const c of crossings) {
        if (c.kind === 'street') continue;
        let on = -1, off = 1e9; // seconds since the alarm began; since it ended
        for (const R of [runs[1], runs[-1]]) {
          const [a, b] = c.win[R.dir], k0 = Math.floor((st.clk - R.c - a) / H);
          for (const k of [k0, k0 - 1]) { const tau = st.clk - (k * H + R.c); if (tau >= a && tau <= b) on = Math.max(on, tau - a); else if (tau > b) off = Math.min(off, tau - b); }
        }
        const want = on >= TRAIN.armAt ? 1 : 0, arm = c.arm + Math.max(-dtc / TRAIN.armUp, Math.min(dtc / TRAIN.armDown, want - c.arm));
        const alarm = on >= 0 || (c.arms.length > 0 && arm > 0.02);
        if (alarm !== c.closed) { c.closed = alarm; c.t = 0; } else c.t += dt;
        c.arm = arm; c.on = on;
        const ph = Math.floor(st.clk / (TRAIN.flash / 2)) % 2;
        for (const [m, p] of c.lamps) { const want = alarm && p === ph ? lampOn : lampOff; if (m.material !== want) m.material = want; }
        const e = arm * arm * (3 - 2 * arm);
        for (const [g] of c.arms) g.rotation.z = -1.4 * (1 - e);
        if (alarm && me) { const d = Math.hypot(c.x - me.x, c.y - me.y); if (d < nd) { nd = d; near = c; } }
      }
      shut = crossings.filter(c => c.closed);
      out.bellAt = near;
      if (near && window.OEAudio && OEAudio.kan) { // the electronic bell, by the clock so that every crossing strikes together
        const n = Math.floor(st.clk / TRAIN.bell);
        if (n !== st.rang) { st.rang = n; OEAudio.kan(Math.max(0, 1 - nd / 160) ** 1.6); }
      }
    };
    for (const c of slots) place(c);
  }


  function create(world, G, opts = {}) {
    const R = G.rail || {}, out = { trams: [], cars: [], stations: [], events: [] };
    const steel = new THREE.MeshStandardMaterial({ color: lin('#8a8f92'), roughness: 0.35, metalness: 0.7 });

    // ---------------------------------------------------------- trams
    if (R.tram && R.tram.lines.length) {
      const T = R.tram, lines = T.lines.map(l => line(l.p));
      const keepLeft = (T.keep || 'left') === 'left';
      // the direction each track runs: with a parallel track beside it, the side of the road
      // traffic keeps to; a single track runs both ways
      const dirs = lines.map((ln, i) => {
        let best = null, bd = 40;
        const mid = ln.at(ln.L / 2);
        lines.forEach((o, j) => {
          if (j === i) return;
          for (let k = 0; k < o.pts.length; k += 2) { const d = Math.hypot(o.pts[k][0] - mid.x, o.pts[k][1] - mid.y); if (d < bd) { bd = d; best = o.pts[k]; } }
        });
        if (!best) return 0;
        const cross = Math.sin(mid.h) * (best[1] - mid.y) - Math.cos(mid.h) * (best[0] - mid.x); // > 0: the other track is on our left
        return (cross < 0) === keepLeft ? 1 : -1;
      });
      lines.forEach(ln => world.add(trackMesh(ln, T.gauge_m || 1.067, 0.04, steel)));
      const liveries = T.liveries || ['#0f6b3a'];
      const per = T.spacing_m || 260;
      lines.forEach((ln, i) => {
        const n = Math.max(1, Math.floor(ln.L / per));
        for (let k = 0; k < n; k++) {
          const dir = dirs[i] || (k % 2 ? 1 : -1);
          const model = tramModel(T, liveries[(i * 7 + k * 3) % liveries.length]);
          world.add(model);
          out.trams.push({ ln, dir, d: (k + 0.5) * ln.L / n, v: 0, vmax: T.speed_ms || 5.5, wait: (k * 7) % 15, nextStop: 0, model });
        }
      });
    }

    // ---------------------------------------------------------- funicular
    if (R.funicular && R.funicular.lines.length) {
      const F = R.funicular, ln = line(F.lines[0].p);
      world.add(trackMesh(ln, F.gauge_m || 1.524, 0.25, steel));
      // sleepers and a concrete bed under the track
      const bedGeo = new THREE.BoxGeometry(1, 1, 1), bed = new THREE.InstancedMesh(bedGeo, new THREE.MeshStandardMaterial({ color: lin('#9c978c'), roughness: 0.9 }), Math.ceil(ln.L / 4) + 1);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
      let nb = 0;
      for (let s = 0; s <= ln.L; s += 4) {
        const p = ln.at(s);
        e.set(-p.pitch, Math.PI - p.h, 0, 'YXZ');
        m4.compose(W(p.x, p.y, p.z + 0.1), q.setFromEuler(e), sc.set(3.0, 0.3, 4.05));
        bed.setMatrixAt(nb++, m4);
      }
      bed.count = nb; bed.receiveShadow = true;
      world.add(bed);
      const ends = [{ id: F.stations?.[0]?.id || 'lower', name: F.stations?.[0]?.name || 'Lower terminus', d: 0 },
        { id: F.stations?.[1]?.id || 'upper', name: F.stations?.[1]?.name || 'Upper terminus', d: ln.L }];
      for (const st of ends) { const p = ln.at(st.d); out.stations.push(Object.assign(st, { x: p.x, y: p.y, z: p.z })); }
      const halfL = (F.length_m || 28) / 2, margin = halfL + 2;
      // two cars on one cable: car 0 starts at the bottom, car 1 at the top
      for (let k = 0; k < 2; k++) {
        const model = funicularModel(F);
        world.add(model);
        out.cars.push({ id: k, name: F.car_names ? F.car_names[k] : `Car ${k + 1}`, model, rider: false });
      }
      const cyc = { s: 0, phase: 'dwell', t: F.dwell_s || 40, dir: 1 }; // s: car 0's distance from its start
      const span = ln.L - 2 * margin, vmax = F.speed_ms || 6, acc = 0.6;
      out.funicular = { ln, cyc, span, margin, vmax };
      out.carAt = k => { // a car's distance along the line: car 0 from the bottom, car 1 mirrored
        const s0 = margin + cyc.s;
        return k === 0 ? s0 : ln.L - s0;
      };
      out.stationOf = k => { // the station a car is standing at, or null
        if (cyc.phase !== 'dwell') return null;
        const d = out.carAt(k);
        return out.stations.reduce((b, st) => (Math.abs(st.d - d) < margin + 3 ? st : b), null);
      };
      out.eta = () => (cyc.phase === 'dwell' ? cyc.t : Math.max(0, (span - (cyc.dir > 0 ? cyc.s : span - cyc.s)) / Math.max(1, vmax)) + (F.dwell_s || 40)); // until the next arrival at either end
      out.updateFunicular = (dt, skip) => {
        const steps = skip ? 8 : 1;
        for (let n = 0; n < steps; n++) {
          if (cyc.phase === 'dwell') {
            cyc.t -= dt;
            if (cyc.t <= 0) { cyc.phase = 'run'; cyc.v = 0; out.events.push({ type: 'depart' }); }
          } else {
            const left = cyc.dir > 0 ? span - cyc.s : cyc.s;
            const want = Math.min(vmax, Math.sqrt(2 * acc * Math.max(0, left)) + 0.2);
            cyc.v = Math.min(want, (cyc.v || 0) + acc * dt);
            cyc.s += cyc.dir * cyc.v * dt;
            if ((cyc.dir > 0 && cyc.s >= span) || (cyc.dir < 0 && cyc.s <= 0)) {
              cyc.s = cyc.dir > 0 ? span : 0; cyc.dir *= -1; cyc.phase = 'dwell'; cyc.t = F.dwell_s || 40; cyc.v = 0;
              out.events.push({ type: 'arrive' });
            }
          }
        }
        for (const c of out.cars) {
          const d = out.carAt(c.id), p = ln.at(d);
          if (c.id === 1 && F.passing_loop) { // the second car takes the loop's other track
            const [l0, l1, side] = F.passing_loop, ramp = Math.min(1, Math.max(0, Math.min(d - l0, l1 - d) / 25));
            const k = side * ramp * ramp * (3 - 2 * ramp);
            p.x += -Math.cos(p.h) * k; p.y += Math.sin(p.h) * k;
          }
          c.x = p.x; c.y = p.y; c.z = p.z; c.h = p.h; c.pitch = p.pitch;
          c.model.position.copy(W(p.x, p.y, p.z + 0.35));
          c.model.rotation.set(0, 0, 0);
          c.model.rotation.order = 'YXZ';
          c.model.rotation.y = Math.PI - p.h;
          c.model.rotation.x = -p.pitch;
          c.speed = cyc.phase === 'run' ? cyc.v : 0;
        }
      };
      out.updateFunicular(0, false);
    }


    // ---------------------------------------------------------- gondola
    if (R.gondola && R.gondola.lines.length) {
      const Q = R.gondola, ln = line(Q.lines[0].p), half = (Q.track_m || 5.6) / 2;
      const v = Q.speed_ms || 4, slow = 0.35, dwellM = Math.PI * half + 2 * (Q.platform_m || 8); // through a station: the platform, the bullwheel, the platform
      const tRun = ln.L / v, tSt = dwellM / slow, T = 2 * (tRun + tSt);
      const n = Q.cabins || Math.round(2 * ln.L / (Q.spacing_m || 60));
      const ends = [{ id: Q.stations?.[0]?.id || 'lower', name: Q.stations?.[0]?.name || 'Lower station', d: 0 },
        { id: Q.stations?.[1]?.id || 'upper', name: Q.stations?.[1]?.name || 'Upper station', d: ln.L }];
      for (const st of ends) { const p = ln.at(st.d); out.stations.push(Object.assign(st, { x: p.x, y: p.y, z: p.z })); }
      // a cabin's place on the loop at loop time t: [0, tSt) round the bottom station, then up, round the top, down
      const place = t => {
        t = ((t % T) + T) % T;
        const side = sgn => (d, extra = 0) => { const p = ln.at(d), r = sgn * (half + extra); return { x: p.x + Math.cos(p.h) * r, y: p.y - Math.sin(p.h) * r, z: p.z, h: sgn > 0 ? p.h : p.h + Math.PI, pitch: sgn > 0 ? p.pitch : -p.pitch }; };
        const up = side(1), down = side(-1);
        const station = (u, top) => { // u: metres through the station; down track in, round the wheel, up track out (bottom); mirrored at the top
          const P = Q.platform_m || 8, d0 = top ? ln.L : 0, dir = top ? 1 : -1; // dir: away from the line, into the station
          const at = ln.at(d0), ux = Math.sin(at.h) * dir, uy = Math.cos(at.h) * dir, rx = Math.cos(at.h), ry = -Math.sin(at.h);
          const from = top ? 1 : -1; // the side the cabin comes in on: down track at the bottom, up track at the top
          let a, b, h;
          if (u < P) { a = u; b = from; h = Math.atan2(ux, uy); }
          else if (u < P + Math.PI * half) { const th = (u - P) / half; a = P + Math.sin(th) * half; b = from * Math.cos(th); h = Math.atan2(ux, uy) + from * th * (top ? -1 : 1); }
          else { a = P - (u - P - Math.PI * half); b = -from; h = Math.atan2(-ux, -uy); }
          return { x: at.x + ux * a + rx * b * half, y: at.y + uy * a + ry * b * half, z: at.z, h, pitch: 0, station: top ? 1 : 0 };
        };
        if (t < tSt) return station(t * slow, false);
        t -= tSt;
        if (t < tRun) return Object.assign(up(t * v), { run: 1, d: t * v });
        t -= tRun;
        if (t < tSt) return station(t * slow, true);
        t -= tSt;
        return Object.assign(down(ln.L - t * v), { run: -1, d: ln.L - t * v });
      };
      for (let k = 0; k < n; k++) {
        const model = cabinModel(Q);
        world.add(model);
        out.cars.push({ id: k, name: `${Q.cabin_name || 'Cabin'} ${k + 1}`, model, rider: false, t0: k * T / n });
      }
      const clock = { t: 0 };
      out.gondola = { ln, T, tRun, tSt, n, clock };
      out.funicular = { cyc: { get t() { return out.eta(); } } }; // what the HUD reads for the wait
      out.stationOf = k => { const c = out.cars[k]; return c && c.st != null ? out.stations[c.st] : null; };
      out.eta = () => T / n; // a cabin comes round every T / n seconds
      // the rider stands in the middle of the cabin, its floor under the grip
      out.riderPos = c => ({ x: c.x, y: c.y, z: c.z - (Q.hanger_m || 2.6) - (Q.height_m || 2.05) + 0.05, h: c.h });
      out.updateGondola = (dt, skip) => {
        clock.t += dt * (skip ? 8 : 1);
        for (const c of out.cars) {
          const p = place(clock.t + c.t0), was = c.st;
          c.x = p.x; c.y = p.y; c.z = p.z; c.h = p.h; c.pitch = p.pitch;
          c.st = p.station != null ? p.station : null;
          c.speed = p.station != null ? slow : v;
          if (c.rider && was != null && c.st == null) out.events.push({ type: 'depart' });
          if (c.rider && was == null && c.st != null) out.events.push({ type: 'arrive' });
          const sway = p.run ? Math.sin(clock.t * 0.9 + c.id) * 0.025 : 0;
          c.model.position.copy(W(p.x, p.y, p.z));
          c.model.rotation.order = 'YXZ';
          c.model.rotation.set(sway, Math.PI - p.h, 0);
        }
      };
      out.updateGondola(0, false);
    }

    // ---------------------------------------------------------- a railway
    if (R.train && R.train.lines && R.train.lines.length) trainSystem(world, G, out, steel, opts);

    // ---------------------------------------------------------- per frame
    out.update = (dt, clockT, people, skip) => {
      for (const t of out.trams) {
        // stop for anyone standing on the track within 14 m ahead
        const ahead = t.ln.at(t.d + t.dir * 8);
        let blocked = false;
        for (const p of people) if (p && Math.hypot(p.x - ahead.x, p.y - ahead.y) < 4.5 && Math.abs((p.z || 0) - ahead.z) < 3) blocked = true;
        if (t.wait > 0) {
          t.wait -= dt; t.v = 0;
          if (t.wait <= 0 && people[0] && Math.hypot(people[0].x - t.x, people[0].y - t.y) < 70) bell();
        } else {
          const vmax = blocked ? 0 : t.vmax;
          t.v += Math.max(-2.5 * dt, Math.min(0.9 * dt, vmax - t.v));
          t.d += t.dir * t.v * dt;
          t.nextStop -= t.v * dt;
          if (t.nextStop <= 0 && !blocked) { t.wait = 12 + (t.d % 7); t.nextStop = (G.rail.tram.stop_every_m || 250); }
          if (t.d > t.ln.L || t.d < 0) { t.dir *= -1; t.d = Math.max(0, Math.min(t.ln.L, t.d)); t.wait = 25; } // the end of the line: change ends
        }
        const p = t.ln.at(t.d);
        t.x = p.x; t.y = p.y; t.z = p.z;
        t.model.position.copy(W(p.x, p.y, p.z));
        t.model.rotation.y = Math.PI - p.h + (t.dir < 0 ? Math.PI : 0);
      }
      if (out.updateFunicular) out.updateFunicular(dt, skip);
      if (out.updateGondola) out.updateGondola(dt, skip);
      if (out.updateTrain) out.updateTrain(dt, people, skip);
    };
    return out;
  }

  return { create, line };
})();
