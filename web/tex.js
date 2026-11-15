// Open Earth 3D: a phone's pictures as ASTC blocks on the GPU (issue 443; astc.js, astc-worker.js). The files stay
// what they are; each picture is encoded on the device after it is decoded and before it is first sent to the GPU,
// so the uncompressed copy never is: a quarter of the GPU's memory for the same download.
//
//   OETex.on(renderer, want)   turns it on where the GPU decodes ASTC and `want` (the game on a phone, game.js; or
//                              ?tex=astc anywhere, ?tex=raw nowhere); returns whether it is on
//   OETex.pack(texture)        a promise: the texture's picture in blocks (or left as it was: off, not a picture,
//                              too small, or below the encoder's quality floor). Until it resolves the texture is
//                              held back from the GPU (drawn black), so call it before what wears it is shown
//   OETex.gltf(loader)         a GLTFLoader plugin (gltf.js registers it on every loader): a model's colour
//                              pictures packed before the loader hands the model over. A loader with oeTex = false
//                              is left alone: its owner makes the pictures smaller first, then calls packObject
//   OETex.packObject(root)     every colour picture the materials under root wear
//   OETex.settled()            a promise: nothing left encoding
//   OETex.stats                { packed, kept, texels, bytes, ms, worst } for the tools and the telemetry
//
// Only colour is packed (a material's map and emissiveMap): normals and the packed roughness, metalness and occlusion
// have channels that do not move together, which a block's one line of colours cannot follow. Canvases, data
// textures and render targets are not pictures and are left alone.
(function () {
  'use strict';
  const here = document.currentScript ? document.currentScript.src : document.baseURI;
  const FLOOR = 33, ALPHA_FLOOR = 27, MIN_SIDE = 32; // (dB of the top level by the encoder's own count; smaller pictures cost nothing)
  const stats = { on: false, packed: 0, kept: 0, texels: 0, bytes: 0, ms: 0, worst: 99, log: [] }; // (log: each picture, for tools/mem_check.js)
  const note = (tex, img, r, kept) => { if (stats.log.length < 400) stats.log.push({ name: tex.name || String((img && (img.currentSrc || img.src)) || '').split('/').slice(-2).join('/'), w: r.width || (img && img.width) || 0, h: r.height || (img && img.height) || 0, db: r.db != null ? +r.db.toFixed(1) : null, adb: r.adb != null && r.adb < 99 ? +r.adb.toFixed(1) : undefined, kept, why: r.error }); };
  let worker = null, seq = 0, max = 4096, pending = 0, idle = [];
  const waiting = new Map(), bySource = new WeakMap(), byTex = new WeakMap();

  function on(renderer, want = true) {
    const q = new URLSearchParams(location.search).get('tex');
    const has = !!(renderer && renderer.extensions && renderer.extensions.has('WEBGL_compressed_texture_astc')) && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function' && typeof Worker === 'function';
    stats.on = has && q !== 'raw' && (want || q === 'astc');
    if (renderer) max = renderer.capabilities.maxTextureSize;
    return stats.on;
  }
  function post(msg, transfer) {
    if (!worker) {
      worker = new Worker(new URL('astc-worker.js', here));
      worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
      worker.onerror = e => { e.preventDefault(); stats.on = false; for (const w of waiting.values()) w({ keep: true, error: 'the worker failed' }); waiting.clear(); };
    }
    return new Promise(ok => { const id = ++seq; waiting.set(id, ok); worker.postMessage(Object.assign({ id }, msg), transfer); });
  }
  const done = () => { if (--pending === 0) { for (const f of idle) f(); idle = []; } };

  // the blocks in place of the pixels: three.js sends a texture with isCompressedTexture and mipmaps level by level
  function wear(tex, r) {
    tex.mipmaps = r.levels;
    tex.image = { width: r.width, height: r.height };
    tex.format = THREE.RGBA_ASTC_4x4_Format;
    tex.type = THREE.UnsignedByteType;
    // (a CompressedTexture from here on, so that a clone made later is one too: clone() makes what its constructor is)
    Object.setPrototypeOf(tex, THREE.CompressedTexture.prototype);
    tex.isCompressedTexture = true;
    tex.generateMipmaps = false;
    tex.flipY = false; // (the rows were turned as the picture was read)
    tex.premultiplyAlpha = false;
    if (r.levels.length === 1 && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter) tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
  }

  function pack(tex) {
    if (!stats.on || !tex || !tex.isTexture || tex.isCompressedTexture || tex.isDataTexture || tex.isCanvasTexture || tex.isVideoTexture || tex.isRenderTargetTexture || tex.isCubeTexture || (tex.userData && tex.userData.raw)) return Promise.resolve(false);
    const img = tex.image, bitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
    if (!img || !(bitmap || (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.complete && img.naturalWidth))) return Promise.resolve(false);
    if (Math.min(img.width, img.height) < MIN_SIDE) return Promise.resolve(false);
    if (byTex.has(tex)) return byTex.get(tex); // (asked twice: the one answer)
    const src = tex.source, had = bySource.get(src);
    if (had) { // (a clone of one being packed, or packed: the same blocks, and held back until they are there)
      const v = tex.version;
      tex.version = 0;
      const again = had.then(r => { if (r) wear(tex, r); else { tex.version = Math.max(1, v); tex.needsUpdate = true; } return !!r; });
      byTex.set(tex, again);
      return again;
    }
    const mips = tex.generateMipmaps !== false && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
    const version = tex.version, t0 = performance.now();
    tex.version = 0; // (held back: three.js sends a texture only once its version is over 0)
    pending++;
    const job = (bitmap ? Promise.resolve(img) : createImageBitmap(img, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(bm => post({ bitmap: bm, max: Math.min(max, (tex.userData && tex.userData.max) || max), flipY: !!tex.flipY, srgb: tex.colorSpace === THREE.SRGBColorSpace, mips, floor: FLOOR, alphaFloor: ALPHA_FLOOR }, [bm]))
      .then(r => {
        if (r.keep) { // as it was
          if (!bitmap && r.bitmap) r.bitmap.close();
          if (bitmap && !r.bitmap) { tex.version = version || 1; return null; } // (the picture did not come back: nothing to send but what there was)
          stats.kept++; note(tex, img, r, true);
          const back = () => { tex.version = Math.max(1, version); tex.needsUpdate = true; return null; };
          if (!bitmap) return back();
          // (an ImageBitmap is sent as it lies, whatever flipY says: one that was to be turned is turned here)
          if (!tex.flipY) { tex.image = r.bitmap; return back(); }
          return createImageBitmap(r.bitmap, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
            .then(bm => { r.bitmap.close(); tex.image = bm; tex.flipY = false; return back(); }, () => { tex.image = r.bitmap; return back(); });
        }
        stats.packed++; stats.texels += r.width * r.height; stats.bytes += r.levels.reduce((s, l) => s + l.data.byteLength, 0); stats.ms += performance.now() - t0;
        if (r.db < stats.worst) stats.worst = r.db;
        note(tex, img, r, false);
        wear(tex, r);
        return r;
      })
      .catch(e => { console.warn('tex: left as it was,', e && e.message || e); tex.version = Math.max(1, version); tex.needsUpdate = true; return null; })
      .finally(done);
    bySource.set(src, job);
    const mine = job.then(r => !!r);
    byTex.set(tex, mine);
    return mine;
  }

  const KEYS = ['map', 'emissiveMap'], OTHER = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'anisotropyMap'];
  function packObject(root) {
    // every texture a colour slot wears, but for a picture that some other slot wears too (its clones share the one
    // picture, and that slot's would be left with blocks it does not expect)
    const colour = new Set(), other = new Set();
    root.traverse(o => {
      for (const m of [].concat(o.material || [])) {
        if (!m) continue;
        for (const k of KEYS) if (m[k]) colour.add(m[k]);
        for (const k of OTHER) if (m[k]) other.add(m[k].source);
      }
    });
    return Promise.all([...colour].filter(t => !other.has(t.source)).map(pack));
  }
  const gltf = loader => ({ name: 'OE_astc', afterRoot(result) { return stats.on && !(loader && loader.oeTex === false) ? Promise.all((result.scenes || [result.scene]).filter(Boolean).map(packObject)) : null; } });
  const settled = () => (pending ? new Promise(ok => idle.push(ok)) : Promise.resolve());

  window.OETex = { on, pack, packObject, gltf, settled, stats };
})();
