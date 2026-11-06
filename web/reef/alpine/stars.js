// The stars of an alpine site's night: the Yale Bright Star Catalogue (5th revised edition, Hoffleit and Warren 1991;
// pipeline/stars.py writes web/data/sky/bsc5.bin), every star to about magnitude 6.5, at its J2000 place, turned by the
// sky's rotation for the clock and the site (atmos.js equatorialMatrix, the same matrix as the Milky Way and the
// Magellanic Clouds), so the Southern Cross, Orion and the pointers stand where they are tonight.
// - Each star is a small sprite on a sphere round the eye, a few pixels across whatever the lens: brighter stars a
//   little larger, as a photograph spreads them, and their brightness from the magnitude with the range eased (a
//   photograph's, not the eye's 100:1 between first and sixth magnitude).
// - Colour from B-V: the temperature (Ballesteros 2012) to a blackbody's colour.
// - Through the air: dimmed by the airmass (Kasten and Young's formula, 0.2 magnitudes an airmass for a dark, dry
//   site), and twinkling more toward the horizon.
// - Shown as the sky darkens, by atmos.js's u.stars (main.js: how much of the starry sky the adapted eye sees).
import * as THREE from 'three/webgpu';
import { Fn, attribute, uniform, float, vec3, vec4, uv, normalize, cross, select, abs, exp, pow, max, min, sin, smoothstep, dot, length, mix } from 'three/tsl';

const R = 140000;            // inside the sky dome (main.js: 150 km)

// B-V to a linear RGB colour, white at the Sun's colour index's neighbour (B-V 0.4) and normalised to luminance 1
function bvColour(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // a blackbody's colour (Tanner Helland's fit to the CIE colours, in sRGB), then linear
  const x = t / 100;
  let r = x <= 66 ? 255 : 329.698727446 * Math.pow(x - 60, -0.1332047592);
  let g = x <= 66 ? 99.4708025861 * Math.log(x) - 161.1195681661 : 288.1221695283 * Math.pow(x - 60, -0.0755148492);
  let b = x >= 66 ? 255 : x <= 19 ? 0 : 138.5177312231 * Math.log(x - 10) - 305.0447927307;
  const lin = v => { v = Math.min(255, Math.max(0, v)) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  [r, g, b] = [lin(r), lin(g), lin(b)];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
  // (a little of the colour, as the eye sees star colours: most stars look white with a tint)
  return [r / l, g / l, b / l].map(v => 1 + (v - 1) * 0.6);
}

export async function createStars({ atm, camera, renderer, url }) {
  const buf = await (await fetch(url)).arrayBuffer();
  const n = new DataView(buf).getUint32(0, true), q = new Int16Array(buf, 4, n * 5);
  const star = new Float32Array(n * 4), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = q[i * 5 + 3] / 1000;
    star.set([q[i * 5] / 32767, q[i * 5 + 1] / 32767, q[i * 5 + 2] / 32767, m], i * 4);
    col.set(bvColour(q[i * 5 + 4] / 1000), i * 3);
  }
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aStar', new THREE.InstancedBufferAttribute(star, 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  geo.instanceCount = n;

  const eqT = uniform(new THREE.Matrix3());     // equatorial J2000 -> local (the transpose of atm.u.eq)
  const pixAng = uniform(0.001);                 // a pixel's angle at the middle of the view, radians
  const time = uniform(0);
  const aStar = attribute('aStar', 'vec4'), aCol = attribute('aCol', 'vec3');
  const mag = aStar.w;
  // a sprite's half-size in pixels: 1.3 for the faintest, up to 3.5 for Sirius
  const sizePx = float(1.3).add(max(float(3.0).sub(mag), 0).mul(0.5)).min(3.5);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.fog = false;
  mat.positionNode = Fn(() => {
    const d = normalize(eqT.mul(aStar.xyz));
    const ref = select(abs(d.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
    const t1 = normalize(cross(d, ref)), t2 = cross(t1, d);
    const p = attribute('position', 'vec3');
    return d.mul(R).add(t1.mul(p.x).add(t2.mul(p.y)).mul(sizePx.mul(pixAng).mul(R)));
  })();
  mat.colorNode = Fn(() => {
    const d = normalize(eqT.mul(aStar.xyz));
    const r = length(uv().sub(0.5)).mul(2);
    const psf = exp(r.mul(r).mul(-4.5)).mul(smoothstep(1.0, 0.8, r));
    // the airmass (Kasten and Young 1989) and the extinction at 0.2 magnitudes an airmass
    const h = max(d.y, -0.02), hdeg = h.mul(57.2958);
    const X = float(1).div(max(h, 0).add(pow(max(hdeg, -3.5).add(3.885), -1.253).mul(0.15)));
    const ext = pow(float(10), X.mul(-0.08)).mul(smoothstep(-0.01, 0.02, d.y));
    // twinkling: faster and deeper low in the sky
    const ph = dot(aStar.xyz, vec3(1731.3, 917.7, 2711.1));
    const tw = float(1).add(sin(time.mul(min(X, 12).mul(1.3).add(6)).add(ph)).mul(min(X.sub(1).mul(0.04), 0.35)));
    // brightness: the magnitude scale eased to a photograph's range, spread over the sprite so a larger sprite is not
    // brighter in sum
    const flux = pow(float(10), mag.mul(-0.4 * 0.78));
    const k = flux.mul(55).div(sizePx.mul(sizePx).div(2.2));
    return vec4(aCol.mul(k.mul(psf).mul(ext).mul(tw).mul(atm.u.stars)), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = -0.5; mesh.name = 'stars';
  const size = new THREE.Vector2();
  function update(t) {
    mesh.position.copy(camera.position);
    eqT.value.copy(atm.u.eq.value).transpose();
    renderer.getDrawingBufferSize(size);
    pixAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, size.y) * renderer.getPixelRatio();
    time.value = t;
    mesh.visible = atm.u.stars.value > 1e-9;
  }
  return { mesh, update, count: n };
}
