// The site's telemetry end to end (web/telemetry.js -> tools/telemetry_server.py -> tools/slo_report.py):
// opens the globe, a city's model and its game with ?telemetry=<the collector>, waits for each loader to
// fade, plays a little, hides the tab and leaves, then reads the log and checks that the views, the loads
// (ready, with a time), the time on screen with its frame rate, and the page's own timings all arrived,
// that the report can be built from them, and that without the parameter an automated browser sends nothing.
// Also the behaviour events: the model's tour stop by stop to its end, where the player is in the game
// (spot and mode on every event, "dwell" by spot), the game started from its title, how the page ended
// ("exit"), and a page left dead on screen by an earlier visit reported as a "crash".
// Also checks that a game in progress keeps the player's position when the page is closed (the save), and
// the load's stages (data fetched, decoded, first frame, loader gone) on the title screen, the model, the
// game and a reef site, each in order and within the load's time.
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
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('oe3d-quality', 'low');
        // an earlier page of the site that died on screen a minute ago: the first page load must report it
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('oe3d-alive-0123456789abcdef01234567', JSON.stringify({ t: Date.now() - 60000, up: 300, ready: true, view: 'game', city: 'testville', spot: 'Test Wharf', mode: 'foot' }));
          // and this tab's own last page, dead three seconds ago in the middle of a load (Safari loads a killed tab again
          // at once): the tab's session storage names it, so it is counted though it is younger than another tab's would be
          sessionStorage.setItem('oe3d-sid', 'aaaaaaaaaaaaaaaaaaaaaaaa');
          localStorage.setItem('oe3d-alive-aaaaaaaaaaaaaaaaaaaaaaaa', JSON.stringify({ t: Date.now() - 3000, up: 14, ready: false, stage: 'late people', view: 'game', city: 'sametab' }));
        }
      } catch (e) { /* storage blocked */ }
    });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    const T = encodeURIComponent(`http://127.0.0.1:${CPORT}/e`);
    await p.goto(`http://localhost:${PORT}/?telemetry=${T}#globe`, { waitUntil: 'load', timeout: 120000 });
    must(await p.evaluate(() => window.OETelemetry.on), 'on with ?telemetry=<collector>');
    // the title screen reports its load once its opening or its menu is drawn
    await p.waitForFunction(() => performance.getEntriesByName('oe:ready').length > 0, null, { timeout: 180000 }).catch(() => {});
    await sleep(1500);
    // the city's model, then its game
    await p.evaluate(c => { location.hash = c; }, city);
    await p.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.classList.contains('out'); }, null, { timeout: 600000 });
    // the tour: wait for its first stop, step through every stop to its end, then take the view over
    await p.waitForFunction(() => window.__city && window.__city.tour.i >= 0, null, { timeout: 60000 }).catch(() => {});
    const stops = await p.evaluate(async () => {
      const T = window.OETelemetry, n = document.querySelectorAll('#cap-bars span').length;
      for (let i = 0; i < n + 1; i++) {
        T.sample();
        const b = document.getElementById('cap-skip');
        if (b.hidden) break;
        b.click();
        await new Promise(r => setTimeout(r, 300));
      }
      T.sample();
      return n;
    });
    const cityHere = await p.evaluate(() => window.OETelemetry.here());
    await sleep(2500);
    await p.evaluate(c => { location.hash = `play-${c}`; }, city);
    await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return l && l.classList.contains('out'); }, null, { timeout: 600000 });
    // start a new game and stand somewhere, then close the page: the position must be saved
    await p.waitForFunction(() => { const b = document.getElementById('gt-play') || document.querySelector('#g-title button'); return b && b.offsetParent; }, null, { timeout: 120000 }).catch(() => {});
    // (the title seen once by the 1 s sampler first, as a person on it would be: a click the instant it shows can fall between two samples)
    await p.evaluate(() => window.OETelemetry.sample());
    const started = await p.evaluate(() => { const b = document.getElementById('gt-play') || document.querySelector('#g-title [data-start], #g-title button'); if (b) b.click(); return !!b; });
    await sleep(15000);
    await p.evaluate(() => window.OETelemetry.sample());
    const gameHere = await p.evaluate(() => window.OETelemetry.here());
    await p.evaluate(() => window.OETelemetry.set({ probe: 1 }));      // what a governor would report of itself
    // a loaded software renderer can draw under a frame a second: play on until the frame rate has its samples
    await p.waitForFunction(() => window.OETelemetry.frames() >= 20, null, { timeout: 90000, polling: 1000 }).catch(() => {});
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const save = await p.evaluate(c => { try { return JSON.parse(localStorage.getItem(`oe3d-game-${c}`)); } catch (e) { return null; } }, city);
    const sameTab = await p.evaluate(() => window.OEQuality.died('sametab'));
    const died = await p.evaluate(() => { try { return { n: JSON.parse(localStorage.getItem('oe3d-died-testville')).n, died: window.OEQuality.died('testville'), other: window.OEQuality.died('nowhere') }; } catch (e) { return null; } });
    must(started && save && Array.isArray(save.pos), 'the game saves where the player stands on leaving', save && save.pos && save.pos.map(v => Math.round(v)).join(','));
    await sleep(1500);
    await p.goto('about:blank');
    await sleep(1500);
    // a reef site: its own page and loader (#load "done"), its data from reef/world.js
    const reef = process.env.REEF || 'hardy-reef';
    if (fs.existsSync(path.join(__dirname, '..', 'web', 'data', reef, 'scene.json'))) {
      await p.goto(`http://localhost:${PORT}/reef/?city=${reef}&telemetry=${T}`, { waitUntil: 'load', timeout: 120000 });
      await p.waitForFunction(() => window.__ready === true, null, { timeout: 600000 }).catch(() => {});
      // (frames enough for the page's own GPU report, every sixteenth frame from the tenth on: reef/main.js)
      await p.waitForFunction(() => window.OETelemetry && window.OETelemetry.frames() > 40, null, { timeout: 300000 }).catch(() => {});
      await sleep(1500);
      await p.goto('about:blank');
      await sleep(1500);
    }
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
    // the stages: present, in order, and none after the loader went (the title's are its own: fetched, decoded, ready)
    const staged = (e, keys) => {
      if (!e) return false;
      const v = keys.map(k => e.props[k]);
      return v.every(x => typeof x === 'number' && x >= 0) && v.every((x, i) => i === 0 || x >= v[i - 1]) && v[v.length - 1] <= e.props.ms;
    };
    const stg = e => e && ['fetch_ms', 'decode_ms', 'build_ms', 'frame_ms', 'ms'].map(k => `${k.replace('_ms', '')} ${e.props[k]}`).join(', ');
    must(staged(lc[0], ['fetch_ms', 'decode_ms', 'build_ms', 'frame_ms']), 'model load: fetched, decoded, built, first frame, ready, in order', stg(lc[0]));
    must(staged(lg[0], ['fetch_ms', 'decode_ms', 'build_ms', 'frame_ms']), 'game load: fetched, decoded, built, first frame, ready, in order', stg(lg[0]));
    if (fs.existsSync(path.join(__dirname, '..', 'web', 'data', process.env.REEF || 'hardy-reef', 'scene.json'))) {
      // the WebGPU page reports its own frame (OETelemetry.gpu): draws, triangles and pixels, and the kind of site
      const tr = of('time', x => x.view === 'reef' && x.frames >= 10);
      must(tr.length && tr.every(e => e.props.site === 'marine') && tr.some(e => e.props.draws > 10 && e.props.tris_k > 1 && e.props.px_k > 0),
        'a reef site reports its kind and its own frame: draws, triangles, pixels', tr.map(e => `${e.props.site} ${e.props.frames} frames, ${e.props.draws} draws, ${e.props.tris_k}k tris, ${e.props.px_k}k px, gpu ${e.props.gpu_ms}`).join('; ') || 'no reef time event');
    }
    const lt = of('load', x => x.view === 'globe' && x.ok);
    must(lt.length === 1 && staged(lt[0], ['frame_ms']) && staged(lt[0], ['decode_ms']) && lt[0].props.ms > 0, 'title screen load: once, with its first frame and textures before ready', stg(lt[0]));
    const lr = of('load', x => x.view === 'reef' && x.ok);
    if (fs.existsSync(path.join(__dirname, '..', 'web', 'data', process.env.REEF || 'hardy-reef', 'scene.json'))) {
      must(lr.length === 1 && staged(lr[0], ['fetch_ms', 'decode_ms', 'build_ms', 'frame_ms']), 'reef site load: fetched, decoded, built, first frame, ready, in order', stg(lr[0]));
    }
    must(of('load').every(e => e.props.v >= 3), 'load events carry telemetry version 3');
    const tg = of('time', x => x.view === 'game');
    const playS = tg.reduce((s, e) => s + e.props.s, 0);
    must(playS > 3, 'play time counted', `${playS.toFixed(1)} s`);
    must(tg.some(e => e.props.fps > 0 && e.props.frames > 0), 'frame rate measured', tg.map(e => e.props.fps).join(','));
    must(of('time', x => x.view === 'city').length >= 1, 'time on the model counted');
    must(of('page').length >= 1, 'page timings', of('page').map(e => `ttfb ${e.props.ttfb}`).join(','));
    must(ev.every(e => e.props.sid && e.props.device && e.props.tier), 'every event has its session, device and tier');
    must(!ev.some(e => JSON.stringify(e).includes('@')), 'no email-like value in any event');
    // the behaviour events
    const ts = of('tour', x => x.view === 'city' && x.action === 'stop').map(e => e.props.stop);
    must(stops > 0 && ts.includes(1) && ts.includes(stops), 'the tour reports its stops', `${ts.join(',')} of ${stops}`);
    must(of('tour', x => x.view === 'city' && x.action === 'end').length === 1, 'the tour reports its end');
    must(cityHere && cityHere.stops === stops, 'the model view knows where the tour is', cityHere && JSON.stringify(cityHere).slice(0, 120));
    must(of('time', x => x.view === 'city').some(e => e.props.tour === 'done'), 'events after the tour say it was watched to the end');
    must(gameHere && gameHere.spot && gameHere.mode === 'foot', 'the game view knows the spot and the mode', gameHere && `${gameHere.spot} (${gameHere.mode})`);
    must(of('mode', x => x.view === 'game' && x.start).length === 1, 'leaving the game\'s title screen is counted');
    must(of('time', x => x.view === 'game').every(e => e.props.spot && e.props.mode), 'every play event carries its spot and mode');
    const dw = of('dwell', x => x.view === 'game' && x.mode === 'foot');
    must(dw.length >= 1 && dw.reduce((s, e) => s + e.props.s, 0) > 3, 'time on foot is summed by spot', dw.map(e => `${e.props.spot} ${e.props.s}s`).join('; '));
    must(tg.every(e => e.props.eng_s != null), 'engaged time is counted');
    // the device and the frame's cost (version 4)
    const t3 = of('time', x => x.view === 'game' && x.frames >= 10);
    must(of('view').every(e => e.props.v >= 4 && e.props.os && e.props.browser && e.props.gpu_class), 'every event carries the device: system, browser, GPU class', JSON.stringify((of('view')[0] || {}).props || {}).slice(0, 0) + `${(of('view')[0] || { props: {} }).props.gpu} (${(of('view')[0] || { props: {} }).props.gpu_class})`);
    must(t3.length && t3.every(e => e.props.f95 >= 2 && e.props.f99 >= e.props.f95 && e.props.fmax > 0 && e.props.hz >= 30 && e.props.bound), 'play time carries the frame\'s tail and what bound it', t3[0] && `f95 ${t3[0].props.f95} ms, f99 ${t3[0].props.f99} ms, max ${t3[0].props.fmax} ms, ${t3[0].props.hz} Hz, ${t3[0].props.bound}`);
    must(t3.some(e => e.props.cpu_ms > 0), 'the main thread\'s work per frame is measured', t3.map(e => e.props.cpu_ms).join(', '));
    must(t3.some(e => e.props.draws > 10 && e.props.tris_k > 1 && e.props.passes >= 1 && e.props.px_k > 0), 'a sampled frame\'s draw calls, triangles, passes and pixels are counted', t3.map(e => `${e.props.draws} draws, ${e.props.tris_k}k triangles, ${e.props.passes} passes, ${e.props.px_k}k px`).join('; '));
    console.log(`     GPU time per frame: ${t3.map(e => e.props.gpu_ms).filter(x => x != null).join(', ') || 'no timer query in this browser'}`);
    must(of('time', x => x.view === 'city' && x.frames >= 10).some(e => e.props.draws > 0), 'the model view counts its draws too');
    const lgw = of('load', x => x.view === 'game' && x.ok)[0];
    must(lgw && lgw.props.req > 0 && lgw.props.kb >= 0 && lgw.props.cached != null, 'a load says what it brought over the network', lgw && `${lgw.props.kb} kB in ${lgw.props.req} requests, ${lgw.props.cached} cached`);
    must(of('dwell', x => x.view === 'game').some(e => e.props.fps > 0), 'the frame rate is counted by spot', of('dwell', x => x.view === 'game').map(e => `${e.props.spot} ${e.props.fps} fps`).join('; '));
    must(of('quality', x => x.view === 'game').some(e => e.props.probe === 1), 'a view\'s own state (OETelemetry.set) is reported as it changes and rides on the time events', JSON.stringify(of('time', x => x.view === 'game').map(e => e.props.probe)));
    const ex = of('exit', x => x.view === 'game');
    must(ex.length === 1 && ex[0].props.view === 'game' && ex[0].props.page_s > 0, 'the page says how it ended', ex[0] && `page ${ex[0].props.page_s} s, idle ${ex[0].props.idle_s} s`);
    const cr = of('crash');
    const crT = cr.filter(e => e.props.prev_city === 'testville'), crS = cr.filter(e => e.props.prev_city === 'sametab');
    must(cr.length === 2 && crT.length === 1 && crT[0].props.prev_spot === 'Test Wharf', 'a page that died on screen is reported once by the next', cr.length);
    must(crS.length === 1 && crS[0].props.prev_stage === 'late people' && crS[0].props.prev_ready === false, 'this tab\'s own page, dead seconds ago mid-load, is reported with the step it died at', crS[0] && crS[0].props.prev_stage);
    must(sameTab === 1, 'and counted against its map at once, so the load Safari starts again is lighter', sameTab);
    must(died && died.n === 1 && died.died === 1 && died.other === 0, 'and counted against its map, for a lighter load there next (quality.js died)', JSON.stringify(died));
    must(of('view', x => x.view === 'game').every(e => e.props.from === `city:${city}`), 'a view says which view it came from');
    let rep = null;
    try { execFileSync('python3', [path.join(__dirname, 'slo_report.py'), log], { stdio: 'inherit' }); } catch (e) { /* a missed level exits 1 */ }
    try { rep = JSON.parse(execFileSync('python3', [path.join(__dirname, 'slo_report.py'), log, '--json']).toString()); } catch (e) { rep = e.stdout ? JSON.parse(e.stdout.toString()) : null; }
    must(rep && rep.visitors === 1 && rep.players === 1 && rep.slo.length === 9 && rep.tour.ended === 1 && Object.keys(rep.minutes_by_spot).length > 0, 'the SLO report reads the log', rep && `${rep.visitors} visitor, ${rep.play_hours} h`);
    must(rep && rep.load_stages && rep.load_stages['city desktop'] && rep.load_stages['city desktop'].built != null && rep.releases && Object.keys(rep.releases).length, 'the report has the load stages and the releases');
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
