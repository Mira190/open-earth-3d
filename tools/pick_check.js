// The survey lens's pick (game.js aimed) against the drawn walls (issue 406): the game picks the building under the
// reticle from its collision world (collision.js pick), not from a copy of the walls' mesh. This casts rays from a few
// places round the start, every few degrees round and at three pitches, through both: the drawn cells' triangles
// (three.js's raycast, slow and exact) and col.pick, and counts the rays where they name another building or only one
// hits. Prints the share that agree; exits 1 under AGREE (default 0.9: a canopy's posts, a roof's slope and the
// published solid against the drawn walls differ at the edges).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/pick_check.js tokyo
const { chromium } = require('playwright');
const [,, city = 'tokyo'] = process.argv;
const AGREE = +(process.env.AGREE || 0.9);
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-quality', 'high'); localStorage.setItem('oe3d-onboard', '1'); } catch (e) { /* storage blocked */ } });
  p.on('pageerror', e => console.log('  page error:', e.message));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  const r = await p.evaluate(() => {
    const g = window.__game, nav = g.nav, cells = [];
    g.world.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.bid && o.geometry.index) cells.push(o); });
    const ray = new THREE.Raycaster(), s = g.G.start.at, out = { n: 0, same: 0, both: 0, none: 0, diff: [] };
    ray.far = 300; ray.layers.enableAll(); // (the cells the visibility sweep has put out of view for the camera included)
    for (const [ox, oy] of [[0, 0], [60, 0], [0, 60], [-60, -40]]) {
      const x = s[0] / 1 + ox, y = s[1] / 1 + oy, z = nav.terrain(x, y) + 1.7;
      for (let a = 0; a < 360; a += 6) for (const pitch of [-0.08, 0.05, 0.25]) {
        const d = new THREE.Vector3(Math.cos(a * Math.PI / 180), pitch, -Math.sin(a * Math.PI / 180)).normalize();
        ray.set(new THREE.Vector3(x, z, -y), d);
        const h = ray.intersectObjects(cells, false).sort((u, v) => u.distance - v.distance)[0];
        const mesh = h ? h.object.geometry.attributes.bid.getX(h.face.a) : -1;
        const q = nav.col.pick(x, y, z, x + d.x * 300, y - d.z * 300, z + d.y * 300, nav.BUILDING), pick = q ? nav.col.idOf(q.pi) : -1;
        out.n++;
        if (mesh === pick) { out.same++; if (mesh < 0) out.none++; else out.both++; } else if (out.diff.length < 12) out.diff.push({ at: [Math.round(x), Math.round(y)], a, pitch, mesh, pick, dm: h ? +h.distance.toFixed(1) : null, dp: q ? +(q.t * 300).toFixed(1) : null });
      }
    }
    return out;
  });
  const share = r.same / r.n;
  console.log(`${share >= AGREE ? 'ok  ' : 'FAIL'} ${city}: ${r.same}/${r.n} rays agree (${r.both} on the same building, ${r.none} on none), ${(share * 100).toFixed(1)}%`);
  for (const d of r.diff) console.log('  ', JSON.stringify(d));
  await b.close();
  process.exit(share >= AGREE ? 0 : 1);
})();
