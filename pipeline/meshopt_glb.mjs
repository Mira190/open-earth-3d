// Compress the geometry and animation of shared .glb models with EXT_meshopt_compression (issue 148).
//   node pipeline/meshopt_glb.mjs web/assets/vehicles/*.glb ...
//   node pipeline/meshopt_glb.mjs --check web/assets/...      exit 1 if any file is still uncompressed
// The last step of blender/build_vehicles.py, build_trees.py and build_people.py, run on what Blender wrote.
// Every buffer view of vertex attributes, indices and animation is meshopt-encoded in place (no quantisation
// to integers, no reordering, no merging, every node and name kept): integers and indices losslessly (a
// triangle's corners may come back rotated, the same triangle wound the same way), floats through the
// exponential filter at 16 bits against each component's range (a tenth of a millimetre on a car; still
// float32), so the code that reads the geometry (cars.js, people.js) is unchanged. Images stay as they are. The decoded
// views live in a fallback buffer with no data, as gltfpack writes them; three.js r186 decodes them with
// MeshoptDecoder (web/vendor/three/addons/libs/meshopt_decoder.module.js), set on each GLTFLoader.
// A file already compressed is left alone. The encoder is meshoptimizer's own (MIT, pipeline/vendor/).
import fs from 'fs';
import { MeshoptEncoder } from './vendor/meshoptimizer/meshopt_encoder.mjs';
import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.mjs';

const EXT = 'EXT_meshopt_compression';
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const align = (n, a = 4) => Math.ceil(n / a) * a;
const BITS = 16; // the exponential filter's mantissa: 1/65536 of a float attribute's range, a tenth of a millimetre on a car

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  const j = Buffer.from(JSON.stringify(json), 'utf8'), jp = Buffer.alloc(align(j.length), 0x20), bp = Buffer.alloc(align(bin.length));
  j.copy(jp); bin.copy(bp);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bp.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(jp.length, 0x4e4f534a), jp, ch(bp.length, 0x004e4942), bp]);
}

// what each buffer view holds: 'index' (with the primitive modes that use it), 'vertex', 'anim' or 'other'
function uses(json) {
  const acc = new Map(), mark = (a, kind, mode) => {
    if (a == null) return;
    const u = acc.get(a) || { kinds: new Set(), modes: new Set() };
    u.kinds.add(kind); if (mode != null) u.modes.add(mode);
    acc.set(a, u);
  };
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    mark(p.indices, 'index', p.mode == null ? 4 : p.mode);
    for (const a of Object.values(p.attributes || {})) mark(a, 'vertex');
    for (const t of p.targets || []) for (const a of Object.values(t)) mark(a, 'vertex');
  }
  for (const an of json.animations || []) for (const s of an.samplers || []) { mark(s.input, 'anim'); mark(s.output, 'anim'); }
  for (const s of json.skins || []) mark(s.inverseBindMatrices, 'other');
  const views = new Map();
  (json.accessors || []).forEach((a, i) => {
    if (a.bufferView == null || a.sparse) return;
    const v = views.get(a.bufferView) || [];
    v.push({ i, a, u: acc.get(i) || { kinds: new Set(['other']), modes: new Set() } });
    views.set(a.bufferView, v);
  });
  return views;
}

// decoded as written; a triangle list may come back with a triangle's corners rotated (the same
// triangle, wound the same way), which is how meshopt's index codec gains its ratio
function same(back, plan, a) {
  const b = Buffer.from(back);
  if (b.equals(plan.data)) return true;
  if (plan.mode !== 'TRIANGLES') return false;
  const T = plan.stride === 2 ? Uint16Array : Uint32Array, x = new T(b.buffer, b.byteOffset, a.count), d = Buffer.from(plan.data), y = new T(d.buffer.slice(d.byteOffset, d.byteOffset + d.length));
  for (let t = 0; t < a.count; t += 3) {
    const [p, q, r] = [y[t], y[t + 1], y[t + 2]];
    if (!((x[t] === p && x[t + 1] === q && x[t + 2] === r) || (x[t] === q && x[t + 1] === r && x[t + 2] === p) || (x[t] === r && x[t + 1] === p && x[t + 2] === q))) return false;
  }
  return true;
}

// filtered floats: each component within 2^-BITS of its range of what was written
function close(back, src, a) {
  const n = COMPS[a.type], x = new Float32Array(back.buffer, back.byteOffset, src.length), max = new Float64Array(n);
  for (let i = 0; i < src.length; i++) max[i % n] = Math.max(max[i % n], Math.abs(src[i]));
  for (let i = 0; i < src.length; i++) if (!(Math.abs(x[i] - src[i]) <= max[i % n] * 2 ** (1 - BITS) + 1e-30)) return false;
  return true;
}

