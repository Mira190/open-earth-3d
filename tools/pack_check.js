// Decodes each city's buildings.bin with the browser's decoder (web/pack.js) and compares it, value for
// value, with buildings.json (the bytes columns as base64 again), and times both (issue 148).
//   node tools/pack_check.js [city ...]     (default: every city with a buildings.bin)
'use strict';
const fs = require('fs'), path = require('path');
const { decode } = require('../web/pack.js');
const DATA = path.join(__dirname, '..', 'web', 'data');
const same = (a, b, at) => {
  if (a instanceof Uint8Array) a = Buffer.from(a).toString('base64');
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
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(DATA).filter(c => fs.existsSync(path.join(DATA, c, 'buildings.bin')));
  let bad = 0;
  for (const c of ids) {
    const bin = fs.readFileSync(path.join(DATA, c, 'buildings.bin')), js = fs.readFileSync(path.join(DATA, c, 'buildings.json'), 'utf8');
    let t = performance.now();
    const ref = JSON.parse(js), tj = performance.now() - t;
    t = performance.now();
    const got = await decode(bin), tb = performance.now() - t;
    const diff = same(got, ref, c);
    if (diff) bad++;
    console.log(`${diff ? 'FAIL' : 'ok  '} ${c}: ${(bin.length / 1e6).toFixed(2)} MB packed, ${(js.length / 1e6).toFixed(2)} MB JSON; decode ${tb.toFixed(0)} ms, JSON.parse ${tj.toFixed(0)} ms${diff ? '; differs at ' + diff : ''}`);
  }
  process.exit(bad ? 1 : 0);
})();
