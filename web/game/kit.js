// A kit for building vehicles from parts at real dimensions, adapted from the vessel kit of
// the author's earlier reef scene (not published): lofted hulls, lathed bodies, slabs, fins,
// rods and tubes, merged into one mesh per material so a vessel costs a few draw calls. That
// scene's materials are TSL node materials for a WebGPU renderer; these are the classic
// three.js materials this app renders with, the hull's colour bands set by height in the
// model's own frame.
//
// Model frame: +z forward (the bow, or one end of a double-ended ferry), +y up, +x to port;
// the waterline (or the skids) at y = 0.
'use strict';
window.OEKit = (function () {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const shared = { night: { value: 0 }, mats: null };

  // ------------------------------------------------------------ materials
  function std(o) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.5, metalness: 0 }, o)); }
  function materials() {
    if (shared.mats) return shared.mats;
    const M = {};
    const solid = (c, rough = 0.5, extra = {}) => std(Object.assign({ color: lin(c), roughness: rough }, extra));
    M.white = solid('#f2f4f4', 0.3); M.offwhite = solid('#e6e2d6', 0.45); M.cream = solid('#efe5c8', 0.45);
    M.grey = solid('#8a9296'); M.dark = solid('#1c2024', 0.6); M.black = solid('#0e0f10', 0.8); M.rubber = solid('#2a2d30', 0.85);
    M.alu = solid('#c9ced1', 0.38, { metalness: 0.6 }); M.chrome = solid('#dfe3e6', 0.25, { metalness: 0.8 });
    M.red = solid('#b01f1f', 0.4); M.orange = solid('#e8641b', 0.5); M.yellow = solid('#f2c21a', 0.45); M.gold = solid('#d9a92c', 0.35, { metalness: 0.3 });
    M.deck = solid('#7d6a52', 0.85); M.nonslip = solid('#6b7173', 0.9); M.seat = solid('#2f5d7c', 0.6);
    // glass: dark tinted by day, a warm glow from the cabins after dark
    M.glass = std({ color: lin('#0d1a26'), roughness: 0.06, metalness: 0.2, emissive: lin('#ffb766'), emissiveIntensity: 0 });
    M.glassClear = std({ color: lin('#1a2c3c'), roughness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    // a painted hull: a colour above the waterline, a boot stripe, a band at the sheer and
    // antifouling below, by height in the model frame
    const hulls = {};
    M.hull = (o = {}) => {
      const key = JSON.stringify(o);
      if (hulls[key]) return hulls[key];
      const m = hulls[key] = std({ color: 0xffffff, roughness: 0.32 });
      const u = { hTop: { value: lin(o.top || '#f3f5f5') }, hBand: { value: lin(o.band || '#14365e') }, hAnti: { value: lin(o.anti || '#5a1d18') },
        hBoot: { value: lin(o.boot || o.band || '#14365e') }, hBandY: { value: new THREE.Vector2(...(o.bandY || [0.5, 0.62])) },
        hBootY: { value: new THREE.Vector2(...(o.bootY || [0.0, 0.08])) } };
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHull;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHull = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vHull; uniform vec3 hTop, hBand, hAnti, hBoot; uniform vec2 hBandY, hBootY;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
  { float y = vHull.y, e = fwidth(y) + 0.005;
    vec3 c = mix(hTop, hBand, smoothstep(hBandY.x - e, hBandY.x + e, y) * (1.0 - smoothstep(hBandY.y - e, hBandY.y + e, y)));
    c = mix(c, hBoot, smoothstep(hBootY.x - e, hBootY.x + e, y) * (1.0 - smoothstep(hBootY.y - e, hBootY.y + e, y)));
    c = mix(hAnti, c, smoothstep(hBootY.x - e, hBootY.x + e, y));
    diffuseColor.rgb = c; }`);
      };
      return m;
    };
    shared.mats = M;
    return M;
  }
  // cabins glow after dark
  function setNight(n) { shared.night.value = n; const M = materials(); M.glass.emissiveIntensity = 0.9 * n; for (const s of glows) s.material.opacity = n; }

  // ------------------------------------------------------------ parts
  function clean(g) {
    if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }
  // collects parts per material and merges them into one mesh per material
  class Kit {
    constructor() { this.b = new Map(); }
    add(mat, geo, x, y, z) { // a matrix, or a plain (x, y, z) offset
      let g = geo.clone();
      if (typeof x === 'number') g.translate(x, y || 0, z || 0); else if (x) g.applyMatrix4(x);
      g = clean(g);
      if (!this.b.has(mat)) this.b.set(mat, []);
      this.b.get(mat).push(g);
      return this;
    }
    mirror(mat, geo, x, y, z) { // the part and its twin on the other side (mirror in x)
      this.add(mat, geo, x, y, z);
      const g = geo.clone();
      if (typeof x === 'number') g.translate(x, y || 0, z || 0);
      g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
      const ix = clean(g).index;
      for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i); ix.setX(i, ix.getX(i + 1)); ix.setX(i + 1, t); }
      g.computeVertexNormals();
      return this.add(mat, g);
    }
    build(group = new THREE.Group(), shadows = true) {
      for (const [mat, list] of this.b) {
        const m = new THREE.Mesh(list.length === 1 ? list[0] : THREE.BufferGeometryUtils.mergeGeometries(list, false), mat);
        m.castShadow = shadows; m.receiveShadow = true;
        group.add(m);
      }
      return group;
    }
  }
  const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r1, r0, h, seg); // r0 at the bottom
  function rod(a, b, r0, r1 = r0, seg = 8) { // a cylinder from point a to point b
    a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }
  const ellipsoid = (rx, ry, rz, ws = 16, hs = 10) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
  function rrect(w, d, r, n = 5) { // rounded rectangle in the x-z plan, centred
    const pts = [], hw = w / 2, hd = d / 2;
    const corner = (cx, cz, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
    corner(hw - r, hd - r, 0); corner(-hw + r, hd - r, Math.PI / 2); corner(-hw + r, -hd + r, Math.PI); corner(hw - r, -hd + r, Math.PI * 1.5);
    return pts;
  }
  // a plan outline (x, z) extruded upward from y0 by h; bevel rounds the top edge
  function slab(plan, y0, h, bevel = 0.05) {
    const sh = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(h - bevel * 2, 0.001), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    return g.translate(0, y0 + bevel, 0);
  }
  // a side profile (z, y) extruded across x (thickness t, centred): fins, tail planes
  function fin(profile, t, bevel = 0.01) {
    const sh = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(t - bevel * 2, 0.001), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(-Math.PI / 2);
    return g.translate(t / 2 - bevel, 0, 0);
  }
  function tube(pts, r, seg = 24, rs = 8, closed = false) {
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5);
    return new THREE.TubeGeometry(c, seg, r, rs, closed);
  }
  // a body of revolution along z: profile [(z, radius)] from the tail to the nose
  const lathe = (prof, seg = 20) => new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);

  // a double-ended displacement hull (both ends alike, as on Sydney's ferries): stations along
  // z, each section keel to sheer z = hb u^e, round in the middle and V at the ends
  function hull2(o) {
    const L = o.L, B = o.B, dh = o.dh ?? 1.2, fb = o.fb ?? 1.5, sheerEnd = o.sheerEnd ?? 0.4, nS = o.nS ?? 48, nU = o.nU ?? 10;
    const hb = s => B / 2 * Math.pow(Math.max(1 - Math.pow(Math.abs(s), o.pn ?? 3.2), 0), o.pm ?? 0.55);
    const bot = s => -dh * Math.max(1 - Math.pow(Math.abs(s), o.kp ?? 4), 0) - 0.05;
    const sheer = s => fb + sheerEnd * s * s;
    const ex = s => 0.45 + 0.5 * Math.abs(s);
    const pos = [], idx = [], ring = 2 * nU + 1;
    for (let i = 0; i <= nS; i++) {
      const s = -1 + 2 * i / nS, z = s * L / 2, h = hb(s), yb = bot(s), ys = sheer(s), e = ex(s);
      for (let j = 0; j < ring; j++) {
        const side = j <= nU ? -1 : 1, u = (j <= nU ? nU - j : j - nU) / nU;
        pos.push(side * h * Math.pow(u, e) * (1 + 0.04 * u * u), yb + (ys - yb) * u, z);
      }
    }
    for (let i = 0; i < nS; i++) for (let j = 0; j < ring - 1; j++) { const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1; idx.push(a, b, c, b, d, c); }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shell.setIndex(idx);
    shell.computeVertexNormals();
    const p = shell.attributes.position, n = shell.attributes.normal; let sgn = 0;
    for (let i = 0; i < p.count; i += 5) sgn += p.getX(i) * n.getX(i) + (p.getY(i) + 0.3) * n.getY(i);
    if (sgn < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } shell.setIndex(idx); shell.computeVertexNormals(); }
    // the deck: the sheer outline, a little cambered
    const plan = [];
    for (let i = 0; i <= nS; i++) { const s = -1 + 2 * i / nS; plan.push([hb(s) * 0.995, s * L / 2]); }
    for (let i = nS; i >= 0; i--) { const s = -1 + 2 * i / nS; plan.push([-hb(s) * 0.995, s * L / 2]); }
    return { shell, plan, hb: z => hb(2 * z / L), sheer: z => sheer(2 * z / L), L, B };
  }

  // ------------------------------------------------------------ lamps
  let glowTex = null;
  const glows = [];
  function glow(color) {
    if (!glowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      glowTex = new THREE.CanvasTexture(c);
    }
    return new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: shared.night.value });
  }
  function lamp(group, color, x, y, z, size = 1.2) { // navigation and deck lights, seen after dark
    const s = new THREE.Sprite(glow(color));
    s.position.set(x, y, z); s.scale.set(size * 1.6, size * 1.6, 1); s.renderOrder = 20;
    group.add(s); glows.push(s);
    return s;
  }

  return { materials, setNight, shared, Kit, box, cyl, rod, ellipsoid, rrect, slab, fin, tube, lathe, hull2, lamp };
})();
