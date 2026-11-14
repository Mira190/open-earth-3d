// The far crowd's copy of one scanned NPC (issue 475): the geometry half of pipeline/crowd_cast.py.
//   node pipeline/crowd_cast.mjs <character.glb> <clips.glb> <target triangles>   -> JSON on stdout
// Reads an NPC built by blender/build_people.py --npcs (meshopt-compressed, quantised), stands it in the first frame
// of its sex's Idle_Neutral clip (the pose the near walker stands in between strides), and simplifies each of its
// pictures' parts with meshoptimizer's simplifier (MIT, pipeline/vendor/), keeping the texture seams, the borders
// between the body, the head and the hair cards, and the parts the far crowd's shader swings (people.js crowdPose:
// 1/2 left/right thigh, 5/6 shin and foot, 3/4 arm and hand, 0 the rest, as pipeline/fetch_people.py part_of).
// Out: per picture (body, head, hair) the posed positions and normals in the rig's root frame (metres, y up, as the
// near walker's model is drawn), its texture coordinates, parts and triangles; and the pivots the shader swings about.
import fs from 'fs';
import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.mjs';
import { MeshoptSimplifier } from './vendor/meshoptimizer/meshopt_simplifier.mjs';

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function readGlb(file) {
  const buf = fs.readFileSync(file);
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  const views = json.bufferViews.map(v => {
    const ex = v.extensions && v.extensions.EXT_meshopt_compression;
    if (!ex) return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const out = new Uint8Array(ex.count * ex.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ex.count, ex.byteStride, bin.subarray(ex.byteOffset || 0, (ex.byteOffset || 0) + ex.byteLength), ex.mode, ex.filter || 'NONE');
    return Buffer.from(out.buffer);
  });
  // an accessor as floats (normalised integers to -1..1 or 0..1), count x comps
  const read = i => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = COMPS[a.type], C = CT[a.componentType];
    const ex = v.extensions && v.extensions.EXT_meshopt_compression;
    const stride = (ex ? ex.byteStride : v.byteStride) || n * C.BYTES_PER_ELEMENT, src = views[a.bufferView], out = new Float32Array(a.count * n);
    const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      let x = dv[get]((a.byteOffset || 0) + k * stride + c * C.BYTES_PER_ELEMENT, true);
      if (a.normalized) x = Math.max(-1, x / NORM[a.componentType]);
      out[k * n + c] = x;
    }
    return out;
  };
  return { json, read, views };
}

// ---- 4x4 matrices, column-major as glTF
const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const trs = (t, q, s) => {
  const [x, y, z, w] = q, o = new Float64Array(16);
  o[0] = (1 - 2 * (y * y + z * z)) * s[0]; o[1] = (2 * (x * y + z * w)) * s[0]; o[2] = (2 * (x * z - y * w)) * s[0];
  o[4] = (2 * (x * y - z * w)) * s[1]; o[5] = (1 - 2 * (x * x + z * z)) * s[1]; o[6] = (2 * (y * z + x * w)) * s[1];
  o[8] = (2 * (x * z + y * w)) * s[2]; o[9] = (2 * (y * z - x * w)) * s[2]; o[10] = (1 - 2 * (x * x + y * y)) * s[2];
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
  return o;
};
const xf = (m, x, y, z, w = 1) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];

// the first frame of a clip, by node name: { name: { translation, rotation, scale } }
function clipPose(clips, name) {
  const a = clips.json.animations.find(x => x.name === name), pose = {};
  for (const ch of a.channels) {
    const node = clips.json.nodes[ch.target.node].name, s = a.samplers[ch.sampler], v = clips.read(s.output), n = { translation: 3, rotation: 4, scale: 3 }[ch.target.path];
    if (!n) continue;
    (pose[node] = pose[node] || {})[ch.target.path] = Array.from(v.subarray(0, n));
  }
  return pose;
}

function part(joint) {
  const m = /^Bip01 ([LR]) (.+)$/.exec(joint);
  if (!m) return 0;
  const left = m[1] === 'L', b = m[2];
  if (b === 'Thigh') return left ? 1 : 2;
  if (/^(Calf|Foot|Toe)/.test(b)) return left ? 5 : 6;
  if (/^(UpperArm|Forearm|Hand|Finger)/.test(b)) return left ? 3 : 4;
  return 0;
}

