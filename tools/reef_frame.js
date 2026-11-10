// What one frame of a reef or alpine site asks of the GPU, on the WebGPU backend the visitors get (issue 382).
// The page's WebGPU calls are wrapped from outside (nothing in web/reef/ knows of it): every render and compute
// pass of a frame is listed with who asked for it, the target it draws into (size, format, samples), its draws
// and triangles, the pixels its target holds per sample, and, where the adapter has timestamp-query, the GPU's
// time inside it. The totals follow, with the render targets and textures alive.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) xvfb-run -a node tools/reef_frame.js milford-sound [view] [high|medium|low] [frames]
// view: a shot from the site's city.json "shots", or "start" (the default: the page as a visitor gets it, every
// module, the player at the site's start). Env: W, H, DPR (default 1440 x 900 at 1), TIME (ISO; the shot's own
// or mid-morning), MODS, EXTRA (more query, e.g. "mirror=0"), VIEW (a JSON pose over the shot), GL=1 for the
// WebGL 2 backend (counts from the renderer's info only), JSON=file to write the passes, QUIET=1 for the totals.
// ABLATE=1 then hides each thing in the scene in turn (the scene's children, and a group's own children when it
// has few) and prints what the frame's passes cost without it: where the time goes by object, as the passes
// say where it goes by target.
// The lab's adapter is SwiftShader, a CPU: its times compare one pass with another and one build with another,
// and say nothing of an Apple or an Intel GPU. The counts (passes, pixels, bytes written, draws, triangles) are exact.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, site = 'whitsundays', view = 'start', tier = 'high', framesArg = '6'] = process.argv;
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cities', site, 'city.json'), 'utf8'));
const shot = view === 'start' ? {} : (cfg.shots || []).find(v => v.id === view);
if (!shot) { console.error(`no shot "${view}" in cities/${site}/city.json (${(cfg.shots || []).map(v => v.id).join(', ')})`); process.exit(2); }
const s = Object.assign({}, shot, JSON.parse(process.env.VIEW || '{}'));

