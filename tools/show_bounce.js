// Render a show (web/game/show.js, game.json "shows": the Opera House's Habanera) offline and write it as WAV files
// to listen to: the mix, and her voice, the chorus, the orchestra and the house each alone, for tools/show_listen.py to
// measure (pitch against the score, vibrato, vowels, the balance against the pit, peaks).
//   node tools/show_bounce.js [out-dir] [score.json]   (default: data/raw/show, which git ignores; cities/sydney/opera_score.json)
//   PORT=8800 to use a server that is already up; otherwise it serves web/ itself
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const RATE = 44100;
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
function wav(pcm, rate) {
  const n = pcm.length / 4, buf = Buffer.alloc(44);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  return Buffer.concat([buf, pcm]);
}

(async () => {
  const root = path.join(__dirname, '..');
  const out = process.argv[2] || path.join(root, 'data', 'raw', 'show');
  const show = JSON.parse(fs.readFileSync(process.argv[3] || path.join(root, 'cities', 'sydney', 'opera_score.json'), 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  let port = +process.env.PORT, server = null;
  if (!port) {
    port = await freePort();
    server = spawn('python3', ['-m', 'http.server', String(port), '--directory', path.join(root, 'web')], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      if (await new Promise(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); })) break;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const b = await chromium.launch();
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.route('**/__show_bounce.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>show bounce</title><script src="game/show.js"></script>' }));
  await p.goto(`http://localhost:${port}/__show_bounce.html`);
  await p.waitForFunction('window.OEShow');
  const takes = { mix: {}, voice: { chorus: 0, orchestra: 0, house: 0 }, chorus: { voice: 0, orchestra: 0, house: 0 }, orchestra: { voice: 0, chorus: 0, house: 0 }, house: { voice: 0, chorus: 0, orchestra: 0 } };
  const report = {};
  for (const [name, parts] of Object.entries(takes)) {
    const r = await p.evaluate(async ([show, parts]) => {
      const buf = await OEShow.bounce(show, parts, 44100), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
      const pcm = new Int16Array(n * 2); let peak = 0, nan = 0;
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R[i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue; }
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        pcm[2 * i] = Math.max(-32767, Math.min(32767, Math.round(l * 32767))); pcm[2 * i + 1] = Math.max(-32767, Math.min(32767, Math.round(r * 32767)));
      }
      let s = ''; const u8 = new Uint8Array(pcm.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { seconds: n / 44100, peak, nan, pcm: btoa(s) };
    }, [show, parts]);
    fs.writeFileSync(path.join(out, `${name}.wav`), wav(Buffer.from(r.pcm, 'base64'), RATE));
    report[name] = { seconds: +r.seconds.toFixed(2), peak_dbfs: +(20 * Math.log10(r.peak || 1e-9)).toFixed(1), nan: r.nan };
    console.log(`${name}: ${report[name].seconds} s, peak ${report[name].peak_dbfs} dBFS${r.nan ? `, ${r.nan} NaN` : ''}`);
  }
  fs.writeFileSync(path.join(out, 'bounce.json'), JSON.stringify({ pre: 9.6, rate: RATE, takes: report }, null, 1));
  if (errors.length) console.log('page errors:', errors.join(' | '));
  await b.close();
  if (server) server.kill();
  process.exit(errors.length ? 1 : 0);
})();
