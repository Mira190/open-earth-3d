// Is anything missing from the picture when what cannot be seen is left out (issue 358, B1)? Walks and
// drives a city's own paths: at each stop the camera is put at a walker's or a driver's eye, the page's
// visibility (web/visibility.js) is given time to answer, and the frame is drawn twice in the same instant
// of the held game, with the gates and without. The two must match to the pixel. The camera is also moved
// off the point the sweep was made for, by up to its margin, as a moving camera is between two sweeps.
// Prints the triangles and draw calls of both, per city.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/vis_check.js shibuya [stops=24] [WxH=960x600]
// TIER=low|medium|high (default high). TIME=HH:MM (default 15:30). OUT=dir keeps the two frames of a mismatch.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'sydney', stops = '24', size = '960x600'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(() => {
    const hook = () => {
      if (!window.THREE || !window.THREE.WebGLRenderer || window.THREE.__visCheck) return false;
      const R = window.THREE.WebGLRenderer;
      window.THREE.WebGLRenderer = function (...a) { const r = new R(...a); window.__renderer = r; return r; };
      window.THREE.WebGLRenderer.prototype = R.prototype;
      window.THREE.__visCheck = true;
      return true;
    };
    if (!hook()) window.addEventListener('three-ready', hook, { once: true });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ''}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__renderer', null, { timeout: 300000 });
  const time = process.env.TIME || '15:30';
  await p.evaluate(t => { const g = window.__game; const [H, M] = t.split(':').map(Number); const c = g.clock; g.setClock(c.y, c.m, c.d, H * 60 + M); }, time);
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async () => {
    const g = window.__game;
    for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
    for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    if (g.cine && g.cine.active) g.cine.skip();
    const O = window.OEOnboard, tour = O && O.current && O.current(); if (tour) tour.skip();
    g.clock.frozen = true;
  });
  await p.waitForTimeout(8000); // (the late models, the static meshes' cells)
  const ok = await p.evaluate(() => !!(window.OEVis && OEVis.where().ready));
  if (!ok) { console.log(`FAIL vis    ${city}: no visibility on this page (${await p.evaluate(() => (window.OEVis ? JSON.stringify(OEVis.where()) : 'no OEVis'))})`); await b.close(); process.exit(1); }
  // the stops: points along the city's own footways and roads, spread over the map; a walker's eye, a
  // driver's, and the camera behind and above a walker
  const G = JSON.parse(fs.readFileSync(`web/data/${city}/game.json`, 'utf8'));
  let seed = 7; const R = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (list, n, up) => {
    const out = [];
    for (let k = 0; k < n && list.length; k++) {
      const q = list[Math.floor(R() * list.length)].p, i = 3 * Math.floor(R() * (q.length / 3 - 1));
      const x = q[i] / 10, y = q[i + 1] / 10, z = q[i + 2] / 10, dx = q[i + 3] / 10 - x, dy = q[i + 4] / 10 - y, l = Math.hypot(dx, dy) || 1;
      out.push({ x, y, z: z + up, dx: dx / l, dy: dy / l });
    }
    return out;
  };
  const n = +stops, views = [];
  for (const s of pick(G.paths.foot || [], Math.ceil(n / 2), 1.65)) views.push({ kind: 'walk', ...s });
  for (const s of pick(G.paths.foot || [], Math.ceil(n / 4), 3.6)) views.push({ kind: 'behind a walker', ...s });
  for (const s of pick(G.paths.road || [], Math.ceil(n / 2), 1.3)) views.push({ kind: 'drive', ...s });
  let worst = 0, bad = 0, drawn = 0, skipped = 0;
  const sum = { gt: 0, gc: 0, ut: 0, uc: 0, hidden: 0, gated: 0 };
  for (const [vi, v] of views.entries()) {
    if (process.env.ONLY && +process.env.ONLY !== vi) continue;
    const r = await p.evaluate(async v => {
      const g = window.__game, Rn = window.__renderer, cam = g.camera, W = (x, y, z) => new THREE.Vector3(x, z, -y), gl = Rn.getContext();
      g.hold(true);
      const z = Math.max(v.z, g.nav.terrain(v.x, v.y) + 1.2);
      const pose = (ox, oy, turn) => { const a = Math.atan2(v.dy, v.dx) + turn; cam.position.copy(W(v.x + ox, v.y + oy, z)); cam.lookAt(W(v.x + ox + 50 * Math.cos(a), v.y + oy + 50 * Math.sin(a), z + 2)); cam.updateMatrixWorld(); };
      const frame = () => { Rn.info.reset(); if (g.atmos && g.atmos.composer) g.atmos.composer.render(); else Rn.render(g.Wd.scene || g.Wd.world, cam); const px = new Uint8Array(4 * gl.drawingBufferWidth * gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, tris: Rn.info.render.triangles, calls: Rn.info.render.calls }; };
      pose(0, 0, 0); OEVis.forget();
      // the page's own loop asks for the sweep (the game is held, so the camera stays put)
      let live = false;
      for (let k = 0; k < 150 && !live; k++) { await new Promise(r => requestAnimationFrame(r)); pose(0, 0, 0); const q = OEVis.where(); live = OEVis.live && Math.hypot(q.x - v.x, q.y - v.y) < 0.01; }
      if (!live) return { skipped: true, why: JSON.stringify(OEVis.where()) };
      const q = OEVis.where(), out = { diff: 0, shots: 0, gt: 0, gc: 0, ut: 0, uc: 0, hidden: OEVis.stats.hidden, gated: OEVis.stats.gated, eps: q.eps, ms: OEVis.stats.ms };
      Rn.info.autoReset = false;
      // the water's waves and anything else that runs on the page's own clock: stopped while the frames are compared
      const pn = performance.now, dn = Date.now, tn = pn.call(performance), td = dn.call(Date);
      performance.now = () => tn; Date.now = () => td;
      // four ways to look, from the sweep's point and from the edge of its margin
      const offs = [[0, 0], [0.95 * q.eps, 0], [0, -0.95 * q.eps], [-0.67 * q.eps, 0.67 * q.eps]];
      for (let k = 0; k < 4; k++) {
        const [ox, oy] = offs[k];
        if (k && g.nav.blocked && g.nav.blocked(v.x + ox, v.y + oy)) continue;
        pose(ox, oy, k * Math.PI / 2); OEVis.forget(); OEVis.at(cam);
        if (!OEVis.live) { out.lost = (out.lost || 0) + 1; continue; }
        const A = frame();
        OEVis.hold('check', true);
        const B = frame(), C = frame(); // (twice: what differs between two ungated frames is not the gates')
        OEVis.hold('check', false);
        let d = 0, noise = 0;
        for (let i = 0; i < A.px.length; i += 4) {
          const n = B.px[i] !== C.px[i] || B.px[i + 1] !== C.px[i + 1] || B.px[i + 2] !== C.px[i + 2];
          if (n) noise++;
          else if (A.px[i] !== B.px[i] || A.px[i + 1] !== B.px[i + 1] || A.px[i + 2] !== B.px[i + 2]) d++;
        }
        out.shots++; out.gt += A.tris; out.gc += A.calls; out.ut += B.tris; out.uc += B.calls; out.noise = Math.max(out.noise || 0, noise);
        if (d > out.diff) {
          out.diff = d; out.at = k;
          { // what is missing: the thing under a differing pixel in the middle of them, by a ray into the buildings' cells
            const W2 = gl.drawingBufferWidth, H2 = gl.drawingBufferHeight, xs = [], ys = [];
            for (let i = 0; i < A.px.length; i += 4) if ((A.px[i] !== B.px[i] || A.px[i + 1] !== B.px[i + 1] || A.px[i + 2] !== B.px[i + 2]) && !(B.px[i] !== C.px[i])) { xs.push((i / 4) % W2); ys.push(Math.floor(i / 4 / W2)); }
            const mid = Math.floor(xs.length / 2), rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(2 * (xs[mid] + 0.5) / W2 - 1, 2 * (ys[mid] + 0.5) / H2 - 1), cam);
            const hits = [];
            OEVis.hold('check', true);
            (g.Wd.scene || g.Wd.world).traverse(o => { if (o.isMesh && o.userData.oeVis && !o.isInstancedMesh) { const h = rc.intersectObject(o, false)[0]; if (h) hits.push(h); } });
            OEVis.hold('check', false);
            hits.sort((p, q) => p.distance - q.distance);
            const hit = hits[0];
            out.what = hit ? { x: +hit.point.x.toFixed(1), y: +(-hit.point.z).toFixed(1), z: +hit.point.y.toFixed(1), d: Math.round(hit.distance), name: hit.object.name } : null;
            out.eye = { x: +cam.position.x.toFixed(2), y: +(-cam.position.z).toFixed(2), z: +cam.position.y.toFixed(2), sweep: OEVis.where() };
          }
          if (v.keep) { // the two frames again, as pictures, and where they differ
            const cv = Rn.domElement; frame(); out.a = cv.toDataURL('image/png'); OEVis.hold('check', true); frame(); out.b = cv.toDataURL('image/png'); OEVis.hold('check', false);
            const W2 = gl.drawingBufferWidth, H2 = gl.drawingBufferHeight, c2 = document.createElement('canvas'); c2.width = W2; c2.height = H2;
            const x2 = c2.getContext('2d'), im = x2.createImageData(W2, H2);
            for (let i = 0; i < A.px.length; i += 4) { const y = H2 - 1 - Math.floor(i / 4 / W2), o = 4 * (y * W2 + (i / 4) % W2); const df = A.px[i] !== B.px[i] || A.px[i + 1] !== B.px[i + 1] || A.px[i + 2] !== B.px[i + 2]; im.data[o] = df ? 255 : B.px[i] >> 2; im.data[o + 1] = df ? 0 : B.px[i + 1] >> 2; im.data[o + 2] = df ? 255 : B.px[i + 2] >> 2; im.data[o + 3] = 255; }
            x2.putImageData(im, 0, 0); out.d = c2.toDataURL('image/png');
          }
        }
      }
      Rn.info.autoReset = true;
      performance.now = pn; Date.now = dn;
      return out;
    }, { ...v, keep: !!process.env.OUT });
    if (r.skipped) { skipped++; continue; }
    drawn += r.shots;
    for (const k of ['gt', 'gc', 'ut', 'uc']) sum[k] += r[k];
    sum.hidden += r.hidden; sum.gated = r.gated;
    if (r.diff && process.env.OUT) for (const k of ['a', 'b', 'd']) if (r[k]) fs.writeFileSync(`${process.env.OUT}/${city}_${vi}_${{ a: 'gated', b: 'all', d: 'diff' }[k]}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
    if (r.diff) { bad++; worst = Math.max(worst, r.diff); console.log(`  ${v.kind} at (${v.x.toFixed(0)}, ${v.y.toFixed(0)}): ${r.diff} pixels differ (view ${r.at}, margin ${r.eps} m); missing ${JSON.stringify(r.what)} from ${JSON.stringify(r.eye)}`); }
    if (process.env.VERBOSE) console.log(`  ${vi} ${v.kind} (${v.x.toFixed(0)}, ${v.y.toFixed(0)}) hidden ${r.hidden}/${r.gated} tris ${(r.gt / r.shots / 1e6).toFixed(2)}M vs ${(r.ut / r.shots / 1e6).toFixed(2)}M, noise ${r.noise}, sweep ${r.ms.toFixed(0)} ms${r.lost ? `, lost ${r.lost}` : ''}`);
  }
  const M = x => (x / Math.max(1, drawn) / 1e6).toFixed(2), C = x => Math.round(x / Math.max(1, drawn));
  console.log(`${bad ? 'FAIL' : 'ok  '} vis    ${city} ${size} ${process.env.TIER || 'high'}: ${drawn} frames at ${views.length - skipped} stops (${skipped} with no answer), ${bad} stops with a difference${bad ? ` (the worst ${worst} pixels)` : ''}; ` +
    `a frame ${M(sum.ut)}M triangles and ${C(sum.uc)} draws without the gates, ${M(sum.gt)}M and ${C(sum.gc)} with; ${Math.round(sum.hidden / Math.max(1, views.length - skipped))} of ${sum.gated} static meshes hidden on average`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
  await b.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
