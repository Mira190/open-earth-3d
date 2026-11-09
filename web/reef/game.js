// The game layer of the reef viewer, loaded last (after life, boats and player): people at real places, short
// dialogues, quests with a journal and a compass marker, boarding the boats and aircraft, and travel between the
// Queensland reef sites. What happens where is per site: game/<site>.js if it exists, else game/generic.js
// (a ranger at the spawn, the fish survey, the travel map), so a new site is playable the day its data lands.
//
// The rule from the Sydney game holds here: everything a character says about the place is either computed from
// the model while you play (depths, distances, the light left at your depth, the sun, the wind) or carries a cited
// source (game/sources.js); the source shows under the line and the journal keeps it with the note.
//
// Keys: E talk / board / fly (the player's use key; F steps off a boat), 1-4 answer, J journal, T map and travel, K time of day,
// Esc close. Touch: the Journal, Map and Time buttons, tap a line to go on, tap an answer.
// Query: gametest=1 (a scripted run: "[gametest] PASS/FAIL" lines, window.__gametest), gameshot=<scene> (set a scene up
// for a screenshot, see game/test.js), lifestub=1 (a stand-in ctx.life near the spawn), gamesite=<file> (content from
// game/<file>.js instead of the site's own, e.g. generic), gamereset=1 (forget progress). Progress is saved per site in
// localStorage (key oe3d-reef-game-<site>). docs/GAME_REEF.md has the quests and where every fact comes from.
import * as THREE from 'three/webgpu';
import { createUI, esc } from './game/ui.js';
import { createTravel } from './game/travel.js';
import { SOURCES, srcLabel } from './game/sources.js';
import { createMapView } from './game/map.js';
import { waterTemp } from './dive.js';

const RAD = Math.PI / 180;
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// what the use key does next to each kind of vessel, and half the width of the part you climb onto
const BOARD = { tinnie: 'board', yacht: 'board', cat: 'board', daycat: 'board', seaplane: 'fly', helicopter: 'fly' };
const HALF = { tinnie: 1.3, yacht: 1.9, cat: 3.45, daycat: 4.2, seaplane: 1.7, helicopter: 1.4 };
const KIND = { tinnie: 'tinnie', yacht: 'yacht', cat: 'catamaran', daycat: 'day boat', seaplane: 'seaplane', helicopter: 'helicopter' };
const wrap180 = a => ((a % 360) + 540) % 360 - 180;

