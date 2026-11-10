// The plush friends who send the postcards (docs/POSTCARDS.md): one soft toy for each map, held up in front of
// the view the way travellers photograph their own toys. tools/game_shot.js loads this into the game's page for
// a view with "plush" and builds the toy there, in the game's own light, an arm's length from the lens.
//
//   OEPlush.build(kind) -> THREE.Group, the head's middle at its origin, the face towards +z, in metres
//   OEPlush.KINDS       -> the kinds, each with its colours and face
//
// Every toy is made of the same few parts, the way a plush is sewn: a wide soft head, a small body under it
// (mostly below the frame), ears, a muzzle where the animal has one, and a face embroidered on a panel of the
// head (a canvas texture on a cap that sits on the head's surface: eyes, nose, mouth, markings). The cloth is
// a fleece: a rough, sheened material with a fine fibre normal map. Original designs, one per place:
//   fox (Fushimi Inari: the white fox messengers of Inari, red markings and a red bib), tanuki (Higashiyama),
//   rabbit (Kyoto), tabby (the Philosopher's Path and its cats), dove (Kamakura), koala (Sydney), sheep
//   (Queenstown), akita (Shibuya), calico (Shinjuku), panda (Tokyo).
(function (root) {
  'use strict';
  const R = 0.08; // the head's radius before its squash: a toy about 22 cm wide across the head

  // a fleece's fibres: a height field of short random strokes, as a normal map
  let fibre = null;
  function fibreMap() {
    if (fibre) return fibre;
    const T = window.THREE, n = 256, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round';
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * n, y = rnd() * n, a = rnd() * Math.PI * 2, l = 2 + rnd() * 5, v = Math.round(90 + rnd() * 120);
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6 + rnd() * 1.2;
      for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
    const h = g.getImageData(0, 0, n, n).data, out = g.createImageData(n, n), H = (x, y) => h[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    fibre = new T.CanvasTexture(c);
    fibre.wrapS = fibre.wrapT = T.RepeatWrapping;
    fibre.repeat.set(5, 3);
    return fibre;
  }

  // The pile. What makes a toy read as plush rather than plastic is its fibres: an outline broken by thousands of
  // them, light caught along them at a grazing angle, and the pile darker at its roots, where the fibres shade
  // one another. So each fleece part gets fur shells (Lengyel et al. 2001, "Real-time fur over arbitrary
  // surfaces", the way games draw short fur): copies of the surface pushed out along its normal, each showing
  // only the fibres that reach that high. The strand map: a strand on each cell of a jittered grid, its height in
  // the red channel falling off from its middle, so that the fibres taper towards their tips.
  let strands = null;
  function strandMap() {
    if (strands) return strands;
    const T = window.THREE, n = 256, cell = 4, d = new Uint8Array(n * n * 4);
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let cy = 0; cy < n / cell; cy++) for (let cx = 0; cx < n / cell; cx++) {
      const px = (cx + 0.15 + rnd() * 0.7) * cell, py = (cy + 0.15 + rnd() * 0.7) * cell, h = 0.55 + rnd() * 0.45, r = cell * (0.55 + rnd() * 0.25);
      for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        const t = 1 - Math.hypot(x - px, y - py) / r;
        if (t <= 0) continue;
        const i = (((y + n) % n) * n + ((x + n) % n)) * 4, v = Math.round(255 * h * Math.sqrt(t));
        if (v > d[i]) d[i] = v;
      }
    }
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    strands = new T.DataTexture(d, n, n);
    strands.wrapS = strands.wrapT = T.RepeatWrapping;
    strands.magFilter = T.LinearFilter; strands.minFilter = T.LinearMipmapLinearFilter; strands.generateMipmaps = true;
    strands.needsUpdate = true;
    return strands;
  }
  const SHELLS = 18;
  // fur on a mesh: `len` metres of pile, its world scale `ws` (the shells push out the same distance whatever the
  // squash), the strands about a millimetre apart whatever the part's size
  function fur(mesh, len, ws) {
    const T = window.THREE, base = mesh.material = mesh.material.clone(); // (a part's own: the darkening below is once per part)
    const rep = new T.Vector2(2 * Math.PI * Math.max(ws.x, ws.z) / 0.0011 / 64, Math.PI * ws.y / 0.0011 / 64);
    for (let i = 1; i <= SHELLS; i++) {
      const lv = i / SHELLS, m = base.clone();
      m.normalMap = null;
      m.userData = { plush: true, shell: lv };
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uLevel: { value: lv }, uLen: { value: len }, uS: { value: ws.clone() }, uStrand: { value: strandMap() }, uRep: { value: rep } });
        sh.vertexShader = 'uniform float uLevel, uLen; uniform vec3 uS; varying vec2 vFur;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 nW = normalize(objectNormal / uS);
           transformed += nW / uS * uLen * uLevel;
           transformed.y -= uLen * 0.35 * uLevel * uLevel / uS.y; // (the pile lies a little, combed down)
           vFur = uv;`);
        sh.fragmentShader = 'uniform float uLevel; uniform sampler2D uStrand; uniform vec2 uRep; varying vec2 vFur;\n' + sh.fragmentShader.replace('#include <color_fragment>',
          `#include <color_fragment>
           float hs = texture2D(uStrand, vFur * uRep).r;
           if (hs < uLevel * 0.98 + 0.02) discard;
           diffuseColor.rgb *= mix(0.5, 1.06, pow(uLevel, 0.7)); // the roots in the pile's own shade`);
      };
      m.customProgramCacheKey = () => 'plush-shell';
      const o = new T.Mesh(mesh.geometry, m);
      o.renderOrder = 1; o.frustumCulled = false;
      mesh.add(o);
    }
    // the base under the shells: the pile's shaded depth
    base.color.multiplyScalar(0.55);
    base.sheenColor.multiplyScalar(0.5);
  }

  // the cloth: fleece, or felt (flatter, for the appliqué parts), or a stitched satin (a bib, a collar)
  function cloth(color, kind = 'fleece') {
    const T = window.THREE, c = new T.Color(color);
    const m = new T.MeshPhysicalMaterial({
      color: c, roughness: kind === 'satin' ? 0.55 : 0.94, metalness: 0,
      sheen: kind === 'satin' ? 0.3 : 1, sheenRoughness: kind === 'fleece' ? 0.45 : 0.7,
      sheenColor: c.clone().lerp(new T.Color(0xffffff), 0.35),
      normalMap: kind === 'fleece' ? fibreMap() : null, normalScale: new T.Vector2(0.5, 0.5),
    });
    m.userData.plush = true;
    return m;
  }

  // a cap of a sphere of radius r centred on +z, `deg` degrees across its half, its UVs a flat projection along z,
  // so that a square canvas drawn as the face lands on the front of the head undistorted where it matters
  function cap(r, deg) {
    const T = window.THREE, a = deg * Math.PI / 180;
    const g = new T.SphereGeometry(r, 64, 32, 0, Math.PI * 2, 0, a);
    g.rotateX(Math.PI / 2); // the pole from +y to +z
    const p = g.attributes.position, uv = g.attributes.uv, s = r * Math.sin(a);
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * s), 0.5 + p.getY(i) / (2 * s));
    uv.needsUpdate = true;
    return g;
  }

  // the face panel, drawn on a 1024 canvas: (0, 0) top left, the head's front at (512, 512), the cap's edge at the
  // canvas's edge. Thread colours and shapes by kind.
  function faceTexture(k) {
    const T = window.THREE, n = 1024, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d'), F = k.face;
    const ell = (x, y, rx, ry, fill, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    // markings under everything else
    (F.marks || []).forEach(m => {
      g.save();
      g.fillStyle = m.c;
      g.filter = m.soft ? `blur(${m.soft}px)` : 'none';
      g.beginPath(); g.ellipse(m.x, m.y, m.rx, m.ry, (m.rot || 0) * Math.PI / 180, 0, Math.PI * 2); g.fill();
      g.restore();
    });
    // blush
    if (F.blush) for (const sx of [-1, 1]) { g.save(); g.filter = 'blur(14px)'; ell(512 + sx * F.blush[0], F.blush[1], 58, 34, F.blushC || 'rgba(255,128,150,0.55)'); g.restore(); }
    // eyes: embroidered, a white, an iris, a pupil and a glint, each edged with a darker thread
    const E = Object.assign({}, F.eye); // (eyes a third larger than drawn: a toy's eyes are its face)
    E.w *= 1.32; E.h *= 1.32; E.dx *= 1.06;
    for (const sx of [-1, 1]) {
      const x = 512 + sx * E.dx, y = E.y;
      g.save();
      g.translate(x, y); g.rotate(sx * (E.tilt || 0) * Math.PI / 180);
      if (E.white) { ell(0, 0, E.w + 9, E.h + 9, E.edge || '#2a2a30'); ell(0, 0, E.w, E.h, E.white); }
      const ix = E.white ? sx * (E.look || 0) : 0, iw = E.white ? E.w * E.iris : E.w, ih = E.white ? E.h * E.iris * 0.92 : E.h;
      ell(ix, E.white ? E.h * 0.08 : 0, iw, ih, E.iris_c || '#1d1d22');
      if (E.ring) { g.lineWidth = 7; g.strokeStyle = E.ring; g.beginPath(); g.ellipse(ix, E.white ? E.h * 0.08 : 0, iw * 0.82, ih * 0.82, 0, 0, Math.PI * 2); g.stroke(); }
      if (E.pupil === 'slit') ell(ix, E.white ? E.h * 0.08 : 0, iw * 0.16, ih * 0.66, '#121216');
      else if (E.pupil) ell(ix, E.white ? E.h * 0.1 : 0, iw * 0.42, ih * 0.42, '#121216');
      ell(ix - iw * 0.35, -ih * 0.32, Math.max(9, iw * 0.24), Math.max(9, ih * 0.2), '#ffffff');
      ell(ix + iw * 0.3, ih * 0.38, Math.max(5, iw * 0.1), Math.max(5, ih * 0.08), 'rgba(255,255,255,0.8)');
      g.restore();
      if (E.lash) { // a stitched lash at the outer corner
        g.strokeStyle = '#26262c'; g.lineWidth = 9; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x + sx * E.w * 0.85, y - E.h * 0.55); g.lineTo(x + sx * (E.w + 34), y - E.h * 0.85); g.stroke();
      }
    }
    // the nose (when it is not a part of its own) and the mouth, in thread
    if (F.nose) { const [x, y, rx, ry, col] = F.nose; g.beginPath(); g.moveTo(x - rx, y - ry * 0.6); g.quadraticCurveTo(x, y - ry * 1.3, x + rx, y - ry * 0.6); g.quadraticCurveTo(x + rx * 0.3, y + ry, x, y + ry); g.quadraticCurveTo(x - rx * 0.3, y + ry, x - rx, y - ry * 0.6); g.fillStyle = col; g.fill(); }
    g.strokeStyle = F.thread || '#26262c'; g.lineWidth = F.lw || 11; g.lineCap = 'round'; g.lineJoin = 'round';
    const M = F.mouth;
    if (M) {
      const [x, y, w] = M.at;
      g.beginPath();
      if (M.kind === 'w') { // ω
        g.moveTo(x - w, y - w * 0.25); g.quadraticCurveTo(x - w * 0.5, y + w * 0.75, x, y); g.quadraticCurveTo(x + w * 0.5, y + w * 0.75, x + w, y - w * 0.25);
      } else if (M.kind === 'smile') {
        g.moveTo(x - w, y); g.quadraticCurveTo(x, y + w * 0.8, x + w, y);
      } else if (M.kind === 'y') { // a short seam down from the nose, then the two cheeks of a smile
        g.moveTo(x, y - w * 0.6); g.lineTo(x, y);
        g.moveTo(x - w, y - w * 0.1); g.quadraticCurveTo(x - w * 0.5, y + w * 0.55, x, y); g.quadraticCurveTo(x + w * 0.5, y + w * 0.55, x + w, y - w * 0.1);
      }
      g.stroke();
    }
    (F.lines || []).forEach(l => { g.lineWidth = l.w || 14; g.strokeStyle = l.c; g.beginPath(); g.moveTo(l.p[0], l.p[1]); for (let i = 2; i < l.p.length; i += 2) g.lineTo(l.p[i], l.p[i + 1]); g.stroke(); });
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // a soft cone with a round tip and a round base: an ear, a beak, a tail's tip
  function softCone(r, h, seg = 24) {
    const T = window.THREE, pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, y = t * h, w = r * Math.pow(1 - t, 0.85) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 2)));
      pts.push(new T.Vector2(Math.max(0.0006, w * (t > 0.92 ? 0.6 : 1)), y));
    }
    pts.unshift(new T.Vector2(0.0001, -r * 0.15));
    return new T.LatheGeometry(pts, seg);
  }

  // The cast. col: the cloth; face: the embroidered panel; ears: 'tri' (cat, fox, dog), 'round', 'long', 'floppy';
  // muzzle: a sewn-on snout; extras: a bib, a scarf, a collar and bell, a wool cap, a big nose
  const W = '#f6f1e8';
  const KINDS = {
    fox: {
      name: 'Kon', what: 'the Inari fox', col: '#f7f3ea', inner: '#d8352a', ears: 'tri', earH: 1.05, squash: [1.14, 0.94, 1], muzzle: { c: W, s: [0.5, 0.36, 0.42], y: -0.36, z: 0.72 }, noseBall: '#2a2224',
      bib: '#c92a22', bell: true,
      face: { eye: { dx: 205, y: 470, w: 74, h: 86, white: '#ffffff', iris: 0.66, iris_c: '#7a3d1c', ring: '#b8692a', pupil: 'slit', tilt: 12, look: 6 },
        marks: [{ x: 300, y: 380, rx: 58, ry: 22, rot: -28, c: '#d8352a' }, { x: 724, y: 380, rx: 58, ry: 22, rot: 28, c: '#d8352a' }, { x: 512, y: 250, rx: 26, ry: 52, c: '#d8352a' }],
        mouth: { kind: 'w', at: [512, 770, 44] }, blush: [300, 640] },
    },
    tanuki: {
      name: 'Pon', what: 'the tanuki', col: '#9a7552', inner: '#4a382c', ears: 'round', earS: 0.34, squash: [1.16, 0.95, 1], muzzle: { c: '#f3e6cf', s: [0.46, 0.34, 0.4], y: -0.34, z: 0.74 }, noseBall: '#231c1a',
      scarf: '#3d6a8c', belly: '#f3e6cf',
      face: { eye: { dx: 195, y: 480, w: 58, h: 60, iris_c: '#1c1816', pupil: false },
        marks: [{ x: 320, y: 500, rx: 120, ry: 92, rot: -18, c: '#3e2f25', soft: 6 }, { x: 704, y: 500, rx: 120, ry: 92, rot: 18, c: '#3e2f25', soft: 6 }, { x: 512, y: 300, rx: 150, ry: 70, c: '#f3e6cf', soft: 20 }],
        mouth: { kind: 'y', at: [512, 790, 36] }, blush: [330, 650] },
    },
    rabbit: {
      name: 'Mochi', what: 'the rabbit', col: '#fbf8f3', inner: '#f2a6b5', ears: 'long', squash: [1.1, 0.96, 1],
      scarf: '#c8323c',
      face: { eye: { dx: 195, y: 500, w: 52, h: 60, iris_c: '#3a1f24', ring: '#8c3a46', pupil: true },
        nose: [512, 650, 34, 22, '#ef8fa2'], mouth: { kind: 'y', at: [512, 712, 40] }, blush: [320, 640], blushC: 'rgba(255,120,150,0.6)' },
    },
    tabby: {
      name: 'Tetsu', what: 'the path cat', col: '#a8a39d', inner: '#f0c7c4', ears: 'tri', earH: 0.9, squash: [1.17, 0.93, 1], scarf: '#2f5f9e',
      face: { eye: { dx: 200, y: 490, w: 70, h: 80, white: '#ffffff', iris: 0.7, iris_c: '#6fa04a', ring: '#3e6a2a', pupil: 'slit', look: 4 },
        marks: [{ x: 512, y: 860, rx: 270, ry: 210, c: W, soft: 10 }],
        lines: [{ c: '#5f5a55', w: 22, p: [512, 160, 512, 300] }, { c: '#5f5a55', w: 22, p: [440, 180, 456, 290] }, { c: '#5f5a55', w: 22, p: [584, 180, 568, 290] },
          { c: '#5f5a55', w: 18, p: [70, 470, 160, 500] }, { c: '#5f5a55', w: 18, p: [954, 470, 864, 500] }],
        nose: [512, 640, 30, 20, '#e48a96'], mouth: { kind: 'w', at: [512, 700, 40] }, blush: [300, 650] },
    },
    dove: {
      name: 'Poppo', what: 'the dove', col: '#fbfaf6', ears: null, squash: [1.08, 1.0, 1.02], beak: '#f0a23a', wings: true, sailor: '#2b4e86',
      face: { eye: { dx: 170, y: 470, w: 50, h: 56, iris_c: '#1d1d22', pupil: false }, blush: [280, 600], blushC: 'rgba(255,140,150,0.6)' },
    },
    koala: {
      name: 'Gumnut', what: 'the koala', col: '#9da3a8', inner: '#f6f3ee', ears: 'round', earS: 0.5, pile: 0.0045, fluffyEars: true, squash: [1.18, 0.95, 1], bigNose: '#2b2b30',
      belly: '#eeeae4', scarf: '#2f7d6a',
      face: { eye: { dx: 210, y: 470, w: 46, h: 52, iris_c: '#1d1d22', pupil: false }, mouth: { kind: 'smile', at: [512, 820, 34] }, blush: [300, 640] },
    },
    sheep: {
      name: 'Merri', what: 'the sheep', col: '#efe2cc', inner: '#d9b9a3', ears: 'floppy', squash: [1.08, 0.98, 1], wool: '#fbf7ee', pile: 0.004,
      bell: true, collar: '#3f7bbf',
      face: { eye: { dx: 185, y: 520, w: 46, h: 50, iris_c: '#2a221e', pupil: false, lash: true },
        nose: [512, 690, 30, 18, '#c89585'], mouth: { kind: 'y', at: [512, 750, 34] }, blush: [300, 660] },
    },
    akita: {
      name: 'Hachi', what: 'the akita', col: '#d28a4c', inner: '#f6ead6', ears: 'tri', earH: 0.78, earW: 1.15, squash: [1.15, 0.95, 1], muzzle: { c: '#f8efe0', s: [0.5, 0.36, 0.44], y: -0.36, z: 0.72 }, noseBall: '#231d1b',
      collar: '#c43a2e', curlTail: true,
      face: { eye: { dx: 195, y: 470, w: 50, h: 54, iris_c: '#2a1d16', pupil: false },
        marks: [{ x: 512, y: 860, rx: 330, ry: 260, c: '#f8efe0', soft: 12 }, { x: 330, y: 380, rx: 34, ry: 22, c: '#f8efe0' }, { x: 694, y: 380, rx: 34, ry: 22, c: '#f8efe0' }],
        mouth: { kind: 'w', at: [512, 820, 40] }, blush: [300, 650] },
    },
    calico: {
      name: 'Mike', what: 'the calico cat', col: '#fbf7ef', inner: '#f4b9b9', ears: 'tri', earH: 0.92, earCols: ['#e08a3c', '#2b2726'], squash: [1.16, 0.93, 1],
      collar: '#d33a3a', bell: true,
      face: { eye: { dx: 205, y: 480, w: 72, h: 82, white: '#ffffff', iris: 0.7, iris_c: '#d39a2a', ring: '#9b6614', pupil: 'slit', look: 4 },
        marks: [{ x: 250, y: 260, rx: 220, ry: 150, rot: 20, c: '#e08a3c', soft: 4 }, { x: 790, y: 230, rx: 170, ry: 120, rot: -15, c: '#2b2726', soft: 4 }],
        nose: [512, 640, 30, 20, '#ee95a0'], mouth: { kind: 'w', at: [512, 700, 42] }, blush: [300, 650] },
    },
    panda: {
      name: 'Rinrin', what: 'the panda', col: '#fbfaf6', inner: '#26262a', ears: 'round', earS: 0.36, earCol: '#26262a', squash: [1.16, 0.95, 1], muzzle: { c: '#fbfaf6', s: [0.42, 0.3, 0.36], y: -0.34, z: 0.76 }, noseBall: '#26262a',
      limbs: '#26262a', scarf: '#5a9c4a',
      face: { eye: { dx: 205, y: 480, w: 40, h: 44, iris_c: '#1a1a1e', pupil: false },
        marks: [{ x: 300, y: 500, rx: 92, ry: 118, rot: -35, c: '#26262a', soft: 3 }, { x: 724, y: 500, rx: 92, ry: 118, rot: 35, c: '#26262a', soft: 3 }],
        mouth: { kind: 'w', at: [512, 830, 34] }, blush: [270, 700] },
    },
  };
  // the eyes of the panda sit in its patches: a white glint ring makes them read
  KINDS.panda.face.eye.ring = '#f4f4f4';

  function build(kind) {
    const T = window.THREE, k = KINDS[kind];
    if (!k) throw new Error(`no plush "${kind}"`);
    const root = new T.Group(); root.name = `plush-${kind}`;
    const mat = cloth(k.col), add = (geo, m, pos, scale, rot) => {
      const o = new T.Mesh(geo, m);
      if (pos) o.position.set(...pos);
      if (scale) o.scale.set(...scale);
      if (rot) o.rotation.set(...rot);
      o.castShadow = false; o.receiveShadow = false;
      return o;
    };
    const ball = new T.SphereGeometry(1, 48, 32);
    // the head, wide and a little flat, as a plush's is
    const head = add(ball, mat, [0, 0, 0], k.squash.map(s => s * R));
    root.add(head);
    // the face panel on its surface
    const faceMat = new T.MeshPhysicalMaterial({ map: faceTexture(k), transparent: true, roughness: 0.9, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new T.Color(0xffffff), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const face = new T.Mesh(cap(1.045, 62), faceMat); face.renderOrder = 2;
    head.add(face);
    const hs = k.squash.map(s => s * R); // the head's half sizes
    const onHead = (u, v, out = 1) => { // a point on the head's surface: u across (-1..1), v up, towards the front
      const x = u, y = v, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      return [x * hs[0] * out, y * hs[1] * out, z * hs[2] * out];
    };
    // a muzzle: a soft ball on the lower face, with a nose at its front
    if (k.muzzle) {
      const m = k.muzzle, mz = add(ball, cloth(m.c), onHead(0, m.y, 0.86), m.s.map((s, i) => s * hs[i] * (i === 2 ? 0.9 : 1)));
      root.add(mz);
      if (k.noseBall) {
        const p = mz.position, n = add(ball, cloth(k.noseBall, 'satin'), [p.x, p.y + m.s[1] * hs[1] * 0.45, p.z + m.s[2] * hs[2] * 0.82], [R * 0.13, R * 0.085, R * 0.08]);
        root.add(n);
        // the mouth's seam, under the nose, as a short dark thread
        const seam = add(new T.CylinderGeometry(R * 0.012, R * 0.012, m.s[1] * hs[1] * 0.6, 8), cloth(k.noseBall, 'felt'), [p.x, p.y - m.s[1] * hs[1] * 0.05, p.z + m.s[2] * hs[2] * 0.97]);
        root.add(seam);
      }
    }
    if (k.bigNose) root.add(add(ball, cloth(k.bigNose, 'satin'), onHead(0, -0.2, 0.98), [R * 0.24, R * 0.3, R * 0.2]));
    // ears
    const earMat = cloth(k.earCol || k.col), innerMat = cloth(k.inner || k.col, 'felt');
    for (const sx of [-1, 1]) {
      const em = k.earCols ? cloth(k.earCols[sx < 0 ? 0 : 1]) : earMat;
      if (k.ears === 'tri') {
        const h = R * 0.9 * (k.earH || 1), w = R * 0.42 * (k.earW || 1);
        const e = add(softCone(1, 1), em, onHead(sx * 0.58, 0.72, 0.9), [w, h, w * 0.45], [0, 0, -sx * 0.42]);
        const i = add(softCone(1, 1), innerMat, [0, 0.06, 0.62], [0.62, 0.78, 0.5]);
        e.add(i);
        root.add(e);
      } else if (k.ears === 'round') {
        const s = R * (k.earS || 0.35);
        const e = add(ball, em, onHead(sx * 0.72, 0.62, 0.92), [s, s, s * 0.45], [0, -sx * 0.3, 0]);
        e.add(add(ball, k.fluffyEars ? cloth(k.inner) : innerMat, [0, 0, 0.42], [0.7, 0.7, 0.5]));
        root.add(e);
      } else if (k.ears === 'long') {
        const e = add(ball, earMat, onHead(sx * 0.4, 0.8, 0.92), [R * 0.22, R * 0.95, R * 0.12], [0.05, 0, -sx * 0.18]);
        e.position.y += R * 0.75;
        e.add(add(ball, innerMat, [0, 0, 0.55], [0.6, 0.86, 0.55]));
        root.add(e);
      } else if (k.ears === 'floppy') {
        const e = add(ball, cloth(k.inner), onHead(sx * 0.94, 0.25, 0.95), [R * 0.36, R * 0.14, R * 0.18], [0, sx * 0.2, sx * -0.45]);
        e.position.x += sx * R * 0.18;
        root.add(e);
      }
    }
    // a wool cap of soft bumps over the crown and the back
    if (k.wool) {
      const wm = cloth(k.wool);
      let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 46; i++) {
        const a = rnd() * Math.PI * 2, b = 0.25 + rnd() * 1.1; // around the vertical, down from the crown
        const x = Math.sin(b) * Math.sin(a), y = Math.cos(b), z = Math.sin(b) * Math.cos(a);
        if (z > 0.15 && y < 0.62) continue; // the face stays clear
        const r = R * (0.2 + rnd() * 0.1);
        root.add(add(ball, wm, [x * hs[0] * 0.98, y * hs[1] * 0.98 + R * 0.04, z * hs[2] * 0.98], [r, r, r]));
      }
    }
    // a dove's beak and wings
    if (k.beak) {
      const b = add(softCone(1, 1), cloth(k.beak, 'satin'), onHead(0, -0.08, 0.95), [R * 0.16, R * 0.26, R * 0.12], [Math.PI / 2, 0, 0]);
      root.add(b);
    }
    // the body: small under the big head, mostly below the frame
    const body = add(ball, mat, [0, -R * 1.3, -R * 0.05], [R * 0.78, R * 0.82, R * 0.7]);
    root.add(body);
    if (k.belly) root.add(add(ball, cloth(k.belly), [0, -R * 1.38, R * 0.32], [R * 0.52, R * 0.56, R * 0.4]));
    const limb = cloth(k.limbs || k.col);
    for (const sx of [-1, 1]) {
      if (k.wings) root.add(add(ball, mat, [sx * R * 0.78, -R * 1.2, -R * 0.02], [R * 0.2, R * 0.5, R * 0.36], [0, 0, sx * 0.5]));
      else root.add(add(ball, limb, [sx * R * 0.72, -R * 1.25, R * 0.18], [R * 0.2, R * 0.4, R * 0.2], [0.4, 0, sx * 0.85]));
    }
    // around the neck: a bib, a scarf or a collar, with a bell where the toy has one
    const neckY = -R * 0.86;
    if (k.bib) {
      const bib = add(cap(1, 55), cloth(k.bib, 'satin'), [0, neckY - R * 0.05, R * 0.02], [R * 0.75, R * 0.6, R * 0.72], [0.3, 0, 0]);
      root.add(bib);
    }
    const band = k.scarf || k.collar;
    if (band) root.add(add(new T.TorusGeometry(R * 0.66, R * (k.scarf ? 0.13 : 0.07), 16, 48), cloth(band, k.scarf ? 'fleece' : 'satin'), [0, neckY, -R * 0.03], [1, 1, 0.9], [Math.PI / 2 - 0.12, 0, 0]));
    if (k.sailor) { // a sailor collar's tie
      root.add(add(new T.TorusGeometry(R * 0.64, R * 0.08, 16, 48), cloth(k.sailor, 'satin'), [0, neckY, -R * 0.03], [1, 1, 0.9], [Math.PI / 2 - 0.12, 0, 0]));
      for (const sx of [-1, 1]) root.add(add(ball, cloth('#c8323c', 'satin'), [sx * R * 0.12, neckY - R * 0.1, R * 0.62], [R * 0.14, R * 0.08, R * 0.05], [0, 0, sx * 0.6]));
    }
    if (k.bell) {
      const bell = new T.Mesh(new T.SphereGeometry(R * 0.11, 24, 16), new T.MeshStandardMaterial({ color: 0xe8b84a, metalness: 1, roughness: 0.28 }));
      bell.position.set(0, neckY - R * (k.bib ? 0.32 : 0.12), R * (k.bib ? 0.58 : 0.66));
      root.add(bell);
    }
    if (k.curlTail) root.add(add(new T.TorusGeometry(R * 0.22, R * 0.11, 12, 32, Math.PI * 1.6), mat, [R * 0.3, -R * 1.05, -R * 0.65], [1, 1, 1], [0, 0.6, 0.3]));
    root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    // the pile on every fleece part (not on a torus: a scarf's knit is flat enough)
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => { if (o.isMesh && o.material.normalMap && !o.geometry.parameters.tube) parts.push(o); });
    const ws = new T.Vector3();
    for (const o of parts) fur(o, k.pile || 0.0032, o.getWorldScale(ws).clone());
    return root;
  }

  root.OEPlush = { build, KINDS, R };
})(typeof window !== 'undefined' ? window : globalThis);
