// The city film's score, synthesised offline in the page (no audio files), in the title
// screen's voice: the same low drone, riser and hit, then a city's own motif over a slow pad.
//   cold open  the drone and the city's air (filtered noise: harbour, wind, traffic far off)
//   title      a riser into the hit, a sub drop and a wide chord on the city's root
//   highlights a pad on the city's chords, a soft pulse, and a note of the motif on each cut
//   finale     a second, quieter hit as the lights come on; the chord rings out under the end card
// plan: { duration, title, finale, cuts: [s], root (MIDI), scale: [semitones], chords: [[degrees]],
//         tempo, voice: 'bell' | 'pluck' | 'koto', air: 'harbour' | 'city' | 'wind' }
'use strict';
window.OEFilmScore = (function () {
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  async function render(plan, rate = 48000) {
    const D = plan.duration + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(D * rate), rate);
    // a fixed seed, so a film re-renders to the same sound
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const master = ctx.createGain(); master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4;
    master.connect(comp); comp.connect(ctx.destination);
    const verb = ctx.createConvolver();
    { const n = Math.floor(rate * 5), b = ctx.createBuffer(2, n, rate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, 2.8); }
      verb.buffer = b; }
    const wet = ctx.createGain(); wet.gain.value = 0.5; verb.connect(wet); wet.connect(master);
    const noise = ctx.createBuffer(1, rate * 3, rate);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
    const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    function voice(src, send = 0.4, pan = 0) {
      const g = ctx.createGain(), s = ctx.createGain(), p = ctx.createStereoPanner();
      g.gain.value = 0; s.gain.value = send; p.pan.value = pan;
      src.connect(g); g.connect(p); p.connect(master); g.connect(s); s.connect(verb);
      return g.gain;
    }
    const osc = (type, f, t0, t1) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(t1); return o; };
    const noiseSrc = (t0, t1) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t0); s.stop(t1); return s; };
    const env = (g, t0, a, peak, t1, r) => { g.setValueAtTime(0, t0); g.linearRampToValueAtTime(peak, t0 + a); g.setValueAtTime(peak, Math.max(t0 + a, t1 - r)); g.linearRampToValueAtTime(0, t1); };

    const root = plan.root || 50, scale = plan.scale || [0, 2, 4, 7, 9];
    const deg = (d, oct = 0) => root + scale[((d % scale.length) + scale.length) % scale.length] + 12 * (oct + Math.floor(d / scale.length));
    const T = plan.title, F = plan.finale, end = plan.duration;

    // the drone, from the black to the title, then down under the rest
    { const mix = ctx.createGain(), lp = filter('lowpass', 240, 0.9);
      for (const [m, type, v] of [[root - 24, 'sine', 0.5], [root - 24 + 0.06, 'sine', 0.42], [root - 12, 'sawtooth', 0.04], [root - 17, 'triangle', 0.1]]) {
        const o = osc(type, hz(m), 0, D), g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(mix);
      }
      const l = osc('sine', 0.07, 0, D), lg = ctx.createGain(); lg.gain.value = 90; l.connect(lg); lg.connect(lp.frequency);
      mix.connect(lp);
      const g = voice(lp, 0.5);
      g.setValueAtTime(0, 0); g.linearRampToValueAtTime(0.42, 2.5); g.setValueAtTime(0.42, T); g.linearRampToValueAtTime(0.12, T + 4);
      g.setValueAtTime(0.12, end - 3); g.linearRampToValueAtTime(0, end + 1.5); }

    // the city's air: a bed of filtered noise
    { const air = plan.air || 'city', n = noiseSrc(0, D);
      const bp = filter(air === 'wind' ? 'bandpass' : 'lowpass', air === 'harbour' ? 700 : air === 'wind' ? 500 : 380, air === 'wind' ? 0.4 : 0.6);
      const l = osc('sine', air === 'harbour' ? 0.11 : 0.05, 0, D), lg = ctx.createGain(); lg.gain.value = air === 'harbour' ? 300 : 120; l.connect(lg); lg.connect(bp.frequency);
      n.connect(bp);
      const g = voice(bp, 0.3);
      g.setValueAtTime(0, 0); g.linearRampToValueAtTime(0.16, 1.5); g.setValueAtTime(0.16, end - 2); g.linearRampToValueAtTime(0, end + 1); }

    // the riser into the title, and the hit
    function riser(t, dur) {
      const t0 = Math.max(0, t - dur), n = noiseSrc(t0, t + 0.1), bp = filter('bandpass', 300, 5);
      bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(7000, t);
      n.connect(bp);
      const g = voice(bp, 0.6); g.setValueAtTime(0.0001, t0); g.exponentialRampToValueAtTime(0.42, t - 0.02); g.linearRampToValueAtTime(0, t + 0.04);
      const o = osc('sawtooth', 70, t0, t + 0.1), lp = filter('lowpass', 900, 2);
      o.frequency.setValueAtTime(hz(root - 24), t0); o.frequency.exponentialRampToValueAtTime(hz(root + 7), t);
      o.connect(lp);
      const g2 = voice(lp, 0.5); g2.setValueAtTime(0.0001, t0); g2.exponentialRampToValueAtTime(0.08, t - 0.02); g2.linearRampToValueAtTime(0, t + 0.03);
    }
    function hit(t, chord, level = 1) {
      const sub = osc('sine', 92, t, t + 5);
      sub.frequency.setValueAtTime(hz(root - 12) * 1.4, t); sub.frequency.exponentialRampToValueAtTime(hz(root - 24) * 0.55, t + 1.4);
      const gs = voice(sub, 0.15); gs.setValueAtTime(0, t); gs.linearRampToValueAtTime(0.9 * level, t + 0.01); gs.exponentialRampToValueAtTime(0.0001, t + 4.5);
      const n = noiseSrc(t, t + 1.5), lp = filter('lowpass', 2600, 0.5);
      lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.9);
      n.connect(lp);
      const gn = voice(lp, 0.9); gn.setValueAtTime(0, t); gn.linearRampToValueAtTime(0.45 * level, t + 0.005); gn.exponentialRampToValueAtTime(0.0001, t + 1.2);
      chord.forEach((m, i) => {
        const o = osc('sine', hz(m), t, t + 9); o.detune.value = (rnd() - 0.5) * 8;
        const a = (0.11 - i * 0.012) * level;
        const g = voice(o, 0.85, (i % 2 ? 1 : -1) * Math.min(0.6, i * 0.12));
        g.setValueAtTime(0, t); g.linearRampToValueAtTime(a, t + 0.04); g.exponentialRampToValueAtTime(a * 0.35, t + 2.5); g.exponentialRampToValueAtTime(0.0001, t + 8.5);
      });
    }
    const chordAt = (degs, oct = 0) => degs.map(d => deg(d, oct));
    const chords = plan.chords || [[0, 2, 4], [3, 5, 7], [1, 3, 5], [4, 6, 8]];
    riser(T, 3.4);
    hit(T + 0.03, [root - 12, root - 5, root, root + 7, deg(2, 1), deg(4, 1), deg(1, 2), deg(4, 2)]);

    // the pad: the city's chords changing at the cuts after the title
    const cuts = plan.cuts.filter(c => c > T + 0.5 && c < end - 0.5);
    const marks = [T + 1.5, ...cuts, end + 1.5];
    for (let i = 0; i < marks.length - 1; i++) {
      const t0 = marks[i], t1 = marks[i + 1] + 1.2, c = chords[i % chords.length];
      const mix = ctx.createGain(), lp = filter('lowpass', 1000, 0.8);
      for (const m of chordAt(c, -1)) for (const det of [-7, 7]) { const o = osc('sawtooth', hz(m), t0, t1 + 0.1); o.detune.value = det; const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(mix); }
      const l = osc('sine', 0.08, t0, t1), lg = ctx.createGain(); lg.gain.value = 420; l.connect(lg); lg.connect(lp.frequency);
      mix.connect(lp);
      const g = voice(lp, 0.8);
      const peak = t0 > F ? 0.03 : 0.045;
      env(g, t0, i === 0 ? 3 : 1.2, peak, t1, 1.4);
    }

    // a soft pulse under the highlights, at the city's tempo
    { const beat = 60 / (plan.tempo || 76);
      for (let t = T + 2; t < F - 0.2; t += beat) {
        const o = osc('sine', hz(root - 24) * 1.5, t, t + 0.5); o.frequency.setValueAtTime(hz(root - 12), t); o.frequency.exponentialRampToValueAtTime(hz(root - 24), t + 0.25);
        const g = voice(o, 0.1); g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.18 * Math.min(1, (t - T - 2) / 4), t + 0.008); g.exponentialRampToValueAtTime(0.0001, t + 0.45);
      } }

    // the motif: a note on each cut, and a phrase over the longer shots
    function note(t, m, level = 1, pan = 0) {
      const v = plan.voice || 'bell';
      const partials = v === 'bell' ? [[1, 1], [2.76, 0.35], [5.4, 0.15], [8.93, 0.06]] : v === 'koto' ? [[1, 1], [2, 0.5], [3, 0.28], [4, 0.12]] : [[1, 1], [2, 0.3], [3, 0.12]];
      const dec = v === 'bell' ? 3.2 : v === 'koto' ? 1.6 : 1.1;
      partials.forEach(([r, a], i) => {
        const o = osc(v === 'koto' && i === 0 ? 'triangle' : 'sine', hz(m) * r, t, t + dec + 0.5);
        if (v === 'koto') { o.frequency.setValueAtTime(hz(m) * r * 1.012, t); o.frequency.exponentialRampToValueAtTime(hz(m) * r, t + 0.08); }
        const g = voice(o, 0.55, pan);
        const peak = 0.06 * a * level;
        g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + 0.004); g.exponentialRampToValueAtTime(0.0001, t + dec / (1 + i * 0.6));
      });
    }
    const motif = plan.motif || [4, 2, 0, 1, 2];
    cuts.forEach((c, i) => {
      if (c >= F - 0.1) return;
      note(c, deg(motif[i % motif.length], 1), 1, (i % 2 ? 0.25 : -0.25));
      // the answer, a beat and a half later
      note(c + 60 / (plan.tempo || 76) * 1.5, deg(motif[(i + 2) % motif.length], 1), 0.6, (i % 2 ? -0.3 : 0.3));
    });

    // the finale: a riser and a quieter hit as the lights come on, then the chord rings out
    riser(F, 2.4);
    hit(F + 0.03, [root - 12, root - 5, root, deg(2), deg(4), deg(1, 1), deg(2, 1), deg(4, 2)], 0.7);
    [0, 2, 4, 1].forEach((d, i) => note(F + 1.2 + i * 0.9, deg(d, 2), 0.5, [-0.4, 0.4, -0.2, 0.2][i]));

    const buf = await ctx.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  }
  return { render };
})();
