// Open Earth 3D trees: the street and park trees every city shares (assets/trees, built by
// blender/build_trees.py), drawn instanced per species and per distance: the full tree near
// the camera, a sparser one further off, a trunk and crown hull beyond. Each mapped tree
// takes a species from the city's mix by a hash of its position, a size from its height and
// a turn of its own. The wind sways the crowns and flutters the leaves, the leaf cards cut
// their shadows out, and jacarandas flower in late spring.
'use strict';
window.OETrees = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

  async function load(base = 'assets/trees/') {
    if (!THREE.GLTFLoader) throw new Error('GLTFLoader is not available');
    const info = await (await fetch(base + 'trees.json')).json();
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(base + info.file, res, null, rej));
    return { info, gltf };
  }

  // the colour attribute carries ambient occlusion (r), how far the wind moves a vertex (g)
  // and a flutter phase (b); renamed so no material reads it as a colour
  const VERT_HEAD = `#include <common>
attribute vec4 tc; uniform float uWind; uniform float uBloom; varying float vAO;`;
  // the jacaranda's bloom cell (column 1, row 1 of the atlas; glTF v runs down) swaps to its
  // leaf cell (column 0) out of season
  const VERT_UV = `vec2 tuv = uv;
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
vAO = tc.r;`;
  function shader(U, leaves, depth) {
    return sh => {
      sh.uniforms.uWind = U.uWind; sh.uniforms.uBloom = U.uBloom;
      if (leaves) sh.defines = Object.assign(sh.defines || {}, { LEAVES: '' });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <uv_vertex>', VERT_UV).replace('#include <begin_vertex>', VERT_WIND);
      if (depth) return;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAO;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(0.5, 1.0, vAO);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;');
      // the cards' normals point out of the crown on both faces: lit as a mass, never flipped
      if (leaves) sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
  }

  // world: the scene; list: x, y, ground, height in dm per tree (places.json); mix: species
  // weights; south: the city is in the southern hemisphere (for the flowering season)
  function create(world, lib, list, { mix = null, south = true } = {}) {
    const I = lib.info, n = list.length / 4, U = { uWind: { value: 0 }, uBloom: { value: 0 } };
    const weights = Object.entries(mix || I.mix).filter(([k, w]) => I.species[k] && w > 0), total = weights.reduce((a, [, w]) => a + w, 0);
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
    const which = new Int16Array(n), M = new Float32Array(n * 16), tint = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const names = weights.map(([k]) => k), count = names.map(() => 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), at = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = list[4 * i] / 10, y = list[4 * i + 1] / 10, z = list[4 * i + 2] / 10, h = list[4 * i + 3] / 10;
      let r = hash(x, y) * total, k = 0;
      while (k < weights.length - 1 && (r -= weights[k][1]) > 0) k++;
      which[i] = k; count[k]++;
      const s = 0.78 + 0.44 * Math.min(1, Math.max(0, (h - 7) / 7));
      q.setFromAxisAngle(up, hash(y, x) * Math.PI * 2);
      m4.compose(at.set(x, z - 0.05, -y), q, sc.set(s, s * (0.92 + 0.16 * hash(x + 1, y)), s));
      m4.toArray(M, 16 * i);
      pos[3 * i] = x; pos[3 * i + 1] = z + 4; pos[3 * i + 2] = -y;
      c.setHSL(0, 0, 0.86 + 0.24 * hash(x, y + 1)).toArray(tint, 3 * i);
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
    const L = I.lod_m || [130, 520], last = new THREE.Vector3(1e9, 0, 0), cam = new THREE.Vector3();
    // re-sort the trees into near, mid and far when the camera has moved far enough
    function sort(eye) {
      for (const per of meshes) for (const parts of per) for (const im of parts) im.count = 0;
      const n0 = L[0] * L[0], n1 = L[1] * L[1];
      for (let i = 0; i < n; i++) {
        const dx = pos[3 * i] - eye.x, dy = pos[3 * i + 1] - eye.y, dz = pos[3 * i + 2] - eye.z, d2 = dx * dx + dy * dy + dz * dz;
        const parts = meshes[which[i]][d2 < n0 ? 0 : d2 < n1 ? 1 : 2];
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
      // per frame: the wind, and the level of detail when the camera has moved 12 m
      update(camera, tSec) {
        U.uWind.value = tSec % 10000;
        camera.getWorldPosition(cam);
        if (cam.distanceToSquared(last) > 144) { last.copy(cam); sort(cam); }
      },
      // jacarandas flower from mid October to November in the south, May and June in the north
      setSeason(month, day) {
        const doy = Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 864e5);
        U.uBloom.value = south ? +(doy >= 285 && doy <= 334) : +(doy >= 130 && doy <= 178);
      },
    };
  }

  return { load, create };
})();
