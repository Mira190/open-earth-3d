// Where a city's game starts you, and how far that is from a ride: the helicopter (the first
// helipad), the nearest ferry wharf's landing and the nearest kerb a taxi can pull in at. With
// points, it also finds open ground for a helipad near each (a 10 m circle free of buildings,
// landmarks and walls up to 40 m, on the ground or a pier) and the kerb and wharf from there.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/start_probe.js sydney                 # the start as it is
//   xvfb-run -a node tools/start_probe.js sydney -100,150 300,400 # and open ground near these
//   PADR=7 (a smaller circle), ROOF=300 xvfb-run -a node tools/start_probe.js shibuya 540,-1130  # roofs and decks below 300 m too
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const [,, city = 'sydney', ...pts] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  const out = await p.evaluate(([pts, roof, padR]) => {
    const g = window.__game, nav = g.nav, G = window.__gameData || null;
    const wh = (g.fer && g.fer.wharves) || [];
    const fromHere = (x, y, z) => {
      const k = g.roads.place(x, y, 400, 1, z);
      const r = { kerb: k && Math.abs(k.z - z) < 4 ? Math.round(k.d) : null, heli: g.heli ? Math.round(Math.hypot(g.heli.st.x - x, g.heli.st.y - y)) : null };
      return r;
    };
    const res = { start: { x: +g.player.x.toFixed(1), y: +g.player.y.toFixed(1) } };
    Object.assign(res.start, fromHere(g.player.x, g.player.y, g.player.z));
    res.near = [];
    for (const s of pts) {
      const [cx, cy] = s.split(',').map(Number), found = [];
      for (let r = 0; r <= 220 && found.length < 6; r += 5) {
        const n = r ? Math.ceil(2 * Math.PI * r / 5) : 1;
        for (let k = 0; k < n; k++) {
          const a = 2 * Math.PI * k / n, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          const f = nav.floorAt(x, y, roof || Math.max(0, nav.terrain(x, y)) + 1);
          if (!f || (!roof && f.kind !== 'ground' && f.kind !== 'pier')) continue;
          let ok = nav.free(x, y, f.z + 0.3, f.z + 40, padR); // the sky clear for a climb, as vehicles.js checks it
          for (let j = 0; ok && j < 16; j++) { const b = 2 * Math.PI * j / 16, q = nav.floorAt(x + Math.cos(b) * padR * 0.8, y + Math.sin(b) * padR * 0.8, f.z + 1); ok = !!q && Math.abs(q.z - f.z) < 1.2; }
          if (!ok || found.some(o => Math.hypot(o.x - x, o.y - y) < 25)) continue;
          const h = fromHere(x, y, f.z);
          if (h.kerb != null && h.kerb < 9) continue; // on the road
          found.push(Object.assign({ x: Math.round(x), y: Math.round(y), z: +f.z.toFixed(1), kind: f.kind, from: Math.round(r) }, h));
        }
      }
      res.near.push({ at: [cx, cy], kerbHere: fromHere(cx, cy, 0).kerb, pads: found });
    }
    return res;
  }, [pts, +process.env.ROOF || 0, +process.env.PADR || 10]);
  out.errors = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
