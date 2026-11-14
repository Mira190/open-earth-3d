// A heap snapshot of a city's game some seconds into its load on a phone's tier, for tools/heap_owners.js: who holds
// the array buffers at the load's peak, which tools/mem_check.js SNAP only shows once the game has settled.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/heap_at.js shibuya 3.5 /tmp/shibuya-3s.heapsnapshot && node tools/heap_owners.js /tmp/shibuya-3s.heapsnapshot
const { chromium } = require('playwright');
const fs = require('fs');
const [city = 'shibuya', at = '3.5', out = 'load.heapsnapshot'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  const t0 = Date.now();
  p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ''}#play-${city}`).catch(() => {});
  await new Promise(r => setTimeout(r, +at * 1000));
  const fd = fs.openSync(out, 'w');
  cdp.on('HeapProfiler.addHeapSnapshotChunk', e => fs.writeSync(fd, e.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  fs.closeSync(fd);
  console.log(`${out}: ${(fs.statSync(out).size / 1048576).toFixed(0)} MB, taken ${((Date.now() - t0) / 1000).toFixed(1)} s in`);
  await b.close();
})();
