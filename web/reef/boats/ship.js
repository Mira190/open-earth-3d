// The ship: a model built in Blender (blender/build_ship.py -> assets/vehicles/ship_scow.glb, its far copy and
// ship_scow.json), where the other vessels here are built in code. buildShip() resolves to the same kind of
// description the others give boats.js: { kind, group, L, B, draft, trails, buoy, ... } in the vessel frame
// (+X the bow, +Y up, +Z starboard, y = 0 the waterline).
//   - the radar turns and the ensign flies (nodes `radar` and `flag`);
//   - the running lights and the cabin windows come on with the dusk (shared.lamp);
//   - past `farAt` metres the far copy is drawn in its place (desc.setFar).
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, sin, positionLocal, uniform } from 'three/tsl';
import { GLTFLoader } from '../../gltf.js';
import { shared } from './kit.js';

export async function buildShip(model = 'ship_scow') {
  const base = new URL('../../assets/vehicles/', import.meta.url);
  const loader = new GLTFLoader();
  const [spec, near, far] = await Promise.all([
    fetch(new URL(`${model}.json`, base)).then(r => r.json()),
    loader.loadAsync(new URL(`${model}.glb`, base).href),
    loader.loadAsync(new URL(`${model}_far.glb`, base).href).catch(() => null)]);
  const group = new THREE.Group(); group.name = 'ship';
  // the shared models face +z with +x to port (assets/vehicles/vehicles.json); a quarter turn sets the bow on +X
  const turn = /\+x\s*(forward|ahead|bow)/i.test(spec.axes || '') ? 0 : Math.PI / 2;
  const hi = near.scene, lo = far ? far.scene : null;
  hi.rotation.y = turn; group.add(hi);
  if (lo) { lo.rotation.y = turn; lo.visible = false; group.add(lo); }
  const L = spec.length_m ?? spec.loa_m ?? 40, B = spec.beam_m ?? 9, draft = spec.draft_m ?? 2.6;
  const find = n => hi.getObjectByName(n) || null;
  const radar = find('radar'), flag = find('flag');
  const flagT = uniform(0);
  const glow = [];
  hi.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    const m = o.material, name = (m && m.name) || '';
    // the lamps and the lit panes are dark by day: their emission is driven by the dusk
    if (/^light_/i.test(o.name) || /lamp|lit|glow/i.test(name)) {
      if (m && m.emissive) { const mm = m.clone(); o.material = mm; glow.push({ m: mm, k: /^light_/i.test(o.name) ? 6 : 1.4, base: mm.emissive.clone().multiplyScalar(mm.emissiveIntensity || 1) }); }
    } else if (/window|glass/i.test(name) && m) { m.envMapIntensity = 1; m.roughness = Math.min(m.roughness ?? 0.1, 0.12); }
  });
  if (flag) flag.traverse(o => {
    if (!o.isMesh) return;
    // the ensign in the wind: a wave running out from the hoist, growing toward the fly
    const mat = o.material.clone(); o.material = mat; mat.side = THREE.DoubleSide;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox, size = bb.getSize(new THREE.Vector3());
    const ax = size.x >= size.z ? 'x' : 'z', cross = ax === 'x' ? 'z' : 'x';     // the fly runs along the longer horizontal side
    const p0 = Math.abs(bb.min[ax]) < Math.abs(bb.max[ax]) ? bb.min[ax] : bb.max[ax], len = Math.max(size[ax], 1e-3);
    mat.positionNode = Fn(() => {
      const p = positionLocal, s = p[ax].sub(p0).abs().div(len);
      const w = sin(s.mul(7.5).sub(flagT.mul(7))).mul(0.5).add(sin(s.mul(13).sub(flagT.mul(11)).add(p.y.mul(3))).mul(0.25)).mul(s).mul(len * 0.16);
      const out = vec3(p).toVar(); out[cross].addAssign(w); out.y.subAssign(s.mul(s).mul(len * 0.07));
      return out;
    })();
  });
  const sx = L * 0.5, sz = B * 0.5;
  const desc = {
    kind: 'ship', group, L, B, draft, spec,
    // the stern's wash (one broad trail) and the points the hull floats on (bow, stern, the beam ends)
    trails: [[-sx * 0.94, 0, B * 0.62]],
    buoy: [[sx * 0.8, 0], [-sx * 0.8, 0], [0, sz * 0.8], [0, -sz * 0.8], [sx * 0.4, sz * 0.6], [sx * 0.4, -sz * 0.6], [-sx * 0.4, sz * 0.6], [-sx * 0.4, -sz * 0.6]],
    float: { k: 0.35 },                 // 400 tonnes: she follows a fiord's chop very little
    lamps: [], casters: [],
    farAt: 1400,
    setFar(far) { if (!lo) return; hi.visible = !far; lo.visible = far; },
    tick(dt, t) {
      if (radar) radar.rotation.y += dt * 2.5;                       // 24 turns a minute
      flagT.value = t;
      const on = shared.lamp.value;
      for (const g of glow) g.m.emissive.copy(g.base).multiplyScalar(on * g.k);
    },
    // a spot in the vessel frame from the model's own (assets/vehicles frame: +z ahead, +x to port)
    toVessel: turn ? ([x, y, z]) => [z, y, -x] : ([x, y, z]) => [x, y, z],
  };
  return desc;
}
