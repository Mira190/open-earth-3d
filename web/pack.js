// Open Earth 3D packed data (issues 148, 201, 259): decodes a file written by pipeline/pack.py (buildings,
// landmarks, game, terrain, places and scene .bin) back to the object its JSON source holds, so that nothing that reads it
// changes, except that base64 columns packed as bytes (the roof meshes, buildings.json "r" positions 6
// and 7) and the terrain grid (terrain.json "data") arrive as Uint8Array, and the landmark meshes' vertex lists (list columns flagged "ta") as
// typed arrays. The roof meshes go through meshoptimizer's vertex and index codecs (issue 335; its decoder,
// MIT, is loaded when a pack has them), so a roof triangle may start at another corner. The page decodes in a Worker (pack-worker.js, decodeIn below) where it can.
// The file is gzip-wrapped; DecompressionStream inflates it (a server that already sent it with
// Content-Encoding: gzip is handled too). Works in a page (window.OEPack) and in Node (require).
'use strict';
(function (root) {
  const MAGIC = 0x4b50454f; // "OEPK", little-endian

  async function inflate(buf) {
    const u = new Uint8Array(buf);
    if (!(u[0] === 0x1f && u[1] === 0x8b)) return u;
    const ds = new DecompressionStream('gzip');
    const out = new Response(new Blob([u]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  // a column of integers, as an Int32Array: width, sign, byte planes, delta stride (pipeline/pack.py Writer.ints)
  function ints(d, blob) {
    const n = d.n, w = d.w, raw = blob.subarray(d.o, d.o + n * w), x = new Int32Array(n);
    if (w === 1) {
      if (d.s) for (let i = 0; i < n; i++) x[i] = (raw[i] << 24) >> 24;
      else for (let i = 0; i < n; i++) x[i] = raw[i];
    } else if (w === 2) { // little-endian words, or (z) all the low bytes and then all the high ones
      const hi = d.z ? n : 1, step = d.z ? 1 : 2;
      for (let i = 0, p = 0; i < n; i++, p += step) { const v = raw[p] | (raw[hi + p] << 8); x[i] = d.s ? (v << 16) >> 16 : v; }
    } else {
      if (d.z) for (let i = 0; i < n; i++) x[i] = raw[i] | (raw[n + i] << 8) | (raw[2 * n + i] << 16) | (raw[3 * n + i] << 24);
      else for (let i = 0, p = 0; i < n; i++, p += 4) x[i] = raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16) | (raw[p + 3] << 24);
    }
    const s = d.d;
    if (s) {
      for (let i = 0; i < n; i++) { const z = x[i]; x[i] = (z >>> 1) ^ -(z & 1); }
      for (let i = s; i < n; i++) x[i] += x[i - s];
    }
    return x;
  }
  // a typed column as the plain array JSON.parse would give (consumers map and slice it)
  const plain = (t, from = 0, to = t.length) => { const a = new Array(to - from); for (let i = from; i < to; i++) a[i - from] = t[i]; return a; };

  // a column as an array-like: typed for numbers (plain at the leaves, by the caller), else an Array
  function col(d, blob) {
    switch (d.t) {
      case 'i': return ints(d, blob);
      case 'q': { const s = 10 ** d.k, v = ints(d.c, blob); if (s === 1) return v; const f = new Float64Array(v.length); for (let i = 0; i < v.length; i++) f[i] = v[i] / s; return f; }
      case 'f': { const b = blob.slice(d.o, d.o + 8 * d.n); return new Float64Array(b.buffer, b.byteOffset, d.n); }
      case 's': { const t = d.tab, v = ints(d.c, blob), a = new Array(v.length); for (let i = 0; i < v.length; i++) a[i] = t[v[i]]; return a; }
      case 'p': { const t = d.tab, p = ints(d.c, blob), v = ints(d.v, blob), a = new Array(p.length); for (let i = 0; i < p.length; i++) a[i] = v[i] >= 0 ? t[p[i]] + v[i] : t[p[i]]; return a; }
      case 'x': { // "#rrggbb" colours as integers, or as indices into a palette of them
        const v = ints(d.c, blob), pal = d.p ? ints(d.p, blob) : null, a = new Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = '#' + (0x1000000 + (pal ? pal[v[i]] : v[i])).toString(16).slice(1);
        return a;
      }
      case 'b': {
        if (d.m) return meshoptBytes(d, blob);
        let cat, o = 0;
        if (d.e) { const v = ints(d.c, blob), a = new Int16Array(v.length); a.set(v); cat = new Uint8Array(a.buffer); } // int16 elements
        else { cat = blob; o = d.o; }
        const L = ints(d.len, blob), out = new Array(L.length);
        for (let i = 0; i < L.length; i++) { out[i] = d.s64 ? b64(cat.subarray(o, o + L[i])) : cat.slice(o, o + L[i]); o += L[i]; }
        return out;
      }
      case 'l': {
        const flat = col(d.c, blob), L = ints(d.len, blob), out = new Array(L.length), arr = Array.isArray(flat);
        for (let i = 0, o = 0; i < L.length; i++) { out[i] = arr ? flat.slice(o, o + L[i]) : d.ta ? flat.subarray(o, o + L[i]) : plain(flat, o, o + L[i]); o += L[i]; }
        return out;
      }
      case 'd': { // a list of objects, key by key
        const n = d.n, out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = {};
        for (const [k, kd] of Object.entries(d.k)) {
          const v = col(kd.c, blob), has = kd.has ? ints(kd.has, blob) : null;
          for (let i = 0, at = 0; i < n; i++) if (!has || has[i]) out[i][k] = v[at++];
        }
        return out;
      }
      case 'one': return col(d.c, blob)[0];
      case 'o': return obj(d.k, blob);
      case 'r': {
        const cols = d.c.map(c => col(c, blob)), at = new Int32Array(cols.length), L = ints(d.len, blob), out = new Array(L.length);
        for (let i = 0; i < L.length; i++) {
          const n = L[i], row = new Array(n);
          for (let j = 0; j < n; j++) row[j] = cols[j][at[j]++];
          out[i] = row;
        }
        return out;
      }
      case 'j': return d.v;
    }
    throw new Error(`pack: unknown column type ${d.t}`);
  }

  // roof meshes through meshoptimizer's codecs (pipeline/pack.py meshopt_column): the vertices (int16 x, y, z,
  // padded to four) or the triangles (uint32 indices into every row's vertices) of all the rows at once, cut
  // back into each row's bytes as its JSON had them (int16 xyz; uint8 indices below 256 vertices, else uint16)
  let M = null; // the decoder, loaded by decode() when a pack needs it
  function meshoptBytes(d, blob) {
    const enc = blob.subarray(d.o, d.o + d.nb), L = ints(d.len, blob), out = new Array(L.length);
    if (d.m === 'v') {
      const q = new Int16Array(4 * d.n);
      M.decodeVertexBuffer(new Uint8Array(q.buffer), d.n, 8, enc);
      for (let i = 0, v = 0; i < L.length; i++) {
        const nv = L[i] / 6, a = new Int16Array(3 * nv);
        for (let k = 0; k < nv; k++, v++) { a[3 * k] = q[4 * v]; a[3 * k + 1] = q[4 * v + 1]; a[3 * k + 2] = q[4 * v + 2]; }
        out[i] = new Uint8Array(a.buffer);
      }
      return out;
    }
    const idx = new Uint32Array(d.n), VL = ints(d.vl, blob);
    M.decodeIndexBuffer(new Uint8Array(idx.buffer), d.n, 4, enc);
    for (let i = 0, o = 0, base = 0; i < L.length; i++) {
      const nv = VL[i] / 6, a = nv > 255 ? new Uint16Array(L[i] / 2) : new Uint8Array(L[i]);
      for (let k = 0; k < a.length; k++) a[k] = idx[o + k] - base;
      o += a.length; base += nv;
      out[i] = a instanceof Uint8Array ? a : new Uint8Array(a.buffer);
    }
    return out;
  }
  // meshoptimizer's decoder (MIT): three.js's copy, in WebAssembly, where there is WebAssembly; its
  // JavaScript reference decoder where there is none (iOS Lockdown Mode); the pipeline's copy in Node
  async function meshopt() {
    if (M) return M;
    if (isNode) {
      const url = require('url').pathToFileURL(require('path').join(__dirname, '..', 'pipeline', 'vendor', 'meshoptimizer', 'meshopt_decoder.mjs')).href;
      M = (await import(url)).MeshoptDecoder;
    } else {
      const at = f => new URL(f, base).href;
      let D = null;
      if (typeof WebAssembly === 'object') {
        try { D = (await import(at('vendor/three/addons/libs/meshopt_decoder.module.js'))).MeshoptDecoder; await D.ready; } catch (e) { D = null; }
      }
      M = D || (await import(at('vendor/meshoptimizer/meshopt_decoder_reference.js'))).MeshoptDecoder;
    }
    await M.ready;
    return M;
  }

  // bytes as base64 text again (the game's height grids and water mask, which its code reads as text)
  function b64(u) {
    if (typeof btoa !== 'function') return Buffer.from(u).toString('base64');
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // an object's values, each by its descriptor: {j: value} as it is, else a column (typed ones as plain
  // arrays, but bytes, a base64 string packed as a column of one, as they are)
  function obj(keys, blob) {
    const out = {};
    for (const [k, d] of Object.entries(keys)) { const v = 'j' in d ? d.j : col(d, blob); out[k] = ArrayBuffer.isView(v) && !(v instanceof Uint8Array) ? plain(v) : v; }
    return out;
  }

  async function decode(buf) {
    const u = await inflate(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('pack: not an OEPK file');
    const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + hl)));
    const start = 8 + hl + ((8 - (8 + hl) % 8) % 8), blob = u.subarray(start);
    if (!M && /"m":"[vi]"/.test(new TextDecoder().decode(u.subarray(8, 8 + hl)))) await meshopt();
    return obj(head.keys, blob);
  }

  const supported = () => typeof DecompressionStream === 'function' && typeof Response === 'function';
  // decode in a Worker (pack-worker.js, next to this file), the buffer handed over; on the main thread
  // where there is no Worker or it fails. One worker, made when first needed, decodes the packs in turn.
  const here = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : null;
  const isNode = typeof module === 'object' && !!module.exports && typeof require === 'function' && typeof __dirname === 'string';
  const base = here || (typeof self !== 'undefined' && self.location ? self.location.href : null); // web/ (pack.js or pack-worker.js)
  let worker = null, seq = 0;
  const waiting = new Map(), keptThere = new Set();
  function post(msg, transfer, retry) {
    if (!worker && here && typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('pack-worker.js', here));
        worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.fail(new Error(e.data.error)); else w.ok(e.data.obj); };
        worker.onerror = e => { e.preventDefault(); worker = false; keptThere.clear(); for (const w of waiting.values()) w.retry(); waiting.clear(); };
      } catch (e) { worker = false; }
    }
    if (!worker) return null;
    return new Promise((ok, fail) => {
      const id = ++seq;
      waiting.set(id, { ok, fail, retry: () => retry().then(ok, fail) });
      worker.postMessage(Object.assign({ id }, msg), transfer);
    });
  }
  // keep: a name under which the worker keeps the pack for buildIn() (it then copies it back rather than handing
  // its arrays over)
  function decodeIn(buf, keep = null) {
    const copy = here && typeof Worker === 'function' && worker !== false ? buf.slice(0) : null; // (kept, to decode here if the worker fails)
    const p = post({ buf, keep }, [buf], () => decode(copy));
    if (!p) return decode(copy || buf);
    if (keep) keptThere.add(keep);
    return p;
  }
  // the buildings' vertex arrays from the pack kept as key (pack-worker.js, buildings-geo.js); rejects where
  // the worker has no such pack (decoded here, or the worker failed), and the page then builds them itself
  function buildIn(key, opt) {
    if (!worker || !keptThere.has(key)) return Promise.reject(new Error(`no ${key} in a worker`));
    keptThere.delete(key);
    return post({ build: key, opt }, [], () => Promise.reject(new Error('the worker failed')));
  }
  // the landmarks laid on the walking model's grid from the pack kept as key (game/navcells.js), in the same way
  function rasterIn(key, opt) {
    if (!worker || !keptThere.has(key)) return Promise.reject(new Error(`no ${key} in a worker`));
    keptThere.delete(key);
    return post({ raster: key, opt }, [], () => Promise.reject(new Error('the worker failed')));
  }
  const api = { decode, decodeIn, buildIn, rasterIn, supported };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OEPack = api;
})(typeof window !== 'undefined' ? window : globalThis);
