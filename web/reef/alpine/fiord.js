// What moves on a fiord's walls and over its water (scene.json `falls` and `birds`; cities/<id>/city.json):
//
// - the waterfalls: each is traced down the model's own wall from its mapped lip to the sea (steepest descent on the
//   height grid), and drawn as a ribbon of falling water along that line: streaks that speed up as they fall, a white
//   core, torn edges. At its foot a plume of spray drifts off on the wind, and a ring of foam lies on the sea.
// - the rainbow in the spray: light scattered back at 40.5 to 42.4 degrees from the point opposite the sun, as in any
//   bow, so it stands in the spray only when the sun is behind the eye and low enough, and moves as the eye moves.
// - the gulls: red-billed and black-backed gulls wheeling behind the ship and over the fall's foot, flapping and
//   gliding by turns, banked into their circles.
//
// - what you hear: the fall, the gulls and a bellbird in the bush, all synthesised (below).
//
// ?falls=0 and ?birds=0 leave them out; ?mute=1 the sound. window.__fiord = { falls, gulls } for the tests.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, uv, mix, max, min, abs, floor, fract, sin, smoothstep, dot, normalize, length, pow, acos, clamp, uniform, attribute,
  mx_noise_float, cameraPosition, positionWorld, positionLocal } from 'three/tsl';

