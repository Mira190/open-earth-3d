// A lost WebGL context: a phone puts the tab away, a GPU driver resets, memory runs short, or
// a software renderer under too much load gives up. Until now the city viewer and the game drew
// black from then on. Here:
//   - on webglcontextlost the default is prevented (so the browser offers the context back), the
//     frame loop is told to pause (care.lost), and a note says what happened;
//   - on webglcontextrestored three.js rebuilds its own state (programs, buffers, textures from
//     their images, render targets, empty); onRestored() redraws what lived only on the GPU (the
//     sky's light in the PMREM target, the shadow map); then the next frames are read back, and
//     the note goes once one of them is drawn;
//   - a context that stays away, a restore that throws, or frames that come back black reload the
//     page with a note instead of leaving a black canvas; a second reload inside a minute stays on
//     the note with a Reload button, so a device that cannot hold the picture does not loop.
// The reef pages (WebGPURenderer, which cannot restore a lost device) reload with the same note.
'use strict';
window.OEGLCare = (function () {
  const KEY = 'oe3d-gl-reload';
  const now = () => Date.now();
  // the note in the title screen's language: the loader's dark veil over the whole view (the
  // labels of the last frame drawn would float on it otherwise), a card on it with the heading in
  // the display face and the line in the mono under the accent's rule (the reef pages share it, so it brings
  // its own style, with the title's tokens as fallbacks)
  const CSS = `.gl-note { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; box-sizing: border-box; pointer-events: auto;
  background: radial-gradient(90% 70% at 50% 42%, rgba(11, 17, 27, 0.94) 0%, rgba(4, 6, 11, 0.98) 70%); }
body > .gl-note { position: fixed; }
.gl-note > div { width: min(420px, 100%); box-sizing: border-box; display: grid; gap: 10px; justify-items: center; padding: 22px 24px 20px; text-align: center;
  background: rgba(7, 11, 18, 0.6); border: 1px solid var(--line, rgba(236, 232, 225, 0.14)); border-radius: 2px; }
.gl-note > div::before { content: ""; width: 36px; height: 1px; background: var(--accent, #ffb066); }
.gl-note b { font: 250 15px/1.3 var(--f-display, system-ui, sans-serif); letter-spacing: 0.22em; margin-right: -0.22em; text-transform: uppercase; color: #f4f1ea; }
.gl-note span { font: 400 9.5px/1.6 var(--f-mono, ui-monospace, monospace); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted, #8a93a3); }
.gl-note button { margin-top: 4px; padding: 9px 14px; border: 1px solid var(--line-2, rgba(236, 232, 225, 0.3)); border-radius: 2px; background: none; color: var(--ink, #ece8e1);
  font: 400 9.5px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
.gl-note button:hover, .gl-note button:focus-visible { border-color: var(--accent, #ffb066); color: #fff; outline: none; }
.gl-note[hidden] { display: none; }`;
  function noteIn(host) {
    if (!document.getElementById('gl-note-css')) {
      const st = document.createElement('style');
      st.id = 'gl-note-css'; st.textContent = CSS;
      document.head.append(st);
    }
    const note = document.createElement('div');
    note.className = 'gl-note';
    note.setAttribute('role', 'status');
    note.hidden = true;
    host.append(note);
    return {
      el: note,
      say(head, line, button) {
        note.textContent = '';
        const card = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span');
        b.textContent = head; s.textContent = line;
        card.append(b, s);
        note.append(card);
        if (button) {
          const k = document.createElement('button');
          k.type = 'button'; k.textContent = button.text;
          k.addEventListener('click', button.on);
          card.append(k);
        }
        note.hidden = false;
      },
      hide() { note.hidden = true; },
    };
  }
  // reload once, with the note up while it goes; a second time inside a minute, stay on the note
  function reload(note, why) {
    let prev = 0;
    try { prev = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { /* storage blocked */ }
    if (now() - prev < 60000) {
      note.say('The graphics card stopped drawing', `${why}. Reload to try again, or choose a lower picture quality on the title screen.`,
        { text: 'Reload', on: () => location.reload() });
      return false;
    }
    try { sessionStorage.setItem(KEY, String(now())); } catch (e) { /* storage blocked */ }
    note.say('Reloading the view', `${why}; starting the view again.`);
    setTimeout(() => location.reload(), 1200);
    return true;
  }

  // renderer: a THREE.WebGLRenderer; host: the element the note goes in (the stage);
  // onLost(n), onRestored(n): the view's own pause and rebuild; waitMs: how long a lost context
  // may stay away before the page reloads
  function watch({ renderer, host, onLost = () => {}, onRestored = () => {}, waitMs = 8000 }) {
    const canvas = renderer.domElement, gl = renderer.getContext(), note = noteIn(host);
    let lost = false, check = 0, timer = 0, losses = 0, restores = 0;
    const stats = { losses: 0, restores: 0, drawn: 0, reloads: 0 };
    const giveUp = why => { check = 0; stats.reloads++; reload(note, why); };
    const onLostE = e => {
      e.preventDefault(); // without it the browser never offers the context back
      lost = true; check = 0; stats.losses = ++losses;
      note.say('The picture was lost', 'The graphics card took its memory back. Getting it back…');
      try { onLost(losses); } catch (err) { console.warn('glcare: onLost', err); }
      clearTimeout(timer);
      timer = setTimeout(() => { if (lost) giveUp('The graphics card did not give the picture back'); }, waitMs);
    };
    // three.js listens first (it was made before this), so its state is rebuilt by now
    spareTheDead(renderer.getContext());
    const onRestoredE = () => {
      lost = false; clearTimeout(timer); stats.restores = ++restores;
      renderer.getContext().__restored = true; // (spareTheDead, below)
      try { onRestored(losses); } catch (err) { console.warn('glcare: onRestored', err); giveUp('The view could not be redrawn'); return; }
      check = 4; // frames to read back before the picture counts as black
    };
    canvas.addEventListener('webglcontextlost', onLostE);
    canvas.addEventListener('webglcontextrestored', onRestoredE);
    // rows across the frame as drawn, read straight after the render (before the browser takes
    // the frame, so preserveDrawingBuffer is not needed): drawn when any of it is lit
    const row = new Uint8Array(4 * 4096);
    function lit() {
      const w = Math.min(4096, gl.drawingBufferWidth), h = gl.drawingBufferHeight;
      let n = 0, on = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        gl.readPixels(0, Math.floor(h * f), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
        for (let i = 0; i < w; i += 4) { n++; if (row[4 * i] + row[4 * i + 1] + row[4 * i + 2] > 12) on++; }
      }
      renderer.setRenderTarget(null); // three's record of the binding, which readPixels went round
      return on > n * 0.01;
    }
    return {
      get lost() { return lost || gl.isContextLost(); },
      stats,
      note,
      // after each render: while a restore is being checked, is the frame drawn?
      drawn() {
        if (!check || gl.isContextLost()) return;
        if (lit()) { check = 0; stats.drawn++; note.hide(); try { sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
        else if (--check === 0) giveUp('The picture came back black');
      },
      dispose() {
        clearTimeout(timer);
        canvas.removeEventListener('webglcontextlost', onLostE);
        canvas.removeEventListener('webglcontextrestored', onRestoredE);
        note.el.remove();
      },
    };
  }

  // a WebGPURenderer (the reef pages): a lost device, or the WebGL2 fallback's lost context,
  // cannot be restored in place, so the page reloads with the note
  // After a context comes back, what was made in the lost one is dead, and three.js still deletes it: a render
  // target made before the loss keeps the listener of the renderer's old state, and its next dispose() or setSize()
  // (the governor halving the shadow map, the scene's target changing its samples or its size, the sky's light made
  // again) asks WebGL to delete a framebuffer, a renderbuffer and a texture of the dead context beside the live
  // ones. Each is INVALID_OPERATION: nothing breaks, but the context's one error flag is raised, which is the flag
  // the game watches for draws that were refused (issue 485; found by that watch in the game check, in a rain shed
  // after the check's own lost context). From the first restoration on, a delete of an object the context does not
  // know (isTexture and its kin are false for the dead, with no error) is not sent. (The guard is on the context
  // from the start, so that a trace begun before a loss keeps it, and does nothing until a restoration.)
  const DEAD = { deleteTexture: 'isTexture', deleteFramebuffer: 'isFramebuffer', deleteRenderbuffer: 'isRenderbuffer', deleteBuffer: 'isBuffer', deleteProgram: 'isProgram',
    deleteShader: 'isShader', deleteVertexArray: 'isVertexArray', deleteQuery: 'isQuery', deleteSampler: 'isSampler', deleteSync: 'isSync', deleteTransformFeedback: 'isTransformFeedback' };
  function spareTheDead(gl) {
    if (!gl || gl.__spared) return;
    gl.__spared = true;
    const P = Object.getPrototypeOf(gl);
    for (const [del, is] of Object.entries(DEAD)) {
      if (typeof P[del] !== 'function' || typeof P[is] !== 'function') continue;
      const guard = function (o) { if (this.__restored && o && !P[is].call(this, o)) return undefined; return P[del].call(this, o); };
      guard.__spare = true;
      gl[del] = guard;
    }
  }
  function reloadOnLoss(renderer, host) {
    const note = noteIn(host), base = renderer.onDeviceLost;
    renderer.onDeviceLost = info => {
      if (base) base.call(renderer, info);
      reload(note, info && info.api === 'WebGL' ? 'The graphics card took its memory back' : 'The graphics device was lost');
    };
    if (renderer.domElement) renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault());
    return note;
  }

  // Which call WebGL refused (issue 485). The context keeps one error flag and says nothing of the call that raised
  // it: a refused draw is not drawn, a refused blit copies nothing, and the picture is short of whatever that was
  // with no word in the console of a visitor's device. trace(gl) asks for the error after every call of the context
  // until stop(), which returns what was refused: [{ call, err, n, args, at }], the call's name, the error, how
  // often, its first arguments and the lines of the page that made it. Each question waits on the GPU process, so
  // this is for a few frames once an error has shown (game.js glCheck), for a load asked to be traced, and for the
  // checks (tools/game_check.js walks the governor's ladder under it); never for every frame.
  const QUIET = /^(getError|isContextLost|getExtension|getParameter|getSupportedExtensions|getContextAttributes|getShaderPrecisionFormat)$/;
  function trace(gl) {
    const P = (window.WebGL2RenderingContext && gl instanceof WebGL2RenderingContext ? WebGL2RenderingContext : window.WebGLRenderingContext).prototype;
    const seen = new Map(), names = [], getError = P.getError;
    const show = x => (typeof x === 'number' ? (Number.isInteger(x) && x > 255 ? `0x${x.toString(16)}` : String(+x.toFixed(3))) : x === null ? 'null' : x && x.constructor ? x.constructor.name : typeof x);
    let calls = 0;
    while (getError.call(gl)) { /* what was raised before the trace is not its to name */ }
    for (const k of Object.getOwnPropertyNames(P)) {
      const d = Object.getOwnPropertyDescriptor(P, k);
      if (!d || typeof d.value !== 'function' || QUIET.test(k)) continue;
      const own = Object.prototype.hasOwnProperty.call(gl, k) ? gl[k] : null; // (the guard of a restored context: spareTheDead)
      names.push([k, own]);
      const orig = own || d.value;
      gl[k] = function (...a) {
        const r = orig.apply(this, a);
        calls++;
        const e = getError.call(this);
        if (!e || e === 0x9242) return r; // (CONTEXT_LOST_WEBGL: the loss has its own note)
        const at = (new Error().stack || '').split('\n').slice(2).map(l => (/([\w.-]+\.js)[^:]*:(\d+)/.exec(l) || []).slice(1).join(':')).filter(l => l && !/^three\./.test(l)).slice(0, 4).join(' < ');
        const key = `${k} 0x${e.toString(16)} ${at}`;
        const o = seen.get(key) || seen.set(key, { call: k, err: `0x${e.toString(16)}`, n: 0, args: a.slice(0, 11).map(show).join(','), at }).get(key);
        o.n++;
        return r;
      };
    }
    return {
      get calls() { return calls; },
      // what was refused so far, the list emptied (the trace goes on)
      take() { const out = [...seen.values()]; seen.clear(); return out; },
      stop() { for (const [k, own] of names) { if (own) gl[k] = own; else delete gl[k]; } return [...seen.values()]; },
    };
  }

  // ---------------------------------------------------------------- a program the GPU will not link
  // A shader that compiles here can fail on another GPU: the commonest cause is the texture units a fragment shader
  // may use, 16 on Apple's GPUs and most phones, 32 on the software renderer the checks run on. The ground's material
  // asked for 20, did not link on an Apple M3, and every draw with it was refused: the sky showed where the ground
  // was (issue 485). three.js only writes such a failure on the console. So:
  //  - fit.off(name): the optional layers of a material (LADDER, the least missed first) ask before they add their
  //    sampler; each rung of the ladder taken turns one more of them off;
  //  - when a program fails to link, the ladder goes down a rung and the materials that wore the program are
  //    compiled again without that layer, until one links; a material that still fails with every layer off is
  //    compiled as three.js's own, unpatched: plain, but drawn;
  //  - the rung a device ended on for a map is remembered (for this release), so its next load starts there
  //    and no link fails;
  //  - ?units=N plays a device with N units on any machine: a program with more samplers reads as not linked.
  // tools/sampler_probe.js counts every program's samplers against 16 in the checks, so the ladder is the net,
  // not the plan.
  const LADDER = ['trail', 'floor', 'shore', 'mirror', 'surface', 'woods'];
  const SAMPLERS = [0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5, 0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7];
  const fit = { level: 0, limit: 0, failed: 0, plain: 0, ladder: LADDER,
    off(name) { const i = LADDER.indexOf(name); return i >= 0 && i < fit.level; } };
  const FIT_KEY = 'oe3d-fit';
  function fitWatch(renderer, { roots = () => [], key = '' } = {}) {
    const gl = renderer.getContext();
    const asked = +(new URLSearchParams(location.search).get('units') || 0);
    fit.limit = asked || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    const memKey = `${key}|${fit.limit}|${(window.OE_VERSION || {}).version || ''}`;
    // (a GPU with sixteen units starts without the snow's tracks, the first rung, which only snow shows: Tokyo's ground
    // needs seventeen with them, and a link that fails costs that load a second compile)
    fit.level = fit.limit <= 16 ? 1 : 0; fit.failed = 0; fit.plain = 0;
    try { const m = JSON.parse(localStorage.getItem(FIT_KEY) || '{}'); if (m.k === memKey && m.level > fit.level) fit.level = Math.min(LADDER.length, m.level | 0); } catch (e) { /* storage blocked */ }
    const samplers = p => { let n = 0; for (let i = 0, c = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < c; i++) { const u = gl.getActiveUniform(p, i); if (u && SAMPLERS.includes(u.type)) n += u.size; } return n; };
    if (asked) { // (a device with fewer units, played here: its link fails where this machine's would not)
      const own = gl.getProgramParameter.bind(gl), over = new WeakMap();
      gl.getProgramParameter = (p, what) => {
        const r = own(p, what);
        if (what !== gl.LINK_STATUS || !r) return r;
        if (!over.has(p)) over.set(p, samplers(p) > asked);
        return !over.get(p);
      };
    }
    const old = new WeakSet(); // (programs compiled before the last rung was taken)
    renderer.debug.onShaderError = (g, program, vs, fs) => {
      fit.failed++;
      const text = s => { try { return (s || '').replace(/\s+/g, ' ').trim().slice(0, 160); } catch (e) { return ''; } };
      const why = text(g.getProgramInfoLog(program)) || text(g.getShaderInfoLog(fs)) || text(g.getShaderInfoLog(vs)) || (asked ? `more than ${asked} texture units` : 'no log');
      const hit = [], seen = new Set(), stale = old.has(program);
      for (const root of roots()) if (root) root.traverse(o => {
        for (const m of [].concat(o.material || [])) {
          if (!m || seen.has(m) || !renderer.properties.has(m)) continue;
          seen.add(m);
          const P = renderer.properties.get(m), progs = P.programs ? [...P.programs.values()] : P.currentProgram ? [P.currentProgram] : [];
          if (progs.some(x => x && x.program === program)) { hit.push(m); for (const x of progs) if (x && x.program) old.add(x.program); }
        }
      });
      const from = fit.level;
      // (two programs of one material, with and without the sky's light, fail one after the other: the second was
      // compiled before the rung the first one's failure took, and takes none itself; nor does a material compiled
      // before a rung another material's failure took: it is compiled again at that rung first)
      const current = !stale && hit.some(m => (m.userData.oeFitAt ?? fit.start) === fit.level);
      if (current && fit.level < LADDER.length) fit.level++;
      let plain = 0;
      for (const m of hit) {
        if (m.userData.oeFitPlain) continue; // (three.js's own shader failed too: nothing left to take away)
        if (current && from >= LADDER.length) {
          m.userData.oeFitPlain = true; m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'oe-plain'; plain++; fit.plain++;
        } else if (!m.userData.oeFitKeyed) {
          // (three.js keys a program by the text of onBeforeCompile, which has not changed: the rung goes in the key)
          m.userData.oeFitKeyed = true;
          const own = m.customProgramCacheKey;
          m.customProgramCacheKey = function () { return `${own.call(this)}|fit${this.userData.oeFitAt}`; };
        }
        m.userData.oeFitAt = fit.level;
        m.needsUpdate = true;
      }
      try { localStorage.setItem(FIT_KEY, JSON.stringify({ k: memKey, level: fit.level })); } catch (e) { /* storage blocked */ }
      const one = hit[0];
      // (the first line is what the telemetry keeps: web/telemetry.js "shader")
      console.error(`THREE.WebGLProgram: did not link (${why}); ${hit.length} material${hit.length === 1 ? '' : 's'}${one ? `, ${one.type}${one.name ? ` "${one.name}"` : ''}` : ''}; ${fit.limit} units; rung ${from} to ${fit.level}${fit.level > from ? ` (without ${LADDER[from]})` : ''}${plain ? `, ${plain} plain` : ''}`);
      if (window.OETelemetry && OETelemetry.set) OETelemetry.set({ fit: fit.level, fit_plain: fit.plain || undefined });
    };
    fit.start = fit.level;
    fit.samplers = samplers;
    return fit;
  }

  return { watch, reloadOnLoss, trace, fit, fitWatch };
})();
