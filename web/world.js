// Open Earth 3D world: the city scene that the model viewer (city.js) and the game
// (game/*.js) share: terrain under aerial imagery, water, the buildings (buildings.js:
// walls, LOD2 roofs, facades with windows by floor, lights at night, height-source
// colours), piers, trees, parametric landmarks, sky and sun, and after dark the street
// lights, the traffic and the towers' lights (night.js). Local frame: x east, y north, z up; three.js is
// y-up, so a local point (x, y, z) is drawn at (x, z, -y).
'use strict';
window.OEWorld = (function () {
  const S = window.Sun, RAD = Math.PI / 180;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const idle = () => new Promise(r => setTimeout(r, 0));

  // the city's data files; game.json too when asked for
  async function load(cityId, { game = false, onMsg = () => {} } = {}) {
    const DATA = `data/${cityId}/`;
    // the download is most of the wait for a big city, so it is counted as it streams in, against
    // the size cities.json gives for the model or the game (raw bytes, as the streams deliver them)
    const entry = (window.OE_CITIES || []).find(c => c.id === cityId) || {};
    const want = (entry.load_bytes || {})[game ? 'game' : 'model'] || 0, mb = b => (b / 1e6).toFixed(1);
    let got = 0, shown = 0;
    const report = () => {
      const now = performance.now();
      if (now - shown < 80) return;
      shown = now;
      onMsg(want ? `Downloading ${entry.name || 'the city'}: ${mb(Math.min(got, want))} of ${mb(want)} MB` : `Downloading: ${mb(got)} MB`,
        0.02 + 0.26 * (want ? Math.min(1, got / want) : 0));
    };
    const getJSON = async u => {
      const r = await fetch(DATA + u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      if (!r.body || !r.body.getReader) return r.json();
      const reader = r.body.getReader(), parts = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; report();
      }
      return JSON.parse(await new Blob(parts).text());
    };
    onMsg(want ? `Downloading ${entry.name || 'the city'}: 0 of ${mb(want)} MB` : 'Downloading footprints, terrain and landmarks', 0.02);
    const [scene, B, P, LM, terrBuf, UNC, G, N] = await Promise.all([getJSON('scene.json'), getJSON('buildings.json'), getJSON('places.json'),
      getJSON('landmarks.json'), getJSON('terrain.json').then(t => Uint8Array.from(atob(t.data), c => c.charCodeAt(0)).buffer),
      getJSON('uncertainty.json').catch(() => null), game ? getJSON('game.json') : Promise.resolve(null),
      window.OENight ? getJSON('night.json').catch(() => null) : Promise.resolve(null)]);
    const CITY = scene.city;
    // buildings demolished since the survey (landmarks.json "demolished": solid indices): not drawn, and
    // flat in the surface model, so nothing stands, shades or blocks the way where they stood
    for (const si of (LM && LM.demolished) || []) if (B.s[si]) B.s[si][3] = B.s[si][2];
    if (LM && LM.demolished) scene.hidden_solids = (scene.hidden_solids || []).concat(LM.demolished);
    // solids a landmark mesh draws instead (landmarks.json "hidden"): not drawn, but kept in the surface model
    if (LM && LM.hidden) scene.hidden_solids = (scene.hidden_solids || []).concat(LM.hidden);
    S.site({ lat: CITY.lat, lon: CITY.lon, tz: CITY.timezone, locale: CITY.locale });
    S.roofs(B); // surface models follow the pitched roofs
    const ti = new Int16Array(terrBuf);
    const T = { data: Float32Array.from(ti, v => v * scene.terrain.scale), nx: scene.terrain.nx, ny: scene.terrain.ny,
      cell: scene.terrain.cell, x0: scene.frame.x[0], y1: scene.frame.y[1] };
    return { id: cityId, DATA, scene, B, P, LM, UNC, G, N, CITY, T, ground: (x, y) => Math.max(0, S.terrainAt(T, x, y)) };
  }

  // surface patterns for parametric landmark materials (landmarks.json "pattern"), drawn
  // from the meshes' texture coordinates in metres; each fades to its average colour where
  // a pixel covers more than a few repeats, so it never shimmers at a distance
  const LM_NIGHT = { value: 0 }; // how dark it is, for landmark patterns with lit windows
  // the Eiffel Tower's sparkle: five minutes at the start of every hour after dark (setSun turns it on)
  const SPARKLE = { on: { value: 0 }, t: { value: 0 } };
  // A floodlit material lit from below (landmarks.json "flood": [from_m, to_m, roof, top]), as a
  // castle or a tower is lit by floodlights at its foot and on its lower roofs: a wall takes the
  // light full and the underside of an eave a little more, a roof facing up catches its share at a
  // graze ("roof", 0.5), and the light falls off up the building from from_m to to_m (the local
  // frame's heights) to "top" (0.6) of what it is at the foot. Without "flood" a floodlit material
  // glows evenly, as a sign or a screen does. prev: the material's own pattern, if any.
  function floodFrom(spec, prev) {
    if (!spec) return prev;
    const [z0, z1, roof = 0.5, top = 0.6] = spec;
    return sh => {
      if (prev) prev(sh);
      sh.uniforms.uFlood = { value: new THREE.Vector4(z0, z1, roof, top) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFloodY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vFloodY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uFlood; varying float vFloodY;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 wn = inverseTransformDirection(normal, viewMatrix);
    float face = wn.y < 0.0 ? 1.0 - 0.3 * wn.y : mix(1.0, uFlood.z, wn.y);
    // the light comes back off the surface, so its pattern (courses, joints, tiles) shows in it
    float tex = clamp(dot(diffuseColor.rgb, vec3(1.0)) / max(dot(diffuse, vec3(1.0)), 1e-3), 0.0, 1.5);
    totalEmissiveRadiance *= face * tex * mix(1.0, uFlood.w, clamp((vFloodY - uFlood.x) / max(uFlood.y - uFlood.x, 1.0), 0.0, 1.0)); }`);
    };
  }
  const PATTERNS = {
    // the Opera House roof tiles: chevron lids between the ribs, glossy white tiles inside a
    // lid and matte cream along its joints (u counts rib bays, v is metres along a rib)
    chevron_tiles(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uLid: { value: m.lid_m || 2.6 }, uChev: { value: m.chevron_m || 1.8 },
          uGloss: { value: lin('#f5f3ed') }, uCream: { value: lin('#e8ddc6') } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLid, uChev; uniform vec3 uGloss, uCream; float pCream;')
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float bay = fract(vUv.x) - 0.5, c = vUv.y - abs(bay) * uChev, lid = fract(c / uLid);
    float edge = min(lid, 1.0 - lid) * uLid, fw = fwidth(c);
    float cream = max(1.0 - smoothstep(0.07, 0.16, edge), 1.0 - smoothstep(0.02, 0.06, (0.5 - abs(bay)) * uChev));
    float grout = 1.0 - smoothstep(0.0, 0.02 + fw, edge);
    float near = 1.0 - smoothstep(0.08, 0.5, fw);
    pCream = mix(0.18, cream, near);
    diffuseColor.rgb = mix(uGloss, uCream, pCream) * (1.0 - 0.06 * grout * near); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.14, 0.6, pCream);');
      };
    },
    // reconstituted granite (u, v metres): the aggregate's speckle and the joints between slabs
    // every joints_m [across, along] (0: none). On a stair, "tread" pales the worn nosing at its
    // front (v = 0), and "riser" (v from its foot, 0, to its top, 1) darkens the shadow under the
    // nosing above and the line where it meets the tread below, so steps read as steps from any side
    granite(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      const [ju, jv] = m.joints_m || [0, 0];
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uJoint: { value: new THREE.Vector2(ju, jv) }, uStair: { value: { tread: 1, riser: 2 }[m.stair] || 0 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec2 uJoint; uniform float uStair;
float gnH(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { vec2 q = vUv; float fw = max(fwidth(q.x), fwidth(q.y));
    float k = 1.0 + (gnH(floor(q * 40.0)) - 0.5) * 0.1 * (1.0 - smoothstep(0.004, 0.014, fw)); // aggregate a few cm across
    float jn = 1.0 - smoothstep(0.03, 0.15, fw), joint = 0.0;
    if (uJoint.x > 0.0) joint = max(joint, 1.0 - smoothstep(0.004, 0.012 + fw, abs(fract(q.x / uJoint.x + 0.5) - 0.5) * uJoint.x));
    if (uJoint.y > 0.0 && uStair < 0.5) joint = max(joint, 1.0 - smoothstep(0.004, 0.012 + fw, abs(fract(q.y / uJoint.y + 0.5) - 0.5) * uJoint.y));
    k *= 1.0 - 0.28 * joint * jn;
    if (uStair > 1.5) {
      float sv = fwidth(q.y), sh = mix(1.0, 0.5, smoothstep(0.62, 0.95, q.y)) * mix(0.72, 1.0, smoothstep(0.0, 0.1, q.y));
      k *= mix(sh, 0.8, smoothstep(0.3, 0.8, sv));
    } else if (uStair > 0.5) k *= 1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.04 + fw, q.y)) * jn;
    diffuseColor.rgb *= k; }`);
      };
    },
    // a bridge or road deck in strips across its width (v metres from one edge): lanes with
    // dashed lines, a railway bed with sleepers, a cycleway, a footway, concrete between
    deck_zones(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      const kinds = { parapet: 0, barrier: 0, cycleway: 1, rail: 2, lanes6: 3, lanes2: 4, footway: 5 }, ends = [], ks = [], lanes = [];
      let v = 0;
      for (const [w, k] of m.zones) { v += w; ends.push(v); ks.push(kinds[k] ?? 0); lanes.push(k === 'lanes6' ? 6 : k === 'lanes2' ? 2 : 1); }
      while (ends.length < 16) { ends.push(1e9); ks.push(0); lanes.push(1); }
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uEnds: { value: ends }, uKinds: { value: ks }, uLanes: { value: lanes },
          uAsphalt: { value: lin('#3b3d40') }, uConcrete: { value: lin('#a9a59d') }, uBallast: { value: lin('#5c544b') }, uPaint: { value: lin('#e9e6dc') } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uEnds[16], uKinds[16], uLanes[16]; uniform vec3 uAsphalt, uConcrete, uBallast, uPaint; float pRough;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float u = vUv.x, v = vUv.y, z0 = 0.0, z1 = 0.0, kind = 0.0, n = 1.0;
    for (int i = 0; i < 16; i++) { if (v < uEnds[i]) { z1 = uEnds[i]; kind = uKinds[i]; n = uLanes[i]; break; } z0 = uEnds[i]; }
    float fw = max(fwidth(u), fwidth(v)), near = 1.0 - smoothstep(0.15, 0.8, fw);
    vec3 col = uConcrete; pRough = 0.85;
    if (kind > 2.5 && kind < 4.5) { // traffic lanes: dashed lines between, solid at the edges
      float x = (v - z0) / (z1 - z0) * n, d = min(fract(x), 1.0 - fract(x)) * (z1 - z0) / n;
      float dash = step(fract(u / 12.0), 0.35), edgeLine = step(x, 0.06) + step(n - 0.06, x);
      float paint = (1.0 - smoothstep(0.06, 0.06 + fw, d)) * max(dash, edgeLine) * near;
      col = mix(uAsphalt, uPaint, paint); pRough = 0.9;
    } else if (kind > 1.5 && kind < 2.5) { // the railway bed: ballast and sleepers
      float sl = 1.0 - smoothstep(0.12, 0.12 + fw, abs(fract(u / 0.65) - 0.5) * 0.65);
      col = mix(uBallast, uBallast * 0.55, sl * near); pRough = 0.95;
    } else if (kind > 0.5 && kind < 1.5) { col = mix(uAsphalt, uConcrete, 0.25); pRough = 0.9; }
    else if (kind > 4.5) { // footway: concrete flags
      float j = 1.0 - smoothstep(0.02, 0.02 + fw, min(abs(fract(u / 1.8) - 0.5), abs(fract((v - z0) / 1.6) - 0.5)) * 1.7);
      col = uConcrete * (1.0 - 0.15 * j * near);
    }
    diffuseColor.rgb = col; }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = pRough;');
      };
    },
    // a curtain wall (u metres along the facade, v metres up): panes between mullions every bay_m,
    // a spandrel at the foot of each storey_m, pane tones that vary, and some panes lit after dark
    // (lit_share of them, lit_k bright: a shop's glass is mostly lit and softer than an office's;
    // warm_share of the lit ones under warm light, the rest cool white)
    curtain_wall(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 1.5 }, uSty: { value: m.storey_m || 4.0 }, uSpan: { value: m.spandrel || 0.25 },
          uMull: { value: m.mullion_m || 0.12 }, uFrame: { value: lin(m.frame || '#c9ced2') }, uLmNight: LM_NIGHT,
          uLitShare: { value: m.lit_share ?? 0.38 }, uLitK: { value: m.lit_k ?? 1.3 }, uWarm: { value: m.warm_share ?? 0.25 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uBay, uSty, uSpan, uMull, uLmNight, uLitShare, uLitK, uWarm; uniform vec3 uFrame; float pWin, pLit; vec3 pLitC;
float cwHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float bu = vUv.x / uBay, bv = vUv.y / uSty, fw = max(fwidth(bu), fwidth(bv));
    float eu = min(fract(bu), 1.0 - fract(bu)) * uBay, mull = 1.0 - smoothstep(uMull * 0.5, uMull * 0.5 + fwidth(vUv.x), eu);
    float span = 1.0 - smoothstep(uSpan - fwidth(bv), uSpan + fwidth(bv), fract(bv));
    vec2 cell = floor(vec2(bu, bv));
    float far = smoothstep(0.12, 0.5, fw), solid = max(mull, span * 0.9);
    vec3 glass = diffuseColor.rgb * (0.82 + 0.36 * cwHash(cell));
    // once a pane is under a pixel: whole storeys in blocks four bays wide, each with its own tone and
    // lit or not, so a tower across the harbour keeps its floors and its lit windows (darker glass by night)
    vec2 cf = floor(vec2(bu * 0.25, bv)); float vfar = smoothstep(0.75, 1.6, max(fwidth(bu * 0.25), fwidth(bv)));
    float sf = 1.0 - smoothstep(uSpan - fwidth(bv), uSpan + fwidth(bv), fract(bv)); // the storey's spandrel band
    vec3 farCol = mix(diffuseColor.rgb * (0.85 + 0.3 * cwHash(cf)), uFrame, 0.3 * (1.0 - 0.75 * uLmNight));
    diffuseColor.rgb = mix(mix(glass, uFrame, solid), farCol, far);
    float litFar = mix(0.6 * step(1.0 - 0.68 * uLitShare, cwHash(cf + 17.0)) * (1.0 - sf), 0.34 * uLitShare, vfar);
    // lit in runs of four panes along a storey, as an office is, each run a little brighter or dimmer,
    // mostly under cool white light
    pWin = mix(1.0 - solid, 0.6, far); pLit = mix(step(1.0 - uLitShare, cwHash(cf + 17.0)) * (0.85 + 0.3 * cwHash(cf + 3.0)), litFar, far);
    pLitC = mix(cwHash(cf + 5.0) < 1.0 - uWarm ? vec3(0.8, 0.9, 1.0) : vec3(1.0, 0.84, 0.62), vec3(0.85, 0.88, 0.9), far); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.45, roughnessFactor, pWin);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += pWin * pLit * uLmNight * pLitC * uLitK;`);
      };
    },
    // a riveted iron lattice cut out of a panel (u metres across, v metres up): a strut at the
    // top of every bay and two diagonals crossing in it, as on the Eiffel Tower's girders. Far
    // away it thins to a stipple instead of a solid sheet. With "sparkle", random points flash
    // white while SPARKLE is on, like the tower's 20,000 bulbs.
    lattice(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 4 }, uBarW: { value: m.bar_m || 0.4 }, uSpark: SPARKLE.on, uSparkT: SPARKLE.t,
          uSparkOn: { value: m.sparkle ? 1 : 0 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uBay, uBarW, uSpark, uSparkT, uSparkOn; float pSpark;
float lh(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { vec2 q = vUv / uBay, f = fract(q); float fw = max(fwidth(q.x), fwidth(q.y)), hb = 0.5 * uBarW / uBay;
    // distance (in bays) to the strut at the top of the bay and to its two diagonals; a bar is kept
    // out to its half-width, anti-aliased over a pixel, so about a third of the bay is iron
    float d = min(min(f.y, 1.0 - f.y), min(abs(f.x - f.y), abs(f.x + f.y - 1.0)) * 0.7071);
    float keep = 1.0 - smoothstep(hb, hb + fw, d);
    if (fw > 0.35) keep = step(0.6, fract(dot(gl_FragCoord.xy, vec2(0.5, 0.25)))); // too far for the bars: a stipple as open as the iron
    if (keep < 0.5) discard;
    vec2 cell = floor(vUv / 1.3);
    pSpark = uSpark * uSparkOn * step(0.93, lh(cell + floor(uSparkT * 9.0 + lh(cell) * 7.0))); }`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(1.0, 0.97, 0.92) * pSpark * 9.0;`);
        if (prev) prev(sh);
      };
    },
    // railing bars cut out of a strip (u metres along, v metres up): bars, a top and a bottom rail
    railing(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      const [r0, r1] = m.rails_m || [0.08, 1.25];
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBar: { value: m.bar_m || 0.13 }, uR0: { value: r0 }, uR1: { value: r1 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBar, uR0, uR1;')
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float fw = fwidth(vUv.x), bar = abs(fract(vUv.x / uBar) - 0.5) * uBar;
    float keep = max(step(bar, 0.012 + 0.5 * fw), max(step(abs(vUv.y - uR0), 0.04), step(abs(vUv.y - uR1), 0.05)));
    keep = max(keep, step(0.25, fw / uBar)); // too far to resolve the bars: a solid, see-through-ish strip
    if (keep < 0.5 || (fw / uBar > 0.25 && fract(dot(gl_FragCoord.xy, vec2(0.5, 0.25))) < 0.5)) discard; }`);
      };
    },
    // a roof of round tiles in rows (u metres along the eaves, v metres up the slope): a lit crown
    // and a shaded channel every bay_m, the lap of each course every course_m; far away, the mean
    roof_tiles(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 0.33 }, uCourse: { value: m.course_m || 0.3 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBay, uCourse;')
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float x = vUv.x / uBay, y = vUv.y / uCourse, fw = max(fwidth(x), fwidth(y));
    float crown = 0.5 + 0.5 * cos(6.2832 * x), lap = smoothstep(0.0, 0.18 + fw, fract(y));
    float near = 1.0 - smoothstep(0.3, 0.9, fw);
    diffuseColor.rgb *= mix(0.9, 0.7 + 0.38 * crown * mix(0.8, 1.0, lap), near); }`);
      };
    },
    // the Opera House's glass walls (u counts the mullions across the wall, v metres up): topaz
    // panes on bronze mullions with a thinner one between, transoms every transom_m, each pane its
    // own reflection; after dark the foyers light it from inside, pane by pane, the frames dark
    topaz_glass(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uFrame: { value: lin(m.frame || '#4a3a2a') }, uTransom: { value: m.transom_m || 2.7 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uFrame; uniform float uTransom; float pFrame, pLitK;
float tgHash(vec2 c) { return fract(sin(dot(c, vec2(27.17, 113.93))) * 31718.927); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float u = vUv.x, z = vUv.y, fu = fwidth(u), fz = fwidth(z);
    float mull = 1.0 - smoothstep(0.035, 0.035 + fu, abs(fract(u + 0.5) - 0.5));
    float sec = 1.0 - smoothstep(0.014, 0.014 + fu, abs(fract(u) - 0.5));
    float tr = 1.0 - smoothstep(0.05, 0.05 + fz, abs(fract(z / uTransom + 0.5) - 0.5) * uTransom);
    float far = smoothstep(0.12, 0.5, max(fu * 5.0, fz / uTransom * 2.0));
    pFrame = mix(max(max(mull, 0.8 * sec), tr), 0.2, far);
    vec2 cell = floor(vec2(u * 2.0, z / uTransom));
    diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.8 + 0.4 * tgHash(cell), 1.0, far), uFrame, pFrame);
    pLitK = (1.0 - pFrame) * mix(0.5 + 0.5 * tgHash(cell + 3.1), 0.75, far); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.45, pFrame);')
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.55, pFrame);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= pLitK;');
      };
    },
    // dressed stone in courses (u metres along the wall, v metres up): each course its own height
    // of block, each block its own length and tone, the joints dark; far away, the mean
    // On a seawall (v metres above the sea) the tidal band: dark weed and wet stone from the water up to
    // high water, drying paler above it.
    ashlar(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uCourse: { value: m.course_m || 0.7 }, uBlock: { value: m.block_m || 1.4 }, uTide: { value: m.tide ? 1 : 0 },
          uHighWater: { value: m.high_water_m ?? 0.85 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uCourse, uBlock, uTide, uHighWater; float pWet;
float ashHash(vec2 c) { return fract(sin(dot(c, vec2(41.31, 289.17))) * 15731.743); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float row = floor(vUv.y / uCourse), fy = fract(vUv.y / uCourse);
    float len = uBlock * (0.65 + 0.7 * ashHash(vec2(row, 3.1)));
    float x = vUv.x / len + ashHash(vec2(row, 7.7)), fx = fract(x);
    float fw = max(fwidth(vUv.x), fwidth(vUv.y));
    float joint = 1.0 - smoothstep(0.02, 0.04 + fw, min(min(fx, 1.0 - fx) * len, min(fy, 1.0 - fy) * uCourse));
    float near = 1.0 - smoothstep(0.08, 0.35, fw);
    float tone = 0.84 + 0.28 * ashHash(vec2(row, floor(x)));
    diffuseColor.rgb *= mix(0.95, tone * (1.0 - 0.5 * joint), near);
    pWet = 0.0;
    if (uTide > 0.5) { // high water (uHighWater, about 0.9 m up on a tidal harbour), ragged with the weed; a pale salt line just above it
      float hw = uHighWater + (0.12 * sin(vUv.x * 1.7) + 0.08 * sin(vUv.x * 5.3 + 1.0)) * min(1.0, uHighWater / 0.85);
      pWet = 1.0 - smoothstep(hw - 0.25, hw + 0.05, vUv.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.34, 0.27), pWet);
      diffuseColor.rgb *= 1.0 + 0.1 * (smoothstep(hw, hw + 0.15, vUv.y) - smoothstep(hw + 0.2, hw + 0.6, vUv.y));
    } }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.35, pWet);');
      };
    },
    // big LED screens playing their programmes ("led_screen"): the integer part of u picks the
    // screen in m.screens, its fraction runs across it, v runs up it. The material's map is a sheet
    // of keyframes, m.sheet = [columns, rows, cell width, cell height] (fractions of the image),
    // m.frames keyframes to a clip, each held m.frame_s seconds. Each screen, [aspect, phase s,
    // playlist (a bit mask over the clips), clips in it, on hour, off hour, brightness, sync, height m,
    // pixel pitch m], plays its clips in turn, a slow push into
    // each keyframe and a wipe to the next, and those with sync join the others every m.sync =
    // [clip, period s, length s] to play the same clip together, as the crossing's screens do. The
    // picture is light of its own: bright enough to read in the sun, dimmer after dark, off out of
    // hours, and its LEDs show as a grid of dots from close by.
    led_screen(mat, m) {
      if (!m.screens || !m.sheet) return;   // a screen material with no screens placed: a plain dark face
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      const S = m.screens, n = S.length, v4 = (i, a) => new THREE.Vector4(...[0, 1, 2, 3].map(j => (S[i] || [])[a + j] || 0));
      const A = [], Bv = [], Cv = [];
      for (let i = 0; i < n; i++) { A.push(v4(i, 0)); Bv.push(v4(i, 4)); Cv.push(v4(i, 8)); }
      const [cols, rows, cw, ch] = m.sheet, [sc, sp, sl] = m.sync || [-1, 1e9, 0];
      // each site's screens are a program of their own (their count is in the shader, and three.js
      // would otherwise share one program between materials whose onBeforeCompile reads the same)
      mat.customProgramCacheKey = () => `led_screen:${n}:${m.frame_s || 4}:${m.cell_aspect || 0}`;
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uScrA: { value: A }, uScrB: { value: Bv }, uScrC: { value: Cv }, uSheet: { value: new THREE.Vector4(cols, rows, cw, ch) },
          uSync: { value: new THREE.Vector4(sc, sp, sl, m.frames || 1) }, uScrT: SCREEN.t, uScrHour: SCREEN.hour, uScrNight: LM_NIGHT });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uScrA[${n}], uScrB[${n}], uScrC[${n}], uSheet, uSync; uniform float uScrT, uScrHour, uScrNight; vec3 pScr;
// the n-th clip of a playlist (a bit mask over the clips), counting round
float scrClip(float mask, float n) {
  float found = 0.0;
  for (int i = 0; i < 24; i++) {
    if (mod(floor(mask / exp2(float(i))), 2.0) > 0.5) { if (found == n) return float(i); found += 1.0; }
  }
  return 0.0;
}`)
          .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
