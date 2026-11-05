// Landmark models on an alpine site (scene.json "landmarks", copied from city.json by pipeline/marine_meta.py):
// meshopt-compressed GLBs built in the landmark's own frame with their orientation baked in (glTF x east, y up,
// -z north, y = 0 at ground_m metres above the sea), so a landmark is only placed: at its point, at its ground
// height less the lake's (datum). Lit by the scene's sun and sky lights and veiled by the air like the rest.
// walk: "deck" makes the model's upward-facing surfaces walkable (ctx.decks; a footbridge's deck); a measured `deck`
// (its ends, width and heights) takes precedence where it is given.
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
      const fit = seat(ctx, L, root);
      const box = new THREE.Box3().setFromObject(root);
      placed.push({ L, root, box, fit });
      if (L.deck && ctx.decks) ctx.decks.push(deckOf(L, datum));   // a measured deck: exact, and its handrails are not walked on
      else if (L.walk === 'deck' && ctx.decks) {
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

// A landmark on the land as the viewer draws it. ground_m is the surveyed ground (LiDAR at a metre), but the land under
// it is the 30 m grid with its relief (terrain.js), which rounds off the knoll a building stands on: the Church of the
// Good Shepherd's floor would float a metre over it. So a building's walls are set on the highest drawn ground under
// them (lower ground round them meets the model's own foundation, or a plinth in its stone down into the ground), and
// they are made solid for the player (ctx.colliders: a box round the walls, along the landmark's axis_deg).
// Bridges (a deck) and spreads of buildings wider than 60 m (an observatory over its summit) keep their surveyed height.
const _v = new THREE.Vector3();
function seat(ctx, L, root) {
  if (L.deck || L.walk === 'deck' || L.seat === false || !ctx.height) return null;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty() || box.max.x - box.min.x > 60 || box.max.z - box.min.z > 60) return null;
  const b = (L.axis_deg || 0) * Math.PI / 180, ux = Math.sin(b), un = Math.cos(b);
  const y0 = root.position.y;
  // the walls (what stands 0.3 to 2.5 m above the model's base) and the base (everything at or below 0.3 m: paving,
  // a foundation), as rectangles along the axis
  const R = () => ({ u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, n: 0 });
  const wall = R(), base = R();
  let lowest = null, lowY = Infinity;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const h = _v.y - y0, dx = _v.x - root.position.x, dn = -_v.z + root.position.z;
      const u = dx * ux + dn * un, v = -dx * un + dn * ux, r = h > 0.3 && h < 2.5 ? wall : h <= 0.3 ? base : null;
      if (_v.y < lowY) { lowY = _v.y; lowest = o; }
      if (!r) continue;
      r.u0 = Math.min(r.u0, u); r.u1 = Math.max(r.u1, u); r.v0 = Math.min(r.v0, v); r.v1 = Math.max(r.v1, v); r.n++;
    }
  });
  const core = wall.n ? wall : base;
  if (!core.n) return null;
  // the drawn ground over a rectangle (5 x 5 points, 15 cm in from its edge)
  const ground = rc => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const u = rc.u0 + 0.15 + (rc.u1 - rc.u0 - 0.3) * i / 4, v = rc.v0 + 0.15 + (rc.v1 - rc.v0 - 0.3) * j / 4;
      const x = root.position.x + u * ux - v * un, north = -root.position.z + u * un + v * ux, h = ctx.height(x, north);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return { lo, hi };
  };
  const gc = ground(core), gb = base.n ? ground(base) : gc, lo = Math.min(gc.lo, gb.lo);
  let shift = 0, plinth = null;
  // floating (the model's lowest point above the ground somewhere under it): the walls' base down to the highest ground
  // under the walls; never more than a few metres (a wrong ground_m is a data error to fix, not to hide)
  if (lowY > lo + 0.02 && y0 > gc.hi + 0.02 && y0 - gc.hi < 4) shift = gc.hi - y0;
  root.position.y += shift; root.updateMatrixWorld(true);
  const bottom = lowY + shift;
  if (bottom > lo - 0.05) {
    // still short of the lowest ground round it: a plinth under the walls, just inside them, in the lowest part's stone
    const m = lowest && (Array.isArray(lowest.material) ? lowest.material[0] : lowest.material);
    const top = y0 + shift + 0.02, bot = lo - 0.6, w = core.u1 - core.u0 - 0.06, d = core.v1 - core.v0 - 0.06;
    if (m && w > 0.2 && d > 0.2) {
      plinth = new THREE.Mesh(new THREE.BoxGeometry(d, top - bot, w), m);   // x across the axis, z along it
      const cu = (core.u0 + core.u1) / 2, cv = (core.v0 + core.v1) / 2;
      plinth.position.set(root.position.x + cu * ux - cv * un, (top + bot) / 2, root.position.z - (cu * un + cv * ux));
      plinth.rotation.y = -b;
      plinth.name = `landmark:${L.id}:plinth`;
      root.parent.add(plinth);
    }
  }
  // solid: a box round the walls
  const cu = (core.u0 + core.u1) / 2, cv = (core.v0 + core.v1) / 2;
  const collider = { id: `landmark:${L.id}`, x: root.position.x + cu * ux - cv * un, north: -root.position.z + cu * un + cv * ux,
    ux, un, hu: (core.u1 - core.u0) / 2, hv: (core.v1 - core.v0) / 2, y0: y0 + shift - 1.5, y1: box.max.y + shift };
  (ctx.colliders || (ctx.colliders = [])).push(collider);
  return { shift, plinth: !!plinth, ground: [lo, gc.hi], bottom, collider };
}

// a measured deck (city.json landmarks[].deck): its ends in metres east and north of the landmark's point, its width,
// and its top (m above the sea) at even steps from end to end; the height at a point on it, or null off it
function deckOf(L, datum) {
  const dk = L.deck, [[ax, ay], [bx, by]] = dk.ends_m.map(([e, n]) => [L.x + e, L.y + n]), z = dk.z_m.map(v => v - datum);
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, half = dk.width_m / 2, n = z.length - 1;
  return (x, north) => {
    const px = x - ax, py = north - ay, s = px * ux + py * uy;
    if (s < 0 || s > len || Math.abs(py * ux - px * uy) > half) return null;
    const f = s / len * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    return z[i] * (1 - t) + z[i + 1] * t;
  };
}
