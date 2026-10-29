// Film a city's highlights: the shot list in cities/<id>/film.json, played in the city's game
// (its crowds, ferries, traffic, sky and lights) under the title screen's lens, drawn frame by
// frame on a virtual clock, scored offline, and encoded for the web.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) xvfb-run -a node tools/city_film.js sydney     # the whole film
//   NODE_PATH=$(npm root -g) node tools/city_film.js sydney --stills        # one still per shot, to check the cut
//   NODE_PATH=$(npm root -g) node tools/city_film.js sydney --part 1/2      # every other shot (run 2/2 alongside)
//   NODE_PATH=$(npm root -g) node tools/city_film.js sydney --encode        # score and encode the frames on disk
// Options: --size 1920x804 (2.39:1), --fps 24, --shots id,id, --frames <dir> (kept between runs, so
// an interrupted render resumes), PORT (8800).
// Writes web/films/<id>.mp4, <id>.jpg (the poster), <id>.json (the cue sheet the player reads:
// shots, titles and chapters) and adds the film to web/films/index.json.
// Under xvfb-run the frames are drawn by Mesa's llvmpipe (about 1-2 s a frame on four cores; a 36 s
// film is half an hour); without a display, by SwiftShader, about four times slower.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const city = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]; };
if (!city) { console.error('usage: node tools/city_film.js <city> [--stills] [--part i/n] [--encode]'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'cities', city, 'film.json'), 'utf8'));
const [W, H] = String(opt('size', spec.size || '1920x804')).split('x').map(Number);
const FPS = +opt('fps', spec.fps || 24);
const FRAMES = opt('frames', path.join(os.tmpdir(), `oe3d-film-${city}-${W}x${H}`));
const OUT = path.join(ROOT, 'web', 'films');
const PORT = process.env.PORT || 8800;
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// the cut: each shot's start, and the film's length
let t = 0;
for (const s of spec.shots) { s.t0 = t; t += s.dur; }
const DURATION = t;
const NF = Math.round(DURATION * FPS);
const frameOf = i => path.join(FRAMES, `f${String(i).padStart(5, '0')}.jpg`);

// With an X display (xvfb-run), Chromium draws through Mesa's llvmpipe, about four times faster
// than its own SwiftShader on the same cores; without one it falls back to SwiftShader.
const LLVMPIPE = !!process.env.DISPLAY && process.env.FILM_GL !== 'swiftshader';
async function open() {
  const b = await chromium.launch(LLVMPIPE
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 400)));
  await p.addInitScript({ path: path.join(__dirname, 'film', 'clock.js') });
  await p.goto(`http://localhost:${PORT}/index.html#play-${city}`);
  await p.waitForFunction(() => window.__game && document.getElementById('g-loader') && document.getElementById('g-loader').classList.contains('out'), null, { timeout: 900000, polling: 1000 });
  for (const f of ['lens.js']) await p.addScriptTag({ path: path.join(ROOT, 'web', f) });
  for (const f of ['director.js', 'score.js']) await p.addScriptTag({ path: path.join(__dirname, 'film', f) });
  await p.evaluate(s => OEFilmDirector.setup(s), Object.assign({}, spec, { size: [W, H] }));
  await p.evaluate(() => __vt.start());
  // the game's loop was waiting on the real clock: let it run once, onto the virtual one
  await p.waitForFunction(() => __vt.pending > 0, null, { timeout: 120000, polling: 100 });
  return { b, p, errs };
}

// draw the frame at film time t; warm frames settle a new shot (the crowd, the ground's detail) and are thrown away
async function frame(p, t, warm) {
  return p.evaluate(({ t, fps, warm }) => {
    for (let w = 0; w < warm; w++) { OEFilmDirector.apply(t); __vt.step(1000 / fps); }
    OEFilmDirector.apply(t);
    __vt.step(1000 / fps);
    return document.getElementById('game-gl').toDataURL('image/jpeg', 0.95);
  }, { t, fps: FPS, warm });
}
const save = (file, url) => fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