vec3 scrCell(float cell, vec2 uv) {
  float col = mod(cell, uSheet.x), row = floor(cell / uSheet.x);
  uv = clamp(uv, 0.003, 0.997);
  return texture2D(map, vec2((col + uv.x) * uSheet.z, 1.0 - (row + 1.0 - uv.y) * uSheet.w)).rgb;
}`)
          .replace('#include <map_fragment>', `
  { int id = int(floor(vUv.x)); vec2 uv = vec2(fract(vUv.x), vUv.y);
    vec4 A = uScrA[id], B = uScrB[id], C = uScrC[id];
    float F = uSync.w, D = ${(m.frame_s || 4).toFixed(2)} * F, t = uScrT + A.y, k = floor(t / D), ct = fract(t / D);
    float clip = scrClip(A.z, mod(k, A.w)), nextClip = scrClip(A.z, mod(k + 1.0, A.w));
    float st = mod(uScrT, uSync.y);
    if (B.w > 0.5 && uSync.x >= 0.0 && st < uSync.z) { clip = uSync.x; nextClip = uSync.x; ct = st / uSync.z; }
    // the cell is cropped to the screen's shape (cover), then pushed into slowly
    float ca = ${(m.cell_aspect || 16 / 9).toFixed(4)};
    vec2 cuv = uv;
    if (A.x > ca) cuv.y = 0.5 + (uv.y - 0.5) * ca / A.x; else cuv.x = 0.5 + (uv.x - 0.5) * A.x / ca;
    float ft = ct * F, f = floor(ft), fr = fract(ft);
    vec3 c = scrCell(clip * F + f, 0.5 + (cuv - 0.5) / (1.0 + 0.07 * fr));
    float w = smoothstep(0.9, 1.0, fr); // the wipe to the next keyframe, along a slant
    if (w > 0.0) {
      vec3 c2 = scrCell(f < F - 1.0 ? clip * F + f + 1.0 : nextClip * F, cuv);
      float edge = (uv.x + 0.35 * uv.y) / 1.35;
      c = mix(c, c2, step(edge, w * 1.08 - 0.04)) + vec3(0.6) * (1.0 - smoothstep(0.0, 0.02, abs(edge - w * 1.08 + 0.04))) * step(0.01, w) * step(w, 0.99);
    }
    float h = uScrHour, on = B.x < B.y ? step(B.x, h) * step(h, B.y) : max(step(B.x, h), step(h, B.y));
    // the LEDs: a grid of dots at the pixel pitch, seen only from close by
    vec2 px = vec2(uv.x * A.x, uv.y) * C.x / max(C.y, 0.002);
    float pw = max(fwidth(px.x), fwidth(px.y)), dots = smoothstep(0.62, 0.3, length(fract(px) - 0.5));
    float grid = mix(0.35 + 1.3 * dots, 1.0, smoothstep(0.25, 0.7, pw));
    pScr = c * B.z * mix(2.4, 1.0, uScrNight) * on * grid; // bright enough to read in the sun; dimmed after dark, as they are
    diffuseColor.rgb = vec3(0.025); }`)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += pScr;');
      };
    }
  };
  // the screens' clock (seconds) and the hour, for their schedules (setSun, tick)
  const SCREEN = { t: { value: 0 }, hour: { value: 12 } };

  // build the scene into a new THREE.Scene; the caller owns the renderer and camera
  // The edge of the model: where the open data stops, the ground, the buildings and the
  // water fade into the haze over the last few hundred metres, and beyond the frame there
  // is only haze, so the city does not end in a cliff over a flat sea. It is the scene's
  // fog, anchored to the model's frame rather than to the camera: three.js's fog chunks,
  // with the frame written in as constants, so every material that takes fog takes it,
  // reflections included. The world position comes from the view matrix (rigid, so its
  // inverse is its transpose). Things within about 150 m of the camera stay clear, so you
  // can still stand near the edge.
  let FOG0 = null;
  // farLand: the land past the frame is drawn (farland.js), so the city fades into it only part
  // way (FAR_EDGE) instead of into a wall of haze
  function edgeHaze(frame, near = 150, farLand = false) {
    const C = THREE.ShaderChunk;
    if (!FOG0) FOG0 = { pv: C.fog_pars_vertex, v: C.fog_vertex, pf: C.fog_pars_fragment, f: C.fog_fragment };
    const w = frame.x[1] - frame.x[0], h = frame.y[1] - frame.y[0], fade = Math.min(500, Math.max(250, 0.1 * Math.min(w, h)));
    const n = v => v.toFixed(1), last = (chunk, add) => chunk.replace(/#endif\s*$/, `\t${add}\n#endif`); // inside the outer USE_FOG block
    C.fog_pars_vertex = last(FOG0.pv, 'varying vec2 vEdgeXZ;');
    C.fog_vertex = last(FOG0.v, 'vEdgeXZ = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).xz;');
    // how far out into the haze a point is (0 inside, 1 at the frame and beyond); the camera's own
    // value lifts the near exemption once it is out there itself, at the frame's edge and past it,
    // so the sea in front of it hazes too. (Lifted from the band's inner edge, it hazed the whole
    // view from a tour stop a few hundred metres inside the frame: Shibuya's Sangenjaya and Suga
    // Shrine looked out through fog.)
    const out = (p, a = 0, b = fade) => `smoothstep( ${n(a)}, ${n(b)}, length( max( abs( ${p} - vec2( ${n((frame.x[0] + frame.x[1]) / 2)}, ${n(-(frame.y[0] + frame.y[1]) / 2)} ) ) - vec2( ${n(w / 2 - fade)}, ${n(h / 2 - fade)} ), 0.0 ) ) )`;
    // Over the sea the frame ends nowhere in particular: past the frame's edge, where there is real
    // open water, the surface carries on and the distance's own haze takes it to the horizon,
    // darkening a little toward a distant sea's tone on the way; only over land does the water haze
    // out with the edge. Which it is comes from the city's sea.jpg (pipeline/open_sea.py): a land and
    // water mask SEA_HALF m either side of the frame's centre, from OpenStreetMap's coastline and
    // water, sharp at the frame and blurred more the further out a point is (its three channels), so
    // the open sea follows the real shore near the frame and meets the haze over land softly far
    // out. Only the water's materials take it (OE_SEA, uSeaOpen).
    const c = `vec2( ${n((frame.x[0] + frame.x[1]) / 2)}, ${n(-(frame.y[0] + frame.y[1]) / 2)} )`, hx = w / 2 - fade, hz = h / 2 - fade;
    C.fog_pars_fragment = last(FOG0.pf, `varying vec2 vEdgeXZ;
#ifdef OE_SEA
	uniform sampler2D uSeaOpen;
#endif`);
    C.fog_fragment = FOG0.f.replace('\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `\tfloat oeEdge = ${out('vEdgeXZ')}, oeGate = max( smoothstep( ${n(near)}, ${n(near * 4)}, vFogDepth ), ${out('cameraPosition.xz', fade * 0.8, fade * 1.5)} );
#ifdef OE_SEA
	{ vec2 oeP = vEdgeXZ - ${c}, oeH = vec2( ${n(hx)}, ${n(hz)} ); float oePast = length( max( abs( oeP ) - oeH, 0.0 ) );
	  vec3 oeM = texture2D( uSeaOpen, vec2( 0.5 + oeP.x / ${n(2 * SEA_HALF)}, 0.5 - oeP.y / ${n(2 * SEA_HALF)} ) ).rgb; // north up (flipY)
	  float oeOpen = oePast > 0.0 ? mix( mix( oeM.r, oeM.g, smoothstep( 0.0, ${n(SEA_SOFT[0])}, oePast ) ), oeM.b, smoothstep( ${n(SEA_SOFT[0])}, ${n(SEA_SOFT[1])}, oePast ) ) : 0.0;
	  // past the frame, the sun's glints far out, seen through that much air, no brighter than a little over the haze
	  gl_FragColor.rgb = mix( gl_FragColor.rgb, min( gl_FragColor.rgb, fogColor * ( 1.2 + 40.0 * ( 1.0 - fogFactor ) * ( 1.0 - fogFactor ) ) ), smoothstep( 0.0, 3000.0, oePast ) );
	  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * 0.75, oeOpen * 0.55 * smoothstep( 0.0, 9000.0, oePast ) * ( 1.0 - fogFactor ) );
#ifdef OE_FARLAND
	  if ( oePast > 30.0 && oeOpen < 0.5 ) discard; // over land past the frame the far land is drawn (farland.js)
#endif
	  oeEdge *= 1.0 - oeOpen; }
