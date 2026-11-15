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
    c.units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS); // (the textures one fragment shader may read: 16 on an Apple GPU, 32 and more elsewhere)
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
      // (?msaa=on: a check draws with the tier's samples on a software renderer too. Without it no check ever drew
      // the multisampled scene a desktop GPU draws every frame: issue 485)
      if (!c.hdrMsaa || (c.software && !/[?&]msaa=on\b/.test(location.search))) t.samples = 0;
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
  // budget.map: the game's map is built round the player there (world.js mapAt, buildings-geo.js cells): cells of `size`
  // metres, whole within `near` of the player, simplified to `mid`, past it only what stands `tall` metres or more,
  // built again once the player has gone `step` metres (docs/PERFORMANCE.md, "A map built round the player")
  function lean(c = probe()) {
    return (c.touch && Math.min(innerWidth, innerHeight) < 600) || (!!c.memory && c.memory <= 4);
  }
  // The memory loop (issue 443; docs/PERFORMANCE.md, "Measure, then grant"). A phone gives no reading of the memory
  // it has left; the two signals it does give are that the system killed the tab, which the next page load finds
  // as a note left behind (telemetry.js) and counts by map, and that it did not: a minute of play. So a phone's set
  // is a level, 0 (the fullest) to LIGHTEST, and it is granted the way a congestion window is: a phone with no
  // record starts light (START: Safari gives a page two deaths before "A problem repeatedly occurred", so the first
  // load has to be one that fits, not the one that looks best), a level held for a minute of play (held(), from
  // the game) lets the next load try the one above it, and a death at a level (telemetry.js writes the level the
  // dead page ran at) rules that level and the heavier ones out for fourteen days. A phone with the room climbs
  // to the full set in two visits; one without stays where it lives.
  // died(map): how many times this map's page died on this device in the last fourteen days (the map in the
  // address by default). A low-tier device that is not a phone gets the phone's sets after its first death.
  const mapId = () => (/^#(?:play-)?([a-z0-9-]+)/.exec(location.hash) || [])[1];
  const DAYS = 14 * 864e5, START = 2, LIGHTEST = 3;
  const note = k => { try { const d = JSON.parse(localStorage.getItem(k)); return d && Date.now() - d.t < DAYS ? d : null; } catch (e) { return null; } };
  function died(id = mapId()) {
    const d = id ? note(`oe3d-died-${id}`) : null;
    return d && d.n > 0 ? d.n : 0;
  }
  // milliseconds since this map's page last died here (Infinity: never): a load straight after waits a moment
  // for the system to take the dead page's memory back (world.js load)
  function sinceDeath(id = mapId()) {
    const d = id ? note(`oe3d-died-${id}`) : null;
    return d && d.n > 0 ? Date.now() - d.t : Infinity;
  }
  // a phone's level for this map (see above). oe3d-lv in localStorage sets it, for the tools
  function level(id = mapId()) {
    try { const f = localStorage.getItem('oe3d-lv'); if (f != null && f !== '') return Math.max(0, Math.min(LIGHTEST, +f || 0)); } catch (e) { /* storage blocked */ }
    if (!id) return START;
    const d = note(`oe3d-died-${id}`), h = note(`oe3d-held-${id}`);
    // (a death noted before pages wrote their level was at level 0 or 1, the sets of that time)
    const bad = d && d.n > 0 ? (d.lv != null ? d.lv : 1) : -1;
    return Math.max(0, Math.min(LIGHTEST, Math.max(h && h.lv != null ? h.lv - 1 : START, bad + 1)));
  }
  // the game, after a minute of play on a phone: this level fits this map on this device
  function held(id = mapId()) {
    const c = probe();
    if (!id || !lean(c)) return;
    try {
      const lv = level(id), h = note(`oe3d-held-${id}`);
      localStorage.setItem(`oe3d-held-${id}`, JSON.stringify({ lv: h && h.lv != null ? Math.min(h.lv, lv) : lv, t: Date.now() }));
    } catch (e) { /* storage blocked */ }
  }
  // budget.map by level. (2, a phone's first: the middle distance kept to 1.1 km, since from the helicopter the
  // aerial photograph past it reads as a blue band under the horizon at dusk when it starts at 600 m)
  const MAP = [{ size: 250, near: 500, mid: 1500, tall: 25, step: 100 }, { size: 250, near: 350, mid: 1000, tall: 30, step: 100 }, { size: 250, near: 250, mid: 1100, tall: 30, step: 100 }, { size: 250, near: 200, mid: 700, tall: 40, step: 100 }];
  function city() {
    const c = probe(), t = tier(), name = t.name === 'still' ? 'low' : t.name, s = TIERS[name];
    const deaths = name === 'low' ? died() : 0, phone = lean(c), thin = name === 'low' && (phone || deaths > 0);
    // (0: the fullest phone set ... 3: the lightest; a phone's by level(), another low-tier device's by its deaths)
    const lighter = !thin ? 0 : phone ? level() : Math.min(LIGHTEST, deaths - 1);
    // The high tier's canvas keeps the display's own pixels up to 2x (the lens's one pass and the interface stay
    // sharp) within CANVAS_PX, a 4K display's; the scene inside it is drawn within the tier's budget of pixels
    // (sceneScale: the governor's ceiling, issue 352), which a 1440p display meets at full size. Before, a 4K
    // display drew 8.3 million pixels four samples each, and a 5K one at 2x fourteen.
    const CANVAS_PX = 3840 * 2160, SCENE_PX = { high: 2560 * 1440, medium: s.budget, low: s.budget }[name];
    return { name, small: name === 'low', lean: thin, lighter, deaths, tex: Math.min(c.maxTex || 16384, name === 'low' ? (thin && lighter >= 2 ? 1024 : TIERS.low.tex) : 16384),
      // cast: how many of the scanned avatars walk beside the player (game.js realCast); extras: the helicopter's and
      // the near trees' models fetched ahead of need (game.js afterPlayable), which the lightest set leaves to demand
      budget: thin ? { gpuMB: 270, heapMB: 400, groundTiles: [6, 4, 2, 1][lighter], map: MAP[lighter], cast: [8, 8, 4, 2][lighter], extras: lighter < LIGHTEST } : null, shadow: name === 'high' ? 4096 : 2048, antialias: name !== 'low', woods: name === 'medium' ? 0.5 : 1,
      post: c.hdrTarget, samples: c.hdrMsaa ? { high: 4, medium: 2, low: 0 }[name] : 0,
      // A phone's canvas: two device pixels to the CSS pixel within the tier's budget (1.5 at its lightest level),
      // where the low tier's 1.25 is a slow laptop's. On a 3x screen 1.25 was 491 x 869 for a 393 x 695 view, the
      // governor's floor under it 295 x 521, and the owner's verdict on an iPhone was that the picture was far too
      // poor; its frames (telemetry: 30 to 53 a second at every scale) were not the pixels' to give back. The
      // scene has one pass and no multisampling there: 786 x 1390 costs about 12 MB more of targets than before.
      pixelRatio: (w, h) => (name === 'high' ? Math.max(0.75, Math.min(c.dpr, 2, Math.sqrt(CANVAS_PX / Math.max(1, w * h))))
        : phone && name === 'low' ? pixelRatio({ prMax: lighter >= LIGHTEST ? 1.5 : 2, budget: s.budget }, w, h) : pixelRatio(s, w, h)),
      // the most of the canvas's pixels (as a linear scale) the scene may be drawn at: w, h the canvas's device pixels
      sceneScale: (w, h) => Math.min(1, Math.sqrt(SCENE_PX / Math.max(1, w * h))),
      // The scene's samples for a view of w x h CSS pixels. Four samples a pixel are for a scene drawn a pixel to
      // the CSS pixel; on a dense display the scene is already drawn at one and a half to two device pixels each
      // way, two to four of them under every CSS pixel, and two samples there give four to eight to the CSS pixel:
      // half the samples written and resolved every frame (an Apple M3 at 2x in a 1001 x 894 window: 14.3 million
      // HDR samples a frame, 7.2 now) for edges as smooth as a 1x display's at four. A 4K or 5K display filled at
      // 2x draws the scene near a pixel to the CSS pixel (the scene's budget) and keeps four.
      samplesAt(w, h) {
        const n = this.samples, pr = this.pixelRatio(w, h);
        return n > 2 && pr * this.sceneScale(w * pr, h * pr) >= 1.5 ? 2 : n;
      } };
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
  // A choice that settles (issue 485). A step of resolution is seen when it happens, and five percent of unused
  // headroom is not, so the two directions are not judged alike. Down is prompt: a missed frame is seen. Up is a
  // question, and vertical sync leaves only one way to ask it, which is to try; a device whose limit lies between
  // two steps was asked every five seconds for ever (an Apple M3 in Shibuya went between 0.6 and 0.8 all session:
  // a try that held four seconds and failed in the ninth left no trace). So the step the frames did not fit at
  // is remembered (top), however long after the try it failed: the way back up to the step under it is as quick
  // as before, and the step itself is asked for again only after a wait that starts at half a minute and doubles
  // each time a try fails again (to eight minutes), and starts over when the failures stop coming. The
  // extras have the same memory (exBad: a minute, doubling to sixteen), since multisampling and the shadow map's
  // size coming and going are seen more than any step of resolution. A record from an earlier visit (resume)
  // starts settled: the step above what the device held is the one to wait for.
  // Under automation it stands still (a software renderer's frames say nothing about a device) unless driven
  // through simulate().
  // One ladder (issue 375; issue 358's Layer A): whatever a frame can do without registers its rungs with rung(name,
  // [with every extra, at half, at none], fn), and fn is called with the value for the governor's extras whenever
  // that value changes (and at once). The contact shadows, the MSAA samples, the weather, the wet street's mirror,
  // the sun's shadow map, the sea's reflection and the crowd are all on it (game.js), none sheds on its own.
  // startLow() starts a device with no record of its own at 0.8 of the scene's resolution and half the extras, and
  // climbs from there a try every second and a half until a try does not fit (a fast device is at its ceiling in some
  // ten seconds); a device that has a record (what it held on this map before) starts from it.
  function governor({ min = 0.6, mid = 0.8, max = 1, cap = 60, auto = !navigator.webdriver } = {}) {
    const STEP = 0.05, subs = [];
    const q = v => Math.round(v / STEP) * STEP;
    let last = 0, ema = 0, refresh = 0, since = 0, calm = 0, wait = 4000, tried = 0, floorT = 0, halved = false, climbing = false;
    // what did not fit (see above), on the clock of frames in play. top: the step a try up to it failed at, and how
    // long it is left alone (doubling while the tries keep failing); a failure counts as the try's for as long as
    // that wait, since a try can hold for seconds before the scene shows what it costs. bad: a step the frames
    // stopped fitting at with no try behind it (the scene got heavier), left alone half a minute, so that the way
    // back is not climbed while the heavy scene lasts and is quick once it has passed.
    const BAD0 = 30000, BADMAX = 480000, EX0 = 60000, EXMAX = 960000;
    // Resolution that buys nothing is given back (flat). A frame that is slow for its draw calls and its triangles,
    // as a phone's is in a dense city, takes as long at 0.6 as at 0.8: there the governor used to sit at its floor,
    // blurred, for no frame gained. So the frame time at `mid` with no extras left (e0) is kept, and when the floor
    // has been held three seconds for less than 15% off it, the scale goes back to `mid` and from there up a step
    // every four seconds for as long as the frame stays within 8% of its time at the floor (flatBase; flatTop: the
    // step that went over). Frames that fit again end it, and the ordinary way up takes over; the scale it reached
    // stays the floor for two minutes (kept), so that the next slow stretch does not pay the floor to learn it again.
    let flat = false, e0 = 0, flatBase = 0, flatTry = 0, flatTop = Infinity, kept = 0, keptAt = 0;
    let clock = 0, fullT = 0, top = Infinity, topAt = 0, topWait = BAD0, bad = Infinity, badAt = 0, rose = false, roseAt = 0, exBad = Infinity, exAt = 0, exWait = EX0;
    const failed = level => {
      if (rose && clock - roseAt < topWait) { topWait = top !== Infinity && clock - topAt < 4 * topWait ? Math.min(BADMAX, topWait * 2) : BAD0; top = level; topAt = clock; }
      else { bad = level; badAt = clock; }
      rose = false;
    };
    const held = next => (next >= top - 1e-6 && clock - topAt < topWait) || (next >= bad - 1e-6 && clock - badAt < BAD0);
    const exFailed = level => { exWait = level === exBad && clock - exAt < 4 * exWait ? Math.min(EXMAX, exWait * 2) : EX0; exBad = level; exAt = clock; top = bad = Infinity; rose = false; };
    const rungs = [];
    const valueOf = r => r.values[g.extras >= 1 ? 0 : g.extras > 0 ? 1 : 2];
    const apply = r => { const v = valueOf(r); if (v !== r.v) { r.v = v; try { r.fn(v); } catch (e) { console.warn(`governor: ${r.name}`, e); } } };
    const g = {
      scale: Math.min(1, max), extras: 1, min, mid, max, cap, auto,
      get frameMs() { return ema; },
      get refreshMs() { return refresh; },
      // the frame time aimed at: the cap's interval or the display's, whichever is longer; twice the display's where that cannot be met
      get targetMs() { const t = Math.max(g.cap > 0 ? 1000 / g.cap : 0, refresh || 1000 / 60); return halved ? Math.max(t, 2 * (refresh || 1000 / 60)) : t; },
      on(fn) { subs.push(fn); return g; },
      // a system's rung on the ladder: its value with every extra, at half of them and with none (see above)
      rung(name, values, fn) { const r = { name, values, fn, v: undefined }; rungs.push(r); apply(r); return g; },
      // a rung's values changed (the view was resized): each rung's value for the extras as they stand, again
      reapply() { for (const r of rungs) apply(r); return g; },
      // what each rung holds now, for the telemetry and the checks: { name: value }
      get ladder() { const o = {}; for (const r of rungs) o[r.name] = r.v; return o; },
      // a device with no record of its own: low first, then up as fast as the frames allow (see above)
      startLow() { change(Math.max(g.min, Math.min(g.mid, g.max)), 0.5); climbing = true; wait = 1500; },
      // a device with a record: it starts there, settled (the step above it, and the extras above its own, wait their turn)
      resume(scale, extras) { change(scale, extras); top = g.scale < g.max - 1e-6 ? g.scale + STEP : Infinity; topAt = clock; topWait = BAD0; exBad = g.extras < 1 ? g.extras + 0.5 : Infinity; exAt = clock; exWait = EX0; },
      // the step and the extras the frames last did not fit at, and the seconds until each may be tried again (for the checks and the telemetry)
      get settled() { return { top: top === Infinity ? null : +top.toFixed(2), wait: top === Infinity ? 0 : Math.max(0, Math.round((topWait - (clock - topAt)) / 1000)), extras: exBad === Infinity ? null : exBad, extrasWait: exBad === Infinity ? 0 : Math.max(0, Math.round((exWait - (clock - exAt)) / 1000)) }; },
      get climbing() { return climbing; },
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
      reset() { last = 0; ema = 0; since = calm = floorT = 0; flat = false; e0 = flatTry = kept = 0; flatTop = Infinity; },
      get flat() { return flat; },
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
      if (ex) for (const r of rungs) apply(r);
      if (moved) for (const fn of subs) fn(g.extras, g.scale, ex);
    }
    function decide(ms) {
      since += ms; clock += ms;
      const target = g.targetMs, load = ema / target;
      // at half the display's rate, frames that come at its full rate again say the scene has lightened: full rate
      // is the aim again at once, with no step to see (before, half rate stayed while the resolution climbed to
      // its ceiling under it, and a heavy half minute left a device at thirty frames a second for good)
      if (halved && ema < 0.7 * target) { fullT += ms; if (fullT > 2000) { halved = false; fullT = 0; calm = 0; return; } } else fullT = 0;
      if (since < 1000) return; // (a change settles into the average first)
      if (load > 1.15) {
        calm = 0;
        if (tried && since < 4000) { // the try up did not fit (2: it was the extras')
          if (climbing) { climbing = false; wait = 4000; }
          wait = Math.min(64000, wait * 2);
          const ex = tried === 2; tried = 0;
          if (ex) exFailed(g.extras); else { rose = true; failed(g.scale); }
          change(ex ? g.scale : g.scale - STEP, ex ? g.extras - 0.5 : g.extras);
          return;
        }
        tried = 0;
        const want = Math.max(0.85, Math.min(0.95, Math.sqrt(1 / load))); // (pixels go with the square of the scale)
        const midFloor = Math.max(g.min, Math.min(g.mid, g.max));
        if (flat) { // (see above: the pixels are not what these frames cost)
          if (flatTry) { const worse = ema > 1.08 * flatBase; flatTry = 0; if (worse) { flatTop = g.scale; change(g.scale - STEP, g.extras); return; } }
          if (since >= 4000 && g.scale + STEP <= g.max + 1e-6 && g.scale + STEP < flatTop - 1e-6) { flatTry = 1; change(g.scale + STEP, g.extras); return; }
        }
        const keep = kept && clock - keptAt < 120000 ? Math.min(kept, g.max) : 0;
        const floor = flat ? g.scale : Math.max(keep, g.extras > 0 ? midFloor : g.min);
        if (g.scale > floor + 1e-6) {
          floorT = 0; if (climbing) { climbing = false; wait = 4000; }
          if (g.extras <= 0 && Math.abs(g.scale - midFloor) < 1e-6) e0 = ema;
          failed(g.scale); change(Math.max(floor, Math.min(g.scale - STEP, g.scale * want)), g.extras); return;
        }
        floorT += ms;
        if (floorT < 3000) return;
        floorT = 0;
        // (e0 unknown: a device that opened at the floor, from its record. It is asked a step up in the same way)
        if (!flat && g.extras <= 0 && g.min < midFloor - 1e-6 && g.scale <= g.min + 1e-6 && (!e0 || ema > 0.85 * e0)) { flat = true; flatBase = ema; flatTop = Infinity; flatTry = 0; top = bad = Infinity; if (e0) change(midFloor, g.extras); else since = 4000; return; }
        if (!halved && (flat || g.scale <= g.min + 1e-6 || (g.extras <= 0 && g.scale <= keep + 1e-6)) && load < 1.9) { halved = true; wait = 4000; return; } // half the display's rate, evenly
        if (g.extras > 0) { exFailed(g.extras); change(g.scale, g.extras - 0.5); }
        return;
      }
      floorT = 0;
      if (load > 1.04) { calm = 0; return; } // on the edge: hold
      if (flat) { kept = g.scale; keptAt = clock; }
      if (flat || e0) { flat = false; e0 = flatTry = 0; flatTop = Infinity; } // (frames that fit: the ordinary way up from here)
      calm += ms;
      if (tried && since >= 4000) tried = 0; // the try up held
      if (calm < wait) return;
      calm = 0;
      if (g.scale < g.max - 1e-6) {
        if (held(g.scale + STEP)) return; // (the step that did not fit: not yet)
        tried = 1; rose = true; roseAt = clock; change(g.scale + STEP, g.extras);
      } else if (g.extras < 1 && since >= (climbing ? 3000 : 20000)) {
        if (g.extras + 0.5 >= exBad && clock - exAt < exWait) return;
        tried = 2; top = bad = Infinity; rose = false; change(g.scale, g.extras + 0.5);
      }
      else if (climbing && g.extras >= 1) { climbing = false; wait = 4000; }
      else if (halved && since >= 30000) { halved = false; }
    }
    return g;
  }
  // ---- texture units
  // A fragment shader may read as many textures as the device has units for: WebGL2 promises 16, an Apple GPU gives
  // exactly 16 and a software renderer 32 or more. A program with one sampler too many does not link, and what it
  // was to draw is missing, with nothing said (issue 485: the ground of every live map on every Mac and iPhone,
  // through which the sky showed). So a material that many patches add samplers to is fitted last of all: counted,
  // and while it is over the device's units it goes without what it can do without, in this order.
  //   ?units=16 plays as a device with that many (never more than the device has): how a software renderer checks it.
  const UNIT_DROPS = [
    { sampler: 'uFloorMap', unset: 'FLOOR_MAP' },   // a wood's own floor map: the city's floor is drawn there instead (world.js)
    { sampler: 'uOeTrail', set: 'OE_NO_TRAIL' },    // the tracks trodden in snow (weather.js)
    { sampler: 'uOeOcc', set: 'OE_NO_OCC' },        // what stands over the ground in the rain: it is wet under cover too (weather.js)
  ];
  function units() {
    const dev = probe().units || 16, q = +(new URLSearchParams(location.search).get('units') || 0);
    return q >= 8 ? Math.min(q, dev) : dev;
  }
  // the samplers three.js itself gives a program, from the parameters it hands onBeforeCompile
  const OWN_MAPS = ['map', 'matcap', 'envMap', 'lightMap', 'aoMap', 'bumpMap', 'normalMap', 'displacementMap', 'emissiveMap', 'metalnessMap', 'roughnessMap', 'anisotropyMap', 'clearcoatMap', 'clearcoatNormalMap',
    'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'alphaMap', 'gradientMap'];
  function ownUnits(sh) {
    let n = 1; // (the DFG table of a standard material)
    for (const k of OWN_MAPS) if (sh[k]) n++;
    n += (sh.numDirLightShadows || 0) + (sh.numPointLightShadows || 0) + (sh.numSpotLightShadows || 0) + (sh.numSpotLightMaps || 0);
    if (sh.numRectAreaLights > 0) n += 2; // (the two tables an area light is worked out with)
    if (sh.transmission) n++;
    return n;
  }
  // the samplers the patches declared in a fragment shader, less the ones its defines leave out
  function patchUnits(sh) {
    const defs = sh.defines || {}, names = new Map();
    for (const m of sh.fragmentShader.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?[iu]?sampler\w+\s+([^;]+);/g))
      for (const d of m[1].split(',')) { const a = /^\s*(\w+)\s*(?:\[\s*(\d+)\s*\])?/.exec(d); if (a && /^u[A-Z]/.test(a[1])) names.set(a[1], +(a[2] || 1)); } // (the patches' own are uName; three.js's, declared under its #ifdefs, are counted by ownUnits)
    for (const d of UNIT_DROPS) if (d.unset ? !(d.unset in defs) : d.set in defs) names.delete(d.sampler);
    return names;
  }
  // call it at the end of a material's onBeforeCompile; left: the units to keep free (a patch still to come). Returns what
  // was left out, and .over when there is still no room.
  function fitUnits(sh, left = 0) {
    const max = units() - left, out = [];
    let names = patchUnits(sh), n = ownUnits(sh) + [...names.values()].reduce((a, b) => a + b, 0);
    for (const d of UNIT_DROPS) {
      if (n <= max) break;
      if (!names.has(d.sampler)) continue;
      const defs = Object.assign({}, sh.defines);
      if (d.unset) delete defs[d.unset]; else defs[d.set] = '';
      sh.defines = defs;
      n -= names.get(d.sampler); names.delete(d.sampler); out.push(d.sampler);
    }
    if (n > max && !fitUnits.said) { fitUnits.said = true; console.warn(`A shader wants ${n} texture units and this device has ${units()}: ${[...names.keys()].join(' ')}`); }
    (fitUnits.log || (fitUnits.log = [])).push({ own: ownUnits(sh), maps: OWN_MAPS.filter(k => sh[k]), shadows: [sh.numDirLightShadows, sh.numPointLightShadows, sh.numSpotLightShadows, sh.numSpotLightMaps], area: sh.numRectAreaLights, left, n, out: out.slice(), kept: [...names.keys()] }); if (fitUnits.log.length > 12) fitUnits.log.shift(); // (what was decided, for a probe to read)
    out.over = n > max; // (still too many: the caller's own patch, if it is to come, stays out)
    return out;
  }

  return { probe, auto, tier, override, setOverride, below, pixelRatio, gpuBytes, city, lean, died, sinceDeath, level, held, governor, units, fitUnits, TIERS, ORDER, NAMES };
})();
