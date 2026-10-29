// Check the title screen on the devices and faults it has to survive, headless (SwiftShader):
// a tablet, a phone and a desktop; no half-float target, no WebGL 2, a context the GPU takes
// back (once while the textures load, twice later), and a driver that draws nothing. For each:
// the tier the page chose (quality.js) and why, its pixel ratio and graphics memory, whether it
// fell back to the still, and how much of the night pass is lit. Frames go to out_dir.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) node tools/title_check.js [out_dir] [scenario ...]
//   NODE_PATH=$(npm root -g) node tools/title_check.js --sweep    the opening's plan every half hour of a day
// A healthy run: every scenario shows the Earth or, where it cannot, the still (never black),
// and the night pass keeps about the same share of lit ground on every tier.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = `http://localhost:${process.env.PORT || 8800}/index.html#globe`;
const FLOAT = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend'];
const TABLET = { w: 820, h: 1180, dpr: 2, touch: true };
const SCENARIOS = {
  tablet: TABLET,
  phone: { w: 390, h: 844, dpr: 3, touch: true },
  desktop: { w: 1440, h: 900, dpr: 1, quality: 'high' },
  nofloat: Object.assign({ hideExt: FLOAT }, TABLET),
  nogl2: Object.assign({ noWebGL2: true }, TABLET),
  lostload: Object.assign({ loseAt: 600, restoreAfter: 1500, wait: 5000 }, TABLET),
  losttwice: Object.assign({ loseAt: 4000, restoreAfter: 1500, times: 2, wait: 9000 }, TABLET),
  black: Object.assign({ blackScreen: true }, TABLET),
};

// faults go in before the page runs: WebGL 2 missing, extensions hidden, the context lost and
// restored, draws to the screen dropped
function inject(c) {
  try { if (c.quality) localStorage.setItem('oe3d-quality', c.quality); else localStorage.removeItem('oe3d-quality'); } catch (e) { /* storage blocked */ }
  window.__titleManual = true;
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (c.noWebGL2 && type === 'webgl2') return null;
    const gl = get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    if (!gl || !/webgl/.test(type) || gl.__checked) return gl;
    gl.__checked = true;
    const hide = new Set(c.hideExt || []), ge = gl.getExtension.bind(gl), gs = gl.getSupportedExtensions.bind(gl);
    gl.getExtension = n => (hide.has(n) ? null : ge(n));
    gl.getSupportedExtensions = () => gs().filter(n => !hide.has(n));
    if (this.id !== 'globe-gl') return gl; // the quality probe's own context is let be
    if (c.loseAt) {
      const cycle = k => setTimeout(() => {
        const l = ge('WEBGL_lose_context');
        l.loseContext();
        if (c.restoreAfter) setTimeout(() => { l.restoreContext(); if (k + 1 < (c.times || 1)) cycle(k + 1); }, c.restoreAfter);
      }, k ? 2500 : c.loseAt);
      cycle(0);
    }
    if (c.blackScreen) for (const fn of ['drawArrays', 'drawElements']) { const o = gl[fn].bind(gl); gl[fn] = (...a) => (gl.getParameter(gl.FRAMEBUFFER_BINDING) ? o(...a) : undefined); }
    return gl;
  };
}

// the frame as drawn, at full size (a city light is a pixel or two): how much of it is lit, and
// how much of the ground in the lower part of the frame carries lights
function measure() {
  const c = document.getElementById('globe-gl'), P = window.__title.picture;
  const out = { mode: P.mode, why: P.why, auto: P.auto, pr: +P.stats.pixelRatio?.toFixed(2), gpuMB: P.stats.gpuMB, steps: P.stats.steps, still: document.querySelector('.title-app').classList.contains('fallback') };
  if (out.still) return out;
  const cv = document.createElement('canvas');
  cv.width = c.width; cv.height = c.height;
  const g = cv.getContext('2d');
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let lit = 0, ground = 0, lights = 0;
  for (let i = 0, n = d.length / 4; i < n; i++) {
    const l = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
    if (l > 0.08) lit++;
    if (i / cv.width > cv.height * 0.55) { ground++; if (l > 0.2) lights++; }
  }
  return Object.assign(out, { litPct: +(100 * lit / (d.length / 4)).toFixed(1), lightsPct: +(100 * lights / ground).toFixed(2) });
}

async function scenario(b, name, c, outDir) {
  const ctx = await b.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr, hasTouch: !!c.touch, isMobile: !!c.touch });
  await ctx.addInitScript(inject, c);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(URL, { timeout: 120000 });
  await p.waitForFunction(() => window.__title && ['gate', 'menu'].includes(window.__title.state), null, { timeout: 300000 });
  if (c.wait) await p.waitForTimeout(c.wait);
  const T = await p.evaluate(() => window.__title.timing);
  const res = {};
  for (const [label, t] of [['night', 3.2], ['menu', T.PULL_A + T.PULL_D + 1.5]]) {
    // held frames: the fade-in, which integrates frame by frame, is set done first
    await p.evaluate(t => { const e = window.__title.earth; window.__title.hold(t); e.lens.uFade.value = 1; e.ready.value = 1; window.__title.still(t); }, t);
    res[label] = await p.evaluate(measure);
    await p.screenshot({ path: path.join(outDir, `${name}-${label}.jpg`), type: 'jpeg', quality: 80, timeout: 240000 });
  }
  console.log(name.padEnd(10), JSON.stringify(res), errors.length ? `errors: ${errors.join(' | ')}` : '');
  await ctx.close();
}

async function sweep(b) {
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(() => { window.__titleManual = true; });
  await p.goto(URL, { timeout: 120000 });
  await p.waitForFunction(() => window.__title && window.__title.state === 'gate', null, { timeout: 300000 });
  const rows = await p.evaluate(() => {
    const t0 = new Date().setUTCHours(0, 0, 0, 0), out = [];
    for (let k = 0; k < 48; k++) { const r = window.__title.plan(t0 + k * 1800e3); out.push({ h: k / 2, dawn: r.dawnScore, dusk: r.duskScore, pick: r.dusk ? 'dusk' : 'dawn', below: r.nadir }); }
    return out;
  });
  const best = Math.max(...rows.map(r => Math.max(r.dawn, r.dusk)));
  let darkDawn = 0, darkNow = 0;
  for (const r of rows) {
    const got = r.pick === 'dusk' ? r.dusk : r.dawn;
    if (r.dawn < 0.15 * best) darkDawn++;
    if (got < 0.15 * best) darkNow++;
    console.log(`${String(Math.floor(r.h)).padStart(2, '0')}:${r.h % 1 ? '30' : '00'} UTC  dawn ${r.dawn.toFixed(1).padStart(5)}  dusk ${r.dusk.toFixed(1).padStart(5)}  ${r.pick}  below ${r.below.lat.toFixed(0)}, ${r.below.lon.toFixed(0)}`);
  }
  console.log(`half hours with a dark night pass (lights under 15% of the day's best): ${darkDawn}/48 flying to dawn only, ${darkNow}/48 to dawn or dusk`);
}

(async () => {
  const args = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (args[0] === '--sweep') await sweep(b);
  else {
    const outDir = args[0] || 'title-check';
    fs.mkdirSync(outDir, { recursive: true });
    const names = args.length > 1 ? args.slice(1) : Object.keys(SCENARIOS);
    for (const n of names) await scenario(b, n, SCENARIOS[n], outDir);
  }
  await b.close();
})();