// in the page, before any of its scripts: wrap the WebGPU entry points
function hook() {
  if (!navigator.gpu || !window.GPUDevice) return;
  const F = window.__gpuFrame = { on: false, passes: [], tex: new Map(), dev: null, qs: null, qn: 0, ts: false, adapter: '' };
  const BPP = { rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgba16float: 8, rgba32float: 16, r8unorm: 1, rg8unorm: 2, r16float: 2, rg16float: 4, r32float: 4, rg32float: 8,
    rg11b10ufloat: 4, rgb10a2unorm: 4, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4, 'depth32float-stencil8': 5, depth16unorm: 2 };
  const P = (cls, name, wrap) => { const o = cls.prototype[name]; if (o) cls.prototype[name] = wrap(o); };
  // who asked: the nodes and page files on the stack, nearest first (a pass node, the bloom, a reflector, the shadow, ripples.js ...)
  const who = () => {
    const out = [];
    for (const l of String(new Error().stack).split('\n').slice(3)) {
      const m = /at (?:async )?(?:new )?([\w$.]+) .*?\/([\w.-]+\.js)/.exec(l);
      if (!m) continue;
      const fn = m[1].replace(/^Object\./, ''), file = m[2];
      const k = /^three\./.test(file) ? (/^(\w*(Node|Pipeline|Shadow\w*|QuadMesh|PMREM\w*))\./.exec(fn) || [])[1] : `${file}:${fn}`;
      if (k && out[out.length - 1] !== k && !out.includes(k)) out.push(k);
    }
    return out.slice(0, 5).join(' < ');
  };
  P(GPUAdapter, 'requestDevice', o => async function (d = {}) {
    const want = new Set(d.requiredFeatures || []);
    if (this.features.has('timestamp-query')) { want.add('timestamp-query'); F.ts = true; }
    const dev = await o.call(this, Object.assign({}, d, { requiredFeatures: [...want] }));
    F.dev = dev; const i = this.info || {};
    F.adapter = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ');
    return dev;
  });
  P(GPUDevice, 'createTexture', o => function (d) {
    const t = o.call(this, d), sz = d.size, w = sz.width ?? sz[0], h = sz.height ?? sz[1] ?? 1, n = d.dimension === '3d' ? 1 : sz.depthOrArrayLayers ?? sz[2] ?? 1, depth = d.dimension === '3d' ? sz.depthOrArrayLayers ?? sz[2] ?? 1 : 1;
    const mips = d.mipLevelCount || 1, bpp = BPP[d.format] || 4;
    F.tex.set(t, { w, h, n, format: d.format, samples: d.sampleCount || 1, target: !!(d.usage & GPUTextureUsage.RENDER_ATTACHMENT), label: d.label || '',
      bytes: w * h * n * depth * bpp * (d.sampleCount || 1) * (mips > 1 ? 4 / 3 : 1) });
    return t;
  });
  P(GPUTexture, 'destroy', o => function () { F.tex.delete(this); return o.call(this); });
  P(GPUTexture, 'createView', o => function (d) { const v = o.call(this, d); v.__t = this; v.__mip = (d && d.baseMipLevel) || 0; return v; });
  P(GPUCanvasContext, 'getCurrentTexture', o => function () {
    const t = o.call(this); t.__canvas = true;
    if (!F.tex.has(t)) F.canvas = { w: t.width, h: t.height, format: t.format };
    return t;
  });
  const stamp = (d, rec) => {   // two timestamps a pass, where the page asks for none itself
    if (!F.ts || !F.on || d.timestampWrites || !F.dev) return d;
    if (!F.qs) F.qs = F.dev.createQuerySet({ type: 'timestamp', count: 2048 });
    if (F.qn + 2 > 2048) return d;
    rec.q = F.qn; F.qn += 2;
    return Object.assign({}, d, { timestampWrites: { querySet: F.qs, beginningOfPassWriteIndex: rec.q, endOfPassWriteIndex: rec.q + 1 } });
  };
  P(GPUCommandEncoder, 'beginRenderPass', o => function (d) {
    if (!F.on) return o.call(this, d);
    const at = (d.colorAttachments || []).filter(Boolean)[0] || d.depthStencilAttachment, v = at && at.view, t = v && v.__t, m = (t && F.tex.get(t)) || {}, mip = (v && v.__mip) || 0;
    const w = Math.max(1, (t ? t.width : 0) >> mip), h = Math.max(1, (t ? t.height : 0) >> mip), samples = (t && t.sampleCount) || 1;
    const fmts = (d.colorAttachments || []).filter(Boolean).map(a => a.view.__t ? a.view.__t.format : '?');
    const depth = d.depthStencilAttachment && d.depthStencilAttachment.view.__t ? d.depthStencilAttachment.view.__t.format : '';
    const bpp = fmts.reduce((a, f) => a + (BPP[f] || 4), 0) + (depth ? BPP[depth] || 4 : 0);
    const rec = { kind: 'render', who: who(), w, h, samples, color: fmts.join('+') || '-', depth, canvas: !!(t && t.__canvas) || (d.colorAttachments || []).some(a => a && a.resolveTarget && a.resolveTarget.__t && a.resolveTarget.__t.__canvas),
      draws: 0, tris: 0, px: w * h * samples, bytes: w * h * samples * bpp, label: d.label || m.label || '' };
    F.passes.push(rec);
    const p = o.call(this, stamp(d, rec)); p.__rec = rec; return p;
  });
  P(GPUCommandEncoder, 'beginComputePass', o => function (d = {}) {
    if (!F.on) return o.call(this, d);
    const rec = { kind: 'compute', who: who(), w: 0, h: 0, samples: 1, color: '-', depth: '', draws: 0, tris: 0, px: 0, bytes: 0, label: d.label || '' };
    F.passes.push(rec);
    const p = o.call(this, stamp(d, rec)); p.__rec = rec; return p;
  });
  const count = (vi, ii) => o => function (...a) { const r = this.__rec; if (r) { r.draws++; r.tris += Math.floor((a[vi] || 0) / 3) * (a[ii] ?? 1); } return o.apply(this, a); };
  P(GPURenderPassEncoder, 'draw', count(0, 1));
  P(GPURenderPassEncoder, 'drawIndexed', count(0, 1));
  for (const n of ['drawIndirect', 'drawIndexedIndirect']) P(GPURenderPassEncoder, n, o => function (...a) { const r = this.__rec; if (r) { r.draws++; r.indirect = true; } return o.apply(this, a); });
  P(GPUComputePassEncoder, 'dispatchWorkgroups', o => function (...a) { const r = this.__rec; if (r) r.draws++; return o.apply(this, a); });
  // the passes between two calls, with their times resolved
  F.begin = () => { F.passes = []; F.qn = 0; F.on = true; };
  F.end = async () => {
    F.on = false;
    const passes = F.passes;
    if (F.qs && F.qn) {
      const dev = F.dev, buf = dev.createBuffer({ size: F.qn * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const rd = dev.createBuffer({ size: F.qn * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = dev.createCommandEncoder();
      enc.resolveQuerySet(F.qs, 0, F.qn, buf, 0); enc.copyBufferToBuffer(buf, 0, rd, 0, F.qn * 8);
      dev.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const ns = new BigInt64Array(rd.getMappedRange().slice(0));
      rd.unmap(); buf.destroy(); rd.destroy();
      for (const p of passes) if (p.q != null) { const d = Number(ns[p.q + 1] - ns[p.q]); p.ms = d > 0 && d < 6e10 ? d / 1e6 : null; }
    }
    const tex = [...F.tex.values()];
    return { passes, adapter: F.adapter, ts: F.ts, canvas: F.canvas || null,
      targets: tex.filter(t => t.target), texBytes: tex.filter(t => !t.target).reduce((a, t) => a + t.bytes, 0), texN: tex.filter(t => !t.target).length };
  };
}

(async () => {
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader',
    '--enable-webgpu-developer-features', '--disable-gpu-watchdog'];   // (developer features: timestamps to the nanosecond, not rounded to 100 microseconds)
  const W = Number(process.env.W || 1440), H = Number(process.env.H || 900), mobile = !!process.env.MOBILE, gl = process.env.GL === '1';
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1), isMobile: mobile, hasTouch: mobile });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, tier);
  await p.addInitScript(hook);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  let time = process.env.TIME || (s.time && s.time !== 'night' ? s.time : '2026-11-06T01:30:00Z');
  if (s.month && !process.env.TIME) { const t = new Date(time); t.setUTCMonth(s.month - 1); time = t.toISOString(); }
  const pose = view === 'start' && !process.env.VIEW ? [] : ['x', 'y', 'z', 'yaw', 'pitch', 'fov'].filter(k => s[k] != null).map(k => `${k}=${s[k]}`);
  // a shot is the bare viewer at its pose (no player to take the camera); the start is the whole page
  const mods = process.env.MODS ?? s.mods ?? (view === 'start' ? null : cfg.kind === 'alpine' ? 'alpine/flora,alpine/landmarks,boats,alpine/fiord' : 'life,boats');
  const q = [gl ? 'gl=1' : '', 'freeze=5', 'mute=1', `city=${site}`, ...pose, `time=${time}`, mods != null ? `mods=${mods}` : '', process.env.EXTRA || ''].filter(Boolean).join('&');
  await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?${q}`);
  await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 900000 });
  const r = await p.evaluate(async ([n, ab]) => {
    const R = window.__reef.renderer, raf = () => new Promise(res => requestAnimationFrame(res)), F = window.__gpuFrame;
    for (let i = 0; i < 6; i++) await raf();           // let what streams in with the first frames settle
    const frames = [], dts = [];
    for (let i = 0; i < n; i++) {
      await raf();                                     // (this callback runs after the page's own: its frame is drawn)
      if (F) F.begin();
      const t0 = performance.now();
      await raf();
      dts.push(performance.now() - t0);
      const info = { tris: R.info.render.triangles, calls: R.info.render.drawCalls ?? R.info.render.calls };
      frames.push(Object.assign(F ? await F.end() : { passes: [] }, { info }));
    }
    dts.sort((a, b) => a - b);
    const px = [R.domElement.width, R.domElement.height];
    // what each thing costs: the frame's time in passes with it hidden, against the frame as it is (measured again here)
    const ablate = [];
    if (ab && F && F.ts) {
      const one = async () => { await raf(); F.begin(); await raf(); const f = await F.end(); return { ms: f.passes.reduce((a, x) => a + (x.ms || 0), 0), draws: f.passes.reduce((a, x) => a + x.draws, 0), tris: f.passes.reduce((a, x) => a + x.tris, 0) }; };
      const scene = window.__reef.ctx.scene, list = [];
      const nameOf = o => o.name || (o.material && (o.material.name || o.material.type)) || o.type;
      // (things that share a name up to a colon are one thing: an alpine plant's sectors, "tussock:3")
      const add = (name, o) => { const k = name.split(':')[0], e = list.find(v => v[0] === k); if (e) e[1].push(o); else list.push([k, [o]]); };
      for (const o of scene.children) {
        if (!o.visible || o.isLight || (!o.isMesh && !o.children.length)) continue;
        if (!o.isMesh && o.children.length > 1 && o.children.length <= 6) for (const c of o.children) { if (c.visible) add(`${nameOf(o)}/${nameOf(c)}`, c); }
        else add(nameOf(o), o);
      }
      const base = await one();
      ablate.push(Object.assign({ name: '(everything)' }, base));
      for (const [name, os] of list) { for (const o of os) o.visible = false; const r = await one(); for (const o of os) o.visible = true; ablate.push({ name, ms: base.ms - r.ms, draws: base.draws - r.draws, tris: base.tris - r.tris }); }
    }
    return { frames, ablate, ms: dts[Math.floor(dts.length / 2)], backend: R.backend && R.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2', tier: window.__reef.tier && window.__reef.tier.name, pr: R.getPixelRatio(), px,
      gov: window.__reef.governor ? { scale: window.__reef.governor.scale, extras: window.__reef.governor.extras } : null, err: document.getElementById('err').textContent.slice(0, 300) };
  }, [Number(framesArg), !!process.env.ABLATE]);
  await b.close();

  // the frame reported: the one with the median GPU time; each pass's time the median over the frames that have the same list
  const tot = f => f.passes.reduce((a, x) => a + (x.ms || 0), 0);
  const order = r.frames.slice().sort((a, c) => tot(a) - tot(c)), f = order[Math.floor(order.length / 2)];
  const same = r.frames.filter(g => g.passes.length === f.passes.length);
  f.passes.forEach((x, i) => { const v = same.map(g => g.passes[i].ms).filter(m => m != null).sort((a, c) => a - c); x.ms = v.length ? v[Math.floor(v.length / 2)] : null; });
  const M = n => (n / 1e6).toFixed(2), sum = k => f.passes.reduce((a, x) => a + (x[k] || 0), 0);
  const full = r.px[0] * r.px[1];
  const head = `${site} ${view} ${W}x${H}@${process.env.DPR || 1} ${tier}`;
  if (!process.env.QUIET) {
    console.log(`${head}: ${r.backend}${f.adapter ? ` (${f.adapter})` : ''}, canvas ${r.px[0]}x${r.px[1]}, pixel ratio ${r.pr}${r.gov ? `, governor ${r.gov.scale.toFixed(2)}/${r.gov.extras}` : ''}${f.ts ? '' : ', no timestamp-query'}`);
    console.log('  #  kind     target                         x  draws   tris(M)  px(M)  write(MB)  gpu ms  who');
    f.passes.forEach((x, i) => console.log(`  ${String(i).padStart(2)} ${x.kind.padEnd(8)} ${(x.kind === 'compute' ? '' : `${x.w}x${x.h} ${x.color}${x.depth ? '+' + x.depth : ''}${x.canvas ? ' (canvas)' : ''}`).padEnd(30).slice(0, 30)} ${String(x.samples).padStart(1)} ${String(x.draws).padStart(6)} ${M(x.tris).padStart(9)} ${M(x.px).padStart(6)} ${(x.bytes / 1048576).toFixed(1).padStart(10)} ${(x.ms == null ? '-' : x.ms.toFixed(1)).padStart(7)}  ${x.who}`));
    const tg = f.targets.slice().sort((a, c) => c.bytes - a.bytes);
    console.log(`  render targets alive: ${tg.length}, ${(tg.reduce((a, t) => a + t.bytes, 0) / 1048576).toFixed(0)} MB (largest: ${tg.slice(0, 6).map(t => `${t.w}x${t.h}${t.n > 1 ? 'x' + t.n : ''} ${t.format}${t.samples > 1 ? ' x' + t.samples : ''}`).join(', ')}); textures: ${f.texN}, ${(f.texBytes / 1048576).toFixed(0)} MB`);
  }
  const big = f.passes.filter(x => x.kind === 'render' && x.w * x.h >= full * 0.2);
  const line = { site, view, tier, w: W, h: H, backend: r.backend, passes: f.passes.length, full_passes: big.length, draws: f.passes.length ? sum('draws') : f.info.calls, tris: f.passes.length ? sum('tris') : f.info.tris,
    px: sum('px'), bytes: sum('bytes'), gpu_ms: f.ts ? tot(f) : null, frame_ms: r.ms, canvas_px: full, gov: r.gov };
  console.log(`${head}: ${line.passes} passes (${line.full_passes} at a fifth of the canvas or more), ${line.draws} draws, ${M(line.tris)} M triangles, ${M(line.px)} M pixels in targets, ${(line.bytes / 1048576).toFixed(0)} MB written`
    + `${line.gpu_ms != null ? `, GPU ${line.gpu_ms.toFixed(0)} ms in passes` : ''}, frame ${r.ms.toFixed(0)} ms ${r.err || errs[0] || ''}`);
  if (r.ablate.length) {
    console.log('  what the passes cost with each thing hidden (GPU ms saved, draws, triangles):');
    for (const a of r.ablate.slice(0, 1).concat(r.ablate.slice(1).sort((x, y) => y.ms - x.ms))) console.log(`    ${a.name.padEnd(34).slice(0, 34)} ${a.ms.toFixed(0).padStart(7)} ms ${String(a.draws).padStart(5)} ${M(a.tris).padStart(6)} M`);
  }
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(Object.assign(line, { passes_list: f.passes, targets: f.targets }), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
