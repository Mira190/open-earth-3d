// The one GLTFLoader every page makes (the city viewer and the game through index.html's
// THREE.GLTFLoader, the reef sites by importing it), so a model reaches every device that can
// draw it rather than the simple stand-ins:
//   - The shared models are meshopt-compressed (EXT_meshopt_compression, pipeline/meshopt_glb.mjs;
//     issue 148). meshoptimizer's decoder runs in WebAssembly; where there is none (iOS Lockdown
//     Mode, some locked-down browsers) its pure-JavaScript reference decoder (MIT,
//     vendor/meshoptimizer/) decodes them instead: slower, but a person stays a person.
//   - It decodes in two workers (MeshoptDecoder.useWorkers), off the main thread.
//   - A download that fails (a phone dropping a request between cells, a server hiccup) is tried
//     again twice, after 0.8 s and 2.4 s, before the loader gives up on it.
import { GLTFLoader as GLTFLoaderBase } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder as WasmDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const wasm = WasmDecoder.supported && await WasmDecoder.ready.then(() => true, () => false);
export const MeshoptDecoder = wasm ? WasmDecoder
  : (await import(new URL('./vendor/meshoptimizer/meshopt_decoder_reference.js', import.meta.url).href)).MeshoptDecoder;
if (!wasm) console.warn('No WebAssembly: the models are decoded in JavaScript');
// the decoding in workers, off the main thread (issue 201): a streamed model (an NPC's character, the
// helicopter) is decoded without holding up a frame, and the loader's models in parallel. Two at most,
// one on a two-core device; where workers can't be made, decodeGltfBufferAsync decodes here as before.
if (wasm && WasmDecoder.useWorkers && typeof Worker === 'function') {
  try { WasmDecoder.useWorkers(Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1))); } catch (e) { /* decoded on the main thread */ }
}

const RETRY_MS = [800, 2400];
export class GLTFLoader extends GLTFLoaderBase {
  constructor(manager) { super(manager); this.setMeshoptDecoder(MeshoptDecoder); }
  load(url, onLoad, onProgress, onError) {
    let tries = 0;
    const attempt = () => super.load(url, onLoad, onProgress, err => {
      if (tries < RETRY_MS.length) setTimeout(attempt, RETRY_MS[tries++]);
      else if (onError) onError(err);
      else console.error(err);
    });
    attempt();
  }
}
