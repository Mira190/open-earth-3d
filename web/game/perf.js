// What a frame costs on the device that is drawing it, part by part (?perf on a game's address). A software renderer
// in a check knows nothing of a real GPU, and a player's telemetry says only that a frame was slow: this draws the
// frame as it stands several times over, finished each time (gl.finish and a pixel read back, so the time is the
// GPU's as well as the script's), then again with one thing taken away at a time: the post stack and each of its
// passes, the shadows, the screens' area lights, the wet street's mirror, the weather, the multisampling, the scene
// at the governor's floor and at full size, every material swapped for a flat one (what the geometry alone costs),
// and each of the scene's top-level groups. What a part costs is the frame's time with it less the time without.
// The table is shown on the page and sent with the telemetry ("perf"), so a device's own numbers decide what is
// worth making cheaper. It loads only when asked for: game.js adds this script on ?perf.
'use strict';
window.OEPerf = (function () {
  const CSS = `#g-perf { position: absolute; left: 12px; top: 12px; z-index: 50; max-height: calc(100% - 24px); overflow: auto; margin: 0; padding: 12px 14px; border-radius: 10px;
  background: rgba(6, 10, 20, 0.88); color: #e8eefc; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; white-space: pre; pointer-events: auto; user-select: text; }`;
  // h: { renderer, world, camera, atmos, gov, mirror, weather, stage, tick() (what a frame does before it draws) }
  async function run(h) {
    const { renderer, world, camera, atmos, gov } = h, gl = renderer.getContext(), px = new Uint8Array(4);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const out = document.createElement('pre'); out.id = 'g-perf'; h.stage.appendChild(out);
    const rows = [];
    const show = note => { out.textContent = `Frame cost on this device (ms a frame; lower is better)\n\n${rows.map(r => `${r.name.padEnd(34)} ${String(r.ms.toFixed(1)).padStart(7)}${(r.d == null ? '' : r.d >= 0 ? `   costs ${r.d.toFixed(1)}` : `   (${(-r.d).toFixed(1)} slower)`).padEnd(18)}${r.note ? `  ${r.note}` : ''}`).join('\n')}\n\n${note}`; };
    const draw = () => { if (h.tick) h.tick(); if (atmos) atmos.render(world, camera); else renderer.render(world, camera); };
    const finish = () => { renderer.setRenderTarget(null); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const time = (fn = draw, n = 7, warm = 3) => {
      const ts = [];
      for (let i = 0; i < warm + n; i++) { const t0 = performance.now(); fn(); finish(); if (i >= warm) ts.push(performance.now() - t0); }
      ts.sort((a, b) => a - b);
      return ts[ts.length >> 1];
    };
    const pause = () => new Promise(r => setTimeout(r, 30));
    let base = 0;
    // one row: the frame with something changed (set), then put back (unset)
    async function test(name, set, unset, fn, note) {
      let ms = NaN;
      try { set(); ms = time(fn); } catch (e) { note = String(e).slice(0, 60); }
      try { unset(); } catch (e) { /* left as it is */ }
      rows.push({ name, ms, d: base && isFinite(ms) ? base - ms : null, note });
      show('Measuring ...');
      await pause();
    }
    show('Measuring ...'); await pause();
    time(draw, 4, 4); // (whatever the first frames compile)
    base = time(draw, 11, 2);
    // (a frame's own counts: the renderer's are reset at each of the post stack's draws)
    const auto = renderer.info.autoReset; renderer.info.autoReset = false; renderer.info.reset(); draw();
    const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }, size = renderer.getDrawingBufferSize(new THREE.Vector2());
    renderer.info.autoReset = auto;
    rows.push({ name: 'the frame as it is', ms: base, d: null, note: `${size.x} x ${size.y}, scale ${gov ? gov.scale.toFixed(2) : 1}, extras ${gov ? gov.extras : 1}, ${info.calls} draws, ${Math.round(info.triangles / 1000)}k triangles` });
    // the scene alone, straight to the canvas: no post stack
    await test('without the post stack', () => {}, () => {}, () => { if (h.tick) h.tick(); renderer.setRenderTarget(null); renderer.render(world, camera); }, 'at the canvas\'s full size');
    const passes = atmos && atmos.composer && atmos.composer.passes ? atmos.composer.passes : [];
    for (let i = 1; i < passes.length; i++) { const p = passes[i]; if (p.enabled === false) continue; await test(`without pass ${i} ${p.name || p.constructor.name}`, () => { p.enabled = false; }, () => { p.enabled = true; }); }
    // every material flat: what is left is the vertices, the draw calls and the passes
    const flat = new THREE.MeshBasicMaterial({ color: 0x808080 });
    await test('every material flat', () => { world.overrideMaterial = flat; }, () => { world.overrideMaterial = null; });
    const lights = [], rects = [];
    world.traverse(o => { if (o.isLight && o.castShadow) lights.push(o); if (o.isRectAreaLight && o.visible) rects.push(o); });
    if (lights.length) await test('without shadows', () => lights.forEach(l => { l.castShadow = false; }), () => lights.forEach(l => { l.castShadow = true; }));
    if (rects.length) await test(`without the ${rects.length} area lights`, () => rects.forEach(l => { l.visible = false; }), () => rects.forEach(l => { l.visible = true; }));
    if (h.mirror && h.mirror.on) { const was = !!h.mirror.off; await test(was ? 'with the wet street\'s mirror' : 'without the wet street\'s mirror', () => { h.mirror.off = !was; }, () => { h.mirror.off = was; }); }
    if (h.weather && 'shed' in h.weather) { const was = h.weather.shed; await test(was >= 2 ? 'with the weather' : 'without the weather', () => { h.weather.shed = was >= 2 ? 0 : 2; }, () => { h.weather.shed = was; }); }
    if (atmos && atmos.setSamples && atmos.composer) { const was = atmos.composer.samples || 0; await test(was ? 'without multisampling' : 'with multisampling x4', () => atmos.setSamples(was ? 0 : 4), () => atmos.setSamples(was)); }
    if (gov && gov.set) {
      const s = gov.scale, e = gov.extras;
      if (s > gov.min + 0.01) await test(`the scene at scale ${gov.min}`, () => gov.set(gov.min, e), () => gov.set(s, e));
      if (s < 0.99) await test('the scene at scale 1', () => gov.set(1, e), () => gov.set(s, e));
      if (e !== 1) await test('with every extra', () => gov.set(s, 1), () => gov.set(s, e));
      if (e !== 0) await test('with no extras', () => gov.set(s, 0), () => gov.set(s, e));
    }
    // the scene's own parts: its top-level groups, the costliest first
    const kids = world.children.filter(o => o.visible && !o.isLight && !o.isCamera), groups = new Map();
    const tris = o => { let n = 0; o.traverse(m => { if (!m.isMesh || !m.geometry) return; const g = m.geometry, c = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0; n += c / 3 * (m.isInstancedMesh ? m.count : 1); }); return n; };
    for (const o of kids) { const k = o.name || (o.userData && (o.userData.kind || o.userData.name)) || `${o.type}${o.isInstancedMesh ? ' (instanced)' : o.isSkinnedMesh ? ' (skinned)' : ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
    const list = [...groups].map(([k, os]) => ({ k, os, t: os.reduce((n, o) => n + tris(o), 0) })).sort((a, b) => b.t - a.t).slice(0, 16);
    for (const g of list) await test(`without ${g.k}`.slice(0, 34), () => g.os.forEach(o => { o.visible = false; }), () => g.os.forEach(o => { o.visible = true; }), draw, `${g.os.length} object${g.os.length > 1 ? 's' : ''}, ${Math.round(g.t / 1000)}k triangles`);
    const again = time(draw, 7, 2);
    rows.push({ name: 'the frame as it is, again', ms: again, d: null });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    show(`${gpu}\nSent with the telemetry. The second column is what the part costs: the frame's time less the time without it.`);
    console.info('perf', JSON.stringify(rows));
    if (window.OETelemetry && OETelemetry.track) { OETelemetry.track('perf', { base_ms: +base.toFixed(1), again_ms: +again.toFixed(1), w: size.x, h: size.y, rows: JSON.stringify(rows.map(r => [r.name, +r.ms.toFixed(1), r.note || ''])).slice(0, 6000) }); if (OETelemetry.flush) OETelemetry.flush(); }
    return rows;
  }
  return { run };
})();
