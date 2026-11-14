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

  // The loader's lines (index.html #load-* and #g-load-*): what is being done, the bar, and the stage the
  // load is at, which the caller can name (a third argument) or which follows from how far along it is, so
  // that the page never sits on a finished download while the packs decode and the shaders compile.
  const STAGES = [[0.28, 'Downloading'], [0.995, 'Building the city'], [Infinity, 'Preparing the city']];
  function loadLine(prefix = '') {
    const msg = document.getElementById(prefix + 'load-msg'), bar = document.getElementById(prefix + 'load-bar'),
      stage = document.getElementById(prefix + 'load-stage');
    return (t, f, st) => {
      if (msg) msg.textContent = t;
      if (bar) bar.style.width = `${Math.round(f * 100)}%`;
      if (stage) stage.textContent = st || (f > 0 ? STAGES.find(([to]) => f < to)[1] : '');
    };
  }

  // the city's data files; game.json too when asked for
  // (small: the low tier's set, quality.js, whose landmark meshes flagged "detail" are never unpacked onto the page)
  async function load(cityId, { game = false, onMsg = () => {}, small = !!(window.OEQuality && OEQuality.city().small) } = {}) {
    const DATA = `data/${cityId}/`;
    // the download is most of the wait for a big city, so it is counted as it streams in, against
    // the size cities.json gives for the model or the game (raw bytes, as the streams deliver them)
    const entry = (window.OE_CITIES || []).find(c => c.id === cityId) || {};
    const want = (entry.load_bytes || {})[game ? 'game' : 'model'] || 0, mb = b => (b / 1e6).toFixed(1);
    // a district that shares a bigger map (index.html route: Sangenjaya, on Shibuya's): the loader says both
    const D = game && window.OE_DISTRICT, what = D ? `${D.name}, on the ${entry.name} map` : entry.name || 'the city';
    let got = 0, shown = 0;
    const report = () => {
      const now = performance.now();
      if (now - shown < 80) return;
      shown = now;
      onMsg(want ? `Downloading ${what}: ${mb(Math.min(got, want))} of ${mb(want)} MB` : `Downloading: ${mb(got)} MB`,
        0.02 + 0.26 * (want ? Math.min(1, got / want) : 0), 'Downloading');
    };
    // once every file is in, the packs are still decoding (in a Worker) and the JSON parsing: said so,
    // rather than leaving the label on a download that has finished
    let open = 0;
    // the load's stages for the telemetry (telemetry.js markOf): every file in, then every file decoded
    const view = { view: game ? 'game' : 'city', city: cityId };
    const mark = s => { try { performance.mark(`oe:${s}`, { detail: view }); } catch (e) { /* no User Timing */ } };
    const unpack = () => { if (--open === 0) mark('fetched'); if (open === 0) onMsg(`Unpacking ${what}: buildings, terrain and landmarks`, 0.29, 'Unpacking the city'); };
    const fetchAll = async (r, u) => {
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      if (!r.body || !r.body.getReader) return new Blob([await r.arrayBuffer()]);
      const reader = r.body.getReader(), parts = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; report();
      }
      return new Blob(parts);
    };
    const fetchFile = async u => { open++; try { return await fetchAll(await fetch(DATA + u), u); } finally { unpack(); } };
    const getJSON = async u => JSON.parse(await (await fetchFile(u)).text());
    // the buildings, landmarks, game, terrain, places and scene as packed by pipeline/pack.py (a quarter to a
    // third of the JSON's download, issues 148, 201 and 259) and decoded in a Worker (pack-worker.js), so that the loader's bar
    // keeps moving; as JSON where a city has no pack yet or the browser cannot inflate one
    // (the worker keeps its copy of the buildings, to build their walls from later: buildings.js start; and in the
    // game its copy of the landmarks, to lay them on the walking model's grid: game/navcells.js)
    const getPacked = async (name, keep = name === 'buildings') => {
      if (window.OEPack && OEPack.supported() && (entry.packed || []).includes(name)) {
        try {
          const buf = await (await fetchFile(name + '.bin')).arrayBuffer();
          const lean = small && name === 'landmarks';
          if (OEPack.decodeIn) return await OEPack.decodeIn(buf, keep ? name : null, lean);
          const o = await OEPack.decode(buf);
          return lean && OEPack.dropDetail ? OEPack.dropDetail(o) : o;
        } catch (e) { console.warn(`${name}.bin:`, e); }
      }
      return getJSON(name + '.json');
    };
    onMsg(want ? `Downloading ${what}: 0 of ${mb(want)} MB` : 'Downloading footprints, terrain and landmarks', 0.02, 'Downloading');
    // the terrain grid: int16 heights, as bytes from its pack or as base64 text from its JSON
    const grid = t => { const u = typeof t.data === 'string' ? Uint8Array.from(atob(t.data), c => c.charCodeAt(0)) : t.data;
      return u.byteOffset % 2 ? u.slice().buffer : u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
    const [scene, B, P, LM, terrBuf, UNC, G, N] = await Promise.all([getPacked('scene'), getPacked('buildings'), getPacked('places'),
      getPacked('landmarks', game), getPacked('terrain').then(grid),
      getJSON('uncertainty.json').catch(() => null), game ? getPacked('game') : Promise.resolve(null),
      window.OENight ? getJSON('night.json').catch(() => null) : Promise.resolve(null)]);
    mark('decoded');
    const CITY = scene.city;
    // the map's name as the globe's list gives it (cities/index.json), and the city it is a district of:
    // Higashiyama is a district of Kyoto, Shibuya one of Tokyo, never cities of their own
    if (entry.name) CITY.name = entry.name;
    const gm = entry.group_meta, inCity = gm && ['city', 'metro'].includes(gm.kind) && entry.group !== CITY.name;
    CITY.city = inCity ? entry.group : null;
    CITY.place = inCity ? `${CITY.name}, ${entry.group}` : CITY.name;
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
    return { id: cityId, DATA, scene, B, P, LM, UNC, G, N, CITY, T, T0: T, ground: (x, y) => Math.max(0, S.terrainAt(T, x, y)) };
  }

  // surface patterns for parametric landmark materials (landmarks.json "pattern"), drawn
  // from the meshes' texture coordinates in metres; each fades to its average colour where
  // a pixel covers more than a few repeats, so it never shimmers at a distance
  const LM_NIGHT = { value: 0 }; // how dark it is, for landmark patterns with lit windows
  // the Eiffel Tower's sparkle: five minutes at the start of every hour after dark (setSun turns it on)
  const SPARKLE = { on: { value: 0 }, t: { value: 0 } };
  // A floodlit material lit from below (landmarks.json "flood": [from_m, to_m, roof, top, cone_m]), as a
  // castle or a tower is lit by floodlights at its foot and on its lower roofs: a wall takes the
  // light full and the underside of an eave a little more, a roof facing up catches its share at a
  // graze ("roof", 0.5), and the light falls off up the building from from_m to to_m (the local
  // frame's heights) to "top" (0.6) of what it is at the foot. With "cone_m" the lights stand every
  // cone_m metres along the wall's foot, and each throws a cone up it: bright over the fitting,
  // widening and evening out as it rises, the scallops a floodlit facade shows in photographs at night.
  // Without "flood" a floodlit material glows evenly, as a sign or a screen does. prev: the
  // material's own pattern, if any.
  function floodFrom(spec, prev) {
    if (!spec) return prev;
    const [z0, z1, roof = 0.5, top = 0.6, cone = 0] = spec;
    return sh => {
      if (prev) prev(sh);
      sh.uniforms.uFlood = { value: new THREE.Vector4(z0, z1, roof, top) };
      sh.uniforms.uFloodCone = { value: cone };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloodP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vFloodP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uFlood; uniform float uFloodCone; varying vec3 vFloodP;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 wn = inverseTransformDirection(normal, viewMatrix);
    float face = wn.y < 0.0 ? 1.0 - 0.3 * wn.y : mix(1.0, uFlood.z, wn.y);
    // the light comes back off the surface, so its pattern (courses, joints, tiles) shows in it
    float tex = clamp(dot(diffuseColor.rgb, vec3(1.0)) / max(dot(diffuse, vec3(1.0)), 1e-3), 0.0, 1.5);
    float hgt = vFloodP.y - uFlood.x;
    float lit = face * tex * mix(1.0, uFlood.w, clamp(hgt / max(uFlood.y - uFlood.x, 1.0), 0.0, 1.0));
    if (uFloodCone > 0.0) {
      vec2 tn = normalize(vec2(-wn.z, wn.x) + 1e-5);
      float u = dot(vFloodP.xz, tn) / uFloodCone, du = (fract(u + 0.5) - 0.5) * uFloodCone, h = max(hgt, 0.0);
      float w = 0.45 + 0.3 * h, c = exp(-du * du / (w * w));
      float k = mix(0.55 + 0.75 * c + 0.35 * c * exp(-h / 1.5), 1.0, smoothstep(6.0, 22.0, h));
      lit *= mix(1.0, k, 1.0 - abs(wn.y));
    }
    totalEmissiveRadiance *= lit; }`);
    };
  }
  const PATTERNS = {
    // the Opera House roof tiles: chevron lids between the ribs, glossy white tiles inside a
    // lid and matte cream along its joints (u counts rib bays, v is metres along a rib)
    chevron_tiles(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uLid: { value: m.lid_m || 2.6 }, uChev: { value: m.chevron_m || 1.8 },
          uGloss: { value: lin('#f6f2e8') }, uCream: { value: lin('#dfd0b4') } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLid, uChev; uniform vec3 uGloss, uCream; float pCream;')
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float bay = fract(vUv.x) - 0.5, c = vUv.y - abs(bay) * uChev, lid = fract(c / uLid);
    float edge = min(lid, 1.0 - lid) * uLid, fw = fwidth(c);
    float cream = max(1.0 - smoothstep(0.07, 0.16, edge), 1.0 - smoothstep(0.02, 0.06, (0.5 - abs(bay)) * uChev));
    float grout = 1.0 - smoothstep(0.0, 0.02 + fw, edge);
    float near = 1.0 - smoothstep(0.08, 0.5, fw);
    // further off the lids still read, as in photographs from across the water: each lid a shade creamer towards its
    // edges and the ribs' lines between the bays, until a lid is a pixel or two
    float soft = pow(1.0 - edge / (0.5 * uLid), 3.0), rib = pow(abs(bay) * 2.0, 8.0);
    float mid = 1.0 - smoothstep(0.5, 1.5, max(fw, fwidth(vUv.x) * 4.0));
    pCream = mix(mix(0.18, 0.1 + 0.55 * max(soft, rib), mid), cream, near);
    diffuseColor.rgb = mix(uGloss, uCream, pCream) * (1.0 - 0.06 * grout * near); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.3, 0.6, pCream);');
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
    // a spandrel at the foot of each storey_m (spandrel: its share of the storey, or its colour with spandrel_frac
    // its share), pane tones that vary, and some panes lit after dark, rooms behind them close to
    // (lit_share of them, lit_k bright: a shop's glass is mostly lit and softer than an office's;
    // warm_share of the lit ones under warm light, the rest cool white)
    curtain_wall(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        // (spandrel: the band's share of a storey, or its colour, with spandrel_frac its share: the Skyline's gave a
        // colour and its glass lost its bands and its depth, #286)
        const spanK = typeof m.spandrel === 'number' ? m.spandrel : (m.spandrel_frac ?? 0.25);
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 1.5 }, uSty: { value: m.storey_m || 4.0 }, uSpan: { value: spanK },
          uMull: { value: m.mullion_m || 0.12 }, uFrame: { value: lin(m.frame || '#c9ced2') }, uSpanC: { value: lin(typeof m.spandrel === 'string' ? m.spandrel : (m.frame || '#c9ced2')) }, uLmNight: LM_NIGHT,
          uLitShare: { value: m.lit_share ?? 0.38 }, uLitK: { value: m.lit_k ?? 1.3 }, uWarm: { value: m.warm_share ?? 0.25 } });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uBay, uSty, uSpan, uMull, uLmNight, uLitShare, uLitK, uWarm; uniform vec3 uFrame, uSpanC; float pWin, pLit, pRoom; vec3 pLitC;
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
    diffuseColor.rgb = mix(mix(glass, mix(uFrame, uSpanC, step(mull, span * 0.9)), solid), farCol, far);
    // the room behind a lit pane, close to: brighter towards the ceiling, a row of downlights under it one to a bay,
    // and the chairs, tables and people dark against the light in its lower third (each bay its own), so the glass
    // reads as rooms with depth rather than as lit panels; far off, the storey's mean
    { float fx = fract(bu), fy = (fract(bv) - uSpan) / max(1.0 - uSpan, 0.05), hR = uSty * (1.0 - uSpan);
      float grad = 0.3 + 0.55 * smoothstep(0.05, 1.0, fy);
      float lamp = exp(-pow((fx - 0.5) / 0.09, 2.0)) * exp(-pow((fy - 0.94) * hR / 0.06, 2.0)) * 1.4 + exp(-pow((fy - 0.97) / 0.035, 2.0)) * 0.2;
      // people standing or seated in thirds of a bay, a table's top in some: dark against the room
      float j = floor(fx * 3.0), h = cwHash(cell * 1.31 + j), mx = (fract(fx * 3.0) - 0.5) * uBay / 3.0;
      float tall = h < 0.22 ? 1.62 : 1.18, my = fy * hR;
      float body = step(abs(mx), 0.17 - 0.04 * smoothstep(tall - 0.6, tall - 0.3, my)) * step(my, tall - 0.22);
      float head = step(length(vec2(mx, my - tall + 0.12)), 0.11);
      float person = step(h, 0.42) * max(body, head), table = step(0.55, cwHash(cell + 9.0)) * step(abs(my - 0.74), 0.025);
      float room = (grad + lamp) * (1.0 - 0.8 * max(person, table)) * (0.7 + 0.45 * cwHash(cell + 21.0));
      pRoom = mix(room, 0.6, smoothstep(0.05, 0.3, fw)); }
    float litFar = mix(0.6 * step(1.0 - 0.68 * uLitShare, cwHash(cf + 17.0)) * (1.0 - sf), 0.34 * uLitShare, vfar);
    // lit in runs of four panes along a storey, as an office is, each run a little brighter or dimmer,
    // mostly under cool white light
    pWin = mix(1.0 - solid, 0.6, far); pLit = mix(step(1.0 - uLitShare, cwHash(cf + 17.0)) * (0.85 + 0.3 * cwHash(cf + 3.0)), litFar, far);
    pLitC = mix(cwHash(cf + 5.0) < 1.0 - uWarm ? vec3(0.8, 0.9, 1.0) : vec3(1.0, 0.84, 0.62), vec3(0.85, 0.88, 0.9), far); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.45, roughnessFactor, pWin);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += pWin * pLit * uLmNight * pLitC * uLitK * pRoom;`);
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
    pLitK = (1.0 - pFrame) * mix(0.5 + 0.5 * tgHash(cell + 3.1), 0.75, far);
    diffuseColor.a = mix(diffuseColor.a, 1.0, pFrame); }`) // (see-through glass, "opacity": its frames are not)
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
  // boxes: landings past the frame (outposts.js: {x0, x1, y0, y1, band}), clear inside like the frame,
  // hazing over their band to the far land's air at their edge
  function edgeHaze(frame, near = 150, farLand = false, boxes = []) {
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
    const out0 = (p, a = 0, b = fade) => `smoothstep( ${n(a)}, ${n(b)}, length( max( abs( ${p} - vec2( ${n((frame.x[0] + frame.x[1]) / 2)}, ${n(-(frame.y[0] + frame.y[1]) / 2)} ) ) - vec2( ${n(w / 2 - fade)}, ${n(h / 2 - fade)} ), 0.0 ) ) )`;
    const outBox = (o, p, a, b) => { const f = o.band || 60, k = f / fade; return `smoothstep( ${n(a * k)}, ${n(b * k)}, length( max( abs( ${p} - vec2( ${n((o.x0 + o.x1) / 2)}, ${n(-(o.y0 + o.y1) / 2)} ) ) - vec2( ${n((o.x1 - o.x0) / 2 - f)}, ${n((o.y1 - o.y0) / 2 - f)} ), 0.0 ) ) )`; };
    const out = (p, a = 0, b = fade) => boxes.reduce((e, o) => `min( ${e}, ${outBox(o, p, a, b)} )`, out0(p, a, b));
    // how far past the frame a point is, or past the nearest landing's box, whichever is nearer
    const pastBoxes = p => boxes.map(o => ` oePast = min( oePast, length( max( abs( ${p} - vec2( ${n((o.x0 + o.x1) / 2)}, ${n(-(o.y0 + o.y1) / 2)} ) ) - vec2( ${n((o.x1 - o.x0) / 2)}, ${n((o.y1 - o.y0) / 2)} ), 0.0 ) ) );`).join('');
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
	{ vec2 oeP = vEdgeXZ - ${c}, oeH = vec2( ${n(hx)}, ${n(hz)} ); float oePast = length( max( abs( oeP ) - oeH, 0.0 ) );${pastBoxes('vEdgeXZ')}
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
	{ float oePast = length( max( abs( vEdgeXZ - ${c} ) - vec2( ${n(w / 2)}, ${n(h / 2)} ), 0.0 ) );${pastBoxes('vEdgeXZ')}
	  // and the air near the ground is thicker (a haze layer about a kilometre deep): from a tower the
	  // line of sight stays in it and a far city pales into haze within ten kilometres, while from
	  // high up the path through it is short and the same land stays clear
	  float oeHc = max( cameraPosition.y, 1.0 ), oeLow = ${n(FAR_LAYER)} * ( 1.0 - exp( -oeHc / ${n(FAR_LAYER)} ) ) / oeHc;
	  float oeAir = 1.0 - exp( -vFogDepth * max( 1.0 / ${n(FAR_AIR)}, oeLow / ${n(FAR_AIR_LOW)} ) );
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
	// the far land takes its own air, not the view's fog (which is whole by 26 km and laid a band of
	// one tone over the plain from a tower); it closes to the haze only toward its outer edge
	fogFactor = max( oeFar, smoothstep( ${n(FAR_HALF * 0.6)}, ${n(FAR_HALF * 0.97)}, length( vEdgeXZ - ${c} ) ) );
	// (in fog, falling snow or heavy rain the view's own fog has come in to a few kilometres or less, game/weather.js:
	// the far land goes into it as everything else does, and is not left standing as a dark shore beyond the mist)
	fogFactor = max( fogFactor, smoothstep( fogNear, fogFar, vFogDepth ) * ( 1.0 - smoothstep( 6000.0, 20000.0, fogFar ) ) );
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
    FAR_EDGE = (window.OEFarLand || {}).EDGE || 0.2, FAR_LAYER = 1000;
  let FAR_HALF = (window.OEFarLand || {}).HALF || 40000; // the far land's half width (far.json half_m where it gives one)
  // the air's 63% distance, and in the ground haze's layer (m); a city's clear air stretches both (far.json clarity)
  let FAR_AIR = (window.OEFarLand || {}).AIR || 30000, FAR_AIR_LOW = 15000;

  // Aerial photos are taken through a kilometre of air: their darkest tones are lifted by haze
  // and their colours are thin, which on the ground and the flat roofs reads as a grey wash.
  // photoGrade takes the haze back out (a black level, in linear light), deepens the mid-tones
  // a little and restores the colour, by amounts measured from the city's own tiles (photoStats).
  const PHOTO_GRADE = `uniform vec4 uPhotoGrade;
vec3 photoGrade(vec3 c) {
  c = pow(max(c - uPhotoGrade.x, 0.0) / (1.0 - uPhotoGrade.x), vec3(uPhotoGrade.y));
  return max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uPhotoGrade.z), 0.0);
}`;
  // Steep ground: the aerial photograph is taken from straight above, so on a face steeper than about
  // 45 degrees each of its pixels is drawn over 1.4 to 4 metres of slope, smeared down the fall line
  // into grey-white streaks (the schist under the Skyline deck on Bob's Peak, issue 265). There the
  // photograph gives way to rock: its own tone, blurred to some 30 m so its streaks go, with a detail
  // projected along the face's three axes (triplanar, so nothing stretches) and a foliation's bands.
  // oeSteep (0 flat, 1 a cliff) is left for the game's ground to keep its pavers off the faces.
  const STEEP_ROCK = `varying vec3 vRockWP, vRockWN;
