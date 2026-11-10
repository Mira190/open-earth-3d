// Where a reef or alpine view's frame goes: the median frame time with everything drawn, then with each group of
// meshes hidden in turn (grouped by their top-level parent and material; only meshes are hidden, never lights, so no
// shader is rebuilt between the two), the difference being that group's cost. Software WebGL here (llvmpipe), so the
// numbers weigh fragment work heavily: read them as shares, not as a GPU's milliseconds. A small viewport keeps it quick.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) xvfb-run -a node tools/reef_parts.js "city=milford-sound&x=4000&y=-6000&z=500&yaw=50&pitch=2&mods=boats,alpine/fiord"
// TIER (env): the picture tier (default high); W/H: the viewport (default 640 x 400). Add mirror=0&post=0 to the query to
// leave the lake's mirror and the post chain out of the total.
const { chromium } = require('playwright');
const [,, query = 'city=milford-sound'] = process.argv;
(async () => {
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'];
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  const p = await b.newPage({ viewport: { width: Number(process.env.W || 640), height: Number(process.env.H || 400) } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  p.on('console', m => { if (m.type() === 'log') console.log(m.text()); });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?gl=1&freeze=5&${query}`);
  await p.waitForFunction('window.__ready || document.getElementById("err").textContent', null, { timeout: 300000 });
  await p.evaluate(async () => {
    const R = window.__reef, raf = () => new Promise(r => requestAnimationFrame(r));
    const med = async () => { for (let i = 0; i < 2; i++) await raf(); const d = []; let t0 = performance.now(); for (let i = 0; i < 6; i++) { await raf(); const t = performance.now(); d.push(t - t0); t0 = t; } d.sort((a, b) => a - b); return d[3]; };
    const groups = {};
    R.ctx.scene.traverse(o => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      let top = o; while (top.parent && top.parent !== R.ctx.scene) top = top.parent;
      const k = `${top.name || top.type}/${o.material && o.material.type}${o.name ? ':' + o.name.slice(0, 20) : ''}`;
      (groups[k] = groups[k] || []).push(o);
    });
    const all = await med(); console.log(`everything ${all.toFixed(0)} ms`);
    for (const [k, list] of Object.entries(groups)) {
      const vis = list.map(o => o.visible); if (!vis.some(Boolean)) continue;
      list.forEach(o => { o.visible = false; }); const ms = await med(); list.forEach((o, i) => { o.visible = vis[i]; });
      if (all - ms > all * 0.03) console.log(`${(all - ms).toFixed(0).padStart(6)} ms  ${k} x${list.length}`);
    }
  });
  await b.close();
})();