export async function init(ctx) {
  const { q, env, camera } = ctx, S = ctx.S, player = ctx.player || null, hud = ctx.hud || null;
  const playerCtl = ctx.controller;
  const api0 = {};                                         // window.__game, filled in below                       // the player's own controller: any other one means aboard (or free-fly)
  if (q.get('lifestub') === '1' && !ctx.life) { try { ctx.life = (await import('./game/life_stub.js')).createLifeStub(ctx); } catch (e) { console.warn('game: life stub', e); } }
  const testing = q.get('gametest') === '1' || !!q.get('gameshot');
  const KEY = `oe3d-reef-game-${ctx.site}${testing ? '-test' : ''}`;

  // ------------------------------------------------------------ clock: the model's (main.js ctx.clockMs: ?time= or now, running on)
  const whenMs = q.get('time') ? Date.parse(q.get('time')) : Date.now(), t0 = performance.now();
  const nowMs = ctx.clockMs || (() => whenMs + (performance.now() - t0));
  const tz = S.timezone || 'Australia/Brisbane';
  const fmtTime = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  const fmtHour = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: tz });
  const fmtMonth = new Intl.DateTimeFormat('en-AU', { month: 'long', timeZone: tz });
  const fmtDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });

  // ------------------------------------------------------------ saved progress (this browser, this site)
  const fresh = () => ({ v: 1, q: {}, notes: [], species: {}, signs: {}, track: null, flags: {} });
  let st = fresh();
  try { if (q.get('gamereset') === '1' || testing) localStorage.removeItem(KEY); const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) st = Object.assign(fresh(), s); } catch (_) { /* storage blocked: play without saving */ }
  let saveT = 0;
  const save = () => { saveT = 0; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {} };
  const saveSoon = () => { saveT = 0.4; };

  // ------------------------------------------------------------ geometry in the local frame (x east, north, up)
  const P = player ? player.S.pos : null;                  // three.js position of the player (x, up, -north): read, never written
  const here = () => P ? { x: P.x, north: -P.z, up: P.y } : { x: camera.position.x, north: -camera.position.z, up: camera.position.y };
  const poiCache = new Map();
  const poi = id => {
    if (poiCache.has(id)) return poiCache.get(id);
    const p = ctx.poi(id), o = p ? { id: p.id, x: p.x, north: p.y, name: p.name, kind: p.kind, src: p.src } : null;
    poiCache.set(id, o); return o;
  };
  const dist = (a, b) => Math.hypot(b.x - a.x, b.north - a.north);
  const bearing = (a, b) => (Math.atan2(b.x - a.x, b.north - a.north) / RAD + 360) % 360;
  const dirName = deg => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const dirShort = deg => SHORT[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const km = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
  const slope = (x, n) => Math.hypot(ctx.height(x + 3, n) - ctx.height(x - 3, n), ctx.height(x, n + 3) - ctx.height(x, n - 3)) / 6;
  // nearest point (spiral search) with the ground between minH and maxH above the tide (or above mean sea level with
  // `msl: true`, for people who must stay dry through the tide) and gentle enough to stand on; `toward` breaks ties
  // toward a target, `wet` asks for water at least that deep within 30 m (a beach a boat can reach). With `orNull`
  // it returns null when nothing qualifies (a site with no land), else the starting point
  function landSpot(x, n, o = {}) {
    // an alpine site stands on land at any height, only out of the water (a reef site's land is a beach a little above the tide)
    const ALP = ctx.S.kind === 'alpine';
    const minH = o.minH ?? (ALP ? -1e4 : 0.25), maxH = o.maxH ?? (ALP ? 1e4 : 2.5), maxS = o.maxSlope ?? 0.3, maxR = o.maxR ?? 900, tide = o.msl ? 0 : env.u.tide.value;
    const wetNear = (xx, nn) => { for (let a = 0; a < 6.28; a += 0.52) if (ctx.depth(xx + Math.cos(a) * 30, nn + Math.sin(a) * 30) > o.wet) return true; return false; };
    for (let r = 0; r <= maxR; r += 5) {
      const steps = Math.max(1, Math.round(2 * Math.PI * r / 5));
      let best = null, bs = 1e9;
      for (let k = 0; k < steps; k++) {
        const a = 2 * Math.PI * k / steps, xx = x + r * Math.cos(a), nn = n + r * Math.sin(a), h = ctx.height(xx, nn) - tide;
        if (h < minH || h > maxH || slope(xx, nn) > maxS || (ALP && ctx.depth(xx, nn) > -0.3)) continue;
        if (o.wet && !wetNear(xx, nn)) continue;
        const sc = o.toward ? Math.hypot(o.toward.x - xx, o.toward.north - nn) : 0;
        if (sc < bs) { bs = sc; best = { x: xx, north: nn }; }
      }
      if (best) return best;
    }
    return o.orNull ? null : { x, north: n };
  }
  // can you see b from a? The model's terrain along the line, eyes `eye` m above a, on a curved Earth: heights drop by
  // s^2 / 2R below the observer's horizontal, with R the Earth's radius stretched by standard refraction (k = 0.13)
  const R_EFF = 6371000 / (1 - 0.13), drop = s => s * s / (2 * R_EFF);
  function lineOfSight(a, b, eye = 1.6, bUp = 2) {
    const ha = Math.max(ctx.height(a.x, a.north), env.u.tide.value) + eye, d = dist(a, b), hb = Math.max(ctx.height(b.x, b.north), env.u.tide.value) + bUp - drop(d), n = Math.max(4, Math.ceil(d / 30));
    for (let i = 1; i < n; i++) { const f = i / n, h = Math.max(ctx.height(a.x + (b.x - a.x) * f, a.north + (b.north - a.north) * f), env.u.tide.value) - drop(d * f); if (h > ha + (hb - ha) * f) return false; }
    return true;
  }
  // how far the sea horizon is from eyes `eye` m above the ground at a point (same curved Earth)
  const horizonM = (a, eye = 1.6) => Math.sqrt(2 * R_EFF * Math.max(0.1, Math.max(ctx.height(a.x, a.north), env.u.tide.value) - env.u.tide.value + eye));

  // ------------------------------------------------------------ the model's sun, light and water, for the lines
  const sunNow = () => { const s = ctx.sun || {}; return { alt: (s.alt || 0) / RAD, az: (s.az || 0) / RAD }; };   // the sun the scene is lit by
  // the share of surface light left at `depth`, seen from `path` metres away: the same water column as env.js medium(),
  // light comes down depth * lightPath (the refracted sun's slant) and crosses `path` metres back to the eye
  function light(depth, path = 0) {
    const K = env.u.K.value, m = env.u.lightPath.value, L = depth * m + path;
    return { r: Math.exp(-K.x * L), g: Math.exp(-K.y * L), b: Math.exp(-K.z * L), K: { r: K.x, g: K.y, b: K.z }, m,
      halfR: Math.LN2 / (K.x * m), tenthR: Math.LN10 / (K.x * m), halfB: Math.LN2 / (K.z * m) };
  }
  const localHour = () => +fmtHour.format(new Date(nowMs()));
  const greet = () => { const h = localHour(); return h < 5 ? 'Evening' : h < 12 ? 'Morning' : h < 18 ? 'G\'day' : 'Evening'; };
  // the moon as the viewer draws it (env.js setSun): it trails the sun's hour angle by its age; the next moonrise after `t`
  const SYN = 29.530588, moonAge = t => (((t / 864e5 + 2440587.5 - 2451550.1) / SYN) % 1 + 1) % 1;
  const moonAlt = t => window.Sun.position(t - moonAge(t) * 864e5, S.origin[1], S.origin[0]).altitude;
  function moonrise(t) { let prev = moonAlt(t); for (let k = 1; k <= 16 * 12; k++) { const a = moonAlt(t + k * 3e5); if (prev < 0 && a >= 0) return t + k * 3e5; prev = a; } return null; }
  function sunset() { const l = window.Sun.utcToLocal(nowMs()), d = window.Sun.dayLimits(l.y, l.m, l.d); return { set: window.Sun.localToUtc(l.y, l.m, l.d, d.sunset), rise: window.Sun.localToUtc(l.y, l.m, l.d, d.sunrise) }; }
  // go to another time: progress is saved and the viewer reloads with ?time=, so the sun, moon, tide and clock all agree
  function skipTo(utc) { save(); const p = new URLSearchParams(location.search); p.set('time', new Date(utc).toISOString()); location.href = `${location.pathname}?${p}`; }
  // another site's address, at this site's time of day when the clock was set (the time panel), else at now
  function siteAt(id) {
    const href = travel.href(id);
    if (!ctx.clockLive || ctx.clockLive()) return href;
    const u = new URL(href, location.href); u.searchParams.set('time', new Date(nowMs()).toISOString());
    return `${u.pathname}${u.search}`;
  }
  // the tide (main.js ctx.tide, fitted to the gauge predictions) or null; heights are metres about mean sea level
  const tideNow = () => env.u.tide.value;
  function tideTurns(n = 3) { try { return ctx.tide ? ctx.tide.turns(nowMs(), n) : []; } catch (_) { return []; } }

  // ------------------------------------------------------------ the game's HUD and travel
  const travel = createTravel(ctx);
  const ui = createUI({
    choose: i => choose(i), advance: () => advance(), closeDialog: () => closeDialogue(), journal: () => togglePanel('journal'), map: () => togglePanel('map'), time: () => togglePanel('time'), closePanel: () => closePanel(),
    panelAct: (act, arg) => panelAct(act, arg), globe: () => toGlobe()
  });
  const touch = q.get('touch') === '1' || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const FREEZE = { f: 0, r: 0, up: 0, down: 0, run: 0, inflate: 0, deflate: 0 };
  let objT = 0, objBearing = null, objText = '', markTarget = null;   // the tracked step: text, bearing for the compass, 3D marker target
  const gaugeEl = hud && hud.el ? hud.el.querySelector('.rh-gauge') : null;
  let cooldown = 0;                                        // after a dialogue or a boat: the use key that closed it must not reopen it
  const busy = () => cooldown > 0 || !!D || !!ui.panelKind || ctx.controller !== playerCtl;
  function freeze(on) {
    if (!player) return;
    const s = player.S;
    if (on && !s.virt && !s.water) s.virt = FREEZE;        // stand still while reading; afloat you keep drifting as before
    else if (!on && s.virt === FREEZE) s.virt = null;
  }

  // ------------------------------------------------------------ sources and notes
  const sources = Object.assign({}, SOURCES);
  if (ctx.tide) sources['model-tide'] = { title: `Tide: ${ctx.tide.gauge || 'the gauge'} predictions, fitted in tide.json`, model: true, what: `${ctx.tide.source || ''}${ctx.tide.note ? '. ' + ctx.tide.note : ''}` };
  const srcOf = id => sources[id] || (typeof id === 'string' && /^https?:/.test(id) ? { title: id.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), publisher: 'Source', url: id } : null);
  function note(key, text, src, who) {
    if (!text || st.notes.some(n => n.k === key)) return;
    st.notes.push({ k: key, t: text, s: (src || []).filter(Boolean), w: who || '', at: nowMs() }); unread++; ui.badge(unread); saveSoon();
  }
  let unread = 0;

  // ------------------------------------------------------------ quests
  const QUESTS = new Map();
  const qs = id => st.q[id];
  const qdef = id => QUESTS.get(id);
  const stepOf = id => { const s = qs(id), d = qdef(id); return s && d && s.s === 'active' ? d.steps[s.i] : null; };
  const isActive = id => !!(qs(id) && qs(id).s === 'active'), isDone = id => !!(qs(id) && qs(id).s === 'done');
  const txt = (v, ...a) => typeof v === 'function' ? v(G, ...a) : v;
  function start(id) {
    const d = qdef(id); if (!d || qs(id)) return false;
    if (d.available && !d.available(G)) return false;
    st.q[id] = { s: 'active', i: 0, d: {}, at: nowMs() }; st.track = id;
    ui.toast('New quest', d.title);
    const s0 = d.steps[0]; if (s0 && s0.enter) s0.enter(G, st.q[id].d);
    save(); refreshObjective(true);
    return true;
  }
  function advance_(id, to) {
    const s = qs(id), d = qdef(id); if (!s || s.s !== 'active') return;
    s.i = to ?? s.i + 1;
    if (s.i >= d.steps.length) return complete(id);
    const step = d.steps[s.i]; if (step.enter) step.enter(G, s.d);
    ui.toast(d.title, txt(step.text, s.d)); save(); refreshObjective(true);
  }
  function complete(id) {
    const s = qs(id), d = qdef(id); if (!s || s.s === 'done') return;
    s.s = 'done'; s.done = nowMs();
    ui.toast('Quest complete', d.title);
    if (d.onDone) d.onDone(G, s.d);
    if (st.track === id) st.track = [...QUESTS.keys()].find(k => isActive(k)) || null;
    save(); refreshObjective(true);
  }
  // a quest target: { x, north, name } | 'poi-id' | 'npc:<id>' | a function of (G, data) returning one of those
  function resolveTarget(t, d) {
    if (typeof t === 'function') t = t(G, d);
    if (!t) return null;
    if (typeof t === 'string') {
      if (t.startsWith('npc:')) { const r = NPCS.get(t.slice(4)); return r ? { x: r.npc.group.position.x, north: -r.npc.group.position.z, name: r.def.name, npc: r } : null; }
      if (t.startsWith('sign:')) { const sg = SIGNS.get(t.slice(5)); return sg ? { x: sg.x, north: sg.north, name: sg.title } : null; }
      return poi(t);
    }
    return t;
  }

  // player.addInteractable() copies its argument with Object.assign, which freezes getters at their first value; ours
  // move (a boat's hull, an NPC on deck, the nearest animal), so they go into the player's list as they are
  const addIt = o => { if (!player) return o; o.key = o.key || 'E'; o.radius = o.radius ?? 2.4; player.interactables.push(o); return o; };

  // ------------------------------------------------------------ people
  const NPCS = new Map(), NPC_LIST = [];                  // the list is what the frame loop walks (no iterator per frame)
  const NPC_CLEAR = 0.6;                                  // the gap a person on the ground keeps from a sign, the kit, another person
  const tmpV = new THREE.Vector3();
  function spawnNpc(def) {
    if (!player || !ctx.spawnPerson) return null;
    let at;
    try { at = def.at(G); } catch (e) { console.warn('game: npc', def.id, e); return null; }
    if (!at) return null;
    const onBoat = !!at.vessel;
    // a person on the ground stands clear of the signs, the kit and the people already placed (never inside a board)
    if (!onBoat && !at.swim && at.up === undefined && player && player.clearance && player.clearance(at.x, at.north).gap < 0.3 + NPC_CLEAR) {
      const [x, north] = player.pushOut(at.x, at.north, ctx.height(at.x, at.north), 0.3 + NPC_CLEAR);
      at = Object.assign({}, at, { x, north });
    }
    const npc = ctx.spawnPerson(def.role, { x: onBoat ? at.vessel.x : at.x, north: onBoat ? -at.vessel.z : at.north, up: at.up, heading: at.heading ?? 0, gender: def.gender, name: def.name, look: def.look, animation: def.animation || 'Idle', timeOffset: Math.random() * 2 });
    const rec = { def, npc, vessel: at.vessel || null, local: at.local ? new THREE.Vector3(...at.local) : null, home: at, idleT: 0, swim: !!at.swim, depth: at.depth ?? 0 };
    NPCS.set(def.id, rec); NPC_LIST.push(rec);
    // solid where they stand on the ground (on a vessel or in the water they move with it, and you swim past)
    if (!onBoat && !at.swim && player && player.colliders) {
      const hp = npc.group.position;
      player.colliders.push(rec.collider = { id: 'npc:' + def.id, x: hp.x, north: -hp.z, r: 0.32, y0: 0, y1: 0, on: () => !rec.hidden && npc.group.visible && !!npc.group.parent,
        sync() { this.x = hp.x; this.north = -hp.z; this.y0 = hp.y - 0.3; this.y1 = hp.y + 1.9; } });
    }
    if (onBoat) { followVessel(rec); npc.ready.then(() => faceThePlayer(rec)); }
    if (at.swim) npc.ready.then(() => swimPose(rec));
    if (def.talk !== false) rec.it = addIt({ npcId: def.id, get x() { return npc.group.position.x; }, get north() { return -npc.group.position.z; },
      radius: def.radius ?? (onBoat ? 7 : 2.8), label: def.label || `E: talk to ${def.name}${def.title ? ` (${def.title.toLowerCase()})` : ''}`,
      enabled: () => !busy() && !!npc.rig && !rec.hidden, action: () => talk(rec) });
    return rec;
  }
  // an NPC standing on a vessel rides it: the vessel's pose times the spot on deck
  function followVessel(rec) {
    const v = rec.vessel, h = rec.npc.group;
    v.root.updateMatrix();
    tmpV.copy(rec.local).applyMatrix4(v.root.matrix);
    h.position.copy(tmpV); h.quaternion.copy(v.root.quaternion);
  }
  function swimPose(rec) { const r = rec.npc.rig; if (!r) return; r.proc.mode = 'snorkel'; r.setSwim(1, { pitch: 0, amp: 0.35, fin: 1.5 }); }
  // turn to face the player; on a boat the turn is relative to the deck
  function faceThePlayer(rec) {
    const r = rec.npc.rig; if (!r || !P) return;
    const g = rec.npc.group.position, yaw = Math.atan2(P.x - g.x, P.z - g.z);
    if (rec.vessel) { r.targetHeading = yaw - (Math.PI / 2 - rec.vessel.hdg); }
    else r.faceTowards(P);
  }
  function hideNpc(rec, on) { if (!rec) return; rec.hidden = on; rec.npc.group.visible = !on; }

  // ------------------------------------------------------------ interpretive signs
  const SIGNS = new Map();
  const signMat = { wood: new THREE.MeshStandardNodeMaterial({ color: 0x5b4632, roughness: 0.9 }), board: new THREE.MeshStandardNodeMaterial({ color: 0x2f4a3a, roughness: 0.8 }), face: new THREE.MeshStandardNodeMaterial({ color: 0xd9cfae, roughness: 0.85 }) };
  function addSign(def) {
    let at; try { at = def.at(G); } catch (e) { console.warn('game: sign', def.id, e); return null; }
    if (!at) return null;
    const g = new THREE.Group(), h = ctx.height(at.x, at.north);
    for (const sx of [-0.45, 0.45]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.08), signMat.wood); p.position.set(sx, 0.65, 0); g.add(p); }
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.06), signMat.board); b.position.set(0, 1.15, 0); b.rotation.x = -0.35; g.add(b);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.6), signMat.face); f.position.z = 0.032; b.add(f);   // the face, on the board's front
    g.position.set(at.x, h, -at.north); g.rotation.y = -(at.heading ?? 0) * RAD + Math.PI;
    ctx.scene.add(g);
    const sg = { def, x: at.x, north: at.north, title: def.title, group: g };
    // solid: a box round the board and its posts (the board's width runs along the group's own x)
    if (player && player.colliders) { const th = g.rotation.y; player.colliders.push(sg.collider = { id: 'sign:' + def.id, x: at.x, north: at.north, ux: Math.cos(th), un: Math.sin(th), hu: 0.64, hv: 0.18, y0: h - 0.3, y1: h + 1.6 }); }
    SIGNS.set(def.id, sg);
    if (player) sg.it = addIt({ signId: def.id, x: at.x, north: at.north, radius: def.radius ?? 3.5, label: 'E: read the sign', enabled: () => !busy(), action: () => readSign(sg) });
    return sg;
  }
  // the start: a site's spawn is often the POI its sign or its first person is put up at. Once they stand, a player still
  // at the spawn moves to the nearest spot a step clear of all of them (behind the spawn first, so what stood on it is
  // in view), on ground as dry and as gentle as the spawn's, facing the same way; G.spawn() is that spot from then on
  function clearSpawn() {
    if (!player || !player.clearance) return;
    const s0 = G.spawn(), p = player.position, PS = player.S, CLEAR = 1.0;
    if (Math.hypot(p.x - s0.x, -p.z - s0.north) > 0.6 || PS.water || PS.onDeck || (S.spawn && S.spawn.deck)) return;
    if (player.clearance(s0.x, s0.north).gap >= CLEAR) return;
    const dep0 = ctx.depth(s0.x, s0.north), back = (s0.heading + 180) * RAD, ALP = S.kind === 'alpine';
    for (let r = 0.5; r <= 14; r += 0.5) {
      const n = Math.max(6, Math.round(2 * Math.PI * r / 0.5));
      let best = null, bs = -2;
      for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n, x = s0.x + r * Math.sin(a), north = s0.north + r * Math.cos(a);
        if (player.clearance(x, north).gap < CLEAR || slope(x, north) > 0.35) continue;
        if (ALP ? ctx.depth(x, north) > -0.3 : ctx.depth(x, north) > Math.max(dep0, -0.2) + 0.05) continue;
        const sc = Math.cos(a - back);
        if (sc > bs) { bs = sc; best = { x, north }; }
      }
      if (best) { spawnAt = { x: best.x, north: best.north, heading: s0.heading }; player.teleport(best.x, best.north, undefined, s0.heading); return; }
    }
  }
  function readSign(sg) {
    if (!st.signs[sg.def.id]) { st.signs[sg.def.id] = nowMs(); emit('sign', sg.def.id); save(); }
    openDialogue({ name: sg.title, role: 'Interpretive sign', id: 'sign:' + sg.def.id }, sg.def.nodes, sg.def.start || 'read');
  }

  // ------------------------------------------------------------ dialogue
  // A node: { say: string | fn | [page...] (a page is a string or { t, src }), src: [ids], do(G), next: id,
  // choices: [{ text, go: id | fn | 'end', do(G), when(G) }] }. Pages with a source are noted in the journal.
  let D = null;
  function talk(rec) {
    if (D) return;
    faceThePlayer(rec); if (rec.npc.rig && !rec.swim) { rec.npc.wave(); rec.idleT = 2.4; }
    emit('talk', rec.def.id);
    let startId = typeof rec.def.start === 'function' ? rec.def.start(G) : rec.def.start || 'hello';
    // a quest step that waits on talking to this person opens their dialogue at its node
    for (const [id, s] of Object.entries(st.q)) {
      const step = s.s === 'active' && qdef(id) ? qdef(id).steps[s.i] : null;
      if (step && step.talkTo === rec.def.id) { if (step.node) startId = step.node; advance_(id); break; }
    }
    openDialogue({ name: rec.def.name, role: rec.def.title || '', id: rec.def.id, rec }, rec.def.nodes, startId);
  }
  function openDialogue(who, nodes, id) {
    D = { who, nodes, node: null, id: null, pages: [], page: 0, choices: [] };
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    if (hud) { hud.hint('', 0); hud.say('', 0.01); }
    freeze(true);
    show(id);
  }
  function show(id) {
    if (!D) return;
    const node = D.nodes[id];
    if (!node || id === 'end') return closeDialogue();
    D.node = node; D.id = id;
    if (node.do) node.do(G);
    if (!D || D.node !== node) return;                     // the node's action moved on (a transfer, another node)
    let pages = txt(node.say);
    pages = (Array.isArray(pages) ? pages : [pages]).map(p => typeof p === 'function' ? p(G) : p).filter(Boolean).map(p => typeof p === 'string' ? { t: p, src: node.src } : { t: p.t, src: p.src || node.src, note: p.note });
    D.pages = pages.length ? pages : [{ t: '…', src: null }]; D.page = 0;
    D.choices = (node.choices || []).filter(c => !c.when || c.when(G));
    render();
  }
  function render() {
    const p = D.pages[D.page], last = D.page === D.pages.length - 1;
    const src = (p.src || []).map(srcOf).filter(Boolean);
    if (src.length && p.note !== false) note(`${D.who.id}:${D.id}:${D.page}`, p.t, p.src, D.who.name);   // note: false for lines that only tell the time
    ui.dialog({ name: D.who.name, role: D.who.role, aside: D.pages.length > 1 ? `${D.page + 1}/${D.pages.length}` : '', text: p.t,
      src: src.map(s => ({ label: srcLabel(s), url: s.url })), choices: last ? D.choices.map(c => txt(c.text)) : [],
      more: !last ? 'E, Enter or tap: go on' : D.choices.length ? '' : 'E, Enter or tap: close' });
    if (hud && !touch) hud.prompt(last && D.choices.length ? `1-${Math.min(D.choices.length, 9)}: answer` : 'E: go on');   // on a phone you tap the panel
  }
  function advance() {
    if (!D) return;
    if (D.page < D.pages.length - 1) { D.page++; return render(); }
    if (D.choices.length) return;
    if (D.node.next) return show(txt(D.node.next));
    closeDialogue();
  }
  function choose(i) {
    if (!D || D.page < D.pages.length - 1) return;
    const c = D.choices[i]; if (!c) return;
    if (c.do) c.do(G);
    const go = typeof c.go === 'function' ? c.go(G) : c.go;
    if (D && go && go !== 'end') show(go); else closeDialogue();
  }
  function closeDialogue() {
    if (!D) return;
    const rec = D.who.rec; D = null;
    ui.dialog(null); if (hud) hud.prompt('');
    cooldown = 0.35; freeze(!!ui.panelKind);
    if (rec && rec.npc.rig && !rec.swim) rec.npc.play('Idle', { fade: 0.4 });
    refreshObjective(true);
  }

  // ------------------------------------------------------------ boarding the boats and aircraft
  const boats = ctx.boats || null;
  const board = { v: null, label: '', x: 0, north: 0 }, noBoard = new Set();
  let aboard = null, edgeAsked = false;
  const rider = {                                          // the `player` argument of boats.board(): control.js hides .group and calls these
    boarded: null,
    get group() { return player ? player.rig.group : null; },
    onBoard(v) { aboard = v; if (hud) { hud.promptAuto(''); hud.hint('', 0); } emit('board', v); },
    onLeave(v) { aboard = null; putBeside(v); cooldown = 0.7; emit('leave', v); }
  };
  if (player && boats) board.it = addIt({ boardIt: true, get x() { return board.x; }, get north() { return board.north; }, radius: 3.4, get label() { return board.label; },
    enabled: () => !!board.v && !busy(), action: () => boardVessel(board.v) });
  function scanBoard() {
    board.v = null;
    if (!boats || !P || player.S.depthBody > 1.2) return;
    const px = P.x, pn = -P.z;
    let best = null, bd = 3.2, bx = 0, bn = 0;
    for (const v of boats.vessels) {
      if (!BOARD[v.kind] || v.mode === 'orbit' || v.mode === 'player' || Math.abs(v.speed) > 1.5 || noBoard.has(v)) continue;
      const cx = v.x, cn = -v.z; if (Math.abs(cx - px) > 40 || Math.abs(cn - pn) > 40) continue;
      // nearest point on the keel line, then out to the side of the hull
      const fx = Math.sin(v.hdg), fn = Math.cos(v.hdg), halfL = v.desc.L * 0.45;
      const t = Math.max(-halfL, Math.min(halfL, (px - cx) * fx + (pn - cn) * fn));
      const kx = cx + fx * t, kn = cn + fn * t, dk = Math.hypot(px - kx, pn - kn), half = HALF[v.kind] ?? v.desc.B / 2, d = dk - half;
      // the prompt sits on the hull's side nearest the player, so the interactable's radius is the reach from the hull
      if (d < bd) { bd = d; best = v; const k = dk > 1e-3 ? Math.min(half, dk) / dk : 0; bx = kx + (px - kx) * k; bn = kn + (pn - kn) * k; }
    }
    if (!best) return;
    board.v = best; board.x = bx; board.north = bn;
    const lbl = `E: ${BOARD[best.kind]} ${best.kind === 'helicopter' || best.kind === 'seaplane' ? 'the ' : ''}${best.name}${best.kind === 'helicopter' || best.kind === 'seaplane' ? '' : ` (${KIND[best.kind]})`}`;
    if (lbl !== board.label) board.label = lbl;
  }
  function boardVessel(v) {
    if (!boats || !v) return false;
    const r = boats.board(v, rider);
    if (r) { board.v = null; edgeAsked = false; }
    return !!r;
  }
  // step off: beside the hull, in the water or on the ground, facing the vessel; else the nearest beach
  function putBeside(v) {
    if (!player) return;
    const half = HALF[v.kind] ?? v.desc.B / 2, cx = v.x, cn = -v.z, fx = Math.sin(v.hdg), fn = Math.cos(v.hdg), sx = Math.cos(v.hdg), sn = -Math.sin(v.hdg);
    let spot = null;
    outer: for (const r of [half + 1.5, half + 3, half + 6, half + 10]) for (const along of [0, -0.25, 0.25]) for (const side of [1, -1]) {
      const x = cx + sx * side * r + fx * along * v.desc.L, n = cn + sn * side * r + fn * along * v.desc.L, dep = ctx.depth(x, n);
      if (dep >= 1.5 || (dep < 1.0 && slope(x, n) < 0.6)) { spot = { x, north: n }; break outer; }
    }
    if (!spot) spot = landSpot(cx, cn, { maxR: 2500 });
    player.teleport(spot.x, spot.north, undefined, bearing(spot, { x: cx, north: cn }));
  }

  // ------------------------------------------------------------ the fish ID survey: log species you get close to
  const life = () => ctx.life || null;
  const speciesList = () => { const L = life(); return L && Array.isArray(L.species) ? L.species : []; };
  const speciesById = id => speciesList().find(s => s.id === id) || null;
  const surv = { sp: null, label: '', x: 0, north: 0 };
  if (player) surv.it = addIt({ surveyIt: true, get x() { return surv.x; }, get north() { return surv.north; }, radius: 7, get label() { return surv.label; },
    enabled: () => !!surv.sp && !busy(), action: () => logSpecies(surv.sp) });
  function scanSurvey() {
    surv.sp = null;
    const L = life(); if (!L || typeof L.nearestCreature !== 'function' || !P || !player.S.water || !player.S.gear.mask) return;
    let r = null; try { r = L.nearestCreature(P.x, -P.z, P.y, 6); } catch (e) { return; }
    if (!r) return;
    const sp = typeof r.species === 'string' ? speciesById(r.species) : r.species;
    if (!sp || st.species[sp.id]) return;
    const p = r.position || null;
    if (p && p.north !== undefined) { surv.x = p.x; surv.north = p.north; }
    else if (p && p.isVector3) { surv.x = p.x; surv.north = -p.z; }
    else if (Array.isArray(p)) { surv.x = p[0]; surv.north = p[1]; }
    else { surv.x = P.x; surv.north = -P.z; }
    surv.sp = sp;
    const lbl = `E: log the ${sp.common} for the survey`;
    if (lbl !== surv.label) surv.label = lbl;
  }
  function logSpecies(sp) {
    if (!sp || st.species[sp.id]) return;
    st.species[sp.id] = { at: nowMs(), depth: +(player ? player.depth : 0).toFixed(1) };
    const f = (sp.facts || [])[0];
    if (hud) hud.say(`Logged: ${sp.common}${sp.scientific ? ` (${sp.scientific})` : ''}.${f ? ' ' + f.text : ''}`, { kind: 'good', secs: 7 });
    if (f) note(`species:${sp.id}`, `${sp.common}: ${f.text}`, [f.source || 'model-life'], 'Survey');
    surv.sp = null; emit('species', sp.id); save();
  }

  // ------------------------------------------------------------ transfers: skip-the-trip boat runs between beaches
  async function transfer(to, title, sub, o = {}) {
    if (!player) return;
    const go = () => {
      if (o.equip) player.equip(o.equip);
      player.teleport(to.x, to.north, to.up, to.heading ?? (to.face ? bearing(to, to.face) : undefined));
      emit('transfer', to);
    };
    closeDialogue();
    if (o.instant || testing) return go();
    await ui.fade(title, sub, go);
  }

  // ------------------------------------------------------------ events, for steps that wait on something
  const listeners = [];
  function emit(ev, arg) {
    for (const [id, s] of Object.entries(st.q)) {
      if (s.s !== 'active') continue;
      const step = qdef(id) && qdef(id).steps[s.i];
      if (step && step.on && step.on[ev]) { try { if (step.on[ev](G, s.d, arg)) advance_(id); } catch (e) { console.warn('game: step', id, e); } }
    }
    for (const l of listeners) l(ev, arg);
  }

  // ------------------------------------------------------------ the public game API (site files and tests use it)
  let spawnAt = null;                                     // the start, once moved clear of the signs and people put up round it
  const G = {
    ctx, THREE, S, env, player, hud, ui, travel, st: () => st, sources, srcOf,
    here, poi, dist, bearing, dirName, dirShort, km, landSpot, lineOfSight, horizonM, slope, height: (x, n) => ctx.height(x, n), depth: (x, n) => ctx.depth(x, n),
    spawn: () => { if (spawnAt) return Object.assign({}, spawnAt); const s = S.spawn || {}, t = S.start || {}; return { x: s.x ?? t.x ?? 0, north: s.y ?? t.y ?? 0, heading: s.heading ?? 0 }; },
    // "2.6 km south-east"
    where(t, from) { const p = resolveTarget(t); if (!p) return ''; const a = from || here(); return `${km(dist(a, p))} ${dirName(bearing(a, p))}`; },
    nowMs, skipTo, sunNow, sunset, moonrise, moonAlt, light, greet, localHour, tide: () => ctx.tide || null, tideNow, tideTurns,
    clock: () => fmtTime.format(new Date(nowMs())).replace(/\s/g, '\u00a0'), time: ms => fmtTime.format(new Date(ms)).replace(/\s/g, '\u00a0'),
    month: () => fmtMonth.format(new Date(nowMs())), monthIndex: () => new Date(nowMs() + window.Sun.offsetHours(nowMs(), tz) * 3600e3).getUTCMonth(),
    when: ms => fmtDate.format(new Date(ms)),
    waterTemp: depth => waterTemp(new Date(nowMs()), depth || 0),
    wind() { const w = boats && boats.windInfo; return w && w.speed ? { kn: w.speed * 1.944, from: ((w.from / RAD) % 360 + 360) % 360 } : null; },
    vessels: () => boats ? boats.vessels : [], boats, aboard: () => aboard, boardVessel, putBeside, goTo, noBoard: v => noBoard.add(v),
    life, species: speciesList, speciesById, logged: () => Object.keys(st.species).length, logSpecies,
    // quests
    quest: qdef, state: qs, start, advance: advance_, complete, isActive, isDone, stepIndex: id => qs(id) ? qs(id).i : -1, data: id => qs(id) ? qs(id).d : null,
    track(id) { st.track = id; save(); refreshObjective(true); },
    flag(k, v) { if (v === undefined) return st.flags[k]; st.flags[k] = v; saveSoon(); return v; },
    note, emit, on(fn) { listeners.push(fn); },
    // people, signs, talk
    npc: id => NPCS.get(id) || null, npcIds: () => [...NPCS.keys()], sign: id => SIGNS.get(id) || null, spawnNpc, hideNpc, followVessel, swimPose,
    talk: id => { const r = NPCS.get(id); if (r) talk(r); return !!r; }, openDialogue, show, choose, advance, closeDialogue, dialogue: () => D,
    readSign: id => { const s = SIGNS.get(id); if (s) readSign(s); return !!s; },
    transfer, say: (t, o) => hud && hud.say(t, o),
    openPanel: k => openPanel(k), closePanel: () => closePanel(), save, update: (dt) => update(dt), esc
  };

  // ------------------------------------------------------------ the site's content
  let siteMod = null;
  const siteName = (q.get('gamesite') || ctx.site || 'generic').replace(/[^a-z0-9-]/gi, '');   // ?gamesite=generic tries the fallback anywhere
  try { siteMod = await import(`./game/${siteName}.js`); }
  catch (e) { if (!/Failed to fetch|Cannot find|404|Unexpected token|error loading dynamically imported/i.test(String(e))) console.error('game: site file', e); }
  if (!siteMod) siteMod = await import('./game/generic.js');
  const content = siteMod.default(G);
  Object.assign(sources, content.sources || {});
  for (const qd of content.quests || []) QUESTS.set(qd.id, qd);
  // forget saved quests the site no longer has
  for (const id of Object.keys(st.q)) if (!QUESTS.has(id)) delete st.q[id];
  for (const sd of content.signs || []) addSign(sd);
  for (const nd of content.npcs || []) spawnNpc(nd);
  clearSpawn();
  if (content.start) content.start(G);
  G.content = content;

  // ------------------------------------------------------------ journal and map panels
  let mapView = null;                                       // the map panel's map (game/map.js), while it is open
  const dropMap = () => { if (mapView) { mapView.destroy(); mapView = null; } };
  function openPanel(kind) {
    if (D) closeDialogue();
    dropMap();
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    if (kind === 'journal') { unread = 0; ui.badge(0); ui.panel('journal', 'Journal', `${S.name || ctx.site} · ${G.clock()}`, journalHtml()); }
    else if (kind === 'time') {
      ui.panel('time', 'Time of day', `${S.name || ctx.site} · ${fmtDay.format(new Date(nowMs()))}`, timeHtml());
      const r = ui.el.querySelector('.rg-time input');
      if (r) {
        r.addEventListener('input', () => { const d = timeDay; ctx.setClock(window.Sun.localToUtc(d.y, d.m, d.d, +r.value)); timeReadout(); });
        r.addEventListener('change', () => r.blur());   // give the keys (K, Esc, WASD) back once the drag ends
      }
    }
    else {
      ui.panel('map', 'Map', `${S.name || ctx.site} · ${G.clock()}`, '');
      mapView = createMapView({ host: ui.el.querySelector('.rg-panel .body'), G, travel, site: { id: ctx.site, name: S.name || ctx.site }, places: mapPlaces, marks: mapMarks,
        me: () => Object.assign(here(), { heading: heading() }), go: goTo, travelTo: id => panelAct('travel', id), touch: matchMedia('(pointer: coarse)').matches });
    }
    freeze(true);
  }
  function closePanel() { dropMap(); ui.panel(null); freeze(!!D); }
  function togglePanel(kind) { if (ui.panelKind === kind) closePanel(); else openPanel(kind); }
  function toGlobe() { save(); location.href = travel.globeHref(); }
  function panelAct(act, arg) {
    if (act === 'track') { G.track(arg); openPanel('journal'); }
    else if (act === 'travel') { const s = (travel.list || []).find(x => x.id === arg); if (s && s.ready && !s.current) { save(); location.href = siteAt(arg); } }
    else if (act === 'goto') goTo(arg);
    else if (act === 'time') setTime(arg);
    else if (act === 'globe') toGlobe();
    else if (act === 'intro') { closePanel(); startTour(); }
    else if (act === 'reset') { if (confirm('Forget all progress on this site?')) { st = fresh(); save(); for (const r of NPCS.values()) hideNpc(r, false); openPanel('journal'); refreshObjective(true); } }
  }
  const srcHtml = ids => (ids || []).map(srcOf).filter(Boolean).map(s => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(srcLabel(s))}</a>` : esc(srcLabel(s))).join(' · ');
  function journalHtml() {
    const ids = [...QUESTS.keys()].filter(id => { const d = qdef(id); return qs(id) || !d.hidden || (d.available && d.available(G)); });
    const act = ids.filter(isActive), done = ids.filter(isDone), open = ids.filter(id => !qs(id) && !qdef(id).hidden);
    const qItem = (id, cls) => {
      const d = qdef(id), s = qs(id), step = stepOf(id), tgt = step && step.target ? resolveTarget(step.target, s.d) : null;
      const av = !d.available || d.available(G);
      return `<li class="${cls}${st.track === id ? ' track' : ''}${!av && !s ? ' off' : ''}"><div class="row"><b>${esc(d.title)}</b>${s && s.s === 'active' ? `<span class="st">step ${s.i + 1}/${d.steps.length}</span>` : s ? '<span class="st">done ✓</span>' : ''}
        ${s && s.s === 'active' && st.track !== id ? `<button class="act" data-act="track" data-arg="${esc(id)}">Track</button>` : '<span></span>'}</div>
        <p>${esc(s && s.s === 'active' ? txt(step.text, s.d) : s ? txt(d.summary) : (av ? txt(d.hint || d.summary) : txt(d.unavailable || d.summary)))}</p>
        ${tgt ? `<small>◆ ${esc(tgt.name || 'Target')}: ${esc(G.where(tgt))}</small>` : ''}${s && s.s === 'done' && s.done ? `<small>${esc(G.when(s.done))}</small>` : ''}</li>`;
    };
    const sp = speciesList(), logged = Object.keys(st.species);
    const L = life();
    let html = '<h3>Quests</h3><ul>' + (act.map(id => qItem(id, '')).join('') + done.map(id => qItem(id, 'done')).join('') + open.map(id => qItem(id, 'todo')).join('') || '<li class="empty">Talk to people to find things to do.</li>') + '</ul>';
    html += `<h3>Fish ID survey · ${logged.length} logged</h3>`;
    if (!L) html += '<div class="empty">Marine life is not in this build of the model, so there is nothing to survey yet.</div>';
    else html += '<ul>' + (logged.length ? logged.map(id => { const s = speciesById(id) || { common: id }, e = st.species[id], f = (s.facts || [])[0];
      return `<li><div class="row"><b>${esc(s.common)}</b>${s.scientific ? `<i>${esc(s.scientific)}</i>` : ''}<span class="tag">${esc(s.group || '')}</span></div>${f ? `<p class="note">${esc(f.text)}</p><small class="cite">${srcHtml([f.source])}</small>` : ''}<small>logged ${esc(G.when(e.at))} at ${e.depth} m</small></li>`; }).join('')
      : `<li class="empty">Mask on, get within a few metres of an animal and press E. ${sp.length} species live in this model.</li>`) + '</ul>';
    html += `<h3>Field notes · ${st.notes.length}</h3><ul>` + (st.notes.slice().reverse().map(n => `<li><p class="note">${esc(n.t)}</p><small class="cite">${n.w ? esc(n.w) + ' · ' : ''}${srcHtml(n.s)}</small></li>`).join('') || '<li class="empty">What people tell you is kept here, with where it comes from.</li>') + '</ul>';
    const used = [...new Set(st.notes.flatMap(n => n.s))].map(srcOf).filter(Boolean);
    if (used.length) html += '<h3>Sources</h3><ul>' + used.map(s => `<li><small>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}: ${esc(s.title)}</a> · checked ${esc(s.checked || '')}` : `<b>Computed in the model:</b> ${esc(s.title)}. ${esc(s.what || '')}`}</small></li>`).join('') + '</ul>';
    html += `<div class="foot"><span>Saved in this browser · keys: J journal · T map · K time · 1-4 answer</span><span><button class="act" data-act="intro">Show the intro again</button> <button class="act" data-act="reset">Reset progress</button></span></div>`;
    return html;
  }
  // the time of day: sun.js's presets for the clock's date (sunrise, golden hour, sunset, blue hour, night ...) and a
  // slider over the whole of that day. The clock runs on in real time from what you choose (main.js setClock)
  let timeDay = null;                                    // the local date the panel works on
  const fmtDay = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const fmtHM = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  const presetsOf = d => window.Sun.PRESETS.map(([k, label]) => ({ k, label, ms: window.Sun.localToUtc(d.y, d.m, d.d, window.Sun.presetTime(k, d.y, d.m, d.d)) }));
  function sunLine() {
    const a = sunNow().alt;
    return a >= 0.5 ? `sun ${Math.round(a)}° up` : a > -0.5 ? 'sun on the horizon' : `sun ${Math.round(-a)}° below the horizon`;
  }
  function timeHtml() {
    const Sun = window.Sun, d = timeDay = Sun.utcToLocal(nowMs(), tz), L = Sun.dayLimits(d.y, d.m, d.d), t = nowMs();
    const pre = presetsOf(d).map(p => `<button data-act="time" data-arg="${p.k}"${Math.abs(p.ms - t) < 6e5 ? ' class="on"' : ''}>${esc(p.label)}<small>${esc(fmtHM.format(new Date(p.ms)))}</small></button>`).join('');
    const pc = m => (m / 1440 * 100).toFixed(2);
    return `<div class="rg-time"><div class="now"><b>${esc(fmtHM.format(new Date(t)))}</b><small>${esc(fmtDay.format(new Date(t)))} · ${esc(sunLine())}</small></div>
      <h3>Go to</h3><div class="pre">${pre}<button data-act="time" data-arg="now">Now<small>${ctx.clockLive && ctx.clockLive() ? 'the clock follows it' : esc(fmtHM.format(new Date()))}</small></button></div>
      <h3>Any time of the day</h3><input type="range" min="0" max="1439" step="1" value="${Math.round(d.minutes)}" aria-label="Time of day, local clock time">
      <div class="day"><i style="left:${pc(L.sunrise)}%;width:${pc(L.sunset - L.sunrise)}%"></i></div>
      <div class="ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <div class="foot"><span>Times are worked out from the sun on this date at ${esc(S.name || ctx.site)}. The sun, moon, tide and lamps follow at once, and the clock runs on in real time from the time you choose. K or Esc to close.</span></div></div>`;
  }
  // after the slider moves: the readout and the highlighted preset, without rebuilding the panel under the pointer
  function timeReadout() {
    const box = ui.el.querySelector('.rg-time'); if (!box) return;
    const t = nowMs();
    box.querySelector('.now b').textContent = fmtHM.format(new Date(t));
    box.querySelector('.now small').textContent = `${fmtDay.format(new Date(t))} · ${sunLine()}`;
    const ps = presetsOf(timeDay);
    box.querySelectorAll('.pre button[data-arg]').forEach(b => { const p = ps.find(x => x.k === b.dataset.arg); b.classList.toggle('on', !!p && Math.abs(p.ms - t) < 6e5); });
  }
  function setTime(kind) {
    if (!ctx.setClock) return;
    if (kind === 'now') ctx.setClock(null);
    else { const p = presetsOf(window.Sun.utcToLocal(nowMs(), tz)).find(x => x.k === kind); if (!p) return; ctx.setClock(p.ms); }
    openPanel('time');
    if (hud) hud.say(`${G.clock()}: ${sunLine()}`, 2.5);
  }

  // the people, signs, aircraft and tracked target on the site map
  function mapMarks() {
    const out = [];                                         // drawn in this order: aircraft and signs under the people
    for (const v of boats ? boats.vessels : []) if ((v.kind === 'helicopter' || v.kind === 'seaplane') && v.mode !== 'orbit') out.push({ x: v.x, north: -v.z, glyph: v.kind === 'helicopter' ? 'H' : 'S', craft: true, fit: false });
    for (const sg of SIGNS.values()) out.push({ x: sg.x, north: sg.north, kind: 'sign', done: !!st.signs[sg.def.id], fit: false });
    for (const r of NPCS.values()) if (!r.hidden && r.it) { const p = r.npc.group.position; out.push({ x: p.x, north: -p.z, label: r.def.name, glyph: r.def.name[0] }); }
    const id = st.track && isActive(st.track) ? st.track : null, step = id && stepOf(id), tgt = step && step.target ? resolveTarget(step.target, qs(id).d) : null;
    if (tgt) out.push({ x: tgt.x, north: tgt.north, kind: 'target', label: tgt.name || '' });
    return out;
  }
  // the named places (OpenStreetMap names in scene.json) the map offers as travel points: a boat run there in a fade,
  // any time you are not aboard something
  const PLACE_KINDS = /^(beach|bay|inlet|lookout|island|peak|marina|reef|pontoon|town|cultural|dive)$/;
  let placeList = null;
  const mapPlaces = () => placeList || (placeList = (S.pois || []).map(p => poi(p.id)).filter(p => p && PLACE_KINDS.test(p.kind)));
  // where a place puts you: in the water over a reef, dive site or pontoon deep enough to swim in, else on dry
  // ground (above the tide, gentle enough to stand on) nearest it, facing it
  function goTo(id) {
    const p = poi(id);
    if (!p || !player) return false;
    if (aboard || ctx.controller !== playerCtl) { if (hud) hud.say('Step off first, then go from the map.', { secs: 4 }); return false; }
    const wet = /^(reef|dive|pontoon)$/.test(p.kind) && ctx.depth(p.x, p.north) >= 1.5;
    const spot = wet ? { x: p.x, north: p.north } : landSpot(p.x, p.north, { maxR: 900, toward: p });
    if (!spot) { if (hud) hud.say(`There is nowhere to stand near ${p.name}.`, { secs: 4 }); return false; }
    const face = dist(spot, p) > 3 ? bearing(spot, p) : undefined;
    closePanel();
    transfer(Object.assign(spot, face !== undefined ? { heading: face } : {}), p.name, wet ? 'In the water over it' : 'A short boat run');
    return true;
  }

  // ------------------------------------------------------------ keys
  addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) return;
    const c = e.code;
    if (c === 'Escape') { if (D) closeDialogue(); else if (ui.panelKind) closePanel(); return; }
    if (D) {
      if (c === 'KeyE' || c === 'Enter' || c === 'NumpadEnter') { if (!e.repeat) advance(); return; }   // not Space: under water it is the fin-up key
      const m = /^(Digit|Numpad)([1-9])$/.exec(c); if (m && !e.repeat) { choose(+m[2] - 1); return; }
    }
    if (c === 'KeyJ' && !e.repeat) togglePanel('journal');
    else if (c === 'KeyT' && !e.repeat) togglePanel('map');
    else if (c === 'KeyK' && !e.repeat) togglePanel('time');
    else if ((c === 'Enter' || c === 'NumpadEnter') && mapView && !e.repeat) mapView.confirm();
  });

  // ------------------------------------------------------------ objective line, compass marker, floating marker
  const markTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.translate(32, 32); g.rotate(Math.PI / 4);
    g.fillStyle = '#ffb066'; g.strokeStyle = '#04060b'; g.lineWidth = 5; g.fillRect(-15, -15, 30, 30); g.strokeRect(-15, -15, 30, 30); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const markMat = new THREE.SpriteNodeMaterial({ map: markTex, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false });
  const marker = new THREE.Sprite(markMat); marker.scale.set(0.035, 0.035, 1); marker.renderOrder = 40; marker.visible = false; marker.frustumCulled = false; ctx.scene.add(marker);
  function refreshObjective(now) {
    if (!now && objT > 0) return; objT = 0.2;
    const id = st.track && isActive(st.track) ? st.track : [...QUESTS.keys()].find(isActive);
    if (!id) { objText = ''; objBearing = null; markTarget = null; return; }
    const s = qs(id), step = qdef(id).steps[s.i], tgt = step.target ? resolveTarget(step.target, s.d) : null;
    const a = here();
    let t = `<small>◆ ${esc(qdef(id).title)}</small><span>${esc(txt(step.text, s.d))}</span>`;
    if (tgt) { const d = dist(a, tgt); objBearing = d > 6 ? bearing(a, tgt) : null; t += `<em>${esc(tgt.name || '')}${tgt.name ? ' · ' : ''}${esc(km(d))} ${dirShort(bearing(a, tgt))}</em>`; markTarget = d > 15 ? tgt : null; }
    else { objBearing = null; markTarget = null; }
    objText = t;
    // under the dive gauge when it shows
    if (gaugeEl) ui.objectiveTop(gaugeEl.classList.contains('on') ? gaugeEl.offsetTop + gaugeEl.offsetHeight + 8 : null);
  }
  const camDir = new THREE.Vector3();
  function heading() {
    if (ctx.controller === playerCtl && player) return player.heading;
    camera.getWorldDirection(camDir); return Math.atan2(camDir.x, -camDir.z) / RAD;
  }

  // ------------------------------------------------------------ per frame
  let slow = 0, mid = 0, hudAcc = 0;
  const hudState = { heading: 0, clockMs: 0, tz, temp: undefined, gauge: null };
  function update(dt) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    if (cooldown > 0) cooldown -= dt;
    if (saveT > 0 && (saveT -= dt) <= 0) save();
    for (let i = 0; i < NPC_LIST.length; i++) {
      const r = NPC_LIST[i];
      if (r.vessel) followVessel(r);
      if (r.swim && r.npc.rig && !r.hidden) { r.npc.rig.proc.phase += dt * 2.2; r.npc.group.position.y = env.u.tide.value - r.depth + Math.sin(r.npc.rig.proc.phase * 0.25) * 0.08; }   // hovering, finning gently
      if (r.idleT > 0 && (r.idleT -= dt) <= 0 && r.npc.rig && D && D.who.rec === r) r.npc.play('Idle', { fade: 0.5 });
    }
    // aboard: the player's controller is not running, so keep the compass, clock and messages alive (10 Hz)
    if (hud && ctx.controller !== playerCtl && ctx.controller) {
      hudAcc += dt;
      if (hudAcc > 0.1) { hudState.heading = heading(); hudState.clockMs = nowMs(); hud.update(hudAcc, hudState); hudAcc = 0; }
    }
    // the compass marker every frame (cheap: numbers only, DOM written when the pixel changes)
    objT -= dt;
    refreshObjective(false);
    ui.objective(objText, objBearing === null ? null : wrap180(objBearing - heading()));
    if (markTarget) { const h = markTarget.npc ? markTarget.npc.npc.group.position.y + 2.6 : Math.max(ctx.height(markTarget.x, markTarget.north), env.u.tide.value) + 14; marker.position.set(markTarget.x, h, -markTarget.north); marker.visible = true; }
    else marker.visible = false;
    // 5 Hz: boarding, survey, quest steps
    mid += dt;
    if (mid >= 0.2) {
      const step = mid; mid = 0;
      if (ctx.controller === playerCtl) { scanBoard(); scanSurvey(); } else { board.v = null; surv.sp = null; }
      for (const [id, s] of Object.entries(st.q)) {
        if (s.s !== 'active') continue;
        const sd = qdef(id).steps[s.i];
        try { if (sd.tick) sd.tick(G, step, s.d); if (sd.check && sd.check(G, s.d)) advance_(id); } catch (e) { console.warn('game: step', id, e); }
      }
      if (content.tick) content.tick(G, step);
      // flying off the edge of the model: offer the nearest other reef site
      slow += step;
      if (slow > 0.6) { slow = 0; edgeCheck(); }
      // walk (or swim) away from a talk
      if (D && D.who.rec && P && !D.who.rec.swim) { const g = D.who.rec.npc.group.position; if (Math.hypot(g.x - P.x, g.z - P.z) > (D.who.rec.vessel ? 16 : 9)) closeDialogue(); }
    }
  }
  function edgeCheck() {
    if (!aboard || !(aboard.kind === 'seaplane' || aboard.kind === 'helicopter') || !S.extent_m) return;
    const [x0, x1, y0, y1] = S.extent_m, x = aboard.x, n = -aboard.z;
    const inside = Math.min(x - x0, x1 - x, n - y0, y1 - n);
    if (inside > 2500) { edgeAsked = false; return; }
    if (edgeAsked || inside > 700 || D) return;
    edgeAsked = true;
    travel.load().then(() => {
      const hdg = ((aboard ? aboard.hdg / RAD : 0) + 360) % 360, s = travel.nearest(hdg);
      const pending = (travel.list || []).filter(t => !t.ready && !t.current);
      const nodes = s ? {
        edge: { say: `That's as far out as we go around ${S.name || ctx.site}. ${s.name} is ${Math.round(s.km)} km ${dirName(s.bearing)} of here.`, src: ['model-terrain'],
          choices: [{ text: `Continue to ${s.name}`, do: () => { save(); location.href = siteAt(s.id); }, go: 'end' }, { text: 'Turn back', go: 'end' }] } }
        : { edge: { say: `That's as far out as we go around ${S.name || ctx.site}, and there's nowhere else to land from here yet${pending.length ? ` (${pending.map(t => t.name).join(', ')} soon)` : ''}. Turn back, or T for the map.`, choices: [{ text: 'Turn back', go: 'end' }] } };
      openDialogue({ name: aboard ? aboard.name : 'Pilot', role: 'Turning back', id: 'edge' }, nodes, 'edge');
    });
  }

  // ------------------------------------------------------------ arrival and onboarding (#89, onboard.js)
  // When the loader lifts, one calm move from a high view behind the player down to their own camera: along the
  // bearing that camera already looks (so the view never turns about them), the distance closing on a log scale,
  // the horizon level, about 3 s. A key or a tap settles it in 0.6 s; with reduced motion there is no move (the
  // loader's fade is the cut). Then, the first time in this browser on any map, a short tour of the HUD; for a
  // returning player a short welcome. "Show the intro again" is in the journal.
  const OB = window.OEOnboard;
  const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const tourSteps = () => [
    { id: 'move', title: 'Walk, swim and look', target: touch ? '.rh-stick' : null,
      text: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk or swim the way you look, <kbd>Shift</kbd> runs, <kbd>Space</kbd> jumps or swims up, <kbd>Ctrl</kbd> dives. Drag to look around, <kbd>V</kbd> changes the view, <kbd>H</kbd> shows the keys.',
      touch: 'The stick walks or swims the way you look; <b>Up</b> and <b>Dive</b> take you up and down. Drag on the right to look around; <b>View</b> changes the view.' },
    { id: 'objective', title: 'Your objective', target: '.rg-obj',
      text: 'What to do next, how far it is and which way. The ◆ on the compass and over the place itself show the way there.' },
    { id: 'use', title: 'Talk, read and gear up', target: null,
      text: '<kbd>E</kbd> uses what is in front of you: talk to the people here, read a sign, put on the mask, fins or scuba kit, board a boat.',
      touch: '<b>Use</b> works what is in front of you: talk to the people here, read a sign, put on the mask, fins or scuba kit, board a boat.' },
    { id: 'journal', title: 'Your journal', target: '.rg-btns .bj',
      text: '<kbd>J</kbd>: your quests, what you have learnt and where every fact comes from.', touch: '<b>Journal</b>: your quests, what you have learnt and where every fact comes from.' },
    { id: 'map', title: 'The map and travel', target: '.rg-btns .bm',
      text: '<kbd>T</kbd> opens the map. Pick a place on it and <b>Travel here</b> takes you there by a short boat run; <b>All sites</b> shows every other site to travel to.',
      touch: '<b>Map</b>: pick a place on it and <b>Travel here</b> takes you there by a short boat run; <b>All sites</b> shows every other site to travel to.' },
    { id: 'time', title: 'Time and tide', target: '.rg-btns .bk',
      text: '<kbd>K</kbd> sets the time of day: the sun, the moon and the predicted tide follow it. <b>Show the intro again</b> is in the journal.',
      touch: '<b>Time</b> sets the time of day: the sun, the moon and the predicted tide follow it. <b>Show the intro again</b> is in the journal.' },
  ];
  function startTour() {
    if (!OB) return null;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    return OB.tour(tourSteps(), { onEnd: () => OB.markDone(ctx.site) });
  }
  function onboard() {
    if (!OB) return;
    if (!OB.done()) startTour();
    else ui.toast(S.name || ctx.site, 'Welcome back. J journal · T map · K time');
  }
  const arrival = { on: false, t: 0, dur: 3.2, settle: null, r0: 0, e0: 0 };
  const eu = new THREE.Euler(0, 0, 0, 'YXZ'), aPos = new THREE.Vector3(), aFocus = new THREE.Vector3(), aDir = new THREE.Vector3();
  const lerpA = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  const sm = t => t * t * t * (t * (6 * t - 15) + 10);
  const arriveCtl = {
    update(dt, t) {
      playerCtl.update(dt, t); // the player's own camera this frame: where the move lands
      if (ctx.controller !== arriveCtl) { endArrival(); return; } // something took over (a boat)
      dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
      eu.setFromQuaternion(camera.quaternion, 'YXZ');
      const yaw1 = eu.y, pitch1 = eu.x, p1 = camera.position.clone();
      camera.getWorldDirection(aDir);
      const r1 = Math.max(1.5, player.S.dist || 4);
      aFocus.copy(p1).addScaledVector(aDir, r1);
      if (!arrival.r0) { arrival.r0 = 85; arrival.e0 = 0.5; }
      arrival.t += dt;
      let px, yaw, pitch;
      if (arrival.settle) {
        const k = sm(Math.min(1, (arrival.t - arrival.settle.t) / 0.6));
        aPos.lerpVectors(arrival.settle.p, p1, k); yaw = lerpA(arrival.settle.yaw, yaw1, k); pitch = arrival.settle.pitch + (pitch1 - arrival.settle.pitch) * k;
        px = k;
      } else {
        const k = Math.min(1, arrival.t / arrival.dur), s = sm(k), e1 = -pitch1;
        const r = arrival.r0 * Math.pow(r1 / arrival.r0, s), e = arrival.e0 + (e1 - arrival.e0) * s;
        // behind the focus on the camera's own bearing, at elevation e
        aPos.set(aFocus.x + Math.sin(yaw1) * Math.cos(e) * r, aFocus.y + Math.sin(e) * r, aFocus.z + Math.cos(yaw1) * Math.cos(e) * r);
        aPos.y = Math.max(aPos.y, ctx.height(aPos.x, -aPos.z) + 2, k < 0.8 ? env.u.tide.value + 1 : -1e9);
        // the last fifth hands over to the player's camera
        const w = sm(Math.max(0, (k - 0.8) / 0.2));
        aPos.lerp(p1, w); yaw = yaw1; pitch = -e + (pitch1 + e) * w;
        px = k;
      }
      camera.position.copy(aPos);
      camera.quaternion.setFromEuler(eu.set(pitch, yaw, 0, 'YXZ'));
      if (px >= 1) endArrival();
    }
  };
  function settleArrival() {
    if (!arrival.on || arrival.settle) return;
    eu.setFromQuaternion(camera.quaternion, 'YXZ');
    arrival.settle = { t: arrival.t, p: camera.position.clone(), yaw: eu.y, pitch: eu.x };
  }
  function endArrival() {
    if (!arrival.on) return;
    arrival.on = false;
    if (ctx.controller === arriveCtl) ctx.controller = playerCtl;
    removeEventListener('keydown', settleArrival, true); removeEventListener('pointerdown', settleArrival, true);
    onboard();
  }
  if (!testing && !q.get('still') && !q.get('cam') && playerCtl && player && !reducedMotion) {
    arrival.on = true;
    ctx.controller = arriveCtl;
    addEventListener('keydown', settleArrival, true); addEventListener('pointerdown', settleArrival, true);
  } else if (!testing && !q.get('still')) setTimeout(onboard, 900); // after the loader's fade
  api0.arrival = arrival; api0.startTour = startTour; api0.settleArrival = settleArrival;

  // first objective, the site list in the background
  refreshObjective(true);
  travel.load();
  const api = Object.defineProperties(api0, Object.getOwnPropertyDescriptors({ update, G, ui, travel, rider, board, surv, light, get aboard() { return aboard; }, get mapView() { return mapView; }, get state() { return st; } })); // (getters kept live)
  window.__game = api;
  if (q.get('gametest') === '1' || q.get('gameshot')) {
    const T = await import('./game/test.js');
    if (q.get('gametest') === '1') await T.gametest(api, ctx);
    if (q.get('gameshot')) await T.gameshot(api, ctx, q.get('gameshot'));
  }
  return api;
}
