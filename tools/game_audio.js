// Record what a player hears on entering a city's game, and say what it is made of: every Web Audio
// context the page opens (the game's sounds, the score) is tapped at its output, the mix is written
// to a WAV to listen to, and the recording is analysed for a steady bed (loudness that never drops)
// and a pulse (loudness rising and falling at a rate, as a fan's or a rotor's whoosh does). Every gain
// node is labelled with the line that made it, and the ones that are open (passing sound) are listed
// once a second, so a sound heard can be traced to its code.
//   xvfb-run -a node tools/game_audio.js shibuya [seconds=40] [out.wav]
//   QUERY='?noise=1' to hear the city's beds too; SKIP=1 to skip the overture
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const city = process.argv[2] || 'shibuya', secs = +(process.argv[3] || 40), out = process.argv[4] || `${city}-audio.wav`;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'], headless: !process.env.DISPLAY });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  await p.addInitScript(() => {
    // each context's output, recorded; each gain node, with the script line that made it
    const recs = window.__recs = [], gains = window.__gains = [];
    const where = () => { const s = (new Error().stack || '').split('\n').slice(3).find(l => !/game_audio|__puppeteer|<anonymous>/.test(l)) || ''; const m = s.match(/\/([\w.-]+\.js):(\d+)/); return m ? `${m[1]}:${m[2]}` : '?'; };
    const connect = AudioNode.prototype.connect, cg = BaseAudioContext.prototype.createGain;
    const tap = ctx => {
      if (ctx.__rec || ctx instanceof OfflineAudioContext) return ctx.__rec;
      const sp = ctx.createScriptProcessor(4096, 2, 2), rec = { L: [], R: [], rate: ctx.sampleRate, at: where(), on: false };
      ctx.__rec = rec; ctx.__sp = sp; recs.push(rec);
      sp.onaudioprocess = e => { if (!rec.on) return; rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0))); rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1))); };
      const mute = cg.call(ctx); mute.gain.value = 0; connect.call(sp, mute); connect.call(mute, ctx.destination);
      return rec;
    };
    AudioNode.prototype.connect = function (dst, ...a) {
      if (dst && dst === this.context.destination && !(this.context instanceof OfflineAudioContext)) {
        tap(this.context); connect.call(this, this.context.__sp);
      }
      return connect.call(this, dst, ...a);
    };
    BaseAudioContext.prototype.createGain = function () { const g = cg.call(this); g.__labelled = true; if (!(this instanceof OfflineAudioContext)) gains.push({ g, at: where() }); return g; };
    const GN = window.GainNode;
    window.GainNode = function (ctx, o) { const g = new GN(ctx, o); g.__labelled = true; gains.push({ g, at: where() }); return g; };
    window.GainNode.prototype = GN.prototype;
  });
  p.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await p.waitForTimeout(1500);
  // (Play, again until the title is gone: a first press may land while it is still settling)
  await p.waitForFunction(() => !document.querySelector('#g-title').hidden, null, { timeout: 600000 });
  for (let i = 0; i < 20 && await p.evaluate(() => !document.querySelector('#g-title').hidden); i++) { await p.evaluate(() => document.querySelector('#gt-play').click()); await p.waitForTimeout(1500); }
  await p.evaluate(() => window.__recs.forEach(r => { r.on = true; }));
  // WEATHER=live|clear|drizzle|rain (the game's own choice by default); WALK=1 walks forward the whole time
  const setup = await p.evaluate(async ({ wx }) => {
    const g = window.__game, A = window.OEAudio, calls = window.__calls = {};
    if (wx) g.weather.set(wx, { now: true });
    for (const k of ['rotor', 'engine', 'wind', 'car', 'skid', 'rain', 'murmur', 'screens', 'walkCall', 'announce', 'step', 'bell', 'gull', 'penguin', 'horn', 'honk', 'beep', 'chime', 'thump', 'shutter']) {
      const f = A[k]; if (!f) continue;
      A[k] = (...a) => { const v = typeof a[0] === 'number' ? a[0] : typeof a[1] === 'number' ? a[1] : 1; if (v > 0.003) { const c = calls[k] = calls[k] || { n: 0, max: 0 }; c.n++; c.max = Math.max(c.max, +v.toFixed(3)); } return f(...a); };
    }
    return { ui: { title: !document.querySelector('#g-title').hidden, menu: !document.querySelector('#g-menu').hidden, metro: !!(window.OEMetro && OEMetro.isOpen()), photo: g.photo.on, cine: g.cine.active && g.cine.label }, weather: g.weather.state, mode: g.player.mode, at: [Math.round(g.player.x), Math.round(g.player.y)], clock: +(g.clock.min / 60).toFixed(2) };
  }, { wx: process.env.WEATHER || '' });
  if (process.env.WALK) await p.keyboard.down('KeyW');
  const open = {}; // gain line -> seconds open
  for (let t = 0; t < secs; t++) {
    if (process.env.PROBE && t === 3) await p.evaluate(() => window.OEAudio.chime()); // (a known sound, to prove the tap)
    if (process.env.SKIP && t === 1) await p.evaluate(() => { const o = window.__game.overture(); if (o && o.active) o.skip(); });
    await p.waitForTimeout(1000);
    const now = await p.evaluate(() => { window.__recs.forEach(r => { r.on = true; }); const m = {}; for (const { g, at } of window.__gains) if (g.gain.value > 0.003) m[at] = Math.max(m[at] || 0, +g.gain.value.toFixed(3)); return m; });
    for (const [k, v] of Object.entries(now)) { open[k] = open[k] || { n: 0, max: 0 }; open[k].n++; open[k].max = Math.max(open[k].max, v); }
  }
  if (process.env.WALK) await p.keyboard.up('KeyW');
  const calls = await p.evaluate(() => ({ calls: window.__calls, weather: window.__game.weather.state, at: [Math.round(window.__game.player.x), Math.round(window.__game.player.y)] }));
  const recs = await p.evaluate(() => window.__recs.map(r => {
    const n = r.L.reduce((s, a) => s + a.length, 0), L = new Float32Array(n), R = new Float32Array(n);
    let o = 0; r.L.forEach((a, i) => { L.set(a, o); R.set(r.R[i], o); o += a.length; });
    return { rate: r.rate, at: r.at, L: Array.from(L), R: Array.from(R) };
  }));
  await b.close();

  // the mix of every context, and an analysis of each
  const rate = recs.length ? recs[0].rate : 48000, n = Math.max(0, ...recs.map(r => r.L.length));
  const mix = [new Float32Array(n), new Float32Array(n)];
  const report = { city, secs, setup, end: calls, contexts: [] };
  for (const r of recs) {
    for (let i = 0; i < r.L.length; i++) { mix[0][i] += r.L[i]; mix[1][i] += r.R[i]; }
    report.contexts.push(Object.assign({ made: r.at }, analyse(r.L, r.rate)));
  }
  report.mix = analyse(mix[0], rate);
  report.open = Object.entries(open).sort((a, b) => b[1].n - a[1].n).map(([at, v]) => `${at}  open ${v.n}/${secs}s, up to ${v.max}`);
  writeWav(out, mix, rate);
  console.log(JSON.stringify(report, null, 1));
  console.log(`wrote ${out}`);
})().catch(e => { console.error(e); process.exit(1); });

