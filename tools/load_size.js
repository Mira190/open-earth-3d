// What a city's game or model downloads before it can be played, and how long that takes (issue 148).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/load_size.js shibuya [play|model] [mbps] [--files]
// Opens the page with the network held to <mbps> megabits a second (default 40; 0: unthrottled) and
// counts every file fetched, once each, raw and as GitHub Pages would send it (gzip for text types,
// as is for images, models and binaries). "Playable" is the moment the loading screen starts to fade.
// Prints the totals before playable and after it (deferred downloads: the helicopter, NPC avatars),
// and with --files every file. The web root is read from WEB (default web/) to size the files.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const [city = 'shibuya', mode = 'play', mbps = '40'] = pos;
const ROOT = process.env.WEB || path.join(__dirname, '..', 'web'), PORT = process.env.PORT || 8800;
const TEXT = /\.(json|js|mjs|css|html|svg|txt)$/;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  const p = await ctx.newPage();
  if (+mbps > 0) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: +mbps * 1e6 / 8, uploadThroughput: 10e6 / 8 });
  }
  const seen = new Map(), t0 = Date.now();
  let playable = null;
  p.on('response', r => {
    const u = new URL(r.url());
    if (u.host !== `localhost:${PORT}` || seen.has(u.pathname)) return;
    const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return;
    const raw = fs.statSync(f).size, buf = TEXT.test(f) ? fs.readFileSync(f) : null;
    seen.set(u.pathname, { raw, wire: buf ? zlib.gzipSync(buf, { level: 6 }).length : raw, t: (Date.now() - t0) / 1000, late: playable !== null });
  });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${PORT}/#${mode === 'play' ? 'play-' : ''}${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const sel = mode === 'play' ? '#g-loader' : '#loader';
  await p.waitForFunction(s => { const l = document.querySelector(s); return l && (l.hidden || l.classList.contains('out')); }, sel, { timeout: 900000, polling: 100 });
  playable = (Date.now() - t0) / 1000;
  const dataIn = Math.max(0, ...[...seen.values()].map(v => v.t)); // the last file in before it could be played
  await p.waitForTimeout(+(process.env.AFTER || 30000)); // what follows once it can be played
  const sum = (late) => { let n = 0, raw = 0, wire = 0; for (const v of seen.values()) if (v.late === late) { n++; raw += v.raw; wire += v.wire; } return { n, raw, wire }; };
  const a = sum(false), z = sum(true), mb = x => (x / 1e6).toFixed(1);
  if (flags.includes('--files')) for (const [k, v] of [...seen].sort((x, y) => y[1].wire - x[1].wire)) console.log(`${v.late ? 'after ' : 'before'} ${mb(v.raw).padStart(6)} ${mb(v.wire).padStart(6)}  ${k}`);
  console.log(`${city} ${mode} @${mbps} Mbps: data in after ${dataIn.toFixed(1)} s, playable after ${playable.toFixed(1)} s; before: ${a.n} files, ${mb(a.raw)} MB raw, ${mb(a.wire)} MB on the wire; after (${(+(process.env.AFTER || 30000) / 1000)} s): ${z.n} files, ${mb(z.raw)} MB raw, ${mb(z.wire)} MB on the wire${errors.length ? '; page errors: ' + errors.join(' | ') : ''}`);
  await b.close();
})();
