// Where the NPCs wait, after dark (issue 92): each one should stand in light and in sight. For every
// NPC in the city, at night:
//   light  the street lights' light on the ground where they stand (night.js lightAt, the luminance
//          the ground and the walls add there; one lamp's pool peaks near 1), at least LIGHT_MIN
//   sight  from how many of 16 directions a walker on their level (or a boat) 6 to 30 m away sees their head
//          past the walls, and from how far; a nook seen only from close is hidden (not asked of someone
//          indoors, in one of game.json's interiors)
// Used by tools/game_check.js (one city) and on its own for every city:
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/npc_night.js [city ...]      # all the cities with a game by default
const LIGHT_MIN = 0.2, SIGHT_MIN = 3, FAR_MIN = 15;

// runs in the page: the report for each NPC (window.__game)
function survey() {
  const g = window.__game, N = g.Wd && g.Wd.night, out = [];
  // a clear line from eye (x, y, z) to the head (hx, hy, hz): no wall at its height (the game's
  // collision prisms, so a viaduct or a canopy overhead doesn't hide anyone under it)
  const C = g.nav.col;
  const clear = (x, y, z, hx, hy, hz) => {
    const d = Math.hypot(hx - x, hy - y), n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) {
      const f = i / n, zz = z + (hz - z) * f;
      if (C.overlap(x + (hx - x) * f, y + (hy - y) * f, 0.05, zz - 0.1, zz + 0.1)) return false;
    }
    return true;
  };
  // (people who keep other places by the hour, life.json bonds[].places: measured where they stand at night, 21:30)
  const B = g.life && g.life.bonds, c = g.clock, was = { min: c.min, frozen: c.frozen };
  if (B && B.rounds) { g.setClock(c.y, c.m, c.d, 21 * 60 + 30); B.rounds(true); }
  for (const n of g.npcs) {
    const light = N && N.lightAt ? N.lightAt(n.x, n.y, 21) : null;
    const hz = n.z + 1.6;
    let dirs = 0, far = 0;
    for (let a = 0; a < 16; a++) {
      const ux = Math.cos(a * Math.PI / 8), uy = Math.sin(a * Math.PI / 8);
      let best = 0;
      for (let d = 6; d <= 30; d += 2) {
        // someone on their level (a roof, a deck) there, or on a boat if it is water
        const x = n.x + ux * d, y = n.y + uy * d, w = g.nav.walk(x, y, n.z), wet = !w.ok && g.nav.isWater(x, y);
        if (!(w.ok && Math.abs(w.z - n.z) < 3) && !wet) continue;
        if (clear(x, y, (wet ? Math.max(0, n.z - 2) : w.z) + 1.6, n.x, n.y, hz)) best = d;
      }
      if (best) { dirs++; far = Math.max(far, best); }
    }
    // (someone in a room, game.json interiors, is seen through its door and windows, not across the street)
    const room = g.doors && g.doors.roomAt(n.x, n.y, n.z);
    out.push({ id: n.id, name: n.name, room: room ? room.id : null, at: [Math.round(n.x), Math.round(n.y)], moved: Math.hypot(n.x - n.at[0], n.y - n.at[1]), light, dirs, far });
  }
  if (B && B.rounds) { g.setClock(c.y, c.m, c.d, was.min); c.frozen = was.frozen; B.rounds(true); }
  return out;
}
const verdict = r => {
  const why = [];
  if (r.light != null && r.light < LIGHT_MIN) why.push(`dark (${r.light.toFixed(2)} < ${LIGHT_MIN})`);
  if (!r.room && (r.dirs < SIGHT_MIN || r.far < FAR_MIN)) why.push(`hidden (seen from ${r.dirs} of 16 directions, at most ${r.far} m)`);
  return why;
};
module.exports = { survey, verdict, LIGHT_MIN, SIGHT_MIN, FAR_MIN };

if (require.main === module) {
  const { chromium } = require('playwright');
  const fs = require('fs'), path = require('path');
  const all = fs.readdirSync(path.join(__dirname, '..', 'web', 'data')).filter(c => fs.existsSync(path.join(__dirname, '..', 'web', 'data', c, 'game.json')));
  const cities = process.argv.slice(2).length ? process.argv.slice(2) : all;
  (async () => {
    const b = await chromium.launch(process.env.DISPLAY
      ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
      : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    let bad = 0;
    for (const city of cities) {
      const p = await b.newPage({ viewport: { width: 800, height: 500 } });
      await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.npcsReady && window.__game.npcsReady()); // (the NPCs' characters load after the game opens)
      const rs = await p.evaluate(survey);
      console.log(`${city}: ${await p.evaluate(() => { const N = window.__game.Wd.night; return `${N.lamps} lamps, ${N.foot} along the ways on foot, ${N.spots} at meeting places`; })}`);
      for (const r of rs) {
        const why = verdict(r);
        if (why.length) bad++;
        console.log(`${why.length ? 'FAIL' : 'ok  '} ${city} ${r.id} at ${r.at}: light ${r.light == null ? '-' : r.light.toFixed(2)}, seen from ${r.dirs}/16 up to ${r.far} m${r.moved > 3 ? `, stands ${r.moved.toFixed(0)} m from where game.json puts them` : ''}${why.length ? ' — ' + why.join(', ') : ''}`);
      }
      await p.close();
    }
    await b.close();
    process.exit(bad ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
