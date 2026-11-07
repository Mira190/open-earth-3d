// The frame hitches of a walk (issue 201 item 2): the player glides from NPC to NPC that has not loaded
// yet, nearest first, so the NPC characters and the crowd's stream in as they do on foot, and every
// frame's length is kept with the WebGL work done on the main thread (texture uploads, shader compiles
// and links, each timed) and the long tasks.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/walk_hitch.js sydney [seconds, 40] [m/s, 9]   (W, H: the window, 640x400)
//   PLAY=1 xvfb-run -a node tools/walk_hitch.js queenstown 20   the frames from the press of Play through the arrival
// TIER=high (default) forces a quality tier. OUT=file.json writes the frames and the GL log as JSON.
// Software WebGL (llvmpipe) makes the GPU's share far slower than a real device's: compare runs on the
// same machine, and read the counts of uploads and compiles in the walk before their milliseconds.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'sydney', secs = '40', speed = '9'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: +(process.env.W || 640), height: +(process.env.H || 400) }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(STACK => {
    const gl = window.__gl = { on: false, calls: {}, log: [] };
    const P = WebGL2RenderingContext.prototype;
    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texStorage2D', 'compressedTexImage2D', 'generateMipmap', 'compileShader', 'linkProgram', 'getProgramParameter', 'getProgramInfoLog']) {
      const f = P[name];
      if (!f) continue;
      P[name] = function (...a) {
        if (!gl.on) return f.apply(this, a);
        const t0 = performance.now(), r = f.apply(this, a), dt = performance.now() - t0;
        const c = gl.calls[name] || (gl.calls[name] = { n: 0, ms: 0, max: 0 });
        c.n++; c.ms += dt; c.max = Math.max(c.max, dt);
        // the texel count of an upload: (target, level, ifmt, w, h, ...) or (target, level, ifmt, fmt, type, source)
        let px = 0;
        if (name === 'texImage2D' || name === 'texSubImage2D') px = typeof a[3] === 'number' && typeof a[4] === 'number' && a.length >= 8 ? a[3] * a[4] : (a[a.length - 1] && (a[a.length - 1].width * a[a.length - 1].height || 0)) || 0;
        gl.log.push({ t: t0, name, ms: dt, px });
        return r;
      };
    }
    // which shader each compile is (three.js names its programs in "#define SHADER_NAME"), with its variant's
    // defines, to tell which materials compile on the way (PLAY=1 lists them)
    const names = new WeakMap(), src = P.shaderSource;
    window.__stack = !!STACK;
    P.shaderSource = function (sh, text) {
      const nm = (/#define SHADER_NAME (.*)/.exec(text) || [])[1] || '?';
      const defs = (text.match(/#define (USE_[A-Z_]+|[A-Z_]*INSTANC[A-Z_]*|FLAT_SHADED|DOUBLE_SIDED)\b/g) || []).map(d => d.slice(8)).join(' ');
      const own = [...new Set((text.match(/uniform\s+\w+\s+(u[A-Z]\w*)/g) || []).map(u => u.split(/\s+/).pop()))].slice(0, 4).join(',');
      names.set(sh, nm + (own ? ' {' + own + '}' : '') + (/gl_FragColor|pc_fragColor|out highp vec4/.test(text) ? ' (fs)' : ' (vs)') + (defs ? ' [' + defs + ']' : '') + ' #' + text.length);
      return src.call(this, sh, text);
    };
    const comp = P.compileShader;
    P.compileShader = function (sh) {
      if (gl.on) gl.shaders.push({ t: performance.now(), what: names.get(sh) || '?',
        // (STACK=1: the page's own frames that led to it, past three.js)
        from: window.__stack ? (new Error().stack || '').split('\n').filter(l => /\/(game|web)\/|\/[a-z]+\.js/.test(l) && !/vendor|three/.test(l)).slice(0, 4).map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ') : undefined });
      return comp.call(this, sh);
    };
    gl.shaders = [];
    const fr = window.__frames = [];
    const tick = t => { fr.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, ms: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
  }, !!process.env.STACK);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && !document.querySelector('#g-title').hidden && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  let pending0 = null;
  // PLAY=1: the frames from the press of Play through the arrival (the survey's start, issue 265), not a walk
  if (process.env.PLAY) await p.evaluate(() => { window.__gl.on = true; window.__frames.length = 0; window.__long.length = 0; window.__loads = []; window.__walkDone = false; });
  await p.evaluate(() => document.querySelector('#gt-play').click());
  await p.waitForFunction(() => window.__game && window.__game.player && !window.__game.cine?.on, null, { timeout: 120000, polling: 500 }).catch(() => {});
  await p.waitForTimeout(process.env.PLAY ? +secs * 1000 : 12000); // the arrival plays and settles
  if (process.env.PLAY) await p.evaluate(() => { window.__walkDone = true; });
  else {
  pending0 = await p.evaluate(() => window.__game.npcs.filter(n => n.rig.pending).length);
  // the walk: toward the nearest NPC still to load, at <speed> m/s, the ground's height under each step
  await p.evaluate(([secs, v]) => {
    const g = window.__game, pl = g.player;
    window.__gl.on = true; window.__frames.length = 0; window.__long.length = 0;
    window.__loads = [];
    const seen = new Set(g.npcs.filter(n => !n.rig.pending).map(n => n.id));
    const t0 = performance.now();
    let last = t0;
    const step = t => {
      const dt = Math.min(1, (t - last) / 1000); last = t; // by the wall clock: a slow renderer still covers the ground
      for (const n of g.npcs) if (!n.rig.pending && !seen.has(n.id)) { seen.add(n.id); window.__loads.push({ t, id: n.id }); }
      const left = g.npcs.filter(n => n.rig.pending);
      let tgt = null, best = Infinity;
      for (const n of left) { const d = Math.hypot(n.x - pl.x, n.y - pl.y); if (d < best) { best = d; tgt = n; } }
      if (tgt && best > 3) {
        const k = Math.min(1, v * dt / best), x = pl.x + (tgt.x - pl.x) * k, y = pl.y + (tgt.y - pl.y) * k;
        const z = (g.nav.walk && g.nav.walk(x, y, pl.z + 30)) || null;
        pl.x = x; pl.y = y; if (z && isFinite(z.z)) pl.z = z.z;
        pl.h = Math.atan2(tgt.x - pl.x, tgt.y - pl.y);
      }
      if (t - t0 < secs * 1000) requestAnimationFrame(step); else window.__walkDone = true;
    };
    requestAnimationFrame(step);
  }, [+secs, +speed]);
  }
  await p.waitForFunction(() => window.__walkDone, null, { timeout: (+secs + 120) * 1000, polling: 500 });
  const r = await p.evaluate(() => ({ frames: window.__frames.slice(), long: window.__long.slice(), gl: window.__gl, loads: window.__loads,
    pending: window.__game.npcs.filter(n => n.rig.pending).length }));
  const dts = []; for (let i = 1; i < r.frames.length; i++) dts.push(r.frames[i] - r.frames[i - 1]);
  const sorted = dts.slice().sort((a, b) => a - b), q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] || 0;
  const tex = r.gl.log.filter(e => /^tex|compressed|generateMipmap/.test(e.name)), comp = r.gl.log.filter(e => e.name === 'compileShader' || e.name === 'linkProgram');
  const sum = l => l.reduce((s, e) => s + e.ms, 0);
  // the frames over 50 ms, with the GL work inside each
  const spikes = [];
  for (let i = 1; i < r.frames.length; i++) {
    const a = r.frames[i - 1], z = r.frames[i];
    if (z - a < 50) continue;
    const inF = r.gl.log.filter(e => e.t >= a && e.t < z);
    spikes.push({ at: +((a - r.frames[0]) / 1000).toFixed(1), ms: Math.round(z - a), texMs: Math.round(sum(inF.filter(e => /^tex|compressed|generateMipmap/.test(e.name)))), tex: inF.filter(e => /^tex|compressed/.test(e.name)).length, big: inF.filter(e => e.px >= 256 * 256).length,
      compiles: inF.filter(e => e.name === 'compileShader').length, linkWaitMs: Math.round(sum(inF.filter(e => /getProgram/.test(e.name)))) });
  }
  // the model-sized uploads a frame at most (several in one frame: a model uploaded on its first draw)
  let bigMax = 0;
  for (let i = 1; i < r.frames.length; i++) bigMax = Math.max(bigMax, tex.filter(e => e.px >= 256 * 256 && e.t >= r.frames[i - 1] && e.t < r.frames[i]).length);
  const out = {
    city, tier: process.env.TIER || 'high', secs: +secs, frames: dts.length, fps: +(dts.length / (+secs)).toFixed(1),
    p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: Math.round(sorted[sorted.length - 1] || 0),
    over50: dts.filter(d => d > 50).length, over100: dts.filter(d => d > 100).length, longTasks: r.long.length, longMs: Math.round(sum(r.long.map(l => ({ ms: l.ms })))),
    npcsLoaded: r.loads.length, npcsPendingBefore: pending0, npcsPendingAfter: r.pending,
    texUploads: tex.filter(e => /^tex|compressed/.test(e.name)).length, texMpx: +(tex.reduce((s, e) => s + (e.px || 0), 0) / 1e6).toFixed(1),
    bigUploads: tex.filter(e => e.px >= 256 * 256).length, bigPerFrameMax: bigMax, // a model's texture, not a label's or a lookup's texMs: Math.round(sum(tex)), texMaxMs: Math.round(Math.max(0, ...tex.map(e => e.ms))),
    compiles: comp.filter(e => e.name === 'compileShader').length, linkWaitMs: Math.round(sum(r.gl.log.filter(e => /getProgram/.test(e.name)))),
    worst: spikes.sort((a, b) => b.ms - a.ms).slice(0, 10), errors: errors.slice(0, 5),
    shaders: process.env.PLAY ? r.gl.shaders.map(e => `${((e.t - r.frames[0]) / 1000).toFixed(1)} s ${e.what}${e.from ? ' <= ' + e.from : ''}`) : undefined,
  };
  console.log(JSON.stringify(out, null, 1));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(Object.assign({ dts, gl: r.gl.log, loads: r.loads }, out)));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
