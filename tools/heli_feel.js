// How the helicopter flies and how its camera follows (issue 335), in numbers, with the game held in lockstep:
//   - stop: from top speed, the stick let go, the seconds until it hovers (under 2 m/s);
//   - brake: the same with the stick pulled back;
//   - slip: after 3 s of a full turn at speed, the angle between where it goes and where its nose points;
//   - bank: the roll in that turn;
//   - jitter: in steady flight at speed, with the frames coming unevenly (a 30th and a 90th of a second in turn),
//     how far the camera's distance from the helicopter wobbles from frame to frame (m, the largest step);
//   - switch: on V, the largest jump of the camera between two frames (m) and of its direction (degrees).
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/heli_feel.js sydney
const { chromium } = require('playwright');
const [,, city = 'sydney'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await p.evaluate(async () => { const g = window.__game; g.hold(true, true); if (g.heli && g.heli.want) await g.heli.want(); g.advance(2); });
  const r = await p.evaluate(() => {
    const g = window.__game, H = g.heli, st = H.st, out = {};
    const d = H.doorAt();
    g.player.x = d.x; g.player.y = d.y; g.player.z = st.z;
    g.advance(0.3); g.enterHeli();
    for (let i = 0; i < 20 && g.player.mode !== 'heli'; i++) g.advance(0.5);
    if (g.player.mode !== 'heli') return { none: 'not aboard' };
    for (let i = 0; i < 16; i++) g.advance(0.5, ['Space']); // spool up and climb
    const top = () => { for (let i = 0; i < 40; i++) g.advance(0.25, ['KeyW']); };
    top(); out.top = st.speed;
    let t = 0; while (st.speed > 2 && t < 20) { g.advance(0.1); t += 0.1; } out.stop = t;
    top(); t = 0; while (st.speed > 2 && t < 20) { g.advance(0.1, ['KeyS']); t += 0.1; } out.brake = t;
    top();
    for (let i = 0; i < 30; i++) g.advance(0.1, ['KeyW', 'KeyD']);
    const vh = Math.atan2(st.vx, st.vy), dh = Math.atan2(Math.sin(vh - st.h), Math.cos(vh - st.h));
    out.slip = Math.abs(dh) * 180 / Math.PI; out.bank = Math.abs(st.roll) * 180 / Math.PI; out.turnSpeed = st.speed;
    // the camera at speed with uneven frames (the keys held through g.frame by the game's own key set)
    top();
    g.keys.add('KeyW');
    const C = g.camera, gap = () => Math.hypot(C.position.x - st.x, -C.position.z - st.y, C.position.y - st.z);
    let last = null, worst = 0;
    for (let i = 0; i < 90; i++) { g.frame(i % 2 ? 1 / 90 : 1 / 30); const d = gap(); if (last != null && i > 20) worst = Math.max(worst, Math.abs(d - last)); last = d; }
    out.jitter = worst; out.camDist = last;
    // V: chase -> cockpit, the camera's steps
    const P = C.position.clone(), D = new THREE.Vector3(), D0 = new THREE.Vector3();
    C.getWorldDirection(D0);
    g.nextView();
    let jump = 0, turnJ = 0;
    for (let i = 0; i < 40; i++) {
      g.frame(1 / 60);
      C.getWorldDirection(D);
      jump = Math.max(jump, C.position.distanceTo(P) - st.speed / 60); turnJ = Math.max(turnJ, D.angleTo(D0) * 180 / Math.PI);
      P.copy(C.position); D0.copy(D);
    }
    out.view = g.cam.mode; out.switchJump = jump; out.switchTurn = turnJ;
    g.keys.delete('KeyW');
    return out;
  });
  const f = (v, n = 1) => (typeof v === 'number' ? v.toFixed(n) : v);
  console.log(r.none ? r.none : `top ${f(r.top)} m/s; stop ${f(r.stop)} s; brake ${f(r.brake)} s; slip ${f(r.slip)}° and bank ${f(r.bank)}° in a turn at ${f(r.turnSpeed)} m/s; jitter ${f(r.jitter, 3)} m at ${f(r.camDist)} m; switch to ${r.view}: ${f(r.switchJump, 2)} m and ${f(r.switchTurn)}° at most a frame`);
  await b.close();
})();
