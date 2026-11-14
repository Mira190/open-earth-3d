// People: realistic rigged characters (Quaternius's Ultimate Modular Men and Women, CC0)
// for the crowd near the player, plus an instanced low-detail copy of the same characters
// for the crowd further away. Each character is one skinned mesh whose vertices index a
// small palette, so skin, hair and clothes are recoloured per person: thirteen files make
// a varied crowd. pipeline/fetch_people.py builds the files in web/assets/people. The
// surveyors you play (H_) and the NPCs (R_) are textured Microsoft Rocketbox avatars
// (MIT, blender/build_people.py); the NPCs share one file of clips per sex.
'use strict';
window.OEPeople = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const N = 24; // palette size in the shaders
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = a => a[Math.floor(rnd() * a.length)];
  // sRGB swatches for recolouring
  const SKIN = ['#f6d8c6', '#f0c7aa', '#e3b08d', '#d49c76', '#c18661', '#a8714f', '#8f5b3d', '#73482e', '#5a3622'];
  const HAIR = ['#141010', '#231915', '#33241b', '#4a3222', '#6a4529', '#8d6339', '#b48a52', '#cfae73', '#8c8580', '#cfcac4', '#6e2f1c'];
  const TOPS = ['#e9e6df', '#1f2328', '#2f5d8c', '#c94f3d', '#3d6b4a', '#d9a441', '#7a4e8f', '#5b7f99', '#b5654b', '#f2f0ea', '#355c7d', '#8c2f39', '#9aa3a8', '#d7c6a5', '#3c4a3e', '#e4b7b2'];
  const LEGS = ['#2b3440', '#1d1f24', '#4b5563', '#3a3026', '#6b7280', '#24384f', '#c7b89a', '#33415c', '#5c4b3b'];
  // how common each character is in a city crowd
  const WEIGHT = { M_Casual2: 3, M_Hoodie: 2, M_Suit: 2, M_Worker: 0.8, M_Beach: 1, M_Adventurer: 1, M_Punk: 0.4,
    W_Casual: 3, W_Formal: 1.5, W_Suit: 2, W_Worker: 0.8, W_Adventurer: 1, W_Punk: 0.4 };
  // named crowd styles (city.json game.crowd.style: "tokyo"): skin, hair and clothes palettes and
  // how common each character is. HAIR holds nine natural colours, then the greys and dyes that
  // 15% of people wear; a style's own hair list is drawn from as it is.
  const STYLES = {
    tokyo: {
      skin: ['#f6d8c6', '#f3cfb5', '#f0c7aa', '#efc6a8', '#e9bf9d', '#e9bf9d', '#e3b08d', '#d49c76', '#c18661', '#8f5b3d'],
      hair: ['#141010', '#141010', '#17120f', '#1b1512', '#1b1512', '#231915', '#231915', '#33241b', '#4a3222', '#8c8580', '#cfcac4', '#8d6339', '#b48a52'],
      // dark suits, navy school blazers, white shirts, beige trench coats: Tokyo dresses quietly
      tops: ['#1f2328', '#1f2328', '#1f2328', '#1d2b4a', '#1d2b4a', '#e9e6df', '#f2f0ea', '#2b2f3a', '#9aa3a8', '#d7c6a5', '#c9c6bd', '#355c7d', '#4a4f57', '#7a4e8f', '#c94f3d', '#e4b7b2'],
      legs: ['#1b1d22', '#1b1d22', '#1d1f24', '#2b3440', '#24384f', '#33415c', '#4b5563', '#c7b89a', '#3a3026'],
      weights: { M_Casual2: 2, M_Hoodie: 1.5, M_Suit: 4.5, M_Worker: 0.7, M_Beach: 0.2, M_Adventurer: 0.8, M_Punk: 0.15,
        W_Casual: 3, W_Formal: 2.5, W_Suit: 3.5, W_Worker: 0.6, W_Adventurer: 0.8, W_Punk: 0.15 },
    },
  };
  // Paris: navy, black, grey and camel, white shirts, trench coats and the odd marinière; a city of
  // many origins, so the widest range of skin
  STYLES.paris = {
    skin: ['#f6dccb', '#f1d1bb', '#ecc6aa', '#e3b592', '#d9a583', '#c68f6a', '#b07a55', '#8f5b3d', '#6e4430', '#4f3022'],
    hair: ['#141010', '#1b1512', '#2a1e17', '#3b2a20', '#4a3222', '#6a4529', '#8c6339', '#b48a52', '#c9b48a', '#8c8580', '#cfcac4'],
    tops: ['#1d2b4a', '#1d2b4a', '#141414', '#141414', '#3a3d42', '#6b6f75', '#c2a378', '#b8925e', '#f2efe8', '#e9e6df', '#7a2e33',
      '#2f4a3c', '#9aa3a8', '#d7c6a5', '#4a3a2c', '#5b6b7a'],
    legs: ['#1b1d22', '#1b1d22', '#23314a', '#2b3440', '#3a3d42', '#4b5563', '#c7b89a', '#5a4632', '#141414'],
    weights: { M_Casual2: 3, M_Hoodie: 1.2, M_Suit: 2.5, M_Worker: 0.6, M_Beach: 0.3, M_Adventurer: 1, M_Punk: 0.3,
      W_Casual: 3, W_Formal: 2.5, W_Suit: 2.2, W_Worker: 0.5, W_Adventurer: 1, W_Punk: 0.3 },
  };
  // Amsterdam: the tallest people in the world (a Dutch man averages 1.83 m), dressed for rain and a
  // bicycle: navy, black, grey and olive parkas, jeans, white trainers; the odd bunch of tulips
  STYLES.amsterdam = {
    skin: ['#f7dfcf', '#f3d6c2', '#efcbb1', '#e8bd9e', '#ddab88', '#c99470', '#b07a55', '#8f5b3d', '#6e4430', '#4f3022'],
    hair: ['#e3c58e', '#d4b27a', '#c9a46c', '#b48a52', '#8c6339', '#6a4529', '#4a3222', '#2a1e17', '#141010', '#cfcac4', '#8c8580'],
    tops: ['#1d2b4a', '#1d2b4a', '#141414', '#141414', '#3a3d42', '#56604a', '#6b6f75', '#2f4a3c', '#7a2e33', '#e9e6df', '#c2a378',
      '#f08a24', '#9aa3a8', '#4a5a6e', '#d7c6a5'],
    legs: ['#24384f', '#24384f', '#2b3440', '#1b1d22', '#33415c', '#141414', '#4b5563', '#3a3026'],
    scale: [0.97, 1.04],
    acc: { backpack: 0.18, tulips: 0.025 },
    weights: { M_Casual2: 3, M_Hoodie: 1.6, M_Suit: 1.6, M_Worker: 0.6, M_Beach: 0.2, M_Adventurer: 1.2, M_Punk: 0.2,
      W_Casual: 3, W_Formal: 1.6, W_Suit: 1.4, W_Worker: 0.5, W_Adventurer: 1.2, W_Punk: 0.2 },
  };
  // Japan carries the clear vinyl umbrellas sold at every konbini, and black and navy ones
  STYLES.tokyo.umbrellas = ['clear', 'clear', 'clear', 'clear', 'clear', '#1d1f26', '#22304a', '#1d1f26', '#f2f2f2', '#6b2a35'];
  STYLES.kyoto = Object.assign({}, STYLES.tokyo, {
    tops: ['#1f2328', '#1f2328', '#1d2b4a', '#1d2b4a', '#e9e6df', '#f2f0ea', '#2b2f3a', '#9aa3a8', '#d7c6a5', '#46604f', '#8a2f39', '#5b6b7a', '#c9c2b5', '#7a4e8f'],
  });
  let STYLE = null;
  const styleOf = s => (typeof s === 'string' ? STYLES[s] || null : s || null);
  // the city's crowd style (a preset's name or a style object), for every look drawn without its own
  function setStyle(s) { STYLE = styleOf(s); }
  const CLS = { keep: 0, skin: 1, hair: 2, brows: 3, top: 4, legs: 5 };

  // ------------------------------------------------------------ local flavour: patterns and accessories
  // look.pattern paints the 'top' class with a procedural print, in the character's bind-pose space so it
  // stays on the body while it animates: leopard (tan with rosettes), tiger (yellow and black bands, a
  // Hanshin Tigers jersey), kuidaore (red and white bands), pinstripe, plaid. look.pattern2 overrides the
  // second colour. look.acc lists accessory ids, built from primitives and attached to bones.
  const PAT = { leopard: 1, tiger: 2, kuidaore: 3, pinstripe: 4, plaid: 5, mariniere: 6 };
  const PAT_GLSL = `
vec3 oePattern(vec3 base, vec3 p, float id, vec3 c2) {
  if (id < 0.5) return base;
  if (id < 1.5) {
    vec3 brown = c2.r < 0.0 ? vec3(0.13, 0.05, 0.012) : c2;
    float s = sin(p.x * 30.0 + p.y * 3.0) * sin(p.y * 30.0 + 1.7) * sin(p.z * 30.0 - 0.6);
    vec3 col = mix(base, vec3(0.012), smoothstep(0.07, 0.13, s));
    return mix(col, brown, smoothstep(0.26, 0.34, s));
  }
  if (id < 2.5) return mix(base, c2.r < 0.0 ? vec3(0.012) : c2, step(0.55, fract(p.y * 8.0)));
  if (id < 3.5) return mix(base, c2.r < 0.0 ? vec3(0.75) : c2, step(0.5, fract(p.y * 7.0)));
  if (id < 4.5) return mix(base, c2.r < 0.0 ? vec3(0.45) : c2, 0.8 * step(0.86, fract(p.x * 55.0)));
  if (id > 5.5) return mix(base, c2.r < 0.0 ? vec3(0.015, 0.024, 0.07) : c2, step(0.58, fract(p.y * 26.0))); // marinière: Breton stripes
  float a = step(0.78, fract(p.x * 28.0)), b = step(0.78, fract(p.y * 18.0));
  return base * (1.0 - 0.5 * a) * (1.0 - 0.5 * b) + (c2.r < 0.0 ? vec3(0.12, 0.02, 0.02) : c2) * a * b;
}`;
  const GEO = {}, MAT = {};
  const geo = (k, f) => GEO[k] || (GEO[k] = f());
  // 'clear': the frosted vinyl of a convenience-store umbrella (mostly opaque: the head under it is hidden)
  const stdMat = hex => MAT[hex] || (MAT[hex] = hex === 'clear'
    ? new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.32, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.75, metalness: 0, side: THREE.DoubleSide }));
  // an open umbrella's canopy: eight panels over a cone, open underneath (the apex up)
  const canopyGeo = () => new THREE.ConeGeometry(0.56, 0.24, 8, 1, true);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // how an open umbrella is held, in a body's own space (y up, +z forward), as games' umbrella walks
  // hold it: the elbow by the side, the fist up under the chin a little to the right, the shaft upright
  // and the canopy low over the head, so it hides the hand and the head under it. From
  // the head's joint (hd); the near people (umbrella_open) and the crowd's far copies share it
  const UMB_LEN = 0.66, UMB_D = [0.05, 1, -0.06];
  // umbrellas are off for now: the hand on the handle doesn't read right yet, so nobody carries one,
  // closed or open, and the rain falls on bare heads. Set true to bring them back.
  const UMBRELLAS = true;
  const noUmb = ids => (UMBRELLAS || !ids ? ids : ids.filter(id => id !== 'umbrella' && id !== 'umbrella_open'));
  const umbrellaHold = hd => {
    const dir = V3(...UMB_D).normalize(), grip = hd.clone().add(V3(-0.1, -0.32, 0.17));
    return { grip, dir, top: grip.clone().addScaledVector(dir, UMB_LEN), q: new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir) };
  };
  // Everything is built in the model's own space (y up, +z forward, metres) around anchors read from the
  // reference pose, so one set of numbers fits every character; attach() then hangs it on a bone. A
  // Rocketbox body (real: the main characters and the NPCs) is slimmer and its spine sits further back,
  // so what hangs on the body or rests on the hair has numbers of its own for it.
  const ACC = {
    tigers_cap: { bone: 'Head', build: (M, h) => [
      M(geo('hs', () => new THREE.SphereGeometry(0.125, 18, 10, 0, 6.2832, 0, 1.5708)), '#f6c500', h.clone().add(V3(0, 0.07, -0.005)), V3(1, 1.05, 1.2)),
      M(geo('brim', () => new THREE.CylinderGeometry(0.15, 0.15, 0.01, 18, 1, false, -1.35, 2.7)), '#141414', h.clone().add(V3(0, 0.055, 0.085))),
      M(geo('hbadge', () => new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10).rotateX(1.5708)), '#141414', h.clone().add(V3(0, 0.125, 0.14)))] },
    visor: { bone: 'Head', build: (M, h) => [
      M(geo('vband', () => new THREE.CylinderGeometry(0.119, 0.119, 0.035, 18, 1, true)), '#151515', h.clone().add(V3(0, 0.085, -0.005))),
      M(geo('vbrim', () => new THREE.CylinderGeometry(0.22, 0.22, 0.006, 22, 1, false, -1.45, 2.9)), '#151515', h.clone().add(V3(0, 0.085, 0.09)))] },
    hachimaki: { bone: 'Head', build: (M, h) => [
      M(geo('hband', () => new THREE.CylinderGeometry(0.14, 0.14, 0.055, 18, 1, true)), '#f4f1ea', h.clone().add(V3(0, 0.1, 0.008))),
      M(geo('hknot', () => new THREE.BoxGeometry(0.055, 0.03, 0.05)), '#f4f1ea', h.clone().add(V3(0, 0.08, -0.15)))] },
    jingasa: { bone: 'Head', build: (M, h, c, look, real) => [
      M(geo('jcone', () => new THREE.ConeGeometry(0.22, 0.11, 26)), '#1b1816', h.clone().add(V3(0, real ? 0.18 : 0.2, 0.0))),
      M(geo('jcrest', () => new THREE.SphereGeometry(0.022, 8, 6)), '#d6a931', h.clone().add(V3(0, real ? 0.24 : 0.26, 0)))] },
    mask: { bone: 'Head', build: (M, h) => [
      M(geo('mask', () => new THREE.BoxGeometry(0.13, 0.07, 0.03)), '#f2f2f0', h.clone().add(V3(0, -0.05, 0.172)))] },
    police_cap: { bone: 'Head', build: (M, h) => [
      M(geo('pcap', () => new THREE.CylinderGeometry(0.12, 0.123, 0.09, 18)), '#16213f', h.clone().add(V3(0, 0.11, -0.004))),
      M(geo('ptop', () => new THREE.CylinderGeometry(0.145, 0.126, 0.03, 18)), '#16213f', h.clone().add(V3(0, 0.17, 0.012))),
      M(geo('pbrim', () => new THREE.CylinderGeometry(0.135, 0.135, 0.008, 18, 1, false, -1.3, 2.6)), '#0b0b0b', h.clone().add(V3(0, 0.065, 0.08))),
      M(geo('pbadge', () => new THREE.CylinderGeometry(0.016, 0.016, 0.006, 8).rotateX(1.5708)), '#d6a931', h.clone().add(V3(0, 0.12, 0.126)))] },
    clown_hat: { bone: 'Head', build: (M, h) => [
      M(geo('chat1', () => new THREE.ConeGeometry(0.115, 0.2, 18)), '#d9262c', h.clone().add(V3(0, 0.27, 0))),
      M(geo('chat2', () => new THREE.CylinderGeometry(0.1, 0.122, 0.05, 18)), '#f4f1ea', h.clone().add(V3(0, 0.12, 0))),
      M(geo('chat3', () => new THREE.CylinderGeometry(0.078, 0.1, 0.05, 18)), '#d9262c', h.clone().add(V3(0, 0.17, 0))),
      M(geo('chat4', () => new THREE.SphereGeometry(0.03, 8, 6)), '#f4f1ea', h.clone().add(V3(0, 0.38, 0)))] },
    glasses: { bone: 'Head', build: (M, h) => {
      const r = geo('gl', () => new THREE.TorusGeometry(0.032, 0.004, 6, 14));
      return [M(r, '#161616', h.clone().add(V3(-0.045, 0.035, 0.172))), M(r, '#161616', h.clone().add(V3(0.045, 0.035, 0.172))),
        M(geo('glb', () => new THREE.BoxGeometry(0.03, 0.005, 0.005)), '#161616', h.clone().add(V3(0, 0.045, 0.172)))]; } },
    sunglasses: { bone: 'Head', build: (M, h) => {
      const r = geo('sgl', () => new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16).rotateX(1.5708).scale(1.15, 0.85, 1));
      return [M(r, '#0d0f12', h.clone().add(V3(-0.045, 0.035, 0.174))), M(r, '#0d0f12', h.clone().add(V3(0.045, 0.035, 0.174))),
        M(geo('glb', () => new THREE.BoxGeometry(0.03, 0.005, 0.005)), '#3a3d42', h.clone().add(V3(0, 0.045, 0.172)))]; } },
    apron: { bone: 'Abdomen', realBone: 'Hips', build: (M, h, c, look, real) => (real ? [   // from the waist to the knee, on the hips
      M(geo('apronR', () => new THREE.BoxGeometry(0.34, 0.5, 0.012)), look.apron || '#f4f1ea', h.clone().add(V3(0, -0.17, 0.145)))] : [
      M(geo('apron', () => new THREE.BoxGeometry(0.27, 0.52, 0.03)), look.apron || '#f4f1ea', h.clone().add(V3(0, 0.06, 0.13)))]) },
    lanyard: { bone: 'Chest', build: (M, h, c, look, real) => {
      const z = real ? 0.035 : 0;
      return [M(geo('lan1', () => new THREE.BoxGeometry(0.012, 0.3, 0.008)), '#2d6fd6', h.clone().add(V3(-0.07, 0.0, 0.1 + z)), null, null, 0.35),
        M(geo('lan1', () => new THREE.BoxGeometry(0.012, 0.3, 0.008)), '#2d6fd6', h.clone().add(V3(0.07, 0.0, 0.1 + z)), null, null, -0.35),
        M(geo('lan2', () => new THREE.BoxGeometry(0.06, 0.085, 0.006)), '#f4f1ea', h.clone().add(V3(0, -0.2, 0.11 + z)))]; } },
    drum: { bone: 'Abdomen', build: (M, h) => [
      M(geo('drum', () => new THREE.CylinderGeometry(0.1, 0.1, 0.26, 16).rotateZ(1.5708)), '#d9262c', h.clone().add(V3(0, 0.0, 0.19))),
      M(geo('drumb', () => new THREE.CylinderGeometry(0.103, 0.103, 0.03, 16).rotateZ(1.5708)), '#f4f1ea', h.clone().add(V3(0.1, 0.0, 0.19))),
      M(geo('drumb', () => new THREE.CylinderGeometry(0.103, 0.103, 0.03, 16).rotateZ(1.5708)), '#f4f1ea', h.clone().add(V3(-0.1, 0.0, 0.19))),
      M(geo('drumst', () => new THREE.BoxGeometry(0.34, 0.025, 0.02)), '#f4f1ea', h.clone().add(V3(0, 0.25, 0.08)), null, null, 0)] },
    backpack: { bone: 'Chest', build: (M, h, c, look, real) => [
      M(geo('bp', () => new THREE.BoxGeometry(0.3, 0.38, 0.15)), '#4a6b8a', h.clone().add(real ? V3(0, -0.13, -0.15) : V3(0, -0.02, -0.19)), real ? V3(0.92, 0.95, 0.85) : null)] },
    tako_tray: { bone: 'WristR', build: (M, h) => {
      const out = [M(geo('tray', () => new THREE.BoxGeometry(0.2, 0.02, 0.14)), '#f4f1ea', h.clone().add(V3(0.02, 0.02, 0.16)))];
      for (let i = 0; i < 6; i++) out.push(M(geo('tako', () => new THREE.SphereGeometry(0.032, 8, 6)), '#b5642c', h.clone().add(V3(-0.05 + 0.05 * (i % 3), 0.05, 0.125 + 0.07 * Math.floor(i / 3)))));
      return out; } },
    umbrella: { bone: 'WristR', build: (M, h, g) => (g ? [   // closed, by its handle, the tip by the foot
      M(geo('umbR', () => new THREE.CylinderGeometry(0.028, 0.014, 0.72, 8).rotateZ(1.5708)), '#222a44', g.at(0.44, 0.0, 0.0), null, g.q),
      M(geo('umbhR', () => new THREE.CylinderGeometry(0.014, 0.014, 0.12, 6).rotateZ(1.5708)), '#6a4a2a', g.at(0.05, 0.0, 0.0), null, g.q)] : [
      M(geo('umb', () => new THREE.CylinderGeometry(0.018, 0.028, 1.0, 8)), '#222a44', h.clone().add(V3(0, -0.4, 0.02))),
      M(geo('umbh', () => new THREE.CylinderGeometry(0.014, 0.014, 0.14, 6)), '#6a4a2a', h.clone().add(V3(0, 0.0, 0)))]) },
    // open in the rain, held up in the right hand in front of the chest, the shaft leaning back so the
    // canopy is over the head (weather.js turns it on). It hangs from the chest, so it rides with the
    // body; the arm is posed to its handle every frame (person: rig.animate). Laid out from the head's
    // joint (r: the reference pose), so it fits every body
    umbrella_open: { bone: 'Chest', build: (M, h, c, look, real, r) => {
      const u = umbrellaHold(r && r.Head ? r.Head.pos : h.clone().add(V3(0, 0.3, 0)));
      return [M(geo('umbC', canopyGeo), look.umbrella || '#1d1f26', u.top, null, u.q),
        M(geo('umbT', () => new THREE.SphereGeometry(0.012, 6, 4)), '#2a2a2e', u.top.clone().addScaledVector(u.dir, 0.11)),
        M(geo('umbS', () => new THREE.CylinderGeometry(0.008, 0.008, UMB_LEN, 6).translate(0, -UMB_LEN / 2, 0)), '#2a2a2e', u.top, null, u.q),
        M(geo('umbH', () => new THREE.CylinderGeometry(0.016, 0.016, 0.13, 6)), '#3a2a1e', u.grip, null, u.q)]; } },
    beret: { bone: 'Head', build: (M, h, c, look, real) => [
      M(geo('beret', () => new THREE.CylinderGeometry(0.14, 0.13, 0.04, 20)), look.beret || '#1a1a1d', h.clone().add(V3(0.02, real ? 0.135 : 0.15, -0.01)), real ? V3(1.1, 1, 1.1) : null, null, 0.18),
      M(geo('beretc', () => new THREE.CylinderGeometry(0.008, 0.008, 0.025, 6)), look.beret || '#1a1a1d', h.clone().add(V3(0.02, real ? 0.165 : 0.18, -0.01)))] },
    baguette: { bone: 'WristR', build: (M, h, g) => (g ? [   // held at its paper wrap, hanging down by the leg
      M(geo('bagR', () => new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10).rotateZ(1.5708)), '#c98a3e', g.at(0.2, 0.0, 0.0), null, g.q),
      M(geo('bagwR', () => new THREE.BoxGeometry(0.2, 0.07, 0.065)), '#efe8da', g.at(0.07, 0.0, 0.0), null, g.q)] : [
      M(geo('bag', () => new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10).rotateZ(1.2)), '#c98a3e', h.clone().add(V3(0.02, 0.02, 0.06))),
      M(geo('bagw', () => new THREE.BoxGeometry(0.075, 0.2, 0.065)), '#efe8da', h.clone().add(V3(0.0, -0.02, 0.06)))]) },
    cafe_tray: { bone: 'WristL', build: (M, h) => {
      const out = [M(geo('ctray', () => new THREE.CylinderGeometry(0.17, 0.17, 0.012, 22)), '#b9bcbf', h.clone().add(V3(0, 0.08, 0.05)))];
      for (let i = 0; i < 3; i++) out.push(M(geo('cup', () => new THREE.CylinderGeometry(0.03, 0.025, 0.06, 10)), i ? '#f4f1ea' : '#7a2e33', h.clone().add(V3(-0.07 + 0.07 * i, 0.12, 0.05 + 0.03 * (i % 2)))));
      return out; } },
    tulips: { bone: 'WristR', build: (M, h, c, look) => {
      // a paper cone of tulips from the flower market, carried head down
      const out = [M(geo('tcone', () => new THREE.ConeGeometry(0.07, 0.36, 10, 1, true)), '#efe8da', h.clone().add(V3(0, -0.1, 0.05)))];
      const cols = ['#d9262c', '#f2c12e', '#e8577a', '#f08a24', '#f4f1ea'], k = cols.indexOf(look.tulip) >= 0 ? cols.indexOf(look.tulip) : 0;
      for (let i = 0; i < 5; i++) out.push(M(geo('tulip', () => new THREE.SphereGeometry(0.03, 8, 6)), cols[(k + i) % 5], h.clone().add(V3(-0.04 + 0.02 * i, -0.3, 0.04 + 0.015 * (i % 2)))));
      return out; } },
    flag: { bone: 'WristR', build: (M, h) => [
      M(geo('pole', () => new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6)), '#8a8a8a', h.clone().add(V3(0, 0.3, 0.0))),
      M(geo('flag', () => new THREE.BoxGeometry(0.01, 0.2, 0.3)), '#d9262c', h.clone().add(V3(0, 0.85, -0.16)))] },
  };
  // what an NPC holds for what it does while it waits (look.clip)
  const CLIP_ACC = { Phone: ['phone'], Photo: ['camera'], Documents: ['clipboard'], Reading: ['book'], Drink: ['cup'] };
  // things held in a hand, placed in its grip (see person): nothing where the rig has no fingers
  const B3 = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  Object.assign(ACC, {
    phone: { bone: 'WristR', build: (M, h, g) => (g ? [M(geo('phone', () => B3(0.14, 0.07, 0.009)), '#16181c', g.at(0.07, 0.0, 0.022 * g.palm), null, g.q)] : []) },
    camera: { bone: 'WristR', build: (M, h, g) => (g ? [   // gripped by its right end, the lens away from the face
      M(geo('cam', () => B3(0.07, 0.075, 0.13)), '#1d1f22', g.at(0.045, -0.01, 0.075 * g.palm), null, g.q),
      M(geo('lens', () => new THREE.CylinderGeometry(0.028, 0.028, 0.06, 14)), '#0f1012', g.at(0.045, -0.07, 0.085 * g.palm), null, g.q)] : []) },
    clipboard: { bone: 'WristL', build: (M, h, g) => (g ? [
      M(geo('board', () => B3(0.31, 0.23, 0.01)), '#8a6a45', g.at(0.12, 0.0, 0.02 * g.palm), null, g.q),
      M(geo('paper', () => B3(0.27, 0.2, 0.004)), '#f2f0ea', g.at(0.12, 0.0, 0.028 * g.palm), null, g.q)] : []) },
    book: { bone: 'WristR', build: (M, h, g) => (g ? [M(geo('book', () => B3(0.21, 0.15, 0.025)), '#5b2c2c', g.at(0.08, 0.0, 0.03 * g.palm), null, g.q)] : []) },
    cup: { bone: 'WristR', build: (M, h, g) => (g ? [
      M(geo('cup', () => new THREE.CylinderGeometry(0.042, 0.034, 0.11, 14)), '#f4f1ea', g.at(0.06, 0.01, 0.045 * g.palm), null, g.q),
      M(geo('lid', () => new THREE.CylinderGeometry(0.044, 0.044, 0.015, 14)), '#3a2a20', g.at(0.06, 0.07, 0.045 * g.palm), null, g.q)] : []) },
  });

  // ------------------------------------------------------------ loading
  // people.json, tried again twice if the request fails (as gltf.js does for the models)
  async function fetchJSON(url) {
    for (let i = 0; ; i++) {
      try { const r = await fetch(url); if (r.ok) return await r.json(); if (i >= 2 || r.status < 500) throw new Error(`${url}: HTTP ${r.status}`); }
      catch (e) { if (i >= 2) throw e; }
      await new Promise(r => setTimeout(r, 800 * 3 ** i));
    }
  }
  async function load(base, { onMsg } = {}) {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) throw new Error('GLTFLoader is not available');
    const L = new THREE.GLTFLoader();
    const get = u => new Promise((res, rej) => L.load(base + u, res, null, rej));
    const info = await fetchJSON(base + 'people.json');
    const [aM, aW, cr] = await Promise.all([get(info.anims.M), get(info.anims.W), get(info.crowd)]);
    const lib = { info, clips: { M: aM.animations, W: aW.animations }, lod: {}, tpl: {}, loading: {} };
    cr.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry;
      g.setAttribute('mat', g.getAttribute('_mat'));
      g.setAttribute('part', g.getAttribute('_part'));
      lib.lod[o.name] = { geometry: g, extras: o.userData };
    });
    lib.require = name => lib.loading[name] || (lib.loading[name] = get(`${name}.glb`).then(g => {
      let mesh = null;
      g.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
      mesh.geometry.setAttribute('mat', mesh.geometry.getAttribute('_mat'));
      const tpl = { scene: g.scene, extras: mesh.userData, pack: info.characters[name].pack };
      return warmPalette(lib, mesh).then(() => {
        lib.tpl[name] = tpl;
        if (onMsg) onMsg(name);
        return tpl;
      });
    }));
    lib.names = Object.keys(info.characters);
    lib.warmPalette = () => warmPalette(lib);
    // the main characters (blender/build_people.py): textured, with their own clips and skeleton
    const H = info.heroes || {}, plain = lib.require;
    lib.heroes = H.characters || {};
    // the NPCs (build_people.py --npcs): textured too, on the same skeleton, sharing one file of clips per sex
    const NP = info.npcs || {};
    lib.npcs = NP.characters || {};
    // a textured character that comes once the game is open is shown (lib.tpl, which the crowd and the NPCs
    // wait on) only when its textures are on the GPU and its shaders compiled, off the frame (lib.warm, set
    // by the game once its loader has compiled the scene; issue 201): else the first frame that draws it
    // uploads them and links its program, a hitch of a frame or more each time someone new comes into view
    // on a phone (quality.js lean) an NPC's pictures go up at LEAN_PX a side: a 1024 one is 5.3 MB of the GPU with its
    // mipmaps, two or three a character and twenty-odd characters a map (130 MB in Tokyo, issue 406), for someone who
    // stands a few hundred pixels tall at most on a phone's canvas. The characters you play keep theirs
    const QC = window.OEQuality ? OEQuality.city() : null, LEAN_PX = 512 >> ((QC && QC.lighter) ? 1 : 0), lean = !!(QC && QC.lean); // (256 after the map's page died here: quality.js died)
    const smaller = tpl => {
      const jobs = [];
      tpl.scene.traverse(o => {
        if (!o.isSkinnedMesh) return;
        for (const m of [].concat(o.material)) for (const k in m) {
          const t = m[k], im = t && t.isTexture && t.image;
          if (!im || !(im.width > LEAN_PX || im.height > LEAN_PX) || t.userData.oeLean || typeof createImageBitmap !== 'function') continue;
          t.userData.oeLean = true;
          const f = LEAN_PX / Math.max(im.width, im.height);
          jobs.push(createImageBitmap(im, { resizeWidth: Math.round(im.width * f), resizeHeight: Math.round(im.height * f), resizeQuality: 'high' })
            .then(bm => { t.image = bm; t.needsUpdate = true; if (im.close) im.close(); }).catch(() => {})); // (else as it came)
        }
      });
      return Promise.all(jobs);
    };
    // The hair cards (an avatar's *_opacity material: flat strips of hair cut out of a picture, and the lashes) each
    // face their own way, and lit by their own normals a strip that turns from the sun went black beside one that
    // faces it: shards in a fringe, a dark band across the back of a head. They are lit as one head of hair instead,
    // each vertex's normal pointing out from the middle of the head, as hair is shaded wherever it is built of cards.
    const roundHair = o => {
      const g = o.geometry, P = g.attributes.position, Nn = g.attributes.normal;
      if (!P || !Nn || g.userData.oeHair) return;
      g.userData.oeHair = true;
      g.computeBoundingBox();
      const bb = g.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      // (the box's middle, whichever axis is up in the mesh's own frame: the cards wrap the skull all round)
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i) - cx, y = P.getY(i) - cy, z = P.getZ(i) - cz, l = Math.hypot(x, y, z) || 1;
        Nn.setXYZ(i, x / l, y / l, z / l);
      }
      Nn.needsUpdate = true;
      // (a two-sided material turns the normal round on a face seen from behind, and half the strips are wound
      // facing the skull: those stayed black. Each strip is drawn from both sides as two faces with the one normal)
      const ix = g.index;
      if (ix) {
        const a = ix.array, both = new a.constructor(a.length * 2);
        both.set(a);
        for (let i = 0; i < a.length; i += 3) { both[a.length + i] = a[i]; both[a.length + i + 1] = a[i + 2]; both[a.length + i + 2] = a[i + 1]; }
        g.setIndex(new THREE.BufferAttribute(both, 1));
        o.material.side = THREE.FrontSide;
      }
    };
    // ... and in the colour of the hair they lie on. The cards' picture is darker than the hair painted on the head
    // under them, much darker where the hair was recoloured (a brown or grey head kept near-black wisps: they read
    // as black shards stuck in the fringe). Measured here, once a character: the cards' opaque texels against the
    // head's picture at the head's vertices nearest the cards, and the cards' material lightened by the ratio.
    const pixels = (tex, side = 96) => {
      const im = tex && tex.image;
      if (!im || !im.width) return null;
      const cv = document.createElement('canvas'); cv.width = cv.height = side;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0, side, side);
      const d = g.getImageData(0, 0, side, side).data;
      cv.width = cv.height = 0;
      const lin = v => Math.pow(v / 255, 2.2);
      return (u, v) => { // (a glTF picture: v down the image; the texture's own transform first)
        const x = Math.min(side - 1, Math.max(0, Math.floor((u * tex.repeat.x + tex.offset.x) % 1 * side))), y = Math.min(side - 1, Math.max(0, Math.floor((v * tex.repeat.y + tex.offset.y) % 1 * side))), k = 4 * (y * side + x);
        return [lin(d[k]), lin(d[k + 1]), lin(d[k + 2]), d[k + 3] / 255];
      };
    };
    const matchHair = (hair, head) => {
      const hm = hair.material, dm = head.material;
      if (hm.userData.oeHairTint || !hm.map || !dm.map) return;
      hm.userData.oeHairTint = true;
      let cardAt, headAt;
      try { cardAt = pixels(hm.map); headAt = pixels(dm.map); } catch (e) { return; }
      const P = hair.geometry.attributes.position, U2 = hair.geometry.attributes.uv, Q = head.geometry.attributes.position, V2 = head.geometry.attributes.uv;
      if (!cardAt || !headAt || !P || !U2 || !Q || !V2) return;
      const sum = [0, 0, 0], under = [0, 0, 0];
      let n = 0;
      for (let i = 0, step = Math.max(1, Math.floor(P.count / 240)); i < P.count; i += step) {
        const c = cardAt(U2.getX(i), U2.getY(i));
        if (c[3] < 0.5) continue;
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        let best = -1, bd = Infinity;
        for (let j = 0; j < Q.count; j++) { const dx = Q.getX(j) - x, dy = Q.getY(j) - y, dz = Q.getZ(j) - z, dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; best = j; } }
        if (best < 0) continue;
        const h = headAt(V2.getX(best), V2.getY(best));
        for (let k = 0; k < 3; k++) { sum[k] += c[k]; under[k] += h[k]; }
        n++;
      }
      if (n < 12) return;
      const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], ratio = lum(under) / Math.max(1e-4, lum(sum));
      if (ratio < 1.2 && ratio > 0.8) return; // (they agree already)
      const k = Math.min(1.6, Math.max(0.7, ratio)); // (their tone, not their hue: on black hair a channel's ratio is noise)
      hm.color.setRGB(k, k, k);
    };
    const ready = (name, tpl, npc = false) => {
      let hair = null, head = null;
      tpl.scene.traverse(o => {
        if (!o.isSkinnedMesh) return;
        o.castShadow = o.receiveShadow = true; [].concat(o.material).forEach(litMaterial); // (the variant person() draws, its shadow's too)
        if (/_opacity$/.test(o.material.name || '') && !/glasses/.test(o.material.name)) { hair = o; roundHair(o); } else if (/_head$/.test(o.material.name || '')) head = o;
      });
      if (hair && head) matchHair(hair, head);
      return (lean && npc ? smaller(tpl) : Promise.resolve()).then(() => (lib.warm ? lib.warm(tpl.scene).catch(() => {}) : null)).then(() => {
        lib.tpl[name] = tpl;
        if (onMsg) onMsg(name);
        return tpl;
      });
    };
    const clipsOf = sex => lib.loading[`clips:${sex}`] || (lib.loading[`clips:${sex}`] = get(NP.clips[sex].file).then(g => g.animations));
    lib.require = name => {
      const h = lib.heroes[name], c = lib.npcs[name];
      if (c) {
        return lib.loading[name] || (lib.loading[name] = Promise.all([get(c.file), clipsOf(c.sex)]).then(([g, clips]) =>
          ready(name, { scene: g.scene, textured: true, clips, speeds: NP.clips[c.sex].ground_speed, bones: NP.bones || {} }, true)));
      }
      if (!h) return plain(name);
      return lib.loading[name] || (lib.loading[name] = get(h.file).then(g =>
        ready(name, { scene: g.scene, textured: true, clips: g.animations, speeds: h.ground_speed, bones: H.bones || {} })));
    };
    return lib;
  }

  // a random look for a character: skin, hair, clothes and height
  // style (optional, per city): a preset's name (STYLES) or { skin, hair, tops, legs: [hex], weights: {name: n},
  // scale: [min, max], patterns: {tiger: p, leopard: p, ...}, acc: {mask: p, ...} }; every field is optional.
  // Without one, the style setStyle() chose.
  const PAT_TOP = { tiger: '#f6c500', leopard: '#c9a66b', kuidaore: '#d9262c', pinstripe: '#23262e', plaid: '#6e3a2a' };
  function randomLook(lib, name, style) {
    const ch = lib.info.characters[name], w = ch.pack === 'W', st = styleOf(style) || STYLE || {};
    const skin = st.skin || SKIN, hair = st.hair || HAIR;
    const look = { character: name, skin: pick(skin), hair: st.hair ? pick(hair) : rnd() < 0.15 ? pick(HAIR.slice(8)) : pick(HAIR.slice(0, 9)), top: pick(st.tops || TOPS), legs: pick(st.legs || LEGS),
      scale: st.scale ? st.scale[0] + rnd() * (st.scale[1] - st.scale[0]) - (w ? 0.055 : 0) : (w ? 0.885 : 0.94) + rnd() * 0.06 };
    if (st.patterns && ch.classes.includes('top')) {
      let r = rnd();
      for (const [k, p] of Object.entries(st.patterns)) { if ((r -= p) < 0) { look.pattern = k; look.top = PAT_TOP[k]; break; } }
    }
    if (st.acc) { const a = Object.keys(st.acc).filter(k => rnd() < st.acc[k]); if (a.length) look.acc = a; }
    return look;
  }
  function pickCharacter(lib, style) {
    const st = styleOf(style) || STYLE, own = !!(st && st.weights), wt = own ? st.weights : WEIGHT;
    const names = lib.names, tot = names.reduce((a, n) => a + (wt[n] != null ? wt[n] : own ? 0 : 1), 0);
    let r = rnd() * tot;
    for (const n of names) { r -= wt[n] != null ? wt[n] : own ? 0 : 1; if (r <= 0) return n; }
    return names[0];
  }

  // the palette a look gives a character, linear RGB, padded to N
  function colours(extras, look) {
    const pal = extras.palette, cls = extras.classes;
    const skinRef = (pal[cls.indexOf('skin')] || [0.617])[0];
    const c = k => (look[k] ? lin(look[k]) : null);
    const skin = c('skin'), hair = c('hair'), top = c('top'), legs = c('legs');
    const out = [];
    for (let i = 0; i < N; i++) {
      const p = pal[i] || [0, 0, 0], k = cls[i];
      let v = new THREE.Color(p[0], p[1], p[2]);
      if (k === 'skin' && skin) v = skin.clone().multiplyScalar(p[0] / skinRef);
      else if (k === 'hair' && hair) v = hair.clone();
      else if (k === 'brows' && hair) v = hair.clone().multiplyScalar(0.6);
      else if (k === 'top' && top) v = top.clone();
      else if (k === 'legs' && legs) v = legs.clone();
      out.push(new THREE.Vector3(v.r, v.g, v.b));
    }
    return out;
  }

  // ------------------------------------------------------------ the street lights on people
  // setLight(patch): a shader patch every person's material takes from then on (world.js
  // streetLit: after dark the street lights' pool where they stand lights them as it lights the
  // pavement, so the player and the people they meet are not silhouettes under a lamp)
  let streetLit = null;
  function setLight(patch) { streetLit = patch; }
  function litMaterial(m) {
    if (!streetLit || !m || !m.isMeshStandardMaterial || m.userData.streetLit) return;
    const own = m.onBeforeCompile, patch = streetLit, key = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { if (own) own.call(m, sh, r); patch(sh); };
    // three.js keys a program by the text of onBeforeCompile, which this wrapper makes alike for all
    m.customProgramCacheKey = () => `person-lit|${key ? key.call(m) : ''}|${own ? own.toString() : ''}`;
    m.userData.streetLit = true;
    m.needsUpdate = true;
  }

  // ------------------------------------------------------------ one person: skinned, animated
  function paletteMaterial(pal, cls) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    mat.userData.pal = { value: pal };
    mat.userData.cls = { value: Float32Array.from({ length: N }, (_, i) => cls[i] || 0) };
    mat.userData.pat = { value: 0 };
    mat.userData.pat2 = { value: new THREE.Vector3(-1, -1, -1) };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPal = mat.userData.pal;
      sh.uniforms.uCls = mat.userData.cls;
      sh.uniforms.uPat = mat.userData.pat;
      sh.uniforms.uPat2 = mat.userData.pat2;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float mat; uniform vec3 uPal[${N}]; uniform float uCls[${N}]; varying vec3 vPal; varying float vCls; varying vec3 vObj;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vPal = uPal[int(mat + 0.5)]; vCls = uCls[int(mat + 0.5)]; vObj = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPal; varying float vCls; varying vec3 vObj; uniform float uPat; uniform vec3 uPat2;
