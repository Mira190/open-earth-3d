// Where a walker sinks into what the page draws: round each of a city's travel places (game.travel), its
// start and its landmarks' decks, walk the floor the game lets you walk (nav.walk, a step of 1.5 m out to
// RADIUS m from the place, at the level you arrive on), and at every spot reached look down from head height
// through the meshes the page draws: a drawn surface more than 0.3 m over the walker's feet (a roof, a deck,
// a slab drawn over the floor the game stands you on) is a spot where the body sinks into it. Prints, per
// place, the spots reached and the buried ones (how deep, which mesh), and exits 1 when any place has one.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/stand_clip.js sydney [radius m]        # llvmpipe; without xvfb-run, SwiftShader
// env: PLACES="jacaranda-lookout,..." (only these travel ids; PLACES=none WATER=1: only the water), DEEP=0.3 (m), JSON=out.json (every buried spot)
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
  // the landmarks' water (a pond, a moat): the ground the page draws must stay under it (#399: Shinjuku Gyoen's pond
  // had the 5 m ground stand through it as grey pyramids). Near each sheet of water (so its 5 m ground is drawn), look
  // down onto the ground at points of the sheet more than half a 5 m cell from its edge (where a landmark's own bank or
  // wall stands): ground over the water there is a poke
  const waters = only.length && !process.env.WATER ? [] : await p.evaluate(() => {
    const out = [];
    window.__game.Wd.world.traverse(o => { if (o.isMesh && /water|pond/i.test(`${o.name} ${(o.material && o.material.name) || ''}`) && /^[a-z0-9]+_[a-z0-9_]+$/.test(o.name) && !/^inland_/.test(o.name)) { // (a landmark's: not a channel's, inland.js, whose ground is cut away round it)
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
      if (b.max.x - b.min.x < 1e4) out.push({ name: o.name, at: [c.x, -c.z] });
    } });
    return out;
  });
  for (const w of waters) {
    res.push(await p.evaluate(w => {
      const g = window.__game, W = g.Wd.world;
      g.travelTo({ kind: 'point', id: 'waypoint', name: w.name, at: w.at });
      for (let k = 0; k < 40 && g.cine.active; k++) g.advance(0.25);
      g.advance(0.5);
      W.updateMatrixWorld(true);
      let sheet = null;
      W.traverse(o => { if (!sheet && o.isMesh && o.name === w.name) sheet = o; });
      const ground = [];
      W.traverseVisible(o => { if (o.isMesh && (g.Wd.groundMeshes.includes(o) || g.Wd.groundMeshes.some(m => m.material === o.material))) ground.push(o); });
      const pos = sheet.geometry.attributes.position, ix = sheet.geometry.index, n = ix ? ix.count : pos.count, at = k => (ix ? ix.getX(k) : k);
      const V = k => new THREE.Vector3().fromBufferAttribute(pos, at(k)).applyMatrix4(sheet.matrixWorld);
      // the sheet's level faces, and its outline (the edges of one face only)
      const faces = [], edges = new Map(), key = (a, b) => { const p = V(a), q = V(b); const s = v => `${v.x.toFixed(2)},${v.z.toFixed(2)}`; return [s(p), s(q)].sort().join('|'); };
      for (let k = 0; k + 2 < n; k += 3) {
        const a = V(k), b = V(k + 1), c = V(k + 2), nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (Math.abs(nrm.y) < 0.9 * nrm.length() || nrm.length() < 1e-6) continue;
        faces.push([a, b, c]);
        for (const [u, v] of [[k, k + 1], [k + 1, k + 2], [k + 2, k]]) { const e = key(u, v); edges.set(e, edges.has(e) ? null : [V(u), V(v)]); }
      }
      const rim = [...edges.values()].filter(Boolean);
      const toRim = p => { let d = Infinity; for (const [a, b] of rim) { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0; d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)); } return d; };
      const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), buried = [];
      let m = 0;
      for (const [a, b, c] of faces) for (let i = 0; i < 12; i++) {
        let u = Math.random(), v = Math.random(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const p = a.clone().addScaledVector(new THREE.Vector3().subVectors(b, a), u).addScaledVector(new THREE.Vector3().subVectors(c, a), v);
        if (toRim(p) < 2.5) continue;
        m++;
        rc.set(new THREE.Vector3(p.x, p.y + 60, p.z), down);
        const h = rc.intersectObjects(ground, false)[0];
        if (h && h.point.y > p.y + 0.05) buried.push({ x: +p.x.toFixed(1), y: +(-p.z).toFixed(1), z: +p.y.toFixed(2), deep: +(h.point.y - p.y).toFixed(2), mesh: 'the ground' });
      }
      return { id: `water:${w.name}`, name: `${w.name} (the ground under the water)`, at: [w.at[0], w.at[1], 0], n: m, buried };
    }, w));
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
