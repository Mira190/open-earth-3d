// Landmark models on an alpine site (scene.json "landmarks", copied from city.json by pipeline/marine_meta.py):
// meshopt-compressed GLBs built in the landmark's own frame with their orientation baked in (glTF x east, y up,
// -z north, y = 0 at ground_m metres above the sea), so a landmark is only placed: at its point, at its ground
// height less the lake's (datum). Lit by the scene's sun and sky lights and veiled by the air like the rest.
// walk: "deck" makes the model's upward-facing surfaces walkable (ctx.decks; a footbridge's deck).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from '../../gltf.js';

export async function init(ctx) {
  const { S, scene } = ctx;
  const list = S.landmarks || [];
  if (S.kind !== 'alpine' || !list.length) return null;
  const datum = S.terrain.datum_m || 0;
  const loader = new GLTFLoader();
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const placed = [];
  await Promise.all(list.map(async L => {
    try {
      const g = await loader.loadAsync(new URL(`../../${L.glb}`, import.meta.url).href);
      const root = g.scene;
      root.position.set(L.x, L.ground_m - datum, -L.y);
      root.name = `landmark:${L.id}`;
      root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      placed.push({ L, root, box });
      if (L.walk === 'deck' && ctx.decks) {
        const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
        // the deck under a point: the highest upward-facing surface of the model within its outline
        ctx.decks.push((x, north) => {
          if (x < box.min.x || x > box.max.x || -north < box.min.z || -north > box.max.z) return null;
          from.set(x, box.max.y + 1, -north); ray.set(from, down); ray.far = box.max.y - box.min.y + 2;
          const hit = ray.intersectObjects(meshes, false).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
          return hit ? hit.point.y : null;
        });
      }
    } catch (e) { console.warn(`landmark ${L.id}: not loaded`, e); }
  }));
  ctx.landmarks = placed;
  return null;
}
