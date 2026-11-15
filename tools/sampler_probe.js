// How many texture units each shader program of a map's game uses, against the fewest a device may offer.
// WebGL2 promises 16 units to a fragment shader (MAX_TEXTURE_IMAGE_UNITS) and Apple's GPUs give exactly
// that; a software renderer gives 32 or more, so a program with 17 samplers links in every check and
// fails to link on a Mac or an iPhone, where what it was to draw is then missing and the sky shows in its
// place (issue 485). Counted at each linkProgram, from the context's first call: the active sampler
// uniforms, an array counted by its length.
//   [LIMIT=16] [START=0.8/0] [Q=msaa=on] [TIER=high] xvfb-run -a node tools/sampler_probe.js shibuya [morning|night|...]
// Exits 1 when a program uses more than LIMIT units.
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', time = ''] = process.argv;
const LIMIT = +(process.env.LIMIT || 16);
const wrap = () => {
  const P = WebGL2RenderingContext.prototype, link = P.linkProgram, src = P.shaderSource, attach = P.attachShader;
  const names = new WeakMap(), progName = new WeakMap(), progs = [];
  window.__samplers = { progs, limits: null };
  P.shaderSource = function (sh, s) { const m = /#define SHADER_NAME (\S+)/.exec(s); names.set(sh, { name: m ? m[1] : '?', defs: (s.match(/#define USE_[A-Z0-9_]+/g) || []).map(x => x.slice(12)) }); return src.call(this, sh, s); };
  P.attachShader = function (pr, sh) { if (this.getShaderParameter(sh, this.COMPILE_STATUS) !== undefined && this.getShaderParameter(sh, this.SHADER_TYPE) === this.FRAGMENT_SHADER) progName.set(pr, names.get(sh)); return attach.call(this, pr, sh); };
  P.linkProgram = function (pr) {
    link.call(this, pr);
    const S = window.__samplers;
    if (!S.limits) S.limits = { frag: this.getParameter(this.MAX_TEXTURE_IMAGE_UNITS), vert: this.getParameter(this.MAX_VERTEX_TEXTURE_IMAGE_UNITS), all: this.getParameter(this.MAX_COMBINED_TEXTURE_IMAGE_UNITS) };
    const rec = { pr, gl: this, info: progName.get(pr) || { name: '?', defs: [] } };
    progs.push(rec);
  };
  // counted when asked, not at the link: three.js links in parallel (KHR_parallel_shader_compile), and a count
  // asked for at once would make every link wait
  window.__samplers.count = () => progs.map(({ pr, gl, info }) => {
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { name: info.name, n: -1, list: [], defs: info.defs };
    const list = [];
    let n = 0;
    for (let i = 0, k = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); i < k; i++) {
      const u = gl.getActiveUniform(pr, i);
      if (!u) continue;
      const t = u.type;
      if (t === gl.SAMPLER_2D || t === gl.SAMPLER_CUBE || t === gl.SAMPLER_3D || t === gl.SAMPLER_2D_SHADOW || t === gl.SAMPLER_2D_ARRAY || t === gl.SAMPLER_2D_ARRAY_SHADOW || t === gl.SAMPLER_CUBE_SHADOW ||
        t === gl.INT_SAMPLER_2D || t === gl.UNSIGNED_INT_SAMPLER_2D || t === gl.INT_SAMPLER_3D || t === gl.UNSIGNED_INT_SAMPLER_3D || t === gl.INT_SAMPLER_2D_ARRAY || t === gl.UNSIGNED_INT_SAMPLER_2D_ARRAY) { n += u.size; list.push(u.size > 1 ? `${u.name.replace('[0]', '')}×${u.size}` : u.name); }
    }
    return { name: info.name, n, list, defs: info.defs };
  });
};
(async () => {
  const b = await chromium.launch(process.env.SWIFT || !process.env.DISPLAY ? { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1001, height: 894 }, deviceScaleFactor: 1 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(wrap);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  let bad = 0;
  const seen = new Set();
  const report = async label => {
    const r = await p.evaluate(() => ({ limits: window.__samplers.limits, progs: window.__samplers.count() }));
    const by = new Map();
    for (const o of r.progs) { const k = `${o.name}|${o.list.join(',')}`; if (!by.has(k)) by.set(k, o); }
    const rows = [...by.values()].sort((a, c) => c.n - a.n);
    console.log(`${label}: ${r.progs.length} programs linked, ${by.size} different; this renderer offers ${r.limits ? r.limits.frag : '?'} units to a fragment shader, the check holds them to ${LIMIT}`);
    for (const o of rows.slice(0, 8)) console.log(`  ${String(o.n).padStart(3)}  ${o.name}  ${o.list.join(' ')}`);
    for (const o of rows) if (o.n > LIMIT && !seen.has(`${o.name}|${o.list}`)) { seen.add(`${o.name}|${o.list}`); bad++; console.log(`FAIL ${o.name} uses ${o.n} texture units, over ${LIMIT}: ${o.list.join(' ')}`); }
  };
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?overture=0${process.env.START ? `&gov=${process.env.START}` : ''}${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout: 600000, polling: 250 });
  if (time) await p.evaluate(t => { const x = document.querySelector(`#gt-timechoice [data-t="${t}"]`); if (x) x.click(); }, time);
  await startPlay(p, { asIs: true });
  await p.waitForTimeout(8000);
  await report(`${city}${time ? ` ${time}` : ''}, playing`);
  for (const o of await p.evaluate(() => (window.OEQuality && OEQuality.fitUnits.log) || [])) console.log(`  fitted: ${JSON.stringify(o)}`);
  await b.close();
  console.log(bad ? `samplers: ${bad} programs over ${LIMIT} texture units` : `samplers ok: no program over ${LIMIT} texture units`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log(`FAIL ${e.message}`); process.exit(1); });
