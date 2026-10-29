// The cars people get into, shared by every city's game: your own car, the taxis you wave
// down at the kerb and the rides you order on your phone.
//
// Models: the traffic's Blender cars (assets/vehicles/cars.glb, built by
// blender/build_vehicles.py), each with its cabin: seats, a dashboard and a steering wheel
// behind glass you can see through, and whoever is driving in the seat. The wheels are
// split off the body here, so they roll and steer; the lamps light after dark, the brake
// lights when braking and the indicators when pulling in; the body leans on its springs.
// Where traffic keeps right the cabin is mirrored, so the wheel is on the left.
//
// Handling: arcade, as racing games and GTA do it rather than a tyre model. The heading
// follows the steering at the rate the speed and the wheelbase give, and the tyres then pull
// the velocity round to the heading, up to what they can grip: a car taken into a bend too
// fast slides wide, and the handbrake lets the tail step out into a drift. Steering lightens
// with speed; the engine pulls through five gears to a top speed set per model; holding the
// brake at a standstill reverses. The car hits buildings, landmarks and the water's edge
// (three circles down the body, each pushed out of the walls as Unreal's ResolvePenetration
// does, in steps short enough not to tunnel), bumps into other cars and stops for people,
// and follows the ground, kerbs and bridge decks.
//
// Chauffeur: a driver who takes a route over the road network (a Dijkstra router from a
// point on one road, going one way, to a point on another), keeps to the lane, slows for
// bends and for anything in the lane ahead, signals, and pulls in to the kerb at the end.
//
// Boxes: any car as an oriented box, so the walker can't walk into one and the camera
// stays out of them.
//
// Like vehicles.js, nothing here depends on the three.js version (r128 or r186).
'use strict';
window.OECars = (function () {
  const lin = hex => (THREE.ColorManagement && THREE.ColorManagement.enabled ? new THREE.Color(hex) : new THREE.Color(hex).convertSRGBToLinear());
  const PHYS = () => +THREE.REVISION >= 155;
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // road widths by class (m), as the streets are drawn in game.js; a car pulls in to half of it less a car's width
  const ROADW = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 6, living_street: 5 };
  const LANE = 1.7; // the traffic's lane, off the centre line (actors.js)
  const kerbOf = c => clamp((ROADW[c] || 7) / 2 - 0.1, 3.3, 6.5);
  // the cushions' height over the cabin floor (build_vehicles.py: the cushions 0.33 m over the floor pan, the carpet 0.1 on it)
  const CUSHION = 0.225;

  // ------------------------------------------------------------ materials
  // The occlusion the bake left in each vertex's colour, used as the traffic's shader uses it
  // (a little on the paint, all of it on the light from the sky). With a lining colour the
  // material is drawn on both sides, and the back faces (the inside of the shell, seen through
  // the glass) take the lining's colour.
  function shade(mat, lining) {
    const uni = { uLining: { value: lining ? lin(lining) : new THREE.Color(0, 0, 0) }, uLiningOn: { value: lining ? 1 : 0 } };
    if (lining) mat.side = THREE.DoubleSide;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vAO;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = color.r;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO;\nuniform vec3 uLining;\nuniform float uLiningOn;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( (uLiningOn > 0.5 && !gl_FrontFacing ? uLining : diffuse) * mix(1.0, vAO, 0.45), opacity );')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nif (uLiningOn > 0.5 && !gl_FrontFacing) {\n  material.roughness = 0.92;\n#ifdef USE_CLEARCOAT\n  material.clearcoat = 0.0;\n#endif\n}')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;');
    };
    mat.customProgramCacheKey = () => 'oe-car';
    return mat;
  }
  const std = (hex, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(hex), roughness, metalness }, extra));
  function materials({ paint, band, seat, lining }) {
    const coat = hex => shade(new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07 }), lining);
    const lamp = (hex, emit) => std(hex, 0.2, 0, { emissive: lin(emit), emissiveIntensity: 0 });
    const m = {
      Paint: coat(paint), Paint2: coat(band || paint),
      Glass: new THREE.MeshPhysicalMaterial({ color: lin('#0d151a'), roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
        transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
      Trim: shade(std('#141516', 0.6), '#121314'), Chrome: shade(std('#c9cdd1', 0.2, 0.9)), Tyre: shade(std('#1a1b1c', 0.85)),
      Rim: shade(std('#a7adb3', 0.3, 0.9)), Plate: shade(std('#f2f2ec', 0.5)), Seat: shade(std(seat, 0.9), seat), Dash: shade(std('#1d1f22', 0.6), '#1d1f22'),
      Light_Head: lamp('#aeb6bd', '#fff4dc'), Light_Tail: lamp('#8a0d10', '#ff2a1a'), Light_Amber: lamp('#d97b0e', '#ffae2a'), Sign: lamp('#f6e9a8', '#ffe9a0'),
    };
    m.Seam = m.Trim;
    return m;
  }

  // ------------------------------------------------------------ geometry: the body, and the wheels split off it
  // the raw values of an attribute, whether or not it is interleaved
  const raw = a => (a.isInterleavedBufferAttribute ? { arr: a.data.array, stride: a.data.stride, off: a.offset } : { arr: a.array, stride: a.itemSize, off: 0 });
  // split a mesh's triangles between the body and the wheels (a triangle with all three corners in
  // a wheel's cylinder: tyre, rim, spokes and hub); each wheel comes back centred on its hub
  function split(geo, wheels) {
    const P = raw(geo.attributes.position), idx = geo.index, n = (idx ? idx.count : geo.attributes.position.count) / 3;
    const vi = k => (idx ? idx.getX(k) : k);
    const parts = wheels.map(() => []).concat([[]]); // wheel 0..3, then the body
    for (let t = 0; t < n; t++) {
      let part = wheels.length;
      for (let w = 0; w < wheels.length && part === wheels.length; w++) {
        const q = wheels[w];
        let all = true;
        for (let c = 0; c < 3 && all; c++) {
          const o = P.off + vi(3 * t + c) * P.stride, dx = P.arr[o] - q.x, dy = P.arr[o + 1] - q.r, dz = P.arr[o + 2] - q.z;
          all = Math.abs(dx) < 0.17 && dy * dy + dz * dz < q.r * q.r * 1.09;
        }
        if (all) part = w;
      }
      parts[part].push(t);
    }
    return parts.map((tris, p) => {
      if (!tris.length) return null;
      const out = new THREE.BufferGeometry(), q = wheels[p];
      for (const name of Object.keys(geo.attributes)) {
        const a = geo.attributes[name], A = raw(a), size = a.itemSize, arr = new A.arr.constructor(tris.length * 3 * size);
        let j = 0;
        for (const t of tris) for (let c = 0; c < 3; c++) { const o = A.off + vi(3 * t + c) * A.stride; for (let e = 0; e < size; e++) arr[j++] = A.arr[o + e]; }
        if (name === 'position' && q) for (let k = 0; k < arr.length; k += 3) { arr[k] -= q.x; arr[k + 1] -= q.r; arr[k + 2] -= q.z; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
      }
      if (!out.attributes.color) out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tris.length * 9).fill(1), 3));
      out.computeBoundingSphere();
      return out;
    });
  }
  // the meshes under a node, as (geometry in the node's frame, material name)
  function meshesOf(node) {
    const out = [], inv = new THREE.Matrix4();
    node.updateMatrixWorld(true);
    inv.copy(node.matrixWorld).invert();
    node.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      out.push({ geo: g, name: o.material.name.replace(/\.\d+$/, ''), mesh: o });
    });
    return out;
  }
  const glowTex = (() => {
    let t = null;
    return () => {
      if (t) return t;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return (t = new THREE.CanvasTexture(c));
    };
  })();

  // ------------------------------------------------------------ a car someone gets into
  // lib: OEVehicles.load(); name: a model in vehicles.json (Car_Sedan, Car_Taxi, Car_Hatch,
  // Car_SUV, Car_Van); colours { paint, band, seat, lining }; keep: 'left' or 'right'.
  // Model frame: +z forward, +y up, +x to the left; heading h clockwise from north.
  function car(world, lib, name, { colours = {}, keep = 'left' } = {}) {
    const I = lib.info.cars, M = I.models[name], node = lib.cars.scene.getObjectByName(name);
    const mats = materials(Object.assign({ paint: '#d8dadc', seat: '#3b3d41', lining: '#3e3c39' }, colours));
    const g = new THREE.Group(), body = new THREE.Group(), mirror = keep === 'right' ? -1 : 1;
    g.add(body);
    const half = M.length_m / 2, hw = M.width_m / 2, r = M.wheel_r_m, wb = M.axles_m[0] - M.axles_m[1];
    const hubs = [];
    for (const z of M.axles_m) for (const s of [1, -1]) hubs.push({ x: s * M.track_m / 2, z, r, front: z === M.axles_m[0] });
    const wheels = hubs.map(q => {
      const at = new THREE.Group(), steer = new THREE.Group(), spin = new THREE.Group();
      at.position.set(q.x, q.r, q.z);
      at.add(steer); steer.add(spin); g.add(at);
      return { at, steer, spin, front: q.front };
    });
    const lampAt = {}, own = [], shell = []; // centroids of the lamps, each side, for the glows; this car's own geometry; its body
    for (const { geo, name: mn } of meshesOf(node)) {
      const parts = split(geo, hubs), mat = mats[mn] || mats.Trim;
      parts.forEach((pg, p) => {
        if (!pg) return;
        own.push(pg);
        const mesh = new THREE.Mesh(pg, mat);
        mesh.castShadow = !mat.transparent; mesh.receiveShadow = true;
        (p < hubs.length ? wheels[p].spin : body).add(mesh);
        if (p === hubs.length) shell.push(mesh);
      });
      if (/^Light_(Head|Tail)$/.test(mn)) {
        const P = geo.attributes.position, acc = { 1: [0, 0, 0, 0], [-1]: [0, 0, 0, 0] };
        for (let k = 0; k < P.count; k++) { const a = acc[P.getX(k) > 0 ? 1 : -1]; a[0] += P.getX(k); a[1] += P.getY(k); a[2] += P.getZ(k); a[3]++; }
        lampAt[mn] = [1, -1].filter(s => acc[s][3]).map(s => new THREE.Vector3(acc[s][0] / acc[s][3], acc[s][1] / acc[s][3], acc[s][2] / acc[s][3]));
      }
    }
    // the cabin, mirrored for left-hand drive, and the wheel turning on its column
    let steering = null, q0 = null;
    const cab = M.cabin && lib.cars.scene.getObjectByName(M.cabin);
    if (cab) {
      const c = cab.clone(true);
      c.position.set(0, 0, 0);
      c.scale.x = mirror;
      c.traverse(o => {
        if (o.isMesh) { o.material = mats[o.material.name.replace(/\.\d+$/, '')] || mats.Dash; o.castShadow = false; o.receiveShadow = true; }
        if (o.name === `${name}_Steering`) steering = o;
      });
      if (steering) q0 = steering.quaternion.clone();
      body.add(c);
    }
    const seats = {};
    for (const [k, p] of Object.entries(M.seats || {})) seats[k] = new THREE.Vector3(p[0] * mirror, p[1], p[2]);
    // left and right in the frame of a left-hand-drive car swap with the cabin
    if (mirror < 0 && seats.rear_left) [seats.rear_left, seats.rear_right] = [seats.rear_right, seats.rear_left];
    // lamps seen from afar after dark
    const glows = [];
    const glow = (p, hex, size, kind) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: lin(hex), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(p).add(new THREE.Vector3(0, 0, Math.sign(p.z) * 0.06));
      s.renderOrder = 3;
      s.userData = { size, kind };
      body.add(s);
      glows.push(s);
    };
    for (const p of lampAt.Light_Head || []) glow(p, '#fff1d8', 1.1, 'head');
    for (const p of lampAt.Light_Tail || []) glow(p, '#ff2a1a', 0.75, 'tail');
    world.add(g);
    const qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), hub = new THREE.Vector3();
    // the underside of the roof over a seat, in the body's frame: straight down onto the body from above
    const roofs = {}, ray = new THREE.Raycaster(), down = new THREE.Vector3();
    function roofOver(p) {
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
      if (roofs[key] == null) {
        body.updateWorldMatrix(true, true);
        const from = body.localToWorld(new THREE.Vector3(p.x, M.height_m + 2, p.z));
        ray.set(from, body.localToWorld(down.set(p.x, 0, p.z)).sub(from).normalize());
        const hit = ray.intersectObjects(shell, false)[0];
        roofs[key] = hit ? body.worldToLocal(hit.point).y - 0.04 : M.height_m - 0.08;
      }
      return roofs[key];
    }
    let spin = 0, blink = 0, pitch = 0, roll = 0, pv = 0, ph = 0;
    const api = {
      group: g, body, name, info: M, half, hw, top: M.height_m, wheelbase: wb, seats, mats, lamp: null,
      // put it at (x, y, z) heading h, tilted by the ground under it (pitch: nose down, roll: left side up)
      place(x, y, z, h, gp = 0, gr = 0) {
        g.position.copy(W(x, y, z));
        g.rotation.set(0, 0, 0);
        g.rotateY(Math.PI - h);
        g.rotateX(gp);
        g.rotateZ(gr);
      },
      // s: { v (m/s, along the heading), h, steer (rad, + right), brake, hazard, signal (-1 left, 1 right),
      // night (0..1), on (lights allowed), lights (by day too), sign (a taxi's, for hire), inside (the
      // camera is in the cabin) }: wheels, the body on its springs, the lamps
      animate(dt, s) {
        spin += (s.v || 0) / r * dt;
        const sa = clamp(s.steer || 0, -0.6, 0.6);
        for (const w of wheels) { w.spin.rotation.x = spin; w.steer.rotation.y = w.front ? -sa : 0; }
        if (steering) { steering.quaternion.copy(q0).multiply(qz.setFromAxisAngle(Z, sa * 2.6 * mirror)); steering.getWorldPosition(hub); }
        // springs: dive under braking, squat under power, lean out of a turn
        const acc = dt > 0 ? ((s.v || 0) - pv) / dt : 0, yaw = dt > 0 ? angDiff(s.h || 0, ph) / dt : 0;
        pv = s.v || 0; ph = s.h || 0;
        pitch += (clamp(-acc * 0.0045, -0.035, 0.035) - pitch) * Math.min(1, dt * 5);
        roll += (clamp(-yaw * (s.v || 0) * 0.0035, -0.05, 0.05) - roll) * Math.min(1, dt * 5);
        body.rotation.set(pitch, 0, roll);
        // lamps: indicators blink, the tail lights brighten under braking, everything glows at night
        blink = (blink + dt) % 0.8;
        const on = blink < 0.4, night = s.night || 0, lit = night > 0.25 || s.lights;
        const amber = (s.hazard || s.signal) && on;
        mats.Light_Head.emissiveIntensity = lit ? 2.4 : 0.05;
        mats.Light_Tail.emissiveIntensity = (s.brake ? 2.2 : 0) + (lit ? 0.9 : 0.05);
        mats.Light_Amber.emissiveIntensity = amber ? 2.6 : 0;
        mats.Sign.emissiveIntensity = s.sign ? 0.4 + 1.6 * night : 0;
        for (const q of glows) { // (the headlamps' glow is for the street, not for whoever is at the wheel: s.inside)
          const k = q.userData.kind === 'head' ? (lit && !s.inside ? 1 : 0) : lit ? (s.brake ? 1.4 : 0.8) : s.brake ? 0.6 : 0;
          q.visible = k > 0.01;
          q.scale.setScalar(q.userData.size * (0.5 + 0.8 * night) * Math.max(0.6, k));
          q.material.opacity = Math.min(1, k * (0.35 + 0.65 * night));
        }
        if (api.lamp) api.lamp.intensity = lit ? (PHYS() ? 2600 : 1.4) : 0;
      },
      // a person in a seat, facing forward: the rig's root on the floor in front of the cushion
      // (people.js puts the feet there), the shins forward and, at the wheel, the hands on it. A
      // tall person (or a hat) sinks into the seat until the head clears the roof.
      sit(rig, seat) {
        const p = seats[seat] || seats.driver;
        body.add(rig.root);
        rig.root.position.copy(p).add(new THREE.Vector3(0, -CUSHION, 0));
        rig.root.rotation.set(0, 0, 0);
        rig.legRake = 1;
        rig.reach = seat === 'driver' && steering ? hub : null;
        if (rig.headTop) {
          rig.animate(0, 0, 'sit', 0);
          const over = body.worldToLocal(rig.headTop()).y - roofOver(p);
          if (over > 0) rig.root.position.y -= Math.min(0.3, over);
        }
      },
      // the shared headlamp (a spot light kept in the scene, so no shader recompiles), on this car
      carry(light) {
        if (api.lamp === light) return;
        if (light.parent) light.parent.remove(light, light.target);
        light.position.set(0, 0.8, half - 0.2);
        light.target.position.set(0, -0.6, half + 16);
        body.add(light, light.target);
        api.lamp = light;
      },
      drop(light) { if (api.lamp === light) { body.remove(light, light.target); api.lamp = null; light.intensity = 0; } },
      // off the street for good (a ride that has driven away): its own geometry and materials go too
      dispose() {
        world.remove(g);
        for (const q of own) q.dispose();
        for (const m of new Set(Object.values(mats).concat(glows.map(q => q.material)))) m.dispose();
      },
    };
    return api;
  }
  // the headlamp beam, one for whichever car the player is in
  function headlamp(world) {
    const l = new THREE.SpotLight(lin('#fff1d6'), 0, 70, 0.55, 0.6, PHYS() ? 2 : 1);
    world.add(l, l.target);
    return l;
  }

  // ------------------------------------------------------------ boxes: cars as oriented rectangles
  // a box: { x, y, z, h, hl (half length), hw (half width), top (height) }
  const boxOf = (o, hl, hw, top) => ({ x: o.x, y: o.y, z: o.z, h: o.h, hl, hw, top, ref: o });
  // push a circle (a walker, radius r, feet at z) out of the boxes it overlaps: { x, y, hit }
  function pushOut(x, y, z, r, boxes) {
    let hit = null;
    for (const b of boxes) {
      if (z > b.z + b.top + 0.2 || z + 1.7 < b.z) continue;
      const fx = Math.sin(b.h), fy = Math.cos(b.h), dx = x - b.x, dy = y - b.y;
      const u = dx * fx + dy * fy, w = -dx * fy + dy * fx; // along, and to the left
      const pu = b.hl + r - Math.abs(u), pw = b.hw + r - Math.abs(w);
      if (pu <= 0 || pw <= 0) continue;
      if (pu < pw) { x += fx * Math.sign(u) * pu; y += fy * Math.sign(u) * pu; } else { x += -fy * Math.sign(w) * pw; y += fx * Math.sign(w) * pw; }
      hit = b;
    }
    return { x, y, hit };
  }
  // how far along a -> b (game coordinates {x, y, z}) the camera gets before entering a box
  // (grown by pad), 0..1; boxes it starts inside are left out
  function sweep(a, b, boxes, pad = 0.3) {
    let best = 1;
    for (const q of boxes) {
      const fx = Math.sin(q.h), fy = Math.cos(q.h);
      const loc = p => [(p.x - q.x) * fx + (p.y - q.y) * fy, -(p.x - q.x) * fy + (p.y - q.y) * fx, p.z - q.z];
      const A = loc(a), B = loc(b), lo = [-q.hl - pad, -q.hw - pad, -pad], hi = [q.hl + pad, q.hw + pad, q.top + pad];
      if (A.every((v, k) => v > lo[k] && v < hi[k])) continue;
      let t0 = 0, t1 = 1;
      for (let k = 0; k < 3 && t0 <= t1; k++) {
        const d = B[k] - A[k];
        if (Math.abs(d) < 1e-9) { if (A[k] < lo[k] || A[k] > hi[k]) t0 = 2; continue; }
        let ta = (lo[k] - A[k]) / d, tb = (hi[k] - A[k]) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }

  // ------------------------------------------------------------ handling: driving your own car
  // the model's performance: top speed (m/s) and pull off the line (m/s2)
  const PERF = { Car_Sedan: [58, 7.6], Car_Taxi: [55, 7.2], Car_Hatch: [52, 7.8], Car_SUV: [53, 7.0], Car_Van: [42, 5.8] };
  const SHIFT = [0, 13, 23, 33, 44, 80]; // speeds (m/s) at which it changes up, for the engine note
  function drive(C, nav, at) {
    const [VMAX, A0] = PERF[C.name] || [52, 7.4];
    const st = { x: at.x, y: at.y, z: at.z, h: at.h, vx: 0, vy: 0, r: 0, steer: 0, vz: 0, air: false, v: 0, speed: 0, slip: 0, gear: 1, rpm: 0, brake: false,
      reverse: false, grip: 1, pitch: 0, roll: 0 };
    const rad = C.hw + 0.04, offs = [C.half - C.hw, 0, -(C.half - C.hw)];
    // the floor under the car: what a walker would step onto (a kerb, a ramp, a deck), not a wall
    const floor = (x, y, z) => { const f = nav.floorAt(x, y, z + 0.1); return f ? f.z : null; };
    // can the car stand here? (not over the water, not off a drop the walkers wouldn't take)
    const standable = (x, y, z) => { const f = floor(x, y, z); return f != null && f > z - 3.5; };
    // one step of dt: inp { fwd -1..1 (W/S), turn -1..1 (+ right), handbrake }; env { boxes, people }; events []
    function step(dt, inp, env, events) {
      const n = Math.max(1, Math.ceil(dt * 120), Math.ceil(Math.hypot(st.vx, st.vy) * dt / 0.3));
      for (let i = 0; i < n; i++) sub(dt / n, inp, env, events);
      st.v = st.vx * Math.sin(st.h) + st.vy * Math.cos(st.h); // along the heading (a drift's sideways part is in speed)
      st.speed = Math.hypot(st.vx, st.vy);
      // the engine's note: a gear for the speed, revs rising through it, a blip with the throttle
      const sp = Math.abs(st.v);
      let k = 1;
      while (k < SHIFT.length - 1 && sp > SHIFT[k]) k++;
      st.gear = st.v < -0.3 ? 0 : k;
      const band = st.gear ? (sp - SHIFT[k - 1]) / (SHIFT[k] - SHIFT[k - 1]) : sp / 9;
      st.rpm += (clamp(0.18 + 0.72 * band + 0.12 * Math.abs(inp.fwd || 0), 0.15, 1) - st.rpm) * Math.min(1, dt * 6);
      // the ground under the axles and the sides tilts it
      const fx = Math.sin(st.h), fy = Math.cos(st.h), zc = st.z;
      const zf = floor(st.x + fx * C.wheelbase / 2, st.y + fy * C.wheelbase / 2, zc), zr = floor(st.x - fx * C.wheelbase / 2, st.y - fy * C.wheelbase / 2, zc);
      const zl = floor(st.x - fy * C.hw, st.y + fx * C.hw, zc), zrt = floor(st.x + fy * C.hw, st.y - fx * C.hw, zc);
      const ok = v => v != null && Math.abs(v - zc) < 1.2;
      const gp = ok(zf) && ok(zr) ? -Math.atan2(zf - zr, C.wheelbase) : 0, gr = ok(zl) && ok(zrt) ? Math.atan2(zl - zrt, 2 * C.hw) : 0;
      st.pitch += (gp - st.pitch) * Math.min(1, dt * 8);
      st.roll += (gr - st.roll) * Math.min(1, dt * 8);
    }
    function sub(dt, inp, env, events) {
      const fx = Math.sin(st.h), fy = Math.cos(st.h), lx = -fy, ly = fx;
      let vf = st.vx * fx + st.vy * fy, vl = st.vx * lx + st.vy * ly;
      const fwd = clamp(inp.fwd || 0, -1, 1), hb = !!inp.handbrake && !st.air;
      // drive (W) and brake (S); stopped, S reverses and W goes forward again
      if (Math.abs(vf) < 0.6) st.reverse = fwd < -0.05 ? true : fwd > 0.05 ? false : st.reverse;
      const power = st.reverse ? -Math.max(0, -fwd) : Math.max(0, fwd), braking = st.reverse ? Math.max(0, fwd) : Math.max(0, -fwd);
      let a = 0;
      if (!st.air) {
        if (st.reverse) a += power * 4.5 * (1 - clamp(-vf / 9, 0, 1));
        else a += power * A0 * (1 - Math.pow(clamp(vf / VMAX, 0, 1), 1.6));
        const stop = braking * 12.5 + (hb ? 6 : 0) + 0.35 + 0.0009 * vf * vf + (fwd === 0 ? 0.6 : 0);
        const dv = a * dt, dec = stop * dt;
        vf += dv;
        vf = Math.abs(vf) <= dec ? (Math.abs(dv) > dec ? vf : 0) : vf - Math.sign(vf) * dec;
      }
      st.brake = braking > 0.1 && Math.abs(vf) > 0.3;
      // steering: less lock at speed, back to the centre when let go
      const sv = Math.abs(vf), lock = 0.62 / (1 + sv / 13), want = clamp(inp.turn || 0, -1, 1) * lock;
      st.steer += clamp(want - st.steer, -(want ? 2.6 : 4) * dt, (want ? 2.6 : 4) * dt);
      // grip: the tyres bend the path round to the heading, up to ~1 g of turn, keeping the speed but
      // for a scrub while it slides; the handbrake lets go of the rear (less grip, more rotation) and
      // the grip comes back over half a second
      st.grip += ((hb ? 0.3 : 1) - st.grip) * Math.min(1, dt * (hb ? 9 : 2.2));
      if (!st.air) {
        const kin = vf * Math.tan(st.steer) / C.wheelbase * (hb ? 1.6 : 1);
        const cap = (st.grip < 0.9 ? 2.3 : 1.12) * 9.5 / Math.max(2, sv) + (sv < 6 ? 2 : 0);
        st.r += (clamp(kin, -cap, cap) - st.r) * Math.min(1, dt * 7);
      } else st.r *= 1 - Math.min(1, dt * 0.5);
      st.vx = fx * vf + lx * vl; st.vy = fy * vf + ly * vl;
      st.h += st.r * dt;
      const sp = Math.hypot(st.vx, st.vy);
      if (sp > 1e-3 && !st.air) {
        const back = st.reverse && vf < 0, along = st.h + (back ? Math.PI : 0), dir = Math.atan2(st.vx, st.vy), off = angDiff(along, dir);
        const turn = sp < 2.5 ? off : clamp(off * (1 - Math.exp(-dt * 9)), -9.5 * st.grip / sp * dt, 9.5 * st.grip / sp * dt);
        const keep = 1 - Math.abs(Math.sin(off)) * (0.3 + 0.5 * (1 - st.grip)) * dt;
        st.vx = Math.sin(dir + turn) * sp * keep; st.vy = Math.cos(dir + turn) * sp * keep;
        st.slip = sp * Math.abs(Math.sin(off - turn));
      } else st.slip = 0;
      // move, then push the body out of whatever it went into
      const px = st.x, py = st.y;
      st.x += st.vx * dt; st.y += st.vy * dt;
      for (let it = 0; it < 2; it++) collide(env, events);
      // the water's edge, a drop, a wall too high: back to where it was, bouncing off
      const nfx = Math.sin(st.h), nfy = Math.cos(st.h);
      if (offs.some(o => !standable(st.x + nfx * o, st.y + nfy * o, st.z))) {
        const sp = Math.hypot(st.vx, st.vy);
        st.x = px; st.y = py; st.vx *= -0.15; st.vy *= -0.15; st.r *= 0.3;
        if (sp > 2) events.push({ type: 'edge', speed: sp });
      }
      // follow the ground: up kerbs and ramps at once, off an edge under gravity
      const f = floor(st.x, st.y, st.z);
      if (f != null) {
        if (f >= st.z - 0.05) {
          if (st.air && st.vz < -4) events.push({ type: 'land', speed: -st.vz });
          st.z += (f - st.z) * Math.min(1, dt * 20); st.vz = 0; st.air = false;
        } else {
          st.air = st.z - f > 0.25; st.vz -= 9.8 * dt; st.z = Math.max(f, st.z + st.vz * dt);
          if (st.z <= f) { if (st.vz < -4) events.push({ type: 'land', speed: -st.vz }); st.vz = 0; st.air = false; }
        }
      }
    }
    // walls (through nav), other cars (boxes) and people (circles): push the body out along
    // the contact, take the speed into it away (a hard hit bounces), and kick the yaw
    function collide(env, events) {
      const fx = Math.sin(st.h), fy = Math.cos(st.h);
      let nx = 0, ny = 0, moved = false, what = null;
      for (const o of offs) {
        const cx = st.x + fx * o, cy = st.y + fy * o;
        const p = nav.push(cx, cy, st.z, rad, 1.6);
        let dx = p.x - cx, dy = p.y - cy;
        if (dx || dy) what = what || 'wall';
        for (const b of env.boxes || []) { // other cars: the closest point of the box
          if (b.ref === st || st.z > b.z + b.top || st.z + 1.5 < b.z) continue;
          const bx = Math.sin(b.h), by = Math.cos(b.h), ex = cx + dx - b.x, ey = cy + dy - b.y;
          const u = clamp(ex * bx + ey * by, -b.hl, b.hl), w = clamp(-ex * by + ey * bx, -b.hw, b.hw);
          const qx = b.x + bx * u - by * w, qy = b.y + by * u + bx * w, ddx = cx + dx - qx, ddy = cy + dy - qy, d = Math.hypot(ddx, ddy);
          if (d >= rad) continue;
          const k = d > 1e-6 ? (rad - d) / d : 0;
          dx += d > 1e-6 ? ddx * k : -fx * 0.05; dy += d > 1e-6 ? ddy * k : -fy * 0.05;
          what = 'car';
          if (b.onHit) b.onHit();
        }
        for (const q of env.people || []) {
          const ddx = cx + dx - q.x, ddy = cy + dy - q.y, d = Math.hypot(ddx, ddy), min = rad + 0.3;
          if (d >= min || Math.abs(q.z - st.z) > 1.5) continue;
          dx += d > 1e-6 ? ddx * (min - d) / d : 0; dy += d > 1e-6 ? ddy * (min - d) / d : 0;
          what = what || 'person';
          if (q.onHit) q.onHit();
        }
        if (dx || dy) {
          st.x += dx; st.y += dy; nx += dx; ny += dy; moved = true;
          st.r += clamp(o * (dx * fy - dy * fx) * 0.6, -0.3, 0.3); // a hit off the centre turns it
        }
      }
      if (!moved) return;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const vn = st.vx * nx + st.vy * ny;
      if (vn < 0) {
        const e = vn < -6 ? 0.3 : 0.05;
        st.vx -= nx * vn * (1 + e); st.vy -= ny * vn * (1 + e);
        st.vx *= 0.985; st.vy *= 0.985;
        if (events && vn < -1.5) events.push({ type: 'bump', what, speed: -vn });
      }
    }
    return { st, step, box: () => boxOf(st, C.half, C.hw, C.top) };
  }

  // ------------------------------------------------------------ the road network: routes
  // A graph of the road lines (actors.network) joined where their ends meet, as the traffic
  // joins them. A place on it is { line, s, dir }: a line, a distance along it, and the way a
  // car is going (+1 with the line's points, -1 against them).
  function router(net) {
    const L = net.L, ids = new Map(), adj = [];
    const node = (x, y) => { const k = `${Math.round(x / 2)},${Math.round(y / 2)}`; if (!ids.has(k)) { ids.set(k, adj.length); adj.push([]); } return ids.get(k); };
    const ends = L.map((l, i) => {
      const n = l.pts.length / 3, a = node(l.pts[0], l.pts[1]), b = node(l.pts[3 * n - 3], l.pts[3 * n - 2]);
      adj[a].push([b, i, 1]); adj[b].push([a, i, -1]);
      return [a, b];
    });
    const tmp = {};
    // the nearest place on a road to (x, y), within maxD (and, given z, at about that height),
    // going the way that keeps (x, y) on the kerb side (keep: 1 left, -1 right); { line, s, dir, x, y, z, d } or null
    function place(x, y, maxD = 150, keep = 1, z = null) {
      const q = net.nearest(x, y, maxD, z, 3.5);
      if (!q) return null;
      net.at(q.line, q.s, tmp);
      const side = (x - tmp.x) * -tmp.hy + (y - tmp.y) * tmp.hx; // > 0: (x, y) is left of the line's direction
      return { line: q.line, s: q.s, dir: side * keep >= 0 ? 1 : -1, x: q.x, y: q.y, z: q.z, d: q.d };
    }
    // the points of line i from s0 to s1 (either way round), as [x, y, z]
    function stretch(i, s0, s1, out) {
      const l = L[i], n = l.pts.length / 3, up = s1 >= s0;
      const pt = s => { net.at(i, s, tmp); return [tmp.x, tmp.y, tmp.z]; };
      out.push(pt(s0));
      const ks = [];
      for (let k = 1; k < n - 1; k++) if (up ? l.cum[k] > s0 && l.cum[k] < s1 : l.cum[k] < s0 && l.cum[k] > s1) ks.push(k);
      if (!up) ks.reverse();
      for (const k of ks) out.push([l.pts[3 * k], l.pts[3 * k + 1], l.pts[3 * k + 2]]);
      out.push(pt(s1));
    }
    // a route from place a to place b: { pts: [[x, y, z, v, cls]], len } or null. The car leaves
    // a the way it is going, and arrives at b going b's way (so b's kerb is on its kerb side).
    function route(a, b, limit = 6000) {
      const la = L[a.line], lb = L[b.line], segs = [];
      if (a.line === b.line && a.dir === b.dir && (b.s - a.s) * a.dir >= 0) segs.push([a.line, a.s, b.s]);
      else {
        const start = ends[a.line][a.dir > 0 ? 1 : 0], c0 = a.dir > 0 ? la.len - a.s : a.s;
        const goal = ends[b.line][b.dir > 0 ? 0 : 1], c1 = b.dir > 0 ? b.s : lb.len - b.s;
        const dist = new Map([[start, c0]]), prev = new Map(), heap = [[c0, start]];
        const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
        let found = false;
        while (heap.length) {
          const [d, u] = pop();
          if (d > (dist.get(u) ?? Infinity)) continue;
          if (u === goal) { found = true; break; }
          if (d > limit) break;
          for (const [v, li, dir] of adj[u]) {
            const p = prev.get(u), back = p && p[1] === li; // straight back the way it came: a U-turn at the junction
            const nd = d + L[li].len + (back ? 60 : 0);
            if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, [u, li, dir]); push([nd, v]); }
          }
        }
        if (!found) return null;
        const chain = [];
        for (let v = goal; v !== start; v = prev.get(v)[0]) chain.push(prev.get(v));
        chain.reverse();
        segs.push([a.line, a.s, a.dir > 0 ? la.len : 0]);
        for (const [, li, dir] of chain) segs.push([li, dir > 0 ? 0 : L[li].len, dir > 0 ? L[li].len : 0]);
        segs.push([b.line, b.dir > 0 ? 0 : lb.len, b.s]);
      }
      const pts = [];
      for (const [li, s0, s1] of segs) {
        if (Math.abs(s1 - s0) < 1e-3) continue;
        const part = [];
        stretch(li, s0, s1, part);
        for (const p of part) {
          const last = pts[pts.length - 1];
          if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3) continue;
          pts.push([p[0], p[1], p[2], L[li].v || 11, L[li].c]);
        }
      }
      if (pts.length < 2) return null;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return { pts, len, from: a, to: b };
    }
    // a place to start from, about r0..r1 metres away by road from (x, y) (an ordered ride sets out from there)
    function around(x, y, r0, r1) {
      const cand = net.near(x, y, r0, r1);
      for (let k = 0; k < 12 && cand.length; k++) {
        const i = cand[Math.floor(Math.random() * cand.length)], l = L[i];
        if (l.len < 20) continue;
        const s = l.len * (0.3 + Math.random() * 0.4);
        net.at(i, s, tmp);
        const d = Math.hypot(tmp.x - x, tmp.y - y);
        if (d < r0 || d > r1 * 1.2) continue;
        return { line: i, s, dir: Math.random() < 0.5 ? 1 : -1, x: tmp.x, y: tmp.y, z: tmp.z };
      }
      return null;
    }
    // on from the end of a route for a while, turning at random at the junctions (a car driving off)
    function onward(rt, length = 220) {
      const b = rt.to, out = [];
      let li = b.line, dir = b.dir, s = b.s, left = length;
      while (left > 0 && out.length < 40) {
        const l = L[li], s1 = dir > 0 ? l.len : 0, part = [];
        stretch(li, s, s1, part);
        for (const p of part) out.push([p[0], p[1], p[2], l.v || 11, l.c]);
        left -= Math.abs(s1 - s);
        const nx = net.next(li, dir > 0 ? 1 : 0);
        if (!nx) break;
        li = nx[0]; dir = nx[1] === 0 ? 1 : -1; s = dir > 0 ? 0 : L[li].len;
      }
      return out;
    }
    return { place, route, around, onward, ends };
  }

  // a route's points as a path to follow: position, direction (smoothed over a few metres, so the
  // lane's offset turns corners instead of jumping), speed limit and road class at a distance s
  function path(pts) {
    const n = pts.length, cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const len = cum[n - 1];
    // the speed a corner can be taken at, at each point, from the angle the route turns there
    const corner = new Float64Array(n).fill(Infinity);
    for (let i = 1; i < n - 1; i++) {
      const a = Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), b = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const turn = Math.abs(angDiff(b, a));
      if (turn > 0.12) corner[i] = Math.max(4.2, 17 * (1 - turn / 2.3));
    }
    function idx(s) { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lo; }
    function pos(s, out) {
      s = clamp(s, 0, len);
      const i = Math.min(idx(s), n - 2), t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]), a = pts[i], b = pts[i + 1];
      out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.z = a[2] + (b[2] - a[2]) * t;
      out.v = a[3]; out.c = a[4]; out.i = i;
      return out;
    }
    const p0 = {}, p1 = {};
    function at(s, out) {
      pos(s, out);
      pos(s - 3, p0); pos(s + 3, p1);
      let hx = p1.x - p0.x, hy = p1.y - p0.y;
      const l = Math.hypot(hx, hy) || 1;
      out.hx = hx / l; out.hy = hy / l;
      return out;
    }
    return { pts, cum, len, corner, at, pos };
  }

  // ------------------------------------------------------------ the chauffeur
  // Drives a car (from car()) along a route: keeps to the lane on the keep side, slows for
  // bends, for the end, and for anything in its way (others: [{ x, y, half }], judged against
  // where its own lane will be when it gets there, so a car parked at the kerb or coming the
  // other way is no obstacle), and pulls in to the kerb at the end. from: 'kerb' if it starts at
  // the kerb (pulled in), 'lane' if it is already in the traffic; v: its speed now.
  function chauffeur(C, route, { keep = 1, from = 'lane', v = 0, cruise = 15 } = {}) {
    const P = path(route.pts), st = { s: 0, v, x: 0, y: 0, z: 0, h: 0, pitch: 0, done: false, signal: 0, brake: false, steer: 0, lat: 0, route, P };
    const q = {}, q2 = {};
    const end = route.end !== false; // pull in at the end (a car driving off just runs out of road)
    function lat(s) {
      const kerbEnd = kerbOf(P.pos(P.len, q2).c), kerbStart = kerbOf(P.pos(0, q2).c);
      let k = LANE;
      if (end) k += (kerbEnd - LANE) * smooth(P.len - 24, P.len - 4, s);
      if (from === 'kerb') k += (kerbStart - LANE) * (1 - smooth(0, 12, s));
      return k;
    }
    function pose(s, out) {
      P.at(s, out);
      const k = lat(s) * keep;
      out.x += -out.hy * k; out.y += out.hx * k;
      return out;
    }
    pose(0, q);
    st.x = q.x; st.y = q.y; st.z = q.z; st.h = Math.atan2(q.hx, q.hy);
    // the gap (bumper to bumper) to the first of the others in the lane ahead
    const c = {};
    function gapAhead(others) {
      let gap = Infinity;
      const fx = Math.sin(st.h), fy = Math.cos(st.h);
      for (const o of others) {
        const dx = o.x - st.x, dy = o.y - st.y, a = dx * fx + dy * fy;
        if (a <= 0 || a > 60) continue;
        P.at(Math.min(P.len, st.s + a), c);
        const w = (o.x - c.x) * -c.hy + (o.y - c.y) * c.hx;
        if (Math.abs(w - lat(st.s + a) * keep) < 1.5 && a - (o.half || 0.4) - C.half < gap) gap = a - (o.half || 0.4) - C.half;
      }
      return gap;
    }
    function update(dt, others = []) {
      if (st.done) { st.v = 0; st.brake = false; return; }
      // how fast: the limit (or the cruise), bends ahead, the end of the route, the gap ahead
      P.pos(st.s, q);
      let want = Math.min(cruise, q.v || cruise);
      for (let i = q.i + 1; i < P.pts.length && P.cum[i] - st.s < 120; i++) if (P.corner[i] < want) want = Math.min(want, Math.sqrt(P.corner[i] * P.corner[i] + 2 * 3 * (P.cum[i] - st.s)));
      const left = P.len - st.s;
      if (end) want = Math.min(want, Math.sqrt(2 * 2.2 * Math.max(0, left - 0.4)));
      const gap = gapAhead(others);
      want = Math.min(want, gap < 2.8 ? 0 : (gap - 2.8) * 0.9);
      const dv = clamp(want - st.v, -7.5 * dt, 2.6 * dt);
      st.brake = dv < -0.02 * dt * 60 || (st.v < 0.2 && want < 0.1);
      st.v = Math.max(0, st.v + dv);
      st.s = Math.min(P.len, st.s + st.v * dt);
      pose(st.s, q);
      const h0 = st.h;
      st.h += angDiff(Math.atan2(q.x - st.x + q.hx * 0.01, q.y - st.y + q.hy * 0.01), st.h) * Math.min(1, dt * 6) * (st.v > 0.05 ? 1 : 0);
      st.steer = clamp(dt > 0 ? angDiff(st.h, h0) / dt * C.wheelbase / Math.max(1, st.v) : 0, -0.6, 0.6);
      const dz = q.z - st.z;
      st.pitch += (clamp(-Math.atan2(dz, Math.max(0.01, st.v * dt)), -0.2, 0.2) * (st.v > 0.5 ? 1 : 0) - st.pitch) * Math.min(1, dt * 4);
      st.x = q.x; st.y = q.y; st.z = q.z;
      // signal into the kerb at the end, and out of it at the start
      st.signal = end && left < 45 ? -keep : from === 'kerb' && st.s < 18 ? keep : 0;
      if (end && left < 0.5 && st.v < 0.3) { st.done = true; st.v = 0; }
    }
    // straight to the end (skipping the trip)
    function finish() { st.s = P.len; pose(st.s, q); st.x = q.x; st.y = q.y; st.z = q.z; st.h = Math.atan2(q.hx, q.hy); st.v = 0; st.done = end; }
    return { st, update, finish, path: P, box: () => boxOf(st, C.half, C.hw, C.top), remaining: () => P.len - st.s };
  }

  return { car, headlamp, drive, router, path, chauffeur, pushOut, sweep, boxOf, kerbOf, ROADW, LANE, PERF };
})();
