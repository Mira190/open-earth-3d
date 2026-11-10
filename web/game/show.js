// Seats you can take, and what plays on a stage before one (game.json "seats" and "shows", from a city's
// landmark builder: the Sydney Opera House's stalls, its foyers' chairs and Bennelong's tables,
// cities/sydney/opera_inside.py).
//   seats: [{id, name, verb, at: [x, y, z], face: [dx, dy], eye, pitch, show}]: where you sit, which way the
//          seat faces, the height of your eyes over it, and the show it is a seat for
//   shows: [{id, venue, title, act, by, sung, stage: [x, y, z], singer, dim: [mesh names], bpm, a_hz, end_beat,
//          melody: [[midi, beat, beats, syllable]], bars: ['m' | 'M'], lines: [[from beat, to beat, sung, in English]]}]
// Seated, you look round with the mouse or a finger and stand up with E. In a seat with a show the house
// lights go down, the orchestra tunes, and the scene is sung: nothing is recorded. The voice is a source
// and filter synthesis in the browser (a sawtooth through five formant band-passes, the alto table of the
// Csound manual's appendix, with vibrato that comes in after a note's start, a glide between slurred notes
// and a breath of noise), over the cellos' ostinato, pizzicato strings and a tambourine, through a hall's
// reverberation made from decaying noise. The words show as surtitles, as the theatre's do.
'use strict';
window.OEShow = (function () {
  // alto formants (Csound manual, "Formant Values"): frequency Hz, level dB, bandwidth Hz for F1 to F5
  const FORMANTS = {
    a: [[800, 0, 80], [1150, -4, 90], [2800, -20, 120], [3500, -36, 130], [4950, -60, 140]],
    e: [[400, 0, 60], [1600, -24, 80], [2700, -30, 120], [3300, -35, 150], [4950, -60, 200]],
    i: [[350, 0, 50], [1700, -20, 100], [2700, -30, 120], [3700, -36, 150], [4950, -60, 200]],
    o: [[450, 0, 70], [800, -9, 80], [2830, -16, 100], [3500, -28, 130], [4950, -55, 135]],
    u: [[325, 0, 50], [700, -12, 60], [2530, -30, 170], [3500, -40, 180], [4950, -64, 200]],
  };
  // the vowel a French syllable is sung on: its last vowel sound, near enough for a formant voice
  function vowelOf(syl) {
    const s = syl.toLowerCase().replace(/[^a-zàâéèêëîïôûùœ~]/g, '');
    const m = s.match(/(ou|oi|au|eau|ai|ei|eu|œu|an|en|on|in|un|[aàâeéèêëiîïoôuûùy])(?!.*[aàâeéèêëiîïoôuûùy])/);
    const v = m ? m[1] : 'a';
    if (v === 'ou' || v === 'u' || v === 'û' || v === 'ù') return v === 'ou' ? 'u' : 'i';
    if (v === 'oi' || v === 'a' || v === 'à' || v === 'â' || v === 'an' || v === 'en') return 'a';
    if (v === 'au' || v === 'eau' || v === 'o' || v === 'ô' || v === 'on') return 'o';
    if (v === 'i' || v === 'î' || v === 'ï' || v === 'y') return 'i';
    return 'e';
  }
  const hz = (m, a) => a * Math.pow(2, (m - 69) / 12);

  // the performance as Web Audio nodes scheduled from t0 on ctx into out; returns { stop(), end: seconds }
  function perform(ctx, out, show, t0) {
    const spb = 60 / (show.bpm || 72), A4 = show.a_hz || 441, T = b => t0 + b * spb, nodes = [];
    const bus = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), rev = ctx.createConvolver();
    // the hall: 1.4 s of decaying noise, a little pre-delay
    const len = Math.floor(ctx.sampleRate * 1.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let s = 1234567 + c * 7919; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; const k = i / len; d[i] = i < ctx.sampleRate * 0.018 ? 0 : (s / 2147483648 - 1) * Math.pow(1 - k, 2.4) * 0.5; } }
    rev.buffer = ir; dry.gain.value = 0.8; wet.gain.value = 0.32;
    bus.connect(dry); bus.connect(rev); rev.connect(wet); dry.connect(out); wet.connect(out);
    const osc = (type, f, at, until) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(at); o.stop(until); nodes.push(o); return o; };
    const env = (g, at, a, peak, hold, r) => { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.setValueAtTime(peak, at + Math.max(a, hold)); g.gain.linearRampToValueAtTime(0, at + Math.max(a, hold) + r); };
    let noise = null;
    const noiseBuf = () => { if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noise; };
    const hiss = (at, dur, f, q, peak, a = 0.005) => { const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf(); s.loop = true; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; env(g, at, a, peak, dur * 0.4, dur * 0.6); s.connect(bp); bp.connect(g); g.connect(bus); s.start(at); s.stop(at + dur + 0.1); nodes.push(s); };
    // ---- the orchestra tunes to the oboe's A, and the house claps the conductor in
    const pre = t0 - 9.5;
    { const o = osc('sawtooth', A4, pre, pre + 4.2), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2; env(g, pre, 0.2, 0.05, 3.2, 0.8); o.connect(f); f.connect(g); g.connect(bus); }
    [[A4 / 2, 0.9], [A4 * 0.667, 1.3], [A4 / 4, 1.6], [A4, 1.9], [A4 * 1.5, 2.2]].forEach(([f, d], i) => { const o = osc('sawtooth', f * (1 + (i % 2 ? 0.004 : -0.003)), pre + d, pre + 4.4), lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 1100; env(g, pre + d, 0.5, 0.022, 1.6, 0.9); o.connect(lp); lp.connect(g); g.connect(bus); });
    const applause = (at, dur, peak) => { hiss(at, dur, 2400, 0.5, peak, 0.5); hiss(at + 0.1, dur, 5200, 0.7, peak * 0.6, 0.6); };
    applause(pre + 4.6, 3.6, 0.09);
    // ---- the cellos' ostinato, a bar at a time: D, A, F (or F sharp), A, plucked; the strings' chord on the beat
    const pluck = (m, at, dur, peak) => { const o = osc('triangle', hz(m, A4), at, at + dur + 0.3), o2 = osc('sawtooth', hz(m, A4), at, at + dur + 0.3), lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, at); lp.frequency.exponentialRampToValueAtTime(260, at + dur); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.012); g.gain.exponentialRampToValueAtTime(0.001, at + dur + 0.25); const g2 = ctx.createGain(); g2.gain.value = 0.35; o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus); };
    (show.bars || []).forEach((mode, k) => {
      const b = k * 2, third = mode === 'M' ? 54 : 53;
      pluck(38, T(b), 0.42, 0.2); pluck(45, T(b + 0.75), 0.2, 0.13); pluck(third, T(b + 1), 0.4, 0.14); pluck(45, T(b + 1.5), 0.38, 0.13);
      for (const m of mode === 'M' ? [62, 66, 69] : [62, 65, 69]) { pluck(m, T(b + 0.5), 0.16, 0.035); pluck(m, T(b + 1.5), 0.16, 0.03); }
      if (mode === 'M' && b >= 54) { hiss(T(b + 0.5), 0.09, 7000, 1.2, 0.03); hiss(T(b + 1.5), 0.09, 7000, 1.2, 0.024); } // the tambourine, in the refrain
    });
    // ---- the voice
    const notes = show.melody || [];
    if (notes.length) {
      const first = T(notes[0][1]), last = T(notes[notes.length - 1][1] + notes[notes.length - 1][2]) + 0.5;
      const src = osc('sawtooth', hz(notes[0][0], A4), first - 0.05, last), vib = osc('sine', 5.6, first - 0.05, last), vd = ctx.createGain(), amp = ctx.createGain(), tilt = ctx.createBiquadFilter();
      vd.gain.value = 0; vib.connect(vd); vd.connect(src.detune);
      tilt.type = 'lowpass'; tilt.frequency.value = 3800; tilt.Q.value = 0.3; // the glottal source's slope
      src.connect(tilt); amp.gain.value = 0;
      const bands = FORMANTS.a.map(() => { const bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; tilt.connect(bp); bp.connect(g); g.connect(amp); return { bp, g }; });
      const breath = ctx.createBufferSource(), bh = ctx.createBiquadFilter(), bg = ctx.createGain(); breath.buffer = noiseBuf(); breath.loop = true; bh.type = 'highpass'; bh.frequency.value = 2200; bg.gain.value = 0.012; breath.connect(bh); bh.connect(bg); bg.connect(amp); breath.start(first - 0.05); breath.stop(last); nodes.push(breath);
      const sing = ctx.createGain(); sing.gain.value = 2.6; amp.connect(sing); sing.connect(bus);
      // the singer's formant: a lift near 3 kHz, so that the voice carries over the pit
      const ring = ctx.createBiquadFilter(); ring.type = 'peaking'; ring.frequency.value = 2900; ring.Q.value = 2.5; ring.gain.value = 7; amp.disconnect(); amp.connect(ring); ring.connect(sing);
      const setVowel = (v, at) => FORMANTS[v].forEach(([f, db, bw], i) => { bands[i].bp.frequency.setTargetAtTime(f, at, 0.028); bands[i].bp.Q.setTargetAtTime(f / bw, at, 0.028); bands[i].g.gain.setTargetAtTime(Math.pow(10, db / 20), at, 0.028); });
      setVowel(vowelOf(notes[0][3]), first - 0.05);
      notes.forEach(([m, b, d, syl], k) => {
        const at = T(b), dur = d * spb, slur = syl === '-', next = notes[k + 1], tied = next && next[3] === '-' && Math.abs(next[1] - (b + d)) < 0.01;
        const f = hz(m, A4) * (1 + (((k * 7919) % 13) - 6) * 0.0006); // a few cents either way, never the same twice
        if (slur) src.frequency.setTargetAtTime(f, at, 0.03); else { src.frequency.setTargetAtTime(f, at - 0.012, 0.012); setVowel(vowelOf(syl), at); }
        // louder as it climbs; each syllable swells and eases, a slurred note carries on
        const peak = 0.5 + 0.3 * Math.max(0, Math.min(1, (m - 62) / 14));
        if (!slur) { amp.gain.setTargetAtTime(0.02, at - 0.03, 0.012); amp.gain.setTargetAtTime(peak, at, 0.03); }
        if (!tied) amp.gain.setTargetAtTime(dur > 0.7 ? peak * 0.75 : peak * 0.9, at + dur * 0.55, 0.12);
        if (!tied && (!next || next[1] - (b + d) > 0.2)) amp.gain.setTargetAtTime(0, at + dur - 0.05, 0.05);
        // vibrato: none at a note's start, in after a fifth of a second, deeper on a long one
        vd.gain.setTargetAtTime(dur > 0.3 ? 4 : 2, at, 0.02);
        if (dur > 0.32) vd.gain.setTargetAtTime(dur > 0.7 ? 46 : 28, at + 0.2, 0.12);
      });
      amp.gain.setTargetAtTime(0, last - 0.5, 0.06);
    }
    // ---- the last chord, and the house
    const end = T(show.end_beat || 71);
    for (const m of [38, 50, 57, 62, 66, 69, 74]) pluck(m, end, 0.9, 0.11);
    hiss(end, 0.5, 6500, 1.0, 0.05);
    applause(end + 0.9, 7.5, 0.13);
    return { end: end + 8.4 - t0, pre: 9.5, stop() { const now = ctx.currentTime; bus.gain.setTargetAtTime(0, now, 0.08); dry.gain.setTargetAtTime(0, now, 0.08); wet.gain.setTargetAtTime(0, now, 0.25); setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch (e) { /* already stopped */ } } try { dry.disconnect(); wet.disconnect(); } catch (e) { /* gone */ } }, 1500); } };
  }

  // the surtitles: the line sung, and under it the line in English
  function titles(host) {
    const el = document.createElement('div');
    el.className = 'g-surtitle'; el.hidden = true;
    el.style.cssText = 'position:absolute;left:50%;top:9%;transform:translateX(-50%);max-width:min(86vw,720px);text-align:center;pointer-events:none;z-index:6;' +
      'font:500 clamp(15px,2.1vw,22px)/1.35 "Cormorant Garamond",Georgia,serif;color:#f3ead8;text-shadow:0 1px 10px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9);letter-spacing:.01em;transition:opacity .35s';
    el.innerHTML = '<div class="fr" style="font-style:italic;opacity:.82;font-size:.86em"></div><div class="en"></div>';
    host.appendChild(el);
    let cur = null;
    return { el, set(line) { if (line === cur) return; cur = line; if (!line) { el.style.opacity = 0; return; } el.hidden = false; el.style.opacity = 1; el.children[0].textContent = line[0]; el.children[1].textContent = line[1]; }, remove() { el.remove(); } };
  }

  function create({ G, A, world, host, toast, npcs }) {
    const seats = (G.seats || []).map(s => Object.assign({}, s, { h: Math.atan2(s.face[0], s.face[1]) }));
    const shows = G.shows || [];
    let seat = null, run = null; // run: { show, t0 (ctx time of beat 0), audio, T (the surtitles), dim: [[mesh, was visible]], clock }
    const near = (x, y, z, r = 1.5) => { let best = null, bd = r; for (const s of seats) { if (Math.abs(s.at[2] - z) > 1.3) continue; const d = Math.hypot(s.at[0] - x, s.at[1] - y); if (d < bd) { bd = d; best = s; } } return best; };
    function begin(show) {
      const ctx = A && A.ctx;
      run = { show, clock: -9.5, audio: null, T: titles(host), dim: (show.dim || []).map(n => world.getObjectByName(n)).filter(Boolean).map(m => [m, m.visible]), done: false, said: {} };
      if (ctx && A.musicBus) { try { run.audio = perform(ctx, A.musicBus(), show, ctx.currentTime + 9.5 + 0.3); run.ctx = ctx; run.t0 = ctx.currentTime + 9.8; } catch (e) { run.audio = null; } }
      api.playing = true;
      if (toast) toast(`<b>${show.title} · ${show.act}</b><span>${show.by}; ${show.sung}</span>`);
    }
    function finish() {
      if (!run) return;
      if (run.audio) run.audio.stop();
      for (const [m, v] of run.dim) m.visible = v;
      const s = npcs().find(n => n.id === run.show.singer); if (s) s.talking = false;
      run.T.remove(); run = null; api.playing = false;
    }
    const api = {
      seats, shows, playing: false,
      near,
      get seat() { return seat; },
      get show() { return run ? run.show : null; },
      get beat() { return run ? run.clock * (run.show.bpm || 72) / 60 : null; },
      sit(s) { seat = s; const show = s.show && shows.find(q => q.id === s.show); if (show) begin(show); },
      stand() { seat = null; finish(); },
      // dt: the frame's; returns nothing. The clock is the audio's where there is sound, the game's otherwise
      update(dt) {
        if (!run) return;
        run.clock = run.audio && run.ctx.state === 'running' ? run.ctx.currentTime - run.t0 : run.clock + dt;
        const show = run.show, beat = run.clock * (show.bpm || 72) / 60, end = (show.end_beat || 71) * 60 / (show.bpm || 72);
        for (const [m] of run.dim) m.visible = run.clock < -8.5 || run.clock > end + 6; // the house lights go down with the tuning A
        const line = (show.lines || []).find(l => beat >= l[0] - 0.3 && beat < l[1]);
        run.T.set(line ? [line[2], line[3]] : null);
        const s = npcs().find(n => n.id === show.singer);
        if (s) {
          const singing = beat > 6.5 && run.clock < end;
          s.talking = singing;
          if (s.h0 == null) s.h0 = s.h;
          s.h = s.h0 + (singing ? 0.5 * Math.sin(run.clock * 0.37) : 0); // she turns to one side of the house, then the other
        }
        if (!run.said.bravo && run.clock > end + 1.2) { run.said.bravo = true; if (toast) toast('<b>Brava!</b><span>The house is on its feet. E to stand up; stay, and it plays again.</span>'); }
        if (run.clock > end + 14) { const sh = run.show; finish(); if (seat) begin(sh); } // an encore, while you keep your seat
      },
      dispose() { finish(); },
    };
    return api;
  }
  return { create, perform, vowelOf, FORMANTS };
})();
