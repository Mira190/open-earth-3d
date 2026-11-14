// A city's game loading on a phone's tier, as a timeline: every half second the page's JavaScript heap
// (with its Workers'), the renderer process's resident memory, and the last stage the loader named
// (#g-loader's text and the performance marks oe:fetched, oe:decoded, oe:built, oe:frame). It shows where
// the peak of a load is, which tools/mem_check.js only sums: an iPhone kills the tab at the peak.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/mem_timeline.js shibuya [seconds]
const { chromium } = require('playwright');
const fs = require('fs');
const [city = 'shibuya', secs = '150'] = process.argv.slice(2);
const rss = () => { let s = 0; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); if (/--type=renderer/.test(c)) s += +(/^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${d}/smaps_rollup`, 'utf8')) || [])[1] || 0; } catch (e) { /* gone */ } } return s / 1024; };
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--enable-precise-memory-info'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const workers = [];
  p.on('worker', w => { workers.push(w); w.on('close', () => workers.splice(workers.indexOf(w), 1)); });
  const t0 = Date.now();
  p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`).catch(() => {});
  let peak = 0, last = '';
  while (Date.now() - t0 < +secs * 1000) {
    await new Promise(r => setTimeout(r, 500));
    const m = await cdp.send('Performance.getMetrics').catch(() => null);
    const heap = m ? m.metrics.find(x => x.name === 'JSHeapUsedSize').value / 1048576 : 0;
    let wh = 0;
    for (const w of [...workers]) wh += await Promise.race([w.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0)).catch(() => 0), new Promise(r => setTimeout(() => r(0), 300))]) / 1048576;
    const st = await Promise.race([p.evaluate(() => { const l = document.getElementById('g-loader'), s = l && l.querySelector('.ld-stage'), sm = l && l.querySelector('small');
      return `${performance.getEntriesByType('mark').filter(e => /^oe:/.test(e.name)).map(e => e.name.slice(3)).join(',')} | ${l && !l.classList.contains('out') ? `${s ? s.textContent : ''} / ${sm ? sm.textContent : ''}` : 'playing'}`; }).catch(() => '?'), new Promise(r => setTimeout(() => r('(busy)'), 400))]);
    const tot = heap + wh; peak = Math.max(peak, tot);
    const line = `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  page ${heap.toFixed(0).padStart(4)}  workers ${wh.toFixed(0).padStart(4)}  rss ${rss().toFixed(0).padStart(5)}  ${st}`;
    if (st !== last || tot >= peak) console.log(line);
    last = st;
  }
  console.log(`peak JS heap ${peak.toFixed(0)} MB`);
  await b.close();
})();
