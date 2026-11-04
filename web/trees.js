// Open Earth 3D trees: the street and park trees every city shares (assets/trees, built by
// blender/build_trees.py), drawn instanced per species and per distance: the full tree near
// the camera, a sparser one further off, a trunk and crown hull beyond. Each mapped tree
// takes a species from the city's mix by a hash of its position, a size from its height and
// a turn of its own. The trees planted from a wood's canopy (pipeline/woods.py) come after the
// mapped ones, sized by the height the canopy model measured, in the city's mix without its palms,
// a share of them left out on a small device. The wind sways the crowns and flutters the leaves, the leaf cards cut
// their shadows out, and jacarandas flower in late spring.
'use strict';
window.OETrees = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  // each species' trunk radius above its flare (m, at full size: blender/build_trees.py r0)
  const TRUNK = { plane: 0.36, elm: 0.34, gum: 0.4, fig: 0.85, jacaranda: 0.26, palm: 0.42, maple: 0.2 };

  async function load(base = 'assets/trees/') {
    if (!THREE.GLTFLoader) throw new Error('GLTFLoader is not available');
    const info = await (await fetch(base + 'trees.json')).json();
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(base + info.file, res, null, rej));
    return { info, gltf };
  }

  // the colour attribute carries ambient occlusion (r), how far the wind moves a vertex (g)
  // and a flutter phase (b); renamed so no material reads it as a colour
  const VERT_HEAD = `#include <common>
attribute vec4 tc; uniform float uWind; uniform float uBloom; varying float vAO; varying float vMaple; varying float vTurn;`;
  // the jacaranda's bloom cell (column 1, row 1 of the atlas; glTF v runs down) swaps to its
  // leaf cell (column 0) out of season
  // the maple's cell (column 3, row 1) turns red in autumn (uAutumn, in the fragment shader)
  const VERT_UV = `vec2 tuv = uv;
vMaple = tuv.y > 0.5 && tuv.x > 0.75 ? 1.0 : 0.0;
if (uBloom < 0.5 && tuv.y > 0.5 && tuv.x > 0.25 && tuv.x < 0.5) tuv.x -= 0.25;
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
vTurn = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);`;
  function shader(U, leaves, depth) {
    return sh => {
      sh.uniforms.uWind = U.uWind; sh.uniforms.uBloom = U.uBloom; sh.uniforms.uAutumn = U.uAutumn;
      if (leaves) sh.defines = Object.assign(sh.defines || {}, { LEAVES: '' });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <uv_vertex>', VERT_UV).replace('#include <begin_vertex>', VERT_WIND);
      if (depth) return;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAO; varying float vMaple; varying float vTurn; uniform float uAutumn;')
        .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= mix(0.5, 1.0, vAO);
#ifdef LEAVES
// each maple its own turn: most a deep crimson, some scarlet, a few orange and gold, one in eight still
// half green; the leaves keep their own light and dark
if (vMaple > 0.5 && uAutumn > 0.0) { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 red = mix(vec3(1.75, 0.36, 0.26), vec3(1.95, 0.62, 0.22), smoothstep(0.45, 0.85, vTurn));
  red = mix(red, vec3(1.7, 1.15, 0.3), smoothstep(0.88, 0.97, vTurn));
  float k = uAutumn * (vTurn < 0.12 ? 0.45 : 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, red * l, k); }
#endif`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;');
      // the cards' normals point out of the crown on both faces: lit as a mass, never flipped
      if (leaves) sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
  }

  // world: the scene; list: x, y, ground, height in dm per tree (places.json trees, then woods);
  // mix: species weights; south: the city is in the southern hemisphere (for the flowering season);
  // measured: the index from which the trees are a wood's, with measured heights; keep: the share
  // of those drawn
  // areas: [{at: [x, y], radius, mix}], places whose trees take their own mix (a garden's maples)
  // fixed: the index from which the trees are a landmark's own, standing where it puts them (on a planter, a terrace)
  function create(world, lib, list, { mix = null, south = true, measured = Infinity, keep = 1, areas = [], fixed = Infinity } = {}) {
    const I = lib.info, n = list.length / 4, U = { uWind: { value: 0 }, uBloom: { value: 0 }, uAutumn: { value: 0 } };
    const city = Object.entries(mix || I.mix).filter(([k, w]) => I.species[k] && w > 0);
    // the species drawn: the city's, then any only an area plants (weight 0 in the city's own mix)
    const zones = (areas || []).filter(a => a && a.mix && a.at && a.radius > 0);
    const extra = [...new Set(zones.flatMap(a => Object.keys(a.mix)))].filter(k => I.species[k] && !city.some(([c]) => c === k));
    const weights = city.concat(extra.map(k => [k, 0]));
    // a wood has no palms (unless the city has nothing else)
    const cityW = weights.map(([, w]) => w), total = cityW.reduce((a, w) => a + w, 0);
    const woodTotal = weights.reduce((a, [k, w]) => a + (k === 'palm' ? 0 : w), 0) || total;
    const woodW = weights.map(([k, w]) => (k === 'palm' && woodTotal !== total ? 0 : w));
    const zoneW = zones.map(a => weights.map(([k]) => Math.max(0, +a.mix[k] || 0)));
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
    leafMat.onBeforeCompile = shader(U, true, false);
    const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
    leafDepth.onBeforeCompile = shader(U, true, true);
    const solidDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    solidDepth.onBeforeCompile = shader(U, false, true);
    const mats = {};
    const matFor = name => {
      if (name === 'Leaves') return leafMat;
      if (!mats[name]) {
        const [kind, sp] = name.split('_'), S = I.species[sp];
        mats[name] = new THREE.MeshStandardMaterial({ color: kind === 'Bark' ? lin(S.bark) : lin(S.colour).multiplyScalar(0.8), roughness: kind === 'Bark' ? 0.92 : 0.88 });
        mats[name].onBeforeCompile = shader(U, false, false);
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
      const zi = zones.findIndex(a => (x - a.at[0]) ** 2 + (y - a.at[1]) ** 2 < a.radius * a.radius);
      const k = pick(hash(x, y), zi >= 0 ? zoneW[zi] : wood ? woodW : cityW);
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
        im.castShadow = true; im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        world.add(im);
        out.push(im);
      });
      return out;
    }));
    const WOOD_M = keep < 1 ? 600 : 900, L = I.lod_m || [130, 520], last = new THREE.Vector3(1e9, 0, 0), cam = new THREE.Vector3();
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
      for (const per of meshes) for (const parts of per) for (const im of parts) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    }
    return {
      n, species: names, count,
      // the foot of each tree that is drawn and its trunk's radius: x, y, z, r (local metres)
      trunks() {
        const out = [];
        for (let i = 0; i < n; i++) {
          const s = Math.hypot(M[16 * i], M[16 * i + 2]);
          if (s > 0) out.push(pos[3 * i], -pos[3 * i + 2], pos[3 * i + 1] - 4, (TRUNK[names[which[i]]] || 0.35) * s);
        }
        return out;
      },
      // per frame: the wind, and the level of detail when the camera has moved 12 m
      update(camera, tSec) {
        U.uWind.value = tSec % 10000;
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
        last.set(1e9, 0, 0); // sorted again at the next update
      },
      // jacarandas flower from mid October to November in the south, May and June in the north
      // and maples go red from mid November to mid December in the north (late April to May in the south),
      // turning over a fortnight either side
      setSeason(month, day) {
        const doy = Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 864e5);
        U.uBloom.value = south ? +(doy >= 285 && doy <= 334) : +(doy >= 130 && doy <= 178);
        const [a0, a1] = south ? [115, 150] : [318, 350], ramp = 14;
        U.uAutumn.value = Math.max(0, Math.min(1, (doy - a0 + ramp) / ramp, (a1 + ramp - doy) / ramp));
        for (const [name, m] of Object.entries(mats)) {
          const S = I.species[name.split('_')[1]];
          if (name.startsWith('Crown_') && S && S.autumn_colour) m.color.copy(lin(S.colour).lerp(lin(S.autumn_colour), U.uAutumn.value).multiplyScalar(0.8));
        }
      },
    };
  }

  return { load, create };
})();
