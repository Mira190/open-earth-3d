// The reef or alpine viewer on WebGPU in this sandbox: Chromium's Dawn over Mesa's lavapipe (software Vulkan;
// apt-get install mesa-vulkan-drivers). Reports each WGSL module's compile errors (Tint's, uniformity included) and
// the page's WebGPU errors, and writes every module to OUT_WGSL (a folder) for a second validator (naga: pip install
// wgpu). Runs headless (no xvfb-run): under a display Chromium loses the device. It cannot take a still: the canvas
// reads back empty headless, so look at the picture with tools/reef_shot.js (WebGL2), which draws the same nodes.
//   NODE_PATH=$(npm root -g) node tools/reef_webgpu.js "city=milford-sound&x=...&mods=..." [waitMs]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, query, wait = '8000'] = process.argv;
(async () => {
  const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=native', '--use-webgpu-adapter=default',
    '--ignore-gpu-blocklist', '--disable-vulkan-surface', '--use-angle=vulkan', '--disable-gpu-sandbox'];
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  const p = await b.newPage({ viewport: { width: Number(process.env.W || 960), height: Number(process.env.H || 540) } });
  await p.addInitScript(t => {
    try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ }
    window.__wgsl = [];
    const hook = () => {
      if (!window.GPUDevice) return;
      const orig = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (d) {
        const m = orig.call(this, d);
        const i = window.__wgsl.push({ code: d.code, msgs: null }) - 1;
        if (m.getCompilationInfo) m.getCompilationInfo().then(ci => { window.__wgsl[i].msgs = ci.messages.filter(x => x.type === 'error').map(x => `${x.lineNum}:${x.linePos} ${x.message}`); }).catch(() => {});
        return m;
      };
    };
    hook();
  }, process.env.TIER || 'high');
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/"uv" not found/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 400)); });
  p.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 400)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?${query}`);
  try { await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 280000 }); } catch (e) { logs.push('timeout waiting ready'); }
  await p.waitForTimeout(Number(wait));
  const r = await p.evaluate(() => ({ hud: document.getElementById('hud').textContent, err: document.getElementById('err').textContent.slice(0, 400), wgsl: window.__wgsl }));
  const dir = process.env.OUT_WGSL;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); r.wgsl.forEach((m, i) => fs.writeFileSync(path.join(dir, `m${String(i).padStart(3, '0')}.wgsl`), m.code)); }
  const bad = r.wgsl.filter(m => m.msgs && m.msgs.length);
  console.log(`${r.hud} | ${r.err}\n${r.wgsl.length} WGSL modules, ${bad.length} with compile errors`);
  for (const m of bad.slice(0, 5)) console.log('  ' + m.msgs.slice(0, 3).join('\n  '));
  console.log(logs.slice(0, 12).join('\n'));
  await b.close();
})();
