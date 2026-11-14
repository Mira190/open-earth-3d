// Open Earth 3D: decodes packed data (pack.js) off the main thread (issue 201). The page sends a pack's
// bytes; this inflates and decodes them and sends the object back, its typed arrays (the landmark
// meshes' vertex lists, the roof meshes' bytes) handed over rather than copied, so that what the main
// thread still does is take in the plain part of the object.
// A pack sent with a key (keep) is copied back instead and kept here, so that a later message can build
// from it without the page sending it again: { build: key, opt } makes the buildings' walls, roofs and
// decks (buildings-geo.js, issue 344) and sends their vertex arrays back, handed over, then lets the pack go;
// { raster: key, opt } lays the landmarks on the walking model's grid (game/navcells.js) in the same way.
'use strict';
importScripts('pack.js');
// the buffers under the typed arrays in v, each once
function buffers(v, out) {
  if (!v || typeof v !== 'object') return;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer); return; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i] === 'object') buffers(v[i], out); return; }
  for (const k in v) buffers(v[k], out);
}
const kept = new Map();
let jobs = Promise.resolve();
let triangulate = null;
async function build(key, opt) {
  const B = kept.get(key);
  if (!B) throw new Error(`no ${key} kept`);
  kept.delete(key);
  if (!self.OEBuildingsGeo) importScripts('sun.js', 'buildings-geo.js');
  if (!triangulate) { // three.js's own triangulation (Earcut), as the page's: the same faces
    const { ShapeUtils } = await import(new URL('vendor/three/three.core.min.js', self.location.href).href);
    triangulate = (c, h) => ShapeUtils.triangulateShape(c, h);
  }
  // as the page does to its copy (world.js load): demolished solids flat, the roofs unpacked
  for (const si of opt.demolished || []) if (B.s[si]) B.s[si][3] = B.s[si][2];
  self.Sun.roofs(B);
  const out = await self.OEBuildingsGeo.build(B, Object.assign({}, opt, { triangulate }));
  // and the game's 2 m surface model with the building on top of each cell (game.js), on the ground it walks
  if (opt.dsm) {
    const t0 = performance.now(), G = self.Sun.buildDSM(opt.dsm.T, B.s, Object.assign({ ids: true }, opt.dsm.frame));
    delete G.ground; // (a function: the page puts it back)
    out.dsm = G;
    out.dsmMs = performance.now() - t0;
  }
  return out;
}
function raster(key, opt) {
  const LM = kept.get(key);
  if (!LM) throw new Error(`no ${key} kept`);
  kept.delete(key);
  if (!self.OENavCells) importScripts('game/navcells.js');
  const t0 = performance.now(), N = self.OENavCells, out = N.pack(N.raster(LM, opt.strips, opt.grid), opt.strips);
  out.ms = performance.now() - t0;
  return out;
}
self.onmessage = async e => {
  const { id, buf, keep, lean, build: key, raster: rkey, opt } = e.data;
  try {
    if (key || rkey) { // (in the order asked: the walls are wanted first, and build() waits on an import)
      const job = jobs.then(() => (key ? build(key, opt) : raster(rkey, opt)));
      jobs = job.catch(() => {});
      const a = await job, set = new Set();
      buffers(a, set);
      self.postMessage({ id, obj: a }, [...set]);
      return;
    }
    const t0 = performance.now(), obj = await self.OEPack.decode(buf), set = new Set();
    // (lean: the landmark meshes flagged "detail" go back empty, the low tier never drawing them; a kept copy keeps them)
    const out = lean ? self.OEPack.dropDetail(obj) : obj;
    if (keep) { kept.set(keep, obj); self.postMessage({ id, obj: out, ms: performance.now() - t0 }); return; }
    buffers(out, set);
    self.postMessage({ id, obj: out, ms: performance.now() - t0 }, [...set]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
