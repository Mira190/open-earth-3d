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
// flower on bare branches in early spring (on a date set by the city's latitude), and maples, ginkgos,
// zelkovas and cherries turn in autumn.
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
attribute vec4 tc; uniform float uWind; uniform float uBloom; uniform float uSakura; varying float vAO; varying float vCell; varying float vTurn; varying float vCard; varying float vPetal;`;
  // the atlas cell a leaf card shows (CELLS columns x ROWS; glTF v runs down): the jacaranda's bloom
  // cell and the cherry's swap to their leaf cell, one to the left, out of season; the cells that turn in
  // autumn are coloured in the fragment shader (uAutumn)
  const VERT_UV = `vec2 tuv = uv;
float cell = floor(tuv.x * ATLAS_COLS) + floor(tuv.y * ATLAS_ROWS) * ATLAS_COLS;
vCell = cell;
if (uBloom < 0.5 && abs(cell - CELL_BLOOM) < 0.5) tuv.x -= 1.0 / ATLAS_COLS;
// a cherry's card flowers while the bloom has reached it (the same order its leaves fall in), else it is a leaf
float turn0 = fract(sin(dot(vec2(instanceMatrix[3][0], instanceMatrix[3][2]), vec2(12.9898, 78.233))) * 43758.5453);
vPetal = (abs(cell - CELL_SAKURA) < 0.5 && fract(tc.b * 7.13 + turn0 * 0.37) < uSakura * (0.85 + 0.3 * turn0)) ? 1.0 : 0.0;
if (vPetal < 0.5 && abs(cell - CELL_SAKURA) < 0.5) tuv.x -= 1.0 / ATLAS_COLS;
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
vCard = tc.b; // a leaf card's own phase: which cards fall first
vTurn = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);`;
  function shader(U, leaves, depth, A) {
    return sh => {
      sh.uniforms.uWind = U.uWind; sh.uniforms.uBloom = U.uBloom; sh.uniforms.uSakura = U.uSakura; sh.uniforms.uCherryBare = U.uCherryBare; sh.uniforms.uAutumn = U.uAutumn; sh.uniforms.uFall = U.uFall;
      sh.uniforms.uBare = U.uBare; sh.uniforms.uDecid = U.uDecid;
      sh.defines = Object.assign(sh.defines || {}, { ATLAS_COLS: A.cols.toFixed(1), ATLAS_ROWS: A.rows.toFixed(1), CELL_BLOOM: A.bloom.toFixed(1), CELL_SAKURA: A.sakura.toFixed(1), CELL_MAPLE: A.maple.toFixed(1), ATLAS_CELLS: A.cols * A.rows });
      if (leaves) sh.defines.LEAVES = '';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <uv_vertex>', VERT_UV).replace('#include <begin_vertex>', VERT_WIND);
      // in winter a deciduous tree's cards fall, in the camera's pass and the shadow's alike: each card at its
      // own time (vCard), each tree a little ahead of or behind the others (vTurn); a cherry's cards in flower
      // (vPetal) stay on its bare branches, and its leaves keep to its own time (uCherryBare)
      const BARE = `uniform float uBare; uniform float uCherryBare; uniform float uDecid[ATLAS_CELLS]; varying float vCell; varying float vTurn; varying float vCard; varying float vPetal;`;
      if (leaves) sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', depth ? '#include <common>\n' + BARE : '#include <common>\nuniform float uBare; uniform float uCherryBare; uniform float uDecid[ATLAS_CELLS]; varying float vCard; varying float vPetal;')
        .replace('#include <alphatest_fragment>', `{ int bc = int(vCell + 0.5);
  float bare = abs(vCell - CELL_SAKURA) < 0.5 ? (vPetal > 0.5 ? 0.0 : uCherryBare) : uBare;
  if (abs(vCell - CELL_SAKURA) < 0.5 && vPetal < 0.5 && uCherryBare > 0.999) discard; // a cherry in winter and in flower: no leaf at all
  if (bare > 0.0 && bc >= 0 && bc < ATLAS_CELLS && uDecid[bc] > 0.5 && fract(vCard * 7.13 + vTurn * 0.37) < bare * (0.85 + 0.3 * vTurn)) discard; }