async function main() {
  const [file, clipsFile, target] = process.argv.slice(2);
  await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
  const g = readGlb(file), clips = readGlb(clipsFile), pose = clipPose(clips, 'Idle_Neutral');
  const J = g.json, nodes = J.nodes, root = J.scenes[J.scene || 0].nodes[0];
  // world matrices of the posed rig, from the scene's root (the frame people.js draws the model in)
  const world = [], parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const local = i => { const n = nodes[i], p = pose[n.name] || {}; return trs(p.translation || n.translation || [0, 0, 0], p.rotation || n.rotation || [0, 0, 0, 1], p.scale || n.scale || [1, 1, 1]); };
  const W = i => world[i] || (world[i] = parent[i] === undefined ? local(i) : mul(W(parent[i]), local(i)));
  const skin = J.skins[0], ibm = g.read(skin.inverseBindMatrices), jm = skin.joints.map((j, k) => mul(W(j), ibm.subarray(k * 16, k * 16 + 16)));
  const jointName = skin.joints.map(j => nodes[j].name);
  const at = name => { const i = nodes.findIndex(n => n.name === name); const m = W(i); return [m[12], m[13], m[14]]; };
  const mid = (a, b) => { const p = at(a), q = at(b); return [+((p[1] + q[1]) / 2).toFixed(4), +((p[2] + q[2]) / 2).toFixed(4)]; };
  const out = { pivots: { hip: mid('Bip01 L Thigh', 'Bip01 R Thigh'), knee: mid('Bip01 L Calf', 'Bip01 R Calf'), shoulder: mid('Bip01 L UpperArm', 'Bip01 R UpperArm') }, parts: [] };
  const mesh = J.meshes[nodes.findIndex(n => n.mesh !== undefined && n.skin !== undefined) >= 0 ? nodes.find(n => n.skin !== undefined).mesh : 0];
  const prims = mesh.primitives.map(pr => {
    const A = pr.attributes, P = g.read(A.POSITION), N = g.read(A.NORMAL), UV = g.read(A.TEXCOORD_0), Js = g.read(A.JOINTS_0), Ws = g.read(A.WEIGHTS_0), I = g.read(pr.indices);
    const n = P.length / 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), prt = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      const m = new Float64Array(16); let best = 0, bw = -1, ws = 0;
      for (let k = 0; k < 4; k++) ws += Ws[v * 4 + k];
      for (let k = 0; k < 4; k++) {
        const w = Ws[v * 4 + k] / (ws || 1), j = Js[v * 4 + k];
        if (w > bw) { bw = w; best = j; }
        if (w) for (let e = 0; e < 16; e++) m[e] += w * jm[j][e];
      }
      const p = xf(m, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), q = xf(m, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], 0), l = Math.hypot(...q) || 1;
      pos.set(p, v * 3); nrm.set([q[0] / l, q[1] / l, q[2] / l], v * 3); prt[v] = part(jointName[best]);
    }
    const mat = J.materials[pr.material].name;
    return { mat, kind: /_opacity$/.test(mat) ? 'hair' : /_head$/.test(mat) ? 'head' : 'body', pos, nrm, uv: UV, prt, idx: Uint32Array.from(I) };
  });
  // each triangle takes one part (two of its corners', else its first corner's); a corner on a part's edge is
  // split, so the simplifier keeps the edge where the shader bends the body (as a texture seam is kept)
  const total = prims.reduce((s, p) => s + p.idx.length / 3, 0);
  for (const p of prims) {
    const T = p.idx.length / 3, key = new Map(), V = [], tri = new Uint32Array(p.idx.length), tp = new Uint8Array(T);
    for (let t = 0; t < T; t++) {
      const [a, b, c] = [p.prt[p.idx[t * 3]], p.prt[p.idx[t * 3 + 1]], p.prt[p.idx[t * 3 + 2]]];
      tp[t] = (b === c) ? b : a;
      for (let k = 0; k < 3; k++) {
        const v = p.idx[t * 3 + k], kk = v * 8 + tp[t];
        if (!key.has(kk)) { key.set(kk, V.length); V.push([v, tp[t]]); }
        tri[t * 3 + k] = key.get(kk);
      }
    }
    const n = V.length, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), prt = new Uint8Array(n);
    V.forEach(([v, q], i) => { pos.set(p.pos.subarray(v * 3, v * 3 + 3), i * 3); nrm.set(p.nrm.subarray(v * 3, v * 3 + 3), i * 3); uv.set(p.uv.subarray(v * 2, v * 2 + 2), i * 2); prt[i] = q; });
    // the share of the target this picture gets: by its triangles, the hair cards held to a fifth of theirs at least
    const want = Math.round(Math.max(p.kind === 'hair' ? 0.2 * T : 0, target * T / total)) * 3;
    const attrs = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) attrs.set([uv[i * 2], uv[i * 2 + 1], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], i * 5);
    const [idx, err] = MeshoptSimplifier.simplifyWithAttributes(tri, pos, 3, attrs, 5, [1.5, 1.5, 0.3, 0.3, 0.3], null, Math.min(tri.length, want), 0.2,
      p.kind === 'hair' ? [] : ['LockBorder']);
    // the vertices still used, in order
    const used = new Map(), keep = [];
    const ix = Array.from(idx, v => { if (!used.has(v)) { used.set(v, keep.length); keep.push(v); } return used.get(v); });
    out.parts.push({ kind: p.kind, material: p.mat, triangles_before: T, error: +err.toFixed(5),
      pos: keep.flatMap(v => Array.from(pos.subarray(v * 3, v * 3 + 3), x => +x.toFixed(5))),
      nrm: keep.flatMap(v => Array.from(nrm.subarray(v * 3, v * 3 + 3), x => +x.toFixed(4))),
      uv: keep.flatMap(v => Array.from(uv.subarray(v * 2, v * 2 + 2), x => +x.toFixed(5))),
      part: keep.map(v => prt[v]), idx: ix });
  }
  process.stdout.write(JSON.stringify(out));
}
main().catch(e => { console.error(e); process.exit(1); });
