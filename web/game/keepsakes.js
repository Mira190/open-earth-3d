// The keepsakes you have bought, on a shelf in a room (issue 419): what the diary's album lists (jobs.js "album",
// one for every city), set out as small models on a room's shelf, each with a folded card that says what it is and
// where it came from. A room offers its shelf in game.json "interiors" ("keepsakes": {slots: [[x, y, z, heading]],
// ...}: Queenstown's Williams Cottage, cities/queenstown/interiors.py keepsake_shelf), and a spot looks along it
// closer (places.js closer), whose texts are filled in here from the album.
//
// Each keepsake a counter sells (life.json shops[].menu[], "keep") has its own model, made here at its real size
// from three.js primitives: a hand-high torii, a fox ema, a Kiyomizu-yaki cup, a chopstick rest with its chopsticks,
// a piece of sea glass, a folding fan, an enamel steamer pin on its card, a brass Akita charm, a kumade, a tin ferry,
// a folded tenugui and a station stamp book open at a stamp. One it has no model for is a paulownia box with the
// glyph on its lid. They are made once the room is near, and lit as the room is: the sky's share inside (as
// world.js's sheltered landmark meshes), and warm after dark, as the room's lamps light its walls.
// Runs on three.js r128 and r186: nothing version-specific (colorSpace or encoding, whichever there is).
'use strict';
window.OEKeeps = (function () {
  const NEAR = 45;             // made when you are this near the shelf (m), and drawn only then
  const SKY = 0.5;             // the share of the sky the room sees (Williams Cottage's, interiors.py Room)
  const srgb = t => { if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; };

  function create(L) {
    const ctx = L.ctx, G = ctx.G || {};
    const room = (G.interiors || []).find(r => r.keepsakes && r.keepsakes.slots && r.keepsakes.slots.length);
    if (!room || !ctx.world) return null;
    const K = room.keepsakes, spot = (G.spots || []).find(s => s.keepsakes);
    let group = null, shown = '', glowK = -1;
    const mats = [];
    // a material lit as the room is: the sky's share of the ambient light, warm light off the floor, and a warm glow
    // after dark (its share of the colour, as the room's floodlit plaster)
    function mat(o) {
      const p = Object.assign({ roughness: 0.6, metalness: 0 }, o);
      delete p.glow; delete p.emissiveColor;
      const m = new THREE.MeshStandardMaterial(p);
      if (o.map) srgb(o.map);
      m.userData.glow = o.glow != null ? o.glow : 0.1;
      m.emissive = new THREE.Color(o.emissiveColor || o.color || 0xffffff);
      if (o.map && !o.emissiveColor) { m.emissiveMap = o.map; m.emissive.set(0xffffff); }
      m.emissiveIntensity = 0;
      m.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
          `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= ${SKY.toFixed(2)} * vec3(1.12, 1.0, 0.86); reflectedLight.indirectSpecular *= ${SKY.toFixed(2)};`);
      };
      m.customProgramCacheKey = () => 'keepsake';
      mats.push(m);
      return m;
    }
    const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };
    const mesh = (geo, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = false; o.receiveShadow = true; parent.add(o); return o; };
    // an extruded outline with its front face mapped to the outline's bounding box (a printed or painted face)
    function plate(shape, depth, bevel = 0.0008) {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 18 });
      g.computeBoundingBox();
      const b = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
      uv.needsUpdate = true;
      return g;
    }
    const lathe = (pts, segs = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
    const tube = (pts, r, segs = 24, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), closed), segs, r, 6, closed);

    // ---------------------------------------------------------------- the models: +y up, facing +z, standing on y = 0
    const M = {};
    const lazy = (k, f) => () => M[k] || (M[k] = f());
    const C = {
      vermilion: lazy('vermilion', () => mat({ color: '#d2432a', roughness: 0.45 })),
      lacquer: lazy('lacquer', () => mat({ color: '#141212', roughness: 0.25 })),
      wood: lazy('wood', () => mat({ color: '#c9a77a', roughness: 0.7 })),
      darkwood: lazy('darkwood', () => mat({ color: '#5a3a24', roughness: 0.55 })),
      brass: lazy('brass', () => mat({ color: '#c9a050', roughness: 0.28, metalness: 0.92, glow: 0.02 })),
      gold: lazy('gold', () => mat({ color: '#e2b84c', roughness: 0.22, metalness: 1, glow: 0.02 })),
      red: lazy('red', () => mat({ color: '#b3202a', roughness: 0.8 })),
      white: lazy('white', () => mat({ color: '#f3efe6', roughness: 0.75 })),
      straw: lazy('straw', () => mat({ color: '#cfb36b', roughness: 0.9 })),
      bamboo: lazy('bamboo', () => mat({ color: '#d8c08a', roughness: 0.5 })),
      linen: lazy('linen', () => mat({ color: '#e7e0d0', roughness: 0.95 })),
      card: lazy('card', () => mat({ color: '#f1ead9', roughness: 0.85 })),
      walnut: lazy('walnut', () => mat({ color: '#4a2f1d', roughness: 0.42 })),
      felt: lazy('felt', () => mat({ color: '#2f3b33', roughness: 1 })),
    };
    let plinthG = null, feltG = null;
    const PLINTH = () => plinthG || (plinthG = (() => { const s = new THREE.Shape(); const w = 0.07, d = 0.055, r = 0.006; s.moveTo(-w + r, -d); s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r); s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d); s.lineTo(-w + r, d); s.quadraticCurveTo(-w, d, -w, d - r); s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d); const g = new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 6 }); g.rotateX(-Math.PI / 2); g.translate(0, -0.009, 0); return g; })());
    const FELT = () => feltG || (feltG = new THREE.BoxGeometry(0.128, 0.001, 0.098));
    const models = {
      // a small torii, the height of a hand: two posts with black feet, the tie beam, the lintel with its upturned ends
      // (vermilion under a black top), the plaque between, on a plain board; a wish written on the post
      torii() {
        const o = new THREE.Group();
        mesh(new THREE.BoxGeometry(0.13, 0.008, 0.05), C.wood(), o, 0, 0.004, 0);
        for (const s of [-1, 1]) {
          const post = mesh(new THREE.CylinderGeometry(0.0055, 0.0065, 0.128, 16), C.vermilion(), o, s * 0.042, 0.072, 0);
          post.rotation.z = s * 0.035;
          mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 16), C.lacquer(), o, s * 0.0443, 0.014, 0);
        }
        mesh(new THREE.BoxGeometry(0.118, 0.0075, 0.0065), C.vermilion(), o, 0, 0.112, 0);     // the nuki
        mesh(new THREE.BoxGeometry(0.009, 0.016, 0.004), C.lacquer(), o, 0, 0.1235, 0.0012);    // the plaque
        // the lintel: shimaki and kasagi, one curved outline, rising to its tips
        const lin = (y0, h, half, lift) => { const s = new THREE.Shape(); s.moveTo(-half, y0 + lift); s.quadraticCurveTo(0, y0 - lift * 0.4, half, y0 + lift); s.lineTo(half + 0.002, y0 + lift + h); s.quadraticCurveTo(0, y0 + h - lift * 0.4, -half - 0.002, y0 + lift + h); s.closePath(); return s; };
        const g1 = new THREE.ExtrudeGeometry(lin(0.1305, 0.0055, 0.071, 0.004), { depth: 0.008, bevelEnabled: false, curveSegments: 20 }); g1.translate(0, 0, -0.004);
        mesh(g1, C.vermilion(), o);
        const g2 = new THREE.ExtrudeGeometry(lin(0.136, 0.0045, 0.077, 0.0055), { depth: 0.0095, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 20 }); g2.translate(0, 0, -0.00475);
        mesh(g2, C.lacquer(), o);
        const wish = canvas(64, 256, (c, w, h) => { c.fillStyle = '#d2432a'; c.fillRect(0, 0, w, h); c.fillStyle = '#1b1210'; c.font = '34px serif'; c.textAlign = 'center'; '願成就'.split('').forEach((ch, i) => c.fillText(ch, w / 2, 60 + i * 52)); });
        const p = mesh(new THREE.PlaneGeometry(0.0075, 0.03), mat({ color: '#ffffff', map: wish, roughness: 0.5 }), o, 0.0425, 0.07, 0.0064);
        p.rotation.z = 0.035;
        return o;
      },
      // a white wooden fox's face, as left at the shrine: two ears, the long muzzle, the features you draw yourself
      // (here: red eye lines and a black nose), on its red cord, leaning on a small block
      ema() {
        const o = new THREE.Group(), s = new THREE.Shape();
        s.moveTo(0, -0.045); s.quadraticCurveTo(0.012, -0.03, 0.026, -0.006); s.quadraticCurveTo(0.036, 0.008, 0.036, 0.022);
        s.lineTo(0.04, 0.048); s.quadraticCurveTo(0.03, 0.04, 0.018, 0.03); s.quadraticCurveTo(0, 0.034, -0.018, 0.03);
        s.quadraticCurveTo(-0.03, 0.04, -0.04, 0.048); s.lineTo(-0.036, 0.022); s.quadraticCurveTo(-0.036, 0.008, -0.026, -0.006); s.quadraticCurveTo(-0.012, -0.03, 0, -0.045);
        const face = canvas(256, 256, (c, w, h) => {
          c.fillStyle = '#f6f1e6'; c.fillRect(0, 0, w, h);
          c.fillStyle = 'rgba(200,60,50,0.55)'; [[60, 18], [196, 18]].forEach(([x, y]) => { c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.lineTo(x + (x < 128 ? 22 : -22), y + 50); c.fill(); });  // the ears' insides
          c.strokeStyle = '#c0281f'; c.lineWidth = 9; c.lineCap = 'round';
          c.beginPath(); c.moveTo(78, 112); c.quadraticCurveTo(100, 96, 118, 118); c.stroke();
          c.beginPath(); c.moveTo(178, 112); c.quadraticCurveTo(156, 96, 138, 118); c.stroke();
          c.strokeStyle = '#1c1715'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(84, 120); c.quadraticCurveTo(100, 112, 114, 124); c.stroke();
          c.beginPath(); c.moveTo(172, 120); c.quadraticCurveTo(156, 112, 142, 124); c.stroke();
          c.fillStyle = '#1c1715'; c.beginPath(); c.ellipse(128, 226, 11, 8, 0, 0, Math.PI * 2); c.fill();
          c.lineWidth = 2.5; [[-1, 0], [1, 0]].forEach(([s]) => { for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(128 + s * 26, 206 + k * 8); c.lineTo(128 + s * 70, 196 + k * 14); c.stroke(); } });
          c.fillStyle = '#c0281f'; c.font = 'bold 26px serif'; c.textAlign = 'center'; c.fillText('福', 128, 180);
        });
        const g = plate(s, 0.004);
        const fx = mesh(g, [mat({ color: '#ffffff', map: face, roughness: 0.7 }), C.white()], o, 0, 0.047, -0.004);
        fx.rotation.x = -0.18;
        mesh(new THREE.BoxGeometry(0.03, 0.012, 0.014), C.wood(), o, 0, 0.006, -0.016);
        mesh(tube([[-0.03, 0.09, -0.012], [-0.02, 0.105, -0.016], [0, 0.112, -0.018], [0.02, 0.105, -0.016], [0.03, 0.09, -0.012]], 0.0011, 20), C.red(), o);
        return o;
      },
      // a Kiyomizu-yaki cup: thin, pale blue, a foot ring left in the clay's own colour, one brushed line round it
      cup() {
        const o = new THREE.Group();
        const glaze = canvas(512, 128, (c, w, h) => {
          const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#b9d2db'); gr.addColorStop(0.75, '#9fc0cd'); gr.addColorStop(0.92, '#cbb79a'); gr.addColorStop(1, '#bba585');
          c.fillStyle = gr; c.fillRect(0, 0, w, h);
          c.strokeStyle = 'rgba(28,60,96,0.85)'; c.lineWidth = 7; c.lineCap = 'round';
          c.beginPath(); for (let x = 12; x < w - 30; x += 4) c.lineTo(x, 46 + Math.sin(x / 47) * 5 + Math.sin(x / 13) * 1.5); c.stroke();   // (the line that doesn't quite meet itself)
          for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h * 0.8, 2, 1); }
        });
        const pts = [[0.0, 0.0], [0.019, 0.0], [0.0205, 0.0015], [0.0205, 0.006], [0.024, 0.007], [0.033, 0.016], [0.0385, 0.033], [0.0405, 0.051], [0.0412, 0.058], [0.0398, 0.0586], [0.0385, 0.052], [0.0365, 0.034], [0.031, 0.019], [0.02, 0.0105], [0.0, 0.0095]];
        const g = lathe(pts.slice().reverse().map(([r, y]) => [r, y]), 64);
        // the lathe's v runs along the profile; flip it so the outside's top is the texture's top
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const v = uv.getY(i); uv.setY(i, v < 0.6 ? 1 - v / 0.6 : 0.02); }
        mesh(g, mat({ color: '#ffffff', map: glaze, roughness: 0.18, side: THREE.DoubleSide }), o);
        mesh(new THREE.CircleGeometry(0.0335, 40).rotateX(-Math.PI / 2), mat({ color: '#a8c6d1', roughness: 0.12 }), o, 0, 0.0115, 0);   // the tea well
        return o;
      },
      // a chopstick rest: a small glazed aubergine, its green calyx and stalk, a pair of lacquered chopsticks on it
      hashioki() {
        const o = new THREE.Group();
        const body = mesh(new THREE.SphereGeometry(0.012, 28, 18), mat({ color: '#3d1840', roughness: 0.12 }), o, 0.002, 0.0105, 0);
        body.scale.set(2.1, 0.9, 1);
        const neck = mesh(new THREE.SphereGeometry(0.0075, 20, 12), mat({ color: '#4a1d4c', roughness: 0.12 }), o, -0.021, 0.0115, 0);
        neck.scale.set(1.4, 1, 1);
        const green = mat({ color: '#4e6a2c', roughness: 0.4 });
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * Math.PI * 2, leaf = mesh(new THREE.ConeGeometry(0.0042, 0.012, 6), green, o, -0.028 + 0.004, 0.0115 + Math.sin(a) * 0.004, Math.cos(a) * 0.004);
          leaf.rotation.set(Math.cos(a) * 0.9, 0, -Math.PI / 2 + Math.sin(a) * 0.9);
        }
        const stalk = mesh(new THREE.CylinderGeometry(0.0016, 0.0022, 0.012, 8), green, o, -0.036, 0.0125, 0);
        stalk.rotation.z = Math.PI / 2 - 0.2;
        const lac = mat({ color: '#6b1a14', roughness: 0.22 });
        for (const dz of [-0.0045, 0.0045]) {
          const s = mesh(new THREE.CylinderGeometry(0.0012, 0.003, 0.165, 10), lac, o, 0.006, 0.024, dz);
          s.rotation.set(0, 0.06 * Math.sign(dz), Math.PI / 2 + 0.02);
          s.position.y = 0.0225; // (resting on the aubergine's back)
        }
        o.rotation.y = 0.12;
        return o;
      },
      // a piece of sea glass off the beach: rounded and frosted by the waves, green, on a square of linen
      seaglass() {
        const o = new THREE.Group();
        mesh(new THREE.BoxGeometry(0.06, 0.0012, 0.06), C.linen(), o, 0, 0.0006, 0);
        const g = new THREE.IcosahedronGeometry(0.014, 3), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.18 * Math.sin(x * 260 + z * 170) * Math.cos(y * 210 - x * 90);
          p.setXYZ(i, x * n * 1.35, y * n * 0.48, z * n);
        }
        g.computeVertexNormals();
        mesh(g, mat({ color: '#7fb796', roughness: 0.55, transparent: true, opacity: 0.82, glow: 0.18 }), o, 0, 0.0075, 0).rotation.y = 0.6;
        return o;
      },
      // a Kyoto folding fan, open on its black stand: pleated paper on bamboo ribs, the two guard sticks lacquered
      sensu() {
        const o = new THREE.Group();
        const art = canvas(512, 256, (c, w, h) => {
          const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#efe3c8'); gr.addColorStop(1, '#f4ead4'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
          c.fillStyle = 'rgba(190,150,70,0.55)'; for (let i = 0; i < 200; i++) c.fillRect(Math.random() * w, Math.random() * h * 0.6, 3, 2);  // gold leaf flecks
          c.strokeStyle = '#3c5a4a'; c.lineWidth = 4;   // a stream across it, and a maple's leaves
          c.beginPath(); for (let x = 0; x <= w; x += 8) c.lineTo(x, h * 0.55 + Math.sin(x / 40) * 18); c.stroke();
          c.strokeStyle = '#6c8fa6'; c.lineWidth = 2; c.beginPath(); for (let x = 0; x <= w; x += 8) c.lineTo(x, h * 0.62 + Math.sin(x / 40 + 1) * 16); c.stroke();
          // maple leaves: five pointed lobes, the middle one longest, toothed, on a short stem
          const maple = (x, y, r, rot, col) => {
            c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = col; c.beginPath();
            const lobes = [[-Math.PI / 2, 1], [-Math.PI / 2 - 0.95, 0.85], [-Math.PI / 2 + 0.95, 0.85], [-Math.PI / 2 - 1.95, 0.55], [-Math.PI / 2 + 1.95, 0.55]].sort((a, b) => a[0] - b[0]);
            c.moveTo(0, r * 0.15);
            for (const [a, k] of lobes) { const w = 0.32; c.lineTo(Math.cos(a - w) * r * 0.42, Math.sin(a - w) * r * 0.42); c.lineTo(Math.cos(a - 0.08) * r * k * 0.8, Math.sin(a - 0.08) * r * k * 0.8); c.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); c.lineTo(Math.cos(a + 0.08) * r * k * 0.8, Math.sin(a + 0.08) * r * k * 0.8); c.lineTo(Math.cos(a + w) * r * 0.42, Math.sin(a + w) * r * 0.42); }
            c.closePath(); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, r * 0.6); c.stroke(); c.restore();
          };
          [[120, 62, 20, 0.3, '#c0442c'], [168, 96, 15, -0.5, '#d7713a'], [332, 72, 19, 0.9, '#b8362a'], [384, 42, 13, -0.2, '#d98a3c'], [262, 112, 16, 0.6, '#c0442c'], [214, 50, 11, 1.4, '#e0a040']].forEach(a => maple(...a));
        });
        const N = 30, A0 = -1.3, A1 = 1.3, R0 = 0.04, R1 = 0.12, pos = [], uvs = [], idx = [];
        for (let i = 0; i <= N; i++) {
          const a = A0 + (A1 - A0) * i / N, d = (i % 2 ? 0.0028 : -0.0028);
          for (const [r, v] of [[R0, 0], [R1, 1]]) { pos.push(Math.sin(a) * r, Math.cos(a) * r, d); uvs.push(i / N, v); }
          if (i < N) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
        const fan = new THREE.Group(); o.add(fan);
        mesh(g, mat({ color: '#ffffff', map: art, roughness: 0.85, side: THREE.DoubleSide, glow: 0.14 }), fan);
        const rib = C.bamboo();
        for (let i = 0; i <= N; i += 2) { const a = A0 + (A1 - A0) * i / N, s = mesh(new THREE.BoxGeometry(0.0022, R0 + 0.005, 0.0012), rib, fan, Math.sin(a) * R0 / 2, Math.cos(a) * R0 / 2, -0.0035); s.rotation.z = -a; }
        for (const a of [A0, A1]) { const s = mesh(new THREE.BoxGeometry(0.004, R1, 0.0025), C.lacquer(), fan, Math.sin(a) * R1 / 2, Math.cos(a) * R1 / 2, 0.0035 * Math.sign(a)); s.rotation.z = -a; }
        mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.009, 12).rotateX(Math.PI / 2), C.brass(), fan, 0, 0, 0);   // the rivet
        fan.position.set(0, 0.016, 0.004); fan.rotation.x = -0.22;
        mesh(new THREE.BoxGeometry(0.06, 0.006, 0.03), C.lacquer(), o, 0, 0.003, 0);
        mesh(new THREE.BoxGeometry(0.012, 0.03, 0.006), C.lacquer(), o, 0, 0.015, -0.01).rotation.x = -0.2;
        return o;
      },
      // an enamel pin of the TSS Earnslaw on its card: the black hull, white upperworks, the red funnel with its black
      // top, the year under the waterline
      'steamer-pin'() {
        const o = new THREE.Group();
        const card = canvas(256, 320, (c, w, h) => {
          c.fillStyle = '#f1ead9'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d3b52'; c.fillRect(0, 0, w, 54);
          c.fillStyle = '#f1ead9'; c.font = 'bold 26px Georgia, serif'; c.textAlign = 'center'; c.fillText('TSS EARNSLAW', w / 2, 36);
          c.fillStyle = '#1d3b52'; c.font = 'italic 20px Georgia, serif'; c.fillText('Lake Wakatipu', w / 2, h - 46); c.font = '16px Georgia, serif'; c.fillText('Queenstown · New Zealand', w / 2, h - 20);
          c.strokeStyle = 'rgba(29,59,82,0.35)'; c.lineWidth = 2; c.strokeRect(14, 66, w - 28, h - 132);
        });
        const cd = mesh(new THREE.BoxGeometry(0.056, 0.07, 0.0012), [C.card(), C.card(), C.card(), C.card(), mat({ color: '#ffffff', map: card, roughness: 0.8 }), C.card()], o, 0, 0.035, 0);
        cd.rotation.x = -0.16; cd.position.z = -0.004;
        const pin = new THREE.Group(); cd.add(pin); pin.position.set(0, -0.001, 0.0012);
        const enamel = canvas(256, 128, (c, w, h) => {
          c.fillStyle = '#d9b45a'; c.fillRect(0, 0, w, h);
          c.fillStyle = '#16191c'; c.beginPath(); c.moveTo(10, 70); c.lineTo(246, 70); c.lineTo(226, 104); c.lineTo(28, 104); c.fill();    // the hull
          c.fillStyle = '#b8231c'; c.fillRect(30, 98, 196, 6);
          c.fillStyle = '#f4f1ea'; c.fillRect(48, 50, 160, 20); c.fillRect(84, 36, 70, 14);           // the upperworks
          c.fillStyle = '#c62a20'; c.fillRect(108, 6, 22, 32); c.fillStyle = '#16191c'; c.fillRect(108, 6, 22, 8);   // the funnel
          c.fillStyle = '#e8e2d2'; c.font = 'bold 15px Georgia, serif'; c.textAlign = 'center'; c.fillText('1912', 128, 92);
          c.fillStyle = '#16191c'; for (let x = 60; x < 200; x += 14) c.fillRect(x, 56, 6, 6);         // the saloon's windows
        });
        const s = new THREE.Shape(); s.moveTo(-0.0185, -0.004); s.lineTo(0.0185, -0.004); s.lineTo(0.0215, 0.0025); s.lineTo(0.015, 0.0025); s.lineTo(0.014, 0.0055); s.lineTo(0.002, 0.0055); s.lineTo(0.002, 0.012); s.lineTo(-0.002, 0.012); s.lineTo(-0.002, 0.0075); s.lineTo(-0.012, 0.0075); s.lineTo(-0.013, 0.0025); s.lineTo(-0.0215, 0.0025); s.closePath();
        mesh(plate(s, 0.0016, 0.0003), [mat({ color: '#ffffff', map: enamel, roughness: 0.15, metalness: 0.2, glow: 0.12 }), C.gold()], pin);
        return o;
      },
      // a Hachiko charm: a small brass Akita sitting, its curled tail up over its back, on a red cord with a tassel
      charm() {
        const o = new THREE.Group(), b = C.brass(), d = new THREE.Group(); o.add(d);
        const body = mesh(new THREE.SphereGeometry(0.0085, 20, 14), b, d, 0, 0.011, -0.002); body.scale.set(0.95, 1.25, 1.2);
        const chest = mesh(new THREE.SphereGeometry(0.0065, 18, 12), b, d, 0, 0.016, 0.004); chest.scale.set(1, 1.2, 1);
        mesh(new THREE.SphereGeometry(0.006, 18, 14), b, d, 0, 0.0255, 0.004);
        const snout = mesh(new THREE.CylinderGeometry(0.0022, 0.0034, 0.006, 12).rotateX(Math.PI / 2), b, d, 0, 0.0238, 0.0098);
        snout.rotation.x = Math.PI / 2 + 0.15;
        for (const s of [-1, 1]) {
          const ear = mesh(new THREE.ConeGeometry(0.0024, 0.0055, 4), b, d, s * 0.0034, 0.0315, 0.0025); ear.rotation.set(0.1, 0, -s * 0.18);
          mesh(new THREE.CylinderGeometry(0.0018, 0.002, 0.012, 10), b, d, s * 0.003, 0.006, 0.0065);       // the forelegs
          const haunch = mesh(new THREE.SphereGeometry(0.0045, 14, 10), b, d, s * 0.0055, 0.0045, -0.003); haunch.scale.set(0.8, 1, 1.3);
        }
        const tail = mesh(new THREE.TorusGeometry(0.0034, 0.0016, 8, 16, Math.PI * 1.6), b, d, 0, 0.0185, -0.0115); tail.rotation.set(0, Math.PI / 2, 0.6);
        mesh(new THREE.TorusGeometry(0.0016, 0.0005, 6, 12), b, d, 0, 0.0325, 0.001);                   // the ring the cord goes through
        mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.0016, 24), b, o, 0, 0.0008, 0);                // its little base
        const cord = [[0, 0.033, 0.001], [-0.006, 0.04, -0.004], [-0.014, 0.03, -0.008], [-0.017, 0.012, -0.004], [-0.016, 0.002, 0.006], [-0.008, 0.001, 0.014]];
        mesh(tube(cord, 0.0008, 36), C.red(), o);
        const tas = mesh(new THREE.CylinderGeometry(0.0012, 0.0028, 0.012, 12), C.red(), o, -0.006, 0.0012, 0.02); tas.rotation.set(Math.PI / 2 - 0.1, 0, 0.4);
        return o;
      },
      // a small kumade: a bamboo rake the size of your hand, hung with a gold koban, a rice bale and a red fan
      kumade() {
        const o = new THREE.Group(), k = new THREE.Group(); o.add(k);
        mesh(new THREE.CylinderGeometry(0.0028, 0.0032, 0.11, 10), C.bamboo(), k, 0, 0.055, 0);
        for (let i = 0; i < 13; i++) {
          const a = -0.85 + 1.7 * i / 12, t = mesh(new THREE.BoxGeometry(0.0022, 0.075, 0.0012), C.bamboo(), k, Math.sin(a) * 0.037, 0.11 + Math.cos(a) * 0.037, 0.0004);
          t.rotation.z = -a;
          const tip = mesh(new THREE.BoxGeometry(0.0022, 0.006, 0.004), C.bamboo(), k, Math.sin(a) * 0.075, 0.11 + Math.cos(a) * 0.075, 0.002); tip.rotation.set(0.9, 0, -a);
        }
        for (const r of [0.03, 0.055]) mesh(new THREE.TorusGeometry(r, 0.0011, 5, 28, 1.7).rotateZ(Math.PI / 2 - 0.85), C.bamboo(), k, 0, 0.11, 0.0012);
        const koban = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.0012, 24).rotateX(Math.PI / 2), C.gold(), k, -0.012, 0.13, 0.004); koban.scale.set(0.7, 1, 1);
        const bale = mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.014, 14).rotateZ(Math.PI / 2), C.straw(), k, 0.012, 0.122, 0.006);
        for (const dx of [-0.004, 0.004]) mesh(new THREE.TorusGeometry(0.0057, 0.0007, 5, 16).rotateY(Math.PI / 2), C.red(), bale, dx, 0, 0);
        const fan = new THREE.Shape(); fan.moveTo(0, 0); fan.absarc(0, 0, 0.014, Math.PI * 0.2, Math.PI * 0.8, false); fan.closePath();
        mesh(new THREE.ExtrudeGeometry(fan, { depth: 0.0008, bevelEnabled: false }), C.red(), k, 0, 0.142, 0.006);
        mesh(new THREE.TorusGeometry(0.004, 0.0009, 6, 14), C.red(), k, 0, 0.1, 0.004);
        mesh(new THREE.BoxGeometry(0.035, 0.008, 0.025), C.darkwood(), o, 0, 0.004, -0.012);
        k.position.set(0, 0.002, -0.006); k.rotation.x = -0.2;
        return o;
      },
      // a tin harbour ferry in green and cream: a bow at both ends, so it never turns round; a wheelhouse at each,
      // the saloon's windows, the mast, a tab and a seam where the tin was folded
      'tin-ferry'() {
        const o = new THREE.Group(), f = new THREE.Group(); o.add(f);
        const green = mat({ color: '#245a3a', roughness: 0.38, metalness: 0.55 }), cream = mat({ color: '#efe3b8', roughness: 0.4, metalness: 0.45 });
        const hull = new THREE.Shape(); hull.moveTo(-0.075, 0); hull.quadraticCurveTo(-0.05, 0.02, 0, 0.021); hull.quadraticCurveTo(0.05, 0.02, 0.075, 0); hull.quadraticCurveTo(0.05, -0.02, 0, -0.021); hull.quadraticCurveTo(-0.05, -0.02, -0.075, 0);
        const hg = new THREE.ExtrudeGeometry(hull, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 24 });
        hg.rotateX(-Math.PI / 2); hg.translate(0, 0.004, 0);
        mesh(hg, green, f);
        mesh(new THREE.BoxGeometry(0.15, 0.0012, 0.0005), mat({ color: '#b02a22', roughness: 0.5 }), f, 0, 0.0075, 0.0212);   // the boot-topping line
        const win = canvas(512, 64, (c, w, h) => { c.fillStyle = '#efe3b8'; c.fillRect(0, 0, w, h); c.fillStyle = '#28333a'; for (let x = 18; x < w - 20; x += 34) c.fillRect(x, 16, 22, 30); c.fillStyle = 'rgba(255,255,255,0.35)'; for (let x = 18; x < w - 20; x += 34) c.fillRect(x + 2, 18, 6, 26); });
        const wm = mat({ color: '#ffffff', map: win, roughness: 0.35, metalness: 0.4, glow: 0.2 });
        mesh(new THREE.BoxGeometry(0.1, 0.016, 0.03), [cream, cream, cream, cream, wm, wm], f, 0, 0.0285, 0);
        mesh(new THREE.BoxGeometry(0.108, 0.0016, 0.034), green, f, 0, 0.0373, 0);
        for (const s of [-1, 1]) {
          mesh(new THREE.BoxGeometry(0.016, 0.012, 0.022), [cream, cream, cream, cream, wm, wm], f, s * 0.038, 0.044, 0);
          mesh(new THREE.BoxGeometry(0.019, 0.0014, 0.025), green, f, s * 0.038, 0.0507, 0);
        }
        mesh(new THREE.CylinderGeometry(0.0008, 0.001, 0.04, 6), C.darkwood(), f, 0, 0.058, 0);
        mesh(new THREE.BoxGeometry(0.009, 0.006, 0.0004), mat({ color: '#1f4fa0', roughness: 0.7 }), f, 0.0048, 0.074, 0);
        for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.004, 0.003, 0.0016), mat({ color: '#9aa0a4', roughness: 0.3, metalness: 0.9 }), f, s * 0.02, 0.0045, 0.0215);  // the tabs
        f.rotation.y = 0.5; f.position.y = 0.0;
        return o;
      },
      // a cherry-print tenugui, folded and stood on a small stand: petals on water, cotton's soft edges
      tenugui() {
        const o = new THREE.Group();
        const print = canvas(256, 256, (c, w, h) => {
          c.fillStyle = '#dce8ee'; c.fillRect(0, 0, w, h);
          c.strokeStyle = '#7ea6bd'; c.lineWidth = 3; for (let y = 20; y < h; y += 40) { c.beginPath(); for (let x = 0; x <= w; x += 6) c.lineTo(x, y + Math.sin(x / 18 + y) * 5); c.stroke(); }
          for (let i = 0; i < 26; i++) {
            const x = (i * 97) % w, y = (i * 61) % h, r = 9 + (i % 3) * 3; c.fillStyle = i % 4 ? '#eaa7b5' : '#f6d6dc';
            for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + i; c.beginPath(); c.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.55, r * 0.35, a, 0, Math.PI * 2); c.fill(); }
            c.fillStyle = '#c45f78'; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill();
          }
        });
        const pm = mat({ color: '#ffffff', map: print, roughness: 0.95, glow: 0.14 }), side = mat({ color: '#c9d9e1', roughness: 0.95 });
        const g = new THREE.BoxGeometry(0.09, 0.115, 0.012, 1, 1, 1);
        const t = mesh(g, [side, side, side, side, pm, side], o, 0, 0.062, 0); t.rotation.x = -0.12;
        const fold = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), side, t, 0, 0.0575, 0); fold.rotation.y = Math.PI / 2;
        mesh(new THREE.BoxGeometry(0.1, 0.006, 0.035), C.darkwood(), o, 0, 0.003, 0);
        return o;
      },
      // a station stamp book, open at a stamp in red ink: the station's name round a train, and the date
      stampbook() {
        const o = new THREE.Group();
        const page = canvas(256, 256, (c, w, h) => {
          c.fillStyle = '#f5efe0'; c.fillRect(0, 0, w, h);
          c.strokeStyle = 'rgba(176,32,38,0.88)'; c.fillStyle = 'rgba(176,32,38,0.88)'; c.lineWidth = 6;
          c.beginPath(); c.arc(128, 120, 86, 0, Math.PI * 2); c.stroke(); c.lineWidth = 2; c.beginPath(); c.arc(128, 120, 76, 0, Math.PI * 2); c.stroke();
          c.font = 'bold 34px serif'; c.textAlign = 'center'; c.fillText('東京駅', 128, 82);
          c.fillRect(66, 120, 124, 26); c.fillRect(78, 104, 30, 18); c.clearRect(122, 124, 14, 12); c.clearRect(146, 124, 14, 12); c.clearRect(170, 124, 14, 12);
          c.beginPath(); c.arc(90, 152, 8, 0, Math.PI * 2); c.arc(170, 152, 8, 0, Math.PI * 2); c.fill();
          c.font = '20px serif'; c.fillText('TOKYO STATION', 128, 186);
          c.font = '22px monospace'; c.fillStyle = 'rgba(40,40,60,0.8)'; c.fillText(new Date().getFullYear() + '.' + (new Date().getMonth() + 1), 128, 240);
        });
        const left = canvas(256, 256, (c, w, h) => { c.fillStyle = '#f5efe0'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(60,110,70,0.85)'; c.fillStyle = 'rgba(60,110,70,0.85)'; c.lineWidth = 5; c.strokeRect(54, 46, 148, 148); c.font = 'bold 30px serif'; c.textAlign = 'center'; c.fillText('記念', 128, 112); c.font = '20px serif'; c.fillText('スタンプ', 128, 150); });
        const cover = mat({ color: '#28466e', roughness: 0.6 }), book = new THREE.Group(); o.add(book);
        for (const s of [-1, 1]) {   // two leaves open at a shallow V, the spine at the middle
          const leaf = new THREE.Group(); book.add(leaf); leaf.rotation.set(0, -s * 0.16, 0);
          mesh(new THREE.BoxGeometry(0.06, 0.09, 0.0035), [cover, cover, cover, cover, mat({ color: '#ffffff', map: s > 0 ? page : left, roughness: 0.9, glow: 0.14 }), cover], leaf, s * 0.0302, 0, 0);
        }
        book.position.set(0, 0.05, -0.006); book.rotation.x = -0.32;
        mesh(new THREE.BoxGeometry(0.075, 0.006, 0.035), C.darkwood(), o, 0, 0.003, 0);
        mesh(new THREE.BoxGeometry(0.075, 0.009, 0.004), C.darkwood(), o, 0, 0.0105, 0.012);   // the lip it rests on
        return o;
      },
    };
    // a keepsake with no model of its own: a paulownia box, the glyph brushed on its lid
    function box(a) {
      const o = new THREE.Group();
      const lid = canvas(128, 128, (c, w, h) => { c.fillStyle = '#e2cfa8'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { c.fillStyle = `rgba(150,110,60,${0.05 + 0.05 * Math.sin(y)})`; c.fillRect(0, y, w, 1); } c.fillStyle = '#2a1e16'; c.font = '72px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(a.glyph || '◇', w / 2, h / 2 + 4); });
      const wd = mat({ color: '#d9c39a', roughness: 0.75 });
      const b = mesh(new THREE.BoxGeometry(0.07, 0.035, 0.07), [wd, wd, mat({ color: '#ffffff', map: lid, roughness: 0.75 }), wd, wd, wd], o, 0, 0.0175, 0);
      mesh(new THREE.TorusGeometry(0.036, 0.0012, 5, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4), C.red(), b, 0, 0, 0).scale.set(1.38, 1, 1.38);
      return o;
    }
    // the folded card in front of each: what it is, where you bought it, and the city
    function cardFor(a) {
      const t = canvas(384, 160, (c, w, h) => {
        c.fillStyle = '#f4eee0'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#9a7a4a'; c.fillRect(18, 18, 3, h - 36);
        c.fillStyle = '#2a241c'; c.font = '600 34px Georgia, serif'; c.textBaseline = 'top';
        let n = a.name; while (c.measureText(n).width > w - 54 && n.length > 4) n = n.slice(0, -2) + '…';
        c.fillText(n, 36, 28);
        c.fillStyle = '#6b5a44'; c.font = 'italic 25px Georgia, serif'; let p = `${a.shop}, ${a.place}`; while (c.measureText(p).width > w - 54 && p.length > 4) p = p.slice(0, -2) + '…';
        c.fillText(p, 36, 84);
      });
      const o = new THREE.Group();
      const f = mesh(new THREE.PlaneGeometry(0.074, 0.031), mat({ color: '#ffffff', map: t, roughness: 0.85, glow: 0.16 }), o, 0, 0.0142, 0.0056); f.rotation.x = -0.5;
      const b = mesh(new THREE.PlaneGeometry(0.074, 0.031), C.card(), o, 0, 0.0142, -0.0056); b.rotation.x = 0.5; b.rotation.y = Math.PI;
      return o;
    }
    // what is kept: the album's, this city's first (as the album lists them)
    const kept = () => {
      if (L.jobs && L.jobs.albumPage) { /* (files a keepsake bought before the album) */ try { L.jobs.albumPage(); } catch (e) { /* not ready */ } }
      return (L.store.album || []).slice().sort((a, b) => (a.city === ctx.cityId ? 0 : 1) - (b.city === ctx.cityId ? 0 : 1)).slice(0, K.slots.length);
    };
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    function build(list) {
      if (group) { ctx.world.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      group = new THREE.Group(); group.name = 'keepsakes';
      list.forEach((a, i) => {
        const [x, y, z, h] = K.slots[i], it = (models[a.id] || (() => box(a)))(), slot = new THREE.Group();
        // each on its own walnut plinth with a felt top, the card on the board in front
        mesh(PLINTH(), C.walnut(), slot, 0, 0.009, -0.03);
        mesh(FELT(), C.felt(), slot, 0, 0.0185, -0.03);
        it.position.set(0, 0.019, -0.03);
        slot.add(it); const card = cardFor(a); card.position.z = 0.075; slot.add(card);
        slot.position.copy(W(x, y, z)); slot.rotation.y = Math.PI - h * Math.PI / 180;
        slot.userData.keepsake = a.id;
        group.add(slot);
      });
      if (!list.length) { // an empty shelf says what it is for
        const [x, y, z, h] = K.slots[Math.floor(K.slots.length / 4)];
        const c = cardFor({ name: 'Your keepsakes', shop: 'Kept here', place: 'from every city' }); c.position.copy(W(x, y, z)); c.rotation.y = Math.PI - h * Math.PI / 180; group.add(c);
      }
      ctx.world.add(group);
      glowK = -1;
      // the look closer's texts: what is at each slot along the shelf (places.js closer: [u, rail, side, layer, text])
      if (spot && spot.look) {
        const lk = spot.look, ax = lk.along[0], ay = lk.along[1], rails = lk.rails;
        lk.texts = list.map(a => `${a.name} · ${a.shop}, ${a.place}`);
        lk.tablets = list.map((a, i) => { const [sx, sy, sz] = K.slots[i]; return [(sx - lk.at[0]) * ax + (sy - lk.at[1]) * ay, rails.reduce((b, r, j) => (Math.abs(r - sz - 0.07) < Math.abs(rails[b] - sz - 0.07) ? j : b), 0), K.side, 0, i]; });
        if (!list.length) { lk.texts = ['Nothing here yet: what you keep from the counters is set out on this shelf.']; lk.tablets = [[0, 0, K.side, 0, 0]]; }
      }
    }
    // after dark the things on the shelf take the room's warm light, as its plaster and paper do
    function light() {
      const alt = ctx.sun && ctx.sun.altitude != null ? ctx.sun.altitude : 0.5;
      const k = Math.max(0, Math.min(1, (0.05 - alt) / 0.15));
      if (Math.abs(k - glowK) < 0.02) return;
      glowK = k;
      for (const m of mats) m.emissiveIntensity = (m.map ? 0.5 : 1) * m.userData.glow * (0.25 + 0.75 * k) * 0.9;
    }
    let acc = 1;
    function tick(dt) {
      if ((acc += dt) < 0.5) return;
      acc = 0;
      const P = ctx.player, [sx, sy] = K.stand, near = Math.hypot(P.x - sx, P.y - sy) < NEAR;
      if (!near) { if (group) group.visible = false; return; }
      const list = kept(), key = list.map(a => `${a.city}:${a.id}`).join('|');
      if (key !== shown || !group) { shown = key; build(list); }
      group.visible = true;
      light();
    }
    // (spots are made before the album is read: an empty look closer would show nothing until the room is near)
    if (spot && spot.look && !spot.look.texts.length) { spot.look.texts = ['Nothing here yet: what you keep from the counters is set out on this shelf.']; spot.look.tablets = [[0, 0, K.side, 0, 0]]; }
    L.on('keep', () => { shown = ''; acc = 1; });
    L.use({ tick, reset() { shown = ''; acc = 1; } });
    const api = { room, get group() { return group; }, kept, models: Object.keys(models), build: () => { shown = ''; acc = 1; tick(0); return group; } };
    L.keepsakes = api;
    return api;
  }
  return { create };
})();
