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
  const stdMat = hex => MAT[hex] || (MAT[hex] = new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.75, metalness: 0, side: THREE.DoubleSide }));
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
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
  async function load(base, { onMsg } = {}) {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) throw new Error('GLTFLoader is not available');
    const L = new THREE.GLTFLoader();
    const get = u => new Promise((res, rej) => L.load(base + u, res, null, rej));
    const info = await (await fetch(base + 'people.json')).json();
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
      lib.tpl[name] = { scene: g.scene, extras: mesh.userData, pack: info.characters[name].pack };
      if (onMsg) onMsg(name);
      return lib.tpl[name];
    }));
    lib.names = Object.keys(info.characters);
    // the main characters (blender/build_people.py): textured, with their own clips and skeleton
    const H = info.heroes || {}, plain = lib.require;
    lib.heroes = H.characters || {};
    // the NPCs (build_people.py --npcs): textured too, on the same skeleton, sharing one file of clips per sex
    const NP = info.npcs || {};
    lib.npcs = NP.characters || {};
    const clipsOf = sex => lib.loading[`clips:${sex}`] || (lib.loading[`clips:${sex}`] = get(NP.clips[sex].file).then(g => g.animations));
    lib.require = name => {
      const h = lib.heroes[name], c = lib.npcs[name];
      if (c) {
        return lib.loading[name] || (lib.loading[name] = Promise.all([get(c.file), clipsOf(c.sex)]).then(([g, clips]) => {
          lib.tpl[name] = { scene: g.scene, textured: true, clips, speeds: NP.clips[c.sex].ground_speed, bones: NP.bones || {} };
          if (onMsg) onMsg(name);
          return lib.tpl[name];
        }));
      }
      if (!h) return plain(name);
      return lib.loading[name] || (lib.loading[name] = get(h.file).then(g => {
        lib.tpl[name] = { scene: g.scene, textured: true, clips: g.animations, speeds: h.ground_speed, bones: H.bones || {} };
        if (onMsg) onMsg(name);
        return lib.tpl[name];
      }));
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
    if (T.textured) model.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    else {
      mesh.material = paletteMaterial(colours(T.extras, look), T.extras.classes.map(c => CLS[c] || 0));
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
      const ids = [...(look.acc || []), ...((act[look.clip] && CLIP_ACC[look.clip]) || [])];
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
        for (const m of a.build(mk, anchor, grip[bn], look, !!headFit)) {
          if (fit) { m.position.sub(anchor).multiply(fit.s).add(anchor); m.scale.multiply(fit.s); }
          grp.add(m);
        }
        grp.matrixAutoUpdate = false;
        grp.matrix.copy(ref[bn].inv);
        bones[bn].add(grp);
        accObjs.push(grp);
      }
    }
    function play(name, fade = 0.25, once = false) {
      const a = act[name];
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
      model.position.y = drop / (root.parent ? root.parent.getWorldScale(sb).y : 1);
      if (!rig.reach || !reaches) return;
      // hands on the wheel: each elbow a little down and out from halfway, the hand at the rim
      root.updateWorldMatrix(false, true);
      const side = r1.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(rq));
      for (const a of arms) {
        const hand = r2.copy(rig.reach).addScaledVector(side, 0.16 * a.s), sh = a.ua.getWorldPosition(r3);
        const elbow = r4.copy(sh).lerp(hand, 0.5).addScaledVector(side, 0.09 * a.s);
        elbow.y -= 0.1;
        aim(a.ua, a.la, elbow.sub(sh).normalize());
        aim(a.la, a.wr, hand.sub(a.la.getWorldPosition(r3)).normalize());
      }
    }
    rig.wave = (t = 0) => { waveUntil = t + act.Wave.getClip().duration * 0.95; play('Wave', 0.2, true); };
    // a view through this person's eyes: the head, and whatever is on it, shrinks out of the way
    rig.hideHead = on => { if (head) head.scale.setScalar(on ? 1e-3 : 1); };
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
      else if (act.Sprint && speed > 5.2) play('Sprint', 0.2).setEffectiveTimeScale(Math.max(0.7, Math.min(1.6, speed / (speeds.Sprint * s))));
      else play('Run', 0.2).setEffectiveTimeScale(Math.max(0.6, Math.min(2.4, speed / (speeds.Run * s)))); // up to the 7 m/s sprint
      if (mode !== 'sit') feetBack();
      mixer.update(dt);
      if (mode === 'sit') seat();
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
attribute float mat; attribute float part; attribute vec3 aAnim;
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
  if (arm) { piv = vec3(0.0, uShoulder); p = isNormal ? rx(-sw * side * 0.8) * p : rx(-sw * side * 0.8) * (p - piv) + piv; }
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
  function crowdRenderer(world, lib, U, P, { near = 14, nearR = 32, style = null } = {}) {
    const groups = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
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
      const { mat, depth } = crowdMaterial(L.extras, U);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.customDepthMaterial = depth;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      geo.attributes.aAnim.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      ps.forEach((p, k) => {
        p.mesh = mesh; p.slot = k;
        geo.attributes.iPat.setX(k, PAT[p.look.pattern] || 0);
        for (const [a, key] of [['iSkin', 'skin'], ['iHair', 'hair'], ['iTop', 'top'], ['iLegs', 'legs']]) { const c = lin(p.look[key]); geo.attributes[a].setXYZ(k, c.r, c.g, c.b); }
      });
      world.add(mesh);
      meshes.push(mesh);
    }
    const free = {}, active = new Map();
    let dtNow = 0, tNow = 0;
    function begin(dt, cx, cy, t, nActive) {
      dtNow = dt; tNow = t;
      const want = [];
      for (let i = 0; i < nActive; i++) { const p = P[i]; if (p.line < 0) continue; const d = Math.hypot(p.x - cx, p.y - cy); if (d < nearR) want.push([d, i]); }
      want.sort((a, b) => a[0] - b[0]);
      const keep = new Set(want.slice(0, near).map(w => w[1]));
      for (const [i, r] of active) if (!keep.has(i)) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
      for (const i of keep) {
        if (active.has(i)) continue;
        const p = P[i], name = p.look.character;
        if (!lib.tpl[name]) { lib.require(name); continue; }
        const r = (free[name] && free[name].pop()) || person(lib, Object.assign({}, p.look));
        r.setLook(Object.assign({ pattern: null, pattern2: null, acc: null }, p.look));
        world.add(r.root);
        active.set(i, r);
      }
    }
    function place(i, p, moving) {
      const r = active.get(i);
      if (r) {
        p.mesh.setMatrixAt(p.slot, zero);
        r.root.position.copy(W(p.x, p.y, p.z));
        r.root.rotation.y = Math.PI - p.h;
        if (p.wave) { p.wave = false; r.wave(tNow); }
        r.animate(dtNow, moving ? p.v ?? p.speed : 0, p.mode === 'sit' ? 'sit' : 'ground', tNow);
        return;
      }
      p.wave = false;
      const sit = p.mode === 'sit';
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - p.h);
      sc.setScalar(p.look.scale);
      m4.compose(W(p.x, p.y, p.z - (sit ? p.thigh : 0)), q, sc);
      p.mesh.setMatrixAt(p.slot, m4);
      // the cadence follows the speed; when it changes, shift the phase so the stride doesn't jump
      const f = moving ? 4.5 * (p.v ?? p.speed) / p.look.scale : p.animF ?? 4.5 * p.speed / p.look.scale;
      if (p.animF == null) { p.animF = f; p.animO = p.phase; }
      else if (Math.abs(f - p.animF) > 0.02 * p.animF) { p.animO += (p.animF - f) * tNow; p.animF = f; }
      p.mesh.geometry.attributes.aAnim.setXYZ(p.slot, p.animO, p.animF, sit ? -1 : moving ? 0.42 : 0);
    }
    function hide(i) {
      const p = P[i];
      p.mesh.setMatrixAt(p.slot, zero);
      const r = active.get(i);
      if (r) { world.remove(r.root); (free[r.character] = free[r.character] || []).push(r); active.delete(i); }
    }
    function end() {
      for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aAnim.needsUpdate = true; }
    }
    return { begin, place, hide, end, meshes, active };
  }

  return { load, person, randomLook, pickCharacter, crowdRenderer, colours, setStyle };
})();
