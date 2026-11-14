// A fingerprint of what the load builds on the main thread or in its Workers (issue 344): each buildings
// attribute's and the index's FNV-1a hash and length, and, in the game, the collision world's and the walking networks'. Run it on two trees
// (PORT=8801 for another tree's server) to show that moving a build into a Worker changed nothing it makes.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/build_hash.js kyoto [game]      (NOWORKER=1: with Worker taken away, the page's own path)
const { chromium } = require('playwright');
const [,, city = 'sydney', mode = 'viewer'] = process.argv;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, 'high');
  if (process.env.NOWORKER) await p.addInitScript(() => { window.Worker = undefined; });
  p.on('console', m => { if (/worker|buildings:|nav:|footways:/i.test(m.text())) console.log('  page:', m.text()); });
  p.on('pageerror', e => console.log('  page error:', e.message));
  const port = process.env.PORT || 8800, game = mode === 'game';
  await p.goto(`http://localhost:${port}/#${game ? 'play-' : ''}${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (game) await p.waitForFunction(() => window.__game && document.querySelector('#g-loader').hidden, null, { timeout: 900000, polling: 500 });
  else await p.waitForFunction('window.__city && document.getElementById("loader").hidden', null, { timeout: 900000, polling: 500 });
  const out = await p.evaluate(game => {
    const fnv = a => {
      const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let h = 0x811c9dc5;
      for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16).padStart(8, '0');
    };
    // (the game keeps the whole mesh out of the scene: its cells there share its attributes, with indices of their own)
    let g = game ? null : window.__city.Wd.bGeo;
    if (game) window.__game.world.traverse(o => { const a = o.geometry && o.geometry.attributes.bid; if (a && a.array.length > 1000 && !g) g = o.geometry; });
    const r = {};
    for (const [k, v] of Object.entries(g.attributes)) r[k] = `${v.array.length} ${fnv(v.array)}`;
    if (!game) r.index = `${g.index.array.length} ${g.index.array.constructor.name} ${fnv(g.index.array)}`;
    if (game) { // the collision world as built at the start (issue 406: a packed store answers as the objects did): every solid's
      // heights, tag, id and rings, and the walls' count, before the walker lays any landmark's fine cells
      const col = window.__game.nav.col, P = col.prisms, n0 = window.__game.nav.fineBoxes, f = [];
      for (const q of P) { f.push(q.zlo, q.zhi, q.tag, q.id, q.rings.length); for (const ri of q.rings) f.push(ri.length, ...ri); }
      r.collision = `${P.length} solids ${col.walls} walls (${n0} fine boxes laid) ${fnv(Float64Array.from(f))}`;
      const N = window.__game.nets ? window.__game.nets() : null; // the crowd's and the traffic's networks (#404: cut in a Worker)
      if (N) for (const [k, list] of Object.entries(N)) r[k] = `${list.length} lines ${fnv(Float64Array.from(list.flatMap(l => { const p = l.p || l; return [p.length, ...p, ...(l.d || []), l.w || 0]; })))}`;
    }
    return r;
  }, game);
  for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(9)} ${v}`);
  await b.close();
})();
