// Board the helicopter on its first pad and hold Space on the real keyboard (as a player does, not the
// game's own key list): prints the rotor and the height every second, then the same beside the nearest
// fence or wall within 25 m of the pad, where the rotor's disc overhangs it.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/heli_lift.js shibuya [shots_dir WxH]   # with a folder: the page as the first
//   flight's coach shows each step (onboard.js), at that size (1440x900 by default; 390x844 a phone)
const { chromium } = require('playwright');
const [,, city = 'shibuya', shots = '', size = '1440x900'] = process.argv;
const [vw, vh] = size.split('x').map(Number), phone = vw < 700;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage(shots ? { viewport: { width: vw, height: vh }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone } : { viewport: { width: 960, height: 600 } });
  if (shots) require('fs').mkdirSync(shots, { recursive: true });
  const snap = async n => { if (shots) await p.screenshot({ path: `${shots}/${n}.png` }); };
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
    // (the title comes up once the loader has drawn the scene twice; a click before it is lost: click until it goes)
  await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
    await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
    await p.waitForTimeout(1000);
  }
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); await g.ways.build(); if (g.heli.want) await g.heli.want(); });
  await p.evaluate(() => { const g = window.__game; g.advance(1); if (g.cine && g.cine.active && g.cine.skip) g.cine.skip(); g.advance(3); });
  const fly = async (label, place) => {
    await p.evaluate(place => {
      const g = window.__game;
      if (place) { g.heli.st.x = place[0]; g.heli.st.y = place[1]; g.heli.st.z = g.nav.groundBelow(place[0], place[1], g.heli.st.z + 2); g.heli.st.h = place[2]; g.advance(0.1); }
      const d = g.heli.doorAt(); g.player.x = d.x; g.player.y = d.y; g.player.z = g.heli.st.z; g.player.mode = 'foot';
      g.enterHeli(); g.advance(3); g.advance(3);
    }, place);
    if (!place) { await p.evaluate(() => { const g = window.__game; g.heli.st.rotor = 0; g.advance(0.5); }); await snap('1-spool'); await p.evaluate(() => window.__game.advance(4)); await snap('2-climb'); }
    const z0 = await p.evaluate(() => window.__game.heli.st.z);
    await p.keyboard.down('Space');
    const rows = [];
    for (let t = 1; t <= 6; t++) { await p.evaluate(() => window.__game.advance(1)); rows.push(await p.evaluate(() => { const s = window.__game.heli.st; return `rotor ${s.rotor.toFixed(2)} z ${s.z.toFixed(1)} landed ${s.landed}`; })); }
    await p.keyboard.up('Space');
    if (!place) await snap('3-fly');
    const z1 = await p.evaluate(() => window.__game.heli.st.z);
    console.log(`${label}: climbed ${(z1 - z0).toFixed(1)} m (mode ${await p.evaluate(() => window.__game.player.mode)})\n  ${rows.join('\n  ')}`);
    await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 30 && !g.heli.st.landed; i++) g.advance(0.5, ['KeyC']); });
  };
  await fly('on the pad');
  // beside something: a spot within 25 m of the pad where it can set down but its rotor's disc overhangs a
  // fence or a wall (what the climb's check reads), the nearest first
  const spot = await p.evaluate(() => {
    const g = window.__game, s = g.heli.st;
    for (let r = 3; r <= 25; r += 1) for (let a = 0; a < 6.28; a += 0.15) {
      const x = s.x + Math.sin(a) * r, y = s.y + Math.cos(a) * r, z = g.nav.groundBelow(x, y, s.z + 2);
      if (z < s.z - 4 || !g.nav.free(x, y, z + 0.3, z + 0.6, 1.5)) continue;
      if (!g.nav.free(x, y, z + 0.3, z + 3.6, 3.2)) return [x, y, s.h];
    }
    return null;
  });
  console.log('after landing', await p.evaluate(() => { const s = window.__game.heli.st; return [s.x, s.y, s.z, s.landed].map(String).join(' '); }), 'spot', JSON.stringify(spot));
  if (spot) await fly(`2 m from a fence at ${spot.slice(0, 2).map(v => v.toFixed(1))}`, spot);
  console.log(errs.join('\n'));
  await b.close();
})();
