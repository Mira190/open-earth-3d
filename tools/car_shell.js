// Is each traffic model a closed body from every side, at each of its distances (issue 525: a bus drawn as a shell)?
// Reads web/assets/vehicles/cars.glb and cars_far.glb as the page does, and for each model's near, mid and far mesh
// looks at it square on from its six sides: how much of the near model's outline the mesh fills, and how much of what
// it shows is the inside of a face (its back towards the eye, which the traffic's shader paints near black).
//   node tools/car_shell.js [--max-open 0.03] [--min-fill 0.9] [--json] [--materials <mesh>]
// Exits 1 when a mesh shows more of its inside than --max-open of its outline or fills less than --min-fill of the
// near model's. The underside is not judged: the arches and the floor are open in the near models too.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'web/assets/vehicles');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MAX_OPEN = arg('--max-open', 0.03), MIN_FILL = arg('--min-fill', 0.9), JSON_OUT = process.argv.includes('--json');
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

async function read(file) {
  const { MeshoptDecoder } = await import(path.join(ROOT, 'pipeline/vendor/meshoptimizer/meshopt_decoder.mjs'));
  await MeshoptDecoder.ready;
  const buf = fs.readFileSync(file);
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  const views = json.bufferViews.map(v => {
    const e = v.extensions && v.extensions.EXT_meshopt_compression;
    if (!e) return { data: bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), stride: v.byteStride || 0 };
    const out = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, e.count, e.byteStride, bin.subarray(e.byteOffset || 0, (e.byteOffset || 0) + e.byteLength), e.mode, e.filter);
    return { data: out, stride: e.byteStride };
  });
  const accessor = i => {
    const a = json.accessors[i], v = views[a.bufferView], n = N[a.type], sz = SIZE[a.componentType], stride = v.stride || n * sz;
    const dv = new DataView(v.data.buffer, v.data.byteOffset + (a.byteOffset || 0)), out = new Float64Array(a.count * n);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const x = dv[get](k * stride + c * sz, true); out[k * n + c] = norm ? Math.max(-1, x / norm) : x; }
    return out;
  };
  // each top node's triangles in the scene's frame (its translation, rotation and scale: the cars have no deeper tree)
  const mat = nd => {
    if (nd.matrix) return nd.matrix;
    const [x, y, z, w] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], [tx, ty, tz] = nd.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const out = {};
  for (const ni of json.scenes[json.scene || 0].nodes) {
    const nd = json.nodes[ni];
    if (nd.mesh == null) continue;
    const m = mat(nd), tris = [], parts = [];
    const flip = (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])) < 0;
    for (const p of json.meshes[nd.mesh].primitives) {
      const P = accessor(p.attributes.POSITION), I = p.indices != null ? accessor(p.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
      const M = json.materials[p.material] || {};
      const part = { material: M.name, triangles: I.length / 3, doubleSided: !!M.doubleSided, alphaMode: M.alphaMode || 'OPAQUE',
        alpha: M.pbrMetallicRoughness && M.pbrMetallicRoughness.baseColorFactor ? M.pbrMetallicRoughness.baseColorFactor[3] : 1 };
      parts.push(part);
      for (let t = 0; t < I.length; t += 3) {
        const tri = [];
        for (const k of flip ? [0, 2, 1] : [0, 1, 2]) { const i = I[t + k] * 3, x = P[i], y = P[i + 1], z = P[i + 2]; tri.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]); }
        tri.part = part;
        tris.push(tri);
      }
    }
    out[nd.name] = { tris, parts };
  }
  return out;
}