#include <alphatest_fragment>`);
      if (depth) return;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAO; varying float vCell; varying float vTurn; uniform float uAutumn; uniform vec3 uFall[ATLAS_CELLS];')
        .replace('#include <map_fragment>', `#include <map_fragment>
#if defined(LEAVES) && defined(USE_MAP)
// a leaf card's alpha, averaged down the mip chain, falls under the cut-out threshold and thin leaves (a
// she-oak's threads, a palm's leaflets, a jacaranda's) vanish with distance: scale it up with the mip level
// (Ben Golus, "Anti-aliased Alpha Test: The Esoteric Alpha To Coverage", 2017)
{ vec2 tx = vMapUv * vec2(textureSize(map, 0)); float d = max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)));
  diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(d)) * 0.25; }
#endif
diffuseColor.rgb *= mix(0.5, 1.0, vAO);
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
  function create(world, lib, list, { mix = null, woods = null, south = true, lat = null, cherry = null, measured = Infinity, keep = 1, areas = [], fixed = Infinity } = {}) {
    const I = lib.info, n = list.length / 4;
    const AT = I.atlas || {}, cells = AT.cells || {};
    const A = { cols: AT.columns || 4, rows: AT.rows || 2, bloom: cells.bloom ?? 5, sakura: cells.sakura ?? -10, maple: cells.maple ?? 7 };
    // the cherry's cards are its bloom cell's ("sakura"): they turn and fall as its own leaves
    const cellOf = sp => (I.species[sp] && I.species[sp].cell != null ? I.species[sp].cell : cells[sp]);
    const fall = Array.from({ length: A.cols * A.rows }, () => new THREE.Vector3());
    for (const [sp, f] of Object.entries(FALL)) if (I.species[sp] && cellOf(sp) != null && cellOf(sp) < fall.length) fall[cellOf(sp)].set(...f);
    // the cells of the deciduous species (trees.json deciduous): bare in winter
    const decid = Array.from({ length: A.cols * A.rows }, () => 0);
    for (const [sp, S] of Object.entries(I.species)) if (S.deciduous && cellOf(sp) != null && cellOf(sp) < decid.length) decid[cellOf(sp)] = 1;
    const U = { uWind: { value: 0 }, uBloom: { value: 0 }, uSakura: { value: 0 }, uCherryBare: { value: 0 }, uAutumn: { value: 0 }, uFall: { value: fall }, uBare: { value: 0 }, uDecid: { value: decid } };
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
        mats[name] = new THREE.MeshStandardMaterial({ color: kind === 'Bark' ? lin(S.bark) : lin(S.colour).multiplyScalar(0.8), roughness: kind === 'Bark' ? 0.92 : 0.88 });
        mats[name].onBeforeCompile = shader(U, false, false, A);
      }
      return mats[name];
    };
    // which species each tree is, its matrix and its tint
    const which = new Int16Array(n), far = new Float32Array(n).fill(1), half = new Uint8Array(n), M = new Float32Array(n * 16), tint = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const names = weights.map(([k]) => k), count = names.map(() => 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), at = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = list[4 * i] / 10, y = list[4 * i + 1] / 10, z = list[4 * i + 2] / 10, h = list[4 * i + 3] / 10;
      const wood = i >= measured && i < fixed; // (a landmark's own trees are each placed: never thinned out)
      const zi = zones.findIndex(a => inZone(a, x, y));
      const k = pick(hash(x, y), zi >= 0 ? (wood ? zoneWood[zi] : zoneW[zi]) : wood ? woodW : cityW);
      which[i] = k; count[k]++;
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
    const WOOD_M = keep < 1 ? 600 : 900, L = I.lod_m || [130, 520], last = new THREE.Vector3(1e9, 0, 0), cam = new THREE.Vector3();
    let sortedAt = -1e9;
    // re-sort the trees into near, mid and far when the camera has moved far enough
    function sort(eye) {
      for (const per of meshes) for (const parts of per) for (const im of parts) im.count = 0;
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
        }
      }
      // only the instances drawn go up to the GPU, not each mesh's whole buffer (all of them, 8 MB in a city with
      // many trees, went up at every re-sort, and a fast move such as the opening shot re-sorts on most frames)
      for (const per of meshes) for (const parts of per) for (const im of parts) for (const a of [im.instanceMatrix, im.instanceColor]) {
        if (!im.count) continue; // (nothing drawn: what the buffer holds doesn't matter; an empty range would send it all)
        if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, im.count * a.itemSize); }
        a.needsUpdate = true;
      }
    }
    return {
      n, species: names, count,
      // the season the trees show: flowering, autumn colour and how bare the deciduous ones are (0..1)
      season: () => ({ bloom: U.uBloom.value, sakura: U.uSakura.value, autumn: U.uAutumn.value, bare: U.uBare.value }),
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
      // per frame: the wind, and the level of detail when the camera has moved 12 m, at most five times a
      // second while it keeps moving (a sort walks every tree: a fast move made it most frames' work), at once
      // after a jump of 120 m
      update(camera, tSec) {
        U.uWind.value = tSec % 10000;
        camera.getWorldPosition(cam);
        const d2 = cam.distanceToSquared(last);
        if (d2 > 144 && (d2 > 14400 || !(tSec - sortedAt < 0.2))) { last.copy(cam); sortedAt = tSec; sort(cam); }
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
        const given = typeof cherry === 'string' ? cherry.split('-').map(Number) : null; // city.json trees.cherry_open, "MM-DD"
        const open = given ? Math.round((Date.UTC(2001, given[0] - 1, given[1]) - Date.UTC(2001, 0, 1)) / 864e5) : cherry != null ? cherry : (sakuraOpen(lat != null ? lat : south ? -SAKURA_LAT : SAKURA_LAT) + (south ? 182 : 0)) % 365;
        const t = (doy - open + 365 + 30) % 365 - 30; // days since the cherries opened
        U.uSakura.value = t < 0 || t > 17 ? 0 : t < 7 ? 0.35 + 0.65 * t / 7 : t <= 12 ? 1 : 1 - (t - 12) / 5.5;
        const d = (doy + (south ? 182 : 0)) % 365; // the day in a northern year
        const ramp = 14, clamp = v => Math.max(0, Math.min(1, v));
        // bare: falling 328-348 (24 November-14 December: Midosuji's and Jingu Gaien's ginkgos are bare by mid
        // December), bare until 80, leafing 80-104 (21 March-14 April)
        U.uBare.value = d >= 328 ? clamp((d - 328) / 20) : d < 80 ? 1 : clamp((104 - d) / 24);
        // turned from 304-318 until the leaves have fallen; new leaves are green
        U.uAutumn.value = d >= 304 ? clamp((d - 304) / ramp) : d < 80 ? 1 : 0;
        // a cherry's leaves: none until its petals start to fall (whatever the other trees do), then out as they go
        // (hazakura), and after that as the others'
        const ct = (doy - open + 365 + 60) % 365 - 60;
        U.uCherryBare.value = ct < -45 || ct > 17 ? U.uBare.value : ct < 12 ? 1 : 1 - (1 - U.uBare.value) * (ct - 12) / 5;
        for (const [name, m] of Object.entries(mats)) {
          const S = I.species[name.split('_')[1]];
          if (!name.startsWith('Crown_') || !S) continue;
          if (S.autumn_colour) m.color.copy(lin(S.colour).lerp(lin(S.autumn_colour), U.uAutumn.value).multiplyScalar(0.8));
          // a deciduous tree's far crown goes when half its leaves have (its trunk stays); a cherry's is its
          // blossom's pink while it flowers
          if (S.deciduous) m.visible = U.uBare.value < 0.5;
          if (S.cell != null && S.cell === A.sakura && S.bloom_colour && U.uSakura.value > 0) {
            m.color.copy(lin(S.bloom_colour).multiplyScalar(0.8));
            m.visible = U.uSakura.value >= 0.5;
          }
        }
      },
    };
  }

  return { load, create };
})();
