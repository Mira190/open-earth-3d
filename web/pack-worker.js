// Open Earth 3D: decodes packed data (pack.js) off the main thread (issue 201). The page sends a pack's
// bytes; this inflates and decodes them and sends the object back, its typed arrays (the landmark
// meshes' vertex lists, the roof meshes' bytes) handed over rather than copied, so that what the main
// thread still does is take in the plain part of the object.
'use strict';
importScripts('pack.js');
// the buffers under the typed arrays in v, each once
function buffers(v, out) {
  if (!v || typeof v !== 'object') return;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer); return; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i] === 'object') buffers(v[i], out); return; }
  for (const k in v) buffers(v[k], out);
}
self.onmessage = async e => {
  const { id, buf } = e.data;
  try {
    const t0 = performance.now(), obj = await self.OEPack.decode(buf), set = new Set();
    buffers(obj, set);
    self.postMessage({ id, obj, ms: performance.now() - t0 }, [...set]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
