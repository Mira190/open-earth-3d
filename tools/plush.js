// Mugi, the plush cat who travels while you are away and sends the postcards (docs/POSTCARDS.md, "Who is in
// the picture"). tools/game_shot.js loads this into the game's page for a view with "plush" and builds it there,
// in the game's own light, sat in the scene.
//
//   OEPlush.build('mugi', {scarf}) -> THREE.Group, the head's middle at its origin, the face towards +z, metres
//   OEPlush.KINDS                  -> the characters (one), with their colours
//   OEPlush.R                      -> the head's radius before its squash
//
// Sewn the way a plush is: a wide soft head and a small body in a ginger-and-white coat (a canvas texture),
// bead eyes, a nose and cheeks, ears, paws, a tail, a neckerchief and a bundle on its back; a face panel on
// the head carries the thread (mouth, blush). The cloth is fleece with fur shells over it.
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
  function softCone(r, h, seg = 24) {
    const T = window.THREE, pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, y = t * h, w = r * Math.pow(1 - t, 0.85) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 2)));
      pts.push(new T.Vector2(Math.max(0.0006, w * (t > 0.92 ? 0.6 : 1)), y));
    }
    pts.unshift(new T.Vector2(0.0001, -r * 0.15));
    return new T.LatheGeometry(pts, seg);
  }

  // Mugi's coat on the head and the body, as an equirectangular canvas (SphereGeometry's u = 0.25 is the front,
  // +z): ginger over the crown, the ears' line and the back, white below, the white running up between the eyes
  // in a narrow blaze, the line passing just under the eyes so that they sit in the ginger; three darker tabby
  // stripes on the forehead.
  function coatTexture(c1, c2, stripe) {
    const T = window.THREE, w = 1024, h = 512, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = c2; g.fillRect(0, 0, w, h);
    g.save(); g.filter = 'blur(5px)';
    g.beginPath(); g.moveTo(-10, 0);
    for (let x = -10; x <= w + 10; x += 4) {
      const u = x / w, du = Math.min(Math.abs(u - 0.25), Math.abs(u - 1.25), Math.abs(u + 0.75)); // round the head from the front
      const side = 290 + 50 * Math.min(1, Math.max(0, (du - 0.12) / 0.2)); // under the eyes in front, lower round the back
      const blaze = 110 * Math.exp(-Math.pow(du / 0.022, 2)); // the white up between the eyes
      g.lineTo(x, side - blaze);
    }
    g.lineTo(w + 10, 0); g.closePath(); g.fillStyle = c1; g.fill();
    g.restore();
    // tabby stripes on the forehead (u about 0.25, from the crown down) and a few round the back
    g.strokeStyle = stripe; g.lineCap = 'round';
    for (const [du, y0, y1, lw] of [[0, 70, 165, 16], [-0.03, 85, 160, 13], [0.03, 85, 160, 13]]) { g.lineWidth = lw; g.beginPath(); g.moveTo((0.25 + du) * w, y0); g.lineTo((0.25 + du * 1.15) * w, y1); g.stroke(); }
    for (let i = 0; i < 6; i++) { const u = 0.55 + i * 0.07; g.lineWidth = 18; g.beginPath(); g.moveTo(u * w, 60); g.quadraticCurveTo((u + 0.015) * w, 150, u * w, 240); g.stroke(); }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // the thread on the face panel: the mouth (a small ω under the nose), the blush, the whisker pores
  function faceTexture() {
    const T = window.THREE, n = 1024, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    for (const sx of [-1, 1]) { g.save(); g.filter = 'blur(16px)'; g.beginPath(); g.ellipse(512 + sx * 300, 640, 66, 40, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(255,120,140,0.5)'; g.fill(); g.restore(); }
    g.strokeStyle = '#5a3a34'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(512, 640); g.lineTo(512, 676); // the seam down from the nose
    g.moveTo(462, 662); g.quadraticCurveTo(486, 702, 512, 676); g.quadraticCurveTo(538, 702, 562, 662); g.stroke();
    g.fillStyle = 'rgba(120,80,70,0.55)';
    for (const sx of [-1, 1]) for (const [dx, dy] of [[0, 0], [26, -14], [30, 16]]) { g.beginPath(); g.arc(512 + sx * (118 + dx), 650 + dy, 5, 0, Math.PI * 2); g.fill(); }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // The traveller. One character, the way Travel Frog has one frog: attachment needs someone, not a cast.
  // Designed to the baby schema (Lorenz's Kindchenschema): a big round head on a small body, big glossy bead
  // eyes set below the head's middle and well apart, a small nose and mouth close under them, plump cheeks,
  // short limbs; warm colours (ginger and white) that do not go grey in the blue of a sky; bead eyes rather than
  // printed ones, because a bead catches the real light and a print looks dead (the eyes of good plush: Jellycat,
  // San-X). A neckerchief takes each map's colour (opts.scarf).
  const KINDS = {
    mugi: { name: 'Mugi', what: 'the travelling cat', ginger: '#e8a05a', white: '#fbf6ee', stripe: '#c97a3a', inner: '#f3b3b8', nose: '#ee8f9c', scarf: '#c8323c' },
  };

  function build(kind = 'mugi', opts = {}) {
    const T = window.THREE, k = Object.assign({}, KINDS[kind], opts);
    if (!KINDS[kind]) throw new Error(`no plush "${kind}"`);
    const root = new T.Group(); root.name = `plush-${kind}`;
    const add = (geo, m, pos, scale, rot) => {
      const o = new T.Mesh(geo, m);
      if (pos) o.position.set(...pos);
      if (scale) o.scale.set(...scale);
      if (rot) o.rotation.set(...rot);
      return o;
    };
    const ball = new T.SphereGeometry(1, 64, 40);
    const coat = cloth('#ffffff'); coat.map = coatTexture(k.ginger, k.white, k.stripe);
    const white = cloth(k.white), ginger = cloth(k.ginger);
    // the head: wide, a little flat, as a plush's is
    const hs = [1.22 * R, 0.98 * R, 1.04 * R];
    const head = add(ball, coat, [0, 0, 0], hs);
    root.add(head);
    const onHead = (u, v, out = 1) => { const z = Math.sqrt(Math.max(0, 1 - u * u - v * v)); return new T.Vector3(u * hs[0] * out, v * hs[1] * out, z * hs[2] * out); };
    const normalAt = (u, v) => { const p = onHead(u, v); return new T.Vector3(p.x / (hs[0] * hs[0]), p.y / (hs[1] * hs[1]), p.z / (hs[2] * hs[2])).normalize(); };
    const facing = (mesh, n) => { mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n); return mesh; };
    // the face panel over the pile: mouth, blush, whisker pores
    const faceMat = new T.MeshPhysicalMaterial({ map: faceTexture(), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const face = new T.Mesh(cap(1.045, 62), faceMat); face.renderOrder = 3;
    head.add(face);
    // the muzzle: two plump white cheeks either side under the nose, the "mochi" of a cat's face
    for (const sx of [-1, 1]) root.add(add(ball, white, onHead(sx * 0.16, -0.42, 0.9).toArray(), [R * 0.25, R * 0.2, R * 0.19]));
    root.add(add(ball, white, onHead(0, -0.55, 0.88).toArray(), [R * 0.16, R * 0.12, R * 0.14])); // (the chin)
    // the nose: a small rounded triangle, satin pink
    const nose = facing(add(softCone(1, 1), cloth(k.nose, 'satin'), onHead(0, -0.27, 1.035).toArray(), [R * 0.085, R * 0.075, R * 0.05]), normalAt(0, -0.27));
    nose.rotateZ(Math.PI);
    root.add(nose);
    // the eyes: glossy black beads, domed, low and wide, each with a glint of its own (a white disc: the bead's
    // reflection of a sky it may not have in the game's light) and a smaller one across from it
    const bead = new T.MeshPhysicalMaterial({ color: 0x17110f, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0 });
    const glint = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (const sx of [-1, 1]) {
      const u = sx * 0.41, v = -0.09, n = normalAt(u, v);
      const eye = facing(add(ball, bead, onHead(u, v, 1.03).toArray(), [R * 0.155, R * 0.17, R * 0.09]), n);
      eye.add(add(new T.CircleGeometry(1, 24), glint, [-0.36, 0.38, 0.97], [0.26, 0.26, 1]));
      eye.add(add(new T.CircleGeometry(1, 16), glint, [0.34, -0.36, 0.95], [0.1, 0.1, 1]));
      root.add(eye);
    }
    // the ears: small, set wide and tipped outward, pink inside
    for (const sx of [-1, 1]) {
      const e = add(softCone(1, 1), ginger, onHead(sx * 0.58, 0.7, 0.86).toArray(), [R * 0.44, R * 0.64, R * 0.19], [0.1, 0, -sx * 0.5]);
      e.add(add(softCone(1, 1), cloth(k.inner, 'felt'), [0, 0.06, 0.75], [0.6, 0.72, 0.4]));
      root.add(e);
    }
    // the body: small under the head, ginger back and white front, paws up under the chin, a tail curled round
    root.add(add(ball, coat, [0, -R * 1.12, -R * 0.08], [R * 0.74, R * 0.68, R * 0.64]));
    root.add(add(ball, white, [0, -R * 1.2, R * 0.28], [R * 0.48, R * 0.5, R * 0.36])); // (the belly)
    for (const sx of [-1, 1]) {
      root.add(add(ball, white, [sx * R * 0.36, -R * 0.93, R * 0.5], [R * 0.19, R * 0.16, R * 0.18], [0, 0, sx * 0.3]));
      root.add(add(ball, white, [sx * R * 0.34, -R * 1.62, R * 0.36], [R * 0.2, R * 0.13, R * 0.24])); // (the feet)
    }
    // the tail: out from the back, along the side and up, its tip curled over and white
    const tc = new T.CatmullRomCurve3([[0.15, -1.55, -0.5], [0.62, -1.5, -0.52], [0.98, -1.2, -0.42], [1.04, -0.82, -0.3], [0.86, -0.62, -0.22]].map(p => new T.Vector3(...p).multiplyScalar(R)));
    root.add(add(new T.TubeGeometry(tc, 48, R * 0.115, 14, false), ginger));
    root.add(add(ball, white, tc.getPoint(1).toArray(), [R * 0.125, R * 0.125, R * 0.125]));
    root.add(add(ball, ginger, tc.getPoint(0).toArray(), [R * 0.12, R * 0.12, R * 0.12])); // (where it leaves the body)
    // the neckerchief: a soft cotton triangle, knotted behind, in the map's colour
    const kerchief = add(cap(1, 52), cloth(k.scarf, 'felt'), [0, -R * 0.84, R * 0.0], [R * 0.74, R * 0.5, R * 0.7], [0.42, 0, 0]);
    root.add(kerchief);
    root.add(add(new T.TorusGeometry(R * 0.66, R * 0.05, 12, 48), cloth(k.scarf, 'felt'), [0, -R * 0.8, -R * 0.04], [1, 1, 0.92], [Math.PI / 2 - 0.1, 0, 0]));
    // the furoshiki: a travelling bundle on its back, the cloth spotted, the two corners knotted on top. From
    // behind (where most cards see it) it is Mugi's silhouette: ears, the bundle, the curled tail
    const dots = document.createElement('canvas'); dots.width = 256; dots.height = 128;
    { const g = dots.getContext('2d'); g.fillStyle = k.scarf; g.fillRect(0, 0, 256, 128); g.fillStyle = '#fbf6ee';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { g.beginPath(); g.arc(x * 16 + (y % 2) * 8 + 4, y * 16 + 8, 3.2, 0, Math.PI * 2); g.fill(); } }
    const dt = new T.CanvasTexture(dots); dt.colorSpace = T.SRGBColorSpace; dt.wrapS = dt.wrapT = T.RepeatWrapping; dt.repeat.set(2, 2);
    const bundleMat = cloth('#ffffff', 'felt'); bundleMat.map = dt;
    const bundle = add(ball, bundleMat, [0, -R * 0.9, -R * 0.72], [R * 0.54, R * 0.44, R * 0.26], [0.25, 0, 0]);
    root.add(bundle);
    for (const sx of [-1, 1]) root.add(add(softCone(1, 1), bundleMat, [sx * R * 0.12, -R * 0.62, -R * 0.82], [R * 0.13, R * 0.24, R * 0.08], [0.3, 0, -sx * 0.7]));
    for (const sx of [-1, 1]) root.add(add(new T.TorusGeometry(R * 0.62, R * 0.035, 8, 32, Math.PI * 0.9), cloth(k.scarf, 'felt'), [sx * R * 0.05, -R * 0.95, -R * 0.2], [1, 1.1, 1], [0, sx * Math.PI / 2, Math.PI * 0.55])); // (the straps over the shoulders)
    root.traverse(o => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; o.frustumCulled = false; } });
    // the pile on every fleece part (not on a torus: a tail and a knot are too thin for it)
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => { if (o.isMesh && o.material.normalMap && !o.geometry.parameters.tube) parts.push(o); });
    const ws = new T.Vector3();
    for (const o of parts) fur(o, k.pile || 0.0032, o.getWorldScale(ws).clone());
    return root;
  }

  root.OEPlush = { build, KINDS, R };
})(typeof window !== 'undefined' ? window : globalThis);
