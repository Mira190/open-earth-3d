// How much of a frame's geometry is far away: the game's triangles and draw calls in one frame from a
// viewpoint, and the share of the buildings' triangles (one merged mesh, buildings.js) whose corners all lie
// past each distance from the camera. Run before and after a level-of-detail change to see what it saved.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/far_cost.js sydney [views.json] [WxH]
// views.json: tools/game_shot.js's format; only the views from the air ("cam", "tgt") are used, and without
// a file the city's start, from 2 m and from 300 m up. TIER=low|medium|high (default high).
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'sydney', viewsFile = '', size = '1440x900'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(() => {
    const hook = () => {
      if (!window.THREE || !window.THREE.WebGLRenderer || window.THREE.__farCost) return false;
      const R = window.THREE.WebGLRenderer;
      window.THREE.WebGLRenderer = function (...a) { const r = new R(...a); window.__renderer = r; return r; };
      window.THREE.WebGLRenderer.prototype = R.prototype;
      window.THREE.__farCost = true;
      return true;
    };
    if (!hook()) window.addEventListener('three-ready', hook, { once: true });
  });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__renderer', null, { timeout: 300000 });
  await p.waitForTimeout(4000);
  const G = JSON.parse(fs.readFileSync(`web/data/${city}/game.json`, 'utf8'));
  let views = viewsFile ? JSON.parse(fs.readFileSync(viewsFile, 'utf8')).filter(v => v.cam) : null;
  if (!views) {
    const [x, y] = G.start.at, [fx, fy] = G.start.facing;
    views = [{ name: 'street', cam: [x, y, 2], tgt: [fx, fy, 2] }, { name: 'air', cam: [x, y, 300], tgt: [fx, fy, 0] }];
  }
  for (const v of views) {
    const r = await p.evaluate(v => {
      const g = window.__game, R = window.__renderer, cam = g.camera, W = (x, y, z) => new THREE.Vector3(x, z, -y);
      g.hold(true);
      g.frame(0); // the game's own camera step first, then the view put over it
      cam.position.copy(W(...v.cam)); cam.lookAt(W(...v.tgt)); cam.updateMatrixWorld();
      const sc = g.Wd.scene || g.Wd.world;
      // every draw of the frame, through each object's onBeforeRender: which pass (the shadow map's or the
      // view's), its triangles times its instances, and for an instanced mesh each instance's distance
      const drawn = [], hooked = [];
      sc.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
        const prev = o.onBeforeRender;
        const prevS = o.onBeforeShadow;
        hooked.push([o, prev, prevS]);
        o.onBeforeShadow = function (r, obj, c, sc2, gm, mat, grp) {
          const per = (grp ? grp.count : (gm.index ? gm.index.count : gm.attributes.position.count)) / 3;
          const n = o.isInstancedMesh ? o.count : (gm.isInstancedBufferGeometry ? Math.min(gm.instanceCount, 1e7) : 1);
          let nm = o.name || (o.parent && o.parent.name) || (o.material && o.material.name) || o.type;
          if (o.isInstancedMesh || gm.isInstancedBufferGeometry) nm += ` [${Math.round(per)} tris each, ${gm.type}${o.parent && o.parent.parent ? ' in ' + (o.parent.name || o.parent.type) + '/' + (o.parent.parent.name || o.parent.parent.type) : ''}${o.isSkinnedMesh ? ' skinned' : ''}]`;
          drawn.push({ nm, shadow: true, per, n, dists: null, d: 0 });
          if (prevS) prevS.apply(this, arguments);
        };
        o.onBeforeRender = function (r, s, c, gm, mat, grp) {
          const rt = r.getRenderTarget(), shadow = !!(rt && rt.depthTexture && rt.depthTexture.name && /shadow/i.test(rt.depthTexture.name)) || !!(mat && (mat.isMeshDepthMaterial || mat.isMeshDistanceMaterial));
          const per = (grp ? grp.count : (gm.index ? gm.index.count : gm.attributes.position.count)) / 3;
          const n = o.isInstancedMesh ? o.count : (gm.isInstancedBufferGeometry ? Math.min(gm.instanceCount, 1e7) : 1);
          let dists = null;
          if (o.isInstancedMesh && n > 1) {
            const e = o.instanceMatrix.array, mw = o.matrixWorld.elements, cp = c.position || cam.position; dists = new Float32Array(n);
            for (let i = 0; i < n; i++) { const x = e[16 * i + 12], y = e[16 * i + 13], z = e[16 * i + 14]; dists[i] = Math.hypot(mw[0] * x + mw[4] * y + mw[8] * z + mw[12] - cam.position.x, mw[1] * x + mw[5] * y + mw[9] * z + mw[13] - cam.position.y, mw[2] * x + mw[6] * y + mw[10] * z + mw[14] - cam.position.z); }
          }
          const sp = new THREE.Sphere(); if (!gm.boundingSphere) gm.computeBoundingSphere(); sp.copy(gm.boundingSphere).applyMatrix4(o.matrixWorld);
          let nm = o.name || (o.parent && o.parent.name) || ''; if (!nm) nm = (mat && mat.name) || (gm.name) || o.type;
          if (o.isInstancedMesh || gm.isInstancedBufferGeometry) nm += ` [${o.userData.oeKind || (o.parent && o.parent.userData && o.parent.userData.oeKind) || (mat && mat.type)} ${Math.round(per)} tris each]`;
          drawn.push({ nm, shadow, per, n, dists, d: Math.max(0, sp.center.distanceTo(cam.position) - sp.radius) });
          if (prev) prev.apply(this, arguments);
        };
      });
      R.info.autoReset = false; R.info.reset();
      g.frame(0);
      cam.position.copy(W(...v.cam)); cam.lookAt(W(...v.tgt)); cam.updateMatrixWorld();
      R.shadowMap.needsUpdate = true;
      if (g.atmos && g.atmos.composer) g.atmos.composer.render(); else R.render(sc, cam);
      const tris = R.info.render.triangles, calls = R.info.render.calls;
      R.info.autoReset = true;
      for (const [o, prev, prevS] of hooked) { o.onBeforeRender = prev; o.onBeforeShadow = prevS; }
      const out = { tris, calls };
      // by name and pass: triangles, and how many of them lie past 300 m, 800 m and 2 km
      const by = new Map(), B = [300, 800, 2000];
      let tot = { view: 0, shadow: 0 }, far = { view: [0, 0, 0], shadow: [0, 0, 0] };
      for (const q of drawn) {
        const k = (q.shadow ? 'shadow ' : 'view   ') + q.nm;
        const e = by.get(k) || { k, tris: 0, past: [0, 0, 0], n: 0 };
        const t = q.per * q.n; e.tris += t; e.n += q.n;
        const pass = q.shadow ? 'shadow' : 'view'; tot[pass] += t;
        B.forEach((b, j) => { const f = q.dists ? q.dists.reduce((s, d) => s + (d > b ? 1 : 0), 0) * q.per : (q.d > b ? t : 0); e.past[j] += f; far[pass][j] += f; });
        by.set(k, e);
      }
      out.tot = tot; out.far = far;
      out.rows = [...by.values()].sort((a, b) => b.tris - a.tris).slice(0, 22);
      return out;
    }, v);
    const M = x => (x / 1e6).toFixed(2) + 'M';
    console.log(`${v.name}: ${M(r.tris)} triangles, ${r.calls} draw calls. View pass ${M(r.tot.view)} (past 300 m ${M(r.far.view[0])}, 800 m ${M(r.far.view[1])}, 2 km ${M(r.far.view[2])}); shadow pass ${M(r.tot.shadow)} (past 300 m ${M(r.far.shadow[0])}, 800 m ${M(r.far.shadow[1])})`);
    for (const q of r.rows) console.log(`  ${M(q.tris).padStart(6)}  past 300 m ${M(q.past[0]).padStart(6)}  800 m ${M(q.past[1]).padStart(6)}  2 km ${M(q.past[2]).padStart(6)}  x${String(q.n).padEnd(6)} ${q.k}`);
  }
  await b.close();
})();
