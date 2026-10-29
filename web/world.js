// Open Earth 3D world: the city scene that the model viewer (city.js) and the game
// (game/*.js) share: terrain under aerial imagery, water, the buildings (buildings.js:
// walls, LOD2 roofs, facades with windows by floor, lights at night, height-source
// colours), piers, trees, parametric landmarks, sky and sun. Local frame: x east, y north, z up; three.js is
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
    const getJSON = u => fetch(DATA + u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    onMsg('Loading footprints, terrain and landmarks', 0.05);
    const [scene, B, P, LM, terrBuf, UNC, G] = await Promise.all([getJSON('scene.json'), getJSON('buildings.json'), getJSON('places.json'),
      getJSON('landmarks.json'), getJSON('terrain.json').then(t => Uint8Array.from(atob(t.data), c => c.charCodeAt(0)).buffer),
      getJSON('uncertainty.json').catch(() => null), game ? getJSON('game.json') : Promise.resolve(null)]);
    const CITY = scene.city;
    S.site({ lat: CITY.lat, lon: CITY.lon, tz: CITY.timezone, locale: CITY.locale });
    S.roofs(B); // surface models follow the pitched roofs
    const ti = new Int16Array(terrBuf);
    const T = { data: Float32Array.from(ti, v => v * scene.terrain.scale), nx: scene.terrain.nx, ny: scene.terrain.ny,
      cell: scene.terrain.cell, x0: scene.frame.x[0], y1: scene.frame.y[1] };
    return { id: cityId, DATA, scene, B, P, LM, UNC, G, CITY, T, ground: (x, y) => Math.max(0, S.terrainAt(T, x, y)) };
  }

  // surface patterns for parametric landmark materials (landmarks.json "pattern"), drawn
  // from the meshes' texture coordinates in metres; each fades to its average colour where
  // a pixel covers more than a few repeats, so it never shimmers at a distance
  const LM_NIGHT = { value: 0 }; // how dark it is, for landmark patterns with lit windows
  // the Eiffel Tower's sparkle: five minutes at the start of every hour after dark (setSun turns it on)
  const SPARKLE = { on: { value: 0 }, t: { value: 0 } };
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
    curtain_wall(mat, m) {
      mat.defines = Object.assign(mat.defines || {}, { USE_UV: '' });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uBay: { value: m.bay_m || 1.5 }, uSty: { value: m.storey_m || 4.0 }, uSpan: { value: m.spandrel || 0.25 },
          uMull: { value: m.mullion_m || 0.12 }, uFrame: { value: lin(m.frame || '#c9ced2') }, uLmNight: LM_NIGHT });
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uBay, uSty, uSpan, uMull, uLmNight; uniform vec3 uFrame; float pWin, pLit;
float cwHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float bu = vUv.x / uBay, bv = vUv.y / uSty, fw = max(fwidth(bu), fwidth(bv));
    float eu = min(fract(bu), 1.0 - fract(bu)) * uBay, mull = 1.0 - smoothstep(uMull * 0.5, uMull * 0.5 + fwidth(vUv.x), eu);
    float span = 1.0 - smoothstep(uSpan - fwidth(bv), uSpan + fwidth(bv), fract(bv));
    vec2 cell = floor(vec2(bu, bv));
    float far = smoothstep(0.12, 0.5, fw), solid = max(mull, span * 0.9);
    vec3 glass = diffuseColor.rgb * (0.82 + 0.36 * cwHash(cell));
    diffuseColor.rgb = mix(mix(glass, uFrame, solid), mix(diffuseColor.rgb, uFrame, 0.3), far);
    pWin = mix(1.0 - solid, 0.6, far); pLit = mix(step(0.62, cwHash(cell + 17.0)), 0.22, far); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.45, roughnessFactor, pWin);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += pWin * pLit * uLmNight * vec3(1.0, 0.78, 0.5) * 1.3;`);
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
    }
  };

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
  function edgeHaze(frame, near = 150) {
    const C = THREE.ShaderChunk;
    if (!FOG0) FOG0 = { pv: C.fog_pars_vertex, v: C.fog_vertex, pf: C.fog_pars_fragment, f: C.fog_fragment };
    const w = frame.x[1] - frame.x[0], h = frame.y[1] - frame.y[0], fade = Math.min(500, Math.max(250, 0.1 * Math.min(w, h)));
    const n = v => v.toFixed(1), last = (chunk, add) => chunk.replace(/#endif\s*$/, `\t${add}\n#endif`); // inside the outer USE_FOG block
    C.fog_pars_vertex = last(FOG0.pv, 'varying vec2 vEdgeXZ;');
    C.fog_vertex = last(FOG0.v, 'vEdgeXZ = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).xz;');
    C.fog_pars_fragment = last(FOG0.pf, 'varying vec2 vEdgeXZ;');
    // how far out into the haze a point is (0 inside, 1 at the frame and beyond); the camera's own
    // value lifts the near exemption when it is out there itself, so the sea in front of it hazes too
    const out = p => `smoothstep( 0.0, ${n(fade)}, length( max( abs( ${p} - vec2( ${n((frame.x[0] + frame.x[1]) / 2)}, ${n(-(frame.y[0] + frame.y[1]) / 2)} ) ) - vec2( ${n(w / 2 - fade)}, ${n(h / 2 - fade)} ), 0.0 ) ) )`;
    C.fog_fragment = FOG0.f.replace('\tgl_FragColor.rgb', `\tfogFactor = max( fogFactor, ${out('vEdgeXZ')} * max( smoothstep( ${n(near)}, ${n(near * 4)}, vFogDepth ), ${out('cameraPosition.xz')} ) );
	gl_FragColor.rgb`);
    return fade;
  }

  async function create(D, renderer, { onMsg = () => {}, small = Math.min(innerWidth, innerHeight) < 700 } = {}) {
    const { B, P, LM, T } = D, scene = D.scene, loadMsg = onMsg;
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const SHADOW = renderer.capabilities.maxTextureSize >= 8192 && !small ? 4096 : 2048;

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
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace('varying float vSunE;', 'varying float vSunE;\n varying float vSunfade;')
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisc;\n vec3 texColor = ( Lin + L0 ) * 0.04')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ), 1.0 );');
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
    world.fog = new THREE.Fog(0xc6d3dc, 6000, 26000);
    edgeHaze(scene.frame);

    // ------------------------------------------------------------ terrain and imagery
    loadMsg('Draping aerial imagery on the terrain', 0.35);
    await idle();
    const texLoader = new THREE.TextureLoader();
    const groundMeshes = [];
    // a ground tile draped on terrain grid Tg (the viewer's 10 m grid, or the game's 5 m one near the player)
    function tileGeometry(t, Tg) {
      const w = t.x1 - t.x0, h = t.y1 - t.y0;
      const g = new THREE.PlaneGeometry(w, h, Math.round(w / Tg.cell), Math.round(h / Tg.cell));
      g.rotateX(-Math.PI / 2);
      g.translate((t.x0 + t.x1) / 2, 0, -(t.y0 + t.y1) / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, S.terrainAt(Tg, p.getX(i), -p.getZ(i)));
      g.computeVertexNormals();
      return g;
    }
    for (const t of scene.ground) {
      const g = tileGeometry(t, T);
      const tex = texLoader.load(D.DATA + t.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
      m.receiveShadow = true;
      world.add(m);
      groundMeshes.push(m);
    }

    // water: the wind-driven sea of water.js where the GPU renders to float targets; otherwise
    // the old see-through sheet with ripples. On land the terrain covers it either way.
    let sea = null, shoreTex = null;
    if (scene.shore) {
      shoreTex = await new Promise(res => texLoader.load(D.DATA + scene.shore.file, res, undefined, () => res(null)));
      if (shoreTex) { shoreTex.colorSpace = THREE.NoColorSpace; shoreTex.generateMipmaps = false; shoreTex.minFilter = THREE.LinearFilter; shoreTex.flipY = false; }
    }
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
    if (sea) for (const m of groundMeshes) m.material.onBeforeCompile = sh => sea.patchGround(sh);

    // ------------------------------------------------------------ buildings
    loadMsg(`Building ${B.b.length.toLocaleString()} buildings: walls, roofs and facades`, 0.5);
    await idle();
    const SRC = { mapped: 0, survey: 0, reference: 0, verified: 0, plateau: 0, plateau_lod1: 0, lidar: 0, bdtopo: 0, floors: 1, ml: 2, estimate: 2, parametric: 3 };
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
    const BLD = OEBuildings.create(D, { lin, U, renderer, SRC, small });
    const bGeo = BLD.geometry, buildings = BLD.mesh;
    const fr = scene.frame;
    U.uFrame.value.set(fr.x[0], fr.y[0], 1 / (fr.x[1] - fr.x[0]), 1 / (fr.y[1] - fr.y[0]));
    if (THREE.MeshBVH) { // a bounding-volume hierarchy makes picking a building ~300x faster
      bGeo.boundsTree = new THREE.MeshBVH(bGeo);
      buildings.raycast = THREE.acceleratedRaycast;
    }
    world.add(buildings, BLD.props);

    // piers and wharves: 2.2 m concrete decks
    const pierColour = { wall: lin('#9c9a92'), roof: lin('#a7a59d'), code: 3, windows: false };
    const pierGeo = extrude((P.piers || []).map(r => [-1, 0, 0, 22, r]), () => pierColour);
    const piers = new THREE.Mesh(pierGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
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
    const lmMats = {}, floodMats = {};
    for (const [k, m] of Object.entries(LM.materials || {})) {
      lmMats[k] = new THREE.MeshStandardMaterial({ color: lin(m.color), roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide });
      if (m.pattern && PATTERNS[m.pattern]) PATTERNS[m.pattern](lmMats[k], m);
      if (m.decal) Object.assign(lmMats[k], { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // laid over a roof: in front of it
    }
    // meshes marked floodlit glow after dark
    // (clone() drops onBeforeCompile and resets the defines, so the copy takes the pattern over explicitly)
    const floodlit = k => floodMats[k] || (floodMats[k] = Object.assign(lmMats[k].clone(), { emissive: lin(LM.materials[k].emissive || '#ffe2b8'), emissiveIntensity: 0,
      userData: { glow: LM.materials[k].glow || 0.32 }, onBeforeCompile: lmMats[k].onBeforeCompile, defines: Object.assign({}, lmMats[k].defines) }));
    for (const m of LM.meshes || []) {
      const p = m.position, arr = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { arr[i] = p[i]; arr[i + 1] = p[i + 2]; arr[i + 2] = -p[i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setIndex(m.index);
      if (m.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m.floodlit ? floodlit(m.material) : lmMats[m.material]);
      mesh.castShadow = mesh.receiveShadow = true;
      if (['railing', 'lattice'].includes((LM.materials[m.material] || {}).pattern)) mesh.castShadow = false; // a cut-out strip; its shadow would be solid
      mesh.name = m.name;
      world.add(mesh);
    }

    // ------------------------------------------------------------ sun
    const warm = new THREE.Color('#ffb070'), noonC = new THREE.Color('#fff3e0');
    const api = {
      world, sky, su, sunLight, shCam, hemi, pmrem, groundMeshes, tileGeometry, water, waterMat, sea, trees, buildings, bGeo, U, SRC, extrude, bColour, floodMats, lmMats,
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
        hemi.intensity = Math.PI * (0.07 + 0.25 * day + ((D.scene.city && D.scene.city.night_ambient) || 0) * (1 - day));   // a city's own night glow (neon, street light)
        hemi.color.set(day > 0.3 ? 0xc3d6e6 : 0x5d6f92);
        U.uNight.value = 1 - smooth(-7, 2, sp.altitude);
        // without a clock, guess the hour from the sun: midday, else evening in the west and small hours in the east
        U.uHour.value = minutes != null ? minutes / 60 : sp.altitude > 0 ? 12 : sp.azimuth > 180 ? 21 : 4;
        for (const m of Object.values(floodMats)) m.emissiveIntensity = m.userData.glow * U.uNight.value;
        LM_NIGHT.value = U.uNight.value;
        SPARKLE.on.value = U.uNight.value > 0.6 && minutes != null && ((minutes % 60) + 60) % 60 < 5 ? 1 : 0;
        renderer.toneMappingExposure = 0.55 + 0.35 * (1 - day);
        world.fog.color.set(day > 0.5 ? 0xc6d3dc : new THREE.Color(0x0c1420).lerp(new THREE.Color(0xd2b49c), day * 2).getHex());
        const key = `${Math.round(sp.altitude / 2)}|${Math.round(sp.azimuth / 6)}`;
        if (key !== envKey) {
          envKey = key;
          if (envRT) envRT.dispose();
          envRT = pmrem.fromScene(envScene);
          world.environment = envRT.texture;
        }
        return day;
      },
      // keep the shadow map centred on what the camera looks at, half metres on each side
      fitShadow(target, half) {
        if (shCam.right !== half) { shCam.left = -half; shCam.right = half; shCam.top = half; shCam.bottom = -half; shCam.updateProjectionMatrix(); }
        sunLight.target.position.copy(target);
        sunLight.position.copy(target).addScaledVector(api.sunDir, 4500);
      },
      // the date, for what flowers when (local month and day)
      setSeason(month, day) { if (trees) trees.setSeason(month, day); },
      // per frame, before the render: the waves (and their reflection) and the trees' wind and detail for this camera
      tick(t, camera) {
        SPARKLE.t.value = t * 0.001;
        if (sea && camera) sea.update(t, camera, world); else waterMat.normalMap.offset.set(t * 0.000004, t * 0.0000025);
        if (trees && camera) trees.update(camera, t / 1000);
      },
      dispose() { if (envRT) envRT.dispose(); pmrem.dispose(); if (sea) sea.dispose(); },
    };
    return api;
  }

  return { load, create, lin, smooth };
})();