${PAT_GLSL}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( (uPat > 0.5 && vCls > 3.5 && vCls < 4.5) ? oePattern(vPal, vObj, uPat, uPat2) : vPal, opacity );');
    };
    return mat;
  }

  // The palette material's program (one for every untextured person: the same patch, the same key),
  // compiled, with its shadow pass's, before the first of them is shown (issue 266): person() makes the
  // material per person, so warming the template (lib.warm) never reached it, and the first one drawn
  // linked it in a frame. Once per library, on a stand-in for the first character that comes once the
  // game is open (before then, the loader's compile of the scene covers whoever stands in it).
  // (lib.warmPalette(): the same from a template already loaded, for the game to call once it sets lib.warm.)
  // The things people hold (stdMat: one program for every colour, and one for the clear umbrellas) come with
  // the first of them too, since their shadows' variant is drawn by nothing in the scene the loader compiled.
  function warmPalette(lib, mesh) {
    if (!lib.warm) return Promise.resolve();
    const waits = [];
    if (!lib.propsWarm) {
      const g = new THREE.Group();
      for (const hex of ['#808080', 'clear']) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), stdMat(hex)); q.castShadow = true; g.add(q); }
      lib.propsWarm = lib.warm(g).catch(() => {});
    }
    waits.push(lib.propsWarm);
    if (!lib.paletteWarm) {
      if (!mesh) for (const t of Object.values(lib.tpl)) if (!t.textured && !mesh) t.scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (mesh) {
        const m = mesh.clone();
        m.material = paletteMaterial(Array.from({ length: N }, () => new THREE.Vector3(0.5, 0.5, 0.5)), []);
        litMaterial(m.material);
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
        m.children = [];
        lib.paletteWarm = lib.warm(m).catch(() => {});
      }
    }
    if (lib.paletteWarm) waits.push(lib.paletteWarm);
    return Promise.all(waits);
  }

  // scratch objects, made on first use (three.js may load after this file)
  let up, tv, tq, tq2, hp, sa, sb, sd, sd2, fw, sq, sq2, rq, r1, r2, r3, r4;
  // turn bone b so that it points in direction dir (world space): towards its child, or along
  // its own +y axis (the way the bone points, as Blender exports it) when there is none
  function aim(b, child, dir) {
    if (child) { b.getWorldPosition(sa); child.getWorldPosition(sb); sd.subVectors(sb, sa).normalize(); }
    else sd.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(sq));
    sq.setFromUnitVectors(sd, dir);
    b.getWorldQuaternion(sq2);
    sq.multiply(sq2);
    b.parent.getWorldQuaternion(sq2).invert();
    b.quaternion.copy(sq2.multiply(sq));
    b.updateMatrixWorld(true);
  }
  function person(lib, look) {
    if (!up) {
      up = new THREE.Vector3(0, 1, 0); tv = new THREE.Vector3(); tq = new THREE.Quaternion(); tq2 = new THREE.Quaternion(); hp = new THREE.Vector3();
      sa = new THREE.Vector3(); sb = new THREE.Vector3(); sd = new THREE.Vector3(); sd2 = new THREE.Vector3(); fw = new THREE.Vector3();
      sq = new THREE.Quaternion(); sq2 = new THREE.Quaternion(); rq = new THREE.Quaternion();
      r1 = new THREE.Vector3(); r2 = new THREE.Vector3(); r3 = new THREE.Vector3(); r4 = new THREE.Vector3();
    }
    const T = lib.tpl[look.character], speeds = T.speeds || lib.info.ground_speed[T.pack];
    const alias = n => (T.bones && T.bones[n]) || n; // the old characters' bone names on a main character's rig
    const model = THREE.SkeletonUtils.clone(T.scene);
    let mesh = null, head = null;
    const bone = {};
    model.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; if (o.isBone) bone[o.name] = o; });
    head = bone[alias('Head')] || null;
    if (T.textured) model.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(litMaterial); } });
    else {
      mesh.material = paletteMaterial(colours(T.extras, look), T.extras.classes.map(c => CLS[c] || 0));
      litMaterial(mesh.material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
    const root = new THREE.Group();
    root.add(model);
    const mixer = new THREE.AnimationMixer(model), act = {};
    for (const c of T.clips || lib.clips[T.pack]) act[c.name] = mixer.clipAction(c);
    let cur = null, cycles = 0, lastT = 0, waveUntil = -Infinity, lookW = 0, talked = false;
    const rig = { root, model, mixer, look, phase: 0, lookTarget: null, character: look.character };
    // reference pose for accessories: the first frame of Idle, in the model's own space
    const bones = {}, ref = {};
    model.traverse(o => { if (o.isBone) bones[o.name] = o; });
    if (act.Idle) { act.Idle.play(); mixer.update(0); act.Idle.stop(); }
    model.updateMatrixWorld(true);
    const mInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    // how far the top of the head (and a hat) stands over the hip joints, standing, at scale 1: what a
    // seat has to leave under a car's roof (rig.headTop, below)
    const thigh = bone[THREE.PropertyBinding.sanitizeNodeName(alias('UpperLeg.L'))];
    let crown = 0, overHead = 0;
    if (thigh) {
      const box = new THREE.Box3(), part = new THREE.Box3(), rel = new THREE.Matrix4();
      // (a skinned mesh's vertices are already in the standing figure's frame; its node's transform is not what places them)
      model.traverse(o => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.isSkinnedMesh ? o.geometry.boundingBox : part.copy(o.geometry.boundingBox).applyMatrix4(rel.multiplyMatrices(mInv, o.matrixWorld))); } });
      crown = box.max.y - V3(0, 0, 0).setFromMatrixPosition(rel.multiplyMatrices(mInv, thigh.matrixWorld)).y;
      if (head) overHead = box.max.y - V3(0, 0, 0).setFromMatrixPosition(rel.multiplyMatrices(mInv, head.matrixWorld)).y; // and over the head's joint
    }
    for (const n of ['Head', 'Chest', 'Abdomen', 'Hips', 'WristR', 'WristL']) {
      if (!bones[alias(n)]) continue;
      bones[n] = bones[alias(n)];
      const bm = new THREE.Matrix4().multiplyMatrices(mInv, bones[n].matrixWorld);
      ref[n] = { pos: V3(0, 0, 0).setFromMatrixPosition(bm), inv: bm.clone().invert() };
    }
    // each hand's grip, from its finger bones (on a Rocketbox rig), for what it holds: x along the
    // fingers, y towards the thumb, z the third way (palm: which way along it the palm faces);
    // at(x, y, z) is a point in it, q its turn
    const grip = {};
    for (const [n, s] of [['WristR', 'R'], ['WristL', 'L']]) {
      const f2 = bone[`Bip01_${s}_Finger2`], th = bone[`Bip01_${s}_Finger01`];
      if (!ref[n] || !f2 || !th) continue;
      const o = ref[n].pos, p = b => V3(0, 0, 0).setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(mInv, b.matrixWorld)).sub(o);
      const x = p(f2).normalize(), y = p(th), z = new THREE.Vector3();
      y.addScaledVector(x, -y.dot(x)).normalize();
      z.crossVectors(x, y);
      grip[n] = { at: (a, b, c) => o.clone().addScaledVector(x, a).addScaledVector(y, b).addScaledVector(z, c),
        q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)), palm: s === 'R' ? -1 : 1 };
    }
    // a real head (a Rocketbox rig, found by its eyes) is narrower and longer than the old characters'
    // the hats and glasses were made for, whose eyes are 9 cm apart: they are fitted to it axis by axis
    let headFit = null;
    if (bone.Bip01_REye && bone.Bip01_LEye) {
      const p = b => V3(0, 0, 0).setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(mInv, b.matrixWorld));
      const r = p(bone.Bip01_REye), l = p(bone.Bip01_LEye);
      headFit = { s: V3(1.1 * r.distanceTo(l) / 0.09, 1.05, 0.8), mid: r.add(l).multiplyScalar(0.5).add(V3(0, -0.03, -0.105)) };
    }
    let accKey = '', accObjs = [];
    const mk = (g, hex, pos, scale, turn, rotZ) => {
      const m = new THREE.Mesh(g, stdMat(hex));
      m.position.copy(pos);
      if (scale) m.scale.copy(scale);
      if (turn) m.quaternion.copy(turn);
      if (rotZ) m.rotation.z = rotZ;
      m.castShadow = true;
      return m;
    };
    // what the NPC does while it waits (look.clip), if this character has the clip
    const idleClip = () => (look.clip && act[look.clip] ? look.clip : 'Idle');
    function setAccessories() {
      const ids = noUmb([...(look.acc || []), ...((act[look.clip] && CLIP_ACC[look.clip]) || [])]);
      const key = JSON.stringify([ids, look.apron || '']);
      if (key === accKey) return;
      accKey = key;
      for (const o of accObjs) o.parent && o.parent.remove(o);
      accObjs = [];
      for (const id of ids) {
        const a = ACC[id], bn = a && headFit && a.realBone && ref[a.realBone] ? a.realBone : a && a.bone;
        if (!a || !ref[bn]) continue;
        const grp = new THREE.Group();
        const anchor = ref[bn].pos.clone();
        const fit = bn === 'Head' && headFit;
        if (fit) anchor.copy(fit.mid);
        else if (bn === 'Head') { anchor.y += 0.11; anchor.z -= 0.05; }   // the middle of the head
        for (const m of a.build(mk, anchor, grip[bn], look, !!headFit, ref)) {
          if (fit) { m.position.sub(anchor).multiply(fit.s).add(anchor); m.scale.multiply(fit.s); }
          grp.add(m);
        }
        grp.matrixAutoUpdate = false;
        grp.matrix.copy(ref[bn].inv);
        bones[bn].add(grp);
        accObjs.push(grp);
      }
      // an open umbrella's handle, in the model's own space: the right hand goes to it (holdUmbrella)
      umbGrip = ids.includes('umbrella_open') && ref.Head && ref.Chest ? umbrellaHold(ref.Head.pos).grip : null;
    }
    // the right arm up to the umbrella's handle, over whatever the clip has it doing: a two-bone reach
    // from the shoulder, the elbow down and out by the side, the fist (a hand's length past the
    // wrist) round the handle. The clip's arm is kept to be put back before the next frame.
    let umbGrip = null, armHeld = null;
    const armBack = () => { if (armHeld) { const a = arms[1]; a.ua.quaternion.copy(armHeld[0]); a.la.quaternion.copy(armHeld[1]); armHeld = null; } };
    // (at: a point in the world for the fist instead, rig.hold: a fishing rod's grip, game/fishing.js)
    function holdUmbrella(at) {
      const a = arms[1];
      armHeld = [a.ua.quaternion.clone(), a.la.quaternion.clone()];
      root.updateMatrixWorld(true);
      const fist = at ? r2.copy(at) : r2.copy(umbGrip).applyMatrix4(ref.Chest.inv).applyMatrix4(bones.Chest.matrixWorld);
      const sh = a.ua.getWorldPosition(r3), el = a.la.getWorldPosition(r4);
      const L1 = sh.distanceTo(el), L2 = el.distanceTo(a.wr.getWorldPosition(r1)), L3 = L2 + 0.075 * model.getWorldScale(sa).y;
      const to = sd2.subVectors(fist, sh), d = Math.min(Math.max(to.length(), Math.abs(L1 - L3) + 1e-3), L1 + L3 - 1e-3);
      to.normalize();
      const along = (L1 * L1 - L3 * L3 + d * d) / (2 * d), off = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      // which way the elbow bends: down, out to the right and a little back
      const out = r1.set(-1, 0, 0).applyQuaternion(root.getWorldQuaternion(rq)), back = fw.set(0, 0, -1).applyQuaternion(rq);
      const pole = out.multiplyScalar(0.55).addScaledVector(back, 0.25);
      pole.y -= 1;
      pole.addScaledVector(to, -pole.dot(to)).normalize();
      const elbow = r4.copy(sh).addScaledVector(to, along).addScaledVector(pole, off);
      aim(a.ua, a.la, elbow.clone().sub(sh).normalize());
      aim(a.la, a.wr, fist.sub(elbow).normalize());
    }
    function play(name, fade = 0.25, once = false) {
      // (a clip this character's rig was not built with, a sitting or a running one: its idle instead, or any it has.
      // Tokyo's people at 576,1269 threw here one run in three)
      const a = act[name] || act.Idle || act.Walk || Object.values(act)[0];
      if (!a) return { setEffectiveTimeScale() { return this; } };
      if (cur === a) return a;
      a.reset();
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = once;
      a.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      if (cur) cur.crossFadeTo(a, fade, false);
      cur = a;
      lastT = 0;
      return a;
    }
    rig.setLook = l => {
      Object.assign(look, l);
      rig.character = look.character;
      if (!T.textured) { // a main character keeps its own textures
        mesh.material.userData.pal.value = colours(T.extras, look);
        mesh.material.userData.pat.value = PAT[look.pattern] || 0;
        if (look.pattern2) { const c = lin(look.pattern2); mesh.material.userData.pat2.value.set(c.r, c.g, c.b); } else mesh.material.userData.pat2.value.set(-1, -1, -1);
      }
      model.scale.setScalar(look.scale || 1);
      setAccessories();
    };
    rig.setLook({});
    // sitting has no clip: bend the legs over the idle pose, thighs forward and shins down (an aim
    // per bone in world space, so it doesn't depend on how the bones' axes are set up). The feet
    // are IK targets under Root in these rigs, not children of the shins, so they are moved to
    // the ends of the shins (a main character's feet hang from its shins, and follow them); then the
    // body is lowered until they are back on the ground. In a car (rig.legRake ~1) the shins reach
    // forward to the pedals, and with rig.reach (a point in the world: the steering wheel's hub) the
    // hands go to either side of it. A main character's bones are found by their names on the old
    // rigs (alias, people.json "heroes.bones").
    const B = name => bone[THREE.PropertyBinding.sanitizeNodeName(alias(name))]; // the loader drops the dots: Foot.L is FootL
    const legs = ['L', 'R'].map(side => ({ ul: B('UpperLeg.' + side), ll: B('LowerLeg.' + side), ft: B('Foot.' + side), shin: 0, y0: 0 }));
    for (const l of legs) l.hangs = !!l.ft && l.ft.parent === l.ll;
    const arms = ['L', 'R'].map(side => ({ ua: B('UpperArm.' + side), la: B('LowerArm.' + side), wr: B('Wrist.' + side), s: side === 'L' ? 1 : -1 }));
    const seated = legs.every(l => l.ul && l.ll && l.ft), reaches = arms.every(a => a.ua && a.la && a.wr);
    // The mixer only writes a bone whose value has changed, so under a still clip a foot moved
    // here stays moved: put it back where the clip had it before measuring again (or standing up).
    const feetBack = () => { for (const l of legs) if (l.moved) { if (l.ft.position.equals(l.set)) l.ft.position.copy(l.home); l.moved = false; } };
    // ... and so for the legs bent and the arms put on the wheel: back to the clip's pose before the mixer runs, else
    // under a still clip a frame began with the thighs already forward, the feet were measured from there, the body
    // went down 0.38 m less and the head rose that much through a car's roof, on the frames where the clip held still
    // (which ones depends on the frame times: Tokyo's taxi driver under load, #392)
    const bent = [];
    const bendBack = () => { for (const [b, q] of bent) b.quaternion.copy(q); bent.length = 0; };
    const bend = b => { const q = (b.userData.clipQ = b.userData.clipQ || new THREE.Quaternion()).copy(b.quaternion); bent.push([b, q]); };
    function seat() {
      if (!seated) return;
      model.position.y = 0;
      feetBack();
      root.updateWorldMatrix(true, true); // the parents too: in a moving car they have moved since they were drawn
      fw.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(sq));
      // with the feet back where the clip has them, the shin's length and the ankle's height
      for (const l of legs) { l.y0 = l.ft.getWorldPosition(sa).y; l.shin = sa.distanceTo(l.ll.getWorldPosition(sb)); }
      let drop = 0;
      for (const l of legs) {
        bend(l.ul); bend(l.ll);
        aim(l.ul, l.ll, sd2.copy(fw));
        const down = sd2.set(0, -1, 0).addScaledVector(fw, rig.legRake ?? 0.12).normalize();
        aim(l.ll, l.hangs ? l.ft : null, down); // (towards the foot where it hangs from the shin: those bones' axes differ)
        const ankle = l.ll.getWorldPosition(sa).addScaledVector(down, l.shin);
        drop = Math.min(drop, l.y0 - ankle.y);
        if (l.hangs) continue; // it came with the shin
        l.ft.parent.updateMatrixWorld(true);
        l.home = (l.home || new THREE.Vector3()).copy(l.ft.position);
        l.ft.position.copy(l.ft.parent.worldToLocal(ankle));
        l.set = (l.set || new THREE.Vector3()).copy(l.ft.position);
        l.moved = true;
      }
      model.position.y = drop / root.getWorldScale(sb).y; // (a car's seat may make the whole figure a little smaller: cars.js sit)
      if (!rig.reach || !reaches) return;
      // hands on the wheel: each elbow a little down and out from halfway, the hand at the rim
      root.updateWorldMatrix(false, true);
      const side = r1.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(rq));
      for (const a of arms) {
        const hand = r2.copy(rig.reach).addScaledVector(side, 0.16 * a.s), sh = a.ua.getWorldPosition(r3);
        const elbow = r4.copy(sh).lerp(hand, 0.5).addScaledVector(side, 0.09 * a.s);
        elbow.y -= 0.1;
        bend(a.ua); bend(a.la);
        aim(a.ua, a.la, elbow.sub(sh).normalize());
        aim(a.la, a.wr, hand.sub(a.la.getWorldPosition(r3)).normalize());
      }
    }
    rig.wave = (t = 0) => { waveUntil = t + act.Wave.getClip().duration * 0.95; play('Wave', 0.2, true); };
    // the top of the head in the world as the rig is posed: over the head's joint as it is now (seated
    // and leaning back, or sitting up), as high as the hair stood over it standing
    if (thigh && crown > 0) rig.headTop = (out = V3(0, 0, 0)) => (head && overHead > 0 ? head.getWorldPosition(out).add(sb.set(0, overHead * model.getWorldScale(sa).y, 0))
      : thigh.getWorldPosition(out).add(sb.set(0, crown * model.getWorldScale(sa).y, 0)));
    // a view through this person's eyes: the head, and whatever is on it, shrinks out of the way
    rig.hideHead = on => { if (head) head.scale.setScalar(on ? 1e-3 : 1); };
    // something held out in the right hand: rig.hold is where the fist goes (a point in the world, or null), and
    // rig.fist(out) where the wrist is as posed
    rig.hold = null;
    rig.fist = out => (reaches ? arms[1].wr.getWorldPosition(out) : null);
    // speed in m/s, mode 'ground' | 'air' | 'sit' | 'talk'; t is the game clock. Seated, the
    // root is where the feet rest: thighs forward, shins down, the hips a chair's height above it
    rig.animate = (dt, speed, mode = 'ground', t = 0) => {
      const s = look.scale || 1;
      model.position.y = 0;
      if (mode !== 'talk') talked = false;
      const waving = t < waveUntil && speed < 0.3 && mode !== 'sit' && mode !== 'air';
      if (mode === 'talk' && !talked) { talked = true; rig.wave(t); }   // a wave hello, then listen
      else if (waving) { /* let the wave finish */ }
      else if (mode === 'talk') play(act.Talk ? 'Talk' : 'Idle', 0.35);
      else if (mode === 'sit') play('Idle_Neutral', 0.2);
      else if (mode === 'air') play('Run', 0.15).setEffectiveTimeScale(0.3);
      else if (speed < 0.15) play(idleClip(), 0.3);
      else if (speed < 2.1) play('Walk', 0.25).setEffectiveTimeScale(Math.max(0.5, Math.min(1.7, speed / (speeds.Walk * s))));
      else if (act.Sprint && speed > 7) play('Sprint', 0.2).setEffectiveTimeScale(Math.max(0.7, Math.min(1.6, speed / (speeds.Sprint * s))));
      else play('Run', 0.2).setEffectiveTimeScale(Math.max(0.6, Math.min(2.4, speed / (speeds.Run * s)))); // up to the 8.5 m/s sprint (game.js GAIT)
      if (mode !== 'sit') feetBack();
      armBack();
      bendBack();
      mixer.update(dt);
      if (mode === 'sit') seat();
      else if (rig.hold && reaches) holdUmbrella(rig.hold);
      else if (umbGrip && reaches && bones.Chest) holdUmbrella();
      // the walk cycle as a phase, two steps per cycle (footsteps)
      const d = cur.getClip().duration, tt = cur.time / d;
      if (tt < lastT) cycles++;
      lastT = tt;
      rig.phase = (cycles + tt) * Math.PI * 2;
      // turn the head towards whatever is worth looking at
      lookW += ((rig.lookTarget && speed < 2.1 ? 1 : 0) - lookW) * Math.min(1, dt * 4);
      if (head && lookW > 0.01) {
        root.updateMatrixWorld(true);
        head.getWorldPosition(hp);
        const tgt = rig.lookTarget || hp;
        tv.subVectors(tgt, hp);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(tq2));
        let yaw = Math.atan2(tv.x, tv.z) - Math.atan2(fwd.x, fwd.z);
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        yaw = Math.max(-1.1, Math.min(1.1, yaw)) * lookW;
        head.getWorldQuaternion(tq);
        tq.premultiply(tq2.setFromAxisAngle(up, yaw));
        head.parent.getWorldQuaternion(tq2).invert();
        head.quaternion.copy(tq2.multiply(tq));
      }
    };
    return rig;
  }

  // ------------------------------------------------------------ the crowd: instanced far, skinned near
  function crowdMaterial(ex, U) {
    const pal = colours(ex, {}), cls = new Float32Array(N);
    ex.classes.forEach((c, i) => { cls[i] = CLS[c] || 0; });
    const skinRef = (ex.palette[ex.classes.indexOf('skin')] || [0.617])[0];
    const uni = { uPal: { value: pal }, uCls: { value: cls }, uSkinRef: { value: skinRef },
      uHip: { value: new THREE.Vector2(...ex.hip) }, uKnee: { value: new THREE.Vector2(...ex.knee) }, uShoulder: { value: new THREE.Vector2(...ex.shoulder) } };
    const pose = `
attribute float mat; attribute float part; attribute vec3 aAnim; attribute float iUmb;
uniform float uTime; uniform vec2 uHip; uniform vec2 uKnee; uniform vec2 uShoulder;
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
// legs swing from the hips with the knee bending on the back swing; arms swing from the shoulders.
// A negative amplitude means sitting: thighs forward, shins down.
vec3 crowdPose(vec3 p, bool isNormal) {
  bool sit = aAnim.z < -0.5;
  float amp = max(aAnim.z, 0.0), ph = uTime * aAnim.y + aAnim.x, sw = sin(ph) * amp;
  float side = (part > 0.5 && part < 1.5) || (part > 2.5 && part < 3.5) || (part > 4.5 && part < 5.5) ? 1.0 : -1.0;
  bool leg = (part > 0.5 && part < 2.5) || part > 4.5, shin = part > 4.5, arm = part > 2.5 && part < 4.5;
  vec3 piv;
  if (shin) { float k = sit ? 1.5708 : max(0.0, -cos(ph) * side) * amp * 1.3; piv = vec3(0.0, uKnee); p = isNormal ? rx(k) * p : rx(k) * (p - piv) + piv; }
  if (leg) { float a = sit ? -1.5708 : sw * side; piv = vec3(0.0, uHip); p = isNormal ? rx(a) * p : rx(a) * (p - piv) + piv; }
  // the right arm holding an umbrella up (iUmb): the upper arm back by the side, the forearm folded up
  // to the handle under the chin (umbrellaHold)
  if (arm && side < 0.0 && iUmb > 0.5 && !sit) {
    vec3 el = vec3(0.0, uShoulder.x - 0.27, uShoulder.y);
    float lo = smoothstep(el.y + 0.05, el.y - 0.03, position.y);
    float a = -2.3 * lo; p = isNormal ? rx(a) * p : rx(a) * (p - el) + el;
    piv = vec3(0.0, uShoulder); p = isNormal ? rx(0.5) * p : rx(0.5) * (p - piv) + piv;
  } else if (arm) { piv = vec3(0.0, uShoulder); p = isNormal ? rx(-sw * side * 0.8) * p : rx(-sw * side * 0.8) * (p - piv) + piv; }
  if (!isNormal) p.y += abs(cos(ph)) * 0.035 * amp;
  return p;
}`;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni, { uTime: U.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${pose}
attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iTop; attribute vec3 iLegs; attribute float iPat;
uniform vec3 uPal[${N}]; uniform float uCls[${N}]; uniform float uSkinRef; varying vec3 vPal; varying float vCls; varying float vPatId; varying vec3 vObj;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = crowdPose(objectNormal, true);`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = crowdPose(transformed, false);
int mi = int(mat + 0.5); vec3 base = uPal[mi]; float c = uCls[mi];
vPal = c < 0.5 ? base : c < 1.5 ? iSkin * (base.r / uSkinRef) : c < 2.5 ? iHair : c < 3.5 ? iHair * 0.6 : c < 4.5 ? iTop : iLegs;
vCls = c; vPatId = iPat; vObj = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPal; varying float vCls; varying float vPatId; varying vec3 vObj;
${PAT_GLSL}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( (vPatId > 0.5 && vCls > 3.5 && vCls < 4.5) ? oePattern(vPal, vObj, vPatId, vec3(-1.0)) : vPal, opacity );');
    };
    // the shadows walk too
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni, { uTime: U.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${pose}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = crowdPose(transformed, false);`);
    };
    return { mat, depth };
  }

  // Draws actors.crowd's pedestrians: a skinned person for the nearest few, an instance
  // of the character's low-detail copy for everyone else.
  // Each character's instances are kept packed (issue 352): the ones drawn this frame are the first mesh.count
  // slots, and only that range of the matrices and the gait is sent to the GPU. A walker that is not drawn (out
  // for the hour, near enough to be a skinned person, or out of the camera's sight by more than a shadow's
  // length) changes places with the last one drawn, their colours and all, so it costs no vertex work at all:
  // before, every slot was drawn every frame, the hidden ones as a model scaled to nothing, in the view and
  // again in the sun's shadow map, and every buffer was sent whole. camera: the view to cull against (none:
  // no culling).
  // real: the textured Rocketbox characters (the NPCs' cast, build_people.py --npcs) the nearest walkers are drawn
  // as, each the sex of their far figure, instead of the far crowd's own character close up: at eye level a
  // passer-by is a person, with the scanned face, hair and clothes the NPCs have (none: the far crowd's own)
  function crowdRenderer(world, lib, U, P, { near = 14, nearR = 32, style = null, camera = null, real = null, realHeight = null } = {}) {
    // a real person's height: the Japanese adult's mean (MHLW National Health and Nutrition Survey 2019: women
    // 1.58 m, men 1.71 m; a city may say otherwise in game.crowd.height) with the far figure's own spread
    const realScale = (rn, look) => {
      const w = lib.npcs[rn].sex === 'f', mean = realHeight ? realHeight[w ? 0 : 1] : w ? 1.58 : 1.71;
      return mean / (lib.npcs[rn].height_m || 1.75) * look.scale / (w ? 0.915 : 0.97);
    };
    const cast = (real || []).filter(n => lib.npcs && lib.npcs[n]);
    const bySex = { f: cast.filter(n => lib.npcs[n].sex === 'f'), m: cast.filter(n => lib.npcs[n].sex === 'm') };
    // a loaded cast member of rn's sex, to stand in until rn itself comes (begin, above)
    const realStandIn = rn => { const l = bySex[lib.npcs[rn].sex]; for (const n of l) if (lib.tpl[n]) return n; return null; };
    // load a few of the cast up front so the first near people are real, nearest the camera first as they stream
    if (cast.length) { bySex.f.slice(0, 2).concat(bySex.m.slice(0, 2)).forEach(n => lib.require(n)); }
    const realOf = (() => {
      if (!cast.length) return () => null;
      return (i, look) => {
        const w = lib.info.characters[look.character] && lib.info.characters[look.character].pack === 'W';
        const list = bySex[w ? 'f' : 'm'].length ? bySex[w ? 'f' : 'm'] : cast;
        const h = Math.imul(i + 1, 2654435761) >>> 0;
        return list[h % list.length];
      };
    })();
    const groups = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), ball = new THREE.Sphere(at, 30), camAt = new THREE.Vector3(1e9, 0, 0);
    let culling = false;
    const SWAP = ['iSkin', 'iHair', 'iTop', 'iLegs', 'iPat', 'aAnim', 'iUmb'];
    function swap(mesh, a, b) {
      const who = mesh.userData.who, pa = who[a], pb = who[b];
      who[a] = pb; who[b] = pa; pa.slot = b; pb.slot = a;
      const M = mesh.instanceMatrix.array;
      for (let k = 0; k < 16; k++) { const t = M[a * 16 + k]; M[a * 16 + k] = M[b * 16 + k]; M[b * 16 + k] = t; }
      for (const name of SWAP) {
        const A = mesh.geometry.attributes[name], n = A.itemSize, D = A.array;
        for (let k = 0; k < n; k++) { const t = D[a * n + k]; D[a * n + k] = D[b * n + k]; D[b * n + k] = t; }
      }
      mesh.userData.swapped = true;
    }
    // into the drawn range, or out of it
    function show(p) { const m = p.mesh; if (p.slot >= m.count) { if (p.slot !== m.count) swap(m, p.slot, m.count); m.count++; } }
    function unshow(p) { const m = p.mesh; if (p.slot < m.count) { if (p.slot !== m.count - 1) swap(m, p.slot, m.count - 1); m.count--; } }
    for (const p of P) {
      p.look = randomLook(lib, pickCharacter(lib, style), style);
      const gs = lib.info.ground_speed[lib.info.characters[p.look.character].pack].Walk, ex = lib.lod[p.look.character].extras;
      p.speed = gs * p.look.scale * (0.95 + rnd() * 0.25);
      p.thigh = (ex.hip[0] - ex.knee[0]) * p.look.scale; // how far the body drops when sitting
      (groups[p.look.character] = groups[p.look.character] || []).push(p);
    }
    const meshes = [];
    for (const [name, ps] of Object.entries(groups)) {
      const L = lib.lod[name], geo = L.geometry.clone(), n = ps.length;
      for (const a of ['iSkin', 'iHair', 'iTop', 'iLegs', 'aAnim']) geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('iPat', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('iUmb', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
      const { mat, depth } = crowdMaterial(L.extras, U);
      litMaterial(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.customDepthMaterial = depth;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      geo.attributes.aAnim.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.who = ps.slice(); // the walker in each slot
      mesh.userData.slots = n;
      mesh.count = 0;                 // (none drawn until placed)
      ps.forEach((p, k) => {
        p.mesh = mesh; p.slot = k;
        geo.attributes.iPat.setX(k, PAT[p.look.pattern] || 0);
        for (const [a, key] of [['iSkin', 'skin'], ['iHair', 'hair'], ['iTop', 'top'], ['iLegs', 'legs']]) { const c = lin(p.look[key]); geo.attributes[a].setXYZ(k, c.r, c.g, c.b); }
      });
      mesh.userData.noRefl = true; // (out of the sea's reflection: water.js)
      world.add(mesh);
      meshes.push(mesh);
    }
    // umbrellas for the rain: each person's own colour (Tokyo carries clear vinyl), and whether they
    // put one up in a drizzle (some don't bother) or only when it really rains
    const UMB = (styleOf(style) || STYLE || {}).umbrellas || ['#1d1f26', '#1d1f26', '#22304a', '#2f3b33', '#5a1f2b', '#7b8794', '#c9b28a', '#2b4a6b'];
    let us = 977; // (its own random run, so the crowd's looks and pace stay as they were without it)
    const urnd = () => ((us = (us * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const p of P) { p.umbK = urnd(); p.look.umbrella = UMB[Math.floor(urnd() * UMB.length)]; }
    // the far crowd's umbrellas: the canopy and its shaft, held as the near people hold theirs
    // (umbrellaHold), laid out from the crowd's mean shoulder; each drawn with the body's own matrix
    const shoulder = [0, 0];
    for (const p of P) { const e = lib.lod[p.look.character].extras.shoulder; shoulder[0] += e[0] / P.length; shoulder[1] += e[1] / P.length; }
    const hold = umbrellaHold(V3(0, shoulder[0] + 0.16, shoulder[1]));
    const umbGeo = canopyGeo().applyQuaternion(hold.q).translate(hold.top.x, hold.top.y, hold.top.z);
    const shaftGeo = new THREE.CylinderGeometry(0.01, 0.01, UMB_LEN, 5).translate(0, -UMB_LEN / 2, 0).applyQuaternion(hold.q).translate(hold.top.x, hold.top.y, hold.top.z);
    const umbMeshes = {}, umbN = { true: 0, false: 0, shaft: 0 };
    const umbCol = P.map(p => lin(p.look.umbrella === 'clear' ? '#1d1f26' : p.look.umbrella));
    const umbMesh = clear => umbMeshes[clear] || (umbMeshes[clear] = (() => {
      const shaft = clear === 'shaft';
      const m = new THREE.InstancedMesh(shaft ? shaftGeo : umbGeo, shaft ? stdMat('#2a2a2e') : clear ? stdMat('clear') : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }), P.length);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // (packed, as the crowd is: the umbrellas held this frame are the first `count` slots, each with its holder's
      // colour; nothing is drawn for those not held, and only the slots taken go to the GPU: issue 375)
      if (!clear) { m.setColorAt(0, umbCol[0]); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.count = 0;
      m.castShadow = clear !== true; m.frustumCulled = false; m.visible = false; m.userData.noRefl = true;
      world.add(m);
      return m;
    })());
    const UMB_KEYS = [true, false, 'shaft'];
    let rain = 0, umbOn = false;
    const wantUmb = p => UMBRELLAS && rain > 0.06 && p.mode !== 'sit' && p.umbK < 0.3 + 0.62 * Math.min(1, (rain - 0.06) / 0.5);
    const free = {}, active = new Map();
    let dtNow = 0, tNow = 0;
    function begin(dt, cx, cy, t, nActive) {
      dtNow = dt; tNow = t;
      umbN.true = umbN.false = umbN.shaft = 0;
      // the camera's frustum as it was last drawn, for this frame's culling; not across a cut (the camera somewhere else)
      culling = false;
      if (camera) {
        culling = camera.position.distanceToSquared(camAt) < 400;
        camAt.copy(camera.position);
        frustum.setFromProjectionMatrix(vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
      }
      // who is a person and who a far figure goes by what the eye resolves: the distance from the camera (not from
      // the player, who stands 6 m in front of it: the far figures were being drawn at the lens while people behind
      // the player were given faces), and those in the view first, since a face behind the camera is seen by no one.
      // On a crowded crossing the few skinned people there are go where they are looked at.
      const want = [], ex = camera ? camera.position.x : cx, ey = camera ? -camera.position.z : cy;
      for (let i = 0; i < nActive; i++) {
        const p = P[i]; if (p.line < 0) continue;
        const d = Math.hypot(p.x - ex, p.y - ey);
        if (d >= nearR) continue;
        const seen = !culling || frustum.intersectsSphere(ball.set(at.set(p.x, p.z + 1, -p.y), 1.5));
        want.push([seen ? d : d + nearR, i]);
      }
      ball.radius = 30;
      want.sort((a, b) => a[0] - b[0]);
      const keep = new Set(want.slice(0, near).map(w => w[1]));
      for (const [i, r] of active) if (!keep.has(i)) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
      for (const i of keep) {
        if (active.has(i)) continue;
        const p = P[i], rn = realOf(i, p.look);
        let look = rn ? Object.assign({}, p.look, { character: rn, pattern: null, scale: realScale(rn, p.look) }) : p.look, name = look.character;
        // a real near person whose character is still streaming stands in as a loaded cast member of the same sex,
        // not the far crowd's doll: at the hero spawn a dense crowd reads as real at once, and swaps to its own
        // character when it comes (begin() runs again as the player moves)
        if (rn && !lib.tpl[name]) { lib.require(name); const si = realStandIn(rn); if (si) { look = Object.assign({}, p.look, { character: si, pattern: null, scale: realScale(si, p.look) }); name = si; } }
        if (!lib.tpl[name]) { lib.require(name); continue; }
        const r = (free[name] && free[name].pop()) || person(lib, Object.assign({}, look));
        r.setLook(Object.assign({ pattern: null, pattern2: null, acc: null }, look));
        r.umbOn = false;
        world.add(r.root);
        active.set(i, r);
      }
    }
    function place(i, p, moving) {
      const r = active.get(i);
      if (r) {
        const u = wantUmb(p);
        if (u !== !!r.umbOn) { r.umbOn = u; r.setLook({ acc: u ? [...(p.look.acc || []), 'umbrella_open'] : p.look.acc || null }); }
        unshow(p);
        r.root.position.set(p.x, p.z, -p.y);
        r.root.rotation.y = Math.PI - p.h;
        if (p.wave) { p.wave = false; r.wave(tNow); }
        r.animate(dtNow, moving ? Math.max(0.2, p.av ?? p.v ?? p.speed) : 0, p.mode === 'sit' ? 'sit' : 'ground', tNow);
        return;
      }
      p.wave = false;
      const sit = p.mode === 'sit';
      at.set(p.x, p.z - (sit ? p.thigh : 0), -p.y);
      // out of sight by more than the longest shadow reaches back into it: not drawn (30 m: a sun 4 degrees up)
      if (culling && (!frustum.intersectsSphere(ball) || (window.OEVis && !OEVis.seenNext(at.x, -at.z, at.y + 2.3, 2.3)))) { unshow(p); return; } // (or behind the street wall: visibility.js)
      show(p);
      q.setFromAxisAngle(UP, Math.PI - p.h);
      sc.setScalar(p.look.scale);
      m4.compose(at, q, sc);
      p.mesh.setMatrixAt(p.slot, m4);
      const held = umbOn && wantUmb(p);
      if (held) {
        const clear = p.look.umbrella === 'clear', c = umbMesh(clear), k = umbN[clear]++;
        c.setMatrixAt(k, m4);
        if (!clear) c.setColorAt(k, umbCol[i]);
        umbMesh('shaft').setMatrixAt(umbN.shaft++, m4);
      }
      const ua = p.mesh.geometry.attributes.iUmb;
      if (ua.getX(p.slot) !== (held ? 1 : 0)) { ua.setX(p.slot, held ? 1 : 0); ua.needsUpdate = true; }
      // the cadence follows the speed; when it changes, shift the phase so the stride doesn't jump
      const f = moving ? 4.5 * Math.max(0.2, p.av ?? p.v ?? p.speed) / p.look.scale : p.animF ?? 4.5 * p.speed / p.look.scale;
      if (p.animF == null) { p.animF = f; p.animO = p.phase; }
      else if (Math.abs(f - p.animF) > 0.02 * p.animF) { p.animO += (p.animF - f) * tNow; p.animF = f; }
      p.mesh.geometry.attributes.aAnim.setXYZ(p.slot, p.animO, p.animF, sit ? -1 : moving ? 0.42 : 0);
    }
    function hide(i) {
      const p = P[i];
      unshow(p);
      const r = active.get(i);
      if (r) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
    }
    // what changed, to the GPU: the drawn range of the matrices and the gait, and after a change of places the colours too
    const range = (a, n) => { if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); } a.needsUpdate = true; };
    function end() {
      for (const m of meshes) {
        const A = m.geometry.attributes, moved = m.userData.swapped;
        m.userData.swapped = false;
        if (moved) { for (const name of SWAP) { if (A[name].clearUpdateRanges) A[name].clearUpdateRanges(); A[name].needsUpdate = true; } m.instanceMatrix.clearUpdateRanges && m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.needsUpdate = true; continue; }
        if (!m.count) continue;
        range(m.instanceMatrix, m.count); range(A.aAnim, m.count);
      }
      for (const c of UMB_KEYS) {
        const m = umbMeshes[c];
        if (!m || !m.visible) continue;
        m.count = umbN[c];
        if (m.count) { range(m.instanceMatrix, m.count); if (m.instanceColor) range(m.instanceColor, m.count); }
      }
    }
    // the rain, 0..1 (weather.js): umbrellas go up as it comes on
    function setRain(r) {
      rain = r;
      const on = UMBRELLAS && r > 0.06;
      if (on === umbOn) return;
      umbOn = on;
      for (const c of UMB_KEYS) { const m = umbMesh(c); m.visible = on; if (!on) m.count = 0; }
    }
    return { begin, place, hide, end, setRain, meshes, active, umbrellas: umbMeshes };
  }

  return { load, person, randomLook, pickCharacter, crowdRenderer, colours, setStyle, setLight };
})();
