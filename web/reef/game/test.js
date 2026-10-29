// ?gametest=1: a scripted run through the game, stepping the player and the game without rendering (like
// player.js's autotest). Logs "[gametest] PASS|FAIL name detail" and sets window.__gametest = { pass, fail, log }.
// ?gameshot=dialogue|journal|map|lookout|red|board: set a scene up before the first frame, for screenshots.
// Both use their own save key (oe3d-reef-game-<site>-test), so they never touch real progress.
const HALF = { tinnie: 1.3, yacht: 1.9, cat: 3.45, daycat: 4.2, seaplane: 1.7, helicopter: 1.4 };

function rig(api, ctx) {
  const { G } = api, player = ctx.player, S = player.S, playerCtl = ctx.controller, dt = 0.05;
  const V = (o = {}) => Object.assign({ f: 0, r: 0, up: 0, down: 0, run: 0, inflate: 0, deflate: 0 }, o);
  let t = 0;
  // step everything the frame loop would, minus rendering
  const run = (secs, inp, until) => {
    const n = Math.max(1, Math.round(secs / dt));
    for (let i = 0; i < n; i++) {
      if (ctx.controller === playerCtl) S.virt = inp || V();
      if (ctx.controller) ctx.controller.update(dt, t);
      for (const u of ctx.updaters) u(dt, t);
      api.update(dt); t += dt;
      if (until && until()) break;
    }
    if (S.virt && S.virt !== null && ctx.controller === playerCtl && !G.dialogue() && !api.ui.panelKind) S.virt = null;
  };
  const key = code => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const near = (id, r = 1.8) => { const n = G.npc(id), p = n.npc.group.position, h = G.here(), a = Math.atan2(h.x - p.x, h.north + p.z) || 0;
    const x = p.x + Math.sin(a) * r, north = -p.z + Math.cos(a) * r; player.teleport(x, north, undefined, G.bearing({ x, north }, { x: p.x, north: -p.z })); };
  const beside = (v, extra = 1.5) => { const half = HALF[v.kind] ?? v.desc.B / 2, sx = Math.cos(v.hdg), sn = -Math.sin(v.hdg), x = v.x + sx * (half + extra), north = -v.z + sn * (half + extra);
    player.teleport(x, north, undefined, G.bearing({ x, north }, { x: v.x, north: -v.z })); };
  const pagesToChoices = () => { for (let i = 0; i < 12 && G.dialogue() && G.dialogue().page < G.dialogue().pages.length - 1; i++) key('Enter'); };
  // read to the end of whatever is open, then close (a node that leads on to a menu stops there)
  // the live interactables around the player, nearest first (for failure messages)
  const around = () => player.interactables.filter(i => !i.enabled || i.enabled(player)).map(i => { const p = i.x !== undefined ? { x: i.x, z: -i.north } : i.object ? i.object.position : S.pos;
    return [Math.hypot(p.x - S.pos.x, p.z - S.pos.z), i.label]; }).filter(a => a[0] < 15).sort((a, b) => a[0] - b[0]).map(a => `${a[1]} @${a[0].toFixed(1)}`).join('; ');
  const drain = () => { for (let i = 0; i < 30 && G.dialogue(); i++) { const d = G.dialogue(); if (d.page === d.pages.length - 1 && d.choices.length) break; key('Enter'); } G.closeDialogue(); };
  return { G, player, S, playerCtl, V, run, key, near, beside, pagesToChoices, drain, around };
}

