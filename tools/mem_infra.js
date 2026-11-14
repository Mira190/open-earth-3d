// Where a loading city's memory is, by allocator, at chosen seconds of the load: Chromium's own memory dump
// (memory-infra, the tracing category) of the renderer process, summed by its top-level allocators (v8, the
// array buffers and the rest of partition_alloc, malloc, blink's objects, decoded images, canvases, the WebGL
// command buffers). The page's heap that tools/mem_timeline.js prints is a small part of what an iPhone counts;
// this names the rest (docs/PERFORMANCE.md, "A map built round the player").
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/mem_infra.js shibuya 4,8,14,30        (TIER=low|medium|high, DEPTH=2 names two levels)
const { chromium } = require('playwright');
const [city = 'shibuya', at = '4,8,14,30'] = process.argv.slice(2);
const DEPTH = +(process.env.DEPTH || 2), TOP = +(process.env.TOP || 14);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'low');
  if (process.env.LV) await ctx.addInitScript(n => { try { localStorage.setItem('oe3d-lv', n); } catch (e) { /* storage blocked */ } }, process.env.LV); // (a phone's set at level n: quality.js level)
  const p = await ctx.newPage();
  const bs = await b.newBrowserCDPSession();
  const events = [];
  bs.on('Tracing.dataCollected', e => events.push(...e.value));
  await bs.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
  const t0 = Date.now();
  p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}${process.env.QUERY || ''}`).catch(() => {});
  const marks = [];
  for (const s of at.split(',').map(Number)) {
    await new Promise(r => setTimeout(r, Math.max(0, s * 1000 - (Date.now() - t0))));
    // (a renderer busy building does not answer in time: asked again, and the second it was taken at is the one printed)
    let r = null;
    for (let k = 0; k < 8 && !(r && r.success); k++) r = await bs.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed' }).catch(e => ({ error: e.message }));
    marks.push({ s: +((Date.now() - t0) / 1000).toFixed(1), guid: r.dumpGuid });
  }
  const done = new Promise(r => bs.once('Tracing.tracingComplete', r));
  await bs.send('Tracing.end'); await done;
  // each process's dump for a guid: allocators { name: { attrs: { size, effective_size } } }
  const names = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'process_name') names[e.pid] = e.args.name;
  for (const m of marks) {
    console.log(`\n== ${m.s} s`);
    const byPid = {};
    for (const e of events) if (e.ph === 'v' && e.id === m.guid && e.args && e.args.dumps) (byPid[e.pid] = byPid[e.pid] || []).push(e.args.dumps);
    for (const [pid, dumps] of Object.entries(byPid)) {
      if (!/^Renderer|GPU/i.test(names[pid] || '')) continue;
      const sum = {}; let rss = 0;
      for (const d of dumps) {
        if (d.process_totals) rss = parseInt(d.process_totals.resident_set_bytes || '0', 16);
        for (const [k, v] of Object.entries(d.allocators || {})) {
          const sz = v.attrs && v.attrs.size ? parseInt(v.attrs.size.value, 16) : 0;
          if (!sz || /^global\//.test(k)) continue;
          const parts = k.split('/');
          // leaves only: a parent's size is the sum of its children where it has any
          const key = parts.slice(0, DEPTH).join('/');
          (sum[key] = sum[key] || { leaf: 0, own: {} }).own[k] = sz;
        }
      }
      const rows = Object.entries(sum).map(([k, v]) => { // the largest entry at or above the key's depth stands for its subtree
        const ks = Object.keys(v.own).sort((a, c) => a.length - c.length);
        return [k, v.own[ks[0]]];
      }).filter(r => !/allocated_objects|shim_allocated/.test(r[0])).sort((a, c) => c[1] - a[1]).slice(0, TOP);
      if (!rows.length || rows[0][1] < 64 << 20) continue; // (the city's renderer and the GPU process, not the helpers)
      console.log(`${names[pid]}:`);
      for (const [k, v] of rows) if (v > 8 << 20) console.log(`  ${(v / 1048576).toFixed(0).padStart(5)} MB  ${k}`);
    }
  }
  await b.close();
})();
