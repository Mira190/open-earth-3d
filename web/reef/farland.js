// The land past a reef site's survey (pipeline/far_land.py, ../farland.js): the mainland's ranges
// behind Cairns from Green Island, the Whitsundays' islands and Conway's ridges, and after dark the
// lights of the towns along the coast. The geometry is the city viewer's (OEFarLand.geometry); here
// it takes the reef's own node materials, so the air's veil (env.medium, the scene's fog node) and
// the eye's adaptation (display-referred lights, main.js) apply to it as to everything else.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, mix, texture, positionWorld, dot, mx_noise_float } from 'three/tsl';
import { terrainHeight } from './world.js';

export async function createFarLand(base, d, env, { small = false } = {}) {
  if (!window.OEFarLand || new URLSearchParams(location.search).get('far') === 'off') return null;
  const F = await window.OEFarLand.load(base);
  if (!F) return null;
  const t = d.scene.terrain, M = F.meta, H = M.half_m;
  const frame = { x: [t.x0, t.x0 + t.w * t.cell_m], y: [t.y1 - t.h * t.cell_m, t.y1] };
  // the land past the survey stands clear of the highest tide (env.u.dryLine), so no tide floods it. An alpine site's
  // heights are above its lake, the far land's above the sea: the ground goes in as heights above the sea and the
  // whole mesh comes down by the lake's height (datum), so the two meet at the frame's edge
  const alp = d.scene.kind === 'alpine', datum = alp ? (t.datum_m || 0) : 0;
  const { geo, lights, n, tris } = window.OEFarLand.geometry(F, { frame, ground: (x, y) => terrainHeight(d, x, y) + datum, small,
    landMin: alp ? -Infinity : env.u.dryLine.value + 1.5 }, THREE);
  const col = new THREE.Texture(F.col);
  col.colorSpace = THREE.SRGBColorSpace; col.flipY = false; col.anisotropy = 4;
  col.generateMipmaps = true; col.minFilter = THREE.LinearMipmapLinearFilter; col.needsUpdate = true;
  const lit = new THREE.DataTexture(lights, n, n);
  lit.flipY = false; lit.magFilter = THREE.LinearFilter; lit.minFilter = THREE.LinearMipmapLinearFilter; lit.generateMipmaps = true; lit.needsUpdate = true;
  // row 0 of both images is the north edge
  const uv = Fn(() => vec2(positionWorld.x.sub(M.cx - H).div(2 * H), positionWorld.z.add(M.cy + H).div(2 * H)));
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  mat.colorNode = Fn(() => {
    let c = texture(col, uv()).rgb;
    // what the 117 m colour cells average away, back as a grain of bush, fields and towns
    const p = vec3(positionWorld.x, 0, positionWorld.z);
    c = c.mul(float(1).add(mx_noise_float(p.mul(1 / 400)).mul(0.12)).add(mx_noise_float(p.mul(1 / 90)).mul(0.12)));
    // seen through tens of kilometres of air its colours are thinner than the photo's close by
    return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.8);
  })();
  // after dark the towns' lights (Black Marble), display-referred like the boats' lamps; from out on the reef they
  // are a band of glow along the coast, each town far below a pixel
  mat.emissiveNode = Fn(() => {
    const L = texture(lit, uv()).r, L2 = L.mul(L);
    return vec3(1.0, 0.8, 0.55).mul(L2.mul(L)).mul(env.u.night).mul(1.4);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -datum;
  mesh.name = 'far-land';
  mesh.frustumCulled = false;
  console.info(`far land: ${tris.toLocaleString()} triangles, relief to ${M.relief_m[1]} m`);
  return { mesh, dispose() { geo.dispose(); mat.dispose(); col.dispose(); lit.dispose(); } };
}
