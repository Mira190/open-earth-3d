// A part of a shared .glb as a .glb of its own (issue 335): the scene's top nodes whose names match, with their
// children, meshes, materials and what those use, the rest left out. Buffer views are copied as they are, the
// meshopt-compressed ones still compressed (pipeline/meshopt_glb.mjs), so the part decodes to the same geometry.
//   node pipeline/split_glb.mjs <in.glb> <out.glb> <node name regex> [--no-images] [--near-box]
// --no-images leaves the textures out (the materials keep their names and lose their maps): a part whose
// materials the page builds itself, or takes the textures for from a part loaded earlier (trees.js).
// --near-box gives each kept top node <name>_LOD<n> the box of the model <name> left out (extras.near_box: its
// decoded positions' min x, y, z and max x, y, z, as three.js reads them): the traffic sizes its cars by the near
// model's box (actors.js), the same before the near models have come as after.
// The pages load a model's first part before they can be played and the rest after (issue 335):
//   web/assets/vehicles/cars_far.glb   every car's far model (_LOD2), the traffic's first look (actors.js)
//   web/assets/trees/trees_far.glb     the trees' mid and far models (_LOD1, _LOD2) and the leaf atlas (trees.js)
//   web/assets/trees/trees_near.glb    the near models (_LOD0), without the atlas
// pipeline/split_models.sh writes those from cars.glb and trees.glb; blender/build_vehicles.py and build_trees.py
// run it after them, and tools/check.sh fails on a part older than its model.
import fs from 'fs';
import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.mjs';

const [src, dst, pattern, ...flags] = process.argv.slice(2);
if (!src || !dst || !pattern) { console.error('usage: node pipeline/split_glb.mjs <in.glb> <out.glb> <node name regex> [--no-images]'); process.exit(2); }
const noImages = flags.includes('--no-images'), nearBox = flags.includes('--near-box');
const EXT = 'EXT_meshopt_compression';
const align = (n, a = 4) => Math.ceil(n / a) * a;

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

const { json: J, bin } = readGlb(fs.readFileSync(src));
if ((J.skins || []).length || (J.animations || []).length) throw new Error(`${src}: skins and animations are not split`);
const re = new RegExp(pattern), scene = J.scenes[J.scene || 0];
// the nodes kept, in their order, and where each goes
const keep = [], walk = i => { keep.push(i); for (const c of J.nodes[i].children || []) walk(c); };
for (const i of scene.nodes) if (re.test(J.nodes[i].name || '')) walk(i);
if (!keep.length) throw new Error(`${src}: no node matches /${pattern}/`);
const map = used => { const m = new Map(); [...used].sort((a, b) => a - b).forEach((v, k) => m.set(v, k)); return m; }; // old index -> new
const nodeOf = map(keep);
const meshes = new Set(keep.map(i => J.nodes[i].mesh).filter(v => v != null)), meshOf = map(meshes);
const accs = new Set(), mats = new Set();
for (const m of meshes) for (const p of J.meshes[m].primitives) {
  for (const a of Object.values(p.attributes)) accs.add(a);
  if (p.indices != null) accs.add(p.indices);
  for (const t of p.targets || []) for (const a of Object.values(t)) accs.add(a);
  if (p.material != null) mats.add(p.material);
}
const accOf = map(accs), matOf = map(mats);
// the textures the materials use (none with --no-images), their images and samplers
const texs = new Set();
const matsOut = [...mats].sort((a, b) => a - b).map(i => JSON.parse(JSON.stringify(J.materials[i])));
const texRefs = []; // [object holding the textureInfo, key]
const findTex = o => { for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') { if (/Texture$/.test(k) && typeof v.index === 'number') texRefs.push([o, k]); else findTex(v); } };
for (const m of matsOut) findTex(m);
if (noImages) for (const [o, k] of texRefs) delete o[k];
else for (const [o, k] of texRefs) texs.add(o[k].index);
const texOf = map(texs), imgs = new Set(), samps = new Set();
for (const t of texs) {
  const T = J.textures[t];
  if (T.source != null) imgs.add(T.source);
  for (const e of Object.values(T.extensions || {})) if (e.source != null) imgs.add(e.source);
  if (T.sampler != null) samps.add(T.sampler);
}
const imgOf = map(imgs), sampOf = map(samps);
const views = new Set([...accs].map(a => J.accessors[a].bufferView).filter(v => v != null).concat([...imgs].map(i => J.images[i].bufferView).filter(v => v != null)));
const viewOf = map(views);

// the binary: each view's bytes (the compressed ones as they are), and a fallback buffer for the decoded ones
const parts = [];
let off = 0, fall = 0, anyFall = false;
const viewsOut = [...views].sort((a, b) => a - b).map(i => {
  const v = JSON.parse(JSON.stringify(J.bufferViews[i])), e = (v.extensions || {})[EXT];
  if (e) {
    if (e.buffer !== 0) throw new Error('compressed data outside the GLB buffer');
    parts.push([bin.subarray(e.byteOffset, e.byteOffset + e.byteLength), off]);
    e.byteOffset = off; off = align(off + e.byteLength);
    v.buffer = 1; v.byteOffset = fall; fall = align(fall + v.byteLength); anyFall = true;
  } else {
    if (v.buffer !== 0) throw new Error('a plain view in another buffer');
    parts.push([bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), off]);
    v.byteOffset = off; off = align(off + v.byteLength);
  }
  return v;
});
const out = Buffer.alloc(off);
for (const [b, o] of parts) b.copy(out, o);