async function stills() {
  const { b, p, errs } = await open();
  const only = opt('shots', '') ? String(opt('shots')).split(',') : null;
  const dir = path.join(FRAMES, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of spec.shots) {
    if (only && !only.includes(s.id)) continue;
    const ks = opt('k', false) ? String(opt('k')).split(',').map(Number) : s.check || [0.05, 0.5, 0.95];
    for (const k of ks) {
      const t0 = Date.now();
      save(path.join(dir, `${s.id}-${Math.round(k * 100)}.jpg`), await frame(p, s.t0 + k * s.dur, k === ks[0] ? 3 : 1));
      console.log(`${s.id} @${k}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
  console.log(errs.slice(0, 8).join('\n'));
  await b.close();
  console.log(`stills in ${dir}`);
}

async function render() {
  const [pi, pn] = String(opt('part', '1/1')).split('/').map(Number);
  const only = opt('shots', '') ? String(opt('shots')).split(',') : null;
  const mine = spec.shots.filter((s, i) => (i % pn) === (pi - 1) && (!only || only.includes(s.id)));
  const { b, p, errs } = await open();
  const t0 = Date.now();
  let done = 0;
  for (const s of mine) {
    const a = Math.round(s.t0 * FPS), z = Math.round((s.t0 + s.dur) * FPS);
    let warm = 3;
    for (let i = a; i < z; i++) {
      if (fs.existsSync(frameOf(i))) { warm = 3; continue; } // done in an earlier run
      save(frameOf(i), await frame(p, i / FPS, warm));
      warm = 0;
      done++;
      if (done % 24 === 0) console.log(`${s.id}: frame ${i}/${NF}, ${((Date.now() - t0) / 1000 / done).toFixed(2)} s a frame`);
    }
  }
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
  await b.close();
}

async function encode() {
  const missing = [];
  for (let i = 0; i < NF; i++) if (!fs.existsSync(frameOf(i))) missing.push(i);
  if (missing.length) { console.error(`${missing.length} frames missing, first ${missing[0]}`); process.exit(2); }
  // the score: rendered in a blank page, it needs only Web Audio
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`http://localhost:${PORT}/index.html#none`);
  await p.addScriptTag({ path: path.join(__dirname, 'film', 'score.js') });
  const plan = Object.assign({ duration: DURATION, cuts: spec.shots.map(s => s.t0).filter(x => x > 0) }, spec.score,
    { title: spec.shots.find(s => s.id === spec.score.title_shot).t0 + (spec.score.title_at || 0), finale: spec.shots.find(s => s.id === spec.score.finale_shot).t0 + (spec.score.finale_at || 0) });
  const pcm = await p.evaluate(async plan => {
    const ch = await OEFilmScore.render(plan), n = ch[0].length, buf = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) { buf[2 * i] = Math.max(-1, Math.min(1, ch[0][i])) * 32767; buf[2 * i + 1] = Math.max(-1, Math.min(1, ch[1][i])) * 32767; }
    let s = ''; const u8 = new Uint8Array(buf.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, plan);
  await b.close();
  const raw = Buffer.from(pcm, 'base64'), wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + raw.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(raw.length, 40);
  const wavFile = path.join(FRAMES, 'score.wav');
  fs.writeFileSync(wavFile, Buffer.concat([wav, raw]));
  // the picture: H.264 for every browser, the audio cut at the picture's end with a fade
  const mp4 = path.join(OUT, `${city}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg'), '-i', wavFile,
    '-af', `afade=t=out:st=${(DURATION - 1.2).toFixed(2)}:d=1.2`, '-t', DURATION.toFixed(3),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(spec.crf || 21), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4]);
  // the poster: the frame the film is remembered by
  const pf = Math.min(NF - 1, Math.round((spec.poster != null ? spec.poster : DURATION * 0.3) * FPS));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', frameOf(pf), '-vf', 'scale=1280:-2', '-q:v', '4', path.join(OUT, `${city}.jpg`)]);
  // the cue sheet: shots, titles and chapters on the film's clock
  const cue = {
    id: city, name: spec.name, duration: +DURATION.toFixed(3), fps: FPS, size: [W, H], video: `films/${city}.mp4`, poster: `films/${city}.jpg`,
    credit: spec.credit || 'Rendered live from the open-data model by tools/city_film.js; nothing in it is stock footage.',
    shots: spec.shots.map(s => ({ id: s.id, t0: +s.t0.toFixed(3), t1: +(s.t0 + s.dur).toFixed(3), chapter: s.chapter || null })),
    titles: spec.shots.filter(s => s.title).map(s => Object.assign({ t0: +(s.t0 + (s.title.at || 0)).toFixed(3), t1: +(s.t0 + (s.title.until != null ? s.title.until : s.dur)).toFixed(3) }, s.title, { at: undefined, until: undefined })),
  };
  fs.writeFileSync(path.join(OUT, `${city}.json`), JSON.stringify(cue, null, 1) + '\n');
  const idx = path.join(OUT, 'index.json');
  const list = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')) : {};
  list[city] = { json: `films/${city}.json`, duration: cue.duration };
  fs.writeFileSync(idx, JSON.stringify(Object.fromEntries(Object.entries(list).sort()), null, 1) + '\n');
  const mb = fs.statSync(mp4).size / 1e6;
  console.log(`${mp4}: ${NF} frames, ${DURATION.toFixed(1)} s, ${mb.toFixed(1)} MB`);
}

async function planView() {
  const { b, p, errs } = await open();
  const r = await p.evaluate(() => OEFilmDirector.plan(1800));
  const file = path.join(FRAMES, 'plan.jpg');
  save(file, r.png);
  for (const x of r.report) console.log(`${x.id.padEnd(10)} lowest clearance ${String(x.clearance_m).padStart(7)} m   line of sight blocked ${x.blocked_samples}`);
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
  await b.close();
  console.log(`plan: ${file}`);
}

(async () => {
  if (opt('plan', false)) await planView();
  else if (opt('stills', false)) await stills();
  else if (opt('encode', false)) await encode();
  else { await render(); if (!opt('part', false) && !opt('shots', false)) await encode(); }
})().catch(e => { console.error(e); process.exit(1); });
