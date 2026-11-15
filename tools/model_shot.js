// A model's clips, looked at: each clip of a .glb at a few moments, from the side and from three-quarters, on a
// plain floor under a sun, as one sheet. For a rigged model built here (blender/build_dog.py), before it is in a game.
//   xvfb-run -a node tools/model_shot.js assets/animals/akita.glb out.png [clip,clip,...]
const { chromium } = require('playwright');
const fs = require('fs');
const [,, model = 'assets/animals/akita.glb', out = '/tmp/model.png', only = ''] = process.argv;
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">
<script type="importmap">{"imports": {"three": "./vendor/three/three.module.min.js", "three/addons/": "./vendor/three/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const W = 420, H = 300, r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(W, H); r.shadowMap.enabled = true; document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8d949c);
const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(2, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 }); scene.add(sun, new THREE.HemisphereLight(0xcfd8e6, 0x6a6258, 1.3));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), new THREE.MeshStandardMaterial({ color: 0xcc4444 })); post.position.set(0.9, 0.5, -0.5); scene.add(post); // (a metre, for scale)
const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
const g = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(${JSON.stringify(model)}, res, null, rej));
g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
scene.add(g.scene);
const mixer = new THREE.AnimationMixer(g.scene);
window.clips = g.animations.map(c => [c.name, c.duration]);
window.shot = (name, t, view) => {
  mixer.stopAllAction(); const c = g.animations.find(q => q.name === name); if (c) { const a = mixer.clipAction(c); a.play(); mixer.setTime(t); }
  const v = { side: [0, 0.5, 3.4], front: [2.6, 0.9, 2.0], back: [-2.4, 1.2, 2.0], top: [0.4, 3.6, 0.6] }[view];
  cam.position.set(...v); cam.lookAt(0, 0.42, 0); r.render(scene, cam);
  return r.domElement.toDataURL('image/png');
};
window.ready = true;
</script>`;
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] });
  const p = await b.newPage({ viewport: { width: 500, height: 400 } });
  p.on('pageerror', e => console.log(`pageerror: ${String(e).slice(0, 300)}`));
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  const base = `http://localhost:${process.env.PORT || 8800}`;
  await p.route(`${base}/__model.html`, r => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await p.goto(`${base}/__model.html`);
  await p.waitForFunction('window.ready', null, { timeout: 120000 });
  const clips = (await p.evaluate(() => window.clips)).filter(c => !only || only.split(',').includes(c[0]));
  console.log('clips', JSON.stringify(clips));
  const dir = `${out}.d`; fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const [name, dur] of clips) for (const [k, view] of [[0, 'side'], [0.25, 'side'], [0.5, 'side'], [0.75, 'side'], [0.1, 'front'], [0.6, 'back']]) {
    const url = await p.evaluate(([n, t, v]) => window.shot(n, t, v), [name, k * dur, view]);
    const f = `${dir}/${name}-${view}-${k}.png`; fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); names.push(f);
  }
  await b.close();
  require('child_process').execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs = sys.argv[2:]; ims = [Image.open(f) for f in fs]; w, h = ims[0].size; cols = 6
o = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)))
for i, im in enumerate(ims): o.paste(im, (i % cols * w, i // cols * h))
o.save(sys.argv[1])`, out, ...names]);
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
