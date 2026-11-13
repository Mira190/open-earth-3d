// Stand on each moving strip whose name holds the text given, as tools/game_check.js does, and print where it
// stops carrying you and the collision boxes just ahead there: for an escalator that stops short.
//   xvfb-run -a node tools/escalator_probe.js tokyo "Yurakucho Station, the north escalator"
const { chromium } = require('playwright');
const [,, city = 'tokyo', match = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] } : {});
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.nav', null, { timeout: 600000 });
  const r = await p.evaluate((match) => {
    const g = window.__game, pl = g.player, nav = g.nav, out = [];
    for (const s of nav.strips.filter(q => q.moving_ms && q.name.includes(match))) {
      const mu = s.moving_u || [s.us[0], s.us[s.us.length - 1]], u0 = mu[0] + 0.3;
      const x = s.origin[0] + s.axis[0] * u0, y = s.origin[1] + s.axis[1] * u0;
      [pl.x, pl.y, pl.z] = [x, y, nav.stripHeight(s, x, y)]; pl.mode = 'foot'; pl.ground = true; pl.vz = 0;
      let last = -1, still = 0;
      for (let t = 0; t < 60; t += 0.25) {
        g.advance(0.25);
        const [u, v] = nav.stripUV(s, pl.x, pl.y);
        if (u >= mu[1] - 0.05) { out.push(`${s.name}: to the end in ${t.toFixed(1)} s`); break; }
        if (Math.abs(u - last) < 0.01) still++; else still = 0;
        last = u;
        if (still > 8) {
          const ax = pl.x + s.axis[0] * 0.4, ay = pl.y + s.axis[1] * 0.4;
          out.push(`${s.name}: stuck at u ${u.toFixed(2)} v ${v.toFixed(2)} z ${pl.z.toFixed(2)} (${pl.x.toFixed(2)}, ${pl.y.toFixed(2)}), ahead ${JSON.stringify(nav.walk(ax, ay, pl.z, true))}`);
          nav.col.need && nav.col.need(ax - 3, ay - 3, ax + 3, ay + 3);
          for (const q of nav.col.prisms || []) if (q.x1 > ax - 0.5 && q.x0 < ax + 0.5 && q.y1 > ay - 0.5 && q.y0 < ay + 0.5 && q.zhi > pl.z + 0.3 && q.zlo < pl.z + 1.9 && q.x1 - q.x0 < 20)
            out.push('  box ' + [q.x0, q.y0, q.x1, q.y1, q.zlo, q.zhi].map(v => v.toFixed(2)).join(' ') + ' ' + q.tag);
          break;
        }
      }
    }
    // and walked onto from the floor 2.5 m before it, as a player does (game_check's second escalator step)
    for (const s of nav.strips.filter(q => q.moving_ms && q.name.includes(match))) {
      const u0 = s.us[0] - 2.5, x = s.origin[0] + s.axis[0] * u0, y = s.origin[1] + s.axis[1] * u0, f = nav.floorAt(x, y, s.zs[0] + 0.5);
      [pl.x, pl.y, pl.z] = [x, y, f ? f.z : s.zs[0]]; pl.mode = 'foot'; pl.ground = true; pl.vz = 0; pl.walking = true; pl.escOff = null;
      const h = Math.atan2(s.axis[0], s.axis[1]); pl.h = h;
      const trail = [];
      for (let i = 0; i < 30; i++) { g.cam.yaw = h; g.advance(0.1, ['KeyW']); if (i % 5 === 4) { const [u, v] = nav.stripUV(s, pl.x, pl.y); trail.push(`${u.toFixed(1)}/${v.toFixed(2)}/${pl.z.toFixed(2)}`); } }
      const [u, v] = nav.stripUV(s, pl.x, pl.y), ax = pl.x + s.axis[0] * 0.4, ay = pl.y + s.axis[1] * 0.4;
      out.push(`${s.name}: walked on, u ${u.toFixed(2)} (${trail.join(' ')}), floor ${JSON.stringify(f)}, ahead ${JSON.stringify(nav.walk(ax, ay, pl.z, true))}`);
      if (u < 0.3) {
        nav.col.need && nav.col.need(ax - 3, ay - 3, ax + 3, ay + 3);
        for (const q of nav.col.prisms || []) if (q.x1 > ax - 0.5 && q.x0 < ax + 0.5 && q.y1 > ay - 0.5 && q.y0 < ay + 0.5 && q.zhi > pl.z + 0.3 && q.zlo < pl.z + 1.9 && q.x1 - q.x0 < 20)
          out.push('  box ' + [q.x0, q.y0, q.x1, q.y1, q.zlo, q.zhi].map(v => v.toFixed(2)).join(' ') + ' ' + q.tag);
      }
    }
    return out;
  }, match);
  console.log(r.join('\n'));
  await b.close();
})();
