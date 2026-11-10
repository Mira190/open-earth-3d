// The postcards' plush friends (tools/plush.js) side by side in a soft studio light, to judge their faces and
// proportions before they go into the stills.
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/plush_shot.js out.png [kind,kind,...] [WxH]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [,, out = 'plush.png', only = '', size = '2400x900'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const base = `http://localhost:${process.env.PORT || 8800}/`;
  await p.route(base + '__plush.html', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="margin:0;background:#cfd6dc">
<script type="importmap">{"imports":{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/addons/"}}</script>
<script>${fs.readFileSync(path.join(__dirname, 'plush.js'), 'utf8')}</script>
<script type="module">
import * as THREE from 'three';
window.THREE = THREE;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(${w}, ${h}); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color(0xcfd6dc);
s.add(new THREE.HemisphereLight(0xdfe8f2, 0x6b6258, 2.2));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(2, 3, 2.5); s.add(sun);
const kinds = ${JSON.stringify(only)} ? ${JSON.stringify(only)}.split(',') : Object.keys(OEPlush.KINDS);
const gap = 0.26;
kinds.forEach((k, i) => { const o = OEPlush.build(k); o.position.x = (i - (kinds.length - 1) / 2) * gap; o.rotation.y = (i % 2 ? -1 : 1) * 0.18; s.add(o); });
const c = new THREE.PerspectiveCamera(22, ${w / h}, 0.05, 50);
const span = kinds.length * gap; c.position.set(0, 0.02, Math.max(0.9, span / 2 / Math.tan(11 * Math.PI / 180) / ${w / h} * 1.05)); c.lookAt(0, -0.03, 0);
r.render(s, c); window.__done = true;
</script>` }));
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base + '__plush.html');
  await p.waitForFunction('window.__done', null, { timeout: 60000 }).catch(() => {});
  await p.screenshot({ path: out });
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