const hash = (i, k) => { let h = (i * 2654435761 + k * 40503 + 12345) >>> 0; h = ((h ^ (h >>> 15)) * 2246822519) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export async function init(ctx) {
  const { S, q, scene, camera, env, light } = ctx;
  const time = env.u.time;
  const tide = () => env.u.tide.value;
  const group = new THREE.Group(); group.name = 'fiord'; scene.add(group);
  const updaters = [];
  // the light on white water and feathers: the sun (through the mountains' shadow) and the sky
  const lit = (P, k = 1) => vec3(light.u.sunE).mul(light.sunVis(P)).mul(0.8).add(vec3(light.u.skyE).mul(0.85)).mul(k / Math.PI);

  // ------------------------------------------------------------------ the falls
  const falls = [];
  function trace(x0, n0) {
    // down the steepest slope in 3 m steps, to the sea
    const pts = []; let x = x0, n = n0;
    for (let k = 0; k < 900; k++) {
      const h = ctx.height(x, n);
      pts.push({ x, n, h });
      if (h <= tide() + 0.2) break;
      const e = 6, gx = (ctx.height(x + e, n) - ctx.height(x - e, n)) / (2 * e), gn = (ctx.height(x, n + e) - ctx.height(x, n - e)) / (2 * e), g = Math.hypot(gx, gn);
      if (g < 0.03) break;
      x -= gx / g * 3; n -= gn / g * 3;
    }
    return pts;
  }
  function buildFall(F) {
    const p = F.poi ? ctx.poi(F.poi) : F;
    if (!p) return null;
    let pts = trace(p.x, p.y);
    // (a fall that lands on a flat above the sea, as Lady Bowen Falls does on its fan, is drawn to where the wall ends)
    const sea = pts[pts.length - 1].h <= tide() + 0.5;
    if (!sea) { let k = pts.length - 1; while (k > 4 && pts[k - 3].h - pts[k].h < 2.2) k--; pts = pts.slice(0, k + 1); }
    if (pts.length < 6 || pts[0].h - pts[pts.length - 1].h < 25) return null;   // no wall under the mapped point in this model
    const top = pts[0].h, low = sea ? tide() : pts[pts.length - 1].h, drop = top - low, w0 = F.width_m ?? 10, flow = F.flow ?? 1;
    // the water leaves the lip and falls clear of the wall: out by a few metres as it drops, never inside the rock
    const pos = [], uvs = [], idx = [], aD = [];
    let fallen = 0, prev = null;
    const dirOf = i => { const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)], l = Math.hypot(b.x - a.x, b.n - a.n) || 1; return [(b.x - a.x) / l, (b.n - a.n) / l]; };
    pts.forEach((pt, i) => {
      const [dx, dn] = dirOf(i), f = (top - pt.h) / Math.max(drop, 1);
      const out = 1.6 + Math.min(7, 0.07 * (top - pt.h)), y = Math.max(pt.h, low) + 0.9;
      const cx = pt.x + dx * out, cn = pt.n + dn * out;
      if (prev) fallen += Math.hypot(cx - prev[0], y - prev[1], cn - prev[2]);
      prev = [cx, y, cn];
      const w = w0 * (0.5 + 1.1 * Math.sqrt(f)) * 0.5, sx = -dn, sn = dx;
      for (const s of [-1, 1]) { pos.push(cx + sx * w * s, y, -(cn + sn * w * s)); uvs.push(s, fallen); aD.push(f); }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aD', new THREE.Float32BufferAttribute(aD, 1)); geo.setIndex(idx); geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const u = uv().x, v = uv().y, fD = attribute('aD', 'float');
    const dens = Fn(() => {
      // streaks: slow broad sheets and fast fine threads, both stretched along the fall and running down it
      const a = mx_noise_float(vec2(u.mul(2.2), v.sub(time.mul(13)).div(11)));
      const b = mx_noise_float(vec2(u.mul(7.0).add(3), v.sub(time.mul(21)).div(4.2)));
      const c = mx_noise_float(vec2(u.mul(19.0).add(9), v.sub(time.mul(27)).div(1.6)));
      const core = float(1).sub(u.mul(u)).mul(0.55);
      const body = smoothstep(-0.25, 0.45, a.mul(0.5).add(b.mul(0.34)).add(c.mul(0.2)).add(core).sub(float(1).sub(flow).mul(0.5)));
      const edge = float(1).sub(smoothstep(0.5, 1.0, abs(u).add(b.mul(0.18))));
      return body.mul(edge).mul(smoothstep(0.0, 2.5, v));
    })();
    mat.colorNode = Fn(() => lit(positionWorld, 0.97).mul(mix(float(0.82), float(1.0), dens)))();
    // (the water thins to spray as it falls: more of the wall shows through near the foot's cloud)
    mat.opacityNode = dens.mul(mix(float(0.97), float(0.8), fD));
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.name = `fall-${F.id}`;
    group.add(mesh);
    const foot = pts[pts.length - 1], [fdx, fdn] = dirOf(pts.length - 1);
    const fall = { id: F.id, name: F.name, top: { x: pts[0].x, n: pts[0].n, h: top }, foot: { x: foot.x + fdx * 8, n: foot.n + fdn * 8, h: low }, drop, width: w0, flow, mesh, dir: [fdx, fdn], sea };
    spray(fall); if (sea) foam(fall);
    return fall;
  }
  // the spray: soft sheets turned to the eye, born at the foot, rising and drifting off as they thin; one mesh a fall
  function spray(fall) {
    const N = 22, R = Math.min(60, 12 + fall.drop * 0.2) * Math.sqrt(fall.flow);
    const pos = new Float32Array(N * 12), uvs = new Float32Array(N * 8), aC = new Float32Array(N * 16), aV = new Float32Array(N * 16), idx = [];
    const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < N; i++) {
      const a = hash(i, 1) * 6.283, d = Math.sqrt(hash(i, 2)) * R * 0.5;
      const c = [fall.foot.x + Math.cos(a) * d, fall.foot.h + 2 + hash(i, 3) * R * 0.25, -(fall.foot.n + Math.sin(a) * d), hash(i, 4)];
      const vel = [(-fall.dir[0] * 0.2 + fall.dir[0] * 1.6) + (hash(i, 5) - 0.5) * 1.2, 0.9 + hash(i, 6) * 1.6, -(fall.dir[1] * 1.4) + (hash(i, 7) - 0.5) * 1.2, R * (0.45 + 0.6 * hash(i, 8))];
      for (let k = 0; k < 4; k++) { const o = i * 4 + k; pos.set([corner[k][0], corner[k][1], 0], o * 3); uvs.set([corner[k][0], corner[k][1]], o * 2); aC.set(c, o * 4); aV.set(vel, o * 4); }
      const o = i * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aC', new THREE.BufferAttribute(aC, 4)); geo.setAttribute('aV', new THREE.BufferAttribute(aV, 4)); geo.setIndex(idx);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const C = attribute('aC', 'vec4'), V = attribute('aV', 'vec4');
    const LIFE = 16;
    const life = Fn(() => fract(time.div(LIFE).add(C.w)))();
    mat.positionNode = Fn(() => {
      const p = attribute('position', 'vec3'), l = life, size = V.w.mul(float(0.45).add(l.mul(0.9)));
      const c = vec3(C.x, C.y, C.z).add(vec3(V.x, V.y, V.z).mul(l.mul(LIFE)));
      return c.add(vec3(spR).mul(p.x.mul(size))).add(vec3(spU).mul(p.y.mul(size)));
    })();
    const body = Fn(() => {
      const p = uv(), r = length(p).add(mx_noise_float(vec3(p.mul(1.6), C.w.mul(40).add(time.mul(0.15)))).mul(0.3));
      return smoothstep(0.95, 0.2, r).mul(smoothstep(0.0, 0.12, life)).mul(float(1).sub(smoothstep(0.45, 1.0, life)));
    })();
    mat.colorNode = Fn(() => {
      const base = lit(positionWorld, 0.95);
      // the bow: the angle between the line of sight and the point opposite the sun
      const ray = normalize(positionWorld.sub(cameraPosition));
      const th = acos(clamp(dot(ray, vec3(light.u.sunDir).negate()), -1, 1)).mul(180 / Math.PI);
      const band = (c, w) => { const d = th.sub(c).div(w); return float(1).div(d.mul(d).add(1)).pow(3); };
      const bow = vec3(band(42.1, 0.55), band(41.3, 0.55), band(40.6, 0.6)).mul(smoothstep(39.4, 40.2, th)).mul(float(1).sub(smoothstep(42.6, 43.4, th)));
      const sunLit = vec3(light.u.sunE).mul(light.sunVis(positionWorld)).mul(1 / Math.PI);
      return base.add(bow.mul(sunLit).mul(2.6));
    })();
    // (thin round the eye: inside the plume the sheets would stack to a white wall)
    mat.opacityNode = body.mul(0.34 * Math.min(1, 0.5 + fall.flow * 0.5)).mul(smoothstep(10, 90, length(positionWorld.sub(cameraPosition))));
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = `spray-${fall.id}`;
    group.add(mesh); fall.spray = mesh;
  }
  const spR = uniform(new THREE.Vector3(1, 0, 0)), spU = uniform(new THREE.Vector3(0, 1, 0));
  updaters.push(() => { spR.value.set(1, 0, 0).applyQuaternion(camera.quaternion); spU.value.set(0, 1, 0).applyQuaternion(camera.quaternion); });
  // the foam where the fall strikes the sea: a churned ring spreading out and breaking up
  function foam(fall) {
    const R = (10 + fall.width * 2.2) * Math.sqrt(fall.flow);
    const geo = new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.colorNode = Fn(() => lit(positionWorld, 0.9))();
    mat.opacityNode = Fn(() => {
      const p = positionLocal.xz.div(R), r = length(p);
      const churn = mx_noise_float(vec3(positionLocal.x.mul(0.35), time.mul(0.6), positionLocal.z.mul(0.35))).mul(0.5).add(mx_noise_float(vec3(positionLocal.x.mul(1.3), time.mul(1.1), positionLocal.z.mul(1.3))).mul(0.5));
      const rings = sin(r.mul(26).sub(time.mul(2.2))).mul(0.15);
      return smoothstep(0.15, 0.75, float(1).sub(r).add(churn.mul(0.55)).add(rings)).mul(smoothstep(1.0, 0.8, r)).mul(0.9);
    })();
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; mesh.name = `foam-${fall.id}`;
    mesh.position.set(fall.foot.x, tide() + 0.22, -fall.foot.n);
    group.add(mesh); fall.foam = mesh;
    updaters.push(() => { mesh.position.y = tide() + 0.22; });
  }
  if (q.get('falls') !== '0') for (const F of S.falls || []) { const f = buildFall(F); if (f) falls.push(f); }

  // ------------------------------------------------------------------ the gulls
  const gulls = [];
  const B = S.birds;
  if (B && q.get('birds') !== '0' && (ctx.tier ? ctx.tier.flora !== 0 : true)) {
    // a gull about 0.4 m long with a metre of wing: +x ahead, +y up, +z the right wing. aW runs 0 at the body to 1 at a wing's tip
    const pos = [], col = [], aW = [], idx = [];
    const WHITE = [0.86, 0.86, 0.84], GREY = [0.42, 0.45, 0.5], BLACK = [0.03, 0.03, 0.035], BILL = [0.7, 0.1, 0.06];
    const vtx = (x, y, z, c, w = 0) => { pos.push(x, y, z); col.push(...c); aW.push(w); return pos.length / 3 - 1; };
    const tri = (a, b, c) => idx.push(a, b, c);
    // body: a spindle of 6 rings
    const rings = [[0.21, 0.0], [0.15, 0.035], [0.05, 0.055], [-0.07, 0.05], [-0.16, 0.03], [-0.25, 0.004]], SEG = 6, ring0 = [];
    rings.forEach(([x, r], i) => { for (let k = 0; k < SEG; k++) { const a = k / SEG * 6.283; ring0.push(vtx(x, Math.sin(a) * r * 0.9 + (i < 2 ? 0.012 : 0), Math.cos(a) * r, i === 0 ? BILL : i === 5 ? WHITE : WHITE)); } });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < SEG; k++) { const a = ring0[i * SEG + k], b = ring0[i * SEG + (k + 1) % SEG], c = ring0[(i + 1) * SEG + k], e = ring0[(i + 1) * SEG + (k + 1) % SEG]; tri(a, c, b); tri(b, c, e); }
    // tail: a small fan
    const t0 = vtx(-0.2, 0.01, 0, WHITE), t1 = vtx(-0.36, 0.0, -0.06, WHITE), t2 = vtx(-0.36, 0.0, 0.06, WHITE); tri(t0, t1, t2); tri(t0, t2, t1);
    // wings: an inner and an outer panel a side, swept a little, grey above with black tips (drawn on both faces)
    for (const s of [-1, 1]) {
      const a = vtx(0.09, 0.03, 0.03 * s, GREY, 0), b = vtx(-0.07, 0.03, 0.03 * s, GREY, 0);
      const c = vtx(0.1, 0.03, 0.27 * s, GREY, 0.5), e = vtx(-0.08, 0.03, 0.26 * s, GREY, 0.5);
      const f = vtx(-0.02, 0.03, 0.56 * s, BLACK, 1), g = vtx(0.05, 0.03, 0.4 * s, GREY, 0.75), h = vtx(-0.09, 0.03, 0.42 * s, GREY, 0.78);
      for (const [p, q2, r] of [[a, b, c], [b, e, c], [c, e, g], [e, h, g], [g, h, f]]) { tri(p, q2, r); tri(p, r, q2); }
    }
    const geo0 = new THREE.BufferGeometry();
    geo0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo0.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo0.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 1)); geo0.setIndex(idx); geo0.computeVertexNormals();
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const w = attribute('aW', 'float'), seed = attribute('aSeed', 'float');
    mat.positionNode = Fn(() => {
      const p = positionLocal;
      // a few beats, then a glide on set wings held a little above level
      const beat = smoothstep(-0.2, 0.3, sin(time.mul(0.55).add(seed.mul(17))));
      const ang = sin(time.mul(mix(float(15), float(19), fract(seed.mul(7.3)))).add(seed.mul(40))).mul(0.62).mul(beat).add(float(0.16).mul(float(1).sub(beat)));
      const k = pow(w, 1.25);
      return vec3(p.x, p.y.add(abs(p.z).mul(sin(ang)).mul(k.add(0.25).min(1))), p.z.mul(float(1).sub(k.mul(float(1).sub(ang.cos())).mul(0.5))));
    })();
    mat.colorNode = Fn(() => {
      const c = attribute('color', 'vec3');
      return c.mul(vec3(light.u.sunE).mul(light.sunVis(positionWorld)).mul(0.7).add(vec3(light.u.skyE).mul(0.9)).mul(1 / Math.PI));
    })();
    const n = Math.round((B.gulls ?? 30) * (ctx.tier && ctx.tier.flora < 1 ? 0.6 : 1));
    const anchors = (B.anchors || []).map(a => a === 'ship' ? { ship: true } : (falls.find(f => f.id === a) ? { fall: falls.find(f => f.id === a) } : ctx.poi(a))).filter(Boolean);
    for (let i = 0; i < n && anchors.length; i++) {
      const g = geo0.clone(); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(hash(i, 1) * 10), 1));
      const m = new THREE.Mesh(g, mat); m.rotation.order = 'YXZ'; m.frustumCulled = false;
      const big = hash(i, 9) < 0.3;                                  // a black-backed gull: half as big again
      m.scale.setScalar(big ? 1.5 : 1.0);
      const a = anchors[i < n * 0.45 ? 0 : 1 + (i % Math.max(1, anchors.length - 1))] || anchors[0];
      gulls.push({ m, a, r: 14 + hash(i, 2) * (a.ship ? 38 : 70), ph: hash(i, 3) * 6.283, dir: hash(i, 4) < 0.5 ? 1 : -1, alt: 5 + hash(i, 5) * (a.ship ? 22 : 45), v: 8.5 + hash(i, 6) * 4, ex: 0.3 + hash(i, 7) * 0.5, th: hash(i, 8) * 6.283, x: 0, y: 0, z: 0 });
      group.add(m);
    }
    const ship = () => ctx.boats && ctx.boats.vessels.find(v => v.kind === 'ship');
    updaters.push((dt, t) => {
      const sv = ship();
      for (const g of gulls) {
        let cx, cz, base = tide();
        if (g.a.ship) { if (!sv) { g.m.visible = false; continue; } const back = 18 + g.r * 0.4; cx = sv.x - Math.sin(sv.hdg) * back; cz = sv.z + Math.cos(sv.hdg) * back; base += 6; }
        else if (g.a.fall) { cx = g.a.fall.foot.x + g.a.fall.dir[0] * 60; cz = -(g.a.fall.foot.n + g.a.fall.dir[1] * 60); }
        else { cx = g.a.x; cz = -g.a.y; base = Math.max(base, ctx.height(g.a.x, g.a.y)); }
        // a wandering oval: the circle's radius breathes, and the whole circle drifts
        const r = g.r * (1 + g.ex * Math.sin(t * 0.13 + g.ph));
        g.th += g.dir * g.v / r * dt;
        const ox = Math.sin(t * 0.05 + g.ph * 3) * g.r * 0.8, oz = Math.cos(t * 0.04 + g.ph * 2) * g.r * 0.8;
        const x = cx + ox + Math.cos(g.th) * r, z = cz + oz + Math.sin(g.th) * r * 0.8;
        const y = base + g.alt * (1 + 0.35 * Math.sin(t * 0.21 + g.ph * 5));
        const vx = x - g.x, vz = z - g.z, vy = y - g.y;
        g.x = x; g.y = y; g.z = z;
        g.m.position.set(x, y, z);
        if (dt > 0 && (vx || vz)) {
          const hd = Math.atan2(-vz, vx);                                            // +x ahead: yaw about y
          g.m.rotation.set(-g.dir * Math.min(0.6, g.v * g.v / (r * 9.81)), hd, Math.max(-0.4, Math.min(0.4, vy / Math.max(Math.hypot(vx, vz), 1e-3))));
        }
        g.m.visible = true;
      }
    });
  }

  // ------------------------------------------------------------------ what you hear
  // All of it is made here, no recordings: the fall's roar (filtered noise, by how near the nearest fall is), the
  // gulls' calls (a falling, rasping cry from the nearest bird, now and then) and, by day near the bush, a bellbird's
  // few clear notes. Quiet, and off with ?mute=1; it starts on the first key or touch, as browsers require.
  const audio = { on: false };
  if (q.get('mute') !== '1' && !q.get('still') && (window.AudioContext || window.webkitAudioContext)) {
    let ac = null, roar = null, lap = null, master = null, nextGull = 4, nextBell = 7;
    const unlock = () => {
      if (ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
        const n = ac.sampleRate * 2, buf = ac.createBuffer(1, n, ac.sampleRate), ch = buf.getChannelData(0);
        let b0 = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.985 * b0 + 0.015 * w; ch[i] = w * 0.35 + b0 * 6; }   // white over brown
        const loop = (freq, Q) => { const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = Q; const g = ac.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(master); src.start(); return g; };
        roar = loop(520, 0.45); lap = loop(900, 0.8);
        audio.on = true;
      } catch (e) { ac = null; }
    };
    addEventListener('pointerdown', unlock, { once: false, passive: true }); addEventListener('keydown', unlock, { passive: true });
    const tone = (t0, f0, f1, dur, vol, type = 'sine', vib = 0) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      if (vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = vib; lg.gain.value = f0 * 0.04; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur); }
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.2)); g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    updaters.push((dt) => {
      if (!ac || !(dt > 0)) return;
      const cam = camera.position, t = ac.currentTime;
      let df = 1e9; for (const f of falls) df = Math.min(df, Math.hypot(cam.x - f.foot.x, cam.z + f.foot.n, cam.y - tide()) / Math.sqrt(f.flow * f.drop / 150));
      roar.gain.setTargetAtTime(Math.min(0.5, 30 / Math.max(df, 25)) * (cam.y < tide() ? 0.2 : 1), t, 0.4);
      lap.gain.setTargetAtTime(cam.y > tide() && cam.y < tide() + 30 && ctx.depth(cam.x, -cam.z) > 0 ? 0.035 : 0.008, t, 0.8);
      if ((nextGull -= dt) <= 0) {
        nextGull = 2.5 + Math.random() * 7;
        let dg = 1e9; for (const g of gulls) if (g.m.visible) dg = Math.min(dg, cam.distanceTo(g.m.position));
        const vol = Math.min(0.09, 2.2 / Math.max(dg, 12));
        if (vol > 0.004) { const n = 1 + Math.floor(Math.random() * 3), f = 1500 + Math.random() * 500; for (let i = 0; i < n; i++) tone(t + i * 0.34, f * 1.25, f * 0.62, 0.3, vol, 'sawtooth', 28); }
      }
      if ((nextBell -= dt) <= 0) {
        nextBell = 6 + Math.random() * 14;
        // a bellbird: by day, with bush near and the eye not far above the ground or the water
        const day = env.u.sunAlt.value > 0.05, cls = ctx.habitat(cam.x + 40, -cam.z + 40), near = cam.y - Math.max(ctx.height(cam.x, -cam.z), tide()) < 60;
        if (day && near && (cls === 10 || cls === 9 || ctx.habitat(cam.x - 60, -cam.z - 30) === 10)) {
          const notes = [2093, 2637, 3136, 2349, 2794], k = 3 + Math.floor(Math.random() * 3); let tt = t;
          for (let i = 0; i < k; i++) { const f = notes[Math.floor(Math.random() * notes.length)]; tone(tt, f, f * 0.985, 0.22, 0.03); tone(tt, f * 2, f * 1.97, 0.12, 0.008); tt += 0.16 + Math.random() * 0.14; }
        }
      }
    });
  }

  window.__fiord = { falls, gulls, group, audio };
  ctx.fiord = { falls, gulls };
  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}
