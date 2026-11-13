// Picture quality: what this device can draw, measured rather than guessed from its name.
//
// A throwaway WebGL 2 context is asked what it can actually render into (a half-float target,
// with and without MSAA, checked for framebuffer completeness rather than read off the
// extension list), how large a texture it takes, and whether it is a software renderer. The
// screen, the pointer and the device's memory set the budget. Four tiers come out of it:
//   high    desktop GPUs: 4096 textures, the 8K night lights, HDR with 4x MSAA, up to 1.75x pixels
//   medium  tablets and weaker laptops: no 8K lights, no MSAA, 2048 clouds, up to 1.5x pixels
//   low     phones and software renderers: 2048 textures, fewer steps through the air, no bloom
//   still   no WebGL 2: a still of the Earth behind the same menu
// The memory a tier asks of the GPU is estimated with it (gpuBytes), so a choice can be checked.
// The cities' model and game views take the same tier in their own terms (city()).
// The visitor can override the tier in About; the override is kept in localStorage.
'use strict';
window.OEQuality = (function () {
  const KEY = 'oe3d-quality';
  const TIERS = {
    high: { tex: 4096, clouds: 4096, lights8k: true, samples: 4, hdr: true, prMax: 1.75, budget: 4.2e6, atmo: [14, 6], seg: 256, bloom: true },
    medium: { tex: 4096, clouds: 2048, lights8k: false, samples: 0, hdr: true, prMax: 1.5, budget: 2.4e6, atmo: [12, 5], seg: 192, bloom: true },
    low: { tex: 2048, clouds: 2048, lights8k: false, samples: 0, hdr: true, prMax: 1.25, budget: 1.25e6, atmo: [8, 4], seg: 128, bloom: false },
  };
  const ORDER = ['high', 'medium', 'low', 'still'];
  const NAMES = { high: 'High', medium: 'Medium', low: 'Low', still: 'Still picture' };
  let caps = null;

  function probe() {
    if (caps) return caps;
    const c = {
      gl2: false, software: false, maxTex: 0, maxSamples: 0, hdrTarget: false, hdrMsaa: false, renderer: '',
      memory: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0, dpr: window.devicePixelRatio || 1,
      // an iPad says it is a Mac; its touch screen gives it away
      touch: navigator.maxTouchPoints > 0 && matchMedia('(any-pointer: coarse)').matches,
    };
    const ctx = attrs => document.createElement('canvas').getContext('webgl2', attrs);
    let gl = null;
    try {
      gl = ctx({ failIfMajorPerformanceCaveat: true, antialias: false });
      if (!gl) { gl = ctx({ antialias: false }); c.software = !!gl; }
    } catch (e) { gl = null; }
    if (!gl) return (caps = c);
    c.gl2 = true;
    c.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    c.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    c.renderer = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(c.renderer)) c.software = true;
    // the post chain draws into RGBA16F: a texture for the passes, a multisampled renderbuffer for the scene
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const complete = attach => {
      while (gl.getError()) { /* clear */ }
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const del = attach();
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      del();
      return ok;
    };
    c.hdrTarget = complete(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return () => gl.deleteTexture(t);
    });
    c.hdrMsaa = c.hdrTarget && c.maxSamples >= 4 && complete(() => {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA16F, 4, 4);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      return () => gl.deleteRenderbuffer(rb);
    });
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext(); // give the probe's memory straight back
    return (caps = c);
  }

  // the tier this device gets on its own
  function auto(c = probe()) {
    if (!c.gl2 || c.maxTex < 2048) return 'still';
    const phone = c.touch && Math.min(innerWidth, innerHeight) < 600;
    if (c.software || phone || (c.memory && c.memory <= 4)) return 'low';
    if (c.touch || !c.hdrMsaa || c.maxTex < 8192 || (c.memory && c.memory < 8) || (c.cores && c.cores < 4)) return 'medium';
    return 'high';
  }
  function override() {
    try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : null; } catch (e) { return null; }
  }
  function setOverride(v) {
    try { if (v && ORDER.includes(v)) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  }
  // what to draw with: the visitor's choice where they made one, never more than the device can render
  function tier() {
    const c = probe(), a = auto(c), o = override();
    let name = o || a;
    if (!c.gl2) name = 'still';
    const t = name === 'still' ? null : Object.assign({}, TIERS[name]);
    if (t) {
      if (!c.hdrTarget) t.hdr = false;
      if (!c.hdrMsaa || c.software) t.samples = 0;
      if (c.maxTex < 8192) t.lights8k = false;
      t.tex = Math.min(t.tex, c.maxTex); t.clouds = Math.min(t.clouds, c.maxTex);
    }
    return { name, auto: a, chosen: !!o, settings: t };
  }
  // the next tier down, for a device that turns out slower than its tier
  const below = name => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(name) + 1)];
  // pixel ratio within the tier's cap and its budget of device pixels
  function pixelRatio(t, w, h) {
    const c = probe();
    return Math.max(0.75, Math.min(t.prMax, c.dpr, Math.sqrt(t.budget / Math.max(1, w * h))));
  }
  // what the tier asks of the GPU, in bytes: textures with their mips; the scene's target with its
  // depth and MSAA samples, the bloom's chain at half size and below, the canvas's own two buffers
  function gpuBytes(t, w, h, pr) {
    const mip = 4 / 3, px = w * h * pr * pr, bpp = t.hdr ? 8 : 4;
    const tex = (2 * t.tex * t.tex / 2 * 4 + t.clouds * t.clouds / 2 * 4) * mip + 2048 * 1024 * 4 + (t.lights8k ? 8192 * 4096 * mip : 0);
    const post = px * (bpp + 4) * (1 + t.samples) + (t.bloom ? px * bpp * 0.92 : 0) + px * 8;
    return Math.round(tex + post);
  }
  // the cities' 3D views in the same tiers: pixels within the tier's budget (a desktop keeps up to
  // 2x), MSAA, the sun's shadow map, a half-float post stack only where one can be drawn into, and
  // on low world.js's small set, which leaves out shopfronts, parapets, awnings and rooftop plant,
  // the water's reflection and half its wave detail. woods: the share of the woods' far crowns drawn
  // (web/trees.js farKeep): half on medium, where a wooded hillside's far ring was most of a frame's
  // triangles (Queenstown, #227); low already keeps a third of the woods' trees and draws them nearer
  // tex: the largest texture side the view uploads (three.js scales a larger picture down to it, world.js fit): the
  // low tier's 2048, the device's own above it. lean: a phone's memory (Shibuya's game killed an iPhone's
  // tab, which iOS does at about 1-1.5 GB, at 865 MB of WebGL and 800 MB of script). There the view also lets go of
  // what it holds only for the GPU once it is uploaded (the walls' shading attributes: a lost context then reloads
  // the page instead of being restored in place), keeps the full aerial picture on the ground tiles nearest the
  // camera only (budget.groundTiles, the rest on the overview) and the shared models' far parts. budget: the memory
  // the view aims to stay under, MB, which tools/mem_check.js checks every live city's game against on a phone
  function lean(c = probe()) {
    return (c.touch && Math.min(innerWidth, innerHeight) < 600) || (!!c.memory && c.memory <= 4);
  }
  function city() {
    const c = probe(), t = tier(), name = t.name === 'still' ? 'low' : t.name, s = TIERS[name];
    const thin = name === 'low' && lean(c);
    // The high tier's canvas keeps the display's own pixels up to 2x (the lens's one pass and the interface stay
    // sharp) within CANVAS_PX, a 4K display's; the scene inside it is drawn within the tier's budget of pixels
    // (sceneScale: the governor's ceiling, issue 352), which a 1440p display meets at full size. Before, a 4K
    // display drew 8.3 million pixels four samples each, and a 5K one at 2x fourteen.
    const CANVAS_PX = 3840 * 2160, SCENE_PX = { high: 2560 * 1440, medium: s.budget, low: s.budget }[name];
    return { name, small: name === 'low', lean: thin, tex: Math.min(c.maxTex || 16384, name === 'low' ? TIERS.low.tex : 16384),
      budget: thin ? { gpuMB: 700, heapMB: 760, groundTiles: 6 } : null, shadow: name === 'high' ? 4096 : 2048, antialias: name !== 'low', woods: name === 'medium' ? 0.5 : 1,
      post: c.hdrTarget, samples: c.hdrMsaa ? { high: 4, medium: 2, low: 0 }[name] : 0,
      pixelRatio: (w, h) => (name === 'high' ? Math.max(0.75, Math.min(c.dpr, 2, Math.sqrt(CANVAS_PX / Math.max(1, w * h)))) : pixelRatio(s, w, h)),
      // the most of the canvas's pixels (as a linear scale) the scene may be drawn at: w, h the canvas's device pixels
      sceneScale: (w, h) => Math.min(1, Math.sqrt(SCENE_PX / Math.max(1, w * h))) };
  }

  // The frame-time governor (issue 352): one controller for what a frame may cost, in place of steps that only
  // ever went down. The game ticks it once a drawn frame; it holds a smoothed frame time against a target (the
  // display's own interval, or the frame-rate cap's: 60 a second unless the player asks otherwise) and moves
  // two things the game reads back:
  //   scale   the scene's resolution against the canvas's, from `max` (the tier's pixel budget) down to `min`,
  //           in steps of a twentieth. The lens upscales and sharpens (lens.js), so a step is hard to see.
  //   extras  1, 0.5 or 0: how much of what a frame can do without is drawn. 0.5: no far or secondary layers
  //           (the far rain and its splashes, the wet street's mirror, the lighter contact shadows); 0: the
  //           essentials only. Read it each frame, or take on(fn) for a call when it changes.
  // Down, in the order of what is missed least: resolution to `mid`, the extras, then resolution to `min`.
  // Up: vertical sync hides headroom (a frame that could take 9 ms still takes 16.7), so after a calm
  // stretch it tries one step up; a try that puts the frame over the target is taken back and the next one
  // waits twice as long (4 s, 8 s ... a minute), so a device at its limit is not nudged over it for ever.
  // Extras come back only at full resolution, after a longer calm. A display that cannot be met even at the
  // floor (a phone that draws the city at 40 a second) is given half its rate as the target instead, where
  // the frames are even, rather than the floor for nothing.
  // Under automation it stands still (a software renderer's frames say nothing about a device) unless driven
  // through simulate().
  function governor({ min = 0.6, mid = 0.8, max = 1, cap = 60, auto = !navigator.webdriver } = {}) {
    const STEP = 0.05, subs = [];
    const q = v => Math.round(v / STEP) * STEP;
    let last = 0, ema = 0, refresh = 0, since = 0, calm = 0, wait = 4000, tried = 0, floorT = 0, halved = false;
    const g = {
      scale: Math.min(1, max), extras: 1, min, mid, max, cap, auto,
      get frameMs() { return ema; },
      get refreshMs() { return refresh; },
      // the frame time aimed at: the cap's interval or the display's, whichever is longer; twice the display's where that cannot be met
      get targetMs() { const t = Math.max(g.cap > 0 ? 1000 / g.cap : 0, refresh || 1000 / 60); return halved ? Math.max(t, 2 * (refresh || 1000 / 60)) : t; },
      on(fn) { subs.push(fn); return g; },
      // every animation frame, drawn or not: the display's interval, as the shortest gap seen lately. Only a gap under
      // a 60 Hz display's counts (a 90, 120 or 144 Hz display): on a device that cannot keep up, the gap between
      // frames is the frame's own time, and taking it for the display's would aim at the slowness itself
      raf(now) {
        const d = now - g._raf; g._raf = now;
        if (d > 2 && d < 16.9) refresh = refresh ? Math.min(refresh * 1.002, d, 1000 / 60) : d;
      },
      // whether to draw this animation frame, under the cap on a faster display (120 Hz at 60: every second one)
      due(now) {
        const t = g.cap > 0 ? 1000 / g.cap : 0;
        if (!t || !refresh || refresh > t * 0.9) return true;
        if (now - g._drawn < t - refresh * 0.5) return false;
        g._drawn = now - g._drawn > 2 * t ? now : g._drawn + t; // (even pacing: on the cap's grid, not the frame's own time)
        return true;
      },
      // once a drawn frame; active: in play (not the title, a menu, a hidden tab), where a frame's time means something
      tick(now, active = true) {
        const ms = last ? now - last : 0;
        last = now;
        if (!active || !ms || ms > 250) return;
        ema = ema ? ema + (ms - ema) * 0.08 : ms;
        if (g.auto) decide(ms);
      },
      reset() { last = 0; ema = 0; since = calm = floorT = 0; },
      set(scale, extras) { change(scale ?? g.scale, extras ?? g.extras); },
      // for the checks: frames of frameOf(scale, extras) milliseconds on a clock of its own, as a GPU would show
      // them; the state after each simulated second, as "scale/extras"
      simulate(seconds, frameOf) {
        const keep = g.auto, seen = [];
        g.auto = true; g.reset();
        let t = 1e6;
        for (let s = 0; s < seconds; s++) {
          for (const end = t + 1000; t < end;) { t += Math.max(frameOf(g.scale, g.extras), refresh || 0); g.tick(t); }
          seen.push(`${g.scale.toFixed(2)}/${g.extras}`);
        }
        g.auto = keep; g.reset();
        return seen;
      },
      _raf: 0, _drawn: 0,
    };
    function change(scale, extras) {
      scale = Math.max(g.min, Math.min(g.max, q(scale)));
      const moved = scale !== g.scale || extras !== g.extras, ex = extras !== g.extras;
      g.scale = scale; g.extras = extras; since = 0;
      if (moved) for (const fn of subs) fn(g.extras, g.scale, ex);
    }
    function decide(ms) {
      since += ms;
      const target = g.targetMs, load = ema / target;
      if (since < 1000) return; // (a change settles into the average first)
      if (load > 1.15) {
        calm = 0;
        if (tried && since < 4000) { wait = Math.min(64000, wait * 2); tried = 0; change(g.scale - STEP, g.extras); return; } // the try up did not fit
        tried = 0;
        const want = Math.max(0.85, Math.min(0.95, Math.sqrt(1 / load))); // (pixels go with the square of the scale)
        const floor = g.extras > 0 ? Math.max(g.min, Math.min(g.mid, g.max)) : g.min;
        if (g.scale > floor + 1e-6) { floorT = 0; change(Math.max(floor, Math.min(g.scale - STEP, g.scale * want)), g.extras); return; }
        floorT += ms;
        if (floorT < 3000) return;
        floorT = 0;
        if (!halved && g.scale <= g.min + 1e-6 && load < 1.9) { halved = true; wait = 4000; return; } // half the display's rate, evenly
        if (g.extras > 0) change(g.scale, g.extras - 0.5);
        return;
      }
      floorT = 0;
      if (load > 1.04) { calm = 0; return; } // on the edge: hold
      calm += ms;
      if (tried && since >= 4000) tried = 0; // the try up held
      if (calm < wait) return;
      calm = 0;
      if (g.scale < g.max - 1e-6) { tried = 1; change(g.scale + STEP, g.extras); }
      else if (g.extras < 1 && since >= 20000) change(g.scale, g.extras + 0.5);
      else if (halved && since >= 30000) { halved = false; }
    }
    return g;
  }
  return { probe, auto, tier, override, setOverride, below, pixelRatio, gpuBytes, city, lean, governor, TIERS, ORDER, NAMES };
})();