#endif
#ifdef OE_FAR
	// the land past the frame (farland.js): as hazed as the city at the frame, where the city has faded
	// into the haze, clearing over the first few hundred metres to a distant land's veil, and thickening
	// with distance as air does (FAR_AIR m to 63%), so a far city's plain meets the sky in haze, not in a band
	float oeFar = 0.0;
	{ float oePast = length( max( abs( vEdgeXZ - ${c} ) - vec2( ${n(w / 2)}, ${n(h / 2)} ), 0.0 ) );
	  float oeAir = 1.0 - exp( -vFogDepth / ${n(FAR_AIR)} );
	  oeFar = max( ${FAR_EDGE.toFixed(3)} * ( 1.0 - smoothstep( 0.0, ${n(FAR_RAMP)}, oePast ) ), ${FAR_BASE.toFixed(3)} + ${(1 - FAR_BASE).toFixed(3)} * oeAir );
	  oeEdge = 0.0; }
#endif
	// The edge's haze is a distant shore's tone, a little darker and greener than the horizon's, which
	// the distance takes back to the horizon's by 12 km: so a headland fading out at the frame, or an
	// island past it, reads as land in the haze beside the open sea rather than a pale blob on it.
	// (fogFactor still holds the edge, for the night's additive lights, night.js.)
	vec3 oeHaze = fogColor * mix( vec3( ${SEA_LAND.join(', ')} ), vec3( 1.0 ), max( fogFactor, smoothstep( 1500.0, 12000.0, vFogDepth ) ) );
	fogFactor = max( fogFactor, oeEdge * oeGate${farLand ? ` * ${FAR_EDGE.toFixed(3)}` : ''} );
#ifdef OE_FAR
	fogFactor = max( fogFactor, oeFar );
#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, oeHaze, fogFactor );
#ifdef OE_SEA
	gl_FragColor.a = mix( gl_FragColor.a, 1.0, fogFactor ); // the haze hides what lies under the water too, so nothing shows through it from below
