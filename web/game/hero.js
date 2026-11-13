// A hero level: a small piece of a map (a street, a crossing, a square: some 200-300 m across) modelled
// finely in Blender, drawn over the city's own model there when the player is near it, and gone again
// when they leave, so that the rest of the map and a phone's memory pay nothing for it.
//
// A map names its hero levels in city.json game.hero (copied into game.json by pipeline/game_text.py):
//   "hero": [{"id": "kabukicho", "glb": "hero/kabukicho.glb", "at": [x, y], "r": 140,
//             "hide": ["kbhero_kb_atlas", ...],       // landmark meshes it draws instead, hidden while it is shown
//             "bake": 1.0, "glow": [0.35, 1.6],       // its baked night light's gain; its signs' glow by day and by night
//             "street": 0.4}]                         // the share of the city's street lights it takes (its own are baked)
// The model is built in the city's local frame (blender/build_hero.py: x east, y north, z up, which glTF
// carries as three.js's x, z, -y, as the game draws every local point) and meshopt-compressed.
//
// What its materials mean, by the name they are given in Blender (blender/hero_kit.py):
//   every material   the street lights after dark (world.js streetLit), the sun's shadow, the rain (weather.js
//                    dress) and, on the high tier, a wet street's reflection (mirror.js) for what is ground;
//                    and the light baked into its vertices (_BAKE: rgb the night light the signs and shop fronts
//                    throw on it, a the occlusion of the street's corners), taken with its own colour
//   glow*            a lit sign or a shop front's light box: its emissive drawn by day at glow[0] and after
//                    dark at glow[1], so it blooms at night as a lit sign does in a photograph
//   tube*            neon tubes: as glow, and a tube in a few hundred hums and stutters now and then
//   chase*           the bulbs of an arch or a marquee: as glow, running in a chase along the u of its texture
//   win*             windows: dark glass by day, lit after dark where its emissive map says a room is lit
//   ground*          what you walk or drive on: wet in the rain, and a mirror then on the high tier
//
// It is loaded when the camera comes within r + LOAD_M of its centre and let go (its GPU memory freed) past
// r + DROP_M. On the low tier (phones) it goes without its normal and roughness maps, and its other textures
// are halved (on a phone's lean sub-tier, no side over 1024) before they are sent to the GPU (docs/HERO.md).
'use strict';
window.OEHero = (function () {
  const LOAD_M = 260, DROP_M = 520, SHOW_M = 420;

  // the baked light (_BAKE) and the glow's hum, in every material of a hero model
  const BAKE_V = `attribute vec4 _bake;\nvarying vec4 vHeroBake;\n`;
  const BAKE_F = `varying vec4 vHeroBake;\nuniform float uHeroBake, uHeroNight;\n`;

  function create(Wd, renderer, opts) {
    const THREE = window.THREE, list = Array.isArray(opts.hero) ? opts.hero : opts.hero ? [opts.hero] : [];
    const tier = opts.tier || 'high', base = opts.base || '', U = Wd.U;
    const group = new THREE.Group();
    group.name = 'hero';
    Wd.world.add(group);
    const levels = list.map(h => ({ h, state: 'idle', root: null, mats: [], tubes: [], chases: [], hidden: [] }));
    const uBake = { value: 1 }, uStreet = { value: 1 }, uNight = U && U.uNight ? U.uNight : { value: 0 };

    // a hero material, patched once: its baked light and occlusion, then the city's street lights
    function patch(m, h) {
      const name = (m.name || '').toLowerCase(), own = m.onBeforeCompile;
      m.vertexColors = false; // (its _BAKE is read here, not as a vertex colour)
      if (m.userData.tint) m.color.setRGB(...m.userData.tint); // (a texture's tint, the building's colour: Blender's extras)
      m.onBeforeCompile = (sh, r) => {
        if (own) own.call(m, sh, r);
        sh.uniforms.uHeroBake = uBake; sh.uniforms.uHeroNight = uNight;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${BAKE_V}`)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHeroBake = _bake;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${BAKE_F}`)
          // the occlusion of corners and soffits on the light from the sky, never on the sun or the lamps
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= mix(1.0, vHeroBake.a, 0.85); reflectedLight.indirectSpecular *= vHeroBake.a;')
          // the signs' and shop fronts' light on it after dark, in its own colour (an irradiance, baked)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vHeroBake.rgb * uHeroBake * uHeroNight;');
        // the city's street lights, at the share the level asks (h.street): its own lamps and signs are baked in
        if (Wd.streetLit && !/^(glow|tube|chase)/.test(name)) {
          Wd.streetLit(sh);
          sh.uniforms.uHeroStreet = uStreet;
          sh.fragmentShader = sh.fragmentShader.replace('uniform float uHeroBake, uHeroNight;', 'uniform float uHeroBake, uHeroNight, uHeroStreet;')
            .replace('* streetLight(', '* uHeroStreet * streetLight(');
        }
      };
      m.customProgramCacheKey = () => `hero|${h.id}|${name}|${own ? 'o' : ''}`;
      if (/^ground/.test(name)) m.userData.paving = true;
      if (/^(glow|tube|chase)/.test(name)) { m.userData.oeDry = true; m.userData.heroGlow = m.emissiveIntensity || 1; }
      m.needsUpdate = true;
    }

    // a texture made smaller on the low tier before it reaches the GPU: halved, or on a phone's lean sub-tier no
    // side over 1024. Resized by createImageBitmap where it can (no full-size canvas copy, which is tens of MB of
    // passing CPU memory on a phone), else through a canvas that is shrunk to nothing once it is uploaded.
    const lean = () => { try { const q = window.OEQuality && OEQuality.city && OEQuality.city(); return !!(q && q.lean); } catch (e) { return false; } };
    async function shrink(tex, done) {
      const img = tex && tex.image;
      if (!img || !img.width || img.width <= 256 || tex.userData.heroHalved) return;
      if (done.has(img)) { const o = await done.get(img); if (o) { tex.image = o; tex.userData.heroHalved = true; tex.needsUpdate = true; } return; }
      let fin; done.set(img, new Promise(r => { fin = r; }));
      const k = lean() ? Math.min(0.5, 1024 / Math.max(img.width, img.height)) : 0.5;
      const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      let out = null;
      if (window.createImageBitmap) {
        try { out = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium', imageOrientation: tex.flipY ? 'flipY' : 'from-image' }); } catch (e) { out = null; }
        if (out && tex.flipY) tex.flipY = false; // (flipped as it was made: an ImageBitmap ignores UNPACK_FLIP_Y)
      }
      if (!out) try {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        tex.onUpdate = () => { cv.width = cv.height = 1; tex.onUpdate = null; };
        out = cv;
      } catch (e) { console.warn('hero texture:', e); }
      fin(out);
      if (!out) return;
      if (img.close) img.close();
      tex.image = out; tex.userData.heroHalved = true; tex.needsUpdate = true;
    }

    function load(L) {
      L.state = 'loading';
      const t0 = performance.now();
      new THREE.GLTFLoader().load(base + L.h.glb, g => {
        if (L.state !== 'loading') { dispose(g.scene); return; } // (let go while it came)
        const root = g.scene, seen = new Set(), shrunk = [];
        root.name = `hero-${L.h.id}`;
        root.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = !/nocast/i.test(o.name); o.receiveShadow = true;
          o.matrixAutoUpdate = false; o.updateMatrix();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m || seen.has(m)) continue;
            seen.add(m); L.mats.push(m);
            // on the low tier (phones): no normal or roughness maps (the surface's own roughness instead), the rest halved
            if (tier === 'low') {
              for (const k of ['normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) { m[k].dispose(); m[k] = null; }
              for (const k of ['map', 'emissiveMap', 'aoMap']) if (m[k] && !shrunk.includes(m[k])) shrunk.push(m[k]);
            }
            patch(m, L.h);
            const n = (m.name || '').toLowerCase();
            if (/^tube/.test(n)) L.tubes.push({ m, seed: Math.random() * 1000, off: 0 });
            if (/^chase/.test(n) && m.emissiveMap) { m.emissiveMap = m.emissiveMap.clone(); m.emissiveMap.wrapS = THREE.RepeatWrapping; m.emissiveMap.needsUpdate = true; L.chases.push(m); }
            if (opts.mirror && /^ground/.test(n)) opts.mirror.patch(m);
          }
        });
        root.updateMatrixWorld(true);
        if (Wd.still) Wd.still(root); // (its shadow cached with the city's: world.js shadowCache)
        root.visible = false;
        group.add(root);
        L.root = root;
        const ready = Promise.all(shrunk.map((t, i, a) => shrink(t, a.done || (a.done = new Map())))).then(() => L.root === root && opts.warm ? opts.warm(root) : null);
        Promise.resolve(ready).catch(e => console.warn('hero warm-up:', e)).then(() => {
          if (L.root !== root) return;
          L.state = 'ready';
          console.info(`hero ${L.h.id}: ${L.mats.length} materials, ready in ${Math.round(performance.now() - t0)} ms`);
        });
      }, undefined, e => { console.warn(`hero ${L.h.id} unavailable:`, e); L.state = 'failed'; });
    }

    function dispose(root) {
      root.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      });
    }

    function drop(L) {
      if (L.root) { group.remove(L.root); dispose(L.root); }
      showHidden(L, true);
      Object.assign(L, { state: 'idle', root: null, mats: [], tubes: [], chases: [] });
    }

    // the city's own landmark meshes the hero level draws instead, hidden while it is shown
    function showHidden(L, on) {
      if (!L.hidden.length) L.hidden = (L.h.hide || []).map(n => Wd.world.getObjectByName(n)).filter(Boolean);
      for (const o of L.hidden) o.visible = on;
    }

    let t = 0;
    function update(camera, dt) {
      t += dt || 0;
      const cx = camera.position.x, cy = -camera.position.z, night = uNight.value;
      for (const L of levels) {
        const d = Math.hypot(cx - L.h.at[0], cy - L.h.at[1]) - (L.h.r || 150);
        if (L.state === 'idle' && d < LOAD_M) load(L);
        else if ((L.state === 'ready' || L.state === 'loading') && d > DROP_M) drop(L);
        else if (L.state === 'failed' && d > DROP_M) L.state = 'idle';
        if (L.state !== 'ready') continue;
        const show = d < SHOW_M;
        if (L.root.visible !== show) { L.root.visible = show; showHidden(L, !show); }
        if (!show) continue;
        uBake.value = L.h.bake == null ? 1 : L.h.bake;
        uStreet.value = L.h.street == null ? 1 : L.h.street;
        const [gd, gn] = L.h.glow || [0.35, 1.6], k = gd + (gn - gd) * night;
        for (const m of L.mats) if (m.userData.heroGlow != null) m.emissiveIntensity = m.userData.heroGlow * k;
        // a tube or two stutters: off for a few frames, now and then
        for (const tb of L.tubes) {
          const s = Math.sin(t * 0.37 + tb.seed) * Math.sin(t * 1.13 + tb.seed * 0.7);
          tb.m.emissiveIntensity *= s > 0.985 ? (Math.sin(t * 61 + tb.seed) > 0 ? 0.15 : 1) : 1;
        }
        for (const m of L.chases) m.emissiveMap.offset.x = (Math.floor(t * 6) % 8) / 8 * (1 / 8);
      }
    }

    return {
      group, levels, update,
      // (for the harnesses: whether each is loaded and shown, tools/game_check.js)
      state: () => levels.map(L => ({ id: L.h.id, state: L.state, shown: !!(L.root && L.root.visible), materials: L.mats.length })),
    };
  }

  return { create };
})();
