// Screenshot the reef viewer headlessly (software WebGL2; WebGPU is not usable in the sandbox).
//   cd web && python3 -m http.server 8800 &        # serve web/ on 8800 (or set PORT)
//   NODE_PATH=$(npm root -g) node tools/reef_shot.js "still=1&gl=1&freeze=5&x=900&y=450&z=-1&pitch=-40&yaw=70" out.png [waitMs] [0]
// Query: still=1 renders two frames and stops; gl=1 forces WebGL2; freeze=<s> fixes the clock for waves;
// x,y,z = east, north, up in metres (z < 0 is under water); yaw/pitch in degrees (yaw 90 looks west);
// time=<ISO> sets the sun; exp=<n> exposure; wind=<0..1>; tide=<m>; mods=a,b loads only those modules.
const { chromium } = require('playwright');
const [,, query, out, wait = '8000', gpu = '1'] = process.argv;
(async () => {
  // under xvfb-run (DISPLAY set) Mesa's llvmpipe through ANGLE's GL backend, about three times faster than SwiftShader
  const args = process.env.DISPLAY ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox']
    : ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (gpu === '1') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  // W, H (env): the viewport, e.g. W=1440 H=900 for a desktop still, W=390 H=844 for a phone (deviceScaleFactor 2, MOBILE=1 for touch)
  const W = Number(process.env.W || 960), H = Number(process.env.H || 540);
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1), isMobile: !!process.env.MOBILE, hasTouch: !!process.env.MOBILE });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
  p.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 600)));
  await p.goto('http://localhost:' + (process.env.PORT || 8800) + '/reef/index.html?' + query);
  try { await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 170000 }); } catch (e) { logs.push('timeout waiting ready'); }
  await p.waitForTimeout(Number(wait));
  // EVAL (env): an expression to run in the page before the shot, its value printed (a probe, or a pose to set)
  if (process.env.EVAL) console.log('eval:', JSON.stringify(await p.evaluate(process.env.EVAL)));
  const hud = await p.evaluate(() => document.getElementById('hud').textContent + ' | ' + document.getElementById('err').textContent.slice(0, 800));
  await p.screenshot({ path: out });
  console.log(hud); console.log(logs.slice(0, 12).join('\n'));
  await b.close();
})();
