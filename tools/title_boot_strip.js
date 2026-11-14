// A filmstrip of the title screen coming up, from the navigation to a few seconds into the opening,
// to catch what shows for a frame or two before the Earth does (a stray line, a flash, a black frame).
// Every frame is kept, and those with strongly coloured pixels that are neither the amber of the
// type nor the blue of the limb (a rose, a magenta, a green) are listed with where the colour is.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/title_boot_strip.js out_dir [WxH] [utc] [seconds]
// Writes out_dir/f<ms>.png. Phones (W < 600) run at the low tier, others at high (TIER= to force one).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [outDir = 'boot-strip', size = '390x844', utc = '', secs = '14'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const phone = w < 600;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(([tier, at]) => {
    try { localStorage.setItem('oe3d-quality', tier); } catch (e) { /* storage blocked */ }
    if (at) {
      const D = Date, shift = D.parse(at) - D.now();
      window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + shift])); } static now() { return D.now() + shift; } };
    }
  }, [process.env.TIER || (phone ? 'low' : 'high'), utc]);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  const t0 = Date.now();
  p.goto(`http://localhost:${process.env.PORT || 8800}/index.html`, { timeout: 120000 }).catch(() => {});
  const shots = [];
  while (Date.now() - t0 < +secs * 1000) {
    const t = Date.now() - t0;
    const buf = await p.screenshot({ type: 'png' }).catch(() => null);
    if (buf) { const f = path.join(outDir, `f${String(t).padStart(5, '0')}.png`); fs.writeFileSync(f, buf); shots.push(f); }
  }
  // the odd colours, counted in a page of the same browser
  const q = await ctx.newPage();
  for (const f of shots) {
    const r = await q.evaluate(async src => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const rose = R > 110 && B > 60 && G < R * 0.55 && G < B * 0.9, green = G > 110 && R < G * 0.6 && B < G * 0.6;
        if (!rose && !green) continue;
        const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width);
        n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sum[0] += R; sum[1] += G; sum[2] += B;
      }
      return n ? { n, box: [x0, y0, x1, y1], of: [c.width, c.height], mean: sum.map(v => Math.round(v / n)) } : null;
    }, 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
    if (r) console.log(path.basename(f), JSON.stringify(r));
  }
  console.log(`${shots.length} frames in ${outDir}`);
  await b.close();
})();
