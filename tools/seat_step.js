// Take each kind of seat a city offers (game.json "seats": a table by the glass, a foyer's chair, the stalls) and
// stand up again, for tools/game_check.js and tools/seat_probe.js. With touch (a phone), the action button is tapped
// instead of E, a finger drawn across the screen must turn the head, and the joystick, Jump and Run must be put away. From a pace behind the seat the action must offer
// it; taken, you are seated at its place looking the way it faces, through your own eyes; E stands you up on foot
// within reach of where you were. In a seat with a show (game.json "shows") the performance must begin: its clock
// runs, the house lights go down, the singer sings, a surtitle shows during the first sung line, and standing up
// ends it. One seat of each name is taken. Returns [{ id, name, ok, why, ... }]; with outDir, a still from each seat
// (and, at a show, one at the first sung line).
const fs = require('fs');
const path = require('path');

module.exports = async function takeSeats(p, { outDir = null, prefix = '', touch = false } = {}) {
  const ids = await p.evaluate(() => { const seen = new Set(); return (window.__game.G.seats || []).filter(s => !seen.has(s.name) && seen.add(s.name)).map(s => s.id); });
  const still = async name => { if (!outDir) return; const png = await p.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r)); return document.getElementById('game-gl').toDataURL('image/png'); }); fs.writeFileSync(path.join(outDir, `${prefix}seat-${name}.png`), Buffer.from(png.split(',')[1], 'base64')); };
  await p.evaluate(() => window.__game.npcsReady && window.__game.npcsReady()); // (the singer in her place, for the still)
  // settle whatever an earlier step left up (#388): under load the HUD tour or the arrival can still be showing,
  // and while one is, no action is offered. Skip the tour and any coach, finish the arrival and a camera shot,
  // run a conversation to its end and close the panels, so that a seat is judged on its own.
  const settled = await p.evaluate(async () => {
    const g = window.__game, O = window.OEOnboard, left = [];
    for (let i = 0; i < 40; i++) {
      const busy = [];
      if (O && O.active()) { busy.push('tour'); const t = O.current(); if (t) t.skip(); }
      if (O && O.coaching && O.coaching()) { busy.push('coach'); try { O.coaching().skip(); } catch (e) { /* gone */ } }
      if (g.arriving && g.arriving()) { busy.push('arrival'); g.settleArrival(); }
      if (g.overture && g.overture() && g.overture().active) { busy.push('overture'); g.overture().skip(); }
      if (g.cine && g.cine.active) { busy.push('shot'); g.cine.skip(); }
      if (g.dlg && g.dlg.open) { busy.push('talk'); if (g.dlg.hasChoices) g.dlg.choose(0); else g.dlg.next(); }
      if (g.life && g.life.open) { busy.push('life'); g.life.close(); }
      if (window.OEMetro && OEMetro.isOpen && OEMetro.isOpen() && OEMetro.close) { busy.push('metro'); OEMetro.close(); }
      if (g.player.auto) { busy.push('auto'); g.player.auto = null; }
      for (const sel of ['#g-menu', '#g-bigmap', '#g-pass', '#g-title']) { const el = document.querySelector(sel); if (el && !el.hidden) { busy.push(sel); el.hidden = true; } }
      if (!busy.length) break;
      left.splice(0, left.length, ...busy);
      g.advance(0.1); await new Promise(r => requestAnimationFrame(r));
    }
    return left;
  });
  if (settled.length && process.env.DEBUG_SEATS) console.log(`seat step: settled ${settled.join(', ')}`);
  const res = [];
  for (const id of ids) {
    const r = await p.evaluate(id => {
      const g = window.__game, pl = g.player, S = g.shows, st = S.seats.find(q => q.id === id);
      S.gameClock = true; // (with sound running, the show would keep the audio's clock, which runs on while a slow frame is drawn)
      const from = g.nav.stand(st.at[0] - st.face[0] * 0.7, st.at[1] - st.face[1] * 0.7, st.at[2] + 0.5, { rMax: 3 }) || { x: st.at[0], y: st.at[1], z: st.at[2] };
      Object.assign(pl, { mode: 'foot', vehicle: null, x: from.x, y: from.y, z: from.z, ground: true, vz: 0, speed: 0 });
      g.advance(0.3);
      const o = { id, name: st.name, show: st.show || null, startD: Math.hypot(pl.x - st.at[0], pl.y - st.at[1]) };
      const act = g.currentAction();
      o.offered = !!act && act.text === (st.verb || 'Sit down'); o.action = act ? act.text : null;
      if (!act) { // what held it back (game.js currentAction)
        const why = [g.dlg.open && 'a conversation', window.OEOnboard.active() && 'the tour', g.cine.active && 'a camera shot', g.life && g.life.open && 'daily life\'s panel', pl.auto && 'a walk to somewhere',
          ...['#g-menu', '#g-bigmap', '#g-pass', '#g-title'].filter(q => { const e = document.querySelector(q); return e && !e.hidden; })].filter(Boolean);
        o.action = `none: ${why.join(', ') || 'nothing in the way'} (mode ${pl.mode}, ${o.startD.toFixed(2)} m off)`;
      }
      return o;
    }, id);
    // take it: E, or on a phone a tap on the action button
    if (touch) { await p.tap('#gt-act').catch(() => {}); } else await p.evaluate(() => window.__game.interact());
    Object.assign(r, await p.evaluate(id => {
      const g = window.__game, pl = g.player, S = g.shows, st = S.seats.find(q => q.id === id), o = {};
      g.advance(0.4);
      o.mode = pl.mode; o.atSeat = !!S.seat && S.seat.name === st.name && Math.hypot(pl.x - S.seat.at[0], pl.y - S.seat.at[1]) < 0.05; // (that seat, or the one beside it)
      const c = g.camera, d = c.getWorldDirection(new c.position.constructor());
      o.facing = d.x * st.face[0] - d.z * st.face[1]; // (the view's direction along the seat's, in the map's frame)
      o.eye = c.position.y - st.at[2];
      if (st.show) { o.playing0 = S.playing; o.beat0 = S.beat; }
      o.touchUi = touch ? ['#gt-joy', '#gt-jump', '#gt-run'].filter(q => { const e = document.querySelector(q); return e && !e.hidden && e.offsetParent; }) : [];
      return o;
    }, id));
    if (touch && r.mode === 'seat') { // a finger drawn across the screen turns your head
      const y0 = await p.evaluate(() => window.__game.cam.lookYaw);
      const cdp = await p.context().newCDPSession(p), touchAt = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 420 }] });
      await touchAt('touchStart', 120); for (let x = 135; x <= 270; x += 15) await touchAt('touchMove', x); await touchAt('touchEnd', 270);
      await cdp.detach().catch(() => {});
      const turned = await p.evaluate(y0 => { window.__game.advance(0.1); return window.__game.cam.lookYaw - y0; }, y0);
      r.turned = turned;
    }
    await still(id);
    if (r.show && r.playing0) {
      // on to the first sung line: the clock is the game's here (no sound in a harness), so advance it
      const s2 = await p.evaluate(() => {
        const g = window.__game, S = g.shows, sh = S.show, first = sh.lines[0];
        const dim = (sh.dim || []).map(n => g.world.getObjectByName(n)).filter(Boolean);
        for (let i = 0; i < 4000 && S.beat < first[0] + 1.2; i++) g.advance(0.1);
        const el = document.querySelector('.g-surtitle'), singer = g.npcs.find(n => n.id === sh.singer);
        return { beat: S.beat, title: el && el.style.opacity !== '0' ? el.children[1].textContent : '', dimmed: dim.length ? dim.every(m => !m.visible) : null, singing: singer ? !!singer.talking : null, first: first[3] };
      });
      Object.assign(r, s2);
      await still(`${id}-show`);
    }
    if (touch) await p.tap('#gt-act').catch(() => {}); else await p.evaluate(() => window.__game.interact());
    const out = await p.evaluate(() => { const g = window.__game, pl = g.player, S = g.shows; g.advance(0.5); return { modeOut: pl.mode, playingOut: S.playing, x: pl.x, y: pl.y, titleLeft: !!document.querySelector('.g-surtitle') }; });
    Object.assign(r, out);
    r.ok = r.offered && r.mode === 'seat' && (!touch || (Math.abs(r.turned || 0) > 0.05 && !r.touchUi.length)) && r.atSeat && r.facing > 0.9 && r.eye > 0.8 && r.eye < 1.5 && r.modeOut === 'foot' && !r.playingOut && !r.titleLeft
      && (!r.show || (r.playing0 && r.beat > r.beat0 && r.title === r.first && r.dimmed !== false && r.singing !== false));
    r.why = r.ok ? '' : [!r.offered && `the seat was not offered (${r.action})`, touch && !(Math.abs(r.turned || 0) > 0.05) && 'a finger did not turn the head', touch && r.touchUi && r.touchUi.length && `${r.touchUi.join(', ')} still up in the seat`, r.mode !== 'seat' && `not seated (${r.mode})`, !r.atSeat && 'not at the seat', r.facing <= 0.9 && `looking ${r.facing.toFixed(2)} off the seat's way`,
      (r.eye <= 0.8 || r.eye >= 1.5) && `eyes ${r.eye.toFixed(2)} m over the seat`, r.modeOut !== 'foot' && `did not stand up (${r.modeOut})`, r.playingOut && 'the show played on', r.titleLeft && 'a surtitle was left up',
      r.show && !r.playing0 && 'the show did not begin', r.show && r.title !== r.first && `the surtitle read "${r.title}"`, r.show && r.dimmed === false && 'the house lights stayed up', r.show && r.singing === false && 'the singer did not sing'].filter(Boolean).join('; ');
    res.push(r);
  }
  return res;
};
