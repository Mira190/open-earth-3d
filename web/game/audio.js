// Sound, synthesised with Web Audio (no audio files): harbour ambience, footsteps,
// the helicopter rotor, the ferry engine and horn, a car's engine through its gears,
// its tyres in a slide and its horn, dialogue voice beeps with a pitch per character,
// little penguins braying in the dark and silver gulls; at a busy crossing the crowd's murmur, the
// screens' music, the walk signal's bird calls and the station's announcements. Browsers allow
// sound only after a click, so start() is called from the Play button.
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
    // a car's engine: two saws a fifth apart through a low-pass that opens with the throttle
    const co = ctx.createOscillator(), c2 = ctx.createOscillator(), cl = ctx.createBiquadFilter(), cv = ctx.createGain();
    co.type = c2.type = 'sawtooth'; co.frequency.value = 40; c2.frequency.value = 60; cl.type = 'lowpass'; cl.frequency.value = 300; cl.Q.value = 2; cv.gain.value = 0;
    co.connect(cl); c2.connect(cl); cl.connect(cv); cv.connect(master); co.start(); c2.start();
    ch.car = { vol: cv, a: co, b: c2, lp: cl };
    // tyres scrubbing sideways: band-passed noise
    const sn = noiseSource(), sb = ctx.createBiquadFilter(), sg = ctx.createGain();
    sb.type = 'bandpass'; sb.frequency.value = 1500; sb.Q.value = 6; sg.gain.value = 0;
    sn.connect(sb); sb.connect(sg); sg.connect(master);
    ch.skid = sg;
  }
  const ramp = (p, v, t = 0.25) => { if (ctx) p.setTargetAtTime(v, ctx.currentTime, t); };
  function rotor(spin, load = 0) {
    if (!ctx) return;
    ramp(ch.rotor.vol.gain, spin * (0.22 + 0.12 * load));
    ramp(ch.rotor.chop.frequency, 4 + spin * 16, 0.4);
  }
  function engine(level) { if (ctx) { ramp(ch.engine.vol.gain, level * 0.09); ramp(ch.engine.osc.frequency, 42 + level * 18, 0.6); } }
  function wind(level) { if (ctx) ramp(ch.wind.gain, Math.min(0.12, level * 0.12)); }
  // rpm 0..1 (idle to the red line), throttle 0..1, level 0..1 (0 off; lower from the back seat)
  function car(rpm, throttle = 0, level = 1) {
    if (!ctx) return;
    const f = 34 + rpm * 120;
    ramp(ch.car.vol.gain, level * (0.035 + 0.05 * throttle), 0.08);
    ramp(ch.car.a.frequency, f, 0.06); ramp(ch.car.b.frequency, f * 1.5, 0.06);
    ramp(ch.car.lp.frequency, 220 + 900 * throttle * rpm + 200 * rpm, 0.08);
  }
  function skid(level) { if (ctx) ramp(ch.skid.gain, Math.min(0.06, level * 0.06), 0.06); }
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
  function honk() { blip(415, 0.32, 'square', 0.045); blip(523, 0.32, 'square', 0.035); }
  function shutter() { // a focal-plane shutter: two short clicks
    if (!ctx || muted) return;
    for (const [at, f] of [[0, 3200], [0.06, 2400]]) {
      const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + at;
      s.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      s.connect(bp); bp.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.05);
    }
  }
  function thump() { // a rubber stamp on paper: a short low knock and a slap of noise
    if (!ctx || muted) return;
    blip(95, 0.18, 'sine', 0.22);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.14);
  }
  // a little penguin's bray: a run of nasal pulses, rising and falling; level 0..1 with distance
  function penguin(level = 1) {
    if (!ctx || muted || level <= 0) return;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime, n = 4 + Math.floor(Math.random() * 5), f0 = 700 + Math.random() * 300;
    o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
    g.gain.value = 0;
    for (let k = 0; k < n; k++) {
      const a = t + k * 0.16, up = k < n / 2;
      o.frequency.setValueAtTime(f0 * (up ? 1 + k * 0.08 : 1.3 - (k - n / 2) * 0.1), a);
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.05 * level, a + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.13);
    }
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + n * 0.16 + 0.05);
  }
  // a silver gull's call: a harsh, falling "kee-ar", sometimes two; level 0..1 with distance
  function gull(level = 1) {
    if (!ctx || muted || level <= 0) return;
    const t = ctx.currentTime, n = Math.random() < 0.4 ? 2 : 1, f0 = 1500 + Math.random() * 500;
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), a = t + k * 0.32;
      o.type = 'square'; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 2.5;
      o.frequency.setValueAtTime(f0, a); o.frequency.linearRampToValueAtTime(f0 * 1.15, a + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, a + 0.26);
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.045 * level, a + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.28);
      o.connect(f); f.connect(g); g.connect(master); o.start(a); o.stop(a + 0.3);
    }
  }
  function chime() { [660, 880, 1320].forEach((f, i) => setTimeout(() => blip(f, 0.35, 'sine', 0.07), i * 110)); }
  // a tram's foot gong, struck twice ("ding ding")
  function bell() { [0, 320].forEach(d => setTimeout(() => { blip(1180, 0.8, 'sine', 0.06); blip(2840, 0.45, 'sine', 0.02); }, d)); }
  // ---------------------------------------------------------------- a busy crossing (game.look.sound)
  // the crowd's murmur: noise through two voice bands, a little of it pulsing at a syllable's rate,
  // as a thousand people talking at once sound; level 0..1 with how many are round you
  let crowdBed = null, screenBed = null, beatAt = 0, chord = 0;
  function murmur(level) {
    if (!ctx) return;
    if (!crowdBed && level > 0) {
      const n = noiseSource(), a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain(), out = ctx.createGain();
      a.type = 'bandpass'; a.frequency.value = 420; a.Q.value = 0.9; b.type = 'bandpass'; b.frequency.value = 1150; b.Q.value = 1.4;
      am.frequency.value = 4.3; ag.gain.value = 0.25; g.gain.value = 0.75; am.connect(ag); ag.connect(g.gain); am.start();
      n.connect(a); n.connect(b); a.connect(g); b.connect(g); g.connect(out); out.gain.value = 0; out.connect(master);
      crowdBed = { out, am };
    }
    if (crowdBed) { ramp(crowdBed.out.gain, Math.min(1, level) * 0.11, 0.6); ramp(crowdBed.am.frequency, 3.6 + Math.random() * 1.6, 0.8); }
  }
  // the screens' sound: a pop song heard across the street, its kick and its chords through the
  // traffic's noise (muffled: little above 1 kHz carries); level 0..1 with distance
  function screens(level) {
    if (!ctx) return;
    if (!screenBed && level > 0) {
      const lp = ctx.createBiquadFilter(), out = ctx.createGain(), oscs = [];
      lp.type = 'lowpass'; lp.frequency.value = 950; lp.Q.value = 0.7; out.gain.value = 0;
      for (let i = 0; i < 3; i++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; g.gain.value = 0.18; o.connect(g); g.connect(lp); o.start(); oscs.push(o); }
      lp.connect(out); out.connect(master);
      screenBed = { out, oscs };
    }
    if (!screenBed) return;
    ramp(screenBed.out.gain, Math.min(1, level) * 0.05, 0.8);
    // the beat and the changes, scheduled a little ahead (122 bpm, a chord every bar)
    const t = ctx.currentTime, beat = 60 / 122;
    if (level > 0.02 && beatAt < t + 0.3) {
      if (beatAt < t) beatAt = t + 0.05;
      const CH = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 311.1]];
      for (let k = 0; k < 4; k++) {
        const at = beatAt + k * beat, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
        g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.5, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
        o.connect(g); g.connect(screenBed.out); o.start(at); o.stop(at + 0.25);
      }
      CH[chord % 4].forEach((f, i) => screenBed.oscs[i].frequency.setValueAtTime(f, beatAt));
      chord++; beatAt += 4 * beat;
    }
  }
  // Japan's walk signal for the blind (the standard of 2003): a bird's "piyo" from one kerb answered
  // by "piyo-piyo" from the other, or the cuckoo's "kakko" answered by "ka-kakko"; side 0 or 1
  function piyo(side = 0, level = 1) {
    if (!ctx || muted || level <= 0) return;
    const t = ctx.currentTime, n = side ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const a = t + k * 0.17, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(2900, a); o.frequency.exponentialRampToValueAtTime(2050, a + 0.11);
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.05 * level, a + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.13);
      o.connect(g); g.connect(master); o.start(a); o.stop(a + 0.15);
    }
  }
  function kakko(side = 0, level = 1) {
    if (!ctx || muted || level <= 0) return;
    const t = ctx.currentTime, notes = side ? [[0, 830], [0.12, 830], [0.32, 660]] : [[0, 830], [0.22, 660]];
    for (const [d, f] of notes) {
      const a = t + d, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.045 * level, a + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.2);
      o.connect(g); g.connect(master); o.start(a); o.stop(a + 0.22);
    }
  }
  // a station's announcement, carried from the concourse: its two-note chime, then a voice too far
  // off to make out (noise through moving vowel formants)
  function announce(level = 1) {
    if (!ctx || muted || level <= 0) return;
    const t = ctx.currentTime;
    [[0, 1046.5], [0.32, 784]].forEach(([d, f]) => { const o = ctx.createOscillator(), g = ctx.createGain(), a = t + d;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.05 * level, a + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.9);
      o.connect(g); g.connect(master); o.start(a); o.stop(a + 1); });
    const s = ctx.createBufferSource(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain(), a = t + 1.3, dur = 3.6;
    s.buffer = noise; s.loop = true; f1.type = 'bandpass'; f1.Q.value = 6; f2.type = 'bandpass'; f2.Q.value = 8;
    for (let k = 0; k < 18; k++) { const at = a + k * dur / 18; f1.frequency.setValueAtTime(350 + Math.random() * 500, at); f2.frequency.setValueAtTime(1000 + Math.random() * 1300, at); }
    g.gain.setValueAtTime(0.0001, a);
    for (let k = 0; k < 14; k++) { const at = a + k * dur / 14; g.gain.linearRampToValueAtTime((0.04 + Math.random() * 0.05) * level, at + 0.05); g.gain.linearRampToValueAtTime(0.008 * level, at + dur / 14); }
    g.gain.linearRampToValueAtTime(0.0001, a + dur);
    s.connect(f1); s.connect(f2); f1.connect(g); f2.connect(g); g.connect(master); s.start(a); s.stop(a + dur + 0.1);
  }
  function setMuted(m) { muted = m; if (master) ramp(master.gain, m ? 0 : 0.55, 0.05); }
  function stop() { if (ctx) { ctx.close(); ctx = null; } }
  return { start, murmur, screens, piyo, kakko, announce, rotor, engine, wind, car, skid, beep, step, horn, honk, chime, bell, thump, shutter, penguin, gull, setMuted, stop, get muted() { return muted; } };
})();
