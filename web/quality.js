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
  // the water's reflection and half its wave detail
  function city() {
    const c = probe(), t = tier(), name = t.name === 'still' ? 'low' : t.name, s = TIERS[name];
    return { name, small: name === 'low', shadow: name === 'high' ? 4096 : 2048, antialias: name !== 'low',
      post: c.hdrTarget, samples: c.hdrMsaa ? { high: 4, medium: 2, low: 0 }[name] : 0,
      pixelRatio: (w, h) => (name === 'high' ? Math.min(c.dpr, 2) : pixelRatio(s, w, h)) };
  }
  return { probe, auto, tier, override, setOverride, below, pixelRatio, gpuBytes, city, TIERS, ORDER, NAMES };
})();
