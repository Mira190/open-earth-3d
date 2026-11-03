// Stills of the gold route in a city's game (web/game/route.js): on foot behind the surveyor, from
// your car and from the helicopter, each with the route to the NPC the surveyor can walk to that
// is farthest away (a waypoint), at the clock times given (HH:MM, or dusk and night: ten minutes
// before sunset and an hour after it), at the desktop picture tier. Prints the route each still
// shows and the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/route_shot.js sydney out_dir [10:30,dusk,night] [WxH]   # llvmpipe; without xvfb-run, SwiftShader
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', times = '10:30', size = '1440x900'] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.ways.ready', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  const shot = async name => {
    const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
    fs.writeFileSync(path.join(outDir, `${city}-route-${name}-${w}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  // the target: the farthest NPC a walker can reach from the start, set as a waypoint
  const to = await p.evaluate(() => {
    const g = window.__game, me = { x: g.player.x, y: g.player.y, z: g.player.z };
    window.__start = me;
    const n = g.npcs.slice().sort((a, b) => Math.hypot(b.x - me.x, b.y - me.y) - Math.hypot(a.x - me.x, a.y - me.y)).find(q => g.ways.walk(me, q));
    if (!n) return null;
    g.waypoint([n.x, n.y]);
    return n.name;
  });
  console.log(`route to ${to}`);
  // the camera behind you, looking along the line a little way ahead
  const along = mode => p.evaluate(mode => {
    const g = window.__game, q = g.guide().pts, me = mode === 'heli' ? g.heli.st : mode === 'car' ? g.myCar().D.st : g.player;
    if (g.cine.active) g.cine.skip();
    if (!q) return 'no route';
    let i = 1, d = 0;
    while (i < q.length - 1 && d < (mode === 'heli' ? 120 : 25)) { d += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); i++; }
    const yaw = Math.atan2(q[i][0] - me.x, q[i][1] - me.y);
    Object.assign(g.cam, { mode: 'chase', yaw, pitch: mode === 'heli' ? 0.32 : 0.28, dist: mode === 'heli' ? 26 : mode === 'car' ? 9 : 7, distTo: 0, yawTo: null, lastInput: 1e9 }); // (as if just turned: the camera stays put)
    if (mode === 'foot') g.player.h = yaw;
    g.advance(0.6);
    return `${q.length} points`;
  }, mode);
  for (const t of times.split(',')) {
    const tag = t.replace(':', '');
    // on foot, from the start
    await p.evaluate(t => {
      const g = window.__game, c = g.clock, s = window.__start, L = g.dayLimits();
      const min = t === 'dusk' ? L.sunset - 10 : t === 'night' ? L.sunset + 60 : t.split(':').map(Number).reduce((h, m) => h * 60 + m);
      if (g.player.mode === 'heli') { for (let i = 0; i < 60 && !g.heli.st.landed; i++) g.advance(0.5, ['KeyC']); g.advance(1); g.exitHeli(); g.advance(2); }
      if (g.player.mode === 'car') { g.myCar().D.st.v = 0; g.myCar().D.st.speed = 0; g.exitCar(); g.advance(0.5); }
      g.setClock(c.y, c.m, c.d, min);
      Object.assign(g.player, { x: s.x, y: s.y, z: s.z });
      g.advance(1);
    }, t);
    console.log(`${t} on foot: ${await along('foot')}`);
    await shot(`foot-${tag}`);
    // in your car
    if (await p.evaluate(() => !!window.__game.myCar())) {
      await p.evaluate(() => { const g = window.__game, d = g.myCar().D.st; g.player.x = d.x + 2.5; g.player.y = d.y; g.player.z = d.z; g.advance(0.2); g.enterCar(); for (let i = 0; i < 20 && g.player.mode !== 'car'; i++) g.advance(0.5); g.advance(0.5); });
      console.log(`${t} by car: ${await along('car')}`);
      await shot(`car-${tag}`);
      await p.evaluate(() => { const g = window.__game; g.myCar().D.st.v = 0; g.myCar().D.st.speed = 0; g.exitCar(); g.advance(0.5); });
    }
    // up in the helicopter
    await p.evaluate(() => { const g = window.__game, d = g.heli.doorAt(); g.player.x = d.x; g.player.y = d.y; g.player.z = g.heli.st.z; g.enterHeli(); g.advance(3); g.advance(7, ['Space']); g.advance(0.5); });
    console.log(`${t} flying: ${await along('heli')}`);
    await shot(`heli-${tag}`);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
