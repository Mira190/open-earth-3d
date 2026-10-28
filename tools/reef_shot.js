// Screenshot the reef viewer headlessly (software WebGL2; WebGPU is not usable in the sandbox).
//   cd web && python3 -m http.server 8800 &        # serve web/ on 8800
//   NODE_PATH=$(npm root -g) node tools/reef_shot.js "still=1&gl=1&freeze=5&x=900&y=450&z=-1&pitch=-40&yaw=70" out.png [waitMs] [0]
// Query: still=1 renders two frames and stops; gl=1 forces WebGL2; freeze=<s> fixes the clock for waves;
// x,y,z = east, north, up in metres (z < 0 is under water); yaw/pitch in degrees (yaw 90 looks west);
// time=<ISO> sets the sun; exp=<n> exposure; wind=<0..1>; tide=<m>; mods=a,b loads only those modules.
const { chromium } = require('playwright');
const [,, query, out, wait = '8000', gpu = '1'] = process.argv;
(async () => {
  const args = ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (gpu === '1') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
  const b = await chromium.launch({ args });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
  p.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 600)));
  await p.goto('http://localhost:8800/reef/index.html?' + query);
  try { await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 170000 }); } catch (e) { logs.push('timeout waiting ready'); }
  await p.waitForTimeout(Number(wait));
  const hud = await p.evaluate(() => document.getElementById('hud').textContent + ' | ' + document.getElementById('err').textContent.slice(0, 800));
  await p.screenshot({ path: out });
  console.log(hud); console.log(logs.slice(0, 12).join('\n'));
  await b.close();
})();
