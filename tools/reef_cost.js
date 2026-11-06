// What a reef or alpine view costs at each picture tier: triangles drawn a frame (every pass: the scene, the lake's
// mirror, the post chain) and the mean frame time, on the software renderer here (Mesa llvmpipe under xvfb-run).
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) xvfb-run -a node tools/reef_cost.js lake-tekapo lupins [high,medium,low] [frames]
// The view is a shot from the site's city.json "shots" (its month too). The tier is set as the About panel sets it
// (localStorage oe3d-quality, web/quality.js); W/H (env) set the viewport (default 1440 x 900; 390 x 844 for a phone).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, site = 'lake-tekapo', shotId = 'lupins', tiersArg = 'high,medium,low', framesArg = '12'] = process.argv;
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cities', site, 'city.json'), 'utf8'));
// VIEW (env): a JSON pose ({x, y, z, yaw, pitch}) laid over the shot, for a site with no shots
const s = Object.assign({}, (cfg.shots || []).find(v => v.id === shotId) || cfg.start || {}, JSON.parse(process.env.VIEW || '{}'));
(async () => {
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'];
  const W = Number(process.env.W || 1440), H = Number(process.env.H || 900), mobile = !!process.env.MOBILE;
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  for (const tier of tiersArg.split(',')) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1), isMobile: mobile, hasTouch: mobile });
    await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, tier);
    let time = s.time && s.time !== 'night' ? s.time : '2026-11-06T01:30:00Z';
    if (s.month) { const t = new Date(time); t.setUTCMonth(s.month - 1); time = t.toISOString(); }
    const q = ['gl=1', 'freeze=5', `city=${site}`, `x=${s.x}`, `y=${s.y}`, `z=${s.z}`, `yaw=${s.yaw ?? 0}`, `pitch=${s.pitch ?? 0}`, `fov=${s.fov ?? 60}`,
      `time=${time}`, `mods=${process.env.MODS || s.mods || (cfg.kind === 'alpine' ? 'alpine/flora,alpine/landmarks' : 'life,boats')}`, process.env.EXTRA || ''].filter(Boolean).join('&');
    await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?${q}`);
    await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 300000 });
    const r = await p.evaluate(async n => {
      const R = window.__reef.renderer, raf = () => new Promise(res => requestAnimationFrame(res));
      for (let i = 0; i < 4; i++) await raf();           // let the far lupins and the patch settle
      const tris = [], dts = [];
      let t0 = performance.now();
      for (let i = 0; i < n; i++) { await raf(); const t = performance.now(); dts.push(t - t0); t0 = t; tris.push(R.info.render.triangles); }
      dts.sort((a, b) => a - b);
      // the instanced meshes' share: instances x triangles, the largest first
      // (summed over a set's parts, the ones in view: an alpine set is split into sectors that are culled, flora.js Ring)
      const by = {}, cam = window.__reef.camera, fr = new window.__reef.ctx.THREE.Frustum().setFromProjectionMatrix(new window.__reef.ctx.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      window.__reef.ctx.scene.traverse(o => {
        if (!o.isInstancedMesh || !o.count || !o.visible || (o.frustumCulled && o.boundingSphere && !fr.intersectsSphere(o.boundingSphere))) return;
        const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3, k = (o.name || '?').split(':')[0];
        const e = by[k] || (by[k] = [k, 0, Math.round(t), 0]); e[1] += o.count; e[3] += o.count * t;
      });
      const inst = Object.values(by).sort((a, b) => b[3] - a[3]);
      return { tris: Math.max(...tris), ms: dts[Math.floor(dts.length / 2)], calls: R.info.render.drawCalls ?? R.info.render.calls, tier: window.__reef.tier && window.__reef.tier.name,
        pr: R.getPixelRatio(), inst: inst.slice(0, 10).map(v => `${v[0]} ${v[1]}x${v[2]}=${(v[3] / 1e6).toFixed(2)}M`).join(', '), err: document.getElementById('err').textContent.slice(0, 200) };
    }, Number(framesArg));
    console.log(`${site} ${shotId} ${W}x${H} ${tier}: ${(r.tris / 1e6).toFixed(2)} M triangles, ${r.calls} draws, median frame ${r.ms.toFixed(0)} ms, pixel ratio ${r.pr} (viewer's tier: ${r.tier || 'none'}) ${r.err}\n  instanced: ${r.inst}`);
    await p.close();
  }
  await b.close();
})();
