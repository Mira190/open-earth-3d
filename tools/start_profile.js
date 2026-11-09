// What the main thread does when "Start the survey" is pressed: every frame's length for a few
// seconds either side of the click, the long tasks, the WebGL work done on the main thread (shader
// compiles and links, texture and buffer uploads, each timed and counted) and a CPU profile of the
// seconds after the click, its functions ranked by their own time in the frames over 50 ms.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/start_profile.js sydney [WxH, 960x600] [seconds after the click, 20]
// TIER=high (default) forces a quality tier, as the films and stills do. CONT=1 presses Continue.
// LOAD=1 stops once the loader is gone, after printing its longest frames and the time to playable.
// LOAD=1 PROFILE=1 also profiles the load (from the page's first script on) and breaks its longest frames
// down: the WebGL work in each and the functions it spent its time in, by self and inclusive time.
// PROFILE=1 keeps the GL log on from the start, so the loader's compiles show in it too.
// OUT=file.json also writes the frames, the GL work and the ranked functions as JSON. RAIN=1 then puts the
// rain on and counts the shaders compiled for it (the wet street's reflection on the high tier, mirror.js).
// Software WebGL (llvmpipe) makes the GPU's share far slower than a real device's: read the
// JavaScript and the GL call counts first, and the GL milliseconds as an upper bound.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'sydney', size = '960x600', after = '20'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--enable-precise-memory-info'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(on => {
    // the WebGL calls that block the main thread, timed where they are made
    const gl = window.__gl = { on, calls: {}, log: [] };
    if (on) Error.stackTraceLimit = 60; // (past three.js's own frames, to the page's)
    const wrap = (proto, name) => {
      const f = proto[name];
      if (!f) return;
      proto[name] = function (...a) {
        if (!gl.on) return f.apply(this, a);
        const t0 = performance.now(), r = f.apply(this, a), dt = performance.now() - t0;
        const c = gl.calls[name] || (gl.calls[name] = { n: 0, ms: 0, max: 0 });
        c.n++; c.ms += dt; c.max = Math.max(c.max, dt);
        const bytes = name === 'bufferSubData' ? (a[4] != null ? a[4] * (a[2].BYTES_PER_ELEMENT || 1) : a[2] && a[2].byteLength) : 0;
        if (bytes) { c.bytes = (c.bytes || 0) + bytes; c.maxBytes = Math.max(c.maxBytes || 0, bytes); }
        const src = /^tex/.test(name) ? a[a.length - 1] : null, size = src && src.width ? `${src.width}x${src.height}` : /^tex/.test(name) && typeof a[3] === 'number' && typeof a[4] === 'number' ? `${a[3]}x${a[4]}` : undefined;
        if (dt > 4) gl.log.push({ t: t0, name, ms: +dt.toFixed(1), kb: bytes ? Math.round(bytes / 1024) : undefined, size });
        return r;
      };
    };
    // each program's link time, and how long its first check waited (a long wait: compiled on the frame)
    const linkP = WebGL2RenderingContext.prototype.linkProgram, logP = WebGL2RenderingContext.prototype.getProgramInfoLog;
    let seq = 0;
    gl.waits = [];
    // (which material each program is: three.js names its shaders in "#define SHADER_NAME", with a pass's own uniforms)
    const P2 = WebGL2RenderingContext.prototype, srcP = P2.shaderSource, attP = P2.attachShader, names = new WeakMap();
    P2.shaderSource = function (sh, text) {
      const nm = (/#define SHADER_NAME (.*)/.exec(text) || [])[1] || '?';
      const own = [...new Set((text.match(/uniform\s+\w+\s+(u[A-Z]\w*|t[A-Z]\w*)/g) || []).map(u => u.split(/\s+/).pop()))].slice(0, 3).join(',');
      if (/gl_FragColor|pc_fragColor|out highp vec4/.test(text)) names.set(sh, nm + (own ? ' {' + own + '}' : '') + ' #' + Math.round(text.length / 1024) + 'k');
      return srcP.call(this, sh, text);
    };
    P2.attachShader = function (pr, sh) { if (names.has(sh)) pr.__name = names.get(sh); return attP.call(this, pr, sh); };
    WebGL2RenderingContext.prototype.linkProgram = function (pr) { pr.__oe = { id: ++seq, t: performance.now() }; return linkP.call(this, pr); };
    WebGL2RenderingContext.prototype.getProgramInfoLog = function (pr) {
      const t0 = performance.now(), r = logP.call(this, pr), dt = performance.now() - t0;
      if (dt < 1) window.__drawing = null; // (only a draw's own wait is labelled with it)
      if (gl.on && pr.__oe && !pr.__oe.checked) { pr.__oe.checked = true; gl.waits.push({ prog: pr, name: (pr.__name || '?') + (window.__drawing ? ' @ ' + window.__drawing : ''), t: t0, ms: +dt.toFixed(1), sinceLink: +(t0 - pr.__oe.t).toFixed(0), from: (new Error().stack || '').split('\n').filter(l => /https?:/.test(l) && !/vendor|start_profile|__puppeteer|<anonymous>/.test(l)).slice(0, 4).map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/(web\/)?/, '')).join(' < ') }); }
      return r;
    };
    for (const P of [WebGL2RenderingContext.prototype]) {
      for (const n of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'useProgram',
        'texImage2D', 'texSubImage2D', 'texImage3D', 'texStorage2D', 'compressedTexImage2D', 'generateMipmap', 'bufferData', 'bufferSubData', 'readPixels', 'getError', 'clientWaitSync', 'getBufferSubData', 'fenceSync', 'finish']) wrap(P, n);
    }
    // the loader's messages as they change (the build's steps, issue 327): [time, text]
    window.__steps = [];
    addEventListener('DOMContentLoaded', () => {
      const m = document.getElementById('g-load-msg');
      if (m) new MutationObserver(() => { const t = m.textContent, l = window.__steps[window.__steps.length - 1]; if (!l || l[1] !== t) window.__steps.push([performance.now(), t]); }).observe(m, { childList: true, characterData: true, subtree: true });
    });
    // the frames, from requestAnimationFrame, and the long tasks
    const fr = window.__frames = [];
    const tick = t => { fr.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, ms: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
    // (the object being drawn, by the names up its parents, and its material's: the draw a program's first use is in)
    if (on) addEventListener('three-ready', () => {
      const O = window.THREE.Object3D.prototype, path = o => { const n = []; for (let q = o; q && n.length < 4; q = q.parent) n.push(q.name || q.type); return n.join('<'); };
      const b = O.onBeforeRender, sh = O.onBeforeShadow;
      O.onBeforeRender = function (r, s, c, g, m) { window.__drawing = path(this) + ' / ' + (m && (m.name || m.type)); return b && b.apply(this, arguments); };
      if (sh) O.onBeforeShadow = function (r, o, c, sc, g, m) { window.__drawing = 'shadow ' + path(this) + ' / ' + (m && (m.name || m.type)); return sh.apply(this, arguments); };
    });
    // the attributes flagged for upload after the click (needsUpdate), with their sizes and how often
    window.__ups = new Map();
    // the renderer, to count its programs, textures and geometries
    addEventListener('three-ready', () => {
      const BA = window.THREE.BufferAttribute.prototype, d = Object.getOwnPropertyDescriptor(BA, 'needsUpdate');
      if (d && d.set) Object.defineProperty(BA, 'needsUpdate', { configurable: true, set(v) {
        if (v === true && window.__gl.on) { const u = window.__ups.get(this) || { n: 0, bytes: this.array.byteLength, ranges: 0 }; u.n++; u.bytes = this.array.byteLength; if (this.updateRanges && this.updateRanges.length) u.ranges++; window.__ups.set(this, u); }
        d.set.call(this, v);
      } });
      const R = window.THREE.WebGLRenderer;
      window.THREE.WebGLRenderer = function (...a) { const r = new R(...a); window.__renderer = r; return r; };
      window.THREE.WebGLRenderer.prototype = R.prototype;
    });
  }, !!(process.env.LOAD && process.env.PROFILE));
  const p = await ctx.newPage();
  // the loader's longest frames, each broken down: its GL work, and the functions it ran (self and inclusive)
  const loadProfile = async (cdp, top, sync) => {
    const { profile } = await cdp.send('Profiler.stop');
    const [glLog, waits] = await p.evaluate(() => [window.__gl.log.slice(), window.__gl.waits.map(w => ({ t: w.t, ms: w.ms, sinceLink: w.sinceLink, name: w.name, from: w.from }))]);
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const label = n => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${c.url.replace(/^.*\/web\//, '').replace(/^https?:\/\/[^/]+\//, '')}:${c.lineNumber + 1}`; };
    // (the profile's first sample is at the start the page's clock was read just after)
    const ts = []; let t = profile.startTime;
    for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i]; ts.push((t - profile.startTime) / 1000 + sync); }
    for (const f of top.slice(0, +(process.env.TOPN || 4))) {
      const a = f.t, z = f.t + f.dt, self = new Map(), incl = new Map(), gls = new Map();
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < a || ts[i] > z) continue;
        const dt = (profile.timeDeltas[i + 1] || 1000) / 1000, n = nodes.get(profile.samples[i]);
        self.set(label(n), (self.get(label(n)) || 0) + dt);
        const seen = new Set();
        for (let id = profile.samples[i]; id != null; id = parent.get(id)) {
          const q = nodes.get(id); if (!/\/web\/|localhost/.test(q.callFrame.url) || /vendor/.test(q.callFrame.url)) continue;
          const k = label(q); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + dt);
        }
      }
      for (const e of glLog) if (e.t >= a && e.t <= z) { const g = gls.get(e.name) || { n: 0, ms: 0 }; g.n++; g.ms += e.ms; gls.set(e.name, g); }
      const w = waits.filter(e => e.t >= a && e.t <= z);
      const best = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)}  ${k}`).join('\n');
      console.log(`\n${f.whole ? 'the build (decoded to built),' : 'frame of'} ${(f.dt / 1000).toFixed(1)} s at ${(a / 1000).toFixed(1)} s: GL ${[...gls.entries()].map(([k, g]) => `${k} ${g.n}x ${g.ms.toFixed(0)} ms`).join(', ') || 'none over 4 ms'}` +
        (w.length ? `; first-use waits ${w.length}, ${w.reduce((s, e) => s + e.ms, 0).toFixed(0)} ms` : ''));
      for (const e of glLog.filter(e => e.t >= a && e.t <= z && e.size && e.ms > 200)) console.log(`  ${e.name} ${e.size} ${Math.round(e.ms)} ms`);
      for (const e of w.filter(e => e.ms > +(process.env.WAIT_MS || 100)).sort((x, y) => y.ms - x.ms).slice(0, 40)) console.log(`  waited ${Math.round(e.ms)} ms on ${e.name} (linked ${e.sinceLink} ms before) <= ${e.from}`);
      console.log('  self (ms):\n' + best(self, f.whole ? 30 : 10));
      console.log('  inclusive, the app\'s (ms):\n' + best(incl, f.whole ? 40 : 14));
    }
  };
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  const t0 = Date.now();
  // (PROFILE=1: the profiler on before the page loads; its clock is put on the page's once the page has one)
  const lcdp = process.env.LOAD && process.env.PROFILE ? await ctx.newCDPSession(p) : null;
  if (lcdp) { await lcdp.send('Profiler.enable'); await lcdp.send('Profiler.setSamplingInterval', { interval: 1000 }); }
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'commit', timeout: 120000 });
  let lsync = null;
  if (lcdp) { await lcdp.send('Profiler.start'); lsync = await p.evaluate(() => performance.now()).catch(() => 0); }
  await p.waitForLoadState('domcontentloaded', { timeout: 120000 });
  await p.waitForFunction(() => window.__game && !document.querySelector('#g-title').hidden && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  const loadS = (Date.now() - t0) / 1000;
  // the loader's frames, from the first one to the loader gone: the longest, and the time they add up to
  {
    const lf = await p.evaluate(() => window.__frames.slice()), d = [];
    for (let i = 1; i < lf.length; i++) d.push({ t: lf[i - 1], dt: lf[i] - lf[i - 1] });
    const top = d.slice().sort((a, b) => b.dt - a.dt).slice(0, 8), over = d.filter(f => f.dt > 1000);
    console.log(`${city} ${w}x${h} loader: playable after ${loadS.toFixed(1)} s; longest frames (s): ${top.map(f => (f.dt / 1000).toFixed(1)).join(' ')}; ` +
      `${over.length} frames over 1 s, ${(over.reduce((s, f) => s + f.dt, 0) / 1000).toFixed(1)} s in them`);
    // the load's stages (telemetry.js: oe:fetched, decoded, built, frame), and the loader's steps between
    // decoded and built, each with how long its message stood (issue 327); "first draw" is the loader's end
    const st = await p.evaluate(() => ({ marks: performance.getEntriesByType('mark').filter(m => /^oe:/.test(m.name)).map(m => [m.name.slice(3), m.startTime]),
      steps: window.__steps.slice(), now: performance.now() }));
    const mk = Object.fromEntries(st.marks);
    console.log('stages (s): ' + st.marks.map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', '));
    if (mk.decoded != null) {
      const end = mk.built ?? st.now, steps = st.steps.map((x, i) => [x[1], x[0], (st.steps[i + 1] || [st.now])[0]]).filter(x => x[2] > mk.decoded && x[1] < end);
      console.log(`build (decoded to built), ${((end - mk.decoded) / 1000).toFixed(1)} s, by the loader's step:`);
      for (const [msg, a, z] of steps) { const d = Math.min(z, end) - Math.max(a, mk.decoded); if (d >= 50) console.log(`  ${(d / 1000).toFixed(2).padStart(6)} s  ${msg.slice(0, 90)}`); }
    }
    if (lcdp) {
      // the whole load's blocking GL work, by call: what a change to the shaders or the uploads moves
      const calls = await p.evaluate(() => window.__gl.calls);
      const pick = ['getProgramInfoLog', 'getProgramParameter', 'linkProgram', 'compileShader', 'bufferData', 'texSubImage2D', 'texImage2D', 'texStorage2D', 'getBufferSubData', 'clientWaitSync'];
      console.log('GL in the load (calls, ms, the longest): ' + pick.filter(k => calls[k]).map(k => `${k} ${calls[k].n}x ${calls[k].ms.toFixed(0)} ms max ${calls[k].max.toFixed(0)}`).join('; '));
      await loadProfile(lcdp, (mk.decoded != null && mk.built != null ? [{ t: mk.decoded, dt: mk.built - mk.decoded, whole: true }] : []).concat(top), lsync);
    }
    if (process.env.LOAD) { await b.close(); return; } // LOAD=1: the loader only
  }
  await p.waitForTimeout(4000); // the title orbit settles
  const info = () => p.evaluate(() => {
    const r = window.__renderer;
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return r ? { programList: (r.info.programs || []).map(q => `${q.name}#${q.id}`), programs: r.info.programs ? r.info.programs.length : null, textures: r.info.memory.textures, geometries: r.info.memory.geometries, calls: r.info.render.calls, triangles: r.info.render.triangles, heapMB: mem } : null;
  });
  const before = await info();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const tClick = await p.evaluate(() => { window.__gl.on = true; window.__frames.length = 0; window.__long.length = 0; return performance.now(); });
  // the title's frames, for the baseline
  await p.waitForTimeout(2000);
  const base = await p.evaluate(() => window.__frames.slice());
  await cdp.send('Profiler.start');
  const [tPress, clickMs] = await p.evaluate(cont => { const t = performance.now(); document.querySelector(cont ? '#gt-continue' : '#gt-play').click(); return [t, performance.now() - t]; }, !!process.env.CONT);
  await p.waitForTimeout(+after * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const res = await p.evaluate(() => ({ nf: window.__frames.length, frames: window.__frames.slice(), long: window.__long.slice(), gl: window.__gl }));
  const waits = await p.evaluate(() => {
    const r = window.__renderer, byGl = new Map((r ? r.info.programs : []).map(q => [q.program, q]));
    return window.__gl.waits.map(w => { const q = byGl.get(w.prog); return { t: w.t, ms: w.ms, sinceLink: w.sinceLink, id: q ? q.id : null, name: q ? `${q.type || ''} ${q.name || ''}`.trim() : '(gone)' }; });
  });
  // the attributes uploaded most after the click (bytes flagged x times), and whose they are
  const ups = await p.evaluate(() => {
    const own = new Map(), g = window.__game;
    if (g) g.Wd.world.traverse(o => {
      const nm = o.name || (o.parent && o.parent.name) || o.type;
      if (o.instanceMatrix) own.set(o.instanceMatrix, `${nm}.instanceMatrix`);
      if (o.instanceColor) own.set(o.instanceColor, `${nm}.instanceColor`);
      if (o.geometry) for (const [k, a] of Object.entries(o.geometry.attributes)) if (!own.has(a)) own.set(a, `${nm}.${k}`);
    });
    return [...window.__ups.entries()].map(([a, u]) => ({ who: own.get(a) || '(not in the world)', n: u.n, kb: Math.round(u.bytes / 1024), total: Math.round(u.n * u.bytes / 1024), ranges: u.ranges }))
      .sort((x, y) => y.total - x.total).slice(0, 25);
  });
  const afterInfo = await info();
  // RAIN=1: then the rain on, a few frames, and the programs that took (the wet street's reflection, mirror.js)
  let rainProgs = null;
  if (process.env.RAIN) rainProgs = await p.evaluate(async () => {
    const r = window.__renderer, g = window.__game, ids = new Set(r.info.programs.map(q => q.id)), t0 = performance.now();
    g.weather.set('rain', { now: true });
    await new Promise(res => { let k = 0; const f = () => (++k >= 6 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    return { ms: Math.round(performance.now() - t0), mirror: !!(g.mirror && g.mirror.on), fresh: r.info.programs.filter(q => !ids.has(q.id)).map(q => `${q.type || ''} ${q.name || ''}`.trim()) };
  });
  // each program compiled after the title was up: its material type, the objects that use it, and how its
  // parameters differ from the nearest program of the same type compiled before (a light count, a define)
  const why = await p.evaluate(oldIds => {
    const r = window.__renderer, g = window.__game, out = [];
    if (!r || !g) return out;
    const progs = r.info.programs || [], old = progs.filter(q => oldIds.includes(q.id)), users = new Map();
    const scenes = [g.Wd.world];
    for (const sc of scenes) sc.traverse(o => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        const pr = r.properties.get(m), prog = pr && pr.currentProgram;
        if (!prog) continue;
        const chain = []; for (let q = o; q && chain.length < 4; q = q.parent) chain.push(q.name || q.type);
        const l = users.get(prog.id) || []; if (l.length < 3) l.push(`${chain.join('<')}${o.visible ? '' : ' (hidden)'}`); users.set(prog.id, l);
      }
    });
    for (const q of progs) {
      if (oldIds.includes(q.id)) continue;
      const keys = (q.cacheKey || '').split(','), same = old.filter(o => o.type === q.type || o.name === q.name);
      let best = null, bestN = 1e9;
      for (const o of same) { const k = (o.cacheKey || '').split(','); let n = 0; for (let i = 0; i < Math.max(k.length, keys.length); i++) if (k[i] !== keys[i]) n++; if (n < bestN) { bestN = n; best = k; } }
      const diff = best ? keys.map((v, i) => (v !== best[i] ? `${i}:${String(best[i]).slice(0, 24)}→${String(v).slice(0, 24)}` : null)).filter(Boolean).slice(0, 6) : ['(no program of this type before)'];
      out.push({ id: q.id, name: q.name, type: q.type || '', users: users.get(q.id) || [], diff });
    }
    return out;
  }, before ? before.programList.map(s => +s.split('#').pop()) : []);
  await b.close();

  // frames
  const dts = (fs_, from, to) => { const o = []; for (let i = 1; i < fs_.length; i++) if (fs_[i] >= from && fs_[i] <= to) o.push({ t: fs_[i], dt: fs_[i] - fs_[i - 1] }); return o; };
  const stats = arr => {
    const d = arr.map(f => f.dt).sort((a, b) => a - b), q = k => d[Math.min(d.length - 1, Math.floor(k * d.length))] || 0;
    return { n: d.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(d[d.length - 1] || 0).toFixed(1), over50: d.filter(x => x > 50).length, over100: d.filter(x => x > 100).length, sumOver50: Math.round(d.filter(x => x > 50).reduce((s, x) => s + x, 0)) };
  };
  console.log(`frames recorded: ${base.length} on the title, ${res.nf} after; first ${base[0]} click ${tClick} press ${tPress}`);
  const baseF = dts(base, tClick, tPress), postF = dts(res.frames, tPress, tPress + +after * 1000);
  const first = dts(res.frames, tPress, tPress + 3000);
  console.log(`${city} ${w}x${h} tier ${process.env.TIER || 'high'}: loaded in ${loadS.toFixed(0)} s`);
  console.log(`title (2 s before):  ${JSON.stringify(stats(baseF))}`);
  console.log(`after the click (${after} s): ${JSON.stringify(stats(postF))}`);
  console.log(`first 3 s:            ${JSON.stringify(stats(first))}`);
  console.log(`click handler: ${clickMs.toFixed(0)} ms`);
  const worst = postF.slice().sort((a, b) => b.dt - a.dt).slice(0, 12);
  console.log('worst frames (ms after the click, length):', worst.map(f => `${Math.round(f.t - f.dt - tPress)}+${Math.round(f.dt)}`).join(' '));
  console.log('long tasks after the click:', res.long.filter(l => l.t >= tPress).map(l => `${Math.round(l.t - tPress)}+${Math.round(l.ms)}`).join(' '));
  // GL work after the click
  const glAfter = res.gl.log.filter(e => e.t >= tPress);
  console.log('GL calls (whole window from 2 s before the click):');
  for (const [k, v] of Object.entries(res.gl.calls).sort((a, b) => b[1].ms - a[1].ms)) console.log(`  ${k.padEnd(22)} ${String(v.n).padStart(6)} calls ${v.ms.toFixed(0).padStart(6)} ms  max ${v.max.toFixed(0)} ms${v.bytes ? `  ${(v.bytes / 1048576).toFixed(1)} MB, the largest ${(v.maxBytes / 1024).toFixed(0)} kB` : ''}`);
  console.log(`GL calls over 4 ms after the click: ${glAfter.length}, ${glAfter.reduce((s, e) => s + e.ms, 0).toFixed(0)} ms:`, glAfter.slice(0, 30).map(e => `${Math.round(e.t - tPress)} ${e.name} ${e.ms}${e.kb ? ` (${e.kb} kB)` : ''}`).join(', '));
  const newProgs = afterInfo && before ? afterInfo.programList.filter(q => !before.programList.includes(q)) : [];
  if (before) delete before.programList;
  if (afterInfo) delete afterInfo.programList;
  const firstUse = waits.filter(w => w.t >= tPress);
  console.log(`programs first used after the click (${firstUse.length}): the wait at first use (a long one was compiled on that frame) and how long after its link:`);
  for (const w of firstUse) console.log(`  ${String(Math.round(w.t - tPress)).padStart(6)} ms  #${w.id} ${w.name}: waited ${w.ms} ms, linked ${w.sinceLink} ms before`);
  console.log(`attributes flagged for upload after the click, by bytes (times x size; "ranged": uploads limited to a range):`);
  for (const u of ups) console.log(`  ${String(u.total).padStart(8)} kB  ${u.n} x ${u.kb} kB${u.ranges ? ` (${u.ranges} ranged)` : ''}  ${u.who}`);
  if (rainProgs) console.log(`rain on: ${rainProgs.fresh.length} programs compiled in its first 6 frames (${rainProgs.ms} ms; the mirror ${rainProgs.mirror ? 'on' : 'off'}): ${rainProgs.fresh.slice(0, 12).join(', ')}`);
  console.log('renderer before:', JSON.stringify(before));
  console.log('renderer after: ', JSON.stringify(afterInfo));
  console.log(`programs compiled after the title was up (${newProgs.length}):`);
  for (const q of why) console.log(`  #${q.id} ${q.type} ${q.name || ''} | ${q.users.join('; ') || '(no object in the world: a pass or a removed object)'} | ${q.diff.join(' ')}`);

  // the CPU profile: self time by function, over the whole window and in the frames over 50 ms
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const label = n => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${c.url.replace(/^.*\/web\//, '')}:${c.lineNumber + 1}`; };
  const slow = postF.filter(f => f.dt > 50).map(f => [f.t - f.dt, f.t]);
  // profile timestamps are in microseconds on the same clock as performance.now() plus an offset: align on the start
  const startUs = profile.startTime, offsetMs = tPress - 0; // the profiler started a moment before the click
  const self = new Map(), selfSlow = new Map();
  let t = profile.startTime;
  const toPerf = us => (us - startUs) / 1000 + tPress - 5; // (about: the profiler starts ~5 ms before the press)
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    const n = nodes.get(profile.samples[i]), k = label(n), dt = (profile.timeDeltas[i + 1] || 500) / 1000;
    self.set(k, (self.get(k) || 0) + dt);
    const tp = toPerf(t);
    if (slow.some(([a, z]) => tp >= a && tp <= z)) selfSlow.set(k, (selfSlow.get(k) || 0) + dt);
  }
  // and inclusive time for the app's own functions (the frame's big callers)
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] || 500) / 1000, seen = new Set();
    for (let id = profile.samples[i]; id != null; id = parent.get(id)) {
      const n = nodes.get(id);
      if (!/\/web\//.test(n.callFrame.url)) continue;
      const k = label(n);
      if (seen.has(k)) continue;
      seen.add(k); incl.set(k, (incl.get(k) || 0) + dt);
    }
  }
  const top = (m, n = 25) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(`\nself time, all ${after} s after the click (ms):`);
  for (const [k, v] of top(self)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
  console.log('\nself time in the frames over 50 ms (ms):');
  for (const [k, v] of top(selfSlow)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
  console.log('\ninclusive time, the app\'s functions (ms):');
  for (const [k, v] of top(incl, 40)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
  if (errors.length) console.log('page errors:', errors);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ city, size, before, after: afterInfo, base: stats(baseF), post: stats(postF), worst, gl: res.gl.calls, glAfter, self: top(self, 80), selfSlow: top(selfSlow, 80), incl: top(incl, 80) }, null, 1));
  void offsetMs;
})();