#endif`);
    return fade;
  }
  // The open-water mask past the frame (edgeHaze, pipeline/open_sea.py SEA_HALF_M): its half width,
  // metres, and how far past the frame the water's edge has gone from sea.jpg's sharp channel (r) to
  // its soft one (g), and from that to its softest (b).
  // SEA_LAND: the edge haze's tone (distant land), as a share of the fog's colour.
  const SEA_HALF = 40000, SEA_SOFT = [2500, 9000], SEA_LAND = ['0.70', '0.76', '0.70'];
  // the land past the frame (farland.js): how far its haze takes to clear from the frame, and to how much
  const FAR_RAMP = (window.OEFarLand || {}).RAMP || 1400, FAR_BASE = (window.OEFarLand || {}).BASE || 0.32,
    FAR_EDGE = (window.OEFarLand || {}).EDGE || 0.2, FAR_AIR = (window.OEFarLand || {}).AIR || 30000;

  // Aerial photos are taken through a kilometre of air: their darkest tones are lifted by haze
  // and their colours are thin, which on the ground and the flat roofs reads as a grey wash.
  // photoGrade takes the haze back out (a black level, in linear light), deepens the mid-tones
  // a little and restores the colour, by amounts measured from the city's own tiles (photoStats).
  const PHOTO_GRADE = `uniform vec4 uPhotoGrade;
vec3 photoGrade(vec3 c) {
  c = pow(max(c - uPhotoGrade.x, 0.0) / (1.0 - uPhotoGrade.x), vec3(uPhotoGrade.y));
  return max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uPhotoGrade.z), 0.0);
}`;
  // a histogram of the tiles' luminance and their mean saturation, from a small copy of each
  function photoStats() {
    const S0 = { hist: new Float64Array(256), sat: 0, n: 0 }, cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d', { willReadFrequently: true });
    return {
      add(img) {
        try { g.drawImage(img, 0, 0, 64, 64); } catch (e) { return; }
        const d = g.getImageData(0, 0, 64, 64).data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b);
          if (mx < 6) continue; // no data
          S0.hist[Math.round(0.2126 * r + 0.7152 * gg + 0.0722 * b)]++;
          S0.sat += (mx - Math.min(r, gg, b)) / mx; S0.n++;
        }
      },
      // black level (linear), mid-tone gamma and saturation gain
      grade() {
        if (S0.n < 500) return null;
        let acc = 0, p2 = 0;
        for (let v = 0; v < 256; v++) { acc += S0.hist[v]; if (acc >= 0.02 * S0.n) { p2 = v; break; } }
        const black = 0.45 * Math.pow(p2 / 255, 2.2), sat = S0.sat / S0.n;
        return [Math.min(0.06, black), 1.08, THREE.MathUtils.clamp(0.16 / Math.max(sat, 0.01), 1, 1.3)];
      },
    };
  }

  // small: the lighter set for a weaker device (quality.js); shadow: the sun's shadow map size;
  // game: the game's world, whose own cars take over from the night's traffic within nearCars metres of the camera
  async function create(D, renderer, { onMsg = () => {}, small = Math.min(innerWidth, innerHeight) < 700, shadow = 0, game = false, nearCars = 0 } = {}) {
    const { B, P, LM, T } = D, scene = D.scene, loadMsg = onMsg;
    // the mapped lamps, benches and trees out of the carriageways, before any of them is drawn (streets.js)
    if (window.OEStreets) OEStreets.tidy(D);
    // the street lights' light (night.js), which the ground, the piers and the walls add to what they reflect
    const NU = window.OENight && D.N ? OENight.uniforms() : null;
    const NIGHT = NU ? OENight.GLSL : 'vec3 streetLight(vec3 wp) { return vec3(0.0); }';
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const SHADOW = Math.min(renderer.capabilities.maxTextureSize, shadow || (renderer.capabilities.maxTextureSize >= 8192 && !small ? 4096 : 2048));

    const world = new THREE.Scene();
    const sky = new THREE.Sky();
    sky.scale.setScalar(50000);
    world.add(sky);
    const su = sky.material.uniforms;
    su.turbidity.value = 3.5; su.rayleigh.value = 1.1; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    if (su.cloudCoverage) su.cloudCoverage.value = 0; // r183+ Sky draws clouds by default; the analysis assumes a clear sky
    // r183 also made the sky's output linear and its sun disc ~60,000 times the sky, which the
    // environment map turns into a second sun. Keep r128's tone curve and disc, the light this
    // app's exposure and materials were tuned under.
    // With the sun a few degrees down the Preetham sky is all but black, while the real sky stays a deep blue through
    // civil twilight: `twilight` (set in setSun) adds that blue, strongest toward the horizon.
    su.twilight = { value: new THREE.Color(0, 0, 0) };
    sky.material.fragmentShader = 'uniform vec3 twilight;\n' + sky.material.fragmentShader
      .replace('varying float vSunE;', 'varying float vSunE;\n varying float vSunfade;\n uniform float uGold, uGoldBeltK; uniform vec3 uGoldWarm, uGoldCool, uGoldCream, uGoldBelt;\n uniform vec3 uHaze; uniform float uHazeOn; uniform float uHazeH; uniform float uSkySat;\n uniform float uNightSky; uniform vec3 uNightZenith; uniform vec3 uNightHorizon;')
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisc;\n vec3 texColor = ( Lin + L0 ) * 0.04')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) + twilight * ( 0.45 + 0.55 * pow( 1.0 - max( direction.y, 0.0 ), 2.0 ) ), 1.0 );' +
        // that curve leaves the sky nearly white under a filmic tone curve: uSkySat gives the blue back
        // (the game sets it, atmosphere.js), and the last few degrees above the horizon go into the
        // haze the model's edge fades into (setSun)
        '\n gl_FragColor.rgb = max( mix( vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), gl_FragColor.rgb, uSkySat ), 0.0 );' +
        // golden hour (setSun): with the sun a few degrees up the Preetham sky is a flat grey-beige, where the
        // real one is amber toward the sun along the horizon, a warm cream low all round, blue overhead, with a
        // peach band (the Belt of Venus) low across from it once the sun is down. The sky keeps its brightness and takes that hue (uGold, 0..1).
        '\n { float gL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );' +
        '\n   vec2 gD = direction.xz / max( length( direction.xz ), 1e-4 ), gS = vSunDirection.xz / max( length( vSunDirection.xz ), 1e-4 );' +
        '\n   float gTo = pow( clamp( 0.5 + 0.5 * dot( gD, gS ), 0.0, 1.0 ), 2.0 ), gLow = 1.0 - smoothstep( 0.0, 0.5, max( direction.y, 0.0 ) ), gBand = 1.0 - smoothstep( 0.0, 0.12, max( direction.y, 0.0 ) );' +
        '\n   vec3 gHue = mix( uGoldCool, uGoldCream, 0.9 * gBand );' +
        '\n   gHue = mix( mix( gHue, uGoldBelt, uGoldBeltK * gLow * gLow * ( 1.0 - gTo ) ), uGoldWarm, gTo * mix( 0.25, 1.0, gLow * gLow ) );' +
        '\n   gl_FragColor.rgb = mix( gl_FragColor.rgb, gHue / dot( gHue, vec3( 0.2126, 0.7152, 0.0722 ) ) * gL, uGold ); }' +
        // after dark, the night sky of a city (setSun): deep blue overhead, the city's glow low down
        '\n gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uNightHorizon, uNightZenith, pow( clamp( direction.y, 0.0, 1.0 ), 0.6 ) ), uNightSky );' +
        '\n gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze, uHazeOn * ( 1.0 - smoothstep( -0.01, uHazeH, direction.y ) ) );');
    Object.assign(su, { uHaze: { value: new THREE.Color() }, uHazeOn: { value: 0 }, uHazeH: { value: 0.05 }, uSkySat: { value: 1 },
      uGold: { value: 0 }, uGoldBeltK: { value: 0 }, uGoldWarm: { value: new THREE.Color(1.0, 0.6, 0.3) }, uGoldCool: { value: new THREE.Color(0.24, 0.48, 1.0) }, uGoldCream: { value: new THREE.Color(1.0, 0.8, 0.6) },
      uGoldBelt: { value: new THREE.Color(0.86, 0.68, 0.7) }, uNightSky: { value: 0 }, uNightZenith: { value: new THREE.Color(0.0028, 0.0075, 0.019) }, uNightHorizon: { value: new THREE.Color(0.03, 0.026, 0.024) } });
    // the sky sits on the far plane, which a reversed depth buffer (the game's) puts at 0, not 1
    sky.material.vertexShader = sky.material.vertexShader
      .replace('gl_Position.z = gl_Position.w;', '#ifdef USE_REVERSED_DEPTH_BUFFER\n\tgl_Position.z = 0.0;\n#else\n\tgl_Position.z = gl_Position.w;\n#endif');
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(50); // inside the PMREM cube camera's far plane
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT = null, envKey = '', envAt = -1e9, envWait = null;

    const sunLight = new THREE.DirectionalLight(0xffffff, 2 * Math.PI); // intensities are physical since r155: π × the old values
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(SHADOW, SHADOW);
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 1.0;
    const shCam = sunLight.shadow.camera;
    shCam.near = 10; shCam.far = 9000;
    world.add(sunLight, sunLight.target);
    const hemi = new THREE.HemisphereLight(0xc3d6e6, 0x4d463a, 0.25 * Math.PI);
    world.add(hemi);
    const TWI_SKY = new THREE.Color(0.03, 0.075, 0.24), TWI_LIGHT = new THREE.Color(0x4a72c8), TWI_FOG = new THREE.Color(0x23385e);   // the blue hour (setSun)
    world.fog = new THREE.Fog(0xc6d3dc, 6000, 26000);
    // whether there is land past the frame to draw (farland.js), before the haze is written
    const farOn = !!window.OEFarLand && new URLSearchParams(location.search).get('far') !== 'off'
      && await fetch(D.DATA + 'far.json', { method: 'HEAD' }).then(r => r.ok, () => false);
    const edgeFade = edgeHaze(scene.frame, 150, farOn);

    // ------------------------------------------------------------ terrain and imagery
    loadMsg('Draping aerial imagery on the terrain', 0.35);
    await idle();
    const texLoader = new THREE.TextureLoader();
    const groundMeshes = [];
    const PG = { value: new THREE.Vector4(0, 1, 1, 0) }, stats = photoStats();
    let tilesLeft = scene.ground.length;
    const tileLoaded = tex => {
      stats.add(tex.image);
      if (--tilesLeft > 0) return;
      const gr = stats.grade();
      if (gr) PG.value.set(gr[0], gr[1], gr[2], 1);
    };
    // Where the ground is not drawn (landmarks.json "clip", rasterised at half a metre): under a
    // landmark's paving, which it would show through, and out in front of a seawall, where on a
    // 5 or 10 m grid it slopes up out of the water between the last point on land and the first in
    // the water. Walking, the camera and the analyses keep the terrain as it is.
    const CLIP = (() => {
      const regions = LM.clip || [];
      if (!regions.length) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of regions) for (const [x, y] of c.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const res = 0.5, w = Math.ceil((x1 - x0) / res) + 2, h = Math.ceil((y1 - y0) / res) + 2;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
      for (const c of regions) {
        g.beginPath();
        for (const r of [c.ring].concat(c.holes || [])) r.forEach(([x, y], k) => g[k ? 'lineTo' : 'moveTo']((x - x0) / res + 1, (y1 - y) / res + 1));
        g.fill('evenodd');
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.NoColorSpace;
      const px = g.getImageData(0, 0, w, h).data;
      // within a clip region, or a metre and a half from one (a landmark's own seawall runs along its edge)
      const near = (x, y) => {
        const c = Math.round((x - x0) / res + 1), r = Math.round((y1 - y) / res + 1);
        for (let dr = -3; dr <= 3; dr += 3) for (let dc = -3; dc <= 3; dc += 3) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < h && cc < w && px[4 * (rr * w + cc)] > 127) return true;
        }
        return false;
      };
      return { tex: { value: tex }, box: { value: new THREE.Vector4(x0 - res, y1 + res, w * res, h * res) }, near };
    })();
    // the seawalls along every built shore (quays.js), from shore.png: the ground drawn is raised to
    // them (tileGeometry) and not drawn above the water out in front of them (clipGround)
    // the open water past the frame (edgeHaze); without it everything past the frame is haze
    const seaLoad = new Promise(res => texLoader.load(D.DATA + 'sea.jpg', t => { t.colorSpace = THREE.NoColorSpace; res(t); }, undefined, () => res(null)));
    // and the land past it (farland.js, far.*), but for ?far=off, to compare
    const farLoad = farOn ? OEFarLand.load(D.DATA) : Promise.resolve(null);
    let shoreTex = null, Q = null;
    if (scene.shore) {
      shoreTex = await new Promise(res => texLoader.load(D.DATA + scene.shore.file, res, undefined, () => res(null)));
      if (shoreTex) { shoreTex.colorSpace = THREE.NoColorSpace; shoreTex.generateMipmaps = false; shoreTex.minFilter = THREE.LinearFilter; shoreTex.flipY = false; }
      if (shoreTex && window.OEQuays && new URLSearchParams(location.search).get('quays') !== 'off') try { // ?quays=off: without, to compare
        const sh = scene.shore, img = shoreTex.image, cv = document.createElement('canvas');
        cv.width = sh.nx; cv.height = sh.ny;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        Q = OEQuays.create({ px: g.getImageData(0, 0, sh.nx, sh.ny).data, nx: sh.nx, ny: sh.ny, cell: sh.cell, x0: sh.x0, y1: sh.y1 },
          D.Tfine || T, { band: 1.5 * T.cell, skip: CLIP && CLIP.near, faces: LM.seawalls || [] });
        if (!Q.quayPixels) Q = null;
      } catch (e) { console.warn('quays: none drawn', e); Q = null; }
    }
    D.quays = Q;
    const QUAY = Q && { mask: { value: Q.maskTexture() }, dist: { value: shoreTex }, box: { value: new THREE.Vector4(...Q.box) } };
    const clipGround = sh => {
      if (QUAY) { // out in front of a quay, above the water: the grid's ramp up to the land
        Object.assign(sh.uniforms, { uQuayMask: QUAY.mask, uQuayDist: QUAY.dist, uQuayBox: QUAY.box });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vQuayWP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvQuayWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uQuayMask, uQuayDist; uniform vec4 uQuayBox; varying vec3 vQuayWP;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { vec2 quv = vec2((vQuayWP.x - uQuayBox.x) / uQuayBox.z, (uQuayBox.y + vQuayWP.z) / uQuayBox.w);
    if (vQuayWP.y > -0.05 && all(greaterThan(quv, vec2(0.0))) && all(lessThan(quv, vec2(1.0))) && texture2D(uQuayMask, quv).r > 0.5 && texture2D(uQuayDist, quv).r > 127.5 / 255.0) discard; }`); // from a quarter metre back: under the coping
      }
      if (!CLIP) return;
      Object.assign(sh.uniforms, { uClip: CLIP.tex, uClipBox: CLIP.box });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClipWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvClipWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uClip; uniform vec4 uClipBox; varying vec3 vClipWP;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { vec2 cuv = vec2((vClipWP.x - uClipBox.x) / uClipBox.z, 1.0 - (uClipBox.y + vClipWP.z) / uClipBox.w);
    if (vClipWP.y > -0.05 && all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0))) && texture2D(uClip, cuv).r > 0.5) discard; }`); // under the water the ground stays: the sea floor
    };
    // under a wood's or a park's canopy (woods.png, pipeline/woods.py) the photo shows the tops of
    // the trees, which seen from the ground read as a teal sea: near the camera the ground there is
    // drawn as a wood's floor instead (bare earth, leaf litter and moss in patches, compacted
    // gravel and earth where a footway runs under the trees), and the trees planted from the
    // canopy stand on it; from further off the photo's canopy takes over again
    let woodsTex = null;
    if (scene.woods && new URLSearchParams(location.search).get('woods') !== 'off') { // ?woods=off: without, to compare
      woodsTex = await new Promise(res => texLoader.load(D.DATA + scene.woods.file, res, undefined, () => res(null)));
      if (woodsTex) { woodsTex.colorSpace = THREE.NoColorSpace; woodsTex.flipY = false; woodsTex.generateMipmaps = false; woodsTex.minFilter = THREE.LinearFilter; }
    }
    const WOODS = woodsTex && { tex: { value: woodsTex }, box: { value: new THREE.Vector4(scene.woods.x0, scene.woods.y1, scene.woods.nx * scene.woods.cell, scene.woods.ny * scene.woods.cell) } };
    // the floor's three colours (linear albedo), by what grows or lies under the city's park trees (woods.py FLOOR)
    const FLOOR = {
      earth: ['vec3(0.15, 0.1, 0.058)', 'vec3(0.21, 0.135, 0.066)', 'vec3(0.085, 0.12, 0.04)'], // bare earth, leaf litter, moss
      lawn: ['vec3(0.068, 0.11, 0.034)', 'vec3(0.095, 0.135, 0.042)', 'vec3(0.15, 0.105, 0.062)'], // grass in shade, in sun, worn to earth
      gravel: ['vec3(0.3, 0.255, 0.19)', 'vec3(0.36, 0.305, 0.225)', 'vec3(0.2, 0.16, 0.11)'], // stabilised sand and gravel, damp under the crowns
    }[(scene.woods || {}).floor] || ['vec3(0.15, 0.1, 0.058)', 'vec3(0.21, 0.135, 0.066)', 'vec3(0.085, 0.12, 0.04)'];
    const woodsFloor = sh => {
      if (!WOODS) return;
      Object.assign(sh.uniforms, { uWoods: WOODS.tex, uWoodsBox: WOODS.box });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWoodWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWoodWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uWoods; uniform vec4 uWoodsBox; varying vec3 vWoodWP;
float woodH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float woodN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(woodH(i), woodH(i + vec2(1, 0)), f.x), mix(woodH(i + vec2(0, 1)), woodH(i + vec2(1, 1)), f.x), f.y); }
vec3 woodsFloor(vec3 c) {
  vec2 uv = vec2((vWoodWP.x - uWoodsBox.x) / uWoodsBox.z, (uWoodsBox.y + vWoodWP.z) / uWoodsBox.w);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return c;
  vec4 m = texture2D(uWoods, uv);
  float d = distance(vWoodWP, cameraPosition);
  // in a park, the photo's shadows on its gravel are skylight blue (the same teal), and the scene
  // casts its own: near the camera, their colour taken out
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float blue = smoothstep(0.005, 0.03, c.b - c.g) * smoothstep(0.01, 0.04, c.b - c.r);
  c = mix(c, vec3(L) * vec3(1.06, 1.0, 0.9), blue * m.a * 0.85 * (1.0 - smoothstep(150.0, 700.0, d)));
  // as far as the trees go (trees.js WOOD_M), and only from among them: from above, the gaps between their
  // crowns are the lower canopy and the undergrowth, which the photo has
  float fade = max(smoothstep(${small ? '260.0, 560.0' : '320.0, 780.0'}, d), smoothstep(30.0, 90.0, cameraPosition.y - vWoodWP.y));
  // further off, the photo's canopy stands for the trees: its teal turned to the leaves' green at its own brightness
  L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(0.62, 1.0, 0.34) * L * 1.05, m.r * fade * 0.8);
  float k = m.r * (1.0 - fade);
  if (k < 0.004) return c;
  vec2 p = vWoodWP.xz;
  float patches = woodN(p * 0.11) * 0.6 + woodN(p * 0.37 + 3.1) * 0.4;
  float grain = woodN(p * 1.9) * 0.45 + woodN(p * 6.3) * 0.33 + woodN(p * 21.0) * 0.22;
  // linear albedos, in patches (darker where the canopy is tall: deeper shade, damper ground)
  vec3 g = mix(${FLOOR[0]}, ${FLOOR[1]}, smoothstep(0.35, 0.72, patches));
  g = mix(g, ${FLOOR[2]}, smoothstep(0.5, 0.82, woodN(p * 0.19 + 7.0)) * 0.85);
  g *= (0.78 + 0.44 * grain) * mix(1.0, 0.82, smoothstep(6.0, 22.0, m.g * 32.0));
  vec3 path = vec3(0.29, 0.26, 0.21) * (0.86 + 0.28 * woodN(p * 8.0));
  g = mix(g, path, smoothstep(0.2, 0.6, m.b));
  return mix(c, g, k);
}`).replace('#include <emissivemap_fragment>', 'diffuseColor.rgb = woodsFloor(diffuseColor.rgb);\n#include <emissivemap_fragment>');
    };
    const gradePhoto = sh => {
      clipGround(sh);
      sh.uniforms.uPhotoGrade = PG;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${PHOTO_GRADE}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = photoGrade(diffuseColor.rgb);');
      woodsFloor(sh); // after the photo, the game's drawn streets and grain: the floor has its own
      streetLit(sh);
    };
    // the street lights on a lit surface: its colour times their light where it is (the world
    // position from the view position, as the view matrix is rigid)
    const streetLit = sh => {
      if (!NU) return;
      Object.assign(sh.uniforms, NU);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${NIGHT}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * streetLight(transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz));`);
    };
    // a ground tile draped on terrain grid Tg (the viewer's 10 m grid, or the game's 5 m one near the player)
    // Drawn only within the frame: the tiles' grid overhangs it by up to 800 m, which past the frame is
    // only haze and would lie over the open sea there, cutting it off along a straight line (issue 57).
    function tileGeometry(t, Tg) {
      const F = scene.frame, x0 = Math.max(t.x0, F.x[0]), x1 = Math.min(t.x1, F.x[1]), y0 = Math.max(t.y0, F.y[0]), y1 = Math.min(t.y1, F.y[1]);
      if (x1 <= x0 || y1 <= y0) { // wholly outside: nothing to draw (kept, so groundMeshes stays one to a tile)
        const e = new THREE.BufferGeometry();
        for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2]]) e.setAttribute(k, new THREE.Float32BufferAttribute([], n));
        return e;
      }
      const w = x1 - x0, h = y1 - y0;
      const g = new THREE.PlaneGeometry(w, h, Math.max(1, Math.round(w / Tg.cell)), Math.max(1, Math.round(h / Tg.cell)));
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, -(y0 + y1) / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - t.x0) / (t.x1 - t.x0), (-p.getZ(i) - t.y0) / (t.y1 - t.y0)); // the whole tile's photo
      if (Q) Tg = Q.raise(Tg, true); // the points out in the water along a quay at its level
      for (let i = 0; i < p.count; i++) p.setY(i, S.terrainAt(Tg, p.getX(i), -p.getZ(i)));
      g.computeVertexNormals();
      // under the cells raised to a quay, which the ground shader leaves open above the water: the bottom
      if (Tg.up) {
        const cols = Math.max(1, Math.round(w / Tg.cell)) + 1, rows = p.count / cols, at = [];
        const up = i => {
          const c = Math.round((p.getX(i) - Tg.x0) / Tg.cell), r = Math.round((Tg.y1 + p.getZ(i)) / Tg.cell);
          return c >= 0 && r >= 0 && c < Tg.nx && r < Tg.ny && Tg.up[r * Tg.nx + c];
        };
        const y = -((scene.shore || {}).floor_m || 4) - 0.05;
        for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
          if (!(up(a) || up(b) || up(d) || up(e))) continue;
          for (const k of [a, d, b, b, d, e]) at.push(p.getX(k), y, p.getZ(k));
        }
        if (at.length) {
          const u = new THREE.BufferGeometry();
          u.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
          u.computeVertexNormals();
          g.userData.underlay = u;
        }
      }
      return g;
    }
    // a ground tile's mesh, with the bottom under its quays (tileGeometry)
    const quayBed = new THREE.MeshStandardMaterial({ color: lin(((scene.water || {}).seawall || {}).bed || '#3a3b33'), roughness: 1, metalness: 0 });
    function groundMesh(g, material) {
      const m = new THREE.Mesh(g, material);
      if (g.userData.underlay) m.add(new THREE.Mesh(g.userData.underlay, quayBed));
      return m;
    }
    for (const t of scene.ground) {
      const g = tileGeometry(t, T);
      const tex = texLoader.load(D.DATA + t.file, tileLoaded, undefined, () => tileLoaded({ image: null }));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const m = groundMesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
      m.material.onBeforeCompile = gradePhoto;
      m.receiveShadow = true;
      world.add(m);
      groundMeshes.push(m);
    }

    // water: the wind-driven sea of water.js where the GPU renders to float targets; otherwise
    // the old see-through sheet with ripples. On land the terrain covers it either way.
    let sea = null;
    const quality = (new URLSearchParams(location.search)).get('water') || 'auto';
    if (window.OEWater && quality !== 'flat' && renderer.capabilities.isWebGL2 &&
        (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) {
      try {
        const sh = scene.shore;
        sea = OEWater.create(renderer, scene.water || {}, shoreTex && { texture: shoreTex, x0: sh.x0, y1: sh.y1, w: sh.nx * sh.cell, h: sh.ny * sh.cell, slopes: sh.slopes, floor_m: sh.floor_m },
          { small, software: OEWater.software(renderer), quality, edge: edgeFade });
      } catch (e) { console.warn('water: falling back to the flat sheet', e); sea = null; }
    }
    function rippleTexture() {
      const n = 128, c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
      const hgt = new Float32Array(n * n);
      for (let k = 0; k < 24; k++) {
        const fx = (1 + (k * 7) % 5) * (k % 2 ? 1 : -1), fy = 1 + (k * 3) % 4, ph = k * 1.7, amp = 1 / (1 + k * 0.25);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
          hgt[y * n + x] += amp * Math.sin(2 * Math.PI * (fx * x + fy * y) / n + ph);
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = hgt[y * n + (x + 1) % n] - hgt[y * n + (x + n - 1) % n];
        const dy = hgt[((y + 1) % n) * n + x] - hgt[((y + n - 1) % n) * n + x];
        const i = 4 * (y * n + x);
        img.data[i] = 128 + dx * 22; img.data[i + 1] = 128 + dy * 22; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1600, 1600);
      return t;
    }
    const waterMat = new THREE.MeshStandardMaterial({ color: lin('#1d3a4b'), roughness: 0.08, metalness: 0.0, transparent: true,
      opacity: 0.84, normalMap: rippleTexture(), normalScale: new THREE.Vector2(0.25, 0.25) });
    // the sun's glitter on it as facets, not a blown slab (water.js patchGlitter)
    if (window.OEWater && OEWater.patchGlitter) waterMat.onBeforeCompile = sh => OEWater.patchGlitter(sh, SCREEN.t);
    const waterGeo = new THREE.PlaneGeometry(80000, 80000);
    waterGeo.rotateX(-Math.PI / 2);
    const water = sea ? sea.mesh : new THREE.Mesh(waterGeo, waterMat);
    water.receiveShadow = true;
    // past the frame's edge where it is open water, the sea carries on to the horizon (edgeHaze)
    const seaTex = await seaLoad;
    if (seaTex) {
      const so = { value: seaTex };
      for (const m of [water.material, waterMat]) {
        const ob = m.onBeforeCompile;
        m.defines = Object.assign({}, m.defines, { OE_SEA: '' });
        m.onBeforeCompile = (sh, r) => { if (ob) ob.call(m, sh, r); sh.uniforms.uSeaOpen = so; };
      }
    }
    // the land past the frame, under its haze (farland.js); the sea over it is not drawn
    let far = null;
    const farData = await farLoad;
    if (farData) try {
      far = OEFarLand.create(farData, { frame: scene.frame, ground: D.ground, small, PG, PHOTO_GRADE });
      world.add(far.mesh);
      if (seaTex) for (const m of [water.material, waterMat]) m.defines = Object.assign({}, m.defines, { OE_FARLAND: '' });
    } catch (e) { console.warn('far land: none drawn', e); far = null; }
    world.add(water);
    if (sea) for (const m of groundMeshes) m.material.onBeforeCompile = sh => { sea.patchGround(sh); gradePhoto(sh); };

    // the seawalls (quays.js): dressed stone in courses with the tidal band, under a coping; the city's stone in scene.json water.seawall (city.json water.seawall)
    const quayMeshes = [];
    if (Q) {
      const sw = Object.assign({ stone: '#8f8678', coping: '#b4ab9b', course_m: 0.6, block_m: 1.4, high_water_m: 0.85 }, (scene.water || {}).seawall || {});
      const face = new THREE.MeshStandardMaterial({ color: lin(sw.stone), roughness: 0.9, metalness: 0 });
      PATTERNS.ashlar(face, { course_m: sw.course_m, block_m: sw.block_m, tide: true, high_water_m: sw.high_water_m });
      const own = face.onBeforeCompile;
      face.onBeforeCompile = sh => {
        own(sh);
        // weathering: grime darkening down towards the tide line, in streaks along the wall
        sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `{ float streak = 0.5 + 0.5 * sin(vUv.x * 0.9 + 2.0 * sin(vUv.x * 0.23)) * sin(vUv.x * 2.7 + 1.3);
    diffuseColor.rgb *= mix(0.78 + 0.12 * streak, 1.0, smoothstep(0.0, 2.2, vUv.y - uHighWater)); }
#include <roughnessmap_fragment>`);
        streetLit(sh);
      };
      face.customProgramCacheKey = () => 'quay|face';
      const coping = new THREE.MeshStandardMaterial({ color: lin(sw.coping), roughness: 0.82, metalness: 0 });
      coping.onBeforeCompile = streetLit;
      coping.customProgramCacheKey = () => 'quay|coping';
      const { geos, length } = Q.geometries(Q.walls(), (scene.shore || {}).floor_m || 4);
      for (const g of geos) {
        const m = new THREE.Mesh(g, [face, coping]);
        m.receiveShadow = true;
        m.name = 'quay';
        world.add(m);
        quayMeshes.push(m);
      }
      console.info(`quays: ${(length / 1000).toFixed(1)} km of seawall in ${geos.length} pieces`);
    }

    // ------------------------------------------------------------ buildings
    loadMsg(`Building ${B.b.length.toLocaleString()} buildings: walls, roofs and facades`, 0.5);
    await idle();
    const SRC = { mapped: 0, survey: 0, reference: 0, verified: 0, plateau: 0, plateau_lod1: 0, lidar: 0, bdtopo: 0, '3dbag': 0, floors: 1, ml: 2, estimate: 2, typical: 2, parametric: 3 };
    // flat roofs sit this far below the wall tops, behind a parapet, so the outline keeps
    // the building's stated height
    const PARAPET = 0.5;
    function extrude(solids, colourOf) {
      const pos = [], nrm = [], col = [], fac = [], bid = [], src = [], sty = [], idx = [];
      let v = 0, style = [3, 3.5];
      const push = (x, y, z, n, c, u, h, b, s) => {
        pos.push(x, z, -y); nrm.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); fac.push(u, h); bid.push(b); src.push(s); sty.push(style[0], style[1]);
      };
      for (const s of solids) {
        const bi = s[0], g0 = s[1] / 10, zb = g0 + s[2] / 10, zt = g0 + s[3] / 10;
        const { wall, roof, code, windows, facade = 3, storey = 3.5 } = colourOf(bi);
        style = [windows ? facade : 3, storey];
        const recess = windows && zt - zb > 4 ? PARAPET : 0, zr = zt - recess;
        const rings = s.slice(4).map(r => r.map(q => q / 10));
        if (recess) for (const r of rings) { // the parapet's inner face, above the recessed roof
          const n = r.length / 2;
          for (let k = 0; k < n; k++) {
            const ax = r[2 * k], ay = r[2 * k + 1], j = (k + 1) % n, bx = r[2 * j], by = r[2 * j + 1];
            const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
            if (L < 0.05) continue;
            const nn = [-dy / L, 0, -dx / L];
            push(bx, by, zr, nn, wall, 0, -1, bi, code); push(ax, ay, zr, nn, wall, 0, -1, bi, code);
            push(ax, ay, zt, nn, wall, 0, -1, bi, code); push(bx, by, zt, nn, wall, 0, -1, bi, code);
            idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
            v += 4;
          }
        }
        for (const r of rings) {
          const n = r.length / 2;
          let u = 0;
          for (let k = 0; k < n; k++) {
            const ax = r[2 * k], ay = r[2 * k + 1], j = (k + 1) % n, bx = r[2 * j], by = r[2 * j + 1];
            const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
            if (L < 0.05) continue;
            const nn = [dy / L, 0, dx / L]; // local outward (dy, -dx) -> three (x, 0, -y)
            const hb = windows ? zb - g0 : -1, ht = windows ? zt - g0 : -1; // facade coordinates; -1 = no windows
            push(ax, ay, zb, nn, wall, u, hb, bi, code);
            push(bx, by, zb, nn, wall, u + L, hb, bi, code);
            push(bx, by, zt, nn, wall, u + L, ht, bi, code);
            push(ax, ay, zt, nn, wall, u, ht, bi, code);
            idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
            v += 4;
            u += L;
          }
        }
        const contour = [], holes = [];
        rings.forEach((r, i) => {
          const pts = [];
          for (let k = 0; k < r.length; k += 2) pts.push(new THREE.Vector2(r[k], r[k + 1]));
          if (i === 0) contour.push(...pts); else holes.push(pts);
        });
        let faces;
        try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
        const all = contour.concat(...holes), base = v;
        for (const p of all) { push(p.x, p.y, zr, [0, 1, 0], roof, -1, -1, bi, code); v++; }
        for (const f of faces) {
          const a = all[f[0]], b = all[f[1]], c = all[f[2]];
          const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
          if (ccw) idx.push(base + f[0], base + f[1], base + f[2]); else idx.push(base + f[0], base + f[2], base + f[1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('fac', new THREE.Float32BufferAttribute(fac, 2));
      g.setAttribute('bid', new THREE.Float32BufferAttribute(bid, 1));
      g.setAttribute('srcCode', new THREE.Float32BufferAttribute(src, 1));
      g.setAttribute('sty', new THREE.Float32BufferAttribute(sty, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    }
    const RESIDENTIAL_CLASSES = new Set(['apartments', 'residential', 'house', 'hotel', 'dormitory', 'terrace', 'semidetached_house', 'detached', 'bungalow']);
    const colourCache = new Map();
    const bColour = bi => {
      let c = colourCache.get(bi);
      if (!c) {
        const m = B.b[bi];
        // facade style: 2 a glass curtain wall (towers), 1 ribbon windows (offices and shops),
        // 0 punched windows; the storey height from the floor count where it is mapped
        const res = RESIDENTIAL_CLASSES.has(m[1]), top = m[2];
        const storey = m[3] > 0 ? Math.min(5, Math.max(2.7, top / m[3])) : res ? 3.0 : 3.9;
        c = { wall: lin(m[7]), roof: lin(m[8]), code: SRC[m[4]] ?? 2, windows: top >= 9 && m[1] !== 'roof' && m[4] !== 'parametric',
          facade: top >= 55 ? 2 : !res && top >= 15 ? 1 : 0, storey };
        colourCache.set(bi, c);
      }
      return c;
    };
    const U = { uNight: { value: 0 }, uSel: { value: -1 }, uMode: { value: 0 }, uHour: { value: 12 },
      uC0: { value: lin(css('--s1') || '#2a78d6') }, uC1: { value: lin(css('--s2') || '#eb6834') }, uC2: { value: lin(css('--s3') || '#1baf7a') } };
    // walls, LOD2 roofs, facades and rooftop plant (buildings.js); parts a parametric landmark
    // draws instead (scene.json hidden_solids) stay in B.s and the surface model, not on screen
    // the walls reach the ground drawn round them: the tiles (and in the game the finer ones near the player)
    const foot = (x, y) => Math.min(S.terrainTri(T, x, y), D.Tfine ? S.terrainTri(D.Tfine, x, y) : Infinity);
    U.uPhotoGrade = PG;
    if (NU) Object.assign(U, NU);
    const BLD = OEBuildings.create(D, { lin, U, renderer, SRC, small, foot, photoGrade: PHOTO_GRADE, night: NIGHT });
    const bGeo = BLD.geometry, buildings = BLD.mesh;
    const fr = scene.frame;
    U.uFrame.value.set(fr.x[0], fr.y[0], 1 / (fr.x[1] - fr.x[0]), 1 / (fr.y[1] - fr.y[0]));
    if (THREE.MeshBVH) { // a bounding-volume hierarchy makes picking a building ~300x faster
      bGeo.boundsTree = new THREE.MeshBVH(bGeo);
      buildings.raycast = THREE.acceleratedRaycast;
    }
    world.add(buildings, BLD.props);

    // piers and wharves: 2.2 m concrete decks, or level with the quay they meet where that is up to
    // 4 m higher (a seawall promenade), so that stepping down onto a pier is never a step you can't
    // climb back (D.pierZ: the game walks on the same decks)
    const DECK = (D.G && D.G.pier_deck_m) || 2.2, ground = D.Tfine || T;
    D.pierZ = (P.piers || []).map(r => {
      let top = -Infinity;
      for (let k = 0, n = r.length / 2; k < n; k++) {
        const j = (k + 1) % n, ax = r[2 * k] / 10, ay = r[2 * k + 1] / 10, bx = r[2 * j] / 10, by = r[2 * j + 1] / 10, L = Math.hypot(bx - ax, by - ay) || 1;
        for (let i = 0, m = Math.ceil(L / 2); i < m; i++) for (const o of [-1.5, 1.5]) { // just inside and just outside the edge
          const x = ax + (bx - ax) * i / m - (by - ay) / L * o, y = ay + (by - ay) * i / m + (bx - ax) / L * o;
          top = Math.max(top, S.terrainTri(ground, x, y));
        }
      }
      return top > DECK + 0.5 && top <= DECK + 4 ? top : DECK;
    });
    const pierColour = { wall: lin('#9c9a92'), roof: lin('#a7a59d'), code: 3, windows: false };
    const pierGeo = extrude((P.piers || []).map((r, i) => [-1, 0, 0, Math.round(D.pierZ[i] * 10), r]), () => pierColour);
    const piers = new THREE.Mesh(pierGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    // the deck's top shows the aerial photo, as a flat roof does (buildings.js uPhoto: the ground tiles in
    // one canvas): the parking bays, kerbs and sheds the photograph has of the wharf, not a plain slab
    // (issue 65); its sides stay concrete
    piers.material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uPhoto: U.uPhoto, uPhotoOn: U.uPhotoOn, uFrame: U.uFrame, uPhotoGrade: PG });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDeckW; varying float vDeckUp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDeckW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDeckUp = normal.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uPhoto; uniform float uPhotoOn; uniform vec4 uFrame; varying vec3 vDeckW; varying float vDeckUp;
${PHOTO_GRADE}`).replace('#include <color_fragment>', `#include <color_fragment>
  if (uPhotoOn > 0.5 && vDeckUp > 0.7) {
    vec2 duv = vec2((vDeckW.x - uFrame.x) * uFrame.z, (-vDeckW.z - uFrame.y) * uFrame.w);
    diffuseColor.rgb = mix(diffuseColor.rgb, photoGrade(texture2D(uPhoto, duv).rgb), 0.8);
  }`);
      streetLit(sh);
    };
    piers.castShadow = piers.receiveShadow = true;
    world.add(piers);
    // the game's boardwalks (game.json): 0.3 m timber decks at the pier deck height
    const walks = (D.G && D.G.boardwalks) || [];
    if (walks.length) {
      const top = Math.round((D.G.pier_deck_m || 2.2) * 10), timber = { wall: lin('#6f5a44'), roof: lin('#8a7258'), code: 3, windows: false };
      const deck = new THREE.Mesh(extrude(walks.map(r => [-1, top - 3, 0, 3, r]), () => timber), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      deck.material.onBeforeCompile = streetLit;
      deck.castShadow = deck.receiveShadow = true;
      world.add(deck);
    }

    // trees mapped in OSM, then those planted from the woods' and parks' canopy (pipeline/woods.py,
    // with measured heights; a third of them on a small device), then a landmark's own (landmarks.json
    // "trees", [x, y, z, height] dm: a roof garden's, standing on its terraces): the shared Blender species
    // (trees.js) in the city's mix, else low-poly crowns on short trunks; the mapped trees'
    // heights are not mapped (7-14 m spread)
    const nMapped = (P.trees || []).length / 4, TR = (P.trees || []).concat(P.woods || [], (LM && LM.trees) || []), nT = TR.length / 4;
    let trees = null;
    if (nT && window.OETrees) {
      try { trees = OETrees.create(world, await OETrees.load('assets/trees/'), TR, { mix: (scene.trees || {}).mix, woods: (scene.trees || {}).woods, areas: (scene.trees || {}).areas, south: D.CITY.lat < 0, lat: D.CITY.lat, cherry: (scene.trees || {}).cherry_open, measured: nMapped, keep: small ? 0.35 : 1, fixed: ((P.trees || []).length + (P.woods || []).length) / 4 }); }
      catch (e) { console.warn('Tree models unavailable, using simple ones:', e); }
    }
    if (nT && !trees) {
      const crownGeo = new THREE.IcosahedronGeometry(1, 1);
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1, 5);
      trunkGeo.translate(0, 0.5, 0);
      const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), nT);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: lin('#5b4a3a'), roughness: 0.9 }), nT);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
      const greens = ['#3f5f2e', '#4d6b34', '#56743a', '#38552b', '#5f7a3f'].map(lin);
      for (let i = 0; i < nT; i++) {
        const x = TR[4 * i] / 10, y = TR[4 * i + 1] / 10, z = TR[4 * i + 2] / 10, h = TR[4 * i + 3] / 10, r = h * 0.32;
        m4.compose(at.set(x, z + h - r, -y), q, sc.set(r, r * 1.1, r));
        crowns.setMatrixAt(i, m4);
        crowns.setColorAt(i, greens[(TR[4 * i + 3] * 7) % greens.length]);
        m4.compose(at.set(x, z, -y), q, sc.set(1, h - r * 1.4, 1));
        trunks.setMatrixAt(i, m4);
      }
      crowns.castShadow = crowns.receiveShadow = trunks.castShadow = true;
      world.add(crowns, trunks);
    }

    // ------------------------------------------------------------ landmarks
    loadMsg('Building the landmarks', 0.65);
    await idle();
    const lmMats = {}, floodMats = {}, lmTex = {};
    // an image the city's landmark_assets hook draws (signs, plaques, votive tablets), on texture coordinates 0..1
    const imageTex = f => lmTex[f] || (lmTex[f] = Object.assign(texLoader.load(D.DATA + f),
      { colorSpace: THREE.SRGBColorSpace, anisotropy: renderer.capabilities.getMaxAnisotropy() }));
    for (const [k, m] of Object.entries(LM.materials || {})) {
      lmMats[k] = new THREE.MeshStandardMaterial({ color: lin(m.color), roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide });
      if (m.pattern && PATTERNS[m.pattern]) PATTERNS[m.pattern](lmMats[k], m);
      // a bridge's deck, or paving ("street_lit"), under the street lights and the screens' glow
      if ((m.pattern === 'deck_zones' || m.street_lit) && NU) { const own = lmMats[k].onBeforeCompile; lmMats[k].onBeforeCompile = sh => { if (own) own(sh); streetLit(sh); }; }
      if (m.pattern === 'deck_zones' || m.street_lit) lmMats[k].userData.paving = true; // ground you walk on: it gets wet in the rain (weather.js)
      if (m.decal) Object.assign(lmMats[k], { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // laid over a roof: in front of it
      if (m.map) Object.assign(lmMats[k], { map: imageTex(m.map), alphaTest: m.cutout ? 0.5 : 0 }); // cutout: its clear pixels are holes
      if (m.opacity < 1) Object.assign(lmMats[k], { transparent: true, opacity: m.opacity, depthWrite: false }); // glass, nets
      // three.js caches a program by the text of onBeforeCompile, and wrappers (streetLit) read alike
      // across patterns: each patterned material keys its own
      if (lmMats[k].onBeforeCompile) lmMats[k].customProgramCacheKey = () => `lm|${k}`;
    }
    // meshes marked floodlit glow after dark; with emissive_map an image glows in its own colours (a screen, a lit sign)
    // (clone() drops onBeforeCompile and resets the defines, so the copy takes the pattern over explicitly)
    const floodlit = k => floodMats[k] || (floodMats[k] = Object.assign(lmMats[k].clone(), {
      emissive: lin(LM.materials[k].emissive || (LM.materials[k].emissive_map ? '#ffffff' : '#ffe2b8')), emissiveIntensity: 0,
      emissiveMap: LM.materials[k].emissive_map ? lmMats[k].map : null,
      userData: { glow: LM.materials[k].glow || 0.32 }, onBeforeCompile: floodFrom(LM.materials[k].flood, lmMats[k].onBeforeCompile),
      defines: Object.assign({}, lmMats[k].defines),
      // its own program: a floodlit copy of a patterned material, or one lit from below (which wraps
      // the pattern, so the wrapper's text alone would not tell two programs apart)
      customProgramCacheKey: LM.materials[k].flood ? () => `lm|${k}|flood` : lmMats[k].onBeforeCompile ? () => `lm|${k}|lit` : lmMats[k].customProgramCacheKey }));
    // a mesh under a slab or a canopy ("sky": the share of the sky it sees, landmarks.json) takes only
    // that share of the ambient light, which three.js spreads over every surface as if in the open:
    // without it a soffit and the columns under it read as pale as the paving in the sun (issue 84)
    // What does reach it comes mostly back up off the ground ("bounce", its colour), not from the
    // sky: the part it does not see of the sky takes the ground's hue, at the same brightness
    const skyMats = {}, sheltered = (base, key, sky, bounce) => {
      const id = `${key}|${sky}|${bounce || ''}`;
      if (skyMats[id]) return skyMats[id];
      let tint = 'vec3(1.0)';
      if (bounce) {
        const c = lin(bounce), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b || 1, k = 1 - sky;
        tint = `vec3(${[c.r, c.g, c.b].map(v => (1 + (v / l - 1) * k).toFixed(3)).join(', ')})`;
      }
      return (skyMats[id] = follow(base, Object.assign(base.clone(), {
        onBeforeCompile: sh => {
          if (base.onBeforeCompile) base.onBeforeCompile(sh);
          sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
            `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= ${sky.toFixed(3)} * ${tint}; reflectedLight.indirectSpecular *= ${sky.toFixed(3)};`);
        },
        defines: Object.assign({}, base.defines), userData: base.userData,
        customProgramCacheKey: () => `lm|${id}` })));
    };
    // (a floodlit one glows as its material does after dark: the same colour, the same intensity)
    const follow = (base, m) => {
      m.emissive = base.emissive;
      Object.defineProperty(m, 'emissiveIntensity', { get: () => base.emissiveIntensity, set: () => {} });
      return m;
    };
    const lmMaterial = m => {
      const base = m.floodlit ? floodlit(m.material) : lmMats[m.material];
      return m.sky != null && m.sky < 1 ? sheltered(base, (m.floodlit ? 'flood|' : '') + m.material, m.sky, m.bounce) : base;
    };
    const lmGeometry = m => {
      const p = m.position, arr = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { arr[i] = p[i]; arr[i + 1] = p[i + 2]; arr[i + 2] = -p[i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setIndex(m.index);
      if (m.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.computeVertexNormals();
      return g;
    };
    // small things are drawn only within their "far" (metres): beyond it they are under a pixel
    const screenMeshes = []; // the big LED screens' faces, for the light they throw (neon.js)
    const farObjs = [], farAt = (o, c, r, far) => { o.userData.far = { c, r2: (far + r) * (far + r) }; farObjs.push(o); };
    for (const m of LM.meshes || []) {
      const g = lmGeometry(m);
      const mesh = new THREE.Mesh(g, lmMaterial(m));
      if (m.far) { g.computeBoundingSphere(); farAt(mesh, g.boundingSphere.center.clone(), g.boundingSphere.radius, m.far); }
      mesh.castShadow = mesh.receiveShadow = true;
      if (['railing', 'lattice'].includes((LM.materials[m.material] || {}).pattern)) mesh.castShadow = false; // a cut-out strip; its shadow would be solid
      if ((LM.materials[m.material] || {}).opacity < 1) mesh.castShadow = false;
      if ((LM.materials[m.material] || {}).decal) mesh.castShadow = false; // paving on the ground: nothing under it to shade
      mesh.name = m.name;
      world.add(mesh);
      if ((LM.materials[m.material] || {}).pattern === 'led_screen') screenMeshes.push({ mesh, m: LM.materials[m.material], mat: lmMats[m.material] });
    }
    // street furniture (landmarks.json "props"): each kind's parts drawn once, instanced at every
    // place it stands ([x, y, z, heading, scale across]), one draw call per part
    const im4 = new THREE.Matrix4(), imQ = new THREE.Quaternion(), imP = new THREE.Vector3(), imS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    for (const pr of LM.props || []) {
      const c = new THREE.Vector3();
      for (const a of pr.at) c.add(W(a[0], a[1], a[2]));
      c.divideScalar(pr.at.length);
      let r = 0;
      for (const a of pr.at) r = Math.max(r, c.distanceTo(W(a[0], a[1], a[2])));
      for (const part of pr.parts) {
        const im = new THREE.InstancedMesh(lmGeometry(part), part.floodlit ? floodlit(part.material) : lmMats[part.material], pr.at.length);
        pr.at.forEach((a, i) => {
          imP.set(a[0], a[2], -a[1]); imQ.setFromAxisAngle(UP, a[3]); imS.set(a[4] || 1, 1, a[4] || 1);
          im.setMatrixAt(i, im4.compose(imP, imQ, imS));
        });
        im.computeBoundingSphere();
        im.castShadow = im.receiveShadow = true;
        im.name = `${pr.name}_${part.name}`;
        farAt(im, c, r + 10, pr.far || 600);
        world.add(im);
      }
    }

    // ------------------------------------------------------------ after dark (night.js)
    let night = null;
    if (NU) {
      loadMsg('Street lights, traffic and the towers\' lights', 0.68);
      await idle();
      try { night = OENight.create({ world, U }, D, renderer, NU, { small, game, nearCars }); }
      catch (e) { console.warn('night lights unavailable:', e); NU.uNightOn.value = 0; }
    }

    // ------------------------------------------------------------ sun
    const warm = new THREE.Color('#ffb070'), noonC = new THREE.Color('#fff3e0');
    const shX = new THREE.Vector3(), shY = new THREE.Vector3(), shAt = new THREE.Vector3();
    // The haze at the model's edge in the colour of the sky at the horizon (away from the sun's
    // glare, read back from a few pixels of the sky), and the sky's last few degrees above the
    // horizon in that haze: the city fades into the sky instead of ending in a grey band. Only
    // where the fog is mixed in linear light before the tone curve (the game's post stack sets
    // skyHaze); the viewer fogs after it and keeps its fixed colours.
    let hazeRT = null, hazeOk = false, fogBase = null;
    const hazeCam = new THREE.PerspectiveCamera(8, 1, 0.1, 100), hazeC = new THREE.Color(), hazePx = new Float32Array(16);
    function readHaze(az) {
      try {
        if (!hazeRT) hazeRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.FloatType });
        const prev = renderer.getRenderTarget(), on = su.uHazeOn.value, el = 1.5 * RAD;
        su.uHazeOn.value = 0;
        let r = 0, g = 0, b = 0;
        for (const turn of [0.5, 1, 1.5]) { // across from the sun and on either side
          const a = az + turn * Math.PI;
          hazeCam.lookAt(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el));
          renderer.setRenderTarget(hazeRT);
          renderer.render(envScene, hazeCam);
          renderer.readRenderTargetPixels(hazeRT, 0, 0, 2, 2, hazePx);
          for (let i = 0; i < 16; i += 4) { r += hazePx[i]; g += hazePx[i + 1]; b += hazePx[i + 2]; }
        }
        renderer.setRenderTarget(prev);
        su.uHazeOn.value = on;
        if (!(r + g + b > 0) || !isFinite(r + g + b)) return false;
        hazeC.setRGB(r / 12, g / 12, b / 12);
        return true;
      } catch (e) { return false; }
    }
    const api = {
      // the screens' faces and their programmes' clock, hour and night (neon.js lights the street from them)
      screens: { meshes: screenMeshes, clock: SCREEN, night: LM_NIGHT },
      world, sky, su, sunLight, shCam, hemi, pmrem, far, groundMeshes, quayMeshes, quays: Q, gradePhoto, streetLit, tileGeometry, groundMesh, water, waterMat, sea, trees, buildings, bGeo, U, SRC, extrude, bColour, floodMats, lmMats, night,
      sunDir: new THREE.Vector3(0, 1, 0), day: 1, edgeFade, // the width of the haze at the model's edge, metres (edgeHaze)
      // light the scene for a sun position {altitude, azimuth} and, for lit windows, the local
      // clock time in minutes; returns the daylight factor 0..1
      setSun(sp, minutes) {
        api.lastSun = { sp: Object.assign({}, sp), minutes };
        const alt = sp.altitude * RAD, az = sp.azimuth * RAD;
        api.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
        su.sunPosition.value.copy(api.sunDir);
        const day = smooth(-5, 8, sp.altitude);
        api.day = day;
        sunLight.visible = sp.altitude > -0.5;
        sunLight.intensity = Math.PI * 2.4 * smooth(-0.5, 7, sp.altitude); // full a little sooner: a low sun still rakes the city with gold
        sunLight.color.copy(warm).lerp(noonC, smooth(2, 30, sp.altitude));
        // the blue hour: the sun 0 to 8 degrees down, a blue sky and a blue light from it
        const tw = smooth(-11, -4, sp.altitude) * (1 - smooth(-2, 3, sp.altitude));
        su.twilight.value.copy(TWI_SKY).multiplyScalar(tw);
        // golden hour: the sun from just under the horizon to about 12 degrees up (the sky shader's uGold)
        su.uGold.value = 0.88 * smooth(-3, 0.5, sp.altitude) * (1 - smooth(5, 13, sp.altitude));
        su.uGoldBeltK.value = 1 - smooth(-1, 3, sp.altitude);
        // a city's own night glow (neon, street light); with the street lights drawn (night.js), the
        // night's own light is the moon's and the sky's, and the lamps light the streets themselves
        const amb = ((D.scene.city && D.scene.city.night_ambient) || 0) * (night ? 0.25 : 1);
        hemi.intensity = Math.PI * ((night ? 0.02 : 0.07) + 0.25 * day + 0.1 * tw * (1 - day) + amb * (1 - day));
        hemi.color.set(day > 0.3 ? 0xc3d6e6 : 0x5d6f92);
        if (day <= 0.3) hemi.color.lerp(TWI_LIGHT, tw * 0.6);
        U.uNight.value = 1 - smooth(-7, 2, sp.altitude);
        if (far) far.setNight(U.uNight.value);
        // The sky after dark as night photographs of a city show it: a deep blue overhead and, low
        // down, the glow its lights put in the air, which the haze at the model's edge takes too.
        // (The sky's own curve lifts a night sky to a grey tenth of the day's, which lit every glass
        // tower like an overcast evening.) Glass reflects both: blue above, warm below. With the
        // street lights drawn (night.js) the lamps do the lighting.
        su.uNightSky.value = night ? smooth(0.3, 1, U.uNight.value) : 0;
        if (night && night.skyglow) su.uNightHorizon.value.copy(night.skyglow).multiplyScalar(2.2);
        // without a clock, guess the hour from the sun: midday, else evening in the west and small hours in the east
        U.uHour.value = minutes != null ? minutes / 60 : sp.altitude > 0 ? 12 : sp.azimuth > 180 ? 21 : 4;
        for (const m of Object.values(floodMats)) m.emissiveIntensity = m.userData.glow * U.uNight.value;
        LM_NIGHT.value = U.uNight.value;
        SCREEN.hour.value = U.uHour.value;
        SPARKLE.on.value = U.uNight.value > 0.6 && minutes != null && ((minutes % 60) + 60) % 60 < 5 ? 1 : 0;
        renderer.toneMappingExposure = 0.55 + 0.35 * (1 - day);
        // the haze first, then the light from the sky: the environment is drawn with the horizon's
        // haze in it, so it has to be this hour's haze (it kept the last one, a day's haze at night).
        // api.envEvery (ms) allows one new sky at most that often: a sun easing between two hours
        // would otherwise rebuild it nearly every frame. The one held back waits for tick.
        const key = `${Math.round(sp.altitude / 2)}|${Math.round(sp.azimuth / 6)}`, now = performance.now();
        const newSky = key !== envKey && now - envAt >= (api.envEvery || 0);
        envWait = key !== envKey && !newSky ? { sp: Object.assign({}, sp), minutes } : null;
        if (newSky && api.skyHaze) hazeOk = readHaze(az);
        su.uHazeOn.value = api.skyHaze && hazeOk ? 1 : 0;
        // at night the haze is the night's blue with a little of the city's glow in it (night.js)
        // by day a grey-blue, warming to a sandy haze as the sun gets low; under that, the night's
        // blue through the blue hour (the warm lerp runs 0..1 over day 0..0.5 only: applied to the
        // day branch too it ran to 2 and pushed the noon haze past sand to orange)
        world.fog.color.set((day > 0.5 ? new THREE.Color(0xd2b49c).lerp(new THREE.Color(0xc6d3dc), smooth(0.5, 0.9, day))
          : (night ? su.uNightZenith.value.clone().multiplyScalar(1.4).add(su.uNightHorizon.value.clone().multiplyScalar(0.1)) : new THREE.Color(0x0c1420))
            .lerp(TWI_FOG, tw * 0.7).lerp(new THREE.Color(0xd2b49c), day * 2)).getHex());
        // and at night a little more air between the camera and the far city, so its lights soften
        // into that glow with distance (the view's own fog distances by day)
        if (!fogBase) fogBase = [world.fog.near, world.fog.far];
        world.fog.near = fogBase[0] * (1 - 0.55 * su.uNightSky.value); world.fog.far = fogBase[1] * (1 - 0.3 * su.uNightSky.value);
        // by day the sky's own horizon; through dusk back to the night's blue, which the sky's red night horizon would not give
        if (api.skyHaze && hazeOk) su.uHaze.value.copy(world.fog.color.lerp(hazeC, smooth(0.15, 0.6, day)));
        su.uHazeH.value = 0.05 + 0.2 * (1 - day); // at night a deeper glow, as far from the dark sky's colour as it is
        if (newSky) {
          envKey = key; envAt = now;
          if (envRT) envRT.dispose();
          const skySat = su.uSkySat.value;
          su.uSkySat.value = 1; // the light from the sky as the materials were tuned under; only its look is bluer
          envRT = pmrem.fromScene(envScene);
          su.uSkySat.value = skySat;
          world.environment = envRT.texture;
        }
        return day;
      },
      // keep the shadow map centred on what the camera looks at, at least half metres on each
      // side. A map that slides or stretches by a fraction of a texel every frame makes every
      // shadow edge in the city crawl, so its size moves in steps of a tenth (and holds while the
      // view is within about three steps of it) and its centre moves in whole texels along the
      // light's axes.
      fitShadow(target, half) {
        const cur = shCam.right;
        if (!(half <= cur && half > cur / 1.3)) {
          const q = Math.pow(1.1, Math.ceil(Math.log(half) / Math.log(1.1) - 1e-9));
          shCam.left = -q; shCam.right = q; shCam.top = q; shCam.bottom = -q; shCam.updateProjectionMatrix();
        }
        const texel = 2 * shCam.right / sunLight.shadow.mapSize.x, z = api.sunDir;
        shX.set(z.z, 0, -z.x); // up × z, the shadow camera's x axis
        const l = shX.length();
        if (l > 1e-6) {
          shX.divideScalar(l);
          shY.crossVectors(z, shX);
          const snap = v => Math.round(v / texel) * texel;
          shAt.copy(z).multiplyScalar(target.dot(z)).addScaledVector(shX, snap(target.dot(shX))).addScaledVector(shY, snap(target.dot(shY)));
        } else shAt.copy(target);
        sunLight.target.position.copy(shAt);
        sunLight.position.copy(shAt).addScaledVector(z, 4500);
      },
      // the date, for what flowers when (local month and day)
      setSeason(month, day) {
        if (trees) trees.setSeason(month, day);
        // a floodlight that changes with the season (landmarks.json "emissive_dates": [["MM-DD", "MM-DD", colour], ...]):
        // Tokyo Tower's white metal halide lamps in summer, its orange sodium ones the rest of the year
        const md = month * 100 + day;
        for (const [k, m] of Object.entries(floodMats)) {
          const dates = LM.materials[k].emissive_dates, cycle = LM.materials[k].emissive_cycle;
          if (!dates && !cycle) continue;
          const hit = dates && dates.find(([a, b]) => { const [p, q] = [a, b].map(s => +s.replace('-', '')); return p <= q ? md >= p && md < q : md >= p || md < q; });
          // a lighting that takes turns day by day ("emissive_cycle": [colour, ...]): Tokyo Skytree's
          // Iki blue one night and Miyabi purple the next
          const doy = Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 864e5);
          m.emissive.copy(lin(hit ? hit[2] : cycle ? cycle[doy % cycle.length] : LM.materials[k].emissive || '#ffe2b8'));
        }
      },
      // per frame, before the render: the waves (and their reflection) and the trees' wind and detail for this camera
      tick(t, camera) {
        if (envWait && performance.now() - envAt >= (api.envEvery || 0)) api.setSun(envWait.sp, envWait.minutes);
        SPARKLE.t.value = SCREEN.t.value = t * 0.001;
        if (camera) for (const o of farObjs) o.visible = camera.position.distanceToSquared(o.userData.far.c) < o.userData.far.r2;
        if (sea && camera) sea.update(t, camera, world); else waterMat.normalMap.offset.set(t * 0.000004, t * 0.0000025);
        if (trees && camera) trees.update(camera, t / 1000);
        if (night && camera) night.update(camera, t / 1000);
      },
      // after a lost WebGL context comes back (glcare.js): three.js has its state again, but a
      // render target comes back empty, so the sky's light (the PMREM target) and the haze read
      // from the sky are made again, and the shadow map redrawn. The water's FFT and wakes and
      // the post stack's targets are drawn afresh every frame.
      restoreGPU() {
        envKey = ''; envAt = -1e9; envWait = null; hazeOk = false;
        if (api.lastSun) api.setSun(api.lastSun.sp, api.lastSun.minutes);
        renderer.shadowMap.needsUpdate = true;
      },
      dispose() { if (envRT) envRT.dispose(); if (hazeRT) hazeRT.dispose(); pmrem.dispose(); if (sea) sea.dispose(); if (night) night.dispose(); if (far) far.dispose(); },
    };
    return api;
  }

  return { load, create, lin, smooth };
})();
