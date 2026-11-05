// An alpine site's landmark models (scene.json `landmarks`, from city.json via build_alpine.py): a church, a statue,
// a footbridge, an observatory's domes. Each glTF is built in its own anchor's frame with its orientation baked in
// (x east, y up, -z north, y = 0 at its ground), so it is only placed: at (x, z, -y) of the local frame, above the
// lake (or on the terrain where that is higher). A landmark with a deck (a footbridge) is walkable: its deck height along the span joins ctx.decks.
// The models are meshopt-compressed (../../gltf.js decodes them). They cast and take the site's shadows.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from '../../gltf.js';

export async function init(ctx) {
  const { scene, S } = ctx;
  const marks = S.kind === 'alpine' ? S.landmarks || [] : [];
  if (!marks.length) return null;
  const base = new URL(`../../`, import.meta.url);
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'landmarks';
  scene.add(group);
  const loaded = [];
  for (const m of marks) {
    loaded.push(new Promise(res => loader.load(new URL(m.glb, base).href, gl => {
      const o = gl.scene;
      o.name = m.id;
      // the survey's ground under the anchor, unless the site's 30 m terrain runs higher there (it smooths a knoll):
      // then the terrain's, so a building never stands in the ground; its walls reach below its floor for a lower one
      const g = ctx.height(m.x, m.y);
      o.position.set(m.x, m.deck || !Number.isFinite(g) ? m.z : Math.max(m.z, g), -m.y);
      o.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true;
        const mt = n.material; if (mt && mt.transparent) { mt.depthWrite = false; n.castShadow = false; } } });
      group.add(o);
      res(o);
    }, undefined, e => { console.warn(`landmark ${m.id}:`, e); res(null); })));
    if (m.deck) ctx.decks.push(deckOf(m.deck));
  }
  ctx.landmarks = { group, ready: Promise.all(loaded), list: marks };
  return null;
}

// the deck's height at a point, or null off it: along the span between its ends, within half its width
function deckOf(dk) {
  const [[ax, ay], [bx, by]] = dk.ends, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, half = dk.w / 2, n = dk.z.length - 1;
  return (x, north) => {
    const px = x - ax, py = north - ay, s = px * ux + py * uy, off = Math.abs(-px * uy + py * ux);
    if (s < 0 || s > L || off > half) return null;
    const f = s / L * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    return dk.z[i] * (1 - t) + dk.z[i + 1] * t;
  };
}
