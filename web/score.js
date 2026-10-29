// The title screen's sound, synthesised with Web Audio (no audio files), cut like a trailer:
// a low drone under the night pass, a riser into the sunrise, a hit with a sub drop on the
// title card, then a slow pad under the menu. The menu ticks, the dive is a whoosh.
// Everything runs through a generated reverb, a "space" that is longer than any room.
// Browsers allow sound only after a click or a key, so start() is called from the Enter button.
'use strict';
window.OEScore = (function () {
  let ctx = null, master = null, bus = null, verb = null, noise = null, muted = false;
  const live = [];
  const now = () => (ctx ? ctx.currentTime : 0);

  function impulse(seconds, decay) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }
  function start(withSound = true) {
    muted = !withSound;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); setMuted(muted); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    build(new AC());
    return true;
  }
  function build(c) {
    ctx = c;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4;
    master.connect(comp); comp.connect(ctx.destination);
    bus = ctx.createGain(); bus.connect(master);
    verb = ctx.createConvolver(); verb.buffer = impulse(4.5, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    verb.connect(wet); wet.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // the score rendered offline, for a preview film: fn(t0) schedules it; returns the two channels
  async function bounce(seconds, fn, rate = 48000) {
    const saved = { ctx, master, bus, verb, noise, muted, droneV, padV, live: live.splice(0) };
    const off = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    muted = false; droneV = null; padV = null;
    build(off);
    fn(0);
    const buf = await off.startRendering();
    ({ ctx, master, bus, verb, noise, muted, droneV, padV } = saved);
    live.splice(0, live.length, ...saved.live);
    return [buf.getChannelData(0), buf.getChannelData(1)];
  }
  function setMuted(m) {
    muted = m;
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.15);
  }
  // a voice: a source into a gain, sent dry and to the reverb
  function voice(src, { gain = 0.1, send = 0.4, at = now() } = {}) {
    const g = ctx.createGain(), s = ctx.createGain();
    g.gain.value = 0; s.gain.value = send;
    src.connect(g); g.connect(bus); g.connect(s); s.connect(verb);
    return { g: g.gain, src, out: g, at, peak: gain };
  }
  function osc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); live.push(o); return o; }
  function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); live.push(s); return s; }
  const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // the bed under the night pass: two low tones beating slowly, and a breath of filtered noise
  let droneV = null;
  function drone(fadeIn = 3) {
    if (!ctx || droneV) return;
    const mix = ctx.createGain(), lp = filter('lowpass', 260, 0.9);
    for (const [f, type, v] of [[55, 'sine', 0.55], [55.35, 'sine', 0.45], [110.2, 'sawtooth', 0.05], [82.4, 'triangle', 0.12]]) {
      const o = osc(type, f), g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(mix);
    }
    const n = noiseSrc(), bp = filter('bandpass', 420, 0.6), ng = ctx.createGain(); ng.gain.value = 0.18;
    n.connect(bp); bp.connect(ng); ng.connect(mix);
    const lfo = osc('sine', 0.07), lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency);
    mix.connect(lp);
    droneV = voice(lp, { send: 0.5 });
    droneV.g.setValueAtTime(0, now());
    droneV.g.linearRampToValueAtTime(0.45, now() + fadeIn);
  }
  // a riser of `dur` seconds ending at time t: noise sweeping up, a tone climbing under it
  function riser(t, dur) {
    if (!ctx) return;
    const t0 = Math.max(now(), t - dur);
    const n = noiseSrc(), bp = filter('bandpass', 300, 5);
    bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(7000, t);
    n.connect(bp);
    const v = voice(bp, { send: 0.6 });
    v.g.setValueAtTime(0.0001, t0); v.g.exponentialRampToValueAtTime(0.5, t - 0.02); v.g.linearRampToValueAtTime(0, t + 0.04);
    const o = osc('sawtooth', 90), lp = filter('lowpass', 900, 2);
    o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(420, t);
    o.connect(lp);
    const v2 = voice(lp, { send: 0.5 });
    v2.g.setValueAtTime(0.0001, t0); v2.g.exponentialRampToValueAtTime(0.09, t - 0.02); v2.g.linearRampToValueAtTime(0, t + 0.03);
  }
  // the hit at time t: a sub that drops, a crack of noise, and a bright chord left ringing
  function hit(t) {
    if (!ctx) return;
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(92, t); sub.frequency.exponentialRampToValueAtTime(30, t + 1.4);
    sub.start(t); sub.stop(t + 5);
    const vs = voice(sub, { send: 0.15 });
    vs.g.setValueAtTime(0, t); vs.g.linearRampToValueAtTime(1.0, t + 0.01); vs.g.exponentialRampToValueAtTime(0.0001, t + 4.5);
    const n = ctx.createBufferSource(); n.buffer = noise; n.start(t); n.stop(t + 1.5);
    const lp = filter('lowpass', 2600, 0.5); lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.9);
    n.connect(lp);
    const vn = voice(lp, { send: 0.9 });
    vn.g.setValueAtTime(0, t); vn.g.linearRampToValueAtTime(0.55, t + 0.005); vn.g.exponentialRampToValueAtTime(0.0001, t + 1.2);
    // A major with an added ninth, spread wide: the sunrise
    for (const [f, a] of [[110, 0.12], [164.8, 0.09], [220, 0.08], [277.2, 0.06], [329.6, 0.05], [493.9, 0.035], [659.3, 0.025], [987.8, 0.012]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 8;
      o.start(t); o.stop(t + 9);
      const v = voice(o, { send: 0.85 });
      v.g.setValueAtTime(0, t); v.g.linearRampToValueAtTime(a, t + 0.04); v.g.exponentialRampToValueAtTime(a * 0.35, t + 2.5); v.g.exponentialRampToValueAtTime(0.0001, t + 8.5);
    }
    if (droneV) { droneV.g.cancelScheduledValues(t); droneV.g.setValueAtTime(0.45, t); droneV.g.linearRampToValueAtTime(0.14, t + 4); }
    pad(t + 2.2);
  }
  // the menu's bed: a slow chord with its filter breathing
  let padV = null;
  function pad(t = now()) {
    if (!ctx || padV) return;
    const mix = ctx.createGain(), lp = filter('lowpass', 900, 0.8);
    for (const [f, v] of [[110, 0.3], [164.8, 0.22], [246.9, 0.16], [329.6, 0.12], [440.0, 0.06]]) {
      for (const det of [-6, 6]) {
        const o = osc('sawtooth', f); o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = v * 0.5; o.connect(g); g.connect(mix);
      }
    }
    const lfo = osc('sine', 0.05), lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg); lg.connect(lp.frequency);
    mix.connect(lp);
    padV = voice(lp, { send: 0.8 });
    padV.g.setValueAtTime(0, t); padV.g.linearRampToValueAtTime(0.045, t + 6);
  }
  // an interface tick, a confirm, and the whoosh of the dive
  function tick(f = 2400, vol = 0.05) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const t = now(); o.start(t); o.stop(t + 0.08);
    const v = voice(o, { send: 0.3 });
    v.g.setValueAtTime(0, t); v.g.linearRampToValueAtTime(vol, t + 0.004); v.g.exponentialRampToValueAtTime(0.0001, t + 0.07);
  }
  function confirm() { tick(1318.5, 0.06); setTimeout(() => tick(1975.5, 0.05), 70); }
  function whoosh(dur = 1.6) {
    if (!ctx) return;
    const t = now();
    const n = noiseSrc(), bp = filter('bandpass', 400, 1.6);
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    n.connect(bp);
    const v = voice(bp, { send: 0.5 });
    v.g.setValueAtTime(0.0001, t); v.g.exponentialRampToValueAtTime(0.45, t + dur * 0.92); v.g.linearRampToValueAtTime(0, t + dur + 0.25);
    const o = osc('sine', 45); o.frequency.setValueAtTime(40, t); o.frequency.exponentialRampToValueAtTime(110, t + dur);
    const v2 = voice(o, { send: 0.1 });
    v2.g.setValueAtTime(0, t); v2.g.linearRampToValueAtTime(0.5, t + dur); v2.g.linearRampToValueAtTime(0, t + dur + 0.3);
  }
  // fade everything out and close the context
  function stop(fade = 0.6) {
    if (!ctx) return;
    const c = ctx;
    master.gain.setTargetAtTime(0, now(), fade / 3);
    setTimeout(() => { for (const s of live) { try { s.stop(); } catch (e) { /* already stopped */ } } c.close(); }, fade * 1000 + 200);
    ctx = null; droneV = null; padV = null; live.length = 0;
  }
  return { start, setMuted, drone, riser, hit, pad, tick, confirm, whoosh, stop, now, bounce,
    get on() { return !!ctx && !muted; }, get muted() { return muted; } };
})();
