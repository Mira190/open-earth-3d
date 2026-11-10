// Stills from a city's game, two kinds of view, through the game's own sky, haze and post stack:
//   - on foot: the surveyor stands at `at` facing `look`, the chase camera behind at `dist` metres and
//     `pitch` radians, to look at a change the way a player sees it;
//   - from the air: a camera at `cam` looking at `tgt` (x, y, z) over the title screen, by the hook
//     tools/flyover.js records with, to see the world the viewer and the game share (world.js,
//     water.js) whole, as tools/city_shot.js does for the viewer.
// Each at the clock time given (HH:MM local, or relative to the day's sun: "sunset+20", "sunrise-15");
// "date" [month, day] sets the day; "weather" the weather (clear unless given; "flash" and "rainbow" hold a lightning flash and a bow); "ao" the contact shadows
// (game/ao.js: 0 off, 1 lite, 2 full, the default). The views from the air are taken first, while the title is up.
// Prints the page's errors.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/game_shot.js sydney views.json out_dir [WxH]   # llvmpipe; without xvfb-run, SwiftShader
// views.json: [{"name": "steps", "at": [x, y], "look": [x, y], "time": "15:30", "dist": 6, "pitch": 0.15},
//              {"name": "harbour", "cam": [x, y, z], "tgt": [x, y, z], "time": "sunset-25"}, ...]
// ("closer": a photo spot's id looks closer at it from where you stand, "along": seconds looking along it,
// "up": seconds up (or down, negative) between its rails, with the panel up: a screenshot of the page, not the canvas;
// "street": true stands on the ground there rather than on the roof over it; "z": on the floor
// nearest that level, as under a slab; "ferry": {to, at} aboard a vessel that far along its leg to that wharf;
// "hide": [mesh names] leaves those landmark meshes out; "scramble": "walk" or "wait" runs on to that moment of the
// nearest scramble's cycle; "eye": [x, y, z] looks from there at "look" instead of the chase camera; [x, y] from
// "eyeUp" metres, 1.6 by default, over the ground where you stand; "lookUp": the point looked at that far over it,
// as up a tower's side)
// "clear": metres within which the stand moves to the clearest view of "look" (see below);
// "js": a statement run in the page before a view is taken (g: the game), e.g. a clear sky for the stars, or the
// railway at a second of its timetable ("g.trains.t = 131; g.trains.update(0, g.camera)");
// in the city's local frame (x east, y north, z up, metres).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', viewsFile, outDir = '.', size = '1440x900'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  // a software renderer picks the low tier for itself; stills are taken at the desktop one
  await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  // a player who has been through the HUD tour (web/onboard.js), so that its card is not in the stills
  await p.addInitScript(() => { try { localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } });
  await p.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
    };
  });
  const logs = [];
  p.on('console', m => { if (m.text().startsWith('[clear]')) console.log(m.text()); else if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/${process.env.QUERY || ""}#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game && window.__game.flyover', null, { timeout: 600000 });
  // and the loader gone: the game draws its first frame only once its shaders and uploads are done (world.js
  // compile), so a view from the air grabbed before that was black (issue 313)
  await p.waitForFunction(() => { const l = document.getElementById('g-loader'); return !l || l.hidden; }, null, { timeout: 900000, polling: 500 });
  await p.evaluate(() => window.__game.groundShown && window.__game.groundShown()); // (the far aerial tiles, which come after the loader)
  // the view's day and time on the game's clock
  await p.evaluate(() => {
    window.__shotClock = v => {
      const g = window.__game, c = g.clock, m = v.date ? v.date[0] : c.m, d = v.date ? v.date[1] : c.d;
      g.setClock(c.y, m, d, c.min);
      const rel = /^(sunrise|sunset)([+-]\d+)?$/.exec(v.time || '');
      let min = 12 * 60;
      if (rel && g.dayLimits) min = Math.round(g.dayLimits()[rel[1]] + (+rel[2] || 0));
      else if (v.time) { const [hh, mm] = v.time.split(':').map(Number); min = hh * 60 + mm; }
      g.setClock(c.y, m, d, min);
      if (g.weather) {
        g.weather.set(v.weather || 'clear', { now: true }); // "weather": clear, overcast, fog, drizzle, rain, storm, snow, or amounts (weather.js)
        // "flash": {dist, bearing (degrees from north), ground, k} holds a lightning flash at strength k; "rainbow": 0..1 holds a bow
        g.weather.flashPin = v.flash ? v.flash.k ?? 0.8 : null;
        if (v.flash) g.weather.strike(g.t(), { dist: v.flash.dist ?? 900, bearing: (v.flash.bearing ?? 0) * Math.PI / 180, ground: v.flash.ground !== false });
        g.weather.bowPin = v.rainbow ?? null;
      }
      if (g.atmos && g.atmos.ao) g.atmos.ao.set(v.ao ?? 2); // "ao": 0 off, 1 lite, 2 full (game/ao.js), to compare
    };
  });
  const grabPage = async name => { await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(name); };
  // a frame of the game's canvas; one that comes out black (nearly every pixel dark: a frame grabbed before the
  // game drew the view, which Sydney's large first frames from the air did on a software renderer, #326) is taken
  // again a few frames later, up to 12 times, and a canvas whose WebGL context is lost says so
  const grab = async name => {
    let png = null, dark = 1, tries = 0;
    // the sun's far shadow field for this view's hour, where the page makes one in a Worker (world.js farSun): wait for it
    await p.waitForFunction(() => { const f = window.__game && window.__game.Wd && window.__game.Wd.farSun; return !f || (!f.pending && !f.want); }, null, { timeout: 60000 }).catch(() => {});
    for (; tries < 12; tries++) {
      ({ png, dark } = await p.evaluate(async n => {
        for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
        const c = document.getElementById('game-gl'), s = document.createElement('canvas'); s.width = 64; s.height = 40;
        const g = s.getContext('2d'); g.drawImage(c, 0, 0, 64, 40);
        const d = g.getImageData(0, 0, 64, 40).data;
        let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 6) k++;
        return { png: c.toDataURL('image/png'), dark: k / (d.length / 4) };
      }, tries ? 20 : 2));
      if (dark < 0.97) break;
    }
    if (dark >= 0.97) {
      const lost = await p.evaluate(() => { const c = document.getElementById('game-gl'), gl = c.getContext('webgl2') || c.getContext('webgl'); return !gl || gl.isContextLost(); });
      console.log(`${name}: still black after ${tries} tries${lost ? ' (the WebGL context is lost)' : ''}`);
    }
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(name + (tries ? ` (black at first: taken again ${tries}x)` : ''));
  };
  // from the air, over the title screen (its scripted camera drives only the title's view)
  const air = views.filter(v => v.cam), foot = views.filter(v => !v.cam);
  for (const v of air) {
    await p.evaluate(async v => {
      window.__shotClock(v);
      const tgt = v.tgt || [v.cam[0], v.cam[1] + 100, v.cam[2] - 30]; // (no target: ahead to the north, looking down)
      const d = Math.hypot(v.cam[0] - tgt[0], v.cam[1] - tgt[1], v.cam[2] - tgt[2]);
      window.__game.flyover.camera({ cam: v.cam, look: tgt, shadow: Math.min(3000, Math.max(600, 0.7 * d)) });
      if (v.js) new Function('g', v.js)(window.__game); // "js": a statement run in the page before the still (g: the game), to pin what a view needs
      for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r)); // the waves and the shadow map settle
    }, v);
    await grab(v.name);
  }
  if (air.length) await p.evaluate(() => window.__game.flyover.camera(null));
  // on foot, in the game
  if (foot.length) {
    // (the title comes up once the loader has drawn the scene twice; a click before it does nothing)
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 300000 }).catch(() => {});
    const play = await p.$('#gt-play');
    if (play) await play.click().catch(() => {});
    // until the title has gone (a click while the city is still loading can be lost): click again
    for (let i = 0; i < 60 && !(await p.evaluate(() => { const t = document.getElementById('g-title'); return !t || t.hidden; })); i++) {
      await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
      await p.waitForTimeout(1000);
    }
    // the arrival's crane shot: settled, so that it does not fly the camera over the first view
    await p.evaluate(async () => {
      const g = window.__game;
      for (let t = 0; t < 10 && (!g.arriving || !g.arriving()); t += 0.25) await new Promise(r => setTimeout(r, 250));
      for (let t = 0; t < 10 && g.arriving && g.arriving(); t += 0.25) { g.settleArrival(); g.advance(0.25); await new Promise(r => requestAnimationFrame(r)); }
    });
    // and no first-time tour over the view
    await p.evaluate(() => { const O = window.OEOnboard, t = O && O.current && O.current(); if (t) t.skip(); });
  }
  for (const v of foot) {
    await p.evaluate(v => {
      const g = window.__game;
      for (let i = 0; i < 40 && g.arriving && g.arriving(); i++) { g.settleArrival(); g.advance(0.1); } // an arrival that began late
      if (g.cine.active) g.cine.skip();
      window.__shotClock(v);
      // "clear": metres. The stand (and an "eye" over it) moves to the place within that far of "at" with the
      // clearest view of "look": from each place someone can stand, the trees within 45 m in the frame's width count
      // against it, the nearer and the nearer the middle the more, and so does a building met within 40 m by rays
      // over the frame. The place taken is printed, to write back into the view.
      if (v.clear) {
        const rc = new THREE.Raycaster(), RAD = Math.PI / 180;
        rc.far = 40;
        const T = window.__trunks || (window.__trunks = g.Wd.trees && g.Wd.trees.trunks ? g.Wd.trees.trunks() : []);
        const score = (x, y) => {
          const p = g.nav.stand(x, y, v.z != null ? v.z + 0.5 : g.nav.terrain(x, y) + 0.5, { rMax: 0.5 });
          if (!p || g.nav.isWater(p.x, p.y) || (v.z != null && Math.abs(p.z - v.z) > 2)) return null;
          const ez = p.z + (v.eyeUp ?? 1.6), d = Math.hypot(v.look[0] - p.x, v.look[1] - p.y);
          const yaw0 = Math.atan2(v.look[0] - p.x, v.look[1] - p.y), pit0 = Math.atan2((v.lookZ ?? p.z + (v.lookUp ?? 1.2)) - ez, d);
          let n = 0;
          for (let i = 0; i < T.length; i += 4) {
            const dx = T[i] - p.x, dy = T[i + 1] - p.y, td = Math.hypot(dx, dy);
            if (td > 45 || td > d) continue;
            if (td < 5) { n += 6; continue; } // under its crown
            const a = Math.abs(((Math.atan2(dx, dy) - yaw0) / RAD + 540) % 360 - 180);
            if (a < 30) n += (1 - td / 45) * (1 + 2 * (1 - a / 30));
          }
          for (const yo of [-18, -9, 0, 9, 18]) for (const po of [0, 8]) {
            const yaw = yaw0 + yo * RAD, pit = pit0 + po * RAD;
            rc.set(new THREE.Vector3(p.x, ez, -p.y), new THREE.Vector3(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit)));
            const hit = g.Wd.buildings && rc.intersectObject(g.Wd.buildings)[0];
            if (hit) n += 3 * (1 - hit.distance / 40) * (yo ? 1 : 2);
          }
          return { p, n: n + 0.02 * Math.hypot(p.x - v.at[0], p.y - v.at[1]) };
        };
        let best = null;
        for (let r = 0; r <= v.clear; r += 3) for (let k = 0, m = r ? Math.round(r * 1.6) : 1; k < m; k++) {
          const s = score(v.at[0] + r * Math.sin(2 * Math.PI * k / m), v.at[1] + r * Math.cos(2 * Math.PI * k / m));
          if (s && (!best || s.n < best.n)) best = s;
        }
        if (best) {
          console.log(`[clear] ${v.name} ${JSON.stringify([+best.p.x.toFixed(1), +best.p.y.toFixed(1)])} z ${best.p.z.toFixed(1)} score ${best.n.toFixed(2)}`);
          if (v.eye && v.eye.length === 2) v.eye = [best.p.x, best.p.y];
          v.at = [best.p.x, best.p.y];
        } else console.log(`[clear] ${v.name}: nowhere to stand within ${v.clear} m`);
      }
      const [x, y] = v.at, f = g.nav.floorAt(x, y, v.z != null ? v.z + 0.5 : v.street ? g.nav.terrain(x, y) + 0.5 : 200); // (the roof there, the street under a canopy, or the floor nearest z)
      const place = () => {
        g.player.x = x; g.player.y = y; g.player.z = f ? f.z : 0;
        g.player.h = Math.atan2(v.look[0] - x, v.look[1] - y);
        Object.assign(g.cam, { mode: 'chase', yaw: g.player.h, pitch: v.pitch ?? 0.12, dist: v.dist ?? 5, distTo: 0, yawTo: null, lastInput: -10 });
      };
      // a frame 400 m off first: the chase camera eases after a short move and snaps after a long one
      g.player.x = x + 400; g.advance(0.05);
      place();
      g.advance(2);
      // the arrival's crane down to the player (it starts a moment after play) takes the camera: settle it
      for (let t = 0; g.arriving() && t < 6; t += 0.1) { g.settleArrival(); g.advance(0.1); }
      // a cutscene the place set off (the survey's turn on the spot) would be caught half way: skip it
      if (g.cine.active) g.cine.skip();
      place(); g.advance(0.5);
      // "closer": a photo spot's id, to look closer at it from there (places.js), "along" seconds to the right
      if (v.closer) { g.lookAt(g.G.spots.find(s => s.id === v.closer)); g.advance(1.2); if (v.along) g.advance(v.along, ['KeyD']); if (v.up) g.advance(Math.abs(v.up), [v.up > 0 ? 'KeyW' : 'KeyS']); }
      // "scramble": "walk" or "wait": on until the nearest scramble is that far into its walk (its crowd
      // out on the crosswalks) or into the cross road's green (its crowd massed at the kerbs), "phaseT" s in
      if (v.scramble) {
        const j = g.junctions.J.filter(q => q.scramble).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        const ph = v.scramble === 'walk' ? 3 : 1, at = v.phaseT ?? (ph === 3 ? 9 : 8);
        for (let i = 0; j && i < 600 && !(j.ph === ph && j.st === 'g' && j.t >= at); i++) g.advance(0.25);
      }
      // "train": {at: [x, y], in: seconds, dir} sets the railway's clock so that the next train's nose (of that direction,
      // +1 with the line's rising distance, or of either) is at the point of the line nearest `at` in that many seconds
      // (negative: it passed that long ago); "ride": {from: a station's id, dir, run: seconds, view: "chase", "cabin" or
      // "cab", look: radians to the right} boards the train standing there and rides on that long (rail.js)
      if (v.train && g.rail && g.rail.cue) { g.rail.cue(g.rail.sNear(v.train.at[0], v.train.at[1]), v.train.in ?? 0, v.train.dir || 0); g.advance(0.05); }
      if (v.ride && g.rail && g.rail.cueStation) {
        const car = g.rail.cueStation(v.ride.from, v.ride.dir || 1, 2), st = g.rail.stations.find(o => o.id === v.ride.from);
        if (car) {
          g.boardRail(car, st);
          for (let t = 0; t < (v.ride.run ?? 40); t += 0.5) g.advance(0.5);
          Object.assign(g.cam, { mode: v.ride.view || 'chase', lookYaw: v.ride.look || 0, lookPitch: v.pitch ?? -0.04, yaw: car.h + (v.yaw ?? 0.9), pitch: v.pitch ?? 0.25, dist: v.dist ?? 30, distTo: 0, yawTo: null, lastInput: -10 });
          g.advance(0.3);
        }
      }
      // "ferry": {to: a wharf's id, at: 0..1} aboard the first vessel that calls there, that far along its leg to it
      // (Queenstown's Earnslaw on the lake past the frame); "yaw" turns the chase camera off her heading (radians)
      if (v.ferry) {
        const V = g.fer.vessels.find(q => q.stops.includes(v.ferry.to));
        const ci = V && V.cycle.findIndex(c => (c.rev ? c.leg.from : c.leg.to) === v.ferry.to);
        if (V && ci >= 0) {
          const from = g.G.wharves.find(w => w.id === (V.cycle[ci].rev ? V.cycle[ci].leg.to : V.cycle[ci].leg.from));
          g.board(V, from);
          V.ci = ci; V.phase = 'sail'; V.s = V.cycle[ci].leg.len * (v.ferry.at ?? 0.5); V.speed = g.G.ferry_speed_ms || 6;
          V.s = Math.max(0, V.s - 300); // (and on for 300 m, so the smoke and the wake from where she was are gone)
          for (let i = 0; i < 45; i++) g.advance(1);
          if (g.route && g.route.set) g.route.set('off'); // (no gold line across the lake)
          Object.assign(g.cam, { yaw: V.h + (v.yaw ?? 0.9), pitch: v.pitch ?? 0.25, dist: v.dist ?? 60, distTo: 0, yawTo: null, lastInput: -10 });
          g.advance(0.5);
        }
      }
      // "lift": {id, from, to, at: 0..1, phase} rides a lift whose car is drawn (game.json lifts[].car) from stop
      // `from` to `to`, and holds it that far through the run (or in that phase: "open", "in", "open2", "out")
      if (v.lift) {
        const L = g.lifts.find(q => q.id === v.lift.id) || g.lifts[0];
        [g.player.x, g.player.y, g.player.z] = L.stops[v.lift.from ?? 0].at; g.advance(0.3);
        g.rideLift(L, v.lift.from ?? 0, v.lift.to ?? 1);
        for (let i = 0; i < 400; i++) {
          const R = g.liftRide();
          if (!R) break;
          if (v.lift.phase ? R.phase === v.lift.phase && R.t >= (v.lift.at ?? 0.5) * 1.1 : R.phase === 'ride' && R.t >= (v.lift.at ?? 0.5) * Math.abs(R.zB - R.zA) / R.v) break;
          g.advance(0.1);
        }
        if (v.yaw != null) Object.assign(g.cam, { yaw: v.yaw, yawTo: null, distTo: 0, dist: v.dist ?? g.cam.dist, pitch: v.pitch ?? g.cam.pitch });
        g.hold(true); g.advance(0.05);
      }
      // "hide": [mesh names] not drawn, to see what shows through (a gap in a landmark)
      for (const n of v.hide || []) { const o = g.Wd.world.getObjectByName(n); if (o) o.visible = false; }
      // "js": run with g = window.__game before the frame (the railway at a second of its timetable:
      // "g.trains.t = 131; g.trains.update(0, g.camera)")
      if (v.js) new Function('g', v.js)(g);
      // "eye": [x, y, z] a camera there looking at "look" (with "lookZ" its height), held still in photo mode
      if (v.eye) {
        // "apart": metres. The world runs on until nobody in the crowd is that near the eye
        // (a face filling the frame), and no car within twice that (a bonnet across it)
        if (v.apart) for (let i = 0; i < 80 && (g.crowd.P.some(o => o.line >= 0 && Math.hypot(o.x - v.eye[0], o.y - v.eye[1]) < v.apart)
          || ((g.cars && g.cars.C) || []).some(c => Number.isFinite(c.x) && Math.hypot(c.x - v.eye[0], c.y - v.eye[1]) < 2 * v.apart)); i++) g.advance(0.5);
        g.photoMode(true);
        // (a 2-element eye, [x, y], stands it eyeUp metres, 1.6 by default, over where you stand)
        const ez = v.eye.length > 2 ? v.eye[2] : g.player.z + (v.eyeUp ?? 1.6);
        const P = g.photo, lz = v.lookZ ?? (g.player.z + (v.lookUp ?? 1.2)), dx = v.eye[0] - v.look[0], dy = v.eye[1] - v.look[1], h = ez - lz, d = Math.hypot(dx, dy);
        P.focus.set(v.look[0], lz, -v.look[1]); P.anchor.copy(P.focus);
        Object.assign(P, { az: Math.atan2(dx, dy), pitch: Math.atan2(h, d), dist: Math.hypot(d, h) });
        if (v.fov) P.fov = v.fov;
        P.fstop = v.fstop ?? 16; // (photo mode's depth of field: sharp unless a still asks for it)
        g.player.rig.root.visible = false;
        g.advance(0.1);
      }
    }, v);
    await (v.closer || v.page ? grabPage : grab)(v.name); // ("page": the page with its HUD, not the canvas alone)
    // "pick": [[u, v], ...] points on the frame (0..1 from its top left): what the camera sees there, printed
    // (the mesh's name, its material's, and where it is hit), to find which surface draws a fault in the still
    if (v.pick) console.log(JSON.stringify(await p.evaluate(pts => {
      const g = window.__game, rc = new THREE.Raycaster();
      return pts.map(([u, w]) => {
        rc.setFromCamera(new THREE.Vector2(2 * u - 1, 1 - 2 * w), g.camera);
        const root = g.Wd.world.parent || g.Wd.world;
        const hit = rc.intersectObjects(root.children, true).find(h => h.object.visible && h.object.isMesh);
        if (!hit) return { at: [u, w], hit: null };
        const o = hit.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
        return { at: [u, w], mesh: o.name || o.parent && o.parent.name || o.type, material: m && (m.name || m.type), xyz: [+hit.point.x.toFixed(1), +(-hit.point.z).toFixed(1), +hit.point.y.toFixed(1)] };
      });
    }, v.pick)));
    if (v.closer) await p.evaluate(() => window.__game.interact()); // (step back)
    if (v.lift) await p.evaluate(() => { const g = window.__game; g.hold(false); for (let i = 0; i < 400 && g.liftRide(); i++) g.advance(0.1); }); // (the ride run out)
    if (v.eye) await p.evaluate(() => { window.__game.photoMode(false); window.__game.player.rig.root.visible = true; });
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
