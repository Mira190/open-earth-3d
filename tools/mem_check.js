// What a city's game holds in memory on a phone, at its peak: the page's JavaScript heap (the page and its
// Workers), the GPU memory WebGL was asked for (every texture, buffer and renderbuffer, summed per object as
// it is uploaded, resized and deleted, and the canvas's own buffers), and the renderer process's resident
// memory as the operating system counts it. An iPhone kills a tab's WebContent process that grows past
// about 1-1.5 GB (less on older phones) and Safari then shows "A problem repeatedly occurred"; the budget
// here keeps every live city well under that on the low tier a phone gets (quality.js).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/mem_check.js shibuya [more cities...]
// It opens #play-<city> as an iPhone (390 x 844 CSS pixels at 3x, touch, the phone's user agent) on the
// low tier, plays (the NPCs, the helicopter, the cars' and trees' near models all loaded, as a player
// walking round would have them), then reads the peak. Prints one line per city and the largest
// textures and buffers; exits 1 when a city goes over its budget:
//   MEM_GPU   GPU memory, MB (default 400)
//   MEM_HEAP  JS heap of the page and its Workers, MB (default 300)
// TIER=low|medium|high (default low). JSON=1 prints the result as JSON. TOP=n lists n largest (default 8).
const { chromium } = require('playwright');
const fs = require('fs');
const cities = process.argv.slice(2).length ? process.argv.slice(2) : ['shibuya'];
const GPU_MB = +(process.env.MEM_GPU || 400), HEAP_MB = +(process.env.MEM_HEAP || 300), TOP = +(process.env.TOP || 8);
const MB = v => (v / 1048576).toFixed(0);

