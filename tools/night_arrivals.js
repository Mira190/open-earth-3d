// How much a player can see at night where the game puts them: the start and every landmark the map
// travels to, at 22:15 (or TIME), in each live city's game (or the ones named). At each, how bright the
// ground and the people round the player are on screen (the mean luma of a box round the player's feet,
// 0..255) with the night fill over the player (game.js nightFill) and without it, and a still of both side
// by side (<out>/<city>-<n>.png). A place under MIN (default 20) with the fill is DARK; exits 1 if any is.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/night_arrivals.js out_dir [city ...]     # llvmpipe; without xvfb-run, SwiftShader
// env: TIME=22:15, MIN=20, LIMIT=99 (landmarks a city), FILL=<candela> (try another strength), TIER=high
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [,, outDir = '.', ...named] = process.argv;
const cities = named.length ? named : execFileSync(path.join(__dirname, 'live_cities.sh')).toString().trim().split('\n');
const MIN = +(process.env.MIN || 20), TIME = process.env.TIME || '22:15';
const W = 960, H = 600;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let dark = 0;
  for (const city of cities) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); localStorage.setItem('oe3d-onboard', JSON.stringify({ done: 1 })); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
    await p.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, opts) {
        return get.call(this, type, /webgl/.test(type) ? Object.assign({}, opts, { preserveDrawingBuffer: true }) : opts);
      };
    });
    const errors = [];
    p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction('window.__game', null, { timeout: 600000 });
    await p.waitForFunction(() => !document.getElementById('g-title').hidden, null, { timeout: 600000 }).catch(() => {});
    await p.evaluate(() => { const b = document.getElementById('gt-play'); if (b) b.click(); });
    await p.waitForFunction(() => { const t = document.getElementById('g-title'); return !t || t.hidden; }, null, { timeout: 120000 }).catch(() => {});
    const n = await p.evaluate(([time, fill]) => {
      const g = window.__game, [h, m] = time.split(':').map(Number);
      g.advance(1);
      g.setClock(g.clock.y, g.clock.m, g.clock.d, h * 60 + m); g.clock.frozen = true;
      if (fill) g.nightFill.userData.cd = +fill;
      for (let k = 0; k < 40 && (g.cine.active || (g.arriving && g.arriving())); k++) { if (g.settleArrival) g.settleArrival(); g.advance(0.25); }
      g.advance(1);
      // the place to measure from, and the stills: the luma of a box round the player's feet, with the fill as it is and off
      window.__night = async () => {
        const frames = k => new Promise(r => { const f = () => (--k ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
        const cv = document.getElementById('game-gl'), c2 = document.createElement('canvas');
        const grab = async () => {
          await frames(3);
          c2.width = cv.width; c2.height = cv.height;
          const x = c2.getContext('2d'); x.drawImage(cv, 0, 0);
          const pl = g.player, v = new THREE.Vector3(pl.x, pl.z + 0.3, -pl.y).project(g.camera);
          const cx = (v.x + 1) / 2 * cv.width, cy = (1 - v.y) / 2 * cv.height, bw = cv.width * 0.3, bh = cv.height * 0.22;
          const x0 = Math.max(0, Math.round(cx - bw / 2)), y0 = Math.max(0, Math.round(cy - bh * 0.6)), w = Math.min(cv.width - x0, Math.round(bw)), hh = Math.min(cv.height - y0, Math.round(bh));
          const d = x.getImageData(x0, y0, Math.max(1, w), Math.max(1, hh)).data;
          let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return { luma: s / (d.length / 4), png: cv.toDataURL('image/png') };
        };
        const cd = g.nightFill.userData.cd;
        const on = await grab();
        g.nightFill.userData.cd = 0; g.advance(0.05);
        const off = await grab();
        g.nightFill.userData.cd = cd; g.advance(0.05);
        return { on: on.luma, off: off.luma, pngOn: on.png, pngOff: off.png };
      };
      return g.landmarks.length;
    }, [TIME, process.env.FILL || '']);
    const stops = [{ i: -1, name: 'start' }].concat(Array.from({ length: Math.min(n, +(process.env.LIMIT || 99)) }, (_, i) => ({ i, name: null })));
    for (const s of stops) {
      if (s.i >= 0) s.name = await p.evaluate(i => {
        const g = window.__game, lm = g.landmarks[i];
        g.travelTo(lm);
        for (let k = 0; k < 40 && g.cine.active; k++) g.advance(0.25);
        g.advance(0.5);
        return lm.name;
      }, s.i);
      const r = await p.evaluate(() => window.__night());
      const tag = `${city}-${s.i < 0 ? 'start' : String(s.i).padStart(2, '0')}`;
      // off | on, side by side
      const fOff = path.join(outDir, `${tag}-off.png`), fOn = path.join(outDir, `${tag}-on.png`);
      fs.writeFileSync(fOff, Buffer.from(r.pngOff.split(',')[1], 'base64'));
      fs.writeFileSync(fOn, Buffer.from(r.pngOn.split(',')[1], 'base64'));
      const bad = r.on < MIN;
      if (bad) dark++;
      console.log(`${bad ? 'DARK' : 'ok  '} ${city} ${s.name}: ${r.off.toFixed(1)} without the fill, ${r.on.toFixed(1)} with it`);
    }
    if (errors.length) console.log(`${city} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
    await p.close();
  }
  await b.close();
  process.exit(dark ? 1 : 0);
})();
