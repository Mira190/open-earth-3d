// A map's overture (web/game/overture.js, game.json "overture"), filmed from the game itself: the page
// opens on the title card, Play starts the overture as it does for a player on their first visit, and
// each frame is drawn on a virtual clock (tools/film/clock.js) and taken as a screenshot of the page, so
// the title drop, the captions and the bars are in it. The score is film-score.js on the overture's plan.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/overture_film.js shibuya --stills [--k 0.1,0.5,0.9]   # stills of each shot
//   xvfb-run -a node tools/overture_film.js shibuya                            # the film, with its score
// Options: --shots a,b (stills of those shots only), --size 1440x900 (or 390x844 for a phone), --fps 24, --date 4-2 (month-day; the guide follows
// the season: a petal, a leaf, a flake or a mote), --time sunset-25 (HH:MM, or sunrise/sunset +- minutes),
// --frames <dir> (kept, so an interrupted film resumes), --out <file.mp4>, --tier high, PORT (8800).
// It also checks the cut: the camera's clearance over the roofs and that it sees the guide, shot by shot.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const city = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]; };
if (!city) { console.error('usage: node tools/overture_film.js <city> [--stills] [--size WxH] [--date M-D] [--time HH:MM|sunset-25]'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const [W, H] = String(opt('size', '1440x900')).split('x').map(Number);
const FPS = +opt('fps', 24);
const [DM, DD] = String(opt('date', '4-2')).split('-').map(Number);
const TIME = String(opt('time', 'sunset-25'));
const FRAMES = opt('frames', path.join(os.tmpdir(), `oe3d-overture-${city}-${W}x${H}-${DM}-${DD}-${TIME}`));
const OUT = opt('out', path.join(FRAMES, `${city}-overture.mp4`));
const PORT = process.env.PORT || 8800;
fs.mkdirSync(FRAMES, { recursive: true });
const save = (file, buf) => fs.writeFileSync(file, buf);

async function open() {
  const sw = !process.env.DISPLAY;
  const b = await chromium.launch(sw ? { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, hasTouch: W < 700, isMobile: W < 700 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 400)));
  p.on('console', m => { if (m.type() === 'error' || /overture/.test(m.text())) errs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  await p.addInitScript({ path: path.join(__dirname, 'film', 'clock.js') });
  await p.addInitScript(q => { try { localStorage.setItem('oe3d-quality', q); localStorage.removeItem('oe3d-overture'); } catch (e) { /* storage blocked */ } }, opt('tier', 'high'));
  await p.goto(`http://localhost:${PORT}/index.html?overture=1#play-${city}`);
  await p.waitForFunction(() => window.__game && document.getElementById('g-loader') && document.getElementById('g-loader').classList.contains('out'), null, { timeout: 900000, polling: 1000 })
    .catch(e => { console.error(errs.join('\n')); throw e; });
  await p.evaluate(() => window.__game.groundShown && window.__game.groundShown()); // (the far aerial tiles, which come after the loader)
  // the day and the hour: the guide follows the season on the game's clock
  await p.evaluate(({ m, d, time }) => {
    const G = __game, y = G.clock.y, L = Sun.dayLimits(y, m, d);
    const r = /^(sunrise|sunset)([+-]\d+)?$/.exec(time);
    const min = r ? L[r[1]] + (+(r[2] || 0)) : time.split(':').reduce((h, x) => h * 60 + +x, 0);
    document.querySelectorAll('#gt-timechoice [aria-pressed]').forEach(x => x.removeAttribute('aria-pressed'));
    G.setClock(y, m, d, min);
    G.crowd.active = G.crowd.P.length;
    if (G.cars && G.cars.C) G.cars.active = G.cars.C.length;
  }, { m: DM, d: DD, time: TIME });
  await p.evaluate(() => { __vt.start(); document.getElementById('gt-play').click(); });
  await p.waitForFunction(() => __vt.pending > 0, null, { timeout: 120000, polling: 100 });
  const info = await p.evaluate(() => { const o = __game.overture(); return o ? { total: o.total, kind: o.kind, end: o.end, shots: o.shots.map(s => ({ id: s.id, t0: s.t0, dur: s.dur })) } : null; });
  if (!info) throw new Error(`${city}: no overture played (game.json "overture"?)`);
  console.log(`${city}: ${info.total.toFixed(1)} s, guide ${info.kind}, you end at ${info.end.map(v => v.toFixed(1)).join(', ')}`);
  return { b, p, errs, info };
}

const step = (p, n) => p.evaluate(({ n, fps }) => { for (let i = 0; i < n; i++) __vt.step(1000 / fps); }, { n, fps: FPS });
const shoot = p => p.screenshot({ type: 'jpeg', quality: 92 });

// the cut against the surface model: the lowest clearance of the camera over what is below it, and how often a roof
// stands between the camera and the guide
async function check(p) {
  return p.evaluate(() => {
    const G = __game, o = G.overture(), D = G.DSM, out = [];
    const dsm = (x, y) => { const c = Math.floor((x - D.x0) / D.cell), r = Math.floor((D.y1 - y) / D.cell); return c < 0 || r < 0 || c >= D.nx || r >= D.ny ? 0 : D.data[r * D.nx + c]; };
    for (const s of o.shots) {
      if (s.type === 'land') continue; // it comes down to the chase camera, which keeps its own clearance
      let clear = Infinity, hid = 0, n = 0;
      for (let j = 0; j <= 20; j++) {
        const q = o.sample(s, j / 20), x = q.pos.x, y = -q.pos.z, z = q.pos.y;
        clear = Math.min(clear, z - dsm(x, y));
        if (q.guide) {
          const gx = q.guide.x, gy = -q.guide.z, gz = q.guide.y, L = Math.hypot(gx - x, gy - y, gz - z);
          for (let f = 0.05; f < 0.95; f += Math.min(0.2, 1 / Math.max(1, L))) if (dsm(x + (gx - x) * f, y + (gy - y) * f) > z + (gz - z) * f + 0.3) { hid++; break; }
          n++;
        }
      }
      out.push({ id: s.id, clearance_m: +clear.toFixed(1), guide_hidden: n ? `${hid}/${n}` : '-' });
    }
    return out;
  });
}

async function stills() {
  const { b, p, errs, info } = await open();
  for (const r of await check(p)) console.log(`  ${r.id.padEnd(9)} clearance ${String(r.clearance_m).padStart(7)} m   guide hidden ${r.guide_hidden}`);
  const ks = String(opt('k', '0.1,0.5,0.9')).split(',').map(Number);
  const dir = path.join(FRAMES, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const pick = opt('shots', null);
  for (const s of info.shots) {
    if (pick && !String(pick).split(',').includes(s.id)) continue;
    for (const k of ks) {
      const t = s.t0 + k * s.dur;
      // seek the overture's shot there, then let a few frames settle the ground's detail and the type
      await p.evaluate(({ t, total }) => __game.cine.seek(t / total), { t, total: info.total });
      await step(p, 4);
      await p.evaluate(({ t, total }) => __game.cine.seek(t / total), { t, total: info.total });
      await step(p, 1);
      const f = path.join(dir, `${s.id}-${Math.round(k * 100)}.jpg`);
      save(f, await shoot(p));
      console.log(f);
    }
  }
  if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  await b.close();
}

async function film() {
  const NF = Math.round(+opt('until', 1e9) * FPS);
  const frameOf = i => path.join(FRAMES, `f${String(i).padStart(5, '0')}.jpg`);
  const { b, p, errs, info } = await open();
  const n = Math.min(NF, Math.round(info.total * FPS));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    // the overture runs on the game's clock, so frames on disk from an earlier run cannot be skipped: draw them all
    await step(p, 1);
    save(frameOf(i), await shoot(p));
    if (i % 48 === 0) console.log(`frame ${i}/${n}, ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(2)} s a frame`);
  }
  // the score, rendered from the overture's own plan
  const pcm = await p.evaluate(async () => {
    const o = __game.overture();
    if (!window.OEFilmScore) await new Promise((ok, no) => { const el = document.createElement('script'); el.src = 'film-score.js'; el.onload = ok; el.onerror = no; document.head.appendChild(el); });
    const ch = await OEFilmScore.render(o.scorePlan()), n = ch[0].length, buf = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) { buf[2 * i] = Math.max(-1, Math.min(1, ch[0][i])) * 32767; buf[2 * i + 1] = Math.max(-1, Math.min(1, ch[1][i])) * 32767; }
    let s = ''; const u8 = new Uint8Array(buf.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  await b.close();
  const raw = Buffer.from(pcm, 'base64'), wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + raw.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(raw.length, 40);
  const wavFile = path.join(FRAMES, 'score.wav');
  fs.writeFileSync(wavFile, Buffer.concat([wav, raw]));
  const dur = n / FPS;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg'), '-i', wavFile,
    '-af', `afade=t=out:st=${(dur - 1.5).toFixed(2)}:d=1.5`, '-t', dur.toFixed(3), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT]);
  console.log(`${OUT}: ${n} frames, ${dur.toFixed(1)} s, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
}

(async () => {
  if (opt('stills', false)) await stills();
  else await film();
})().catch(e => { console.error(e); process.exit(1); });
