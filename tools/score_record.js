// Records the game's score (audio.js score()) for a listen: SECONDS of it in real time, as the game
// would play it in a mood (day, night or rain), written as a .webm (Opus) file.
//   node tools/score_record.js out.webm [day|night|rain|busy] [seconds]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, out = 'score.webm', mood = 'day', secs = '60'] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../web/game/audio.js'), 'utf8') });
  const data = await p.evaluate(async ([mood, secs]) => {
    // everything the score sends to the speakers, recorded too
    const dests = new Map(), conn = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d, ...r) {
      if (d instanceof AudioDestinationNode) { let m = dests.get(d.context); if (!m) { m = d.context.createMediaStreamDestination(); dests.set(d.context, m); } conn.call(this, m); }
      return conn.call(this, d, ...r);
    };
    OEAudio.start();
    for (const k of ['rain', 'murmur']) { /* silent beds: untouched */ }
    const ctxDest = [...dests.values()][0];
    const rec = new MediaRecorder(ctxDest.stream, { mimeType: 'audio/webm;codecs=opus' }), chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const M = { day: {}, night: { night: true }, rain: { rain: true }, busy: { busy: 0.8 } }[mood] || {};
    // (the ambience bed audio.js starts on its own is the city's hum: kept, as the game has it)
    await new Promise(res => { const t0 = performance.now(); let last = t0; const id = setInterval(() => { const n = performance.now(); OEAudio.score(M, (n - last) / 1000); last = n; if (n - t0 > secs * 1000) { clearInterval(id); res(); } }, 50); });
    rec.stop();
    await new Promise(r => (rec.onstop = r));
    const buf = await new Blob(chunks).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }, [mood, +secs]);
  fs.writeFileSync(out, Buffer.from(data));
  console.log(out, data.length, 'bytes');
  await b.close();
})();
