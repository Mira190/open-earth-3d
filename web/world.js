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
    // (lit_share of them, lit_k bright: a shop's glass is mostly lit and softer than an office's)
    curtain_wall(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 1.5 }, uSty: { value: m.storey_m || 4.0 }, uSpan: { value: m.spandrel || 0.25 },
          uMull: { value: m.mullion_m || 0.12 }, uFrame: { value: lin(m.frame || '#c9ced2') }, uLmNight: LM_NIGHT,
          uLitShare: { value: m.lit_share ?? 0.38 }, uLitK: { value: m.lit_k ?? 1.3 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uBay, uSty, uSpan, uMull, uLmNight, uLitShare, uLitK; uniform vec3 uFrame; float pWin, pLit; vec3 pLitC;
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
    pLitC = mix(cwHash(cf + 5.0) < 0.75 ? vec3(0.8, 0.9, 1.0) : vec3(1.0, 0.84, 0.62), vec3(0.85, 0.88, 0.9), far); }`)
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
        Object.assign(sh.uniforms, { uCourse: { value: m.course_m || 0.7 }, uBlock: { value: m.block_m || 1.4 }, uTide: { value: m.tide ? 1 : 0 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uCourse, uBlock, uTide; float pWet;
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
    if (uTide > 0.5) { // high water about 0.9 m up, ragged with the weed; a pale salt line just above it
      float hw = 0.85 + 0.12 * sin(vUv.x * 1.7) + 0.08 * sin(vUv.x * 5.3 + 1.0);
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

  // The golden hour. With the sun a few degrees up the Preetham sky is a flat grey-beige all round,
  // and so was the haze the city fades into, where the real sky is warm low down towards the sun and
  // a clear blue overhead and across from it. oeGolden takes a colour of the sky or of the haze over to
  // those tints at its own brightness (each tint has a luminance of one), so it gains colour but never
  // light, and adds a warm glow along the horizon on the sun's side. toward: the cosine between the
  // bearing it is seen on and the sun's; up: the sine of its height above the horizon; g: how golden
  // the hour is (setSun). The sky takes it from its own uniform, the hazes from GOLD (edgeHaze): the
  // sun's bearing in three.js x, z and, in z, how golden the hour is.
  const unitLum = c => c.multiplyScalar(1 / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b));
  const unitVec3 = rgb => { const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; return `vec3( ${rgb.map(v => (v / l).toFixed(4)).join(', ')} )`; };
  const GOLDEN = `vec3 oeGolden( vec3 c, float toward, float up, float g ) {
	if ( g <= 0.0 ) return c;
	float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), side = smoothstep( -0.3, 1.0, toward );
	vec3 warm = ${unitVec3([1.0, 0.6, 0.3])}, blue = ${unitVec3([0.32, 0.52, 0.85])};
	c = mix( c, lum * mix( blue, warm, side * side * exp( -up * 4.0 ) ), g * mix( 0.68, 0.45, smoothstep( 0.0, 0.6, up ) ) );
	return c + warm * lum * g * 0.45 * pow( max( toward, 0.0 ), 3.0 ) * exp( -up * 9.0 );
}`;
  // The haze's state, shared by every built-in material (edgeHaze adds these uniforms to three.js's
  // shader library; UniformsUtils.clone passes a plain object or a typed array on by reference, so
  // setSun's values reach them all): GOLD, the sun's bearing (x, z in three.js) and, in z, how golden
  // the hour is; SEA, the colour of a distant sea; RIM, how much of each stretch of the frame's edge
  // is open water (seaRim).
  const GOLD = { x: 0, y: 1, z: 0, w: 0 }, SEA = { x: 0, y: 0, z: 0 }, RIM_N = 12, RIM = new Float32Array(4 * RIM_N);

  // build the scene into a new THREE.Scene; the caller owns the renderer and camera
  // The edge of the model: where the open data stops, the ground, the buildings and the
  // water fade into the haze over the last few hundred metres, and beyond the frame there
  // is only haze, so the city does not end in a cliff over a flat sea. It is the scene's
  // fog, anchored to the model's frame rather than to the camera: three.js's fog chunks,
  // with the frame written in as constants, so every material that takes fog takes it,
  // reflections included. The world position comes from the view matrix (rigid, so its
  // inverse is its transpose). Things within about 150 m of the camera stay clear, so you
  // can still stand near the edge.
  //
  // Where the frame cuts across open water the sea does not stop, and a short fade into the sky's
  // pale haze drew a hard straight line across the dark water. So the haze takes its colour from
  // where it is: the sky's haze along a stretch of the edge that is land, the colour of a distant
  // sea (SEA, dark seen from above, bright seen low across it) along one that is open water (RIM,
  // blended between the sides by how near each is). The water, and the ground under it that shows
  // through it (materials that define OE_SEA_EDGE and OE_SEA_FLOOR), fade into it over SEA_FADES
  // times the distance and then, over a few times that again, on into the sky's haze, so the sea runs
  // on and softens; everything else fades as quickly as before, so the land still never ends in a
  // visible cut, and where it reaches a sea edge it sinks into the sea's colour rather than into a
  // pale patch. Both hazes, like the sky, take the golden hour (GOLDEN) on the bearing they are seen on.
  let FOG0 = null;
  const SEA_FADES = 3;
  function edgeHaze(frame, near = 150) {
    const C = THREE.ShaderChunk;
    if (!FOG0) FOG0 = { pv: C.fog_pars_vertex, v: C.fog_vertex, pf: C.fog_pars_fragment, f: C.fog_fragment };
    for (const k in THREE.ShaderLib) {
      const u = THREE.ShaderLib[k].uniforms;
      if (u && u.fogColor) Object.assign(u, { oeGold: { value: GOLD }, oeSeaHaze: { value: SEA }, oeRim: { value: RIM } });
    }
    const x0 = frame.x[0], x1 = frame.x[1], y0 = frame.y[0], y1 = frame.y[1], w = x1 - x0, h = y1 - y0;
    const fade = Math.min(500, Math.max(250, 0.1 * Math.min(w, h)));
    const n = v => v.toFixed(1), last = (chunk, add) => chunk.replace(/#endif\s*$/, `\t${add}\n#endif`); // inside the outer USE_FOG block
    C.fog_pars_vertex = last(FOG0.pv, 'varying vec2 vEdgeXZ;\n#ifdef OE_SEA_FLOOR\n\tvarying float vEdgeY;\n#endif');
    C.fog_vertex = last(FOG0.v, `vec3 oeWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
	vEdgeXZ = oeWorld.xz;
#ifdef OE_SEA_FLOOR
	vEdgeY = oeWorld.y;
#endif`);
    // how far a point is beyond the line where the haze begins, fade inside the frame (three.js x, z)
    const beyond = p => `length( max( abs( ${p} - vec2( ${n((x0 + x1) / 2)}, ${n(-(y0 + y1) / 2)} ) ) - vec2( ${n(w / 2 - fade)}, ${n(h / 2 - fade)} ), 0.0 ) )`;
    // RIM: RIM_N stretches a side, clockwise from the north-west corner (the north side west to east,
    // the east north to south, the south east to west, the west south to north); a point takes each
    // side's value where it lies along it, the nearer sides counting for more
    C.fog_pars_fragment = last(FOG0.pf, `varying vec2 vEdgeXZ;
#ifdef OE_SEA_FLOOR
	varying float vEdgeY;
#endif
	uniform vec4 oeGold; uniform vec3 oeSeaHaze; uniform vec4 oeRim[ ${RIM_N} ];
	${GOLDEN}
	float oeRimAt( int k ) { vec4 v = oeRim[ k / 4 ]; int c = k - 4 * ( k / 4 ); return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w; }
	float oeRimLerp( int side, float t ) {
		float f = clamp( t * ${RIM_N}.0 - 0.5, 0.0, ${RIM_N - 1}.0 ), a = fract( f );
		int i = int( f ), j = min( i + 1, ${RIM_N - 1} );
		return mix( oeRimAt( side * ${RIM_N} + i ), oeRimAt( side * ${RIM_N} + j ), a );
	}
	// a side's value at t along it, spread over b either way, so the line between sea and land blurs
	float oeSide( int side, float t, float b ) { return ( oeRimLerp( side, t - b ) + 2.0 * oeRimLerp( side, t ) + oeRimLerp( side, t + b ) ) * 0.25; }
	// how much of the frame's edge near p is open water: the nearer sides count for more, and the further
	// out p is, the wider a stretch of each it takes in; a stretch half water counts as sea
	float oeSeaness( vec2 p, float far ) {
		float x = p.x, y = - p.y, bx = 0.5 * far / ${n(w)}, by = 0.5 * far / ${n(h)};
		vec4 d = vec4( abs( ${n(y1)} - y ), abs( ${n(x1)} - x ), abs( y - ${n(y0)} ), abs( x - ${n(x0)} ) ) + ${n(fade)};
		vec4 wt = 1.0 / ( d * d );
		vec4 s = vec4( oeSide( 0, ( x - ${n(x0)} ) / ${n(w)}, bx ), oeSide( 1, ( ${n(y1)} - y ) / ${n(h)}, by ), oeSide( 2, ( ${n(x1)} - x ) / ${n(w)}, bx ), oeSide( 3, ( y - ${n(y0)} ) / ${n(h)}, by ) );
		return smoothstep( 0.15, 0.55, dot( wt, s ) / ( wt.x + wt.y + wt.z + wt.w ) );
	}`);
    // how far out into the haze a point is (0 inside, 1 at the frame and beyond); the camera's own
    // value lifts the near exemption when it is out there itself, so the sea in front of it hazes too
    const out = p => `smoothstep( 0.0, ${n(fade)}, ${beyond(p)} )`;
    // a haze on the bearing it is seen on, at the golden hour (at the horizon, as the sky's band of it)
    const golden = c => `oeGolden( ${c}, oeToward, 0.0, oeGold.z )`;
    C.fog_fragment = FOG0.f.replace('\tgl_FragColor.rgb', `\tfloat oeNear = max( smoothstep( ${n(near)}, ${n(near * 4)}, vFogDepth ), ${out('cameraPosition.xz')} );
	float oeToward = dot( normalize( vEdgeXZ - cameraPosition.xz + 1e-6 ), oeGold.xy );
	float oeOut = ${beyond('vEdgeXZ')}, oeSea = 0.0, oeWet = 0.0;
	if ( oeOut > 0.0 ) oeSea = oeSeaness( vEdgeXZ, oeOut );
#if defined( OE_SEA_EDGE )
	oeWet = 1.0;
#ifndef PREMULTIPLIED_ALPHA
	gl_FragColor.a = max( gl_FragColor.a, smoothstep( 0.0, ${n(fade)}, oeOut ) ); // a see-through sheet closes over the bottom, as there is none beyond
#endif
#elif defined( OE_SEA_FLOOR )
	oeWet = 1.0 - smoothstep( -0.4, 0.0, vEdgeY );
#endif
	// the haze of where it is: the sea's colour wherever the edge is much sea at all, so a headland the
	// frame cuts sinks into the water round it rather than lying on it as a pale patch; the water (and
	// what shows through it) fades into it slowly, the land as quickly as ever
	float oeCol = smoothstep( 0.0, 0.35, oeSea );
	float oeK = smoothstep( 0.0, mix( ${n(fade)}, ${n(fade * SEA_FADES)}, oeSea * oeWet ), oeOut ) * oeNear;
	// a distant sea is dark seen from above and, seen low across it or towards a low sun, nearly as bright
	// as the sky it mirrors
	float oeGraze = 1.0 - smoothstep( 0.05, 0.4, max( cameraPosition.y, 1.0 ) / max( length( vEdgeXZ - cameraPosition.xz ), 1.0 ) );
	oeGraze = max( oeGraze, oeGold.z * max( oeToward, 0.0 ) * max( oeToward, 0.0 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, ${golden('oeSeaHaze * mix( 0.35, 0.8, oeGraze )')}, oeK * oeCol );
	// and further out, and further from the eye, the air over that sea thickens into the sky's haze
	float oeAir = max( smoothstep( ${n(fade * SEA_FADES * 0.5)}, ${n(fade * SEA_FADES * 2.5)}, oeOut ), oeK * smoothstep( 1000.0, 6000.0, vFogDepth ) );
	fogFactor = max( fogFactor, min( 1.0, oeK * ( 1.0 - oeCol ) + oeCol * oeNear * oeAir ) );
	gl_FragColor.rgb`).replace('fogColor, fogFactor', `${golden('fogColor')}, fogFactor`);
    return fade;
  }

  // RIM from the shore field: the share of open water in each stretch of the frame's edge, over the
  // band the haze covers inside it (a canal or a river mouth is a small share, a harbour a large one)
  function seaRim(F, frame, cell) {
    const x0 = frame.x[0], x1 = frame.x[1], y0 = frame.y[0], y1 = frame.y[1], w = x1 - x0, h = y1 - y0;
    const band = Math.min(500, Math.max(250, 0.1 * Math.min(w, h))), step = Math.max(cell, 5);
    RIM.fill(0);
    const share = (ax, ay, bx, by) => { // the water in a box, sampled every step metres
      let wet = 0, all = 0;
      for (let y = Math.min(ay, by) + step / 2; y < Math.max(ay, by); y += step) for (let x = Math.min(ax, bx) + step / 2; x < Math.max(ax, bx); x += step) { all++; if (F.at(x, y) > 0) wet++; }
      return all ? wet / all : 0;
    };
    for (let i = 0; i < RIM_N; i++) {
      const a = i / RIM_N, b = (i + 1) / RIM_N;
      RIM[i] = share(x0 + a * w, y1 - band, x0 + b * w, y1);                       // north, west to east
      RIM[RIM_N + i] = share(x1 - band, y1 - a * h, x1, y1 - b * h);               // east, north to south
      RIM[2 * RIM_N + i] = share(x1 - a * w, y0, x1 - b * w, y0 + band);           // south, east to west
      RIM[3 * RIM_N + i] = share(x0, y0 + a * h, x0 + band, y0 + b * h);           // west, south to north
    }
  }

  // shore.png (pipeline/shore.py) read back: the signed distance to the shoreline (m, water positive)
  // and whether the shore is a beach (1) or rock (2), with lookups in the local frame
  function shoreField(img, sh) {
    const nx = img.width, ny = img.height, cv = document.createElement('canvas');
    if (nx !== sh.nx || ny !== sh.ny) return null;
    cv.width = nx; cv.height = ny;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, nx, ny).data, sd = new Float32Array(nx * ny), kind = new Uint8Array(nx * ny);
    cv.width = cv.height = 0;
    for (let i = 0, j = 0; i < sd.length; i++, j += 4) { sd[i] = (px[j] - 128) / 2; kind[i] = (px[j + 1] > 127 ? 1 : 0) | (px[j + 2] > 127 ? 2 : 0); }
    const cell = sh.cell, x0 = sh.x0, y1 = sh.y1;
    return {
      nx, ny, sd, kind,
      at(x, y) { // bilinear between pixel centres
        const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell - 0.5)), fy = Math.min(ny - 1.001, Math.max(0, (y1 - y) / cell - 0.5));
        const c = fx | 0, r = fy | 0, a = fx - c, b = fy - r, i = r * nx + c;
        return (sd[i] * (1 - a) + sd[i + 1] * a) * (1 - b) + (sd[i + nx] * (1 - a) + sd[i + nx + 1] * a) * b;
      },
      kindAt(x, y) { return kind[Math.min(ny - 1, Math.max(0, Math.floor((y1 - y) / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)))]; },
    };
  }

  // The seawall step. The terrain grid is 10 m, so where a quay meets the water the ground sloped
  // down across a whole cell and the aerial photo's paving (a forecourt, a promenade) was draped down
  // that slope into the water: a pale skirt round every seawall (Bennelong Point's most of all).
  // Where the shore is built (neither a beach nor rock in shore.png), the cells the shoreline crosses
  // are drawn on a lattice four times finer (twice on a smaller device): the land keeps the height of the land round it right up
  // to the shoreline, the water side lies just under the surface and then on the modelled bottom
  // (pipeline/shore.py's slope off a built shore, to its floor), and the lattice points nearest the
  // line are moved onto it, so the quay ends in a wall, as pipeline/game_data.py steps the game's own
  // terrain. Beaches and rocky shores keep the slope they have. Each lattice point moves within its
  // own half cell, so no triangle folds over; a point on the side of a cell drawn coarse stays on the
  // coarse surface, so the two meet without a gap.
  function seawallStep(F, T, sh, SUB = 4) {
    const L = T.cell / SUB, ncx = T.nx - 1, ncy = T.ny - 1, D = T.data;
    const slope = (sh.slopes && sh.slopes.built) || 1, floor = sh.floor_m || 4, QUAY = 0.3, LAND = 0.15;
    const flags = new Uint8Array(ncx * ncy);
    let cells = 0;
    for (let r = 0; r < ncy; r++) for (let c = 0; c < ncx; c++) {
      // a distance field: the shoreline cannot cross a cell whose centre is further from it than its corners are
      if (Math.abs(F.at(T.x0 + (c + 0.5) * T.cell, T.y1 - (r + 0.5) * T.cell)) > 0.75 * T.cell + 2) continue;
      let land = false, wet = false, other = false;
      for (let j = 0; j <= SUB && !other; j++) for (let i = 0; i <= SUB; i++) {
        const x = T.x0 + (c * SUB + i) * L, y = T.y1 - (r * SUB + j) * L;
        if (F.kindAt(x, y)) { other = true; break; }
        if (F.at(x, y) > 0) wet = true; else land = true;
      }
      if (land && wet && !other) { flags[r * ncx + c] = 1; cells++; }
    }
    const stepped = (c, r) => c >= 0 && r >= 0 && c < ncx && r < ncy && flags[r * ncx + c] === 1;
    // a lattice point is free to step when every cell it belongs to is stepped
    const free = (I, J) => {
      const c1 = Math.floor(I / SUB), r1 = Math.floor(J / SUB), c0 = I % SUB ? c1 : c1 - 1, r0 = J % SUB ? r1 : r1 - 1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!stepped(c, r)) return false;
      return true;
    };
    // the land's height at a point: its cell's corners on land only (a corner in the water would pull the
    // quay down into it); with none, the highest land round the cell
    const landHeight = (x, y) => {
      const fc = Math.max(0, Math.min(ncx - 1e-6, (x - T.x0) / T.cell)), fr = Math.max(0, Math.min(ncy - 1e-6, (T.y1 - y) / T.cell));
      const c = Math.floor(fc), r = Math.floor(fr), a = fc - c, b = fr - r, nx = T.nx;
      let w = 0, h = 0;
      for (const [k, wt] of [[r * nx + c, (1 - a) * (1 - b)], [r * nx + c + 1, a * (1 - b)], [(r + 1) * nx + c, (1 - a) * b], [(r + 1) * nx + c + 1, a * b]]) if (D[k] > LAND && wt > 0) { w += wt; h += wt * D[k]; }
      if (w > 1e-6) return h / w;
      let m = -Infinity;
      for (let j = Math.max(0, r - 1); j <= Math.min(T.ny - 1, r + 2); j++) for (let i = Math.max(0, c - 1); i <= Math.min(nx - 1, c + 2); i++) if (D[j * nx + i] > LAND) m = Math.max(m, D[j * nx + i]);
      return isFinite(m) ? m : 0.6;
    };
    const bottom = s => -Math.min(floor, Math.max(QUAY, s * slope));
    return {
      SUB, cells, stepped,
      // lattice point (I, J), I east and J south from the terrain's north-west corner: its place and height
      point(I, J) {
        let x = T.x0 + I * L, y = T.y1 - J * L;
        if (!free(I, J)) return { x, y, h: S.terrainTri(T, x, y), free: false };
        const s = F.at(x, y), land = s <= 0, h = land ? Math.max(LAND, landHeight(x, y)) : 0;
        if (Math.abs(s) < 1.5 * L) { // a Newton step onto the line, 0.2 m to its own side
          const e = 0.5, gx = (F.at(x + e, y) - F.at(x - e, y)) / (2 * e), gy = (F.at(x, y + e) - F.at(x, y - e)) / (2 * e), g2 = gx * gx + gy * gy;
          if (g2 > 0.1) {
            const k = ((land ? -0.2 : 0.2) - s) / g2, lim = 0.45 * L;
            x += Math.max(-lim, Math.min(lim, k * gx)); y += Math.max(-lim, Math.min(lim, k * gy));
          }
        }
        return { x, y, h: land ? h : bottom(Math.max(0, F.at(x, y))), free: true };
      },
      // the stepped ground under the water side of a stepped cell (Infinity elsewhere), for walls to reach down to
      below(x, y) {
        const c = Math.floor((x - T.x0) / T.cell), r = Math.floor((T.y1 - y) / T.cell);
        if (!stepped(c, r)) return Infinity;
        const s = F.at(x, y);
        return s > 0 ? bottom(s) : Infinity;
      },
    };
  }

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
      .replace('varying float vSunE;', `varying float vSunE;\n varying float vSunfade;\n uniform vec3 uHaze; uniform float uHazeOn; uniform float uHazeH; uniform float uSkySat;\n uniform float uNightSky; uniform vec3 uNightZenith; uniform vec3 uNightHorizon;\n uniform float uGolden;\n${GOLDEN}`)
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisc;\n vec3 texColor = ( Lin + L0 ) * 0.04')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) + twilight * ( 0.45 + 0.55 * pow( 1.0 - max( direction.y, 0.0 ), 2.0 ) ), 1.0 );' +
        // that curve leaves the sky nearly white under a filmic tone curve: uSkySat gives the blue back
        // (the game sets it, atmosphere.js), and the last few degrees above the horizon go into the
        // haze the model's edge fades into (setSun)
        '\n gl_FragColor.rgb = max( mix( vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), gl_FragColor.rgb, uSkySat ), 0.0 );' +
        // after dark, the night sky of a city (setSun): deep blue overhead, the city's glow low down
        '\n gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uNightHorizon, uNightZenith, pow( clamp( direction.y, 0.0, 1.0 ), 0.6 ) ), uNightSky );' +
        '\n gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze, uHazeOn * ( 1.0 - smoothstep( -0.01, uHazeH, direction.y ) ) );' +
        // and the golden hour (GOLDEN), over the haze too, as the haze over the city takes it (edgeHaze)
        '\n gl_FragColor.rgb = oeGolden( gl_FragColor.rgb, dot( normalize( direction.xz + 1e-6 ), normalize( vSunDirection.xz + 1e-6 ) ), max( direction.y, 0.0 ), uGolden );');
    Object.assign(su, { uHaze: { value: new THREE.Color() }, uHazeOn: { value: 0 }, uHazeH: { value: 0.05 }, uSkySat: { value: 1 },
      uNightSky: { value: 0 }, uNightZenith: { value: new THREE.Color(0.0028, 0.0075, 0.019) }, uNightHorizon: { value: new THREE.Color(0.03, 0.026, 0.024) },
      uGolden: { value: 0 } });
    // the sky sits on the far plane, which a reversed depth buffer (the game's) puts at 0, not 1
    sky.material.vertexShader = sky.material.vertexShader
      .replace('gl_Position.z = gl_Position.w;', '#ifdef USE_REVERSED_DEPTH_BUFFER\n\tgl_Position.z = 0.0;\n#else\n\tgl_Position.z = gl_Position.w;\n#endif');
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(50); // inside the PMREM cube camera's far plane
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT = null, envKey = '';

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
    edgeHaze(scene.frame);

    // ------------------------------------------------------------ terrain and imagery
    loadMsg('Draping aerial imagery on the terrain', 0.35);
    await idle();
    const texLoader = new THREE.TextureLoader();
    // the shoreline (shore.png): for the water, the seawalls the ground steps down at and the haze over the sea
    let shoreTex = null, shore = null, STEP = null;
    if (scene.shore) {
      shoreTex = await new Promise(res => texLoader.load(D.DATA + scene.shore.file, res, undefined, () => res(null)));
      if (shoreTex) { shoreTex.colorSpace = THREE.NoColorSpace; shoreTex.generateMipmaps = false; shoreTex.minFilter = THREE.LinearFilter; shoreTex.flipY = false; }
      try {
        shore = shoreTex && shoreField(shoreTex.image, scene.shore);
        STEP = shore && seawallStep(shore, T, scene.shore, small ? 2 : 4); // a lighter lattice on a smaller device
      } catch (e) { console.warn('seawalls: the shoreline could not be read', e); shore = STEP = null; }
    }
    // the haze over the sea where it runs on past the frame (edgeHaze): where the frame's edge is open
    // water, and the water and the ground under it that fade into it slowly
    RIM.fill(0);
    if (shore) seaRim(shore, scene.frame, scene.shore.cell);
    const seaEdged = (m, floor) => { if (shore) m.defines = Object.assign({}, m.defines, floor ? { OE_SEA_FLOOR: '' } : { OE_SEA_EDGE: '' }); };
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
      return { tex: { value: tex }, box: { value: new THREE.Vector4(x0 - res, y1 + res, w * res, h * res) } };
    })();
    const clipGround = sh => {
      if (!CLIP) return;
      Object.assign(sh.uniforms, { uClip: CLIP.tex, uClipBox: CLIP.box });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClipWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvClipWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uClip; uniform vec4 uClipBox; varying vec3 vClipWP;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { vec2 cuv = vec2((vClipWP.x - uClipBox.x) / uClipBox.z, 1.0 - (uClipBox.y + vClipWP.z) / uClipBox.w);
    if (vClipWP.y > -0.05 && all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0))) && texture2D(uClip, cuv).r > 0.5) discard; }`); // under the water the ground stays: the sea floor
    };
    // the ground's photo, graded (photoGrade), and a seawall's face (seawallStep: the steep faces of
    // its lattice) drawn as stone in courses with a dark wet foot instead of the photo stretched down
    // it, and lit by the face's own normal (the lattice's normals keep the quay and the water flat)
    const gradePhoto = sh => {
      clipGround(sh);
      sh.uniforms.uPhotoGrade = PG;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float seawall;\nvarying float vSeawall;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeawall = seawall;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${PHOTO_GRADE}\nvarying float vSeawall;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb = photoGrade(diffuseColor.rgb);
vec3 oeWallN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
float oeWall = smoothstep(0.5, 1.0, vSeawall) * (1.0 - smoothstep(0.6, 0.85, abs(dot(oeWallN, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)))));
if (oeWall > 0.0) {
  float wy = (transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz)).y, fw = fwidth(wy);
  float joint = (1.0 - smoothstep(0.02, 0.04 + fw, (0.5 - abs(fract(wy / 0.55) - 0.5)) * 0.55)) * (1.0 - smoothstep(0.05, 0.2, fw));
  vec3 stone = mix(vec3(0.25, 0.22, 0.18), diffuseColor.rgb * 0.7, 0.25) * (1.0 - 0.3 * joint);
  stone *= mix(0.4, 1.0, smoothstep(0.15, 0.9, wy)); // the foot the tide wets, dark with weed
  diffuseColor.rgb = mix(diffuseColor.rgb, stone, oeWall);
}`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (oeWall > 0.0) normal = normalize(mix(normal, oeWallN, oeWall));');
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
    function tileGeometry(t, Tg) {
      if (STEP && Tg === T) return steppedTile(t);
      const w = t.x1 - t.x0, h = t.y1 - t.y0;
      const g = new THREE.PlaneGeometry(w, h, Math.round(w / Tg.cell), Math.round(h / Tg.cell));
      g.rotateX(-Math.PI / 2);
      g.translate((t.x0 + t.x1) / 2, 0, -(t.y0 + t.y1) / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, S.terrainAt(Tg, p.getX(i), -p.getZ(i)));
      g.computeVertexNormals();
      g.setAttribute('seawall', new THREE.Float32BufferAttribute(new Float32Array(p.count), 1));
      return g;
    }
    // a tile on the terrain grid with its seawalls stepped (seawallStep): a cell the shoreline crosses on
    // the fine lattice; a coarse cell beside one as a fan from its centre through the points along their
    // shared side; the rest as the two triangles a plane geometry has (split south-west to north-east)
    function steppedTile(t) {
      const w = t.x1 - t.x0, h = t.y1 - t.y0, SUB = STEP.SUB, st = STEP.stepped;
      const c0 = Math.round((t.x0 - T.x0) / T.cell), c1 = Math.round((t.x1 - T.x0) / T.cell);
      const r0 = Math.round((T.y1 - t.y1) / T.cell), r1 = Math.round((T.y1 - t.y0) / T.cell);
      const pos = [], uv = [], wall = [], idx = [], ids = new Map();
      const vert = (I, J) => {
        const k = I * 1048576 + J;
        let v = ids.get(k);
        if (v === undefined) {
          const p = STEP.point(I, J);
          v = wall.length;
          ids.set(k, v);
          pos.push(p.x, p.h, -p.y); uv.push((p.x - t.x0) / w, (p.y - t.y0) / h); wall.push(p.free ? 1 : 0);
        }
        return v;
      };
      const quad = (nw, ne, sw, se) => idx.push(nw, sw, ne, sw, se, ne);
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
        const I = c * SUB, J = r * SUB;
        if (st(c, r)) {
          for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) quad(vert(I + i, J + j), vert(I + i + 1, J + j), vert(I + i, J + j + 1), vert(I + i + 1, J + j + 1));
          continue;
        }
        const n = st(c, r - 1), e = st(c + 1, r), s = st(c, r + 1), wst = st(c - 1, r);
        if (!(n || e || s || wst)) { quad(vert(I, J), vert(I + SUB, J), vert(I, J + SUB), vert(I + SUB, J + SUB)); continue; }
        // clockwise round the cell from its north-west corner; every fan triangle lies in one of the
        // cell's two triangles (the centre is on the diagonal), so the surface is the coarse one
        const ring = [];
        for (let i = 0; i < SUB; i += n ? 1 : SUB) ring.push(vert(I + i, J));
        for (let j = 0; j < SUB; j += e ? 1 : SUB) ring.push(vert(I + SUB, J + j));
        for (let i = SUB; i > 0; i -= s ? 1 : SUB) ring.push(vert(I + i, J + SUB));
        for (let j = SUB; j > 0; j -= wst ? 1 : SUB) ring.push(vert(I, J + j));
        const ctr = vert(I + SUB / 2, J + SUB / 2);
        for (let k = 0; k < ring.length; k++) idx.push(ctr, ring[(k + 1) % ring.length], ring[k]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('seawall', new THREE.Float32BufferAttribute(wall, 1));
      g.setIndex(idx);
      g.computeVertexNormals();
      // a stepped point's normal from the gentle faces round it only: the quay's edge and the water's
      // bottom stay flat, and the wall between is lit by its own face (gradePhoto)
      const nr = g.attributes.normal, acc = new Float32Array(wall.length * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), f = new THREE.Vector3();
      for (let k = 0; k < idx.length; k += 3) {
        const i0 = idx[k], i1 = idx[k + 1], i2 = idx[k + 2];
        if (!(wall[i0] || wall[i1] || wall[i2])) continue;
        a.set(pos[3 * i1] - pos[3 * i0], pos[3 * i1 + 1] - pos[3 * i0 + 1], pos[3 * i1 + 2] - pos[3 * i0 + 2]);
        b.set(pos[3 * i2] - pos[3 * i0], pos[3 * i2 + 1] - pos[3 * i0 + 1], pos[3 * i2 + 2] - pos[3 * i0 + 2]);
        f.crossVectors(a, b);
        if (f.y < 0.6 * f.length()) continue;
        for (const v of [i0, i1, i2]) if (wall[v]) { acc[3 * v] += f.x; acc[3 * v + 1] += f.y; acc[3 * v + 2] += f.z; }
      }
      for (let v = 0; v < wall.length; v++) {
        if (!wall[v]) continue;
        f.set(acc[3 * v], acc[3 * v + 1], acc[3 * v + 2]);
        if (f.lengthSq() < 1e-12) f.set(0, 1, 0);
        f.normalize();
        nr.setXYZ(v, f.x, f.y, f.z);
      }
      g.computeBoundingSphere();
      return g;
    }
    for (const t of scene.ground) {
      const g = tileGeometry(t, T);
      const tex = texLoader.load(D.DATA + t.file, tileLoaded, undefined, () => tileLoaded({ image: null }));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
      m.material.onBeforeCompile = gradePhoto;
      seaEdged(m.material, true);
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
          { small, software: OEWater.software(renderer), quality });
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
    const waterGeo = new THREE.PlaneGeometry(80000, 80000);
    waterGeo.rotateX(-Math.PI / 2);
    const water = sea ? sea.mesh : new THREE.Mesh(waterGeo, waterMat);
    water.receiveShadow = true;
    world.add(water);
    if (sea) for (const m of groundMeshes) m.material.onBeforeCompile = sh => { sea.patchGround(sh); gradePhoto(sh); };
    seaEdged(waterMat, false);
    if (sea) seaEdged(sea.material, false);
    // the colour of a distant sea (SEA): the haze over it with a little of the water's own hue (the fog
    // chunk dims it by how steeply the sea is seen)
    const seaHaze = new THREE.Color(), seaHue = unitLum(unitLum(lin((scene.water && scene.water.colour) || '#0f2b33')).lerp(new THREE.Color(1, 1, 1), 0.8)), grey = new THREE.Color();

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
    const foot = (x, y) => Math.min(S.terrainTri(T, x, y), D.Tfine ? S.terrainTri(D.Tfine, x, y) : Infinity, STEP ? STEP.below(x, y) : Infinity);
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
    piers.material.onBeforeCompile = streetLit;
    piers.castShadow = piers.receiveShadow = true;
    world.add(piers);
    // the game's boardwalks (game.json): 0.3 m timber decks at the pier deck height
    const walks = (D.G && D.G.boardwalks) || [];
    if (walks.length) {
      const top = Math.round((D.G.pier_deck_m || 2.2) * 10), timber = { wall: lin('#6f5a44'), roof: lin('#8a7258'), code: 3, windows: false };
      const deck = new THREE.Mesh(extrude(walks.map(r => [-1, top - 3, 0, 3, r]), () => timber), piers.material);
      deck.castShadow = deck.receiveShadow = true;
      world.add(deck);
    }

    // trees mapped in OSM: the shared Blender species (trees.js) in the city's mix, else
    // low-poly crowns on short trunks; heights are not mapped (7-14 m spread)
    const TR = P.trees || [], nT = TR.length / 4;
    let trees = null;
    if (nT && window.OETrees) {
      try { trees = OETrees.create(world, await OETrees.load('assets/trees/'), TR, { mix: (scene.trees || {}).mix, south: D.CITY.lat < 0 }); }
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
    const farObjs = [], farAt = (o, c, r, far) => { o.userData.far = { c, r2: (far + r) * (far + r) }; farObjs.push(o); };
    for (const m of LM.meshes || []) {
      const g = lmGeometry(m);
      const mesh = new THREE.Mesh(g, m.floodlit ? floodlit(m.material) : lmMats[m.material]);
      if (m.far) { g.computeBoundingSphere(); farAt(mesh, g.boundingSphere.center.clone(), g.boundingSphere.radius, m.far); }
      mesh.castShadow = mesh.receiveShadow = true;
      if (['railing', 'lattice'].includes((LM.materials[m.material] || {}).pattern)) mesh.castShadow = false; // a cut-out strip; its shadow would be solid
      if ((LM.materials[m.material] || {}).opacity < 1) mesh.castShadow = false;
      if ((LM.materials[m.material] || {}).decal) mesh.castShadow = false; // paving on the ground: nothing under it to shade
      mesh.name = m.name;
      world.add(mesh);
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
      world, sky, su, sunLight, shCam, hemi, pmrem, groundMeshes, gradePhoto, streetLit, tileGeometry, water, waterMat, sea, trees, buildings, bGeo, U, SRC, extrude, bColour, floodMats, lmMats, night,
      sunDir: new THREE.Vector3(0, 1, 0), day: 1,
      // light the scene for a sun position {altitude, azimuth} and, for lit windows, the local
      // clock time in minutes; returns the daylight factor 0..1
      setSun(sp, minutes) {
        const alt = sp.altitude * RAD, az = sp.azimuth * RAD;
        api.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
        su.sunPosition.value.copy(api.sunDir);
        const day = smooth(-5, 8, sp.altitude);
        api.day = day;
        sunLight.visible = sp.altitude > -0.5;
        sunLight.intensity = Math.PI * 2.4 * smooth(-0.5, 10, sp.altitude);
        sunLight.color.copy(warm).lerp(noonC, smooth(2, 30, sp.altitude));
        // the blue hour: the sun 0 to 8 degrees down, a blue sky and a blue light from it
        const tw = smooth(-11, -4, sp.altitude) * (1 - smooth(-2, 3, sp.altitude));
        su.twilight.value.copy(TWI_SKY).multiplyScalar(tw);
        // the golden hour, from the sun just under the horizon to about twelve degrees up (GOLDEN)
        su.uGolden.value = GOLD.z = smooth(-3, 1, sp.altitude) * (1 - smooth(6, 14, sp.altitude));
        const hz = Math.hypot(api.sunDir.x, api.sunDir.z) || 1;
        GOLD.x = api.sunDir.x / hz; GOLD.y = api.sunDir.z / hz;
        // a city's own night glow (neon, street light); with the street lights drawn (night.js), the
        // night's own light is the moon's and the sky's, and the lamps light the streets themselves
        const amb = ((D.scene.city && D.scene.city.night_ambient) || 0) * (night ? 0.25 : 1);
        hemi.intensity = Math.PI * ((night ? 0.02 : 0.07) + 0.25 * day + 0.1 * tw * (1 - day) + amb * (1 - day));
        hemi.color.set(day > 0.3 ? 0xc3d6e6 : 0x5d6f92);
        if (day <= 0.3) hemi.color.lerp(TWI_LIGHT, tw * 0.6);
        U.uNight.value = 1 - smooth(-7, 2, sp.altitude);
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
        // haze in it, so it has to be this hour's haze (it kept the last one, a day's haze at night)
        const key = `${Math.round(sp.altitude / 2)}|${Math.round(sp.azimuth / 6)}`, newSky = key !== envKey;
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
        const fl = 0.2126 * world.fog.color.r + 0.7152 * world.fog.color.g + 0.0722 * world.fog.color.b;
        seaHaze.copy(world.fog.color).lerp(grey.setScalar(fl), 0.35).multiply(seaHue); // a little greyer than the haze, so the two hues do not compound
        SEA.x = seaHaze.r; SEA.y = seaHaze.g; SEA.z = seaHaze.b;
        su.uHazeH.value = 0.05 + 0.2 * (1 - day); // at night a deeper glow, as far from the dark sky's colour as it is
        if (newSky) {
          envKey = key;
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
          const dates = LM.materials[k].emissive_dates;
          if (!dates) continue;
          const hit = dates.find(([a, b]) => { const [p, q] = [a, b].map(s => +s.replace('-', '')); return p <= q ? md >= p && md < q : md >= p || md < q; });
          m.emissive.copy(lin(hit ? hit[2] : LM.materials[k].emissive || '#ffe2b8'));
        }
      },
      // per frame, before the render: the waves (and their reflection) and the trees' wind and detail for this camera
      tick(t, camera) {
        SPARKLE.t.value = SCREEN.t.value = t * 0.001;
        if (camera) for (const o of farObjs) o.visible = camera.position.distanceToSquared(o.userData.far.c) < o.userData.far.r2;
        if (sea && camera) sea.update(t, camera, world); else waterMat.normalMap.offset.set(t * 0.000004, t * 0.0000025);
        if (trees && camera) trees.update(camera, t / 1000);
        if (night && camera) night.update(camera, t / 1000);
      },
      dispose() { if (envRT) envRT.dispose(); if (hazeRT) hazeRT.dispose(); pmrem.dispose(); if (sea) sea.dispose(); if (night) night.dispose(); },
    };
    return api;
  }

  return { load, create, lin, smooth };
})();
