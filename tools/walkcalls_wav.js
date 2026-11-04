// Render the walk signals' calls (web/game/audio.js walkCall) to a WAV to listen to, offline in
// Chromium: Shibuya's scramble round, a Japanese crosswalk's two pairs, then Sydney's, Hong Kong's
// and Amsterdam's ticks on red and on the walk.
//   node tools/walkcalls_wav.js out.wav
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'walkcalls.wav';
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ content: `window.__t = 0; const SR = 44100, LEN = 46;
    window.AudioContext = class extends OfflineAudioContext { constructor() { super(2, SR * LEN, SR); window.__ctx = this; } get currentTime() { return window.__t; } };` });
  await p.addScriptTag({ path: path.join(__dirname, '../web/game/audio.js') });
  const wav = await p.evaluate(async () => {
    const A = window.OEAudio; A.start();
    let t = 0.5; const at = (dt, kind, level, pan) => { t += dt; window.__t = t; A.walkCall(kind, level, pan); };
    // the scramble's round, twice, from Hachiko's corner: piyo, piyo-piyo, kakko, ka-kakko, 1.5 s apart
    for (let r = 0; r < 2; r++) [['piyo', 0.5, -0.6], ['piyopiyo', 0.9, 0.3], ['kakko', 0.6, 0.7], ['kakakko', 0.8, -0.4]].forEach(([k, l, pn], i) => at(r || i ? 1.5 : 0, k, l, pn));
    t += 2;
    // a crosswalk running north-south, its two ends answering; then one running east-west
    for (let i = 0; i < 4; i++) at(i ? 1.5 : 0, i % 2 ? 'piyopiyo' : 'piyo', i % 2 ? 0.4 : 1, i % 2 ? 0.5 : -0.2);
    t += 1.5;
    for (let i = 0; i < 4; i++) at(i ? 1.5 : 0, i % 2 ? 'kakakko' : 'kakko', i % 2 ? 0.4 : 1, i % 2 ? -0.5 : 0.2);
    t += 2;
    // Sydney: the locator on red, the zap, the walk's rapid tick; Hong Kong; Amsterdam
    for (const [slow, fast, sr, fr, start] of [['tick', 'tick', 1.0, 0.12, 'zap'], ['pip', 'pip', 0.8, 0.14], ['ratel', 'ratel', 1.0, 0.1]]) {
      for (let i = 0; i < 3; i++) at(i ? sr : 0, slow, 1, 0.1);
      if (start) at(sr, start, 1, 0.1);
      for (let i = 0; i < 4 / fr; i++) at(i ? fr : (start ? 0.3 : sr), fast, 1, 0.1);
      t += 1.5;
    }
    // render (audio.js's context is the offline one) to 16-bit stereo PCM
    const buf = await window.__ctx.startRendering(), n = Math.min(buf.length, Math.ceil((t + 1.5) * buf.sampleRate));
    const L = buf.getChannelData(0), R = buf.getChannelData(1), pcm = new Int16Array(n * 2);
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const k = peak > 0 ? 0.89 / peak : 1; // (normalised to -1 dBFS, for listening)
    for (let i = 0; i < n; i++) { pcm[2 * i] = L[i] * k * 32767; pcm[2 * i + 1] = R[i] * k * 32767; }
    return { rate: buf.sampleRate, peak, data: Array.from(new Uint8Array(pcm.buffer)) };
  });
  const data = Buffer.from(wav.data), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(wav.rate, 24); h.writeUInt32LE(wav.rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(out, Buffer.concat([h, data]));
  console.log(`${out}: ${(data.length / 4 / wav.rate).toFixed(1)} s (peak ${wav.peak.toFixed(3)} before normalising)`);
  await b.close();
})();
