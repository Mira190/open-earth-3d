// Fishing at a reef or alpine site (issue 364): the city game's fishing (web/game/fishing.js: its rules, the cast, the
// wait, the strike, the fight, the log and the panel) driven by the reef viewer's player. Not loaded with the site:
// game.js imports this module the first time you are within sight of a spot or aboard the ship a spot is on, and
// this fetches web/game/fishing.js and the site's fishing.json (pipeline/fishing.py, from cities/<id>/city.json).
//
// What this file adds is only the reef's side of the game's contract (fishing.js create(ctx)):
//  - the player as fishing.js sees it: x east, y north, z up, h its compass heading, on foot; the reef player
//    stands still while a line is out (player.S.hold) and the camera goes over the shoulder;
//  - the ground and the water from the reef's own model (ctx.height, ctx.depth), and the water's height (a tide, a
//    lake's level);
//  - a spot on a ship's deck (the Piopiotahi's after deck): the angler stands at the stern rail while she sails on, the
//    line trolled astern (fishing.js carry());
//  - marine reserves (fishing.json rules.reserves, polygons in the site's metres): no line in one, from the shore or
//    from a deck carried into it (fishing.js closed());
//  - a spot on the shore found at run time: the land nearest the POI with open water in front, and fish rising
//    where the schools hold, a cast out from it.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

function loadScript(src, have = window.OEFishing) {
  if (have) return Promise.resolve();
  return new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error(`${src} did not load`)); document.head.appendChild(el); });
}

