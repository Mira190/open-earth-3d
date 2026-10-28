// Post-processing: bloom for sun glitter and foam, and, under water, the light shafts. The shafts
// march along each pixel's ray, and at every step ask the wave field how much sun gets through
// the surface above that point (the same caustic focusing the sea floor shows), then scatter it
// toward the eye through the water's own attenuation. A mask-edge vignette comes with it.
import * as THREE from 'three/webgpu';
import { pass, Fn, Loop, float, vec2, vec3, vec4, mix, max, min, exp, log, length, normalize, dot, pow, select, smoothstep,
  clamp, screenUV, getViewPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, cameraPosition, interleavedGradientNoise } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export function createPost(renderer, scene, camera, env) {
  const u = env.u;
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const bloomPass = bloom(color, 0.35, 0.55, 0.92);

  const STEPS = 14;
  const shafts = Fn(() => {
    const view = getViewPosition(screenUV, depth.r, cameraProjectionMatrixInverse);
    const world = cameraWorldMatrix.mul(vec4(view, 1)).xyz;
    const toP = world.sub(cameraPosition);
    const L = min(length(toP), 70);
    const dir = toP.div(max(length(toP), 1e-3));
    const under = cameraPosition.y.lessThan(u.tide);
    const jitter = interleavedGradientNoise(screenUV.mul(vec2(1280, 720)));
    const acc = vec3(0).toVar();
    // the part of the ray that is under water (the camera is, so it runs to the surface at most)
    const toSurface = select(dir.y.greaterThan(0.001), u.tide.sub(cameraPosition.y).div(dir.y), float(1e4));
    const span = min(L, toSurface);
    const step = span.div(STEPS);
    const phase = float(0.18).add(pow(max(dot(dir, u.sunDir), 0), 5).mul(1.2));  // forward scattering toward the sun
    Loop(STEPS, ({ i }) => {
      const t = float(i).add(jitter).mul(step);
      const S = cameraPosition.add(dir.mul(t));
      const lit = env.causticSoft(S);                   // sun reaching this point through the waves
      const dS = u.tide.sub(S.y).max(0);
      const sunHere = exp(u.K.mul(dS.mul(u.lightPath).add(t)).negate());
      acc.addAssign(sunHere.mul(lit).mul(step));
    });
    // select, not a multiply by 0: above the water the march can overflow, and 0 x inf is a NaN that bloom-free
    // pixels show as black (a full row at the screen's middle)
    return select(under, acc.mul(phase).mul(0.035).mul(u.white).mul(u.sunCol).mul(smoothstep(0.02, 0.3, u.sunDir.y)), vec3(0));
  });

  const vignette = Fn(() => {
    const c = screenUV.sub(0.5);
    const r = length(c.mul(vec2(1.0, 0.8)));
    const under = select(cameraPosition.y.lessThan(u.tide), float(1), float(0));
    return float(1).sub(smoothstep(0.55, 0.95, r).mul(0.45).mul(under));
  });

  const q = new URLSearchParams(location.search);
  let base = color.rgb;
  if (q.get('bloom') !== '0') base = base.add(bloomPass.rgb);
  if (q.get('shafts') !== '0') base = base.add(shafts());
  // night vision: as the eye adapts past a few hundred times, colour fades and shifts blue (the Purkinje shift);
  // what is bright enough for the cones (a torch beam, a lamp, the moon's path) keeps its colour
  const lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  // (a dive torch lights what it reaches to cone levels: inside its beam, round the middle of the view, colour stays)
  const beam = float(1).sub(smoothstep(0.18, 0.42, length(screenUV.sub(0.5).mul(vec2(1.6, 1))))).mul(u.torchOn);
  const scot = smoothstep(2.3, 4.3, log(u.adapt).div(2.302585)).mul(0.75).mul(float(1).sub(smoothstep(0.08, 0.35, lum))).mul(float(1).sub(beam.mul(0.9)));
  post.outputNode = vec4(mix(base, vec3(0.72, 0.86, 1.12).mul(lum), scot).mul(vignette()), 1);
  return post;
}
