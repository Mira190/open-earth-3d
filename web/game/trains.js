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
  // floor 1.13 m over the rail, four pairs of doors a side 1.3 m wide); the high-speed train is a design of
  // this project's own, to the Tokaido Shinkansen's loading gauge (25 m cars, 3.36 m wide, 3.6 m high).
  const STOCK = {
    // model: the Blender car railstock.glb draws it with (blender/build_railstock.py), its line's colours painted on
    // the materials Door, Band, Band2, Top and Face (null leaves the steel bare); lamp: the head and tail lamps'
    // place (ahead of the car's middle, out to each side, up from the rail)
    e235: { len: 20, band: null, door: '#8fc31f', face: '#8fc31f', top: '#8fc31f', pan: [1, 4, 7, 9], model: 'Commuter' },            // Yamanote: yellow-green doors and face
    e233k: { len: 20, band: ['#00a7e3'], door: null, face: '#00a7e3', top: '#00a7e3', pan: [1, 4, 7], model: 'Commuter' },            // Keihin-Tohoku: a sky blue band
    e233t: { len: 20, band: ['#f68b1e', '#0d6b38'], door: null, face: '#f68b1e', top: '#f68b1e', pan: [2, 5, 8, 11, 13], model: 'Commuter' }, // Tokaido: orange over green
    hayate: { len: 25, shinkansen: true, pan: [4, 11] }, // this project's own high-speed train (see shinkansen())
    // Sydney Trains' Waratah (A and B sets): eight double-deck cars of 20.4 m, 3.03 m wide and 4.41 m high, steel
    // with yellow doors and a yellow front
    waratah: { len: 20.4, deck2: true, door: '#f5a800', face: '#f5a800', pan: [2, 5], model: 'Waratah', lamp: [9.9, 0.95, 1.0] },
  };
  let MATS = null;
  // A saloon seen through its windows, by interior mapping: each pixel of the glass follows the ray from the eye
  // on into a box the size of the car's inside (in the car's own frame, so it holds for every instance) and
  // shades what it meets there: the floor, the ceiling and its two rows of lamps, the bench seats under the far
  // windows, the far windows themselves (the day outside, or the night), the panels and adverts over them, the
  // grab poles by the doors. By day it is dim behind the reflections, as a carriage is; after dark it is the
  // carriage's own light. The decks: [floor, ceiling, window bottom, window top] for each (a double-decker has
  // two, chosen by the height on the glass). No figures are drawn: shapes painted in it read as cut-outs.
  function saloon(decks, o = {}) {
    const iw = o.iw || 1.36, seat = o.seat || '#2f5d7c', key = decks.map(d => d.join(',')).join('|');
    const m = new THREE.MeshStandardMaterial({ color: lin('#0b1115'), roughness: 0.04, metalness: 0.25, emissive: lin('#ffffff'), emissiveIntensity: 0.42 });
    const glsl = v => v.toFixed(3);
    m.onBeforeCompile = sh => {
      sh.uniforms.uNight = OEKit.shared.night;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLit; varying vec3 vEyeL; varying float vCar;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vLit = position;
#ifdef USE_INSTANCING
  vCar = float( gl_InstanceID );
  vEyeL = ( inverse( modelMatrix * instanceMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
#else
  vCar = 0.0;
  vEyeL = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
#endif`);
      const deck = decks.length > 1 ? `vLit.y > ${glsl((decks[0][3] + decks[1][2]) / 2)}` : 'false';
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNight;
varying vec3 vLit; varying vec3 vEyeL; varying float vCar;
float litHash( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
vec3 saloonAt( vec3 ro, vec3 rd, vec4 D ) {
  // D: floor, ceiling, window bottom, window top
  float sx = ro.x > 0.0 ? 1.0 : -1.0;
  float tx = rd.x * sx < -1e-4 ? ( -sx * ${glsl(iw)} - ro.x ) / rd.x : 1e4;
  float ty = rd.y < 0.0 ? ( D.x - ro.y ) / rd.y : ( D.y - ro.y ) / max( rd.y, 1e-4 );
  float t = min( tx, ty );
  vec3 h = ro + rd * t;
  float lamp = 1.0 - smoothstep( 0.0, 0.07, abs( abs( h.x ) - 0.52 ) );
  vec3 c;
  if ( t == tx ) { // the far side: seats, windows, panels
    float u = ( h.y - D.x ) / ( D.y - D.x );
    float bench = step( h.y, D.x + 0.46 ) * step( D.x + 0.36, h.y );
    float back = step( h.y, D.z - 0.05 ) * step( D.x + 0.46, h.y );
    float win = step( D.z, h.y ) * step( h.y, D.w );
    float pane = step( 0.06, fract( h.z / 1.45 ) );
    vec3 outside = mix( vec3( 0.75, 0.82, 0.88 ), vec3( 0.05, 0.06, 0.08 ), uNight );
    vec3 wall = vec3( 0.82, 0.83, 0.8 );
    float ad = step( D.w + 0.06, h.y ) * step( h.y, D.y - 0.08 ) * step( 0.08, fract( h.z / 1.2 ) );
    vec3 adc = mix( vec3( 0.9, 0.86, 0.75 ), vec3( 0.55 + 0.4 * litHash( floor( h.z / 1.2 ) ), 0.5, 0.4 + 0.5 * litHash( floor( h.z / 1.2 ) + 7.0 ) ), 0.6 );
    c = mix( wall, vec3( ${lin(seat).toArray().map(glsl).join(', ')} ), max( bench, back * 0.9 ) );
    c = mix( c, outside * pane + wall * 0.4 * ( 1.0 - pane ), win );
    c = mix( c, adc, ad );
    c *= 0.85 + 0.15 * u;
  } else if ( rd.y < 0.0 ) { // the floor, a paler aisle down the middle
    c = mix( vec3( 0.38, 0.36, 0.33 ), vec3( 0.55, 0.53, 0.48 ), 1.0 - smoothstep( 0.4, 0.6, abs( h.x ) ) );
  } else { // the ceiling and its lamps
    c = vec3( 0.86, 0.87, 0.86 ) + lamp * vec3( 2.2 );
  }
  // the light falling off with depth
  return c * exp( -t * 0.06 );
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec4 D = ${deck} ? vec4( ${decks[decks.length - 1].map(glsl).join(', ')} ) : vec4( ${decks[0].map(glsl).join(', ')} );
    vec3 rd = normalize( vLit - vEyeL );
    float pane = 0.9 + 0.2 * litHash( floor( vLit.z / 1.6 ) + vCar * 3.7 );
    totalEmissiveRadiance *= saloonAt( vLit, rd, D ) * pane; }`);
    };
    m.customProgramCacheKey = () => `train-saloon6|${key}|${iw}|${seat}`;
    return m;
  }
  // Stainless steel as it is on a carriage's side: a fine grain along the car that breaks the reflections up,
  // the gloss varying a little from sheet to sheet, and the grime of the line gathering towards the sill and the
  // underframe, streaked down from the doors and windows. All in the car's own frame, so every instance has it.
  function stainless(m) {
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSteel;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSteel = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSteel;
float steelHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  { float low = 1.0 - smoothstep( 0.95, 1.9, vSteel.y );
    float streak = steelHash( vec2( floor( vSteel.z * 9.0 ), 3.0 ) ) * ( 1.0 - smoothstep( 1.2, 2.9, vSteel.y ) );
    float sheet = steelHash( vec2( floor( vSteel.z / 2.4 ), floor( vSteel.y / 1.1 ) ) );
    diffuseColor.rgb *= ( 1.0 - 0.32 * low - 0.1 * streak ) * ( 0.96 + 0.06 * sheet ); }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  { float grain = steelHash( vec2( floor( vSteel.y * 260.0 ), floor( vSteel.z * 3.0 ) ) );
    float low = 1.0 - smoothstep( 0.95, 1.9, vSteel.y );
    roughnessFactor = clamp( roughnessFactor + 0.12 * ( grain - 0.5 ) + 0.25 * low + 0.06 * steelHash( vec2( floor( vSteel.z / 2.4 ), 1.0 ) ), 0.08, 1.0 ); }`);
    };
    m.customProgramCacheKey = () => 'train-stainless1';
    return m;
  }
  function mats() {
    if (MATS) return MATS;
    const std = o => new THREE.MeshStandardMaterial(o);
    const glass = OEKit.materials().glass; // dark by day, lit from inside after dark (OEKit.setNight)
    MATS = {
      steel: stainless(std({ color: lin('#b4b9bc'), roughness: 0.3, metalness: 0.88, envMapIntensity: 1.25 })),
      roof: std({ color: lin('#8d9194'), roughness: 0.7, metalness: 0.2 }),
      under: std({ color: lin('#26292c'), roughness: 0.8, metalness: 0.2 }),
      black: std({ color: lin('#101214'), roughness: 0.35, metalness: 0.3 }),
      screen: std({ color: lin('#06090c'), roughness: 0.92, metalness: 0.0, envMapIntensity: 0.04, side: THREE.DoubleSide }), // a windscreen flush in a nose
      white: std({ color: lin('#f3f5f4'), roughness: 0.3, metalness: 0.15 }),
      blue: std({ color: lin('#123f8c'), roughness: 0.35, metalness: 0.1 }),
      // (a commuter car's windows from 1.93 m over the rail, a Shinkansen's from 1.99 m, a double-decker's two rows)
      lit: saloon([[1.13, 3.2, 1.93, 2.85]], { seat: '#3c6a58' }), litS: saloon([[1.3, 3.1, 1.99, 2.51]], { iw: 1.5, seat: '#2d4f86' }),
      litLo: saloon([[0.75, 2.3, 1.2, 2.04]], { iw: 1.4, seat: '#25466e' }), litUp: saloon([[2.45, 3.95, 2.66, 3.46]], { iw: 1.4, seat: '#25466e' }),
      litDeck: saloon([[0.75, 2.3, 1.2, 2.04], [2.45, 3.95, 2.66, 3.46]], { iw: 1.4, seat: '#25466e' }),
      glass,
      paint: {},
      // the Blender cars' own surfaces (railstock.glb), by their material's name
      extra: {
        RoofKit: std({ color: lin('#b4b8ba'), roughness: 0.5, metalness: 0.45 }),
        Bogie: std({ color: lin('#2e3134'), roughness: 0.72, metalness: 0.3 }),
        Wheel: std({ color: lin('#6b6660'), roughness: 0.4, metalness: 0.85 }),
        Rubber: std({ color: lin('#121314'), roughness: 0.92, metalness: 0.0 }),
        Mask: std({ color: lin('#050608'), roughness: 0.1, metalness: 0.2, envMapIntensity: 1.4 }),
        Screen: std({ color: lin('#0a1216'), roughness: 0.04, metalness: 0.6, envMapIntensity: 1.6 }),
        Display: std({ color: lin('#1a1006'), roughness: 0.5, metalness: 0.0, emissive: lin('#ffa040'), emissiveIntensity: 0.8 }),
        Lamp: std({ color: lin('#f4f1ea'), roughness: 0.15, metalness: 0.2, emissive: lin('#fff2d8'), emissiveIntensity: 0.6 }),
        LampTail: std({ color: lin('#5a0a06'), roughness: 0.2, metalness: 0.1, emissive: lin('#ff2a1c'), emissiveIntensity: 0.5 }),
        Insulator: std({ color: lin('#d6d1c4'), roughness: 0.25, metalness: 0.0 }),
        Panto: std({ color: lin('#8a8f93'), roughness: 0.4, metalness: 0.7 }),
        FaceLow: std({ color: lin('#d4d8da'), roughness: 0.32, metalness: 0.35 }),
      },
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

  // Sydney's Waratah, a double-deck car (20.4 m over couplers, 3.03 m wide, 4.41 m high), after photographs of the
  // A sets at Circular Quay and Central: a steel shell with round shoulders into a dark roof, its sides carried
  // down as skirts to 0.4 m over the rail the whole length of the car, so the bogies are hidden and no wheel
  // shows from a platform; a thin yellow line along the foot of the side. Over each bogie a vestibule with a
  // pair of yellow plug doors a side; between them the two decks, the lower windows starting at the platform's
  // level, the upper under the roof's curve, each row one band of dark glass, and a plain steel band between
  // them. An end car's cab leans back from a yellow nose, its windscreen in a black mask.
  function doubledeck(S, role) {
    const K = OEKit, M = mats(), out = [], add = (m, g) => out.push([m, g]);
    const L = 19.9, Wd = 3.03, hw = Wd / 2, top = 4.41, f = 1.15, skirt = 0.4, zw = 5.3;
    const cab = role === 'head' || role === 'tail', s = role === 'tail' ? -1 : 1, Z = z => s * z;
    const secs = [], sec = (z, y0, k = 1, y1 = top) => secs.push({ z, pts: section(hw * k, y0, y1) });
    sec(-L / 2, skirt);
    if (cab) { sec(L / 2 - 1.5, skirt); sec(L / 2 - 0.9, skirt, 0.99, top - 0.1); sec(L / 2 - 0.35, skirt + 0.05, 0.96, top - 0.42); sec(L / 2, skirt + 0.15, 0.9, top - 0.95); }
    else sec(L / 2, skirt);
    const shell = loft(secs);
    if (s < 0) shell.rotateY(Math.PI);
    add(M.steel, shell);
    add(M.roof, K.box(Wd * 0.8, 0.07, L - (cab ? 2.2 : 0.3), 0, top - 0.015, Z(cab ? -0.95 : 0))); // the roof, dark between the shoulders
    for (const z of [-7.6, 7.6]) add(M.roof, K.box(2.0, 0.12, 2.8, 0, top + 0.04, z)); // the air conditioners' grilles over the vestibules
    add(M.under, K.box(Wd * 0.72, 2.6, 0.5, 0, 2.3, -L / 2 - 0.2)); // the gangway to the next car
    for (const z of [-7.2, 7.2]) add(M.under, K.box(2.3, 0.5, 3.2, 0, 0.42, z)); // the bogies, in the shadow behind the skirts
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.006);
      add(paint(S.door), K.box(0.012, 0.045, L - (cab ? 1.7 : 0.2), x, 0.66, Z(cab ? -0.75 : 0))); // the yellow line along the foot of the side
      // the two rows of windows, each one band of dark glass with slim black pillars
      for (const [y0, y1, mat] of [[1.2, 2.04, M.litLo], [2.66, 3.46, M.litUp]]) {
        add(M.black, K.box(0.012, y1 - y0 + 0.1, 2 * zw - 0.3, x, (y0 + y1) / 2, 0));
        for (let k = 0; k < 5; k++) add(mat, K.box(0.02, y1 - y0, 1.98, x, (y0 + y1) / 2, -zw + 0.2 + 1.02 + k * 2.04));
      }
      for (const dz of [-6.95, 6.95]) { // the doors: two yellow leaves, each with a tall window, in a black frame
        add(M.black, K.box(0.012, 2.08, 1.64, x, f + 1.04, dz));
        for (const e of [-0.39, 0.39]) {
          add(paint(S.door), K.box(0.02, 2.0, 0.74, x, f + 1.03, dz + e));
          add(M.black, K.box(0.026, 1.3, 0.44, x, f + 1.25, dz + e));
          add(M.lit, K.box(0.03, 1.22, 0.38, x, f + 1.25, dz + e));
        }
      }
      for (const dz of cab ? [-s * 8.85] : [-8.85, 8.85]) { add(M.black, K.box(0.012, 0.9, 0.9, x, f + 1.55, dz)); add(M.lit, K.box(0.02, 0.8, 0.8, x, f + 1.55, dz)); } // a window at the car's end
      if (cab) { // the driver's door and side window, and the yellow of the nose wrapped round onto the side
        add(paint(S.face), K.box(0.014, 2.3, 0.5, sx * (hw * 0.985), 1.75, Z(L / 2 - 0.42)));
        add(M.black, K.box(0.02, 1.0, 0.8, sx * (hw * 0.992), f + 1.7, Z(L / 2 - 1.25)));
      }
    }
    if (role === 'pan') pantograph(out, top + 0.02, -7.4, 4.95);
    if (cab) { // the nose, leaning back: yellow, with the windscreen in a black mask and the destination over it
      const lean = 0.25, face = (m, w, h, y, d) => add(m, K.box(w, h, 0.05).rotateX(-lean * s).translate(0, y, Z(L / 2 + d - (y - f) * Math.tan(lean))));
      face(paint(S.face), Wd * 0.9, 2.9, f + 0.95, 0.2);
      face(M.black, Wd * 0.8, 1.5, f + 1.75, 0.22);
      face(M.glass, Wd * 0.74, 1.25, f + 1.8, 0.25);
      face(M.lit, 1.4, 0.24, f + 2.75, 0.26);
      add(M.under, K.box(Wd * 0.8, 0.5, 0.5, 0, 0.75, Z(L / 2 + 0.05))); // the coupler's pocket, black under the nose
      add(M.under, K.box(0.4, 0.3, 0.6, 0, 0.8, Z(L / 2 + 0.4)));
    }
    return out;
  }

  function pantograph(out, y, z, wire = 5.0) { // a single-arm pantograph, raised to the wire at 5.0 m
    const K = OEKit, M = mats(), up = Math.max(0.3, wire - y - 0.06);
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

  // The high-speed train: a design of this project's own, to the Tokaido Shinkansen's loading gauge (25 m cars,
  // 3.36 m wide, 3.6 m high, sixteen to a train) and no model of any operator's stock. A pearl-white shell on
  // full skirts; a nose of 11 m in one unbroken curve, the roof coming down and the sides drawing in from the
  // saloon's own section to a low, wide, round lip, with nothing standing proud of it: the driver's windscreen is a
  // dark teardrop laid flush in the nose's back. One band of dark glass the length of each saloon; and along
  // the side an indigo line over a fine vermilion one, which run down the nose to its tip.
  function shinkansen(S, role) {
    const K = OEKit, M = mats(), out = [], add = (m, g) => out.push([m, g]);
    const Wd = 3.36, hw = Wd / 2, y0 = 0.26, top = 3.6, NOSE = 11;
    const nose = role === 'head' || role === 'tail', s = role === 'tail' ? -1 : 1, Z = z => s * z;
    const zb0 = -12.25, zb1 = nose ? 1.25 : 12.25, secs = [{ z: zb0, pts: section(hw, y0, top) }, { z: zb1, pts: section(hw, y0, top) }];
    // the nose's lines. Its cross-section grows from the tip to the saloon at an all but even rate (what softens
    // the pressure wave a train pushes into a tunnel), so the width and the height each fall as a power of what
    // is left of the nose, 0.38 and 0.62, which multiply to a straight line; t is eased so that the nose leaves
    // the saloon without a crease. The width holds longer than the height: the tip is a low, wide, round lip
    // (a metre across, under half a metre deep), not a point.
    const left = t => 1 - Math.pow(t, 1.35), lAt = t => y0 + 0.22 * t * t;
    const wAt = t => Math.max(0.5, hw * Math.pow(left(t), 0.38));
    const hAt = t => Math.max(lAt(t) + 0.42, 0.8 + (top - 0.8) * Math.pow(left(t), 0.62));
    // the shell's height at x across it (section(): a flat crown between two round shoulders)
    const skin = (t, x) => { const w = wAt(t), r = Math.min(0.75, w * 0.45), e = Math.abs(x) - (w - r), y1 = hAt(t); return e <= 0 ? y1 : y1 - r + Math.sqrt(Math.max(0, r * r - e * e)); };
    if (nose) {
      for (let k = 1, N = 22; k <= N; k++) { const t = k / N; secs.push({ z: zb1 + NOSE * t, pts: section(wAt(t), lAt(t), hAt(t)) }); }
      // and the tip closes on itself in a quarter round, with no cap to show
      const last = secs[secs.length - 1].pts, mid = (hAt(1) + lAt(1)) / 2;
      for (const q of [0.3, 0.55, 0.75, 0.9, 0.98]) { const c = Math.cos(q * Math.PI / 2); secs.push({ z: zb1 + NOSE + 0.42 * Math.sin(q * Math.PI / 2), pts: last.map(([x, y]) => [x * c, mid + (y - mid) * c]) }); }
    }
    const g = loft(secs);
    if (s < 0) g.rotateY(Math.PI);
    add(M.white, g);
    const a = zb0 + 0.3, b = nose ? zb1 - 0.2 : zb1 - 0.3, line = (m, y, r) => { // a line along the side, and on down the nose to its tip
      for (const sx of [-1, 1]) {
        add(m, K.box(0.03, 2 * r, b - a, sx * (hw + 0.008), y, Z((a + b) / 2)));
        if (!nose) continue;
        let p = [sx * (hw + 0.01), y, Z(b)];
        for (let k = 1; k <= 20; k++) { const t = k / 21, q = [sx * (wAt(t) + 0.012), y - (y - 0.74) * t * t, Z(zb1 + NOSE * t)]; add(m, K.rod(p, q, r, r, 5)); p = q; }
      }
    };
    line(paint('#1d2f6f'), 1.5, 0.075); line(paint('#d8432b'), 1.33, 0.022);
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.008);
      // the saloon's windows: one dark band, its panes lit from inside
      add(M.black, K.box(0.014, 0.66, b - a - 3.0, x, 2.25, Z((a + b) / 2 + 0.3)));
      for (let z = a + 2.1; z < b - 1.5; z += 1.3) add(M.litS, K.box(0.022, 0.52, 1.14, x, 2.25, Z(z)));
      add(M.white, K.box(0.03, 1.95, 0.8, x, 1.6, Z(a + 0.75))); // a door at the car's end, its small window
      add(M.black, K.box(0.034, 2.0, 0.03, x, 1.6, Z(a + 0.33))); add(M.black, K.box(0.034, 2.0, 0.03, x, 1.6, Z(a + 1.17)));
      add(M.litS, K.box(0.036, 0.42, 0.3, x, 2.3, Z(a + 0.75)));
    }
    add(M.roof, K.box(1.3, 0.06, nose ? 13 : 23.4, 0, top + 0.01, Z(nose ? -5.2 : 0)));
    add(M.under, K.box(Wd * 0.7, 2.4, 0.5, 0, 1.9, Z(zb0 - 0.12))); // the gangway's bellows
    if (role === 'pan') { for (const sx of [-1, 1]) add(M.white, K.box(0.12, 0.55, 5.4, sx * 1.25, top + 0.22, 3.0)); pantograph(out, top + 0.06, 3.0); } // between its two shields
    if (nose) {
      // the windscreen: a teardrop of dark glass a centimetre over the shell's own surface, wide behind and
      // drawn to a point ahead, wrapping a little way down each shoulder
      const t0 = 0.16, t1 = 0.46, nT = 14, nX = 8, pos = [], idx = [];
      for (let i = 0; i <= nT; i++) {
        const u = i / nT, t = t0 + (t1 - t0) * u, half = wAt(t) * 0.97 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.7);
        for (let j = 0; j <= nX; j++) { const x = half * (2 * j / nX - 1); pos.push(x, skin(t, x) + 0.012, zb1 + NOSE * t); }
      }
      for (let i = 0; i < nT; i++) for (let j = 0; j < nX; j++) { const a0 = i * (nX + 1) + j, b0 = a0 + 1, c0 = a0 + nX + 1, d0 = c0 + 1; idx.push(a0, c0, b0, b0, c0, d0); }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setIndex(idx); wg.computeVertexNormals();
      if (s < 0) wg.rotateY(Math.PI);
      add(M.screen, wg);
    }
    return out;
  }

  // ------------------------------------------------------------ the Blender cars (assets/vehicles/railstock.glb)
  // One geometry per body and material, with the occlusion baked into its vertex colours. Until the file has come
  // (or where it cannot), the cars are the box models above.
  let LIB = null, libP = null;
  function flat(g0, M) { // a geometry with float position, normal and colour (the occlusion), indexed, in the node's frame
    const n = g0.attributes.position.count, g = new THREE.BufferGeometry();
    for (const [a, k] of [['position', 3], ['normal', 3], ['color', 3]]) {
      const A = g0.attributes[a], arr = new Float32Array(n * k);
      if (!A) arr.fill(1);
      else for (let i = 0; i < n; i++) { arr[i * k] = A.getX(i); arr[i * k + 1] = A.getY(i); arr[i * k + 2] = A.getZ(i); }
      g.setAttribute(a, new THREE.BufferAttribute(arr, k));
    }
    const idx = new Uint32Array(g0.index ? g0.index.count : n);
    if (g0.index) for (let i = 0; i < idx.length; i++) idx[i] = g0.index.getX(i); else for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g.applyMatrix4(M);
  }
  function loadLib(base = 'assets/vehicles/') {
    if (libP) return libP;
    if (!THREE.GLTFLoader || !THREE.BufferGeometryUtils) return (libP = Promise.resolve(null));
    const info = fetch(base + 'railstock.json').then(r => r.json());
    const glb = new Promise((res, rej) => new THREE.GLTFLoader().load(base + 'railstock.glb', res, null, rej));
    libP = Promise.all([info, glb]).then(([info, gltf]) => {
      gltf.scene.updateMatrixWorld(true);
      const nodes = {};
      for (const node of gltf.scene.children) {
        const by = new Map();
        node.traverse(o => {
          if (!o.isMesh) return;
          const name = o.material.name.replace(/\.\d+$/, '');
          if (!by.has(name)) by.set(name, []);
          by.get(name).push(flat(o.geometry, o.matrixWorld));
        });
        nodes[node.name] = by;
      }
      return (LIB = { info, nodes });
    }).catch(e => { console.warn('Train models unavailable:', e); return null; });
    return libP;
  }
  // a material with the baked occlusion (vertex colours), kept beside the one it copies
  const AO = new Map();
  function ao(m) {
    if (AO.has(m)) return AO.get(m);
    const c = m.clone();
    c.vertexColors = true;
    if (m.onBeforeCompile && m.customProgramCacheKey) { c.onBeforeCompile = m.onBeforeCompile; const key = m.customProgramCacheKey(); c.customProgramCacheKey = () => key + '|ao'; }
    AO.set(m, c);
    return c;
  }
  // which of the game's materials a Blender material takes, for this stock (its line's colours)
  function glbMat(name, S) {
    const M = mats(), P = hex => (hex ? paint(hex) : M.steel), band = S.band || [];
    switch (name) {
      case 'Steel': return M.steel;
      case 'Roof': return M.roof;
      case 'Under': return M.under;
      case 'Black': case 'Grille': return M.black;
      case 'Window': return S.deck2 ? M.litDeck : M.lit;
      case 'Door': return P(S.door);
      case 'Band': return P(band[0]);
      case 'Band2': return P(band[1] || band[0]);
      case 'Top': return P(S.top);
      case 'Face': return P(S.face);
      default: return M.extra[name] || M.steel;
    }
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
    capEl.innerHTML = ja ? `<div lang="ja" style="font-size:${small ? 12 : 15}px">${ja}</div><div style="opacity:0.78;font-size:${small ? 11 : 13}px">${en}</div>` : `<div style="font-size:${small ? 12 : 15}px">${en}</div>`;
    capEl.style.opacity = 1;
    capT = 4 + (ja.length || en.length * 0.4) * 0.16;
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
      const v = text && voice(lang, deep);
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
    const capOf = stockId => 2 * Math.max(...services.filter(s => s.stock === stockId).map(s => s.cars)) * services.filter(s => s.stock === stockId).length;
    const tier = window.OEQuality ? window.OEQuality.tier().name : 'high';
    const LOD_M = tier === 'low' || tier === 'still' ? 40 : tier === 'medium' ? 60 : 85; // the Blender cars' far copy beyond this
    // a Blender car: per level of detail, one instanced mesh per material; a tail car is the driving car turned about
    function glbKind(stockId, role) {
      const S = STOCK[stockId], body = role === 'head' || role === 'tail' ? 'Head' : role === 'pan' ? 'Pan' : 'Mid', key = `${stockId}|${body}`;
      if (kinds[key]) return kinds[key];
      const cap = capOf(stockId), lods = [];
      for (const [k, node] of [LIB.nodes[`${S.model}_${body}`], LIB.nodes[`${S.model}_${body}_LOD1`]].entries()) {
        if (!node) continue;
        const by = new Map();
        for (const [name, list] of node) { const m = ao(glbMat(name, S)); if (!by.has(m)) by.set(m, []); by.get(m).push(...list); }
        const meshes = [];
        for (const [m, list] of by) {
          const geo = list.length === 1 ? list[0] : THREE.BufferGeometryUtils.mergeGeometries(list, false);
          const im = new THREE.InstancedMesh(geo, m, cap);
          im.castShadow = true; im.receiveShadow = k === 0; im.frustumCulled = false; im.count = 0; im.visible = false; im.name = `train-${key}-${k}`;
          world.add(im); meshes.push(im);
        }
        lods.push({ meshes, n: 0 });
      }
      return (kinds[key] = { lods, cap, glb: true });
    }
    function kind(stockId, role) {
      if (LIB && STOCK[stockId].model && LIB.nodes[`${STOCK[stockId].model}_Mid`]) return glbKind(stockId, role);
      const key = `${stockId}|${role}`;
      if (kinds[key]) return kinds[key];
      const S = STOCK[stockId], parts = (S.shinkansen ? shinkansen : S.deck2 ? doubledeck : commuter)(S, role), by = new Map();
      for (const [m, g] of parts) { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (a !== 'position' && a !== 'normal') q.deleteAttribute(a); if (!by.has(m)) by.set(m, []); by.get(m).push(q); }
      const cap = capOf(stockId);
      const meshes = [];
      for (const [m, list] of by) {
        const geo = list.length === 1 ? list[0] : THREE.BufferGeometryUtils.mergeGeometries(list, false);
        const im = new THREE.InstancedMesh(geo, m, cap);
        im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = 0; im.name = `train-${key}`;
        world.add(im); meshes.push(im);
      }
      return (kinds[key] = { lods: [{ meshes, n: 0 }], cap });
    }
    const roleOf = (s, k) => (k === 0 ? 'head' : k === s.cars - 1 ? 'tail' : s.S.pan.includes(k) ? 'pan' : 'mid');
    for (const s of services) for (let k = 0; k < s.cars; k++) kind(s.stock, roleOf(s, k));
    // when the Blender cars have come, they take the box models' place
    if (services.some(s => s.S.model)) loadLib(o.base).then(lib => {
      if (!lib) return;
      for (const [key, K] of Object.entries(kinds)) {
        const S = STOCK[key.split('|')[0]];
        if (K.glb || !S.model || !lib.nodes[`${S.model}_Mid`]) continue;
        for (const L of K.lods) for (const m of L.meshes) { world.remove(m); m.geometry.dispose(); m.dispose && m.dispose(); }
        delete kinds[key];
      }
      api.models = true;
    });
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

    const api = { tracks, services, kinds, models: false, live: [], t: o.t0 || 0, station: R.station, said: [], voices: [0, 0, 0], run, stopsNow };
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
      { const n = OEKit.shared.night.value, M = mats(), E = M.extra; M.lit.emissiveIntensity = M.litS.emissiveIntensity = M.litLo.emissiveIntensity = M.litUp.emissiveIntensity = M.litDeck.emissiveIntensity = 0.42 + 0.75 * n * Math.sqrt(n); // the saloons' light shows through the reflections as the day goes
        E.Display.emissiveIntensity = 0.7 + 1.3 * n; E.Lamp.emissiveIntensity = 0.5 + 2.5 * n; E.LampTail.emissiveIntensity = 0.4 + 2.0 * n;
        for (const [src, c] of AO) if (src.emissive) c.emissiveIntensity = src.emissiveIntensity; }
      for (const k of Object.values(kinds)) for (const L of k.lods) L.n = 0;
      const eye = o.listener ? o.listener() : null;
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
          const role = roleOf(s, i), K = kind(s.stock, role), cx = (fwd.x + aft.x) / 2, cy = (fwd.y + aft.y) / 2;
          const L = K.lods.length > 1 && eye && Math.hypot(cx - eye.x, cy - eye.y, fwd.z - eye.z) > LOD_M ? K.lods[1] : K.lods[0];
          if (L.n >= K.cap) continue;
          dummy.position.set(cx, (fwd.z + aft.z) / 2, -cy);
          dummy.rotation.set(0, Math.PI - Math.atan2(fwd.x - aft.x, fwd.y - aft.y) + (K.glb && role === 'tail' ? Math.PI : 0), 0);
          dummy.updateMatrix();
          for (const m of L.meshes) m.setMatrixAt(L.n, dummy.matrix);
          L.n++;
          if (o.listener) { const l = o.listener(), dd = Math.hypot((fwd.x + aft.x) / 2 - l.x, (fwd.y + aft.y) / 2 - l.y, fwd.z + 1.5 - l.z); if (dd < tr.near) { tr.near = dd; tr.nx = (fwd.x + aft.x) / 2; tr.ny = (fwd.y + aft.y) / 2; } }
          if (i === 0 || i === s.cars - 1) { // white at the head, red at the tail
            const [ahead, side, up] = s.S.lamp || (s.S.shinkansen ? [10.2, 0.5, 1.0] : s.S.deck2 ? [9.85, 0.95, 1.5] : [9.85, 0.95, 1.25]);
            const e = i === 0 ? 1 : -1, hx = (fwd.x - aft.x) / (2 * half), hy = (fwd.y - aft.y) / (2 * half), ex = cx + hx * e * ahead, ey = cy + hy * e * ahead;
            for (const sd of [-1, 1]) lampAt(lamps++, ex - hy * sd * side, ey + hx * sd * side, fwd.z + up, i === 0 ? '#fff6dc' : '#ff2a1c', i === 0 ? 0.9 : 0.55);
          }
        }
      }
      for (let i = lamps; i < lampPool.length; i++) lampPool[i].visible = false;
      for (const k of Object.values(kinds)) for (const L of k.lods) for (const m of L.meshes) { m.count = L.n; m.visible = L.n > 0; if (L.n) m.instanceMatrix.needsUpdate = true; }
    }

    // ---------------------------------------------------------- the platform's announcements
    const num = n => ['', '1', '2', '3', '4', '5', '6'][n] || String(n);
    function announce(tr, what, level, pan) {
      const s = tr.s, n = s.tr.platform, A = window.OEAudio, deep = n % 2 === 1;
      let ja = '', en = '';
      if (st.style === 'sydney') { // Sydney Trains' platforms: English, a chime, no melody
        if (what === 'approach') {
          en = `The next train to arrive on platform ${n} goes to ${s.for.en}. First stop, ${s.first}.`;
          if (A && A.on) A.platformChime(level, pan);
        } else if (what === 'pass') {
          en = `The next train on platform ${n} does not stop here. Please stand behind the yellow line.`;
          if (A && A.on) A.platformChime(level, pan);
        } else if (what === 'arrive') {
          en = `This is ${st.name}. The train on platform ${n} goes to ${s.for.en}.`;
        } else if (what === 'melody') return;
        else if (what === 'close') {
          en = 'Doors closing. Please stand clear.';
          if (A && A.on) A.doorChime(level, pan);
        }
        caption('', en);
        const spoken = say('', en, level, deep);
        api.said.push({ t: api.t, track: s.track, what, ja, en, spoken });
        if (api.said.length > 40) api.said.shift();
        return;
      }
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
