// Decodes each city's packs (buildings, landmarks, game, terrain, places and scene .bin) with the browser's decoder
// (web/pack.js) and compares them, value for value, with their JSON (the bytes columns as base64 again,
// the typed arrays as lists), and times both (issues 148, 201).
//   node tools/pack_check.js [city ...]     (default: every city with a pack)
'use strict';
const fs = require('fs'), path = require('path');
const { decode } = require('../web/pack.js');
const DATA = path.join(__dirname, '..', 'web', 'data');
const same = (a, b, at) => {
  if (a instanceof Uint8Array) a = Buffer.from(a).toString('base64');
  else if (ArrayBuffer.isView(a)) a = Array.from(a);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return at;
    for (let i = 0; i < a.length; i++) { const r = same(a[i], b[i], `${at}[${i}]`); if (r) return r; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return `${at}: keys`;
    for (const k of kb) { const r = same(a[k], b[k], `${at}.${k}`); if (r) return r; }
    return null;
  }
  return Object.is(a, b) || (a === 0 && b === 0) ? null : `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};
(async () => {
  const NAMES = ['buildings', 'landmarks', 'game', 'terrain', 'places', 'scene'];
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(DATA).filter(c => NAMES.some(n => fs.existsSync(path.join(DATA, c, `${n}.bin`)) && fs.existsSync(path.join(DATA, c, `${n}.json`))));
  let bad = 0;
  for (const c of ids) for (const n of NAMES) {
    if (!fs.existsSync(path.join(DATA, c, `${n}.bin`)) || !fs.existsSync(path.join(DATA, c, `${n}.json`))) continue; // (a reef site's terrain.bin is its own format)
    const bin = fs.readFileSync(path.join(DATA, c, `${n}.bin`)), js = fs.readFileSync(path.join(DATA, c, `${n}.json`), 'utf8');
    let t = performance.now();
    const ref = JSON.parse(js), tj = performance.now() - t;
    t = performance.now();
    const got = await decode(bin), tb = performance.now() - t;
    const diff = same(got, ref, `${c}/${n}`);
    if (diff) bad++;
    console.log(`${diff ? 'FAIL' : 'ok  '} ${c}/${n}: ${(bin.length / 1e6).toFixed(2)} MB packed, ${(js.length / 1e6).toFixed(2)} MB JSON; decode ${tb.toFixed(0)} ms, JSON.parse ${tj.toFixed(0)} ms${diff ? '; differs at ' + diff : ''}`);
  }
  process.exit(bad ? 1 : 0);
})();