const remapTex = o => { for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') { if (/Texture$/.test(k) && typeof v.index === 'number') v.index = texOf.get(v.index); else remapTex(v); } };
for (const m of matsOut) remapTex(m);
// the near model's box, from its decoded positions (the exponential filter moves them off the accessors' min and max)
await MeshoptDecoder.ready;
function positions(ai) {
  const a = J.accessors[ai], v = J.bufferViews[a.bufferView], e = (v.extensions || {})[EXT], stride = v.byteStride || 12;
  let bytes;
  if (e) { bytes = new Uint8Array(e.count * e.byteStride); MeshoptDecoder.decodeGltfBuffer(bytes, e.count, e.byteStride, new Uint8Array(bin.buffer, bin.byteOffset + e.byteOffset, e.byteLength), e.mode, e.filter); }
  else bytes = new Uint8Array(bin.buffer, bin.byteOffset + (v.byteOffset || 0), v.byteLength);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) out.push(dv.getFloat32((a.byteOffset || 0) + i * stride + 4 * c, true));
  return out;
}
const boxOf = name => {
  const n = J.nodes.find(q => q.name === name);
  if (!n || n.mesh == null || n.translation || n.rotation || n.scale || n.matrix) throw new Error(`${src}: no untransformed node ${name} for its box`);
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of J.meshes[n.mesh].primitives) { const P = positions(p.attributes.POSITION); for (let i = 0; i < P.length; i++) { const c = i % 3; b[c] = Math.min(b[c], P[i]); b[3 + c] = Math.max(b[3 + c], P[i]); } }
  return b;
};

const N = {
  asset: J.asset,
  scene: 0,
  scenes: [{ name: scene.name, nodes: scene.nodes.filter(i => nodeOf.has(i)).map(i => nodeOf.get(i)) }],
  nodes: [...nodeOf.keys()].map(i => {
    const n = JSON.parse(JSON.stringify(J.nodes[i]));
    if (n.mesh != null) n.mesh = meshOf.get(n.mesh);
    if (n.children) n.children = n.children.map(c => nodeOf.get(c));
    if (nearBox && scene.nodes.includes(i)) n.extras = Object.assign({}, n.extras, { near_box: boxOf(n.name.replace(/_LOD\d+$/, '')) });
    return n;
  }),
  meshes: [...meshOf.keys()].map(i => { const m = JSON.parse(JSON.stringify(J.meshes[i])); for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = accOf.get(p.attributes[k]);
    if (p.indices != null) p.indices = accOf.get(p.indices);
    if (p.material != null) p.material = matOf.get(p.material);
    for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = accOf.get(t[k]);
  } return m; }),
  materials: matsOut,
  accessors: [...accOf.keys()].map(i => { const a = JSON.parse(JSON.stringify(J.accessors[i])); if (a.bufferView != null) a.bufferView = viewOf.get(a.bufferView); return a; }),
  bufferViews: viewsOut,
  buffers: [{ byteLength: out.length }].concat(anyFall ? [{ byteLength: fall, extensions: { [EXT]: { fallback: true } } }] : []),
};
if (texs.size) {
  N.textures = [...texOf.keys()].map(i => { const t = JSON.parse(JSON.stringify(J.textures[i])); if (t.source != null) t.source = imgOf.get(t.source); for (const e of Object.values(t.extensions || {})) if (e.source != null) e.source = imgOf.get(e.source); if (t.sampler != null) t.sampler = sampOf.get(t.sampler); return t; });
  N.images = [...imgOf.keys()].map(i => { const im = JSON.parse(JSON.stringify(J.images[i])); if (im.bufferView != null) im.bufferView = viewOf.get(im.bufferView); return im; });
  if (samps.size) N.samplers = [...sampOf.keys()].map(i => J.samplers[i]);
}
const usedExt = new Set([anyFall ? EXT : null, ...JSON.stringify([N.materials, N.textures || []]).match(/"(KHR|EXT)_[a-z_]+"/g) || []].filter(Boolean).map(s => s.replace(/"/g, '')));
const ext = l => (l || []).filter(e => usedExt.has(e));
if (ext(J.extensionsUsed).length) N.extensionsUsed = ext(J.extensionsUsed);
if (ext(J.extensionsRequired).length) N.extensionsRequired = ext(J.extensionsRequired);
fs.writeFileSync(dst, writeGlb(N, out));
console.log(`${dst}: ${N.nodes.length} nodes, ${N.meshes.length} meshes, ${N.images ? N.images.length : 0} images, ${(fs.statSync(dst).size / 1024).toFixed(0)} kB (of ${(fs.statSync(src).size / 1024).toFixed(0)} kB)`);
