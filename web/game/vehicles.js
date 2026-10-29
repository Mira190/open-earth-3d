// The helicopter and the ferries, shared by every city's game.
//
// Models: blender/build_vehicles.py builds both in Blender from code and bakes their
// ambient occlusion into web/assets/vehicles (helicopter.glb, ferry.glb, vehicles.json).
// A city picks its liveries, the helicopter's registration and its vessel names in its
// config (game.vehicles in city.json, copied into game.json); a city with no config
// gets the defaults in vehicles.json. If the files can't be loaded, the box-built
// models at the end of this file stand in.
//
// Helicopter: an assisted flight model, as in Sketchbook. The rotor cancels gravity,
// so it hovers with no input; it levels itself; horizontal speed decays with drag. It
// can't lift off until the rotor has spooled up, it lands wherever the ground below
// is reached gently, and it collides with buildings and with the landmark solids. It
// can fly under the Harbour Bridge deck but not through its steel. On top of that the
// look: clear-coat paint that reflects the sky, a glazed cockpit with the pilot in it,
// blades that droop at rest, cone as they lift and blur into a disc, a ducted tail
// fan, position lights, beacons and strobes, a searchlight after dark, and downwash
// that ripples and sprays the water (dust on land).
//
// Ferries: double-ended, like Sydney's, so they reverse at the end of a route without
// turning. They follow the routes in game.json (found through open water by the
// pipeline), slow down into each wharf and wait there. A rider can take the helm for
// the last stretch into a wharf and dock by hand. Each leaves a Kelvin wake (the
// 19.5-degree V of every ship in deep water) and pushes a bow wave; names are painted
// on the hull, cabins light up after dark and the sidelights swap with the direction
// of travel, so red is always to port.
'use strict';
window.OEVehicles = (function () {
  // three.js loads after this file (an ES module), so nothing here touches THREE until it is
  // used. With colour management on, an sRGB hex converts itself; off (r128, or this app on
  // r186), it is converted here. r155+ lights are physical. These keep every version right.
  const lin = hex => (THREE.ColorManagement && THREE.ColorManagement.enabled ? new THREE.Color(hex) : new THREE.Color(hex).convertSRGBToLinear());
  const srgb = t => { if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; };
  const PHYS = () => +THREE.REVISION >= 155;
  const once = make => { let v = null; return () => v || (v = make()); };
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

  // ------------------------------------------------------------ loading and liveries
  // ferry: false for a city without ferries, else its ferry_style, which picks the model:
  // 'model': 'river' (the 22 m shuttle) or 'harbour' (the 34 m ferry), else by its length
  async function load(base = 'assets/vehicles/', { ferry = true, cars = true } = {}) {
    if (!THREE.GLTFLoader) throw new Error('GLTFLoader is not available');
    const L = new THREE.GLTFLoader();
    const get = u => new Promise((res, rej) => L.load(base + u, res, null, rej));
    const info = await (await fetch(base + 'vehicles.json')).json();
    const style = typeof ferry === 'object' ? ferry : {};
    const river = style.model ? style.model === 'river' : style.length_m < 28;
    const ferryInfo = ferry ? (river && info.ferry_river) || info.ferry : null;
    // the traffic's cars are optional: without them the streets keep their box cars
    const car = cars && info.cars ? get(info.cars.file).catch(e => { console.warn('Car models unavailable:', e); return null; }) : null;
    const [heli, fer, carLib] = await Promise.all([get(info.helicopter.file), ferryInfo ? get(ferryInfo.file) : null, car]);
    return { info, heli, ferry: fer, ferryInfo, cars: carLib };
  }
  // a livery by name, or the city's own colours over the default
  function livery(I, spec) {
    const base = I.liveries[I.default_livery];
    if (!spec) return base;
    if (typeof spec === 'string') return I.liveries[spec] || base;
    return Object.assign({}, typeof spec.base === 'string' && I.liveries[spec.base] || base, spec);
  }
  const luma = hex => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  // text on a decal patch (u along, v up): a canvas texture
  function decalTexture(text, { w = 1024, h = 160, color = '#ffffff', font = 'Bricolage Grotesque, Public Sans, sans-serif', weight = 800, fill = 0.72, spacing = 0.06 } = {}) {
    const [c, g] = canvas(w, h);
    let px = Math.round(h * fill);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const set = () => { g.font = `${weight} ${px}px ${font}`; if ('letterSpacing' in g) g.letterSpacing = `${Math.round(px * spacing)}px`; };
    set();
    while (g.measureText(text).width > w * 0.92 && px > 8) { px -= 2; set(); }
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + px * 0.04);
    const t = srgb(new THREE.CanvasTexture(c));
    t.anisotropy = 8;
    return t;
  }
  const glowTex = once(() => {
    const [c, g] = canvas(64, 64), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  });
  // a light seen from afar: an additive glow, sized and dimmed for day and night
  function glow(colour) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: lin(colour), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.renderOrder = 3;
    return s;
  }
  // rebuild the model's materials by name: livery paint with a clear coat, glass, lamps,
  // decals; everything keeps the AO baked in Blender
  function dress(root, paint, colours, { decals = {}, lamps = {}, glassTint = '#0f1a21' } = {}) {
    const cache = new Map();
    const make = (m, trim) => {
      const ao = m.aoMap ? { aoMap: m.aoMap, aoMapIntensity: 1 } : {};
      const n = m.name, key = paint[n];
      let out;
      if (key) {
        const coat = /^(Paint|Stripe|Hull|Band)/.test(n);
        out = new (coat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)(Object.assign({ color: lin(colours[key]),
          roughness: coat ? 0.3 : 0.5, metalness: 0, side: m.side }, coat ? { clearcoat: n === 'Hull' || n === 'Band' ? 0.25 : 1, clearcoatRoughness: n === 'Hull' ? 0.2 : 0.07 } : {}, ao));
      } else if (n === 'Glass' || n === 'Window') {
        out = new THREE.MeshPhysicalMaterial({ color: lin(glassTint), roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
          transparent: true, opacity: n === 'Glass' ? 0.38 : 0.62, depthWrite: false, emissive: lin('#ffd9a0'), emissiveIntensity: 0 });
      } else if (/^Decal_/.test(n)) {
        out = new THREE.MeshStandardMaterial({ map: decals[n] || null, transparent: true, depthWrite: false, roughness: 0.35, visible: !!decals[n] });
      } else if (/^Light_|^Screen$/.test(n)) {
        out = new THREE.MeshStandardMaterial({ color: m.color.clone(), roughness: 0.2, emissive: m.emissive && m.emissive.getHex() ? m.emissive.clone() : lin('#ffffff'), emissiveIntensity: 0 });
        (lamps[n] = lamps[n] || []).push(out);
      } else {
        out = new THREE.MeshStandardMaterial(Object.assign({ color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, side: m.side }, ao));
      }
      out.name = n;
      if (trim) Object.assign(out, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      return out;
    };
    root.traverse(o => {
      if (!o.isMesh) return;
      const trim = /^Trim/.test(o.name) || (o.parent && /^Trim/.test(o.parent.name));
      const m = o.material, key = `${m.name}|${trim}`;
      if (!cache.has(key)) cache.set(key, make(m, trim));
      o.material = cache.get(key);
      o.castShadow = !trim && !o.material.transparent;
      o.receiveShadow = true;
    });
    return { lamps, mats: cache };
  }
  // the rotor seen spinning: four smeared blades and the tip stripe, drawn in polar
  // coordinates (the disc spins with the rotor, so the smear trails the blades)
  function rotorBlurTexture(blades, tipColour, size = 512) {
    const [c, g] = canvas(size, size), img = g.createImageData(size, size), d = img.data, tip = new THREE.Color(tipColour);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size * 2 - 1, y = (j + 0.5) / size * 2 - 1, r = Math.hypot(x, y);
      const k = 4 * (j * size + i);
      if (r > 1 || r < 0.06) { d[k + 3] = 0; continue; }
      let a = 0.09 + 0.07 * smooth(0.1, 0.9, r);
      const ang = Math.atan2(y, x);
      for (let b = 0; b < blades; b++) {
        let behind = ang - b * 2 * Math.PI / blades;
        behind = ((behind % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        a += 0.55 * Math.exp(-behind / (0.07 + 0.26 * r));
      }
      const isTip = r > 0.94;
      a = Math.min(0.85, a * (0.55 + 0.45 * r) + (isTip ? 0.22 : 0));
      const shade = isTip ? [tip.r * 255, tip.g * 255, tip.b * 255] : [42, 45, 49];
      d[k] = shade[0]; d[k + 1] = shade[1]; d[k + 2] = shade[2]; d[k + 3] = a * 255 * smooth(1, 0.985, r);
    }
    g.putImageData(img, 0, 0);
    return srgb(new THREE.CanvasTexture(c));
  }

  // ------------------------------------------------------------ particles: spray, mist, dust
  // soft round points with their own size and opacity, drawn in one call
  function particles(world, n, colour) {
    const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const uni = { uColor: { value: lin(colour) }, uScale: { value: 600 }, uLight: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = min(512.0, aSize * uScale / max(1.0, -mv.z)); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uLight; varying float vA;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0 || vA <= 0.0) discard;
  gl_FragColor = vec4(uColor * uLight, vA * (1.0 - d) * (1.0 - d)); }` });
    const pts = new THREE.Points(geo, m);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    world.add(pts);
    const P = [];
    for (let i = 0; i < n; i++) P.push({ x: 0, y: 0, z: -999, vx: 0, vy: 0, vz: 0, age: 9, life: 1, s0: 1, s1: 4, a: 0 });
    let next = 0, acc = 0;
    return {
      pts, uni, color: c => uni.uColor.value.copy(lin(c)),
      emit(rate, dt, f) { acc += rate * dt; while (acc >= 1) { acc -= 1; f(P[next]); P[next].age = 0; next = (next + 1) % n; } },
      update(dt, { drag = 1.2, lift = 0 } = {}) {
        for (let i = 0; i < n; i++) {
          const p = P[i];
          if (p.age >= p.life) { alpha[i] = 0; continue; }
          p.age += dt;
          const k = Math.exp(-drag * dt);
          p.vx *= k; p.vy *= k; p.vz = p.vz * k + lift * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const t = p.age / p.life;
          pos[3 * i] = p.x; pos[3 * i + 1] = p.z; pos[3 * i + 2] = -p.y;
          size[i] = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
          alpha[i] = p.a * Math.min(1, t * 6) * (1 - t);
        }
        geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aAlpha.needsUpdate = true;
      },
    };
  }
  // expanding rings on the water (or dust on the ground) under a hovering helicopter
  const ringTex = once(() => {
    const [c, g] = canvas(256, 256), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.88, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  });
  const foamTex = once(() => { // foam that tiles along a wake: soft blotches under fine streaks, drawn wrapped
    const w = 256, h = 1024, [c, g] = canvas(w, h);
    g.fillStyle = 'rgb(48,48,48)';
    g.fillRect(0, 0, w, h);
    const wrapped = (x, y, r, draw) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) if (x + dx > -r && x + dx < w + r && y + dy > -r && y + dy < h + r) draw(x + dx, y + dy); };
    for (let i = 0; i < 520; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 30, v = 90 + Math.random() * 90;
      wrapped(x, y, r, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, `rgba(${v},${v},${v},0.7)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr; g.fillRect(px - r, py - r, 2 * r, 2 * r);
      });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * w, y = Math.random() * h, len = 8 + Math.random() * 40, a = 0.15 + Math.random() * 0.45;
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.lineWidth = 0.8 + Math.random() * 2.2;
      wrapped(x, y, len, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + (Math.random() - 0.5) * 4, py + len); g.stroke(); });
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });

  // ------------------------------------------------------------ helicopter
  function helicopter(world, nav, pad, opts = {}) {
    const lib = opts.lib, cfg = (opts.cfg && opts.cfg.helicopter) || {};
    const V = lib ? heliModel(world, lib, cfg, opts) : kitHeli();
    const g = V.group, seat = V.seat, door = V.door;
    world.add(g);
    const st = { x: pad[0], y: pad[1], z: pad[2], h: 0.6, vx: 0, vy: 0, vz: 0, yawRate: 0, pitch: 0, roll: 0, rotor: 0, on: false, landed: true,
      speed: 0, under: null, side: 0, fwd: 0, lift: 0 };
    // near the main span: position across the deck (v) and the deck height on the axis
    const deckBottomAt = (x, y) => {
      for (const s of nav.strips) {
        if (!s.fly_under) continue;
        const [u, v] = nav.stripUV(s, x, y);
        if (Math.abs(u) < 240 && Math.abs(v) < 250) return { u, v, s, z: nav.stripHeight(s, s.origin[0] + s.axis[0] * u, s.origin[1] + s.axis[1] * u) };
      }
      return null;
    };
    function update(dt, inp, events) {
      const spool = st.on ? 1 : 0;
      st.rotor += (spool - st.rotor) * Math.min(1, dt / 1.2);
      const ready = st.rotor > 0.9;
      // controls: forward thrust along the heading, yaw, climb; the assists do the rest
      const fwd = st.on ? (inp.fwd || 0) : 0, turn = st.on ? (inp.turn || 0) : 0, lift = st.on && ready ? (inp.lift || 0) : 0;
      const hx = Math.sin(st.h), hy = Math.cos(st.h);
      const accel = 15, drag = 0.3;
      st.vx += (hx * fwd * accel - st.vx * drag) * dt;
      st.vy += (hy * fwd * accel - st.vy * drag) * dt;
      if (st.landed && lift <= 0) { st.vx *= 0.8; st.vy *= 0.8; }
      st.yawRate += (turn * 1.3 - st.yawRate) * Math.min(1, dt * 4);
      if (!st.landed || lift > 0) st.h += st.yawRate * dt;
      const vzTarget = lift * 8;
      st.vz += (vzTarget - st.vz) * Math.min(1, dt * 3);
      if (!st.on && !st.landed) st.vz -= 6 * dt; // no power: settle
      let nx = st.x + st.vx * dt, ny = st.y + st.vy * dt, nz = Math.min(900, st.z + st.vz * dt);
      if (!nav.free(nx, ny, st.z + 0.3, st.z + 3.6, 3.2)) { // sideways into something
        const hard = Math.hypot(st.vx, st.vy) > 12;
        nx = st.x; ny = st.y; st.vx *= -0.3; st.vy *= -0.3;
        if (hard) events.push({ type: 'bump' });
      }
      if (nz > st.z && !nav.free(nx, ny, nz + 0.3, nz + 3.6, 3.2)) { nz = st.z; st.vz = Math.min(0, st.vz); } // up into something
      const floor = nav.groundBelow(nx, ny, nz);
      if (nz <= floor + 0.02) {
        nz = floor;
        if (st.vz < 0) st.vz = 0;
        st.landed = true;
      } else st.landed = false;
      // under the bridge: a crossing from one side of the deck to the other while below it
      const d = deckBottomAt(nx, ny);
      if (d && d.z != null) {
        const below = nz + 3.8 < d.z - 3.0;
        if (Math.abs(d.v) > d.s.half_width + 4) {
          const side = Math.sign(d.v);
          if (st.under && st.under.side !== side && st.under.ok) events.push({ type: 'under_bridge', name: d.s.label || d.s.name });
          st.under = { side, ok: true };
        } else if (st.under && !below) st.under.ok = false;
      } else st.under = null;
      st.x = nx; st.y = ny; st.z = nz;
      st.speed = Math.hypot(st.vx, st.vy);
      st.fwd += (fwd - st.fwd) * Math.min(1, dt * 3);
      st.lift += (lift - st.lift) * Math.min(1, dt * 3);
      // visual attitude: nose down when accelerating forward, bank into turns
      const along = st.vx * hx + st.vy * hy;
      st.pitch += ((st.landed ? 0 : clamp(fwd * 0.22 + along * 0.002, -0.35, 0.35)) - st.pitch) * Math.min(1, dt * 3);
      st.roll += ((st.landed ? 0 : -st.yawRate * 0.18 * Math.min(1, st.speed / 10)) - st.roll) * Math.min(1, dt * 3);
      g.position.copy(W(st.x, st.y, st.z));
      g.rotation.set(0, 0, 0);
      g.rotateY(Math.PI - st.h);
      g.rotateX(st.pitch);
      g.rotateZ(st.roll);
      V.animate(dt, st, nav);
    }
    // the door in local coordinates, for walking up to it
    const doorAt = () => {
      const c = Math.cos(st.h), s = Math.sin(st.h);
      return { x: st.x + door.x * c + door.y * s, y: st.y - door.x * s + door.y * c };
    };
    return { group: g, st, seat, update, doorAt };
  }

  function heliModel(world, lib, cfg, opts) {
    const I = lib.info.helicopter, colours = livery(I, cfg.livery);
    const src = lib.heli.scene.clone(true), node = n => src.getObjectByName(n);
    const city = opts.city || {};
    const reg = cfg.registration || I.registrations[city.country] || I.registration_default;
    const ink = luma(colours.primary) > 0.45 ? colours.secondary : '#f4f4f2';
    const lamps = {};
    dress(src, I.paint, colours, { lamps, decals: {
      Decal_Registration: decalTexture(reg, { w: 640, h: 120, color: ink, fill: 0.78 }),
      Decal_Logo: decalTexture(cfg.logo || I.logo, { w: 1024, h: 128, color: ink, fill: 0.62, weight: 700, spacing: 0.12 }),
    } });
    const g = new THREE.Group();
    g.add(src);
    const p = n => node(n).position;
    // the rotor head: blades and the blur disc tilt together with the tip-path plane
    const rotor = node('MainRotor'), hub = rotor.position.clone(), tpp = new THREE.Group();
    tpp.position.copy(hub);
    src.add(tpp);
    tpp.add(rotor);
    rotor.position.set(0, 0, 0);
    const blades = [0, 1, 2, 3].map(k => node(`Blade_${k}`)), q0 = blades.map(b => b.quaternion.clone());
    const R = I.rotor_radius_m;
    const discMat = new THREE.MeshStandardMaterial({ map: rotorBlurTexture(4, colours.blade_tip || '#f2c53d'), transparent: true, depthWrite: false,
      side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2, opacity: 0 });
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.3, R, 96, 1).rotateX(-Math.PI / 2), discMat);
    disc.renderOrder = 4;
    tpp.add(disc);
    const tail = node('TailRotor'), duct = I.duct_radius_m;
    const fanMat = new THREE.MeshStandardMaterial({ map: rotorBlurTexture(10, '#2a2d31', 128), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, opacity: 0 });
    const fan = new THREE.Mesh(new THREE.CircleGeometry(duct - 0.01, 40).rotateY(Math.PI / 2), fanMat);
    fan.position.copy(tail.position);
    src.add(fan);
    // lights: position lights steady, beacons and strobes flashing, all visible by day
    const L = {};
    const spot = (name, colour, size) => { const s = glow(colour); s.position.copy(p(name)); s.userData.size = size; src.add(s); L[name] = s; return s; };
    spot('Nav_Red', '#ff3030', 1.1); spot('Nav_Green', '#30ff70', 1.1); spot('Nav_White', '#ffffff', 0.9);
    spot('Beacon_Top', '#ff2020', 1.6); spot('Beacon_Bottom', '#ff2020', 1.6);
    spot('Strobe_L', '#ffffff', 2.6); spot('Strobe_R', '#ffffff', 2.6);
    spot('Landing_Light', '#fff3da', 2.2); spot('Searchlight', '#fff3da', 2.6);
    // the searchlight: a real spot light (kept in the scene all the time so no shader
    // recompiles when it switches) and a faint beam you can see in the night air
    const sl = new THREE.SpotLight(lin('#fff1d6'), 0, 420, 0.2, 0.55, PHYS() ? 2 : 1);
    sl.position.copy(p('Searchlight'));
    sl.target.position.copy(p('Searchlight')).add(new THREE.Vector3(0, -0.72, 0.7).multiplyScalar(20));
    src.add(sl, sl.target);
    const beamTex = (() => { const [c, x] = canvas(4, 128), gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })();
    const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 70, 32, 1, true).translate(0, -35, 0),
      new THREE.MeshBasicMaterial({ map: beamTex, color: lin('#fff0d0'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true }));
    beam.position.copy(p('Searchlight'));
    beam.lookAt(sl.target.position);
    beam.rotateX(-Math.PI / 2);
    beam.renderOrder = 5;
    src.add(beam);
    // LOD: the decimated body beyond 90 m, where the cockpit details can't be seen anyway
    const body = node('Body'), trim = node('Trim'), lod1 = node('Body_LOD1');
    // downwash: rings and spray on the water, dust on land
    const spray = particles(world, 420, '#f2f6f8');
    const rings = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: ringTex(), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 }));
      r.renderOrder = 1;
      r.userData.phase = i / 6;
      world.add(r);
      rings.push(r);
    }
    const seat = p('Seat_Pilot').clone(), dp = p('Door');
    const door = { x: -dp.x, y: dp.z };
    const tmpV = new THREE.Vector3(), flapQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
    let t = 0, spin = 0, discSpin = 0;
    function animate(dt, st, nav) {
      t += dt;
      const night = opts.U ? opts.U.uNight.value : 0, day = 1 - night;
      const rpm = st.rotor;
      spin -= rpm * 41.4 * dt; // 395 rpm, clockwise seen from above
      discSpin -= (0.6 + rpm * 2.2) * dt;
      // blades: true speed while spooling, then the blurred disc; droop at rest, cone with lift
      const blurA = smooth(0.32, 0.85, rpm);
      rotor.rotation.y = blurA > 0.98 ? discSpin : spin;
      for (const b of blades) b.visible = blurA < 0.98;
      disc.rotation.y = discSpin;
      discMat.opacity = blurA;
      const beta = -0.03 + rpm * rpm * (0.05 + 0.03 * Math.max(0, st.lift));
      blades.forEach((b, k) => b.quaternion.copy(q0[k]).multiply(flapQ.setFromAxisAngle(X, -beta)));
      // the tip-path plane tilts with the cyclic: forward with speed, into turns
      tpp.rotation.set(st.landed ? 0 : st.fwd * 0.05, 0, st.landed ? 0 : -st.yawRate * 0.02);
      tail.rotation.x += rpm * 60 * dt;
      tail.visible = rpm < 0.45;
      fanMat.opacity = smooth(0.2, 0.6, rpm) * 0.95;
      fan.rotation.x = -t * 3;
      // lights
      const powered = rpm > 0.05, flying = !st.landed;
      const show = (name, on, k = 1) => {
        const s = L[name];
        s.visible = on > 0.01;
        if (!s.visible) return;
        const size = s.userData.size * (0.45 + 0.9 * night) * k;
        s.scale.setScalar(size);
        s.material.opacity = on * (0.35 + 0.65 * night);
      };
      const nav3 = powered ? 1 : 0;
      show('Nav_Red', nav3); show('Nav_Green', nav3); show('Nav_White', nav3);
      const beacon = powered && t % 1.0 < 0.12 ? 1 : 0;
      show('Beacon_Top', beacon); show('Beacon_Bottom', beacon);
      const strobe = flying && (t % 1.3 < 0.05 || (t % 1.3 > 0.14 && t % 1.3 < 0.19)) ? 1 : 0;
      show('Strobe_L', strobe, 1.4); show('Strobe_R', strobe, 1.4);
      const agl = st.z - nav.groundBelow(st.x, st.y, st.z);
      const search = powered && flying && night > 0.25 ? 1 : 0, landing = powered && night > 0.25 && agl < 80 ? 1 : 0;
      show('Searchlight', search, 1); show('Landing_Light', landing, 1);
      sl.intensity = search * (PHYS() ? 25000 : 2.2);
      beam.material.opacity = search * 0.035 * night;
      for (const [n, ms] of Object.entries(lamps)) for (const m of ms) {
        m.emissiveIntensity = n === 'Screen' ? (powered ? 0.6 + night : 0.15) : n === 'Light_Lens' ? (search || landing ? 3 : 0)
          : n === 'Light_Red' ? (powered ? 1 + 2 * beacon : 0) : n === 'Light_White' ? (powered ? 1 + 3 * strobe : 0) : powered ? 1.5 : 0;
      }
      // level of detail
      if (opts.camera) {
        const far = opts.camera.position.distanceTo(g.getWorldPosition(tmpV)) > (I.lod1_m || 90);
        body.visible = trim.visible = !far;
        if (lod1) lod1.visible = far;
      }
      // downwash: strongest in a low hover, gone by 35 m above the surface
      const surfaceZ = nav.groundBelow(st.x, st.y, st.z);
      const water = nav.isWater(st.x, st.y) && surfaceZ < 1.5;
      const wash = rpm > 0.5 ? smooth(36, 4, st.z - surfaceZ) * smooth(0.5, 1, rpm) : 0;
      const light = 0.25 + 0.75 * day;
      spray.uni.uLight.value = light;
      spray.color(water ? '#eef4f6' : '#b8a68a');
      if (opts.renderer) spray.uni.uScale.value = opts.renderer.domElement.height / (2 * Math.tan((opts.camera ? opts.camera.fov : 55) * Math.PI / 360));
      spray.emit(wash * (water ? 320 : 150), dt, q => {
        // a ring of spray thrown out from under the disc that billows up and slows
        const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 3.5, v = 5 + Math.random() * 5;
        Object.assign(q, { x: st.x + Math.cos(a) * r, y: st.y + Math.sin(a) * r, z: surfaceZ + 0.2, vx: Math.cos(a) * v + st.vx * 0.5, vy: Math.sin(a) * v + st.vy * 0.5,
          vz: 0.4 + Math.random() * 1.6, life: 0.9 + Math.random() * 0.8, s0: 0.8, s1: water ? 4.2 : 5.5, a: (water ? 0.3 : 0.2) * wash });
      });
      spray.update(dt, { drag: 1.7, lift: 0.9 });
      for (const r of rings) {
        r.userData.phase = (r.userData.phase + dt / 1.7) % 1;
        const ph = r.userData.phase, rad = 3 + ph * 30;
        r.visible = wash > 0.01;
        r.position.set(st.x, surfaceZ + 0.06, -st.y);
        r.scale.set(rad, 1, rad);
        r.material.opacity = wash * (water ? 0.42 : 0.18) * Math.pow(1 - ph, 1.4) * Math.min(1, ph * 8) * light;
        r.material.color.copy(lin(water ? '#ffffff' : '#c9b79a'));
        // on the water the rings are foam in the water's own field; on land, dust in the air
        if (water) onWake(r, opts); else r.layers.set(0);
      }
    }
    return { group: g, seat, door, animate };
  }

  // ------------------------------------------------------------ ferries
  function ferries(world, G, nav, makeLabel, opts = {}) {
    const speed = G.ferry_speed_ms || 9, dwell = G.ferry_dwell_s || 20, A = 0.55;
    const lib = opts.lib && opts.lib.ferry ? opts.lib : null, cfg = (opts.cfg && opts.cfg.ferry) || {};
    const wharf = id => G.wharves.find(w => w.id === id);
    const vessels = [];
    const legPoint = (leg, rev, s, out) => {
      const d = rev ? leg.len - s : s, p = leg.p, c = leg.cum;
      let i = 1;
      while (i < p.length - 1 && c[i] < d) i++;
      const t = (d - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1]);
      out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t; out.y = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
      const hx = (p[i][0] - p[i - 1][0]) * (rev ? -1 : 1), hy = (p[i][1] - p[i - 1][1]) * (rev ? -1 : 1);
      out.h = Math.atan2(hx, hy);
      return out;
    };
    const tmp = {};
    const I = lib && (lib.ferryInfo || lib.info.ferry), style = G.ferry_style || {};
    // a livery named in game.vehicles, else the colours of the city's ferry_style, else the default
    const colours = I ? livery(I, cfg.livery || (style.hull && { hull: style.hull, band: style.trim, cabin: style.upper, trim: style.upper, flag: style.flag })) : null;
    let shared = null; // materials shared by every vessel in the city's livery
    for (const r of G.ferries || []) {
      // the route as a sequence of legs, out and back
      const legs = r.legs.map(l => {
        const p = l.path, cum = [0];
        for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
        return { from: l.from, to: l.to, p, cum, len: cum[cum.length - 1] };
      });
      const cycle = [];
      for (const l of legs) cycle.push({ leg: l, rev: false });
      for (let i = legs.length - 1; i >= 0; i--) cycle.push({ leg: legs[i], rev: true });
      r.vessels.forEach((name, k) => {
        const M = lib ? glbFerry(lib, name, colours, shared, opts, style.length_m ? style.length_m / I.length_m : 1) : kitFerry(style);
        if (lib && !shared) shared = M.shared;
        world.add(M.g);
        const fx = ferryEffects(world, M, I, opts);
        const label = makeLabel ? makeLabel(name) : null;
        if (label) { label.position.set(0, M.labelY, 0); M.g.add(label); }
        const v = { name, route: r.route, stops: r.stops, cycle, ci: Math.floor(k * cycle.length / r.vessels.length) % cycle.length, s: 0, phase: 'dwell',
          t: dwell * (0.3 + 0.7 * k / Math.max(1, r.vessels.length)), x: 0, y: 0, h: 0, speed: 0, g: M.g, M, fx, helm: null, lx: null, ly: null, dir: 0, mv: 0 };
        place(v);
        vessels.push(v);
      });
    }
    function stopOf(v) { const c = v.cycle[v.ci]; return v.phase === 'dwell' ? (c.rev ? c.leg.to : c.leg.from) : null; }
    function nextStop(v) { const c = v.cycle[v.ci]; return v.phase === 'dwell' ? (c.rev ? c.leg.from : c.leg.to) : (c.rev ? c.leg.from : c.leg.to); }
    function place(v) {
      const c = v.cycle[v.ci];
      legPoint(c.leg, c.rev, v.phase === 'dwell' ? 0 : v.s, tmp);
      const manual = v.helm && v.helm.manual;
      if (!manual) { v.x = tmp.x; v.y = tmp.y; }
      let dh = angDiff(tmp.h, v.h);
      if (Math.abs(dh) > Math.PI / 2) dh = angDiff(tmp.h + Math.PI, v.h); // double-ended: either end can lead
      if (!manual) v.h += dh * (v.phase === 'dwell' ? 1 : 0.08);
    }
    function update(dt, scale, t, all = 1) {
      const night = opts.U ? opts.U.uNight.value : 0;
      for (const v of vessels) {
        const c = v.cycle[v.ci], step = dt * all * (v.rider ? scale : 1);
        if (v.phase === 'dwell') {
          v.t -= step;
          v.speed = 0;
          if (v.t <= 0) { v.phase = 'sail'; v.s = 0; v.events = (v.events || []).concat([{ type: 'depart', v }]); }
        } else if (v.helm && v.helm.manual) {
          helmStep(v, dt);
        } else {
          const left = c.leg.len - v.s;
          const target = Math.min(speed, Math.sqrt(2 * A * Math.max(0, left)) + 0.6, Math.sqrt(2 * A * v.s) + 1.5);
          v.speed += Math.max(-A * 2 * step, Math.min(A * step, target - v.speed));
          v.s += v.speed * step;
          if (v.helm && left < 160 && !v.helm.manual) { v.helm.manual = true; v.helm.t0 = t; v.events = (v.events || []).concat([{ type: 'helm', v }]); }
          if (v.s >= c.leg.len) arrive(v);
        }
        if (!(v.helm && v.helm.manual)) place(v);
        // which end leads: +1 when the model's +z end ("A") is ahead
        if (v.lx != null && dt > 0) {
          const mx = v.x - v.lx, my = v.y - v.ly, d = Math.hypot(mx, my);
          if (d > 1e-3) { v.dir = Math.atan2(mx, my); v.lead = Math.cos(angDiff(v.dir, v.h)) >= 0 ? 1 : -1; }
          v.mv += ((dt > 0 ? d / dt : 0) - v.mv) * Math.min(1, dt * 2);
        }
        v.lx = v.x; v.ly = v.y;
        const sp = v.mv || 0, lead = v.lead || 1;
        // a little squat and heel: bow up with speed, lean out of turns
        v.g.position.copy(W(v.x, v.y, Math.sin(t * 0.9 + v.x) * 0.06));
        v.g.rotation.set(Math.sin(t * 0.7 + v.y) * 0.012 - lead * Math.min(0.012, sp * 0.0012), Math.PI - v.h, Math.sin(t * 0.8) * 0.015);
        v.M.animate(dt, t, { night, lead, speed: sp });
        v.fx.update(dt, t, v, { night, lead, speed: sp });
      }
    }
    function arrive(v) {
      const c = v.cycle[v.ci];
      v.ci = (v.ci + 1) % v.cycle.length;
      v.phase = 'dwell'; v.t = dwell; v.s = 0; v.speed = 0;
      v.helm = v.helm ? Object.assign(v.helm, { manual: false }) : null;
      v.events = (v.events || []).concat([{ type: 'arrive', v, at: c.rev ? c.leg.from : c.leg.to }]);
    }
    // manual docking: W/S throttle, A/D rudder; made fast within 8 m of the berth, under 1.2 m/s
    function helmStep(v, dt) {
      const c = v.cycle[v.ci], berth = wharf(c.rev ? c.leg.from : c.leg.to).berth, inp = v.helm.input || {};
      v.helm.throttle = Math.max(-0.3, Math.min(1, (v.helm.throttle ?? 0.5) + (inp.fwd || 0) * dt * 0.6));
      const target = v.helm.throttle * 6;
      v.speed += (target - v.speed) * Math.min(1, dt * 0.5);
      v.h += (inp.turn || 0) * dt * 0.25 * Math.min(1, Math.abs(v.speed) / 2 + 0.2);
      const nx = v.x + Math.sin(v.h) * v.speed * dt, ny = v.y + Math.cos(v.h) * v.speed * dt;
      const ends = [[Math.sin(v.h) * 16, Math.cos(v.h) * 16], [-Math.sin(v.h) * 16, -Math.cos(v.h) * 16]];
      if (ends.every(([ex, ey]) => nav.isWater(nx + ex, ny + ey))) { v.x = nx; v.y = ny; }
      else { v.speed = 0; v.helm.throttle = 0; v.events = (v.events || []).concat([{ type: 'scrape', v }]); }
      const d = Math.hypot(berth[0] - v.x, berth[1] - v.y);
      v.helm.dist = d;
      if (d < 8 && Math.abs(v.speed) < 1.2) {
        v.events = (v.events || []).concat([{ type: 'docked', v, score: Math.round(100 - d * 6 - Math.abs(v.speed) * 20) }]);
        v.x = berth[0]; v.y = berth[1];
        v.helm = null;
        arrive(v);
      }
    }
    // seconds until a vessel is next at a wharf, ready to board (0 if it is there now)
    function eta(v, id) {
      if (v.phase === 'dwell' && stopOf(v) === id) return 0;
      let ci = v.ci;
      let t = v.phase === 'dwell' ? v.t + v.cycle[ci].leg.len / speed + 4 : (v.cycle[ci].leg.len - v.s) / speed + 2;
      for (let k = 0; k < v.cycle.length; k++) {
        const c = v.cycle[ci];
        if ((c.rev ? c.leg.from : c.leg.to) === id) return t;
        ci = (ci + 1) % v.cycle.length;
        t += dwell + v.cycle[ci].leg.len / speed + 4;
      }
      return Infinity;
    }
    // the deckhand takes over: dock at once
    function finishHelm(v) { if (v.helm) { v.helm = null; v.x = tmp.x; v.y = tmp.y; arrive(v); place(v); } }
    // where a passenger stands, in the vessel's frame: forward along end A, right, up
    const deck = vessels.length ? vessels[0].M.deck : { fwd: 5, right: 2.2, up: 4.33 };
    return { vessels, update, eta, stopOf, nextStop, wharf, finishHelm, deck };
  }

  function glbFerry(lib, name, colours, shared, opts, scale = 1) {
    const I = lib.ferryInfo || lib.info.ferry, src = lib.ferry.scene.clone(true), node = n => src.getObjectByName(n);
    const decal = decalTexture(name.toUpperCase(), { w: 1024, h: 150, color: colours.band, fill: 0.62, weight: 700, spacing: 0.1 });
    const lamps = {};
    let mats;
    if (!shared) {
      const d = dress(src, I.paint, colours, { lamps, decals: { Decal_Name: decal } });
      mats = d.mats;
      shared = { mats, lamps };
    } else {
      src.traverse(o => {
        if (!o.isMesh) return;
        const trim = /^Trim/.test(o.name) || (o.parent && /^Trim/.test(o.parent.name));
        const m = shared.mats.get(`${o.material.name}|${trim}`);
        if (m) o.material = m;
        o.castShadow = !trim && !o.material.transparent;
        o.receiveShadow = true;
      });
    }
    // each vessel writes its own name
    src.traverse(o => {
      if (o.isMesh && o.material.name === 'Decal_Name') { o.material = o.material.clone(); o.material.map = decal; o.material.visible = true; }
    });
    const g = new THREE.Group();
    g.add(src);
    const radar = node('Radar'), flag = node('Flag'), body = node('Body'), trim = node('Trim'), lod1 = node('Body_LOD1');
    // the flag waves: its own copy of the geometry, bent each frame
    let flagMesh = null;
    flag.traverse(o => { if (o.isMesh) flagMesh = o; });
    flagMesh.geometry = flagMesh.geometry.clone();
    const fp = flagMesh.geometry.attributes.position, f0 = Float32Array.from(fp.array);
    const L = {};
    const spot = (key, at, colour, size) => { const s = glow(colour); s.position.copy(node(at).position); s.userData.size = size; src.add(s); L[key] = s; };
    spot('left', 'Side_Left', '#ff2a2a', 2.2); spot('right', 'Side_Right', '#2aff6a', 2.2); spot('mast', 'Masthead', '#ffffff', 2.6);
    const dp = node('Deck_Passenger').position;
    const tmpV = new THREE.Vector3(), red = lin('#ff2a2a'), green = lin('#2aff6a');
    function animate(dt, t, { night, lead }) {
      radar.rotation.y += dt * 2.6;
      // flag: a travelling wave that grows towards the fly
      for (let i = 0; i < fp.count; i++) {
        const x = f0[3 * i + 2], k = Math.min(1, Math.abs(x) / 1.1);
        fp.setX(i, f0[3 * i] + Math.sin(t * 7 + x * 5) * 0.12 * k);
      }
      fp.needsUpdate = true;
      // sidelights: red to port. Going end A first, port is the left side
      L.left.material.color.copy(lead > 0 ? red : green);
      L.right.material.color.copy(lead > 0 ? green : red);
      for (const s of Object.values(L)) { s.scale.setScalar(s.userData.size * (0.35 + 0.9 * night)); s.material.opacity = 0.25 + 0.75 * night; }
      if (opts.camera) {
        const far = opts.camera.position.distanceTo(g.getWorldPosition(tmpV)) > (I.lod1_m || 260);
        body.visible = trim.visible = !far;
        if (lod1) lod1.visible = far;
      }
    }
    // after dark the cabins light up (shared materials: set once per frame by whichever vessel runs first)
    const lampsAll = shared.lamps;
    const animateLamps = night => {
      for (const ms of Object.values(lampsAll)) for (const m of ms) m.emissiveIntensity = m.name === 'Light_Cabin' ? 2.2 * night : 1.2 * night + 0.2;
      const win = shared.mats.get('Window|false');
      if (win) { win.emissiveIntensity = 0.55 * night; win.opacity = 0.62 + 0.25 * night; }
    };
    // the city's ferry_style may ask for a longer or shorter vessel: the whole model scales
    g.scale.setScalar(scale);
    return { g, labelY: (I.label_m || 12.2) * scale, shared, length: I.length_m * scale, deck: { fwd: dp.z * scale, right: -dp.x * scale, up: dp.y * scale },
      animate: (dt, t, o) => { animateLamps(o.night); animate(dt, t, o); } };
  }

  // where the water draws its own foam field (water.js on r186: opts.water), the wakes, hull
  // foam and downwash rings are drawn into it from above and leave the main view, so the foam
  // rides the waves; otherwise they lie on the water as meshes
  function onWake(mesh, opts) { if (opts.water && opts.water.wakeLayer != null) { mesh.layers.set(opts.water.wakeLayer); opts.water.wakes = true; } }
  // the wake: a ribbon of foam behind the trailing end that spreads at the Kelvin angle
  // (tan 19.47 deg = 0.354) and fades; the bow wave and propeller wash ride a skirt of foam
  // round the waterline
  const WAKE_N = 46, WAKE_STEP = 2.5;
  const wakeMat = once(() => new THREE.MeshBasicMaterial({ map: foamTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
  // across the wake: the two arms of the V at its edges, calm water inside them, and the
  // churned propeller wash down the middle, which narrows and fades sooner
  const K = 7;
  function ribbon(world, w0 = 4.4) {
    const N = WAKE_N, pos = new Float32Array(N * K * 3), col = new Float32Array(N * K * 3), uv = new Float32Array(N * K * 2), idx = [];
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < K - 1; k++) { const a = i * K + k, b = a + K; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, wakeMat());
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    world.add(mesh);
    // pts: newest first, each { x, y, s (arc coordinate), t (time), w (strength) }
    function draw(pts, t, light) {
      let d = 0;
      for (let i = 0; i < N; i++) {
        const ii = Math.min(i, pts.length - 1), p = pts[ii] || { x: 0, y: 0, s: 0, t, w: 0 }, q = pts[Math.max(0, ii - 1)] || p;
        if (i && i < pts.length) d += Math.hypot(p.x - q.x, p.y - q.y);
        const nxt = pts[Math.min(i + 1, pts.length - 1)] || p, prv = pts[Math.max(0, i - 1)] || p;
        let ax = prv.x - nxt.x, ay = prv.y - nxt.y;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al; ay /= al;
        const w = w0 + 0.354 * d, age = t - p.t, arm = 1.2 + 0.05 * d, wash = Math.min(w - arm, w0 * 0.64 + 0.07 * d);
        const f = (i < pts.length ? 1 : 0) * Math.exp(-d / 110) * Math.exp(-Math.max(0, age) / 45) * (p.w ?? 1) * light;
        const offs = [-w, -(w - arm), -wash, 0, wash, w - arm, w];
        const lum = [0, 0.5 * f, 0.05 * f, 0.7 * f * Math.exp(-d / 50), 0.05 * f, 0.5 * f, 0];
        for (let k = 0; k < K; k++) {
          const o = offs[k], j = i * K + k;
          pos[3 * j] = p.x - ay * o; pos[3 * j + 1] = 0.05; pos[3 * j + 2] = -(p.y + ax * o);
          col[3 * j] = col[3 * j + 1] = col[3 * j + 2] = lum[k];
          uv[2 * j] = k / (K - 1); uv[2 * j + 1] = p.s / 40;
        }
      }
      geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.uv.needsUpdate = true;
      mesh.visible = pts.length > 1;
    }
    return { mesh, draw };
  }
  function ferryEffects(world, M, I, opts) {
    // the wake starts as wide as the hull (4.4 m each side for the harbour ferry)
    const w0 = I && I.beam_m ? I.beam_m / 2 * (M.length && I.length_m ? M.length / I.length_m : 1) - 0.4 : 4.4;
    const live = ribbon(world, w0), ghost = ribbon(world, w0);
    onWake(live.mesh, opts); onWake(ghost.mesh, opts);
    let S = [], left = [], arc = 0, lastLead = 0; // samples of the trailing end, newest first; `left` is the wake left behind on reversing
    // foam round the hull at the waterline
    const wl = I ? I.waterline : null;
    let skirt = null, sc = null, sw = null;
    if (wl) {
      const n = wl.length, sp = new Float32Array(n * 2 * 3), suv = new Float32Array(n * 2 * 2), si = [];
      sc = new Float32Array(n * 2 * 3);
      sw = wl.map(([x, y]) => x / (I.length_m / 2));
      wl.forEach(([x, y], i) => {
        // outward normal of the (anticlockwise) waterline
        const a = wl[(i + n - 1) % n], b = wl[(i + 1) % n], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ox = (b[1] - a[1]) / tl, oy = -(b[0] - a[0]) / tl, grow = 2.6;
        const nx = x + ox * 0.2, ny = y + oy * 0.2, fx = x + ox * grow, fy = y + oy * grow;
        // model frame: x left, z forward (the waterline is written in the vehicle frame: x forward, y left)
        sp.set([ny, 0.05, nx, fy, 0.05, fx], i * 6);
        suv.set([i / n * 6, 0, i / n * 6, 1], i * 4);
        const j = (i + 1) % n;
        si.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
      });
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
      sg.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
      sg.setIndex(si);
      skirt = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: foamTex().clone(), vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
      skirt.material.map.wrapS = skirt.material.map.wrapT = THREE.RepeatWrapping;
      skirt.material.map.needsUpdate = true;
      skirt.renderOrder = 1;
      onWake(skirt, opts);
      M.g.add(skirt);
    }
    const half = M.length ? M.length / 2 - 1 : 16;
    function update(dt, t, v, { night, lead, speed }) {
      const light = (0.2 + 0.8 * (1 - night)) * 0.9;
      // the trailing end, on the water; a double-ended ferry swaps ends when she reverses
      if (lastLead && lead !== lastLead) { left = S; S = []; }
      lastLead = lead;
      const tx = v.x - Math.sin(v.h) * half * lead, ty = v.y - Math.cos(v.h) * half * lead;
      const moved = S.length ? Math.hypot(tx - S[0].x, ty - S[0].y) : 0;
      if (!S.length || (speed > 0.3 && moved > WAKE_STEP)) {
        arc += moved;
        S.unshift({ x: tx, y: ty, s: arc, t, w: Math.min(1, speed / 6) });
        if (S.length > WAKE_N) S.pop();
      }
      // the live head follows the stern; the rest stay where the water was churned
      live.draw([{ x: tx, y: ty, s: arc + (S.length ? Math.hypot(tx - S[0].x, ty - S[0].y) : 0), t, w: Math.min(1, speed / 6) }].concat(S.slice(0, WAKE_N - 1)), t, light);
      ghost.draw(left, t, light);
      if (skirt) {
        // bow wave at the leading end, wash at the trailing end, a thin line along the sides
        const k = Math.min(1, speed / 7);
        for (let i = 0; i < sw.length; i++) {
          const e = sw[i] * lead, bow = Math.pow(Math.max(0, e), 6), stern = Math.pow(Math.max(0, -e), 8);
          const inner = (0.12 + 1.1 * bow + 0.6 * stern) * k * light, outer = (0.9 * bow + 0.25 * stern) * k * light * 0.6;
          sc.set([inner, inner, inner, outer, outer, outer], i * 6);
        }
        skirt.geometry.attributes.color.needsUpdate = true;
        skirt.material.map.offset.y = -t * 0.35 * lead;
      }
    }
    return { update, skirt };
  }

  // ------------------------------------------------------------ stand-ins built from kit.js parts
  // (when the Blender models can't be loaded)
  // the blur of two spinning blades: they sweep a share of each ring that falls as 1/r (dense at
  // the hub, faint at the rim), with a band where the painted tips pass
  const rotorDisc = (() => {
    let tex = null;
    return () => {
      if (tex) return tex;
      const n = 128, c = document.createElement('canvas');
      c.width = c.height = n;
      const x = c.getContext('2d'), g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      for (let k = 0; k <= 20; k++) { const r = k / 20; g.addColorStop(Math.min(r, 0.95), `rgba(32,38,43,${Math.min(0.55, 0.105 / Math.max(r, 0.01)).toFixed(3)})`); }
      g.addColorStop(0.955, 'rgba(214,112,40,0.28)'); g.addColorStop(0.985, 'rgba(214,112,40,0.28)'); g.addColorStop(1, 'rgba(32,38,43,0)');
      x.fillStyle = g; x.fillRect(0, 0, n, n);
      return (tex = new THREE.CanvasTexture(c));
    };
  })();
  // a light scenic helicopter (R44 / AS350 style), the design of the reef scene's one
  // (see kit.js) ported to this app: built in that scene's frame (+x nose, +z right) inside
  // a group turned to ours (+z nose)
  function helicopterModel(livery = '#c62d2a') {
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group(), body = new THREE.Group();
    body.rotation.y = -Math.PI / 2;
    g.add(body);
    const stripe = new THREE.MeshStandardMaterial({ color: lin(livery), roughness: 0.35 });
    const latheX = (prof, seg = 20) => new THREE.LatheGeometry(prof.map(([x, r]) => new THREE.Vector2(r, x)), seg).rotateZ(-Math.PI / 2);
    const finZ = (profile, t) => new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y))),
      { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2);
    // body: bubble cabin, engine deck, tail boom with a fin and a stabiliser
    kit.add(M.white, latheX([[1.7, 0.0], [1.6, 0.35], [1.2, 0.62], [0.5, 0.75], [-0.4, 0.76], [-1.2, 0.62], [-1.9, 0.34], [-2.1, 0.0]], 20).scale(1, 0.95, 0.88), 0, 1.15, 0);
    kit.add(M.glass, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.95, 0.72, 0.74), 1.0, 1.25, 0);
    kit.add(M.glass, K.box(1.0, 0.45, 0.02, -0.1, 1.55, 0.67)); kit.add(M.glass, K.box(1.0, 0.45, 0.02, -0.1, 1.55, -0.67));
    kit.add(stripe, latheX([[0.2, 0.0], [0.0, 0.7], [-0.9, 0.7], [-1.0, 0]], 8).scale(1, 0.12, 0.9).translate(0, 1.0, 0));
    kit.add(M.white, K.rod([-1.6, 1.4, 0], [-6.0, 1.65, 0], 0.3, 0.09, 12));
    kit.add(stripe, K.rod([-3.5, 1.52, 0], [-4.6, 1.58, 0], 0.202, 0.17, 12));
    kit.add(M.white, finZ([[-5.4, 1.55], [-6.15, 1.55], [-6.35, 2.55], [-5.9, 2.55]], 0.06));
    kit.add(M.white, K.slab([[-5.0, -0.8], [-5.0, 0.8], [-5.6, 0.8], [-5.6, -0.8]], 1.58, 0.05, 0.012));
    kit.add(M.white, K.ellipsoid(0.9, 0.42, 0.52), -0.7, 2.05, 0); // engine cowl and transmission fairing
    kit.add(M.dark, K.rod([-1.4, 1.95, -0.25], [-2.2, 1.75, -0.25], 0.07, 0.06, 6));
    for (const sd of [-1, 1]) { // skids on their cross tubes
      kit.add(M.black, K.rod([-1.4, 0.07, sd * 0.95], [1.8, 0.07, sd * 0.95], 0.045, 0.045, 8));
      kit.add(M.black, K.tube([[1.8, 0.07, sd * 0.95], [2.1, 0.2, sd * 0.93], [2.25, 0.45, sd * 0.9]], 0.045, 8, 6));
      for (const x of [0.65, -0.65]) kit.add(M.black, K.rod([x, 0.07, sd * 0.95], [x * 0.9, 0.85, sd * 0.42], 0.035, 0.035, 6));
    }
    kit.add(M.dark, K.box(0.4, 0.4, 1.0, 0.0, 1.0, 0)); kit.add(M.dark, K.box(0.12, 0.3, 0.9, 0.9, 1.3, 0)); // seats, panel
    kit.add(M.dark, K.cyl(0.07, 0.07, 0.5, 8).translate(-0.7, 2.35, 0)); // rotor mast
    kit.build(body);
    // main rotor: hub, two blades, a soft blur disc; the tail rotor is a small cross
    const rotor = new THREE.Group();
    rotor.position.set(-0.7, 2.6, 0);
    const rk = new K.Kit();
    rk.add(M.black, K.box(5.1, 0.025, 0.28, 2.55, 0, 0)); rk.add(M.black, K.box(5.1, 0.025, 0.28, -2.55, 0, 0));
    rk.add(M.alu, K.cyl(0.12, 0.12, 0.12, 10)); rk.add(M.orange, K.box(0.2, 0.03, 0.3, 4.95, 0.002, 0)); rk.add(M.orange, K.box(0.2, 0.03, 0.3, -4.95, 0.002, 0));
    rk.build(rotor, false);
    const blur = new THREE.Mesh(new THREE.CircleGeometry(5.1, 40), new THREE.MeshBasicMaterial({ map: rotorDisc(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.x = -Math.PI / 2;
    rotor.add(blur);
    body.add(rotor);
    const tail = new THREE.Group();
    tail.position.set(-6.05, 1.95, 0.1);
    const tk = new K.Kit(); tk.add(M.black, K.box(0.04, 0.9, 0.1)); tk.add(M.black, K.box(0.04, 0.1, 0.9)); tk.build(tail, false);
    body.add(tail);
    for (const [c, x, y, z, sz] of [['#ff2a1a', 1.0, 1.1, -0.75, 0.6], ['#22ff55', 1.0, 1.1, 0.75, 0.6], ['#fff4d8', -6.2, 2.5, 0, 0.7], ['#ffffff', -0.7, 2.75, 0, 0.8]])
      K.lamp(body, c, x, y, z, sz);
    return { g, rotor, tail, blur, tailAxis: 'z' };
  }

  function kitHeli() {
    const { g, rotor, tail, blur, tailAxis } = helicopterModel();
    return { group: g, seat: new THREE.Vector3(0.45, 0.9, 0.6), door: { x: 1.8, y: 0.3 },
      animate(dt, st) {
        rotor.rotation.y += st.rotor * dt * 42;
        tail.rotation[tailAxis] += st.rotor * dt * 60;
        blur.material.opacity = st.rotor;
        for (const b of rotor.children) if (b !== blur) b.visible = st.rotor < 0.6 || Math.random() < 0.5;
      } };
  }
  // a double-ended harbour ferry from the kit, at the dimensions and livery of the city's
  // game config ("ferry_style"): a lofted hull with its antifouling, boot stripe and sheer
  // band, a rubbing strake, a windowed saloon, an upper deck with rails and lifebuoys, a
  // wheelhouse at each end, a mast, and navigation and deck lights
  function ferryModel(style = {}) {
    const K = OEKit, M = K.materials(), kit = new K.Kit(), g = new THREE.Group();
    const L = style.length_m || 36, B = style.beam_m || 10, fb = 1.6;
    const colour = (c, d, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(c || d), roughness: 0.45 }, o));
    const upper = colour(style.upper, '#efe6cc'), trim = colour(style.trim, '#e2b22b', { roughness: 0.35 });
    const h = K.hull2({ L, B, dh: 1.3, fb, sheerEnd: 0.35, pn: 4.2, pm: 0.6 });
    kit.add(M.hull({ top: style.hull || '#1e5b3a', band: style.trim || '#e2b22b', bandY: [fb - 0.42, fb - 0.22], boot: '#d8d3c4', bootY: [0.0, 0.12], anti: '#5a1d18' }), h.shell);
    kit.add(M.deck, K.slab(h.plan, fb - 0.12, 0.12, 0));
    kit.add(M.rubber, K.tube(h.plan.map(([x, z]) => [x * 1.005, fb - 0.06, z]), 0.13, 120, 6, true)); // rubbing strake
    // main saloon: a rounded box with a band of windows and their mullions, doors amidships
    const sw = B - 1.6, sl = L * 0.74, y1 = fb, hs = 2.4;
    kit.add(upper, K.slab(K.rrect(sw, sl, 2.6), y1, hs, 0.04));
    kit.add(trim, K.slab(K.rrect(sw + 0.08, sl + 0.08, 2.64), y1 + hs - 0.32, 0.16, 0)); // a gold band under the eave
    for (const sx of [-1, 1]) {
      // (the slab's 4 cm bevel puts its wall at w / 2 + 0.04, so the glazing sits just proud of it)
      kit.add(M.glass, K.box(0.04, 1.05, sl - 5.6, sx * (sw / 2 + 0.065), y1 + 1.45, 0));
      for (let z = -sl / 2 + 2.8; z <= sl / 2 - 2.8 + 1e-6; z += 1.45) kit.add(upper, K.box(0.06, 1.1, 0.12, sx * (sw / 2 + 0.09), y1 + 1.45, z));
      kit.add(M.dark, K.box(0.05, 2.0, 1.4, sx * (sw / 2 + 0.07), y1 + 1.0, 0)); // doors amidships
    }
    for (const sz of [-1, 1]) kit.add(M.glass, K.box(sw - 5.6, 1.0, 0.04, 0, y1 + 1.45, sz * (sl / 2 + 0.065)));
    // upper deck: an overhanging roof, rails round it, a smaller enclosed cabin and benches
    const y2 = y1 + hs;
    kit.add(upper, K.slab(K.rrect(sw + 0.6, sl + 0.6, 2.9), y2, 0.18, 0.03));
    const rail = K.rrect(sw + 0.3, sl + 0.3, 2.75, 4).map(([x, z]) => [x, y2 + 1.05, z]);
    kit.add(M.chrome, K.tube(rail, 0.035, 90, 5, true));
    kit.add(M.chrome, K.tube(rail.map(([x, y, z]) => [x, y - 0.5, z]), 0.025, 90, 5, true));
    for (let k = 0; k < rail.length; k += 2) kit.add(M.chrome, K.rod([rail[k][0], y2 + 0.15, rail[k][2]], rail[k], 0.025, 0.025, 5));
    const cw = sw - 2.6, cl = sl * 0.42;
    kit.add(upper, K.slab(K.rrect(cw, cl, 1.0), y2 + 0.18, 2.1, 0.04));
    for (const sx of [-1, 1]) kit.add(M.glass, K.box(0.04, 0.9, cl - 2.4, sx * (cw / 2 + 0.065), y2 + 1.35, 0));
    kit.add(upper, K.slab(K.rrect(cw + 0.4, cl + 0.4, 1.1), y2 + 2.28, 0.12, 0.03));
    kit.add(trim, K.slab(K.rrect(cw + 0.44, cl + 0.44, 1.12), y2 + 2.2, 0.1, 0));
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) for (let r = 0; r < 3; r++) // benches fore and aft of the cabin
      kit.add(M.seat, K.box(1.6, 0.45, 0.5, sx * 1.6, y2 + 0.4, sz * (cl / 2 + 1.4 + r * 1.2)));
    // a wheelhouse at each end, windows all round, a light mast on the roof
    for (const sz of [-1, 1]) {
      const zc = sz * (sl / 2 - 2.0);
      kit.add(upper, K.slab(K.rrect(3.6, 2.6, 0.6), y2 + 0.18, 2.0, 0.04).translate(0, 0, zc));
      kit.add(M.glass, K.box(2.6, 0.8, 0.04, 0, y2 + 1.55, zc + sz * 1.365));
      for (const sx of [-1, 1]) kit.add(M.glass, K.box(0.04, 0.8, 1.6, sx * 1.865, y2 + 1.55, zc));
      kit.add(upper, K.slab(K.rrect(4.2, 3.2, 0.7), y2 + 2.2, 0.12, 0.03).translate(0, 0, zc));
      kit.add(M.dark, K.rod([0, y2 + 2.32, zc], [0, y2 + 3.6, zc], 0.05, 0.04, 6));
      K.lamp(g, '#fff6e0', 0, y2 + 3.65, zc, 0.6); // masthead light
    }
    // lifebuoys on the rails
    for (const sx of [-1, 1]) for (const sz of [-0.3, 0.3])
      kit.add(M.orange, new THREE.TorusGeometry(0.33, 0.07, 6, 16).rotateY(Math.PI / 2).translate(sx * (sw / 2 + 0.2), y2 + 0.75, sz * sl));
    // mast and flag amidships
    kit.add(M.dark, K.rod([0, y2 + 2.4, 0], [0, y2 + 6.6, 0], 0.07, 0.05, 6));
    kit.build(g);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 1.1), colour(style.flag, '#a8322a'));
    flag.position.set(0, y2 + 6.1, 0.55);
    g.add(flag);
    // navigation lights: red to port (+x), green to starboard, white deck lights
    K.lamp(g, '#ff2a1a', sw / 2 + 0.3, y2 + 0.4, 0, 0.7); K.lamp(g, '#22ff55', -sw / 2 - 0.3, y2 + 0.4, 0, 0.7);
    for (const sz of [-1, 1]) K.lamp(g, '#ffe7c0', 0, y2 + 2.5, sz * cl / 2, 0.9);
    return { g, flag };
  }

  function kitFerry(style) {
    const { g, flag } = ferryModel(style);
    return { g, labelY: 9.4, deck: { fwd: 5, right: 2.2, up: 4.2 }, animate(dt, t) { flag.rotation.y = Math.sin(t * 3) * 0.3; } };
  }

  return { load, helicopter, ferries, livery };
})();
