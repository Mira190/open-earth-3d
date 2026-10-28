// Sun ray casting on the GPU: a line-for-line WebGL2 port of Sun.castRay (sun.js), used
// for the sun-hours map. Each output pixel is one ground point; the shader casts that
// point's ray towards every sun position of the day and counts the ones that reach the
// sky. The surface model and its 8 x 8 block maxima are float textures read with
// texelFetch, so the result matches sun.js ray for ray. Returns null where WebGL2 float
// textures are missing or the surface model is larger than the GPU allows; the caller
// then uses sun.js on the CPU.
'use strict';
window.SunGPU = (function () {
  const RAD = Math.PI / 180, W = 1024, MAX_SUNS = 96;
  let gl = null, prog = null, loc = {}, dsmKey = null, texD = null, texM = null;

  const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D D, Mx, Pt; uniform vec3 sun[${MAX_SUNS}];
uniform int nx, ny, ns, n, row0; uniform float cell, x0, y1, gmax;
out vec4 o;
// sun.js castRay: march the ray in 0.75-cell steps, skipping any 8 x 8 block it clears
bool lit(vec3 q, vec3 s) {
  float dx = s.x, dy = s.y, tanA = s.z, z = q.z;
  float dmax = (gmax - z) / tanA, stp = cell * 0.75, bs = 8.0 * cell, d = stp;
  for (int i = 0; i < 16384; i++) {
    if (d > dmax) return true;
    float px = q.x + dx * d, py = q.y + dy * d;
    int c = int(floor((px - x0) / cell)), r = int(floor((y1 - py) / cell));
    if (c < 0 || r < 0 || c >= nx || r >= ny) return true;
    float zr = z + d * tanA; int bc = c / 8, br = r / 8;
    if (zr > texelFetch(Mx, ivec2(bc, br), 0).r) {
      float bxl = x0 + float(bc) * bs, byt = y1 - float(br) * bs;
      float tx = dx > 1e-9 ? (bxl + bs - px) / dx : (dx < -1e-9 ? (bxl - px) / dx : 1e30);
      float ty = dy > 1e-9 ? (byt - py) / dy : (dy < -1e-9 ? (byt - bs - py) / dy : 1e30);
      d += max(min(tx, ty), 0.0) + 0.01; continue;
    }
    if (texelFetch(D, ivec2(c, r), 0).r > zr) return false;
    d += stp;
  }
  return true;
}
void main() {
  int idx = (int(gl_FragCoord.y) + row0) * ${W} + int(gl_FragCoord.x);
  if (idx >= n) { o = vec4(0.0); return; }
  vec3 q = texelFetch(Pt, ivec2(idx % ${W}, idx / ${W}), 0).xyz;
  int lit_n = 0;
  for (int k = 0; k < ${MAX_SUNS}; k++) { if (k >= ns) break; if (lit(q, sun[k])) lit_n++; }
  o = vec4(float(lit_n) / 255.0, 0.0, 0.0, 1.0);
}`;

  function init() {
    if (gl) return true;
    const cv = document.createElement('canvas');
    gl = cv.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const k of ['D', 'Mx', 'Pt', 'sun', 'nx', 'ny', 'ns', 'n', 'row0', 'cell', 'x0', 'y1', 'gmax']) loc[k] = gl.getUniformLocation(prog, k);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(loc.D, 0); gl.uniform1i(loc.Mx, 1); gl.uniform1i(loc.Pt, 2);
    return true;
  }
  function tex(unit, w, h, ifmt, fmt, arr) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.FLOAT, arr);
    return t;
  }

  // can this surface model be ray cast here, on real graphics hardware? A software
  // rasteriser (SwiftShader, llvmpipe) is slower than sun.js, so it gets the CPU path
  // unless a test sets SunGPU.force.
  function available(G) {
    try {
      if (!init()) return false;
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|software|basic render/i.test(name) && !api.force) return false;
      return G.nx <= max && G.ny <= max;
    } catch (e) { console.warn('GPU sun unavailable:', e); return false; }
  }

  // pts: Float32Array of x, y, z per point; suns: Sun.position() results above the horizon.
  // Resolves to a Uint8Array with the number of suns each point sees.
  async function count(G, pts, suns, onProgress) {
    if (suns.length > MAX_SUNS) throw new Error(`at most ${MAX_SUNS} sun positions`);
    const n = pts.length / 3, H = Math.ceil(n / W);
    if (dsmKey !== G) { // upload the surface model and its block maxima once per model
      if (texD) { gl.deleteTexture(texD); gl.deleteTexture(texM); }
      texD = tex(0, G.nx, G.ny, gl.R32F, gl.RED, G.data);
      texM = tex(1, G.bx, Math.ceil(G.M.length / G.bx), gl.R32F, gl.RED, G.M);
      dsmKey = G;
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texD);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texM);
    const pp = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) { pp[4 * i] = pts[3 * i]; pp[4 * i + 1] = pts[3 * i + 1]; pp[4 * i + 2] = pts[3 * i + 2]; }
    const texP = tex(2, W, H, gl.RGBA32F, gl.RGBA, pp);
    gl.useProgram(prog);
    const sv = new Float32Array(MAX_SUNS * 3);
    suns.forEach((s, k) => { sv[3 * k] = Math.sin(s.azimuth * RAD); sv[3 * k + 1] = Math.cos(s.azimuth * RAD); sv[3 * k + 2] = Math.tan(s.altitude * RAD); });
    gl.uniform3fv(loc.sun, sv);
    gl.uniform1i(loc.nx, G.nx); gl.uniform1i(loc.ny, G.ny); gl.uniform1i(loc.ns, suns.length); gl.uniform1i(loc.n, n);
    gl.uniform1f(loc.cell, G.cell); gl.uniform1f(loc.x0, G.x0); gl.uniform1f(loc.y1, G.y1); gl.uniform1f(loc.gmax, G.max);
    const out = new Uint8Array(n), band = 32; // rows of 1024 points per draw, so no single draw runs long
    const rt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, rt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, band, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    gl.viewport(0, 0, W, band);
    const px = new Uint8Array(W * band * 4);
    for (let r0 = 0; r0 < H; r0 += band) {
      gl.uniform1i(loc.row0, r0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, W, band, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0, k = r0 * W; i < W * band && k < n; i++, k++) out[k] = px[4 * i];
      if (onProgress) onProgress(Math.min(1, (r0 + band) / H));
      await new Promise(res => setTimeout(res, 0));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(rt); gl.deleteTexture(texP);
    return out;
  }

  const api = { available, count, force: false };
  return api;
})();
