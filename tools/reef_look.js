// Several stills of the reef or alpine game from one page load: the player's camera orbits to each view in turn
// (a close look at a character from the front, the side and the back; a landmark from eye level), so a check of
// one thing does not pay for a page load per angle on a software renderer.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) xvfb-run -a node tools/reef_look.js "city=lake-tekapo&gl=1&mute=1" out/tek \
//     '[{"tag":"side","yaw":90,"pitch":-4,"dist":2.2},{"tag":"church","x":432,"north":40,"heading":16,"yaw":16,"pitch":2,"dist":3.4}]'
// A view: yaw, pitch (degrees) and dist (metres) of the camera round the player; x, north and heading move the player
// there first; body (degrees) turns the body to that heading (yaw is then relative to nothing: it is the camera's own).
// Under xvfb-run (DISPLAY set) it uses Mesa's llvmpipe; W and H set the viewport (MOBILE=1 for a phone).
const { chromium } = require('playwright');
const [,, query, prefix, viewsJson = '[]', wait = '6000'] = process.argv;
(async () => {
  const args = process.env.DISPLAY ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox']
    : ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1), isMobile: !!process.env.MOBILE, hasTouch: !!process.env.MOBILE });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  p.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 300)));
  // a player who has seen the intro (no tour over the stills)
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (_) {} });
  await p.goto('http://localhost:' + (process.env.PORT || 8800) + '/reef/index.html?' + query);
  try { await p.waitForFunction('window.__ready && window.__player', null, { timeout: 240000 }); } catch (e) { logs.push('timeout waiting ready'); }
  // the arrival's camera move settled at once (it would take minutes of frames on a software renderer)
  await p.evaluate(() => { const g = window.__game; if (g && g.arrival && g.arrival.on && g.settleArrival) g.settleArrival(); });
  try { await p.waitForFunction('!(window.__game && window.__game.arrival && window.__game.arrival.on)', null, { timeout: 90000 }); } catch (e) { logs.push('arrival still running'); }
  await p.waitForTimeout(Number(wait));
  for (const v of JSON.parse(viewsJson)) {
    await p.evaluate(v => {
      const pl = window.__player.player, S = pl.S, R = Math.PI / 180;
      if (v.x !== undefined) pl.teleport(v.x, v.north, undefined, v.heading);
      if (v.body !== undefined) S.bodyYaw = v.body * R;
      if (v.yaw !== undefined) S.camYaw = v.yaw * R;
      if (v.pitch !== undefined) S.camPitch = v.pitch * R;
      if (v.dist !== undefined) S.dist = v.dist;
      if (v.view) S.view = v.view;
    }, v);
    await p.waitForTimeout(Number(v.wait || 2500));
    const out = `${prefix}-${v.tag}.png`;
    await p.screenshot({ path: out });
    const hud = await p.evaluate(() => document.getElementById('hud').textContent);
    console.log(`${out}: ${hud}`);
  }
  if (logs.length) console.log(logs.slice(0, 8).join('\n'));
  await b.close();
})();
