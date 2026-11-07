// Where one frame of the game goes, pass by pass: every framebuffer the frame draws into (its size and
// format), the draw calls and triangles into it, the full-screen passes (a draw of 3 or 6 vertices), the
// pixels those passes shade and the bytes they write; and the JavaScript time of the game's own step.
// A software renderer gives no GPU timings worth reading, so this counts the work instead: on a phone's
// tile-based GPU the full-screen passes and their bytes are what cost, and on any GPU the triangles.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/frame_cost.js sydney [WxH] [frames]
// TIER=low|medium|high (default high). TIME=HH:MM sets the clock (default 15:30); NIGHT=1 is 21:30.
const { chromium } = require('playwright');
const [,, city = 'sydney', size = '1440x900', frames = '3'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(() => {
    const BPP = { 0x881A: 8, 0x8058: 4, 0x8C43: 4, 0x8229: 1, 0x822B: 2, 0x8814: 16, 0x822E: 4, 0x822F: 4, 0x8C3A: 4, 0x81A6: 4, 0x81A5: 2, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D62: 2, 0x8F94: 4 };
    const fbInfo = new WeakMap(); // framebuffer -> {w, h, fmt, bpp}
    let rec = null, cur = null, texInfo = new WeakMap(), rbInfo = new WeakMap();
    const P = WebGL2RenderingContext.prototype;
    const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { fn.call(this, ...a); return o.apply(this, a); }; };
    let boundTex = null, boundRb = null;
    wrap('bindTexture', function (t, tex) { if (t === this.TEXTURE_2D) boundTex = tex; });
    wrap('texStorage2D', function (t, l, f, W, H) { if (t === this.TEXTURE_2D && boundTex) texInfo.set(boundTex, { w: W, h: H, fmt: f }); });
    wrap('texImage2D', function (t, l, f, W, H) { if (t === this.TEXTURE_2D && boundTex && l === 0 && typeof W === 'number') texInfo.set(boundTex, { w: W, h: H, fmt: f }); });
    wrap('bindRenderbuffer', function (t, rb) { boundRb = rb; });
    wrap('renderbufferStorage', function (t, f, W, H) { if (boundRb) rbInfo.set(boundRb, { w: W, h: H, fmt: f }); });
    wrap('renderbufferStorageMultisample', function (t, s, f, W, H) { if (boundRb) rbInfo.set(boundRb, { w: W, h: H, fmt: f, samples: s }); });
    let boundFb = null;
    wrap('bindFramebuffer', function (t, fb) { if (t === this.FRAMEBUFFER || t === this.DRAW_FRAMEBUFFER) boundFb = fb; });
    wrap('framebufferTexture2D', function (t, att, tt, tex) { if (!boundFb) return; const e = fbInfo.get(boundFb) || {}; const i = texInfo.get(tex); if (i) { if (att === this.DEPTH_ATTACHMENT || att === this.DEPTH_STENCIL_ATTACHMENT) e.depth = i; else e.color = i; } fbInfo.set(boundFb, e); });
    wrap('framebufferRenderbuffer', function (t, att, rt, rb) { if (!boundFb) return; const e = fbInfo.get(boundFb) || {}; const i = rbInfo.get(rb); if (i) { if (att === this.COLOR_ATTACHMENT0) e.color = i; else e.depth = i; } fbInfo.set(boundFb, e); });
    const vp = [0, 0, 0, 0];
    wrap('viewport', function (x, y, W, H) { vp[0] = x; vp[1] = y; vp[2] = W; vp[3] = H; });
    const draw = (gl, mode, count, inst) => {
      if (!rec) return;
      const key = boundFb ? boundFb : 'screen';
      let e = rec.get(key);
      if (!e) {
        const i = boundFb ? fbInfo.get(boundFb) || {} : { color: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, fmt: 0x8058 } };
        e = { order: rec.size, color: i.color, depth: i.depth, draws: 0, tris: 0, full: 0, fullPx: 0, fullBytes: 0 };
        rec.set(key, e);
      }
      e.draws++;
      const t = mode === gl.TRIANGLES ? count / 3 : mode === gl.TRIANGLE_STRIP ? count - 2 : 0;
      e.tris += t * (inst || 1);
      if ((count === 3 || count === 6) && (inst || 1) === 1) {
        const px = vp[2] * vp[3];
        e.full++; e.fullPx += px; e.fullBytes += px * ((e.color && BPP[e.color.fmt]) || 4);
      }
    };
    wrap('drawArrays', function (m, f, c) { draw(this, m, c, 1); });
    wrap('drawElements', function (m, c) { draw(this, m, c, 1); });
    wrap('drawArraysInstanced', function (m, f, c, n) { draw(this, m, c, n); });
    wrap('drawElementsInstanced', function (m, c, t, o, n) { draw(this, m, c, n); });
    window.__frameCost = {
      start() { rec = new Map(); },
      stop() { const r = [...rec.values()]; rec = null; return r; },
    };
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const time = process.env.NIGHT ? '21:30' : process.env.TIME || '15:30';
  await p.evaluate(t => { const g = window.__game; const [H, M] = t.split(':').map(Number); const c = g.clock; g.setClock(c.y, c.m, c.d, H * 60 + M); }, time);
  await p.waitForTimeout(6000);
  const out = await p.evaluate(async n => {
    const g = window.__game, res = [], js = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r));
      window.__frameCost.start();
      const t0 = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      js.push(performance.now() - t0);
      res.push(window.__frameCost.stop());
    }
    return { passes: res[res.length - 1], frameMs: js, px: [innerWidth, innerHeight, devicePixelRatio], pxScale: g.pxScale && g.pxScale() };
  }, +frames);
  const fmt = c => c ? `${c.w}x${c.h} ${({ 0x881A: 'RGBA16F', 0x8058: 'RGBA8', 0x8C43: 'SRGB8_A8', 0x8229: 'R8', 0x822B: 'RG8', 0x8814: 'RGBA32F', 0x822F: 'RG16F', 0x81A6: 'D24', 0x8CAC: 'D32F', 0x88F0: 'D24S8' })[c.fmt] || '0x' + c.fmt.toString(16)}${c.samples ? ' x' + c.samples + 'MSAA' : ''}` : '?';
  const M = x => (x / 1e6).toFixed(2);
  let full = 0, bytes = 0, tris = 0, draws = 0;
  console.log(`${city} ${size} ${process.env.TIER || 'high'} ${time}: viewport ${out.px.join(' x ')}, pixel scale ${out.pxScale}; frame-to-frame ${out.frameMs.map(x => x.toFixed(0)).join(', ')} ms (software GL)`);
  for (const e of out.passes) {
    full += e.full; bytes += e.fullBytes; tris += e.tris; draws += e.draws;
    console.log(`  ${fmt(e.color).padEnd(26)} depth ${fmt(e.depth).padEnd(16)} ${String(e.draws).padStart(4)} draws ${M(e.tris).padStart(6)}M tris  ${e.full ? `${e.full} full-screen, ${M(e.fullPx)} Mpx, ${(e.fullBytes / 1048576).toFixed(1)} MB written` : ''}`);
  }
  console.log(`  total: ${draws} draws, ${M(tris)}M triangles, ${full} full-screen passes writing ${(bytes / 1048576).toFixed(1)} MB a frame (${(bytes * 60 / 1073741824).toFixed(2)} GB/s at 60 fps, before reads)`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
  await b.close();
})();
