// Neon: the light a city's big LED screens throw on the street, the crowd and the buildings
// across from them, in the colour of what they are playing now.
//
// The screens (pipeline/screens.py, world.js "led_screen") play their programmes on the GPU. Here
// the same programme is followed on the CPU: the mean colour of each keyframe in the sheet is read
// once, and every frame each screen's current keyframe, brightness and hours give its colour. The
// nearest screens (by their size and distance from the camera) each drive one of a fixed set of
// three.js RectAreaLights, the area light three.js evaluates with linearly transformed cosines
// (Heitz, Dupuy, Hill and Neubelt, SIGGRAPH 2016; three.js's LTC tables, MIT): a screen lights
// what is in front of it with the right falloff and spread, never what is behind it, and its
// reflection in a wet street (wet.js) is the screen's own rectangle. A light moving from one screen
// to another fades out and in. The number of lights is the tier's (high 8, medium 4, low none,
// web/quality.js): it is fixed for the session, so no material recompiles as the camera moves.
// The street's static pools of the screens' light (night.js uGlowMap) stay for the far city and
// the low tier.
'use strict';
window.OENeon = (function () {
  const COUNT = { high: 8, medium: 4, low: 0 };
  // The screens are drawn dimmer than they are, so that their pictures read after the tone curve; the
  // light they throw is that of the real panels (some 1,000 nits after dark against a lamp-lit street)
  const SPILL = 13;

  // the n-th clip of a playlist (a bit mask over the clips), counting round: world.js scrClip
  function scrClip(mask, n) {
    let found = 0;
    for (let i = 0; i < 24; i++) if (Math.floor(mask / 2 ** i) % 2 === 1) { if (found === n) return i; found++; }
    return 0;
  }

  // the screens of one programme from their meshes: centre, outward normal, size, programme
  function screensOf(entry) {
    const g = entry.mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal, S = entry.m.screens || [];
    if (!uv || !nor) return [];
    const acc = new Map();
    for (let i = 0; i < pos.count; i++) {
      const id = Math.floor(uv.getX(i));
      if (!S[id]) continue;
      let a = acc.get(id);
      if (!a) acc.set(id, a = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), n: new THREE.Vector3() });
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(entry.mesh.matrixWorld);
      a.min.min(p); a.max.max(p);
      a.n.x += nor.getX(i); a.n.z += nor.getZ(i);
    }
    const out = [];
    for (const [id, a] of acc) {
      const s = S[id], h = s[8] || (a.max.y - a.min.y), w = Math.max(1, (s[0] || 1) * h);
      if (a.n.lengthSq() < 1e-6) continue;
      a.n.y = 0; a.n.normalize();
      out.push({ id, entry, c: a.min.clone().add(a.max).multiplyScalar(0.5), n: a.n.clone(), w: Math.min(w, a.min.distanceTo(a.max) + 0.5), h,
        phase: s[1], mask: s[2], clips: Math.max(1, s[3]), on: s[4], off: s[5], bright: s[6], sync: s[7], col: new THREE.Color(0, 0, 0), area: w * h });
    }
    return out;
  }

  // the mean linear colour of every keyframe in a programme's sheet
  function cellMeans(m, img) {
    const [cols, rows] = m.sheet, ch = m.sheet[3], K = 8, cv = document.createElement('canvas');
    cv.width = cols * K; cv.height = Math.max(K, Math.round(K / ch));
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cv.width, cv.height);
    const px = g.getImageData(0, 0, cv.width, cv.height).data, out = [];
    const L = v => Math.pow(v / 255, 2.2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let R = 0, G = 0, B = 0;
      for (let y = r * K; y < (r + 1) * K && y < cv.height; y++) for (let x = c * K; x < (c + 1) * K; x++) {
        const k = 4 * (y * cv.width + x); R += L(px[k]); G += L(px[k + 1]); B += L(px[k + 2]);
      }
      out.push(new THREE.Color(R / (K * K), G / (K * K), B / (K * K)));
    }
    return out;
  }

  // Wd: the world (world.js); tier: 'high' | 'medium' | 'low'; gain: a city's own scale on the light;
  // fill: light cards over a plaza after dark (game.look.fill: [{at: [x, y], z: height over the
  // ground, w, h metres, colour, k, aim: [x, y, z over the ground] for a card that does not face straight down}]), the light its shopfronts, floodlights and signs put on the
  // middle of a square that no street lamp stands in (Shibuya's scramble); ground(x, y): the ground's height
  async function create(Wd, renderer, { tier = 'low', gain = 1, fill = [], ground = () => 0 } = {}) {
    const n = COUNT[tier] || 0, info = Wd.screens;
    const none = { lights: [], screens: [], cards: [], update() {}, count: 0 };
    if (!n || !info || (!info.meshes.length && !fill.length)) return none;
    try {
      const lib = await import('three/addons/lights/RectAreaLightUniformsLib.js');
      lib.RectAreaLightUniformsLib.init();
    } catch (e) { console.warn('area lights unavailable:', e); return none; }
    const screens = [];
    for (const e of info.meshes) { e.mesh.updateMatrixWorld(true); screens.push(...screensOf(e)); }
    const cards = fill.map(f => {
      const L = new THREE.RectAreaLight(new THREE.Color(f.colour || '#ffd9b0').convertSRGBToLinear(), 0, f.w || 60, f.h || 60);
      const gz = ground(f.at[0], f.at[1]);
      L.position.set(f.at[0], gz + (f.z || 30), -f.at[1]);
      if (f.aim) L.lookAt(f.aim[0], gz + (f.aim[2] || 0), -f.aim[1]); // (a card that lights something from its side: a statue)
      else L.lookAt(f.at[0], gz - 10, -f.at[1]);
      L.userData.k = f.k ?? 1;
      Wd.world.add(L);
      return L;
    });
    // each programme's keyframe colours, once its sheet has loaded
    const means = new Map();
    const lights = [];
    for (let i = 0; i < Math.min(n, screens.length); i++) {
      const L = new THREE.RectAreaLight(0x000000, 0, 1, 1);
      L.userData = { screen: null, w: 0 };
      Wd.world.add(L);
      lights.push(L);
    }
    const look = new THREE.Vector3(), tmp = new THREE.Color();
    let last = -1;
    function colourOf(s, t, hour, night) {
      const m = s.entry.m, mat = s.entry.mat;
      let cm = means.get(m);
      if (!cm) {
        const img = mat.map && mat.map.image;
        if (!img || !(img.width > 0) || img.complete === false) return null;
        means.set(m, cm = cellMeans(m, img));
      }
      const F = m.frames || 1, D = (m.frame_s || 4) * F, tt = t + s.phase, k = Math.floor(tt / D);
      let clip = scrClip(s.mask, ((k % s.clips) + s.clips) % s.clips), ct = tt / D - k;
      const [sc, sp, sl] = m.sync || [-1, 1e9, 0], st = ((t % sp) + sp) % sp;
      if (s.sync > 0.5 && sc >= 0 && st < sl) { clip = sc; ct = st / sl; }
      const c = cm[Math.min(cm.length - 1, clip * F + Math.floor(ct * F))];
      if (!c) return null;
      const on = s.on < s.off ? hour >= s.on && hour <= s.off : hour >= s.on || hour <= s.off;
      return tmp.copy(c).multiplyScalar(on ? s.bright * (2.4 + (1 - 2.4) * night) : 0);
    }
    if (screens.length && Wd.night && Wd.night.setGlowScale) Wd.night.setGlowScale(0.3);
    const api = {
      lights, screens, cards, count: lights.length,
      // per frame: each screen's colour now, and the lights on the nearest
      update(camera, dt) {
        const t = info.clock.t.value, hour = info.clock.hour.value, night = info.night.value;
        for (const L of cards) L.intensity = L.userData.k * night;
        if (last < 0) last = t;
        const cp = camera.position;
        for (const s of screens) s.score = cp.distanceTo(s.c) / Math.sqrt(s.area);
        const want = screens.filter(s => s.n.dot(look.copy(cp).sub(s.c)) > -0.3 * cp.distanceTo(s.c) || cp.distanceTo(s.c) < 30)
          .sort((a, b) => a.score - b.score).slice(0, lights.length);
        const k = 1 - Math.exp(-dt / 0.35);
        for (const L of lights) if (L.userData.screen && !want.includes(L.userData.screen)) L.userData.want = 0; else L.userData.want = 1;
        for (const s of want) {
          if (lights.some(L => L.userData.screen === s)) continue;
          const free = lights.find(L => !L.userData.screen) || lights.find(L => L.userData.want === 0 && L.userData.w < 0.02);
          if (!free) continue;
          Object.assign(free.userData, { screen: s, w: 0, want: 1 });
          free.position.copy(s.c).addScaledVector(s.n, 0.25);
          free.width = s.w; free.height = s.h;
          free.lookAt(look.copy(s.c).addScaledVector(s.n, 10));
          free.color.setRGB(0, 0, 0);
        }
        for (const L of lights) {
          const u = L.userData, s = u.screen;
          if (!s) { L.intensity = 0; continue; }
          u.w += ((u.want ? 1 : 0) - u.w) * k * 2;
          if (!u.want && u.w < 0.01) { u.screen = null; L.intensity = 0; continue; }
          const c = colourOf(s, t, hour, night);
          if (c) s.col.lerp(c, k); // the light eases between keyframes, as a wall's glow does
          L.color.copy(s.col);
          L.intensity = u.w * gain * SPILL * (0.06 + 0.94 * night); // (in the sun a screen lights little round it)
        }
      },
    };
    return api;
  }
  return { create, COUNT };
})();
