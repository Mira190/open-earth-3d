// Open Earth 3D world: the city scene that the model viewer (city.js) and the game
// (game/*.js) share: terrain under aerial imagery, water, extruded buildings with a
// facade shader (windows, lights at night, height-source colours), piers, trees,
// parametric landmarks, sky and sun. Local frame: x east, y north, z up; three.js is
// y-up, so a local point (x, y, z) is drawn at (x, z, -y).
'use strict';
window.OEWorld = (function () {
  const S = window.Sun, RAD = Math.PI / 180;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const idle = () => new Promise(r => setTimeout(r, 0));

  // the city's data files; game.json too when asked for
  async function load(cityId, { game = false, onMsg = () => {} } = {}) {
    const DATA = `data/${cityId}/`;
    const getJSON = u => fetch(DATA + u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    onMsg('Loading footprints, terrain and landmarks', 0.05);
    const [scene, B, P, LM, terrBuf, UNC, G] = await Promise.all([getJSON('scene.json'), getJSON('buildings.json'), getJSON('places.json'),
      getJSON('landmarks.json'), getJSON('terrain.json').then(t => Uint8Array.from(atob(t.data), c => c.charCodeAt(0)).buffer),
      getJSON('uncertainty.json').catch(() => null), game ? getJSON('game.json') : Promise.resolve(null)]);
    const CITY = scene.city;
    S.site({ lat: CITY.lat, lon: CITY.lon, tz: CITY.timezone, locale: CITY.locale });
    const ti = new Int16Array(terrBuf);
    const T = { data: Float32Array.from(ti, v => v * scene.terrain.scale), nx: scene.terrain.nx, ny: scene.terrain.ny,
      cell: scene.terrain.cell, x0: scene.frame.x[0], y1: scene.frame.y[1] };
    return { id: cityId, DATA, scene, B, P, LM, UNC, G, CITY, T, ground: (x, y) => Math.max(0, S.terrainAt(T, x, y)) };
  }

  // build the scene into a new THREE.Scene; the caller owns the renderer and camera
  async function create(D, renderer, { onMsg = () => {}, small = Math.min(innerWidth, innerHeight) < 700 } = {}) {
    const { B, P, LM, T } = D, scene = D.scene, loadMsg = onMsg;
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const SHADOW = renderer.capabilities.maxTextureSize >= 8192 && !small ? 4096 : 2048;

    const world = new THREE.Scene();
    const sky = new THREE.Sky();
    sky.scale.setScalar(50000);
    world.add(sky);
    const su = sky.material.uniforms;
    su.turbidity.value = 3.5; su.rayleigh.value = 1.1; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    if (su.cloudCoverage) su.cloudCoverage.value = 0; // r183+ Sky draws clouds by default; the analysis assumes a clear sky
    // r183 also made the sky's output linear and its sun disc ~60,000 times the sky, which the
    // environment map turns into a second sun. Keep r128's tone curve and disc, the light this
    // app's exposure and materials were tuned under.
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace('varying float vSunE;', 'varying float vSunE;\n varying float vSunfade;')
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisc;\n vec3 texColor = ( Lin + L0 ) * 0.04')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ), 1.0 );');
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(50); // inside the PMREM cube camera's far plane
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT = null, envKey = '';

    const sunLight = new THREE.DirectionalLight(0xffffff, 2 * Math.PI); // intensities are physical since r155: π × the old values
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(SHADOW, SHADOW);
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 1.0;
    const shCam = sunLight.shadow.camera;
    shCam.near = 10; shCam.far = 9000;
    world.add(sunLight, sunLight.target);
    const hemi = new THREE.HemisphereLight(0xc3d6e6, 0x4d463a, 0.25 * Math.PI);
    world.add(hemi);
    world.fog = new THREE.Fog(0xc6d3dc, 6000, 26000);

    // ------------------------------------------------------------ terrain and imagery
    loadMsg('Draping aerial imagery on the terrain', 0.35);
    await idle();
    const texLoader = new THREE.TextureLoader();
    const groundMeshes = [];
    for (const t of scene.ground) {
      const w = t.x1 - t.x0, h = t.y1 - t.y0;
      const g = new THREE.PlaneGeometry(w, h, Math.round(w / T.cell), Math.round(h / T.cell));
      g.rotateX(-Math.PI / 2);
      g.translate((t.x0 + t.x1) / 2, 0, -(t.y0 + t.y1) / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, S.terrainAt(T, p.getX(i), -p.getZ(i)));
      g.computeVertexNormals();
      const tex = texLoader.load(D.DATA + t.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
      m.receiveShadow = true;
      world.add(m);
      groundMeshes.push(m);
    }

    // water: a slightly see-through sheet at sea level with procedural ripples; on land the terrain covers it
    function rippleTexture() {
      const n = 128, c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
      const hgt = new Float32Array(n * n);
      for (let k = 0; k < 24; k++) {
        const fx = (1 + (k * 7) % 5) * (k % 2 ? 1 : -1), fy = 1 + (k * 3) % 4, ph = k * 1.7, amp = 1 / (1 + k * 0.25);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
          hgt[y * n + x] += amp * Math.sin(2 * Math.PI * (fx * x + fy * y) / n + ph);
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = hgt[y * n + (x + 1) % n] - hgt[y * n + (x + n - 1) % n];
        const dy = hgt[((y + 1) % n) * n + x] - hgt[((y + n - 1) % n) * n + x];
        const i = 4 * (y * n + x);
        img.data[i] = 128 + dx * 22; img.data[i + 1] = 128 + dy * 22; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1600, 1600);
      return t;
    }
    const waterMat = new THREE.MeshStandardMaterial({ color: lin('#1d3a4b'), roughness: 0.08, metalness: 0.0, transparent: true,
      opacity: 0.84, normalMap: rippleTexture(), normalScale: new THREE.Vector2(0.25, 0.25) });
    const waterGeo = new THREE.PlaneGeometry(80000, 80000);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.receiveShadow = true;
    world.add(water);

    // ------------------------------------------------------------ buildings
    loadMsg(`Extruding ${B.b.length.toLocaleString()} buildings`, 0.5);
    await idle();
    const SRC = { mapped: 0, reference: 0, verified: 0, floors: 1, ml: 2, estimate: 2, parametric: 3 };
    function extrude(solids, colourOf) {
      const pos = [], nrm = [], col = [], fac = [], bid = [], src = [], idx = [];
      let v = 0;
      const push = (x, y, z, n, c, u, h, b, s) => {
        pos.push(x, z, -y); nrm.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); fac.push(u, h); bid.push(b); src.push(s);
      };
      for (const s of solids) {
        const bi = s[0], g0 = s[1] / 10, zb = g0 + s[2] / 10, zt = g0 + s[3] / 10;
        const { wall, roof, code, windows } = colourOf(bi);
        const rings = s.slice(4).map(r => r.map(q => q / 10));
        for (const r of rings) {
          const n = r.length / 2;
          let u = 0;
          for (let k = 0; k < n; k++) {
            const ax = r[2 * k], ay = r[2 * k + 1], j = (k + 1) % n, bx = r[2 * j], by = r[2 * j + 1];
            const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
            if (L < 0.05) continue;
            const nn = [dy / L, 0, dx / L]; // local outward (dy, -dx) -> three (x, 0, -y)
            const hb = windows ? zb - g0 : -1, ht = windows ? zt - g0 : -1; // facade coordinates; -1 = no windows
            push(ax, ay, zb, nn, wall, u, hb, bi, code);
            push(bx, by, zb, nn, wall, u + L, hb, bi, code);
            push(bx, by, zt, nn, wall, u + L, ht, bi, code);
            push(ax, ay, zt, nn, wall, u, ht, bi, code);
            idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
            v += 4;
            u += L;
          }
        }
        const contour = [], holes = [];
        rings.forEach((r, i) => {
          const pts = [];
          for (let k = 0; k < r.length; k += 2) pts.push(new THREE.Vector2(r[k], r[k + 1]));
          if (i === 0) contour.push(...pts); else holes.push(pts);
        });
        let faces;
        try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
        const all = contour.concat(...holes), base = v;
        for (const p of all) { push(p.x, p.y, zt, [0, 1, 0], roof, -1, -1, bi, code); v++; }
        for (const f of faces) {
          const a = all[f[0]], b = all[f[1]], c = all[f[2]];
          const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
          if (ccw) idx.push(base + f[0], base + f[1], base + f[2]); else idx.push(base + f[0], base + f[2], base + f[1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('fac', new THREE.Float32BufferAttribute(fac, 2));
      g.setAttribute('bid', new THREE.Float32BufferAttribute(bid, 1));
      g.setAttribute('srcCode', new THREE.Float32BufferAttribute(src, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    }
    const colourCache = new Map();
    const bColour = bi => {
      let c = colourCache.get(bi);
      if (!c) {
        const m = B.b[bi];
        c = { wall: lin(m[7]), roof: lin(m[8]), code: SRC[m[4]] ?? 2, windows: m[2] >= 9 && m[1] !== 'roof' && m[4] !== 'parametric' };
        colourCache.set(bi, c);
      }
      return c;
    };
    const U = { uNight: { value: 0 }, uSel: { value: -1 }, uMode: { value: 0 },
      uC0: { value: lin(css('--s1') || '#2a78d6') }, uC1: { value: lin(css('--s2') || '#eb6834') }, uC2: { value: lin(css('--s3') || '#1baf7a') } };
    function facadeMaterial() {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
  attribute vec2 fac; attribute float bid; attribute float srcCode;
  varying vec2 vFac; varying float vBid; varying float vSrc;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFac = fac; vBid = bid; vSrc = srcCode;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
  uniform float uNight; uniform float uSel; uniform float uMode; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
  varying vec2 vFac; varying float vBid; varying float vSrc;
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  float win = 0.0; vec2 cell = vec2(0.0);
  if (vFac.y >= 0.0) {
    vec2 q = vec2(vFac.x / 3.4, vFac.y / 3.6);
    cell = floor(q); vec2 f = fract(q);
    win = step(0.14, f.x) * step(f.x, 0.86) * step(0.3, f.y) * step(f.y, 0.86) * step(3.0, vFac.y);
  }
  if (uMode > 0.5) {
    diffuseColor.rgb = vSrc < 0.5 ? uC0 : (vSrc < 1.5 ? uC1 : (vSrc < 2.5 ? uC2 : vec3(0.8)));
    win = 0.0;
  } else {
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4 + vec3(0.012, 0.018, 0.026), win * 0.72);
  }
  if (abs(vBid - uSel) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.42, 0.12), 0.6);`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float lit = step(0.6, hash21(cell + vec2(vBid * 0.173, vBid * 0.311)));
  totalEmissiveRadiance += win * lit * uNight * vec3(1.0, 0.72, 0.4) * 1.5;`);
      };
      return mat;
    }
    const bGeo = extrude(B.s, bColour);
    const buildings = new THREE.Mesh(bGeo, facadeMaterial());
    if (THREE.MeshBVH) { // a bounding-volume hierarchy makes picking a building ~300x faster
      bGeo.boundsTree = new THREE.MeshBVH(bGeo);
      buildings.raycast = THREE.acceleratedRaycast;
    }
    buildings.castShadow = buildings.receiveShadow = true;
    world.add(buildings);

    // piers and wharves: 2.2 m concrete decks
    const pierColour = { wall: lin('#9c9a92'), roof: lin('#a7a59d'), code: 3, windows: false };
    const pierGeo = extrude((P.piers || []).map(r => [-1, 0, 0, 22, r]), () => pierColour);
    const piers = new THREE.Mesh(pierGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    piers.castShadow = piers.receiveShadow = true;
    world.add(piers);

    // trees mapped in OSM: low-poly crowns on short trunks; heights are not mapped (7-14 m spread)
    const TR = P.trees || [], nT = TR.length / 4;
    if (nT) {
      const crownGeo = new THREE.IcosahedronGeometry(1, 1);
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1, 5);
      trunkGeo.translate(0, 0.5, 0);
      const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), nT);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: lin('#5b4a3a'), roughness: 0.9 }), nT);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
      const greens = ['#3f5f2e', '#4d6b34', '#56743a', '#38552b', '#5f7a3f'].map(lin);
      for (let i = 0; i < nT; i++) {
        const x = TR[4 * i] / 10, y = TR[4 * i + 1] / 10, z = TR[4 * i + 2] / 10, h = TR[4 * i + 3] / 10, r = h * 0.32;
        m4.compose(at.set(x, z + h - r, -y), q, sc.set(r, r * 1.1, r));
        crowns.setMatrixAt(i, m4);
        crowns.setColorAt(i, greens[(TR[4 * i + 3] * 7) % greens.length]);
        m4.compose(at.set(x, z, -y), q, sc.set(1, h - r * 1.4, 1));
        trunks.setMatrixAt(i, m4);
      }
      crowns.castShadow = crowns.receiveShadow = trunks.castShadow = true;
      world.add(crowns, trunks);
    }

    // ------------------------------------------------------------ landmarks
    loadMsg('Building the landmarks', 0.65);
    await idle();
    const lmMats = {}, floodMats = {};
    for (const [k, m] of Object.entries(LM.materials || {}))
      lmMats[k] = new THREE.MeshStandardMaterial({ color: lin(m.color), roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide });
    // meshes marked floodlit glow after dark
    const floodlit = k => floodMats[k] || (floodMats[k] = Object.assign(lmMats[k].clone(), { emissive: lin('#ffe2b8'), emissiveIntensity: 0 }));
    for (const m of LM.meshes || []) {
      const p = m.position, arr = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { arr[i] = p[i]; arr[i + 1] = p[i + 2]; arr[i + 2] = -p[i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setIndex(m.index);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m.floodlit ? floodlit(m.material) : lmMats[m.material]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = m.name;
      world.add(mesh);
    }

    // ------------------------------------------------------------ sun
    const warm = new THREE.Color('#ffb070'), noonC = new THREE.Color('#fff3e0');
    const api = {
      world, sky, su, sunLight, shCam, hemi, pmrem, groundMeshes, water, waterMat, buildings, bGeo, U, SRC, extrude, bColour, floodMats, lmMats,
      sunDir: new THREE.Vector3(0, 1, 0), day: 1,
      // light the scene for a sun position {altitude, azimuth}; returns the daylight factor 0..1
      setSun(sp) {
        const alt = sp.altitude * RAD, az = sp.azimuth * RAD;
        api.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
        su.sunPosition.value.copy(api.sunDir);
        const day = smooth(-5, 8, sp.altitude);
        api.day = day;
        sunLight.visible = sp.altitude > -0.5;
        sunLight.intensity = Math.PI * 2.4 * smooth(-0.5, 10, sp.altitude);
        sunLight.color.copy(warm).lerp(noonC, smooth(2, 30, sp.altitude));
        hemi.intensity = Math.PI * (0.07 + 0.25 * day);
        hemi.color.set(day > 0.3 ? 0xc3d6e6 : 0x5d6f92);
        U.uNight.value = 1 - smooth(-7, 2, sp.altitude);
        for (const m of Object.values(floodMats)) m.emissiveIntensity = 0.32 * U.uNight.value;
        renderer.toneMappingExposure = 0.55 + 0.35 * (1 - day);
        world.fog.color.set(day > 0.5 ? 0xc6d3dc : new THREE.Color(0x0c1420).lerp(new THREE.Color(0xd2b49c), day * 2).getHex());
        const key = `${Math.round(sp.altitude / 2)}|${Math.round(sp.azimuth / 6)}`;
        if (key !== envKey) {
          envKey = key;
          if (envRT) envRT.dispose();
          envRT = pmrem.fromScene(envScene);
          world.environment = envRT.texture;
        }
        return day;
      },
      // keep the shadow map centred on what the camera looks at, half metres on each side
      fitShadow(target, half) {
        if (shCam.right !== half) { shCam.left = -half; shCam.right = half; shCam.top = half; shCam.bottom = -half; shCam.updateProjectionMatrix(); }
        sunLight.target.position.copy(target);
        sunLight.position.copy(target).addScaledVector(api.sunDir, 4500);
      },
      tick(t) { waterMat.normalMap.offset.set(t * 0.000004, t * 0.0000025); },
      dispose() { if (envRT) envRT.dispose(); pmrem.dispose(); },
    };
    return api;
  }

  return { load, create, lin, smooth };
})();
