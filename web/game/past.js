// What only the camera sees. The story's camera sees the evening it was loaded for: through its finder, a thing of
// that year that is gone from the street stands where it stood (a pillar box, a shoeshine boy's stool, the river open
// under its bridge), in the tones of an old print, and outside the finder's bright lines there is only tonight. Each
// is what a frame's photograph is of.
//
// The things are models (blender/build_past.py, assets/past/past.glb). One material draws them all: it throws away
// every fragment outside a rectangle of the screen (the finder's, given in the picture's own -1..1 so that it holds at
// any render size), and none at all while the camera is down.
//   relic(model, at, heading, { scale, over })   at: a THREE.Vector3; over: drawn through what has been built where it
//                                                stood; returns { remove() }
//   rect([x0, y0, x1, y1] | null)                the finder's rectangle, or null: the camera is down
//   whole(on)                                    the whole picture is the finder's (the photograph being taken)
'use strict';
window.OEPast = (function () {
  function create({ THREE, world }) {
    let kit = null;
    const U = { uPast: { value: new THREE.Vector4(1, 1, -1, -1) } }, keep = new THREE.Vector4(1, 1, -1, -1);
    const waiting = [];
    // (two files: the things of the other year, and tonight's own set dressing, which is always seen: `set`)
    let pending = 2; const got = {};
    for (const file of ['assets/past/past.glb', 'assets/story/set.glb']) new THREE.GLTFLoader().load(file, gl => {
      gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(o => { if (o.isMesh) got[o.name] = o.geometry.clone().applyMatrix4(o.matrixWorld); });
      if (!--pending) { kit = got; waiting.splice(0).forEach(f => f()); }
    }, undefined, e => { console.warn(`${file} is unavailable:`, e); if (!--pending) { kit = got; waiting.splice(0).forEach(f => f()); } });
    // A thing of that year is a thing: it stands on the ground with its shadow under it, the people of tonight who
    // stand in front of it hide it as they would hide anything, and it is lit as a lamp over that street would have
    // lit it (tonight's light is not its light), so that its form is seen. Only what stood where something has since
    // been built (a dome inside a tower: `over`) is drawn through what is there now.
    const make = (over, set) => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: over ? THREE.FrontSide : THREE.DoubleSide, transparent: true, opacity: over ? 0.82 : 1, depthTest: !over, depthWrite: !over });
      m.onBeforeCompile = sh => {
        sh.uniforms.uPast = set ? { value: new THREE.Vector4(-1, -1, 1, 1) } : U.uPast; // (tonight's own things are seen with or without the camera)
        sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec4 vPastClip;\nvoid main() {').replace('#include <project_vertex>', '#include <project_vertex>\n vPastClip = gl_Position;');
        sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform vec4 uPast; varying vec4 vPastClip;
void main() { vec2 nd = vPastClip.xy / vPastClip.w; if (nd.x < uPast.x || nd.x > uPast.z || nd.y < uPast.y || nd.y > uPast.w) discard;`)
          // its own light: a key from above and a little to one side, a fill from the other, and a floor so that no face is black
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 vec3 pastN = normalize(normal);
 float pastKey = max(dot(pastN, normalize((viewMatrix * vec4(0.35, 0.85, 0.4, 0.0)).xyz)), 0.0), pastFill = max(dot(pastN, normalize((viewMatrix * vec4(-0.6, 0.25, -0.5, 0.0)).xyz)), 0.0);
 totalEmissiveRadiance += diffuseColor.rgb * (0.36 + 0.72 * pastKey + 0.2 * pastFill);`)
          // a quarter of the way to the tones of an old print
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float pastL = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11)); gl_FragColor.rgb = mix(gl_FragColor.rgb, pastL * vec3(1.12, 1.0, 0.82), ' + (set ? '0.0' : '0.26') + ');');
      };
      return m;
    };
    const mats = [make(false), make(true), make(false, true)];
    function relic(model, at, heading = 0, { scale = 1, over = false, set = false } = {}) {
      const g = new THREE.Group(); g.position.copy(at); g.rotation.y = heading; g.scale.setScalar(scale); // (heading: radians anticlockwise from the model's own axes, which are the map's: +x east, +y north)
      const put = () => {
        if (!kit[model]) return console.warn(`No thing of the other year called ${model}`);
        const m = new THREE.Mesh(kit[model], mats[set ? 2 : over ? 1 : 0]); m.frustumCulled = false; m.renderOrder = over ? 40 : 2;
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
