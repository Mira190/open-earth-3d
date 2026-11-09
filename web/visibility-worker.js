// The visibility sweep off the main thread (issue 358, B1; visibility.js starts this, visibility-sweep.js
// does the work). Messages in: { init: { url, terrain, keep } } (keep: how many shrunk copies of the raster to hold), then { id, x, y, z, eps, beams }.
// Out: { ready, head, grid } or { failed }, then { id, x, y, z, eps, S (Float32Array, handed over), grid, ms }
// with S null when the eye stands in an occluder.
'use strict';
importScripts('visibility-sweep.js');
let M = null;

async function load(url, terrain, keep) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let u = new Uint8Array(await res.arrayBuffer());
  if (u[0] === 0x1f && u[1] === 0x8b) u = new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if (String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'OEVS') throw new Error(`${url}: not a visibility raster`);
  const n = new DataView(u.buffer, u.byteOffset).getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + n)));
  if (head.empty) throw new Error('too few occluders to be worth a sweep');
  const start = 8 + n + ((8 - ((8 + n) % 8)) % 8);
  M = self.OEVisSweep.model(head, u.subarray(start, start + head.w * head.h), terrain);
  M.keep = keep || 2;
  return head;
}

self.onmessage = async e => {
  const d = e.data;
  if (d.init) {
    try { const head = await load(d.init.url, d.init.terrain, d.init.keep); self.postMessage({ ready: true, head, grid: M.grid }); }
    catch (err) { self.postMessage({ failed: String(err && err.message || err) }); }
    return;
  }
  if (!M) return;
  const t0 = performance.now(), T = self.OEVisSweep.tier(M, d.eps), t1 = performance.now();
  const S = self.OEVisSweep.sweep(M, T, d.x, d.y, d.z, { beams: d.beams });
  const out = { id: d.id, x: d.x, y: d.y, z: d.z, eps: T.eps, S, ms: performance.now() - t1, tierMs: t1 - t0 };
  self.postMessage(out, S ? [S.buffer] : []);
};
