// Open Earth 3D after dark, as a city looks from the air at night: a light at the kerb every
// thirty-odd metres along every mapped road, the pavement and the foot of the buildings lit under
// them, the traffic's headlights and tail lights, and the red lights on the towers. Shared by the
// model viewer and the game (world.js builds it), from web/data/<city>/night.json, which
// pipeline/night_lights.py writes from the game's roads and the lamps OpenStreetMap maps.
//  - Street lights: a lamp every 28 to 44 m by the road's class, on one side of a small street and
//    staggered along both sides of a big one, 5 to 13 m up, in the city's own mix of sodium and LED
//    (night.json "style"). Each is a point of light that stays a point as it shrinks with distance,
//    brightest seen from the side, as the lamps' lenses are. The mapped lamps are lit too.
//  - The light they put down: every lamp's pool, stretched along its road, splatted once into a
//    map over the model. The ground adds it to what it reflects (lit asphalt shows the photo's
//    road markings), and so do the walls, fading up the lower floors; a coarse mip of the same map
//    is the glow of a busy district. Streets read as lines of light, parks and water stay dark.
//  - Traffic: cars as pairs of lights moving at the road's speed on its side of the road (the
//    city's "keep"), white where they come towards the camera and red where they go away, as many
//    as the hour has (rush hours full, three in the morning a sixth). Motorways run one way along
//    each mapped carriageway. In the game the real cars near the player take over.
//  - Aircraft warning lights on the tops of the towers above the city's height (60 m in Japan,
//    where they flash together; elsewhere steady).
// Everything fades in as the street lights come on, about when the sun sets.
'use strict';
window.OENight = (function () {
  // per road class: lamp spacing m, carriageway width m (as the game draws its streets), lamp
  // height m, lamps on both sides, lamp brightness, cars per km in each direction at the busiest hour
  const ROAD = {
    motorway: [44, 14, 13, true, 1.3, 34], trunk: [40, 12, 12, true, 1.2, 26], primary: [34, 12, 10, true, 1.1, 20],
    secondary: [34, 10, 9.5, true, 1.0, 13], tertiary: [34, 9, 8.5, false, 0.95, 7], residential: [36, 7, 7, false, 0.8, 1.6],
    unclassified: [38, 6, 7, false, 0.75, 1.6], living_street: [28, 5, 5, false, 0.7, 0] };
  const MAPPED = [6, 0.85]; // a mapped lamp: its height and brightness (a park or footway light)
  // the share of the busiest hour's traffic on the road at each hour of the day
  const TRAFFIC = [0.34, 0.24, 0.17, 0.15, 0.18, 0.34, 0.62, 0.9, 1, 0.86, 0.76, 0.74, 0.76, 0.74, 0.76, 0.84, 0.94, 1, 0.96, 0.82, 0.7, 0.62, 0.55, 0.45];
  const VMAX = 4; // the light map stores sqrt(light / VMAX) in 8 bits: fine steps in the dark

  const unpack = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int16Array(u.buffer); };
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296); }
  // a lamp colour in linear light at the luminance of white, so an orange sodium lamp is as bright as an LED one
  function lampColour(hex) {
    const c = new THREE.Color(hex).convertSRGBToLinear(), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return c.multiplyScalar(1 / Math.max(l, 1e-3));
  }
  function picker(mix, rnd) {
    const list = mix.map(([hex, w]) => [lampColour(hex), w]), sum = list.reduce((a, [, w]) => a + w, 0);
    return () => { let r = rnd() * sum; for (const [c, w] of list) if ((r -= w) <= 0) return c; return list[list.length - 1][0]; };
  }

  // GLSL for the materials the street lights fall on (world.js adds it to the ground and the piers,
  // buildings.js to the walls): streetLight(wp), the light at a world position (three.js frame)
  const GLSL = `uniform sampler2D uNightMap; uniform vec4 uNightXf; uniform float uNightOn;
vec3 streetLight(vec3 wp) {
  if (uNightOn <= 0.0) return vec3(0.0);
  vec2 uv = vec2((wp.x - uNightXf.x) * uNightXf.z, (-wp.z - uNightXf.y) * uNightXf.w);
  vec3 c = texture2D(uNightMap, uv).rgb, g = texture2D(uNightMap, uv, 6.0).rgb; // the pools, and the district's glow
  return (c * c + 0.4 * g * g) * ${VMAX.toFixed(1)} * uNightOn;
}`;
  // the uniforms that GLSL reads; world.js shares them with every material it patches
  const uniforms = () => ({ uNightMap: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uNightXf: { value: new THREE.Vector4(0, 0, 1, 1) }, uNightOn: { value: 0 } });

  // the edge haze (world.js) on an additive light: fog mixes towards the haze, a light just fades
  const FOG_FRAG = `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = max(gl_FragColor.rgb - fogColor * fogFactor, 0.0);
#endif`;
  function lightMaterial(extra, vertex, fragment) {
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), extra),
      vertexShader: vertex, fragmentShader: fragment, fog: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return m;
  }
  // a point of light: a hot core and a soft halo, drawn at least uMinPx across so a far light stays a point
  const POINT_FRAG = `varying vec3 vC;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * (exp(-r2 * 16.0) * 5.0 + exp(-r2 * 4.0) * 0.35) * (1.0 - r2), 1.0);
  ${FOG_FRAG}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

  // Wd: the world (world.js); D: the city's data (world.js load), with D.N its night.json
  // opts: small (the light tier: a coarser light map), game (the game: the real cars near the
  // camera, nearCars metres round it, take over from the traffic's lights; the game draws the
  // mapped lamps' poles itself)
  function create(Wd, D, renderer, NU, { small = false, game = false, nearCars = 0 } = {}) {
    const N = D.N, st = N.style || {}, [XY, ZU] = N.units, fr = D.scene.frame, rnd = rng(7919);
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    const roadsI = unpack(N.roads), P = unpack(N.pts), mapped = unpack(N.lamps);
    const street = picker(st.street || [['#ffc58c', 1]], rnd), highway = picker(st.highway || st.street || [['#ffc58c', 1]], rnd);
    const keepLeft = (st.keep || 'right') === 'left';
    // a road point on the ground drawn under it (the viewer's 10 m terrain, and the game's 5 m one
    // near the player: whichever is higher), or, more than 3 m above it, on its bridge's deck
    const S = window.Sun, grounds = [D.T, D.Tfine].filter(Boolean);
    const onGround = (x, y, z) => { let g = -Infinity; for (const t of grounds) g = Math.max(g, S.terrainTri(t, x, y)); return z - g > 3 ? z : Math.max(z, g); };
    const group = new THREE.Group();
    group.name = 'night';

    // ------------------------------------------------------------ the lamps
    // x, y, z (local, the lamp head), colour, brightness, pool along (ux, uy) and its height
    const L = { x: [], y: [], z: [], c: [], b: [], ux: [], uy: [], h: [], pole: [] };
    const lamp = (x, y, z, c, b, ux, uy, h, pole) => { L.x.push(x); L.y.push(y); L.z.push(z); L.c.push(c); L.b.push(b); L.ux.push(ux); L.uy.push(uy); L.h.push(h); L.pole.push(pole); };
    const roads = [];
    for (let i = 0, k = 0; i < roadsI.length; i += 3) {
      const cls = N.classes[roadsI[i]], n = roadsI[i + 2], pts = [];
      for (let j = 0; j < n; j++, k += 3) { const x = P[k] * XY, y = P[k + 1] * XY; pts.push([x, y, onGround(x, y, P[k + 2] * ZU)]); }
      roads.push({ cls, v: roadsI[i + 1] / 10, pts });
    }
    for (const r of roads) {
      const [spacing, width, h, both, bright] = ROAD[r.cls] || ROAD.unclassified;
      const step = both ? spacing / 2 : spacing, off = width / 2 + 0.7, pick = /motorway|trunk/.test(r.cls) ? highway : street;
      let side = rnd() < 0.5 ? 1 : -1, next = rnd() * step, acc = 0;
      const colour = pick(); // a road keeps one kind of lamp
      for (let j = 1; j < r.pts.length; j++) {
        const [ax, ay, az] = r.pts[j - 1], [bx, by, bz] = r.pts[j], len = Math.hypot(bx - ax, by - ay);
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        while (next <= acc + len) {
          const t = (next - acc) / len, s = both ? side = -side : side;
          lamp(ax + (bx - ax) * t - uy * s * off, ay + (by - ay) * t + ux * s * off, az + (bz - az) * t + h, colour, bright * (0.9 + 0.2 * rnd()), ux, uy, h, s);
          next += step;
        }
        acc += len;
      }
    }
    const nGen = L.x.length;
    for (let i = 0; i < mapped.length; i += 3) {
      const x = mapped[i] * XY, y = mapped[i + 1] * XY;
      lamp(x, y, onGround(x, y, mapped[i + 2] * ZU) + MAPPED[0], street(), MAPPED[1], 0, 0, MAPPED[0], 0);
    }
    const nL = L.x.length;

    // ------------------------------------------------------------ the light they put down
    // each lamp's pool on the ground, a Gaussian 1.1 lamp heights along the road and 0.6 across it
    // (an isotropic 0.8 for a mapped lamp), centred a little out over the road, splatted into a map
    // over the model's frame, then stored as square roots in 8 bits with mipmaps
    const fw = fr.x[1] - fr.x[0], fh = fr.y[1] - fr.y[0], side = small ? 1024 : 2048, mpp = Math.max(fw, fh) / side;
    const mw = Math.ceil(fw / mpp), mh = Math.ceil(fh / mpp), acc = new Float32Array(mw * mh * 3);
    const EXP = new Float32Array(257);
    for (let i = 0; i <= 256; i++) EXP[i] = Math.exp(-i / 32);
    for (let i = 0; i < nL; i++) {
      const h = L.h[i], dir = L.ux[i] || L.uy[i], sa = (dir ? 1.1 : 0.8) * h, sc = (dir ? 0.6 : 0.8) * h;
      const ux = dir ? L.ux[i] : 1, uy = dir ? L.uy[i] : 0, arm = dir ? 1.6 * L.pole[i] : 0;
      const cx = L.x[i] + uy * arm, cy = L.y[i] - ux * arm; // the pool sits under the lamp's arm, out over the road
      const R = 2.6 * Math.max(sa, sc), peak = (dir ? 0.95 : 1.3) * L.b[i], c = L.c[i];
      const i0 = Math.max(0, Math.floor((cx - R - fr.x[0]) / mpp)), i1 = Math.min(mw - 1, Math.ceil((cx + R - fr.x[0]) / mpp));
      const j0 = Math.max(0, Math.floor((cy - R - fr.y[0]) / mpp)), j1 = Math.min(mh - 1, Math.ceil((cy + R - fr.y[0]) / mpp));
      for (let j = j0; j <= j1; j++) {
        const dy = fr.y[0] + (j + 0.5) * mpp - cy;
        for (let ii = i0; ii <= i1; ii++) {
          const dx = fr.x[0] + (ii + 0.5) * mpp - cx, a = (dx * ux + dy * uy) / sa, b = (-dx * uy + dy * ux) / sc, e = (a * a + b * b) * 0.5 * 32;
          if (e >= 256) continue;
          const w = EXP[e | 0] * peak, o = (j * mw + ii) * 3;
          acc[o] += c.r * w; acc[o + 1] += c.g * w; acc[o + 2] += c.b * w;
        }
      }
    }
    // where pools overlap (a boulevard's two rows, a bridge, a junction) the light rolls off on a soft
    // knee instead of adding up to a white glare, keeping its colour
    const px = new Uint8Array(mw * mh * 4), KNEE = 1.6;
    for (let i = 0, o = 0; i < acc.length; i += 3, o += 4) {
      const l = 0.2126 * acc[i] + 0.7152 * acc[i + 1] + 0.0722 * acc[i + 2], k = l > 1e-6 ? KNEE * (1 - Math.exp(-l / KNEE)) / l : 1;
      px[o] = Math.min(255, Math.round(255 * Math.sqrt(acc[i] * k / VMAX)));
      px[o + 1] = Math.min(255, Math.round(255 * Math.sqrt(acc[i + 1] * k / VMAX)));
      px[o + 2] = Math.min(255, Math.round(255 * Math.sqrt(acc[i + 2] * k / VMAX)));
      px[o + 3] = 255;
    }
    const map = new THREE.DataTexture(px, mw, mh, THREE.RGBAFormat);
    Object.assign(map, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, needsUpdate: true });
    NU.uNightMap.value = map;
    NU.uNightXf.value.set(fr.x[0], fr.y[0], 1 / (mw * mpp), 1 / (mh * mpp));

    // ------------------------------------------------------------ the lamps as points of light
    const common = { uOn: { value: 0 }, uScale: { value: 600 }, uMinPx: { value: 1.6 }, uTime: { value: 0 } }, lights = [];
    {
      const pos = new Float32Array(nL * 3), col = new Float32Array(nL * 3), inf = new Float32Array(nL * 2);
      for (let i = 0; i < nL; i++) {
        const arm = L.pole[i] * 1.75, p = W(L.x[i] + L.uy[i] * arm, L.y[i] - L.ux[i] * arm, L.z[i] - 0.25), c = L.c[i]; // the head, at the end of its arm
        pos.set([p.x, p.y, p.z], i * 3); col.set([c.r * L.b[i], c.g * L.b[i], c.b * L.b[i]], i * 3); inf.set([L.h[i], rnd()], i * 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('info', new THREE.BufferAttribute(inf, 2));
      const m = lightMaterial(common, `attribute vec3 color; attribute vec2 info;
