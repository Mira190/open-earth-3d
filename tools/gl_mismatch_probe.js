// Which draws WebGL refuses, and why: after the map's overture (or without it, skip=-1), every draw call of a few
// frames is followed by getError; for one that failed, the program's sampler uniforms are listed with the texture
// bound to each one's unit (its compare mode, and whether one is bound at all). A sampler2DShadow on a texture
// without a compare mode, or a sampler2D on one with it, is "Mismatch between texture format and sampler type":
// the draw is dropped, and what it would have drawn (the ground, the walls) is not there.
//   [GOV=1] [SHOT=out.png] xvfb-run -a node tools/gl_mismatch_probe.js shibuya [skip seconds, -1: no overture] [now|morning|night|...]
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'shibuya', skip = '4', time = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype, seen = new Map();
    window.__glProbe = { on: false, seen, draws: 0, bad: 0 };
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const orig = P[fn];
      P[fn] = function (...a) {
        const pr = window.__glProbe;
        if (!pr.on) return orig.apply(this, a);
        while (this.getError()) { /* earlier errors */ }
        orig.apply(this, a);
        pr.draws++;
        if (!this.getError()) return;
        pr.bad++;
        const gl = this, prog = gl.getParameter(gl.CURRENT_PROGRAM), n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS), was = gl.getParameter(gl.ACTIVE_TEXTURE), out = [];
        const T = { [gl.SAMPLER_2D]: ['2D', gl.TEXTURE_BINDING_2D, gl.TEXTURE_2D], [gl.SAMPLER_2D_SHADOW]: ['2DShadow', gl.TEXTURE_BINDING_2D, gl.TEXTURE_2D], [gl.SAMPLER_CUBE]: ['cube', gl.TEXTURE_BINDING_CUBE_MAP, gl.TEXTURE_CUBE_MAP],
          [gl.SAMPLER_CUBE_SHADOW]: ['cubeShadow', gl.TEXTURE_BINDING_CUBE_MAP, gl.TEXTURE_CUBE_MAP], [gl.SAMPLER_2D_ARRAY]: ['2DArray', gl.TEXTURE_BINDING_2D_ARRAY, gl.TEXTURE_2D_ARRAY], [gl.SAMPLER_3D]: ['3D', gl.TEXTURE_BINDING_3D, gl.TEXTURE_3D],
          [gl.INT_SAMPLER_2D]: ['i2D', gl.TEXTURE_BINDING_2D, gl.TEXTURE_2D], [gl.UNSIGNED_INT_SAMPLER_2D]: ['u2D', gl.TEXTURE_BINDING_2D, gl.TEXTURE_2D], [gl.SAMPLER_2D_ARRAY_SHADOW]: ['2DArrayShadow', gl.TEXTURE_BINDING_2D_ARRAY, gl.TEXTURE_2D_ARRAY] };
        for (let i = 0; i < n; i++) {
          const u = gl.getActiveUniform(prog, i), t = T[u.type];
          if (!t) continue;
          for (let k = 0; k < u.size; k++) {
            const name = u.size > 1 ? u.name.replace('[0]', `[${k}]`) : u.name, loc = gl.getUniformLocation(prog, name);
            if (!loc) continue;
            const unit = gl.getUniform(prog, loc);
            gl.activeTexture(gl.TEXTURE0 + unit);
            const tex = gl.getParameter(t[1]), cmp = tex ? gl.getTexParameter(t[2], gl.TEXTURE_COMPARE_MODE) !== gl.NONE : null;
            const shadow = /Shadow/.test(t[0]);
            if (tex && shadow !== cmp) out.push(`${name}: ${t[0]} on a texture ${cmp ? 'with' : 'without'} a compare mode (unit ${unit})`);
          }
        }
        gl.activeTexture(was);
        const key = out.join('; ') || 'no sampler at fault found';
        const o = window.__glObj || {};
        const e = seen.get(key) || seen.set(key, { n: 0, who: new Set() }).get(key);
        e.n++; if (e.who.size < 12) e.who.add(`${o.name || o.type || '?'} / ${(o.material && (o.material.name || o.material.type)) || '?'}`);
      };
    }
  });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/?overture=${+skip >= 0 ? 1 : 0}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout: 600000, polling: 250 });
  if (time) await p.evaluate(t => { const x = document.querySelector(`#gt-timechoice [data-t="${t}"]`); if (x) x.click(); }, time);
  // which object each draw is for: three.js calls onBeforeRender just before it
  const probe = async label => {
    const r = await p.evaluate(async () => {
      const g = window.__game, pr = window.__glProbe, sc = g.world.parent || g.world;
      let root = sc; while (root.parent) root = root.parent;
      root.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && !o.__probed) { o.__probed = true; const was = o.onBeforeRender; o.onBeforeRender = function (...a) { window.__glObj = o; return was.apply(this, a); }; } });
      pr.seen.clear(); pr.draws = pr.bad = 0; pr.on = true;
      await new Promise(res => { let n = 0; const f = () => (++n < 4 ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
      pr.on = false;
      return { draws: pr.draws, bad: pr.bad, why: [...pr.seen].map(([k, v]) => ({ why: k, n: v.n, who: [...v.who] })) };
    });
    console.log(label, JSON.stringify(r, null, 1));
  };
  await probe('title');
  await startPlay(p, { asIs: true });
  if (+skip >= 0) {
    await p.waitForTimeout(1500 + +skip * 1000);
    await probe('overture');
    await p.keyboard.press('Space');
    await p.waitForFunction(() => { const o = window.__game.overture(); return !o || !o.active; }, null, { timeout: 900000, polling: 500 });
  }
  await p.waitForTimeout(5000);
  await probe('playing');
  // GOV=1: as on a device that cannot hold its frame time, the governor (quality.js) gives up its extras a step at
  // a time, the sun's shadow map among them; it does nothing by itself under a harness
  if (process.env.GOV) for (const ex of [0.5, 0, 1]) {
    await p.evaluate(e => { const G = window.__game.governor; G.set(G.scale, e); }, ex);
    await p.waitForTimeout(1500);
    await probe(`extras ${ex} ${JSON.stringify(await p.evaluate(() => window.__game.governor.ladder))}`);
  }
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
