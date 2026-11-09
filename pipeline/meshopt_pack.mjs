// meshoptimizer's vertex and index codecs for pipeline/pack.py (issue 335): the roof meshes of buildings.bin
// (buildings.json "r" positions 6 and 7) go through them before gzip, about two thirds of the bytes they took
// as delta-coded integers. The encoder and decoder are meshoptimizer's own (MIT, pipeline/vendor/meshoptimizer/);
// the browser decodes with the same library (web/pack.js).
//   node pipeline/meshopt_pack.mjs encode-vertex <count> <stride> < raw > encoded
//   node pipeline/meshopt_pack.mjs encode-index <count> < uint32 triangle list > encoded
//   node pipeline/meshopt_pack.mjs decode-vertex <count> <stride> < encoded > raw
//   node pipeline/meshopt_pack.mjs decode-index <count> < encoded > uint32 triangle list
import { MeshoptEncoder } from './vendor/meshoptimizer/meshopt_encoder.mjs';
import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.mjs';

const LEVEL = 2, VERSION = 1; // the vertex codec's compression level (2 came out smallest on the roofs) and format v1

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = new Uint8Array(Buffer.concat(chunks));
const [mode, count, stride] = [process.argv[2], +process.argv[3], +(process.argv[4] || 4)];
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
let out;
if (mode === 'encode-vertex') out = MeshoptEncoder.encodeVertexBufferLevel(input, count, stride, LEVEL, VERSION);
else if (mode === 'encode-index') out = MeshoptEncoder.encodeIndexBuffer(input, count, 4);
else if (mode === 'decode-vertex') { out = new Uint8Array(count * stride); MeshoptDecoder.decodeVertexBuffer(out, count, stride, input); }
else if (mode === 'decode-index') { out = new Uint8Array(count * 4); MeshoptDecoder.decodeIndexBuffer(out, count, 4, input); }
else throw new Error(`unknown mode ${mode}`);
process.stdout.write(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
