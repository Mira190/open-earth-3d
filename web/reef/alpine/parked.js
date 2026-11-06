// Parked cars in an alpine site's car parks (parking.json, pipeline/alpine_parking.py: OpenStreetMap's stalls), so
// Tekapo's car parks are not empty tarmac, and cover the few cars the aerial photograph still has printed in it
// (pipeline/aerial_clean.py fills most of them). The shared Blender cars (web/assets/vehicles/cars.glb, the models
// every city's game drives) at their middle level of detail, one instanced mesh per model and material, each car in
// a stall along its long side, nose in or out, standing on the ground as it is drawn; a car in most stalls by day,
// a third of them overnight (the hour the site opens at). Lit by the scene's sun light, which takes the mountains'
// shadow where the viewer is (main.js), as the traffic is. ?parked=0 leaves them out.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from '../../gltf.js';

const MODELS = [['Car_SUV', 0.34], ['Car_Hatch', 0.28], ['Car_Sedan', 0.24], ['Car_Van', 0.14]];
// (traffic.js's colours: white and silver commonest, a judgement from photographs)
const COLOURS = [['#f1f1ef', 0.27], ['#b9bcc0', 0.18], ['#5d6268', 0.14], ['#1b1c1e', 0.13], ['#24467a', 0.1], ['#9e1f24', 0.08], ['#d9d4c7', 0.05], ['#2f4a3a', 0.05]];
const pick = (list, r) => { let a = 0; for (const [v, w] of list) { a += w; if (r < a) return v; } return list[0][0]; };

export async function init(ctx) {
  const { S, scene, q } = ctx;
  if (S.kind !== 'alpine' || q.get('parked') === '0' || !ctx.height) return null;
  const base = `../data/${S.id}/`;
  const park = await fetch(base + 'parking.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!park || !park.stalls || !park.stalls.length) return null;
  const [glb, info] = await Promise.all([
    new GLTFLoader().loadAsync(new URL('../../assets/vehicles/cars.glb', import.meta.url).href),
    fetch(new URL('../../assets/vehicles/vehicles.json', import.meta.url).href).then(r => r.json()),
  ]);
  const I = info.cars;
  glb.scene.updateMatrixWorld(true);
  // each model's parts at its middle level of detail, in the car's own frame (x across, y up, z forward)
  const parts = {};
  for (const [name] of MODELS) {
    const node = glb.scene.getObjectByName(`${name}_LOD1`) || glb.scene.getObjectByName(name);
    if (!node || !I.models[name]) continue;
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), list = [];
    node.traverse(o => { if (o.isMesh) list.push({ g: o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)), mat: o.material }); });
    parts[name] = list;
  }
  // which stalls have a car (a fixed share by the hour, the same stalls each visit)
  let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const hr = (new Date(ctx.clockMs ? ctx.clockMs() : Date.now()).getUTCHours() + 13) % 24;   // New Zealand's hour (daylight time)
  const share = hr >= 9 && hr < 18 ? 0.72 : hr >= 7 && hr < 21 ? 0.5 : 0.32;
  const datum = 0, cars = {};
  for (const [x, n, hdg, L, W] of park.stalls) {
    const r = rnd(), name = pick(MODELS, rnd()), colour = pick(COLOURS, rnd()), flip = rnd() < 0.5, jitter = (rnd() - 0.5) * 0.25;
    if (r > share || !parts[name]) continue;
    const M = I.models[name];
    if (M.length_m > L + 0.6) continue;   // (a van in a short stall)
    const h = (hdg + (flip ? 180 : 0)) * Math.PI / 180, y = ctx.height(x, n) - datum;
    (cars[name] || (cars[name] = [])).push({ x: x + Math.cos(h) * jitter, n: n - Math.sin(h) * jitter, y, h, colour: new THREE.Color(colour).convertSRGBToLinear() });
  }
  const group = new THREE.Group(); group.name = 'parked cars';
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let count = 0;
  for (const [name, list] of Object.entries(cars)) {
    for (const p of parts[name]) {
      // the paint takes each car's colour (instanceColor multiplies the material's): a white copy of the paint
      const paint = /^Paint/.test(p.mat.name || '');
      const mat = paint ? p.mat.clone() : p.mat;
      if (paint) mat.color.set(0xffffff);
      const im = new THREE.InstancedMesh(p.g, mat, list.length);
      list.forEach((c, i) => {
        // the car's forward (+z) along the stall's bearing h (clockwise from north): world (sin h, 0, -cos h)
        qt.setFromAxisAngle(up, Math.PI - c.h);
        m4.compose(pos.set(c.x, c.y, -c.n), qt, one);
        im.setMatrixAt(i, m4);
        if (paint) im.setColorAt(i, c.colour);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;   // (spread over a township: one bound per mesh)
      group.add(im);
    }
    count += list.length;
  }
  scene.add(group);
  ctx.parked = { group, count, stalls: park.stalls.length };
  return null;
}
