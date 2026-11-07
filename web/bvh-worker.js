// Open Earth 3D: builds the buildings' bounding-volume hierarchy (three-mesh-bvh) off the main thread
// (issue 299: a second of the loader's longest frame in Shibuya). The page sends copies of the walls'
// positions and index; this builds the tree and sends it back serialised, its buffers handed over, and the
// page puts it on its geometry (MeshBVH.deserialize). A module worker: three-mesh-bvh imports 'three' by name,
// which a worker has no import map for, so the library's text is loaded with that name pointed at the file.
let lib = null;
async function load() {
  if (lib) return lib;
  const three = new URL('vendor/three/three.module.min.js', import.meta.url).href;
  const src = await (await fetch(new URL('vendor/three-mesh-bvh/index.module.min.js', import.meta.url))).text();
  const url = URL.createObjectURL(new Blob([src.replace(/from\s*["']three["']/g, `from"${three}"`)], { type: 'text/javascript' }));
  try { lib = Object.assign({}, await import(three), await import(url)); } finally { URL.revokeObjectURL(url); }
  return lib;
}
self.onmessage = async e => {
  const { id, position, index, options } = e.data;
  try {
    const t0 = performance.now(), L = await load();
    const g = new L.BufferGeometry();
    g.setAttribute('position', new L.BufferAttribute(position, 3));
    g.setIndex(new L.BufferAttribute(index, 1));
    const data = L.MeshBVH.serialize(new L.MeshBVH(g, options || {}), { cloneBuffers: false });
    const moved = new Set(data.roots.map(r => r));
    if (data.index) moved.add(data.index.buffer);
    if (data.indirectBuffer) moved.add(data.indirectBuffer.buffer);
    self.postMessage({ id, data, ms: performance.now() - t0 }, [...moved].filter(b => b instanceof ArrayBuffer));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
