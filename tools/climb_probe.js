// Climb game.json's checked flights (those whose name holds the text given, or all) of steps on foot, as tools/game_check.js does, and print where the
// walker goes and why nav.walk stops it: for a climb that stalls part way.
//   xvfb-run -a node tools/climb_probe.js tokyo "Yurakucho Station, the north stairs"
const { chromium } = require('playwright');
const [,, city = 'tokyo', match = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] } : {});
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.nav', null, { timeout: 600000 });
  const r = await p.evaluate((match) => {
    const g = window.__game, pl = g.player, n = g.nav, out = [];
    const all = (g.G.surfaces || []).filter(s => (s.check || (match && s.moving_ms)) && s.type === 'strip' && s.name.includes(match));
    if (!all.length) return ['no such flight'];
    for (const s of all) {
    const [ox, oy] = s.origin, [ax, ay] = s.axis, P = s.profile, uf = P[P.length - 1][0], ut = P[0][0], zf = P[P.length - 1][1];
    const x0 = ox + ax * (uf + 1.0), y0 = oy + ay * (uf + 1.0), tx = ox + ax * (ut + 0.6), ty = oy + ay * (ut + 0.6);
    const f = n.floorAt(x0, y0, zf + 0.5);
    out.push(s.name + ' ' + JSON.stringify(P));
    Object.assign(pl, { x: x0, y: y0, z: f.z, ground: true, vz: 0, speed: 0 });
    let last = '';
    for (let i = 0; i < 400 && Math.hypot(tx - pl.x, ty - pl.y) > 0.4; i++) {
      pl.h = g.cam.yaw = Math.atan2(tx - pl.x, ty - pl.y);
      g.advance(0.05, ['KeyW']);
      const nx = pl.x + Math.sin(pl.h) * 0.3, ny = pl.y + Math.cos(pl.h) * 0.3, w = n.walk(nx, ny, pl.z, true);
      const u = (pl.x - ox) * ax + (pl.y - oy) * ay;
      const line = `u ${u.toFixed(1)} z ${pl.z.toFixed(2)} ahead ${JSON.stringify(w)}`;
      if (i % 10 === 0 || !w.ok) out.push(line);
      if (!w.ok && line === last) {
        n.col.need && n.col.need(nx - 3, ny - 3, nx + 3, ny + 3);
        for (const q of n.col.prisms || []) if (q.x1 > nx - 0.6 && q.x0 < nx + 0.6 && q.y1 > ny - 0.6 && q.y0 < ny + 0.6 && q.zhi > pl.z && q.zlo < pl.z + 2)
          out.push('  box ' + [q.x0, q.y0, q.x1, q.y1, q.zlo, q.zhi].map(v => v.toFixed(2)).join(' ') + ' ' + q.tag);
        out.push(`  at ${nx.toFixed(2)} ${ny.toFixed(2)}`);
        break;
      }
      last = line;
    }
    out.push(`END ${s.name}: z ${pl.z.toFixed(2)} of ${P[0][1].toFixed(2)}, ${Math.hypot(tx - pl.x, ty - pl.y).toFixed(1)} m short`);
    }
    return out;
  }, match);
  console.log(r.join('\n'));
  await b.close();
})();
