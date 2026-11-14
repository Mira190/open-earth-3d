// Every character a city's crowd and NPCs can be drawn as, one sheet each, to look a model over part by part: the
// whole figure from the front, the side and behind in mid-stride, standing, and close on the face, the hands and
// the feet. Built with the game's own people (web/game/people.js: the scanned avatars' textures and the crowd
// figures' palettes), under a plain sky and a key light, on a grey floor with a metre rule behind.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/people_lineup.js out_dir [city|all|name,name...] [crowd]
// city: the cast its crowd draws from (game.crowd.real_from too) and its NPCs' characters; "crowd": the far
// crowd's own figures (M_, W_) too. Prints each character's triangles, height and anything out of the ordinary:
// a head, hand or foot bone missing, a hand or a foot far from where a person's is, a figure off the floor.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, out = 'lineup', which = 'shibuya', extra = ''] = process.argv;
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 200)}`));
  fs.mkdirSync(out, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.THREE && window.OEPeople && THREE.GLTFLoader, null, { timeout: 120000 });
  const names = await p.evaluate(async ([which, extra]) => {
    const info = await (await fetch('assets/people/people.json')).json(), all = info.npcs.characters;
    let list;
    if (which === 'all') list = Object.keys(all);
    else if (/^[RMWH]_/.test(which)) list = which.split(',');
    else {
      const g = await (await fetch(`data/${which}/game.json`)).json();
      const from = new Set([which, ...((g.crowd || {}).real_from || [])]);
      list = Object.keys(all).filter(n => (all[n].cities || []).some(c => from.has(c)));
      for (const n of g.npcs || []) if (n.look && n.look.character && !list.includes(n.look.character)) list.push(n.look.character);
    }
    if (extra === 'crowd') list = list.concat(Object.keys(info.characters));
    return list;
  }, [which, extra]);
  await p.evaluate(async () => {
    const W = 1400, H = 900;
    const cv = document.createElement('canvas');
    cv.id = 'lineup'; cv.width = W; cv.height = H;
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:1400px;height:900px';
    document.body.appendChild(cv);
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.setScissorTest(true);
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0xb9c4cf);
    sc.add(new THREE.HemisphereLight(0xdfe9f5, 0x7a7468, 1.6));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6); key.position.set(2.5, 4, 3.5); sc.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.7); fill.position.set(-3, 2, -2); sc.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; sc.add(floor);
    // a rule behind: a tick each 0.5 m to 2 m
    for (let k = 0; k <= 4; k++) { const t = new THREE.Mesh(new THREE.BoxGeometry(k % 2 ? 0.12 : 0.24, 0.008, 0.008), new THREE.MeshBasicMaterial({ color: 0x30343a })); t.position.set(-0.75, k * 0.5, -0.5); sc.add(t); }
    const lib = await OEPeople.load('assets/people/');
    window.__lineup = { r, sc, lib, W, H, cur: null };
  });
  const sheet = async name => p.evaluate(async name => {
    const L = window.__lineup, { r, sc, lib, W, H } = L;
    if (L.cur) sc.remove(L.cur.root);
    await lib.require(name);
    const info = lib.info.npcs.characters[name] || lib.info.characters[name] || {};
    const rig = OEPeople.person(lib, name[0] === 'R' || name[0] === 'H' ? { character: name, scale: 1 } : Object.assign(OEPeople.randomLook ? OEPeople.randomLook(lib, name) || {} : {}, { character: name, scale: 1 }));
    L.cur = rig; sc.add(rig.root);
    const bones = {}; let tris = 0, meshes = 0;
    rig.root.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isSkinnedMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const find = (...res) => { for (const re of res) for (const n in bones) if (re.test(n)) return bones[n]; return null; };
    const B = { head: find(/^Head$/i, /Head$/i, /head/i), handL: find(/L.?Hand$/i, /Wrist.?L$/i, /Hand.?L$/i, /L.*Hand/i), handR: find(/R.?Hand$/i, /Wrist.?R$/i, /Hand.?R$/i, /R.*Hand/i),
      footL: find(/L.?Foot$/i, /Foot.?L$/i, /L.*Foot/i), footR: find(/R.?Foot$/i, /Foot.?R$/i, /R.*Foot/i) };
    const wp = b => b ? b.getWorldPosition(new THREE.Vector3()) : null;
    const pose = (speed, t) => { for (let k = 0; k < 40; k++) rig.animate(t / 40, speed, 'ground', k * t / 40); rig.root.updateMatrixWorld(true); };
    // the figure's box from its skinned vertices, as posed
    const box = () => {
      const bx = new THREE.Box3(), v = new THREE.Vector3();
      rig.root.traverse(o => { if (!o.isSkinnedMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i); (o.applyBoneTransform ? o.applyBoneTransform(i, v) : o.boneTransform(i, v)); v.applyMatrix4(o.matrixWorld); bx.expandByPoint(v); } });
      return bx;
    };
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    const view = (x, y, w, h, eye, at, fov) => {
      cam.fov = fov; cam.aspect = w / h; cam.position.copy(eye); cam.lookAt(at); cam.updateProjectionMatrix();
      r.setViewport(x, H - y - h, w, h); r.setScissor(x, H - y - h, w, h); r.render(sc, cam);
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const notes = [];
    // standing
    pose(0, 0.6);
    const bs = box(), top = bs.max.y, mid = V(0, top / 2, 0);
    const hS = wp(B.head) || V(0, top - 0.1, 0);
    if (!B.head) notes.push('no head bone');
    for (const k of ['handL', 'handR', 'footL', 'footR']) if (!B[k]) notes.push(`no ${k} bone`);
    if (Math.abs(bs.min.y) > 0.04) notes.push(`stands ${bs.min.y.toFixed(2)} m off the floor`);
    if (top < 1.4 || top > 2.05) notes.push(`${top.toFixed(2)} m tall`);
    const hl = wp(B.handL), hr = wp(B.handR), fl = wp(B.footL), fr = wp(B.footR);
    if (hl && hr && (hl.y < 0.5 || hr.y < 0.5 || hl.y > 1.2 || hr.y > 1.2)) notes.push(`hands at ${hl.y.toFixed(2)} and ${hr.y.toFixed(2)} m standing`);
    if (fl && fr && (fl.y > 0.25 || fr.y > 0.25 || fl.y < -0.05 || fr.y < -0.05)) notes.push(`ankles at ${fl.y.toFixed(2)} and ${fr.y.toFixed(2)} m standing`);
    if (fl && fr && Math.abs(fl.x - fr.x) > 0.5) notes.push(`feet ${Math.abs(fl.x - fr.x).toFixed(2)} m apart standing`);
    const c1 = 230, rowH = 560;
    view(0, 0, c1, rowH, V(0, top * 0.55, 5.2), mid, 24);                 // standing, front
    // close: the face (front and three-quarter), the hands, the feet
    view(0, rowH, 350, H - rowH, V(0, hS.y + 0.04, hS.z + 0.75), V(0, hS.y + 0.04, hS.z), 26);
    view(350, rowH, 350, H - rowH, V(0.5, hS.y + 0.05, hS.z + 0.55), V(0, hS.y + 0.03, hS.z), 26);
    if (hl && hr) view(700, rowH, 350, H - rowH, V(0, (hl.y + hr.y) / 2 + 0.1, 1.3), V(0, (hl.y + hr.y) / 2 - 0.02, 0), 36);
    if (fl && fr) view(1050, rowH, 350, H - rowH, V(0.45, 0.35, 0.9), V(0, 0.07, 0.03), 34);
    // mid-stride: front, side, behind, the other side
    pose(1.3, 0.45);
    const bw = box();
    if (bw.min.y < -0.06) notes.push(`walking, a foot ${(-bw.min.y).toFixed(2)} m under the floor`);
    if (bw.max.x - bw.min.x > 1.1) notes.push(`walking, ${(bw.max.x - bw.min.x).toFixed(2)} m wide`);
    const cw = (W - c1) / 4;
    [[0, 5.2], [5.2, 0], [0, -5.2], [-5.2, 0]].forEach(([x, z], i) => view(c1 + i * cw, 0, cw, rowH, V(x, top * 0.55, z), mid, 24));
    return { name, tris: Math.round(tris), meshes, top: +top.toFixed(2), sex: info.sex || info.pack || '', notes };
  }, name);
  let odd = 0;
  for (const name of names) {
    let s;
    try { s = await sheet(name); } catch (e) { console.log(`FAIL ${name}: ${String(e).slice(0, 200)}`); odd++; continue; }
    await p.locator('#lineup').screenshot({ path: path.join(out, `${name}.png`) });
    if (s.notes.length) odd++;
    console.log(`${s.notes.length ? 'look' : 'ok  '} ${name}: ${s.tris} triangles, ${s.top} m${s.notes.length ? ' -- ' + s.notes.join('; ') : ''}`);
  }
  for (const l of [...new Set(logs)].slice(0, 12)) console.log(l);
  console.log(`${names.length} characters, ${odd} to look at; sheets in ${out}`);
  await b.close();
})();
