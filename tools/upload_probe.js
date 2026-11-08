// Is a big texture upload slow by itself on the check machine's software WebGL, or only because it waits behind
// the work queued before it (issue 313: a 1000x1200 image's texSubImage2D, 6 s in Kyoto's loader)? The same
// upload three ways: on an idle GPU; sent right after a batch of shader links (fragment shaders written out by
// tools/shader_dump.js, or a stand-in with a long unrolled loop) and six 2048 px textures, as the loader sent
// them; and the same with a fence passed before each upload (world.js caughtUp, as uploadSliced and uploadBuffers
// now do).
//   xvfb-run -a node tools/upload_probe.js [shader.glsl ...]
const { chromium } = require('playwright');
const fs = require('fs');
const shaders = process.argv.slice(2).map(f => ({ fs: fs.readFileSync(f, 'utf8'), vs: fs.existsSync(f.replace(/(\.pp)?\.glsl$/, '.vert.glsl')) ? fs.readFileSync(f.replace(/(\.pp)?\.glsl$/, '.vert.glsl'), 'utf8') : null }));
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage();
  await p.setContent('<canvas width=960 height=600></canvas>');
  const r = await p.evaluate(async shaders => {
    const gl = document.querySelector('canvas').getContext('webgl2'), W = 1000, H = 1200;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g2 = cv.getContext('2d'); for (let i = 0; i < 400; i++) { g2.fillStyle = `hsl(${i * 37 % 360},60%,${30 + i % 40}%)`; g2.fillRect(Math.random() * W, Math.random() * H, 80, 80); }
    // (decoded from a file, as the loaders' images are: in the renderer's memory, not the GPU's)
    const img = await createImageBitmap(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9)));
    const upload = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      const t0 = performance.now(); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img); return performance.now() - t0;
    };
    const stand = { vs: '#version 300 es\nin vec4 position; void main() { gl_Position = position; }',
      fs: '#version 300 es\nprecision highp float; uniform vec4 u[64]; out vec4 c; void main() { vec4 a = vec4(0.0);\n' +
        Array.from({ length: 400 }, (_, i) => `a = sin(a * u[${i % 64}] + cos(a.yzwx * ${(i * 0.37).toFixed(2)}));`).join('\n') + '\nc = a; }' };
    let k = 0;
    const links = n => {
      for (let i = 0; i < n; i++) {
        const s = shaders.length ? shaders[i % shaders.length] : stand, id = ++k;
        const v = gl.createShader(gl.VERTEX_SHADER), f = gl.createShader(gl.FRAGMENT_SHADER), pr = gl.createProgram();
        const nonce = src => src.replace(/\bvoid\s+main\s*\(/, m => `const float oeProbe${id} = ${id}.0;\n${m}`);
        gl.shaderSource(v, nonce(s.vs || stand.vs)); gl.shaderSource(f, nonce(s.fs)); gl.compileShader(v); gl.compileShader(f);
        gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr); // (not checked: queued, as the loader's are)
      }
    };
    const fence = () => new Promise(done => { const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); const t0 = performance.now();
      const poll = () => (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED ? setTimeout(poll, 4) : done(performance.now() - t0)); setTimeout(poll, 0); });
    // (the loader's uploads went out in a row, the city's 2048 px atlases first: they fill the transfer buffer, and
    // the next one waits for the GPU process to take them, which it does only after the links queued before them)
    const big = new Uint8Array(2048 * 2048 * 4).map((_, i) => i * 31);
    const atlas = () => { const t0 = performance.now(), t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 2048, 2048); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2048, 2048, gl.RGBA, gl.UNSIGNED_BYTE, big); return performance.now() - t0; };
    await fence();
    const idle = upload();
    await fence();
    links(24); let atl = 0; for (let i = 0; i < 6; i++) atl += atlas(); const behind = upload();
    await fence();
    links(24); let waited = 0;
    let atl2 = 0; for (let i = 0; i < 6; i++) { waited += await fence(); atl2 += atlas(); }
    waited += await fence(); const gated = upload();
    return { idle, behind, waited, gated, atl, atl2 };
  }, shaders);
  console.log(`the six 2048 px textures: ${r.atl.toFixed(0)} ms in their calls sent behind the links, ${r.atl2.toFixed(0)} ms in their calls with a fence passed before each`);
  console.log(`1000x1200 texSubImage2D: ${r.idle.toFixed(0)} ms on an idle GPU; ${r.behind.toFixed(0)} ms sent right after 24 shader links and six 2048 px textures; ` +
    `${r.gated.toFixed(0)} ms sent the same way with a fence passed before each upload (the main thread free for ${r.waited.toFixed(0)} ms meanwhile)`);
  await b.close();
})();
