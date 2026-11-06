// Open Earth 3D trees: the street and park trees every city shares (assets/trees, built by
// blender/build_trees.py), drawn instanced per species and per distance: the full tree near
// the camera, a sparser one further off, a trunk and crown hull beyond. Each mapped tree
// takes a species from the city's mix by a hash of its position, a size from its height and
// a turn of its own. The trees planted from a wood's canopy (pipeline/woods.py) come after the
// mapped ones, sized by the height the canopy model measured, in the city's woods mix (its own mix
// without its palms if it has none), a share of them left out on a small device. A city's areas (a
// park's or a precinct's outline, or a circle) give the trees there a mix of their own: the black
// pines of a palace lawn, the cedars and camphors of a shrine wood. The wind sways the crowns and
// flutters the leaves, the leaf cards cut their shadows out, jacarandas flower in late spring, cherries
// flower on bare branches in early spring (on a date set by the city's latitude; the weeping cherry a few
// days before the Somei-yoshino, the kawazu-zakura in February and the yaezakura in mid April, each on its
// own offset from trees.json), their bark banded with lenticels, and maples, ginkgos, zelkovas and cherries
// turn in autumn.
'use strict';
window.OETrees = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  // each species' trunk radius above its flare (m, at full size: blender/build_trees.py r0), for a
  // trees.json older than its trunk_r
  const TRUNK = { plane: 0.36, elm: 0.34, gum: 0.4, fig: 0.85, jacaranda: 0.26, palm: 0.42, maple: 0.2 };
  // the leaves' autumn colour, per species with an autumn_colour (trees.json), as a multiple of the leaf's
  // own lightness: the maple keeps its crimson-to-gold range below; the ginkgo goes a clear gold, the zelkova rust,
  // the plane a dull yellow-brown and the elm yellow
  // and the cherry an orange-red
  const FALL = { ginkgo: [3.1, 2.35, 0.35], zelkova: [1.5, 0.82, 0.36], plane: [1.55, 1.2, 0.45], elm: [2.0, 1.7, 0.4], cherry: [2.5, 0.72, 0.3] };
  // the varieties' bloom, for a trees.json without them: each cherry's offset (days) from the Somei-yoshino's
  // opening, and how much longer its bloom lasts
  const VARIETY = { cherry: [0, 1], shidarezakura: [-4, 1], kawazu: [-37, 1.7], yaezakura: [16, 1.15] };
  // the Somei-yoshino's first flowers (kaika): JMA's 1991-2020 normals put Tokyo's on 24 March, the day of the
  // year 82 (from 0), and the date comes about four days later for each degree further from the equator
  // (Kagoshima 26 March, Sendai 8 April, Sapporo 1 May; in the south, Melbourne's in late September); full bloom
  // (mankai) a week after, the petals gone a week after that
  const SAKURA_DOY = 82, SAKURA_LAT = 35.7, SAKURA_PER_DEG = 4.0;
  const sakuraOpen = lat => Math.round(SAKURA_DOY + SAKURA_PER_DEG * (Math.abs(lat) - SAKURA_LAT));
  const inPoly = (x, y, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  async function load(base = 'assets/trees/') {
    if (!THREE.GLTFLoader) throw new Error('GLTFLoader is not available');
    const info = await (await fetch(base + 'trees.json')).json();
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(base + info.file, res, null, rej));
    return { info, gltf };
  }

  // the colour attribute carries ambient occlusion (r), how far the wind moves a vertex (g)
  // and a flutter phase (b); renamed so no material reads it as a colour
  const VERT_HEAD = `#include <common>
attribute vec4 tc; uniform float uWind; uniform float uBloom; uniform float uSakuraV[SAKURA_N]; varying float vAO; varying float vCell; varying float vTurn; varying float vCard; varying float vPetal; varying vec3 vLocal;
attribute float aLit; uniform float uYoz; varying float vLit; varying float vUpH; varying float vNy;`;
  // the atlas cell a leaf card shows (CELLS columns x ROWS; glTF v runs down): the jacaranda's bloom
  // cell swaps to its leaf cell, one to the left, out of season, and each cherry's bloom cell (SAKURA_N of them
  // from CELL_SAKURA, one per variety) to the cherry's leaf cell (CELL_CHERRY); the cells that turn in
  // autumn are coloured in the fragment shader (uAutumn)
  const VERT_UV = `vec2 tuv = uv;
float cell = floor(tuv.x * ATLAS_COLS) + floor(tuv.y * ATLAS_ROWS) * ATLAS_COLS;
vCell = cell;
if (uBloom < 0.5 && abs(cell - CELL_BLOOM) < 0.5) tuv.x -= 1.0 / ATLAS_COLS;
// a cherry's card flowers while its variety's bloom has reached it (the same order its leaves fall in), else it is a leaf
float turn0 = fract(sin(dot(vec2(instanceMatrix[3][0], instanceMatrix[3][2]), vec2(12.9898, 78.233))) * 43758.5453);
float sv = cell - CELL_SAKURA;
bool sakura = sv > -0.5 && sv < float(SAKURA_N) - 0.5;
vPetal = (sakura && fract(tc.b * 7.13 + turn0 * 0.37) < uSakuraV[int(clamp(sv + 0.5, 0.0, float(SAKURA_N) - 0.5))] * (0.85 + 0.3 * turn0)) ? 1.0 : 0.0;
if (vPetal < 0.5 && sakura) tuv += vec2(mod(CELL_CHERRY, ATLAS_COLS) - mod(cell, ATLAS_COLS), floor(CELL_CHERRY / ATLAS_COLS) - floor(cell / ATLAS_COLS)) / vec2(ATLAS_COLS, ATLAS_ROWS);
#define uv tuv
#include <uv_vertex>
#undef uv`;
  const VERT_WIND = `#include <begin_vertex>
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float ph = dot(ip.xz, vec2(0.071, 0.053));
float sw = tc.g * tc.g * (0.65 + 0.35 * sin(uWind * 0.31 + ph * 0.5));
transformed.x += sin(uWind * 1.15 + ph) * 0.32 * sw;
transformed.z += cos(uWind * 0.93 + ph * 1.7) * 0.22 * sw;
#ifdef LEAVES
transformed += normal * sin(uWind * 6.0 + tc.b * 6.2832 + ph) * 0.05 * tc.g;
#endif
vAO = tc.r;
vLocal = position; // (the tree's own frame, before its instance's turn and scale: the bark's bands)
vCard = tc.b; // a leaf card's own phase: which cards fall first
vTurn = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);`;
  function shader(U, leaves, depth, A) {
    return sh => {
      sh.uniforms.uWind = U.uWind; sh.uniforms.uBloom = U.uBloom; sh.uniforms.uSakuraV = U.uSakuraV; sh.uniforms.uCherryBareV = U.uCherryBareV; sh.uniforms.uAutumn = U.uAutumn; sh.uniforms.uFall = U.uFall;
      sh.uniforms.uBare = U.uBare; sh.uniforms.uDecid = U.uDecid; sh.uniforms.uYoz = U.uYoz; sh.uniforms.uYozCol = U.uYozCol;
      sh.defines = Object.assign(sh.defines || {}, { ATLAS_COLS: A.cols.toFixed(1), ATLAS_ROWS: A.rows.toFixed(1), CELL_BLOOM: A.bloom.toFixed(1), CELL_SAKURA: A.sakura.toFixed(1), CELL_CHERRY: A.cherry.toFixed(1), SAKURA_N: A.sakuraN, CELL_MAPLE: A.maple.toFixed(1), ATLAS_CELLS: A.cols * A.rows });
      if (leaves) sh.defines.LEAVES = '';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <uv_vertex>', VERT_UV).replace('#include <begin_vertex>', VERT_WIND);
      // in winter a deciduous tree's cards fall, in the camera's pass and the shadow's alike: each card at its
      // own time (vCard), each tree a little ahead of or behind the others (vTurn); a cherry's cards in flower
      // (vPetal) stay on its bare branches, and its leaves keep to its variety's own time (uCherryBareV)
      const BARE = `uniform float uBare; uniform float uCherryBareV[SAKURA_N]; uniform float uDecid[ATLAS_CELLS]; varying float vCell; varying float vTurn; varying float vCard; varying float vPetal;`;
      if (leaves) sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', depth ? '#include <common>\n' + BARE : '#include <common>\nuniform float uBare; uniform float uCherryBareV[SAKURA_N]; uniform float uDecid[ATLAS_CELLS]; varying float vCard; varying float vPetal;')
        .replace('#include <alphatest_fragment>', `{ int bc = int(vCell + 0.5);
  float sv = vCell - CELL_SAKURA; bool sakura = sv > -0.5 && sv < float(SAKURA_N) - 0.5;
  float cb = uCherryBareV[int(clamp(sv + 0.5, 0.0, float(SAKURA_N) - 0.5))];
  float bare = sakura ? (vPetal > 0.5 ? 0.0 : cb) : uBare;
  if (sakura && vPetal < 0.5 && cb > 0.999) discard; // a cherry in winter and in flower: no leaf at all
  if (bare > 0.0 && bc >= 0 && bc < ATLAS_CELLS && uDecid[bc] > 0.5 && fract(vCard * 7.13 + vTurn * 0.37) < bare * (0.85 + 0.3 * vTurn)) discard; }
#include <alphatest_fragment>`);
      if (depth) return;
      // yozakura (#162): a cherry in a lit place (aLit), after dark in the bloom (uYoz), lit from uplights at its
      // foot: brightest on the undersides of the crown and the lower boughs, falling off up the tree
      sh.vertexShader = sh.vertexShader.replace('vTurn = fract(', 'vLit = aLit * uYoz; vUpH = position.y; vNy = objectNormal.y;\nvTurn = fract(');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uYozCol; varying float vLit; varying float vUpH; varying float vNy;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vLit > 0.0) {
  float under = 0.3 + 0.7 * clamp(0.55 - 0.55 * vNy, 0.0, 1.0);
  float fall = smoothstep(-0.4, 1.0, vUpH) * exp(-max(vUpH - 2.5, 0.0) * 0.17);
  totalEmissiveRadiance += diffuseColor.rgb * uYozCol * vLit * under * fall;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAO; varying float vCell; varying float vTurn; varying vec3 vLocal; uniform float uAutumn; uniform vec3 uFall[ATLAS_CELLS];')
        .replace('#include <map_fragment>', `#include <map_fragment>
#if defined(LEAVES) && defined(USE_MAP)
// a leaf card's alpha, averaged down the mip chain, falls under the cut-out threshold and thin leaves (a
// she-oak's threads, a palm's leaflets, a jacaranda's) vanish with distance: scale it up with the mip level
// (Ben Golus, "Anti-aliased Alpha Test: The Esoteric Alpha To Coverage", 2017)
{ vec2 tx = vMapUv * vec2(textureSize(map, 0)); float d = max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)));
  diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(d)) * 0.25; }
#endif
diffuseColor.rgb *= mix(0.5, 1.0, vAO);
#ifdef BARK_BANDS
// a cherry's bark: glossy, ringed by horizontal lenticels, short pale dashes a few centimetres apart, in broken
// rows round the trunk and the limbs (in the tree's own frame: across a limb they lean with it); faded out where
// a band would be finer than a pixel
{ float by = vLocal.y * 7.0, row = floor(by), az = atan(vLocal.z, vLocal.x) * (1.2 + fract(row * 0.618)) + row * 1.7;
  float h1 = fract(sin(row * 91.7) * 4375.85), h2 = fract(sin(row * 37.3) * 2717.13);
  float dash = smoothstep(0.0, 0.12, fract(az + h1)) * (1.0 - smoothstep(0.55 + 0.35 * h2, 0.65 + 0.35 * h2, fract(az + h1)));
  float c0 = 0.35 + 0.3 * h1, w = 0.05 + 0.06 * h2, f = fract(by);
  float line = smoothstep(c0 - w, c0 - w * 0.4, f) * (1.0 - smoothstep(c0 + w * 0.4, c0 + w, f));
  float aa = 1.0 - smoothstep(0.25, 0.7, fwidth(by));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.85, 1.75, 1.65) + vec3(0.025, 0.022, 0.02), line * dash * aa * (0.55 + 0.4 * h1)); }
#endif
#ifdef LEAVES
// each maple its own turn: most a deep crimson, some scarlet, a few orange and gold, one in eight still
// half green; the leaves keep their own light and dark
if (uAutumn > 0.0) { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); int ci = int(vCell + 0.5);
  if (abs(vCell - CELL_MAPLE) < 0.5) {
    vec3 red = mix(vec3(1.75, 0.36, 0.26), vec3(1.95, 0.62, 0.22), smoothstep(0.45, 0.85, vTurn));
    red = mix(red, vec3(1.7, 1.15, 0.3), smoothstep(0.88, 0.97, vTurn));
    float k = uAutumn * (vTurn < 0.12 ? 0.45 : 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, red * l, k);
  } else if (ci >= 0 && ci < ATLAS_CELLS && uFall[ci].r > 0.0 && vPetal < 0.5) {
    // a ginkgo, a zelkova or a cherry: each tree a little ahead of or behind the others, one in eight still half green
    float k = uAutumn * (vTurn < 0.12 ? 0.4 : 0.9 + 0.1 * vTurn);
    diffuseColor.rgb = mix(diffuseColor.rgb, uFall[ci] * mix(0.9, 1.1, vTurn) * l, k);
  }
}
#endif`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;');
      // the cards' normals point out of the crown on both faces: lit as a mass, never flipped
      if (leaves) sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
  }

  // world: the scene; list: x, y, ground, height in dm per tree (places.json trees, then woods);
  // mix: species weights; south: the city is in the southern hemisphere (for the flowering season); lat: its
  // latitude, for the cherries' (sakuraOpen), or cherry: the day its cherries open on average, if known ("MM-DD", city.json
  // trees.cherry_open: Kyoto's and Osaka's open later than their latitude says);
  // measured: the index from which the trees are a wood's, with measured heights; keep: the share
  // of those drawn
  // areas: [{at: [x, y], radius, mix} or {xy: [[x, y], ...], mix, woods}], places whose trees take their
  // own mix (a garden's maples, a palace lawn's pines): mix for every tree there, woods (if given) for
  // those planted from the canopy; woods: the mix of the trees planted from a wood's canopy (the city's
  // own without its palms if not given)
  // fixed: the index from which the trees are a landmark's own, standing where it puts them (on a planter, a terrace)
  // yozakura (#162): an area with "yozakura" lights its cherries after dark while they flower: uplights at each
  // tree's foot (a pool of light round it) and bonbori, paper lanterns on posts, along its ways on foot (foot: the
  // city's night.json, whose foot and foot_pts are the mapped footways), or beside its trees where none is mapped;
  // night: the uniform world.js sets after dark (0..1); small: the light tier (fewer lanterns, no glows)
  function create(world, lib, list, { mix = null, woods = null, south = true, lat = null, cherry = null, measured = Infinity, keep = 1, areas = [], fixed = Infinity, night = null, foot = null, small = false } = {}) {
    const I = lib.info, n = list.length / 4;
    const AT = I.atlas || {}, cells = AT.cells || {};
    const A = { cols: AT.columns || 4, rows: AT.rows || 2, bloom: cells.bloom ?? 5, sakura: cells.sakura ?? -10, maple: cells.maple ?? 7 };
    A.cherry = cells.cherry ?? A.sakura - 1; A.sakuraN = (AT.sakura_cells || [A.sakura]).length;
    // the cherry's cards are its bloom cell's ("sakura"): they turn and fall as its own leaves
    const cellOf = sp => (I.species[sp] && I.species[sp].cell != null ? I.species[sp].cell : cells[sp]);
    const fall = Array.from({ length: A.cols * A.rows }, () => new THREE.Vector3());
    // each cherry variety: its bloom cell's index from CELL_SAKURA, its offset and its bloom's length
    const varieties = Object.keys(I.species).map(sp => {
      const S = I.species[sp], v = cellOf(sp) - A.sakura, d = VARIETY[sp] || [0, 1];
      return v >= 0 && v < A.sakuraN ? { sp, v, off: S.bloom_offset_d ?? d[0], len: S.bloom_len ?? d[1] } : null;
    }).filter(Boolean);
    const fallOf = sp => FALL[sp] || (varieties.some(o => o.sp === sp) ? FALL.cherry : null);
    for (const sp of Object.keys(I.species)) if (fallOf(sp) && cellOf(sp) != null && cellOf(sp) < fall.length) fall[cellOf(sp)].set(...fallOf(sp));
    // the cells of the deciduous species (trees.json deciduous): bare in winter
    const decid = Array.from({ length: A.cols * A.rows }, () => 0);
    for (const [sp, S] of Object.entries(I.species)) if (S.deciduous && cellOf(sp) != null && cellOf(sp) < decid.length) decid[cellOf(sp)] = 1;
    const U = { uYoz: { value: 0 }, uYozCol: { value: new THREE.Color(1.0, 0.8, 0.74).multiplyScalar(1.5) }, uWind: { value: 0 }, uBloom: { value: 0 }, uSakuraV: { value: new Array(A.sakuraN).fill(0) }, uCherryBareV: { value: new Array(A.sakuraN).fill(0) }, uAutumn: { value: 0 }, uFall: { value: fall }, uBare: { value: 0 }, uDecid: { value: decid } };
    const petalFall = new Array(A.sakuraN).fill(0); // how fast each cherry variety sheds its petals (0..1)
    const city = Object.entries(mix || I.mix).filter(([k, w]) => I.species[k] && w > 0);
    // the species drawn: the city's, then any only an area plants (weight 0 in the city's own mix)
    // an area is a circle, an outline (xy) or several (parts: the stretches of an avenue), each outline
    // with its bounding box, to test a tree against it only when it is near
    const zones = (areas || []).filter(a => a && a.mix && ((a.at && a.radius > 0) || (a.xy && a.xy.length > 2) || (a.parts && a.parts.length))).map(a => {
      const polys = (a.parts || (a.xy ? [a.xy] : [])).filter(P => P.length > 2).map(P => {
        const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
        return { P, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
      });
      return Object.assign({}, a, { polys });
    });
    const inZone = (a, x, y) => a.polys.length ? a.polys.some(({ P, box }) => x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3] && inPoly(x, y, P))
      : (x - a.at[0]) ** 2 + (y - a.at[1]) ** 2 < a.radius * a.radius;
    const woodMix = Object.entries(woods || {}).filter(([k, w]) => I.species[k] && w > 0);
    const extra = [...new Set(zones.flatMap(a => Object.keys(a.mix).concat(Object.keys(a.woods || {}))).concat(woodMix.map(([k]) => k)))]
      .filter(k => I.species[k] && !city.some(([c]) => c === k));
    const weights = city.concat(extra.map(k => [k, 0]));
    // a wood has no palms (unless the city has nothing else), unless the city gives its woods a mix of their own
    const cityW = weights.map(([, w]) => w), total = cityW.reduce((a, w) => a + w, 0);
    const woodTotal = weights.reduce((a, [k, w]) => a + (k === 'palm' ? 0 : w), 0) || total;
    const woodW = woodMix.length ? weights.map(([k]) => Math.max(0, +(woods[k] || 0)))
      : weights.map(([k, w]) => (k === 'palm' && woodTotal !== total ? 0 : w));
    const zoneW = zones.map(a => weights.map(([k]) => Math.max(0, +a.mix[k] || 0)));
    const zoneWood = zones.map((a, z) => (a.woods ? weights.map(([k]) => Math.max(0, +a.woods[k] || 0)) : zoneW[z]));
    // a species by a hash of the position, from a weight per species (never one weighted 0)
    const pick = (u, W) => {
      const tot = W.reduce((a, w) => a + w, 0);
      let r = u * tot, last = 0;
      for (let k = 0; k < W.length; k++) { if (W[k] <= 0) continue; last = k; if ((r -= W[k]) <= 0) return k; }
      return last;
    };
    // materials: one leaf atlas for all, bark and far crowns per species
    let atlas = null;
    lib.gltf.scene.traverse(o => { if (o.isMesh && o.material.name === 'Leaves') atlas = o.material.map; });
    const leafMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 });
    leafMat.onBeforeCompile = shader(U, true, false, A);
    const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
    leafDepth.onBeforeCompile = shader(U, true, true, A);
    const solidDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    solidDepth.onBeforeCompile = shader(U, false, true, A);
    const mats = {};
    const matFor = name => {
      if (name === 'Leaves') return leafMat;
      if (!mats[name]) {
        const [kind, sp] = name.split('_'), S = I.species[sp];
        const bands = kind === 'Bark' && S.bark_bands;
        mats[name] = new THREE.MeshStandardMaterial({ color: kind === 'Bark' ? lin(S.bark) : lin(S.colour).multiplyScalar(0.8), roughness: bands ? 0.7 : kind === 'Bark' ? 0.92 : 0.88 });
        if (bands) mats[name].defines = { BARK_BANDS: '' };
        mats[name].onBeforeCompile = shader(U, false, false, A);
      }
      return mats[name];
    };
    // which species each tree is, its matrix and its tint
    const lit = new Float32Array(n), isCherry = new Set(varieties.map(o => o.sp)), litVar = new Set();
    const which = new Int16Array(n), far = new Float32Array(n).fill(1), half = new Uint8Array(n), M = new Float32Array(n * 16), tint = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const names = weights.map(([k]) => k), count = names.map(() => 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), at = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = list[4 * i] / 10, y = list[4 * i + 1] / 10, z = list[4 * i + 2] / 10, h = list[4 * i + 3] / 10;
      const wood = i >= measured && i < fixed; // (a landmark's own trees are each placed: never thinned out)
      const zi = zones.findIndex(a => inZone(a, x, y));
      const k = pick(hash(x, y), zi >= 0 ? (wood ? zoneWood[zi] : zoneW[zi]) : wood ? woodW : cityW);
      which[i] = k; count[k]++;
      if (zi >= 0 && zones[zi].yozakura && isCherry.has(weights[k][0])) { lit[i] = 1; litVar.add(varieties.find(o => o.sp === weights[k][0]).v); }
      if (wood) { half[i] = hash(x + 5, y + 9) > 0.5 ? 1 : 0; far[i] = 0.55 + 0.01 * hash(x + 7, y); } // a wood's trees step down sooner (full within 72 m, sparse within 200 m): there are many of them
      if (wood && keep < 1 && hash(y + 3, x) > keep) { M[16 * i + 15] = 1; pos[3 * i + 1] = -1e4; continue; } // left out: shrunk to a point
      const s = i >= measured ? Math.min(1.5, Math.max(0.4, h / (I.species[weights[k][0]].height_m || 16)))
        : 0.78 + 0.44 * Math.min(1, Math.max(0, (h - 7) / 7));
      q.setFromAxisAngle(up, hash(y, x) * Math.PI * 2);
      m4.compose(at.set(x, z - 0.05, -y), q, sc.set(s, s * (0.92 + 0.16 * hash(x + 1, y)), s));
      m4.toArray(M, 16 * i);
      pos[3 * i] = x; pos[3 * i + 1] = z + 4; pos[3 * i + 2] = -y;
      // each tree its own shade; a wood's deeper and more varied, as the crowns of a wood are in a photograph
      if (wood) { const l = 0.68 + 0.36 * hash(x, y + 1), w = hash(x + 2, y); c.setRGB(l * (0.93 + 0.1 * w), l, l * (0.98 - 0.08 * w)); }
      else c.setHSL(0, 0, 0.86 + 0.24 * hash(x, y + 1));
      c.toArray(tint, 3 * i);
    }
    // per species and distance, one instanced mesh per material
    const meshes = names.map((sp, k) => [0, 1, 2].map(lod => {
      const node = lib.gltf.scene.getObjectByName(`${sp}_LOD${lod}`), out = [];
      if (!node || !count[k]) return out;
      node.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.setAttribute('tc', g.getAttribute('color'));
        g.deleteAttribute('color');
        const mat = matFor(o.material.name), leaves = mat === leafMat;
        const im = new THREE.InstancedMesh(g, mat, count[k]);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count[k] * 3), 3);
        g.setAttribute('aLit', new THREE.InstancedBufferAttribute(new Float32Array(count[k]), 1)); // (yozakura: lit or not)
        im.customDepthMaterial = leaves ? leafDepth : solidDepth;
        // the far crown hulls stand 200-900 m off, mostly past the sun's shadow map: they would only be drawn into it
        // for nothing (on Hong Kong's wooded hill they are half the trees' triangles), so they cast none
        im.castShadow = lod < 2; im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        world.add(im);
        out.push(im);
      });
      return out;
    }));
    let yozBloom = 0;
    const Y = yozakura();
    const PT = petals();
    const WOOD_M = keep < 1 ? 600 : 900, L = I.lod_m || [130, 520], last = new THREE.Vector3(1e9, 0, 0), cam = new THREE.Vector3();
    // re-sort the trees into near, mid and far when the camera has moved far enough
    function sort(eye) {
      for (const per of meshes) for (const parts of per) for (const im of parts) im.count = 0;
      if (PT) PT.gather(eye);
      const n0 = L[0] * L[0], n1 = L[1] * L[1];
      // from higher up a wood is seen further, and only as crowns: its reach grows with the camera's height
      const WM = Math.min(keep < 1 ? 1200 : 2200, WOOD_M + (keep < 1 ? 1 : 2) * Math.max(0, eye.y - 60));
      for (let i = 0; i < n; i++) {
        if (M[16 * i] === 0 && M[16 * i + 2] === 0) continue; // left out, or not drawn where the game has no ground for it
        const dx = pos[3 * i] - eye.x, dy = pos[3 * i + 1] - eye.y, dz = pos[3 * i + 2] - eye.z, e2 = dx * dx + dy * dy + dz * dz, f = far[i];
        // beyond WOOD_M a wood is the photo's canopy (world.js woodsFloor): its trees thin out towards it
        if (f < 1 && e2 > WM * WM * (0.55 + 45 * (f - 0.55)) ** 2) continue;
        const lod = e2 < n0 * f * f ? 0 : e2 < n1 * (f < 1 ? 0.15 : 1) ? 1 : 2;
        if (lod === 2 && half[i]) continue; // past 200 m half a wood's crowns stand for all (they overlap)
        const parts = meshes[which[i]][lod];
        for (const im of parts) {
          const j = im.count++;
          im.instanceMatrix.array.set(M.subarray(16 * i, 16 * i + 16), 16 * j);
          im.instanceColor.array.set(tint.subarray(3 * i, 3 * i + 3), 3 * j);
          im.geometry.attributes.aLit.array[j] = lit[i];
        }
      }
      for (const per of meshes) for (const parts of per) for (const im of parts) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.geometry.attributes.aLit.needsUpdate = true; }
    }
    // ------------------------------------------------------------ falling petals (#223)
    // the petals a cherry sheds, drifting down round the nearest cherries while they flower, and most as their
    // bloom goes over (hanafubuki). One instanced mesh of small petal cards, whose fall, drift and tumble are a pure
    // function of time and each card's seed in the vertex shader (no work per frame on the CPU): each card falls
    // from a point in one of the K nearest shedding crowns to the ground under it, and starts again from another
    // crown chosen afresh each time; the crowns are gathered when the trees are sorted (the camera moved 12 m).
    // 3,000 cards (900 on a light device) of 2 triangles; nothing is drawn out of flower.
    function petals() {
      const spV = names.map(sp => { const o = varieties.find(v => v.sp === sp); return o ? o.v : -1; });
      if (!spV.some(v => v >= 0) || !which.some(k => spV[k] >= 0)) return null;
      const K = 12, N = small ? 900 : 3000;
      const uC = { value: Array.from({ length: K }, () => new THREE.Vector4()) }, uD = { value: Array.from({ length: K }, () => new THREE.Vector4()) };
      const uN = { value: 0 };
      const g = new THREE.InstancedBufferGeometry();
      // a petal: a card 10 cm long (a petal is 1.5 cm; at that size it would be lost past a few metres), its outline cut in the fragment shader (an obovate with a notch at its tip)
      const base = new THREE.PlaneGeometry(0.1, 0.082);
      g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('normal', base.getAttribute('normal')); g.setAttribute('uv', base.getAttribute('uv'));
      const seed = new Float32Array(N * 4);
      for (let i = 0; i < N * 4; i++) seed[i] = hash(i * 0.7131 + 3.1, i * 0.3177 + 1.7);
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
      g.instanceCount = N;
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.86, 0.89), roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.5 });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uPT: U.uWind, uPC: uC, uPD: uD, uPN: uN, uPYoz: U.uYoz });
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
attribute vec4 aSeed; uniform float uPT; uniform vec4 uPC[${K}]; uniform vec4 uPD[${K}]; uniform float uPN; varying vec2 vPUv; varying float vPLit;
float ph(float n) { return fract(sin(n) * 43758.5453); }
mat3 prot(vec3 a, float t) { a = normalize(a); float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x*a.x*k, a.y*a.x*k + a.z*s, a.z*a.x*k - a.y*s, a.x*a.y*k - a.z*s, c + a.y*a.y*k, a.z*a.y*k + a.x*s, a.x*a.z*k + a.y*s, a.y*a.z*k - a.x*s, c + a.z*a.z*k); }`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float pL = 6.0 + 4.0 * aSeed.y;                         // one turn's length (s): its fall, then 1.5 s on the ground
float pc = uPT / pL + aSeed.z, ci = floor(pc), pt = fract(pc) * pL;
float r1 = ph(ci * 1.37 + aSeed.x * 91.7), r2 = ph(ci * 2.11 + aSeed.w * 53.3), r3 = ph(ci * 0.73 + aSeed.y * 17.9), r4 = ph(ci * 3.07 + aSeed.z * 29.1);
int pk = int(min(floor(r1 * r1 * uPN), ${K - 1}.0));   // (the crowns are sorted nearest first: more fall near the eye)
vec4 pC = uPC[0], pD = uPD[0];
for (int j = 0; j < ${K}; j++) if (j == pk) { pC = uPC[j]; pD = uPD[j]; }
float pOn = step(r4, pD.z) * step(0.5, uPN);              // this crown sheds this many of its cards
float pa = r2 * 6.2832, pr = pC.w * sqrt(r3);
float py0 = pD.x + (pD.y - pD.x) * r4 / max(pD.z, 1e-3);   // from a height in the crown
float pv = (py0 + 0.1) / (pL - 1.5), pfall = pt * pv, py = max(py0 - pfall, 0.03);   // 0.6-1.9 m/s
float pland = step(py0 - 0.03, pfall);                     // on the ground: it lies there until its turn ends
float pft = min(pfall, py0) / pv;                              // how long it has been falling (s)
vec3 pw = vec3(0.94, 0.0, 0.34) * pft * (0.9 + 0.7 * aSeed.z); // the breeze carries it 1-1.6 m/s while it falls,
pw += vec3(-0.34, 0.0, 0.94) * pft * (aSeed.w - 0.5) * 0.8;    // spread across it
vec3 pP = pC.xyz + vec3(cos(pa) * pr, py, sin(pa) * pr) + pw
        + vec3(sin(pt * 1.7 + aSeed.x * 6.0), 0.0, cos(pt * 1.3 + aSeed.y * 6.0)) * 0.6 * (1.0 - pland);
mat3 pR = pland > 0.5 ? mat3(1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 0.0) : prot(vec3(aSeed.x - 0.5, 0.6, aSeed.w - 0.5), pt * (2.5 + 3.0 * aSeed.z) + aSeed.y * 6.0);
float pS = pOn * smoothstep(0.0, 0.6, pt) * (1.0 - smoothstep(pL - 1.2, pL, pt)) * (0.75 + 0.5 * aSeed.x);
objectNormal = pR * objectNormal;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = pP + pR * (position * pS); vPUv = uv; vPLit = pD.w * (1.0 - smoothstep(4.0, 9.0, length(pw)));`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPUv; varying float vPLit; uniform float uPYoz;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.74) * 0.7 * vPLit * uPYoz;')
          .replace('#include <alphatest_fragment>', `vec2 pq = vPUv * 2.0 - 1.0;
float pin = 1.0 - length(vec2(pq.x * (1.15 - 0.35 * pq.y), pq.y));       // an obovate, wider at its tip
if (pin < 0.0 || (pq.y > 0.55 && abs(pq.x) < 0.16 * (pq.y - 0.55) / 0.45 + 0.02)) discard;   // the notch
diffuseColor.rgb *= mix(vec3(1.0, 0.82, 0.86), vec3(1.0), smoothstep(-1.0, 0.2, pq.y));`);
      };
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.visible = false; mesh.name = 'petals';
      world.add(mesh);
      const near = [];
      return {
        mesh, crowns: () => (mesh.visible ? near.length : 0),
        // the K nearest drawn cherries whose variety is shedding, within 90 m
        gather(eye) {
          near.length = 0;
          if (!petalFall.some(v => v > 0)) { mesh.visible = false; uN.value = 0; return; }
          for (let i = 0; i < n; i++) {
            const v = spV[which[i]];
            if (v < 0 || !(petalFall[v] > 0) || (M[16 * i] === 0 && M[16 * i + 2] === 0)) continue;
            const d2 = (pos[3 * i] - eye.x) ** 2 + (pos[3 * i + 2] - eye.z) ** 2;
            if (d2 > 8100) continue;
            if (near.length < K) near.push([d2, i]); else if (d2 < near[K - 1][0]) near[K - 1] = [d2, i]; else continue;
            near.sort((a, b) => a[0] - b[0]);
          }
          near.forEach(([, i], j) => {
            const h = list[4 * i + 3] / 10, foot = pos[3 * i + 1] - 4, v = spV[which[i]];
            uC.value[j].set(pos[3 * i], foot, pos[3 * i + 2], 0.55 * h);
            uD.value[j].set(0.35 * h, 0.9 * h, petalFall[v], lit[i]); // (lit: a yozakura tree's uplights catch its petals after dark)
          });
          uN.value = near.length; mesh.visible = near.length > 0;
        },
      };
    }

    // ------------------------------------------------------------ yozakura (#162)
    // the lit places' lights: a soft pool on the ground round each lit tree's foot and each lantern's, bonbori
    // (a post, a washi shade lit from inside, a halo) along the mapped footways in the area, every 7 m on
    // alternate sides (14 m on the light tier), or beside every other lit tree where no footway is mapped
    function yozakura() {
      const yz = zones.filter(a => a.yozakura);
      if (!yz.length || !lit.some(v => v)) return null;
      const glowTex = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r; g.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c); return t;
      })();
      // the lanterns: x, y, z (ground)
      const L = [], cellOf2 = new Map(), near = (x, y, r) => {
        for (let gx = Math.floor(x / 8) - 1; gx <= Math.floor(x / 8) + 1; gx++) for (let gy = Math.floor(y / 8) - 1; gy <= Math.floor(y / 8) + 1; gy++)
          for (const [a, b] of cellOf2.get(gx * 100003 + gy) || []) if ((a - x) ** 2 + (b - y) ** 2 < r * r) return true;
        return false;
      };
      const add = (x, y, z) => {
        if (L.length >= (small ? 240 : 900) || near(x, y, 3)) return;
        const key = Math.floor(x / 8) * 100003 + Math.floor(y / 8);
        if (!cellOf2.has(key)) cellOf2.set(key, []);
        cellOf2.get(key).push([x, y]); L.push([x, y, z]);
      };
      const inYoz = (x, y) => yz.some(a => inZone(a, x, y));
      const spacing = small ? 14 : 7;
      if (foot && foot.foot && foot.foot_pts) {
        const unpack = b64 => { const t = atob(b64), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return new Int16Array(u.buffer); };
        const FI = unpack(foot.foot), FP = unpack(foot.foot_pts), [XY, ZU] = foot.units || [0.25, 0.1];
        for (let i = 0, k = 0; i < FI.length; i += 3) {
          const m = FI[i + 2], P = [];
          for (let j = 0; j < m; j++, k += 3) P.push([FP[k] * XY, FP[k + 1] * XY, FP[k + 2] * ZU]);
          let next = spacing * 0.5, acc = 0, side = 1;
          for (let j = 1; j < P.length; j++) {
            const [ax, ay, az] = P[j - 1], [bx, by, bz] = P[j], len = Math.hypot(bx - ax, by - ay);
            if (len < 0.01) continue;
            const ux = (bx - ax) / len, uy = (by - ay) / len;
            for (; next <= acc + len; next += spacing) {
              const t = (next - acc) / len, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
              if (!inYoz(px, py)) continue;
              side = -side;
              add(px - uy * side * 1.5, py + ux * side * 1.5, az + (bz - az) * t);
            }
            acc += len;
          }
        }
      }
      // where a lit place has no footway mapped through it: beside every other lit tree
      for (let i = 0; i < n; i++) if (lit[i] && (i & 1) && !(M[16 * i] === 0 && M[16 * i + 2] === 0)) {
        const x = pos[3 * i], y = -pos[3 * i + 2], a = hash(x + 3, y + 7) * Math.PI * 2;
        if (!near(x, y, spacing * 1.2)) add(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, pos[3 * i + 1] - 4);
      }
      const nL = L.length, nT = lit.reduce((a, v) => a + v, 0);
      // the bonbori: a dark post with a cap, a washi shade glowing from inside, a halo round it
      const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.045, 1.3, 6).translate(0, 0.65, 0), new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 0.8 }), Math.max(1, nL));
      const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf1e7d6, roughness: 0.9, emissive: new THREE.Color(1.0, 0.62, 0.32), emissiveIntensity: 0 });
      const shade = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.15, 0.44, 10).translate(0, 1.5, 0), shadeMat, Math.max(1, nL));
      const cap = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.2, 0.08, 10).translate(0, 1.76, 0), post.material, Math.max(1, nL));
      const haloPos = new Float32Array(nL * 3);
      const halo = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(haloPos, 3)),
        new THREE.PointsMaterial({ map: glowTex, size: 1.5, sizeAttenuation: true, color: new THREE.Color(1.0, 0.66, 0.38), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.frustumCulled = false;
      // the pools: a disc on the ground round each lit tree (its uplights) and each lantern
      const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.0, 0.78, 0.62), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
      const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, Math.max(1, nT + nL));
      for (const m of [post, shade, cap, pool]) { m.frustumCulled = false; m.castShadow = m !== pool; m.receiveShadow = m !== pool; m.count = 0; }
      pool.castShadow = false; pool.renderOrder = 1;
      const group = new THREE.Group(); group.name = 'yozakura'; group.visible = false;
      group.add(post, shade, cap, pool); if (!small) group.add(halo);
      world.add(group);
      // stand them on the ground (ground(x, y, z): the game's, after a reseat; else the data's heights)
      const place = ground => {
        const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
        L.forEach(([x, y, z], j) => {
          const g = ground ? ground(x, y, z) : z, zz = g == null ? z : g;
          m4.compose(new THREE.Vector3(x, zz, -y), q0.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(x, y) * 6.28), new THREE.Vector3(1, 0.92 + 0.16 * hash(y, x), 1));
          post.setMatrixAt(j, m4); shade.setMatrixAt(j, m4); cap.setMatrixAt(j, m4);
          haloPos.set([x, zz + 1.5, -y], 3 * j);
          m4.makeScale(4.4, 1, 4.4).setPosition(x, zz + 0.12, -y); pool.setMatrixAt(j, m4);
        });
        let j = nL;
        for (let i = 0; i < n; i++) if (lit[i] && !(M[16 * i] === 0 && M[16 * i + 2] === 0)) {
          const s = Math.hypot(M[16 * i], M[16 * i + 2]), r = 10 * s;
          m4.makeScale(r, 1, r).setPosition(pos[3 * i], pos[3 * i + 1] - 4 + 0.12, pos[3 * i + 2]); pool.setMatrixAt(j++, m4);
        }
        post.count = shade.count = cap.count = nL; pool.count = j;
        for (const m of [post, shade, cap, pool]) m.instanceMatrix.needsUpdate = true;
        halo.geometry.attributes.position.needsUpdate = true;
      };
      place(null);
      return {
        group, place, lanterns: nL, trees: nT,
        // per frame: how lit they are (after dark, in the bloom), and the season (whether they are out at all)
        set(k, out) {
          group.visible = out;
          shadeMat.emissiveIntensity = 2.6 * k; halo.material.opacity = 0.85 * k; poolMat.opacity = 0.32 * k;
        },
      };
    }

    return {
      n, species: names, count,
      // the yozakura lights (#162): how many trees are lit and how many lanterns stand, for the tools
      yozakura: () => (Y ? { trees: Y.trees, lanterns: Y.lanterns, on: U.uYoz.value, out: Y.group.visible } : null),
      // the falling petals (#223): how many cards there are and round how many crowns they fall now, for the tools
      petals: () => (PT ? { cards: PT.mesh.geometry.instanceCount, crowns: PT.crowns(), visible: PT.mesh.visible } : null),
      // the season the trees show: flowering, autumn colour and how bare the deciduous ones are (0..1)
      season: () => ({ bloom: U.uBloom.value, sakura: U.uSakuraV.value[0], varieties: Object.fromEntries(varieties.map(({ sp, v }) => [sp, U.uSakuraV.value[v]])), autumn: U.uAutumn.value, bare: U.uBare.value }),
      // the species of tree i (an index into species) and where it stands (x, y local metres), for the tools
      kind: i => which[i], at: i => (M[16 * i] === 0 && M[16 * i + 2] === 0 ? null : [list[4 * i] / 10, list[4 * i + 1] / 10]), // (null: not drawn)
      // the foot of each tree that is drawn and its trunk's radius: x, y, z, r (local metres)
      trunks() {
        const out = [];
        for (let i = 0; i < n; i++) {
          const s = Math.hypot(M[16 * i], M[16 * i + 2]);
          const S = I.species[names[which[i]]];
          if (s > 0) out.push(pos[3 * i], -pos[3 * i + 2], pos[3 * i + 1] - 4, ((S && S.trunk_r) || TRUNK[names[which[i]]] || 0.35) * s);
        }
        return out;
      },
      // per frame: the wind, and the level of detail when the camera has moved 12 m
      update(camera, tSec) {
        U.uWind.value = tSec % 10000;
        if (Y) { const k = (night ? night.value : 0) * yozBloom; U.uYoz.value = k; Y.set(k, yozBloom > 0); }
        camera.getWorldPosition(cam);
        if (cam.distanceToSquared(last) > 144) { last.copy(cam); sort(cam); }
      },
      // stand each tree on the ground at its foot: ground(x, y, z) for the height the data gives
      // (the game's finer terrain, which the survey grid's heights can be above or below), or null
      // for a tree not to draw
      reseat(ground) {
        for (let i = 0; i < n; i++) {
          if (i >= fixed) continue; // a landmark's own tree: on its planter or terrace, not the ground under it
          const z = ground(list[4 * i] / 10, list[4 * i + 1] / 10, list[4 * i + 2] / 10);
          if (z == null) { M.fill(0, 16 * i, 16 * i + 15); M[16 * i + 15] = 1; continue; } // shrunk to a point
          if (M[16 * i] === 0 && M[16 * i + 2] === 0) continue; // one left out
          M[16 * i + 13] = z - 0.05; pos[3 * i + 1] = z + 4;
        }
        if (Y) Y.place(ground);
        last.set(1e9, 0, 0); // sorted again at the next update
      },
      // jacarandas flower from mid October to November in the south, May and June in the north;
      // maples, ginkgos and zelkovas turn from mid November in the north (late April in the south), over a
      // fortnight, and keep their colour until their leaves fall: the deciduous trees (plane, elm, maple,
      // zelkova, ginkgo) drop them from late November to mid December (June in the south) and leaf out again
      // from late March to mid April (late September to mid October); cherries flower on their bare branches
      // for a fortnight from their opening day (sakuraOpen), opening over a week and shedding their petals over
      // five days, and leaf out as the petals fall
      setSeason(month, day) {
        const doy = Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 864e5);
        U.uBloom.value = south ? +(doy >= 285 && doy <= 334) : +(doy >= 130 && doy <= 178);
        last.set(1e9, 0, 0); // the shedding cherries gathered again at the next update
        const given = typeof cherry === 'string' ? cherry.split('-').map(Number) : null; // city.json trees.cherry_open, "MM-DD"
        const open = given ? Math.round((Date.UTC(2001, given[0] - 1, given[1]) - Date.UTC(2001, 0, 1)) / 864e5) : cherry != null ? cherry : (sakuraOpen(lat != null ? lat : south ? -SAKURA_LAT : SAKURA_LAT) + (south ? 182 : 0)) % 365;
        const d = (doy + (south ? 182 : 0)) % 365; // the day in a northern year
        const ramp = 14, clamp = v => Math.max(0, Math.min(1, v));
        // bare: falling 328-348 (24 November-14 December: Midosuji's and Jingu Gaien's ginkgos are bare by mid
        // December), bare until 80, leafing 80-104 (21 March-14 April)
        U.uBare.value = d >= 328 ? clamp((d - 328) / 20) : d < 80 ? 1 : clamp((104 - d) / 24);
        // turned from 304-318 until the leaves have fallen; new leaves are green
        U.uAutumn.value = d >= 304 ? clamp((d - 304) / ramp) : d < 80 ? 1 : 0;
        // a cherry's leaves: none until its petals start to fall (whatever the other trees do), then out as they go
        // (hazakura), and after that as the others'
        // each variety on its own day, its bloom stretched by its own length (and the lit places' lights while
        // any of their cherries flower: the light-ups run from the first flowers to the petals' fall)
        yozBloom = 0;
        for (const { v, off, len } of varieties) {
          const t = ((doy - open - off + 730 + 30) % 365 - 30) / len; // days since this variety opened
          U.uSakuraV.value[v] = t < 0 || t > 17 ? 0 : t < 7 ? 0.35 + 0.65 * t / 7 : t <= 12 ? 1 : 1 - (t - 12) / 5.5;
          const ct = ((doy - open - off + 730 + 60) % 365 - 60) / len;
          if (litVar.has(v)) yozBloom = Math.max(yozBloom, U.uSakuraV.value[v] > 0 ? 1 : 0);
          // the petals fall: a few in full bloom, most as it goes over, none once it has
          petalFall[v] = t < 6 || t > 17.5 ? 0 : t <= 11 ? 0.15 : 0.15 + 0.85 * Math.min(1, (t - 11) / 2) * (t > 16 ? (17.5 - t) / 1.5 : 1);
          U.uCherryBareV.value[v] = ct < -45 || ct > 17 ? U.uBare.value : ct < 12 ? 1 : 1 - (1 - U.uBare.value) * (ct - 12) / 5;
        }
        for (const [name, m] of Object.entries(mats)) {
          const S = I.species[name.split('_')[1]];
          if (!name.startsWith('Crown_') || !S) continue;
          if (S.autumn_colour) m.color.copy(lin(S.colour).lerp(lin(S.autumn_colour), U.uAutumn.value).multiplyScalar(0.8));
          // a deciduous tree's far crown goes when half its leaves have (its trunk stays); a cherry's is its
          // blossom's pink while it flowers
          if (S.deciduous) m.visible = U.uBare.value < 0.5;
          const sv = S.cell != null ? S.cell - A.sakura : -1, sak = sv >= 0 && sv < A.sakuraN ? U.uSakuraV.value[sv] : 0;
          if (S.bloom_colour && sak > 0) {
            m.color.copy(lin(S.bloom_colour).multiplyScalar(0.8));
            m.visible = sak >= 0.5;
          }
        }
      },
    };
  }

  return { load, create };
})();
