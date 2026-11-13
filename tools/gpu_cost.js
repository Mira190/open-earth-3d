// Where one frame's GPU time goes, draw by draw, on the software renderer: each draw call (and each clear and
// blit) is fenced and timed (gl.finish() returns at once in Chromium, so the fence is one pixel of the target drawn
// into, blitted to a 1 x 1 target of its kind and read back), and the times are summed by the target drawn into and by what drew
// (the object's name, else its material's, else the shader's SHADER_NAME). A software rasteriser's times are not
// a GPU's, but the share each part takes of a frame says what is worth cutting: fragment-heavy work weighs on
// both. The fences serialise the frame, so the total is longer than a frame without them.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/gpu_cost.js shibuya [WxH] [frames]
// TIER, TIME, NIGHT, FOOT, FREEZE, QUERY and EVAL as tools/frame_cost.js. TOP=n rows per target (default 12).
// DUMP=label writes the shaders of the first draw whose label holds it to DUMP_TO (default shader.glsl).
const { chromium } = require('playwright');
const [,, city = 'shibuya', size = '1440x900', frames = '2'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype;
    const raw = { bind: P.bindFramebuffer, blit: P.blitFramebuffer, read: P.readPixels, rb: P.bindRenderbuffer, store: P.renderbufferStorage, attach: P.framebufferRenderbuffer }; // (before any wrapping)
    let on = false, rec = null, label = null, prog = null, fbName = 'canvas';
    const names = new WeakMap(), fbs = new WeakMap(), texs = new WeakMap(), rbs = new WeakMap();
    let bTex = null, bRb = null, bFb = null;
    const wrap = (n, f) => { const o = P[n]; P[n] = function (...a) { f.call(this, ...a); return o.apply(this, a); }; };
    wrap('bindTexture', function (t, x) { bTex = x; });
    const FL = new Set([0x881A, 0x8814, 0x822F, 0x822D, 0x8D62, 0x8C3A, 0x822E, 0x8230]); // float colour formats
    wrap('texStorage2D', function (t, l, f, W, H) { if (bTex) texs.set(bTex, { n: `${W}x${H}`, fl: FL.has(f) }); });
    wrap('texImage2D', function (t, l, f, W, H) { if (bTex && typeof W === 'number' && !l) texs.set(bTex, { n: `${W}x${H}`, fl: FL.has(f) }); });
    wrap('bindRenderbuffer', function (t, x) { bRb = x; });
    wrap('renderbufferStorage', function (t, f, W, H) { if (bRb) rbs.set(bRb, { n: `${W}x${H}`, fl: FL.has(f) }); });
    wrap('renderbufferStorageMultisample', function (t, s, f, W, H) { if (bRb) rbs.set(bRb, { n: `${W}x${H}x${s}`, fl: FL.has(f) }); });
    wrap('framebufferTexture2D', function (t, att, tt, x) { if (bFb && att === this.COLOR_ATTACHMENT0 && texs.get(x)) fbs.set(bFb, texs.get(x)); });
    wrap('framebufferRenderbuffer', function (t, att, rt, x) { if (bFb && att === this.COLOR_ATTACHMENT0 && rbs.get(x)) fbs.set(bFb, rbs.get(x)); });
    let bRead = null;
    wrap('bindFramebuffer', function (t, x) {
      if (t !== this.DRAW_FRAMEBUFFER) bRead = x;
      if (t !== this.READ_FRAMEBUFFER) { bFb = x; fbName = x ? ((fbs.get(x) || {}).n || 'fb?') : 'canvas'; }
    });
    // the fence: one pixel of the target drawn into, blitted to a 1 x 1 target of its kind and read back
    const tiny = {};
    function fence(gl) {
      const info = bFb ? fbs.get(bFb) : { fl: false };
      if (!info) { gl.finish(); return; }
      const k = info.fl ? 'f' : 'b';
      if (!tiny[k]) {
        const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
        raw.rb.call(gl, gl.RENDERBUFFER, rb);
        gl.getExtension('EXT_color_buffer_float');
        raw.store.call(gl, gl.RENDERBUFFER, info.fl ? 0x881A : 0x8058, 1, 1);
        raw.rb.call(gl, gl.RENDERBUFFER, bRb);
        raw.bind.call(gl, gl.DRAW_FRAMEBUFFER, fb);
        raw.attach.call(gl, gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        tiny[k] = { fb, buf: info.fl ? new Float32Array(4) : new Uint8Array(4) };
      }
      const T = tiny[k];
      raw.bind.call(gl, gl.READ_FRAMEBUFFER, bFb);
      raw.bind.call(gl, gl.DRAW_FRAMEBUFFER, T.fb);
      raw.blit.call(gl, 0, 0, 1, 1, 0, 0, 1, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      raw.bind.call(gl, gl.READ_FRAMEBUFFER, T.fb);
      raw.read.call(gl, 0, 0, 1, 1, gl.RGBA, info.fl ? gl.FLOAT : gl.UNSIGNED_BYTE, T.buf);
      raw.bind.call(gl, gl.READ_FRAMEBUFFER, bRead);
      raw.bind.call(gl, gl.DRAW_FRAMEBUFFER, bFb);
    }
    wrap('useProgram', function (p) { prog = p; });
    const progName = (gl, p) => {
      if (!p) return '?';
      let n = names.get(p);
      if (!n) {
        n = '?';
        for (const s of gl.getAttachedShaders(p) || []) { const m = /#define SHADER_NAME (\S+)/.exec(gl.getShaderSource(s) || ''); if (m) { n = m[1]; break; } }
        names.set(p, n);
      }
      return n;
    };
    const timed = n => { const o = P[n]; P[n] = function (...a) {
      if (!on) return o.apply(this, a);
      fence(this); const t0 = performance.now();
      const r = o.apply(this, a);
      fence(this); const dt = performance.now() - t0;
      const what = /draw/.test(n) ? (label || progName(this, prog)) : n;
      if (window.__dumpWant && /draw/.test(n) && what.includes(window.__dumpWant) && !window.__dumped) { const sh = this.getAttachedShaders(prog); window.__dumped = sh.map(x => this.getShaderSource(x)).join('\n//=====FRAGMENT=====\n'); }
      const k = fbName + '\u0000' + what;
      const e = rec.get(k) || { fb: fbName, what, ms: 0, n: 0 };
      e.ms += dt; e.n++; rec.set(k, e);
      return r;
    }; };
    for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear', 'blitFramebuffer']) timed(n);
    addEventListener('three-ready', () => {
      // the label of whatever three.js draws next: the object's name, else its material's, else its parent's
      const R = THREE.WebGLRenderer;
      THREE.WebGLRenderer = class extends R { constructor(...a) { super(...a); const f = this.renderBufferDirect;
        this.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) {
          if (on) {
            let n = (obj && obj.name) || (mat && mat.name) || '';
            for (let o = obj && obj.parent, k = 0; !n && o && k < 4; o = o.parent, k++) n = o.name ? o.name + '/' : '';
            if (!n && geo) n = (mat && mat.type) + ' ' + (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 | 0) + 't';
            label = n + (obj && obj.isInstancedMesh ? ` [inst ${obj.count}${obj.parent && obj.parent.name ? ' in ' + obj.parent.name : ''}${obj.userData.shadowStatic ? ' still' : ''}${geo && geo.attributes.tc ? ' tree' : ''}${obj.userData.noRefl ? ' noRefl' : ''}]` : '');
          }
          try { return f.apply(this, arguments); } finally { label = null; }
        }; } };
    });
    window.__gpuCost = { start() { rec = new Map(); on = true; }, stop() { on = false; label = null; return [...rec.values()]; } };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('page error', String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const time = process.env.NIGHT ? '21:30' : process.env.TIME || '15:30';
  await p.evaluate(t => { const g = window.__game; const [H, M] = t.split(':').map(Number); const c = g.clock; g.setClock(c.y, c.m, c.d, H * 60 + M); }, time);
  if (process.env.FOOT) {
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
    for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
      await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
      await p.waitForTimeout(1000);
    }
    await p.evaluate(async () => {
      const g = window.__game;
      for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
      for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
      if (g.cine && g.cine.active) g.cine.skip();
      const O = window.OEOnboard, tour = O && O.current && O.current(); if (tour) tour.skip();
    });
  }
  if (process.env.FREEZE) await p.evaluate(() => { window.__game.clock.frozen = true; });
  if (process.env.EVAL) { const r = await p.evaluate(process.env.EVAL); if (r !== undefined) console.log("EVAL:", JSON.stringify(r)); }
  await p.waitForTimeout(6000);
  if (process.env.DUMP) await p.evaluate(d => { window.__dumpWant = d; }, process.env.DUMP);
  const runs = await p.evaluate(async n => {
    const out = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r));
      window.__gpuCost.start();
      await new Promise(r => requestAnimationFrame(r));
      out.push(window.__gpuCost.stop());
    }
    return out;
  }, +frames);
  // (MOST=1: the slowest frame of those measured, for work done every few frames: the sea's reflection)
  const tot = r => r.reduce((a, e) => a + e.ms, 0);
  const last = process.env.MOST ? runs.reduce((a, r) => (tot(r) > tot(a) ? r : a), runs[0]) : runs[runs.length - 1], byFb = new Map();
  let total = 0;
  for (const e of last) { total += e.ms; const f = byFb.get(e.fb) || { ms: 0, rows: [] }; f.ms += e.ms; f.rows.push(e); byFb.set(e.fb, f); }
  console.log(`${city} ${size} ${process.env.TIER || 'high'} ${time}: ${total.toFixed(0)} ms fenced (software GL)`);
  for (const [fb, f] of [...byFb].sort((a, b) => b[1].ms - a[1].ms)) {
    if (f.ms < total * 0.005) continue;
    console.log(`${fb.padEnd(22)} ${f.ms.toFixed(1).padStart(8)} ms ${(100 * f.ms / total).toFixed(1).padStart(5)}%`);
    for (const e of f.rows.sort((a, b) => b.ms - a.ms).slice(0, +(process.env.TOP || 12)))
      console.log(`    ${e.what.slice(0, 48).padEnd(48)} ${String(e.n).padStart(4)}x ${e.ms.toFixed(1).padStart(8)} ms ${(100 * e.ms / total).toFixed(1).padStart(5)}%`);
  }
  if (process.env.DUMP) require('fs').writeFileSync(process.env.DUMP_TO || 'shader.glsl', await p.evaluate(() => window.__dumped || ''));
  await b.close();
})();