uniform float uOn, uScale, uMinPx, uTime; varying vec3 vC;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mvPosition.z, 1.0);
  // a lens seen from the side is brighter than its dark housing seen from straight above
  float side = 1.0 - 0.55 * smoothstep(0.75, 0.98, normalize(cameraPosition - position).y);
  // farther is dimmer, more slowly than the inverse square so the far city still sparkles
  float k = pow(clamp(320.0 / d, 0.04, 2.5), 0.85) * side;
  float tw = 1.0 + 0.06 * sin(uTime * (2.0 + 3.0 * info.y) + info.y * 40.0) * smoothstep(600.0, 2000.0, d);
  vC = color * uOn * k * tw * 0.9;
  gl_PointSize = clamp(2.2 * uScale / d, uMinPx, 48.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`, POINT_FRAG);
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 20;
      lights.push(pts);
    }

    // ------------------------------------------------------------ poles under the generated lamps
    // a shaft, an arm out over the road and a head, in instanced batches of 300 m squares shown
    // within 500 m of the camera (from farther they are under a pixel)
    const CELL = 300, chunks = new Map(), poleMat = new THREE.MeshStandardMaterial({ color: OEWorld.lin('#3d444b'), roughness: 0.55, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: OEWorld.lin('#c9ccc9'), roughness: 0.4, emissive: OEWorld.lin('#fff1dc'), emissiveIntensity: 0 });
    const shaft = new THREE.CylinderGeometry(0.06, 0.1, 1, 6, 1, true).translate(0, 0.5, 0);
    const head = THREE.BufferGeometryUtils.mergeGeometries([
      new THREE.BoxGeometry(0.08, 0.08, 1.7).translate(0, -0.1, 0.85),
      new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, -0.18, 1.75)]);
    for (let i = 0; i < (game ? nGen : nL); i++) {
      const key = `${Math.floor(L.x[i] / CELL)},${Math.floor(L.y[i] / CELL)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(i);
    }
    const dummy = new THREE.Object3D(), poles = [];
    for (const [key, list] of chunks) {
      const [cx, cy] = key.split(',').map(Number), s = new THREE.InstancedMesh(shaft, poleMat, list.length), hd = new THREE.InstancedMesh(head, headMat, list.length);
      list.forEach((i, n) => {
        const base = L.z[i] - L.h[i], dir = L.ux[i] || L.uy[i];
        // the pole stands at the kerb and its arm reaches back over the road
        const ax = dir ? L.uy[i] * L.pole[i] : 0, ay = dir ? -L.ux[i] * L.pole[i] : 0, yaw = dir ? Math.atan2(ax, -ay) : n * 1.7;
        dummy.position.copy(W(L.x[i], L.y[i], base)); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, L.h[i], 1); dummy.updateMatrix();
        s.setMatrixAt(n, dummy.matrix);
        dummy.position.copy(W(L.x[i], L.y[i], L.z[i])); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        hd.setMatrixAt(n, dummy.matrix);
      });
      s.computeBoundingSphere(); hd.computeBoundingSphere();
      const c = W((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0);
      poles.push({ c, meshes: [s, hd] });
      group.add(s, hd);
    }

    // ------------------------------------------------------------ traffic
    // each car loops along one straight piece of its road; pieces are short and every one has its
    // own cars, so a road carries a steady stream. position: the start, aB: the end, aInfo: phase,
    // laps per second, the car's place in the hour's traffic (it runs while the hour's share is above it)
    const tA = [], tB = [], tI = [];
    for (const r of roads) {
      const C = ROAD[r.cls] || ROAD.unclassified, perKm = C[5];
      if (!perKm) continue;
      const oneWay = r.cls === 'motorway', lanes = Math.max(1, Math.round(C[1] / 7)), z0 = 0.8;
      for (let j = 1; j < r.pts.length; j++) {
        const [ax, ay, az] = r.pts[j - 1], [bx, by, bz] = r.pts[j], len = Math.hypot(bx - ax, by - ay);
        if (len < 8) continue;
        for (const dir of oneWay ? [1] : [1, -1]) {
          const ux = (bx - ax) / len * dir, uy = (by - ay) / len * dir;
          let n = perKm * len / 1000 * (oneWay ? 2 : 1);
          n = Math.floor(n) + (rnd() < n % 1 ? 1 : 0);
          for (let c = 0; c < n; c++) {
            // its lane: on the keep side of the centre line (a one-way carriageway: any of its lanes)
            const lane = oneWay ? (rnd() - 0.5) * C[1] * 0.6 : (keepLeft ? 1 : -1) * C[1] * (0.12 + 0.3 * (Math.floor(rnd() * lanes) + 0.5) / lanes);
            const ox = -uy * lane, oy = ux * lane, [sx, sy, sz, ex, ey, ez] = dir > 0 ? [ax, ay, az, bx, by, bz] : [bx, by, bz, ax, ay, az];
            const a = W(sx + ox, sy + oy, sz + z0), b = W(ex + ox, ey + oy, ez + z0), v = r.v * (0.75 + 0.35 * rnd());
            tA.push(a.x, a.y, a.z); tB.push(b.x, b.y, b.z); tI.push(rnd(), v / len, rnd(), 0);
          }
        }
      }
    }
    const nT = tA.length / 3, traffic = { uDensity: { value: 1 }, uNear: { value: game ? nearCars : 0 } };
    if (nT) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tA, 3));
      g.setAttribute('aB', new THREE.Float32BufferAttribute(tB, 3));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(tI, 4));
      const m = lightMaterial(Object.assign({}, common, traffic), `attribute vec3 aB; attribute vec4 aInfo;
uniform float uOn, uScale, uMinPx, uTime, uDensity, uNear; varying vec3 vC;
#include <common>
#include <fog_pars_vertex>
void main() {
  float f = fract(aInfo.x + uTime * aInfo.y);
  vec3 P = mix(position, aB, f), dir = normalize(aB - position), toCam = normalize(cameraPosition - P);
  vec4 mvPosition = modelViewMatrix * vec4(P, 1.0);
  float d = max(-mvPosition.z, 1.0);
  // headlights towards the camera, tail lights away from it; from straight above a little of each
  float face = dot(dir, toCam), head = smoothstep(-0.2, 0.5, face), tail = 1.0 - smoothstep(-0.5, 0.15, face);
  float on = uOn * step(aInfo.z, uDensity) * smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.95, 1.0, f))
    * smoothstep(uNear, uNear + 150.0, length(cameraPosition - P));
  float k = pow(clamp(320.0 / d, 0.04, 2.5), 0.85);
  vC = (vec3(1.0, 0.9, 0.76) * head * 3.0 + vec3(1.0, 0.06, 0.02) * tail * 2.4 + vec3(0.45, 0.3, 0.2) * 0.4) * on * k;
  gl_PointSize = clamp(2.2 * uScale / d, uMinPx * 1.1, 26.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`, POINT_FRAG);
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 21;
      lights.push(pts);
    }

    // ------------------------------------------------------------ aircraft warning lights
    const av = Object.assign({ from_m: 100, flash: false }, st.aviation), aPos = [];
    const B = D.B, tops = new Map();
    for (const s of B.s) { // each tall building's highest solid
      const m = B.b[s[0]];
      if (!m || m[2] < av.from_m || m[4] === 'parametric') continue;
      const zt = (s[1] + s[3]) / 10, t = tops.get(s[0]);
      if (!t || zt > t.zt) tops.set(s[0], { zt, ring: s[4] });
    }
    for (const { zt, ring } of tops.values()) {
      // the ring's corners furthest out on the diagonals; one light on a slender top
      const best = [[-Infinity], [-Infinity], [-Infinity], [-Infinity]];
      for (let k = 0; k < ring.length; k += 2) {
        const x = ring[k] / 10, y = ring[k + 1] / 10;
        [x + y, x - y, -x + y, -x - y].forEach((v, q) => { if (v > best[q][0]) best[q] = [v, x, y]; });
      }
      const span = Math.hypot(best[0][1] - best[3][1], best[0][2] - best[3][2]);
      const corners = span < 18 ? [[(best[0][1] + best[3][1]) / 2, (best[0][2] + best[3][2]) / 2]] : best.map(b => [b[1], b[2]]);
      for (const [x, y] of corners) { const p = W(x, y, zt + 0.6); aPos.push(p.x, p.y, p.z); }
    }
    const aviation = { uFlash: { value: av.flash ? 1 : 0 } };
    if (aPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
      const m = lightMaterial(Object.assign({}, common, aviation), `uniform float uOn, uScale, uMinPx, uTime, uFlash; varying vec3 vC;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mvPosition.z, 1.0);
  // flashing ones together, 40 a minute, with a quick rise and a slower fall
  float t = fract(uTime / 1.5), flash = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.18, 0.45, t));
  float k = pow(clamp(500.0 / d, 0.15, 2.5), 0.7);
  vC = vec3(1.0, 0.06, 0.02) * 2.6 * uOn * k * mix(1.0, flash * 1.4, uFlash);
  gl_PointSize = clamp(1.4 * uScale / d, uMinPx * 1.2, 12.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`, POINT_FRAG);
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 22;
      lights.push(pts);
    }

    // ------------------------------------------------------------ the towers' crowns
    // As a lighting designer gives a skyline its hierarchy: the body of a tower is left to its
    // windows, and its crown is lit, a wash rising up the top few storeys from the setback's
    // floodlights and a fine line along the parapet, mostly in white light (night.json "crown").
    // A strip just outside the walls of each lit tower's highest part; additive, so it adds to them.
    const cr = Object.assign({ from_m: 60, share: 0.6, colours: [['#ffe2bf', 0.5], ['#fff1e2', 0.3], ['#ffc890', 0.12], ['#cfe0ff', 0.08]] }, st.crown);
    const crownColour = picker(cr.colours, rnd), crowns = new Map(), cPos = [], cCol = [], cV = [];
    let crownsLit = 0;
    for (const s of B.s) {
      const m = B.b[s[0]];
      if (!m || m[2] < cr.from_m || m[4] === 'parametric') continue;
      const zt = (s[1] + s[3]) / 10, t = crowns.get(s[0]);
      if (!t || zt > t.zt) crowns.set(s[0], { zt, top: m[2], ring: s[4] });
    }
    for (const [bi, { zt, top, ring }] of crowns) {
      if (rng(bi * 7 + 3)() > cr.share) continue; // the same towers lit on every visit
      const H = Math.min(14, Math.max(4, 0.08 * top)), c = crownColour(), n = ring.length / 2;
      crownsLit++;
      let area = 0;
      for (let k = 0; k < n; k++) { const j = (k + 1) % n; area += ring[2 * k] * ring[2 * j + 1] - ring[2 * j] * ring[2 * k + 1]; }
      const out = area > 0 ? 0.3 : -0.3; // outward, whichever way the ring runs
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, ax = ring[2 * k] / 10, ay = ring[2 * k + 1] / 10, bx = ring[2 * j] / 10, by = ring[2 * j + 1] / 10, L = Math.hypot(bx - ax, by - ay);
        if (L < 0.5) continue;
        const ox = (by - ay) / L * out, oy = -(bx - ax) / L * out;
        const q = [W(ax + ox, ay + oy, zt - H), W(bx + ox, by + oy, zt - H), W(bx + ox, by + oy, zt + 0.15), W(ax + ox, ay + oy, zt + 0.15)];
        for (const i of [0, 1, 2, 0, 2, 3]) { cPos.push(q[i].x, q[i].y, q[i].z); cCol.push(c.r, c.g, c.b); cV.push(i < 2 ? 0 : 1); }
      }
    }
    if (cPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
      g.setAttribute('v', new THREE.Float32BufferAttribute(cV, 1));
      const m = lightMaterial(common, `attribute vec3 color; attribute float v; uniform float uOn; varying vec3 vC; varying float vV;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vC = color * uOn; vV = v;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`, `varying vec3 vC; varying float vV;
#include <common>
#include <fog_pars_fragment>
void main() {
  // the wash, and the parapet's line kept to its share of the light when it is under a pixel
  float w = fwidth(vV), lw = 0.06, line = smoothstep(1.0 - lw - w, 1.0 - lw + w, vV) * min(1.0, lw / max(w, lw));
  gl_FragColor = vec4(vC * (0.45 * pow(vV, 1.7) + 1.5 * line), 1.0);
  ${FOG_FRAG}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`);
      m.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 19;
      lights.push(mesh);
    }

    group.add(...lights);
    Wd.world.add(group);
    const sizeV = new THREE.Vector2();
    const api = {
      group, lamps: nL, generated: nGen, cars: nT, towers: tops.size, crowns: crownsLit, map,
      skyglow: st.skyglow ? OEWorld.lin(st.skyglow) : null,
      // how far on the street lights are: they come on as the sun sets
      on: () => common.uOn.value,
      // per frame: the lights' state for the sun and hour (world.js U), the camera and the time
      update(camera, tSec) {
        const on = THREE.MathUtils.smoothstep(Wd.U.uNight.value, 0.06, 0.32);
        common.uOn.value = on;
        NU.uNightOn.value = on;
        for (const o of lights) o.visible = on > 0.001; // (the poles stand by day too)
        common.uTime.value = tSec;
        renderer.getDrawingBufferSize(sizeV);
        common.uScale.value = sizeV.y / (2 * Math.tan(camera.fov * Math.PI / 360));
        common.uMinPx.value = 1.25 * Math.max(1, renderer.getPixelRatio());
        const hr = ((Wd.U.uHour.value % 24) + 24) % 24, h0 = Math.floor(hr), f = hr - h0;
        traffic.uDensity.value = TRAFFIC[h0] * (1 - f) + TRAFFIC[(h0 + 1) % 24] * f;
        headMat.emissiveIntensity = 2.2 * on;
        const cp = camera.position;
        for (const p of poles) { const v = Math.hypot(p.c.x - cp.x, p.c.z - cp.z) < 500 + CELL * 0.71 && cp.y - p.c.y < 900; p.meshes[0].visible = p.meshes[1].visible = v; }
      },
      dispose() { map.dispose(); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
    };
    return api;
  }

  return { create, uniforms, GLSL, ROAD };
})();
