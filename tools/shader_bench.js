// How long software WebGL (llvmpipe, as the checks run it) takes to compile and link a program, for
// fragment shaders written out by tools/shader_dump.js: each <name>.glsl with its <name>.vert.glsl,
// compiled and linked synchronously REPS times (a nonce line keeps the GPU process's program cache
// out of it), the median reported. To weigh a change to a shader: dump it, edit a copy, bench both.
//   xvfb-run -a node tools/shader_bench.js a.glsl [b.glsl ...]       (REPS=5)
const { chromium } = require('playwright');
const fs = require('fs');
const files = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage();
  await p.setContent('<canvas width=960 height=600></canvas>');
  for (const f of files) {
    const fsrc = fs.readFileSync(f, 'utf8'), vf = f.replace(/(\.pp)?\.glsl$/, '.vert.glsl'), vsrc = fs.readFileSync(fs.existsSync(vf) ? vf : f.replace(/\.[^/]*$/, '.vert.glsl'), 'utf8');
    const r = await p.evaluate(([vs, fsS, reps]) => {
      const gl = document.querySelector('canvas').getContext('webgl2'), out = [];
      const nonce = (s, k) => s.replace(/\bvoid\s+main\s*\(/, m => `const float oeNonce${k} = ${k}.0;\n${m}`);
      for (let k = 0; k < reps; k++) {
        const id = Math.floor(Math.random() * 1e9);
        const t0 = performance.now();
        const v = gl.createShader(gl.VERTEX_SHADER), fr = gl.createShader(gl.FRAGMENT_SHADER), pr = gl.createProgram();
        gl.shaderSource(v, nonce(vs, id)); gl.shaderSource(fr, nonce(fsS, id)); gl.compileShader(v); gl.compileShader(fr);
        gl.attachShader(pr, v); gl.attachShader(pr, fr); gl.linkProgram(pr);
        const ok = gl.getProgramParameter(pr, gl.LINK_STATUS);
        const dt = performance.now() - t0;
        if (!ok) return { err: (gl.getShaderInfoLog(fr) || gl.getProgramInfoLog(pr) || '').slice(0, 600) };
        // and a draw, which is where llvmpipe finishes some of its work
        // (each sampler on a unit of its own with a texture of its kind bound, or WebGL refuses the draw)
        gl.useProgram(pr);
        const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); let unit = 0;
        for (let i = 0; i < n; i++) {
          const u = gl.getActiveUniform(pr, i), kind = { [gl.SAMPLER_2D]: gl.TEXTURE_2D, [gl.SAMPLER_CUBE]: gl.TEXTURE_CUBE_MAP, [gl.SAMPLER_3D]: gl.TEXTURE_3D, [gl.SAMPLER_2D_ARRAY]: gl.TEXTURE_2D_ARRAY, [gl.SAMPLER_2D_SHADOW]: gl.TEXTURE_2D, [gl.UNSIGNED_INT_SAMPLER_2D]: gl.TEXTURE_2D }[u.type];
          if (!kind) continue;
          const key = u.type, base = u.name.replace(/\[0\]$/, '');
          for (let j = 0; j < u.size; j++) {
            const loc = gl.getUniformLocation(pr, u.size > 1 ? `${base}[${j}]` : u.name);
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(kind, (window.__tex || (window.__tex = {}))[key] || (window.__tex[key] = (() => {
              const t = gl.createTexture(); gl.bindTexture(kind, t);
              gl.texParameteri(kind, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(kind, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
              if (key === gl.SAMPLER_2D_SHADOW) { gl.texImage2D(kind, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null); gl.texParameteri(kind, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); }
              else if (key === gl.UNSIGNED_INT_SAMPLER_2D) gl.texImage2D(kind, 0, gl.RGBA8UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
              else if (kind === gl.TEXTURE_CUBE_MAP) for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
              else if (kind === gl.TEXTURE_3D || kind === gl.TEXTURE_2D_ARRAY) gl.texImage3D(kind, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
              else gl.texImage2D(kind, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
              return t; })()));
            gl.uniform1i(loc, unit++);
          }
        }
        // (a triangle over the whole canvas: the matrices identity, the position attribute covering the clip square)
        for (let i = 0; i < n; i++) {
          const u = gl.getActiveUniform(pr, i), loc = gl.getUniformLocation(pr, u.name);
          if (u.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(loc, false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
          if (u.type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(loc, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
        }
        const pl = gl.getAttribLocation(pr, 'position');
        if (pl >= 0) {
          const buf = window.__buf || (window.__buf = gl.createBuffer()); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0.5, 3, -1, 0.5, -1, 3, 0.5]), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 3, gl.FLOAT, false, 0, 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const e = gl.getError(); if (e) return { err: 'draw: GL error ' + e }; const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t1 = performance.now();
        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push({ link: dt, draw: t1 - t0 - dt, again: performance.now() - t1 });
        gl.deleteProgram(pr); gl.deleteShader(v); gl.deleteShader(fr);
      }
      const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      return { link: med(out.map(o => o.link)), draw: med(out.map(o => o.draw)), again: med(out.map(o => o.again)) };
    }, [vsrc, fsrc, +(process.env.REPS || 5)]);
    console.log(r.err ? `${f}: ERROR ${r.err}` : `${String(Math.round(r.link)).padStart(6)} ms link ${String(Math.round(r.draw)).padStart(6)} ms first draw ${String(Math.round(r.again)).padStart(5)} ms the next  ${(fsrc.length / 1024).toFixed(0)} kB  ${f}`);
  }
  await b.close();
})();
