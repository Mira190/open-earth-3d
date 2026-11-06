// A second ride after getting out of the first part way: hail a taxi, get in, say where to, get out
// where it stops on the way (held up in the traffic, at a light), and from there hail a taxi or order
// a ride on the phone (by turns), get in and say where to: you must be in the second ride as it drives
// off, and stay in it. Repeated at kerbs
// round the start (Math.random seeded: SEED), each trial reporting where it went wrong, if it did.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/ride_again.js shibuya [trials=4]
// Exits 1 if any second ride can't be had or leaves you standing outside it.
const { chromium } = require('playwright');
const { pinClock } = require('./pin_clock');
const [,, city = 'shibuya', trials = '4'] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 400)));
  await pinClock(p, city);
  await p.addInitScript(seed => { let x = seed >>> 0 || 1; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, +(process.env.SEED || 1));
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__game', null, { timeout: 300000 });
  const play = await p.$('#gt-play');
  if (play) await play.click().catch(() => {});
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
  const out = await p.evaluate(n => {
    const g = window.__game, keep = g.KEEP === 'left' ? 1 : -1, res = [];
    const toasts = () => document.getElementById('g-toasts').textContent.slice(-160).replace(/\s+/g, ' ');
    g.advance(2);
    const x0 = g.player.x, y0 = g.player.y;
    // a ride from where you stand: a hand up at the kerb (then "where to?" in the taxi), or ordered on
    // the phone with where to (its "where to?" list, the first place); wait for it, get in
    let last = null;
    const rideIn = (r, tag, phone) => {
      if (phone) {
        g.phoneShow('where');
        const btn = document.querySelector('#gph-body button[data-k]');
        if (!btn) { r[tag] = 'the phone offers nowhere to go'; g.phoneShow(false); return null; }
        btn.click();
        r[tag + 'Phone'] = document.getElementById('gph-body').textContent.replace(/\s+/g, ' ').slice(0, 80);
        g.phoneShow(false);
      } else g.hail();
      const o = g.ride();
      // (a new one on its way, or the one you just got out of, still beside you, waiting for you to get back in)
      if (!o || (o.phase !== 'coming' && !(o === last && o.phase === 'waiting'))) { r[tag] = `no ${phone ? 'ride' : 'taxi'} (${toasts()})`; return null; }
      if (o === last) r[tag + 'Back'] = true;
      for (let t = 0; t < 120 && o.phase === 'coming'; t += 0.5) g.advance(0.5);
      if (o.phase !== 'waiting') { r[tag] = `never pulled in (${o.phase})`; return null; }
      g.boardRide();
      for (let i = 0; i < 30 && g.player.mode !== 'ride'; i++) g.advance(0.5);
      if (g.player.mode !== 'ride') { r[tag] = `couldn't get in (${g.player.mode}, ride ${o.phase})`; return null; }
      if (!phone) {
        for (let i = 0; i < 80 && g.dlg.open && !g.dlg.hasChoices; i++) g.dlg.tick(0.1);
        if (!g.dlg.open) { r[tag] = `no "where to?" (ride ${o.phase})`; return null; }
        g.dlg.choose(0);
      }
      g.advance(0.5);
      if (g.player.mode !== 'ride' || g.ride() !== o || o.phase !== 'driving') { r[tag] = `out after saying where to: you ${g.player.mode}, ride ${g.ride() === o ? o.phase : g.ride() ? 'another' : 'none'} (${toasts()})`; return null; }
      return o;
    };
    // out of whatever you are in, the car stopped first
    const clear = () => {
      const o = g.ride();
      if (g.player.mode === 'ride' && o) { if (o.phase === 'driving') { g.skipRide(); g.advance(6); } for (let i = 0; i < 40 && o.drv.st.v > 0.4; i++) g.advance(0.5); g.leaveRide(); }
      if (g.ride() && g.ride().phase !== 'leaving') g.cancelRide();
    };
    for (let k = 0, done = 0; done < n && k < 6 * n; k++) {
      // a kerb within 300 m of the start
      const a = Math.random() * 2 * Math.PI, d = 40 + Math.random() * 260;
      const pl = g.roads.place(x0 + Math.sin(a) * d, y0 + Math.cos(a) * d, 120, keep);
      if (!pl) continue;
      clear();
      Object.assign(g.player, { x: pl.x, y: pl.y }); if (pl.z != null) g.player.z = pl.z;
      g.advance(8); // (the last trial's taxi gone)
      const r = { at: `${pl.x.toFixed(0)},${pl.y.toFixed(0)}` };
      last = null;
      const o = rideIn(r, 'first', false);
      if (!o) { res.push(r); continue; }
      last = o;
      // on the way, out where it next stands still (held up: a light, a queue)
      const s0 = o.drv.st.s;
      let t = 0;
      for (; t < 90 && !(o.drv.st.s - s0 > 25 && o.drv.st.v < 0.3) && o.phase === 'driving'; t += 0.5) g.advance(0.5);
      if (o.phase !== 'driving' || o.drv.st.v >= 0.5) { r.first = `never held up on the way (${o.phase}, ${t} s)`; res.push(r); continue; }
      r.heldBy = o.drv.st.why || '';
      g.leaveRide();
      g.advance(0.5);
      if (g.player.mode !== 'foot') { r.first = `couldn't get out (${toasts()})`; res.push(r); continue; }
      r.outAt = `${g.player.x.toFixed(0)},${g.player.y.toFixed(0)}`;
      r.onRoad = !!g.roadNet.nearest(g.player.x, g.player.y, 1.5, g.player.z, 2.5);
      g.advance(1);
      done++;
      // and a ride again, from there: a taxi hailed, or a ride ordered on the phone, while the last one
      // still stands in the traffic beside you (it is the one you get back into), or once it has gone
      const phone = done % 2 === 0, later = done % 3 === 0;
      r.how = `${phone ? 'phone' : 'hail'}${later ? ', the last one gone' : ''}`;
      if (later) { for (let i = 0; i < 120 && g.ride() === o; i++) g.advance(0.5); if (g.ride() === o) { r.second = `the last ride never left (${o.phase}, ${o.drv.st.why || ''})`; res.push(r); continue; } }
      const o2 = rideIn(r, 'second', phone);
      if (!o2) { res.push(r); continue; }
      let worst = null;
      for (let i = 0; i < 30; i++) {
        g.advance(0.5);
        if (!worst && (g.player.mode !== 'ride' || g.player.vehicle !== o2 || g.ride() !== o2)) worst = `out of it after ${(i + 1) / 2} s: you ${g.player.mode}, ride ${g.ride() === o2 ? o2.phase : g.ride() ? 'another' : 'none'} (${toasts()})`;
      }
      // the rig in the car's seat, not left standing in the street
      const seated = g.player.rig.root.parent && g.player.rig.root.parent !== g.scene && !!o2.C.body.getObjectById(g.player.rig.root.id);
      if (!worst && !seated) worst = 'you are in the ride, but your figure is not in its seat';
      // and it drives you off (one got back into in the traffic is in the jam you got out of: a minute for
      // it to clear or find a way round; reported, not failed: that is the traffic's, not the ride's)
      // (the way driven, half a second at a time: one that turns round or finds another way starts the new way's s from 0)
      let went = 0, px = o2.drv.st.x, py = o2.drv.st.y;
      for (let i = 0; i < 120 && went < 30 && !worst && o2.phase === 'driving'; i++) { g.advance(0.5); const t = o2.drv.st; went += Math.hypot(t.x - px, t.y - py); px = t.x; py = t.y; }
      if (!worst && o2.phase === 'driving' && went < 30) r.stuck = `hasn't moved on in a minute: ${went.toFixed(0)} m (${o2.drv.st.why || ''}${o2.drv.st.lineAt && o2.drv.st.lineAt.j.sig ? `, light ${o2.drv.st.lineAt.j.ph}${o2.drv.st.lineAt.j.st}` : ''}, found another way ${o2.rerouted || 0} times, turned round ${o2.turned || 0} times${o2.turn ? ', turning now' : ''}${o2.qT ? `, queued ${o2.qT.toFixed(0)} s` : ''}${o2.turnNo ? `, not turned: ${o2.turnNo}` : ''}${o2.drv.st.block ? `, behind ${o2.drv.st.block.line != null ? `car ${g.cars.C.indexOf(o2.drv.st.block)} ${o2.drv.st.block.why} v ${(o2.drv.st.block.v || 0).toFixed(1)}` : 'something'}` : ''})`;
      r.turned = o2.turned || 0;
      r.second = worst || `in, ${went.toFixed(0)} m on to ${o2.dest && o2.dest.name}${o2.rerouted ? `, round a jam ${o2.rerouted} times` : ''}${o2.turned ? `, turned round ${o2.turned} times` : ''}`;
      r.ok = !worst;
      res.push(r);
    }
    return res;
  }, +trials);
  let bad = 0;
  for (const r of out) {
    if (r.how && !r.ok) bad++;
    console.log(JSON.stringify(r));
  }
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  const tried = out.filter(r => r.how).length;
  const stuck = out.filter(r => r.stuck).length;
  console.log(`${city}: ${tried} second rides, ${bad} leaving you outside${stuck ? `, ${stuck} still in a jam a minute on` : ''}${errors.length ? `, ${errors.length} page errors` : ''}`);
  await b.close();
  process.exit(bad || errors.length || !tried ? 1 : 0);
})();
