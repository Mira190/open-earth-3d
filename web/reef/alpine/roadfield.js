// The sealed roads round the eye, as a field the ground is painted from (terrain.js): 640 m square at 1.25 m, centred
// near the camera and moved in 160 m steps. Each texel holds, for the nearest road within reach:
//   r  the signed distance across its centreline (m; + to the left of the way it was drawn), 99 where there is none
//   g, b  cos and sin of the distance along it over the dash cycle (10 m), so the dashes interpolate smoothly
//   a  the road's kind * 16 + its half-width (m)
// Signed, the distance is linear across a road, so a bilinear read of it is exact and a 10 cm line stays sharp on
// 1.25 m texels, as signed distance fields keep glyphs sharp (Green, "Improved alpha-tested magnification", 2007).
// Where the field steps from one road's side to another road's, or from a road's far side to "no road" (99), a
// bilinear read passes through zero between two texels and would draw a centreline there; a true distance changes by a
// metre a metre, so a read whose gradient is far steeper is no road (valid). The CPU reads the same values (flatJS): the relief is laid flat on the seal for the player, the cars and the GPU alike.
//
// Kinds and widths (roads.json class, from OpenStreetMap):
//   1 a state highway (primary, trunk): two 3.4 m lanes, a 0.1 m white edge line at each lane's outer edge and a broken
//     white centre line, sealed shoulders to 3.9 m from the centre (New Zealand's rural two-lane highways)
//   2 secondary and tertiary roads: 3.2 m lanes, a broken centre line, no edge lines
// Residential streets are left to the township's 0.3 m photographs, which show them well and are not all classed as
// residential in OpenStreetMap; unclassified roads, service roads and tracks too: in the Mackenzie most are gravel.
import * as THREE from 'three/webgpu';
import { texture, vec2, float, abs, floor, fract, atan, smoothstep, select, uniform } from 'three/tsl';

export const KINDS = {
  primary: { kind: 1, hw: 3.9, lane: 3.4 }, trunk: { kind: 1, hw: 3.9, lane: 3.4 },
  secondary: { kind: 2, hw: 3.4, lane: 3.2 }, tertiary: { kind: 2, hw: 3.3, lane: 3.2 },
};
export const DASH = 10, DASH_ON = 3;          // the broken centre line: a 3 m stripe and a 7 m gap
const N = 512, SPAN = 640, PX = SPAN / N, STEP = 160, REACH = 3;
const FAR = 99;

