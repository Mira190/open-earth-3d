// A read-only file system for a build of web/ hosted where the number of files is capped (tools/artifact_bundle.py).
// The data and shared assets are packed into a few chunk files (vfs/NN.bin) with an index (vfs/index.json) of
// path -> [chunk, offset, length]. This script, loaded before anything else on a page and by the workers that
// fetch data, answers fetch() and <img src> for an indexed path from its chunk, fetched once and kept, and
// passes every other request through unchanged. Runs in a window and in a worker.
'use strict';
(function () {
  const G = self;
  if (G.__oeVfs) return;
  const root = new URL('./', G.__oeVfsRoot || (G.document ? document.currentScript.src : location.href)).href;
  const TYPES = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml',
    json: 'application/json', glb: 'model/gltf-binary', gltf: 'model/gltf+json', woff2: 'font/woff2', txt: 'text/plain', bin: 'application/octet-stream',
    gz: 'application/gzip', ktx2: 'image/ktx2', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
  const nativeFetch = G.fetch.bind(G);
  let index = null;
  const indexed = nativeFetch(root + 'vfs/index.json').then(r => r.json()).then(j => { index = j; return j; });
  const chunks = new Map();
  const chunk = n => {
    if (!chunks.has(n)) chunks.set(n, nativeFetch(`${root}vfs/${String(n).padStart(3, '0')}.wasm`)
      .then(r => { if (!r.ok) throw new Error(`vfs chunk ${n}: ${r.status}`); return r.arrayBuffer(); })
      .catch(e => { chunks.delete(n); throw e; }));
    return chunks.get(n);
  };
  const keyOf = u => {
    let s;
    try { s = new URL(u, G.document ? document.baseURI : location.href).href; } catch (e) { return null; }
    if (!s.startsWith(root)) return null;
    s = s.slice(root.length).split('#')[0].split('?')[0];
    try { return decodeURIComponent(s); } catch (e) { return s; }
  };
  const blobOf = async key => {
    const e = index[key];
    const buf = await chunk(e[0]);
    return new Blob([new Uint8Array(buf, e[1], e[2])], { type: TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream' });
  };
  // a JPEG left out for its AVIF twin (tools/artifact_bundle.py DROP_JPEG) is answered with the AVIF: a page asks
  // for the JPEG only after the AVIF failed once, and a second try of the same picture loads
  const alias = key => (index[key] ? key : /\.jpg$/.test(key) && index[key.slice(0, -4) + '.avif'] ? key.slice(0, -4) + '.avif' : null);
  const lookup = async key => { if (key === null) return null; await indexed.catch(() => null); return index ? alias(key) : null; };

  G.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    const key = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? await lookup(keyOf(url)) : null;
    if (!key) return nativeFetch(input, init);
    const signal = (init && init.signal) || (input && input.signal);
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = await blobOf(key);
    return new Response(method.toUpperCase() === 'HEAD' ? null : blob, { status: 200, headers: { 'content-type': blob.type, 'content-length': String(blob.size) } });
  };

  if (G.HTMLImageElement) {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const asked = new WeakMap(), urls = new WeakMap();
    const setSrc = function (v) {
      const img = this, key = keyOf(String(v));
      asked.set(img, String(v));
      if (urls.has(img)) { URL.revokeObjectURL(urls.get(img)); urls.delete(img); }
      if (key === null || (index && !alias(key))) { desc.set.call(img, v); return; }
      lookup(key).then(k => {
        if (asked.get(img) !== String(v)) return;
        if (!k) { desc.set.call(img, v); return; }
        return blobOf(k).then(b => {
          if (asked.get(img) !== String(v)) return;
          const u = URL.createObjectURL(b);
          urls.set(img, u);
          desc.set.call(img, u);
        });
      }).catch(() => desc.set.call(img, v));
    };
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true, enumerable: desc.enumerable,
      get() { return asked.has(this) ? new URL(asked.get(this), document.baseURI).href : desc.get.call(this); },
      set: setSrc,
    });
    const setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') { setSrc.call(this, value); return; }
      return setAttr.call(this, name, value);
    };
  }
  G.__oeVfs = { root, ready: indexed, has: k => !!(index && alias(k)) };
})();
