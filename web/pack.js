// Open Earth 3D packed data (issues 148, 201): decodes a file written by pipeline/pack.py (buildings.bin,
// landmarks.bin, game.bin) back to the object its JSON source holds, so that nothing that reads it
// changes, except that base64 columns packed as bytes (the roof meshes, buildings.json "r" positions 6
// and 7) arrive as Uint8Array, and the landmark meshes' vertex lists (list columns flagged "ta") as
// typed arrays. The page decodes in a Worker (pack-worker.js, decodeIn below) where it can.
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
      case 'b': {
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

  // bytes as base64 text again (the game's height grids and water mask, which its code reads as text)
  function b64(u) {
    if (typeof btoa !== 'function') return Buffer.from(u).toString('base64');
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // an object's values, each by its descriptor: {j: value} as it is, else a column (typed ones as plain arrays)
  function obj(keys, blob) {
    const out = {};
    for (const [k, d] of Object.entries(keys)) { const v = 'j' in d ? d.j : col(d, blob); out[k] = ArrayBuffer.isView(v) ? plain(v) : v; }
    return out;
  }

  async function decode(buf) {
    const u = await inflate(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('pack: not an OEPK file');
    const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + hl)));
    const start = 8 + hl + ((8 - (8 + hl) % 8) % 8), blob = u.subarray(start);
    return obj(head.keys, blob);
  }

  const supported = () => typeof DecompressionStream === 'function' && typeof Response === 'function';
  // decode in a Worker (pack-worker.js, next to this file), the buffer handed over; on the main thread
  // where there is no Worker or it fails. One worker, made when first needed, decodes the packs in turn.
  const here = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : null;
  let worker = null, seq = 0;
  const waiting = new Map();
  function decodeIn(buf) {
    if (!worker && here && typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('pack-worker.js', here));
        worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.fail(new Error(e.data.error)); else w.ok(e.data.obj); };
        worker.onerror = e => { e.preventDefault(); worker = false; for (const w of waiting.values()) w.retry(); waiting.clear(); };
      } catch (e) { worker = false; }
    }
    if (!worker) return decode(buf);
    const copy = buf.slice(0); // (kept, to decode here if the worker fails)
    return new Promise((ok, fail) => {
      const id = ++seq;
      waiting.set(id, { ok, fail, retry: () => decode(copy).then(ok, fail) });
      worker.postMessage({ id, buf }, [buf]);
    });
  }
  const api = { decode, decodeIn, supported };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OEPack = api;
})(typeof window !== 'undefined' ? window : globalThis);
