// The fragment shaders a city's game links while it loads, written out as text, the largest first, with
// how long each link took to complete (KHR_parallel_shader_compile's COMPLETION_STATUS polled every frame)
// and which material and object each is: to see what the lit shaders carry and measure what a change to
// them saves.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/shader_dump.js shibuya [out dir, /tmp/shaders] [how many to write, 6]
// Each file is the source as handed to WebGL (three.js's #includes resolved, its #ifdefs not), and
// <name>.pp.glsl the same after a simple preprocessor pass (the defines three.js puts in its prefix), so
// the size of what the driver really compiles can be compared.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'shibuya', out = '/tmp/shaders', keep = '6'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype, src = P.shaderSource, att = P.attachShader, link = P.linkProgram;
    const shaders = new WeakMap();
    window.__progs = [];
    P.shaderSource = function (sh, text) { shaders.set(sh, text); return src.call(this, sh, text); };
    P.attachShader = function (pr, sh) { const t = shaders.get(sh); if (t) { if (/gl_FragColor|pc_fragColor|out highp vec4/.test(t)) pr.__fs = t; else pr.__vs = t; } return att.call(this, pr, sh); };
    P.linkProgram = function (pr) { const r = link.call(this, pr); window.__progs.push({ pr, gl: this, t: performance.now(), done: 0 }); return r; };
    const poll = () => {
      for (const q of window.__progs) if (!q.done) {
        const ext = q.gl.__ext || (q.gl.__ext = q.gl.getExtension('KHR_parallel_shader_compile'));
        if (ext && q.gl.getProgramParameter(q.pr, ext.COMPLETION_STATUS_KHR)) q.done = performance.now();
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  const progs = await p.evaluate(() => window.__progs.filter(q => q.pr.__fs).map(q => ({ fs: q.pr.__fs, vs: q.pr.__vs, ms: q.done ? Math.round(q.done - q.t) : -1 })));
  await b.close();
  fs.mkdirSync(out, { recursive: true });
  const seen = new Map();
  for (const q of progs) { const s = seen.get(q.fs) || { fs: q.fs, vs: q.vs, n: 0, ms: [] }; s.n++; s.ms.push(q.ms); seen.set(q.fs, s); }
  const list = [...seen.values()].sort((a, b) => b.fs.length - a.fs.length);
  // a small preprocessor: #define / #ifdef / #ifndef / #if defined / #else / #elif / #endif, enough for three.js
  const pp = text => {
    const defs = new Map(), outL = [], stack = [];
    const live = () => stack.every(s => s.on);
    const evalIf = e => {
      e = e.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (defs.has(n) ? '1' : '0')).replace(/defined\s+(\w+)/g, (_, n) => (defs.has(n) ? '1' : '0'));
      e = e.replace(/\b[A-Za-z_]\w*\b/g, n => (defs.has(n) ? (defs.get(n) || '1') : '0'));
      try { return !!Function(`return (${e});`)(); } catch (x) { return true; }
    };
    for (const line of text.split('\n')) {
      const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
      if (m) {
        const [, d, rest] = m;
        if (d === 'ifdef') { stack.push({ on: defs.has(rest.trim()), was: defs.has(rest.trim()) }); continue; }
        if (d === 'ifndef') { stack.push({ on: !defs.has(rest.trim()), was: !defs.has(rest.trim()) }); continue; }
        if (d === 'if') { const v = evalIf(rest); stack.push({ on: v, was: v }); continue; }
        if (d === 'elif') { const s = stack[stack.length - 1]; s.on = !s.was && evalIf(rest); s.was = s.was || s.on; continue; }
        if (d === 'else') { const s = stack[stack.length - 1]; s.on = !s.was; s.was = true; continue; }
        if (d === 'endif') { stack.pop(); continue; }
        if (!live()) continue;
        if (d === 'define') { const [n, ...v] = rest.split(/\s+/); defs.set(n.replace(/\(.*$/, ''), v.join(' ')); }
        if (d === 'undef') defs.delete(rest.trim());
        outL.push(line); continue;
      }
      if (live() && line.trim() && !/^\s*\/\//.test(line)) outL.push(line);
    }
    return outL.join('\n');
  };
  console.log(`${city}: ${list.length} distinct fragment shaders, ${progs.length} programs`);
  list.forEach((s, i) => {
    const p2 = pp(s.fs);
    const type = (/#define SHADER_TYPE (\w+)/.exec(s.fs) || [])[1] || '', own = (/#define SHADER_NAME (.*)/.exec(s.fs) || [])[1] || '';
    const uni = [...new Set((p2.match(/uniform\s+\w+\s+u[A-Z]\w*/g) || []).map(u => u.split(/\s+/).pop()))];
    const name = `${type.replace('Mesh', '').replace('Material', '') || 'shader'}${own.trim() ? '_' + own.trim() : ''}`.replace(/\W+/g, '_') + (uni.length ? ' {' + uni.slice(0, 8).join(',') + '}' : '');
    if (i < +keep) { const f = `${out}/${i}_${name.split(' ')[0]}`; fs.writeFileSync(`${f}.glsl`, s.fs); fs.writeFileSync(`${f}.pp.glsl`, p2); if (s.vs) fs.writeFileSync(`${f}.vert.glsl`, s.vs); }
    if (i < 25) console.log(`${String(Math.round(s.fs.length / 1024)).padStart(4)} kB source, ${String(Math.round(p2.length / 1024)).padStart(4)} kB compiled  x${s.n}  link ${s.ms.join('/')} ms  ${name}`);
  });
})();