export async function gametest(api, ctx) {
  const log = [], R = { pass: 0, fail: 0, log };
  const out = (ok, name, extra = '') => { ok ? R.pass++ : R.fail++; const l = `[gametest] ${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`; log.push(l); console.log(l); };
  const must = (c, name, extra) => out(!!c, name, extra === undefined ? '' : String(extra));
  if (!ctx.player) { out(false, 'needs the player module'); window.__gametest = R; return; }
  const T = rig(api, ctx), { G, player, S, playerCtl, V, run, key, near, beside, pagesToChoices, around } = T;
  const dom = s => api.ui.el.querySelector(s);
  try {
    // 1. people at their places
    const ids = G.content.npcs.map(n => n.id);
    await Promise.all(ids.map(id => G.npc(id) && G.npc(id).npc.ready));
    must(ids.every(id => G.npc(id) && G.npc(id).npc.rig), 'NPCs spawned and loaded', ids.join(','));
    const sp = G.spawn(), at = id => { const p = G.npc(id).npc.group.position; return { x: p.x, north: -p.z, up: p.y }; };
    const first = ids[0];
    must(G.dist(at(first), sp) < 60, `${first} by the spawn`, G.km(G.dist(at(first), sp)));
    if (G.npc('skipper') && G.poi('whitehaven-south')) must(G.dist(at('skipper'), G.poi('whitehaven-south')) < 400, 'skipper near South Whitehaven', G.km(G.dist(at('skipper'), G.poi('whitehaven-south'))));
    if (G.npc('guide') && G.poi('hill-inlet-lookout')) must(G.dist(at('guide'), G.poi('hill-inlet-lookout')) < 50 && at('guide').up > 5, 'guide at Hill Inlet Lookout', `${G.km(G.dist(at('guide'), G.poi('hill-inlet-lookout')))} up ${at('guide').up.toFixed(0)} m`);
    if (G.npc('instructor') && ctx.boats) must(G.npc('instructor').vessel && Math.abs(at('instructor').up - G.npc('instructor').vessel.y) < 3, 'instructor stands on a vessel', G.npc('instructor').vessel && G.npc('instructor').vessel.name);
    for (const id of ids) { const p = at(id), r = G.npc(id); if (!Number.isFinite(p.x + p.north + p.up)) out(false, 'NPC position finite', id);
      // standing on land, on a deck, or riding a vessel: never on the sea floor
      if (!r.vessel && !r.swim) must(p.up > ctx.env.u.tide.value - 0.3, `${id} stands above the water`, `up ${p.up.toFixed(2)} tide ${ctx.env.u.tide.value.toFixed(2)}`); }
    // every line of every person and sign: its sources resolve (a typo in a source id would show nothing)
    const lint = [];
    const pagesOf = node => { let p; try { p = typeof node.say === 'function' ? node.say(G) : node.say; } catch (e) { lint.push(`say threw: ${e.message}`); return []; }
      return (Array.isArray(p) ? p : [p]).map(x => typeof x === 'function' ? x(G) : x).filter(Boolean).map(x => typeof x === 'string' ? { t: x, src: node.src } : { t: x.t, src: x.src || node.src }); };
    const defs = [...G.content.npcs, ...(G.content.signs || [])];
    let nPages = 0;
    for (const d of defs) for (const [k, node] of Object.entries(d.nodes || {})) for (const p of pagesOf(node)) {
      nPages++;
      if (!p.t || /undefined|NaN/.test(p.t)) lint.push(`${d.id}.${k}: "${String(p.t).slice(0, 60)}"`);
      for (const s of p.src || []) if (!G.srcOf(s)) lint.push(`${d.id}.${k}: unknown source ${s}`);
    }
    must(!lint.length, 'every line renders and every cited source resolves', lint.length ? lint.slice(0, 5).join(' | ') : `${nPages} pages`);

    // 2. talking: E next to the ranger opens her dialogue; Enter pages on; 1 answers
    near(first, 1.6); run(0.3);
    const it = player.interactables.filter(i => (!i.enabled || i.enabled(player)) && i.npcId === first);
    must(it.length === 1, `talk interactable is live next to ${first}`, it[0] && it[0].label);
    must(player.interact() && G.dialogue() && G.dialogue().who.id === first, `E opens ${first}'s dialogue`, (G.dialogue() && G.dialogue().pages[0].t) || around());
    must(dom('.rg-dlg.on .who b').textContent.length > 0 && dom('.rg-dlg .txt').textContent.length > 10, 'dialogue panel shows name and line', dom('.rg-dlg .who b').textContent);
    pagesToChoices();
    must(G.dialogue().choices.length >= 2 && dom('.rg-dlg .ch button'), 'answers shown on the last page', G.dialogue().choices.length);
    const srcs = [...dom('.rg-dlg .src').querySelectorAll('span')].map(s => s.textContent);
    must(G.dialogue().pages.every(p => p.src === null || p.src === undefined || p.src.length), 'every page has sources or none', srcs.join(' | '));
    key('Digit1');                                          // Whitsundays: "Tell me about this sand."; generic: "Is it safe to swim?"
    if (G.quest('sand')) {
      must(G.isActive('sand') && G.dialogue() && G.dialogue().id === 'sand', 'answer 1 starts the sand quest', JSON.stringify(G.state('sand')));
      key('Enter');
      must(!G.dialogue(), 'Enter on the last line closes the dialogue');
    } else {
      must(G.dialogue() && G.dialogue().id !== 'hello', 'answer 1 opens its topic', G.dialogue() && G.dialogue().pages[0].t);
      key('Escape');
      must(!G.dialogue(), 'Esc closes the dialogue');
    }
    must(!G.player.interact() || !G.dialogue(), 'the closing key does not reopen the talk (cooldown)');
    run(0.5);

    // 3. a quest step: walk 200 m of beach (along it, south-east), then report to Kim
    const sid = G.content.npcs.some(n => n.id === 'skipper');
    if (sid) {
      player.teleport(sp.x, sp.north, undefined, 150); player.S.camYaw = 150 * Math.PI / 180;
      const w = () => (G.data('sand') || {}).walked || 0;
      run(90, V({ f: 1, run: 1 }), () => G.stepIndex('sand') >= 1);
      must(G.stepIndex('sand') === 1, 'walking 200 m on the sand completes the step', `${Math.round(w())} m, state ${player.state}`);
      near('ranger', 1.6); run(0.3); player.interact();
      must(G.dialogue() && G.dialogue().id === 'sandFacts' && G.isDone('sand'), 'reporting back opens the sand facts and completes the quest', G.dialogue() && G.dialogue().pages.map(p => p.t.slice(0, 40)).join(' / '));
      must(G.dialogue().pages.some(p => /98%/.test(p.t)) && G.dialogue().pages.some(p => (p.src || []).includes('wiki-whitehaven')), 'silica line cites its source');
      key('Escape'); run(0.5);

      // 4. Hill Inlet: reach the lookout, Mia's computed lines, look over the inlet
      G.start('inlet');
      near('guide', 2); run(0.6);
      must(G.stepIndex('inlet') >= 1, 'reaching the lookout completes the first step', G.stepIndex('inlet'));
      run(0.3); player.interact();
      const pg = G.dialogue() ? G.dialogue().pages.map(p => p.t) : [];
      must(G.dialogue() && G.dialogue().id === 'inlet' && pg.some(p => /\d+% of it is under water/.test(p)), 'Mia computes the inlet\'s wet share', pg[1] || around());
      must(pg.some(p => /m above mean sea level/.test(p)), 'lookout elevation from the model', pg[0]);
      if (G.tide()) must(pg.some(p => /water is [+-]?\d/.test(p)), 'next tide turn from the tide model', pg[2]);
      key('Escape');
      const hi = G.poi('hill-inlet'); S.camYaw = G.bearing(G.here(), hi) * Math.PI / 180;
      run(3);
      must(G.isDone('inlet'), 'looking over the inlet completes the quest', JSON.stringify(G.state('inlet')));

      // 4b. Jo's boat run to Hill Inlet Lookout puts you on a beach you can walk up from
      near('skipper', 1.8); run(0.4); player.interact(); G.show('runs');
      must(G.dialogue() && G.dialogue().choices.length >= 3, 'Jo offers boat runs', G.dialogue() && G.dialogue().choices.map(c => typeof c.text === 'function' ? c.text(G) : c.text).join(' | '));
      key('Digit1'); await new Promise(r => setTimeout(r, 0)); run(0.3);
      const lk = G.poi('hill-inlet-lookout'), d0 = G.dist(G.here(), lk);
      for (let i = 0; i < 360 && G.dist(G.here(), lk) > 40; i++) { S.camYaw = G.bearing(G.here(), lk) * Math.PI / 180; run(0.5, V({ f: 1 })); }
      must(d0 < 900 && G.dist(G.here(), lk) <= 40, 'from the drop you can walk up to the lookout', `drop ${G.km(d0)} away, now ${G.km(G.dist(G.here(), lk))}, ${player.state}`);

      // 4c. a sign at a Ngaro-named lookout: the mapped name, the model's height, what is in sight
      const bari = G.sign('bari-dhili-lookout');
      if (bari) {
        G.start('lookouts'); player.teleport(bari.x + 1.5, bari.north, undefined, 270); run(0.4);
        must(player.interact() && G.dialogue() && G.dialogue().who.id === 'sign:bari-dhili-lookout', 'E reads the lookout sign', around());
        const t = G.dialogue().pages.map(p => p.t).join(' ');
        must(/Ngaro, as signed and mapped/.test(t) && /\d+ m above mean sea level/.test(t), 'the sign gives the mapped name and the model height', t.slice(0, 160));
        must(/In sight from here/.test(t), 'the sign lists places in sight over the terrain', t.slice(t.indexOf('In sight'), t.indexOf('In sight') + 140));
        key('Escape');
        must(G.st().signs['bari-dhili-lookout'] && G.isActive('lookouts'), 'reading it counts toward the lookouts quest', JSON.stringify(G.state('lookouts')));
        run(0.5);
      }
    }

    // 5. boarding a boat and stepping off beside it
    if (ctx.boats) {
      const y = ctx.boats.vessels.find(v => v.kind === 'yacht' && v.mode === 'anchored');
      if (y) {
        beside(y); run(0.4);
        must(api.board.v === y && /^E: board /.test(api.board.label), 'boarding prompt next to an anchored yacht', `${api.board.label} (${player.state})`);
        const nb = around();
        must(player.interact() && ctx.controller !== playerCtl && api.aboard === y, 'E boards it and the boat controller takes over', (ctx.controller && ctx.controller.vessel && ctx.controller.vessel.name) || nb);
        must(player.rig.group.visible === false, 'the player is hidden aboard');
        run(1);
        ctx.boats.leave();
        must(ctx.controller === playerCtl && !api.aboard, 'F (leave) hands control back to the player');
        const d = Math.hypot(player.position.x - y.x, player.position.z - y.z);
        must(d < 14 && d > (HALF.yacht + 0.5), 'stepped off beside the hull', `${d.toFixed(1)} m, ${player.state}`);
        must(!api.board.it.enabled(player), 'no instant re-board right after leaving (cooldown)');
        run(1);
      } else out(false, 'an anchored yacht to board');
      // 6. the helicopter on its pad: fly, then step off on the ground
      const h = ctx.boats.helicopter && ctx.boats.helicopter.vessel;
      if (h) {
        const home = { x: h.x, z: h.z };
        beside(h, 2); run(0.4);
        must(api.board.v === h && /^E: fly /.test(api.board.label), 'fly prompt next to the helicopter', api.board.label);
        const flight = G.quest('flight') && G.poi('hill-inlet');   // the Whitsundays' scenic flight
        if (flight) G.start('flight');
        player.interact(); run(0.5);
        must(api.aboard === h, 'aboard the helicopter');
        if (flight) {
          must(G.stepIndex('flight') === 1, 'boarding counts for the scenic flight', JSON.stringify(G.state('flight')));
          dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); run(34); dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
          const hi = G.poi('hill-inlet'), wh = G.poi('whitehaven'), alt = h.y - ctx.env.u.tide.value;
          h.x = hi.x + 200; h.z = -hi.north; run(0.6);
          must(G.stepIndex('flight') === 2, 'over Hill Inlet above 100 m', `alt ${alt.toFixed(0)} m, step ${G.stepIndex('flight')}`);
          h.x = wh.x + 100; h.z = -wh.north; run(0.6);
          must(G.stepIndex('flight') === 3, 'then along Whitehaven Beach', `step ${G.stepIndex('flight')}`);
        }
        // 7. off the edge of the model: the pilot is offered the nearest other site (or told none is built)
        const [x0, , y0] = ctx.S.extent_m; h.x = x0 + 300; h.z = -(y0 + 3000);
        run(1.4); await new Promise(r => setTimeout(r, 50)); run(0.2);
        must(G.dialogue() && G.dialogue().who.id === 'edge', 'edge of the model offers travel', G.dialogue() && G.dialogue().pages[0].t);
        key('Escape');
        h.x = home.x; h.z = home.z;
        ctx.boats.leave(); run(0.3);
        const d = Math.hypot(player.position.x - h.x, player.position.z - h.z);
        must(ctx.controller === playerCtl && d < 16 && ['walk', 'wade', 'run', 'swim', 'snorkel'].includes(player.state), 'stepped off the helicopter beside it', `${d.toFixed(1)} m ${player.state}${S.onDeck ? ' on a deck' : ''}`);
        if (flight) must(G.isDone('flight'), 'stepping out completes the scenic flight', JSON.stringify(G.state('flight')));
      }
    }

    // 8. the travel list
    const list = await api.travel.load();
    must(list.length >= 1 && list.find(s => s.current && s.id === ctx.site), 'travel list has this site, marked current', list.map(s => s.id + (s.ready ? '' : '(building)')).join(','));
    // made-up entries: one whose data answers, one still being built, and a city that is not a reef site
    const fake = await api.travel.build([{ id: ctx.site, name: 'Here', viewer: 'reef/index.html', lat: -20.28, lon: 149.03 }, { id: 'test-built-reef', name: 'Built reef', viewer: 'reef/index.html', lat: -19.8, lon: 149.19 },
      { id: 'test-building-reef', name: 'Building reef', viewer: 'reef/index.html', lat: -16.76, lon: 145.97 }, { id: 'test-city', name: 'A city', lat: -33.86, lon: 151.21 }], id => id === 'test-built-reef');
    must(fake.length === 3 && fake.find(s => s.id === 'test-built-reef').ready && !fake.find(s => s.id === 'test-building-reef').ready && !fake.find(s => s.id === 'test-city'), 'a reef site appears when its data exists', fake.map(s => `${s.id}:${s.ready ? 'ready' : 'building'}:${s.km === null ? '' : Math.round(s.km) + 'km'}`).join(' '));
    const href = api.travel.href('hardy-reef', { pathname: '/reef/index.html', search: '?city=whitsundays&x=10&y=20&yaw=4&gl=1&mute=1&gametest=1&exp=1.2' });
    must(href === '/reef/index.html?city=hardy-reef&gl=1&mute=1&exp=1.2', 'travel keeps settings, drops position and test keys', href);
    key('KeyT'); await new Promise(r => setTimeout(r, 30));
    must(api.ui.panelKind === 'map' && /You are here/.test(dom('.rg-panel .body').innerHTML), 'T opens the map panel', api.ui.panelKind);
    const globe = api.travel.globeHref();
    must(/\/index\.html#globe$/.test(globe) && new URL(globe).pathname === new URL('../index.html', location.href).pathname && dom('.rg-btns .bg') && dom('.rg-panel .foot [data-act="globe"]'),
      'a way back to the globe: the button and the map panel', globe);
    key('KeyT');
    must(!api.ui.panelKind, 'T again closes it');

    // 9. light at depth, the dive slate's numbers
    const L = G.light(8);
    must(L.r < L.g && L.g < L.b && L.r > 0.005 && L.r < 0.1 && L.halfR > 1 && L.halfR < 3, 'red light at 8 m from env.u.K and lightPath', `r ${(L.r * 100).toFixed(1)}% g ${(L.g * 100).toFixed(0)}% b ${(L.b * 100).toFixed(0)}% halfR ${L.halfR.toFixed(1)} m m=${L.m.toFixed(2)}`);

    // 10. the guided dive (Raf at the Whitsundays, Sam at Hardy Reef): reach the instructor, scuba, the depth, the slate, back up
    const diveQ = G.content.quests.find(q => /^Dive to \d+ m/.test(typeof q.steps[0].text === 'string' ? q.steps[0].text : ''));
    if (G.npc('instructor') && diveQ) {
      const b = G.npc('instructor').vessel, depth = +/^Dive to (\d+) m/.exec(diveQ.steps[0].text)[1];
      if (b && G.npc('skipper')) {                          // the Whitsundays: Jo's boat run drops you at the dive boat's stern
        await G.transfer({ x: b.x - Math.sin(b.hdg) * (b.desc.L / 2 + 2.5), north: -b.z - Math.cos(b.hdg) * (b.desc.L / 2 + 2.5), face: { x: b.x, north: -b.z } }, '', '', { instant: true });
        run(0.4);
        must(player.S.water, 'the boat run puts you in the water by the dive boat', player.state);
      } else { near('instructor', 2); run(0.4); }
      must(player.interact() && G.dialogue() && G.dialogue().who.id === 'instructor', 'talk to the dive instructor', around());
      pagesToChoices(); key('Digit1'); pagesToChoices(); key('Enter');
      must(G.isActive(diveQ.id) && player.S.gear.scuba, 'the instructor starts the dive and kits you up', `${diveQ.id} ${JSON.stringify(G.state(diveQ.id))} ${player.state}`);
      run(0.2); const diver = G.npcIds().find(k => /-diving$/.test(k)); if (diver) await G.npc(diver).npc.ready;
      const dp = diveQ.steps[0].target(G);
      must(G.depth(dp.x, dp.north) > depth + 0.5, `the meeting point is deeper than ${depth} m`, `${G.depth(dp.x, dp.north).toFixed(1)} m, ${G.km(G.dist(dp, G.here()))} away`);
      player.teleport(dp.x + 2, dp.north, ctx.env.u.tide.value - depth - 0.3, 0); run(0.6);
      must(G.dialogue() && G.dialogue().who.id === 'slate' && /% of its red/.test(G.dialogue().pages[0].t), `at ${depth} m the slate gives the computed red share`, G.dialogue() && G.dialogue().pages.map(p => p.t).join(' / ').slice(0, 300));
      key('Escape'); player.teleport(dp.x + 2, dp.north, undefined, 0); run(0.6);
      must(G.isDone(diveQ.id), 'surfacing completes the dive', JSON.stringify(G.state(diveQ.id)));
      const sp = ctx.life && ctx.life.spawning;
      if (sp && sp.active && (G.content.npcs.find(n => n.id === 'instructor').nodes || {}).spawn) {   // the Whitsundays' Raf
        G.talk('instructor'); pagesToChoices();
        const ch = G.dialogue() ? G.dialogue().choices.map(c => typeof c.text === 'function' ? c.text(G) : c.text) : [];
        must(ch.some(c => /spawn/.test(c)), 'on a spawning night Raf offers the night snorkel', `${sp.nightsAfterFullMoon} nights after the full moon: ${ch.join(' | ')}`);
        G.closeDialogue(); run(0.5);
      }
      player.equip('none');
    }

    // 11. the survey, with life.js (or the stub), or its absence handled
    const life = ctx.life;
    if (life) {
      if (!G.state('survey')) G.start('survey');
      player.equip('snorkel');
      // life.js fills the water around the camera as frames run; this test runs before the first frame, so put the
      // camera in the water off the spawn and step it there
      // the nearest water 3-15 m deep to the spawn (east of Whitehaven, west of Lady Elliot's beach, round a pontoon)
      const sp0 = G.spawn(), cam = ctx.camera.position, keep = cam.clone(), w = { x: sp0.x + 250, north: sp0.north };
      found: for (let r = 50; r < 1500; r += 25) for (let a = 0; a < 6.28; a += 0.3) { const x = sp0.x + Math.cos(a) * r, n = sp0.north + Math.sin(a) * r, d = G.depth(x, n); if (d > 3 && d < 15) { w.x = x; w.north = n; break found; } }
      if (life.update) { cam.set(w.x, ctx.env.u.tide.value - 2, -w.north); for (let i = 0; i < 3; i++) life.update(0.1, i * 0.1); }
      const c = life.nearestCreature(w.x, w.north, ctx.env.u.tide.value - 1, 600, 1.4);   // in water deep enough to snorkel
      cam.copy(keep);
      must(!!c, 'life.nearestCreature finds an animal near the spawn', c && c.species && c.species.common);
      if (c) {
        const p = c.position.north !== undefined ? c.position : { x: c.position.x, north: -c.position.z };
        player.teleport(p.x + 1, p.north, undefined, 0); run(0.5);
        must(api.surv.sp && /^E: log the /.test(api.surv.label), 'survey prompt next to an animal', api.surv.label || player.state);
        const n0 = G.logged(); player.interact();
        must(G.logged() === n0 + 1, 'E logs the species', Object.keys(G.st().species).join(','));
      }
      player.equip('none');
    } else {
      must(G.quest('survey') && !G.quest('survey').available(G), 'no ctx.life: the survey is unavailable, not broken');
    }

    // 12. journal and saving (hear the reef facts first, so there are cited notes on every site)
    const reefer = G.content.npcs.find(n => n.nodes && n.nodes.reef);
    if (reefer) { near(reefer.id, 1.6); run(0.8); G.talk(reefer.id); G.show('reef'); T.drain(); run(0.5); }
    key('KeyJ');
    const jb = dom('.rg-panel .body').innerHTML;
    must(api.ui.panelKind === 'journal' && /Field notes/.test(jb) && /wikipedia\.org/.test(jb), 'J opens the journal with notes and source links', `${(jb.match(/<li/g) || []).length} items`);
    key('Escape');
    G.save();
    let saved = null; try { saved = JSON.parse(localStorage.getItem(`oe3d-reef-game-${ctx.site}-test`)); } catch (_) {}
    must(saved && saved.q && saved.notes.length > 0 && Object.keys(saved.q).length === Object.keys(G.st().q).length, 'progress saved to localStorage', saved && `${saved.notes.length} notes, quests ${Object.keys(saved.q).join(',')}`);
    must(Number.isFinite(player.position.x) && Number.isFinite(player.position.y), 'no NaNs in the player');
  } catch (e) { out(false, 'exception', String(e && e.stack || e)); }
  // leave things as a player would find them
  try { if (ctx.controller !== playerCtl && ctx.boats) ctx.boats.leave(); G.closeDialogue(); G.closePanel(); player.equip('none'); const s = G.spawn(); player.teleport(s.x, s.north, undefined, s.heading); S.virt = null; } catch (_) {}
  console.log(`[gametest] DONE pass=${R.pass} fail=${R.fail}`);
  window.__gametest = R;
}

