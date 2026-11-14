// Who keeps the array buffers (issue 406): reads a heap snapshot (tools/mem_check.js SNAP=file) and sums every
// ArrayBuffer's backing store by the path that holds it from the page's roots, the shortest one (the names of the
// properties, closure variables and array places on the way, as the DevTools' Retainers panel shows them). A typed
// array the page made by length and keeps only in a closure is invisible to mem_check.js OWNERS; here it has a name.
//   SNAP=/tmp/%c.heapsnapshot xvfb-run -a node tools/mem_check.js tokyo
//   node --max-old-space-size=8000 tools/heap_owners.js /tmp/tokyo.heapsnapshot [depth=6] [top=40]
// Also lists the plain objects by constructor (count and self size) for the largest kinds.
'use strict';
const fs = require('fs');
const [,, file, depthArg = '6', topArg = '40'] = process.argv;
const DEPTH = +depthArg, TOP = +topArg;
// (a large page's snapshot is longer than a string can be: its number arrays are read straight from the bytes)
const S = (() => {
  const buf = fs.readFileSync(file), at = k => buf.indexOf(k);
  const iN = at('"nodes":['), iE = at('"edges":['), iS = buf.indexOf('"strings":[');
  const head = JSON.parse(buf.slice(0, iN).toString().replace(/,\s*$/, '') + '}');
  const ints = (from, count) => {
    const out = new Uint32Array(count);
    let k = 0, v = 0, inNum = false;
    for (let i = from; k < count; i++) {
      const c = buf[i];
      if (c >= 48 && c <= 57) { v = v * 10 + c - 48; inNum = true; } else if (inNum) { out[k++] = v; v = 0; inNum = false; } else if (c === 93) break;
    }
    return out;
  };
  const sm = head.snapshot.meta;
  const nodes = ints(iN + 9, head.snapshot.node_count * sm.node_fields.length), edges = ints(iE + 9, head.snapshot.edge_count * sm.edge_fields.length);
  const end = buf.lastIndexOf(']');
  return { snapshot: head.snapshot, nodes, edges, strings: JSON.parse(buf.slice(iS + 10, end + 1).toString()) };
})();
const M = S.snapshot.meta, NF = M.node_fields.length, EF = M.edge_fields.length;
const nT = M.node_types[0], eT = M.edge_types[0];
const nTypeI = M.node_fields.indexOf('type'), nNameI = M.node_fields.indexOf('name'), nSizeI = M.node_fields.indexOf('self_size'), nEdgeI = M.node_fields.indexOf('edge_count');
const eTypeI = M.edge_fields.indexOf('type'), eNameI = M.edge_fields.indexOf('name_or_index'), eToI = M.edge_fields.indexOf('to_node');
const N = S.nodes, E = S.edges, STR = S.strings, n = N.length / NF;
// each node's first edge, and the reverse edges (retainers)
const first = new Uint32Array(n + 1);
for (let i = 0, e = 0; i < n; i++) { first[i] = e; e += N[i * NF + nEdgeI] * EF; first[i + 1] = e; }
const rc = new Uint32Array(n + 1);
const weak = eT.indexOf('weak'), shortcut = eT.indexOf('shortcut');
for (let i = 0; i < n; i++) for (let e = first[i]; e < first[i + 1]; e += EF) { const t = E[e + eTypeI]; if (t !== weak && t !== shortcut) rc[E[e + eToI] / NF + 1]++; }
for (let i = 0; i < n; i++) rc[i + 1] += rc[i];
const rFrom = new Uint32Array(rc[n]), rEdge = new Uint32Array(rc[n]), fill = rc.slice(0, n);
for (let i = 0; i < n; i++) for (let e = first[i]; e < first[i + 1]; e += EF) {
  const t = E[e + eTypeI]; if (t === weak || t === shortcut) continue;
  const j = E[e + eToI] / NF, k = fill[j]++; rFrom[k] = i; rEdge[k] = e;
}
// the distance of each node from the roots (breadth first over strong edges)
const dist = new Int32Array(n).fill(-1), q = new Uint32Array(n);
let qh = 0, qt = 0; dist[0] = 0; q[qt++] = 0;
while (qh < qt) {
  const i = q[qh++];
  for (let e = first[i]; e < first[i + 1]; e += EF) {
    const t = E[e + eTypeI]; if (t === weak || t === shortcut) continue;
    const j = E[e + eToI] / NF; if (dist[j] < 0) { dist[j] = dist[i] + 1; q[qt++] = j; }
  }
}
const name = i => STR[N[i * NF + nNameI]], type = i => nT[N[i * NF + nTypeI]];
const edgeName = e => { const t = eT[E[e + eTypeI]]; const v = E[e + eNameI]; return t === 'element' || t === 'hidden' ? `[${v}]` : STR[v]; };
// the path that holds node i: up the retainer nearest the roots, DEPTH steps, skipping the typed-array/ArrayBuffer glue
function path(i) {
  const out = [];
  let cur = i;
  for (let d = 0; d < DEPTH + 3 && dist[cur] > 0; d++) {
    let best = -1, be = -1;
    for (let k = rc[cur]; k < rc[cur + 1]; k++) { const f = rFrom[k]; if (dist[f] >= 0 && (best < 0 || dist[f] < dist[best])) { best = f; be = rEdge[k]; } }
    if (best < 0) break;
    const en = edgeName(be), tn = type(best), nm = name(best);
    if (!/^(buffer|backing_store|map|__proto__)$/.test(en)) out.push(tn === 'closure' ? `${en} (in ${nm || 'fn'}())` : tn === 'object' && nm !== 'Object' && nm !== 'Array' && !/^system/.test(nm) ? `${en} (${nm})` : en);
    if (out.length >= DEPTH) break;
    cur = best;
  }
  return out.reverse().join(' . ');
}
const by = new Map(), kinds = new Map();
let total = 0;
for (let i = 0; i < n; i++) {
  const tn = type(i), nm = name(i), sz = N[i * NF + nSizeI];
  if (tn === 'native' && /JSArrayBufferData|ArrayBufferData|backing_store/.test(nm)) {
    total += sz;
    const k = path(i);
    const o = by.get(k) || { n: 0, sz: 0 }; o.n++; o.sz += sz; by.set(k, o);
  } else if (tn === 'object' || tn === 'array' || tn === 'number' || tn === 'closure') {
    const k = `${tn} ${nm}`; const o = kinds.get(k) || { n: 0, sz: 0 }; o.n++; o.sz += sz; kinds.set(k, o);
  }
}
const MB = v => (v / 1048576).toFixed(1);
console.log(`array buffers ${MB(total)} MB, by who holds them:`);
for (const [k, o] of [...by].sort((a, b) => b[1].sz - a[1].sz).slice(0, TOP)) console.log(`${MB(o.sz).padStart(7)} MB ${String(o.n).padStart(6)}  ${k}`);
console.log('\nobjects by kind (self size):');
for (const [k, o] of [...kinds].sort((a, b) => b[1].sz - a[1].sz).slice(0, 25)) console.log(`${MB(o.sz).padStart(7)} MB ${String(o.n).padStart(8)}  ${k}`);
