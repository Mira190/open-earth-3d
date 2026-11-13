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
  const fishFirst = !window.OEFishing && !ctx.fishing;   // (before the run walks anyone near a spot: step 15)
  try {
    // 1. people at their places
    const ids = G.content.npcs.map(n => n.id);
    await Promise.all(ids.map(id => G.npc(id) && G.npc(id).npc.ready));
    must(ids.every(id => G.npc(id) && G.npc(id).npc.rig), 'NPCs spawned and loaded', ids.join(','));
    // 1a. the people are real (Rocketbox avatars, people.js), the visitor too, each a different person; a hat is made
    // to the head it is on (gear.js fittedHat: its band within a centimetre of the skull's width)
    {
      const rigs = ids.map(id => G.npc(id).npc.rig), names = rigs.map(r => r.look.character);
      must(rigs.every(r => r.real) && player.rig.real, 'the people and the visitor are real avatars', [player.rig.look.character, ...names].join(','));
      must(new Set(names).size === names.length, 'no two of the people here are the same person', names.join(','));
      const hats = [player.rig, ...rigs].filter(r => r.acc.hat), fit = hats.map(r => r.T.head.fit);
      must(fit.every(f => f && f.a > 0.06 && f.a < 0.11 && f.top - f.y > 0.04 && f.top - f.y < 0.12), 'hats are made to the heads they are on', fit.map(f => f ? `${(f.a * 200).toFixed(1)} cm wide, crown ${((f.top - f.y) * 100).toFixed(1)} cm` : 'no fit').join('; '));
      must(!!player.rig.actions.Run && !!player.rig.bones.UpperLegL && !!player.rig.bones.FootR, 'the visitor has a run and the bones the swim poses', Object.keys(player.rig.actions).join(','));
    }
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
    // the frame budget (issue 382): the page runs the governor the city game runs (quality.js). Frames of 40 ms take
    // the scene's resolution down, then the extras, then the resolution to its floor; fast frames bring all of it
    // back; and the scene's target follows the governor's scale each time
    const gov = ctx.governor, post = ctx.post;
    must(gov && typeof gov.simulate === 'function' && post && typeof post.getScale === 'function', 'frame budget: the page has the governor and a scene target to scale');
    if (gov && gov.simulate && post && post.getScale) {
      const s0 = gov.scale, e0 = gov.extras;
      gov.set(gov.max, 1);
      const down = gov.simulate(40, () => 40), low = gov.scale, lowE = gov.extras, lowT = post.getScale();
      const up = gov.simulate(240, () => 4);
      must(low < gov.max - 0.15 && lowE === 0 && Math.abs(lowT - low) < 1e-6, 'frame budget: slow frames take the resolution down and shed the extras', `${down[0]} .. ${down[down.length - 1]}, scene target ${lowT.toFixed(2)}`);
      must(Math.abs(gov.scale - gov.max) < 1e-6 && gov.extras === 1 && Math.abs(post.getScale() - gov.max) < 1e-6, 'frame budget: fast frames bring it back', `${up[up.length - 1]} of ${gov.max.toFixed(2)}`);
      gov.set(s0, e0);
    }

    // 1b. solid things: the start is clear of every sign, the kit and the people; nobody stands inside anyone or anything;
    // a sign stops you; a landmark's walls stand on the ground with no gap under them
    if (player.clearance) {
      const h0 = G.here(), c0 = player.clearance(h0.x, h0.north, S.pos.y);
      must(c0.gap >= 0.6 || S.onDeck || S.water, 'the start is clear of signs, the kit and people', `${c0.gap.toFixed(2)} m from ${c0.who ? c0.who.id : 'nothing'}`);
      const bad = [];
      for (const c of player.colliders) {
        if (!c.id || !/^(npc|sign|kit)/.test(c.id) || (c.on && !c.on())) continue;
        const r = player.clearance(c.x, c.north, undefined, c);
        if (r.gap < 0.5) bad.push(`${c.id} ${r.gap.toFixed(2)} m from ${r.who.id}`);
      }
      must(!bad.length, 'no person, sign or kit stands inside another', bad.slice(0, 4).join('; ') || `${player.colliders.length} colliders`);
      const sg0 = (G.content.signs || []).map(s => G.sign(s.id)).find(s => s && s.collider);
      if (sg0) {
        const c = sg0.collider, vx = -c.un, vn = c.ux, x = c.x + vx * 2.5, north = c.north + vn * 2.5;
        player.teleport(x, north, undefined, G.bearing({ x, north }, c)); run(3, V({ f: 1 }));
        const p = G.here(), side = (p.x - c.x) * vx + (p.north - c.north) * vn, g = player.clearance(p.x, p.north).gap;
        must(side > c.hv + 0.2 && g > 0.25, `walking into the ${sg0.def.id} sign stops you at the board`, `${side.toFixed(2)} m from its middle, ${g.toFixed(2)} m clear`);
        const sp1 = G.spawn(); player.teleport(sp1.x, sp1.north, undefined, sp1.heading); run(0.3);
      }
    }
    for (const lm of ctx.landmarks || []) {
      const f = lm.fit; if (!f) continue;
      const c = f.collider, gs = [];   // the ground over the walls' outline, corners and middle (5 x 5)
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const a = (i / 2 - 1) * 0.97, b = (j / 2 - 1) * 0.97; gs.push(G.height(c.x + a * c.hu * c.ux - b * c.hv * c.un, c.north + a * c.hu * c.un + b * c.hv * c.ux)); }
      const base = lm.root.position.y, low = f.plinth ? -Infinity : lm.box.min.y;
      must(base <= Math.max(...gs) + 0.1 && low <= Math.min(...gs) + 0.1, `${lm.L.id} stands on the ground`,
        `base ${base.toFixed(2)}, lowest ${f.plinth ? 'plinth' : low.toFixed(2)}, ground ${Math.min(...gs).toFixed(2)}..${Math.max(...gs).toFixed(2)}`);
    }

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
      must(pg.some(p => /m above the sea/.test(p)), 'lookout elevation', pg[0]);
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
        must(/Ngaro, as signed and mapped/.test(t) && /\d+ m above the sea/.test(t), 'the sign gives the mapped name and the model height', t.slice(0, 160));
        must(/In sight from here/.test(t), 'the sign lists places in sight over the terrain', t.slice(t.indexOf('In sight'), t.indexOf('In sight') + 140));
        key('Escape');
        must(G.st().signs['bari-dhili-lookout'] && G.isActive('lookouts'), 'reading it counts toward the lookouts quest', JSON.stringify(G.state('lookouts')));
        run(0.5);
      }
    }

    // 4d. Lake Tekapo: the church at sunrise, Mt John's summit, the night sky worked out live
    if (G.quest('church-sunrise') && G.npc('astronomer')) {
      const yaw = d => { S.camYaw = d * Math.PI / 180; }, pitch = d => { S.camPitch = d * Math.PI / 180; };
      const church = G.poi('church-good-shepherd');
      must(G.dist(sp, church) < 60, 'the spawn is the church postcard', G.km(G.dist(sp, church)));
      near('ranger', 1.6); run(0.3); player.interact(); G.show('lake');
      const lk = G.dialogue() ? G.dialogue().pages.map(p => p.t).join(' ') : '';
      must(/83 square kilometres/.test(lk) && /Takapō/.test(lk), 'Kate on the lake cites its size and its name', lk.slice(0, 120));
      G.show('sunrise');
      const sr = G.dialogue() ? G.dialogue().pages.map(p => p.t).join(' ') : '';
      must(/Sunrise is at \d/.test(sr), 'Kate gives the next sunrise from the sun model', sr.slice(0, 80));
      G.closeDialogue(); run(0.3);
      // sunrise at the church: set the clock to the day's sunrise, stand there, look up the lake
      if (ctx.setClock) {
        const l = window.Sun.utcToLocal(G.nowMs()), rise = window.Sun.localToUtc(l.y, l.m, l.d, window.Sun.dayLimits(l.y, l.m, l.d).sunrise);
        ctx.setClock(rise + 5 * 60e3); G.start('church-sunrise');
        player.teleport(church.x - 6, church.north - 18, undefined, 16.5); yaw(16.5); run(1.0);
        must(G.stepIndex('church-sunrise') >= 1, 'at the church at sunrise', JSON.stringify(G.state('church-sunrise')));
        run(4, V());
        must(G.isDone('church-sunrise'), 'looking up the lake completes the sunrise quest', JSON.stringify(G.state('church-sunrise')));
      }
      // the summit: walk-up step, then the sign
      const mj = G.poi('mt-john'); G.start('mt-john');
      player.teleport(mj.x + 10, mj.north + 10, undefined, 40); run(0.8);
      must(G.stepIndex('mt-john') >= 1, 'reaching the summit of Mt John', JSON.stringify(G.state('mt-john')));
      const sg = G.sign('summit');
      if (sg) { player.teleport(sg.x + 1.2, sg.north, undefined, 270); run(0.4); player.interact();
        const t = G.dialogue() ? G.dialogue().pages.map(p => p.t).join(' ') : '';
        must(/m above sea level/.test(t) && /In sight from here: \S/.test(t), 'the summit sign gives the model height and what is in sight', t.slice(0, 160));
        key('Escape'); run(0.3); }
      // the sky now, then a night: dark, look up, find the Southern Cross where the model says it is
      near('astronomer', 1.6); run(0.3); player.interact(); G.show('sky');
      const sk = G.dialogue() ? G.dialogue().pages.map(p => p.t).join(' ') : '';
      must(/Southern Cross is (\d+° up|below)/.test(sk) && /never sets/.test(sk), 'Mei places the Southern Cross from the clock', sk.slice(sk.indexOf('Southern'), sk.indexOf('Southern') + 80));
      G.closeDialogue(); run(0.3);
      if (ctx.setClock) {
        const l = window.Sun.utcToLocal(G.nowMs()), m18 = window.Sun.altitudeTime(l.y, l.m, l.d, -18, true);
        ctx.setClock(window.Sun.localToUtc(l.y, l.m, l.d, (m18 ?? 1380) + 60));
        G.start('stargazing'); player.teleport(mj.x + 6, mj.north - 6, undefined, 180); run(0.8);
        must(G.stepIndex('stargazing') >= 1, 'on Mt John after full dark', JSON.stringify(G.state('stargazing')));
        pitch(60); run(21, V());
        must(G.stepIndex('stargazing') >= 2, 'looking up for 20 s lets the eyes adjust', JSON.stringify(G.state('stargazing')));
        const RA = (11 + 56.13 / 60 + 12 + 57.45 / 60) / 2, DEC = (-55.68 - 64.70) / 2, D = G.nowMs() / 864e5 + 2440587.5 - 2451545;
        const [lon, lat] = ctx.S.origin, H = (((18.697374558 + 24.06570982441908 * D + lon / 15 - RA) % 24 + 24) % 24) * 15 * Math.PI / 180, f = lat * Math.PI / 180, d = DEC * Math.PI / 180;
        const alt = Math.asin(Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H)) * 180 / Math.PI;
        const az = (Math.atan2(-Math.sin(H) * Math.cos(d), Math.cos(f) * Math.sin(d) - Math.sin(f) * Math.cos(d) * Math.cos(H)) * 180 / Math.PI + 360) % 360;
        yaw(az); pitch(alt); run(0.6, V());
        must(G.stepIndex('stargazing') >= 3, 'facing the Southern Cross finds it', `alt ${alt.toFixed(0)} az ${az.toFixed(0)}, ${JSON.stringify(G.state('stargazing'))}`);
        pitch(-5);
      }
    }

    // 4e. Milford Sound: the model's own heights beside the published ones, the rainbow from the sun, Mitre Peak from the
    // foreshore, the lupins in their season, and the ship (when her model is in the build)
    if (G.quest('mitre-view') && G.npc('naturalist')) {
      const say = (id, node) => { near(id, 1.6); run(0.3); player.interact(); G.show(node); const t = G.dialogue() ? G.dialogue().pages.map(p => p.t).join(' ') : ''; G.closeDialogue(); run(0.5); return t; };
      const fs = G.poi('foreshore'), dry = id => { const p = at(id); return G.depth(p.x, p.north) < 0 && p.up > ctx.env.u.tide.value + 0.2; };
      must(G.dist(sp, fs) < 30 && dry('ranger') && dry('naturalist'), 'the spawn is the foreshore walk; Jess and Finn stand on dry ground', `ranger up ${at('ranger').up.toFixed(1)} m, naturalist up ${at('naturalist').up.toFixed(1)} m`);
      if (G.poi('freshwater-basin')) must(G.dist(at('naturalist'), G.poi('freshwater-basin')) < 160, 'Finn at the Freshwater Basin terminal', G.km(G.dist(at('naturalist'), G.poi('freshwater-basin'))));
      const mt = say('ranger', 'mitre'), mm = /the top stands ([\d,]+) m/.exec(mt), top = mm ? +mm[1].replace(/,/g, '') : 0;
      must(/1,690 m/.test(mt) && top > 1500 && top < 1800 && /° above the horizontal/.test(mt), 'Jess gives Mitre Peak\'s published height beside the model\'s', mt.slice(mt.indexOf('The page gives'), mt.indexOf('The page gives') + 170));
      const ft = say('naturalist', 'falls');
      must(/151 m/.test(ft) && /162 m/.test(ft) && (!ctx.fiord || /drops [\d,]+ m here/.test(ft)), 'Finn gives the falls\' published heights' + (ctx.fiord ? ' beside the drops traced on the model' : ''), ft.slice(0, 200));
      const rb = say('naturalist', 'rainbow');
      must(/40 to 42 degrees/.test(rb) && /(sun is \d+° up in the|sun is down now)/.test(rb), 'Finn works the rainbow out from the sun now', rb.slice(rb.indexOf('Right now') < 0 ? 0 : rb.indexOf('Right now')).slice(0, 260));
      // Mitre Peak from the foreshore: the sign, then the turn
      G.start('mitre-view');
      const sg = G.sign('foreshore');
      if (sg) { const c = sg.collider, x = sg.x - c.un * 1.4, north = sg.north + c.ux * 1.4; player.teleport(x, north, undefined, G.bearing({ x, north }, sg)); run(0.4);
        must(player.interact() && G.dialogue() && /In sight from here.*Mitre Peak/.test(G.dialogue().pages.map(p => p.t).join(' ')), 'the foreshore sign lists Mitre Peak in sight, with its model height', (G.dialogue() && G.dialogue().pages.map(p => p.t).join(' ').slice(140, 330)) || around());
        key('Escape'); run(0.5); }
      must(G.stepIndex('mitre-view') === 1, 'reading the sign counts for the view', JSON.stringify(G.state('mitre-view')));
      player.teleport(sp.x, sp.north, undefined, G.bearing(sp, G.poi('mitre-peak'))); run(0.2);
      for (let i = 0; i < 12 && !G.isDone('mitre-view'); i++) { S.camYaw = (G.bearing(G.here(), G.poi('mitre-peak')) + i * 2 - 8) * Math.PI / 180; run(2, V()); }
      must(G.isDone('mitre-view'), 'facing Mitre Peak from the foreshore completes it', JSON.stringify(G.state('mitre-view')));
      // the lupins, September to February
      const lq = G.quest('lupins');
      if (lq.available(G)) {
        G.start('lupins'); const l = lq.steps[0].target(G); player.teleport(l.x, l.north, undefined, 0); run(0.6);
        must(G.stepIndex('lupins') === 1, 'walking into the lupins on the flats', `${G.km(G.dist(sp, l))} from the start, ${JSON.stringify(G.state('lupins'))}`);
        near('ranger', 1.6); run(0.3); player.interact();
        must(G.isDone('lupins') && G.dialogue() && G.dialogue().id === 'lupinsDone', 'telling Jess completes the lupins', G.dialogue() && G.dialogue().id);
        G.closeDialogue(); run(0.5);
      } else must(!G.start('lupins'), 'out of season the lupins quest does not start', G.month());
      // the ship: Finn puts you aboard, she comes to Stirling Falls, you step off ashore
      const v = G.vessels().find(b => b.kind === 'ship'), cq = G.quest('cruise');
      if (v) {
        const home = { x: v.x, z: v.z };
        near('naturalist', 1.6); run(0.3); player.interact(); pagesToChoices();
        const ci = G.dialogue() ? G.dialogue().choices.findIndex(c => /Take me out/.test(c.text)) : -1;
        if (ci >= 0) key('Digit' + (ci + 1));
        run(0.5);
        must(ci >= 0 && api.aboard === v && G.stepIndex('cruise') === 1, 'Finn puts you aboard the ship and the cruise is under way', `${v.name}, ${JSON.stringify(G.state('cruise'))}`);
        const w = G.poi('wp-stirling'); v.x = w.x; v.z = -w.north; run(0.6);
        must(G.isDone('cruise'), 'the ship at Stirling Falls completes the cruise', JSON.stringify(G.state('cruise')));
        v.x = home.x; v.z = home.z;
        ctx.boats.leave(); run(0.5);
        must(ctx.controller === playerCtl && !api.aboard && !S.water, 'stepping off the ship puts you ashore', `${player.state}, ${G.km(G.dist(G.here(), sp))} from the start`);
      } else must(cq && !cq.available(G) && !G.start('cruise'), 'no ship in this build: the cruise is unavailable, not broken');
      player.teleport(sp.x, sp.north, undefined, sp.heading); run(0.3);
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
      } else if ((ctx.S.harbour && ctx.S.harbour.fleets || []).length) out(false, 'an anchored yacht to board');
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
    const mv = () => api.mapView, rows = k => [...document.querySelectorAll(`.rg-list button[data-kind="${k}"]`)];
    must(api.ui.panelKind === 'map' && mv() && mv().scale === 'local' && dom('.rg-tabs button.on').dataset.scale === 'local', 'T opens the map panel on this site', api.ui.panelKind);
    const globe = api.travel.globeHref();
    must(/\/index\.html#globe$/.test(globe) && new URL(globe).pathname === new URL('../index.html', location.href).pathname && dom('.rg-btns .bg') && dom('.rg-panel .foot [data-act="globe"]'),
      'a way back to the globe: the button and the map panel', globe);
    // every named place is a pin on the map and a row of the list; the people and you are on it
    dom('.rg-zoom [data-z="fit"]').click(); await new Promise(r => setTimeout(r, 400)); mv().redraw();   // out to the whole model
    const np = rows('place').length, pins = mv().hits.filter(h => h.ref.kind === 'place').length;
    must(np === pins, 'every travel point of the list is a pin on the whole map', `${np} rows, ${pins} pins`);
    // All sites: the regions, this site marked, another one picked gives a card with Travel
    dom('.rg-tabs button[data-scale="world"]').click(); await new Promise(r => setTimeout(r, 30)); mv().redraw();
    const cur = rows('site').find(b => b.dataset.id === ctx.site), other = rows('site').find(b => b.dataset.id !== ctx.site && list.find(s => s.id === b.dataset.id).ready);
    must(mv().scale === 'world' && cur && /You are here/.test(cur.textContent) && rows('site').length === list.filter(s => Number.isFinite(s.lat)).length, 'All sites lists every site by region, this one marked', [...document.querySelectorAll('.rg-list h3')].map(h => h.textContent).join(' | '));
    if (other) {
      other.click();
      const go = dom('.rg-pop .go');
      must(!dom('.rg-pop').hidden && !go.disabled && /^Travel to /.test(go.textContent) && mv().selected.id === other.dataset.id, 'picking another site offers Travel on its card', `${dom('.rg-pop b').textContent}: ${go.textContent}`);
    }
    cur.click(); dom('.rg-pop .go').click();
    must(mv().scale === 'local', 'this site\'s card opens its own map');
    key('KeyT');
    must(!api.ui.panelKind && !api.mapView, 'T again closes it');
    // 8b. the map's travel points: pick one, then Travel here goes straight to a named place (dry ground nearest it, or the water over a reef), then back
    key('KeyT'); await new Promise(r => setTimeout(r, 30));
    // a place far enough away to tell that Go moved you (the spawn can be beside the first one: Heron's jetty)
    const row = [...document.querySelectorAll('.rg-list button[data-kind="place"]')].find(b => G.poi(b.dataset.id) && G.dist(G.here(), G.poi(b.dataset.id)) > 200);
    if (row) {
      const h0 = G.here(), to = G.poi(row.dataset.id);
      row.click();
      must(!dom('.rg-pop').hidden && dom('.rg-pop b').textContent === to.name && row.classList.contains('on') && !dom('.rg-pop .go').disabled, `picking ${to.name} shows its card with Travel here`, dom('.rg-pop small').textContent);
      // the same pick from the map: a still press on its pin
      await new Promise(r => setTimeout(r, 400)); api.mapView.select('place', ''); api.mapView.redraw();   // (the map has eased over to show it)
      const hit = api.mapView.hits.find(h => h.ref.kind === 'place' && h.ref.id === to.id), cv = dom('.rg-map canvas'), box = cv.getBoundingClientRect();
      const ev = t => cv.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: box.left + hit.x, clientY: box.top + hit.y, bubbles: true }));
      if (hit) { ev('pointerdown'); ev('pointerup'); }
      must(hit && api.mapView.selected && api.mapView.selected.id === to.id && !dom('.rg-pop').hidden, 'a press on its pin picks it too', dom('.rg-pop b').textContent);
      dom('.rg-pop .go').click(); run(0.3);
      const d = G.dist(G.here(), to);
      must(!api.ui.panelKind && d < 900 && G.dist(G.here(), h0) > 30, `Travel here takes you to ${to.name}`, `${G.km(d)} from it, ${player.state}`);
      player.teleport(h0.x, h0.north); run(0.3);
    } else { must(true, 'no named place far enough to go to'); key('KeyT'); }

    // 9. light at depth, the dive slate's numbers
    const L = G.light(8);
    if (ctx.S.biome === 'fiordland') {   // a fiord's dark, clear water: red goes first and green carries furthest; there is still light at 1 m
      const L1 = G.light(1);
      must(L1.r < L1.b && L1.b < L1.g && L1.g > 0.5 && L.r < 0.05 && L.g > L.r, 'a fiord: red goes first, green carries furthest, light left at 1 m', `1 m: r ${(L1.r * 100).toFixed(1)}% g ${(L1.g * 100).toFixed(1)}% b ${(L1.b * 100).toFixed(1)}%; 8 m: r ${(L.r * 100).toFixed(1)}% g ${(L.g * 100).toFixed(1)}%`);
    } else if (ctx.S.kind === 'alpine') {   // glacial flour: the light is gone within a metre or two, and the lake is no place to dive
      const L1 = G.light(1);
      must(L1.g < 0.1 && L1.r <= L1.g && L.g < 1e-6, 'glacial flour: under 10% of the light left at 1 m, none at 8 m', `1 m: r ${(L1.r * 100).toFixed(1)}% g ${(L1.g * 100).toFixed(1)}% b ${(L1.b * 100).toFixed(1)}%`);
    } else
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
      if (ctx.S.kind === 'alpine') must(!G.quest('survey'), 'an alpine lake has no fish survey');
      // the highway's traffic (alpine/traffic.js): cars on the road, keeping left, on the ground as it is drawn
      if (ctx.S.kind === 'alpine' && ctx.traffic) {
        for (let i = 0; i < 30; i++) ctx.updaters.forEach(u => u(0.1, i * 0.1));
        const t = ctx.traffic.stats();
        must(t.n > 0 && t.left === t.n && t.ground === t.n, 'traffic on the highway keeps left, on the ground', `${t.n} cars, ${t.left} in the left lane, ${t.ground} on the ground`);
      }
      else if (ctx.S.kind !== 'alpine') must(G.quest('survey') && !G.quest('survey').available(G), 'no ctx.life: the survey is unavailable, not broken');
    }

    // 11b. swimming and the duck-dive hold the body's pose: the swim offsets are put back each frame, not piled up
    // (a constant clip track is not rewritten by the mixer, so a piled-up neck turn spun the head)
    {
      const sp0 = G.spawn(); let w = null;
      found: for (let r = 50; r < 3000; r += 25) for (let a = 0; a < 6.28; a += 0.3) { const x = sp0.x + Math.cos(a) * r, n = sp0.north + Math.sin(a) * r, d = G.depth(x, n); if (d > 3 && d < 30) { w = { x, north: n }; break found; } }
      const neck = player.rig && player.rig.bones && (player.rig.bones.Neck || player.rig.bones.Head);
      if (w && neck) {
        player.equip('none'); player.teleport(w.x, w.north, undefined, 0); run(1.5);
        const turn = secs => { const q0 = neck.quaternion.clone(); run(secs, V({ down: 1 })); return 2 * Math.acos(Math.min(1, Math.abs(q0.dot(neck.quaternion)))); };
        const a0 = turn(0.05), a1 = (run(1, V({ down: 1 })), turn(0.05));
        must(S.water && a0 < 0.15 && a1 < 0.15, 'the swimmer\'s head holds still at the surface and on a duck-dive',
          `${(a0 * 57.3).toFixed(1)} and ${(a1 * 57.3).toFixed(1)} deg per frame, ${player.state} ${S.depthBody.toFixed(1)} m`);
        const sp = G.spawn(); player.teleport(sp.x, sp.north, undefined, sp.heading); run(0.3);
      }
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

    // 13. the first-time tour of the HUD (onboard.js, #89): "Show the intro again" in the journal opens it; every
    // step's card is on the screen and its control is there; it steps back and on, Esc skips it, and it is
    // remembered across every map (the player's own flag is put back afterwards)
    if (window.OEOnboard) {
      let keep = null; try { keep = localStorage.getItem('oe3d-onboard'); } catch (_) {}
      key('KeyJ');
      const again = dom('.rg-panel [data-act="intro"]');
      if (again) again.click();
      const t = window.OEOnboard.current(), seen = [], bad = [];
      if (t) for (let i = 0; i < t.count; i++) {
        seen.push(t.id);
        // where the card settles (it eases there in 0.5 s, which a software renderer under load draws late)
        const ce = t.el.querySelector('.ob-card'), cl = parseFloat(ce.style.left), ct = parseFloat(ce.style.top);
        const r = { left: cl, top: ct, right: cl + ce.offsetWidth, bottom: ct + ce.offsetHeight };
        if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) bad.push(`${t.id} off screen`);
        if (i < t.count - 1) t.next();
      }
      if (t) t.back();
      const back = t ? t.step : -9;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
      must(!!again && !api.ui.panelKind && seen.length >= 5 && !bad.length && back === seen.length - 2 && !window.OEOnboard.active() && window.OEOnboard.done(),
        'the HUD tour opens from the journal, steps through and back, and Esc skips it', `${seen.join(',')}${bad.length ? ' · ' + bad.join('; ') : ''}`);
      try { if (keep == null) localStorage.removeItem('oe3d-onboard'); else localStorage.setItem('oe3d-onboard', keep); } catch (_) {}
    }
    // 14. the weather (weather.js, issue 381): the season's climate is the site's own; rain comes in under its cloud and
    // OEWeather.S follows it with the streaks drawn above the water and none below; an alpine site's snow falls,
    // settles and moves the snow line down; the wind moves the sea; and the season's weather is back afterwards
    if (ctx.weather) {
      const Wx = ctx.weather, WS = window.OEWeather && window.OEWeather.S, M = Wx.meshes, wind0 = ctx.env.u.wind.value;
      must(!!WS && !!ctx.S.weather && Array.isArray(ctx.S.weather.rain_days) && ctx.S.weather.rain_days.length === 12 && Array.isArray(ctx.S.weather.temp_max),
        'the site has its own climate for the weather', ctx.S.weather && ctx.S.weather.source);
      const sp = G.spawn(); player.teleport(sp.x, sp.north, undefined, sp.heading); run(0.3);
      Wx.set({ rain: 0.85, cloud: 1, wind: 14 }); run(12);
      must(WS.kind === 'rain' && WS.rain > 0.5 && WS.cover > 0.8 && WS.wet > 0.05 && M.rain.visible && M.deck.visible && WS.visibility < 10000,
        'rain comes in under its cloud, the ground wets and the streaks fall', `${WS.kind} rain ${WS.rain.toFixed(2)} cover ${WS.cover.toFixed(2)} wet ${WS.wet.toFixed(2)} vis ${Math.round(WS.visibility)} m`);
      must(ctx.env.u.wind.value > wind0 * 1.3, 'a gale raises the sea', `wind ${wind0.toFixed(2)} -> ${ctx.env.u.wind.value.toFixed(2)}`);
      const top = ctx.camera.position.y; ctx.camera.position.y = ctx.env.u.tide.value - 3; Wx.set({ rain: 0.85, cloud: 1 }); for (const u of ctx.updaters) u(0.05, 999);
      must(!M.rain.visible && !M.rings.visible, 'no rain drawn under water');
      ctx.camera.position.y = top;
      if (ctx.S.kind === 'alpine') {
        Wx.set('snow'); run(20);
        const line = ctx.terrain.weather ? ctx.terrain.weather.line.value : NaN;
        must(WS.kind === 'snow' && WS.snow > 0.3 && WS.snowDepth > 0.05 && M.snow.visible && WS.temp < 1 && Number.isFinite(line),
          'snow falls on the alpine site and settles, the snow line set', `${WS.kind} snow ${WS.snow.toFixed(2)} depth ${WS.snowDepth.toFixed(2)} ${WS.temp.toFixed(1)}° line ${Math.round(line)} m`);
      }
      Wx.set('clear', { now: true }); run(0.2);
      must(WS.kind === 'clear' && !M.rain.visible && !M.snow.visible, 'clear again: nothing falls');
      Wx.set('live'); run(0.2);
      const se = Wx.season();
      must(Number.isFinite(se.rain) && Number.isFinite(se.temp) && WS.source === 'season', 'the season decides again', `${Wx.describe()}`);
    }
    // 15. fishing (fishing.js, issue 364), where a site has it: the module is not loaded with the site; at the shore spot E
    // fishes, a cast lands in the water, a fish takes, is fought, landed, measured against the rules and let go; a closed
    // species is said to be; no line in a marine reserve, from the deck either; and the deck's line comes in when she
    // sails into one
    if (ctx.S.fishing) {
      must(fishFirst, 'fishing is not loaded with the site');
      const f = await api.fishing(), A = f && f.api;
      must(!!A && !!window.OEFishing, 'fishing loads on demand', f && `${f.spots.length} spots`);
      if (A) {
        const shore = f.spots.find(sp => !sp.vessel), core = window.OEFishing.core;
        player.teleport(shore.at[0], shore.at[1], undefined, shore.h * 180 / Math.PI); run(0.3);
        const a = A.action();
        must(a && /^Fish at/.test(a.text), 'E at the foreshore offers fishing', a && a.text);
        A.seed(7); A.force(A.easiest()); a.act(); run(0.2);
        must(A.state().st === 'aim' && player.S.hold, 'the angler is at the edge, still, with a line ready', A.state().st);
        const K = f.keys, press = (c, s) => { K.add(c); run(s); K.delete(c); };
        press('Space', 0.6); run(1.2);
        const cast = A.state();
        must(cast.st === 'wait' && cast.line > 3 && f.data && ctx.depth(...(() => { const h = shore.h; return [shore.at[0] + Math.sin(h) * cast.line * 0.9, shore.at[1] + Math.cos(h) * cast.line * 0.9]; })()) > 0, 'the cast lands in the water', `${cast.st} ${cast.line && cast.line.toFixed(1)} m`);
        let tries = 0;
        for (let i = 0; i < 1200 && A.state().st !== 'card' && tries < 3; i++) {
          const s = A.state();
          if (s.st === 'bite') press('Space', 0.05);
          else if (s.st === 'fight') { if (s.phase !== 'run' && s.T < 0.8) K.add('Space'); else K.delete('Space'); run(0.05); }
          else if (s.st === 'aim') { tries++; press('Space', 0.6); run(1.2); }
          else run(0.1);
        }
        K.delete('Space');
        const card = A.state(), cardEl = document.getElementById('g-fishcard');
        must(card.st === 'card' && cardEl && !cardEl.hidden && card.log[card.fish] && card.log[card.fish].n >= 1, 'a fish is hooked, fought, landed and logged', `${card.fish} ${card.cm} cm`);
        const bc = f.data.species.find(s => s.id === 'blue-cod');
        if (bc) must(/Milford Sound/.test(core.legal(bc, 40)), 'blue cod: closed in Milford Sound at any size', core.legal(bc, 40));
        A.action().act(); run(0.2);
        must(A.state().st === 'aim', 'let go: back to the cast');
        A.stop(true); run(0.1);
        must(!player.S.hold && A.state().st === 'off', 'packed up: the angler walks again');
        // the reserve: under the north wall it is closed, off Mitre Peak and at the head it is open
        const pt = id => { const p = ctx.poi(id); return p ? [p.x, p.y] : null; };
        const inR = ['wp-elephant', 'wp-stirling'].map(pt).filter(Boolean), outR = ['wp-mitre', 'foreshore', 'wp-berth'].map(pt).filter(Boolean);
        must(inR.length && inR.every(p => f.reserveAt(...p)) && outR.every(p => !f.reserveAt(...p)), 'the Piopiotahi Marine Reserve lies along the north wall, not the south or the head');
        // the deck
        const ship = ctx.boats && ctx.boats.byName(f.spots.find(sp => sp.vessel).vessel);
        if (ship) {
          const put = p => { ship.x = p[0]; ship.z = -p[1]; };
          put(inR[0]); ctx.boats.board(ship, api.rider); run(0.3);
          must(f.riding(), 'aboard the Piopiotahi as a passenger');
          put(inR[0]); run(0.1); f.deckStart(); run(0.1);
          must(!A.busy(), 'no line from the deck inside the reserve', A.state().st);
          put(outR[0]); run(0.4); f.deckStart(); run(0.3);
          must(A.busy() && f.onDeck && player.rig.group.visible, 'off Mitre Peak: a line from the after deck', A.state().st);
          press('Space', 0.6); run(1.2);
          const before = A.state().line;
          put(inR[0]); run(0.4);
          must(!A.busy(), 'sailing into the reserve: lines in', `${A.state().st} (line was ${before && before.toFixed(1)} m)`);
          ctx.boats.leave(); run(0.3);
        }
      }
    }
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