float rockH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rockN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rockH(i), rockH(i + vec2(1, 0)), f.x), mix(rockH(i + vec2(0, 1)), rockH(i + vec2(1, 1)), f.x), f.y); }
float rockFace(vec2 p, float fine) { return rockN(p * 0.21) * 0.42 + rockN(p * 0.83 + 5.3) * 0.3 + (rockN(p * 3.1 + 1.7) * 0.18 + rockN(p * 11.0) * 0.1) * fine; }
float steepness() { return smoothstep(0.72, 0.5, normalize(vRockWN).y); }
vec3 steepRock(vec3 c, float k) {
  if (k < 0.003) return c;
  vec3 n = normalize(vRockWN), w = pow(abs(n), vec3(4.0));
  w /= dot(w, vec3(1.0));
  float d = distance(vRockWP, cameraPosition), fine = 1.0 - smoothstep(60.0, 260.0, d);
  float r = rockFace(vRockWP.zy, fine) * w.x + rockFace(vRockWP.xz, fine) * w.y + rockFace(vRockWP.xy, fine) * w.z;
  // the schist's foliation: bands along the height, warped, finer near
  float band = rockN(vec2(vRockWP.y * 0.9 + rockN(vRockWP.xz * 0.05) * 7.0, 0.5));
  // the photograph's tone over some 30 m (its mip there), kept to the albedo weathered schist has
#ifdef USE_MAP
  vec2 oeT = vec2(textureSize(map, 0));
  float mpp = length(fwidth(vRockWP.xz)) / max(length(fwidth(vMapUv * oeT)), 1e-5);
  vec3 base = textureLod(map, vMapUv, clamp(log2(30.0 / max(mpp, 1e-3)), 0.0, 9.0)).rgb;
  base = photoGrade(base);
#else
  vec3 base = c;
#endif
  float L = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = mix(vec3(1.0), base / max(L, 1e-3), 0.35);
  vec3 rock = vec3(0.92, 0.9, 0.84) * tint * clamp(L, 0.07, 0.2);
  rock *= (0.62 + 0.62 * r) * mix(0.82, 1.08, band);
  // lichen and the grass the ledges hold, where the face eases
  float ledge = smoothstep(0.55, 0.75, rockN(vRockWP.xz * 0.6 + vRockWP.y * 0.3)) * (1.0 - smoothstep(0.35, 0.75, k));
  rock = mix(rock, c, ledge * 0.6);
  return mix(c, rock, k);
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

  // The aerial ground pictures (issue 335): AVIF where the browser decodes it (Chrome 85, Firefox 93, Safari
  // 16.4), else the JPEG; the tiles within near metres of at first, in order of distance, and the rest once
  // release() is called; the whole frame's overview (scene.json ground_lo, 6 m a pixel) at once. Each picture
  // is a promise of a decoded <img>, or null if it failed. buildings.js draws the roofs' photo from the same ones.
  let avifOK = null;
  function avif() {
    return avifOK || (avifOK = new Promise(res => {
      const im = new Image();
      im.onload = () => res(im.width === 1);
      im.onerror = () => res(false);
      im.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAHgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAJm1kYXQSAAoIGAAGiAhoNCAyEBlHh4Yhh5555oAAAJBAzeg='; // a 1 x 1 AVIF
    }));
  }
  function groundPictures(scene, dir, { at = null, near = 1000 } = {}) {
    const tiles = scene.ground || [];
    const load = t => avif().then(ok => new Promise(res => {
      const im = new Image(), tryJpeg = () => { if (im.src.endsWith(t.file)) return res(null); im.src = dir + t.file; };
      im.decoding = 'async';
      im.onload = () => (im.decode ? im.decode() : Promise.resolve()).then(() => res(im), () => res(im));
      im.onerror = tryJpeg;
      im.src = dir + (ok && t.avif ? t.avif : t.file);
    }));
    const dist = t => at ? Math.hypot(Math.max(t.x0 - at[0], 0, at[0] - t.x1), Math.max(t.y0 - at[1], 0, at[1] - t.y1)) : 0;
    const first = tiles.map(t => !at || !scene.ground_lo || dist(t) <= near);
    let release;
    const later = new Promise(r => { release = r; });
    const order = tiles.map((t, i) => i).sort((a, b) => dist(tiles[a]) - dist(tiles[b]));
    const out = new Array(tiles.length);
    for (const i of order) out[i] = first[i] ? load(tiles[i]) : later.then(() => load(tiles[i]));
    return { tiles: out, first, overview: scene.ground_lo ? load(scene.ground_lo) : null, release, all: () => Promise.all(out) };
  }

  // small: the lighter set for a weaker device (quality.js); shadow: the sun's shadow map size;
  // game: the game's world, whose own cars take over from the night's traffic within nearCars metres of the camera
  // groundAt: where the visit starts ([x, y]): the ground tiles within groundNear metres of it load first, the
  // others when the caller calls api.groundPictures.release() (the game, once it opens); without it, all at once
  // the height sources, as the buildings' shader codes them: 0 measured, 1 from floors, 2 estimated, 3 parametric
  const BUILDING_SRC = { mapped: 0, survey: 0, reference: 0, verified: 0, plateau: 0, plateau_lod1: 0, lidar: 0, bdtopo: 0, '3dbag': 0, floors: 1, ml: 2, estimate: 2, typical: 2, parametric: 3 };
  async function create(D, renderer, { onMsg = () => {}, small = Math.min(innerWidth, innerHeight) < 700, shadow = 0, game = false, nearCars = 0, groundAt = null, groundNear = 1000 } = {}) {
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
    // the tier's largest texture (quality.js tex: 2048 on the low tier): three.js scales a picture over it down as it
    // uploads it, and what is drawn here for the GPU (the roofs' photo, the water's cover) is drawn no larger
    const QW = window.OEQuality ? OEQuality.city() : null, LEAN = !!(QW && QW.lean);
    if (QW && QW.tex < renderer.capabilities.maxTextureSize) renderer.capabilities.maxTextureSize = QW.tex;
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
    // the cloud layers, the Milky Way and shooting stars in place of the Sky's own cloud layer (clouds.js): off until
    // the game turns them on (atmosphere.js); the viewer keeps a clear sky
    const cloudsOn = !!(window.OEClouds && OEClouds.patch(sky.material));
    // the sky sits on the far plane, which a reversed depth buffer (the game's) puts at 0, not 1
    sky.material.vertexShader = sky.material.vertexShader
      .replace('gl_Position.z = gl_Position.w;', '#ifdef USE_REVERSED_DEPTH_BUFFER\n\tgl_Position.z = 0.0;\n#else\n\tgl_Position.z = gl_Position.w;\n#endif');
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(50); // inside the PMREM cube camera's far plane
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    // its programs (the background box, the GGX filter, the blur) compiled now, off the frame, rather than by the first
    // light from the sky in the middle of the game's set-up (issue 299: 1.5 s there on a software renderer). They are
    // three.js r186's PMREMGenerator's own parts, so only where they are as there; else the first sky compiles them
    try {
      if (pmrem._setSize && pmrem._allocateTargets && renderer.capabilities.isWebGL2) {
        pmrem._setSize(256); // (fromScene's size)
        pmrem._allocateTargets().dispose();
        const g = new THREE.Group(), lod = pmrem._lodMeshes && pmrem._lodMeshes[0];
        if (lod) for (const m of [pmrem._ggxMaterial, pmrem._blurMaterial]) if (m) g.add(new THREE.Mesh(lod.geometry, m));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false })));
        if (pmrem._pingPongRenderTarget) compile(renderer, g, new THREE.PerspectiveCamera(90, 1, 0.1, 100), { target: pmrem._pingPongRenderTarget, shadows: false });
      }
    } catch (e) { /* compiled by the first sky instead */ }
    let envRT = null, envKey = '', envAt = -1e9, envWait = null;

    const sunLight = new THREE.DirectionalLight(0xffffff, 2 * Math.PI); // intensities are physical since r155: π × the old values
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(SHADOW, SHADOW);
    // the depth bias moves what is lit towards the light, by bias × (far − near) metres: 2.7 m here. three.js's PCF
    // lookup adds it to the depth as it is, so with a reversed depth buffer (the game's, where the light's depth runs
    // from 1 at its near plane to 0 at its far one) the same number moves it 2.7 m away from the light instead: every
    // surface then shadowed itself, in bands of light and dark wherever the sun was low over a flat roof (SHIBUYA
    // SKY's deck in the morning). There a small bias the right way, 0.18 m, and the normal bias does the rest.
    const depthR = renderer.state && renderer.state.buffers && renderer.state.buffers.depth;
    sunLight.shadow.bias = depthR && depthR.getReversed && depthR.getReversed() ? 0.00002 : -0.0003;
    sunLight.shadow.normalBias = 1.0;
    const shCam = sunLight.shadow.camera;
    shCam.near = 10; shCam.far = 9000;
    leanShadowMap(renderer, sunLight.shadow, SHADOW);
    const shadowStill = new URLSearchParams(location.search).get('shadowcache') === 'off' ? null : shadowCache(renderer, sunLight);
    const still = o => { if (shadowStill && o) shadowStill.mark(o); return o; };
    // what the camera cannot see is hidden from the view (visibility.js), but the sun's shadow needs every
    // caster: they are shown again round the shadow pass (outside the cache, which reads what is shown)
    if (window.OEVis && !renderer.shadowMap.__vis) {
      const SM = renderer.shadowMap, inner = SM.render;
      SM.__vis = true;
      SM.render = function (lights, sc, cam) { OEVis.shadow(true); try { return inner.call(this, lights, sc, cam); } finally { OEVis.shadow(false); } };
    }
    world.add(sunLight, sunLight.target);
    const hemi = new THREE.HemisphereLight(0xc3d6e6, 0x4d463a, 0.25 * Math.PI);
    world.add(hemi);
    const TWI_SKY = new THREE.Color(0.03, 0.075, 0.24), TWI_LIGHT = new THREE.Color(0x4a72c8), TWI_FOG = new THREE.Color(0x23385e);   // the blue hour (setSun)
    world.fog = new THREE.Fog(0xc6d3dc, 6000, 26000);
    // whether there is land past the frame to draw (farland.js), before the haze is written
    const farMeta = window.OEFarLand && new URLSearchParams(location.search).get('far') !== 'off'
      ? await fetch(D.DATA + 'far.json').then(r => (r.ok ? r.json() : null), () => null) : null;
    const farOn = !!farMeta;
    // clarity: how much clearer than the default the city's air is (Queenstown's alpine air): every haze
    // distance stretches by it, so the mountains across the lake stand out as they do in a photograph
    const clarity = (farMeta && farMeta.clarity) || 1;
    world.userData.clarity = clarity;
    world.userData.farHalf = (farMeta && farMeta.half_m) || 0; // (how far the land past the frame reaches: a camera's far plane must take it in)
    FAR_AIR = ((window.OEFarLand || {}).AIR || 30000) * clarity; FAR_AIR_LOW = 15000 * clarity;
    if (farMeta && farMeta.half_m) FAR_HALF = farMeta.half_m;
    world.fog.near *= clarity; world.fog.far *= clarity;
    // landings past the frame (outposts.js): the far land leaves them open and the haze treats them as the frame
    const outHoles = window.OEOutposts && D.G ? OEOutposts.list(D.G).map(o => ({ x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1, band: o.band })) : [];
    const edgeFade = edgeHaze(scene.frame, 150, farOn, outHoles);

    // ------------------------------------------------------------ terrain and imagery
    loadMsg('Draping aerial imagery on the terrain', 0.35);
    await idle();
    const texLoader = new THREE.TextureLoader();
    const groundMeshes = [];
    const PG = { value: new THREE.Vector4(0, 1, 1, 0) }, stats = photoStats();
    // the aerial pictures (groundPictures): the tiles near the start now, the rest when the game says
    // (pics.release), the whole frame's overview on a tile until its own arrives
    const pics = groundPictures(scene, D.DATA, { at: groundAt, near: groundNear });
    // the photo's grade from every tile, or at once from the overview where there is one (the same
    // pictures at a sixteenth of the pixels), so that it doesn't change when the far tiles come in
    let tilesLeft = pics.overview ? 1 : scene.ground.length;
    const tileLoaded = img => {
      stats.add(img);
      if (--tilesLeft > 0) return;
      const gr = stats.grade();
      if (gr) PG.value.set(gr[0], gr[1], gr[2], 1);
    };
    if (pics.overview) pics.overview.then(tileLoaded);
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
      // (kept as one channel, a byte a texel, rows bottom up as the canvas texture's were, and as a bit a texel for near():
      // the canvas's four bytes a texel, on the page and on the GPU, were 45 MB each in Tokyo, issue 406)
      const rgba = g.getImageData(0, 0, w, h).data, one = new Uint8Array(w * h), bits = new Uint8Array((w * h + 7) >> 3);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const v = rgba[4 * (r * w + c)];
        one[(h - 1 - r) * w + c] = v;
        if (v > 127) bits[(r * w + c) >> 3] |= 1 << ((r * w + c) & 7);
      }
      cv.width = cv.height = 1;
      const tex = new THREE.DataTexture(one, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.unpackAlignment = 1; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      // within a clip region, or a metre and a half from one (a landmark's own seawall runs along its edge)
      const near = (x, y) => {
        const c = Math.round((x - x0) / res + 1), r = Math.round((y1 - y) / res + 1);
        for (let dr = -3; dr <= 3; dr += 3) for (let dc = -3; dc <= 3; dc += 3) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < h && cc < w && (bits[(rr * w + cc) >> 3] >> ((rr * w + cc) & 7)) & 1) return true;
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
    // inland water at its own level (inland.js, scene.json "inland"): the terrain levelled to the channels' banks
    // and lowered under the ponds, in place, before anything stands on it
    let IN = null;
    if (window.OEInland && new URLSearchParams(location.search).get('inland') !== 'off') try { // ?inland=off: without, to compare
      IN = OEInland.create(scene);
      if (IN) for (const g of new Set([D.T0, D.T, D.Tfine].filter(Boolean))) IN.raise(g);
    } catch (e) { console.warn('inland water: none drawn', e); IN = null; }
    D.inland = IN;
    // the ground is final from here: the walls, roofs and decks start building in the worker that decoded them
    // (buildings.js start, issue 344), while the aerial imagery is draped and the landmarks are made here
    // On a phone's game (quality.js lean, budget.map) the map is built round the player: the buildings by cells of a
    // grid, whole near the start, in one lift further off and the skyline alone past that, and again as the player
    // moves (api.mapAt; buildings-geo.js cells; issue 443)
    const MAP = game && LEAN && small && QW.budget && QW.budget.map && new URLSearchParams(location.search).get('map') !== 'whole'
      ? Object.assign({ at: (groundAt || [(scene.frame.x[0] + scene.frame.x[1]) / 2, (scene.frame.y[0] + scene.frame.y[1]) / 2]).slice(0, 2) }, QW.budget.map) : null;
    const bldJob = window.OEBuildings && OEBuildings.start ? OEBuildings.start(D, { lin, SRC: BUILDING_SRC, small, cells: MAP,
      dsm: game ? { T: D.Tfine || D.T, frame: { cell: 2, x0: scene.frame.x[0], x1: scene.frame.x[1], y0: scene.frame.y[0], y1: scene.frame.y[1] } } : null }) : null;
    // and, in the game, the landmarks laid on the walking model's grid there next (game/navcells.js; nav.js takes them)
    if (game && window.OENavCells && window.OEPack && OEPack.rasterIn && D.G) {
      const grid = OENavCells.grid(scene.frame), t0 = performance.now();
      D.navJob = OEPack.rasterIn('landmarks', { strips: OENavCells.strips(D.G), grid }).then(r => {
        console.info(`nav cells: ${Math.round(r.ms)} ms in a worker, back after ${Math.round(performance.now() - t0)} ms`);
        return Object.assign(r, { grid: `${grid.nx}x${grid.ny}` });
      }, e => { console.warn('nav cells: laid on the page,', e.message || e); return null; });
    }
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
    const QUAY = Q && { mask: { value: Q.maskTexture() }, dist: { value: shoreTex }, box: { value: new THREE.Vector4(...Q.box) },
      bed: { value: lin(((scene.water || {}).seawall || {}).bed || '#3a3b33') } }; // (the bottom's colour, as quayBed's)
    const HOLE = IN && IN.holeMask();
    const clipGround = sh => {
      if (HOLE) { // over a walled channel the ground is cut away: its walls and bed are drawn instead (inland.js)
        Object.assign(sh.uniforms, { uHole: { value: HOLE.tex }, uHoleBox: { value: new THREE.Vector4(...HOLE.box) } });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoleWP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvHoleWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uHole; uniform vec4 uHoleBox; varying vec3 vHoleWP;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { vec2 huv = vec2((vHoleWP.x - uHoleBox.x) / uHoleBox.z, (uHoleBox.y + vHoleWP.z) / uHoleBox.w);
    if (all(greaterThan(huv, vec2(0.0))) && all(lessThan(huv, vec2(1.0))) && texture2D(uHole, huv).r > 0.502) discard; }`); // (inland.js: 128 at the hole's edge)
      }
      if (QUAY) { // out in front of a quay, above the water: the grid's ramp up to the land
        Object.assign(sh.uniforms, { uQuayMask: QUAY.mask, uQuayDist: QUAY.dist, uQuayBox: QUAY.box, uQuayBed: QUAY.bed });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vQuayWP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvQuayWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uQuayMask, uQuayDist; uniform vec4 uQuayBox; uniform vec3 uQuayBed; varying vec3 vQuayWP;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { vec2 quv = vec2((vQuayWP.x - uQuayBox.x) / uQuayBox.z, (uQuayBox.y + vQuayWP.z) / uQuayBox.w);
    if (vQuayWP.y > -0.05 && all(greaterThan(quv, vec2(0.0))) && all(lessThan(quv, vec2(1.0))) && texture2D(uQuayMask, quv).r > 0.5 && texture2D(uQuayDist, quv).r > 127.5 / 255.0) discard;
    // the bottom of a river or a dock between quays is the bed, not the aerial photo draped on it: the photo
    // there is of the water and of what stands over it (the Shuto over the Nihonbashi River, a streaked grey
    // deck on the riverbed, lit orange at night: issue 234), and where the water lets the bottom through it showed
    oeBed = vQuayWP.y < -0.3 && all(greaterThan(quv, vec2(0.0))) && all(lessThan(quv, vec2(1.0))) && texture2D(uQuayMask, quv).r > 0.5 && texture2D(uQuayDist, quv).r > 130.5 / 255.0 ? 1.0 : 0.0; }`) // (a metre and more out from the wall)
          .replace('#include <clipping_planes_fragment>', 'float oeBed = 0.0;\n#include <clipping_planes_fragment>')
          .replace('#include <map_fragment>', '#include <map_fragment>\nif (oeBed > 0.5) diffuseColor.rgb = uQuayBed;'); // from a quarter metre back: under the coping
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
    const FLOORS = {
      earth: ['vec3(0.15, 0.1, 0.058)', 'vec3(0.21, 0.135, 0.066)', 'vec3(0.085, 0.12, 0.04)'], // bare earth, leaf litter, moss
      lawn: ['vec3(0.068, 0.11, 0.034)', 'vec3(0.095, 0.135, 0.042)', 'vec3(0.15, 0.105, 0.062)'], // grass in shade, in sun, worn to earth
      gravel: ['vec3(0.3, 0.255, 0.19)', 'vec3(0.36, 0.305, 0.225)', 'vec3(0.2, 0.16, 0.11)'], // stabilised sand and gravel, damp under the crowns
    };
    const FLOOR = FLOORS[(scene.woods || {}).floor] || FLOORS.earth;
    // a floor per area (#165): an area in trees.areas with "floor" (earth, lawn or gravel) has its own, the Kyoto
    // Gyoen's gravel, Meiji Jingu's leaf litter, a park's lawn: their outlines drawn into a map over the woods'
    // box (red 80 earth, 120 lawn, 160 gravel; 0 the city's own floor), read nearest
    const KINDS = ['earth', 'lawn', 'gravel'];
    const floorAreas = WOODS ? ((scene.trees || {}).areas || []).filter(a => KINDS.includes(a.floor) && (a.xy || a.parts || a.at)) : [];
    let floorTex = null;
    if (floorAreas.length) {
      const W = scene.woods, fc = Math.max(2, W.cell * 2), cw = Math.ceil(W.nx * W.cell / fc), chh = Math.ceil(W.ny * W.cell / fc);
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
      const g2 = cv.getContext('2d'), px = x => (x - W.x0) / fc, py = y => (W.y1 - y) / fc;
      // the first area listed wins where they overlap, as for the trees' mix: drawn last
      for (const a of floorAreas.slice().reverse()) {
        g2.fillStyle = `rgb(${(KINDS.indexOf(a.floor) + 2) * 40},0,0)`;
        g2.beginPath();
        if (a.at) g2.arc(px(a.at[0]), py(a.at[1]), a.radius / fc, 0, Math.PI * 2);
        else for (const P of a.parts || [a.xy]) P.forEach(([x, y], i) => (i ? g2.lineTo(px(x), py(y)) : g2.moveTo(px(x), py(y))));
        g2.fill();
      }
      floorTex = new THREE.CanvasTexture(cv);
      floorTex.colorSpace = THREE.NoColorSpace; floorTex.flipY = false; floorTex.generateMipmaps = false;
      floorTex.minFilter = floorTex.magFilter = THREE.NearestFilter;
    }
    const woodsFloor = sh => {
      if (!WOODS) return;
      Object.assign(sh.uniforms, { uWoods: WOODS.tex, uWoodsBox: WOODS.box });
      if (floorTex) { sh.uniforms.uFloorMap = { value: floorTex }; sh.defines = Object.assign({}, sh.defines, { FLOOR_MAP: "" }); } // (a copy: the material's own are in its key, trees.js)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWoodWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWoodWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uWoods; uniform vec4 uWoodsBox; varying vec3 vWoodWP;
#ifdef FLOOR_MAP
uniform sampler2D uFloorMap;
#endif
float woodH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float woodN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(woodH(i), woodH(i + vec2(1, 0)), f.x), mix(woodH(i + vec2(0, 1)), woodH(i + vec2(1, 1)), f.x), f.y); }
vec3 woodsFloor(vec3 c) {
  vec2 uv = vec2((vWoodWP.x - uWoodsBox.x) / uWoodsBox.z, (uWoodsBox.y + vWoodWP.z) / uWoodsBox.w);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return c;
  vec4 m = texture2D(uWoods, uv);
  float d = distance(vWoodWP, cameraPosition);
  // the area's own floor, if it has one (0: the city's)
  float fk = 0.0;
#ifdef FLOOR_MAP
  fk = floor(texture2D(uFloorMap, uv).r * 255.0 / 40.0 + 0.5) - 1.0; // 1 earth, 2 lawn, 3 gravel
#endif
  // in a park, the photo's shadows on its gravel are skylight blue (the same teal), and the scene
  // casts its own: near the camera, their colour taken out
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float blue = smoothstep(0.005, 0.03, c.b - c.g) * smoothstep(0.01, 0.04, c.b - c.r);
  c = mix(c, vec3(L) * vec3(1.06, 1.0, 0.9), blue * m.a * 0.85 * (1.0 - smoothstep(150.0, 700.0, d)));
  // on a gravel ground (the Kyoto Gyoen's avenues) the whole photo's gravel, in sun and in shade, is a warm
  // grey-beige: what is left of the sky's blue in it taken out at any distance
  if (fk > 2.5) { float L0 = dot(c, vec3(0.2126, 0.7152, 0.0722)); float bl = smoothstep(-0.01, 0.025, c.b - 0.5 * (c.r + c.g));
    c = mix(c, vec3(L0) * vec3(1.08, 1.0, 0.86), 0.9 * bl);
    c *= mix(1.0, 0.8, smoothstep(0.3, 0.75, L0)); } // and its sunlit expanse kept off white, as it photographs
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
  vec3 f0 = ${FLOOR[0]}, f1 = ${FLOOR[1]}, f2 = ${FLOOR[2]};
  if (fk > 0.5) { // an area's own floor
    if (fk < 1.5) { f0 = ${FLOORS.earth[0]}; f1 = ${FLOORS.earth[1]}; f2 = ${FLOORS.earth[2]}; }
    else if (fk < 2.5) { f0 = ${FLOORS.lawn[0]}; f1 = ${FLOORS.lawn[1]}; f2 = ${FLOORS.lawn[2]}; }
    else { f0 = ${FLOORS.gravel[0]}; f1 = ${FLOORS.gravel[1]}; f2 = ${FLOORS.gravel[2]}; }
  }
  vec3 g = mix(f0, f1, smoothstep(0.35, 0.72, patches));
  g = mix(g, f2, smoothstep(0.5, 0.82, woodN(p * 0.19 + 7.0)) * 0.85);
  g *= (0.78 + 0.44 * grain) * mix(1.0, 0.82, smoothstep(6.0, 22.0, m.g * 32.0));
  vec3 path = vec3(0.29, 0.26, 0.21) * (0.86 + 0.28 * woodN(p * 8.0));
  g = mix(g, path, smoothstep(0.2, 0.6, m.b));
  return mix(c, g, k);
}`).replace('#include <emissivemap_fragment>', `diffuseColor.rgb = ${/oeSn = oeSnowOn/.test(sh.fragmentShader) ? 'mix(woodsFloor(diffuseColor.rgb), diffuseColor.rgb, oeSn)' : 'woodsFloor(diffuseColor.rgb)'};\n#include <emissivemap_fragment>`); // (settled snow, game/weather.js, lies over the wood's floor)
    };
    const gradePhoto = sh => {
      clipGround(sh);
      sh.uniforms.uPhotoGrade = PG;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockWP, vRockWN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRockWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vRockWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${PHOTO_GRADE}`)
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${STEEP_ROCK}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = photoGrade(diffuseColor.rgb);\nfloat oeSteep = steepness();\ndiffuseColor.rgb = steepRock(diffuseColor.rgb, oeSteep);');
      woodsFloor(sh); // after the photo, the game's drawn streets and grain: the floor has its own
      streetLit(sh);
    };
    // How much of the sky the ground sees (issue 358, B2: data/<city>/skyvis.webp, pipeline/skyvis.py), on the
    // ambient light of the ground and what stands on it: a street canyon's soft shade, which the page had only
    // from screen-space AO, computed again every frame from a few metres round each pixel. One texture read in
    // the materials that take the street lights (the same ground-level surfaces); it multiplies the indirect
    // diffuse light alone, near the camera (far off the aerial photograph carries its own shade). uSkyVisK is
    // its strength: 0 until the texture has come, then 0.6, constant (agreed with issue 353). `?skyvis=off` leaves it out.
    const SKYVIS = new URLSearchParams(location.search).get('skyvis') !== 'off' ? { uSkyVis: { value: null }, uSkyVisF: { value: new THREE.Vector4(0, 0, 1, 1) }, uSkyVisK: { value: 0 } } : null;
    if (SKYVIS) {
      const px = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); px.needsUpdate = true;
      SKYVIS.uSkyVis.value = px;
      fetch(`${D.DATA}skyvis.json`).then(r => (r.ok ? r.json() : null)).then(meta => {
        if (!meta) return;
        new THREE.TextureLoader().load(`${D.DATA}skyvis.webp`, tex => {
          tex.colorSpace = THREE.NoColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; // (north up: flipY as loaded)
          SKYVIS.uSkyVis.value = tex;
          SKYVIS.uSkyVisF.value.set(meta.x[0], meta.y[0], 1 / (meta.x[1] - meta.x[0]), 1 / (meta.y[1] - meta.y[0]));
          SKYVIS.uSkyVisK.value = 0.6;
        });
      }).catch(() => {});
    }
    // The sun's shadow past the shadow map's box (issue 358, B4, a prototype: `?farsun=on`). The shadow map covers
    // a few hundred metres round the player; beyond it nothing was shaded by the sun at all, and a tower outside
    // the box threw no shadow into it. The city is static and the sun's direction is one vector, so a Worker
    // sweeps the game's 2 m surface model once along that vector (visibility-sweep.js sunShadow, 30 ms) into a
    // height field: under this height the sun is hidden. One texture read then shades the whole map; it is done
    // again when the sun has moved 0.4 degrees. uSunBox: the shadow map's box (centre x, z, half its width), inside
    // which the map alone decides, and whether the field is there at all (0 at night and before the first one).
    const FARSUN_Q = new URLSearchParams(location.search).get('farsun'); // on: past the shadow map's box; all: everywhere (to look at the field itself)
    const FARSUN = (FARSUN_Q === 'on' || FARSUN_Q === 'all') && window.Worker ? { uSunH: { value: null }, uSunHF: { value: new THREE.Vector4(0, 0, 1, 1) }, uSunBox: { value: new THREE.Vector4(0, 0, 0, 0) } } : null;
    const farSun = { worker: null, pending: 0, id: 0, last: null, ready: false, scale: small ? 4 : 2, ms: 0 };
    if (FARSUN) {
      const px = new THREE.DataTexture(new Uint16Array([0, 0]), 1, 1, THREE.RGFormat, THREE.HalfFloatType); px.needsUpdate = true;
      FARSUN.uSunH.value = px;
      // G: the game's surface model (sun.js buildDSM, with ids)
      farSun.init = G => {
        if (farSun.worker) return;
        try { farSun.worker = new Worker(new URL('visibility-worker.js', document.baseURI)); } catch (e) { return; }
        const built = new Uint8Array(G.nx * G.ny);
        if (G.ids) for (let i = 0; i < built.length; i++) built[i] = G.ids[i] >= 0 ? 1 : 0;
        const data = G.data.slice();
        farSun.G = { nx: G.nx, ny: G.ny, cell: G.cell, x0: G.x0, y1: G.y1 };
        farSun.worker.postMessage({ sunInit: { nx: G.nx, ny: G.ny, cell: G.cell, data, built } }, [data.buffer, built.buffer]);
        farSun.worker.onmessage = e => {
          const d = e.data;
          if (!d.sun || d.sun !== farSun.pending) return;
          farSun.pending = 0; farSun.ms = d.ms;
          const old = FARSUN.uSunH.value, tex = new THREE.DataTexture(d.data, d.w, d.h, THREE.RGFormat, THREE.HalfFloatType);
          tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true; // (row 0 at the north)
          FARSUN.uSunH.value = tex;
          const g = farSun.G;
          FARSUN.uSunHF.value.set(g.x0, g.y1, 1 / (g.nx * g.cell), 1 / (g.ny * g.cell));
          farSun.ready = true; FARSUN.uSunBox.value.w = farSun.up ? 1 : 0;
          if (old) old.dispose();
          if (farSun.want) { const w = farSun.want; farSun.want = null; farSun.update(w); }
        };
        if (api && api.sunDir) farSun.update(api.sunDir);
      };
      // the sun has moved (setSun): a new field when it has turned 0.4 degrees, none while it is under 2 degrees up
      farSun.update = dir => {
        farSun.up = dir.y > 0.035;
        FARSUN.uSunBox.value.w = farSun.up && farSun.ready ? 1 : 0;
        if (!farSun.worker || !farSun.up) return;
        if (farSun.last && farSun.last.dot(dir) > 0.999976) return;
        if (farSun.pending) { farSun.want = dir.clone(); return; }
        farSun.last = dir.clone();
        const hl = Math.hypot(dir.x, dir.z) || 1e-6;
        farSun.pending = ++farSun.id;
        farSun.worker.postMessage({ sun: { id: farSun.pending, ex: dir.x / hl, en: -dir.z / hl, tanEl: dir.y / hl, scale: farSun.scale } });
      };
      farSun.dispose = () => { if (farSun.worker) farSun.worker.terminate(); farSun.worker = null; };
    }
    const sunLit = sh => {
      if (FARSUN && !sh.uniforms.uSunH && sh.fragmentShader.includes('#include <lights_fragment_begin>')) {
        const chunk = THREE.ShaderChunk.lights_fragment_begin, mark = 'vDirectionalShadowCoord[ i ] ) : 1.0;\n\t\t#endif';
        if (chunk.includes(mark)) {
          Object.assign(sh.uniforms, FARSUN);
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uSunH; uniform vec4 uSunHF; uniform vec4 uSunBox;`)
            .replace('#include <lights_fragment_begin>', `float oeFarSun = 1.0;
if (uSunBox.w > 0.0) {
  mat3 oeVI = transpose(mat3(viewMatrix));
  vec3 oeFP = oeVI * (-vViewPosition - viewMatrix[3].xyz), oeFN = oeVI * normal;
  vec2 oeFQ = oeFP.xz + oeFN.xz * 3.0; // a wall reads the ground in front of it
  vec2 oeHS = texture2D(uSunH, vec2((oeFQ.x - uSunHF.x) * uSunHF.z, (uSunHF.y + oeFQ.y) * uSunHF.w)).rg;
  float oeLit = smoothstep(-0.5, 2.5, oeFP.y - (oeFN.y > 0.7 && oeFP.y > oeHS.y + 3.0 ? oeHS.x : oeHS.y)); // a roof by its own field
  float oeOut = uSunBox.z > 0.0 ? smoothstep(0.8, 0.97, length(oeFP.xz - uSunBox.xy) / uSunBox.z) : 1.0;
  oeFarSun = mix(1.0, oeLit, oeOut);
}
` + chunk.replace(mark, mark + '\n\t\tdirectLight.color *= oeFarSun;'));
        }
      }
    };
    const skyLit = sh => {
      sunLit(sh);
      if (!SKYVIS || sh.uniforms.uSkyVis || !sh.fragmentShader.includes('#include <lights_fragment_end>')) return;
      Object.assign(sh.uniforms, SKYVIS);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uSkyVis; uniform vec4 uSkyVisF; uniform float uSkyVisK;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{ vec3 oeSP = transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz);
  float oeSV = texture2D(uSkyVis, vec2((oeSP.x - uSkyVisF.x) * uSkyVisF.z, (-oeSP.z - uSkyVisF.y) * uSkyVisF.w)).r;
  reflectedLight.indirectDiffuse *= mix(1.0, oeSV, uSkyVisK * (1.0 - smoothstep(150.0, 500.0, length(vViewPosition)))); }`);
      groundBounce(sh); // (the walls among them: the landmarks' and the quays')
    };
    // A bounce that knows its ground (issue 372, item 2). Sunlit ground throws warm light back onto the walls over
    // it, through the hemisphere light's ground colour (game/atmosphere.js shadeLight); alone, that lit a wall in a
    // dark alley as warmly as one on a sunlit square. The wall reads the sky visibility (skyvis.webp, above) of the
    // ground 4 m in front of it: from it the height of the horizon there (its mean cos^2 is the texture's value), and
    // whether the sun clears it. The ground term of the hemisphere light is scaled by that: a canyon's foot keeps
    // a third of its bounce, an open square a quarter more than it had. One texture read in the walls' shader, no pass.
    // uBounceSun: the sun's elevation (rad), uBounceK: how much of the day it is (0 at night: the bounce as it was).
    // `?bounce=off` leaves it out.
    const BOUNCE = SKYVIS && new URLSearchParams(location.search).get('bounce') !== 'off' ? Object.assign({ uBounceSun: { value: 0 }, uBounceK: { value: 0 } }, SKYVIS) : null;
    const groundBounce = sh => {
      if (!BOUNCE || sh.uniforms.uBounceSun || !sh.fragmentShader.includes('#include <lights_fragment_end>')) return;
      const had = !!sh.uniforms.uSkyVis;
      Object.assign(sh.uniforms, BOUNCE);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${had ? '' : 'uniform sampler2D uSkyVis; uniform vec4 uSkyVisF; uniform float uSkyVisK;'} uniform float uBounceSun, uBounceK;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_HEMI_LIGHTS > 0
if (uBounceK > 0.0 && uSkyVisK > 0.0 && 0.5 - 0.5 * dot(normal, hemisphereLights[0].direction) > 0.02) { // (not the ground: it faces away)
  mat3 oeBI = transpose(mat3(viewMatrix));
  vec3 oeBP = oeBI * (-vViewPosition - viewMatrix[3].xyz), oeBN = oeBI * normal;
  vec2 oeBQ = oeBP.xz + normalize(oeBN.xz + 1e-4) * 4.0;
  float oeBV = texture2D(uSkyVis, vec2((oeBQ.x - uSkyVisF.x) * uSkyVisF.z, (-oeBQ.y - uSkyVisF.y) * uSkyVisF.w)).r;
  float oeHz = acos(sqrt(clamp(oeBV, 0.0, 1.0))); // the horizon's height over that ground, rad
  float oeLitG = smoothstep(oeHz - 0.14, oeHz + 0.14, uBounceSun);
  float oeGw = 0.5 - 0.5 * dot(normal, hemisphereLights[0].direction); // the ground's share of the hemisphere light here
  float oeF = mix(1.0, mix(0.3, 1.25, oeLitG), uBounceK * (1.0 - smoothstep(150.0, 500.0, length(vViewPosition))));
  reflectedLight.indirectDiffuse += hemisphereLights[0].groundColor * oeGw * (oeF - 1.0) * material.diffuseColor * RECIPROCAL_PI;
}
#endif`);
    };
    // the street lights on a lit surface: its colour times their light where it is (the world
    // position from the view position, as the view matrix is rigid)
    const streetLit = sh => {
      skyLit(sh);
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
    const photoTex = img => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (img) tex.needsUpdate = true;
      return tex;
    };
    const lo = scene.ground_lo, loTex = pics.overview && photoTex(null);
    if (loTex) pics.overview.then(img => { if (img) { loTex.image = img; loTex.needsUpdate = true; } });
    const shown = []; // (every tile's own picture on screen: pics.shown, which the film and still tools wait for)
    // the overview's part under a tile (one image on the GPU for them all)
    const loPart = t => {
      const tex = loTex.clone();
      tex.repeat.set((t.x1 - t.x0) / (lo.x1 - lo.x0), (t.y1 - t.y0) / (lo.y1 - lo.y0));
      tex.offset.set((t.x0 - lo.x0) / (lo.x1 - lo.x0), (t.y0 - lo.y0) / (lo.y1 - lo.y0));
      return tex;
    };
    // On a phone (quality.js lean) only the tiles nearest the camera keep their own picture on the GPU (budget.groundTiles,
    // 6 MB each), the others the overview's part; groundKeep(x, y) moves them as the camera goes (the game, every second).
    // Shibuya's twenty tiles were 122 MB of textures, Queenstown's twenty-eight 170
    const KEEP = LEAN && loTex && QW.budget ? QW.budget.groundTiles : 0, stream = KEEP ? { img: [], own: [], lo: [], at: null } : null;
    scene.ground.forEach((t, i) => {
      const g = tileGeometry(t, T);
      let tex;
      if (loTex && (!pics.first[i] || stream)) tex = loPart(t); // (until its picture comes)
      else tex = photoTex(null);
      const m = groundMesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
      shown.push(pics.tiles[i].then(async img => {
        if (!pics.overview) tileLoaded(img);
        if (!img) return;
        if (stream) { stream.img[i] = img; stream.lo[i] = tex; if (stream.at) groundKeep(...stream.at, true); return; }
        if (pics.first[i]) { tex.image = img; tex.needsUpdate = true; return; }
        // a far tile, after the game opened: sent to the GPU between frames, then swapped in
        const own = photoTex(img);
        await idle();
        try { renderer.initTexture(own); } catch (e) { /* sent on its first draw */ }
        m.material.map = own;
      }));
      m.material.onBeforeCompile = gradePhoto;
      m.receiveShadow = true;
      world.add(m);
      groundMeshes.push(m);
    });
    pics.shown = () => Promise.all(shown);
    // which tiles show their own picture on a phone: the KEEP nearest (x, y), each sent to the GPU between frames as it
    // comes in and given back when it drops out; at first those round the start
    function groundKeep(x, y, now = false) {
      if (!stream) return;
      const was = stream.at;
      stream.at = [x, y];
      if (!now && was && Math.hypot(x - was[0], y - was[1]) < 150) return;
      const d = scene.ground.map((t, i) => [Math.hypot(Math.max(t.x0 - x, 0, x - t.x1), Math.max(t.y0 - y, 0, y - t.y1)), i]).sort((a, b) => a[0] - b[0]);
      const want = new Set(d.slice(0, KEEP).map(e => e[1]));
      scene.ground.forEach((t, i) => {
        const m = groundMeshes[i], own = stream.own[i];
        if (want.has(i) && !own && stream.img[i]) {
          const tex = stream.own[i] = photoTex(stream.img[i]);
          idle().then(() => {
            if (stream.own[i] !== tex) return;
            try { renderer.initTexture(tex); } catch (e) { /* sent on its first draw */ }
            m.material.map = tex;
          });
        } else if (!want.has(i) && own) {
          stream.own[i] = null;
          m.material.map = stream.lo[i];
          own.dispose();
        }
      });
    }
    if (stream) groundKeep(...(groundAt || [0, 0]), true);

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
    // Whether any of the sea can be in the picture (issue 352), from the terrain alone: the sea shows where the
    // ground is at its level (0; the terrain's edge stands for what lies past it). A map with no such ground (most of
    // Kyoto's and Tokyo's) never draws or updates it. Elsewhere the ground is sampled under a grid of rays through the
    // frame and along the directions the camera looks in, out to 13 km; buildings in the way are not counted, so it
    // errs towards drawing. An occlusion query was tried for this and reported water where there was none
    // (docs/PERFORMANCE.md); this needs no GPU at all. Held for half a second after the last sighting.
    const seaT = D.Tfine || D.T, SEA_Z = 0.3, seaRay = new THREE.Vector3(), seaFwd = new THREE.Vector3();
    let seaEver = true, seaSeenAt = -1e9;
    if (sea && seaT && seaT.data && seaT.nx) {
      seaEver = false;
      for (let i = 0; i < seaT.data.length && !seaEver; i++) if (seaT.data[i] <= SEA_Z) seaEver = true;
      if (!seaEver) sea.mesh.visible = false;
    }
    const seaAt = (x, z) => !seaT || !seaT.data || S.terrainAt(seaT, x, -z) <= SEA_Z;
    function seaInView(camera, t) {
      if (!seaEver) return false;
      if (!seaT || !seaT.data || new URLSearchParams(location.search).get('sea') === 'always') return true;
      const P = camera.position;
      let seen = P.y <= SEA_Z + 0.5;
      for (let j = 0; j < 5 && !seen; j++) for (let i = 0; i < 7 && !seen; i++) {
        seaRay.set(i / 3 - 1, j / 2 - 1, 0.5).unproject(camera).sub(P);
        if (seaRay.y > -1e-6) continue; // (at or over the horizon)
        const k = Math.min(-P.y / seaRay.y, 13000 / Math.max(1e-6, Math.hypot(seaRay.x, seaRay.z)));
        seen = seaAt(P.x + seaRay.x * k, P.z + seaRay.z * k);
      }
      if (!seen) {
        // the ground out to the horizon in the frame's sector, unless the frame is all sky (its lowest ray climbs)
        seaRay.set(0, -1, 0.5).unproject(camera).sub(P);
        camera.getWorldDirection(seaFwd);
        const up = seaRay.y > 0.05 * Math.hypot(seaRay.x, seaRay.z), yaw = Math.atan2(seaFwd.x, seaFwd.z);
        const half = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) + 0.12;
        for (let a = -4; a <= 4 && !seen && !up; a++) {
          const sx = Math.sin(yaw + a * half / 4), sz = Math.cos(yaw + a * half / 4);
          for (let d = 20; d <= 13000 && !seen; d *= 1.6) seen = seaAt(P.x + sx * d, P.z + sz * d);
        }
      }
      if (seen) seaSeenAt = t;
      return t - seaSeenAt < 500;
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
      far = OEFarLand.create(farData, { frame: scene.frame, ground: D.ground, small, PG, PHOTO_GRADE, holes: outHoles });
      world.add(far.mesh);
      if (seaTex) for (const m of [water.material, waterMat]) m.defines = Object.assign({}, m.defines, { OE_FARLAND: '' });
    } catch (e) { console.warn('far land: none drawn', e); far = null; }
    // the landings past the frame (outposts.js), their edges blended to the far land's surface
    let outposts = null;
    if (outHoles.length) try {
      OEOutposts.blend(D.G, far && far.surface);
      outposts = OEOutposts.build(D.G, { DATA: D.DATA, texLoader, small, anisotropy: renderer.capabilities.getMaxAnisotropy(),
        photoMaterial: tex => { const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
          m.onBeforeCompile = sh => { sh.uniforms.uPhotoGrade = PG; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${PHOTO_GRADE}`)
            .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = photoGrade(diffuseColor.rgb);'); }; return m; } });
      world.add(still(outposts));
    } catch (e) { console.warn('outposts: none drawn', e); outposts = null; }
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

    // inland water (inland.js): the channels' water over their beds between revetments under a coping and a
    // railing, the ponds' and the rivers' water in their beds; the flow drifts the ripples downstream
    let inland = null;
    if (IN) try {
      const ripples = rippleTexture(), IW = scene.inland || {};
      const flow = b => { // the way the water runs: from its highest point to its lowest (still water: a slow drift)
        let hi = null, lo = null;
        b.rings[0].forEach((p, i) => { const z = b.wz[0][i]; if (!hi || z > hi[2]) hi = [p[0], p[1], z]; if (!lo || z < lo[2]) lo = [p[0], p[1], z]; });
        const dx = lo[0] - hi[0], dy = lo[1] - hi[1], L = Math.hypot(dx, dy), still = hi[2] - lo[2] < 0.3 || L < 1;
        return still ? [0.012, 0.007] : [0.09 * dx / L, 0.09 * dy / L]; // m/s of texture drift, as tiles of 5 m: about 0.45 m/s
      };
      const glint = sh => { if (window.OEWater && OEWater.patchGlitter) OEWater.patchGlitter(sh, SCREEN.t); streetLit(sh); };
      const wallMats = {}, waterMats = [];
      const concrete = () => {
        const m = new THREE.MeshStandardMaterial({ color: lin(IW.concrete || '#a29f96'), roughness: 0.92, metalness: 0 });
        m.defines = { USE_UV: '' };
        m.onBeforeCompile = sh => {
          // cast in lifts 1.5 m high and bays 10 m long, weathered: grime streaks down from the coping, darker and
          // greener towards the water, wet at the waterline
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
float inH(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
  { float fw = max(fwidth(vUv.x), fwidth(vUv.y)), near = 1.0 - smoothstep(0.1, 0.4, fw);
    float lift = abs(fract(vUv.y / 1.5 + 0.5) - 0.5) * 1.5, bay = abs(fract(vUv.x / 10.0 + 0.5) - 0.5) * 10.0;
    float joint = 1.0 - smoothstep(0.01, 0.03 + fw, min(lift, bay));
    float bayTone = 0.9 + 0.16 * inH(vec2(floor(vUv.x / 10.0), floor(vUv.y / 1.5)));
    float streak = 0.5 + 0.5 * sin(vUv.x * 2.3 + 3.0 * sin(vUv.x * 0.37)) * sin(vUv.x * 7.1 + 1.3);
    float top = clamp(vUv.y / 4.5, 0.0, 1.0);
    diffuseColor.rgb *= mix(1.0, bayTone * (1.0 - 0.35 * joint), near) * (0.8 + 0.2 * mix(streak, 1.0, top));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.47, 0.36), 1.0 - smoothstep(0.0, 0.9 + 0.2 * streak, vUv.y));
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(-0.25, 0.08, vUv.y)); }`);
          streetLit(sh);
        };
        m.customProgramCacheKey = () => 'inland|concrete';
        return m;
      };
      const stone = () => {
        const sw = Object.assign({ stone: '#8f8678', course_m: 0.45, block_m: 0.9 }, IW.stone || {});
        const m = new THREE.MeshStandardMaterial({ color: lin(sw.stone), roughness: 0.9, metalness: 0 });
        PATTERNS.ashlar(m, { course_m: sw.course_m, block_m: sw.block_m, tide: true, high_water_m: 0.35 });
        const own = m.onBeforeCompile;
        m.onBeforeCompile = sh => { own(sh); streetLit(sh); };
        m.customProgramCacheKey = () => 'inland|stone';
        return m;
      };
      const mats = {
        water: b => {
          const walledBody = b.kind === 'walled';
          const tex = ripples.clone(); tex.repeat.set(0.2, 0.2); tex.needsUpdate = true;
          const m = new THREE.MeshStandardMaterial({ color: lin(walledBody ? (IW.colour || '#33463d') : (IW.pond_colour || '#2b3d36')), roughness: 0.06, metalness: 0,
            transparent: true, opacity: walledBody ? 0.7 : 0.86, normalMap: tex, normalScale: new THREE.Vector2(walledBody ? 0.35 : 0.18, walledBody ? 0.35 : 0.18), depthWrite: true });
          m.onBeforeCompile = glint;
          m.customProgramCacheKey = () => 'inland|water';
          waterMats.push({ tex, v: flow(b) });
          return m;
        },
        bed: () => mats._bed || (mats._bed = new THREE.MeshStandardMaterial({ color: lin(IW.bed || '#4b4b43'), roughness: 0.95, metalness: 0 })),
        wall: b => wallMats[b.walls] || (wallMats[b.walls] = b.walls === 'stone' ? stone() : concrete()),
        coping: new THREE.MeshStandardMaterial({ color: lin(IW.coping || '#b3afa5'), roughness: 0.85, metalness: 0 }),
        rail: new THREE.MeshStandardMaterial({ color: lin(IW.rail || '#5d6a66'), roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }),
        slab: new THREE.MeshStandardMaterial({ color: lin(IW.concrete || '#a29f96'), roughness: 0.9, metalness: 0 }),
        // a sunken promenade's floor and steps (the Horikawa): granite setts, 0.3 by 0.6 m
        floor: (() => { const m = new THREE.MeshStandardMaterial({ color: lin(IW.paving || '#a39d92'), roughness: 0.88, metalness: 0 });
          PATTERNS.ashlar(m, { course_m: 0.3, block_m: 0.6 }); const own = m.onBeforeCompile; m.onBeforeCompile = sh => { own(sh); streetLit(sh); };
          m.customProgramCacheKey = () => 'inland|floor'; return m; })(),
      };
      // a promenade's lawn (the Horikawa's 芝生広場), and the white water off its weirs
      mats.lawn = new THREE.MeshStandardMaterial({ color: lin(IW.lawn || '#526b38'), roughness: 0.95, metalness: 0 });
      mats.lawn.onBeforeCompile = streetLit;
      mats.foam = new THREE.MeshStandardMaterial({ color: lin('#e9eef0'), roughness: 0.4, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
      PATTERNS.railing(mats.rail, { bar_m: 0.14, rails_m: [0.06, 1.05] });
      mats.coping.onBeforeCompile = mats.slab.onBeforeCompile = streetLit;
      mats.bed().onBeforeCompile = streetLit;
      const built = IN.build(mats);
      inland = built.group;
      // the ripples drift with the flow (seconds since the page opened)
      const t0 = performance.now();
      const first = inland.children.find(m => m.name === 'inland_water');
      if (first) first.onBeforeRender = () => { const t = (performance.now() - t0) / 1000; for (const w of waterMats) w.tex.offset.set((w.v[0] * t) % 1, (w.v[1] * t) % 1); };
      world.add(inland);
      console.info(`inland water: ${IN.bodies.length} bodies, ${(built.length / 1000).toFixed(1)} km of revetment, ${IN.decks.length} decks`);
    } catch (e) { console.warn('inland water: none drawn', e); inland = null; }

    // ------------------------------------------------------------ buildings
    loadMsg(`Building ${B.b.length.toLocaleString()} buildings: walls, roofs and facades`, 0.5);
    await idle();
    const SRC = BUILDING_SRC;
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
    U.uPhotoGrade = PG;
    if (NU) Object.assign(U, NU);
    // (a cell of the map built round the player, as it comes and goes: a still caster, hidden while the street wall
    // hides it, its arrays the GPU's alone once sent)
    const letGo = function () { this.array = null; };
    const onCell = (m, added) => {
      if (!added) { if (window.OEVis) OEVis.ungate(m); return; }
      still(m);
      if (window.OEVis) OEVis.gate(m, true);
      for (const a of Object.values(m.geometry.attributes)) a.onUpload(letGo);
      m.geometry.index.onUpload(letGo);
    };
    const BLD = await OEBuildings.create(D, { lin, U, renderer, SRC, small, job: bldJob, cells: MAP, onCell, photoGrade: PHOTO_GRADE, night: NIGHT, pictures: pics,
      progress: f => loadMsg(`Building ${B.b.length.toLocaleString()} buildings: walls, roofs and facades`, 0.5 + 0.14 * f) });
    const bGeo = BLD.geometry, buildings = BLD.mesh;
    const fr = scene.frame;
    U.uFrame.value.set(fr.x[0], fr.y[0], 1 / (fr.x[1] - fr.x[0]), 1 / (fr.y[1] - fr.y[0]));
    // drawn as cells over a grid (buildings.js cells), the one mesh kept out of the scene for picking (game.js) and
    // for the bounds-tree; the cells share its geometry's buffers and its material
    const bCells = BLD.stream ? buildings : OEBuildings.cells ? OEBuildings.cells(buildings) : null;
    // (the game picks a building from its collision world, nav.js col.pick: the bounds-tree is the viewer's, issue 406)
    if (THREE.MeshBVH && !game) { // a bounding-volume hierarchy makes picking a building ~300x faster
      // built in a Worker where the walls are drawn as cells (a city's worth: a second on the main thread, issue 299),
      // and put on the picking mesh when it comes (it reorders that mesh's index, which the cells have copied
      // already); a pick before then takes the plain, slower way. A small town's, or without a Worker, here
      const here = () => { if (!bGeo.boundsTree) bGeo.boundsTree = new THREE.MeshBVH(bGeo); buildings.raycast = THREE.acceleratedRaycast; };
      if (bCells) bvhIn(bGeo).then(data => { if (!bGeo.boundsTree) bGeo.boundsTree = THREE.MeshBVH.deserialize(data, bGeo, { setIndex: true }); buildings.raycast = THREE.acceleratedRaycast; })
        .catch(e => { console.warn('bounds-tree worker', e); here(); });
      else here();
    }
    // a phone (quality.js lean): once uploaded, the walls' shading attributes and the cells' indices are the GPU's
    // alone (a hundred MB of script memory in Shibuya); the viewer's picking mesh keeps what a pick reads (position,
    // index, bid), and in the game, which picks from its collision world, those go too (Kyoto's 120 MB, issue 406).
    // A lost context then cannot be restored in place, and the game reloads instead (api.gpuOnly)
    let gpuOnly = false; // (set here, before the api is made)
    if (BLD.stream) gpuOnly = true;
    else if (game && bCells) bGeo.setIndex(null); // (the cells have their own: the picking mesh's is the viewer's alone)
    if (LEAN && bCells && !BLD.stream) {
      for (const n of ['normal', 'color', 'fac', 'inf', 'ext', 'srcCode'].concat(game ? ['position', 'bid'] : [])) if (bGeo.attributes[n]) bGeo.attributes[n].onUpload(letGo);
      for (const c of bCells.children) if (c.geometry.index) c.geometry.index.onUpload(letGo);
      gpuOnly = true;
    }
    world.add(still(bCells || buildings), still(BLD.props));
    if (bCells) buildings.updateMatrixWorld();
    if (game && window.OEVis) { if (!BLD.stream) OEVis.gateAll(bCells); OEVis.gateAll(BLD.props); } // hidden while the street wall hides them (issue 358)
    if (BOUNCE && buildings.material && buildings.material.onBeforeCompile) { // the walls' bounce from the ground in front of them
      const own = buildings.material.onBeforeCompile, key = buildings.material.customProgramCacheKey;
      buildings.material.onBeforeCompile = function (sh, r) { own.call(this, sh, r); groundBounce(sh); };
      buildings.material.customProgramCacheKey = function () { return `${key ? key.call(this) : ''}|bounce`; };
    }
    if (FARSUN && buildings.material && buildings.material.onBeforeCompile) { // the walls and roofs take the far sun's shadow too
      const own = buildings.material.onBeforeCompile, key = buildings.material.customProgramCacheKey;
      buildings.material.onBeforeCompile = function (sh, r) { own.call(this, sh, r); sunLit(sh); };
      buildings.material.customProgramCacheKey = function () { return `${key ? key.call(this) : ''}|farsun`; };
    }

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
    world.add(still(piers));
    // the game's boardwalks (game.json): 0.3 m timber decks at the pier deck height
    const walks = (D.G && D.G.boardwalks) || [];
    if (walks.length) {
      const top = Math.round((D.G.pier_deck_m || 2.2) * 10), timber = { wall: lin('#6f5a44'), roof: lin('#8a7258'), code: 3, windows: false };
      const deck = new THREE.Mesh(extrude(walks.map(r => [-1, top - 3, 0, 3, r]), () => timber), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      deck.material.onBeforeCompile = streetLit;
      deck.castShadow = deck.receiveShadow = true;
      world.add(still(deck));
    }

    // trees mapped in OSM, then those planted from the woods' and parks' canopy (pipeline/woods.py,
    // with measured heights; a third of them on a small device), then a landmark's own (landmarks.json
    // "trees", [x, y, z, height] dm: a roof garden's, standing on its terraces): the shared Blender species
    // (trees.js) in the city's mix, else low-poly crowns on short trunks; the mapped trees'
    // heights are not mapped (7-14 m spread)
    let TR = (P.trees || []).concat(P.woods || [], (LM && LM.trees) || []), nMapped = (P.trees || []).length / 4, nFixed = ((P.trees || []).length + (P.woods || []).length) / 4;
    if (LM && LM.treeless && LM.treeless.length) { // nor under a landmark that says so (landmarks.json "treeless": a viaduct's deck)
      const rings = LM.treeless.map(r => r.map(v => v / 10)), keep = [], f0 = nFixed, m0 = nMapped;
      const xs = rings.map(r => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let k = 0; k < r.length; k += 2) { a = Math.min(a, r[k]); c = Math.max(c, r[k]); b = Math.min(b, r[k + 1]); d = Math.max(d, r[k + 1]); } return [a, b, c, d]; });
      const inR = (r, x, y) => { let o = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < (r[j] - r[i]) * (y - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) o = !o; return o; };
      for (let i = 0; i < TR.length; i += 4) {
        const x = TR[i] / 10, y = TR[i + 1] / 10;
        if (i < 4 * f0 && rings.some((r, k) => x >= xs[k][0] && x <= xs[k][2] && y >= xs[k][1] && y <= xs[k][3] && inR(r, x, y))) { if (i < 4 * m0) nMapped--; nFixed--; continue; }
        keep.push(TR[i], TR[i + 1], TR[i + 2], TR[i + 3]);
      }
      TR = keep;
    }
    if (IN) { // none stands in a channel or a pond (inland.js): a cherry planted from the canopy over the Meguro River stands on its bank
      const keep = [], m0 = nMapped, f0 = nFixed;
      for (let i = 0; i < TR.length; i += 4) {
        const at = i < 4 * f0 ? IN.bank(TR[i] / 10, TR[i + 1] / 10) : [0, 0, null]; // (a landmark's own tree stays where it is put)
        if (at) { keep.push(at[2] == null ? TR[i] : Math.round(at[0] * 10), at[2] == null ? TR[i + 1] : Math.round(at[1] * 10), at[2] == null ? TR[i + 2] : Math.round(at[2] * 10), TR[i + 3]); continue; }
        if (i < 4 * m0) nMapped--;
        if (i < 4 * f0) nFixed--;
      }
      TR = keep;
    }
    // the grasses (#286, #326): tussock, susuki and Lomandra (trees.json; city.json trees.tussock, trees.susuki,
    // trees.lomandra, each its own settings), standing where they are put, all of them that species:
    // - in a landmark's planted beds (beds: [{mesh, per_m2}], scattered over the faces of that mesh);
    // - on the open hills (slopes: {above_m, per_ha, max, near: [[x, y, r, per_ha]]}): above the town, where no
    //   canopy stands (woods.png), off the roads and their houses (25 m) and clear of the landmarks, on ground no
    //   steeper than rock;
    // - in the parks named (places: [{name, per_ha}]), over the place's own outline (places.json), off its paths and
    //   clear of its trees and the landmarks;
    // - and over the outlines open data maps for it (open: true): places.json "grass"[species], [{per_ha, polygons}],
    //   written by pipeline/grasses.py (a river's banks and sandbars, a park's meadow, a reserve's planted beds)
    const own = [];
    const hsh = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
    let canopy, lmHash = null; // the woods' canopy at 8 m (whether any crown stands there), and the landmarks' 8 m cells and their neighbours
    const inRing = (r, x, y) => { let k = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < r[j] + (y - r[j + 1]) / (r[i + 1] - r[j + 1]) * (r[i] - r[j])) k = !k; return k; };
    const GRASS_H = { susuki: 1.75, lomandra: 0.85 }; // (their models' heights, trees.json, for a city with an older trees.json)
    ['tussock', 'susuki', 'lomandra'].forEach((species, si) => {
      const TU = (scene.trees || {})[species];
      if (!TU || !window.OETrees) return;
      try {
        const pts = [], seed = si * 17.31; // (each grass its own jitter: two in the same bed do not stand on the same spots)
        // (the heights, dm, each clump's own: the tussock's as before, from 0.6 to 1.05 m; the others' from 0.7 to 1.15
        // times their model's, trees.json height_m, which trees.js scales each one by)
        const hOf = (u, lo = 0.6, span = 0.45) => Math.round(10 * (species === 'tussock' ? lo + span * u : (TU.height_m || GRASS_H[species] || 1) * (0.7 + 0.45 * u)));
        for (const bed of TU.beds || []) for (const m of (LM && LM.meshes) || []) {
          if (m.name !== bed.mesh) continue;
          const p = m.position, ix = m.index;
          for (let i = 0; i + 2 < ix.length; i += 3) {
            const a = 3 * ix[i], b = 3 * ix[i + 1], c = 3 * ix[i + 2];
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], area = Math.abs(ux * vy - uy * vx) / 2;
            let n = area * (bed.per_m2 || 2);
            for (let j = 0; n > 0; j++, n--) {
              if (n < 1 && hsh(p[a] + j + seed, p[a + 1]) > n) break;
              let u = hsh(p[a] + j * 1.7 + seed, p[b] + i), v = hsh(p[c] - j * 2.3, p[a + 1] + i + seed);
              if (u + v > 1) { u = 1 - u; v = 1 - v; }
              const x = p[a] + ux * u + vx * v, y = p[a + 1] + uy * u + vy * v, z = p[a + 2] + (p[b + 2] - p[a + 2]) * u + (p[c + 2] - p[a + 2]) * v;
              pts.push(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10), hOf(hsh(x, y), 0.55, 0.35));
            }
          }
        }
        const opens = TU.open ? ((P.grass || {})[species] || []) : [];
        const SL = TU.slopes || (TU.places || opens.length ? {} : null);
        if (SL) {
          const Tg = D.Tfine || D.T, F = scene.frame, roads = D.streets && D.streets.roads, W = scene.woods;
          if (canopy === undefined) {
            canopy = null;
            if (woodsTex && woodsTex.image && W) {
              const cw = Math.ceil(W.nx / 4), ch = Math.ceil(W.ny / 4), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
              const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(woodsTex.image, 0, 0, cw, ch);
              const px = g.getImageData(0, 0, cw, ch).data, c8 = W.cell * 4;
              canopy = (x, y) => { const i = Math.floor((x - W.x0) / c8), j = Math.floor((W.y1 - y) / c8); return i >= 0 && j >= 0 && i < cw && j < ch && px[4 * (j * cw + i) + 1] > 0; };
            }
          }
          if (!lmHash) { lmHash = new Set(); for (const m of (LM && LM.meshes) || []) { const p = m.position; for (let i = 0; i < p.length; i += 9) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) lmHash.add((Math.floor(p[i] / 8) + a) * 100003 + Math.floor(p[i + 1] / 8) + b); } }
          const max = Math.round((TU.max || SL.max || 8000) * (small ? 0.35 : 1)), above = SL.above_m ?? 80;
          const cand = (x, y, k, low = false, shade = true) => {
            const z = S.terrainAt(Tg, x, y);
            if (!(low || z > above) || (shade && canopy && canopy(x, y)) || lmHash.has(Math.floor(x / 8) * 100003 + Math.floor(y / 8))) return;
            const sx = S.terrainAt(Tg, x + 2, y) - S.terrainAt(Tg, x - 2, y), sy = S.terrainAt(Tg, x, y + 2) - S.terrainAt(Tg, x, y - 2);
            if (Math.hypot(sx, sy) / 4 > (SL.slope_max || 1.1)) return; // (a bluff: rock)
            if (roads && roads.depth(x, y, null, low ? 2 : 25) > 0) return; // (in a park, just off its streets)
            if (IN && IN.water(x, y)) return;
            pts.push(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10), hOf(hsh(y, x + k)));
          };
          // near the places named, denser; then over the whole frame, each candidate on a jittered grid
          const grid = (x0, y0, x1, y1, per_ha, inside, low = false, shade = true) => {
            const step = 100 / Math.sqrt(per_ha);
            for (let y = y0; y < y1 && pts.length / 4 < max; y += step) for (let x = x0; x < x1 && pts.length / 4 < max; x += step) {
              const jx = x + (hsh(x + seed, y) - 0.5) * step, jy = y + (hsh(y, x + seed) - 0.5) * step;
              if (!inside || inside(jx, jy)) cand(jx, jy, step, low, shade);
            }
          };
          const over = (poly, per_ha, shade) => { // (an outline in decimetres, then its holes)
            const rings = poly.map(r => r.map(v => v / 10)), r = rings[0], xs = r.filter((_, i) => i % 2 === 0), ys = r.filter((_, i) => i % 2 === 1);
            grid(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), per_ha, (x, y) => inRing(r, x, y) && !rings.slice(1).some(h => inRing(h, x, y)), true, shade);
          };
          for (const pl of TU.places || []) for (const q of (P.places || []).filter(o => o.name === pl.name)) for (const poly of q.polygons || []) over(poly, pl.per_ha || 400, true);
          // (a river's sandbar or a bed is mapped as what grows there: the canopy over it is its own willows' and gums', not a
          // reason to leave the grass out)
          for (const o of opens) for (const poly of o.polygons || []) over(poly, o.per_ha || TU.per_ha || 1500, false);
          if (TU.slopes) {
            for (const [cx, cy, r, ph] of SL.near || []) grid(cx - r, cy - r, cx + r, cy + r, ph, (x, y) => Math.hypot(x - cx, y - cy) < r);
            grid(F.x[0], F.y[0], F.x[1], F.y[1], SL.per_ha || 20, (x, y) => !(SL.near || []).some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r));
          }
        }
        if (pts.length) { own.push({ from: TR.length / 4, to: (TR.length + pts.length) / 4, species, tint: TU.tint || null }); TR = TR.concat(pts); console.info(`${species}: ${pts.length / 4} planted`); }
      } catch (e) { console.warn(`${species}: none planted`, e); }
    });
    const nT = TR.length / 4;
    let trees = null;
    if (nT && window.OETrees) {
      try { trees = OETrees.create(world, await OETrees.load('assets/trees/'), TR, { mix: (scene.trees || {}).mix, woods: (scene.trees || {}).woods, areas: (scene.trees || {}).areas, south: D.CITY.lat < 0, lat: D.CITY.lat, cherry: (scene.trees || {}).cherry_open, measured: nMapped, keep: small ? 0.35 : 1, farKeep: window.OEQuality ? OEQuality.city().woods : 1, fixed: nFixed, own, night: U.uNight, foot: D.N, small }); }
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
      world.add(still(crowns), still(trunks));
    }

    // ------------------------------------------------------------ landmarks
    loadMsg('Building the landmarks', 0.65);
    await idle();
    const lmMats = {}, floodMats = {}, lmTex = {};
    // On a phone (quality.js lean) a landmark's decorative images — the big LED screens, signage atlases, plaques —
    // are drawn at most LEAN_CAP on a side (Shibuya's screens.webp is 2048, 21 MB; here 1024, 5), which the ground
    // aerial and the mask textures (shore, woods) keep clear of, since they are data read by the pixel. The picture
    // is drawn once at its own size then let go. A text sign stays legible: these are seen across a street, not read.
    const LEAN_CAP = (QW && QW.budget && QW.budget.deco) || 1024; // (512 on a phone that could not hold the game: quality.js leanLevel)
    const leanDown = tex => {
      if (!LEAN || !tex || !tex.image) return tex;
      const im = tex.image, side = Math.max(im.width || 0, im.height || 0);
      if (side <= LEAN_CAP) return tex;
      const k = LEAN_CAP / side, cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      tex.image = cv; tex.needsUpdate = true;
      tex.onUpdate = () => { cv.width = cv.height = 1; };
      return tex;
    };
    // an image the city's landmark_assets hook draws (signs, plaques, votive tablets), on texture coordinates 0..1
    const imageTex = f => lmTex[f] || (lmTex[f] = Object.assign(texLoader.load(D.DATA + f, leanDown),
      { colorSpace: THREE.SRGBColorSpace, anisotropy: renderer.capabilities.getMaxAnisotropy() }));
    // the tiled PBR surfaces a landmark material names (web/pbr.js): their sets' means, before the materials
    if (window.OEPbr && Object.values(LM.materials || {}).some(m => m.pbr)) await OEPbr.load();
    for (const [k, m] of Object.entries(LM.materials || {})) {
      lmMats[k] = new THREE.MeshStandardMaterial({ color: lin(m.color), roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide });
      if (m.pattern && PATTERNS[m.pattern]) PATTERNS[m.pattern](lmMats[k], m);
      // a bridge's deck, or paving ("street_lit"), under the street lights and the screens' glow
      // (and "lamp_lit": what stands in that light without being ground, a platform's doors and its canopy's posts)
      if ((m.pattern === 'deck_zones' || m.street_lit || m.lamp_lit) && NU) { const own = lmMats[k].onBeforeCompile; lmMats[k].onBeforeCompile = sh => { if (own) own(sh); streetLit(sh); }; }
      if (m.pattern === 'deck_zones' || m.street_lit) lmMats[k].userData.paving = true; // ground you walk on: it gets wet in the rain (weather.js)
      if (m.decal) Object.assign(lmMats[k], { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // laid over a roof: in front of it
      if (m.map) Object.assign(lmMats[k], { map: imageTex(m.map), alphaTest: m.cutout ? 0.5 : 0 }); // cutout: its clear pixels are holes
      if (m.opacity < 1) Object.assign(lmMats[k], { transparent: true, opacity: m.opacity, depthWrite: false }); // glass, nets
      // three.js caches a program by the text of onBeforeCompile, and wrappers (streetLit) read alike
      // across patterns: each patterned material keys its own
      if (lmMats[k].onBeforeCompile) lmMats[k].customProgramCacheKey = () => `lm|${k}`;
      // photographed asphalt, paving and worn road paint at eye level, in the game (surface.js)
      if (game && window.OESurface) OESurface.material(lmMats[k], OESurface.kindOf(m));
      if (m.pbr && window.OEPbr) OEPbr.apply(lmMats[k], m.pbr, { small, aniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
      if (m.interior && window.OEInterior) OEInterior.apply(lmMats[k], m.interior, { night: LM_NIGHT }); // rooms behind the glass (web/interior.js)
    }
    // meshes marked floodlit glow after dark; with emissive_map an image glows in its own colours (a screen, a lit sign)
    // (clone() drops onBeforeCompile and resets the defines, so the copy takes the pattern over explicitly)
    const floodlit = k => floodMats[k] || (floodMats[k] = Object.assign(lmMats[k].clone(), {
      emissive: lin(LM.materials[k].emissive || (LM.materials[k].emissive_map ? '#ffffff' : '#ffe2b8')), emissiveIntensity: 0,
      emissiveMap: LM.materials[k].emissive_map ? lmMats[k].map : null,
      userData: { glow: LM.materials[k].glow || 0.32, day: LM.materials[k].glow_day || 0 }, // (glow_day: lit by day too, as stained glass seen from inside is)
      onBeforeCompile: floodFrom(LM.materials[k].flood, lmMats[k].onBeforeCompile),
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
      return byText(m.sky != null && m.sky < 1 ? sheltered(base, (m.floodlit ? 'flood|' : '') + m.material, m.sky, m.bounce) : base);
    };
    const lmGeometry = m => {
      const p = m.position, arr = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { arr[i] = p[i]; arr[i + 1] = p[i + 2]; arr[i + 2] = -p[i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setIndex(Array.isArray(m.index) ? m.index : new THREE.BufferAttribute(new Uint32Array(m.index.buffer, m.index.byteOffset, m.index.length), 1)); // (typed: landmarks.bin)
      if (m.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.computeVertexNormals();
      return g;
    };
    // small things are drawn only within their "far" (metres): beyond it they are under a pixel
    const screenMeshes = []; // the big LED screens' faces, for the light they throw (neon.js)
    const farObjs = [], farAt = (o, c, r, far) => { o.userData.far = { c, r2: (far + r) * (far + r) }; farObjs.push(o); };
    for (const m of LM.meshes || []) {
      if (m.detail && small) continue; // (a hero level's finest parts, landmarks.json "detail": the high and medium tiers only)
      const g = lmGeometry(m);
      if (m.material === 'rail_steel' && lmMats.rail_steel) { railDirections(g); railGlint(lmMats.rail_steel); } // (the sun's glint along the rail)
      const mesh = new THREE.Mesh(g, lmMaterial(m));
      if (m.far) { g.computeBoundingSphere(); farAt(mesh, g.boundingSphere.center.clone(), g.boundingSphere.radius, m.far * (small ? 0.6 : 1)); } // (a room's furnishings: nearer on a small device)
      mesh.castShadow = mesh.receiveShadow = true;
      if (['railing', 'lattice'].includes((LM.materials[m.material] || {}).pattern)) mesh.castShadow = false; // a cut-out strip; its shadow would be solid
      if ((LM.materials[m.material] || {}).opacity < 1) mesh.castShadow = false;
      if ((LM.materials[m.material] || {}).decal) mesh.castShadow = false; // paving on the ground: nothing under it to shade
      if ((LM.materials[m.material] || {}).shadow === false) mesh.castShadow = false; // wire finer than a texel of the shadow map: its shadow would flicker as the map follows the view
      mesh.name = m.name;
      world.add(still(mesh)); // (a lift's car among them: the cache sees it move and draws it afresh)
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
        const im = new THREE.InstancedMesh(lmGeometry(part), lmMaterial(part), pr.at.length); // (sheltered, as a mesh is: a hall's seats in the dark)
        pr.at.forEach((a, i) => {
          imP.set(a[0], a[2], -a[1]); imQ.setFromAxisAngle(UP, a[3]); imS.set(a[4] || 1, 1, a[4] || 1);
          im.setMatrixAt(i, im4.compose(imP, imQ, imS));
        });
        im.computeBoundingSphere();
        im.castShadow = im.receiveShadow = true;
        im.name = `${pr.name}_${part.name}`;
        farAt(im, c, r + 10, pr.far || 600);
        OEBuildings.cellInstances(im);
        im.userData.noRefl = true; // (street furniture: out of the sea's reflection, water.js)
        world.add(still(im));
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
    // the street lights, the chochin and the bonbori in the inland water after dark (inland.js glints): built
    // again when the game stands the lanterns on its own ground
    let glints = null, glintPlaced = -1;
    const buildGlints = () => {
      const Ls = trees && trees.lanterns ? trees.lanterns() : null, groups = [];
      if (night && night.heads) { const h = night.heads(); groups.push({ pos: h.pos, colour: i => h.colour[i].clone().multiplyScalar(h.bright[i]), gain: 2.0 }); }
      if (Ls && Ls.chochin) groups.push({ pos: Ls.heads.chochin.subarray(0, 3 * Ls.chochin), colour: new THREE.Color(1.0, 0.42, 0.5), gain: 3.5 });
      if (Ls && Ls.bonbori) groups.push({ pos: Ls.heads.bonbori.subarray(0, 3 * Ls.bonbori), colour: new THREE.Color(1.0, 0.6, 0.3), gain: 2.5 });
      if (glints) { world.remove(glints.mesh); glints.dispose(); }
      glints = groups.length ? IN.glints(groups) : null;
      if (glints) { glints.groups = groups.length; glints.hasCh = !!(Ls && Ls.chochin); glints.hasBon = !!(Ls && Ls.bonbori); world.add(glints.mesh); }
      glintPlaced = Ls ? Ls.placed : 0;
    };
    const updateGlints = () => {
      const Ls = trees && trees.lanterns ? trees.lanterns() : null;
      if (Ls && Ls.placed !== glintPlaced) buildGlints();
      if (!glints) return;
      let g = 0;
      if (night && night.heads) glints.set(g++, night.on());
      if (glints.hasCh) glints.set(g++, Ls.lit.chochin);
      if (glints.hasBon) glints.set(g++, Ls.lit.bonbori);
    };
    if (IN && inland) try { buildGlints(); if (glints) console.info(`inland water: ${glints.count} lights reflected`); } catch (e) { console.warn('inland water: no reflections', e); glints = null; }

    // ------------------------------------------------------------ sun
    const warm = new THREE.Color('#ffb070'), noonC = new THREE.Color('#fff3e0');
    const shX = new THREE.Vector3(), shY = new THREE.Vector3(), shAt = new THREE.Vector3(), shTmp = new THREE.Vector3(), shZ = new THREE.Vector3();
    let shR = 0;
    // The haze at the model's edge in the colour of the sky at the horizon (away from the sun's
    // glare: a few pixels of the sky, hazeOf below), and the sky's last few degrees above the
    // horizon in that haze: the city fades into the sky instead of ending in a grey band. Only
    // where the fog is mixed in linear light before the tone curve (the game's post stack sets
    // skyHaze); the viewer fogs after it and keeps its fixed colours.
    let hazeRT = null, hazeOk = false, fogBase = null, hazeKey = null;
    const hazeCam = new THREE.PerspectiveCamera(8, 1, 0.1, 100), hazeC = new THREE.Color(), hazePx = new Float32Array(48);
    const hazeTarget = () => hazeRT || (hazeRT = new THREE.WebGLRenderTarget(6, 2, { type: THREE.FloatType }));
    // the sky's program as the light from the sky (PMREM) draws it, with no lights and into a target, compiled now,
    // off the frame, rather than by the first new sky in the middle of the game's set-up (issue 299), where it would
    // also wait behind the city's shaders compiling then (issue 327)
    const skyReady = renderer.capabilities.isWebGL2 ? compile(renderer, envScene, hazeCam, { target: hazeTarget(), shadows: false }) : Promise.resolve();
    // The pixels hazeOf works out, drawn and read back from the GPU (synchronously: it waits for the GPU's queue): only
    // for tools/haze_check.js (api.hazeProbe), which holds the CPU's sum to this one. The three views side by side in
    // one target. Returns the colour, or null.
    function readHaze(az) {
      try {
        const rt = hazeTarget(), prev = renderer.getRenderTarget(), on = su.uHazeOn.value, el = 1.5 * RAD;
        su.uHazeOn.value = 0;
        // (the haze is the clear sky's horizon: the clouds are left out of it, as hazeOf leaves them out)
        const cov = su.cloudCoverage ? su.cloudCoverage.value : 0, ck = cloudsOn ? su.uCloudK.value.clone() : null;
        if (cloudsOn) { su.cloudCoverage.value = 0; su.uCloudK.value.x = su.uCloudK.value.y = 0; }
        rt.scissorTest = true;
        [0.5, 1, 1.5].forEach((turn, i) => { // across from the sun and on either side
          const a = az + turn * Math.PI;
          hazeCam.lookAt(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el));
          rt.viewport.set(2 * i, 0, 2, 2); rt.scissor.set(2 * i, 0, 2, 2);
          renderer.setRenderTarget(rt);
          renderer.render(envScene, hazeCam);
        });
        rt.scissorTest = false; rt.viewport.set(0, 0, 6, 2); rt.scissor.set(0, 0, 6, 2);
        renderer.setRenderTarget(prev);
        su.uHazeOn.value = on;
        if (cloudsOn) { su.cloudCoverage.value = cov; su.uCloudK.value.copy(ck); }
        renderer.readRenderTargetPixels(rt, 0, 0, 6, 2, hazePx);
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < 48; i += 4) { r += hazePx[i]; g += hazePx[i + 1]; b += hazePx[i + 2]; }
        return r + g + b > 0 && isFinite(r + g + b) ? new THREE.Color(r / 12, g / 12, b / 12) : null;
      } catch (e) { return null; }
    }
    // The same haze worked out on the CPU (issue 327): the sky's shader (three.js's Sky, r186, with the changes made
    // to it above) evaluated for the twelve pixels readHaze reads, from the uniforms as they stand. Nothing is read back
    // from the GPU, so a new hour never waits for the GPU's queue: a synchronous read did, for every shader and upload
    // queued before it (5 s of Kyoto's build on a software renderer), and an asynchronous one only moved that wait to
    // its getBufferSubData. tools/haze_check.js holds it to the GPU's read (hazeProbe).
    const hazeOf = (() => {
      const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5], MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
      const fract = x => x - Math.floor(x), mix = (a, b, t) => a + (b - a) * t, cl = (x, a, b) => Math.min(b, Math.max(a, x));
      const sstep = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
      const grad = (ix, iy) => { // Sky.js gradient(): its sinless hash
        let p0 = fract(ix * 0.1031), p1 = fract(iy * 0.1030), p2 = fract(ix * 0.0973);
        const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33); p0 += d; p1 += d; p2 += d;
        return [fract((p0 + p1) * p2) * 2 - 1, fract((p0 + p2) * p1) * 2 - 1];
      };
      const noise = (x, y) => {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        const dg = (gx, gy, ox, oy) => { const g = grad(ix + gx, iy + gy); return g[0] * (fx - ox) + g[1] * (fy - oy); };
        return mix(mix(dg(0, 0, 0, 0), dg(1, 0, 1, 0), ux), mix(dg(0, 1, 0, 1), dg(1, 1, 1, 1), ux), uy) * 1.6;
      };
      const fbm = (x, y, drift) => { let r = 0, a = 1; for (let i = 0; i < 4; i++) { r += a * noise(x, y); a *= 0.5; x = x * 2 + drift; y = y * 2 + drift; } return r; };
      const val = (k, d = 0) => (su[k] ? su[k].value : d);
      // the colour of the sky in the unit direction (dx, dy, dz), as the shader draws it with uHazeOn 0
      function skyAt(dx, dy, dz, U_) {
        const { sd, sunE, fade, bR, bM } = U_;
        const zen = Math.acos(Math.max(0, dy)), inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / Math.PI, -1.253));
        const sR = 8.4e3 * inv, sM = 1.25e3 * inv, cosT = dx * sd[0] + dy * sd[1] + dz * sd[2];
        const rP = 0.05968310365946075 * (1 + (cosT * 0.5 + 0.5) ** 2), g = U_.g, g2 = g * g;
        const mP = 0.07957747154594767 * (1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5);
        const disc = cl((cosT - 0.999956676946448443553574619906976478926848692873900859324) * 50000, 0, 1) * U_.disc;
        const lo = cl(Math.pow(1 - sd[1], 5), 0, 1), out = [0, 0, 0], Fex = [0, 0, 0], Lin = [0, 0, 0], L0 = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          Fex[c] = Math.exp(-(bR[c] * sR + bM[c] * sM));
          const ph = (bR[c] * rP + bM[c] * mP) / (bR[c] + bM[c]);
          Lin[c] = Math.pow(sunE * ph * (1 - Fex[c]), 1.5) * mix(1, Math.pow(sunE * ph * Fex[c], 0.5), lo);
          L0[c] = 0.1 * Fex[c] + sunE * 19000 * Fex[c] * disc;
          out[c] = (Lin[c] + L0[c]) * 0.04 + [0, 0.0003, 0.00075][c];
        }
        if (dy > 0 && U_.cov > 0) { // the clouds
          const elev = mix(1, 0.1, U_.cElev), ux = dx / (dy * elev) * U_.cScale + U_.time * U_.cSpeed, uy = dz / (dy * elev) * U_.cScale + U_.time * U_.cSpeed;
          const cn = cl(fbm(ux * 1000, uy * 1000, U_.time * U_.cSpeed * 300) * 0.7 + 0.5, 0, 1), region = noise(ux * 300, uy * 300) * 0.37 + 0.5;
          const cov = cl(U_.cov + (region - 0.5) * 0.6, 0, 1), th = 1 - cov, hf = sstep(0, 0.03 + 0.06 * U_.cElev, dy);
          const mask = sstep(th, th + 0.3, cn) * hf, dayF = sstep(-0.08, 0.3, sd[1]), depth = Math.max(0, cn - th), beer = Math.exp(depth * -4);
          const shade = mix(0.45, 1, cl(beer * (1 - beer * beer) * 2.6, 0, 1)), silver = cl(0.51 / Math.pow(1.49 - cosT * 1.4, 1.5), 0, 3), edge = mask * (1 - mask) * 4;
          const alpha = (1 - Math.exp(depth * U_.cDensity * -12)) * hf;
          for (let c = 0; c < 3; c++) {
            const sunC = sunE * Fex[c] * 0.22 * 0.04, amb = Lin[c] * 0.04 + [0, 0.0003, 0.00075][c];
            const cloud = (amb + sunC * shade + sunC * silver * edge * 0.6) * Math.max(dayF, 0.03);
            out[c] -= L0[c] * 0.04 * alpha;
            out[c] = mix(out[c], mix(out[c], cloud, Fex[c]), alpha);
          }
        }
        // the changes made to the shader above: the tone curve and twilight, the saturation, golden hour, the night
        const k = 1 / (1.2 + 1.2 * fade), tw = U_.tw, twK = 0.45 + 0.55 * Math.pow(1 - Math.max(dy, 0), 2);
        for (let c = 0; c < 3; c++) out[c] = Math.pow(out[c], k) + tw[c] * twK;
        const lum = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        let L = lum(out);
        for (let c = 0; c < 3; c++) out[c] = Math.max(mix(L, out[c], U_.sat), 0);
        if (U_.gold) {
          L = lum(out);
          const hl = Math.hypot(dx, dz) || 1e-4, sl = Math.hypot(sd[0], sd[2]) || 1e-4, dot = (dx * sd[0] + dz * sd[2]) / (Math.max(hl, 1e-4) * Math.max(sl, 1e-4));
          const gTo = cl(0.5 + 0.5 * dot, 0, 1) ** 2, gLow = 1 - sstep(0, 0.5, Math.max(dy, 0)), gBand = 1 - sstep(0, 0.12, Math.max(dy, 0));
          const hue = [0, 1, 2].map(c => mix(mix(mix(U_.cool[c], U_.cream[c], 0.9 * gBand), U_.belt[c], U_.beltK * gLow * gLow * (1 - gTo)), U_.warm[c], gTo * mix(0.25, 1, gLow * gLow)));
          const hL = lum(hue);
          for (let c = 0; c < 3; c++) out[c] = mix(out[c], hue[c] / hL * L, U_.gold);
        }
        if (U_.night) {
          const t = Math.pow(cl(dy, 0, 1), 0.6);
          for (let c = 0; c < 3; c++) out[c] = mix(out[c], mix(U_.nh[c], U_.nz[c], t), U_.night);
        }
        return out;
      }
      const state = () => {
        const sp = su.sunPosition.value, sl = Math.hypot(sp.x, sp.y, sp.z) || 1, sd = [sp.x / sl, sp.y / sl, sp.z / sl];
        const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(cl(sd[1], -1, 1))) / 1.5)));
        const fade = 1 - cl(1 - Math.exp(sp.y / 450000), 0, 1), rc = val('rayleigh', 1) - (1 - fade);
        const mieK = 0.434 * (0.2 * val('turbidity', 2) * 10e-18) * val('mieCoefficient', 0.005);
        const arr = v => (v ? [v.r, v.g, v.b] : [0, 0, 0]);
        const U_ = { sd, sunE, fade, bR: TR.map(t => t * rc), bM: MIE.map(m => m * mieK), g: val('mieDirectionalG', 0.8), disc: val('showSunDisc', 1),
          cov: cloudsOn ? 0 : val('cloudCoverage', 0), cElev: val('cloudElevation', 0.5), cScale: val('cloudScale', 0.0002), cSpeed: val('cloudSpeed', 0.00002), cDensity: val('cloudDensity', 0.4), time: val('time', 0),
          tw: arr(su.twilight.value), sat: val('uSkySat', 1), gold: val('uGold', 0), beltK: val('uGoldBeltK', 0), warm: arr(su.uGoldWarm.value), cool: arr(su.uGoldCool.value),
          cream: arr(su.uGoldCream.value), belt: arr(su.uGoldBelt.value), night: val('uNightSky', 0), nz: arr(su.uNightZenith.value), nh: arr(su.uNightHorizon.value) };
        return U_;
      };
      const haze = az => {
        const U_ = state();
        // readHaze's three views (8° wide, 1.5° up; across from the sun and on either side), 2 x 2 pixels each, at
        // their pixels' centres
        const el = 1.5 * RAD, t = Math.tan(4 * RAD) * 0.5, sum = [0, 0, 0];
        for (const turn of [0.5, 1, 1.5]) {
          const a = az + turn * Math.PI, f = [Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)];
          const rl = Math.hypot(f[2], f[0]), r = [-f[2] / rl, 0, f[0] / rl]; // right = forward x up
          const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const d = [0, 1, 2].map(c => f[c] + sx * t * r[c] + sy * t * u[c]), dl = Math.hypot(...d);
            const col = skyAt(d[0] / dl, d[1] / dl, d[2] / dl, U_);
            for (let c = 0; c < 3; c++) sum[c] += col[c];
          }
        }
        const r = sum[0] / 12, g = sum[1] / 12, b = sum[2] / 12;
        return r + g + b > 0 && isFinite(r + g + b) ? hazeC.setRGB(r, g, b) : null;
      };
      // the clear sky's colour in a unit direction as the dome draws it now, for what is keyed to the sky (the clouds' colours)
      haze.sky = (dx, dy, dz) => skyAt(dx, dy, dz, state());
      return haze;
    })();
    // the water closes over the bottom under what is drawn over it: the aerial photograph has the same
    // bridge or expressway on the riverbed, and the shallow water of a river shows it through (the
    // Nihonbashi River under the Shuto, issues 65 and 234). The landmarks' up-facing faces over the
    // ground are drawn into a mask (a little wider than each face, more so the higher it stands: an aerial
    // photograph leans a raised deck off its plan); on land the terrain covers the water either way.
    // The game adds its own decks (game.js: waterCover(runs)). Where to look: water.js uCover
    let coverBase = null;
    function waterCover(runs = []) {
      if (!sea || !sea.setCover) return;
      const fr = scene.frame, x0 = fr.x[0], x1 = fr.x[1], y0 = fr.y[0], y1 = fr.y[1];
      const res = Math.max(1, Math.max(x1 - x0, y1 - y0) / Math.min(4096, renderer.capabilities.maxTextureSize)), W = Math.ceil((x1 - x0) / res), H = Math.ceil((y1 - y0) / res);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
      let any = false;
      if (!coverBase) { // [x0, y0, x1, y1, x2, y2, pad] in metres, once
        coverBase = [];
        for (const m of (LM && LM.meshes) || []) {
          const p = m.position, ix = m.index;
          if (!p || !ix || LM.materials[m.material] && LM.materials[m.material].opacity < 1) continue;
          for (let i = 0; i + 2 < ix.length; i += 3) {
            const a = 3 * ix[i], b = 3 * ix[i + 1], c = 3 * ix[i + 2];
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
            if (!(nl > 0) || Math.abs(nz) < 0.7 * nl) continue; // a deck's or a roof's face, not a wall
            const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
            const zt = Math.max(p[a + 2], p[b + 2], p[c + 2]), zg = D.ground((ax + bx + cx) / 3, (ay + by + cy) / 3);
            if (zt - zg < 1 || zt - zg > 40) continue; // over the water, low enough to lean into the photo of the bottom
            coverBase.push(ax, ay, bx, by, cx, cy, Math.max(2.5, 0.25 * (zt - zg)));
          }
        }
      }
      const X = x => (x - x0) / res, Y = y => (y1 - y) / res;
      for (const ring of (LM && LM.water_cover) || []) { // a deck the photograph shows wider than it is drawn (landmarks.json)
        g.beginPath(); ring.forEach(([x, y], k) => g[k ? 'lineTo' : 'moveTo'](X(x), Y(y))); g.closePath(); g.fill(); any = true;
      }
      for (let i = 0; i < coverBase.length; i += 7) {
        const q = coverBase;
        g.lineWidth = 2 * q[i + 6] / res;
        g.beginPath(); g.moveTo(X(q[i]), Y(q[i + 1])); g.lineTo(X(q[i + 2]), Y(q[i + 3])); g.lineTo(X(q[i + 4]), Y(q[i + 5])); g.closePath();
        g.fill(); g.stroke(); any = true;
      }
      for (const r of runs) {
        const hi = Math.max(...r.pts.map(q => q[2]));
        g.lineWidth = (r.w + 2 * Math.max(2.5, 0.25 * hi)) / res;
        g.beginPath();
        r.pts.forEach((q, k) => g[k ? 'lineTo' : 'moveTo'](X(q[0]), Y(q[1])));
        g.stroke(); any = true;
      }
      if (!any) return;
      g.filter = 'blur(2px)'; g.drawImage(cv, 0, 0); // a soft edge, not a cut line in the water
      const tex = new THREE.CanvasTexture(cv);
      tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.NoColorSpace;
      tex.format = THREE.RedFormat; // a mask the water reads one channel of: a byte a texel, not four (40 MB to 10 at 2560 x 4096; at most 2048 a side on the low tier)
      if (LEAN) tex.onUpdate = () => { tex.onUpdate = null; cv.width = cv.height = 0; }; // a phone: the GPU has it, the canvas's pixels go (a lost context reloads the view there: gpuOnly)
      if (sea.uniforms && sea.uniforms.uCover.value) sea.uniforms.uCover.value.dispose();
      sea.setCover(tex, x0, y1, x1 - x0, y1 - y0);
    }
    if (!game) try { waterCover(); } catch (e) { console.warn('water cover:', e); }
    // The map round the player (issue 443; docs/PERFORMANCE.md, "A map built round the player"): what is built,
    // unpacked and uploaded follows x, y. The game calls it every second and when it moves the player. Resolves when
    // what it changed is in (null: nothing to change)
    const mapAt = (x, y, now = false) => { groundKeep(x, y, now); return BLD.stream ? BLD.stream.near(x, y, now ? 1 : undefined) : null; };
    const api = {
      // the screens' faces and their programmes' clock, hour and night (neon.js lights the street from them)
      screens: { meshes: screenMeshes, clock: SCREEN, night: LM_NIGHT },
      world, sky, su, sunLight, shCam, hemi, pmrem, far, outposts, groundMeshes, skyLit, skyVis: SKYVIS, farSun: FARSUN ? farSun : null, groundPictures: pics, quayMeshes, quays: Q, inland, inlandWater: IN, inlandGlints: () => glints, gradePhoto, streetLit, tileGeometry, groundMesh, water, waterMat, sea, waterCover, trees, buildings, bGeo, gpuOnly, groundKeep, mapAt, mapStream: BLD.stream, U, SRC, extrude, bColour, floodMats, lmMats, night,
      skyReady, // (its program compiled and checked: the game's shaders start compiling after it, game.js earlyWarm)
      hazeProbe: { cpu: az => { const c = hazeOf(az); return c && c.clone(); }, gpu: readHaze }, // (tools/haze_check.js)
      sunDir: new THREE.Vector3(0, 1, 0), day: 1, shadowStill, still, edgeFade, // the width of the haze at the model's edge, metres (edgeHaze)
      // light the scene for a sun position {altitude, azimuth} and, for lit windows, the local
      // clock time in minutes; returns the daylight factor 0..1
      setSun(sp, minutes) {
        api.lastSun = { sp: Object.assign({}, sp), minutes };
        const alt = sp.altitude * RAD, az = sp.azimuth * RAD;
        api.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
        su.sunPosition.value.copy(api.sunDir);
        if (FARSUN) farSun.update(api.sunDir);
        const day = smooth(-5, 8, sp.altitude);
        api.day = day;
        // below the horizon the sun is dark (its intensity is 0 from -0.5°) and its shadow map is not redrawn,
        // but it stays a light: hiding it took a light out of every lit material's shader, so sunset, sunrise
        // and a jump in the clock across either recompiled the whole city
        sunLight.shadow.autoUpdate = sp.altitude > -0.5;
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
        hemi.groundColor.setHex(0x4d463a);
        if (BOUNCE) { BOUNCE.uBounceSun.value = sp.altitude * Math.PI / 180; BOUNCE.uBounceK.value = smooth(-1, 6, sp.altitude); }
        if (api.shadeLight) api.shadeLight(hemi, sunLight, day); // a region's look: the shade's colour, the ground's bounce (game/atmosphere.js)
        U.uNight.value = 1 - smooth(-7, 2, sp.altitude);
        if (far) far.setNight(U.uNight.value);
        if (outposts && outposts.userData.setNight) outposts.userData.setNight(U.uNight.value); // (a landing's lit windows, outposts.js)
        // The sky after dark as night photographs of a city show it: a deep blue overhead and, low
        // down, the glow its lights put in the air, which the haze at the model's edge takes too.
        // (The sky's own curve lifts a night sky to a grey tenth of the day's, which lit every glass
        // tower like an overcast evening.) Glass reflects both: blue above, warm below. With the
        // street lights drawn (night.js) the lamps do the lighting.
        su.uNightSky.value = night ? smooth(0.3, 1, U.uNight.value) : 0;
        if (night && night.skyglow) su.uNightHorizon.value.copy(night.skyglow).multiplyScalar(2.2);
        // without a clock, guess the hour from the sun: midday, else evening in the west and small hours in the east
        U.uHour.value = minutes != null ? minutes / 60 : sp.altitude > 0 ? 12 : sp.azimuth > 180 ? 21 : 4;
        for (const m of Object.values(floodMats)) m.emissiveIntensity = m.userData.glow * U.uNight.value + m.userData.day * (1 - U.uNight.value);
        LM_NIGHT.value = U.uNight.value;
        SCREEN.hour.value = U.uHour.value;
        SPARKLE.on.value = U.uNight.value > 0.6 && minutes != null && ((minutes % 60) + 60) % 60 < 5 ? 1 : 0;
        renderer.toneMappingExposure = 0.55 + 0.35 * (1 - day);
        // the haze first, then the light from the sky: the environment is drawn with the horizon's
        // haze in it, so it has to be this hour's haze (it kept the last one, a day's haze at night).
        // api.envEvery (ms) allows one new sky at most that often: a sun easing between two hours
        // would otherwise rebuild it nearly every frame. The one held back waits for tick.
        const key = `${Math.round(sp.altitude / 2)}|${Math.round(sp.azimuth / 6)}`, now = performance.now();
        let newSky = key !== envKey && now - envAt >= (api.envEvery || 0);
        // the haze for this sky, worked out at once (hazeOf), so the sky is made with its own haze
        if (newSky && api.skyHaze && hazeKey !== key) {
          hazeOk = !!hazeOf(az); hazeKey = key;
        }
        envWait = key !== envKey && !newSky ? { sp: Object.assign({}, sp), minutes } : null;
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
        // the clouds' colours for this hour, keyed to the sky's own zenith and its horizon across from the sun (the game's
        // atmosphere sets api.cloudLight; clouds.js light), before the light from the sky is taken from the dome
        if (cloudsOn && api.cloudLight) {
          const ca = az + Math.PI * 0.5, ce = 5 * RAD;
          api.skyRef = { zen: hazeOf.sky(0, 1, 0), hor: hazeOf.sky(Math.sin(ca) * Math.cos(ce), Math.sin(ce), -Math.cos(ca) * Math.cos(ce)) };
          api.cloudLight(sp.altitude, api.skyRef);
        }
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
      // The sun's shadow map's size, for the frame-time governor's ladder (quality.js, game.js; issue 375): no larger
      // than the tier's (SHADOW), no smaller than 1024. The map and the still casters' cache keep their objects and
      // are made again at the new size at the next shadow pass; the box's texel snapping follows mapSize.
      get shadowSize() { return sunLight.shadow.mapSize.x; },
      setShadowSize(n) {
        n = Math.max(1024, Math.min(SHADOW, n | 0));
        if (n === sunLight.shadow.mapSize.x) return n;
        sunLight.shadow.mapSize.set(n, n);
        if (sunLight.shadow.map) sunLight.shadow.map.setSize(n, n);
        if (shadowStill && shadowStill.resize) shadowStill.resize(n);
        shR = -1; // (the box is placed again on its new texel grid)
        renderer.shadowMap.needsUpdate = true;
        return n;
      },
      fitShadow(target, half) {
        // with the cache (shadowCache) the box keeps 5% more room than asked, and holds still while the view
        // moves within that room and the sun has not stepped: a box that slides a texel follows a walker
        // every few frames, and each slide would draw the still casters again
        const room = shadowStill ? 1.05 : 1, need = half * room, cur = shCam.right;
        if (!(need <= cur && need > cur / 1.3)) {
          const q = Math.pow(1.1, Math.ceil(Math.log(need) / Math.log(1.1) - 1e-9));
          shCam.left = -q; shCam.right = q; shCam.top = q; shCam.bottom = -q; shCam.updateProjectionMatrix();
        }
        if (FARSUN) FARSUN.uSunBox.value.set(target.x, target.z, FARSUN_Q === 'all' ? 0 : shCam.right, FARSUN.uSunBox.value.w);
        const texel = 2 * shCam.right / sunLight.shadow.mapSize.x, z = api.sunDir;
        shX.set(z.z, 0, -z.x); // up × z, the shadow camera's x axis
        const l = shX.length();
        if (l > 1e-6) {
          shX.divideScalar(l);
          shY.crossVectors(z, shX);
          const snap = v => Math.round(v / texel) * texel, slack = shCam.right - half, d = shTmp.copy(target).sub(shAt);
          if (shadowStill && shZ.equals(z) && shR === shCam.right && Math.abs(d.dot(shX)) <= slack && Math.abs(d.dot(shY)) <= slack && Math.abs(d.dot(z)) < 300) return;
          shAt.copy(z).multiplyScalar(target.dot(z)).addScaledVector(shX, snap(target.dot(shX))).addScaledVector(shY, snap(target.dot(shY)));
        } else shAt.copy(target);
        shZ.copy(z); shR = shCam.right;
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
        if (sea && camera) sea.update(t, camera, world, seaInView(camera, t)); else waterMat.normalMap.offset.set(t * 0.000004, t * 0.0000025);
        if (trees && camera) trees.update(camera, t / 1000);
        if (night && camera) night.update(camera, t / 1000);
        if (glints || (IN && inland && trees)) try { updateGlints(); } catch (e) { glints = null; }
      },
      // after a lost WebGL context comes back (glcare.js): three.js has its state again, but a
      // render target comes back empty, so the sky's light (the PMREM target) and the haze read
      // from the sky are made again, and the shadow map redrawn. The water's FFT and wakes and
      // the post stack's targets are drawn afresh every frame.
      restoreGPU() {
        envKey = ''; envAt = -1e9; envWait = null; hazeOk = false; hazeKey = null;
        if (api.lastSun) api.setSun(api.lastSun.sp, api.lastSun.minutes);
        renderer.shadowMap.needsUpdate = true;
      },
      dispose() { if (farSun.dispose) farSun.dispose(); if (envRT) envRT.dispose(); if (hazeRT) hazeRT.dispose(); pmrem.dispose(); if (sea) sea.dispose(); if (night) night.dispose(); if (far) far.dispose(); },
    };
    if (trees && trees.shadowSun) trees.shadowSun(() => api.sunDir);
    const farTrees = trees && trees.bakeFar && new URLSearchParams(location.search).get('impostors') !== 'off' ? trees.bakeFar(renderer) : null;
    api.ready = Promise.resolve(farTrees); // (what the first draw waits for besides the shaders: the far trees' atlas, trees.js)
    return api;
  }

  // Compile the shaders an object will draw with, before it is drawn, as asynchronously as the GPU allows
  // (KHR_parallel_shader_compile): for the scene behind the loader, and for anything that comes later (a
  // model fetched once the game is open). target is the render target the scene is drawn into (the post
  // stack's), which picks the shaders' variant: drawn into a target, three.js leaves the tone curve and
  // the sRGB encoding to the last pass, so a compile with none bound made the variant for the screen,
  // which the post stack never draws with (half the programs the loader waited for were of that kind).
  // scene: whose lights and fog they are lit with. Resolves when they are ready (at once without WebGL 2).
  // A landmark material keys its program by name (lm|<material>), since three.js would otherwise key it by
  // the text of its onBeforeCompile, and wrappers read alike across patterns; but most of them write the
  // very same shader (a plain colour under the street lights, or a pattern whose values are uniforms), and
  // each name was a program of its own: 128 programs for 42 shaders in Sydney (issue 259). byText keys
  // the program by the text the material's onBeforeCompile chain writes instead, run once on three.js's
  // own shader, so materials that differ only in uniforms share one program. Whatever wraps the material
  // later (the weather, the mirror) adds its own part to the key, as it did; the text is read again when
  // the chain changes.
  const textOf = new WeakMap(), byTextSet = new WeakSet();
  const fnv = (h, str) => { for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
  function byText(mat) {
    if (!mat || byTextSet.has(mat) || !mat.onBeforeCompile || !mat.isMeshStandardMaterial) return mat;
    byTextSet.add(mat);
    const own = mat.customProgramCacheKey;
    mat.customProgramCacheKey = function () {
      const fn = this.onBeforeCompile, inner = own ? own.call(this) : '', memo = textOf.get(this);
      if (memo && memo[0] === fn && memo[1] === inner) return memo[2];
      let key = inner;
      try {
        const lib = THREE.ShaderLib.physical; // (MeshStandardMaterial's, and MeshPhysicalMaterial's)
        const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms), defines: Object.assign({}, this.defines) };
        fn.call(this, sh, null);
        const text = `${sh.vertexShader}\n//\n${sh.fragmentShader}\n//${JSON.stringify(sh.defines)}`;
        key = `lmtext|${text.length}|${fnv(2166136261, text).toString(36)}|${fnv(84696351, text).toString(36)}`;
      } catch (e) { /* (keyed by name, as before) */ }
      textOf.set(this, [fn, inner, key]);
      return key;
    };
    return mat;
  }

  // A big object (the city behind the loader: hundreds of materials) is compiled in slices of about
  // SLICE_MS, object by object, yielding between them (issue 259): three.js's compileAsync creates every
  // program in one call, which on a software renderer, or a phone without parallel compiles, was one task
  // of 10 to 25 seconds. The caller holds its draws until this resolves, since a draw would compile the
  // rest in one frame again.
  const SLICE_MS = 50, SLICED = 40, FLIGHT = 6;
  // clip: the clipping planes it is drawn with (a mirror's), which also pick the variant. behind: it
  // compiles while the scene is on screen (behind the title), a short slice a frame, so frames keep coming.
  // hold: while it returns true, a compile behind the scene waits (a frame at a time) without compiling: a slice
  // can be no shorter than one program, which on a device without parallel compiles is a hitch of its own, so
  // the game holds the warm-up through its opening shot and its rides (issue 265)
  // shadows: the shadow pass's variant of each shadow caster too (the sun's depth program for its
  // material, skinned for a person, double-sided for a sail), which three.js otherwise compiles in the first
  // frame that draws the caster's shadow (issue 266); not for a mirror's or other pass that draws no shadows.
  // flight: how many programs may be compiling at once (FLIGHT); fewer behind other work, whose own synchronous GL calls
  // wait for every program queued before them on a GPU that compiles one at a time (issue 327)
  function compile(renderer, obj, camera, { scene = obj, target = null, clip = null, behind = false, hold = null, shadows = !clip, flight = FLIGHT } = {}) {
    if (!renderer.compileAsync) return Promise.resolve();
    const objs = [], casters = [];
    obj.traverse(o => {
      if (!((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material)) return;
      objs.push(o);
      if (shadows && o.castShadow && !o.isSprite) casters.push(o);
    });
    if (!(renderer.shadowMap && renderer.shadowMap.enabled && THREE.MeshDepthMaterial)) casters.length = 0;
    // the render target and the clipping planes, set for a compile and put back after it
    const bind = () => { const was = [renderer.getRenderTarget(), renderer.clippingPlanes]; renderer.setRenderTarget(target); if (clip) renderer.clippingPlanes = clip; return was; };
    const unbind = ([t, c]) => { renderer.setRenderTarget(t); renderer.clippingPlanes = c; };
    if (objs.length < SLICED) {
      const was = bind();
      let depth = [];
      try {
        return renderer.compileAsync(obj, camera, scene) // (compiles now; the promise waits on the GPU)
          .then(() => { const ms = new Set(depth); for (const o of objs) for (const m of [].concat(o.material)) ms.add(m); firstUse(renderer, ms); }).catch(() => {});
      } catch (e) { return Promise.resolve(); }
      finally { unbind(was); if (casters.length) depth = compileDepth(renderer, casters, camera, scene); }
    }
    return (async () => {
      const props = renderer.properties, mats = new Set(), t0 = performance.now(), flying = new Set();
      const inFlight = () => { for (const p of flying) if (p.isReady()) flying.delete(p); return flying.size; };
      let slices = 0, longest = 0;
      const n = objs.length + casters.length;
      for (let i = 0; i < n;) {
        while (behind && hold && hold()) await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const s0 = performance.now(), was = bind();
        try {
          // (every object, even one whose material has a program: this variant, for this target and
          // these planes, may be new. One that is not costs a lookup; an object's children are in the
          // list on their own, so they are looked up again, cheaply. Then the casters' shadow variants)
          // (and no more than FLIGHT programs still being compiled at a time: the next shader's source otherwise waits
          // in the call that sends it until the GPU has caught up, a stall of seconds on a software renderer or a
          // device that compiles one at a time, issue 299; the slice ends and the next one waits for them instead)
          while (i < n && performance.now() - s0 < (behind ? SLICE_MS / 2 : SLICE_MS) && inFlight() < flight) {
            const add = m => { mats.add(m); const p = props.get(m).currentProgram; if (p && p.isReady && !p.isReady()) flying.add(p); };
            if (i < objs.length) for (const m of renderer.compile(objs[i++], camera, scene)) add(m);
            else { const j = i - objs.length, k = Math.min(casters.length, j + 24); for (const m of compileDepth(renderer, casters.slice(j, k), camera, scene)) add(m); i += k - j; }
          }
        } catch (e) { console.warn('compile', e); }
        finally { unbind(was); }
        slices++; longest = Math.max(longest, performance.now() - s0);
        if (i < n) await (behind ? new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))) : inFlight() >= flight ? new Promise(r => setTimeout(r, 10)) : idle());
      }
      // then wait for the GPU to finish them (KHR_parallel_shader_compile), as compileAsync does
      const all = new Set(mats);
      await new Promise(done => {
        const check = () => {
          for (const m of mats) { const p = props.get(m).currentProgram; if (!p || !p.isReady || p.isReady()) mats.delete(m); }
          if (mats.size) setTimeout(check, 10); else done();
        };
        check();
      });
      firstUse(renderer, all);
      console.info(`compile: ${objs.length} objects in ${slices} slices, the longest ${Math.round(longest)} ms, ready after ${Math.round(performance.now() - t0)} ms`);
    })().catch(e => console.warn('compile', e));
  }

  // A program's first use reads back its link status, info log, uniforms and attributes: synchronous
  // calls, each of which waits for the GPU to finish everything queued before it (Chromium runs GL in
  // another process). In the frame that first draws a model that is a stall of the whole frame's GPU
  // work, seconds on a software renderer (issue 266), and once per new program. Done here, once the
  // programs are ready, it is one wait in a task of its own, off the frame, for all of them at once.
  function firstUse(renderer, mats) {
    for (const m of mats) {
      const p = renderer.properties.get(m).currentProgram;
      try { if (p && p.getUniforms && (!p.isReady || p.isReady())) { p.getUniforms(); p.getAttributes(); } } catch (e) { /* read on its first draw instead */ }
    }
  }

  // The shadow pass's material for a caster's material, as WebGLShadowMap (r186) picks it: the caster's
  // customDepthMaterial or else a depth material, given the material's side flipped (its shadowSide where it
  // has one), its map, alpha map, alpha test and displacement. One per combination of what picks the
  // variant, here; three.js keeps one and clones it per material, which compiles to the same programs.
  // Each is compiled for the caster, into a render target as the shadow map is, in the state the shadow
  // pass draws in, so that the program is the one it looks up: no tone mapping and linear output (a render
  // target), no fog (it draws with an empty scene) and shadows on. Its lights are the ones the frame before
  // set up: three.js draws the shadow maps before it sets up the frame's lights, so its depth programs are
  // keyed with the lights of the last frame drawn (the scene's), or none at all in the first frames. Both
  // variants, then: with the scene's lights (the scene, its fog off), and with none (a scene holding only a
  // bare THREE.Light that casts shadows: pushed as a shadow, counted as no kind of light).
  const depthMats = new Map(), FLIP = {};
  let depthRT = null, depthScene = null;
  function depthOf(o, m) {
    if (!FLIP[THREE.FrontSide]) { FLIP[THREE.FrontSide] = THREE.BackSide; FLIP[THREE.BackSide] = THREE.FrontSide; FLIP[THREE.DoubleSide] = THREE.DoubleSide; }
    const side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : FLIP[m.side];
    const alphaTest = m.alphaToCoverage === true ? 0.5 : m.alphaTest;
    const key = [side, m.map ? m.map.channel || 0 : '-', m.alphaMap ? m.alphaMap.channel || 0 : '-', alphaTest > 0, !!(m.displacementMap && m.displacementScale !== 0), !!m.wireframe, !!m.clipShadows].join('|');
    // (a caster's own depth material takes the same from its material: three.js writes them onto it too)
    let d = o.customDepthMaterial || depthMats.get(key);
    if (!d) depthMats.set(key, d = new THREE.MeshDepthMaterial());
    Object.assign(d, { visible: m.visible, wireframe: m.wireframe, side, alphaMap: m.alphaMap || null, alphaTest, map: m.map || null, clipShadows: m.clipShadows,
      clippingPlanes: m.clippingPlanes, clipIntersection: m.clipIntersection, displacementMap: m.displacementMap || null,
      displacementScale: m.displacementScale === undefined ? 1 : m.displacementScale, displacementBias: m.displacementBias || 0 });
    return d;
  }
  function compileDepth(renderer, casters, camera, scene) {
    const out = [];
    if (!casters.length) return out;
    if (!depthRT) {
      depthRT = new THREE.WebGLRenderTarget(1, 1);
      depthScene = new THREE.Scene();
      const caster = new THREE.Light();
      caster.castShadow = true;
      depthScene.add(caster);
    }
    // (the casters alone, as one object to compile: three.js walks the target scene's lights once a call)
    const just = { traverse: f => { for (const o of casters) f(o); }, traverseVisible() {} };
    const was = renderer.getRenderTarget(), mats = casters.map(o => o.material), fog = scene && scene.isScene ? scene.fog : null;
    renderer.setRenderTarget(depthRT);
    try {
      casters.forEach(o => { o.material = Array.isArray(o.material) ? o.material.map(m => depthOf(o, m)) : depthOf(o, o.material); });
      for (const target of scene && scene.isScene ? [scene, depthScene] : [depthScene]) {
        if (target === scene) scene.fog = null;
        try { for (const m of renderer.compile(just, camera, target)) out.push(m); }
        catch (e) { /* compiled by the shadow pass instead */ }
        finally { if (target === scene) scene.fog = fog; }
      }
    } finally {
      casters.forEach((o, k) => { o.material = mats[k]; });
      renderer.setRenderTarget(was);
    }
    return out;
  }

  // Send an object's textures to the GPU before it is drawn (issue 201): a model streamed in once the game
  // is open (an NPC's character, the helicopter) otherwise uploads them all, and builds their mipmaps, in
  // the first frame that draws it. One texture a frame, in the frame's idle time (requestIdleCallback,
  // at the latest after 250 ms), from one queue that every caller shares, so two models arriving together
  // still cost a frame one texture. Resolves when the last of obj's is up; a texture already sent (or
  // queued by another object) is not sent twice.
  const sent = new WeakSet(), queue = [];
  let pumping = false;
  const later = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 250 }) : setTimeout(f, 16));
  function pump() {
    if (!queue.length) { pumping = false; return; }
    pumping = true;
    later(() => {
      const job = queue.shift();
      try { job.renderer.initTexture(job.tex); } catch (e) { /* uploaded on its first draw instead */ }
      job.done();
      requestAnimationFrame(pump); // (the next one in another frame)
    });
  }
  function textures(obj) {
    const out = new Set();
    obj.traverse(o => {
      for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture && v.image) out.add(v);
    });
    return [...out];
  }
  function upload(renderer, obj) {
    if (!renderer || !renderer.initTexture || !obj) return Promise.resolve();
    const waits = [];
    for (const tex of textures(obj)) {
      if (sent.has(tex)) { const j = queue.find(q => q.tex === tex); if (j) waits.push(j.p); continue; } // (up, or on its way)
      sent.add(tex);
      const job = { renderer, tex };
      job.p = new Promise(r => { job.done = r; });
      queue.push(job);
      waits.push(job.p);
    }
    if (!pumping) pump();
    return Promise.all(waits).then(() => {});
  }
  // A geometry's bounds-tree built in a Worker (bvh-worker.js, next to this file) from copies of its positions and
  // index: resolves with the serialised tree for THREE.MeshBVH.deserialize
  const here = document.currentScript ? document.currentScript.src : location.href;
  function bvhIn(geo) {
    return new Promise((ok, fail) => {
      let w;
      try { w = new Worker(new URL('bvh-worker.js', here), { type: 'module' }); } catch (e) { fail(e); return; }
      const t0 = performance.now();
      w.onmessage = e => { w.terminate(); if (e.data.error) fail(new Error(e.data.error)); else { console.info(`bounds-tree: ${Math.round(e.data.ms)} ms in a worker, back after ${Math.round(performance.now() - t0)} ms`); ok(e.data.data); } };
      w.onerror = e => { e.preventDefault(); w.terminate(); fail(new Error(e.message || 'worker failed')); };
      const position = geo.attributes.position.array.slice(), index = geo.index.array.slice();
      w.postMessage({ id: 1, position, index }, [position.buffer, index.buffer]);
    });
  }

  // A post stack's programs (issue 299): three.js compiles a pass's material on its first draw, so the first frame
  // drawn through the composer compiled them all (2.6 s of the loader's first frame on a software renderer).
  // Each pass's materials (its own, its full-screen quad's, those in its arrays; a pass with materials of its own
  // lists them in .materials and its quad's geometry in .quadGeometry) are compiled with compile() into the
  // composer's target, and those of the last few passes (the one that draws to the screen, whichever is on) for the
  // screen too: the two differ in output colour space and tone mapping, which pick the variant.
  function warmPasses(renderer, composer) {
    if (!composer || !composer.passes) return Promise.resolve();
    // (a stand-in for a pass's full-screen triangle, with its attributes, position and uv: they are part of the variant)
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const toTarget = new THREE.Group(), toScreen = new THREE.Group(), passes = composer.passes;
    passes.forEach((p, i) => {
      const mats = new Set(), add = v => { if (v && v.isMaterial) mats.add(v); };
      for (const v of Object.values(p)) { add(v); if (Array.isArray(v)) v.forEach(add); }
      if (p.fsQuad) add(p.fsQuad.material);
      for (const m of mats) {
        toTarget.add(new THREE.Mesh(p.quadGeometry || tri, m));
        if (i >= passes.length - 3) toScreen.add(new THREE.Mesh(p.quadGeometry || tri, m));
      }
    });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return Promise.all([compile(renderer, toTarget, cam, { target: composer.renderTarget1, shadows: false }),
      compile(renderer, toScreen, cam, { target: null, shadows: false })]).then(() => tri.dispose());
  }

  // A few pixels of a float render target read back without stalling the frame (issue 299): into a pixel-pack
  // buffer behind a fence, and out of it once the fence has passed, at the start of a later frame. three.js's
  // readRenderTargetPixelsAsync polls the fence on a timer and reads when it fires, which is often after
  // that frame's draws were sent: the read (getBufferSubData, synchronous) then waits for all of them, seconds
  // on a software renderer. A requestAnimationFrame callback asked for from inside the game's frame runs
  // before the game's next one (callbacks run in the order they were asked for), so nothing new is queued.
  // out: a Float32Array of w * h * 4 (RGBA, float: readable from any float colour buffer).
  const reads = [];
  function pollReads() {
    for (let i = reads.length - 1; i >= 0; i--) {
      const q = reads[i], gl = q.gl;
      let st;
      try { st = gl.isContextLost() ? gl.WAIT_FAILED : gl.clientWaitSync(q.sync, 0, 0); } catch (e) { st = gl.WAIT_FAILED; }
      if (st === gl.TIMEOUT_EXPIRED) continue;
      reads.splice(i, 1);
      try {
        if (st === gl.WAIT_FAILED) throw new Error('read back failed');
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.buf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, q.out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        q.ok(q.out);
      } catch (e) { q.no(e); }
      finally { try { gl.deleteSync(q.sync); gl.deleteBuffer(q.buf); } catch (e) { /* a lost context */ } }
    }
    if (reads.length) requestAnimationFrame(pollReads);
  }
  function readAsync(renderer, rt, x, y, w, h, out) {
    const gl = renderer.getContext(), fb = rt && renderer.properties.get(rt).__webglFramebuffer;
    if (!(gl.fenceSync && gl.getBufferSubData) || !fb || rt.samples > 0 || out.length < w * h * 4) return Promise.reject(new Error('no read back'));
    const cur = renderer.getRenderTarget(), buf = gl.createBuffer();
    renderer.state.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, out.byteLength, gl.STREAM_READ);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    renderer.state.bindFramebuffer(gl.FRAMEBUFFER, cur ? renderer.properties.get(cur).__webglFramebuffer : null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((ok, no) => {
      reads.push({ gl, buf, sync, out, ok, no });
      if (reads.length === 1) requestAnimationFrame(pollReads);
    });
  }

  // A PCF shadow map as three.js (r186) makes it is a render target with an RGBA8 colour texture beside
  // the depth texture it samples, and that colour is never read: 64 MB of GPU memory at 4096 px, 16 at
  // 2048. WebGLShadowMap builds its own only while shadow.map is null, so the same target made here
  // first, with a one-byte colour texture (a framebuffer still needs one the depth's size), is the one
  // it keeps: drawn, cleared, resized and sampled as before, the shadows to the bit the same.
  function leanShadowMap(renderer, shadow, size) {
    if (shadow.map || !THREE.DepthTexture || !THREE.RedFormat) return;
    const st = renderer.state && renderer.state.buffers && renderer.state.buffers.depth;
    const reversed = !!(st && st.getReversed && st.getReversed());
    const map = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const d = map.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    d.name = 'sun.shadowMap';
    d.format = THREE.DepthFormat;
    d.compareFunction = reversed ? THREE.GreaterEqualCompare : THREE.LessEqualCompare;
    d.minFilter = d.magFilter = THREE.LinearFilter;
    shadow.map = map;
  }

  // The textures of a big object (the city behind the loader), sent in slices of about SLICE_MS before
  // its first draw, which would otherwise upload them all, and build their mipmaps, in that one frame
  // (issue 266: 2.4 s of the longest frame of Shibuya's load). Shares upload()'s record of what is sent.
  // Each slice is sent once the GPU has caught up (caughtUp): an upload's data goes through a transfer buffer
  // the GPU process empties in order, so one sent behind the compiles queued before it waits for them all in
  // the call that sends it (issue 313: a 1000x1200 image's texSubImage2D, 6 s in Kyoto's loader on a
  // software renderer, is 5 ms sent to a GPU with nothing queued; tools/upload_probe.js).
  async function uploadSliced(renderer, obj) {
    if (!renderer || !renderer.initTexture || !obj) return;
    let s0 = performance.now();
    await caughtUp(renderer);
    for (const tex of textures(obj)) {
      if (sent.has(tex)) continue;
      sent.add(tex);
      try { renderer.initTexture(tex); } catch (e) { /* uploaded on its first draw instead */ }
      if (performance.now() - s0 > SLICE_MS) { await idle(); await caughtUp(renderer); s0 = performance.now(); }
    }
  }
  // Resolves once the GPU has done everything sent before the call: a fence, polled between tasks (WebGL updates
  // a fence's status only then), so nothing waits on it. Resolves at once without fences or with a lost context.
  function caughtUp(renderer) {
    const gl = renderer.getContext && renderer.getContext();
    if (!gl || !gl.fenceSync || gl.isContextLost()) return Promise.resolve();
    let sync;
    try { sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); } catch (e) { return Promise.resolve(); }
    return new Promise(done => {
      const poll = () => {
        let st;
        try { st = gl.isContextLost() ? gl.WAIT_FAILED : gl.clientWaitSync(sync, 0, 0); } catch (e) { st = gl.WAIT_FAILED; }
        if (st === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 4); return; }
        try { gl.deleteSync(sync); } catch (e) { /* a lost context */ }
        done();
      };
      setTimeout(poll, 0);
    });
  }

  // The vertex buffers of a big object (the city behind the loader), sent in slices of about SLICE_MS before its
  // first draw (issue 313). three.js uploads a geometry's attributes in the first frame that draws it
  // (bufferData: 0.5 to 1.9 s of the loader's first frame on a software renderer) and has no call to do it
  // sooner, so each slice is rendered with its draw calls held: its objects alone on a layer of their own
  // (with the scene's lights, so every material keeps its program), culling off, the shadow pass, the
  // background, the clear and the context's draw calls held. three.js's render then sends their attributes,
  // instance matrices and index, binds their programs, and draws nothing. Into target, the render target
  // the scene is drawn into (the programs' variant: call it once compile() is done, so nothing compiles).
  // Objects hidden now are left for their first draw.
  const LAYER = 31, bufSent = new WeakSet(), noop = () => {};
  const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  async function uploadBuffers(renderer, scene, camera, { target = null } = {}) {
    if (!renderer || !renderer.render || !scene || !camera) return;
    const objs = [], lights = [];
    scene.traverseVisible(o => {
      if (o.isLight) lights.push(o);
      else if ((o.isMesh || o.isLine || o.isPoints) && !o.isBatchedMesh && o.geometry && o.material && !bufSent.has(o)) { bufSent.add(o); objs.push(o); }
    });
    if (!objs.length) return;
    // (the bytes each object sends: its attributes, index and instance matrices not counted with another's already)
    const counted = new WeakSet(), bytes = o => {
      let n = 0;
      for (const a of [o.geometry.index, o.instanceMatrix, o.instanceColor, ...Object.values(o.geometry.attributes)]) {
        const d = a && (a.isInterleavedBufferAttribute ? a.data : a);
        if (d && d.array && !counted.has(d)) { counted.add(d); n += d.array.byteLength; }
      }
      return n;
    };
    const t0 = performance.now();
    let budget = 4 << 20, i = 0, slices = 0, longest = 0, total = 0;
    const log = [];
    while (i < objs.length) {
      const slice = [];
      let sb = 0;
      while (i < objs.length && (sb < budget || !slice.length)) { const o = objs[i++]; sb += bytes(o); slice.push(o); }
      await caughtUp(renderer); // (sent behind queued compiles, the uploads wait for them: uploadSliced)
      const s0 = performance.now(), sm = renderer.shadowMap, keep = { render: sm.render, own: Object.prototype.hasOwnProperty.call(sm, 'render'), clear: renderer.autoClear, bg: scene.isScene ? scene.background : null, rt: renderer.getRenderTarget(), mask: camera.layers.mask };
      const was = slice.map(o => o.frustumCulled), gl = renderer.getContext(), draws = DRAWS.filter(k => gl[k]);
      try {
        for (const o of slice) { o.layers.enable(LAYER); o.frustumCulled = false; }
        for (const k of draws) gl[k] = noop;
        for (const l of lights) l.layers.enable(LAYER);
        sm.render = () => {};
        renderer.autoClear = false;
        if (scene.isScene) scene.background = null;
        camera.layers.set(LAYER);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } catch (e) { console.warn('buffers', e); }
      finally {
        camera.layers.mask = keep.mask;
        renderer.setRenderTarget(keep.rt);
        if (scene.isScene) scene.background = keep.bg;
        renderer.autoClear = keep.clear;
        if (keep.own) sm.render = keep.render; else delete sm.render;
        for (const l of lights) l.layers.disable(LAYER);
        for (const k of draws) delete gl[k];
        slice.forEach((o, k) => { o.layers.disable(LAYER); o.frustumCulled = was[k]; });
      }
      const dt = performance.now() - s0;
      slices++; longest = Math.max(longest, dt); total += sb; log.push(`${(sb / 1048576).toFixed(1)}/${Math.round(dt)}`);
      // (the next slice's size from this one's rate: about SLICE_MS of uploads a slice)
      budget = Math.max(256 << 10, Math.min(64 << 20, sb * SLICE_MS / Math.max(dt, 1)));
    }
    console.info(`buffers: ${objs.length} objects, ${(total / 1048576).toFixed(0)} MB in ${slices} slices (MB/ms: ${log.slice(0, 8).join(' ')}), the longest ${Math.round(longest)} ms, done after ${Math.round(performance.now() - t0)} ms`);
  }

  // The sun's shadow map, cached for what does not move. The city's walls, roofs, rooftop plant, landmarks and
  // street furniture cast the same shadow from one frame to the next: only the sun's steps (every quarter of a
  // second of the game's clock) and the shadow box sliding after the camera change it. So those casters
  // (marked with mark(), which takes an object and all under it) are drawn into a depth map of their own only
  // when the light's pose or one of them changes (a lift car moving, a landmark shown or hidden), and every
  // frame that depth is copied into the shadow map with a framebuffer blit in place of its clear, and the
  // casters that move (people, cars, vessels, the trees in the wind) are drawn over it. The shadow map holds
  // exactly what it held before; three.js's own shadow pass draws both halves, with its own materials.
  function shadowCache(renderer, light) {
    const SM = renderer.shadowMap, orig = SM.render, gl = renderer.getContext(), shadow = light.shadow;
    if (typeof gl.blitFramebuffer !== 'function' || !shadow.map || !shadow.map.depthTexture || SM.__cached) return null;
    SM.__cached = true;
    const props = renderer.properties, state = renderer.state, D = shadow.map.depthTexture;
    const still = new THREE.WebGLRenderTarget(shadow.map.width, shadow.map.height, { format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const sd = still.depthTexture = new THREE.DepthTexture(shadow.map.width, shadow.map.height, D.type);
    sd.format = D.format; sd.compareFunction = D.compareFunction; sd.minFilter = sd.magFilter = THREE.LinearFilter;
    let on = true, casters = [], pose = [], sig = [], frame = 0, built = false;
    const api = { refreshes: 0, frames: 0, mark(o) { if (o) o.userData.shadowStatic = true; return o; }, off() { on = false; } };
    const walk = (o, st, fn) => { st = st || !!o.userData.shadowStatic; fn(o, st); for (const c of o.children) walk(c, st, fn); };
    const drawable = o => o.isMesh || o.isLine || o.isPoints;
    function collect(scene) {
      const out = [];
      walk(scene, false, (o, st) => { if (st && drawable(o) && o.castShadow) out.push(o); });
      if (out.length !== casters.length || out.some((o, i) => o !== casters[i])) { casters = out; built = false; }
    }
    // The light's pose and what each still caster looks like to the shadow pass (where it is, whether it is shown,
    // its instances), written each frame into a buffer kept for it and compared with the last frame's in place:
    // true when nothing changed. (Before, two arrays of some twenty numbers a caster were made and dropped every
    // frame: issue 352.)
    let poseA = new Float64Array(14), poseB = new Float64Array(14), sigA = new Float64Array(1024), sigB = new Float64Array(1024), sigN = -1;
    function poseOf() {
      const a = light.matrixWorld.elements, b = light.target.matrixWorld.elements, c = shadow.camera, P = poseA, Q = poseB;
      P[0] = a[12]; P[1] = a[13]; P[2] = a[14]; P[3] = b[12]; P[4] = b[13]; P[5] = b[14]; P[6] = c.left; P[7] = c.right; P[8] = c.top; P[9] = c.bottom;
      P[10] = c.near; P[11] = c.far; P[12] = shadow.mapSize.x; P[13] = shadow.mapSize.y;
      let same = true;
      for (let i = 0; i < 14; i++) if (P[i] !== Q[i]) { same = false; break; }
      poseA = Q; poseB = P;
      return same;
    }
    function sigOf() {
      const need = casters.length * 19;
      if (sigA.length < need) { sigA = new Float64Array(need * 2); const k = new Float64Array(need * 2); k.set(sigB.subarray(0, Math.max(0, sigN))); sigB = k; }
      const S = sigA;
      let n = 0;
      for (const o of casters) {
        let v = 1;
        for (let p = o; p; p = p.parent) if (!p.visible) { v = 0; break; }
        S[n++] = v; S[n++] = o.castShadow ? 1 : 0; S[n++] = o.isInstancedMesh ? o.count + 1e6 * o.instanceMatrix.version : 0;
        if (v) { const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) S[n++] = e[i]; }
      }
      let same = n === sigN;
      if (same) { const K = sigB; for (let i = 0; i < n; i++) if (S[i] !== K[i]) { same = false; break; } }
      sigA = sigB; sigB = S; sigN = n;
      return same;
    }
    function blit() {
      const w = shadow.map.width, h = shadow.map.height, dst = props.get(shadow.map).__webglFramebuffer;
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, props.get(still).__webglFramebuffer);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
      state.buffers.depth.setMask(true);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    }
    SM.render = function (lights, scene, camera) {
      if (!on || lights.length !== 1 || lights[0] !== light || this.type !== THREE.PCFShadowMap ||
          !(this.autoUpdate || this.needsUpdate) || !(shadow.autoUpdate || shadow.needsUpdate)) return orig.call(this, lights, scene, camera);
      const asked = this.needsUpdate || shadow.needsUpdate;
      try {
        if (frame++ % 30 === 0) collect(scene);
        light.updateMatrixWorld(); light.target.updateMatrixWorld();
        const moved = !poseOf() | !sigOf(); // (both: each keeps what it saw for the next frame's comparison)
        api.frames++;
        if (!built || asked || moved) {
          // the still casters alone, into their own map
          const moving = [];
          walk(scene, false, (o, st) => { if (!st && o.castShadow && drawable(o)) { o.castShadow = false; moving.push(o); } });
          const real = shadow.map, need = this.needsUpdate;
          shadow.map = still;
          try { orig.call(this, lights, scene, camera); } finally { shadow.map = real; for (const o of moving) o.castShadow = true; }
          this.needsUpdate = need; shadow.needsUpdate = need || shadow.needsUpdate;
          built = true; api.refreshes++;
        }
        // every frame: the still casters' depth, and the moving ones drawn over it
        for (const o of casters) o.castShadow = false;
        const clear = renderer.clear;
        renderer.clear = blit;
        try { orig.call(this, lights, scene, camera); } finally { renderer.clear = clear; for (const o of casters) o.castShadow = true; }
      } catch (e) {
        console.warn('shadow cache: off', e);
        on = false;
        return orig.call(this, lights, scene, camera);
      }
    };
    api.resize = n => { still.setSize(n, n); built = false; };
    api.dispose = () => { SM.render = orig; SM.__cached = false; still.dispose(); };
    return api;
  }


  // both, for a model that comes once the game is open: its textures sent, then its shaders compiled
  function warm(renderer, obj, camera, opts) {
    return upload(renderer, obj).then(() => compile(renderer, obj, camera, opts));
  }

  // The game draws its ground from the 5 m grid near the player and from every second point of it (10 m) further
  // off. A landmark's floor (the Skyline site's on Bob's Peak, a plaza) is laid on the 5 m ground, and on a crest
  // the 10 m triangles bridge over the 5 m ground's hollows: from far off they rose through the floor near its edge
  // (#286). Under every landmark face that lies on the ground (near level, within 1.5 m of the 5 m grid), the 10 m
  // grid's points within a cell of it are lowered, in place, to the lowest 5 m point round them and just under the
  // floor, so the far ground stays under it at every distance; near the player the 5 m grid is drawn as it is.
  // Tc: the 10 m grid (every second point of Tf), Tf: the 5 m one, LM: landmarks.json; returns the points lowered
  function settleUnderFloors(Tc, Tf, LM) {
    if (!Tc || !Tf || !LM || !LM.meshes) return 0;
    const S = window.Sun, mark = new Float32Array(Tc.nx * Tc.ny).fill(Infinity);
    for (const m of LM.meshes) {
      const p = m.position, ix = m.index;
      if (!p || !ix || (LM.materials[m.material] && LM.materials[m.material].opacity === 0)) continue;
      for (let i = 0; i + 2 < ix.length; i += 3) {
        const a = 3 * ix[i], b = 3 * ix[i + 1], c = 3 * ix[i + 2];
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
        if (!(nl > 1e-6) || Math.abs(nz) < 0.9 * nl) continue; // (a floor, not a wall or a roof's pitch)
        const zl = Math.min(p[a + 2], p[b + 2], p[c + 2]), cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
        if (Math.abs(zl - S.terrainAt(Tf, cx, cy)) > 1.5) continue; // (a deck or a roof, up off the ground)
        const x0 = Math.min(p[a], p[b], p[c]), x1 = Math.max(p[a], p[b], p[c]), y0 = Math.min(p[a + 1], p[b + 1], p[c + 1]), y1 = Math.max(p[a + 1], p[b + 1], p[c + 1]);
        const k0 = Math.max(0, Math.floor((x0 - Tc.x0) / Tc.cell) - 1), k1 = Math.min(Tc.nx - 1, Math.ceil((x1 - Tc.x0) / Tc.cell) + 1);
        const r0 = Math.max(0, Math.floor((Tc.y1 - y1) / Tc.cell) - 1), r1 = Math.min(Tc.ny - 1, Math.ceil((Tc.y1 - y0) / Tc.cell) + 1);
        for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) { const q = r * Tc.nx + k; if (zl < mark[q]) mark[q] = zl; }
      }
    }
    const f = Math.round(Tc.cell / Tf.cell);
    let n = 0;
    for (let r = 0; r < Tc.ny; r++) for (let k = 0; k < Tc.nx; k++) {
      const q = r * Tc.nx + k;
      if (mark[q] === Infinity) continue;
      let lo = Tc.data[q];
      for (let i = f * r - f; i <= f * r + f; i++) for (let j = f * k - f; j <= f * k + f; j++)
        if (i >= 0 && j >= 0 && i < Tf.ny && j < Tf.nx) lo = Math.min(lo, Tf.data[i * Tf.nx + j]);
      lo = Math.min(lo, Math.max(mark[q] - 0.08, lo - 3)); // (and just under the floor, but no pit)
      if (lo < Tc.data[q] - 1e-3) { Tc.data[q] = lo; n++; }
    }
    return n;
  }

  // A landmark's water (a pond, a moat: a mesh whose name or material says water or pond) is a level sheet laid over
  // the ground, and the ground under it comes from a survey that never saw the water: Shinjuku Gyoen's pond had the
  // 5 m ground stand up to 4 m through it as grey pyramids (#399). Each grid (Tf the 5 m one, Tc the 10 m one) is
  // lowered under every water face: a point under the water to half a metre below its surface, and a point of a
  // cell the water's edge crosses (within a cell's diagonal of it) to just under the surface, so no triangle the
  // ground tiles draw rises through it; a bank that would drop more than 3 m that way (a moat's wall, which the
  // landmark draws itself) is left. Returns the points lowered.
  const WATER = /water|pond/i;
  function carveUnderWater(grids, LM) {
    if (!LM || !LM.meshes) return 0;
    let n = 0;
    for (const T of grids) {
      if (!T) continue;
      const want = new Float32Array(T.nx * T.ny).fill(Infinity), R = T.cell * 1.415;
      for (const m of LM.meshes) {
        const p = m.position, ix = m.index, mat = LM.materials[m.material];
        if (!p || !ix || !WATER.test(`${m.name} ${m.material}`) || (mat && mat.opacity === 0)) continue;
        for (let i = 0; i + 2 < ix.length; i += 3) {
          const a = 3 * ix[i], b = 3 * ix[i + 1], c = 3 * ix[i + 2];
          const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
          const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
          if (!(nl > 1e-6) || Math.abs(nz) < 0.9 * nl) continue; // (the sheet, not a wall)
          const zw = Math.min(p[a + 2], p[b + 2], p[c + 2]), P = [[p[a], p[a + 1]], [p[b], p[b + 1]], [p[c], p[c + 1]]];
          const x0 = Math.min(p[a], p[b], p[c]) - R, x1 = Math.max(p[a], p[b], p[c]) + R, y0 = Math.min(p[a + 1], p[b + 1], p[c + 1]) - R, y1 = Math.max(p[a + 1], p[b + 1], p[c + 1]) + R;
          const k0 = Math.max(0, Math.floor((x0 - T.x0) / T.cell)), k1 = Math.min(T.nx - 1, Math.ceil((x1 - T.x0) / T.cell));
          const r0 = Math.max(0, Math.floor((T.y1 - y1) / T.cell)), r1 = Math.min(T.ny - 1, Math.ceil((T.y1 - y0) / T.cell));
          for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) {
            const d = triDist(T.x0 + k * T.cell, T.y1 - r * T.cell, P);
            if (d >= R) continue;
            const q = r * T.nx + k, to = d === 0 ? zw - 0.5 : zw - 0.05;
            if (d > 0 && T.data[q] - to > 3) continue; // (a steep bank: the landmark's own wall stands there)
            if (to < want[q]) want[q] = to;
          }
        }
      }
      for (let q = 0; q < want.length; q++) if (T.data[q] > want[q]) { T.data[q] = want[q]; n++; }
    }
    return n;
  }
  // how far (x, y) is from a triangle P = [[x, y] x3] on the map (0 inside it)
  function triDist(x, y, P) {
    const [[ax, ay], [bx, by], [cx, cy]] = P;
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by), d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy), d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;
    const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l)) : 0; return Math.hypot(x - x1 - t * dx, y - y1 - t * dy); };
    return Math.min(seg(ax, ay, bx, by), seg(bx, by, cx, cy), seg(cx, cy, ax, ay));
  }

  // The sun's glint along a rail (issue 372, item 1): the polished head of a rail is a long thin mirror, so it
  // shines where the sun's reflection meets the line of the rail, a bright thread running towards the sun, the
  // way a track looks into a low sun. The hair model of Kajiya and Kay (1989): with T the rail's direction and H
  // the half vector, the highlight is sin(T, H) to a high power; it goes on the direct specular light, so the
  // shadows and the sun's colour are the light's own. aRail: each vertex's rail direction, from trackMesh.
  function railGlint(mat) {
    if (mat.userData.glint) return mat;
    mat.userData.glint = true;
    const own = mat.onBeforeCompile, ownKey = mat.customProgramCacheKey, plain = ownKey === THREE.Material.prototype.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (own) own.call(this, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRail; varying vec3 vRailT;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRailT = (viewMatrix * modelMatrix * vec4(aRail, 0.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRailT;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
#if NUM_DIR_LIGHTS > 0
if (dot(vRailT, vRailT) > 0.25) { vec3 oeT = normalize(vRailT), oeV = normalize(vViewPosition), oeL = directionalLights[0].direction; // (a vertex with no direction: none)
  float oeTH = dot(oeT, normalize(oeL + oeV)), oeKK = pow(max(0.0, 1.0 - oeTH * oeTH), 90.0);
  // the sun's light on the rail's head, as its diffuse term has it (its shadow, its colour, the angle)
  vec3 oeE = reflectedLight.directDiffuse / max(material.diffuseColor * RECIPROCAL_PI, vec3(1e-3));
  reflectedLight.directSpecular += oeE * oeKK * 1.4 * smoothstep(0.0, 0.08, dot(oeL, normal)); }
#endif`);
    };
    mat.customProgramCacheKey = function () { return `${plain ? (own ? own.toString() : '') : ownKey.call(this)}|oe-rail-glint`; };
    return mat;
  }


  // aRail for a swept rail (a landmark's rail_steel, cities/<id>/rail.py): every triangle of the sweep is long and thin
  // along the rail, so each vertex takes the direction of the longest edge of a triangle it is in, on the ground plane
  function railDirections(g) {
    const P = g.attributes.position.array, I = g.index ? g.index.array : null, n = P.length / 3, T = new Float32Array(n * 3);
    const count = I ? I.length : n, at = k => (I ? I[k] : k);
    for (let t = 0; t + 2 < count; t += 3) {
      const v = [at(t), at(t + 1), at(t + 2)];
      let best = 0, bx = 0, bz = 0;
      for (let e = 0; e < 3; e++) {
        const a = v[e] * 3, b = v[(e + 1) % 3] * 3, dx = P[b] - P[a], dz = P[b + 2] - P[a + 2], l = dx * dx + dz * dz;
        if (l > best) { best = l; bx = dx; bz = dz; }
      }
      if (best <= 0) continue;
      const l = Math.sqrt(best);
      for (const i of v) { if (T[i * 3] * bx + T[i * 3 + 2] * bz < 0) { bx = -bx; bz = -bz; } T[i * 3] = bx / l; T[i * 3 + 2] = bz / l; }
    }
    g.setAttribute('aRail', new THREE.BufferAttribute(T, 3));
    return g;
  }

  return { load, loadLine, create, lin, smooth, compile, upload, uploadSliced, uploadBuffers, warm, readAsync, warmPasses, settleUnderFloors, carveUnderWater, railGlint };
})();