export async function init(ctx, game) {
  const { THREE, scene, camera, env, q } = ctx, player = ctx.player, PS = player.S, ui = game.ui;
  const [, , data, { mergeGeometries }] = await Promise.all([
    loadScript(new URL('../game/fishing.js', import.meta.url).href),
    loadScript(new URL('../game/fishart.js', import.meta.url).href, window.OEFishArt),   // (the fish's pictures: the log's portraits and the body on the line)
    fetch(`../data/${ctx.site}/fishing.json`).then(r => { if (!r.ok) throw new Error(`fishing.json: ${r.status}`); return r.json(); }),
    import('three/addons/utils/BufferGeometryUtils.js')]);
  const T3 = Object.assign({}, THREE, { BufferGeometryUtils: { mergeGeometries } });
  const reserves = (data.rules.reserves || []).filter(r => Array.isArray(r.xy) && r.xy.length > 2);
  const reserveAt = (x, y) => reserves.find(r => inPoly(x, y, r.xy)) || null;
  const water = () => env.u.tide.value;
  const isWater = (x, y) => ctx.depth(x, y) > 0.6;

  // ---- the shore spots: the land nearest the POI with 30 m of open water in front, its heading out over the water
  for (const sp of data.spots) {
    if (sp.vessel || !sp.at) continue;
    let best = null;
    for (let r = 0; r <= 60 && !best; r += 4) for (let k = 0; k < (r ? 24 : 1); k++) {
      const a = k / 24 * Math.PI * 2, x = sp.at[0] + Math.sin(a) * r, y = sp.at[1] + Math.cos(a) * r;
      if (isWater(x, y)) continue;
      for (let j = 0; j < 32; j++) {
        const h = j / 32 * Math.PI * 2, sx = Math.sin(h), sy = Math.cos(h);
        let d0 = 0; while (d0 < 8 && !isWater(x + sx * d0, y + sy * d0)) d0 += 0.5;
        if (d0 >= 8) continue;
        let open = true; for (let d = d0; d < d0 + 30; d += 3) if (!isWater(x + sx * d, y + sy * d)) { open = false; break; }
        if (open && (!best || d0 < best.d0)) best = { x: x + sx * Math.max(0, d0 - 2), y: y + sy * Math.max(0, d0 - 2), h, d0 };
      }
    }
    if (best) { sp.at = [best.x, best.y]; sp.h = best.h; } else sp.h = sp.h ?? 0;
    sp.z = ctx.height(sp.at[0], sp.at[1]);
    if (!sp.schools.length) for (let i = 0; i < 3; i++) {   // where the fish hold: a cast out, fanned across the heading
      const a = sp.h + (i - 1) * 0.35, d = 12 + 5 * i, x = sp.at[0] + Math.sin(a) * d, y = sp.at[1] + Math.cos(a) * d;
      if (isWater(x, y)) sp.schools.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    }
  }

  // ---- a deck spot: the stern rail of a named ship, carried with her
  const deck = data.spots.find(sp => sp.vessel) || null;
  const ship = deck && ctx.boats ? ctx.boats.byName(deck.vessel) : null;
  const sternM = new THREE.Vector3();
  let onDeck = false, deckAt = null, lastDeck = null;
  function sternNow() {
    // the after deck's middle, a little in from the taffrail (ship_scow.json: after deck z -17.6 to -13.9, y 2.26)
    const sp = ship.desc.spec || {}, d = (sp.decks || []).find(o => /after/.test(o.name)) || { z0: -17.6, z1: -13.9, y: 2.26 };
    const z = d.z0 + 0.9, y = d.y;
    ship.root.updateMatrixWorld();
    const p = ship.desc.toVessel ? ship.desc.toVessel([0, y, z]) : [0, y, z];
    sternM.set(p[0], p[1], p[2]).applyMatrix4(ship.root.matrixWorld);
    return { x: sternM.x, y: -sternM.z, z: sternM.y, h: ship.hdg + Math.PI };
  }
  // (where the deck spot is before her first frame, or far away if the ship is not on this map)
  if (deck) { if (ship) { const s0 = sternNow(); deck.at = [s0.x, s0.y]; deck.z = s0.z; deck.h = s0.h; } else deck.at = [1e9, 1e9]; deck.schools = deck.schools || []; }
  const riding = () => !!(ship && ctx.controller && ctx.controller.vessel === ship && game.aboard === ship);   // (as her passenger: boats/control.js)

  // ---- the player as fishing.js sees it
  let rig = null;
  const hand = new THREE.Vector3();
  const rigA = {
    set hold(v) { /* (the reef's avatars hold nothing yet: the rod rides the right hand's bone, below) */ },
    fist(out) {
      if (!rig || rig.src !== player.rig) rig = { src: player.rig, bone: player.rig.group.getObjectByName('Bip01_R_Hand') || player.rig.group.getObjectByName('Bip01_R_Forearm') };
      if (!rig.bone || !player.rig.group.visible) return false;
      rig.bone.getWorldPosition(hand); out.copy(hand); return true;
    },
  };
  const P = {
    get x() { return onDeck ? deckAt.x : PS.pos.x; }, get y() { return onDeck ? deckAt.y : -PS.pos.z; }, get z() { return onDeck ? deckAt.z : PS.pos.y; },
    get h() { return PS.bodyYaw; }, set h(v) { PS.bodyYaw = v; if (!onDeck) PS.camYaw += Math.atan2(Math.sin(v - PS.camYaw), Math.cos(v - PS.camYaw)) * 0.02; },
    get mode() { return onDeck ? (riding() ? 'foot' : 'ride') : !game.aboard && !PS.water ? 'foot' : 'ride'; },
    get rig() { return rigA; },
  };
  // the chase camera: fishing.js asks for a yaw to look along, a distance and a pitch; on foot the player's camera
  // takes them, on the deck this module places the eye itself
  const cam = { yawTo: 0, distTo: 4.6, pitch: 0.24, lastInput: 0 };
  // the one button (Space, or the jump button on a phone), held and let go, read here
  const keys = new Set();
  let api = null;
  addEventListener('keydown', e => {
    if (!api || !api.busy()) { if (e.code === 'KeyE' && riding() && api && !onDeck) deckStart(); return; }
    keys.add(e.code);
    if (api.key(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  // a short tone for the bite, the reel and the run (WebAudio, made on the first one)
  let ac = null;
  const A = {
    beep(f) {
      if (q.get('mute') === '1') return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.14);
      } catch (e) { /* no audio */ }
    },
    chime() { A.beep(880); setTimeout(() => A.beep(1320), 120); },
  };
  const H = { toast(html) { const d = document.createElement('div'); d.innerHTML = html; const b = d.querySelector('b'), s = d.querySelector('span'); ui.toast(b ? b.textContent : '', s ? s.textContent : d.textContent); } };
  const stage = ui.el;
  // the panel's tokens (fishing.js's CSS reads the game's): the reef's own glass and type
  stage.style.setProperty('--hud-solid', 'rgba(8, 12, 20, 0.86)'); stage.style.setProperty('--line', 'rgba(236, 232, 225, 0.16)');
  stage.style.setProperty('--ink', '#ece8e1'); stage.style.setProperty('--muted', '#8a93a3'); stage.style.setProperty('--accent', '#ffb066');
  stage.style.setProperty('--f-body', '"Inter Tight", system-ui, sans-serif'); stage.style.setProperty('--f-display', '"Zalando Sans Expanded", system-ui, sans-serif'); stage.style.setProperty('--f-mono', '"JetBrains Mono", ui-monospace, monospace');
  const clock = { m: 1, min: 720 };
  const tick = () => { const l = window.Sun.utcToLocal(ctx.clockMs(), ctx.S.timezone); clock.m = l.m; clock.min = l.minutes; };
  tick();
  let tSec = 0;
  api = window.OEFishing.create({
    THREE: T3, world: scene, player: P, cam, camera, H, A, data, cityId: ctx.site, clock, stage,
    nav: { walk: (x, y) => ({ ok: !isWater(x, y) }), isWater },
    sun: () => ({ altitude: ctx.sun ? ctx.sun.alt * 180 / Math.PI : 30 }),
    rain: () => (window.OEWeather && window.OEWeather.S ? window.OEWeather.S.rain : 0),
    tier: ctx.tier.name, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, touch: matchMedia('(pointer: coarse)').matches,
    key: code => keys.has(code), time: () => tSec, ui: () => !!(game.ui.panelKind || game.G.dialogue()),
    walkTo(x, y, label, then) { player.teleport(x, y, undefined, THREE.MathUtils.radToDeg(Math.atan2(Math.sin(PS.camYaw), Math.cos(PS.camYaw)))); then(); },
    stamp: (what, where) => ui.toast(what, where),
    water, closed: (x, y) => { const r = reserveAt(x, y); return r ? r.why : ''; },
  });

  // ---- the deck
  function deckStart() {
    if (!riding() || api.busy()) return;
    deckAt = lastDeck = sternNow(); onDeck = true;   // (carried from here: a ship moved on, or put somewhere by a quest, takes the line with her)
    if (!api.start(deck)) { onDeck = false; return; }
  }
  // what E does, at a shore spot (the player's own prompt) and aboard the ship (the HUD's line)
  const shoreSpots = data.spots.filter(sp => !sp.vessel && sp.at);
  for (const sp of shoreSpots) player.addInteractable({ id: `fish-${sp.id}`, x: sp.at[0], north: sp.at[1], radius: 14, key: 'E',
    enabled: () => !onDeck && !!api.action(), get label() { const a = api.action(); return a ? `E: ${a.text}` : ''; }, action: () => { const a = api.action(); if (a && a.act) a.act(); } });

  const hold0 = { yaw: 0 }, eye = new THREE.Vector3(), look = new THREE.Vector3();
  let wasBusy = false, hudBusy = false;
  function update(dt, t) {
    tSec = t;
    tick();
    // the deck spot follows the ship: where you stand, and the line and float trolled behind her
    if (deck && ship) {
      const s = sternNow();
      deck.at = [s.x, s.y]; deck.z = s.z; deck.h = s.h;
      if (onDeck) {
        if (lastDeck) api.carry(s.x - lastDeck.x, s.y - lastDeck.y);
        deckAt = s; lastDeck = s;
        if (!riding()) { api.stop(true); onDeck = false; }
      } else lastDeck = null;
      if (riding() && game.hud && api.busy() !== hudBusy) { hudBusy = api.busy(); if (hudBusy) game.hud.promptAuto(''); }
      if (riding() && !api.busy() && game.hud) {
        const r = reserveAt(s.x, s.y);
        game.hud.promptAuto(r ? `No fishing: ${r.name}` : 'E: fish from the after deck');
      }
    }
    api.step(dt, 0);
    const busy = api.busy();
    // on foot: the player stands still with a line out, the camera over the shoulder as fishing.js asks
    PS.hold = busy && !onDeck;
    if (busy && !onDeck) {
      PS.camYaw += Math.atan2(Math.sin(cam.yawTo - PS.camYaw), Math.cos(cam.yawTo - PS.camYaw)) * Math.min(1, dt * 3);
      PS.dist += (cam.distTo - PS.dist) * Math.min(1, dt * 3); PS.camPitch += (-cam.pitch - PS.camPitch) * Math.min(1, dt * 3);
    }
    // on the deck: the angler at the stern rail, the eye behind and above the shoulder (after the ship's own camera)
    if (onDeck && busy) {
      const g = player.rig.group;
      g.visible = true; g.position.set(deckAt.x, deckAt.z, -deckAt.y); g.rotation.y = Math.PI - PS.bodyYaw; player.rig.heading = g.rotation.y;
      if (player.rig.update) player.rig.update(dt);
      // (behind the angler is the saloon: the eye stands outboard of her quarter instead, over the water, looking aft
      // across the angler and down the line; the side the fish card asks for, or the starboard quarter)
      const h = deckAt.h, side = cam.yawTo - h > 0.6 ? -1 : 1, ex = h + side * 1.9, d = cam.distTo * 1.6;
      eye.set(deckAt.x + Math.sin(ex) * d, deckAt.z + 2.4 + cam.pitch * 2, -(deckAt.y + Math.cos(ex) * d));
      look.set(deckAt.x + Math.sin(h) * 3, deckAt.z + 0.7, -(deckAt.y + Math.cos(h) * 3));
      camera.position.copy(eye); camera.lookAt(look);
    } else if (wasBusy && onDeck) { onDeck = false; if (player.rig.group && riding()) player.rig.group.visible = false; }
    if (!busy && onDeck) { onDeck = false; if (riding()) player.rig.group.visible = false; }
    wasBusy = busy;
  }
  ctx.updaters.push(update);
  const out = { api, data, clock, update, deckStart, reserveAt, riding, get onDeck() { return onDeck; }, keys, spots: data.spots };
  ctx.fishing = out;
  return out;
}
