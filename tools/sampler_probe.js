// Every shader program a map links, against the limits of the devices that play it, not of the machine that checks it.
// A program that asks for more texture units than a GPU has does not link there: three.js says so on the console only,
// every draw with it is refused (useProgram, INVALID_OPERATION) and whatever wore the material is missing from the
// picture, so the sky shows where the ground was (issue 485: an Apple M3 has 16 units in a fragment shader, Mesa's
// llvmpipe 32, and no check here saw it). This counts each linked program's samplers, in every state the game is put in.
//   [Q=weather=rain] [TIER=high] xvfb-run -a node tools/sampler_probe.js shibuya [morning|night|...]
// tools/check.sh gl runs it; exits 1 on a program over LIMIT (16: WebGL 2's floor and what Apple's and most phones' GPUs give).
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', time = ''] = process.argv;
const LIMIT = +(process.env.LIMIT || 16);
const wrap = () => {
  const P = WebGL2RenderingContext.prototype, link = P.linkProgram;
  window.__progs = [];
  P.linkProgram = function (prog) { const r = link.call(this, prog); window.__progs.push({ gl: this, prog }); return r; };
  window.__samplers = () => {
    const out = [];
    for (const o of window.__progs.splice(0)) {
      const gl = o.gl, p = o.prog;
      if (gl.isContextLost() || !gl.isProgram(p)) continue;
      const names = [];
      let n = 0;
      for (let i = 0, c = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < c; i++) {
        const u = gl.getActiveUniform(p, i);
        // (every sampler type's enum: 2D, 3D, cube, shadow, array, and the integer ones)
        if (u && [0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5, 0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7].includes(u.type)) { n += u.size; names.push(u.size > 1 ? `${u.name}x${u.size}` : u.name); }
      }
      const src = (gl.getAttachedShaders(p) || []).map(s => gl.getShaderSource(s) || '').join('\n');
      const type = /#define SHADER_TYPE (\w+)/.exec(src), name = /#define SHADER_NAME (\S*)/.exec(src);
      out.push({ n, linked: !!gl.getProgramParameter(p, gl.LINK_STATUS), type: type ? type[1] : '', name: name ? name[1] : '', names, max: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) });
    }
    return out;
  };
};
(async () => {
  const b = await chromium.launch(!process.env.DISPLAY ? { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1001, height: 894 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(wrap);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  let over = 0, top = 0, count = 0;
  const report = async label => {
    const r = await p.evaluate(() => window.__samplers());
    count += r.length;
    for (const x of r) {
      top = Math.max(top, x.n);
      if (x.n > LIMIT || !x.linked) { over++; console.log(`${label}: ${x.linked ? '' : 'NOT LINKED, '}${x.n} samplers (this machine has ${x.max}) in ${x.type} ${x.name}: ${x.names.join(' ')}`); }
    }
    console.log(`${label}: ${r.length} programs linked, the most samplers ${r.reduce((m, x) => Math.max(m, x.n), 0)}`);
  };
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?walk=1&overture=0${process.env.Q ? `&${process.env.Q}` : ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout: 600000, polling: 250 });
  await p.waitForTimeout(3000);
  await report('load and title');
  if (time) await p.evaluate(t => { const x = document.querySelector(`#gt-timechoice [data-t="${t}"]`); if (x) x.click(); }, time);
  await startPlay(p, { asIs: true });
  await p.waitForTimeout(8000);
  await report('playing');
  // the governor's rungs change what the materials are compiled with (the shadow's filter, the extras)
  for (const [sc, ex] of [[0.8, 0.5], [0.6, 0], [1, 1]]) {
    await p.evaluate(([s, e]) => window.__game.governor && window.__game.governor.set(s, e), [sc, ex]);
    await p.waitForTimeout(2500);
    await report(`scale ${sc}, extras ${ex}`);
  }
  // what the page did about them (glcare.js fit): the rungs taken, and whether every material ended with a program that links
  const fit = await p.evaluate(() => {
    const f = window.OEGLCare && OEGLCare.fit, gl = document.querySelector('#game-gl').getContext('webgl2');
    return f ? { level: f.level, failed: f.failed, plain: f.plain, without: f.ladder.slice(0, f.level), units: f.limit, real: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) } : null;
  });
  await b.close();
  console.log(`${count} programs, the most samplers in one ${top}, the limit ${LIMIT}; the page: ${JSON.stringify(fit)}`);
  // Without ?units the programs are counted as they are: over the limit fails. With Q=units=16 the page is a device
  // with sixteen: links fail as they would there, and it must end with everything drawn (no material left plain,
  // the ladder not run out); the rungs it took are printed, each a layer that device goes without.
  const emulated = /(^|&)units=\d+/.test(process.env.Q || '');
  const bad = emulated ? (!fit || fit.plain > 0 || fit.level >= 6) : over > 0;
  if (emulated && fit && fit.level) console.log(`a ${fit.units}-unit device goes without: ${fit.without.join(', ')}`);
  if (bad) { console.log('FAIL'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