// loudness over time (in 20 ms frames, dBFS), the share of the time it is above -50 dB, how much of it
// is high (above 2 kHz: hiss), and the strongest rate it rises and falls at between 1 and 25 Hz
function analyse(x, rate) {
  const F = Math.round(rate * 0.02), m = Math.floor(x.length / F), env = new Float32Array(m), hi = new Float32Array(m);
  let prev = 0;
  for (let k = 0; k < m; k++) {
    let s = 0, h = 0;
    for (let i = k * F; i < (k + 1) * F; i++) { s += x[i] * x[i]; const d = x[i] - prev; prev = x[i]; h += d * d; }
    env[k] = Math.sqrt(s / F); hi[k] = Math.sqrt(h / F) / 2;
  }
  const db = v => (v > 1e-7 ? 20 * Math.log10(v) : -140);
  const sorted = Array.from(env).sort((a, b) => a - b), q = f => db(sorted[Math.floor(f * (sorted.length - 1))] || 0);
  // the envelope's modulation, over the stretch where there is sound
  const mean = env.reduce((s, v) => s + v, 0) / (m || 1);
  let best = { hz: 0, depth: 0 };
  for (let hz = 1; hz <= 25; hz += 0.1) {
    let re = 0, im = 0;
    for (let k = 0; k < m; k++) { const a = 2 * Math.PI * hz * k * 0.02; re += (env[k] - mean) * Math.cos(a); im += (env[k] - mean) * Math.sin(a); }
    const depth = mean > 0 ? 2 * Math.hypot(re, im) / m / mean : 0;
    if (depth > best.depth) best = { hz: +hz.toFixed(1), depth: +depth.toFixed(3) };
  }
  const per = []; // loudness second by second
  for (let s = 0; s < m * 0.02 - 0.5; s++) { let a = 0, c = 0; for (let k = s * 50; k < Math.min(m, (s + 1) * 50); k++) { a += env[k] * env[k]; c++; } per.push(Math.round(db(Math.sqrt(a / (c || 1))))); }
  return { seconds: +(x.length / rate).toFixed(1), quiet10: +q(0.1).toFixed(1), median: +q(0.5).toFixed(1), loud90: +q(0.9).toFixed(1),
    soundingShare: +(env.filter(v => db(v) > -50).length / (m || 1)).toFixed(2), hissShare: +(hi.reduce((s, v) => s + v, 0) / (env.reduce((s, v) => s + v, 0) || 1)).toFixed(2), pulse: best, perSecond: per.join(' ') };
}

function writeWav(file, [L, R], rate) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 1 ? 1 / peak : 1;
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, buf);
}
