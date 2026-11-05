// The walk signals' posts at one city's signalled junctions: how many stand, how many were left
// out for want of a place clear of the carriageways near their kerb, and why (the depth of the
// nearest band at the kerb spot, and where kerbside() would put it with a longer reach).
//   node tools/peds_probe.js <city> [x y]   (x y: list the posts of the junction nearest there)
const { chromium } = require('playwright');
(async () => {
  const [city, X, Y] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const r = await p.evaluate(([X, Y]) => {
    const g = window.__game, H = g.junctions.heads, R = g.roadsNow;
    const out = { peds: H.peds.length, dropped: H.dropped.length, at: [] };
    const near = X != null ? g.junctions.J.filter(j => j.sig).sort((a, b) => Math.hypot(a.x - X, a.y - Y) - Math.hypot(b.x - X, b.y - Y))[0] : null;
    const kerb = (o) => {
      const cw = R && R.kerbside ? R : null; if (!cw) return null;
      const q6 = cw.kerbside(o.x, o.y, o.z, 0.07, 6, true), q12 = cw.kerbside(o.x, o.y, o.z, 0.07, 12, true);
      return { depth: +cw.depth(o.x, o.y, o.z, 0.07).toFixed(2), q6, q12: q12 && [+(Math.hypot(q12[0] - o.x, q12[1] - o.y)).toFixed(1)] };
    };
    for (const o of H.dropped.slice(0, 400)) if (!near || o.a.j === near) out.at.push(Object.assign({ dropped: true, j: o.a.j.id, x: Math.round(o.x), y: Math.round(o.y) }, kerb(o)));
    if (near) for (const o of H.peds) if (o.a.j === near) out.at.push({ j: near.id, x: Math.round(o.x), y: Math.round(o.y) });
    out.roads = R && Object.keys(R).slice(0, 20);
    return out;
  }, [X != null ? +X : null, Y != null ? +Y : null]);
  console.log(JSON.stringify(r, null, 1).slice(0, 6000));
  await b.close();
})();
