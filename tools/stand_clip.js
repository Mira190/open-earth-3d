// Where a walker sinks into what the page draws: round each of a city's travel places (game.travel), its
// start and its landmarks' decks, walk the floor the game lets you walk (nav.walk, a step of 1.5 m out to
// RADIUS m from the place, at the level you arrive on), and at every spot reached look down from head height
// through the meshes the page draws: a drawn surface more than 0.3 m over the walker's feet (a roof, a deck,
// a slab drawn over the floor the game stands you on) is a spot where the body sinks into it. Prints, per
// place, the spots reached and the buried ones (how deep, which mesh), and exits 1 when any place has one.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/stand_clip.js sydney [radius m]        # llvmpipe; without xvfb-run, SwiftShader
// env: PLACES="jacaranda-lookout,..." (only these travel ids), DEEP=0.3 (m), JSON=out.json (every buried spot)
const { chromium } = require('playwright');
const fs = require('fs');
const [,, city = 'sydney', radius = '60'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 600000 });
  await p.evaluate(() => window.__game.lateReady && window.__game.lateReady());
  // play, past the title and the opening
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => {});
  await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return !t || t.hidden; }, null, { timeout: 120000 }).catch(() => {});
  await p.evaluate(() => window.__game.advance(4));
  const only = (process.env.PLACES || '').split(',').filter(Boolean);
  const places = await p.evaluate(only => {
    const g = window.__game, G = g.G, out = [];
    if (!only.length) out.push({ id: 'start', name: 'Start', at: G.start.at });
    for (const t of G.travel || []) if (!only.length || only.includes(t.id)) out.push({ id: t.id, name: t.name, at: t.at });
    if (!only.length) for (const lm of g.landmarks) { const d = g.deckOf(lm), s = d && g.deckStand(d); if (s) out.push({ id: `deck:${lm.name}`, name: `${lm.name} (deck)`, at: s }); }
    return out;
  }, only);
  const res = [];
  for (const t of places) {
    // there by the map's own travel, so that the ground near it is the 5 m ground drawn near a walker
    await p.evaluate(t => {
      const g = window.__game;
      g.travelTo({ kind: 'place', id: t.id, name: t.name, at: t.at });
      for (let k = 0; k < 40 && g.cine.active; k++) g.advance(0.25);
      g.advance(0.5);
    }, t);
    res.push(await p.evaluate(([t, R, DEEP]) => {
      const g = window.__game, nav = g.nav, W = g.Wd.world;
      W.updateMatrixWorld(true);
      // the meshes the page draws that a walker could sink into: not the people, the trees and the cars (instanced or
      // skinned), not sprites or lines, not the sky, nor what is mostly see-through
      const ms = [];
      W.traverseVisible(o => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (o === g.Wd.sky || (m && m.transparent && m.opacity < 0.5)) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (o.geometry.boundingSphere.radius > 20000) return;
        // (nor the player, the people and the vehicles that move about: small and nameless, or in a group that moves)
        // (a landmark's meshes are named in lower case, rail_rail_bench; a car's parts Car_Hatch_Cabin)
        let named = false;
        for (let q = o; q && !named; q = q.parent) named = /^[a-z0-9]+_[a-z0-9_]+$|^buildings/.test(q.name);
        if (!named && o.geometry.boundingSphere.radius < 4) return;
        ms.push(o);
      });
      const rc = new THREE.Raycaster(); rc.camera = g.camera;
      const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
      const nameOf = o => { const n = []; for (let q = o; q && n.length < 3; q = q.parent) if (q.name) n.push(q.name); const c = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; return n.join(' < ') || `unnamed (${c} triangles, ${Math.round(o.geometry.boundingSphere.radius)} m across)`; };
      const pl = g.player, x0 = pl.x, y0 = pl.y, z0 = pl.z;
      if (pl.mode !== 'foot') return { id: t.id, name: t.name, none: true };
      const S = 1.5, seen = new Set(['0,0']), q = [[0, 0, z0]], buried = [];
      let n = 0;
      while (q.length) {
        const [i, j, z] = q.shift(), x = x0 + i * S, y = y0 + j * S;
        n++;
        from.set(x, z + 1.6, -y); rc.set(from, down); rc.near = 0; rc.far = 1.6 - DEEP;
        const h = rc.intersectObjects(ms, false)[0];
        if (h) buried.push({ x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(2), deep: +(h.point.y - z).toFixed(2), mesh: nameOf(h.object) });
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, c = j + dj, k = `${a},${c}`;
          if (seen.has(k) || Math.hypot(a * S, c * S) > R) continue;
          // (walked there in steps of 0.25 m, as a walker goes, not jumped: a bench's outline is a wall a step thick)
          let zz = z, ok = true;
          for (let t = 1; t <= 6 && ok; t++) {
            const w = nav.walk(x + di * S * t / 6, y + dj * S * t / 6, zz, true);
            ok = !!(w && w.ok && Math.abs(w.z - zz) < 0.8);
            if (ok) zz = w.z;
          }
          if (ok) { seen.add(k); q.push([a, c, zz]); }
        }
      }
      return { id: t.id, name: t.name, at: [x0, y0, z0], n, buried };
    }, [t, +radius, +(process.env.DEEP || 0.3)]));
  }
  let bad = 0;
  for (const r of res) {
    if (r.none) { console.log(`--   ${r.name}: no floor to stand on`); continue; }
    if (r.buried.length) bad++;
    const deep = r.buried.reduce((m, s) => Math.max(m, s.deep), 0), meshes = [...new Set(r.buried.map(s => s.mesh))].slice(0, 4);
    console.log(`${r.buried.length ? 'CLIP' : 'ok  '} ${r.name} [${r.at.map(v => v.toFixed(1))}]: ${r.n} spots walked, ${r.buried.length} buried${r.buried.length ? ` (to ${deep.toFixed(1)} m; first at [${r.buried[0].x}, ${r.buried[0].y}, ${r.buried[0].z}]; ${meshes.join(' | ')})` : ''}`);
  }
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(res, null, 1));
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await b.close();
  process.exit(bad ? 1 : 0);
})();
