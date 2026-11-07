// How much the crowd jitters when it stands or presses together: run a city's game headless with
// you on foot, step it at 60 frames a second, and for the walkers near you count what a person sees
// as a shiver: the clip flipping between standing and walking and back within half a second (the speed handed to the renderer
// crossing the rig's 0.15 m/s threshold, or the moving flag flipping), the body turning back and
// forth while it stands or shuffles, and feet that go to and fro without getting anywhere.
//   python3 -m http.server 8800 --directory web &
//   GAME_TIME=17:30 xvfb-run -a node tools/crowd_jitter.js shibuya [seconds, 40] [radius m, 30]
// FAIL=1 exits 1 when the rates go over the limits below (tools/game_check.js can run it so).
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', secs = '40', rad = '30'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await pinClock(p, city);
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; const g = window.__game; if (g.cine && g.cine.active) g.cine.skip(); g.advance(1); });
  const out = await p.evaluate(([secs, rad]) => {
    const g = window.__game, P = g.crowd.P, me = g.player, dt = 1 / 60;
    // what the renderer is handed (people.js place: moving ? v : 0) and what the rig plays for it
    // (before the eased pace, p.av, the footways handed over p.v whenever it was over 0.05)
    const clip = q => q.mode === 'sit' ? 's' : (q.moving ?? q.v > 0.05) && (q.av != null ? Math.max(0.2, q.av) : q.v) >= 0.15 ? 'w' : 'i';
    const S = new Map(); // per walker: last clip, last heading, its turning sign, a window of positions
    let samples = 0, flips = 0, turnBacks = 0, slowSamples = 0, turnSum = 0, shuffle = 0, shuffleWin = 0;
    const plaza = { samples: 0, flips: 0 }, foot = { samples: 0, flips: 0 };
    const worst = new Map();
    for (let f = 0; f < secs * 60; f++) {
      g.advance(dt);
      for (let i = 0; i < g.crowd.active; i++) {
        const q = P[i];
        if (q.line < 0 || q.mode === 'sit' || Math.hypot(q.x - me.x, q.y - me.y) > rad) { S.delete(i); continue; }
        const c = clip(q), s = S.get(i);
        samples++; const k = q.pz ? plaza : foot; k.samples++;
        if (s) {
          // (a flip back within half a second of the last: a flicker, not a walker stopping or setting off)
          if (c !== s.c) { if (f - s.lf < 30) { flips++; k.flips++; worst.set(i, (worst.get(i) || 0) + 1); } s.lf = f; }
          let dh = q.h - s.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          if (q.v < 0.4) { slowSamples++; turnSum += Math.abs(dh); if (Math.abs(dh) > 0.004 && s.sg && Math.sign(dh) !== s.sg) turnBacks++; }
          if (Math.abs(dh) > 0.004) s.sg = Math.sign(dh);
          s.win.push(q.x, q.y);
          if (s.win.length >= 120) { // a second: the path walked against the ground gained
            let path = 0; for (let j = 2; j < s.win.length; j += 2) path += Math.hypot(s.win[j] - s.win[j - 2], s.win[j + 1] - s.win[j - 1]);
            const net = Math.hypot(s.win[s.win.length - 2] - s.win[0], s.win[s.win.length - 1] - s.win[1]);
            shuffleWin++; if (path > 0.25 && net < path * 0.35) shuffle++;
            s.win = [];
          }
          s.c = c; s.h = q.h;
        } else S.set(i, { c, h: q.h, sg: 0, win: [q.x, q.y], lf: -99 });
      }
    }
    const top = [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([i, n]) => { const q = P[i]; return `#${i} ${n} flips ${q.pz ? 'plaza ' + q.ph : q.state} v ${(q.v || 0).toFixed(2)}`; });
    const ws = samples * dt;
    return { walkers: samples / (secs * 60), flipsPerMin: flips / ws * 60, plazaFlips: plaza.flips / Math.max(1e-9, plaza.samples * dt) * 60, footFlips: foot.flips / Math.max(1e-9, foot.samples * dt) * 60,
      turnBacksPerMin: turnBacks / Math.max(1e-9, slowSamples * dt) * 60, turnRate: turnSum / Math.max(1e-9, slowSamples * dt), shuffle: shuffle / Math.max(1, shuffleWin), top };
  }, [+secs, +rad]);
  console.log(`${city}: ${out.walkers.toFixed(1)} walkers within ${rad} m on average`);
  console.log(`  stand/walk flickers (back within 0.5 s): ${out.flipsPerMin.toFixed(2)} a walker-minute (scramble crowd ${out.plazaFlips.toFixed(2)}, footways ${out.footFlips.toFixed(2)})`);
  console.log(`  slow or standing: ${out.turnBacksPerMin.toFixed(1)} turn reversals a minute, turning ${out.turnRate.toFixed(3)} rad/s on average`);
  console.log(`  seconds spent shuffling to and fro: ${(out.shuffle * 100).toFixed(1)}%`);
  for (const l of out.top) console.log('  ' + l);
  const bad = out.flipsPerMin > 1 || out.turnBacksPerMin > 9 || out.shuffle > 0.05;
  if (process.env.FAIL && bad) { console.log('  FAIL: the crowd jitters'); process.exitCode = 1; }
  await b.close();
})();
