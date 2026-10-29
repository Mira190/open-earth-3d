// Sound, synthesised with Web Audio (no audio files): harbour ambience, footsteps,
// the helicopter rotor, the ferry engine and horn, and dialogue voice beeps with a
// pitch per character. Browsers allow sound only after a click, so start() is called
// from the Play button.
'use strict';
window.OEAudio = (function () {
  let ctx = null, master = null, noise = null, muted = false;
  const ch = {};
  function noiseSource() {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start();
    return s;
  }
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // harbour and city: low rumble with slow swells
    const amb = noiseSource(), lp = ctx.createBiquadFilter(), ag = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 380; ag.gain.value = 0.05;
    lfo.frequency.value = 0.13; lg.gain.value = 0.025; lfo.connect(lg); lg.connect(ag.gain); lfo.start();
    amb.connect(lp); lp.connect(ag); ag.connect(master);
    ch.amb = ag;
    // rotor: band-passed noise chopped at the blade-pass rate
    const rn = noiseSource(), bp = ctx.createBiquadFilter(), rg = ctx.createGain(), chop = ctx.createOscillator(), cg = ctx.createGain(), rv = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 140; bp.Q.value = 0.8;
    chop.type = 'square'; chop.frequency.value = 0.01; cg.gain.value = 0.5; rg.gain.value = 0.5; rv.gain.value = 0;
    chop.connect(cg); cg.connect(rg.gain); chop.start();
    rn.connect(bp); bp.connect(rg); rg.connect(rv); rv.connect(master);
    ch.rotor = { vol: rv, chop };
    // ferry engine: a low saw hum
    const eo = ctx.createOscillator(), el = ctx.createBiquadFilter(), eg = ctx.createGain();
    eo.type = 'sawtooth'; eo.frequency.value = 48; el.type = 'lowpass'; el.frequency.value = 160; eg.gain.value = 0;
    eo.connect(el); el.connect(eg); eg.connect(master); eo.start();
    ch.engine = { vol: eg, osc: eo };
    // wind at height and speed
    const wn = noiseSource(), wl = ctx.createBiquadFilter(), wg = ctx.createGain();
    wl.type = 'bandpass'; wl.frequency.value = 900; wl.Q.value = 0.4; wg.gain.value = 0;
    wn.connect(wl); wl.connect(wg); wg.connect(master);
    ch.wind = wg;
  }
  const ramp = (p, v, t = 0.25) => { if (ctx) p.setTargetAtTime(v, ctx.currentTime, t); };
  function rotor(spin, load = 0) {
    if (!ctx) return;
    ramp(ch.rotor.vol.gain, spin * (0.22 + 0.12 * load));
    ramp(ch.rotor.chop.frequency, 4 + spin * 16, 0.4);
  }
  function engine(level) { if (ctx) { ramp(ch.engine.vol.gain, level * 0.09); ramp(ch.engine.osc.frequency, 42 + level * 18, 0.6); } }
  function wind(level) { if (ctx) ramp(ch.wind.gain, Math.min(0.12, level * 0.12)); }
  function blip(freq, dur, type = 'square', vol = 0.05) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function beep(pitch) { blip(pitch * (0.92 + Math.random() * 0.16), 0.045, 'square', 0.035); }
  function step() {
    if (!ctx || muted) return;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.08);
  }
  function horn() { blip(196, 1.3, 'sawtooth', 0.06); blip(247, 1.3, 'sawtooth', 0.04); }
  function chime() { [660, 880, 1320].forEach((f, i) => setTimeout(() => blip(f, 0.35, 'sine', 0.07), i * 110)); }
  // a tram's foot gong, struck twice ("ding ding")
  function bell() { [0, 320].forEach(d => setTimeout(() => { blip(1180, 0.8, 'sine', 0.06); blip(2840, 0.45, 'sine', 0.02); }, d)); }
  function setMuted(m) { muted = m; if (master) ramp(master.gain, m ? 0 : 0.55, 0.05); }
  function stop() { if (ctx) { ctx.close(); ctx = null; } }
  return { start, rotor, engine, wind, beep, step, horn, chime, bell, setMuted, stop, get muted() { return muted; } };
})();