// scenes for screenshots, set up before the first frame
export async function gameshot(api, ctx, which) {
  if (!ctx.player) return;
  const T = rig(api, ctx), { G, player, S, run, key, near, pagesToChoices, drain } = T;
  await Promise.all(G.content.npcs.map(n => G.npc(n.id) && G.npc(n.id).npc.ready));
  const cam = (yawDeg, pitchDeg, dist) => { S.camYaw = yawDeg * Math.PI / 180; S.camPitch = pitchDeg * Math.PI / 180; if (dist) S.dist = dist; };
  const toward = id => { const p = G.npc(id).npc.group.position; return G.bearing(G.here(), { x: p.x, north: -p.z }); };
  if (which === 'dialogue') {
    // &shotnpc=<id> (default the site's first person) &shotnode=<node> &shotpage=<n> &shotdist &shotyaw &shotpitch &shotcam
    const n = k => ctx.q.get(k), id = n('shotnpc') || G.content.npcs[0].id;
    near(id, +(n('shotdist') || 2.2)); run(0.4);
    player.interact(); if (n('shotnode')) G.show(n('shotnode'));
    if (n('shotpage') !== null) for (let i = 0; i < +n('shotpage'); i++) key('Enter'); else pagesToChoices();
    run(0.3);
    cam(toward(id) + +(n('shotyaw') || -32), +(n('shotpitch') || -10), +(n('shotcam') || 4.4));
  } else if (which === 'journal') {
    for (const id of ['sand', 'inlet', 'survey', 'flight']) G.start(id);
    G.data('sand').walked = 212; G.advance('sand'); near('ranger', 1.8); run(0.4); player.interact(); drain(); run(0.4);
    G.talk('ranger'); G.show('country'); drain(); run(0.4);
    G.talk('ranger'); G.show('reef'); drain();
    G.track('inlet');
    if (ctx.life) { for (const s of ctx.life.species.slice(0, 2)) G.logSpecies(s); }
    run(0.3); cam(G.spawn().heading, -8, 3.4);
    key('KeyJ');
    // ?gameshot=journal&scroll=survey|notes shows that part of the journal
    const sec = ctx.q.get('scroll'), body = api.ui.el.querySelector('.rg-panel .body');
    if (sec) { const h = [...body.querySelectorAll('h3')].find(e => e.textContent.toLowerCase().includes(sec)); if (h) body.scrollTop = h.offsetTop - body.offsetTop - 4; }
  } else if (which === 'map') {
    await api.travel.load(); G.start('inlet'); cam(G.spawn().heading, -8, 3.4); key('KeyT');
  } else if (which === 'lookout') {
    // stand beside Mia, both looking out toward the inlet; the camera behind and above
    G.start('inlet'); const m = G.npc('guide').npc.group.position, hi = G.poi('hill-inlet'), b = G.bearing({ x: m.x, north: -m.z }, hi) * Math.PI / 180;
    player.teleport(m.x - Math.cos(b) * 1.7, -m.z + Math.sin(b) * 1.7, undefined, b * 180 / Math.PI); run(0.6); player.interact();
    key('Enter');                                           // the computed sand-and-water page
    cam(b * 180 / Math.PI - 4, -14, 5.5); run(0.4);
  } else if (which === 'red') {
    const b = G.npc('instructor') && G.npc('instructor').vessel; if (!b) return;
    G.npc('instructor').npc.ready && await G.npc('instructor').npc.ready;
    player.equip('scuba'); G.start('red'); run(0.1); await G.npc('raf-diving').npc.ready;
    const dp = G.content.quests.find(q => q.id === 'red').steps[0].target(G), r = G.npc('raf-diving');
    player.teleport(dp.x - 3.2, dp.north - 0.8, ctx.env.u.tide.value - 8.1, 70);
    // trim the BCD like a diver holding depth (as player.js's autotest does), so the computer's rate settles after the jump
    for (let i = 0; i < 160; i++) { S.bcd.n = Math.max(0, S.bcd.n - S.vy * 12 * 0.05 * (1 + player.depth / 10)); run(0.05); }
    const p = r.npc.group.position; cam(G.bearing(G.here(), { x: p.x, north: -p.z }) - 20, 4, 3.2);
    run(0.2);
  } else if (which === 'board') {
    const h = ctx.boats && ctx.boats.helicopter && ctx.boats.helicopter.vessel; if (!h) return;
    const half = 1.4 + 2.2, sx = Math.cos(h.hdg), sn = -Math.sin(h.hdg), x = h.x - sx * half, north = -h.z - sn * half;
    player.teleport(x, north, undefined, G.bearing({ x, north }, { x: h.x, north: -h.z })); run(0.5);
    cam(G.bearing({ x, north }, { x: h.x, north: -h.z }) - 35, -8, 4.5);
  }
}
