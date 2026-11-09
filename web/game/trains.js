// Heavy rail for the game: the trains of a main line running past and stopping at a station, on the
// tracks game.json "trains" carries (a city's own builder: cities/tokyo/rail.py lays Tokyo's from
// OpenStreetMap's tracks through Yurakucho). rail.js is the street trams, the funicular and the gondola;
// this is the railway you watch from a platform.
//
//   tracks    each a course at rail level in the direction of travel ([x, y, z, ...] in decimetres), the
//             distance along it where a stopping train's middle rests (stop_m) and its platform's number,
//             and the stretch its cars are drawn on (hide_m: between the train sheds' mouths at the ends)
//   services  what runs on a track: the stock, the number of cars, a headway and an offset in seconds,
//             whether it stops, and the hours when it runs through instead (rapid_h)
//   station   its name, where it is, and how far its announcements carry (hear_m)
//
// A train's place is a function of the time alone (cruise, brake at 0.9 m/s2, stand, pull away), so the
// timetable needs no state and a harness can ask where any train is at any second. The cars are drawn
// instanced, one draw call per material of each kind of car, whatever the number of trains.
//
// Sound (audio.js): each of the nearest trains has its rumble, its wheels over the rail joints and its
// motors' whine, placed left or right of the camera; the platform's chime and announcements, the
// departure melody and the doors' chime play while you are within the station's hearing. The
// announcements are spoken by the browser's own voices (speechSynthesis, Japanese then English) where
// it has them, and always shown as a caption. Nothing sounds when no train is near and nothing is said.
'use strict';
window.OETrains = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const ACC = 0.9, DWELL = 26;
  const HEAR = 240; // a train is heard from this far (m): from the station and the streets beside the line, not across the city

  // a course in decimetres [x, y, z, ...] -> { L, at(d) }: the position and bearing d metres along it
  function course(p) {
    const n = p.length / 3, xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n), s = new Float32Array(n);
    for (let k = 0; k < n; k++) { xs[k] = p[k * 3] / 10; ys[k] = p[k * 3 + 1] / 10; zs[k] = p[k * 3 + 2] / 10; if (k) s[k] = s[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]); }
    const L = s[n - 1];
    function at(d, out) {
      const dd = Math.max(0, Math.min(L, d));
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= dd) lo = m; else hi = m; }
      const t = (dd - s[lo]) / Math.max(1e-6, s[hi] - s[lo]), dx = xs[hi] - xs[lo], dy = ys[hi] - ys[lo], l = Math.hypot(dx, dy) || 1;
      // past either end the course runs straight on, so a train comes in from and goes out to beyond it
      out.x = xs[lo] + dx * t + (d - dd) * dx / l; out.y = ys[lo] + dy * t + (d - dd) * dy / l; out.z = zs[lo] + (zs[hi] - zs[lo]) * t;
      return out;
    }
    return { L, at };
  }

  // ------------------------------------------------------------ the rolling stock
  // Model frame: +z forward, +y up from the top of the rail, +x to the left. Each kind of car is a list of
  // [material, geometry]; the materials are shared by every kind.
  // Dimensions: JR East's 20 m commuter stock (E233, E235: 19.5 m body, 2.95 m wide, 3.62 m to the roof,
  // floor 1.13 m over the rail, four pairs of doors a side 1.3 m wide) and JR Central's N700S (25 m cars,
  // 3.36 m wide, 3.6 m high, the end cars 27.35 m with a nose of 10.7 m).
  const STOCK = {
    e235: { len: 20, band: null, door: '#8fc31f', face: '#8fc31f', pan: [1, 4, 7, 9] },            // Yamanote: yellow-green doors and face
    e233k: { len: 20, band: ['#00a7e3'], door: null, face: '#00a7e3', pan: [1, 4, 7] },            // Keihin-Tohoku: a sky blue band
    e233t: { len: 20, band: ['#f68b1e', '#0d6b38'], door: null, face: '#f68b1e', pan: [2, 5, 8, 11, 13] }, // Tokaido: orange over green
    n700s: { len: 25, shinkansen: true, pan: [4, 11] },
  };
  let MATS = null;
  function saloon(yb, yt) {
    const m = new THREE.MeshStandardMaterial({ color: lin('#10171d'), roughness: 0.06, metalness: 0.4, emissive: lin('#ffdcae'), emissiveIntensity: 0.03 });
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLit; varying float vCar;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLit = position;\n#ifdef USE_INSTANCING\n  vCar = float( gl_InstanceID );\n#else\n  vCar = 0.0;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLit; varying float vCar;\nfloat litHash( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { // someone in every other half metre, seated or standing: a head and shoulders against the light
    float u = vLit.z / 0.52 + vCar * 3.7, c = floor( u ), fx = ( fract( u ) - 0.5 ) * 0.52, y = vLit.y - ${yb.toFixed(3)};
    float tall = 0.26 + 0.5 * litHash( c + 9.0 );
    float who = step( litHash( c ), 0.55 ) * max( step( abs( fx ), 0.19 ) * step( y, tall - 0.11 ), step( length( vec2( fx, y - tall ) ), 0.115 ) );
    float up = clamp( y / ${(yt - yb).toFixed(3)}, 0.0, 1.0 );
    totalEmissiveRadiance *= ( 0.6 + 0.55 * up ) * ( 1.0 - 0.74 * who ); }`);
    };
    m.customProgramCacheKey = () => `train-saloon|${yb}`;
    return m;
  }
  function mats() {
    if (MATS) return MATS;
    const std = o => new THREE.MeshStandardMaterial(o);
    const glass = OEKit.materials().glass; // dark by day, lit from inside after dark (OEKit.setNight)
    MATS = {
      steel: std({ color: lin('#c3c8cb'), roughness: 0.36, metalness: 0.72 }),
      roof: std({ color: lin('#8d9194'), roughness: 0.7, metalness: 0.2 }),
      under: std({ color: lin('#26292c'), roughness: 0.8, metalness: 0.2 }),
      black: std({ color: lin('#101214'), roughness: 0.35, metalness: 0.3 }),
      white: std({ color: lin('#f3f5f4'), roughness: 0.3, metalness: 0.15 }),
      blue: std({ color: lin('#123f8c'), roughness: 0.35, metalness: 0.1 }),
      // a saloon seen through its windows: dark glass by day; as the light goes its lamps show, with the people
      // in it dark against them (a commuter car's windows from 1.93 m over the rail, a Shinkansen's from 1.99 m)
      lit: saloon(1.93, 2.85), litS: saloon(1.99, 2.51),
      glass,
      paint: {},
    };
    return MATS;
  }
  const paint = hex => (mats().paint[hex] || (mats().paint[hex] = new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.4, metalness: 0.15 })));

  function commuter(S, role) { // role: 'head' (cab at +z), 'tail' (cab at -z), 'mid', 'pan' (mid with a pantograph)
    const K = OEKit, M = mats(), out = [], add = (m, g) => out.push([m, g]);
    const L = 19.5, Wd = 2.95, f = 1.0, top = 3.62, hw = Wd / 2;
    add(M.under, K.box(Wd * 0.86, 0.62, L * 0.9, 0, 0.62, 0)); // the underframe's equipment
    for (const z of [-6.9, 6.9]) { // bogies: frames and four wheels
      add(M.under, K.box(2.3, 0.42, 3.1, 0, 0.45, z));
      for (const dz of [-1.05, 1.05]) for (const sx of [-1, 1]) add(M.under, K.cyl(0.43, 0.43, 0.14, 14).rotateZ(Math.PI / 2).translate(sx * 0.6, 0.43, z + dz));
    }
    // the body: a core at the glass's plane, and the steel skin 3 cm proud of it below and above the windows and
    // between them, so the windows sit back in the side as they do
    const skin = 0.03, w0 = f + 0.93, w1 = f + 1.85, yt = top - 0.16;
    add(M.steel, K.box(Wd - 2 * skin, yt - f, L, 0, (yt + f) / 2, 0));
    add(M.roof, K.box(Wd * 0.88, 0.16, L * 0.99, 0, top - 0.08, 0)); // the roof
    for (const z of [-4.2, 4.2]) add(M.roof, K.box(1.9, 0.3, 3.4, 0, top + 0.13, z)); // the air conditioners
    const doors = [-7.23, -2.41, 2.41, 7.23], wins = [[-9.3, -8.2], [-6.26, -3.38], [-1.44, 1.44], [3.38, 6.26], [8.2, 9.3]];
    for (const sx of [-1, 1]) {
      const xs = sx * (hw - skin / 2), xg = sx * (hw - skin + 0.004);
      add(M.steel, K.box(skin, w0 - f, L, xs, (w0 + f) / 2, 0)); // below the windows
      add(M.steel, K.box(skin, yt - w1, L, xs, (yt + w1) / 2, 0)); // above them
      let z = -L / 2;
      for (const [z0, z1] of wins) { // the pillars between the windows (the doors stand in them), and the glass
        add(M.steel, K.box(skin, w1 - w0, z0 - z, xs, (w0 + w1) / 2, (z + z0) / 2));
        add(M.lit, K.box(0.008, w1 - w0, z1 - z0, xg, (w0 + w1) / 2, (z0 + z1) / 2));
        z = z1;
      }
      add(M.steel, K.box(skin, w1 - w0, L / 2 - z, xs, (w0 + w1) / 2, (z + L / 2) / 2));
      const x = sx * (hw + 0.006);
      for (const dz of doors) {
        add(S.door ? paint(S.door) : M.steel, K.box(0.014, 1.86, 1.3, x, f + 0.98, dz)); // a pair of leaves
        for (const e of [-0.33, 0.33]) add(M.lit, K.box(0.02, 0.74, 0.4, x, f + 1.42, dz + e)); // their windows
        add(M.black, K.box(0.022, 1.86, 0.025, x, f + 0.98, dz));
        for (const e of [-0.66, 0.66]) add(M.black, K.box(0.018, 1.9, 0.02, x, f + 0.98, dz + e)); // the door's frame
      }
      if (S.band) {
        const n = S.band.length;
        S.band.forEach((c, i) => add(paint(c), K.box(0.012, 0.2 / n + 0.02, L - 0.1, x, f + 0.78 - i * 0.2 / n, 0)));
        add(paint(S.band[0]), K.box(0.012, 0.07, L - 0.1, x, f + 2.02, 0));
      }
    }
    if (role === 'pan') pantograph(out, top + 0.28, 4.6);
    for (const [r, s] of [['head', 1], ['tail', -1]]) {
      if (role !== r) continue;
      const z = s * (L / 2 + 0.012);
      add(M.black, K.box(Wd * 0.98, 2.15, 0.05, 0, f + 1.42, z)); // the cab's black face
      add(M.glass, K.box(Wd * 0.86, 0.95, 0.06, 0, f + 1.62, z));
      add(paint(S.face), K.box(Wd * 0.98, 0.62, 0.06, 0, f + 0.36, z)); // and the line's colour under it
      add(M.lit, K.box(1.1, 0.2, 0.07, 0, f + 2.3, z)); // the destination display
      add(M.under, K.box(Wd * 0.8, 0.5, 0.5, 0, 0.5, s * (L / 2 - 0.1))); // the skirt
    }
    return out;
  }

  function pantograph(out, y, z) { // a single-arm pantograph, raised to the wire at 5.0 m
    const K = OEKit, M = mats(), up = 5.0 - y - 0.06;
    out.push([M.under, K.box(1.3, 0.1, 1.8, 0, y, z)]);
    out.push([M.under, K.rod([0, y, z - 0.7], [0, y + up * 0.5, z + 0.5], 0.035)]);
    out.push([M.under, K.rod([0, y + up * 0.5, z + 0.5], [0, y + up, z - 0.2], 0.03)]);
    out.push([M.under, K.box(1.7, 0.05, 0.3, 0, y + up, z - 0.2)]);
  }

  // a body section for the Shinkansen: flat floor, sides leaning in a little, a round shoulder into the roof
  function section(hw, y0, y1) {
    const r = Math.min(0.75, hw * 0.45), pts = [[-hw * 0.94, y0], [hw * 0.94, y0], [hw, y0 + 0.5]];
    for (let k = 0; k <= 5; k++) { const a = k / 5 * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, y1 - r + Math.sin(a) * r]); }
    for (let k = 5; k >= 0; k--) { const a = k / 5 * Math.PI / 2; pts.push([-(hw - r) - Math.cos(a) * r, y1 - r + Math.sin(a) * r]); }
    pts.push([-hw, y0 + 0.5]);
    return pts;
  }
  function loft(secs) { // [{z, pts}] with the same number of points -> a closed skin
    const pos = [], idx = [], n = secs[0].pts.length;
    for (const s of secs) for (const [x, y] of s.pts) pos.push(x, y, s.z);
    for (let i = 0; i < secs.length - 1; i++) for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n;
      idx.push(a, b, c, b, d, c);
    }
    for (const base of [0, (secs.length - 1) * n]) for (let j = 1; j < n - 1; j++) { if (base) idx.push(base, base + j, base + j + 1); else idx.push(base, base + j + 1, base + j); } // the ends' caps
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function shinkansen(S, role) {
    const K = OEKit, M = mats(), out = [], add = (m, g) => out.push([m, g]);
    const Wd = 3.36, hw = Wd / 2, y0 = 0.28, top = 3.6;
    const nose = role === 'head' || role === 'tail', s = role === 'tail' ? -1 : 1;
    // the body: 24.5 m for a middle car; an end car's saloon is 14 m and its nose 10.7 m
    const zb0 = nose ? -12.25 : -12.25, zb1 = nose ? 1.6 : 12.25, secs = [{ z: zb0, pts: section(hw, y0, top) }, { z: zb1, pts: section(hw, y0, top) }];
    if (nose) { // the nose: the roof comes down in a long curve, the sides draw in, the tip a low wide lip
      const N = 12;
      for (let k = 1; k <= N; k++) {
        const t = k / N, z = zb1 + 10.7 * t;
        const h = top - (top - 1.05) * Math.pow(t, 1.35), w = hw * (1 - 0.72 * Math.pow(t, 2.6)), lift = y0 + 0.22 * t * t;
        secs.push({ z, pts: section(Math.max(0.32, w), lift, Math.max(lift + 0.55, h)) });
      }
    }
    const g = loft(secs);
    if (s < 0) g.rotateY(Math.PI);
    add(M.white, g);
    const Z = z => s * z;
    // bogies under the skirts, the blue lines under the windows, the windows
    for (const z of nose ? [-8.6, 1.0] : [-8.75, 8.75]) add(M.under, K.box(2.4, 0.5, 3.0, 0, 0.35, Z(z)));
    const a = zb0 + 0.3, b = nose ? zb1 + 3.2 : zb1 - 0.3;
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.008);
      add(M.blue, K.box(0.03, 0.13, b - a, x, 1.62, Z((a + b) / 2)));
      add(M.blue, K.box(0.03, 0.04, b - a, x, 1.47, Z((a + b) / 2)));
      for (let z = a + 1.7; z < (nose ? zb1 - 0.4 : b - 1.6); z += 1.04) add(M.litS, K.box(0.02, 0.52, 0.58, x, 2.25, Z(z)));
      add(M.white, K.box(0.03, 1.95, 0.75, x, 1.55, Z(a + 0.7))); // a door at the car's end
      add(M.litS, K.box(0.036, 0.4, 0.3, x, 2.3, Z(a + 0.7)));
    }
    add(M.roof, K.box(1.2, 0.08, (nose ? 12 : 23), 0, top + 0.02, Z(nose ? -5.5 : 0)));
    if (role === 'pan') { add(M.white, K.box(2.6, 0.5, 5.0, 0, top + 0.2, 3.0)); pantograph(out, top + 0.3, 3.0); } // behind its noise shields
    if (nose) { // the driver's windows high on the nose, and the lamps on its shoulders
      add(M.glass, K.ellipsoid(0.82, 0.3, 1.25, 12, 8).rotateX(-0.36 * s).translate(0, 2.86, Z(zb1 + 2.75)));
    }
    return out;
  }

  // ------------------------------------------------------------ the caption and the voice
  let capEl = null, capT = 0;
  function caption(ja, en) {
    if (!capEl) {
      capEl = document.createElement('div');
      capEl.id = 'g-announce';
      capEl.setAttribute('aria-live', 'polite');
      const small = window.innerWidth < 560;
      Object.assign(capEl.style, { position: 'fixed', left: 0, right: 0, margin: '0 auto', width: 'fit-content', bottom: `calc(env(safe-area-inset-bottom, 0px) + ${small ? 150 : 118}px)`, maxWidth: 'min(88vw, 720px)',
        padding: small ? '7px 12px 8px' : '9px 16px 10px', borderRadius: '10px', background: 'rgba(8, 12, 18, 0.62)', backdropFilter: 'blur(10px)', webkitBackdropFilter: 'blur(10px)', color: '#f4efe6',
        font: '500 14px/1.4 "Inter Tight", "Public Sans", system-ui, sans-serif', letterSpacing: '0.01em', textAlign: 'center', pointerEvents: 'none', zIndex: 30,
        borderLeft: '3px solid #8fc31f', opacity: 0, transition: 'opacity 0.35s ease' });
      (document.getElementById('game') || document.body).appendChild(capEl);
    }
    const small = window.innerWidth < 560;
    capEl.innerHTML = `<div lang="ja" style="font-size:${small ? 12 : 15}px">${ja}</div><div style="opacity:0.78;font-size:${small ? 11 : 13}px">${en}</div>`;
    capEl.style.opacity = 1;
    capT = 4 + ja.length * 0.16;
  }
  let voices = null;
  function voice(lang, deep) {
    const ss = window.speechSynthesis;
    if (!ss) return null;
    if (!voices || !voices.length) voices = ss.getVoices();
    const mine = voices.filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(lang));
    return mine.find(v => /female|kyoko|haruka|nanami|sayaka|samantha|aria|jenny/i.test(v.name) !== deep) || mine[0] || null;
  }
  // says it in Japanese and then in English, at the level the distance gives; false where the browser has no voice
  function say(ja, en, level, deep) {
    const ss = window.speechSynthesis, A = window.OEAudio;
    if (!ss || !window.SpeechSynthesisUtterance || (A && (A.muted || !A.on)) || level <= 0.03) return false;
    if (ss.speaking || ss.pending) return false; // one announcement at a time: a second is only shown
    let any = false;
    for (const [text, lang, rate] of [[ja, 'ja', 1.05], [en, 'en', 1.0]]) {
      const v = voice(lang, deep);
      if (!v) continue;
      const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
      u.voice = v; u.lang = v.lang; u.rate = rate; u.pitch = deep ? 0.85 : 1.1; u.volume = Math.min(1, level);
      ss.speak(u); any = true;
    }
    return any;
  }

  // ------------------------------------------------------------ the railway
  function create(world, G, o = {}) {
    const R = G.trains, tracks = {}, tmp = { x: 0, y: 0, z: 0 }, tmp2 = { x: 0, y: 0, z: 0 };
    for (const t of R.tracks) tracks[t.id] = Object.assign({}, t, { c: course(t.p) });
    const hour = o.hour || (() => 12);
    // each service's run: how long a train takes from its head at the course's start until its tail has left
    const services = R.services.filter(s => tracks[s.track]).map((s, i) => {
      const tr = tracks[s.track], S = STOCK[s.stock] || STOCK.e233k, len = s.cars * S.len;
      return Object.assign({ i, tr, S, len, x0: -len / 2 - 4, x1: tr.c.L + len / 2 + 4 }, s);
    });
    // where a train's middle is `tau` seconds after it sets out, its speed, and what it is doing
    function run(s, tau, stops, out) {
      const v = s.v_ms;
      if (!stops || s.tr.stop_m == null) { out.x = s.x0 + v * tau; out.v = v; out.a = 0; out.ph = 'run'; out.T = (s.x1 - s.x0) / v; return out; }
      const db = v * v / (2 * ACC), tb = v / ACC, t1 = (s.tr.stop_m - db - s.x0) / v, t2 = t1 + tb, t3 = t2 + DWELL, t4 = t3 + tb;
      out.t1 = t1; out.t2 = t2; out.t3 = t3; out.T = t4 + (s.x1 - s.tr.stop_m - db) / v;
      if (tau < t1) { out.x = s.x0 + v * tau; out.v = v; out.a = 0; out.ph = 'in'; }
      else if (tau < t2) { const u = tau - t1; out.x = s.tr.stop_m - db + v * u - ACC * u * u / 2; out.v = v - ACC * u; out.a = -1; out.ph = 'brake'; }
      else if (tau < t3) { out.x = s.tr.stop_m; out.v = 0; out.a = 0; out.ph = 'stand'; }
      else if (tau < t4) { const u = tau - t3; out.x = s.tr.stop_m + ACC * u * u / 2; out.v = ACC * u; out.a = 1; out.ph = 'pull'; }
      else { out.x = s.tr.stop_m + db + v * (tau - t4); out.v = v; out.a = 0; out.ph = 'out'; }
      return out;
    }
    const stopsNow = s => !!s.stops && !(s.rapid_h && hour() >= s.rapid_h[0] && hour() < s.rapid_h[1]);

    // the cars, instanced: per stock and role, one mesh per material
    const kinds = {}, dummy = new THREE.Object3D();
    function kind(stockId, role) {
      const key = `${stockId}|${role}`;
      if (kinds[key]) return kinds[key];
      const S = STOCK[stockId], parts = (S.shinkansen ? shinkansen : commuter)(S, role), by = new Map();
      for (const [m, g] of parts) { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (a !== 'position' && a !== 'normal') q.deleteAttribute(a); if (!by.has(m)) by.set(m, []); by.get(m).push(q); }
      const cap = 2 * Math.max(...services.filter(s => s.stock === stockId).map(s => s.cars)) * services.filter(s => s.stock === stockId).length;
      const meshes = [];
      for (const [m, list] of by) {
        const geo = list.length === 1 ? list[0] : THREE.BufferGeometryUtils.mergeGeometries(list, false);
        const im = new THREE.InstancedMesh(geo, m, cap);
        im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = 0; im.name = `train-${key}`;
        world.add(im); meshes.push(im);
      }
      return (kinds[key] = { meshes, n: 0, cap });
    }
    const roleOf = (s, k) => (k === 0 ? 'head' : k === s.cars - 1 ? 'tail' : s.S.pan.includes(k) ? 'pan' : 'mid');
    for (const s of services) for (let k = 0; k < s.cars; k++) kind(s.stock, roleOf(s, k));
    // head and tail lamps, a pair of sprites per end of each train drawn
    let gt = null;
    const glowTex = () => {
      if (gt) return gt;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return (gt = new THREE.CanvasTexture(c));
    };
    const lampPool = [];
    function lampAt(i, x, y, z, colour, size) {
      let L = lampPool[i];
      if (!L) { L = lampPool[i] = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); L.renderOrder = 20; world.add(L); }
      L.visible = true; L.material.color.set(colour); L.material.opacity = 0.55 + 0.45 * OEKit.shared.night.value; L.position.set(x, z, -y); L.scale.set(size * 1.6, size * 1.6, 1);
    }

    const api = { tracks, services, kinds, live: [], t: o.t0 || 0, station: R.station, said: [], voices: [0, 0, 0], run, stopsNow };
    const st = R.station || null, st3 = { x: 0, y: 0, z: 0 };
    const state = { t: 0, x: 0, v: 0, a: 0, ph: '', T: 0, t1: 0, t2: 0, t3: 0 };
    const fwd = { x: 0, y: 0, z: 0 }, aft = { x: 0, y: 0, z: 0 };
    let clackAt = [0, 0, 0];

    // the trains on the line at time t: [{ s, k (which departure), tau, x, v, a, ph }]
    function at(t) {
      const out = [];
      for (const s of services) {
        const stops = stopsNow(s), T = run(s, 0, stops, state).T;
        const k1 = Math.floor((t - s.offset_s) / s.every_s), k0 = Math.ceil((t - s.offset_s - T) / s.every_s);
        for (let k = k0; k <= k1; k++) {
          const tau = t - s.offset_s - k * s.every_s, r = run(s, tau, stops, state);
          out.push({ s, k, tau, x: r.x, v: r.v, a: r.a, ph: r.ph, t1: r.t1, t2: r.t2, t3: r.t3, stops });
        }
      }
      return out;
    }
    api.at = at;

    function place(live) {
      { const n = OEKit.shared.night.value, M = mats(); M.lit.emissiveIntensity = M.litS.emissiveIntensity = 0.03 + 1.9 * n * Math.sqrt(n); } // the saloons' light shows as the day goes
      for (const k of Object.values(kinds)) k.n = 0;
      let lamps = 0;
      for (const tr of live) {
        const s = tr.s, c = s.tr.c, [h0, h1] = s.tr.hide_m || [0, c.L];
        tr.near = Infinity;
        for (let i = 0; i < s.cars; i++) {
          const d = tr.x + (s.len / 2 - (i + 0.5) * s.S.len); // car 0 leads
          if (d < h0 || d > h1) continue;
          // a car rides on its two bogies: its place is the middle of the chord between them
          const half = s.S.len * 0.345;
          c.at(d + half, fwd); c.at(d - half, aft);
          const K = kind(s.stock, roleOf(s, i));
          if (K.n >= K.cap) continue;
          dummy.position.set((fwd.x + aft.x) / 2, (fwd.z + aft.z) / 2, -(fwd.y + aft.y) / 2);
          dummy.rotation.set(0, Math.PI - Math.atan2(fwd.x - aft.x, fwd.y - aft.y), 0);
          dummy.updateMatrix();
          for (const m of K.meshes) m.setMatrixAt(K.n, dummy.matrix);
          K.n++;
          if (o.listener) { const l = o.listener(), dd = Math.hypot((fwd.x + aft.x) / 2 - l.x, (fwd.y + aft.y) / 2 - l.y, fwd.z + 1.5 - l.z); if (dd < tr.near) { tr.near = dd; tr.nx = (fwd.x + aft.x) / 2; tr.ny = (fwd.y + aft.y) / 2; } }
          if (i === 0 || i === s.cars - 1) { // white at the head, red at the tail
            const e = i === 0 ? 1 : -1, hx = (fwd.x - aft.x) / (2 * half), hy = (fwd.y - aft.y) / (2 * half), ex = (fwd.x + aft.x) / 2 + hx * e * (s.S.shinkansen ? 9.5 : 9.85), ey = (fwd.y + aft.y) / 2 + hy * e * (s.S.shinkansen ? 9.5 : 9.85);
            for (const sd of [-1, 1]) lampAt(lamps++, ex - hy * sd * (s.S.shinkansen ? 0.75 : 0.95), ey + hx * sd * (s.S.shinkansen ? 0.75 : 0.95), fwd.z + (s.S.shinkansen ? 1.55 : 1.25), i === 0 ? '#fff6dc' : '#ff2a1c', i === 0 ? 0.9 : 0.55);
          }
        }
      }
      for (let i = lamps; i < lampPool.length; i++) lampPool[i].visible = false;
      for (const k of Object.values(kinds)) for (const m of k.meshes) { m.count = k.n; m.instanceMatrix.needsUpdate = true; }
    }

    // ---------------------------------------------------------- the platform's announcements
    const num = n => ['', '1', '2', '3', '4', '5', '6'][n] || String(n);
    function announce(tr, what, level, pan) {
      const s = tr.s, n = s.tr.platform, A = window.OEAudio, deep = n % 2 === 1;
      let ja = '', en = '';
      if (what === 'approach') {
        ja = `まもなく、${num(n)}番線に、${s.line.ja}、${s.for.ja}行きが、まいります。危ないですから、黄色い点字ブロックまで、お下がりください。`;
        en = `The ${s.line.en} train for ${s.for.en} is arriving on track ${n}. Please stand behind the yellow blocks.`;
        if (A && A.on) A.platformChime(level, pan);
      } else if (what === 'pass') {
        ja = `まもなく、${num(n)}番線を、電車が通過します。危ないですから、黄色い点字ブロックまで、お下がりください。`;
        en = `A train will pass on track ${n}. Please stand behind the yellow blocks.`;
        if (A && A.on) A.platformChime(level, pan);
      } else if (what === 'arrive') {
        ja = `${st.native}、${st.native}。ご乗車、ありがとうございます。`;
        en = `${st.name}. ${st.name}.`;
        if (A && A.on) A.doorChime(level, pan);
      } else if (what === 'melody') {
        if (A && A.on) A.melody(level, pan, n % 2);
        return;
      } else if (what === 'close') {
        ja = `${num(n)}番線、ドアが閉まります。ご注意ください。`;
        en = `Track ${n}: the doors are closing.`;
        if (A && A.on) setTimeout(() => A.doorChime(level, pan), 2600);
      }
      caption(`${what === 'arrive' ? '' : '♪ '}${ja}`, en);
      const spoken = say(ja, en, level, deep);
      api.said.push({ t: api.t, track: s.track, what, ja, en, spoken });
      if (api.said.length > 40) api.said.shift();
    }

    api.update = function (dt, cam) {
      const t0 = api.t, t1 = (api.t += dt);
      const live = api.live = at(t1);
      place(live);
      if (capEl && capT > 0 && (capT -= dt) <= 0) capEl.style.opacity = 0;
      const l = o.listener ? o.listener() : null, A = window.OEAudio;
      if (!l) return;
      // the pan: how far to the camera's right the thing is
      const right = cam ? new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion) : null;
      const panOf = (x, y) => { if (!right) return 0; const dx = x - l.x, dy = y - l.y, d = Math.hypot(dx, dy) || 1; return Math.max(-1, Math.min(1, (dx * right.x - dy * right.z) / d)) * 0.85; };
      // the three nearest trains have a voice each (their rumble, joints and motors)
      const near = live.filter(tr => tr.near < HEAR && tr.v > 0.05).sort((a, b) => a.near - b.near).slice(0, 3);
      api.voices = [0, 0, 0];
      if (A && A.train) for (let i = 0; i < 3; i++) {
        const tr = near[i];
        if (!tr) { A.train(i, 0); continue; }
        const level = Math.pow(Math.max(0, 1 - tr.near / HEAR), 2.2) * (1 + 0.6 * Math.max(0, 1 - tr.near / 30)), pan = panOf(tr.nx, tr.ny);
        A.train(i, level, pan, tr.v, tr.a, !!tr.s.S.shinkansen); api.voices[i] = level;
        // the wheels over a joint: a bogie's two axles, a car length apart, as the train's speed brings them
        if (!tr.s.S.shinkansen && tr.v > 1.5) {
          clackAt[i] -= dt;
          if (clackAt[i] <= 0) { A.clack(level, pan, tr.v); clackAt[i] = tr.s.S.len / tr.v; }
        }
      }
      // the announcements, while you are in hearing of the station
      if (st) {
        const ds = Math.hypot(st.at[0] - l.x, st.at[1] - l.y, (st.at[2] - l.z) * 2), hear = st.hear_m || 150;
        if (ds < hear) for (const tr of live) {
          const s = tr.s;
          if (s.tr.platform == null) continue;
          const tau1 = tr.tau, tau0 = tau1 - (t1 - t0), cross = at => tau0 < at && tau1 >= at;
          const level = Math.pow(1 - ds / hear, 0.8), pan = panOf(st.at[0], st.at[1]) * 0.4;
          if (tr.stops) {
            if (cross(tr.t1 - 7)) announce(tr, 'approach', level, pan);
            if (cross(tr.t2 + 0.6)) announce(tr, 'arrive', level, pan);
            if (cross(tr.t3 - 13)) announce(tr, 'melody', level, pan);
            if (cross(tr.t3 - 5.5)) announce(tr, 'close', level, pan);
          } else if (s.tr.stop_m != null) {
            const tp = (s.tr.stop_m - s.len / 2 - s.x0) / s.v_ms; // its head at the platform's middle
            if (cross(tp - 16)) announce(tr, 'pass', level, pan);
          }
        }
      }
    };
    api.hush = () => { const A = window.OEAudio; if (A && A.train) for (let i = 0; i < 3; i++) A.train(i, 0); if (window.speechSynthesis) window.speechSynthesis.cancel(); if (capEl) capEl.style.opacity = 0; };
    // the next train to call or pass at a platform: { s, in_s, stops }, for a sign or a harness
    api.next = platform => {
      let best = null;
      for (const s of services) {
        if (s.tr.platform !== platform) continue;
        const stops = stopsNow(s), r = run(s, 0, stops, state), tArr = stops ? r.t2 : (s.tr.stop_m - s.x0) / s.v_ms;
        const k = Math.ceil((api.t - s.offset_s - tArr) / s.every_s), due = s.offset_s + k * s.every_s + tArr - api.t;
        if (!best || due < best.in_s) best = { s, in_s: due, stops };
      }
      return best;
    };
    return api; // (the first update places the trains: the game's clock, which says whether a rapid runs, is not set yet)
  }
  return { create, STOCK };
})();