async function compress(file) {
  const buf = fs.readFileSync(file), { json, bin } = readGlb(buf);
  if ((json.extensionsUsed || []).includes(EXT)) return { file, skipped: 'already compressed', before: buf.length, after: buf.length };
  if ((json.buffers || []).length !== 1 || !bin) return { file, skipped: 'not one embedded buffer', before: buf.length, after: buf.length };
  const views = uses(json), images = new Set((json.images || []).map(m => m.bufferView).filter(v => v != null));
  const out = [], fallback = []; // the new BIN's parts, and the decoded views' places in the fallback buffer
  let outLen = 0, fbLen = 0, packed = 0;
  const put = data => { const pad = align(outLen) - outLen; if (pad) { out.push(Buffer.alloc(pad)); outLen += pad; } const o = outLen; out.push(Buffer.from(data)); outLen += data.length; return o; };
  json.bufferViews.forEach((v, vi) => {
    const raw = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), list = views.get(vi);
    let plan = null;
    if (!images.has(vi) && list && list.length === 1 && !(list[0].a.byteOffset > 0)) {
      const { a, u } = list[0], el = SIZE[a.componentType] * COMPS[a.type];
      if (u.kinds.size === 1 && u.kinds.has('index')) {
        if ((el === 2 || el === 4) && a.count * el === v.byteLength && !v.byteStride)
          plan = { mode: [...u.modes].every(m => m === 4) && a.count % 3 === 0 ? 'TRIANGLES' : 'INDICES', stride: el, count: a.count, data: raw };
      } else {
        const stride = v.byteStride || el;
        if (stride % 4 === 0 && stride <= 256 && v.byteLength === a.count * stride) {
          plan = { mode: 'ATTRIBUTES', stride, count: a.count, data: raw };
          // floats (positions, normals, UVs, weights, the clips' keys): the exponential filter, one
          // exponent a component for the whole view, so each keeps BITS of precision against its range
          if (a.componentType === 5126 && stride === el) {
            const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
            if (f.every(Number.isFinite)) plan.filter = { name: 'EXPONENTIAL', src: f, data: Buffer.from(MeshoptEncoder.encodeFilterExp(f, a.count, stride, BITS, 'SharedComponent')) };
          }
        }
        else if (!v.byteStride && u.kinds.size === 1 && u.kinds.has('vertex') && el % 4 && v.byteLength === a.count * el) {
          // a vertex attribute of 1, 2 or 3 bytes (an index into a palette): padded to 4 a vertex
          const s = align(el), d = Buffer.alloc(a.count * s);
          for (let k = 0; k < a.count; k++) raw.copy(d, k * s, k * el, k * el + el);
          plan = { mode: 'ATTRIBUTES', stride: s, count: a.count, data: d, restride: s };
        }
      }
    }
    if (plan) {
      const src = plan.filter ? plan.filter.data : plan.data;
      const enc = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(src.buffer, src.byteOffset, src.length), plan.count, plan.stride, plan.mode);
      if (enc.length < plan.data.length) {
        const back = new Uint8Array(plan.count * plan.stride);
        MeshoptDecoder.decodeGltfBuffer(back, plan.count, plan.stride, enc, plan.mode, plan.filter && plan.filter.name);
        if (plan.filter ? !close(back, plan.filter.src, list[0].a) : !same(back, plan, list[0].a)) throw new Error(`${file}: view ${vi} does not decode to itself`);
        const at = put(enc);
        fbLen = align(fbLen, 16);
        fallback.push(vi);
        v.buffer = 1; v.byteOffset = fbLen; v.byteLength = plan.data.length; fbLen += plan.data.length;
        if (plan.restride) v.byteStride = plan.restride;
        v.extensions = Object.assign({}, v.extensions, { [EXT]: Object.assign({ buffer: 0, byteOffset: at, byteLength: enc.length, byteStride: plan.stride, count: plan.count, mode: plan.mode },
          plan.filter ? { filter: plan.filter.name } : {}) });
        packed++;
        return;
      }
    }
    v.byteOffset = put(raw); v.buffer = 0; // as it was, in the new BIN
  });
  if (!packed) return { file, skipped: 'nothing to compress', before: buf.length, after: buf.length };
  const bin2 = Buffer.concat(out);
  json.buffers = [{ byteLength: align(bin2.length) }, { byteLength: fbLen, extensions: { [EXT]: { fallback: true } } }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), EXT])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), EXT])];
  const glb = writeGlb(json, bin2);
  fs.writeFileSync(file + '.tmp', glb);
  fs.renameSync(file + '.tmp', file);
  return { file, before: buf.length, after: glb.length, packed, views: json.bufferViews.length };
}

const args = process.argv.slice(2), check = args.includes('--check'), files = args.filter(a => !a.startsWith('--'));
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
let bad = 0, b0 = 0, b1 = 0;
for (const f of files) {
  if (check) {
    const { json } = readGlb(fs.readFileSync(f));
    if (!(json.extensionsUsed || []).includes(EXT) && (json.meshes || json.animations)) { console.log(`FAIL ${f}: not meshopt-compressed (node pipeline/meshopt_glb.mjs ${f})`); bad++; }
    continue;
  }
  const r = await compress(f);
  b0 += r.before; b1 += r.after;
  console.log(`${f}: ${(r.before / 1e6).toFixed(2)} -> ${(r.after / 1e6).toFixed(2)} MB${r.skipped ? ` (${r.skipped})` : ` (${r.packed} of ${r.views} views)`}`);
}
if (!check && files.length > 1) console.log(`total ${(b0 / 1e6).toFixed(2)} -> ${(b1 / 1e6).toFixed(2)} MB`);
if (check) console.log(bad ? `${bad} of ${files.length} not compressed` : `ok   meshopt ${files.length} models compressed`);
process.exit(bad ? 1 : 0);
