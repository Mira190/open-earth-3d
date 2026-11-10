// Take each kind of seat a city offers (game.json "seats": a table by the glass, a foyer's chair, the stalls) and
// stand up again, for tools/game_check.js and tools/seat_probe.js. From a pace behind the seat the action must offer
// it; taken, you are seated at its place looking the way it faces, through your own eyes; E stands you up on foot
// within reach of where you were. In a seat with a show (game.json "shows") the performance must begin: its clock
// runs, the house lights go down, the singer sings, a surtitle shows during the first sung line, and standing up
// ends it. One seat of each name is taken. Returns [{ id, name, ok, why, ... }]; with outDir, a still from each seat
// (and, at a show, one at the first sung line).
const fs = require('fs');
const path = require('path');

module.exports = async function takeSeats(p, { outDir = null, prefix = '' } = {}) {
  const ids = await p.evaluate(() => { const seen = new Set(); return (window.__game.G.seats || []).filter(s => !seen.has(s.name) && seen.add(s.name)).map(s => s.id); });
  const still = async name => { if (!outDir) return; const png = await p.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r)); return document.getElementById('game-gl').toDataURL('image/png'); }); fs.writeFileSync(path.join(outDir, `${prefix}seat-${name}.png`), Buffer.from(png.split(',')[1], 'base64')); };
  await p.evaluate(() => window.__game.npcsReady && window.__game.npcsReady()); // (the singer in her place, for the still)
  const res = [];
  for (const id of ids) {
    const r = await p.evaluate(id => {
      const g = window.__game, pl = g.player, S = g.shows, st = S.seats.find(q => q.id === id);
      const from = g.nav.stand(st.at[0] - st.face[0] * 0.7, st.at[1] - st.face[1] * 0.7, st.at[2] + 0.5, { rMax: 3 }) || { x: st.at[0], y: st.at[1], z: st.at[2] };
      Object.assign(pl, { mode: 'foot', vehicle: null, x: from.x, y: from.y, z: from.z, ground: true, vz: 0, speed: 0 });
      g.advance(0.3);
      const o = { id, name: st.name, show: st.show || null, startD: Math.hypot(pl.x - st.at[0], pl.y - st.at[1]) };
      const act = g.currentAction();
      o.offered = !!act && act.text === (st.verb || 'Sit down'); o.action = act ? act.text : null;
      g.interact(); g.advance(0.4);
      o.mode = pl.mode; o.atSeat = !!S.seat && S.seat.name === st.name && Math.hypot(pl.x - S.seat.at[0], pl.y - S.seat.at[1]) < 0.05; // (that seat, or the one beside it)
      const c = g.camera, d = c.getWorldDirection(new c.position.constructor());
      o.facing = d.x * st.face[0] - d.z * st.face[1]; // (the view's direction along the seat's, in the map's frame)
      o.eye = c.position.y - st.at[2];
      if (st.show) { o.playing0 = S.playing; o.beat0 = S.beat; }
      return o;
    }, id);
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
    const out = await p.evaluate(() => { const g = window.__game, pl = g.player, S = g.shows; g.interact(); g.advance(0.5); return { modeOut: pl.mode, playingOut: S.playing, x: pl.x, y: pl.y, titleLeft: !!document.querySelector('.g-surtitle') }; });
    Object.assign(r, out);
    r.ok = r.offered && r.mode === 'seat' && r.atSeat && r.facing > 0.9 && r.eye > 0.8 && r.eye < 1.5 && r.modeOut === 'foot' && !r.playingOut && !r.titleLeft
      && (!r.show || (r.playing0 && r.beat > r.beat0 && r.title === r.first && r.dimmed !== false && r.singing !== false));
    r.why = r.ok ? '' : [!r.offered && `the seat was not offered (${r.action})`, r.mode !== 'seat' && `not seated (${r.mode})`, !r.atSeat && 'not at the seat', r.facing <= 0.9 && `looking ${r.facing.toFixed(2)} off the seat's way`,
      (r.eye <= 0.8 || r.eye >= 1.5) && `eyes ${r.eye.toFixed(2)} m over the seat`, r.modeOut !== 'foot' && `did not stand up (${r.modeOut})`, r.playingOut && 'the show played on', r.titleLeft && 'a surtitle was left up',
      r.show && !r.playing0 && 'the show did not begin', r.show && r.title !== r.first && `the surtitle read "${r.title}"`, r.show && r.dimmed === false && 'the house lights stayed up', r.show && r.singing === false && 'the singer did not sing'].filter(Boolean).join('; ');
    res.push(r);
  }
  return res;
};
