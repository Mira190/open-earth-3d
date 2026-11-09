// Check the game's score (web/game/music.js): render it offline for every time of day, dry and in
// rain, in every palette, and look at the samples. A render must have no NaN, peak under 0.9 and
// over 0.02, sit in a sane loudness, never fall silent for two seconds after the first two, differ
// between dry and rain and between palettes, and come out the same when rendered twice (to within
// float rounding: a browser sums the notes on a bus in no fixed order, so the last bits vary). Then the
// travel modes, the talking duck, the stings, a timed change of state, and a live run on a real
// context (start twice, set, sting, volume, stop).
//   node tools/music_check.js [out-dir]     writes each render as a WAV into out-dir, to listen to
//   PORT=8800 to use a server that is already up; otherwise it serves web/ itself
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const SECONDS = 16, RATE = 44100;
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
function wav(pcm, rate) {
  const n = pcm.length / 4, buf = Buffer.alloc(44);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  return Buffer.concat([buf, pcm]);
}

(async () => {
  const out = process.argv[2];
  if (out) fs.mkdirSync(out, { recursive: true });
  let port = +process.env.PORT, server = null;
  if (!port) {
    port = await freePort();
    server = spawn('python3', ['-m', 'http.server', String(port), '--directory', path.join(__dirname, '..', 'web')], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { // until it answers
      if (await new Promise(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); })) break;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  // a tiny page with only the score on it
  await p.route('**/__music_check.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>music check</title><script src="game/music.js"></script>' }));
  await p.goto(`http://localhost:${port}/__music_check.html`);
  await p.waitForFunction('window.OEMusic');
  await p.evaluate(() => {
    window.__keep = {};
    // render a state; keep its left channel under `name`; return what the samples say
    window.__render = async (name, seconds, state, rate, pcm) => {
      const buf = await OEMusic.bounce(seconds, state, rate), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
      let peak = 0, sum = 0, nan = 0;
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R[i];
        if (!(l === l) || !(r === r) || !isFinite(l) || !isFinite(r)) { nan++; continue; }
        peak = Math.max(peak, Math.abs(l), Math.abs(r)); sum += l * l + r * r;
      }
      let quiet = Infinity; // the quietest two seconds after the first two
      for (let a = 2 * rate; a + 2 * rate <= n; a += rate) { let s = 0; for (let i = a; i < a + 2 * rate; i++) s += L[i] * L[i] + R[i] * R[i]; quiet = Math.min(quiet, Math.sqrt(s / (4 * rate))); }
      window.__keep[name] = new Float32Array(L);
      const res = { peak, rms: Math.sqrt(sum / (2 * n)), nan, quiet };
      if (pcm) { // interleaved 16-bit, as base64
        const i16 = new Int16Array(n * 2);
        for (let i = 0; i < n; i++) { i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))); i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))); }
        const u8 = new Uint8Array(i16.buffer); let str = '';
        for (let i = 0; i < u8.length; i += 32768) str += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
        res.pcm = btoa(str);
      }
      return res;
    };
    // how far apart two kept renders are (RMS of the difference)
    window.__diff = (a, b) => { const x = window.__keep[a], y = window.__keep[b]; let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; } return Math.sqrt(s / x.length); };
    window.__far = (a, b) => { const x = window.__keep[a], y = window.__keep[b]; let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
    window.__drop = () => { window.__keep = {}; };
  });
  const info = await p.evaluate(() => ({ slots: OEMusic.slots, palettes: OEMusic.palettes, stings: OEMusic.stings, modes: OEMusic.modes }));
  let failed = 0;
  const fail = (name, why) => { failed++; console.log(`FAIL ${name}: ${why}`); };
  const db = v => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  const render = async (name, state, seconds = SECONDS) => {
    const r = await p.evaluate(([n, s, st, rate, pcm]) => window.__render(n, s, st, rate, pcm), [name, seconds, state, RATE, !!out]);
    if (out) { fs.writeFileSync(path.join(out, name.replace(/[^\w.-]+/g, '_') + '.wav'), wav(Buffer.from(r.pcm, 'base64'), RATE)); delete r.pcm; }
    return r;
  };
  const judge = (name, r) => {
    const bad = [];
    if (r.nan) bad.push(`${r.nan} NaN samples`);
    if (!(r.peak < 0.9)) bad.push(`peak ${r.peak.toFixed(3)} >= 0.9`);
    if (!(r.peak > 0.02)) bad.push(`peak ${r.peak.toFixed(4)} <= 0.02`);
    if (!(r.rms > 0.008 && r.rms < 0.25)) bad.push(`rms ${r.rms.toFixed(4)} outside 0.008..0.25`);
    if (!(r.quiet > 0.002)) bad.push(`silent for 2 s (rms ${r.quiet.toFixed(5)})`);
    if (bad.length) fail(name, bad.join('; '));
    return !bad.length;
  };

  // every time of day, dry and in rain, in every palette
  for (const slot of info.slots) {
    for (const palette of info.palettes) {
      for (const rain of [0, 0.8]) {
        const name = `${slot}-${palette}-${rain ? 'rain' : 'dry'}`, state = { slot, palette: palette === 'default' ? null : palette, rain };
        const r = await render(name, state);
        await p.evaluate(([s, st, rate]) => window.__render('again', s, st, rate, false), [SECONDS, state, RATE]);
        const far = await p.evaluate(n => window.__far(n, 'again'), name), ok = judge(name, r), same = far < 2e-5; // under a 16-bit step
        if (!same) fail(name, `two renders of the same state differ by ${far.toExponential(1)}`);
        const says = await p.evaluate(st => OEMusic.describe(st), state);
        console.log(`${ok && same ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} peak ${db(r.peak)} dB  rms ${db(r.rms)} dB  quietest 2 s ${db(r.quiet)} dB  twice ${far ? far.toExponential(0) : '0'}  ${says}`);
      }
      const d = await p.evaluate(([a, c]) => window.__diff(a, c), [`${slot}-${palette}-dry`, `${slot}-${palette}-rain`]);
      if (!(d > 0.003)) fail(`${slot}-${palette}`, `dry and rain are alike (difference ${d.toFixed(5)})`);
    }
    for (let i = 0; i < info.palettes.length; i++) for (let j = i + 1; j < info.palettes.length; j++) for (const wx of ['dry', 'rain']) {
      const d = await p.evaluate(([a, c]) => window.__diff(a, c), [`${slot}-${info.palettes[i]}-${wx}`, `${slot}-${info.palettes[j]}-${wx}`]);
      if (!(d > 0.003)) fail(`${slot}-${wx}`, `${info.palettes[i]} and ${info.palettes[j]} are alike (difference ${d.toFixed(5)})`);
    }
    await p.evaluate(() => window.__drop());
  }

  // travel, rooms and speech each change the evening; talking is quieter by about 5 dB
  const base = { slot: 'evening', hour: 18.5 }, foot = await render('evening-foot', base);
  judge('evening-foot', foot);
  for (const [name, extra] of [['car', { mode: 'car' }], ['ride', { mode: 'ride' }], ['ferry', { mode: 'ferry' }], ['heli', { mode: 'heli' }], ['rail', { mode: 'rail' }],
    ['indoors', { indoors: true }], ['talking', { talking: true }], ['wind', { wind: 1 }], ['snow', { snow: true }], ['event', { event: 'festival' }], ['district', { district: 'gion' }]]) {
    const r = await render(`evening-${name}`, Object.assign({}, base, extra)), ok = judge(`evening-${name}`, r);
    const d = await p.evaluate(([a, c]) => window.__diff(a, c), ['evening-foot', `evening-${name}`]);
    if (!(d > 0.002)) fail(`evening-${name}`, `no different from on foot (difference ${d.toFixed(5)})`);
    if (name === 'talking') { const drop = 20 * Math.log10(r.rms / foot.rms); if (!(drop < -4 && drop > -6)) fail('evening-talking', `ducked by ${drop.toFixed(1)} dB, not 5`); }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${('evening-' + name).padEnd(24)} peak ${db(r.peak)} dB  rms ${db(r.rms)} dB  differs from foot by ${db(d)} dB`);
  }
  // a palette nobody knows plays the default
  await render('evening-unknown', Object.assign({ palette: 'nowhere' }, base));
  const du = await p.evaluate(() => window.__diff('evening-foot', 'evening-unknown'));
  if (!(du < 1e-5)) fail('evening-unknown', 'an unknown palette is not the default');
  // the stings, in the key of the hour; and a morning that turns to a rainy night on the bar line
  const stung = await render('evening-stings', Object.assign({ stings: info.stings.map((k, i) => [2 + i * 2.2, k]) }, base)); judge('evening-stings', stung);
  const ds = await p.evaluate(() => window.__diff('evening-foot', 'evening-stings'));
  if (!(ds > 0.002)) fail('evening-stings', 'the stings make no sound');
  console.log(`${ds > 0.002 ? 'ok  ' : 'FAIL'} ${'evening-stings'.padEnd(24)} peak ${db(stung.peak)} dB  rms ${db(stung.rms)} dB  differs from foot by ${db(ds)} dB`);
  const turn = await render('morning-to-night', [{ at: 0, slot: 'morning' }, { at: 8, slot: 'night', rain: 0.7 }], 32), okTurn = judge('morning-to-night', turn);
  console.log(`${okTurn ? 'ok  ' : 'FAIL'} ${'morning-to-night'.padEnd(24)} peak ${db(turn.peak)} dB  rms ${db(turn.rms)} dB  quietest 2 s ${db(turn.quiet)} dB`);

  // live, on a real context
  const live = await p.evaluate(async kinds => {
    const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), bus = ctx.createGain(), tap = ctx.createAnalyser();
    bus.connect(tap); bus.connect(ctx.destination);
    const m = OEMusic.create({ persist: false, volume: 0.6 }), said = [], wait = ms => new Promise(r => setTimeout(r, ms));
    const before = m.playing;
    m.set({ slot: 'evening', hour: 19, palette: 'kyoto', rain: 0.6 });
    const a = m.start(ctx, bus), b2 = m.start(ctx, bus); // twice: the second is a no-op
    said.push(m.describe());
    await wait(2500);
    let peak = 0; const d = new Float32Array(tap.fftSize);
    for (let i = 0; i < 10; i++) { tap.getFloatTimeDomainData(d); for (const v of d) peak = Math.max(peak, Math.abs(v)); await wait(60); }
    const stings = kinds.map(k => m.sting(k));
    m.set({ slot: 'night', mode: 'car', talking: true, rain: 0, palette: 'tokyo' });
    await wait(4500);
    said.push(m.describe());
    const v0 = m.volume(); m.volume(0); const off = m.off, offSays = m.describe(); m.volume(0.4);
    const playing = m.playing; m.stop();
    const res = { before, a, b2, said, peak, stings, v0, off, offSays, v1: m.volume(), playing, after: m.playing, state: ctx.state, unknown: m.sting('nothing') };
    await ctx.close();
    return res;
  }, info.stings);
  const lf = [];
  if (live.before || !live.a || !live.b2 || !live.playing || live.after) lf.push('start/stop/playing are wrong');
  if (live.state === 'running' && !(live.peak > 0.001)) lf.push('nothing sounded');
  if (live.stings.some(x => !x) || live.unknown) lf.push('a sting did not play, or an unknown one did');
  if (live.v0 !== 0.6 || !live.off || live.offSays !== 'Off' || live.v1 !== 0.4) lf.push('volume/off are wrong');
  if (!/^Evening .* rain .* Kyoto palette .* bpm .* D in$/.test(live.said[0]) || !/^Night .* Tokyo palette .* car .* bpm .* G aeolian$/.test(live.said[1])) lf.push('describe() is wrong');
  if (lf.length) fail('live', lf.join('; '));
  console.log(`${lf.length ? 'FAIL' : 'ok  '} live                     context ${live.state}  peak ${db(live.peak)} dB  "${live.said[0]}" -> "${live.said[1]}"`);

  for (const e of errors) fail('page', e);
  await b.close();
  if (server) server.kill();
  console.log(failed ? `${failed} FAILED` : 'music: all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
