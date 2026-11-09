// A reef or alpine site's load (issue 327): its stages (telemetry.js: oe:fetched, decoded, built, frame), the
// loader's steps between decoded and built with how long each stood, and a CPU profile of that build, its
// functions ranked by inclusive and by self time. On the software renderer here (Mesa llvmpipe under xvfb-run):
// read the JavaScript first, the GPU's share as an upper bound.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/reef_load.js whitsundays [WxH, 1440x900]      (TIER=high forces a picture tier; TOP=20)
const { chromium } = require('playwright');
const [,, site = 'whitsundays', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => {
    try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ }
    window.__steps = [];
    addEventListener('DOMContentLoaded', () => {
      const m = document.getElementById('load-msg');
      if (m) new MutationObserver(() => { const l = window.__steps[window.__steps.length - 1], t = m.textContent.replace(/: [\d.]+( of [\d.]+)? MB$/, ''); if (!l || l[1] !== t) window.__steps.push([performance.now(), t]); }).observe(m, { childList: true, characterData: true, subtree: true });
    });
  }, process.env.TIER || 'high');
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  const t0 = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?city=${site}`, { waitUntil: 'commit' });
  await cdp.send('Profiler.start');
  const sync = await p.evaluate(() => performance.now()).catch(() => 0);
  await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 900000, polling: 250 });
  const ready = (Date.now() - t0) / 1000;
  const { profile } = await cdp.send('Profiler.stop');
  const st = await p.evaluate(() => ({ marks: performance.getEntriesByType('mark').filter(m => /^oe:/.test(m.name)).map(m => [m.name.slice(3), m.startTime]), steps: window.__steps.slice(), now: performance.now(), err: document.getElementById('err').textContent }));
  await b.close();
  const mk = Object.fromEntries(st.marks);
  console.log(`${site} ${size}: ready after ${ready.toFixed(1)} s; stages (s): ${st.marks.map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', ')}`);
  if (mk.decoded == null || mk.built == null) { console.log('no build stage', st.err, errors); return; }
  const end = mk.frame ?? st.now;
  // the profile in a window: its loader steps, and its functions by self and inclusive time
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const label = n => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${c.url.replace(/^.*\/web\//, '').replace(/^https?:\/\/[^/]+\//, '')}:${c.lineNumber + 1}`; };
  const windowOf = (what, a, z) => {
  console.log(`${what}, ${((z - a) / 1000).toFixed(1)} s, by the loader's step:`);
  st.steps.forEach(([t, msg], i) => { const e = (st.steps[i + 1] || [st.now])[0], d = Math.min(e, z) - Math.max(t, a); if (d >= 50) console.log(`  ${(d / 1000).toFixed(2).padStart(6)} s  ${msg.slice(0, 90)}`); });
  const self = new Map(), incl = new Map();
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    const tp = (t - profile.startTime) / 1000 + sync;
    if (tp < a || tp > z) continue;
    const dt = (profile.timeDeltas[i + 1] || 1000) / 1000, n = nodes.get(profile.samples[i]);
    self.set(label(n), (self.get(label(n)) || 0) + dt);
    const seen = new Set();
    for (let id = profile.samples[i]; id != null; id = parent.get(id)) {
      const q = nodes.get(id); if (!/^https?:/.test(q.callFrame.url) || /vendor/.test(q.callFrame.url)) continue;
      const k = label(q); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); }
    }
  }
  const best = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)}  ${k}`).join('\n');
  const N = +(process.env.TOP || 20);
  console.log('  self (ms):\n' + best(self, N));
  console.log('  inclusive, the app\'s (ms):\n' + best(incl, N));
  };
  windowOf('build (decoded to built)', mk.decoded, mk.built);
  windowOf('after it (built to the first frame)', mk.built, end);
  if (errors.length || st.err) console.log('page errors:', errors, st.err);
})();
