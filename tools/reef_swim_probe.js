// Probe the swimmer's pose: hold an input in deep water and log the head's orientation relative to the body
// each step, to catch a head (or a body) that spins or jitters. Prints one line per sampled step and a summary.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/reef_swim_probe.js [site] [inputs] [gear]
//   site: a reef site id (city=) (default whitsundays); inputs: e.g. "down" or "down,f"; gear: none | snorkel | scuba
const { chromium } = require('playwright');
const [,, site = 'whitsundays', inputs = 'down', gear = 'none'] = process.argv;
(async () => {
  const args = process.env.DISPLAY ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] : ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const b = await chromium.launch(process.env.DISPLAY ? { headless: false, args } : { args });
  const p = await b.newPage({ viewport: { width: 480, height: 320 } });
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/reef/index.html?city=${site}&gl=1&mute=1&nolock=1${gear !== 'none' ? '&equip=' + gear : ''}`);
  await p.waitForFunction('window.__ready && window.__player', null, { timeout: 170000 });
  const res = await p.evaluate(async ([inputs]) => {
    const R = window.__reef, ctx = R.ctx, pl = ctx.player, S = pl.S, T3 = R.camera.constructor;
    // a deep spot near the spawn
    let spot = null;
    for (let r = 50; r < 8000 && !spot; r += 50) for (let a = 0; a < 6.28; a += 0.2) { const x = S.pos.x + Math.cos(a) * r, n = -S.pos.z + Math.sin(a) * r; const d = ctx.depth(x, n); if (d > 12 && d < 40) { spot = [x, n, d]; break; } }
    if (!spot) return { err: 'no deep water' };
    pl.teleport(spot[0], spot[1], undefined, 90);
    const V = o => Object.assign({ f: 0, r: 0, up: 0, down: 0, run: 0, inflate: 0, deflate: 0 }, o);
    const hold = V(Object.fromEntries(inputs.split(',').filter(Boolean).map(k => [k, 1])));
    const step = n => { for (let i = 0; i < n; i++) { S.virt = (step.inp); ctx.controller.update(0.05); } };
    step.inp = V({}); step(40);
    const out = [], rig = () => pl.rig || pl.S && window.__player && ctx.player.rig;
    const q = new (pl.group.quaternion.constructor)(), qb = q.clone(), qh = q.clone();
    let prev = null, maxJump = 0, total = 0;
    step.inp = hold;
    for (let i = 0; i < 200; i++) {
      step(1);
      const r = ctx.player.rig, head = r.bones && (r.bones.Head || r.bones[Object.keys(r.bones).find(k => /Head$/.test(k))]);
      r.group.updateMatrixWorld(true);
      r.group.getWorldQuaternion(qb); head.getWorldQuaternion(qh);
      q.copy(qb).invert().multiply(qh);
      if (prev) { const ang = 2 * Math.acos(Math.min(1, Math.abs(prev.dot(q)))); maxJump = Math.max(maxJump, ang); total += ang; }
      prev = q.clone();
      if (i % 10 === 0) out.push(`t=${(i * 0.05).toFixed(1)} st=${S.state} dep=${S.depthBody.toFixed(2)} vy=${S.vy.toFixed(2)} pitch=${S.bodyPitch.toFixed(2)} pivot=${r.pivot.rotation.x.toFixed(2)} yaw=${S.bodyYaw.toFixed(2)} headq=${[q.x, q.y, q.z, q.w].map(v => v.toFixed(2)).join(',')}`);
    }
    return { spot, out, maxJump, total };
  }, [inputs]);
  if (res.err) console.log(res.err); else { console.log(res.out.join('\n')); console.log(`head turn per step: max ${(res.maxJump * 57.3).toFixed(1)} deg, total ${(res.total * 57.3).toFixed(0)} deg over 10 s`); }
  await b.close();
})();
