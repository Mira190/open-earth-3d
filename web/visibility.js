// Open Earth 3D: what the camera cannot see is not drawn (issue 358, B1).
//
// A street wall hides most of a city from anyone standing in the street, and the city never changes. The
// pipeline bakes how high the buildings stand into a raster (pipeline/visibility.py, data/<city>/vis.bin),
// shrunk so that it never claims more than the walls drawn. A Worker sweeps a horizon over it from where
// the camera is (visibility-sweep.js) a few times a second and hands back, for each 16 m cell of the map,
// the height under which nothing there can be seen. The page then leaves out what stands lower: building
// cells, prop cells, trees, walkers, cars. No GPU work, no read-back, nothing on the frame but a table
// lookup. The earlier try asked the GPU with occlusion queries (docs/PERFORMANCE.md) and failed for that.
//
// An answer holds while the camera is within `eps` of where it was computed and no higher; outside that,
// or with no answer yet, or inside a building, or moving faster than a sweep can follow, everything is
// drawn as before. So the worst case is the old frame, never a missing thing.
//
//   OEVis.create({ city, terrain, tier, solids, hidden })   start (game.js); terrain: the game's grid, for the
//                                           hills; solids: buildings.json s, for "is the camera in a building"
//   OEVis.at(camera)                        once a frame, with the camera the player sees through
//   OEVis.seen(x, y, top, reach)            may anything at (x east, y north) that reaches up to `top`
//                                           (m above datum) be seen? reach: also within this many metres
//                                           (a caster whose shadow may be seen while it is not)
//   OEVis.seenNext(x, y, top, height)       the same during the game's step, for the frame about to be drawn
//   OEVis.gate(object)                      a static mesh or instanced mesh: hidden while unseen (ungate: it is leaving)
//   OEVis.shadow(on)                        world.js, round the shadow pass: the static casters back
//   OEVis.epoch                             changes when the answer does (re-test then, not every frame)
//   OEVis.hold(why, on)                     stop gating for a while (an interior, a film's cut)
//   OEVis.forget()                          a harness moved the camera by hand: no speed from that
// `?vis=off` turns it off; `?vis=show` logs what it hides.
'use strict';
window.OEVis = (() => {
  const CELL = 16, TIERS = [1, 2, 4, 8];
  const q = new URLSearchParams(location.search).get('vis');
  const api = { CELL, epoch: 0, live: false, cot: 0, off: q === 'off', stats: { sweeps: 0, ms: 0, hidden: 0, gated: 0, null: 0 } };
  let worker = null, ready = false, pending = 0, sent = 0, beams = 720;
  let S = null, nx = 0, ny = 0, gx0 = 0, gy0 = 0;       // the answer and its grid
  let ax = 0, ay = 0, az = -Infinity, aeps = 0;        // where it holds: within aeps of (ax, ay), eye no higher than az
  let px = 0, py = 0, pz = 0, pt = 0, speed = 0, vx = 0, vy = 0, vz = 0, have = false;
  const holds = new Set();
  const gates = [], hidden = [], queue = [];
  let shadowOpen = false, idle = 0;

  function create(opt) {
    if (api.off || worker || !window.Worker || typeof DecompressionStream === 'undefined') return api;
    try {
      worker = new Worker(new URL('visibility-worker.js', srcBase));
    } catch (e) { worker = null; return api; }
    beams = opt.tier === 'low' ? 360 : 720;
    indoors = opt.solids ? footprints(opt.solids, opt.hidden) : () => false;
    const t = opt.terrain;
    worker.onmessage = onMessage;
    worker.onerror = () => { stop(); };
    worker.postMessage({ init: { url: new URL(`data/${opt.city}/vis.bin`, document.baseURI).href,
      keep: opt.tier === 'low' ? 1 : 2, // (each shrunk copy is the raster's size and a third again: 24 MB for Shibuya)
      terrain: t ? { data: Float32Array.from(t.data), nx: t.nx, ny: t.ny, cell: t.cell, x0: t.x0, y1: t.y1 } : null } });
    return api;
  }
  const srcBase = document.currentScript ? document.currentScript.src : document.baseURI;

  function stop() {
    if (worker) worker.terminate();
    worker = null; ready = false; pending = 0; S = null; have = false;
    setLive(false);
  }
  function dispose() { stop(); showAll(); gates.length = 0; queue.length = 0; holds.clear(); }

  function onMessage(e) {
    const d = e.data;
    if (d.failed) { console.info('visibility: none for this city', d.failed); stop(); return; }
    if (d.ready) { ready = true; nx = d.grid.nx; ny = d.grid.ny; gx0 = d.grid.x0; gy0 = d.grid.y0; api.head = d.head; return; }
    if (d.id !== pending) return;
    pending = 0;
    api.stats.sweeps++; api.stats.ms = d.ms;
    if (!d.S) { api.stats.null++; S = null; az = -Infinity; setLive(false, true); return; }
    S = d.S; ax = d.x; ay = d.y; az = d.z; aeps = d.eps;
    api.epoch++;
    check();
    apply();
  }

  // Is the camera inside a building's footprint (a footway mapped through a block, a corner the camera cut)?
  // There it looks out through walls drawn one-sided, which no sweep answers for. Tested against the solids
  // themselves (every one that stands on the ground and is drawn), found through a 32 m grid of their boxes.
  function footprints(solids, hiddenSolids) {
    const hid = new Set(hiddenSolids || []), grid = new Map(), HC = 32;
    solids.forEach((s, si) => {
      const r = s[4];
      if (hid.has(si) || s[2] !== 0 || !r || r.length < 6 || s[3] <= 0) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k]; if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1]; }
      for (let j = Math.floor(y0 / 10 / HC); j <= Math.floor(y1 / 10 / HC); j++) for (let i = Math.floor(x0 / 10 / HC); i <= Math.floor(x1 / 10 / HC); i++) {
        const key = i * 65536 + j; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(s);
      }
    });
    const inRing = (r, x, y) => { let c = false; for (let k = 0, n = r.length, j = n - 2; k < n; j = k, k += 2) if ((r[k + 1] > y) !== (r[j + 1] > y) && x < r[j] + (y - r[j + 1]) / (r[k + 1] - r[j + 1]) * (r[k] - r[j])) c = !c; return c; };
    return (x, y) => {
      const l = grid.get(Math.floor(x / HC) * 65536 + Math.floor(y / HC));
      if (!l) return false;
      const X = x * 10, Y = y * 10; // (the rings are in decimetres)
      for (const s of l) {
        if (!inRing(s[4], X, Y)) continue;
        let hole = false;
        for (let h = 5; h < s.length && !hole; h++) if (Array.isArray(s[h]) && inRing(s[h], X, Y)) hole = true;
        if (!hole) return true;
      }
      return false;
    };
  }
  let indoors = () => false;
  // is the answer good for where the camera is now?
  function check() {
    const ok = !!S && !holds.size && !api.off && have && pz <= az && (px - ax) * (px - ax) + (py - ay) * (py - ay) <= aeps * aeps && !indoors(px, py);
    setLive(ok);
  }
  function setLive(v, force) {
    if (v === api.live && !force) return;
    api.live = v;
    api.epoch++;
    apply();
  }

  // once a frame, with the player's camera: follow it, ask for a sweep when the answer runs out
  function at(camera) {
    if (!worker || api.off) return;
    const p = camera.position, now = performance.now(), x = p.x, y = -p.z, z = p.y;
    if (have) {
      const dt = Math.max(1e-3, (now - pt) / 1000), jump = Math.hypot(x - px, y - py, z - pz);
      if (jump > 60) { speed = 0; vx = vy = vz = 0; } // a cut or a teleport, not a speed
      else { const k = Math.min(1, dt * 6); vx += ((x - px) / dt - vx) * k; vy += ((y - py) / dt - vy) * k; vz += ((z - pz) / dt - vz) * k; speed = Math.hypot(vx, vy); }
    }
    px = x; py = y; pz = z; pt = now; have = true;
    check();
    if (!ready || pending || holds.size) return;
    // the room a sweep must cover: how far the camera goes while the sweep runs and until the next
    const want = speed * 0.35 + 0.5, eps = TIERS.find(t => t >= want);
    if (!eps) { if (api.live) setLive(false); return; } // too fast to follow: draw everything
    const dx = px - ax, dy = py - ay, used = Math.hypot(dx, dy) / (aeps || 1);
    if (S && aeps === eps && used < 0.4 && pz < az - 0.4 && now - sent < 4000) return;
    if (!S && api.stats.null && now - sent < 250) return; // inside something: ask again, but not every frame
    const lead = Math.min(eps * 0.5, speed * 0.12), s = speed > 0.1 ? lead / speed : 0;
    pending = ++idle; sent = now;
    worker.postMessage({ id: pending, x: px + vx * s, y: py + vy * s, z: pz + Math.max(1, eps * 0.5) + Math.max(0, vz) * 0.4, eps, beams });
  }

  function seen(x, y, top, reach) {
    if (!api.live) return true;
    if (reach > 0) {
      const i0 = Math.floor((x - reach - gx0) / CELL), i1 = Math.floor((x + reach - gx0) / CELL), j0 = Math.floor((y - reach - gy0) / CELL), j1 = Math.floor((y + reach - gy0) / CELL);
      if (i0 < 0 || j0 < 0 || i1 >= nx || j1 >= ny) return true;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (S[j * nx + i] <= top) return true;
      return false;
    }
    const i = Math.floor((x - gx0) / CELL), j = Math.floor((y - gy0) / CELL);
    return i < 0 || j < 0 || i >= nx || j >= ny || S[j * nx + i] <= top;
  }

  // The same question, asked during the game's step for the frame about to be drawn (the crowd, the cars):
  // the camera moves after the step, so the answer must still hold a frame on. It is used only while the
  // camera has that much of its margin left (a tenth of a second at its speed, 0.3 m at least), else everything
  // is seen. height: the thing's height (m), for how far its shadow reaches under the sun now (api.cot, set
  // by the game: the cotangent of the sun's elevation, 0 with no sun).
  function seenNext(x, y, top, height) {
    if (!api.live) return true;
    const room = aeps - Math.max(0.3, speed * 0.1), dx = px - ax, dy = py - ay;
    if (room <= 0 || dx * dx + dy * dy > room * room || pz + Math.max(0.2, vz * 0.1) > az) return true;
    return seen(x, y, top, Math.min(40, (height || 0) * api.cot));
  }

  // ---- static things: each gets the cells it stands in and how high it reaches in each, once
  // now: its cells read at once (a mesh whose arrays are let go when it is uploaded: a building cell on a phone)
  function gate(obj, now = false) {
    if (!obj || obj.userData.oeVis || api.off) return obj;
    if (!(obj.isMesh || obj.isInstancedMesh) || !(obj.layers.mask & 1)) return obj;
    obj.userData.oeVis = true;
    if (now) { const s = samples(obj); if (s) { gates.push({ o: obj, s, hid: false }); if (!gate.timer) gate.timer = setTimeout(drain, 0); } return obj; }
    queue.push(obj);
    if (!gate.timer) gate.timer = setTimeout(drain, 0);
    return obj;
  }
  // a gated mesh that is leaving the scene (a building cell swapped for another level of detail)
  function ungate(obj) {
    if (!obj || !obj.userData.oeVis) return obj;
    obj.userData.oeVis = false;
    let i = queue.indexOf(obj); if (i >= 0) queue.splice(i, 1);
    i = gates.findIndex(g => g.o === obj); if (i >= 0) gates.splice(i, 1);
    i = hidden.findIndex(g => g.o === obj); if (i >= 0) hidden.splice(i, 1);
    obj.layers.mask |= 1;
    return obj;
  }
  // every mesh under an object (a prop's cells are its children)
  function gateAll(root) { if (root && !api.off) root.traverse(o => { if (o.isMesh || o.isInstancedMesh) gate(o); }); return root; }
  function drain() {
    gate.timer = 0;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) {
      const o = queue.pop(), s = samples(o);
      if (s) gates.push({ o, s, hid: false });
    }
    if (queue.length) gate.timer = setTimeout(drain, 30);
    else apply();
  }
  // [x, y, top, ...]: one per 16 m cell the object touches, with the highest it reaches there
  function samples(o) {
    const g = o.geometry, P = g && g.attributes.position;
    if (!P || !(P.array || (P.data && P.data.array)) || (g.index && !g.index.array)) return null; // (on a phone, held on the GPU alone by now: world.js lean)
    o.updateWorldMatrix(true, false);
    const E = o.matrixWorld.elements, cells = new Map();
    const put = (i, j, top) => { const k = i * 65536 + j, v = cells.get(k); if (v === undefined || top > v) cells.set(k, top); };
    const box = (x0, x1, y0, y1, top) => { for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) put(i + 32768, j + 32768, top); };
    if (o.isInstancedMesh) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      const c = g.boundingSphere.center, r0 = g.boundingSphere.radius, A = o.instanceMatrix.array;
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let n = 0; n < o.count; n++) {
        m.fromArray(A, 16 * n).premultiply(o.matrixWorld);
        v.copy(c).applyMatrix4(m);
        const r = r0 * m.getMaxScaleOnAxis();
        box(v.x - r, v.x + r, -v.z - r, -v.z + r, v.y + r);
      }
    } else {
      const I = g.index, a = P.array, st = P.isInterleavedBufferAttribute ? P.data.stride : 3, of = P.isInterleavedBufferAttribute ? P.offset : 0;
      const src = P.isInterleavedBufferAttribute ? P.data.array : a;
      const ident = E[0] === 1 && E[5] === 1 && E[10] === 1 && !E[1] && !E[2] && !E[4] && !E[6] && !E[8] && !E[9];
      const n = I ? I.count : P.count, X = [0, 0, 0], Y = [0, 0, 0], Z = [0, 0, 0];
      const r0 = g.drawRange.start, r1 = Math.min(n, g.drawRange.start + g.drawRange.count);
      for (let t = r0; t + 2 < r1; t += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = (I ? I.array[t + k] : t + k) * st + of, x = src[vi], y = src[vi + 1], z = src[vi + 2];
          if (ident) { X[k] = x + E[12]; Y[k] = y + E[13]; Z[k] = z + E[14]; }
          else { X[k] = E[0] * x + E[4] * y + E[8] * z + E[12]; Y[k] = E[1] * x + E[5] * y + E[9] * z + E[13]; Z[k] = E[2] * x + E[6] * y + E[10] * z + E[14]; }
        }
        box(Math.min(X[0], X[1], X[2]), Math.max(X[0], X[1], X[2]), -Math.max(Z[0], Z[1], Z[2]), -Math.min(Z[0], Z[1], Z[2]), Math.max(Y[0], Y[1], Y[2]));
      }
    }
    if (!cells.size) return null;
    const out = new Float32Array(3 * cells.size);
    let k = 0;
    for (const [key, top] of cells) { out[k++] = (Math.floor(key / 65536) - 32768 + 0.5) * CELL; out[k++] = ((key % 65536) - 32768 + 0.5) * CELL; out[k++] = top; }
    return out;
  }
  function showAll() { for (const g of hidden) { g.o.layers.mask |= 1; g.hid = false; } hidden.length = 0; api.stats.hidden = 0; }
  // hide what the answer says cannot be seen (layer 0 off: a hidden object's children are still drawn,
  // which `visible` would not allow, and nothing else here turns layer 0 on or off)
  function apply() {
    if (shadowOpen) return; // (the shadow pass has them all shown: shadow(false) calls back)
    showAll();
    api.stats.gated = gates.length;
    if (!api.live) return;
    for (const g of gates) {
      const s = g.s;
      let vis = false;
      for (let k = 0; k < s.length; k += 3) {
        const i = Math.floor((s[k] - gx0) / CELL), j = Math.floor((s[k + 1] - gy0) / CELL);
        if (i < 0 || j < 0 || i >= nx || j >= ny || S[j * nx + i] <= s[k + 2]) { vis = true; break; }
      }
      if (!vis) { g.o.layers.mask &= ~1; g.hid = true; hidden.push(g); }
    }
    api.stats.hidden = hidden.length;
    if (q === 'show') console.info(`visibility: ${hidden.length} of ${gates.length} static meshes hidden (sweep ${api.stats.ms.toFixed(1)} ms, eps ${aeps})`);
  }
  // The sun's shadow map needs every static caster, seen or not (a tower behind the street wall still
  // shades the street): world.js opens this round the shadow pass. The view's list of what to draw is
  // made before the shadow pass in the same render call, so it keeps the gates.
  function shadow(on) {
    if (on) { if (!shadowOpen) { shadowOpen = true; for (const g of hidden) g.o.layers.mask |= 1; } }
    else if (shadowOpen) { shadowOpen = false; for (const g of hidden) g.o.layers.mask &= ~1; }
  }
  // for a harness that places the camera by hand: the next at() takes its place as a start, not a speed
  function forget() { have = false; speed = 0; vx = vy = vz = 0; }
  function hold(why, on) {
    if (on === false) holds.delete(why); else holds.add(why);
    check();
  }

  return Object.assign(api, { create, at, seen, seenNext, gate, ungate, gateAll, shadow, hold, forget, dispose, where: () => ({ x: ax, y: ay, z: az, eps: aeps, speed, pending: !!pending, ready }) });
})();
