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
    const onRestoredE = () => {
      lost = false; clearTimeout(timer); stats.restores = ++restores;
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
  function reloadOnLoss(renderer, host) {
    const note = noteIn(host), base = renderer.onDeviceLost;
    renderer.onDeviceLost = info => {
      if (base) base.call(renderer, info);
      reload(note, info && info.api === 'WebGL' ? 'The graphics card took its memory back' : 'The graphics device was lost');
    };
    if (renderer.domElement) renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault());
    return note;
  }

  return { watch, reloadOnLoss };
})();
