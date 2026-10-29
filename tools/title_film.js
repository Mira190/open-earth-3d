// Film the title screen's opening frame by frame, with its score, into an MP4: Enter, the
// night pass, the sunrise and the title, the pull-back to the menu, a destination chosen and
// the dive into it. Software WebGL is far too slow for real time, so the page's sequence clock
// is held at each frame's time and the frame drawn on demand (window.__title.still), and CSS
// transitions are slowed to match;
// the score is rendered offline (OEScore.bounce) and laid under the frames by ffmpeg.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) node tools/title_film.js out.mp4 [1280x720] [fps] [destination index]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [,, out = 'opening.mp4', size = '1280x720', fpsArg = '24', destArg = ''] = process.argv;
const fps = +fpsArg;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oe3d-film-'));
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => { window.__titleManual = true; }); // hold the sequence at its start instead of starting on its own
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 400)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/index.html#globe`);
  await p.waitForFunction('window.__title && __title.state === "gate"', null, { timeout: 300000 });
  const T = await p.evaluate(() => __title.timing);
  const dest = destArg === '' ? await p.evaluate(() => __title.dests.findIndex(d => d.id === 'tokyo')) : +destArg;
  // the shot list, in seconds after Enter
  const menuAt = T.PULL_A + T.PULL_D, selAt = menuAt + 1.2, diveAt = selAt + 2.6, end = diveAt + 2.2;
  // the score, offline: the same calls the page makes, plus a tick on the choice and the whoosh of the dive
  const pcm = await p.evaluate(async ({ T, end, selAt, diveAt }) => {
    const ch = await OEScore.bounce(end + 1, t0 => {
      OEScore.drone(2.2); OEScore.riser(t0 + T.T_RISE, 3.2); OEScore.hit(t0 + T.T_RISE + 0.03);
    });
    // the tick and the whoosh, mixed in by hand: they are scheduled from "now" in the live page
    const rate = 48000, n = ch[0].length, mix = (at, fn) => { for (let i = Math.floor(at * rate); i < n; i++) { const v = fn((i - at * rate) / rate); if (v === null) break; ch[0][i] += v; ch[1][i] += v; } };
    mix(selAt, t => (t > 0.08 ? null : Math.sin(2 * Math.PI * 2100 * t) * 0.035 * Math.exp(-t * 60)));
    let seed = 1, lp = 0;
    mix(diveAt, t => { if (t > 2.0) return null; seed = (seed * 16807) % 2147483647; const nz = seed / 1073741823 - 1; lp += (nz - lp) * Math.min(1, 0.02 + t * 0.25);
      return lp * 0.5 * Math.min(1, t / 1.6) * (t > 1.75 ? Math.max(0, 1 - (t - 1.75) / 0.25) : 1) + Math.sin(2 * Math.PI * (40 + 40 * t) * t) * 0.3 * Math.min(1, t / 1.7) * (t > 1.75 ? 0 : 1); });
    const buf = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) { buf[2 * i] = Math.max(-1, Math.min(1, ch[0][i])) * 32767; buf[2 * i + 1] = Math.max(-1, Math.min(1, ch[1][i])) * 32767; }
    let s = ''; const u8 = new Uint8Array(buf.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, { T, end, selAt, diveAt });
  const raw = Buffer.from(pcm, 'base64');
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + raw.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(raw.length, 40);
  fs.writeFileSync(path.join(dir, 'score.wav'), Buffer.concat([wav, raw]));
  // CSS transitions slowed to the film's clock, re-measured as frames come in
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Animation.enable');
  let rate = 0.05;
  await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
  const frames = Math.round(end * fps);
  let selected = false, dove = false;
  for (let i = 0; i < frames; i++) {
    const t = i / fps, t0 = Date.now();
    if (!selected && t >= selAt) { selected = true; await p.evaluate(d => __title.select(d), dest); }
    if (!dove && t >= diveAt) { dove = true; await p.evaluate(d => { window.addEventListener('hashchange', e => e.stopImmediatePropagation(), { capture: true }); __title.dive(d, false); }, dest); }
    await p.evaluate(t => __title.still(t), t);
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94, timeout: 120000 });
    const wall = (Date.now() - t0) / 1000;
    const want = Math.max(0.005, Math.min(1, (1 / fps) / wall));
    if (Math.abs(want - rate) / rate > 0.15) { rate = want; await cdp.send('Animation.setPlaybackRate', { playbackRate: rate }); }
    if (i % 24 === 0) console.log(`frame ${i}/${frames} t=${t.toFixed(2)}s ${wall.toFixed(2)}s/frame`);
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%05d.jpg'), '-i', path.join(dir, 'score.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${out}: ${frames} frames at ${fps} fps`, logs.slice(0, 10).join('\n'));
})();
