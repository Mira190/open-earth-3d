// The game's score, synthesised with Web Audio (no audio files): a quiet generative chamber score
// that follows the hour, the weather, the city and what the player is doing. Chords come from small
// hand-written progressions per time of day, the pads are voice-led, the melody is a seeded contour
// walk on the mode's scale, the bass and the brushed percussion are light, and the room is a
// convolution reverb whose impulse is made here. Everything is original and generic in idiom.
//
//   const music = OEMusic.create();
//   music.start(OEAudio.ctx, OEAudio.musicBus());   // after the Play click; safe to call twice
//   music.set({ slot: 'evening', hour: 18.5, rain: 0.6, palette: 'kyoto', mode: 'foot' });
//   music.sting('job');
//   OEMusic.bounce(16, { slot: 'night' }).then(buffer => ...);   // offline and deterministic
//
// A change of state is taken up on the next bar line and settles over two to four bars: the tempo
// glides, the layers fade through their buses, and a new key starts on its tonic under the old
// pad's release. Only the talking duck, the room (indoors) and the volume move at once.
'use strict';
window.OEMusic = (function () {
  const SLOTS = ['morning', 'daytime', 'evening', 'night'];
  const TRAVEL = ['foot', 'car', 'ride', 'ferry', 'heli', 'rail'];
  const PALETTES = ['default', 'tokyo', 'kyoto', 'sydney', 'alpine'];
  const ALIAS = { queenstown: 'alpine' };
  const STING_KINDS = ['day', 'rank', 'job', 'stamp', 'fail', 'message'];
  const NOTE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MODES = {
    lydian: [0, 2, 4, 6, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  };
  const KEY = 'oe3d-music', AHEAD = 0.3, TRIM = 0.7;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function prng(a) { // mulberry32
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- what each hour plays; a palette then bends it towards its city ----
  // progs: scale degrees (0 = the tonic), one chord every `bars` bars; mel: the melody's scale in
  // semitones over the tonic; comp/bass/drums: the pattern each layer plays; lead: melody density
  const BASE = {
    morning: { bpm: 88, root: 0, mode: 'lydian', ext: 'add9', bars: 1, progs: [[0, 1, 0, 4], [0, 4, 5, 1], [0, 2, 1, 4]], mel: [0, 2, 4, 7, 9, 11],
      comp: 'arp', bass: 'root', drums: 'brush', lead: 0.5, keys: 'nylon', voice: 'glass', bright: 5200, swing: 0 },
    daytime: { bpm: 96, root: 7, mode: 'ionian', ext: '7', bars: 1, progs: [[0, 5, 3, 4], [0, 3, 1, 4], [2, 5, 1, 4], [0, 2, 3, 4]], mel: [0, 2, 4, 7, 9],
      comp: 'stab', bass: 'walk', drums: 'walk', lead: 0.55, keys: 'ep', voice: 'nylon', bright: 4600, swing: 0.12 },
    evening: { bpm: 78, root: 2, mode: 'dorian', ext: '9', bars: 1, progs: [[0, 3, 0, 4], [0, 2, 3, 4], [0, 3, 6, 4]], mel: [0, 2, 3, 5, 7, 9, 10],
      comp: 'chord', bass: 'sync', drums: 'lazy', lead: 0.45, keys: 'ep', voice: 'glass', bright: 3400, swing: 0.16 },
    night: { bpm: 64, root: 9, mode: 'aeolian', ext: '9', bars: 2, progs: [[0, 5, 3, 4], [0, 3, 5, 6], [0, 5, 0, 3]], mel: [0, 2, 3, 7, 10],
      comp: 'roll', bass: 'long', drums: 'none', lead: 0.22, keys: 'ep', voice: 'glass', bright: 2500, swing: 0 },
  };
  const PAL = {
    // electric keys and extended chords, a steadier kit
    tokyo(p, slot) {
      const minor = slot === 'evening' || slot === 'night';
      p.root = { morning: 10, daytime: 5, evening: 2, night: 7 }[slot];
      p.bpm += minor ? 6 : 4; p.mode = minor ? 'aeolian' : 'ionian'; p.ext = '9';
      p.progs = minor ? [[5, 6, 4, 0], [3, 6, 2, 5], [5, 4, 0, 0]] : [[3, 4, 2, 5], [1, 4, 0, 5], [3, 2, 1, 0]];
      p.mel = minor ? [0, 2, 3, 5, 7, 10] : [0, 2, 4, 7, 9, 11];
      p.keys = 'ep'; p.voice = 'glass'; p.swing = 0.08;
      if (slot !== 'night') { p.comp = minor ? 'chord' : 'stab'; p.bass = 'sync'; p.drums = 'city'; }
    },
    // a plucked string and a breathy flute over a drone, on the yo scale by day and the in scale
    // after dark; no chords, no kit
    kyoto(p, slot) {
      const dark = slot === 'evening' || slot === 'night';
      p.root = 2; p.bpm = Math.max(56, p.bpm * 0.86); p.harmony = 'drone'; p.bars = 2;
      p.scale = dark ? [0, 1, 5, 7, 8] : [0, 2, 5, 7, 9]; p.modeName = dark ? 'in' : 'yo'; p.mel = p.scale;
      p.progs = dark ? [[0, 0, 2, 0], [0, 2, 0, 0]] : [[0, 0, 3, 0], [0, 2, 0, 3], [0, 3, 2, 0]];
      p.comp = 'koto'; p.keys = 'koto'; p.voice = 'flute'; p.bass = 'none'; p.drums = 'none'; p.swing = 0;
      p.lead = slot === 'night' ? 0.2 : 0.3; p.lv.pad = 0.85; p.lv.bass = 0; p.lv.drums = 0; p.wet = 1.4; p.leadVel = 0.16; p.keyVel = 0.2;
    },
    // warm nylon plucks on the major pentatonic, a shaker for a kit
    sydney(p, slot) {
      p.root = (p.root + 2) % 12; p.bpm += 2; p.keys = 'nylon'; p.voice = 'nylon'; p.ext = slot === 'night' ? '7' : 'add9';
      if (slot === 'evening') { p.mode = 'mixolydian'; p.progs = [[0, 6, 3, 0], [0, 3, 6, 3], [0, 4, 3, 0]]; }
      if (slot === 'night') { p.mode = 'dorian'; p.progs = [[0, 3, 0, 4], [0, 6, 3, 0]]; }
      p.mel = slot === 'night' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
      if (slot !== 'night') { p.comp = 'arp'; p.bass = 'root'; p.drums = 'shaker'; }
      p.lv.pad = 0.8; p.lv.bass = 0.8; p.leadVel = 0.22;
    },
    // open fifths and soft bells, slower, no kit
    alpine(p, slot) {
      p.root = (p.root + 5) % 12; p.bpm *= 0.88; p.harmony = 'fifths'; p.bars = 2;
      p.mel = slot === 'morning' || slot === 'daytime' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
      p.comp = 'arp'; p.arp = 0.34; p.keys = 'nylon'; p.voice = 'bell'; p.bass = 'long'; p.drums = 'none'; p.swing = 0;
      p.lead = Math.min(p.lead, 0.34); p.lv.drums = 0; p.lv.pad = 0.85; p.wet = 1.4; p.leadVel = 0.17; p.keyVel = 0.13;
    },
  };
  const DEFAULTS = { slot: 'daytime', hour: 13, rain: 0, wind: 0, snow: false, district: null, palette: null, mode: 'foot', indoors: false, talking: false, event: null };
  function slotOf(hour) { const h = ((hour % 24) + 24) % 24; return h < 5 ? 'night' : h < 10 ? 'morning' : h < 17 ? 'daytime' : h < 21 ? 'evening' : 'night'; }
  // a state, merged over the last one and made safe
  function normalise(prev, s) {
    const o = Object.assign({}, prev);
    if (s) for (const k in DEFAULTS) if (s[k] !== undefined) o[k] = s[k];
    o.hour = Number.isFinite(+o.hour) ? ((+o.hour % 24) + 24) % 24 : 13;
    if (s && s.slot === undefined && s.hour !== undefined) o.slot = slotOf(o.hour);
    if (SLOTS.indexOf(o.slot) < 0) o.slot = slotOf(o.hour);
    o.rain = clamp(+o.rain || 0, 0, 1); o.wind = clamp(+o.wind || 0, 0, 1); o.snow = !!o.snow;
    o.mode = TRAVEL.indexOf(o.mode) < 0 ? 'foot' : o.mode;
    o.indoors = !!o.indoors; o.talking = !!o.talking;
    o.palette = o.palette ? String(o.palette).toLowerCase() : null;
    o.district = o.district ? String(o.district) : null; o.event = o.event ? String(o.event) : null;
    return o;
  }
  // the programme a state asks for
  function resolve(s) {
    const b = BASE[s.slot];
    let pal = s.palette ? (ALIAS[s.palette] || s.palette) : 'default';
    if (!PAL[pal]) pal = 'default';
    const p = Object.assign({}, b, { slot: s.slot, pal, harmony: 'tertian', keyVel: 0.14, leadVel: 0.27, arp: 0.72, wet: 1.1,
      lv: { pad: 1, keys: 1, lead: 1, bass: 1, drums: 1, felt: 0, pulse: 0, drops: 0 } });
    if (PAL[pal]) PAL[pal](p, s.slot);
    p.scale = p.scale || MODES[p.mode]; p.modeName = p.modeName || p.mode;
    // the sun: a little brighter and quicker at midday
    const sun = 0.5 + 0.5 * Math.cos((s.hour - 13) * Math.PI / 12);
    p.bright *= 0.9 + 0.2 * sun; p.bpm += (sun - 0.5) * 2;
    // rain: slower and darker, the kit gives way to a felt piano, sparse high drops
    p.rain = s.rain; p.rainy = s.rain > 0.25;
    p.bpm *= 1 - 0.1 * s.rain; p.bright *= 1 - 0.45 * s.rain;
    if (p.rainy) { p.drums = 'none'; p.lv.drums = 0; p.lv.felt = 1; p.lv.drops = 1; p.lv.keys *= 0.7; p.lead *= 0.8; p.wet += 0.15; }
    // wind and snow thin the texture
    p.thin = clamp(s.wind * 0.7 + (s.snow ? 0.45 : 0), 0, 1);
    p.lv.keys *= 1 - 0.5 * p.thin; p.lv.drums *= 1 - 0.8 * p.thin; p.lv.bass *= 1 - 0.4 * p.thin; p.lead *= 1 - 0.5 * p.thin;
    if (s.snow) { p.bright *= 0.85; p.wet += 0.15; }
    // travel: a steady pulse in a car, on a ride or a train; from a helicopter only the pads carry
    p.mode2 = s.mode;
    if (s.mode === 'car' || s.mode === 'ride') p.lv.pulse = 1;
    else if (s.mode === 'rail') p.lv.pulse = 0.6;
    else if (s.mode === 'ferry') { p.bpm *= 0.96; p.lv.pad *= 1.15; p.lv.drums *= 0.6; }
    else if (s.mode === 'heli') { p.lv.keys = 0; p.lv.drums = 0; p.lv.felt = 0; p.lv.pulse = 0; p.lv.bass *= 0.3; p.lv.lead *= 0.3; p.lead *= 0.5; p.lv.pad *= 1.2; }
    // indoors: drier and closer
    p.indoors = s.indoors;
    if (s.indoors) { p.wet *= 0.35; p.lv.drums *= 0.6; p.lv.drops *= 0.4; p.lv.keys *= 1.1; }
    p.duck = s.talking ? 0.562 : 1; // 5 dB under speech
    p.event = s.event;
    if (s.event) p.bpm += 2;
    p.bright = clamp(p.bright, 1300, 7000);
    p.dseed = s.district ? hash(s.district) : 0;
    p.key = p.slot + '|' + pal; // the harmonic material
    p.id = [p.key, p.rainy ? 'r' : 'd', s.mode === 'heli' ? 'h' : p.lv.pulse ? 'p' : 'f'].join('|');
    return p;
  }
  function describeOf(p, s, bpm) {
    const parts = [cap(p.slot)];
    if (p.rainy) parts.push('rain'); else if (s.snow) parts.push('snow'); else if (s.wind > 0.5) parts.push('wind');
    if (p.pal !== 'default') parts.push(cap(p.pal) + ' palette');
    if (s.mode !== 'foot') parts.push(s.mode);
    if (s.indoors) parts.push('indoors');
    if (s.event) parts.push(s.event);
    parts.push(Math.round(bpm || p.bpm) + ' bpm', NOTE[p.root] + ' ' + p.modeName);
    return parts.join(' · ');
  }

  // melody rhythms, as [sixteenth it starts on, its length in sixteenths]
  const CELLS = {
    sparse: [[[0, 8]], [[4, 8]], [[0, 6], [8, 8]], [[6, 10]], [[2, 6], [10, 6]]],
    mid: [[[0, 4], [4, 2], [6, 8]], [[2, 2], [4, 4], [10, 6]], [[0, 3], [3, 3], [6, 6], [12, 4]], [[4, 4], [8, 2], [10, 6]], [[0, 6], [8, 2], [10, 2], [12, 4]]],
    busy: [[[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]]],
  };
  // stings: [delay s, semitones over the tonic, voice, length s, level]; th the mode's third, col its colour note
  const STINGS = {
    day: th => [[0, -12, 'pad', 2.2, 0.025], [0, -5, 'pad', 2.2, 0.02], [0, 0, 'bell', 2, 0.187], [0.17, 7, 'bell', 2, 0.165], [0.34, 12, 'bell', 2, 0.165], [0.51, 12 + th, 'bell', 2.6, 0.187]],
    rank: th => [[0, 7, 'glass', 0.6, 0.22], [0.09, 12, 'glass', 0.6, 0.22], [0.18, 12 + th, 'glass', 0.6, 0.22], [0.27, 19, 'glass', 1.2, 0.242], [0.27, 31, 'bell', 1.6, 0.077]],
    job: th => [[0, th, 'nylon', 0.5, 0.22], [0.11, 7, 'nylon', 0.5, 0.22], [0.22, 12, 'nylon', 0.9, 0.242], [0.22, 24, 'bell', 1.2, 0.077]],
    stamp: () => [[0, -12, 'nylon', 0.4, 0.264], [0.02, 19, 'bell', 0.9, 0.099]],
    fail: th => [[0, 7, 'felt', 0.8, 0.22], [0.24, th, 'felt', 1.2, 0.187], [0.24, -12, 'felt', 1.2, 0.132]],
    message: () => [[0, 19, 'glass', 0.3, 0.154], [0.09, 24, 'glass', 0.5, 0.176]],
  };

  function loadVolume() {
    try { const v = parseFloat(localStorage.getItem(KEY)); if (Number.isFinite(v)) return clamp(v, 0, 1); } catch (e) { /* storage blocked */ }
    return 0.6;
  }

  function create(opts = {}) {
    const seed = (opts.seed >>> 0) || 0x0e3d5c0e, persist = opts.persist !== false;
    let rng = prng(seed);
    let ctx = null, own = false, N = null, timer = null, offline = false;
    let vol = opts.volume != null ? clamp(+opts.volume || 0, 0, 1) : loadVolume();
    let st = normalise(DEFAULTS, null);
    // the sequencer: the programme playing, the bar being written, the phrase and its chord
    let P = null, bpm = 0, nextBar = 0, barNo = 0, phraseBar = 0, progNo = 0, prog = null, chord = null, padPrev = null, xf = 0, rest = false;
    let queue = [], qi = 0;
    const M = { pos: 0, dir: 1, motif: null, koto: 0, felt: 0 };
    const pick = a => a[Math.floor(rng() * a.length)];

    // ---- the graph: a bus per layer into a tone filter, the talking duck, a soft limit and the volume ----
    function build(c, dest) {
      const g = v => { const n = c.createGain(); n.gain.value = v; return n; };
      N = { bus: {} };
      N.out = g(0); N.out.connect(dest);
      // a soft knee from 0.4, never past 0.7: a guard, not a sound; the mix sits well under it
      N.limit = c.createWaveShaper();
      const curve = new Float32Array(2049);
      for (let i = 0; i < 2049; i++) { const x = i / 1024 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a < 0.4 ? a : 0.4 + 0.3 * Math.tanh((a - 0.4) / 0.3)); }
      N.limit.curve = curve; N.limit.connect(N.out);
      N.duck = g(1); N.duck.connect(N.limit);
      N.tone = c.createBiquadFilter(); N.tone.type = 'lowpass'; N.tone.frequency.value = 4000; N.tone.Q.value = 0.5; N.tone.connect(N.duck);
      N.sum = g(TRIM); N.sum.connect(N.tone);
      N.clear = g(TRIM); N.clear.connect(N.duck); // past the tone filter: the drops and the stings
      N.verb = c.createConvolver(); N.verb.buffer = impulse(c, 2.6);
      N.wet = g(1.1); N.verb.connect(N.wet); N.wet.connect(N.sum);
      const bus = (name, send, o = {}) => {
        const b = { in: g(o.level == null ? 0 : o.level), send: g(send) };
        let tail = b.in;
        if (o.lp) { b.lp = c.createBiquadFilter(); b.lp.type = 'lowpass'; b.lp.frequency.value = o.lp; b.lp.Q.value = 0.4; tail.connect(b.lp); tail = b.lp; }
        if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; tail.connect(p); tail = p; }
        tail.connect(o.clear ? N.clear : N.sum); tail.connect(b.send); b.send.connect(N.verb);
        N.bus[name] = b;
      };
      bus('pad', 0.5, { lp: 1100 }); bus('keys', 0.34, { pan: -0.18 }); bus('lead', 0.55, { pan: 0.16 });
      bus('bass', 0.04, { lp: 420 }); bus('drums', 0.18); bus('felt', 0.5, { pan: 0.1 }); bus('pulse', 0.14, { pan: -0.08 });
      bus('drops', 0.9, { clear: true }); bus('sting', 0.5, { clear: true, level: 0.8 });
      // seeded noise for the brushes and the breath, and the felt piano's wave
      N.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = N.noise.getChannelData(0), r = prng(0x51ced);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      N.feltWave = c.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.4, 0.14, 0.06, 0.02]));
    }
    // the room: seeded noise that decays and darkens as it goes
    function impulse(c, seconds) {
      const n = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, n, c.sampleRate), r = prng(0x700b), tau = c.sampleRate * 0.55;
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < n; i++) { const x = (r() * 2 - 1) * Math.exp(-i / tau) * (1 - i / n); lp += (x - lp) * (0.75 - 0.6 * i / n); d[i] = lp; }
      }
      return b;
    }

    // ---- the voices: a few short-lived nodes per note, stopped when the note is over ----
    function gain() { const g = ctx.createGain(); g.gain.value = 0; return g; }
    function osc(type, f, t, end, dst) {
      const o = ctx.createOscillator();
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.value = f; o.connect(dst); o.start(t); o.stop(end);
      return o;
    }
    // a finished note leaves the graph (not offline: there the render runs ahead of these events,
    // and a node unhooked at a moment that varies would make two renders differ in their last bits)
    function done(src, last) { if (offline) return; src.onended = () => { try { last.disconnect(); } catch (e) { /* the context closed */ } }; }
    // a struck or plucked note: up in `a`, down 60 dB in `d`
    function pluckEnv(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(peak * 0.001, t + a + d); g.gain.linearRampToValueAtTime(0, t + a + d + 0.03); }
    function holdEnv(g, t, a, peak, dur, r) { const h = Math.max(a, dur); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + h); g.gain.linearRampToValueAtTime(0, t + h + r); }
    function noiseSrc(t, len, dst) {
      const s = ctx.createBufferSource(); s.buffer = N.noise; s.loop = len > 0.25;
      s.connect(dst); s.start(t, rng() * 1.7); s.stop(t + len);
      return s;
    }
    // two-operator FM: electric keys (ratio 1), a glassy lead (2), a soft bell (3.5)
    function fm(b, t, m, vel, ratio, idx, idxD, a, d) {
      const f = mtof(m), end = t + a + d + 0.05, g = gain(), mg = gain(), k = idx * Math.min(1, Math.sqrt(330 / f));
      const c = osc('sine', f, t, end, g);
      osc('sine', f * ratio, t, end, mg); mg.connect(c.frequency);
      mg.gain.setValueAtTime(f * k, t); mg.gain.exponentialRampToValueAtTime(f * k * 0.06 + 0.01, t + idxD);
      pluckEnv(g, t, a, vel, d); g.connect(b.in); done(c, g);
    }
    // a plucked string: a saw through a filter that closes as it rings
    function pluck(b, t, m, vel, bright, q, d, bend) {
      const f = mtof(m), end = t + d + 0.06, g = gain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = q;
      lp.frequency.setValueAtTime(Math.min(11000, f * bright), t); lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 1.4), t + d * 0.4);
      const o = osc('sawtooth', f, t, end, lp);
      if (bend !== 1) { o.frequency.setValueAtTime(f * bend, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
      lp.connect(g); pluckEnv(g, t, 0.003, vel, d); g.connect(b.in); done(o, g);
    }
    const V = {
      pad(b, t, m, dur, vel) {
        const f = mtof(m), a = Math.min(1.4, dur * 0.4), r = 2.2, end = t + Math.max(a, dur) + r + 0.05, g = gain();
        const o = osc('sawtooth', f, t, end, g); o.detune.value = -5;
        osc('triangle', f, t, end, g).detune.value = 6;
        holdEnv(g, t, a, vel, dur, r); g.connect(b.in); done(o, g);
      },
      ep(b, t, m, dur, vel) { fm(b, t, m, vel, 1, 1.0, 0.45, 0.005, Math.max(1.6, dur * 1.6)); },
      glass(b, t, m, dur, vel) { fm(b, t, m, vel, 2, 0.45, 0.3, 0.012, Math.max(1.8, dur * 1.3)); },
      bell(b, t, m, dur, vel) { fm(b, t, m, vel, 3.5, 0.8, 1.0, 0.004, Math.max(3, dur)); },
      nylon(b, t, m, dur, vel) { pluck(b, t, m, vel, 5, 0.7, 1.5, 1); },
      koto(b, t, m, dur, vel) { pluck(b, t, m, vel * 0.9, 9, 2.5, 2.2, 1.012); },
      mute(b, t, m, dur, vel) { pluck(b, t, m, vel, 2.2, 0.5, 0.35, 1); },
      felt(b, t, m, dur, vel) {
        const f = mtof(m), d = clamp(2.4 * Math.sqrt(262 / f), 1, 2.8), g = gain(), o = osc(N.feltWave, f, t, t + 0.012 + d + 0.05, g);
        pluckEnv(g, t, 0.012, vel, d); g.connect(b.in); done(o, g);
      },
      // a breathy end-blown flute: a sine that scoops up to its note, vibrato that comes in late, and breath
      flute(b, t, m, dur, vel) {
        const f = mtof(m), a = Math.min(0.18, dur * 0.3), r = 0.35, end = t + Math.max(a, dur) + r + 0.05, g = gain(), h = gain(), lg = gain(), ng = gain();
        const o = osc('sine', f, t, end, g);
        o.frequency.setValueAtTime(f * 0.972, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
        h.gain.value = 0.14; osc('sine', f * 2, t, end, h); h.connect(g);
        osc('sine', 4.8, t, end, lg); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(dur, 0.9)); lg.connect(o.frequency);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(8000, f * 2); bp.Q.value = 1.2;
        noiseSrc(t, end - t, bp); ng.gain.value = 0.3; bp.connect(ng); ng.connect(g);
        holdEnv(g, t, a, vel, dur, r); g.connect(b.in); done(o, g);
      },
      bass(b, t, m, dur, vel) {
        const g = gain(), o = osc('triangle', mtof(m), t, t + dur + 0.2, g);
        holdEnv(g, t, 0.012, vel, dur, 0.14); g.connect(b.in); done(o, g);
      },
      kick(b, t, m, dur, vel) {
        const g = gain(), o = osc('sine', 88, t, t + 0.3, g);
        o.frequency.setValueAtTime(88, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
        pluckEnv(g, t, 0.003, vel, 0.22); g.connect(b.in); done(o, g);
      },
      brush(b, t, m, dur, vel) {
        const g = gain(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 0.6;
        const s = noiseSrc(t, 0.24, bp); bp.connect(g); pluckEnv(g, t, 0.035, vel, 0.17); g.connect(b.in); done(s, g);
      },
      hat(b, t, m, dur, vel) {
        const g = gain(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
        const s = noiseSrc(t, 0.07, hp); hp.connect(g); pluckEnv(g, t, 0.001, vel, 0.045); g.connect(b.in); done(s, g);
      },
      // a drop: a short sine that chirps upward, somewhere across the stereo field
      drop(b, t, m, dur, vel, pan) {
        const f = mtof(m), g = gain(), o = osc('sine', f, t, t + 0.2, g);
        o.frequency.setValueAtTime(f * 0.78, t); o.frequency.exponentialRampToValueAtTime(f * 1.22, t + 0.04);
        pluckEnv(g, t, 0.002, vel, 0.13);
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(b.in); done(o, p); } else { g.connect(b.in); done(o, g); }
      },
    };

    // ---- harmony ----
    const nearest = (pc, near) => { let m = near - (((near - pc) % 12) + 12) % 12; if (near - m > 6) m += 12; return m; };
    // each new chord tone goes to the voice that has the least way to move
    function voiceLead(prev, pcs, centre) {
      const out = [], left = pcs.slice();
      if (prev && prev.length === pcs.length) {
        for (const p of prev) {
          let bi = 0, bd = 99;
          left.forEach((pc, i) => { const d = Math.abs(nearest(pc, p) - p); if (d < bd) { bd = d; bi = i; } });
          out.push(nearest(left.splice(bi, 1)[0], p));
        }
      } else for (const pc of pcs) out.push(nearest(pc, centre));
      for (let i = 0; i < out.length; i++) {
        while (out[i] < centre - 9) out[i] += 12;
        while (out[i] > centre + 10) out[i] -= 12;
        if (out.indexOf(out[i]) < i) out[i] += out[i] + 12 <= centre + 14 ? 12 : -12;
      }
      return out.sort((a, b) => a - b);
    }
    function buildChord(deg) {
      const sc = P.scale, n = sc.length, at = k => sc[(deg + k) % n] + 12 * Math.floor((deg + k) / n);
      const r = at(0), pc = x => (((P.root + x) % 12) + 12) % 12;
      let bass = 36 + pc(r); if (bass > 45) bass -= 12;
      if (P.harmony === 'drone') { // a root, its fifth and its octave
        const low = nearest(pc(r), 50);
        return { bass, i3: 7, pcs: [pc(r), pc(r + 7)], v: [low, low + 7, low + 12] };
      }
      const third = at(2), fifth = at(4), seventh = at(6), ninth = (at(8) - r) % 12 === 2 ? at(8) : null;
      if (P.harmony === 'fifths') { // no third in the pad: root, fifth, ninth, fifth
        const low = nearest(pc(r), 52);
        return { bass, i3: 7, pcs: [pc(r), pc(fifth), pc(third)], v: ninth != null ? [low, low + 7, low + 14, low + 19] : [low, low + 7, low + 12, low + 19] };
      }
      const tones = P.ext === 'add9' ? [r, third, fifth, ninth != null ? ninth : r]
        : P.ext === '7' || ninth == null ? [r, third, fifth, seventh] : [third, fifth, seventh, ninth];
      const pcs = tones.map(pc), v = voiceLead(padPrev, pcs, 62);
      padPrev = v;
      return { bass, i3: third - r, pcs: [pc(r), pc(third), pc(fifth), pc(seventh)].concat(ninth != null && P.ext !== '7' ? [pc(ninth)] : []), v };
    }

    // ---- writing a bar ----
    function composeBar() {
      const T = resolve(st), first = !P;
      let restart = first;
      rest = false;
      if (!first && T.id !== P.id) {
        const moved = T.key !== P.key;
        xf = moved ? 4 : 3; restart = moved; rest = moved;
      }
      P = T;
      bpm = first ? P.bpm : xf ? bpm + (P.bpm - bpm) / xf : bpm + (P.bpm - bpm) * 0.5;
      const t0 = nextBar, spb = 60 / bpm, barDur = 4 * spb, s16 = spb / 4;
      // the mix follows over the bars of the change
      const tc = first ? (offline ? 0.08 : 0.9) : Math.max(0.4, (xf || 2) * barDur / 3.5);
      for (const k in P.lv) N.bus[k].in.gain.setTargetAtTime(P.lv[k], t0, tc);
      N.tone.frequency.setTargetAtTime(P.bright, t0, tc);
      N.bus.pad.lp.frequency.setTargetAtTime(clamp(P.bright * 0.3, 650, 1500), t0, tc);
      N.wet.gain.setTargetAtTime(P.wet, t0, first ? 0.05 : Math.min(tc, 0.5));
      N.duck.gain.setTargetAtTime(P.duck, t0, 0.12);
      // the phrase: four chords, a new progression each time round
      if (restart) { phraseBar = 0; M.pos = P.mel.length; M.koto = P.mel.length; M.motif = null; }
      if (phraseBar % (P.bars * 4) === 0) { phraseBar = 0; prog = P.progs[(P.dseed + progNo + (rng() < 0.3 ? 1 : 0)) % P.progs.length]; progNo++; }
      const cb = phraseBar % P.bars, pb = phraseBar % 4;
      const on = k => P.lv[k] > 0.01;
      const at = step => t0 + step * s16 + (step % 4 === 2 ? P.swing * 2 * s16 : step % 2 ? P.swing * s16 : 0);
      const q = (voice, bus, t, m, dur, vel, x) => queue.push([t, voice, bus, m, dur, vel, x]);
      const human = () => (rng() - 0.5) * 0.008;
      if (cb === 0) {
        chord = buildChord(prog[Math.floor(phraseBar / P.bars)]);
        chord.v.forEach((m, i) => q('pad', 'pad', t0 + i * 0.03, m, P.bars * barDur, 0.018));
      }
      const v = chord.v, top = v.slice(-3);
      const lb = 60 + P.root - (P.root > 6 ? 12 : 0), n = P.mel.length;
      const mel = i => lb + 12 * Math.floor(i / n) + P.mel[((i % n) + n) % n];
      const inChord = m => chord.pcs.indexOf(((m % 12) + 12) % 12) >= 0;
      const snap = i => { for (const d of [0, 1, -1, 2, -2]) if (inChord(mel(i + d))) return i + d; return i; };

      // keys
      if (on('keys')) {
        const k = P.keys, kv = P.keyVel;
        if (P.comp === 'arp') {
          const seq = [0, 1, 2, 3, 2, 1, 3, 2];
          for (let i = 0; i < 8; i++) if (rng() < P.arp - 0.4 * P.thin || (i === 0 && cb === 0)) q(k, 'keys', at(i * 2) + human(), v[seq[(i + cb * 3) % 8] % v.length] + 12, 2 * s16, kv * (i % 2 ? 0.7 : 1));
        } else if (P.comp === 'stab') {
          for (const s of pick([[6, 12], [2, 10], [6, 14], [4, 11]])) if (rng() > 0.5 * P.thin) top.forEach((m, i) => q(k, 'keys', at(s) + i * 0.008, m, 2 * s16, kv * 0.72));
        } else if (P.comp === 'chord') {
          v.forEach((m, i) => q(k, 'keys', at(0) + i * 0.018, m, 6 * s16, kv * 0.8));
          if (rng() < 0.7 - 0.4 * P.thin) { const s = pick([7, 10, 6]); top.forEach((m, i) => q(k, 'keys', at(s) + i * 0.012, m, 4 * s16, kv * 0.55)); }
        } else if (P.comp === 'roll') {
          if (cb === 0) v.forEach((m, i) => q(k, 'keys', t0 + i * 0.11, m + (i > 1 ? 12 : 0), 8 * s16, kv * 0.85));
          else if (rng() < 0.5 - 0.3 * P.thin) q(k, 'keys', at(pick([4, 8, 10])), pick(v) + 12, 6 * s16, kv * 0.6);
        } else if (P.comp === 'koto') {
          if (cb === 0 && rng() < 0.85) q('koto', 'keys', t0, chord.bass + 24, 8 * s16, kv * 1.1);
          if (rng() < 0.22 * (1 - P.thin)) { // a short run down the scale
            const s = pick([8, 10]); let i = clamp(M.koto + 2, n, 2 * n + 2);
            for (let j = 0; j < 4; j++) q('koto', 'keys', at(s + j) + human(), mel(i - j), 2 * s16, kv * (0.6 + 0.1 * j));
            M.koto = i - 3;
          } else {
            const count = Math.floor(rng() * 3.4 * (1 - 0.6 * P.thin)), steps = [4, 6, 8, 10, 12, 14];
            for (let j = 0; j < count; j++) {
              const s = steps.splice(Math.floor(rng() * steps.length), 1)[0];
              M.koto = clamp(M.koto + pick([-2, -1, -1, 1, 1, 2]), Math.floor(n * 0.6), 2 * n + 1);
              q('koto', 'keys', at(s) + human(), mel(M.koto), 4 * s16, kv * (0.7 + 0.3 * rng()));
              if (rng() < 0.15) q('koto', 'keys', at(s) + 0.02, mel(M.koto + n), 4 * s16, kv * 0.4);
            }
          }
        }
      }
      // the felt piano that comes in with the rain: a slow broken chord
      if (on('felt')) {
        for (const s of [0, 4, 8, 12]) if ((s === 0 && cb === 0) || rng() < 0.55 - 0.25 * P.thin) {
          M.felt = (M.felt + pick([1, 1, 2, v.length - 1])) % v.length;
          q('felt', 'felt', at(s) + human(), v[M.felt] + (rng() < 0.4 ? 12 : 0), 4 * s16, 0.16 + 0.03 * rng());
        }
      }
      // melody: a contour walk, landing on chord tones, the third bar answering the first
      if (on('lead') && !rest) {
        let dens = P.lead * (pb === 3 ? 0.6 : 1);
        if (rng() < 0.3 + dens * 1.1) {
          let cell, steps;
          if (pb === 2 && M.motif && rng() < 0.75) { cell = M.motif.cell; steps = M.motif.steps; }
          else {
            const r = rng();
            cell = pick(dens < 0.32 ? CELLS.sparse : dens > 0.5 && r < 0.25 ? CELLS.busy : r < 0.75 ? CELLS.mid : CELLS.sparse);
            steps = cell.map(() => { if (rng() < 0.28) M.dir = -M.dir; const x = rng(); return M.dir * (x < 0.15 ? 0 : x < 0.75 ? 1 : x < 0.93 ? 2 : 3); });
            if (pb === 0) M.motif = { cell, steps };
          }
          const lo = Math.floor(n * 0.6), hi = Math.floor(n * 2.4);
          cell.forEach(([s, len], j) => {
            M.pos += steps[j];
            if (M.pos < lo) { M.pos = lo + 1; M.dir = 1; } else if (M.pos > hi) { M.pos = hi - 1; M.dir = -1; }
            if (s % 4 === 0 || j === cell.length - 1) M.pos = snap(M.pos);
            q(P.voice, 'lead', at(s) + human(), mel(M.pos), len * s16 * 0.92, P.leadVel * (0.8 + 0.25 * rng()) * (s % 4 ? 0.85 : 1));
          });
        }
        if (P.event && rng() < 0.6) q('bell', 'lead', at(pick([2, 6, 10, 14])), pick(v) + 24, 1, 0.07);
      }
      // bass
      if (on('bass') && P.bass !== 'none') {
        const b = chord.bass, bv = 0.1;
        if (P.bass === 'root') { q('bass', 'bass', at(0), b, 6 * s16, bv); if (rng() < 0.6) q('bass', 'bass', at(10), rng() < 0.5 ? b + 7 : b, 4 * s16, bv * 0.8); }
        else if (P.bass === 'walk') [b, rng() < 0.5 ? b + chord.i3 : b + 7, rng() < 0.6 ? b + 7 : b + 12, rng() < 0.5 ? b + 7 : b + chord.i3].forEach((m, i) => q('bass', 'bass', at(i * 4), m, 3.4 * s16, bv * (i % 2 ? 0.8 : 1)));
        else if (P.bass === 'sync') { q('bass', 'bass', at(0), b, 3 * s16, bv); q('bass', 'bass', at(6), b, 2 * s16, bv * 0.8); if (rng() < 0.7) q('bass', 'bass', at(12), rng() < 0.5 ? b + 12 : b + 7, 3 * s16, bv * 0.75); }
        else if (cb === 0) q('bass', 'bass', t0, b, P.bars * barDur * 0.9, bv * 0.9);
      }
      // brushes
      if (on('drums') && P.drums !== 'none') {
        const d = (voice, s, vel) => q(voice, 'drums', at(s) + human() * 0.5, 0, 0, vel);
        const hats = (every, p, vel) => { for (let s = 0; s < 16; s += every) if (rng() < p) d('hat', s, vel * (s % 4 === 2 ? 1.25 : s % 4 ? 0.6 : 0.9)); };
        if (P.drums === 'brush') { d('brush', 4, 0.09); d('brush', 12, 0.1); hats(2, 0.5, 0.032); }
        else if (P.drums === 'walk') { d('kick', 0, 0.16); d('kick', 8, 0.12); d('brush', 4, 0.1); d('brush', 12, 0.11); hats(2, 0.85, 0.04); }
        else if (P.drums === 'lazy') { d('kick', 0, 0.17); d('kick', 10, 0.12); d('brush', 4, 0.11); d('brush', 12, 0.12); hats(2, 0.6, 0.036); }
        else if (P.drums === 'city') { d('kick', 0, 0.17); d('kick', 8, 0.14); if (rng() < 0.4) d('kick', 6, 0.09); d('brush', 4, 0.12); d('brush', 12, 0.13); hats(1, 0.7, 0.032); }
        else if (P.drums === 'shaker') { d('kick', 0, 0.11); hats(2, 0.9, 0.04); if (rng() < 0.5) d('brush', 12, 0.07); }
      }
      // a steady pulse on wheels: root on the beat, fifth between
      if (on('pulse')) for (let i = 0; i < 8; i++) q('mute', 'pulse', at(i * 2), chord.bass + 24 + (i % 2 ? 7 : 0), s16, i % 2 ? 0.16 : 0.26);
      // rain drops, high and sparse
      if (on('drops')) {
        const count = Math.floor(rng() * (1.2 + 2.6 * P.rain));
        for (let j = 0; j < count; j++) q('drop', 'drops', t0 + rng() * barDur, mel(2 * n + Math.floor(rng() * n)) + 12, 0, 0.06 + 0.05 * rng(), rng() * 1.6 - 0.8);
      }
      phraseBar++; barNo++; if (xf) xf--;
      nextBar = t0 + barDur;
    }
    const emit = e => V[e[1]](N.bus[e[2]], e[0], e[3], e[4], e[5], e[6]);

    // ---- the scheduler: every 100 ms, write the bars that are due and start the notes 300 ms ahead ----
    function tick() {
      if (!ctx || !N || vol === 0 || ctx.state === 'closed') return;
      const now = ctx.currentTime, ahead = typeof document !== 'undefined' && document.hidden ? 1.6 : AHEAD;
      if (nextBar < now - 0.25) { nextBar = now + 0.1; queue = []; qi = 0; } // woke after a long sleep
      while (nextBar < now + ahead) { composeBar(); queue.sort((a, b) => a[0] - b[0]); }
      while (qi < queue.length && queue[qi][0] < now + ahead) {
        const e = queue[qi++];
        if (e[0] >= now) emit(e);
        else if (e[1] === 'pad' && e[0] + e[4] > now + 0.5) { e[4] -= now + 0.01 - e[0]; e[0] = now + 0.01; emit(e); } // a late pad still sounds
      }
      if (qi > 64) { queue = queue.slice(qi); qi = 0; }
    }
    function start(c, destination) {
      if (ctx && (!c || c === ctx)) { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); return true; }
      if (ctx) stop();
      if (!c) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        c = new AC(); own = true;
      }
      ctx = c; offline = false;
      build(c, destination || c.destination);
      N.out.gain.setTargetAtTime(vol, c.currentTime, 0.05);
      rng = prng(seed); P = null; queue = []; qi = 0; barNo = 0; phraseBar = 0; progNo = 0; padPrev = null; xf = 0;
      nextBar = c.currentTime + 0.12;
      timer = setInterval(tick, 100);
      tick();
      return true;
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (ctx && N) {
        const out = N.out, c = ctx, mine = own;
        try { out.gain.cancelScheduledValues(c.currentTime); out.gain.setTargetAtTime(0, c.currentTime, 0.08); } catch (e) { /* the context closed */ }
        setTimeout(() => { try { out.disconnect(); if (mine) c.close(); } catch (e) { /* the context closed */ } }, 600);
      }
      ctx = null; N = null; P = null; own = false; queue = []; qi = 0;
    }
    function set(state) {
      st = normalise(st, state);
      if (ctx && N && !offline) { // these don't wait for the bar line
        const T = resolve(st), now = ctx.currentTime;
        N.duck.gain.setTargetAtTime(T.duck, now, 0.12);
        N.wet.gain.setTargetAtTime(T.wet, now, 0.4);
      }
    }
    function sting(kind, at) {
      if (!ctx || !N || vol === 0 || !STINGS[kind]) return false;
      const T = P || resolve(st), t = (at != null ? at : ctx.currentTime) + 0.02;
      const has = x => T.scale.indexOf(x) >= 0, th = has(4) ? 4 : has(3) ? 3 : 5;
      const base = 60 + T.root - (T.root > 6 ? 12 : 0);
      for (const [dt, semis, voice, dur, vel] of STINGS[kind](th)) V[voice](N.bus.sting, t + dt, base + semis, dur, vel);
      return true;
    }
    function volume(v) {
      if (v === undefined) return vol;
      vol = clamp(+v || 0, 0, 1);
      if (persist) { try { localStorage.setItem(KEY, String(vol)); } catch (e) { /* storage blocked */ } }
      if (ctx && N) N.out.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
      return vol;
    }
    function describe() {
      if (vol === 0) return 'Off';
      return P ? describeOf(P, st, bpm) : describeOf(resolve(st), st, 0);
    }
    // everything written up front on an offline context; states: one state, or a list of
    // { at: seconds, ...state } taken up on the bar line after `at`; a state's `stings` is a list
    // of [seconds, kind]
    function render(off, seconds, states) {
      const list = (Array.isArray(states) ? states.slice() : [Object.assign({ at: 0 }, states)]).sort((a, b) => (a.at || 0) - (b.at || 0));
      const stings = [];
      for (const s of list) for (const g of s.stings || []) stings.push(g);
      stings.sort((a, b) => a[0] - b[0]);
      ctx = off; offline = true;
      build(off, off.destination);
      N.out.gain.value = vol;
      nextBar = 0.05;
      let li = 0, si = 0;
      while (nextBar < seconds) {
        while (li < list.length && (list[li].at || 0) <= nextBar) st = normalise(st, list[li++]);
        composeBar();
        while (si < stings.length && stings[si][0] < nextBar) { sting(stings[si][1], stings[si][0]); si++; }
      }
      for (const e of queue) if (e[0] < seconds) emit(e);
      queue = [];
    }
    return {
      start, stop, set, sting, volume, describe,
      get playing() { return !!ctx && !!timer; },
      get off() { return vol === 0; },
      get state() { return Object.assign({}, st); },
      _render: render,
    };
  }

  // the score for a state (or a list of timed states), rendered offline, for films and tests: the
  // same call gives the same composition, and samples that agree to within float rounding (about
  // 1e-6, far below a 16-bit step: a browser sums the notes on a bus in no fixed order). It is
  // rendered at full volume, before the game's master.
  function bounce(seconds, state, sampleRate = 44100) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return Promise.reject(new Error('no OfflineAudioContext'));
    const off = new OC(2, Math.ceil(seconds * sampleRate), sampleRate);
    const first = Array.isArray(state) ? state[0] : state;
    create({ volume: 1, persist: false, seed: first && first.seed })._render(off, seconds, state || {});
    return off.startRendering();
  }
  function describe(state) { const s = normalise(DEFAULTS, state); return describeOf(resolve(s), s, 0); }

  return { create, bounce, describe, slots: SLOTS, palettes: PALETTES, stings: STING_KINDS, modes: TRAVEL };
})();
