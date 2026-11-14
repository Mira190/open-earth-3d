// Stills of a city's game from free cameras, with the world running: the crowd walks, the signals
// change, the screens play. For the look of a place (docs/LOOK.md): each view at each hour, as the
// player would see it from that spot, through the game's own post stack and tier.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/scramble_shot.js shibuya tools/views/shibuya-scramble.json out_dir [WxH]
// views.json: {"times": {"day": "13:00", "dusk": "sunset+15", "night": "21:00", "rain": {"time": "21:00", "weather": "rain"}},
//              "views": [{"name": "hachiko", "eye": [x, y, dz], "look": [x, y, dz], "fov": 50}, ...]}
// dz is metres over the ground there; "people": [x, y] (with crowd_r, crowd_n) stages the crowd round a point, as a film shot does. "date": [month, day]; TIER=high|medium|low (default high);
// ONLY=name,name and TIMES=day,night pick some; SETTLE=seconds the world runs before each still (6).
// PROBE=fx,fy;fx,fy lists what a ray through those points of the frame meets (a still that looks wrong: what is it?).
// Prints the frame time the page measured for each still (ms, median of FRAMES (9) frames on this renderer).
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const { pinClock } = require('./pin_clock.js');
const [,, city = 'shibuya', viewsFile, outDir = '.', size = '1440x900'] = process.argv;
const spec = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null, onlyT = process.env.TIMES ? process.env.TIMES.split(',') : null;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mobile = w < 600;
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  if (pinClock) await pinClock(p, city);
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const g = window.__game;
    for (const id of ['g-title', 'g-menu', 'g-bigmap', 'g-pass']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    if (g.cine.active) g.cine.skip();
    if (g.settleArrival) try { g.settleArrival(); } catch (e) { /* no arrival */ }
    g.clock.frozen = true;
    document.body.classList.add('shot');
    const st = document.createElement('style');
    st.textContent = '#g-hud, .g-hud, #g-toast, #g-caption, .tour, #g-onboard, #g-tour, #g-area { display: none !important; }';
    document.head.appendChild(st);
    window.__shot = { pose: { pos: new THREE.Vector3(), look: new THREE.Vector3() }, fov: 50 };
    const cam = g.camera, upm = cam.updateProjectionMatrix.bind(cam);
    cam.updateProjectionMatrix = () => { cam.fov = window.__shot.fov; upm(); };
  });
  const views = spec.views.filter(v => !only || only.includes(v.name));
  const times = Object.entries(spec.times).filter(([k]) => !onlyT || onlyT.includes(k));
  const settle = +(process.env.SETTLE || 6);
  for (const [tname, tv0] of times) {
    const tv = typeof tv0 === 'string' ? { time: tv0 } : tv0;
    for (const v of views) {
      const ms = await p.evaluate(async ({ v, tv, date, settle, nf }) => {
        const g = window.__game, c = g.clock, m = date ? date[0] : c.m, d = date ? date[1] : c.d;
        g.setClock(c.y, m, d, c.min);
        const rel = /^(sunrise|sunset)([+-]\d+)?$/.exec(tv.time || '');
        let min = 12 * 60;
        if (rel && g.dayLimits) min = Math.round(g.dayLimits()[rel[1]] + (+rel[2] || 0));
        else if (tv.time) { const [hh, mm] = tv.time.split(':').map(Number); min = hh * 60 + mm; }
        g.setClock(c.y, m, d, min);
        // the weather (game/weather.js: "clear", "overcast", "drizzle", "rain"), at once rather than coming on;
        // without one, the wet street alone (mirror.js)
        if (g.weather && g.weather.set) g.weather.set(tv.weather || 'clear', { now: true });
        else if (g.mirror) g.mirror.wet = tv.weather === 'rain' ? 1 : 0;
        // (a view's "floor": the height of the deck it stands on, where that is not the ground under it)
        const gz = (x, y) => { if (v.floor != null) return v.floor; const f = g.nav.floorAt(x, y, g.nav.terrain(x, y) + 0.5); return f ? f.z : Math.max(0, g.nav.terrain(x, y)); };
        const W = (x, y, z) => new THREE.Vector3(x, z, -y);
        const S = window.__shot;
        S.pose.pos.copy(W(v.eye[0], v.eye[1], gz(v.eye[0], v.eye[1]) + v.eye[2]));
        S.pose.look.copy(W(v.look[0], v.look[1], gz(v.look[0], v.look[1]) + v.look[2]));
        S.fov = v.fov || 50;
        // the player stands by the camera, out of the frame, so the crowd and the traffic are round it
        g.player.x = v.eye[0]; g.player.y = v.eye[1]; g.player.z = gz(v.eye[0], v.eye[1]);
        if (g.player.rig) g.player.rig.root.visible = false;
        g.cine.stop();
        g.cine.play(() => S.pose, 1e9, { label: 'film' });
        // "people": [x, y] puts the crowd on the footways round that point, as the films do
        // (tools/film/director.js), crowd_n of them within crowd_r m, none within 6 m of the camera
        if (v.people) {
          if (g.crowdAuto) g.crowdAuto(false);
          const C = g.crowd, net = g.footNet, cand = net.near(v.people[0], v.people[1], 0, v.crowd_r || 90), tmp = {};
          let seed = 99;
          const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
          C.active = Math.min(C.P.length, v.crowd_n || C.P.length);
          for (const p of C.P.slice(0, C.active)) {
            if (p.seat) { p.seat.by = -1; p.seat = null; }
            p.state = 'walk'; p.mode = 'ground'; p.lat = null; p.pause = 0; p.dodge = 0;
            for (let k = 0; k < 12; k++) {
              p.line = cand[Math.floor(rnd() * cand.length)]; p.s = rnd() * net.L[p.line].len; net.at(p.line, p.s, tmp);
              if (Math.hypot(tmp.x - v.eye[0], tmp.y - v.eye[1]) >= 6) break;
            }
            p.dir = rnd() < 0.5 ? 1 : -1; p.x = tmp.x; p.y = tmp.y; p.z = tmp.z;
          }
        }
        g.advance(settle);
        // a hero level near the camera (game/hero.js) loaded and shown before the still: frames until none is loading
        if (g.hero && g.hero()) for (let i = 0; i < 1200; i++) { await new Promise(r => requestAnimationFrame(r)); if (i > 3 && !g.hero().state().some(h => h.state === 'loading')) break; }
        g.Wd.fitShadow(S.pose.look, 300);
        // the frame time on this renderer: the median of nf real frames
        const ts = [];
        for (let i = 0; i < nf + 1; i++) ts.push(await new Promise(r => requestAnimationFrame(r)));
        const dts = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
        return dts[Math.floor(nf / 2)];
      }, { v, tv, date: spec.date, settle, nf: +(process.env.FRAMES || 9) });
      const png = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('game-gl').toDataURL('image/png'))))));
      // PROBE=0.5,0.6;0.7,0.5: what stands along the ray through those points of the frame (fractions from the top
      // left), nearest first: each mesh's name, its material, colour, opacity, glow and share of the sky mirrored
      if (process.env.PROBE) {
        const hits = await p.evaluate(pts => {
          const g = window.__game, rc = new THREE.Raycaster(), out = [];
          for (const [fx, fy] of pts) {
            rc.setFromCamera(new THREE.Vector2(fx * 2 - 1, 1 - fy * 2), g.camera);
            const seen = [];
            for (const h of rc.intersectObject(g.Wd.world, true)) {
              if (!h.object.visible || seen.length >= 6) continue;
              const m = Array.isArray(h.object.material) ? h.object.material[(h.face && h.face.materialIndex) || 0] : h.object.material;
              let vis = true; for (let o = h.object; o; o = o.parent) vis = vis && o.visible;
              if (!vis) continue;
              seen.push(`${h.distance.toFixed(1)} m  ${h.object.name || h.object.type} / ${m && m.name || '?'}  #${m && m.color ? m.color.getHexString() : ''} op ${m && m.transparent ? m.opacity : 1}`
                + ` glow ${m && m.emissiveIntensity != null ? (+m.emissiveIntensity).toFixed(2) : '-'} sky ${m && m.envMapIntensity != null ? m.envMapIntensity : '-'} rough ${m && m.roughness} metal ${m && m.metalness}`);
            }
            out.push(`  at ${fx},${fy}:\n    ` + seen.join('\n    '));
          }
          return out.join('\n');
        }, process.env.PROBE.split(';').map(q => q.split(',').map(Number)));
        console.log(`${v.name}-${tname} probe\n${hits}`);
      }
      const name = `${v.name}-${tname}`;
      fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
      console.log(`${name}\t${ms.toFixed(1)} ms`);
    }
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