export function createRoadField(base) {
  const data = new Float32Array(N * N * 4), half = new Uint16Array(N * N * 4);
  const best = new Float32Array(N * N);
  const H = v => THREE.DataUtils.toHalfFloat(v);
  const H_FAR = H(FAR), H_ONE = H(1), H_ZERO = H(0);
  const tex = new THREE.DataTexture(half, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const origin = uniform(new THREE.Vector2(-1e7, -1e7));   // the window's west and south edges (m east, m north)
  let lines = [], key = '';
  const clear = () => {
    for (let i = 0; i < N * N; i++) { data[i * 4] = FAR; data[i * 4 + 1] = 1; data[i * 4 + 2] = 0; data[i * 4 + 3] = 0; best[i] = 1e9; half[i * 4] = H_FAR; half[i * 4 + 1] = H_ONE; half[i * 4 + 2] = H_ZERO; half[i * 4 + 3] = H_ZERO; }
  };
  clear();
  const ready = fetch(base + 'roads.json').then(r => r.json()).then(j => {
    lines = (j.lines || []).filter(l => KINDS[l.c]).map(l => {
      const p = l.p, cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return { ...KINDS[l.c], c: l.c, n: l.n, p, cum, box: [x0, x1, y0, y1] };
    });
    key = '';
  }).catch(e => { console.warn('roads: none painted', e); });

  function fill(ox, oy) {
    clear();
    for (const L of lines) {
      const [bx0, bx1, by0, by1] = L.box, r = L.hw + REACH;
      if (bx1 + r < ox || bx0 - r > ox + SPAN || by1 + r < oy || by0 - r > oy + SPAN) continue;
      const code = L.kind * 16 + L.hw;
      for (let k = 1; k < L.p.length; k++) {
        const ax = L.p[k - 1][0], ay = L.p[k - 1][1], dx = L.p[k][0] - ax, dy = L.p[k][1] - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
        if (len < 1e-3) continue;
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - r - ox) / PX)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, ax + dx) + r - ox) / PX));
        const j0 = Math.max(0, Math.floor((Math.min(ay, ay + dy) - r - oy) / PX)), j1 = Math.min(N - 1, Math.ceil((Math.max(ay, ay + dy) + r - oy) / PX));
        for (let j = j0; j <= j1; j++) {
          const py = oy + (j + 0.5) * PX - ay;
          for (let i = i0; i <= i1; i++) {
            const px = ox + (i + 0.5) * PX - ax;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
            const ex = px - dx * t, ey = py - dy * t, dd = Math.hypot(ex, ey), o = j * N + i;
            if (dd > r || dd >= best[o]) continue;
            best[o] = dd;
            const side = dx * py - dy * px >= 0 ? 1 : -1, s = L.cum[k - 1] + t * len, ph = s / DASH * 2 * Math.PI;
            data[o * 4] = side * dd; data[o * 4 + 1] = Math.cos(ph); data[o * 4 + 2] = Math.sin(ph); data[o * 4 + 3] = code;
          }
        }
      }
    }
    for (let o = 0; o < N * N; o++) {
      if (best[o] > 1e8) continue;
      half[o * 4] = H(data[o * 4]); half[o * 4 + 1] = H(data[o * 4 + 1]); half[o * 4 + 2] = H(data[o * 4 + 2]); half[o * 4 + 3] = H(data[o * 4 + 3]);
    }
    tex.needsUpdate = true;
    origin.value.set(ox, oy);
  }
  // keep the window round the camera (three.js position: x east, z south)
  function update(cam) {
    if (!lines.length) return;
    const ox = Math.floor(cam.x / STEP) * STEP - (SPAN - STEP) / 2, oy = Math.floor(-cam.z / STEP) * STEP - (SPAN - STEP) / 2;
    const k = ox + ',' + oy;
    if (k === key) return;
    key = k; fill(ox, oy);
  }
  // the field at a point, bilinear like the GPU's read: [signed distance, kind, half-width]; null outside the window
  function at(x, north) {
    const fx = (x - origin.value.x) / PX - 0.5, fy = (north - origin.value.y) / PX - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return null;
    const ax = fx - i, ay = fy - j, o = j * N + i;
    const v = c => (data[o * 4 + c] * (1 - ax) + data[(o + 1) * 4 + c] * ax) * (1 - ay) + (data[(o + N) * 4 + c] * (1 - ax) + data[(o + N + 1) * 4 + c] * ax) * ay;
    const a = Math.max(data[o * 4 + 3], data[(o + 1) * 4 + 3], data[(o + N) * 4 + 3], data[(o + N + 1) * 4 + 3]);
    return [v(0), Math.floor(a / 16), a - Math.floor(a / 16) * 16];
  }
  const E = 0.5, GMAX = 1.6;
  const validJS = (x, north, r) => { const a = at(x + E, north), b = at(x, north + E); return !!a && !!b && Math.abs(a[0] - r) < GMAX * E && Math.abs(b[0] - r) < GMAX * E; };
  // how flat the ground is laid for a road: 1 on the seal, easing to 0 over the 2 m past its edge (the formation's batters)
  const flatJS = (x, north) => {
    const f = at(x, north);
    if (!f || f[1] === 0 || !validJS(x, north, f[0])) return 0;
    const u = Math.min(1, Math.max(0, (Math.abs(f[0]) - f[2] - 0.3) / 2));
    return 1 - u * u * (3 - 2 * u);
  };
  // the GPU's read: the field's texel at a world point (x east, z = -north)
  const sample = (x, z) => texture(tex, vec2(x.sub(origin.x).div(SPAN), z.negate().sub(origin.y).div(SPAN))).level(0);
  const valid = (x, z, r) => {
    const a = sample(x.add(E), z).r, b = sample(x, z.sub(E)).r;
    return float(1).sub(smoothstep(GMAX * E * 0.8, GMAX * E, abs(a.sub(r)).max(abs(b.sub(r)))));
  };
  const flat = (x, z) => {
    const f = sample(x, z), kind = floor(f.a.div(16).add(1e-3)), hw = f.a.sub(kind.mul(16));
    return select(kind.greaterThan(0.5), float(1).sub(smoothstep(hw.add(0.3), hw.add(2.3), abs(f.r))), float(0)).mul(valid(x, z, f.r));
  };
  // the phase along the road over the dash cycle, 0..1
  const phase = f => fract(atan(f.b, f.g).div(2 * Math.PI).add(1));
  return { tex, sample, valid, flat, flatJS, phase, at, update, ready, origin, span: SPAN };
}
