// The frame behind the water: the scene's colour and depth as they stand when the water is drawn, which the sea
// refracts (ocean.js). three.js's own viewport nodes copy the framebuffer once for every node and every draw that
// reads one: the sea's two depth reads and its colour read, for its back faces and again for its front, were six
// copies a frame, each of which ends the scene's render pass and begins it again. A pass that begins again loads
// every sample of the multisampled colour and depth it stored a moment before; on a tile-based GPU (every Apple
// one, every phone) that is the whole target read from memory and written back, seven times a frame (issue 382).
// Here the pair is copied once a render, with the pass ended once: every node of either kind reads the same two
// textures.
import * as THREE from 'three/webgpu';
import { nodeObject, screenUV } from 'three/tsl';

const sets = new WeakMap();   // the target being drawn (a render target, or the canvas's) -> its two copies
const colour0 = new THREE.FramebufferTexture(), depth0 = new THREE.DepthTexture();
const size = new THREE.Vector2(), rect = new THREE.Vector4();
let warned = false;

function setOf(renderer) {
  const ref = renderer.getRenderTarget() || renderer.getCanvasTarget() || renderer;
  let s = sets.get(ref);
  if (!s) sets.set(ref, s = { colour: colour0.clone(), depth: depth0.clone() });
  return s;
}

function copy(renderer, s) {
  const ref = renderer.getRenderTarget() || renderer.getCanvasTarget();
  if (ref && ref.getDrawingBufferSize) ref.getDrawingBufferSize(size); else if (ref) size.set(ref.width, ref.height); else renderer.getDrawingBufferSize(size);
  for (const t of [s.colour, s.depth]) if (t.image.width !== size.x || t.image.height !== size.y) { t.image.width = size.x; t.image.height = size.y; t.needsUpdate = true; }
  // WebGPU: both copies between one end of the pass and one beginning. The backend's own copy ends the pass, copies and
  // begins it again; the colour's copy is slipped in beside the depth's, into the same encoder, before the pass resumes
  const backend = renderer.backend, rc = renderer._currentRenderContext;
  try {
    if (backend.isWebGPUBackend && rc && rc.renderTarget && rc.depthTexture && typeof backend._copyFramebufferToTexture === 'function' && backend.get(rc).currentPass) {
      renderer._textures.updateTexture(s.colour, { renderTarget: rc.renderTarget });
      const src = backend.get(rc.textures[0]).texture, dst = backend.get(s.colour).texture;
      if (src && dst && src.format === dst.format) {
        renderer._textures.updateTexture(s.depth, { renderTarget: rc.renderTarget });
        const inner = backend._copyFramebufferToTexture;
        let n = 0;
        backend._copyFramebufferToTexture = function (encoder, texture, a, b, r, ...rest) {
          inner.call(this, encoder, texture, a, b, r, ...rest);
          if (!n++) inner.call(this, encoder, s.colour, src, dst, r);
        };
        try { backend.copyFramebufferToTexture(s.depth, rc, rect.set(0, 0, size.x, size.y)); } finally { delete backend._copyFramebufferToTexture; }
        if (n) return;
      }
    }
  } catch (e) { if (!warned) { warned = true; console.warn('behind.js: the paired copy is not available here, copying one at a time', e); } }
  renderer.copyFramebufferToTexture(s.depth);
  renderer.copyFramebufferToTexture(s.colour);
}

class BehindNode extends THREE.ViewportTextureNode {
  static get type() { return 'BehindNode'; }
  constructor(uvNode = screenUV, depth = false) {
    super(uvNode, null, depth ? depth0 : colour0);
    this.isDepth = depth;
  }
  // (the reference is the pair, the same for every node of either kind: three.js then calls updateBefore once a render)
  updateReference(frame) { const s = setOf(frame.renderer); this.value = this.isDepth ? s.depth : s.colour; return s; }
  updateBefore(frame) { copy(frame.renderer, setOf(frame.renderer)); }
  clone() { return new this.constructor(this.uvNode, this.isDepth); }
}

// the colour behind the water at a screen position, and the depth buffer's value there
export const behindColour = uv => nodeObject(new BehindNode(uv, false));
export const behindDepth = uv => nodeObject(new BehindNode(uv, true));
