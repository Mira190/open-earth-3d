// The NPCs that stand in a carriageway (#264): the traffic stops for them and never edges past, as they stand
// their ground (game.js blockers, fixed). For each city named, every NPC whose circle is in a road, and how deep.
//   xvfb-run -a node tools/npc_road_probe.js tokyo shibuya ...
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  for (const city of process.argv.slice(2)) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.roadsNow', null, { timeout: 300000 });
    const r = await p.evaluate(() => {
      const g = window.__game, R = g.roadsNow;
      return g.npcs.map(n => ({ name: n.name || n.id, at: [+n.x.toFixed(1), +n.y.toFixed(1)], depth: +R.depth(n.x, n.y, n.z, 0.35).toFixed(2), car: (() => { const pl = g.roads.place(n.x, n.y, 8, 1, n.z); return pl ? +Math.hypot(pl.x - n.x, pl.y - n.y).toFixed(1) : null; })() })).filter(q => q.depth > 0);
    });
    console.log(city, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