// Chromium's processes (one browser at a time runs here), with each one's proportional set size (its own pages
// and its share of shared ones)
function procs() {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (!/chrom/i.test(cmd.split('\0')[0])) continue;
      const type = (/--type=([\w-]+)/.exec(cmd) || [])[1] || 'browser';
      const pss = +(/^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${d}/smaps_rollup`, 'utf8')) || [])[1] * 1024 || 0;
      out.push({ pid: +d, type, pss });
    } catch (e) { /* gone */ }
  }
  return out;
}

async function measure(b, city) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  await ctx.addInitScript(() => {
    // bytes per texel of the uncompressed internal formats (as tools/tex_mem.js); a buffer's own bytes; a renderbuffer's samples
    const BPP = { 0x8058: 4, 0x8C43: 4, 0x1908: 4, 0x8051: 3, 0x8C41: 3, 0x1907: 3, 0x8229: 1, 0x1909: 1, 0x1903: 1, 0x822B: 2,
      0x881A: 8, 0x8814: 16, 0x822F: 4, 0x822E: 4, 0x8230: 8, 0x822D: 2, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8C3A: 4, 0x8C3D: 4,
      0x81A5: 2, 0x81A6: 3, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x1902: 4, 0x8D9F: 4, 0x8F94: 4, 0x8059: 4, 0x8236: 4, 0x8235: 4, 0x8234: 2, 0x8233: 1,
      0x8232: 1, 0x8231: 1, 0x823C: 8, 0x823B: 4, 0x823A: 4, 0x8239: 2, 0x8238: 2, 0x8237: 2, 0x8D70: 16, 0x8D76: 16, 0x8D7C: 4, 0x8D82: 16, 0x8D88: 16, 0x8D8E: 4 };
    const M = window.__mem = { tex: new Map(), buf: new Map(), rb: new Map(), peak: 0, peakAt: '', sum: 0 };
    const total = () => { let s = 0; for (const m of [M.tex, M.buf, M.rb]) for (const e of m.values()) s += e.bytes; return s; };
    const bump = () => { M.sum = total(); if (M.sum > M.peak) { M.peak = M.sum; M.peakAt = (performance.now() / 1000).toFixed(1); } };
    const nameOf = a => { for (const x of a) if (x && (x.src || x.currentSrc)) return String(x.src || x.currentSrc).split('/').slice(-2).join('/'); return ''; };
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      const tex = new Map(), bufs = new Map();
      let unit = 0, rbBound = null;
      const o = {};
      for (const k of ['activeTexture', 'bindTexture', 'deleteTexture', 'texImage2D', 'texStorage2D', 'texImage3D', 'texStorage3D', 'compressedTexImage2D',
        'bindBuffer', 'bufferData', 'deleteBuffer', 'bindRenderbuffer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer']) o[k] = proto[k];
      if (!o.activeTexture) continue;
      proto.activeTexture = function (u) { unit = u; return o.activeTexture.call(this, u); };
      proto.bindTexture = function (t, x) { tex.set(`${unit}:${t}`, x); return o.bindTexture.call(this, t, x); };
      proto.deleteTexture = function (x) { M.tex.delete(x); bump(); return o.deleteTexture.call(this, x); };
      const put = (gl, target, level, bytes, label) => {
        const bindT = target >= 0x8515 && target <= 0x851A ? 0x8513 : target; // a cube's face: the cube map
        const x = tex.get(`${unit}:${bindT}`);
        if (!x) return;
        let e = M.tex.get(x);
        if (!e) M.tex.set(x, e = { levels: {}, bytes: 0, label: '' });
        e.levels[`${target}:${level}`] = bytes;
        if (label) e.label = label;
        e.bytes = Object.values(e.levels).reduce((a, b) => a + b, 0);
        bump();
      };
      proto.texImage2D = function (target, level, ifmt, ...r) {
        let w, h;
        if (r.length >= 6) { w = r[0]; h = r[1]; } else { const s = r[r.length - 1]; w = s.naturalWidth || s.videoWidth || s.width || s.displayWidth; h = s.naturalHeight || s.videoHeight || s.height || s.displayHeight; }
        put(this, target, level, w * h * (BPP[ifmt] || 4), level ? '' : `${w}x${h} ${nameOf(r)}`);
        return o.texImage2D.call(this, target, level, ifmt, ...r);
      };
      proto.texStorage2D = function (target, levels, ifmt, w, h) {
        let s = 0; for (let l = 0, a = w, c = h; l < levels; l++, a = Math.max(1, a >> 1), c = Math.max(1, c >> 1)) s += a * c * (BPP[ifmt] || 4);
        put(this, target, 0, s, `${w}x${h} storage`);
        return o.texStorage2D.call(this, target, levels, ifmt, w, h);
      };
      const sub = proto.texSubImage2D;
      proto.texSubImage2D = function (target, level, ...r) {
        const n = level ? '' : nameOf(r.slice(4));
        if (n) { const x = tex.get(`${unit}:${target >= 0x8515 && target <= 0x851A ? 0x8513 : target}`), e = x && M.tex.get(x); if (e && !/ \S+\.\w+$/.test(e.label)) e.label += ` ${n}`; }
        return sub.call(this, target, level, ...r);
      };
      if (o.texImage3D) proto.texImage3D = function (target, level, ifmt, w, h, d, ...r) { put(this, target, level, w * h * d * (BPP[ifmt] || 4), level ? '' : `${w}x${h}x${d} 3D`); return o.texImage3D.call(this, target, level, ifmt, w, h, d, ...r); };
      if (o.texStorage3D) proto.texStorage3D = function (target, levels, ifmt, w, h, d) { put(this, target, 0, w * h * d * (BPP[ifmt] || 4) * (levels > 1 ? 4 / 3 : 1), `${w}x${h}x${d} 3D storage`); return o.texStorage3D.call(this, target, levels, ifmt, w, h, d); };
      proto.compressedTexImage2D = function (target, level, ifmt, w, h, b, data) { put(this, target, level, data ? data.byteLength : 0, level ? '' : `${w}x${h} compressed`); return o.compressedTexImage2D.apply(this, arguments); };
      proto.bindBuffer = function (t, x) { bufs.set(t, x); return o.bindBuffer.call(this, t, x); };
      proto.bufferData = function (t, d) {
        const x = bufs.get(t);
        if (x) { M.buf.set(x, { bytes: typeof d === 'number' ? d : (d ? d.byteLength : 0), label: t === 0x8893 ? 'index' : 'vertex' }); bump(); }
        return o.bufferData.apply(this, arguments);
      };
      proto.deleteBuffer = function (x) { M.buf.delete(x); bump(); return o.deleteBuffer.call(this, x); };
      proto.bindRenderbuffer = function (t, x) { rbBound = x; return o.bindRenderbuffer.call(this, t, x); };
      proto.renderbufferStorage = function (t, f, w, h) { if (rbBound) { M.rb.set(rbBound, { bytes: w * h * (BPP[f] || 4), label: `${w}x${h} rb` }); bump(); } return o.renderbufferStorage.call(this, t, f, w, h); };
      if (o.renderbufferStorageMultisample) proto.renderbufferStorageMultisample = function (t, s, f, w, h) { if (rbBound) { M.rb.set(rbBound, { bytes: w * h * (BPP[f] || 4) * Math.max(1, s), label: `${w}x${h} rb x${s}` }); bump(); } return o.renderbufferStorageMultisample.call(this, t, s, f, w, h); };
      proto.deleteRenderbuffer = function (x) { M.rb.delete(x); bump(); return o.deleteRenderbuffer.call(this, x); };
    }
    // the largest of each kind now, and what the canvases' own buffers hold (colour, depth, at their size)
    window.__memReport = top => {
      const list = m => [...m.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top).map(e => `${(e.bytes / 1048576).toFixed(1)} MB ${e.label}`);
      const sum = m => [...m.values()].reduce((a, e) => a + e.bytes, 0);
      const canv = [...document.querySelectorAll('canvas')].reduce((a, c) => a + (c.__gl ? c.width * c.height * 8 * 2 : 0), 0);
      return { tex: sum(M.tex), buf: sum(M.buf), rb: sum(M.rb), now: M.sum, peak: M.peak, peakAt: M.peakAt, canvas: canv,
        topTex: list(M.tex), topBuf: list(M.buf), topRb: list(M.rb), nTex: M.tex.size, nBuf: M.buf.size };
    };
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { const r = get.call(this, type, opts); if (r && /webgl/.test(type)) this.__gl = true; return r; };
  });
  // TRACK=1: every array buffer of a megabyte or more the page makes, receives from a Worker or fetches, with where, kept
  // as a weak reference: those still alive at the end (after a collection), summed by where they came from
  if (process.env.TRACK) await ctx.addInitScript(() => {
    const live = window.__bufs = [], MIN = 1 << 20;
    const where = () => { const l = (new Error().stack || '').split('\n').slice(3).find(x => /localhost/.test(x) && !/vendor\/three/.test(x)); return l ? l.trim().replace(/^at /, '').replace(/https?:\/\/localhost:\d+\//g, '') : '?'; };
    const track = (b, why) => { const buf = b && (b.buffer || b); if (buf && buf.byteLength >= MIN) live.push({ r: new WeakRef(buf), n: buf.byteLength, why }); };
    // (only ArrayBuffer is wrapped: a Proxy on the typed-array constructors breaks three.js's type checks. A typed
    // array made straight from a length allocates its buffer in C++, so the big main-thread ones are read instead
    // from the scene by OWNERS; this catches what a Worker sends and what is fetched)
    const AB = window.ArrayBuffer;
    window.ArrayBuffer = new Proxy(AB, { construct(t, a, nt) { const r = Reflect.construct(t, a, nt === window.ArrayBuffer ? t : nt); if (r.byteLength >= MIN) track(r, `ArrayBuffer ${where()}`); return r; } });
    window.ArrayBuffer.prototype = AB.prototype;
    const ab = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function () { const u = this.url.split('/').slice(-2).join('/'); return ab.call(this).then(b => { track(b, `fetch ${u}`); return b; }); };
    const scan = (v, why, d = 0) => {
      if (!v || typeof v !== 'object' || d > 6) return;
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) { track(v, why); return; }
      for (const c of Array.isArray(v) ? v : Object.values(v)) scan(c, why, d + 1);
    };
    const W = window.Worker;
    window.Worker = new Proxy(W, { construct(t, a) { const w = new t(...a), u = String(a[0]).split('/').pop(); w.addEventListener('message', e => scan(e.data, `from worker ${u}`)); return w; } });
    window.__bufReport = () => {
      const by = {};
      for (const e of live) if (e.r.deref()) by[e.why] = (by[e.why] || 0) + e.n;
      return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1048576).toFixed(1)} ${k}`);
    };
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  // SAMPLE=1: where the live objects were allocated (the sampling heap profiler, from the start), by function and script line
  if (process.env.SAMPLE) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 }); }
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  p.on('crash', () => errors.push('the page crashed'));
  // the heap of the page and each of its Workers (CDP: Runtime.getHeapUsage on each target)
  const heaps = async () => {
    let s = 0;
    try { const u = await cdp.send('Runtime.getHeapUsage'); s += u.usedSize + (u.backingStorageSize || 0); } catch (e) { /* busy */ }
    for (const w of p.workers()) {
      try { s += await w.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0)); } catch (e) { /* gone */ }
    }
    return s;
  };
  let peakHeap = 0, peakRss = { renderer: 0, gpu: 0 }, stop = false;
  const sampler = (async () => {
    while (!stop) {
      peakHeap = Math.max(peakHeap, await heaps());
      const ps = procs();
      // the newest renderer is this page's (the context was made just now)
      const r = ps.filter(q => q.type === 'renderer').sort((a, b) => b.pid - a.pid)[0];
      const g = ps.filter(q => q.type === 'gpu-process').reduce((a, q) => a + q.pss, 0);
      if (r) peakRss.renderer = Math.max(peakRss.renderer, r.pss);
      peakRss.gpu = Math.max(peakRss.gpu, g);
      await new Promise(r => setTimeout(r, 400));
    }
  })();
  const t0 = Date.now();
  let ok = true;
  try {
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 400000 });
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    // what a player walking round meets: every NPC's character, the helicopter, the cars' and trees' near models
    await p.evaluate(async () => {
      const g = window.__game;
      if (g.npcsReady) await g.npcsReady();
      if (g.heli && g.heli.want) await g.heli.want();
      if (g.lateReady) await g.lateReady();
    });
    await p.waitForTimeout(+(process.env.SETTLE || 8) * 1000);
  } catch (e) { ok = false; errors.push(String(e).slice(0, 200)); }
  stop = true;
  await sampler;
  let smaps = null;
  try {
    const r = procs().filter(q => q.type === 'renderer').sort((a, b) => b.pid - a.pid)[0], by = {};
    let name = '';
    for (const line of fs.readFileSync(`/proc/${r.pid}/smaps`, 'utf8').split('\n')) {
      const m = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
      if (m) { name = (m[1] || '[anon]').replace(/\/.*\//, ''); continue; }
      const p = /^Pss:\s+(\d+)/.exec(line);
      if (p) by[name] = (by[name] || 0) + +p[1] * 1024;
    }
    smaps = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${MB(v)}`).join(', ');
  } catch (e) { /* gone */ }
  const r = await p.evaluate(top => window.__memReport(top), TOP).catch(() => null);
  try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) { /* */ }
  const heapEnd = await heaps();
  const split = await cdp.send('Runtime.getHeapUsage').catch(() => ({}));
  const tracked = process.env.TRACK ? await p.evaluate(() => window.__bufReport()).catch(e => [String(e)]) : null;
  let sampled = null;
  if (process.env.SAMPLE) {
    const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
    const by = {};
    const walk = (n, stack) => {
      const f = n.callFrame, here = f.url ? `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}` : f.functionName;
      const st = f.url && !/vendor\/three/.test(f.url) ? here : stack; // (the page's own line that asked, not three.js's)
      if (n.selfSize) by[st || here] = (by[st || here] || 0) + n.selfSize;
      for (const c of n.children) walk(c, st);
    };
    walk(profile.head, '');
    sampled = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${MB(v)} ${k}`);
  }
  // OWNERS=1: whose typed arrays the page holds: the scene's geometry by mesh, then what the game object reaches by key
  const owners = !process.env.OWNERS ? null : await p.evaluate(() => {
    const seen = new Set(), by = {}, add = (k, a) => { const b = a.buffer || a; if (seen.has(b)) return; seen.add(b); by[k] = (by[k] || 0) + b.byteLength; };
    const g = window.__game;
    g.Wd.world.traverse(o => {
      if (!o.geometry) return;
      const geo = o.geometry, k = `mesh ${o.name || o.type}${o.parent && o.parent.name ? ` < ${o.parent.name}` : ''}`;
      for (const n in geo.attributes) if (geo.attributes[n].array) add(k, geo.attributes[n].array);
      if (geo.index && geo.index.array) add(k, geo.index.array);
      if (o.instanceMatrix && o.instanceMatrix.array) add(k, o.instanceMatrix.array);
    });
    const walk = (v, k, d, vis) => {
      if (!v || typeof v !== 'object' || vis.has(v)) return;
      vis.add(v);
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) { add(k, v); return; }
      if (d > 6 || v.isObject3D || v.isMaterial || v.isTexture || v instanceof Node || v === window) return;
      try { for (const c of Array.isArray(v) ? v : Object.values(v)) walk(c, k, d + 1, vis); } catch (e) { /* getter */ }
    };
    for (const k of Object.keys(g)) { try { walk(g[k], `game.${k}`, 0, new Set()); } catch (e) { /* getter */ } }
    for (const k of Object.keys(window)) if (/^OE|^__/.test(k) && k !== '__game' && k !== '__mem') { try { walk(window[k], k, 0, new Set()); } catch (e) { /* */ } }
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1048576).toFixed(1)} ${k}`);
  }).catch(e => [String(e)]);
  const pr = await p.evaluate(() => { const c = document.getElementById('game-gl'); return c ? { w: c.width, h: c.height } : null; }).catch(() => null);
  await ctx.close();
  return { city, ok, smaps, owners, heapEnd, split, sampled, tracked, s: (Date.now() - t0) / 1000, heap: peakHeap, rss: peakRss, gl: r, canvas: pr, errors };
}

(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--enable-precise-memory-info'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const out = [];
  let fail = false;
  for (const city of cities) {
    const m = await measure(b, city);
    out.push(m);
    const gpu = m.gl ? m.gl.peak : 0, heap = m.heapEnd || m.heap; // the heap once it has settled (a collection after the run)
    const over = [];
    if (!m.ok) over.push('did not load');
    if (gpu > GPU_MB * 1048576) over.push(`GPU ${MB(gpu)} MB over ${GPU_MB}`);
    if (heap > HEAP_MB * 1048576) over.push(`heap ${MB(heap)} MB over ${HEAP_MB}`);
    if (over.length) fail = true;
    if (process.env.JSON) continue;
    console.log(`${over.length ? 'FAIL' : 'ok  '} ${city}: GPU peak ${MB(gpu)} MB (textures ${m.gl ? MB(m.gl.tex) : '?'}, buffers ${m.gl ? MB(m.gl.buf) : '?'}, renderbuffers ${m.gl ? MB(m.gl.rb) : '?'} at the end; canvas ${m.canvas ? `${m.canvas.w}x${m.canvas.h}` : '?'}), JS heap peak ${MB(m.heap)} MB (${MB(m.heapEnd)} at the end after a collection: page objects ${MB(m.split.usedSize || 0)}, its array buffers ${MB(m.split.backingStorageSize || 0)}), renderer process ${MB(m.rss.renderer)} MB, GPU process ${MB(m.rss.gpu)} MB, ${m.s.toFixed(0)} s${over.length ? ` - ${over.join('; ')}` : ''}`);
    if (m.gl) {
      console.log(`     textures (${m.gl.nTex}): ${m.gl.topTex.join(', ')}`);
      console.log(`     buffers (${m.gl.nBuf}): ${m.gl.topBuf.join(', ')}`);
      if (m.owners) console.log(`     typed arrays (MB) by owner: ${m.owners.join(', ')}`);
      if (m.tracked) console.log(`     live array buffers (MB) by where they came from:\n       ${m.tracked.join('\n       ')}`);
      if (m.sampled) console.log(`     live objects (MB) by where they were made:\n       ${m.sampled.join('\n       ')}`);
      if (m.smaps) console.log(`     renderer memory by mapping: ${m.smaps}`);
      if (m.gl.topRb.length) console.log(`     renderbuffers: ${m.gl.topRb.join(', ')}`);
    }
    for (const e of m.errors.slice(0, 5)) console.log(`     error: ${e}`);
  }
  if (process.env.JSON) console.log(JSON.stringify(out, null, 1));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