// the mesh seen square on along axis `ax` from its + or - side, on a grid of `px` m: per cell, 0 nothing, 1 the outside
// of a face nearest the eye, 2 the inside of one; `by` counts the cells showing an inside by the face's material
function view(tris, ax, sign, box, px, by) {
  const u = (ax + 1) % 3, v = (ax + 2) % 3, W = Math.ceil((box[3 + u] - box[u]) / px) + 2, H = Math.ceil((box[3 + v] - box[v]) / px) + 2;
  const depth = new Float64Array(W * H).fill(-Infinity), kind = new Uint8Array(W * H), who = by ? new Array(W * H) : null;
  for (const t of tris) {
    const a = [t[0], t[1], t[2]], b = [t[3], t[4], t[5]], c = [t[6], t[7], t[8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = (b[u] - a[u]) * (c[v] - a[v]) - (b[v] - a[v]) * (c[u] - a[u]);
    if (Math.abs(area) < 1e-12) continue;
    const front = n[ax] * sign > 0 ? 1 : 2;
    const i0 = Math.max(0, Math.floor((Math.min(a[u], b[u], c[u]) - box[u]) / px)), i1 = Math.min(W - 1, Math.ceil((Math.max(a[u], b[u], c[u]) - box[u]) / px));
    const j0 = Math.max(0, Math.floor((Math.min(a[v], b[v], c[v]) - box[v]) / px)), j1 = Math.min(H - 1, Math.ceil((Math.max(a[v], b[v], c[v]) - box[v]) / px));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = box[u] + (i + 0.5) * px, y = box[v] + (j + 0.5) * px;
      const w0 = ((b[u] - x) * (c[v] - y) - (b[v] - y) * (c[u] - x)) / area, w1 = ((c[u] - x) * (a[v] - y) - (c[v] - y) * (a[u] - x)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const d = (w0 * a[ax] + w1 * b[ax] + w2 * c[ax]) * sign;
      if (d > depth[j * W + i]) { depth[j * W + i] = d; kind[j * W + i] = front; if (who) who[j * W + i] = t.part.material; }
    }
  }
  if (by) for (let i = 0; i < kind.length; i++) if (kind[i] === 2 || (by.all && kind[i])) by[who[i]] = (by[who[i]] || 0) + 1;
  return kind;
}

(async () => {
  const full = await read(path.join(DIR, 'cars.glb')), far = await read(path.join(DIR, 'cars_far.glb'));
  const meshes = Object.entries(full).filter(([k]) => !/_Cabin$|_Steering$/.test(k)).map(([k, v]) => [k, v, 'cars.glb'])
    .concat(Object.entries(far).map(([k, v]) => [k, v, 'cars_far.glb']));
  const SIDES = [[0, 1, 'left'], [0, -1, 'right'], [1, 1, 'top'], [1, -1, 'under'], [2, 1, 'front'], [2, -1, 'back']];
  // --materials <mesh>: what that mesh shows from each side, by material, in m²
  const one = process.argv.indexOf('--materials');
  if (one > 0) {
    const name = process.argv[one + 1], m = full[name] || far[name];
    if (!m) { console.log(`no mesh ${name}: ${Object.keys(full).join(', ')}`); process.exit(2); }
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of m.tris) for (let k = 0; k < 9; k++) { box[k % 3] = Math.min(box[k % 3], t[k]); box[3 + k % 3] = Math.max(box[3 + k % 3], t[k]); }
    for (const [ax, sign, side] of SIDES) {
      const by = {};
      Object.defineProperty(by, 'all', { value: true });
      view(m.tris, ax, sign, box, 0.02, by);
      console.log(side.padEnd(6) + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 0.0004).toFixed(2)}`).join('  '));
    }
    return;
  }
  const rows = [];
  let bad = 0;
  for (const [name, m, file] of meshes) {
    const model = name.split('_LOD')[0], ref = full[model];
    if (!ref) continue;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of ref.tris) for (let k = 0; k < 9; k++) { box[k % 3] = Math.min(box[k % 3], t[k]); box[3 + k % 3] = Math.max(box[3 + k % 3], t[k]); }
    const row = { mesh: name, file, triangles: m.tris.length, parts: m.parts, sides: {}, inside: {} };
    for (const [ax, sign, side] of SIDES) {
      const a = view(ref.tris, ax, sign, box, 0.02), b = view(m.tris, ax, sign, box, 0.02, side === 'under' ? null : row.inside);
      let outline = 0, filled = 0, open = 0, shown = 0;
      for (let i = 0; i < a.length; i++) { if (a[i]) { outline++; if (b[i]) filled++; } if (b[i]) { shown++; if (b[i] === 2) open++; } }
      const r = { fill: filled / outline, open: open / Math.max(1, shown) };
      row.sides[side] = r;
      if (side !== 'under' && (r.open > MAX_OPEN || r.fill < MIN_FILL)) { bad++; row.bad = (row.bad || []).concat(side); }
    }
    rows.push(row);
  }
  if (JSON_OUT) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) {
    console.log(`${r.bad ? 'FAIL' : 'ok  '} ${r.mesh.padEnd(16)} ${r.file.padEnd(12)} ${String(r.triangles).padStart(6)} tris  ` +
      Object.entries(r.sides).map(([s, v]) => `${s} ${(v.fill * 100).toFixed(0)}%/${(v.open * 100).toFixed(1)}%`).join('  '));
    if (r.bad) console.log('     inside shown, by material (cells of 2 cm): ' + Object.entries(r.inside).map(([k, v]) => `${k} ${v}`).join(', '));
    const odd = r.parts.filter(p => p.alphaMode !== 'OPAQUE' || p.alpha < 1);
    if (odd.length) console.log('     not opaque in the file: ' + odd.map(p => `${p.material} (${p.alphaMode}, ${p.alpha})`).join(', '));
  }
  console.log(bad ? `${bad} side(s) open or unfilled (each side: % of the near model's outline filled / % of what shows that is a face's inside)` : 'every model closed from every side');
  process.exit(bad ? 1 : 0);
})();
