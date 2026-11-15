// The device-side ASTC encoder (web/astc.js, issue 443) against a real decoder: each picture is encoded in the
// page, handed to WebGL as COMPRESSED_RGBA_ASTC_4x4 (SwiftShader decodes ASTC; Mesa's llvmpipe does not offer it),
// drawn texel for texel into a framebuffer and read back, and compared with the picture it was made from. A block
// laid out wrongly decodes to magenta or to noise, far below the floor; the figures are the quality a phone gets.
//   python3 -m http.server 8800 --directory web &
//   node tools/astc_check.js [pictures under web/...]      # exits 1 under the floor (MIN_DB, default 30), on a GL error,
//                                                          # or where the encoder's own count of its error is off
const { chromium } = require('playwright');
const pics = process.argv.slice(2).length ? process.argv.slice(2) : ['data/shibuya/ground_2_1.jpg', 'data/shibuya/atlas.webp', 'data/shibuya/scramble.webp', 'data/tokyo/tks_signs.webp', 'data/sydney/ground_1_2.jpg', 'data/shibuya/far.jpg', 'assets/trees/trees_far.glb#0', 'assets/people/R_Female_Adult_14.glb#1', 'assets/people/H_Surveyor_M.glb#3'];
const MIN = +(process.env.MIN_DB || 30);
(async () => {
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', String(e)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/data/life.json`);
  await p.setContent('<!doctype html><canvas id=c></canvas>');
  await p.addScriptTag({ url: `http://localhost:${process.env.PORT || 8800}/astc.js` });
  let bad = 0;
  for (const pic of pics) {
    const r = await p.evaluate(async ([url, force]) => {
      // (a picture inside a model: assets/trees/trees_far.glb#0 is the first image of that GLB)
      let blob;
      if (/\.glb#\d+$/.test(url)) {
        const [u, k] = url.split('#'), buf = await (await fetch(u)).arrayBuffer(), dv = new DataView(buf), jl = dv.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), im = json.images[+k], bv = json.bufferViews[im.bufferView];
        blob = new Blob([new Uint8Array(buf, 20 + jl + 8 + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType });
      } else blob = await (await fetch(url)).blob();
      const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const w = Math.min(1024, img.width), h = Math.min(1024, img.height), cv = new OffscreenCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const src = g.getImageData(0, 0, w, h).data;
      const gl = document.getElementById('c').getContext('webgl2'), ext = gl.getExtension('WEBGL_compressed_texture_astc');
      if (!ext) return { error: 'no ASTC here' };
      const out = {};
      for (const mode of ['opaque', 'alpha']) {
        const px = src.slice();
        if (mode === 'opaque') for (let i = 3; i < px.length; i += 4) px[i] = 255;
        else if (OEAstc.opaque(px)) for (let i = 0; i < px.length; i += 4) px[i + 3] = Math.max(0, Math.min(255, ((px[i] + px[i + 1] + px[i + 2]) / 3 - 96) * 9)); // (a cut-out made of an opaque picture: its darks cut away, a soft edge between)
        OEAstc.stats.reset();
        OEAstc.encode(px, w, h, mode === 'alpha');
        const own = +OEAstc.stats.db().toFixed(1); // (the encoder's own account of the top level, which astc-worker.js goes by)
        const t0 = performance.now(), levels = OEAstc.mips(px, w, h, mode === 'alpha', true), ms = performance.now() - t0;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        levels.forEach((l, i) => gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext.COMPRESSED_RGBA_ASTC_4x4_KHR, l.width, l.height, 0, l.data));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const fb = gl.createFramebuffer(), rt = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, rt); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
        const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); return o; };
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){ vec2 p = vec2(float(gl_VertexID & 1) * 4.0 - 1.0, float(gl_VertexID >> 1) * 4.0 - 1.0); gl_Position = vec4(p, 0.0, 1.0); }'));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; uniform sampler2D t; out vec4 o; void main(){ o = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }'));
        gl.linkProgram(pr); gl.useProgram(pr);
        gl.viewport(0, 0, w, h); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const back = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, back);
        // (colour by how much of it shows: what is cut away has none)
        let se = 0, sa = 0, magenta = 0, shown = 0;
        for (let i = 0; i < px.length; i += 4) {
          const f = px[i + 3] / 255;
          for (let k = 0; k < 3; k++) { const d = px[i + k] - back[i + k]; se += d * d * f; }
          shown += f;
          const da = px[i + 3] - back[i + 3]; sa += da * da;
        }
        // (a block a decoder rejects comes back magenta, all sixteen texels of it)
        for (let by = 0; by + 4 <= h; by += 4) for (let bx = 0; bx + 4 <= w; bx += 4) {
          let all = true, was = true;
          for (let y = 0; y < 4 && all; y++) for (let x = 0; x < 4; x++) { const i = 4 * ((by + y) * w + bx + x); if (!(back[i] === 255 && back[i + 1] === 0 && back[i + 2] === 255 && back[i + 3] === 255)) { all = false; break; } if (!(px[i] > 240 && px[i + 1] < 16 && px[i + 2] > 240)) was = false; }
          if (all && !was) magenta++;
        }
        const n = w * h;
        out[mode] = { own, db: +(10 * Math.log10(255 * 255 / Math.max(1e-9, se / (3 * Math.max(1, shown))))).toFixed(1), alphaDb: mode === 'alpha' ? +(10 * Math.log10(255 * 255 / Math.max(1e-9, sa / n))).toFixed(1) : undefined, magenta, ms: Math.round(ms), mpxs: +(n * 1.333 / 1e6 / (ms / 1000)).toFixed(1), bytes: levels.reduce((s, l) => s + l.data.length, 0), raw: Math.round(n * 4 * 1.333), err: gl.getError() };
        gl.deleteTexture(tex); gl.deleteTexture(rt); gl.deleteFramebuffer(fb);
      }
      return { w, h, out };
    }, [`http://localhost:${process.env.PORT || 8800}/${pic}`]).catch(e => ({ error: String(e).slice(0, 300) }));
    if (r.error) { console.log(`FAIL ${pic}: ${r.error}`); bad++; continue; }
    for (const [mode, o] of Object.entries(r.out)) {
      const ok = o.db >= MIN && !o.err && !o.magenta && Math.abs(o.own - o.db) < 1 && (o.alphaDb === undefined || o.alphaDb >= 20);
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${pic} ${r.w}x${r.h} ${mode}: ${o.db} dB (the encoder's own count ${o.own})${o.alphaDb !== undefined ? `, alpha ${o.alphaDb} dB` : ''}, ${(o.bytes / 1048576).toFixed(2)} MB for ${(o.raw / 1048576).toFixed(2)} of RGBA8 with mipmaps, encoded in ${o.ms} ms (${o.mpxs} million texels a second)${o.err ? `, GL error ${o.err}` : ''}${o.magenta ? `, ${o.magenta} blocks rejected (magenta)` : ''}`);
    }
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
