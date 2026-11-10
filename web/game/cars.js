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
// does, in steps short enough not to tunnel), hits lamp posts and tree trunks, bumps into
// other cars and stops for people, and follows the ground, kerbs and bridge decks.
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
  const WEDGE_GIVE = 20; // (s wedged against a car that won't move off, asked to again and again, neither able to back off, before a ride's driver goes on through it)
  const LOOK_STEP = 1.5, LOOK_N = 34; // a driver's way ahead, as the traffic's: points every 1.5 m from the bumper (up to 50 m)
  // how far off the line a car pulls in at the kerb of a road of class c: its kerb-side wheels on the band's edge;
  // on a lane narrowed to a carriageway cw wide (a canal bank's lane, the Philosopher's Path: game.js draws it so,
  // and its trees stand just past it, streets.js) its body's side at the carriageway's edge instead, never inside
  // its lane: with the class's 3.3 m a taxi stopping there stood in the bank's trees (#315)
  const kerbOf = (c, cw) => cw > 0 ? clamp(cw / 2 - 1.0, LANE, 6.5) : clamp((ROADW[c] || 7) / 2 - 0.1, 3.3, 6.5);
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
    const glows = [], gv = new THREE.Vector3(), dv = new THREE.Vector3(), cv = new THREE.Vector3();
    const glow = (p, hex, size, kind) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: lin(hex), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(p).add(new THREE.Vector3(0, 0, Math.sign(p.z) * 0.06));
      s.renderOrder = 3;
      s.userData = { size, kind, op: 0, out: new THREE.Vector3(0, 0, Math.sign(p.z) || 1) };
      // a lamp shines the way it faces: its glow fades out as it is seen side on, and is gone from
      // behind (a headlamp's glow seen from the back of the car read as a white bloom on the car ahead)
      s.onBeforeRender = (r, sc, cam) => {
        s.getWorldPosition(gv); dv.copy(s.userData.out).transformDirection(body.matrixWorld);
        const f = dv.dot(cv.setFromMatrixPosition(cam.matrixWorld).sub(gv).normalize());
        s.material.opacity = s.userData.op * clamp((f + 0.15) / 0.55, 0, 1);
      };
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
        mats.Sign.emissiveIntensity = s.sign ? 0.3 + 0.8 * night : 0; // (a lit panel, not a lamp: no bloom across the car)
        for (const q of glows) { // (the headlamps' glow is for the street, not for whoever is at the wheel: s.inside)
          const k = q.userData.kind === 'head' ? (lit && !s.inside ? 1 : 0) : lit ? (s.brake ? 1.4 : 0.8) : s.brake ? 0.6 : 0;
          q.visible = k > 0.01;
          q.scale.setScalar(q.userData.size * (0.5 + 0.8 * night) * Math.max(0.6, k));
          q.material.opacity = q.userData.op = Math.min(1, k * (0.35 + 0.65 * night));
        }
        // (the beam on a car stopped close ahead, s.near metres: dimmed as the eye would adapt to it,
        // rather than a white wall where a queue's back is lit from 3 m)
        const nearK = s.near != null && s.near < 12 ? Math.max(0.05, (Math.max(0, s.near) / 12) ** 2) : 1;
        if (api.lamp) api.lamp.intensity = lit ? (PHYS() ? 2600 : 1.4) * nearK : 0;
      },
      // a person in a seat, facing forward: the rig's root on the floor in front of the cushion
      // (people.js puts the feet there), the shins forward and, at the wheel, the hands on it. The
      // top of the head keeps clear of the roof over it, with room for the seated idle's sway: a
      // tall person (or a hat) sinks a little into the cushion, and one still too tall for this car
      // sits a little smaller, as a game fits any of its characters to any of its seats. (Out of
      // the car, the rig's root goes back to its own size: game.js stepOut.)
      sit(rig, seat) {
        const p = seats[seat] || seats.driver;
        body.add(rig.root);
        rig.root.position.copy(p).add(new THREE.Vector3(0, -CUSHION, 0));
        rig.root.rotation.set(0, 0, 0);
        rig.root.scale.setScalar(1);
        rig.legRake = 1;
        rig.reach = seat === 'driver' && steering ? hub : null;
        if (rig.headTop) {
          rig.animate(0, 0, 'sit', 0);
          body.updateWorldMatrix(true, true);
          let head = body.worldToLocal(rig.headTop()), room = roofOver(head) - 0.06;
          let over = head.y - room;
          if (over > 0) { const sink = Math.min(0.08, over); rig.root.position.y -= sink; head.y -= sink; over -= sink; }
          // (smaller about the seat moves the head along the roof too, and at the driver's seat that is towards the
          // windscreen's slope, where the roof is lower: so measured again under the roof where the head now is,
          // a few times, and never smaller than 0.72)
          for (let k = 0; k < 4 && over > 0.002; k++) {
            const sc = rig.root.scale.x * Math.max(0.72 / rig.root.scale.x, (room - rig.root.position.y) / Math.max(0.3, head.y - rig.root.position.y));
            if (Math.abs(sc - rig.root.scale.x) < 1e-4) break;
            rig.root.scale.setScalar(sc);
            body.updateWorldMatrix(true, true);
            head = body.worldToLocal(rig.headTop()); room = roofOver(head) - 0.06; over = head.y - room;
          }
        }
      },
      // how far under the roof over it the top of a seated person's head is (m; negative: through it), or null
      clearance(rig, seat) {
        if (!rig.headTop) return null;
        body.updateWorldMatrix(true, true);
        const head = body.worldToLocal(rig.headTop());
        return roofOver(head) + 0.04 - head.y;
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
      // (back to the world, not out of it: a light leaving the scene recompiles every lit material's shader)
      drop(light) { if (api.lamp === light) { body.remove(light, light.target); if (light.userData.home) light.userData.home.add(light, light.target); api.lamp = null; light.intensity = 0; } },
      // off the street for good (a ride that has driven away): its own geometry and materials go too
      dispose() {
        if (api.lamp) api.drop(api.lamp);
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
    l.userData.home = world; // (where it waits, lit by nobody, between cars: cars.js drop)
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
    // one step of dt: inp { fwd -1..1 (W/S), turn -1..1 (+ right), handbrake }; env { boxes, people, posts }; events []
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
      const fx = Math.sin(st.h), fy = Math.cos(st.h), lx = -fy, ly = fx, ph = st.h;
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
      // the water's edge, a drop, a wall too high: back to where it was, bouncing off (the heading
      // too: a turn on the spot would swing the body into the trunk or wall it was pushed out of)
      const nfx = Math.sin(st.h), nfy = Math.cos(st.h);
      if (offs.some(o => !standable(st.x + nfx * o, st.y + nfy * o, st.z))) {
        const sp = Math.hypot(st.vx, st.vy);
        st.x = px; st.y = py; st.h = ph; st.vx *= -0.15; st.vy *= -0.15; st.r *= 0.3;
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
    // other cars (boxes) and people, then walls (through nav), then lamp posts and trunks (circles):
    // push the body out along the contact, take the speed into it away (a hard hit bounces), and
    // kick the yaw. What can move goes first and what can't last, so that a car pressing in from
    // the side can't shove yours into a wall or a trunk (the last push is the one that holds)
    function collide(env, events) {
      const fx = Math.sin(st.h), fy = Math.cos(st.h);
      let nx = 0, ny = 0, moved = false, what = null;
      const shove = (o, dx, dy) => {
        st.x += dx; st.y += dy; nx += dx; ny += dy; moved = true;
        st.r += clamp(o * (dx * fy - dy * fx) * 0.6, -0.3, 0.3); // a hit off the centre turns it
      };
      for (const o of offs) {
        const cx = st.x + fx * o, cy = st.y + fy * o;
        let dx = 0, dy = 0;
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
        if (dx || dy) shove(o, dx, dy);
      }
      // and the corners the three circles leave out: the body as a box against each other car's box,
      // pushed out along the axis it is least deep on (the separating axes)
      for (const b of env.boxes || []) {
        if (b.ref === st || st.z > b.z + b.top || st.z + 1.5 < b.z) continue;
        const ax = [[fx, fy], [-fy, fx], [Math.sin(b.h), Math.cos(b.h)], [-Math.cos(b.h), Math.sin(b.h)]];
        const dx = b.x - st.x, dy = b.y - st.y;
        let best = Infinity, ux = 0, uy = 0;
        for (const [px, py] of ax) {
          const ra = C.half * Math.abs(fx * px + fy * py) + C.hw * Math.abs(-fy * px + fx * py);
          const rb = b.hl * Math.abs(ax[2][0] * px + ax[2][1] * py) + b.hw * Math.abs(ax[3][0] * px + ax[3][1] * py);
          const d = dx * px + dy * py, o = ra + rb - Math.abs(d);
          if (o <= 0) { best = 0; break; }
          if (o < best) { best = o; ux = -Math.sign(d || 1) * px; uy = -Math.sign(d || 1) * py; }
        }
        if (!(best > 0.01)) continue;
        st.x += ux * best; st.y += uy * best; nx += ux * best; ny += uy * best; moved = true;
        what = 'car';
        if (b.onHit) b.onHit();
      }
      // the walls (through nav)
      for (const o of offs) {
        const cx = st.x + fx * o, cy = st.y + fy * o, p = nav.push(cx, cy, st.z, rad, 1.6), dx = p.x - cx, dy = p.y - cy;
        if (dx || dy) { what = what || 'wall'; shove(o, dx, dy); }
      }
      // lamp posts and tree trunks ({ x, y, z, r, kind }), solid: the body as a box, out of each circle
      // from the nearest point of the box to its centre; again while one moves it, so that out of one
      // post it is not left in another beside it (a signal pole by a trunk at a corner), and the
      // thickest last: pinned between two closer than a car's width, it gives at the thin pole, not the trunk
      const PS = env.posts && env.posts.length > 1 ? env.posts.slice().sort((a, b) => a.r - b.r) : env.posts || [];
      for (let pass = 0, again = true; again && pass < 3; pass++) for (const q of (again = false, PS)) {
        if (Math.abs(q.z - st.z) > 2) continue;
        const ex = q.x - st.x, ey = q.y - st.y, u = ex * fx + ey * fy, w = -ex * fy + ey * fx;
        const cu = clamp(u, -C.half, C.half), cw = clamp(w, -C.hw, C.hw), du = u - cu, dw = w - cw, d = Math.hypot(du, dw);
        let pu, pw, m;
        if (d > 1e-6) { if (d >= q.r) continue; m = q.r - d; pu = -du / d; pw = -dw / d; } // (its centre outside the box)
        else { const ou = C.half - Math.abs(u), ow = C.hw - Math.abs(w); if (ou < ow) { m = ou + q.r; pu = -Math.sign(u || 1); pw = 0; } else { m = ow + q.r; pu = 0; pw = -Math.sign(w || 1); } }
        const px = (fx * pu - fy * pw) * (m + 0.005), py = (fy * pu + fx * pw) * (m + 0.005);
        st.x += px; st.y += py; nx += px; ny += py; moved = again = true;
        what = q.kind || 'post';
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
    // carried along by a driver's state c (a chauffeur's st: the autopilot), off by o { x, y, h } while it eases
    // onto the driver's line: the place, the heading and the speed are the driver's, kept here as this car's own,
    // so that the wheel handed back finds the car moving as it was
    function follow(dt, c, o) {
      const ph = st.h, v0 = st.v;
      st.x = c.x + (o ? o.x : 0); st.y = c.y + (o ? o.y : 0); st.h = c.h + (o ? o.h : 0);
      // (on the ground a walker would stand on there, where it is within a step and a half of the road's own height: the
      // wheel handed back must find the car on a floor its own step can drive on, and a road drawn a little under
      // the ground's surface does not sink it)
      const f = nav.floorAt(st.x, st.y, c.z + 1.6);
      st.z = f && f.z > c.z - 1.5 ? (Math.abs(f.z - st.z) < 1 ? st.z + (f.z - st.z) * Math.min(1, dt * 12) : f.z) : c.z;
      st.v = c.v; st.vx = Math.sin(st.h) * c.v; st.vy = Math.cos(st.h) * c.v; st.speed = Math.abs(c.v);
      st.r = dt > 0 ? angDiff(st.h, ph) / dt : 0; st.steer = c.steer || 0; st.brake = !!c.brake; st.slip = 0; st.vz = 0; st.air = false; st.reverse = c.v < -0.05; st.grip = 1;
      const sp = Math.abs(st.v);
      let k = 1;
      while (k < SHIFT.length - 1 && sp > SHIFT[k]) k++;
      st.gear = st.v < -0.3 ? 0 : k;
      const band = st.gear ? (sp - SHIFT[k - 1]) / (SHIFT[k] - SHIFT[k - 1]) : sp / 9, pull = dt > 0 ? clamp((st.v - v0) / dt / 2.6, 0, 1) : 0;
      st.rpm += (clamp(0.18 + 0.72 * band + 0.12 * pull, 0.15, 1) - st.rpm) * Math.min(1, dt * 6);
      st.pull = pull;
      st.pitch += ((c.pitch || 0) - st.pitch) * Math.min(1, dt * 8);
      st.roll += (0 - st.roll) * Math.min(1, dt * 8);
    }
    return { st, step, follow, box: () => boxOf(st, C.half, C.hw, C.top) };
  }

  // ------------------------------------------------------------ the road network: routes
  // A graph of the road lines (actors.network) joined where their ends meet, as the traffic
  // joins them, a one-way street only its way. A place on it is { line, s, dir }: a line, a
  // distance along it, and the way a car is going (+1 with the line's points, -1 against them).
  // avoid: per line, 1 where a car can't get along it (route.js fills it in once it has looked):
  // such a line is taken only where there is no other way
  const WRONG = 25; // (the cost of a metre against a one-way street, on a way where the one-way streets leave none)
  const UTURN = 400; // what a U-turn costs a route, as metres driven (router)
  // what a metre of each class of road costs a route against a main road's, and a turn at a junction, as metres
  // driven: a taxi driver keeps to the main roads and turns as little as the way allows, as a navigator's
  // fastest way does, rather than thread the shortest way through the back streets corner by corner (the way a ride comes for you, loose, stays the shortest: it has to be there soon)
  const ROUTE_CLS = { motorway: 1, trunk: 1, primary: 1, secondary: 1.05, tertiary: 1.15, unclassified: 1.5, residential: 1.6, service: 2, living_street: 2.5 };
  const TURN_COST = 30;
  function router(net, { avoid = null } = {}) {
    const L = net.L, ids = new Map(), adj = [], all = [], into = []; // (all: both ways along every line, for when the one-way streets leave no way; into: the ways in to each node)
    const node = (x, y) => { const k = `${Math.round(x / 2)},${Math.round(y / 2)}`; if (!ids.has(k)) { ids.set(k, adj.length); adj.push([]); all.push([]); into.push([]); } return ids.get(k); };
    const ends = L.map((l, i) => {
      const n = l.pts.length / 3, a = node(l.pts[0], l.pts[1]), b = node(l.pts[3 * n - 3], l.pts[3 * n - 2]);
      if (l.ow !== -1) { adj[a].push([b, i, 1]); into[b].push([a, i, 1]); }
      if (l.ow !== 1) { adj[b].push([a, i, -1]); into[a].push([b, i, -1]); }
      all[a].push([b, i, 1]); all[b].push([a, i, -1]);
      return [a, b];
    });
    const tmp = {};
    // each line's heading at its ends, the way along it (hd[2 * li]: setting off from its start, hd[2 * li + 1]: arriving at its end)
    const hd = new Float32Array(2 * L.length);
    L.forEach((l, i) => {
      const n = l.pts.length / 3, P = l.pts, k = Math.min(n - 1, 2), m = Math.max(0, n - 3);
      hd[2 * i] = Math.atan2(P[3 * k] - P[0], P[3 * k + 1] - P[1]);
      hd[2 * i + 1] = Math.atan2(P[3 * n - 3] - P[3 * m], P[3 * n - 2] - P[3 * m + 1]);
    });
    const headAt = (li, dir, arriving) => (dir > 0 ? hd[2 * li + (arriving ? 1 : 0)] : hd[2 * li + (arriving ? 0 : 1)] + Math.PI);
    const turnCost = (pl, pd, li, dir) => { const a = headAt(li, dir, false) - headAt(pl, pd, true); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 0.6 ? TURN_COST : 0; };
    // the pieces in groups that join, either way along every piece (as route() falls back to): a route
    // only ever joins two places in one group. A group of less than ISLAND metres of road, and a fifth
    // of the biggest, is a fragment cut off from the streets (a drive mapped at a building's level, as
    // by Shibuya Hikarie; a stub the map's edge cuts off): no route reaches it from the rest
    const group = new Int32Array(L.length), glen = [];
    {
      const gn = new Int32Array(adj.length).fill(-1);
      for (let n0 = 0; n0 < adj.length; n0++) {
        if (gn[n0] >= 0) continue;
        const g = glen.push(0) - 1, stack = [n0];
        gn[n0] = g;
        while (stack.length) for (const [v] of all[stack.pop()]) if (gn[v] < 0) { gn[v] = g; stack.push(v); }
      }
      L.forEach((l, i) => { group[i] = gn[ends[i][0]]; glen[group[i]] += l.len; });
    }
    const ISLAND = 600, small = Math.min(ISLAND, 0.2 * glen.reduce((m, v) => Math.max(m, v), 0)), cutOff = i => glen[group[i]] < small;
    // the nearest place on a road to (x, y), within maxD (and, given z, at about that height),
    // going the way that keeps (x, y) on the kerb side (keep: 1 left, -1 right); { line, s, dir, x, y, z, d } or null.
    // within: a group (group(line)) to keep to, so that a route from there reaches it; otherwise one on
    // a fragment cut off from the streets only where no other road is within maxD
    function place(x, y, maxD = 150, keep = 1, z = null, within = null) {
      // the nearest kerb at your level; or, where that is more than twice as far, one down (or up) a
      // slope from you (Melbourne's Federation Square is raised above the streets round it); with none
      // at your level at all, none (a road a level up or down may be no way there)
      const skip = within != null ? i => group[i] !== within : cutOff;
      let q = net.nearest(x, y, maxD, z, 3.5, 0, skip);
      if (q && z != null && q.d > 20) { const sl = net.nearest(x, y, q.d / 2, z, 3.5, 0.1, skip); if (sl) q = sl; }
      if (!q && within == null) q = net.nearest(x, y, maxD, z, 3.5);
      if (!q) return null;
      net.at(q.line, q.s, tmp);
      const side = (x - tmp.x) * -tmp.hy + (y - tmp.y) * tmp.hx; // > 0: (x, y) is left of the line's direction
      return { line: q.line, s: q.s, dir: L[q.line].ow || (side * keep >= 0 ? 1 : -1), x: q.x, y: q.y, z: q.z, d: q.d };
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
    // a the way it is going, and arrives at b going b's way (so b's kerb is on its kerb side),
    // keeping to the one-way streets and the banned turns (net.bans, from junctions.js); where they leave no way (a street mapped one-way out from
    // the edge of the map), along any street.
    // shun: lines to keep off where there is another way (a ride re-routing round a jam).
    // loose: on the search along any street, against a one-way street and through a banned turn at no extra
    // cost, as before (the way a ride comes for you, out of your sight; with you in it, never)
    // (weight: a factor on each piece's cost, by line, or null: the autopilot's scenic way, autopilot.js scenic)
    function route(a, b, limit = 6000, edges = adj, shun = null, loose = false, weight = null) {
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
          if (d > (loose ? limit : limit * 1.6)) break; // (on the costs, a back street dearer than its length)
          const p = prev.get(u), from = p ? p[1] * 2 + (p[2] > 0 ? 1 : 0) : a.line * 2 + (a.dir > 0 ? 1 : 0), B = net.bans && net.bans.get(from);
          for (const [v, li, dir] of edges[u]) {
            // straight back the way it came: a U-turn at the junction, or at the end of the street it
            // set out on. A car turns on the spot there (it has no room for a turning circle in its two
            // lanes), so it goes round the block instead, unless that is UTURN metres further
            const back = p ? p[1] === li : li === a.line;
            // a banned turn (junctions.js), or one at this hour, or a street shut to cars now: never on the
            // legal search; on the search along any street (none legal), allowed at a cost
            const ban = !!(B && B.some(b => b[2] === 1 && b[0] === li && b[1] === (dir > 0 ? 0 : 1))) || !!(net.shutNow && net.shutNow(li, dir > 0 ? 1 : -1) || net.turnShut && net.turnShut(from, li, dir > 0 ? 0 : 1));
            if (ban && edges === adj) continue;
            // (along any street, a street driven against its one way costs WRONG times its length, so the
            // way found keeps to the one-way streets but for the fewest metres it must: a navigator's way
            // in to a street the map lets no car reach, not 300 m against the traffic)
            const wrong = edges !== adj && !loose && L[li].ow && L[li].ow !== dir ? WRONG : 1;
            const nd = d + L[li].len * (loose ? 1 : ROUTE_CLS[L[li].c] || 1.3) * wrong * (avoid && avoid[li] ? 20 : 1) * (shun && shun.has(li) ? 20 : 1) * (weight ? weight[li] : 1) + (back ? UTURN : 0) + (ban && edges !== adj && !loose ? 400 : 0) + (p && !back && !loose ? turnCost(p[1], p[2], li, dir) : 0);
            if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, [u, li, dir]); push([nd, v]); }
          }
        }
        if (!found) return edges === adj ? route(a, b, loose ? limit : limit * 3 + 12000, all, shun, loose, weight) : null;
        const chain = [];
        for (let v = goal; v !== start; v = prev.get(v)[0]) chain.push(prev.get(v));
        chain.reverse();
        segs.push([a.line, a.s, a.dir > 0 ? la.len : 0]);
        for (const [, li, dir] of chain) segs.push([li, dir > 0 ? 0 : L[li].len, dir > 0 ? L[li].len : 0]);
        segs.push([b.line, b.dir > 0 ? 0 : lb.len, b.s]);
      }
      const pts = [], nodes = [], mids = [];
      let run = 0;
      segs.forEach(([li, s0, s1], n) => {
        if (Math.abs(s1 - s0) < 1e-3) return;
        midsAlong(li, s0, s1, run, mids);
        run += Math.abs(s1 - s0);
        const part = [];
        stretch(li, s0, s1, part);
        for (const p of part) {
          const last = pts[pts.length - 1];
          if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3) continue;
          pts.push([p[0], p[1], p[2], L[li].v || 11, L[li].c, L[li].cw || 0]);
        }
        if (n < segs.length - 1) nodes.push({ k: pts.length - 1, line: li, end: s1 > s0 ? 1 : 0 }); // the end of line li, at point k
      });
      if (pts.length < 2) return null;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return { pts, len, from: a, to: b, nodes, mids };
    }
    // the crossings between junctions (junctions.js midsOn, given to the network as net.midsOn) on
    // line li from s0 to s1, with the route's distance to each (run: the route's at s0) and the arm
    // its traffic comes up to them on: pushed onto out as { X, a, at }
    function midsAlong(li, s0, s1, run, out) {
      const Ms = net.midsOn ? net.midsOn(li) : null;
      if (!Ms) return;
      const up = s1 >= s0, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const on = Ms.filter(X => X.mid > lo && X.mid < hi);
      if (!up) on.reverse();
      for (const X of on) {
        const a = X.arms.find(b => b.end === (up ? 1 : 0));
        if (a) out.push({ X, a, at: run + Math.abs(X.mid - s0) });
      }
    }
    // a place to start from, about r0..r1 metres away by road from (x, y) (an ordered ride sets out from there)
    let aroundSeed = 2718; // (its own seeded run: the same place on every run of a harness that drives the clock)
    const arnd = () => ((aroundSeed = (aroundSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
    function around(x, y, r0, r1) {
      const cand = net.near(x, y, r0, r1);
      for (let k = 0; k < 12 && cand.length; k++) {
        const i = cand[Math.floor(arnd() * cand.length)], l = L[i];
        if (l.len < 20) continue;
        const s = l.len * (0.3 + arnd() * 0.4);
        net.at(i, s, tmp);
        const d = Math.hypot(tmp.x - x, tmp.y - y);
        if (d < r0 || d > r1 * 1.2) continue;
        return { line: i, s, dir: l.ow || (arnd() < 0.5 ? 1 : -1), x: tmp.x, y: tmp.y, z: tmp.z };
      }
      return null;
    }
    // places from which a car drives to place b in d0..d1 metres by road (what a ride coming for you
    // sets out from): the network searched backwards from b, and on each road that reaches the
    // band, the point that far out. [{ line, s, dir, x, y, z, d }], up to max of them
    function behind(b, d0, d1, max = 40, ways = into) {
      const out = [], lb = L[b.line];
      const put = (li, s, dir, d) => { if (out.length >= max) return; net.at(li, s, tmp); out.push({ line: li, s, dir, x: tmp.x, y: tmp.y, z: tmp.z, d }); };
      const mid = (d0 + d1) / 2;
      // on b's own road, behind it
      const back = b.dir > 0 ? b.s : lb.len - b.s;
      if (back > d0) put(b.line, b.s - b.dir * Math.min(back - 1, mid), b.dir, Math.min(back - 1, mid));
      const goal = ends[b.line][b.dir > 0 ? 0 : 1], dist = new Map([[goal, back]]), heap = [[back, goal]];
      while (heap.length && out.length < max) {
        let m = 0;
        for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[m][0]) m = i;
        const [d, v] = heap[m]; heap.splice(m, 1);
        if (d > (dist.get(v) ?? Infinity) || d > d1) continue;
        for (const [u, li, fwd] of ways[v]) { // a car on li going from u to v (fwd: its way along li) arrives at v
          if (li === b.line) continue;
          const len = L[li].len, nd = d + len;
          if (nd >= d0 && d < d1 && len > 8) { const x = Math.min(len - 2, Math.max(2, Math.min(mid, d1) - d)); put(li, fwd > 0 ? len - x : x, fwd, d + x); }
          if (nd < (dist.get(u) ?? Infinity) && nd < d1) { dist.set(u, nd); heap.push([nd, u]); }
        }
      }
      // (where the one-way streets leave next to none, along any street, as route() does)
      if (ways === into && out.length < 3) { if (!anyInto) { anyInto = all.map(() => []); all.forEach((l, a) => { for (const [b2, i, d] of l) anyInto[b2].push([a, i, d]); }); } return out.concat(behind(b, d0, d1, max - out.length, anyInto)); }
      return out;
    }
    let anyInto = null;
    // on from the end of a route for a while, turning at random at the junctions (a car driving off)
    // (out.nodes: the junctions it comes up to, as a route's)
    function onward(rt, length = 220) {
      const b = rt.to, out = [];
      out.nodes = []; out.mids = [];
      let li = b.line, dir = b.dir, s = b.s, left = length, run = 0;
      while (left > 0 && out.length < 40) {
        const l = L[li], s1 = dir > 0 ? l.len : 0, part = [];
        midsAlong(li, s, s1, run, out.mids);
        run += Math.abs(s1 - s);
        stretch(li, s, s1, part);
        for (const p of part) out.push([p[0], p[1], p[2], l.v || 11, l.c, l.cw || 0]);
        out.nodes.push({ k: out.length - 1, line: li, end: dir > 0 ? 1 : 0 });
        left -= Math.abs(s1 - s);
        const nx = net.next(li, dir > 0 ? 1 : 0, true);
        if (!nx) break;
        li = nx[0]; dir = nx[1] === 0 ? 1 : -1; s = dir > 0 ? 0 : L[li].len;
      }
      return out;
    }
    return { place, route, around, behind, onward, ends, group: i => group[i], cutOff };
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
      const turn = Math.abs(angDiff(b, a)), seg = Math.min(cum[i] - cum[i - 1], cum[i + 1] - cum[i]);
      if (turn > 0.12) corner[i] = Math.max(turn > 1.7 ? 2.8 : 4.2, 17 * (1 - turn / 2.3)); // (round a hairpin, at a walking pace and a bit)
      // a curve drawn in short pieces (a U-turn's loop): as fast as 2.5 m/s² across it allows
      if (turn > 0.05 && seg < 3) corner[i] = Math.min(corner[i], Math.max(2.5, Math.sqrt(2.5 * seg / turn)));
    }
    function idx(s) { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lo; }
    // the height summed along the route (as FX, FY below), for its average over a stretch
    const FZ = new Float64Array(n);
    for (let i = 1; i < n; i++) FZ[i] = FZ[i - 1] + (cum[i] - cum[i - 1]) * (pts[i - 1][2] + pts[i][2]) / 2;
    function zInt(s) {
      s = clamp(s, 0, len);
      const i = Math.min(idx(s), n - 2), L = Math.max(1e-6, cum[i + 1] - cum[i]), u = s - cum[i];
      return FZ[i] + pts[i][2] * u + (pts[i + 1][2] - pts[i][2]) * u * u / (2 * L);
    }
    // the height averaged over VC metres either side (a vertical curve), so that a car takes the
    // change of grade at a point of the line as a gentle rise or dip, not a kink in a frame
    const VC = 4;
    function pos(s, out) {
      s = clamp(s, 0, len);
      const i = Math.min(idx(s), n - 2), t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]), a = pts[i], b = pts[i + 1];
      out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t;
      const vc = Math.min(VC, s, len - s);
      out.z = vc > 0.05 ? (zInt(s + vc) - zInt(s - vc)) / (2 * vc) : a[2] + (b[2] - a[2]) * t;
      out.v = a[3]; out.c = a[4]; out.cw = a[5] || 0; out.i = i;
      return out;
    }
    const p0 = {}, p1 = {};
    // the route's points summed along it (the integral of x and of y from the start to each point),
    // for the average position over a stretch of it
    const FX = new Float64Array(n), FY = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const L = cum[i] - cum[i - 1];
      FX[i] = FX[i - 1] + L * (pts[i - 1][0] + pts[i][0]) / 2; FY[i] = FY[i - 1] + L * (pts[i - 1][1] + pts[i][1]) / 2;
    }
    const F = [0, 0];
    function integral(s) {
      s = clamp(s, 0, len);
      const i = Math.min(idx(s), n - 2), L = Math.max(1e-6, cum[i + 1] - cum[i]), u = s - cum[i], a = pts[i], b = pts[i + 1];
      F[0] = FX[i] + a[0] * u + (b[0] - a[0]) * u * u / (2 * L); F[1] = FY[i] + a[1] * u + (b[1] - a[1]) * u * u / (2 * L);
      return F;
    }
    // where the route is at s, and its direction: the average of its points over w either side, so
    // that it turns a corner as a curve (the direction changing smoothly, the way it is going
    // always the way it faces) instead of a kink where the car's heading would snap round. w is
    // 3 m; a car held off the line by k takes more (chauffeur pose): turning over less than about
    // 3k, the point k to the inside of a sharp turn would go back as s goes on, and the car with it.
    function at(s, out, w = 3) {
      pos(s, out);
      s = clamp(s, 0, len);
      const ws = Math.min(w, s, len - s);
      if (ws > 0.05) {
        const [x1, y1] = integral(s + ws), [x0, y0] = integral(s - ws);
        out.x = (x1 - x0) / (2 * ws); out.y = (y1 - y0) / (2 * ws);
      }
      const wc = Math.max(ws, Math.min(w, 2)); // (the direction over 2 m at least, near either end too)
      pos(s - wc, p0); pos(s + wc, p1);
      let hx = p1.x - p0.x, hy = p1.y - p0.y;
      const l = Math.hypot(hx, hy) || 1;
      out.hx = hx / l; out.hy = hy / l;
      return out;
    }
    return { pts, cum, len, corner, at, pos };
  }

  // a traffic car in a queue for a junction: queueing itself (c.q), or stopped behind cars, one after
  // another up the lane, the first of which that isn't stopped is queueing (where the traffic's own
  // c.q, set car by car, missed one: a car stopped behind another a little out of line); and a long
  // queue creeping up to its light, cars inching on at walking pace one after another, is a queue
  // all the same (a car moving freely ahead ends it: the one behind is about to move too)
  // (a queue at a junction, o.q; or, for a car of the traffic not parked, one whose queue is moving off ahead: a crawling queue of
  // six behind a red, its head pulling away, read as stopped for good and the ride swung out round it in Shinjuku's game check)
  // (or at the head of the cars in front, one held by a rule of the road: a walker crossing, a light, its turn at a
  // junction, room beyond: a queue, not a car broken down to go round; a ride swung out round one in a queue behind
  // someone crossing mid-block, Queenstown's queue step, #283)
  const RULED = /^(person|zebra|walk|light|amber|stop|cross|turn|room|give|narrow|lane)$/;
  const queueing = (o, ruled = true) => { for (let x = o, k = 0; x && k < 40; x = x.front, k++) { if (x.q) return true; if ((x.v || 0) >= 2.5) return k > 0 && o.still !== true; if (ruled && (!x.front || x.front.line == null)) return RULED.test(x.why || ''); } return false; }; // (ruled false: only a queue at a junction, as before)

  // ------------------------------------------------------------ the chauffeur
  // Drives a car (from car()) along a route: keeps to the lane on the keep side, slows for
  // bends, for the end, and for anything in its way (others: [{ x, y, half }], judged against
  // where its own lane will be when it gets there, so a car parked at the kerb or coming the
  // other way is no obstacle), and pulls in to the kerb at the end. from: 'kerb' if it starts at
  // the kerb (pulled in), 'lane' if it is already in the traffic; v: its speed now. With
  // opts.lights (junctions.js) and route.nodes, it stops at the line for a red light and a stop sign.
  // Where the kerb it is to pull in at is taken (a car parked there, or one stopped for good),
  // it pulls in just behind, as a driver picking you up does, instead of waiting in the lane
  // for it to move; held up for good near the end, it stops where it is, hazards on.
  // hurry(st, dry): a factor on the speeds it drives at, from where it is (a ride coming for
  // you drives briskly while it is out of your sight); dry is set in the dry run that times
  // the trip. timeLeft() is that dry run's time from here to the end: an arrival time that
  // counts down as the car goes and holds while it waits, as a ride app's does. solid(x, y, z, h):
  // how deep a pose is in the traffic's cars; it never takes a step further into them. priority:
  // coming up to traffic lights it asks them for its green, from far enough out (PRIO_T at its speed)
  // that they have changed by the time it gets there, and for its green held (junctions.js priority). now(): the traffic's
  // clock; given it, the driver goes into a junction as the traffic does, by asking junctions.js
  // for its way across (request: none crossing it already in, the longest waiting first, giving
  // way to the main road), and is out of it once the whole car is past the exit's line; leave()
  // takes it out of every junction (the car taken off the street, or given another route).
  // A route that turns straight back on itself (a U-turn where a street leads on to nowhere a car may
  // go) as a car makes one: from UT_D metres before the turn it bears off to its kerb side, swings
  // round a loop of UT_R metres' radius across the road, ahead of the turning point, and comes back
  // in on the other side, instead of turning on the spot. The route's junction nodes and crossings
  // keep their places on it.
  // whether the queue a car b heads, or is in, waits at a junction with signals (its light, a scramble's walk, a
  // movement crossing it there): it moves when the light changes
  function atSignal(b) {
    let h = b, k = 0;
    while (h && h.front && h.front.line != null && (h.why === 'car' || h.why === 'held') && k < 30) { h = h.front; k++; }
    return !!(h && h.line != null && h.lineArm && h.lineArm.j.sig && ['light', 'walk', 'cross', 'turn', 'room'].includes(h.why) && h.toLine - h.half < 4);
  }
  const UT_R = 4.5, UT_D = 9;
  function uTurns(route, keep) {
    let pts = route.pts, nodes = route.nodes, mids = route.mids, changed = false;
    for (let guard = 0; guard < 8; guard++) {
      const n = pts.length, cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      let at = -1;
      for (let i = 1; i < n - 1 && at < 0; i++) {
        const a = Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), b = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        if (Math.abs(angDiff(b, a)) > 2.6) at = i;
      }
      if (at < 0) break;
      const V = pts[at], sV = cum[at], D = Math.min(UT_D, sV - 0.3, cum[n - 1] - sV - 0.3);
      if (D < 3) break; // (no room to make it: as it was)
      const R = Math.min(UT_R, D * 0.6), beta = Math.asin(R / D);
      const back = (s, out = []) => { // the point at distance s along the route
        let i = 1;
        while (i < n - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = pts[i - 1], b = pts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3], a[4]];
      };
      const A = back(sV - D), A2 = back(sV + D);
      let dx = V[0] - A[0], dy = V[1] - A[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const ux = dy * keep, uy = -dx * keep; // across, away from the kerb (right where they keep left)
      // the loop: centred on the turning point, out from A on its kerb side (-u) and back to A2 on the other
      const loop = [], cx = V[0], cy = V[1]; // (bearings as atan2(x, y))
      // the tangent points: from A, beta off the line towards -u
      const t1 = Math.atan2(-ux * Math.cos(beta) - dx * Math.sin(beta), -uy * Math.cos(beta) - dy * Math.sin(beta));
      const sweep = Math.PI + 2 * beta, m = Math.max(8, Math.ceil(sweep * R / 0.9));
      // round the far side of the turning point, from -u to +u: the way whose halfway point is ahead
      const sg = Math.sin(t1 + sweep / 2) * dx + Math.cos(t1 + sweep / 2) * dy > 0 ? 1 : -1;
      for (let k = 0; k <= m; k++) {
        const th = t1 + k / m * sweep * sg;
        loop.push([cx + Math.sin(th) * R, cy + Math.cos(th) * R, V[2], Math.min(V[3] || 11, 5), V[4]]);
      }
      const iA = pts.findIndex((q, i) => cum[i] > sV - D), iB = pts.findIndex((q, i) => cum[i] >= sV + D);
      const out = pts.slice(0, iA).concat([A], loop, [A2], pts.slice(iB < 0 ? n : iB));
      // where the nodes and the crossings now are: shifted by the points and the length the loop adds
      let L2 = 0;
      const seq = [A, ...loop, A2];
      for (let k = 1; k < seq.length; k++) L2 += Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1]);
      const dn = (iA + seq.length) - (iB < 0 ? n : iB), ds = L2 - 2 * D;
      // (a node at the turning point itself: at the start of the loop, so that its line is before it)
      if (nodes) nodes = nodes.map(nd => (nd.k >= iA && nd.k < (iB < 0 ? n : iB) ? Object.assign({}, nd, { k: iA + (nd.k < at ? 0 : nd.k === at ? 1 : seq.length - 1) }) : nd.k >= (iB < 0 ? n : iB) ? Object.assign({}, nd, { k: nd.k + dn }) : nd));
      if (mids) mids = mids.map(x => (x.at > sV ? Object.assign({}, x, { at: x.at + ds }) : x));
      pts = out; changed = true;
    }
    return changed ? Object.assign({}, route, { pts, nodes, mids, len: pts.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0) }) : route;
  }
  function chauffeur(C, route, { keep = 1, from = 'lane', v = 0, cruise = 15, hurry = null, solid = null, makeWay = null, wedge = WEDGE_GIVE, lights = null, priority = false, now = null, strict = false, id = 'ride' } = {}) {
    // (strict: the autopilot of your own car, always in your sight: its guard against stepping into a car reads its
    // body as it is turned, not only as its way is, so that creeping on out of a tangle it never clips one on a bend.
    // id: its name among the traffic's blockers, game.js: a car that stands for it is not one stopped for good)
    route = uTurns(route, keep);
    const ruledQ = !hurry; // (a queue held by a rule of the road, not only one at a junction, is waited in: with you in it, not on the way to you, which keeps its time)
    const P = path(route.pts), st = { s: 0, v, x: 0, y: 0, z: 0, h: 0, pitch: 0, done: false, signal: 0, brake: false, steer: 0, lat: 0, shift: 0, pass: 0, stall: 0, wedged: 0, held: 0, end: P.len, route, P,
      half: C.half, hw: C.hw, ps: new Float32Array(2 * LOOK_N), np: 0, pst: LOOK_STEP, toLine: Infinity, backoff: 0 };
    // as junctions.js sees it: a car of the traffic (line >= 0 while it is on the street, half, v)
    const reg = !!(lights && lights.request && now && route.nodes);
    if (reg) { st.line = 0; st.half = C.half; st.mv = st.mv0 = st.wj = null; }
    let outAt = Infinity, out0At = Infinity; // where the whole car is past the exit's line of the junction it is in (st.mv), and of the one before (st.mv0)
    // the way across the junction at route.nodes[i] (arm a): the exit onto the first piece of the
    // route beyond the junction's own, and where on the route that exit's stop line is; or null
    const exits = new Map();
    function exitOf(i, a) {
      if (exits.has(i)) return exits.get(i);
      const N = route.nodes, inner = a.j.inner;
      let r = null;
      for (let k = i + 1; k <= N.length; k++) {
        const line = k < N.length ? N[k].line : route.to ? route.to.line : null;
        if (line == null) break;
        if (inner && inner.has(line)) continue;
        const e = (lights.exits ? lights.exits(a) : []).find(x => x.m.line === line);
        if (e) r = { e, at: P.cum[Math.min(N[k - 1].k, P.cum.length - 1)] + (e.m.back || 0) };
        break;
      }
      exits.set(i, r);
      return r;
    }
    // in at arm a by ex: request() has let it in, or (forced) it is over the line already
    function into(a, ex, forced, last = st.mv && st.mv.j !== a.j ? outAt : null) {
      if (forced) lights.enter(st, a, ex.e, now(), true);
      if (last != null) out0At = last; // (still leaving the one before, close by)
      outAt = ex.at + C.half + 0.5;
      st.entered = (st.entered || 0) + 1; st.junction = null; // (for the checks)
    }
    function leave() {
      if (!reg || st.line < 0) return;
      lights.forget(st); st.line = -1; outAt = out0At = Infinity;
    }
    const q = {}, q2 = {};
    const end = route.end !== false; // pull in at the end (a car driving off just runs out of road)
    const kerbStart = kerbOf(P.pos(0, q2).c, q2.cw);
    let kerbEnd = kerbOf(P.pos(P.len, q2).c, q2.cw);
    // the way it keeps off the centre line at s: the lane, easing in to the kerb at the end and out of it at the start
    // (the lane's place on each piece of road on the way: LANE off the line, or on it along a one-way
    // road of one lane, as the traffic drives it (junctions.js shiftOf, #177); eased over 6 m either side
    // of where one piece meets the next)
    const laneRuns = [];
    if (lights && lights.centred && route.nodes) {
      let a0 = 0;
      for (const nd of route.nodes) { const b = P.cum[Math.min(nd.k, P.cum.length - 1)]; laneRuns.push([a0, b, lights.centred(nd.line) ? 0 : LANE]); a0 = b; }
      if (route.to && route.to.line != null) laneRuns.push([a0, P.len, lights.centred(route.to.line) ? 0 : LANE]);
      if (laneRuns.every(r => r[2] === LANE)) laneRuns.length = 0;
    }
    function laneAt(s) {
      if (!laneRuns.length) return LANE;
      let i = 0;
      while (i < laneRuns.length - 1 && s > laneRuns[i][1]) i++;
      const r = laneRuns[i], E = 6;
      if (i > 0 && s - r[0] < E) return laneRuns[i - 1][2] + (r[2] - laneRuns[i - 1][2]) * smooth(r[0] - E, r[0] + E, s);
      if (i < laneRuns.length - 1 && r[1] - s < E) return r[2] + (laneRuns[i + 1][2] - r[2]) * smooth(r[1] - E, r[1] + E, s);
      return r[2];
    }
    function lat(s) {
      const L0 = laneAt(s);
      let k = L0;
      if (end) k += (kerbEnd - L0) * smooth(st.end - 24, st.end - 4, s);
      if (from === 'kerb') k += (kerbStart - L0) * (1 - smooth(0, 12, s));
      return k;
    }
    const pa = {}, pb = {};
    function pose(s, out, k) {
      k = k * keep + st.shift;
      const w = Math.max(3, 3 * Math.abs(k) + 0.5);
      // on the inside of a sharp turn it keeps within the turn's radius there (as a driver swings a
      // little wide round a hairpin), else its point would stop, or go back, while the route goes on
      P.at(s - 0.5, pa, w); P.at(s + 0.5, pb, w);
      const turn = angDiff(Math.atan2(pb.hx, pb.hy), Math.atan2(pa.hx, pa.hy)), run = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (k * turn < 0 && Math.abs(turn) > 1e-4 && s > 0.5 && s < P.len - 0.5) { const kmax = 0.6 * run / Math.abs(turn); if (Math.abs(k) > kmax) k = Math.sign(k) * kmax; }
      P.at(s, out, w);
      out.x += -out.hy * k; out.y += out.hx * k;
      return out;
    }
    // the end, brought forward (behind a car at the kerb it was to pull in at)
    function endAt(e) {
      st.end = clamp(e, st.s, P.len);
      kerbEnd = kerbOf(P.pos(st.end, q2).c, q2.cw);
    }
    st.lat = lat(0);
    pose(0, q, st.lat);
    st.x = q.x; st.y = q.y; st.z = q.z; st.h = Math.atan2(q.hx, q.hy);
    // the gap (bumper to bumper) to the first of the others in the lane ahead. A car stopped in the
    // lane (o.v about 0, o.still) is passed: the driver swings out towards the centre line round
    // it (st.pass, eased into st.shift) instead of waiting behind it for good, but not while a car
    // is coming along the side of the road it would swing out into: it waits behind until that has
    // gone by.
    const c = {}, passing = [], passed = [], rounding = new Set();
    let still = false, queued = false;
    function gapAhead(others, dt = 0) {
      let gap = Infinity, pass = 0;
      still = queued = false; passing.length = 0; passed.length = 0;
      st.block = null; // what sets the gap (for the game check)
      const fx = Math.sin(st.h), fy = Math.cos(st.h);
      // the back of the nearest car in the lane ahead queueing for a junction (o.q): a car stopped short
      // of a queue is passed only with room to pull back in ahead of it, short of the queue, and never
      // up the side of the queue itself
      let qBack = Infinity;
      for (const o of others) {
        if (!queueing(o, ruledQ)) continue;
        const dx = o.x - st.x, dy = o.y - st.y, a = dx * fx + dy * fy;
        if (a <= 0 || a > 100) continue;
        P.at(Math.min(P.len, st.s + a), c);
        const w = (o.x - c.x) * -c.hy + (o.y - c.y) * c.hx, lane = lat(st.s + a) * keep;
        if (Math.abs(w - lane - st.shift) < Math.max(1.5, (o.hw || 0.4) + C.hw + 0.1)) qBack = Math.min(qBack, a - (o.half || 0.4));
      }
      for (const o of others) {
        const dx = o.x - st.x, dy = o.y - st.y, a = dx * fx + dy * fy;
        if (a <= 0 || a > 60) continue;
        P.at(Math.min(P.len, st.s + a), c);
        const w = (o.x - c.x) * -c.hy + (o.y - c.y) * c.hx, lane = lat(st.s + a) * keep, half = o.half || 0.4, room = Math.max(1.5, (o.hw || 0.4) + C.hw + 0.1);
        // held up for 6 s, a car stopped ahead counts as stopped for good: one caught up with this one
        // turns round every few seconds and so never stays stuck long enough to be marked still
        // (but never one queueing at a junction, o.q: a queue at a red light is waited out in the lane,
        // not overtaken up the oncoming side to its head)
        // (o.still: true, a flag the game sets, or a traffic car's own count of the seconds it has stood:
        // over 6 s, and not queueing, it is stopped for good, as one caught up with this one at a kerb)
        // (and one it has begun to swing out round stays one while it stands there: its held time is
        // reset at a red light, and the car would else drop out and back in from frame to frame)
        // (nor one whose car ahead is moving off: a queue that has begun to move, its tail not yet off)
        const oq = queueing(o, ruledQ), oc = o.of || o;
        // (nor one that stands waiting on this very ride: it is not stopped for good, and the ride backs off for it instead, game.js)
        const stopped = !oq && !(oc.why === 'you' && (oc.youBy || '').startsWith(id)) && !(o.front && (o.front.v || 0) >= 0.5) && qBack - (a + half) > 2 * C.half + 4 && (o.still === true || o.still > 6 || (st.held > 6 && (o.v || 0) < 0.1) || (rounding.has(o) && (o.v || 0) < 0.5)) && a < 40 && (!end || st.end - st.s - (a + half) > 2 * C.half + 8 || !o.stay); // (not one parked where it is to pull in: one parked short of it, with room past it to pull back in to the kerb, it goes round, and pulls in beside you, not 20 m back behind it)
        // (side by side, clear; a stopped car in its lane is judged by the lane, not by where it has
        // swung out to: else, once out, it would count as clear, swing back in, and so on every frame)
        if (Math.abs(w - lane - (stopped ? 0 : st.shift)) >= room) continue;
        if (stopped) {
          const by = w - keep * ((o.hw || 0.9) + C.hw + 0.4) - lane; // its centre-line side, a hand's width clear
          if (Math.abs(by) < 4.5) { if (Math.abs(by) > Math.abs(pass)) pass = by; passing.push([a - half - C.half, !!o.stay]); passed.push(o); o.whyRound = (o.still === true ? 'flagged still' : o.still > 6 ? `stood ${o.still.toFixed(0)} s` : st.held > 6 && (o.v || 0) < 0.1 ? `held ${st.held.toFixed(0)} s` : 'went round already') + (o.why != null ? ` as ${o.why || '-'}${o.youBy ? ' (' + o.youBy + ')' : ''}${o.front ? ' behind ' + (o.front.why || '-') + (o.front.q ? ' q' : '') : ''}` : ''); continue; } // (and what it stood for, for the checks)
        }
        if (a - half - C.half < gap) { gap = a - half - C.half; still = !!o.stay; st.block = o; queued = oq; }
      }
      if (pass && Math.abs(st.shift) < 0.2) for (const o of others) { // (a car coming the other way)
        if (passed.includes(o)) continue;
        const dx = o.x - st.x, dy = o.y - st.y, a = dx * fx + dy * fy;
        if (a <= -C.half || a > 70) continue;
        P.at(Math.min(P.len, st.s + Math.max(0, a)), c);
        const w = (o.x - c.x) * -c.hy + (o.y - c.y) * c.hx, lane = lat(st.s + Math.max(0, a)) * keep;
        if (Math.abs(w - lane - pass) < (o.hw || 0.4) + C.hw + 0.4) { pass = 0; break; }
      }
      // (a driver pulls out only once the way round has looked clear for a second, not on a frame's glimpse
      // of it: one queueing that reads for a moment as stopped for good is never swung out round)
      st.passT = pass ? (st.passT || 0) + dt : 0;
      if (pass && Math.abs(st.shift) < 0.2 && st.passT < 1) pass = 0;
      // (one it would go round but can't yet, for a car coming or the second's look: waited behind,
      // not taken for the place to pull in at, which would end the ride behind it for good)
      if (!pass) for (const [g, stay] of passing) if (g < gap) { gap = g; still = stay && !end; }
      rounding.clear();
      if (pass) for (const o of passed) rounding.add(o);
      st.pass = pass; st.passed = passed; // (what it goes round, for the game check)
      if (pass) st.rounded = { cars: passed.slice(), held: st.held }; // (and what it last went round, kept: the game check samples it between steps)
      return gap;
    }
    // its way ahead, as the traffic's (actors.js): points every LOOK_STEP metres from its front bumper
    // along its lane (as it will be when it gets there, the swing out it is taking included), far enough
    // to stop in at its speed and a little more. What it looks along for cars at an angle to it, and what
    // the traffic reads of it to give way (or not) where their ways meet
    const lq = {};
    function look() {
      const reach = clamp(st.v * st.v / 6 + st.v + 14, 18, (LOOK_N - 1) * LOOK_STEP);
      let n = 0;
      for (let d = 0; d <= reach && n < LOOK_N; d += LOOK_STEP) {
        const s = st.s + C.half + d;
        if (s > st.end + C.half) break;
        P.at(Math.min(P.len, s), lq);
        const k = lat(s) * keep + (d < 6 ? st.shift : st.pass || st.shift);
        st.ps[2 * n] = lq.x - lq.hy * k; st.ps[2 * n + 1] = lq.y + lq.hx * k; n++;
      }
      st.np = n;
    }
    // the first point of a way (n points step apart) inside car o's footprint grown by (gl, gw): the
    // distance along it, or -1 (refined between points, as actors.js hitAt)
    function hitIn(Pa, n, o, gl, gw, step) {
      const hx = Math.sin(o.h), hy = Math.cos(o.h);
      const inside = (x, y) => { const dx = x - o.x, dy = y - o.y; return Math.abs(dx * hx + dy * hy) < gl && Math.abs(-dx * hy + dy * hx) < gw; };
      for (let k = 0; k < n; k++) {
        if (!inside(Pa[2 * k], Pa[2 * k + 1])) continue;
        if (k === 0) return 0;
        let lo = 0, hi = 1;
        for (let it = 0; it < 4; it++) { const m = (lo + hi) / 2; if (inside(Pa[2 * k - 2] + (Pa[2 * k] - Pa[2 * k - 2]) * m, Pa[2 * k - 1] + (Pa[2 * k + 1] - Pa[2 * k - 1]) * m)) hi = m; else lo = m; }
        return (k - 1 + hi) * step;
      }
      return -1;
    }
    // the gap to the first car at an angle to it whose box its way runs into: one turning across it in a
    // junction, coming out of a side street, nosing out of a queue, one stopped across the road. gapAhead
    // judges cars by where their centres are across from its lane, which misses the corner of one at an
    // angle, and along a straight line from its bonnet, which misses one round a corner it is turning;
    // here it looks along its way as the traffic does. Where the other's way runs into it too, they go by
    // the traffic's rule (junctions.js first, from actors.js: the one that can no longer stop, the one in
    // the junction, the nearer), so that one goes and the other waits, never both; a car it goes first
    // of is not braked for (it gives way: actors.js reads this car's way, st.ps, as it reads its own).
    // xMutual: the car it waits for is waiting for it too (stopped, its way into this car's box)
    function crossGap(others) {
      let gap = Infinity;
      st.xBlock = null; st.xMutual = false;
      if (!st.np) return gap;
      for (const o of others) {
        if (o.h == null || o.walker || passed.includes(o)) continue;
        if (Math.abs(o.x - st.x) > 60 || Math.abs(o.y - st.y) > 60) continue;
        const d = hitIn(st.ps, st.np, o, o.half + 0.6, (o.hw || 0.9) + C.hw + 0.25, LOOK_STEP);
        if (d < 0) continue;
        const d2 = o.np ? hitIn(o.ps, o.np, st, C.half + 0.6, C.hw + (o.hw || 0.9) + 0.25, o.pst || LOOK_STEP) : -1;
        if (d2 >= 0 && lights && lights.first && lights.first(st, o, d, d2, -1, 0)) continue;
        if (d + 0.6 < gap) { gap = d + 0.6; st.xBlock = o; st.xMutual = d2 >= 0 && (o.v || 0) < 0.3; }
      }
      return gap;
    }
    // the gap to the line of the next junction ahead, if it must stop there (Infinity if not)
    const halted = new Set();
    const PRIO_T = 12; // (s: the other road's few seconds of green, amber and all red, and a little to spare)
    function lineGap(dtNow = 0) {
      st.toLine = Infinity;
      if (!lights || !route.nodes) return Infinity;
      for (let i = 0; i < route.nodes.length; i++) {
        const nd = route.nodes[i], sN = P.cum[Math.min(nd.k, P.cum.length - 1)];
        if (sN - st.s > 90 && !(priority && sN - st.s < PRIO_T * Math.max(st.v, 4) + 20)) break;
        const a = lights.armAt(nd.line, nd.end);
        if (!a) continue;
        if (sN - st.s > 90) { if (lights.priority && a.j.sig) lights.priority(a); break; } // (far off, but at speed: the signals called in time)
        const toLine = sN - a.back - st.s;
        if (toLine >= C.half - 0.5 && st.toLine === Infinity) st.toLine = toLine; // (its centre to the next line ahead: as the traffic's c.toLine, for the rule at a conflict)
        if (toLine < C.half - 0.5) { // over its line already (a route that starts there): in the junction, so through it
          if (reg && st.line >= 0 && toLine > -C.half && !(st.mv && st.mv.a === a) && !(st.mv0 && st.mv0.a === a)) { const ex = exitOf(i, a); if (ex && st.s < ex.at) into(a, ex, true); }
          continue;
        }
        const ex = reg && st.line >= 0 ? exitOf(i, a) : null;
        const lt = lights.light(a, ex ? ex.e : null); // (with its way across: a turn across the oncoming traffic has its arrow where there is one)
        // seen by the signals coming up to them, as the traffic is (a call for its green)
        if (lights.approach && toLine - C.half < 60) lights.approach(st, a, ex ? ex.e.m.i : -1, Math.max(0, toLine - C.half) / Math.max(st.v, 2));
        if (priority && lights.priority) lights.priority(a); // (a ride on its way to you: its green by the time it gets there, and held for it)
        if (a.sign === 'stop' && st.v < 0.3 && toLine - C.half < 2.5) halted.add(nd.k);
        const stop = lt === 'r' || (lt === 'y' && st.v * st.v / 8 < toLine - C.half - 0.3) || (a.sign === 'stop' && !halted.has(nd.k));
        if (ex) {
          const t = now(), canStop = st.v * st.v / 8 < toLine - C.half - 0.3;
          if (st.mv && st.mv.a === a) { // in it already: on through, unless the light changed before it got there
            if (lt != null && lt !== 'g' && canStop) { lights.release(st); outAt = Infinity; } else return Infinity;
          }
          if (!stop && toLine < C.half + 4 + st.v * st.v / 6) {
            // (room beyond for the whole car, as the traffic waits for it: never stopped in the box across the others' way)
            // (after 12 s at its line waiting for room, it goes in all the same, as the traffic's cars do (actors.js
            // boxT): the exit's queue moves up as it crosses, and a ride coming for you stood half a minute at a
            // green in Shinjuku's game check)
            const fits = !lights.room || lights.room(st, ex.e);
            st.roomT = fits || toLine - C.half > 4 ? 0 : (st.roomT || 0) + dtNow;
            const roomy = fits || st.roomT > (priority ? 5 : 12); // (a ride on its way to you, its green called ahead, the sooner)
            const last = st.mv && st.mv.j !== a.j ? outAt : null, r = roomy ? lights.request(st, a, ex.e, t) : 'room';
            if (r === true) { into(a, ex, false, last); return Infinity; }
            if (toLine - C.half < 2.5 && st.v < 0.6 && roomy) { lights.wait(st, a, ex.e, t); st.wj = a.j; } // its turn comes: the longest waiting goes first
            st.junction = r; st.lineAt = a; // why it waits (for the game check), and where
            return toLine - C.half + 2.6;
          }
        }
        if (stop) { st.junction = lt === 'r' ? 'red' : lt === 'y' ? 'amber' : 'stop sign'; st.lineAt = a; return toLine - C.half + 2.6; }
        return Infinity;
      }
      return Infinity;
    }
    // the gap to the line of a crossing between junctions ahead (route.mids, from the router), if it
    // must stop there: at its red, or at amber if it can stop by the line, as the traffic does; at a
    // zebra while someone is on the stripes or stepping onto them (lights.onStripes, from the
    // traffic: actors.js), and after 15 s held there by someone standing on them it edges on
    // for 6 s, braking for them as for anyone in the road. Infinity if it needn't.
    let zebraT = 0, zebraOff = 0;
    function midGap(dt) {
      const M = route.mids;
      if (!lights || !M || !M.length) return Infinity;
      if (zebraOff > 0) zebraOff -= dt;
      for (const m of M) {
        const front = m.at - m.a.back - st.s - C.half; // its front bumper to the line
        if (front < -0.5) continue; // over it already: on across
        if (front > 90) break;
        let hold = false;
        if (m.X.sig) {
          const lt = lights.light(m.a);
          hold = lt === 'r' || (lt === 'y' && st.v * st.v / 8 < front - 0.3);
          if (priority && lt === 'g' && lights.priority) lights.priority(m.a); // (its green held while it comes: never the walkers' cut short)
        } else if (lights.onStripes && !(zebraOff > 0) && st.v * st.v / 14 < front + 0.5) hold = lights.onStripes(m.X); // (if it can stop by then, braking as hard as it does: update)
        zebraT = hold && !m.X.sig && st.v < 0.3 ? zebraT + dt : 0;
        if (zebraT > 15) { zebraT = 0; zebraOff = 6; }
        if (!hold) return Infinity;
        st.junction = m.X.sig ? 'crossing red' : 'zebra'; st.lineAt = m.a;
        return front + 2.6;
      }
      return Infinity;
    }
    // the signals at the next junction ahead on its way, asked for its green in time (PRIO_T), as lineGap does
    function callAhead() {
      if (!lights || !lights.priority || !route.nodes) return;
      for (const nd of route.nodes) {
        const sN = P.cum[Math.min(nd.k, P.cum.length - 1)];
        if (sN < st.s) continue;
        if (sN - st.s > PRIO_T * Math.max(st.v, 4) + 20) return;
        const a = lights.armAt(nd.line, nd.end);
        if (!a) continue;
        if (a.j.sig && sN - a.back > st.s) lights.priority(a);
        return;
      }
    }
    // what holds it up, as a self-driving car's screen puts it ('' when nothing does): the line ahead and
    // why it stops there, the car it gives way to, the queue, the people crossing, the car it goes round
    const LINE_SAYS = { red: 'Stopping for the red light', amber: 'Stopping for the amber light', 'stop sign': 'Stopping at the stop sign',
      'crossing red': 'Stopping at the crossing', zebra: 'Giving way to people crossing', cross: 'Waiting for the junction to clear',
      turn: 'Waiting its turn at the junction', give: 'Giving way to the main road', room: 'Waiting for room beyond the junction' };
    function intentOf(slowed, atLine, across) {
      if (st.done) return '';
      if (st.backoff > 0) return 'Backing up to let a car through';
      if (st.mirror) return 'Waiting for a gap to pull out';
      if (st.pass || Math.abs(st.shift) > 0.2) return 'Going round a stopped car';
      if (!slowed) return '';
      if (atLine) return LINE_SAYS[st.junction] || 'Stopping at the line';
      const b = st.block;
      if (b && b.walker) return 'Waiting for people crossing';
      if (b && !b.half) return 'Waiting for someone in the road';
      if (across) return b && b.mv ? 'Giving way to a car turning across' : 'Giving way to a car crossing';
      if (queued) return 'In the queue for the junction';
      return st.v < 0.5 ? 'Waiting behind the car ahead' : 'Following the car ahead';
    }
    // is a car coming up the lane it pulls out into, behind it, within 3.5 s?
    const mq = {};
    function mirror(others) {
      P.at(st.s, mq);
      for (const o of others) {
        if (o.h == null || !o.half || o.walker) continue;
        const dx = o.x - mq.x, dy = o.y - mq.y, a = dx * mq.hx + dy * mq.hy, w = -dx * mq.hy + dy * mq.hx;
        if (a > 0 || a < -45 || Math.abs(w - LANE * keep) > 1.6 || (o.v || 0) < 2) continue; // (behind it in the lane, and moving)
        if (Math.sin(o.h) * mq.hx + Math.cos(o.h) * mq.hy < 0.6) continue; // (going its way)
        if ((-a - C.half - o.half) / o.v < 3.5) return true;
      }
      return false;
    }
    // may it back off by ds along its way: not off the start of its route, and (given solid) not into a car behind
    const bq = {};
    function backable(ds = 1.5) {
      if (st.s - ds < 0.5) return false;
      if (!solid) return true;
      pose(st.s - ds, bq, st.lat);
      return solid(bq.x, bq.y, bq.z, Math.atan2(bq.hx, bq.hy)) <= solid(st.x, st.y, st.z, st.h) + 0.01;
    }
    // dry: the dry run that times the trip (no lights, nothing in the way); obey: stop at the lights
    function update(dt, others = [], dry = false, obey = true) {
      if (reg && st.line >= 0) { // out of a junction once the whole car is past its exit's line
        if (st.mv0 && st.s > out0At) { lights.release(st, 'mv0'); out0At = Infinity; }
        if (st.mv && st.s > outAt) { lights.release(st); outAt = Infinity; }
      }
      if (st.done) { leave(); st.v = 0; st.brake = false; return; }
      // how fast: the limit (or the cruise), bends ahead, the end of the route, the gap ahead
      P.pos(st.s, q);
      const hz = hurry ? hurry(st, dry) : 1;
      let want = Math.min(cruise, q.v || cruise) * hz;
      for (let i = q.i + 1; i < P.pts.length && P.cum[i] - st.s < 120; i++) if (P.corner[i] < want) want = Math.min(want, Math.sqrt(P.corner[i] * P.corner[i] + 2 * 3 * (P.cum[i] - st.s)));
      // (and a corner just behind: it is still turning it, the route's line being taken as a curve over some metres)
      for (let i = q.i; i > 0 && st.s - P.cum[i] < 8; i--) if (P.corner[i] < want) want = P.corner[i];
      // the cars ahead, and the line at a red light or a stop sign
      let carGap = gapAhead(others, dt);
      const line = obey && !dry ? Math.min(lineGap(dt), midGap(dt)) : Infinity;
      // and along its way, the cars at an angle to it (crossGap): the nearer rules
      if (!dry) look(); else st.np = 0;
      const laneGap = carGap, xGap = dry ? Infinity : crossGap(others);
      if (xGap < carGap) { carGap = xGap; still = false; queued = queueing(st.xBlock, ruledQ); st.block = st.xBlock; }
      const across = xGap < laneGap; // (what holds it up is a car at an angle to it, not one ahead in its lane)
      // pulling out from the kerb, a look in the mirror first: it waits while a car is coming up the lane
      // behind it, moving, within 3.5 s, as a driver does (it would cut in front of it, and the car would
      // brake for it beside it, the two edging along nose to tail). A queue standing beside it is not waited
      // out: the way ahead (crossGap, gapAhead) holds it while a car is in the way, and it noses in as they move
      st.mirror = !dry && from === 'kerb' && st.s < 4 && st.v < 1.5 && mirror(others);
      if (!obey && !dry && priority) callAhead(); // (out of your sight it drives through a red: it calls its green all the same, for when it comes into sight)
      // a car standing where it is to pull in: pull in behind it
      if (end && still && carGap < line && carGap < Infinity && st.s + carGap > st.end - 30) endAt(Math.min(st.end, st.s + Math.max(0, carGap - 3.2)));
      let left = st.end - st.s;
      if (end) want = Math.min(want, Math.sqrt(2 * 2.2 * Math.max(0, left - 0.4)));
      const gap = Math.min(carGap, line), w0 = want, room = gap < 2.8 || st.mirror ? 0 : (gap - 2.8) * 0.9;
      if (room < want) want = room;
      st.why = want < w0 ? `${line <= carGap ? 'the line' : 'gap'} ${gap.toFixed(1)} m` : `${w0.toFixed(1)} m/s ahead`; // what sets the speed (for the game check)
      // held up behind cars (never at the line: a red light is waited out) it counts the time while it
      // crawls, and keeps it until it is under way, since a car caught up with it turns round every few
      // seconds and the gap comes and goes
      // (in a queue for a junction, the car ahead waiting its turn there, it is waiting for the light too:
      // unless it is caught up in that car, or the queue has not moved for a minute, longer than any
      // light's red, a jam in the junction, when it counts again, for a ride to find another way round)
      st.qT = queued && st.v < 0.5 ? (st.qT || 0) + dt : 0;
      const waiting = queued && carGap >= 0.5 && st.qT < 60;
      st.gap = carGap; // (the gap to the car ahead: its headlamp beam is dimmed on one close ahead)
      st.held = line <= carGap || waiting ? 0 : st.v < 1 ? st.held + dt : st.v > 4 ? 0 : st.held;
      // queueing for a junction itself (stopped for its line, or behind a car that is): what the traffic
      // behind reads, as it reads a car of its own (c.q), so it queues behind and never goes round
      st.q = st.v < 0.5 && ((line < Infinity && line <= carGap) || (queued && carGap < line));
      st.qBy = st.q && carGap < line ? st.block : null; // (the car it queues behind: that one does not queue behind it in turn)
      // caught up in cars that stopped against it (pulled out into a jam at the kerb), with no room to
      // drive round: after 8 s it creeps on through, as the traffic does when two are caught up
      if (st.held > 8 && carGap < 0.5 && !across) want = Math.max(want, 1.5);
      // and held for 12 s in a tangle the traffic does not clear, it stops giving way and creeps on at
      // up to 3 m/s until it is under way (to the line, if a light is red), rather than wait for good
      // (never on into a car queueing ahead of it)
      if (st.held > 12 && !queued && !across) want = Math.max(want, Math.min(3, w0, line < 2.8 ? 0 : (line - 2.8) * 0.9));
      // nose to nose with a car that waits on it in turn (it goes first by the rule, but this car is in its
      // way): after 3 s this one backs off a metre or two along its way, if the road behind is clear, as a
      // driver does who has pulled too far out; else it asks that car to back off (actors.js makeWay). Never
      // through it
      st.mutT = !dry && across && st.xMutual && st.v < 0.3 ? (st.mutT || 0) + dt : 0;
      if (st.mutT > 3) { st.mutT = -3; if (!backable() && makeWay) makeWay(st.x, st.y, st.z, st.h, C.half, C.hw); else st.backoff = 1.5; }
      // held up near the end for good (by a car that isn't moving off, not a light): stop here
      st.stall = st.v < 0.2 && room < 0.1 && carGap < line && !waiting ? st.stall + dt : 0; // (not in a queue for the lights)
      if (end && st.stall > (atSignal(st.block) ? 25 : 8) && left < 45 && !(st.block && st.block.walker)) { endAt(st.s); left = 0; }
      // and queued 8 s behind cars within 45 m of the end (a jam between it and you), it stops where
      // it is, as a driver picking you up does, and you walk the last few metres
      // (a queue held at a signal is waited out, not taken for a jam, unless it stands 25 s: Kyoto's taxi stopped 39 m
      // from you behind a car waiting for its green, #243)
      else if (end && !dry && st.held > (atSignal(st.block) ? 25 : left < 30 ? 4 : 8) && left < 45 && carGap < line && carGap < 12 && !(st.block && st.block.walker)) { endAt(st.s); left = 0; } // (not for a crowd crossing in front: that is waited out)
      // (and within 30 m of the end, after 4 s: a driver that close to the fare stops where it is, rather than wait to go
      // round a car standing in the lane, Fushimi-inari's phoned ride 8 s late so, #264)
      // out round something stopped in the lane, and back in after it, at a crawl
      // (across no faster than its speed allows a car to steer, and easing in as it gets there, so
      // that it straightens out as a car does rather than snapping straight when it is across)
      const sr = Math.min(1.4, 0.05 + 0.3 * st.v, 1.6 * Math.abs(st.pass - st.shift) + 0.05);
      st.shift += clamp(st.pass - st.shift, -sr * dt, sr * dt);
      if (st.pass || Math.abs(st.shift) > 0.2) want = Math.min(want, 5);
      // (the traffic brakes by the Intelligent Driver Model's interaction term too, actors.js idm; a ride's
      // driver keeps the limit alone: with it, creeping up a stop-and-go queue more slowly, it was held long
      // enough to read a car in the queue as stopped for good and go round it)
      const dv = clamp(want - st.v, -7.5 * dt, 2.6 * dt);
      st.brake = dv < -0.02 * dt * 60 || (st.v < 0.2 && want < 0.1);
      st.v = Math.max(0, st.v + dv);
      const s0 = st.s, lat0 = st.lat;
      st.s = Math.min(st.end, st.s + st.v * dt);
      // backing off (above): back along its way at a walking pace while the road behind stays clear
      if (st.backoff > 0 && !dry) {
        st.backoff -= dt; st.v = 0; st.brake = false;
        if (backable(1.2 * dt)) st.s = Math.max(0, s0 - 1.2 * dt); else st.backoff = 0;
      }
      // across the road it eases to its line as it goes, never sideways on the spot (so an end
      // brought forward bends its path in rather than jumping it)
      const k = lat(st.s);
      st.lane = laneAt(st.s); // (its lane's place here, kerbs aside: game.js reads it)
      const lr = Math.min(0.35 * st.v, 1.6 * Math.abs(k - st.lat) + 0.02);
      st.lat += clamp(k - st.lat, -lr * dt, lr * dt);
      pose(st.s, q, st.lat);
      // its lane is shorter than the route's line on the inside of a turn, and longer on the outside:
      // it goes on along the line as far as covers its speed in its lane, so that it neither slows to
      // a crawl round a tight corner nor speeds up round a wide one
      const step = st.v * dt;
      for (let it = 0; it < 3 && step > 0.01 && st.s > s0; it++) {
        const moved = Math.hypot(q.x - st.x, q.y - st.y);
        if (moved < 1e-4 || Math.abs(moved - step) < 0.02 * step) break;
        st.s = Math.min(st.end, s0 + (st.s - s0) * clamp(step / moved, 0.5, 2));
        pose(st.s, q, st.lat);
      }
      // never a step further into a car of the traffic (solid: how deep a pose is in their
      // footprints); it waits, and after 2 s wedged asks the ones it is up against to back off a metre or
      // two (makeWay), every 2 s; only after WEDGE_GIVE, a knot nothing undoes, does it go on at a crawl
      if (solid && !dry && st.s > s0) { // (swinging out round a car too: its line keeps a hand's width clear of the one it goes round, but not of one stopped across it beyond, or coming nose to nose)
        const d1 = solid(q.x, q.y, q.z, Math.atan2(q.hx, q.hy));
        // (strict: deeper too as the body is turned now, where its way bends and the body has yet to come round)
        // (and by any step at all: a hundredth of a metre a step let it in at a crawl)
        const d2 = strict ? solid(q.x, q.y, q.z, st.h) : 0, deeper = strict ? (d1 > 0.02 && d1 > solid(st.x, st.y, st.z, st.ph ?? st.h) + 5e-4) || (d2 > 0.02 && d2 > solid(st.x, st.y, st.z, st.h) + 5e-4)
          : d1 > 0.02 && d1 > solid(st.x, st.y, st.z, st.h) + 0.01;
        if (deeper && (st.wedged += dt) < wedge) {
          if (makeWay && st.wedged > 2 && Math.floor(st.wedged / 2) !== Math.floor((st.wedged - dt) / 2)) makeWay(q.x, q.y, q.z, Math.atan2(q.hx, q.hy), C.half, C.hw);
          st.s = s0; st.lat = lat0; st.v = 0; st.brake = true;
          pose(st.s, q, st.lat);
        } else if (d1 <= 0.02 && d2 <= 0.02) st.wedged = 0;
      }
      st.ph = Math.atan2(q.hx, q.hy);
      // it faces the way it moves, never round to a step that goes back (a car does not spin on the spot)
      const h0 = st.h, mh = Math.atan2(q.x - st.x + q.hx * 0.01, q.y - st.y + q.hy * 0.01);
      // and turns no faster than its steering lets it at its speed (a turning circle of 4.5 m)
      const yaw = (Math.abs(angDiff(mh, st.h)) < 1.2 ? angDiff(mh, st.h) : angDiff(Math.atan2(q.hx, q.hy), st.h)) * Math.min(1, dt * 6) * (st.v > 0.05 ? 1 : 0), ym = (st.v / 4.5 + 0.1) * dt;
      st.h += clamp(yaw, -ym, ym);
      st.steer = clamp(dt > 0 ? angDiff(st.h, h0) / dt * C.wheelbase / Math.max(1, st.v) : 0, -0.6, 0.6);
      const dz = q.z - st.z;
      st.pitch += (clamp(-Math.atan2(dz, Math.max(0.01, st.v * dt)), -0.2, 0.2) * (st.v > 0.5 ? 1 : 0) - st.pitch) * Math.min(1, dt * 4);
      st.x = q.x; st.y = q.y; st.z = q.z;
      // signal into the kerb at the end, and out of it at the start
      st.signal = end && left < 45 ? -keep : from === 'kerb' && st.s < 18 ? keep : 0;
      // what the driver is doing, in words, as a self-driving car's screen says it (the ride's HUD)
      if (!dry) st.intent = intentOf(want < w0, line <= carGap, across);
      if (end && left < 0.5 && st.v < 0.3) { st.done = true; st.v = 0; }
    }
    // on along the route to s at once (a ride running late, out of sight, gets round a jam)
    function jump(s) { leave(); if (reg) st.line = 0; st.s = clamp(s, st.s, st.end); st.shift = st.pass = 0; st.stall = 0; st.lat = lat(st.s); pose(st.s, q, st.lat); st.x = q.x; st.y = q.y; st.z = q.z; st.h = Math.atan2(q.hx, q.hy); }
    // straight to the end (skipping the trip)
    function finish() { leave(); st.s = st.end; st.shift = st.pass = 0; st.lat = lat(st.s); pose(st.s, q, st.lat); st.x = q.x; st.y = q.y; st.z = q.z; st.h = Math.atan2(q.hx, q.hy); st.v = 0; st.done = end; }
    // the trip timed by driving it in a dry run with nothing in the way: the time at each step
    let plan = null;
    function timed() {
      if (plan) return plan;
      const D = chauffeur({ half: C.half, hw: C.hw, top: C.top, wheelbase: C.wheelbase }, route, { keep, from, v, cruise, hurry }), S = [0], T = [0];
      let t = 0;
      for (; t < 900 && !D.st.done && D.st.s < P.len - 0.05; t += 0.25) { D.update(0.25, [], true); S.push(D.st.s); T.push(t + 0.25); }
      if (!D.st.done) { S.push(P.len); T.push(t + 1); }
      return (plan = { S, T, total: T[T.length - 1] });
    }
    // the planned time at s (between the dry run's steps)
    function timeAt(s) {
      const { S, T } = timed();
      let lo = 0, hi = S.length - 1;
      if (s >= S[hi]) return T[hi];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      return T[lo] + (T[hi] - T[lo]) * (s - S[lo]) / Math.max(1e-6, S[hi] - S[lo]);
    }
    const timeLeft = () => (st.done ? 0 : Math.max(0, timeAt(st.end) - timeAt(st.s)) + (st.end < P.len - 1 ? 1.5 : 0));
    // where it would be at s on its own line (the lane, the kerbs at the ends): out { x, y, z, hx, hy }
    const poseAt = (s, out) => pose(s, out, lat(s));
    return { st, update, finish, jump, leave, poseAt, path: P, box: () => boxOf(st, C.half, C.hw, C.top), remaining: () => st.end - st.s, timeLeft, total: () => timed().total };
  }

  return { car, headlamp, drive, router, path, chauffeur, queueing, pushOut, sweep, boxOf, kerbOf, ROADW, LANE, PERF };
})();
