// The site's telemetry end to end (web/telemetry.js -> tools/telemetry_server.py -> tools/slo_report.py):
// opens the globe, a city's model and its game with ?telemetry=<the collector>, waits for each loader to
// fade, plays a little, hides the tab and leaves, then reads the log and checks that the views, the loads
// (ready, with a time), the time on screen with its frame rate, and the page's own timings all arrived,
// that the report can be built from them, and that without the parameter an automated browser sends nothing.
// Also checks that a game in progress keeps the player's position when the page is closed (the save).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/telemetry_check.js [city] [out_dir]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '/tmp/oe-telemetry'] = process.argv;
const PORT = process.env.PORT || 8800, CPORT = Number(process.env.TPORT || 8891);
fs.mkdirSync(outDir, { recursive: true });
const log = path.join(outDir, 'telemetry.jsonl');
try { fs.unlinkSync(log); } catch (e) { /* none yet */ }
const fails = [];
const must = (ok, what, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${got !== undefined ? ` (${got})` : ''}`); if (!ok) fails.push(what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } };

(async () => {
  const srv = spawn('python3', [path.join(__dirname, 'telemetry_server.py'), '--port', String(CPORT), '--out', log], { stdio: 'inherit' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${CPORT}/`); break; } catch (e) { await sleep(100); } }
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let exit = 1;
  try {
    // without the parameter, an automated browser sends nothing (and nothing is configured anyway)
    {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      const sent = [];
      p.on('request', r => { if (r.method() === 'POST') sent.push(r.url()); });
      await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
      await sleep(1500);
      must(await p.evaluate(() => window.OETelemetry && window.OETelemetry.on === false), 'off by default in an automated browser');
      await ctx.close();
      must(sent.length === 0, 'no beacon sent when off', sent.length);
    }
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'low'); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    const T = encodeURIComponent(`http://127.0.0.1:${CPORT}/e`);
    await p.goto(`http://localhost:${PORT}/?telemetry=${T}#globe`, { waitUntil: 'load', timeout: 120000 });
    must(await p.evaluate(() => window.OETelemetry.on), 'on with ?telemetry=<collector>');
    await sleep(3000);
    // the city's model, then its game
    await p.evaluate(c => { location.hash = c; }, city);
    await p.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.classList.contains('out'); }, null, { timeout: 600000 });
    await sleep(4000);
    await p.evaluate(c => { location.hash = `play-${c}`; }, city);
    await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return l && l.classList.contains('out'); }, null, { timeout: 600000 });
    // start a new game and stand somewhere, then close the page: the position must be saved
    await p.waitForFunction(() => { const b = document.getElementById('gt-play') || document.querySelector('#g-title button'); return b && b.offsetParent; }, null, { timeout: 120000 }).catch(() => {});
    const started = await p.evaluate(() => { const b = document.getElementById('gt-play') || document.querySelector('#g-title [data-start], #g-title button'); if (b) b.click(); return !!b; });
    await sleep(15000);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const save = await p.evaluate(c => { try { return JSON.parse(localStorage.getItem(`oe3d-game-${c}`)); } catch (e) { return null; } }, city);
    must(started && save && Array.isArray(save.pos), 'the game saves where the player stands on leaving', save && save.pos && save.pos.map(v => Math.round(v)).join(','));
    await sleep(1500);
    await p.goto('about:blank');
    await sleep(1500);
    await ctx.close();

    const ev = read();
    const of = (name, f = () => true) => ev.filter(e => e.event === name && f(e.props));
    must(new Set(ev.map(e => e.vid)).size === 1, 'one visitor id', new Set(ev.map(e => e.vid)).size);
    must(of('view', x => x.view === 'globe').length >= 1, 'globe view');
    must(of('view', x => x.view === 'city' && x.city === city).length === 1, 'city model view');
    must(of('view', x => x.view === 'game' && x.city === city).length === 1, 'game view');
    const lc = of('load', x => x.view === 'city' && x.ok), lg = of('load', x => x.view === 'game' && x.ok);
    must(lc.length === 1 && lc[0].props.ms > 0, 'model load: ready, with its time', lc[0] && `${lc[0].props.ms} ms`);
    must(lg.length === 1 && lg[0].props.ms > 0, 'game load: ready, with its time', lg[0] && `${lg[0].props.ms} ms`);
    const tg = of('time', x => x.view === 'game');
    const playS = tg.reduce((s, e) => s + e.props.s, 0);
    must(playS > 3, 'play time counted', `${playS.toFixed(1)} s`);
    must(tg.some(e => e.props.fps > 0 && e.props.frames > 0), 'frame rate measured', tg.map(e => e.props.fps).join(','));
    must(of('time', x => x.view === 'city').length >= 1, 'time on the model counted');
    must(of('page').length >= 1, 'page timings', of('page').map(e => `ttfb ${e.props.ttfb}`).join(','));
    must(ev.every(e => e.props.sid && e.props.device && e.props.tier), 'every event has its session, device and tier');
    must(!ev.some(e => JSON.stringify(e).includes('@')), 'no email-like value in any event');
    let rep = null;
    try { execFileSync('python3', [path.join(__dirname, 'slo_report.py'), log], { stdio: 'inherit' }); } catch (e) { /* a missed level exits 1 */ }
    try { rep = JSON.parse(execFileSync('python3', [path.join(__dirname, 'slo_report.py'), log, '--json']).toString()); } catch (e) { rep = e.stdout ? JSON.parse(e.stdout.toString()) : null; }
    must(rep && rep.visitors === 1 && rep.players === 1 && rep.slo.length === 7, 'the SLO report reads the log', rep && `${rep.visitors} visitor, ${rep.play_hours} h`);
    must(!errors.length, 'no page errors', errors.join(' | '));
    exit = fails.length ? 1 : 0;
  } catch (e) {
    console.log('FAIL', String(e).slice(0, 400));
  } finally {
    await b.close();
    srv.kill();
  }
  console.log(fails.length ? `telemetry check: ${fails.length} failed` : 'telemetry check: all passed');
  process.exit(exit);
})();
