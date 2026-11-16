// What only the camera sees. The story's camera sees the evening it was loaded for: through its finder, a thing of
// that year that is gone from the street stands where it stood (a pillar box, a shoeshine boy's stool, the river open
// under its bridge), in the tones of an old print, and outside the finder's bright lines there is only tonight. Each
// is what a frame's photograph is of.
//
// The things are models (blender/build_past.py, assets/past/past.glb). One material draws them all: it throws away
// every fragment outside a rectangle of the screen (the finder's, given in the picture's own -1..1 so that it holds at
// any render size), and none at all while the camera is down.
//   relic(model, at, heading, { scale })         at: a THREE.Vector3; returns { remove() }. It is seen through what
//                                                stands in front of it and where it stood: a second exposure
//   rect([x0, y0, x1, y1] | null)                the finder's rectangle, or null: the camera is down
//   whole(on)                                    the whole picture is the finder's (the photograph being taken)
'use strict';
window.OEPast = (function () {
  function create({ THREE, world }) {
    let kit = null;
    const U = { uPast: { value: new THREE.Vector4(1, 1, -1, -1) } }, keep = new THREE.Vector4(1, 1, -1, -1);
    const waiting = [];
    new THREE.GLTFLoader().load('assets/past/past.glb', gl => {
      gl.scene.updateMatrixWorld(true); kit = {};
      gl.scene.traverse(o => { if (o.isMesh) kit[o.name] = o.geometry.clone().applyMatrix4(o.matrixWorld); });
      waiting.splice(0).forEach(f => f());
    }, undefined, e => console.warn('The things of the other year are unavailable:', e));
    // Drawn last and over everything in its rectangle, with the depth it draws against wiped first: a second exposure
    // on the same frame, seen through the crowd and through whatever has been built where it stood
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPast = U.uPast;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec4 vPastClip;\nvoid main() {').replace('#include <project_vertex>', '#include <project_vertex>\n vPastClip = gl_Position;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform vec4 uPast; varying vec4 vPastClip;
void main() { vec2 nd = vPastClip.xy / vPastClip.w; if (nd.x < uPast.x || nd.x > uPast.z || nd.y < uPast.y || nd.y > uPast.w) discard;`)
        // most of its own colour given back unlit (it is not lit by tonight), then towards the tones of the print
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 1.1;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float pastL = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11)); gl_FragColor.rgb = mix(gl_FragColor.rgb, pastL * vec3(1.14, 1.0, 0.8), 0.4) + vec3(0.03, 0.025, 0.015);');
    };
    let first = null; // (the first of them drawn in a frame wipes the depth; the rest draw against each other)
    function relic(model, at, heading = 0, { scale = 1 } = {}) {
      const g = new THREE.Group(); g.position.copy(at); g.rotation.y = heading; g.scale.setScalar(scale); // (heading: radians anticlockwise from the model's own axes, which are the map's: +x east, +y north)
      const put = () => {
        if (!kit[model]) return console.warn(`No thing of the other year called ${model}`);
        const m = new THREE.Mesh(kit[model], mat); m.frustumCulled = false; m.renderOrder = 40;
        m.onBeforeRender = renderer => { const f = renderer.info.render.frame; if (first !== f) { first = f; renderer.clearDepth(); } };
        g.add(m);
      };
      if (kit) put(); else waiting.push(put);
      world.add(g);
      return { remove() { world.remove(g); } };
    }
    return {
      relic,
      rect(r) { if (r) keep.set(r[0], r[1], r[2], r[3]); else keep.set(1, 1, -1, -1); U.uPast.value.copy(keep); },
      whole(on) { if (on) U.uPast.value.set(-1, -1, 1, 1); else U.uPast.value.copy(keep); },
    };
  }
  return { create };
})();
